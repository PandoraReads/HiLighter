// @ts-nocheck
import { ItemView, WorkspaceLeaf, setIcon, MarkdownRenderer, TFile, Notice, Modal, App, TextComponent, MarkdownView, Platform } from "obsidian";
import { db } from './db';
import { HighlightNote } from './models';

export const HIGHLIGHT_MANAGER_VIEW_TYPE = 'eme-highlight-manager';

export class HighlightManagerView extends ItemView {
    private highlights: HighlightNote[] = [];
    private searchQuery: string = '';
    private activeTab: 'all' | 'notes' | 'tags' = 'all';
    private selectedFilePath: string | null = null;
    private selectedTags: Set<string> = new Set();
    private sortBy: 'time' | 'az' = 'time';
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
        container.addClass('eme-studio');

        // Aurora Background
        const aurora = container.createDiv('eme-studio-aurora');
        aurora.createDiv('eme-aurora-blob eme-aurora-blob-1');
        aurora.createDiv('eme-aurora-blob eme-aurora-blob-2');
        aurora.createDiv('eme-aurora-blob eme-aurora-blob-3');

        // Main Layout: 3 (Sidebar) : 7 (Content)
        const mainLayout = container.createDiv('eme-studio-layout');

        const sidebar = mainLayout.createDiv('eme-studio-sidebar');
        if (Platform.isMobile && this.isSidebarPinned) sidebar.addClass('is-pinned');
        const content = mainLayout.createDiv('eme-studio-content');

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
        parent.createEl('h2', { text: '管理卡片集', cls: 'eme-studio-name' });

        // Compact Controls Row (Tabs + Sort)
        const controlsHeader = parent.createDiv('eme-studio-controls-header');

        // Navigation Tabs (Compact)
        const navTabs = controlsHeader.createDiv('eme-studio-nav-tabs-compact');
        this.createNavTab(navTabs, 'all', '', 'layout-list', '全部');
        this.createNavTab(navTabs, 'notes', '', 'file-text', '笔记');
        this.createNavTab(navTabs, 'tags', '', 'tag', '标签');

        // Right side: Sort Switch
        const sortBtn = controlsHeader.createEl('button', { cls: 'eme-studio-mini-btn', attr: { 'aria-label': '切换排序' } });
        setIcon(sortBtn, this.sortBy === 'time' ? 'clock' : 'sort-asc');
        sortBtn.onclick = () => {
            if (Platform.isMobile) this.isSidebarPinned = true;
            this.sortBy = this.sortBy === 'time' ? 'az' : 'time';
            this.render();
        };

