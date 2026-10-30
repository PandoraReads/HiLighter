import { describe, expect, it } from 'vitest';
import { mostVisiblePage } from '../src/pdf/visible-page';

describe('visible PDF page', () => {
    const viewport = { top: 100, bottom: 700, left: 0, right: 800 };
    it('selects the rendered page with the largest visible area', () => {
        expect(mostVisiblePage([{ page: 1, rect: { top: -900, bottom: -100, left: 0, right: 600 } }, { page: 8, rect: { top: 150, bottom: 650, left: 0, right: 600 } }, { page: 9, rect: { top: 660, bottom: 1400, left: 0, right: 600 } }], viewport)).toBe(8);
    });
    it('returns null when no rendered page is visible', () => {
        expect(mostVisiblePage([{ page: 1, rect: { top: -900, bottom: -100, left: 0, right: 600 } }], viewport)).toBeNull();
    });
});
