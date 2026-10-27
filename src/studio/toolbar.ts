// ============================================================
// HiLighter - Studio database-style top toolbar
// ============================================================
// App bar: review | statistics | theme | light/dark mode
// Toolbar: search | group | sort | filter | view | batch
// The header is persistent across body re-renders (search keeps focus).

import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { getColors } from '../colors';
import type { ThemeId } from '../models';
import { dueCount, newCount } from '../fsrs';
import { MINDMAP_VIEW_TYPE } from '../view-types';
import { collectFilterItems, groupByLabel, deckGroups } from './grouping';
import { toggleBatchMode } from './batch';
import { startFsrsSession } from './review/session';
import type { HighlightManagerView } from './studio-view';
import type { StudioGroupBy, StudioSortBy } from './studio-state';

/** Applies icon + tooltip matching the current collapse state. */
export function refreshCollapseButton(view: HighlightManagerView): void {
    const btn = view.collapseBtn;
    if (!btn) return;
    const groups = deckGroups(view);
    const allCollapsed = groups.length > 0 && groups.every(g => view.collapsedGroups.has(g.key));
    setIcon(btn, allCollapsed ? 'chevrons-up-down' : 'chevrons-down-up');
    const label = allCollapsed ? t('manager.toolbar.expandAll') : t('manager.toolbar.collapseAll');
    btn.setAttribute('aria-label', label);
    btn.title = label;
}

/** App-level actions modeled after the approved card-management sample. */
export function buildStudioTopbar(view: HighlightManagerView, parent: HTMLElement): HTMLElement {
    const bar = parent.createDiv('hl-studio-topbar');
    const identity = bar.createDiv('hl-studio-topbar-identity');
    identity.createSpan({ text: 'HiLighter', cls: 'hl-studio-topbar-brand' });
    identity.createSpan({ text: '/', cls: 'hl-studio-topbar-separator' });
    identity.createSpan({ text: t('manager.viewName'), cls: 'hl-studio-topbar-title' });

    const actions = bar.createDiv('hl-studio-topbar-actions');
    const reviewWrap = actions.createDiv('hl-tool-wrap');
    view.reviewWrap = reviewWrap;
    renderReviewControl(view, reviewWrap);

    const mindMapLabel = t('mindmap.viewName');
    const mindMapBtn = actions.createEl('button', {
        cls: 'hl-tool-btn hl-studio-topbar-button',
        attr: { 'aria-label': mindMapLabel, title: mindMapLabel },
    });
    setIcon(mindMapBtn, 'git-fork');
    mindMapBtn.createSpan({ text: mindMapLabel, cls: 'hl-tool-stats-label' });
    mindMapBtn.onclick = () => {
        void view.plugin.activateView(MINDMAP_VIEW_TYPE, 'main');
    };

    const statsLabel = t('manager.toolbar.statsEntry');
    const statsBtn = actions.createEl('button', {
        cls: `hl-tool-btn hl-tool-stats hl-studio-topbar-button ${view.statsOpen ? 'is-active' : ''}`,
        attr: { 'aria-label': statsLabel, title: statsLabel },
    });
    setIcon(statsBtn, 'bar-chart-3');
    statsBtn.createSpan({ text: statsLabel, cls: 'hl-tool-stats-label' });
    statsBtn.onclick = () => {
        view.statsOpen = !view.statsOpen;
        view.render();
    };

    const themeWrap = actions.createDiv('hl-studio-theme-wrap');
    const themeIcon = themeWrap.createDiv('hl-studio-theme-icon');
    setIcon(themeIcon, 'palette');
    const themeSelect = themeWrap.createEl('select', {
        cls: 'hl-studio-theme-select',
        attr: { 'aria-label': t('settings.appearance.theme'), title: t('settings.appearance.theme') },
    });
    const themes: ThemeId[] = ['editorial', 'native', 'paper', 'ocean', 'forest', 'galaxy', 'cyber', 'sunset', 'rose'];
    themes.forEach(theme => themeSelect.createEl('option', { text: t(`settings.theme.${theme}`), value: theme }));
    themeSelect.value = view.plugin.settings.theme;
    themeSelect.onchange = () => {
        view.plugin.settings.theme = themeSelect.value as ThemeId;
        void view.plugin.saveSettings().then(() => view.plugin.refreshAllViews());
    };

    const currentMode = view.plugin.settings.studioColorMode || 'auto';
    const isDark = currentMode === 'dark' || (currentMode === 'auto' && document.body.classList.contains('theme-dark'));
    const nextMode = isDark ? 'light' : 'dark';
    const modeLabel = t(nextMode === 'dark' ? 'manager.theme.switchDark' : 'manager.theme.switchLight');
    const modeBtn = actions.createEl('button', {
        cls: 'hl-tool-btn hl-studio-mode-toggle',
        attr: { 'aria-label': modeLabel, title: modeLabel },
    });
    setIcon(modeBtn, nextMode === 'dark' ? 'moon' : 'sun');
    modeBtn.createSpan({ text: modeLabel, cls: 'hl-studio-mode-label' });
    modeBtn.onclick = () => {
        view.plugin.settings.studioColorMode = nextMode;
        void view.plugin.saveSettings().then(() => view.render());
    };

    return bar;
}

