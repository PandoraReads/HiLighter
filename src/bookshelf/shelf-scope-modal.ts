// ============================================================
// HiLighter - Bookshelf custom-shelves modal (自定义书架)
// ============================================================
// Manages the library scan scope: saved named shelf presets (one
// click to switch), a "save current scope as shelf" row, and the
// include / exclude folder editors. Extracted from library-page so
// that page stays under the file-size budget.

import {
	App,
	FuzzySuggestModal,
	Modal,
	Notice,
	TFolder,
	setIcon,
} from 'obsidian';
import { t } from '../i18n';
import type { ShelfPreset } from '../models';
import { normalizeFolderList, normalizeIncludeFolders } from './scope';
import {
	activeShelfId,
	addShelf,
	makeShelfPreset,
	normalizeShelves,
	removeShelf,
	reorderShelves,
} from './shelves';
import { wireRowDrag } from './shelf-reorder';
import { withShelfDeletion } from '../sync/shelf-collections';
import { ConfirmModal } from '../ui/confirm-modal';
import type HiLighterPlugin from '../main';

/** Folder picker (fuzzy) used by the scope modal. */
class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	private readonly onPick: (folder: TFolder) => void;

	constructor(app: App, onPick: (folder: TFolder) => void) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder(t('bookshelf.scope.pick'));
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? t('bookshelf.scope.root') : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder);
	}
}

/** Saved shelves + include / exclude editor for the library scan scope. */
export class ShelfScopeModal extends Modal {
	private readonly plugin: HiLighterPlugin;
	private readonly onChange: () => void;

	constructor(app: App, plugin: HiLighterPlugin, onChange: () => void) {
		super(app);
		this.plugin = plugin;
		this.onChange = onChange;
	}

	onOpen(): void {
		this.renderContent();
	}

	private renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hl-scope-modal');
		contentEl.createEl('h2', { text: t('bookshelf.shelves.title'), cls: 'hl-scope-title' });

