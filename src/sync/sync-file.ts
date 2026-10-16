// ============================================================
// HiLighter - Sync file payload helpers (pure, no Obsidian/DOM)
// ============================================================

import { isValidColorId } from '../colors';
import type { HiLighterSettings, HighlightNote, SyncTombstone } from '../models';

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

/** Validate incoming highlight rows; map unknown color ids back to the 'yellow' preset. */
export function sanitizeHighlights(list: unknown[], settings: HiLighterSettings): HighlightNote[] {
    const out: HighlightNote[] = [];
    for (const item of list) {
        if (typeof item !== 'object' || item === null) continue;
        const h = item as Record<string, unknown>;
        if (typeof h.id !== 'string' || typeof h.text !== 'string' || typeof h.color !== 'string') continue;
        out.push({
            ...(h as unknown as HighlightNote),
            color: isValidColorId(settings, h.color) ? h.color : 'yellow',
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
): string {
    return JSON.stringify(
        {
            version: 2,
            exportedAt,
            writerId,
            count: highlights.length,
            highlights,
            tombstones,
        },
        null,
        2,
    );
}

/** True when this payload was written by this plugin instance (no-op re-import). */
export function isOwnPayload(payload: ParsedSyncPayload, selfWriterId: string): boolean {
    return payload.ok && payload.writerId != null && payload.writerId === selfWriterId;
}
