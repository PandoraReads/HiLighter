import type { HighlightNote } from '../models';
import { cardSearchText } from '../card-templates';

export function searchLinkCandidates(cards: readonly HighlightNote[], currentId: string, query: string): HighlightNote[] {
    const term = query.trim().toLowerCase();
    return term ? cards.filter(card => card.id !== currentId && cardSearchText(card).includes(term)).slice(0, 6) : [];
}
