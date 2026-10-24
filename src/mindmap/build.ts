// ============================================================
// HiLighter - Mind map tree builder (pure functions)
// ============================================================
// Converts highlight cards into a simple-mind-map node tree.
// No Obsidian imports: the view layer passes in everything the
// builder needs (heading list, color labels, hex resolver), so
// this stays vitest-testable like studio/grouping.ts.

import type { HighlightNote, MindMapBuildMode } from '../models';

/** A document heading, distilled from Obsidian's metadataCache. */
export interface HeadingLine {
    level: number;   // 1-6 (h1..h6)
    text: string;
    line: number;    // line index in the file
}

/** simple-mind-map node data + our custom link fields. */
export interface MindMapNodeData {
    uid?: string;
    text: string;
    expand?: boolean;
    note?: string;
    // Per-node visual overrides (simple-mind-map style props)
    fillColor?: string;
    borderColor?: string;
    // HiLighter link fields — kept on the node so the map can re-sync
    // with card edits and survive save/load round-trips.
    highlightId?: string;
    highlightText?: string;      // full highlighted text
    highlightNote?: string;      // user's personal note
    sourcePath?: string;
    lineIndex?: number;
    lost?: number;               // timestamp when the linked card went missing
    [key: string]: unknown;
}

export interface MindMapNode {
    data: MindMapNodeData;
    children?: MindMapNode[];
}

/** Leaf text longer than this is truncated (full text lives in note/hover). */
const LEAF_TEXT_LIMIT = 40;

/** Branch levels below the root stay collapsed on first render. */
const EXPANDED_DEPTH = 1;

let uidCounter = 0;

