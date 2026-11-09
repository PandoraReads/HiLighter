// ============================================================
// HiLighter - Bookshelf folder scope matching (pure)
// ============================================================
// Decides which vault files the 书籍 (library) tab shows, given the
// user's include / exclude folder lists. No Obsidian imports so the
// logic stays unit-testable.

import { normalizeVaultFolder } from '../vault-path';

/** File extensions collected by the shelf. */
export const SHELF_EXTENSIONS = ['md', 'pdf', 'epub'] as const;

export type ShelfKind = 'markdown' | 'pdf' | 'epub';

/** Minimal file shape so tests can pass plain objects. */
export interface ShelfFileLike {
	path: string;
	extension: string;
}

/** Maps a file extension to a shelf kind; null when not collectable. */
export function shelfKind(extension: string): ShelfKind | null {
	const ext = (extension || '').toLowerCase();
	if (ext === 'md' || ext === 'markdown') return 'markdown';
	if (ext === 'pdf') return 'pdf';
	if (ext === 'epub') return 'epub';
	return null;
}

/** True when any path segment is dot-prefixed (.obsidian, .trash, ...). */
export function isHiddenPath(path: string): boolean {
	return path.split('/').some(segment => segment.startsWith('.'));
}

/** True when a vault file path lives inside `folder` ('' = vault root). */
export function underFolder(path: string, folder: string): boolean {
	const normalized = normalizeFolderInput(folder) ?? '';
	if (normalized === '') return true;
	return path.startsWith(normalized + '/');
}

/** Normalizes a user-entered folder; null when invalid. Root = ''. */
export function normalizeFolderInput(folder: string): string | null {
	const trimmed = (folder || '').trim();
	// Both '' and '/' mean the vault root; normalizeVaultFolder rejects
	// leading slashes, so map root before delegating.
	if (trimmed === '' || trimmed === '/') return '';
	try {
		return normalizeVaultFolder(trimmed);
	} catch {
		return null;
	}
}

/** Deduplicated, normalized folder list (invalid entries dropped). */
export function normalizeFolderList(folders: string[] | undefined): string[] {
	if (!folders) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const folder of folders) {
		const normalized = normalizeFolderInput(folder);
		if (normalized === null || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

/**
 * Returns the paths of `files` that fall inside the scan scope:
 * supported extension AND not hidden AND inside an include folder AND
 * not inside any exclude folder. An empty include list means the
 * scope is unconfigured and nothing matches.
 */
export function matchShelfFiles(
	files: ShelfFileLike[],
	includeFolders: string[] | undefined,
	excludeFolders: string[] | undefined,
): string[] {
	const include = normalizeFolderList(includeFolders);
	if (include.length === 0) return [];
	const exclude = normalizeFolderList(excludeFolders);

	return files
		.filter(file => shelfKind(file.extension) !== null)
		.filter(file => !isHiddenPath(file.path))
		.filter(file => include.some(folder => underFolder(file.path, folder)))
		.filter(file => !exclude.some(folder => underFolder(file.path, folder)))
		.map(file => file.path);
}
