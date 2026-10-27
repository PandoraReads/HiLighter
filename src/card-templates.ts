import type { CardTemplateId, CurrentCardTemplateId, HighlightNote } from './models';
import { getLang } from './i18n';

interface TextLabel { zh: string; en: string }
export interface CardFieldSpec { id: string; label: TextLabel; hint: TextLabel }
export interface CardTemplateSpec { id: CurrentCardTemplateId; label: TextLabel; description: TextLabel; fields: readonly CardFieldSpec[] }

const field = (id: string, zh: string, en: string, hintZh: string, hintEn: string): CardFieldSpec => ({
    id, label: { zh, en }, hint: { zh: hintZh, en: hintEn },
});

export const CARD_TEMPLATES: readonly CardTemplateSpec[] = [
    { id: 'excerpt', label: { zh: '摘录', en: 'Excerpt' }, description: { zh: '先捕捉原文，稍后再整理。', en: 'Capture the source now; develop it later.' }, fields: [] },
    { id: 'cornell', label: { zh: '康奈尔笔记', en: 'Cornell Notes' }, description: { zh: '提示问题、正文笔记、底部总结，再写下一步。', en: 'Cue questions, notes, a summary, and a follow-up.' }, fields: [
        field('cue', '提示 / 问题', 'Cues / questions', '读完后用什么问题提醒自己？', 'What question would prompt recall?'),
        field('notes', '笔记 / 回答', 'Notes / answer', '用自己的话记录要点', 'Record the key ideas in your own words'),
        field('summary', '一句话总结', 'Summary', '这一页最重要的结论', 'The main takeaway'),
        field('followup', '延伸 / 行动', 'Follow-up / action', '接下来要验证或执行什么？', 'What will you verify or do next?'),
    ] },
    { id: 'onepage', label: { zh: '一页纸综合', en: 'One-page synthesis' }, description: { zh: '把核心结论、证据、例子、适用场景和行动压在一页。', en: 'Bring the takeaway, evidence, example, context, and action onto one page.' }, fields: [
        field('focus', '核心结论 / 概念', 'Core idea / concept', '这张卡最重要的一句话', 'The most important sentence'),
        field('evidence', '依据', 'Evidence', '支持它的依据', 'What supports it?'),
        field('example', '例子', 'Example', '一个具体例子', 'A concrete example'),
        field('context', '场景 / 边界', 'Context / boundary', '何时适用，何时不适用？', 'When does it apply or fail?'),
        field('application', '下一步应用', 'Next application', '可以做什么？', 'What can you do with this?'),
    ] },
    { id: 'zettel', label: { zh: '卢曼想法卡', en: 'Zettelkasten idea' }, description: { zh: '写出独立想法、推理、不同意见，再把它接入已有卡片。', en: 'State an idea, reason through it, challenge it, and connect it.' }, fields: [
        field('thesis', '核心想法', 'Core idea', '用自己的话写出一个想法', 'State one idea in your own words'),
        field('reasoning', '推理 / 依据', 'Reasoning / evidence', '为什么这样想？', 'Why do you think so?'),
        field('contrast', '反例 / 区别', 'Counterpoint / distinction', '与已有观点有何不同？', 'How does it differ from other ideas?'),
        field('application', '可延伸之处', 'Where it leads', '它启发了什么应用或下一步？', 'Where could this idea lead?'),
    ] },
];

const LEGACY_MAP: Record<Exclude<CardTemplateId, CurrentCardTemplateId>, CurrentCardTemplateId> = {
    concept: 'onepage', claim: 'zettel', question: 'cornell', action: 'onepage',
};

export function currentTemplateId(id?: CardTemplateId): CurrentCardTemplateId {
    if (!id) return 'excerpt';
    return id in LEGACY_MAP ? LEGACY_MAP[id as keyof typeof LEGACY_MAP] : id as CurrentCardTemplateId;
}

export function cardFieldsForTemplate(card: HighlightNote): Record<string, string> {
    const original = card.cardFields ?? {};
    switch (card.templateId) {
        case 'concept': return { ...original, focus: original.definition ?? '', context: original.boundary ?? '' };
        case 'claim': return { ...original, thesis: original.claim ?? '', reasoning: original.evidence ?? '', contrast: original.counterexample ?? '' };
        case 'question': return { ...original, cue: original.question ?? '', notes: original.answer ?? '', followup: original.verify ?? '' };
        case 'action': return { ...original, application: original.next ?? '' };
        default: return { ...original };
    }
}

