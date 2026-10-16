// ============================================================
// HiLighter - Sync cycle decision + concurrency control (pure)
// ============================================================

/** Minimum gap between two automatic exports (bounds residual ping-pong). */
export const MIN_AUTO_EXPORT_GAP_MS = 60_000;

/** Circuit breaker: at most N automatic exports per window, then pause. */
export const EXPORT_BURST_LIMIT = 6;
export const EXPORT_BURST_WINDOW_MS = 5 * 60_000;
export const EXPORT_BURST_PAUSE_MS = 10 * 60_000;

/** A read that hangs longer than this is abandoned so the mutex never wedges. */
export const READ_TIMEOUT_MS = 15_000;

/** A cycle older than this is force-cleared so the next caller can proceed. */
export const CYCLE_WATCHDOG_MS = 45_000;

export interface SyncSnapshot {
    autoImport: boolean;
    autoExport: boolean;
    /** Set only by local DB writes or by an import that actually merged rows. */
    dirty: boolean;
    /** The remote sync file looks different from what we last reconciled. */
    remoteChanged: boolean;
    /** null = no import attempted yet, true = ok (or no-op), false = failed. */
    importOk: boolean | null;
    localCount: number;
    /** > 0 when we have seen a non-empty remote file. */
    remoteCountKnown: number;
    exportTimes: number[];
    pausedUntil: number | null;
    lastAutoExportAt: number | null;
    now: number;
}

export type CycleDecision =
    | { kind: 'import' }
    | { kind: 'export' }
    | { kind: 'idle' }
    | { kind: 'blocked'; reason: 'circuit' | 'clobber' };

/**
 * Decide the next sync step. Import always wins (a merge may set `dirty`);
 * export is gated on `dirty`, a clean import, the burst breaker, and the
 * clobber guard, so the F1 ping-pong cannot self-sustain.
 */
export function decideCycle(s: SyncSnapshot): CycleDecision {
    if (s.autoImport && s.remoteChanged) return { kind: 'import' };

    if (!s.autoExport || !s.dirty) return { kind: 'idle' };
    // Never auto-export after a failed import.
    if (s.importOk === false) return { kind: 'idle' };

    if (s.pausedUntil != null && s.now < s.pausedUntil) {
        return { kind: 'blocked', reason: 'circuit' };
    }
    const inWindow = s.exportTimes.filter(t => s.now - t < EXPORT_BURST_WINDOW_MS).length;
    if (inWindow >= EXPORT_BURST_LIMIT) return { kind: 'blocked', reason: 'circuit' };

    // Never overwrite a non-empty remote file with an empty local db.
    if (s.localCount === 0 && s.remoteCountKnown > 0) {
        return { kind: 'blocked', reason: 'clobber' };
    }
    if (s.lastAutoExportAt != null && s.now - s.lastAutoExportAt < MIN_AUTO_EXPORT_GAP_MS) {
        return { kind: 'idle' };
    }
    return { kind: 'export' };
}

/** Minimal injectable timer used by `withTimeout`. */
export interface TimeoutHost {
    set(cb: () => void, ms: number): () => void;
}

/** Resolve/reject `promise` or reject after `ms` — whichever comes first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, host: TimeoutHost): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const cancel = host.set(() => reject(new Error('timed out')), ms);
        promise.then(
            (value) => { cancel(); resolve(value); },
            (err) => { cancel(); reject(err instanceof Error ? err : new Error(String(err))); },
        );
    });
}

/**
 * Coalescing mutex: at most one `fn` runs at a time; callers that arrive
 * while busy mark one trailing run instead of queueing. A run stuck past the
 * watchdog is abandoned so the next caller can start fresh.
 */
export class SyncMutex {
    private running = false;
    private pending = false;
    private startedAt = 0;

    constructor(
        private readonly now: () => number,
        private readonly watchdogMs: number,
    ) {}

    get busy(): boolean {
        return this.running;
    }

    isStale(): boolean {
        return this.running && this.now() - this.startedAt >= this.watchdogMs;
    }

    async runExclusive(fn: () => Promise<void>): Promise<void> {
        if (this.isStale()) this.reset();
        if (this.running) {
            this.pending = true;
            return;
        }
        this.running = true;
        this.startedAt = this.now();
        try {
            await fn();
        } finally {
            this.running = false;
            this.startedAt = 0;
            if (this.pending) {
                this.pending = false;
                void this.runExclusive(fn);
            }
        }
    }

    private reset(): void {
        this.running = false;
        this.startedAt = 0;
    }
}
