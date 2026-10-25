import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { AIService, fetchAvailableModels } from '../src/ai-service';
import { DEFAULT_SETTINGS } from '../src/models';
import { setLang } from '../src/i18n';
import type { HiLighterSettings } from '../src/models';

beforeEach(() => {
    setLang('en');
    requestUrlMock.mockReset();
});

describe('fetchAvailableModels', () => {
    it('returns sorted model ids and filters empty entries', async () => {
        requestUrlMock.mockResolvedValue({
            status: 200,
            json: { data: [{ id: 'b-model' }, { id: 'a-model' }, { id: '' }, {}] },
        });
        const ids = await fetchAvailableModels('https://api.example.com/v1/chat/completions', 'sk-x');
        expect(ids).toEqual(['a-model', 'b-model']);
        expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://api.example.com/v1/models',
            method: 'GET',
        }));
    });

    it('throws a status-coded message when requestUrl rejects', async () => {
        requestUrlMock.mockRejectedValue(new Error('Request failed, status 401'));
        await expect(fetchAvailableModels('https://api.example.com/v1', 'sk-bad'))
            .rejects.toThrow('HTTP 401');
    });

    it('returns an empty array when data is missing or not an array', async () => {
        requestUrlMock.mockResolvedValue({ status: 200, json: {} });
        expect(await fetchAvailableModels('https://api.example.com/v1', 'sk-x')).toEqual([]);
    });

    it('serves repeated calls from the cache within the TTL', async () => {
        requestUrlMock.mockResolvedValue({ status: 200, json: { data: [{ id: 'm1' }] } });
        const a = await fetchAvailableModels('https://api.example.com/v1', 'sk-x', 'cache-key-1');
        const b = await fetchAvailableModels('https://api.example.com/v1', 'sk-x', 'cache-key-1');
        expect(a).toEqual(['m1']);
        expect(b).toEqual(['m1']);
        expect(requestUrlMock).toHaveBeenCalledTimes(1);
    });
});

function serviceWithModel(model: string, baseUrl = 'https://api.example.com/v1/chat/completions'): AIService {
    const settings: HiLighterSettings = {
        ...DEFAULT_SETTINGS,
        aiModels: [{
            id: 'm1',
            name: 'Test',
            baseUrl,
            model,
            apiKey: 'sk-x',
        }],
        activeModelId: 'm1',
    };
    return new AIService(settings);
}

/** POST rejects with the given status; GET /models resolves with the given ids. */
function mockChatFailModelsOk(status: number, modelIds: string[]): void {
    requestUrlMock.mockImplementation((req: { method: string }) => {
        if (req.method === 'POST') {
            return Promise.reject(new Error(`Request failed, status ${status}`));
        }
        return Promise.resolve({ status: 200, json: { data: modelIds.map(id => ({ id })) } });
    });
}

describe('queryOpenAICompat error enrichment', () => {
    it('on 400 with an unknown model, reports the models the key can use', async () => {
        mockChatFailModelsOk(400, ['good-model']);
        await expect(serviceWithModel('bad-model', 'https://a.example.com/v1/chat/completions').processAction('hello', 'translate'))
            .rejects.toThrow('Model "bad-model" is not available for this key. Available models: good-model');
    });

    it('also enriches 404 model_not_found errors', async () => {
        mockChatFailModelsOk(404, ['good-model']);
        await expect(serviceWithModel('bad-model', 'https://b.example.com/v1/chat/completions').processAction('hello', 'translate'))
            .rejects.toThrow('not available for this key');
    });

    it('keeps the original error when the model is in the available list', async () => {
        mockChatFailModelsOk(400, ['bad-model', 'other-model']);
        await expect(serviceWithModel('bad-model', 'https://c.example.com/v1/chat/completions').processAction('hello', 'translate'))
            .rejects.toThrow('status 400');
    });

    it('keeps the original error for non-400/404 statuses', async () => {
        mockChatFailModelsOk(401, ['good-model']);
        await expect(serviceWithModel('bad-model', 'https://d.example.com/v1/chat/completions').processAction('hello', 'translate'))
            .rejects.toThrow('status 401');
    });

    it('falls back to the original error when /models cannot be read', async () => {
        requestUrlMock.mockRejectedValue(new Error('Request failed, status 400'));
        await expect(serviceWithModel('bad-model', 'https://e.example.com/v1/chat/completions').processAction('hello', 'translate'))
            .rejects.toThrow('status 400');
    });
});
