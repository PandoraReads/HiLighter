// ============================================================
// HiLighter - Whiteboard exporters
// ============================================================
// Exports a WhiteboardDoc to Obsidian's JSON Canvas (.canvas)
// format or a structured Markdown (.md) document in the vault.

import { Notice, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { cardPreviewMarkdown, cardRelationLabel, cardTitle } from '../card-templates';
import { getLang, t } from '../i18n';
import type { HighlightNote, WhiteboardDoc, WhiteboardNode, WhiteboardSection } from '../models';
import { DEFAULT_NODE_HEIGHT } from './board-math';

interface CanvasGroupNode {
    id: string;
    type: 'group';
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    color?: string;
}

interface CanvasTextNode {
    id: string;
    type: 'text';
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    color?: string;
}

type CanvasNode = CanvasGroupNode | CanvasTextNode;

interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: 'top' | 'right' | 'bottom' | 'left';
    toSide?: 'top' | 'right' | 'bottom' | 'left';
    toEnd?: 'arrow';
    label?: string;
}

interface CanvasFile {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

const CANVAS_COLOR_MAP: Readonly<Record<string, string>> = {
    pink: '1',
    red: '1',
    orange: '2',
    yellow: '3',
    green: '4',
    blue: '5',
    cyan: '5',
    purple: '6',
};

function toCanvasColor(color?: string, colorHex?: string): string | undefined {
    const candidate = (color ?? '').trim().toLowerCase();
    if (candidate && candidate in CANVAS_COLOR_MAP) {
        return CANVAS_COLOR_MAP[candidate];
    }
    if (candidate.startsWith('#') && /^#[0-9a-f]{6}$/i.test(candidate)) {
        return candidate;
    }
    if (colorHex && /^#[0-9a-f]{6}$/i.test(colorHex.trim())) {
        return colorHex.trim();
    }
    return undefined;
}

function formatTags(tags?: readonly string[]): string {
    if (!tags || tags.length === 0) return '';
    return tags
        .map(tag => tag.trim())
        .filter(Boolean)
        .map(tag => (tag.startsWith('#') ? tag : `#${tag}`))
        .join(' ');
}

function formatSourceLink(sourcePath?: string): string {
    const trimmed = sourcePath?.trim();
    if (!trimmed) return '';
    const linkTarget = trimmed.replace(/\.md$/i, '');
    return `[[${linkTarget}]]`;
}

function formatCardNodeText(card: HighlightNote | undefined, fallbackId?: string): string {
    if (!card) {
        return `[Missing card: ${fallbackId ?? 'unknown'}]`;
    }
    const parts: string[] = [];
    const title = cardTitle(card);
    if (title) {
        parts.push(`### ${title}`);
    }
    const quote = card.text.trim();
    if (quote && quote !== title) {
        parts.push(`> ${quote.replace(/\n+/g, '\n> ')}`);
    } else if (quote && !title) {
        parts.push(`> ${quote.replace(/\n+/g, '\n> ')}`);
    }
    const preview = cardPreviewMarkdown(card);
    if (preview) {
        parts.push(preview);
    }
    const meta: string[] = [];
    const source = formatSourceLink(card.sourcePath);
    if (source) meta.push(source);
    const tags = formatTags(card.tags);
    if (tags) meta.push(tags);
    if (meta.length > 0) {
        parts.push(meta.join('  '));
    }
    return parts.join('\n\n') || ' ';
}

function formatNodeCanvasText(
    node: WhiteboardNode,
    cardsById: ReadonlyMap<string, HighlightNote>,
): string {
    if (node.type === 'card') {
        const card = node.highlightId ? cardsById.get(node.highlightId) : undefined;
        return formatCardNodeText(card, node.highlightId ?? node.id);
    }
    if (node.type === 'subboard') {
        const label = node.text?.trim() || node.subboardId || 'Subboard';
        return `[[${label}]]`;
    }
    return node.text?.trim() || ' ';
}

/**
 * Exports a whiteboard to Obsidian's JSON `.canvas` format and saves it
 * as a non-conflicting file in the vault.
 */
export async function exportWhiteboardToCanvasFile(
    app: App,
    doc: WhiteboardDoc,
    cardsById: ReadonlyMap<string, HighlightNote>,
): Promise<void> {
    const nodes: CanvasNode[] = [];
    const idByNodeId = new Map<string, string>();

    for (let i = 0; i < doc.sections.length; i++) {
        const section = doc.sections[i];
        if (!section) continue;
        const groupNode: CanvasGroupNode = {
            id: `section-${i + 1}`,
            type: 'group',
            x: Math.round(section.x),
            y: Math.round(section.y),
            width: Math.max(120, Math.round(section.width)),
            height: Math.max(80, Math.round(section.height)),
        };
        if (section.title.trim()) {
            groupNode.label = section.title.trim();
        }
        const groupColor = toCanvasColor(section.color);
        if (groupColor) {
            groupNode.color = groupColor;
        }
        nodes.push(groupNode);
    }

    for (let i = 0; i < doc.nodes.length; i++) {
        const node = doc.nodes[i];
        if (!node) continue;
        const canvasId = `node-${i + 1}`;
        idByNodeId.set(node.id, canvasId);
        const card = node.type === 'card' && node.highlightId
            ? cardsById.get(node.highlightId)
            : undefined;
        const nodeColor = toCanvasColor(node.color ?? card?.color, card?.colorHex);
        const textNode: CanvasTextNode = {
            id: canvasId,
            type: 'text',
            x: Math.round(node.x),
            y: Math.round(node.y),
            width: Math.max(120, Math.round(node.width)),
            height: Math.max(60, Math.round(node.height ?? DEFAULT_NODE_HEIGHT)),
            text: formatNodeCanvasText(node, cardsById),
        };
        if (nodeColor) {
            textNode.color = nodeColor;
        }
        nodes.push(textNode);
    }

    const edges: CanvasEdge[] = [];
    for (let i = 0; i < doc.edges.length; i++) {
        const edge = doc.edges[i];
        if (!edge) continue;
        const fromNode = idByNodeId.get(edge.fromNodeId);
        const toNode = idByNodeId.get(edge.toNodeId);
        if (!fromNode || !toNode) continue;

        const canvasEdge: CanvasEdge = {
            id: `edge-${edges.length + 1}`,
            fromNode,
            toNode,
            toEnd: 'arrow',
        };
        if (edge.fromSide) canvasEdge.fromSide = edge.fromSide;
        if (edge.toSide) canvasEdge.toSide = edge.toSide;
        const label = edge.label?.trim()
            || (edge.relation?.trim() ? cardRelationLabel(edge.relation.trim()) : '');
        if (label) {
            canvasEdge.label = label;
        }
        edges.push(canvasEdge);
    }

    const canvas: CanvasFile = { nodes, edges };
    const path = await createVaultFile(
        app,
        `${sanitize(doc.title)}.canvas`,
        JSON.stringify(canvas, null, 2),
    );
    new Notice(t('mindmap.notice.exported', { path }));
}

function compareSpatial(
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    return a.y - b.y || a.x - b.x;
}

function renderNodeMarkdown(
    node: WhiteboardNode,
    cardsById: ReadonlyMap<string, HighlightNote>,
    zh: boolean,
): string[] {
    if (node.type === 'card') {
        const card = node.highlightId ? cardsById.get(node.highlightId) : undefined;
        if (!card) {
            return [`- [${zh ? '缺失卡片' : 'Missing card'}: \`${node.highlightId ?? node.id}\`]`];
        }
        const lines: string[] = [];
        const title = cardTitle(card) || (zh ? '无标题卡片' : 'Untitled card');
        lines.push(`### ${title}`);
        const quote = card.text.trim();
        if (quote) {
            lines.push('', `> ${quote.replace(/\n+/g, '\n> ')}`);
        }
        const preview = cardPreviewMarkdown(card);
        if (preview) {
            lines.push('', preview);
        }
        const meta: string[] = [];
        const source = formatSourceLink(card.sourcePath);
        if (source) {
            meta.push(`${zh ? '来源' : 'Source'}: ${source}`);
        }
        const tags = formatTags(card.tags);
        if (tags) {
            meta.push(`${zh ? '标签' : 'Tags'}: ${tags}`);
        }
        if (meta.length > 0) {
            lines.push('', meta.join(' | '));
        }
        return lines;
    }

    if (node.type === 'subboard') {
        const label = node.text?.trim() || node.subboardId || (zh ? '子白板' : 'Subboard');
        return [`- ${zh ? '子白板' : 'Subboard'}: [[${label}]]`];
    }

    const noteText = node.text?.trim();
    return noteText ? [noteText] : [];
}

function nodeLabelForEdge(
    node: WhiteboardNode | undefined,
    cardsById: ReadonlyMap<string, HighlightNote>,
): string {
    if (!node) return '';
    if (node.type === 'card') {
        const card = node.highlightId ? cardsById.get(node.highlightId) : undefined;
        return card ? cardTitle(card) || node.id : (node.highlightId ?? node.id);
    }
    return node.text?.trim().split('\n')[0] || node.subboardId || node.id;
}

/**
 * Exports a whiteboard to a structured Markdown file grouped by sections
 * (ordered top-to-bottom, left-to-right), followed by ungrouped nodes in
 * spatial reading order.
 */
export async function exportWhiteboardToMarkdown(
    app: App,
    doc: WhiteboardDoc,
    cardsById: ReadonlyMap<string, HighlightNote>,
): Promise<void> {
    const zh = getLang() === 'zh';
    const lines: string[] = [`# ${doc.title || (zh ? '白板' : 'Whiteboard')}`, ''];

    const orderedSections: WhiteboardSection[] = [...doc.sections].sort(compareSpatial);
    const sectionIds = new Set(orderedSections.map(section => section.id));
    const nodesBySection = new Map<string, WhiteboardNode[]>();
    const ungroupedNodes: WhiteboardNode[] = [];

    for (const node of doc.nodes) {
        if (node.sectionId && sectionIds.has(node.sectionId)) {
            const list = nodesBySection.get(node.sectionId) ?? [];
            list.push(node);
            nodesBySection.set(node.sectionId, list);
        } else {
            ungroupedNodes.push(node);
        }
    }

    for (const section of orderedSections) {
        const heading = section.title.trim() || (zh ? '未命名分区' : 'Untitled section');
        lines.push(`## ${heading}`, '');
        const sectionNodes = [...(nodesBySection.get(section.id) ?? [])].sort(compareSpatial);
        if (sectionNodes.length === 0) {
            lines.push(`_${zh ? '（空分区）' : '(Empty section)'}_`, '');
            continue;
        }
        for (const node of sectionNodes) {
            const block = renderNodeMarkdown(node, cardsById, zh);
            if (block.length > 0) {
                lines.push(...block, '');
            }
        }
    }

    if (ungroupedNodes.length > 0) {
        const sortedUngrouped = [...ungroupedNodes].sort(compareSpatial);
        if (orderedSections.length > 0) {
            lines.push(`## ${zh ? '未分组节点' : 'Ungrouped'}`, '');
        }
        for (const node of sortedUngrouped) {
            const block = renderNodeMarkdown(node, cardsById, zh);
            if (block.length > 0) {
                lines.push(...block, '');
            }
        }
    }

    if (doc.edges.length > 0) {
        const nodeById = new Map(doc.nodes.map(node => [node.id, node]));
        const edgeLines: string[] = [];
        for (const edge of doc.edges) {
            const fromLabel = nodeLabelForEdge(nodeById.get(edge.fromNodeId), cardsById);
            const toLabel = nodeLabelForEdge(nodeById.get(edge.toNodeId), cardsById);
            if (!fromLabel || !toLabel) continue;
            const rel = edge.label?.trim()
                || (edge.relation?.trim() ? cardRelationLabel(edge.relation.trim()) : '');
            edgeLines.push(rel ? `- ${fromLabel} — *${rel}* → ${toLabel}` : `- ${fromLabel} → ${toLabel}`);
        }
        if (edgeLines.length > 0) {
            lines.push(`## ${zh ? '连线关系' : 'Connections'}`, '', ...edgeLines, '');
        }
    }

    const path = await createVaultFile(
        app,
        `${sanitize(doc.title)}.md`,
        lines.join('\n').trimEnd() + '\n',
    );
    new Notice(t('mindmap.notice.exported', { path }));
}

async function createVaultFile(app: App, fileName: string, content: string): Promise<string> {
    const folder = 'HiLighter/Whiteboards';
    if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
        try {
            await app.vault.createFolder(folder);
        } catch {
            // Already exists or vault forbids — fall back to root if needed.
        }
    }
    const targetFolder = app.vault.getAbstractFileByPath(folder) instanceof TFolder ? folder : '';
    const prefix = targetFolder ? `${targetFolder}/` : '';
    const base = fileName.replace(/\.[^.]+$/, '');
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : 'md';
    let path = normalizePath(`${prefix}${base}.${ext}`);
    let counter = 1;
    while (app.vault.getAbstractFileByPath(path)) {
        path = normalizePath(`${prefix}${base} ${counter}.${ext}`);
        counter++;
    }
    await app.vault.create(path, content);
    return path;
}

function sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|#^[\]]/g, '_').trim() || 'whiteboard';
}
