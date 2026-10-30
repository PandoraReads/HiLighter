import { describe, it, expect } from 'vitest';
import { searchLinkCandidates } from '../src/studio/card-link-search';
import type { HighlightNote } from '../src/models';
const item = (id: string, text: string): HighlightNote => ({ id, text, note: '', color: 'yellow', sourcePath: '', lineIndex: 0, createdAt: 0 });
describe('card link search', () => {
    const cards = [item('a', 'ocean'), item('b', 'Ocean waves'), item('c', 'forest')];
    it('shows nothing until the user types', () => expect(searchLinkCandidates(cards, 'a', '  ')).toEqual([]));
    it('excludes the current card and finds case-insensitive matches', () => expect(searchLinkCandidates(cards, 'a', 'OCEAN').map(card => card.id)).toEqual(['b']));
});
