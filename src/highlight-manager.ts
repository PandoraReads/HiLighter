// @ts-nocheck
import { ItemView, WorkspaceLeaf, setIcon, MarkdownRenderer, TFile, Notice, Modal, App, TextComponent, MarkdownView, Platform } from "obsidian";
import { db } from './db';
import { HighlightNote } from './models';

export const HIGHLIGHT_MANAGER_VIEW_TYPE = 'hl-highlight-manager';

export class HighlightManagerView extends ItemView {
    private highlights: HighlightNote[] = [];
    private searchQuery: string = '';
    private activeTab: 'all' | 'notes' | 'tags' = 'all';
    private selectedFilePath: string | null = null;
    private selectedTags: Set<string> = new Set();
    private sortBy: 'az' | 'za' | 'time' = 'time';
    private viewMode: 'gallery' | 'review' = 'gallery';
    private expandedNotes: Set<string> = new Set();
    private reviewIndex: number = 0;
    private batchMode: boolean = false;
    private selectedNotes: Set<string> = new Set();
    private isSidebarPinned: boolean = false;
    private reviewOrder: HighlightNote[] = [];
    private draggedNoteId: string | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return HIGHLIGHT_MANAGER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '管理卡片集';
    }

    getIcon(): string {
        return 'layout-grid';
    }

    async onOpen() {
        await this.loadHighlights();
        this.render();
    }

    async loadHighlights() {
        this.highlights = await db.getAllHighlights();
    }

    render() {
        const container = this.contentEl;
        const scrollPos = container.scrollTop;
        container.empty();
        container.addClass('hl-studio');

        // Aurora Background
        const aurora = container.createDiv('hl-studio-aurora');
        aurora.createDiv('hl-aurora-blob hl-aurora-blob-1');
        aurora.createDiv('hl-aurora-blob hl-aurora-blob-2');
        aurora.createDiv('hl-aurora-blob hl-aurora-blob-3');

        // Main Layout: 3 (Sidebar) : 7 (Content)
        const mainLayout = container.createDiv('hl-studio-layout');

        const sidebar = mainLayout.createDiv('hl-studio-sidebar');
        if (Platform.isMobile && this.isSidebarPinned) sidebar.addClass('is-pinned');
        const content = mainLayout.createDiv('hl-studio-content');

        // Clear pinned state when clicking content area on mobile
        content.onclick = () => {
            if (this.isSidebarPinned) {
                this.isSidebarPinned = false;
                sidebar.removeClass('is-pinned');
            }
        };

        this.renderSidebar(sidebar);
        if (this.viewMode === 'review') {
            this.renderReviewMode(content);
        } else {
            this.renderMainContent(content);
        }

        // Restore Scroll Position
        if (scrollPos > 0) {
            container.scrollTop = scrollPos;
        }
    }

    private renderSidebar(parent: HTMLElement) {
        parent.empty();

        // Header / Name
        parent.createEl('h2', { text: '管理卡片集', cls: 'hl-studio-name' });

        // Compact Controls Row (Tabs + Sort)
        const controlsHeader = parent.createDiv('hl-studio-controls-header');

        // Navigation Tabs (Compact)
        const navTabs = controlsHeader.createDiv('hl-studio-nav-tabs-compact');
        this.createNavTab(navTabs, 'all', '', 'layout-list', '全部');
        this.createNavTab(navTabs, 'notes', '', 'file-text', '笔记');
        this.createNavTab(navTabs, 'tags', '', 'tag', '标签');

        // Right side: Sort Switch - 三态循环: 时间 → A-Z → Z-A
        const sortBtn = controlsHeader.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': '切换排序' } });
        const sortConfig: Record<string, { icon: string; title: string }> = {
            'time': { icon: 'clock', title: '当前：按时间排序 → 切换为 A-Z' },
            'az': { icon: 'sort-asc', title: '当前：A-Z 排序 → 切换为 Z-A' },
            'za': { icon: 'sort-desc', title: '当前：Z-A 排序 → 切换为按时间' },
        };
        const cfg = sortConfig[this.sortBy];
        setIcon(sortBtn, cfg.icon);
        sortBtn.title = cfg.title;
        sortBtn.onclick = () => {
            if (Platform.isMobile) this.isSidebarPinned = true;
            this.sortBy = this.sortBy === 'time' ? 'az' : this.sortBy === 'az' ? 'za' : 'time';
            this.render();
        };

        // Search Block (Now below tabs)
        const searchWrap = parent.createDiv('hl-studio-search-block');
        const searchInput = searchWrap.createEl('input', {
            cls: 'hl-studio-search-input-full',
            attr: { type: 'text', placeholder: '搜索所有笔记...', value: this.searchQuery }
        });
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderMainContent();
        };

        // Scrollable List Area
        const listArea = parent.createDiv('hl-studio-sidebar-list');
        // ...

        if (this.activeTab === 'notes') {
            this.renderNotesSidebar(listArea);
        } else if (this.activeTab === 'tags') {
            this.renderTagsSidebar(listArea);
        } else {
            listArea.createDiv({ text: '管理所有灵感卡片', cls: 'hl-studio-hint' });
        }

        // Footnote
        const footnote = parent.createDiv('hl-studio-footnote');
        footnote.createEl('span', { text: 'powered by' });
        footnote.createEl('span', { text: "Language Made Easy" });
    }

    private createNavTab(parent: HTMLElement, id: any, label: string, icon: string, tooltip: string) {
        const tab = parent.createDiv(`hl-studio-nav-item-compact ${this.activeTab === id ? 'is-active' : ''}`);
        tab.setAttribute('aria-label', tooltip);
        setIcon(tab, icon);
        if (label) tab.createSpan({ text: label });
        tab.onclick = () => {
            if (Platform.isMobile) this.isSidebarPinned = true;
            this.activeTab = id;
            this.render();
        };
    }

    private renderNotesSidebar(parent: HTMLElement) {
        // Get unique files
        const filesMap = new Map<string, number>();
        this.highlights.forEach(h => {
            filesMap.set(h.sourcePath, (filesMap.get(h.sourcePath) || 0) + 1);
        });

        const sortedFiles = Array.from(filesMap.keys()).sort((a, b) => {
            const nameA = a.split('/').pop()!.toLowerCase();
            const nameB = b.split('/').pop()!.toLowerCase();

            // 笔记列表排序逻辑
            if (this.sortBy === 'az') {
                return nameA.localeCompare(nameB); // 字母升序
            } else if (this.sortBy === 'za') {
                return nameB.localeCompare(nameA); // 字母降序
            } else {
                // 时间排序 - 这里我们取该文件下第一条高亮笔记的创建时间
                const notesFromA = this.highlights.filter(h => h.sourcePath === a);
                const notesFromB = this.highlights.filter(h => h.sourcePath === b);
                const timeA = notesFromA.length > 0 ? Math.max(...notesFromA.map(n => n.createdAt)) : 0;
                const timeB = notesFromB.length > 0 ? Math.max(...notesFromB.map(n => n.createdAt)) : 0;
                return timeB - timeA; // 时间倒序（最新的在前）
            }
        });

        if (sortedFiles.length === 0) {
            parent.createDiv({ text: '无文档记录', cls: 'hl-studio-empty' });
            return;
        }

        sortedFiles.forEach(path => {
            const fileName = path.split('/').pop()!;
            const count = filesMap.get(path);
            const item = parent.createDiv(`hl-studio-list-item ${this.selectedFilePath === path ? 'is-selected' : ''}`);
            item.createDiv({ text: fileName, cls: 'title' });
            item.onclick = () => {
                if (Platform.isMobile) this.isSidebarPinned = true;
                this.selectedFilePath = this.selectedFilePath === path ? null : path;
                this.render();
            };
        });
    }

    private renderTagsSidebar(parent: HTMLElement) {
        const tagsMap = new Map<string, number>();
        tagsMap.set('重点', 0);
        tagsMap.set('归档', 0);

        this.highlights.forEach(h => {
            (h.tags || []).forEach(t => {
                tagsMap.set(t, (tagsMap.get(t) || 0) + 1);
            });
        });

        for (const [tag, count] of tagsMap) {
            if (count === 0 && (tag === '重点' || tag === '归档')) {
                tagsMap.delete(tag);
            }
        }

        const sortedTags = Array.from(tagsMap.keys()).sort((a, b) => {
            if (this.sortBy === 'az') {
                return a.toLowerCase().localeCompare(b.toLowerCase());
            } else if (this.sortBy === 'za') {
                return b.toLowerCase().localeCompare(a.toLowerCase());
            } else {
                return (tagsMap.get(b) || 0) - (tagsMap.get(a) || 0);
            }
        });

        if (sortedTags.length === 0) {
            parent.createDiv({ text: '无标签记录', cls: 'hl-studio-empty' });
            return;
        }

        sortedTags.forEach(tag => {
            const isSelected = this.selectedTags.has(tag);
            const count = tagsMap.get(tag) || 0;
            const item = parent.createDiv(`hl-tag-sidebar-item ${isSelected ? 'is-selected' : ''}`);

            const tagLeft = item.createDiv('hl-tag-sidebar-left');
            const tagIcon = tagLeft.createDiv('hl-tag-sidebar-icon');
            setIcon(tagIcon, 'tag');
            const tagLabel = tagLeft.createDiv({ text: tag, cls: 'hl-tag-sidebar-name' });
            const tagBadge = tagLeft.createDiv({ text: `${count}`, cls: 'hl-tag-sidebar-count' });

            tagLeft.onclick = (e) => {
                e.stopPropagation();
                if (isSelected) this.selectedTags.delete(tag);
                else this.selectedTags.add(tag);
                this.render();
            };

            // Inline rename helper
            const startRename = () => {
                tagLabel.hide();
                editBtn.hide();
                const editInput = tagLeft.createEl('input', {
                    cls: 'hl-tag-inline-edit',
                    attr: { type: 'text', value: tag }
                });
                editInput.focus();
                editInput.select();

                const finish = async () => {
                    const newTag = editInput.value.trim();
                    editInput.remove();
                    tagLabel.show();
                    editBtn.show();
                    if (newTag && newTag !== tag) {
                        await this.updateTag(tag, newTag);
                    }
                };

                editInput.onkeydown = (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
                    if (ev.key === 'Escape') { editInput.remove(); tagLabel.show(); editBtn.show(); }
                };
                editInput.onblur = () => finish();
            };

            // Edit button
            const editBtn = item.createDiv('hl-tag-sidebar-edit');
            setIcon(editBtn, 'pencil');
            editBtn.setAttribute('aria-label', '重命名标签');
            editBtn.onclick = (e) => {
                e.stopPropagation();
                startRename();
            };

            // Delete button
            const delBtn = item.createDiv('hl-tag-sidebar-del');
            setIcon(delBtn, 'x');
            delBtn.setAttribute('aria-label', '删除标签');
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`删除标签 "${tag}"？\n将从 ${count} 张卡片上移除，卡片本身不会删除。`)) {
                    this.deleteTag(tag);
                }
            };
        });
    }

    private showTagContextMenu(event: MouseEvent, tag: string) {
        const menu = document.body.createDiv('hl-tag-context-menu');
        let { clientX, clientY } = event;

        // For mobile, center the menu
        if (Platform.isMobile) {
            clientX = window.innerWidth / 2;
            clientY = window.innerHeight / 2;
        }

        menu.style.position = 'fixed';
        menu.style.left = `${clientX}px`;
        menu.style.top = `${clientY}px`;
        menu.style.zIndex = '10000';
        menu.style.background = 'var(--background-primary)';
        menu.style.border = '1px solid var(--background-modifier-border)';
        menu.style.borderRadius = '6px';
        menu.style.padding = '4px 0';
        menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        menu.style.minWidth = '140px';

        const editItem = menu.createEl('button', { text: '编辑标签' });
        this.styleMenuItem(editItem);
        editItem.onclick = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
            new TagEditModal(this.app, tag, async (newTag) => {
                await this.updateTag(tag, newTag);
            }).open();
        };

        const deleteItem = menu.createEl('button', { text: '删除标签' });
        this.styleMenuItem(deleteItem);
        deleteItem.style.color = 'var(--text-error)';
        deleteItem.onclick = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
            if (confirm(`确定要删除标签 "${tag}" 吗？\n此操作会从所有卡片上移除该标签，但不会删除卡片本身。`)) {
                this.deleteTag(tag);
            }
        };

        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    private styleMenuItem(el: HTMLButtonElement) {
        Object.assign(el.style, {
            width: '100%', textAlign: 'left', padding: '8px 16px',
            border: 'none', background: 'none', color: 'var(--text-normal)',
            cursor: 'pointer', fontSize: '14px', display: 'block'
        });
        el.onmouseenter = () => el.style.background = 'var(--background-modifier-hover)';
        el.onmouseleave = () => el.style.background = 'none';
    }

    private async updateTag(oldTag: string, newTag: string) {
        if (!newTag.trim() || oldTag === newTag.trim()) return;

        const affectedNotes = this.highlights.filter(note => note.tags?.includes(oldTag));
        for (const note of affectedNotes) {
            const updatedTags = note.tags?.map(t => t === oldTag ? newTag.trim() : t);
            await db.updateHighlightNote(note.id, { tags: updatedTags });
        }

        // Update selected tags set
        if (this.selectedTags.has(oldTag)) {
            this.selectedTags.delete(oldTag);
            this.selectedTags.add(newTag.trim());
        }

        new Notice(`标签 "${oldTag}" 已更新为 "${newTag}"`);
        await this.loadHighlights();
        this.render();
    }

    private async deleteTag(tag: string) {
        const affectedNotes = this.highlights.filter(note => note.tags?.includes(tag));
        for (const note of affectedNotes) {
            const updatedTags = note.tags?.filter(t => t !== tag);
            await db.updateHighlightNote(note.id, { tags: updatedTags });
        }

        this.selectedTags.delete(tag);

        new Notice(`标签 "${tag}" 已从 ${affectedNotes.length} 张卡片中移除`);
        await this.loadHighlights();
        this.render();
    }

    private renderMainContent(parentProp?: HTMLElement) {
        const parent = parentProp || this.contentEl.querySelector('.hl-studio-content') as HTMLElement;
        if (!parent) return;
        parent.empty();

        // Mode Switcher (Gallery vs MindMap)
        const header = parent.createDiv('hl-studio-content-header');

        // Editorial Magazine Header
        const editorialHeader = header.createDiv('hl-studio-editorial-header');
        const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
        editorialHeader.createDiv({ text: `ISSUED ${date} • COLLECTION`, cls: 'hl-studio-vol-issue' });

        const modeSwitcher = header.createDiv('hl-studio-mode-switcher');
        const tabsRow = modeSwitcher.createDiv('hl-studio-tabs-row');

        const galleryBtn = tabsRow.createEl('button', {
            cls: `hl-mode-btn tab-default ${this.viewMode === 'gallery' ? 'is-active' : ''}`,
            text: '默认'
        });
        galleryBtn.onclick = () => { this.viewMode = 'gallery'; this.render(); };

        const reviewBtn = tabsRow.createEl('button', {
            cls: `hl-mode-btn tab-review ${this.viewMode === 'review' ? 'is-active' : ''}`,
            text: '复习'
        });
        reviewBtn.onclick = () => {
            this.viewMode = 'review';
            this.shuffleReviewOrder();
            this.reviewIndex = 0;
            this.render();
        };

        const batchBtn = tabsRow.createEl('button', {
            cls: `hl-mode-btn tab-batch ${this.batchMode ? 'is-active' : ''}`,
            text: this.batchMode ? `退出批量 (${this.selectedNotes.size})` : '批量'
        });
        batchBtn.onclick = () => this.toggleBatchMode();

        const filtered = this.getFilteredHighlights();

        if (this.batchMode && this.selectedNotes.size > 0) {
            const batchActions = header.createDiv('hl-studio-batch-actions-float');

            const batchDel = batchActions.createEl('button', { cls: 'hl-studio-mini-btn is-danger', text: '删除所选' });
            setIcon(batchDel, 'trash-2');
            batchDel.onclick = () => this.handleBatchDelete();

            const batchTag = batchActions.createEl('button', { cls: 'hl-studio-mini-btn', text: '添加标签' });
            setIcon(batchTag, 'tag');
            batchTag.onclick = () => this.handleBatchTag();
        }
        if (filtered.length === 0) {
            parent.createEl('div', { text: '空空如也，去划线记录灵感吧', cls: 'hl-studio-empty-content' });
            return;
        }

        const grid = parent.createDiv('hl-studio-grid');
        filtered.forEach(h => this.renderStudioCard(grid, h));
    }

    private getFilteredHighlights(): HighlightNote[] {
        let filtered = this.highlights.filter(h => {
            const matchesSearch = (h.text + (h.note || '') + (h.tags || []).join(' ')).toLowerCase()
                .indexOf(this.searchQuery.toLowerCase()) !== -1;

            let matchesNav = true;
            if (this.activeTab === 'notes' && this.selectedFilePath) {
                matchesNav = h.sourcePath === this.selectedFilePath;
            } else if (this.activeTab === 'tags' && this.selectedTags.size > 0) {
                matchesNav = (h.tags || []).some(t => this.selectedTags.has(t));
            }

            return matchesSearch && matchesNav;
        });

        // Phase 43: Exclude Archived cards from Review Mode
        if (this.viewMode === 'review') {
            filtered = filtered.filter(h => (h.tags || []).indexOf('归档') === -1);
        }

        filtered.sort((a, b) => {
            if (this.sortBy === 'az') return a.text.localeCompare(b.text);
            if (this.sortBy === 'za') return b.text.localeCompare(a.text);
            return b.createdAt - a.createdAt;
        });

        return filtered;
    }

    private renderStudioCard(parent: HTMLElement, note: HighlightNote) {
        const card = parent.createDiv(`hl-studio-card border-${note.color}`);

        // Click Handler (Phase 34: Click to Detail Modal)
        card.onclick = (e) => {
            e.stopPropagation();
            if (this.batchMode) {
                if (this.selectedNotes.has(note.id)) this.selectedNotes.delete(note.id);
                else this.selectedNotes.add(note.id);
                this.render();
                return;
            }
            new HighlightDetailModal(this.app, note, async () => {
                await this.loadHighlights();
                this.render();
                // Also refresh the sidebar HighlightView
                this.app.workspace.iterateAllLeaves((leaf) => {
                    if (leaf.view.getViewType() === 'hl-highlight-view') {
                        (leaf.view as any).render();
                    }
                });
            }).open();
        };

        if (this.selectedNotes.has(note.id)) card.addClass('is-selected');

        // Header (Highlight Text) - Strictly text-only per Phase 33/34
        const header = card.createDiv('card-header');
        const highlightText = header.createDiv('highlight-text');
        highlightText.textContent = note.text;

        // Note: Individual Edit/Delete buttons and Mind Map logic removed.
    }

    private renderReviewMode(parent: HTMLElement) {
        parent.empty();
        if (this.reviewOrder.length === 0) {
            this.reviewOrder = this.getFilteredHighlights();
        }
        const filtered = this.reviewOrder;

        if (filtered.length === 0) {
            parent.createEl('p', { text: '暂无卡片进行复习', cls: 'hl-empty-msg' });
            return;
        }

        if (this.reviewIndex >= filtered.length) this.reviewIndex = 0;
        const note = filtered[this.reviewIndex];

        // Exit/Close Button (Editorial Style)
        const exitBtn = parent.createDiv('hl-review-exit-btn');
        setIcon(exitBtn, 'x');
        exitBtn.setAttribute('aria-label', '退出复习模式');
        exitBtn.onclick = () => {
            this.viewMode = 'gallery';
            this.render();
        };

        // Relative wrapper to contain spread and overlapping bookmarks
        const reviewWrapper = parent.createDiv('hl-review-spread-wrapper');

        // Dual Page Magazine Spread
        const spread = reviewWrapper.createDiv('hl-review-spread');

        // Left Page: Highlight Text (Editorial Style)
        const leftPage = spread.createDiv('hl-review-page page-left');
        const quoteBox = leftPage.createDiv('hl-review-quote');
        quoteBox.createSpan({ text: '“', cls: 'quote-mark open' });
        quoteBox.createDiv({ text: note.text, cls: 'quote-text' });

        const meta = leftPage.createDiv('hl-review-meta');
        const filename = note.sourcePath.split('/').pop()?.replace('.md', '') || 'Notes';
        meta.createDiv({ text: filename, cls: 'meta-source' });
        meta.createDiv({ text: new Date(note.createdAt).toLocaleDateString(), cls: 'meta-date' });

        // Right Page: Personal Notes
        const rightPage = spread.createDiv('hl-review-page page-right');
        const notesHeader = rightPage.createDiv('hl-review-notes-header');
        notesHeader.createEl('h3', { text: 'REFLECTION' });

        const notesBody = rightPage.createDiv('hl-review-notes-body');
        if (note.note) {
            MarkdownRenderer.renderMarkdown(note.note, notesBody, note.sourcePath, this);
        } else {
            notesBody.createDiv({ text: '点击“默认模式”进入详情页添加笔记心得...', cls: 'note-placeholder' });
        }

        // Phase 48: Functional Right-side Bookmarks (Moved outside spread for overflow)
        const bookmarkContainer = reviewWrapper.createDiv('hl-review-bookmarks');

        // New "偶遇" (Encounter) Shuffle Button
        const encounterBtn = bookmarkContainer.createDiv('hl-review-bookmark tab-encounter');
        encounterBtn.createSpan({ text: '偶遇' });
        encounterBtn.onclick = (e) => {
            e.stopPropagation();
            this.shuffleReviewOrder();
            this.reviewIndex = 0;
            this.render();
            new Notice('已为你重新准备灵感的偶然相遇 🎭');
        };

        const priorityBtn = bookmarkContainer.createDiv('hl-review-bookmark tab-priority');
        priorityBtn.createSpan({ text: '重点' });
        priorityBtn.onclick = (e) => {
            e.stopPropagation();
            this.addTagToNote(note, '重点');
        };

        const archiveBtn = bookmarkContainer.createDiv('hl-review-bookmark tab-archive');
        archiveBtn.createSpan({ text: '归档' });
        archiveBtn.onclick = (e) => {
            e.stopPropagation();
            this.addTagToNote(note, '归档');
        };

        // Flip Interaction on Spread
        spread.onclick = (e) => {
            const rect = spread.getBoundingClientRect();
            const clickX = e.clientX - rect.left;

            spread.addClass('is-flipping');
            setTimeout(() => {
                if (clickX < rect.width / 2) {
                    // Left half back
                    this.reviewIndex = (this.reviewIndex - 1 + filtered.length) % filtered.length;
                } else {
                    // Right half forward
                    this.reviewIndex = (this.reviewIndex + 1) % filtered.length;
                }
                this.render();
            }, 300);
        };

        // Keyboard Navigation
        this.registerDomEvent(window, 'keydown', (e: KeyboardEvent) => {
            if (this.viewMode !== 'review') return;
            if (e.key === 'ArrowRight') {
                spread.click();
            } else if (e.key === 'ArrowLeft') {
                // Manually trigger back for ArrowLeft
                spread.addClass('is-flipping');
                setTimeout(() => {
                    this.reviewIndex = (this.reviewIndex - 1 + filtered.length) % filtered.length;
                    this.render();
                }, 300);
            } else if (e.key === 'Escape') {
                exitBtn.click();
            }
        });

        // Bottom Navigation Strip
        this.renderReviewNav(parent, filtered);
    }

    private shuffleReviewOrder() {
        const filtered = this.getFilteredHighlights();
        // Fisher-Yates Shuffle
        for (let i = filtered.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = filtered[i];
            filtered[i] = filtered[j];
            filtered[j] = temp;
        }
        this.reviewOrder = filtered;
    }

    private async addTagToNote(note: HighlightNote, newTag: string) {
        try {
            if (note.tags && note.tags.includes(newTag)) {
                new Notice(`卡片已存在 "${newTag}" 标签`);
                return;
            }

            const newTags = [...(note.tags || []), newTag];
            await db.updateHighlightNote(note.id, { tags: newTags });
            note.tags = newTags;

            new Notice(`已添加标签: ${newTag}`);

            if (newTag === '归档' && this.viewMode === 'review') {
                // The list will shrink on next render
            }

            this.render();
        } catch (err) {
            console.error('[HiLighter] Failed to add tag', err);
            new Notice('添加标签失败');
        }
    }

    private renderReviewNav(parent: HTMLElement, notes: HighlightNote[]) {
        const nav = parent.createDiv('hl-review-nav-strip');

        // Back/Exit Button for easier navigation
        const backBtn = nav.createDiv('hl-review-nav-back');
        setIcon(backBtn, 'chevron-left');
        backBtn.createSpan({ text: ' 返回' });
        backBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewMode = 'gallery';
            this.render();
        };

        notes.forEach((n, idx) => {
            const thumb = nav.createDiv(`hl-review-thumb ${idx === this.reviewIndex ? 'is-active' : ''}`);
            thumb.textContent = (idx + 1).toString();
            thumb.onclick = (e) => {
                e.stopPropagation();
                this.reviewIndex = idx;
                this.render();
            };
        });
    }

    private onDragStart(e: DragEvent, id: string) {
        this.draggedNoteId = id;
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', id);
            e.dataTransfer.effectAllowed = 'move';
        }
    }

    async jumpTo(note: HighlightNote) {
        await this.app.workspace.openLinkText(note.sourcePath, '', false);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            view.editor.setCursor(note.lineIndex, 0);
            view.editor.scrollIntoView({ from: { line: note.lineIndex, ch: 0 }, to: { line: note.lineIndex, ch: 0 } }, true);
        }
    }

    async removeHighlightFromVault(note: HighlightNote) {
        try {
            const file = this.app.vault.getAbstractFileByPath(note.sourcePath);
            if (!(file instanceof TFile)) return;
            const content = await this.app.vault.read(file);
            const regex = new RegExp(`<mark[^>]*data-id="${note.id}"[^>]*>(.*?)<\/mark>`, 'g');
            const newContent = content.replace(regex, '$1');
            if (content !== newContent) await this.app.vault.modify(file, newContent);
        } catch (err) { console.error(err); }
    }

    private async handleBatchDelete() {
        if (this.selectedNotes.size === 0) return;
        if (confirm(`确定要彻底删除选中的 ${this.selectedNotes.size} 张卡片吗？`)) {
            const ids = Array.from(this.selectedNotes);
            for (const id of ids) {
                const note = this.highlights.find(h => h.id === id);
                if (note) await this.removeHighlightFromVault(note);
                await db.deleteHighlightNote(id);
            }
            new Notice(`已批量删除 ${ids.length} 张卡片`);
            this.selectedNotes.clear();
            await this.loadHighlights();
            this.render();
        }
    }


    private toggleBatchMode() {
        this.batchMode = !this.batchMode;
        if (!this.batchMode) this.selectedNotes.clear();
        this.render();
    }

    private handleBatchTag() {
        if (this.selectedNotes.size === 0) {
            new Notice('请先选择至少一张卡片');
            return;
        }
        new BatchTagModal(this.app, async (tag: string) => {
            if (!tag.trim()) return;
            const cleanTag = tag.replace(/^#/, '').trim();
            let successCount = 0;
            const ids = Array.from(this.selectedNotes);
            for (const id of ids) {
                const note = this.highlights.find(h => h.id === id);
                if (!note) continue;
                if (note.tags && note.tags.includes(cleanTag)) continue;
                try {
                    const newTags = [...(note.tags || []), cleanTag];
                    await db.updateHighlightNote(note.id, { tags: newTags });
                    note.tags = newTags;
                    successCount++;
                } catch (e) {
                    console.error(`Failed to add tag to ${note.id}:`, e);
                }
            }
            new Notice(`已为 ${successCount} 张卡片添加标签 ${cleanTag}`);
            this.render();
        }).open();
    }
}

