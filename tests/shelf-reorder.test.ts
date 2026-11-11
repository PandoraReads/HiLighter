import { describe, expect, it } from 'vitest';
import { planShifts, planSlot } from '../src/bookshelf/shelf-reorder';

// Four rows of height 40 stacked from y=0: midpoints at 20/60/100/140.
const MID_YS = [20, 60, 100, 140];
const H = 40;

describe('planSlot', () => {
    it('at rest the slot equals the dragged row index', () => {
        expect(planSlot(MID_YS, 0, 20)).toBe(0);
        expect(planSlot(MID_YS, 2, 100)).toBe(2);
    });

    it('counts other rows resting above the dragged center', () => {
        // Row 0 dragged just past row 1's midpoint: one row above -> slot 1.
        expect(planSlot(MID_YS, 0, 61)).toBe(1);
        // Row 0 dragged to the very bottom: rows 1..3 above -> slot 3.
        expect(planSlot(MID_YS, 0, 160)).toBe(3);
        // Row 3 dragged to the top: zero rows above -> slot 0.
        expect(planSlot(MID_YS, 3, 0)).toBe(0);
    });

    it('crossing backwards shrinks the slot one row at a time', () => {
        expect(planSlot(MID_YS, 2, 99)).toBe(2);
        expect(planSlot(MID_YS, 2, 59)).toBe(1);
        expect(planSlot(MID_YS, 2, 19)).toBe(0);
    });
});

describe('planShifts', () => {
    it('no shift when the slot equals the start index', () => {
        expect(planShifts(4, 1, 1, H)).toEqual([0, 0, 0, 0]);
    });

    it('dragging down shifts crossed rows up by the dragged height', () => {
        // Row 0 -> slot 2: rows 1 and 2 slide up.
        expect(planShifts(4, 0, 2, H)).toEqual([0, -H, -H, 0]);
    });

    it('dragging up shifts crossed rows down by the dragged height', () => {
        // Row 3 -> slot 1: rows 1 and 2 slide down.
        expect(planShifts(4, 3, 1, H)).toEqual([0, H, H, 0]);
    });

    it('rows outside the crossed range stay put', () => {
        expect(planShifts(4, 1, 3, H)).toEqual([0, 0, -H, -H]);
        expect(planShifts(4, 2, 0, H)).toEqual([H, H, 0, 0]);
    });
});
