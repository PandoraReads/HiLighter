// ============================================================
// HiLighter - EPUB page color themes (background + text pairs)
// ============================================================
// Reader page-color presets: a background paired with a text color
// (light paper tones and dark combos with warm / cool / tinted
// inks). '' / undefined = follow the Obsidian theme, in which case
// the reader stays transparent and uses the vault's text color.

import type { HiLighterSettings } from '../models';

export interface EpubPageThemeOption {
	/** Settings value; 'default' = follow the Obsidian theme. */
	id: string;
	/** i18n key for the aria/title label. */
	labelKey: string;
	/** Page background hex; '' for the default (follow) option. */
	background: string;
	/** Paired text color. */
	text: string;
}

/**
 * Preset pairs, light first then dark. Dark entries vary the ink as
 * much as the paper: cool grey, warm white, sepia, blue and green
 * tints — so a night reader can pick a comfortable combination, not
 * just a dark background.
 */
export const EPUB_PAGE_THEME_OPTIONS: readonly EpubPageThemeOption[] = [
	{ id: 'default', labelKey: 'epub.pageThemeDefault', background: '', text: '' },
	// ── Light ──
	{ id: 'paper', labelKey: 'epub.pageThemePaper', background: '#FFFFFF', text: '#262626' },
	{ id: 'yellow', labelKey: 'epub.pageThemeYellow', background: '#F4ECD8', text: '#5B4636' },
	{ id: 'green', labelKey: 'epub.pageThemeGreen', background: '#C8E4CC', text: '#2E4237' },
	{ id: 'gray', labelKey: 'epub.pageThemeGray', background: '#E4E6E8', text: '#36393F' },
	{ id: 'pink', labelKey: 'epub.pageThemePink', background: '#F6E9E1', text: '#46352D' },
	// ── Dark ──
	{ id: 'dark', labelKey: 'epub.pageThemeDark', background: '#191A1C', text: '#C9CBD0' },
	{ id: 'black', labelKey: 'epub.pageThemeBlack', background: '#000000', text: '#B4B6BA' },
	{ id: 'darkSepia', labelKey: 'epub.pageThemeDarkSepia', background: '#2B2420', text: '#CDBFA2' },
	{ id: 'darkBlue', labelKey: 'epub.pageThemeDarkBlue', background: '#0F1A2E', text: '#B3C5DD' },
	{ id: 'darkGreen', labelKey: 'epub.pageThemeDarkGreen', background: '#15211B', text: '#A8C6B2' },
	{ id: 'darkWarm', labelKey: 'epub.pageThemeDarkWarm', background: '#1E1C1A', text: '#E6DCC8' },
];

/** The option for a settings id; unknown/empty ids resolve to default. */
export function epubPageTheme(id: string | undefined): EpubPageThemeOption {
	const found = EPUB_PAGE_THEME_OPTIONS.find(option => option.id === id);
	return found ?? EPUB_PAGE_THEME_OPTIONS[0]!;
}

/** True when a page color override is active. */
export function hasEpubPageThemeOverride(
	settings: Pick<HiLighterSettings, 'epubPageTheme'>,
): boolean {
	return Boolean(settings.epubPageTheme)
		&& epubPageTheme(settings.epubPageTheme).id !== 'default';
}

export interface EpubPageColors {
	/** Page background; '' = not themed (transparent, follow Obsidian). */
	background: string;
	/** Effective text color (the theme's ink, or the vault fallback). */
	text: string;
}

/**
 * Resolves the effective page colors: the chosen preset wins; with
 * no override the reader follows Obsidian (transparent background,
 * the vault's --text-normal passed in by the caller).
 */
export function resolveEpubPageColors(
	settings: Pick<HiLighterSettings, 'epubPageTheme'>,
	fallbackText: string,
): EpubPageColors {
	const option = epubPageTheme(settings.epubPageTheme);
	if (option.id === 'default' || !option.background) {
		return { background: '', text: fallbackText };
	}
	return { background: option.background, text: option.text };
}
