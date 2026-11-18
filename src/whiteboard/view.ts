// ============================================================
// HiLighter - Whiteboard main-area view
// ============================================================
// Thin ItemView shell owning board lifecycle, topbar controls,
// debounced persistence, and live db.onChange synchronization
// between the left CardDrawer and right WhiteboardCanvas.

import {
	ItemView,
	Modal,
	Notice,
	WorkspaceLeaf,
	setIcon,
	type App,
} from 'obsidian';
import { applyAppearance } from '../appearance';
import { db } from '../db';
import { t } from '../i18n';
import type HiLighterPlugin from '../main';
import { randomUUID } from '../mocks/crypto';
import type { HighlightNote, WhiteboardDoc } from '../models';
import { jumpToSource } from '../studio/actions';
import { HighlightDetailModal } from '../studio/modals';
import { WHITEBOARD_VIEW_TYPE } from '../view-types';
import { WhiteboardCanvas } from './canvas';
import { CardDrawer } from './card-drawer';
import {
	exportWhiteboardToCanvasFile,
	exportWhiteboardToMarkdown,
} from './exporters';

const SAVE_DEBOUNCE_MS = 600;

function createEmptyWhiteboardDoc(title: string): WhiteboardDoc {
	const now = Date.now();
	return {
		id: randomUUID(),
		title,
		viewport: { x: 0, y: 0, zoom: 1 },
		nodes: [],
		sections: [],
		edges: [],
		createdAt: now,
		updatedAt: now,
	};
}

function buildCardsById(highlights: HighlightNote[]): Map<string, HighlightNote> {
	const map = new Map<string, HighlightNote>();
	for (const h of highlights) {
		map.set(h.id, h);
	}
	return map;
}

function collectOnBoardIds(doc: WhiteboardDoc | null): Set<string> {
	const ids = new Set<string>();
	if (!doc) return ids;
	for (const node of doc.nodes) {
		if (node.type === 'card' && node.highlightId) {
			ids.add(node.highlightId);
		}
	}
	return ids;
}

class WhiteboardNameModal extends Modal {
	private heading: string;
	private initialValue: string;
	private onSubmit: (name: string) => void;

