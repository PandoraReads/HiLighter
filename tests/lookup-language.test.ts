import { describe, expect, it } from 'vitest';
import { detectLookupLanguage, lookupTarget } from '../src/selection/lookup-language';
describe('lookup languages', () => {
    it('detects common languages using surrounding context', () => {
        expect(detectLookupLanguage('Buch', 'Das ist ein sehr schönes Buch und ich lese es gern.')).toBe('de');
        expect(detectLookupLanguage('hello', 'hello this is a beautiful morning and a lovely day')).toBe('en');
    });
    it('requests manual source selection for ambiguous short words', () => expect(detectLookupLanguage('Haus', '')).toBeNull());
    it('recognizes short Chinese terms without requiring a long context', () => expect(detectLookupLanguage('龘', '')).toBe('zh-CN'));
    it('recognizes supplementary CJK characters', () => expect(detectLookupLanguage('𠀀', '')).toBe('zh-CN'));
    it('maps interface languages to translation target codes', () => {
        expect(lookupTarget('zh')).toBe('zh-CN'); expect(lookupTarget('de')).toBe('de'); expect(lookupTarget('en')).toBe('en');
    });
});
