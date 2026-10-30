import { describe, expect, it } from 'vitest';
import { wrapCardText } from '../src/studio/xhs-wrap';
const measure = (text: string) => [...text].length;
describe('quote card line wrapping', () => {
    it('wraps English words without cutting ordinary words', () => {
        expect(wrapCardText('Hello beautiful world', 12, measure)).toEqual(['Hello', 'beautiful', 'world']);
    });
    it('keeps apostrophes, punctuation and original paragraph breaks', () => {
        expect(wrapCardText("Don't stop.\n\nKeep going!", 11, measure)).toEqual(["Don't stop.", '', 'Keep going!']);
    });
    it('wraps Chinese and English while splitting only oversized words', () => {
        expect(wrapCardText('你好世界 superlongword', 5, measure)).toEqual(['你好世界', 'super', 'longw', 'ord']);
    });
    it('does not emit a blank line when a single character exceeds the width', () => {
        expect(wrapCardText('ab', 1, () => 2)).toEqual(['a', 'b']);
    });
});
