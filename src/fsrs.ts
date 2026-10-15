// ============================================================
// HiLighter - FSRS scheduling adapter (pure)
// ============================================================
// No Obsidian imports: testable under vitest. Owns every touch of
// ts-fsrs so a future library swap changes exactly one file.
// Dates are converted to epoch-ms here so HighlightNote.fsrs stays
// JSON-plain for Dexie and the sync file.

import { fsrs, createEmptyCard, generatorParameters, type Card, type FSRS } from 'ts-fsrs';
import type { FsrsSettings, FsrsState, HighlightNote } from './models';

/** Rating grades (ts-fsrs Rating). Manual(0) is excluded. */
export type Grade = 1 | 2 | 3 | 4;   // 1 Again, 2 Hard, 3 Good, 4 Easy

export const RATING_AGAIN: Grade = 1;
export const RATING_HARD: Grade = 2;
export const RATING_GOOD: Grade = 3;
export const RATING_EASY: Grade = 4;

/** ts-fsrs State values (0 New, 1 Learning, 2 Review, 3 Relearning). */
export const STATE_NEW = 0;
export const STATE_LEARNING = 1;
export const STATE_REVIEW = 2;
export const STATE_RELEARNING = 3;

function schedulerFor(settings: FsrsSettings): FSRS {
    return fsrs(generatorParameters({
        request_retention: settings.desiredRetention,
        enable_fuzz: settings.enableFuzz,
    }));
}

/** FsrsState (epoch ms) → ts-fsrs Card (Dates). */
export function toCard(state: FsrsState): Card {
    return {
        due: new Date(state.due),
        stability: state.stability,
        difficulty: state.difficulty,
        elapsed_days: state.elapsedDays,
        scheduled_days: state.scheduledDays,
        learning_steps: state.learningSteps,
        reps: state.reps,
        lapses: state.lapses,
        state: state.state,
        last_review: state.lastReview != null ? new Date(state.lastReview) : undefined,
    };
}

/** ts-fsrs Card (Dates) → FsrsState (epoch ms). */
export function fromCard(card: Card): FsrsState {
    return {
        due: card.due.getTime(),
        stability: card.stability,
        difficulty: card.difficulty,
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- v5 field; must round-trip until ts-fsrs 6
        elapsedDays: card.elapsed_days,
        scheduledDays: card.scheduled_days,
        learningSteps: card.learning_steps,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
        lastReview: card.last_review?.getTime(),
    };
}

/** The next scheduling state after rating this note now. */
export function scheduleNote(note: HighlightNote, grade: Grade, settings: FsrsSettings, now: Date = new Date()): FsrsState {
    const scheduler = schedulerFor(settings);
    const card = note.fsrs
        ? toCard(note.fsrs)
        : createEmptyCard(now);
    const recordLog = scheduler.repeat(card, now);
    return fromCard(recordLog[grade].card);
}

/** A scheduled card whose due time has arrived (new cards are not "due"). */
export function isDue(note: HighlightNote, now: Date = new Date()): boolean {
    return note.fsrs != null && note.fsrs.due <= now.getTime();
}

/** Has never been reviewed (no fsrs state). */
export function isNew(note: HighlightNote): boolean {
    return note.fsrs == null;
}

export function dueCount(notes: HighlightNote[], now: Date = new Date()): number {
    const nowMs = now.getTime();
    return notes.reduce((n, h) => (h.fsrs != null && h.fsrs.due <= nowMs ? n + 1 : n), 0);
}

export function newCount(notes: HighlightNote[]): number {
    return notes.reduce((n, h) => (h.fsrs == null ? n + 1 : n), 0);
}

export interface SessionStats {
    reviewed: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
}

export interface ReviewSessionPlan {
    queue: HighlightNote[];
    stats: SessionStats;
}

export interface SessionOptions {
    mode: 'due' | 'new';
    archiveTag: string;
    newPerDay: number;
    /** Extra pool filter (search/facets from the studio toolbar). */
    pool?: HighlightNote[];
}

/** Builds the opening queue: due cards first (oldest due first), then
 *  new cards (oldest created first) capped at newPerDay. */
export function buildSession(notes: HighlightNote[], opts: SessionOptions, now: Date = new Date()): ReviewSessionPlan {
    const pool = (opts.pool ?? notes).filter(h => (h.tags || []).indexOf(opts.archiveTag) === -1);
    const nowMs = now.getTime();

    const due = pool
        .filter(h => h.fsrs != null && h.fsrs.due <= nowMs)
        .sort((a, b) => a.fsrs!.due - b.fsrs!.due);

    if (opts.mode === 'new') {
        const fresh = pool
            .filter(h => h.fsrs == null)
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, Math.max(0, opts.newPerDay));
        return { queue: fresh, stats: emptyStats() };
    }

    const fresh = pool
        .filter(h => h.fsrs == null)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, Math.max(0, opts.newPerDay));

    return { queue: [...due, ...fresh], stats: emptyStats() };
}

/** Requeues a Learning card that becomes due again within the session. */
export function requeueIfStillLearning(queue: HighlightNote[], note: HighlightNote): HighlightNote[] {
    if (note.fsrs == null) return queue;
    const learning = note.fsrs.state === STATE_LEARNING || note.fsrs.state === STATE_RELEARNING;
    if (!learning) return queue;
    return [...queue, note];   // appended at the end; due time arrives while session continues
}

export function emptyStats(): SessionStats {
    return { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
}

/** Next due timestamp across all scheduled cards (for the summary screen). */
export function nextDueAt(notes: HighlightNote[], now: Date = new Date()): number | null {
    const nowMs = now.getTime();
    const times = notes
        .filter(h => h.fsrs != null && h.fsrs.due > nowMs)
        .map(h => h.fsrs!.due);
    if (times.length === 0) return null;
    return Math.min(...times);
}

/** Clears scheduling progress (card becomes new again). */
export function resetFsrs(note: HighlightNote): HighlightNote {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-strip is intentional
    const { fsrs: _dropped, ...rest } = note;
    return { ...rest };
}
