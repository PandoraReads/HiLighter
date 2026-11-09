// ============================================================
// HiLighter - Bookshelf book tags (pure)
// ============================================================
// Shelf tags live in plugin settings (path -> tags) because EPUB /
// PDF files cannot carry vault metadata. Pure functions here so the
// mutations stay immutable and unit-testable.

export type BookTagMap = Record<string, string[]>;

function normalizeTag(tag: string): string {
	return tag.trim();
}

/** Adds or removes a tag on several books; returns a new map (or the
 *  original when nothing changed). */
export function setTagOnBooks(
	tags: BookTagMap,
	paths: string[],
	tag: string,
	add: boolean,
): BookTagMap {
	const clean = normalizeTag(tag);
	if (!clean) return tags;
	let changed = false;
	const next: BookTagMap = { ...tags };
	for (const path of paths) {
		const current = next[path] ?? [];
		if (add) {
			if (current.includes(clean)) continue;
			next[path] = [...current, clean];
			changed = true;
		} else {
			if (!current.includes(clean)) continue;
			const remaining = current.filter(item => item !== clean);
			if (remaining.length === 0) delete next[path];
			else next[path] = remaining;
			changed = true;
		}
	}
	return changed ? next : tags;
}

/** Drops every entry for the given paths (after file deletion). */
export function removeTagPaths(tags: BookTagMap, paths: string[]): BookTagMap {
	const removed = new Set(paths);
	const next: BookTagMap = {};
	for (const [path, list] of Object.entries(tags)) {
		if (!removed.has(path)) next[path] = list;
	}
	return next;
}

/** All distinct tags with the number of books carrying each. */
export function collectBookTags(tags: BookTagMap): Array<{ tag: string; count: number }> {
	const counts = new Map<string, number>();
	for (const list of Object.values(tags)) {
		for (const tag of list) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => a.tag.localeCompare(b.tag));
}

/** True when every path carries the tag (false for empty paths). */
export function tagOnAllBooks(tags: BookTagMap, paths: string[], tag: string): boolean {
	if (paths.length === 0) return false;
	return paths.every(path => (tags[path] ?? []).includes(tag));
}
