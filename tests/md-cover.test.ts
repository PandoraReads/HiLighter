import { describe, expect, it } from 'vitest';
import {
	MD_COVER_FIELDS,
	isHttpUrl,
	pickMarkdownCover,
	stripMarkdownLink,
} from '../src/bookshelf/md-cover';

describe('markdown cover field picking', () => {
	it('checks fields in priority order', () => {
		expect(pickMarkdownCover({ cover: 'a.jpg', image: 'b.jpg' })).toBe('a.jpg');
		expect(pickMarkdownCover({ image: 'b.jpg', banner: 'c.jpg' })).toBe('b.jpg');
	});

	it('matches keys case-insensitively', () => {
		expect(pickMarkdownCover({ Cover: 'a.jpg' })).toBe('a.jpg');
		expect(pickMarkdownCover({ FRONT_IMAGE: 'x.png' })).toBeNull();
	});

	it('uses the first string of list-valued properties', () => {
		expect(pickMarkdownCover({ image: ['x.png', 'y.png'] })).toBe('x.png');
	});

	it('ignores non-string and empty values', () => {
		expect(pickMarkdownCover({ cover: 42 })).toBeNull();
		expect(pickMarkdownCover({ cover: true })).toBeNull();
		expect(pickMarkdownCover({ cover: '   ' })).toBeNull();
		expect(pickMarkdownCover({})).toBeNull();
		expect(pickMarkdownCover(undefined)).toBeNull();
		expect(pickMarkdownCover(null)).toBeNull();
	});

	it('field list is stable and ordered', () => {
		expect([...MD_COVER_FIELDS]).toEqual(['cover', 'image', 'banner', 'featured', 'thumbnail']);
	});
});

describe('markdown cover link stripping', () => {
	it('unwraps wikilinks and embeds (with and without aliases)', () => {
		expect(stripMarkdownLink('[[cover.jpg]]')).toBe('cover.jpg');
		expect(stripMarkdownLink('![[cover.jpg]]')).toBe('cover.jpg');
		expect(stripMarkdownLink('![[notes/covers/cover.jpg|cover]]')).toBe('notes/covers/cover.jpg');
	});

	it('unwraps markdown image links', () => {
		expect(stripMarkdownLink('![alt](cover.jpg)')).toBe('cover.jpg');
		expect(stripMarkdownLink('[](https://example.com/c.png)')).toBe('https://example.com/c.png');
	});

	it('keeps bare paths and trims whitespace', () => {
		expect(stripMarkdownLink('  attachments/covers/c.jpeg  ')).toBe('attachments/covers/c.jpeg');
	});

	it('does not mangle partial syntax', () => {
		expect(stripMarkdownLink('[[a]] and [[b]]')).toBe('[[a]] and [[b]]');
	});
});

describe('http url detection', () => {
	it('accepts http and https, any case', () => {
		expect(isHttpUrl('https://example.com/c.jpg')).toBe(true);
		expect(isHttpUrl('HTTP://example.com/c.jpg')).toBe(true);
	});

	it('rejects non-url values', () => {
		expect(isHttpUrl('covers/c.jpg')).toBe(false);
		expect(isHttpUrl('ftp://example.com/c.jpg')).toBe(false);
		expect(isHttpUrl('')).toBe(false);
	});
});
