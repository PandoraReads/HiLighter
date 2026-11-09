import { describe, expect, it } from 'vitest';
import {
	collectBookTags,
	removeTagPaths,
	setTagOnBooks,
	tagOnAllBooks,
} from '../src/bookshelf/book-tags';

describe('bookshelf book tags', () => {
	it('adds tags immutably and dedupes', () => {
		const tags = { 'a.md': ['在读'] };
		const next = setTagOnBooks(tags, ['a.md', 'b.epub'], '精选', true);
		expect(next).toEqual({
			'a.md': ['在读', '精选'],
			'b.epub': ['精选'],
		});
		expect(tags).toEqual({ 'a.md': ['在读'] }); // input untouched
		expect(setTagOnBooks(next, ['a.md'], '精选', true)).toBe(next); // no-op returns same map
	});

	it('removes tags and drops emptied entries', () => {
		const tags = { 'a.md': ['x', 'y'], 'b.md': ['x'] };
		const next = setTagOnBooks(tags, ['a.md'], 'x', false);
		expect(next).toEqual({ 'a.md': ['y'], 'b.md': ['x'] });
		const emptied = setTagOnBooks(next, ['a.md'], 'y', false);
		expect(emptied).toEqual({ 'b.md': ['x'] });
	});

	it('blank tags are ignored', () => {
		expect(setTagOnBooks({}, ['a.md'], '   ', true)).toEqual({});
	});

	it('collectBookTags counts and sorts', () => {
		const tags = { 'a.md': ['B', 'A'], 'b.md': ['A'], 'c.md': [] };
		expect(collectBookTags(tags)).toEqual([
			{ tag: 'A', count: 2 },
			{ tag: 'B', count: 1 },
		]);
	});

	it('tagOnAllBooks requires every path to carry the tag', () => {
		const tags = { 'a.md': ['x'], 'b.md': ['x'], 'c.md': [] };
		expect(tagOnAllBooks(tags, ['a.md', 'b.md'], 'x')).toBe(true);
		expect(tagOnAllBooks(tags, ['a.md', 'c.md'], 'x')).toBe(false);
		expect(tagOnAllBooks(tags, [], 'x')).toBe(false);
	});

	it('removeTagPaths drops deleted books', () => {
		const tags = { 'a.md': ['x'], 'b.md': ['y'] };
		expect(removeTagPaths(tags, ['a.md'])).toEqual({ 'b.md': ['y'] });
	});
});
