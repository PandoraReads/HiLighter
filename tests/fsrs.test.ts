import { describe, it, expect } from 'vitest';
import { setLang } from '../src/i18n';
import {
    scheduleNote,
    toCard,
    fromCard,
    isDue,
    isNew,
    dueCount,
    newCount,
    buildSession,
    requeueIfStillLearning,
    promoteDueLearning,
    nextDueAt,
    resetFsrs,
    STATE_LEARNING,
    STATE_REVIEW,
    RATING_AGAIN,
    RATING_GOOD,
    RATING_EASY,
} from '../src/fsrs';
import { DEFAULT_SETTINGS } from '../src/models';
import type { FsrsSettings, HighlightNote } from '../src/models';

const SETTINGS: FsrsSettings = { desiredRetention: 0.9, newPerDay: 20, enableFuzz: false };

function makeNote(overrides: Partial<HighlightNote> = {}): HighlightNote {
    return {
        id: overrides.id ?? 'id-' + Math.random().toString(36).slice(2, 8),
        text: overrides.text ?? 'sample text',
        color: overrides.color ?? 'yellow',
        note: overrides.note ?? '',
        sourcePath: overrides.sourcePath ?? 'notes/a.md',
        lineIndex: overrides.lineIndex ?? 0,
        createdAt: overrides.createdAt ?? Date.now(),
        tags: overrides.tags,
        pinned: overrides.pinned,
        fsrs: overrides.fsrs,
    };
}

const T0 = new Date('2026-10-15T08:00:00Z');

describe('scheduleNote', () => {
    it('turns a new card into Learning with a near-term due after Good', () => {
        const note = makeNote();
        const next = scheduleNote(note, RATING_GOOD, SETTINGS, T0);
        expect(next.state).toBe(STATE_LEARNING);
        expect(next.reps).toBe(1);
        expect(next.lapses).toBe(0);
        expect(next.lastReview).toBe(T0.getTime());
        expect(next.due).toBeGreaterThan(T0.getTime());
    });

    it('moves a Learning card into Review after a second Good', () => {
        let note = makeNote();
        note = { ...note, fsrs: scheduleNote(note, RATING_GOOD, SETTINGS, T0) };
        const t1 = new Date('2026-10-15T08:10:00Z');   // when the learning step came due
        const next = scheduleNote(note, RATING_GOOD, SETTINGS, t1);
        expect(next.state).toBe(STATE_REVIEW);
        expect(next.scheduledDays).toBeGreaterThan(0);
        expect(next.reps).toBe(2);
    });

    it('records lapses on Again for a Review card', () => {
        let note = makeNote();
        note = { ...note, fsrs: scheduleNote(note, RATING_GOOD, SETTINGS, T0) };
        note = { ...note, fsrs: scheduleNote(note, RATING_GOOD, SETTINGS, new Date('2026-10-15T08:10:00Z')) };
        expect(note.fsrs!.state).toBe(STATE_REVIEW);
        const afterAgain = scheduleNote(note, RATING_AGAIN, SETTINGS, new Date('2026-10-17T09:00:00Z'));
        expect(afterAgain.lapses).toBe(1);
    });

    it('Easy schedules further out than Good for a new card', () => {
        const good = scheduleNote(makeNote(), RATING_GOOD, SETTINGS, T0);
        const easy = scheduleNote(makeNote(), RATING_EASY, SETTINGS, T0);
        expect(easy.due).toBeGreaterThanOrEqual(good.due);
    });
});

describe('serialization round-trip', () => {
    it('toCard/fromCard preserves every field', () => {
        const note = makeNote();
        const state = scheduleNote(note, RATING_GOOD, SETTINGS, T0);
        const round = fromCard(toCard(state));
        expect(round).toEqual(state);
    });
});

describe('due / new counting', () => {
    it('new cards are new, not due; due counts only scheduled+arrived cards', () => {
        const fresh = makeNote({ id: '1' });
        const scheduledFuture = makeNote({
            id: '2',
            fsrs: { due: T0.getTime() + 86400000, stability: 5, difficulty: 5, elapsedDays: 1, scheduledDays: 3, learningSteps: 2, reps: 4, lapses: 0, state: STATE_REVIEW, lastReview: T0.getTime() - 86400000 },
        });
        const scheduledPast = makeNote({
            id: '3',
            fsrs: { due: T0.getTime() - 3600000, stability: 5, difficulty: 5, elapsedDays: 1, scheduledDays: 1, learningSteps: 2, reps: 4, lapses: 0, state: STATE_REVIEW, lastReview: T0.getTime() - 90000000 },
        });
        expect(isNew(fresh)).toBe(true);
        expect(isDue(fresh, T0)).toBe(false);
        expect(isDue(scheduledFuture, T0)).toBe(false);
        expect(isDue(scheduledPast, T0)).toBe(true);
        expect(dueCount([fresh, scheduledFuture, scheduledPast], T0)).toBe(1);
        expect(newCount([fresh, scheduledFuture, scheduledPast])).toBe(1);
    });
});

