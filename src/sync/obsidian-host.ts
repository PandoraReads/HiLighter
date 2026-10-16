// ============================================================
// HiLighter - Obsidian host adapter for the sync controller
// ============================================================

import { Notice, type App, type EventRef } from 'obsidian';
import { getDb } from '../db';
import { randomUUID } from '../mocks/crypto';
import type { HiLighterSettings } from '../models';
import type { SyncAdapter, SyncControllerDeps, SyncTimers } from './controller';

export interface SyncHostPlugin {
    app: App;
    settings: HiLighterSettings;
    refreshViews(): void;
    registerInterval(id: number): number;
    registerEvent(ref: EventRef): void;
    register(cb: () => void): void;
}

/** Build the sync controller's dependencies from the Obsidian plugin. */
export function createSyncHost(plugin: SyncHostPlugin): SyncControllerDeps {
    const adapter = plugin.app.vault.adapter as unknown as SyncAdapter;

    const onVisibility = (state: 'visible' | 'hidden', cb: () => void): (() => void) => {
        const onFocus = () => { if (state === 'visible') cb(); };
        const onVisibilityChange = () => {
            const visible = document.visibilityState === 'visible';
            if (state === 'visible' && visible) cb();
            if (state === 'hidden' && !visible) cb();
        };
        const onPageHide = () => { if (state === 'hidden') cb(); };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', onPageHide);

        const cleanup = () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', onPageHide);
        };
        plugin.register(cleanup);
        return cleanup;
    };

    const timers: SyncTimers = {
        every: (ms, cb) => {
            const id = plugin.registerInterval(window.setInterval(cb, ms));
            return () => window.clearInterval(id);
        },
        after: (ms, cb) => {
            const id = window.setTimeout(cb, ms);
            plugin.register(() => window.clearTimeout(id));
            return () => window.clearTimeout(id);
        },
        now: () => Date.now(),
        onForeground: (cb) => onVisibility('visible', cb),
        onBackground: (cb) => onVisibility('hidden', cb),
    };

    return {
        getSettings: () => plugin.settings,
        writerId: randomUUID(),
        adapter,
        timers,
        notice: (message) => new Notice(message),
        refreshViews: () => plugin.refreshViews(),
        db: getDb(),
        onVaultModify: (cb) => {
            const ref = plugin.app.vault.on('modify', (file) => cb(file.path));
            plugin.registerEvent(ref);
            return () => plugin.app.vault.offref(ref);
        },
        onQuit: (cb) => {
            const ref = plugin.app.workspace.on('quit', (tasks) => {
                cb((promise) => tasks.addPromise(promise));
            });
            plugin.registerEvent(ref);
            return () => plugin.app.workspace.offref(ref);
        },
    };
}
