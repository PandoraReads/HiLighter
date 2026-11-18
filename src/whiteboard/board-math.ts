// ============================================================
// HiLighter - Whiteboard pure math & geometry helpers
// ============================================================
// Zero DOM / Obsidian imports so vitest can test directly.

import type { WhiteboardEdge, WhiteboardNode, WhiteboardSection, WhiteboardViewport } from '../models';

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ViewportRect {
    left: number;
    top: number;
}

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2.5;
export const DEFAULT_NODE_HEIGHT = 140;

/** Clamp a zoom factor within [min, max], falling back to 1 for non-finite values. */
export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
    if (!Number.isFinite(zoom)) return 1;
    return Math.min(max, Math.max(min, zoom));
}

/** Convert screen (client) coordinates to canvas world coordinates. */
export function screenToCanvas(
    screenX: number,
    screenY: number,
    rect: ViewportRect,
    viewport: WhiteboardViewport,
): Point {
    const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
    return {
        x: (screenX - rect.left - viewport.x) / zoom,
        y: (screenY - rect.top - viewport.y) / zoom,
    };
}

/** Convert canvas world coordinates to screen (client) coordinates. */
export function canvasToScreen(
    canvasX: number,
    canvasY: number,
    rect: ViewportRect,
    viewport: WhiteboardViewport,
): Point {
    return {
        x: rect.left + viewport.x + canvasX * viewport.zoom,
        y: rect.top + viewport.y + canvasY * viewport.zoom,
    };
}

/**
 * Zoom the viewport by `factor` while keeping the canvas point under
 * `(clientX, clientY)` stationary on screen.
 */
export function zoomAtPoint(
    viewport: WhiteboardViewport,
    factor: number,
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    minZoom = MIN_ZOOM,
    maxZoom = MAX_ZOOM,
): WhiteboardViewport {
    const nextZoom = clampZoom(viewport.zoom * factor, minZoom, maxZoom);
    const world = screenToCanvas(clientX, clientY, rect, viewport);
    return {
        x: clientX - rect.left - world.x * nextZoom,
        y: clientY - rect.top - world.y * nextZoom,
        zoom: nextZoom,
    };
}

/** Return true if two axis-aligned rectangles overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y
    );
}

/** Normalize a rectangle that may have negative width or height. */
export function normalizeRect(rect: Rect): Rect {
    const x = rect.width < 0 ? rect.x + rect.width : rect.x;
    const y = rect.height < 0 ? rect.y + rect.height : rect.y;
    return {
        x,
        y,
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
    };
}

/** Resolve a node's bounding box, using `defaultHeight` when `node.height` is absent. */
export function getNodeRect(node: WhiteboardNode, defaultHeight = DEFAULT_NODE_HEIGHT): Rect {
    return {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height ?? defaultHeight,
    };
}

/**
 * Lay out `count` dropped cards in a grid starting near `(startX, startY)`
 * while shifting downward if a slot overlaps any existing node or previously
 * placed card in the same batch.
 */
export function layoutDroppedCards(
    startX: number,
    startY: number,
    count: number,
    existingNodes: readonly WhiteboardNode[],
    cardWidth: number,
    cardHeight: number,
    gap: number,
): Point[] {
    if (count <= 0) return [];
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
    const stepX = cardWidth + gap;
    const stepY = cardHeight + gap;
    const occupied: Rect[] = existingNodes.map(node => getNodeRect(node, cardHeight));
    const positions: Point[] = [];

    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * stepX;
        let y = startY + row * stepY;

        while (occupied.some(rect => rectsOverlap({ x, y, width: cardWidth, height: cardHeight }, rect))) {
            y += stepY;
        }

        const placed: Rect = { x, y, width: cardWidth, height: cardHeight };
        occupied.push(placed);
        positions.push({ x, y });
    }

    return positions;
}

/**
 * Find the section containing the center of `nodeRect`.
 * When multiple sections overlap, the smallest-area section wins.
 */
export function findContainingSection(
    nodeRect: Rect,
    sections: readonly WhiteboardSection[],
): WhiteboardSection | undefined {
    const cx = nodeRect.x + nodeRect.width / 2;
    const cy = nodeRect.y + nodeRect.height / 2;

    let best: WhiteboardSection | undefined;
    let bestArea = Infinity;

    for (const section of sections) {
        const inside =
            cx >= section.x
            && cx <= section.x + section.width
            && cy >= section.y
            && cy <= section.y + section.height;
        if (!inside) continue;

        const area = section.width * section.height;
        if (area <= bestArea) {
            best = section;
            bestArea = area;
        }
    }

    return best;
}

/** Return all nodes whose bounding box intersects `boxRect`. */
export function nodesInSelectionBox(
    nodes: readonly WhiteboardNode[],
    boxRect: Rect,
    heightOrResolver: number | ((node: WhiteboardNode) => number) = DEFAULT_NODE_HEIGHT,
): WhiteboardNode[] {
    const normalized = normalizeRect(boxRect);
    return nodes.filter(node => {
        const h = typeof heightOrResolver === 'function' ? heightOrResolver(node) : heightOrResolver;
        return rectsOverlap(getNodeRect(node, h), normalized);
    });
}

