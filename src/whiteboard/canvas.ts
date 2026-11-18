// ============================================================
// HiLighter - Infinite Whiteboard Canvas Engine
// ============================================================

import { App, Component, MarkdownRenderer, Menu } from 'obsidian';
import type {
	HighlightNote,
	HiLighterSettings,
	WhiteboardDoc,
	WhiteboardEdge,
	WhiteboardNode,
	WhiteboardSection,
} from '../models';
import { getColors, resolveHex } from '../colors';
import { cardDisplayTitle, cardPreviewMarkdown, cardRelationLabel } from '../card-templates';
import { getLang } from '../i18n';
import { randomUUID } from '../mocks/crypto';
import { CARD_DRAG_BATCH_MIME, CARD_DRAG_MIME, parseDraggedCardIds } from '../studio/card-drag-selection';
import { setCssProps } from '../utils/css-props';
import {
	computeEdgeAnchorPoints,
	computeEdgeBezierPath,
	computeGroupBounds,
	nearestRectSide,
	DEFAULT_NODE_HEIGHT,
	EdgeSide,
	findContainingSection,
	getNodeRect,
	layoutDroppedCards,
	MIN_ZOOM,
	nodesInSelectionBox,
	normalizeRect,
	Point,
	Rect,
	screenToCanvas,
	zoomAtPoint,
} from './board-math';

export interface WhiteboardCanvasOptions {
	app: App;
	component: Component;
	settings: HiLighterSettings;
	doc: WhiteboardDoc;
	cardsById: Map<string, HighlightNote>;
	onDocChange: (doc: WhiteboardDoc) => void;
	onOpenCardDetail: (note: HighlightNote) => void;
	onJumpToSource: (note: HighlightNote) => void;
	onSelectionChange?: (selectedNodeIds: ReadonlySet<string>) => void;
}

const DEFAULT_CARD_WIDTH = 280;
const DEFAULT_TEXT_WIDTH = 240;
const DEFAULT_SECTION_WIDTH = 480;
const DEFAULT_SECTION_HEIGHT = 340;
const CARD_DROP_GAP = 24;
const MIN_NODE_WIDTH = 180;
const MAX_NODE_WIDTH = 720;
const MIN_SECTION_WIDTH = 200;
const MIN_SECTION_HEIGHT = 140;
const ZOOM_FAR_THRESHOLD = 0.5;
const BASE_GRID_SIZE = 24;

type ActiveInteraction =
	| { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
	| {
		kind: 'drag-nodes';
		startCanvas: Point;
		origins: Map<string, Point>;
		moved: boolean;
	}
	| {
		kind: 'drag-section';
		sectionId: string;
		startCanvas: Point;
		origSection: Point;
		nodeOrigins: Map<string, Point>;
		moved: boolean;
	}
	| {
		kind: 'resize-node';
		nodeId: string;
		startCanvasX: number;
		origWidth: number;
		moved: boolean;
	}
	| {
		kind: 'resize-section';
		sectionId: string;
		startCanvas: Point;
		origWidth: number;
		origHeight: number;
		moved: boolean;
	}
	| {
		kind: 'marquee';
		startCanvas: Point;
		currentCanvas: Point;
		additive: boolean;
		initialSelection: Set<string>;
	}
	| {
		kind: 'connect-edge';
		fromNodeId: string;
		fromSide: EdgeSide;
		currentCanvas: Point;
	};

function labelText(zh: string, en: string): string {
	return getLang() === 'zh' ? zh : en;
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| (target instanceof HTMLElement && target.isContentEditable)
	);
}

export class WhiteboardCanvas {
	private container: HTMLElement;
	private options: WhiteboardCanvasOptions;
	private doc: WhiteboardDoc;
	private cardsById: Map<string, HighlightNote>;

	private rootEl: HTMLDivElement;
	private viewportEl: HTMLDivElement;
	private sectionsLayerEl: HTMLDivElement;
	private edgesSvgEl: SVGSVGElement;
	private edgeLabelsLayerEl: HTMLDivElement;
	private nodesLayerEl: HTMLDivElement;
	private marqueeEl: HTMLDivElement;
	private edgeEditorEl: HTMLDivElement | null = null;

	private sectionEls = new Map<string, HTMLDivElement>();
	private nodeEls = new Map<string, HTMLDivElement>();
	private selectedNodeIds = new Set<string>();
	private selectedEdgeId: string | null = null;
	private selectedSectionId: string | null = null;
	private editingTextNodeId: string | null = null;
	private editingSectionTitleId: string | null = null;
	private activeColorPickerSectionId: string | null = null;

	private panMode = false;
	private spacePressed = false;
	private interaction: ActiveInteraction | null = null;
	private arrowMarkerId = `hl-wb-arrow-${randomUUID().slice(0, 8)}`;

	private onWindowMouseMoveBound: (e: MouseEvent) => void;
	private onWindowMouseUpBound: (e: MouseEvent) => void;
	private onWindowKeyUpBound: (e: KeyboardEvent) => void;

	constructor(container: HTMLElement, options: WhiteboardCanvasOptions) {
		this.container = container;
		this.options = options;
		this.doc = options.doc;
		this.cardsById = options.cardsById;

		this.rootEl = this.container.createDiv({ cls: 'hl-wb-canvas-root' });
		this.rootEl.tabIndex = 0;

		this.viewportEl = this.rootEl.createDiv({ cls: 'hl-wb-viewport' });
		this.sectionsLayerEl = this.viewportEl.createDiv({ cls: 'hl-wb-sections-layer' });
		this.edgesSvgEl = this.viewportEl.createSvg('svg', { cls: 'hl-wb-edges-svg' });
		this.edgeLabelsLayerEl = this.viewportEl.createDiv({ cls: 'hl-wb-edge-labels-layer' });
		this.nodesLayerEl = this.viewportEl.createDiv({ cls: 'hl-wb-nodes-layer' });
		this.marqueeEl = this.viewportEl.createDiv({ cls: 'hl-wb-marquee is-hidden' });

		this.onWindowMouseMoveBound = (e: MouseEvent) => this.handleWindowMouseMove(e);
		this.onWindowMouseUpBound = (e: MouseEvent) => this.handleWindowMouseUp(e);
		this.onWindowKeyUpBound = (e: KeyboardEvent) => this.handleWindowKeyUp(e);

		this.bindEvents();
		this.renderAll();
	}

	// ── Public API ────────────────────────────────────────────

	setDoc(doc: WhiteboardDoc, cardsById: Map<string, HighlightNote>): void {
		this.doc = doc;
		this.cardsById = cardsById;
		this.selectedNodeIds.clear();
		this.selectedEdgeId = null;
		this.selectedSectionId = null;
		this.editingTextNodeId = null;
		this.editingSectionTitleId = null;
		this.activeColorPickerSectionId = null;
		this.interaction = null;
		this.closeEdgeEditor();
		this.emitSelectionChange();
		this.renderAll();
	}

	refreshCards(cardsById: Map<string, HighlightNote>): void {
		this.cardsById = cardsById;
		this.renderNodes();
		this.renderEdges();
	}

	setPanMode(enabled: boolean): void {
		this.panMode = enabled;
		this.rootEl.toggleClass('is-pan-mode', enabled);
	}

