// ============================================================
// HiLighter - Shared markdown preview renderer
// ============================================================
// Renders note markdown with Obsidian's own renderer so cards and
// modals show the same output as the reading view (wikilinks, bold,
// code blocks, embedded images...).

import { Component, MarkdownRenderer, type App } from 'obsidian';

/**
 * Renders markdown into a container with compact preview styling.
 * Callers must pass a live Component (view/leaf); for contexts
 * without one, use DetachedComponent.
 */
export async function renderMarkdownPreview(
    app: App,
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    component: Component,
): Promise<void> {
    container.empty();
    container.addClass('hl-md-preview', 'markdown-rendered');
    await MarkdownRenderer.render(app, markdown, container, sourcePath, component);
}

/** A throwaway lifecycle owner for modals and other non-Component hosts. */
export class DetachedComponent extends Component {}
