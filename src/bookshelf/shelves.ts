// ============================================================
// HiLighter - Bookshelf named-scope presets (自定义书架, pure)
// ============================================================
// Immutable operations over the saved shelf list plus scope
// matching: a shelf is "active" when the current settings scope is
// semantically equal to the shelf's (normalized, order-insensitive).
// No Obsidian imports so the logic stays unit-testable.

import type { ShelfPreset } from '../models';
import {
    normalizeFolderList,
    normalizeIncludeFolders,
    type IncludeFolderInput,
    type ShelfFolderRef,
} from './scope';

/** Monotonic-enough id: timestamp base + random suffix. */
export function newShelfId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Max shelf name length; longer names are trimmed, not rejected. */
const NAME_MAX_LENGTH = 40;

/**
 * Captures a scope under a name; null when the name is blank.
 * Include/exclude are normalized through the scope rules, so junk
 * entries never sneak into a saved shelf. `order` fixes the shelf's
 * position in the saved list (callers pass the next free index).
 */
export function makeShelfPreset(
    name: string | undefined,
    include: IncludeFolderInput[] | undefined,
    exclude: string[] | undefined,
    order?: number,
): ShelfPreset | null {
    const trimmed = (name ?? '').trim().slice(0, NAME_MAX_LENGTH);
    if (!trimmed) return null;
    return {
        id: newShelfId(),
        name: trimmed,
        include: normalizeIncludeFolders(include),
        exclude: normalizeFolderList(exclude),
        order,
        updatedAt: Date.now(),
    };
}

/** Drops entries missing an id or a visible name; tolerates absent list. */
export function normalizeShelves(shelves: ShelfPreset[] | undefined): ShelfPreset[] {
    if (!Array.isArray(shelves)) return [];
    return shelves.filter(shelf =>
        typeof shelf?.id === 'string' && shelf.id.trim() !== ''
        && typeof shelf?.name === 'string' && shelf.name.trim() !== '');
}

/** Appends a preset; the input list is never mutated. */
export function addShelf(shelves: ShelfPreset[], preset: ShelfPreset): ShelfPreset[] {
    return [...shelves, preset];
}

/** Removes by id; unknown ids leave the list unchanged (new array). */
export function removeShelf(shelves: ShelfPreset[], id: string): ShelfPreset[] {
    return shelves.filter(shelf => shelf.id !== id);
}

/**
 * Moves a shelf (by id) to a new position and rewrites sequential
 * `order` fields. Shelves whose position actually changed get a
 * bumped `updatedAt` so the reorder survives cross-device sync
 * (per-shelf newer-wins; the merge output sorts by `order`). The
 * input list is never mutated.
 */
export function reorderShelves(
    shelves: ShelfPreset[],
    fromId: string,
    toIndex: number,
    now: number = Date.now(),
): ShelfPreset[] {
    const from = shelves.findIndex(shelf => shelf.id === fromId);
    if (from === -1) return shelves;
    const to = Math.max(0, Math.min(toIndex, shelves.length - 1));
    if (to === from) return shelves;
    const without = shelves.filter((_, index) => index !== from);
    const next = [...without.slice(0, to), shelves[from]!, ...without.slice(to)];
    return next.map((shelf, index) => {
        // Same object at the same index: normalize the order field only
        // (a pure normalization keeps its sync timestamp).
        if (shelves[index] === shelf && shelf.order === index) return shelf;
        return {
            ...shelf,
            order: index,
            updatedAt: shelves[index] === shelf ? shelf.updatedAt : now,
        };
    });
}

/**
 * Canonical signature of a scope: sorted `path:recursive` pairs plus
 * sorted excludes — two scopes with the same signature scan the same
 * files regardless of list order.
 */
function scopeKey(include: ShelfFolderRef[], exclude: string[]): string {
    const includePart = include
        .map(ref => `${ref.path}:${ref.recursive ? 'r' : 't'}`)
        .sort()
        .join('|');
    const excludePart = [...exclude].sort().join('|');
    return `${includePart}||${excludePart}`;
}

/**
 * The saved shelf whose scope equals the current settings, or null.
 * Legacy plain-string include entries normalize to recursive refs, so
 * pre-2.8.1 scopes still match.
 */
export function activeShelfId(
    shelves: ShelfPreset[],
    include: IncludeFolderInput[] | undefined,
    exclude: string[] | undefined,
): string | null {
    const normalizedInclude = normalizeIncludeFolders(include);
    if (normalizedInclude.length === 0) return null;
    const currentKey = scopeKey(normalizedInclude, normalizeFolderList(exclude));
    const hit = normalizeShelves(shelves).find(shelf => {
        const shelfInclude = normalizeIncludeFolders(shelf.include);
        return shelfInclude.length > 0 && scopeKey(shelfInclude, normalizeFolderList(shelf.exclude)) === currentKey;
    });
    return hit?.id ?? null;
}
