// ============================================================
// HiLighter - Auto-export debounce scheduler (pure; timer injected)
// ============================================================

/** Injected timer so this module stays node-testable and lint-clean. */
export interface SchedulerHost {
    after(ms: number, cb: () => void): () => void;
}

/**
 * Debounced notifier: each `markDirty` resets the timer so a burst of edits
 * coalesces into a single `onDue` after the last one. It owns no "dirty"
 * flag — the controller derives dirtiness from a monotonic db change counter.
 */
export class AutoExportScheduler {
    private handle: (() => void) | null = null;

    constructor(
        private readonly host: SchedulerHost,
        private readonly debounceMs: number,
        private readonly onDue: () => void,
    ) {}

    get pending(): boolean {
        return this.handle != null;
    }

    markDirty(): void {
        this.clearTimer();
        this.handle = this.host.after(this.debounceMs, () => {
            this.handle = null;
            this.onDue();
        });
    }

    /** Fire immediately if a debounce is pending (mobile backgrounding / quit). */
    flushNow(): boolean {
        if (!this.handle) return false;
        this.clearTimer();
        this.onDue();
        return true;
    }

    /** Drop any pending export (the db is now known to match the file). */
    noteSynced(): void {
        this.clearTimer();
    }

    cancel(): void {
        this.clearTimer();
    }

    private clearTimer(): void {
        if (this.handle) {
            this.handle();
            this.handle = null;
        }
    }
}
