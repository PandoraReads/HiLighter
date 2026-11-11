// ============================================================
// HiLighter - Sync file payload helpers (pure, no Obsidian/DOM)
// ============================================================

import { isValidColorId } from '../colors';
import type { BookMeta, CardTemplateId, HiLighterSettings, HighlightNote, ShelfPreset, SyncTombstone } from '../models';
import type { BookTagMap } from '../bookshelf/book-tags';
import { normalizeBookMetaMap, normalizeReadingDays } from '../bookshelf/book-meta';
import type { ShelfCollections } from './shelf-collections';
import { CARD_TEMPLATES } from '../card-templates';

export type { SyncTombstone };

/** Minimal file metadata we read from the adapter (Stat subset). */
export interface SyncFileStat {
    mtime: number;
    size: number;
}

export type SyncPayloadVersion = 1 | 2;

export type ParsedSyncPayload =
    | {
        ok: true;
        version: SyncPayloadVersion;
        exportedAt: number | null;
        writerId: string | null;
        count: number;
        highlights: unknown[];
        tombstones: SyncTombstone[];
        /** Shelf collections (自定义书架 / favorites / tags / book meta); empty when absent. */
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
    | { ok: false; reason: 'json' | 'version' | 'shape' };

/** A stat-based forced read every N ticks guards against stat "lies" (same-ms/size writes). */
export const FORCE_READ_EVERY_N_TICKS = 10;

/** Normalize a user-supplied vault path (forward slashes, no leading/trailing slash). */
export function normalizeSyncPath(path: string): string {
    const cleaned = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    return cleaned || '.hilighter/sync-data.json';
}

/** Stat is only ever compared with `!==`; it is a filter, never a source of truth. */
export function statsEqual(a: SyncFileStat | null, b: SyncFileStat | null): boolean {
    if (a == null || b == null) return a === b;
    return a.mtime === b.mtime && a.size === b.size;
}

/** Whether reading the file is worth doing right now. */
export function shouldReadContent(
    current: SyncFileStat | null,
    last: SyncFileStat | null,
    opts: { force?: boolean; tickCount: number },
): boolean {
    if (current == null) return false;
    if (opts.force) return true;
    if (last == null) return true;
    if (!statsEqual(current, last)) return true;
    return opts.tickCount % FORCE_READ_EVERY_N_TICKS === 0;
}

/** Parse + validate a sync payload. Never throws; a malformed file yields `{ ok: false }`. */
export function parseSyncPayload(content: string): ParsedSyncPayload {
    let data: unknown;
    try {
        data = JSON.parse(content);
    } catch {
        return { ok: false, reason: 'json' };
    }

    if (typeof data !== 'object' || data === null) {
        return { ok: false, reason: 'shape' };
    }
    const obj = data as Record<string, unknown>;

    if (obj.version !== 1 && obj.version !== 2) {
        return { ok: false, reason: 'version' };
    }
    if (!Array.isArray(obj.highlights)) {
        return { ok: false, reason: 'shape' };
    }

    return {
        ok: true,
        version: obj.version as SyncPayloadVersion,
        exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : null,
        writerId: typeof obj.writerId === 'string' ? obj.writerId : null,
        count: typeof obj.count === 'number' ? obj.count : obj.highlights.length,
        highlights: obj.highlights,
        tombstones: sanitizeTombstones(obj.tombstones),
        shelves: sanitizeShelves(obj.shelves),
        favorites: sanitizeStringList(obj.favorites),
        tags: sanitizeTagMap(obj.tags),
        bookMeta: normalizeBookMetaMap(obj.bookMeta),
        readingDays: normalizeReadingDays(obj.readingDays),
        shelfTombstones: sanitizeTombstones(obj.shelfTombstones),
        favoriteTombstones: sanitizeTombstones(obj.favoriteTombstones),
        tagTombstones: sanitizeTombstones(obj.tagTombstones),
        bookMetaTombstones: sanitizeTombstones(obj.bookMetaTombstones),
    };
}

/** Coerce an unknown field into a well-shaped tombstone list (lenient). */
function sanitizeTombstones(raw: unknown): SyncTombstone[] {
    if (!Array.isArray(raw)) return [];
    const out: SyncTombstone[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const t = item as Record<string, unknown>;
        if (typeof t.id !== 'string' || typeof t.deletedAt !== 'number') continue;
        out.push({ id: t.id, deletedAt: t.deletedAt });
    }
    return out;
}

/** Coerce an unknown field into a clean string list (dedup, drop blanks). */
function sanitizeStringList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out = new Set<string>();
    for (const item of raw) {
        if (typeof item === 'string' && item !== '') out.add(item);
    }
    return [...out];
}

/** Coerce an unknown field into a path -> tags map (drops junk entries). */
function sanitizeTagMap(raw: unknown): BookTagMap {
    const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: BookTagMap = {};
    for (const [path, list] of Object.entries(source)) {
        if (typeof path !== 'string' || path === '' || !Array.isArray(list)) continue;
        const tags = sanitizeStringList(list);
        if (tags.length > 0) out[path] = tags;
    }
    return out;
}

