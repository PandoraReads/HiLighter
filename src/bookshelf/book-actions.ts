// ============================================================
// HiLighter - Book actions (progress I/O, card menu, delete)
// ============================================================
// Settings-facing operations behind the per-book metadata feature:
// writing reading progress + the daily activity log, the quick
// "mark finished" action, the card context menu (right-click /
// long-press) and single-book deletion with metadata cleanup. Pure
// derivation lives in book-meta.ts; this module owns the I/O.

import { Menu, Notice, TFile } from 'obsidian';
import { t } from '../i18n';
import { dayKey } from '../studio/grouping';
import {
    applyProgressTo,
    bumpReadingDay,
    normalizeBookMetaMap,
    normalizeReadingDays,
} from './book-meta';
import { removeTagPaths } from './book-tags';
import { withBookMetaDeletion } from '../sync/shelf-collections';
import { ConfirmModal } from '../ui/confirm-modal';
import type { GridHost } from './book-card';
import type HiLighterPlugin from '../main';

/**
 * Writes a new reading progress (0-100) plus the reading-day log for
 * one book. Mutates only the settings fields (via immutable updates);
 * saving is the caller's job so it can batch it with its own writes.
 */
export function writeBookProgress(
    plugin: HiLighterPlugin,
    path: string,
    percent: number,
    now: number = Date.now(),
): void {
    const settings = plugin.settings;
    settings.bookshelfBookMeta = applyProgressTo(
        normalizeBookMetaMap(settings.bookshelfBookMeta),
        path,
        percent,
        now,
    );
    const bump = bumpReadingDay(
        normalizeReadingDays(settings.bookshelfReadingDays),
        dayKey(new Date(now)),
        path,
        plugin.readingDayCounted,
    );
    plugin.readingDayCounted = bump.counted;
    settings.bookshelfReadingDays = bump.days;
}

/** Quick action: mark a book 100% read (today) and persist. */
export async function markBookFinished(
    plugin: HiLighterPlugin,
    file: TFile,
    onChange?: () => void,
): Promise<void> {
    writeBookProgress(plugin, file.path, 100);
    await plugin.saveSettings();
    onChange?.();
}

/** Actions the card context menu needs from its host page. */
export interface BookMenuActions {
    /** Opens the metadata editor modal. */
    onEditMeta: (file: TFile) => void;
    /** Refresh hook after destructive actions (delete). */
    onChanged: () => void;
    /** Heart state for the favorite menu item (both grid pages supply it). */
    favorites?: {
        isFavorite: (path: string) => boolean;
        onToggle: (path: string) => void;
    };
}

/**
 * Card context menu (desktop right-click, mobile long-press where the
 * webview fires contextmenu): edit metadata, mark finished, toggle
 * favorite, delete the book file.
 */
export function openBookMenu(
    host: GridHost,
    file: TFile,
    event: MouseEvent,
    actions: BookMenuActions,
): void {
    const menu = new Menu();
    menu.addItem(item => item
        .setTitle(t('bookshelf.meta.edit'))
        .setIcon('info')
        .onClick(() => actions.onEditMeta(file)));
    menu.addItem(item => item
        .setTitle(t('bookshelf.meta.markFinished'))
        .setIcon('check-circle-2')
        .onClick(() => { void markBookFinished(host.plugin, file, actions.onChanged); }));
    if (actions.favorites) {
        const isFavorite = actions.favorites.isFavorite(file.path);
        menu.addItem(item => item
            .setTitle(t(isFavorite ? 'bookshelf.favRemove' : 'bookshelf.favAdd'))
            .setIcon('heart')
            .onClick(() => actions.favorites!.onToggle(file.path)));
    }
    menu.addSeparator();
    menu.addItem(item => item
        .setTitle(t('bookshelf.meta.delete'))
        .setIcon('trash-2')
        .onClick(() => deleteBook(host, file, actions.onChanged)));
    menu.showAtMouseEvent(event);
}

/**
 * Deletes one book: file to the system trash, then its tags and
 * metadata (with a tombstone so sync does not resurrect either).
 */
export function deleteBook(host: GridHost, file: TFile, onChanged: () => void): void {
    const plugin = host.plugin;
    new ConfirmModal(
        host.app,
        t('bookshelf.meta.deleteConfirm', { name: file.basename }),
        async () => {
            try {
                await host.app.fileManager.trashFile(file);
            } catch (err) {
                console.error('[HiLighter] bookshelf delete failed:', file.path, err);
                new Notice(t('notice.deleteFailed'));
                return;
            }
            plugin.settings.bookshelfTags = removeTagPaths(
                plugin.settings.bookshelfTags ?? {},
                [file.path],
            );
            const meta = normalizeBookMetaMap(plugin.settings.bookshelfBookMeta);
            if (meta[file.path]) {
                const { [file.path]: _removed, ...rest } = meta;
                plugin.settings.bookshelfBookMeta = rest;
                plugin.settings.bookMetaTombstones = withBookMetaDeletion(
                    plugin.settings.bookMetaTombstones,
                    file.path,
                    Date.now(),
                );
            }
            await plugin.saveSettings();
            new Notice(t('bookshelf.library.deleted', { count: 1 }));
            onChanged();
        },
        { warning: true, confirmText: t('bookshelf.meta.delete') },
    ).open();
}
