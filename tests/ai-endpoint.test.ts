import { describe, it, expect } from 'vitest';
import { deriveModelsUrl, resolveModelAlias } from '../src/ai-endpoint';

describe('deriveModelsUrl', () => {
    it('replaces the /chat/completions suffix for every preset provider', () => {
        expect(deriveModelsUrl('https://api.deepseek.com/chat/completions'))
            .toBe('https://api.deepseek.com/models');
        expect(deriveModelsUrl('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'))
            .toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
        expect(deriveModelsUrl('https://api.moonshot.cn/v1/chat/completions'))
            .toBe('https://api.moonshot.cn/v1/models');
        expect(deriveModelsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'))
            .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models');
        expect(deriveModelsUrl('https://ark.cn-beijing.volces.com/api/v3/chat/completions'))
            .toBe('https://ark.cn-beijing.volces.com/api/v3/models');
        expect(deriveModelsUrl('https://api.openai.com/v1/chat/completions'))
            .toBe('https://api.openai.com/v1/models');
    });

    it('appends /models to plain versioned base urls', () => {
        expect(deriveModelsUrl('https://api.moonshot.cn/v1'))
            .toBe('https://api.moonshot.cn/v1/models');
    });

    it('strips trailing slashes before deriving', () => {
        expect(deriveModelsUrl('https://api.moonshot.cn/v1/'))
            .toBe('https://api.moonshot.cn/v1/models');
        expect(deriveModelsUrl('https://api.deepseek.com/chat/completions/'))
            .toBe('https://api.deepseek.com/models');
    });

    it('trims surrounding whitespace', () => {
        expect(deriveModelsUrl('  https://api.moonshot.cn/v1  '))
            .toBe('https://api.moonshot.cn/v1/models');
    });

    it('returns urls that already point at /models unchanged', () => {
        expect(deriveModelsUrl('https://api.openai.com/v1/models'))
            .toBe('https://api.openai.com/v1/models');
    });

    it('returns empty input unchanged', () => {
        expect(deriveModelsUrl('')).toBe('');
    });
});

describe('resolveModelAlias', () => {
    it('maps product names to real api model ids', () => {
        expect(resolveModelAlias('deepseek-v3').id).toBe('deepseek-chat');
        expect(resolveModelAlias('deepseek-r1').id).toBe('deepseek-reasoner');
        expect(resolveModelAlias('kimi-k2').id).toBe('kimi-k2-0905-preview');
        expect(resolveModelAlias('gpt-4').id).toBe('gpt-4o');
    });

    it('is case-insensitive', () => {
        expect(resolveModelAlias('DeepSeek-V3').id).toBe('deepseek-chat');
        expect(resolveModelAlias('GPT-4').id).toBe('gpt-4o');
        expect(resolveModelAlias('Kimi').id).toBe('kimi-latest');
    });

    it('reports the original input when a correction is applied', () => {
        const r = resolveModelAlias('deepseek-v3');
        expect(r.correctedFrom).toBe('deepseek-v3');
    });

    it('passes real model ids through untouched', () => {
        expect(resolveModelAlias('deepseek-chat')).toEqual({ id: 'deepseek-chat' });
        expect(resolveModelAlias('moonshot-v1-8k')).toEqual({ id: 'moonshot-v1-8k' });
        expect(resolveModelAlias('kimi-k2-0905-preview')).toEqual({ id: 'kimi-k2-0905-preview' });
    });

    it('trims whitespace and never guesses unknown ids', () => {
        expect(resolveModelAlias('  some-future-model  ')).toEqual({ id: 'some-future-model' });
    });
});
