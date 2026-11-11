import { Notice, requestUrl, setIcon } from 'obsidian';
import { getLang, t } from '../i18n';
import { lookupSelection } from './lookup-service';
import { detectLookupLanguage, lookupTarget } from './lookup-language';
import { selectLocalVoice } from './lookup-speech';

const GOOGLE_TRANSLATE_URL = 'https://translate.google.com/';

export function openLookupPopup(options: { doc: Document; x: number; y: number; text: string; context?: string; onSave: (note: string) => Promise<void> }): void {
    const { doc, text } = options;
    doc.querySelectorAll('.hl-lookup-popup').forEach(element => element.remove());
    const popup = doc.body.createDiv('hl-lookup-popup');
    const header = popup.createDiv('hl-lookup-header');
    const word = header.createDiv('hl-lookup-word');
    word.createDiv({ cls: 'hl-lookup-title', text });
    const speak = word.createEl('button', { cls: 'hl-lookup-speak', attr: { type: 'button', 'aria-label': t('lookup.speak'), title: t('lookup.speak') } });
    setIcon(speak, 'volume-2');
    const closeButton = header.createEl('button', { text: '×', attr: { 'aria-label': t('btn.cancel') } });
    let language = detectLookupLanguage(text, options.context || '');
    speak.onclick = () => {
        if (!language) { new Notice(t('lookup.languageUnknown')); return; }
        const win = doc.defaultView;
        const synthesis = win?.speechSynthesis;
        if (!win || !synthesis || !win.SpeechSynthesisUtterance) { new Notice(t('lookup.speechUnavailable')); return; }
        const voice = selectLocalVoice(synthesis.getVoices(), language);
        if (!voice) { new Notice(t('lookup.speechUnavailable')); return; }
        try {
            const utterance = new win.SpeechSynthesisUtterance(text);
            utterance.lang = language;
            utterance.voice = voice;
            utterance.onerror = () => new Notice(t('lookup.speechFailed'));
            synthesis.speak(utterance);
        } catch { new Notice(t('lookup.speechFailed')); }
    };
    const target = lookupTarget(getLang());
    const result = popup.createDiv('hl-lookup-result');
    result.createDiv({ text: t('lookup.loading') });
    const attribution = popup.createDiv({ cls: 'hl-lookup-attribution', text: t('lookup.providers') });
    const actions = popup.createDiv('hl-lookup-actions');
    const cancel = actions.createEl('button', { text: t('btn.cancel') });
    const save = actions.createEl('button', { text: t('notePopup.save'), cls: 'mod-cta' });
    save.disabled = true;
    let savedText = '';
    let busy = false;
    const close = () => { doc.removeEventListener('keydown', keydown, true); popup.remove(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    doc.addEventListener('keydown', keydown, true);
    closeButton.onclick = close;
    cancel.onclick = close;
    save.onclick = () => {
        if (busy || !savedText) return;
        busy = true; save.disabled = true;
        void options.onSave(savedText).then(close).catch(() => { busy = false; save.disabled = false; new Notice(t('notePopup.saveFailed')); });
    };
    popup.setCssProps({ left: `${Math.max(12, Math.min(options.x, (doc.defaultView?.innerWidth ?? 800) - 360))}px`, top: `${Math.max(12, Math.min(options.y, (doc.defaultView?.innerHeight ?? 600) - 300))}px` });
    let generation = 0;
    const run = () => {
    const currentGeneration = ++generation;
    result.setText(t('lookup.loading'));
    savedText = ''; save.disabled = true;
    void lookupSelection(text, async url => {
        const response = await requestUrl({ url, method: 'GET', throw: false });
        return { status: response.status, json: response.json as unknown };
    }, language, target).then(data => {
        if (!popup.isConnected || generation !== currentGeneration) return;
        language = data.detectedSource ?? language;
        result.empty();
        const sections: string[] = [];
        if (data.dictionary) {
            const dictSection = result.createDiv('hl-lookup-section');
            dictSection.createDiv({ cls: 'hl-lookup-label', text: t('lookup.dictionary') });
            if (data.dictionary.phonetic) dictSection.createDiv({ cls: 'hl-lookup-phonetic', text: data.dictionary.phonetic });
            const lines = data.dictionary.definitions.map(item => `${item.partOfSpeech ? `${item.partOfSpeech}: ` : ''}${item.definition}`);
            lines.forEach(line => dictSection.createDiv({ cls: 'hl-lookup-definition', text: line }));
            sections.push(`**${t('lookup.dictionary')}**${data.dictionary.phonetic ? ` ${data.dictionary.phonetic}` : ''}\n${lines.map(line => `- ${line}`).join('\n')}`);
        }
        for (const translation of data.translations) {
            const sourceLabel = translation.source === 'google' ? t('lookup.google') : 'MyMemory';
            const translationSection = result.createDiv('hl-lookup-section');
            translationSection.createDiv({ cls: 'hl-lookup-label', text: `${t('lookup.translation')} · ${sourceLabel}` });
            translationSection.createDiv({ cls: 'hl-lookup-translation', text: translation.text });
            sections.push(`**${t('lookup.translation')} · ${sourceLabel}**\n${translation.text}`);
        }
        if (data.tooLong) result.createDiv({ cls: 'hl-lookup-status', text: t('lookup.tooLong') });
        if (data.sameLanguage) result.createDiv({ cls: 'hl-lookup-status', text: t('lookup.sameLanguage') });
        // Failed/slow sources (dictionary or either translation engine) are
        // silently omitted — only what returned in time is displayed.
        const sourceLinks = data.translations.map(translation => translation.source === 'google'
            ? `[${t('lookup.google')}](${GOOGLE_TRANSLATE_URL})`
            : '[MyMemory](https://mymemory.translated.net/)');
        const sources = [
            data.dictionaryUrl ? `[${t('lookup.dictionarySource')}](${data.dictionaryUrl})` : '',
            ...sourceLinks,
        ].filter(Boolean).join(' · ');
        savedText = sections.length ? [...sections, sources].filter(Boolean).join('\n\n') : '';
        save.disabled = !savedText;
        attribution.empty();
        if (data.dictionaryUrl) attribution.createEl('a', { text: t('lookup.dictionarySource'), href: data.dictionaryUrl });
        data.translations.forEach((translation, index) => {
            if (index > 0 || data.dictionaryUrl) attribution.createSpan({ text: ' · ' });
            attribution.createEl('a', {
                text: translation.source === 'google' ? t('lookup.google') : 'MyMemory',
                href: translation.source === 'google' ? GOOGLE_TRANSLATE_URL : 'https://mymemory.translated.net/',
            });
        });
        attribution.toggleClass('is-hidden', !savedText);
    }).catch(() => {
        if (popup.isConnected && generation === currentGeneration) { result.setText(t('lookup.failed')); save.disabled = true; }
    });
    };
    run();
}
