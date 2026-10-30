// ============================================================
// HiLighter - Anchored note popup (click-to-note)
// ============================================================
// A small popover anchored at the click point: type a note, paste or
// drop images (they land as vault attachments), save. The caller owns
// what "save" means (wrap a word in the source / DB-only anchor).

import { App, Notice } from 'obsidian';
import { t } from './i18n';
import { attachImageHandlers, createImagePickButton, extractImageFiles, saveImageAttachments } from './image-paste';

export interface NotePopupResult {
    /** Markdown text; image embeds already appended on their own lines. */
    note: string;
    /** Image embed lines, for callers that track them separately. */
    images: string[];
    /** True when nothing was entered (treated as cancel). */
    isEmpty: boolean;
}

export interface NotePopupOptions {
    app: App;
    doc: Document;
    /** Viewport coords to anchor at. */
    x: number;
    y: number;
    /** Anchored word shown as the popup title (image-only notes pass ''). */
    word?: string;
    /** Image-only mode: no textarea, images are the whole note. */
    imageOnly?: boolean;
    sourcePath: string;
    /** Optional vault-relative folder; empty follows Obsidian's attachment settings. */
    imageFolder?: string;
    /** AI note generation: while pending the textarea is read-only with a
     *  "generating" placeholder; the resolved text is filled in for review. */
    aiPending?: Promise<string>;
    onSave(result: NotePopupResult): void | Promise<void>;
    onEdit?(result: NotePopupResult): void;
}

const POPUP_CLS = 'hl-note-popup';

/** Closes any open note popup in the given document. */
export function closeNotePopup(doc: Document): void {
    doc.querySelectorAll('.' + POPUP_CLS).forEach(el => el.remove());
}

