// ============================================================
// HiLighter - Mind map engine (simple-mind-map wrapper)
// ============================================================
// Every third-party mind map engine call lives in this file so
// build/persist/view code never touches the library directly —
// swapping engines later means rewriting one module, not the feature.
//
// simple-mind-map ships no TypeScript types, so the engine surface is
// `any` inside this file by necessity; all PUBLIC methods return typed
// values so the `any` never leaks into the rest of the feature.

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- simple-mind-map is an untyped third-party library; this file is the only place it may be touched */

import MindMap from 'simple-mind-map';
import Drag from 'simple-mind-map/src/plugins/Drag.js';
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js';
import Export from 'simple-mind-map/src/plugins/Export.js';
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js';
import RainbowLines from 'simple-mind-map/src/plugins/RainbowLines.js';
import Select from 'simple-mind-map/src/plugins/Select.js';
import type { MindMapNode } from './build';
import { composeTheme, type MindMapSpacing } from './themes';
import { resolveLeafBorderMode, resolvePalette, tintedBorder } from './palettes';
import { interactionOptions, type MindMapInteraction } from './interaction';

export type { MindMapSpacing };

/** Chat-bubble note icon (replaces the library's default document glyph). */
const NOTE_BUBBLE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1024 1024"><path fill-opacity="0.45" d="M810.666667 128H213.333333a128 128 0 0 0-128 128v469.333333a128 128 0 0 0 128 128h149.333334a42.666667 42.666667 0 0 1 30.165333 12.501334l76.501333 76.501333a42.666667 42.666667 0 0 0 60.330667 0l76.501333-76.501333A42.666667 42.666667 0 0 1 636.330667 853.333333H810.666667a128 128 0 0 0 128-128V256a128 128 0 0 0-128-128z m42.666666 597.333333a42.666667 42.666667 0 0 1-42.666666 42.666667h-174.336a128 128 0 0 0-90.496 37.504L512 828.970667l-33.834667-33.469334A128 128 0 0 0 387.669333 768H213.333333a42.666667 42.666667 0 0 1-42.666666-42.666667V256a42.666667 42.666667 0 0 1 42.666666-42.666667h597.333334a42.666667 42.666667 0 0 1 42.666666 42.666667v469.333333zM341.333333 426.666667h341.333334a42.666667 42.666667 0 0 1 0 85.333333H341.333333a42.666667 42.666667 0 0 1 0-85.333333z"/></svg>';

/** The structures exposed in the toolbar (Xmind equivalents). */
export type MindMapLayout =
    | 'logicalStructure'
    | 'logicalStructureLeft'
    | 'mindMap'
    | 'organizationStructure'
    | 'timeline'
    | 'timeline2'
    | 'verticalTimeline'
    | 'fishbone'
    | 'catalogOrganization';

export interface EngineCallbacks {
    onDataChange: (tree: MindMapNode) => void;
    onNodeActive: (node: MindMapNode | null, activeCount: number) => void;
    onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
    onRenderEnd?: () => void;
}

export interface EngineInit {
    el: HTMLElement;
    tree: MindMapNode;
    layout: MindMapLayout;
    spacing: MindMapSpacing;
    themeId: string;
    paletteId: string;
    dark: boolean;
    accent: string;
    cardPrototypes?: ReadonlyMap<string, HTMLElement>;
    callbacks: EngineCallbacks;
}

const PLUGIN_LIST = [Drag, AssociativeLine, Export, ExportXMind, RainbowLines, Select];

/**
 * simple-mind-map only initializes plugins from its STATIC plugin list;
 * the constructor's `plugins` option is ignored. Registration is via
 * MindMap.usePlugin (idempotent) and instances are created per map.
 */
function ensurePluginsRegistered(): void {
    for (const plugin of PLUGIN_LIST) {
        MindMap.usePlugin(plugin);
    }
}

/**
 * Minimal structural surface of the untyped library instance that the
 * engine actually uses. Declaring it keeps every method call below
 * type-checked while the underlying instance stays untyped.
 */
