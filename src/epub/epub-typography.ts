// ============================================================
// HiLighter - EPUB typography (font family + size) settings
// ============================================================
// Pure helpers for the reader's font controls. The chosen family is
// a stack id resolved to a CSS font-family value; the size is a px
// override clamped to a readable range. Empty family / undefined
// size means "follow the Obsidian theme" (the reader's default, via
// the --font-text / --font-text-size body variables).

import type { HiLighterSettings } from '../models';

export interface EpubFontOption {
	/** Settings value; 'theme' = follow the Obsidian theme. */
	id: string;
	/** i18n key for the display label. */
	labelKey: string;
	/** CSS font-family stack; '' for the theme option. */
	stack: string;
	/** Menu group: 'zh' CJK-focused, 'en' latin-focused. */
	group: 'zh' | 'en';
}

/**
 * Curated cross-platform stacks (macOS / iPadOS / Windows / Android).
 * Generic families last so every glyph has a fallback. Grouped for
 * the menu: CJK-focused first, then latin-focused stacks.
 */
export const EPUB_FONT_OPTIONS: readonly EpubFontOption[] = [
	{ id: 'theme', labelKey: 'epub.fontTheme', stack: '', group: 'zh' },
	// ── CJK-focused ──
	{
		id: 'song',
		labelKey: 'epub.fontSong',
		stack: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif',
		group: 'zh',
	},
	{
		id: 'kai',
		labelKey: 'epub.fontKai',
		stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif',
		group: 'zh',
	},
	{
		id: 'fangsong',
		labelKey: 'epub.fontFangsong',
		stack: '"FangSong", "STFangsong", "FangSong_GB2312", "Noto Serif CJK SC", serif',
		group: 'zh',
	},
	{
		id: 'hei',
		labelKey: 'epub.fontHei',
		stack: '"Heiti SC", "SimHei", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
		group: 'zh',
	},
	{
		id: 'yuanti',
		labelKey: 'epub.fontYuanti',
		stack: '"Yuanti SC", "Yuanti TC", "PingFang SC", "Noto Sans CJK SC", sans-serif',
		group: 'zh',
	},
	{
		id: 'sans',
		labelKey: 'epub.fontSans',
		stack: '-apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
		group: 'zh',
	},
	// ── Latin-focused ──
	{
		id: 'serif',
		labelKey: 'epub.fontSerif',
		stack: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", serif',
		group: 'en',
	},
	{
		id: 'baskerville',
		labelKey: 'epub.fontBaskerville',
		stack: 'Baskerville, "Baskerville Old Face", Georgia, serif',
		group: 'en',
	},
	{
		id: 'palatino',
		labelKey: 'epub.fontPalatino',
		stack: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
		group: 'en',
	},
	{
		id: 'iowan',
		labelKey: 'epub.fontIowan',
		stack: '"Iowan Old Style", "Palatino Georgia", Georgia, serif',
		group: 'en',
	},
	{
		id: 'charter',
		labelKey: 'epub.fontCharter',
		stack: 'Charter, "Bitstream Charter", Georgia, serif',
		group: 'en',
	},
	{
		id: 'garamond',
		labelKey: 'epub.fontGaramond',
		stack: 'Garamond, "EB Garamond", "Apple Garamond", Georgia, serif',
		group: 'en',
	},
	{
		id: 'didot',
		labelKey: 'epub.fontDidot',
		stack: '"Didot", "Bodoni MT", "Playfair Display", Georgia, serif',
		group: 'en',
	},
	{
		id: 'hoefler',
		labelKey: 'epub.fontHoefler',
		stack: '"Hoefler Text", "Times New Roman", Georgia, serif',
		group: 'en',
	},
	{
		id: 'verdana',
		labelKey: 'epub.fontVerdana',
		stack: 'Verdana, Geneva, "DejaVu Sans", sans-serif',
		group: 'en',
	},
	{
		id: 'mono',
		labelKey: 'epub.fontMono',
		stack: '"Courier New", "SF Mono", ui-monospace, Menlo, monospace',
		group: 'en',
	},
];

