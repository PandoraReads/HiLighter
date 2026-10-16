// ============================================================
// HiLighter - Sync controller (orchestrates watcher + scheduler + db)
// ============================================================

import { t } from '../i18n';
import type { HiLighterSettings, HighlightNote } from '../models';
import { SyncFileWatcher, type SyncAdapterLike, type WatchHost } from './watcher';
import { AutoExportScheduler } from './auto-export';
import {
    SyncMutex,
    decideCycle,
    withTimeout,
    MIN_AUTO_EXPORT_GAP_MS,
    EXPORT_BURST_LIMIT,
    EXPORT_BURST_WINDOW_MS,
    EXPORT_BURST_PAUSE_MS,
    READ_TIMEOUT_MS,
    CYCLE_WATCHDOG_MS,
    type SyncSnapshot,
    type TimeoutHost,
} from './cycle';
import {
    parseSyncPayload,
    sanitizeHighlights,
    buildPayload,
    normalizeSyncPath,
    type ParsedSyncPayload,
    type SyncTombstone,
} from './sync-file';
import {
    POLL_INTERVAL_MS,
    POLL_JITTER_RATIO,
    MIN_TICK_GAP_MS,
    CONFIRM_DELAY_MS,
    EXPORT_DEBOUNCE_MS,
    STARTUP_DELAY_MS,
    ERROR_NOTICE_COOLDOWN_MS,
} from './constants';

export type SyncTrigger =
    | 'startup'
    | 'poll'
    | 'foreground'
    | 'dirty'
    | 'auto'
    | 'manual'
    | 'protocol'
    | 'quit'
    | 'background'
    | 'vault';

export interface SyncAdapter extends SyncAdapterLike {
    write(path: string, data: string): Promise<void>;
    mkdir(path: string): Promise<void>;
}

export interface SyncTimers extends WatchHost {
    onBackground(cb: () => void): () => void;
}

/** Structural subset of HiLighterDatabase the controller depends on. */
export interface SyncDbLike {
    getAllHighlights(): Promise<HighlightNote[]>;
    countHighlights(): Promise<number>;
    upsertHighlights(notes: HighlightNote[]): Promise<{ added: number; updated: number; skipped: number }>;
    getTombstones(): Promise<SyncTombstone[]>;
    applyRemoteTombstones(remote: SyncTombstone[]): Promise<void>;
    pruneTombstones(now: number): Promise<number>;
    onChange(cb: () => void): () => void;
    getChangeSeq(): number;
}

export interface SyncControllerDeps {
    getSettings(): HiLighterSettings;
    writerId: string;
    adapter: SyncAdapter;
    timers: SyncTimers;
    notice(message: string): void;
    refreshViews(): void;
    onVaultModify(cb: (path: string) => void): () => void;
    onQuit(cb: (addTask: (p: Promise<unknown>) => void) => void): () => void;
    db: SyncDbLike;
}

export interface SyncStatus {
    lastImportAt: number | null;
    lastExportAt: number | null;
    dirty: boolean;
    pending: boolean;
    paused: boolean;
}

export class SyncController {
    private readonly mutex: SyncMutex;
    private readonly watcher: SyncFileWatcher;
    private readonly scheduler: AutoExportScheduler;
    private readonly disposers: (() => void)[] = [];

    private started = false;
    private remoteChanged = true;
    private importOk: boolean | null = null;
    private remoteCountKnown = 0;
    private lastReconciledSeq = 0;
    private exportTimes: number[] = [];
    private pausedUntil: number | null = null;
    private lastAutoExportAt: number | null = null;
    private lastImportAt: number | null = null;
    private lastErrorNoticeAt = 0;

    constructor(private readonly deps: SyncControllerDeps) {
        this.mutex = new SyncMutex(() => deps.timers.now(), CYCLE_WATCHDOG_MS);
        this.scheduler = new AutoExportScheduler(deps.timers, EXPORT_DEBOUNCE_MS, () => {
            void this.runCycle('dirty');
        });
        this.watcher = new SyncFileWatcher(deps.adapter, deps.timers, {
            getPath: () => this.normalizedPath(),
            writerId: deps.writerId,
            pollMs: POLL_INTERVAL_MS,
            minGapMs: MIN_TICK_GAP_MS,
            confirmMs: CONFIRM_DELAY_MS,
            readTimeoutMs: READ_TIMEOUT_MS,
            jitter: POLL_JITTER_RATIO,
            onRemoteChange: (payload) => this.onRemoteChange(payload),
            onError: (reason) => this.noticeRateLimited(t('sync.auto.error', { message: reason })),
        });
    }

    // ──── Lifecycle ──────────────────────────────────────────

    start(): void {
        if (this.started) return;
        if (!this.deps.getSettings().syncEnabled) return;
        this.started = true;

        this.watcher.start();
        this.disposers.push(
            this.deps.db.onChange(() => this.scheduler.markDirty()),
            this.deps.onVaultModify((path) => {
                if (path === this.normalizedPath()) {
                    this.remoteChanged = true;
                    void this.runCycle('vault');
                }
            }),
            this.deps.timers.onBackground(() => { void this.flushNow(); }),
            this.deps.onQuit((addTask) => addTask(this.flushNow())),
            this.deps.timers.after(STARTUP_DELAY_MS, () => { void this.runCycle('startup'); }),
        );
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        this.watcher.stop();
        this.scheduler.cancel();
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
    }

