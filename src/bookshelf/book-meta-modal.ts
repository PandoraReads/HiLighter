// ============================================================
// HiLighter - Book metadata editor modal (书籍信息)
// ============================================================
// View / edit one book's BookMeta: title, author, publication date,
// pages, rating (0.5 steps) and reading progress with the finished
// date (backfillable for books read before the feature existed).
// Saving routes through the pure helpers in book-meta.ts so the
// startedAt / finishedAt lifecycle and the reading-day log stay
// consistent with the automatic EPUB progress writes.

import { App, Modal, Notice, setIcon, TFile } from 'obsidian';
import { t } from '../i18n';
import type { BookMeta } from '../models';
import {
    bumpReadingDay,
    epochToDayInput,
    isValidPublishDate,
    normalizeBookMetaMap,
    normalizeReadingDays,
    parseDayInput,
} from './book-meta';
import { dayKey } from '../studio/grouping';
import { withBookMetaDeletion } from '../sync/shelf-collections';
import { ConfirmModal } from '../ui/confirm-modal';
import type HiLighterPlugin from '../main';

/** Editable form state (strings for inputs, numbers for widgets). */
interface MetaDraft {
    title: string;
    author: string;
    publishDate: string;
    pages: string;
    rating: number;        // 0 = unrated
    trackProgress: boolean;
    progress: number;      // 0-100
    finishedAt: string;    // 'YYYY-MM-DD' or ''
}

function draftFrom(meta: BookMeta | undefined): MetaDraft {
    return {
        title: meta?.title ?? '',
        author: meta?.author ?? '',
        publishDate: meta?.publishDate ?? '',
        pages: meta?.pages !== undefined ? String(meta.pages) : '',
        rating: meta?.rating ?? 0,
        trackProgress: meta?.progress !== undefined,
        progress: meta?.progress ?? 0,
        finishedAt: meta?.finishedAt !== undefined ? epochToDayInput(meta.finishedAt) : '',
    };
}

export class BookMetaModal extends Modal {
    private readonly plugin: HiLighterPlugin;
    private readonly file: TFile;
    private readonly onChange: () => void;
    private draft: MetaDraft;
    private errorEl: HTMLElement | null = null;
    private progressValueEl: HTMLElement | null = null;
    private ratingFillEl: HTMLElement | null = null;
    private ratingEl: HTMLElement | null = null;
    private progressInputEl: HTMLInputElement | null = null;
    private progressToggleEl: HTMLInputElement | null = null;
    private finishedInputEl: HTMLInputElement | null = null;

