export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Crop { x: number; y: number; width: number; height: number }

/** Convert the visible intersection into canvas pixel coordinates. */
export function canvasCrop(selection: Rect, canvas: Rect, pixelWidth: number, pixelHeight: number): Crop | null {
    const width = canvas.right - canvas.left;
    const height = canvas.bottom - canvas.top;
    if (width <= 0 || height <= 0 || pixelWidth <= 0 || pixelHeight <= 0) return null;
    const left = Math.max(selection.left, canvas.left);
    const top = Math.max(selection.top, canvas.top);
    const right = Math.min(selection.right, canvas.right);
    const bottom = Math.min(selection.bottom, canvas.bottom);
    if (right <= left || bottom <= top) return null;
    return { x: (left - canvas.left) * pixelWidth / width, y: (top - canvas.top) * pixelHeight / height,
        width: (right - left) * pixelWidth / width, height: (bottom - top) * pixelHeight / height };
}
