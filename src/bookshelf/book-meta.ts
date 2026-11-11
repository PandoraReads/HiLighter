// ============================================================
// HiLighter - Book metadata pure logic (书籍元数据)
// ============================================================
// Normalization, reading-progress side effects, reading-day logging
// and reading-stats derivation for the per-book metadata map stored
// in settings. No Obsidian imports so everything stays unit-testable.
// Cross-device merge lives in sync/shelf-collections.ts beside its
// sibling collections.

import type { BookMeta } from '../models';
import { dayKey } from '../studio/grouping';

const DAY_MS = 86400000;
/** Reading-day log retention: entries older than this are pruned on merge. */
export const READING_DAYS_RETENTION_DAYS = 3 * 365;

const MAX_TITLE = 300;
const MAX_AUTHOR = 120;

/** Publication date: YYYY, YYYY-MM or YYYY-MM-DD (month/day ranges checked). */
export function isValidPublishDate(value: string): boolean {
    const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value);
    if (!match) return false;
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;
    if (month !== null && (month < 1 || month > 12)) return false;
    if (day !== null && (day < 1 || day > 31)) return false;
    return true;
}

/** True when the value is a rating in 0.5 steps within 0-5 (0 = unrated). */
function isHalfStepRating(value: number): boolean {
    return Number.isFinite(value) && value >= 0.5 && value <= 5
        && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

function cleanString(raw: unknown, max: number): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim().slice(0, max);
    return trimmed || undefined;
}

function cleanEpoch(raw: unknown): number | undefined {
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

/** Coerces one unknown record into a well-shaped BookMeta; junk fields drop. */
export function normalizeBookMeta(raw: unknown): BookMeta | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const src = raw as Record<string, unknown>;
    const updatedAt = typeof src.updatedAt === 'number' && Number.isFinite(src.updatedAt)
        ? src.updatedAt
        : undefined;
    if (updatedAt === undefined) return null;

    const meta: BookMeta = { updatedAt };
    const title = cleanString(src.title, MAX_TITLE);
    if (title) meta.title = title;
    const author = cleanString(src.author, MAX_AUTHOR);
    if (author) meta.author = author;
    const publishDate = cleanString(src.publishDate, 10);
    if (publishDate && isValidPublishDate(publishDate)) meta.publishDate = publishDate;
    if (typeof src.pages === 'number' && Number.isInteger(src.pages) && src.pages > 0 && src.pages <= 100000) {
        meta.pages = src.pages;
    }
    if (typeof src.rating === 'number' && isHalfStepRating(src.rating)) meta.rating = src.rating;
    if (typeof src.progress === 'number' && Number.isInteger(src.progress)
        && src.progress >= 0 && src.progress <= 100) {
        meta.progress = src.progress;
    }
    const startedAt = cleanEpoch(src.startedAt);
    if (startedAt) meta.startedAt = startedAt;
    const finishedAt = cleanEpoch(src.finishedAt);
    if (finishedAt) meta.finishedAt = finishedAt;

    const hasContent = meta.title !== undefined || meta.author !== undefined
        || meta.publishDate !== undefined || meta.pages !== undefined
        || meta.rating !== undefined || meta.progress !== undefined
        || meta.startedAt !== undefined || meta.finishedAt !== undefined;
    return hasContent ? meta : null;
}

/** Coerces an unknown settings field into a clean path -> BookMeta map. */
export function normalizeBookMetaMap(raw: unknown): Record<string, BookMeta> {
    const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: Record<string, BookMeta> = {};
    for (const [path, value] of Object.entries(source)) {
        if (!path) continue;
        const meta = normalizeBookMeta(value);
        if (meta) out[path] = meta;
    }
    return out;
}

/** Coerces an unknown settings field into 'yyyy-mm-dd' -> positive count. */
export function normalizeReadingDays(raw: unknown): Record<string, number> {
    const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(source)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        out[key] = Math.round(value);
    }
    return out;
}

/** Drops reading-day entries older than the retention window. */
export function pruneReadingDays(
    days: Record<string, number>,
    now: number,
    retentionDays: number = READING_DAYS_RETENTION_DAYS,
): Record<string, number> {
    const cutoff = dayKey(new Date(now - retentionDays * DAY_MS));
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(days)) {
        if (key >= cutoff) out[key] = value;
    }
    return out;
}

/**
 * Writes a new reading progress (0-100) for one book, recording the
 * derived lifecycle stamps: startedAt on the first move away from 0,
 * finishedAt when 100 is reached (kept on later re-reads so annual
 * counts never regress). The input map is never mutated.
 */
