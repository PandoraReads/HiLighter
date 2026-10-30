import { describe, expect, it } from 'vitest';
import { cardReferenceMarkdown, parseCardReference } from '../src/studio/card-reference-format';

describe('card references', () => {
    it('creates a standalone reference to the original ID', () => {
        expect(cardReferenceMarkdown('abc-123')).toBe('\n\n```hilighter-card\nabc-123\n```\n\n');
        expect(parseCardReference('  abc-123\n')).toBe('abc-123');
    });
    it('rejects empty and malformed identifiers', () => {
        expect(parseCardReference('')).toBeNull();
        expect(parseCardReference('a\n```')).toBeNull();
        expect(() => cardReferenceMarkdown('bad\n```')).toThrow();
    });
});
