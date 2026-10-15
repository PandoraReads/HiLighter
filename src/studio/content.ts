// ============================================================
// HiLighter - Studio gallery / list content body
// ============================================================

import { setIcon, Notice } from 'obsidian';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { getColors } from '../colors';
import { db } from '../db';
import { deckGroups, planGroupDrop, dropEnabled } from './grouping';
import type { NoteGroup } from './studio-state';
import type { DropPlan } from './grouping';
import { buildToolbar } from './toolbar';
import { renderStatsPanel } from './stats';
import { handleBatchDelete, handleBatchTag } from './batch';
import { togglePin, refreshSidebarViews, changeNoteColor } from './actions';
import { HighlightDetailModal } from './modals';
import type { HighlightManagerView } from './studio-view';

/** Renders the toolbar + body into the content pane (persistent header, rebuildable body). */
export function renderMainContent(view: HighlightManagerView, parentProp?: HTMLElement): void {
    const parent = parentProp || view.contentEl.querySelector('.hl-studio-content') as HTMLElement;
    if (!parent) return;

    // Gallery/list mode: fixed header + independently-scrolling body (flex column),
    // so cards can never scroll over the toolbar.
    parent.addClass('is-gallery-mode');

    // Persistent header (built once per content mount so the search keeps focus)
    let header = parent.querySelector('.hl-studio-content-header') as HTMLElement;
    if (!header) {
        parent.empty();
        header = buildToolbar(view, parent);
    }

    // Rebuildable body
    let body = parent.querySelector('.hl-studio-content-body') as HTMLElement;
    if (!body) body = parent.createDiv('hl-studio-content-body');
    body.empty();

    // Stats panel expands over the grouped body while the toolbar stays mounted
    if (view.statsOpen) {
        renderStatsPanel(view, body);
        return;
    }

    const groups = deckGroups(view);

    if (view.batchMode && view.selectedNotes.size > 0) {
        const batchActions = body.createDiv('hl-studio-batch-actions-float');

        const batchDel = batchActions.createEl('button', { cls: 'hl-studio-mini-btn is-danger', text: t('manager.mode.deleteSelected') });
        setIcon(batchDel, 'trash-2');
        batchDel.onclick = () => handleBatchDelete(view);

        const batchTag = batchActions.createEl('button', { cls: 'hl-studio-mini-btn', text: t('manager.mode.addTag') });
        setIcon(batchTag, 'tag');
        batchTag.onclick = () => handleBatchTag(view);
    }

    if (groups.length === 0) {
        body.createEl('div', { text: t('manager.content.empty'), cls: 'hl-studio-empty-content' });
        return;
    }

    renderGroupedContent(view, body, groups);
}

function renderGroupedContent(view: HighlightManagerView, parent: HTMLElement, groups: NoteGroup[]): void {
    const wrap = parent.createDiv('hl-studio-groups');
    const droppable = dropEnabled(view.groupBy);

    groups.forEach(g => {
        const section = wrap.createDiv('hl-studio-group');
        const header = section.createDiv('hl-studio-group-header');
        const chevron = header.createDiv('hl-studio-group-chevron');
        setIcon(chevron, view.collapsedGroups.has(g.key) ? 'chevron-right' : 'chevron-down');
        header.createDiv({ text: g.name, cls: 'hl-studio-group-name' });
        header.createDiv({ text: String(g.items.length), cls: 'hl-studio-group-count' });

        // Drag-and-drop target: drop a card here to change its group attribute
        if (droppable) wireDropTarget(view, section, g.key);

        if (!view.collapsedGroups.has(g.key)) {
            const groupBody = section.createDiv('hl-studio-group-body');
            if (view.viewMode === 'list') {
                const list = groupBody.createDiv('hl-studio-list');
                g.items.forEach(h => renderListRow(view, list, h));
            } else {
                const grid = groupBody.createDiv('hl-studio-grid');
                g.items.forEach(h => renderStudioCard(view, grid, h));
            }
        }

        header.onclick = () => {
            if (view.collapsedGroups.has(g.key)) view.collapsedGroups.delete(g.key);
            else view.collapsedGroups.add(g.key);
            view.render();
        };
    });
}

// ============================================================
// Drag cards between groups → attribute changes
// ============================================================

const DRAG_MIME = 'text/x-hl-note-id';

function wireDragSource(el: HTMLElement, note: HighlightNote): void {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(DRAG_MIME, note.id);
        e.dataTransfer.setData('text/plain', note.id);   // fallback
        e.dataTransfer.effectAllowed = 'move';
        el.addClass('is-dragging');
    });
    el.addEventListener('dragend', () => el.removeClass('is-dragging'));
}

function wireDropTarget(view: HighlightManagerView, section: HTMLElement, groupKey: string): void {
    section.addEventListener('dragover', (e) => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        section.addClass('is-drop-target');
    });
    section.addEventListener('dragleave', (e) => {
        if (!section.contains(e.relatedTarget as Node)) section.removeClass('is-drop-target');
    });
    section.addEventListener('drop', (e) => {
        e.preventDefault();
        section.removeClass('is-drop-target');
        const id = e.dataTransfer?.getData(DRAG_MIME) || e.dataTransfer?.getData('text/plain');
        if (!id) return;
        const note = view.highlights.find(h => h.id === id);
        if (!note) return;
        void applyDropPlan(view, note, planGroupDrop(view.groupBy, groupKey, note));
    });
}

