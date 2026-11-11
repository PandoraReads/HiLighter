// ============================================================
// HiLighter - EPUB page-jump menu
// ============================================================
// The # chip dropdown: slider + number input over generated page
// locations. Pure rendering + host callbacks; the reader view owns
// the location generation and jump behavior.

import { t } from '../i18n';

/** Surface the pages menu needs from the hosting reader view. */
export interface EpubPagesMenuHost {
	/** Page-location CFIs for the book (null = not ready yet). */
	ensureLocations(): Promise<string[] | null>;
	/** 0-based location index under the current viewport. */
	currentLocationIndex(): number;
	/** Jump to a 0-based location index (closes the menu itself). */
	jump(index: number): void;
}

/** Renders the page-jump dropdown content into `menu`. */
export function renderEpubPagesMenu(menu: HTMLElement, host: EpubPagesMenuHost): void {
	void host.ensureLocations().then(cfis => {
		menu.empty();
		if (!cfis || cfis.length < 2) {
			menu.createDiv('hl-epub-menu-empty').setText(t('epub.pageGenerating'));
			if (cfis && cfis.length < 2) menu.setText(t('epub.tocEmpty'));
			return;
		}
		const total = cfis.length;
		const current = Math.min(Math.max(host.currentLocationIndex(), 0), total - 1);

		const info = menu.createDiv('hl-epub-pages-info');
		const renderInfo = (idx: number): void => {
			info.setText(t('epub.pageOf', { x: idx + 1, y: total })
				+ ` · ${Math.round((idx / (total - 1)) * 100)}%`);
		};
		renderInfo(current);

		const row = menu.createDiv('hl-epub-pages-row');
		const slider = row.createEl('input', { type: 'range' });
		slider.min = '0';
		slider.max = String(total - 1);
		slider.value = String(current);
		const numInput = row.createEl('input', { type: 'number' });
		numInput.min = '1';
		numInput.max = String(total);
		numInput.value = String(current + 1);
		const goBtn = row.createDiv('hl-epub-pages-go');
		goBtn.setText(t('epub.go'));
		const jump = (): void => {
			const n = Math.min(Math.max(parseInt(numInput.value, 10) || 1, 1), total);
			host.jump(n - 1);
		};
		goBtn.onclick = jump;
		numInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') jump();
		});
		slider.oninput = () => {
			numInput.value = String(parseInt(slider.value, 10) + 1);
			renderInfo(parseInt(slider.value, 10));
		};
	});
	menu.createDiv('hl-epub-menu-empty').setText(t('epub.pageGenerating'));
}
