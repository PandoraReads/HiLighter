// ============================================================
// HiLighter - Add-custom-color popover (shared UI)
// ============================================================
// Entry points: the settings manager and the sidebar color-dot
// popover. Deliberately NOT in the text-selection menu (misclicks).

import { Notice } from 'obsidian';
import type { HiLighterSettings } from './models';
import { t } from './i18n';
import { newCustomColorId } from './colors';
import { injectCustomColorStyles } from './appearance';

/** What the popover needs from its host plugin. */
export interface AddColorHost {
    settings: HiLighterSettings;
    saveSettings(): Promise<void>;
    refreshAllViews?(): void;
}

/**
 * Renders an inline add-color form (color picker + name + save) into
 * `container`. Saves the definition, injects the runtime CSS, then
 * calls onAdded with the new color id.
 */
export function renderAddColorForm(
    host: AddColorHost,
    container: HTMLElement,
    doc: Document,
    onAdded: (id: string, hex: string) => void,
): void {
    container.empty();
    container.addClass('hl-add-color-form');

    const row = container.createDiv('hl-add-color-row');
    const colorInput = row.createEl('input', {
        cls: 'hl-add-color-input',
        attr: { type: 'color', value: '#b39ddb' }
    });
    const nameInput = row.createEl('input', {
        cls: 'hl-add-color-name',
        attr: { type: 'text', placeholder: t('colors.namePlaceholder') }
    });
    const saveBtn = row.createEl('button', { cls: 'hl-add-color-save', text: t('btn.save') });

    saveBtn.onclick = () => {
        const hex = colorInput.value || '#b39ddb';
        const id = newCustomColorId();
        host.settings.customColors = [
            ...(host.settings.customColors || []),
            { id, name: nameInput.value.trim(), hex },
        ];
        void (async () => {
            try {
                await host.saveSettings();
                injectCustomColorStyles(doc, host.settings);
                host.refreshAllViews?.();
                new Notice(t('colors.created'));
                onAdded(id, hex);
            } catch {
                new Notice(t('colors.createFailed'));
            }
        })();
    };
}
