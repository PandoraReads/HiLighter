/**
 * Runtime stub for the `obsidian` npm package, which ships type
 * declarations only (no runtime entry). Vitest aliases `obsidian` imports
 * to this file; individual tests inject behavior with vi.mock.
 *
 * Only exports that are EVALUATED at module load (e.g. `class X extends
 * Modal`) need real shapes here; everything else stays undefined until a
 * test mocks it, which keeps accidental runtime use loud in tests.
 */
export async function requestUrl(): Promise<never> {
    throw new Error('obsidian.requestUrl stub: mock it in your test');
}

/** Base class shape only — enough for `class Foo extends Modal` to load. */
export class Modal {
    app: unknown;
    constructor(app?: unknown) {
        this.app = app;
    }
    open(): void { /* stub */ }
    close(): void { /* stub */ }
}

/** Same purpose as Modal for the fuzzy-suggest subclass used by pickers. */
export class FuzzySuggestModal<T> extends Modal {
    getItems(): T[] { return []; }
    getItemText(item: T): string { return String(item); }
    onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void { /* stub */ }
}