	constructor(app: App, heading: string, initialValue: string, onSubmit: (name: string) => void) {
		super(app);
		this.heading = heading;
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hl-wb-modal');
		contentEl.createEl('h3', { text: this.heading, cls: 'hl-wb-modal-title' });

		const input = contentEl.createEl('input', {
			type: 'text',
			cls: 'hl-wb-modal-input',
			attr: { placeholder: t('whiteboard.board.namePlaceholder') },
		});
		input.value = this.initialValue;

		const submit = () => {
			const trimmed = input.value.trim();
			if (!trimmed) return;
			this.close();
			this.onSubmit(trimmed);
		};

		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submit();
			}
		});

		const footer = contentEl.createDiv('hl-wb-modal-footer');
		const cancelBtn = footer.createEl('button', {
			text: t('whiteboard.modal.cancel'),
			cls: 'hl-wb-modal-btn',
			attr: { type: 'button' },
		});
		cancelBtn.onclick = () => this.close();

		const okBtn = footer.createEl('button', {
			text: t('whiteboard.modal.confirm'),
			cls: 'hl-wb-modal-btn mod-cta',
			attr: { type: 'button' },
		});
		okBtn.onclick = submit;

		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 10);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class WhiteboardDeleteModal extends Modal {
	private message: string;
	private onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hl-wb-modal');
		contentEl.createEl('h3', { text: t('whiteboard.board.delete'), cls: 'hl-wb-modal-title' });
		contentEl.createEl('p', { text: this.message, cls: 'hl-wb-modal-desc' });

		const footer = contentEl.createDiv('hl-wb-modal-footer');
		const cancelBtn = footer.createEl('button', {
			text: t('whiteboard.modal.cancel'),
			cls: 'hl-wb-modal-btn',
			attr: { type: 'button' },
		});
		cancelBtn.onclick = () => this.close();

		const delBtn = footer.createEl('button', {
			text: t('whiteboard.modal.delete'),
			cls: 'hl-wb-modal-btn mod-warning',
			attr: { type: 'button' },
		});
		delBtn.onclick = () => {
			this.close();
			this.onConfirm();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class HighlightWhiteboardView extends ItemView {
	plugin: HiLighterPlugin;

	private docs: WhiteboardDoc[] = [];
	private currentDoc: WhiteboardDoc | null = null;
	private highlights: HighlightNote[] = [];
	private cardsById = new Map<string, HighlightNote>();

	private cardDrawer: CardDrawer | null = null;
	private canvas: WhiteboardCanvas | null = null;
	private drawerCollapsed = false;
	private exportMenuOpen = false;

	private saveTimer: number | null = null;
	private pendingSaveDoc: WhiteboardDoc | null = null;
	private selfSaving = false;
	private unsubDbChange: (() => void) | null = null;

	// Topbar element references updated in-place
	private boardSelectEl: HTMLSelectElement | null = null;
	private drawerToggleBtn: HTMLButtonElement | null = null;
	private tidyBtn: HTMLButtonElement | null = null;
	private zoomBtn: HTMLButtonElement | null = null;
	private panBtn: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HiLighterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return WHITEBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('whiteboard.viewName');
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	async onOpen(): Promise<void> {
		this.highlights = await db.getAllHighlights();
		this.cardsById = buildCardsById(this.highlights);
		this.docs = await db.listWhiteboards();

		if (this.docs.length === 0) {
			const initial = createEmptyWhiteboardDoc(t('whiteboard.defaultTitle'));
			await this.saveDocDirect(initial);
			this.docs = [initial];
		}

		this.currentDoc = this.docs[0] ?? null;
		this.render();

		this.unsubDbChange = db.onChange(() => {
			if (this.selfSaving) return;
			void this.handleDbChange();
		});

		this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
			if (!this.exportMenuOpen) return;
			const wrap = this.contentEl.querySelector('.hl-wb-export-wrap');
			if (wrap && !wrap.contains(e.target as Node)) {
				this.closeExportMenu();
			}
		});
	}

	async onClose(): Promise<void> {
		await this.flushSave();
		this.unsubDbChange?.();
		this.unsubDbChange = null;
		this.cardDrawer?.destroy();
		this.cardDrawer = null;
		this.canvas?.destroy();
		this.canvas = null;
		this.contentEl.empty();
	}

	// ── Layout & Rendering ────────────────────────────────────

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('hl-wb-view');
		applyAppearance(container, this.plugin.settings);
		container.setAttribute('data-hl-mode', this.plugin.settings.studioColorMode || 'auto');

		this.renderTopbar(container);

		const body = container.createDiv('hl-wb-body');
		const drawerHost = body.createDiv('hl-wb-drawer-host');
		const canvasHost = body.createDiv('hl-wb-canvas-host');

		this.cardDrawer?.destroy();
		this.cardDrawer = new CardDrawer(drawerHost, {
			app: this.app,
			settings: this.plugin.settings,
			highlights: this.highlights,
			onBoardIds: collectOnBoardIds(this.currentDoc),
			collapsed: this.drawerCollapsed,
			onAddCards: (ids) => {
				this.canvas?.insertCardsAtCenter(ids);
			},
			onEditCard: (note) => {
				this.openCardDetail(note);
			},
			onToggleCollapse: (collapsed) => {
				this.drawerCollapsed = collapsed;
				this.drawerToggleBtn?.toggleClass('is-active', !collapsed);
			},
		});

		this.canvas?.destroy();
		if (this.currentDoc) {
			this.canvas = new WhiteboardCanvas(canvasHost, {
				app: this.app,
				component: this,
				settings: this.plugin.settings,
				doc: this.currentDoc,
				cardsById: this.cardsById,
				onDocChange: (doc) => this.handleCanvasDocChange(doc),
				onOpenCardDetail: (note) => this.openCardDetail(note),
				onJumpToSource: (note) => {
					void jumpToSource(this.app, note);
				},
				onSelectionChange: (selectedIds) => {
					this.updateTidyButton(selectedIds.size);
				},
			});
		}

		this.updateZoomLabel();
		this.updateTidyButton(this.canvas?.getSelectedNodeIds().size ?? 0);
	}

	private renderTopbar(parent: HTMLElement): void {
		const bar = parent.createDiv('hl-wb-topbar');

		// Left: identity + board selector + board CRUD
		const left = bar.createDiv('hl-wb-topbar-left');
		const identity = left.createDiv('hl-wb-identity');
		identity.createSpan({ text: 'HiLighter', cls: 'hl-wb-brand' });
		identity.createSpan({ text: '/', cls: 'hl-wb-separator' });
		identity.createSpan({ text: t('whiteboard.viewName'), cls: 'hl-wb-title' });

		const controls = left.createDiv('hl-wb-board-controls');
		const select = controls.createEl('select', {
			cls: 'hl-wb-board-select',
			attr: { 'aria-label': t('whiteboard.board.select') },
		});
		this.boardSelectEl = select;
		this.populateBoardSelect();
		select.onchange = () => {
			const nextId = select.value;
			const target = this.docs.find((d) => d.id === nextId);
			if (target && target.id !== this.currentDoc?.id) {
				void this.switchBoard(target);
			}
		};

		this.iconButton(controls, 'plus', t('whiteboard.board.new'), () => {
			this.promptNewBoard();
		});
		this.iconButton(controls, 'pencil', t('whiteboard.board.rename'), () => {
			this.promptRenameBoard();
		});
		this.iconButton(controls, 'trash-2', t('whiteboard.board.delete'), () => {
			this.promptDeleteBoard();
		});

		// Right: drawer toggle + creation tools + zoom/pan + export
		const actions = bar.createDiv('hl-wb-actions');

		this.drawerToggleBtn = this.iconButton(actions, 'panel-left', t('whiteboard.toolbar.drawer'), () => {
			this.drawerCollapsed = !this.drawerCollapsed;
			this.cardDrawer?.setCollapsed(this.drawerCollapsed);
			this.drawerToggleBtn?.toggleClass('is-active', !this.drawerCollapsed);
		});
		this.drawerToggleBtn.toggleClass('is-active', !this.drawerCollapsed);

		actions.createSpan({ cls: 'hl-wb-topbar-divider' });

		this.iconButton(actions, 'sticky-note', t('whiteboard.toolbar.addText'), () => {
			this.canvas?.addTextNoteAtCenter();
		});
		this.iconButton(actions, 'square-dashed', t('whiteboard.toolbar.addSection'), () => {
			this.canvas?.addSectionAtCenter();
		});
		this.tidyBtn = this.iconButton(actions, 'layout-grid', t('whiteboard.toolbar.tidyGrid'), () => {
			this.canvas?.tidySelectedGrid();
		});

		actions.createSpan({ cls: 'hl-wb-topbar-divider' });

		this.iconButton(actions, 'zoom-out', t('whiteboard.toolbar.zoomOut'), () => {
			this.canvas?.zoomOut();
			this.updateZoomLabel();
		});

		const zoomBtn = actions.createEl('button', {
			cls: 'hl-wb-btn hl-wb-zoom-btn',
			text: '100%',
			attr: { type: 'button', title: t('whiteboard.toolbar.zoomReset') },
		});
		zoomBtn.onclick = () => {
			this.canvas?.fitToContent();
			this.updateZoomLabel();
		};
		this.zoomBtn = zoomBtn;

		this.iconButton(actions, 'zoom-in', t('whiteboard.toolbar.zoomIn'), () => {
			this.canvas?.zoomIn();
			this.updateZoomLabel();
		});
		this.iconButton(actions, 'maximize-2', t('whiteboard.toolbar.fit'), () => {
			this.canvas?.fitToContent();
			this.updateZoomLabel();
		});

		this.panBtn = this.iconButton(actions, 'hand', t('whiteboard.toolbar.pan'), () => {
			const next = !(this.canvas?.getPanMode() ?? false);
			this.canvas?.setPanMode(next);
			this.panBtn?.toggleClass('is-active', next);
		});

		actions.createSpan({ cls: 'hl-wb-topbar-divider' });

		// Export dropdown
		const exportWrap = actions.createDiv('hl-wb-export-wrap');
		this.iconButton(exportWrap, 'download', t('whiteboard.toolbar.export'), () => {
			if (this.exportMenuOpen) {
				this.closeExportMenu();
			} else {
				this.openExportMenu(exportWrap);
			}
		});
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = parent.createEl('button', {
			cls: 'hl-wb-btn',
			attr: { type: 'button', title: label, 'aria-label': label },
		});
		setIcon(btn, icon);
		btn.onclick = onClick;
		return btn;
	}

	private populateBoardSelect(): void {
		const select = this.boardSelectEl;
		if (!select) return;
		select.empty();
		for (const doc of this.docs) {
			select.createEl('option', { text: doc.title, value: doc.id });
		}
		if (this.currentDoc) {
			select.value = this.currentDoc.id;
		}
	}

	private updateZoomLabel(): void {
		if (!this.zoomBtn) return;
		const zoom = this.canvas?.getZoom() ?? this.currentDoc?.viewport.zoom ?? 1;
		this.zoomBtn.setText(`${Math.round(zoom * 100)}%`);
	}

	private updateTidyButton(selectedCount: number): void {
		if (!this.tidyBtn) return;
		this.tidyBtn.disabled = selectedCount < 2;
	}

	private openExportMenu(wrap: HTMLElement): void {
		this.closeExportMenu();
		this.exportMenuOpen = true;
		const menu = wrap.createDiv('hl-wb-export-menu');

		const canvasItem = menu.createEl('button', {
			cls: 'hl-wb-export-item',
			text: t('whiteboard.export.canvas'),
			attr: { type: 'button' },
		});
		canvasItem.onclick = () => {
			this.closeExportMenu();
			if (this.currentDoc) {
				void exportWhiteboardToCanvasFile(this.app, this.currentDoc, this.cardsById);
			}
		};

		const mdItem = menu.createEl('button', {
			cls: 'hl-wb-export-item',
			text: t('whiteboard.export.markdown'),
			attr: { type: 'button' },
		});
		mdItem.onclick = () => {
			this.closeExportMenu();
			if (this.currentDoc) {
				void exportWhiteboardToMarkdown(this.app, this.currentDoc, this.cardsById);
			}
		};
	}

	private closeExportMenu(): void {
		this.exportMenuOpen = false;
		this.contentEl.querySelector('.hl-wb-export-menu')?.remove();
	}

	// ── Board CRUD & Switching ────────────────────────────────

	private async switchBoard(target: WhiteboardDoc): Promise<void> {
		await this.flushSave();
		const fresh = (await db.getWhiteboard(target.id)) ?? target;
		this.currentDoc = fresh;
		this.populateBoardSelect();
		this.canvas?.setDoc(fresh, this.cardsById);
		this.cardDrawer?.update({ onBoardIds: collectOnBoardIds(fresh) });
		this.updateZoomLabel();
		this.updateTidyButton(0);
	}

	private promptNewBoard(): void {
		new WhiteboardNameModal(
			this.app,
			t('whiteboard.board.new'),
			'',
			(name) => {
				void this.createBoard(name);
			},
		).open();
	}

	private async createBoard(title: string): Promise<void> {
		await this.flushSave();
		const doc = createEmptyWhiteboardDoc(title);
		await this.saveDocDirect(doc);
		this.docs = await db.listWhiteboards();
		this.currentDoc = doc;
		this.populateBoardSelect();
		this.canvas?.setDoc(doc, this.cardsById);
		this.cardDrawer?.update({ onBoardIds: collectOnBoardIds(doc) });
		this.updateZoomLabel();
		this.updateTidyButton(0);
		new Notice(t('whiteboard.board.created', { title }));
	}

	private promptRenameBoard(): void {
		if (!this.currentDoc) return;
		const doc = this.currentDoc;
		new WhiteboardNameModal(
			this.app,
			t('whiteboard.board.rename'),
			doc.title,
			(name) => {
				void this.renameBoard(doc, name);
			},
		).open();
	}

	private async renameBoard(doc: WhiteboardDoc, title: string): Promise<void> {
		doc.title = title;
		doc.updatedAt = Date.now();
		await this.saveDocDirect(doc);
		this.docs = await db.listWhiteboards();
		this.populateBoardSelect();
		new Notice(t('whiteboard.board.renamed', { title }));
	}

	private promptDeleteBoard(): void {
		if (!this.currentDoc) return;
		const doc = this.currentDoc;
		new WhiteboardDeleteModal(
			this.app,
			t('whiteboard.board.confirmDelete', { title: doc.title }),
			() => {
				void this.deleteBoard(doc);
			},
		).open();
	}

	private async deleteBoard(doc: WhiteboardDoc): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (this.pendingSaveDoc?.id === doc.id) {
			this.pendingSaveDoc = null;
		}
		this.selfSaving = true;
		try {
			await db.deleteWhiteboard(doc.id);
		} finally {
			this.selfSaving = false;
		}

		this.docs = await db.listWhiteboards();
		if (this.docs.length === 0) {
			const fallback = createEmptyWhiteboardDoc(t('whiteboard.defaultTitle'));
			await this.saveDocDirect(fallback);
			this.docs = [fallback];
		}

		const next = this.docs[0] ?? null;
		this.currentDoc = next;
		this.populateBoardSelect();
		if (next) {
			this.canvas?.setDoc(next, this.cardsById);
		}
		this.cardDrawer?.update({ onBoardIds: collectOnBoardIds(next) });
		this.updateZoomLabel();
		this.updateTidyButton(0);
		new Notice(t('whiteboard.board.deleted', { title: doc.title }));
	}

	// ── Autosave & Live DB Sync ───────────────────────────────

	private handleCanvasDocChange(doc: WhiteboardDoc): void {
		this.currentDoc = doc;
		this.updateZoomLabel();
		this.cardDrawer?.update({ onBoardIds: collectOnBoardIds(doc) });
		this.scheduleSave(doc);
	}

	private scheduleSave(doc: WhiteboardDoc): void {
		this.pendingSaveDoc = doc;
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.flushSave();
		}, SAVE_DEBOUNCE_MS);
	}

	private async flushSave(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const doc = this.pendingSaveDoc;
		this.pendingSaveDoc = null;
		if (!doc) return;
		await this.saveDocDirect(doc);
	}

	private async saveDocDirect(doc: WhiteboardDoc): Promise<void> {
		this.selfSaving = true;
		try {
			await db.saveWhiteboard(doc);
		} catch (err) {
			console.error('[HiLighter] Failed to save whiteboard:', err);
		} finally {
			this.selfSaving = false;
		}
	}

	private async handleDbChange(): Promise<void> {
		const [highlights, docs] = await Promise.all([
			db.getAllHighlights(),
			db.listWhiteboards(),
		]);
		this.highlights = highlights;
		this.cardsById = buildCardsById(highlights);
		this.docs = docs;

		// Keep current board in sync if it was updated or deleted elsewhere
		if (this.currentDoc && !docs.some((d) => d.id === this.currentDoc?.id)) {
			const fallback = docs[0] ?? createEmptyWhiteboardDoc(t('whiteboard.defaultTitle'));
			if (docs.length === 0) {
				await this.saveDocDirect(fallback);
				this.docs = [fallback];
			}
			this.currentDoc = fallback;
			this.canvas?.setDoc(fallback, this.cardsById);
		} else {
			this.canvas?.refreshCards(this.cardsById);
		}

		this.populateBoardSelect();
		this.cardDrawer?.update({
			highlights: this.highlights,
			onBoardIds: collectOnBoardIds(this.currentDoc),
		});
	}

	private openCardDetail(note: HighlightNote): void {
		new HighlightDetailModal(
			this.app,
			note,
			() => {
				void this.handleDbChange();
			},
			this.plugin.settings.noteImageFolder || '',
			this.plugin.settings.groupExportFolder || '',
		).open();
	}
}