		this.renderShelfList(contentEl);
		this.renderSaveAsShelf(contentEl);
		this.renderIncludeList(contentEl);
		this.renderExcludeList(contentEl);
	}

	// ── Saved shelves: click a row to switch, x to delete ──

	private renderShelfList(container: HTMLElement): void {
		const shelves = normalizeShelves(this.plugin.settings.bookshelfShelves);

		const section = container.createDiv('hl-scope-section');
		section.createDiv({
			cls: 'hl-scope-heading',
			text: t('bookshelf.shelves.saved'),
		});

		if (shelves.length === 0) {
			section.createDiv({ cls: 'hl-scope-empty', text: t('bookshelf.shelves.empty') });
			return;
		}

		const activeId = activeShelfId(
			shelves,
			this.plugin.settings.bookshelfIncludeFolders,
			this.plugin.settings.bookshelfExcludeFolders,
		);
		const list = section.createDiv('hl-scope-list');
		shelves.forEach(shelf => {
			const active = shelf.id === activeId;
			const row = list.createDiv(`hl-shelf-preset${active ? ' is-active' : ''}`);
			row.setAttribute('role', 'button');
			row.setAttribute('tabindex', '0');
			row.setAttribute('aria-label', t('bookshelf.shelves.switch', { name: shelf.name }));
			row.setAttribute('title', t('bookshelf.shelves.switch'));
			// Grip handle: drag rows to reorder the saved list; the order
			// carries into the toolbar dropdown and cross-device sync.
			const drag = row.createDiv('hl-shelf-preset-drag');
			drag.setAttribute('aria-label', t('bookshelf.shelves.drag'));
			drag.setAttribute('title', t('bookshelf.shelves.drag'));
			setIcon(drag, 'grip-vertical');
			wireRowDrag(list, drag, row, (from, to) => {
				const moved = shelves[from];
				if (!moved) return;
				this.persistShelves(reorderShelves(shelves, moved.id, to));
				this.renderContent();
			});
			const main = row.createDiv('hl-shelf-preset-main');
			main.createDiv({ cls: 'hl-shelf-preset-name', text: shelf.name });
			main.createDiv({ cls: 'hl-shelf-preset-scope', text: this.shelfSummary(shelf) });
			if (active) {
				row.createSpan({ cls: 'hl-shelf-preset-badge', text: t('bookshelf.shelves.active') });
			}
			const del = row.createEl('button', {
				cls: 'hl-scope-remove',
				attr: { 'aria-label': t('bookshelf.shelves.delete'), title: t('bookshelf.shelves.delete') },
			});
			setIcon(del, 'x');
			del.onclick = event => {
				event.stopPropagation();
				new ConfirmModal(
					this.app,
					t('bookshelf.shelves.deleteConfirm', { name: shelf.name }),
					() => {
						// Record the deletion so it survives cross-device sync.
						this.plugin.settings.shelfTombstones = withShelfDeletion(
							this.plugin.settings.shelfTombstones,
							shelf.id,
							Date.now(),
						);
						this.persistShelves(removeShelf(shelves, shelf.id));
						this.renderContent();
					},
					{ warning: true, confirmText: t('bookshelf.shelves.delete') },
				).open();
			};
			const apply = (): void => { void this.applyShelf(shelf); };
			row.onclick = apply;
			row.onkeydown = event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					apply();
				}
			};
		});
	}

	/** Folder summary under a shelf name. */
	private shelfSummary(shelf: ShelfPreset): string {
		const include = normalizeIncludeFolders(shelf.include);
		const exclude = normalizeFolderList(shelf.exclude);
		const label = (folder: string): string => folder === '' ? t('bookshelf.scope.root') : folder;
		const includeText = include.length > 0
			? include.map(ref => label(ref.path)).join(' · ')
			: t('bookshelf.scope.empty');
		return exclude.length > 0
			? `${includeText} ｜ − ${exclude.map(label).join(' · ')}`
			: includeText;
	}

	// ── Save the current scope under a name ──

	private renderSaveAsShelf(container: HTMLElement): void {
		const settings = this.plugin.settings;
		const section = container.createDiv('hl-scope-section');
		section.createDiv({
			cls: 'hl-scope-heading',
			text: t('bookshelf.shelves.saveAs'),
		});
		const row = section.createDiv('hl-shelf-preset-save');
		const input = row.createEl('input', {
			cls: 'hl-shelf-preset-name-input',
			attr: {
				type: 'text',
				placeholder: t('bookshelf.shelves.namePlaceholder'),
				'aria-label': t('bookshelf.shelves.namePlaceholder'),
				maxlength: '40',
			},
		});
		const save = (): void => {
			if (normalizeIncludeFolders(settings.bookshelfIncludeFolders).length === 0) {
				new Notice(t('bookshelf.shelves.scopeEmpty'));
				return;
			}
			const preset = makeShelfPreset(
				input.value,
				settings.bookshelfIncludeFolders,
				settings.bookshelfExcludeFolders,
				normalizeShelves(settings.bookshelfShelves).length,
			);
			if (!preset) {
				new Notice(t('bookshelf.shelves.nameRequired'));
				input.focus();
				return;
			}
			this.persistShelves(addShelf(normalizeShelves(settings.bookshelfShelves), preset));
			new Notice(t('bookshelf.shelves.savedNotice', { name: preset.name }));
			this.renderContent();
		};
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				save();
			}
		});
		const btn = row.createEl('button', { cls: 'hl-scope-add', text: t('bookshelf.shelves.saveAs') });
		setIcon(btn.createSpan({ cls: 'hl-scope-add-icon' }), 'bookmark-plus');
		btn.onclick = save;
	}

	/** Switches the scan scope to a saved shelf (one click). */
	private async applyShelf(shelf: ShelfPreset): Promise<void> {
		this.plugin.settings.bookshelfIncludeFolders = normalizeIncludeFolders(shelf.include);
		this.plugin.settings.bookshelfExcludeFolders = normalizeFolderList(shelf.exclude);
		await this.plugin.saveSettings();
		this.onChange();
		this.renderContent();   // highlight the now-active row
	}

	/** Saves the shelf list; the scan scope itself is untouched. */
	private persistShelves(shelves: ShelfPreset[]): void {
		this.plugin.settings.bookshelfShelves = shelves;
		void this.plugin.saveSettings();
	}

	// ── Include folders: path + per-folder recursion toggle ──

	private renderIncludeList(container: HTMLElement): void {
		const folders = normalizeIncludeFolders(this.plugin.settings.bookshelfIncludeFolders);

		const section = container.createDiv('hl-scope-section');
		section.createDiv({
			cls: 'hl-scope-heading',
			text: t('bookshelf.scope.include'),
		});

		if (folders.length === 0) {
			section.createDiv({ cls: 'hl-scope-empty', text: t('bookshelf.scope.empty') });
		} else {
			const list = section.createDiv('hl-scope-list');
			folders.forEach(folder => {
				const row = list.createDiv('hl-scope-row');
				const pathCol = row.createDiv('hl-scope-row-main');
				pathCol.createSpan({
					text: folder.path === '' ? t('bookshelf.scope.root') : folder.path,
					cls: 'hl-scope-path',
				});

				// Recursion toggle: top-level only (default for new
				// folders) or include nested subfolders.
				const toggleLabel = t(folder.recursive
					? 'bookshelf.scope.recursive'
					: 'bookshelf.scope.topOnly');
				const toggle = pathCol.createEl('button', {
					cls: `hl-scope-recursive ${folder.recursive ? 'is-recursive' : ''}`,
					attr: {
						'aria-label': toggleLabel,
						title: toggleLabel,
						'aria-pressed': String(folder.recursive),
					},
				});
				setIcon(toggle.createSpan({ cls: 'hl-scope-recursive-icon' }),
					folder.recursive ? 'folder-tree' : 'folder');
				toggle.createSpan({ text: toggleLabel, cls: 'hl-scope-recursive-label' });
				toggle.onclick = () => {
					this.persistInclude(folders.map(item => item.path === folder.path
						? { path: item.path, recursive: !item.recursive }
						: item));
					this.renderContent();
				};

				this.appendRemoveButton(row, () => {
					this.persistInclude(folders.filter(item => item.path !== folder.path));
					this.renderContent();
				});
			});
		}

		const add = section.createEl('button', { cls: 'hl-scope-add', text: t('bookshelf.scope.add') });
		setIcon(add.createSpan({ cls: 'hl-scope-add-icon' }), 'plus');
		add.onclick = () => {
			new FolderPickerModal(this.app, (folder) => {
				const normalized = folder.isRoot() ? '' : folder.path;
				if (folders.some(item => item.path === normalized)) {
					new Notice(t('bookshelf.scope.duplicate'));
					return;
				}
				// Defense: the vault root means a whole-vault scan —
				// confirm before that can ever enter the scope.
				if (normalized === '') {
					new ConfirmModal(
						this.app,
						t('bookshelf.scope.rootConfirm'),
						() => {
							this.persistInclude([...folders, { path: '', recursive: true }]);
							this.renderContent();
						},
						{ warning: true, confirmText: t('btn.confirm') },
					).open();
					return;
				}
				// New folders start top-level only; nested archives can
				// be pulled in explicitly with the recursion toggle.
				this.persistInclude([...folders, { path: normalized, recursive: false }]);
				this.renderContent();
			}).open();
		};
	}

	// ── Exclude folders: plain subtree prunes ──

	private renderExcludeList(container: HTMLElement): void {
		const folders = normalizeFolderList(this.plugin.settings.bookshelfExcludeFolders);

		const section = container.createDiv('hl-scope-section');
		section.createDiv({
			cls: 'hl-scope-heading',
			text: t('bookshelf.scope.exclude'),
		});

		if (folders.length === 0) {
			section.createDiv({ cls: 'hl-scope-empty', text: t('bookshelf.scope.empty') });
		} else {
			const list = section.createDiv('hl-scope-list');
			folders.forEach(folder => {
				const row = list.createDiv('hl-scope-row');
				row.createSpan({
					text: folder === '' ? t('bookshelf.scope.root') : folder,
					cls: 'hl-scope-path',
				});
				this.appendRemoveButton(row, () => {
					this.persistExclude(folders.filter(f => f !== folder));
					this.renderContent();
				});
			});
		}

		const add = section.createEl('button', { cls: 'hl-scope-add', text: t('bookshelf.scope.add') });
		setIcon(add.createSpan({ cls: 'hl-scope-add-icon' }), 'plus');
		add.onclick = () => {
			new FolderPickerModal(this.app, (folder) => {
				const normalized = folder.isRoot() ? '' : folder.path;
				if (normalized === '') {
					// Excluding the root would empty the shelf entirely.
					new Notice(t('bookshelf.scope.excludeRootDenied'));
					return;
				}
				if (folders.includes(normalized)) {
					new Notice(t('bookshelf.scope.duplicate'));
					return;
				}
				this.persistExclude([...folders, normalized]);
				this.renderContent();
			}).open();
		};
	}

	private appendRemoveButton(row: HTMLElement, onRemove: () => void): void {
		const remove = row.createEl('button', {
			cls: 'hl-scope-remove',
			attr: { 'aria-label': t('bookshelf.scope.remove'), title: t('bookshelf.scope.remove') },
		});
		setIcon(remove, 'x');
		remove.onclick = onRemove;
	}

	private persistInclude(folders: Array<{ path: string; recursive: boolean }>): void {
		this.plugin.settings.bookshelfIncludeFolders = folders;
		void this.plugin.saveSettings();
		this.onChange();
	}

	private persistExclude(folders: string[]): void {
		this.plugin.settings.bookshelfExcludeFolders = folders;
		void this.plugin.saveSettings();
		this.onChange();
	}
}
