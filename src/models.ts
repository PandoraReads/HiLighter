// ============================================================
// HiLighter - Data Models
// ============================================================

/**
 * A saved research prompt with a name
 */
export interface ResearchPrompt {
    id: string;
    name: string;
    prompt: string;
}

/**
 * Plugin settings stored in data.json
 */
export interface HiLighterSettings {
    // AI Integration
    aiProvider: 'deepseek' | 'gemini' | 'ark' | 'custom';
    deepseekApiKey: string;
    geminiApiKey: string;
    geminiModel: string;
    arkApiKey: string;
    customApiKey: string;
    customApiUrl: string;
    customModel: string;
    researchPrompt: string;           // Legacy - kept for migration
    researchPrompts: ResearchPrompt[];
    activeResearchPromptId: string;
    // UI
    ribbonHighlightIcon: boolean;
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
    aiProvider: 'deepseek',
    deepseekApiKey: '',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    arkApiKey: '',
    customApiKey: '',
    customApiUrl: '',
    customModel: '',
    researchPrompt: '',
    researchPrompts: DEFAULT_RESEARCH_PROMPTS,
    activeResearchPromptId: 'philosopher',
    ribbonHighlightIcon: true,
};

/**
 * Highlight Note entry stored in IndexedDB
 */
export interface HighlightNote {
    id: string;              // UUID v4
    text: string;            // The highlighted text
    color: 'yellow' | 'pink' | 'blue' | 'green';
    note: string;            // User's personal note + AI results
    sourcePath: string;      // Vault-relative path to the source note
    lineIndex: number;       // Line index for quick jumping
    createdAt: number;       // Unix timestamp (ms)
    tags?: string[];         // User tags
}