class BatchTagModal extends Modal {
    private onSubmit: (tag: string) => void;
    private inputEl: HTMLInputElement;

    constructor(app: App, onSubmit: (tag: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hl-batch-tag-modal');
        contentEl.createEl('h3', { text: '批量添加标签', cls: 'hl-batch-tag-title' });
        contentEl.createEl('p', { text: '将为选中的卡片添加以下标签（自动补全 # 前缀）', cls: 'hl-batch-tag-hint' });

        const inputWrap = contentEl.createDiv('hl-batch-tag-input-wrap');
        this.inputEl = inputWrap.createEl('input', {
            type: 'text',
            placeholder: '例如：重点 或 #重点',
            cls: 'hl-batch-tag-input'
        });

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submit();
        });

        // Tag Suggestions
        const suggestions = ['重点', '归档'];
        const suggestRow = contentEl.createDiv('hl-batch-tag-suggestions');
        suggestions.forEach(tag => {
            const chip = suggestRow.createEl('button', { cls: 'hl-tag-chip', text: tag });
            chip.onclick = () => {
                this.inputEl.value = tag;
                this.submit();
            };
        });

        const btnRow = contentEl.createDiv('hl-batch-tag-btn-row');
        const cancelBtn = btnRow.createEl('button', { text: '取消', cls: 'hl-batch-tag-btn cancel' });
        cancelBtn.onclick = () => this.close();
        const confirmBtn = btnRow.createEl('button', { text: '确认添加', cls: 'hl-batch-tag-btn confirm' });
        confirmBtn.onclick = () => this.submit();

