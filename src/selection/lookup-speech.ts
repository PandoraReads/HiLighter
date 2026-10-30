/** Select an installed local voice, preferring the same locale. */
export function selectLocalVoice<T extends { lang: string; localService: boolean; name?: string }>(voices: readonly T[], language: string): T | null {
    const normalized = language.toLowerCase();
    const primary = normalized.split('-')[0];
    if (!primary) return null;
    const local = voices.filter(voice => voice.localService && voice.lang.toLowerCase().split('-')[0] === primary);
    const exact = local.filter(voice => voice.lang.toLowerCase() === normalized);
    const candidates = exact.length ? exact : local;
    return candidates.find(voice => /natural|enhanced|premium|xiaoxiao|ting-ting|tingting|meijia|samantha|zira|female/i.test(voice.name ?? '')) ?? candidates[0] ?? null;
}
