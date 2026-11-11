import { parseChineseEntry } from './lookup-chinese';

export interface LookupDictionary { phonetic: string; definitions: Array<{ partOfSpeech: string; definition: string }> }
export interface LookupTranslation { source: 'google' | 'mymemory'; text: string }
export interface LookupResult {
    dictionary?: LookupDictionary;
    dictionaryUrl?: string;
    detectedSource?: string;
    /** Every translation source that returned in time, labeled by engine. */
    translations: LookupTranslation[];
    tooLong?: boolean;
    sameLanguage?: boolean;
}
export type LookupRequest = (url: string) => Promise<{ status: number; json: unknown }>;

/** Per-source deadline: slow sources are dropped, never waited on. */
export const LOOKUP_TIMEOUT_MS = 5000;
/** Query byte cap of the narrower provider (MyMemory). */
const QUERY_BYTE_LIMIT = 500;

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** window timer inside Obsidian (popout-safe), global timer under vitest/node. */
const scheduleTimeout: (handler: () => void, ms: number) => unknown =
    typeof window !== 'undefined' ? window.setTimeout : setTimeout;

export async function lookupSelection(
    text: string,
    request: LookupRequest,
    source: string | null = 'en',
    target = 'zh-CN',
    timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<LookupResult> {
    const query = text.trim();
    if (!query) return { translations: [] };
    const word = /^[a-zA-Z]+(?:['’-][a-zA-Z]+)*$/.test(query);
    const chineseWord = /^[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2fa1f}]{1,20}$/u.test(query);
    const result: LookupResult = { translations: [] };
    let effectiveSource = source;

    // Timeout-guarded fetch: resolves null on failure OR when the source
    // is too slow — a missing source is silently skipped, never awaited.
    const fetchJson = (url: string): Promise<{ status: number; json: unknown } | null> =>
        Promise.race([
            request(url).catch(() => null),
            new Promise<null>(resolve => { scheduleTimeout(() => resolve(null), timeoutMs); }),
        ]);

    // Google Translate (unofficial gtx endpoint, no key). `from` null lets
    // Google auto-detect; the detected language comes back as json[2].
    const googleTranslate = async (textToTranslate: string, from: string | null): Promise<{ text: string; detected?: string } | null> => {
        const params = new URLSearchParams({ client: 'gtx', sl: from ?? 'auto', tl: target, dt: 't', q: textToTranslate });
        const response = await fetchJson(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
        if (!response || response.status !== 200 || !Array.isArray(response.json)) return null;
        const segments = (response.json as unknown[])[0];
        if (!Array.isArray(segments)) return null;
        let translated = '';
        for (const segment of segments) {
            if (Array.isArray(segment) && typeof segment[0] === 'string') translated += segment[0];
        }
        translated = translated.trim();
        if (!translated) return null;
        const detectedRaw = (response.json as unknown[])[2];
        const detected = typeof detectedRaw === 'string' && detectedRaw ? detectedRaw : undefined;
        return { text: translated, detected };
    };

    const mymemoryTranslate = async (textToTranslate: string, from: string): Promise<string | null> => {
        const response = await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${encodeURIComponent(`${from}|${target}`)}`);
        const body = object(response?.json);
        const translated = object(body?.responseData)?.translatedText;
        if (!response || response.status !== 200 || body?.responseStatus !== 200) return null;
        return typeof translated === 'string' && translated.trim() ? translated.trim() : null;
    };

    const dictionary = async (): Promise<void> => {
        if (source === 'zh-CN' && chineseWord) {
            try {
                const fetchPage = async (title: string) => {
                    const params = new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1', variant: 'zh-hans' });
                    const response = await fetchJson(`https://zh.wiktionary.org/w/api.php?${params.toString()}`);
                    const body = object(object(response?.json)?.parse);
                    if (!response || response.status !== 200 || typeof body?.text !== 'string') throw new Error('dictionary unavailable');
                    return parseChineseEntry(body.text);
                };
                let entry = await fetchPage(query);
                let title = query;
                if (!entry.definitions.length && entry.redirect && entry.redirect !== query && entry.redirect.length <= 100) {
                    title = entry.redirect;
                    entry = await fetchPage(title);
                }
                if (!entry.definitions.length) return;
                result.dictionary = { phonetic: '', definitions: entry.definitions.map(definition => ({ partOfSpeech: '', definition })) };
                result.dictionaryUrl = `https://zh.wiktionary.org/wiki/${encodeURIComponent(title)}`;
            } catch {
                // dictionary missing → silently omitted
            }
            return;
        }
        if (!word || (source !== null && source !== 'en')) return;
        const response = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
        if (!response || response.status !== 200 || !Array.isArray(response.json)) return;
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
        if (!definitions.length) return;
        result.dictionary = { phonetic, definitions: definitions.slice(0, 6) };
        result.dictionaryUrl = 'https://dictionaryapi.dev/';
        if (!effectiveSource) { effectiveSource = 'en'; result.detectedSource = 'en'; }
    };

    let googleMain: { text: string; detected?: string } | null = null;
    let mymemoryMain: string | null = null;
    const mainTranslate = async (): Promise<void> => {
        if (effectiveSource === target) { result.sameLanguage = true; return; }
        if (new TextEncoder().encode(query).length > QUERY_BYTE_LIMIT) { result.tooLong = true; return; }
        const from = effectiveSource;
        // Both engines race in parallel; whichever returns in time is kept.
        // MyMemory needs an explicit source language, Google can auto-detect.
        const [google, mymemory] = await Promise.all([
            googleTranslate(query, from),
            from === null ? Promise.resolve(null) : mymemoryTranslate(query, from),
        ]);
        googleMain = google;
        mymemoryMain = mymemory;
        if (google) {
            if (!effectiveSource && google.detected) { effectiveSource = google.detected; result.detectedSource = google.detected; }
            result.translations = [...result.translations, { source: 'google', text: google.text }];
        }
        if (mymemory) result.translations = [...result.translations, { source: 'mymemory', text: mymemory }];
    };

    // Dictionary and the translations run in parallel — no source blocks
    // another, and the popup never waits on a missing one.
    await Promise.all([dictionary(), mainTranslate()]);

    const translateDefinitions = async (): Promise<void> => {
        if (!result.dictionary || effectiveSource === target) return;
        const googleEngine = googleMain;
        const mymemorySource = effectiveSource;
        const translateOne = googleEngine
            ? async (textToTranslate: string): Promise<string | null> =>
                (await googleTranslate(textToTranslate, effectiveSource ?? googleEngine.detected ?? 'auto'))?.text ?? null
            : mymemoryMain && mymemorySource
                ? (textToTranslate: string) => mymemoryTranslate(textToTranslate, mymemorySource)
                : null;
        if (!translateOne) return;
        const chineseParts: Record<string, string> = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', pronoun: '代词', preposition: '介词', conjunction: '连词', interjection: '感叹词', exclamation: '感叹词' };
        const definitions = result.dictionary.definitions.slice(0, 3);
        const translated = await Promise.all(definitions.map(async definition => {
            if (new TextEncoder().encode(definition.definition).length > QUERY_BYTE_LIMIT) return definition;
            const text = await translateOne(definition.definition);
            if (text === null) return definition;
            return {
                ...definition,
                partOfSpeech: target === 'zh-CN' ? chineseParts[definition.partOfSpeech.toLowerCase()] ?? definition.partOfSpeech : definition.partOfSpeech,
                definition: text,
            };
        }));
        result.dictionary = { ...result.dictionary, definitions: [...translated, ...result.dictionary.definitions.slice(3)] };
    };
    await translateDefinitions();
    return result;
}
