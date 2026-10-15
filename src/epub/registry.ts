// ============================================================
// HiLighter - EPUB view registry (path -> live view)
// ============================================================
// Sidebar/studio jump dispatch needs to reach the open rendition of
// a book without touching Obsidian internals.

import type { EpubView } from './epub-view';

const views = new Map<string, EpubView>();

export function openEpubRegistry(): Map<string, EpubView> {
    return views;
}
