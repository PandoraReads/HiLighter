// ============================================================
// HiLighter - AI endpoint helpers
// Pure functions: URL derivation and model-id alias resolution.
// ============================================================

/**
 * Derive the OpenAI-compatible `GET /models` list URL from a chat
 * completions endpoint URL.
 *
 * Covers every shape providers use in AI_MODEL_PRESETS:
 *   .../chat/completions -> .../models
 *   .../v1               -> .../v1/models
 *   anything else        -> append /models
 */
export function deriveModelsUrl(baseUrl: string): string {
    const url = baseUrl.trim().replace(/\/+$/, '');
    if (!url) return url;
    if (url.endsWith('/models')) return url;
    if (url.endsWith('/chat/completions')) {
        return url.slice(0, -'/chat/completions'.length) + '/models';
    }
    return url + '/models';
}

/**
 * Common product/marketing names -> the model id the API actually accepts.
 * Keys are lower-cased; lookup is case-insensitive.
 */
const MODEL_ALIASES: Record<string, string> = {
    // DeepSeek
    'deepseek-v3': 'deepseek-chat',
    'deepseek-v3.1': 'deepseek-chat',
    'deepseek-v3-0324': 'deepseek-chat',
    'deepseek-chat-v3': 'deepseek-chat',
    'deepseek-r1': 'deepseek-reasoner',
    // Kimi / Moonshot
    'kimi-k2': 'kimi-k2-0905-preview',
    'kimi': 'kimi-latest',
    'moonshot': 'kimi-latest',
    // OpenAI
    'gpt-4': 'gpt-4o',
    'gpt4': 'gpt-4o',
    'gpt-3.5': 'gpt-3.5-turbo',
    'gpt3.5': 'gpt-3.5-turbo',
};

export interface ResolvedModel {
    id: string;
    /** Original input when a correction was applied, else undefined. */
    correctedFrom?: string;
}

/**
 * Resolve a user-typed model id through the alias table.
 * Unknown ids pass through unchanged (never guess beyond the table).
 */
export function resolveModelAlias(input: string): ResolvedModel {
    const id = input.trim();
    const alias = MODEL_ALIASES[id.toLowerCase()];
    if (alias && alias !== id) {
        return { id: alias, correctedFrom: id };
    }
    return { id };
}
