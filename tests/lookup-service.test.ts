import { describe, expect, it, vi } from 'vitest';
import { lookupSelection } from '../src/selection/lookup-service';
import { DOMParser as LinkeDOMParser } from 'linkedom';

describe('dictionary and translation lookup', () => {
    it('looks up Chinese meanings even when the target language is Chinese', async () => {
        vi.stubGlobal('DOMParser', LinkeDOMParser);
        const html = '<div class="mw-parser-output"><h2>汉语</h2><h3>释义</h3><ol><li>龙腾飞的样子</li></ol></div>';
        const request = vi.fn(async () => ({ status: 200, json: { parse: { text: html } } }));
        const result = await lookupSelection('龘', request, 'zh-CN', 'zh-CN');
        expect(result.dictionary?.definitions[0]?.definition).toBe('龙腾飞的样子');
        expect(result.sameLanguage).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });
    it('follows simplified Chinese entries and translates the definition', async () => {
        vi.stubGlobal('DOMParser', LinkeDOMParser);
        const redirect = '<div class="mw-parser-output"><h2>漢語</h2><table class="zh-see"><tr><td><span class="Hant"><a title="畫蛇添足">畫蛇添足</a></span></td></tr></table></div>';
        const entry = '<div class="mw-parser-output"><h2>汉语</h2><h3>成语</h3><ol><li>做多余的事</li></ol></div>';
        const request = vi.fn(async (url: string) => url.includes('wiktionary')
            ? { status: 200, json: { parse: { text: url.includes(encodeURIComponent('畫蛇添足')) ? entry : redirect } } }
            : { status: 200, json: { responseStatus: 200, responseData: { translatedText: 'unnecessary action' } } });
        const result = await lookupSelection('画蛇添足', request, 'zh-CN', 'en');
        expect(result.dictionary?.definitions[0]?.definition).toBe('unnecessary action');
        expect(result.dictionaryUrl).toContain(encodeURIComponent('畫蛇添足'));
        vi.unstubAllGlobals();
    });
    it('translates English dictionary definitions into the target language', async () => {
        const request = vi.fn(async (url: string) => url.includes('dictionaryapi')
            ? { status: 200, json: [{ meanings: [{ definitions: [{ definition: 'a greeting' }] }] }] }
            : { status: 200, json: { responseStatus: 200, responseData: { translatedText: url.includes('a%20greeting') ? '问候语' : '你好' } } });
        const result = await lookupSelection('hello', request, 'en', 'zh-CN');
        expect(result.dictionary?.definitions[0]?.definition).toBe('问候语');
        expect(result.translation).toBe('你好');
    });
    it('looks up an English word and translates it', async () => {
        const request = vi.fn(async (url: string) => url.includes('dictionaryapi')
            ? { status: 200, json: [{ word: 'hello', phonetic: 'həˈləʊ', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'a greeting' }] }] }] }
            : { status: 200, json: { responseStatus: 200, responseData: { translatedText: url.includes('a%20greeting') ? '问候语' : '你好' } } });
        const result = await lookupSelection('hello', request);
        expect(result.translation).toBe('你好');
        expect(result.dictionary?.definitions[0]).toEqual({ partOfSpeech: '名词', definition: '问候语' });
        expect(request).toHaveBeenCalledTimes(3);
    });
    it('translates a sentence without querying the word dictionary', async () => {
        const request = vi.fn(async () => ({ status: 200, json: { responseStatus: 200, responseData: { translatedText: '你好' } } }));
        const result = await lookupSelection('hello world', request);
        expect(result.translation).toBe('你好');
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('preserves dictionary results if translation fails', async () => {
        const request = vi.fn(async (url: string) => {
            if (!url.includes('dictionaryapi')) throw new Error('network');
            return { status: 200, json: [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'greeting' }] }] }] };
        });
        const result = await lookupSelection('hello', request);
        expect(result.dictionary?.definitions[0]?.definition).toBe('greeting');
        expect(result.translationError).toBe(true);
    });
    it('does not send text exceeding translation service byte limit', async () => {
        const request = vi.fn(async () => ({ status: 200, json: {} }));
        const result = await lookupSelection('a '.repeat(300), request);
        expect(result.tooLong).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });
    it('uses the detected source and interface target in the translation request', async () => {
        const request = vi.fn(async (_url: string) => ({ status: 200, json: { responseStatus: 200, responseData: { translatedText: 'Hello' } } }));
        await lookupSelection('Guten Morgen', request, 'de', 'en');
        expect(request.mock.calls[0]![0]).toContain('langpair=de%7Cen');
    });
    it('does not guess a source language when identification is uncertain', async () => {
        const request = vi.fn(async () => ({ status: 200, json: [] }));
        const result = await lookupSelection('some short phrase', request, null, 'zh-CN');
        expect(result.needsSource).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });
});
