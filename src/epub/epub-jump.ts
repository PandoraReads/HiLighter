// ============================================================
// HiLighter - EPUB jump dispatch (sidebar / studio -> book at CFI)
// ============================================================

import { App, Notice } from 'obsidian';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { openEpubRegistry } from './registry';

/** Reveals the book (opening it if needed) and displays the note's CFI. */
export async function jumpToEpubNote(app: App, note: HighlightNote): Promise<void> {
    const existing = openEpubRegistry().get(note.sourcePath);
    if (existing) {
        void app.workspace.revealLeaf(existing.leaf);
        if (note.cfi) await existing.gotoCfi(note.cfi);
        return;
    }

    await app.workspace.openLinkText(note.sourcePath, '', false);

    // The view loads asynchronously; poll the registry briefly.
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const view = openEpubRegistry().get(note.sourcePath);
        if (view) {
            void app.workspace.revealLeaf(view.leaf);
            if (note.cfi) await view.gotoCfi(note.cfi);
            return;
        }
    }
    new Notice(t('epub.openError'));
}