    restart(): void {
        this.stop();
        this.start();
    }

    dispose(): void {
        this.stop();
    }

    setPath(): void {
        this.watcher.setPath();
        this.remoteChanged = true;
        this.remoteCountKnown = 0;
        this.importOk = null;
    }

    // ──── Public sync actions ────────────────────────────────

    /** Automatic cycle (import remote if needed, then export if dirty). */
    async runCycle(trigger: SyncTrigger): Promise<void> {
        await this.mutex.runExclusive(() => this.cycleOnce(trigger));
    }

    /** Manual import (unconditional, with the existing notice). */
    async importNow(): Promise<void> {
        await this.mutex.runExclusive(async () => { await this.importFromFile('manual'); });
    }

    /** Manual export (unconditional, with the existing notice). */
    async exportNow(): Promise<void> {
        await this.mutex.runExclusive(async () => { await this.doExport('manual'); });
    }

    /** Full manual import + export (used by `obsidian://hilighter?op=sync`). */
    async syncNow(): Promise<void> {
        await this.mutex.runExclusive(async () => {
            await this.importFromFile('manual');
            await this.doExport('manual');
        });
    }

    /** Flush any pending export before backgrounding / quitting. */
    async flushNow(): Promise<void> {
        await this.mutex.runExclusive(async () => {
            const s = this.deps.getSettings();
            if (!s.syncEnabled || !s.syncAutoExport || !this.isDirty()) return;
            await this.exportIfDirty('quit');
        });
    }

    getSyncStatus(): SyncStatus {
        return {
            lastImportAt: this.lastImportAt,
            lastExportAt: this.lastAutoExportAt,
            dirty: this.isDirty(),
            pending: this.scheduler.pending,
            paused: this.pausedUntil != null && this.deps.timers.now() < this.pausedUntil,
        };
    }

    // ──── Cycle ──────────────────────────────────────────────

    /** Inner cycle; assumes the mutex is held. */
    private async cycleOnce(trigger: SyncTrigger): Promise<void> {
        const settings = this.deps.getSettings();
        if (!settings.syncEnabled) return;

        for (let i = 0; i < 4; i++) {
            const decision = decideCycle(await this.snapshot(settings));
            if (decision.kind === 'idle') break;
            if (decision.kind === 'blocked') {
                this.onBlocked(decision.reason);
                break;
            }
            if (decision.kind === 'import') {
                await this.importFromFile(trigger);
            } else {
                await this.doExport(trigger);
            }
        }
        this.reconcileScheduler();
    }

    private async snapshot(settings: HiLighterSettings): Promise<SyncSnapshot> {
        const now = this.deps.timers.now();
        const localCount = await this.deps.db.countHighlights();
        return {
            autoImport: settings.syncAutoImport,
            autoExport: settings.syncAutoExport,
            dirty: this.isDirty(),
            remoteChanged: this.remoteChanged,
            importOk: this.importOk,
            localCount,
            remoteCountKnown: this.remoteCountKnown,
            exportTimes: this.exportTimes,
            pausedUntil: this.pausedUntil,
            lastAutoExportAt: this.lastAutoExportAt,
            now,
        };
    }

    private onBlocked(reason: 'circuit' | 'clobber'): void {
        if (reason === 'clobber') {
            this.noticeRateLimited(t('sync.autoExport.blocked', { count: this.remoteCountKnown }));
        }
        // 'circuit': silent pause; it self-clears when the window decays.
    }

    /** Watcher-provided payload path: merge under the mutex, then re-evaluate export. */
    private async onRemoteChange(payload: ParsedSyncPayload): Promise<boolean> {
        let accepted = false;
        await this.mutex.runExclusive(async () => {
            const settings = this.deps.getSettings();
            if (!settings.syncEnabled || !settings.syncAutoImport) {
                accepted = true; // ignore remote changes while auto-import is off
                return;
            }
            accepted = await this.importPayload(payload, 'auto');
            if (accepted) await this.cycleOnce('auto');
        });
        return accepted;
    }

    // ──── Import ─────────────────────────────────────────────

    private async importFromFile(trigger: SyncTrigger): Promise<boolean> {
        const path = this.normalizedPath();
        try {
            if (!await this.deps.adapter.exists(path)) {
                this.remoteChanged = false;
                this.remoteCountKnown = 0;
                this.importOk = true;
                if (trigger === 'manual') this.deps.notice(t('sync.import.fileNotFound'));
                return true;
            }
            const content = await withTimeout(this.deps.adapter.read(path), READ_TIMEOUT_MS, this.timeoutHost());
            const payload = parseSyncPayload(content);
            if (!payload.ok) {
                this.importOk = false;
                this.noticeRateLimited(t('sync.import.invalidFile'));
                return false; // keep remoteChanged so we retry
            }
            return await this.importPayload(payload, trigger);
        } catch (e) {
            console.error('[HiLighter] import read failed', e);
            this.importOk = false;
            this.noticeRateLimited(t('sync.import.fail', { message: String(e) }));
            return false;
        }
    }

