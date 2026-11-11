// ============================================================
// HiLighter - Bookshelf batch tag modal
// ============================================================
// Applies shelf tags to a multi-selection of books: existing tags
// render as toggle rows (checked = present on ALL selected books),
// plus a free-text field for new tags.

import { App, Modal, setIcon } from 'obsidian';
import { t } from '../i18n';
import {
	collectBookTags,
	setTagOnBooks,
	tagOnAllBooks,
} from './book-tags';
import type HiLighterPlugin from '../main';
import { withTagDeletion, withoutTagDeletion } from '../sync/shelf-collections';

export class TagBooksModal extends Modal {
	private readonly plugin: HiLighterPlugin;
	private readonly paths: string[];
	private readonly onChange: () => void;

	constructor(app: App, plugin: HiLighterPlugin, paths: string[], onChange: () => void) {
		super(app);
		this.plugin = plugin;
		this.paths = [...paths];
		this.onChange = onChange;
	}

	onOpen(): void {
		this.renderContent();
	}

	private renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hl-scope-modal');
		contentEl.createEl('h2', { text: t('bookshelf.tagModal.title'), cls: 'hl-scope-title' });
		contentEl.createDiv({ cls: 'hl-scope-hint', text: t('bookshelf.tagModal.hint') });

		const tags = this.plugin.settings.bookshelfTags ?? {};
		const all = collectBookTags(tags);

		if (all.length === 0) {
			contentEl.createDiv({ cls: 'hl-scope-empty', text: t('bookshelf.tagModal.empty') });
		} else {
			const list = contentEl.createDiv('hl-scope-list');
			all.forEach(({ tag, count }) => {
				const checked = tagOnAllBooks(tags, this.paths, tag);
				const row = list.createDiv(`hl-scope-row hl-tag-row ${checked ? 'is-checked' : ''}`);
				const box = row.createSpan('hl-tag-box');
				setIcon(box, checked ? 'check' : '');
				row.createSpan({ text: tag, cls: 'hl-scope-path' });
				row.createSpan({ text: String(count), cls: 'hl-tag-count' });
				row.onclick = () => {
					this.apply(tag, !checked);
					this.renderContent();
				};
			});
		}

		// New tag input
		const inputRow = contentEl.createDiv('hl-tag-new-row');
		const input = inputRow.createEl('input', {
			cls: 'hl-tag-new-input',
			attr: { type: 'text', placeholder: t('bookshelf.tagModal.newPlaceholder') },
		});
		const add = () => {
			const value = input.value.trim();
			if (!value) return;
			this.apply(value, true);
			input.value = '';
			this.renderContent();
		};
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				add();
			}
		});
		const addBtn = inputRow.createEl('button', { cls: 'hl-scope-add', text: t('bookshelf.tagModal.add') });
		addBtn.onclick = add;
	}

	/** Persists a tag change across the selection and notifies the page. */
	private apply(tag: string, addTag: boolean): void {
		this.plugin.settings.bookshelfTags = setTagOnBooks(
			this.plugin.settings.bookshelfTags ?? {},
			this.paths,
			tag,
			addTag,
		);
		// Mirror the change into tag tombstones so a removal propagates
		// across devices (and a re-add clears any stale suppression).
		const clean = tag.trim();
		if (clean) {
			let tombstones = this.plugin.settings.tagTombstones ?? [];
			for (const path of this.paths) {
				tombstones = addTag
					? withoutTagDeletion(tombstones, path, clean)
					: withTagDeletion(tombstones, path, clean, Date.now());
			}
			this.plugin.settings.tagTombstones = tombstones;
		}
		void this.plugin.saveSettings();
		this.onChange();
	}
}
