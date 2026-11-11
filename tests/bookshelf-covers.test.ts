import { describe, expect, it } from 'vitest';
import { withTimeout } from '../src/utils/with-timeout';
import {
	CoverStore,
	parseStoreFile,
	isPersistableCoverSrc,
	type CoverStoreAdapter,
	type StoredCover,
} from '../src/bookshelf/cover-store';
import {
	ShelfCoverCache,
	shouldReadCoverBinary,
	MAX_BINARY_BYTES_MOBILE,
	MAX_BINARY_BYTES_DESKTOP,
} from '../src/bookshelf/covers';
import type { App, TFile } from 'obsidian';

// ── withTimeout ─────────────────────────────────────────────

describe('withTimeout', () => {
	it('passes the value through when the promise resolves in time', async () => {
		await expect(withTimeout(Promise.resolve(42), 1000, () => 0)).resolves.toBe(42);
	});

	it('settles with the fallback when the promise never settles', async () => {
		const never = new Promise<number>(() => {});
		await expect(withTimeout(never, 20, () => -1)).resolves.toBe(-1);
	});

	it('settles with the fallback when the promise rejects', async () => {
		const rejected = Promise.reject(new Error('boom'));
		await expect(withTimeout(rejected, 1000, () => 'safe')).resolves.toBe('safe');
	});

	it('settles exactly once even when the late promise resolves afterwards', async () => {
		let lateResolve: ((v: string) => void) | null = null;
		const late = new Promise<string>(resolve => { lateResolve = resolve; });
		const result = withTimeout(late, 10, () => 'fallback');
		await expect(result).resolves.toBe('fallback');
		lateResolve!('late');
		await new Promise(r => setTimeout(r, 5));
		await expect(result).resolves.toBe('fallback');
	});
});

// ── binary size gates ───────────────────────────────────────

describe('shouldReadCoverBinary', () => {
	it('allows modest files on both platforms', () => {
		expect(shouldReadCoverBinary(1024, false)).toBe(true);
		expect(shouldReadCoverBinary(1024, true)).toBe(true);
	});

	it('enforces a tighter cap on mobile (iCloud on-demand download)', () => {
		expect(shouldReadCoverBinary(MAX_BINARY_BYTES_MOBILE + 1, true)).toBe(false);
		expect(shouldReadCoverBinary(MAX_BINARY_BYTES_MOBILE - 1, true)).toBe(true);
		expect(shouldReadCoverBinary(MAX_BINARY_BYTES_DESKTOP + 1, false)).toBe(false);
		expect(shouldReadCoverBinary(MAX_BINARY_BYTES_MOBILE + 1, false)).toBe(true);
	});

	it('rejects non-finite sizes', () => {
		expect(shouldReadCoverBinary(Number.POSITIVE_INFINITY, false)).toBe(false);
		expect(shouldReadCoverBinary(Number.NaN, true)).toBe(false);
	});
});

// ── cover store persistence ─────────────────────────────────

function memoryAdapter(initial?: string): CoverStoreAdapter & { written: string[] } {
	return {
		written: [] as string[],
		async read() {
			if (initial === undefined) throw new Error('ENOENT');
			return initial;
		},
		async write(_path: string, data: string) {
			this.written.push(data);
		},
	};
}

function entry(overrides: Partial<StoredCover> = {}): StoredCover {
	return {
		mtime: 100,
		src: 'data:image/jpeg;base64,abc',
		title: 'Book',
		kind: 'epub',
		used: 1,
		...overrides,
	};
}

describe('parseStoreFile', () => {
	it('round-trips entries', () => {
		const file = { v: 1, items: { 'a.epub': entry() } };
		const parsed = parseStoreFile(JSON.stringify(file));
		expect(parsed.items['a.epub']).toEqual(entry());
	});

	it('tolerates garbage and drops invalid entries', () => {
		expect(parseStoreFile('not json').items).toEqual({});
		const parsed = parseStoreFile(JSON.stringify({
			v: 1,
			items: {
				ok: entry(),
				bad: { mtime: 'x' },
				miss: { src: 'http://x' },
			},
		}));
		expect(Object.keys(parsed.items)).toEqual(['ok']);
	});
});

describe('CoverStore', () => {
	it('returns null before ready() and hits after load', async () => {
		const adapter = memoryAdapter(JSON.stringify({ v: 1, items: { 'a.epub': entry() } }));
		const store = new CoverStore(adapter, 'covers.json');
		expect(store.get('a.epub', 100)).toBeNull();
		await store.ready();
		expect(store.get('a.epub', 100)?.src).toBe('data:image/jpeg;base64,abc');
		// mtime mismatch invalidates
		expect(store.get('a.epub', 999)).toBeNull();
	});

	it('persists puts via flush and survives a reload', async () => {
		const adapter = memoryAdapter();
		const store = new CoverStore(adapter, 'covers.json');
		await store.ready();
		store.put('b.epub', entry({ mtime: 7, title: 'B' }));
		await store.flush();
		expect(adapter.written.length).toBe(1);
		const reopened = new CoverStore(memoryAdapter(adapter.written[0]!), 'covers.json');
		await reopened.ready();
		expect(reopened.get('b.epub', 7)?.title).toBe('B');
	});

	it('evicts least-recently-used entries beyond the cap', async () => {
		const adapter = memoryAdapter();
		const store = new CoverStore(adapter, 'covers.json');
		await store.ready();
		for (let i = 0; i < 900; i++) {
			store.put(`book-${i}.epub`, entry({ mtime: i, used: i }));
		}
		await store.flush();
		const persisted = parseStoreFile(adapter.written[0]!);
		expect(Object.keys(persisted.items).length).toBe(800);
		// The oldest-used books were evicted, the newest kept.
		expect(persisted.items['book-0.epub']).toBeUndefined();
		expect(persisted.items['book-899.epub']).toBeDefined();
	});

	it('disables itself after a write failure instead of throwing', async () => {
		const adapter: CoverStoreAdapter = {
			async read() { throw new Error('ENOENT'); },
			async write() { throw new Error('read-only'); },
		};
		const store = new CoverStore(adapter, 'covers.json');
		await store.ready();
		store.put('a.epub', entry());
		await expect(store.flush()).resolves.toBeUndefined();
		// Broken store drops further puts silently.
		store.put('b.epub', entry());
		await expect(store.flush()).resolves.toBeUndefined();
	});

	it('starts empty when the file is missing (first run)', async () => {
		const store = new CoverStore(memoryAdapter(), 'covers.json');
		await store.ready();
		expect(store.get('a.epub', 1)).toBeNull();
	});
});

