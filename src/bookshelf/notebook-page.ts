// ============================================================
// HiLighter - Bookshelf 笔记本 (notebooks) page
// ============================================================
// One notebook per highlighted source. The grid mirrors the shelf
// (same cards / sizes) but every cover is a user-pickable pattern
// (plaid / floral / watercolor…) carrying the book title instead
// of the real book cover. Opening a notebook drills into a reader
// page listing that book's highlights (original text + notes) in
// document order, each with a jump-to-source action.

import { Menu, Notice, TFile, setIcon } from 'obsidian';
import { t } from '../i18n';
import { db } from '../db';
import type { HighlightNote } from '../models';
import { resolveHex } from '../colors';
import { compareEpubCfi } from '../epub/cfi-order';
import { jumpToSource } from '../studio/actions';
import { renderMarkdownPreview, DetachedComponent } from '../studio/markdown';
import { QuoteCardModal } from '../studio/quote-card-modal';
import { relativeTime, openShelfFile, type GridHost } from './book-card';
import { computeRecentSources } from './recent-page';
import { shelfKind } from './scope';
import { appendFormatFilter, createMenuSelect, effectiveCoverSize } from './shelf-toolbar';
import { matchesBookTitle } from './title-match';
import { exportNotebookAsMarkdown, exportNotebookEntryAsMarkdown } from './notebook-export';
import { setCssProps } from '../utils/css-props';
import { TextInputModal } from '../ui/input-modal';

// ── Cover patterns ────────────────────────────────────────

/**
 * A notebook cover pattern: one of the twelve built-in CSS patterns,
 * or `img:<file>` referencing a picture dropped into the plugin's
 * covers/ folder (see covers/README.md) — those paint the art layer
 * with the real image and keep the title band on top.
 */
export type NotebookCoverPattern =
	| 'plaid' | 'floral' | 'watercolor' | 'kraft' | 'dots' | 'lines'
	| 'geometric' | 'grid' | 'terrazzo' | 'marble' | 'denim' | 'constellation'
	| `img:${string}`;

/** Built-in pattern covers; art lives in styles.css per data-pattern. */
export const NOTEBOOK_PATTERNS: ReadonlyArray<{ id: NotebookCoverPattern; labelKey: string }> = [
	{ id: 'plaid', labelKey: 'bookshelf.notebook.pattern.plaid' },
	{ id: 'floral', labelKey: 'bookshelf.notebook.pattern.floral' },
	{ id: 'watercolor', labelKey: 'bookshelf.notebook.pattern.watercolor' },
	{ id: 'geometric', labelKey: 'bookshelf.notebook.pattern.geometric' },
	{ id: 'dots', labelKey: 'bookshelf.notebook.pattern.dots' },
	{ id: 'lines', labelKey: 'bookshelf.notebook.pattern.lines' },
	{ id: 'grid', labelKey: 'bookshelf.notebook.pattern.grid' },
	{ id: 'terrazzo', labelKey: 'bookshelf.notebook.pattern.terrazzo' },
	{ id: 'marble', labelKey: 'bookshelf.notebook.pattern.marble' },
	{ id: 'denim', labelKey: 'bookshelf.notebook.pattern.denim' },
	{ id: 'kraft', labelKey: 'bookshelf.notebook.pattern.kraft' },
	{ id: 'constellation', labelKey: 'bookshelf.notebook.pattern.constellation' },
];

function isPatternId(value: string | undefined): value is NotebookCoverPattern {
	if (!value) return false;
	if (value.startsWith('img:')) return true;
	return NOTEBOOK_PATTERNS.some(pattern => pattern.id === value);
}

/** Stable hash-derived default pattern (unpicked notebooks get variety). */
function defaultPattern(path: string): NotebookCoverPattern {
	let hash = 0;
	for (let i = 0; i < path.length; i++) {
		hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
	}
	return NOTEBOOK_PATTERNS[hash % NOTEBOOK_PATTERNS.length]!.id;
}

/** The pattern a notebook shows: user pick first, hash default second. */
export function notebookPattern(
	picks: Record<string, string> | undefined,
	path: string,
): NotebookCoverPattern {
	const picked = picks?.[path];
	return isPatternId(picked) ? picked : defaultPattern(path);
}

