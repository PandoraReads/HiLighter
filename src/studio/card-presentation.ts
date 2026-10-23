import type { HighlightNote } from '../models';
import { STATE_LEARNING, STATE_RELEARNING } from '../fsrs';

export type ReviewStatus = 'new' | 'due' | 'learning' | 'scheduled';

/** Keep gallery previews readable while retaining the first attachment for a thumbnail. */
export function extractNotePreview(markdown: string): { text: string; images: string[] } {
    const images = [
        ...[...markdown.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(match => match[1]!),
        ...[...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]!),
    ];
    const text = markdown
        .replace(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => alias || target)
        .replace(/(?:\*\*|__|~~|`|^\s{0,3}#{1,6}\s+)/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    return { text, images };
}

export function noteReviewStatus(note: HighlightNote, now: Date = new Date()): ReviewStatus {
    if (!note.fsrs) return 'new';
    if (note.fsrs.due <= now.getTime()) return 'due';
    if (note.fsrs.state === STATE_LEARNING || note.fsrs.state === STATE_RELEARNING) return 'learning';
    return 'scheduled';
}
