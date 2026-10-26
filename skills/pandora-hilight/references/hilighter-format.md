# HiLighter 插件格式参考（逆向自 v2.0.2 main.js）

## 存储与写入通道（双写）

- **卡片**：存 IndexedDB（Dexie，库名 `HiLighterDB_<hash>`）。
- **正文上色**：Markdown 笔记里的高亮以**字面 `<mark>` 标签**存在正文中（不是 DB 动态
  渲染，也不是 PDF 那种 `.textLayer` 覆盖层）：
  ```html
  <mark class="hl-highlight hl-h-<color>" data-id="<uuid>" data-hl-color="#<hex>">text</mark>
  ```
  `data-id` 与卡片记录一致，用于点卡片定位 / 删卡片同步移除 mark。
- 批量卡片写入通道：`import-sync-data`（命令 / 协议 `obsidian://hilighter?op=sync-import`）
  读 `.hilighter/sync-data.json`（`version` 1 或 2，`highlights` 数组），按 id upsert：
  新 id → added；同 id 且 text/note/color/sourcePath 有变 → updated（note 为空保留旧值、
  tags 并集、fsrs 合并）；完全相同 → skipped。
- `syncOnUnload: true` 时插件卸载会把 DB 导出覆盖 sync 文件——**合并进 sync 文件后应
  立即触发导入**（脚本已自动做）。

## 高亮记录字段

```json
{
  "id": "uuid（脚本自动生成）",
  "text": "源文件某一行内的精确子串（逐字符，含标点；不能跨行）",
  "color": "yellow | pink | blue | green | c_xxxxxxxx（自定义色 id）",
  "note": "辅导笔记，Markdown，渲染在右侧卡片",
  "sourcePath": "vault 相对路径，如 30 资源/示例.md",
  "lineIndex": 46,
  "createdAt": 1792003794868,
  "colorHex": "#b39ddb（仅自定义色需要）",
  "tags": ["可选标签"],
  "pdfPage": 3
}
```

- `lineIndex`：**0 基**行号。渲染时在该行内匹配 `text` 子串上色；点击卡片跳转到
  `editor.setCursor(lineIndex, 0)`。行号或 text 不精确 = 高亮渲染不出来。
- `color` 非法值（不在内置四色且不在插件设置 `customColors` 里）会被导入时**降级为
  yellow**。合并脚本已按插件设置校验。
- `pdfPage` 用于 PDF 高亮（配合 pdfOverlay），Markdown 笔记不需要。
- `fsrs` 字段供复习（Anki 式记忆调度）用，导入时自动合并，生成时不用管。

## 颜色语义（本技能约定）

| color | 语义 | note 必含 |
|---|---|---|
| yellow | 核心观点/重点 | 注释 +（适用时）提问 |
| blue | 概念/术语 | 定义式注释；外语术语 + 中文释义 + 使用语境 |
| green | 方法/可执行步骤 | 注释 + 落地提示 |
| pink | 金句/灵感 | 启发性提问 |

自定义色须在插件设置「颜色」里先添加，id 形如 `c_xxxxxxxx`。

## 导入触发（全自动链路）

```bash
open "obsidian://hilighter?op=sync-import"
```

HiLighter ≥2.0.2 自带协议处理器（无需 Advanced URI）：`op` 取值 `sync-import` /
`sync-export` / `sync` / `open-studio` / `open-view`。`sync-import` = `importNow()`，
读 sync 文件按 id upsert。`hilight_merge.py` 已内置该调用，失败时降级提示手动跑
「导入同步数据」命令。

## note 卡片模板

```markdown
- 一两句说清为什么重要/背景。
- 一个促进主动回忆的问题？
- term = 中文释义（使用语境）
```

- 无序列表 `- ` 逐条，不加「注释/提问/翻译」字样；顺序固定：注释 → 提问 → 术语。
- 无术语则省略第三行；≤ 80 字为宜（术语翻译除外）。
- 卡片标题即高亮原文 `text`，无需在 note 里重复原文。
