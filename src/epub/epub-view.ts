// ============================================================
// HiLighter - EPUB reader view (epub.js)
// ============================================================
// Claims the .epub extension (unless another plugin got there first),
// renders with themed epub.js renditions, feeds selections into the
// same highlight menu, anchors notes by CFI.

import ePubLib from 'epubjs';
import type { Book, Rendition, Contents } from 'epubjs';
import { ItemView, Notice, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type HiLighterPlugin from '../main';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { db } from '../db';
import { showHighlightMenu } from '../selection/selection-menu';
import { resolveHex } from '../colors';
import { applyAnnotations } from './epub-annotations';
import { openEpubRegistry } from './registry';

export const EPUB_VIEW_TYPE = 'hl-epub-view';

export class EpubView extends ItemView {
    plugin: HiLighterPlugin;
    file: TFile | null = null;
    book: Book | null = null;
    rendition: Rendition | null = null;

    private chapterEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
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

    /** Obsidian calls this for registered-extension views. */
    onLoadFile(file: TFile): void {
        this.file = file;
        void this.openBook(file);
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass('hl-epub-view');
        this.buildShell();
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

    private async openBook(file: TFile): Promise<void> {
        try {
            this.destroyBook();

            const data = await this.plugin.app.vault.readBinary(file);
            const container = this.contentEl.createDiv('hl-epub-container');
            this.contentEl.appendChild(container);

            const book = ePubLib(data as unknown as string) as unknown as Book;
            const rendition = book.renderTo(container, {
                width: '100%',
                height: '100%',
                spread: 'none',
                allowScriptedContent: false,
            });
            this.book = book;
            this.rendition = rendition;

            this.applyTheme();
            this.wireRendition(rendition);
            openEpubRegistry().set(file.path, this);

            const start = this.plugin.settings.epubProgress?.[file.path];
            await rendition.display(start ?? undefined);
            void this.refreshChapterTitle();
        } catch {
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
                const text = contents.window.getSelection()?.toString().trim() ?? '';
                if (!text || text.length > 2000) return;

                // Translate iframe coords into the main window
                const win = contents.window;
                const range = win.getSelection()?.getRangeAt(0);
                const iframe = contents.document.documentElement;
                void iframe;
                let x = 0, y = 0;
                if (range) {
                    const host = (contents.content as unknown as HTMLElement | null)
                        ?? this.contentEl.querySelector('iframe');
                    const hostRect = host?.getBoundingClientRect();
                    const r = range.getBoundingClientRect();
                    x = (hostRect?.left ?? 0) + r.left + r.width / 2;
                    y = (hostRect?.top ?? 0) + r.top - 50;
                }
                if (y < 60) y = 90;

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

        // Replay annotations on every section render
        rendition.on('rendered', () => {
            void this.reapplyAnnotations();
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

    /** Immediately annotate a just-created epub highlight. */
    async applyAnnotation(note: HighlightNote): Promise<void> {
        if (!this.rendition || !note.cfi) return;
        applyAnnotations(this.rendition, [note], (n) => resolveHex(this.plugin.settings, n.color));
    }

    async reapplyAnnotations(): Promise<void> {
        if (!this.rendition || !this.file) return;
        const notes = (await db.getHighlightsByPath(this.file.path))
            .filter(n => n.anchorType === 'epub' && n.cfi);
        applyAnnotations(this.rendition, notes, (n) => resolveHex(this.plugin.settings, n.color));
    }

    async gotoCfi(cfi: string): Promise<void> {
        if (!this.rendition) return;
        await this.rendition.display(cfi);
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

    private destroyBook(): void {
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
        if (this.file) openEpubRegistry().delete(this.file.path);
        this.destroyBook();
    }
}
