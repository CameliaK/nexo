export const LOGIN_CONTINUATION_KEY = 'nexo.login.continue';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Survives Google's redirect and an email opened in a new tab; expires soon. */
export class LoginContinuation {
  private pendingUntil = 0;
  constructor(private storage?: StorageLike, private now = Date.now) {}
  requestChess() {
    this.pendingUntil = this.now() + 15 * 60 * 1000;
    try { this.storage?.setItem(LOGIN_CONTINUATION_KEY, JSON.stringify({ target: 'chess', expires: this.now() + 15 * 60 * 1000 })); } catch { /* In-memory fallback. */ }
  }
  takeChess() {
    let pending = this.pendingUntil > this.now(); this.pendingUntil = 0;
    try { const saved = JSON.parse(this.storage?.getItem(LOGIN_CONTINUATION_KEY) || 'null'); this.storage?.removeItem(LOGIN_CONTINUATION_KEY); pending ||= saved?.target === 'chess' && saved.expires > this.now(); } catch { /* In-memory fallback. */ }
    return pending;
  }
}
