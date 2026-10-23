// ============================================================
// HiLighter - Text-selection highlight menu
// ============================================================
// Extracted from main.ts. Renders preset + custom color dots and
// an inline "+" affordance to define a new custom color on the spot.

import { App, Notice, Platform, setIcon } from 'obsidian';
import type { HiLighterSettings } from '../models';
import { getColors } from '../colors';
import { openNotePopup } from '../note-popup';
import { t } from '../i18n';

/** What the menu needs from its hosting plugin. */
export interface SelectionMenuHost {
    app: App;
    settings: HiLighterSettings;
    highlightMenu: HTMLElement | null;
    lastSelection: string;
    lastContext: unknown;
    applyHighlight(text: string, context: unknown, colorId: string, note?: string): void | Promise<void>;
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

    const noteAction = colors.createDiv('hl-h-note-action');
    setIcon(noteAction, 'notebook-pen');
    noteAction.setAttribute('role', 'button');
    noteAction.setAttribute('tabindex', '0');
    noteAction.setAttribute('aria-label', t('notePopup.title'));
    noteAction.setAttribute('title', t('notePopup.title'));
    const openNote = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourcePath = (context as { sourcePath?: string } | null)?.sourcePath
            || plugin.app.workspace.getActiveFile()?.path || '';
        if (!sourcePath) {
            new Notice(t('notePopup.needFile'));
            return;
        }
        hideHighlightMenu(plugin);
        openNotePopup({
            app: plugin.app,
            doc,
            x,
            y: y + 30,
            word: selection,
            sourcePath,
            imageFolder: plugin.settings.noteImageFolder,
            onSave: async result => {
                if (result.isEmpty) return;
                const defaultColor = getColors(plugin.settings)[0]?.id ?? 'yellow';
                await plugin.applyHighlight(selection, context, defaultColor, result.note);
            },
        });
    };
    noteAction.addEventListener('mousedown', openNote);
    noteAction.addEventListener('touchstart', openNote);
    noteAction.addEventListener('keydown', event => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) openNote(event);
    });

    // Dynamic anchor positioning: coordinates depend on the selection rect.
    menu.setCssProps({
        display: 'flex',
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translateX(-50%)',
    });
}

export function hideHighlightMenu(plugin: SelectionMenuHost): void {
    if (plugin.highlightMenu) plugin.highlightMenu.setCssProps({ display: 'none' });
}
