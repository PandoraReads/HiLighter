import { Notice, TFile, View } from 'obsidian';
import type HiLighterPlugin from '../main';
import { db } from '../db';
import { randomUUID } from '../mocks/crypto';
import { saveImageAttachment } from '../image-paste';
import { t } from '../i18n';
import { canvasCrop } from './crop-math';
import { HighlightDetailModal } from '../studio/modals';
import type { HighlightNote } from '../models';
import { mostVisiblePage } from './visible-page';

type PdfView = View & { file?: TFile; viewer?: { pdfViewer?: { currentPageNumber?: number } } };
const activeCaptures = new WeakMap<Document, () => void>();

/** Start a single-page screenshot selection in the active PDF view. */
export function startPdfScreenshot(plugin: HiLighterPlugin, targetView?: View | null, targetPage?: number): void {
    const leaf = plugin.app.workspace.getMostRecentLeaf();
    const view = (targetView ?? leaf?.view) as PdfView | undefined;
    if (!view || view.getViewType() !== 'pdf' || !view.file) {
        new Notice(t('pdf.captureNeedFile'));
        return;
    }
    const viewRect = view.containerEl.getBoundingClientRect();
    const win = view.containerEl.ownerDocument.defaultView;
    const visiblePages = Array.from(view.containerEl.querySelectorAll<HTMLElement>('.page[data-page-number]'))
        .filter(page => !!page.querySelector('canvas'))
        .map(page => ({ page: Number(page.dataset.pageNumber), rect: page.getBoundingClientRect() }))
        .filter(item => Number.isInteger(item.page) && item.page > 0);
    const visible = mostVisiblePage(visiblePages, { top: Math.max(0, viewRect.top), left: Math.max(0, viewRect.left),
        bottom: Math.min(win?.innerHeight ?? viewRect.bottom, viewRect.bottom), right: Math.min(win?.innerWidth ?? viewRect.right, viewRect.right) });
    const pageNumber = targetPage ?? visible ?? view.viewer?.pdfViewer?.currentPageNumber;
    if (pageNumber == null) { new Notice(t('pdf.captureNotRendered')); return; }
    const page = view.containerEl.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
    const canvas = page?.querySelector<HTMLCanvasElement>('canvas');
    if (!page || !canvas || !canvas.width || !canvas.height) {
        new Notice(t('pdf.captureNotRendered'));
        return;
    }
    const sourcePath = view.file.path;
    const doc = page.ownerDocument;
    activeCaptures.get(doc)?.();
    const overlay = doc.createElement('div');
    overlay.className = 'hl-pdf-capture-overlay';
    const box = doc.createElement('div');
    box.className = 'hl-pdf-capture-selection';
    overlay.appendChild(box);
    page.appendChild(overlay);
    new Notice(t('pdf.captureSelect'));
    let start: { x: number; y: number } | null = null;
    const cleanup = () => { doc.removeEventListener('keydown', keydown, true); overlay.remove(); activeCaptures.delete(doc); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') cleanup(); };
    doc.addEventListener('keydown', keydown, true);
    activeCaptures.set(doc, cleanup);
    overlay.addEventListener('pointerdown', event => {
        event.preventDefault();
        const bounds = overlay.getBoundingClientRect();
        start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', event => {
        if (!start) return;
        const bounds = overlay.getBoundingClientRect();
        const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
        const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
        Object.assign(box.style, { left: `${Math.min(start.x, x)}px`, top: `${Math.min(start.y, y)}px`, width: `${Math.abs(x - start.x)}px`, height: `${Math.abs(y - start.y)}px` });
    });
    overlay.addEventListener('pointercancel', cleanup);
    overlay.addEventListener('pointerup', event => {
        if (!start) return;
        const bounds = overlay.getBoundingClientRect();
        const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
        const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
        const left = Math.min(start.x, x), top = Math.min(start.y, y);
        const width = Math.abs(x - start.x), height = Math.abs(y - start.y);
        cleanup();
        if (width < 5 || height < 5 || !bounds.width || !bounds.height) return;
        const canvasBounds = canvas.getBoundingClientRect();
        const area = canvasCrop({ left: bounds.left + left, top: bounds.top + top,
            right: bounds.left + left + width, bottom: bounds.top + top + height },
            canvasBounds, canvas.width, canvas.height);
        if (!area) {
            new Notice(t('pdf.captureOutside'));
            return;
        }
        const crop = doc.createElement('canvas');
        crop.width = Math.max(1, Math.round(area.width));
        crop.height = Math.max(1, Math.round(area.height));
        const ctx = crop.getContext('2d');
        if (!ctx) { new Notice(t('pdf.captureFailed')); return; }
        try { ctx.drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, crop.width, crop.height); }
        catch { new Notice(t('pdf.captureFailed')); return; }
        try { crop.toBlob(blob => {
            if (!blob) { new Notice(t('pdf.captureFailed')); return; }
            void (async () => {
                try {
                    const embed = await saveImageAttachment(plugin.app, new File([blob], 'capture.png', { type: 'image/png' }), sourcePath, plugin.settings.noteImageFolder);
                    const note: HighlightNote = { id: randomUUID(), text: '', note: embed, color: 'yellow', sourcePath, lineIndex: pageNumber, createdAt: Date.now(), anchorType: 'pdf', pdfPage: pageNumber };
                    await db.addHighlightNote(note);
                    plugin.refreshAllViews();
                    new HighlightDetailModal(plugin.app, note, () => plugin.refreshAllViews(), plugin.settings.noteImageFolder,
                        plugin.settings.groupExportFolder || '').open();
                } catch { new Notice(t('pdf.captureFailed')); }
            })();
        }, 'image/png'); } catch { new Notice(t('pdf.captureFailed')); }
    });
}
