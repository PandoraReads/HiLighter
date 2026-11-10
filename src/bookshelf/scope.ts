// ============================================================
// HiLighter - Bookshelf folder scope matching (pure)
// ============================================================
// Decides which vault files the 书籍 (library) tab shows, given the
// user's include / exclude folder lists. No Obsidian imports so the
// logic stays unit-testable.
//
// Defense layers (a first open must never scan the whole vault):
// 1. An unset / all-invalid include list matches NOTHING.
// 2. Each include folder opts into recursion; legacy string entries
//    (pre-2.8.1 settings) keep recursive semantics so existing
//    setups do not silently change.
// 3. One scan can never return more than MAX_SHELF_SCAN_FILES.

import { normalizeVaultFolder } from '../vault-path';

/** File extensions collected by the shelf. */
export const SHELF_EXTENSIONS = ['md', 'pdf', 'epub'] as const;

export type ShelfKind = 'markdown' | 'pdf' | 'epub';

/**
 * Hard upper bound for one scan. A pathological scope (e.g. the vault
 * root of a 20k-file vault) is truncated to this and the library page
 * shows a warning instead of freezing the UI.
 */
export const MAX_SHELF_SCAN_FILES = 2000;

/** Minimal file shape so tests can pass plain objects. */
export interface ShelfFileLike {
	path: string;
	extension: string;
}

/**
 * One include-folder entry. `recursive: false` matches only files
 * directly inside the folder (a "books" folder usually means its own
 * level, not a nested magazine archive).
 */
export interface ShelfFolderRef {
	path: string;
	recursive: boolean;
}

/** Accepts legacy string entries and structured refs. */
export type IncludeFolderInput = string | ShelfFolderRef;

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

/**
 * True when a vault file path lives inside `folder` ('' = vault root).
 * Non-recursive mode matches direct children only; root without
 * recursion means files sitting at the vault root.
 */
export function underFolder(path: string, folder: string, recursive = true): boolean {
	const normalized = normalizeFolderInput(folder) ?? '';
	if (normalized === '') {
		return recursive ? true : !path.includes('/');
	}
	const prefix = normalized + '/';
	if (!path.startsWith(prefix)) return false;
	return recursive ? true : !path.slice(prefix.length).includes('/');
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
 * Normalizes the include list. Legacy plain-string entries keep their
 * historical recursive behavior; structured entries carry their own
 * flag. Duplicates (by path) keep the first entry.
 */
export function normalizeIncludeFolders(
	folders: IncludeFolderInput[] | undefined,
): ShelfFolderRef[] {
	if (!folders) return [];
	const seen = new Set<string>();
	const result: ShelfFolderRef[] = [];
	for (const entry of folders) {
		const rawPath = typeof entry === 'string' ? entry : entry?.path;
		// Whitespace-only strings are garbage, not the vault root: an
		// accidental '   ' entry must never widen the scan to everything.
		// Root stays expressible as the exact empty string.
		if (rawPath !== undefined && rawPath.trim() === '' && rawPath !== '') continue;
		const recursive = typeof entry === 'string' ? true : Boolean(entry?.recursive);
		const normalized = normalizeFolderInput(rawPath ?? '');
		if (normalized === null || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push({ path: normalized, recursive });
	}
	return result;
}

/**
 * True when a vault-change event for `path` can affect the 书籍 tab:
 * a shelf file (supported extension, not hidden) inside the include
 * scope and outside the excludes. Sync churn on everything else
 * (iCloud placeholders, unrelated notes) must not re-render the shelf.
 */
export function isShelfRelevantPath(
	path: string,
	includeFolders: IncludeFolderInput[] | undefined,
	excludeFolders: string[] | undefined,
): boolean {
	const dot = path.lastIndexOf('.');
	if (dot <= 0 || shelfKind(path.slice(dot + 1)) === null) return false;
	if (isHiddenPath(path)) return false;
	const include = normalizeIncludeFolders(includeFolders);
	if (include.length === 0) return false;
	if (!include.some(ref => underFolder(path, ref.path, ref.recursive))) return false;
	const exclude = normalizeFolderList(excludeFolders);
	return !exclude.some(folder => underFolder(path, folder));
}

/**
 * Returns the paths of `files` that fall inside the scan scope:
 * supported extension AND not hidden AND inside an include folder AND
 * not inside any exclude folder (excludes always prune whole
 * subtrees). An empty include list means the scope is unconfigured
 * and nothing matches. Results are capped at MAX_SHELF_SCAN_FILES.
 */
export function matchShelfFiles(
	files: ShelfFileLike[],
	includeFolders: IncludeFolderInput[] | undefined,
	excludeFolders: string[] | undefined,
): string[] {
	const include = normalizeIncludeFolders(includeFolders);
	if (include.length === 0) return [];
	const exclude = normalizeFolderList(excludeFolders);

	const matched = files
		.filter(file => shelfKind(file.extension) !== null)
		.filter(file => !isHiddenPath(file.path))
		.filter(file => include.some(ref => underFolder(file.path, ref.path, ref.recursive)))
		.filter(file => !exclude.some(folder => underFolder(file.path, folder)))
		.map(file => file.path)
		.sort((a, b) => a.localeCompare(b));

	// Sort BEFORE slicing so the surviving window is stable: vault
	// listing order shifts as files come and go (sync churn), and a
	// cap that keeps "whatever came first" would flap the shelf.
	return matched.length > MAX_SHELF_SCAN_FILES
		? matched.slice(0, MAX_SHELF_SCAN_FILES)
		: matched;
}
