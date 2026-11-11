import { describe, it, expect } from 'vitest';
import {
    parseSyncPayload,
    sanitizeHighlights,
    buildPayload,
    normalizeSyncPath,
    statsEqual,
    shouldReadContent,
    isOwnPayload,
    FORCE_READ_EVERY_N_TICKS,
} from '../src/sync/sync-file';
import { DEFAULT_SETTINGS } from '../src/models';
import type { HiLighterSettings, HighlightNote } from '../src/models';

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

describe('parseSyncPayload', () => {
    it('accepts v1 and v2 payloads', () => {
        const v1 = JSON.stringify({ version: 1, highlights: [] });
        const v2 = JSON.stringify({ version: 2, highlights: [], exportedAt: 123, writerId: 'w' });
        expect(parseSyncPayload(v1).ok).toBe(true);
        const p2 = parseSyncPayload(v2);
        expect(p2.ok).toBe(true);
        if (p2.ok) {
            expect(p2.exportedAt).toBe(123);
            expect(p2.writerId).toBe('w');
        }
    });

    it('rejects malformed JSON, bad version, and missing highlights', () => {
        expect(parseSyncPayload('{oops')).toEqual({ ok: false, reason: 'json' });
        expect(parseSyncPayload('null')).toEqual({ ok: false, reason: 'shape' });
        expect(parseSyncPayload(JSON.stringify({ version: 3, highlights: [] }))).toEqual({ ok: false, reason: 'version' });
        expect(parseSyncPayload(JSON.stringify({ version: 2 }))).toEqual({ ok: false, reason: 'shape' });
    });

    it('coerces count and sanitizes tombstones leniently', () => {
        const raw = JSON.stringify({
            version: 2,
            highlights: [],
            tombstones: [{ id: 'x', deletedAt: 5 }, { id: 42 }, null, 'nope'],
        });
        const p = parseSyncPayload(raw);
        expect(p.ok).toBe(true);
        if (p.ok) {
            expect(p.count).toBe(0);
            expect(p.tombstones).toEqual([{ id: 'x', deletedAt: 5 }]);
        }
    });
});

describe('sanitizeHighlights', () => {
    const settings: HiLighterSettings = { ...DEFAULT_SETTINGS };

    it('preserves parent links when importing synced cards', () => {
        const [out] = sanitizeHighlights([note({ links: [{ targetId: 'parent', relation: 'hierarchy_parent' }] })], settings);
        expect(out?.links).toEqual([{ targetId: 'parent', relation: 'hierarchy_parent' }]);
    });
    it('preserves sibling order and its existing card relation during sync', () => {
        const [out] = sanitizeHighlights([note({ links: [{ targetId: 'other', relation: 'hierarchy_after:related' }] })], settings);
        expect(out?.links).toEqual([{ targetId: 'other', relation: 'hierarchy_after:related' }]);
    });

    it('drops rows missing required string fields', () => {
        const rows = [null, {}, { id: 1, text: 'a', color: 'b' }, { id: 'x', text: 'a' }, { id: 'x', color: 'a' }];
        expect(sanitizeHighlights(rows, settings)).toEqual([]);
    });

    it('maps unknown color ids to yellow and preserves valid ids', () => {
        const rows = [
            { id: 'a', text: 't', color: 'blue' },
            { id: 'b', text: 't', color: 'does-not-exist' },
        ];
        const out = sanitizeHighlights(rows, settings);
        expect(out.map(h => h.color)).toEqual(['blue', 'yellow']);
    });

    it('preserves extra fields (cfi, fsrs, tags, hex)', () => {
        const rows = [{ id: 'a', text: 't', color: 'yellow', cfi: 'epubcfi(/6)', fsrs: { due: 1 } }];
        const [out] = sanitizeHighlights(rows, settings);
        expect(out!.cfi).toBe('epubcfi(/6)');
        expect(out!.fsrs).toEqual({ due: 1 });
    });

    it('normalizes template, idea, and link data from untrusted sync files', () => {
        const [valid, invalid] = sanitizeHighlights([
            { id: 'a', text: '', color: 'yellow', kind: 'idea', title: 'Thought', templateId: 'claim',
                cardFields: { claim: 'Mine', bad: 42 }, sourceHighlightIds: ['b', 3],
                links: [{ targetId: 'b', relation: 'supports' }, { targetId: 'a', relation: 'self' }, { targetId: 3 }] },
            { id: 'c', text: 'quote', color: 'yellow', kind: 'oops', templateId: 'malicious', links: 'bad' },
        ], settings);
        expect(valid?.kind).toBe('idea');
        expect(valid?.cardFields).toEqual({ claim: 'Mine' });
        expect(valid?.sourceHighlightIds).toEqual(['b']);
        expect(valid?.links).toEqual([{ targetId: 'b', relation: 'supports' }]);
        expect(invalid?.kind).toBeUndefined();
        expect(invalid?.templateId).toBe('excerpt');
        expect(invalid?.links).toEqual([]);
    });
});

