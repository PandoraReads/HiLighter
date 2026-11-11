// ============================================================
// HiLighter - Saved-shelf drag reorder (pointer-based sortable)
// ============================================================
// Drag-to-reorder for the shelf preset rows inside the scope modal.
// Built on pointer events (not HTML5 drag & drop, which has no touch
// support in Obsidian mobile), and only ever started from the grip
// handle — the handle carries `touch-action: none`, so scrolling the
// list is never hijacked. The dragged row tracks the pointer via a
// transform while crossed siblings slide out of its way; the DOM
// order itself changes only through the caller's re-render on drop.

/** Geometry snapshot of the rows at drag start (viewport coords). */
export interface DragGeometry {
    /** Resting midpoint Y of each row, aligned with the row list. */
    midYs: number[];
    /** Height of the dragged row (the gap crossed siblings slide by). */
    draggedHeight: number;
}

/**
 * Logical slot for the dragged row: how many other rows' resting
 * midpoints sit above its current center. At rest (center equals its
 * own midpoint) this equals `from`. Pure — unit-tested.
 */
export function planSlot(midYs: number[], from: number, centerY: number): number {
    let slot = 0;
    for (let i = 0; i < midYs.length; i++) {
        if (i === from) continue;
        if (midYs[i]! < centerY) slot++;
    }
    return slot;
}

/**
 * Vertical displacement (px from resting position) for every row when
 * the dragged row moves from `from` to `slot`. Only the rows it
 * crossed move, each by exactly the dragged row's height. Pure.
 */
export function planShifts(count: number, from: number, slot: number, draggedHeight: number): number[] {
    const shifts = new Array<number>(count).fill(0);
    if (slot > from) {
        for (let p = from + 1; p <= slot; p++) shifts[p] = -draggedHeight;
    } else if (slot < from) {
        for (let p = slot; p < from; p++) shifts[p] = draggedHeight;
    }
    return shifts;
}

/** Row selector inside the drag list (keeps helpers out of the rows). */
const ROW_SELECTOR = '.hl-shelf-preset';

/** Minimal movement (px) before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Wires one grip handle for dragging its row inside `list`. On drop
 * (pointerup beyond the threshold, on a different slot) the caller
 * receives `onReorder(fromIndex, toIndex)` and typically persists +
 * re-renders, which lands the rows in their new DOM order.
 */
export function wireRowDrag(
    list: HTMLElement,
    handle: HTMLElement,
    row: HTMLElement,
    onReorder: (fromIndex: number, toIndex: number) => void,
): void {
    // A tap (or the click that follows a drag) on the handle must not
    // bubble into the row's "switch to this shelf" action.
    handle.addEventListener('click', event => event.stopPropagation());

    handle.addEventListener('pointerdown', (event: PointerEvent) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        const rows = Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR));
        const from = rows.indexOf(row);
        if (from === -1) return;

        const geometry: DragGeometry = {
            midYs: rows.map(el => {
                const rect = el.getBoundingClientRect();
                return rect.top + rect.height / 2;
            }),
            draggedHeight: row.getBoundingClientRect().height,
        };
        const startY = event.clientY;
        let slot = from;
        let moved = false;

        list.addClass('is-reordering');
        row.addClass('is-dragging');
        try {
            handle.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is best-effort; without it the drag simply
            // ends when the pointer leaves the handle.
        }

        const paint = (dy: number): void => {
            row.setCssProps(dy ? { transform: `translateY(${dy}px)` } : { transform: '' });
            const shifts = planShifts(rows.length, from, slot, geometry.draggedHeight);
            rows.forEach((el, i) => {
                if (i === from) return;
                el.setCssProps(shifts[i] ? { transform: `translateY(${shifts[i]}px)` } : { transform: '' });
            });
        };

        const onMove = (e: PointerEvent): void => {
            const dy = e.clientY - startY;
            if (!moved && Math.abs(dy) >= DRAG_THRESHOLD_PX) moved = true;
            slot = planSlot(geometry.midYs, from, geometry.midYs[from]! + dy);
            paint(dy);
        };

        const detach = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onCancel);
            document.removeEventListener('keydown', onKeydown, true);
            list.removeClass('is-reordering');
            row.removeClass('is-dragging');
            rows.forEach(el => { el.setCssProps({ transform: '' }); });
        };

        const finish = (commit: boolean): void => {
            detach();
            if (commit && moved && slot !== from) onReorder(from, slot);
        };

        const onUp = (): void => finish(true);
        const onCancel = (): void => finish(false);
        const onKeydown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') finish(false);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onCancel);
        document.addEventListener('keydown', onKeydown, true);
    });
}