	getPanMode(): boolean {
		return this.panMode;
	}

	getZoom(): number {
		return this.doc.viewport.zoom;
	}

	getSelectedNodeIds(): ReadonlySet<string> {
		return this.selectedNodeIds;
	}

	zoomIn(): void {
		this.zoomByFactor(1.2);
	}

	zoomOut(): void {
		this.zoomByFactor(1 / 1.2);
	}

	fitToContent(): void {
		const rect = this.rootEl.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;

		const bounds = this.computeContentBounds();
		if (!bounds) {
			this.doc.viewport = { x: 0, y: 0, zoom: 1 };
			this.applyViewportTransform();
			this.notifyDocChange();
			return;
		}

		const padding = 56;
		const availW = Math.max(80, rect.width - padding * 2);
		const availH = Math.max(80, rect.height - padding * 2);
		const rawZoom = Math.min(availW / Math.max(1, bounds.width), availH / Math.max(1, bounds.height));
		const zoom = Math.max(MIN_ZOOM, Math.min(1, rawZoom));
		const centerX = bounds.x + bounds.width / 2;
		const centerY = bounds.y + bounds.height / 2;

		this.doc.viewport = {
			x: rect.width / 2 - centerX * zoom,
			y: rect.height / 2 - centerY * zoom,
			zoom,
		};
		this.applyViewportTransform();
		this.notifyDocChange();
	}

	insertCardsAtCenter(ids: string[]): void {
		const validIds = [...new Set(ids)].filter(id => this.cardsById.has(id));
		if (validIds.length === 0) return;
		const center = this.getViewportCenterCanvas();
		this.insertCardsAtPoint(validIds, center.x - DEFAULT_CARD_WIDTH / 2, center.y - DEFAULT_NODE_HEIGHT / 2);
	}

	addTextNoteAtCenter(): void {
		const center = this.getViewportCenterCanvas();
		const x = center.x - DEFAULT_TEXT_WIDTH / 2;
		const y = center.y - DEFAULT_NODE_HEIGHT / 2;
		const node: WhiteboardNode = {
			id: randomUUID(),
			type: 'text',
			text: '',
			x,
			y,
			width: DEFAULT_TEXT_WIDTH,
			color: 'yellow',
		};
		const containing = findContainingSection(getNodeRect(node, DEFAULT_NODE_HEIGHT), this.doc.sections);
		if (containing) node.sectionId = containing.id;

		this.doc.nodes.push(node);
		this.selectedNodeIds = new Set([node.id]);
		this.selectedEdgeId = null;
		this.selectedSectionId = null;
		this.editingTextNodeId = node.id;
		this.closeEdgeEditor();
		this.renderNodes();
		this.renderEdges();
		this.emitSelectionChange();
		this.notifyDocChange();
	}

	addSectionAtCenter(): void {
		const selectedNodes = this.doc.nodes.filter(n => this.selectedNodeIds.has(n.id));
		const groupBounds = computeGroupBounds(
			selectedNodes,
			this.doc.edges,
			node => this.getMeasuredNodeHeight(node),
		);
		let x: number;
		let y: number;
		let width: number;
		let height: number;

		if (groupBounds) {
			const padX = 28;
			const padTop = 52;
			const padBottom = 28;
			x = groupBounds.x - padX;
			y = groupBounds.y - padTop;
			width = Math.max(MIN_SECTION_WIDTH, groupBounds.width + padX * 2);
			height = Math.max(MIN_SECTION_HEIGHT, groupBounds.height + padTop + padBottom);
		} else {
			const center = this.getViewportCenterCanvas();
			x = center.x - DEFAULT_SECTION_WIDTH / 2;
			y = center.y - DEFAULT_SECTION_HEIGHT / 2;
			width = DEFAULT_SECTION_WIDTH;
			height = DEFAULT_SECTION_HEIGHT;
		}

		const section: WhiteboardSection = {
			id: randomUUID(),
			title: labelText('新分区', 'New Section'),
			x,
			y,
			width,
			height,
			color: 'blue',
		};
		this.doc.sections.push(section);
		for (const node of selectedNodes) {
			node.sectionId = section.id;
		}
		this.reassignAllNodeSections();

		this.selectedSectionId = section.id;
		this.selectedEdgeId = null;
		this.selectedNodeIds.clear();
		this.closeEdgeEditor();
		this.updateSelectionVisuals();
		this.renderSections();
		this.emitSelectionChange();
		this.notifyDocChange();
	}

	tidySelectedGrid(): void {
		const selected = this.doc.nodes.filter(n => this.selectedNodeIds.has(n.id));
		if (selected.length === 0) return;

		let minX = Infinity;
		let minY = Infinity;
		for (const node of selected) {
			if (node.x < minX) minX = node.x;
			if (node.y < minY) minY = node.y;
		}

		const unselected = this.doc.nodes.filter(n => !this.selectedNodeIds.has(n.id));
		const maxWidth = selected.reduce((acc, n) => Math.max(acc, n.width), DEFAULT_CARD_WIDTH);
		const maxHeight = selected.reduce((acc, n) => Math.max(acc, this.getMeasuredNodeHeight(n)), DEFAULT_NODE_HEIGHT);

		const sorted = [...selected].sort((a, b) => a.y - b.y || a.x - b.x);
		const positions = layoutDroppedCards(
			minX,
			minY,
			sorted.length,
			unselected,
			maxWidth,
			maxHeight,
			CARD_DROP_GAP,
		);

		sorted.forEach((node, idx) => {
			const pos = positions[idx];
			if (!pos) return;
			node.x = pos.x;
			node.y = pos.y;
			const rect = getNodeRect(node, this.getMeasuredNodeHeight(node));
			node.sectionId = findContainingSection(rect, this.doc.sections)?.id;
		});

		this.renderNodes();
		this.renderEdges();
		this.notifyDocChange();
	}

	destroy(): void {
		window.removeEventListener('mousemove', this.onWindowMouseMoveBound);
		window.removeEventListener('mouseup', this.onWindowMouseUpBound);
		window.removeEventListener('keyup', this.onWindowKeyUpBound);
		this.closeEdgeEditor();
		this.rootEl.empty();
	}

	// ── Event Binding ─────────────────────────────────────────

