// ============================================================
// HiLighter - IndexedDB Service (Dexie wrapper)
// ============================================================

import Dexie, { type Table } from 'dexie';
import type { EpubLocations, HighlightNote, MindMapDoc, SyncTombstone } from './models';
import {
    planMerge,
    dedupeById,
    shouldPruneTombstone,
    TOMBSTONE_TTL_MS,
} from './sync/merge';
import { cardSearchText } from './card-templates';
import { planCardMoves } from './studio/card-hierarchy';

export class HiLighterDatabase extends Dexie {
    highlightNotes!: Table<HighlightNote, string>;
    syncTombstones!: Table<SyncTombstone, string>;
    mindmaps!: Table<MindMapDoc, string>;
    epubLocations!: Table<EpubLocations, string>;

    private changeSeq = 0;
    private changeListeners = new Set<() => void>();

    constructor(dbName: string) {
        super(dbName);

        // v3: fsrs.due nested index for due-card queries. Records without an
        // fsrs state simply sit outside the index (= new-card semantics).
        // v4: syncTombstones tracks deleted ids so deletes survive auto-import.
        // v5: mindmaps table for saved mind map documents (additive only).
        // v6: epubLocations caches generated epub page CFIs per book (additive).
        // All additive: no upgrade function needed; old rows load unchanged.
        this.version(2).stores({
            highlightNotes: 'id, sourcePath, createdAt',
        });
        this.version(3).stores({
            highlightNotes: 'id, sourcePath, createdAt, fsrs.due',
        });
        this.version(4).stores({
            highlightNotes: 'id, sourcePath, createdAt, fsrs.due',
            syncTombstones: 'id, deletedAt',
        });
        this.version(5).stores({
            highlightNotes: 'id, sourcePath, createdAt, fsrs.due',
            syncTombstones: 'id, deletedAt',
            mindmaps: 'id, sourcePath, updatedAt',
        });
        this.version(6).stores({
            highlightNotes: 'id, sourcePath, createdAt, fsrs.due',
            syncTombstones: 'id, deletedAt',
            mindmaps: 'id, sourcePath, updatedAt',
            epubLocations: 'path',
        });
    }

    // ──── Change notification (post-commit, proxy-safe arrow fields) ────

    /** Subscribe to local writes. Returns an unsubscribe function. */
    onChange = (cb: () => void): (() => void) => {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    };

    /** Monotonic counter of local writes (drives the controller's dirty flag). */
    getChangeSeq = (): number => this.changeSeq;

    private notify = (): void => {
        this.changeSeq++;
        for (const cb of this.changeListeners) {
            try {
                cb();
            } catch (e) {
                console.error('[HiLighter] db change listener failed', e);
            }
        }
    };

    // ──── Highlight Note CRUD ──────────────────────────────────

    async addHighlightNote(note: HighlightNote): Promise<void> {
        await this.highlightNotes.put(note);
        this.notify();
    }

    async getHighlightNote(id: string): Promise<HighlightNote | undefined> {
        return this.highlightNotes.get(id);
    }

    async getHighlightsByPath(path: string): Promise<HighlightNote[]> {
        return (await this.highlightNotes.where('sourcePath').equals(path).toArray())
            .filter(note => note.kind !== 'idea');
    }

    async getAllHighlights(): Promise<HighlightNote[]> {
        return await this.highlightNotes.orderBy('createdAt').reverse().toArray();
    }

    /** Recent sidebar page. The existing createdAt index supplies newest-first order. */
    async getRecentHighlightsPage(
        offset: number,
        limit: number,
        filters: { search?: string; color?: string } = {},
    ): Promise<{ notes: HighlightNote[]; hasMore: boolean }> {
        const safeOffset = Math.max(0, Math.floor(offset));
        const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
        const search = (filters.search || '').trim().toLowerCase();
        const color = filters.color || 'all';
        let collection = this.highlightNotes.orderBy('createdAt').reverse();

        if (search || color !== 'all') {
            collection = collection.filter(note => {
                if (color !== 'all' && note.color !== color) return false;
                return !search || cardSearchText(note).includes(search);
            });
        }

        const page = await collection.offset(safeOffset).limit(safeLimit + 1).toArray();
        return { notes: page.slice(0, safeLimit), hasMore: page.length > safeLimit };
    }

    async countHighlights(): Promise<number> {
        return this.highlightNotes.count();
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
        if (cleared > 0) this.notify();
        return cleared;
    }

    async updateHighlightNote(id: string, changes: Partial<HighlightNote>): Promise<void> {
        const contentKeys: Array<keyof HighlightNote> = [
            'text', 'note', 'color', 'tags', 'title', 'templateId', 'cardFields', 'links', 'sourceHighlightIds',
        ];
        const contentChanged = contentKeys.some(key => Object.prototype.hasOwnProperty.call(changes, key));
        await this.highlightNotes.update(id, contentChanged
            ? { ...changes, updatedAt: changes.updatedAt ?? Date.now() }
            : changes);
        this.notify();
    }

