# 书籍元数据与阅读统计设计

> 状态：**已实现**（2026-11-11）。评审结论：入口都做；阅读天数并入高亮日；评分 0.5 星；热力图切换数据源；年阅读量按读完日期（finishedAt）。
> 日期：2026-11-11 · 基线：2.8.5
> 需求来源：每本书可存储/编辑/展示元数据（阅读进度、作者、书名、出版日期、页数、评分等）；卡片下方显示阅读进度条；统计页基于元数据增加年阅读量、连续阅读天数等阅读数据。

## 1. 目标 / 非目标

**目标**：

1. 每本书（epub / pdf / markdown）可查看、编辑、展示元数据：书名、作者、出版日期、页数、评分、阅读进度
2. 阅读进度以进度条显示在每张书籍卡片下方（现有「高亮笔记数 · 作者」行保留）
3. EPUB 阅读进度自动采集（复用现有 CFI + 页位置缓存），PDF / MD 支持手动维护
4. 统计页新增阅读维度：今年读完、连续阅读天数、今年阅读天数、在读数、近六年年阅读量
5. 元数据与阅读日志跨设备同步（复用 2.8.4 的 shelf collections 同步通道）

**非目标**：

- 不做 PDF / MD 的进度自动追踪（Obsidian 原生 PDF 视图滚动位置无可靠插件钩子；v1 手动）
- 不做 Zotero / 豆瓣 / Google Books 在线元数据抓取（后续可作为「自动填充」按钮单独迭代）
- 不做 markdown frontmatter 双向同步（元数据只存插件侧，不碰用户文件）
- 自定义字段（完全自由 key-value）留待 v2

## 2. 现状盘点

| 现有能力 | 位置 | 与本方案的关系 |
|---|---|---|
| 封面元数据（书名/作者，epub OPF / pdf packaging） | `bookshelf/covers.ts`（IndexedDB 缓存） | 作为编辑器的初始值；非用户数据，只读 |
| EPUB 阅读位置（CFI） | `settings.epubProgress` | 自动进度的数据源之一 |
| EPUB 页位置缓存（总页数 + 当前页） | `epub-view.ts` `ensureLocations()`（IndexedDB） | 百分比 = locationFromCfi / total |
| 书架标签 / 收藏 / 自定义书架 | `settings.bookshelfTags` 等 + 同步合并 | 元数据照抄这套「settings 存储 + tombstone 同步」模式 |
| 高亮统计（总数/连续/热力图/颜色/Top榜） | `studio/stats.ts` | 保留；新增阅读区块并列展示 |
| 卡片信息行（高亮数 · 作者） | `book-card.ts` `.hl-book-sub` | 进度条加在它下方 |

## 3. 数据模型

```ts
/** 每本书的用户元数据（vault path -> BookMeta，存 settings）。 */
export interface BookMeta {
    title?: string;         // 书名；缺省回落封面元数据/文件名（仅展示层回落，不落库）
    author?: string;        // 作者
    publishDate?: string;   // 出版日期：'YYYY' / 'YYYY-MM' / 'YYYY-MM-DD'（输入校验，宽松存储）
    pages?: number;         // 页数（正整数）
    rating?: number;        // 评分 0-5，0.5 步进（0 = 未评）
    progress?: number;      // 阅读进度 0-100 整数百分数；缺省 = 未知（不显示条）
    startedAt?: number;     // 进度首次离开 0 的时间（「在读」起点，展示用）
    finishedAt?: number;    // 进度到达 100 的时间（年阅读量统计键，可回填历史日期）
    updatedAt: number;      // 最近编辑时间（ms），跨设备 newer-wins
}
```

新增 settings 字段（全部可选，老库零迁移）：

```ts
bookshelfBookMeta?: Record<string, BookMeta>;      // vault path -> 元数据
bookMetaTombstones?: SyncTombstone[];              // 跨设备删除传播（id = vault path）
bookshelfReadingDays?: Record<string, number>;     // 'yyyy-mm-dd' -> 当天有阅读活动的书数
```

**派生状态不落库**：未读 / 在读 / 读完由 `progress` 推导（0=未读、1-99=在读、100=读完），避免双份真相。`bookshelfReadingDays` 是唯一新增的「日志类」数据，每天至多一条，一年 ~365 个键，量级可接受（超过 3 年的键在同步合并时顺手修剪）。

## 4. 存储与同步

**存储**：与 `bookshelfTags` / `bookshelfFavorites` 同层（plugin settings / data.json）。理由：这三类书架数据已经走这条通道，模式成熟；书籍量级（几百本 × 一小对象）远小于高亮库，settings 无压力。

**同步**（`sync/shelf-collections.ts` 扩展为第四个集合）：

