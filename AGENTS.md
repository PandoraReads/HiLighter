# HiLighter 架构与 Linter 规范 (`AGENTS.md`)

本文档定义 **HiLighter** 插件的工程架构与必须严格遵守的 **ESLint / TypeScript 规范**。

---

## 一、工程架构

HiLighter 采用 **「薄视图壳（Thin `ItemView` Shell）+ 同级纯逻辑/子渲染模块（Sibling Modules）」** 的分层架构，确保核心算法与数据逻辑可在无 Obsidian 运行时的环境下通过 `vitest` 独立测试。

### 1. 目录与模块职责
- `src/main.ts`：插件生命周期入口，负责注册视图、命令、Ribbon 图标、选中菜单监听与跨设备同步控制器。
- `src/view-types.ts`：零依赖的视图类型常量定义（`HIGHLIGHT_VIEW_TYPE`、`HIGHLIGHT_MANAGER_VIEW_TYPE`、`MINDMAP_VIEW_TYPE`、`BOOKSHELF_VIEW_TYPE`、`WHITEBOARD_VIEW_TYPE`），避免循环引用。
- `src/models.ts`：全局数据结构定义（`HighlightNote`、`MindMapDoc`、`WhiteboardDoc`、`HiLighterSettings` 等）。
- `src/db.ts`：基于 Dexie 的 IndexedDB 封装（`HiLighterDatabase`，当前 `version(7)`），包含 `highlightNotes`、`syncTombstones`、`mindmaps`、`epubLocations`、`whiteboards` 五张表，并提供响应式变更通知 `db.onChange(cb)`。
- `src/sync/`：基于 `.hilighter/sync-data.json` 与 `SyncTombstone` 的多端增量合并与防删复活同步系统。
- `src/ui/`：通用可复用 UI 组件（如 `confirm-modal.ts`、`input-modal.ts`、`tag-editor.ts` 内联标签编辑器）。
- `src/selection/` & `src/note-popup.ts`：划词高亮菜单与锚点批注弹窗（支持 Markdown、PDF、EPUB 及直接打 `#tag`）。
- `src/studio/`：卡片集（Studio）视图、4 种卡片模板（摘录 / 康奈尔 / 一页纸 / 卢曼想法卡）、7 种语义关联（`CardLink`）、卡片详情弹窗（`modals.ts`）与 FSRS 间隔复习。
- `src/bookshelf/`：桌面端书架导航主页（近期阅读、书籍、笔记本、思维导图、白板、统计）。
- `src/mindmap/`：思维导图视图与引擎封装。
- `src/whiteboard/`：无限白板与内置卡片库抽屉模块：
  - `view.ts`：`HighlightWhiteboardView` 主视图壳（顶部白板管理与工具栏、左右分栏、防抖自动保存、`db.onChange` 实时同步）。
  - `card-drawer.ts`：左侧可折叠卡片库抽屉（Tag 胶囊聚合与多选筛选、关键词搜索、「隐藏已上板」过滤、单张/批量拖拽与 `+` 一键上板）。
  - `canvas.ts`：`WhiteboardCanvas` 无限画布引擎（视口平移/光标缩放、点阵背景、框选、卡片/便签节点折叠与调宽、Section 容器跟随与自动扩边、SVG 贝塞尔连线）。
  - `board-math.ts`：零 DOM 依赖的纯几何与排版函数（`screenToCanvas`、`zoomAtPoint`、`layoutDroppedCards`、`findContainingSection`、`nodesInSelectionBox`、`nearestRectSide`、`computeEdgeAnchorPoints`、`computeEdgeBezierPath`、`computeGroupBounds`）。
  - `exporters.ts`：白板导出器（导出为 Obsidian 原生 `.canvas` 或按 Section 空间顺序编排的 `.md` 文稿）。

### 2. 白板核心数据模型（`src/models.ts`）

