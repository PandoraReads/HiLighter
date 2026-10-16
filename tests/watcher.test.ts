import { describe, it, expect, vi } from 'vitest';
import { SyncFileWatcher, type SyncAdapterLike, type WatchHost } from '../src/sync/watcher';
import type { SyncFileStat, ParsedSyncPayload } from '../src/sync/sync-file';

const STAT_A: SyncFileStat = { mtime: 100, size: 10 };
const STAT_B: SyncFileStat = { mtime: 200, size: 10 };

const CONFIRM_MS = 5;
const MIN_GAP_MS = 10;

function remotePayload(writerId = 'other'): string {
    return JSON.stringify({ version: 2, exportedAt: 1, writerId, highlights: [{ id: 'a', text: 't', color: 'yellow' }] });
}

function makeAdapter(stat: SyncFileStat | null = STAT_A, content = remotePayload()) {
    let currentStat = stat;
    let currentContent = content;
    let reads = 0;
    const adapter: SyncAdapterLike = {
        exists: async () => currentStat != null,
        stat: async () => currentStat,
        read: async () => { reads++; return currentContent; },
    };
    return {
        adapter,
        reads: () => reads,
        setStat: (s: SyncFileStat | null) => { currentStat = s; },
        setContent: (c: string) => { currentContent = c; },
    };
}