describe('buildPayload', () => {
    it('writes version 2 with count, highlights, and tombstones', () => {
        const json = buildPayload([note({ id: 'a' })], [{ id: 'b', deletedAt: 9 }], 100, 'w1');
        const parsed = JSON.parse(json) as Record<string, unknown>;
        expect(parsed.version).toBe(2);
        expect(parsed.exportedAt).toBe(100);
        expect(parsed.writerId).toBe('w1');
        expect(parsed.count).toBe(1);
        expect(parsed.tombstones).toEqual([{ id: 'b', deletedAt: 9 }]);
    });
});

describe('statsEqual', () => {
    it('compares mtime and size with !== semantics', () => {
        expect(statsEqual({ mtime: 1, size: 2 }, { mtime: 1, size: 2 })).toBe(true);
        expect(statsEqual({ mtime: 1, size: 2 }, { mtime: 0, size: 2 })).toBe(false);
        expect(statsEqual({ mtime: 1, size: 2 }, { mtime: 1, size: 3 })).toBe(false);
        expect(statsEqual(null, null)).toBe(true);
        expect(statsEqual(null, { mtime: 1, size: 2 })).toBe(false);
    });
});

describe('shouldReadContent', () => {
    it('reads on force, unknown last, change, and periodic tick', () => {
        const cur = { mtime: 5, size: 10 };
        expect(shouldReadContent(cur, null, { tickCount: 1 })).toBe(true);
        expect(shouldReadContent(cur, { mtime: 5, size: 10 }, { force: true, tickCount: 1 })).toBe(true);
        expect(shouldReadContent(cur, { mtime: 4, size: 10 }, { tickCount: 1 })).toBe(true);
        expect(shouldReadContent(cur, { mtime: 5, size: 10 }, { tickCount: 1 })).toBe(false);
        expect(shouldReadContent(cur, { mtime: 5, size: 10 }, { tickCount: FORCE_READ_EVERY_N_TICKS })).toBe(true);
    });

    it('never reads when the file is missing', () => {
        expect(shouldReadContent(null, null, { force: true, tickCount: 1 })).toBe(false);
    });
});

describe('isOwnPayload', () => {
    it('matches on writerId only', () => {
        const own = parseSyncPayload(JSON.stringify({ version: 2, highlights: [], writerId: 'me' }));
        const other = parseSyncPayload(JSON.stringify({ version: 2, highlights: [], writerId: 'you' }));
        const legacy = parseSyncPayload(JSON.stringify({ version: 2, highlights: [] }));
        expect(isOwnPayload(own, 'me')).toBe(true);
        expect(isOwnPayload(other, 'me')).toBe(false);
        expect(isOwnPayload(legacy, 'me')).toBe(false);
    });
});

