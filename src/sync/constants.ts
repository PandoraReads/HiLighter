// ============================================================
// HiLighter - Sync timing constants
// ============================================================

/** Stat-only poll interval for the sync file. */
export const POLL_INTERVAL_MS = 30_000;

/** ±20% poll jitter so two instances/devices don't tick in lockstep. */
export const POLL_JITTER_RATIO = 0.2;

/** Minimum gap between watcher ticks (focus/visibilitychange fire in bursts). */
export const MIN_TICK_GAP_MS = 5_000;

/** Confirm delay: re-check the stat after this long before reading bytes. */
export const CONFIRM_DELAY_MS = 2_000;

/** Debounce for auto-export after the last local write. */
export const EXPORT_DEBOUNCE_MS = 20_000;

/** Delay before the first cycle after layout is ready (don't fight vault indexing). */
export const STARTUP_DELAY_MS = 4_000;

/** Debounce for restarting the watcher when the sync path field changes. */
export const PATH_CHANGE_DEBOUNCE_MS = 800;

/** At most one auto-sync error Notice per this interval. */
export const ERROR_NOTICE_COOLDOWN_MS = 300_000;
