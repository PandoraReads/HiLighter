import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HiLighterDatabase } from '../src/db';
import { TOMBSTONE_TTL_MS } from '../src/sync/merge';
import type { HighlightNote } from '../src/models';

let seq = 0;

function note(overrides: Partial<HighlightNote> = {}): HighlightNote {
    return {
        id: 'id-1',
        text: 'text',
        color: 'yellow',
        note: '',
        sourcePath: 'a.md',
        lineIndex: 0,
        createdAt: 1,
        ...overrides,
    };
}

function newDb(): HiLighterDatabase {
    return new HiLighterDatabase(`hilighter-test-${seq++}`);
}

beforeEach(() => {
    // fake-indexeddb keeps DBs per process; unique names above isolate each test.
});

describe('HiLighterDatabase upsert + merge', () => {
    it('adds, updates, and skips across one transaction', async () => {
        const db = newDb();
        await db.addHighlightNote(note({ id: 'a', text: 'old' }));

        const res = await db.upsertHighlights([
            note({ id: 'a', text: 'new' }),
            note({ id: 'b', text: 'x' }),
            note({ id: 'a', text: 'new' }), // duplicate, last wins
        ]);

        expect(res).toEqual({ added: 1, updated: 1, skipped: 0 });
        expect((await db.getHighlightNote('a'))!.text).toBe('new');
        expect(await db.getHighlightNote('b')).toBeDefined();
        await db.delete();
    });
});

describe('HiLighterDatabase recent sidebar pages', () => {
    it('returns 50 newest cards first and continues from the next page', async () => {
        const db = newDb();
        const records = Array.from({ length: 123 }, (_, index) => note({
            id: `recent-${index}`,
            createdAt: index + 1,
        }));
        await db.highlightNotes.bulkPut(records);

        const first = await db.getRecentHighlightsPage(0, 50);
        const second = await db.getRecentHighlightsPage(50, 50);
        const last = await db.getRecentHighlightsPage(100, 50);

        expect(first.notes).toHaveLength(50);
        expect(first.notes[0]?.id).toBe('recent-122');
        expect(first.notes[49]?.id).toBe('recent-73');
        expect(first.hasMore).toBe(true);
        expect(second.notes[0]?.id).toBe('recent-72');
        expect(second.hasMore).toBe(true);
        expect(last.notes).toHaveLength(23);
        expect(last.notes[0]?.id).toBe('recent-22');
        expect(last.hasMore).toBe(false);
        await db.delete();
    });

    it('applies search and color before paging without loading all matches', async () => {
        const db = newDb();
        await db.highlightNotes.bulkPut([
            note({ id: 'old-match', createdAt: 1, text: 'Context', color: 'blue' }),
            note({ id: 'other-color', createdAt: 2, note: 'context', color: 'yellow' }),
            note({ id: 'new-match', createdAt: 3, note: 'CONTEXT', color: 'blue' }),
            note({ id: 'newest', createdAt: 4, text: 'unrelated', color: 'blue' }),
        ]);

        const first = await db.getRecentHighlightsPage(0, 1, { search: 'context', color: 'blue' });
        const second = await db.getRecentHighlightsPage(1, 1, { search: 'context', color: 'blue' });

        expect(first.notes.map(item => item.id)).toEqual(['new-match']);
        expect(first.hasMore).toBe(true);
        expect(second.notes.map(item => item.id)).toEqual(['old-match']);
        expect(second.hasMore).toBe(false);
        await db.delete();
    });
});

describe('HiLighterDatabase tombstones', () => {
    it('records a tombstone on delete and suppresses resurrection', async () => {
        const db = newDb();
        await db.addHighlightNote(note({ id: 'gone' }));
        await db.deleteHighlightNote('gone');

        const tombstones = await db.getTombstones();
        expect(tombstones).toHaveLength(1);
        expect(tombstones[0]!.id).toBe('gone');

        const res = await db.upsertHighlights([note({ id: 'gone', text: 'resurrected' })]);
        expect(res).toEqual({ added: 0, updated: 0, skipped: 0 });
        expect(await db.getHighlightNote('gone')).toBeUndefined();
        await db.delete();
    });

    it('applies remote tombstones by deleting local rows and keeping the newer timestamp', async () => {
        const db = newDb();
        await db.addHighlightNote(note({ id: 'x' }));

        await db.applyRemoteTombstones([{ id: 'x', deletedAt: 100 }]);
        expect(await db.getHighlightNote('x')).toBeUndefined();
        expect(await db.getTombstones()).toEqual([{ id: 'x', deletedAt: 100 }]);

        // An older remote tombstone must not clobber a newer local one.
        await db.applyRemoteTombstones([{ id: 'x', deletedAt: 50 }]);
        expect(await db.getTombstones()).toEqual([{ id: 'x', deletedAt: 100 }]);
        await db.delete();
    });

    it('prunes tombstones past the TTL', async () => {
        const db = newDb();
        await db.addHighlightNote(note({ id: 'old' }));
        await db.deleteHighlightNote('old');

        const now = Date.now() + TOMBSTONE_TTL_MS + 1000;
        expect(await db.pruneTombstones(now)).toBe(1);
        expect(await db.getTombstones()).toEqual([]);
        await db.delete();
    });
});

describe('HiLighterDatabase change emitter', () => {
    it('notifies after local writes and increments the change sequence', async () => {
        const db = newDb();
        const cb = vi.fn();
        const off = db.onChange(cb);

        await db.addHighlightNote(note({ id: '1' }));
        expect(cb).toHaveBeenCalledTimes(1);
        expect(db.getChangeSeq()).toBe(1);

        await db.updateHighlightNote('1', { note: 'n' });
        expect(cb).toHaveBeenCalledTimes(2);
        expect(db.getChangeSeq()).toBe(2);

        off();
        await db.deleteHighlightNote('1');
        expect(cb).toHaveBeenCalledTimes(2);
        await db.delete();
    });
});
