// ============================================================
// HiLighter - Reusable inline tag editor
// ============================================================
// Used by the anchored note popup and HighlightDetailModal so users
// can add/remove #tags and pick frequent vault tags with one click.

import { db } from '../db';
import { t } from '../i18n';
import type { HighlightNote } from '../models';

export interface TagEditorOptions {
    container: HTMLElement;
    initialTags?: string[];
    /** Preloaded quick-select tags; omitted loads top tags from db. */
    suggestions?: string[];
    /** Maximum quick-select pills to display (default 12). */
    maxSuggestions?: number;
    /** Tighter spacing for compact popovers such as the note popup. */
    compact?: boolean;
    onChange?: (tags: string[]) => void;
}

export interface TagEditorHandle {
    getTags(): string[];
    setTags(tags: string[]): void;
}

/** Strips leading '#' characters and outer whitespace from a tag string. */
export function normalizeHighlightTag(raw: string): string {
    return raw.trim().replace(/^#+/, '').trim();
}

/** Deduplicates and normalizes a tag list, preserving first-seen order. */
export function normalizeTagList(rawTags: readonly string[] | undefined): string[] {
    if (!rawTags || rawTags.length === 0) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of rawTags) {
        const clean = normalizeHighlightTag(raw);
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        result.push(clean);
    }
    return result;
}

/** Collects the most frequent highlight tags across the vault. */
export function collectVaultTagSuggestions(notes: readonly HighlightNote[], limit = 12): string[] {
    const counts = new Map<string, number>();
    for (const note of notes) {
        if (!note.tags || note.tags.length === 0) continue;
        for (const raw of note.tags) {
            const clean = normalizeHighlightTag(raw);
            if (!clean) continue;
            counts.set(clean, (counts.get(clean) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([tag]) => tag);
}

/** Mounts a lightweight tag editor (chips + input + quick-select pills). */
export function createTagEditor(opts: TagEditorOptions): TagEditorHandle {
    const maxSuggestions = opts.maxSuggestions ?? 12;
    let tags = normalizeTagList(opts.initialTags);
    let suggestions = normalizeTagList(opts.suggestions).slice(0, maxSuggestions);

    const root = opts.container.createDiv('hl-tag-editor');
    if (opts.compact) root.addClass('is-compact');

    const chipsEl = root.createDiv('hl-tag-editor-chips');
    const inputRow = root.createDiv('hl-tag-editor-input-row');
    const inputEl = inputRow.createEl('input', {
        type: 'text',
        cls: 'hl-tag-editor-input',
        attr: {
            placeholder: t('tagEditor.placeholder'),
            'aria-label': t('tagEditor.placeholder'),
        },
    });
    const suggestionsEl = root.createDiv('hl-tag-editor-suggestions');

    const emitChange = () => {
        opts.onChange?.([...tags]);
    };

    const renderChips = () => {
        chipsEl.empty();
        chipsEl.toggleClass('is-hidden', tags.length === 0);
        for (const tag of tags) {
            const chip = chipsEl.createSpan({ cls: 'hl-tag-editor-chip' });
            chip.createSpan({ cls: 'hl-tag-editor-chip-label', text: `#${tag}` });
            const removeBtn = chip.createEl('button', {
                type: 'button',
                cls: 'hl-tag-editor-chip-remove',
                text: '×',
                attr: { 'aria-label': t('tagEditor.remove', { tag }) },
            });
            removeBtn.onclick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                tags = tags.filter(item => item !== tag);
                render();
                emitChange();
            };
        }
    };

    const renderSuggestions = () => {
        suggestionsEl.empty();
        const available = suggestions.filter(tag => !tags.includes(tag));
        suggestionsEl.toggleClass('is-hidden', available.length === 0);
        for (const tag of available) {
            const pill = suggestionsEl.createEl('button', {
                type: 'button',
                cls: 'hl-tag-editor-pill',
                text: `#${tag}`,
            });
            pill.onclick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                addTag(tag);
            };
        }
    };

    const render = () => {
        renderChips();
        renderSuggestions();
    };

    const addTag = (raw: string): boolean => {
        const clean = normalizeHighlightTag(raw);
        if (!clean || tags.includes(clean)) return false;
        tags = [...tags, clean];
        render();
        emitChange();
        return true;
    };

    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (addTag(inputEl.value)) {
                inputEl.value = '';
            } else {
                inputEl.value = '';
            }
        }
    });

    render();

    if (!opts.suggestions) {
        void db.getAllHighlights().then(notes => {
            if (!root.isConnected) return;
            suggestions = collectVaultTagSuggestions(notes, maxSuggestions);
            renderSuggestions();
        }).catch((err: unknown) => {
            console.warn('[HiLighter] Failed to load tag suggestions', err);
        });
    }

    return {
        getTags: () => [...tags],
        setTags: (nextTags: string[]) => {
            tags = normalizeTagList(nextTags);
            render();
        },
    };
}