export const EPUB_FONT_SIZE_MIN = 12;
export const EPUB_FONT_SIZE_MAX = 28;
/** Step base when no override exists yet and the user taps +/- . */
export const EPUB_FONT_SIZE_DEFAULT = 16;

export const EPUB_LINE_HEIGHT_MIN = 1;
export const EPUB_LINE_HEIGHT_MAX = 2.2;
export const EPUB_LINE_HEIGHT_DEFAULT = 1.6;

export const EPUB_MARGIN_MIN = 0;
export const EPUB_MARGIN_MAX = 40;
export const EPUB_MARGIN_DEFAULT = 4;

/** CSS stack for a family id; '' for theme/unknown ids. */
export function epubFontStack(id: string | undefined): string {
	if (!id) return '';
	const found = EPUB_FONT_OPTIONS.find(option => option.id === id);
	return found && found.id !== 'theme' ? found.stack : '';
}

/** Clamps a size override into range; undefined for invalid input. */
export function clampEpubFontSize(size: number | undefined): number | undefined {
	if (typeof size !== 'number' || !Number.isFinite(size)) return undefined;
	return Math.min(EPUB_FONT_SIZE_MAX, Math.max(EPUB_FONT_SIZE_MIN, Math.round(size)));
}

/** Clamps a line-height override to 0.1 steps; undefined for invalid input. */
export function clampEpubLineHeight(value: number | undefined): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const stepped = Math.round(value * 10) / 10;
	return Math.min(EPUB_LINE_HEIGHT_MAX, Math.max(EPUB_LINE_HEIGHT_MIN, stepped));
}

/** Clamps a page-margin override to 2px steps; undefined for invalid input. */
export function clampEpubMargin(value: number | undefined): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const stepped = Math.round(value / 2) * 2;
	return Math.min(EPUB_MARGIN_MAX, Math.max(EPUB_MARGIN_MIN, stepped));
}

/** True when any typography override differs from the theme default. */
export function hasEpubTypographyOverride(
	settings: Pick<HiLighterSettings, 'epubFontFamily' | 'epubFontSize' | 'epubLineHeight' | 'epubPageMargin'>,
): boolean {
	return Boolean(settings.epubFontFamily)
		|| clampEpubFontSize(settings.epubFontSize) !== undefined
		|| clampEpubLineHeight(settings.epubLineHeight) !== undefined
		|| clampEpubMargin(settings.epubPageMargin) !== undefined;
}

export interface EpubTypography {
	fontFamily: string;
	fontSize: string;
	/** CSS line-height; undefined = the book's own styles apply. */
	lineHeight?: string;
	/** CSS padding shorthand for the body (vertical half-strength). */
	marginCss: string;
}

/**
 * Resolves the effective reader typography: explicit user overrides
 * win; otherwise the Obsidian theme values (already read from the
 * body computed style by the caller) apply with sensible fallbacks.
 */
export function resolveEpubTypography(
	settings: Pick<HiLighterSettings, 'epubFontFamily' | 'epubFontSize' | 'epubLineHeight' | 'epubPageMargin'>,
	theme: { fontVar: string; sizeVar: string },
): EpubTypography {
	const overrideStack = epubFontStack(settings.epubFontFamily);
	const fontFamily = overrideStack
		|| (theme.fontVar ? `${theme.fontVar}, serif` : 'serif');
	const sizeOverride = clampEpubFontSize(settings.epubFontSize);
	const fontSize = sizeOverride !== undefined
		? `${sizeOverride}px`
		: (theme.sizeVar || '16px');
	const lineHeightOverride = clampEpubLineHeight(settings.epubLineHeight);
	const lineHeight = lineHeightOverride !== undefined
		? `${lineHeightOverride}`
		: undefined;
	const margin = clampEpubMargin(settings.epubPageMargin);
	const marginCss = margin === undefined
		? '0 4px !important'
		: `${Math.round(margin / 2)}px ${margin}px !important`;
	return { fontFamily, fontSize, lineHeight, marginCss };
}
