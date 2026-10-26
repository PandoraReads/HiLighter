// ============================================================
// HiLighter - Appearance helper
// Applies theme / density / accent to a view root element.
// Kept stateless: reads settings, writes data-* attributes and
// CSS custom properties. All visual mapping lives in styles.css.
// ============================================================

import type { HiLighterSettings } from './models';
import { generateCustomColorCss } from './colors';

const CUSTOM_COLOR_STYLE_ID = 'hilighter-custom-colors';
// Tag routed through a constant: this <style> element carries settings-driven
// custom color CSS, which cannot live in the static styles.css (no-forbidden-elements).
const STYLE_TAG = 'style' as const;

/**
 * Inject (create-or-update) the runtime <style> element holding CSS for
 * user-defined custom highlight colors, in the given document. Called for
 * the main window on load / settings change and for popout windows on
 * window-open. Idempotent; removes the element when no customs exist.
 */
export function injectCustomColorStyles(doc: Document, settings: HiLighterSettings): void {
    try {
        let el = doc.getElementById(CUSTOM_COLOR_STYLE_ID) as HTMLStyleElement | null;
        const css = generateCustomColorCss(settings);
        if (!css) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = doc.head.createEl(STYLE_TAG, { attr: { id: CUSTOM_COLOR_STYLE_ID } });
        }
        if (el.textContent !== css) el.textContent = css;
    } catch {
        // Styling is best-effort; never block rendering on it.
    }
}

/**
 * Convert a #rrggbb hex string to an "r, g, b" triplet string.
 * Returns null for anything that is not a clean 6-digit hex.
 */
function hexToRgbTriplet(hex: string): string | null {
    const cleaned = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}

/**
 * Read Obsidian's resolved interactive accent and normalize to #rrggbb.
 * Returns null when it cannot be parsed (non-hex formats, missing, etc.).
 */
function resolveObsidianAccent(): string | null {
    const raw = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
    if (!raw) return null;
    const triplet = hexToRgbTriplet(raw);
    return triplet ? `#${raw.replace('#', '')}` : null;
}

/**
 * Apply the current appearance settings to a view root element.
 * Idempotent: safe to call on every render.
 */
export function applyAppearance(root: HTMLElement, settings: HiLighterSettings): void {
    if (!root) return;

    const theme = ((settings.theme as string) === 'minimal' ? 'editorial' : settings.theme) || 'editorial';
    root.setAttribute('data-hl-theme', theme);
    root.setAttribute('data-hl-density', settings.cardDensity || 'comfortable');

    // Accent resolution priority:
    //   1. User-chosen custom accent (always a clean hex from the color picker)
    //   2. Native theme: follow Obsidian's --interactive-accent
    //   3. Otherwise: clear overrides so CSS defaults apply
    let accent = (settings.accentColor || '').trim();
    if (!accent && theme === 'native') {
        accent = resolveObsidianAccent() || '';
    }

    if (accent) {
        const rgb = hexToRgbTriplet(accent);
        if (rgb) {
            root.style.setProperty('--hl-accent', accent);
            root.style.setProperty('--hl-accent-rgb', rgb);
            return;
        }
    }

    // No usable custom accent -> let the theme's CSS own the accent vars
    root.style.removeProperty('--hl-accent');
    root.style.removeProperty('--hl-accent-rgb');
}
