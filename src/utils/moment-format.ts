// ============================================================
// HiLighter - typed moment helpers
// ============================================================
// Obsidian types `moment` as `typeof Moment`, but some type/lint
// environments resolve `Moment` to `any`, which then leaks through
// every `.format()` / `.fromNow()` call as an unsafe-any. These thin
// wrappers pin the return types once so date formatting stays type-safe
// at every call site regardless of how `moment` itself resolves.

import { moment } from 'obsidian';

interface MomentLike {
	format(pattern: string): string;
	fromNow(): string;
}

type MomentFn = (input: number | Date) => MomentLike;

const momentFn = moment as unknown as MomentFn;

/** Format a date or timestamp with a moment format string. */
export function formatDate(input: number | Date, pattern: string): string {
	return momentFn(input).format(pattern);
}

/** Relative time (e.g. "3 days ago") for a unix-ms timestamp. */
export function formatFromNow(input: number): string {
	return momentFn(input).fromNow();
}
