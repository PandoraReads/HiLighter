import { describe, it, expect } from 'vitest';
import { setLang } from '../src/i18n';
import {
    getColors,
    getColorDef,
    resolveHex,
    isValidColorId,
    newCustomColorId,
    generateCustomColorCss,
    PRESET_COLOR_IDS,
} from '../src/colors';
import { DEFAULT_SETTINGS } from '../src/models';
import type { HiLighterSettings } from '../src/models';

function settingsWith(customColors: { id: string; name: string; hex: string }[]): HiLighterSettings {
    return { ...DEFAULT_SETTINGS, customColors };
}

describe('getColors', () => {
    it('returns presets first with semantic labels overriding locale fallbacks', () => {
        setLang('en');
        const s = { ...DEFAULT_SETTINGS, colorLabels: { yellow: 'Questions', pink: '', blue: '', green: '' } };
        const colors = getColors(s);
        expect(colors.map(c => c.id)).toEqual([...PRESET_COLOR_IDS]);
        expect(colors[0]!.label).toBe('Questions');
        expect(colors[1]!.label).toBe('Pink');
    });

    it('appends custom colors after presets', () => {
        const colors = getColors(settingsWith([{ id: 'c_abcd1234', name: '紫色', hex: '#b39ddb' }]));
        expect(colors).toHaveLength(5);
        expect(colors[4]).toMatchObject({ id: 'c_abcd1234', label: '紫色', hex: '#b39ddb', isCustom: true });
    });
});

describe('color resolution', () => {
    const s = settingsWith([{ id: 'c_abcd1234', name: '', hex: '#b39ddb' }]);

    it('getColorDef finds presets and customs', () => {
        expect(getColorDef(s, 'yellow')?.hex).toBe('#ffd700');
        expect(getColorDef(s, 'c_abcd1234')?.isCustom).toBe(true);
        expect(getColorDef(s, 'nope')).toBeUndefined();
    });

    it('resolveHex falls back to gray for unknown ids', () => {
        expect(resolveHex(s, 'pink')).toBe('#ff8fb7');
        expect(resolveHex(s, 'c_abcd1234')).toBe('#b39ddb');
        expect(resolveHex(s, 'nope')).toBe('#9e9e9e');
    });

    it('isValidColorId accepts presets and defined customs only', () => {
        expect(isValidColorId(s, 'green')).toBe(true);
        expect(isValidColorId(s, 'c_abcd1234')).toBe(true);
        expect(isValidColorId(s, 'c_ffffffff')).toBe(false);
    });

    it('newCustomColorId matches the c_XXXXXXXX shape', () => {
        expect(newCustomColorId()).toMatch(/^c_[0-9a-f]{8}$/);
    });
});

describe('generateCustomColorCss', () => {
    it('emits light + dark mark rules and UI dot rules per custom color', () => {
        const css = generateCustomColorCss(settingsWith([{ id: 'c_abcd1234', name: '', hex: '#b39ddb' }]));
        expect(css).toContain('mark.hl-h-c_abcd1234 {');
        expect(css).toContain('.theme-dark mark.hl-h-c_abcd1234 {');
        expect(css).toContain('background-color: #');
        expect(css).toContain('.hl-h-color-dot.c_abcd1234 { background: #b39ddb; }');
        expect(css).toContain('.hl-studio-card.border-c_abcd1234 { border-left-color: #b39ddb; }');
    });

    it('produces valid darker backgrounds for dark mode and pastels for light mode', () => {
        const css = generateCustomColorCss(settingsWith([{ id: 'c_abcd1234', name: '', hex: '#b39ddb' }]));
        const lightBg = css.match(/^mark\.hl-h-c_abcd1234 \{ background-color: (#[0-9a-f]{6})/m)?.[1]!;
        const darkBg = css.match(/^\.theme-dark mark\.hl-h-c_abcd1234 \{ background-color: (#[0-9a-f]{6})/m)?.[1]!;
        const lum = (hex: string) => {
            const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        expect(lum(lightBg)).toBeGreaterThan(200);  // pastel
        expect(lum(darkBg)).toBeLessThan(90);       // deep tone
    });

    it('skips malformed hexes and returns empty when no customs exist', () => {
        expect(generateCustomColorCss(settingsWith([]))).toBe('');
        expect(generateCustomColorCss(settingsWith([{ id: 'c_bad00001', name: '', hex: 'oops' }]))).toBe('');
    });
});
