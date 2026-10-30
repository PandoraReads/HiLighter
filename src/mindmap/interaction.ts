export type MindMapInteraction = 'select' | 'pan';

export function interactionOptions(mode: MindMapInteraction): { useLeftKeySelectionRightKeyDrag: boolean } {
    return { useLeftKeySelectionRightKeyDrag: mode === 'select' };
}
