import { BackendError, type PortfolioBackend } from '../backend/types';
import { languageStore } from '../i18n';
export type AccessRoute = { kind: 'login' | 'confirm' | 'done' | 'unsubscribe'; credential: string };
export function accessRoute(hash: string): AccessRoute | null {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  if (path === '/login/confirm') return { kind: 'confirm', credential: params.get('t') || '' };
  if (path === '/login/done') return { kind: 'done', credential: params.get('code') || '' };
  if (path === '/unsubscribe' || path === '/auth/unsubscribe') return { kind: 'unsubscribe', credential: params.get('t') || params.get('token') || '' };
  return null;
}
/** Reading a confirmation URL never consumes its token. */
export class AccessState {
  route: AccessRoute = { kind: 'login', credential: '' };
  status: 'idle' | 'sending' | 'sent' | 'success' | 'error' = 'idle';
  email = '';
  error: unknown = null;
  waitUntil = 0;
  private revision = 0;
  constructor(private backend: PortfolioBackend, private changed: () => void, private signedIn: () => Promise<void>, private now = Date.now) {}
  get remaining() { return Math.max(0, Math.ceil((this.waitUntil - this.now()) / 1000)); }
  navigate(route: AccessRoute) { ++this.revision; this.route = route; this.status = 'idle'; this.error = null; this.changed(); if (route.kind === 'done') void this.confirm(); }
  private async work(fn: () => Promise<unknown>, login: boolean, sent = false) {
    if (this.status === 'sending') return;
    const revision = this.revision; this.status = 'sending'; this.error = null; this.changed();
    try {
      await fn(); if (revision !== this.revision) return;
      if (login) await this.signedIn();
      if (revision !== this.revision) return;
      this.status = sent ? 'sent' : 'success'; if (sent) this.waitUntil = this.now() + 30000;
    } catch (error) {
      if (revision !== this.revision) return;
      this.error = error; this.status = 'error';
      if (error instanceof BackendError && error.status === 429) this.waitUntil = this.now() + Math.max(1, error.retryAfterSec || 30) * 1000;
    }
    this.changed();
  }
  async send(email: string) {
    if (this.remaining || this.status === 'sending') return;
    this.email = email.trim(); await this.work(() => this.backend.requestEmailLogin(this.email, languageStore.language), false, true);
  }
  async confirm() {
    const { kind, credential } = this.route;
    if (!credential) { this.error = new BackendError('unauthorized', '', 401); this.status = 'error'; this.changed(); return; }
    if (kind === 'unsubscribe') return this.work(() => this.backend.unsubscribe(credential), false);
    if (kind === 'confirm') return this.work(() => this.backend.verifyEmailLogin(credential), true);
    if (kind === 'done') return this.work(() => this.backend.exchangeCode(credential), true);
  }
  async google() { await this.work(() => this.backend.startGoogleLogin(), false); }
  dispose() { ++this.revision; }
}
