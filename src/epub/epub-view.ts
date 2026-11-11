// ============================================================
// HiLighter - EPUB reader view (epub.js)
// ============================================================
// Claims the .epub extension (unless another plugin got there first),
// renders with themed epub.js renditions, feeds selections into the
// same highlight menu, anchors notes by CFI.
//
// Extends FileView (not ItemView): Obsidian routes an opened file to a
// view through FileView's setState/loadFile → onLoadFile chain. A plain
// ItemView never receives the file, leaving the view blank.
//
// Toolbar: prev / outline / bookmarks / chapter title / page jump /
// display settings / reading mode / next. Explicit jumps (outline, page,
// card, resume) do not overwrite the saved reading position — only organic
// reading navigation does, so "resume" always points where you left off.

import ePubLib from 'epubjs';
import type { Book, Rendition, Contents, NavItem } from 'epubjs';
import { FileView, Notice, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type HiLighterPlugin from '../main';
import type { EpubBookmark, HighlightNote } from '../models';
import { t } from '../i18n';
import { db } from '../db';
import { showHighlightMenu } from '../selection/selection-menu';
import { resolveHex } from '../colors';
import { syncAnnotations } from './epub-annotations';
import { openEpubRegistry } from './registry';
import { renderEpubPagesMenu } from './epub-pages-menu';
import {
    appendEpubFontMenu,
    hasEpubDisplayOverride,
    rerenderEpubMenuInPlace,
} from './epub-font-menu';
import { resolveEpubTypography } from './epub-typography';
import { resolveEpubPageColors } from './epub-page-theme';

export const EPUB_VIEW_TYPE = 'hl-epub-view';

/** Chars per generated page location — page-like granularity for novels. */
const PAGE_CHARS = 1200;
/** Navigations within this window after an explicit jump don't move the
 *  saved reading position (epub.js fires `relocated` asynchronously). */
const PROGRESS_SUPPRESS_MS = 1500;

/** The epub.js typings are incomplete for the locations API we use. */
interface EpubLocationsApi {
    total: number;
    generate(chars?: number): Promise<string[]>;
    load(x: string[] | string): unknown;
    locationFromCfi(cfi: string): number;
    cfiFromLocation(loc: number): string | undefined;
}

interface TocFlatItem {
    label: string;
    href: string;
    depth: number;
}

export class EpubView extends FileView {
    plugin: HiLighterPlugin;
    book: Book | null = null;
    rendition: Rendition | null = null;

    private chapterEl: HTMLElement | null = null;
    private errorEl: HTMLElement | null = null;
    private toolbarEl: HTMLElement | null = null;
    private pageChipEl: HTMLElement | null = null;
    private modeBtnEl: HTMLElement | null = null;
    private fontBtnEl: HTMLElement | null = null;
    private menuEl: HTMLElement | null = null;
    /** Reading surface; gets the page-color background (EPUB pane only). */
    private readerEl: HTMLElement | null = null;

    /** Guards async open book work against a file switch / teardown. */
    private loadSeq = 0;
    /** Path this view is published under in the open-view registry. */
    private registryPath: string | null = null;
    private dbUnsub: (() => void) | null = null;

    /** Generated page locations for the current book (null = not built). */
    private locationCfis: string[] | null = null;
    private locationsLoading = false;
    /** Explicit-jump progress suppression window (see PROGRESS_SUPPRESS_MS). */
    private suppressProgressUntil = 0;
    /** Horizontal pages vs vertical scroll; re-creating the rendition on switch. */
    private readingMode: 'page' | 'scroll' = 'page';
    /** Last touch point for swipe paging (per section document). */
    private swipeStart: { x: number; y: number } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.navigation = true;
    }

    getViewType(): string {
        return EPUB_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'EPUB';
    }

    getIcon(): string {
        return 'book-open';
    }

    /** Lets another epub file open into this same leaf. */
    canAcceptExtension(extension: string): boolean {
        return extension === 'epub';
    }

    /** FileView calls this when the leaf's file is set or cleared. */
    async onLoadFile(file: TFile | null): Promise<void> {
        if (!file) {
            this.teardownBook();
            return;
        }
        await this.openBook(file);
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass('hl-epub-view');
        this.buildShell();
        // Close dropdown menus when clicking anywhere outside them.
        this.registerDomEvent(document, 'pointerdown', (evt: PointerEvent) => {
            const target = evt.target as HTMLElement | null;
            if (!this.menuEl || !target) return;
            if (this.menuEl.contains(target)) return;
            if (this.toolbarEl?.contains(target)) return;
            this.closeMenu();
        }, true);
        // Card edits (delete / recolor from the sidebar or studio) must
        // reflect on the open book immediately — same pattern the PDF
        // overlay uses.
        this.dbUnsub = db.onChange(() => { void this.syncAnnotations(); });
    }

    private buildShell(): void {
        const bar = this.contentEl.createDiv('hl-epub-toolbar');
        this.toolbarEl = bar;

        const prev = bar.createDiv('hl-epub-nav');
        setIcon(prev.createSpan(), 'chevron-left');
        prev.setAttribute('aria-label', t('epub.prev'));
        prev.onclick = () => void this.goPrev();

        const tocBtn = bar.createDiv('hl-epub-nav');
        setIcon(tocBtn.createSpan(), 'list');
        tocBtn.setAttribute('aria-label', t('epub.toc'));
        tocBtn.onclick = () => this.toggleMenu(tocBtn, 'toc');

        const bookmarkBtn = bar.createDiv('hl-epub-nav');
        setIcon(bookmarkBtn.createSpan(), 'bookmark');
        bookmarkBtn.setAttribute('aria-label', t('epub.bookmark'));
        bookmarkBtn.onclick = () => this.toggleMenu(bookmarkBtn, 'bookmarks');

        this.chapterEl = bar.createDiv('hl-epub-chapter');
        this.chapterEl.setText('…');
        this.chapterEl.setAttribute('aria-label', t('epub.toc'));
        this.chapterEl.onclick = () => this.toggleMenu(tocBtn, 'toc');

        this.pageChipEl = bar.createDiv('hl-epub-nav hl-epub-page-chip');
        setIcon(this.pageChipEl.createSpan(), 'hash');
        this.pageChipEl.setAttribute('aria-label', t('epub.pageJump'));
        this.pageChipEl.onclick = () => this.toggleMenu(this.pageChipEl!, 'pages');

        this.fontBtnEl = bar.createDiv('hl-epub-nav');
        const fontLabel = t('epub.font');
        setIcon(this.fontBtnEl.createSpan(), 'type');
        this.fontBtnEl.setAttribute('aria-label', fontLabel);
        this.fontBtnEl.setAttribute('title', fontLabel);
        this.fontBtnEl.onclick = () => this.toggleMenu(this.fontBtnEl!, 'font');
        if (hasEpubDisplayOverride(this.plugin.settings)) {
            this.fontBtnEl.addClass('has-override');
        }

        this.modeBtnEl = bar.createDiv('hl-epub-nav');
        this.updateModeIcon();
        this.modeBtnEl.onclick = () => void this.toggleReadingMode();

        const next = bar.createDiv('hl-epub-nav');
        setIcon(next.createSpan(), 'chevron-right');
        next.setAttribute('aria-label', t('epub.next'));
        next.onclick = () => void this.goNext();
    }

    private updateModeIcon(): void {
        if (!this.modeBtnEl) return;
        this.modeBtnEl.empty();
        const isPage = this.readingMode === 'page';
        setIcon(this.modeBtnEl.createSpan(), isPage ? 'move-horizontal' : 'move-vertical');
        this.modeBtnEl.setAttribute('aria-label',
            isPage ? t('epub.modeScrollHint') : t('epub.modePageHint'));
        this.modeBtnEl.setAttribute('title',
            isPage ? t('epub.modeScrollHint') : t('epub.modePageHint'));
    }

    /** Switch page ⇄ scroll; the rendition is re-created at the same position. */
    private async toggleReadingMode(): Promise<void> {
        const file = this.file;
        if (!file) return;
        const currentCfi = this.currentCfi();
        this.readingMode = this.readingMode === 'page' ? 'scroll' : 'page';
        this.plugin.settings.epubReadingMode = this.readingMode;
        void this.plugin.saveSettings();
        this.updateModeIcon();
        if (currentCfi) this.markExplicitJump();   // stay put when reopening
        await this.openBook(file, currentCfi ?? undefined);
    }

    // ── Dropdown menus ─────────────────────────────────────────

    private toggleMenu(anchor: HTMLElement, kind: 'toc' | 'pages' | 'bookmarks' | 'font'): void {
        if (this.menuEl?.dataset.kind === kind) {
            this.closeMenu();
            return;
        }
        this.closeMenu();
        const menu = this.contentEl.createDiv(`hl-epub-menu hl-epub-menu-${kind}`);
        menu.dataset.kind = kind;
        this.menuEl = menu;
        if (kind === 'toc') void this.renderTocMenu(menu);
        else if (kind === 'pages') void this.renderPagesMenu(menu);
        else if (kind === 'font') this.renderFontMenu(menu);
        else this.renderBookmarksMenu(menu);
        this.positionMenu(menu, anchor, kind === 'pages' ? 'pages' : 'toc');
    }

    private closeMenu(): void {
        this.menuEl?.remove();
        this.menuEl = null;
    }

    private positionMenu(menu: HTMLElement, anchor: HTMLElement, kind: 'toc' | 'pages'): void {
        const barRect = anchor.getBoundingClientRect();
        const viewRect = this.contentEl.getBoundingClientRect();
        // The toolbar height anchors the dropdown just below the bar.
        const top = barRect.bottom - viewRect.top + 6;

        // Measure first (hidden), then clamp inside the view.
        menu.setCssProps({
            top: `${top}px`,
            visibility: 'hidden',
        });
        window.setTimeout(() => {
            const w = menu.offsetWidth;
            let left: number;
            if (kind === 'toc') {
                left = barRect.left - viewRect.left;
            } else {
                left = barRect.right - viewRect.left - w;
            }
            left = Math.max(8, Math.min(left, viewRect.width - w - 8));
            menu.setCssProps({
                left: `${left}px`,
                visibility: 'visible',
            });
        }, 0);
    }

    private renderTocMenu(menu: HTMLElement): void {
        const items = this.flattenToc();
        if (items.length === 0) {
            menu.createDiv('hl-epub-menu-empty').setText(t('epub.tocEmpty'));
            return;
        }
        const current = this.hrefBase(this.currentSectionHref());
        const list = menu.createDiv('hl-epub-toc');
        items.forEach(item => {
            const row = list.createDiv('hl-epub-toc-item');
            row.setText(item.label);
            row.style.paddingLeft = `${10 + item.depth * 16}px`;
            if (current && this.hrefBase(item.href) === current) row.addClass('is-active');
            row.onclick = () => {
                this.closeMenu();
                void this.displayTarget(item.href);
            };
        });
    }

    private flattenToc(): TocFlatItem[] {
        const out: TocFlatItem[] = [];
        const walk = (items: NavItem[] | undefined, depth: number): void => {
            (items || []).forEach(item => {
                const label = (item.label || '').trim() || item.href;
                out.push({ label, href: item.href, depth });
                if (item.subitems && item.subitems.length > 0) walk(item.subitems, depth + 1);
            });
        };
        try {
            walk((this.book?.navigation?.toc ?? []), 0);
        } catch {
            // malformed nav — empty outline is cosmetic
        }
        return out;
    }

    private currentSectionHref(): string {
        try {
            const loc = this.rendition?.currentLocation() as unknown as { start?: { href?: string } };
            return loc?.start?.href ?? '';
        } catch {
            return '';
        }
    }

    private hrefBase(href: string): string {
        const base = (href || '').split('#')[0]?.split('/').pop() ?? '';
        return base.toLowerCase();
    }

    private renderPagesMenu(menu: HTMLElement): void {
        renderEpubPagesMenu(menu, {
            ensureLocations: () => this.ensureLocations(),
            currentLocationIndex: () => this.currentLocationIndex(),
            jump: index => {
                this.closeMenu();
                void this.displayLocationIndex(index);
            },
        });
    }

    /** Page-location CFIs for the book: cached in IndexedDB, else generated. */
    private async ensureLocations(): Promise<string[] | null> {
        const book = this.book;
        const file = this.file;
        if (!book || !file) return null;
        if (this.locationCfis) return this.locationCfis;
        if (this.locationsLoading) return null;
        this.locationsLoading = true;
        try {
            let mtime = 0;
            try { mtime = file.stat.mtime; } catch { /* stat unavailable */ }
            const cached = await db.getEpubLocations(file.path).catch(() => undefined);
            if (cached && cached.mtime === mtime && Array.isArray(cached.cfis) && cached.cfis.length > 1) {
                this.locationCfis = cached.cfis;
                (book.locations as unknown as EpubLocationsApi).load(cached.cfis);
                return this.locationCfis;
            }
            const cfis = (await (book.locations as unknown as EpubLocationsApi).generate(PAGE_CHARS));
            if (!Array.isArray(cfis) || cfis.length === 0) return null;
            this.locationCfis = cfis;
            void db.saveEpubLocations({ path: file.path, mtime, cfis }).catch(() => {});
            return this.locationCfis;
        } catch {
            return null;
        } finally {
            this.locationsLoading = false;
            this.updatePageChip();
        }
    }

    private currentLocationIndex(): number {
        try {
            const cfi = (this.rendition?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi;
            const locs = this.book?.locations as unknown as EpubLocationsApi | undefined;
            if (!cfi || !locs || !locs.total) return 0;
            return locs.locationFromCfi(cfi);
        } catch {
            return 0;
        }
    }

    private updatePageChip(): void {
        const chip = this.pageChipEl;
        if (!chip) return;
        if (this.locationCfis && this.locationCfis.length > 1) {
            chip.empty();
            chip.createSpan().setText(`${this.currentLocationIndex() + 1} / ${this.locationCfis.length}`);
        } else {
            chip.empty();
            setIcon(chip.createSpan(), 'hash');
        }
    }

    // ── Navigation ─────────────────────────────────────────────

    /** Organic reading navigation: updates the saved reading position. */
    private async goPrev(): Promise<void> {
        await this.rendition?.prev?.();
    }

    private async goNext(): Promise<void> {
        await this.rendition?.next?.();
    }

    /** Explicit jump by toc href; keeps the saved reading position. */
    private async displayTarget(href: string): Promise<void> {
        if (!this.rendition) return;
        this.markExplicitJump();
        try {
            await this.rendition.display(href);
        } catch { /* bad href from toc — ignore */ }
    }

    /** Explicit jump by page index; keeps the saved reading position. */
    private async displayLocationIndex(index: number): Promise<void> {
        const cfis = this.locationCfis ?? await this.ensureLocations();
        if (!cfis || !this.rendition) return;
        const cfi = cfis[Math.min(Math.max(index, 0), cfis.length - 1)];
        if (!cfi) return;
        this.markExplicitJump();
        try {
            await this.rendition.display(cfi);
        } catch { /* unresolvable location — ignore */ }
    }

    private markExplicitJump(): void {
        this.suppressProgressUntil = Date.now() + PROGRESS_SUPPRESS_MS;
    }

    // ── Bookmarks ──────────────────────────────────────────────

    private bookmarksFor(): EpubBookmark[] {
        if (!this.file) return [];
        return this.plugin.settings.epubBookmarks?.[this.file.path] ?? [];
    }

    private renderBookmarksMenu(menu: HTMLElement): void {
        const addBtn = menu.createDiv('hl-epub-bm-add');
        setIcon(addBtn.createSpan(), 'plus');
        addBtn.createSpan().setText(t('epub.addBookmark'));
        addBtn.onclick = () => {
            void this.addBookmark().then(() => this.rerenderBookmarkMenu());
        };

        const marks = this.bookmarksFor();
        if (marks.length === 0) {
            menu.createDiv('hl-epub-menu-empty').setText(t('epub.noBookmarks'));
            return;
        }
        const list = menu.createDiv('hl-epub-bm-list');
        [...marks].sort((a, b) => b.createdAt - a.createdAt).forEach(bm => {
            const row = list.createDiv('hl-epub-bm-item');
            const label = row.createDiv('hl-epub-bm-label');
            label.setText(bm.label || t('epub.bookmark'));
            const del = row.createDiv('hl-epub-bm-del');
            setIcon(del.createSpan(), 'x');
            del.setAttribute('aria-label', t('epub.removeBookmark'));
            del.onclick = (e) => {
                e.stopPropagation();
                void this.removeBookmark(bm).then(() => this.rerenderBookmarkMenu());
            };
            row.onclick = () => {
                this.closeMenu();
                void this.displayBookmark(bm);
            };
        });
    }

    /** Rebuilds the open bookmarks menu in place (after add/remove). */
    private rerenderBookmarkMenu(): void {
        const menu = this.menuEl;
        if (!menu || menu.dataset.kind !== 'bookmarks') return;
        rerenderEpubMenuInPlace(menu, m => this.renderBookmarksMenu(m));
    }

    private async addBookmark(): Promise<void> {
        const file = this.file;
        const cfi = this.currentCfi();
        if (!file || !cfi) return;
        let label = this.chapterEl?.textContent?.trim() || file.basename;
        if (this.locationCfis && this.locationCfis.length > 1) {
            label = `${label} · ${this.currentLocationIndex() + 1}`;
        }
        const bm: EpubBookmark = { cfi, label, createdAt: Date.now() };
        const all = { ...(this.plugin.settings.epubBookmarks ?? {}) };
        all[file.path] = [...(all[file.path] ?? []), bm];
        this.plugin.settings.epubBookmarks = all;
        await this.plugin.saveSettings();
        new Notice(t('notice.bookmarkAdded'));
    }

    private async removeBookmark(bm: EpubBookmark): Promise<void> {
        const file = this.file;
        if (!file) return;
        const all = { ...(this.plugin.settings.epubBookmarks ?? {}) };
        all[file.path] = (all[file.path] ?? []).filter(x => x.cfi !== bm.cfi);
        this.plugin.settings.epubBookmarks = all;
        await this.plugin.saveSettings();
    }

    private async displayBookmark(bm: EpubBookmark): Promise<void> {
        if (!this.rendition || !bm.cfi) return;
        this.markExplicitJump();
        try {
            await this.rendition.display(bm.cfi);
        } catch {
            new Notice(t('epub.bookmarkJumpError'));
        }
    }

    // ── Display settings (font / spacing / page color) ────────

    /** Display dropdown (UI + persistence live in epub-font-menu). */
    private renderFontMenu(menu: HTMLElement): void {
        appendEpubFontMenu(menu, {
            settings: this.plugin.settings,
            save: () => this.plugin.saveSettings(),
            applyDisplay: () => {
                this.applyTheme();
                this.rerenderFontMenu();
            },
            onOverrideChange: has => this.fontBtnEl?.toggleClass('has-override', has),
        });
    }

    /** Rebuilds the open font menu in place (after a change). */
    private rerenderFontMenu(): void {
        const menu = this.menuEl;
        if (!menu || menu.dataset.kind !== 'font') return;
        rerenderEpubMenuInPlace(menu, m => this.renderFontMenu(m));
    }

    private currentCfi(): string | null {
        try {
            const loc = this.rendition?.currentLocation() as unknown as { start?: { cfi?: string } };
            return loc?.start?.cfi ?? null;
        } catch {
            return null;
        }
    }

    // ── Book lifecycle ─────────────────────────────────────────

    /** Renders a readable error inside the view (with the underlying reason). */
    private showError(err: unknown): void {
        this.errorEl?.remove();
        this.errorEl = null;
        if (!err) return;
        const box = this.contentEl.createDiv('hl-epub-error');
        const msg = box.createDiv('hl-epub-error-msg');
        msg.setText(t('epub.openError') + (err instanceof Error && err.message ? ` — ${err.message}` : ''));
        const retry = box.createDiv('hl-epub-error-retry');
        retry.setText(t('epub.retry'));
        retry.onclick = () => {
            const f = this.file;
            if (f) void this.openBook(f);
        };
        this.errorEl = box;
    }

    private async openBook(file: TFile, startOverride?: string): Promise<void> {
        const seq = ++this.loadSeq;
        this.teardownBook();
        this.showError(null);
        this.locationCfis = null;
        this.updatePageChip();
        this.readingMode = this.plugin.settings.epubReadingMode === 'scroll' ? 'scroll' : 'page';
        this.updateModeIcon();

        const container = this.contentEl.createDiv('hl-epub-container');
        this.readerEl = container;
        try {
            const data = await this.plugin.app.vault.readBinary(file);
            if (seq !== this.loadSeq) return;

            const book = ePubLib(data as unknown as string) as unknown as Book;
            // Page mode: one paginated iframe per section (swipe left/right).
            // Scroll mode: continuous manager + scrolled flow — the whole book
            // becomes one vertical scroll.
            const isScroll = this.readingMode === 'scroll';
            const rendition = book.renderTo(container, {
                width: '100%',
                height: '100%',
                ...(isScroll
                    ? { manager: 'continuous', flow: 'scrolled' as const }
                    : { spread: 'none' as const }),
                allowScriptedContent: false,
            });
            this.book = book;
            this.rendition = rendition;
            this.registryPath = file.path;
            openEpubRegistry().set(file.path, this);

            this.applyTheme();
            this.wireRendition(rendition);

            // Packaging/spine failures surface here with a real message
            // instead of a silently blank page.
            await book.ready;
            if (seq !== this.loadSeq) return;

            const start = startOverride ?? this.plugin.settings.epubProgress?.[file.path];
            try {
                await rendition.display(start ?? undefined);
            } catch {
                // Stale or unreadable saved progress — fall back to the start.
                await rendition.display(undefined);
            }
            if (seq !== this.loadSeq) return;

            void this.refreshChapterTitle();
            void this.syncAnnotations();
            void this.ensureLocations().then(() => this.updatePageChip());
        } catch (err) {
            if (seq !== this.loadSeq) return;
            console.error('[HiLighter] EPUB open failed', err);
            this.showError(err);
        }
    }

    /** The rendition renders inside an iframe that cannot see CSS vars;
     *  resolve them here and pass literal values. User display overrides
     *  (family / size / line height / margins / page color) win over the
     *  theme values. A chosen page color paints the iframe body AND the
     *  reader container — scoped to the EPUB pane, never the Obsidian
     *  theme or other views. */
    private applyTheme(): void {
        if (!this.rendition) return;
        try {
            const bodyStyle = getComputedStyle(document.body);
            const text = bodyStyle.getPropertyValue('--text-normal').trim() || '#222222';
            const fontVar = bodyStyle.getPropertyValue('--font-text').trim();
            const sizeVar = bodyStyle.getPropertyValue('--font-text-size').trim() || '16px';
            const { fontFamily, fontSize, lineHeight, marginCss } = resolveEpubTypography(
                this.plugin.settings,
                { fontVar, sizeVar },
            );
            const pageColors = resolveEpubPageColors(this.plugin.settings, text);
            const themed = pageColors.background !== '';
            // Books hardcode text colors; on a themed page force the paired
            // color onto the common block elements so nothing turns invisible.
            const colorSelectors = themed
                ? 'p, div, span, li, a, blockquote, td, th, h1, h2, h3, h4, h5, h6'
                : 'p, div, span, li';
            const readerEl = this.readerEl;
            if (readerEl) readerEl.style.background = pageColors.background;
            const body: Record<string, string> = {
                color: pageColors.text,
                background: themed ? pageColors.background : 'transparent',
                'font-family': fontFamily,
                'font-size': fontSize,
                padding: marginCss,
            };
            if (lineHeight) body['line-height'] = lineHeight;
            this.rendition.themes.default({
                body,
                [colorSelectors]: { color: `${pageColors.text} !important` },
                '::selection': { background: 'rgba(125, 125, 125, 0.35)' },
            });
        } catch {
            // theme injection is cosmetic
        }
    }

    private wireRendition(rendition: Rendition): void {
        // Selection → the shared highlight menu (context = epub cfi anchor)
        rendition.on('selected', (cfiRange: string, contents: Contents) => {
            try {
                const win = contents.window;
                const text = win.getSelection()?.toString().trim() ?? '';
                if (!text || text.length > 2000) return;

                // Range rects are in the iframe's coordinate space; translate
                // them through the iframe element's own viewport rect.
                const range = win.getSelection()?.getRangeAt(0);
                const iframe = this.contentEl.querySelector('iframe');
                const iframeRect = iframe?.getBoundingClientRect();
                let x = (iframeRect?.left ?? 0) + 40;
                let y = (iframeRect?.top ?? 0) + 40;
                if (range) {
                    const r = range.getBoundingClientRect();
                    x = (iframeRect?.left ?? 0) + r.left + r.width / 2;
                    y = (iframeRect?.top ?? 0) + r.top - 50;
                }
                if (y < 60) y = 90;
                const docWidth = window.innerWidth;
                if (x < 120) x = 120;
                if (x > docWidth - 120) x = docWidth - 120;

                showHighlightMenu(this.plugin, text, {
                    leaf: this.leaf,
                    sourcePath: this.file?.path ?? '',
                    lineIndex: 0,
                    anchorType: 'epub',
                    cfi: cfiRange,
                    contextQuote: text.slice(0, 300),
                }, x, y, document);
            } catch {
                // selection plumbing varies; never break reading
            }
        });

        // Replay annotations on every section render — epub.js 0.3.93 has
        // no automatic re-attach after a page turn.
        rendition.on('rendered', (_section: unknown, view: unknown) => {
            void this.syncAnnotations();
            const contents = (view as { contents?: Contents } | undefined)?.contents
                ?? (this.rendition?.getContents?.() as unknown as Contents[] | undefined)?.[0];
            if (!contents) return;
            this.attachIframeDismiss(contents);
            if (this.readingMode === 'page') this.attachSwipe(contents);
        });

        // Persist read position + chapter title. Explicit jumps (toc /
        // page / bookmark / card / mode switch) suppress the position
        // update so reopening lands where the user actually left off.
        rendition.on('relocated', (location: { start?: { cfi?: string; href?: string } }) => {
            const cfi = location?.start?.cfi;
            if (!cfi || !this.file) return;
            if (Date.now() >= this.suppressProgressUntil) {
                this.plugin.settings.epubProgress = {
                    ...this.plugin.settings.epubProgress,
                    [this.file.path]: cfi,
                };
                void this.plugin.saveSettings();
            }
            void this.refreshChapterTitle();
            this.updatePageChip();
        });
    }

    /** Outside-click dismissal for clicks landing in the book itself.
     *  The reading surface is an iframe — its pointer events never reach
     *  the parent document, so the menu close listener in onOpen() can't
     *  see them. The menu never lives inside the iframe, so any click
     *  here is by definition outside it. Listeners die with the iframe
     *  on page turns / section swaps — re-attached per render. */
    private attachIframeDismiss(contents: Contents): void {
        try {
            contents.document.addEventListener('pointerdown', () => this.closeMenu(), {
                passive: true,
                capture: true,
            });
        } catch {
            // dismissal layer — never surface errors
        }
    }

    /** Left/right swipe paging inside the section iframe (page mode only).
     *  Listeners die with the iframe on page turns — re-attached per render. */
    private attachSwipe(contents: Contents): void {
        try {
            const doc = contents.document;
            doc.addEventListener('touchstart', (e: TouchEvent) => {
                const touch = e.touches[0];
                this.swipeStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
            }, { passive: true });
            doc.addEventListener('touchend', (e: TouchEvent) => {
                const start = this.swipeStart;
                this.swipeStart = null;
                if (!start) return;
                const touch = e.changedTouches[0];
                if (!touch) return;
                // Ignore swipes that ended as a text selection.
                if ((contents.window.getSelection()?.toString() ?? '') !== '') return;
                const dx = touch.clientX - start.x;
                const dy = touch.clientY - start.y;
                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    if (dx < 0) void this.goNext();
                    else void this.goPrev();
                }
            }, { passive: true });
        } catch {
            // gesture layer — never surface errors
        }
    }

    /** Idempotent repaint of all DB highlights for the open book. */
    async syncAnnotations(): Promise<void> {
        if (!this.rendition || !this.file) return;
        const notes = (await db.getHighlightsByPath(this.file.path))
            .filter(n => n.anchorType === 'epub' && n.cfi);
        syncAnnotations(this.rendition, notes, (n) => resolveHex(this.plugin.settings, n.color));
    }

    /** Kept for main.ts compatibility — a new highlight repaints the book. */
    async applyAnnotation(_note: HighlightNote): Promise<void> {
        await this.syncAnnotations();
    }

    async gotoCfi(cfi: string): Promise<void> {
        if (!this.rendition) return;
        this.markExplicitJump();
        try {
            await this.rendition.display(cfi);
        } catch {
            return;
        }
        // Marks repaint asynchronously off the 'rendered' event; pulse
        // twice so the flash lands whether painting was fast or slow.
        this.flashMarks();
        window.setTimeout(() => this.flashMarks(), 400);
    }

    /** Pulses the visible highlight rectangles for ~1.2s (like the PDF locate flash). */
    private flashMarks(): void {
        const marks = this.contentEl.querySelectorAll('[class*="hl-epub-hl-"]');
        if (marks.length === 0) return;
        marks.forEach(m => m.addClass('hl-epub-flash'));
        window.setTimeout(() => {
            this.contentEl.querySelectorAll('.hl-epub-flash')
                .forEach(m => m.removeClass('hl-epub-flash'));
        }, 1300);
    }

    private async refreshChapterTitle(): Promise<void> {
        try {
            if (!this.rendition || !this.chapterEl) return;
            const location = this.rendition.currentLocation();
            const href = (location as unknown as { start?: { href?: string } })?.start?.href;
            if (!href || !this.book?.navigation) return;
            const navItem = this.book.navigation.get(href);
            this.chapterEl.setText(navItem?.label?.trim() || this.file?.basename || 'EPUB');
        } catch {
            // title is cosmetic
        }
    }

    private teardownBook(): void {
        this.closeMenu();
        if (this.registryPath) {
            openEpubRegistry().delete(this.registryPath);
            this.registryPath = null;
        }
        try {
            this.rendition?.destroy?.();
        } catch { /* already gone */ }
        try {
            this.book?.destroy?.();
        } catch { /* already gone */ }
        this.rendition = null;
        this.book = null;
        this.locationCfis = null;
        this.readerEl = null;
        this.contentEl.querySelectorAll('.hl-epub-container').forEach(el => el.remove());
    }

    async onClose(): Promise<void> {
        this.dbUnsub?.();
        this.dbUnsub = null;
        this.loadSeq++;          // invalidate any in-flight openBook()
        this.teardownBook();
        await super.onClose();
    }
}
