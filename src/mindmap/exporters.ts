// ============================================================
// HiLighter - Mind map exporters
// ============================================================
// PNG and .xmind downloads are handled by the engine's Export
// plugins. This module covers the two formats we generate
// ourselves: an Obsidian .canvas file (JSON Canvas spec) and a
// Markdown outline saved into the vault.

import { Notice, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';
import type { MindMapNode } from './build';
import type { MindMapEngine } from './engine';

interface CanvasNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'text';
    text: string;
}

interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide: 'left' | 'right' | 'top' | 'bottom';
    toSide: 'left' | 'right' | 'top' | 'bottom';
}

interface CanvasFile {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

/** Collects parent→child uid pairs from the tree. */
function collectEdges(node: MindMapNode, out: Array<[string, string]>): void {
    const from = node.data.uid;
    for (const child of node.children ?? []) {
        if (from && child.data.uid && !child.data.isFreeNode) out.push([from, child.data.uid]);
        collectEdges(child, out);
    }
}

/**
 * Exports the current map as an Obsidian .canvas file. Layout positions
 * come from the engine's rendered node rects; nodes that are collapsed
 * fall back to a stacked column so nothing is lost.
 */
export async function exportCanvasFile(
    app: App,
    engine: MindMapEngine,
    docTitle: string,
    tree: MindMapNode,
): Promise<string> {
    const rects = engine.getRenderedNodeRects();
    const canvas: CanvasFile = { nodes: [], edges: [] };
    const idByUid = new Map<string, string>();

    let fallbackY = 0;
    const walk = (node: MindMapNode, depth: number) => {
        const uid = node.data.uid;
        if (!uid) return;
        const id = `node-${idByUid.size + 1}`;
        idByUid.set(uid, id);
        const rect = rects.get(uid);
        if (rect) {
            canvas.nodes.push({
                id,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                type: 'text',
                text: node.data.text || ' ',
            });
        } else {
            const height = 60;
            canvas.nodes.push({
                id,
                x: depth * 260,
                y: fallbackY,
                width: 220,
                height,
                type: 'text',
                text: node.data.text || ' ',
            });
            fallbackY += height + 40;
        }
        for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(tree, 0);

    const edges: Array<[string, string]> = [];
    collectEdges(tree, edges);
    canvas.edges = edges
        .map(([fromUid, toUid], index) => ({
            id: `edge-${index + 1}`,
            fromNode: idByUid.get(fromUid)!,
            toNode: idByUid.get(toUid)!,
            fromSide: 'right' as const,
            toSide: 'left' as const,
        }))
        .filter(e => e.fromNode && e.toNode);

    const path = await createVaultFile(app, `${sanitize(docTitle)}.canvas`, JSON.stringify(canvas, null, 2));
    new Notice(t('mindmap.notice.exported', { path }));
    return path;
}

/** Exports the map as a Markdown outline (headings mirror the hierarchy). */
export async function exportMarkdownFile(
    app: App,
    docTitle: string,
    tree: MindMapNode,
): Promise<string> {
    const lines: string[] = [`# ${docTitle}`, ''];
    const walk = (node: MindMapNode, depth: number) => {
        for (const child of node.children ?? []) {
            const text = (child.data.text || '').replace(/\n/g, ' ');
            if (depth === 0) {
                lines.push(`## ${text}`, '');
            } else {
                lines.push(`${'  '.repeat(depth - 1)}- ${text}`);
            }
            if (child.children && child.children.length > 0) walk(child, depth + 1);
            if (depth === 0) lines.push('');
        }
    };
    walk(tree, 0);

    const path = await createVaultFile(app, `${sanitize(docTitle)}.md`, lines.join('\n'));
    new Notice(t('mindmap.notice.exported', { path }));
    return path;
}

/** Finds a free path in `HiLighter/MindMaps/` (or the root) and writes the file. */
async function createVaultFile(app: App, fileName: string, content: string): Promise<string> {
    const folder = 'HiLighter/MindMaps';
    if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
        try {
            await app.vault.createFolder(folder);
        } catch {
            // Already exists (or vault forbids) — create in root instead.
        }
    }
    const base = fileName.replace(/\.[^.]+$/, '');
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : 'md';
    let path = normalizePath(`${folder}/${base}.${ext}`);
    let counter = 1;
    while (app.vault.getAbstractFileByPath(path)) {
        path = normalizePath(`${folder}/${base} ${counter}.${ext}`);
        counter++;
    }
    await app.vault.create(path, content);
    return path;
}

function sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|#^[\]]/g, '_').trim() || 'mindmap';
}
