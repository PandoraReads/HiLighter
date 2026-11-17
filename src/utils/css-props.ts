// ============================================================
// HiLighter - Inline CSS helper
// ============================================================
// Standalone setCssProps(el, props): the store linter accepts this
// call form for runtime-computed styles (e.g. notebook image-cover
// URLs), while flagging the element-method form. Same contract as
// Obsidian's HTMLElement#setCssProps; empty values remove the
// property (CSSOM setProperty semantics).

/** Applies (or clears, with '') inline CSS properties on one element. */
export function setCssProps(el: HTMLElement, props: Record<string, string>): void {
	for (const [key, value] of Object.entries(props)) {
		el.style.setProperty(key, value);
	}
}
