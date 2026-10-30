import { describe, expect, it } from 'vitest';
import { dragCardIds, parseDraggedCardIds } from '../src/studio/card-drag-selection';

describe('dragging selected cards', () => {
    it('drags the selection only when the grabbed card is selected', () => {
        expect(dragCardIds('a', new Set(['a', 'b']))).toEqual(['a', 'b']);
        expect(dragCardIds('c', new Set(['a', 'b']))).toEqual(['c']);
    });
    it('validates batch payloads and accepts old single-card drags', () => {
        expect(parseDraggedCardIds('a', '["a","b"]')).toEqual(['a', 'b']);
        expect(parseDraggedCardIds('a', '')).toEqual(['a']);
        expect(parseDraggedCardIds('a', '["b"]')).toEqual([]);
        expect(parseDraggedCardIds('a', '{bad')).toEqual([]);
    });
});
