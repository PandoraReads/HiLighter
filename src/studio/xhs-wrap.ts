/** Wrap Latin words as units and CJK text by character; break oversized words only. */
export function wrapCardText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
    const result: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) { result.push(''); continue; }
        const tokens = raw.match(/[A-Za-z0-9\u00c0-\u024f]+(?:['’-][A-Za-z0-9\u00c0-\u024f]+)*[.,!?;:]?|[^\S\r\n]+|./gu) ?? [];
        let line = '';
        let space = '';
        for (const token of tokens) {
            if (/^\s+$/.test(token)) { space = line ? token : ''; continue; }
            const candidate = line + space + token;
            if (line && measure(candidate) > maxWidth) { result.push(line); line = ''; space = ''; }
            if (measure(line + space + token) <= maxWidth) { line += space + token; space = ''; continue; }
            for (const char of token) {
                if (line && measure(line + char) > maxWidth) { result.push(line); line = ''; }
                line += char;
            }
            space = '';
        }
        if (line) result.push(line);
    }
    return result;
}
