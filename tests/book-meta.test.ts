import { describe, expect, it } from 'vitest';
import {
    applyProgressTo,
    bumpReadingDay,
    computeReadingStats,
    epochToDayInput,
    isValidPublishDate,
    normalizeBookMetaMap,
    normalizeReadingDays,
    parseDayInput,
    pruneReadingDays,
} from '../src/bookshelf/book-meta';
import { dayKey } from '../src/studio/grouping';

const NOW = new Date(2026, 10, 11, 15, 30).getTime();   // 2026-11-11 local

describe('isValidPublishDate', () => {
    it('accepts YYYY / YYYY-MM / YYYY-MM-DD', () => {
        expect(isValidPublishDate('1999')).toBe(true);
        expect(isValidPublishDate('1999-03')).toBe(true);
        expect(isValidPublishDate('1999-03-21')).toBe(true);
    });

    it('rejects malformed values and out-of-range parts', () => {
        expect(isValidPublishDate('199')).toBe(false);
        expect(isValidPublishDate('1999-13')).toBe(false);
        expect(isValidPublishDate('1999-03-32')).toBe(false);
        expect(isValidPublishDate('1999/03')).toBe(false);
        expect(isValidPublishDate('')).toBe(false);
    });
});

describe('normalizeBookMetaMap', () => {
    it('drops junk entries and junk fields, keeps valid ones', () => {
        const out = normalizeBookMetaMap({
            'ok.epub': {
                title: '  Deep Work  ',
                author: 'Cal Newport',
                publishDate: '2016-03',
                pages: 304,
                rating: 4.5,
                progress: 42,
                startedAt: 1000,
                finishedAt: 2000,
                updatedAt: 5,
            },
            'bad-progress.epub': { progress: 140, updatedAt: 5 },
            'bad-rating.epub': { rating: 3.7, updatedAt: 5 },
            'bad-pages.epub': { pages: -3, updatedAt: 5 },
            'bad-date.epub': { publishDate: '16-03', updatedAt: 5 },
            'no-updatedAt.epub': { progress: 10 },
            'empty.epub': { updatedAt: 5 },
            '': { progress: 10, updatedAt: 5 },
        });
        // Entries whose every field was junk lose their last content and
        // are dropped entirely (nothing left to show or sync).
        expect(out).toEqual({
            'ok.epub': {
                title: 'Deep Work',
                author: 'Cal Newport',
                publishDate: '2016-03',
                pages: 304,
                rating: 4.5,
                progress: 42,
                startedAt: 1000,
                finishedAt: 2000,
                updatedAt: 5,
            },
        });
    });

    it('tolerates non-object input', () => {
        expect(normalizeBookMetaMap(undefined)).toEqual({});
        expect(normalizeBookMetaMap('junk')).toEqual({});
    });
});

describe('normalizeReadingDays / pruneReadingDays', () => {
    it('keeps only well-formed day keys with positive counts', () => {
        expect(normalizeReadingDays({ '2026-11-11': 2, 'yesterday': 1, '2026-11-10': 0, '2026-11-09': -1 }))
            .toEqual({ '2026-11-11': 2 });
    });

    it('prunes entries older than the retention window', () => {
        const days = { '2019-01-01': 1, '2023-12-31': 1, '2026-11-11': 1 };
        expect(pruneReadingDays(days, NOW)).toEqual({ '2023-12-31': 1, '2026-11-11': 1 });
    });
});

describe('applyProgressTo', () => {
    it('creates startedAt on the first move away from 0', () => {
        const next = applyProgressTo({}, 'a.epub', 10, NOW);
        expect(next['a.epub']).toMatchObject({ progress: 10, startedAt: NOW, updatedAt: NOW });
    });

    it('records finishedAt when reaching 100 and keeps it on re-reads', () => {
        const reading = applyProgressTo({}, 'a.epub', 60, NOW);
        const finished = applyProgressTo(reading, 'a.epub', 100, NOW + 1000);
        expect(finished['a.epub']).toMatchObject({ progress: 100, finishedAt: NOW + 1000 });
        const reRead = applyProgressTo(finished, 'a.epub', 30, NOW + 2000);
        expect(reRead['a.epub']).toMatchObject({ progress: 30, finishedAt: NOW + 1000, startedAt: NOW });
    });

    it('clamps and rounds the percent and never mutates the input', () => {
        const input = { 'a.epub': { progress: 1, updatedAt: 1 } };
        const next = applyProgressTo(input, 'a.epub', 140.6, NOW);
        expect(next['a.epub']?.progress).toBe(100);
        expect(input['a.epub']?.progress).toBe(1);
    });

    it('preserves sibling books and other fields', () => {
        const input = { 'b.epub': { rating: 5, updatedAt: 9 } };
        const next = applyProgressTo(input, 'a.epub', 5, NOW);
        expect(next['b.epub']).toEqual({ rating: 5, updatedAt: 9 });
        expect(next['a.epub']?.progress).toBe(5);
    });
});

