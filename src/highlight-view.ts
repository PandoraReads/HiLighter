// @ts-nocheck
// ============================================================
// HiLighter - Highlight Notes Sidebar View
// ============================================================

import { App, ItemView, WorkspaceLeaf, Notice, setIcon, MarkdownView, TFile, MarkdownRenderer, Modal, Platform } from 'obsidian';
import { db } from './db';
import type HiLighterPlugin from './main';
import type { HighlightNote } from './models';
import { AIService, AIAction, type ChatMessage } from './ai-service';
import { HIGHLIGHT_VIEW_TYPE, HIGHLIGHT_MANAGER_VIEW_TYPE, MOBILE_RECENT_VIEW_TYPE } from './view-types';
import { t } from './i18n';
import { deriveCardBandColor, getColors } from './colors';
import { attachImageHandlers } from './image-paste';
import { jumpToPdfNote } from './pdf/pdf-anchors';
import { jumpToEpubNote } from './epub/epub-jump';
import { compareEpubCfi } from './epub/cfi-order';
import { locateHighlightMark } from './locate';
import { changeNoteColor, removeHighlightFromVault } from './studio/actions';
import { renderAddColorForm } from './color-add';
import { applyAppearance } from './appearance';
import { randomUUID } from './mocks/crypto';
import { cardLabel, cardPreviewMarkdown, cardSearchText, cardTemplate } from './card-templates';
import { cardReferenceMarkdown } from './studio/card-reference-format';
import { makeChatIdea } from './studio/chat-idea';
import { shouldSubmitChat } from './studio/chat-submit';
import { sortArticlePaths } from './studio/article-sort';
import { orderHierarchy, visibleRelation } from './studio/card-hierarchy';
import { CARD_DRAG_MIME, CARD_DRAG_BATCH_MIME, dragCardIds, parseDraggedCardIds } from './studio/card-drag-selection';
import { renderCardLayout, renderSidebarCardLayout } from './card-layout';
import { HighlightDetailModal } from './studio/modals';
import { SidebarBatchTagModal } from './studio/sidebar-batch-modal';
import { editCardTags, type BatchTagOperation } from './studio/sidebar-batch-tags';
import { ConfirmModal } from './ui/confirm-modal';
import { scrollRestoreDecision, type SidebarScrollSnapshot } from './studio/sidebar-scroll-restore';

export { HIGHLIGHT_VIEW_TYPE };

