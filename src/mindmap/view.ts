// ============================================================
// HiLighter - Mind map main-area view
// ============================================================
// Shell owns state + layout; engine wiring lives in engine.ts,
// tree building in build.ts, exports in exporters.ts. Follows the
// studio view's "thin ItemView + sibling modules" architecture.

import { ItemView, WorkspaceLeaf, Notice, Modal, FuzzySuggestModal, TFile, setIcon, type App } from 'obsidian';
import { db } from '../db';
import type { HighlightNote, MindMapBuildMode, MindMapDoc } from '../models';
import { t } from '../i18n';
import type HiLighterPlugin from '../main';
import { applyAppearance } from '../appearance';
import { getColorDef, resolveHex } from '../colors';
import { MINDMAP_VIEW_TYPE } from '../view-types';
import { buildMindMapTree, ensureUids, syncTreeWithCards, type HeadingLine, type MindMapNode } from './build';
import { MindMapEngine, type MindMapLayout, type MindMapSpacing } from './engine';
import { THEME_PRESETS } from './themes';
import { PALETTE_PRESETS } from './palettes';
import { exportCanvasFile, exportMarkdownFile } from './exporters';
import { importXmindFile } from './import';
import { jumpToSource } from '../studio/actions';
import { randomUUID } from '../mocks/crypto';

const SAVE_DEBOUNCE_MS = 800;

const LAYOUTS: Array<{ id: MindMapLayout; labelKey: string }> = [
    { id: 'logicalStructure', labelKey: 'mindmap.structure.logicalRight' },
    { id: 'mindMap', labelKey: 'mindmap.structure.mindMap' },
    { id: 'logicalStructureLeft', labelKey: 'mindmap.structure.logicalLeft' },
    { id: 'organizationStructure', labelKey: 'mindmap.structure.organization' },
    { id: 'timeline', labelKey: 'mindmap.structure.timeline' },
    { id: 'verticalTimeline', labelKey: 'mindmap.structure.verticalTimeline' },
    { id: 'fishbone', labelKey: 'mindmap.structure.fishbone' },
    { id: 'catalogOrganization', labelKey: 'mindmap.structure.catalog' },
];