// ── Page context (state owned by the bookshelf view) ──────

export type NotebookSortBy = 'recent' | 'title' | 'count';

export interface NotebookPageCtx {
	getOpenPath: () => string | null;
	setOpenPath: (path: string | null) => void;
	getSortBy: () => NotebookSortBy;
	setSortBy: (sort: NotebookSortBy) => void;
	getSearchQuery: () => string;
	setSearchQuery: (query: string) => void;
	/** Full page re-render (toolbar + body). */
	onScopeChange: () => void;
	/** Body-only re-render (keeps the search box focused). */
	onSearchChange: () => void;
	/** A highlight was edited: reload the DB snapshot and remount the
	 * reader (scroll position preserved by the view). */
	onNotesChanged: () => void;
}

const SORT_OPTIONS: Array<{ id: NotebookSortBy; labelKey: string }> = [
	{ id: 'recent', labelKey: 'bookshelf.library.sort.recent' },
	{ id: 'title', labelKey: 'bookshelf.library.sort.title' },
	{ id: 'count', labelKey: 'bookshelf.recent.sort.count' },
];

// ── Page render ───────────────────────────────────────────

/**
 * Renders the notebook page: the grid while closed, the single
 * notebook reader while one is open. Mirrors the library page's
 * persistent-toolbar pattern so search typing keeps focus.
 */
export function renderNotebookPage(
	host: GridHost,
	parent: HTMLElement,
	highlights: HighlightNote[],
	ctx: NotebookPageCtx,
): void {
	const openPath = ctx.getOpenPath();
	if (openPath) {
		parent.empty();
		renderNotebookReader(host, parent, openPath, highlights, ctx);
		return;
	}

	let toolbar = parent.querySelector<HTMLElement>(':scope > .hl-shelf-toolbar');
	if (!toolbar) {
		parent.empty();
		toolbar = buildToolbar(host, parent, ctx);
	}
	// Toolbar outside the scroll zone (same rule as the library page).
	let scroll = parent.querySelector<HTMLElement>(':scope > .hl-shelf-scroll');
	if (!scroll) scroll = parent.createDiv('hl-shelf-scroll');
	let body = scroll.querySelector<HTMLElement>(':scope > .hl-shelf-notebooks');
	if (!body) body = scroll.createDiv('hl-shelf-notebooks');

	renderGridBody(host, toolbar, body, highlights, ctx);
}

/** Search + sort + format filter + count row (persists across body renders). */
function buildToolbar(host: GridHost, parent: HTMLElement, ctx: NotebookPageCtx): HTMLElement {
	const plugin = host.plugin;
	const toolbar = parent.createDiv('hl-shelf-toolbar');

	const search = toolbar.createEl('input', {
		cls: 'hl-shelf-search',
		attr: {
			type: 'search',
			placeholder: t('bookshelf.notebook.search.placeholder'),
			'aria-label': t('bookshelf.notebook.search.placeholder'),
			value: ctx.getSearchQuery(),
		},
	});
	search.oninput = () => {
		ctx.setSearchQuery(search.value);
		ctx.onSearchChange();
	};

	const controls = toolbar.createDiv('hl-shelf-controls');
	const sortWrap = controls.createDiv('hl-shelf-sort-wrap');
	createMenuSelect(
		sortWrap,
		t('bookshelf.library.sort.label'),
		SORT_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) })),
		ctx.getSortBy(),
		(next) => {
			const option = SORT_OPTIONS.find(item => item.id === next);
			if (!option) return;
			ctx.setSortBy(option.id);
			ctx.onSearchChange();
		},
	);

	appendFormatFilter(plugin, controls, ctx.onScopeChange);

	const tail = controls.createDiv('hl-shelf-tail');
	const count = tail.createDiv('hl-shelf-count');
	count.setAttribute('aria-live', 'polite');

	return toolbar;
}

/** One grid entry: a highlighted source with its notebook stats. */
interface NotebookEntry {
	file: TFile;
	title: string;
	count: number;
	lastAt: number;
}

