// ============================================================
// HiLighter - Data Models
// ============================================================

/** Built-in visual themes for the management interface */
export type ThemeId =
    | 'editorial'
    | 'native'
    | 'paper'
    | 'ocean'
    | 'forest'
    | 'galaxy'
    | 'cyber'
    | 'sunset'
    | 'rose';

/** Card density levels */
export type CardDensity = 'comfortable' | 'cozy' | 'compact';

/** Studio gallery column count */
export type StudioColumns = 'auto' | 1 | 2 | 3 | 4;

/** Sidebar scope: current file only, or entire vault */
export type SidebarScope = 'active' | 'all';

/** Per-color semantic labels (empty string = no label shown) */
export type ColorLabels = {
    yellow: string;
    pink: string;
    blue: string;
    green: string;
};

/** A user-defined highlight color (id format: c_xxxxxxxx) */
export interface CustomColor {
    id: string;
    name: string;
    hex: string;            // '#rrggbb'
}

/** Where a note is anchored (absent = classic markdown <mark> anchor) */
export type AnchorType = 'markdown' | 'note' | 'pdf' | 'epub';

/**
 * FSRS scheduling state stored on a highlight (plain numbers so it
 * survives Dexie + JSON sync; absent = brand-new card).
 * Mirrors ts-fsrs Card with Date ↔ epoch-ms conversion in src/fsrs.ts.
 */
export interface FsrsState {
    due: number;            // epoch ms
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: number;          // ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning
    lastReview?: number;    // epoch ms; absent for never-reviewed
}

/** FSRS scheduling settings */
export interface FsrsSettings {
    desiredRetention: number;   // 0.7 - 0.99
    newPerDay: number;          // max new cards mixed into a session
    enableFuzz: boolean;        // ts-fsrs enable_fuzz
}

/** Click-to-note trigger settings */
export interface NotePopupSettings {
    doubleClick: boolean;       // double-click a word opens the note popup
    modifierClick: boolean;     // Cmd/Ctrl+click a word opens it (edit mode)
    singleClick: boolean;       // plain click a word opens it (reading mode only)
}

/**
 * A saved research prompt with a name
 */
export interface ResearchPrompt {
    id: string;
    name: string;
    prompt: string;
}

/**
 * User-configured AI model
 */
export interface AIModelConfig {
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    apiKey: string;
}

