// ============================================================
// HiLighter - Bookshelf folder picker
// ============================================================
// Fuzzy folder picker shared by the scope modal (include / exclude
// folders) and the book move flow. The vault root is offered as a
// pickable entry ("根目录") so books can also move to the top level.

import { App, FuzzySuggestModal, TFolder } from 'obsidian';
import { t } from '../i18n';

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
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
