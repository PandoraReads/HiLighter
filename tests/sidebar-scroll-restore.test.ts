import { describe, expect, it } from 'vitest';
import { scrollRestoreDecision } from '../src/studio/sidebar-scroll-restore';

describe('sidebar scroll restoration', () => {
    it('waits for the visible card and enough following content', () => {
        expect(scrollRestoreDecision({ anchorTop: null, offset: 8, previousTop: 900, maxScroll: 300, more: true })).toEqual({ kind: 'load' });
        expect(scrollRestoreDecision({ anchorTop: 900, offset: 8, previousTop: 900, maxScroll: 600, more: true })).toEqual({ kind: 'load' });
    });
    it('restores the card at its original offset once the content is available', () => {
        expect(scrollRestoreDecision({ anchorTop: 920, offset: 20, previousTop: 700, maxScroll: 1200, more: true })).toEqual({ kind: 'restore', top: 900 });
    });
    it('falls back safely when the anchor is absent or near the bottom', () => {
        expect(scrollRestoreDecision({ anchorTop: null, offset: 0, previousTop: 900, maxScroll: 500, more: false })).toEqual({ kind: 'restore', top: 500 });
        expect(scrollRestoreDecision({ anchorTop: 900, offset: 0, previousTop: 900, maxScroll: 500, more: false })).toEqual({ kind: 'restore', top: 500 });
    });
});
