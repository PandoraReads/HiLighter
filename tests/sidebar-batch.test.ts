import { describe, expect, it } from 'vitest';
import { editCardTags } from '../src/studio/sidebar-batch-tags';

describe('sidebar batch tag editing', () => {
    it('adds a normalized tag once without mutating existing tags', () => {
        const tags = ['alpha'];
        expect(editCardTags(tags, ' #beta ', 'add')).toEqual(['alpha', 'beta']);
        expect(editCardTags(tags, '#alpha', 'add')).toEqual(['alpha']);
        expect(tags).toEqual(['alpha']);
    });
    it('removes only the requested tag and ignores empty input', () => {
        expect(editCardTags(['alpha', 'beta'], '#alpha', 'remove')).toEqual(['beta']);
        expect(editCardTags(['alpha'], ' # ', 'remove')).toEqual(['alpha']);
    });
});