export class HighlightMindMapView extends ItemView {
    plugin: HiLighterPlugin;
    private engine = new MindMapEngine();
    private docs: MindMapDoc[] = [];
    private currentDoc: MindMapDoc | null = null;
    private layout: MindMapLayout = 'logicalStructure';
    private spacing: MindMapSpacing = 'spread';
    private themeId = 'classic';
    private paletteId = 'default';
    private sidebarOpen = false;
    private selectedNode: MindMapNode | null = null;
    private saveTimer: number | null = null;
    private unsubDbChange: (() => void) | null = null;
    private sidebarEl: HTMLElement | null = null;
    private canvasEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private docTitleEl: HTMLElement | null = null;
    private exportMenuOpen = false;
    private activeNodeCount = 0;
    private canUndo = false;
    private canRedo = false;

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return MINDMAP_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('mindmap.viewName');
    }

    getIcon(): string {
        return 'git-fork';
    }

    async onOpen(): Promise<void> {
        this.docs = await db.listMindMaps();
        this.render();

        // Keep the doc list fresh when another leaf of this view saves.
        this.unsubDbChange = db.onChange(() => void this.reloadDocs());

        // Close the export menu when clicking anywhere outside it
        // (registered once here, NOT in renderTopbar, to avoid stacking
        // document-level listeners across re-renders).
        this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
            if (!this.exportMenuOpen) return;
            const wrap = this.contentEl.querySelector('.hl-mindmap-export-wrap');
            if (wrap && !wrap.contains(e.target as Node)) {
                this.exportMenuOpen = false;
                wrap.querySelector('.hl-mindmap-export-menu')?.remove();
            }
        });
    }

    async onClose(): Promise<void> {
        this.flushSave();
        this.unsubDbChange?.();
        this.canvasResizeObserver?.disconnect();
        this.engine.destroy();
        this.contentEl.empty();
    }

    private async reloadDocs(): Promise<void> {
        this.docs = await db.listMindMaps();
        if (this.sidebarEl && this.sidebarOpen) this.renderSidebar();
    }

    // ── Layout ────────────────────────────────────────────────

    private render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('hl-mindmap');
        applyAppearance(container, this.plugin.settings);
        container.setAttribute('data-hl-mode', this.plugin.settings.studioColorMode || 'auto');

        const layout = container.createDiv('hl-mindmap-layout');

        this.sidebarEl = layout.createDiv('hl-mindmap-sidebar');
        layout.createDiv('hl-mindmap-resizer');
        this.canvasEl = layout.createDiv('hl-mindmap-canvas');

        this.renderTopbar(container);
        this.renderSidebar();

        if (this.currentDoc) {
            this.mountEngine();
        } else if (this.docs.length > 0) {
            void this.openDoc(this.docs[0]!);
        } else {
            this.renderEmptyState(this.canvasEl);
            this.renderNodePanel(null, 0);
        }
    }

    private renderTopbar(parent: HTMLElement): void {
        const bar = parent.createDiv('hl-mindmap-topbar');

        const identity = bar.createDiv('hl-mindmap-identity');
        identity.createSpan({ text: 'HiLighter', cls: 'hl-mindmap-brand' });
        identity.createSpan({ text: '/', cls: 'hl-mindmap-separator' });
        identity.createSpan({ text: t('mindmap.viewName'), cls: 'hl-mindmap-title' });
        this.docTitleEl = identity.createSpan({ text: this.currentDoc?.title ?? '', cls: 'hl-mindmap-doc-title' });

        const actions = bar.createDiv('hl-mindmap-actions');

        this.iconButton(actions, 'import', t('mindmap.toolbar.import'), () => this.openImportFlow());
        this.iconButton(actions, 'list', t('mindmap.toolbar.docs'), (btn) => {
            this.sidebarOpen = !this.sidebarOpen;
            this.sidebarEl?.toggleClass('is-open', this.sidebarOpen);
            btn.toggleClass('is-active', this.sidebarOpen);
        });

        // Structure select
        const structure = actions.createEl('select', {
            cls: 'hl-mindmap-structure-select',
            attr: { 'aria-label': t('mindmap.toolbar.structure') },
        });
        for (const item of LAYOUTS) {
            structure.createEl('option', { text: t(item.labelKey), value: item.id });
        }
        structure.value = this.layout;
        structure.onchange = () => {
            this.layout = structure.value as MindMapLayout;
            this.engine.setLayout(this.layout);
        };

        // Theme preset select (line/border styles)
        const themeSelect = actions.createEl('select', {
            cls: 'hl-mindmap-structure-select',
            attr: { 'aria-label': t('mindmap.toolbar.theme') },
        });
        for (const preset of THEME_PRESETS) {
            themeSelect.createEl('option', { text: t(preset.labelKey), value: preset.id });
        }
        themeSelect.value = this.themeId;
        themeSelect.onchange = () => {
            this.themeId = themeSelect.value;
            this.engine.setThemeId(this.themeId);
        };

        // Color palette select (background/line/node colors)
        const paletteSelect = actions.createEl('select', {
            cls: 'hl-mindmap-structure-select',
            attr: { 'aria-label': t('mindmap.toolbar.palette') },
        });
        for (const palette of PALETTE_PRESETS) {
            paletteSelect.createEl('option', { text: t(palette.labelKey), value: palette.id });
        }
        paletteSelect.value = this.paletteId;
        paletteSelect.onchange = () => {
            this.paletteId = paletteSelect.value;
            this.engine.setPaletteId(this.paletteId);
            this.scheduleSave(this.engine.getTree());
        };

        this.renderExportMenu(actions, !this.currentDoc);
    }

    private undoRedoButtons: HTMLButtonElement[] = [];

    private renderExportMenu(parent: HTMLElement, disabled = false): void {
        const wrap = parent.createDiv('hl-mindmap-export-wrap');
        const btn = this.iconButton(wrap, 'share', t('mindmap.toolbar.export'), () => {
            this.exportMenuOpen = !this.exportMenuOpen;
            wrap.querySelector('.hl-mindmap-export-menu')?.remove();
            if (this.exportMenuOpen) this.renderExportMenuItems(wrap);
        });
        btn.addClass('hl-mindmap-export-trigger');
        (btn as HTMLButtonElement).disabled = disabled;
    }

    private renderExportMenuItems(wrap: HTMLElement): void {
        const menu = wrap.createDiv('hl-mindmap-export-menu');
        const items: Array<{ label: string; run: () => void }> = [
            { label: t('mindmap.export.png'), run: () => void this.engine.export('png', this.currentDoc?.title || 'mindmap') },
            { label: t('mindmap.export.xmind'), run: () => void this.engine.export('xmind', this.currentDoc?.title || 'mindmap') },
            {
                label: t('mindmap.export.markdown'),
                run: () => {
                    if (this.currentDoc) {
                        void exportMarkdownFile(this.app, this.currentDoc.title, this.engine.getTree());
                    }
                },
            },
            {
                label: t('mindmap.export.canvas'),
                run: () => {
                    if (this.currentDoc) {
                        void exportCanvasFile(this.app, this.engine, this.currentDoc.title, this.engine.getTree());
                    }
                },
            },
        ];
        for (const item of items) {
            const row = menu.createDiv('hl-mindmap-export-item');
            row.createSpan({ text: item.label });
            row.onclick = () => {
                item.run();
                this.exportMenuOpen = false;
                menu.remove();
            };
        }
    }

    private iconButton(
        parent: HTMLElement,
        icon: string,
        label: string,
        onClick: (btn: HTMLElement) => void,
    ): HTMLElement {
        const btn = parent.createEl('button', {
            cls: 'hl-tool-btn hl-mindmap-btn',
            attr: { 'aria-label': label, title: label },
        });
        setIcon(btn, icon);
        btn.onclick = () => onClick(btn);
        return btn;
    }

    // ── Sidebar (document list) ───────────────────────────────

    private renderSidebar(): void {
        const sidebar = this.sidebarEl;
        if (!sidebar) return;
        sidebar.empty();
        sidebar.toggleClass('is-open', this.sidebarOpen);

        const header = sidebar.createDiv('hl-mindmap-sidebar-header');
        header.createSpan({ text: t('mindmap.docs.title') });
        this.iconButton(header, 'plus', t('mindmap.doc.newBlank'), () => void this.createBlankDoc());

        const list = sidebar.createDiv('hl-mindmap-doc-list');
        for (const doc of this.docs) {
            const row = list.createDiv('hl-mindmap-doc-row');
            if (this.currentDoc?.id === doc.id) row.addClass('is-active');
            const info = row.createDiv('hl-mindmap-doc-info');
            info.createDiv('hl-mindmap-doc-name').setText(doc.title);
            info.createDiv('hl-mindmap-doc-meta').setText(
                new Date(doc.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            );
            const del = row.createDiv('hl-mindmap-doc-delete');
            setIcon(del, 'trash-2');
            del.setAttribute('aria-label', t('mindmap.docs.delete'));
            del.onclick = (e) => {
                e.stopPropagation();
                void this.deleteDoc(doc);
            };
            row.onclick = () => void this.openDoc(doc);
        }
        if (this.docs.length === 0) {
            list.createDiv('hl-mindmap-doc-empty').setText(t('mindmap.docs.empty'));
        }
    }

    private renderEmptyState(parent: HTMLElement): void {
        const empty = parent.createDiv('hl-mindmap-empty');
        const icon = empty.createDiv('hl-mindmap-empty-icon');
        setIcon(icon, 'git-fork');
        empty.createDiv('hl-mindmap-empty-title').setText(t('mindmap.empty.title'));
        empty.createDiv('hl-mindmap-empty-hint').setText(t('mindmap.empty.hint'));
        const actions = empty.createDiv('hl-mindmap-empty-actions');
        const blankBtn = actions.createEl('button', { cls: 'hl-mindmap-empty-blank' });
        blankBtn.setText(t('mindmap.doc.newBlank'));
        blankBtn.onclick = () => void this.createBlankDoc();
    }

    // ── Engine wiring ─────────────────────────────────────────

    private isDark(): boolean {
        const mode = this.plugin.settings.studioColorMode || 'auto';
        return mode === 'dark' || (mode === 'auto' && document.body.classList.contains('theme-dark'));
    }

    private accent(): string {
        return this.plugin.settings.accentColor || cssAccentFallback();
    }

    private mountEngine(): void {
        const canvas = this.canvasEl;
        const doc = this.currentDoc;
        if (!canvas || !doc) return;
        canvas.empty();

        ensureUids(doc.tree as MindMapNode);
        const { tree: synced } = this.syncWithCards(doc.tree as MindMapNode);

        // The engine reads container size once at init and throws on a
        // zero-size container; freshly opened leaves may not be laid out
        // yet, so wait (a few frames max) until the canvas has size.
        const tryInit = (attempt: number): void => {
            if (this.currentDoc !== doc) return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                if (attempt >= 10) {
                    console.error('[HiLighter] mind map canvas has no size; giving up');
                    new Notice(t('mindmap.notice.initFailed'));
                    return;
                }
                window.requestAnimationFrame(() => tryInit(attempt + 1));
                return;
            }
            try {
                this.engine.init({
                    el: canvas,
                    tree: synced,
                    layout: this.layout,
                    spacing: this.spacing,
                    themeId: this.themeId,
                    paletteId: this.paletteId,
                    dark: this.isDark(),
                    accent: this.accent(),
                    callbacks: {
                        onDataChange: (tree) => this.scheduleSave(tree),
                        onNodeActive: (node, activeCount) => this.renderNodePanel(node, activeCount),
                        onHistoryChange: (canUndo, canRedo) => {
                            this.canUndo = canUndo;
                            this.canRedo = canRedo;
                            this.updateHistoryButtons();
                        },
                    },
                });
            } catch (e) {
                console.error('[HiLighter][mindmap] engine init failed', e);
                new Notice(t('mindmap.notice.initFailed'));
                return;
            }

            // Keep the engine in sync with later size changes
            // (sidebar toggle, split changes, window resize).
            this.canvasResizeObserver?.disconnect();
            this.canvasResizeObserver = new ResizeObserver(() => this.engine.resize());
            this.canvasResizeObserver.observe(canvas);
            this.renderNodePanel(null);
        };
        tryInit(0);

        // Clear the panel when clicking blank canvas space.
        this.registerDomEvent(canvas, 'pointerdown', (e: PointerEvent) => {
            if (e.target === canvas) this.renderNodePanel(null);
        });
    }

    private canvasResizeObserver: ResizeObserver | null = null;

    private syncWithCards(tree: MindMapNode): { tree: MindMapNode; changed: boolean } {
        const doc = this.currentDoc;
        if (!doc) return { tree, changed: false };
        return syncTreeWithCards(tree, this.cardsByIdCache, {
            colorHex: (id) => resolveHex(this.plugin.settings, id),
        });
    }

    // Filled before openDoc; avoids an async walk inside sync.
    private cardsByIdCache = new Map<string, HighlightNote>();

    // ── Document operations ───────────────────────────────────

    private async openDoc(doc: MindMapDoc): Promise<void> {
        this.flushSave();
        this.currentDoc = doc;
        // Warm the card cache for re-sync.
        this.cardsByIdCache.clear();
        const all = await db.getAllHighlights();
        for (const note of all) this.cardsByIdCache.set(note.id, note);
        if (this.docTitleEl) this.docTitleEl.setText(doc.title);
        this.renderSidebar();
        this.mountEngine();
    }

    private scheduleSave(tree: MindMapNode): void {
        const doc = this.currentDoc;
        if (!doc) return;
        doc.tree = tree;
        doc.updatedAt = Date.now();
        if (this.saveTimer) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
    }

    private flushSave(): void {
        if (this.saveTimer) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        const doc = this.currentDoc;
        if (!doc) return;
        void db.putMindMap(doc).catch((e) => console.error('[HiLighter] mind map save failed', e));
    }

    private async createBlankDoc(): Promise<void> {
        const doc: MindMapDoc = {
            id: randomUUID(),
            title: t('mindmap.doc.untitled'),
            tree: { data: { uid: undefined, text: t('mindmap.doc.untitled'), expand: true }, children: [] },
            buildMode: 'flat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        ensureUids(doc.tree as MindMapNode);
        await db.putMindMap(doc);
        this.docs = await db.listMindMaps();
        await this.openDoc(doc);
    }

    private async deleteDoc(doc: MindMapDoc): Promise<void> {
        void db.deleteMindMap(doc.id).then(async () => {
            this.docs = await db.listMindMaps();
            if (this.currentDoc?.id === doc.id) {
                this.currentDoc = null;
                if (this.docs.length > 0) {
                    await this.openDoc(this.docs[0]!);
                } else {
                    this.currentDoc = null;
                    this.docTitleEl?.setText('');
                    this.render();
                }
            }
            this.renderSidebar();
            new Notice(t('mindmap.notice.docDeleted'));
        }).catch((e) => console.error('[HiLighter] mind map delete failed', e));
    }

    // ── Import flow ───────────────────────────────────────────

    private openImportFlow(): void {
        void (async () => {
            try {
                const all = await db.getAllHighlights();
                const byPath = new Map<string, number>();
                for (const note of all.filter(item => item.kind !== 'idea')) {
                    byPath.set(note.sourcePath, (byPath.get(note.sourcePath) ?? 0) + 1);
                }
                const highlightFiles = [...byPath.keys()]
                    .map(path => ({ file: this.app.vault.getAbstractFileByPath(path), count: byPath.get(path)! }))
                    .filter((e): e is { file: TFile; count: number } => e.file instanceof TFile)
                    .map(e => ({ ...e, kind: 'highlights' as const }));
                // .xmind workbooks can be imported directly as maps.
                const xmindFiles = this.app.vault.getFiles()
                    .filter(f => f.extension.toLowerCase() === 'xmind')
                    .map(f => ({ file: f, count: 0, kind: 'xmind' as const }));
                const files = [...highlightFiles, ...xmindFiles];

                if (files.length === 0) {
                    new Notice(t('mindmap.notice.noHighlights'));
                    return;
                }
                new MindMapSourceModal(this.app, files, (entry) => {
                    if (entry.kind === 'xmind') {
                        void importXmindFile(this.app, entry.file).then((doc) => {
                            if (doc) void this.openDoc(doc);
                        });
                        return;
                    }
                    new MindMapBuildModeModal(this.app, entry, (mode) => {
                        void this.importFromFile(entry.file, mode);
                    }).open();
                }).open();
            } catch (e) {
                console.error('[HiLighter][mindmap] import flow failed', e);
                new Notice(t('mindmap.notice.importFailed'));
            }
        })();
    }

    private async importFromFile(file: TFile, mode: MindMapBuildMode): Promise<void> {
        try {
            const notes = await db.getHighlightsByPath(file.path);
            if (notes.length === 0) {
                new Notice(t('mindmap.notice.noHighlights'));
                return;
            }

            let headings: HeadingLine[] = [];
            if (mode === 'headings' && file.extension === 'md') {
                const cache = this.app.metadataCache.getFileCache(file);
                headings = (cache?.headings ?? []).map(h => ({
                    level: h.level,
                    text: h.heading,
                    line: h.position.start.line,
                }));
            }

            const settings = this.plugin.settings;
            const tree = buildMindMapTree(notes, headings, {
                fileName: file.basename,
                mode,
                colorLabel: (colorId) => getColorDef(settings, colorId)?.label ?? colorId,
                colorHex: (colorId) => resolveHex(settings, colorId),
                uncategorizedLabel: t('mindmap.mode.uncategorized'),
                introLabel: t('mindmap.mode.intro'),
            });
            ensureUids(tree);

            const doc: MindMapDoc = {
                id: randomUUID(),
                title: file.basename,
                sourcePath: file.path,
                tree,
                buildMode: mode,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            await db.putMindMap(doc);
            this.docs = await db.listMindMaps();
            await this.openDoc(doc);
            new Notice(t('mindmap.notice.imported', { count: notes.length }));
        } catch (e) {
            console.error('[HiLighter] mind map import failed', e);
            new Notice(t('mindmap.notice.importFailed'));
        }
    }

    // ── Selected-node panel ───────────────────────────────────

    private renderNodePanel(node: MindMapNode | null, activeCount = 0): void {
        this.selectedNode = node;
        this.activeNodeCount = activeCount;
        const panel = this.panelEl;
        const canvas = this.canvasEl;
        if (!canvas) return;

        panel?.remove();
        this.panelEl = null;
        const el = canvas.createDiv('hl-mindmap-panel');
        this.panelEl = el;
        el.onpointerdown = event => event.stopPropagation();
        el.onmousedown = event => event.stopPropagation();
        el.onclick = event => event.stopPropagation();

        const isLinked = !!node?.data.highlightId;
        const hasSelection = activeCount > 0 && node !== null;
        const actions = el.createDiv('hl-mindmap-panel-actions');
        const createButton = (icon: string, label: string, run: () => void, disabled = false): HTMLButtonElement => {
            const btn = actions.createEl('button', {
                cls: 'hl-mindmap-panel-btn',
                attr: { 'aria-label': label, title: label },
            });
            setIcon(btn, icon);
            btn.disabled = disabled;
            btn.onclick = (event) => {
                event.stopPropagation();
                if (btn.disabled) return;
                run();
            };
            return btn;
        };

        createButton('sticky-note', t('mindmap.panel.addFree'), () => {
            if (!this.currentDoc) return;
            this.engine.insertFreeNode(t('mindmap.panel.freeCard'));
            this.scheduleSave(this.engine.getTree());
        }, !this.currentDoc);
        createButton('plus-square', t('mindmap.panel.addChild'), () => this.engine.insertChildNode(), !hasSelection);
        createButton('plus', t('mindmap.panel.addSibling'), () => this.engine.insertSiblingNode(), !hasSelection);
        createButton('quote', t('mindmap.panel.summary'), () => this.engine.addSummary(), !hasSelection);
        createButton('spline', t('mindmap.panel.link'), () => this.engine.startAssociativeLine(), !hasSelection);
        createButton('align-left', t('mindmap.panel.alignLeft'), () => this.engine.styleActiveNodes('textAlign', 'left'), !hasSelection);
        createButton('align-right', t('mindmap.panel.alignRight'), () => this.engine.styleActiveNodes('textAlign', 'right'), !hasSelection);
        createButton('trash-2', t('mindmap.panel.remove'), () => {
            this.engine.removeActiveNode();
            this.renderNodePanel(null, 0);
        }, !hasSelection);
        createButton('external-link', t('mindmap.panel.jump'), () => {
            if (node) void this.jumpFromNode(node);
        }, !hasSelection || activeCount !== 1 || !isLinked);

        const divider = () => actions.createDiv('hl-mindmap-toolbar-divider');
        divider();
        const spacingLabel = this.spacing === 'spread' ? t('mindmap.spacing.spread') : t('mindmap.spacing.compact');
        const spacingBtn = createButton('unfold-horizontal', spacingLabel, () => {}, !this.currentDoc);
        spacingBtn.onclick = (event) => {
            event.stopPropagation();
            if (spacingBtn.disabled) return;
            this.spacing = this.spacing === 'spread' ? 'compact' : 'spread';
            const label = this.spacing === 'spread' ? t('mindmap.spacing.spread') : t('mindmap.spacing.compact');
            spacingBtn.setAttribute('aria-label', label);
            spacingBtn.title = label;
            spacingBtn.toggleClass('is-active', this.spacing === 'compact');
            this.engine.refreshTheme(this.isDark(), this.accent(), this.spacing);
        };
        spacingBtn.toggleClass('is-active', this.spacing === 'compact');
        divider();
        const undoBtn = createButton('undo-2', t('mindmap.toolbar.undo'), () => this.engine.undo(), !this.currentDoc || !this.canUndo);
        const redoBtn = createButton('redo-2', t('mindmap.toolbar.redo'), () => this.engine.redo(), !this.currentDoc || !this.canRedo);
        this.undoRedoButtons = [undoBtn, redoBtn];
        createButton('scan', t('mindmap.toolbar.fit'), () => this.engine.fit(), !this.currentDoc);

        if (!node || !hasSelection) return;

        /*
         * Detail card: full highlight text + user note and node appearance.
         */
        const detail = el.createDiv('hl-mindmap-panel-detail');
        const appearance = detail.createDiv('hl-mindmap-panel-appearance');
        const widthLabel = appearance.createEl('label', { text: t('mindmap.panel.width') });
        const widthInput = widthLabel.createEl('input', {
            type: 'number',
            attr: { min: '100', max: '600', step: '10', 'aria-label': t('mindmap.panel.width') },
        });
        widthInput.value = typeof node.data.customTextWidth === 'number'
            ? String(node.data.customTextWidth) : '260';
        widthInput.onchange = () => {
            const width = Number(widthInput.value);
            if (Number.isFinite(width) && width >= 100 && width <= 600) {
                this.engine.styleActiveNodes('customTextWidth', width);
            }
        };
        const colorLabel = appearance.createEl('label', { text: t('mindmap.panel.fill') });
        const colorInput = colorLabel.createEl('input', { type: 'color', attr: { 'aria-label': t('mindmap.panel.fill') } });
        colorInput.value = typeof node.data.fillColor === 'string' && /^#[0-9a-f]{6}$/i.test(node.data.fillColor)
            ? node.data.fillColor : '#ffffff';
        colorInput.onchange = () => this.engine.styleActiveNodes('fillColor', colorInput.value);
        if (node.data.lost) {
            detail.createDiv('hl-mindmap-panel-lost').setText(t('mindmap.panel.lost'));
        }
        if (node.data.highlightText) {
            detail.createDiv('hl-mindmap-panel-quote').setText(node.data.highlightText);
        }
        if (node.data.highlightNote) {
            detail.createDiv('hl-mindmap-panel-note').setText(node.data.highlightNote);
        }
        if (!isLinked) {
            detail.createDiv('hl-mindmap-panel-hint').setText(t('mindmap.panel.freeNode'));
        }
    }

    private updateHistoryButtons(): void {
        const [undoBtn, redoBtn] = this.undoRedoButtons;
        if (undoBtn) undoBtn.disabled = !this.currentDoc || !this.canUndo;
        if (redoBtn) redoBtn.disabled = !this.currentDoc || !this.canRedo;
    }


    private async jumpFromNode(node: MindMapNode): Promise<void> {
        const id = node.data.highlightId;
        if (!id) return;
        const note = this.cardsByIdCache.get(id) ?? await db.getHighlightNote(id);
        if (!note) return;
        await jumpToSource(this.app, note);
    }
}

function cssAccentFallback(): string {
    return getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim() || '#7c6cf2';
}

// ── Import modals ─────────────────────────────────────────────

/** Fuzzy-picks a source for a new map: highlight files (with counts) or .xmind workbooks. */
type ImportSource = { file: TFile; count: number; kind: 'highlights' | 'xmind' };

class MindMapSourceModal extends FuzzySuggestModal<ImportSource> {
    private entries: ImportSource[];
    private onPick: (entry: ImportSource) => void;

    constructor(app: App, entries: ImportSource[], onPick: (entry: ImportSource) => void) {
        super(app);
        this.entries = entries;
        this.onPick = onPick;
        this.setPlaceholder(t('mindmap.import.placeholder'));
    }

    getItems(): ImportSource[] {
        return this.entries;
    }

    getItemText(entry: ImportSource): string {
        return entry.kind === 'xmind'
            ? `${entry.file.path} (Xmind)`
            : `${entry.file.path} (${entry.count})`;
    }

    onChooseItem(entry: ImportSource): void {
        this.onPick(entry);
    }
}

/** Picks the initial hierarchy for a fresh import. */
class MindMapBuildModeModal extends Modal {
    private entry: { file: TFile; count: number };
    private onPick: (mode: MindMapBuildMode) => void;

    constructor(app: App, entry: { file: TFile; count: number }, onPick: (mode: MindMapBuildMode) => void) {
        super(app);
        this.entry = entry;
        this.onPick = onPick;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hl-mindmap-mode-modal');
        contentEl.createDiv('hl-mindmap-mode-title')
            .setText(t('mindmap.mode.title', { file: this.entry.file.basename, count: this.entry.count }));

        const modes: Array<{ id: MindMapBuildMode; labelKey: string; descKey: string }> = [
            { id: 'headings', labelKey: 'mindmap.mode.headings', descKey: 'mindmap.mode.headingsDesc' },
            { id: 'color', labelKey: 'mindmap.mode.color', descKey: 'mindmap.mode.colorDesc' },
            { id: 'tag', labelKey: 'mindmap.mode.tag', descKey: 'mindmap.mode.tagDesc' },
            { id: 'flat', labelKey: 'mindmap.mode.flat', descKey: 'mindmap.mode.flatDesc' },
        ];
        for (const mode of modes) {
            const row = contentEl.createDiv('hl-mindmap-mode-row');
            row.createDiv('hl-mindmap-mode-label').setText(t(mode.labelKey));
            row.createDiv('hl-mindmap-mode-desc').setText(t(mode.descKey));
            row.onclick = () => {
                this.close();
                this.onPick(mode.id);
            };
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
