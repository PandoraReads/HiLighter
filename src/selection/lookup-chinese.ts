export interface ChineseEntry { definitions: string[]; redirect?: string }

/** Extract only the Chinese section of a parsed Wiktionary page. */
export function parseChineseEntry(html: string, parser: Pick<DOMParser, 'parseFromString'> = new DOMParser()): ChineseEntry {
    const doc = parser.parseFromString(html, 'text/html');
    const root = doc.querySelector('.mw-parser-output');
    if (!root) return { definitions: [] };
    let inChinese = false;
    let inDefinitions = false;
    let redirect: string | undefined;
    const definitions: string[] = []; 
    for (const element of Array.from(root.children)) {
        const heading = element.matches('h2,h3,h4,h5') ? element : element.querySelector('h2,h3,h4,h5');
        if (heading?.tagName.toLowerCase() === 'h2') {
            const language = (heading.textContent || '').trim();
            if (inChinese) break;
            inChinese = /^(汉语|漢語|中文)$/.test(language);
            inDefinitions = false;
            continue;
        }
        if (!inChinese) continue;
        const redirectAnchor = element.matches('.zh-see') ? element.querySelector('.Hant a[title]') : element.querySelector('.zh-see .Hant a[title]');
        if (redirectAnchor) redirect = redirectAnchor.getAttribute('title') || undefined;
        if (heading) {
            inDefinitions = /释义|釋義|名词|名詞|动词|動詞|形容词|形容詞|成语|成語|副词|副詞|代词|代詞|介词|介詞|短语|短語|专有名词|專有名詞|汉字|漢字/.test(heading.textContent || '');
            continue;
        }
        if (!inDefinitions) continue;
        const lists = element.matches('ol') ? [element] : Array.from(element.querySelectorAll('ol'));
        for (const list of lists) {
            for (const item of Array.from(list.children)) {
                if (item.tagName.toLowerCase() !== 'li') continue;
                const clone = item.cloneNode(true) as Element;
                clone.querySelectorAll('ul,ol,style,sup').forEach(child => child.remove());
                const value = (clone.textContent || '').replace(/\s+/g, ' ').trim();
                if (value && value.length <= 500 && !definitions.includes(value)) definitions.push(value);
            }
        }
    }
    return { definitions: definitions.slice(0, 6), redirect };
}
