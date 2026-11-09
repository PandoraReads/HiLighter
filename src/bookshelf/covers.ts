// ============================================================
// HiLighter - Bookshelf cover / metadata service
// ============================================================
// Resolves per-file display metadata for the shelf:
// - EPUB: title + author + built-in cover via JSZip + OPF parsing
//         (including cover.xhtml wrapper pages)
// - PDF:  first-page render via Obsidian's bundled pdf.js (fallback:
//         generated cover)
// - Markdown: frontmatter cover/image/... property — vault image or
//         network URL (fallback: generated cover)
// Results are cached per path + mtime; reads run behind a small
// semaphore so a big shelf does not stampede the vault adapter.

import JSZip from 'jszip';
import ePubLib from 'epubjs';
import { TFile } from 'obsidian';
import type { App, Vault } from 'obsidian';
import { shelfKind } from './scope';
import type { ShelfKind } from './scope';
import {
	parseContainerXml,
	parseOpfMeta,
	parseCoverXhtml,
	rawZipPath,
	resolveZipHref,
	dirOf,
} from '../epub/epub-meta';
import { isHttpUrl, pickMarkdownCover, stripMarkdownLink } from './md-cover';

export interface ShelfMeta {
	title: string;
	author?: string;
	/**
	 * Ready-to-use <img src>: data URL (epub cover / pdf page render),
	 * an Obsidian resource URL (markdown frontmatter image) or a
	 * network URL. Absent -> render a generated cover.
	 */
	coverSrc?: string;
	kind: ShelfKind;
}

/** Minimal pdf.js surface used for first-page renders (not public API). */
interface PdfjsLike {
	getDocument(options: { data: Uint8Array }): {
		promise: Promise<{
			getPage(pageNumber: number): Promise<{
				getViewport(options: { scale: number }): { width: number; height: number };
				render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
			}>;
			destroy(): Promise<void>;
		}>;
	};
	GlobalWorkerOptions?: { workerSrc?: string };
}

/** pdf.js module URLs used by Obsidian's built-in PDF view. */
const PDFJS_MODULE_URL = '/lib/pdfjs/pdf.min.mjs';
const PDFJS_WORKER_URL = '/lib/pdfjs/pdf.worker.min.mjs';

/**
 * Obsidian lazy-loads pdf.js the first time a PDF view opens, so
 * window.pdfjsLib is absent until then. Import the same module URL
 * ourselves: the module registry returns the identical instance the
 * built-in viewer uses (and evaluating it exposes the library), so
 * covers render even in a fresh session where no PDF was opened yet.
 */
let pdfjsWarmup: Promise<PdfjsLike | null> | null = null;

function loadPdfjs(): Promise<PdfjsLike | null> {
	const direct = (window as unknown as { pdfjsLib?: PdfjsLike }).pdfjsLib;
	if (direct) return Promise.resolve(direct);
	if (pdfjsWarmup) return pdfjsWarmup;

	pdfjsWarmup = (async () => {
		try {
			// Non-literal specifier so the bundler leaves this runtime
			// import() untouched (it targets the app's own module, which
			// must not be bundled). The URL is a hardcoded app constant,
			// never user input — safe for the sanitizer rule.
			const url = PDFJS_MODULE_URL;
			// eslint-disable-next-line no-unsanitized/method -- hardcoded app module URL, not user input
			const mod = await import(url) as { pdfjsLib?: PdfjsLike; default?: PdfjsLike };
			const lib = mod.pdfjsLib ?? mod.default
				?? (window as unknown as { pdfjsLib?: PdfjsLike }).pdfjsLib;
			if (!lib) return null;
			// Obsidian's own loader wires the worker after import; when we
			// got here first, do the same wiring (same URL it uses).
			if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
				lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
			}
			return lib;
		} catch (err) {
			console.error('[HiLighter] pdf.js warmup failed:', err);
			return null;
		}
	})();
	return pdfjsWarmup;
}

const PDF_TARGET_WIDTH = 320;
const MAX_CONCURRENT_READS = 3;

function fallbackMeta(file: TFile, kind: ShelfKind): ShelfMeta {
	return { title: file.basename, kind };
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return `data:${mime};base64,${btoa(binary)}`;
}

// ============================================================
// EPUB
// ============================================================

/** Minimal epub.js Book surface used for metadata + cover extraction. */
interface EpubBookLike {
	ready: Promise<unknown>;
	packaging?: { metadata?: { title?: unknown; creator?: unknown } };
	/** Resolved cover path, set once the package has loaded. */
	cover?: unknown;
	archive?: {
		createUrl?: (url: string, options?: { base64?: boolean }) => Promise<unknown>;
	};
	destroy?: () => void;
}

/**
 * Primary epub metadata path: the epub.js Book — the same library and
 * call pattern the HiLighter reader itself uses, so whatever opens in
 * the reader also yields its cover here. The cover is pulled as a
 * base64 data URL straight from the archive (no blob URL lifetime to
 * manage, and the book can be destroyed immediately after).
 */
