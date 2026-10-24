// ============================================================
// HiLighter - PDF note anchors (best-effort, internal-API safe)
// ============================================================
// Obsidian's PDF view (pdf.js) is not public API. Everything here
// feature-detects and degrades gracefully: jump falls back to just
// opening the file, overlay skips on any mismatch.

import { App, Notice, TFile, View } from 'obsidian';
import type { HighlightNote, PdfTextAnchor } from '../models';
import { buildQuote, flattenSpans } from './anchor-math';
import { t } from '../i18n';

export function isPdfView(view: View | undefined | null): boolean {
    return !!view && view.getViewType() === 'pdf';
}

/** Page number from the DOM (closest rendered .page) or the internal viewer. */
export function getPdfPageNumber(target: Node | null, view?: View): number | null {
    try {
        const el = target instanceof Element ? target : target?.parentElement ?? null;
        const page = el?.closest?.('.page[data-page-number]');
        const attr = page?.getAttribute('data-page-number');
        if (attr && Number.isFinite(Number(attr))) return Number(attr);
        const viewer = (view as unknown as { viewer?: { pdfViewer?: { currentPageNumber?: number } } })?.viewer;
        if (viewer?.pdfViewer?.currentPageNumber != null) return viewer.pdfViewer.currentPageNumber;
    } catch {
        // DOM shapes vary between Obsidian versions; fall through
    }
    return null;
}

/** Context snapshot for a selection inside a PDF text layer. */
export function capturePdfContext(target: Node | null, view: View, selection: string): { pdfPage: number | null; contextQuote: string } {
    const pdfPage = getPdfPageNumber(target, view);
    let contextQuote = '';
    try {
        const el = target instanceof Element ? target : target?.parentElement ?? null;
        const page = el?.closest?.('.page');
        const text = page?.textContent ?? '';
        const idx = text.indexOf(selection);
        if (idx !== -1) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(text.length, idx + selection.length + 100);
            contextQuote = text.slice(start, end).replace(/\s+/g, ' ').trim();
        } else {
            contextQuote = selection.slice(0, 300);
        }
    } catch {
        contextQuote = selection.slice(0, 300);
    }
    return { pdfPage, contextQuote };
}

/**
 * Jump to a PDF note: opens the file, then tries (in order) the internal
 * page API, the rendered page element, or a Notice fallback.
 */
export async function jumpToPdfNote(app: App, note: HighlightNote): Promise<void> {
    await app.workspace.openLinkText(note.sourcePath, '', false);

    const page = note.pdfAnchor?.page ?? note.pdfPage ?? (note.lineIndex > 0 ? note.lineIndex : null);

    // 1. Internal viewer API (fast path)
    try {
        // PdfView is not exported; reach the active leaf's view generically
        const leaf = app.workspace.getMostRecentLeaf();
        const v = leaf?.view as unknown as {
            viewer?: { pdfViewer?: { gotoPageNumber?: (p: number) => void; setCurrentPageNumber?: (p: number) => void } };
        } | undefined;
        const nav = v?.viewer?.pdfViewer;
        if (nav && page != null) {
            if (typeof nav.gotoPageNumber === 'function') {
                nav.gotoPageNumber(page);
            } else if (typeof nav.setCurrentPageNumber === 'function') {
                nav.setCurrentPageNumber(page);
            }
        }
    } catch {
        // fall through to DOM-level navigation
    }

    // 2. Precise jump: wait for the page's overlay mark, scroll to it, flash.
    if (page != null) {
        const flashed = await tryFlashMark(app, note.id, page);
        if (flashed) return;
        // 2b. No mark (overlay off / not yet painted) — scroll the page into view.
        for (const delay of [50, 250, 700]) {
            const ok = await tryScrollToPage(app, page, delay);
            if (ok) return;
        }
    }

    // 3. Graceful fallback
    if (page != null) new Notice(t('pdf.jumpFallback', { page }));
}

/**
 * Waits (up to ~2.5s) for the page's textLayer overlay to paint the note's
 * mark, then scrolls it into view and plays the locate flash animation.
 */
async function tryFlashMark(app: App, noteId: string, page: number): Promise<boolean> {
    const deadlines = [120, 300, 600, 800, 700];
    let elapsed = 0;
    for (const wait of deadlines) {
        elapsed += wait;
        await new Promise((r) => window.setTimeout(r, wait));
        try {
            const leaf = app.workspace.getMostRecentLeaf();
            if (!leaf) return false;
            const pageEl = leaf.view.containerEl.querySelector(`.page[data-page-number="${page}"]`);
            const mark = pageEl ? findMarkOnPage(pageEl, noteId) : null;
            if (mark) {
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                mark.addClass('hl-pdf-flash');
                window.setTimeout(() => mark.removeClass('hl-pdf-flash'), 1400);
                return true;
            }
        } catch {
            // keep polling until the deadline
        }
    }
    void elapsed;
    return false;
}

