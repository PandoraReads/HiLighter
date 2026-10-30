// ============================================================
// HiLighter - Text-selection highlight menu
// ============================================================
// Extracted from main.ts. Renders preset + custom color dots and
// an inline "+" affordance to define a new custom color on the spot.

import { App, Notice, Platform, setIcon } from 'obsidian';
import type { HiLighterSettings, HighlightNote } from '../models';
import { getColors } from '../colors';
import { openNotePopup } from '../note-popup';
import { t } from '../i18n';
import { HighlightDetailModal } from '../studio/modals';
import { randomUUID } from '../mocks/crypto';
import { db } from '../db';
import { openLookupPopup } from './lookup-popup';

/** What the menu needs from its hosting plugin. */
export interface SelectionMenuHost {
    app: App;
    settings: HiLighterSettings;
    highlightMenu: HTMLElement | null;
    lastSelection: string;
    lastContext: unknown;
    applyHighlight(text: string, context: unknown, colorId: string, note?: string, draft?: HighlightNote): void | Promise<void>;
    saveSettings(): Promise<void>;
    /** Short AI annotation of the selected text (used to prefill a note). */
    annotateSelection(text: string): Promise<string>;
    startPdfScreenshot(context: unknown): void;
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
    const hasSelection = !!selection.trim();
    getColors(plugin.settings).forEach(c => {
        const dot = colors.createDiv(`hl-h-color-dot ${c.id}`);
        dot.setAttribute('title', c.label);
        if (!hasSelection) { dot.addClass('is-disabled'); dot.setAttribute('aria-disabled', 'true'); }
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
    if (!hasSelection) { noteAction.addClass('is-disabled'); noteAction.setAttribute('aria-disabled', 'true'); noteAction.setAttribute('tabindex', '-1'); }
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
            onEdit: result => {
                const color = getColors(plugin.settings)[0]?.id ?? 'yellow';
                const draft: HighlightNote = { id: randomUUID(), text: selection, note: result.note, color, sourcePath, lineIndex: 0, createdAt: Date.now() };
                new HighlightDetailModal(plugin.app, draft, () => {}, plugin.settings.noteImageFolder,
                    plugin.settings.groupExportFolder || '', true, false, async updated => {
                        await plugin.applyHighlight(selection, context, color, updated.note, updated);
                        if (!await db.getHighlightNote(updated.id)) throw new Error('Card could not be saved');
                    }).open();
            },
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
        if (event.instanceOf(KeyboardEvent) && (event.key === 'Enter' || event.key === ' ')) openNote(event);
    });

    const lookupAction = colors.createEl('button', { cls: 'hl-h-note-action', attr: { type: 'button', 'aria-label': t('lookup.open'), title: t('lookup.open') } });
    setIcon(lookupAction, 'search');
    lookupAction.disabled = !hasSelection;
    lookupAction.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const sourcePath = (context as { sourcePath?: string } | null)?.sourcePath || plugin.app.workspace.getActiveFile()?.path || '';
        if (!sourcePath) { new Notice(t('notePopup.needFile')); return; }
        hideHighlightMenu(plugin);
        openLookupPopup({ doc, x, y: y + 30, text: selection, context: (context as { lineText?: string } | null)?.lineText, onSave: async note => {
            const color = getColors(plugin.settings)[0]?.id ?? 'yellow';
            const draft: HighlightNote = { id: randomUUID(), text: selection, note, color, sourcePath, lineIndex: 0, createdAt: Date.now() };
            await plugin.applyHighlight(selection, context, color, note, draft);
            if (!await db.getHighlightNote(draft.id)) throw new Error('Card could not be saved');
        } });
    };

    const pdfContext = context as { pdfPage?: number; leaf?: { view?: { getViewType(): string } } } | null;
    if (pdfContext?.pdfPage != null || pdfContext?.leaf?.view?.getViewType() === 'pdf') {
        const capture = colors.createEl('button', { cls: 'hl-h-note-action', attr: { 'aria-label': t('pdf.captureCommand'), title: t('pdf.captureCommand') } });
        setIcon(capture, 'scan');
        const start = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            hideHighlightMenu(plugin);
            plugin.startPdfScreenshot(context);
        };
        capture.addEventListener('click', start);
    }

    // AI explain: opens the same note popup, but the note itself is generated
    // by the AI (short annotation) and lands in the textarea for review.
    const aiAction = colors.createDiv('hl-h-note-action hl-h-ai-action');
    setIcon(aiAction, 'sparkles');
    aiAction.setAttribute('role', 'button');
    aiAction.setAttribute('tabindex', '0');
    aiAction.setAttribute('aria-label', t('selectionMenu.aiExplain'));
    aiAction.setAttribute('title', t('selectionMenu.aiExplain'));
    if (!hasSelection) { aiAction.addClass('is-disabled'); aiAction.setAttribute('aria-disabled', 'true'); aiAction.setAttribute('tabindex', '-1'); }
    const openAiNote = (event: Event) => {
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
            aiPending: plugin.annotateSelection(selection),
            onSave: async result => {
                if (result.isEmpty) return;
                const defaultColor = getColors(plugin.settings)[0]?.id ?? 'yellow';
                await plugin.applyHighlight(selection, context, defaultColor, result.note);
            },
        });
    };
    aiAction.addEventListener('mousedown', openAiNote);
    aiAction.addEventListener('touchstart', openAiNote);
    aiAction.addEventListener('keydown', event => {
        if (event.instanceOf(KeyboardEvent) && (event.key === 'Enter' || event.key === ' ')) openAiNote(event);
    });
    colors.insertBefore(aiAction, noteAction.nextSibling);
    colors.appendChild(lookupAction);

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
