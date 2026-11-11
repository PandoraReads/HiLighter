import { describe, expect, it } from 'vitest';
import {
	EPUB_PAGE_THEME_OPTIONS,
	epubPageTheme,
	hasEpubPageThemeOverride,
	resolveEpubPageColors,
} from '../src/epub/epub-page-theme';
import { EPUB_FONT_OPTIONS } from '../src/epub/epub-typography';

describe('epub page theme options', () => {
	it('starts with the default (follow) option', () => {
		expect(EPUB_PAGE_THEME_OPTIONS[0]?.id).toBe('default');
		expect(EPUB_PAGE_THEME_OPTIONS[0]?.background).toBe('');
	});

	it('every non-default option pairs a background with a readable ink', () => {
		EPUB_PAGE_THEME_OPTIONS
			.filter(option => option.id !== 'default')
			.forEach(option => {
				expect(option.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
				expect(option.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
				expect(option.background).not.toBe(option.text);
			});
	});

	it('covers light presets and multiple dark ink pairings', () => {
		const ids = EPUB_PAGE_THEME_OPTIONS.map(option => option.id);
		['paper', 'yellow', 'green', 'gray', 'pink'].forEach(id => expect(ids).toContain(id));
		['dark', 'black', 'darkSepia', 'darkBlue', 'darkGreen', 'darkWarm'].forEach(id =>
			expect(ids).toContain(id));
	});
});

describe('epubPageTheme', () => {
	it('resolves known ids and falls back to default', () => {
		expect(epubPageTheme('darkBlue').background).toBe('#0F1A2E');
		expect(epubPageTheme(undefined).id).toBe('default');
		expect(epubPageTheme('').id).toBe('default');
		expect(epubPageTheme('nope').id).toBe('default');
	});
});

describe('hasEpubPageThemeOverride', () => {
	it('is false for default and true for a chosen preset', () => {
		expect(hasEpubPageThemeOverride({ epubPageTheme: undefined })).toBe(false);
		expect(hasEpubPageThemeOverride({ epubPageTheme: '' })).toBe(false);
		expect(hasEpubPageThemeOverride({ epubPageTheme: 'default' })).toBe(false);
		expect(hasEpubPageThemeOverride({ epubPageTheme: 'sepia' })).toBe(false); // unknown id = default
		expect(hasEpubPageThemeOverride({ epubPageTheme: 'yellow' })).toBe(true);
	});
});

describe('resolveEpubPageColors', () => {
	it('follows Obsidian (transparent + vault ink) without an override', () => {
		expect(resolveEpubPageColors({ epubPageTheme: undefined }, '#123456'))
			.toEqual({ background: '', text: '#123456' });
	});

	it('applies the paired preset colors', () => {
		expect(resolveEpubPageColors({ epubPageTheme: 'darkWarm' }, '#123456'))
			.toEqual({ background: '#1E1C1A', text: '#E6DCC8' });
	});
});

describe('epub font option groups', () => {
	it('groups cover CJK and latin stacks and stay generic-terminated', () => {
		const zh = EPUB_FONT_OPTIONS.filter(option => option.group === 'zh');
		const en = EPUB_FONT_OPTIONS.filter(option => option.group === 'en');
		expect(zh.length).toBeGreaterThanOrEqual(6);
		expect(en.length).toBeGreaterThanOrEqual(9);
		[...zh, ...en].forEach(option => {
			if (option.id === 'theme') return;
			expect(option.stack).toMatch(/(serif|sans-serif|monospace)$/);
		});
	});
});
