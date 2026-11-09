import { describe, expect, it } from 'vitest';
import { matchesBookTitle } from '../src/bookshelf/title-match';

describe('bookshelf title search', () => {
	it('empty or blank query matches everything', () => {
		expect(matchesBookTitle('', 'anything')).toBe(true);
		expect(matchesBookTitle('   ', 'anything')).toBe(true);
	});

	it('matches case-insensitively on the file basename', () => {
		expect(matchesBookTitle('三体', '三体.epub')).toBe(true);
		expect(matchesBookTitle('SAPIENS', 'sapiens.pdf')).toBe(true);
		expect(matchesBookTitle('deep', 'Deep Work.md')).toBe(true);
	});

	it('matches a loaded metadata title as a fallback', () => {
		expect(matchesBookTitle('暗淡蓝点', 'pale_blue_dot.epub', '暗淡蓝点')).toBe(true);
	});

	it('skips undefined titles and rejects non-matches', () => {
		expect(matchesBookTitle('xyz', 'a.md', undefined)).toBe(false);
		expect(matchesBookTitle('三体', '银河系漫游指南.epub', '银河系漫游指南')).toBe(false);
	});
});