function makeHost() {
    let clock = 0;
    const afters: { at: number; cb: () => void; cancelled: boolean }[] = [];
    const every: (() => void)[] = [];
    const foreground: (() => void)[] = [];

    const host: WatchHost = {
        every: (_ms, cb) => { every.push(cb); return () => {}; },
        after: (ms, cb) => { const a = { at: clock + ms, cb, cancelled: false }; afters.push(a); return () => { a.cancelled = true; }; },
        now: () => clock,
        onForeground: (cb) => { foreground.push(cb); return () => {}; },
    };

    return {
        host,
        everyCount: () => every.length,
        foregroundCount: () => foreground.length,
        setClock: (t: number) => { clock = t; },
        advance: async (ms: number) => {
            clock += ms;
            const due = afters.filter(a => !a.cancelled && a.at <= clock);
            for (const a of due) { a.cancelled = true; a.cb(); }
            await flush();
        },
        fireForeground: async () => { for (const cb of foreground) cb(); await flush(); },
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makeWatcher(
    adapter: SyncAdapterLike,
    host: WatchHost,
    opts: Partial<ConstructorParameters<typeof SyncFileWatcher>[2]> = {},
) {
    const onRemoteChange = vi.fn(async (_p: ParsedSyncPayload) => true);
    const onError = vi.fn();
    const watcher = new SyncFileWatcher(adapter, host, {
        getPath: () => '.hilighter/sync-data.json',
        writerId: 'me',
        pollMs: 30_000,
        minGapMs: MIN_GAP_MS,
        confirmMs: CONFIRM_MS,
        readTimeoutMs: 5_000,
        jitter: 0,
        onRemoteChange,
        onError,
        ...opts,
    });
    return { watcher, onRemoteChange, onError };
}

describe('SyncFileWatcher', () => {
    it('does nothing when the file is missing', async () => {
        const a = makeAdapter(null);
        const h = makeHost();
        const { watcher, onRemoteChange, onError } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });

        expect(a.reads()).toBe(0);
        expect(onRemoteChange).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(watcher.currentStat).toBeNull();
    });

    it('reads a changed file only after the confirm delay and records the stat', async () => {
        const a = makeAdapter();
        const h = makeHost();
        const { watcher, onRemoteChange } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        expect(a.reads()).toBe(0); // torn-write guard: no read yet

        await h.advance(CONFIRM_MS);
        expect(a.reads()).toBe(1);
        expect(onRemoteChange).toHaveBeenCalledTimes(1);
        expect(watcher.currentStat).toEqual(STAT_A);
    });

    it('does not re-read an unchanged stat', async () => {
        const a = makeAdapter();
        const h = makeHost();
        const { watcher, onRemoteChange } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        onRemoteChange.mockClear();

        await h.advance(MIN_GAP_MS + 1);
        await watcher.tick();
        expect(a.reads()).toBe(1); // no second read
        expect(onRemoteChange).not.toHaveBeenCalled();
    });

    it('re-arms the confirm while the stat keeps changing', async () => {
        const a = makeAdapter(STAT_A);
        const h = makeHost();
        const { watcher } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        a.setStat(STAT_B);
        await h.advance(CONFIRM_MS); // stat changed during confirm → re-arm
        expect(a.reads()).toBe(0);

        await h.advance(CONFIRM_MS); // stat now stable → read
        expect(a.reads()).toBe(1);
        expect(watcher.currentStat).toEqual(STAT_B);
    });

    it('treats its own payload as reconciled without importing', async () => {
        const a = makeAdapter(STAT_A, remotePayload('me'));
        const h = makeHost();
        const { watcher, onRemoteChange } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);

        expect(a.reads()).toBe(1);
        expect(onRemoteChange).not.toHaveBeenCalled();
        expect(watcher.currentStat).toEqual(STAT_A);
    });

    it('does not advance the stat on a parse failure and retries', async () => {
        const a = makeAdapter(STAT_A, 'garbage{');
        const h = makeHost();
        const { watcher, onError } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        expect(onError).toHaveBeenCalledWith('json');
        expect(watcher.currentStat).toBeNull();

        // Recover: valid content, same stat → read again and accept.
        a.setContent(remotePayload());
        onError.mockClear();
        await h.advance(MIN_GAP_MS + 1);
        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        expect(onError).not.toHaveBeenCalled();
        expect(watcher.currentStat).toEqual(STAT_A);
    });

    it('force-reads an unchanged stat', async () => {
        const a = makeAdapter();
        const h = makeHost();
        const { watcher, onRemoteChange } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        onRemoteChange.mockClear();

        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        expect(a.reads()).toBe(2);
    });

    it('forces a periodic read every 10th tick even when the stat is unchanged', async () => {
        const a = makeAdapter();
        const h = makeHost();
        const { watcher } = makeWatcher(a.adapter, h.host);

        // Establish a reconciled stat (consumes 2 steps: force tick + confirm).
        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        expect(a.reads()).toBe(1);

        // 7 no-op polls → steps 3..9 → still no read.
        for (let i = 0; i < 7; i++) {
            await h.advance(MIN_GAP_MS + 1);
            await watcher.tick();
        }
        expect(a.reads()).toBe(1);

        // 8th poll → step 10 → periodic read armed, not yet read.
        await h.advance(MIN_GAP_MS + 1);
        await watcher.tick();
        expect(a.reads()).toBe(1);
        await h.advance(CONFIRM_MS);
        expect(a.reads()).toBe(2);
    });

    it('registers poll and foreground handlers on start and stops cleanly', async () => {
        const a = makeAdapter();
        const h = makeHost();
        const { watcher } = makeWatcher(a.adapter, h.host);

        watcher.start();
        expect(h.everyCount()).toBe(1);
        expect(h.foregroundCount()).toBe(1);

        watcher.stop();
        await watcher.tick({ force: true });
        expect(a.reads()).toBe(0); // disposed → no work
    });

    it('resetStat forgets the reconciled stat so the next tick re-reads', async () => {
        const a = makeAdapter();
        const h = makeHost();
        const { watcher, onRemoteChange } = makeWatcher(a.adapter, h.host);

        await watcher.tick({ force: true });
        await h.advance(CONFIRM_MS);
        expect(watcher.currentStat).toEqual(STAT_A);
        onRemoteChange.mockClear();

        watcher.resetStat();
        expect(watcher.currentStat).toBeNull();

        await h.advance(MIN_GAP_MS + 1);
        await watcher.tick();
        await h.advance(CONFIRM_MS);
        expect(onRemoteChange).toHaveBeenCalledTimes(1);
    });
});
