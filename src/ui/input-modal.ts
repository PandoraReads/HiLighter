// ============================================================
// HiLighter - Generic single-line text input modal
// ============================================================
// Small prompt with autofocus, Enter-to-submit, Escape-to-cancel.
// Used by lightweight rename flows (e.g. the notebook title).

import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';

export interface TextInputModalOpts {
	/** Heading above the input. */
	title: string;
	/** Initial value ('' = empty). */
	value?: string;
	placeholder?: string;
	confirmText?: string;
	onSubmit: (value: string) => void;
}

export class TextInputModal extends Modal {
	private opts: TextInputModalOpts;
	private inputEl: HTMLInputElement | null = null;

	constructor(app: App, opts: TextInputModalOpts) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hl-input-modal');

		contentEl.createEl('h3', { text: this.opts.title, cls: 'hl-input-modal-title' });
		this.inputEl = contentEl.createEl('input', {
			cls: 'hl-input-modal-input',
			attr: {
				type: 'text',
				placeholder: this.opts.placeholder ?? '',
				'aria-label': this.opts.title,
				value: this.opts.value ?? '',
			},
		});
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.submit();
			}
		});

		const actions = contentEl.createDiv('hl-input-modal-actions');
		const cancel = actions.createEl('button', {
			cls: 'hl-input-modal-btn',
			text: t('btn.cancel'),
		});
		cancel.onclick = () => this.close();
		const confirm = actions.createEl('button', {
			cls: 'hl-input-modal-btn is-primary',
			text: this.opts.confirmText ?? t('bookshelf.meta.save'),
		});
		confirm.onclick = () => this.submit();

		window.setTimeout(() => {
			this.inputEl?.focus();
			this.inputEl?.select();
		}, 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const value = this.inputEl?.value ?? '';
		this.close();
		this.opts.onSubmit(value.trim());
	}
}