    private async importPayload(payload: ParsedSyncPayload, trigger: SyncTrigger): Promise<boolean> {
        if (!payload.ok) return false;
        try {
            const seqBefore = this.deps.db.getChangeSeq();
            const settings = this.deps.getSettings();
            const incoming = sanitizeHighlights(payload.highlights, settings);

            await this.deps.db.applyRemoteTombstones(payload.tombstones);
            const result = await this.deps.db.upsertHighlights(incoming);
            await this.deps.db.pruneTombstones(this.deps.timers.now());

            const changed = this.deps.db.getChangeSeq() !== seqBefore;
            this.remoteChanged = false;
            this.importOk = true;
            this.remoteCountKnown = payload.count;
            this.lastImportAt = this.deps.timers.now();

            if (trigger === 'manual') {
                this.deps.notice(t('sync.import.success', { added: result.added, updated: result.updated }));
            } else if (changed) {
                this.deps.notice(t('sync.autoImport.success', { added: result.added, updated: result.updated }));
            }
            if (changed) this.deps.refreshViews();
            return true;
        } catch (e) {
            console.error('[HiLighter] import merge failed', e);
            this.importOk = false;
            this.noticeRateLimited(t('sync.import.fail', { message: String(e) }));
            return false;
        }
    }

    // ──── Export ─────────────────────────────────────────────

    private async exportIfDirty(trigger: SyncTrigger): Promise<void> {
        if (!this.isDirty()) return;
        if (this.importOk === false) return; // never write over data we failed to read
        const now = this.deps.timers.now();
        const localCount = await this.deps.db.countHighlights();
        if (localCount === 0 && this.remoteCountKnown > 0) {
            this.noticeRateLimited(t('sync.autoExport.blocked', { count: this.remoteCountKnown }));
            return;
        }
        if (this.pausedUntil != null && now < this.pausedUntil) return;
        const inWindow = this.exportTimes.filter(t => now - t < EXPORT_BURST_WINDOW_MS).length;
        if (inWindow >= EXPORT_BURST_LIMIT) {
            this.pausedUntil = now + EXPORT_BURST_PAUSE_MS;
            return;
        }
        const forced = trigger === 'quit' || trigger === 'manual';
        if (!forced && this.lastAutoExportAt != null && now - this.lastAutoExportAt < MIN_AUTO_EXPORT_GAP_MS) {
            return;
        }
        await this.doExport(trigger);
    }

    private async doExport(trigger: SyncTrigger): Promise<void> {
        const path = this.normalizedPath();
        const seqBefore = this.deps.db.getChangeSeq();
        try {
            const [highlights, tombstones] = await Promise.all([
                this.deps.db.getAllHighlights(),
                this.deps.db.getTombstones(),
            ]);
            const now = this.deps.timers.now();
            const json = buildPayload(highlights, tombstones, now, this.deps.writerId);

            const dir = path.substring(0, path.lastIndexOf('/'));
            if (dir) {
                try {
                    if (!await this.deps.adapter.exists(dir)) await this.deps.adapter.mkdir(dir);
                } catch {
                    // Directory may have been created concurrently; write below surfaces real errors.
                }
            }
            await this.deps.adapter.write(path, json);

            this.lastReconciledSeq = seqBefore;
            this.lastAutoExportAt = now;
            this.exportTimes.push(now);
            this.exportTimes = this.exportTimes.filter(t => now - t < EXPORT_BURST_WINDOW_MS);
            if (this.exportTimes.length >= EXPORT_BURST_LIMIT) {
                this.pausedUntil = now + EXPORT_BURST_PAUSE_MS;
            }
            this.watcher.resetStat();
            if (trigger === 'manual') {
                this.deps.notice(t('sync.export.success', { count: highlights.length }));
            }
            this.reconcileScheduler();
        } catch (e) {
            console.error('[HiLighter] export failed', e);
            this.noticeRateLimited(t('sync.export.fail', { message: String(e) }));
        }
    }

    // ──── Helpers ────────────────────────────────────────────

    private normalizedPath(): string {
        return normalizeSyncPath(this.deps.getSettings().syncFilePath);
    }

    private isDirty(): boolean {
        return this.deps.db.getChangeSeq() !== this.lastReconciledSeq;
    }

    private reconcileScheduler(): void {
        if (this.isDirty()) this.scheduler.markDirty();
        else this.scheduler.noteSynced();
    }

    private timeoutHost(): TimeoutHost {
        return { set: (cb, ms) => this.deps.timers.after(ms, cb) };
    }

    private noticeRateLimited(message: string): void {
        const now = this.deps.timers.now();
        if (now - this.lastErrorNoticeAt < ERROR_NOTICE_COOLDOWN_MS) return;
        this.lastErrorNoticeAt = now;
        this.deps.notice(message);
    }
}

export function initSync(deps: SyncControllerDeps): SyncController {
    return new SyncController(deps);
}