describe('normalizeSyncPath', () => {
    it('normalizes slashes and falls back to the default', () => {
        expect(normalizeSyncPath('.hilighter/sync-data.json')).toBe('.hilighter/sync-data.json');
        expect(normalizeSyncPath('/foo/bar.json')).toBe('foo/bar.json');
        expect(normalizeSyncPath('foo\\bar.json')).toBe('foo/bar.json');
        expect(normalizeSyncPath('///')).toBe('.hilighter/sync-data.json');
        expect(normalizeSyncPath('')).toBe('.hilighter/sync-data.json');
    });
});

describe('shelf collections in the payload', () => {
    const collections = {
        shelves: [{ id: 's1', name: '英文', include: [{ path: 'books', recursive: true }], exclude: ['books/tmp'], updatedAt: 5 }],
        favorites: ['a.epub'],
        tags: { 'a.epub': ['x'] },
        bookMeta: { 'a.epub': { progress: 42, updatedAt: 9 } },
        readingDays: { '2026-11-11': 2 },
        shelfTombstones: [],
        favoriteTombstones: [{ id: 'b.epub', deletedAt: 7 }],
        tagTombstones: [],
        bookMetaTombstones: [{ id: 'c.epub', deletedAt: 8 }],
    };

    it('round-trips shelves / favorites / tags through build + parse', () => {
        const raw = buildPayload([note()], [], 1, 'me', collections);
        const parsed = parseSyncPayload(raw);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.shelves).toEqual(collections.shelves);
        expect(parsed.favorites).toEqual(['a.epub']);
        expect(parsed.tags).toEqual({ 'a.epub': ['x'] });
        expect(parsed.favoriteTombstones).toEqual([{ id: 'b.epub', deletedAt: 7 }]);
    });

    it('round-trips book metadata, reading days and their tombstones', () => {
        const raw = buildPayload([note()], [], 1, 'me', collections);
        const parsed = parseSyncPayload(raw);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.bookMeta).toEqual({ 'a.epub': { progress: 42, updatedAt: 9 } });
        expect(parsed.readingDays).toEqual({ '2026-11-11': 2 });
        expect(parsed.bookMetaTombstones).toEqual([{ id: 'c.epub', deletedAt: 8 }]);
    });

    it('sanitizes junk book metadata and reading-day entries on parse', () => {
        const raw = JSON.stringify({
            version: 2,
            highlights: [note()],
            bookMeta: {
                'ok.epub': { progress: 7, updatedAt: 1 },
                'bad-progress.epub': { progress: 140, updatedAt: 1 },
                'no-stamp.epub': { progress: 7 },
                '': { progress: 7, updatedAt: 1 },
            },
            readingDays: { '2026-11-11': 3, 'not-a-day': 1, '2026-11-10': 0 },
        });
        const parsed = parseSyncPayload(raw);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.bookMeta).toEqual({ 'ok.epub': { progress: 7, updatedAt: 1 } });
        expect(parsed.readingDays).toEqual({ '2026-11-11': 3 });
    });

    it('omits collection fields entirely when there is nothing to carry', () => {
        const raw = buildPayload([note()], [], 1, 'me');
        expect(raw).not.toContain('shelves');
        const parsed = parseSyncPayload(raw);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.shelves).toEqual([]);
        expect(parsed.favorites).toEqual([]);
        expect(parsed.tags).toEqual({});
    });

    it('an old payload without collections parses to empty ones', () => {
        const parsed = parseSyncPayload(JSON.stringify({ version: 2, highlights: [] }));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.shelves).toEqual([]);
        expect(parsed.tagTombstones).toEqual([]);
    });

    it('drops malformed shelf entries but keeps valid ones', () => {
        const raw = JSON.stringify({
            version: 2,
            highlights: [],
            shelves: [{ id: '', name: 'x' }, { name: 'no-id' }, { id: 'ok', name: 'ok', include: 'junk', exclude: [1, 'e'] }],
        });
        const parsed = parseSyncPayload(raw);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.shelves).toEqual([{ id: 'ok', name: 'ok', include: [], exclude: ['e'], updatedAt: undefined }]);
    });
});
