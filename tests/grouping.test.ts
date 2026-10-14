import { describe, it, expect } from 'vitest';
import { setLang } from '../src/i18n';
import type { ColorDef } from '../src/colors';
import {
    filterHighlights,
    sortHighlights,
    groupHighlights,
    collectFilterItems,
    monthKey,
    dayKey,
    planGroupDrop,
    dropEnabled,
    UNTAGGED_KEY,
} from '../src/studio/grouping';
import type { HighlightNote } from '../src/models';

/** Preset + one custom, in getColors order. */
const COLORS: ColorDef[] = [
    { id: 'yellow', label: 'Yellow', hex: '#ffd700', isCustom: false },
    { id: 'pink', label: 'Pink', hex: '#ff8fb7', isCustom: false },
    { id: 'blue', label: 'Questions', hex: '#87ceeb', isCustom: false },
    { id: 'green', label: 'Green', hex: '#98fb98', isCustom: false },
    { id: 'c_abcd1234', label: '紫色', hex: '#b39ddb', isCustom: true },
];

function makeNote(overrides: Partial<HighlightNote> = {}): HighlightNote {
    return {
        id: overrides.id ?? 'id-' + Math.random().toString(36).slice(2, 8),
        text: overrides.text ?? 'sample text',
        color: overrides.color ?? 'yellow',
        note: overrides.note ?? '',
        sourcePath: overrides.sourcePath ?? 'notes/a.md',
        lineIndex: overrides.lineIndex ?? 0,
        createdAt: overrides.createdAt ?? Date.now(),
        tags: overrides.tags,
        pinned: overrides.pinned,
    };
}

describe('filterHighlights', () => {
    it('matches text, note and tags against the query', () => {
        setLang('zh');
        const notes = [
            makeNote({ id: '1', text: 'stoic philosophy', note: '', tags: [] }),
            makeNote({ id: '2', text: 'other', note: 'mentions STOIC briefly', tags: [] }),
            makeNote({ id: '3', text: 'plain', note: '', tags: ['stoicism'] }),
            makeNote({ id: '4', text: 'unrelated', note: '', tags: [] }),
        ];
        const out = filterHighlights(notes, {
            query: 'stoic',
            selectedGroups: new Set(),
            groupBy: 'file',
        });
        expect(out.map(n => n.id)).toEqual(['1', '2', '3']);
    });

    it('drills into the active dimension via selectedGroups', () => {
        const notes = [
            makeNote({ id: '1', sourcePath: 'a.md' }),
            makeNote({ id: '2', sourcePath: 'b.md' }),
        ];
        const out = filterHighlights(notes, {
            query: '',
            selectedGroups: new Set(['b.md']),
            groupBy: 'file',
        });
        expect(out.map(n => n.id)).toEqual(['2']);
    });

    it('excludes archive-tagged cards only when asked', () => {
        setLang('zh'); // archive tag = 归档
        const notes = [
            makeNote({ id: '1', tags: ['归档'] }),
            makeNote({ id: '2', tags: ['重点'] }),
        ];
        const opts = { query: '', selectedGroups: new Set<string>(), groupBy: 'file' as const };
        expect(filterHighlights(notes, opts).map(n => n.id)).toEqual(['1', '2']);
        expect(filterHighlights(notes, { ...opts, excludeArchive: true }).map(n => n.id)).toEqual(['2']);
    });
});

describe('sortHighlights', () => {
    it('sorts by time desc (default), asc, az and za', () => {
        const notes = [
            makeNote({ id: 'b', text: 'banana', createdAt: 200 }),
            makeNote({ id: 'a', text: 'apple', createdAt: 300 }),
            makeNote({ id: 'c', text: 'cherry', createdAt: 100 }),
        ];
        expect(sortHighlights(notes, 'time_desc').map(n => n.id)).toEqual(['a', 'b', 'c']);
        expect(sortHighlights(notes, 'time_asc').map(n => n.id)).toEqual(['c', 'b', 'a']);
        expect(sortHighlights(notes, 'az').map(n => n.id)).toEqual(['a', 'b', 'c']);
        expect(sortHighlights(notes, 'za').map(n => n.id)).toEqual(['c', 'b', 'a']);
    });

    it('floats pinned cards to the top, most recently pinned first', () => {
        const notes = [
            makeNote({ id: 'plain', createdAt: 9999 }),
            makeNote({ id: 'pin-old', pinned: 100 }),
            makeNote({ id: 'pin-new', pinned: 200 }),
        ];
        expect(sortHighlights(notes, 'time_desc').map(n => n.id)).toEqual(['pin-new', 'pin-old', 'plain']);
    });

    it('does not mutate the input array', () => {
        const notes = [makeNote({ createdAt: 2 }), makeNote({ createdAt: 1 })];
        const snapshot = [...notes];
        sortHighlights(notes, 'time_asc');
        expect(notes).toEqual(snapshot);
    });
});

