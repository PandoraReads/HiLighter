// ============================================================
// HiLighter - Studio FSRS flashcard review view
// ============================================================
// Magazine-styled flashcards: front = highlight text, flip
// (space/click) → back = note + source, then rate Again/Hard/Good/Easy
// (keys 1-4). Learning cards re-enter the queue within the session.
// Keyboard input arrives ONLY through the studio-view window
// keydown dispatch (single handler, no per-render leak).

import { setIcon, MarkdownRenderer } from 'obsidian';
import { t } from '../../i18n';
import { nextDueAt } from '../../fsrs';
import { addTagToNote, jumpToSource } from '../actions';
import { rateCurrent, exitSession, skipCurrent, startFsrsSession } from './session';
import type { HighlightManagerView } from '../studio-view';

export function renderReview(view: HighlightManagerView, parent: HTMLElement): void {
    parent.removeClass('is-gallery-mode');
    parent.empty();
    const s = view.reviewSession;

    // Exit button (always available, even on the summary screen)
    const exitBtn = parent.createDiv('hl-review-exit-btn');
    setIcon(exitBtn, 'x');
    exitBtn.setAttribute('aria-label', t('manager.review.exit'));
    exitBtn.onclick = () => exitSession(view);

    if (s.queue.length === 0) {
        renderSummary(view, parent);
        return;
    }

    const note = s.queue[0]!;
    const done = s.total - s.queue.length;

    const wrapper = parent.createDiv('hl-review-spread-wrapper');

    // ── Spread: left page = quote (front), right page = note (back) ──
    const spread = wrapper.createDiv('hl-review-spread');
    spread.addClass(s.flipped ? 'is-flipped-card' : 'is-front-card');

    const leftPage = spread.createDiv('hl-review-page page-left');
    const quoteBox = leftPage.createDiv('hl-review-quote');
    quoteBox.createSpan({ text: '“', cls: 'quote-mark open' });
    quoteBox.createDiv({ text: note.text, cls: 'quote-text' });

    const meta = leftPage.createDiv('hl-review-meta');
    const filename = note.sourcePath.split('/').pop()?.replace('.md', '') || 'Notes';
    meta.createDiv({ text: filename, cls: 'meta-source' });
    meta.createDiv({ text: new Date(note.createdAt).toLocaleDateString(), cls: 'meta-date' });

    const rightPage = spread.createDiv('hl-review-page page-right');
    const notesHeader = rightPage.createDiv('hl-review-notes-header');
    notesHeader.createEl('h3', { text: 'REFLECTION' });

    const notesBody = rightPage.createDiv('hl-review-notes-body');
    if (!s.flipped) {
        notesBody.createDiv({ text: t('fsrs.flipHint'), cls: 'note-placeholder' });
    } else if (note.note) {
        void MarkdownRenderer.render(view.app, note.note, notesBody, note.sourcePath, view)
            .catch(() => { /* keep the page rendered even if markdown fails */ });
    } else {
        notesBody.createDiv({ text: t('manager.review.notePlaceholder'), cls: 'note-placeholder' });
    }

    // ── Right-side bookmarks ──
    const bookmarkContainer = wrapper.createDiv('hl-review-bookmarks');

    const skipBtn = bookmarkContainer.createDiv('hl-review-bookmark tab-encounter');
    skipBtn.createSpan({ text: t('fsrs.skip') });
    skipBtn.onclick = (e) => {
        e.stopPropagation();
        skipCurrent(view);
    };

    const priorityBtn = bookmarkContainer.createDiv('hl-review-bookmark tab-priority');
    priorityBtn.createSpan({ text: t('tag.key') });
    priorityBtn.onclick = (e) => {
        e.stopPropagation();
        void addTagToNote(view, note, t('tag.key'));
    };

    const archiveBtn = bookmarkContainer.createDiv('hl-review-bookmark tab-archive');
    archiveBtn.createSpan({ text: t('tag.archive') });
    archiveBtn.onclick = (e) => {
        e.stopPropagation();
        void addTagToNote(view, note, t('tag.archive'));
    };

    // ── Flip interaction ──
    spread.onclick = (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.hl-review-actions, .hl-review-bookmark, a')) return;
        flip(view, spread);
    };

    // ── Rating row (only meaningful on the back) ──
    const actions = wrapper.createDiv(`hl-review-actions ${s.flipped ? 'is-visible' : ''}`);
    const grades: Array<{ g: 1 | 2 | 3 | 4; label: string; key: string; cls: string }> = [
        { g: 1, label: t('fsrs.rate.again'), key: '1', cls: 'rate-again' },
        { g: 2, label: t('fsrs.rate.hard'), key: '2', cls: 'rate-hard' },
        { g: 3, label: t('fsrs.rate.good'), key: '3', cls: 'rate-good' },
        { g: 4, label: t('fsrs.rate.easy'), key: '4', cls: 'rate-easy' },
    ];
    grades.forEach(({ g, label, key, cls }) => {
        const btn = actions.createEl('button', {
            cls: `hl-review-rate-btn ${cls}`,
            attr: { 'aria-label': `${label} (${key})` },
        });
        btn.createSpan({ text: label, cls: 'hl-rate-label' });
        btn.createSpan({ text: key, cls: 'hl-rate-key' });
        btn.onclick = (e) => {
            e.stopPropagation();
            if (!view.reviewSession.flipped) {
                flip(view, spread);
                return;
            }
            void rateCurrent(view, g);
        };
    });

    // ── Bottom strip: progress + per-card FSRS chip ──
    const nav = parent.createDiv('hl-review-nav-strip');
    nav.createDiv({ cls: 'hl-review-counter', text: `${done + 1} / ${s.total}` });

    const chip = nav.createDiv('hl-review-fsrs-chip');
    setIcon(chip.createSpan({ cls: 'hl-fsrs-chip-icon' }), 'graduation-cap');
    if (note.fsrs) {
        chip.createSpan({
            text: t('fsrs.chip', { reps: note.fsrs.reps, due: new Date(note.fsrs.due).toLocaleDateString() }),
        });
    } else {
        chip.createSpan({ text: t('fsrs.chipNew') });
    }

    const jumpBtn = nav.createDiv('hl-review-nav-arrow hl-review-jump');
    setIcon(jumpBtn, 'external-link');
    jumpBtn.setAttribute('aria-label', t('fsrs.jumpSource'));
    jumpBtn.onclick = (e) => {
        e.stopPropagation();
        void jumpToSource(view.app, note);
    };
}

