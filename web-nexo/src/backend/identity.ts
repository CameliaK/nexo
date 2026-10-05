/** Claims namespace local storage only. Permissions always come from authMe. */
export function canonicalVisitorId(token: string): string | null {
  try {
    const parts = token.split('.');
    // Signed PASETO public tokens have a readable JSON payload followed by a
    // 64-byte signature. Encrypted local tokens intentionally remain opaque.
    const publicPaseto = /^v[24]$/.test(parts[0]) && parts[1] === 'public';
    if (/^v\d$/.test(parts[0]) && !publicPaseto) return null;
    const raw = publicPaseto ? parts[2] : parts[1];
    const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(publicPaseto ? bytes.slice(0, -64) : bytes));
    const id = claims.visitor_id || claims.sub;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch { return null; }
}
export const AUTH_TOKEN_KEY = 'nexo.auth.token';
