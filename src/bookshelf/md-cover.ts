// ============================================================
// HiLighter - Markdown cover resolution (pure)
// ============================================================
// Picks an image from a note's frontmatter properties. The value may
// be a network URL or an Obsidian link in any common spelling
// (![[cover.jpg]], [[cover.jpg|alt]], ![](cover.jpg), bare path).
// Pure string logic here; vault link resolution lives in covers.ts.

/** Frontmatter keys checked for a cover image, in priority order. */
export const MD_COVER_FIELDS = ['cover', 'image', 'banner', 'featured', 'thumbnail'] as const;

/**
 * Returns the first non-empty string cover value from frontmatter
 * (case-insensitive keys; YAML list values use their first string
 * entry). Null when no usable field exists.
 */
export function pickMarkdownCover(
	frontmatter: Record<string, unknown> | undefined | null,
): string | null {
	if (!frontmatter) return null;
	const lowered = new Map<string, unknown>();
	for (const [key, value] of Object.entries(frontmatter)) {
		lowered.set(key.toLowerCase(), value);
	}
	for (const field of MD_COVER_FIELDS) {
		const value = lowered.get(field);
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (Array.isArray(value)) {
			const first = value.find((entry): entry is string => typeof entry === 'string' && !!entry.trim());
			if (first) return first.trim();
		}
	}
	return null;
}

/** Strips embed / wikilink / markdown-link syntax, leaving the target. */
export function stripMarkdownLink(value: string): string {
	const wikilink = value.match(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
	if (wikilink) return wikilink[1]!.trim();
	const mdLink = value.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
	if (mdLink) return mdLink[1]!.trim();
	return value.trim();
}

/** True for http(s) URLs usable as an <img src> directly. */
export function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}
