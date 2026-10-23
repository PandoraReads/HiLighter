// Visual fixture: production class names and CSS, local demonstration data only.
const studio = document.querySelector('#studio');
const collection = document.querySelector('#collection');
const themes = {
    editorial: ['Editorial / 编辑风', '暖灰纸面、墨绿细节、衬线摘录'],
    native: ['Native / 原生秩序', '平整表面、细线边界、跟随 Obsidian 字体'],
    paper: ['Paper / 书桌便笺', '淡横纹、叠纸边缘、铅笔棕'],
    ocean: ['Ocean / 潮汐玻璃', '冷青灰、清透高光、柔和浮起'],
    forest: ['Forest / 林间书页', '苔绿与亚麻、克制的非对称圆角'],
    galaxy: ['Galaxy / 夜色矿石', '烟紫灰、矿石光泽、深色层次'],
    cyber: ['Cyber / 精密仪表', '直角、细网格、等宽信息标记'],
    sunset: ['Sunset / 暮色陶土', '赤陶与奶油、折角轮廓、暖影'],
    rose: ['Rose / 玫瑰瓷釉', '灰粉瓷面、细微高光、柔和边界'],
};
const notes = [
    { text: 'take something for granted', note: '想当然地认为某事理所应当。记录原文中的语境，比孤立地记住中文释义更有用。', color: 'yellow', mark: '#c6a15c', kind: '词汇', status: 'due', label: '今天到期', source: '英语阅读笔记', tag: '表达' },
    { text: 'We notice what we learn to see.', note: '注意力也需要练习。带着问题阅读，会发现以前忽略的线索。', color: 'blue', mark: '#6c95ad', kind: '句子', status: 'new', label: '未复习', source: '英语阅读笔记', tag: '阅读' },
    { text: 'make sense of', note: '理解；弄懂。常用于原本复杂或混乱的信息：make sense of the data。', color: 'green', mark: '#7a9877', kind: '词汇', status: 'due', label: '今天到期', source: '英语阅读笔记', tag: '搭配' },
    { text: 'read between the lines', note: '从字面之外读出暗示；结合语气和上下文寻找线索。', color: 'blue', mark: '#6c95ad', kind: '词组', status: 'new', label: '未复习', source: '英语阅读笔记', tag: '阅读策略' },
    { text: '输出是检验理解的一种方式', note: '合上原文，用自己的话复述。卡住的地方，就是下一次需要重新阅读的地方。', color: 'pink', mark: '#b77e86', kind: '想法', status: 'new', label: '未复习', source: '学习方法', tag: '复述' },
    { text: 'Small steps, repeated often.', note: '把目标缩小到今天能完成的一次行动，让重复成为习惯。', color: 'green', mark: '#7a9877', kind: '句子', status: 'due', label: '今天到期', source: '学习方法', tag: '习惯' },
    { text: 'on the same page', note: '', color: 'yellow', mark: '#c6a15c', kind: '词汇', status: 'new', label: '未复习', source: '英语阅读笔记', tag: '待补充' },
];
let state = { list: false, batch: false, collapsed: false, onlyDue: false, reverse: false };
const make = (parent, cls, text, tag = 'div') => {
    const element = document.createElement(tag);
    element.className = cls;
    if (text) element.textContent = text;
    parent.append(element);
    return element;
};
function showNote(title, text) {
    document.querySelector('#dialog-title').textContent = title;
    document.querySelector('#dialog-text').textContent = text;
    document.querySelector('#preview-dialog').showModal();
}
function render() {
    collection.replaceChildren();
    const query = document.querySelector('#search').value.toLowerCase();
    const filtered = notes.filter(n => (!state.onlyDue || n.status === 'due') && `${n.text} ${n.note} ${n.tag}`.toLowerCase().includes(query));
    const ordered = state.reverse ? [...filtered].reverse() : filtered;
    const groups = [...new Set(ordered.map(n => n.source))];
    const wrap = make(collection, 'hl-studio-groups');
    if (!ordered.length) make(wrap, 'hl-studio-empty-content', '没有匹配的卡片');
    for (const source of groups) {
        const groupNotes = ordered.filter(n => n.source === source);
        const section = make(wrap, 'hl-studio-group');
        const header = make(section, 'hl-studio-group-header');
        make(header, 'hl-studio-group-chevron', state.collapsed ? '›' : '⌄');
        make(header, 'hl-studio-group-name', source);
        make(header, 'hl-studio-group-count', String(groupNotes.length));
        const body = make(section, 'hl-studio-group-body');
        body.hidden = state.collapsed;
        header.onclick = () => { body.hidden = !body.hidden; };
        const grid = make(body, state.list ? 'hl-studio-list' : 'hl-studio-grid');
        for (const note of groupNotes) {
            if (state.list) {
                const row = make(grid, 'hl-list-row');
                const dot = make(row, 'hl-list-dot');
                dot.style.background = note.mark;
                const body = make(row, 'hl-list-body');
                make(body, 'hl-list-text', note.text);
                make(body, 'hl-list-note', note.note || '尚未写下笔记');
                make(row, 'hl-list-meta', '10/23 · ' + note.tag);
                row.onclick = () => showNote(note.text, note.note || '尚未写下笔记');
                continue;
            }
            const card = make(grid, `hl-studio-card border-${note.color}`);
            card.style.setProperty('--hl-card-mark', note.mark);
            const top = make(card, 'hl-studio-card-top');
            make(top, 'hl-studio-card-kind', note.kind);
            make(top, `hl-studio-card-status is-${note.status}`, note.label);
            make(make(card, 'card-header'), 'highlight-text', note.text);
            const noteBlock = make(card, 'hl-studio-card-note');
            make(noteBlock, `hl-studio-card-note-text ${note.note ? '' : 'is-empty'}`, note.note || '尚未写下笔记 · 点击补充');
            const foot = make(card, 'hl-studio-card-foot');
            make(foot, 'hl-studio-card-source', note.source);
            make(foot, 'hl-studio-card-date', '2026/10/23');
            make(foot, 'hl-studio-card-tag', note.tag);
            card.onclick = () => state.batch ? card.classList.toggle('is-selected') : showNote(note.text, note.note || '尚未写下笔记');
        }
    }
}
document.querySelector('#theme-select').onchange = event => {
    const theme = event.target.value;
    if (!(theme in themes)) return;
    studio.dataset.hlTheme = theme;
    document.querySelector('#preview-name').textContent = themes[theme][0];
    document.querySelector('#preview-description').textContent = themes[theme][1];
};
document.querySelector('#mode-toggle').onclick = () => {
    const dark = studio.dataset.hlMode !== 'dark';
    studio.dataset.hlMode = dark ? 'dark' : 'light';
    document.querySelector('.hl-studio-mode-label').textContent = dark ? '切换浅色' : '切换深色';
};
document.querySelector('#host-mode').onchange = event => { document.body.className = event.target.value === 'dark' ? 'theme-dark' : 'theme-light'; };
document.querySelector('#preview-width').onchange = event => { document.querySelector('#preview-frame').style.maxWidth = `${Number(event.target.value)}px`; };
document.querySelector('#search').oninput = render;
for (const [id, key] of [['filter-toggle', 'onlyDue'], ['sort-toggle', 'reverse'], ['collapse-toggle', 'collapsed'], ['batch-toggle', 'batch']]) {
    document.getElementById(id).onclick = event => {
        state = { ...state, [key]: !state[key] };
        event.currentTarget.classList.toggle(key === 'onlyDue' ? 'has-selection' : 'is-active', state[key]);
        render();
    };
}
for (const [id, list] of [['gallery-toggle', false], ['list-toggle', true]]) {
    document.getElementById(id).onclick = () => {
        state = { ...state, list };
        document.querySelector('#gallery-toggle').classList.toggle('is-active', !list);
        document.querySelector('#list-toggle').classList.toggle('is-active', list);
        render();
    };
}
document.querySelector('#group-toggle').onclick = () => showNote('主题校样', '演示内容按文件分组。实际插件中的分组、排序、筛选和统计功能继续使用原有逻辑。');
document.querySelector('#stats-toggle').onclick = () => showNote('笔记数据统计', '校样包含 7 张演示卡片，其中 3 张今天到期。');
document.querySelector('#review-toggle').onclick = event => {
    const trigger = event.currentTarget;
    const old = studio.querySelector('.hl-review-menu');
    if (old) { old.remove(); trigger.setAttribute('aria-expanded', 'false'); return; }
    const menu = make(trigger.parentElement, 'hl-review-menu');
    trigger.setAttribute('aria-expanded', 'true');
    for (const label of ['复习到期卡片 · 3', '复习全部卡片 · 7']) {
        const item = make(menu, 'hl-review-menu-item', label);
        item.onclick = () => { menu.remove(); trigger.setAttribute('aria-expanded', 'false'); showNote('闪卡复习', '这是菜单样式校样。实际复习在 Obsidian 插件中进行。'); };
    }
};
document.querySelector('#dialog-close').onclick = () => document.querySelector('#preview-dialog').close();
render();