        // Search Block (Now below tabs)
        const searchWrap = parent.createDiv('eme-studio-search-block');
        const searchInput = searchWrap.createEl('input', {
            cls: 'eme-studio-search-input-full',
            attr: { type: 'text', placeholder: '搜索所有笔记...', value: this.searchQuery }
        });
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderMainContent();
        };

        // Scrollable List Area
        const listArea = parent.createDiv('eme-studio-sidebar-list');
        // ...

        if (this.activeTab === 'notes') {
            this.renderNotesSidebar(listArea);
        } else if (this.activeTab === 'tags') {
            this.renderTagsSidebar(listArea);
        } else {
            listArea.createDiv({ text: '管理所有灵感卡片', cls: 'eme-studio-hint' });
        }
    }

    private createNavTab(parent: HTMLElement, id: any, label: string, icon: string, tooltip: string) {
        const tab = parent.createDiv(`eme-studio-nav-item-compact ${this.activeTab === id ? 'is-active' : ''}`);
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
            if (this.sortBy === 'az') return nameA.localeCompare(nameB);
            // Default to loaded order (which is usually time-based from DB)
            return 0;
        });

        if (sortedFiles.length === 0) {
            parent.createDiv({ text: '无文档记录', cls: 'eme-studio-empty' });
            return;
        }

        sortedFiles.forEach(path => {
            const fileName = path.split('/').pop()!;
            const count = filesMap.get(path);
            const item = parent.createDiv(`eme-studio-list-item ${this.selectedFilePath === path ? 'is-selected' : ''}`);
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
        // Default system tags
        tagsMap.set('重点', 0);
        tagsMap.set('归档', 0);

        this.highlights.forEach(h => {
            (h.tags || []).forEach(t => {
                tagsMap.set(t, (tagsMap.get(t) || 0) + 1);
            });
        });

        const sortedTags = Array.from(tagsMap.keys()).sort((a, b) => {
            if (this.sortBy === 'az') return a.toLowerCase().localeCompare(b.toLowerCase());
            return (tagsMap.get(b) || 0) - (tagsMap.get(a) || 0); // By popularity/count
        });

        if (sortedTags.length === 0) {
            parent.createDiv({ text: '无标签记录', cls: 'eme-studio-empty' });
            return;
        }

        sortedTags.forEach(tag => {
            const isSelected = this.selectedTags.has(tag);
            const item = parent.createDiv(`eme-studio-list-item ${isSelected ? 'is-selected' : ''}`);
            const tagContent = item.createDiv('eme-studio-list-item-tag');

            const titleWrap = tagContent.createDiv({ cls: 'title' });
            setIcon(titleWrap, 'tag');
            titleWrap.createSpan({ text: tag });

            tagContent.createDiv({ text: `${tagsMap.get(tag)}`, cls: 'badge' }); // Page Style count

            item.onclick = (e) => {
                e.stopPropagation();
                if (isSelected) this.selectedTags.delete(tag);
                else this.selectedTags.add(tag);
                this.render();
            };
        });
    }

    private renderMainContent(parentProp?: HTMLElement) {
        const parent = parentProp || this.contentEl.querySelector('.eme-studio-content') as HTMLElement;
        if (!parent) return;
        parent.empty();

        // Mode Switcher (Gallery vs MindMap)
        const header = parent.createDiv('eme-studio-content-header');

        // Editorial Magazine Header
        const editorialHeader = header.createDiv('eme-studio-editorial-header');
        const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
        editorialHeader.createDiv({ text: `ISSUED ${date} • COLLECTION`, cls: 'eme-studio-vol-issue' });

        const modeSwitcher = header.createDiv('eme-studio-mode-switcher');
        const tabsRow = modeSwitcher.createDiv('eme-studio-tabs-row');

        const galleryBtn = tabsRow.createEl('button', {
            cls: `eme-mode-btn tab-default ${this.viewMode === 'gallery' ? 'is-active' : ''}`,
            text: '默认'
        });
        galleryBtn.onclick = () => { this.viewMode = 'gallery'; this.render(); };

        const reviewBtn = tabsRow.createEl('button', {
            cls: `eme-mode-btn tab-review ${this.viewMode === 'review' ? 'is-active' : ''}`,
            text: '复习'
        });
        reviewBtn.onclick = () => {
            this.viewMode = 'review';
            this.shuffleReviewOrder();
            this.reviewIndex = 0;
            this.render();
        };

        const batchBtn = tabsRow.createEl('button', {
            cls: `eme-mode-btn tab-batch ${this.batchMode ? 'is-active' : ''}`,
            text: this.batchMode ? `退出批量 (${this.selectedNotes.size})` : '批量'
        });
        batchBtn.onclick = () => this.toggleBatchMode();

        const filtered = this.getFilteredHighlights();

        if (this.batchMode && this.selectedNotes.size > 0) {
            const batchActions = header.createDiv('eme-studio-batch-actions-float');

            const batchDel = batchActions.createEl('button', { cls: 'eme-studio-mini-btn is-danger', text: '删除所选' });
            setIcon(batchDel, 'trash-2');
            batchDel.onclick = () => this.handleBatchDelete();

            const batchTag = batchActions.createEl('button', { cls: 'eme-studio-mini-btn', text: '添加标签' });
            setIcon(batchTag, 'tag');
            batchTag.onclick = () => this.handleBatchTag();
        }
        if (filtered.length === 0) {
            parent.createEl('div', { text: '空空如也，去划线记录灵感吧', cls: 'eme-studio-empty-content' });
            return;
        }

        const grid = parent.createDiv('eme-studio-grid');
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
            return b.createdAt - a.createdAt;
        });

        return filtered;
    }

    private renderStudioCard(parent: HTMLElement, note: HighlightNote) {
        const card = parent.createDiv(`eme-studio-card border-${note.color}`);

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
            parent.createEl('p', { text: '暂无卡片进行复习', cls: 'eme-empty-msg' });
            return;
        }

        if (this.reviewIndex >= filtered.length) this.reviewIndex = 0;
        const note = filtered[this.reviewIndex];

        // Exit/Close Button (Editorial Style)
        const exitBtn = parent.createDiv('eme-review-exit-btn');
        setIcon(exitBtn, 'x');
        exitBtn.setAttribute('aria-label', '退出复习模式');
        exitBtn.onclick = () => {
            this.viewMode = 'gallery';
            this.render();
        };

        // Relative wrapper to contain spread and overlapping bookmarks
        const reviewWrapper = parent.createDiv('eme-review-spread-wrapper');

        // Dual Page Magazine Spread
        const spread = reviewWrapper.createDiv('eme-review-spread');

        // Left Page: Highlight Text (Editorial Style)
        const leftPage = spread.createDiv('eme-review-page page-left');
        const quoteBox = leftPage.createDiv('eme-review-quote');
        quoteBox.createSpan({ text: '“', cls: 'quote-mark open' });
        quoteBox.createDiv({ text: note.text, cls: 'quote-text' });

        const meta = leftPage.createDiv('eme-review-meta');
        const filename = note.sourcePath.split('/').pop()?.replace('.md', '') || 'Notes';
        meta.createDiv({ text: filename, cls: 'meta-source' });
        meta.createDiv({ text: new Date(note.createdAt).toLocaleDateString(), cls: 'meta-date' });

        // Right Page: Personal Notes
        const rightPage = spread.createDiv('eme-review-page page-right');
        const notesHeader = rightPage.createDiv('eme-review-notes-header');
        notesHeader.createEl('h3', { text: 'REFLECTION' });

        const notesBody = rightPage.createDiv('eme-review-notes-body');
        if (note.note) {
            MarkdownRenderer.renderMarkdown(note.note, notesBody, note.sourcePath, this);
        } else {
            notesBody.createDiv({ text: '点击“默认模式”进入详情页添加笔记心得...', cls: 'note-placeholder' });
        }

        // Phase 48: Functional Right-side Bookmarks (Moved outside spread for overflow)
        const bookmarkContainer = reviewWrapper.createDiv('eme-review-bookmarks');

        // New "偶遇" (Encounter) Shuffle Button
        const encounterBtn = bookmarkContainer.createDiv('eme-review-bookmark tab-encounter');
        encounterBtn.createSpan({ text: '偶遇' });
        encounterBtn.onclick = (e) => {
            e.stopPropagation();
            this.shuffleReviewOrder();
            this.reviewIndex = 0;
            this.render();
            new Notice('已为你重新准备灵感的偶然相遇 🎭');
        };

        const priorityBtn = bookmarkContainer.createDiv('eme-review-bookmark tab-priority');
        priorityBtn.createSpan({ text: '重点' });
        priorityBtn.onclick = (e) => {
            e.stopPropagation();
            this.addTagToNote(note, '重点');
        };

        const archiveBtn = bookmarkContainer.createDiv('eme-review-bookmark tab-archive');
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
            const file = this.app.vault.getAbstractFileByPath(note.sourcePath);
            if (!(file instanceof TFile)) return;

            const content = await this.app.vault.read(file);
            // Rough check to see if tag exists
            if (content.indexOf(`#${newTag}`) !== -1) {
                new Notice(`卡片已存在 #${newTag} 标签`);
                return;
            }

            // Append tag to the end of the file or after the highlight block
            // For simplicity in this specialized plugin, we append to the end
            const updatedContent = content.trim() + `\n\n#${newTag}`;
            await this.app.vault.modify(file, updatedContent);

            new Notice(`已添加标签: #${newTag}`);

            // Update local state and re-render
            if (!note.tags) note.tags = [];
            note.tags.push(newTag);

            // If archived, we might need to adjust indices
            if (newTag === '归档' && this.viewMode === 'review') {
                // The list will shrink on next render
            }

            this.render();
        } catch (err) {
            console.error('[EME] Failed to add tag', err);
            new Notice('添加标签失败');
        }
    }

    private renderReviewNav(parent: HTMLElement, notes: HighlightNote[]) {
        const nav = parent.createDiv('eme-review-nav-strip');

        // Back/Exit Button for easier navigation
        const backBtn = nav.createDiv('eme-review-nav-back');
        setIcon(backBtn, 'chevron-left');
        backBtn.createSpan({ text: ' 返回' });
        backBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewMode = 'gallery';
            this.render();
        };

        notes.forEach((n, idx) => {
            const thumb = nav.createDiv(`eme-review-thumb ${idx === this.reviewIndex ? 'is-active' : ''}`);
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
            const formattedTag = tag.startsWith('#') ? tag.trim() : `#${tag.trim()}`;
            let successCount = 0;
            const ids = Array.from(this.selectedNotes);
            for (const id of ids) {
                const note = this.highlights.find(h => h.id === id);
                if (!note) continue;
                try {
                    const file = this.app.vault.getAbstractFileByPath(note.sourcePath);
                    if (!(file instanceof TFile)) continue;
                    const content = await this.app.vault.read(file);
                    if (content.indexOf(formattedTag) !== -1) continue; // skip duplicates
                    await this.app.vault.modify(file, content + `\n${formattedTag}`);
                    // Update local note object
                    note.tags = note.tags ? [...note.tags, formattedTag] : [formattedTag];
                    successCount++;
                } catch (e) {
                    console.error(`Failed to add tag to ${note.sourcePath}:`, e);
                }
            }
            new Notice(`已为 ${successCount} 张卡片添加标签 ${formattedTag}`);
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
        contentEl.addClass('eme-batch-tag-modal');
        contentEl.createEl('h3', { text: '批量添加标签', cls: 'eme-batch-tag-title' });
        contentEl.createEl('p', { text: '将为选中的卡片添加以下标签（自动补全 # 前缀）', cls: 'eme-batch-tag-hint' });

        const inputWrap = contentEl.createDiv('eme-batch-tag-input-wrap');
        this.inputEl = inputWrap.createEl('input', {
            type: 'text',
            placeholder: '例如：重点 或 #重点',
            cls: 'eme-batch-tag-input'
        });

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submit();
        });

        // Tag Suggestions
        const suggestions = ['重点', '归档'];
        const suggestRow = contentEl.createDiv('eme-batch-tag-suggestions');
        suggestions.forEach(tag => {
            const chip = suggestRow.createEl('button', { cls: 'eme-tag-chip', text: tag });
            chip.onclick = () => {
                this.inputEl.value = tag;
                this.submit();
            };
        });

        const btnRow = contentEl.createDiv('eme-batch-tag-btn-row');
        const cancelBtn = btnRow.createEl('button', { text: '取消', cls: 'eme-batch-tag-btn cancel' });
        cancelBtn.onclick = () => this.close();
        const confirmBtn = btnRow.createEl('button', { text: '确认添加', cls: 'eme-batch-tag-btn confirm' });
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
        this.modalEl.addClass('eme-detail-modal');

        const container = contentEl.createDiv('eme-detail-container');

        // Magazine Style Header
        const header = container.createDiv('eme-detail-header');

        const highlightText = header.createDiv('eme-detail-highlight');
        highlightText.textContent = this.note.text;

        const meta = header.createDiv('eme-detail-meta');
        const filename = this.note.sourcePath.split('/').pop()?.replace('.md', '') || 'Note';
        const date = new Date(this.note.createdAt);
        const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        meta.setText(`${dateStr} | ${filename}`);

        // Magazine Style Body
        const body = container.createDiv('eme-detail-body');
        if (this.note.note) {
            const noteContainer = body.createDiv('eme-detail-note');
            MarkdownRenderer.renderMarkdown(this.note.note, noteContainer, this.note.sourcePath, null as any);
        } else {
            body.createDiv({ cls: 'eme-detail-empty', text: '暂无笔记感悟，点击下方编辑按钮添加' });
        }

        // Footer
        const footer = container.createDiv('eme-detail-footer');
        const tagsWrap = footer.createDiv('eme-detail-tags');
        (this.note.tags || []).forEach(t => {
            const tag = tagsWrap.createSpan('eme-tag');
            setIcon(tag, 'tag');
            tag.createSpan({ text: t });
        });

        const actions = footer.createDiv('eme-detail-actions');

        // Removed "Share/Delete" from here as requested (Phase 33)
        // Edit button remains for single card refinement
        const editBtn = actions.createEl('button', { cls: 'eme-studio-mini-btn', attr: { 'aria-label': '编辑' } });
        setIcon(editBtn, 'edit-3');
        editBtn.onclick = () => {
            new NoteEditModal(this.app, this.note, async (newNote) => {
                await db.updateHighlightNote(this.note.id, { note: newNote });
                this.note.note = newNote; // Refresh local instance
                await this.onUpdate(); // Refresh parent view
                this.onOpen(); // Refresh modal content
                new Notice('笔记已更新');
            }).open();
        };

        const jumpBtn = actions.createEl('button', { cls: 'eme-studio-mini-btn', attr: { 'aria-label': '跳转至文档' } });
        setIcon(jumpBtn, 'external-link');
        jumpBtn.onclick = async () => {
            await this.handleJump();
            this.close();
        };
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

        const container = contentEl.createDiv('eme-note-edit-container');

        const textArea = container.createEl('textarea', {
            cls: 'eme-note-edit-area',
            attr: { placeholder: '输入您的心得体会...' }
        });
        textArea.value = this.note.note || '';
        textArea.style.width = '100%';
        textArea.style.height = '200px';
        textArea.focus();

        const actions = container.createDiv('eme-note-edit-actions');

        const saveBtn = actions.createEl('button', { cls: 'mod-cta', text: '保存修改' });
        saveBtn.onclick = () => {
            this.onSubmit(textArea.value);
            this.close();
        };

        const cancelBtn = actions.createEl('button', { text: '取消' });
        cancelBtn.onclick = () => this.close();
    }
}
