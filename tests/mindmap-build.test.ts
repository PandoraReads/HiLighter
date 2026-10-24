import { describe, expect, it } from 'vitest';
import {
    buildMindMapTree,
    ensureUids,
    syncTreeWithCards,
    type HeadingLine,
    type MindMapNode,
} from '../src/mindmap/build';
import type { HighlightNote } from '../src/models';

const OPTIONS = {
    fileName: 'My Book',
    mode: 'headings' as const,
    colorLabel: (id: string) => `label:${id}`,
    colorHex: (id: string) => `hex:${id}`,
    uncategorizedLabel: 'Uncategorized',
    introLabel: 'Intro',
};

function note(overrides: Partial<HighlightNote>): HighlightNote {
    return {
        id: overrides.id ?? Math.random().toString(36).slice(2),
        text: 'some text',
        color: 'yellow',
        note: '',
        sourcePath: 'book.md',
        lineIndex: 0,
        createdAt: 0,
        ...overrides,
    };
}

const HEADINGS: HeadingLine[] = [
    { level: 1, text: 'Chapter 1', line: 0 },
    { level: 2, text: 'Section A', line: 10 },
    { level: 2, text: 'Section B', line: 20 },
    { level: 1, text: 'Chapter 2', line: 30 },
];

function findChild(node: MindMapNode, text: string): MindMapNode | undefined {
    return node.children?.find(c => c.data.text === text);
}

function allLeaves(node: MindMapNode): MindMapNode[] {
    if (!node.children || node.children.length === 0) return [node];
    return node.children.flatMap(allLeaves);
}

describe('buildMindMapTree', () => {
    it('returns a bare root for an empty note list', () => {
        const tree = buildMindMapTree([], [], OPTIONS);
        expect(tree.data.text).toBe('My Book');
        expect(tree.children).toHaveLength(0);
    });

    it('builds heading branches at the shallowest level and files cards by line', () => {
        const tree = buildMindMapTree(
            [
                note({ id: 'a', lineIndex: 12 }),
                note({ id: 'b', lineIndex: 25 }),
                note({ id: 'c', lineIndex: 31 }),
            ],
            HEADINGS,
            OPTIONS,
        );

        // Root branches = h1 level only (Chapter 1, Chapter 2); h2s nest inside.
        const chapter1 = findChild(tree, 'Chapter 1');
        const chapter2 = findChild(tree, 'Chapter 2');
        expect(chapter1).toBeDefined();
        expect(chapter2).toBeDefined();
        expect(chapter1!.children!.map(c => c.data.text)).toEqual(['Section A', 'Section B']);

        const cardA = allLeaves(chapter1!).find(n => n.data.highlightId === 'a');
        const cardB = allLeaves(chapter1!).find(n => n.data.highlightId === 'b');
        const cardC = allLeaves(chapter2!).find(n => n.data.highlightId === 'c');
        expect(cardA).toBeDefined();   // line 12 → Section A (line 10)
        expect(cardB).toBeDefined();   // line 25 → Section B (line 20)
        expect(cardC).toBeDefined();
    });

    it('puts cards above the first heading into an intro branch', () => {
        const headings: HeadingLine[] = [{ level: 1, text: 'Chapter 1', line: 5 }];
        const tree = buildMindMapTree([note({ id: 'early', lineIndex: 2 })], headings, OPTIONS);
        const intro = findChild(tree, 'Intro');
        expect(intro).toBeDefined();
        expect(intro!.children![0]!.data.highlightId).toBe('early');
    });

    it('falls back to color mode when there are no headings', () => {
        const tree = buildMindMapTree(
            [note({ color: 'blue' }), note({ color: 'yellow' })],
            [],
            OPTIONS,
        );
        const labels = tree.children!.map(c => c.data.text).sort();
        expect(labels).toEqual(['label:blue', 'label:yellow']);
        // Branch color comes from the color hex resolver.
        const blueBranch = findChild(tree, 'label:blue');
        expect(blueBranch!.data.borderColor).toBe('hex:blue');
    });

    it('groups by tag and collects untagged cards', () => {
        const tree = buildMindMapTree(
            [
                note({ id: 't1', tags: ['core'] }),
                note({ id: 't2', tags: ['core', 'idea'] }),
                note({ id: 't3' }),
            ],
            [],
            { ...OPTIONS, mode: 'tag' },
        );
        const names = tree.children!.map(c => c.data.text).sort();
        // Multi-tag cards appear under each tag.
        expect(names).toEqual(['Uncategorized', 'core', 'idea']);
        const core = findChild(tree, 'core')!;
        expect(core.children!.map(n => n.data.highlightId).sort()).toEqual(['t1', 't2']);
        const uncategorized = findChild(tree, 'Uncategorized')!;
        expect(uncategorized.children!.map(n => n.data.highlightId)).toEqual(['t3']);
    });

    it('flattens every card under the root in line order', () => {
        const tree = buildMindMapTree(
            [note({ id: 'late', lineIndex: 9 }), note({ id: 'early', lineIndex: 1 })],
            [],
            { ...OPTIONS, mode: 'flat' },
        );
        expect(tree.children!.map(c => c.data.highlightId)).toEqual(['early', 'late']);
    });

    it('truncates long leaf text and keeps the full text on the node', () => {
        const long = 'x'.repeat(80);
        const tree = buildMindMapTree([note({ id: 'long', text: long })], [], { ...OPTIONS, mode: 'flat' });
        const leaf = tree.children![0]!;
        expect(leaf.data.text.length).toBeLessThanOrEqual(41); // 40 + ellipsis
        expect(leaf.data.highlightText).toBe(long);
        expect(leaf.data.note).toContain(long);
    });

    it('collapses branches below the first level', () => {
        const tree = buildMindMapTree(
            [note({ lineIndex: 12 })],
            HEADINGS,
            OPTIONS,
        );
        expect(tree.data.expand).toBe(true);
        expect(tree.children![0]!.data.expand).toBe(false); // Chapter 1 branch collapsed
    });

    it('stamps a uid on every node', () => {
        const tree = buildMindMapTree([note({ lineIndex: 12 })], HEADINGS, OPTIONS);
        ensureUids(tree);
        const walk = (n: MindMapNode): string[] => [n.data.uid!, ...n.children!.flatMap(walk)];
        expect(walk(tree).every(uid => typeof uid === 'string' && uid.length > 0)).toBe(true);
    });
});

