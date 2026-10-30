import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import type { View } from 'obsidian';
import type HiLighterPlugin from '../src/main';

const mocks = vi.hoisted(() => ({ add: vi.fn(), save: vi.fn(), open: vi.fn(), notice: vi.fn() }));
vi.mock('obsidian', () => ({ Notice: mocks.notice, TFile: class {}, View: class {} }));
vi.mock('../src/db', () => ({ db: { addHighlightNote: mocks.add } }));
vi.mock('../src/image-paste', () => ({ saveImageAttachment: mocks.save }));
vi.mock('../src/studio/modals', () => ({ HighlightDetailModal: class { open = mocks.open; } }));

import { startPdfScreenshot } from '../src/pdf/pdf-screenshot';

describe('PDF screenshot to card', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue('![[capture.png]]'); mocks.add.mockResolvedValue(undefined); });
    it('captures a rendered PDF page and creates an image card', async () => {
        const { document, window } = parseHTML('<html><body><div id="view"><div class="page" data-page-number="1"><canvas></canvas></div></div></body></html>');
        const viewEl = document.querySelector('#view')!;
        const page = document.querySelector('.page')!;
        const canvas = page.querySelector('canvas')!;
        const rect = { top: 0, left: 0, right: 400, bottom: 500, width: 400, height: 500, x: 0, y: 0, toJSON: () => ({}) };
        viewEl.getBoundingClientRect = () => rect;
        page.getBoundingClientRect = () => rect;
        canvas.getBoundingClientRect = () => rect;
        canvas.width = 800; canvas.height = 1000;
        const draw = vi.fn();
        const originalCreate = document.createElement.bind(document);
        const create = vi.spyOn(document, 'createElement').mockImplementation(((name: string) => {
            const element = originalCreate(name);
            if (name === 'canvas') {
                Object.assign(element, { getContext: () => ({ drawImage: draw }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['image'], { type: 'image/png' })) });
            }
            return element;
        }) as typeof document.createElement);
        const view = { file: { path: 'scan.pdf' }, containerEl: viewEl, getViewType: () => 'pdf' } as unknown as View;
        const plugin = { app: { workspace: { getMostRecentLeaf: () => ({ view }) } }, settings: { noteImageFolder: '', groupExportFolder: '' }, refreshAllViews: vi.fn() } as unknown as HiLighterPlugin;
        startPdfScreenshot(plugin, view);
        const overlay = page.querySelector('.hl-pdf-capture-overlay') as unknown as HTMLElement;
        expect(overlay).toBeTruthy();
        overlay.getBoundingClientRect = () => rect;
        overlay.setPointerCapture = vi.fn();
        const pointer = (type: string, x: number, y: number) => {
            const event = new window.Event(type, { bubbles: true, cancelable: true });
            Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
            overlay.dispatchEvent(event as unknown as Event);
        };
        pointer('pointerdown', 30, 50); pointer('pointermove', 130, 150); pointer('pointerup', 130, 150);
        await vi.waitFor(() => expect(mocks.add).toHaveBeenCalledOnce());
        expect(draw).toHaveBeenCalled();
        expect(mocks.add.mock.calls[0]![0]).toMatchObject({ sourcePath: 'scan.pdf', note: '![[capture.png]]', pdfPage: 1, anchorType: 'pdf' });
        expect(mocks.open).toHaveBeenCalledOnce();
        create.mockRestore();
    });
});
