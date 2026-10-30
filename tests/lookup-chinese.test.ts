import { describe, expect, it } from 'vitest';
import { DOMParser as LinkeDOMParser } from 'linkedom';
import { parseChineseEntry } from '../src/selection/lookup-chinese';

const parse = (html: string) => parseChineseEntry(html, new LinkeDOMParser() as unknown as DOMParser);
describe('Chinese dictionary entries', () => {
    it('extracts Chinese definitions without mixing other languages or usage examples', () => {
        const result = parse('<div class="mw-parser-output"><div class="mw-heading"><h2>汉语</h2></div><div class="mw-heading"><h3>释义</h3></div><ol><li>龙腾飞的样子<ul><li>例句</li></ul></li></ol><div class="mw-heading"><h2>日语</h2></div><ol><li>其他语言</li></ol></div>');
        expect(result.definitions).toEqual(['龙腾飞的样子']);
    });
    it('follows a simplified entry to its traditional spelling', () => {
        const result = parse('<div class="mw-parser-output"><div class="mw-heading"><h2>漢語</h2></div><table class="zh-see"><tr><td><span class="Hant"><a title="畫蛇添足">畫蛇添足</a></span></td></tr></table></div>');
        expect(result.redirect).toBe('畫蛇添足');
    });
});
