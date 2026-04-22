// ============================================================
// HiLighter - IndexedDB Service (Dexie wrapper)
// ============================================================

import Dexie, { type Table } from 'dexie';
import type { HighlightNote } from './models';

export class HiLighterDatabase extends Dexie {
    highlightNotes!: Table<HighlightNote, string>;

    constructor(dbName: string) {
        super(dbName);

        this.version(2).stores({
            highlightNotes: 'id, sourcePath, createdAt',
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
        return (_db as any)[prop];
    }
});