function renderCollapseControl(view: HighlightManagerView, parent: HTMLElement): void {
    const btn = parent.createDiv('hl-icon-btn hl-collapse-all-btn');
    view.collapseBtn = btn;
    refreshCollapseButton(view);
    btn.onclick = () => {
        const groups = deckGroups(view);
        if (groups.length === 0) return;
        const allCollapsed = groups.every(g => view.collapsedGroups.has(g.key));
        groups.forEach(g => {
            if (allCollapsed) view.collapsedGroups.delete(g.key);
            else view.collapsedGroups.add(g.key);
        });
        refreshCollapseButton(view);
        view.renderMainContent();
    };
}

/** Builds the persistent toolbar header into the content pane. */
export function buildToolbar(view: HighlightManagerView, parent: HTMLElement): HTMLElement {
    const header = parent.createDiv('hl-studio-content-header');

    // ── Left cluster: search + group + sort + filter ──
    const tools = header.createDiv('hl-studio-tools');

    const searchInput = tools.createEl('input', {
        cls: 'hl-studio-header-search',
        attr: { type: 'text', placeholder: t('manager.search.placeholder'), value: view.searchQuery }
    });
    searchInput.oninput = () => {
        view.searchQuery = searchInput.value;
        view.renderMainContent();
    };

    // Group-by dropdown (replaces the old left icon rail)
    const groupWrap = tools.createDiv('hl-filter-dropdown-wrap');
    view.groupWrap = groupWrap;
    renderGroupControl(view, groupWrap);

    // Sort dropdown
    const sortWrap = tools.createDiv('hl-filter-dropdown-wrap');
    view.sortWrap = sortWrap;
    renderSortControl(view, sortWrap);

    // Filter dropdown (facets of the active grouping dimension)
    const filterWrap = tools.createDiv('hl-filter-dropdown-wrap');
    view.filterWrap = filterWrap;
    renderFilterControl(view, filterWrap);

    // Collapse / expand all groups (one click, right of the filter button)
    renderCollapseControl(view, tools);

    // ── Right cluster: view toggle + batch ──
    const right = header.createDiv('hl-studio-toolbar-right');

    // Segmented view toggle: 卡片 | 列表 (icons only)
    const viewToggle = right.createDiv('hl-studio-view-toggle');
    const galleryBtn = viewToggle.createEl('button', {
        cls: `hl-view-btn ${view.viewMode === 'gallery' ? 'is-active' : ''}`,
        attr: { 'data-view': 'gallery', 'aria-label': t('manager.mode.default'), title: t('manager.mode.default') }
    });
    setIcon(galleryBtn, 'layout-grid');
    galleryBtn.onclick = () => {
        view.viewMode = 'gallery';
        view.render();
    };
    const listBtn = viewToggle.createEl('button', {
        cls: `hl-view-btn ${view.viewMode === 'list' ? 'is-active' : ''}`,
        attr: { 'data-view': 'list', 'aria-label': t('manager.mode.list'), title: t('manager.mode.list') }
    });
    setIcon(listBtn, 'list');
    listBtn.onclick = () => {
        view.viewMode = 'list';
        view.render();
    };

    // Batch tool: icon + selected-count badge while selecting
    const batchBtn = right.createEl('button', {
        cls: `hl-tool-btn hl-tool-batch ${view.batchMode ? 'is-active' : ''}`,
        attr: {
            'aria-label': view.batchMode ? t('manager.mode.exitBatch', { count: view.selectedNotes.size }) : t('manager.mode.batch'),
            title: view.batchMode ? t('manager.mode.exitBatch', { count: view.selectedNotes.size }) : t('manager.mode.batch'),
        }
    });
    setIcon(batchBtn, 'list-checks');
    if (view.batchMode && view.selectedNotes.size > 0) {
        batchBtn.createSpan({ cls: 'hl-tool-badge', text: String(view.selectedNotes.size) });
    }
    batchBtn.onclick = () => toggleBatchMode(view);

    return header;
}