export function cardLabel(label: TextLabel): string {
    return getLang() === 'zh' ? label.zh : label.en;
}

export function cardTemplate(card: HighlightNote): CardTemplateSpec {
    return CARD_TEMPLATES.find(spec => spec.id === currentTemplateId(card.templateId)) ?? CARD_TEMPLATES[0]!;
}

export function cardTitle(card: HighlightNote): string {
    return (card.title || card.text || '').trim();
}

export function cardDisplayTitle(card: HighlightNote, maxLength = 54): string {
    const title = cardTitle(card);
    return title.length > maxLength ? `${title.slice(0, maxLength).trimEnd()}…` : title;
}

export function cardRelationLabel(relation: string): string {
    const labels: Record<string, TextLabel> = {
        related: { zh: '相关', en: 'Related' },
        supports: { zh: '支持', en: 'Supports' },
        contradicts: { zh: '反驳 / 对照', en: 'Contradicts / contrasts' },
        extends: { zh: '延伸', en: 'Extends' },
        applies: { zh: '应用于', en: 'Applies to' },
        example_of: { zh: '举例说明', en: 'Example of' },
        based_on: { zh: '来源于', en: 'Based on' },
    };
    return labels[relation] ? cardLabel(labels[relation]) : relation;
}

/** Structured fields are presented alongside the legacy freeform note. */
export function cardPreviewMarkdown(card: HighlightNote): string {
    const values = cardFieldsForTemplate(card);
    const fields = cardTemplate(card).fields
        .map(spec => ({ label: cardLabel(spec.label), value: values[spec.id]?.trim() }))
        .filter(item => item.value)
        .map(item => `**${item.label}**: ${item.value}`);
    return [...fields, card.note?.trim()].filter(Boolean).join('\n\n');
}

export function cardSearchText(card: HighlightNote): string {
    return [cardTitle(card), card.text, card.note, ...(card.tags ?? []),
        ...Object.values(card.cardFields ?? {})].filter(Boolean).join(' ').toLowerCase();
}

export function linkCards(card: HighlightNote, targetId: string, relation: string): HighlightNote {
    const target = targetId.trim();
    if (!target || target === card.id) return card;
    const links = [...(card.links ?? []).filter(link => link.targetId !== target),
        { targetId: target, relation: relation.trim() }];
    return { ...card, links, updatedAt: Date.now() };
}

export function unlinkCards(card: HighlightNote, targetId: string): HighlightNote {
    return { ...card, links: (card.links ?? []).filter(link => link.targetId !== targetId), updatedAt: Date.now() };
}

export function incomingLinks(cards: readonly HighlightNote[], targetId: string): HighlightNote[] {
    return cards.filter(card => (card.links ?? []).some(link => link.targetId === targetId));
}

export function relatedCandidates(card: HighlightNote, cards: readonly HighlightNote[]): HighlightNote[] {
    const tags = new Set(card.tags ?? []);
    return cards
        .filter(candidate => candidate.id !== card.id && !(card.links ?? []).some(link => link.targetId === candidate.id))
        .map(candidate => ({
            candidate,
            score: (card.sourcePath && candidate.sourcePath === card.sourcePath ? 2 : 0)
                + (candidate.tags ?? []).filter(tag => tags.has(tag)).length * 3,
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || b.candidate.createdAt - a.candidate.createdAt)
        .slice(0, 5)
        .map(item => item.candidate);
}

/** Stable IDs keep exported relationship information usable after file renames. */
export function cardRelationMarkdown(card: HighlightNote, cards: readonly HighlightNote[]): string {
    const lines = [`- ${getLang() === 'zh' ? '卡片 ID' : 'Card ID'}: \`${card.id}\``];
    const sources = (card.sourceHighlightIds ?? []).map(id => cards.find(item => item.id === id))
        .filter((item): item is HighlightNote => item != null);
    if (sources.length) {
        lines.push(`- ${getLang() === 'zh' ? '来源卡片' : 'Source cards'}: ${sources.map(item => `${cardTitle(item)} (\`${item.id}\`)`).join('；')}`);
    }
    if (card.links?.length) {
        const related = card.links.map(link => {
            const target = cards.find(item => item.id === link.targetId);
            return `${cardRelationLabel(link.relation) || (getLang() === 'zh' ? '相关' : 'Related')} → ${target ? cardTitle(target) : link.targetId} (\`${link.targetId}\`)`;
        });
        lines.push(`- ${getLang() === 'zh' ? '关联卡片' : 'Linked cards'}: ${related.join('；')}`);
    }
    return lines.join('\n');
}