```ts
export type WhiteboardNodeType = 'card' | 'text' | 'subboard';

export interface WhiteboardViewport {
    x: number;
    y: number;
    zoom: number;
}

export interface WhiteboardNode {
    id: string;                      // 画布节点实例 UUID
    type: WhiteboardNodeType;
    highlightId?: string;            // type === 'card' 时指向 HighlightNote.id（原子引用）
    subboardId?: string;             // type === 'subboard' 时指向子 WhiteboardDoc.id
    text?: string;                   // type === 'text' 时的自由便签文本
    x: number;
    y: number;
    width: number;
    height?: number;                 // 缺省自适应高度
    collapsed?: boolean;             // 折叠态仅显示单行标题栏
    color?: string;                  // 便签颜色或覆盖色
    sectionId?: string;              // 所属 WhiteboardSection.id
}

export interface WhiteboardSection {
    id: string;                      // Section UUID
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;                   // 预设或自定义颜色 ID
}

export interface WhiteboardEdge {
    id: string;                      // Edge UUID
    fromNodeId: string;
    toNodeId: string;
    fromSide?: 'top' | 'right' | 'bottom' | 'left';
    toSide?: 'top' | 'right' | 'bottom' | 'left';
    relation?: string;               // 可选语义关系（对应 CardLink.relation）
    label?: string;                  // 自定义连线文字
}

export interface WhiteboardDoc {
    id: string;                      // UUID v4
    title: string;
    parentId?: string;
    sourcePath?: string;
    viewport: WhiteboardViewport;
    nodes: WhiteboardNode[];
    sections: WhiteboardSection[];
    edges: WhiteboardEdge[];
    createdAt: number;               // Unix ms
    updatedAt: number;               // Unix ms
}
```

---

## 二、Linter 与代码质量强制规范

本仓库在 `eslint.config.mts` 中启用了 **`typescript-eslint`（Type-Checked）**、**`eslint-plugin-obsidianmd`** 以及针对白板模块的 **`whiteboard/*` 专属 AST 规则**。所有修改必须保证 `npm run lint` **0 errors & 新增/修改文件 0 warnings**。

### 1. 严禁使用 `eslint-disable` 绕过检查
- `eslint-comments/no-restricted-disable` 严禁通过注释禁用 `obsidianmd/*`、`no-console`、`@typescript-eslint/no-explicit-any`、`@typescript-eslint/no-deprecated`、`@microsoft/sdl/no-inner-html` 等规则。所有代码必须从实现上真正满足规则。

### 2. Obsidian DOM 与样式规范（`obsidianmd/*`）
- **禁止 `document.createElement`（`obsidianmd/prefer-create-el`）**：
  - 统一使用 `parent.createDiv(...)`、`parent.createSpan(...)`、`parent.createEl(...)`、`parent.createSvg(...)`，清空容器使用 `el.empty()`。
- **禁止 `innerHTML` / `outerHTML`（`@microsoft/sdl/no-inner-html`、`no-unsanitized/*`）**：
  - Markdown 渲染统一使用 `MarkdownRenderer.render(app, markdown, container, sourcePath, component)`。
- **禁止静态内联样式赋值与 `<style>` 标签（`obsidianmd/no-static-styles-assignment`、`obsidianmd/no-forbidden-elements`）**：
  - 静态样式必须写入根目录 `styles.css`；
  - 动态计算样式（如节点坐标 `left`/`top`/`width`、视口 `transform`、颜色变量 `--hl-card-mark`）**必须调用 `src/utils/css-props.ts` 的 `setCssProps(el, { ... })`**。
