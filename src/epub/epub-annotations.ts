// ============================================================
// HiLighter - EPUB annotations (CFI highlights on the rendition)
// ============================================================

import type { Rendition } from 'epubjs';
import type { HighlightNote } from '../models';

/**
 * Adds a highlight annotation per note. epub.js keeps annotations
 * across section re-renders itself; calling this after `rendered`
 * is a cheap idempotent replay (annotations.add dedupes by CFI+class).
 */
export function applyAnnotations(
    rendition: Rendition,
    notes: HighlightNote[],
    hexFor: (note: HighlightNote) => string,
): void {
    notes.forEach(note => {
        if (!note.cfi) return;
        try {
            rendition.annotations.add(
                'highlight',
                note.cfi,
                { id: note.id, color: note.color },
                // Clicking an annotation opens nothing here; the sidebar
                // detail modal stays the management surface.
                undefined,
                `hl-epub-hl hl-h-${note.color}`,
                {
                    fill: hexFor(note),
                    'fill-opacity': '0.3',
                    'mix-blend-mode': 'multiply',
                },
            );
        } catch {
            // one bad CFI must not break the rest
        }
    });
}
