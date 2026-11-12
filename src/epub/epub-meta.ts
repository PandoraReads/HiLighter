// ============================================================
// HiLighter - EPUB metadata parsing (pure)
// ============================================================
// Extracts title / author / cover reference from an EPUB's
// container.xml + OPF package document. The DOMParser is injected so
// tests can run with linkedom; the runtime passes the browser global.

export interface EpubOpfMeta {
	title?: string;
	author?: string;
	/** Manifest href of the cover image, relative to the OPF file. */
	coverHref?: string;
	/** Media type of the cover image (image/jpeg, ...). */
	coverType?: string;
}

export type XmlParser = { parseFromString: (source: string, mimeType: string) => XMLDocument };

const XML_MIME = 'application/xml';

interface ParseFn {
	(source: string, mimeType: string): XMLDocument;
}

function parserFn(parser: XmlParser): ParseFn {
	return parser.parseFromString;
}

/**
 * Local element name with any namespace prefix stripped. Works across
 * the browser DOM (localName = 'title'), linkedom's HTML-mode tree
 * (localName = 'dc:title') and plain nodeName fallbacks.
 */
function localName(element: Element): string {
	const raw = element.localName || element.nodeName || '';
	const colon = raw.indexOf(':');
	return colon === -1 ? raw : raw.slice(colon + 1);
}

/**
 * Depth-first element walk. Deliberately avoids getElementsByTagName('*'):
 * linkedom (used by tests) does not implement the wildcard.
 */
function collectElements(root: Element | null, into: Element[] = []): Element[] {
	if (!root) return into;
	into.push(root);
	const children = root.childNodes;
	for (let i = 0; i < children.length; i++) {
		const node = children[i]!;
		if (node.nodeType === 1) {
			collectElements(node as Element, into);
		}
	}
	return into;
}

/** Reads META-INF/container.xml and returns the OPF package path. */
export function parseContainerXml(xml: string, parser?: XmlParser): string | null {
	try {
		const parse = parserFn(parser ?? (DOMParser as unknown as XmlParser));
		const parsed = parse(xml, XML_MIME);
		for (const el of collectElements(parsed.documentElement)) {
			if (localName(el) === 'rootfile') {
				const fullPath = el.getAttribute('full-path');
				if (fullPath) return fullPath;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/** Parses the OPF package document for title, author and cover image. */
export function parseOpfMeta(xml: string, parser?: XmlParser): EpubOpfMeta {
	const meta: EpubOpfMeta = {};
	try {
		const parse = parserFn(parser ?? (DOMParser as unknown as XmlParser));
		const doc = parse(xml, XML_MIME);
		const all = collectElements(doc.documentElement);
		const manifestItems = new Map<string, Element>();

		for (const el of all) {
			const name = localName(el);
			if (name === 'title' && !meta.title && el.textContent) meta.title = el.textContent.trim();
			if (name === 'creator' && !meta.author && el.textContent) meta.author = el.textContent.trim();
			if (name === 'item') {
				const id = el.getAttribute('id');
				if (id) manifestItems.set(id, el);
			}
		}

		// Cover candidates, most specific first:
		// 1. <meta name="cover" content="itemId"> -> manifest item
		// 2. manifest item with properties="cover-image"
		// 3. any item whose id contains a "cover" token (legacy books often
		//    carry no standard cover marker at all)
		// Candidates may be raster images OR xhtml wrapper pages (the
		// caller unwraps those and reads the <img> inside).
		const payloadType = (item: Element | undefined): string => item?.getAttribute('media-type') || '';
		const isCoverPayload = (item: Element | undefined): boolean => {
			if (!item) return false;
			const type = payloadType(item);
			return type.startsWith('image/')
				|| type === 'application/xhtml+xml'
				|| type === 'text/html';
		};
		const idHasCoverToken = (id: string): boolean =>
			id.split(/[-_\s]/).some(token => token.toLowerCase() === 'cover');
		const applyCoverItem = (item: Element | undefined): boolean => {
			if (!item) return false;
			const href = item.getAttribute('href');
			if (!href) return false;
			meta.coverHref = href;
			meta.coverType = payloadType(item) || undefined;
			return true;
		};

		let resolved = false;
		for (const el of all) {
			if (localName(el) === 'meta' && el.getAttribute('name') === 'cover') {
				const contentId = el.getAttribute('content');
				const item = contentId ? manifestItems.get(contentId) : undefined;
				if (isCoverPayload(item) && applyCoverItem(item)) {
					resolved = true;
					break;
				}
			}
		}
		if (!resolved) {
			for (const item of manifestItems.values()) {
				const properties = item.getAttribute('properties') || '';
				if (properties.split(/\s+/).includes('cover-image') && applyCoverItem(item)) {
					resolved = true;
					break;
				}
			}
		}
		if (!resolved) {
			for (const [id, item] of manifestItems) {
				if (idHasCoverToken(id) && isCoverPayload(item) && applyCoverItem(item)) {
					resolved = true;
					break;
				}
			}
		}
	} catch {
		// Malformed package: keep whatever was collected.
	}
	return meta;
}

/**
 * Extracts the first <img src> from a cover (x)html wrapper page.
 * Many EPUBs point the cover marker at cover.xhtml instead of the
 * image itself.
 */
export function parseCoverXhtml(html: string, parser?: XmlParser): string | null {
	try {
		const parse = parserFn(parser ?? (DOMParser as unknown as XmlParser));
		const doc = parse(html, 'text/html');
		const images = doc.getElementsByTagName('img');
		for (let i = 0; i < images.length; i++) {
			const src = images[i]!.getAttribute('src');
			if (src) return src;
		}
		return null;
	} catch {
		return null;
	}
}

/** Directory portion of a zip entry path ('' for root-level entries). */
export function dirOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx === -1 ? '' : path.slice(0, idx);
}

/**
 * Resolves a manifest href against the OPF directory, normalizing
 * '../' segments and percent-encoding. Returns a zip entry path.
 */
export function resolveZipHref(opfDir: string, href: string): string {
	let decoded = href;
	try {
		decoded = decodeURIComponent(href);
	} catch {
		// Malformed escape sequences: keep the raw href.
	}
	const segments = [...opfDir.split('/').filter(Boolean), ...decoded.split('/')];
	const resolved: string[] = [];
	for (const segment of segments) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			resolved.pop();
			continue;
		}
		resolved.push(segment);
	}
	return resolved.join('/');
}

/**
 * Joins the OPF directory and a raw href WITHOUT percent-decoding.
 * Zip entries are stored under their raw names, which may be either
 * the encoded or the decoded spelling depending on the producer —
 * callers should try this path first, then the decoded one.
 */
export function rawZipPath(opfDir: string, href: string): string {
	const segments = [...opfDir.split('/'), ...href.split('/')];
	return segments.filter(segment => segment !== '' && segment !== '.').join('/');
}

/**
 * Full cover zip path: resolve the OPF-relative href. `opfDir` may be
 * empty (root-level OPF).
 */
export function coverZipPath(opfDir: string, meta: EpubOpfMeta): string | null {
	if (!meta.coverHref) return null;
	return resolveZipHref(opfDir, meta.coverHref);
}
