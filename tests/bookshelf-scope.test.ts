// ============================================================
// HiLighter - Bookshelf scan-scope defenses (unit)
// ============================================================
// Covers the three protection layers for the 书籍 tab scan:
// 1. Unset / invalid scope matches NOTHING (first-open safety).
// 2. Include folders opt into recursion per folder (legacy string
//    entries stay recursive so existing setups do not change).
// 3. A hard cap limits how many files one scan may return.

import { describe, expect, it } from 'vitest';
import {
	MAX_SHELF_SCAN_FILES,
	isShelfRelevantPath,
	matchShelfFiles,
	normalizeIncludeFolders,
	underFolder,
} from '../src/bookshelf/scope';

function file(path: string): { path: string; extension: string } {
	const dot = path.lastIndexOf('.');
	return { path, extension: dot > 0 ? path.slice(dot + 1) : '' };
}

describe('bookshelf scope matching', () => {
	it('unset include list matches nothing (first-open defense)', () => {
		const files = [file('Books/a.epub'), file('Notes/b.md')];
		expect(matchShelfFiles(files, undefined, undefined)).toEqual([]);
		expect(matchShelfFiles(files, [], [])).toEqual([]);
	});

	it('invalid include entries are dropped, not treated as root', () => {
		// Legacy strings that fail normalization must not silently
		// widen the scope; an all-invalid list behaves as unset.
		expect(matchShelfFiles([file('a.md')], ['/etc'], [])).toEqual([]);
		expect(normalizeIncludeFolders(['/etc', '  '])).toEqual([]);
		// The vault root stays expressible only as the exact '' entry.
		expect(normalizeIncludeFolders([''])).toEqual([{ path: '', recursive: true }]);
	});

	it('legacy string include entries keep recursive semantics', () => {
		const files = [
			file('Books/deep/nested/a.md'),
			file('Other/b.md'),
		];
		expect(matchShelfFiles(files, ['Books'], [])).toEqual(['Books/deep/nested/a.md']);
	});

	it('top-level-only include folder matches direct children only', () => {
		const files = [
			file('Books/a.md'),
			file('Books/sub/b.md'),
			file('Books/sub/deep/c.epub'),
			file('Elsewhere/d.md'),
		];
		const matched = matchShelfFiles(files, [{ path: 'Books', recursive: false }], []);
		expect(matched).toEqual(['Books/a.md']);
	});

	it('recursive include folder matches nested files', () => {
		const files = [
			file('Books/a.md'),
			file('Books/sub/b.md'),
			file('Books/sub/deep/c.epub'),
		];
		const matched = matchShelfFiles(files, [{ path: 'Books', recursive: true }], []);
		expect(matched.sort()).toEqual(['Books/a.md', 'Books/sub/b.md', 'Books/sub/deep/c.epub']);
	});

	it('root include without recursion matches only vault-root files', () => {
		const files = [
			file('root-note.md'),
			file('Books/a.md'),
			file('Books/deep/b.epub'),
		];
		expect(matchShelfFiles(files, [{ path: '', recursive: false }], [])).toEqual(['root-note.md']);
	});

	it('root include with recursion matches everything supported', () => {
		const files = [
			file('root-note.md'),
			file('Books/deep/b.epub'),
			file('.hidden/config.json'),     // hidden -> never matched
			file('Books/c.txt'),             // unsupported -> never matched
		];
		expect(underFolder('any/path.md', '', false)).toBe(false);
		const matched = matchShelfFiles(files, [{ path: '', recursive: true }], []);
		expect(matched.sort()).toEqual(['Books/deep/b.epub', 'root-note.md']);
	});

	it('exclude folders always prune whole subtrees', () => {
		const files = [
			file('Books/keep/a.md'),
			file('Books/drop/b.md'),
			file('Books/drop/deep/c.epub'),
		];
		const matched = matchShelfFiles(files, ['Books'], ['Books/drop']);
		expect(matched).toEqual(['Books/keep/a.md']);
	});

	it('filters hidden paths and unsupported extensions', () => {
		const files = [
			file('.trash/a.md'),
			file('Books/.hidden/b.md'),
			file('Books/c.txt'),
			file('Books/d.pdf'),
		];
		expect(matchShelfFiles(files, ['Books'], [])).toEqual(['Books/d.pdf']);
	});

	it('mixed legacy and structured include entries merge', () => {
		const normalized = normalizeIncludeFolders(['A', { path: 'B', recursive: false }]);
		expect(normalized).toEqual([
			{ path: 'A', recursive: true },
			{ path: 'B', recursive: false },
		]);
	});

	it('duplicate paths keep the first entry', () => {
		const normalized = normalizeIncludeFolders([
			{ path: 'A', recursive: false },
			{ path: 'A', recursive: true },
		]);
		expect(normalized).toEqual([{ path: 'A', recursive: false }]);
	});
});

describe('bookshelf scan cap', () => {
	it('caps one scan at MAX_SHELF_SCAN_FILES files, keeping a stable window', () => {
		// Names deliberately out of order: the cap must keep the
		// alphabetically-first window, not "whatever the vault listed
		// first" (that order shifts with sync churn and would flap).
		const names = Array.from({ length: MAX_SHELF_SCAN_FILES + 500 }, (_, i) =>
			`book-${String(MAX_SHELF_SCAN_FILES + 499 - i).padStart(6, '0')}`);
		const files = names.map(n => file(`Books/${n}.md`));
		const matched = matchShelfFiles(files, ['Books'], []);
		expect(matched.length).toBe(MAX_SHELF_SCAN_FILES);
		const expected = names.map(n => `Books/${n}.md`)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, MAX_SHELF_SCAN_FILES);
		expect(matched).toEqual(expected);
	});

	it('the cap is generous enough for a real library', () => {
		// Regression guard: the limit must never drop below a realistic
		// curated shelf (PandoraBooks scopes hold ~3k files today).
		expect(MAX_SHELF_SCAN_FILES).toBeGreaterThanOrEqual(2000);
	});
});

describe('vault-change relevance gate', () => {
	it('in-scope shelf files are relevant', () => {
		expect(isShelfRelevantPath('Books/a.md', [{ path: 'Books', recursive: true }], [])).toBe(true);
		expect(isShelfRelevantPath('Books/deep/b.epub', ['Books'], [])).toBe(true);
	});

	it('out-of-scope, unsupported and hidden paths are ignored', () => {
		// Sync churn (iCloud placeholders, unrelated notes) must never
		// trigger a shelf re-render.
		expect(isShelfRelevantPath('Other/note.md', ['Books'], [])).toBe(false);
		expect(isShelfRelevantPath('Books/archive.zip', ['Books'], [])).toBe(false);
		expect(isShelfRelevantPath('Books/note.md.icloud', ['Books'], [])).toBe(false);
		expect(isShelfRelevantPath('.trash/Books/a.md', ['Books'], [])).toBe(false);
	});

	it('respects top-level-only include folders', () => {
		const include = [{ path: 'Books', recursive: false }];
		expect(isShelfRelevantPath('Books/a.md', include, [])).toBe(true);
		expect(isShelfRelevantPath('Books/magazine/issue.md', include, [])).toBe(false);
	});

	it('excluded subtrees are ignored', () => {
		expect(isShelfRelevantPath('Books/mags/a.md', ['Books'], ['Books/mags'])).toBe(false);
	});

	it('unset scope makes every path irrelevant', () => {
		expect(isShelfRelevantPath('Books/a.md', [], [])).toBe(false);
		expect(isShelfRelevantPath('Books/a.md', undefined, undefined)).toBe(false);
	});
});
