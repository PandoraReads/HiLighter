const articleCollator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base', numeric: true });

export function sortArticlePaths(paths: readonly string[]): string[] {
    return [...new Set(paths.filter(Boolean))].sort((a, b) => {
        const titleA = a.split('/').pop() || a;
        const titleB = b.split('/').pop() || b;
        return articleCollator.compare(titleA, titleB) || articleCollator.compare(a, b);
    });
}
