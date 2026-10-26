// ============================================================
// HiLighter - Studio modals (detail / note edit / batch tag / tag edit)
// ============================================================

import { Modal, Notice, setIcon, MarkdownView, App, TFolder, normalizePath } from 'obsidian';
import { db } from '../db';
import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { generateXhsImage } from './xhs';
import { removeHighlightFromVault } from './actions';
import { attachImageHandlers } from '../image-paste';
import { ConfirmModal } from '../ui/confirm-modal';
import { jumpToPdfNote } from '../pdf/pdf-anchors';
import { jumpToEpubNote } from '../epub/epub-jump';
import { locateHighlightMark } from '../locate';
import { normalizeVaultFolder } from '../vault-path';
import { renderMarkdownPreview, DetachedComponent } from './markdown';

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

        window.setTimeout(() => this.inputEl.focus(), 50);
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
    private imageFolder: string;
    private exportFolder: string;
    private previewComponent: DetachedComponent | null = null;
    private previewMode = false;

    constructor(app: App, note: HighlightNote, onUpdate: () => void, imageFolder = '', exportFolder = '') {
        super(app);
        this.note = note;
        this.onUpdate = onUpdate;
        this.imageFolder = imageFolder;
        this.exportFolder = exportFolder;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('hl-detail-modal');
        this.previewComponent = new DetachedComponent();
        this.previewComponent.load();

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

        // Open the enlarged card directly in its note editor.
        const body = container.createDiv('hl-detail-body');

        // Write / preview toggle above the editor.
        const modeTabs = body.createDiv('hl-detail-mode-tabs');
        const writeTab = modeTabs.createEl('button', { cls: 'hl-detail-mode-tab is-active', text: t('modal.detail.tabWrite') });
        const previewTab = modeTabs.createEl('button', { cls: 'hl-detail-mode-tab', text: t('modal.detail.tabPreview') });

        const textarea = body.createEl('textarea', {
            cls: 'hl-detail-editor-input',
            attr: { placeholder: t('modal.noteEdit.placeholder'), 'aria-label': t('manager.card.myNote') },
        });
        textarea.value = this.note.note || '';

        const previewEl = body.createDiv('hl-detail-markdown-preview');
        previewEl.hide();
        const renderPreview = () => {
            void renderMarkdownPreview(this.app, textarea.value, previewEl, this.note.sourcePath, this.previewComponent!)
                .catch(err => console.error('[HiLighter] preview render failed', err));
        };
        const setMode = (preview: boolean) => {
            this.previewMode = preview;
            writeTab.toggleClass('is-active', !preview);
            previewTab.toggleClass('is-active', preview);
            textarea.toggleClass('is-hidden', preview);
            if (preview) {
                previewEl.show();
                renderPreview();
            } else {
                previewEl.hide();
                window.setTimeout(() => textarea.isConnected && textarea.focus(), 0);
            }
        };
        writeTab.onclick = () => setMode(false);
        previewTab.onclick = () => setMode(true);

        attachImageHandlers(this.app, textarea, this.note.sourcePath, {
            onImageSaved: (line) => {
                const separator = textarea.value && !textarea.value.endsWith('\n') ? '\n\n' : '';
                textarea.value = `${textarea.value}${separator}${line}`;
            },
        }, this.imageFolder);
        const editorActions = body.createDiv('hl-detail-editor-actions');
        const cancelEdit = editorActions.createEl('button', { cls: 'hl-studio-mini-btn', text: t('btn.cancel') });
        cancelEdit.onclick = () => this.close();
        const saveEdit = editorActions.createEl('button', { cls: 'hl-studio-mini-btn is-primary', text: t('btn.save') });
        const saveNote = async () => {
            if (saveEdit.disabled) return;
            saveEdit.disabled = true;
            try {
                await db.updateHighlightNote(this.note.id, { note: textarea.value });
                this.note.note = textarea.value;
                await this.onUpdate();
                new Notice(t('modal.detail.noteUpdated'));
                this.close();
            } catch {
                saveEdit.disabled = false;
                new Notice(t('notePopup.saveFailed'));
            }
        };
        saveEdit.onclick = () => { void saveNote(); };
        textarea.onkeydown = (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void saveNote();
            }
        };
        window.setTimeout(() => textarea.isConnected && textarea.focus(), 0);

        // Footer
        const footer = container.createDiv('hl-detail-footer');

        // Row 1: Actions (left: delete, right: jump/xhs)
        const footerRow1 = footer.createDiv('hl-detail-footer-row1');

        const deleteBtn = footerRow1.createEl('button', { cls: 'hl-studio-mini-btn hl-detail-delete-btn', attr: { 'aria-label': t('modal.detail.aria.delete') } });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.onclick = () => {
            new ConfirmModal(this.app, t('modal.detail.deleteConfirm'), () => {
                void this.handleDelete();
            }, { confirmText: t('btn.delete'), warning: true }).open();
        };

        const actions = footerRow1.createDiv('hl-detail-actions');

        const exportBtn = actions.createEl('button', {
            cls: 'hl-studio-mini-btn',
            attr: { 'aria-label': t('manager.card.exportToMarkdown'), title: t('manager.card.exportToMarkdown') },
        });
        setIcon(exportBtn, 'file-down');
        exportBtn.onclick = () => { void this.exportAsMarkdown(textarea.value); };

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

    private async exportAsMarkdown(noteText: string): Promise<void> {
        try {
            const folder = normalizeVaultFolder(this.exportFolder);
            if (folder) {
                let current = '';
                for (const segment of folder.split('/')) {
                    current = current ? `${current}/${segment}` : segment;
                    const existing = this.app.vault.getAbstractFileByPath(current);
                    if (!existing) await this.app.vault.createFolder(current);
                    else if (!(existing instanceof TFolder)) throw new Error(`A file already exists at ${current}`);
                }
            }

            const excerptTitle = this.note.text.replace(/\s+/g, ' ').trim();
            const safeTitle = excerptTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 56).trim() || 'Highlight';
            const baseName = `${new Date(this.note.createdAt).toISOString().slice(0, 10)} ${safeTitle}`;
            const parent = folder ? `${folder}/` : '';
            let path = normalizePath(`${parent}${baseName}.md`);
            let suffix = 2;
            while (this.app.vault.getAbstractFileByPath(path)) {
                path = normalizePath(`${parent}${baseName} (${suffix}).md`);
                suffix += 1;
            }

            const source = this.note.sourcePath
                ? `- ${t('manager.group.export.source')}: [[${this.note.sourcePath.replace(/\|/g, '\\|')}]]`
                : '';
            const tags = this.note.tags?.length
                ? `- ${t('manager.group.export.tags')}: ${this.note.tags.map(tag => `\`${tag}\``).join(', ')}`
                : '';
            const quotedText = this.note.text.split(/\r?\n/).map(line => `> ${line}`).join('\n');
            const content = [
                `# ${excerptTitle || t('manager.group.export.emptyNote')}`,
                '',
                `- ${t('manager.group.export.created')}: ${new Date(this.note.createdAt).toISOString().slice(0, 10)}`,
                source,
                tags,
                '',
                `## ${t('manager.card.originalText')}`,
                '',
                quotedText || '> ',
                '',
                `## ${t('manager.group.export.note')}`,
                '',
                noteText.trim() || `_${t('manager.group.export.emptyNote')}_`,
                '',
            ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
            await this.app.vault.create(path, content);
            new Notice(t('manager.card.exportedMarkdown', { path }));
        } catch (error) {
            console.error('Failed to export highlight as Markdown:', error);
            new Notice(t('manager.card.exportMarkdownFailed'));
        }
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
            locateHighlightMark(view.editor, this.note.id, this.note.lineIndex ?? 0);
        }
    }

    onClose() {
        this.contentEl.empty();
        this.previewComponent?.unload();
        this.previewComponent = null;
    }
}

export class NoteEditModal extends Modal {
    private note: HighlightNote;
    private onSubmit: (text: string) => void | Promise<void>;
    private imageFolder: string;

    constructor(app: App, note: HighlightNote, onSubmit: (text: string) => void, imageFolder = '') {
        super(app);
        this.note = note;
        this.onSubmit = onSubmit;
        this.imageFolder = imageFolder;
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
        }, this.imageFolder);

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

        window.setTimeout(() => this.inputEl.focus(), 50);
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
