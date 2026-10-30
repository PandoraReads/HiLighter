import { db } from '../db';
import type { CardLink, HighlightNote } from '../models';
import { cardDisplayTitle, cardRelationLabel, incomingLinks, linkCards, unlinkCards } from '../card-templates';
import { HIERARCHY_AFTER, HIERARCHY_PARENT, isAfterRelation, visibleRelation } from './card-hierarchy';
import { searchLinkCandidates } from './card-link-search';
import { t } from '../i18n';

interface RelationOptions {
    card: HighlightNote;
    links: readonly CardLink[];
    sourceIds: readonly string[];
    onChange: (links: CardLink[]) => void;
    onSourcesChange: (sourceIds: string[]) => void;
    onOpen: (card: HighlightNote) => void;
    onDerive?: () => void;
}

/** Search existing cards, label a link, and show outgoing/incoming references. */
export async function renderCardRelations(parent: HTMLElement, options: RelationOptions): Promise<void> {
    const all = await db.getAllHighlights();
    parent.empty();
    parent.addClass('hl-card-relations');
    const header = parent.createDiv('hl-card-relations-header');
    header.createEl('h4', { text: t('card.relations') });
    if (options.onDerive) {
        const derive = header.createEl('button', { cls: 'hl-card-derive-btn', text: t('card.deriveIdea'),
            attr: { title: t('card.deriveIdeaHint') } });
        derive.onclick = options.onDerive;
    }

    let links = [...options.links];
    let sourceIds = [...options.sourceIds];
    const controls = header.createDiv('hl-card-link-controls');
    const searchWrap = controls.createDiv('hl-card-link-search');
    const query = searchWrap.createEl('input', { type: 'search', attr: { placeholder: t('card.searchLink'), 'aria-label': t('card.searchLink') } });
    const suggestions = searchWrap.createDiv('hl-card-link-suggestions');
    const linked = parent.createDiv('hl-card-linked');
    const sourcesEl = parent.createDiv('hl-card-sources');

    const drawLinks = () => {
        linked.empty();
        for (const link of links) {
            const userRelation = visibleRelation(link.relation);
            if (!userRelation) continue;
            const target = all.find(item => item.id === link.targetId);
            const row = linked.createDiv('hl-card-linked-card');
            const open = row.createEl('button', { cls: 'hl-card-linked-open' });
            open.createSpan({ cls: 'hl-card-linked-title', text: target ? cardDisplayTitle(target) : t('card.missing') });
            if (target?.text && target.title) open.createSpan({ cls: 'hl-card-linked-excerpt', text: target.text });
            open.onclick = () => { if (target) options.onOpen(target); };
            const relation = row.createEl('select', { cls: 'hl-card-linked-relation', attr: { 'aria-label': t('card.relationHint') } });
            const relations = ['related', 'supports', 'contradicts', 'extends', 'applies', 'example_of', 'based_on'];
            if (!relations.includes(userRelation)) relation.createEl('option', { value: userRelation, text: cardRelationLabel(userRelation) });
            relations.forEach(value => relation.createEl('option', { value, text: cardRelationLabel(value) }));
            relation.value = userRelation;
            relation.onchange = () => {
                links = links.map(item => item.targetId === link.targetId ? { ...item, relation: isAfterRelation(item.relation) ? `hierarchy_after:${relation.value}` : relation.value } : item);
                options.onChange([...links]);
                if (options.card.kind === 'idea') {
                    sourceIds = relation.value === 'based_on' ? [...new Set([...sourceIds, link.targetId])] : sourceIds.filter(id => id !== link.targetId);
                    options.onSourcesChange([...sourceIds]);
                    drawSources();
                }
            };
            row.createEl('button', { cls: 'hl-card-linked-remove', text: '×', attr: { 'aria-label': t('card.removeLink'), title: t('card.removeLink') } }).onclick = () => {
                links = unlinkCards({ ...options.card, links }, link.targetId).links ?? [];
                options.onChange([...links]);
                if (sourceIds.includes(link.targetId)) {
                    sourceIds = sourceIds.filter(id => id !== link.targetId);
                    options.onSourcesChange([...sourceIds]);
                    drawSources();
                }
                drawLinks();
            };
        }
    };

    const drawSuggestions = () => {
        suggestions.empty();
        const candidates = searchLinkCandidates(all, options.card.id, query.value)
            .filter(item => !links.some(link => link.targetId === item.id && link.relation === HIERARCHY_PARENT));
        candidates
            .slice(0, 6).forEach(item => {
                const row = suggestions.createDiv('hl-card-link-row');
                const button = row.createEl('button', { text: cardDisplayTitle(item) });
                button.onclick = () => {
                    links = linkCards({ ...options.card, links }, item.id, 'related').links ?? [];
                    options.onChange([...links]);
                    query.value = '';
                    drawLinks();
                    drawSuggestions();
                };
                if (options.card.kind === 'idea' && item.kind !== 'idea' && !sourceIds.includes(item.id)) {
                    row.createEl('button', { text: t('card.addSource') }).onclick = () => {
                        sourceIds = [...sourceIds, item.id];
                        links = linkCards({ ...options.card, links }, item.id, 'based_on').links ?? [];
                        options.onSourcesChange([...sourceIds]);
                        options.onChange([...links]);
                        query.value = '';
                        drawLinks();
                        drawSources();
                        drawSuggestions();
                    };
                }
            });
    };
    query.oninput = drawSuggestions;
    query.onkeydown = event => {
        if (event.key !== 'Enter') return;
        const first = suggestions.querySelector('button');
        if (first instanceof HTMLButtonElement) {
            event.preventDefault();
            first.click();
        }
    };
    drawLinks();
    drawSuggestions();

    const inbound = incomingLinks(all, options.card.id);
    if (inbound.length > 0) {
        parent.createEl('h5', { text: t('card.backlinks') });
        inbound.forEach(item => parent.createEl('button', { cls: 'hl-card-backlink', text: cardDisplayTitle(item) })
            .onclick = () => options.onOpen(item));
    }

    const drawSources = () => {
        sourcesEl.empty();
        if (options.card.kind !== 'idea') return;
        sourcesEl.createEl('h5', { text: t('card.sources') });
        sourceIds.forEach(id => {
            const source = all.find(item => item.id === id);
            const row = sourcesEl.createDiv('hl-card-link-row');
            row.createEl('button', { text: source ? cardDisplayTitle(source) : t('card.missing') })
                .onclick = () => { if (source) options.onOpen(source); };
            row.createEl('button', { text: '×', attr: { 'aria-label': t('card.removeSource') } }).onclick = () => {
                sourceIds = sourceIds.filter(value => value !== id);
                links = links.flatMap(link => link.targetId !== id || visibleRelation(link.relation) !== 'based_on'
                    ? [link] : isAfterRelation(link.relation) ? [{ ...link, relation: HIERARCHY_AFTER }] : []);
                options.onSourcesChange([...sourceIds]);
                options.onChange([...links]);
                drawLinks();
                drawSources();
            };
        });
    };
    drawSources();
}
