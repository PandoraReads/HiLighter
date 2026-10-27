// ============================================================
// HiLighter - Sync merge planner (pure, no Obsidian/DOM)
// ============================================================

import type { FsrsState, HighlightNote } from '../models';

/** Tombstones older than this no longer suppress a deleted row. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Whichever fsrs state was reviewed more recently wins (fallback: more reps). */
export function pickNewerFsrs(local?: FsrsState, incoming?: FsrsState): FsrsState | undefined {
    if (local && incoming) {
        const la = local.lastReview ?? 0;
        const ia = incoming.lastReview ?? 0;
        if (la !== ia) return la > ia ? local : incoming;
        return incoming.reps >= local.reps ? incoming : local;
    }
    return incoming ?? local;
}

export function fsrsDiffers(a?: FsrsState, b?: FsrsState): boolean {
    if ((a == null) !== (b == null)) return true;
    if (a == null || b == null) return false;
    return a.due !== b.due || a.reps !== b.reps || a.lapses !== b.lapses || a.lastReview !== b.lastReview;
}

/** Deduplicate by id (last occurrence wins), preserving the caller's bulkGet alignment. */
export function dedupeById(notes: HighlightNote[]): HighlightNote[] {
    return [...new Map(notes.map(n => [n.id, n])).values()];
}

export function shouldPruneTombstone(deletedAt: number, now: number, ttl: number): boolean {
    return now - deletedAt >= ttl;
}

export function isLiveTombstone(deletedAt: number | undefined, now: number, ttl: number): boolean {
    return deletedAt != null && now - deletedAt < ttl;
}

export interface MergePlan {
    toPut: HighlightNote[];
    added: number;
    updated: number;
    skipped: number;
    suppressedByTombstone: number;
}

/**
 * Compute the merge of incoming rows against existing local rows.
 * `existing[i]` must align with `incoming[i]` (deduped + bulkGet'd by the caller).
 * Add/update only; rows with a live tombstone are suppressed so deletes never resurrect.
 */
export function planMerge(
    incoming: HighlightNote[],
    existing: (HighlightNote | undefined)[],
    tombstones: ReadonlyMap<string, number>,
    now: number,
): MergePlan {
    const toPut: HighlightNote[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let suppressedByTombstone = 0;

    for (let i = 0; i < incoming.length; i++) {
        const note = incoming[i]!;
        if (isLiveTombstone(tombstones.get(note.id), now, TOMBSTONE_TTL_MS)) {
            suppressedByTombstone++;
            continue;
        }

        const ex = existing[i];
        if (ex) {
            const cardChanged = ex.kind !== note.kind || ex.title !== note.title ||
                ex.templateId !== note.templateId || ex.updatedAt !== note.updatedAt ||
                JSON.stringify(ex.cardFields ?? {}) !== JSON.stringify(note.cardFields ?? {}) ||
                JSON.stringify(ex.sourceHighlightIds ?? []) !== JSON.stringify(note.sourceHighlightIds ?? []) ||
                JSON.stringify(ex.links ?? []) !== JSON.stringify(note.links ?? []);
            const changed = ex.text !== note.text ||
                ex.note !== note.note ||
                ex.color !== note.color ||
                ex.sourcePath !== note.sourcePath ||
                JSON.stringify(ex.tags ?? []) !== JSON.stringify(note.tags ?? []) ||
                fsrsDiffers(ex.fsrs, note.fsrs) || cardChanged;
            if (changed) {
                // Card edits are resolved as a unit so links and fields cannot
                // be overwritten by an older sync file. Legacy rows keep the
                // historical incoming-wins behavior when timestamps tie.
                const newer = (ex.updatedAt ?? 0) > (note.updatedAt ?? 0) ? ex : note;
                toPut.push({
                    ...newer,
                    note: newer.note || (newer === note ? ex.note : note.note),
                    tags: [...new Set([...(ex.tags || []), ...(note.tags || [])])],
                    fsrs: pickNewerFsrs(ex.fsrs, note.fsrs),
                });
                updated++;
            } else {
                skipped++;
            }
        } else {
            toPut.push(note);
            added++;
        }
    }

    return { toPut, added, updated, skipped, suppressedByTombstone };
}