/** Coerce an unknown field into well-shaped shelf presets (drops junk). */
function sanitizeShelves(raw: unknown): ShelfPreset[] {
    if (!Array.isArray(raw)) return [];
    const out: ShelfPreset[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const s = item as Record<string, unknown>;
        if (typeof s.id !== 'string' || s.id === '') continue;
        if (typeof s.name !== 'string' || s.name.trim() === '') continue;
        const include = Array.isArray(s.include)
            ? s.include.filter((entry): entry is string | { path: string; recursive: boolean } =>
                typeof entry === 'string'
                || (typeof entry === 'object' && entry !== null && typeof (entry as { path?: unknown }).path === 'string'))
            : [];
        out.push({
            id: s.id,
            name: s.name.slice(0, 200),
            include,
            exclude: sanitizeStringList(s.exclude),
            // Position in the saved list (drag order); absent = legacy.
            order: typeof s.order === 'number' && Number.isFinite(s.order) ? s.order : undefined,
            updatedAt: typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : undefined,
        });
    }
    return out;
}

/** Validate incoming highlight rows; map unknown color ids back to the 'yellow' preset. */
export function sanitizeHighlights(list: unknown[], settings: HiLighterSettings): HighlightNote[] {
    const out: HighlightNote[] = [];
    for (const item of list) {
        if (typeof item !== 'object' || item === null) continue;
        const h = item as Record<string, unknown>;
        if (typeof h.id !== 'string' || typeof h.text !== 'string' || typeof h.color !== 'string') continue;
        const template = CARD_TEMPLATES.find(spec => spec.id === h.templateId);
        const legacyFields: Record<string, string[]> = {
            concept: ['definition', 'example', 'boundary'],
            claim: ['claim', 'evidence', 'counterexample'],
            question: ['question', 'answer', 'verify'],
            action: ['next', 'context'],
        };
        const legacy = typeof h.templateId === 'string' ? legacyFields[h.templateId] : undefined;
        const validFields = new Set([...(template?.fields.map(field => field.id) ?? []), ...(legacy ?? [])]);
        const rawFields = typeof h.cardFields === 'object' && h.cardFields !== null && !Array.isArray(h.cardFields)
            ? h.cardFields as Record<string, unknown> : {};
        const cardFields = Object.fromEntries(Object.entries(rawFields)
            .filter((entry): entry is [string, string] =>
                validFields.has(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 20_000));
        const sourceHighlightIds = Array.isArray(h.sourceHighlightIds)
            ? [...new Set(h.sourceHighlightIds.filter((id): id is string => typeof id === 'string' && id !== h.id && id.length <= 128))]
            : [];
        const rawLinks: unknown[] = Array.isArray(h.links) ? h.links as unknown[] : [];
        const links = [...new Map(rawLinks
            .filter((link): link is { targetId: string; relation: string } => {
                if (typeof link !== 'object' || link === null) return false;
                const candidate = link as Record<string, unknown>;
                return typeof candidate.targetId === 'string' && candidate.targetId !== h.id && candidate.targetId.length <= 128 &&
                    typeof candidate.relation === 'string' && candidate.relation.length <= 120;
            })
            .map(link => [link.targetId, { targetId: link.targetId, relation: link.relation }])).values()];
        out.push({
            ...(h as unknown as HighlightNote),
            color: isValidColorId(settings, h.color) ? h.color : 'yellow',
            kind: h.kind === 'idea' ? 'idea' : undefined,
            title: typeof h.title === 'string' ? h.title.slice(0, 300) : undefined,
            templateId: template?.id ?? (legacy ? h.templateId as CardTemplateId : h.templateId ? 'excerpt' : undefined),
            cardFields,
            sourceHighlightIds,
            links,
            updatedAt: typeof h.updatedAt === 'number' && Number.isFinite(h.updatedAt) ? h.updatedAt : undefined,
        });
    }
    return out;
}

/** Build the JSON payload written to the sync file. */
export function buildPayload(
    highlights: HighlightNote[],
    tombstones: SyncTombstone[],
    exportedAt: number,
    writerId: string,
    collections?: ShelfCollections,
): string {
    return JSON.stringify(
        {
            version: 2,
            exportedAt,
            writerId,
            count: highlights.length,
            highlights,
            tombstones,
            // Shelf collections ride along so they sync across devices/vaults.
            // Omitted entirely when there is nothing to carry (keeps old
            // payloads byte-identical and backward compatible).
            ...(collections && hasCollections(collections) ? collections : {}),
        },
        null,
        2,
    );
}

/** True when any shelf collection or tombstone is non-empty. */
function hasCollections(c: ShelfCollections): boolean {
    return c.shelves.length > 0 || c.favorites.length > 0 || Object.keys(c.tags).length > 0
        || Object.keys(c.bookMeta).length > 0 || Object.keys(c.readingDays).length > 0
        || c.shelfTombstones.length > 0 || c.favoriteTombstones.length > 0 || c.tagTombstones.length > 0
        || c.bookMetaTombstones.length > 0;
}

/** True when this payload was written by this plugin instance (no-op re-import). */
export function isOwnPayload(payload: ParsedSyncPayload, selfWriterId: string): boolean {
    return payload.ok && payload.writerId != null && payload.writerId === selfWriterId;
}