function notebookEntries(
	host: GridHost,
	highlights: HighlightNote[],
	format: string,
): NotebookEntry[] {
	const bookMeta = host.plugin.settings.bookshelfBookMeta ?? {};
	const entries: NotebookEntry[] = [];
	// Notebooks cover every highlighted source, not a recency window.
	for (const source of computeRecentSources(highlights, Number.MAX_SAFE_INTEGER)) {
		const file = host.app.vault.getAbstractFileByPath(source.path);
		if (!(file instanceof TFile)) continue;
		if (format !== 'all' && shelfKind(file.extension) !== format) continue;
		entries.push({
			file,
			title: bookMeta[source.path]?.title || file.basename,
			count: source.count,
			lastAt: source.lastAt,
		});
	}
	return entries;
}

function renderGridBody(
	host: GridHost,
	toolbar: HTMLElement,
	body: HTMLElement,
	highlights: HighlightNote[],
	ctx: NotebookPageCtx,
): void {
	const plugin = host.plugin;
	const settings = plugin.settings;
	const format = settings.bookshelfFormatFilter || 'all';
	const sortBy = ctx.getSortBy();
	const query = ctx.getSearchQuery();
	const picks = settings.bookshelfNotebookCovers;
	const size = effectiveCoverSize(settings.bookshelfCoverSize);

	const allEntries = notebookEntries(host, highlights, format);
	const entries = allEntries
		.filter(entry => matchesBookTitle(query, entry.title, entry.file.basename))
		.sort((a, b) => {
			if (sortBy === 'count') return b.count - a.count || b.lastAt - a.lastAt;
			if (sortBy === 'title') {
				return a.title.localeCompare(b.title, undefined, { numeric: true });
			}
			return b.lastAt - a.lastAt;
		});

	const countEl = toolbar.querySelector<HTMLElement>('.hl-shelf-count');
	if (countEl) {
		countEl.setText(entries.length !== allEntries.length || query.trim()
			? t('bookshelf.notebook.countFiltered', { count: entries.length, total: allEntries.length })
			: t('bookshelf.notebook.count', { count: entries.length }));
	}

	const emptyText = query.trim()
		? t('bookshelf.notebook.noMatches', { query: query.trim() })
		: format === 'all'
			? t('bookshelf.notebook.empty')
			: t('bookshelf.notebook.emptyFiltered', { format: t(`bookshelf.kind.${format}`) });

	// Idempotence gate (same rationale as the library page): an
	// unchanged visible outcome never touches the DOM.
	const sig = [
		size,
		sortBy,
		entries.length === 0
			? `empty:${emptyText}`
			: entries.map(e => `${e.file.path}@${e.count}@${e.title}@${notebookPattern(picks, e.file.path)}`).join('|'),
	].join('::');
	if (body.getAttribute('data-render-sig') === sig) return;
	body.setAttribute('data-render-sig', sig);

	body.empty();
	if (entries.length === 0) {
		const empty = body.createDiv('hl-shelf-empty');
		empty.createDiv({ cls: 'hl-shelf-empty-text', text: emptyText });
		return;
	}

	const grid = body.createDiv('hl-shelf-grid');
	grid.setAttribute('data-size', size);

	for (const entry of entries) {
		const kind = shelfKind(entry.file.extension) ?? 'markdown';
		const card = grid.createDiv('hl-book hl-notebook');
		card.setAttribute('data-path', entry.file.path);
		card.setAttribute('role', 'button');
		card.setAttribute('tabindex', '0');

		const cover = createNotebookCover(host, card, entry.file.path, picks, { title: entry.title });
		mountKindBadge(cover, kind);

		// Pattern picker: chromeless palette chip, hover-revealed like
		// the shelf's favorite heart (always tappable on touch). Opens
		// the plain pattern text list.
		const pick = cover.createSpan({
			cls: 'hl-notebook-pick',
			attr: {
				role: 'button',
				'aria-label': t('bookshelf.notebook.pickCover'),
				title: t('bookshelf.notebook.pickCover'),
			},
		});
		setIcon(pick, 'palette');
		pick.onclick = (event) => {
			event.stopPropagation();
			void openPatternListMenu(host, event, entry.file.path, cover);
		};

		const info = card.createDiv('hl-book-info');
		info.createDiv({ cls: 'hl-book-title', text: entry.title });
		info.createDiv({
			cls: 'hl-book-sub',
			text: t('bookshelf.notebook.subtitle', {
				count: entry.count,
				time: relativeTime(entry.lastAt),
			}),
		});

		const open = (): void => {
			ctx.setOpenPath(entry.file.path);
			ctx.onSearchChange();
		};
		card.onclick = open;
		card.onkeydown = (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				open();
			}
		};

		// Right-click / long-press: change cover + export to Markdown.
		card.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			openNotebookCardMenu(host, event, entry.file.path, entry.title, highlights, cover);
		});
	}
}

