import { describe, expect, it } from 'vitest';
import { canvasCrop } from '../src/pdf/crop-math';

describe('PDF screenshot crop', () => {
    const canvas = { left: 100, top: 50, right: 500, bottom: 650 };
    it('maps a selected rectangle to device pixel coordinates', () => {
        expect(canvasCrop({ left: 200, top: 150, right: 300, bottom: 250 }, canvas, 800, 1200))
            .toEqual({ x: 200, y: 200, width: 200, height: 200 });
    });
    it('clips selection at the page edge', () => {
        expect(canvasCrop({ left: 50, top: 0, right: 200, bottom: 150 }, canvas, 800, 1200))
            .toEqual({ x: 0, y: 0, width: 200, height: 200 });
    });
    it('rejects empty intersections and unrendered canvases', () => {
        expect(canvasCrop({ left: 0, top: 0, right: 50, bottom: 50 }, canvas, 800, 1200)).toBeNull();
        expect(canvasCrop(canvas, canvas, 0, 1200)).toBeNull();
    });
});