export const AI_MODEL_PRESETS: Omit<AIModelConfig, 'id' | 'apiKey'>[] = [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
    { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.5-flash' },
    { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
    { name: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo' },
    { name: 'Doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: 'doubao-1-5-lite-32k-250115' },
    { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
];

/**
 * Plugin settings stored in data.json
 */
export interface HiLighterSettings {
    // AI Integration
    aiModels: AIModelConfig[];
    activeModelId: string;
    researchPrompt: string;           // Legacy - kept for migration
    researchPrompts: ResearchPrompt[];
    activeResearchPromptId: string;
    // Legacy AI fields - kept for migration
    aiProvider?: string;
    deepseekApiKey?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    arkApiKey?: string;
    customApiKey?: string;
    customApiUrl?: string;
    customModel?: string;
    // UI
    ribbonHighlightIcon: boolean;
    // Appearance
    theme: ThemeId;
    cardDensity: CardDensity;
    accentColor: string;            // Custom accent hex; empty = theme default
    studioColumns: StudioColumns;
    sidebarScope: SidebarScope;
    colorLabels: ColorLabels;
    customColors: CustomColor[];
    fsrs: FsrsSettings;
    notePopup: NotePopupSettings;
    pdfOverlay: boolean;            // best-effort PDF textLayer highlight overlay
    epubProgress: Record<string, string>;   // epub path -> last-read CFI
    // Internationalization
    language: 'zh' | 'en';
    translationTargetLang: string;
    // Desktop Shortcut
    useShortcut: boolean;            // When true, menu shows only after pressing the shortcut; when false, it shows on selection
    highlightShortcut: string;
    // Sync
    syncEnabled: boolean;
    syncFilePath: string;
    syncOnUnload: boolean;
    syncAutoImport: boolean;
    syncAutoExport: boolean;
}

const DEFAULT_PHILOSOPHER_PROMPT = `你是一位充满智慧且言简意赅的哲学家朋友。请对以下文本进行深度解析，并按以下三层结构组织：

## 哲学提炼
用极简且富有哲思的语言，提炼出这段文字核心的本质。

## 概念透视
提取文本中的关键术语或核心概念，深度解析其本源意义、历史背景及扩展知识。保持高信息密度，严禁使用三级标题，仅限二级。

## 实践路径（可选）
若内容与个人成长或工作实践相关，请提供凝练的行动启发。`;

const DEFAULT_SUMMARY_PROMPT = `你是一位专业的知识管理顾问。请对以下文本进行精炼摘要，并按以下结构组织：

## 核心观点
用一到三句话概括文本最重要的观点。

## 关键论据
列出支撑核心观点的主要论据或事实。

## 延伸思考
基于文本内容，提出一个值得深入探讨的问题或视角。`;

const DEFAULT_CRITICAL_PROMPT = `你是一位严谨的学术评论家。请对以下文本进行批判性分析：

## 论证结构
梳理文本的论证逻辑和结构框架。

## 亮点与不足
指出文本论证中的亮点以及可能存在的逻辑漏洞或薄弱环节。

## 改进建议
如果作者要改进这段论述，你会给出什么建议？`;

export const DEFAULT_RESEARCH_PROMPTS: ResearchPrompt[] = [
    { id: 'philosopher', name: '哲学解析', prompt: DEFAULT_PHILOSOPHER_PROMPT },
    { id: 'summary', name: '精炼摘要', prompt: DEFAULT_SUMMARY_PROMPT },
    { id: 'critical', name: '批判分析', prompt: DEFAULT_CRITICAL_PROMPT },
];

export const DEFAULT_SETTINGS: HiLighterSettings = {
    aiModels: [],
    activeModelId: '',
    researchPrompt: '',
    researchPrompts: DEFAULT_RESEARCH_PROMPTS,
    activeResearchPromptId: 'philosopher',
    ribbonHighlightIcon: true,
    theme: 'editorial',
    cardDensity: 'comfortable',
    accentColor: '',
    studioColumns: 'auto',
    sidebarScope: 'active',
    colorLabels: { yellow: '', pink: '', blue: '', green: '' },
    customColors: [],
    fsrs: { desiredRetention: 0.9, newPerDay: 20, enableFuzz: false },
    notePopup: { doubleClick: true, modifierClick: true, singleClick: true },
    pdfOverlay: true,
    epubProgress: {},
    language: 'zh',
    translationTargetLang: '中文',
    highlightShortcut: '',
    useShortcut: false,
    syncEnabled: false,
    syncFilePath: '.hilighter/sync-data.json',
    syncOnUnload: true,
    syncAutoImport: true,
    syncAutoExport: true,
};

/**
 * Highlight Note entry stored in IndexedDB
 */
export interface HighlightNote {
    id: string;              // UUID v4
    text: string;            // The highlighted text
    color: string;           // Preset id ('yellow'|'pink'|'blue'|'green') or custom id ('c_xxxxxxxx')
    note: string;            // User's personal note + AI results
    sourcePath: string;      // Vault-relative path to the source note
    lineIndex: number;       // Line index for quick jumping
    createdAt: number;       // Unix timestamp (ms)
    tags?: string[];         // User tags
    pinned?: number;         // Pin timestamp (0 / undefined = unpinned); larger = higher up
    // v2 record additions (all optional → backward compatible)
    anchorType?: AnchorType;     // Absent = 'markdown'
    pdfPage?: number;            // PDF anchor page (1-based)
    cfi?: string;                // EPUB CFI anchor
    contextQuote?: string;       // Surrounding text for DB-only anchors
    colorHex?: string;           // Hex snapshot, written when the color is custom
    fsrs?: FsrsState;            // Absent = new card
}

/** A deleted highlight id + when it was deleted (cross-device delete propagation). */
export interface SyncTombstone {
    id: string;
    deletedAt: number;
}
