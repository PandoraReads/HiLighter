// ============================================================
// HiLighter - Shelf collection sync merge (pure, no Obsidian/DOM)
// ============================================================
// Merge semantics for the four bookshelf collections that live in
// plugin settings (custom shelves / favorites / tags / book
// metadata + the reading-day log) so they can ride the same sync
// file as highlights. Union-based with tombstones: an item present
// on either device survives, and a deletion recorded on one device
// is not resurrected by the other. Mirrors the highlight tombstone
// TTL so old deletions eventually stop suppressing.

import type { BookMeta, ShelfPreset, SyncTombstone } from '../models';
import type { BookTagMap } from '../bookshelf/book-tags';
import { pruneReadingDays } from '../bookshelf/book-meta';
import { isLiveTombstone, shouldPruneTombstone, TOMBSTONE_TTL_MS } from './merge';

/** Separator for a tag tombstone id (path + tag); NUL never appears in paths. */
const TAG_TOMBSTONE_SEP = String.fromCharCode(0);

/** Composite tombstone id for one (path, tag) pair. */
export function tagTombstoneId(path: string, tag: string): string {
    return `${path}${TAG_TOMBSTONE_SEP}${tag}`;
}

/** The four shelf collections plus their delete tombstones. */
export interface ShelfCollections {
    shelves: ShelfPreset[];
    favorites: string[];
    tags: BookTagMap;
    bookMeta: Record<string, BookMeta>;
    readingDays: Record<string, number>;
    shelfTombstones: SyncTombstone[];
    favoriteTombstones: SyncTombstone[];
    tagTombstones: SyncTombstone[];
    bookMetaTombstones: SyncTombstone[];
}

/** The subset of a sync payload that carries shelf collections (all optional). */
export type IncomingShelfCollections = Partial<Pick<ShelfCollections,
    'shelves' | 'favorites' | 'tags' | 'bookMeta' | 'readingDays'
    | 'shelfTombstones' | 'favoriteTombstones' | 'tagTombstones' | 'bookMetaTombstones'>>;

function tombstoneTime(list: SyncTombstone[] | undefined, id: string): number | undefined {
    return (list ?? []).find(entry => entry.id === id)?.deletedAt;
}

/** Union two tombstone lists by id, keeping the newest deletedAt, then prune expired. */
function mergeTombstones(a: SyncTombstone[] | undefined, b: SyncTombstone[] | undefined, now: number): SyncTombstone[] {
    const byId = new Map<string, number>();
    for (const entry of [...(a ?? []), ...(b ?? [])]) {
        if (typeof entry?.id !== 'string' || typeof entry?.deletedAt !== 'number') continue;
        const existing = byId.get(entry.id);
        byId.set(entry.id, existing === undefined ? entry.deletedAt : Math.max(existing, entry.deletedAt));
    }
    const merged: SyncTombstone[] = [];
    for (const [id, deletedAt] of byId) {
        if (shouldPruneTombstone(deletedAt, now, TOMBSTONE_TTL_MS)) continue;
        merged.push({ id, deletedAt });
    }
    return merged;
}

/** Union shelves by id; the newer updatedAt wins; live tombstones suppress. */
function mergeShelves(
    local: ShelfPreset[] | undefined,
    remote: ShelfPreset[] | undefined,
    tombstones: SyncTombstone[],
    now: number,
): ShelfPreset[] {
    const byId = new Map<string, ShelfPreset>();
    // Local first so a tie keeps the local copy; remote overrides only if newer.
    for (const shelf of [...(local ?? []), ...(remote ?? [])]) {
        if (typeof shelf?.id !== 'string' || shelf.id === '') continue;
        if (isLiveTombstone(tombstoneTime(tombstones, shelf.id), now, TOMBSTONE_TTL_MS)) continue;
        const existing = byId.get(shelf.id);
        if (!existing || (shelf.updatedAt ?? 0) > (existing.updatedAt ?? 0)) byId.set(shelf.id, shelf);
    }
    // Sort by the explicit order field (a reorder bumps updatedAt so the
    // winning shelves carry their new positions). Array sort is stable,
    // so ties keep the local-first insertion order; legacy shelves
    // without an order sort to the end deterministically.
    return [...byId.values()].sort((a, b) => shelfOrder(a) - shelfOrder(b));
}

/** Sort key for the merged shelf list; unordered shelves sink to the end. */
function shelfOrder(shelf: ShelfPreset): number {
    return typeof shelf.order === 'number' && Number.isFinite(shelf.order) ? shelf.order : Number.MAX_SAFE_INTEGER;
}

