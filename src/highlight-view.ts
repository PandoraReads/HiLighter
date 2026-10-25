// @ts-nocheck
// ============================================================
// HiLighter - Highlight Notes Sidebar View
// ============================================================

import { ItemView, WorkspaceLeaf, Notice, setIcon, MarkdownView, TFile, TFolder, MarkdownRenderer, Modal, Platform } from 'obsidian';
import { db } from './db';
import type HiLighterPlugin from './main';
import type { HighlightNote, ResearchPrompt } from './models';
import { AIService, AIAction } from './ai-service';
import { HIGHLIGHT_VIEW_TYPE, HIGHLIGHT_MANAGER_VIEW_TYPE, MOBILE_RECENT_VIEW_TYPE } from './view-types';
import { t } from './i18n';
import { getColors, getColorDef } from './colors';
import { attachImageHandlers } from './image-paste';
import { jumpToPdfNote } from './pdf/pdf-anchors';
import { jumpToEpubNote } from './epub/epub-jump';
import { locateHighlightMark } from './locate';
import { changeNoteColor } from './studio/actions';
import { renderAddColorForm } from './color-add';
import { applyAppearance } from './appearance';
import { randomUUID } from './mocks/crypto';

export { HIGHLIGHT_VIEW_TYPE };

// ── Prompt Selection Modal ──────────────────────────────
class PromptSelectModal extends Modal {
    private prompts: ResearchPrompt[];
    private onSelect: (prompt: ResearchPrompt) => void;