/** Applies a planned attribute change and refreshes every surface. */
async function applyDropPlan(view: HighlightManagerView, note: HighlightNote, plan: DropPlan): Promise<void> {
    try {
        switch (plan.type) {
            case 'color': {
                const changed = await changeNoteColor(view.app, view.plugin.settings, note, plan.color);
                if (changed) {
                    const label = getColors(view.plugin.settings).find(c => c.id === plan.color)?.label ?? plan.color;
                    new Notice(t('drop.colorChanged', { color: label }));
                }
                break;
            }
            case 'addTag': {
                const newTags = [...(note.tags || []), plan.tag];
                await dbUpdateTags(view, note, newTags);
                new Notice(t('manager.notice.tagAdded', { tag: plan.tag }));
                break;
            }
            case 'clearTags': {
                await dbUpdateTags(view, note, []);
                new Notice(t('drop.tagsCleared'));
                break;
            }
            case 'noop':
                return;   // dropped back into its own group
            case 'unsupported':
                new Notice(t('drop.unsupported'));
                return;
        }
        await view.loadHighlights();
        view.render();
        refreshSidebarViews(view.app);
    } catch {
        new Notice(t('drop.failed'));
    }
}

async function dbUpdateTags(view: HighlightManagerView, note: HighlightNote, tags: string[]): Promise<void> {
    await db.updateHighlightNote(note.id, { tags });
    note.tags = tags;
}

function openDetail(view: HighlightManagerView, note: HighlightNote): void {
    new HighlightDetailModal(view.app, note, () => {
        void (async () => {
            await view.loadHighlights();
            view.render();
            refreshSidebarViews(view.app);
        })();
    }).open();
}
function toggleSelection(view: HighlightManagerView, note: HighlightNote): void {
    if (view.selectedNotes.has(note.id)) view.selectedNotes.delete(note.id);
    else view.selectedNotes.add(note.id);
    view.render();
}

function renderStudioCard(view: HighlightManagerView, parent: HTMLElement, note: HighlightNote): void {
    const card = parent.createDiv(`hl-studio-card border-${note.color}`);

    // Drag to another group to change its color / tags (dimension-dependent)
    if (dropEnabled(view.groupBy)) wireDragSource(card, note);

    // Click Handler (Click to Detail Modal)
    card.onclick = (e) => {
        e.stopPropagation();
        if (view.batchMode) {
            toggleSelection(view, note);
            return;
        }
        openDetail(view, note);
    };

    if (view.selectedNotes.has(note.id)) card.addClass('is-selected');
    if ((note.pinned || 0) > 0) card.addClass('is-pinned');

    // Pin toggle (top-right corner)
    const pinBtn = card.createDiv('hl-studio-card-pin');
    setIcon(pinBtn, 'pin');
    pinBtn.toggleClass('is-on', (note.pinned || 0) > 0);
    pinBtn.setAttribute('aria-label', t('manager.pin'));
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        void togglePin(view, note);
    };

    // Header (Highlight Text) - Strictly text-only
    const header = card.createDiv('card-header');
    const highlightText = header.createDiv('highlight-text');
    highlightText.textContent = note.text;
}

function renderListRow(view: HighlightManagerView, parent: HTMLElement, note: HighlightNote): void {
    const row = parent.createDiv(`hl-list-row color-${note.color}`);

    // Drag to another group to change its color / tags (dimension-dependent)
    if (dropEnabled(view.groupBy)) wireDragSource(row, note);

    const dot = row.createDiv('hl-list-dot');
    dot.setAttribute('aria-hidden', 'true');

    const body = row.createDiv('hl-list-body');
    const textEl = body.createDiv({ cls: 'hl-list-text' });
    textEl.textContent = note.text;

    const meta = row.createDiv('hl-list-meta');
    const filename = note.sourcePath.split('/').pop()?.replace('.md', '') || '';
    meta.createSpan({ text: filename, cls: 'hl-list-src' });
    meta.createSpan({ text: new Date(note.createdAt).toLocaleDateString(), cls: 'hl-list-date' });

    if (view.selectedNotes.has(note.id)) row.addClass('is-selected');
    if ((note.pinned || 0) > 0) row.addClass('is-pinned');

    const pinBtn = row.createDiv('hl-list-pin');
    setIcon(pinBtn, 'pin');
    pinBtn.toggleClass('is-on', (note.pinned || 0) > 0);
    pinBtn.setAttribute('aria-label', t('manager.pin'));
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        void togglePin(view, note);
    };

    row.onclick = (e) => {
        e.stopPropagation();
        if (view.batchMode) {
            toggleSelection(view, note);
            return;
        }
        openDetail(view, note);
    };
}
