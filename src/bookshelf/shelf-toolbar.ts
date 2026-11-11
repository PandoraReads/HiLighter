// ============================================================
// HiLighter - Bookshelf shared toolbar controls
// ============================================================
// Small selects shared by the 近期阅读 and 书籍 pages: the format
// filter (one setting, applied on both pages) and the recent-page
// sort order.

import { Platform } from 'obsidian';
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

type SelectOption = { id: string; labelKey: string };

function appendSelect(
	plugin: HiLighterPlugin,
	parent: HTMLElement,
	options: SelectOption[],
	value: string,
	apply: (next: string) => Promise<unknown>,
): void {
	const select = parent.createEl('select', {
		cls: 'hl-shelf-select',
		attr: { 'aria-label': t('bookshelf.library.sort.label') },
	});
	options.forEach(option => select.createEl('option', {
		text: t(option.labelKey),
		value: option.id,
	}));
	select.value = value;
	select.onchange = () => {
		void apply(select.value).then(() => plugin.saveSettings());
	};
}

/** Format filter select (shared setting across both grid pages). */
export function appendFormatFilter(
	plugin: HiLighterPlugin,
	parent: HTMLElement,
	onChange: () => void,
): void {
	appendSelect(
		plugin,
		parent,
		FORMAT_OPTIONS,
		plugin.settings.bookshelfFormatFilter || 'all',
		(next) => {
			plugin.settings.bookshelfFormatFilter = next as ShelfFormatFilter;
			onChange();
			return Promise.resolve();
		},
	);
}

/** 近期阅读 sort select. */
export function appendRecentSort(
	plugin: HiLighterPlugin,
	parent: HTMLElement,
	onChange: () => void,
): void {
	appendSelect(
		plugin,
		parent,
		RECENT_SORT_OPTIONS,
		plugin.settings.bookshelfRecentSortBy || 'recent',
		(next) => {
			plugin.settings.bookshelfRecentSortBy = next as ShelfRecentSortBy;
			onChange();
			return Promise.resolve();
		},
	);
}
