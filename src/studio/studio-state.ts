// ============================================================
// HiLighter - Studio view state types
// ============================================================

import type { App, Component } from 'obsidian';
import type HiLighterPlugin from '../main';
import type { HighlightNote } from '../models';

/** Gallery grouping dimension (was derived from the old sidebar tab) */
export type StudioGroupBy = 'file' | 'tag' | 'color' | 'date' | 'template';

/** Sort modes for the gallery / list body */
export type StudioSortBy = 'time_desc' | 'time_asc' | 'az' | 'za' | 'source_order';

/** Content view modes (review is a transient session, not a mode) */
export type StudioViewMode = 'gallery' | 'list';

/** One facet row inside the filter dropdown */
export interface FilterItem {
    key: string;
    label: string;
    count: number;
    color?: string;
}

/** One rendered group section in the gallery / list body */
export interface NoteGroup {
    key: string;
    name: string;
    items: HighlightNote[];
}

/** FSRS flashcard session state (queue[0] is the current card). */
export interface ReviewSession {
    active: boolean;
    mode: 'due' | 'new';
    queue: HighlightNote[];
    waiting: HighlightNote[]; // learning cards scheduled later in this session
    total: number;          // initial queue size (for progress display)
    flipped: boolean;       // front (quote) vs back (note) of the current card
    stats: {
        reviewed: number;
        again: number;
        hard: number;
        good: number;
        easy: number;
    };
}

/**
 * Minimal host surface the FSRS review modules need. Both the studio view
 * and the desktop bookshelf view satisfy it structurally, so the review
 * UI can run inside either page.
 */
export interface ReviewHost extends Component {
    app: App;
    plugin: HiLighterPlugin;
    highlights: HighlightNote[];
    searchQuery: string;
    selectedGroups: Set<string>;
    groupBy: StudioGroupBy;
    reviewSession: ReviewSession;
    render(): void;
    loadHighlights(): Promise<void>;
}

/** Minimal host surface the stats panel needs (reused by the bookshelf page). */
export interface StatsHost {
    plugin: HiLighterPlugin;
    highlights: HighlightNote[];
}
