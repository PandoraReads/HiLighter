// ============================================================
// HiLighter - Bookshelf card grid (shared by 近期阅读 / 书籍)
// ============================================================
// Calibre-style cover grid. Covers load lazily through an
// IntersectionObserver; files without a raster cover (markdown, or a
// failed pdf render) get a generated gradient cover.

import { setIcon, moment, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type HiLighterPlugin from '../main';
import { t } from '../i18n';
import { shelfKind } from './scope';
import type { ShelfCoverCache } from './covers';
import { openBookMenu } from './book-actions';

/** One rendered shelf entry (file + highlight stats). */
export interface BookEntry {
	file: TFile;
	/** Highlight-card count for the file (0 = none). */
	count: number;
	/** Timestamp of the newest highlight (0 = none). */
	lastAt: number;
	/** Reading progress 0-100 from book metadata; absent = unknown. */
	progress?: number;
}

/** Minimal host surface the grid needs. */
export interface GridHost {
	app: App;
	plugin: HiLighterPlugin;
}

const KIND_ICON: Record<string, string> = {
	markdown: 'file-text',
	pdf: 'file-type',
	epub: 'book-open',
};

/** Compact badge spelling (EPUB / PDF / MD). */
const KIND_SHORT: Record<string, string> = {
	markdown: 'MD',
	pdf: 'PDF',
	epub: 'EPUB',
};

/** Stable variant index for generated-cover gradients. */
function coverVariant(path: string): number {
	let hash = 0;
	for (let i = 0; i < path.length; i++) {
		hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
	}
	return hash % 6;
}

/**
 * Creates the cover frame — variant index + shimmer placeholder, plus
 * the optional format badge — inside a card element. The grid and the
 * phone focus card share it.
 */
export function createBookCover(
	parent: HTMLElement,
	path: string,
	kind: string,
	opts?: { badge?: boolean },
): HTMLElement {
	const cover = parent.createDiv('hl-book-cover');
	cover.setAttribute('data-variant', String(coverVariant(path)));
	cover.createDiv('hl-book-cover-shimmer');
	if (opts?.badge) {
		const kindBadge = cover.createSpan({ cls: 'hl-book-kind' });
		setIcon(kindBadge.createSpan({ cls: 'hl-book-kind-icon' }), KIND_ICON[kind] ?? 'file');
		kindBadge.createSpan({ cls: 'hl-book-kind-label', text: KIND_SHORT[kind] ?? '' });
	}
	return cover;
}

/**
 * Progress bar row (track + fill + percent). Shared by grid cards and
 * the phone continue-reading focus card.
 */
export function renderBookProgress(parent: HTMLElement, progress: number): void {
	const bar = parent.createDiv('hl-book-progress');
	if (progress >= 100) bar.setAttribute('data-done', 'true');
	bar.setAttribute('role', 'progressbar');
	bar.setAttribute('aria-valuemin', '0');
	bar.setAttribute('aria-valuemax', '100');
	bar.setAttribute('aria-valuenow', String(progress));
	bar.setAttribute('aria-label', t('bookshelf.meta.progressOf', { value: progress }));
	const track = bar.createDiv('hl-book-progress-track');
	track.createDiv({ cls: 'hl-book-progress-fill' })
		.setCssProps({ width: `${progress}%` });
	bar.createSpan({ cls: 'hl-book-progress-pct', text: `${progress}%` });
}

/** Opens any shelf file with its native viewer (md / pdf / epub). */
export async function openShelfFile(app: App, path: string): Promise<void> {
	await app.workspace.openLinkText(path, '', false);
}

function coverMetaLine(entry: BookEntry, subtitle: (entry: BookEntry) => string): string {
	return subtitle(entry);
}

/** Opening screenful of covers loads immediately (perceived speed). */
const IMMEDIATE_COVERS = 24;
/** If the observer never fires, chunked loading takes over after this. */
const IO_FALLBACK_DELAY_MS = 700;
const FALLBACK_BATCH = 12;
const FALLBACK_INTERVAL_MS = 250;

/**
 * Renders the cover grid. `subtitle` supplies the per-card meta line
 * (recent page shows counts, library shows author/kind); it is also
 * re-applied after metadata arrives. `selection`, when present,
 * switches clicks to multi-select toggling. `favorites`, when present,
 * mounts a heart toggle on each cover (bottom-right, hover-revealed).
 * `meta`, when present, enables the right-click / long-press context
 * menu for book metadata and quick actions.
 */
export function renderBookGrid(
	host: GridHost,
	parent: HTMLElement,
	entries: BookEntry[],
	cache: ShelfCoverCache,
	opts: {
		size: 'large' | 'small' | 'list';
		subtitle: (entry: BookEntry) => string;
		emptyText: string;
		emptyActionText?: string;
		onEmptyAction?: () => void;
		selection?: {
			isSelected: (path: string) => boolean;
			onToggle: (path: string) => void;
		};
		favorites?: {
			isFavorite: (path: string) => boolean;
			onToggle: (path: string) => void;
		};
		meta?: {
			onEdit: (file: TFile) => void;
			onChanged: () => void;
		};
	},
): void {
	if (entries.length === 0) {
		const empty = parent.createDiv('hl-shelf-empty');
		empty.createDiv({ cls: 'hl-shelf-empty-text', text: opts.emptyText });
		if (opts.emptyActionText && opts.onEmptyAction) {
			const action = empty.createEl('button', { cls: 'hl-shelf-empty-action', text: opts.emptyActionText });
			action.onclick = () => opts.onEmptyAction!();
		}
		return;
	}

	const grid = parent.createDiv('hl-shelf-grid');
	grid.setAttribute('data-size', opts.size);

	const view = grid.ownerDocument?.defaultView ?? window;
	let ioFired = false;

	const observer = new view.IntersectionObserver((observed) => {
		// Even an all-non-intersecting batch proves the observer works.
		ioFired = true;
		for (const item of observed) {
			if (!item.isIntersecting) continue;
			observer.unobserve(item.target);
			void mountCover(host, item.target as HTMLElement, entries, cache, opts);
		}
		// The grid is emptied on every page re-render; release the observer
		// once its cards are gone.
		if (observed.some(item => !item.target.isConnected)) observer.disconnect();
	}, { rootMargin: '300px' });

	const covers: HTMLElement[] = [];

	entries.forEach((entry) => {
		const kind = shelfKind(entry.file.extension) ?? 'markdown';
		const card = grid.createDiv('hl-book');
		card.setAttribute('data-path', entry.file.path);
		card.setAttribute('role', 'button');
		card.setAttribute('tabindex', '0');

		const cover = createBookCover(card, entry.file.path, kind, { badge: true });
		covers.push(cover);

		if (opts.selection) {
			card.addClass('is-selectable');
			const check = cover.createSpan({ cls: 'hl-book-check' });
			setIcon(check, 'check');
			if (opts.selection.isSelected(entry.file.path)) card.addClass('is-selected');
		}

		// Favorite heart: bottom-right, chromeless, hidden until hover
		// (always shown when favorited or on touch devices).
		if (opts.favorites) {
			const fav = cover.createSpan({ cls: 'hl-book-fav' });
			const isFav = opts.favorites.isFavorite(entry.file.path);
			fav.toggleClass('is-favorite', isFav);
			setIcon(fav, 'heart');
			const favLabel = t(isFav ? 'bookshelf.favRemove' : 'bookshelf.favAdd');
			fav.setAttribute('role', 'button');
			fav.setAttribute('aria-label', favLabel);
			fav.setAttribute('title', favLabel);
			fav.onclick = (event) => {
				event.stopPropagation();
				opts.favorites!.onToggle(entry.file.path);
			};
		}

		// Metadata entry: right-click / long-press opens the context
		// menu (edit metadata, mark finished, favorite, delete).
		if (opts.meta) {
			card.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				openBookMenu(host, entry.file, event, {
					onEditMeta: opts.meta!.onEdit,
					onChanged: opts.meta!.onChanged,
					favorites: opts.favorites,
				});
			});
		}

		// Title stays on the cover (caption scrim / generated gradient);
		// the info line below the card carries only the meta subtitle.
		// List view keeps the inline title (CSS shows it there).
		const info = card.createDiv('hl-book-info');
		info.createDiv({ cls: 'hl-book-title', text: entry.file.basename });
		info.createDiv({ cls: 'hl-book-sub', text: coverMetaLine(entry, opts.subtitle) });
		if (typeof entry.progress === 'number') {
			renderBookProgress(info, entry.progress);
		}

		const open = () => { void openShelfFile(host.app, entry.file.path); };
		if (opts.selection) {
			card.onclick = () => opts.selection!.onToggle(entry.file.path);
			card.onkeydown = (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					opts.selection!.onToggle(entry.file.path);
				}
			};
		} else {
			card.onclick = open;
			card.onkeydown = (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					open();
				}
			};
		}
	});

	// Opening screenful: mount right away; everything else stays lazy.
	const immediate = covers.slice(0, IMMEDIATE_COVERS);
	immediate.forEach(coverEl => { void mountCover(host, coverEl, entries, cache, opts); });
	const lazy = covers.slice(IMMEDIATE_COVERS);
	lazy.forEach(coverEl => observer.observe(coverEl));

	// Safety net: observer silent (exotic host) -> chunked loading, so
	// the shelf never stays on shimmer placeholders.
	view.setTimeout(() => {
		if (ioFired || !grid.isConnected) return;
		const pending = lazy.filter(coverEl => coverEl.isConnected);
		const loadBatch = () => {
			if (ioFired || !grid.isConnected) return;
			const batch = pending.splice(0, FALLBACK_BATCH);
			batch.forEach(coverEl => {
				observer.unobserve(coverEl);
				void mountCover(host, coverEl, entries, cache, opts);
			});
			if (pending.length > 0) view.setTimeout(loadBatch, FALLBACK_INTERVAL_MS);
		};
		loadBatch();
	}, IO_FALLBACK_DELAY_MS);
}

