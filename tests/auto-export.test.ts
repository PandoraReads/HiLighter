import { describe, it, expect, vi } from 'vitest';
import { AutoExportScheduler, type SchedulerHost } from '../src/sync/auto-export';

function makeHost(debounceMs: number) {
    let clock = 0;
    let timer: { at: number; cb: () => void; cancelled: boolean } | null = null;

    const host: SchedulerHost = {
        after: (ms, cb) => {
            timer = { at: clock + ms, cb, cancelled: false };
            return () => { if (timer) timer.cancelled = true; };
        },
    };

    return {
        host,
        advance: (ms: number) => {
            clock += ms;
            if (timer && !timer.cancelled && timer.at <= clock) {
                const cb = timer.cb;
                timer = null;
                cb();
            }
        },
    };
}

describe('AutoExportScheduler', () => {
    const DEBOUNCE = 20_000;

    it('coalesces a burst of edits into one due after the last', () => {
        const h = makeHost(DEBOUNCE);
        const onDue = vi.fn();
        const s = new AutoExportScheduler(h.host, DEBOUNCE, onDue);

        s.markDirty();
        h.advance(10_000);
        s.markDirty(); // reset the timer
        h.advance(10_000);
        expect(onDue).not.toHaveBeenCalled();
        h.advance(DEBOUNCE);
        expect(onDue).toHaveBeenCalledTimes(1);
        expect(s.pending).toBe(false);
    });

    it('flushNow fires only when a debounce is pending', () => {
        const h = makeHost(DEBOUNCE);
        const onDue = vi.fn();
        const s = new AutoExportScheduler(h.host, DEBOUNCE, onDue);

        expect(s.flushNow()).toBe(false);
        s.markDirty();
        expect(s.flushNow()).toBe(true);
        expect(onDue).toHaveBeenCalledTimes(1);
        expect(s.pending).toBe(false);
        expect(s.flushNow()).toBe(false);
    });

    it('noteSynced and cancel drop a pending debounce', () => {
        const h = makeHost(DEBOUNCE);
        const onDue = vi.fn();
        const s = new AutoExportScheduler(h.host, DEBOUNCE, onDue);

        s.markDirty();
        s.noteSynced();
        h.advance(DEBOUNCE * 2);
        expect(onDue).not.toHaveBeenCalled();

        s.markDirty();
        s.cancel();
        h.advance(DEBOUNCE * 2);
        expect(onDue).not.toHaveBeenCalled();
    });

    it('markDirty after noteSynced re-arms', () => {
        const h = makeHost(DEBOUNCE);
        const onDue = vi.fn();
        const s = new AutoExportScheduler(h.host, DEBOUNCE, onDue);

        s.markDirty();
        s.noteSynced();
        s.markDirty();
        h.advance(DEBOUNCE);
        expect(onDue).toHaveBeenCalledTimes(1);
    });
});
