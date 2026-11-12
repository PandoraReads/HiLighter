// ============================================================
// HiLighter - promise timeout helper
// ============================================================
// Races a promise against a deadline. A stalled underlying promise
// (e.g. a vault read blocked on an iCloud placeholder download) must
// never propagate its stall to callers, so the race always settles:
// with the value on success, with the fallback on error or timeout.
// The underlying promise keeps running; its result is simply ignored.

export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	fallback: () => T,
): Promise<T> {
	return new Promise<T>((resolve) => {
		let settled = false;
		const settleOnce = (value: T): void => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(value);
		};
		const timer = window.setTimeout(() => settleOnce(fallback()), ms);
		promise.then(
			value => settleOnce(value),
			() => settleOnce(fallback()),
		);
	});
}
