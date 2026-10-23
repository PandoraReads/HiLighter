export function hasNoteModifier(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>): boolean {
    return event.ctrlKey || event.metaKey;
}
