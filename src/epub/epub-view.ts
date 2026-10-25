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

import ePubLib from 'epubjs';
import type { Book, Rendition, Contents } from 'epubjs';
import { FileView, Notice, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type HiLighterPlugin from '../main';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { db } from '../db';
import { showHighlightMenu } from '../selection/selection-menu';
import { resolveHex } from '../colors';
import { syncAnnotations } from './epub-annotations';
import { openEpubRegistry } from './registry';

export const EPUB_VIEW_TYPE = 'hl-epub-view';

export class EpubView extends FileView {
    plugin: HiLighterPlugin;
    book: Book | null = null;
    rendition: Rendition | null = null;

    private chapterEl: HTMLElement | null = null;
    private errorEl: HTMLElement | null = null;
    /** Guards async open book work against a file switch / teardown. */
    private loadSeq = 0;
    /** Path this view is published under in the open-view registry. */
    private registryPath: string | null = null;
    private dbUnsub: (() => void) | null = null;

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
        // Card edits (delete / recolor from the sidebar or studio) must
        // reflect on the open book immediately — same pattern the PDF
        // overlay uses.
        this.dbUnsub = db.onChange(() => { void this.syncAnnotations(); });
    }

    private buildShell(): void {
        const bar = this.contentEl.createDiv('hl-epub-toolbar');
        const prev = bar.createDiv('hl-epub-nav');
        setIcon(prev.createSpan(), 'chevron-left');
        prev.setAttribute('aria-label', t('epub.prev'));
        prev.onclick = () => void this.goPrev();

        this.chapterEl = bar.createDiv('hl-epub-chapter');
        this.chapterEl.setText('…');

        const next = bar.createDiv('hl-epub-nav');
        setIcon(next.createSpan(), 'chevron-right');
        next.setAttribute('aria-label', t('epub.next'));
        next.onclick = () => void this.goNext();
    }

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

    private async openBook(file: TFile): Promise<void> {
        const seq = ++this.loadSeq;
        this.teardownBook();
        this.showError(null);

        const container = this.contentEl.createDiv('hl-epub-container');
        try {
            const data = await this.plugin.app.vault.readBinary(file);
            if (seq !== this.loadSeq) return;

            const book = ePubLib(data as unknown as string) as unknown as Book;
            const rendition = book.renderTo(container, {
                width: '100%',
                height: '100%',
                spread: 'none',
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

            const start = this.plugin.settings.epubProgress?.[file.path];
            try {
                await rendition.display(start ?? undefined);
            } catch {
                // Stale or unreadable saved progress — fall back to the start.
                await rendition.display(undefined);
            }
            if (seq !== this.loadSeq) return;

            void this.refreshChapterTitle();
            void this.syncAnnotations();
        } catch (err) {
            if (seq !== this.loadSeq) return;
            console.error('[HiLighter] EPUB open failed', err);
            this.showError(err);
            new Notice(t('epub.openError'));
        }
    }

    /** The rendition renders inside an iframe that cannot see CSS vars;
     *  resolve them here and pass literal values. */
    private applyTheme(): void {
        if (!this.rendition) return;
        try {
            const bodyStyle = getComputedStyle(document.body);
            const text = bodyStyle.getPropertyValue('--text-normal').trim() || '#222222';
            const font = bodyStyle.getPropertyValue('--font-text').trim() || '';
            const size = bodyStyle.getPropertyValue('--font-text-size').trim() || '16px';
            this.rendition.themes.default({
                body: {
                    color: text,
                    background: 'transparent',
                    'font-family': font ? `${font}, serif` : 'serif',
                    'font-size': size,
                    padding: '0 4px !important',
                },
                'p, div, span, li': { color: `${text} !important` },
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
        rendition.on('rendered', () => {
            void this.syncAnnotations();
        });

        // Persist read position + chapter title
        rendition.on('relocated', (location: { start?: { cfi?: string; href?: string } }) => {
            const cfi = location?.start?.cfi;
            if (!cfi || !this.file) return;
            this.plugin.settings.epubProgress = {
                ...this.plugin.settings.epubProgress,
                [this.file.path]: cfi,
            };
            void this.plugin.saveSettings();
            void this.refreshChapterTitle();
        });
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

    private async goPrev(): Promise<void> {
        await this.rendition?.prev?.();
    }

    private async goNext(): Promise<void> {
        await this.rendition?.next?.();
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
