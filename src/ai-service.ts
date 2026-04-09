// ============================================================
// HiLighter - AI Service
// ============================================================

import { requestUrl } from 'obsidian';
import type { EMESettings } from './models';

export type AIAction = 'translate' | 'annotate' | 'research';

const DEFAULT_RESEARCH_PROMPT = `你是一位充满智慧且言简意赅的哲学家朋友。请对以下文本进行深度解析，并按以下三层结构组织：

## 哲学提炼
用极简且富有哲思的语言，提炼出这段文字核心的本质。

## 概念透视
提取文本中的关键术语或核心概念，深度解析其本源意义、历史背景及扩展知识。保持高信息密度，严禁使用三级标题，仅限二级。

## 实践路径（可选）
若内容与个人成长或工作实践相关，请提供凝练的行动启发。`;

export class AIService {
    private settings: EMESettings;

    constructor(settings: EMESettings) {
        this.settings = settings;
    }

    async processAction(text: string, action: AIAction): Promise<string> {
        const provider = this.settings.aiProvider;
        const apiKey = this.getApiKey(provider);

        if (!apiKey) {
            throw new Error(`未配置 ${provider} 的 API Key，请在设置中填写`);
        }

        const prompt = this.getPrompt(text, action);

        switch (provider) {
            case 'deepseek':
                return await this.queryOpenAICompat('https://api.deepseek.com/chat/completions', 'deepseek-chat', apiKey, prompt);
            case 'gemini':
                return await this.queryGemini(apiKey, this.settings.geminiModel || 'gemini-pro', prompt);
            case 'ark':
                return await this.queryOpenAICompat('https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'doubao-1-5-lite-32k-250115', apiKey, prompt);
            case 'custom':
                return await this.queryOpenAICompat(this.settings.customApiUrl, this.settings.customModel, apiKey, prompt);
            default:
                throw new Error('未知的 AI 提供商');
        }
    }

    private getApiKey(provider: string): string {
        switch (provider) {
            case 'deepseek': return this.settings.deepseekApiKey;
            case 'gemini': return this.settings.geminiApiKey;
            case 'ark': return this.settings.arkApiKey;
            case 'custom': return this.settings.customApiKey;
            default: return '';
        }
    }

    private getPrompt(text: string, action: AIAction): string {
        const strictSuffix = '\n\n**要求**：请直接返回核心结果，严禁包含任何如"好的"、"作为你的助手"、"下面是结果"、"为您提供"等引导性词汇或客套话。只输出最关键、最重要的信息内容。';
        switch (action) {
            case 'translate':
                return `你是一个专业的翻译工具。请直接返回翻译结果，**严禁包含**任何如"好的"、"作为你的助手"、"下面是结果"、"为您提供"、"翻译"、"翻译为"、"语种"等引导性词汇或说明文字。

只输出**纯文本翻译结果**：

"${text}"`;
            case 'annotate':
                return `你是一个语言学专家和百科全书。请对以下文本中的生僻词汇、重难点、术语或特殊表达进行深入注解。解释其含义、语法、词义辨析及背景知识。"${text}"${strictSuffix}`;
            case 'research':
                const userPrompt = this.settings.researchPrompt?.trim();
                const researchInstruction = userPrompt || DEFAULT_RESEARCH_PROMPT;
                return `${researchInstruction}\n\n"${text}"${strictSuffix}`;
            default:
                return text;
        }
    }

    /**
     * Generic OpenAI-compatible API caller (works with DeepSeek, Ark, and any custom endpoint)
     */
    private async queryOpenAICompat(url: string, model: string, apiKey: string, prompt: string): Promise<string> {
        if (!url) {
            throw new Error('API URL 未配置，请在设置中填写');
        }
        if (!model) {
            throw new Error('模型名称未配置，请在设置中填写');
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
                throw new Error(`API 返回错误 (${resp.status}): ${resp.text}`);
            }

            return resp.json.choices[0].message.content.trim();
        } catch (err: any) {
            console.error('[HiLighter] API error', err);
            throw new Error(`AI 服务调用失败: ${err.message}`);
        }
    }

    private async queryGemini(apiKey: string, model: string, prompt: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        // 最多重试 3 次，每次间隔增加
        const maxRetries = 3;
        let lastError: Error | null = null;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const resp = await requestUrl({
                    url,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (resp.status === 503) {
                    lastError = new Error(`Gemini 服务暂时不可用 (503), 正在重试...`);
                    console.warn(`[HiLighter] Gemini 503 重试 ${i+1}/${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i+1))); // 1秒、2秒、3秒
                    continue;
                }

                if (resp.status !== 200) {
                    throw new Error(`API 返回错误 (${resp.status}): ${resp.text}`);
                }

                return resp.json.candidates[0].content.parts[0].text.trim();
            } catch (err: any) {
                lastError = err;
                if (err.message?.includes('503') || err.message?.includes('Service Unavailable')) {
                    console.warn(`[HiLighter] Gemini 503 重试 ${i+1}/${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i+1)));
                    continue;
                }
                break;
            }
        }

        if (lastError?.message?.includes('503') || lastError?.message?.includes('Service Unavailable')) {
            throw new Error('Gemini 服务暂时不可用 (503)，请稍后重试');
        }
        throw lastError || new Error('Gemini 服务调用失败');
    }
}
