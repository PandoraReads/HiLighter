import { describe, it, expect } from 'vitest';
import { listKeys, resolveAutoLanguage, setLang, t } from '../src/i18n';

/** Resolve a key's raw template in the given language (placeholders left intact). */
function raw(lang: string, key: string): string {
    setLang(lang);
    return t(key);
}

/** The sorted set of `${name}` placeholders in a template string. */
function placeholdersOf(text: string): string[] {
    const found = text.match(/\$\{(\w+)\}/g) ?? [];
    return found.sort();
}

describe('i18n parity', () => {
    it('zh and en dictionaries declare the same key set', () => {
        const { zh, en } = listKeys();
        expect(new Set(zh)).toEqual(new Set(en));
    });

    it('shared keys use the same placeholders in both languages', () => {
        const { zh } = listKeys();
        const mismatched: string[] = [];

        for (const key of zh) {
            const zhPlaceholders = placeholdersOf(raw('zh', key));
            const enPlaceholders = placeholdersOf(raw('en', key));
            if (JSON.stringify(zhPlaceholders) !== JSON.stringify(enPlaceholders)) {
                mismatched.push(key);
            }
        }

        expect(mismatched).toEqual([]);
    });

    it('partial languages fall back to English for untranslated keys', () => {
        setLang('ja');
        // A key translated in the Japanese partial:
        expect(t('mindmap.viewName')).toBe('マインドマップ');
        // A key NOT in the Japanese partial → English fallback:
        const enText = raw('en', 'sync.import.success');
        expect(t('sync.import.success')).toBe(enText);
    });

    it('unknown languages fall back to English', () => {
        setLang('xx-unknown');
        expect(t('mindmap.viewName')).toBe(raw('en', 'mindmap.viewName'));
    });

    it('resolveAutoLanguage maps Obsidian locales to supported languages', () => {
        expect(resolveAutoLanguage('zh')).toBe('zh');
        expect(resolveAutoLanguage('zh-TW')).toBe('zh');
        expect(resolveAutoLanguage('en-GB')).toBe('en');
        expect(resolveAutoLanguage('ja')).toBe('ja');
        expect(resolveAutoLanguage('pt-BR')).toBe('pt');
        expect(resolveAutoLanguage('zh_CN')).toBe('zh');
        // Unsupported locales → English
        expect(resolveAutoLanguage('th')).toBe('en');
        expect(resolveAutoLanguage('')).toBe('en');
    });
});
