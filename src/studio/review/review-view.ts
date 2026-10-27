// One-card FSRS review: recall first, reveal the note, then rate.
import { setIcon, MarkdownRenderer, TFile } from 'obsidian';
import { getLang, t } from '../../i18n';
import { dueCount, newCount, nextDueAt, scheduleNote, type Grade } from '../../fsrs';
import { addTagToNote, jumpToSource } from '../actions';
import { rateCurrent, exitSession, skipCurrent, startFsrsSession } from './session';
import type { HighlightManagerView } from '../studio-view';
import { extractNotePreview } from '../card-presentation';
import { cardPreviewMarkdown, cardTitle } from '../../card-templates';

function intervalLabel(due: number, now: number): string {
    const minutes = Math.max(1, Math.round((due - now) / 60000));
    if (minutes < 60) return getLang() === 'zh' ? `${minutes} 分钟` : `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return getLang() === 'zh' ? `${hours} 小时` : `${hours} hr`;
    const days = Math.round(hours / 24);
    return getLang() === 'zh' ? `${days} 天` : `${days} days`;
}

export function renderReview(view: HighlightManagerView, parent: HTMLElement): void {
    parent.removeClass('is-gallery-mode');
    parent.empty();
    const session = view.reviewSession;
    const shell = parent.createDiv('hl-flash-shell');
    const top = shell.createDiv('hl-flash-topbar');
    top.createSpan({ cls: 'hl-flash-eyebrow', text: session.mode === 'new' ? t('fsrs.review.new') : t('fsrs.review.today') });
    const exit = top.createEl('button', { cls: 'hl-flash-exit', attr: { 'aria-label': t('manager.review.exit') } });
    setIcon(exit, 'x');
    exit.onclick = () => exitSession(view);

    if (session.queue.length === 0) { renderSummary(view, shell); return; }
    const note = session.queue[0]!;
    const completed = Math.min(session.total, Math.max(0, session.total - session.queue.length));
    const heading = shell.createDiv('hl-flash-heading');
    heading.createEl('h2', { text: session.mode === 'new' ? t('fsrs.review.new') : t('fsrs.review.today') });
    heading.createDiv({ cls: 'hl-flash-subtitle', text: t('fsrs.review.instruction') });
    const deckCounts = shell.createDiv('hl-flash-deck-counts');
    deckCounts.createSpan({ text: t('fsrs.stats.dueToday') });
    deckCounts.createEl('strong', { text: String(dueCount(view.highlights)) });
    deckCounts.createSpan({ text: t('fsrs.review.newCount') });
    deckCounts.createEl('strong', { text: String(newCount(view.highlights)) });
    const progress = shell.createDiv('hl-flash-progress');
    progress.createSpan({ text: `${completed + 1} / ${session.total}`, cls: 'hl-flash-progress-count' });
    const track = progress.createDiv('hl-flash-progress-track');
    track.createDiv('hl-flash-progress-fill').style.width = `${session.total ? (completed / session.total) * 100 : 0}%`;

    const card = shell.createDiv(`hl-flash-card ${session.flipped ? 'is-back' : 'is-front'}`);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', session.flipped ? t('fsrs.review.back') : t('fsrs.review.front'));
    const cardTop = card.createDiv('hl-flash-card-top');
    cardTop.createSpan({ text: session.flipped ? t('fsrs.review.back') : t('fsrs.review.front') });
    cardTop.createSpan({ text: note.fsrs ? t('fsrs.chip', { reps: note.fsrs.reps, due: new Date(note.fsrs.due).toLocaleDateString() }) : t('fsrs.chipNew') });
    const main = card.createDiv('hl-flash-card-main');
    main.createDiv({ cls: 'hl-flash-prompt', text: session.flipped ? t('manager.card.myNote') : t('fsrs.review.prompt') });
    if (session.flipped) {
        const answer = main.createDiv('hl-flash-answer');
        const answerText = cardPreviewMarkdown(note);
        if (answerText) {
            void MarkdownRenderer.render(view.app, answerText, answer, note.sourcePath, view)
                .catch(() => { answer.textContent = answerText; });
        } else {
            answer.createDiv({ text: t('manager.review.notePlaceholder'), cls: 'hl-flash-empty-answer' });
        }
    } else {
        main.createDiv({ cls: 'hl-flash-quote', text: cardTitle(note) });
        const imageTarget = extractNotePreview(note.note || '').images[0];
        if (imageTarget) {
            const imageFile = view.app.metadataCache.getFirstLinkpathDest(imageTarget, note.sourcePath);
            if (imageFile instanceof TFile) {
                const image = main.createEl('img', {
                    cls: 'hl-flash-front-image',
                    attr: { src: view.app.vault.getResourcePath(imageFile), alt: '' },
                });
                image.loading = 'lazy';
            }
        }
    }
    const source = note.sourcePath.split('/').pop()?.replace(/\.md$/, '') || note.sourcePath;
    const foot = card.createDiv('hl-flash-card-foot');
    foot.createSpan({ text: source });
    foot.createSpan({ text: session.flipped ? t('fsrs.review.rateHint') : t('fsrs.review.flipHint') });
    card.onclick = (event) => {
        if ((event.target as HTMLElement).closest('a, button, input')) return;
        flip(view);
    };
    card.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            flip(view);
        }
    };

    const controls = shell.createDiv('hl-flash-controls');
    const skip = controls.createEl('button', { cls: 'hl-flash-text-btn', text: t('fsrs.skip') });
    skip.onclick = () => skipCurrent(view);
    if (!session.flipped) {
        const reveal = controls.createEl('button', { cls: 'hl-flash-primary-btn', text: t('fsrs.review.showAnswer') });
        reveal.onclick = () => flip(view);
    } else {
        const ratings = controls.createDiv('hl-flash-ratings');
        const now = new Date();
        const grades: Array<{ grade: Grade; key: string; className: string }> = [
            { grade: 1, key: 'again', className: 'is-again' },
            { grade: 2, key: 'hard', className: 'is-hard' },
            { grade: 3, key: 'good', className: 'is-good' },
            { grade: 4, key: 'easy', className: 'is-easy' },
        ];
        grades.forEach(({ grade, key, className }) => {
            const next = scheduleNote(note, grade, view.plugin.settings.fsrs, now);
            const button = ratings.createEl('button', { cls: `hl-flash-rating ${className}` });
            button.createSpan({ text: t(`fsrs.rate.${key}`), cls: 'hl-flash-rating-name' });
            button.createSpan({ text: intervalLabel(next.due, now.getTime()), cls: 'hl-flash-rating-interval' });
            button.createSpan({ text: String(grade), cls: 'hl-flash-rating-key' });
            button.onclick = () => { void rateCurrent(view, grade); };
        });
    }
    const auxiliary = shell.createDiv('hl-flash-auxiliary');
    const jump = auxiliary.createEl('button');
    setIcon(jump.createSpan(), 'external-link');
    jump.createSpan({ text: t('fsrs.jumpSource') });
    jump.onclick = () => { void jumpToSource(view.app, note); };
    if (note.kind === 'idea') jump.hide();
    const priority = auxiliary.createEl('button', { text: t('tag.key') });
    priority.onclick = () => { void addTagToNote(view, note, t('tag.key')); };
    const archive = auxiliary.createEl('button', { text: t('tag.archive') });
    archive.onclick = () => { void addTagToNote(view, note, t('tag.archive')); };
}

function flip(view: HighlightManagerView): void {
    if (!view.reviewSession.active || view.reviewSession.queue.length === 0) return;
    view.reviewSession.flipped = !view.reviewSession.flipped;
    view.render();
}

function renderSummary(view: HighlightManagerView, parent: HTMLElement): void {
    const session = view.reviewSession;
    const summary = parent.createDiv('hl-review-summary');
    summary.createEl('h2', { text: t('fsrs.summary.title'), cls: 'hl-review-summary-title' });
    const tiles = summary.createDiv('hl-insights-tiles');
    const addTile = (label: string, value: number) => {
        const tile = tiles.createDiv('hl-stat-tile');
        tile.createDiv({ text: String(value), cls: 'hl-stat-value' });
        tile.createDiv({ text: label, cls: 'hl-stat-label' });
    };
    addTile(t('fsrs.summary.reviewed'), session.stats.reviewed);
    addTile(t('fsrs.rate.again'), session.stats.again);
    addTile(t('fsrs.rate.hard'), session.stats.hard);
    addTile(t('fsrs.rate.good'), session.stats.good);
    addTile(t('fsrs.rate.easy'), session.stats.easy);
    const next = nextDueAt(view.highlights);
    summary.createDiv({
        cls: 'hl-review-summary-next',
        text: next != null ? t('fsrs.summary.nextDue', { time: new Date(next).toLocaleString() }) : t('fsrs.summary.noDue'),
    });
    const actions = summary.createDiv('hl-review-summary-actions');
    const done = actions.createEl('button', { cls: 'hl-flash-primary-btn', text: t('fsrs.summary.done') });
    done.onclick = () => exitSession(view);
    const more = actions.createEl('button', { cls: 'hl-flash-text-btn', text: t('fsrs.summary.moreNew') });
    more.onclick = () => {
        void (async () => { await view.loadHighlights(); startFsrsSession(view, 'new'); })();
    };
}

export function handleReviewKey(view: HighlightManagerView, event: KeyboardEvent): void {
    const session = view.reviewSession;
    if (!session.active) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Escape') { exitSession(view); return; }
    if (session.queue.length === 0) return;
    if (event.key === ' ' || event.key === 'Enter') {
        if (target?.closest('button, .hl-flash-card')) return;
        event.preventDefault();
        flip(view);
        return;
    }
    if (session.flipped && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        void rateCurrent(view, Number(event.key) as Grade);
    }
}
