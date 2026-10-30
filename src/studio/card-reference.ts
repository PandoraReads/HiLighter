import { MarkdownRenderChild, MarkdownRenderer, MarkdownView, Notice, TFile, setIcon, type MarkdownPostProcessorContext } from 'obsidian';
import type HiLighterPlugin from '../main';
import { db } from '../db';
import { cardPreviewMarkdown } from '../card-templates';
import { findReferenceRange, parseCardReference } from './card-reference-format';
import { HighlightDetailModal } from './modals';
import { t } from '../i18n';

class CardReference extends MarkdownRenderChild {
    private generation = 0;
    constructor(container: HTMLElement, private plugin: HiLighterPlugin, private id: string | null, private context: MarkdownPostProcessorContext) { super(container); }
    onload(): void {
        this.register(db.onChange(() => { void this.renderCard(); }));
        void this.renderCard();
    }
    onunload(): void { this.generation++; }
    private async renderCard(): Promise<void> {
        const generation = ++this.generation;
        const card = this.id ? await db.getHighlightNote(this.id) : undefined;
        if (generation !== this.generation) return;
        const root = this.containerEl;
        root.empty();
        root.addClass('hl-embedded-card');
        if (!card) {
            root.createDiv({ cls: 'hl-embedded-card-missing', text: t('card.referenceMissing') });
            return;
        }
        const header = root.createDiv('hl-embedded-card-header');
        header.createSpan({ text: card.title || t('card.excerptHeader') });
        const actions = header.createDiv('hl-embedded-card-actions');
        const edit = actions.createEl('button', { attr: { 'aria-label': t('card.referenceOpen'), title: t('card.referenceOpen') } });
        setIcon(edit, 'external-link');
        edit.onclick = () => new HighlightDetailModal(this.plugin.app, card, () => this.plugin.refreshAllViews(),
            this.plugin.settings.noteImageFolder, this.plugin.settings.groupExportFolder || '').open();
        const remove = actions.createEl('button', { attr: { 'aria-label': t('card.referenceRemove'), title: t('card.referenceRemove') } });
        setIcon(remove, 'trash-2');
        remove.onclick = () => { void this.removeReference(); };
        if (card.text) root.createDiv({ cls: 'hl-embedded-card-quote', text: card.text });
        const content = root.createDiv('hl-embedded-card-content');
        const markdown = cardPreviewMarkdown(card).replace(/(^|\n)(\s*`{3,}|\s*~{3,})hilighter-card\b/gi, '$1$2text');
        if (markdown) await MarkdownRenderer.render(this.plugin.app, markdown, content, card.sourcePath, this);
    }
    private async removeReference(): Promise<void> {
        const section = this.context.getSectionInfo(this.containerEl);
        const file = this.plugin.app.vault.getAbstractFileByPath(this.context.sourcePath);
        if (!section || !this.id || !(file instanceof TFile)) { new Notice(t('card.referenceRemoveFailed')); return; }
        const id = this.id;
        try {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (view?.file?.path === file.path && view.getMode() === 'source') {
                const content = view.editor.getValue();
                const range = findReferenceRange(content, id, section.lineStart);
                if (!range) throw new Error('Stale reference position');
                view.editor.replaceRange('', view.editor.offsetToPos(range.from), view.editor.offsetToPos(range.to));
            } else {
                await this.plugin.app.vault.process(file, content => {
                    const range = findReferenceRange(content, id, section.lineStart);
                    if (!range) throw new Error('Stale reference position');
                    return content.slice(0, range.from) + content.slice(range.to);
                });
            }
        } catch { new Notice(t('card.referenceRemoveFailed')); }
    }
}

export function registerCardReferences(plugin: HiLighterPlugin): void {
    plugin.registerMarkdownCodeBlockProcessor('hilighter-card', (source, el, ctx) => {
        ctx.addChild(new CardReference(el, plugin, parseCardReference(source), ctx));
    });
}
