// ============================================================
// HiLighter - Bookshelf 书籍 (library) page
// ============================================================
// Folder-scoped shelf of every epub / pdf / markdown file, in a
// calibre-style cover grid with large / small / list views. The scan
// scope (saved shelves + include / exclude folders) is managed in
// shelf-scope-modal.ts.

import { Menu, Notice, Platform, TFile, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { HighlightNote, ShelfCoverSize, ShelfFormatFilter, ShelfSortBy } from '../models';
import { matchShelfFiles, MAX_SHELF_SCAN_FILES, normalizeIncludeFolders, shelfKind } from './scope';
import { withFavoriteDeletion, withoutFavoriteDeletion } from '../sync/shelf-collections';
import { renderBookGrid, type BookEntry, type GridHost } from './book-card';
import { BookMetaModal } from './book-meta-modal';
import type { ShelfCoverCache } from './covers';
import { appendFormatFilter, effectiveCoverSize } from './shelf-toolbar';
import { ShelfScopeModal } from './shelf-scope-modal';
import { toggleShelfDropdown } from './shelf-menu';
import { matchesBookTitle } from './title-match';
import { collectBookTags, removeTagPaths } from './book-tags';
import { TagBooksModal } from './book-tags-modal';
import { ConfirmModal } from '../ui/confirm-modal';
import type HiLighterPlugin from '../main';

const SIZE_OPTIONS: Array<{ id: ShelfCoverSize; icon: string; labelKey: string }> = [
	{ id: 'large', icon: 'layout-grid', labelKey: 'bookshelf.library.size.large' },
	{ id: 'small', icon: 'grid-2x2', labelKey: 'bookshelf.library.size.small' },
	{ id: 'list', icon: 'list', labelKey: 'bookshelf.library.size.list' },
];

const SORT_OPTIONS: Array<{ id: ShelfSortBy; labelKey: string }> = [
	{ id: 'title', labelKey: 'bookshelf.library.sort.title' },
	{ id: 'recent', labelKey: 'bookshelf.library.sort.recent' },
	{ id: 'mtime', labelKey: 'bookshelf.library.sort.mtime' },
];

/** Reading-progress filter states (transient, library page only). */
export type ShelfProgressFilter = 'all' | 'planned' | 'reading' | 'done';

const PROGRESS_OPTIONS: Array<{ id: ShelfProgressFilter; labelKey: string; icon: string }> = [
	{ id: 'all', labelKey: 'bookshelf.library.progress.all', icon: 'gauge' },
	{ id: 'planned', labelKey: 'bookshelf.library.progress.planned', icon: 'circle' },
	{ id: 'reading', labelKey: 'bookshelf.library.progress.reading', icon: 'book-open' },
	{ id: 'done', labelKey: 'bookshelf.library.progress.done', icon: 'check-circle-2' },
];

/** Option lookup with an 'all' fallback for junk state. */
function progressOption(id: ShelfProgressFilter) {
	return PROGRESS_OPTIONS.find(option => option.id === id) ?? PROGRESS_OPTIONS[0]!;
}

/** Progress bucket of an entry for filtering (unknown counts as planned). */
export function progressBucket(progress: number | undefined): ShelfProgressFilter {
	const value = progress ?? 0;
	if (value <= 0) return 'planned';
	if (value >= 100) return 'done';
	return 'reading';
}

/** Highlight activity per source path (drives counts + recent sort). */
function activityByPath(highlights: HighlightNote[]): Map<string, { count: number; lastAt: number }> {
	const map = new Map<string, { count: number; lastAt: number }>();
	for (const note of highlights) {
		const path = note.sourcePath || '';
		if (!path) continue;
		const current = map.get(path);
		if (current) {
			map.set(path, { count: current.count + 1, lastAt: Math.max(current.lastAt, note.createdAt) });
		} else {
			map.set(path, { count: 1, lastAt: note.createdAt });
		}
	}
	return map;
}

/** Page context owned by the view: rerender hooks + transient page state. */
export interface LibraryPageCtx {
	/** Full page re-render (settings / scope changed). */
	onScopeChange: () => void;
	/** Body-only re-render (search input keeps focus). */
	onSearchChange: () => void;
	getSearchQuery(): string;
	setSearchQuery(query: string): void;
	// Multi-select (transient view state)
	isSelectMode(): boolean;
	setSelectMode(on: boolean): void;
	getSelected(): ReadonlySet<string>;
	toggleSelected(path: string): boolean;
	clearSelection(): void;
	// Tag filter (transient view state; null = all)
	getTagFilter(): string | null;
	setTagFilter(tag: string | null): void;
	// Favorites-only filter (transient view state)
	getFavoriteOnly(): boolean;
	setFavoriteOnly(on: boolean): void;
	// Reading-progress filter (transient view state; 'all' = no filter)
	getProgressFilter(): ShelfProgressFilter;
	setProgressFilter(filter: ShelfProgressFilter): void;
	// Pagination (transient page number; size persists in settings)
	getPage(): number;
	setPage(page: number): void;
}

/** Valid pagination sizes; anything else falls back to the default. */
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 20;

function validPageSize(size: number | undefined): number {
	return PAGE_SIZE_OPTIONS.includes(size as never) ? (size as number) : DEFAULT_PAGE_SIZE;
}

/**
 * Renders the library page. The toolbar (search / scope / sort /
 * format / size / count) persists across body re-renders so typing in
 * the search box never loses focus; only the grid body rebuilds.
 */
export function renderLibraryPage(
	host: GridHost,
	parent: HTMLElement,
	highlights: HighlightNote[],
	cache: ShelfCoverCache,
	ctx: LibraryPageCtx,
): void {
	let toolbar = parent.querySelector<HTMLElement>(':scope > .hl-shelf-toolbar');
	if (!toolbar) {
		parent.empty();
		toolbar = buildToolbar(host, parent, ctx);
	}

	// The toolbar lives OUTSIDE the scroll zone: books can never render
	// above or behind it.
	let scroll = parent.querySelector<HTMLElement>(':scope > .hl-shelf-scroll');
	if (!scroll) scroll = parent.createDiv('hl-shelf-scroll');
	let body = scroll.querySelector<HTMLElement>(':scope > .hl-shelf-library');
	if (!body) body = scroll.createDiv('hl-shelf-library');

	renderBody(host, toolbar, body, highlights, cache, ctx);
}

/** Builds the persistent toolbar row (search / scope / sort / format / count / size). */
function buildToolbar(host: GridHost, parent: HTMLElement, ctx: LibraryPageCtx): HTMLElement {
	const plugin = host.plugin;
	const settings = plugin.settings;
	const size = effectiveCoverSize(settings.bookshelfCoverSize);
	const toolbar = parent.createDiv('hl-shelf-toolbar');

	// Custom shelves: dropdown to switch saved shelves; the scope
	// modal opens from its "add shelf" row.
	const scopeLabel = t('bookshelf.library.shelves');
	const scopeBtn = toolbar.createEl('button', {
		cls: 'hl-tool-btn hl-shelf-scope-btn',
		attr: { 'aria-label': scopeLabel, title: scopeLabel },
	});
	setIcon(scopeBtn, 'library-big');
	scopeBtn.createSpan({ text: scopeLabel, cls: 'hl-shelf-btn-label' });
	scopeBtn.onclick = () => {
		toggleShelfDropdown(scopeBtn, host.app, plugin, ctx.onScopeChange);
	};

	// Title search (filters the grid body only)
	const search = toolbar.createEl('input', {
		cls: 'hl-shelf-search',
		attr: {
			type: 'search',
			placeholder: t('bookshelf.library.search.placeholder'),
			'aria-label': t('bookshelf.library.search.placeholder'),
			value: ctx.getSearchQuery(),
		},
	});
	search.oninput = () => {
		ctx.setSearchQuery(search.value);
		ctx.setPage(1);
		ctx.onSearchChange();
	};

	// Filter/control cluster: one nested row so phones can scroll it
	// horizontally under the full-width search (desktop unchanged).
	const controls = toolbar.createDiv('hl-shelf-controls');

	// Sort select
	const sortWrap = controls.createDiv('hl-shelf-sort-wrap');
	const sortSelect = sortWrap.createEl('select', {
		cls: 'hl-shelf-select',
		attr: { 'aria-label': t('bookshelf.library.sort.label') },
	});
	SORT_OPTIONS.forEach(option => sortSelect.createEl('option', {
		text: t(option.labelKey),
		value: option.id,
	}));
	sortSelect.value = settings.bookshelfSortBy || 'title';
	sortSelect.onchange = () => {
		plugin.settings.bookshelfSortBy = sortSelect.value as ShelfSortBy;
		ctx.setPage(1);
		void plugin.saveSettings().then(() => ctx.onScopeChange());
	};

	// Format filter (shared with the recent page)
	appendFormatFilter(plugin, controls, ctx.onScopeChange);

	// Tag filter select (options refreshed by renderBody as tags change)
	const tagWrap = controls.createDiv('hl-shelf-sort-wrap');
	const tagSelect = tagWrap.createEl('select', {
		cls: 'hl-shelf-select',
		attr: { 'aria-label': t('bookshelf.library.tags'), 'data-role': 'tag-filter' },
	});
	tagSelect.onchange = () => {
		ctx.setTagFilter(tagSelect.value || null);
		ctx.setPage(1);
		ctx.onSearchChange();
	};

	// Multi-select toggle (batch tag / delete)
	const selectLabel = t('bookshelf.library.select');
	const selectBtn = controls.createEl('button', {
		cls: `hl-tool-btn hl-shelf-scope-btn ${ctx.isSelectMode() ? 'is-active' : ''}`,
		attr: { 'aria-label': selectLabel, title: selectLabel, 'aria-pressed': String(ctx.isSelectMode()) },
	});
	setIcon(selectBtn, 'list-checks');
	selectBtn.onclick = () => {
		ctx.setSelectMode(!ctx.isSelectMode());
		ctx.clearSelection();
		ctx.onScopeChange();
	};

	// Right-aligned tail cluster: count + reading-progress filter +
	// favorites + view size travel together as ONE flex item — a
	// wrapping toolbar can never split them apart, and their mutual
	// spacing stays a tight 8px (the count's old solo auto-margin is
	// what scattered them).
	const tail = controls.createDiv('hl-shelf-tail');

	// Book count (kept in the toolbar; refreshed by renderBody)
	const count = tail.createDiv('hl-shelf-count');
	count.setAttribute('aria-live', 'polite');

	// Reading-progress filter: chromeless icon button left of the heart;
	// a Menu popup picks 计划读 / 正在读 / 已读完 / 全部.
	const progressFilter = ctx.getProgressFilter();
	const progressOption0 = progressOption(progressFilter);
	const progressBtn = tail.createEl('button', {
		cls: `hl-shelf-progress-btn${progressFilter !== 'all' ? ' is-active' : ''}`,
		attr: {
			'aria-label': t(progressFilter === 'all'
				? 'bookshelf.library.progressFilter'
				: progressOption0.labelKey),
			title: t(progressFilter === 'all'
				? 'bookshelf.library.progressFilter'
				: progressOption0.labelKey),
			'aria-pressed': String(progressFilter !== 'all'),
		},
	});
	setIcon(progressBtn, progressOption0.icon);
	progressBtn.onclick = (event) => {
		const menu = new Menu();
		const current = ctx.getProgressFilter();
		PROGRESS_OPTIONS.forEach(option => menu.addItem(item => item
			.setTitle(t(option.labelKey))
			.setIcon(option.icon)
			.setChecked(current === option.id)
			.onClick(() => {
				ctx.setProgressFilter(option.id);
				ctx.setPage(1);
				ctx.onSearchChange();
			})));
		menu.showAtMouseEvent(event);
	};

	// Favorites-only filter (heart, left of the view-size toggle)
	const favLabel = t('bookshelf.library.favorites');
	const favBtn = tail.createEl('button', {
		cls: `hl-shelf-fav-btn${ctx.getFavoriteOnly() ? ' is-active' : ''}`,
		attr: {
			'aria-label': favLabel,
			title: favLabel,
			'aria-pressed': String(ctx.getFavoriteOnly()),
		},
	});
	setIcon(favBtn, 'heart');
	favBtn.onclick = () => {
		ctx.setFavoriteOnly(!ctx.getFavoriteOnly());
		ctx.setPage(1);
		ctx.onSearchChange();
	};

	// Size segmented control — hidden on phones (locked to large covers,
	// see effectiveCoverSize)
	if (!Platform.isPhone) {
		const sizeToggle = tail.createDiv('hl-shelf-size-toggle');
		SIZE_OPTIONS.forEach(option => {
			const btn = sizeToggle.createEl('button', {
				cls: `hl-view-btn ${size === option.id ? 'is-active' : ''}`,
				attr: { 'aria-label': t(option.labelKey), title: t(option.labelKey) },
			});
			setIcon(btn, option.icon);
			btn.onclick = () => {
				plugin.settings.bookshelfCoverSize = option.id;
				void plugin.saveSettings().then(() => ctx.onScopeChange());
			};
		});
	}

	return toolbar;
}

/**
 * Re-renders the grid body + count label from current settings.
 *
 * Refreshes are idempotent: the visible outcome (view size, selection
 * mode, cap banner, pager state, and the exact page of paths — or the
 * empty-state text) is summarized into a signature. When a vault event
 * re-runs this function but the signature is unchanged, the DOM is
 * left completely untouched — no teardown, no cover re-mounts, no
 * scroll reset. Sync-churn storms (iCloud materializing files inside
 * the scope fire in-scope create/delete events) therefore cannot
 * flicker the shelf: same content, zero repaint.
 */
function renderBody(
	host: GridHost,
	toolbar: HTMLElement,
	body: HTMLElement,
	highlights: HighlightNote[],
	cache: ShelfCoverCache,
	ctx: LibraryPageCtx,
): void {
	const plugin = host.plugin;
	const settings = plugin.settings;
	const include = normalizeIncludeFolders(settings.bookshelfIncludeFolders);
	const size = effectiveCoverSize(settings.bookshelfCoverSize);
	const sortBy = settings.bookshelfSortBy || 'title';
	const format: ShelfFormatFilter = settings.bookshelfFormatFilter || 'all';
	const query = ctx.getSearchQuery();
	const bookTags = settings.bookshelfTags ?? {};
	const bookMeta = settings.bookshelfBookMeta ?? {};
	const tagFilter = ctx.getTagFilter();
	const favoriteOnly = ctx.getFavoriteOnly();
	const favorites = new Set(settings.bookshelfFavorites ?? []);

	const countEl = toolbar.querySelector<HTMLElement>('.hl-shelf-count');
	if (countEl) countEl.empty();
	refreshTagOptions(toolbar, bookTags, ctx);
	// The toolbar persists across body re-renders; keep the favorites
	// filter button in sync with the current state.
	const favBtnEl = toolbar.querySelector<HTMLElement>('.hl-shelf-fav-btn');
	if (favBtnEl) {
		favBtnEl.toggleClass('is-active', favoriteOnly);
		favBtnEl.setAttribute('aria-pressed', String(favoriteOnly));
	}
	// Same for the reading-progress filter (icon + tooltip follow state).
	const progressFilter = ctx.getProgressFilter();
	const progressBtnEl = toolbar.querySelector<HTMLElement>('.hl-shelf-progress-btn');
	if (progressBtnEl) {
		const option = progressOption(progressFilter);
		setIcon(progressBtnEl, option.icon);
		progressBtnEl.toggleClass('is-active', progressFilter !== 'all');
		progressBtnEl.setAttribute('aria-pressed', String(progressFilter !== 'all'));
		const stateLabel = t(progressFilter === 'all'
			? 'bookshelf.library.progressFilter'
			: option.labelKey);
		progressBtnEl.setAttribute('aria-label', stateLabel);
		progressBtnEl.setAttribute('title', stateLabel);
	}

	const subtitle = (entry: BookEntry): string =>
		entry.count > 0 ? t('bookshelf.library.subtitle', { count: entry.count }) : '';

	if (include.length === 0) {
		body.empty();
		body.setAttribute('data-render-sig', 'scope-unset');
		renderBookGrid(host, body, [], cache, {
			size,
			subtitle,
			emptyText: t('bookshelf.library.empty.desc'),
			emptyActionText: t('bookshelf.library.empty.action'),
			onEmptyAction: () => new ShelfScopeModal(host.app, plugin, ctx.onScopeChange).open(),
		});
		return;
	}

	// One vault listing feeds both the scope match and the entry build
	// (the old code walked getFiles() twice, doubling the scan cost on
	// large vaults).
	const files = host.app.vault.getFiles();
	const paths = new Set(matchShelfFiles(
		files,
		settings.bookshelfIncludeFolders,
		settings.bookshelfExcludeFolders,
	));
	const capped = paths.size >= MAX_SHELF_SCAN_FILES;
	const activity = activityByPath(highlights);

	const allEntries: BookEntry[] = files
		.filter(file => paths.has(file.path))
		.filter(file => format === 'all' || shelfKind(file.extension) === format)
		.map(file => {
			const stats = activity.get(file.path);
			return {
				file,
				count: stats?.count ?? 0,
				lastAt: stats?.lastAt ?? 0,
				// Every book shows a progress bar; unknown reads as 0%.
				progress: bookMeta[file.path]?.progress ?? 0,
			};
		});

	const entries = allEntries
		.filter(entry => !favoriteOnly || favorites.has(entry.file.path))
		.filter(entry => !tagFilter || (bookTags[entry.file.path] ?? []).includes(tagFilter))
		.filter(entry => progressFilter === 'all' || progressBucket(entry.progress) === progressFilter)
		.filter(entry => matchesBookTitle(query, entry.file.basename, cache.peek(entry.file)?.title))
		.sort((a, b) => {
			if (sortBy === 'recent') return b.lastAt - a.lastAt;
			if (sortBy === 'mtime') return (b.file.stat?.mtime ?? 0) - (a.file.stat?.mtime ?? 0);
			return a.file.basename.localeCompare(b.file.basename, undefined, { numeric: true });
		});

	// Pagination: slices the filtered + sorted list
	const pageSize = validPageSize(settings.bookshelfPageSize);
	const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
	const page = Math.min(Math.max(1, ctx.getPage()), totalPages);
	if (page !== ctx.getPage()) ctx.setPage(page);
	const pageEntries = entries.length > pageSize
		? entries.slice((page - 1) * pageSize, page * pageSize)
		: entries;
	const hasPager = entries.length > pageSize;

	// Count line: filtered view shows visible / total in scope
	// (updated even when the grid body is skipped — totals may shift
	// while the visible page stays the same).
	if (countEl) {
		if (entries.length !== allEntries.length || query.trim()) {
			countEl.setText(t('bookshelf.library.countFiltered', {
				count: entries.length,
				total: allEntries.length,
			}));
		} else {
			countEl.setText(t('bookshelf.library.count', { count: entries.length }));
		}
	}

	const emptyText = favoriteOnly && entries.length === 0
		? t('bookshelf.library.noFavorites')
		: progressFilter !== 'all' && entries.length === 0
			? t(`bookshelf.library.noProgress.${progressFilter}`)
			: query.trim()
				? t('bookshelf.library.noMatches', { query: query.trim() })
				: format === 'all'
					? t('bookshelf.library.noFiles')
					: t('bookshelf.library.noFilesFiltered', { format: t(`bookshelf.kind.${format}`) });

	// Idempotence gate: identical visible outcome -> no DOM work at all.
	// Entry keys carry the reading progress so a metadata edit repaints.
	const sig = [
		size,
		ctx.isSelectMode() ? 'sel' : '',
		favoriteOnly ? 'fav' : '',
		progressFilter !== 'all' ? `prog:${progressFilter}` : '',
		capped ? 'cap' : '',
		hasPager ? `pager:${page}/${totalPages}/${pageSize}` : '',
		entries.length === 0
			? `empty:${emptyText}`
			: pageEntries.map(e => `${e.file.path}@${e.progress ?? '-'}`).join('|'),
	].join('::');
	if (body.getAttribute('data-render-sig') === sig) return;
	body.setAttribute('data-render-sig', sig);

	body.empty();

	// Drop any stale floating widgets (batch stack / pager) from a
	// previous render; they are rebuilt as needed below.
	const root = body.closest<HTMLElement>('.hl-studio');
	root?.querySelector('.hl-shelf-batch')?.remove();
	root?.querySelector('.hl-shelf-pager')?.remove();

	// Defense: an oversized scope (nested archives, the vault root of a
	// big vault) is truncated by matchShelfFiles — surface that instead
	// of silently showing a partial shelf.
	if (capped) {
		const warn = body.createDiv('hl-shelf-cap-warn');
		setIcon(warn.createSpan({ cls: 'hl-shelf-cap-warn-icon' }), 'alert-triangle');
		warn.createSpan({
			cls: 'hl-shelf-cap-warn-text',
			text: t('bookshelf.library.capWarning', { max: MAX_SHELF_SCAN_FILES }),
		});
		const fix = warn.createEl('button', {
			cls: 'hl-shelf-cap-warn-action',
			text: t('bookshelf.library.capAction'),
		});
		fix.onclick = () => new ShelfScopeModal(host.app, plugin, ctx.onScopeChange).open();
	}

	// Multi-select: the batch action stack floats at the view root's
	// lower right (does not scroll with the grid).
	if (ctx.isSelectMode() && root) {
		buildBatchBar(host, root, ctx);
	}

	renderBookGrid(host, body, pageEntries, cache, {
		size,
		subtitle,
		selection: ctx.isSelectMode()
			? {
				isSelected: path => ctx.getSelected().has(path),
				onToggle: path => {
					ctx.toggleSelected(path);
					refreshSelectionUI(body, ctx);
				},
			}
			: undefined,
		favorites: {
			isFavorite: path => favorites.has(path),
			onToggle: path => {
				const current = settings.bookshelfFavorites ?? [];
				const wasFavorite = current.includes(path);
				settings.bookshelfFavorites = wasFavorite
					? current.filter(p => p !== path)
					: [...current, path];
				settings.favoriteTombstones = wasFavorite
					? withFavoriteDeletion(settings.favoriteTombstones, path, Date.now())
					: withoutFavoriteDeletion(settings.favoriteTombstones, path);
				void plugin.saveSettings().then(() => {
					// Keep the visible page; only the heart state changes
					// (unless the favorites-only filter is on, where the
					// book may need to leave the grid).
					if (favoriteOnly) ctx.onSearchChange();
					else rerenderHearts(body, new Set(settings.bookshelfFavorites));
				});
			},
		},
		meta: {
			// Body-only refresh keeps the search box focused; the render
			// signature carries progress so the bar actually repaints.
			onEdit: file => new BookMetaModal(host.app, plugin, file, () => ctx.onSearchChange()).open(),
			onChanged: () => ctx.onScopeChange(),
		},
		emptyText,
	});

	// Pagination floats bottom-center at the view root (does not scroll
	// with the grid); extra grid padding keeps the last row clear of it.
	if (entries.length > pageSize && root) {
		body.addClass('has-pager');
		buildPager(root, plugin, ctx, { page, totalPages, pageSize });
	} else {
		body.removeClass('has-pager');
	}
}

/** Bottom pagination bar: prev / page jump / next + per-page size. */
function buildPager(
	root: HTMLElement,
	plugin: HiLighterPlugin,
	ctx: LibraryPageCtx,
	state: { page: number; totalPages: number; pageSize: number },
): void {
	const bar = root.createDiv('hl-shelf-pager');

	const prev = bar.createEl('button', {
		cls: 'hl-shelf-pager-btn',
		attr: {
			'aria-label': t('bookshelf.library.prevPage'),
			...(state.page <= 1 ? { disabled: 'disabled' } : {}),
		},
	});
	setIcon(prev, 'chevron-left');
	prev.onclick = () => {
		if (state.page <= 1) return;
		ctx.setPage(state.page - 1);
		ctx.onSearchChange();
		scrollPageToTop(bar);
	};

	// Page status with an editable current page: type a number (or use
	// the spinners) and press Enter / blur to jump.
	const status = bar.createDiv('hl-shelf-pager-status');
	const jumpInput = status.createEl('input', {
		type: 'number',
		cls: 'hl-shelf-pager-input',
		attr: {
			'aria-label': t('bookshelf.library.pageJump'),
			min: '1',
			max: String(state.totalPages),
		},
	});
	jumpInput.value = String(state.page);
	status.createSpan({ cls: 'hl-shelf-pager-total', text: `/ ${state.totalPages}` });
	const jump = (): void => {
		const n = Math.min(Math.max(parseInt(jumpInput.value, 10) || state.page, 1), state.totalPages);
		jumpInput.value = String(n);
		if (n === state.page) return;
		ctx.setPage(n);
		ctx.onSearchChange();
		scrollPageToTop(bar);
	};
	jumpInput.addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			jumpInput.blur();
		}
	});
	jumpInput.addEventListener('blur', jump);

	const next = bar.createEl('button', {
		cls: 'hl-shelf-pager-btn',
		attr: {
			'aria-label': t('bookshelf.library.nextPage'),
			...(state.page >= state.totalPages ? { disabled: 'disabled' } : {}),
		},
	});
	setIcon(next, 'chevron-right');
	next.onclick = () => {
		if (state.page >= state.totalPages) return;
		ctx.setPage(state.page + 1);
		ctx.onSearchChange();
		scrollPageToTop(bar);
	};

	const sizeSelect = bar.createEl('select', {
		cls: 'hl-shelf-select',
		attr: { 'aria-label': t('bookshelf.library.pageSize', { size: state.pageSize }) },
	});
	PAGE_SIZE_OPTIONS.forEach(size => sizeSelect.createEl('option', {
		text: t('bookshelf.library.pageSize', { size }),
		value: String(size),
	}));
	sizeSelect.value = String(state.pageSize);
	sizeSelect.onchange = () => {
		plugin.settings.bookshelfPageSize = Number(sizeSelect.value) || DEFAULT_PAGE_SIZE;
		ctx.setPage(1);
		void plugin.saveSettings().then(() => ctx.onScopeChange());
	};
}

