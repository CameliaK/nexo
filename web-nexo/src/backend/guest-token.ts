import { BackendError, type GuestTokenResponse } from './types';
import { t } from '../i18n';

export const GUEST_TOKEN_KEY = 'nexo.guest.session';
export const GUEST_RETRY_KEY = 'nexo.guest.retryAt';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SavedGuest = { token: string; visitorId: string; expiresAt: number | null };
function browserStorage() { try { return localStorage; } catch { return undefined; } }
export function retryAfterMs(header: string | null, now = Date.now(), fallback = 30000) {
  const value = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - now : NaN;
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
function expiry(value: GuestTokenResponse['expires_at']): number | null {
  if (value == null) return null;
  const date = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

/** Opaque credential, bound to a visitor. No token decoding or logging. */
export class GuestTokens {
  private saved: SavedGuest | null = null;
  private pending: Promise<string> | null = null;
  private visitorId: string | null = null;
  private generation = 0;
  private retryAt = 0;
  constructor(private storage: StorageLike | undefined = browserStorage(), private now = () => Date.now()) {}
  get retryUntil() {
    try { const saved=Number(this.storage?.getItem(GUEST_RETRY_KEY));if(Number.isFinite(saved))this.retryAt=Math.max(this.retryAt,saved); } catch { /* Memory fallback. */ }
    return this.retryAt;
  }
  clear() {
    ++this.generation; this.saved = null; this.pending = null; this.visitorId = null;
    try { this.storage?.removeItem(GUEST_TOKEN_KEY); } catch { /* Memory fallback. */ }
    // A guest limit applies to the IP, even after a change of identity.
  }
  invalidate(token: string) { if (this.saved?.token === token) this.clear(); }
  get(visitorId: string): Promise<string> {
    if (this.visitorId !== visitorId) {
      ++this.generation; this.pending = null; this.saved = null; this.visitorId = visitorId;
      try {
        const saved = JSON.parse(this.storage?.getItem(GUEST_TOKEN_KEY) || 'null');
        if (saved?.visitorId === visitorId && typeof saved.token === 'string' && saved.token && (saved.expiresAt === null || Number.isFinite(saved.expiresAt))) this.saved = saved;
        else this.storage?.removeItem(GUEST_TOKEN_KEY);
      } catch { /* Memory fallback. */ }
    }
    if (this.saved && (this.saved.expiresAt === null || this.saved.expiresAt > this.now())) return Promise.resolve(this.saved.token);
    if (this.saved) this.invalidate(this.saved.token);
    this.visitorId = visitorId;
    if (this.pending) return this.pending;
    if (this.retryUntil > this.now()) return Promise.reject(this.rateError());
    const generation = this.generation;
    const pending = this.request(visitorId, generation);
    this.pending = pending;
    void pending.then(() => { if (this.pending === pending) this.pending = null; }, () => { if (this.pending === pending) this.pending = null; });
    return pending;
  }
  private rateError() { return new BackendError('rate_limited', t('connection.retrying'), 429, Math.ceil((this.retryUntil - this.now()) / 1000)); }
  private async request(visitorId: string, generation: number) {
    const res = await fetch('/auth/guest', { headers: { 'X-Visitor-Id': visitorId } });
    if (res.status === 429) {
      this.retryAt = this.now() + retryAfterMs(res.headers.get('Retry-After'), this.now());
      try { this.storage?.setItem(GUEST_RETRY_KEY, String(this.retryAt)); } catch { /* Memory fallback. */ }
      throw this.rateError();
    }
    if (!res.ok) throw new BackendError('internal', t('error.auth'), res.status);
    const data = await res.json() as GuestTokenResponse;
    if (generation !== this.generation || visitorId !== this.visitorId) throw new BackendError('internal', t('error.offline'), 503);
    if (typeof data.token !== 'string' || !data.token) throw new BackendError('internal', t('error.auth'), 503);
    const expiresAt=expiry(data.expires_at);
    if(expiresAt!==null&&expiresAt<=this.now())throw new BackendError('internal',t('error.auth'),503);
    this.saved = { token: data.token, visitorId, expiresAt };
    try { this.storage?.setItem(GUEST_TOKEN_KEY, JSON.stringify(this.saved)); } catch { /* Memory fallback. */ }
    return data.token;
  }
}
