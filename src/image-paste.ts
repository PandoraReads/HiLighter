// ============================================================
// HiLighter - Image paste / drop / pick for note inputs
// ============================================================
// Saves images as real vault attachments (honoring Obsidian's
// attachment folder settings) and hands back a ![[embed]] string.

import { App, Notice, TFile } from 'obsidian';
import { t } from './i18n';
import { normalizeImageFolder } from './image-path';

/** Extracts image Files from a clipboard or drag event. */
export function extractImageFiles(dt: DataTransfer | null): File[] {
    if (!dt) return [];
    const out: File[] = [];
    if (dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) {
            const f = dt.files[i];
            if (f && f.type.startsWith('image/')) out.push(f);
        }
        return out;
    }
    if (dt.items) {
        for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i];
            if (item && item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) out.push(f);
            }
        }
    }
    return out;
}

/** Suggests a vault path for a pasted image, following attachment settings. */
async function attachmentPathFor(app: App, sourcePath: string, name: string, imageFolder = ''): Promise<string> {
    const customFolder = normalizeImageFolder(imageFolder);
    if (customFolder) {
        const segments = customFolder.split('/');
        let current = '';
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
        }

        const extAt = name.lastIndexOf('.');
        const base = extAt > 0 ? name.slice(0, extAt) : name;
        const ext = extAt > 0 ? name.slice(extAt) : '';
        let candidate = `${customFolder}/${name}`;
        let suffix = 1;
        while (app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${customFolder}/${base}-${suffix}${ext}`;
            suffix += 1;
        }
        return candidate;
    }
    const fm = (app as unknown as {
        fileManager: { getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string> };
    }).fileManager;
    return await fm.getAvailablePathForAttachment(name, sourcePath || undefined);
}

/** Reads a File into an ArrayBuffer. */
function readFileData(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsArrayBuffer(file);
    });
}

/** Saves one image into the vault; returns the ![[embed]] markdown line. */
export async function saveImageAttachment(app: App, file: File, sourcePath: string, imageFolder = ''): Promise<string> {
    const data = await readFileData(file);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const base = `HL-${stamp}`;
    let path = await attachmentPathFor(app, sourcePath, `${base}.${ext}`, imageFolder);
    // getAvailablePathForAttachment may omit the extension in some configs
    if (!path.toLowerCase().endsWith('.' + ext)) path = `${path}.${ext}`;
    await app.vault.createBinary(path, data);
    const tf = app.vault.getAbstractFileByPath(path);
    // Keep the full vault-relative path so MarkdownRenderer can resolve images
    // regardless of the source note's folder or Obsidian attachment settings.
    return tf instanceof TFile ? `![[${tf.path}]]` : `![[${path}]]`;
}

/** Saves several images; returns embed lines (one per image). */
export async function saveImageAttachments(app: App, files: File[], sourcePath: string, imageFolder = ''): Promise<string[]> {
    const lines: string[] = [];
    for (const f of files) {
        try {
            lines.push(await saveImageAttachment(app, f, sourcePath, imageFolder));
        } catch {
            new Notice(t('images.saveFailed'));
        }
    }
    return lines;
}

export interface ImageDropZoneCallbacks {
    /** Receives one markdown embed line per saved image. */
    onImageSaved(line: string): void;
}

/** Attaches paste + dragover/drop image handling to an editable element. */
export function attachImageHandlers(
    app: App,
    el: HTMLElement,
    sourcePath: string,
    cb: ImageDropZoneCallbacks,
    imageFolder = '',
): void {
    el.addEventListener('paste', (e: ClipboardEvent) => {
        const files = extractImageFiles(e.clipboardData);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
            const lines = await saveImageAttachments(app, files, sourcePath, imageFolder);
            lines.forEach(l => cb.onImageSaved(l));
            new Notice(t('images.pasted', { count: lines.length }));
        })();
    });

    el.addEventListener('dragover', (e: DragEvent) => {
        const files = extractImageFiles(e.dataTransfer);
        if (files.length === 0) return;
        e.preventDefault();
        el.addClass('hl-img-dropzone-active');
    });
    el.addEventListener('dragleave', () => el.removeClass('hl-img-dropzone-active'));
    el.addEventListener('drop', (e: DragEvent) => {
        const files = extractImageFiles(e.dataTransfer);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        el.removeClass('hl-img-dropzone-active');
        void (async () => {
            const lines = await saveImageAttachments(app, files, sourcePath, imageFolder);
            lines.forEach(l => cb.onImageSaved(l));
            new Notice(t('images.dropped', { count: lines.length }));
        })();
    });
}

/**
 * File-picker button for every platform; paste is not always available.
 * Returns the button element for the caller to place.
 */
export function createImagePickButton(
    app: App,
    sourcePath: string,
    cb: ImageDropZoneCallbacks,
    label: string,
    imageFolder = '',
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'hl-note-img-btn';
    btn.type = 'button';
    btn.textContent = label;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.className = 'is-hidden';
    btn.appendChild(input);
    btn.onclick = () => input.click();
    input.onclick = (event) => event.stopPropagation();
    input.onchange = () => {
        const files = extractImageFiles({ files: input.files } as unknown as DataTransfer);
        if (files.length === 0) return;
        void (async () => {
            const lines = await saveImageAttachments(app, files, sourcePath, imageFolder);
            lines.forEach(l => cb.onImageSaved(l));
            new Notice(t('images.picked', { count: lines.length }));
            input.value = '';
        })();
    };
    return btn;
}