function uid(): string {
    uidCounter += 1;
    return `hl_${Date.now().toString(36)}_${uidCounter}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function truncate(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > LEAF_TEXT_LIMIT ? clean.slice(0, LEAF_TEXT_LIMIT) + '…' : clean;
}

/** Hover note shown by the engine's node icon: full text + user note. */
function buildNodeNote(text: string, note: string): string {
    return [text, note].filter(s => s.trim().length > 0).join('\n\n');
}

function makeLeaf(note: HighlightNote, options: BuildOptions): MindMapNode {
    return {
        data: {
            uid: uid(),
            text: truncate(note.text || '…'),
            expand: true,
            note: buildNodeNote(note.text || '', note.note || ''),
            borderColor: options.colorHex(note.color),
            highlightId: note.id,
            highlightText: note.text || '',
            highlightNote: note.note || '',
            sourcePath: note.sourcePath,
            lineIndex: note.lineIndex,
        },
        children: [],
    };
}

export interface BuildOptions {
    fileName: string;
    mode: MindMapBuildMode;
    /** UI label for a color id (semantic label / custom name / hex). */
    colorLabel: (colorId: string) => string;
    /** UI hex for a color id (falls back inside the caller's resolver). */
    colorHex: (colorId: string) => string;
    /** Localized "uncategorized" label for the tag mode. */
    uncategorizedLabel: string;
    /** Localized "intro" label for cards above the first heading. */
    introLabel: string;
}

interface HeadingBranch {
    node: MindMapNode;
    line: number;
    children: HeadingBranch[];
}

/**
 * Builds a nested heading branch list, one root-level branch per heading
 * at the shallowest level that actually appears in the document.
 */
function buildHeadingBranches(headings: HeadingLine[]): HeadingBranch[] {
    const usable = headings
        .filter(h => h.text.trim().length > 0)
        .sort((a, b) => a.line - b.line);
    const minLevel = usable.reduce((min, h) => Math.min(min, h.level), 6);

    const topBranches: HeadingBranch[] = [];
    const stack: HeadingBranch[] = [];

    for (const heading of usable) {
        const depth = heading.level - minLevel;
        while (stack.length > depth) {
            stack.pop();
        }
        const branch: HeadingBranch = {
            node: { data: { uid: uid(), text: heading.text, expand: true }, children: [] },
            line: heading.line,
            children: [],
        };
        if (stack.length === 0) {
            topBranches.push(branch);
        } else {
            stack[stack.length - 1]!.children.push(branch);
        }
        stack.push(branch);
    }

    return topBranches;
}

/** Collects every heading branch (any depth) into a flat list. */
function flattenBranches(branches: HeadingBranch[]): HeadingBranch[] {
    const all: HeadingBranch[] = [];
    const walk = (branch: HeadingBranch) => {
        all.push(branch);
        for (const child of branch.children) walk(child);
    };
    for (const branch of branches) walk(branch);
    return all;
}

/** Materializes the recursive branch structure into a node tree. */
function branchesToNodes(branches: HeadingBranch[]): MindMapNode[] {
    return branches.map(branch => {
        branch.node.children = branchesToNodes(branch.children);
        return branch.node;
    });
}

/** Collapses every branch deeper than `depth` (root = depth 0). */
function applyExpandDepths(node: MindMapNode, depth: number): void {
    node.data.expand = depth < EXPANDED_DEPTH;
    for (const child of node.children ?? []) applyExpandDepths(child, depth + 1);
}

/**
 * Main entry: build a mind map tree from highlight cards.
 * - `headings` (default): file name as root, heading hierarchy as branches,
 *   cards filed under their nearest preceding heading (by lineIndex).
 * - `color`: branches per highlight color.
 * - `tag`: branches per tag, untagged cards under `uncategorizedLabel`.
 * - `flat`: every card directly under the root, ordered by line.
 * Falls back from `headings` to `color` when the document has no headings.
 */
export function buildMindMapTree(
    notes: HighlightNote[],
    headings: HeadingLine[],
    options: BuildOptions,
): MindMapNode {
    const root: MindMapNode = {
        data: { uid: uid(), text: options.fileName, expand: true },
        children: [],
    };

    if (notes.length === 0) {
        return root;
    }

    const sorted = [...notes].sort((a, b) => (a.lineIndex ?? 0) - (b.lineIndex ?? 0));

    if (options.mode === 'headings') {
        const usableHeadings = headings.filter(h => h.text.trim().length > 0);
        if (usableHeadings.length === 0) {
            return buildMindMapTree(notes, headings, { ...options, mode: 'color' });
        }
        const branchTree = buildHeadingBranches(usableHeadings);
        const flat = flattenBranches(branchTree);
        // Materialize the heading node tree BEFORE attaching cards, so
        // card leaves pushed below aren't overwritten.
        const topNodes = branchesToNodes(branchTree);

        const firstLine = usableHeadings.reduce((min, h) => Math.min(min, h.line), Number.MAX_SAFE_INTEGER);
        const intro: MindMapNode | null = sorted.some(n => (n.lineIndex ?? 0) < firstLine)
            ? { data: { uid: uid(), text: options.introLabel, expand: true }, children: [] }
            : null;

        for (const note of sorted) {
            const leaf = makeLeaf(note, options);
            const line = note.lineIndex ?? 0;
            const owner = flat
                .filter(b => b.line <= line)
                .sort((a, b) => b.line - a.line)[0];
            if (owner) {
                owner.node.children!.push(leaf);
            } else if (intro) {
                intro.children!.push(leaf);
            } else {
                root.children!.push(leaf);
            }
        }
        root.children = intro ? [intro, ...topNodes] : topNodes;
        applyExpandDepths(root, 0);
        return root;
    }

    if (options.mode === 'color') {
        const byColor = new Map<string, HighlightNote[]>();
        for (const note of notes) {
            const list = byColor.get(note.color) ?? [];
            list.push(note);
            byColor.set(note.color, list);
        }
        for (const [colorId, list] of byColor) {
            root.children!.push({
                data: {
                    uid: uid(),
                    text: options.colorLabel(colorId),
                    expand: true,
                    borderColor: options.colorHex(colorId),
                },
                children: list.map(n => makeLeaf(n, options)),
            });
        }
        applyExpandDepths(root, 0);
        return root;
    }

    if (options.mode === 'tag') {
        const byTag = new Map<string, HighlightNote[]>();
        for (const note of notes) {
            const tags = note.tags && note.tags.length > 0 ? note.tags : ['__uncategorized__'];
            for (const tag of tags) {
                const list = byTag.get(tag) ?? [];
                list.push(note);
                byTag.set(tag, list);
            }
        }
        for (const [tag, list] of byTag) {
            root.children!.push({
                data: {
                    uid: uid(),
                    text: tag === '__uncategorized__' ? options.uncategorizedLabel : tag,
                    expand: true,
                },
                children: list.map(n => makeLeaf(n, options)),
            });
        }
        applyExpandDepths(root, 0);
        return root;
    }

    // flat
    for (const note of sorted) {
        root.children!.push(makeLeaf(note, options));
    }
    applyExpandDepths(root, 0);
    return root;
}

/** Re-numbers uids so simple-mind-map always has fresh node identities. */
export function ensureUids(node: MindMapNode): void {
    if (!node.data.uid) node.data.uid = uid();
    for (const child of node.children ?? []) ensureUids(child);
}

/**
 * Re-syncs a saved tree with the latest card data: updates text/note/color
 * on linked nodes and flags nodes whose card no longer exists.
 * Mutates and returns the tree.
 */
export function syncTreeWithCards(
    tree: MindMapNode,
    cardsById: Map<string, HighlightNote>,
    options: Pick<BuildOptions, 'colorHex'>,
): { tree: MindMapNode; changed: boolean } {
    let changed = false;
    const walk = (node: MindMapNode) => {
        const id = node.data.highlightId;
        if (id) {
            const card = cardsById.get(id);
            if (card) {
                const full = card.text || '';
                const userNote = card.note || '';
                if (node.data.highlightText !== full || node.data.highlightNote !== userNote) {
                    node.data.highlightText = full;
                    node.data.highlightNote = userNote;
                    node.data.note = buildNodeNote(full, userNote);
                    node.data.text = truncate(full || '…');
                    changed = true;
                }
                const hex = options.colorHex(card.color);
                if (node.data.borderColor !== hex) {
                    node.data.borderColor = hex;
                    changed = true;
                }
                if (node.data.lost) {
                    node.data.lost = undefined;
                    changed = true;
                }
            } else if (!node.data.lost) {
                node.data.lost = Date.now();
                changed = true;
            }
        }
        for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
    return { tree, changed };
}
