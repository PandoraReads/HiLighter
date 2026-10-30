import { describe, expect, it } from 'vitest';
import { selectLocalVoice } from '../src/selection/lookup-speech';

describe('lookup pronunciation voice selection', () => {
    const voices = [
        { lang: 'en-US', localService: true, name: 'English' },
        { lang: 'zh-TW', localService: true, name: 'Taiwan' },
        { lang: 'zh-CN', localService: false, name: 'Remote' },
        { lang: 'zh-CN', localService: true, name: 'Mandarin' },
    ];
    it('prefers an exact local language match', () => expect(selectLocalVoice(voices, 'zh-CN')?.name).toBe('Mandarin'));
    it('falls back to a local voice in the same language', () => expect(selectLocalVoice(voices, 'en-GB')?.name).toBe('English'));
    it('never selects a remote voice or a different language', () => expect(selectLocalVoice([{ lang: 'zh-CN', localService: false }], 'zh-CN')).toBeNull());
    it('prefers a natural female local voice when available', () => {
        const options = [{ lang: 'zh-CN', localService: true, name: 'Default' }, { lang: 'zh-CN', localService: true, name: 'Xiaoxiao Natural' }];
        expect(selectLocalVoice(options, 'zh-CN')?.name).toBe('Xiaoxiao Natural');
    });
});
