import { describe, it, expect } from 'vitest';
import {
    planMerge,
    dedupeById,
    pickNewerFsrs,
    fsrsDiffers,
    shouldPruneTombstone,
    isLiveTombstone,
    TOMBSTONE_TTL_MS,
} from '../src/sync/merge';
import type { HighlightNote } from '../src/models';

function note(overrides: Partial<HighlightNote> = {}): HighlightNote {
    return {
        id: 'id-1',
        text: 'text',
        color: 'yellow',
        note: '',
        sourcePath: 'a.md',
        lineIndex: 0,
        createdAt: 1,
        ...overrides,
    };
}

const NOW = 1_000_000;

describe('planMerge', () => {
    it('adds new rows and updates changed rows', () => {
        const existing: (HighlightNote | undefined)[] = [undefined, note({ id: 'b', text: 'old' })];
        const incoming = [note({ id: 'a' }), note({ id: 'b', text: 'new' })];
        const plan = planMerge(incoming, existing, new Map(), NOW);

        expect(plan.added).toBe(1);
        expect(plan.updated).toBe(1);
        expect(plan.skipped).toBe(0);
        expect(plan.toPut.map(n => n.id).sort()).toEqual(['a', 'b']);
    });

    it('skips unchanged rows', () => {
        const ex = note({ id: 'b', text: 'same', color: 'yellow', note: 'n' });
        const plan = planMerge([ex], [ex], new Map(), NOW);
        expect(plan.skipped).toBe(1);
        expect(plan.toPut).toEqual([]);
    });

    it('keeps the local note when the incoming note is empty', () => {
        const ex = note({ id: 'b', text: 'x', note: 'keep me' });
        const inc = note({ id: 'b', text: 'y', note: '' });
        const [merged] = planMerge([inc], [ex], new Map(), NOW).toPut;
        expect(merged!.note).toBe('keep me');
    });

    it('unions tags without mutating inputs', () => {
        const ex = note({ id: 'b', text: 'old', tags: ['a', 'b'] });
        const inc = note({ id: 'b', text: 'new', tags: ['b', 'c'] });
        const [merged] = planMerge([inc], [ex], new Map(), NOW).toPut;
        expect(merged!.tags!.sort()).toEqual(['a', 'b', 'c']);
        expect(ex.tags).toEqual(['a', 'b']);
    });

    it('syncs a tag-only classification change', () => {
        const ex = note({ id: 'a', tags: ['reading'] });
        const inc = note({ id: 'a', tags: ['reading', 'concept'] });
        const [merged] = planMerge([inc], [ex], new Map(), NOW).toPut;
        expect(merged?.tags).toEqual(['reading', 'concept']);
    });

    it('synchronizes card templates and relationships by the newer edit', () => {
        const ex = note({ id: 'a', templateId: 'concept', cardFields: { definition: 'old' }, links: [], updatedAt: 10 });
        const inc = note({ id: 'a', templateId: 'claim', cardFields: { claim: 'new' }, links: [{ targetId: 'b', relation: 'supports' }], updatedAt: 20 });
        const [merged] = planMerge([inc], [ex], new Map(), NOW).toPut;
        expect(merged?.templateId).toBe('claim');
        expect(merged?.cardFields).toEqual({ claim: 'new' });
        expect(merged?.links).toEqual([{ targetId: 'b', relation: 'supports' }]);

        const [reverse] = planMerge([ex], [inc], new Map(), NOW).toPut;
        expect(reverse?.templateId).toBe('claim');
        expect(reverse?.links).toEqual([{ targetId: 'b', relation: 'supports' }]);
    });

    it('suppresses rows whose id has a live tombstone', () => {
        const inc = note({ id: 'gone' });
        const plan = planMerge([inc], [undefined], new Map([['gone', NOW - 1000]]), NOW);
        expect(plan.suppressedByTombstone).toBe(1);
        expect(plan.added).toBe(0);
        expect(plan.toPut).toEqual([]);
    });

    it('does not suppress after the tombstone TTL', () => {
        const inc = note({ id: 'gone' });
        const deletedAt = NOW - TOMBSTONE_TTL_MS - 1;
        const plan = planMerge([inc], [undefined], new Map([['gone', deletedAt]]), NOW);
        expect(plan.suppressedByTombstone).toBe(0);
        expect(plan.added).toBe(1);
    });
});

describe('dedupeById', () => {
    it('keeps the last occurrence per id', () => {
        const out = dedupeById([note({ id: 'a', text: '1' }), note({ id: 'a', text: '2' }), note({ id: 'b' })]);
        expect(out.map(n => n.id)).toEqual(['a', 'b']);
        expect(out[0]!.text).toBe('2');
    });
});

describe('pickNewerFsrs', () => {
    const older = { due: 1, stability: 1, difficulty: 1, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 1, lapses: 0, state: 2, lastReview: 100 };
    const newer = { due: 1, stability: 1, difficulty: 1, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 2, lapses: 0, state: 2, lastReview: 200 };

    it('prefers the newer lastReview', () => {
        expect(pickNewerFsrs(older, newer)).toBe(newer);
    });

    it('falls back to reps when lastReview ties', () => {
        const a = { ...older, lastReview: 300, reps: 1 };
        const b = { ...older, lastReview: 300, reps: 5 };
        expect(pickNewerFsrs(a, b)).toBe(b);
    });

    it('returns the incoming when local is absent', () => {
        expect(pickNewerFsrs(undefined, newer)).toBe(newer);
    });
});

describe('fsrsDiffers', () => {
    it('detects null vs present and field differences', () => {
        const a = { due: 1, stability: 1, difficulty: 1, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 1, lapses: 0, state: 2 };
        expect(fsrsDiffers(undefined, a)).toBe(true);
        expect(fsrsDiffers(a, { ...a })).toBe(false);
        expect(fsrsDiffers(a, { ...a, reps: 2 })).toBe(true);
    });
});

describe('tombstone TTL', () => {
    it('prunes entries at or past the TTL', () => {
        expect(shouldPruneTombstone(NOW - TOMBSTONE_TTL_MS, NOW, TOMBSTONE_TTL_MS)).toBe(true);
        expect(isLiveTombstone(NOW - TOMBSTONE_TTL_MS + 1, NOW, TOMBSTONE_TTL_MS)).toBe(true);
        expect(isLiveTombstone(undefined, NOW, TOMBSTONE_TTL_MS)).toBe(false);
    });
});
