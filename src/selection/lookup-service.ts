import { parseChineseEntry } from './lookup-chinese';

export interface LookupDictionary { phonetic: string; definitions: Array<{ partOfSpeech: string; definition: string }> }
export interface LookupResult { dictionary?: LookupDictionary; dictionaryUrl?: string; detectedSource?: string; definitionTranslationFailed?: boolean; translation?: string; dictionaryError?: boolean; translationError?: boolean; tooLong?: boolean; needsSource?: boolean; sameLanguage?: boolean }
export type LookupRequest = (url: string) => Promise<{ status: number; json: unknown }>;

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export async function lookupSelection(text: string, request: LookupRequest, source: string | null = 'en', target = 'zh-CN'): Promise<LookupResult> {
    const query = text.trim();
    if (!query) return {};
    const word = /^[a-zA-Z]+(?:['’-][a-zA-Z]+)*$/.test(query);
    const chineseWord = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]{1,20}$/u.test(query);
    const result: LookupResult = {};
    let effectiveSource = source;
    const dictionary = async () => {
        if (source === 'zh-CN' && chineseWord) {
            try {
                const fetchPage = async (title: string) => {
                    const params = new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1', variant: 'zh-hans' });
                    const response = await request(`https://zh.wiktionary.org/w/api.php?${params.toString()}`);
                    const body = object(object(response.json)?.parse);
                    if (response.status !== 200 || typeof body?.text !== 'string') throw new Error('dictionary unavailable');
                    return parseChineseEntry(body.text);
                };
                let entry = await fetchPage(query);
                let title = query;
                if (!entry.definitions.length && entry.redirect && entry.redirect !== query && entry.redirect.length <= 100) {
                    title = entry.redirect;
                    entry = await fetchPage(title);
                }
                if (!entry.definitions.length) throw new Error('entry unavailable');
                result.dictionary = { phonetic: '', definitions: entry.definitions.map(definition => ({ partOfSpeech: '', definition })) };
                result.dictionaryUrl = `https://zh.wiktionary.org/wiki/${encodeURIComponent(title)}`;
            } catch { result.dictionaryError = true; }
            return;
        }
        if (!word || (source !== null && source !== 'en')) return;
        try {
            const response = await request(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
            if (response.status !== 200 || !Array.isArray(response.json)) throw new Error('dictionary unavailable');
            const definitions: LookupDictionary['definitions'] = [];
            let phonetic = '';
            for (const rawEntry of response.json as unknown[]) {
                const entry = object(rawEntry);
                if (!entry) continue;
                if (!phonetic && typeof entry.phonetic === 'string') phonetic = entry.phonetic;
                if (!Array.isArray(entry.meanings)) continue;
                for (const rawMeaning of entry.meanings as unknown[]) {
                    const meaning = object(rawMeaning);
                    if (!meaning || !Array.isArray(meaning.definitions)) continue;
                    for (const rawItem of (meaning.definitions as unknown[]).slice(0, 2)) {
                        const item = object(rawItem);
                        if (typeof item?.definition === 'string') definitions.push({ partOfSpeech: typeof meaning.partOfSpeech === 'string' ? meaning.partOfSpeech : '', definition: item.definition });
                    }
                }
            }
            if (definitions.length) {
                result.dictionary = { phonetic, definitions: definitions.slice(0, 6) };
                result.dictionaryUrl = 'https://dictionaryapi.dev/';
                if (!effectiveSource) { effectiveSource = 'en'; result.detectedSource = 'en'; }
            }
            else result.dictionaryError = true;
        } catch { result.dictionaryError = true; }
    };
    const translateText = async (textToTranslate: string, from: string): Promise<string> => {
            const response = await request(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${encodeURIComponent(`${from}|${target}`)}`);
            const data = response.json as { responseStatus?: number; responseData?: { translatedText?: unknown } };
            if (response.status !== 200 || data?.responseStatus !== 200 || typeof data.responseData?.translatedText !== 'string' || !data.responseData.translatedText.trim()) throw new Error('translation unavailable');
            return data.responseData.translatedText.trim();
    };
    await dictionary();
    const translate = async () => {
        if (!effectiveSource) { result.needsSource = true; return; }
        if (effectiveSource === target) { result.sameLanguage = true; return; }
        if (new TextEncoder().encode(query).length > 500) { result.tooLong = true; return; }
        try {
            result.translation = await translateText(query, effectiveSource);
        } catch { result.translationError = true; }
    };
    const translateDefinitions = async () => {
        if (!result.dictionary || !effectiveSource || effectiveSource === target) return;
        const from = effectiveSource;
        const chineseParts: Record<string, string> = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', pronoun: '代词', preposition: '介词', conjunction: '连词', interjection: '感叹词', exclamation: '感叹词' };
        const definitions = result.dictionary.definitions.slice(0, 3);
        result.dictionary.definitions = await Promise.all(definitions.map(async definition => {
            if (new TextEncoder().encode(definition.definition).length > 500) { result.definitionTranslationFailed = true; return definition; }
            try { return { ...definition, partOfSpeech: target === 'zh-CN' ? chineseParts[definition.partOfSpeech.toLowerCase()] ?? definition.partOfSpeech : definition.partOfSpeech, definition: await translateText(definition.definition, from) }; }
            catch { result.definitionTranslationFailed = true; return definition; }
        }));
    };
    await Promise.all([translate(), translateDefinitions()]);
    return result;
}
