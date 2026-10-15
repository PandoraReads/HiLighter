// ============================================================
// HiLighter - FSRS review session controller
// ============================================================
// Owns the queue + stats on the view's reviewSession state and
// persists every rating. UI lives in review-view.ts.

import { db } from '../../db';
import { t } from '../../i18n';
import type { HighlightNote } from '../../models';
import {
    buildSession,
    scheduleNote,
    requeueIfStillLearning,
    emptyStats,
    type Grade,
} from '../../fsrs';
import type { HighlightManagerView } from '../studio-view';

export function startFsrsSession(view: HighlightManagerView, mode: 'due' | 'new'): void {
    const pool = view.highlights.filter(h => {
        // Honor the toolbar search/facet filters like the old shuffle did
        const q = view.searchQuery.toLowerCase();
        const matchesSearch = (h.text + (h.note || '') + (h.tags || []).join(' ')).toLowerCase()
            .indexOf(q) !== -1;
        if (!matchesSearch) return false;
        if (view.selectedGroups.size === 0) return true;
        switch (view.groupBy) {
            case 'file': return view.selectedGroups.has(h.sourcePath);
            case 'tag': return (h.tags || []).some(tg => view.selectedGroups.has(tg));
            case 'color': return view.selectedGroups.has(h.color);
            case 'date': {
                const d = new Date(h.createdAt);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                return view.selectedGroups.has(key);
            }
            default: return true;
        }
    });

    const { queue } = buildSession(view.highlights, {
        mode,
        archiveTag: t('tag.archive'),
        newPerDay: view.plugin.settings.fsrs?.newPerDay ?? 20,
        pool,
    });

    view.reviewSession = {
        active: true,
        mode,
        queue,
        total: queue.length,
        flipped: false,
        stats: emptyStats(),
    };
    view.render();
}

export function exitSession(view: HighlightManagerView): void {
    view.reviewSession = {
        active: false,
        mode: 'due',
        queue: [],
        total: 0,
        flipped: false,
        stats: emptyStats(),
    };
    view.render();
}

/** Skip without rating: card moves to the end of the queue. */
export function skipCurrent(view: HighlightManagerView): void {
    const s = view.reviewSession;
    if (!s.active || s.queue.length === 0) return;
    const current = s.queue[0]!;
    s.queue = [...s.queue.slice(1), current];
    s.flipped = false;
    view.render();
}

/** Rates the current card, persists the new schedule and advances. */
export async function rateCurrent(view: HighlightManagerView, grade: Grade): Promise<void> {
    const s = view.reviewSession;
    if (!s.active || s.queue.length === 0) return;
    const current = s.queue[0]!;

    try {
        const next = scheduleNote(current, grade, view.plugin.settings.fsrs);
        await db.updateHighlightNote(current.id, { fsrs: next });
        current.fsrs = next;

        const updated: HighlightNote = { ...current, fsrs: next };
        const rest = s.queue.slice(1);
        s.queue = requeueIfStillLearning(rest, updated);
        s.stats = {
            ...s.stats,
            reviewed: s.stats.reviewed + 1,
            again: s.stats.again + (grade === 1 ? 1 : 0),
            hard: s.stats.hard + (grade === 2 ? 1 : 0),
            good: s.stats.good + (grade === 3 ? 1 : 0),
            easy: s.stats.easy + (grade === 4 ? 1 : 0),
        };
        s.flipped = false;
        // Refresh the view's deck so the due badge + future sessions see it
        await view.loadHighlights();
        view.render();
    } catch {
        // Keep the session alive; the card stays at the head of the queue.
        view.render();
    }
}
