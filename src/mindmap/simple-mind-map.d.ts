// simple-mind-map ships no TypeScript declarations; the feature only
// touches it through src/mindmap/engine.ts, so a minimal `any` surface
// keeps tsc happy without mirroring the whole library API.

// simple-mind-map ships no TypeScript declarations; the feature only
// touches it through src/mindmap/engine.ts, so a minimal `any` surface
// keeps tsc happy without mirroring the whole library API.
// (Excluded from eslint: ambient shims for an untyped dependency.)
declare module 'simple-mind-map' {
    const MindMap: any;
    export default MindMap;
}
declare module 'simple-mind-map/src/plugins/Drag.js' {
    const plugin: any;
    export default plugin;
}
declare module 'simple-mind-map/src/plugins/AssociativeLine.js' {
    const plugin: any;
    export default plugin;
}
declare module 'simple-mind-map/src/plugins/Export.js' {
    const plugin: any;
    export default plugin;
}
declare module 'simple-mind-map/src/plugins/ExportXMind.js' {
    const plugin: any;
    export default plugin;
}
declare module 'simple-mind-map/src/plugins/RainbowLines.js' {
    const plugin: any;
    export default plugin;
}
declare module 'simple-mind-map/src/plugins/Select.js' {
    const plugin: any;
    export default plugin;
}
declare module 'simple-mind-map/src/parse/xmind' {
    const xmindParse: {
        parseXmindFile(file: ArrayBuffer | Uint8Array | Blob, handleMultiCanvas?: unknown): Promise<unknown>;
        transformXmind(content: string, files: unknown, handleMultiCanvas?: unknown): Promise<unknown>;
        transformOldXmind(content: string): unknown;
        transformToXmind(data: unknown, name: string): Promise<unknown>;
    };
    export default xmindParse;
}
