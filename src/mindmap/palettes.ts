// ============================================================
// HiLighter - Mind map color palettes
// ============================================================
// The second theme dimension: color schemes (background, line, node
// fill/ink/border, root accent), orthogonal to the style presets in
// themes.ts (line shape/width + node shapes). Any style theme can be
// combined with any palette. Each palette ships light + dark values.

export interface ThemePalette {
    bg: string;
    line: string;
    nodeFill: string;
    nodeInk: string;
    nodeBorder: string;
    /** Root fill / associative-line color; falls back to the plugin accent. */
    accent?: string;
}

/**
 * How highlight-card leaf borders are colored:
 * - 'tint': the palette's own line color, fading toward the background
 *   as nodes go deeper (level-tinted, always on-palette).
 * - 'card': each leaf keeps its highlight card's color (multicolored).
 */
export type LeafBorderMode = 'tint' | 'card';

export interface PalettePreset {
    id: string;
    labelKey: string;
    leafBorder: LeafBorderMode;
    light: ThemePalette;
    dark: ThemePalette;
}

/** Linear RGB mix of two hex colors (t=0 → a, t=1 → b). */
export function mixHex(a: string, b: string, t: number): string {
    const parse = (hex: string): [number, number, number] => {
        const clean = hex.replace('#', '');
        const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
        return [
            parseInt(full.slice(0, 2), 16),
            parseInt(full.slice(2, 4), 16),
            parseInt(full.slice(4, 6), 16),
        ];
    };
    const [r1, g1, b1] = parse(a);
    const [r2, g2, b2] = parse(b);
    const to = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x + (y - x) * t)));
    return `#${[to(r1, r2), to(g1, g2), to(b1, b2)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Leaf border color for a node at the given depth (root = 0). */
export function tintedBorder(palette: ThemePalette, depth: number): string {
    const t = Math.min(0.75, Math.max(0, (depth - 1) * 0.22));
    return mixHex(palette.line, palette.bg, t);
}

/** The original (default) scheme, previously hardcoded in themes.ts. */
export const DEFAULT_PALETTE_LIGHT: ThemePalette = {
    bg: '#fafafa',
    line: '#a8b1bf',
    nodeFill: '#ffffff',
    nodeInk: '#333a45',
    nodeBorder: '#d8dee8',
};

export const DEFAULT_PALETTE_DARK: ThemePalette = {
    bg: '#1e222a',
    line: '#4b5566',
    nodeFill: '#272c38',
    nodeInk: '#dde2ec',
    nodeBorder: '#3c4354',
};

export const PALETTE_PRESETS: PalettePreset[] = [
    {
        id: 'default',
        labelKey: 'mindmap.palette.default',
        leafBorder: 'tint',
        light: DEFAULT_PALETTE_LIGHT,
        dark: DEFAULT_PALETTE_DARK,
    },
    {
        id: 'ocean',
        labelKey: 'mindmap.palette.ocean',
        leafBorder: 'tint',
        light: { bg: '#f2f8fd', line: '#8fb6d9', nodeFill: '#ffffff', nodeInk: '#274357', nodeBorder: '#c3dbee', accent: '#3d7fc1' },
        dark: { bg: '#101c28', line: '#35506b', nodeFill: '#1a2c3d', nodeInk: '#d7e5f0', nodeBorder: '#2c465c', accent: '#5b9bd9' },
    },
    {
        id: 'forest',
        labelKey: 'mindmap.palette.forest',
        leafBorder: 'tint',
        light: { bg: '#f3faf4', line: '#93bf9f', nodeFill: '#ffffff', nodeInk: '#24402e', nodeBorder: '#c8e2cf', accent: '#3e7d5a' },
        dark: { bg: '#101d14', line: '#35543f', nodeFill: '#1a2d20', nodeInk: '#d9ecdd', nodeBorder: '#2c4835', accent: '#5da878' },
    },
    {
        id: 'sunset',
        labelKey: 'mindmap.palette.sunset',
        leafBorder: 'tint',
        light: { bg: '#fdf6f0', line: '#d9b49a', nodeFill: '#ffffff', nodeInk: '#4a3222', nodeBorder: '#f0d6c2', accent: '#d97a3d' },
        dark: { bg: '#201610', line: '#5c4232', nodeFill: '#2d2017', nodeInk: '#f2e3d5', nodeBorder: '#4a352a', accent: '#e8945c' },
    },
    {
        id: 'sakura',
        labelKey: 'mindmap.palette.sakura',
        leafBorder: 'tint',
        light: { bg: '#fdf3f6', line: '#d9a8ba', nodeFill: '#ffffff', nodeInk: '#4a2a36', nodeBorder: '#f2d3dd', accent: '#d96b8f' },
        dark: { bg: '#201317', line: '#5c3a47', nodeFill: '#2d1a21', nodeInk: '#f2dbe3', nodeBorder: '#4a2c37', accent: '#e88aa9' },
    },
    {
        id: 'grape',
        labelKey: 'mindmap.palette.grape',
        leafBorder: 'tint',
        light: { bg: '#f7f4fd', line: '#b3a3e0', nodeFill: '#ffffff', nodeInk: '#32284a', nodeBorder: '#dcd2f0', accent: '#7d5fd3' },
        dark: { bg: '#16121f', line: '#42375c', nodeFill: '#211a30', nodeInk: '#e6def5', nodeBorder: '#352b4a', accent: '#9a82e8' },
    },
    {
        id: 'mono',
        labelKey: 'mindmap.palette.mono',
        leafBorder: 'tint',
        light: { bg: '#f7f7f7', line: '#9e9e9e', nodeFill: '#ffffff', nodeInk: '#262626', nodeBorder: '#d9d9d9', accent: '#3a3a3a' },
        dark: { bg: '#161616', line: '#4d4d4d', nodeFill: '#262626', nodeInk: '#eaeaea', nodeBorder: '#3d3d3d', accent: '#bdbdbd' },
    },
    {
        // Multicolored: every leaf keeps its highlight card's own color.
        id: 'colorful',
        labelKey: 'mindmap.palette.colorful',
        leafBorder: 'card',
        light: { ...DEFAULT_PALETTE_LIGHT, accent: '#f2a33c' },
        dark: { ...DEFAULT_PALETTE_DARK, accent: '#f2a33c' },
    },
];

/** Resolves a palette id to its light/dark colors (unknown → default). */
export function resolvePalette(paletteId: string, dark: boolean): ThemePalette {
    const preset = PALETTE_PRESETS.find(p => p.id === paletteId) ?? PALETTE_PRESETS[0]!;
    return dark ? preset.dark : preset.light;
}

/** How leaf borders should be colored for a palette id. */
export function resolveLeafBorderMode(paletteId: string): LeafBorderMode {
    return (PALETTE_PRESETS.find(p => p.id === paletteId) ?? PALETTE_PRESETS[0]!).leafBorder;
}
