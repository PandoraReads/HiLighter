// ============================================================
// HiLighter - EPUB annotations (CFI highlights on the rendition)
// ============================================================

import type { Rendition } from 'epubjs';
import type { HighlightNote } from '../models';

/** CFIs this plugin painted on a given rendition (full-repaint bookkeeping). */
const painted = new WeakMap<Rendition, Set<string>>();

/**
 * Idempotent FULL repaint of all DB highlights on a rendition.
 *
 * epub.js 0.3.93 never re-attaches an annotation after a section
 * re-render (its `annotations.inject` hook has no caller), so marks
 * must be re-added on every `rendered` event. Re-adding on a live
 * view would stack duplicate SVG rectangles, and annotations whose
 * notes were deleted would linger forever — so every pass first
 * removes everything the plugin previously painted, then adds the
 * current notes back. Deletions and color changes reflect immediately.
 */
export function syncAnnotations(
    rendition: Rendition,
    notes: HighlightNote[],
    hexFor: (note: HighlightNote) => string,
): void {
    let set = painted.get(rendition);
    if (!set) {
        set = new Set();
        painted.set(rendition, set);
    }
    set.forEach(cfi => {
        try {
            rendition.annotations.remove(cfi, 'highlight');
        } catch { /* already gone */ }
    });
    set.clear();

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
                // epub.js feeds this straight into classList.add(), which
                // rejects space-separated tokens — one hyphenated class only.
                `hl-epub-hl-${note.color}`,
                {
                    fill: hexFor(note),
                    'fill-opacity': '0.3',
                    'mix-blend-mode': 'multiply',
                },
            );
            set.add(note.cfi);
        } catch {
            // one bad CFI must not break the rest
        }
    });
}
