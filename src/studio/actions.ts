// ============================================================
// HiLighter - Studio shared card actions
// ============================================================

import { TFile, Notice, MarkdownView, Platform, App } from 'obsidian';
import { db } from '../db';
import type { HiLighterSettings, HighlightNote } from '../models';
import { t } from '../i18n';
import { getColorDef } from '../colors';
import { HIGHLIGHT_VIEW_TYPE } from '../view-types';
import { locateHighlightMark } from '../locate';
import type { HighlightView } from '../highlight-view';
import type { HighlightManagerView } from './studio-view';

/** Re-render every open sidebar HighlightView (desktop immediate / mobile buffered). */
export function refreshSidebarViews(app: App): void {
    app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view.getViewType() === HIGHLIGHT_VIEW_TYPE) {
            const view = leaf.view as unknown as HighlightView;
            // Add a small buffer on mobile to ensure DB writes are finished
            if (Platform.isMobile) {
                void new Promise<void>((resolve) => {
                    window.setTimeout(() => {
                        void view.render();
                        resolve();
                    }, 150);
                });
            } else {
                void view.render();
            }
        }
    });
}

/**
 * Changes a note's color everywhere it lives: the hl-h-{id} class and
 * data-hl-color hex inside the source <mark> (markdown anchors only),
 * plus the DB record (which drives card borders and filtering).
 * Returns false when the color was already the target.
 */
export async function changeNoteColor(
    app: App,
    settings: HiLighterSettings,
    note: HighlightNote,
    newColor: string,
): Promise<boolean> {
    if (note.color === newColor) return false;

    if (note.sourcePath.toLowerCase().endsWith('.md')) {
        try {
            const file = app.vault.getAbstractFileByPath(note.sourcePath);
            if (file instanceof TFile) {
                const content = await app.vault.read(file);
                const escapedId = note.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const newHex = getColorDef(settings, newColor)?.hex ?? '#ffd700';
                // Match this highlight's <mark> opening tag by its unique data-id,
                // then swap the hl-h-{color} class + data-hl-color hex inside it.
                const tagRe = new RegExp(`<mark\\b[^>]*\\bdata-id="${escapedId}"[^>]*>`);
                const updated = content.replace(tagRe, (tag) =>
                    tag
                        .replace(/\bhl-h-[A-Za-z0-9_-]+\b/, `hl-h-${newColor}`)
                        .replace(/\bdata-hl-color="[^"]*"/, `data-hl-color="${newHex}"`)
                );
                if (updated !== content) {
                    await app.vault.modify(file, updated);
                }
            }
        } catch {
            // Best-effort file sync; the DB record below is the source of truth.
        }
    }

    const def = getColorDef(settings, newColor);
    const changes: Partial<HighlightNote> = {
        color: newColor,
        colorHex: def?.isCustom ? def.hex : undefined,
    };
    await db.updateHighlightNote(note.id, changes);
    note.color = newColor;
    note.colorHex = changes.colorHex;
    // PDF overlay picks this up via db.onChange (mark colors re-applied).
    return true;
}

export async function togglePin(view: HighlightManagerView, note: HighlightNote): Promise<void> {
    const isPinned = (note.pinned || 0) > 0;
    const newPinned = isPinned ? 0 : Date.now();
    await db.updateHighlightNote(note.id, { pinned: newPinned });
    note.pinned = newPinned;
    await view.loadHighlights();
    view.render();
    new Notice(isPinned ? t('manager.notice.unpinned') : t('manager.notice.pinned'));
    refreshSidebarViews(view.app);
}

export async function addTagToNote(view: HighlightManagerView, note: HighlightNote, newTag: string): Promise<void> {
    try {
        if (note.tags && note.tags.includes(newTag)) {
            new Notice(t('manager.notice.tagExists', { tag: newTag }));
            return;
        }

        const newTags = [...(note.tags || []), newTag];
        await db.updateHighlightNote(note.id, { tags: newTags });
        note.tags = newTags;

        new Notice(t('manager.notice.tagAdded', { tag: newTag }));
        view.render();
    } catch {
        new Notice(t('manager.notice.tagAddFailed'));
    }
}

/** Unwraps the <mark data-id> from the source markdown file (markdown
 *  anchors only — PDF/EPUB/reading-mode notes have no file mark). */
export async function removeHighlightFromVault(app: App, note: HighlightNote): Promise<void> {
    try {
        if (!note.sourcePath.toLowerCase().endsWith('.md')) return;
        const file = app.vault.getAbstractFileByPath(note.sourcePath);
        if (!(file instanceof TFile)) return;
        const content = await app.vault.read(file);
        const regex = new RegExp(`<mark[^>]*data-id="${note.id}"[^>]*>(.*?)<\\/mark>`, 'g');
        const newContent = content.replace(regex, '$1');
        if (content !== newContent) await app.vault.modify(file, newContent);
    } catch {
        // Best-effort: the DB record is removed regardless.
    }
}

/** Opens the source file and scrolls to the anchored sentence. */
export async function jumpToSource(app: App, note: HighlightNote): Promise<void> {
    await app.workspace.openLinkText(note.sourcePath, '', false);
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.editor) {
        locateHighlightMark(view.editor, note.id, note.lineIndex ?? 0);
    }
}
