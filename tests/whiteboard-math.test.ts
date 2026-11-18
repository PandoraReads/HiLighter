import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { HiLighterDatabase } from '../src/db';
import type { WhiteboardDoc, WhiteboardNode, WhiteboardSection } from '../src/models';
import {
    MAX_ZOOM,
    MIN_ZOOM,
    canvasToScreen,
    clampZoom,
    computeEdgeAnchorPoints,
    computeEdgeBezierPath,
    computeGroupBounds,
    findContainingSection,
    layoutDroppedCards,
    nearestRectSide,
    nodesInSelectionBox,
    rectsOverlap,
    screenToCanvas,
    zoomAtPoint,
} from '../src/whiteboard/board-math';

let dbSeq = 0;

function makeDb(): HiLighterDatabase {
    return new HiLighterDatabase(`hilighter-wb-test-${dbSeq++}`);
}

function makeWhiteboard(overrides: Partial<WhiteboardDoc> = {}): WhiteboardDoc {
    return {
        id: 'wb-1',
        title: 'Test Whiteboard',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        sections: [],
        edges: [],
        createdAt: 1000,
        updatedAt: 1000,
        ...overrides,
    };
}

function makeNode(overrides: Partial<WhiteboardNode> = {}): WhiteboardNode {
    return {
        id: 'n-1',
        type: 'card',
        highlightId: 'hl-1',
        x: 0,
        y: 0,
        width: 240,
        height: 140,
        ...overrides,
    };
}

function makeSection(overrides: Partial<WhiteboardSection> = {}): WhiteboardSection {
    return {
        id: 'sec-1',
        title: 'Section 1',
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        color: 'blue',
        ...overrides,
    };
}

describe('board-math: coordinate transforms & zoom', () => {
    const rect = { left: 100, top: 50 };

    it('converts between screen and canvas coordinates as exact inverses', () => {
        const viewport = { x: 120, y: -40, zoom: 1.5 };
        const canvasPt = screenToCanvas(400, 310, rect, viewport);
        // (400 - 100 - 120) / 1.5 = 120; (310 - 50 - (-40)) / 1.5 = 200
        expect(canvasPt.x).toBeCloseTo(120);
        expect(canvasPt.y).toBeCloseTo(200);

        const backToScreen = canvasToScreen(canvasPt.x, canvasPt.y, rect, viewport);
        expect(backToScreen.x).toBeCloseTo(400);
        expect(backToScreen.y).toBeCloseTo(310);
    });

    it('clamps zoom within [MIN_ZOOM, MAX_ZOOM] and handles non-finite inputs', () => {
        expect(clampZoom(0.01)).toBe(MIN_ZOOM);
        expect(clampZoom(10)).toBe(MAX_ZOOM);
        expect(clampZoom(1.25)).toBe(1.25);
        expect(clampZoom(Number.NaN)).toBe(1);
    });

    it('zooms around the cursor point without drifting the world point under cursor', () => {
        const viewport = { x: 50, y: 80, zoom: 1 };
        const clientX = 350;
        const clientY = 230;
        const beforeWorld = screenToCanvas(clientX, clientY, rect, viewport);

        const next = zoomAtPoint(viewport, 1.5, clientX, clientY, rect);
        expect(next.zoom).toBeCloseTo(1.5);

        const afterWorld = screenToCanvas(clientX, clientY, rect, next);
        expect(afterWorld.x).toBeCloseTo(beforeWorld.x);
        expect(afterWorld.y).toBeCloseTo(beforeWorld.y);
    });

    it('clamps zoomAtPoint at MAX_ZOOM without shifting coordinates', () => {
        const viewport = { x: 20, y: 30, zoom: MAX_ZOOM };
        const next = zoomAtPoint(viewport, 2, 250, 200, rect);
        expect(next.zoom).toBe(MAX_ZOOM);
        expect(next.x).toBeCloseTo(viewport.x);
        expect(next.y).toBeCloseTo(viewport.y);
    });
});

describe('board-math: layoutDroppedCards', () => {
    it('returns empty array for count <= 0', () => {
        expect(layoutDroppedCards(0, 0, 0, [], 240, 140, 20)).toEqual([]);
        expect(layoutDroppedCards(0, 0, -2, [], 240, 140, 20)).toEqual([]);
    });

    it('lays out multiple dropped cards in a non-overlapping grid', () => {
        const positions = layoutDroppedCards(100, 100, 4, [], 200, 100, 20);
        expect(positions).toEqual([
            { x: 100, y: 100 },
            { x: 320, y: 100 },
            { x: 100, y: 220 },
            { x: 320, y: 220 },
        ]);
    });

    it('shifts cards downward to avoid overlapping existing nodes', () => {
        const existing = [
            makeNode({ id: 'e1', x: 100, y: 100, width: 200, height: 100 }),
        ];
        const positions = layoutDroppedCards(100, 100, 2, existing, 200, 100, 20);
        expect(positions).toHaveLength(2);
        // First card must shift down past existing (100 + 100 + 20 = 220)
        expect(positions[0]).toEqual({ x: 100, y: 220 });
        expect(positions[1]).toEqual({ x: 320, y: 100 });

        for (const pos of positions) {
            const candidate = { x: pos.x, y: pos.y, width: 200, height: 100 };
            expect(rectsOverlap(candidate, { x: 100, y: 100, width: 200, height: 100 })).toBe(false);
        }
    });
});

