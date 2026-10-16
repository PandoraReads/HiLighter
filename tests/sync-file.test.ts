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
