import { describe, expect, it } from 'vitest';
import {
    mergeShelfCollections,
    tagTombstoneId,
    withFavoriteDeletion,
    withoutFavoriteDeletion,
    withShelfDeletion,
    withTagDeletion,
    type ShelfCollections,
} from '../src/sync/shelf-collections';
import type { ShelfPreset } from '../src/models';

const NOW = 1_700_000_000_000;

function emptyCollections(): ShelfCollections {
    return {
        shelves: [],
        favorites: [],
        tags: {},
        shelfTombstones: [],
        favoriteTombstones: [],
        tagTombstones: [],
    };
}

function shelf(id: string, name: string, updatedAt = 0): ShelfPreset {
    return { id, name, include: [{ path: `books/${id}`, recursive: false }], exclude: [], updatedAt };
}

describe('mergeShelfCollections — shelves', () => {
    it('unions shelves from both sides by id', () => {
        const local = { ...emptyCollections(), shelves: [shelf('a', 'A')] };
        const remote = { shelves: [shelf('b', 'B')] };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.shelves.map(s => s.id).sort()).toEqual(['a', 'b']);
    });

    it('keeps the newer updatedAt when the same id exists on both sides', () => {
        const local = { ...emptyCollections(), shelves: [shelf('a', 'old', 10)] };
        const remote = { shelves: [shelf('a', 'new', 20)] };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.shelves.find(s => s.id === 'a')?.name).toBe('new');
    });

    it('a live shelf tombstone suppresses the shelf on both sides', () => {
        const local = { ...emptyCollections(), shelves: [shelf('a', 'A')], shelfTombstones: [{ id: 'a', deletedAt: NOW - 1000 }] };
        const remote = { shelves: [shelf('a', 'A')] };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.shelves).toEqual([]);
    });

    it('an expired tombstone no longer suppresses', () => {
        const old = NOW - 40 * 24 * 60 * 60 * 1000;
        const local = { ...emptyCollections(), shelves: [], shelfTombstones: [{ id: 'a', deletedAt: old }] };
        const remote = { shelves: [shelf('a', 'A')] };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.shelves.map(s => s.id)).toEqual(['a']);
    });
});

describe('mergeShelfCollections — favorites', () => {
    it('unions favorites and drops tombstoned paths', () => {
        const local = { ...emptyCollections(), favorites: ['a.epub', 'b.epub'], favoriteTombstones: [{ id: 'b.epub', deletedAt: NOW - 10 }] };
        const remote = { favorites: ['b.epub', 'c.epub'] };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.favorites.sort()).toEqual(['a.epub', 'c.epub']);
    });
});

describe('mergeShelfCollections — tags', () => {
    it('unions tags per path', () => {
        const local = { ...emptyCollections(), tags: { 'a.epub': ['x'] } };
        const remote = { tags: { 'a.epub': ['y'], 'b.epub': ['z'] } };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.tags['a.epub']?.sort()).toEqual(['x', 'y']);
        expect(result.tags['b.epub']).toEqual(['z']);
    });

    it('a tag tombstone removes just that path+tag', () => {
        const local = {
            ...emptyCollections(),
            tags: { 'a.epub': ['x', 'y'] },
            tagTombstones: [{ id: tagTombstoneId('a.epub', 'x'), deletedAt: NOW - 10 }],
        };
        const remote = { tags: { 'a.epub': ['x'] } };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.tags['a.epub']).toEqual(['y']);
    });

    it('drops a path entirely when its last tag is tombstoned', () => {
        const local = {
            ...emptyCollections(),
            tags: {},
            tagTombstones: [{ id: tagTombstoneId('a.epub', 'x'), deletedAt: NOW - 10 }],
        };
        const remote = { tags: { 'a.epub': ['x'] } };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.tags['a.epub']).toBeUndefined();
    });
});

describe('mergeShelfCollections — tombstones & changed flag', () => {
    it('unions tombstones from both sides keeping the newest deletedAt', () => {
        const local = { ...emptyCollections(), shelfTombstones: [{ id: 'a', deletedAt: NOW - 5 }] };
        const remote = { shelfTombstones: [{ id: 'a', deletedAt: NOW - 9 }, { id: 'b', deletedAt: NOW - 3 }] };
        const { result } = mergeShelfCollections(local, remote, NOW);
        expect(result.shelfTombstones).toEqual(expect.arrayContaining([
            { id: 'a', deletedAt: NOW - 5 },
            { id: 'b', deletedAt: NOW - 3 },
        ]));
    });

    it('prunes tombstones older than the TTL', () => {
        const ancient = NOW - 40 * 24 * 60 * 60 * 1000;
        const local = { ...emptyCollections(), favoriteTombstones: [{ id: 'a', deletedAt: ancient }] };
        const { result } = mergeShelfCollections(local, {}, NOW);
        expect(result.favoriteTombstones).toEqual([]);
    });

    it('reports changed only when a collection differs from local', () => {
        const base = { ...emptyCollections(), shelves: [shelf('a', 'A')], favorites: ['x'], tags: { 'b': ['t'] } };
        expect(mergeShelfCollections(base, {}, NOW).changed).toBe(false);
        expect(mergeShelfCollections(base, { shelves: [shelf('c', 'C')] }, NOW).changed).toBe(true);
        expect(mergeShelfCollections(base, { favorites: ['y'] }, NOW).changed).toBe(true);
    });

    it('is a no-op when remote carries no collections', () => {
        const base = { ...emptyCollections(), shelves: [shelf('a', 'A')] };
        const { result, changed } = mergeShelfCollections(base, {}, NOW);
        expect(changed).toBe(false);
        expect(result.shelves).toEqual(base.shelves);
    });
});

describe('tombstone recording helpers', () => {
    it('withShelfDeletion adds a tombstone, withoutFavoriteDeletion clears one', () => {
        const t = withShelfDeletion([], 'a', NOW);
        expect(t).toEqual([{ id: 'a', deletedAt: NOW }]);
        expect(withFavoriteDeletion([], 'p', NOW)).toEqual([{ id: 'p', deletedAt: NOW }]);
        expect(withoutFavoriteDeletion([{ id: 'p', deletedAt: NOW }], 'p')).toEqual([]);
    });

    it('withTagDeletion keys by path + tag', () => {
        expect(withTagDeletion([], 'a.epub', 'x', NOW)).toEqual([{ id: tagTombstoneId('a.epub', 'x'), deletedAt: NOW }]);
    });

    it('re-adding replaces an existing tombstone timestamp', () => {
        const t = withShelfDeletion([{ id: 'a', deletedAt: 1 }], 'a', NOW);
        expect(t).toEqual([{ id: 'a', deletedAt: NOW }]);
    });
});
