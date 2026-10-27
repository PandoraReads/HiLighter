import { db } from '../db';
import type { CardLink, HighlightNote } from '../models';
import { cardDisplayTitle, cardRelationLabel, cardSearchText, incomingLinks, linkCards, relatedCandidates, unlinkCards } from '../card-templates';
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
    const linked = parent.createDiv('hl-card-linked');
    const controls = parent.createDiv('hl-card-link-controls');
    const query = controls.createEl('input', { type: 'search', attr: { placeholder: t('card.searchLink'), 'aria-label': t('card.searchLink') } });
    const relation = controls.createEl('select', { attr: { 'aria-label': t('card.relationHint') } });
    for (const value of ['related', 'supports', 'contradicts', 'extends', 'applies', 'example_of', 'based_on']) {
        relation.createEl('option', { value, text: cardRelationLabel(value) });
    }
    relation.createEl('option', { value: 'custom', text: t('card.customRelation') });
    const customRelation = controls.createEl('input', { type: 'text', attr: { placeholder: t('card.customRelationHint'), 'aria-label': t('card.customRelationHint') } });
    customRelation.hide();
    relation.onchange = () => {
        if (relation.value === 'custom') customRelation.show();
        else customRelation.hide();
    };
    const suggestions = parent.createDiv('hl-card-link-suggestions');
    const sourcesEl = parent.createDiv('hl-card-sources');

    const drawLinks = () => {
        linked.empty();
        for (const link of links) {
            const target = all.find(item => item.id === link.targetId);
            const row = linked.createDiv('hl-card-link-row');
            row.createEl('button', { text: `${target ? cardDisplayTitle(target) : t('card.missing')} · ${cardRelationLabel(link.relation) || t('card.related')}` })
                .onclick = () => { if (target) options.onOpen(target); };
            row.createEl('button', { text: '×', attr: { 'aria-label': t('card.removeLink') } }).onclick = () => {
                links = unlinkCards({ ...options.card, links }, link.targetId).links ?? [];
                options.onChange([...links]);
                drawLinks();
            };
        }
        if (links.length === 0) linked.createSpan({ text: t('card.noLinks'), cls: 'hl-card-muted' });
    };

    const drawSuggestions = () => {
        suggestions.empty();
        const term = query.value.trim().toLowerCase();
        const candidates = term
            ? all.filter(item => item.id !== options.card.id && cardSearchText(item).includes(term))
            : relatedCandidates(options.card, all).filter(item => !links.some(link => link.targetId === item.id));
        candidates
            .slice(0, 6).forEach(item => {
                const row = suggestions.createDiv('hl-card-link-row');
                const button = row.createEl('button', { text: cardDisplayTitle(item) });
                button.onclick = () => {
                    const chosen = relation.value === 'custom' ? customRelation.value.trim() : relation.value;
                    if (!chosen) { customRelation.focus(); return; }
                    links = linkCards({ ...options.card, links }, item.id, chosen).links ?? [];
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
    customRelation.oninput = drawSuggestions;
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
                links = links.filter(link => link.targetId !== id || link.relation !== 'based_on');
                options.onSourcesChange([...sourceIds]);
                options.onChange([...links]);
                drawLinks();
                drawSources();
            };
        });
    };
    drawSources();
}