// ============================================================
// 分组 (group by) control
// ============================================================

/** Built per call: labels must follow runtime language switches. */
function groupModes(): Array<{ id: StudioGroupBy; label: string; icon: string }> {
    return [
        { id: 'file', label: t('manager.group.file'), icon: 'file-text' },
        { id: 'tag', label: t('manager.group.tag'), icon: 'tag' },
        { id: 'color', label: t('manager.group.color'), icon: 'palette' },
        { id: 'date', label: t('manager.group.date'), icon: 'calendar' },
        { id: 'template', label: t('card.template'), icon: 'layout-template' },
    ];
}

function renderGroupControl(view: HighlightManagerView, wrap: HTMLElement): void {
    wrap.empty();
    const modes = groupModes();
    const current = modes.find(m => m.id === view.groupBy) ?? modes[0]!;

    const trigger = wrap.createDiv(`hl-group-trigger ${view.groupDropdownOpen ? 'is-open' : ''}`);
    setIcon(trigger.createSpan({ cls: 'hl-filter-trigger-icon' }), 'layers');
    trigger.createSpan({ cls: 'hl-filter-trigger-label', text: groupByLabel(view.groupBy) || current.label });
    setIcon(trigger.createSpan({ cls: 'hl-filter-trigger-chev' }), 'chevron-down');
    trigger.setAttribute('aria-label', t('manager.toolbar.groupBy'));
    trigger.onclick = (e) => {
        e.stopPropagation();
        view.groupDropdownOpen = !view.groupDropdownOpen;
        renderGroupControl(view, wrap);
    };

    if (view.groupDropdownOpen) {
        const menu = wrap.createDiv('hl-group-dropdown');
        const list = menu.createDiv('hl-filter-dropdown-list');
        modes.forEach(m => {
            const sel = m.id === view.groupBy;
            const row = list.createDiv(`hl-filter-row ${sel ? 'is-selected' : ''}`);
            setIcon(row.createSpan({ cls: 'hl-filter-row-check' }), m.icon);
            row.createSpan({ text: m.label, cls: 'hl-filter-row-label' });
            if (sel) setIcon(row.createSpan({ cls: 'hl-filter-row-tick' }), 'check');
            row.onclick = (ev) => {
                ev.stopPropagation();
                view.groupBy = m.id;
                view.selectedGroups.clear();  // filter keys are dimension-specific
                view.groupDropdownOpen = false;
                renderGroupControl(view, wrap);
                renderFilterControl(view, view.filterWrap!);  // facets follow the dimension
                refreshCollapseButton(view);                   // collapse state follows the dimension
                view.renderMainContent();
            };
        });
    }
}

// ============================================================
// 排序 (sort) control
// ============================================================