async function readEpubViaEpubjs(data: ArrayBuffer): Promise<Partial<ShelfMeta> | null> {
	let book: EpubBookLike | null = null;
	try {
		book = ePubLib(data as unknown as string) as unknown as EpubBookLike;
		await book.ready;
		const metadata = book.packaging?.metadata;
		const title = typeof metadata?.title === 'string' && metadata.title.trim() ? metadata.title.trim() : undefined;
		const author = typeof metadata?.creator === 'string' && metadata.creator.trim() ? metadata.creator.trim() : undefined;

		let coverSrc: string | undefined;
		const coverPath = typeof book.cover === 'string' ? book.cover : undefined;
		if (coverPath && book.archive?.createUrl) {
			const url = await book.archive.createUrl(coverPath, { base64: true });
			// EPUB2 books sometimes point at a cover.xhtml wrapper; only a
			// real image counts here — anything else falls through to the
			// zip path, which knows how to unwrap those pages.
			if (typeof url === 'string' && url.startsWith('data:image/')) coverSrc = url;
		}
		return { title, author, coverSrc };
	} catch {
		return null;
	} finally {
		try {
			book?.destroy?.();
		} catch {
			// destroy is best-effort cleanup
		}
	}
}

/** Reads one zip entry as a base64 data URL; null when missing. */
async function readImageEntry(zip: JSZip, path: string, mime?: string): Promise<string | null> {
	try {
		const entry = zip.file(path);
		if (!entry) return null;
		const type = mime && mime.startsWith('image/') ? mime : 'image/jpeg';
		return arrayBufferToDataUrl(await entry.async('arraybuffer'), type);
	} catch {
		return null;
	}
}

/** Tries the raw spelling of a zip path first, then the decoded one. */
async function readImageByHref(zip: JSZip, opfDir: string, href: string, mime?: string): Promise<string | null> {
	const raw = await readImageEntry(zip, rawZipPath(opfDir, href), mime);
	if (raw) return raw;
	const decoded = resolveZipHref(opfDir, href);
	if (decoded !== rawZipPath(opfDir, href)) {
		return readImageEntry(zip, decoded, mime);
	}
	return null;
}

/** Fallback path: direct JSZip + OPF parsing (covers epub.js misses). */
async function readEpubViaZip(zip: JSZip): Promise<Partial<ShelfMeta> | null> {
	try {
		const containerEntry = zip.file('META-INF/container.xml');
		const containerXml = containerEntry ? await containerEntry.async('string') : null;
		const opfPath = containerXml ? parseContainerXml(containerXml) : null;
		if (!opfPath) return null;

		const opfEntry = zip.file(opfPath);
		if (!opfEntry) return null;

		const opfXml = await opfEntry.async('string');
		const meta = parseOpfMeta(opfXml);
		const opfDir = dirOf(opfPath);
		const result: Partial<ShelfMeta> = {
			title: meta.title,
			author: meta.author,
		};

		if (meta.coverHref) {
			const coverType = meta.coverType || '';
			if (coverType.startsWith('image/')) {
				result.coverSrc = (await readImageByHref(zip, opfDir, meta.coverHref, coverType)) ?? undefined;
			} else {
				// Cover marker points at a wrapper page (cover.xhtml):
				// unwrap it and read the <img> inside.
				const wrapper = zip.file(rawZipPath(opfDir, meta.coverHref)) ?? zip.file(resolveZipHref(opfDir, meta.coverHref));
				if (wrapper) {
					const html = await wrapper.async('string').catch(() => '');
					const imgHref = html ? parseCoverXhtml(html) : null;
					if (imgHref) {
						result.coverSrc = (await readImageByHref(zip, opfDir, imgHref)) ?? undefined;
					}
				}
			}
		}
		return result;
	} catch {
		return null;
	}
}

async function readEpubMeta(vault: Vault, file: TFile): Promise<ShelfMeta> {
	const kind: ShelfKind = 'epub';
	try {
		const data = await vault.readBinary(file);

		const primary = await readEpubViaEpubjs(data);
		let meta: ShelfMeta = {
			title: primary?.title || file.basename,
			author: primary?.author,
			coverSrc: primary?.coverSrc,
			kind,
		};

		if (!meta.coverSrc) {
			// Second chance: direct zip parsing (different cover heuristics
			// than epub.js — one of the two covers nearly every book).
			try {
				const zip = await JSZip.loadAsync(data);
				const fallback = await readEpubViaZip(zip);
				meta = {
					title: meta.title || fallback?.title || file.basename,
					author: meta.author || fallback?.author,
					coverSrc: fallback?.coverSrc ?? meta.coverSrc,
					kind,
				};
			} catch {
				// zip fallback is optional
			}
		}
		return meta;
	} catch (err) {
		console.error('[HiLighter] EPUB cover failed:', file.path, err);
		return fallbackMeta(file, kind);
	}
}

// ============================================================
// PDF
// ============================================================