    async moveCardHierarchy(ids: readonly string[], targetId: string | null, placement: 'child' | 'after' = 'child'): Promise<number> {
        const count = await this.transaction('rw', this.highlightNotes, async () => {
            const cards = await this.highlightNotes.toArray();
            const changes = planCardMoves(cards, ids, targetId, placement);
            const updatedAt = Date.now();
            for (const change of changes) {
                const updated = await this.highlightNotes.update(change.id, { links: change.links, updatedAt });
                if (updated !== 1) throw new Error('Card not found');
            }
            return changes.filter(change => ids.includes(change.id)).length;
        });
        if (count) this.notify();
        return count;
    }

    /** Delete a highlight and record a tombstone so auto-import cannot resurrect it. */
    async deleteHighlightNote(id: string): Promise<void> {
        await this.transaction('rw', this.highlightNotes, this.syncTombstones, async () => {
            await this.highlightNotes.delete(id);
            await this.syncTombstones.put({ id, deletedAt: Date.now() });
        });
        this.notify();
    }

    /** Cached epub page-location CFIs (no change notification: no UI depends on it). */
    async getEpubLocations(path: string): Promise<EpubLocations | undefined> {
        return this.epubLocations.get(path);
    }

    async saveEpubLocations(entry: EpubLocations): Promise<void> {
        await this.epubLocations.put(entry);
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
        this.notify();
    }

    async upsertHighlights(notes: HighlightNote[]): Promise<{ added: number; updated: number; skipped: number }> {
        return this.transaction('rw', this.highlightNotes, this.syncTombstones, async () => {
            const unique = dedupeById(notes);
            const ids = unique.map(n => n.id);
            const existing = await this.highlightNotes.bulkGet(ids);
            const tombstones = await this.liveTombstoneMap();

            const plan = planMerge(unique, existing, tombstones, Date.now());
            if (plan.toPut.length > 0) {
                await this.highlightNotes.bulkPut(plan.toPut);
                this.notify();
            }
            return { added: plan.added, updated: plan.updated, skipped: plan.skipped };
        });
    }

    // ── Mind Map documents ────────────────────────────────────
    // Mind map saves are view-local writes; they don't touch the highlight
    // change counter (no sidebar refresh needed) but notify anyway so the
    // mind map view's doc list stays in sync across open leaves.

    async listMindMaps(): Promise<MindMapDoc[]> {
        return this.mindmaps.orderBy('updatedAt').reverse().toArray();
    }

    async getMindMap(id: string): Promise<MindMapDoc | undefined> {
        return this.mindmaps.get(id);
    }

    async putMindMap(doc: MindMapDoc): Promise<void> {
        await this.mindmaps.put(doc);
        this.notify();
    }

    async deleteMindMap(id: string): Promise<void> {
        await this.mindmaps.delete(id);
        this.notify();
    }

    // ──── Tombstones ──────────────────────────────────────────

    async getTombstones(): Promise<SyncTombstone[]> {
        return this.syncTombstones.toArray();
    }

    /** Remove tombstones past the TTL; returns how many were pruned. */
    async pruneTombstones(now: number = Date.now()): Promise<number> {
        const all = await this.syncTombstones.toArray();
        const expired = all.filter(t => shouldPruneTombstone(t.deletedAt, now, TOMBSTONE_TTL_MS));
        if (expired.length > 0) {
            await this.syncTombstones.bulkDelete(expired.map(t => t.id));
        }
        return expired.length;
    }

    /**
     * Merge remote tombstones in (keep the newer deletedAt), deleting any local
     * rows they mark. Used by the import path so deletes propagate both ways.
     */
    async applyRemoteTombstones(remote: SyncTombstone[]): Promise<void> {
        if (remote.length === 0) return;
        await this.transaction('rw', this.highlightNotes, this.syncTombstones, async () => {
            const existing = await this.syncTombstones.bulkGet(remote.map(t => t.id));
            let changed = false;
            for (let i = 0; i < remote.length; i++) {
                const incoming = remote[i]!;
                const local = existing[i];
                if (!local || local.deletedAt < incoming.deletedAt) {
                    await this.syncTombstones.put({ id: incoming.id, deletedAt: incoming.deletedAt });
                    changed = true;
                }
                await this.highlightNotes.delete(incoming.id);
            }
            if (changed) this.notify();
        });
    }

    private async liveTombstoneMap(): Promise<Map<string, number>> {
        const all = await this.syncTombstones.toArray();
        const now = Date.now();
        const map = new Map<string, number>();
        for (const t of all) {
            if (!shouldPruneTombstone(t.deletedAt, now, TOMBSTONE_TTL_MS)) {
                map.set(t.id, t.deletedAt);
            }
        }
        return map;
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