export function openNotePopup(opts: NotePopupOptions): void {
    const { app, doc } = opts;
    closeNotePopup(doc);

    const pop = doc.body.createDiv(POPUP_CLS);

    const header = pop.createDiv('hl-note-popup-header');
    if (opts.word) {
        const wordEl = header.createDiv('hl-note-popup-word');
        wordEl.textContent = opts.word;
    } else if (opts.imageOnly) {
        header.createDiv({ cls: 'hl-note-popup-title', text: t('notePopup.imageOnlyTitle') });
    } else {
        header.createDiv({ cls: 'hl-note-popup-title', text: t('notePopup.title') });
    }
    const closeBtn = header.createDiv('hl-note-popup-close');
    closeBtn.setText('×');
    closeBtn.setAttribute('aria-label', t('btn.cancel'));

    let images: string[] = [];

    const body = pop.createDiv('hl-note-popup-body');

    let textarea: HTMLTextAreaElement | null = null;
    if (!opts.imageOnly) {
        textarea = body.createEl('textarea', {
            cls: 'hl-note-popup-textarea',
            attr: { placeholder: t('notePopup.placeholder'), rows: 3 }
        });
        attachImageHandlers(app, textarea, opts.sourcePath, {
            onImageSaved: (line) => { images = [...images, line]; renderChips(); },
        }, opts.imageFolder);

        // AI-generated note: lock the field while the request runs, then fill it.
        if (opts.aiPending) {
            const ta = textarea;
            ta.disabled = true;
            ta.setAttribute('placeholder', t('notePopup.aiPending'));
            const alive = () => ta.isConnected;
            opts.aiPending.then(text => {
                if (!alive()) return;
                ta.value = text.trim();
            }).catch((err: unknown) => {
                if (!alive()) return;
                const message = err instanceof Error ? err.message : String(err);
                new Notice(t('notePopup.aiFailed', { message }));
            }).finally(() => {
                if (!alive()) return;
                ta.disabled = false;
                ta.setAttribute('placeholder', t('notePopup.placeholder'));
                ta.focus();
            });
        }
    }

    // Image chip list (embeds collect here before save)
    const chipWrap = body.createDiv('hl-note-popup-chips');
    const renderChips = () => {
        chipWrap.empty();
        images.forEach((line, idx) => {
            const chip = chipWrap.createDiv('hl-img-chip');
            chip.createSpan({ text: line.replace(/[![\]]/g, '').split('|')[0]!, cls: 'hl-img-chip-name' });
            const rm = chip.createSpan({ text: '×', cls: 'hl-img-chip-remove' });
            rm.setAttribute('aria-label', t('notePopup.removeImage'));
            rm.onclick = () => {
                images = images.filter((_, imageIndex) => imageIndex !== idx);
                renderChips();
            };
        });
    };

    if (opts.imageOnly) attachImageHandlers(app, body, opts.sourcePath, {
        onImageSaved: (line) => { images = [...images, line]; renderChips(); },
    }, opts.imageFolder);

    // Image-only mode has no textarea, so paste events have no focused
    // receiver — capture them at the document level while the popup lives.
    const docPaste = (e: ClipboardEvent) => {
        const files = extractImageFiles(e.clipboardData);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
            const lines = await saveImageAttachments(app, files, opts.sourcePath, opts.imageFolder);
            images = [...images, ...lines];
            renderChips();
        })();
    };
    if (opts.imageOnly) {
        doc.addEventListener('paste', docPaste, true);
    }

    const actions = pop.createDiv('hl-note-popup-actions');
    const pickBtn = createImagePickButton(app, opts.sourcePath, {
        onImageSaved: (line) => { images = [...images, line]; renderChips(); },
    }, t('notePopup.addImage'), opts.imageFolder);
    actions.appendChild(pickBtn);

    const cancelBtn = actions.createEl('button', { cls: 'hl-note-popup-cancel', text: t('btn.cancel') });
    const editBtn = opts.onEdit ? actions.createEl('button', { text: t('notePopup.editCard') }) : null;
    const saveBtn = actions.createEl('button', { cls: 'hl-note-popup-save', text: t('notePopup.save') });

    const close = () => {
        doc.removeEventListener('paste', docPaste, true);
        pop.remove();
    };

    const save = () => {
        const text = textarea ? textarea.value.trim() : '';
        const result: NotePopupResult = {
            note: [text, ...images].filter(Boolean).join('\n\n'),
            images: [...images],
            isEmpty: !text && images.length === 0,
        };
        close();
        void Promise.resolve(opts.onSave(result)).catch(() => new Notice(t('notePopup.saveFailed')));
    };

    cancelBtn.onclick = close;
    if (editBtn) editBtn.onclick = () => {
        const text = textarea?.value.trim() ?? '';
        const result = { note: [text, ...images].filter(Boolean).join('\n\n'), images: [...images], isEmpty: !text && images.length === 0 };
        close();
        opts.onEdit?.(result);
    };
    closeBtn.onclick = close;
    saveBtn.onclick = save;

    if (textarea) {
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        });
    }

    // Clamp to viewport, prefer below-right of the anchor
    const rect = pop.getBoundingClientRect();
    let left = Math.min(opts.x, window.innerWidth - rect.width - 12);
    let top = opts.y + 14;
    if (top + rect.height > window.innerHeight - 12) top = Math.max(12, opts.y - rect.height - 14);
    if (left < 12) left = 12;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    // Outside click / Esc close (capture phase so it wins over editor handlers)
    window.setTimeout(() => {
        const handler = (ev: Event) => {
            const kev = ev as KeyboardEvent;
            if (kev.key === 'Escape') { close(); cleanup(); return; }
            if (!pop.contains(ev.target as Node)) { close(); cleanup(); return; }
        };
        const cleanup = () => {
            doc.removeEventListener('pointerdown', handler, true);
            doc.removeEventListener('keydown', handler, true);
        };
        doc.addEventListener('pointerdown', handler, true);
        doc.addEventListener('keydown', handler, true);
    }, 0);

    if (textarea) {
        const ta = textarea;
        window.setTimeout(() => ta.focus(), 30);
    }
}