function renderSortControl(view: HighlightManagerView, wrap: HTMLElement): void {
    wrap.empty();
    const modes: Array<{ id: StudioSortBy; icon: string; label: string }> = [
        { id: 'source_order', icon: 'list-ordered', label: t('manager.sort.source_order.label') },
        { id: 'time_desc', icon: 'clock', label: t('manager.sort.time_desc.label') },
        { id: 'time_asc', icon: 'clock', label: t('manager.sort.time_asc.label') },
        { id: 'az', icon: 'arrow-down-a-z', label: t('manager.sort.az.label') },
        { id: 'za', icon: 'arrow-down-z-a', label: t('manager.sort.za.label') },
    ];
    const current = modes.find(m => m.id === view.sortBy) ?? modes[0]!;

    const trigger = wrap.createDiv(`hl-sort-trigger ${view.sortDropdownOpen ? 'is-open' : ''}`);
    setIcon(trigger.createSpan({ cls: 'hl-filter-trigger-icon' }), 'arrow-up-down');
    trigger.createSpan({ cls: 'hl-filter-trigger-label', text: current.label });
    setIcon(trigger.createSpan({ cls: 'hl-filter-trigger-chev' }), 'chevron-down');
    trigger.setAttribute('aria-label', t('manager.sort.label'));
    trigger.onclick = (e) => {
        e.stopPropagation();
        view.sortDropdownOpen = !view.sortDropdownOpen;
        renderSortControl(view, wrap);
    };

    if (view.sortDropdownOpen) {
        const menu = wrap.createDiv('hl-sort-dropdown');
        const list = menu.createDiv('hl-filter-dropdown-list');
        modes.forEach(m => {
            const sel = m.id === view.sortBy;
            const row = list.createDiv(`hl-sort-row ${sel ? 'is-selected' : ''}`);
            setIcon(row.createSpan({ cls: 'hl-filter-row-check' }), m.icon);
            row.createSpan({ text: m.label, cls: 'hl-filter-row-label' });
            if (sel) setIcon(row.createSpan({ cls: 'hl-filter-row-tick' }), 'check');
            row.onclick = (ev) => {
                ev.stopPropagation();
                view.sortBy = m.id;
                view.sortDropdownOpen = false;
                renderSortControl(view, wrap);
                view.renderMainContent();
            };
        });
    }
}

// ============================================================
// 筛选 (filter) control — facets of the active dimension
// ============================================================

function renderFilterControl(view: HighlightManagerView, wrap: HTMLElement): void {
    wrap.empty();
    const items = collectFilterItems(view.highlights, view.groupBy, getColors(view.plugin.settings));
    if (items.length === 0) return;

    const dimLabel = groupByLabel(view.groupBy);
    const selCount = view.selectedGroups.size;

    const trigger = wrap.createDiv(`hl-filter-trigger ${selCount > 0 ? 'has-selection' : ''} ${view.filterDropdownOpen ? 'is-open' : ''}`);
    setIcon(trigger.createSpan({ cls: 'hl-filter-trigger-icon' }), 'funnel');
    trigger.createSpan({
        cls: 'hl-filter-trigger-label',
        text: selCount > 0 ? `${dimLabel} · ${selCount}` : dimLabel
    });
    setIcon(trigger.createSpan({ cls: 'hl-filter-trigger-chev' }), 'chevron-down');
    trigger.setAttribute('aria-label', t('manager.filter.trigger', { dim: dimLabel }));
    trigger.onclick = (e) => {
        e.stopPropagation();
        view.filterDropdownOpen = !view.filterDropdownOpen;
        renderFilterControl(view, wrap);  // gallery unchanged; just toggle the menu
    };

    if (view.filterDropdownOpen) {
        const menu = wrap.createDiv('hl-filter-dropdown');

        if (selCount > 0) {
            const clearRow = menu.createDiv({ cls: 'hl-filter-clear-row', text: t('manager.filter.clear') });
            clearRow.onclick = (ev) => {
                ev.stopPropagation();
                view.selectedGroups.clear();
                renderFilterControl(view, wrap);
                view.renderMainContent();
            };
        }

        const list = menu.createDiv('hl-filter-dropdown-list');
        items.forEach(it => {
            const sel = view.selectedGroups.has(it.key);
            const row = list.createDiv(`hl-filter-row ${sel ? 'is-selected' : ''}`);
            if (it.color) row.createSpan({ cls: 'hl-filter-row-dot', attr: { style: `background:${it.color}` } });
            const check = row.createSpan({ cls: 'hl-filter-row-check' });
            setIcon(check, sel ? 'check' : '');
            row.createSpan({ text: it.label, cls: 'hl-filter-row-label' });
            row.createSpan({ text: String(it.count), cls: 'hl-filter-row-count' });
            row.onclick = (ev) => {
                ev.stopPropagation();
                if (sel) view.selectedGroups.delete(it.key);
                else view.selectedGroups.add(it.key);
                renderFilterControl(view, wrap);  // update check marks
                view.renderMainContent();          // refilter the gallery
            };
        });
    }
}