describe('board-math: sections & selection box', () => {
    it('finds the containing section by node center and prefers smaller nested section', () => {
        const outer = makeSection({ id: 'outer', x: 0, y: 0, width: 1000, height: 800 });
        const inner = makeSection({ id: 'inner', x: 100, y: 100, width: 300, height: 300 });
        const outside = makeSection({ id: 'other', x: 1200, y: 0, width: 300, height: 300 });

        const inInner = findContainingSection({ x: 150, y: 150, width: 100, height: 100 }, [outer, inner, outside]);
        expect(inInner?.id).toBe('inner');

        const inOuterOnly = findContainingSection({ x: 600, y: 500, width: 100, height: 100 }, [outer, inner, outside]);
        expect(inOuterOnly?.id).toBe('outer');

        const inNone = findContainingSection({ x: -200, y: -200, width: 50, height: 50 }, [outer, inner, outside]);
        expect(inNone).toBeUndefined();
    });

    it('finds nodes intersecting a selection box including negative drag dimensions', () => {
        const nodes = [
            makeNode({ id: 'a', x: 50, y: 50, width: 100, height: 100 }),
            makeNode({ id: 'b', x: 200, y: 200, width: 100, height: 100 }),
            makeNode({ id: 'c', x: 500, y: 500, width: 100, height: 100 }),
        ];

        const hit = nodesInSelectionBox(nodes, { x: 260, y: 260, width: -160, height: -160 });
        expect(hit.map(n => n.id)).toEqual(['a', 'b']);
    });
});

describe('board-math: edge anchors & cubic bezier path', () => {
    it('selects horizontal sides when target is predominantly to the right', () => {
        const from = { x: 0, y: 0, width: 200, height: 100 };
        const to = { x: 400, y: 20, width: 200, height: 100 };
        const anchors = computeEdgeAnchorPoints(from, to);

        expect(anchors.fromSide).toBe('right');
        expect(anchors.toSide).toBe('left');
        expect(anchors.from).toEqual({ x: 200, y: 50 });
        expect(anchors.to).toEqual({ x: 400, y: 70 });
    });

    it('selects vertical sides when target is predominantly below', () => {
        const from = { x: 0, y: 0, width: 200, height: 100 };
        const to = { x: 20, y: 300, width: 200, height: 100 };
        const anchors = computeEdgeAnchorPoints(from, to);

        expect(anchors.fromSide).toBe('bottom');
        expect(anchors.toSide).toBe('top');
        expect(anchors.from).toEqual({ x: 100, y: 100 });
        expect(anchors.to).toEqual({ x: 120, y: 300 });
    });

    it('respects explicit sides and computes a valid SVG cubic bezier path and midpoint', () => {
        const from = { x: 0, y: 0, width: 100, height: 100 };
        const to = { x: 300, y: 0, width: 100, height: 100 };
        const anchors = computeEdgeAnchorPoints(from, to, 'top', 'bottom');
        expect(anchors.fromSide).toBe('top');
        expect(anchors.toSide).toBe('bottom');

        const { path, midpoint } = computeEdgeBezierPath(anchors.from, anchors.to, 'top', 'bottom');
        expect(path).toMatch(/^M \S+ \S+ C \S+ \S+, \S+ \S+, \S+ \S+$/);
        expect(midpoint.x).toBeCloseTo((anchors.from.x + anchors.to.x) / 2);
        expect(midpoint.y).toBeCloseTo((anchors.from.y + anchors.to.y) / 2);
    });

    it('nearestRectSide picks the side closest to the drop point', () => {
        const rect = { x: 100, y: 100, width: 200, height: 100 };
        expect(nearestRectSide(rect, { x: 200, y: 104 })).toBe('top');
        expect(nearestRectSide(rect, { x: 200, y: 196 })).toBe('bottom');
        expect(nearestRectSide(rect, { x: 105, y: 150 })).toBe('left');
        expect(nearestRectSide(rect, { x: 295, y: 150 })).toBe('right');
    });

    it('computeGroupBounds encompasses bezier curves bulging outside node bounds', () => {
        const leftNode = makeNode({ id: 'n1', x: 100, y: 200, width: 200, height: 100 });
        const rightNode = makeNode({ id: 'n2', x: 600, y: 200, width: 200, height: 100 });
        const bounds = computeGroupBounds(
            [leftNode, rightNode],
            [{ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', fromSide: 'bottom', toSide: 'left' }],
            100,
        );
        expect(bounds).not.toBeNull();
        // Bottom-anchored curve bulges below y = 300 (bottom of leftNode)
        expect(bounds!.y + bounds!.height).toBeGreaterThan(300);
    });
});

describe('db: whiteboard CRUD (Dexie v7)', () => {
    it('saves, retrieves, lists newest-first, deletes whiteboards, and notifies listeners', async () => {
        const db = makeDb();
        const listener = vi.fn();
        const unsub = db.onChange(listener);

        await db.saveWhiteboard(makeWhiteboard({ id: 'wb-old', title: 'Old', updatedAt: 100 }));
        await db.saveWhiteboard(makeWhiteboard({
            id: 'wb-new',
            title: 'New',
            sourcePath: 'books/note.md',
            updatedAt: 200,
            nodes: [makeNode({ id: 'n1' })],
        }));

        expect(listener).toHaveBeenCalledTimes(2);

        const fetched = await db.getWhiteboard('wb-new');
        expect(fetched?.title).toBe('New');
        expect(fetched?.nodes).toHaveLength(1);

        const list = await db.listWhiteboards();
        expect(list.map(w => w.id)).toEqual(['wb-new', 'wb-old']);

        await db.deleteWhiteboard('wb-old');
        expect(listener).toHaveBeenCalledTimes(3);
        expect(await db.getWhiteboard('wb-old')).toBeUndefined();
        expect((await db.listWhiteboards()).map(w => w.id)).toEqual(['wb-new']);

        unsub();
        await db.delete();
    });
});
