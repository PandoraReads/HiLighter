import { describe, expect, it } from 'vitest';
import { normalizeImageFolder } from '../src/image-path';

describe('normalizeImageFolder', () => {
    it('accepts an optional vault-relative path and normalizes separators', () => {
        expect(normalizeImageFolder('  assets\\hilighter/  ')).toBe('assets/hilighter');
        expect(normalizeImageFolder('')).toBe('');
    });

    it('rejects absolute paths and traversal segments', () => {
        expect(() => normalizeImageFolder('/outside')).toThrow();
        expect(() => normalizeImageFolder('assets/../outside')).toThrow();
    });
});
