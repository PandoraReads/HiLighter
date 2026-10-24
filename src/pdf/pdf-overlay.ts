// ============================================================
// HiLighter - PDF textLayer highlight overlay v2
// ============================================================
// Re-applies DB highlights onto rendered pdf.js text layers.
// v2 behavior:
//  - Precise placement via note.pdfAnchor (span+offset), verified
//    against the live layout; falls back to text matching when the
//    anchor no longer verifies (renderer drift, cross-device sync).
//  - Text ranges are wrapped at the CHARACTER level (Range API), so
//    several highlights can share one span without swallowing each other.
//  - Every paint clears previous overlay marks first, so deletions and
//    color changes reflect immediately.
//  - A MutationObserver paints lazily-rendered pages as they appear.
// Toggle: settings.pdfOverlay. All failures degrade silently.

import type HiLighterPlugin from '../main';
import { db } from '../db';
import type { HighlightNote } from '../models';
import { isPdfView } from './pdf-anchors';
import { expandAnchor, flattenSpans, matchByText, type SpanRange } from './anchor-math';
import { PRESET_UI_HEX } from '../colors';

const OVERLAY_ATTR = 'data-hl-overlay';
const PAINT_DEBOUNCE_MS = 300;

/** Registers the overlay watchers for the whole session (call once in onload). */
export function registerPdfOverlay(plugin: HiLighterPlugin): void {
    let observer: MutationObserver | null = null;
    let observedEl: HTMLElement | null = null;

    const watchActivePdf = (): void => {
        try {
            const leaf = plugin.app.workspace.getMostRecentLeaf();
            const view = leaf?.view;
            if (!view || !isPdfView(view)) {
                observer?.disconnect();
                observedEl = null;
                return;
            }
            if (observedEl === view.containerEl) return;
            observer?.disconnect();
            observedEl = view.containerEl;
            observer = new MutationObserver((mutations) => {
                // Our own paint (inserting/removing <mark data-hl-overlay>) also
                // mutates the DOM — ignore those and anything inside the
                // post-paint suppression window, or we repaint in an endless loop.
                const ours = mutations.every(m => isOwnMutation(m));
                if (ours || Date.now() < suppressUntil) return;
                scheduleRefresh(plugin);
            });
            observer.observe(view.containerEl, { childList: true, subtree: true });
        } catch {
            // decorative layer — never surface errors
        }
    };

    plugin.registerEvent(
        plugin.app.workspace.on('active-leaf-change', () => { watchActivePdf(); void refreshOverlay(plugin); })
    );
    plugin.registerEvent(
        plugin.app.workspace.on('layout-change', () => { watchActivePdf(); void refreshOverlay(plugin); })
    );
    // Deletions/edits from the sidebar reflect on the PDF immediately.
    plugin.register(
        db.onChange(() => { void scheduleRefresh(plugin); })
    );
    plugin.register(() => { observer?.disconnect(); observer = null; observedEl = null; });
}

/** True when every added/removed node in the mutation is an overlay mark. */
function isOwnMutation(m: MutationRecord): boolean {
    const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
    if (nodes.length === 0) return true;
    return nodes.every(n => {
        if (n.nodeType !== Node.ELEMENT_NODE) return false;
        const el = n as HTMLElement;
        return el.hasAttribute(OVERLAY_ATTR)
            || (el.tagName === 'MARK' && el.hasAttribute('data-id'));
    });
}

/** Repaints mutate the DOM themselves; ignore mutations inside this window. */
let suppressUntil = 0;
/** Minimum spacing between actual repaint passes (ms). */
const MIN_REFRESH_INTERVAL_MS = 300;
let lastRefreshAt = 0;

let paintTimer: number | null = null;
let lateTimer: number | null = null;

function scheduleRefresh(plugin: HiLighterPlugin): void {
    if (paintTimer) window.clearTimeout(paintTimer);
    paintTimer = window.setTimeout(() => { void refreshOverlay(plugin); }, PAINT_DEBOUNCE_MS);
}

async function refreshOverlay(plugin: HiLighterPlugin): Promise<void> {
    if (!plugin.settings.pdfOverlay) return;
    if (Date.now() - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
        scheduleRefresh(plugin);
        return;
    }
    lastRefreshAt = Date.now();
    try {
        const leaf = plugin.app.workspace.getMostRecentLeaf();
        const view = leaf?.view;
        if (!view || !isPdfView(view)) return;
        const file = (view as unknown as { file?: { path?: string } }).file;
        if (!file?.path) return;

        const notes = (await db.getHighlightsByPath(file.path))
            .filter(n => n.anchorType !== 'note');   // word-notes do not carry highlight text
        suppressUntil = Date.now() + 200;
        paint(view.containerEl, notes);
        suppressUntil = Date.now() + 200;

        // One delayed pass for late page renders (observer catches the rest).
        if (lateTimer) window.clearTimeout(lateTimer);
        lateTimer = window.setTimeout(() => {
            try {
                const current = plugin.app.workspace.getMostRecentLeaf()?.view;
                if (current && isPdfView(current)) paint(current.containerEl, notes);
            } catch {
                // ignore
            }
        }, 600);
    } catch {
        // Overlay is decorative; never surface errors from it
    }
}

function paint(container: HTMLElement, notes: HighlightNote[]): void {
    container.querySelectorAll('.page').forEach(page => {
        try {
            paintPage(page as HTMLElement, notes);
        } catch {
            // skip this page
        }
    });
}