function flip(view: HighlightManagerView, spread: HTMLElement): void {
    const s = view.reviewSession;
    if (!s.active || s.queue.length === 0) return;
    spread.addClass('is-flipping');
    setTimeout(() => {
        s.flipped = !s.flipped;
        view.render();
    }, 150);
}

/** Session-end summary: counts, next due time, follow-up actions. */
function renderSummary(view: HighlightManagerView, parent: HTMLElement): void {
    const s = view.reviewSession;
    const container = parent.createDiv('hl-review-summary');
    container.createEl('h2', { text: t('fsrs.summary.title'), cls: 'hl-review-summary-title' });

    const tiles = container.createDiv('hl-insights-tiles');
    const addTile = (label: string, value: string) => {
        const tile = tiles.createDiv('hl-stat-tile');
        tile.createDiv({ text: value, cls: 'hl-stat-value' });
        tile.createDiv({ text: label, cls: 'hl-stat-label' });
    };
    addTile(t('fsrs.summary.reviewed'), String(s.stats.reviewed));
    addTile(t('fsrs.rate.again'), String(s.stats.again));
    addTile(t('fsrs.rate.good'), String(s.stats.good));

    const next = nextDueAt(view.highlights);
    container.createDiv({
        cls: 'hl-review-summary-next',
        text: next != null
            ? t('fsrs.summary.nextDue', { time: new Date(next).toLocaleString() })
            : t('fsrs.summary.noDue'),
    });

    const actions = container.createDiv('hl-review-summary-actions');
    const doneBtn = actions.createEl('button', {
        cls: 'hl-glass-btn-confirm',
        text: t('fsrs.summary.done'),
    });
    doneBtn.onclick = () => exitSession(view);

    const moreBtn = actions.createEl('button', {
        cls: 'hl-glass-btn-cancel',
        text: t('fsrs.summary.moreNew'),
    });
    moreBtn.onclick = () => {
        void (async () => {
            await view.loadHighlights();
            startFsrsSession(view, 'new');
        })();
    };
}

/** Keyboard handler — invoked only from the studio-view keydown dispatch. */
export function handleReviewKey(view: HighlightManagerView, e: KeyboardEvent): void {
    const s = view.reviewSession;
    if (!s.active) return;

    if (e.key === 'Escape') {
        exitSession(view);
        return;
    }
    if (s.queue.length === 0) return;   // summary screen: Esc only

    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const spread = view.contentEl.querySelector<HTMLElement>('.hl-review-spread');
        if (spread) flip(view, spread);
        return;
    }
    if (['1', '2', '3', '4'].includes(e.key)) {
        const grade = Number(e.key);
        if (grade < 1 || grade > 4) return;
        if (!s.flipped) {
            const spread = view.contentEl.querySelector<HTMLElement>('.hl-review-spread');
            if (spread) flip(view, spread);
            return;
        }
        void rateCurrent(view, grade as 1 | 2 | 3 | 4);
    }
}