describe('isPersistableCoverSrc', () => {
	it('accepts only local image data URLs', () => {
		expect(isPersistableCoverSrc('data:image/jpeg;base64,x')).toBe(true);
		expect(isPersistableCoverSrc('http://example.com/c.jpg')).toBe(false);
		expect(isPersistableCoverSrc('app://local/x.png')).toBe(false);
		expect(isPersistableCoverSrc(undefined)).toBe(false);
	});
});

// ── cache semantics (the tablet deadlock regression) ────────

interface FakeFileSpec {
	path: string;
	mtime?: number;
	size?: number;
}

function fakeFile(spec: FakeFileSpec): TFile {
	const dot = spec.path.lastIndexOf('.');
	return {
		path: spec.path,
		name: spec.path.split('/').pop()!,
		basename: spec.path.split('/').pop()!.replace(/\.[^.]+$/, ''),
		extension: dot > 0 ? spec.path.slice(dot + 1) : '',
		stat: { mtime: spec.mtime ?? 1, size: spec.size ?? 1000 },
	} as unknown as TFile;
}

function fakeApp(readBinary: (file: TFile) => Promise<ArrayBuffer>): App {
	return {
		vault: { readBinary },
		metadataCache: {
			getFileCache: () => null,
			getFirstLinkpathDest: () => null,
		},
	} as unknown as App;
}

describe('ShelfCoverCache', () => {
	it('releases semaphore slots on timeout so queued reads still settle', async () => {
		// Three stalled binary reads (iCloud placeholder downloads on a
		// tablet) hold every slot; the fourth card must still get its
		// (fallback) meta instead of shimmering forever.
		const never = new Promise<ArrayBuffer>(() => { /* never settles */ });
		const app = fakeApp(() => never);
		const cache = new ShelfCoverCache(null, { timeoutMs: 40 });

		const hung = [
			cache.get(app, fakeFile({ path: 'books/a.epub' }), 'epub'),
			cache.get(app, fakeFile({ path: 'books/b.epub' }), 'epub'),
			cache.get(app, fakeFile({ path: 'books/c.epub' }), 'epub'),
		];
		const queued = cache.get(app, fakeFile({ path: 'books/m.md' }), 'markdown');

		const mdMeta = await queued;
		expect(mdMeta.title).toBe('m');
		expect(mdMeta.coverSrc).toBeUndefined();

		const settled = await Promise.all(hung);
		settled.forEach(meta => {
			expect(meta.title).toMatch(/a|b|c/);
			expect(meta.coverSrc).toBeUndefined();
		});
	});

	it('serves markdown covers without touching the vault binary', async () => {
		let binaryReads = 0;
		const app = fakeApp(async () => {
			binaryReads++;
			return new ArrayBuffer(8);
		});
		const cache = new ShelfCoverCache(null, { timeoutMs: 1000 });
		const meta = await cache.get(app, fakeFile({ path: 'n.md' }), 'markdown');
		expect(meta.kind).toBe('markdown');
		expect(binaryReads).toBe(0);
	});

	it('answers from the persistent store without any vault read', async () => {
		let binaryReads = 0;
		const app = fakeApp(async () => {
			binaryReads++;
			return new ArrayBuffer(8);
		});
		const adapter = memoryAdapter(JSON.stringify({
			v: 1,
			items: {
				'books/a.epub': entry({ mtime: 55, title: 'Stored', author: 'A' }),
			},
		}));
		const store = new CoverStore(adapter, 'covers.json');
		const cache = new ShelfCoverCache(store, { timeoutMs: 1000 });
		const meta = await cache.get(app, fakeFile({ path: 'books/a.epub', mtime: 55 }), 'epub');
		expect(meta.title).toBe('Stored');
		expect(meta.author).toBe('A');
		expect(meta.coverSrc).toBe('data:image/jpeg;base64,abc');
		expect(binaryReads).toBe(0);
		// Memoized within the view as well.
		await cache.get(app, fakeFile({ path: 'books/a.epub', mtime: 55 }), 'epub');
		expect(binaryReads).toBe(0);
	});

	it('skips oversized binaries with an instant generated cover', async () => {
		let binaryReads = 0;
		const app = fakeApp(async () => {
			binaryReads++;
			return new ArrayBuffer(8);
		});
		const cache = new ShelfCoverCache(null, { timeoutMs: 1000, isMobile: true });
		const meta = await cache.get(
			app,
			fakeFile({ path: 'books/huge.epub', size: MAX_BINARY_BYTES_MOBILE + 1 }),
			'epub',
		);
		expect(meta.title).toBe('huge');
		expect(binaryReads).toBe(0);
	});
});
