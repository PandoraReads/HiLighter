// ============================================================
// HiLighter - Click-to-note triggers on markdown views
// ============================================================
// Edit mode: double-click a word, or Cmd/Ctrl+click a word.
// Reading mode: single-click a word (links/headers/code guarded).
// Confirming the popup wraps the clicked word in the source with a
// subtle anchor mark (edit mode) or writes a DB-only anchor (reading
// mode). Both show up in the sidebar note list.

import { MarkdownView, Notice, Platform, TFile, WorkspaceLeaf } from 'obsidian';
import type HiLighterPlugin from '../main';
import type { HighlightNote } from '../models';
import { db } from '../db';
import { t } from '../i18n';
import { randomUUID } from '../mocks/crypto';
import { openNotePopup } from '../note-popup';
import { refreshSidebarViews } from '../studio/actions';
import { getPdfPageNumber } from '../pdf/pdf-anchors';
import { hasNoteModifier } from './gesture';

/** Longest word we will anchor (chars). */
const MAX_WORD_LEN = 40;

/** Targets that must never trigger the popup. */
const BLOCKING_SELECTOR = 'a, code, pre, blockquote cite, .task-list-item-checkbox, img, .hl-note-anchor, mark';

/** Reading-mode single click additionally avoids headings (fold targets). */
const READING_BLOCKING_SELECTOR = BLOCKING_SELECTOR + ', h1, h2, h3, h4, h5, h6';

/** Event targets can be text nodes — normalize to the nearest Element. */
function elementTarget(evt: Event): HTMLElement | null {
    const t = evt.target as Node | null;
    if (t instanceof Element) return t as HTMLElement;
    return t && t.parentElement ? t.parentElement : null;
}

export function registerClickNoteTriggers(plugin: HiLighterPlugin): void {
    if (Platform.isMobile) return;   // no reliable click-word gestures; image-note command still works

    const setupWindow = (win: Window) => {
        const doc = win.document;

        plugin.registerDomEvent(doc, 'dblclick', (evt: MouseEvent) => {
            if (!plugin.settings.notePopup?.doubleClick || !hasNoteModifier(evt)) return;
            const target = elementTarget(evt);
            if (!target || !isMarkdownArea(target)) return;
            handleWordTrigger(plugin, evt, target, 'dblclick');
        });

        plugin.registerDomEvent(doc, 'click', (evt: MouseEvent) => {
            const target = elementTarget(evt);
            if (!target || !isMarkdownArea(target)) return;

            if (hasNoteModifier(evt)) {
                // Cmd/Ctrl+click a word (edit mode); must not fight link clicks
                if (!plugin.settings.notePopup?.modifierClick && !plugin.settings.notePopup?.singleClick) return;
                if (target.closest('a')) return;
                if (target.closest('.markdown-reading-view, .markdown-preview-view')) {
                    if (!plugin.settings.notePopup?.singleClick) return;
                    handleWordTrigger(plugin, evt, target, 'reading-click');
                } else if (plugin.settings.notePopup?.modifierClick) {
                    evt.preventDefault();
                    handleWordTrigger(plugin, evt, target, 'modifier');
                }
                return;
            }
        });
    };

    setupWindow(window);
    plugin.app.workspace.on('window-open', (win) => setupWindow(win as unknown as Window));
}

function isMarkdownArea(target: HTMLElement): boolean {
    if (!target) return false;
    const el = target.closest('.markdown-source-view, .markdown-reading-view, .markdown-preview-view, .pdf-view');
    return el != null;
}

