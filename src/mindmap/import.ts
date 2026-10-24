// ============================================================
// HiLighter - Mind map file import (.xmind)
// ============================================================
// Reuses simple-mind-map's own parser, which understands both the
// modern content.json format (Xmind Zen/2020+) and the legacy
// content.xml format (Xmind 8), including notes, hyperlinks and
// summaries. Multi-sheet workbooks load their first sheet.

import { Notice, TFile, type App } from 'obsidian';
import xmindParse from 'simple-mind-map/src/parse/xmind';
import { db } from '../db';
import type { MindMapDoc } from '../models';
import { t } from '../i18n';
import { ensureUids, type MindMapNode } from './build';
import { randomUUID } from '../mocks/crypto';

/** Loads a .xmind vault file into a new mind map document and opens it. */
export async function importXmindFile(app: App, file: TFile): Promise<MindMapDoc | null> {
    try {
        const buffer = await app.vault.readBinary(file);
        // Multi-sheet workbooks resolve to the first sheet by default.
        const content = await xmindParse.parseXmindFile(buffer);
        const tree = (Array.isArray(content) ? content[0] : content) as MindMapNode | null;
        if (!tree || !tree.data) {
            throw new Error('empty xmind content');
        }
        ensureUids(tree);

        const doc: MindMapDoc = {
            id: randomUUID(),
            title: file.basename,
            sourcePath: file.path,
            tree,
            buildMode: 'flat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await db.putMindMap(doc);
        new Notice(t('mindmap.notice.xmindImported', { file: file.basename }));
        return doc;
    } catch (e) {
        console.error('[HiLighter] xmind import failed', e);
        new Notice(t('mindmap.notice.xmindImportFailed'));
        return null;
    }
}