/** Scrolls the shelf page back to the top after a page change. */
function scrollPageToTop(bar: HTMLElement): void {
	const scroll = bar.closest('.hl-shelf')?.querySelector('.hl-shelf-scroll');
	if (scroll) scroll.scrollTop = 0;
}

/** Rebuilds the tag-filter select options (tags change with batching). */
function refreshTagOptions(toolbar: HTMLElement, bookTags: Record<string, string[]>, ctx: LibraryPageCtx): void {
	const select = toolbar.querySelector<HTMLSelectElement>('select[data-role="tag-filter"]');
	if (!select) return;
	const current = ctx.getTagFilter();
	select.empty();
	select.createEl('option', { text: t('bookshelf.library.tagsAll'), value: '' });
	collectBookTags(bookTags).forEach(({ tag, count }) => {
		select.createEl('option', { text: `${tag} · ${count}`, value: tag });
	});
	// Drop a vanished selection (its books were untagged / deleted).
	select.value = current && collectBookTags(bookTags).some(item => item.tag === current)
		? current
		: '';
}

/** Updates card check marks + the batch stack without a body re-render. */
/** Patches heart states in place (no grid teardown, no cover flicker). */
function rerenderHearts(body: HTMLElement, favorites: Set<string>): void {
	body.querySelectorAll('.hl-book[data-path]').forEach(card => {
		const path = card.getAttribute('data-path') ?? '';
		const fav = card.querySelector<HTMLElement>('.hl-book-fav');
		if (!fav) return;
		const isFav = favorites.has(path);
		fav.classList.toggle('is-favorite', isFav);
		const label = t(isFav ? 'bookshelf.favRemove' : 'bookshelf.favAdd');
		fav.setAttribute('aria-label', label);
		fav.setAttribute('title', label);
	});
}

