export type BatchTagOperation = 'add' | 'remove';

export function normalizeBatchTag(value: string): string {
    return value.trim().replace(/^#+/, '').trim();
}

export function editCardTags(tags: readonly string[], value: string, operation: BatchTagOperation): string[] {
    const tag = normalizeBatchTag(value);
    if (!tag) return [...tags];
    if (operation === 'remove') return tags.filter(existing => existing !== tag);
    return tags.includes(tag) ? [...tags] : [...tags, tag];
}
