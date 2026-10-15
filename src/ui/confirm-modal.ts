// ============================================================
// HiLighter - shared confirmation modal
// ============================================================
// Replaces native confirm(), which Obsidian's plugin guidelines
// forbid (blocking, unthemed). Used for destructive actions such
// as deleting colors/cards or resetting review progress.

import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export interface ConfirmModalOptions {
    /** Label for the confirm button; defaults to the generic "Confirm". */
    readonly confirmText?: string;
    /** Render the confirm button in warning style for destructive actions. */
    readonly warning?: boolean;
}

export class ConfirmModal extends Modal {
    private readonly message: string;
    private readonly onConfirm: () => void | Promise<void>;
    private readonly options: ConfirmModalOptions;

    constructor(
        app: App,
        message: string,
        onConfirm: () => void | Promise<void>,
        options: ConfirmModalOptions = {},
    ) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.options = options;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hl-confirm-modal');
        contentEl.createEl('p', { text: this.message, cls: 'hl-confirm-message' });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t('btn.cancel'))
                .onClick(() => this.close()))
            .addButton(btn => {
                btn.setButtonText(this.options.confirmText ?? t('btn.confirm'))
                    .onClick(() => {
                        this.close();
                        void Promise.resolve()
                            .then(() => this.onConfirm())
                            .catch(err => console.error('[HiLighter] confirm action failed:', err));
                    });
                if (this.options.warning) btn.setWarning();
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
