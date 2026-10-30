import type { HighlightNote } from '../models';

/** Preserve the cards supplied for the specific response, not the current selection. */
export function makeChatIdea(id: string, title: string, answer: string, sources: readonly HighlightNote[], now: number): HighlightNote {
    const ids = [...new Set(sources.map(card => card.id).filter(sourceId => sourceId && sourceId !== id))];
    return {
        id, kind: 'idea', title, text: '', note: answer, color: sources[0]?.color ?? 'yellow',
        sourcePath: sources[0]?.sourcePath ?? '', lineIndex: 0, createdAt: now, updatedAt: now,
        templateId: 'zettel', sourceHighlightIds: ids, links: ids.map(targetId => ({ targetId, relation: 'based_on' })),
    };
}