	private bindEvents(): void {
		window.addEventListener('mousemove', this.onWindowMouseMoveBound);
		window.addEventListener('mouseup', this.onWindowMouseUpBound);
		window.addEventListener('keyup', this.onWindowKeyUpBound);

		this.rootEl.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			const rect = this.rootEl.getBoundingClientRect();
			const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
			this.doc.viewport = zoomAtPoint(this.doc.viewport, factor, e.clientX, e.clientY, rect);
			this.applyViewportTransform();
			this.notifyDocChange();
		}, { passive: false });

		this.rootEl.addEventListener('mousedown', (e: MouseEvent) => this.handleRootMouseDown(e));

		this.rootEl.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeyDown(e));

		this.rootEl.addEventListener('dragover', (e: DragEvent) => {
			const types = e.dataTransfer?.types;
			if (!types) return;
			if (types.includes(CARD_DRAG_MIME) || types.includes(CARD_DRAG_BATCH_MIME)) {
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
				this.rootEl.addClass('is-drag-over');
			}
		});

		this.rootEl.addEventListener('dragleave', (e: DragEvent) => {
			if (e.target === this.rootEl) {
				this.rootEl.removeClass('is-drag-over');
			}
		});

		this.rootEl.addEventListener('drop', (e: DragEvent) => {
			this.rootEl.removeClass('is-drag-over');
			const grabbedId = e.dataTransfer?.getData(CARD_DRAG_MIME) ?? '';
			const batchPayload = e.dataTransfer?.getData(CARD_DRAG_BATCH_MIME) ?? '';
			const ids = parseDraggedCardIds(grabbedId, batchPayload);
			if (ids.length === 0) return;

			e.preventDefault();
			const rect = this.rootEl.getBoundingClientRect();
			const world = screenToCanvas(e.clientX, e.clientY, rect, this.doc.viewport);
			this.insertCardsAtPoint(ids, world.x - DEFAULT_CARD_WIDTH / 2, world.y - DEFAULT_NODE_HEIGHT / 2);
		});
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (isEditableTarget(e.target)) return;

		if (e.code === 'Space' && !this.spacePressed) {
			e.preventDefault();
			this.spacePressed = true;
			this.rootEl.addClass('is-space-pan');
			return;
		}

		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			this.deleteSelected();
			return;
		}

		if (e.key === 'Escape') {
			if (this.interaction?.kind === 'connect-edge') {
				this.interaction = null;
				this.rootEl.removeClass('is-connecting');
				this.renderEdges();
				return;
			}
			this.selectedNodeIds.clear();
			this.selectedEdgeId = null;
			this.selectedSectionId = null;
			this.activeColorPickerSectionId = null;
			this.closeEdgeEditor();
			this.emitSelectionChange();
			this.renderAll();
		}
	}

	private handleWindowKeyUp(e: KeyboardEvent): void {
		if (e.code === 'Space' && this.spacePressed) {
			this.spacePressed = false;
			this.rootEl.removeClass('is-space-pan');
		}
	}

	private handleRootMouseDown(e: MouseEvent): void {
		if (isEditableTarget(e.target)) return;
		this.rootEl.focus({ preventScroll: true });

		if (e.button === 2 && this.interaction?.kind === 'connect-edge') {
			e.preventDefault();
			this.interaction = null;
			this.rootEl.removeClass('is-connecting');
			this.renderEdges();
			return;
		}

		// Middle-mouse pan, Space+left-drag pan, or pan mode left-drag
		if (e.button === 1 || (e.button === 0 && (this.spacePressed || this.panMode))) {
			e.preventDefault();
			this.interaction = {
				kind: 'pan',
				startX: e.clientX,
				startY: e.clientY,
				origX: this.doc.viewport.x,
				origY: this.doc.viewport.y,
			};
			this.rootEl.addClass('is-panning');
			return;
		}

		if (e.button !== 0) return;

		// Click on empty background (or inside a section body) starts marquee selection
		const target = e.target;
		const hitSectionEl = target instanceof Element && target.classList.contains('hl-wb-section')
			? target
			: null;
		const onBackground =
			target === this.rootEl
			|| target === this.viewportEl
			|| target === this.sectionsLayerEl
			|| target === this.nodesLayerEl
			|| target === this.edgesSvgEl
			|| target === this.edgeLabelsLayerEl
			|| hitSectionEl !== null;
		if (!onBackground) return;

		this.closeEdgeEditor();
		this.activeColorPickerSectionId = null;
		this.selectedEdgeId = null;
		this.selectedSectionId = hitSectionEl?.instanceOf(HTMLElement) ? (hitSectionEl.dataset.sectionId ?? null) : null;

		const additive = e.shiftKey;
		if (!additive) {
			this.selectedNodeIds.clear();
			this.emitSelectionChange();
		}

		const canvasPt = this.clientToCanvas(e.clientX, e.clientY);
		e.preventDefault();
		this.interaction = {
			kind: 'marquee',
			startCanvas: canvasPt,
			currentCanvas: canvasPt,
			additive,
			initialSelection: new Set(this.selectedNodeIds),
		};
		this.updateSelectionVisuals();
		this.renderSections();
		this.renderEdges();
	}

	private handleWindowMouseMove(e: MouseEvent): void {
		if (!this.interaction) return;

		switch (this.interaction.kind) {
			case 'pan': {
				const dx = e.clientX - this.interaction.startX;
				const dy = e.clientY - this.interaction.startY;
				this.doc.viewport.x = this.interaction.origX + dx;
				this.doc.viewport.y = this.interaction.origY + dy;
				this.applyViewportTransform();
				break;
			}
			case 'drag-nodes': {
				const pt = this.clientToCanvas(e.clientX, e.clientY);
				const dx = pt.x - this.interaction.startCanvas.x;
				const dy = pt.y - this.interaction.startCanvas.y;
				if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.interaction.moved = true;

				for (const [nodeId, orig] of this.interaction.origins.entries()) {
					const node = this.doc.nodes.find(n => n.id === nodeId);
					if (!node) continue;
					node.x = orig.x + dx;
					node.y = orig.y + dy;
					const el = this.nodeEls.get(nodeId);
					if (el) setCssProps(el, { left: `${node.x}px`, top: `${node.y}px` });
				}
				this.renderEdges();
				break;
			}
			case 'drag-section': {
				const pt = this.clientToCanvas(e.clientX, e.clientY);
				const dx = pt.x - this.interaction.startCanvas.x;
				const dy = pt.y - this.interaction.startCanvas.y;
				if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.interaction.moved = true;

				const sectionId = this.interaction.sectionId;
				const section = this.doc.sections.find(s => s.id === sectionId);
				if (section) {
					section.x = this.interaction.origSection.x + dx;
					section.y = this.interaction.origSection.y + dy;
					const secEl = this.sectionEls.get(section.id);
					if (secEl) setCssProps(secEl, { left: `${section.x}px`, top: `${section.y}px` });
				}
				for (const [nodeId, orig] of this.interaction.nodeOrigins.entries()) {
					const node = this.doc.nodes.find(n => n.id === nodeId);
					if (!node) continue;
					node.x = orig.x + dx;
					node.y = orig.y + dy;
					const el = this.nodeEls.get(nodeId);
					if (el) setCssProps(el, { left: `${node.x}px`, top: `${node.y}px` });
				}
				this.renderEdges();
				break;
			}
			case 'resize-node': {
				const pt = this.clientToCanvas(e.clientX, e.clientY);
				const dx = pt.x - this.interaction.startCanvasX;
				if (Math.abs(dx) > 1) this.interaction.moved = true;
				const nodeId = this.interaction.nodeId;
				const node = this.doc.nodes.find(n => n.id === nodeId);
				if (node) {
					node.width = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, this.interaction.origWidth + dx));
					const el = this.nodeEls.get(node.id);
					if (el) setCssProps(el, { width: `${node.width}px` });
					this.renderEdges();
				}
				break;
			}
			case 'resize-section': {
				const pt = this.clientToCanvas(e.clientX, e.clientY);
				const dx = pt.x - this.interaction.startCanvas.x;
				const dy = pt.y - this.interaction.startCanvas.y;
				if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.interaction.moved = true;
				const sectionId = this.interaction.sectionId;
				const section = this.doc.sections.find(s => s.id === sectionId);
				if (section) {
					section.width = Math.max(MIN_SECTION_WIDTH, this.interaction.origWidth + dx);
					section.height = Math.max(MIN_SECTION_HEIGHT, this.interaction.origHeight + dy);
					const secEl = this.sectionEls.get(section.id);
					if (secEl) {
						setCssProps(secEl, { width: `${section.width}px`, height: `${section.height}px` });
					}
				}
				break;
			}
			case 'marquee': {
				this.interaction.currentCanvas = this.clientToCanvas(e.clientX, e.clientY);
				const box = normalizeRect({
					x: this.interaction.startCanvas.x,
					y: this.interaction.startCanvas.y,
					width: this.interaction.currentCanvas.x - this.interaction.startCanvas.x,
					height: this.interaction.currentCanvas.y - this.interaction.startCanvas.y,
				});
				this.marqueeEl.removeClass('is-hidden');
				setCssProps(this.marqueeEl, {
					left: `${box.x}px`,
					top: `${box.y}px`,
					width: `${box.width}px`,
					height: `${box.height}px`,
				});
				const matched = nodesInSelectionBox(this.doc.nodes, box, node => this.getMeasuredNodeHeight(node));
				const next = new Set(this.interaction.additive ? this.interaction.initialSelection : []);
				for (const n of matched) next.add(n.id);
				this.selectedNodeIds = next;
				if (next.size > 0 && this.selectedSectionId !== null) {
					this.selectedSectionId = null;
					this.updateSectionSelectionVisuals();
				}
				this.updateSelectionVisuals();
				break;
			}
			case 'connect-edge': {
				this.interaction.currentCanvas = this.clientToCanvas(e.clientX, e.clientY);
				this.renderEdges();
				break;
			}
		}
	}

	private handleWindowMouseUp(e: MouseEvent): void {
		const current = this.interaction;
		if (!current) return;
		this.interaction = null;

		switch (current.kind) {
			case 'pan': {
				this.rootEl.removeClass('is-panning');
				this.notifyDocChange();
				break;
			}
			case 'drag-nodes': {
				if (current.moved) {
					for (const nodeId of current.origins.keys()) {
						const node = this.doc.nodes.find(n => n.id === nodeId);
						if (!node) continue;
						const rect = getNodeRect(node, this.getMeasuredNodeHeight(node));
						node.sectionId = findContainingSection(rect, this.doc.sections)?.id;
					}
					this.expandSectionsForInternalEdges();
					this.notifyDocChange();
				}
				break;
			}
			case 'drag-section': {
				if (current.moved) {
					this.notifyDocChange();
				}
				break;
			}
			case 'resize-node': {
				if (current.moved) {
					this.renderEdges();
					this.notifyDocChange();
				}
				break;
			}
			case 'resize-section': {
				if (current.moved) {
					this.reassignAllNodeSections();
					this.notifyDocChange();
				}
				break;
			}
			case 'marquee': {
				this.marqueeEl.addClass('is-hidden');
				this.emitSelectionChange();
				break;
			}
			case 'connect-edge': {
				this.rootEl.removeClass('is-connecting');
				const hitEls = document.elementsFromPoint(e.clientX, e.clientY);
				const anchorEl = hitEls.find((el): el is HTMLElement => el.instanceOf(HTMLElement) && el.hasClass('hl-wb-anchor'))
					?? (e.target instanceof Element ? e.target.closest<HTMLElement>('.hl-wb-anchor') : null);
				const targetEl = hitEls.find((el): el is HTMLElement => el.instanceOf(HTMLElement) && el.hasClass('hl-wb-node'))
					?? (e.target instanceof Element ? e.target.closest<HTMLElement>('.hl-wb-node') : null);
				const targetNodeId = targetEl?.dataset.nodeId;
				let targetSide = anchorEl?.dataset.side as EdgeSide | undefined;

				if (targetNodeId && targetNodeId !== current.fromNodeId) {
					if (!targetSide) {
						const targetNode = this.doc.nodes.find(n => n.id === targetNodeId);
						if (targetNode) {
							const targetRect = getNodeRect(targetNode, this.getMeasuredNodeHeight(targetNode));
							const dropPt = this.clientToCanvas(e.clientX, e.clientY);
							targetSide = nearestRectSide(targetRect, dropPt);
						}
					}
					const edge: WhiteboardEdge = {
						id: randomUUID(),
						fromNodeId: current.fromNodeId,
						toNodeId: targetNodeId,
						fromSide: current.fromSide,
						toSide: targetSide,
					};
					this.doc.edges.push(edge);
					this.selectedEdgeId = edge.id;
					this.expandSectionsForInternalEdges();
					this.notifyDocChange();
				}
				this.renderEdges();
				break;
			}
		}
	}

	// ── Rendering ─────────────────────────────────────────────

	private renderAll(): void {
		this.applyViewportTransform();
		this.renderSections();
		this.renderNodes();
		this.renderEdges();
		window.requestAnimationFrame(() => {
			if (this.rootEl.isConnected) this.renderEdges();
		});
	}

	private applyViewportTransform(): void {
		const vp = this.doc.viewport;
		setCssProps(this.viewportEl, {
			transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
		});
		const gridStep = Math.max(8, BASE_GRID_SIZE * vp.zoom);
		setCssProps(this.rootEl, {
			'background-size': `${gridStep}px ${gridStep}px`,
			'background-position': `${vp.x}px ${vp.y}px`,
		});
		this.rootEl.toggleClass('is-zoom-far', vp.zoom < ZOOM_FAR_THRESHOLD);
	}

	private renderSections(): void {
		this.sectionsLayerEl.empty();
		this.sectionEls.clear();

		for (const section of this.doc.sections) {
			const el = this.sectionsLayerEl.createDiv({
				cls: `hl-wb-section${this.selectedSectionId === section.id ? ' is-selected' : ''}`,
			});
			el.dataset.sectionId = section.id;
			setCssProps(el, {
				left: `${section.x}px`,
				top: `${section.y}px`,
				width: `${section.width}px`,
				height: `${section.height}px`,
				'--hl-section-color': resolveHex(this.options.settings, section.color),
			});

			const header = el.createDiv({ cls: 'hl-wb-section-header' });
			if (this.editingSectionTitleId === section.id) {
				const input = header.createEl('input', {
					cls: 'hl-wb-section-title-input',
					type: 'text',
					value: section.title,
				});
				const commit = () => {
					const val = input.value.trim();
					if (val) section.title = val;
					this.editingSectionTitleId = null;
					this.renderSections();
					this.notifyDocChange();
				};
				input.addEventListener('blur', commit);
				input.addEventListener('keydown', (ke: KeyboardEvent) => {
					ke.stopPropagation();
					if (ke.key === 'Enter') commit();
					else if (ke.key === 'Escape') {
						this.editingSectionTitleId = null;
						this.renderSections();
					}
				});
				window.setTimeout(() => {
					input.focus();
					input.select();
				}, 0);
			} else {
				const titleEl = header.createSpan({ cls: 'hl-wb-section-title', text: section.title });
				titleEl.addEventListener('dblclick', (de: MouseEvent) => {
					de.stopPropagation();
					this.editingSectionTitleId = section.id;
					this.renderSections();
				});
			}

			const actions = header.createDiv({ cls: 'hl-wb-section-actions' });
			const colorBtn = actions.createEl('button', {
				cls: 'hl-wb-section-btn hl-wb-section-color-btn',
				attr: { type: 'button', title: labelText('更改颜色', 'Change color') },
			});
			setCssProps(colorBtn, { '--hl-swatch-color': resolveHex(this.options.settings, section.color) });
			colorBtn.addEventListener('click', (ce: MouseEvent) => {
				ce.stopPropagation();
				this.activeColorPickerSectionId = this.activeColorPickerSectionId === section.id ? null : section.id;
				this.renderSections();
			});

			const delBtn = actions.createEl('button', {
				cls: 'hl-wb-section-btn hl-wb-section-delete-btn',
				text: '×',
				attr: { type: 'button', title: labelText('删除分区', 'Delete section') },
			});
			delBtn.addEventListener('click', (ce: MouseEvent) => {
				ce.stopPropagation();
				this.deleteSection(section.id);
			});

			if (this.activeColorPickerSectionId === section.id) {
				const palette = el.createDiv({ cls: 'hl-wb-section-palette' });
				for (const c of getColors(this.options.settings)) {
					const dot = palette.createEl('button', {
						cls: `hl-wb-color-dot${section.color === c.id ? ' is-active' : ''}`,
						attr: { type: 'button', title: c.label },
					});
					setCssProps(dot, { '--hl-swatch-color': c.hex });
					dot.addEventListener('click', (pe: MouseEvent) => {
						pe.stopPropagation();
						section.color = c.id;
						this.activeColorPickerSectionId = null;
						this.renderSections();
						this.notifyDocChange();
					});
				}
			}

			const resizeHandle = el.createDiv({ cls: 'hl-wb-section-resize' });
			resizeHandle.addEventListener('mousedown', (re: MouseEvent) => {
				if (re.button !== 0 || this.spacePressed || this.panMode) return;
				re.preventDefault();
				re.stopPropagation();
				this.interaction = {
					kind: 'resize-section',
					sectionId: section.id,
					startCanvas: this.clientToCanvas(re.clientX, re.clientY),
					origWidth: section.width,
					origHeight: section.height,
					moved: false,
				};
			});

			header.addEventListener('mousedown', (me: MouseEvent) => {
				if (me.button !== 0 || this.spacePressed || this.panMode) return;
				if (isEditableTarget(me.target)) return;
				if (me.target instanceof Element && me.target.closest('.hl-wb-section-actions, .hl-wb-section-palette, .hl-wb-section-resize')) {
					return;
				}
				me.preventDefault();
				me.stopPropagation();
				this.rootEl.focus({ preventScroll: true });
				this.selectedSectionId = section.id;
				this.selectedEdgeId = null;
				this.selectedNodeIds.clear();
				this.closeEdgeEditor();
				this.emitSelectionChange();
				this.updateSelectionVisuals();
				this.updateSectionSelectionVisuals();

				const nodeOrigins = new Map<string, Point>();
				for (const node of this.doc.nodes) {
					const rect = getNodeRect(node, this.getMeasuredNodeHeight(node));
					const insideByGeom = findContainingSection(rect, [section])?.id === section.id;
					if (node.sectionId === section.id || insideByGeom) {
						nodeOrigins.set(node.id, { x: node.x, y: node.y });
					}
				}

				this.interaction = {
					kind: 'drag-section',
					sectionId: section.id,
					startCanvas: this.clientToCanvas(me.clientX, me.clientY),
					origSection: { x: section.x, y: section.y },
					nodeOrigins,
					moved: false,
				};
			});

			this.sectionEls.set(section.id, el);
		}
	}

	private renderNodes(): void {
		this.nodesLayerEl.empty();
		this.nodeEls.clear();

		for (const node of this.doc.nodes) {
			const el = this.nodesLayerEl.createDiv({
				cls: `hl-wb-node hl-wb-node-${node.type}${this.selectedNodeIds.has(node.id) ? ' is-selected' : ''}${node.collapsed ? ' is-collapsed' : ''}`,
			});
			el.dataset.nodeId = node.id;
			setCssProps(el, {
				left: `${node.x}px`,
				top: `${node.y}px`,
				width: `${node.width}px`,
			});

			if (node.type === 'card') {
				this.renderCardNodeContent(el, node);
			} else if (node.type === 'text') {
				this.renderTextNodeContent(el, node);
			} else {
				this.renderSubboardPlaceholder(el, node);
			}

			// 4-side anchor dots
			const sides: EdgeSide[] = ['top', 'right', 'bottom', 'left'];
			for (const side of sides) {
				const anchor = el.createDiv({ cls: `hl-wb-anchor hl-wb-anchor-${side}` });
				anchor.dataset.side = side;
				anchor.addEventListener('mousedown', (ae: MouseEvent) => {
					if (ae.button !== 0 || this.spacePressed || this.panMode) return;
					ae.preventDefault();
					ae.stopPropagation();
					this.rootEl.addClass('is-connecting');
					this.interaction = {
						kind: 'connect-edge',
						fromNodeId: node.id,
						fromSide: side,
						currentCanvas: this.clientToCanvas(ae.clientX, ae.clientY),
					};
					this.renderEdges();
				});
			}

			// Right-edge width resize handle
			const resizeW = el.createDiv({ cls: 'hl-wb-node-resize-w' });
			resizeW.addEventListener('mousedown', (re: MouseEvent) => {
				if (re.button !== 0 || this.spacePressed || this.panMode) return;
				re.preventDefault();
				re.stopPropagation();
				this.interaction = {
					kind: 'resize-node',
					nodeId: node.id,
					startCanvasX: this.clientToCanvas(re.clientX, re.clientY).x,
					origWidth: node.width,
					moved: false,
				};
			});

			// Node drag / selection
			el.addEventListener('mousedown', (me: MouseEvent) => {
				if (me.button !== 0 || this.spacePressed || this.panMode) return;
				if (isEditableTarget(me.target)) return;
				if (me.target instanceof Element && me.target.closest('button, a, .hl-wb-anchor, .hl-wb-node-resize-w')) {
					return;
				}
				me.preventDefault();
				me.stopPropagation();
				this.rootEl.focus({ preventScroll: true });
				this.closeEdgeEditor();
				this.selectedEdgeId = null;
				this.selectedSectionId = null;

				if (me.shiftKey) {
					if (this.selectedNodeIds.has(node.id)) {
						this.selectedNodeIds.delete(node.id);
					} else {
						this.selectedNodeIds.add(node.id);
					}
				} else if (!this.selectedNodeIds.has(node.id)) {
					this.selectedNodeIds = new Set([node.id]);
				}

				this.emitSelectionChange();
				this.updateSelectionVisuals();
				this.updateSectionSelectionVisuals();

				if (!this.selectedNodeIds.has(node.id)) return;
				const origins = new Map<string, Point>();
				for (const id of this.selectedNodeIds) {
					const n = this.doc.nodes.find(item => item.id === id);
					if (n) origins.set(id, { x: n.x, y: n.y });
				}
				this.interaction = {
					kind: 'drag-nodes',
					startCanvas: this.clientToCanvas(me.clientX, me.clientY),
					origins,
					moved: false,
				};
			});

			this.nodeEls.set(node.id, el);
		}
	}

	private renderCardNodeContent(el: HTMLDivElement, node: WhiteboardNode): void {
		const note = node.highlightId ? this.cardsById.get(node.highlightId) : undefined;
		if (!note) {
			const header = el.createDiv({ cls: 'hl-wb-node-header' });
			header.createSpan({ cls: 'hl-wb-node-title', text: labelText('卡片已删除', 'Card missing') });
			const removeBtn = header.createEl('button', {
				cls: 'hl-wb-node-btn',
				text: '×',
				attr: { type: 'button', title: labelText('从白板移除', 'Remove from board') },
			});
			removeBtn.addEventListener('click', (ce: MouseEvent) => {
				ce.stopPropagation();
				this.removeNodesById(new Set([node.id]));
			});
			return;
		}

		const colorHex = note.colorHex || resolveHex(this.options.settings, note.color);
		setCssProps(el, { '--hl-card-mark': colorHex });

		const header = el.createDiv({ cls: 'hl-wb-node-header' });
		header.createSpan({ cls: 'hl-wb-node-color-mark' });
		header.createSpan({ cls: 'hl-wb-node-title', text: cardDisplayTitle(note, 56) });

		const actions = header.createDiv({ cls: 'hl-wb-node-actions' });
		const collapseBtn = actions.createEl('button', {
			cls: 'hl-wb-node-btn',
			text: node.collapsed ? '▸' : '▾',
			attr: { type: 'button', title: node.collapsed ? labelText('展开', 'Expand') : labelText('折叠', 'Collapse') },
		});
		collapseBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			node.collapsed = !node.collapsed;
			this.renderNodes();
			this.renderEdges();
			this.notifyDocChange();
		});

		const jumpBtn = actions.createEl('button', {
			cls: 'hl-wb-node-btn',
			text: '↗',
			attr: { type: 'button', title: labelText('跳转到原文', 'Jump to source') },
		});
		jumpBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			this.options.onJumpToSource(note);
		});

		const removeBtn = actions.createEl('button', {
			cls: 'hl-wb-node-btn is-danger',
			text: '×',
			attr: { type: 'button', title: labelText('从白板移除', 'Remove from board') },
		});
		removeBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			this.removeNodesById(new Set([node.id]));
		});

		if (!node.collapsed) {
			const body = el.createDiv({ cls: 'hl-wb-node-body' });
			if (note.text && note.text.trim() && note.text.trim() !== note.title?.trim()) {
				body.createDiv({ cls: 'hl-wb-node-excerpt', text: note.text.trim() });
			}

			const previewMd = cardPreviewMarkdown(note);
			if (previewMd) {
				const noteEl = body.createDiv({ cls: 'hl-wb-node-note' });
				void MarkdownRenderer.render(
					this.options.app,
					previewMd,
					noteEl,
					note.sourcePath ?? '',
					this.options.component,
				);
			}

			if (note.tags && note.tags.length > 0) {
				const tagsEl = body.createDiv({ cls: 'hl-wb-node-tags' });
				for (const tag of note.tags) {
					tagsEl.createSpan({ cls: 'hl-wb-node-tag', text: `#${tag}` });
				}
			}
		}

		el.addEventListener('dblclick', (de: MouseEvent) => {
			de.stopPropagation();
			this.options.onOpenCardDetail(note);
		});
	}

	private renderTextNodeContent(el: HTMLDivElement, node: WhiteboardNode): void {
		const colorHex = resolveHex(this.options.settings, node.color ?? 'yellow');
		setCssProps(el, { '--hl-card-mark': colorHex });

		const header = el.createDiv({ cls: 'hl-wb-node-header' });
		header.createSpan({ cls: 'hl-wb-node-color-mark' });
		const firstLine = node.text?.trim().split(/\r?\n/)[0]?.trim();
		const textHeaderTitle = node.collapsed && firstLine ? firstLine.slice(0, 48) : labelText('便签', 'Note');
		header.createSpan({ cls: 'hl-wb-node-title', text: textHeaderTitle });

		const actions = header.createDiv({ cls: 'hl-wb-node-actions' });
		const collapseBtn = actions.createEl('button', {
			cls: 'hl-wb-node-btn',
			text: node.collapsed ? '▸' : '▾',
			attr: { type: 'button', title: node.collapsed ? labelText('展开', 'Expand') : labelText('折叠', 'Collapse') },
		});
		collapseBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			node.collapsed = !node.collapsed;
			this.renderNodes();
			this.renderEdges();
			this.notifyDocChange();
		});

		const removeBtn = actions.createEl('button', {
			cls: 'hl-wb-node-btn is-danger',
			text: '×',
			attr: { type: 'button', title: labelText('从白板移除', 'Remove from board') },
		});
		removeBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			this.removeNodesById(new Set([node.id]));
		});

		if (node.collapsed && this.editingTextNodeId !== node.id) {
			return;
		}

		const body = el.createDiv({ cls: 'hl-wb-node-body' });
		if (this.editingTextNodeId === node.id) {
			const textarea = body.createEl('textarea', {
				cls: 'hl-wb-text-editor',
				text: node.text ?? '',
				attr: { placeholder: labelText('输入便签内容…', 'Write a note…') },
			});
			textarea.value = node.text ?? '';
			const commit = () => {
				node.text = textarea.value;
				this.editingTextNodeId = null;
				this.renderNodes();
				this.renderEdges();
				this.notifyDocChange();
			};
			textarea.addEventListener('blur', commit);
			textarea.addEventListener('keydown', (ke: KeyboardEvent) => {
				ke.stopPropagation();
				if (ke.key === 'Escape' || ((ke.ctrlKey || ke.metaKey) && ke.key === 'Enter')) {
					commit();
				}
			});
			window.setTimeout(() => {
				textarea.focus();
				textarea.setSelectionRange(textarea.value.length, textarea.value.length);
			}, 0);
		} else {
			const textContent = (node.text ?? '').trim();
			body.createDiv({
				cls: `hl-wb-text-content${textContent ? '' : ' is-placeholder'}`,
				text: textContent || labelText('双击编辑便签…', 'Double-click to edit…'),
			});
			el.addEventListener('dblclick', (de: MouseEvent) => {
				de.stopPropagation();
				this.editingTextNodeId = node.id;
				this.renderNodes();
			});
		}
	}

	private renderSubboardPlaceholder(el: HTMLDivElement, node: WhiteboardNode): void {
		const header = el.createDiv({ cls: 'hl-wb-node-header' });
		header.createSpan({ cls: 'hl-wb-node-title', text: node.text ?? labelText('子白板', 'Sub-board') });
	}

	private renderEdges(): void {
		this.edgesSvgEl.empty();
		this.edgeLabelsLayerEl.empty();

		const defs = this.edgesSvgEl.createSvg('defs');
		const marker = defs.createSvg('marker', {
			attr: {
				id: this.arrowMarkerId,
				viewBox: '0 0 10 10',
				refX: '9',
				refY: '5',
				markerWidth: '7',
				markerHeight: '7',
				orient: 'auto-start-reverse',
			},
		});
		marker.createSvg('path', {
			cls: 'hl-wb-edge-arrow',
			attr: { d: 'M 0 1 L 10 5 L 0 9 z' },
		});

		const nodesById = new Map<string, WhiteboardNode>();
		for (const node of this.doc.nodes) nodesById.set(node.id, node);

		for (const edge of this.doc.edges) {
			const fromNode = nodesById.get(edge.fromNodeId);
			const toNode = nodesById.get(edge.toNodeId);
			if (!fromNode || !toNode) continue;

			const fromRect = getNodeRect(fromNode, this.getMeasuredNodeHeight(fromNode));
			const toRect = getNodeRect(toNode, this.getMeasuredNodeHeight(toNode));
			const anchors = computeEdgeAnchorPoints(fromRect, toRect, edge.fromSide, edge.toSide);
			const { path, midpoint } = computeEdgeBezierPath(
				anchors.from,
				anchors.to,
				anchors.fromSide,
				anchors.toSide,
			);

			const isSelected = this.selectedEdgeId === edge.id;
			const group = this.edgesSvgEl.createSvg('g', {
				cls: 'hl-wb-edge-group',
			});
			if (isSelected) group.classList.add('is-selected');
			const hitPath = group.createSvg('path', {
				cls: 'hl-wb-edge-hit',
				attr: { d: path },
			});
			group.createSvg('path', {
				cls: 'hl-wb-edge-path',
				attr: {
					d: path,
					'marker-end': `url(#${this.arrowMarkerId})`,
				},
			});

			const onEdgeClick = (ce: MouseEvent) => {
				ce.stopPropagation();
				this.rootEl.focus({ preventScroll: true });
				this.selectedEdgeId = edge.id;
				this.selectedNodeIds.clear();
				this.selectedSectionId = null;
				this.emitSelectionChange();
				this.updateSelectionVisuals();
				this.renderSections();
				this.renderEdges();
				this.openEdgeEditor(edge, midpoint, false);
			};
			const onEdgeDblClick = (ce: MouseEvent) => {
				ce.stopPropagation();
				this.rootEl.focus({ preventScroll: true });
				this.selectedEdgeId = edge.id;
				this.renderEdges();
				this.openEdgeEditor(edge, midpoint, true);
			};
			const onEdgeContextMenu = (ce: MouseEvent) => {
				ce.preventDefault();
				ce.stopPropagation();
				this.rootEl.focus({ preventScroll: true });
				this.selectedEdgeId = edge.id;
				this.renderEdges();
				const menu = new Menu();
				menu.addItem(item => item
					.setTitle(labelText('编辑连线标签', 'Edit edge label'))
					.setIcon('pencil')
					.onClick(() => {
						this.openEdgeEditor(edge, midpoint, true);
					}));
				menu.addItem(item => item
					.setTitle(labelText('删除连线', 'Delete connection'))
					.setIcon('trash-2')
					.onClick(() => {
						this.doc.edges = this.doc.edges.filter(itemEdge => itemEdge.id !== edge.id);
						if (this.selectedEdgeId === edge.id) this.selectedEdgeId = null;
						this.closeEdgeEditor();
						this.renderEdges();
						this.notifyDocChange();
					}));
				menu.showAtMouseEvent(ce);
			};
			hitPath.addEventListener('mousedown', (me: MouseEvent) => {
				me.preventDefault();
				me.stopPropagation();
				this.rootEl.focus({ preventScroll: true });
			});
			hitPath.addEventListener('click', onEdgeClick);
			hitPath.addEventListener('dblclick', onEdgeDblClick);
			hitPath.addEventListener('contextmenu', onEdgeContextMenu);

			const displayLabel = edge.label?.trim() || (edge.relation ? cardRelationLabel(edge.relation) : '');
			if (displayLabel) {
				const labelEl = this.edgeLabelsLayerEl.createDiv({
					cls: `hl-wb-edge-label${isSelected ? ' is-selected' : ''}`,
					text: displayLabel,
				});
				setCssProps(labelEl, {
					left: `${midpoint.x}px`,
					top: `${midpoint.y}px`,
				});
				labelEl.addEventListener('mousedown', (me: MouseEvent) => {
					me.stopPropagation();
					this.rootEl.focus({ preventScroll: true });
				});
				labelEl.addEventListener('click', onEdgeClick);
				labelEl.addEventListener('dblclick', onEdgeDblClick);
				labelEl.addEventListener('contextmenu', onEdgeContextMenu);
			}
		}

		// Render temporary preview edge while connecting
		if (this.interaction?.kind === 'connect-edge') {
			const fromNode = nodesById.get(this.interaction.fromNodeId);
			if (fromNode) {
				const fromRect = getNodeRect(fromNode, this.getMeasuredNodeHeight(fromNode));
				const targetRect: Rect = {
					x: this.interaction.currentCanvas.x,
					y: this.interaction.currentCanvas.y,
					width: 1,
					height: 1,
				};
				const anchors = computeEdgeAnchorPoints(fromRect, targetRect, this.interaction.fromSide, undefined);
				const { path } = computeEdgeBezierPath(
					anchors.from,
					this.interaction.currentCanvas,
					anchors.fromSide,
					anchors.toSide,
				);
				this.edgesSvgEl.createSvg('path', {
					cls: 'hl-wb-edge-preview',
					attr: {
						d: path,
						'marker-end': `url(#${this.arrowMarkerId})`,
					},
				});
			}
		}
	}

	private openEdgeEditor(edge: WhiteboardEdge, midpoint: Point, focusInput = false): void {
		this.closeEdgeEditor();
		const editor = this.viewportEl.createDiv({ cls: 'hl-wb-edge-editor' });
		setCssProps(editor, {
			left: `${midpoint.x}px`,
			top: `${midpoint.y}px`,
		});
		editor.addEventListener('mousedown', (me: MouseEvent) => me.stopPropagation());

		const input = editor.createEl('input', {
			cls: 'hl-wb-edge-editor-input',
			type: 'text',
			value: edge.label ?? '',
			attr: { placeholder: labelText('连线标签…', 'Edge label…') },
		});
		const saveBtn = editor.createEl('button', {
			cls: 'hl-wb-edge-editor-btn',
			text: labelText('保存', 'Save'),
			attr: { type: 'button' },
		});
		const delBtn = editor.createEl('button', {
			cls: 'hl-wb-edge-editor-btn is-danger',
			text: labelText('删除', 'Delete'),
			attr: { type: 'button' },
		});

		const commit = () => {
			edge.label = input.value.trim() || undefined;
			this.closeEdgeEditor();
			this.renderEdges();
			this.notifyDocChange();
		};

		saveBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			commit();
		});
		delBtn.addEventListener('click', (ce: MouseEvent) => {
			ce.stopPropagation();
			this.rootEl.focus({ preventScroll: true });
			this.doc.edges = this.doc.edges.filter(item => item.id !== edge.id);
			this.selectedEdgeId = null;
			this.closeEdgeEditor();
			this.renderEdges();
			this.notifyDocChange();
		});
		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			ke.stopPropagation();
			if (ke.key === 'Enter') commit();
			else if (ke.key === 'Escape') this.closeEdgeEditor();
		});

		this.edgeEditorEl = editor;
		if (focusInput) {
			window.setTimeout(() => {
				input.focus();
				input.select();
			}, 0);
		}
	}

	private closeEdgeEditor(): void {
		if (this.edgeEditorEl) {
			this.edgeEditorEl.remove();
			this.edgeEditorEl = null;
		}
	}

	// ── Helpers ───────────────────────────────────────────────

	private insertCardsAtPoint(ids: string[], startX: number, startY: number): void {
		const positions = layoutDroppedCards(
			startX,
			startY,
			ids.length,
			this.doc.nodes,
			DEFAULT_CARD_WIDTH,
			DEFAULT_NODE_HEIGHT,
			CARD_DROP_GAP,
		);

		const createdIds = new Set<string>();
		ids.forEach((highlightId, idx) => {
			const pos = positions[idx];
			if (!pos) return;
			const node: WhiteboardNode = {
				id: randomUUID(),
				type: 'card',
				highlightId,
				x: pos.x,
				y: pos.y,
				width: DEFAULT_CARD_WIDTH,
			};
			const containing = findContainingSection(getNodeRect(node, DEFAULT_NODE_HEIGHT), this.doc.sections);
			if (containing) node.sectionId = containing.id;
			this.doc.nodes.push(node);
			createdIds.add(node.id);
		});

		this.selectedNodeIds = createdIds;
		this.selectedEdgeId = null;
		this.selectedSectionId = null;
		this.closeEdgeEditor();
		this.renderNodes();
		this.renderEdges();
		this.emitSelectionChange();
		this.notifyDocChange();
	}

	private deleteSelected(): void {
		if (this.selectedEdgeId) {
			this.doc.edges = this.doc.edges.filter(e => e.id !== this.selectedEdgeId);
			this.selectedEdgeId = null;
			this.closeEdgeEditor();
			this.renderEdges();
			this.notifyDocChange();
			return;
		}

		if (this.selectedNodeIds.size > 0) {
			this.removeNodesById(new Set(this.selectedNodeIds));
			return;
		}

		if (this.selectedSectionId) {
			this.deleteSection(this.selectedSectionId);
		}
	}

	private removeNodesById(ids: ReadonlySet<string>): void {
		if (ids.size === 0) return;
		this.doc.nodes = this.doc.nodes.filter(n => !ids.has(n.id));
		this.doc.edges = this.doc.edges.filter(e => !ids.has(e.fromNodeId) && !ids.has(e.toNodeId));
		for (const id of ids) this.selectedNodeIds.delete(id);
		this.renderNodes();
		this.renderEdges();
		this.emitSelectionChange();
		this.notifyDocChange();
	}

	private deleteSection(sectionId: string): void {
		this.doc.sections = this.doc.sections.filter(s => s.id !== sectionId);
		for (const node of this.doc.nodes) {
			if (node.sectionId === sectionId) node.sectionId = undefined;
		}
		if (this.selectedSectionId === sectionId) this.selectedSectionId = null;
		if (this.activeColorPickerSectionId === sectionId) this.activeColorPickerSectionId = null;
		this.renderSections();
		this.notifyDocChange();
	}

	private reassignAllNodeSections(): void {
		for (const node of this.doc.nodes) {
			const rect = getNodeRect(node, this.getMeasuredNodeHeight(node));
			node.sectionId = findContainingSection(rect, this.doc.sections)?.id;
		}
		this.expandSectionsForInternalEdges();
	}

	private expandSectionsForInternalEdges(): void {
		let changed = false;
		const pad = 24;
		for (const section of this.doc.sections) {
			const memberNodes = this.doc.nodes.filter(n => n.sectionId === section.id);
			if (memberNodes.length < 2) continue;
			const bounds = computeGroupBounds(
				memberNodes,
				this.doc.edges,
				node => this.getMeasuredNodeHeight(node),
			);
			if (!bounds) continue;
			const reqMinX = bounds.x - pad;
			const reqMinY = bounds.y - 44;
			const reqMaxX = bounds.x + bounds.width + pad;
			const reqMaxY = bounds.y + bounds.height + pad;

			const curMaxX = section.x + section.width;
			const curMaxY = section.y + section.height;
			const nextX = Math.min(section.x, reqMinX);
			const nextY = Math.min(section.y, reqMinY);
			const nextMaxX = Math.max(curMaxX, reqMaxX);
			const nextMaxY = Math.max(curMaxY, reqMaxY);

			if (nextX !== section.x || nextY !== section.y || nextMaxX !== curMaxX || nextMaxY !== curMaxY) {
				section.x = nextX;
				section.y = nextY;
				section.width = nextMaxX - nextX;
				section.height = nextMaxY - nextY;
				changed = true;
			}
		}
		if (changed) this.renderSections();
	}

	private zoomByFactor(factor: number): void {
		const rect = this.rootEl.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		this.doc.viewport = zoomAtPoint(this.doc.viewport, factor, cx, cy, rect);
		this.applyViewportTransform();
		this.notifyDocChange();
	}

	private getViewportCenterCanvas(): Point {
		const rect = this.rootEl.getBoundingClientRect();
		return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, this.doc.viewport);
	}

	private clientToCanvas(clientX: number, clientY: number): Point {
		const rect = this.rootEl.getBoundingClientRect();
		return screenToCanvas(clientX, clientY, rect, this.doc.viewport);
	}

	private getMeasuredNodeHeight(node: WhiteboardNode): number {
		if (node.height && node.height > 0) return node.height;
		const el = this.nodeEls.get(node.id);
		if (el && el.offsetHeight > 0) return el.offsetHeight;
		return DEFAULT_NODE_HEIGHT;
	}

	private computeContentBounds(): Rect | null {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const sec of this.doc.sections) {
			minX = Math.min(minX, sec.x);
			minY = Math.min(minY, sec.y);
			maxX = Math.max(maxX, sec.x + sec.width);
			maxY = Math.max(maxY, sec.y + sec.height);
		}
		for (const node of this.doc.nodes) {
			const h = this.getMeasuredNodeHeight(node);
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x + node.width);
			maxY = Math.max(maxY, node.y + h);
		}

		if (!Number.isFinite(minX)) return null;
		return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
	}

	private updateSelectionVisuals(): void {
		for (const [id, el] of this.nodeEls.entries()) {
			el.toggleClass('is-selected', this.selectedNodeIds.has(id));
		}
	}

	private updateSectionSelectionVisuals(): void {
		for (const [id, el] of this.sectionEls.entries()) {
			el.toggleClass('is-selected', this.selectedSectionId === id);
		}
	}

	private emitSelectionChange(): void {
		this.options.onSelectionChange?.(new Set(this.selectedNodeIds));
	}

	private notifyDocChange(): void {
		this.doc.updatedAt = Date.now();
		this.options.onDocChange(this.doc);
	}
}
