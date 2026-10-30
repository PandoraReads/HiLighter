import { describe, expect, it } from 'vitest';
import type { HighlightNote } from '../src/models';
import {
    CARD_TEMPLATES,
    cardPreviewMarkdown,
    cardSearchText,
    cardTemplate,
    cardTitle,
    cardFieldsForTemplate,
    cardDisplayTitle,
    cardRelationLabel,
    cardRelationMarkdown,
    incomingLinks,
    linkCards,
    relatedCandidates,
    unlinkCards,
} from '../src/card-templates';

const card = (overrides: Partial<HighlightNote> = {}): HighlightNote => ({
    id: 'a', text: 'Quoted source', color: 'yellow', note: '',
    sourcePath: 'reading.md', lineIndex: 0, createdAt: 1, ...overrides,
});

describe('card templates', () => {
    it('preserves sibling ordering when adding or removing a normal card relation', () => {
        const ordered = card({ links: [{ targetId: 'b', relation: 'hierarchy_after' }] });
        const linked = linkCards(ordered, 'b', 'related');
        expect(linked.links).toEqual([{ targetId: 'b', relation: 'hierarchy_after:related' }]);
        expect(unlinkCards(linked, 'b').links).toEqual([{ targetId: 'b', relation: 'hierarchy_after' }]);
        expect(incomingLinks([ordered], 'b')).toEqual([]);
        expect(cardRelationMarkdown(ordered, [])).not.toContain('hierarchy_after');
    });
    it('keeps the instant excerpt and defines purposeful fields for each template', () => {
        expect(CARD_TEMPLATES.map(t => t.id)).toEqual(['excerpt', 'cornell', 'onepage', 'zettel']);
        expect(CARD_TEMPLATES.find(t => t.id === 'cornell')?.fields.map(f => f.id))
            .toEqual(['cue', 'notes', 'summary', 'followup']);
        expect(cardTitle(card())).toBe('Quoted source');
    });

    it('presents structured thoughts without losing the existing freeform note', () => {
        const item = card({ templateId: 'onepage', cardFields: { focus: 'My explanation', example: 'A case' }, note: 'Extra context' });
        expect(cardPreviewMarkdown(item)).toContain('My explanation');
        expect(cardPreviewMarkdown(item)).toContain('A case');
        expect(cardPreviewMarkdown(item)).toContain('Extra context');
        expect(cardSearchText(item)).toContain('my explanation');
    });

    it('uses the idea title and source-independent content for derived cards', () => {
        const item = card({ kind: 'idea', title: 'My thesis', text: '', sourceHighlightIds: ['a'], templateId: 'zettel' });
        expect(cardTitle(item)).toBe('My thesis');
        expect(cardSearchText(item)).toContain('my thesis');
    });

    it('shows the beginning of unnamed long excerpts and a short custom title', () => {
        const long = card({ text: 'A'.repeat(90) });
        expect(cardDisplayTitle(long, 20)).toBe(`${'A'.repeat(20)}…`);
        expect(cardDisplayTitle({ ...long, title: 'Short title' })).toBe('Short title');
    });

    it('maps earlier content-type cards into method layouts without losing filled fields', () => {
        const old = card({ templateId: 'action', cardFields: { next: 'Do it', context: 'At work' } });
        expect(cardTemplate(old).id).toBe('onepage');
        expect(cardFieldsForTemplate(old)).toMatchObject({ application: 'Do it', context: 'At work' });
        expect(cardPreviewMarkdown(old)).toContain('Do it');
    });
});

describe('card relationships', () => {
    it('labels common relationships and retains custom labels', () => {
        expect(cardRelationLabel('supports')).not.toBe('supports');
        expect(cardRelationLabel('my relationship')).toBe('my relationship');
    });
    it('adds one labelled outgoing link and derives the incoming reference', () => {
        const a = card();
        const b = card({ id: 'b', text: 'Another source' });
        const linked = linkCards(a, b.id, 'supports');
        expect(linked.links).toEqual([{ targetId: 'b', relation: 'supports' }]);
        expect(incomingLinks([linked, b], b.id).map(x => x.id)).toEqual(['a']);
        expect(linkCards(linked, b.id, 'extends').links).toEqual([{ targetId: 'b', relation: 'extends' }]);
        expect(unlinkCards(linked, b.id).links).toEqual([]);
        expect(a.links).toBeUndefined();
    });

    it('rejects self links and blank targets', () => {
        const a = card();
        expect(linkCards(a, 'a', 'same')).toEqual(a);
        expect(linkCards(a, ' ', 'same')).toEqual(a);
    });

    it('retains source and relationship identifiers in Markdown exports', () => {
        const source = card({ id: 'source', text: 'Original passage' });
        const idea = card({ id: 'idea', kind: 'idea', title: 'My conclusion', text: '',
            sourceHighlightIds: ['source'], links: [{ targetId: 'source', relation: 'based on' }] });
        const exported = cardRelationMarkdown(idea, [source, idea]);
        expect(exported).toContain('`idea`');
        expect(exported).toContain('Original passage (`source`)');
        expect(exported).toContain('based on → Original passage (`source`)');
    });

    it('suggests nearby cards by shared source and tags without an AI call', () => {
        const current = card({ id: 'current', tags: ['learning'] });
        const sameSource = card({ id: 'same', sourcePath: 'reading.md', createdAt: 2 });
        const sameTag = card({ id: 'tagged', sourcePath: 'other.md', tags: ['learning'], createdAt: 3 });
        const unrelated = card({ id: 'other', sourcePath: 'other.md', createdAt: 4 });
        expect(relatedCandidates(current, [unrelated, sameTag, current, sameSource]).map(item => item.id))
            .toEqual(['tagged', 'same']);
    });
});