    constructor(app: App, plugin: HiLighterPlugin, file: TFile, onChange: () => void) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.onChange = onChange;
        this.draft = draftFrom(
            normalizeBookMetaMap(plugin.settings.bookshelfBookMeta)[file.path],
        );
    }

    onOpen(): void {
        this.renderContent();
    }

    private renderContent(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hl-book-meta-modal');

        contentEl.createEl('h2', { text: t('bookshelf.meta.title'), cls: 'hl-scope-title' });

        // File header: name + path (the metadata key).
        const header = contentEl.createDiv('hl-meta-header');
        const nameCol = header.createDiv('hl-meta-header-main');
        nameCol.createDiv({ cls: 'hl-meta-header-name', text: this.file.basename });
        nameCol.createDiv({ cls: 'hl-meta-header-path', text: this.file.path });

        const body = contentEl.createDiv('hl-meta-body');

        this.addTextField(body, 'bookshelf.meta.field.title', this.draft.title, 'text', value => {
            this.draft = { ...this.draft, title: value };
        });
        this.addTextField(body, 'bookshelf.meta.field.author', this.draft.author, 'text', value => {
            this.draft = { ...this.draft, author: value };
        });
        this.addTextField(
            body,
            'bookshelf.meta.field.publishDate',
            this.draft.publishDate,
            'text',
            value => { this.draft = { ...this.draft, publishDate: value }; },
            t('bookshelf.meta.publishPlaceholder'),
        );
        this.addTextField(body, 'bookshelf.meta.field.pages', this.draft.pages, 'number', value => {
            this.draft = { ...this.draft, pages: value };
        });

        this.renderRating(body);
        this.renderProgress(body);
        this.finishedInputEl = this.addTextField(
            body,
            'bookshelf.meta.field.finishedAt',
            this.draft.finishedAt,
            'text',
            value => { this.draft = { ...this.draft, finishedAt: value }; },
            t('bookshelf.meta.datePlaceholder'),
        );

        this.errorEl = body.createDiv('hl-meta-error');

        // Footer: clear (danger) on the left, actions on the right.
        const footer = contentEl.createDiv('hl-meta-footer');
        const clearBtn = footer.createEl('button', {
           	cls: 'hl-meta-footer-btn is-danger',
           	text: t('bookshelf.meta.clear'),
        });
        clearBtn.onclick = () => this.clearMeta();

        const actions = footer.createDiv('hl-meta-footer-actions');
        const finishedBtn = actions.createEl('button', {
            cls: 'hl-meta-footer-btn',
            text: t('bookshelf.meta.markFinished'),
        });
        finishedBtn.onclick = () => this.markFinished();
        const saveBtn = actions.createEl('button', {
            cls: 'hl-meta-footer-btn is-primary',
            text: t('bookshelf.meta.save'),
        });
        saveBtn.onclick = () => this.save();
    }

    /** One label + input row; the draft updates live (immutable copy). */
    private addTextField(
        parent: HTMLElement,
        labelKey: string,
        value: string,
        type: 'text' | 'number',
        onInput: (value: string) => void,
        placeholder?: string,
    ): HTMLInputElement {
        const row = parent.createDiv('hl-meta-row');
        row.createDiv({ cls: 'hl-meta-label', text: t(labelKey) });
        const input = row.createEl('input', {
            cls: 'hl-meta-input',
            attr: {
                type,
                value,
                ...(placeholder ? { placeholder } : {}),
                'aria-label': t(labelKey),
            },
        });
        input.addEventListener('input', () => onInput(input.value));
        return input;
    }

    /** Rating: five stars, click position snaps to 0.5 steps (0-5). */
    private renderRating(parent: HTMLElement): void {
        const row = parent.createDiv('hl-meta-row');
        row.createDiv({ cls: 'hl-meta-label', text: t('bookshelf.meta.field.rating') });

        const wrap = row.createDiv('hl-meta-rating-wrap');
        const rating = wrap.createDiv('hl-meta-rating');
        rating.setAttribute('role', 'slider');
        rating.setAttribute('aria-valuemin', '0');
        rating.setAttribute('aria-valuemax', '5');
        rating.setAttribute('tabindex', '0');
        rating.setAttribute('aria-label', t('bookshelf.meta.field.rating'));
        const base = rating.createDiv('hl-meta-rating-row');
        const fill = rating.createDiv('hl-meta-rating-row is-fill');
        for (let i = 0; i < 5; i++) {
            setIcon(base.createSpan({ cls: 'hl-meta-star' }), 'star');
            setIcon(fill.createSpan({ cls: 'hl-meta-star' }), 'star');
        }
        this.ratingEl = rating;
        this.ratingFillEl = fill;

        const applyRating = (value: number): void => {
            const next = Math.max(0, Math.min(5, value));
            this.draft = { ...this.draft, rating: next };
            this.paintRating();
        };
        rating.onclick = (event) => {
            const rect = rating.getBoundingClientRect();
            if (rect.width === 0) return;
            // Click position -> halves -> 0.5 steps.
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            applyRating(Math.round(ratio * 10) / 2);
        };
        rating.onkeydown = (event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault();
                applyRating(this.draft.rating - 0.5);
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault();
                applyRating(this.draft.rating + 0.5);
            }
        };

        const clear = wrap.createEl('button', {
            cls: 'hl-meta-rating-clear',
            attr: { 'aria-label': t('bookshelf.meta.ratingClear'), title: t('bookshelf.meta.ratingClear') },
        });
        setIcon(clear, 'x');
        clear.onclick = () => applyRating(0);

        this.paintRating();
    }

    private paintRating(): void {
        if (this.ratingFillEl) {
            this.ratingFillEl.setCssProps({ width: `${(this.draft.rating / 5) * 100}%` });
        }
        this.ratingEl?.setAttribute('aria-valuenow', String(this.draft.rating));
    }

    /** Progress: tracking toggle + slider (0-100) with live value. */
    private renderProgress(parent: HTMLElement): void {
        const row = parent.createDiv('hl-meta-row');
        row.createDiv({ cls: 'hl-meta-label', text: t('bookshelf.meta.field.progress') });

        const wrap = row.createDiv('hl-meta-progress-wrap');
        const toggleWrap = wrap.createDiv('hl-meta-progress-toggle-wrap');
        const trackToggle = toggleWrap.createEl('input', {
            cls: 'hl-meta-progress-toggle',
            attr: {
                type: 'checkbox',
                'aria-label': t('bookshelf.meta.trackProgress'),
                ...(this.draft.trackProgress ? { checked: '' } : {}),
            },
        });
        const toggleLabel = toggleWrap.createEl('label', {
            cls: 'hl-meta-progress-toggle-label',
            text: t('bookshelf.meta.trackProgress'),
        });
        toggleLabel.setAttribute('for', 'hl-meta-progress-toggle');
        trackToggle.id = 'hl-meta-progress-toggle';
        this.progressToggleEl = trackToggle;

        const slider = wrap.createEl('input', {
            cls: 'hl-meta-progress-slider',
            attr: {
                type: 'range',
                min: '0',
                max: '100',
                step: '1',
                value: String(this.draft.progress),
                'aria-label': t('bookshelf.meta.field.progress'),
            },
        });
        this.progressInputEl = slider;
        const valueEl = wrap.createSpan({ cls: 'hl-meta-progress-value', text: `${this.draft.progress}%` });
        this.progressValueEl = valueEl;

        const paintEnabled = (): void => {
            slider.toggleAttribute('disabled', !this.draft.trackProgress);
            valueEl.toggleClass('is-muted', !this.draft.trackProgress);
        };
        trackToggle.addEventListener('change', () => {
            this.draft = { ...this.draft, trackProgress: trackToggle.checked };
            paintEnabled();
        });
        slider.addEventListener('input', () => {
            const progress = Number(slider.value);
            // Dragging the slider implies intent to track; flip the
            // toggle on automatically (it defaults off for fresh books).
            if (!this.draft.trackProgress && progress > 0) {
                this.draft = { ...this.draft, trackProgress: true };
                trackToggle.checked = true;
                paintEnabled();
            }
            this.draft = { ...this.draft, progress };
            if (this.progressValueEl) this.progressValueEl.setText(`${progress}%`);
        });
        paintEnabled();
    }

    /** Quick action: 100% + finished today (editable afterwards). */
    private markFinished(): void {
        this.draft = {
            ...this.draft,
            trackProgress: true,
            progress: 100,
            finishedAt: this.draft.finishedAt || epochToDayInput(Date.now()),
        };
        if (this.progressToggleEl) this.progressToggleEl.checked = true;
        if (this.progressInputEl) {
            this.progressInputEl.value = '100';
            this.progressInputEl.removeAttribute('disabled');
        }
        if (this.progressValueEl) {
            this.progressValueEl.setText('100%');
            this.progressValueEl.removeClass('is-muted');
        }
        if (this.finishedInputEl) this.finishedInputEl.value = this.draft.finishedAt;
    }

    /** Validates the draft; returns an error message or null. */
    private validate(): string | null {
        const { publishDate, pages, finishedAt } = this.draft;
        if (publishDate.trim() !== '' && !isValidPublishDate(publishDate.trim())) {
            return t('bookshelf.meta.badPublishDate');
        }
        if (pages.trim() !== '' && (!/^\d+$/.test(pages.trim()) || Number(pages.trim()) <= 0)) {
            return t('bookshelf.meta.badPages');
        }
        if (finishedAt.trim() !== '' && parseDayInput(finishedAt) === null) {
            return t('bookshelf.meta.badFinishedDate');
        }
        return null;
    }

    private showError(message: string): void {
        if (this.errorEl) this.errorEl.setText(message);
    }

    private save(): void {
        const error = this.validate();
        if (error) {
            this.showError(error);
            return;
        }

        const settings = this.plugin.settings;
        const map = normalizeBookMetaMap(settings.bookshelfBookMeta);
        const prev = map[this.file.path];
        const now = Date.now();
        const { draft } = this;

        const meta: BookMeta = { updatedAt: now };
        if (draft.title.trim()) meta.title = draft.title.trim();
        if (draft.author.trim()) meta.author = draft.author.trim();
        if (draft.publishDate.trim()) meta.publishDate = draft.publishDate.trim();
        if (draft.pages.trim()) meta.pages = Number(draft.pages.trim());
        if (draft.rating > 0) meta.rating = draft.rating;

        if (draft.trackProgress) {
            meta.progress = Math.max(0, Math.min(100, Math.round(draft.progress)));
            if (meta.progress > 0) meta.startedAt = prev?.startedAt ?? now;
        } else if (prev?.startedAt) {
            meta.startedAt = prev.startedAt;
        }

        if (draft.finishedAt.trim() !== '') {
            meta.finishedAt = parseDayInput(draft.finishedAt) ?? now;
        } else if (draft.trackProgress && draft.progress >= 100 && !prev?.finishedAt) {
            meta.finishedAt = now;
        }

        settings.bookshelfBookMeta = { ...map, [this.file.path]: meta };

        // Manual progress edits count as reading activity too (PDF /
        // markdown books rely on this path entirely).
        if (draft.trackProgress && draft.progress > 0 && (prev?.progress ?? null) !== draft.progress) {
            const bump = bumpReadingDay(
                normalizeReadingDays(settings.bookshelfReadingDays),
                dayKey(new Date(now)),
                this.file.path,
                this.plugin.readingDayCounted,
            );
            this.plugin.readingDayCounted = bump.counted;
            settings.bookshelfReadingDays = bump.days;
        }

        void this.plugin.saveSettings();
        new Notice(t('bookshelf.meta.saved'));
        this.onChange();
        this.close();
    }

    /** Removes the whole BookMeta entry (the book file is untouched). */
    private clearMeta(): void {
        const settings = this.plugin.settings;
        const map = normalizeBookMetaMap(settings.bookshelfBookMeta);
        if (!map[this.file.path]) {
            this.close();
            return;
        }
        new ConfirmModal(
            this.app,
            t('bookshelf.meta.clearConfirm', { name: this.file.basename }),
            () => {
                const { [this.file.path]: _removed, ...rest } = map;
                settings.bookshelfBookMeta = rest;
                settings.bookMetaTombstones = withBookMetaDeletion(
                    settings.bookMetaTombstones,
                    this.file.path,
                    Date.now(),
                );
                void this.plugin.saveSettings();
                new Notice(t('bookshelf.meta.cleared'));
                this.onChange();
                this.close();
            },
            { warning: true, confirmText: t('bookshelf.meta.clear') },
        ).open();
    }
}
