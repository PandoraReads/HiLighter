// ============================================================
// HiLighter - setImmediate shim
// Replaces the "setimmediate" polyfill package, which relies on
// new Function() and createElement("script") techniques that are
// forbidden in Obsidian plugins. Obsidian runs in a modern
// Chromium environment where setTimeout is sufficient.
// ============================================================

"use strict";

if (typeof globalThis.setImmediate !== "function") {
    globalThis.setImmediate = function (fn, ...args) {
        return setTimeout(() => fn(...args), 0);
    };
}

if (typeof globalThis.clearImmediate !== "function") {
    globalThis.clearImmediate = function (id) {
        clearTimeout(id);
    };
}
