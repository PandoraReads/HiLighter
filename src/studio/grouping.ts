// ============================================================
// HiLighter - Studio grouping / sorting / filtering (pure)
// ============================================================
// No Obsidian imports: testable under vitest. Locale-dependent
// labels come from the standalone i18n module; colors arrive as
// ColorDef[] so customs work without touching settings here.

import type { HighlightNote } from '../models';
import type { HiLighterSettings } from '../models';
import { t } from '../i18n';
import { getColors } from '../colors';
import type { ColorDef } from '../colors';
import type { FilterItem, NoteGroup, StudioGroupBy, StudioSortBy } from './studio-state';

export function dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface FilterOptions {
    query: string;
    selectedGroups: Set<string>;
    groupBy: StudioGroupBy;
    /** Excludes archive-tagged cards (review sessions). */
    excludeArchive?: boolean;
    archiveTag?: string;
}

/** Search + facet drill-in filter. Returns a new array; input untouched. */
export function filterHighlights(notes: HighlightNote[], opts: FilterOptions): HighlightNote[] {
    const q = opts.query.toLowerCase();
    const hasFilter = opts.selectedGroups.size > 0;
    const archiveTag = opts.archiveTag ?? t('tag.archive');

    return notes.filter(h => {
        const matchesSearch = (h.text + (h.note || '') + (h.tags || []).join(' ')).toLowerCase()
            .indexOf(q) !== -1;
        if (!matchesSearch) return false;
        if (opts.excludeArchive && (h.tags || []).indexOf(archiveTag) !== -1) return false;
        if (!hasFilter) return true;
        // Drill-in within the active grouping dimension
        switch (opts.groupBy) {
            case 'file': return opts.selectedGroups.has(h.sourcePath);
            case 'tag': return (h.tags || []).some(tg => opts.selectedGroups.has(tg));
            case 'color': return opts.selectedGroups.has(h.color);
            case 'date': return opts.selectedGroups.has(monthKey(h.createdAt));
            default: return true;
        }
    });
}

/** Pinned cards float to the top, then the chosen sort applies. */
export function sortHighlights(notes: HighlightNote[], sortBy: StudioSortBy): HighlightNote[] {
    const sorted = [...notes].sort((a, b) => {
        if (sortBy === 'source_order') {
            const sourceCompare = a.sourcePath.localeCompare(b.sourcePath, undefined, { numeric: true, sensitivity: 'base' });
            if (sourceCompare !== 0) return sourceCompare;
            // Markdown lineIndex and PDF page positions share this field. EPUB
            // cards use CFI as a finer-grained fallback when lineIndex ties.
            if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
            const cfiCompare = (a.cfi || '').localeCompare(b.cfi || '', undefined, { numeric: true, sensitivity: 'base' });
            if (cfiCompare !== 0) return cfiCompare;
            return a.createdAt - b.createdAt;
        }

        // Pinned cards always float to the top (most recently pinned first)
        const pa = (a.pinned || 0) > 0 ? 1 : 0;
        const pb = (b.pinned || 0) > 0 ? 1 : 0;
        if (pa !== pb) return pb - pa;
        if (pa === 1) return (b.pinned || 0) - (a.pinned || 0);

        if (sortBy === 'az') return a.text.localeCompare(b.text);
        if (sortBy === 'za') return b.text.localeCompare(a.text);
        if (sortBy === 'time_asc') return a.createdAt - b.createdAt;   // old → new
        return b.createdAt - a.createdAt;                              // time_desc new → old
    });
    return sorted;
}

export const UNTAGGED_KEY = '__untagged__';

/** Buckets notes into ordered, named groups for the gallery / list body. */
export function groupHighlights(
    notes: HighlightNote[],
    groupBy: StudioGroupBy,
    colors: ColorDef[],
): NoteGroup[] {
    const map = new Map<string, HighlightNote[]>();
    const ensure = (key: string): HighlightNote[] => {
        if (!map.has(key)) map.set(key, []);
        return map.get(key)!;
    };

    if (groupBy === 'color') {
        notes.forEach(h => ensure(h.color).push(h));
        const byId = new Map(colors.map(c => [c.id, c]));
        // Presets first, then customs (getColors order); unknown ids sink to the end.
        return [...map.keys()]
            .sort((a, b) => {
                const ia = byId.has(a) ? colors.findIndex(c => c.id === a) : colors.length;
                const ib = byId.has(b) ? colors.findIndex(c => c.id === b) : colors.length;
                return ia - ib;
            })
            .map(id => ({
                key: id,
                name: byId.get(id)?.label ?? id,
                items: map.get(id)!,
            }));
    }

    if (groupBy === 'file') {
        notes.forEach(h => ensure(h.sourcePath).push(h));
        return [...map.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([p, its]) => ({ key: p, name: p.split('/').pop()!.replace(/\.md$/, ''), items: its }));
    }

    if (groupBy === 'tag') {
        notes.forEach(h => {
            const tags = (h.tags || []).filter(tg => tg);
            if (tags.length === 0) ensure(UNTAGGED_KEY).push(h);
            else tags.forEach(tg => ensure(tg).push(h));
        });
        return [...map.entries()]
            .sort((a, b) => {
                if (a[0] === UNTAGGED_KEY) return 1;
                if (b[0] === UNTAGGED_KEY) return -1;
                return b[1].length - a[1].length;
            })
            .map(([k, its]) => ({ key: k, name: k === UNTAGGED_KEY ? t('manager.group.untagged') : k, items: its }));
    }

    if (groupBy === 'date') {
        notes.forEach(h => ensure(monthKey(h.createdAt)).push(h));
        return [...map.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([k, its]) => {
                const [y, m] = k.split('-');
                const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
                return { key: k, name, items: its };
            });
    }

    return [{ key: 'all', name: '', items: [...notes] }];
}