function handleWordTrigger(plugin: HiLighterPlugin, evt: MouseEvent, target: HTMLElement, kind: 'dblclick' | 'modifier' | 'reading-click'): void {
    if (target.closest(kind === 'reading-click' ? READING_BLOCKING_SELECTOR : BLOCKING_SELECTOR)) return;

    const doc = target.ownerDocument || document;
    const sel = doc.getSelection();
    const selText = sel?.toString().trim() ?? '';
    let word = '';

    // Find the leaf + view containing this click
    let leaf: WorkspaceLeaf | null = null;
    plugin.app.workspace.iterateAllLeaves(l => {
        if (l.view.containerEl.contains(target)) leaf = l;
    });
    const view = (leaf as WorkspaceLeaf | null)?.view;
    if (!view) return;

    // PDF leaves: dblclick a textLayer word → DB-only word/image note (pdf + page)
    if (view.getViewType() === 'pdf') {
        if (kind !== 'dblclick') return;
        word = selText;
        if (!word || word.length > MAX_WORD_LEN || /\s/.test(word)) return;
        const pdfFile = (view as unknown as { file?: TFile }).file;
        if (!pdfFile) return;
        const page = getPdfPageNumber(target, view);
        openNotePopup({
            app: plugin.app,
            doc,
            x: evt.clientX,
            y: evt.clientY,
            word,
            sourcePath: pdfFile.path,
            imageFolder: plugin.settings.noteImageFolder,
            onSave: (result) => savePdfWordNote(plugin, pdfFile, word, page, result.note),
        });
        return;
    }

    if (view.getViewType() !== 'markdown') return;
    const mdView = view as MarkdownView;
    const mode = mdView.getMode ? mdView.getMode() : 'source';
    const file = mdView.file;

    if (kind === 'reading-click') {
        // Reading mode: extract the word under the modified click from the DOM
        if (mode !== 'preview') return;
        if (selText) return;
        word = wordFromPoint(doc, evt.clientX, evt.clientY) ?? '';
        if (!word) return;
    } else if (kind === 'dblclick') {
        // The native double-click selected the word already
        word = selText;
        if (!word || word.length > MAX_WORD_LEN || /\s/.test(word)) return;
        // An existing multi-word selection is something else entirely
        if (sel && selText && sel.toString() !== selText) return;
    } else {
        // Cmd/Ctrl+click: extract the word at the click position from the editor line
        if (mode !== 'source') return;   // reading mode uses single-click / dblclick
        const editor = mdView.editor;
        if (!editor) return;
        const pos = posAtCoordsSafe(editor, evt.clientX, evt.clientY);
        if (!pos) return;
        const line = editor.getLine(pos.line) ?? '';
        const span = wordAround(line, pos.ch);
        if (!span || span.text.length > MAX_WORD_LEN) return;
        word = span.text;
        editor.setSelection({ line: pos.line, ch: span.start }, { line: pos.line, ch: span.end });
    }

    if (!file) return;

    openNotePopup({
        app: plugin.app,
        doc,
        x: evt.clientX,
        y: evt.clientY,
        word,
        sourcePath: file.path,
        imageFolder: plugin.settings.noteImageFolder,
        onSave: (result) => saveWordNote(plugin, mdView, file, word, result.note, mode),
    });
}

/** Word under a viewport point in rendered DOM (reading mode / preview). */
function wordFromPoint(doc: Document, x: number, y: number): string | null {
    try {
        let node: Node | null = null;
        let offset = 0;
        // Typed standalone (not intersected with Document) so the deprecated
        // DOM lib symbol for caretRangeFromPoint is not referenced. Chromium
        // exposes caretRangeFromPoint; the standard caretPositionFromPoint is
        // the fallback elsewhere.
        const anyDoc = doc as unknown as {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
            caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        };
        if (typeof anyDoc.caretRangeFromPoint === 'function') {
            const r = anyDoc.caretRangeFromPoint(x, y);
            if (r) { node = r.startContainer; offset = r.startOffset; }
        } else if (typeof anyDoc.caretPositionFromPoint === 'function') {
            const p = anyDoc.caretPositionFromPoint(x, y);
            if (p) { node = p.offsetNode; offset = p.offset; }
        }
        if (!node || node.nodeType !== Node.TEXT_NODE) return null;

        const text = node.textContent ?? '';
        const isWord = (c: string | undefined): boolean => c != null && /[\p{L}\p{N}]/u.test(c);
        if (!isWord(text[offset]) && !isWord(text[offset - 1])) return null;
        let i = offset;
        if (!isWord(text[i])) i -= 1;
        let start = i;
        let end = i;
        while (start > 0 && isWord(text[start - 1])) start--;
        while (end < text.length - 1 && isWord(text[end + 1])) end++;
        const word = text.slice(start, end + 1);
        return word && word.length <= MAX_WORD_LEN ? word : null;
    } catch {
        return null;
    }
}

/** Word/char position inside the editor. */
interface EditorPos { line: number; ch: number }

/**
 * Undocumented but stable editor API: posAtCoords lives on the editor
 * (or its CodeMirror instance). Returns null when unavailable.
 */
function posAtCoordsSafe(editor: unknown, x: number, y: number): EditorPos | null {
    const e = editor as { posAtCoords?: (c: { x: number; y: number }) => EditorPos | null; cm?: { posAtCoords?: (c: { x: number; y: number }) => EditorPos | null } };
    try {
        if (typeof e.posAtCoords === 'function') return e.posAtCoords({ x, y });
        if (typeof e.cm?.posAtCoords === 'function') return e.cm.posAtCoords({ x, y });
    } catch {
        return null;
    }
    return null;
}

/** Contiguous letter/number run (unicode-aware) around index ch.
 *  Returns null when the click landed on punctuation/space with no
 *  word char immediately before it. */