/**
 * Notebook card context menu: rename, change cover (plain pattern
 * text list) and the whole-notebook Markdown export.
 */
function openNotebookCardMenu(
	host: GridHost,
	event: MouseEvent,
	path: string,
	title: string,
	highlights: HighlightNote[],
	coverEl: HTMLElement,
): void {
	const menu = new Menu();
	menu.addItem(item => item
		.setTitle(t('bookshelf.notebook.menu.rename'))
		.setIcon('pencil')
		.onClick(() => {
			new TextInputModal(host.app, {
				title: t('bookshelf.notebook.rename.title'),
				value: title,
				placeholder: t('bookshelf.notebook.rename.placeholder'),
				onSubmit: (value) => renameNotebook(host, path, value, coverEl),
			}).open();
		}));
	menu.addItem(item => item
		.setTitle(t('bookshelf.notebook.menu.changeCover'))
		.setIcon('palette')
		.onClick(() => { void openPatternListMenu(host, event, path, coverEl); }));
	menu.addItem(item => item
		.setTitle(t('bookshelf.notebook.menu.export'))
		.setIcon('file-output')
		.onClick(() => {
			void exportNotebookAsMarkdown(
				host.app,
				host.plugin.settings.groupExportFolder || '',
				title,
				path,
				notebookNotes(highlights, path),
			);
		}));
	menu.showAtMouseEvent(event);
}

/**
 * Renames a notebook by overriding the book metadata title. The
 * notebook↔book link is the vault path (highlights' sourcePath) — a
 * title override cannot touch it. Empty input clears the override and
 * restores the book's own title; the card repaints in place.
 */
function renameNotebook(host: GridHost, path: string, value: string, coverEl: HTMLElement): void {
	const plugin = host.plugin;
	const meta = plugin.settings.bookshelfBookMeta ?? {};
	const file = host.app.vault.getAbstractFileByPath(path);
	const fallback = file instanceof TFile ? file.basename : path;
	const nextTitle = value || fallback;
	plugin.settings.bookshelfBookMeta = {
		...meta,
		[path]: {
			...meta[path],
			// '' removes the override (falls back to the book title).
			...(value ? { title: value } : {}),
			updatedAt: Date.now(),
		},
	};
	void plugin.saveSettings().then(() => {
		// In-place patch: cover band + info-line titles, no grid rebuild.
		const card = coverEl.closest('.hl-notebook');
		const coverTitle = coverEl.querySelector<HTMLElement>('.hl-notebook-cover-title');
		if (coverTitle) coverTitle.setText(nextTitle);
		const infoTitle = card?.querySelector<HTMLElement>('.hl-book-title');
		if (infoTitle) infoTitle.setText(nextTitle);
	});
}

/**
 * The notebook cover frame. Pattern + title render immediately (pure
 * CSS or a covers/ image, nothing async), so no shimmer / observer
 * machinery is needed.
 */
export function createNotebookCover(
	host: GridHost,
	parent: HTMLElement,
	path: string,
	picks: Record<string, string> | undefined,
	opts?: { title?: string },
): HTMLElement {
	const cover = parent.createDiv('hl-book-cover hl-notebook-cover');
	const pattern = notebookPattern(picks, path);
	cover.setAttribute('data-pattern', pattern);
	const art = cover.createDiv('hl-notebook-art');
	applyCoverArt(host, art, pattern);
	cover.createDiv('hl-notebook-spine');
	if (opts?.title) {
		cover.createDiv({ cls: 'hl-notebook-cover-title', text: opts.title });
	}
	return cover;
}

