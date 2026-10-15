// ============================================================
// HiLighter - AI Service (Unified OpenAI-Compatible)
// ============================================================

import { requestUrl } from 'obsidian';
import type { HiLighterSettings, AIModelConfig } from './models';
import { t } from './i18n';

export type AIAction = 'translate' | 'annotate' | 'research';

const DEFAULT_RESEARCH_PROMPT = `你是一位充满智慧且言简意赅的哲学家朋友。请对以下文本进行深度解析，并按以下三层结构组织：

## 哲学提炼
用极简且富有哲思的语言，提炼出这段文字核心的本质。

## 概念透视
提取文本中的关键术语或核心概念，深度解析其本源意义、历史背景及扩展知识。保持高信息密度，严禁使用三级标题，仅限二级。

## 实践路径（可选）
若内容与个人成长或工作实践相关，请提供凝练的行动启发。`;

export class AIService {
    private settings: HiLighterSettings;

    constructor(settings: HiLighterSettings) {
        this.settings = settings;
    }

    updateSettings(settings: HiLighterSettings) {
        this.settings = settings;
    }

    private getActiveModel(): AIModelConfig {
        const model = this.settings.aiModels.find(m => m.id === this.settings.activeModelId);
        if (!model) {
            throw new Error(t('ai.error.noActiveModel'));
        }
        if (!model.apiKey) {
            throw new Error(t('ai.error.noKey', { provider: model.name }));
        }
        return model;
    }

    async processAction(text: string, action: AIAction, promptId?: string): Promise<string> {
        const model = this.getActiveModel();
        const prompt = this.getPrompt(text, action, promptId);
        return await this.queryOpenAICompat(model.baseUrl, model.model, model.apiKey, prompt);
    }

    async processFullText(fullText: string, highlights: string[], promptId?: string): Promise<string> {
        const model = this.getActiveModel();
        const prompt = this.buildFullTextPrompt(fullText, highlights, promptId);
        return await this.queryOpenAICompat(model.baseUrl, model.model, model.apiKey, prompt);
    }

    /**
     * Ask the AI to extract the section/chapter titles of an article.
     * Returns a cleaned, de-duplicated list (may be empty).
     */
    async extractSectionTitles(fullText: string): Promise<string[]> {
        const model = this.getActiveModel();
        const prompt = this.buildHeadingsPrompt(fullText);
        const raw = await this.queryOpenAICompat(model.baseUrl, model.model, model.apiKey, prompt);
        return this.parseTitleList(raw);
    }

    private buildHeadingsPrompt(fullText: string): string {
        return `请分析下面这篇文章的结构，提取出它的章节标题 / 小标题（即文章各级章节的名称）。

要求：
- 返回一个 JSON 字符串数组，例如 ["引言", "研究方法", "结论"]，按文中出现顺序排列。
- 只保留真实的内容性标题，忽略导航、目录、页脚、广告等非正文元素。
- 标题保持原文措辞：不要改写、不要加编号、不要包含 Markdown 的 # 符号或列表符号。
- 如果文章没有清晰的章节结构，返回空数组 []。
- 只输出 JSON 数组本身，不要任何解释、前后缀或代码块标记。

## 文章内容
${fullText}`;
    }

