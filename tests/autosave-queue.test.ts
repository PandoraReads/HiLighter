import { describe, expect, it, vi } from 'vitest';
import { AutosaveQueue } from '../src/studio/autosave-queue';

describe('card autosave queue', () => {
    it('coalesces edits and flushes the latest value', async () => {
        const save = vi.fn(async (_value: string) => {});
        const queue = new AutosaveQueue(save, () => {}, 10000);
        queue.schedule('first');
        queue.schedule('last');
        await queue.flush();
        expect(save.mock.calls.map(call => call[0])).toEqual(['last']);
    });
    it('serializes saves and keeps edits made during a save', async () => {
        let release!: () => void;
        const wait = new Promise<void>(resolve => { release = resolve; });
        const saved: string[] = [];
        const queue = new AutosaveQueue<string>(async value => { saved.push(value); if (value === 'a') await wait; }, () => {}, 10000);
        queue.schedule('a');
        const first = queue.flush();
        queue.schedule('b');
        const second = queue.flush();
        release();
        await Promise.all([first, second]);
        expect(saved).toEqual(['a', 'b']);
    });
});
