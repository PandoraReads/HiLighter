// ============================================================
// HiLighter - AI Service (Unified OpenAI-Compatible)
// ============================================================

import { requestUrl } from 'obsidian';
import type { HiLighterSettings, AIModelConfig } from './models';
import { t } from './i18n';
import { deriveModelsUrl, resolveModelAlias } from './ai-endpoint';

const DEFAULT_TEMPERATURE = 0.7;

// Minimal OpenAI-compatible response shapes (only the fields this service reads).
interface AIModelsListResponse {
    data?: Array<{ id?: string }>;
}

interface AIChatCompletionResponse {
    choices: Array<{ message: { content: string } }>;
}

function isTitled(value: unknown): value is { title?: string; name?: string; text?: string } {
    return typeof value === 'object' && value !== null;
}

// ── Model list fetching (shared by settings UI and error enrichment) ──

const MODEL_LIST_TTL_MS = 10 * 60 * 1000;
const modelListCache = new Map<string, { ids: string[]; ts: number }>();

/**
 * Fetch the model ids available for an OpenAI-compatible key
 * (GET {base}/models). Free request. Throws with a status-coded message
 * when the endpoint cannot be read (bad URL, invalid key, etc.).
 */
export async function fetchAvailableModels(baseUrl: string, apiKey: string, cacheKey?: string): Promise<string[]> {
    if (cacheKey) {
        const hit = modelListCache.get(cacheKey);
        if (hit && Date.now() - hit.ts < MODEL_LIST_TTL_MS) return hit.ids;
    }
    const url = deriveModelsUrl(baseUrl);
    if (!url) {
        throw new Error(t('ai.error.noUrl'));
    }

    let status = 0;
    let json: AIModelsListResponse | null = null;
    try {
        const resp = await requestUrl({
            url,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        status = resp.status;
        json = resp.json as AIModelsListResponse | null;
    } catch (err) {
        // Obsidian's requestUrl rejects with "Request failed, status NNN"
        const m = /status (\d+)/.exec(err instanceof Error ? err.message : String(err));
        throw new Error(t('modal.modelEdit.fetchFailed', { status: m?.[1] || '?' }));
    }
    if (status !== 200) {
        throw new Error(t('modal.modelEdit.fetchFailed', { status }));
    }

    const ids: string[] = Array.isArray(json?.data)
        ? json.data.map(d => String(d?.id ?? '')).filter(Boolean).sort()
        : [];
    if (cacheKey) {
        if (modelListCache.size > 50) modelListCache.clear();
        modelListCache.set(cacheKey, { ids, ts: Date.now() });
    }
    return ids;
}

export type AIAction = 'translate' | 'annotate' | 'research' | 'explain';
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

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

    private getActiveModel(modelId = this.settings.activeModelId): AIModelConfig {
        const model = this.settings.aiModels.find(m => m.id === modelId);
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
        return await this.queryOpenAICompat(model.baseUrl, model.model, model.apiKey, prompt, model.temperature);
    }

    async chat(messages: readonly ChatMessage[], modelId?: string): Promise<string> {
        if (!messages.length || messages.some(message => !message.content.trim())) throw new Error('Empty chat message');
        const model = this.getActiveModel(modelId);
        return this.queryOpenAICompat(model.baseUrl, model.model, model.apiKey, '', model.temperature, messages);
    }

    /**
     * Ask the AI to extract the section/chapter titles of an article.
     * Returns a cleaned, de-duplicated list (may be empty).
     */
    async extractSectionTitles(fullText: string): Promise<string[]> {
        const model = this.getActiveModel();
        const prompt = this.buildHeadingsPrompt(fullText);
        const raw = await this.queryOpenAICompat(model.baseUrl, model.model, model.apiKey, prompt, model.temperature);
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
            let parsed: unknown;
            try {
                parsed = JSON.parse(s);
            } catch {
                /* fall through */
            }
            if (!Array.isArray(parsed)) {
                return null;
            }
            return parsed
                .map((item: unknown) => typeof item === 'string'
                    ? item
                    : (isTitled(item) ? String(item.title ?? item.name ?? item.text ?? '') : ''))
                .map(s => String(s).trim())
                .filter(Boolean);
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
            case 'explain': {
                const targetLang = this.settings.translationTargetLang || '中文';
                return `你是一位语言与知识注释助手。请用${targetLang}为下面的文本写一条简短的读书注释：解释它的含义、关键难点或必要的背景，最多 4 句话。直接输出注释正文，不要引用原文，不要加标题、列表或任何前后缀。

"${text}"`;
            }
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
    private async queryOpenAICompat(url: string, model: string, apiKey: string, prompt: string, temperature?: number, conversation?: readonly ChatMessage[]): Promise<string> {
        if (!url) {
            throw new Error(t('ai.error.noUrl'));
        }
        if (!model) {
            throw new Error(t('ai.error.noModel'));
        }

        const resolved = resolveModelAlias(model);

        const payload = {
            model: resolved.id,
            messages: [
                { role: 'system', content: 'You are a helpful assistant specialized in text analysis, translation, and research.' },
                ...(conversation ?? [{ role: 'user' as const, content: prompt }])
            ],
            temperature: temperature ?? DEFAULT_TEMPERATURE
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

            const data = resp.json as AIChatCompletionResponse;
            // Indexing is non-null asserted (erased at runtime): malformed responses
            // throw the same TypeError as before and land in the catch below.
            return data.choices[0]!.message.content.trim();
        } catch (err) {
            console.error('[HiLighter] API error', err);
            const message = await this.enrichError(url, apiKey, resolved.id, err);
            throw new Error(t('ai.error.serviceFailed', { message }));
        }
    }

    /**
     * Turn a bare "Request failed, status 400" into an actionable message:
     * on a 400/404, ask the provider which models the key can actually use
     * and tell the user when the configured model id is not among them.
     */
    private async enrichError(url: string, apiKey: string, modelId: string, err: unknown): Promise<string> {
        const original = (err instanceof Error ? err.message : '') || String(err);
        const m = /status (\d+)/.exec(original);
        const status = Number(m?.[1]);
        // 400 = bad request (unknown model on most providers); 404 = model_not_found (OpenAI et al.)
        if (status !== 400 && status !== 404) {
            return original;
        }
        try {
            const ids = await fetchAvailableModels(url, apiKey, url);
            if (ids.length > 0 && !ids.includes(modelId)) {
                return t('ai.error.modelNotAvailable', { model: modelId, list: ids.slice(0, 8).join(', ') });
            }
        } catch {
            // Provider has no readable /models endpoint - keep the original error
        }
        return original;
    }
}
