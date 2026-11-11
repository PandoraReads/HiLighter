// ============================================================
// HiLighter - Bookshelf 近期阅读 page
// ============================================================
// Files that recently received highlights (markdown / pdf / epub),
// aggregated from the highlight database, with a sort + format
// filter toolbar.

import { TFile } from 'obsidian';
import { t } from '../i18n';
import type { HighlightNote, ShelfFormatFilter, ShelfRecentSortBy } from '../models';
import { renderBookGrid, relativeTime, type BookEntry, type GridHost } from './book-card';
import type { ShelfCoverCache } from './covers';
import { shelfKind, type ShelfKind } from './scope';
import { appendFormatFilter, appendRecentSort } from './shelf-toolbar';

/** Aggregated reading activity for one source file. */
export interface RecentSource {
	path: string;
	count: number;
	lastAt: number;
}

/**
 * Groups source-anchored highlights by file, keeping the newest
 * timestamp per file. Idea cards are excluded: they are authored, not
 * reading activity.
 */
export function computeRecentSources(notes: HighlightNote[], limit = 60): RecentSource[] {
	const byPath = new Map<string, RecentSource>();
	for (const note of notes) {
		const path = note.sourcePath || '';
		if (!path || note.kind === 'idea') continue;
		const current = byPath.get(path);
		if (current) {
			byPath.set(path, {
				path,
				count: current.count + 1,
				lastAt: Math.max(current.lastAt, note.createdAt),
			});
		} else {
			byPath.set(path, { path, count: 1, lastAt: note.createdAt });
		}
	}
	return [...byPath.values()]
		.sort((a, b) => b.lastAt - a.lastAt)
		.slice(0, limit);
}

/**
 * Applies the format filter and sort order to recent sources. `kindOf`
 * and `titleOf` are injected so the function stays pure / testable.
 */
export function applyRecentPreferences(
	sources: RecentSource[],
	kindOf: (path: string) => ShelfKind | null,
	titleOf: (path: string) => string,
	format: ShelfFormatFilter,
	sortBy: ShelfRecentSortBy,
): RecentSource[] {
	const filtered = format === 'all'
		? [...sources]
		: sources.filter(source => kindOf(source.path) === format);
	if (sortBy === 'count') {
		filtered.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
	} else if (sortBy === 'title') {
		filtered.sort((a, b) =>
			titleOf(a.path).localeCompare(titleOf(b.path), undefined, { numeric: true }));
	}
	// 'recent' keeps the newest-first order from computeRecentSources.
	return filtered;
}

/** Renders the recent-reading page: toolbar + activity grid. */
export function renderRecentPage(
	host: GridHost,
	parent: HTMLElement,
	highlights: HighlightNote[],
	cache: ShelfCoverCache,
	notify: {
		onSettingsChange: () => void;
		favorites?: {
			isFavorite: (path: string) => boolean;
			onToggle: (path: string) => void;
		};
	},
): void {
	const plugin = host.plugin;

	const toolbar = parent.createDiv('hl-shelf-toolbar');
	appendRecentSort(plugin, toolbar, notify.onSettingsChange);
	appendFormatFilter(plugin, toolbar, notify.onSettingsChange);

	// Toolbar outside the scroll zone (books never pass behind it).
	const scroll = parent.createDiv('hl-shelf-scroll');
	const body = scroll.createDiv('hl-shelf-recent');
	const format = plugin.settings.bookshelfFormatFilter || 'all';
	const sortBy = plugin.settings.bookshelfRecentSortBy || 'recent';

	const entries: BookEntry[] = [];
	for (const source of applyRecentPreferences(
		computeRecentSources(highlights),
		path => {
			const file = host.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile ? shelfKind(file.extension) : null;
		},
		path => path.split('/').pop()?.replace(/\.[^.]+$/, '') || path,
		format,
		sortBy,
	)) {
		const file = host.app.vault.getAbstractFileByPath(source.path);
		if (file instanceof TFile) {
			entries.push({ file, count: source.count, lastAt: source.lastAt });
		}
	}

	renderBookGrid(host, body, entries, cache, {
		size: plugin.settings.bookshelfCoverSize || 'large',
		subtitle: (entry) => t('bookshelf.recent.subtitle', {
			count: entry.count,
			time: relativeTime(entry.lastAt),
		}),
		emptyText: format === 'all'
			? t('bookshelf.recent.empty')
			: t('bookshelf.recent.emptyFiltered', { format: t(`bookshelf.kind.${format}`) }),
		favorites: notify.favorites,
	});
}
