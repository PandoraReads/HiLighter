// ============================================================
// HiLighter - Studio stats / insights panel
// ============================================================

import type { HighlightNote } from '../models';
import { t } from '../i18n';
import { getColors } from '../colors';
import type { ColorDef } from '../colors';
import { dayKey } from './grouping';
import { dueCount } from '../fsrs';
import type { HighlightManagerView } from './studio-view';

export interface StudioStats {
    total: number;
    byColor: Record<string, number>;
    dayCounts: Map<string, number>;
    thisWeek: number;
    streak: number;
    topTags: [string, number][];
    topFiles: [string, number][];
}

const DAY = 86400000;

export function computeStats(notes: HighlightNote[]): StudioStats {
    const byColor: Record<string, number> = {};
    const tagMap = new Map<string, number>();
    const fileMap = new Map<string, number>();
    const dayCounts = new Map<string, number>();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    notes.forEach(h => {
        byColor[h.color] = (byColor[h.color] || 0) + 1;
        (h.tags || []).forEach(tg => tagMap.set(tg, (tagMap.get(tg) || 0) + 1));
        fileMap.set(h.sourcePath, (fileMap.get(h.sourcePath) || 0) + 1);
        dayCounts.set(dayKey(new Date(h.createdAt)), (dayCounts.get(dayKey(new Date(h.createdAt))) || 0) + 1);
    });

    // This week (last 7 days including today)
    let thisWeek = 0;
    for (let i = 0; i < 7; i++) {
        thisWeek += dayCounts.get(dayKey(new Date(startOfToday - i * DAY))) || 0;
    }

    // Streak: consecutive active days back from today (skip today if empty)
    let streak = 0;
    let cursor = startOfToday;
    if ((dayCounts.get(dayKey(new Date(startOfToday))) || 0) === 0) {
        cursor = startOfToday - DAY;
    }
    while ((dayCounts.get(dayKey(new Date(cursor))) || 0) > 0) {
        streak++;
        cursor -= DAY;
    }

    const topTags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topFiles = [...fileMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    return { total: notes.length, byColor, dayCounts, thisWeek, streak, topTags, topFiles };
}

/** Renders the insights panel into the content body (toolbar stays mounted). */
export function renderStatsPanel(view: HighlightManagerView, parent: HTMLElement): void {
    parent.empty();
    const container = parent.createDiv('hl-insights');

    if (view.highlights.length === 0) {
        container.createDiv({ text: t('manager.insights.empty'), cls: 'hl-insights-empty' });
        return;
    }

    const stats = computeStats(view.highlights);

    container.createEl('h2', { text: t('manager.insights.heading'), cls: 'hl-insights-h2' });

    // Stat tiles
    const tiles = container.createDiv('hl-insights-tiles');
    const addTile = (label: string, value: string) => {
        const tile = tiles.createDiv('hl-stat-tile');
        tile.createDiv({ text: value, cls: 'hl-stat-value' });
        tile.createDiv({ text: label, cls: 'hl-stat-label' });
    };
    addTile(t('manager.insights.total'), String(stats.total));
    addTile(t('manager.insights.streak'), String(stats.streak));
    addTile(t('manager.insights.thisWeek'), String(stats.thisWeek));

    // FSRS tiles (only meaningful once review progress exists)
    const scheduled = view.highlights.filter(h => h.fsrs != null);
    if (scheduled.length > 0) {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const reviewedToday = scheduled.filter(h => (h.fsrs!.lastReview ?? 0) >= startOfToday).length;
        const avgReps = scheduled.reduce((sum, h) => sum + h.fsrs!.reps, 0) / scheduled.length;
        addTile(t('fsrs.stats.dueToday'), String(dueCount(view.highlights)));
        addTile(t('fsrs.stats.reviewedToday'), String(reviewedToday));
        addTile(t('fsrs.stats.avgReps'), avgReps.toFixed(1));
    }

    // Heatmap
    const heatSection = container.createDiv('hl-insights-section');
    heatSection.createDiv({ text: t('manager.insights.last6mo'), cls: 'hl-insights-section-title' });
    renderHeatmap(heatSection, stats.dayCounts);

    // Color distribution
    const colorSection = container.createDiv('hl-insights-section');
    colorSection.createDiv({ text: t('manager.insights.byColor'), cls: 'hl-insights-section-title' });
    renderColorDist(colorSection, stats.byColor, getColors(view.plugin.settings));

    // Top tags + top files (two columns)
    const twoCol = container.createDiv('hl-insights-twocol');
    const tagsCol = twoCol.createDiv('hl-insights-col');
    tagsCol.createDiv({ text: t('manager.insights.topTags'), cls: 'hl-insights-section-title' });
    renderRankList(tagsCol, stats.topTags);
    const filesCol = twoCol.createDiv('hl-insights-col');
    filesCol.createDiv({ text: t('manager.insights.topFiles'), cls: 'hl-insights-section-title' });
    const fileItems: [string, number][] = stats.topFiles.map(([p, c]) => [p.split('/').pop()!.replace(/\.md$/, ''), c] as [string, number]);
    renderRankList(filesCol, fileItems);
}

function renderHeatmap(parent: HTMLElement, dayCounts: Map<string, number>): void {
    const WEEKS = 27;
    const today = new Date();
    const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const lastSunday = new Date(todayMid.getTime() - todayMid.getDay() * DAY);
    const start = new Date(lastSunday.getTime() - (WEEKS - 1) * 7 * DAY);

    const max = Math.max(1, ...dayCounts.values());

    const grid = parent.createDiv('hl-heatmap');
    for (let w = 0; w < WEEKS; w++) {
        const col = grid.createDiv('hl-heatmap-col');
        for (let d = 0; d < 7; d++) {
            const dayDate = new Date(start.getTime() + (w * 7 + d) * DAY);
            if (dayDate.getTime() > todayMid.getTime()) {
                col.createDiv('hl-heatmap-cell is-future');
                continue;
            }
            const count = dayCounts.get(dayKey(dayDate)) || 0;
            const cell = col.createDiv('hl-heatmap-cell');
            if (count > 0) {
                const level = Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
                cell.addClass('hl-level-' + level);
            }
            cell.setAttribute('aria-label', `${dayKey(dayDate)}: ${count}`);
        }
    }

    const legend = parent.createDiv('hl-heatmap-legend');
    legend.createSpan({ text: t('manager.insights.less'), cls: 'hl-heatmap-legend-label' });
    for (let l = 0; l <= 4; l++) {
        const c = legend.createDiv('hl-heatmap-cell hl-heatmap-legend-cell');
        if (l > 0) c.addClass('hl-level-' + l);
    }
    legend.createSpan({ text: t('manager.insights.more'), cls: 'hl-heatmap-legend-label' });
}

function renderColorDist(parent: HTMLElement, byColor: Record<string, number>, colors: ColorDef[]): void {
    const total = Object.values(byColor).reduce((a, b) => a + b, 0) || 1;
    colors.forEach(({ id, label, hex }) => {
        const count = byColor[id] || 0;
        const pct = Math.round((count / total) * 100);
        const row = parent.createDiv('hl-colorbar-row');
        const labelEl = row.createDiv('hl-colorbar-label');
        labelEl.createSpan({ cls: 'hl-colorbar-dot', attr: { style: `background:${hex}` } });
        labelEl.createSpan({ text: label });
        const track = row.createDiv('hl-colorbar-track');
        track.createDiv({ cls: 'hl-colorbar-fill', attr: { style: `width:${pct}%; background:${hex}` } });
        row.createDiv({ text: String(count), cls: 'hl-colorbar-count' });
    });
}

function renderRankList(parent: HTMLElement, items: [string, number][]): void {
    if (items.length === 0) {
        parent.createDiv({ text: '—', cls: 'hl-insights-subempty' });
        return;
    }
    const max = items[0]![1];
    items.forEach(([name, count]) => {
        const pct = Math.max(8, Math.round((count / max) * 100));
        const row = parent.createDiv('hl-rank-row');
        row.createDiv({ text: name, cls: 'hl-rank-name' });
        const track = row.createDiv('hl-rank-track');
        track.createDiv({ cls: 'hl-rank-fill', attr: { style: `width:${pct}%` } });
        row.createDiv({ text: String(count), cls: 'hl-rank-count' });
    });
}
