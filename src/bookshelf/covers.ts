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
// Results are cached per path + mtime and PERSISTED (shrunk JPEG
// data URLs) through a plugin-wide CoverStore, so a reopened shelf
// does not re-read gigabytes of book binaries.
//
// Every read runs behind a small semaphore with a hard timeout: on
// iCloud-synced vaults a tablet's `vault.readBinary` can stall for
// minutes (on-demand placeholder download) or forever (offline). A
// stalled read must degrade to a generated cover, never jam the
// whole shelf queue.

import JSZip from 'jszip';
import ePubLib from 'epubjs';
import { TFile } from 'obsidian';
import type { App, Vault } from 'obsidian';
import { shelfKind } from './scope';
import type { ShelfKind } from './scope';
import {
	isPersistableCoverSrc,
	shrinkCoverDataUrl,
	CoverStore,
} from './cover-store';
import { withTimeout } from '../utils/with-timeout';
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

/** Whole-read budget after which the card falls back (mobile gets less). */
export const COVER_TIMEOUT_MS_DESKTOP = 15000;
export const COVER_TIMEOUT_MS_MOBILE = 8000;
/**
 * Budget for the epub.js primary path alone, so the JSZip fallback
 * still gets a slice of the overall deadline. Also bounds the
 * epub.js `book.ready` hang (broken NCX books never resolve it).
 */
const EPUBJS_BUDGET_MS = 6000;
/** Budget for loading the persistent cover store (same iCloud risks). */
const STORE_READY_TIMEOUT_MS = 3000;

/**
 * Binary reads larger than this are skipped (generated cover). On
 * tablets/phones a read is an iCloud on-demand download of the whole
 * file; a textbook-sized epub is not worth one cover.
 */
export const MAX_BINARY_BYTES_MOBILE = 30 * 1024 * 1024;
/** Generous desktop cap against pathological multi-GB files. */
export const MAX_BINARY_BYTES_DESKTOP = 300 * 1024 * 1024;

