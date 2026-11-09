import { describe, expect, it } from 'vitest';
import {
	SHELF_EXTENSIONS,
	matchShelfFiles,
	normalizeFolderList,
	shelfKind,
	underFolder,
	type ShelfFileLike,
} from '../src/bookshelf/scope';

function files(...paths: string[]): ShelfFileLike[] {
	return paths.map(path => ({
		path,
		extension: path.split('.').pop() ?? '',
	}));
}

describe('bookshelf folder scope', () => {
	it('collects only epub / pdf / markdown files', () => {
		const matched = matchShelfFiles(
			files('Books/a.epub', 'Docs/b.pdf', 'Notes/c.md', 'img/d.png', 'e.docx'),
			[''],
			[],
		);
		expect(matched).toEqual(['Books/a.epub', 'Docs/b.pdf', 'Notes/c.md']);
	});

	it('includes files inside configured folders (nested)', () => {
		const matched = matchShelfFiles(
			files('Books/novel/a.epub', 'Books/b.md', 'Other/c.epub', 'root.md'),
			['Books'],
			[],
		);
		expect(matched).toEqual(['Books/novel/a.epub', 'Books/b.md']);
	});

	it('supports several include folders', () => {
		const matched = matchShelfFiles(
			files('A/x.md', 'B/y.md', 'C/z.md'),
			['A', 'B'],
			[],
		);
		expect(matched).toEqual(['A/x.md', 'B/y.md']);
	});

	it('exclude folders subtract from the scope and win over includes', () => {
		const matched = matchShelfFiles(
			files('Books/a.md', 'Books/drafts/b.md', 'Books/c.epub'),
			['Books'],
			['Books/drafts'],
		);
		expect(matched).toEqual(['Books/a.md', 'Books/c.epub']);
	});

	it('an include folder inside an exclude folder matches nothing', () => {
		const matched = matchShelfFiles(files('A/x.md'), ['A'], ['A']);
		expect(matched).toEqual([]);
	});

	it('empty include list means the scope is unconfigured', () => {
		expect(matchShelfFiles(files('a.md'), [], [])).toEqual([]);
		expect(matchShelfFiles(files('a.md'), undefined, undefined)).toEqual([]);
	});

	it('root include (empty string or /) matches the whole vault', () => {
		expect(matchShelfFiles(files('a.md', 'x/b.epub'), [''], [])).toEqual(['a.md', 'x/b.epub']);
		expect(matchShelfFiles(files('a.md', 'x/b.epub'), ['/'], [])).toEqual(['a.md', 'x/b.epub']);
	});

	it('skips hidden paths at any depth', () => {
		const matched = matchShelfFiles(
			files('a.md', '.hidden/x.md', 'Books/.drafts/y.md'),
			[''],
			[],
		);
		expect(matched).toEqual(['a.md']);
	});

	it('ignores non-matching folder prefixes (Books2 vs Books)', () => {
		const matched = matchShelfFiles(files('Books2/a.md'), ['Books'], []);
		expect(matched).toEqual([]);
	});

	it('normalizeFolderList dedupes and drops invalid entries', () => {
		expect(normalizeFolderList(['Books', 'Books/', '  Books  ', '../evil', 'ok'])).toEqual(['Books', 'ok']);
		expect(normalizeFolderList(undefined)).toEqual([]);
	});

	it('underFolder treats root as universal', () => {
		expect(underFolder('a/b.md', '')).toBe(true);
		expect(underFolder('a/b.md', 'a')).toBe(true);
		expect(underFolder('ab/c.md', 'a')).toBe(false);
	});

	it('shelfKind maps extensions case-insensitively', () => {
		expect(shelfKind('EPUB')).toBe('epub');
		expect(shelfKind('PDF')).toBe('pdf');
		expect(shelfKind('md')).toBe('markdown');
		expect(shelfKind('markdown')).toBe('markdown');
		expect(shelfKind('png')).toBeNull();
	});

	it('SHELF_EXTENSIONS stays stable', () => {
		expect([...SHELF_EXTENSIONS]).toEqual(['md', 'pdf', 'epub']);
	});
});
