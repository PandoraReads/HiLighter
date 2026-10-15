// ============================================================
// HiLighter - Studio modals (detail / note edit / batch tag / tag edit)
// ============================================================

import { Modal, Notice, setIcon, MarkdownRenderer, MarkdownView, App, Component } from 'obsidian';
import { db } from '../db';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { generateXhsImage } from './xhs';
import { removeHighlightFromVault } from './actions';
import { attachImageHandlers } from '../image-paste';
import { ConfirmModal } from '../ui/confirm-modal';
import { jumpToPdfNote } from '../pdf/pdf-anchors';
import { jumpToEpubNote } from '../epub/epub-jump';

export class BatchTagModal extends Modal {
    private onSubmit: (tag: string) => void | Promise<void>;
    private inputEl: HTMLInputElement;

    constructor(app: App, onSubmit: (tag: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hl-batch-tag-modal');
        contentEl.createEl('h3', { text: t('modal.batchTag.title'), cls: 'hl-batch-tag-title' });
        contentEl.createEl('p', { text: t('modal.batchTag.hint'), cls: 'hl-batch-tag-hint' });

        const inputWrap = contentEl.createDiv('hl-batch-tag-input-wrap');
        this.inputEl = inputWrap.createEl('input', {
            type: 'text',
            placeholder: t('modal.batchTag.placeholder'),
            cls: 'hl-batch-tag-input'
        });

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submit();
        });

        // Tag Suggestions
        const suggestions = [t('tag.key'), t('tag.archive')];
        const suggestRow = contentEl.createDiv('hl-batch-tag-suggestions');
        suggestions.forEach(tag => {
            const chip = suggestRow.createEl('button', { cls: 'hl-tag-chip', text: tag });
            chip.onclick = () => {
                this.inputEl.value = tag;
                this.submit();
            };
        });

        const btnRow = contentEl.createDiv('hl-batch-tag-btn-row');
        const cancelBtn = btnRow.createEl('button', { text: t('btn.cancel'), cls: 'hl-batch-tag-btn cancel' });
        cancelBtn.onclick = () => this.close();
        const confirmBtn = btnRow.createEl('button', { text: t('modal.batchTag.confirm'), cls: 'hl-batch-tag-btn confirm' });
        confirmBtn.onclick = () => this.submit();

