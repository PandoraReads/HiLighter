// ============================================================
// HiLighter - crypto polyfill (randomUUID for plugin ids)
// ============================================================

import { Platform } from 'obsidian';

interface NodeCryptoLike {
    randomUUID?(): string;
    getRandomValues?(arr: Uint8Array): Uint8Array;
}

/** Node crypto loaded via Electron's require, when available. */
let nodeCrypto: NodeCryptoLike | null = null;
try {
    if (Platform.isDesktop) {
        const req = (window as unknown as { require?: (m: string) => unknown }).require;
        nodeCrypto = req ? (req('crypto') as NodeCryptoLike) : null;
    }
} catch {
    // Silent fail: fallbacks below cover it
}

export const randomUUID = (): string => {
    // 1. Modern browser API
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    // 2. Node.js crypto (desktop)
    if (nodeCrypto?.randomUUID) {
        return nodeCrypto.randomUUID();
    }

    // 3. Mathematical fallback (for older browsers/environments)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

export const getRandomValues = (arr: Uint8Array): Uint8Array => {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        return window.crypto.getRandomValues(arr);
    }
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
        return globalThis.crypto.getRandomValues(arr);
    }
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
};

export default nodeCrypto || {
    randomUUID,
    getRandomValues
};
