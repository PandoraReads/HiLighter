/**
 * Runtime stub for the `obsidian` npm package, which ships type
 * declarations only (no runtime entry). Vitest aliases `obsidian` imports
 * to this file; individual tests inject behavior with vi.mock.
 */
export async function requestUrl(): Promise<never> {
    throw new Error('obsidian.requestUrl stub: mock it in your test');
}