describe('syncTreeWithCards', () => {
    it('updates linked nodes with edited card text and note', () => {
        const tree = buildMindMapTree([note({ id: 'card1', text: 'old', note: '' })], [], { ...OPTIONS, mode: 'flat' });
        const cards = new Map([['card1', note({ id: 'card1', text: 'new text', note: 'my note' })]]);
        const { changed } = syncTreeWithCards(tree, cards, OPTIONS);
        expect(changed).toBe(true);
        const leaf = tree.children![0]!;
        expect(leaf.data.highlightText).toBe('new text');
        expect(leaf.data.highlightNote).toBe('my note');
        expect(leaf.data.note).toContain('my note');
    });

    it('flags nodes whose card disappeared', () => {
        const tree = buildMindMapTree([note({ id: 'gone' })], [], { ...OPTIONS, mode: 'flat' });
        const { changed } = syncTreeWithCards(tree, new Map(), OPTIONS);
        expect(changed).toBe(true);
        expect(tree.children![0]!.data.lost).toBeGreaterThan(0);
    });

    it('clears the lost flag when the card comes back', () => {
        const tree = buildMindMapTree([note({ id: 'back' })], [], { ...OPTIONS, mode: 'flat' });
        tree.children![0]!.data.lost = 12345;
        const cards = new Map([['back', note({ id: 'back' })]]);
        const { changed } = syncTreeWithCards(tree, cards, OPTIONS);
        expect(changed).toBe(true);
        expect(tree.children![0]!.data.lost).toBeUndefined();
    });

    it('reports no changes when everything is already in sync', () => {
        const card = note({ id: 'same', color: 'yellow', text: 'same text' });
        const tree = buildMindMapTree([card], [], { ...OPTIONS, mode: 'flat' });
        const cards = new Map([['same', card]]);
        const { changed } = syncTreeWithCards(tree, cards, OPTIONS);
        expect(changed).toBe(false);
    });
});
