// ============================================================
// HiLighter - Sentence-level source locating
// ============================================================

import type { Editor } from 'obsidian';

/**
 * Scroll the source note so the `<mark data-id="…">` sentence is visible,
 * without moving the cursor. Keeping the cursor out of the inline HTML tag
 * avoids Live Preview flicking the tag back to its raw source form.
 */
export function locateHighlightMark(editor: Editor, id: string, fallbackLine: number): void {
    const lineCount = editor.lineCount();
    let targetLine = -1;
    for (let i = 0; i < lineCount; i++) {
        if (editor.getLine(i).includes(`data-id="${id}"`)) {
            targetLine = i;
            break;
        }
    }
    if (targetLine === -1) targetLine = fallbackLine;

    const lineText = editor.getLine(targetLine);
    const dataIdPos = lineText.indexOf(`data-id="${id}"`);
    let fromCh = 0;
    let toCh = lineText.length;
    if (dataIdPos !== -1) {
        const markStart = lineText.lastIndexOf('<mark', dataIdPos);
        if (markStart !== -1) fromCh = markStart;
        const markClose = lineText.indexOf('</mark>', dataIdPos);
        if (markClose !== -1) toCh = markClose + '</mark>'.length;
    }

    editor.scrollIntoView({
        from: { line: targetLine, ch: fromCh },
        to: { line: targetLine, ch: toCh },
    }, true);
}