/** Union favorite paths; live tombstones suppress. */
function mergeFavorites(
    local: string[] | undefined,
    remote: string[] | undefined,
    tombstones: SyncTombstone[],
    now: number,
): string[] {
    const union = new Set<string>([...(local ?? []), ...(remote ?? [])]);
    const kept: string[] = [];
    for (const path of union) {
        if (typeof path !== 'string' || path === '') continue;
        if (isLiveTombstone(tombstoneTime(tombstones, path), now, TOMBSTONE_TTL_MS)) continue;
        kept.push(path);
    }
    return kept;
}

/** Union tags per path; a live tombstone removes just that path+tag. */
function mergeTags(
    local: BookTagMap | undefined,
    remote: BookTagMap | undefined,
    tombstones: SyncTombstone[],
    now: number,
): BookTagMap {
    const paths = new Set<string>([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})]);
    const result: BookTagMap = {};
    for (const path of paths) {
        const union = new Set<string>([...(local?.[path] ?? []), ...(remote?.[path] ?? [])]);
        const kept: string[] = [];
        for (const tag of union) {
            if (typeof tag !== 'string' || tag === '') continue;
            if (isLiveTombstone(tombstoneTime(tombstones, tagTombstoneId(path, tag)), now, TOMBSTONE_TTL_MS)) continue;
            kept.push(tag);
        }
        if (kept.length > 0) result[path] = kept;
    }
    return result;
}

/** Union book metadata per path; the newer updatedAt wins; live tombstones suppress. */
export function mergeBookMeta(
    local: Record<string, BookMeta> | undefined,
    remote: Record<string, BookMeta> | undefined,
    tombstones: SyncTombstone[],
    now: number,
): Record<string, BookMeta> {
    const paths = new Set<string>([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})]);
    const result: Record<string, BookMeta> = {};
    for (const path of paths) {
        if (path === '') continue;
        if (isLiveTombstone(tombstoneTime(tombstones, path), now, TOMBSTONE_TTL_MS)) continue;
        const localMeta = local?.[path];
        const remoteMeta = remote?.[path];
        const winner = !remoteMeta
            ? localMeta
            : !localMeta
                ? remoteMeta
                : ((remoteMeta.updatedAt > localMeta.updatedAt) ? remoteMeta : localMeta);
        if (winner) result[path] = winner;
    }
    return result;
}

/** Union reading days per key taking the max; entries past the retention window drop. */
export function mergeReadingDays(
    local: Record<string, number> | undefined,
    remote: Record<string, number> | undefined,
    now: number,
): Record<string, number> {
    const merged: Record<string, number> = {};
    for (const [key, count] of Object.entries(local ?? {})) {
        if (count > 0) merged[key] = count;
    }
    for (const [key, count] of Object.entries(remote ?? {})) {
        if (count > 0) merged[key] = Math.max(merged[key] ?? 0, count);
    }
    return pruneReadingDays(merged, now);
}

export interface ShelfMergeResult {
    result: ShelfCollections;
    /** True when shelves/favorites/tags differ from local (caller refreshes views). */
    changed: boolean;
}

function sameStringSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every(item => set.has(item));
}

function sameTags(a: BookTagMap, b: BookTagMap): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => sameStringSet(a[key] ?? [], b[key] ?? []));
}

function sameBookMetaMap(a: Record<string, BookMeta>, b: Record<string, BookMeta>): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => {
        const other = b[key];
        return other !== undefined && JSON.stringify(a[key]) === JSON.stringify(other);
    });
}

function sameReadingDays(a: Record<string, number>, b: Record<string, number>): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => a[key] === b[key]);
}

function sameShelves(a: ShelfPreset[], b: ShelfPreset[]): boolean {
    if (a.length !== b.length) return false;
    const byId = new Map(a.map(shelf => [shelf.id, shelf]));
    const sameContent = b.every(shelf => {
        const other = byId.get(shelf.id);
        return other !== undefined
            && other.name === shelf.name
            && (other.updatedAt ?? 0) === (shelf.updatedAt ?? 0)
            && JSON.stringify(other.include) === JSON.stringify(shelf.include)
            && JSON.stringify(other.exclude) === JSON.stringify(shelf.exclude);
    });
    // The sequence is visible state too: a pure reorder must count as a
    // change so views refresh and the new order persists.
    const sameSequence = a.every((shelf, index) => b[index]?.id === shelf.id);
    return sameContent && sameSequence;
}

