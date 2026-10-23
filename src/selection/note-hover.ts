import { Component, MarkdownRenderer } from 'obsidian';
import type HiLighterPlugin from '../main';
import { db } from '../db';

/** Show a saved note when its in-document anchor is hovered. */
export function registerNoteHover(plugin: HiLighterPlugin): void {
    const setupWindow = (win: Window) => {
        const doc = win.document;
        let activeMark: HTMLElement | null = null;
        let tooltip: HTMLElement | null = null;
        let tooltipComponent: Component | null = null;
        let request = 0;

        const hide = () => {
            request += 1;
            activeMark = null;
            tooltip?.remove();
            tooltip = null;
            tooltipComponent?.unload();
            tooltipComponent = null;
        };

        plugin.registerDomEvent(doc, 'mouseover', (event: MouseEvent) => {
            const target = event.target;
            if (!target || (target as Node).nodeType !== 1) return;
            const mark = (target as Element).closest<HTMLElement>('mark.hl-note-anchor[data-id]');
            if (!mark || mark === activeMark) return;
            hide();
            activeMark = mark;
            const id = mark.dataset.id;
            if (!id) return;
            const currentRequest = request;

            void db.getHighlightNote(id).then(note => {
                if (!note?.note || activeMark !== mark || request !== currentRequest) return;
                const pop = doc.body.createDiv('hl-anchor-tooltip is-pending');
                pop.setAttribute('role', 'tooltip');
                pop.createDiv({ cls: 'hl-anchor-tooltip-word', text: note.text || mark.textContent || '' });
                const body = pop.createDiv('hl-anchor-tooltip-note');
                tooltip = pop;
                const component = new Component();
                component.load();
                tooltipComponent = component;
                void MarkdownRenderer.render(plugin.app, note.note, body, note.sourcePath, component)
                    .catch(() => { body.setText(note.note); })
                    .then(() => {
                        if (tooltip !== pop) return;
                        const markRect = mark.getBoundingClientRect();
                        const popRect = pop.getBoundingClientRect();
                        const viewport = doc.documentElement;
                        pop.style.left = `${Math.max(8, Math.min(markRect.left, viewport.clientWidth - popRect.width - 8))}px`;
                        pop.style.top = `${markRect.bottom + popRect.height + 8 <= viewport.clientHeight
                            ? markRect.bottom + 6
                            : Math.max(8, markRect.top - popRect.height - 6)}px`;
                        pop.removeClass('is-pending');
                    });
            }).catch(() => {
                if (request === currentRequest) hide();
            });
        });

        plugin.registerDomEvent(doc, 'mouseout', (event: MouseEvent) => {
            if (!activeMark) return;
            if (activeMark.contains(event.relatedTarget as Node | null)) return;
            if (activeMark.contains(event.target as Node | null)) hide();
        });
        plugin.register(hide);
    };

    setupWindow(window);
    plugin.registerEvent(plugin.app.workspace.on('window-open', (win) => setupWindow(win as unknown as Window)));
}
