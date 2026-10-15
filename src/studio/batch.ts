// ============================================================
// HiLighter - Studio batch selection operations
// ============================================================

import { Notice } from 'obsidian';
import { db } from '../db';
import { t } from '../i18n';
import { removeHighlightFromVault, refreshSidebarViews } from './actions';
import { BatchTagModal } from './modals';
import type { HighlightManagerView } from './studio-view';

export function toggleBatchMode(view: HighlightManagerView): void {
    view.batchMode = !view.batchMode;
    if (!view.batchMode) view.selectedNotes.clear();
    view.render();
}

export async function handleBatchDelete(view: HighlightManagerView): Promise<void> {
    if (view.selectedNotes.size === 0) return;
    // eslint-disable-next-line no-alert -- matches the plugin's existing confirm() UX
    if (!confirm(t('manager.confirm.batchDelete', { count: view.selectedNotes.size }))) return;

    const ids = Array.from(view.selectedNotes);
    for (const id of ids) {
        const note = view.highlights.find(h => h.id === id);
        if (note) await removeHighlightFromVault(view.app, note);
        await db.deleteHighlightNote(id);
    }
    new Notice(t('manager.notice.batchDeleted', { count: ids.length }));
    view.selectedNotes.clear();
    await view.loadHighlights();
    view.render();
    refreshSidebarViews(view.app);
}

export function handleBatchTag(view: HighlightManagerView): void {
    if (view.selectedNotes.size === 0) {
        new Notice(t('manager.notice.selectFirst'));
        return;
    }
    new BatchTagModal(view.app, (tag: string) => {
        void (async () => {
            if (!tag.trim()) return;
            const cleanTag = tag.replace(/^#/, '').trim();
            let successCount = 0;
            const ids = Array.from(view.selectedNotes);
            for (const id of ids) {
                const note = view.highlights.find(h => h.id === id);
                if (!note) continue;
                if (note.tags && note.tags.includes(cleanTag)) continue;
                try {
                    const newTags = [...(note.tags || []), cleanTag];
                    await db.updateHighlightNote(note.id, { tags: newTags });
                    note.tags = newTags;
                    successCount++;
                } catch {
                    // Skip failures; report the summary below.
                }
            }
            new Notice(t('manager.notice.batchTagAdded', { count: successCount, tag: cleanTag }));
            view.render();
        })();
    }).open();
}
