// ============================================================
// HiLighter - native Promise shim
// Replaces the "lie" promise polyfill (which pulls in the
// "immediate" package that uses createElement("script")).
// Obsidian always provides a native ES6 Promise, and jszip's
// external.js only falls back to "lie" when Promise is missing.
// ============================================================

"use strict";

module.exports = Promise;
