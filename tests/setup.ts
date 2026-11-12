// ============================================================
// HiLighter - vitest global setup
// ============================================================
// Obsidian plugins run in a browser where `window` always exists; the Node
// test environment has none. Source code uses `window.setTimeout` /
// `window.clearTimeout` (Obsidian's popout-window guidance), and Dexie
// resolves `indexedDB` through the global object, so we alias `window` to the
// Node global.
//
// Because `window === globalThis`, every `window.X` is identical to
// `globalThis.X`, so the `typeof window !== 'undefined' ? window.X :
// globalThis.X` branches in src/mocks/crypto.ts and src/selection/
// lookup-service.ts resolve to exactly the same values they did before this
// shim existed — the alias is behaviorally transparent.

if (typeof globalThis.window === 'undefined') {
	(globalThis as unknown as { window: unknown }).window = globalThis;
}
