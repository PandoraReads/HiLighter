// ============================================================
// HiLighter - Bookshelf dropdown (自定义书架 quick switcher)
// ============================================================
// Lightweight popover anchored under the toolbar's custom-shelves
// button: saved shelves listed for one-click switching, with an
// "add shelf" row at the bottom that opens the full scope modal.
// Keeps the common action (switching) off the heavy settings panel.

import { setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';
import type { ShelfPreset } from '../models';
import type HiLighterPlugin from '../main';
import { normalizeFolderList, normalizeIncludeFolders } from './scope';
import { activeShelfId, normalizeShelves } from './shelves';
import { ShelfScopeModal } from './shelf-scope-modal';

/** Switches the scan scope to a saved shelf. */
async function applyShelf(
	plugin: HiLighterPlugin,
	shelf: ShelfPreset,
	onChange: () => void,
): Promise<void> {
	plugin.settings.bookshelfIncludeFolders = normalizeIncludeFolders(shelf.include);
	plugin.settings.bookshelfExcludeFolders = normalizeFolderList(shelf.exclude);
	await plugin.saveSettings();
	onChange();
}

/** Closes every open shelf dropdown. */
function closeShelfDropdown(): void {
	document.querySelectorAll('.hl-shelf-dropdown').forEach(el => el.remove());
	document.removeEventListener('pointerdown', onDocPointerDown, true);
	document.removeEventListener('keydown', onDocKeydown, true);
}

function onDocPointerDown(event: PointerEvent): void {
	const target = event.target as HTMLElement | null;
	if (!target) return;
	if (target.closest('.hl-shelf-dropdown')) return;
	if (target.closest('.hl-shelf-scope-btn')) return;   // the button itself toggles
	closeShelfDropdown();
}

function onDocKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape') closeShelfDropdown();
}

/**
 * Toggles the shelf dropdown under `anchor`. Rows switch shelves
 * immediately; the last row opens the scope modal (add shelf /
 * manage the folder scope).
 */
export function toggleShelfDropdown(
	anchor: HTMLElement,
	app: App,
	plugin: HiLighterPlugin,
	onChange: () => void,
): void {
	const existing = document.querySelector('.hl-shelf-dropdown');
	const wasOpen = Boolean(existing);
	closeShelfDropdown();
	if (wasOpen) return;

	const menu = document.body.createDiv('hl-shelf-dropdown');

	const shelves = normalizeShelves(plugin.settings.bookshelfShelves);
	const activeId = activeShelfId(
		shelves,
		plugin.settings.bookshelfIncludeFolders,
		plugin.settings.bookshelfExcludeFolders,
	);

	if (shelves.length === 0) {
		menu.createDiv({ cls: 'hl-shelf-dropdown-empty', text: t('bookshelf.shelves.menuEmpty') });
	} else {
		shelves.forEach(shelf => {
			const active = shelf.id === activeId;
			const row = menu.createDiv(`hl-shelf-dropdown-row${active ? ' is-active' : ''}`);
			row.setAttribute('role', 'button');
			row.setAttribute('tabindex', '0');
			setIcon(row.createSpan('hl-shelf-dropdown-icon'), 'library-big');
			row.createSpan({ cls: 'hl-shelf-dropdown-name', text: shelf.name });
			if (active) {
				setIcon(row.createSpan('hl-shelf-dropdown-check'), 'check');
			}
			row.onclick = () => {
				closeShelfDropdown();
				void applyShelf(plugin, shelf, onChange);
			};
			row.onkeydown = (event: KeyboardEvent) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					closeShelfDropdown();
					void applyShelf(plugin, shelf, onChange);
				}
			};
		});
	}

	menu.createDiv('hl-shelf-dropdown-sep');

	const addRow = menu.createDiv('hl-shelf-dropdown-row is-add');
	addRow.setAttribute('role', 'button');
	addRow.setAttribute('tabindex', '0');
	setIcon(addRow.createSpan('hl-shelf-dropdown-icon'), 'plus');
	addRow.createSpan({ cls: 'hl-shelf-dropdown-name', text: t('bookshelf.shelves.add') });
	addRow.onclick = () => {
		closeShelfDropdown();
		new ShelfScopeModal(app, plugin, onChange).open();
	};
	addRow.onkeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			closeShelfDropdown();
			new ShelfScopeModal(app, plugin, onChange).open();
		}
	};

	// Position below the button, clamped to the viewport. Measure after
	// a frame so the menu's own size is final.
	const anchorRect = anchor.getBoundingClientRect();
	menu.setCssProps({
		left: `${Math.max(8, anchorRect.left)}px`,
		top: `${anchorRect.bottom + 6}px`,
		visibility: 'hidden',
	});
	window.setTimeout(() => {
		if (!menu.isConnected) return;
		const width = menu.offsetWidth;
		const height = menu.offsetHeight;
		const viewport = document.documentElement;
		const left = Math.max(8, Math.min(anchorRect.left, viewport.clientWidth - width - 8));
		const top = anchorRect.bottom + 6 + height > viewport.clientHeight
			? Math.max(8, anchorRect.top - height - 6)
			: anchorRect.bottom + 6;
		menu.setCssProps({ left: `${left}px`, top: `${top}px`, visibility: 'visible' });
	}, 0);

	document.addEventListener('pointerdown', onDocPointerDown, true);
	document.addEventListener('keydown', onDocKeydown, true);
}
