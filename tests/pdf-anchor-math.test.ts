import { describe, expect, it } from 'vitest';
import {
    buildQuote,
    expandAnchor,
    flattenSpans,
    matchByText,
    verifyAnchor,
    type PdfTextAnchor,
} from '../src/pdf/anchor-math';

// Simulated textLayer spans for one page (paint order).
const SPANS = [
    'The scandal over',
    'Manchester City’s finances',
    'inspires apathy rather',
    'than anger in the stands.',
];

function anchor(overrides: Partial<PdfTextAnchor> = {}): PdfTextAnchor {
    return {
        page: 3,
        startSpan: 1,
        startOffset: 0,
        endSpan: 3,
        endOffset: 11, // "inspires ap"
        quote: 'Manchester City’s finances inspires ap',
        ...overrides,
    };
}

describe('flattenSpans', () => {
    it('joins spans with spaces and records offsets', () => {
        const { flat, offsets } = flattenSpans(['ab', 'cde']);
        expect(flat).toBe('ab cde ');
        expect(offsets).toEqual([
            { start: 0, end: 2 },
            { start: 3, end: 6 },
        ]);
    });

    it('handles an empty page', () => {
        const { flat, offsets } = flattenSpans([]);
        expect(flat).toBe('');
        expect(offsets).toEqual([]);
    });
});

describe('verifyAnchor', () => {
    it('accepts an anchor whose covered text starts with the quote', () => {
        expect(verifyAnchor(SPANS, anchor())).toBe(true);
    });

    it('accepts a same-span anchor', () => {
        const a = anchor({ startSpan: 2, startOffset: 0, endSpan: 2, endOffset: 8, quote: 'inspires' });
        expect(verifyAnchor(SPANS, a)).toBe(true);
    });

    it('rejects when the layout shifted and the text no longer matches', () => {
        const shifted = ['Completely different', 'words here now', 'nothing alike', 'at all.'];
        expect(verifyAnchor(shifted, anchor())).toBe(false);
    });

    it('rejects out-of-bounds anchors', () => {
        expect(verifyAnchor(SPANS, anchor({ startSpan: 9 }))).toBe(false);
        expect(verifyAnchor(SPANS, anchor({ startSpan: 2, endSpan: 1 }))).toBe(false);
        expect(verifyAnchor(SPANS, anchor({ startSpan: 0, startOffset: 99, endSpan: 0, endOffset: 120 }))).toBe(false);
    });

    it('verifies with a short quote when at least the minimum check passes', () => {
        const a = anchor({ quote: 'Manchester' });
        expect(verifyAnchor(SPANS, a)).toBe(true);
    });
});

describe('expandAnchor', () => {
    it('expands a cross-span anchor into full middle spans and trimmed ends', () => {
        const ranges = expandAnchor(SPANS, anchor());
        expect(ranges).toEqual([
            { spanIndex: 1, start: 0, end: 26 },
            { spanIndex: 2, start: 0, end: 22 },
            { spanIndex: 3, start: 0, end: 11 },
        ]);
    });

    it('expands a same-span anchor to one range', () => {
        const a = anchor({ startSpan: 0, startOffset: 4, endSpan: 0, endOffset: 11, quote: 'scandal' });
        expect(expandAnchor(SPANS, a)).toEqual([{ spanIndex: 0, start: 4, end: 11 }]);
    });

    it('returns null for an unverified anchor', () => {
        const shifted = ['x', 'y', 'z', 'w'];
        expect(expandAnchor(shifted, anchor())).toBeNull();
    });

    it('drops empty ranges when offsets meet at span boundaries', () => {
        const a = anchor({ startSpan: 0, startOffset: 0, endSpan: 0, endOffset: 16, quote: 'The scandal over' });
        expect(expandAnchor(SPANS, a)).toEqual([{ spanIndex: 0, start: 0, end: 16 }]);
    });
});

describe('matchByText', () => {
    it('finds the first occurrence and converts it to anchor coordinates', () => {
        const m = matchByText(SPANS, 'inspires apathy', []);
        expect(m).not.toBeNull();
        expect(m!.startSpan).toBe(2);
        expect(m!.startOffset).toBe(0);
        expect(m!.endSpan).toBe(2);
        expect(m!.endOffset).toBe(15);
    });

    it('skips occupied ranges so duplicates each get their own highlight', () => {
        const { flat, offsets } = flattenSpans(['boom boom boom']);
        // First "boom" occupies flat[0..4); the fallback must pick the second.
        const first = { start: 0, end: 4 };
        const m = matchByText(['boom boom boom'], 'boom', [first]);
        expect(m).not.toBeNull();
        const absStart = offsets[m!.startSpan]!.start + m!.startOffset;
        expect(absStart).toBeGreaterThanOrEqual(5);
        void flat;
    });

    it('returns null when every occurrence is occupied or absent', () => {
        expect(matchByText(SPANS, 'quantum entanglement', [])).toBeNull();
        const all = [{ start: 0, end: flattenSpans(SPANS).flat.length }];
        expect(matchByText(SPANS, 'inspires', all)).toBeNull();
    });

    it('normalizes whitespace in the needle', () => {
        const m = matchByText(SPANS, 'Manchester   City’s   finances', []);
        expect(m).not.toBeNull();
        expect(m!.startSpan).toBe(1);
    });
});

describe('buildQuote', () => {
    it('captures the covered text as a flattened quote', () => {
        const quote = buildQuote(SPANS, { ...anchor() });
        expect(quote).toBe('Manchester City’s finances inspires apathy rather than anger');
    });
});