/** Removes previous overlay artifacts: rect divs + wrapped text marks. */
function clearPage(page: HTMLElement): void {
    page.querySelectorAll(`[${OVERLAY_ATTR}].hl-pdf-rect`).forEach(el => el.remove());
    page.querySelectorAll(`mark[${OVERLAY_ATTR}]`).forEach(mark => {
        try {
            mark.replaceWith(...Array.from(mark.childNodes));
        } catch {
            // leave the DOM as-is if unwrapping fails
        }
    });
}

/** Renderer-independent painting: absolutely-positioned color rects on the page. */
function paintRects(page: HTMLElement, notes: HighlightNote[]): void {
    const pageNo = Number(page.getAttribute('data-page-number') ?? 0);
    const doc = page.ownerDocument ?? document;
    for (const note of notes) {
        if (note.pdfPage !== pageNo || !note.pdfRects || note.pdfRects.length === 0) continue;
        const hex = note.colorHex || PRESET_UI_HEX[note.color] || '#ffd700';
        for (const r of note.pdfRects) {
            const div = doc.createElement('div');
            div.className = 'hl-pdf-rect';
            div.setAttribute('data-id', note.id);
            div.setAttribute(OVERLAY_ATTR, 'rect');
            div.style.left = `${(r.x * 100).toFixed(3)}%`;
            div.style.top = `${(r.y * 100).toFixed(3)}%`;
            div.style.width = `${(r.w * 100).toFixed(3)}%`;
            div.style.height = `${(r.h * 100).toFixed(3)}%`;
            div.style.backgroundColor = hex;
            page.appendChild(div);
        }
    }
}

/** Wraps [start,end) of a span's text into a mark, splitting text nodes. */
function wrapSpanRange(span: HTMLElement, start: number, end: number, mark: HTMLElement): boolean {
    try {
        const doc = span.ownerDocument;
        const walker = doc.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        let seen = 0;
        let node: Text | null = null;
        let localStart = 0;
        while (walker.nextNode()) {
            const text = walker.currentNode as Text;
            const len = text.textContent?.length ?? 0;
            if (seen + len >= start) {
                node = text;
                localStart = start - seen;
                break;
            }
            seen += len;
        }
        if (!node || end <= start) return false;

        const range = doc.createRange();
        range.setStart(node, localStart);
        range.setEnd(node, localStart + (end - start));
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
        return true;
    } catch {
        return false;
    }
}

function makeMark(doc: Document, note: HighlightNote): HTMLElement {
    const mark = doc.createElement('mark');
    mark.className = `hl-highlight hl-h-${note.color}`;
    mark.setAttribute('data-id', note.id);
    mark.setAttribute(OVERLAY_ATTR, 'pdf');
    if (note.colorHex) mark.setAttribute('data-hl-color', note.colorHex);
    return mark;
}

function paintPage(page: HTMLElement, notes: HighlightNote[]): void {
    if (notes.length === 0) return;
    // Clear previous pass first so deletions/recolors/edits always apply.
    clearPage(page);

    // Primary path: geometry rects — independent of the text layer lifecycle.
    paintRects(page, notes);

    // Legacy path for old notes without rects: span matching when the
    // text layer happens to have spans.
    const legacyNotes = notes.filter(n => !n.pdfRects || n.pdfRects.length === 0);
    if (legacyNotes.length === 0) return;
    const layer = page.querySelector<HTMLElement>(':scope > .textLayer');
    if (!layer) return;

    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span'));
    const pageNoNum = Number(page.getAttribute('data-page-number') ?? 0);
    if (spans.length === 0) {
        // Empty text layers are normal (lazy rendering / on-demand teardown).
        return;
    }
    const spanTexts = spans.map(s => s.textContent ?? '');
    const { offsets } = flattenSpans(spanTexts);

    // Ranges to wrap, applied back-to-front so earlier offsets stay valid.
    const pending: Array<{ span: HTMLElement; range: SpanRange; note: HighlightNote }> = [];
    const occupiedFlat: Array<{ start: number; end: number }> = [];

    for (const note of legacyNotes) {
        try {
            let ranges: SpanRange[] | null = null;
            const anchor = note.pdfAnchor;
            if (anchor && anchor.page === pageNoNum) {
                ranges = expandAnchor(spanTexts, anchor);
            }
            if (!ranges) {
                // Fallback: match by text, skipping spans already claimed this pass.
                const matched = matchByText(spanTexts, note.text || '', occupiedFlat);
                if (!matched) continue;
                ranges = expandAnchor(spanTexts, { ...matched, page: pageNoNum });
                if (!ranges) continue;
            }
            for (const r of ranges) {
                const span = spans[r.spanIndex];
                if (!span) continue;
                pending.push({ span, range: r, note });
                const abs = offsets[r.spanIndex]!;
                occupiedFlat.push({ start: abs.start + r.start, end: abs.start + r.end });
            }
        } catch {
            // per-note failures are isolated
        }
    }

    // Deep ranges first (larger spanIndex first, then descending start) so
    // wrapping never invalidates earlier offsets within the same span.
    pending.sort((a, b) =>
        b.range.spanIndex - a.range.spanIndex || b.range.start - a.range.start);

    for (const { span, range, note } of pending) {
        const mark = makeMark(span.ownerDocument ?? document, note);
        if (!wrapSpanRange(span, range.start, range.end, mark)) {
            // Fall back to the legacy whole-span wrap for odd structures.
            const legacy = makeMark(span.ownerDocument ?? document, note);
            span.replaceWith(legacy);
            legacy.appendChild(span);
        }
    }
}
