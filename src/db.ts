// ============================================================
// HiLighter - IndexedDB Service (Dexie wrapper)
// ============================================================

import Dexie, { type Table } from 'dexie';
import type { HighlightNote } from './models';

export class EMEDatabase extends Dexie {
    highlightNotes!: Table<HighlightNote, string>;

    constructor() {
        super('HiLighterDB');

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
        return this.highlightNotes.where('sourcePath').equals(path).toArray();
    }

    async getAllHighlights(): Promise<HighlightNote[]> {
        return this.highlightNotes.orderBy('createdAt').reverse().toArray();
    }

    async updateHighlightNote(id: string, changes: Partial<HighlightNote>): Promise<void> {
        await this.highlightNotes.update(id, changes);
    }

    async deleteHighlightNote(id: string): Promise<void> {
        await this.highlightNotes.delete(id);
    }

    async updateHighlightPaths(oldPath: string, newPath: string): Promise<void> {
        // Handle both file rename and folder rename
        // If it's a folder, all files inside will have paths starting with oldPath/
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
            // Single file rename
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

// Singleton
export const db = new EMEDatabase();
