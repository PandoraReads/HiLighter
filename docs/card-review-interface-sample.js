// Interactive design sample. All notes and review intervals are local demo data.
const themes = {
  editorial: {
    light: ['#eeeae1','#f8f6f1','#fffcf7','#272b28','#747b74','#d8d8cc','#e8e7dc','#557a69','#e5ede6','#253c35','rgba(255,255,255,.64)'],
    dark: ['#171d1a','#252c27','#2c342e','#f0f0e8','#a5afa5','#48564b','#3d493f','#b3d2b8','#3b5141','#12231a','rgba(105,145,115,.1)']
  },
  native: {
    light: ['#f0f1f2','#fafafa','#ffffff','#2b3035','#6d747a','#d4d8db','#e6e9eb','#5a7198','#e7edf6','#303840','rgba(255,255,255,.5)'],
    dark: ['#202326','#292e32','#30363b','#e8ebed','#aab2b7','#485058','#40484e','#9db8e0','#35465b','#171c20','rgba(90,120,150,.1)']
  },
  paper: {
    light: ['#faf6ef','#f6f0e7','#fffdf8','#3a3225','#796d5e','#dfd3c0','#ece4d8','#9a7248','#f1e5d1','#514337','rgba(255,255,255,.55)'],
    dark: ['#211d18','#27221d','#2a2520','#d8cdb8','#a99d8b','#544838','#43392d','#c7a57b','#433629','#30271e','rgba(155,125,85,.08)']
  },
  ocean: {
    light: ['#eef4f7','#e7eff2','#ffffff','#1a2733','#637782','#c8dbe2','#e0e9ed','#2d8b8b','#d9eeed','#163f4b','rgba(45,139,139,.13)'],
    dark: ['#0f1a24','#13212c','#16222e','#d7e3ea','#99adb9','#38505d','#2b3d48','#4fd1c5','#1e4449','#0c151d','rgba(79,209,197,.08)']
  },
  forest: {
    light: ['#eef0e8','#e8ebdf','#faf9f6','#2b3024','#737d6b','#d4dbc8','#e5e9dd','#5a7a4a','#e2ebda','#2b4331','rgba(90,122,74,.11)'],
    dark: ['#181d16','#1b241a','#1f261c','#d6dcc8','#a5b09b','#42513d','#344130','#8fb86a','#34492d','#141812','rgba(143,184,106,.08)']
  },
  galaxy: {
    light: ['#f0eef5','#eae5f2','#ffffff','#241d33','#756b83','#d8cee6','#e8e1ef','#6b4ea0','#e8e0f5','#332747','rgba(107,78,160,.1)'],
    dark: ['#1a1426','#1c1729','#221a33','#d8d0ea','#a99dbb','#4d4263','#3a304e','#a490c2','#3e3459','#140f1f','rgba(164,144,194,.07)']
  },
  cyber: {
    light: ['#f4f6f8','#e9edf1','#ffffff','#0d1622','#62717f','#d2dae3','#e5ebf1','#0066ff','#e1ecff','#152b42','rgba(0,102,255,.08)'],
    dark: ['#0a0e14','#101720','#11161e','#cfd8e3','#9baabd','#2b4356','#253543','#00e5ff','#143b49','#070a0f','rgba(0,229,255,.07)']
  },
  sunset: {
    light: ['#fbf3ec','#f6e9dd','#fffaf5','#33241c','#836e63','#ecd6c7','#f2e4d9','#e76f51','#fbe5d9','#58332d','rgba(231,111,81,.1)'],
    dark: ['#1f1612','#231913','#281c16','#e8d8cc','#bfa89a','#5a4138','#46332b','#f4845f','#563429','#190f0c','rgba(244,132,95,.07)']
  },
  rose: {
    light: ['#f6eded','#f2e4e4','#fdf6f6','#332424','#806c6d','#e6cfd0','#f0e0e0','#b87d6d','#f2dfdb','#563a3f','rgba(184,125,109,.1)'],
    dark: ['#1d1616','#211919','#251a1a','#e8d6d6','#b8a3a3','#574242','#443434','#cf9a8a','#503a38','#170f0f','rgba(207,154,138,.07)']
  }
};
const tokens = ['--bg','--surface','--card','--ink','--muted','--line','--soft-line','--sage','--sage-soft','--rail','--glow'];
const byId = (id) => document.getElementById(id);
let cards = [
  { id: '1', quote: 'take something for granted', note: '想当然地认为某事理所应当。这里提醒我：输入材料的难度不能凭感觉判断。', type: '词汇', tone: 'sage', state: 'due', status: '今天到期', source: '英语阅读笔记', date: '10/22', tag: '#表达' },
  { id: '2', quote: 'The more that you read, the more things you will know.', note: '阅读数量增长之外，还要留下能被主动提取的理解。重点不只是“读过”。', type: '句子', tone: 'blue', state: 'new', status: '未复习', source: '英语阅读笔记', date: '10/21', tag: '#阅读' },
  { id: '3', quote: '输出不是输入的自动结果', note: '输入后用自己的话复述，再对照原文，才能看见理解缺口。', type: '想法', tone: 'amber', state: 'due', status: '今天到期', source: '学习方法', date: '10/20', tag: '#方法' },
  { id: '4', quote: 'on the same page', note: '表示“看法一致”。开会讨论目标时很常见，可以用在工作沟通里。', type: '词汇', tone: 'rose', state: 'scheduled', status: '明天到期', source: '英语表达库', date: '10/18', tag: '#沟通' },
  { id: '5', quote: 'A word is learned through encounters, not a single definition.', note: '同一个词在不同语境里反复遇见，才会形成灵活的理解。', type: '句子', tone: 'sage', state: 'new', status: '未复习', source: '词汇研究', date: '10/17', tag: '#词汇', image: true },
  { id: '6', quote: 'make sense of', note: '', type: '词汇', tone: 'blue', state: 'due', status: '今天到期', source: '英语阅读笔记', date: '10/16', tag: '#待补充' }
];
const groupLabels = { file: '文件', tag: '标签', color: '颜色', date: '日期' };
const colorLabels = { sage: '绿色', blue: '蓝色', amber: '黄色', rose: '粉色' };
const sortLabels = { time_desc: '最新优先', time_asc: '最早优先', az: '摘录 A–Z', za: '摘录 Z–A' };
let activeView = 'library';
let theme = 'editorial';
let dark = false;
let groupBy = 'file';
let sortBy = 'time_desc';
let facets = new Set();
let collapsed = new Set();
let viewMode = 'gallery';
let batchMode = false;
let selected = new Set();
let openMenu = null;
let reviewMode = 'due';
let reviewIndex = 0;
let flipped = false;
let lastFocus = null;