interface SmmInstance {
    on(event: string, cb: (...args: unknown[]) => void): void;
    destroy(): void;
    updateData(data: unknown): void;
    setLayout(layout: string): void;
    setTheme(theme: unknown): void;
    execCommand(name: string, ...args: unknown[]): void;
    getData(includeSelf: boolean): unknown;
    command: { history: unknown[]; activeHistoryIndex: number };
    view: { fit(): void; reset(): void };
    export(type: string, isDownload: boolean, name: string): Promise<void>;
    resize(): void;
    setThemeConfig(config: unknown): void;
    render(): void;
    reRender(): void;
    updateConfig(config: Record<string, unknown>): void;
    renderer?: {
        activeNodeList?: Array<{ getData?: () => Record<string, unknown> }>;
        nodes?: Array<{
            getData?: (includeSelf?: boolean) => { uid?: string; text?: string } | undefined;
            getRect?: () => { x: number; y: number; width: number; height: number };
            left?: number;
            top?: number;
            width?: number;
            height?: number;
        }>;
    };
    associativeLine?: { createLineFromActiveNode(): void; isCreatingLine?: boolean };
}

export class MindMapEngine {
    private mindMap: SmmInstance | null = null;
    private callbacks: EngineCallbacks = {
        onDataChange: () => {},
        onNodeActive: () => {},
        onHistoryChange: () => {},
    };
    private layout: MindMapLayout = 'logicalStructure';
    private spacing: MindMapSpacing = 'spread';
    private themeId = 'classic';
    private paletteId = 'default';
    private dark = false;
    private accent = '#7c6cf2';
    private cardPrototypes: ReadonlyMap<string, HTMLElement> = new Map();
    private compactCards = false;
    private interaction: MindMapInteraction = 'select';

    get instance(): unknown {
        return this.mindMap;
    }

    init(init: EngineInit): void {
        this.destroy();
        ensurePluginsRegistered();
        this.callbacks = init.callbacks;
        this.layout = init.layout;
        this.spacing = init.spacing;
        this.themeId = init.themeId;
        this.paletteId = init.paletteId;
        this.dark = init.dark;
        this.accent = init.accent;
        this.cardPrototypes = init.cardPrototypes ?? new Map();

        this.applyLeafBorders(init.tree);
        this.mindMap = new MindMap({
            el: init.el,
            data: init.tree as unknown as Record<string, unknown>,
            layout: init.layout,
            // `theme` only accepts a preset name string; custom styles go
            // through `themeConfig` (deep-merged over the default theme).
            theme: 'default',
            themeConfig: this.buildThemeConfig(init.dark, init.accent, init.spacing),
            isUseCustomNodeContent: true,
            customCreateNodeContent: (node: { getData: () => Record<string, unknown> }) => {
                const data = node.getData();
                const id = data?.highlightId;
                const uid = data?.uid;
                const saved = typeof id === 'string' ? this.cardPrototypes.get(id) : typeof uid === 'string' ? this.cardPrototypes.get(`node:${uid}`) : undefined;
                const prototype = typeof id !== 'string' && saved?.dataset.hlNodeText !== data?.text ? undefined : saved;
                const card = prototype ? prototype.cloneNode(true) as HTMLElement : document.createElement('div');
                if (!prototype) {
                    card.className = 'hl-mindmap-node-card';
                    card.style.setProperty('--hl-map-card-color', typeof data?.borderColor === 'string' ? data.borderColor : 'var(--interactive-accent)');
                    const excerpt = document.createElement('div');
                    excerpt.className = 'hl-mindmap-node-excerpt';
                    excerpt.textContent = typeof data?.text === 'string' ? data.text : '';
                    card.appendChild(excerpt);
                }
                card.classList.toggle('is-compact', this.compactCards);
                return card;
            },
            // Chat-bubble glyph for node notes (data.note).
            // Small & translucent: fill-opacity rides on the path; the library only
            // overrides fill, so the color still follows the node text.
            noteIcon: { icon: NOTE_BUBBLE_SVG, style: { size: 13 } },
            plugins: PLUGIN_LIST,
            // Without this the library listens on window for Tab/Enter and
            // would swallow Obsidian's own editing shortcuts.
            enableShortcutOnlyWhenMouseInSvg: true,
            // Obsidian keeps focus on workspace elements (not body) while
            // the map is used, so the library's default target check would
            // block every shortcut (Tab/Enter/Delete). Allow keys whose
            // target is the body or inside this canvas; typing surfaces
            // (inputs/textareas/contentEditable) stay excluded.
            customCheckEnableShortcut: (e: KeyboardEvent) => {
                const target = e.target as HTMLElement | null;
                if (!target) return false;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return false;
                return target === document.body || init.el.contains(target);
            },
            fit: true,
            mousewheelAction: 'zoom',
            minZoomRatio: 20,
            maxZoomRatio: 400,
            // Force long node text to wrap instead of stretching the node wide.
            textAutoWrapWidth: 260,
            // Xmind-like drag: drop ON a topic = child, BETWEEN = sibling.
            enableAutoMoveIntoDrag: true,
            autoMoveWhenMouseInEdgeOnDrag: true,
            enableFreeDrag: true,
            ...interactionOptions(this.interaction),
        }) as unknown as SmmInstance;

        this.mindMap.on('data_change', (data: MindMapNode) => {
            this.callbacks.onDataChange(data);
        });
        this.mindMap.on('node_active', (_node: unknown, activeNodeList: unknown[]) => {
            // Node.getData() returns the node's data object (no args needed —
            // with an argument it looks up a FIELD, so getData(true) is undefined).
            const first = activeNodeList[0] as { getData?: () => Record<string, unknown> } | undefined;
            const data = first?.getData?.();
            this.callbacks.onNodeActive(data ? ({ data } as MindMapNode) : null, activeNodeList.length);
        });
        this.mindMap.on('back_forward', () => {
            this.emitHistory();
        });
        this.mindMap.on('node_tree_render_end', () => {
            this.callbacks.onRenderEnd?.();
        });
        this.emitHistory();
    }

