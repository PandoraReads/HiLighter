import { describe, it, expect } from 'vitest';
import { findReferenceRange } from '../src/studio/card-reference-format';
const doc = 'before\n```hilighter-card\nid1\n```\nafter\n```hilighter-card\nid1\n```\n';
describe('remove a card reference', () => {
    it('finds only the reference at the section line', () => {
        const r = findReferenceRange(doc, 'id1', 1);
        expect(r && doc.slice(r.from, r.to)).toBe('```hilighter-card\nid1\n```\n');
    });
    it('refuses a stale position or mismatched ID', () => {
        expect(findReferenceRange(doc, 'id1', 4)).toBeNull();
        expect(findReferenceRange(doc, 'other', 1)).toBeNull();
    });
});
