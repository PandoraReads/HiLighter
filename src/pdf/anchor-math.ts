// ============================================================
// HiLighter - PDF text-anchor math (pure, no DOM/Obsidian)
// ============================================================
// A PDF highlight is anchored by its position inside the pdf.js
// textLayer: page + span index + character offsets. The renderer's
// span layout is stable for the same file+renderer but may shift
// across Obsidian versions, so every anchor carries a `quote`
// (the covered text, whitespace-flattened) that is re-verified at
// paint time; a failed check falls back to text matching.

/** Serializable position anchor for a PDF highlight (models.ts keeps the type). */
export interface PdfTextAnchor {
    page: number;
    startSpan: number;
    startOffset: number;
    endSpan: number;
    endOffset: number;
    quote: string;
}

/** A character range inside one span (end exclusive). */
export interface SpanRange {
    spanIndex: number;
    start: number;
    end: number;
}

/** Flattened page text: spans joined with a single space (paint-order). */
export function flattenSpans(spanTexts: string[]): { flat: string; offsets: Array<{ start: number; end: number }> } {
    let flat = '';
    const offsets: Array<{ start: number; end: number }> = [];
    for (const text of spanTexts) {
        offsets.push({ start: flat.length, end: flat.length + text.length });
        flat += text + ' ';
    }
    return { flat, offsets };
}

const squeeze = (s: string): string => s.replace(/\s+/g, '');
/** Minimum verified characters before an anchor is trusted. */
const MIN_QUOTE_CHECK = 12;

/** The text an anchor covers, rebuilt from the CURRENT span layout. */
function coveredText(spanTexts: string[], anchor: PdfTextAnchor): string | null {
    if (anchor.startSpan < 0 || anchor.endSpan >= spanTexts.length || anchor.startSpan > anchor.endSpan) {
        return null;
    }
    if (anchor.startSpan === anchor.endSpan) {
        if (anchor.startOffset < 0 || anchor.endOffset > (spanTexts[anchor.startSpan] ?? '').length
            || anchor.startOffset > anchor.endOffset) {
            return null;
        }
        return spanTexts[anchor.startSpan]!.slice(anchor.startOffset, anchor.endOffset);
    }
    const first = spanTexts[anchor.startSpan]!.slice(anchor.startOffset);
    const middle = spanTexts.slice(anchor.startSpan + 1, anchor.endSpan).join(' ');
    const last = spanTexts[anchor.endSpan]!.slice(0, anchor.endOffset);
    return `${first} ${middle} ${last}`.replace(/\s+/g, ' ').trim();
}

/**
 * Verifies an anchor against the current span layout by comparing the
 * covered text with the stored quote (whitespace-insensitive prefix check).
 * Tolerates small drift: layout may re-chunk spans, but the TEXT under the
 * anchor must still start with the quote.
 */
export function verifyAnchor(spanTexts: string[], anchor: PdfTextAnchor): boolean {
    const covered = coveredText(spanTexts, anchor);
    if (covered == null) return false;
    const want = squeeze(anchor.quote).slice(0, 40);
    const have = squeeze(covered);
    if (have.length === 0) return false;
    const checkLen = Math.min(want.length, Math.max(MIN_QUOTE_CHECK, Math.floor(want.length / 2)));
    return want.slice(0, checkLen) === have.slice(0, checkLen);
}

/**
 * Expands a verified anchor into per-span character ranges to wrap.
 * Returns null when the anchor does not verify against the current layout
 * (caller falls back to text matching).
 */
export function expandAnchor(spanTexts: string[], anchor: PdfTextAnchor): SpanRange[] | null {
    if (!verifyAnchor(spanTexts, anchor)) return null;
    const ranges: SpanRange[] = [];
    if (anchor.startSpan === anchor.endSpan) {
        ranges.push({ spanIndex: anchor.startSpan, start: anchor.startOffset, end: anchor.endOffset });
        return ranges;
    }
    ranges.push({ spanIndex: anchor.startSpan, start: anchor.startOffset, end: spanTexts[anchor.startSpan]!.length });
    for (let i = anchor.startSpan + 1; i < anchor.endSpan; i++) {
        ranges.push({ spanIndex: i, start: 0, end: spanTexts[i]!.length });
    }
    ranges.push({ spanIndex: anchor.endSpan, start: 0, end: anchor.endOffset });
    return ranges.filter(r => r.end > r.start);
}

/**
 * Text-match fallback: finds the FIRST occurrence of `needle` in the
 * flattened page text that does not overlap `occupied` ranges (anchors of
 * other highlights already painted), so duplicated sentences can each hold
 * their own highlight. Returns an anchor-shaped result or null.
 */
export function matchByText(
    spanTexts: string[],
    needle: string,
    occupied: Array<{ start: number; end: number }>,
): PdfTextAnchor | null {
    const clean = needle.replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const { flat, offsets } = flattenSpans(spanTexts);
    const flatNeedle = clean;
    let from = 0;
    while (true) {
        const idx = flat.indexOf(flatNeedle, from);
        if (idx === -1) return null;
        const end = idx + flatNeedle.length;
        const overlaps = occupied.some(o => idx < o.end && end > o.start);
        if (!overlaps) {
            const startSpan = offsets.findIndex(o => idx >= o.start && idx < o.end);
            const endSpan = offsets.findIndex(o => end > o.start && end <= o.end);
            if (startSpan === -1 || endSpan === -1) return null;
            return {
                page: 0, // caller fills the real page number
                startSpan,
                startOffset: idx - offsets[startSpan]!.start,
                endSpan,
                endOffset: end - offsets[endSpan]!.start,
                quote: clean.slice(0, 80),
            };
        }
        from = idx + 1;
    }
}

/** Builds the stored quote from a span layout + tentative anchor (capture time). */
export function buildQuote(spanTexts: string[], anchor: Omit<PdfTextAnchor, 'quote'> & { quote?: string }): string {
    const covered = coveredText(spanTexts, { ...anchor, quote: '' }) ?? '';
    return covered.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** True when two ranges overlap (used by the paint loop to skip occupied spans). */
export function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
    return a.start < b.end && b.start < a.end;
}
