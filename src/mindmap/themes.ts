// ============================================================
// HiLighter - Mind map theme presets
// ============================================================
// Each preset is a distinct line + node-border style (the "theme"
// concept in Xmind). Themes differ in line style (curve/straight/
// direct — the layout falls back on its own when unsupported),
// line WIDTH, branch coloring (solid vs rainbow) and node shapes.
// Colors come from the selected palette preset (palettes.ts); the
// accent drives the root fill and associative lines.

import { type ThemePalette } from './palettes';

export type MindMapSpacing = 'spread' | 'compact';

/** Xmind-style rainbow branch colors (cycled across first-level branches). */
const RAINBOW_COLORS = [
    'rgb(255, 180, 84)',
    'rgb(255, 136, 126)',
    'rgb(107, 200, 141)',
    'rgb(112, 161, 255)',
    'rgb(129, 210, 242)',
    'rgb(226, 132, 224)',
    'rgb(152, 132, 234)',
];

export interface MindMapThemePreset {
    id: string;
    labelKey: string;
    build: (dark: boolean, accent: string, spacing: MindMapSpacing, colors: ThemePalette) => Record<string, unknown>;
}

interface BaseOptions {
    lineStyle: string;
    secondShape: string;
    nodeShape: string;
    borderWidth: number;
    lineWidth: number;
    rainbow?: boolean;
    boldRoot?: boolean;
    coloredBranchBorders?: boolean;
}

function base(p: ThemePalette, accent: string, spacing: MindMapSpacing, o: BaseOptions): Record<string, unknown> {
    const spread = spacing === 'spread';
    return {
        backgroundColor: p.bg,
        lineColor: p.line,
        lineWidth: o.lineWidth,
        lineStyle: o.lineStyle,
        rootLineKeepSameInCurve: true,
        paddingX: spread ? 18 : 10,
        paddingY: spread ? 12 : 6,
        // Rainbow branch coloring (simple-mind-map RainbowLines plugin)
        rainbowLinesConfig: { open: !!o.rainbow, colorsList: RAINBOW_COLORS },
        root: {
            fillColor: accent,
            color: '#ffffff',
            borderColor: accent,
            borderWidth: 0,
            fontSize: 18,
            fontWeight: o.boldRoot ? 800 : 'bold',
            shape: 'roundedRectangle',
            marginX: spread ? 40 : 24,
            marginY: spread ? 24 : 14,
            paddingX: spread ? 20 : 12,
            paddingY: spread ? 14 : 8,
        },
        second: {
            fillColor: p.nodeFill,
            color: p.nodeInk,
            borderColor: o.coloredBranchBorders ? accent : p.line,
            borderWidth: o.borderWidth,
            fontSize: 14,
            shape: o.secondShape,
            marginX: spread ? 36 : 20,
            marginY: spread ? 18 : 8,
            paddingX: spread ? 14 : 8,
            paddingY: spread ? 9 : 5,
        },
        node: {
            fillColor: p.nodeFill,
            color: p.nodeInk,
            borderColor: p.nodeBorder,
            borderWidth: o.borderWidth,
            fontSize: 12,
            shape: o.nodeShape,
            marginX: spread ? 28 : 14,
            marginY: spread ? 12 : 4,
            paddingX: spread ? 12 : 6,
            paddingY: spread ? 7 : 3,
        },
        expandBtn: {
            fillColor: p.nodeFill,
            borderColor: p.nodeBorder,
            color: p.nodeInk,
        },
        associativeLine: {
            color: accent,
        },
    };
}

/** The selectable theme presets (Xmind-like line/border styles). */
export const THEME_PRESETS: MindMapThemePreset[] = [
    {
        // Curves, rounded nodes, medium lines — the balanced default.
        id: 'classic',
        labelKey: 'mindmap.theme.classic',
        build: (dark, accent, spacing, colors: ThemePalette) =>
            base(colors, accent, spacing, {
                lineStyle: 'curve',
                secondShape: 'roundedRectangle',
                nodeShape: 'roundedRectangle',
                borderWidth: 1,
                lineWidth: 2,
            }),
    },
    {
        // Straight thick lines, square nodes, bold headings.
        id: 'business',
        labelKey: 'mindmap.theme.business',
        build: (dark, accent, spacing, colors: ThemePalette) =>
            base(colors, accent, spacing, {
                lineStyle: 'straight',
                secondShape: 'rectangle',
                nodeShape: 'rectangle',
                borderWidth: 1.5,
                lineWidth: 3,
                rainbow: true,
                boldRoot: true,
            }),
    },
    {
        // Thin attached lines — minimal ink.
        id: 'direct',
        labelKey: 'mindmap.theme.direct',
        build: (dark, accent, spacing, colors: ThemePalette) =>
            base(colors, accent, spacing, {
                lineStyle: 'direct',
                secondShape: 'rectangle',
                nodeShape: 'rectangle',
                borderWidth: 1,
                lineWidth: 1.5,
            }),
    },
    {
        // Borderless text blocks with hairlines.
        id: 'outline',
        labelKey: 'mindmap.theme.outline',
        build: (dark, accent, spacing, colors: ThemePalette) => {
            const p = colors;
            const cfg = base(p, accent, spacing, {
                lineStyle: 'straight',
                secondShape: 'rectangle',
                nodeShape: 'rectangle',
                borderWidth: 0,
                lineWidth: 1,
            });
            (cfg.second as Record<string, unknown>).fillColor = p.bg;
            (cfg.node as Record<string, unknown>).fillColor = p.bg;
            (cfg.node as Record<string, unknown>).color = dark ? '#c3cad6' : '#5a6472';
            return cfg;
        },
    },
    {
        // Ellipse nodes, thick rainbow branch lines.
        id: 'capsule',
        labelKey: 'mindmap.theme.capsule',
        build: (dark, accent, spacing, colors: ThemePalette) => {
            const cfg = base(colors, accent, spacing, {
                lineStyle: 'curve',
                secondShape: 'ellipse',
                nodeShape: 'ellipse',
                borderWidth: 0,
                lineWidth: 3.5,
                rainbow: true,
            });
            (cfg.root as Record<string, unknown>).shape = 'ellipse';
            return cfg;
        },
    },
    {
        // Octagonal frames with heavy strokes — a hand-drawn feel.
        id: 'sketch',
        labelKey: 'mindmap.theme.sketch',
        build: (dark, accent, spacing, colors: ThemePalette) =>
            base(colors, accent, spacing, {
                lineStyle: 'curve',
                secondShape: 'octagonalRectangle',
                nodeShape: 'octagonalRectangle',
                borderWidth: 2,
                lineWidth: 2.5,
                coloredBranchBorders: true,
            }),
    },
];

/**
 * Combines a style preset with a color palette: the single entry point
 * the engine uses to build a full theme config.
 */
export function composeTheme(
    themeId: string,
    colors: ThemePalette,
    accent: string,
    spacing: MindMapSpacing,
    dark: boolean,
): Record<string, unknown> {
    const preset = THEME_PRESETS.find(t => t.id === themeId) ?? THEME_PRESETS[0]!;
    return preset.build(dark, accent, spacing, colors);
}
