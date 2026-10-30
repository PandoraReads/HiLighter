export interface Bounds { top: number; bottom: number; left: number; right: number }
export function mostVisiblePage(pages: readonly { page: number; rect: Bounds }[], viewport: Bounds): number | null {
    let best: number | null = null;
    let area = 0;
    for (const item of pages) {
        const width = Math.max(0, Math.min(item.rect.right, viewport.right) - Math.max(item.rect.left, viewport.left));
        const height = Math.max(0, Math.min(item.rect.bottom, viewport.bottom) - Math.max(item.rect.top, viewport.top));
        if (width * height > area) { area = width * height; best = item.page; }
    }
    return best;
}