// ============================================================
// 复习 (review) control — click-to-expand menu
// ============================================================

function renderReviewControl(view: HighlightManagerView, wrap: HTMLElement): void {
    wrap.empty();
    const inSession = view.reviewSession.active;
    const due = dueCount(view.highlights);
    const fresh = newCount(view.highlights);

    const btn = wrap.createEl('button', {
        cls: `hl-tool-btn hl-tool-review ${inSession ? 'is-active' : ''}`,
        attr: { 'aria-label': t('manager.mode.review'), title: t('manager.mode.review') }
    });
    setIcon(btn, 'graduation-cap');
    // Due-count badge
    if (due > 0) {
        btn.createSpan({ cls: 'hl-tool-badge', text: String(due), attr: { 'aria-label': t('fsrs.dueBadge') } });
    }
    btn.createSpan({ text: t('manager.mode.review'), cls: 'hl-studio-review-label' });
    btn.onclick = (e) => {
        e.stopPropagation();
        if (inSession) {
            // Rating without a due queue is meaningless; restart a due session
            startFsrsSession(view, 'due');
            return;
        }
        view.reviewMenuOpen = !view.reviewMenuOpen;
        renderReviewControl(view, wrap);
    };

    if (view.reviewMenuOpen && !inSession) {
        const menu = wrap.createDiv('hl-review-menu');

        const startItem = menu.createDiv(`hl-review-menu-item ${due > 0 ? '' : 'is-disabled'}`);
        setIcon(startItem.createSpan({ cls: 'hl-review-menu-icon' }), 'graduation-cap');
        startItem.createSpan({
            cls: 'hl-review-menu-label',
            text: due > 0 ? t('fsrs.startDue', { count: due }) : t('fsrs.noDue'),
        });
        if (due > 0) {
            startItem.onclick = (ev) => {
                ev.stopPropagation();
                view.reviewMenuOpen = false;
                startFsrsSession(view, 'due');
            };
        }

        const newItem = menu.createDiv(`hl-review-menu-item ${fresh > 0 ? '' : 'is-disabled'}`);
        setIcon(newItem.createSpan({ cls: 'hl-review-menu-icon' }), 'sprout');
        newItem.createSpan({
            cls: 'hl-review-menu-label',
            text: fresh > 0 ? t('fsrs.startNew', { count: fresh }) : t('fsrs.noNew'),
        });
        if (fresh > 0) {
            newItem.onclick = (ev) => {
                ev.stopPropagation();
                view.reviewMenuOpen = false;
                startFsrsSession(view, 'new');
            };
        }

        const settingsItem = menu.createDiv('hl-review-menu-item');
        setIcon(settingsItem.createSpan({ cls: 'hl-review-menu-icon' }), 'settings-2');
        settingsItem.createSpan({ cls: 'hl-review-menu-label', text: t('fsrs.settingsEntry') });
        settingsItem.onclick = (ev) => {
            ev.stopPropagation();
            view.reviewMenuOpen = false;
            openPluginSettings(view);
        };
    }
}

function openPluginSettings(view: HighlightManagerView): void {
    try {
        // app.setting is not in the public typings but is stable plugin API surface.
        const setting = (view.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
        if (!setting) return;
        setting.open();
        setting.openTabById('hilighter');
    } catch {
        // Older builds: fall back to the generic settings shortcut
    }
}
