import type { CardLink, HighlightNote } from '../models';

export const HIERARCHY_PARENT = 'hierarchy_parent';
export const HIERARCHY_AFTER = 'hierarchy_after';
const AFTER_PREFIX = `${HIERARCHY_AFTER}:`;
export function isAfterRelation(relation: string): boolean { return relation === HIERARCHY_AFTER || relation.startsWith(AFTER_PREFIX); }
export function visibleRelation(relation: string): string | null {
    if (relation === HIERARCHY_PARENT || relation === HIERARCHY_AFTER) return null;
    return relation.startsWith(AFTER_PREFIX) ? relation.slice(AFTER_PREFIX.length) : relation;
}
export function afterId(card: HighlightNote): string | undefined { return card.links?.find(link => isAfterRelation(link.relation))?.targetId; }
export function removeCardOrder(card: HighlightNote): CardLink[] {
    return (card.links ?? []).flatMap(link => {
        if (!isAfterRelation(link.relation)) return [link];
        const relation = visibleRelation(link.relation);
        return relation ? [{ ...link, relation }] : [];
    });
}
function placeAfter(card: HighlightNote, targetId: string): CardLink[] {
    const links = removeCardOrder(card);
    const existing = links.find(link => link.targetId === targetId);
    if (existing?.relation === HIERARCHY_PARENT) throw new Error('invalid order');
    const relation = existing ? `${AFTER_PREFIX}${existing.relation}` : HIERARCHY_AFTER;
    if (relation.length > 120) throw new Error('relation too long');
    return [...links.filter(link => link.targetId !== targetId), { targetId, relation }];
}
export function parentId(card: HighlightNote): string | undefined {
    return card.links?.find(link => link.relation === HIERARCHY_PARENT)?.targetId;
}

export function removeCardParent(card: HighlightNote): CardLink[] {
    return (card.links ?? []).filter(link => link.relation !== HIERARCHY_PARENT);
}

export function setCardParent(card: HighlightNote, parent: HighlightNote, cards: readonly HighlightNote[]): CardLink[] {
    if (card.id === parent.id || !card.sourcePath || card.sourcePath !== parent.sourcePath) throw new Error('invalid parent');
    const byId = new Map(cards.map(item => [item.id, item]));
    let depth = 1;
    let cursor: HighlightNote | undefined = parent;
    const visited = new Set<string>();
    while (cursor) {
        if (cursor.id === card.id || visited.has(cursor.id)) throw new Error('cycle');
        visited.add(cursor.id);
        const id = parentId(cursor);
        cursor = id ? byId.get(id) : undefined;
        if (cursor) depth += 1;
    }
    const subtreeDepth = (id: string, seen: Set<string>): number => {
        if (seen.has(id)) throw new Error('cycle');
        const next = new Set([...seen, id]);
        const children = cards.filter(item => parentId(item) === id);
        return children.length ? 1 + Math.max(...children.map(child => subtreeDepth(child.id, next))) : 0;
    };
    if (depth + subtreeDepth(card.id, new Set()) > 2) throw new Error('depth');
    return [...(card.links ?? []).filter(link => link.relation !== HIERARCHY_PARENT && link.targetId !== parent.id), { targetId: parent.id, relation: HIERARCHY_PARENT }];
}

export function planCardMoves(cards: readonly HighlightNote[], ids: readonly string[], targetId: string | null, placement: 'child' | 'after' = 'child'): Array<{ id: string; links: CardLink[] }> {
    const selected = new Set(ids);
    if (!selected.size || selected.size > 1000 || [...selected].some(id => typeof id !== 'string' || !id || id.length > 128)) throw new Error('invalid selection');
    const byId = new Map(cards.map(card => [card.id, card]));
    if ([...selected].some(id => !byId.has(id))) throw new Error('missing card');
    const target = targetId === null ? null : byId.get(targetId);
    if (targetId !== null && (!target || selected.has(targetId))) throw new Error('invalid target');
    const roots = cards.filter(card => {
        if (!selected.has(card.id)) return false;
        const visited = new Set<string>([card.id]);
        let current = parentId(card);
        while (current) {
            if (selected.has(current)) return false;
            if (visited.has(current)) throw new Error('cycle');
            visited.add(current);
            const ancestor = byId.get(current);
            current = ancestor ? parentId(ancestor) : undefined;
        }
        return true;
    });
    if (!roots.length) throw new Error('invalid selection');
    const moving = new Set(roots.map(card => card.id));
    const updates = new Map<string, CardLink[]>();
    let previous = target?.id;
    for (const card of roots) {
        let working = { ...card, links: removeCardOrder(card) };
        if (target && placement === 'after') {
            if (!card.sourcePath || card.sourcePath !== target.sourcePath) throw new Error('different source');
            const parent = parentId(target);
            const parentCard = parent ? byId.get(parent) : undefined;
            if (parent && !parentCard) throw new Error('missing parent');
            working = { ...working, links: parentCard ? setCardParent(working, parentCard, cards) : removeCardParent(working) };
            working = { ...working, links: placeAfter(working, previous!) };
            previous = card.id;
        } else {
            working = { ...working, links: target ? setCardParent(working, target, cards) : removeCardParent(working) };
        }
        updates.set(card.id, working.links);
    }
    const changedRoots = new Set(roots.filter(card => JSON.stringify(updates.get(card.id)) !== JSON.stringify(card.links ?? [])).map(card => card.id));
    for (const card of cards) {
        if (!moving.has(card.id) && changedRoots.has(afterId(card) ?? '')) updates.set(card.id, removeCardOrder(card));
    }
    return [...updates].map(([id, links]) => ({ id, links }))
        .filter(change => JSON.stringify(change.links) !== JSON.stringify(byId.get(change.id)?.links ?? []));
}

function orderSiblings(cards: readonly HighlightNote[]): HighlightNote[] {
    const byId = new Map(cards.map(card => [card.id, card]));
    const followers = new Map<string, HighlightNote[]>();
    for (const card of cards) {
        const previous = afterId(card);
        if (previous && previous !== card.id && byId.has(previous)) followers.set(previous, [...(followers.get(previous) ?? []), card]);
    }
    followers.forEach(list => list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
    const result: HighlightNote[] = [];
    const visited = new Set<string>();
    const visit = (card: HighlightNote) => {
        if (visited.has(card.id)) return;
        visited.add(card.id); result.push(card);
        (followers.get(card.id) ?? []).forEach(visit);
    };
    cards.filter(card => !afterId(card) || !byId.has(afterId(card)!)).forEach(visit);
    cards.forEach(visit);
    return result;
}

export function orderHierarchy(cards: readonly HighlightNote[]): Array<{ card: HighlightNote; depth: number }> {
    const byId = new Map(cards.map(card => [card.id, card]));
    const children = new Map<string, HighlightNote[]>();
    const roots: HighlightNote[] = [];
    for (const card of cards) {
        const parent = parentId(card);
        if (!parent || parent === card.id || !byId.has(parent)) roots.push(card);
        else children.set(parent, [...(children.get(parent) ?? []), card]);
    }
    const ordered: Array<{ card: HighlightNote; depth: number }> = [];
    const visited = new Set<string>();
    const visit = (card: HighlightNote, depth: number) => {
        if (visited.has(card.id)) return;
        visited.add(card.id);
        ordered.push({ card, depth });
        for (const child of orderSiblings(children.get(card.id) ?? [])) visit(child, Math.min(depth + 1, 2));
    };
    orderSiblings(roots).forEach(card => visit(card, 0));
    cards.forEach(card => visit(card, 0));
    return ordered;
}

