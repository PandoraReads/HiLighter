import type { HighlightNote } from '../models';

export function sourceKind(note: HighlightNote): 'pdf' | 'epub' | 'markdown' {
    const path = note.sourcePath.toLowerCase();
    if (path.endsWith('.pdf')) return 'pdf';
    if (note.anchorType === 'epub' || path.endsWith('.epub')) return 'epub';
    return 'markdown';
}