    private emitHistory(): void {
        const command = this.mindMap?.command;
        if (!command) return;
        this.callbacks.onHistoryChange(
            command.activeHistoryIndex > 0,
            command.activeHistoryIndex < command.history.length - 1,
        );
    }

    destroy(): void {
        if (this.mindMap) {
            try {
                this.mindMap.destroy();
            } catch (e) {
                console.error('[HiLighter] mind map destroy failed', e);
            }
            this.mindMap = null;
        }
    }

    setLayout(layout: MindMapLayout): void {
        this.layout = layout;
        this.mindMap?.setLayout(layout);
    }

    getLayout(): MindMapLayout {
        return this.layout;
    }

    /** Re-applies the theme (dark mode / accent / spacing changes). */
    refreshTheme(dark: boolean, accent: string, spacing: MindMapSpacing): void {
        this.dark = dark;
        this.accent = accent;
        this.spacing = spacing;
        this.mindMap?.setThemeConfig(this.buildThemeConfig(dark, accent, spacing));
    }

    /** Switches the visual preset (line/border style) and re-renders. */
    setThemeId(themeId: string): void {
        this.themeId = themeId;
        this.mindMap?.setThemeConfig(this.buildThemeConfig(this.dark, this.accent, this.spacing));
    }

    toggleCardDetails(): boolean {
        this.compactCards = !this.compactCards;
        this.mindMap?.reRender();
        return this.compactCards;
    }

    setInteraction(mode: MindMapInteraction): void {
        this.interaction = mode;
        this.mindMap?.updateConfig(interactionOptions(mode));
    }

    /** Switches the color palette and re-renders. */
    setPaletteId(paletteId: string): void {
        this.paletteId = paletteId;
        const tree = this.getTree();
        if (tree) {
            this.applyLeafBorders(tree);
            this.mindMap?.updateData(tree);
        }
        this.mindMap?.setThemeConfig(this.buildThemeConfig(this.dark, this.accent, this.spacing));
    }

    /** Style preset + palette + mode + accent → full theme config. */
    private buildThemeConfig(dark: boolean, accent: string, spacing: MindMapSpacing): Record<string, unknown> {
        const palette = resolvePalette(this.paletteId, dark);
        // A palette's own accent (when present) drives root/lines over the plugin accent.
        const effAccent = palette.accent ?? accent;
        const theme = composeTheme(this.themeId, palette, effAccent, spacing, dark);
        const cardStyle = { shape: 'roundedRectangle', fillColor: palette.nodeFill, borderColor: palette.nodeBorder, borderWidth: 1, paddingX: 12, paddingY: 8 };
        return {
            ...theme,
            root: { ...(theme.root as Record<string, unknown>), shape: 'roundedRectangle', borderWidth: 1 },
            second: { ...(theme.second as Record<string, unknown>), ...cardStyle },
            node: { ...(theme.node as Record<string, unknown>), ...cardStyle },
        };
    }