export function applyProgressTo(
    map: Record<string, BookMeta>,
    path: string,
    percent: number,
    now: number,
): Record<string, BookMeta> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const prev = map[path];
    const next: BookMeta = { ...(prev ?? { updatedAt: now }) };
    next.progress = clamped;
    if (clamped > 0 && !next.startedAt) next.startedAt = now;
    if (clamped >= 100 && !next.finishedAt) next.finishedAt = now;
    next.updatedAt = now;
    return { ...map, [path]: next };
}

/** Result of a deduped reading-day bump. */
export interface ReadingDayBump {
    days: Record<string, number>;
    /** New session set of counted `dayKey NUL path` tokens. */
    counted: Set<string>;
}

/**
 * Counts one book's activity on a day at most once per session: the
 * caller keeps the returned `counted` set and passes it back in. The
 * count itself is books-per-day, so a re-read the same day adds nothing.
 */
export function bumpReadingDay(
    days: Record<string, number>,
    key: string,
    path: string,
    counted: Set<string>,
): ReadingDayBump {
    const DAY_TOKEN_SEP = String.fromCharCode(0);
    const token = `${key}${DAY_TOKEN_SEP}${path}`;
    if (counted.has(token)) return { days, counted };
    return {
        days: { ...days, [key]: (days[key] ?? 0) + 1 },
        counted: new Set(counted).add(token),
    };
}

/** 'YYYY-MM-DD' at local midnight -> epoch ms; null when unparseable. */
export function parseDayInput(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
    const [y, m, d] = value.trim().split('-').map(Number) as [number, number, number];
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date.getTime();
}

/** Epoch ms -> 'YYYY-MM-DD' for prefilling day inputs. */
export function epochToDayInput(ms: number): string {
    return dayKey(new Date(ms));
}

/** Reading stats derived from book metadata + the activity log. */
export interface ReadingStats {
    /** Books with finishedAt in the current calendar year. */
    finishedThisYear: number;
    /** Sum of pages over those books (0 when pages are unknown). */
    finishedPagesThisYear: number;
    /** Consecutive active days back from today (union, see dayMap). */
    streak: number;
    /** Active days in the current calendar year. */
    daysThisYear: number;
    /** Books with 0 < progress < 100. */
    readingCount: number;
    /** Finished-book counts, last 6 calendar years, ascending. */
    finishedPerYear: Array<[year: number, count: number]>;
    /** Union activity map: reading days plus highlight-creation days. */
    dayMap: Map<string, number>;
}

/**
 * Derives the reading stats. `highlightDayCounts` comes from the
 * existing highlight stats (computeStats dayCounts): per the approved
 * design a day counts as a reading day when the user recorded
 * progress OR created highlights (PDF / markdown reading shows up as
 * highlights, not progress).
 */
export function computeReadingStats(
    metaMap: Record<string, BookMeta>,
    readingDays: Record<string, number>,
    highlightDayCounts: Map<string, number>,
    now: Date,
): ReadingStats {
    const thisYear = now.getFullYear();

    let finishedThisYear = 0;
    let finishedPagesThisYear = 0;
    let readingCount = 0;
    const finishedYears = new Map<number, number>();
    for (const meta of Object.values(metaMap)) {
        if (meta.finishedAt) {
            const year = new Date(meta.finishedAt).getFullYear();
            finishedYears.set(year, (finishedYears.get(year) ?? 0) + 1);
            if (year === thisYear) {
                finishedThisYear++;
                finishedPagesThisYear += meta.pages ?? 0;
            }
        }
        if (meta.progress !== undefined && meta.progress > 0 && meta.progress < 100) readingCount++;
    }

    const dayMap = new Map<string, number>(Object.entries(readingDays));
    for (const [key, count] of highlightDayCounts) {
        if (count <= 0) continue;
        dayMap.set(key, Math.max(dayMap.get(key) ?? 0, 1));
    }

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Streak: consecutive active days back from today (skip today if empty
    // yet), same convention as the highlight streak.
    let streak = 0;
    let cursor = startOfToday;
    if (!dayMap.has(dayKey(now))) cursor -= DAY_MS;
    while (dayMap.has(dayKey(new Date(cursor)))) {
        streak++;
        cursor -= DAY_MS;
    }

    const yearPrefix = `${thisYear}-`;
    let daysThisYear = 0;
    for (const key of dayMap.keys()) {
        if (key.startsWith(yearPrefix)) daysThisYear++;
    }

    const finishedPerYear: Array<[number, number]> = [];
    for (let year = thisYear - 5; year <= thisYear; year++) {
        finishedPerYear.push([year, finishedYears.get(year) ?? 0]);
    }

    return {
        finishedThisYear,
        finishedPagesThisYear,
        streak,
        daysThisYear,
        readingCount,
        finishedPerYear,
        dayMap,
    };
}
