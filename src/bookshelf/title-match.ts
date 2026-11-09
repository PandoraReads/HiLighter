// ============================================================
// HiLighter - Bookshelf title search (pure)
// ============================================================
// Kept in its own module (no Obsidian runtime imports) so it stays
// unit-testable — importing library-page.ts would evaluate the
// Modal / FuzzySuggestModal class hierarchies.

/** Case-insensitive title match; an empty query matches everything. */
export function matchesBookTitle(query: string, ...titles: Array<string | undefined>): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return titles.some(title => !!title && title.toLowerCase().includes(needle));
}
