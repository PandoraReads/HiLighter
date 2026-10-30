import { describe, expect, it } from 'vitest';
import { planCardMoves, removeCardParent, setCardParent, orderHierarchy } from '../src/studio/card-hierarchy';
import type { HighlightNote } from '../src/models';
const card = (id: string, parent?: string): HighlightNote => ({ id, text: id, color: 'yellow', note: '', sourcePath: 'a.md', lineIndex: 0, createdAt: 0, links: parent ? [{ targetId: parent, relation: 'hierarchy_parent' }] : [] });
describe('card hierarchy', () => {
    it('orders children after their parents and preserves all cards', () => {
        expect(orderHierarchy([card('c', 'b'), card('a'), card('b', 'a'), card('d')]).map(item => [item.card.id, item.depth])).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 0]]);
    });
    it('moves a card without removing unrelated links', () => {
        const source = { ...card('b'), links: [{ targetId: 'c', relation: 'related' }] };
        expect(setCardParent(source, card('a'), [source, card('a'), card('c')])).toEqual([{ targetId: 'c', relation: 'related' }, { targetId: 'a', relation: 'hierarchy_parent' }]);
    });
    it('rejects cycles, more than three levels, and different sources', () => {
        const a = card('a'), b = card('b', 'a'), c = card('c', 'b'), d = card('d');
        expect(() => setCardParent(a, c, [a, b, c])).toThrow();
        expect(() => setCardParent(d, c, [a, b, c, d])).toThrow();
        expect(() => setCardParent(a, { ...d, sourcePath: 'b.md' }, [a, d])).toThrow();
    });
    it('removes a parent while preserving other card relationships', () => {
        const source = { ...card('b', 'a'), links: [{ targetId: 'a', relation: 'hierarchy_parent' }, { targetId: 'c', relation: 'related' }] };
        expect(removeCardParent(source)).toEqual([{ targetId: 'c', relation: 'related' }]);
        expect(source.links).toHaveLength(2);
    });
    it('moves selected cards together without detaching selected descendants', () => {
        const parent = card('p'), child = card('c', 'p'), sibling = card('s'), target = card('t');
        const plan = planCardMoves([parent, child, sibling, target], ['p', 'c', 's'], 't');
        expect(plan.map(item => item.id)).toEqual(['p', 's']);
        expect(plan.map(item => item.links)).toEqual([[{ targetId: 't', relation: 'hierarchy_parent' }], [{ targetId: 't', relation: 'hierarchy_parent' }]]);
    });
    it('moves groups to the top without losing their descendants', () => {
        const root = card('r'), parent = card('p', 'r'), child = card('c', 'p');
        expect(planCardMoves([root, parent, child], ['p', 'c'], null)).toEqual([{ id: 'p', links: [] }]);
    });
    it('rejects the entire operation for invalid targets or excessive depth', () => {
        const a = card('a'), b = card('b', 'a'), c = card('c', 'b'), d = card('d');
        expect(() => planCardMoves([a, b, c, d], ['a', 'd'], 'c')).toThrow();
        expect(() => planCardMoves([a, b, c, d], ['d', 'missing'], 'a')).toThrow();
        expect(() => planCardMoves([a, b, c, { ...d, sourcePath: 'other.md' }], ['d'], 'a')).toThrow();
    });
    it('places selected cards immediately after the target at the same level', () => {
        const root = card('root'), a = card('a', 'root'), b = card('b', 'root'), x = card('x'), y = card('y');
        const all = [root, a, b, x, y];
        const changes = planCardMoves(all, ['x', 'y'], 'a', 'after');
        const updated = all.map(item => ({ ...item, links: changes.find(change => change.id === item.id)?.links ?? item.links }));
        expect(orderHierarchy(updated).map(item => [item.card.id, item.depth])).toEqual([['root', 0], ['a', 1], ['x', 1], ['y', 1], ['b', 1]]);
    });
    it('preserves an existing relation to the preceding sibling', () => {
        const a = card('a'), b = { ...card('b'), links: [{ targetId: 'a', relation: 'related' }] };
        const changes = planCardMoves([a, b], ['b'], 'a', 'after');
        expect(changes[0]?.links).toContainEqual({ targetId: 'a', relation: 'hierarchy_after:related' });
    });
    it('does not create a cycle when an earlier card moves after its follower', () => {
        const a = card('a'), b = { ...card('b'), links: [{ targetId: 'a', relation: 'hierarchy_after' }] };
        const all = [a, b];
        const changes = planCardMoves(all, ['a'], 'b', 'after');
        const updated = all.map(item => ({ ...item, links: changes.find(change => change.id === item.id)?.links ?? item.links }));
        expect(orderHierarchy(updated).map(item => item.card.id)).toEqual(['b', 'a']);
    });
});