- payload v2 追加可选字段 `bookMeta` / `bookMetaTombstones` / `readingDays`（`buildPayload` 已按「非空才写」展开，老载荷字节不变；老版本插件解析新载荷时未知字段被忽略，向后兼容已验证——`parseSyncPayload` 只校验已知字段）
- 合并语义：
  - `bookMeta`：按 path 合并，整条 newer-wins（比 `updatedAt`，与书架一致）；活 tombstone 抑制该 path
  - `bookMetaTombstones`：按 id 并联取最新，TTL 修剪（同现有三类）
  - `readingDays`：按键并联取 max（活动是只增事实，无 tombstone）
- `changed` 判定：与现有三类一致，决定是否回写 settings + 刷新视图

## 5. 阅读进度

### 5.1 自动采集（EPUB）

`epub-view.ts` 的 `relocated` 处理器里，在写 `epubProgress`（已有）之后：

1. 若 locations 已就绪：`percent = round(locationFromCfi(cfi) / total × 100)`（0-100）
2. 变化 ≥ 1 才写入 `bookshelfBookMeta[path].progress`（避免翻页风暴打爆 saveSettings）
3. 副作用记录（幂等）：
   - `progress` 从 0→正数：写 `startedAt`
   - 到达 100：写 `finishedAt`（已存在则不覆盖）
   - 当天 `bookshelfReadingDays[dayKey]` 计数 +1（按书去重：当天该书首次活动才 +1，内存 Set 记已计数书）
4. 进度写回节流：复用现有 saveSettings 频率，不新增防抖层

未打开过的书（无 locations）不显示进度条——正常且符合直觉。

### 5.2 手动编辑（全格式）

编辑弹窗内进度为滑条 + 数字输入（0-100）。手动改动同样走副作用记录（startedAt / finishedAt / 阅读天），PDF / MD 由此获得完整统计能力。

**EPUB 自动 vs 手动的冲突**：自动进度在下次翻页时会覆盖手动值。取舍：真实位置优先（手动主要用于 PDF/MD 和回填）。若需要「手动锁定」，v2 加 `progressLocked?: boolean`，先不做。

### 5.3 回填已读完的书

编辑弹窗提供「标记读完」快捷按钮：`progress = 100`，`finishedAt` 默认今天、日期可改（datetime 输入）——历史书也能计入年阅读量。

## 6. 卡片 UI（进度条）

`book-card.ts`：

- `BookEntry` 增加 `progress?: number`（render 入口从 `settings.bookshelfBookMeta` 取一次 Map，逐卡 O(1) 查）
- `renderBookGrid` 在 `.hl-book-sub` 下方渲染：

```
.hl-book-info
    .hl-book-title
    .hl-book-sub          ← 现有：作者 · N 条高亮
    .hl-book-progress     ← 新增：2px 轨道 + accent 填充；无 progress 则整行不渲染
        .hl-book-progress-fill { width: N% }
```

- 三种视图：大/小封面卡都显示条；列表视图右侧以 `N%` 数字 + 迷你条呈现
- 近期阅读页与书籍页共用 `renderBookGrid`，自动获得

## 7. 元数据查看 / 编辑入口

**推荐 A + B 都做**（工作量都不大）：

- **A. 卡片信息按钮**：封面右下角与心形并排的「i」图标（桌面 hover 显示、触屏常显，样式复用 `.hl-book-fav` 的模式）→ 打开 `BookMetaModal`
- **B. 卡片菜单**：桌面右键 / 手机长按卡片 → Obsidian `Menu`：「编辑元数据」「标记读完」「切换收藏」「删除书籍」（删除/收藏收敛到菜单后，心形按钮可保留）

`BookMetaModal`（新文件 `bookshelf/book-meta-modal.ts`，~250 行）：

- 顶部封面缩略 + 文件名；字段表单：书名、作者、出版日期、页数
- 评分：五星点击（半星步进），0 可清空
- 进度：滑条 + 数字；快速按钮「标记读完」
- 底部「清除元数据」（整条删除 + tombstone）
- 输入校验：页数正整数、日期格式 `YYYY(-MM(-DD))?`、进度 0-100；错误行内提示

## 8. 统计页扩展（`studio/stats.ts`）

保留全部现有高亮统计，新增「阅读数据」区块：

```
hl-insights
    h2 统计数据
    [现有 tiles: 卡片总数 | 连续天数(高亮) | 本周新增]
    [新增 tiles: 今年读完 | 连续阅读天数 | 今年阅读天数 | 在读]
    [现有 FSRS tiles]
    [现有热力图]              ← 数据源切换：高亮活动 / 阅读活动（readingDays）
    [新增] 近六年阅读量        ← 柱状条（finishedAt 计数，复用 hl-rank 样式）
    [现有] 颜色分布 / Top 标签 / Top 文件
```

口径定义：

