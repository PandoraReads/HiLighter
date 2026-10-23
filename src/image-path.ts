/** Validates and normalizes a vault-relative folder for note image attachments. */
export function normalizeImageFolder(folder: string): string {
    const normalized = folder.trim().replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error('Image folder must be vault-relative');
    }
    const segments = normalized.split('/').filter(Boolean);
    if (segments.some(segment => segment === '.' || segment === '..')) {
        throw new Error('Image folder cannot contain traversal segments');
    }
    return segments.join('/');
}
