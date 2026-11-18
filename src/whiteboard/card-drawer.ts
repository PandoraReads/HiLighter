import { setIcon, type App } from 'obsidian';
import { cardDisplayTitle, cardPreviewMarkdown, cardSearchText, cardTitle } from '../card-templates';
import { getColorDef } from '../colors';
import { getLang } from '../i18n';
import type { HiLighterSettings, HighlightNote } from '../models';
import { CARD_DRAG_BATCH_MIME, CARD_DRAG_MIME, dragCardIds } from '../studio/card-drag-selection';
import { UNTAGGED_KEY } from '../studio/grouping';
import { setCssProps } from '../utils/css-props';

export interface CardDrawerOptions {
	app: App;
	settings: HiLighterSettings;
	highlights: HighlightNote[];
	onBoardIds: ReadonlySet<string>;
	onAddCards: (ids: string[]) => void;
	onEditCard?: (note: HighlightNote) => void;
	collapsed?: boolean;
	onToggleCollapse?: (collapsed: boolean) => void;
}

export interface TagCountEntry {
	tag: string;
	count: number;
}

function drawerLabel(zh: string, en: string): string {
	return getLang() === 'zh' ? zh : en;
}

function normalizeTag(raw: string): string {
	return raw.trim().replace(/^#+/, '');
}

function getCardTags(note: HighlightNote): string[] {
	if (!note.tags || note.tags.length === 0) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of note.tags) {
		const normalized = normalizeTag(raw);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

function sourceFileName(sourcePath: string): string {
	const trimmed = sourcePath.trim();
	if (!trimmed) return '';
	const parts = trimmed.split('/');
	const last = parts[parts.length - 1] ?? '';
	return last.replace(/\.[^.]+$/, '');
}

function truncateSnippet(text: string, maxLength = 120): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (!clean) return '';
	return clean.length > maxLength ? `${clean.slice(0, maxLength).trimEnd()}…` : clean;
}

/**
 * Collapsible left Card Library Drawer for the Whiteboard view.
 * Supports keyword search, tag pill filtering (with All / Untagged),
 * hiding cards already on board, multi-select batch add, `+` quick add,
 * and dragging single or batched cards onto the canvas.
 */
export class CardDrawer {
	private readonly container: HTMLElement;
	private options: CardDrawerOptions;

	private collapsed: boolean;
	private searchQuery = '';
	private readonly selectedTags = new Set<string>();
	private hideOnBoard = false;
	private readonly selectedIds = new Set<string>();

	private rootEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private searchClearBtn: HTMLButtonElement | null = null;
	private hideOnBoardInput: HTMLInputElement | null = null;
	private countEl: HTMLElement | null = null;
	private tagBarEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private batchBarEl: HTMLElement | null = null;
	private collapseBtnEl: HTMLButtonElement | null = null;

	constructor(container: HTMLElement, options: CardDrawerOptions) {
		this.container = container;
		this.options = options;
		this.collapsed = Boolean(options.collapsed);
		this.buildShell();
		this.renderDynamicSections();
	}

	/** Updates drawer data/callbacks and re-renders tag pills, card list, and batch bar. */
	update(patch: Partial<CardDrawerOptions>): void {
		this.options = { ...this.options, ...patch };
		if (patch.collapsed !== undefined) {
			this.collapsed = patch.collapsed;
			this.syncCollapsedState();
		}
		// Prune selected IDs that no longer exist in highlights
		const validIds = new Set(this.options.highlights.map(h => h.id));
		for (const id of [...this.selectedIds]) {
			if (!validIds.has(id)) this.selectedIds.delete(id);
		}
		this.renderDynamicSections();
	}

	/** Returns whether the drawer is currently collapsed. */
	isCollapsed(): boolean {
		return this.collapsed;
	}

	/** Sets collapsed state and notifies host if changed. */
	setCollapsed(collapsed: boolean): void {
		if (this.collapsed === collapsed) return;
		this.collapsed = collapsed;
		this.syncCollapsedState();
		this.options.onToggleCollapse?.(this.collapsed);
	}

	/** Removes all rendered DOM nodes from the container. */
	destroy(): void {
		this.container.empty();
		this.rootEl = null;
		this.searchInputEl = null;
		this.searchClearBtn = null;
		this.hideOnBoardInput = null;
		this.countEl = null;
		this.tagBarEl = null;
		this.listEl = null;
		this.batchBarEl = null;
		this.collapseBtnEl = null;
	}

	private buildShell(): void {
		this.container.empty();
		const root = this.container.createDiv('hl-wb-drawer');
		this.rootEl = root;

		// Header
		const header = root.createDiv('hl-wb-drawer-header');
		const titleWrap = header.createDiv('hl-wb-drawer-title-wrap');
		const titleIcon = titleWrap.createSpan('hl-wb-drawer-title-icon');
		setIcon(titleIcon, 'layers');
		titleWrap.createSpan({
			cls: 'hl-wb-drawer-title',
			text: drawerLabel('卡片库', 'Card Library'),
		});
		this.countEl = titleWrap.createSpan('hl-wb-drawer-count');

		const collapseBtn = header.createEl('button', {
			cls: 'hl-wb-drawer-collapse-btn',
			type: 'button',
		});
		this.collapseBtnEl = collapseBtn;
		collapseBtn.onclick = () => {
			this.setCollapsed(!this.collapsed);
		};

		// Body (hidden via CSS when .is-collapsed is set on root)
		const body = root.createDiv('hl-wb-drawer-body');

		// Search bar
		const searchWrap = body.createDiv('hl-wb-drawer-search');
		const searchIcon = searchWrap.createSpan('hl-wb-drawer-search-icon');
		setIcon(searchIcon, 'search');

		const searchInput = searchWrap.createEl('input', {
			cls: 'hl-wb-drawer-search-input',
			type: 'search',
			placeholder: drawerLabel('搜索卡片、批注或标签…', 'Search cards, notes, tags…'),
		});
		searchInput.value = this.searchQuery;
		this.searchInputEl = searchInput;

		const clearBtn = searchWrap.createEl('button', {
			cls: 'hl-wb-drawer-search-clear',
			type: 'button',
			attr: { 'aria-label': drawerLabel('清空搜索', 'Clear search') },
		});
		setIcon(clearBtn, 'x');
		clearBtn.toggleClass('is-hidden', !this.searchQuery);
		clearBtn.onclick = () => {
			this.searchQuery = '';
			searchInput.value = '';
			clearBtn.addClass('is-hidden');
			this.renderListAndBatch();
			searchInput.focus();
		};
		this.searchClearBtn = clearBtn;

		searchInput.oninput = () => {
			this.searchQuery = searchInput.value;
			clearBtn.toggleClass('is-hidden', !this.searchQuery);
			this.renderListAndBatch();
		};

		// Controls row: "Hide cards already on board"
		const controls = body.createDiv('hl-wb-drawer-controls');
		const toggleLabel = controls.createEl('label', { cls: 'hl-wb-drawer-toggle' });
		const hideCheckbox = toggleLabel.createEl('input', {
			cls: 'hl-wb-drawer-toggle-input',
			type: 'checkbox',
		});
		hideCheckbox.checked = this.hideOnBoard;
		hideCheckbox.onchange = () => {
			this.hideOnBoard = hideCheckbox.checked;
			this.renderDynamicSections();
		};
		this.hideOnBoardInput = hideCheckbox;
		toggleLabel.createSpan({
			cls: 'hl-wb-drawer-toggle-text',
			text: drawerLabel('隐藏已在白板中的卡片', 'Hide cards already on board'),
		});

		// Tag pills bar
		this.tagBarEl = body.createDiv('hl-wb-drawer-tags');

		// Card list
		this.listEl = body.createDiv('hl-wb-drawer-list');

		// Batch selection footer
		this.batchBarEl = body.createDiv('hl-wb-drawer-batch is-hidden');

		this.syncCollapsedState();
	}

	private syncCollapsedState(): void {
		if (!this.rootEl || !this.collapseBtnEl) return;
		this.rootEl.toggleClass('is-collapsed', this.collapsed);
		this.collapseBtnEl.empty();
		setIcon(this.collapseBtnEl, this.collapsed ? 'panel-left-open' : 'panel-left-close');
		const tip = this.collapsed
			? drawerLabel('展开卡片库', 'Expand card library')
			: drawerLabel('折叠卡片库', 'Collapse card library');
		this.collapseBtnEl.setAttribute('aria-label', tip);
		this.collapseBtnEl.setAttribute('title', tip);
	}

	private renderDynamicSections(): void {
		if (this.hideOnBoardInput) {
			this.hideOnBoardInput.checked = this.hideOnBoard;
		}
		if (this.searchClearBtn) {
			this.searchClearBtn.toggleClass('is-hidden', !this.searchQuery);
		}
		this.renderTagBar();
		this.renderListAndBatch();
	}

	private computeTagStats(): { total: number; untagged: number; tags: TagCountEntry[] } {
		const counts = new Map<string, number>();
		let untagged = 0;
		for (const note of this.options.highlights) {
			const tags = getCardTags(note);
			if (tags.length === 0) {
				untagged += 1;
				continue;
			}
			for (const tag of tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		const tags: TagCountEntry[] = [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
		return { total: this.options.highlights.length, untagged, tags };
	}

	private renderTagBar(): void {
		const bar = this.tagBarEl;
		if (!bar) return;
		bar.empty();

		const { total, untagged, tags } = this.computeTagStats();

		// All pill
		const allBtn = bar.createEl('button', {
			cls: 'hl-wb-drawer-tag-pill',
			type: 'button',
		});
		allBtn.toggleClass('is-active', this.selectedTags.size === 0);
		allBtn.createSpan({ text: drawerLabel('全部', 'All') });
		allBtn.createSpan({ cls: 'hl-wb-drawer-tag-count', text: String(total) });
		allBtn.onclick = () => {
			if (this.selectedTags.size === 0) return;
			this.selectedTags.clear();
			this.renderTagBar();
			this.renderListAndBatch();
		};

		// Untagged pill
		if (untagged > 0) {
			const untaggedBtn = bar.createEl('button', {
				cls: 'hl-wb-drawer-tag-pill is-untagged',
				type: 'button',
			});
			untaggedBtn.toggleClass('is-active', this.selectedTags.has(UNTAGGED_KEY));
			untaggedBtn.createSpan({ text: drawerLabel('未打标签', 'Untagged') });
			untaggedBtn.createSpan({ cls: 'hl-wb-drawer-tag-count', text: String(untagged) });
			untaggedBtn.onclick = () => {
				this.toggleTagFilter(UNTAGGED_KEY);
			};
		}

		// Individual #tag pills
		for (const entry of tags) {
			const pill = bar.createEl('button', {
				cls: 'hl-wb-drawer-tag-pill',
				type: 'button',
			});
			pill.toggleClass('is-active', this.selectedTags.has(entry.tag));
			pill.createSpan({ text: `#${entry.tag}` });
			pill.createSpan({ cls: 'hl-wb-drawer-tag-count', text: String(entry.count) });
			pill.onclick = () => {
				this.toggleTagFilter(entry.tag);
			};
		}
	}

	private toggleTagFilter(tagKey: string): void {
		if (this.selectedTags.has(tagKey)) {
			this.selectedTags.delete(tagKey);
		} else {
			this.selectedTags.add(tagKey);
		}
		this.renderTagBar();
		this.renderListAndBatch();
	}

	private getFilteredHighlights(): HighlightNote[] {
		const query = this.searchQuery.trim().toLowerCase();
		const { onBoardIds } = this.options;

		return this.options.highlights.filter((note) => {
			if (this.hideOnBoard && onBoardIds.has(note.id)) {
				return false;
			}
			if (this.selectedTags.size > 0) {
				const tags = getCardTags(note);
				const matchesUntagged = this.selectedTags.has(UNTAGGED_KEY) && tags.length === 0;
				const matchesTag = tags.some(tag => this.selectedTags.has(tag));
				if (!matchesUntagged && !matchesTag) {
					return false;
				}
			}
			if (query && !cardSearchText(note).includes(query)) {
				return false;
			}
			return true;
		});
	}

	private renderListAndBatch(): void {
		const filtered = this.getFilteredHighlights();
		if (this.countEl) {
			this.countEl.setText(`${filtered.length}/${this.options.highlights.length}`);
		}
		this.renderCardList(filtered);
		this.renderBatchBar();
	}

	private renderCardList(notes: HighlightNote[]): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();

		if (notes.length === 0) {
			const empty = list.createDiv('hl-wb-drawer-empty');
			empty.setText(
				this.options.highlights.length === 0
					? drawerLabel('暂无高亮卡片', 'No highlight cards yet')
					: drawerLabel('没有匹配的卡片', 'No matching cards'),
			);
			return;
		}

		for (const note of notes) {
			this.renderCardItem(list, note);
		}
	}

	private renderCardItem(parent: HTMLElement, note: HighlightNote): void {
		const isOnBoard = this.options.onBoardIds.has(note.id);
		const isSelected = this.selectedIds.has(note.id);

		const card = parent.createDiv('hl-wb-drawer-card');
		card.toggleClass('is-on-board', isOnBoard);
		card.toggleClass('is-selected', isSelected);

		const colorHex = getColorDef(this.options.settings, note.color)?.hex || note.colorHex || '#9e9e9e';
		setCssProps(card, { '--hl-card-mark': colorHex });

		// Draggable support (single or multi-selected batch)
		card.setAttribute('draggable', 'true');
		card.ondragstart = (event: DragEvent) => {
			if (!event.dataTransfer) return;
			event.stopPropagation();
			const ids = dragCardIds(note.id, this.selectedIds);
			event.dataTransfer.effectAllowed = 'copyLink';
			event.dataTransfer.setData(CARD_DRAG_MIME, note.id);
			event.dataTransfer.setData(CARD_DRAG_BATCH_MIME, JSON.stringify(ids));
			event.dataTransfer.setData('text/plain', cardTitle(note));
		};

		// Top row: checkbox + title + badges + quick add button
		const topRow = card.createDiv('hl-wb-drawer-card-top');

		const checkbox = topRow.createEl('input', {
			cls: 'hl-wb-drawer-card-check',
			type: 'checkbox',
			attr: { 'aria-label': drawerLabel('选择卡片', 'Select card') },
		});
		checkbox.checked = isSelected;
		checkbox.onclick = (event: MouseEvent) => {
			event.stopPropagation();
		};
		checkbox.onchange = () => {
			if (checkbox.checked) this.selectedIds.add(note.id);
			else this.selectedIds.delete(note.id);
			card.toggleClass('is-selected', checkbox.checked);
			this.renderBatchBar();
		};

		const titleEl = topRow.createDiv('hl-wb-drawer-card-title');
		titleEl.setText(cardDisplayTitle(note, 64) || drawerLabel('无标题卡片', 'Untitled card'));

		if (isOnBoard) {
			topRow.createSpan({
				cls: 'hl-wb-drawer-onboard-badge',
				text: drawerLabel('已在白板', 'On board'),
			});
		}

		const addBtn = topRow.createEl('button', {
			cls: 'hl-wb-drawer-add-btn',
			type: 'button',
			attr: {
				'aria-label': drawerLabel('添加到白板', 'Add to board'),
				title: drawerLabel('添加到白板', 'Add to board'),
			},
		});
		setIcon(addBtn, 'plus');
		addBtn.onclick = (event: MouseEvent) => {
			event.stopPropagation();
			const ids = dragCardIds(note.id, this.selectedIds);
			this.options.onAddCards(ids);
		};

		// Note / excerpt snippet
		const previewRaw = cardPreviewMarkdown(note);
		const titleText = cardTitle(note);
		const snippetSource = previewRaw || (note.title && note.text !== titleText ? note.text : '');
		const snippet = truncateSnippet(snippetSource, 110);
		if (snippet) {
			card.createDiv({
				cls: 'hl-wb-drawer-card-snippet',
				text: snippet,
			});
		}

		// Footer: tags + source name
		const tags = getCardTags(note);
		const source = sourceFileName(note.sourcePath);
		if (tags.length > 0 || source) {
			const footer = card.createDiv('hl-wb-drawer-card-footer');
			if (tags.length > 0) {
				const tagWrap = footer.createDiv('hl-wb-drawer-card-tags');
				for (const tag of tags) {
					tagWrap.createSpan({
						cls: 'hl-wb-drawer-card-tag',
						text: `#${tag}`,
					});
				}
			}
			if (source) {
				footer.createSpan({
					cls: 'hl-wb-drawer-card-source',
					text: source,
				});
			}
		}

		// Click card body to edit if callback is provided
		card.onclick = () => {
			this.options.onEditCard?.(note);
		};
	}

	private renderBatchBar(): void {
		const bar = this.batchBarEl;
		if (!bar) return;
		bar.empty();

		const count = this.selectedIds.size;
		if (count === 0) {
			bar.addClass('is-hidden');
			return;
		}
		bar.removeClass('is-hidden');

		const addBatchBtn = bar.createEl('button', {
			cls: 'hl-wb-drawer-batch-add mod-cta',
			type: 'button',
			text: drawerLabel(`添加 ${count} 张到白板`, `Add ${count} to board`),
		});
		addBatchBtn.onclick = () => {
			const ids = [...this.selectedIds];
			if (ids.length === 0) return;
			this.options.onAddCards(ids);
			this.selectedIds.clear();
			this.renderListAndBatch();
		};

		const clearSelBtn = bar.createEl('button', {
			cls: 'hl-wb-drawer-batch-clear',
			type: 'button',
			text: drawerLabel('取消选择', 'Clear'),
		});
		clearSelBtn.onclick = () => {
			this.selectedIds.clear();
			this.renderListAndBatch();
		};
	}
}

/** Convenience helper to mount a CardDrawer instance into a container element. */
export function renderCardDrawer(container: HTMLElement, options: CardDrawerOptions): CardDrawer {
	return new CardDrawer(container, options);
}
