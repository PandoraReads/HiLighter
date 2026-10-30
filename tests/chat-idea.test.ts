import { describe, expect, it } from 'vitest';
import { makeChatIdea } from '../src/studio/chat-idea';
import type { HighlightNote } from '../src/models';
const source = (id: string): HighlightNote => ({ id, text: id, note: '', color: 'blue', sourcePath: 'paper.md', lineIndex: 0, createdAt: 1 });
describe('chat idea card', () => {
    it('preserves the response and links each selected source once', () => {
        const card = makeChatIdea('new', '联想卡片', 'answer', [source('a'), source('b'), source('a')], 10);
        expect(card).toMatchObject({ id: 'new', kind: 'idea', title: '联想卡片', note: 'answer', sourceHighlightIds: ['a', 'b'], links: [{ targetId: 'a', relation: 'based_on' }, { targetId: 'b', relation: 'based_on' }], sourcePath: 'paper.md' });
    });
    it('allows a standalone idea when no cards were selected', () => {
        expect(makeChatIdea('new', 'Idea', 'answer', [], 10)).toMatchObject({ kind: 'idea', sourcePath: '', links: [], sourceHighlightIds: [] });
    });
});
