import { describe, expect, it } from 'vitest';
import { hasNoteModifier } from '../src/selection/gesture';

describe('click-to-note modifier', () => {
    it('accepts Ctrl or Command', () => {
        expect(hasNoteModifier({ ctrlKey: true, metaKey: false })).toBe(true);
        expect(hasNoteModifier({ ctrlKey: false, metaKey: true })).toBe(true);
    });

    it('rejects unmodified clicks', () => {
        expect(hasNoteModifier({ ctrlKey: false, metaKey: false })).toBe(false);
    });
});
