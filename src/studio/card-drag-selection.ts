export const CARD_DRAG_MIME = 'application/x-hilighter-card-id';
export const CARD_DRAG_BATCH_MIME = 'application/x-hilighter-card-ids';

export function dragCardIds(grabbedId: string, selected: ReadonlySet<string>): string[] {
    return selected.has(grabbedId) ? [...selected] : [grabbedId];
}

export function parseDraggedCardIds(grabbedId: string, payload: string): string[] {
    if (!grabbedId || grabbedId.length > 128) return [];
    if (!payload) return [grabbedId];
    if (payload.length > 140_000) return [];
    try {
        const ids: unknown = JSON.parse(payload);
        if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !id || id.length > 128) || !ids.includes(grabbedId)) return [];
        return [...new Set(ids as string[])];
    } catch { return []; }
}