/**
 * Mounts a single entry's cover outside the grid (phone focus card).
 * The card element carrying `data-path` must wrap the cover; its
 * `.hl-book-title` / `.hl-book-sub` children, when present, receive
 * the same metadata updates as grid cards.
 */
export function mountBookCover(
	host: GridHost,
	coverEl: HTMLElement,
	entry: BookEntry,
	cache: ShelfCoverCache,
	opts?: { caption?: boolean; bare?: boolean; subtitle?: (entry: BookEntry) => string },
): Promise<void> {
	return mountCover(host, coverEl, [entry], cache, {
		subtitle: opts?.subtitle ?? (() => ''),
		caption: opts?.caption ?? true,
		bare: opts?.bare ?? false,
	});
}

/** Loads metadata for one card and swaps the shimmer for a real cover. */
async function mountCover(
	host: GridHost,
	coverEl: HTMLElement,
	entries: BookEntry[],
	cache: ShelfCoverCache,
	opts: {
		subtitle: (entry: BookEntry) => string;
		/** Raster covers carry the title scrim; standalone mounts can skip it. */
		caption?: boolean;
		/** Generated covers omit their title text. */
		bare?: boolean;
	},
): Promise<void> {
	// The card carrying data-path may wrap the cover directly (grid)
	// or through an intermediate row (focus card) — walk up to it.
	const path = coverEl.closest('[data-path]')?.getAttribute('data-path') ?? '';
	const entry = entries.find(e => e.file.path === path);
	if (!entry || !coverEl.isConnected) return;

	const kind = shelfKind(entry.file.extension) ?? 'markdown';
	const meta = await cache.get(host.app, entry.file, kind);
	if (!coverEl.isConnected) return;

	coverEl.querySelector('.hl-book-cover-shimmer')?.remove();
	const card = coverEl.closest('[data-path]');
	if (!card) return;

	if (meta.coverSrc) {
		const img = coverEl.createEl('img', {
			cls: 'hl-book-cover-img',
			attr: { src: meta.coverSrc, alt: '' },
		});
		img.loading = 'lazy';
		// Broken images (dead network URL, removed file) fall back to the
		// generated cover instead of showing an empty frame.
		img.onerror = () => {
			img.remove();
			if (!coverEl.querySelector('.hl-book-cover-gen')) {
				mountGeneratedCover(coverEl, meta.title || entry.file.basename, { bare: opts.bare });
			}
		};
		// Title rides on the cover itself (bottom scrim) — the card keeps
		// only the meta line below. Standalone mounts (focus card) show
		// the title beside the cover and skip the scrim.
		if (opts.caption !== false) {
			mountCoverCaption(coverEl, meta.title || entry.file.basename);
		}
	} else {
		mountGeneratedCover(coverEl, meta.title || entry.file.basename, { bare: opts.bare });
	}

	const titleEl = card.querySelector('.hl-book-title');
	if (titleEl && meta.title) titleEl.textContent = meta.title;
	const subEl = card.querySelector('.hl-book-sub');
	if (subEl) {
		const base = coverMetaLine(entry, opts.subtitle);
		// Author leads the line; highlight stats follow to its right.
		subEl.textContent = meta.author
			? (base ? `${meta.author} · ${base}` : meta.author)
			: base;
	}
}

/** Mounts the gradient cover card (no raster image available). */
function mountGeneratedCover(coverEl: HTMLElement, title: string, opts?: { bare?: boolean }): void {
	const generated = coverEl.createDiv('hl-book-cover-gen');
	generated.setAttribute('data-variant', coverEl.getAttribute('data-variant') ?? '0');
	// Open-book mark centered on the gradient
	const mark = generated.createDiv('hl-cover-gen-mark');
	setIcon(mark, 'book-open');
	if (!opts?.bare) generated.createDiv({ cls: 'hl-cover-gen-title', text: title });
}

/** Mounts the bottom title scrim over a raster cover. */
function mountCoverCaption(coverEl: HTMLElement, title: string): void {
	coverEl.createDiv({ cls: 'hl-book-cover-caption', text: title });
}

/** Relative-time formatter for the recent page subtitle. */
export function relativeTime(timestamp: number): string {
	if (!timestamp) return '';
	return moment(timestamp).fromNow();
}
