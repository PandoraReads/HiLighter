import { describe, expect, it } from 'vitest';
import { extractNotePreview, noteReviewStatus } from '../src/studio/card-presentation';
import type { HighlightNote } from '../src/models';

const now = new Date('2026-10-23T10:00:00Z');
const note = (overrides: Partial<HighlightNote> = {}): HighlightNote => ({
    id: 'one', text: 'A phrase', color: 'yellow', note: '', sourcePath: 'reading.md',
    lineIndex: 0, createdAt: now.getTime(), ...overrides,
});

describe('card presentation', () => {
    it('extracts readable note text and embedded image targets', () => {
        expect(extractNotePreview('**Remember** ![[assets/a.png]] and ![diagram](images/b.png)'))
            .toEqual({ text: 'Remember and', images: ['assets/a.png', 'images/b.png'] });
    });

    it('distinguishes new, due, learning and scheduled cards', () => {
        expect(noteReviewStatus(note(), now)).toBe('new');
        const fsrs = { due: now.getTime() - 1, stability: 1, difficulty: 5,
            elapsedDays: 0, scheduledDays: 0, learningSteps: 1, reps: 1,
            lapses: 0, state: 1, lastReview: now.getTime() - 1000 };
        expect(noteReviewStatus(note({ fsrs }), now)).toBe('due');
        expect(noteReviewStatus(note({ fsrs: { ...fsrs, due: now.getTime() + 60000 } }), now)).toBe('learning');
        expect(noteReviewStatus(note({ fsrs: { ...fsrs, due: now.getTime() + 86400000, state: 2 } }), now)).toBe('scheduled');
    });
});
