// ============================================================
// HiLighter - obsidian://hilighter protocol dispatcher (pure)
// ============================================================

import { t } from './i18n';

/** Structurally compatible with ObsidianProtocolData (values are strings). */
export type ProtocolParams = Record<string, string | undefined>;

export interface ProtocolActions {
    syncImport(): void;
    syncExport(): void;
    sync(): void;
    openStudio(): void;
    openView(view?: string, side?: string): void;
    notice(message: string): void;
}

const OPS: Record<string, (a: ProtocolActions, p: ProtocolParams) => void> = {
    'sync-import': (a) => a.syncImport(),
    'sync-export': (a) => a.syncExport(),
    'sync': (a) => a.sync(),
    'open-studio': (a) => a.openStudio(),
    'open-view': (a, p) => a.openView(p.view, p.side),
};

/**
 * Handle an `obsidian://hilighter?op=...` URL. `params.op` selects the action;
 * any `path`/`file` params are deliberately ignored so a remote link can never
 * drive reads/writes to an arbitrary vault file.
 */
export function handleProtocolOp(params: ProtocolParams, actions: ProtocolActions): void {
    const op = params.op;
    if (op == null || op === '' || op === 'true') {
        safe(actions, () => actions.notice(t('protocol.missingOp')));
        return;
    }

    const handler = OPS[op];
    if (!handler) {
        safe(actions, () => actions.notice(t('protocol.unknownOp', { op })));
        return;
    }

    safe(actions, () => handler(actions, params));
}

function safe(actions: ProtocolActions, fn: () => void): void {
    try {
        fn();
    } catch (e) {
        actions.notice(t('sync.auto.error', { message: String(e) }));
    }
}