function refreshSelectionUI(body: HTMLElement, ctx: LibraryPageCtx): void {
	const selected = ctx.getSelected();
	body.querySelectorAll('.hl-book[data-path]').forEach(card => {
		const path = card.getAttribute('data-path') ?? '';
		card.classList.toggle('is-selected', selected.has(path));
	});
	const root = body.closest<HTMLElement>('.hl-studio');
	const bar = root?.querySelector('.hl-shelf-batch') ?? null;
	const countEl = bar?.querySelector('.hl-shelf-batch-count') ?? null;
	if (countEl) countEl.setText(t('bookshelf.library.selected', { count: selected.size }));
	if (bar) {
		const empty = selected.size === 0;
		(bar.querySelector<HTMLElement>('.hl-shelf-batch-tag'))?.toggleAttribute('disabled', empty);
		(bar.querySelector<HTMLElement>('.hl-shelf-batch-delete'))?.toggleAttribute('disabled', empty);
	}
}

/**
 * Floating batch stack (lower right of the view): selection count +
 * icon-only tag / delete / done actions with tooltips.
 */
function buildBatchBar(host: GridHost, root: HTMLElement, ctx: LibraryPageCtx): void {
	const plugin = host.plugin;
	const bar = root.createDiv('hl-shelf-batch');
	bar.createSpan({
		cls: 'hl-shelf-batch-count',
		text: String(ctx.getSelected().size),
		attr: { title: t('bookshelf.library.selected', { count: ctx.getSelected().size }) },
	});

	const tagBtn = bar.createEl('button', {
		cls: 'hl-shelf-batch-btn hl-shelf-batch-tag',
		attr: {
			'aria-label': t('bookshelf.library.tagAction'),
			title: t('bookshelf.library.tagAction'),
			...(ctx.getSelected().size === 0 ? { disabled: 'disabled' } : {}),
		},
	});
	setIcon(tagBtn, 'tags');
	tagBtn.onclick = () => {
		const selected = [...ctx.getSelected()];
		if (selected.length === 0) return;
		new TagBooksModal(host.app, plugin, selected, ctx.onSearchChange).open();
	};

	const deleteBtn = bar.createEl('button', {
		cls: 'hl-shelf-batch-btn is-danger hl-shelf-batch-delete',
		attr: {
			'aria-label': t('bookshelf.library.deleteAction'),
			title: t('bookshelf.library.deleteAction'),
			...(ctx.getSelected().size === 0 ? { disabled: 'disabled' } : {}),
		},
	});
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.onclick = () => {
		const selected = [...ctx.getSelected()];
		if (selected.length === 0) return;
		new ConfirmModal(
			host.app,
			t('bookshelf.library.deleteConfirm', { count: selected.length }),
			async () => {
				let deleted = 0;
				for (const path of selected) {
					const file = host.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) continue;
					try {
						await host.app.fileManager.trashFile(file);
						deleted++;
					} catch (err) {
						console.error('[HiLighter] bookshelf delete failed:', path, err);
					}
				}
				plugin.settings.bookshelfTags = removeTagPaths(plugin.settings.bookshelfTags ?? {}, selected);
				await plugin.saveSettings();
				ctx.clearSelection();
				new Notice(t('bookshelf.library.deleted', { count: deleted }));
				ctx.onScopeChange();
			},
			{ warning: true, confirmText: t('bookshelf.library.deleteAction') },
		).open();
	};

	const doneBtn = bar.createEl('button', {
		cls: 'hl-shelf-batch-btn',
		attr: {
			'aria-label': t('bookshelf.library.done'),
			title: t('bookshelf.library.done'),
		},
	});
	setIcon(doneBtn, 'check');
	doneBtn.onclick = () => {
		ctx.setSelectMode(false);
		ctx.clearSelection();
		ctx.onScopeChange();
	};
}

