// ============================================================
// HiLighter - EPUB display menu (font / size / spacing / page color)
// ============================================================
// Dropdown UI for the reader display settings: font family, font
// size, line height, page margins and the page background color
// (eye-care greens / sepia / gray / dark). Owns the settings writes;
// the host view supplies the live settings object, persistence, the
// rendition theme re-apply, and an in-place menu refresh so steppers
// update while the dropdown stays open.

import { setIcon } from 'obsidian';
import { t } from '../i18n';
import type { HiLighterSettings } from '../models';
import {
    EPUB_FONT_OPTIONS,
    EPUB_FONT_SIZE_DEFAULT,
    EPUB_FONT_SIZE_MAX,
    EPUB_FONT_SIZE_MIN,
    EPUB_LINE_HEIGHT_DEFAULT,
    EPUB_LINE_HEIGHT_MAX,
    EPUB_LINE_HEIGHT_MIN,
    EPUB_MARGIN_DEFAULT,
    EPUB_MARGIN_MAX,
    EPUB_MARGIN_MIN,
    clampEpubFontSize,
    clampEpubLineHeight,
    clampEpubMargin,
    hasEpubTypographyOverride,
} from './epub-typography';
import {
    EPUB_PAGE_THEME_OPTIONS,
    epubPageTheme,
    hasEpubPageThemeOverride,
} from './epub-page-theme';

/** True when any display override (typography or page color) is active. */
export function hasEpubDisplayOverride(
    settings: Pick<HiLighterSettings, 'epubFontFamily' | 'epubFontSize' | 'epubLineHeight' | 'epubPageMargin' | 'epubPageTheme'>,
): boolean {
    return hasEpubTypographyOverride(settings) || hasEpubPageThemeOverride(settings);
}

/** Surface the menu needs from the hosting reader view. */
export interface EpubFontMenuHost {
    /** The live plugin settings object (mutated in place). */
    settings: HiLighterSettings;
    /** Persists the settings (plugin.saveSettings). */
    save(): Promise<void>;
    /** Re-applies the rendition theme, then refreshes the open menu. */
    applyDisplay(): void;
    /** Notifies the view that the override state changed (toolbar hint). */
    onOverrideChange(hasOverride: boolean): void;
}

/** A display patch: undefined fields stay untouched. */
export type EpubTypographyPatch = {
    family?: string;
    size?: number | null;
    lineHeight?: number | null;
    margin?: number | null;
    pageTheme?: string | null;
};

/** One label + [-] value [+] stepper row. */
function stepperRow(
    menu: HTMLElement,
    labelKey: string,
    valueText: string,
    decLabel: string,
    incLabel: string,
    onDec: () => void,
    onInc: () => void,
    atMin: boolean,
    atMax: boolean,
): void {
    const row = menu.createDiv('hl-epub-size-row');
    row.createSpan({ cls: 'hl-epub-size-name', text: t(labelKey) });

    const smaller = row.createDiv(`hl-epub-size-btn${atMin ? ' is-disabled' : ''}`);
    setIcon(smaller.createSpan(), 'minus');
    smaller.setAttribute('aria-label', decLabel);
    smaller.setAttribute('title', decLabel);
    const value = row.createDiv('hl-epub-size-value');
    value.setText(valueText);
    const bigger = row.createDiv(`hl-epub-size-btn${atMax ? ' is-disabled' : ''}`);
    setIcon(bigger.createSpan(), 'plus');
    bigger.setAttribute('aria-label', incLabel);
    bigger.setAttribute('title', incLabel);

    smaller.onclick = () => onDec();
    bigger.onclick = () => onInc();
}

/**
 * Rebuilds an open epub dropdown in place, keeping class + position
 * (shared by the bookmarks and typography menus).
 */
export function rerenderEpubMenuInPlace(
    menu: HTMLElement,
    render: (menu: HTMLElement) => void,
): void {
    const cls = menu.className;
    const left = menu.style.left;
    const top = menu.style.top;
    menu.className = cls;
    menu.style.left = left;
    menu.style.top = top;
    menu.empty();
    render(menu);
}

