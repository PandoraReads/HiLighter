import type { HighlightNote } from './models';
import { cardFieldsForTemplate, cardLabel, cardTemplate } from './card-templates';
import { t } from './i18n';

/** Render the method's structure with text nodes, keeping source material safe. */
export function renderCardLayout(parent: HTMLElement, card: HighlightNote): boolean {
    const template = cardTemplate(card);
    if (template.id === 'excerpt') return false;
    const values = cardFieldsForTemplate(card);
    const filled = template.fields.filter(field => values[field.id]?.trim());
    if (filled.length === 0) return false;

    const layout = parent.createDiv(`hl-method-card is-${template.id}`);
    for (const field of filled) {
        const section = layout.createDiv(`hl-method-section field-${field.id}`);
        section.createDiv({ cls: 'hl-method-label', text: cardLabel(field.label) });
        section.createDiv({ cls: 'hl-method-value', text: values[field.id]!.trim() });
    }
    return true;
}

/** Compact hierarchy for method cards in the right sidebar. */
export function renderSidebarCardLayout(parent: HTMLElement, card: HighlightNote): boolean {
    const template = cardTemplate(card);
    if (template.id === 'excerpt') return false;
    const values = cardFieldsForTemplate(card);
    const filled = template.fields.filter(field => values[field.id]?.trim());
    if (filled.length === 0) return false;

    const primary = filled[0]!;
    const panel = parent.createDiv(`hl-sidebar-template-panel is-${template.id}`);
    panel.createDiv({
        cls: 'hl-sidebar-template-heading',
        text: `${cardLabel(template.label)} · ${cardLabel(primary.label)}`,
    });
    panel.createDiv({ cls: 'hl-sidebar-template-primary', text: values[primary.id]!.trim() });

    const secondary = filled.slice(1);
    if (secondary.length > 0) {
        const details = panel.createEl('details', { cls: 'hl-sidebar-template-details' });
        details.onclick = (event) => event.stopPropagation();
        details.createEl('summary', { text: t('card.showMoreFields').replace('{count}', String(secondary.length)) });
        for (const field of secondary) {
            const section = details.createDiv('hl-sidebar-template-field');
            section.createDiv({ cls: 'hl-sidebar-template-label', text: cardLabel(field.label) });
            section.createDiv({ cls: 'hl-sidebar-template-value', text: values[field.id]!.trim() });
        }
    }
    return true;
}
