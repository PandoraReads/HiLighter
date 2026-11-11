import { describe, expect, it } from 'vitest';
import {
	EPUB_FONT_OPTIONS,
	EPUB_FONT_SIZE_MAX,
	EPUB_FONT_SIZE_MIN,
	EPUB_LINE_HEIGHT_MAX,
	EPUB_LINE_HEIGHT_MIN,
	EPUB_MARGIN_MAX,
	EPUB_MARGIN_MIN,
	clampEpubFontSize,
	clampEpubLineHeight,
	clampEpubMargin,
	epubFontStack,
	hasEpubTypographyOverride,
	resolveEpubTypography,
} from '../src/epub/epub-typography';

describe('epub font options', () => {
	it('contains a theme option with an empty stack', () => {
		const theme = EPUB_FONT_OPTIONS.find(option => option.id === 'theme');
		expect(theme?.stack).toBe('');
	});

	it('gives every non-theme option a CSS stack ending in a generic family', () => {
		EPUB_FONT_OPTIONS
			.filter(option => option.id !== 'theme')
			.forEach(option => {
				expect(option.stack.length).toBeGreaterThan(0);
				expect(option.stack).toMatch(/(serif|sans-serif|monospace)$/);
			});
	});
});

describe('epubFontStack', () => {
	it('resolves known ids and maps theme/unknown to empty', () => {
		expect(epubFontStack('serif')).toContain('Georgia');
		expect(epubFontStack('theme')).toBe('');
		expect(epubFontStack('')).toBe('');
		expect(epubFontStack('nope')).toBe('');
		expect(epubFontStack(undefined)).toBe('');
	});
});

describe('clampEpubFontSize', () => {
	it('clamps into the readable range and rounds', () => {
		expect(clampEpubFontSize(EPUB_FONT_SIZE_MIN - 5)).toBe(EPUB_FONT_SIZE_MIN);
		expect(clampEpubFontSize(EPUB_FONT_SIZE_MAX + 5)).toBe(EPUB_FONT_SIZE_MAX);
		expect(clampEpubFontSize(18.4)).toBe(18);
	});

	it('undefined for missing or invalid input', () => {
		expect(clampEpubFontSize(undefined)).toBeUndefined();
		expect(clampEpubFontSize(Number.NaN)).toBeUndefined();
	});
});

describe('hasEpubTypographyOverride', () => {
	it('is false for theme defaults and true for any override', () => {
		expect(hasEpubTypographyOverride({
			epubFontFamily: '', epubFontSize: undefined, epubLineHeight: undefined, epubPageMargin: undefined,
		})).toBe(false);
		expect(hasEpubTypographyOverride({
			epubFontFamily: 'serif', epubFontSize: undefined, epubLineHeight: undefined, epubPageMargin: undefined,
		})).toBe(true);
		expect(hasEpubTypographyOverride({
			epubFontFamily: '', epubFontSize: 18, epubLineHeight: undefined, epubPageMargin: undefined,
		})).toBe(true);
		expect(hasEpubTypographyOverride({
			epubFontFamily: '', epubFontSize: undefined, epubLineHeight: 1.8, epubPageMargin: undefined,
		})).toBe(true);
		expect(hasEpubTypographyOverride({
			epubFontFamily: '', epubFontSize: undefined, epubLineHeight: undefined, epubPageMargin: 12,
		})).toBe(true);
	});
});

describe('clampEpubLineHeight', () => {
	it('clamps into range and snaps to 0.1 steps', () => {
		expect(clampEpubLineHeight(EPUB_LINE_HEIGHT_MIN - 0.5)).toBe(EPUB_LINE_HEIGHT_MIN);
		expect(clampEpubLineHeight(EPUB_LINE_HEIGHT_MAX + 1)).toBe(EPUB_LINE_HEIGHT_MAX);
		expect(clampEpubLineHeight(1.5499999)).toBe(1.5);
		expect(clampEpubLineHeight(undefined)).toBeUndefined();
	});
});

describe('clampEpubMargin', () => {
	it('clamps into range and snaps to 2px steps', () => {
		expect(clampEpubMargin(EPUB_MARGIN_MIN - 4)).toBe(EPUB_MARGIN_MIN);
		expect(clampEpubMargin(EPUB_MARGIN_MAX + 10)).toBe(EPUB_MARGIN_MAX);
		expect(clampEpubMargin(5)).toBe(6);
		expect(clampEpubMargin(undefined)).toBeUndefined();
	});
});

describe('resolveEpubTypography', () => {
	it('follows the Obsidian theme when nothing is overridden', () => {
		const resolved = resolveEpubTypography(
			{ epubFontFamily: '', epubFontSize: undefined, epubLineHeight: undefined, epubPageMargin: undefined },
			{ fontVar: 'Inter', sizeVar: '17px' },
		);
		expect(resolved.fontFamily).toBe('Inter, serif');
		expect(resolved.fontSize).toBe('17px');
		expect(resolved.lineHeight).toBeUndefined();
		expect(resolved.marginCss).toBe('0 4px !important');
	});

	it('falls back to serif/16px without theme values', () => {
		const resolved = resolveEpubTypography(
			{ epubFontFamily: '', epubFontSize: undefined, epubLineHeight: undefined, epubPageMargin: undefined },
			{ fontVar: '', sizeVar: '' },
		);
		expect(resolved.fontFamily).toBe('serif');
		expect(resolved.fontSize).toBe('16px');
	});

	it('the family override wins and already carries fallbacks', () => {
		const resolved = resolveEpubTypography(
			{ epubFontFamily: 'song', epubFontSize: undefined, epubLineHeight: undefined, epubPageMargin: undefined },
			{ fontVar: 'Inter', sizeVar: '17px' },
		);
		expect(resolved.fontFamily).toContain('Songti SC');
		expect(resolved.fontFamily.endsWith('serif')).toBe(true);
		expect(resolved.fontSize).toBe('17px');
	});

	it('the size override is applied in px and clamped', () => {
		const resolved = resolveEpubTypography(
			{ epubFontFamily: '', epubFontSize: 99, epubLineHeight: undefined, epubPageMargin: undefined },
			{ fontVar: '', sizeVar: '17px' },
		);
		expect(resolved.fontSize).toBe(`${EPUB_FONT_SIZE_MAX}px`);
	});

	it('line height and margins apply as unitless / vertical-halved px', () => {
		const resolved = resolveEpubTypography(
			{ epubFontFamily: '', epubFontSize: undefined, epubLineHeight: 1.8, epubPageMargin: 12 },
			{ fontVar: '', sizeVar: '16px' },
		);
		expect(resolved.lineHeight).toBe('1.8');
		expect(resolved.marginCss).toBe('6px 12px !important');
	});
});