/** Image-backed covers: `img:<file>` ids paint the art layer from a
 * file in the plugin's covers/ folder. CSS patterns stay pure CSS. */
function applyCoverArt(host: GridHost, art: HTMLElement, pattern: NotebookCoverPattern): void {
	if (!pattern.startsWith('img:')) return;
	const dir = host.plugin.manifest?.dir;
	if (!dir) return;
	const file = pattern.slice('img:'.length);
	const src = host.app.vault.adapter.getResourcePath(`${dir}/covers/${file}`);
	setCssProps(art, {
		'background-image': `url("${src}")`,
		'background-size': 'cover',
		'background-position': 'center',
	});
}

const COVER_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** Image cover files dropped into the plugin's covers/ folder. */
async function listCustomCoverImages(host: GridHost): Promise<string[]> {
	const dir = host.plugin.manifest?.dir;
	if (!dir) return [];
	try {
		const listing = await host.app.vault.adapter.list(`${dir}/covers`);
		return listing.files
			.map(file => file.split('/').pop() ?? '')
			.filter(name => COVER_IMAGE_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? ''));
	} catch {
		// Missing folder (the default): no image covers, nothing to do.
		return [];
	}
}

/** Persists a pattern pick and patches the cover in place (no rerender). */
function applyPatternPick(
	host: GridHost,
	path: string,
	pattern: NotebookCoverPattern,
	coverEl: HTMLElement,
): void {
	const settings = host.plugin.settings;
	settings.bookshelfNotebookCovers = {
		...(settings.bookshelfNotebookCovers ?? {}),
		[path]: pattern,
	};
	void host.plugin.saveSettings().then(() => {
		// In-place patch: switching a pattern must not flicker the grid
		// (no teardown, no scroll reset). Clear any image background so
		// img: → CSS switches drop the old picture.
		coverEl.setAttribute('data-pattern', pattern);
		const art = coverEl.querySelector<HTMLElement>('.hl-notebook-art');
		if (!art) return;
		setCssProps(art, { 'background-image': '', 'background-size': '', 'background-position': '' });
		applyCoverArt(host, art, pattern);
	});
}

/**
 * 更换封面 as a plain text list (native Menu): the twelve built-in
 * patterns, then any image covers found in covers/. The native menu
 * handles scrolling, outside-click and Escape dismissal.
 */
async function openPatternListMenu(
	host: GridHost,
	event: MouseEvent,
	path: string,
	coverEl: HTMLElement,
): Promise<void> {
	const images = await listCustomCoverImages(host);
	const current = coverEl.getAttribute('data-pattern') ?? '';
	const menu = new Menu();
	NOTEBOOK_PATTERNS.forEach(pattern => menu.addItem(item => item
		.setTitle(t(pattern.labelKey))
		.setChecked(pattern.id === current)
		.onClick(() => applyPatternPick(host, path, pattern.id, coverEl))));
	if (images.length > 0) {
		menu.addSeparator();
		menu.addItem(item => item
			.setTitle(t('bookshelf.notebook.menu.imageCovers'))
			.setIcon('image')
			.setIsLabel(true));
		images.forEach(file => menu.addItem(item => item
			.setTitle(file.replace(/\.[^.]+$/, ''))
			.setChecked(`img:${file}` === current)
			.onClick(() => applyPatternPick(host, path, `img:${file}`, coverEl))));
	}
	menu.showAtMouseEvent(event);
}

/** Format pill over the notebook cover (inline: needs the CSS class). */
function mountKindBadge(cover: HTMLElement, kind: string): void {
	const icons: Record<string, string> = {
		markdown: 'file-text',
		pdf: 'file-type',
		epub: 'book-open',
	};
	const shorts: Record<string, string> = {
		markdown: 'MD',
		pdf: 'PDF',
		epub: 'EPUB',
	};
	const badge = cover.createSpan({ cls: 'hl-book-kind' });
	setIcon(badge.createSpan({ cls: 'hl-book-kind-icon' }), icons[kind] ?? 'file');
	badge.createSpan({ cls: 'hl-book-kind-label', text: shorts[kind] ?? '' });
}