describe('bumpReadingDay', () => {
    it('counts a book once per day across calls in the same session', () => {
        const first = bumpReadingDay({}, '2026-11-11', 'a.epub', new Set());
        const again = bumpReadingDay(first.days, '2026-11-11', 'a.epub', first.counted);
        expect(again.days).toEqual({ '2026-11-11': 1 });
        const other = bumpReadingDay(again.days, '2026-11-11', 'b.epub', again.counted);
        expect(other.days).toEqual({ '2026-11-11': 2 });
    });

    it('counts the same book again on a new day', () => {
        const day1 = bumpReadingDay({}, '2026-11-11', 'a.epub', new Set());
        const day2 = bumpReadingDay(day1.days, '2026-11-12', 'a.epub', day1.counted);
        expect(day2.days).toEqual({ '2026-11-11': 1, '2026-11-12': 1 });
    });

    it('never mutates the input days or set', () => {
        const days = { '2026-11-11': 1 };
        const counted = new Set<string>();
        const next = bumpReadingDay(days, '2026-11-12', 'a.epub', counted);
        expect(days).toEqual({ '2026-11-11': 1 });
        expect(counted.size).toBe(0);
        expect(next.counted.size).toBe(1);
    });
});

describe('parseDayInput / epochToDayInput', () => {
    it('parses valid local dates and rejects impossible ones', () => {
        expect(parseDayInput('2026-11-11')).toBe(new Date(2026, 10, 11).getTime());
        expect(parseDayInput('2026-02-30')).toBeNull();
        expect(parseDayInput('2026-2-3')).toBeNull();
        expect(parseDayInput('junk')).toBeNull();
    });

    it('round-trips an epoch through the day input format', () => {
        expect(epochToDayInput(NOW)).toBe('2026-11-11');
        expect(parseDayInput(epochToDayInput(NOW))).toBe(new Date(2026, 10, 11).getTime());
    });
});

describe('computeReadingStats', () => {
    const readingDays = {
        '2026-11-09': 1,
        '2026-11-10': 2,
        '2026-11-11': 1,
        '2026-10-02': 3,
        '2025-06-01': 4,
    };
    // Highlight-only day: counts as reading via the union, no readingDays key.
    const highlightDays = new Map([['2026-11-08', 5]]);

    it('derives tiles, streak, per-year counts and the union day map', () => {
        const meta = {
            'done.epub': { progress: 100, finishedAt: new Date(2026, 2, 1).getTime(), pages: 300, updatedAt: 1 },
            'done-2025.epub': { progress: 100, finishedAt: new Date(2025, 5, 1).getTime(), updatedAt: 1 },
            'reading.pdf': { progress: 55, updatedAt: 1 },
            'unread.md': { progress: 0, updatedAt: 1 },
        };
        const stats = computeReadingStats(meta, readingDays, highlightDays, new Date(NOW));
        expect(stats.finishedThisYear).toBe(1);
        expect(stats.finishedPagesThisYear).toBe(300);
        expect(stats.readingCount).toBe(1);
        // 11-11, 11-10, 11-09 (log) + 11-08 (highlight union) = 4.
        expect(stats.streak).toBe(4);
        expect(stats.daysThisYear).toBe(5);
        expect(stats.finishedPerYear).toEqual([
            [2021, 0], [2022, 0], [2023, 0], [2024, 0], [2025, 1], [2026, 1],
        ]);
        expect(stats.dayMap.get('2026-11-08')).toBe(1);
        expect(stats.dayMap.get('2026-11-10')).toBe(2);
    });

    it('streak skips an empty today and counts back from yesterday', () => {
        const days = { '2026-11-10': 1, '2026-11-09': 1 };
        const stats = computeReadingStats({}, days, new Map(), new Date(NOW));
        expect(stats.streak).toBe(2);
    });

    it('an empty state yields zeros without throwing', () => {
        const stats = computeReadingStats({}, {}, new Map(), new Date(NOW));
        expect(stats.finishedThisYear).toBe(0);
        expect(stats.streak).toBe(0);
        expect(stats.daysThisYear).toBe(0);
        expect(stats.readingCount).toBe(0);
        expect(stats.dayMap.size).toBe(0);
    });

    it('keys the log with the shared dayKey format', () => {
        // Guard the contract between the log and the stats derivation.
        expect(dayKey(new Date(2026, 10, 11))).toBe('2026-11-11');
    });
});