/**
 * Merges remote shelf collections into the local ones. Tombstones are
 * unioned and pruned; the collections are unioned and tombstone-suppressed.
 * `changed` reflects only the visible collections, not tombstone churn.
 */
export function mergeShelfCollections(
    local: ShelfCollections,
    remote: IncomingShelfCollections,
    now: number,
): ShelfMergeResult {
    const shelfTombstones = mergeTombstones(local.shelfTombstones, remote.shelfTombstones, now);
    const favoriteTombstones = mergeTombstones(local.favoriteTombstones, remote.favoriteTombstones, now);
    const tagTombstones = mergeTombstones(local.tagTombstones, remote.tagTombstones, now);
    const bookMetaTombstones = mergeTombstones(local.bookMetaTombstones, remote.bookMetaTombstones, now);

    const shelves = mergeShelves(local.shelves, remote.shelves, shelfTombstones, now);
    const favorites = mergeFavorites(local.favorites, remote.favorites, favoriteTombstones, now);
    const tags = mergeTags(local.tags, remote.tags, tagTombstones, now);
    const bookMeta = mergeBookMeta(local.bookMeta, remote.bookMeta, bookMetaTombstones, now);
    const readingDays = mergeReadingDays(local.readingDays, remote.readingDays, now);

    const changed = !sameShelves(local.shelves, shelves)
        || !sameStringSet(local.favorites, favorites)
        || !sameTags(local.tags, tags)
        || !sameBookMetaMap(local.bookMeta, bookMeta)
        || !sameReadingDays(local.readingDays, readingDays);

    return {
        result: {
            shelves,
            favorites,
            tags,
            bookMeta,
            readingDays,
            shelfTombstones,
            favoriteTombstones,
            tagTombstones,
            bookMetaTombstones,
        },
        changed,
    };
}

// ── Tombstone recording helpers (immutable) ─────────────────

function addTombstone(list: SyncTombstone[] | undefined, id: string, now: number): SyncTombstone[] {
    return [...(list ?? []).filter(entry => entry.id !== id), { id, deletedAt: now }];
}

function dropTombstone(list: SyncTombstone[] | undefined, id: string): SyncTombstone[] {
    return (list ?? []).filter(entry => entry.id !== id);
}

export function withShelfDeletion(list: SyncTombstone[] | undefined, id: string, now: number): SyncTombstone[] {
    return addTombstone(list, id, now);
}

export function withoutShelfDeletion(list: SyncTombstone[] | undefined, id: string): SyncTombstone[] {
    return dropTombstone(list, id);
}

export function withFavoriteDeletion(list: SyncTombstone[] | undefined, path: string, now: number): SyncTombstone[] {
    return addTombstone(list, path, now);
}

export function withoutFavoriteDeletion(list: SyncTombstone[] | undefined, path: string): SyncTombstone[] {
    return dropTombstone(list, path);
}

export function withTagDeletion(list: SyncTombstone[] | undefined, path: string, tag: string, now: number): SyncTombstone[] {
    return addTombstone(list, tagTombstoneId(path, tag), now);
}

export function withoutTagDeletion(list: SyncTombstone[] | undefined, path: string, tag: string): SyncTombstone[] {
    return dropTombstone(list, tagTombstoneId(path, tag));
}

/** Records a book-metadata deletion so sync does not resurrect it. */
export function withBookMetaDeletion(list: SyncTombstone[] | undefined, path: string, now: number): SyncTombstone[] {
    return addTombstone(list, path, now);
}

/** Reads the four collections + tombstones out of a live settings object. */
export function collectionsFromSettings(settings: {
    bookshelfShelves?: ShelfPreset[];
    bookshelfFavorites?: string[];
    bookshelfTags?: BookTagMap;
    bookshelfBookMeta?: Record<string, BookMeta>;
    bookshelfReadingDays?: Record<string, number>;
    shelfTombstones?: SyncTombstone[];
    favoriteTombstones?: SyncTombstone[];
    tagTombstones?: SyncTombstone[];
    bookMetaTombstones?: SyncTombstone[];
}): ShelfCollections {
    return {
        shelves: settings.bookshelfShelves ?? [],
        favorites: settings.bookshelfFavorites ?? [],
        tags: settings.bookshelfTags ?? {},
        bookMeta: settings.bookshelfBookMeta ?? {},
        readingDays: settings.bookshelfReadingDays ?? {},
        shelfTombstones: settings.shelfTombstones ?? [],
        favoriteTombstones: settings.favoriteTombstones ?? [],
        tagTombstones: settings.tagTombstones ?? [],
        bookMetaTombstones: settings.bookMetaTombstones ?? [],
    };
}