/** Typography dropdown: page colors first, spacing steppers, then fonts. */
export function appendEpubFontMenu(menu: HTMLElement, host: EpubFontMenuHost): void {
    const settings = host.settings;

    // ── Page color (background + paired text; EPUB pages only) ──
    const pageThemeLabel = menu.createDiv('hl-epub-font-section');
    pageThemeLabel.setText(t('epub.pageTheme'));
    const swatches = menu.createDiv('hl-epub-theme-swatches');
    const activePageTheme = epubPageTheme(settings.epubPageTheme).id;
    EPUB_PAGE_THEME_OPTIONS.forEach(option => {
        const active = activePageTheme === option.id;
        const swatch = swatches.createDiv(`hl-epub-theme-swatch${active ? ' is-active' : ''}`);
        // Default follows Obsidian: preview it with the vault's page color.
        swatch.style.background = option.background || 'var(--background-primary)';
        // The ink glyph previews the paired text color (default: vault ink).
        const ink = swatch.createSpan('hl-epub-theme-swatch-ink');
        ink.setText('文');
        ink.style.color = option.text || 'var(--text-normal)';
        const label = t(option.labelKey);
        swatch.setAttribute('role', 'button');
        swatch.setAttribute('tabindex', '0');
        swatch.setAttribute('aria-label', label);
        swatch.setAttribute('title', label);
        swatch.onclick = () => {
            void applyDisplayPatch(host, { pageTheme: option.id });
        };
        swatch.onkeydown = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void applyDisplayPatch(host, { pageTheme: option.id });
            }
        };
    });

    // ── Font size / line height / page margins ──
    // (no section headers: each stepper row already carries its label)
    const size = clampEpubFontSize(settings.epubFontSize);
    const sizeBase = size ?? EPUB_FONT_SIZE_DEFAULT;
    stepperRow(
        menu,
        'epub.fontSize',
        size !== undefined ? `${size}px` : t('epub.sizeTheme'),
        t('epub.sizeSmaller'),
        t('epub.sizeLarger'),
        () => { void applyDisplayPatch(host, { size: sizeBase - 1 }); },
        () => { void applyDisplayPatch(host, { size: sizeBase + 1 }); },
        sizeBase <= EPUB_FONT_SIZE_MIN,
        sizeBase >= EPUB_FONT_SIZE_MAX,
    );

    const lineHeight = clampEpubLineHeight(settings.epubLineHeight);
    const lineHeightBase = lineHeight ?? EPUB_LINE_HEIGHT_DEFAULT;
    stepperRow(
        menu,
        'epub.lineHeight',
        lineHeight !== undefined ? lineHeight.toFixed(1) : t('epub.sizeTheme'),
        t('epub.lineHeightTighter'),
        t('epub.lineHeightLooser'),
        () => { void applyDisplayPatch(host, { lineHeight: Math.round((lineHeightBase - 0.1) * 10) / 10 }); },
        () => { void applyDisplayPatch(host, { lineHeight: Math.round((lineHeightBase + 0.1) * 10) / 10 }); },
        lineHeightBase <= EPUB_LINE_HEIGHT_MIN,
        lineHeightBase >= EPUB_LINE_HEIGHT_MAX,
    );

    const margin = clampEpubMargin(settings.epubPageMargin);
    const marginBase = margin ?? EPUB_MARGIN_DEFAULT;
    stepperRow(
        menu,
        'epub.pageMargin',
        margin !== undefined ? `${margin}px` : t('epub.sizeTheme'),
        t('epub.marginNarrower'),
        t('epub.marginWider'),
        () => { void applyDisplayPatch(host, { margin: marginBase - 2 }); },
        () => { void applyDisplayPatch(host, { margin: marginBase + 2 }); },
        marginBase <= EPUB_MARGIN_MIN,
        marginBase >= EPUB_MARGIN_MAX,
    );

    // ── Font family (grouped: CJK-focused, then latin-focused) ──
    const groups: Array<{ key: string; options: typeof EPUB_FONT_OPTIONS }> = [
        { key: 'epub.fontGroupZh', options: EPUB_FONT_OPTIONS.filter(o => o.group === 'zh') },
        { key: 'epub.fontGroupEn', options: EPUB_FONT_OPTIONS.filter(o => o.group === 'en') },
    ];
    const activeFamily = settings.epubFontFamily || 'theme';
    groups.forEach(group => {
        const groupLabel = menu.createDiv('hl-epub-font-section');
        groupLabel.setText(t(group.key));
        const list = menu.createDiv('hl-epub-font-list');
        group.options.forEach(option => {
            const active = activeFamily === option.id;
            const row = list.createDiv(`hl-epub-font-row${active ? ' is-active' : ''}`);
            row.setAttribute('role', 'button');
            row.setAttribute('tabindex', '0');
            row.createSpan({ cls: 'hl-epub-font-name', text: t(option.labelKey) });
            if (active) {
                setIcon(row.createSpan('hl-epub-font-check'), 'check');
            }
            row.onclick = () => {
                void applyDisplayPatch(host, { family: option.id });
            };
            row.onkeydown = (event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void applyDisplayPatch(host, { family: option.id });
                }
            };
        });
    });

    // ── Reset (always last) ──
    if (hasEpubDisplayOverride(settings)) {
        const reset = menu.createDiv('hl-epub-font-reset');
        reset.setAttribute('role', 'button');
        reset.setText(t('epub.sizeResetAll'));
        reset.onclick = () => {
            void applyDisplayPatch(host, {
                family: 'theme',
                size: null,
                lineHeight: null,
                margin: null,
                pageTheme: null,
            });
        };
    }
}

/**
 * Applies a display change: persist, re-register the rendition theme
 * (epub.js re-injects the default theme rules into already rendered
 * iframes), and refresh the open menu + toolbar hint.
 */
async function applyDisplayPatch(
    host: EpubFontMenuHost,
    patch: EpubTypographyPatch,
): Promise<void> {
    const settings = host.settings;
    if (typeof patch.family === 'string') {
        settings.epubFontFamily = patch.family === 'theme' ? '' : patch.family;
    }
    if (patch.size === null) {
        settings.epubFontSize = undefined;
    } else if (typeof patch.size === 'number') {
        const clamped = clampEpubFontSize(patch.size);
        if (clamped === undefined) return;
        settings.epubFontSize = clamped;
    }
    if (patch.lineHeight === null) {
        settings.epubLineHeight = undefined;
    } else if (typeof patch.lineHeight === 'number') {
        const clamped = clampEpubLineHeight(patch.lineHeight);
        if (clamped === undefined) return;
        settings.epubLineHeight = clamped;
    }
    if (patch.margin === null) {
        settings.epubPageMargin = undefined;
    } else if (typeof patch.margin === 'number') {
        const clamped = clampEpubMargin(patch.margin);
        if (clamped === undefined) return;
        settings.epubPageMargin = clamped;
    }
    if (patch.pageTheme === null) {
        settings.epubPageTheme = undefined;
    } else if (typeof patch.pageTheme === 'string') {
        settings.epubPageTheme = patch.pageTheme === 'default' ? undefined : patch.pageTheme;
    }
    await host.save();
    host.applyDisplay();
    host.onOverrideChange(hasEpubDisplayOverride(settings));
}