// ── Notebook reader (drill-down) ──────────────────────────

/** Document order: markdown/pdf lineIndex, epub CFI, created as fallback. */
function compareDocumentOrder(a: HighlightNote, b: HighlightNote): number {
	if (a.lineIndex !== b.lineIndex) return (a.lineIndex ?? 0) - (b.lineIndex ?? 0);
	if (a.cfi && b.cfi) {
		const cfi = compareEpubCfi(a.cfi, b.cfi);
		if (cfi !== 0) return cfi;
	}
	return a.createdAt - b.createdAt;
}

/** Source-anchored highlights of one notebook, in document order. */
function notebookNotes(highlights: HighlightNote[], path: string): HighlightNote[] {
	return highlights
		.filter(note => note.sourcePath === path && note.kind !== 'idea')
		.sort(compareDocumentOrder);
}

/**
 * The single-notebook reader: pattern cover + title header, then
 * every highlight of that source — original text first, the note
 * rendered as markdown beneath, jump-to-source at the foot.
 */
function renderNotebookReader(
	host: GridHost,
	parent: HTMLElement,
	path: string,
	highlights: HighlightNote[],
	ctx: NotebookPageCtx,
): void {
	const plugin = host.plugin;
	const settings = plugin.settings;
	const file = host.app.vault.getAbstractFileByPath(path);
	const bookMeta = settings.bookshelfBookMeta?.[path];
	const title = bookMeta?.title
		|| (file instanceof TFile ? file.basename : '')
		|| path.split('/').pop()?.replace(/\.[^.]+$/, '')
		|| path;

	const notes = notebookNotes(highlights, path);
	const withNotes = notes.filter(note => note.note.trim()).length;
	const lastAt = notes.reduce((max, note) => Math.max(max, note.createdAt), 0);

	const scroll = parent.createDiv('hl-shelf-scroll');
	const wrap = scroll.createDiv('hl-notebook-detail');

	// Bar: back to the notebook grid (left) / open the book itself (right)
	const bar = wrap.createDiv('hl-notebook-bar');
	const back = bar.createEl('button', {
		cls: 'hl-notebook-back',
		attr: { 'aria-label': t('bookshelf.notebook.back'), title: t('bookshelf.notebook.back') },
	});
	setIcon(back.createSpan({ cls: 'hl-notebook-back-icon' }), 'arrow-left');
	back.createSpan({ text: t('bookshelf.notebook.back') });
	back.onclick = () => {
		ctx.setOpenPath(null);
		ctx.onScopeChange();
	};

	if (file instanceof TFile) {
		const openBook = bar.createEl('button', {
			cls: 'hl-notebook-openbook',
			attr: { 'aria-label': t('bookshelf.notebook.openBook'), title: t('bookshelf.notebook.openBook') },
		});
		setIcon(openBook.createSpan({ cls: 'hl-notebook-openbook-icon' }), 'book-open');
		openBook.createSpan({ text: t('bookshelf.notebook.openBook') });
		openBook.onclick = () => { void openShelfFile(host.app, path); };
	}

	// Header: the notebook's own pattern cover + title + stats
	const head = wrap.createDiv('hl-notebook-head');
	createNotebookCover(host, head, path, settings.bookshelfNotebookCovers, { title });
	const info = head.createDiv('hl-notebook-head-info');
	info.createDiv({ cls: 'hl-notebook-head-title', text: title });
	info.createDiv({
		cls: 'hl-notebook-head-sub',
		text: t('bookshelf.notebook.subtitle', {
			count: notes.length,
			time: lastAt ? relativeTime(lastAt) : '',
		}),
	});
	if (withNotes > 0) {
		info.createDiv({
			cls: 'hl-notebook-head-notes',
			text: t('bookshelf.notebook.withNotes', { count: withNotes }),
		});
	}
	if (!(file instanceof TFile)) {
		info.createDiv({
			cls: 'hl-notebook-head-missing',
			text: t('bookshelf.notebook.missing'),
		});
	}

	// Entries: original text + note per highlight
	const list = wrap.createDiv('hl-notebook-list');
	if (notes.length === 0) {
		const empty = list.createDiv('hl-shelf-empty');
		empty.createDiv({ cls: 'hl-shelf-empty-text', text: t('bookshelf.notebook.emptyNotes') });
		return;
	}

	// Throwaway lifecycle owner for the markdown previews below.
	const component = new DetachedComponent();
	for (const note of notes) {
		buildReaderEntry(host, list, note, component, ctx, title);
	}
}