    private parseTitleList(raw: string): string[] {
        if (!raw) return [];
        const fenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

        const tryParseArray = (s: string): string[] | null => {
            try {
                const parsed = JSON.parse(s);
                if (Array.isArray(parsed)) {
                    return parsed
                        .map(item => typeof item === 'string'
                            ? item
                            : (item && typeof item === 'object' ? String(item.title ?? item.name ?? item.text ?? '') : ''))
                        .map(s => String(s).trim())
                        .filter(Boolean);
                }
            } catch {
                /* fall through */
            }
            return null;
        };

        let titles = tryParseArray(fenced);

        // Fallback: pull the first JSON array out of surrounding prose
        if (!titles) {
            const match = fenced.match(/\[[\s\S]*\]/);
            if (match) titles = tryParseArray(match[0]);
        }

        // Fallback: line-based parsing (strip markdown heading / list markers)
        if (!titles) {
            titles = fenced
                .split('\n')
                .map(line => line.replace(/^\s*(?:#{1,6}\s*|[-*+]\s*|\d+[.)]\s*)/, '').trim())
                .filter(line => line.length > 0 && line.length <= 120);
        }

        // Normalize: trim quote chars, de-duplicate (case-insensitive), cap the count
        const seen = new Set<string>();
        return titles
            .map(t => t.replace(/^[\s"'""'']+|[\s"'""'']+$/g, '').trim())
            .filter(t => t.length > 0 && t.length <= 120)
            .filter(t => {
                const key = t.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 60);
    }

    private buildFullTextPrompt(fullText: string, highlights: string[], promptId?: string): string {
        const activePrompt = promptId
            ? this.settings.researchPrompts?.find(p => p.id === promptId)
            : this.settings.researchPrompts?.find(p => p.id === this.settings.activeResearchPromptId);
        const researchInstruction = activePrompt?.prompt || DEFAULT_RESEARCH_PROMPT;

        const highlightsSection = highlights.length > 0
            ? `\n\n## 用户高亮摘录\n以下是用户在阅读时标记的重点内容，请特别关注这些部分：\n${highlights.map(h => `- ${h}`).join('\n')}`
            : '';

        return `${researchInstruction}\n\n## 全文内容\n${fullText}${highlightsSection}\n\n**Requirement**: Return only the core results. Do NOT include any introductory phrases like "Sure", "As your assistant", "Here are the results", etc. Output only the most critical and important information.`;
    }

    private getPrompt(text: string, action: AIAction, promptId?: string): string {
        const strictSuffix = '\n\n**Requirement**: Return only the core results. Do NOT include any introductory phrases like "Sure", "As your assistant", "Here are the results", etc. Output only the most critical and important information.';
        switch (action) {
            case 'translate': {
                const targetLang = this.settings.translationTargetLang || '中文';
                return `You are a professional translation tool. Please translate the following text into ${targetLang}. Return ONLY the plain text translation. Do NOT include any introductory words, explanations, or language labels.

"${text}"`;
            }
            case 'annotate':
                return `You are a linguistics expert and encyclopedia. Please provide in-depth annotations for rare words, difficulties, terminology, or special expressions in the following text. Explain their meanings, grammar, nuance distinctions, and background knowledge. "${text}"${strictSuffix}`;
            case 'research': {
                const activePrompt = promptId
                    ? this.settings.researchPrompts?.find(p => p.id === promptId)
                    : this.settings.researchPrompts?.find(p => p.id === this.settings.activeResearchPromptId);
                const researchInstruction = activePrompt?.prompt || DEFAULT_RESEARCH_PROMPT;
                return `${researchInstruction}\n\n"${text}"${strictSuffix}`;
            }
            default:
                return text;
        }
    }

    /**
     * Unified OpenAI-compatible API caller
     * Works with DeepSeek, Gemini (OpenAI mode), Kimi, Qwen, Doubao, OpenAI, Ollama, etc.
     */
    private async queryOpenAICompat(url: string, model: string, apiKey: string, prompt: string): Promise<string> {
        if (!url) {
            throw new Error(t('ai.error.noUrl'));
        }
        if (!model) {
            throw new Error(t('ai.error.noModel'));
        }

        const payload = {
            model,
            messages: [
                { role: 'system', content: 'You are a helpful assistant specialized in text analysis, translation, and research.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7
        };

        try {
            const resp = await requestUrl({
                url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (resp.status !== 200) {
                throw new Error(t('ai.error.apiError', { status: resp.status, text: resp.text }));
            }

            return resp.json.choices[0].message.content.trim();
        } catch (err: any) {
            console.error('[HiLighter] API error', err);
            throw new Error(t('ai.error.serviceFailed', { message: err.message }));
        }
    }
}