describe('groupHighlights', () => {
    it('groups by file and orders groups by size', () => {
        const notes = [
            makeNote({ id: '1', sourcePath: 'small.md' }),
            makeNote({ id: '2', sourcePath: 'big.md' }),
            makeNote({ id: '3', sourcePath: 'big.md' }),
        ];
        const groups = groupHighlights(notes, 'file', COLORS);
        expect(groups.map(g => g.name)).toEqual(['big', 'small']);
        expect(groups[0]!.items).toHaveLength(2);
    });

    it('groups by tag and forces the untagged bucket last', () => {
        setLang('zh');
        const notes = [
            makeNote({ id: '1', tags: [] }),
            makeNote({ id: '2', tags: ['x'] }),
            makeNote({ id: '3', tags: ['x', 'y'] }),
        ];
        const groups = groupHighlights(notes, 'tag', COLORS);
        expect(groups.map(g => g.key)).toEqual(['x', 'y', '__untagged__']);
        expect(groups[2]!.name).toBe('未标签');
    });

    it('groups by color in preset order (customs after presets)', () => {
        const notes = [
            makeNote({ color: 'green' }),
            makeNote({ color: 'c_abcd1234' }),
            makeNote({ color: 'yellow' }),
            makeNote({ color: 'green' }),
        ];
        const groups = groupHighlights(notes, 'color', COLORS);
        expect(groups.map(g => g.key)).toEqual(['yellow', 'green', 'c_abcd1234']);
        expect(groups[1]!.items).toHaveLength(2);
    });

    it('uses the resolved color label (custom name or semantic label)', () => {
        const groups = groupHighlights(
            [makeNote({ color: 'blue' }), makeNote({ color: 'c_abcd1234' })],
            'color',
            COLORS,
        );
        expect(groups.map(g => g.name)).toEqual(['Questions', '紫色']);
    });

    it('groups by month, newest first', () => {
        const notes = [
            makeNote({ createdAt: new Date('2026-01-05').getTime() }),
            makeNote({ createdAt: new Date('2025-12-01').getTime() }),
        ];
        const groups = groupHighlights(notes, 'date', COLORS);
        expect(groups.map(g => g.key)).toEqual(['2026-01', '2025-12']);
    });
});

describe('collectFilterItems', () => {
    it('returns facet rows with counts for files', () => {
        const notes = [
            makeNote({ sourcePath: 'x/a.md' }),
            makeNote({ sourcePath: 'x/a.md' }),
            makeNote({ sourcePath: 'y/b.md' }),
        ];
        const items = collectFilterItems(notes, 'file', COLORS);
        expect(items[0]).toMatchObject({ key: 'x/a.md', label: 'a', count: 2 });
        expect(items[1]).toMatchObject({ key: 'y/b.md', label: 'b', count: 1 });
    });

    it('returns color facets in resolved order with hexes', () => {
        const notes = [makeNote({ color: 'pink' }), makeNote({ color: 'yellow' })];
        const items = collectFilterItems(notes, 'color', COLORS);
        expect(items.map(i => i.key)).toEqual(['yellow', 'pink']);
        expect(items[0]!.color).toBe('#ffd700');
    });

    it('returns empty for an unknown dimension', () => {
        expect(collectFilterItems([makeNote()], 'file', COLORS)).toHaveLength(1);
    });
});

describe('key helpers', () => {
    it('dayKey zero-pads month and day', () => {
        expect(dayKey(new Date(2026, 2, 7))).toBe('2026-03-07');
    });

    it('monthKey zero-pads the month', () => {
        expect(monthKey(new Date(2026, 10, 20).getTime())).toBe('2026-11');
    });
});

describe('planGroupDrop (drag between groups)', () => {
    it('color dimension: dropping on another color group recolors; same group is a no-op', () => {
        const note = makeNote({ color: 'yellow' });
        expect(planGroupDrop('color', 'blue', note)).toEqual({ type: 'color', color: 'blue' });
        expect(planGroupDrop('color', 'yellow', note)).toEqual({ type: 'noop' });
    });

    it('tag dimension: adds the target tag; existing tag is a no-op', () => {
        const note = makeNote({ tags: ['x'] });
        expect(planGroupDrop('tag', 'y', note)).toEqual({ type: 'addTag', tag: 'y' });
        expect(planGroupDrop('tag', 'x', note)).toEqual({ type: 'noop' });
    });

    it('tag dimension: dropping on the untagged group clears all tags (no-op when already empty)', () => {
        expect(planGroupDrop('tag', UNTAGGED_KEY, makeNote({ tags: ['x', 'y'] }))).toEqual({ type: 'clearTags' });
        expect(planGroupDrop('tag', UNTAGGED_KEY, makeNote({ tags: [] }))).toEqual({ type: 'noop' });
    });

    it('file and date dimensions own no editable attribute', () => {
        const note = makeNote({ sourcePath: 'a.md', createdAt: 1000 });
        expect(planGroupDrop('file', 'b.md', note)).toEqual({ type: 'unsupported' });
        expect(planGroupDrop('date', '2026-10', note)).toEqual({ type: 'unsupported' });
    });

    it('dropEnabled matches the droppable dimensions', () => {
        expect(dropEnabled('color')).toBe(true);
        expect(dropEnabled('tag')).toBe(true);
        expect(dropEnabled('file')).toBe(false);
        expect(dropEnabled('date')).toBe(false);
    });
});
