// ============================================================
// HiLighter - Text-selection highlight menu
// ============================================================
// Extracted from main.ts. Renders preset + custom color dots and
// an inline "+" affordance to define a new custom color on the spot.

import { Platform } from 'obsidian';
import type { HiLighterSettings } from '../models';
import { getColors } from '../colors';

/** What the menu needs from its hosting plugin. */
export interface SelectionMenuHost {
    settings: HiLighterSettings;
    highlightMenu: HTMLElement | null;
    lastSelection: string;
    lastContext: unknown;
    applyHighlight(text: string, context: unknown, colorId: string): void | Promise<void>;
    saveSettings(): Promise<void>;
}

export function showHighlightMenu(
    plugin: SelectionMenuHost,
    selection: string,
    context: unknown,
    x: number,
    y: number,
    doc: Document,
): void {
    plugin.lastSelection = selection;
    plugin.lastContext = context;

    if (plugin.highlightMenu && plugin.highlightMenu.ownerDocument !== doc) {
        plugin.highlightMenu.remove();
        plugin.highlightMenu = null;
    }

    if (!plugin.highlightMenu) {
        plugin.highlightMenu = doc.body.createDiv('hl-highlight-menu');
    }

    const menu = plugin.highlightMenu;
    menu.toggleClass('hl-mobile-menu', Platform.isMobile);
    menu.empty();

    // Color dots only — custom colors are managed in Settings and the
    // sidebar color popover, never inline here (misclicks added junk colors).
    const colors = menu.createDiv('hl-h-menu-colors');
    getColors(plugin.settings).forEach(c => {
        const dot = colors.createDiv(`hl-h-color-dot ${c.id}`);
        dot.setAttribute('title', c.label);
        if (c.isCustom) dot.setAttribute('data-custom', 'true');
        const applyAction = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            if (plugin.lastSelection) {
                void plugin.applyHighlight(plugin.lastSelection, plugin.lastContext, c.id);
            }
            hideHighlightMenu(plugin);
        };
        dot.addEventListener('mousedown', applyAction);
        dot.addEventListener('touchstart', applyAction);
    });

    // Dynamic anchor positioning: coordinates depend on the selection rect.
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    menu.style.display = 'flex';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    menu.style.transform = 'translateX(-50%)';
}

export function hideHighlightMenu(plugin: SelectionMenuHost): void {
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    if (plugin.highlightMenu) plugin.highlightMenu.style.display = 'none';
}