describe('buildSession', () => {
    it('due mode: due-first (oldest due first), then new cards capped at newPerDay', () => {
        setLang('zh'); // archive tag = 归档
        const dueB = makeNote({ id: 'due-b', createdAt: 1, fsrs: { due: 200, stability: 5, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 2, reps: 3, lapses: 0, state: STATE_REVIEW, lastReview: 100 } });
        const dueA = makeNote({ id: 'due-a', createdAt: 1, fsrs: { due: 100, stability: 5, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 2, reps: 3, lapses: 0, state: STATE_REVIEW, lastReview: 50 } });
        const new1 = makeNote({ id: 'new-1', createdAt: 10 });
        const new2 = makeNote({ id: 'new-2', createdAt: 20 });
        const new3 = makeNote({ id: 'new-3', createdAt: 30 });
        const archived = makeNote({ id: 'arch', createdAt: 5, tags: ['归档'] });

        const { queue } = buildSession([dueB, new3, archived, dueA, new2, new1], {
            mode: 'due', archiveTag: '归档', newPerDay: 2,
        }, T0);
        expect(queue.map(n => n.id)).toEqual(['due-a', 'due-b', 'new-1', 'new-2']);
    });

    it('new mode: only new cards, oldest first, capped', () => {
        setLang('zh');
        const notes = [
            makeNote({ id: 'n3', createdAt: 30 }),
            makeNote({ id: 'n1', createdAt: 10 }),
            makeNote({ id: 'n2', createdAt: 20 }),
        ];
        const { queue } = buildSession(notes, { mode: 'new', archiveTag: '归档', newPerDay: 2 }, T0);
        expect(queue.map(n => n.id)).toEqual(['n1', 'n2']);
    });

    it('respects an explicit pool (toolbar filters)', () => {
        setLang('zh');
        const a = makeNote({ id: 'a', createdAt: 1 });
        const b = makeNote({ id: 'b', createdAt: 2 });
        const { queue } = buildSession([a, b], { mode: 'new', archiveTag: '归档', newPerDay: 20, pool: [b] }, T0);
        expect(queue.map(n => n.id)).toEqual(['b']);
    });
});

describe('requeueIfStillLearning', () => {
    it('requeues learning cards only after their due time, and drops review cards', () => {
        const learning = makeNote({ id: 'L', fsrs: { due: 1, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 0, learningSteps: 1, reps: 1, lapses: 0, state: STATE_LEARNING, lastReview: 1 } });
        const review = makeNote({ id: 'R', fsrs: { due: 2, stability: 9, difficulty: 5, elapsedDays: 0, scheduledDays: 3, learningSteps: 2, reps: 5, lapses: 0, state: STATE_REVIEW, lastReview: 1 } });
        const queue = [review];
        expect(requeueIfStillLearning(queue, learning, new Date(2)).map(n => n.id)).toEqual(['R', 'L']);
        expect(requeueIfStillLearning(queue, learning, new Date(0)).map(n => n.id)).toEqual(['R']);
        expect(requeueIfStillLearning(queue, review, new Date(2)).map(n => n.id)).toEqual(['R']);
    });

    it('promotes only waiting cards whose scheduled time has arrived', () => {
        const state = { due: 100, stability: 1, difficulty: 5, elapsedDays: 0,
            scheduledDays: 0, learningSteps: 1, reps: 1, lapses: 0,
            state: STATE_LEARNING, lastReview: 0 };
        const ready = makeNote({ id: 'ready', fsrs: state });
        const later = makeNote({ id: 'later', fsrs: { ...state, due: 200 } });
        const result = promoteDueLearning([], [later, ready], new Date(150));
        expect(result.queue.map(card => card.id)).toEqual(['ready']);
        expect(result.waiting.map(card => card.id)).toEqual(['later']);
    });
});

describe('nextDueAt / resetFsrs', () => {
    it('nextDueAt returns the earliest future due time', () => {
        const base = T0.getTime();
        const a = makeNote({ id: 'a', fsrs: { due: base + 500, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 2, reps: 2, lapses: 0, state: STATE_REVIEW, lastReview: base } });
        const b = makeNote({ id: 'b', fsrs: { due: base + 300, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 2, reps: 2, lapses: 0, state: STATE_REVIEW, lastReview: base } });
        expect(nextDueAt([a, b], T0)).toBe(base + 300);
        expect(nextDueAt([makeNote()], T0)).toBeNull();
    });

    it('resetFsrs strips the scheduling state immutably', () => {
        const note = makeNote({ fsrs: { due: 1, stability: 1, difficulty: 1, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 1, lapses: 0, state: 2, lastReview: 1 } });
        const cleared = resetFsrs(note);
        expect(cleared.fsrs).toBeUndefined();
        expect(note.fsrs).toBeDefined();   // original untouched
    });
});

describe('defaults', () => {
    it('DEFAULT_SETTINGS ships an fsrs block', () => {
        expect(DEFAULT_SETTINGS.fsrs).toEqual({ desiredRetention: 0.9, newPerDay: 20, enableFuzz: false });
    });
});