/** One highlight entry in the reader: text, note, actions. */
function buildReaderEntry(
	host: GridHost,
	parent: HTMLElement,
	note: HighlightNote,
	component: DetachedComponent,
	ctx: NotebookPageCtx,
	bookTitle: string,
): void {
	const hex = resolveHex(host.plugin.settings, note.color);
	const entry = parent.createDiv('hl-notebook-entry');
	entry.setAttribute('data-color', note.color);
	entry.setCssProps({ '--hl-note-entry-color': hex });

	const head = entry.createDiv('hl-notebook-entry-head');
	head.createSpan({ cls: 'hl-notebook-dot' });
	const meta = head.createSpan({ cls: 'hl-notebook-entry-meta' });
	const bits: string[] = [];
	if (typeof note.pdfPage === 'number') bits.push(t('bookshelf.notebook.page', { page: note.pdfPage }));
	const time = relativeTime(note.createdAt);
	if (time) bits.push(time);
	meta.setText(bits.join(' · '));

	// Top-right action pair: save as Markdown / download quote-card
	// image — chromeless icons, no button chrome.
	const actions = head.createDiv('hl-notebook-entry-actions');
	const saveLabel = t('bookshelf.notebook.exportSingle');
	const saveBtn = actions.createSpan({
		cls: 'hl-notebook-act',
		attr: { role: 'button', 'aria-label': saveLabel, title: saveLabel, tabindex: '0' },
	});
	setIcon(saveBtn, 'file-down');
	saveBtn.onclick = (event) => {
		event.stopPropagation();
		void exportNotebookEntryAsMarkdown(
			host.app,
			host.plugin.settings.groupExportFolder || '',
			note,
		);
	};
	const imageLabel = t('bookshelf.notebook.exportImage');
	const imageBtn = actions.createSpan({
		cls: 'hl-notebook-act',
		attr: { role: 'button', 'aria-label': imageLabel, title: imageLabel, tabindex: '0' },
	});
	setIcon(imageBtn, 'image-down');
	imageBtn.onclick = (event) => {
		event.stopPropagation();
		new QuoteCardModal(host.app, note, bookTitle).open();
	};

	entry.createDiv({ cls: 'hl-notebook-entry-text', text: note.text });

	// The note: rendered markdown (or a boxless add-note hint), click
	// to edit in place.
	const noteBlock = entry.createDiv(
		`hl-notebook-entry-note is-editable${note.note.trim() ? '' : ' is-empty'}`,
	);
	mountNotePreview(host, noteBlock, note, component);
	noteBlock.setAttribute('role', 'button');
	noteBlock.setAttribute('tabindex', '0');
	noteBlock.setAttribute('aria-label', t('bookshelf.notebook.noteEdit'));
	noteBlock.setAttribute('title', t('bookshelf.notebook.noteEdit'));
	const edit = (event: MouseEvent | KeyboardEvent): void => {
		// Already editing: clicks / keys inside the textarea bubble here
		// (Space used to re-enter edit, killing the live input).
		if (noteBlock.hasClass('is-editing')) return;
		// Links inside the preview open, they do not start an edit.
		const target = event.target as HTMLElement | null;
		if (target?.closest('a, .internal-link, img, textarea')) return;
		startNoteEdit(host, noteBlock, note, ctx);
	};
	noteBlock.onclick = edit;
	noteBlock.onkeydown = (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			edit(event);
		}
	};

	const foot = entry.createDiv('hl-notebook-entry-foot');
	// A span, not a <button>: Obsidian injects background / border /
	// shadow chrome on buttons that no CSS reset fully beats across
	// themes — spans get none, keeping the action truly chromeless.
	const jumpLabel = t('bookshelf.notebook.jump');
	const jump = foot.createSpan({
		cls: 'hl-notebook-jump',
		attr: { role: 'button', tabindex: '0', 'aria-label': jumpLabel, title: jumpLabel },
	});
	setIcon(jump.createSpan({ cls: 'hl-notebook-jump-icon' }), 'arrow-up-right');
	jump.createSpan({ text: jumpLabel });
	const jumpToSourceOf = (): void => { void jumpToSource(host.app, note); };
	jump.onclick = jumpToSourceOf;
	jump.onkeydown = (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			jumpToSourceOf();
		}
	};
}

