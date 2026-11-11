import { describe, expect, it } from 'vitest';
import {
    activeShelfId,
    addShelf,
    makeShelfPreset,
    newShelfId,
    normalizeShelves,
    removeShelf,
    reorderShelves,
} from '../src/bookshelf/shelves';
import type { ShelfPreset } from '../src/models';

const SCOPE_A = {
    include: [{ path: '30 资源/书籍', recursive: false }],
    exclude: ['30 资源/书籍/经济学人'],
};

describe('makeShelfPreset', () => {
    it('captures the current scope under a trimmed name with a fresh id', () => {
        const preset = makeShelfPreset('  英文书架  ', SCOPE_A.include, SCOPE_A.exclude);
        expect(preset?.name).toBe('英文书架');
        expect(preset?.include).toEqual(SCOPE_A.include);
        expect(preset?.exclude).toEqual(SCOPE_A.exclude);
        expect(preset?.id).toBeTruthy();
    });

    it('normalizes include/exclude through the scope rules', () => {
        const preset = makeShelfPreset('x', ['A/', '  A  ', { path: 'B', recursive: true }], [' C/', 'C']);
        expect(preset?.include).toEqual([
            { path: 'A', recursive: true },
            { path: 'B', recursive: true },
        ]);
        expect(preset?.exclude).toEqual(['C']);
    });

    it('refuses blank names', () => {
        expect(makeShelfPreset('   ', SCOPE_A.include, [])).toBeNull();
        expect(makeShelfPreset(undefined, SCOPE_A.include, [])).toBeNull();
    });

    it('generates unique ids', () => {
        expect(newShelfId()).not.toBe(newShelfId());
    });
});

describe('shelf list operations (immutable)', () => {
    const one: ShelfPreset = { id: 'a', name: 'A', include: [], exclude: [] };
    const two: ShelfPreset = { id: 'b', name: 'B', include: [], exclude: [] };

    it('addShelf appends without mutating the input', () => {
        const before = [one];
        const after = addShelf(before, two);
        expect(after).toEqual([one, two]);
        expect(before).toEqual([one]);
    });

    it('removeShelf filters by id', () => {
        expect(removeShelf([one, two], 'a')).toEqual([two]);
        expect(removeShelf([one, two], 'nope')).toEqual([one, two]);
    });

    it('normalizeShelves drops entries without id or name', () => {
        const junk = [
            one,
            { id: '', name: 'x', include: [], exclude: [] },
            { id: 'c', name: '  ', include: [], exclude: [] },
            two,
        ] as ShelfPreset[];
        expect(normalizeShelves(junk)).toEqual([one, two]);
        expect(normalizeShelves(undefined)).toEqual([]);
    });
});

describe('reorderShelves', () => {
    const NOW = 1_700_000_000_000;
    const shelves: ShelfPreset[] = [
        { id: 'a', name: 'A', include: [], exclude: [], order: 0, updatedAt: 10 },
        { id: 'b', name: 'B', include: [], exclude: [], order: 1, updatedAt: 20 },
        { id: 'c', name: 'C', include: [], exclude: [], order: 2, updatedAt: 30 },
    ];

    it('moves a shelf down and rewrites sequential order fields', () => {
        const next = reorderShelves(shelves, 'a', 2, NOW);
        expect(next.map(s => s.id)).toEqual(['b', 'c', 'a']);
        expect(next.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('moves a shelf up', () => {
        const next = reorderShelves(shelves, 'c', 0, NOW);
        expect(next.map(s => s.id)).toEqual(['c', 'a', 'b']);
        expect(next.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('bumps updatedAt only for shelves that changed position', () => {
        const next = reorderShelves(shelves, 'a', 1, NOW);
        // a and b swapped positions -> both bumped; c stayed -> untouched ref.
        expect(next[0]).toMatchObject({ id: 'b', updatedAt: NOW });
        expect(next[1]).toMatchObject({ id: 'a', updatedAt: NOW });
        expect(next[2]).toBe(shelves[2]);
    });

    it('never mutates the input list', () => {
        const snapshot = JSON.stringify(shelves);
        reorderShelves(shelves, 'a', 2, NOW);
        expect(JSON.stringify(shelves)).toBe(snapshot);
    });

    it('is a no-op for unknown ids, negatives clamped, big indexes drop at the end', () => {
        expect(reorderShelves(shelves, 'nope', 1, NOW)).toBe(shelves);
        expect(reorderShelves(shelves, 'a', -5, NOW)).toBe(shelves);
        expect(reorderShelves(shelves, 'a', 0, NOW)).toBe(shelves);
        expect(reorderShelves(shelves, 'c', 99, NOW).map(s => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('normalizes order for legacy shelves lacking the field', () => {
        const legacy: ShelfPreset[] = [
            { id: 'x', name: 'X', include: [], exclude: [] },
            { id: 'y', name: 'Y', include: [], exclude: [] },
        ];
        const next = reorderShelves(legacy, 'y', 0, NOW);
        expect(next.map(s => s.id)).toEqual(['y', 'x']);
        expect(next.map(s => s.order)).toEqual([0, 1]);
    });
});

describe('activeShelfId', () => {
    const english = makeShelfPreset('English', SCOPE_A.include, SCOPE_A.exclude)!;
    const chinese = makeShelfPreset('中文', [{ path: '中文书', recursive: true }], [])!;
    const shelves = [english, chinese];

    it('matches the shelf whose scope equals the current settings', () => {
        expect(activeShelfId(shelves, SCOPE_A.include, SCOPE_A.exclude)).toBe(english.id);
    });

    it('ignores include-list order (same scope, different order)', () => {
        const a = makeShelfPreset('A', [{ path: 'X', recursive: true }, { path: 'Y', recursive: false }], [])!;
        expect(activeShelfId([a], [{ path: 'Y', recursive: false }, { path: 'X', recursive: true }], [])).toBe(a.id);
    });

    it('distinguishes recursion flags and excludes', () => {
        expect(activeShelfId(shelves, [{ path: '30 资源/书籍', recursive: true }], [])).toBeNull();
        expect(activeShelfId(shelves, SCOPE_A.include, [])).toBeNull();
    });

    it('accepts legacy plain-string include entries', () => {
        const legacy = makeShelfPreset('legacy', ['30 资源/书籍'], [])!;
        expect(activeShelfId([legacy], [{ path: '30 资源/书籍', recursive: true }], [])).toBe(legacy.id);
    });

    it('returns null for no shelves or an unconfigured scope', () => {
        expect(activeShelfId([], SCOPE_A.include, SCOPE_A.exclude)).toBeNull();
        expect(activeShelfId(shelves, [], [])).toBeNull();
    });
});
