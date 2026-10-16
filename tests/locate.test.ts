import { describe, it, expect } from 'vitest';
import type { Editor } from 'obsidian';
import { locateHighlightMark } from '../src/locate';

interface Cursor {
    line: number;
    ch: number;
}

interface ScrollRange {
    from: Cursor;
    to: Cursor;
}

function fakeEditor(lines: string[]) {
    const state: { cursor: Cursor | null; scroll: ScrollRange | null } = { cursor: null, scroll: null };
    const editor = {
        lineCount: () => lines.length,
        getLine: (i: number) => lines[i] ?? '',
        setCursor: (line: number, ch: number) => { state.cursor = { line, ch }; },
        scrollIntoView: (range: ScrollRange, _center: boolean) => { state.scroll = range; },
    } as unknown as Editor;
    return { editor, state };
}

describe('locateHighlightMark', () => {
    it('scrolls to the mark span without moving the cursor', () => {
        const line = `Some intro text <mark class="hl-highlight" data-id="abc">the sentence</mark> and more`;
        const { editor, state } = fakeEditor([line]);
        const markStart = line.indexOf('<mark');
        const markEnd = line.indexOf('</mark>') + '</mark>'.length;

        locateHighlightMark(editor, 'abc', 0);

        expect(state.cursor).toBeNull(); // never touches the inline HTML tag
        expect(state.scroll).toEqual({
            from: { line: 0, ch: markStart },
            to: { line: 0, ch: markEnd },
        });
    });

    it('falls back to the fallback line when the id is absent', () => {
        const { editor, state } = fakeEditor(['line without the id', 'another line']);

        locateHighlightMark(editor, 'missing', 1);

        expect(state.cursor).toBeNull();
        expect(state.scroll!.from).toEqual({ line: 1, ch: 0 });
        expect(state.scroll!.to).toEqual({ line: 1, ch: 'another line'.length });
    });

    it('finds the correct line when the id appears on a later line', () => {
        const line = '<mark data-id="x">target</mark>';
        const { editor, state } = fakeEditor(['nothing', line]);

        locateHighlightMark(editor, 'x', 0);

        expect(state.cursor).toBeNull();
        expect(state.scroll).toEqual({
            from: { line: 1, ch: 0 },
            to: { line: 1, ch: line.length },
        });
    });

    it('covers the whole mark even when trailing text follows', () => {
        const line = '<mark data-id="short">hi</mark> trailing';
        const { editor, state } = fakeEditor([line]);

        locateHighlightMark(editor, 'short', 0);

        expect(state.scroll!.from.ch).toBe(0);
        expect(state.scroll!.to.ch).toBe(line.indexOf('</mark>') + '</mark>'.length);
    });
});