/** Renders the note markdown into its block. */
function mountNotePreview(
	host: GridHost,
	noteBlock: HTMLElement,
	note: HighlightNote,
	component: DetachedComponent,
): void {
	noteBlock.empty();
	noteBlock.removeClass('is-editing');
	const hasNote = note.note.trim().length > 0;
	noteBlock.toggleClass('is-empty', !hasNote);
	if (hasNote) {
		// The preview renders into a holder child: if the user enters
		// edit mode before the async render lands, the late content
		// lands in the (detached) holder instead of the editing block.
		const holder = noteBlock.createDiv('hl-notebook-preview-holder');
		void renderMarkdownPreview(host.app, note.note, holder, note.sourcePath, component);
	} else {
		// Empty notes show only a muted hint — no box, no fill.
		noteBlock.createSpan({
			cls: 'hl-notebook-note-placeholder',
			text: t('bookshelf.notebook.noteEmpty'),
		});
	}
}

/**
 * Swaps the note preview for an auto-sized textarea. Blur or
 * Cmd/Ctrl+Enter saves (db write + view reload preserving scroll);
 * Escape discards. Empty edit = note removed.
 */
function startNoteEdit(
	host: GridHost,
	noteBlock: HTMLElement,
	note: HighlightNote,
	ctx: NotebookPageCtx,
): void {
	noteBlock.empty();
	noteBlock.addClass('is-editing');
	noteBlock.removeClass('is-empty');
	// Belt and suspenders: kill the block's own click / key handlers
	// while the textarea is live (Space inside the input must never
	// re-enter edit mode). The page remount restores them.
	noteBlock.onclick = null;
	noteBlock.onkeydown = null;
	noteBlock.removeAttribute('role');
	noteBlock.removeAttribute('tabindex');
	noteBlock.removeAttribute('title');
	noteBlock.removeAttribute('aria-label');

	const textarea = noteBlock.createEl('textarea', {
		cls: 'hl-notebook-note-input',
		attr: { rows: '1', 'aria-label': t('bookshelf.notebook.noteEdit') },
	});
	textarea.value = note.note;
	textarea.spellcheck = false;
	const resize = (): void => {
		textarea.setCssProps({ height: 'auto' });
		textarea.setCssProps({ height: `${textarea.scrollHeight + 2}px` });
	};
	textarea.oninput = resize;
	window.setTimeout(() => {
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		resize();
	}, 0);

	let settled = false;
	const settle = (save: boolean): void => {
		if (settled) return;
		settled = true;
		const value = textarea.value;
		if (!save || value === note.note) {
			ctx.onNotesChanged();
			return;
		}
		void db.updateHighlightNote(note.id, { note: value })
			.then(() => {
				// Silent save: the re-rendered note is the feedback; no
				// popup to dismiss mid-typing flow.
				ctx.onNotesChanged();
			})
			.catch(err => {
				console.error('[HiLighter] notebook note edit failed:', note.id, err);
				new Notice(t('bookshelf.notebook.noteSaveFailed'));
				ctx.onNotesChanged();
			});
	};
	textarea.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			settle(false);
		} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			settle(true);
		}
	});
	textarea.addEventListener('blur', () => { settle(true); });
}
