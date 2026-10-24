// ============================================================
// HiLighter - Color system (single source of truth)
// ============================================================
// Presets keep their ids ('yellow'|'pink'|'blue'|'green'); custom
// colors get ids like 'c_a1b2c3d4'. Marks carry the class
// `hl-h-{id}` plus a `data-hl-color="{hex}"` snapshot so custom
// colors survive even if their definition is later deleted.

import type { HiLighterSettings } from './models';
import { t } from './i18n';

export const PRESET_COLOR_IDS: readonly string[] = ['yellow', 'pink', 'blue', 'green'];

/** Canonical UI hexes (dots, borders, filter swatches). */
export const PRESET_UI_HEX: Record<string, string> = {
    yellow: '#ffd700',
    pink: '#ff8fb7',
    blue: '#87ceeb',
    green: '#98fb98',
};

/** In-note <mark> background + text colors (light theme, mirrors styles.css). */
export const PRESET_MARK_LIGHT: Record<string, { bg: string; fg: string }> = {
    yellow: { bg: '#fffac1', fg: '#433e00' },
    pink: { bg: '#ffe1ea', fg: '#4a001a' },
    blue: { bg: '#e1f5fe', fg: '#003a52' },
    green: { bg: '#e8f5e9', fg: '#1b5e20' },
};

/** In-note <mark> background + text colors (dark theme, mirrors styles.css). */
export const PRESET_MARK_DARK: Record<string, { bg: string; fg: string }> = {
    yellow: { bg: '#615a00', fg: '#ffffff' },
    pink: { bg: '#610029', fg: '#ffffff' },
    blue: { bg: '#004d61', fg: '#ffffff' },
    green: { bg: '#1b5e20', fg: '#ffffff' },
};

export interface ColorDef {
    id: string;
    label: string;      // semantic label or locale fallback / custom name
    hex: string;        // UI hex (dots/borders)
    isCustom: boolean;
}

/** Normalize persisted custom-color data before it reaches rendering code. */
export function normalizeCustomColors(value: unknown): NonNullable<HiLighterSettings['customColors']> {
    const entries = Array.isArray(value)
        ? value
        : value && typeof value === 'object'
            ? ('id' in value && 'hex' in value
                ? [value]
                : Object.values(value as Record<string, unknown>))
            : [];

    return entries.filter((entry): entry is { id: string; name?: string; hex: string } => {
        if (!entry || typeof entry !== 'object') return false;
        const color = entry as Record<string, unknown>;
        return typeof color.id === 'string'
            && /^c_[0-9a-f]{8}$/i.test(color.id)
            && typeof color.hex === 'string'
            && /^#[0-9a-f]{6}$/i.test(color.hex)
            && (color.name === undefined || typeof color.name === 'string');
    }).map((color) => ({
        id: color.id,
        name: color.name || '',
        hex: color.hex,
    }));
}

/** All colors available for highlighting: presets first, then customs. */
export function getColors(settings: HiLighterSettings): ColorDef[] {
    const presets: ColorDef[] = PRESET_COLOR_IDS.map(id => ({
        id,
        label: (settings.colorLabels as Record<string, string>)?.[id] || t('toolbar.filter.' + id),
        hex: PRESET_UI_HEX[id]!,
        isCustom: false,
    }));
    const customs: ColorDef[] = normalizeCustomColors(settings.customColors).map(c => ({
        id: c.id,
        label: c.name || c.hex,
        hex: c.hex,
        isCustom: true,
    }));
    return [...presets, ...customs];
}

/** Look up one color definition by id (preset or custom). */
export function getColorDef(settings: HiLighterSettings, id: string): ColorDef | undefined {
    return getColors(settings).find(c => c.id === id);
}

/** Resolve a UI hex for a color id; falls back to gray for unknown ids. */
export function resolveHex(settings: HiLighterSettings, id: string): string {
    return getColorDef(settings, id)?.hex ?? '#9e9e9e';
}

/** Is this id a valid highlight color (preset or defined custom)? */
export function isValidColorId(settings: HiLighterSettings, id: string): boolean {
    if (PRESET_COLOR_IDS.includes(id)) return true;
    return (settings.customColors || []).some(c => c.id === id);
}

/** Generates a fresh custom color id ('c_' + 8 hex chars). */
export function newCustomColorId(): string {
    let out = '';
    for (let i = 0; i < 8; i++) out += Math.floor(Math.random() * 16).toString(16);
    return 'c_' + out;
}

/** Matches the hl-h-{id} class inside a <mark> tag (for color swaps). */
export const COLOR_CLASS_RE = /hl-h-([A-Za-z0-9_-]+)/;

// ── Dark variant derivation for custom colors ──────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean;
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
    };
}

function rgbToHex(r: number, g: number, b: number): string {
    const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return { h: h / 6, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    const hue2rgb = (p: number, q: number, tRaw: number) => {
        let t = tRaw;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    if (s === 0) {
        const v = Math.round(l * 255);
        return rgbToHex(v, v, v);
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hue2rgb(p, q, h + 1 / 3) * 255;
    const g = hue2rgb(p, q, h) * 255;
    const b = hue2rgb(p, q, h - 1 / 3) * 255;
    return rgbToHex(r, g, b);
}

/** Light-theme <mark> style: pastel background (~78% white blend) + deep tone text. */
function deriveMarkLight(hex: string): { bg: string; fg: string } {
    const { r, g, b } = hexToRgb(hex);
    const bg = rgbToHex(0.78 * 255 + 0.22 * r, 0.78 * 255 + 0.22 * g, 0.78 * 255 + 0.22 * b);
    const { h, s } = rgbToHsl(r, g, b);
    const fg = hslToHex(h, Math.min(1, s * 0.95), 0.22);
    return { bg, fg };
}

/** Dark-theme <mark> style: deep tone background + white text (mirrors presets). */
function deriveMarkDark(hex: string): { bg: string; fg: string } {
    const { r, g, b } = hexToRgb(hex);
    const { h, s } = rgbToHsl(r, g, b);
    const bg = hslToHex(h, Math.min(0.85, s * 0.85), 0.24);
    return { bg, fg: '#ffffff' };
}

/**
 * CSS injected at runtime for custom colors: one light rule + one
 * .theme-dark rule per id, matching the preset rules' selector shape
 * (with !important) so they win the cascade in every theme.
 */
export function generateCustomColorCss(settings: HiLighterSettings): string {
    const customs = settings.customColors || [];
    if (customs.length === 0) return '';

    const chunks: string[] = [];
    customs.forEach(c => {
        if (!/^#[0-9a-fA-F]{6}$/.test(c.hex)) return;
        const light = deriveMarkLight(c.hex);
        const dark = deriveMarkDark(c.hex);
        chunks.push(
            `mark.hl-h-${c.id} { background-color: ${light.bg} !important; background-image: none !important; color: ${light.fg} !important; }`,
            `.theme-dark mark.hl-h-${c.id} { background-color: ${dark.bg} !important; background-image: none !important; color: ${dark.fg} !important; }`,
            `.hl-h-color-dot.${c.id} { background: ${c.hex}; }`,
            `.hl-color-dot.dot-${c.id} { background: ${c.hex}; }`,
            `.hl-list-row.color-${c.id} .hl-list-dot { background: ${c.hex}; }`,
            `.hl-highlight-card.border-${c.id} { border-left-color: ${c.hex}; }`,
            `.hl-studio-card.border-${c.id} { border-left-color: ${c.hex}; }`,
        );
    });
    return chunks.join('\n');
}
