import { describe, expect, it } from 'vitest';
import {
	applyRecentPreferences,
	computeRecentSources,
	splitFocusEntry,
} from '../src/bookshelf/recent-page';
import type { RecentSource } from '../src/bookshelf/recent-page';
import type { ShelfKind } from '../src/bookshelf/scope';
import type { HighlightNote } from '../src/models';

function note(overrides: Partial<HighlightNote>): HighlightNote {
	return {
		id: 'id-' + Math.random().toString(36).slice(2, 8),
		text: 'sample',
		color: 'yellow',
		note: '',
		sourcePath: 'notes/a.md',
		lineIndex: 0,
		createdAt: 1000,
		...overrides,
	};
}

describe('bookshelf recent sources', () => {
	it('groups by source path with counts and newest timestamp', () => {
		const sources = computeRecentSources([
			note({ sourcePath: 'a.md', createdAt: 100 }),
			note({ sourcePath: 'a.md', createdAt: 900 }),
			note({ sourcePath: 'a.md', createdAt: 500 }),
			note({ sourcePath: 'b.epub', createdAt: 400 }),
		]);
		expect(sources).toEqual([
			{ path: 'a.md', count: 3, lastAt: 900 },
			{ path: 'b.epub', count: 1, lastAt: 400 },
		]);
	});

	it('sorts by newest activity descending', () => {
		const sources = computeRecentSources([
			note({ sourcePath: 'old.md', createdAt: 10 }),
			note({ sourcePath: 'new.md', createdAt: 999 }),
			note({ sourcePath: 'mid.pdf', createdAt: 500 }),
		]);
		expect(sources.map(s => s.path)).toEqual(['new.md', 'mid.pdf', 'old.md']);
	});

	it('excludes idea cards and empty source paths', () => {
		const sources = computeRecentSources([
			note({ kind: 'idea', sourcePath: 'x.md', createdAt: 900 }),
			note({ sourcePath: '', createdAt: 800 }),
			note({ sourcePath: 'real.md', createdAt: 100 }),
		]);
		expect(sources).toEqual([{ path: 'real.md', count: 1, lastAt: 100 }]);
	});

	it('caps the list at the limit', () => {
		const many = Array.from({ length: 30 }, (_, i) =>
			note({ sourcePath: `f${i}.md`, createdAt: i }));
		expect(computeRecentSources(many, 5)).toHaveLength(5);
		expect(computeRecentSources(many, 5)[0]!.path).toBe('f29.md');
	});

	it('returns an empty list for empty input', () => {
		expect(computeRecentSources([])).toEqual([]);
	});
});

describe('recent page preferences (format filter + sort)', () => {
	const sources: RecentSource[] = [
		{ path: 'a.md', count: 3, lastAt: 900 },
		{ path: 'b.epub', count: 1, lastAt: 400 },
		{ path: 'c.pdf', count: 5, lastAt: 200 },
	];
	const kindOf = (path: string): ShelfKind | null => {
		if (path.endsWith('.md')) return 'markdown';
		if (path.endsWith('.pdf')) return 'pdf';
		if (path.endsWith('.epub')) return 'epub';
		return null;
	};
	const titleOf = (path: string): string => path.replace(/\.[^.]+$/, '');

	it('keeps everything with the all filter', () => {
		expect(applyRecentPreferences(sources, kindOf, titleOf, 'all', 'recent')).toHaveLength(3);
	});

	it('filters by format', () => {
		const onlyEpub = applyRecentSources(sources, kindOf, 'epub');
		expect(onlyEpub.map(s => s.path)).toEqual(['b.epub']);
	});

	it('sorts by highlight count (ties fall back to recency)', () => {
		const sorted = applyRecentPreferences(sources, kindOf, titleOf, 'all', 'count');
		expect(sorted.map(s => s.path)).toEqual(['c.pdf', 'a.md', 'b.epub']);
	});

	it('sorts by title', () => {
		const sorted = applyRecentPreferences(sources, kindOf, titleOf, 'all', 'title');
		expect(sorted.map(s => s.path)).toEqual(['a.md', 'b.epub', 'c.pdf']);
	});

	it('keeps newest-first order for the recent sort', () => {
		const sorted = applyRecentPreferences(sources, kindOf, titleOf, 'all', 'recent');
		expect(sorted.map(s => s.path)).toEqual(['a.md', 'b.epub', 'c.pdf']);
	});

	it('does not mutate the input array', () => {
		const input = [...sources];
		applyRecentPreferences(sources, kindOf, titleOf, 'pdf', 'count');
		expect(sources).toEqual(input);
	});
});

describe('recent page focus split (phone continue-reading card)', () => {
	interface Row { id: string; lastAt: number }
	const rows: Row[] = [
		{ id: 'a', lastAt: 100 },
		{ id: 'b', lastAt: 900 },
		{ id: 'c', lastAt: 500 },
	];

	it('picks the entry with the newest activity as the focus', () => {
		const { focus, rest } = splitFocusEntry(rows);
		expect(focus?.id).toBe('b');
		expect(rest.map(row => row.id)).toEqual(['a', 'c']);
	});

	it('keeps the first entry on ties', () => {
		const { focus, rest } = splitFocusEntry<Row>([
			{ id: 'x', lastAt: 50 },
			{ id: 'y', lastAt: 50 },
		]);
		expect(focus?.id).toBe('x');
		expect(rest.map(row => row.id)).toEqual(['y']);
	});

	it('returns no focus for an empty list', () => {
		expect(splitFocusEntry([])).toEqual({ focus: null, rest: [] });
	});

	it('yields an empty rest list for a single entry', () => {
		const { focus, rest } = splitFocusEntry([{ id: 'only', lastAt: 5 }]);
		expect(focus?.id).toBe('only');
		expect(rest).toEqual([]);
	});

	it('does not mutate the input', () => {
		const snapshot = [...rows];
		splitFocusEntry(rows);
		expect(rows).toEqual(snapshot);
	});
});

/** Helper alias to keep the filter expectation terse. */
function applyRecentSources(
	sources: RecentSource[],
	kindOf: (path: string) => ShelfKind | null,
	format: ShelfKind,
): RecentSource[] {
	return applyRecentPreferences(sources, kindOf, () => '', format, 'recent');
}
