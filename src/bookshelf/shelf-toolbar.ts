// ============================================================
// HiLighter - Bookshelf shared toolbar controls
// ============================================================
// Small dropdown selects shared by the 近期阅读 and 书籍 pages: the
// format filter (one setting, applied on both pages) and the
// recent-page sort order. Custom dropdowns, not native <select>:
// OS popups position themselves by their own rules (macOS anchors the
// selected row under the cursor, so the list often opens upward over
// the toolbar) — plugin-rendered menus always drop below.

import { Platform, setIcon } from 'obsidian';
import type HiLighterPlugin from '../main';
import type { ShelfCoverSize, ShelfFormatFilter, ShelfRecentSortBy } from '../models';
import { t } from '../i18n';

/**
 * Effective cover density: phones are locked to large covers (the size
 * toggle is hidden there — two big columns read best on a small screen),
 * other platforms follow the setting.
 */
export function effectiveCoverSize(setting: ShelfCoverSize | undefined): ShelfCoverSize {
	return Platform.isPhone ? 'large' : setting || 'large';
}

const FORMAT_OPTIONS: Array<{ id: ShelfFormatFilter; labelKey: string }> = [
	{ id: 'all', labelKey: 'bookshelf.filter.all' },
	{ id: 'epub', labelKey: 'bookshelf.kind.epub' },
	{ id: 'pdf', labelKey: 'bookshelf.kind.pdf' },
	{ id: 'markdown', labelKey: 'bookshelf.kind.markdown' },
];

const RECENT_SORT_OPTIONS: Array<{ id: ShelfRecentSortBy; labelKey: string }> = [
	{ id: 'recent', labelKey: 'bookshelf.library.sort.recent' },
	{ id: 'count', labelKey: 'bookshelf.recent.sort.count' },
	{ id: 'title', labelKey: 'bookshelf.library.sort.title' },
];

// ── Ghost dropdown select ────────────────────────────────

export interface MenuSelectOption {
	id: string;
	label: string;
}

export interface MenuSelectCtl {
	/** The trigger button (carries data-role hooks when callers need them). */
	trigger: HTMLElement;
	/** Swaps options + shown value in place (no DOM rebuild). */
	refresh(options: MenuSelectOption[], value: string): void;
}

/** Trigger owning the currently open menu, for click-to-toggle. */
let menuSelectOwner: HTMLElement | null = null;

function closeMenuSelect(): void {
	document.querySelectorAll('.hl-shelf-menuselect-menu').forEach(el => el.remove());
	document.removeEventListener('pointerdown', onMenuSelectDocPointerDown, true);
	document.removeEventListener('keydown', onMenuSelectDocKeydown, true);
	menuSelectOwner = null;
}

function onMenuSelectDocPointerDown(event: PointerEvent): void {
	const target = event.target as HTMLElement | null;
	if (target?.closest('.hl-shelf-menuselect-menu, .hl-shelf-menuselect')) return;
	closeMenuSelect();
}

function onMenuSelectDocKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape') closeMenuSelect();
}

/** Opens the option list under `trigger` — below, viewport-clamped. */
function openMenuSelect(
	trigger: HTMLElement,
	options: MenuSelectOption[],
	value: string,
	ariaLabel: string,
	onPick: (id: string) => void,
): void {
	const menu = document.body.createDiv('hl-shelf-dropdown hl-shelf-menuselect-menu');
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('aria-label', ariaLabel);
	options.forEach(option => {
		const active = option.id === value;
		const row = menu.createDiv(`hl-shelf-dropdown-row${active ? ' is-active' : ''}`);
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(active));
		row.setAttribute('tabindex', '0');
		row.createSpan({ cls: 'hl-shelf-dropdown-name', text: option.label });
		if (active) setIcon(row.createSpan('hl-shelf-dropdown-check'), 'check');
		row.onclick = () => {
			closeMenuSelect();
			onPick(option.id);
		};
		row.onkeydown = (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				closeMenuSelect();
				onPick(option.id);
			}
		};
	});

	// Always below the trigger; clamp horizontally into the viewport
	// after a frame so the menu's own size is final.
	const rect = trigger.getBoundingClientRect();
	menu.setCssProps({ left: `${rect.left}px`, top: `${rect.bottom + 6}px`, visibility: 'hidden' });
	window.setTimeout(() => {
		if (!menu.isConnected) return;
		const width = menu.offsetWidth;
		const viewport = document.documentElement;
		const left = Math.max(8, Math.min(rect.left, viewport.clientWidth - width - 8));
		menu.setCssProps({ left: `${left}px`, top: `${rect.bottom + 6}px`, visibility: 'visible' });
	}, 0);

	document.addEventListener('pointerdown', onMenuSelectDocPointerDown, true);
	document.addEventListener('keydown', onMenuSelectDocKeydown, true);
	menuSelectOwner = trigger;
}

/**
 * Ghost dropdown select: a text + chevron trigger opening a
 * plugin-rendered menu that always drops below it (see file header).
 */
export function createMenuSelect(
	parent: HTMLElement,
	ariaLabel: string,
	options: MenuSelectOption[],
	value: string,
	onPick: (id: string) => void,
): MenuSelectCtl {
	const trigger = parent.createEl('button', {
		cls: 'hl-shelf-scope-btn hl-shelf-menuselect',
		attr: { 'aria-label': ariaLabel, title: ariaLabel, 'aria-haspopup': 'listbox' },
	});
	const label = trigger.createSpan({ cls: 'hl-shelf-menuselect-label' });
	setIcon(trigger.createSpan('hl-shelf-menuselect-chev'), 'chevron-down');

	let currentOptions = options;
	let currentValue = value;
	const pick = (id: string): void => {
		currentValue = id;
		ctl.refresh(currentOptions, id);
		onPick(id);
	};
	const ctl: MenuSelectCtl = {
		trigger,
		refresh(nextOptions: MenuSelectOption[], nextValue: string): void {
			currentOptions = nextOptions;
			currentValue = nextValue;
			const match = nextOptions.find(option => option.id === nextValue);
			label.textContent = match?.label ?? nextOptions[0]?.label ?? '';
		},
	};
	ctl.refresh(options, value);

	trigger.onclick = () => {
		if (menuSelectOwner === trigger) {
			closeMenuSelect();
			return;
		}
		closeMenuSelect();
		openMenuSelect(trigger, currentOptions, currentValue, ariaLabel, pick);
	};
	return ctl;
}

/** Format filter select (shared setting across both grid pages). */
export function appendFormatFilter(
	plugin: HiLighterPlugin,
	parent: HTMLElement,
	onChange: () => void,
): void {
	createMenuSelect(
		parent,
		t('bookshelf.filter.label'),
		FORMAT_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) })),
		plugin.settings.bookshelfFormatFilter || 'all',
		(next) => {
			plugin.settings.bookshelfFormatFilter = next as ShelfFormatFilter;
			onChange();
			void plugin.saveSettings();
		},
	);
}

/** 近期阅读 sort select. */
export function appendRecentSort(
	plugin: HiLighterPlugin,
	parent: HTMLElement,
	onChange: () => void,
): void {
	createMenuSelect(
		parent,
		t('bookshelf.library.sort.label'),
		RECENT_SORT_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) })),
		plugin.settings.bookshelfRecentSortBy || 'recent',
		(next) => {
			plugin.settings.bookshelfRecentSortBy = next as ShelfRecentSortBy;
			onChange();
			void plugin.saveSettings();
		},
	);
}
