import { describe, expect, it } from 'vitest';
import { interactionOptions } from '../src/mindmap/interaction';
import { sourceKind } from '../src/studio/source-kind';
import type { HighlightNote } from '../src/models';

describe('mind map interactions', () => {
    it('uses the left button for selection or canvas movement depending on the mode', () => {
        expect(interactionOptions('select')).toEqual({ useLeftKeySelectionRightKeyDrag: true });
        expect(interactionOptions('pan')).toEqual({ useLeftKeySelectionRightKeyDrag: false });
    });
    it('routes source jumps to the correct document reader', () => {
        const base: HighlightNote = { id: 'a', text: '', note: '', color: 'yellow', sourcePath: 'paper.md', lineIndex: 0, createdAt: 0 };
        expect(sourceKind(base)).toBe('markdown');
        expect(sourceKind({ ...base, sourcePath: 'Paper.PDF' })).toBe('pdf');
        expect(sourceKind({ ...base, sourcePath: 'Book.EPUB' })).toBe('epub');
        expect(sourceKind({ ...base, anchorType: 'epub' })).toBe('epub');
    });
});
