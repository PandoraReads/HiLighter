// ============================================================
// HiLighter - PDF textLayer highlight overlay (best-effort)
// ============================================================
// Re-applies DB highlights onto rendered pdf.js text layers by
// matching note text against the page's spans. Everything is guarded:
// any mismatch skips silently. Toggle: settings.pdfOverlay.

import type HiLighterPlugin from '../main';
import { db } from '../db';
import type { HighlightNote } from '../models';
import { isPdfView } from './pdf-anchors';

const OVERLAY_ATTR = 'data-hl-overlay';

/** Registers the overlay watcher for the whole session (call once in onload). */
export function registerPdfOverlay(plugin: HiLighterPlugin): void {
    plugin.registerEvent(
        plugin.app.workspace.on('active-leaf-change', () => { void refreshOverlay(plugin); })
    );
    plugin.registerEvent(
        plugin.app.workspace.on('layout-change', () => { void refreshOverlay(plugin); })
    );
}

let paintTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshOverlay(plugin: HiLighterPlugin): Promise<void> {
    if (!plugin.settings.pdfOverlay) return;
    try {
        const leaf = plugin.app.workspace.getMostRecentLeaf();
        const view = leaf?.view;
        if (!view || !isPdfView(view)) return;
        const file = (view as unknown as { file?: { path?: string } }).file;
        if (!file?.path) return;

        const notes = (await db.getHighlightsByPath(file.path))
            .filter(n => n.anchorType !== 'note');   // word-notes do not carry highlight text

        paint(view.containerEl, notes);

        // Pages render lazily; repaint a few beats later for late arrivals.
        // Coalesced so rapid layout changes schedule one pass.
        if (paintTimer) clearTimeout(paintTimer);
        paintTimer = setTimeout(() => {
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

function paintPage(page: HTMLElement, notes: HighlightNote[]): void {
    if (notes.length === 0) return;
    const layer = page.querySelector<HTMLElement>(':scope > .textLayer');
    if (!layer) return;
    if (layer.querySelector(`[${OVERLAY_ATTR}]`)) return;   // already painted

    const spans = Array.from(layer.querySelectorAll('span'));
    if (spans.length === 0) return;

    // Page text + span offset table (spans are word fragments)
    let text = '';
    const offsets: Array<{ start: number; end: number; span: HTMLSpanElement }> = [];
    spans.forEach(span => {
        const s = span.textContent ?? '';
        offsets.push({ start: text.length, end: text.length + s.length, span });
        text += s + ' ';
    });
    const flat = text.replace(/\s+/g, ' ');

    notes.forEach(note => {
        try {
            const needle = note.text.replace(/\s+/g, ' ').trim();
            if (!needle) return;
            const idx = flat.indexOf(needle);
            if (idx === -1) return;
            const absStart = idx;
            const absEnd = idx + needle.length;

            offsets.forEach(({ start, end, span }) => {
                if (end <= absStart || start >= absEnd) return;
                if (span.getAttribute(OVERLAY_ATTR)) return;
                const mark = document.createElement('mark');
                mark.className = `hl-highlight hl-h-${note.color}`;
                mark.setAttribute('data-id', note.id);
                mark.setAttribute(OVERLAY_ATTR, 'pdf');
                if (note.colorHex) mark.setAttribute('data-hl-color', note.colorHex);
                span.replaceWith(mark);
                mark.appendChild(span);
            });
        } catch {
            // per-note failures are isolated
        }
    });
}
