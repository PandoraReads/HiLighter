// ============================================================
// HiLighter - Bookshelf 近期阅读 page
// ============================================================
// Files that recently received highlights (markdown / pdf / epub),
// aggregated from the highlight database, with a sort + format
// filter toolbar.

import { Platform, TFile, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { HighlightNote, ShelfFormatFilter, ShelfRecentSortBy } from '../models';
import {
	createBookCover,
	mountBookCover,
	openShelfFile,
	renderBookGrid,
	renderBookProgress,
	relativeTime,
	type BookEntry,
	type GridHost,
} from './book-card';
import { openBookMenu } from './book-actions';
import { BookMetaModal } from './book-meta-modal';
import type { ShelfCoverCache } from './covers';
import { shelfKind, type ShelfKind } from './scope';
import { appendFormatFilter, appendRecentSort, effectiveCoverSize } from './shelf-toolbar';

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

/**
 * Splits recent entries into the continue-reading focus (newest
 * activity, regardless of the chosen sort) and the remaining list.
 */
export function splitFocusEntry<T extends { lastAt: number }>(
	entries: T[],
): { focus: T | null; rest: T[] } {
	if (entries.length === 0) return { focus: null, rest: [] };
	let focusIndex = 0;
	let focusLastAt = entries[0]!.lastAt;
	entries.forEach((entry, index) => {
		if (entry.lastAt > focusLastAt) {
			focusIndex = index;
			focusLastAt = entry.lastAt;
		}
	});
	return {
		focus: entries[focusIndex] ?? null,
		rest: entries.filter((_, index) => index !== focusIndex),
	};
}

/** Builds the rendered entries from raw highlights + current prefs. */
function recentBookEntries(
	host: GridHost,
	highlights: HighlightNote[],
	format: ShelfFormatFilter,
	sortBy: ShelfRecentSortBy,
): BookEntry[] {
	const plugin = host.plugin;
	const bookMeta = plugin.settings.bookshelfBookMeta ?? {};
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
			entries.push({
				file,
				count: source.count,
				lastAt: source.lastAt,
				// Every book shows a progress bar; unknown reads as 0%.
				progress: bookMeta[source.path]?.progress ?? 0,
			});
		}
	}
	return entries;
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
	const format = plugin.settings.bookshelfFormatFilter || 'all';
	const sortBy = plugin.settings.bookshelfRecentSortBy || 'recent';
	const entries = recentBookEntries(host, highlights, format, sortBy);
	const subtitle = (entry: BookEntry): string => t('bookshelf.recent.subtitle', {
		count: entry.count,
		time: relativeTime(entry.lastAt),
	});

	// Phones: continue-reading focus card + compact list below.
	if (Platform.isPhone) {
		renderPhoneRecent(host, parent, entries, cache, notify, { format, subtitle });
		return;
	}

	const toolbar = parent.createDiv('hl-shelf-toolbar');
	appendRecentSort(plugin, toolbar, notify.onSettingsChange);
	appendFormatFilter(plugin, toolbar, notify.onSettingsChange);

	// Toolbar outside the scroll zone (books never pass behind it).
	const scroll = parent.createDiv('hl-shelf-scroll');
	const body = scroll.createDiv('hl-shelf-recent');

	// Continue-reading focus card leads the page; the full list follows.
	const { focus } = splitFocusEntry(entries);
	if (focus) buildFocusCard(host, body, focus, cache, notify, { subtitle });

	renderBookGrid(host, body, entries, cache, {
		size: effectiveCoverSize(plugin.settings.bookshelfCoverSize),
		subtitle,
		emptyText: format === 'all'
			? t('bookshelf.recent.empty')
			: t('bookshelf.recent.emptyFiltered', { format: t(`bookshelf.kind.${format}`) }),
		favorites: notify.favorites,
		meta: {
			// The recent page re-renders wholesale; progress bars refresh
			// with it.
			onEdit: file => new BookMetaModal(host.app, plugin, file, notify.onSettingsChange).open(),
			onChanged: notify.onSettingsChange,
		},
	});
}

/**
 * Last-read focus card, one horizontal strip: 「上次阅读」 label +
 * relative time, small cover on the left, then title, progress and a
 * right-aligned 「继续阅读」 button. Shared by the phone page (above
 * the compact list) and the desktop / tablet page (above the grid).
 */
