// ============================================================
// HiLighter - Bookshelf move books (批量移动 / 移动到…)
// ============================================================
// Moves book files to a target folder via Obsidian's own rename
// (which also updates links and fires the global rename hook that
// migrates highlight source paths). The pure half re-keys every
// path-addressed setting that does NOT ride the rename event:
// tags, book metadata, favorites and their sync tombstones. The
// tombstones matter: without them the next sync merge would
// resurrect the old-path entries from the other device.

import { Notice, TFile, TFolder } from 'obsidian';
import { t } from '../i18n';
import type { BookMeta, SyncTombstone } from '../models';
import { normalizeBookMetaMap } from './book-meta';
import type { BookTagMap } from './book-tags';
import { withBookMetaDeletion, withoutBookMetaDeletion, withFavoriteDeletion, withoutFavoriteDeletion, withTagDeletion, withoutTagDeletion } from '../sync/shelf-collections';
import { FolderPickerModal } from './folder-picker';
import type { GridHost } from './book-card';

/** One successful file move (old vault path -> new vault path). */
export interface BookMovePair {
	from: string;
	to: string;
}

/** Path-addressed collections affected by a move, plus their tombstones. */
export interface BookMoveCollections {
	tags: BookTagMap;
	bookMeta: Record<string, BookMeta>;
	favorites: string[];
	tagTombstones: SyncTombstone[];
	bookMetaTombstones: SyncTombstone[];
	favoriteTombstones: SyncTombstone[];
}

/** Result of a batch move: per-file counts for the notice. */
export interface BookMoveResult {
	/** Files whose path actually changed. */
	moved: number;
	/** Files that could not move (name clash in the target, I/O error). */
	failed: number;
	/** Files already sitting in the target folder (no-op). */
	skipped: number;
}

/**
 * Re-keys tags / book metadata / favorites for the given moves and
 * records the matching tombstones so a later sync merge suppresses
 * the old-path entries on other devices instead of resurrecting
 * them, and clears any stale tombstone that would suppress the new
 * path. Returns fresh objects; the input is never mutated.
 */
export function remapBookKeys(
	collections: BookMoveCollections,
	moves: BookMovePair[],
	now: number,
): BookMoveCollections {
	let { tags, bookMeta, favorites } = collections;
	let { tagTombstones, bookMetaTombstones, favoriteTombstones } = collections;

	for (const { from, to } of moves) {
		if (!from || !to || from === to) continue;

		// Tags: union into the new path, drop the old entry, tombstone
		// every old (path, tag) pair and un-tombstone the new ones.
		const oldTags = tags[from];
		if (oldTags) {
			const merged = [...new Set([...(tags[to] ?? []), ...oldTags])];
			const nextTags: BookTagMap = { ...tags, [to]: merged };
			delete nextTags[from];
			tags = nextTags;
			for (const tag of oldTags) {
				tagTombstones = withTagDeletion(tagTombstones, from, tag, now);
			}
			for (const tag of merged) {
				tagTombstones = withoutTagDeletion(tagTombstones, to, tag);
			}
		}

		// Book metadata follows the live book (a leftover entry at the
		// target path belongs to a book that is no longer there).
		const oldMeta = bookMeta[from];
		if (oldMeta) {
			const nextMeta = { ...bookMeta, [to]: oldMeta };
			delete nextMeta[from];
			bookMeta = nextMeta;
			bookMetaTombstones = withBookMetaDeletion(bookMetaTombstones, from, now);
			bookMetaTombstones = withoutBookMetaDeletion(bookMetaTombstones, to);
		}

		// Favorites: swap the path, tombstone old / clear new.
		if (favorites.includes(from)) {
			favorites = [...new Set([...favorites.filter(p => p !== from), to])];
			favoriteTombstones = withFavoriteDeletion(favoriteTombstones, from, now);
			favoriteTombstones = withoutFavoriteDeletion(favoriteTombstones, to);
		}
	}

	return { tags, bookMeta, favorites, tagTombstones, bookMetaTombstones, favoriteTombstones };
}

/** Target vault path for `file` inside `folder` (root = top level). */
export function moveTargetPath(folder: TFolder, file: TFile): string {
	return folder.isRoot() ? file.name : `${folder.path}/${file.name}`;
}

/**
 * Moves the given files into `folder`: Obsidian rename per file (name
 * clashes never overwrite), then re-keys tags / metadata / favorites
 * and cover cache entries, persists settings and reports via notice.
 * The `onDone` callback runs once at the end (selection cleanup /
 * page refresh); the shelf view also refreshes itself through the
 * vault rename events.
 */
export async function moveBooksToFolder(
	host: GridHost,
	files: TFile[],
	folder: TFolder,
	onDone: () => void,
): Promise<BookMoveResult> {
	const plugin = host.plugin;
	const moves: BookMovePair[] = [];
	let failed = 0;
	let skipped = 0;

	for (const file of files) {
		const target = moveTargetPath(folder, file);
		if (target === file.path) {
			skipped++;
			continue;
		}
		// Never overwrite an existing book; report it as failed instead.
		if (host.app.vault.getAbstractFileByPath(target)) {
			failed++;
			continue;
		}
		try {
			await host.app.fileManager.renameFile(file, target);
			moves.push({ from: file.path, to: target });
		} catch (err) {
			console.error('[HiLighter] bookshelf move failed:', file.path, '->', target, err);
			failed++;
		}
	}

	if (moves.length > 0) {
		const settings = plugin.settings;
		const now = Date.now();
		const remapped = remapBookKeys(
			{
				tags: settings.bookshelfTags ?? {},
				bookMeta: normalizeBookMetaMap(settings.bookshelfBookMeta),
				favorites: settings.bookshelfFavorites ?? [],
				tagTombstones: settings.tagTombstones ?? [],
				bookMetaTombstones: settings.bookMetaTombstones ?? [],
				favoriteTombstones: settings.favoriteTombstones ?? [],
			},
			moves,
			now,
		);
		settings.bookshelfTags = remapped.tags;
		settings.bookshelfBookMeta = remapped.bookMeta;
		settings.bookshelfFavorites = remapped.favorites;
		settings.tagTombstones = remapped.tagTombstones;
		settings.bookMetaTombstones = remapped.bookMetaTombstones;
		settings.favoriteTombstones = remapped.favoriteTombstones;
		await plugin.saveSettings();

		// Cover cache entries are keyed by path; a move keeps the mtime,
		// so re-keying preserves the cover without re-extracting it.
		try {
			const store = plugin.coverStore();
			await store.ready();
			for (const { from, to } of moves) store.rekey(from, to);
		} catch (err) {
			console.error('[HiLighter] cover rekey after move failed:', err);
		}

		if (failed > 0) {
			new Notice(t('bookshelf.move.partial', { moved: moves.length, failed }));
		} else {
			new Notice(t('bookshelf.move.moved', { count: moves.length }));
		}
	} else if (failed > 0) {
		new Notice(t('bookshelf.move.failedAll', { count: failed }));
	} else if (skipped > 0) {
		new Notice(t('bookshelf.move.none'));
	}

	onDone();
	return { moved: moves.length, failed, skipped };
}

/** Opens the folder picker, then moves the books into the choice. */
export function moveBooksViaPicker(
	host: GridHost,
	files: TFile[],
	onDone: () => void,
): void {
	new FolderPickerModal(host.app, (folder) => {
		void moveBooksToFolder(host, files, folder, onDone);
	}).open();
}
