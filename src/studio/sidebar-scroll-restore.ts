export interface SidebarScrollSnapshot {
    anchorId: string | null;
    offset: number;
    previousTop: number;
}

export function scrollRestoreDecision(input: { anchorTop: number | null; offset: number; previousTop: number; maxScroll: number; more: boolean }): { kind: 'load' } | { kind: 'restore'; top: number } {
    const target = Math.max(0, input.anchorTop === null ? input.previousTop : input.anchorTop - input.offset);
    if (input.more && (input.anchorTop === null || target > input.maxScroll + 1)) return { kind: 'load' };
    return { kind: 'restore', top: Math.min(target, Math.max(0, input.maxScroll)) };
}
