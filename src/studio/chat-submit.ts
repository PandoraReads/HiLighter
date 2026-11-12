// `keyCode` is read through an explicit `{ keyCode: number }` intersection
// instead of KeyboardEvent's deprecated member. 229 is the IME composition
// guard: iOS/CJK keyboards can fire the committing Enter with isComposing
// already false, so we keep the check to avoid submitting partial input.
export function shouldSubmitChat(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'> & { keyCode: number }): boolean {
    return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
