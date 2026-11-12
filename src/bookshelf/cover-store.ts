// ============================================================
// HiLighter - Bookshelf persistent cover store
// ============================================================
// Cover extraction reads the FULL epub/pdf binary (multi-MB files on
// iCloud-synced vaults, where tablets must download each file on
// demand). Repeating that on every bookshelf open is unworkable, so
// successfully extracted covers are shrunk to small JPEG data URLs
// and persisted to a JSON file inside the plugin directory, keyed by
// vault path + mtime. The store is plugin-wide (one instance on the
// plugin, shared by every bookshelf view) and survives restarts.
//
// Only `data:` URLs are persisted: markdown covers are cheap cache
// lookups (resource paths / network URLs) and must stay fresh.

import type { ShelfKind } from './scope';

/** Minimal vault-adapter surface (injectable for tests). */
export interface CoverStoreAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
}

/** One persisted cover entry. */
export interface StoredCover {
	mtime: number;
	/** Shrunk JPEG data URL. */
	src: string;
	title?: string;
	author?: string;
	kind: ShelfKind;
	/** LRU clock (unix ms); bumped on every hit. */
	used: number;
}

/** Hard cap so the JSON file stays bounded (~15-25KB per entry). */
export const MAX_STORED_COVERS = 800;

/** Oversized covers (unshrinkable PNG/SVG art) are not persisted. */
export const MAX_PERSISTABLE_SRC_LENGTH = 300000;

/** Debounce window for coalescing writes after a batch of loads. */
const FLUSH_DEBOUNCE_MS = 3000;

interface StoreFile {
	v: 1;
	items: Record<string, StoredCover>;
}

function emptyFile(): StoreFile {
	return { v: 1, items: {} };
}

/** Parses store JSON defensively; garbage yields an empty store. */
export function parseStoreFile(raw: string): StoreFile {
	try {
		const parsed = JSON.parse(raw) as Partial<StoreFile>;
		if (!parsed || typeof parsed !== 'object' || !parsed.items || typeof parsed.items !== 'object') {
			return emptyFile();
		}
		const items: Record<string, StoredCover> = {};
		for (const [path, entry] of Object.entries(parsed.items)) {
			if (!entry || typeof entry.src !== 'string' || typeof entry.mtime !== 'number') continue;
			items[path] = {
				mtime: entry.mtime,
				src: entry.src,
				title: typeof entry.title === 'string' ? entry.title : undefined,
				author: typeof entry.author === 'string' ? entry.author : undefined,
				kind: entry.kind,
				used: typeof entry.used === 'number' ? entry.used : 0,
			};
		}
		return { v: 1, items };
	} catch {
		return emptyFile();
	}
}

/** True when a cover source is persistable (local data URLs only). */
export function isPersistableCoverSrc(src: string | undefined): src is string {
	return typeof src === 'string' && src.startsWith('data:image/');
}

export class CoverStore {
	private filePath: string;
	private adapter: CoverStoreAdapter;
	private file: StoreFile = emptyFile();
	private loaded = false;
	private loading: Promise<void> | null = null;
	private dirty = false;
	private flushTimer: number | null = null;
	private broken = false;

	constructor(adapter: CoverStoreAdapter, filePath: string) {
		this.adapter = adapter;
		this.filePath = filePath;
	}

	/** Loads the store once; subsequent calls return the same promise. */
	ready(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		if (!this.loading) {
			this.loading = this.adapter.read(this.filePath)
				.then(raw => {
					this.file = parseStoreFile(raw);
				})
				.catch(() => {
					// Missing file (first run) or unreadable — start empty.
					this.file = emptyFile();
				})
				.finally(() => {
					this.loaded = true;
				});
		}
		return this.loading;
	}

	/** Stored entry for a path when mtime still matches; null otherwise. */
	get(path: string, mtime: number): StoredCover | null {
		const entry = this.file.items[path];
		if (!entry || entry.mtime !== mtime) return null;
		// LRU clock bump only — read hits must not trigger a full-file
		// rewrite (opening the shelf is all hits); eviction precision
		// losing the last few bumps is a fine trade.
		entry.used = Date.now();
		return entry;
	}

	/** Inserts/replaces an entry; evicts least-recently-used beyond the cap. */
	put(path: string, entry: StoredCover): void {
		if (this.broken) return;
		if (entry.src.length > MAX_PERSISTABLE_SRC_LENGTH) return;
		this.file.items[path] = entry;
		this.evictIfNeeded();
		this.dirty = true;
		this.scheduleFlush();
	}

	private evictIfNeeded(): void {
		const paths = Object.keys(this.file.items);
		if (paths.length <= MAX_STORED_COVERS) return;
		const excess = paths.length - MAX_STORED_COVERS;
		const byUse = paths
			.map(path => ({ path, used: this.file.items[path]?.used ?? 0 }))
			.sort((a, b) => a.used - b.used);
		for (let i = 0; i < excess; i++) {
			delete this.file.items[byUse[i]!.path];
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) return;
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, FLUSH_DEBOUNCE_MS);
	}

	/** Persists pending changes immediately (also used on unload). */
	async flush(): Promise<void> {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (!this.dirty || this.broken || !this.loaded) return;
		this.dirty = false;
		try {
			await this.adapter.write(this.filePath, JSON.stringify(this.file));
		} catch (err) {
			// A read-only or quarantined plugin dir must never break covers.
			this.broken = true;
			console.error('[HiLighter] cover store write failed (disabled):', err);
		}
	}
}

// ============================================================
// Cover shrinking
// ============================================================

const SHRINK_MAX_WIDTH = 300;
const SHRINK_JPEG_QUALITY = 0.75;

/**
 * Downscales an image data URL to a small JPEG data URL (covers are
 * displayed at ~150-300px; a full-resolution 2MB cover wastes memory
 * and store space). Returns the original on any failure, on non-data
 * URLs, or when the image is already small enough.
 */
export async function shrinkCoverDataUrl(
	dataUrl: string,
	maxWidth = SHRINK_MAX_WIDTH,
	quality = SHRINK_JPEG_QUALITY,
): Promise<string> {
	if (!dataUrl.startsWith('data:image/')) return dataUrl;
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('image decode failed'));
			img.src = dataUrl;
		});
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		if (!width || !height || width <= maxWidth) return dataUrl;

		const scale = maxWidth / width;
		const canvas = document.body.createEl('canvas');
		try {
			canvas.width = maxWidth;
			canvas.height = Math.max(1, Math.round(height * scale));
			const context = canvas.getContext('2d');
			if (!context) return dataUrl;
			context.drawImage(img, 0, 0, canvas.width, canvas.height);
			const out = canvas.toDataURL('image/jpeg', quality);
			// A pathological encode should never grow the payload.
			return out.length < dataUrl.length ? out : dataUrl;
		} finally {
			canvas.remove();
		}
	} catch {
		return dataUrl;
	}
}
