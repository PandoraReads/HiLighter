// @ts-nocheck
// ============================================================
// English Made Easy - Highlight Notes Sidebar View
// ============================================================

import { ItemView, WorkspaceLeaf, Notice, setIcon, MarkdownView, TFile, MarkdownRenderer, Modal } from 'obsidian';
import { db } from './db';
import type HiLighterPlugin from './main';
import type { HighlightNote } from './models';
import { AIService, AIAction } from './ai-service';
import { HIGHLIGHT_MANAGER_VIEW_TYPE } from './highlight-manager';

export const HIGHLIGHT_VIEW_TYPE = 'eme-highlight-view';

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

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.aiService = new AIService(plugin.settings);
        this.colorFilter = 'all';
    }

    getViewType(): string { return HIGHLIGHT_VIEW_TYPE; }
    getDisplayText(): string { return '高亮笔记'; }
    getIcon(): string { return 'highlighter'; }

    async onOpen() {
        this.render();
        // Register events for dynamic updates
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (this.currentFilter === 'active' && leaf?.view instanceof MarkdownView) {
                // Buffer to avoid race conditions during document switches
                setTimeout(() => this.render(), 100);
            }
        }));
        // 3. Global Pointer Listener for Menu Recycling (Better for Mobile Touch)
        this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
            const menus = this.contentEl.querySelectorAll('.eme-footer-more-menu.is-open');
            menus.forEach(menu => {
                // If the click is NOT inside the menu and NOT on a more-btn trigger
                const isClickInsideMenu = menu.contains(e.target as Node);
                const isClickOnTrigger = (e.target as HTMLElement).closest('.eme-footer-icon-btn');

                if (!isClickInsideMenu && !isClickOnTrigger) {
                    menu.removeClass('is-open');
                }
            });
        });

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            if (this.currentFilter === 'active') {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) this.render();
            }
        }));
    }

    async render() {
        if (this.isRenderingFlag) return;
        this.isRenderingFlag = true;

        try {
            const { contentEl } = this;

            // 1. Preserve Scroll Position
            const containerEl = contentEl.querySelector('.eme-highlight-container');
            const scrollPos = containerEl ? containerEl.scrollTop : 0;

            // 2. Persistent Toolbar & Container
            let toolbar = contentEl.querySelector('.eme-highlight-toolbar') as HTMLElement;
            if (!toolbar) {
                contentEl.addClass('eme-highlight-view');
                toolbar = this.renderToolbar(contentEl);
            }

            let container = contentEl.querySelector('.eme-highlight-container') as HTMLElement;
            if (!container) {
                container = contentEl.createDiv('eme-highlight-container');
            }

            let highlights: HighlightNote[] = [];
            const activeFile = this.app.workspace.getActiveFile();

            if (this.currentFilter === 'active' && activeFile) {
                highlights = await db.getHighlightsByPath(activeFile.path);

                // --- Smart Re-Scan: Ensure lineIndex is accurate for sorting ---
                const content = await this.app.vault.read(activeFile);
                const lines = content.split('\n');
                const idToLine = new Map<string, number>();

                lines.forEach((line, index) => {
                    const matches = line.matchAll(/data-id="([^"]+)"/g);
                    for (const match of matches) {
                        idToLine.set(match[1], index);
                    }
                });

                // Update local copies with current line indices for sorting
                highlights.forEach(h => {
                    if (idToLine.has(h.id)) {
                        h.lineIndex = idToLine.get(h.id);
                    }
                });
            } else {
                highlights = await db.getAllHighlights();
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

            // Sort by File (SourcePath) AND then by lineIndex (Original order in document)
            highlights.sort((a, b) => {
                const pathSort = a.sourcePath.localeCompare(b.sourcePath);
                if (pathSort !== 0) return pathSort;
                return (a.lineIndex ?? 0) - (b.lineIndex ?? 0);
            });

            // Now that we have the data, safely clear the container
            container.empty();

            if (highlights.length === 0) {
                this.renderEmpty(container);
            } else {
                highlights.forEach(h => {
                    if (!this.pendingDeleteIds.has(h.id)) {
                        this.renderCard(container, h);
                    }
                });
            }

            // Restore Scroll Position
            if (scrollPos > 0) {
                container.scrollTop = scrollPos;
            }
        } catch (err) {
            console.error('[EME] Sidebar render error', err);
            const container = this.contentEl.querySelector('.eme-highlight-container');
            if (container) {
                container.createEl('p', { text: '加载笔记出错: ' + err.message, cls: 'eme-error-msg' });
            }
        } finally {
            this.isRenderingFlag = false;
        }
    }

    private renderToolbar(parent: HTMLElement): HTMLElement {
        const toolbar = parent.createDiv('eme-highlight-toolbar');

        // 1. Vintage Bookmark Tabs Row
        const tabsRow = toolbar.createDiv('eme-sidebar-tabs-row');

        // Tab: Expand (展開)
        const expandTab = tabsRow.createDiv({
            cls: 'eme-sidebar-tab tab-expand',
            text: '展开'
        });
        expandTab.onclick = (e) => {
            e.stopPropagation();
            this.cardViewMode = 'expanded';
            this.render();
        };

        // Tab: Collapse (折疊)
        const collapseTab = tabsRow.createDiv({
            cls: 'eme-sidebar-tab tab-collapse',
            text: '折叠'
        });
        collapseTab.onclick = (e) => {
            e.stopPropagation();
            this.cardViewMode = 'collapsed';
            this.render();
        };

        // Tab: Studio (Navigate)
        const studioTab = tabsRow.createDiv({
            cls: 'eme-sidebar-tab tab-studio',
            text: '卡片集'
        });
        studioTab.onclick = (e) => {
            e.stopPropagation();
            this.plugin.activateView(HIGHLIGHT_MANAGER_VIEW_TYPE, 'main');
        };

        // 2. Vintage Archive Unit (Index Card Style)
        const mainUnit = toolbar.createDiv('eme-search-main-row');

        // Search Section - "检索"
        const searchSection = mainUnit.createDiv('eme-search-section');
        searchSection.createDiv({ cls: 'eme-unit-label', text: '检索' });
        const searchInput = searchSection.createEl('input', {
            cls: 'eme-search-input',
            attr: { type: 'text', placeholder: '搜索笔记存档...', value: this.searchQuery }
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

        // Filter Section - "筛选" + Color Pills
        const filterSection = mainUnit.createDiv('eme-filter-section');
        filterSection.createDiv({ cls: 'eme-unit-label', text: '筛选' });

        const pillsWrap = filterSection.createDiv('eme-color-pills-wrap');
        const colorPills = [
            { id: 'all', cls: 'pill-all', label: '全部' },
            { id: 'yellow', cls: 'pill-yellow', label: '黄色' },
            { id: 'pink', cls: 'pill-pink', label: '粉色' },
            { id: 'blue', cls: 'pill-blue', label: '蓝色' },
            { id: 'green', cls: 'pill-green', label: '绿色' }
        ];

        colorPills.forEach(pill => {
            const pillEl = pillsWrap.createDiv({
                cls: `eme-color-pill ${pill.cls} ${this.colorFilter === pill.id ? 'is-active' : ''}`,
                attr: { 'aria-label': pill.label }
            });
            pillEl.onclick = () => {
                this.colorFilter = pill.id;
                this.render();
            };
        });

        return toolbar;
    }

    private renderEmpty(parent: HTMLElement) {
        const empty = parent.createDiv('eme-empty-state');
        setIcon(empty.createDiv('eme-empty-icon'), 'highlighter');
        empty.createEl('p', { text: this.currentFilter === 'active' ? '当前文档暂无高亮' : '暂无高亮笔记' });
    }

    private cleanAIResult(text: string): string {
        // Remove prefixes like --- [AI 翻译] --- or AI 注释:
        return text.replace(/^(--- \[.*\] ---\n?|AI\s*(翻译|注释|研究|结果)\s*[:：]\s*\n?)/g, '').trim();
    }

    private renderCard(parent: HTMLElement, note: HighlightNote) {
        const card = parent.createDiv(`eme-highlight-card border-${note.color} ${this.cardViewMode === 'collapsed' ? 'is-collapsed' : ''}`);

        // --- Full Card Navigation ---
        card.onclick = () => this.jumpToHighlight(note);

        // Text part (Clean style - no quotes, larger)
        const textEl = card.createDiv('eme-h-card-text');
        textEl.textContent = note.text;

        // Note part
        const noteArea = card.createDiv(`eme-h-card-note ${!note.note ? 'is-hidden' : ''}`);

        // AI Preview Area (Conditional)
        const preview = this.aiPreviews.get(note.id);
        if (preview) {
            const previewEl = card.createDiv('eme-ai-preview');
            previewEl.createDiv({ text: 'AI 生成预览:', cls: 'eme-preview-header' });
            const contentEl = previewEl.createDiv({ cls: 'eme-preview-content' });
            MarkdownRenderer.renderMarkdown(preview, contentEl, note.sourcePath, this);

            const pActions = previewEl.createDiv('eme-preview-actions');
            const keepBtn = pActions.createEl('button', { cls: 'eme-mini-btn btn-success', text: '加入笔记' });
            setIcon(keepBtn, 'check');
            keepBtn.onclick = async () => {
                const newNote = note.note ? `${note.note}\n\n${preview}` : preview;
                await db.updateHighlightNote(note.id, { note: newNote });
                this.aiPreviews.delete(note.id);
                // Flag to auto-open the note edit area on next render
                this.autoOpenNoteId = note.id;
                await this.render();
            };

            const discardBtn = pActions.createEl('button', { cls: 'eme-mini-btn btn-danger', text: '舍弃' });
            setIcon(discardBtn, 'x');
            discardBtn.onclick = () => {
                this.aiPreviews.delete(note.id);
                this.render();
            };
        }

        const textarea = noteArea.createEl('textarea', {
            cls: 'eme-h-textarea is-hidden',
            attr: { placeholder: '输入个人笔记...' },
            text: note.note
        });

        // Prevent Obsidian's view-click handlers from stealing focus
        textarea.onclick = (e) => e.stopPropagation();
        textarea.onmousedown = (e) => e.stopPropagation();

        // Auto-resize the textarea based on content
        const autoResize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.max(textarea.scrollHeight, 60) + 'px';
        };
        textarea.oninput = autoResize;
        textarea.addEventListener('focus', autoResize, { once: true });

        const isExpanded = this.expandedNotes.has(note.id);
        const renderedNote = noteArea.createDiv(`eme-h-card-note-rendered ${!isExpanded ? 'is-collapsed-note' : ''}`);
        if (note.note) {
            MarkdownRenderer.renderMarkdown(note.note, renderedNote, note.sourcePath, this);

            // Add expand/collapse toggle if note exists
            const toggleWrap = noteArea.createDiv('eme-note-toggle-wrap');
            const toggleBtn = toggleWrap.createDiv('eme-note-expand-toggle');
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
                renderedNote.addClass('is-hidden');
                currentToggleWrap.addClass('is-hidden');
                textarea.removeClass('is-hidden');
                textarea.focus();
            };

            // Auto-open if flagged
            if (this.autoOpenNoteId === note.id) {
                renderedNote.addClass('is-hidden');
                currentToggleWrap.addClass('is-hidden');
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
        const footer = card.createDiv('eme-h-card-footer');

        // Row 1: Left (Tags) + Right (Actions)
        const footerRow1 = footer.createDiv('eme-footer-row-main');

        // --- Left Side: Tags (Replaces Source Link) ---
        const footerLeft = footerRow1.createDiv('eme-footer-left-tags');
        if (note.tags && note.tags.length > 0) {
            note.tags.forEach(tag => {
                const tagEl = footerLeft.createSpan({ cls: 'eme-tag-mini' });
                setIcon(tagEl, 'tag');
                tagEl.createSpan({ text: tag });
            });
        }

        const footerActions = footerRow1.createDiv('eme-footer-actions');

        // --- Priority Actions (Always Visible) ---

        // 1. Edit Button (Pencil)
        const editBtn = footerActions.createDiv('eme-footer-icon-btn');
        setIcon(editBtn, 'pencil-line');
        editBtn.setAttribute('aria-label', '编辑笔记');
        editBtn.onclick = (e) => {
            e.stopPropagation();
            noteArea.removeClass('is-hidden');
            renderedNote.addClass('is-hidden');
            textarea.removeClass('is-hidden');
            // If toggleWrap exists, hide it
            const toggleWrap = noteArea.querySelector('.eme-note-toggle-wrap');
            if (toggleWrap) toggleWrap.addClass('is-hidden');

            // Allow native OS to focus and start keyboard animation first
            textarea.focus();

            // Scroll card into view with a longer timeout to accommodate mobile keyboard animation
            setTimeout(() => {
                const container = card.closest('.eme-highlight-container') as HTMLElement;
                if (container) {
                    const containerRect = container.getBoundingClientRect();
                    const cardRect = card.getBoundingClientRect();

                    // Calculate offset: ensure the card is not obscured by the keyboard
                    // On mobile/tablet, we scroll the card to the top with a small margin instead of centering
                    // as centering might still leave the bottom part under the keyboard.
                    let offset;
                    if (Platform.isMobile || Platform.isTablet) {
                        // Align to top with 20px padding
                        offset = cardRect.top - containerRect.top + container.scrollTop - 20;
                    } else {
                        // Original centering logic for desktop
                        offset = cardRect.top - containerRect.top + container.scrollTop - (containerRect.height / 2) + (cardRect.height / 2);
                    }
                    container.scrollTo({ top: offset, behavior: 'smooth' });
                }
            }, 400); // Slightly longer timeout for keyboard stabilization
        };

        // 2. Translate Button (AI)
        const translateBtn = footerActions.createDiv('eme-footer-icon-btn');
        setIcon(translateBtn, 'languages');
        translateBtn.setAttribute('aria-label', 'AI 翻译');
        translateBtn.onclick = async (e) => {
            e.stopPropagation();
            translateBtn.addClass('is-loading');
            try {
                const result = await this.aiService.processAction(note.text, 'translate');
                const cleaned = this.cleanAIResult(result);
                this.aiPreviews.set(note.id, cleaned);
                this.render();
                new Notice('AI 翻译生成完毕');
                // Ensure sidebar stays open on mobile/tablet after render
                if (this.app.workspace.rightSplit) {
                    this.app.workspace.rightSplit.expand();
                }
            } catch (err) {
                new Notice(`AI 翻译出错: ${err.message}`);
            } finally {
                translateBtn.removeClass('is-loading');
            }
        };

        // --- Folded Actions (The "More" Menu) ---
        const moreBtn = footerActions.createDiv('eme-footer-icon-btn');
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', '更多操作');

        const moreMenu = footerActions.createDiv('eme-footer-more-menu');

        // 3. Research Button (AI - Hidden in More)
        const researchBtn = moreMenu.createDiv('eme-footer-icon-btn');
        setIcon(researchBtn, 'microscope');
        researchBtn.setAttribute('aria-label', 'AI 研究');
        researchBtn.onclick = async (e) => {
            e.stopPropagation();
            researchBtn.addClass('is-loading');
            try {
                const result = await this.aiService.processAction(note.text, 'research');
                const cleaned = this.cleanAIResult(result);
                this.aiPreviews.set(note.id, cleaned);
                this.render();
                new Notice('AI 研究生成完毕');
                // Ensure sidebar stays open on mobile/tablet after render
                if (this.app.workspace.rightSplit) {
                    this.app.workspace.rightSplit.expand();
                }
                const modal = new Modal(this.app);
                modal.titleEl.setText('✨ AI 研究已完成');
                modal.contentEl.createEl('p', { text: '研究内容已生成，请在卡片下方预览区查看并决定是否加入笔记。' });
                const btnWrap = modal.contentEl.createDiv({ style: 'text-align: right; margin-top: 20px;' });
                const btnOk = btnWrap.createEl('button', { text: '我知道了', cls: 'mod-cta' });
                btnOk.onclick = () => modal.close();
                modal.open();
            } catch (err) {
                new Notice(`AI 研究出错: ${err.message}`);
            } finally {
                researchBtn.removeClass('is-loading');
            }
        };

        // 4. Tag Button (Hidden in More)
        const tagBtn = moreMenu.createDiv('eme-footer-icon-btn');
        setIcon(tagBtn, 'tags');
        tagBtn.setAttribute('aria-label', '管理标签');
        tagBtn.onclick = async (e) => {
            e.stopPropagation();
            moreMenu.removeClass('is-open');
            const existingManager = card.querySelector('.eme-tag-manager');
            if (existingManager) {
                existingManager.remove();
                return;
            }

            const manager = card.createDiv({ cls: 'eme-tag-manager', insertBefore: footer });
            manager.onclick = (e) => e.stopPropagation();

            // List existing tags with delete buttons
            const list = manager.createDiv('eme-tag-manager-list');
            if (note.tags && note.tags.length > 0) {
                note.tags.forEach(tag => {
                    const item = list.createDiv('eme-tag-manager-item');
                    const iconSpan = item.createSpan('eme-tag-icon-small');
                    setIcon(iconSpan, 'tag');
                    item.createSpan({ text: tag });
                    const del = item.createDiv('eme-tag-del-btn');
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

            // Additive Input
            const inputWrap = manager.createDiv('eme-tag-input-wrap');
            const input = inputWrap.createEl('input', {
                cls: 'eme-tag-input',
                attr: { type: 'text', placeholder: '输入新标签 (回车保存)...' }
            });
            input.focus();

            // Quick Suggestions
            const allHighlights = await db.getAllHighlights();
            const allTags = new Set<string>(['重点', '归档']);
            allHighlights.forEach(h => {
                if (h.tags) h.tags.forEach(t => allTags.add(t));
            });

            // Filter out tags already on this note
            const suggestions = Array.from(allTags).filter(t => (note.tags || []).indexOf(t) === -1).sort();

            if (suggestions.length > 0) {
                const suggestContainer = manager.createDiv('eme-tag-suggestions');
                suggestContainer.createSpan({ text: '推荐：', cls: 'eme-tag-suggest-label' });
                const chipGrid = suggestContainer.createDiv('eme-tag-suggest-grid');

                suggestions.forEach(tag => {
                    const chip = chipGrid.createDiv({
                        cls: 'eme-tag-suggestion-chip',
                        text: tag
                    });
                    chip.onclick = async (e) => {
                        e.stopPropagation();
                        const newTags = [...(note.tags || []), tag];
                        await db.updateHighlightNote(note.id, { tags: newTags });
                        note.tags = newTags;
                        this.render();
                    };
                });
            }

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
                }, 300);
            };
        };

        // 5. Delete Button (Hidden in More)
        const deleteBtn = moreMenu.createDiv('eme-footer-icon-btn is-danger');
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.setAttribute('aria-label', '删除卡片');
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
                console.error('[EME] Deletion failed', err);
                new Notice('删除失败，请重试');
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
            const allMenus = this.contentEl.querySelectorAll('.eme-footer-more-menu.is-open');
            allMenus.forEach(m => {
                if (m !== moreMenu) m.removeClass('is-open');
            });

            const isOpen = moreMenu.hasClass('is-open');
            moreMenu.toggleClass('is-open', !isOpen);
        };
    }

    private renderAIButton(parent: HTMLElement, action: AIAction, icon: string, label: string, note: HighlightNote) {
        const btn = parent.createEl('button', { cls: 'eme-ai-btn', attr: { 'aria-label': label } });
        setIcon(btn, icon);
        btn.createSpan({ text: label });

        btn.onclick = async () => {
            btn.addClass('is-loading');
            try {
                const result = await this.aiService.processAction(note.text, action);
                const cleaned = this.cleanAIResult(result);
                this.aiPreviews.set(note.id, cleaned);
                this.render(); // Refresh to show preview
                new Notice(`AI ${label}生成完毕`);
                // Ensure sidebar stays open on mobile/tablet after render
                if (this.app.workspace.rightSplit) {
                    this.app.workspace.rightSplit.expand();
                }
            } catch (e) {
                new Notice(`AI服务出错: ${e.message}`);
            } finally {
                btn.removeClass('is-loading');
            }
        };
    }

    private async jumpToHighlight(note: HighlightNote) {
        // 1. Open File
        await this.app.workspace.openLinkText(note.sourcePath, '', false);

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            const editor = view.editor;
            const lineCount = editor.lineCount();
            let targetLine = -1;

            // 2. Scan Editor for the specific ID (Robust navigation)
            for (let i = 0; i < lineCount; i++) {
                if (editor.getLine(i).includes(`data-id="${note.id}"`)) {
                    targetLine = i;
                    break;
                }
            }

            // Fallback to lineIndex if not found (unexpected, but safe)
            if (targetLine === -1) targetLine = note.lineIndex ?? 0;

            // 3. Navigate
            editor.setCursor(targetLine, 0);
            editor.scrollIntoView({ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } }, true);
        }
    }
    private async removeHighlightFromVault(note: HighlightNote) {
        try {
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
            console.error('[EME] Failed to remove highlight from vault', err);
        }
    }
}