    /**
     * Recolors highlight-leaf borders to match the current palette:
     * 'tint' palettes get the line color fading toward the background per
     * level; 'card' palettes keep each card's own color. Runs on open and
     * on palette switches; the updated colors persist via data_change.
     */
    applyLeafBorders(tree: MindMapNode): void {
        if (resolveLeafBorderMode(this.paletteId) === 'card') return;
        const palette = resolvePalette(this.paletteId, this.dark);
        const walk = (node: MindMapNode, depth: number, branch: number): number => {
            let currentBranch = branch;
            if (depth === 1) currentBranch++;
            if (node.data.highlightId) {
                node.data.borderColor = tintedBorder(palette, depth);
            }
            for (const child of node.children ?? []) {
                currentBranch = walk(child, depth + 1, currentBranch);
            }
            return currentBranch;
        };
        for (const child of tree.children ?? []) walk(child, 1, -1);
    }

    /** Adds a summary node under every currently active node (Xmind-style summary). */
    addSummary(): void {
        this.mindMap?.execCommand('ADD_GENERALIZATION');
    }

    /** Re-reads the container size and re-renders (view was resized). */
    resize(): void {
        this.mindMap?.resize();
    }

    fit(): void {
        this.mindMap?.view?.fit();
    }

    resetView(): void {
        this.mindMap?.view?.reset();
    }

    undo(): void {
        this.mindMap?.execCommand('UNDO');
    }

    redo(): void {
        this.mindMap?.execCommand('REDO');
    }

    insertChildNode(): void {
        this.mindMap?.execCommand('INSERT_CHILD_NODE');
    }

    insertSiblingNode(): void {
        this.mindMap?.execCommand('INSERT_NODE');
    }

    /** Add a visually separate card to the canvas. It can be freely dragged. */
    insertFreeNode(label: string): void {
        const tree = this.getTree();
        const freeNode: MindMapNode = {
            data: {
                uid: `free_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                text: label,
                expand: true,
                lineColor: 'transparent',
                lineWidth: 0,
                isFreeNode: true,
            },
            children: [],
        };
        this.mindMap?.updateData({ ...tree, children: [...(tree.children ?? []), freeNode] });
    }

    /** Apply a style to all selected nodes, including marquee selections. */
    styleActiveNodes(prop: string, value: string | number): void {
        for (const node of this.mindMap?.renderer?.activeNodeList ?? []) {
            this.mindMap?.execCommand('SET_NODE_STYLE', node, prop, value);
        }
    }

    removeActiveNode(): void {
        this.mindMap?.execCommand('REMOVE_NODE');
    }

    /** Starts an associative line from the active node; user clicks the target. */
    startAssociativeLine(): void {
        this.mindMap?.associativeLine?.createLineFromActiveNode();
    }

    /** True while the user is drawing an associative line. */
    isDrawingAssociativeLine(): boolean {
        return !!this.mindMap?.associativeLine?.isCreatingLine;
    }

    /** Latest tree (current data, not last saved). */
    getTree(): MindMapNode {
        return (this.mindMap?.getData(false) ?? { data: { text: '' }, children: [] }) as MindMapNode;
    }

    /** Rendered node rects, used by the .canvas exporter. */
    getRenderedNodeRects(): Map<string, { x: number; y: number; width: number; height: number; text: string }> {
        const rects = new Map<string, { x: number; y: number; width: number; height: number; text: string }>();
        const renderer = this.mindMap?.renderer;
        if (!renderer) return rects;
        for (const node of renderer.nodes ?? []) {
            const data = node.getData?.() ?? { uid: undefined, text: '' };
            const uid = data?.uid;
            if (!uid) continue;
            const rect = node.getRect
                ? node.getRect()
                : { x: node.left ?? 0, y: node.top ?? 0, width: node.width ?? 0, height: node.height ?? 0 };
            rects.set(uid, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: data?.text ?? '' });
        }
        return rects;
    }

    /** Exports through the library plugins (download=true saves a file). */
    async export(type: 'png' | 'md' | 'xmind', fileName: string): Promise<void> {
        if (!this.mindMap) return;
        await this.mindMap.export(type, true, fileName);
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- end of untyped library surface */
