import { describe, expect, it } from 'vitest';
import { sortArticlePaths } from '../src/studio/article-sort';

describe('article list ordering', () => {
    it('sorts by displayed title instead of folder and orders Chinese by pinyin', () => {
        const paths = ['a/香蕉.md', 'z/苹果.md', 'b/Apple.md', 'a/banana.md', 'z/苹果.md'];
        expect(sortArticlePaths(paths)).toEqual(['z/苹果.md', 'a/香蕉.md', 'b/Apple.md', 'a/banana.md']);
        expect(paths).toHaveLength(5);
    });
    it('orders identical titles by path', () => {
        expect(sortArticlePaths(['z/Title.md', 'a/Title.md'])).toEqual(['a/Title.md', 'z/Title.md']);
    });
});
