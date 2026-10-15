// ============================================================
// HiLighter - IndexedDB Service (Dexie wrapper)
// ============================================================

import Dexie, { type Table } from 'dexie';
import type { FsrsState, HighlightNote } from './models';

/** Whichever fsrs state was reviewed more recently wins (fallback: more reps). */
function pickNewerFsrs(local?: FsrsState, incoming?: FsrsState): FsrsState | undefined {
    if (local && incoming) {
        const la = local.lastReview ?? 0;
        const ia = incoming.lastReview ?? 0;
        if (la !== ia) return la > ia ? local : incoming;
        return incoming.reps >= local.reps ? incoming : local;
    }
    return incoming ?? local;
}

function fsrsDiffers(a?: FsrsState, b?: FsrsState): boolean {
    if ((a == null) !== (b == null)) return true;
    if (a == null || b == null) return false;
    return a.due !== b.due || a.reps !== b.reps || a.lapses !== b.lapses || a.lastReview !== b.lastReview;
}

export class HiLighterDatabase extends Dexie {
    highlightNotes!: Table<HighlightNote, string>;

    constructor(dbName: string) {
        super(dbName);

        // v3: fsrs.due nested index for due-card queries. Records without an
        // fsrs state simply sit outside the index (= new-card semantics).
        // Additive only: no upgrade function needed; old rows load unchanged.
        this.version(2).stores({
            highlightNotes: 'id, sourcePath, createdAt',
        });
        this.version(3).stores({
            highlightNotes: 'id, sourcePath, createdAt, fsrs.due',
        });
    }

    // ──── Highlight Note CRUD ──────────────────────────────────

    async addHighlightNote(note: HighlightNote): Promise<void> {
        await this.highlightNotes.put(note);
    }

    async getHighlightNote(id: string): Promise<HighlightNote | undefined> {
        return this.highlightNotes.get(id);
    }

    async getHighlightsByPath(path: string): Promise<HighlightNote[]> {
        return await this.highlightNotes.where('sourcePath').equals(path).toArray();
    }

    async getAllHighlights(): Promise<HighlightNote[]> {
        return await this.highlightNotes.orderBy('createdAt').reverse().toArray();
    }

    /** Scheduled cards whose due time has arrived (excludes new cards). */
    async getDueHighlights(nowMs: number = Date.now()): Promise<HighlightNote[]> {
        return await this.highlightNotes
            .where('fsrs.due')
            .belowOrEqual(nowMs)
            .toArray();
    }

    /** Cards that have never been reviewed (no fsrs state). */
    async getHighlightsWithoutFsrs(): Promise<HighlightNote[]> {
        const all = await this.getAllHighlights();
        return all.filter(h => h.fsrs == null);
    }

    /** Clears scheduling progress for every card (settings danger action). */
    async resetAllFsrs(): Promise<number> {
        const all = await this.getAllHighlights();
        let cleared = 0;
        for (const h of all) {
            if (h.fsrs == null) continue;
            await this.highlightNotes.update(h.id, { fsrs: undefined });
            cleared++;
        }
        return cleared;
    }

    async updateHighlightNote(id: string, changes: Partial<HighlightNote>): Promise<void> {
        await this.highlightNotes.update(id, changes);
    }

    async deleteHighlightNote(id: string): Promise<void> {
        await this.highlightNotes.delete(id);
    }

    async updateHighlightPaths(oldPath: string, newPath: string): Promise<void> {
        const isFolder = !oldPath.endsWith('.md');

        if (isFolder) {
            const prefix = oldPath + '/';
            const newPrefix = newPath + '/';

            const highlights = await this.highlightNotes
                .where('sourcePath')
                .startsWith(prefix)
                .toArray();

            for (const h of highlights) {
                const updatedPath = h.sourcePath.replace(prefix, newPrefix);
                await this.highlightNotes.update(h.id, { sourcePath: updatedPath });
            }
        } else {
            const highlights = await this.highlightNotes
                .where('sourcePath')
                .equals(oldPath)
                .toArray();

            for (const h of highlights) {
                await this.highlightNotes.update(h.id, { sourcePath: newPath });
            }
        }
    }

    async upsertHighlights(notes: HighlightNote[]): Promise<{ added: number; updated: number; skipped: number }> {
        // Deduplicate by ID (last occurrence wins)
        const unique = [...new Map(notes.map(n => [n.id, n])).values()];
        const ids = unique.map(n => n.id);
        const existing: (HighlightNote | undefined)[] = await this.highlightNotes.bulkGet(ids);

        let added = 0;
        let updated = 0;
        let skipped = 0;
        const toPut: HighlightNote[] = [];

        for (let i = 0; i < unique.length; i++) {
            const note = unique[i]!;
            const ex = existing[i];
            if (ex) {
                const changed = ex.text !== note.text ||
                    ex.note !== note.note ||
                    ex.color !== note.color ||
                    ex.sourcePath !== note.sourcePath ||
                    fsrsDiffers(ex.fsrs, note.fsrs);
                if (changed) {
                    // Merge: keep local note/tags if incoming is empty; resolve
                    // fsrs by the newer lastReview (fall back to reps).
                    const merged: HighlightNote = {
                        ...note,
                        note: note.note || ex.note,
                        tags: [...new Set([...(ex.tags || []), ...(note.tags || [])])],
                        fsrs: pickNewerFsrs(ex.fsrs, note.fsrs),
                    };
                    toPut.push(merged);
                    updated++;
                } else {
                    skipped++;
                }
            } else {
                toPut.push(note);
                added++;
            }
        }
        if (toPut.length > 0) {
            await this.highlightNotes.bulkPut(toPut);
        }
        return { added, updated, skipped };
    }
}

// Derive a short, safe suffix from the vault path for DB isolation
function vaultDbName(vaultPath: string): string {
    // Use a hash-like suffix from the vault path to keep the name short
    let hash = 0;
    for (let i = 0; i < vaultPath.length; i++) {
        hash = ((hash << 5) - hash + vaultPath.charCodeAt(i)) | 0;
    }
    // Convert to positive hex string
    const suffix = (hash >>> 0).toString(36);
    return `HiLighterDB_${suffix}`;
}

// Lazy singleton - initialized per vault
let _db: HiLighterDatabase | null = null;

export function initDb(vaultPath: string): HiLighterDatabase {
    const name = vaultDbName(vaultPath);
    if (_db && _db.name === name) return _db;
    _db = new HiLighterDatabase(name);
    return _db;
}

export function getDb(): HiLighterDatabase {
    if (!_db) throw new Error('Database not initialized. Call initDb(vaultPath) first.');
    return _db;
}

// Backward-compatible alias for existing imports
export const db = new Proxy({} as HiLighterDatabase, {
    get(_target, prop, _receiver) {
        if (!_db) throw new Error('Database not initialized. Call initDb(vaultPath) first.');
        return (_db as unknown as Record<string | symbol, unknown>)[prop];
    }
});
