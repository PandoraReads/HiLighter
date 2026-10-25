import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            // The obsidian npm package is types-only; point runtime imports at a stub.
            obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
        },
    },
});
