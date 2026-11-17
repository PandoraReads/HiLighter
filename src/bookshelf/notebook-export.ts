// ============================================================
// HiLighter - Notebook markdown export
// ============================================================
// Saves one notebook (all highlights + notes of a source) or a
// single highlight as a Markdown file in the vault, into the same
// folder the card studio exports to (settings.groupExportFolder).

import { Notice, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';
import type { HighlightNote } from '../models';
import { normalizeVaultFolder } from '../vault-path';

/** Creates the export folder chain if missing; validates the path. */
async function ensureExportFolder(app: App, folderSetting: string): Promise<string> {
	const folder = normalizeVaultFolder(folderSetting);
	if (folder) {
		let current = '';
		for (const segment of folder.split('/')) {
			current = current ? `${current}/${segment}` : segment;
			const existing = app.vault.getAbstractFileByPath(current);
			if (!existing) await app.vault.createFolder(current);
			else if (!(existing instanceof TFolder)) {
				throw new Error(`A file already exists at ${current}`);
			}
		}
	}
	return folder;
}

/** Finds a non-conflicting `<folder>/<name>.md` path in the vault. */
function uniqueNotePath(app: App, folder: string, baseName: string): string {
	const safe = baseName.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Notebook';
	const parent = folder ? `${folder}/` : '';
	let path = normalizePath(`${parent}${safe}.md`);
	let suffix = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		path = normalizePath(`${parent}${safe} (${suffix}).md`);
		suffix += 1;
	}
	return path;
}

/** Display title of a highlight: its title, or the leading words. */
function excerptTitle(note: HighlightNote): string {
	const raw = (note.title || note.text || '').replace(/\s+/g, ' ').trim();
	return raw.slice(0, 56).trim();
}

/** Quote block form of the highlighted text. */
function quoteBlock(text: string): string {
	return text.split(/\r?\n/).map(line => `> ${line}`).join('\n');
}

/**
 * Exports a whole notebook as Markdown. Mirrors the studio's group
 * export format: header metadata, then one section per highlight
 * with the quoted original text and the note beneath.
 */
export async function exportNotebookAsMarkdown(
	app: App,
	folderSetting: string,
	title: string,
	sourcePath: string,
	notes: HighlightNote[],
): Promise<void> {
	try {
		const folder = await ensureExportFolder(app, folderSetting);
		const date = new Date().toISOString().slice(0, 10);
		const baseName = `${date} ${title || sourcePath}`;
		const path = uniqueNotePath(app, folder, baseName);

		const sections = notes.map((note, index) => {
			const created = new Date(note.createdAt).toISOString().slice(0, 10);
			const heading = excerptTitle(note) || `${t('bookshelf.notebook.entryLabel')} ${index + 1}`;
			// Quote first, the note follows directly beneath it — no
			// per-entry note heading (quote styling already separates
			// the two). Entries without a note keep just the quote.
			const lines = [
				`## ${index + 1}. ${heading}`,
				'',
				`- ${t('manager.group.export.created')}: ${created}`,
				'',
				quoteBlock(note.text) || '> ',
			];
			if (note.note.trim()) lines.push('', note.note.trim());
			return lines.join('\n');
		});

		const content = [
			`# ${title || sourcePath}`,
			'',
			`- ${t('manager.group.export.source')}: [[${sourcePath.replace(/\|/g, '\\|')}]]`,
			`- ${t('manager.group.export.savedAt')}: ${new Date().toISOString().slice(0, 10)}`,
			`- ${t('bookshelf.notebook.export.count', { count: notes.length })}`,
			'',
			sections.join('\n\n---\n\n'),
			'',
		].join('\n');

		await app.vault.create(path, content);
		new Notice(t('bookshelf.notebook.export.saved', { path }));
	} catch (err) {
		console.error('[HiLighter] notebook export failed:', sourcePath, err);
		new Notice(t('bookshelf.notebook.export.failed'));
	}
}

/**
 * Exports a single highlight (original text + note) as Markdown,
 * matching the notebook export's per-entry format.
 */
export async function exportNotebookEntryAsMarkdown(
	app: App,
	folderSetting: string,
	note: HighlightNote,
): Promise<void> {
	try {
		const folder = await ensureExportFolder(app, folderSetting);
		const date = new Date(note.createdAt).toISOString().slice(0, 10);
		const baseName = `${date} ${excerptTitle(note) || 'Highlight'}`;
		const path = uniqueNotePath(app, folder, baseName);

		const source = note.sourcePath
			? `- ${t('manager.group.export.source')}: [[${note.sourcePath.replace(/\|/g, '\\|')}]]`
			: '';
		const lines: string[] = [
			`# ${excerptTitle(note) || t('bookshelf.notebook.entryLabel')}`,
			'',
			`- ${t('manager.group.export.created')}: ${date}`,
		];
		if (source) lines.push(source);
		lines.push('', quoteBlock(note.text) || '> ');
		// The note follows the quote directly — no "笔记" heading.
		if (note.note.trim()) lines.push('', note.note.trim());
		lines.push('');
		const content = lines.join('\n');

		await app.vault.create(path, content);
		new Notice(t('bookshelf.notebook.exportSingle.saved', { path }));
	} catch (err) {
		console.error('[HiLighter] notebook entry export failed:', note.id, err);
		new Notice(t('bookshelf.notebook.export.failed'));
	}
}