export function wordAround(line: string, ch: number): { text: string; start: number; end: number } | null {
    if (!line) return null;
    const isWord = (c: string | undefined): boolean => c != null && /[\p{L}\p{N}]/u.test(c);

    let i = Math.min(ch, line.length - 1);
    if (i < 0) return null;
    // Clicking just after a word still targets that word
    if (!isWord(line[i]) && !isWord(line[i - 1])) return null;
    if (!isWord(line[i])) i -= 1;

    let start = i;
    while (start > 0 && isWord(line[start - 1])) start--;
    let end = i;
    while (end < line.length - 1 && isWord(line[end + 1])) end++;
    return { text: line.slice(start, end + 1), start, end: end + 1 };
}

async function saveWordNote(
    plugin: HiLighterPlugin,
    mdView: MarkdownView,
    file: TFile,
    word: string,
    note: string,
    mode: 'source' | 'preview',
): Promise<void> {
    if (!note) return;

    const id = randomUUID();
    const editor = mdView.editor;
    let lineIndex = editor ? editor.getCursor('from').line : 0;
    let contextQuote = '';

    try {
        if (mode === 'source' && mdView.editor) {
            // Wrap the selected word with a subtle anchor mark
            const editor = mdView.editor;
            const selected = editor.getSelection();
            const anchorWord = selected || word;
            const anchorTag = `<mark class="hl-note-anchor" data-id="${id}" data-hl-color="">${anchorWord}</mark>`;
            editor.replaceSelection(anchorTag);
            const cursor = editor.getCursor();
            editor.setSelection(cursor, cursor);
        } else {
            // Reading mode: DB-only anchor with a context quote + best-effort line
            contextQuote = await findQuote(plugin, file.path, word);
            lineIndex = 0;
        }

        const entry: HighlightNote = {
            id,
            text: word,
            color: 'yellow',
            note,
            sourcePath: file.path,
            lineIndex,
            createdAt: Date.now(),
            anchorType: 'note',
            ...(contextQuote ? { contextQuote } : {}),
        };
        await db.addHighlightNote(entry);
        refreshSidebarViews(plugin.app);
        new Notice(t('notePopup.saved'));
    } catch {
        new Notice(t('notePopup.saveFailed'));
    }
}

/** Best-effort: locate the word's line in the file for jump support. */
async function findQuote(plugin: HiLighterPlugin, sourcePath: string, word: string): Promise<string> {
    try {
        const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) return '';
        const content = await plugin.app.vault.read(file);
        const idx = content.indexOf(word);
        if (idx === -1) return '';
        const lineStart = content.lastIndexOf('\n', idx) + 1;
        const lineEnd = content.indexOf('\n', idx);
        const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        return line.length > 800 ? line.slice(0, 800) : line;
    } catch {
        return '';
    }
}

/** PDF word note: DB-only anchor (pdf + page). */
async function savePdfWordNote(
    plugin: HiLighterPlugin,
    file: TFile,
    word: string,
    page: number | null,
    note: string,
): Promise<void> {
    if (!note) return;
    try {
        const entry: HighlightNote = {
            id: randomUUID(),
            text: word,
            color: 'yellow',
            note,
            sourcePath: file.path,
            lineIndex: page ?? 0,
            createdAt: Date.now(),
            anchorType: 'pdf',
            ...(page != null ? { pdfPage: page } : {}),
        };
        await db.addHighlightNote(entry);
        refreshSidebarViews(plugin.app);
        new Notice(t('notePopup.saved'));
    } catch {
        new Notice(t('notePopup.saveFailed'));
    }
}

/** Command entry: image-only note anchored to the active file. */
export function openImageNoteCommand(plugin: HiLighterPlugin): void {
    const file = plugin.app.workspace.getActiveFile();
    if (!file) {
        new Notice(t('notePopup.needFile'));
        return;
    }
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const rect = activeView?.contentEl.getBoundingClientRect();
    openNotePopup({
        app: plugin.app,
        doc: document,
        x: rect ? rect.left + rect.width / 2 - 140 : 200,
        y: rect ? rect.top + 120 : 200,
        imageOnly: true,
        sourcePath: file.path,
        imageFolder: plugin.settings.noteImageFolder,
        onSave: (result) => {
            void (async () => {
                if (result.isEmpty) return;
                const entry: HighlightNote = {
                    id: randomUUID(),
                    text: '',
                    color: 'yellow',
                    note: result.note,
                    sourcePath: file.path,
                    lineIndex: 0,
                    createdAt: Date.now(),
                    anchorType: 'note',
                };
                await db.addHighlightNote(entry);
                refreshSidebarViews(plugin.app);
                new Notice(t('notePopup.saved'));
            })();
        },
    });
}
