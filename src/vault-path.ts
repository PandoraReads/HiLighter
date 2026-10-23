/** Validates and normalizes a vault-relative folder path. */
export function normalizeVaultFolder(folder: string): string {
    const normalized = folder.trim().replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error('Folder must be vault-relative');
    }
    const segments = normalized.split('/').filter(Boolean);
    if (segments.some(segment => segment === '.' || segment === '..')) {
        throw new Error('Folder cannot contain traversal segments');
    }
    return segments.join('/');
}
