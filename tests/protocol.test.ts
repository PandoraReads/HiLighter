import { describe, it, expect, vi } from 'vitest';
import { handleProtocolOp } from '../src/protocol';

function spyActions() {
    return {
        syncImport: vi.fn(),
        syncExport: vi.fn(),
        sync: vi.fn(),
        openStudio: vi.fn(),
        openView: vi.fn(),
        notice: vi.fn(),
    };
}

describe('handleProtocolOp', () => {
    it.each([
        ['sync-import', 'syncImport'],
        ['sync-export', 'syncExport'],
        ['sync', 'sync'],
        ['open-studio', 'openStudio'],
    ] as const)('routes op=%s to %s', (op, method) => {
        const a = spyActions();
        handleProtocolOp({ op }, a);
        expect(a[method]).toHaveBeenCalledTimes(1);
        expect(a.notice).not.toHaveBeenCalled();
    });

    it('routes open-view with view and side params', () => {
        const a = spyActions();
        handleProtocolOp({ op: 'open-view', view: 'hilighter-highlight-view', side: 'right' }, a);
        expect(a.openView).toHaveBeenCalledWith('hilighter-highlight-view', 'right');
    });

    it('notices on a missing op', () => {
        const a = spyActions();
        handleProtocolOp({}, a);
        handleProtocolOp({ op: '' }, a);
        handleProtocolOp({ op: 'true' }, a);
        expect(a.notice).toHaveBeenCalledTimes(3);
        expect(a.syncImport).not.toHaveBeenCalled();
    });

    it('notices on an unknown op', () => {
        const a = spyActions();
        handleProtocolOp({ op: 'bogus' }, a);
        expect(a.notice).toHaveBeenCalledTimes(1);
        expect(a.sync).not.toHaveBeenCalled();
    });

    it('ignores path and file params', () => {
        const a = spyActions();
        handleProtocolOp({ op: 'sync-import', path: '../../evil.md', file: 'x' }, a);
        expect(a.syncImport).toHaveBeenCalledTimes(1);
        // Nothing else received the path/file values.
        expect(a.openView).not.toHaveBeenCalled();
        expect(a.syncExport).not.toHaveBeenCalled();
    });

    it('does not let a throwing action escape', () => {
        const a = spyActions();
        a.openStudio.mockImplementation(() => { throw new Error('boom'); });
        expect(() => handleProtocolOp({ op: 'open-studio' }, a)).not.toThrow();
        expect(a.notice).toHaveBeenCalledTimes(1);
    });
});