/** Facet rows for the filter dropdown, for the active grouping dimension. */
export function collectFilterItems(
    notes: HighlightNote[],
    groupBy: StudioGroupBy,
    colors: ColorDef[],
): FilterItem[] {
    const map = new Map<string, number>();
    const inc = (k: string) => map.set(k, (map.get(k) || 0) + 1);

    if (groupBy === 'file') {
        notes.forEach(h => inc(h.sourcePath));
        return [...map.entries()].sort((a, b) => b[1] - a[1])
            .map(([p, c]) => ({ key: p, label: p.split('/').pop()!.replace(/\.md$/, ''), count: c }));
    }

    if (groupBy === 'tag') {
        notes.forEach(h => (h.tags || []).forEach(tg => inc(tg)));
        return [...map.entries()].sort((a, b) => b[1] - a[1])
            .map(([tg, c]) => ({ key: tg, label: tg, count: c }));
    }

    if (groupBy === 'color') {
        notes.forEach(h => inc(h.color));
        return colors
            .filter(c => (map.get(c.id) || 0) > 0)
            .map(c => ({ key: c.id, label: c.label, count: map.get(c.id)!, color: c.hex }));
    }

    if (groupBy === 'date') {
        notes.forEach(h => inc(monthKey(h.createdAt)));
        return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
            .map(([k, c]) => {
                const [y, m] = k.split('-');
                const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
                return { key: k, label, count: c };
            });
    }

    return [];
}

/** Short dimension name for trigger labels. */
export function groupByLabel(groupBy: StudioGroupBy): string {
    switch (groupBy) {
        case 'file': return t('manager.nav.files');
        case 'tag': return t('manager.nav.tags');
        case 'color': return t('manager.nav.colors');
        case 'date': return t('manager.nav.dates');
        default: return '';
    }
}

// ============================================================
// Deck pipeline: filter → sort → group in one call
// ============================================================

/** Structural slice of the studio view the deck pipeline needs. */
export interface DeckSource {
    highlights: HighlightNote[];
    searchQuery: string;
    selectedGroups: Set<string>;
    groupBy: StudioGroupBy;
    sortBy: StudioSortBy;
    plugin: { settings: HiLighterSettings };
}

/** Current visible groups (search + facets + sort applied). */
export function deckGroups(view: DeckSource): NoteGroup[] {
    const filtered = filterHighlights(view.highlights, {
        query: view.searchQuery,
        selectedGroups: view.selectedGroups,
        groupBy: view.groupBy,
    });
    return groupHighlights(sortHighlights(filtered, view.sortBy), view.groupBy, getColors(view.plugin.settings));
}

// ============================================================
// Drag-and-drop between groups → attribute change planning
// ============================================================

/** What dropping a card onto a group means. */
export type DropPlan =
    | { type: 'color'; color: string }
    | { type: 'addTag'; tag: string }
    | { type: 'clearTags' }
    | { type: 'noop' }
    | { type: 'unsupported' };

/** Pure decision: dropping `note` onto the group keyed `targetKey`.
 *  Color groups recolor; tag groups add the tag (untagged clears all);
 *  file/date groups own no editable attribute. */
export function planGroupDrop(groupBy: StudioGroupBy, targetKey: string, note: HighlightNote): DropPlan {
    if (groupBy === 'color') {
        return note.color === targetKey
            ? { type: 'noop' }
            : { type: 'color', color: targetKey };
    }
    if (groupBy === 'tag') {
        if (targetKey === UNTAGGED_KEY) {
            return (note.tags || []).length === 0
                ? { type: 'noop' }
                : { type: 'clearTags' };
        }
        return (note.tags || []).includes(targetKey)
            ? { type: 'noop' }
            : { type: 'addTag', tag: targetKey };
    }
    return { type: 'unsupported' };
}

/** Can cards be dropped between groups in this dimension at all? */
export function dropEnabled(groupBy: StudioGroupBy): boolean {
    return groupBy === 'color' || groupBy === 'tag';
}
