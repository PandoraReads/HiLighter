import { describe, expect, it } from 'vitest';
import { shouldSubmitChat } from '../src/studio/chat-submit';

describe('chat keyboard submission', () => {
    const key = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };
    it('submits on Enter', () => expect(shouldSubmitChat(key)).toBe(true));
    it('allows newlines with Shift+Enter', () => expect(shouldSubmitChat({ ...key, shiftKey: true })).toBe(false));
    it('does not submit while confirming an IME composition', () => {
        expect(shouldSubmitChat({ ...key, isComposing: true })).toBe(false);
        expect(shouldSubmitChat({ ...key, keyCode: 229 })).toBe(false);
    });
    it('ignores other keys', () => expect(shouldSubmitChat({ ...key, key: 'a' })).toBe(false));
});
