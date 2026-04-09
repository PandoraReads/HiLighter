// ============================================================
// HiLighter - Data Models
// ============================================================

/**
 * Plugin settings stored in data.json
 */
export interface EMESettings {
    // AI Integration
    aiProvider: 'deepseek' | 'gemini' | 'ark' | 'custom';
    deepseekApiKey: string;
    geminiApiKey: string;
    geminiModel: string;
    arkApiKey: string;
    customApiKey: string;
    customApiUrl: string;
    customModel: string;
    researchPrompt: string;
    // UI
    ribbonHighlightIcon: boolean;
    deviceId: string;
}

export const DEFAULT_SETTINGS: EMESettings = {
    aiProvider: 'deepseek',
    deepseekApiKey: '',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    arkApiKey: '',
    customApiKey: '',
    customApiUrl: '',
    customModel: '',
    researchPrompt: '',
    ribbonHighlightIcon: true,
    deviceId: '',
};

/**
 * Highlight Note entry stored in IndexedDB
 */
export interface HighlightNote {
    id: string;              // UUID v4
    text: string;            // The highlighted text
    color: 'yellow' | 'pink' | 'blue' | 'green';
    note: string;            // User's personal note + AI results
    sourcePath: string;      // Vault-relative path to the source note
    lineIndex: number;       // Line index for quick jumping
    createdAt: number;       // Unix timestamp (ms)
    tags?: string[];         // User tags
}
