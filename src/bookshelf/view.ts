// ============================================================
// HiLighter - Bookshelf navigation view (desktop)
// ============================================================
// Desktop home page for the whole plugin: recent reading, the
// folder-scoped book shelf, and entries to cards / mind map / stats.
// Theme + light-dark controls live here (moved from the studio
// topbar); FSRS review keeps its entry in the card studio. Phones
// keep the original sidebar flows.

import { ItemView, WorkspaceLeaf, Notice, Platform, setIcon, TFile, TFolder } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import type { ThemeId } from '../models';
import { t } from '../i18n';
import { db } from '../db';
import type { HighlightNote } from '../models';
import type HiLighterPlugin from '../main';
import { applyAppearance } from '../appearance';
import {
	BOOKSHELF_VIEW_TYPE,
	HIGHLIGHT_MANAGER_VIEW_TYPE,
	MINDMAP_VIEW_TYPE,
} from '../view-types';
import { renderStatsPanel } from '../studio/stats';
import { renderRecentPage } from './recent-page';
import { renderLibraryPage } from './library-page';
import { ShelfCoverCache } from './covers';
import { isShelfRelevantPath, normalizeIncludeFolders, shelfKind } from './scope';

export type BookshelfTab = 'recent' | 'library' | 'cards' | 'mindmap' | 'stats';

const TABS: Array<{ id: BookshelfTab; labelKey: string; icon: string }> = [
	{ id: 'recent', labelKey: 'bookshelf.tab.recent', icon: 'history' },
	{ id: 'library', labelKey: 'bookshelf.tab.library', icon: 'library-big' },
	{ id: 'mindmap', labelKey: 'bookshelf.tab.mindmap', icon: 'git-fork' },
	{ id: 'stats', labelKey: 'bookshelf.tab.stats', icon: 'bar-chart-3' },
];

const THEMES: ThemeId[] = ['editorial', 'native', 'paper', 'ocean', 'forest', 'galaxy', 'cyber', 'sunset', 'rose'];

export class BookshelfView extends ItemView {
	plugin: HiLighterPlugin;
	activeTab: BookshelfTab = 'recent';

	/** Deck snapshot for the recent page + stats panel. */
	highlights: HighlightNote[] = [];

	/** Source-path index of `highlights` for cheap event filtering. */
	private highlightPaths: ReadonlySet<string> = new Set();

	private coverCache: ShelfCoverCache;
	private pageEl: HTMLElement | null = null;
	private refreshTimer: number | null = null;
	/** Library-page title search (transient, survives tab switches). */
	librarySearchQuery = '';
	/** Library-page multi-select state (transient). */
	private selectMode = false;
	private selectedBooks = new Set<string>();
	private tagFilter: string | null = null;
	/** Library-page favorites-only filter (transient). */
	private favoriteOnly = false;
	private dragDepth = 0;
	/** Library pagination (transient page; size persists in settings). */
	private libraryPage = 1;

	constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Shares the plugin-wide persistent cover store; the in-memory
		// memo is per view but store hits make reopens cheap.
		this.coverCache = new ShelfCoverCache(plugin.coverStore(), {
			isMobile: Platform.isMobile,
		});
	}

	getViewType(): string {
		return BOOKSHELF_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('bookshelf.viewName');
	}

	getIcon(): string {
		return 'library';
	}

	async onOpen(): Promise<void> {
		await this.loadHighlights();
		this.render();

		// Vault changes refresh the visible shelf pages, debounced —
		// but only changes that can actually affect them. Sync churn
		// (iCloud placeholder downloads, unrelated note edits) fires
		// these events in bursts; without a relevance gate every burst
		// tore down and rebuilt the whole view, which showed as
		// flicker + freezes on large vaults.
		// 'modify' is intentionally NOT observed: content edits change
		// neither the shelf listing nor the highlight database.
		const onChange = (target: TAbstractFile, oldPath?: string) => {
			if (this.isRelevantChange(target, oldPath)) this.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on('create', onChange));
		this.registerEvent(this.app.vault.on('delete', onChange));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => onChange(file, oldPath)));

		this.registerDragDrop();
	}

	/**
	 * True when a vault change can affect the visible page. Folders
	 * always count (a rename re-paths whole subtrees); files only when
	 * the shelf scans them (library tab) or they carry highlights
	 * (recent tab).
	 */
	private isRelevantChange(target: TAbstractFile, oldPath?: string): boolean {
		if (this.activeTab !== 'recent' && this.activeTab !== 'library') return false;
		if (target instanceof TFolder) return true;
		if (!(target instanceof TFile)) return false;
		const paths = oldPath ? [target.path, oldPath] : [target.path];
		if (this.activeTab === 'library') {
			return paths.some(path => isShelfRelevantPath(
				path,
				this.plugin.settings.bookshelfIncludeFolders,
				this.plugin.settings.bookshelfExcludeFolders,
			));
		}
		return paths.some(path => this.highlightPaths.has(path));
	}

	/** External files (Finder) dropped onto the shelf are imported. */
	private registerDragDrop(): void {
		const el = this.contentEl;
		const hasFiles = (event: DragEvent) =>
			Array.from(event.dataTransfer?.types ?? []).includes('Files');

		this.registerDomEvent(el, 'dragenter', (event: DragEvent) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			this.dragDepth++;
			el.addClass('is-drag-over');
		});
		this.registerDomEvent(el, 'dragover', (event: DragEvent) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		});
		this.registerDomEvent(el, 'dragleave', () => {
			this.dragDepth = Math.max(0, this.dragDepth - 1);
			if (this.dragDepth === 0) el.removeClass('is-drag-over');
		});
		this.registerDomEvent(el, 'drop', (event: DragEvent) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			this.dragDepth = 0;
			el.removeClass('is-drag-over');
			const files = Array.from(event.dataTransfer?.files ?? []);
			if (files.length > 0) void this.importExternalFiles(files);
		});
	}

	/** Import destination: the first include folder, else the vault root. */
	private importDestination(): string {
		const include = normalizeIncludeFolders(this.plugin.settings.bookshelfIncludeFolders);
		return include[0]?.path ?? '';
	}

	/** Finds a non-conflicting vault path for an imported file name. */
	private uniqueImportPath(folder: string, name: string): string {
		const sanitized = name.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'import';
		const dot = sanitized.lastIndexOf('.');
		const base = dot > 0 ? sanitized.slice(0, dot) : sanitized;
		const ext = dot > 0 ? sanitized.slice(dot) : '';
		const prefix = folder ? `${folder}/` : '';
		let candidate = `${prefix}${sanitized}`;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${prefix}${base} ${n}${ext}`;
			n++;
		}
		return candidate;
	}

	/** Copies supported external files into the vault (import folder). */
	private async importExternalFiles(files: File[]): Promise<void> {
		const supported = files.filter(file => {
			const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
			return shelfKind(extension) !== null;
		});
		if (supported.length === 0) {
			new Notice(t('bookshelf.import.unsupported'));
			return;
		}

		const folder = this.importDestination();
		let imported = 0;
		for (const file of supported) {
			try {
				const data = await file.arrayBuffer();
				const path = this.uniqueImportPath(folder, file.name);
				await this.app.vault.createBinary(path, data);
				imported++;
			} catch (err) {
				console.error('[HiLighter] bookshelf import failed:', file.name, err);
				new Notice(t('bookshelf.import.failed', { name: file.name }));
			}
		}

		if (imported > 0) {
			new Notice(t('bookshelf.import.imported', {
				count: imported,
				folder: folder || t('bookshelf.scope.root'),
			}));
			if (this.activeTab === 'library' || this.activeTab === 'recent') {
				void this.loadHighlights().then(() => this.render());
			}
		}
	}

	async onClose(): Promise<void> {
		this.coverCache.clear();
		// Persist any covers resolved during this view's lifetime.
		void this.plugin.coverStore().flush();
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	async loadHighlights(): Promise<void> {
		this.highlights = await db.getAllHighlights();
		this.highlightPaths = new Set(
			this.highlights.map(note => note.sourcePath).filter(Boolean),
		);
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('hl-studio');
		container.addClass('hl-shelf');
		applyAppearance(container, this.plugin.settings);
		container.setAttribute('data-hl-mode', this.plugin.settings.studioColorMode || 'auto');

		const layout = container.createDiv('hl-shelf-layout');
		this.buildHeader(layout);
		this.pageEl = layout.createDiv('hl-shelf-page');
		this.renderPage(this.pageEl);

		// Back-to-top floating button (semi-transparent, lower right);
		// hidden while the batch stack owns that corner.
		if (this.selectMode) container.addClass('is-selecting');
		const scrollTopBtn = container.createDiv('hl-shelf-scroll-top');
		scrollTopBtn.setAttribute('role', 'button');
		scrollTopBtn.setAttribute('aria-label', t('sidebar.backToTop'));
		scrollTopBtn.setAttribute('title', t('sidebar.backToTop'));
		setIcon(scrollTopBtn, 'arrow-up');
		const scrollEl = this.pageEl.querySelector<HTMLElement>('.hl-shelf-scroll');
		scrollTopBtn.onclick = () => { scrollEl?.scrollTo({ top: 0 }); };
		if (scrollEl) {
			scrollEl.onscroll = () => {
				scrollTopBtn.toggleClass('is-visible', scrollEl.scrollTop > 300);
			};
		}

		// External-file drop overlay (visible while dragging over the view)
		const dropzone = container.createDiv('hl-shelf-dropzone');
		const dropInner = dropzone.createDiv('hl-shelf-dropzone-inner');
		setIcon(dropInner.createDiv('hl-shelf-dropzone-icon'), 'file-plus');
		dropInner.createDiv({ cls: 'hl-shelf-dropzone-text', text: t('bookshelf.import.dropHint') });
	}

	/** Switches tabs; cards / mind map are full views and navigate away. */
	openTab(tab: BookshelfTab): void {
		if (tab === 'cards') {
			void this.plugin.activateView(HIGHLIGHT_MANAGER_VIEW_TYPE, 'main');
			return;
		}
		if (tab === 'mindmap') {
			void this.plugin.activateView(MINDMAP_VIEW_TYPE, 'main');
			return;
		}
		this.activeTab = tab;
		void this.loadHighlights().then(() => this.render());
	}

	/** Re-renders only the page body (tab bar stays mounted). */
	rerenderPage(): void {
		if (this.pageEl) this.renderPage(this.pageEl);
	}

	/** Live favorites set (shared by both grid pages). */
	favoritesSet(): Set<string> {
		return new Set(this.plugin.settings.bookshelfFavorites ?? []);
	}

	/** Toggles a book's favorite state (persisted). */
	async toggleFavorite(path: string): Promise<void> {
		const current = this.plugin.settings.bookshelfFavorites ?? [];
		const next = current.includes(path)
			? current.filter(p => p !== path)
			: [...current, path];
		this.plugin.settings.bookshelfFavorites = next;
		await this.plugin.saveSettings();
	}

	private renderPage(page: HTMLElement): void {
		page.empty();
		const favorites = {
			isFavorite: (path: string) => this.favoritesSet().has(path),
			onToggle: (path: string) => {
				void this.toggleFavorite(path).then(() => this.rerenderPage());
			},
		};
		switch (this.activeTab) {
			case 'recent':
				renderRecentPage(this, page, this.highlights, this.coverCache, {
					onSettingsChange: () => this.rerenderPage(),
					favorites,
				});
				break;
			case 'library':
				this.mountLibraryPage(page);
				break;
			case 'stats': {
				const scroll = page.createDiv('hl-shelf-scroll');
				renderStatsPanel(this, scroll);
				break;
			}
			default:
				break;
		}
	}

	/**
	 * Mounts (or refreshes) the library page. Re-mounting without an
	 * intervening page.empty() reuses the toolbar, so the search input
	 * keeps focus while the grid body rebuilds.
	 */
	private mountLibraryPage(page: HTMLElement): void {
		renderLibraryPage(this, page, this.highlights, this.coverCache, {
			// Scope-level changes (folders / sort / format / size / tags)
			// always restart from the first page.
			onScopeChange: () => {
				this.libraryPage = 1;
				this.rerenderPage();
			},
			onSearchChange: () => this.mountLibraryPage(page),
			getSearchQuery: () => this.librarySearchQuery,
			setSearchQuery: (query: string) => { this.librarySearchQuery = query; },
			isSelectMode: () => this.selectMode,
			setSelectMode: (on: boolean) => { this.selectMode = on; },
			getSelected: () => this.selectedBooks,
			toggleSelected: (path: string) => {
				if (this.selectedBooks.has(path)) {
					this.selectedBooks.delete(path);
					return false;
				}
				this.selectedBooks.add(path);
				return true;
			},
			clearSelection: () => { this.selectedBooks = new Set(); },
			getTagFilter: () => this.tagFilter,
			setTagFilter: (tag: string | null) => { this.tagFilter = tag; },
			getFavoriteOnly: () => this.favoriteOnly,
			setFavoriteOnly: (on: boolean) => { this.favoriteOnly = on; },
			getPage: () => this.libraryPage,
			setPage: (pageNumber: number) => { this.libraryPage = pageNumber; },
		});
	}

	// ── Header: brand + tabs + actions in one row ──

	private buildHeader(parent: HTMLElement): void {
		const bar = parent.createDiv('hl-studio-topbar hl-shelf-topbar');
		const identity = bar.createDiv('hl-studio-topbar-identity');
		identity.createSpan({ text: 'HiLighter', cls: 'hl-studio-topbar-brand' });
		identity.createSpan({ text: '/', cls: 'hl-studio-topbar-separator' });
		identity.createSpan({ text: t('bookshelf.viewName'), cls: 'hl-studio-topbar-title' });

		// Inline tab row between the brand and the right-side actions
		const tabs = bar.createDiv('hl-shelf-tabs');
		this.buildTabs(tabs);

		const actions = bar.createDiv('hl-studio-topbar-actions');

		// Card studio entry (moved here from the tab bar): opens the
		// full cards view in the main area.
		const cardsLabel = t('bookshelf.tab.cards');
		const cardsBtn = actions.createEl('button', {
			cls: 'hl-tool-btn hl-studio-topbar-button',
			attr: { 'aria-label': cardsLabel, title: cardsLabel },
		});
		setIcon(cardsBtn, 'layout-grid');
		cardsBtn.createSpan({ text: cardsLabel, cls: 'hl-tool-stats-label' });
		cardsBtn.onclick = () => this.openTab('cards');

		const themeWrap = actions.createDiv('hl-studio-theme-wrap');
		const themeIcon = themeWrap.createDiv('hl-studio-theme-icon');
		setIcon(themeIcon, 'palette');
		const themeSelect = themeWrap.createEl('select', {
			cls: 'hl-studio-theme-select',
			attr: { 'aria-label': t('settings.appearance.theme'), title: t('settings.appearance.theme') },
		});
		THEMES.forEach(theme => themeSelect.createEl('option', {
			text: t(`settings.theme.${theme}`),
			value: theme,
		}));
		themeSelect.value = this.plugin.settings.theme;
		themeSelect.onchange = () => {
			this.plugin.settings.theme = themeSelect.value as ThemeId;
			void this.plugin.saveSettings().then(() => this.plugin.refreshAllViews());
		};

		const currentMode = this.plugin.settings.studioColorMode || 'auto';
		const isDark = currentMode === 'dark' || (currentMode === 'auto' && document.body.classList.contains('theme-dark'));
		const nextMode = isDark ? 'light' : 'dark';
		const modeLabel = t(nextMode === 'dark' ? 'manager.theme.switchDark' : 'manager.theme.switchLight');
		const modeBtn = actions.createEl('button', {
			cls: 'hl-tool-btn hl-studio-mode-toggle hl-studio-icon-btn',
			attr: { 'aria-label': modeLabel, title: modeLabel },
		});
		setIcon(modeBtn, nextMode === 'dark' ? 'moon' : 'sun');
		modeBtn.onclick = () => {
			this.plugin.settings.studioColorMode = nextMode;
			void this.plugin.saveSettings().then(() => this.render());
		};
	}

	// ── Tab pills (rendered inline in the header) ──

	private buildTabs(parent: HTMLElement): void {
		const tabBar = parent;
		TABS.forEach(tab => {
			const active = this.activeTab === tab.id;
			const btn = tabBar.createEl('button', {
				cls: `hl-shelf-tab ${active ? 'is-active' : ''}`,
				attr: { role: 'tab', 'aria-selected': String(active), title: t(tab.labelKey) },
			});
			setIcon(btn.createSpan({ cls: 'hl-shelf-tab-icon' }), tab.icon);
			btn.createSpan({ text: t(tab.labelKey), cls: 'hl-shelf-tab-label' });
			btn.onclick = () => this.openTab(tab.id);
		});
	}

	/**
	 * Debounced vault-change refresh for the visible grid pages.
	 * Rebuilds only the page body — the header / tab bar stays mounted,
	 * so a refresh no longer flashes the whole view apart.
	 */
	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			if (this.activeTab !== 'recent' && this.activeTab !== 'library') return;
			void this.loadHighlights().then(() => this.rerenderPage());
		}, 1000);
	}
}
