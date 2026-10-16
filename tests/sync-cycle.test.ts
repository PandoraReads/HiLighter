import { describe, it, expect } from 'vitest';
import {
    decideCycle,
    SyncMutex,
    withTimeout,
    EXPORT_BURST_LIMIT,
    EXPORT_BURST_WINDOW_MS,
    MIN_AUTO_EXPORT_GAP_MS,
} from '../src/sync/cycle';
import type { SyncSnapshot, TimeoutHost } from '../src/sync/cycle';

function snap(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    return {
        autoImport: true,
        autoExport: true,
        dirty: false,
        remoteChanged: false,
        importOk: null,
        localCount: 5,
        remoteCountKnown: 0,
        exportTimes: [],
        pausedUntil: null,
        lastAutoExportAt: null,
        now: 0,
        ...overrides,
    };
}

describe('decideCycle', () => {
    it('imports when the remote changed', () => {
        expect(decideCycle(snap({ remoteChanged: true }))).toEqual({ kind: 'import' });
    });

    it('does not import when autoImport is off', () => {
        expect(decideCycle(snap({ autoImport: false, remoteChanged: true, dirty: true, importOk: true }))).toEqual({ kind: 'export' });
    });

    it('stays idle when nothing is dirty or changed', () => {
        expect(decideCycle(snap())).toEqual({ kind: 'idle' });
    });

    it('exports when dirty with a clean import', () => {
        expect(decideCycle(snap({ dirty: true, importOk: true }))).toEqual({ kind: 'export' });
    });

    it('never exports after a failed import', () => {
        expect(decideCycle(snap({ dirty: true, importOk: false }))).toEqual({ kind: 'idle' });
    });

    it('blocks export while the circuit breaker pause is active', () => {
        expect(decideCycle(snap({ dirty: true, importOk: true, pausedUntil: 100, now: 50 }))).toEqual({ kind: 'blocked', reason: 'circuit' });
    });

    it('blocks export when the burst limit is reached within the window', () => {
        const now = EXPORT_BURST_WINDOW_MS;
        const exportTimes = Array.from({ length: EXPORT_BURST_LIMIT }, (_, i) => now - 1 - i);
        expect(decideCycle(snap({ dirty: true, importOk: true, exportTimes, now }))).toEqual({ kind: 'blocked', reason: 'circuit' });
    });

    it('blocks export when local is empty and remote is known non-empty', () => {
        expect(decideCycle(snap({ dirty: true, importOk: true, localCount: 0, remoteCountKnown: 10 }))).toEqual({ kind: 'blocked', reason: 'clobber' });
    });

    it('waits out the minimum export gap', () => {
        expect(decideCycle(snap({ dirty: true, importOk: true, lastAutoExportAt: 0, now: MIN_AUTO_EXPORT_GAP_MS - 1 }))).toEqual({ kind: 'idle' });
    });
});

describe('decideCycle ping-pong termination (F1)', () => {
    it('a no-op remote import does not trigger an export', () => {
        // Device B sees A's export; the import merges nothing.
        const beforeImport = decideCycle(snap({ remoteChanged: true }));
        expect(beforeImport).toEqual({ kind: 'import' });

        // After a no-op import: remote consumed, still clean → idle (no export).
        const afterImport = snap({ remoteChanged: false, importOk: true, dirty: false });
        expect(decideCycle(afterImport)).toEqual({ kind: 'idle' });
    });

    it('a real remote merge triggers exactly one export, then converges', () => {
        const beforeImport = decideCycle(snap({ remoteChanged: true }));
        expect(beforeImport).toEqual({ kind: 'import' });

        // Import merged rows → dirty. Export happens once.
        const afterImport = snap({ remoteChanged: false, importOk: true, dirty: true });
        expect(decideCycle(afterImport)).toEqual({ kind: 'export' });

        // After export: clean, gap set → idle. No further ping-pong.
        const afterExport = snap({
            remoteChanged: false,
            importOk: true,
            dirty: false,
            lastAutoExportAt: 1000,
            now: 1000,
            exportTimes: [1000],
        });
        expect(decideCycle(afterExport)).toEqual({ kind: 'idle' });
    });
});

describe('withTimeout', () => {
    function fakeHost(): { host: TimeoutHost; fire: () => void } {
        let cb: (() => void) | null = null;
        return {
            host: { set: (c: () => void) => { cb = c; return () => { cb = null; }; } },
            fire: () => { cb?.(); cb = null; },
        };
    }

    it('resolves before the timeout', async () => {
        const { host } = fakeHost();
        await expect(withTimeout(Promise.resolve('ok'), 100, host)).resolves.toBe('ok');
    });

    it('rejects when the timer fires first', async () => {
        const { host, fire } = fakeHost();
        const p = withTimeout(new Promise(() => { /* never settles */ }), 100, host);
        fire();
        await expect(p).rejects.toThrow('timed out');
    });
});

describe('SyncMutex', () => {
    let clock = 0;

    function mutex(): SyncMutex {
        return new SyncMutex(() => clock, 100);
    }

    it('serializes runs and coalesces concurrent callers into one trailing run', async () => {
        const m = mutex();
        // The controller always passes the same closure; coalescing re-runs it once.
        let invocations = 0;
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((r) => { releaseFirst = r; });

        const shared = async () => {
            invocations++;
            if (invocations === 1) await firstGate;
        };

        const first = m.runExclusive(shared);
        void m.runExclusive(shared); // arrives while busy
        void m.runExclusive(shared); // arrives while busy, coalesced too

        expect(m.busy).toBe(true);
        releaseFirst();
        await first;

        // One trailing run covers both coalesced callers, then the mutex drains.
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(invocations).toBe(2);
        expect(m.busy).toBe(false);
    });

    it('clears the running flag when fn throws', async () => {
        const m = mutex();
        await expect(m.runExclusive(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(m.busy).toBe(false);
        await expect(m.runExclusive(async () => { /* ok */ })).resolves.toBeUndefined();
    });

    it('abandons a stale run so the next caller can proceed', async () => {
        const m = mutex();
        let started = 0;
        const first = m.runExclusive(async () => { started++; await new Promise<void>(() => { /* hang */ }); });
        await Promise.resolve();
        expect(m.busy).toBe(true);

        clock = 200; // past the watchdog
        const second = m.runExclusive(async () => { started++; });
        await second;
        expect(started).toBe(2);
        void first;
    });
});