        setTimeout(() => this.inputEl.focus(), 50);
    }

    private submit() {
        const val = this.inputEl?.value?.trim();
        if (!val) return;
        this.close();
        this.onSubmit(val);
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class HighlightDetailModal extends Modal {
    private note: HighlightNote;
    private onUpdate: () => void;

    constructor(app: App, note: HighlightNote, onUpdate: () => void) {
        super(app);
        this.note = note;
        this.onUpdate = onUpdate;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('hl-detail-modal');

        const container = contentEl.createDiv('hl-detail-container');

        // Magazine Style Header
        const header = container.createDiv('hl-detail-header');

        const highlightText = header.createDiv('hl-detail-highlight');
        highlightText.textContent = this.note.text;

        const meta = header.createDiv('hl-detail-meta');
        const filename = this.note.sourcePath.split('/').pop()?.replace('.md', '') || 'Note';
        const date = new Date(this.note.createdAt);
        const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        meta.setText(`${dateStr} | ${filename}`);

        // Magazine Style Body
        const body = container.createDiv('hl-detail-body');
        if (this.note.note) {
            const noteContainer = body.createDiv('hl-detail-note');
            MarkdownRenderer.renderMarkdown(this.note.note, noteContainer, this.note.sourcePath, null as any);
        } else {
            body.createDiv({ cls: 'hl-detail-empty', text: '暂无笔记感悟，点击下方编辑按钮添加' });
        }

        // Footer
        const footer = container.createDiv('hl-detail-footer');

        // Row 1: Actions (left: delete, right: edit/jump/xhs)
        const footerRow1 = footer.createDiv('hl-detail-footer-row1');

        const deleteBtn = footerRow1.createEl('button', { cls: 'hl-studio-mini-btn hl-detail-delete-btn', attr: { 'aria-label': '删除卡片' } });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.onclick = async () => {
            if (!confirm('确定要删除这张卡片吗？')) return;
            await db.deleteHighlightNote(this.note.id);
            try {
                const file = this.app.vault.getAbstractFileByPath(this.note.sourcePath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const regex = new RegExp(`<mark[^>]*data-id="${this.note.id}"[^>]*>(.*?)<\\/mark>`, 'g');
                    const newContent = content.replace(regex, '$1');
                    if (content !== newContent) await this.app.vault.modify(file, newContent);
                }
            } catch (err) {
                console.error('[HiLighter] Failed to remove highlight from vault', err);
            }
            new Notice('卡片已删除');
            this.close();
            await this.onUpdate();
        };

        const actions = footerRow1.createDiv('hl-detail-actions');

        const editBtn = actions.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': '编辑' } });
        setIcon(editBtn, 'edit-3');
        editBtn.onclick = () => {
            new NoteEditModal(this.app, this.note, async (newNote) => {
                await db.updateHighlightNote(this.note.id, { note: newNote });
                this.note.note = newNote;
                await this.onUpdate();
                this.onOpen();
                new Notice('笔记已更新');
            }).open();
        };

        const xhsBtn = actions.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': '生成金句卡片' } });
        setIcon(xhsBtn, 'image');
        xhsBtn.onclick = () => {
            this.generateXhsImage();
        };

        const jumpBtn = actions.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': '跳转至文档' } });
        setIcon(jumpBtn, 'external-link');
        jumpBtn.onclick = async () => {
            await this.handleJump();
            this.close();
        };

        // Row 2: Tags (left-aligned, below actions)
        if (this.note.tags && this.note.tags.length > 0) {
            const tagsWrap = footer.createDiv('hl-detail-tags');
            (this.note.tags).forEach(t => {
                const tag = tagsWrap.createSpan('hl-tag');
                setIcon(tag, 'tag');
                tag.createSpan({ text: t });
            });
        }
    }

    private generateXhsImage() {
        const styles = [this.xhsStyleBold, this.xhsStyleMinimal, this.xhsStyleWarm, this.xhsStyleSerif];
        const styleFn = styles[Math.floor(Math.random() * styles.length)];
        styleFn.call(this);
        new Notice('金句卡片已生成');
    }

    // ── Style 1: Bold block color + giant decorative quotes ──
    private xhsStyleBold() {
        const canvas = document.createElement('canvas');
        const dpr = 2, W = 1080, H = 1440;
        canvas.width = W * dpr; canvas.height = H * dpr;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);

        const palettes = [
            { bg: '#2A75BB', text: '#FFFFFF', sub: 'rgba(255,255,255,0.5)', mark: 'rgba(255,255,255,0.12)' },
            { bg: '#1A3A5C', text: '#FFFFFF', sub: 'rgba(255,255,255,0.45)', mark: 'rgba(255,255,255,0.08)' },
            { bg: '#C62828', text: '#FFFFFF', sub: 'rgba(255,255,255,0.5)', mark: 'rgba(255,255,255,0.1)' },
            { bg: '#2E7D32', text: '#FFFFFF', sub: 'rgba(255,255,255,0.45)', mark: 'rgba(255,255,255,0.08)' },
            { bg: '#4A148C', text: '#FFFFFF', sub: 'rgba(255,255,255,0.45)', mark: 'rgba(255,255,255,0.08)' },
            { bg: '#E65100', text: '#FFFFFF', sub: 'rgba(255,255,255,0.5)', mark: 'rgba(255,255,255,0.1)' },
        ];
        const pal = palettes[Math.floor(Math.random() * palettes.length)];

        ctx.fillStyle = pal.bg;
        ctx.fillRect(0, 0, W, H);

        // Giant decorative quote marks
        ctx.save();
        ctx.font = 'italic 360px Georgia, serif';
        ctx.fillStyle = pal.mark;
        ctx.textAlign = 'left';
        ctx.fillText('“', 30, 320);
        ctx.textAlign = 'right';
        ctx.fillText('”', W - 30, H - 140);
        ctx.restore();

        // Quote text
        const padX = 120;
        let y = 360;
        ctx.fillStyle = pal.text;
        ctx.font = 'bold 48px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left';
        const lines = this.wrapText(ctx, this.note.text, W - padX * 2);
        lines.forEach((line, i) => {
            if (y > H - 300) return;
            // Last word in lighter shade
            if (i === lines.length - 1) ctx.fillStyle = pal.sub;
            ctx.fillText(line, padX, y);
            y += 68;
        });

        // Thin divider
        y += 30;
        ctx.strokeStyle = pal.sub;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(padX + 60, y);
        ctx.stroke();

        // Watermark
        y = H - 100;
        ctx.fillStyle = pal.sub;
        ctx.font = '300 22px "PingFang SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText("Language Made Easy", padX, y);

        this.downloadCanvas(canvas);
    }

    // ── Style 2: Minimal light + centered + soft serif ──
    private xhsStyleMinimal() {
        const canvas = document.createElement('canvas');
        const dpr = 2, W = 1080, H = 1080;
        canvas.width = W * dpr; canvas.height = H * dpr;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);

        const bgs = ['#F0F4F8', '#E8F5E9', '#FFF8E1', '#F3E5F5', '#E0F2F1'];
        const bg = bgs[Math.floor(Math.random() * bgs.length)];
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Subtle center glow
        const glow = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, 400);
        glow.addColorStop(0, 'rgba(255,255,255,0.6)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        // Centered quote
        const padX = 140;
        ctx.fillStyle = '#2C2C2C';
        ctx.font = '36px "Songti SC", "STSong", "Georgia", serif';
        ctx.textAlign = 'center';
        const lines = this.wrapText(ctx, '“' + this.note.text + '”', W - padX * 2);
        const lineH = 56;
        const totalH = lines.length * lineH;
        let startY = (H - totalH) / 2;
        lines.forEach(line => {
            ctx.fillText(line, W / 2, startY);
            startY += lineH;
        });

        // Divider
        startY += 30;
        ctx.strokeStyle = '#CCC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W/2 - 30, startY);
        ctx.lineTo(W/2 + 30, startY);
        ctx.stroke();

        // Source
        startY += 36;
        const filename = this.note.sourcePath.split('/').pop()?.replace('.md', '') || '';
        ctx.fillStyle = '#999';
        ctx.font = '22px "PingFang SC", sans-serif';
        ctx.fillText(filename, W / 2, startY);

        // Bottom watermark
        ctx.fillStyle = '#BBB';
        ctx.font = '18px "PingFang SC", sans-serif';
        ctx.fillText("Language Made Easy", W / 2, H - 48);

        this.downloadCanvas(canvas);
    }

    // ── Style 3: Warm paper + accent left bar + hand-written feel ──
    private xhsStyleWarm() {
        const canvas = document.createElement('canvas');
        const dpr = 2, W = 1080, H = 1440;
        canvas.width = W * dpr; canvas.height = H * dpr;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);

        // Warm paper background
        ctx.fillStyle = '#FBF7F0';
        ctx.fillRect(0, 0, W, H);

        // Paper grain texture
        ctx.save();
        ctx.globalAlpha = 0.03;
        for (let i = 0; i < 8000; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#8B7355';
            ctx.fillRect(Math.random() * W, Math.random() * H, Math.random() * 2, Math.random() * 2);
        }
        ctx.restore();

        // Left accent bar
        const accentColors = ['#C0392B', '#2980B9', '#27AE60', '#8E44AD', '#D35400', '#16A085'];
        const accent = accentColors[Math.floor(Math.random() * accentColors.length)];
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, 8, H);

        // Small decorative circle top-right
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.beginPath();
        ctx.arc(W - 100, 140, 80, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.restore();

        // Quote text
        const padX = 100;
        let y = 180;
        ctx.fillStyle = '#2C2C2C';
        ctx.font = '42px "Songti SC", "STSong", "Georgia", serif';
        ctx.textAlign = 'left';
        const lines = this.wrapText(ctx, this.note.text, W - padX * 2);
        lines.forEach(line => {
            if (y > H - 400) return;
            ctx.fillText(line, padX, y);
            y += 62;
        });

        // Note text if exists
        if (this.note.note) {
            y += 20;
            ctx.strokeStyle = '#E0D8CC';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padX, y);
            ctx.lineTo(W - padX, y);
            ctx.stroke();
            y += 36;
            ctx.fillStyle = '#777';
            ctx.font = '28px "PingFang SC", "Hiragino Sans GB", sans-serif';
            const noteLines = this.wrapText(ctx, this.note.note, W - padX * 2);
            noteLines.forEach(line => {
                if (y > H - 220) return;
                ctx.fillText(line, padX, y);
                y += 42;
            });
        }

        // Tags
        if (this.note.tags && this.note.tags.length > 0) {
            y = H - 200;
            ctx.fillStyle = accent;
            ctx.font = '500 22px "PingFang SC", sans-serif';
            let tagX = padX;
            this.note.tags.forEach(tag => {
                const t = '# ' + tag;
                ctx.fillText(t, tagX, y);
                tagX += ctx.measureText(t).width + 24;
            });
        }

        // Bottom watermark
        ctx.fillStyle = '#C8BFB0';
        ctx.font = '20px "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("Language Made Easy", W / 2, H - 48);

        this.downloadCanvas(canvas);
    }

    // ── Style 4: Serif editorial + large drop cap + two-column note ──
    private xhsStyleSerif() {
        const canvas = document.createElement('canvas');
        const dpr = 2, W = 1080, H = 1440;
        canvas.width = W * dpr; canvas.height = H * dpr;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);

        // Deep dark background
        const darks = ['#1C1C1E', '#1A2332', '#2D1F2F', '#1E2D1E', '#2B1D1D'];
        ctx.fillStyle = darks[Math.floor(Math.random() * darks.length)];
        ctx.fillRect(0, 0, W, H);

        // Top thin accent line
        const accents = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8A5C', '#D4A5FF'];
        const accent = accents[Math.floor(Math.random() * accents.length)];
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, W, 4);

        // Drop cap (first character, large)
        const padX = 90;
        const firstChar = this.note.text.charAt(0);
        const restText = this.note.text.slice(1);

        ctx.fillStyle = accent;
        ctx.font = '120px "Songti SC", "STSong", "Georgia", serif';
        ctx.textAlign = 'left';
        ctx.fillText(firstChar, padX, 220);

        // Rest of quote
        ctx.fillStyle = '#E8E8E8';
        ctx.font = '38px "Songti SC", "STSong", "Georgia", serif';
        const restLines = this.wrapText(ctx, restText, W - padX * 2 - 100);
        let y = 300;
        restLines.forEach(line => {
            if (y > H - 400) return;
            ctx.fillText(line, padX, y);
            y += 56;
        });

        // Decorative thin line
        y += 20;
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(W - padX, y);
        ctx.stroke();

        // Note if exists
        if (this.note.note) {
            y += 40;
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = '26px "PingFang SC", sans-serif';
            const noteLines = this.wrapText(ctx, this.note.note, W - padX * 2);
            noteLines.forEach(line => {
                if (y > H - 220) return;
                ctx.fillText(line, padX, y);
                y += 40;
            });
        }

        // Bottom: source + watermark
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '20px "PingFang SC", sans-serif';
        ctx.textAlign = 'left';
        const filename = this.note.sourcePath.split('/').pop()?.replace('.md', '') || '';
        ctx.fillText(filename, padX, H - 48);

        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillText("Language Made Easy", W - padX, H - 48);

        this.downloadCanvas(canvas);
    }

    private downloadCanvas(canvas: HTMLCanvasElement) {
        const link = document.createElement('a');
        link.download = `hilighter-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        const rawLines = text.split('\n');
        const result: string[] = [];
        for (const raw of rawLines) {
            if (!raw.trim()) {
                result.push('');
                continue;
            }
            let line = '';
            for (const char of raw) {
                const test = line + char;
                if (ctx.measureText(test).width > maxWidth) {
                    result.push(line);
                    line = char;
                } else {
                    line = test;
                }
            }
            if (line) result.push(line);
        }
        return result;
    }

    private async handleJump() {
        await this.app.workspace.openLinkText(this.note.sourcePath, '', false);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            view.editor.setCursor(this.note.lineIndex, 0);
            view.editor.scrollIntoView({ from: { line: this.note.lineIndex, ch: 0 }, to: { line: this.note.lineIndex, ch: 0 } }, true);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

class NoteEditModal extends Modal {
    private note: HighlightNote;
    private onSubmit: (text: string) => void;

    constructor(app: App, note: HighlightNote, onSubmit: (text: string) => void) {
        super(app);
        this.note = note;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText('编辑个人笔记');
        this.modalEl.addClass('hl-glass-modal');

        const container = contentEl.createDiv('hl-glass-modal-body');

        const textArea = container.createEl('textarea', {
            cls: 'hl-glass-textarea',
            attr: { placeholder: '输入您的心得体会...' }
        });
        textArea.value = this.note.note || '';
        textArea.focus();

        const actions = container.createDiv('hl-glass-modal-actions');

        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'hl-glass-btn-cancel' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: '保存修改' });
        saveBtn.onclick = () => {
            this.onSubmit(textArea.value);
            this.close();
        };
    }
}

class TagEditModal extends Modal {
    private tag: string;
    private onSubmit: (tag: string) => void;
    private inputEl: HTMLInputElement;

    constructor(app: App, tag: string, onSubmit: (tag: string) => void) {
        super(app);
        this.tag = tag;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText('编辑标签');
        this.modalEl.addClass('hl-glass-modal');

        const container = contentEl.createDiv('hl-glass-modal-body');

        const fieldWrap = container.createDiv('hl-glass-field');
        fieldWrap.createEl('label', { text: '新标签名', cls: 'hl-glass-label' });
        this.inputEl = fieldWrap.createEl('input', {
            type: 'text',
            placeholder: '请输入新标签名',
            value: this.tag,
            cls: 'hl-glass-input'
        });

        const actions = container.createDiv('hl-glass-modal-actions');
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'hl-glass-btn-cancel' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: '确定' });
        confirmBtn.onclick = () => this.handleSubmit();

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleSubmit();
            if (e.key === 'Escape') this.close();
        });

        setTimeout(() => this.inputEl.focus(), 50);
    }

    private handleSubmit() {
        const newTag = this.inputEl.value.trim();
        if (newTag && newTag !== this.tag) {
            this.onSubmit(newTag);
        }
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