function applyTheme() {
  const palette = themes[theme][dark ? 'dark' : 'light'];
  tokens.forEach((token, index) => document.body.style.setProperty(token, palette[index]));
  document.body.classList.toggle('dark', dark);
  document.body.dataset.theme = theme;
  byId('theme-btn').textContent = dark ? '切换浅色' : '切换深色';
}

function facetKey(card) {
  if (groupBy === 'file') return card.source;
  if (groupBy === 'tag') return card.tag;
  if (groupBy === 'color') return card.tone;
  return `2026-${card.date.slice(0, 2)}`;
}
function facetLabel(key) { return groupBy === 'color' ? colorLabels[key] : groupBy === 'date' ? key.replace('-', ' 年 ') + ' 月' : key; }
function sortedCards(items) {
  return [...items].sort((a, b) => {
    if (sortBy === 'az') return a.quote.localeCompare(b.quote);
    if (sortBy === 'za') return b.quote.localeCompare(a.quote);
    const delta = Number(b.date.replace('/', '')) - Number(a.date.replace('/', ''));
    return sortBy === 'time_asc' ? -delta : delta;
  });
}
function visibleCards() {
  const query = byId('search-input').value.trim().toLocaleLowerCase();
  return sortedCards(cards.filter(card =>
    `${card.quote} ${card.note} ${card.tag}`.toLocaleLowerCase().includes(query) &&
    (facets.size === 0 || facets.has(facetKey(card)))
  ));
}
function groupCards(items) {
  const groups = new Map();
  items.forEach(card => {
    const key = facetKey(card);
    groups.set(key, [...(groups.get(key) || []), card]);
  });
  return [...groups.entries()].sort((a, b) => groupBy === 'file' ? b[1].length - a[1].length : a[0].localeCompare(b[0]));
}
function createCard(card) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = viewMode === 'gallery' ? 'note-card' : 'list-row';
  el.dataset.tone = card.tone;
  el.classList.toggle('selected', selected.has(card.id));
  if (viewMode === 'list') {
    const quote = document.createElement('span'); quote.className = 'list-quote'; quote.textContent = card.quote;
    const note = document.createElement('span'); note.className = 'list-note'; note.textContent = card.note || '尚未写下笔记';
    const meta = document.createElement('span'); meta.className = 'list-meta'; meta.textContent = `${card.source} · ${card.date}`;
    el.append(quote, note, meta);
  } else {
    const top = document.createElement('span'); top.className = 'card-top';
    const type = document.createElement('span'); type.className = 'card-type';
    const dot = document.createElement('span'); dot.className = 'color-dot';
    type.append(dot, document.createTextNode(card.type));
    const status = document.createElement('span'); status.className = `status ${card.state}`; status.textContent = card.status;
    top.append(type, status);
    const quote = document.createElement('span'); quote.className = `quote ${/^[\u3400-\u9fff]/u.test(card.quote) ? 'zh' : ''}`; quote.textContent = card.quote;
    const note = document.createElement('span'); note.className = `note-preview ${card.note ? '' : 'empty'}`; note.textContent = card.note || '尚未写下笔记 · 点击补充';
    const foot = document.createElement('span'); foot.className = 'card-bottom';
    const source = document.createElement('span'); source.textContent = `${card.source} · ${card.date}`;
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = card.tag;
    foot.append(source, tag);
    el.append(top, quote, note);
    if (card.image) {
      const image = document.createElement('span'); image.className = 'image-preview';
      const imageLabel = document.createElement('span'); imageLabel.textContent = '图片 1 张';
      image.append(imageLabel); el.append(image);
    }
    el.append(foot);
  }
  el.addEventListener('click', () => {
    if (batchMode) {
      selected = selected.has(card.id) ? new Set([...selected].filter(id => id !== card.id)) : new Set([...selected, card.id]);
      renderCollection();
    } else showDetail(card, el);
  });
  return el;
}
function renderCollection() {
  const visible = visibleCards();
  byId('visible-count').textContent = String(visible.length).padStart(2, '0');
  byId('due-badge').textContent = String(cards.filter(card => card.state === 'due').length);
  byId('batch-count').textContent = `已选 ${selected.size} 张`;
  const parent = byId('collection');
  parent.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = '没有符合条件的卡片。可以清除筛选或搜索词。'; parent.append(empty);
    return;
  }
  groupCards(visible).forEach(([key, items]) => {
    const block = document.createElement('section'); block.className = 'group-block';
    const head = document.createElement('button'); head.type = 'button'; head.className = 'group-head';
    head.setAttribute('aria-expanded', String(!collapsed.has(key)));
    const arrow = document.createElement('span'); arrow.className = 'chevron'; arrow.textContent = collapsed.has(key) ? '▸' : '▾';
    const title = document.createElement('strong'); title.textContent = facetLabel(key);
    const count = document.createElement('small'); count.textContent = String(items.length);
    const rule = document.createElement('span'); rule.className = 'rule';
    head.append(arrow, title, count, rule);
    head.addEventListener('click', () => {
      collapsed = collapsed.has(key) ? new Set([...collapsed].filter(item => item !== key)) : new Set([...collapsed, key]);
      renderCollection();
    });
    block.append(head);
    if (!collapsed.has(key)) {
      const content = document.createElement('div'); content.className = viewMode === 'gallery' ? 'cards' : 'list-wrap';
      content.append(...items.map(createCard)); block.append(content);
    }
    parent.append(block);
  });
}
function menuButton(label, action, selectedItem = false, count = null) {
  const button = document.createElement('button'); button.type = 'button'; button.classList.toggle('selected', selectedItem);
  button.textContent = label;
  if (count !== null) { const small = document.createElement('small'); small.textContent = String(count); button.append(small); }
  button.addEventListener('click', action);
  return button;
}
function renderMenus() {
  byId('group-btn').textContent = `分组：${groupLabels[groupBy]} ▾`;
  byId('sort-btn').textContent = `排序：${sortLabels[sortBy]} ▾`;
  byId('facet-btn').textContent = `筛选：${groupLabels[groupBy]}${facets.size ? ` · ${facets.size}` : ''} ▾`;
  const groupMenu = byId('group-menu'); groupMenu.replaceChildren();
  Object.entries(groupLabels).forEach(([key, label]) => groupMenu.append(menuButton(label, () => {
    groupBy = key; facets = new Set(); collapsed = new Set(); closeMenus(); renderMenus(); renderCollection();
  }, groupBy === key)));
  const sortMenu = byId('sort-menu'); sortMenu.replaceChildren();
  Object.entries(sortLabels).forEach(([key, label]) => sortMenu.append(menuButton(label, () => {
    sortBy = key; closeMenus(); renderMenus(); renderCollection();
  }, sortBy === key)));
  const facetMenu = byId('facet-menu'); facetMenu.replaceChildren();
  if (facets.size > 0) facetMenu.append(menuButton('清除筛选', () => { facets = new Set(); renderMenus(); renderCollection(); }));
  const counts = new Map();
  cards.forEach(card => { const key = facetKey(card); counts.set(key, (counts.get(key) || 0) + 1); });
  [...counts.entries()].forEach(([key, count]) => facetMenu.append(menuButton(facetLabel(key), () => {
    facets = facets.has(key) ? new Set([...facets].filter(item => item !== key)) : new Set([...facets, key]);
    renderMenus(); renderCollection();
  }, facets.has(key), count)));
  const reviewMenu = byId('review-menu'); reviewMenu.replaceChildren();
  const dueCount = cards.filter(card => card.state === 'due').length;
  const newCount = cards.filter(card => card.state === 'new').length;
  reviewMenu.append(menuButton('复习到期卡', () => { reviewMode = 'due'; reviewIndex = 0; flipped = false; closeMenus(); showView('review'); }, false, dueCount));
  reviewMenu.append(menuButton('学习新卡', () => { reviewMode = 'new'; reviewIndex = 0; flipped = false; closeMenus(); showView('review'); }, false, newCount));
  reviewMenu.append(menuButton('复习设置', () => { closeMenus(); showSettings(); }));
}
function closeMenus() {
  openMenu = null;
  document.querySelectorAll('.tool-popover').forEach(menu => { menu.hidden = true; });
  document.querySelectorAll('[data-menu]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}
function showDetail(card, trigger) {
  lastFocus = trigger;
  byId('detail-title').textContent = card.quote;
  byId('detail-note').textContent = card.note || '这张卡片还没有笔记。';
  byId('detail-source').textContent = `${card.source} · ${card.date} · ${card.tag}`;
  byId('detail-overlay').hidden = false;
  byId('sheet-close').focus();
}
function showSettings() {
  lastFocus = byId('review-menu-btn');
  byId('detail-title').textContent = '复习设置';
  byId('detail-note').textContent = '这是界面样本。正式插件中的复习设置仍从原有入口打开，包含目标记忆率、每日新卡上限等选项。';
  byId('detail-source').textContent = '当前样本不会修改插件设置。';
  byId('detail-overlay').hidden = false;
  byId('sheet-close').focus();
}
function closeDetail() { byId('detail-overlay').hidden = true; lastFocus?.focus(); }
function renderStats() {
  const tiles = [
    [String(cards.length), '总笔记'],
    [String(cards.filter(card => card.state === 'due').length), '今天到期'],
    [String(cards.filter(card => card.state === 'new').length), '新卡'],
    ['2', '今日已复习 · 示例']
  ];
  byId('stats-tiles').replaceChildren(...tiles.map(([value, label]) => {
    const tile = document.createElement('div'); tile.className = 'stat-tile';
    const number = document.createElement('strong'); number.textContent = value;
    const text = document.createElement('span'); text.textContent = label;
    tile.append(number, text); return tile;
  }));
  byId('stats-bars').replaceChildren(...[18,32,26,46,31,65,43,72,38,53,78,62,41,71,96,56,82,68,91,75,100].map(height => {
    const bar = document.createElement('span'); bar.style.height = `${height}%`; return bar;
  }));
  const colorCounts = new Map(); const tagCounts = new Map();
  cards.forEach(card => { colorCounts.set(card.tone, (colorCounts.get(card.tone) || 0) + 1); tagCounts.set(card.tag, (tagCounts.get(card.tag) || 0) + 1); });
  const renderList = (id, entries, label) => byId(id).replaceChildren(...entries.map(([key, count]) => {
    const item = document.createElement('li'); const name = document.createElement('span'); name.textContent = label(key);
    const value = document.createElement('b'); value.textContent = String(count); item.append(name, value); return item;
  }));
  renderList('stats-colors', [...colorCounts.entries()], key => colorLabels[key]);
  renderList('stats-tags', [...tagCounts.entries()], key => key);
}
function showView(view) {
  activeView = view;
  ['library','review','stats'].forEach(name => { byId(`${name}-view`).hidden = view !== name; });
  byId('nav-library').classList.toggle('active', view === 'library' || view === 'stats');
  byId('nav-review').classList.toggle('active', view === 'review');
  byId('stats-btn').classList.toggle('active', view === 'stats');
  byId('nav-library').setAttribute('aria-current', view === 'library' || view === 'stats' ? 'page' : 'false');
  byId('nav-review').setAttribute('aria-current', view === 'review' ? 'page' : 'false');
  byId('crumb-current').textContent = ({ library: '卡片管理', review: '闪卡复习', stats: '笔记数据统计' })[view];
  if (view === 'stats') renderStats();
  if (view === 'review') renderReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function reviewQueue() {
  return cards.filter(card => reviewMode === 'new' ? card.state === 'new' : card.state === 'due');
}
function renderReview() {
  const queue = reviewQueue();
  byId('review-title').textContent = reviewMode === 'new' ? '学习新卡' : '今日复习';
  const due = cards.filter(item => item.state === 'due').length;
  const fresh = cards.filter(item => item.state === 'new').length;
  byId('review-due').textContent = String(due);
  byId('review-new').textContent = String(fresh);
  byId('flash-card').disabled = queue.length === 0;
  byId('skip-btn').disabled = queue.length === 0;
  if (queue.length === 0) {
    byId('review-count').textContent = reviewMode === 'new' ? '没有新卡' : '今天没有到期卡片';
    byId('progress-fill').style.width = '0%';
    byId('flash-side').textContent = '本轮已完成';
    byId('flash-status').textContent = '';
    byId('flash-prompt').textContent = '目前没有可学习的卡片';
    byId('flash-quote').textContent = '可以返回卡片管理页查看笔记。';
    byId('flash-quote').hidden = false;
    byId('flash-divider').hidden = true;
    byId('flash-answer').hidden = true;
    byId('flash-source').textContent = '';
    byId('flash-action').textContent = '';
    byId('flip-btn').hidden = true;
    byId('ratings').hidden = true;
    return;
  }
  const card = queue[reviewIndex % queue.length];
  byId('review-count').textContent = `进度 ${reviewIndex + 1} / ${queue.length}`;
  byId('progress-fill').style.width = `${reviewIndex / queue.length * 100}%`;
  byId('flash-side').textContent = flipped ? '背面 · 检查答案' : '正面 · 回忆';
  byId('flash-status').textContent = card.status;
  byId('flash-prompt').textContent = flipped ? '你写下的理解' : '看到这段摘录，你写过什么？';
  byId('flash-quote').textContent = flipped ? '' : card.quote;
  byId('flash-quote').hidden = flipped;
  byId('flash-divider').hidden = !flipped;
  byId('flash-answer').hidden = !flipped;
  byId('flash-answer').textContent = card.note || '还没有笔记。复习后可以在管理页补充。';
  byId('flash-source').textContent = `来源 · ${card.source}`;
  byId('flash-action').textContent = flipped ? '检查后选择记忆程度' : '点击卡片翻面 →';
  byId('flip-btn').hidden = flipped;
  byId('ratings').hidden = !flipped;
}
function flip() { if (!reviewQueue().length) return; flipped = !flipped; renderReview(); }
function advance() { const count = reviewQueue().length; if (!count) return; reviewIndex = (reviewIndex + 1) % count; flipped = false; renderReview(); }

byId('nav-library').addEventListener('click', () => showView('library'));
byId('nav-review').addEventListener('click', () => showView('review'));
byId('stats-btn').addEventListener('click', () => showView(activeView === 'stats' ? 'library' : 'stats'));
byId('theme-select').addEventListener('change', event => { theme = event.target.value; applyTheme(); });
byId('theme-btn').addEventListener('click', () => { dark = !dark; applyTheme(); });
byId('search-input').addEventListener('input', renderCollection);
document.querySelectorAll('[data-menu]').forEach(button => button.addEventListener('click', event => {
  event.stopPropagation();
  const name = button.dataset.menu;
  const wasOpen = openMenu === name;
  closeMenus();
  if (!wasOpen) { openMenu = name; byId(`${name}-menu`).hidden = false; button.setAttribute('aria-expanded', 'true'); }
}));
document.addEventListener('click', event => { if (!event.target.closest('.tool-menu')) closeMenus(); });
byId('collapse-btn').addEventListener('click', () => {
  const keys = groupCards(visibleCards()).map(([key]) => key);
  collapsed = keys.length && keys.every(key => collapsed.has(key)) ? new Set() : new Set(keys);
  byId('collapse-btn').textContent = collapsed.size ? '全部展开' : '全部折叠';
  renderCollection();
});
byId('gallery-btn').addEventListener('click', () => { viewMode = 'gallery'; byId('gallery-btn').classList.add('active'); byId('list-btn').classList.remove('active'); renderCollection(); });
byId('list-btn').addEventListener('click', () => { viewMode = 'list'; byId('list-btn').classList.add('active'); byId('gallery-btn').classList.remove('active'); renderCollection(); });
byId('batch-btn').addEventListener('click', () => { batchMode = !batchMode; selected = new Set(); byId('batch-btn').classList.toggle('active', batchMode); byId('batch-bar').hidden = !batchMode; renderCollection(); });
byId('batch-tag').addEventListener('click', () => { cards = cards.map(card => selected.has(card.id) ? { ...card, tag: '#复习重点' } : card); selected = new Set(); renderMenus(); renderCollection(); renderStats(); });
byId('batch-delete').addEventListener('click', () => { cards = cards.filter(card => !selected.has(card.id)); selected = new Set(); renderMenus(); renderCollection(); renderStats(); });
byId('flash-card').addEventListener('click', flip);
byId('flip-btn').addEventListener('click', flip);
byId('skip-btn').addEventListener('click', advance);
document.querySelectorAll('[data-grade]').forEach(button => button.addEventListener('click', advance));
byId('sheet-close').addEventListener('click', closeDetail);
byId('detail-overlay').addEventListener('click', event => { if (event.target === byId('detail-overlay')) closeDetail(); });
document.addEventListener('keydown', event => {
  if (!byId('detail-overlay').hidden) { if (event.key === 'Escape') closeDetail(); return; }
  if (event.key === 'Escape') { closeMenus(); return; }
  if (activeView !== 'review' || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); flip(); }
  if (flipped && ['1','2','3','4'].includes(event.key)) advance();
});
applyTheme();
renderMenus();
renderCollection();
renderReview();