    constructor(app: any, prompts: ResearchPrompt[], onSelect: (prompt: ResearchPrompt) => void) {
        super(app);
        this.prompts = prompts;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText(t('modal.promptSelect.title'));
        this.modalEl.addClass('hl-glass-modal');

        const container = contentEl.createDiv('hl-glass-modal-body');

        const hint = container.createDiv({ cls: 'hl-prompt-select-hint', text: t('modal.promptSelect.hint') });

        this.prompts.forEach(prompt => {
            const item = container.createDiv('hl-prompt-select-item');
            item.onclick = () => {
                this.onSelect(prompt);
                this.close();
            };

            const nameEl = item.createDiv('hl-prompt-select-name');
            setIcon(nameEl.createSpan({ cls: 'hl-prompt-select-icon' }), 'sparkles');
            nameEl.createSpan({ text: prompt.name });

            const descEl = item.createDiv({ cls: 'hl-prompt-select-desc', text: prompt.prompt.length > 100 ? prompt.prompt.substring(0, 100) + '...' : prompt.prompt });
        });

        const cancelWrap = container.createDiv('hl-glass-modal-actions');
        const cancelBtn = cancelWrap.createEl('button', { text: t('btn.cancel'), cls: 'hl-glass-btn-cancel' });
        cancelBtn.onclick = () => this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class HighlightView extends ItemView {
    private plugin: HiLighterPlugin;
    private aiService: AIService;
    private currentFilter: 'active' | 'all' = 'active';
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
        this.render();
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
        this.resetRecentPage();
        (this as any)._lastCardSig = null;
        if (this.cardBatchFrame !== null) {
            cancelAnimationFrame(this.cardBatchFrame);
            this.cardBatchFrame = null;
        }
        const container = this.contentEl.querySelector('.hl-highlight-container') as HTMLElement | null;
        if (container) container.onscroll = null;
        if ((this as any)._renderTimer) {
            clearTimeout((this as any)._renderTimer);
            (this as any)._renderTimer = null;
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
        this.cardBatchFrame = requestAnimationFrame(() => {
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
                this.render();
                return;
            }
            this.recentHighlights = [...this.recentHighlights, ...page.notes];
            this.recentHasMore = page.hasMore;
            this.pendingCardHighlights = [
                ...this.pendingCardHighlights,
                ...page.notes.filter(note => !this.pendingDeleteIds.has(note.id)),
            ];
            this.scheduleNextCardBatch(container);
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
        if ((this as any)._renderTimer) clearTimeout((this as any)._renderTimer);
        (this as any)._renderTimer = setTimeout(() => {
            (this as any)._renderTimer = null;
            this.render();
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
            this.currentFilter = this.plugin.settings.sidebarScope;
            contentEl.setAttribute('data-hl-scope', this.currentFilter);

            // 1. Preserve Scroll Position
            const containerEl = contentEl.querySelector('.hl-highlight-container');
            const scrollPos = containerEl ? containerEl.scrollTop : 0;

            // 2. Persistent Toolbar & Container
            let toolbar = contentEl.querySelector('.hl-highlight-toolbar') as HTMLElement;
            if (!toolbar) {
                toolbar = this.renderToolbar(contentEl);
            }

            let container = contentEl.querySelector('.hl-highlight-container') as HTMLElement;
            if (!container) {
                container = contentEl.createDiv('hl-highlight-container');
            }

            let highlights: HighlightNote[] = [];
            const activeFile = this.app.workspace.getActiveFile();

            if (this.currentFilter === 'active') {
                if (this.recentPageLoaded || this.recentLoading) this.resetRecentPage();
                if (activeFile) {
                    highlights = await db.getHighlightsByPath(activeFile.path);

                    if (!Platform.isMobile) {
                        // Desktop can afford a full-file rescan to refresh line order.
                        const content = await this.app.vault.read(activeFile);
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
                const text = (h.text || '').toLowerCase();
                const note = (h.note || '').toLowerCase();
                const q = this.searchQuery.toLowerCase();
                const matchesSearch = (text.indexOf(q) !== -1) || (note.indexOf(q) !== -1);
                const matchesColor = this.colorFilter === 'all' || h.color === this.colorFilter;
                return matchesSearch && matchesColor;
            });

            // The current note follows its document order; recent keeps the
            // createdAt-descending order supplied by the IndexedDB index.
            if (this.currentFilter === 'active') {
                highlights.sort((a, b) => {
                    const pathSort = a.sourcePath.localeCompare(b.sourcePath);
                    if (pathSort !== 0) return pathSort;
                    return (a.lineIndex ?? 0) - (b.lineIndex ?? 0);
                });
            }

            // Skip the expensive card rebuild when nothing affecting the cards has
            // changed since the last render. layout-change fires very often; without
            // this guard, many cards cause a visible empty→rebuild flicker every time.
            let highlightsHash = 2166136261;
            for (const h of highlights) {
                const item = `${h.id}|${h.color}|${h.lineIndex ?? 0}|${(h.text || '').length}|${(h.note || '').length}|${(h.tags || []).join('+')}`;
                for (let index = 0; index < item.length; index += 1) {
                    highlightsHash = Math.imul(highlightsHash ^ item.charCodeAt(index), 16777619);
                }
            }

            const cardSig = [
                this.currentFilter,
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

            if (cardSig !== (this as any)._lastCardSig) {
                (this as any)._lastCardSig = cardSig;

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
                container.onscroll = () => this.handleCardContainerScroll(container);

                if (this.pendingCardHighlights.length === 0) {
                    this.renderEmpty(container);
                } else {
                    this.scheduleNextCardBatch(container);
                }
            }

            // Restore Scroll Position
            if (scrollPos > 0) {
                container.scrollTop = scrollPos;
            }

            // 3. Floating Action Button(s): Full-text AI Analysis
            let fabStack = contentEl.querySelector('.hl-fab-stack') as HTMLElement;
            if (!fabStack) {
                fabStack = contentEl.createDiv('hl-fab-stack');
            }
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
                setIcon(headingsBtn, 'heading');

                headingsBtn.onclick = () => {
                    this.handleHeadingsToHighlights(activeFile);
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
        } catch (err: any) {
            console.error('[HiLighter] Headings-to-highlights error', err);
            new Notice(t('notice.headingsError') + err.message);
        } finally {
            btn.disabled = false;
            this.render();
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

    private renderToolbar(parent: HTMLElement): HTMLElement {
        const toolbar = parent.createDiv('hl-highlight-toolbar');

        // 1. Vintage Bookmark Tabs Row
        // All tabs share one uniform style; the active option stays 伸出 (is-active: raised).
        const tabsRow = toolbar.createDiv('hl-sidebar-tabs-row');

        // Toggle pair: Expand / Collapse (card view mode)
        const expandTab = tabsRow.createDiv({
            cls: `hl-sidebar-tab tab-expand ${this.cardViewMode === 'expanded' ? 'is-active' : ''}`,
            text: t('toolbar.expand')
        });
        const collapseTab = tabsRow.createDiv({
            cls: `hl-sidebar-tab tab-collapse ${this.cardViewMode === 'collapsed' ? 'is-active' : ''}`,
            text: t('toolbar.collapse')
        });
        expandTab.onclick = (e) => {
            e.stopPropagation();
            this.cardViewMode = 'expanded';
            expandTab.addClass('is-active');
            collapseTab.removeClass('is-active');
            this.render();
        };
        collapseTab.onclick = (e) => {
            e.stopPropagation();
            this.cardViewMode = 'collapsed';
            collapseTab.addClass('is-active');
            expandTab.removeClass('is-active');
            this.render();
        };

        // Toggle pair: current file vs recently added notes.
        const scopeActive = tabsRow.createDiv({
            cls: `hl-sidebar-tab tab-scope ${this.currentFilter === 'active' ? 'is-active' : ''}`,
            text: t('toolbar.scope.active')
        });
        const scopeAll = tabsRow.createDiv({
            cls: `hl-sidebar-tab tab-scope-all ${this.currentFilter === 'all' ? 'is-active' : ''}`,
            text: t('toolbar.scope.all')
        });
        const setScope = async (scope: 'active' | 'all') => {
            this.plugin.settings.sidebarScope = scope;
            await this.plugin.saveSettings();
            scopeActive.toggleClass('is-active', scope === 'active');
            scopeAll.toggleClass('is-active', scope === 'all');
            this.render();
        };
        scopeActive.onclick = (e) => { e.stopPropagation(); setScope('active'); };
        scopeAll.onclick = (e) => { e.stopPropagation(); setScope('all'); };

        // Tab: Studio (Navigate) — standalone
        const studioTab = tabsRow.createDiv({
            cls: 'hl-sidebar-tab tab-studio',
            text: t('toolbar.cards')
        });
        studioTab.onclick = (e) => {
            e.stopPropagation();
            this.plugin.activateView(
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
            if ((this as any)._searchTimeout) {
                clearTimeout((this as any)._searchTimeout);
            }
            (this as any)._searchTimeout = setTimeout(() => {
                this.render();
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
                this.render();
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

    private renderCard(parent: HTMLElement, note: HighlightNote) {
        const isAnchorNote = note.anchorType === 'note';
        const card = parent.createDiv(
            `hl-highlight-card ${isAnchorNote ? 'hl-anchor-card' : `border-${note.color}`} ${this.cardViewMode === 'collapsed' ? 'is-collapsed' : ''}`
        );

        // --- Full Card Navigation ---
        card.onclick = () => this.jumpToHighlight(note);

        // Text part (Clean style - no quotes, larger); anchor notes carry a
        // message-square glyph instead of the quote text when image-only.
        const textEl = card.createDiv('hl-h-card-text');
        if (isAnchorNote) {
            const anchorBadge = textEl.createDiv('hl-anchor-badge');
            setIcon(anchorBadge.createSpan({ cls: 'hl-anchor-badge-icon' }), 'message-square-plus');
            if (note.text) anchorBadge.createSpan({ cls: 'hl-anchor-badge-word', text: note.text });
        }
        textEl.createSpan({ text: note.text });

        // Note part
        const noteArea = card.createDiv(`hl-h-card-note ${!note.note ? 'is-hidden' : ''}`);

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
                this.render();
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
        const renderedNote = noteArea.createDiv(`hl-h-card-note-rendered ${!isExpanded ? 'is-collapsed-note' : ''}`);
        if (note.note) {
            this.renderMarkdownWhenVisible(card, renderedNote, note.note, note.sourcePath);

            // Add expand/collapse toggle if note exists
            const toggleWrap = noteArea.createDiv('hl-note-toggle-wrap');
            const toggleBtn = toggleWrap.createDiv('hl-note-expand-toggle');
            setIcon(toggleBtn, isExpanded ? 'chevron-up' : 'chevron-down');

            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.expandedNotes.has(note.id)) {
                    this.expandedNotes.delete(note.id);
                } else {
                    this.expandedNotes.add(note.id);
                }
                this.render();
            };

            // Capture toggleWrap for visibility control
            const currentToggleWrap = toggleWrap;

            renderedNote.onclick = (e) => {
                e.stopPropagation();
                if (noteArea.hasClass('is-editing')) return;
                currentToggleWrap.addClass('is-hidden');
                noteArea.addClass('is-editing');
                renderedNote.removeClass('is-collapsed-note');
                textarea.removeClass('is-hidden');
                textarea.focus();
            };

            // Auto-open if flagged
            if (this.autoOpenNoteId === note.id) {
                currentToggleWrap.addClass('is-hidden');
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
                note.note = textarea.value;
            }
            this.render(); // Always re-render to switch back to renderer
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
        const colorMeaning = this.plugin.settings.colorLabels?.[note.color];
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

        // 1. Edit Button (Pencil)
        const editBtn = footerActions.createDiv('hl-footer-icon-btn');
        setIcon(editBtn, 'pencil-line');
        editBtn.setAttribute('aria-label', t('aria.editNote'));
        editBtn.onclick = (e) => {
            e.stopPropagation();
            noteArea.removeClass('is-hidden');
            noteArea.addClass('is-editing');
            renderedNote.removeClass('is-collapsed-note');
            textarea.removeClass('is-hidden');
            // If toggleWrap exists, hide it
            const toggleWrap = noteArea.querySelector('.hl-note-toggle-wrap');
            if (toggleWrap) toggleWrap.addClass('is-hidden');

            // Allow native OS to focus and start keyboard animation first
            textarea.focus();

            // Scroll card into view with a longer timeout to accommodate mobile keyboard animation
            setTimeout(() => {
                const container = card.closest('.hl-highlight-container') as HTMLElement;
                if (container) {
                    const containerRect = container.getBoundingClientRect();
                    const cardRect = card.getBoundingClientRect();

                    let offset;
                    if (Platform.isMobile || Platform.isTablet) {
                        offset = cardRect.top - containerRect.top + container.scrollTop - 20;
                    } else {
                        offset = cardRect.top - containerRect.top + container.scrollTop - (containerRect.height / 2) + (cardRect.height / 2);
                    }
                    container.scrollTo({ top: offset, behavior: 'smooth' });
                }
            }, 400);
        };

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
                this.render();
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
                    this.render();
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
                    this.render();
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
            setTimeout(() => {
                const handler = (ev: PointerEvent) => {
                    if (!popover.contains(ev.target as Node)) {
                        popover.remove();
                        document.removeEventListener('pointerdown', handler, true);
                    }
                };
                document.addEventListener('pointerdown', handler, true);
            }, 0);
        };

        // 3. Research Button (AI - Hidden in More)
        const researchBtn = moreMenu.createDiv('hl-footer-icon-btn');
        setIcon(researchBtn, 'microscope');
        researchBtn.setAttribute('aria-label', t('aria.aiResearch'));
        researchBtn.onclick = async (e) => {
            e.stopPropagation();
            moreMenu.removeClass('is-open');
            const prompts = this.plugin.settings.researchPrompts;
            if (prompts.length === 0) {
                new Notice(t('modal.promptSelect.noPrompts'));
                return;
            }
            new PromptSelectModal(this.app, prompts, async (selected) => {
                researchBtn.addClass('is-loading');
                try {
                    const result = await this.aiService.processAction(note.text, 'research', selected.id);
                    const cleaned = this.cleanAIResult(result);
                    this.aiPreviews.set(note.id, cleaned);
                    this.render();
                    new Notice(t('notice.researchComplete'));
                    if (this.app.workspace.rightSplit) {
                        this.app.workspace.rightSplit.expand();
                    }
                    const modal = new Modal(this.app);
                    modal.titleEl.setText(t('research.modal.title'));
                    modal.contentEl.createEl('p', { text: t('research.modal.body') });
                    const btnWrap = modal.contentEl.createDiv({ style: 'text-align: right; margin-top: 20px;' });
                    const btnOk = btnWrap.createEl('button', { text: t('btn.ok'), cls: 'mod-cta' });
                    btnOk.onclick = () => modal.close();
                    modal.open();
                } catch (err) {
                    new Notice(t('notice.researchError') + err.message);
                } finally {
                    researchBtn.removeClass('is-loading');
                }
            }).open();
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
                        this.render();
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
                        this.render();
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
                        this.render();
                    }
                } else if (ev.key === 'Escape') {
                    manager.remove();
                }
            };

            input.onblur = () => {
                setTimeout(() => {
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
                this.render();
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
                this.render();
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
            const regex = new RegExp(`<mark[^>]*data-id="${note.id}"[^>]*>(.*?)<\/mark>`, 'g');
            const newContent = content.replace(regex, '$1');

            if (content !== newContent) {
                await this.app.vault.modify(file, newContent);
            }
        } catch (err) {
            console.error('[HiLighter] Failed to remove highlight from vault', err);
        }
    }
}