/** True when a full binary read is worth attempting for a cover. */
export function shouldReadCoverBinary(sizeBytes: number, isMobile: boolean): boolean {
	const cap = isMobile ? MAX_BINARY_BYTES_MOBILE : MAX_BINARY_BYTES_DESKTOP;
	return Number.isFinite(sizeBytes) && sizeBytes >= 0 && sizeBytes <= cap;
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
		destroy?(): Promise<void>;
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
 * Mobile does not serve this module URL, so there we only use the
 * library when Obsidian itself already loaded it.
 */
let pdfjsWarmup: Promise<PdfjsLike | null> | null = null;

function loadPdfjs(allowImport: boolean): Promise<PdfjsLike | null> {
	const direct = (window as unknown as { pdfjsLib?: PdfjsLike }).pdfjsLib;
	if (direct) return Promise.resolve(direct);
	if (!allowImport) return Promise.resolve(null);
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
 *
 * A kill timer bounds the whole attempt: a book with a broken NCX
 * never resolves `book.ready`, and the finally block below would then
 * never run — without the timer the Book plus the full multi-MB
 * binary leak on every shelf visit.
 */
async function readEpubViaEpubjs(data: ArrayBuffer): Promise<Partial<ShelfMeta> | null> {
	let book: EpubBookLike | null = null;
	const killTimer = setTimeout(() => {
		try {
			book?.destroy?.();
		} catch {
			// best-effort teardown
		}
	}, EPUBJS_BUDGET_MS);
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
		clearTimeout(killTimer);
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

		// Bounded primary path: a book with a broken NCX leaves
		// `book.ready` unresolved forever; the budget hands the rest of
		// the deadline to the zip fallback.
		const primary = await withTimeout(
			readEpubViaEpubjs(data),
			EPUBJS_BUDGET_MS,
			() => null,
		);
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

async function readPdfMeta(vault: Vault, file: TFile, isMobile: boolean): Promise<ShelfMeta> {
	const kind: ShelfKind = 'pdf';
	const pdfjs = await loadPdfjs(!isMobile);
	if (!pdfjs) {
		// Mobile without an already-loaded pdf.js, or a build without
		// the module: generated cover.
		if (!isMobile) {
			console.error('[HiLighter] PDF cover unavailable: pdf.js could not be loaded');
		}
		return fallbackMeta(file, kind);
	}
	try {
		const data = new Uint8Array(await vault.readBinary(file));
		const loadingTask = pdfjs.getDocument({ data });
		// A stalled load (worker never ready on mobile) must release its
		// worker: race the document promise and destroy the task on timeout.
		const doc = await withTimeout(
			loadingTask.promise,
			EPUBJS_BUDGET_MS,
			() => {
				void loadingTask.destroy?.().catch(() => undefined);
				return null;
			},
		);
		if (!doc) return fallbackMeta(file, kind);
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

export interface ShelfCoverCacheOptions {
	/** Mobile (tablet/phone) budget + binary-size gates apply. */
	isMobile?: boolean;
	/** Overrides the default whole-read timeout (tests). */
	timeoutMs?: number;
}

/**
 * Cover / metadata cache. One instance per bookshelf view; entries key
 * on path and invalidate when the file mtime changes. Failed or timed
 * out reads cache a title-only fallback so broken files are not re-read
 * forever. Extracted covers are additionally persisted through the
 * shared CoverStore, which makes cold starts cheap.
 */
export class ShelfCoverCache {
	private entries = new Map<string, { mtime: number; promise: Promise<ShelfMeta>; resolved?: ShelfMeta }>();
	private inflight = 0;
	private waiting: Array<() => void> = [];
	private store: CoverStore | null;
	private isMobile: boolean;
	private timeoutMs: number;

	constructor(store: CoverStore | null = null, options: ShelfCoverCacheOptions = {}) {
		this.store = store;
		this.isMobile = Boolean(options.isMobile);
		this.timeoutMs = options.timeoutMs
			?? (this.isMobile ? COVER_TIMEOUT_MS_MOBILE : COVER_TIMEOUT_MS_DESKTOP);
	}

	/** Resolves metadata for a file, memoized until its mtime changes. */
	async get(app: App, file: TFile, kind?: ShelfKind): Promise<ShelfMeta> {
		const mtime = file.stat?.mtime ?? 0;
		const hit = this.entries.get(file.path);
		if (hit && hit.mtime === mtime) return hit.promise;

		const resolvedKind = kind ?? shelfKind(file.extension) ?? 'markdown';

		// Persistent-store hit (previous session's extraction): no vault
		// read at all, memoize the stored value directly.
		if (this.store) {
			// The store file lives in the same iCloud vault — its load can
			// stall on a tablet exactly like a book binary. A slow load is
			// just a miss for this session (it finishes in the background
			// and later views benefit); it must never freeze the shelf.
			await withTimeout(this.store.ready(), STORE_READY_TIMEOUT_MS, () => undefined);
			// Another concurrent get() for the same file may have won the
			// ready() race — honor its entry instead of double-reading.
			const recheck = this.entries.get(file.path);
			if (recheck && recheck.mtime === mtime) return recheck.promise;
			const stored = this.storeHit(file, mtime, resolvedKind);
			if (stored) return this.entries.get(file.path)!.promise;
		}

		// The placeholder promise is replaced synchronously below before
		// anyone can observe it.
		const entry: { mtime: number; promise: Promise<ShelfMeta>; resolved?: ShelfMeta } = {
			mtime,
			promise: Promise.resolve(fallbackMeta(file, resolvedKind)),
		};
		entry.promise = this.acquire(file, resolvedKind, () => this.read(app, file, resolvedKind))
			.then(value => this.persist(file, mtime, value))
			.then(value => {
				entry.resolved = value;
				return value;
			});
		this.entries.set(file.path, entry);
		return entry.promise;
	}

	/** Memoizes a persistent-store hit; returns the meta, or null on a miss. */
	private storeHit(file: TFile, mtime: number, kind: ShelfKind): ShelfMeta | null {
		const store = this.store;
		if (!store) return null;
		let stored: ReturnType<CoverStore['get']> = null;
		try {
			stored = store.get(file.path, mtime);
		} catch {
			return null;
		}
		if (!stored) return null;
		const meta: ShelfMeta = {
			title: stored.title || file.basename,
			author: stored.author,
			coverSrc: stored.src,
			kind,
		};
		const entry: { mtime: number; promise: Promise<ShelfMeta>; resolved?: ShelfMeta } = {
			mtime,
			promise: Promise.resolve(meta),
		};
		entry.promise = entry.promise.then(value => {
			entry.resolved = value;
			return value;
		});
		this.entries.set(file.path, entry);
		return meta;
	}

	/** Shrinks a fresh cover and writes it to the persistent store. */
	private async persist(file: TFile, mtime: number, meta: ShelfMeta): Promise<ShelfMeta> {
		if (!this.store || !isPersistableCoverSrc(meta.coverSrc)) return meta;
		const src = await shrinkCoverDataUrl(meta.coverSrc);
		const next = src === meta.coverSrc ? meta : { ...meta, coverSrc: src };
		this.store.put(file.path, {
			mtime,
			src,
			title: next.title,
			author: next.author,
			kind: next.kind,
			used: Date.now(),
		});
		return next;
	}

	/** Synchronous peek at already-loaded metadata; null when not yet resolved. */
	peek(file: TFile): ShelfMeta | null {
		return this.entries.get(file.path)?.resolved ?? null;
	}

	/** Drops every cached entry (used when the view closes). */
	clear(): void {
		this.entries = new Map();
	}

	/**
	 * Runs jobs behind a small semaphore. Each started job carries its
	 * own deadline: the slot is released when the job settles OR the
	 * budget expires — whichever comes first — so a stalled vault read
	 * (iCloud placeholder download) can never jam the queue, and the
	 * caller always receives a fallback meta by the deadline.
	 */
	private acquire(file: TFile, kind: ShelfKind, job: () => Promise<ShelfMeta>): Promise<ShelfMeta> {
		return new Promise<ShelfMeta>((resolve) => {
			const start = () => {
				let released = false;
				let resolved = false;
				const releaseOnce = (): void => {
					if (released) return;
					released = true;
					this.release();
				};
				const resolveOnce = (value: ShelfMeta): void => {
					if (resolved) return;
					resolved = true;
					resolve(value);
				};
				const timer = setTimeout(() => {
					console.error('[HiLighter] cover read timed out:', file.path);
					releaseOnce();
					resolveOnce(fallbackMeta(file, kind));
				}, this.timeoutMs);
				void job().then(
					value => {
						clearTimeout(timer);
						releaseOnce();
						resolveOnce(value);
					},
					() => {
						clearTimeout(timer);
						releaseOnce();
						resolveOnce(fallbackMeta(file, kind));
					},
				);
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
		if (kind !== 'markdown') {
			const size = file.stat?.size ?? Number.POSITIVE_INFINITY;
			if (!shouldReadCoverBinary(size, this.isMobile)) {
				// Oversized for this platform (mobile: an iCloud download of
				// the whole file) — generated cover, instantly.
				return fallbackMeta(file, kind);
			}
		}
		if (kind === 'epub') return await readEpubMeta(app.vault, file);
		if (kind === 'pdf') return await readPdfMeta(app.vault, file, this.isMobile);
		return readMarkdownMeta(app, file);
	}
}