export class HighlightView extends ItemView {
    private plugin: HiLighterPlugin;
    private aiService: AIService;
    private currentFilter: 'active' | 'all' | 'article' = 'all';
    private articlePath = '';
    private articleRequest = 0;
    private selectedChatCards = new Set<string>();
    private chatMessages: ChatMessage[] = [];
    private readonly chatResponseSources = new Map<number, HighlightNote[]>();
    private readonly savedChatResponses = new Set<number>();
    private chatModelId = '';
    private chatBusy = false;
    private sidebarBatchBusy = false;
    private cardDepths = new Map<string, number>();
    private chatCollapsed = false;
    private chatHistoryOpen = true;
    private searchQuery: string = '';
    private isSidebarPinned: boolean = false;
    private isRenderingFlag: boolean = false;
    private colorFilter: string = 'all';
    private aiPreviews: Map<string, string> = new Map();
    private cardViewMode: 'expanded' | 'collapsed' = 'expanded';
    private autoOpenNoteId: string | null = null;
    private expandedNotes: Set<string> = new Set();
    private pendingDeleteIds: Set<string> = new Set();
    private markdownObserver: IntersectionObserver | null = null;
    private lazyMarkdownCallbacks = new WeakMap<HTMLElement, Array<() => void>>();
    private pendingCardHighlights: HighlightNote[] = [];
    private renderedCardCount = 0;
    private cardBatchFrame: number | null = null;
    private pendingScrollRestore: (SidebarScrollSnapshot & { loadedCount: number }) | null = null;
    private lastScrollScope = '';
    private cardRenderGeneration = 0;
    private readonly cardBatchSize = 12;
    private readonly recentPageSize = 50;
    private recentHighlights: HighlightNote[] = [];
    private recentQueryKey = '';
    private recentDataSeq = -1;
    private backToTopBtn: HTMLElement | null = null;
    private recentPageLoaded = false;
    private recentHasMore = false;
    private recentLoading = false;
    private recentEpoch = 0;
    private renderRequested = false;
    private lastCardSig: string | null = null;
    private renderTimer: number | null = null;
    private searchTimeout: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.aiService = new AIService(plugin.settings);
        this.colorFilter = 'all';
    }

    getViewType(): string { return HIGHLIGHT_VIEW_TYPE; }
    getDisplayText(): string { return t('view.highlightNotes'); }
    getIcon(): string { return 'highlighter'; }

    async onOpen() {
        void this.render();
        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            if (!file) return;
            this.currentFilter = 'active';
            this.scheduleRender(120);
        }));
        // Register events for dynamic updates
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (this.currentFilter === 'active' && leaf?.view instanceof MarkdownView) {
                // Buffer + debounce to avoid race conditions and flicker during document switches
                this.scheduleRender(120);
            }
        }));
        // 3. Global Pointer Listener for Menu Recycling (Better for Mobile Touch)
        this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
            const menus = this.contentEl.querySelectorAll('.hl-footer-more-menu.is-open');
            menus.forEach(menu => {
                // If the click is NOT inside the menu and NOT on a more-btn trigger
                const isClickInsideMenu = menu.contains(e.target as Node);
                const isClickOnTrigger = (e.target as HTMLElement).closest('.hl-footer-icon-btn');

                if (!isClickInsideMenu && !isClickOnTrigger) {
                    menu.removeClass('is-open');
                }
            });
        });

        this.registerDomEvent(document, 'pointerdown', (event: PointerEvent) => {
            const target = event.target as Node | null;
            const dropdown = this.contentEl.querySelector('.hl-article-dropdown');
            const trigger = this.contentEl.querySelector('.hl-article-tab-wrap');
            if (target && (dropdown?.contains(target) || trigger?.contains(target))) return;
            this.articleRequest += 1;
            dropdown?.remove();
        }, true);

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            if (this.currentFilter === 'active') {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) this.scheduleRender();
            }
        }));
    }

    onClose() {
        this.markdownObserver?.disconnect();
        this.markdownObserver = null;
        this.cardRenderGeneration += 1;
        this.pendingCardHighlights = [];
        this.pendingScrollRestore = null;
        this.resetRecentPage();
        this.lastCardSig = null;
        if (this.cardBatchFrame !== null) {
            cancelAnimationFrame(this.cardBatchFrame);
            this.cardBatchFrame = null;
        }
        const container = this.contentEl.querySelector<HTMLElement>('.hl-highlight-container');
        if (container) container.onscroll = null;
        if (this.renderTimer) {
            window.clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }
    }

    private prepareMarkdownObserver(root: HTMLElement) {
        this.markdownObserver?.disconnect();
        this.lazyMarkdownCallbacks = new WeakMap();

        if (typeof IntersectionObserver === 'undefined') {
            this.markdownObserver = null;
            return;
        }

        this.markdownObserver = new IntersectionObserver((entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;

                const card = entry.target as HTMLElement;
                observer.unobserve(card);
                const callbacks = this.lazyMarkdownCallbacks.get(card) || [];
                this.lazyMarkdownCallbacks.delete(card);
                callbacks.forEach(render => render());
            }
        }, { root, rootMargin: '120px 0px' });
    }

    private scheduleNextCardBatch(container: HTMLElement) {
        if (this.cardBatchFrame !== null || this.renderedCardCount >= this.pendingCardHighlights.length) return;

        const generation = this.cardRenderGeneration;
        this.cardBatchFrame = window.requestAnimationFrame(() => {
            this.cardBatchFrame = null;
            if (generation !== this.cardRenderGeneration || !container.isConnected) return;

            const batchEnd = Math.min(
                this.renderedCardCount + (Platform.isMobile ? 2 : this.cardBatchSize),
                this.pendingCardHighlights.length,
            );
            for (let index = this.renderedCardCount; index < batchEnd; index += 1) {
                this.renderCard(container, this.pendingCardHighlights[index]);
            }
            this.renderedCardCount = batchEnd;

            if (this.restoreScrollAfterBatch(container)) return;

            // Keep roughly one viewport of cards ready ahead of the user's scroll.
            // This bounds startup work while avoiding a pause at the end of each batch.
            if (this.renderedCardCount < this.pendingCardHighlights.length && container.clientHeight > 0) {
                const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (distanceToBottom <= container.clientHeight * 1.5) {
                    this.scheduleNextCardBatch(container);
                }
            } else if (this.currentFilter === 'all' && this.recentHasMore && container.clientHeight > 0) {
                this.handleCardContainerScroll(container);
            }
        });
    }

    private handleCardContainerScroll(container: HTMLElement) {
        this.backToTopBtn?.toggleClass('is-hidden', container.scrollTop < 300);
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceToBottom <= container.clientHeight * 1.5) {
            if (this.renderedCardCount < this.pendingCardHighlights.length) {
                this.scheduleNextCardBatch(container);
            } else if (this.currentFilter === 'all' && this.recentHasMore) {
                void this.loadMoreRecent(container);
            }
        }
    }

    private snapshotScroll(container: HTMLElement): (SidebarScrollSnapshot & { loadedCount: number }) | null {
        if (container.scrollTop <= 0) return null;
        const top = container.getBoundingClientRect().top;
        const anchor = Array.from(container.querySelectorAll<HTMLElement>('.hl-highlight-card[data-hl-card-id]'))
            .find(card => card.getBoundingClientRect().bottom > top);
        return {
            anchorId: anchor?.dataset.hlCardId ?? null,
            offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
            previousTop: container.scrollTop,
            loadedCount: this.recentHighlights.length,
        };
    }

    private restoreScrollAfterBatch(container: HTMLElement): boolean {
        const snapshot = this.pendingScrollRestore;
        if (!snapshot) return false;
        const anchor = snapshot.anchorId
            ? Array.from(container.querySelectorAll<HTMLElement>('.hl-highlight-card[data-hl-card-id]')).find(card => card.dataset.hlCardId === snapshot.anchorId)
            : undefined;
        const moreBatches = this.renderedCardCount < this.pendingCardHighlights.length;
        const morePages = this.currentFilter === 'all' && this.recentHasMore && this.recentHighlights.length < snapshot.loadedCount;
        const decision = scrollRestoreDecision({
            anchorTop: anchor ? container.scrollTop + anchor.getBoundingClientRect().top - container.getBoundingClientRect().top : null,
            offset: snapshot.offset,
            previousTop: snapshot.previousTop,
            maxScroll: Math.max(0, container.scrollHeight - container.clientHeight),
            more: moreBatches || morePages,
        });
        if (decision.kind === 'load') {
            if (moreBatches) this.scheduleNextCardBatch(container);
            else if (morePages) void this.loadMoreRecent(container);
            return true;
        }
        this.pendingScrollRestore = null;
        container.scrollTop = decision.top;
        this.backToTopBtn?.toggleClass('is-hidden', container.scrollTop < 300);
        return false;
    }

    private resetRecentPage() {
        this.recentEpoch += 1;
        this.recentHighlights = [];
        this.recentQueryKey = '';
        this.recentDataSeq = -1;
        this.recentPageLoaded = false;
        this.recentHasMore = false;
        this.recentLoading = false;
    }

    private async loadMoreRecent(container: HTMLElement) {
        if (this.recentLoading || !this.recentHasMore || this.currentFilter !== 'all') return;
        this.recentLoading = true;
        const epoch = this.recentEpoch;
        const offset = this.recentHighlights.length;
        try {
            const page = await db.getRecentHighlightsPage(offset, this.recentPageSize, {
                search: this.searchQuery,
                color: this.colorFilter,
            });
            if (epoch !== this.recentEpoch || this.currentFilter !== 'all' || !container.isConnected) return;
            if (db.getChangeSeq() !== this.recentDataSeq) {
                this.resetRecentPage();
                void this.render();
                return;
            }
            this.recentHighlights = [...this.recentHighlights, ...page.notes];
            this.recentHasMore = page.hasMore;
            this.pendingCardHighlights = [
                ...this.pendingCardHighlights,
                ...page.notes.filter(note => !this.pendingDeleteIds.has(note.id)),
            ];
            if (page.notes.length) this.scheduleNextCardBatch(container);
            else this.restoreScrollAfterBatch(container);
        } catch {
            new Notice(t('recent.loadFailed'));
        } finally {
            if (epoch === this.recentEpoch) this.recentLoading = false;
        }
    }

    private renderMarkdownWhenVisible(card: HTMLElement, target: HTMLElement, markdown: string, sourcePath: string) {
        const render = () => {
            if (!target.isConnected || target.dataset.hlMarkdownRendered === 'true') return;
            target.dataset.hlMarkdownRendered = 'true';
            if (Platform.isMobile) {
                target.setText(markdown);
                return;
            }
            void MarkdownRenderer.render(this.app, markdown, target, sourcePath, this)
                .catch(err => console.error('[HiLighter] card markdown render failed:', err));
        };

        if (!this.markdownObserver) {
            render();
            return;
        }

        const callbacks = this.lazyMarkdownCallbacks.get(card) || [];
        callbacks.push(render);
        this.lazyMarkdownCallbacks.set(card, callbacks);
        this.markdownObserver.observe(card);
    }

    /**
     * Coalesce rapid workspace events (layout-change fires very often) into a single
     * render. Without this, many cards cause a visible empty→rebuild flicker on every
     * event and text can appear incomplete during the rebuild.
     */
    private scheduleRender(delay = 150) {
        if (this.renderTimer) window.clearTimeout(this.renderTimer);
        this.renderTimer = window.setTimeout(() => {
            this.renderTimer = null;
            void this.render();
        }, delay);
    }

    async render() {
        if (this.isRenderingFlag) {
            this.renderRequested = true;
            return;
        }
        this.isRenderingFlag = true;
        this.aiService.updateSettings(this.plugin.settings);

        try {
            const { contentEl } = this;

            // Apply theme / density / accent (idempotent; safe every render)
            contentEl.addClass('hl-highlight-view');
            applyAppearance(contentEl, this.plugin.settings);

            // The legacy "all" setting now denotes the recent, paged sidebar.
            // Keep the stored value so existing users retain their selected tab.
            contentEl.setAttribute('data-hl-scope', this.currentFilter);

            // 1. Preserve Scroll Position
            const containerEl = contentEl.querySelector('.hl-highlight-container');
            const scope = JSON.stringify([this.currentFilter, this.articlePath, this.colorFilter, this.searchQuery]);
            const scrollSnapshot = containerEl && scope === this.lastScrollScope
                ? this.pendingScrollRestore ?? this.snapshotScroll(containerEl as HTMLElement) : null;
            this.lastScrollScope = scope;

            // 2. Persistent Toolbar & Container
            let toolbar = contentEl.querySelector('.hl-highlight-toolbar') as HTMLElement;
            if (!toolbar) {
                toolbar = this.renderToolbar(contentEl);
            }
            const modeTab = toolbar.querySelector<HTMLElement>('.tab-expand');
            modeTab?.toggleClass('is-active', this.cardViewMode === 'expanded');
            const scopeTab = toolbar.querySelector<HTMLElement>('.tab-scope');
            scopeTab?.toggleClass('is-active', this.currentFilter === 'active');
            if (scopeTab) scopeTab.setText(this.currentFilter === 'active' ? t('toolbar.scope.active') : t('toolbar.scope.all'));
            toolbar.querySelector<HTMLElement>('.tab-article')?.toggleClass('is-active', this.currentFilter === 'article');

            let container = contentEl.querySelector('.hl-highlight-container') as HTMLElement;
            if (!container) {
                container = contentEl.createDiv('hl-highlight-container');
                this.registerDomEvent(container, 'wheel', () => { this.pendingScrollRestore = null; }, { passive: true });
                this.registerDomEvent(container, 'touchstart', () => { this.pendingScrollRestore = null; }, { passive: true });
            }
            if (!contentEl.querySelector('.hl-sidebar-chat')) this.renderChatPanel(contentEl);

            let highlights: HighlightNote[] = [];
            const activeFile = this.app.workspace.getActiveFile();

            if (this.currentFilter === 'active' || this.currentFilter === 'article') {
                if (this.recentPageLoaded || this.recentLoading) this.resetRecentPage();
                const selectedFile = this.currentFilter === 'article' ? this.app.vault.getAbstractFileByPath(this.articlePath) : activeFile;
                if (selectedFile instanceof TFile) {
                    highlights = await db.getHighlightsByPath(selectedFile.path);

                    if (!Platform.isMobile && selectedFile.extension === 'md') {
                        // Desktop can afford a full-file rescan to refresh line order.
                        // (Markdown only — other anchors have no in-file marks to find,
                        // and reading a binary epub/pdf as text is pure waste.)
                        const content = await this.app.vault.read(selectedFile);
                        const lines = content.split('\n');
                        const idToLine = new Map<string, number>();

                        lines.forEach((line, index) => {
                            const matches = line.matchAll(/data-id="([^"]+)"/g);
                            for (const match of matches) {
                                idToLine.set(match[1], index);
                            }
                        });

                        highlights.forEach(h => {
                            if (idToLine.has(h.id)) {
                                h.lineIndex = idToLine.get(h.id);
                            }
                        });
                    }
                }
            } else {
                const queryKey = JSON.stringify([this.searchQuery.trim().toLowerCase(), this.colorFilter]);
                const dataSeq = db.getChangeSeq();
                if (this.recentQueryKey !== queryKey || this.recentDataSeq !== dataSeq) {
                    this.resetRecentPage();
                    this.recentQueryKey = queryKey;
                    this.recentDataSeq = dataSeq;
                }
                if (!this.recentPageLoaded) {
                    const epoch = this.recentEpoch;
                    const page = await db.getRecentHighlightsPage(0, this.recentPageSize, {
                        search: this.searchQuery,
                        color: this.colorFilter,
                    });
                    if (epoch !== this.recentEpoch) return;
                    if (db.getChangeSeq() !== this.recentDataSeq) {
                        this.resetRecentPage();
                        this.renderRequested = true;
                        return;
                    }
                    this.recentHighlights = page.notes;
                    this.recentHasMore = page.hasMore;
                    this.recentPageLoaded = true;
                }
                highlights = this.recentHighlights;
            }

            // Apply filters
            highlights = highlights.filter(h => {
                const q = this.searchQuery.toLowerCase();
                const matchesSearch = cardSearchText(h).includes(q);
                const matchesColor = this.colorFilter === 'all' || h.color === this.colorFilter;
                return matchesSearch && matchesColor;
            });

            // The current note follows its document order; recent keeps the
            // createdAt-descending order supplied by the IndexedDB index.
            if (this.currentFilter === 'active' || this.currentFilter === 'article') {
                highlights.sort((a, b) => {
                    const pathSort = a.sourcePath.localeCompare(b.sourcePath);
                    if (pathSort !== 0) return pathSort;
                    // EPUB cards have no line anchor — order them by their CFI
                    // position so the list follows the book's reading order.
                    if (a.anchorType === 'epub' && a.cfi && b.anchorType === 'epub' && b.cfi) {
                        const cfiSort = compareEpubCfi(a.cfi, b.cfi);
                        if (cfiSort !== 0) return cfiSort;
                        return a.createdAt - b.createdAt;
                    }
                    return (a.lineIndex ?? 0) - (b.lineIndex ?? 0);
                });
            }

            const hierarchy = orderHierarchy(highlights);
            highlights = hierarchy.map(item => item.card);
            this.cardDepths = new Map(hierarchy.map(item => [item.card.id, item.depth]));

            // Skip the expensive card rebuild when nothing affecting the cards has
            // changed since the last render. layout-change fires very often; without
            // this guard, many cards cause a visible empty→rebuild flicker every time.
            let highlightsHash = 2166136261;
            for (const h of highlights) {
                const item = `${h.id}|${h.color}|${h.lineIndex ?? 0}|${h.text}|${h.note}|${h.title ?? ''}|${h.templateId ?? ''}|${JSON.stringify(h.cardFields ?? {})}|${JSON.stringify(h.links ?? [])}|${(h.tags || []).join('+')}`;
                for (let index = 0; index < item.length; index += 1) {
                    highlightsHash = Math.imul(highlightsHash ^ item.charCodeAt(index), 16777619);
                }
            }

            const cardSig = [
                this.currentFilter,
                this.articlePath,
                this.cardViewMode,
                this.colorFilter,
                this.searchQuery,
                [...this.pendingDeleteIds].join(','),
                [...this.expandedNotes].join(','),
                this.autoOpenNoteId || '',
                [...this.aiPreviews.entries()].map(([k, v]) => `${k}:${v.length}`).join('|'),
                highlights.length,
                (highlightsHash >>> 0).toString(36),
            ].join('##');

            if (cardSig !== this.lastCardSig) {
                this.lastCardSig = cardSig;

                this.cardRenderGeneration += 1;
                if (this.cardBatchFrame !== null) {
                    cancelAnimationFrame(this.cardBatchFrame);
                    this.cardBatchFrame = null;
                }

                // Now that we have the data, safely clear the container
                this.prepareMarkdownObserver(container);
                container.empty();

                this.pendingCardHighlights = highlights.filter(h => !this.pendingDeleteIds.has(h.id));
                this.renderedCardCount = 0;
                this.pendingScrollRestore = scrollSnapshot;
                container.onscroll = () => this.handleCardContainerScroll(container);
                container.ondragover = event => {
                    if (!event.dataTransfer?.types.includes(CARD_DRAG_MIME) || (event.target as Element).closest('.hl-highlight-card')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'link';
                };
                container.ondrop = event => {
                    if ((event.target as Element).closest('.hl-highlight-card')) return;
                    const ids = parseDraggedCardIds(event.dataTransfer?.getData(CARD_DRAG_MIME) ?? '', event.dataTransfer?.getData(CARD_DRAG_BATCH_MIME) ?? '');
                    if (!ids.length) return;
                    event.preventDefault();
                    void this.moveDraggedCards(ids, null);
                };

                if (this.pendingCardHighlights.length === 0) {
                    this.renderEmpty(container);
                    this.pendingScrollRestore = null;
                } else {
                    this.scheduleNextCardBatch(container);
                }
            }

            // 3. Floating Action Button(s): Full-text AI Analysis
            let fabStack = contentEl.querySelector('.hl-fab-stack') as HTMLElement;
            if (!fabStack) {
                fabStack = contentEl.createDiv('hl-fab-stack');
            }
            contentEl.querySelector('.hl-sidebar-chat')?.appendChild(fabStack);
            fabStack.empty();

            // Back-to-top: shown after the list has scrolled down a bit.
            const topBtn = fabStack.createEl('button', {
                cls: 'hl-fab hl-fab--top is-hidden',
                attr: { title: t('sidebar.backToTop'), 'aria-label': t('sidebar.backToTop') },
            });
            setIcon(topBtn, 'arrow-up');
            topBtn.onclick = () => container.scrollTo({ top: 0, behavior: 'smooth' });
            this.backToTopBtn = topBtn;
            topBtn.toggleClass('is-hidden', container.scrollTop < 300);

            if (this.currentFilter === 'active' && activeFile) {
                // Headings → Highlights: AI extracts section titles into highlight cards
                const headingsBtn = fabStack.createEl('button', {
                    cls: 'hl-fab hl-fab--headings',
                    attr: { title: t('analysis.headings.btn'), 'aria-label': t('analysis.headings.btn') }
                });
                setIcon(headingsBtn, 'list');

                headingsBtn.onclick = () => {
                    void this.handleHeadingsToHighlights(activeFile);
                };
            }
        } catch (err) {
            console.error('[HiLighter] Sidebar render error', err);
            const container = this.contentEl.querySelector('.hl-highlight-container');
            if (container) {
                container.createEl('p', { text: t('view.loadError') + err.message, cls: 'hl-error-msg' });
            }
        } finally {
            this.isRenderingFlag = false;
            if (this.renderRequested) {
                this.renderRequested = false;
                void this.render();
            }
        }
    }

    /**
     * Headings → Highlights: ask the AI to extract the article's section titles
     * and turn each into a highlight card for the active file (no document change).
     */
    private async handleHeadingsToHighlights(activeFile: TFile) {
        const fabStack = this.contentEl.querySelector('.hl-fab-stack');
        const btn = fabStack?.querySelector('.hl-fab--headings') as HTMLButtonElement;
        if (!btn) return;

        btn.disabled = true;
        setIcon(btn, 'loader');

        try {
            // 1. Read file + clean for AI input (strip existing marks + frontmatter)
            const fullContent = await this.app.vault.read(activeFile);
            const cleanContent = fullContent
                .replace(/<mark[^>]*data-id="[^"]*"[^>]*>(.*?)<\/mark>/g, '$1')
                .replace(/^---\n[\s\S]*?\n---\n?/, '');

            // 2. Ask the AI for section titles
            new Notice(t('notice.headingsStart'));
            const titles = await this.aiService.extractSectionTitles(cleanContent);

            if (titles.length === 0) {
                new Notice(t('notice.headingsEmpty'));
                return;
            }

            // 3. Skip titles already present for this file (avoid duplicates on re-run)
            const existing = await db.getHighlightsByPath(activeFile.path);
            const seenTexts = new Set(existing.map(h => (h.text || '').trim().toLowerCase()));

            // 4. Anchor each title to the source by wrapping it in a <mark>. This makes the
            //    card a real highlight (visible in the note) AND lets the existing line-index
            //    rescan sort every card by true document order. Titles that don't appear
            //    verbatim in the note are skipped (no orphan cards / no broken sort).
            const lines = fullContent.split('\n');
            const usedLines = new Set<number>();
            const newCards: Array<{ id: string; title: string; lineIndex: number }> = [];

            const findLineFor = (title: string): number => {
                // Prefer a markdown heading line that contains the title
                for (let i = 0; i < lines.length; i++) {
                    if (usedLines.has(i) || lines[i].includes('data-id=')) continue;
                    if (/^\s{0,3}#{1,6}\s/.test(lines[i]) && lines[i].includes(title)) return i;
                }
                // Fallback: any unmarked line containing the title
                for (let i = 0; i < lines.length; i++) {
                    if (usedLines.has(i) || lines[i].includes('data-id=')) continue;
                    if (lines[i].includes(title)) return i;
                }
                return -1;
            };

            let modified = false;
            for (const title of titles) {
                const key = title.toLowerCase();
                if (seenTexts.has(key)) continue;

                const lineIdx = findLineFor(title);
                if (lineIdx === -1) continue; // not found verbatim → skip

                const id = randomUUID();
                lines[lineIdx] = lines[lineIdx].replace(
                    title,
                    `<mark class="hl-highlight hl-h-blue" data-id="${id}">${title}</mark>`
                );
                usedLines.add(lineIdx);
                seenTexts.add(key);
                newCards.push({ id, title, lineIndex: lineIdx });
                modified = true;
            }

            // 5. Write the source back once + create the DB cards
            if (modified) {
                await this.app.vault.modify(activeFile, lines.join('\n'));
            }
            const now = Date.now();
            for (let i = 0; i < newCards.length; i++) {
                const c = newCards[i];
                await db.addHighlightNote({
                    id: c.id,
                    text: c.title,
                    color: 'blue',
                    note: '',
                    sourcePath: activeFile.path,
                    lineIndex: c.lineIndex,
                    createdAt: now + i,
                });
            }

            new Notice(newCards.length > 0
                ? t('notice.headingsComplete', { count: newCards.length })
                : t('notice.headingsNoNew'));
        } catch (err) {
            console.error('[HiLighter] Headings-to-highlights error', err);
            new Notice(t('notice.headingsError') + (err instanceof Error ? err.message : String(err)));
        } finally {
            btn.disabled = false;
            void this.render();
        }
    }

    /**
     * Change a highlight's color and keep everything in sync:
     *  - the <mark class="hl-h-{color}"> tag inside the source note
     *  - the DB record (which drives the card's left border + color filtering)
     * Highlights created without an inline mark (e.g. AI heading cards) only update the DB.
     */
    private async changeHighlightColor(note: HighlightNote, newColor: string) {
        await changeNoteColor(this.app, this.plugin.settings, note, newColor);
    }

    private updateChatSelection(): void {
        const label = this.contentEl.querySelector<HTMLElement>('.hl-chat-selection-count');
        if (label) label.setText(t('chat.selected', { count: this.selectedChatCards.size }));
        const actions = this.contentEl.querySelector<HTMLElement>('.hl-sidebar-batch-actions');
        actions?.toggleClass('is-hidden', this.selectedChatCards.size === 0);
        actions?.querySelectorAll('button').forEach(button => { button.disabled = this.sidebarBatchBusy; });
    }

    private async batchEditTags(ids: readonly string[], tag: string, operation: BatchTagOperation): Promise<void> {
        if (this.sidebarBatchBusy) return;
        this.sidebarBatchBusy = true;
        this.updateChatSelection();
        let updated = 0;
        let failed = 0;
        for (const id of ids) {
            try {
                const note = await db.getHighlightNote(id);
                if (!note) { failed += 1; continue; }
                const tags = editCardTags(note.tags ?? [], tag, operation);
                if (JSON.stringify(tags) === JSON.stringify(note.tags ?? [])) continue;
                await db.updateHighlightNote(id, { tags });
                updated += 1;
            } catch { failed += 1; }
        }
        this.sidebarBatchBusy = false;
        this.updateChatSelection();
        this.plugin.refreshAllViews();
        new Notice(t(failed ? 'sidebar.batchPartial' : 'sidebar.batchTagsDone', { count: updated, failed }));
    }

    private confirmBatchDelete(): void {
        const ids = [...this.selectedChatCards];
        if (!ids.length || this.sidebarBatchBusy) return;
        new ConfirmModal(this.app, t('manager.confirm.batchDelete', { count: ids.length }), async () => {
            if (this.sidebarBatchBusy) return;
            this.sidebarBatchBusy = true;
            this.updateChatSelection();
            let deleted = 0;
            let failed = 0;
            for (const id of ids) {
                try {
                    const note = await db.getHighlightNote(id);
                    if (!note) { this.selectedChatCards = new Set([...this.selectedChatCards].filter(item => item !== id)); continue; }
                    await removeHighlightFromVault(this.app, note);
                    await db.deleteHighlightNote(id);
                    this.selectedChatCards = new Set([...this.selectedChatCards].filter(item => item !== id));
                    deleted += 1;
                } catch { failed += 1; }
            }
            this.sidebarBatchBusy = false;
            this.updateChatSelection();
            this.plugin.refreshAllViews();
            new Notice(t(failed ? 'sidebar.batchPartial' : 'manager.notice.batchDeleted', { count: deleted, failed }));
        }, { confirmText: t('btn.delete'), warning: true }).open();
    }

    private renderChatPanel(parent: HTMLElement): void {
        const panel = parent.createDiv('hl-sidebar-chat');
        const selection = panel.createDiv('hl-chat-selection');
        selection.createSpan('hl-chat-selection-count');
        const clearSelection = selection.createEl('button', { text: t('chat.clearSelection') });
        const batchActions = selection.createDiv('hl-sidebar-batch-actions is-hidden');
        const tagAction = batchActions.createEl('button', { attr: { type: 'button', title: t('sidebar.batchTags'), 'aria-label': t('sidebar.batchTags') } });
        setIcon(tagAction, 'tags');
        tagAction.onclick = () => {
            if (this.sidebarBatchBusy || !this.selectedChatCards.size) return;
            const ids = [...this.selectedChatCards];
            new SidebarBatchTagModal(this.app, (tag, operation) => { void this.batchEditTags(ids, tag, operation); }).open();
        };
        const deleteAction = batchActions.createEl('button', { attr: { type: 'button', title: t('manager.mode.deleteSelected'), 'aria-label': t('manager.mode.deleteSelected') } });
        setIcon(deleteAction, 'trash-2');
        deleteAction.onclick = () => this.confirmBatchDelete();
        const showHistory = selection.createEl('button', { cls: 'hl-chat-show-history', attr: { type: 'button', title: t('chat.showHistory'), 'aria-label': t('chat.showHistory') } });
        setIcon(showHistory, 'messages-square');
        const toggle = selection.createEl('button', { cls: 'hl-chat-toggle', attr: { type: 'button' } });
        const updateCollapse = () => {
            panel.toggleClass('is-collapsed', this.chatCollapsed);
            toggle.setAttribute('aria-expanded', String(!this.chatCollapsed));
            toggle.setAttribute('aria-label', t(this.chatCollapsed ? 'chat.expand' : 'chat.collapse'));
            toggle.setAttribute('title', t(this.chatCollapsed ? 'chat.expand' : 'chat.collapse'));
            setIcon(toggle, this.chatCollapsed ? 'chevron-up' : 'chevron-down');
        };
        toggle.onclick = () => { this.chatCollapsed = !this.chatCollapsed; updateCollapse(); };
        updateCollapse();
        const historyWindow = panel.createDiv('hl-chat-history-window');
        const historyHeader = historyWindow.createDiv('hl-chat-history-header');
        historyHeader.createSpan({ text: t('chat.title') });
        const closeHistory = historyHeader.createEl('button', { attr: { type: 'button', title: t('chat.closeHistory'), 'aria-label': t('chat.closeHistory') } });
        setIcon(closeHistory, 'x');
        const history = historyWindow.createDiv('hl-chat-history');
        const updateHistoryVisibility = () => {
            const hasMessages = this.chatMessages.length > 0;
            historyWindow.toggleClass('is-hidden', !hasMessages || !this.chatHistoryOpen);
            showHistory.toggleClass('is-hidden', !hasMessages || this.chatHistoryOpen);
        };
        closeHistory.onclick = () => { this.chatHistoryOpen = false; updateHistoryVisibility(); };
        showHistory.onclick = () => { this.chatHistoryOpen = true; this.chatCollapsed = false; updateCollapse(); updateHistoryVisibility(); };
        const drawHistory = () => {
            history.empty();
            this.chatMessages.forEach((message, index) => {
                const block = history.createDiv({ cls: `hl-chat-message is-${message.role}` });
                block.createDiv({ text: message.content });
                if (message.role === 'assistant') {
                    const save = block.createEl('button', { cls: 'hl-chat-save-idea', text: this.savedChatResponses.has(index) ? t('chat.ideaSaved') : t('chat.saveIdea') });
                    save.disabled = this.savedChatResponses.has(index);
                    save.onclick = () => {
                        if (save.disabled) return;
                        save.disabled = true;
                        void (async () => {
                            try {
                                const card = makeChatIdea(randomUUID(), t('chat.ideaTitle'), message.content, this.chatResponseSources.get(index) ?? [], Date.now());
                                await db.addHighlightNote(card);
                                this.savedChatResponses.add(index);
                                save.setText(t('chat.ideaSaved'));
                                this.plugin.refreshAllViews();
                                new Notice(t('chat.ideaSaved'));
                            } catch { save.disabled = false; new Notice(t('chat.ideaSaveFailed')); }
                        })();
                    };
                }
            });
            updateHistoryVisibility();
            history.scrollTop = history.scrollHeight;
        };
        drawHistory();
        clearSelection.onclick = () => {
            this.selectedChatCards = new Set();
            panel.parentElement?.querySelectorAll<HTMLInputElement>('.hl-chat-card-select input').forEach(element => { element.checked = false; });
            this.updateChatSelection();
        };
        this.updateChatSelection();
        const composer = panel.createDiv('hl-chat-composer');
        const input = composer.createEl('textarea', { cls: 'hl-chat-input', attr: { placeholder: t('chat.placeholder'), 'aria-label': t('chat.placeholder'), rows: '3' } });
        const controls = composer.createDiv('hl-chat-controls');
        const modelWrap = controls.createDiv('hl-chat-model-wrap');
        const modelIcon = modelWrap.createSpan('hl-chat-control-icon');
        setIcon(modelIcon, 'bot');
        const model = modelWrap.createEl('select', { cls: 'hl-chat-model', attr: { 'aria-label': t('chat.model') } });
        const addModel = modelWrap.createEl('button', { cls: 'hl-chat-add-model', text: t('chat.addModel') });
        addModel.onclick = () => {
            const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
            setting?.open(); setting?.openTabById('hilighter');
        };
        model.onchange = () => { this.chatModelId = model.value; };
        const presetsWrap = controls.createDiv('hl-chat-presets-wrap');
        const presetsIcon = presetsWrap.createSpan('hl-chat-control-icon');
        setIcon(presetsIcon, 'sparkles');
        const presets = presetsWrap.createEl('select', { cls: 'hl-chat-presets-select', attr: { 'aria-label': t('chat.presets') } });
        presets.onchange = () => {
            const prompt = this.plugin.settings.researchPrompts.find(item => item.id === presets.value);
            if (prompt) { input.value = input.value.trim() ? `${prompt.prompt}\n\n${input.value.trim()}` : prompt.prompt; input.focus(); }
            presets.value = '';
        };
        const send = controls.createEl('button', { cls: 'hl-chat-send', attr: { type: 'button', title: t('chat.send'), 'aria-label': t('chat.send') } });
        setIcon(send, 'arrow-up');
        const refreshConfig = () => {
            const models = this.plugin.settings.aiModels;
            model.empty();
            models.forEach(item => model.createEl('option', { value: item.id, text: item.name }));
            if (!models.some(item => item.id === this.chatModelId)) this.chatModelId = models.find(item => item.id === this.plugin.settings.activeModelId)?.id || models[0]?.id || '';
            model.value = this.chatModelId;
            model.toggleClass('is-hidden', models.length === 0);
            addModel.toggleClass('is-hidden', models.length > 0);
            presets.empty();
            presets.createEl('option', { value: '', text: t('chat.presets') });
            this.plugin.settings.researchPrompts.forEach(prompt => presets.createEl('option', { value: prompt.id, text: prompt.name }));
        };
        refreshConfig();
        let configSignature = JSON.stringify([this.plugin.settings.aiModels.map(item => [item.id, item.name]), this.plugin.settings.researchPrompts]);
        panel.addEventListener('focusin', () => {
            const signature = JSON.stringify([this.plugin.settings.aiModels.map(item => [item.id, item.name]), this.plugin.settings.researchPrompts]);
            if (signature !== configSignature) { configSignature = signature; refreshConfig(); }
        });
        const submit = async () => {
            const prompt = input.value.trim();
            if (!prompt || this.chatBusy) return;
            this.chatBusy = true; send.disabled = true; composer.setAttribute('aria-busy', 'true');
            try {
                const cards = (await Promise.all([...this.selectedChatCards].map(id => db.getHighlightNote(id)))).filter((item): item is HighlightNote => !!item);
                const context = cards.map((item, i) => `${i + 1}. ${item.title || ''}\n${item.text}\n${cardPreviewMarkdown(item)}`).join('\n\n');
                const userMessage: ChatMessage = { role: 'user', content: context ? `${prompt}\n\n${t('chat.cardContext')}\n${context}` : prompt };
                const next = [...this.chatMessages, userMessage];
                this.aiService.updateSettings(this.plugin.settings);
                const answer = await this.aiService.chat(next, this.chatModelId || undefined);
                this.chatMessages = [...next, { role: 'assistant', content: answer }];
                this.chatResponseSources.set(next.length, cards);
                this.chatHistoryOpen = true;
                input.value = ''; drawHistory();
            } catch (error) { new Notice(error instanceof Error ? error.message : t('chat.failed')); }
            finally { this.chatBusy = false; send.disabled = false; composer.removeAttribute('aria-busy'); }
        };
        send.onclick = () => { void submit(); };
        input.onkeydown = event => { if (shouldSubmitChat(event)) { event.preventDefault(); void submit(); } };
    }

    private renderToolbar(parent: HTMLElement): HTMLElement {
        const toolbar = parent.createDiv('hl-highlight-toolbar');

        // 1. Vintage Bookmark Tabs Row
        // All tabs share one uniform style; the active option stays 伸出 (is-active: raised).
        const tabsRow = toolbar.createDiv('hl-sidebar-tabs-row');

        const modeTab = tabsRow.createDiv({ cls: `hl-sidebar-tab tab-expand ${this.cardViewMode === 'expanded' ? 'is-active' : ''}`, text: t('toolbar.expand') });
        modeTab.setAttribute('role', 'button');
        modeTab.onclick = event => {
            event.stopPropagation();
            this.cardViewMode = this.cardViewMode === 'expanded' ? 'collapsed' : 'expanded';
            void this.render();
        };

        const scopeTab = tabsRow.createDiv({ cls: 'hl-sidebar-tab tab-scope', text: t('toolbar.scope.all') });
        scopeTab.setAttribute('role', 'button');
        scopeTab.onclick = event => {
            event.stopPropagation();
            this.currentFilter = this.currentFilter === 'active' ? 'all' : 'active';
            void this.render();
        };

        const articleWrap = tabsRow.createDiv('hl-article-tab-wrap');
        const articleTab = articleWrap.createEl('button', { cls: 'hl-sidebar-tab tab-article', text: t('sidebar.articles') });
        articleTab.onclick = event => {
            event.stopPropagation();
            const request = ++this.articleRequest;
            const existing = toolbar.querySelector('.hl-article-dropdown');
            if (existing) { existing.remove(); return; }
            void (async () => {
                const notes = await db.getAllHighlights();
                if (!articleWrap.isConnected || request !== this.articleRequest) return;
                const paths = sortArticlePaths(notes.map(note => note.sourcePath));
                const dropdown = toolbar.createDiv('hl-article-dropdown');
                paths.forEach(path => {
                    const btn = dropdown.createEl('button', { text: path.split('/').pop() || path, attr: { title: path } });
                    btn.onclick = e => { e.stopPropagation(); this.articlePath = path; this.currentFilter = 'article'; dropdown.remove(); void this.render(); };
                });
            })();
        };

        // Tab: Studio (Navigate) — standalone
        const studioTab = tabsRow.createDiv({
            cls: 'hl-sidebar-tab tab-studio',
            text: t('toolbar.cards')
        });
        studioTab.onclick = (e) => {
            e.stopPropagation();
            void this.plugin.activateView(
                Platform.isMobile ? MOBILE_RECENT_VIEW_TYPE : HIGHLIGHT_MANAGER_VIEW_TYPE,
                'main',
            );
        };

        // 2. Vintage Archive Unit (Index Card Style)
        const mainUnit = toolbar.createDiv('hl-search-main-row');

        // Search Section
        const searchSection = mainUnit.createDiv('hl-search-section');
        searchSection.createDiv({ cls: 'hl-unit-label', text: t('toolbar.search') });
        const searchInput = searchSection.createEl('input', {
            cls: 'hl-search-input',
            attr: { type: 'text', placeholder: t('toolbar.search.placeholder'), value: this.searchQuery }
        });
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            if (this.searchTimeout) {
                window.clearTimeout(this.searchTimeout);
            }
            this.searchTimeout = window.setTimeout(() => {
                void this.render();
            }, 300);
        };

        // Filter Section + Color Pills
        const filterSection = mainUnit.createDiv('hl-filter-section');
        filterSection.createDiv({ cls: 'hl-unit-label', text: t('toolbar.filter') });

        const pillsWrap = filterSection.createDiv('hl-color-pills-wrap');
        const colorPills: Array<{ id: string; cls: string; label: string; hex: string; custom?: boolean }> = [
            { id: 'all', cls: 'pill-all', label: t('toolbar.filter.all'), hex: '' },
            ...getColors(this.plugin.settings).map(c => ({
                id: c.id,
                cls: c.isCustom ? `pill-custom-${c.id}` : `pill-${c.id}`,
                label: c.label,
                hex: c.hex,
                custom: c.isCustom,
            })),
        ];

        // Filter pills always render as plain color dots — their style must NOT change
        // when the user assigns color meanings (those meanings still show on the cards).
        colorPills.forEach(pill => {
            const pillEl = pillsWrap.createDiv({
                cls: `hl-color-pill ${pill.cls} ${this.colorFilter === pill.id ? 'is-active' : ''}`,
                attr: { 'aria-label': pill.label, ...(pill.custom ? { style: `background:${pill.hex}` } : {}) }
            });
            if (pill.custom) pillEl.setAttribute('data-custom-pill', 'true');
            pillEl.onclick = () => {
                this.colorFilter = pill.id;
                void this.render();
            };
        });

        return toolbar;
    }

    private renderEmpty(parent: HTMLElement) {
        const empty = parent.createDiv('hl-empty-state');
        setIcon(empty.createDiv('hl-empty-icon'), 'highlighter');
        empty.createEl('p', { text: this.currentFilter === 'active' ? t('empty.active') : t('empty.all') });
    }

    private cleanAIResult(text: string): string {
        return text.replace(/^(--- \[.*\] ---\n?|AI\s*(翻译|注释|研究|结果|Translation|Annotation|Research|Result)\s*[:：]\s*\n?)/g, '').trim();
    }

    private async moveDraggedCards(ids: readonly string[], targetId: string | null, placement: 'child' | 'after' = 'child'): Promise<void> {
        try {
            const count = await db.moveCardHierarchy(ids, targetId, placement);
            if (!count) return;
            new Notice(t(!targetId ? 'card.hierarchyMovedRoot' : placement === 'after' ? 'card.hierarchyMovedAfter' : 'card.hierarchyMoved', { count }));
            await this.render();
        } catch { new Notice(t('card.hierarchyInvalid')); }
    }

    private wireCardDrag(card: HTMLElement, handle: HTMLElement, note: HighlightNote): void {
        const dragTarget = this.cardViewMode === 'collapsed' ? card : handle;
        dragTarget.setAttribute('draggable', 'true');
        dragTarget.setAttribute('title', t('card.dragHandle'));
        dragTarget.ondragstart = event => {
            if (!event.dataTransfer) return;
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'copyLink';
            event.dataTransfer.setData(CARD_DRAG_MIME, note.id);
            event.dataTransfer.setData(CARD_DRAG_BATCH_MIME, JSON.stringify(dragCardIds(note.id, this.selectedChatCards)));
            event.dataTransfer.setData('text/plain', cardReferenceMarkdown(note.id));
        };
        card.ondragover = event => {
            if (!event.dataTransfer?.types.includes(CARD_DRAG_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'link';
            const rect = card.getBoundingClientRect();
            const after = event.clientY >= rect.top + rect.height * 0.7;
            card.toggleClass('hl-card-drop-after', after);
            card.toggleClass('hl-card-drop-target', !after);
            card.dataset.hlDropHint = t(after ? 'card.dropAfter' : 'card.dropChild');
        };
        card.ondragleave = event => {
            if (!card.contains(event.relatedTarget as Node | null)) { card.removeClass('hl-card-drop-target'); card.removeClass('hl-card-drop-after'); }
        };
        card.ondrop = event => {
            const ids = parseDraggedCardIds(event.dataTransfer?.getData(CARD_DRAG_MIME) ?? '', event.dataTransfer?.getData(CARD_DRAG_BATCH_MIME) ?? '');
            if (!ids.length) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = card.getBoundingClientRect();
            const placement = event.clientY >= rect.top + rect.height * 0.7 ? 'after' : 'child';
            card.removeClass('hl-card-drop-target');
            card.removeClass('hl-card-drop-after');
            void this.moveDraggedCards(ids, note.id, placement);
        };
    }

    private wireChatSelection(card: HTMLElement, note: HighlightNote): void {
        card.dataset.hlCardId = note.id;
        card.style.setProperty('--hl-hierarchy-depth', String(this.cardDepths.get(note.id) ?? 0));
        const label = card.createEl('label', { cls: 'hl-chat-card-select', attr: { title: t('chat.selectCard') } });
        const input = label.createEl('input', { type: 'checkbox', attr: { 'aria-label': t('chat.selectCard') } });
        input.checked = this.selectedChatCards.has(note.id);
        label.onclick = event => event.stopPropagation();
        input.onchange = () => {
            this.selectedChatCards = input.checked
                ? new Set([...this.selectedChatCards, note.id])
                : new Set([...this.selectedChatCards].filter(id => id !== note.id));
            this.updateChatSelection();
        };
    }

    private renderCard(parent: HTMLElement, note: HighlightNote) {
        if (note.kind === 'idea') {
            const idea = parent.createDiv(`hl-highlight-card hl-idea-card ${this.cardViewMode === 'collapsed' ? 'is-collapsed' : ''}`);
            this.wireChatSelection(idea, note);
            const ideaBand = getColors(this.plugin.settings).find(color => color.id === note.color)?.hex || note.colorHex || '#8c79a5';
            idea.style.setProperty('--hl-card-band', deriveCardBandColor(ideaBand, note.color));
            const ideaTitleBand = idea.createDiv('hl-card-color-band');
            ideaTitleBand.createSpan({ text: note.title || t('card.ideaHeader') });
            ideaTitleBand.setAttribute('title', t('card.doubleClickTitle'));
            this.wireCardDrag(idea, ideaTitleBand, note);
            idea.createDiv({ cls: 'hl-h-card-text', text: note.text || note.title || t('card.ideaHeader') });
            const summary = cardPreviewMarkdown(note);
            if (summary) {
                const content = idea.createDiv('hl-h-card-note-rendered');
                if (cardTemplate(note).id !== 'excerpt') {
                    renderSidebarCardLayout(content, note);
                    if (note.note.trim()) {
                        const freeform = content.createDiv('hl-card-freeform-note hl-sidebar-freeform-note');
                        this.renderMarkdownWhenVisible(idea, freeform.createDiv('hl-sidebar-freeform-content'), note.note, note.sourcePath);
                    }
                } else {
                    this.renderMarkdownWhenVisible(idea, content, note.note, note.sourcePath);
                }
            }
            const ideaMeta = idea.createDiv('hl-card-idea-meta');
            ideaMeta.createSpan({ cls: 'hl-card-template-badge', text: cardLabel(cardTemplate(note).label) });
            const ideaLinkCount = (note.links ?? []).filter(link => visibleRelation(link.relation)).length;
            if (ideaLinkCount) ideaMeta.createSpan({ cls: 'hl-card-link-count', text: `↗ ${ideaLinkCount}` });
            let clickTimer: number | null = null;
            idea.onclick = () => {
                if (clickTimer) window.clearTimeout(clickTimer);
                clickTimer = window.setTimeout(() => {
                    clickTimer = null;
                    new HighlightDetailModal(this.app, note, () => { void this.render(); },
                        this.plugin.settings.noteImageFolder, this.plugin.settings.groupExportFolder || '').open();
                }, 240);
            };
            idea.ondblclick = (event) => {
                event.stopPropagation();
                if (clickTimer) window.clearTimeout(clickTimer);
                clickTimer = null;
                new HighlightDetailModal(this.app, note, () => { void this.render(); },
                    this.plugin.settings.noteImageFolder, this.plugin.settings.groupExportFolder || '', false, true).open();
            };
            return;
        }
        const isAnchorNote = note.anchorType === 'note';
        const card = parent.createDiv(
            `hl-highlight-card ${isAnchorNote ? 'hl-anchor-card' : `border-${note.color}`} ${this.cardViewMode === 'collapsed' ? 'is-collapsed' : ''}`
        );
        this.wireChatSelection(card, note);
        const cardBand = getColors(this.plugin.settings).find(color => color.id === note.color)?.hex || note.colorHex || '#8c79a5';
        card.style.setProperty('--hl-card-band', deriveCardBandColor(cardBand, note.color));
        card.style.setProperty('--hl-card-highlight', cardBand);
        const titleBand = card.createDiv('hl-card-color-band');
        titleBand.createSpan({ text: note.title || t('card.excerptHeader') });
        titleBand.setAttribute('title', t('card.doubleClickTitle'));
        this.wireCardDrag(card, titleBand, note);

        // --- Full Card Navigation ---
        let clickTimer: number | null = null;
        card.onclick = () => {
            if (clickTimer) window.clearTimeout(clickTimer);
            clickTimer = window.setTimeout(() => {
                clickTimer = null;
                void this.jumpToHighlight(note);
            }, 240);
        };
        card.ondblclick = (event) => {
            const target = event.target as HTMLElement;
            if (target.closest('button, input, textarea, .hl-footer-actions, .hl-h-card-note')) return;
            if (clickTimer) window.clearTimeout(clickTimer);
            clickTimer = null;
            new HighlightDetailModal(this.app, note, () => { void this.render(); },
                this.plugin.settings.noteImageFolder, this.plugin.settings.groupExportFolder || '', false, true).open();
        };

        // Text part (Clean style - no quotes, larger); anchor notes carry a
        // message-square glyph instead of the quote text when image-only.
        const textEl = card.createDiv('hl-h-card-text');
        if (isAnchorNote) {
            const anchorBadge = textEl.createDiv('hl-anchor-badge');
            setIcon(anchorBadge.createSpan({ cls: 'hl-anchor-badge-icon' }), 'message-square-plus');
            if (note.text) anchorBadge.createSpan({ cls: 'hl-anchor-badge-word', text: note.text });
        }
        textEl.createSpan({ text: note.text });
        const visibleLinkCount = (note.links ?? []).filter(link => visibleRelation(link.relation)).length;
        if (visibleLinkCount) textEl.createSpan({ cls: 'hl-card-link-count hl-card-inline-links', text: `↗ ${visibleLinkCount}` });

        // Note part
        const presentation = cardPreviewMarkdown(note);
        const hasMethodTemplate = cardTemplate(note).id !== 'excerpt';
        const noteArea = card.createDiv(`hl-h-card-note ${hasMethodTemplate ? 'hl-method-note-area' : ''}`);

        // AI Preview Area (Conditional)
        const preview = this.aiPreviews.get(note.id);
        if (preview) {
            const previewEl = card.createDiv('hl-ai-preview');
            previewEl.createDiv({ text: t('ai.preview.header'), cls: 'hl-preview-header' });
            const contentEl = previewEl.createDiv({ cls: 'hl-preview-content' });
            this.renderMarkdownWhenVisible(card, contentEl, preview, note.sourcePath);

            const pActions = previewEl.createDiv('hl-preview-actions');
            const keepBtn = pActions.createEl('button', { cls: 'hl-mini-btn btn-success', text: t('ai.preview.addToNote') });
            setIcon(keepBtn, 'check');
            keepBtn.onclick = async () => {
                const newNote = note.note ? `${note.note}\n\n${preview}` : preview;
                await db.updateHighlightNote(note.id, { note: newNote });
                this.aiPreviews.delete(note.id);
                // Flag to auto-open the note edit area on next render
                this.autoOpenNoteId = note.id;
                await this.render();
            };

            const discardBtn = pActions.createEl('button', { cls: 'hl-mini-btn btn-danger', text: t('ai.preview.discard') });
            setIcon(discardBtn, 'x');
            discardBtn.onclick = () => {
                this.aiPreviews.delete(note.id);
                void this.render();
            };
        }

        const textarea = noteArea.createEl('textarea', {
            cls: 'hl-h-textarea is-hidden',
            attr: { placeholder: t('note.placeholder') },
            text: note.note
        });

        // Paste / drop images straight into the note (saved as vault attachments)
        attachImageHandlers(this.app, textarea, note.sourcePath, {
            onImageSaved: (line) => {
                textarea.value = textarea.value ? `${textarea.value}\n\n${line}` : line;
                autoResize();
            },
        }, this.plugin.settings.noteImageFolder);

        // Prevent Obsidian's view-click handlers from stealing focus
        textarea.onclick = (e) => e.stopPropagation();
        textarea.onmousedown = (e) => e.stopPropagation();

        // Auto-resize the textarea based on content
        const autoResize = () => {
            textarea.setCssProps({ height: 'auto' });
            textarea.setCssProps({ height: Math.max(textarea.scrollHeight, 60) + 'px' });
        };
        textarea.oninput = autoResize;
        textarea.addEventListener('focus', autoResize, { once: true });

        const isExpanded = this.expandedNotes.has(note.id);
        const renderedNote = noteArea.createDiv(`hl-h-card-note-rendered ${!isExpanded && !hasMethodTemplate ? 'is-collapsed-note' : ''}`);
        if (!presentation) {
            renderedNote.setText(t('note.placeholder'));
            renderedNote.addClass('hl-empty-note-placeholder');
            renderedNote.onclick = event => {
                event.stopPropagation();
                noteArea.addClass('is-editing');
                textarea.removeClass('is-hidden');
                textarea.focus();
            };
        }
        if (presentation) {
            if (hasMethodTemplate) {
                renderSidebarCardLayout(renderedNote, note);
                if (note.note.trim()) {
                    const freeform = renderedNote.createDiv(`hl-card-freeform-note hl-sidebar-freeform-note ${!isExpanded ? 'is-collapsed-freeform' : ''}`);
                    this.renderMarkdownWhenVisible(card, freeform.createDiv('hl-sidebar-freeform-content'), note.note, note.sourcePath);
                }
            } else {
                this.renderMarkdownWhenVisible(card, renderedNote, note.note || presentation, note.sourcePath);
            }

            const hasExpandableContent = hasMethodTemplate ? Boolean(note.note.trim()) : Boolean(presentation);
            const currentToggleWrap = hasExpandableContent ? noteArea.createDiv('hl-note-toggle-wrap') : null;
            if (currentToggleWrap) {
                const toggleBtn = currentToggleWrap.createDiv('hl-note-expand-toggle');
                setIcon(toggleBtn, isExpanded ? 'chevron-up' : 'chevron-down');
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (this.expandedNotes.has(note.id)) {
                        this.expandedNotes.delete(note.id);
                    } else {
                        this.expandedNotes.add(note.id);
                    }
                    void this.render();
                };
            }

            renderedNote.onclick = (e) => {
                e.stopPropagation();
                if (cardTemplate(note).id !== 'excerpt') {
                    new HighlightDetailModal(this.app, note, () => { void this.render(); },
                        this.plugin.settings.noteImageFolder, this.plugin.settings.groupExportFolder || '').open();
                    return;
                }
                if (noteArea.hasClass('is-editing')) return;
                currentToggleWrap?.addClass('is-hidden');
                noteArea.addClass('is-editing');
                renderedNote.removeClass('is-collapsed-note');
                textarea.removeClass('is-hidden');
                textarea.focus();
            };

            // Auto-open if flagged
            if (this.autoOpenNoteId === note.id) {
                currentToggleWrap?.addClass('is-hidden');
                noteArea.addClass('is-editing');
                renderedNote.removeClass('is-collapsed-note');
                textarea.removeClass('is-hidden');
                this.autoOpenNoteId = null;
            }
        }

        textarea.onblur = async () => {
            if (this.pendingDeleteIds.has(note.id)) return;
            if (textarea.value !== note.note) {
                await db.updateHighlightNote(note.id, { note: textarea.value });
                this.lastCardSig = null;
                void this.render();
                return;
            }
            noteArea.removeClass('is-editing');
            textarea.addClass('is-hidden');
            if (!isExpanded && !hasMethodTemplate) renderedNote.addClass('is-collapsed-note');
            noteArea.querySelector('.hl-note-toggle-wrap')?.removeClass('is-hidden');
        };

        textarea.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                textarea.blur(); // Trigger save via blur
            }
        };

        // Footer (Links + Actions)
        const footer = card.createDiv('hl-h-card-footer');

        // Row 1: Left (Tags) + Right (Actions)
        const footerRow1 = footer.createDiv('hl-footer-row-main');

        // --- Left Side: Color meaning chip + Tags ---
        const footerLeft = footerRow1.createDiv('hl-footer-left-tags');
        if (note.templateId && note.templateId !== 'excerpt') {
            footerLeft.createSpan({ cls: 'hl-card-template-badge', text: cardLabel(cardTemplate(note).label) });
        }
        const colorMeaning = (this.plugin.settings.colorLabels as Record<string, string>)?.[note.color];
        if (colorMeaning) {
            const colorChip = footerLeft.createSpan({ cls: `hl-color-chip chip-${note.color}` });
            colorChip.createSpan({ text: colorMeaning });
        }
        if (note.tags && note.tags.length > 0) {
            note.tags.forEach(tag => {
                const tagEl = footerLeft.createSpan({ cls: 'hl-tag-mini' });
                setIcon(tagEl, 'tag');
                tagEl.createSpan({ text: tag });
            });
        }

        const footerActions = footerRow1.createDiv('hl-footer-actions');

        // --- Priority Actions (Always Visible) ---

        // 2. Translate Button (AI)
        const translateBtn = footerActions.createDiv('hl-footer-icon-btn');
        setIcon(translateBtn, 'languages');
        translateBtn.setAttribute('aria-label', t('aria.aiTranslate'));
        translateBtn.onclick = async (e) => {
            e.stopPropagation();
            translateBtn.addClass('is-loading');
            try {
                const result = await this.aiService.processAction(note.text, 'translate');
                const cleaned = this.cleanAIResult(result);
                this.aiPreviews.set(note.id, cleaned);
                void this.render();
                new Notice(t('notice.translateComplete'));
                // Ensure sidebar stays open on mobile/tablet after render
                if (this.app.workspace.rightSplit) {
                    this.app.workspace.rightSplit.expand();
                }
            } catch (err) {
                new Notice(t('notice.translateError') + err.message);
            } finally {
                translateBtn.removeClass('is-loading');
            }
        };

        const developBtn = footerActions.createEl('button', { cls: 'hl-footer-icon-btn', attr: { 'aria-label': t('card.openEditor') } });
        setIcon(developBtn, 'layout-template');
        developBtn.onclick = (event) => {
            event.stopPropagation();
            new HighlightDetailModal(this.app, note, () => { void this.render(); },
                this.plugin.settings.noteImageFolder, this.plugin.settings.groupExportFolder || '').open();
        };

        // --- Folded Actions (The "More" Menu) ---
        const moreBtn = footerActions.createDiv('hl-footer-icon-btn');
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('aria.moreActions'));

        const moreMenu = footerActions.createDiv('hl-footer-more-menu');

        // Change color — opens a floating color popover anchored to this button
        const colorBtn = moreMenu.createDiv('hl-footer-icon-btn');
        setIcon(colorBtn, 'palette');
        colorBtn.setAttribute('aria-label', t('aria.changeColor'));
        colorBtn.onclick = (e) => {
            e.stopPropagation();
            moreMenu.removeClass('is-open');
            // Close any popover already open
            document.querySelectorAll('.hl-color-popover').forEach(el => el.remove());

            const popover = document.body.createDiv('hl-color-popover');
            getColors(this.plugin.settings).forEach(c => {
                const dot = popover.createDiv({
                    cls: `hl-color-dot dot-${c.id} ${note.color === c.id ? 'is-active' : ''}`
                });
                dot.setAttribute('aria-label', c.label);
                if (c.isCustom) dot.setAttribute('data-custom', 'true');
                dot.onclick = async (ev) => {
                    ev.stopPropagation();
                    popover.remove();
                    await this.changeHighlightColor(note, c.id);
                    void this.render();
                };
            });

            // "+" — add a custom color without leaving the popover
            const addWrap = popover.createDiv('hl-color-add-wrap');
            const addDot = addWrap.createDiv('hl-color-dot hl-dot-add');
            setIcon(addDot, 'plus');
            addDot.setAttribute('aria-label', t('colors.add'));
            addDot.setAttribute('title', t('colors.add'));
            addDot.onclick = (ev) => {
                ev.stopPropagation();
                const formWrap = popover.createDiv('hl-color-add-form-wrap');
                renderAddColorForm(this.plugin, formWrap, document, () => {
                    popover.remove();
                    void this.render();
                });
            };

            // Position: below the button, right-aligned, clamped to the viewport
            const rect = colorBtn.getBoundingClientRect();
            const popRect = popover.getBoundingClientRect();
            let left = rect.right - popRect.width;
            if (left < 8) left = 8;
            if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - 8 - popRect.width;
            popover.style.top = `${rect.bottom + 6}px`;
            popover.style.left = `${left}px`;

            // Close on outside click
            window.setTimeout(() => {
                const handler = (ev: PointerEvent) => {
                    if (!popover.contains(ev.target as Node)) {
                        popover.remove();
                        document.removeEventListener('pointerdown', handler, true);
                    }
                };
                document.addEventListener('pointerdown', handler, true);
            }, 0);
        };

        // 4. Tag Button (Hidden in More)
        const tagBtn = moreMenu.createDiv('hl-footer-icon-btn');
        setIcon(tagBtn, 'tags');
        tagBtn.setAttribute('aria-label', t('aria.manageTags'));
        tagBtn.onclick = async (e) => {
            e.stopPropagation();
            moreMenu.removeClass('is-open');
            const existingManager = card.querySelector('.hl-tag-manager');
            if (existingManager) {
                existingManager.remove();
                return;
            }

            const manager = card.createDiv({ cls: 'hl-tag-manager', insertBefore: footer });
            manager.onclick = (e) => e.stopPropagation();

            // List existing tags with delete buttons
            const list = manager.createDiv('hl-tag-manager-list');
            if (note.tags && note.tags.length > 0) {
                note.tags.forEach(tag => {
                    const item = list.createDiv('hl-tag-manager-item');
                    const iconSpan = item.createSpan('hl-tag-icon-small');
                    setIcon(iconSpan, 'tag');
                    item.createSpan({ text: tag });
                    const del = item.createDiv('hl-tag-del-btn');
                    setIcon(del, 'x');
                    del.onclick = async (e) => {
                        e.stopPropagation();
                        const newTags = note.tags?.filter(t => t !== tag) || [];
                        await db.updateHighlightNote(note.id, { tags: newTags });
                        note.tags = newTags;
                        void this.render();
                    };
                });
            }

            // Additive Input with dropdown
            const inputWrap = manager.createDiv('hl-tag-input-wrap');
            const input = inputWrap.createEl('input', {
                cls: 'hl-tag-input',
                attr: { type: 'text', placeholder: t('tag.input.placeholder') }
            });
            input.focus();

            // Build dropdown from existing tags
            const allHighlights = await db.getAllHighlights();
            const allTags = new Set<string>();
            allHighlights.forEach(h => {
                if (h.tags) h.tags.forEach(t => allTags.add(t));
            });
            const allTagsArr = Array.from(allTags).sort();

            const dropdown = inputWrap.createDiv('hl-tag-dropdown');

            const renderDropdown = (filter: string) => {
                dropdown.empty();
                const existing = note.tags || [];
                const filtered = allTagsArr.filter(t =>
                    t.toLowerCase().includes(filter.toLowerCase()) && !existing.includes(t)
                );
                if (filtered.length === 0) { dropdown.setCssProps({ display: 'none' }); return; }
                dropdown.setCssProps({ display: 'block' });
                filtered.forEach(t => {
                    const opt = dropdown.createDiv({ text: t, cls: 'hl-tag-dropdown-item' });
                    opt.onclick = async (ev) => {
                        ev.stopPropagation();
                        const newTags = [...(note.tags || []), t];
                        await db.updateHighlightNote(note.id, { tags: newTags });
                        note.tags = newTags;
                        void this.render();
                    };
                });
            };

            input.oninput = () => renderDropdown(input.value.trim());
            input.onfocus = () => renderDropdown(input.value.trim());

            // Input handling
            input.onkeydown = async (ev) => {
                if (ev.key === 'Enter') {
                    const val = input.value.trim().replace('#', '');
                    if (val) {
                        const newTags = [...(note.tags || []), val];
                        await db.updateHighlightNote(note.id, { tags: Array.from(new Set(newTags)) });
                        note.tags = Array.from(new Set(newTags));
                        void this.render();
                    }
                } else if (ev.key === 'Escape') {
                    manager.remove();
                }
            };

            input.onblur = () => {
                window.setTimeout(() => {
                    if (manager.parentElement) manager.remove();
                }, 200);
            };
        };

        // 5. Delete Button (Hidden in More)
        const deleteBtn = moreMenu.createDiv('hl-footer-icon-btn is-danger');
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.setAttribute('aria-label', t('aria.deleteCard'));
        deleteBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            moreMenu.removeClass('is-open');

            if (this.pendingDeleteIds.has(note.id)) return;

            deleteBtn.addClass('is-loading');
            this.pendingDeleteIds.add(note.id);
            this.isRenderingFlag = true;

            try {
                await db.deleteHighlightNote(note.id);
                await this.removeHighlightFromVault(note);
            } catch (err) {
                console.error('[HiLighter] Deletion failed', err);
                new Notice(t('notice.deleteFailed'));
                this.pendingDeleteIds.delete(note.id);
            } finally {
                this.isRenderingFlag = false;
                void this.render();
            }
        };

        // Toggle More Menu
        moreBtn.onclick = (e) => {
            e.stopPropagation();

            // Close other open menus first (Recycling)
            const allMenus = this.contentEl.querySelectorAll('.hl-footer-more-menu.is-open');
            allMenus.forEach(m => {
                if (m !== moreMenu) m.removeClass('is-open');
            });

            const isOpen = moreMenu.hasClass('is-open');
            moreMenu.toggleClass('is-open', !isOpen);
        };
    }

    private renderAIButton(parent: HTMLElement, action: AIAction, icon: string, label: string, note: HighlightNote) {
        const btn = parent.createEl('button', { cls: 'hl-ai-btn', attr: { 'aria-label': label } });
        setIcon(btn, icon);
        btn.createSpan({ text: label });

        btn.onclick = async () => {
            btn.addClass('is-loading');
            try {
                const result = await this.aiService.processAction(note.text, action);
                const cleaned = this.cleanAIResult(result);
                this.aiPreviews.set(note.id, cleaned);
                void this.render();
                new Notice(t('notice.translateComplete'));
                // Ensure sidebar stays open on mobile/tablet after render
                if (this.app.workspace.rightSplit) {
                    this.app.workspace.rightSplit.expand();
                }
            } catch (e) {
                new Notice(t('notice.aiError') + e.message);
            } finally {
                btn.removeClass('is-loading');
            }
        };
    }

    private async jumpToHighlight(note: HighlightNote) {
        // PDF sources: open + scroll to the anchored page
        if (note.sourcePath.toLowerCase().endsWith('.pdf')) {
            await jumpToPdfNote(this.app, note);
            return;
        }
        // EPUB sources: open the book + display the anchored CFI
        if (note.anchorType === 'epub' || note.sourcePath.toLowerCase().endsWith('.epub')) {
            await jumpToEpubNote(this.app, note);
            return;
        }

        // 1. Open File
        await this.app.workspace.openLinkText(note.sourcePath, '', false);

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            const editor = view.editor;
            // Scan for the id, then anchor the cursor to the sentence (not the line).
            locateHighlightMark(editor, note.id, note.lineIndex ?? 0);
        }
    }
    private async removeHighlightFromVault(note: HighlightNote) {
        try {
            // Only markdown files carry <mark> anchors (pdf/epub notes are DB-only)
            if (!note.sourcePath.toLowerCase().endsWith('.md')) return;
            const file = this.app.vault.getAbstractFileByPath(note.sourcePath);
            if (!(file instanceof TFile)) return;

            const content = await this.app.vault.read(file);
            // Regex to find the specific mark tag by its data-id
            const regex = new RegExp(`<mark[^>]*data-id="${note.id}"[^>]*>(.*?)</mark>`, 'g');
            const newContent = content.replace(regex, '$1');

            if (content !== newContent) {
                await this.app.vault.modify(file, newContent);
            }
        } catch (err) {
            console.error('[HiLighter] Failed to remove highlight from vault', err);
        }
    }
}
