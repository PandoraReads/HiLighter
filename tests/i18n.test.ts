import { describe, it, expect } from 'vitest';
import { listKeys, setLang, t } from '../src/i18n';

/** Resolve a key's raw template in the given language (placeholders left intact). */
function raw(lang: 'zh' | 'en', key: string): string {
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
});
