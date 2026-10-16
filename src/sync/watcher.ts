// ============================================================
// HiLighter - Sync file watcher (pure; timers/DOM injected)
// ============================================================

import {
    parseSyncPayload,
    shouldReadContent,
    statsEqual,
    isOwnPayload,
    type SyncFileStat,
    type ParsedSyncPayload,
} from './sync-file';
import { withTimeout, type TimeoutHost } from './cycle';

/** Subset of the Obsidian DataAdapter we actually touch (stat/read/exists). */
export interface SyncAdapterLike {
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<SyncFileStat | null>;
    read(path: string): Promise<string>;
}

/** Injected timer/focus plumbing so this module stays node-testable. */
export interface WatchHost {
    every(ms: number, cb: () => void): () => void;
    after(ms: number, cb: () => void): () => void;
    now(): number;
    onForeground(cb: () => void): () => void;
}

export interface SyncFileWatcherOptions {
    getPath(): string;
    writerId: string;
    pollMs: number;
    minGapMs: number;
    confirmMs: number;
    readTimeoutMs: number;
    jitter: number; // 0..1 fraction of pollMs
    onRemoteChange(payload: ParsedSyncPayload): Promise<boolean>;
    onError(reason: 'json' | 'version' | 'shape'): void;
}

interface Candidate {
    stat: SyncFileStat;
    cancel: () => void;
}

/**
 * Polls the sync file's stat; on a change it arms a short confirm delay and
 * reads only once the stat is stable (torn-write guard). Parse/read failures
 * never advance `lastStat`, so a bad remote revision is retried, not lost.
 */
export class SyncFileWatcher {
    private lastStat: SyncFileStat | null = null;
    private candidate: Candidate | null = null;
    private tickCount = 0;
    private lastTickAt = -Infinity;
    private disposed = false;
    private readonly disposers: (() => void)[] = [];

    constructor(
        private readonly adapter: SyncAdapterLike,
        private readonly host: WatchHost,
        private readonly opts: SyncFileWatcherOptions,
    ) {}

    get currentStat(): SyncFileStat | null {
        return this.lastStat;
    }

    start(): void {
        if (this.disposed) return;
        const jitterMs = this.opts.pollMs * (Math.random() * 2 - 1) * this.opts.jitter;
        this.disposers.push(this.host.every(this.opts.pollMs + jitterMs, () => { void this.tick(); }));
        this.disposers.push(this.host.onForeground(() => { void this.tick({ force: true }); }));
    }

    stop(): void {
        this.disposed = true;
        this.clearCandidate();
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
    }

    /** Forget the reconciled stat (path change or our own write). */
    resetStat(): void {
        this.lastStat = null;
        this.clearCandidate();
    }

    setPath(): void {
        this.resetStat();
    }

    async tick(opts?: { force?: boolean }): Promise<void> {
        if (this.disposed) return;
        const now = this.host.now();
        if (!opts?.force && now - this.lastTickAt < this.opts.minGapMs) return;
        this.lastTickAt = now;
        await this.step(opts?.force ?? false);
    }

    private async step(force: boolean): Promise<void> {
        this.tickCount++;

        let stat: SyncFileStat | null;
        try {
            stat = await this.adapter.stat(this.opts.getPath());
        } catch {
            // Transient stat failure: behave like a missing file, retry later.
            this.lastStat = null;
            this.clearCandidate();
            return;
        }

        if (stat == null) {
            this.lastStat = null;
            this.clearCandidate();
            return;
        }

        // Confirm phase: only read once the stat has stopped moving.
        if (this.candidate) {
            if (statsEqual(this.candidate.stat, stat)) {
                this.clearCandidate();
                await this.readAndProcess(stat);
            } else {
                this.armConfirm(stat);
            }
            return;
        }

        if (shouldReadContent(stat, this.lastStat, { force, tickCount: this.tickCount })) {
            this.armConfirm(stat);
        }
    }

    private armConfirm(stat: SyncFileStat): void {
        this.clearCandidate();
        const cancel = this.host.after(this.opts.confirmMs, () => { void this.confirmFire(); });
        this.candidate = { stat, cancel };
    }

    private confirmFire(): void {
        if (this.disposed) return;
        this.lastTickAt = this.host.now();
        void this.step(true);
    }

    private async readAndProcess(stat: SyncFileStat): Promise<void> {
        const timeoutHost: TimeoutHost = { set: (cb, ms) => this.host.after(ms, cb) };
        let content: string;
        try {
            content = await withTimeout(this.adapter.read(this.opts.getPath()), this.opts.readTimeoutMs, timeoutHost);
        } catch {
            // Read failed or timed out; leave lastStat untouched to retry.
            return;
        }

        const payload = parseSyncPayload(content);
        if (!payload.ok) {
            this.opts.onError(payload.reason);
            return; // do not advance lastStat
        }
        if (isOwnPayload(payload, this.opts.writerId)) {
            this.lastStat = stat;
            return;
        }
        const accepted = await this.opts.onRemoteChange(payload);
        if (accepted) this.lastStat = stat;
    }

    private clearCandidate(): void {
        if (this.candidate) this.candidate.cancel();
        this.candidate = null;
    }
}
