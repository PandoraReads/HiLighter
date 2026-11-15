import { describe, expect, it } from 'vitest';
import type { TFile, TFolder } from 'obsidian';
import {
	remapBookKeys,
	moveTargetPath,
	type BookMoveCollections,
} from '../src/bookshelf/book-move';
import { CoverStore, type CoverStoreAdapter } from '../src/bookshelf/cover-store';
import { tagTombstoneId } from '../src/sync/shelf-collections';
import { isLiveTombstone, TOMBSTONE_TTL_MS } from '../src/sync/merge';
import type { BookMeta, SyncTombstone } from '../src/models';
import type { BookTagMap } from '../src/bookshelf/book-tags';

const NOW = 1_700_000_000_000;

function base(overrides: Partial<BookMoveCollections> = {}): BookMoveCollections {
	return {
		tags: {},
		bookMeta: {},
		favorites: [],
		tagTombstones: [],
		bookMetaTombstones: [],
		favoriteTombstones: [],
		...overrides,
	};
}

function liveIds(list: SyncTombstone[]): string[] {
	return list.filter(entry => isLiveTombstone(entry.deletedAt, NOW, TOMBSTONE_TTL_MS))
		.map(entry => entry.id);
}

function meta(updatedAt: number, progress?: number): BookMeta {
	const out: BookMeta = { updatedAt };
	if (progress !== undefined) out.progress = progress;
	return out;
}

describe('remapBookKeys', () => {
	it('moves tags to the new path and tombstones every old path+tag pair', () => {
		const tags: BookTagMap = { 'old/a.epub': ['在读', '科幻'] };
		const out = remapBookKeys(base({ tags }), [{ from: 'old/a.epub', to: 'new/a.epub' }], NOW);
		expect(out.tags).toEqual({ 'new/a.epub': ['在读', '科幻'] });
		expect(liveIds(out.tagTombstones)).toEqual([
			tagTombstoneId('old/a.epub', '在读'),
			tagTombstoneId('old/a.epub', '科幻'),
		]);
	});

	it('unions tags when the new path already carries tags', () => {
		const tags: BookTagMap = { 'old/a.epub': ['在读'], 'new/a.epub': ['科幻'] };
		const out = remapBookKeys(base({ tags }), [{ from: 'old/a.epub', to: 'new/a.epub' }], NOW);
		expect(new Set(out.tags['new/a.epub'])).toEqual(new Set(['在读', '科幻']));
		expect(out.tags['old/a.epub']).toBeUndefined();
	});

	it('clears a stale tag tombstone that would suppress the new path', () => {
		const stale: SyncTombstone[] = [{ id: tagTombstoneId('new/a.epub', '在读'), deletedAt: NOW - 1000 }];
		const tags: BookTagMap = { 'old/a.epub': ['在读'] };
		const out = remapBookKeys(base({ tags, tagTombstones: stale }), [{ from: 'old/a.epub', to: 'new/a.epub' }], NOW);
		expect(out.tagTombstones.some(entry => entry.id === tagTombstoneId('new/a.epub', '在读'))).toBe(false);
	});

	it('moves book metadata, tombstones the old path and clears the new one', () => {
		const staleMeta: SyncTombstone[] = [{ id: 'new/a.epub', deletedAt: NOW - 1000 }];
		const out = remapBookKeys(
			base({ bookMeta: { 'old/a.epub': meta(5, 40) }, bookMetaTombstones: staleMeta }),
			[{ from: 'old/a.epub', to: 'new/a.epub' }],
			NOW,
		);
		expect(out.bookMeta['new/a.epub']).toEqual(meta(5, 40));
		expect(out.bookMeta['old/a.epub']).toBeUndefined();
		expect(liveIds(out.bookMetaTombstones)).toEqual(['old/a.epub']);
	});

	it('keeps a leftover entry at the target when the moved book has none', () => {
		const out = remapBookKeys(
			base({ bookMeta: { 'new/a.epub': meta(9) } }),
			[{ from: 'old/a.epub', to: 'new/a.epub' }],
			NOW,
		);
		// No metadata at the old path: nothing moves, nothing tombstoned.
		expect(out.bookMeta).toEqual({ 'new/a.epub': meta(9) });
		expect(liveIds(out.bookMetaTombstones)).toEqual([]);
	});

	it('swaps favorites with matching tombstones', () => {
		const out = remapBookKeys(
			base({ favorites: ['old/a.epub', 'keep/b.epub'] }),
			[{ from: 'old/a.epub', to: 'new/a.epub' }],
			NOW,
		);
		expect(out.favorites).toEqual(['keep/b.epub', 'new/a.epub']);
		expect(liveIds(out.favoriteTombstones)).toEqual(['old/a.epub']);
	});

	it('leaves everything untouched for paths with no state', () => {
		const collections = base({ favorites: ['other/b.epub'] });
		const out = remapBookKeys(collections, [{ from: 'old/a.epub', to: 'new/a.epub' }], NOW);
		expect(out).toEqual(collections);
	});

	it('ignores degenerate move pairs', () => {
		const tags: BookTagMap = { 'a.epub': ['tag'] };
		const out = remapBookKeys(
			base({ tags }),
			[{ from: '', to: 'x' }, { from: 'x', to: '' }, { from: 'same', to: 'same' }],
			NOW,
		);
		expect(out.tags).toEqual(tags);
		expect(out.tagTombstones).toEqual([]);
	});

	it('never mutates the input collections', () => {
		const tags: BookTagMap = { 'old/a.epub': ['在读'] };
		const favorites = ['old/a.epub'];
		const bookMeta = { 'old/a.epub': meta(1) };
		const input = base({ tags, favorites, bookMeta });
		remapBookKeys(input, [{ from: 'old/a.epub', to: 'new/a.epub' }], NOW);
		expect(input.tags).toBe(tags);
		expect(input.favorites).toBe(favorites);
		expect(input.bookMeta).toBe(bookMeta);
	});
});

