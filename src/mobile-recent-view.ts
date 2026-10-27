import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type HiLighterPlugin from './main';
import { db } from './db';
import type { HighlightNote } from './models';
import { HIGHLIGHT_VIEW_TYPE, MOBILE_RECENT_VIEW_TYPE } from './view-types';
import { t } from './i18n';

const DOCUMENTS_PER_PAGE = 20;
const NOTES_PER_SCAN = 1000;

interface RecentDocument {
    path: string;
    title: string;
    preview: string;
    lastHighlightedAt: number;
    highlightCount: number;
}

export class MobileRecentHighlightsView extends ItemView {
    private plugin: HiLighterPlugin;
    private seenPaths = new Set<string>();
    private scannedNotes = 0;
    private hasMore = true;
    private isLoading = false;
    private listEl: HTMLElement | null = null;
    private loadMoreButton: HTMLButtonElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return MOBILE_RECENT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('mobileRecent.title');
    }

    getIcon(): string {
        return 'history';
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass('hl-mobile-recent-view');
        this.renderShell();
        await this.loadMoreDocuments();
    }

    private renderShell(): void {
        this.contentEl.empty();
        const header = this.contentEl.createDiv('hl-mobile-recent-header');
        header.createEl('h2', { text: t('mobileRecent.title') });
        header.createEl('p', { text: t('mobileRecent.description') });
        this.listEl = this.contentEl.createDiv('hl-mobile-recent-list');
        this.loadMoreButton = this.contentEl.createEl('button', {
            cls: 'hl-mobile-recent-more',
            text: t('mobileRecent.loadMore'),
        });
        this.loadMoreButton.onclick = () => { void this.loadMoreDocuments(); };
    }

    private async loadMoreDocuments(): Promise<void> {
        if (this.isLoading || !this.hasMore || !this.listEl || !this.loadMoreButton) return;
        this.isLoading = true;
        this.loadMoreButton.disabled = true;
        this.loadMoreButton.setText(t('mobileRecent.loading'));

        try {
            const totalNotes = await db.highlightNotes.count();
            const found: Array<{ file: TFile; latest: HighlightNote }> = [];
            let scannedThisPage = 0;

            await db.highlightNotes
                .orderBy('createdAt')
                .reverse()
                .offset(this.scannedNotes)
                .limit(NOTES_PER_SCAN)
                .each(note => {
                    scannedThisPage += 1;
                    if (note.kind === 'idea') return true;
                    const path = note.sourcePath;
                    if (!path || this.seenPaths.has(path)) return true;

                    this.seenPaths.add(path);
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (!(file instanceof TFile)) return true;

                    found.push({ file, latest: note });
                    return found.length < DOCUMENTS_PER_PAGE;
                });

            this.scannedNotes += scannedThisPage;
            this.hasMore = scannedThisPage === NOTES_PER_SCAN || this.scannedNotes < totalNotes;

            const documents = await Promise.all(found.map(async ({ file, latest }) => ({
                path: file.path,
                title: file.basename,
                preview: (latest.text || latest.note || '').replace(/\s+/g, ' ').trim(),
                lastHighlightedAt: latest.createdAt,
                highlightCount: (await db.getHighlightsByPath(file.path)).length,
            })));

            documents.forEach(document => this.renderDocument(document));

            if (this.seenPaths.size === 0 && !this.hasMore) {
                this.listEl.createDiv({ cls: 'hl-mobile-recent-empty', text: t('mobileRecent.empty') });
            } else if (documents.length === 0 && !this.hasMore && this.listEl.childElementCount === 0) {
                this.listEl.createDiv({ cls: 'hl-mobile-recent-empty', text: t('mobileRecent.empty') });
            }
        } catch (error) {
            console.error('[HiLighter] Failed to load recent highlighted documents', error);
            new Notice(t('mobileRecent.loadFailed'));
        } finally {
            this.isLoading = false;
            if (this.loadMoreButton) {
                this.loadMoreButton.disabled = !this.hasMore;
                this.loadMoreButton.setText(this.hasMore ? t('mobileRecent.loadMore') : t('mobileRecent.end'));
                this.loadMoreButton.toggleClass('is-hidden', !this.hasMore && !!this.listEl?.childElementCount);
            }
        }
    }

    private renderDocument(document: RecentDocument): void {
        if (!this.listEl) return;
        const row = this.listEl.createDiv('hl-mobile-recent-item');
        const main = row.createDiv('hl-mobile-recent-main');
        main.createDiv({ cls: 'hl-mobile-recent-name', text: document.title });
        main.createDiv({
            cls: 'hl-mobile-recent-meta',
            text: t('mobileRecent.meta', {
                count: document.highlightCount,
                date: new Date(document.lastHighlightedAt).toLocaleDateString(),
            }),
        });
        if (document.preview) {
            main.createDiv({ cls: 'hl-mobile-recent-preview', text: document.preview.slice(0, 120) });
        }
        row.createDiv('hl-mobile-recent-chevron').setText('›');
        row.onclick = () => { void this.openDocument(document.path); };
    }

    private async openDocument(path: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            new Notice(t('mobileRecent.sourceMissing'));
            return;
        }

        try {
            const documentLeaf = this.app.workspace.getLeaf('tab');
            await documentLeaf.openFile(file);
            await this.plugin.activateView(HIGHLIGHT_VIEW_TYPE, 'right');
        } catch (error) {
            console.error('[HiLighter] Failed to open highlighted document', error);
            new Notice(t('mobileRecent.openFailed'));
        }
    }
}