- **跨窗口与跨平台兼容（`obsidianmd/prefer-window-timers`、`obsidianmd/no-global-this`、`obsidianmd/prefer-instanceof`、`obsidianmd/no-nodejs-modules`）**：
  - 定时器必须使用 `window.setTimeout` / `window.clearTimeout` / `window.requestAnimationFrame`。
  - 禁止使用 `globalThis`，统一使用 `window` 或 `activeWindow`。
  - 跨窗口 DOM 类型收窄必须使用 `el.instanceOf(HTMLElement)`（Vault 文件使用 `file instanceof TFile` / `TFolder`，严禁 `as TFile` 强转）。
  - 本插件 `isDesktopOnly: false`，严禁引入 `fs`、`path`、`crypto` 等 Node.js 内置模块（路径用 `normalizePath`，UUID 用 `src/mocks/crypto.ts` 的 `randomUUID()`）。
- **视图与组件生命周期（`obsidianmd/no-plugin-as-component`、`obsidianmd/no-view-references-in-plugin`、`obsidianmd/detach-leaves`）**：
  - 严禁将 `this.plugin` 作为 `Component` 传给 `MarkdownRenderer.render`。
  - `HiLighterPlugin` 主类不得直接持有 `ItemView` 实例引用。
  - `onunload()` 中严禁调用 `detachLeavesOfType`。

### 3. TypeScript 严格类型与日志规范
- **禁止 `any`（`@typescript-eslint/no-explicit-any`）**：不确定类型统一使用 `unknown` + 类型守卫。
- **下标访问判空（`noUncheckedIndexedAccess: true`）**：数组/字典索引结果 `T | undefined` 必须判空后使用。
- **Promise 规范（`@typescript-eslint/no-floating-promises`、`@typescript-eslint/no-misused-promises`）**：不等待的异步调用必须显式加 `void`；同步事件回调内用 `() => { void asyncFn(); }` 包裹。
- **禁止 `console.log`（`no-console`）**：仅允许 `console.warn`、`console.error`、`console.debug`。

### 4. 白板专属强制 ESLint 规则（`eslint.config.mts` -> `whiteboard/*`）
针对 `src/whiteboard/**/*.ts`，`eslint.config.mts` 内置了以下 `error` 级 AST 规则：
1. **`whiteboard/require-pinned-edge-sides`**：构造 `WhiteboardEdge` 字面量（含 `fromNodeId` 与 `toNodeId`）时，必须显式包含 `fromSide` 与 `toSide`，防止移动卡片时连接点跳边。
2. **`whiteboard/require-prevent-default-on-interaction`**：任何启动 `this.interaction = { ... }`（拖拽/缩放/连线/框选/平移）的事件回调必须调用 `preventDefault()`，防止原生文本选中劫持 `mouseup`。
3. **`whiteboard/require-focus-on-selection-stop-propagation`**：任何修改选中状态（`selectedEdgeId` / `selectedSectionId` / `selectedNodeIds`）且调用了 `stopPropagation()` 的回调，必须调用 `focus(...)` 使画布根容器保持焦点，确保 `Delete / Backspace / Escape` 快捷键可用。
4. **`whiteboard/no-space-in-svg-cls`**：严禁向 `createSvg` 的 `cls` 传入包含空格的字符串或模板字面量（避免 `DOMTokenList.add` 抛出 `InvalidCharacterError`），多类名需使用 `classList.add(...)` 单独追加。
5. **`whiteboard/require-visual-sync-on-node-selection`**：凡是修改 `this.selectedNodeIds` 的函数，必须在同一函数内调用 `updateSelectionVisuals()`、`renderNodes()` 或 `renderAll()` 保持 DOM 选中态同步。
6. **`whiteboard/require-group-bounds-for-section`**：凡是向 `this.doc.sections` 添加新分区的函数，必须调用 `computeGroupBounds(...)` 将选中卡片及其内部三次贝塞尔连线弧度一并纳入分区边界。
7. **`whiteboard/require-collapsed-guard-on-node-body`**：凡是创建 `.hl-wb-node-body` 的渲染函数，必须包含针对 `.collapsed` 的 `if` 条件守卫，确保折叠态节点不渲染正文区域。

---

## 三、验证命令

每次修改代码后必须依次执行并通过以下检查：

```bash
npm run lint
npm test
npm run build
```
