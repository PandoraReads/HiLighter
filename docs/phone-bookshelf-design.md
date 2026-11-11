# 手机端书架适配设计

> 状态：**已实现**（2026-11-11，随下一次版本发布）。三个开放问题已确认：手机只留书架 ribbon / 书架接管手机流程 / 视图切换隐藏固定大封面。
> 日期：2026-11-11 · 基线：2.8.4

## 1. 目标 / 非目标

**目标**：手机（iPhone / Android）上完整可用 HiLighter 书架视图——近期阅读、书籍（含自定义书架、收藏、标签、分页）、统计；入口与桌面一致（ribbon + 命令面板）。

**非目标**：
- 不动手机端现有 `MobileRecentHighlightsView` 侧栏流程（共存；是否最终替换观察使用后再定）
- 思维导图不在手机端开放（mindmap 命令本就 `Platform.isMobile → false`）
- 长按进入多选、下拉刷新等原生手势留作 v2

## 2. 现状差距清单

| # | 差距 | 位置 |
|---|---|---|
| 1 | 视图未注册、ribbon/命令未开通 | `main.ts` 三处 `!Platform.isPhone`（onload / addRibbonIcon / addCommand） |
| 2 | 收藏心形 **hover 才出现**，触屏无 hover | `styles.css` `.hl-book-fav { opacity: 0 }` + `:hover` |
| 3 | 书籍页工具条 9 个控件，wrap 后 3 行混乱 | `.hl-shelf-toolbar`（自定义书架/搜索/排序/格式/标签/多选/计数/收藏/视图大小） |
| 4 | 顶栏单行放不下：品牌 + 4 标签 + 3 动作 | `.hl-shelf-topbar`（≤700px 已有部分适配：标签去文字、可横滚） |
| 5 | 思维导图标签在手机端应隐藏 | `view.ts` `TABS` 常量 |
| 6 | 浮动件（分页条/批量堆/回顶）可能被 home indicator 遮挡 | pager `bottom: 10px`，无 safe-area 处理 |
| 7 | 触控目标偏小：心形 24px、部分按钮 26-30px | 各浮动按钮 |

**已就绪、无需重做的部分**：封面读取超时 + 并发限 3 + 跨设备持久缓存（2.8.2，iCloud 占位符安全）；懒加载 IntersectionObserver（弹窗安全）；刷新相关性门控（同步风暴不重建）；`≤700px` 媒体查询（标签图标化、网格 minmax(128px,1fr)）；自定义书架/标签/选文件夹三个模态走 Obsidian 原生（手机自动近全屏）。

## 3. 设计

### 3.1 开通入口（main.ts，~5 行）

移除三处 `!Platform.isPhone` 门：`registerView(BOOKSHELF_VIEW_TYPE)`、`addRibbonIcon('library', …)`、`addCommand('open-bookshelf')`。手机端 ribbon 在底部抽屉，不占屏幕空间。现有 `openHighlightEntry` 等手机路由（→ `MOBILE_RECENT_VIEW_TYPE`）一律不动。

### 3.2 标签集合（view.ts，~3 行）

`TABS` 在手机端过滤掉 `mindmap`（与命令禁用保持一致）。`cards` 入口保留（studio 视图可开）；`recent / library / stats` 三标签即手机端主体。

### 3.3 顶栏（CSS `.is-phone`，DOM 不动）

- 隐藏品牌区（`HiLighter / 书架` 文本）——标签即导航，省出 ~120px
- 标签保持「图标 + 短文字」、可横滚（现状已支持）
- 动作区：卡片集按钮去文字留图标；主题选择从下拉收成图标按钮 + Obsidian `Menu` 弹出；深浅切换已是纯图标
- 单行高度收敛到 ~44px（触控下限）

### 3.4 书籍页工具条——两级布局（纯 CSS order + wrap，DOM 不动）

```
第一行：搜索框（100% 宽，flex-basis:100% + order:-1）
第二行：自定义书架(图标) · 排序 · 格式 · 标签 · 多选 · 收藏心 · 计数   ← 不足宽时横滚
```

- `.is-phone .hl-shelf-toolbar` 两级化：搜索独占首行，其余排第二行
- 自定义书架按钮去文字留图标（书架图标 + 现有下箭头）
- 视图大小三连切换在手机端隐藏（屏幕小，large 两列最优；少 3 个按钮）
- 第二行放不下时 `overflow-x: auto` 横滚，不做更多折叠（控件已是最低必要集）

### 3.5 触控适配（CSS）

- **心形常显**：`.is-mobile .hl-book-fav { opacity: .85 }`（不再依赖 hover），尺寸 24→30px
- 所有浮动按钮触控目标 ≥36px（回顶、批量堆、分页箭头）
- **安全区**：分页条/批量堆/回顶 `bottom: max(10px, env(safe-area-inset-bottom))`，避开 home indicator
- `has-pager` 网格底边距相应加大到 ~86px

### 3.6 模态（CSS 微调）

`.hl-scope-modal` 等在手机端 `width: calc(100vw - 32px)`（原 `max-width: 520px` 保留给桌面）；自定义书架行、递归切换按钮的点击区加大到 ≥40px 高。`FolderPickerModal`（FuzzySuggestModal）与 `TagBooksModal`、`ConfirmModal` 原生兼容手机，不动。

### 3.7 性能与数据

无新数据面。手机端与桌面/平板共享同一套 settings + 同步机制（自定义书架/收藏/标签 2.8.4 起跨设备同步——手机端书架开通后即是第三个受益端，无需额外工作）。

## 4. 实施拆分

| 步骤 | 内容 | 改动量 | 风险 |
|---|---|---|---|
| 1 | main.ts 三处门移除 + view.ts TABS 过滤 | ~8 行 | 极低 |
| 2 | styles.css 新增 `.is-phone` / `.is-mobile` 书架适配段（顶栏/工具条两级/心形/安全区/触控尺寸） | ~120 行 CSS | 低（桌面零影响，全部前缀在 mobile 类下） |
| 3 | 主题选择手机端改 Menu 弹出（顶栏空间） | ~20 行 ts | 低 |
| 4 | 真机冒烟：iPhone 尺寸过一遍 近期/书籍/统计 + 自定义书架模态 + 分页 + 收藏 | — | — |

不改任何现有桌面/平板行为（所有新 CSS 都挂在 `.is-phone` / `.is-mobile` 下；ts 变更仅平台分支）。

## 5. 开放问题（待定）

1. **ribbon 图标**：手机底部抽屉里「highlighter 划词」与「library 书架」两个图标并存，还是手机端只留书架？（推荐：并存，抽屉不挤）
2. **MobileRecentHighlightsView 去留**：书架开通后，手机侧栏的简化版近期列表是否保留？（推荐：先保留不动，避免动现有用户流程）
3. **视图大小切换**：手机端隐藏三连切换、固定大封面两列，还是保留列表模式给小屏？（推荐：隐藏切换；若需要列表，后续加「列表」单按钮）
