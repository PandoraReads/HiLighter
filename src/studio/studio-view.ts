// ============================================================
// HiLighter - Studio (卡片集) main-area view shell
// ============================================================
// Replaces the old single-file highlight-manager.ts. Rendering
// lives in the sibling modules; this class owns state, layout,
// and the single window-keydown dispatch (leak fix).

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { db } from '../db';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import type HiLighterPlugin from '../main';
import { applyAppearance } from '../appearance';
import { HIGHLIGHT_MANAGER_VIEW_TYPE } from '../view-types';
import type { StudioGroupBy, StudioSortBy, StudioViewMode, ReviewSession } from './studio-state';
import { renderMainContent } from './content';
import { renderReview, handleReviewKey } from './review/review-view';

export { HIGHLIGHT_MANAGER_VIEW_TYPE };

export class HighlightManagerView extends ItemView {
    // ── State (public: studio modules render from it) ──
    plugin: HiLighterPlugin;
    highlights: HighlightNote[] = [];
    searchQuery = '';
    groupBy: StudioGroupBy = 'file';
    selectedGroups: Set<string> = new Set();
    sortBy: StudioSortBy = 'source_order';
    viewMode: StudioViewMode = 'gallery';
    collapsedGroups: Set<string> = new Set();
    batchMode = false;
    selectedNotes: Set<string> = new Set();
    statsOpen = false;
    reviewSession: ReviewSession = {
        active: false,
        mode: 'due',
        queue: [],
        waiting: [],
        total: 0,
        flipped: false,
        stats: { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 },
    };

    // Dropdown open-state + persistent wrap refs (toolbar owns the DOM)
    groupDropdownOpen = false;
    groupWrap: HTMLElement | null = null;
    sortDropdownOpen = false;
    sortWrap: HTMLElement | null = null;
    filterDropdownOpen = false;
    filterWrap: HTMLElement | null = null;
    reviewMenuOpen = false;
    reviewWrap: HTMLElement | null = null;
    collapseBtn: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return HIGHLIGHT_MANAGER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('manager.viewName');
    }

    getIcon(): string {
        return 'layout-grid';
    }

    async onOpen() {
        await this.loadHighlights();
        this.render();

        // Close any open dropdown (group / filter / sort / review menu) when
        // clicking outside of it. The element is removed directly so the
        // outside click still reaches its target.
        this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
            const target = e.target as Node;
            const closeOne = (open: boolean, dropdownCls: string, triggerCls: string, reset: () => void) => {
                if (!open) return false;
                const dropdown = this.contentEl.querySelector(`.${dropdownCls}`);
                const trigger = this.contentEl.querySelector(`.${triggerCls}`);
                if (dropdown && !dropdown.contains(target) && trigger && !trigger.contains(target)) {
                    reset();
                    trigger.removeClass('is-open');
                    dropdown.remove();
                    return true;
                }
                return false;
            };
            closeOne(this.filterDropdownOpen, 'hl-filter-dropdown', 'hl-filter-trigger', () => { this.filterDropdownOpen = false; });
            closeOne(this.sortDropdownOpen, 'hl-sort-dropdown', 'hl-sort-trigger', () => { this.sortDropdownOpen = false; });
            closeOne(this.groupDropdownOpen, 'hl-group-dropdown', 'hl-group-trigger', () => { this.groupDropdownOpen = false; });
            closeOne(this.reviewMenuOpen, 'hl-review-menu', 'hl-tool-review', () => { this.reviewMenuOpen = false; });
        });

        // SINGLE window keydown handler for the whole studio view.
        // (The old code re-registered one per review render — handlers
        // accumulated and kept firing after leaving review.)
        this.registerDomEvent(window, 'keydown', (e: KeyboardEvent) => {
            if (this.reviewSession.active) handleReviewKey(this, e);
        });
    }

    async loadHighlights() {
        this.highlights = await db.getAllHighlights();
    }

    render() {
        const container = this.contentEl;
        const scrollPos = container.scrollTop;
        container.empty();
        container.addClass('hl-studio');

        // Apply theme / density / accent + gallery column count
        applyAppearance(container, this.plugin.settings);
        container.setAttribute('data-hl-mode', this.plugin.settings.studioColorMode || 'auto');
        const cols = this.plugin.settings.studioColumns;
        if (cols !== 'auto') {
            container.setAttribute('data-hl-cols', String(cols));
        } else {
            container.removeAttribute('data-hl-cols');
        }

        // Aurora Background
        const aurora = container.createDiv('hl-studio-aurora');
        aurora.createDiv('hl-aurora-blob hl-aurora-blob-1');
        aurora.createDiv('hl-aurora-blob hl-aurora-blob-2');
        aurora.createDiv('hl-aurora-blob hl-aurora-blob-3');

        // Single-column layout: toolbar on top, content fills the rest
        const mainLayout = container.createDiv('hl-studio-layout');
        const content = mainLayout.createDiv('hl-studio-content');

        if (this.reviewSession.active) {
            renderReview(this, content);
        } else {
            renderMainContent(this, content);
        }

        // Restore Scroll Position
        if (scrollPos > 0) {
            container.scrollTop = scrollPos;
        }
    }

    /** Body-only re-render (keeps the toolbar mounted; search keeps focus). */
    renderMainContent(parent?: HTMLElement): void {
        renderMainContent(this, parent);
    }
}