describe('moveTargetPath', () => {
	it('prefixes the folder path for a regular folder', () => {
		const folder = { path: 'Books/科幻', isRoot: () => false } as unknown as TFolder;
		const file = { name: '三体.epub', path: 'inbox/三体.epub' } as unknown as TFile;
		expect(moveTargetPath(folder, file)).toBe('Books/科幻/三体.epub');
	});

	it('targets the vault top level for the root folder', () => {
		const folder = { path: '/', isRoot: () => true } as unknown as TFolder;
		const file = { name: '三体.epub', path: 'inbox/三体.epub' } as unknown as TFile;
		expect(moveTargetPath(folder, file)).toBe('三体.epub');
	});
});

describe('CoverStore.rekey', () => {
	const entry = { mtime: 42, src: 'data:image/jpeg;base64,abc', kind: 'epub' as const, used: 1 };

	function memoryAdapter(initial?: string): CoverStoreAdapter & { written: string[] } {
		const written: string[] = [];
		return {
			written,
			async read() { return initial ?? ''; },
			async write(_path: string, data: string) { written.push(data); },
		};
	}

	it('moves a stored entry to the new path keeping the mtime', async () => {
		const adapter = memoryAdapter(JSON.stringify({ v: 1, items: { 'old/a.epub': entry } }));
		const store = new CoverStore(adapter, 'covers.json');
		await store.ready();
		store.rekey('old/a.epub', 'new/a.epub');
		expect(store.get('new/a.epub', 42)?.src).toBe(entry.src);
		expect(store.get('old/a.epub', 42)).toBeNull();
		await store.flush();
		const persisted = JSON.parse(adapter.written[0]!) as { items: Record<string, unknown> };
		expect(persisted.items['new/a.epub']).toBeDefined();
		expect(persisted.items['old/a.epub']).toBeUndefined();
	});

	it('never overwrites an entry that already exists at the new path', async () => {
		const adapter = memoryAdapter(JSON.stringify({
			v: 1,
			items: {
				'old/a.epub': { ...entry, src: 'data:image/jpeg;base64,OLD' },
				'new/a.epub': { ...entry, src: 'data:image/jpeg;base64,NEW' },
			},
		}));
		const store = new CoverStore(adapter, 'covers.json');
		await store.ready();
		store.rekey('old/a.epub', 'new/a.epub');
		expect(store.get('new/a.epub', 42)?.src).toBe('data:image/jpeg;base64,NEW');
		expect(store.get('old/a.epub', 42)?.src).toBe('data:image/jpeg;base64,OLD');
	});

	it('is a no-op when the old entry is missing', async () => {
		const store = new CoverStore(memoryAdapter(), 'covers.json');
		await store.ready();
		expect(() => store.rekey('missing.epub', 'x/missing.epub')).not.toThrow();
		expect(store.get('x/missing.epub', 42)).toBeNull();
	});
});