/** Return the side of `rect` closest to `pt` (used to lock an edge's target side on drop). */
export function nearestRectSide(rect: Rect, pt: Point): EdgeSide {
    const distances: Array<{ side: EdgeSide; dist: number }> = [
        { side: 'top', dist: Math.abs(pt.y - rect.y) },
        { side: 'bottom', dist: Math.abs(pt.y - (rect.y + rect.height)) },
        { side: 'left', dist: Math.abs(pt.x - rect.x) },
        { side: 'right', dist: Math.abs(pt.x - (rect.x + rect.width)) },
    ];
    distances.sort((a, b) => a.dist - b.dist);
    return distances[0]!.side;
}

/** Compute the anchor point on the specified side of `rect`. */
export function sideAnchorPoint(rect: Rect, side: EdgeSide): Point {
    switch (side) {
        case 'top':
            return { x: rect.x + rect.width / 2, y: rect.y };
        case 'right':
            return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
        case 'bottom':
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
        case 'left':
            return { x: rect.x, y: rect.y + rect.height / 2 };
    }
}

/**
 * Compute anchor points and resolved sides between two node rectangles.
 * Missing sides are chosen automatically from the relative center vector.
 */
export function computeEdgeAnchorPoints(
    fromRect: Rect,
    toRect: Rect,
    fromSide?: EdgeSide,
    toSide?: EdgeSide,
): { from: Point; to: Point; fromSide: EdgeSide; toSide: EdgeSide } {
    const fromCenterX = fromRect.x + fromRect.width / 2;
    const fromCenterY = fromRect.y + fromRect.height / 2;
    const toCenterX = toRect.x + toRect.width / 2;
    const toCenterY = toRect.y + toRect.height / 2;

    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;

    let autoFrom: EdgeSide;
    let autoTo: EdgeSide;
    if (Math.abs(dx) >= Math.abs(dy)) {
        autoFrom = dx >= 0 ? 'right' : 'left';
        autoTo = dx >= 0 ? 'left' : 'right';
    } else {
        autoFrom = dy >= 0 ? 'bottom' : 'top';
        autoTo = dy >= 0 ? 'top' : 'bottom';
    }

    const resolvedFromSide = fromSide ?? autoFrom;
    const resolvedToSide = toSide ?? autoTo;

    return {
        from: sideAnchorPoint(fromRect, resolvedFromSide),
        to: sideAnchorPoint(toRect, resolvedToSide),
        fromSide: resolvedFromSide,
        toSide: resolvedToSide,
    };
}

function sideDirection(side: EdgeSide): Point {
    switch (side) {
        case 'top':
            return { x: 0, y: -1 };
        case 'right':
            return { x: 1, y: 0 };
        case 'bottom':
            return { x: 0, y: 1 };
        case 'left':
            return { x: -1, y: 0 };
    }
}

/**
 * Build an SVG cubic bezier path string and its midpoint (t = 0.5)
 * between two anchor points.
 */
export function computeEdgeBezierPath(
    from: Point,
    to: Point,
    fromSide: EdgeSide,
    toSide: EdgeSide,
): { path: string; midpoint: Point; bounds: Rect } {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const offset = Math.max(36, Math.min(130, dist * 0.38));
    const fromDir = sideDirection(fromSide);
    const toDir = sideDirection(toSide);

    const cp1: Point = { x: from.x + fromDir.x * offset, y: from.y + fromDir.y * offset };
    const cp2: Point = { x: to.x + toDir.x * offset, y: to.y + toDir.y * offset };

    const path = `M ${from.x} ${from.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${to.x} ${to.y}`;
    const midpoint: Point = {
        x: 0.125 * from.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * to.x,
        y: 0.125 * from.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * to.y,
    };

    let minX = Math.min(from.x, to.x);
    let minY = Math.min(from.y, to.y);
    let maxX = Math.max(from.x, to.x);
    let maxY = Math.max(from.y, to.y);
    const steps = 20;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const x = mt * mt * mt * from.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * to.x;
        const y = mt * mt * mt * from.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * to.y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    return {
        path,
        midpoint,
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
}

/**
 * Compute the bounding box covering `nodes` AND all `edges` connecting any two nodes in `nodes`.
 */
export function computeGroupBounds(
    nodes: readonly WhiteboardNode[],
    edges: readonly WhiteboardEdge[],
    heightOrResolver: number | ((node: WhiteboardNode) => number) = DEFAULT_NODE_HEIGHT,
): Rect | null {
    if (nodes.length === 0) return null;
    const byId = new Map<string, Rect>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        const h = typeof heightOrResolver === 'function' ? heightOrResolver(node) : heightOrResolver;
        const rect = getNodeRect(node, h);
        byId.set(node.id, rect);
        if (rect.x < minX) minX = rect.x;
        if (rect.y < minY) minY = rect.y;
        if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
        if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
    }

    for (const edge of edges) {
        const fromRect = byId.get(edge.fromNodeId);
        const toRect = byId.get(edge.toNodeId);
        if (!fromRect || !toRect) continue;
        const anchors = computeEdgeAnchorPoints(fromRect, toRect, edge.fromSide, edge.toSide);
        const { bounds } = computeEdgeBezierPath(anchors.from, anchors.to, anchors.fromSide, anchors.toSide);
        if (bounds.x < minX) minX = bounds.x;
        if (bounds.y < minY) minY = bounds.y;
        if (bounds.x + bounds.width > maxX) maxX = bounds.x + bounds.width;
        if (bounds.y + bounds.height > maxY) maxY = bounds.y + bounds.height;
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
