import { franc } from 'franc-min';
const languageCodes: Record<string, string> = { eng: 'en', deu: 'de', fra: 'fr', spa: 'es', por: 'pt', rus: 'ru', jpn: 'ja', kor: 'ko', cmn: 'zh-CN' };
export const lookupLanguages = ['en', 'de', 'fr', 'es', 'pt', 'ru', 'ja', 'ko', 'zh-CN'] as const;
export function lookupTarget(language: string): string {
    return language === 'zh' ? 'zh-CN' : lookupLanguages.includes(language as typeof lookupLanguages[number]) ? language : 'en';
}
export function detectLookupLanguage(text: string, context: string): string | null {
    if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]+$/u.test(text.trim()) && !/[\u3040-\u30ff]/u.test(context)) return 'zh-CN';
    const sample = context.trim().length >= 20 ? context : text;
    if (sample.trim().length < 10 && !/[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fff\u0400-\u04ff]/u.test(sample)) return null;
    const code = franc(sample, { minLength: 3, only: Object.keys(languageCodes) });
    return languageCodes[code] ?? null;
}