async function readPdfMeta(vault: Vault, file: TFile): Promise<ShelfMeta> {
	const kind: ShelfKind = 'pdf';
	const pdfjs = await loadPdfjs();
	if (!pdfjs) {
		// Builds without the pdf.js module: generated cover.
		console.error('[HiLighter] PDF cover unavailable: pdf.js could not be loaded');
		return fallbackMeta(file, kind);
	}
	try {
		const data = new Uint8Array(await vault.readBinary(file));
		const doc = await pdfjs.getDocument({ data }).promise;
		try {
			const page = await doc.getPage(1);
			const base = page.getViewport({ scale: 1 });
			const scale = Math.min(2, Math.max(0.2, PDF_TARGET_WIDTH / Math.max(1, base.width)));
			const viewport = page.getViewport({ scale });
			// Off-screen canvas via createEl (appended then removed) per the
			// Obsidian plugin lint rules.
			const canvas = document.body.createEl('canvas');
			try {
				canvas.width = Math.max(1, Math.floor(viewport.width));
				canvas.height = Math.max(1, Math.floor(viewport.height));
				const context = canvas.getContext('2d');
				if (!context) return fallbackMeta(file, kind);
				await page.render({ canvasContext: context, viewport }).promise;
				return { title: file.basename, coverSrc: canvas.toDataURL('image/jpeg', 0.82), kind };
			} finally {
				canvas.remove();
			}
		} finally {
			void doc.destroy().catch(() => undefined);
		}
	} catch (err) {
		// Surface why the render failed (worker, password, corruption);
		// the card falls back to the generated cover either way.
		console.error('[HiLighter] PDF cover failed:', file.path, err);
		return fallbackMeta(file, kind);
	}
}

// ============================================================
// Markdown (frontmatter cover property)
// ============================================================

function readMarkdownMeta(app: App, file: TFile): ShelfMeta {
	const kind: ShelfKind = 'markdown';
	try {
		const cache = app.metadataCache.getFileCache(file);
		const raw = pickMarkdownCover(cache?.frontmatter);
		if (!raw) return fallbackMeta(file, kind);

		const value = stripMarkdownLink(raw);
		if (!value) return fallbackMeta(file, kind);

		if (isHttpUrl(value)) {
			return { title: file.basename, coverSrc: value, kind };
		}

		const target = app.metadataCache.getFirstLinkpathDest(value, file.path);
		if (target instanceof TFile) {
			return { title: file.basename, coverSrc: app.vault.getResourcePath(target), kind };
		}
	} catch {
		// Unresolved cache / link: fall through to the generated cover.
	}
	return fallbackMeta(file, kind);
}

// ============================================================
// Cache + concurrency
// ============================================================

/**
 * Cover / metadata cache. One instance per bookshelf view; entries key
 * on path and invalidate when the file mtime changes. Failed reads
 * cache a title-only fallback so broken files are not re-read forever.
 */
export class ShelfCoverCache {
	private entries = new Map<string, { mtime: number; promise: Promise<ShelfMeta>; resolved?: ShelfMeta }>();
	private inflight = 0;
	private waiting: Array<() => void> = [];

	/** Resolves metadata for a file, memoized until its mtime changes. */
	get(app: App, file: TFile, kind?: ShelfKind): Promise<ShelfMeta> {
		const mtime = file.stat?.mtime ?? 0;
		const hit = this.entries.get(file.path);
		if (hit && hit.mtime === mtime) return hit.promise;

		const resolvedKind = kind ?? shelfKind(file.extension) ?? 'markdown';
		// The placeholder promise is replaced synchronously below before
		// anyone can observe it.
		const entry: { mtime: number; promise: Promise<ShelfMeta>; resolved?: ShelfMeta } = {
			mtime,
			promise: Promise.resolve(fallbackMeta(file, resolvedKind)),
		};
		entry.promise = this.acquire(() => this.read(app, file, resolvedKind))
			.catch(() => fallbackMeta(file, resolvedKind))
			.then(value => {
				entry.resolved = value;
				return value;
			});
		this.entries.set(file.path, entry);
		return entry.promise;
	}

	/** Synchronous peek at already-loaded metadata; null when not yet resolved. */
	peek(file: TFile): ShelfMeta | null {
		return this.entries.get(file.path)?.resolved ?? null;
	}

	/** Drops every cached entry (used when the view closes). */
	clear(): void {
		this.entries = new Map();
	}

	/** Runs jobs behind a small semaphore; resolution order is preserved. */
	private acquire(job: () => Promise<ShelfMeta>): Promise<ShelfMeta> {
		return new Promise<ShelfMeta>((resolve) => {
			const start = () => {
				void job().then(resolve, () => resolve({ title: '', kind: 'markdown' }));
			};
			if (this.inflight < MAX_CONCURRENT_READS) {
				this.inflight++;
				start();
			} else {
				this.waiting.push(start);
			}
		});
	}

	private release(): void {
		this.inflight--;
		const next = this.waiting.shift();
		if (next) {
			this.inflight++;
			next();
		}
	}

	private async read(app: App, file: TFile, kind: ShelfKind): Promise<ShelfMeta> {
		try {
			if (kind === 'epub') return await readEpubMeta(app.vault, file);
			if (kind === 'pdf') return await readPdfMeta(app.vault, file);
			return readMarkdownMeta(app, file);
		} finally {
			this.release();
		}
	}
}