        setTimeout(() => this.inputEl.focus(), 50);
    }

    private submit() {
        const val = this.inputEl?.value?.trim();
        if (!val) return;
        this.close();
        void this.onSubmit(val);
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class HighlightDetailModal extends Modal {
    private note: HighlightNote;
    private onUpdate: () => void | Promise<void>;

    constructor(app: App, note: HighlightNote, onUpdate: () => void) {
        super(app);
        this.note = note;
        this.onUpdate = onUpdate;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('hl-detail-modal');

        const container = contentEl.createDiv('hl-detail-container');

        // Magazine Style Header
        const header = container.createDiv('hl-detail-header');

        const highlightText = header.createDiv('hl-detail-highlight');
        highlightText.textContent = this.note.text;

        const meta = header.createDiv('hl-detail-meta');
        const filename = this.note.sourcePath.split('/').pop()?.replace('.md', '') || 'Note';
        const date = new Date(this.note.createdAt);
        const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        meta.setText(`${dateStr} | ${filename}`);

        // Magazine Style Body
        const body = container.createDiv('hl-detail-body');
        if (this.note.note) {
            const noteContainer = body.createDiv('hl-detail-note');
            // Modal is not a Component; null keeps the render detached from a lifecycle owner.
            const owner = null as unknown as Component;
            void MarkdownRenderer.render(this.app, this.note.note, noteContainer, this.note.sourcePath, owner)
                .catch(() => new Notice(t('modal.detail.renderFailed')));
        } else {
            body.createDiv({ cls: 'hl-detail-empty', text: t('modal.detail.empty') });
        }

        // Footer
        const footer = container.createDiv('hl-detail-footer');

        // Row 1: Actions (left: delete, right: edit/jump/xhs)
        const footerRow1 = footer.createDiv('hl-detail-footer-row1');

        const deleteBtn = footerRow1.createEl('button', { cls: 'hl-studio-mini-btn hl-detail-delete-btn', attr: { 'aria-label': t('modal.detail.aria.delete') } });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.onclick = () => {
            new ConfirmModal(this.app, t('modal.detail.deleteConfirm'), () => {
                void this.handleDelete();
            }, { confirmText: t('btn.delete'), warning: true }).open();
        };

        const actions = footerRow1.createDiv('hl-detail-actions');

        const editBtn = actions.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': t('modal.detail.aria.edit') } });
        setIcon(editBtn, 'edit-3');
        editBtn.onclick = () => {
            new NoteEditModal(this.app, this.note, (newNote) => {
                void (async () => {
                    await db.updateHighlightNote(this.note.id, { note: newNote });
                    this.note.note = newNote;
                    await this.onUpdate();
                    this.onOpen();
                    new Notice(t('modal.detail.noteUpdated'));
                })();
            }).open();
        };

        const xhsBtn = actions.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': t('modal.detail.aria.xhs') } });
        setIcon(xhsBtn, 'image');
        xhsBtn.onclick = () => {
            generateXhsImage(this.note);
            new Notice(t('modal.detail.xhsGenerated'));
        };

        const jumpBtn = actions.createEl('button', { cls: 'hl-studio-mini-btn', attr: { 'aria-label': t('modal.detail.aria.jump') } });
        setIcon(jumpBtn, 'external-link');
        jumpBtn.onclick = () => {
            void (async () => {
                await this.handleJump();
                this.close();
            })();
        };

        const pinBtn = actions.createEl('button', {
            cls: 'hl-studio-mini-btn',
            attr: { 'aria-label': t('manager.pin') }
        });
        setIcon(pinBtn, 'pin');
        pinBtn.toggleClass('is-accent', (this.note.pinned || 0) > 0);
        pinBtn.onclick = () => {
            void (async () => {
                const isPinned = (this.note.pinned || 0) > 0;
                const newPinned = isPinned ? 0 : Date.now();
                await db.updateHighlightNote(this.note.id, { pinned: newPinned });
                this.note.pinned = newPinned;
                pinBtn.toggleClass('is-accent', !isPinned);
                new Notice(isPinned ? t('manager.notice.unpinned') : t('manager.notice.pinned'));
                await this.onUpdate();
            })();
        };

        // Reset this card's FSRS progress (back to a new card)
        if (this.note.fsrs) {
            const resetBtn = actions.createEl('button', {
                cls: 'hl-studio-mini-btn',
                attr: { 'aria-label': t('fsrs.resetCard') }
            });
            setIcon(resetBtn, 'rotate-ccw');
            resetBtn.onclick = () => {
                void (async () => {
                    await db.updateHighlightNote(this.note.id, { fsrs: undefined });
                    this.note.fsrs = undefined;
                    new Notice(t('fsrs.resetCardDone'));
                    this.close();
                    await this.onUpdate();
                })();
            };
        }

        // Row 2: Tags (left-aligned, below actions)
        if (this.note.tags && this.note.tags.length > 0) {
            const tagsWrap = footer.createDiv('hl-detail-tags');
            (this.note.tags).forEach(tag => {
                const tagEl = tagsWrap.createSpan('hl-tag');
                setIcon(tagEl, 'tag');
                tagEl.createSpan({ text: tag });
            });
        }
    }

    private async handleDelete(): Promise<void> {
        await db.deleteHighlightNote(this.note.id);
        await removeHighlightFromVault(this.app, this.note);
        new Notice(t('modal.detail.deleted'));
        this.close();
        await this.onUpdate();
    }

    private async handleJump() {
        if (this.note.sourcePath.toLowerCase().endsWith('.pdf')) {
            await jumpToPdfNote(this.app, this.note);
            return;
        }
        if (this.note.anchorType === 'epub' || this.note.sourcePath.toLowerCase().endsWith('.epub')) {
            await jumpToEpubNote(this.app, this.note);
            return;
        }
        await this.app.workspace.openLinkText(this.note.sourcePath, '', false);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.editor) {
            view.editor.setCursor(this.note.lineIndex, 0);
            view.editor.scrollIntoView(
                { from: { line: this.note.lineIndex, ch: 0 }, to: { line: this.note.lineIndex, ch: 0 } },
                true,
            );
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class NoteEditModal extends Modal {
    private note: HighlightNote;
    private onSubmit: (text: string) => void | Promise<void>;

    constructor(app: App, note: HighlightNote, onSubmit: (text: string) => void) {
        super(app);
        this.note = note;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText(t('modal.noteEdit.title'));
        this.modalEl.addClass('hl-glass-modal');

        const container = contentEl.createDiv('hl-glass-modal-body');

        const textArea = container.createEl('textarea', {
            cls: 'hl-glass-textarea',
            attr: { placeholder: t('modal.noteEdit.placeholder') }
        });
        textArea.value = this.note.note || '';
        textArea.focus();

        // Paste / drop images straight into the note (saved as vault attachments)
        attachImageHandlers(this.app, textArea, this.note.sourcePath, {
            onImageSaved: (line) => {
                textArea.value = textArea.value ? `${textArea.value}\n\n${line}` : line;
            },
        });

        const actions = container.createDiv('hl-glass-modal-actions');

        const cancelBtn = actions.createEl('button', { text: t('btn.cancel'), cls: 'hl-glass-btn-cancel' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: t('modal.noteEdit.save') });
        saveBtn.onclick = () => {
            void this.onSubmit(textArea.value);
            this.close();
        };
    }
}

export class TagEditModal extends Modal {
    private tag: string;
    private onSubmit: (tag: string) => void;
    private inputEl: HTMLInputElement;

    constructor(app: App, tag: string, onSubmit: (tag: string) => void) {
        super(app);
        this.tag = tag;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText(t('modal.tagEdit.title'));
        this.modalEl.addClass('hl-glass-modal');

        const container = contentEl.createDiv('hl-glass-modal-body');

        const fieldWrap = container.createDiv('hl-glass-field');
        fieldWrap.createEl('label', { text: t('modal.tagEdit.label'), cls: 'hl-glass-label' });
        this.inputEl = fieldWrap.createEl('input', {
            type: 'text',
            placeholder: t('modal.tagEdit.placeholder'),
            value: this.tag,
            cls: 'hl-glass-input'
        });

        const actions = container.createDiv('hl-glass-modal-actions');
        const cancelBtn = actions.createEl('button', { text: t('btn.cancel'), cls: 'hl-glass-btn-cancel' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = actions.createEl('button', { cls: 'hl-glass-btn-confirm', text: t('btn.confirm') });
        confirmBtn.onclick = () => this.handleSubmit();

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleSubmit();
            if (e.key === 'Escape') this.close();
        });

        setTimeout(() => this.inputEl.focus(), 50);
    }

    private handleSubmit() {
        const newTag = this.inputEl.value.trim();
        if (newTag && newTag !== this.tag) {
            this.onSubmit(newTag);
        }
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