function buildFocusCard(
	host: GridHost,
	parent: HTMLElement,
	focus: BookEntry,
	cache: ShelfCoverCache,
	notify: {
		onSettingsChange: () => void;
		favorites?: {
			isFavorite: (path: string) => boolean;
			onToggle: (path: string) => void;
		};
	},
	opts: { subtitle: (entry: BookEntry) => string },
): void {
	const plugin = host.plugin;
	const kind = shelfKind(focus.file.extension) ?? 'markdown';

	const card = parent.createDiv('hl-recent-focus');
	card.setAttribute('data-path', focus.file.path);
	card.setAttribute('role', 'button');
	card.setAttribute('tabindex', '0');

	const head = card.createDiv('hl-recent-focus-head');
	head.createSpan({ cls: 'hl-recent-focus-eyebrow', text: t('bookshelf.recent.lastRead') });
	const lastTime = relativeTime(focus.lastAt);
	if (lastTime) head.createSpan({ cls: 'hl-recent-focus-time', text: lastTime });

	const body = card.createDiv('hl-recent-focus-body');
	const cover = createBookCover(body, focus.file.path, kind);
	const info = body.createDiv('hl-recent-focus-info');
	info.createDiv({ cls: 'hl-book-title hl-recent-focus-title', text: focus.file.basename });
	if (typeof focus.progress === 'number') {
		renderBookProgress(info, focus.progress);
	}
	const resumeLabel = t('bookshelf.recent.continue');
	const cta = info.createDiv('hl-recent-focus-cta').createEl('button', {
		cls: 'hl-recent-focus-btn',
		attr: { 'aria-label': resumeLabel, title: resumeLabel },
	});
	setIcon(cta, 'play');
	cta.createSpan({ text: resumeLabel });

	void mountBookCover(host, cover, focus, cache, { caption: false, bare: true, subtitle: opts.subtitle });

	const open = (): void => { void openShelfFile(host.app, focus.file.path); };
	card.onclick = open;
	cta.onclick = open;
	card.onkeydown = (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			open();
		}
	};
	card.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		openBookMenu(host, focus.file, event, {
			onEditMeta: file => new BookMetaModal(host.app, plugin, file, notify.onSettingsChange).open(),
			onChanged: notify.onSettingsChange,
			favorites: notify.favorites,
		});
	});
}

/**
 * Phone 近期阅读 layout: the newest book as a continue-reading focus
 * card (cover + title + meta + progress), then the remaining books as
 * a compact list. Sort / format selects move into the list header —
 * the top of the page belongs to the focus card alone.
 */
function renderPhoneRecent(
	host: GridHost,
	parent: HTMLElement,
	entries: BookEntry[],
	cache: ShelfCoverCache,
	notify: {
		onSettingsChange: () => void;
		favorites?: {
			isFavorite: (path: string) => boolean;
			onToggle: (path: string) => void;
		};
	},
	opts: {
		format: ShelfFormatFilter;
		subtitle: (entry: BookEntry) => string;
	},
): void {
	const plugin = host.plugin;
	const scroll = parent.createDiv('hl-shelf-scroll');
	const body = scroll.createDiv('hl-shelf-recent hl-recent-phone');

	if (entries.length === 0) {
		const empty = body.createDiv('hl-shelf-empty');
		empty.createDiv({
			cls: 'hl-shelf-empty-text',
			text: opts.format === 'all'
				? t('bookshelf.recent.empty')
				: t('bookshelf.recent.emptyFiltered', { format: t(`bookshelf.kind.${opts.format}`) }),
		});
		return;
	}

	const { focus, rest } = splitFocusEntry(entries);
	if (!focus) return;
	buildFocusCard(host, body, focus, cache, notify, { subtitle: opts.subtitle });

	if (rest.length === 0) return;
	const head = body.createDiv('hl-recent-rest-head');
	head.createSpan({ cls: 'hl-recent-rest-label', text: t('bookshelf.recent.more') });
	const tools = head.createDiv('hl-recent-rest-tools');
	appendRecentSort(plugin, tools, notify.onSettingsChange);
	appendFormatFilter(plugin, tools, notify.onSettingsChange);

	renderBookGrid(host, body, rest, cache, {
		size: 'list',
		subtitle: opts.subtitle,
		emptyText: '',
		favorites: notify.favorites,
		meta: {
			onEdit: file => new BookMetaModal(host.app, plugin, file, notify.onSettingsChange).open(),
			onChanged: notify.onSettingsChange,
		},
	});
}
