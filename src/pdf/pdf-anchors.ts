// ============================================================
// HiLighter - PDF note anchors (best-effort, internal-API safe)
// ============================================================
// Obsidian's PDF view (pdf.js) is not public API. Everything here
// feature-detects and degrades gracefully: jump falls back to just
// opening the file, overlay skips on any mismatch.

import { App, Notice, TFile, View } from 'obsidian';
import type { HighlightNote } from '../models';
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

    const page = note.pdfPage ?? (note.lineIndex > 0 ? note.lineIndex : null);

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
                return;
            }
            if (typeof nav.setCurrentPageNumber === 'function') {
                nav.setCurrentPageNumber(page);
                return;
            }
        }
    } catch {
        // try DOM below
    }

    // 2. Scroll the rendered page element into view (needs a paint frame)
    if (page != null) {
        for (const delay of [50, 250, 700]) {
            const ok = await tryScrollToPage(app, page, delay);
            if (ok) return;
        }
    }

    // 3. Graceful fallback
    if (page != null) new Notice(t('pdf.jumpFallback', { page }));
}

async function tryScrollToPage(app: App, page: number, delayMs: number): Promise<boolean> {
    await new Promise((r) => setTimeout(r, delayMs));
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