async function tryScrollToPage(app: App, page: number, delayMs: number): Promise<boolean> {
    await new Promise((r) => window.setTimeout(r, delayMs));
    try {
        const leaf = app.workspace.getMostRecentLeaf();
        if (!leaf) return false;
        const el = leaf.view.containerEl.querySelector(`.page[data-page-number="${page}"]`);
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
    } catch {
        return false;
    }
}

// ── Precise capture ─────────────────────────────────────────

/** Char offset of a boundary point inside its host span element. */
function offsetInSpan(container: Node, offset: number, span: Element): number {
    if (container.nodeType === Node.TEXT_NODE) {
        if (container.parentElement === span) return offset;
        // Nested text node: sum preceding siblings inside the span.
        let total = 0;
        const walker = span.ownerDocument.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (walker.currentNode === container) return total + offset;
            total += (walker.currentNode.textContent ?? '').length;
        }
        return total;
    }
    // Element container: sum text of child nodes before the boundary index.
    let total = 0;
    const el = container as Element;
    for (let i = 0; i < Math.min(offset, el.childNodes.length); i++) {
        total += (el.childNodes[i]?.textContent ?? '').length;
    }
    return total;
}

/**
 * Captures a precise in-page anchor from the live selection inside a PDF
 * view. Returns null when the selection is not inside a rendered textLayer
 * (capture then falls back to the page+quote anchor).
 */
export function capturePdfAnchorFromSelection(
    sel: Selection | null,
    view: View,
): { page: number; anchor: PdfTextAnchor; contextQuote: string } | null {
    try {
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        const startEl = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement
            : (range.startContainer as Element);
        const page = startEl?.closest?.('.page[data-page-number]');
        const pageAttr = page?.getAttribute('data-page-number');
        if (!page || !pageAttr) return null;
        const pageNo = Number(pageAttr);
        if (!Number.isFinite(pageNo)) return null;

        const spans = Array.from(page.querySelectorAll<HTMLElement>('.textLayer span'));
        if (spans.length === 0) return null;

        const locate = (container: Node, offset: number): { index: number; charOffset: number } | null => {
            const el = container.nodeType === Node.TEXT_NODE
                ? container.parentElement
                : (container as Element);
            const span = el?.closest?.('.textLayer span');
            if (!span || !page.contains(span)) return null;
            const index = spans.indexOf(span as HTMLElement);
            if (index === -1) return null;
            return { index, charOffset: offsetInSpan(container, offset, span) };
        };

        const start = locate(range.startContainer, range.startOffset);
        const end = locate(range.endContainer, range.endOffset);
        if (!start || !end) return null;

        // Cross-page selections converge to the start page's tail.
        const normalizedEnd = end.index < start.index
            ? { index: start.index, charOffset: (spans[start.index]!.textContent ?? '').length }
            : end;

        const spanTexts = spans.map(s => s.textContent ?? '');
        const tentative = {
            page: pageNo,
            startSpan: start.index,
            startOffset: start.charOffset,
            endSpan: normalizedEnd.index,
            endOffset: normalizedEnd.charOffset,
        };
        if (tentative.startSpan === tentative.endSpan
            && tentative.startOffset >= tentative.endOffset) return null;

        const anchor: PdfTextAnchor = { ...tentative, quote: buildQuote(spanTexts, tentative) };
        if (!anchor.quote) return null;

        // Context quote: surrounding flattened page text (debug/fallback aid).
        const { flat } = flattenSpans(spanTexts);
        const absStart = flattenSpans(spanTexts).offsets[start.index]!.start + start.charOffset;
        const ctxStart = Math.max(0, absStart - 100);
        const contextQuote = flat.slice(ctxStart, absStart + anchor.quote.length + 100)
            .replace(/\s+/g, ' ').trim().slice(0, 300);

        return { page: pageNo, anchor, contextQuote };
    } catch {
        return null;
    }
}

/** First rendered highlight mark for a note on the given page element. */
function findMarkOnPage(pageEl: Element, noteId: string): HTMLElement | null {
    return pageEl.querySelector<HTMLElement>(`mark[data-id="${CSS.escape(noteId)}"]`);
}

/** True when a note's source is a PDF file. */
export function isPdfNote(note: HighlightNote): boolean {
    return note.sourcePath.toLowerCase().endsWith('.pdf');
}

/** Guard for vault-touching helpers: only markdown files carry <mark> anchors. */
export function isMarkdownFile(app: App, path: string): boolean {
    if (!path.toLowerCase().endsWith('.md')) return false;
    const f = app.vault.getAbstractFileByPath(path);
    return f instanceof TFile;
}
