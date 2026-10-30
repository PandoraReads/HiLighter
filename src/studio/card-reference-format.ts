/** References contain only an ID, so card edits do not rewrite the note. */
export function parseCardReference(source: string): string | null {
    const id = source.trim();
    return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
}

export function cardReferenceMarkdown(id: string): string {
    if (!parseCardReference(id) || id !== id.trim()) throw new Error('Invalid card ID');
    return `\n\n\`\`\`hilighter-card\n${id}\n\`\`\`\n\n`;
}

/** Locate only the exact reference at the rendered section's start line. */
export function findReferenceRange(document: string, id: string, lineStart: number): { from: number; to: number } | null {
    if (!parseCardReference(id) || !Number.isInteger(lineStart) || lineStart < 0) return null;
    const lines = document.split(/\n/);
    let from = 0;
    for (let i = 0; i < lineStart; i++) {
        if (i >= lines.length - 1) return null;
        from += lines[i]!.length + 1;
    }
    if (lines[lineStart]?.trim() !== '```hilighter-card' || lines[lineStart + 1]?.trim() !== id || lines[lineStart + 2]?.trim() !== '```') return null;
    const end = from + lines[lineStart].length + 1 + lines[lineStart + 1]!.length + 1 + lines[lineStart + 2]!.length;
    return { from, to: document[end] === '\n' ? end + 1 : end };
}
