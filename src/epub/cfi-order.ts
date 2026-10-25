// ============================================================
// HiLighter - EPUB CFI ordering
// ============================================================
// Orders CFI anchors by (spine item, in-document path, char offsets)
// so highlight cards can follow the book's reading order.

/** Numeric sort key for a CFI: [spineIndex, ...pathSteps, step, charOffset]. */
function cfiKey(cfi: string): number[] {
    const open = cfi.indexOf('(');
    const close = cfi.lastIndexOf(')');
    const inner = open >= 0 && close > open ? cfi.slice(open + 1, close) : cfi;

    const bang = inner.indexOf('!');
    const spinePart = bang >= 0 ? inner.slice(0, bang) : inner;
    const tail = bang >= 0 ? inner.slice(bang + 1) : '';

    // "epubcfi(/6/4!/...)": the number after /6 is 2*(spineIndex+1)
    const spineSegs = spinePart.split('/').map(Number).filter(Number.isFinite);
    const refSeg = spineSegs.length >= 2 ? spineSegs[1] ?? NaN : NaN;
    const spineIdx = Number.isFinite(refSeg) ? Math.round(refSeg / 2) - 1 : -1;

    const nums: number[] = [spineIdx];

    // In-document steps: "/4/2[SomeId]/6" → 4, 2, 6 (id refs ignored)
    const comma = tail.indexOf(',');
    const pathPart = comma >= 0 ? tail.slice(0, comma) : tail;
    for (const seg of pathPart.split('/')) {
        const m = seg.match(/^(\d+)/);
        if (m) nums.push(parseInt(m[1] ?? '0', 10));
    }

    // Character offsets after the comma: "/1:5" → step 1, offset 5
    const rangePart = comma >= 0 ? tail.slice(comma + 1) : '';
    const rm = rangePart.match(/^\/?(\d+):(\d+)/);
    if (rm) {
        nums.push(parseInt(rm[1] ?? '0', 10), parseInt(rm[2] ?? '0', 10));
    }
    return nums;
}

function compareKeys(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
    }
    return a.length - b.length;
}

/**
 * Orders two EPUB CFI strings by document position (ascending).
 * Empty/unparseable CFIs sort last; equal keys return 0 so callers can
 * fall back to createdAt.
 */
export function compareEpubCfi(a: string, b: string): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return compareKeys(cfiKey(a), cfiKey(b));
}