| 指标 | 口径 |
|---|---|
| 今年读完 | `finishedAt` 落在当年的书数（有 `pages` 时附「约 N 页」副标） |
| 连续阅读天数 | `readingDays` 键从今天（空则昨天）连续回溯（与高亮 streak 同算法） |
| 今年阅读天数 | `readingDays` 当年键数 |
| 在读 | `0 < progress < 100` 的书数 |
| 年阅读量图 | 近 6 个自然年 `finishedAt` 计数 + 当年 |

「阅读活动」的构成（默认口径，开放问题 2）：进度更新日 ∪ 高亮创建日。理由：只按 EPUB 进度算会漏掉 PDF / Markdown 划线的日子，而划线本身就是阅读的强信号，建议并入。

## 9. 实施拆分（每步独立可测、可提交）

| 步骤 | 内容 | 新增/改动 | 风险 |
|---|---|---|---|
| 1 | 数据层：`BookMeta` 模型 + settings 字段 + 纯函数（normalize / 合并 / 阅读天推导）+ 单测 | `models.ts`、`sync/shelf-collections.ts`、`bookshelf/book-meta.ts`(新, ~150 行) | 低 |
| 2 | 同步接线：payload 字段 + sanitize + controller 合并回写 + 单测 | `sync/sync-file.ts`、`sync/controller.ts` | 低（照抄 tags 模式） |
| 3 | 进度条 UI：卡片渲染 + 两页接线 + CSS + 截图验证 | `book-card.ts`、`library-page.ts`、`recent-page.ts` | 低 |
| 4 | 编辑器：`BookMetaModal` + 入口 A（信息按钮）+ i18n | `book-meta-modal.ts`(新)、`book-card.ts` | 中（表单细节多） |
| 5 | EPUB 自动进度 + 阅读日志 | `epub/epub-view.ts` | 中（节流与幂等） |
| 6 | 统计区块：tiles + 年度图 + 热力图切换 | `studio/stats.ts`、CSS | 低 |
| 7 | 入口 B（卡片菜单）+ 真机冒烟（手机 + 桌面） | `book-card.ts` | 低 |

依赖顺序：1 → 2；3 依赖 1；4 依赖 1；5 依赖 1-2；6 依赖 1-2。步骤 3-4 可与 5-6 并行。

## 10. 开放问题（已拍板，2026-11-11）

1. **编辑入口**：都做（信息按钮 + 右键/长按菜单）✅
2. **阅读天数口径**：进度日 ∪ 高亮日 ✅
3. **评分粒度**：0.5 星 ✅
4. **弃读状态**：v2 再说
5. **热力图**：数据源切换（高亮 / 阅读）✅
6. **年阅读量口径**：按 `finishedAt` ✅
7. **自定义字段**：v2 再说

## 11. 实施落点（与 §9 对应的实际文件）

| 步骤 | 文件 |
|---|---|
| 1 数据层 | `models.ts`（BookMeta + 3 个 settings 字段）、`bookshelf/book-meta.ts`（normalize / applyProgressTo / bumpReadingDay / computeReadingStats，纯函数） |
| 2 同步 | `sync/shelf-collections.ts`（mergeBookMeta / mergeReadingDays / withBookMetaDeletion）、`sync/sync-file.ts`（payload 字段 + sanitize + hasCollections）、`sync/controller.ts` |
| 3 进度条 | `bookshelf/book-card.ts`（`.hl-book-progress`）、`library-page.ts`、`recent-page.ts`（渲染签名含 progress） |
| 4 编辑器 | `bookshelf/book-meta-modal.ts`（BookMetaModal，评分 0.5 星 + 进度滑条 + 读完日期回填） |
| 5 EPUB 自动进度 | `epub/epub-view.ts`（progressPercent + relocated 挂钩）、`bookshelf/book-actions.ts`（writeBookProgress / markBookFinished）、`main.ts`（readingDayCounted 会话去重） |
| 6 统计 | `studio/stats.ts`（4-5 个阅读磁贴 + 近六年柱状图 + 热力图切换） |
| 7 入口 B | `bookshelf/book-actions.ts`（openBookMenu：编辑元数据 / 标记读完 / 收藏切换 / 删除书籍） |

## 11. 验收清单（草案）

- [ ] 桌面 + 手机：卡片下方进度条渲染正确；无进度书不显示条
- [ ] EPUB 翻页后进度自动更新（±1% 精度），书架页刷新后一致
- [ ] 手动改进度 → startedAt / finishedAt / 阅读天正确记录；「标记读完」可回填历史日期
- [ ] 编辑弹窗校验：坏日期 / 负页数 / 超 100 进度被拒绝且行内提示
- [ ] 两设备同步：元数据 newer-wins、删除不复活、阅读天取 max
- [ ] 统计：今年读完 / 连续阅读 / 年度图数字与手工核对一致
- [ ] 老库升级：无 bookshelfBookMeta 时一切照旧，零报错
