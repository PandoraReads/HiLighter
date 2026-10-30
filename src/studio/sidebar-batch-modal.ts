import { App, Modal, Notice, Setting } from 'obsidian';
import { t } from '../i18n';
import { normalizeBatchTag, type BatchTagOperation } from './sidebar-batch-tags';

export class SidebarBatchTagModal extends Modal {
    constructor(app: App, private readonly onSubmit: (tag: string, operation: BatchTagOperation) => void) { super(app); }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl('h3', { text: t('sidebar.batchTags') });
        let operation: BatchTagOperation = 'add';
        new Setting(this.contentEl).setName(t('sidebar.batchTagAction')).addDropdown(dropdown => {
            dropdown.addOption('add', t('sidebar.batchTagAdd'));
            dropdown.addOption('remove', t('sidebar.batchTagRemove'));
            dropdown.setValue(operation);
            dropdown.onChange(value => { operation = value === 'remove' ? 'remove' : 'add'; });
        });
        const input = this.contentEl.createEl('input', { type: 'text', attr: { placeholder: t('modal.batchTag.placeholder'), 'aria-label': t('sidebar.batchTags') } });
        const submit = () => {
            const tag = normalizeBatchTag(input.value);
            if (!tag) { new Notice(t('sidebar.batchTagRequired')); input.focus(); return; }
            this.close();
            this.onSubmit(tag, operation);
        };
        input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit(); } };
        new Setting(this.contentEl).addButton(button => button.setButtonText(t('btn.cancel')).onClick(() => this.close()))
            .addButton(button => button.setButtonText(t('btn.confirm')).setCta().onClick(submit));
        window.setTimeout(() => input.focus(), 0);
    }

    onClose(): void { this.contentEl.empty(); }
}
