import { AUTH_TOKEN_KEY } from './identity';
import type { AuthMe, AuthToken, Notifications, ChessGame, OwnerChessGame } from './types';
import { t } from '../i18n';
import { BackendError, isBackendEvent } from './types';
import type {
  PortfolioBackend,
  BackendEvent,
  ConnectionState,
  ChatAccepted,
  ChatRequest,
  LiveSendAccepted,
  LiveHistoryResponse,
  GeneratedNode,
  GuestTokenResponse,
  SessionNodesResponse,
  ApiErrorBody,
  ErrorCode,
} from './types';

const VISITOR_ID_KEY = 'nexo.visitor_id';
// Esperas de reconexión (ms): 1 s, 2 s, 4 s, 8 s, se satura en 15 s
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000] as const;

export class RealBackend implements PortfolioBackend {
  private token: string | null = null;
  private visitorId: string | null = null;
  private ws: WebSocket | null = null;
  private events = new Set<(event: BackendEvent) => void>();
  private connections = new Set<(state: ConnectionState) => void>();
  private state: ConnectionState = 'closed';
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor() {
    try { this.token = localStorage.getItem(AUTH_TOKEN_KEY); this.authenticatedToken = !!this.token; } catch { /* Ephemeral session. */ }
  }
  private authenticatedToken = false;
  private sessionGeneration = 0;
  async authMe(): Promise<AuthMe> {
    try { return await this._request('GET', '/api/v1/auth/me') as AuthMe; }
    catch(error){if(error instanceof BackendError&&error.status===401){await this.clearIdentity();return {mode:'guest'}}throw error}
  }
  async requestEmailLogin(email: string, lang: 'es' | 'en') { await this._request('POST', '/auth/email/request', { email, lang }, false, true); }
  async verifyEmailLogin(token: string) { return this.signIn('/auth/email/verify', { token }); }
  async startGoogleLogin() { location.assign('/auth/google/login'); }
  async exchangeCode(code: string) { return this.signIn('/auth/exchange', { code }); }
  async unsubscribe(token: string) { await this._request('POST', '/auth/unsubscribe', { token }, false, true); }
  async logout() { await this._request('POST', '/auth/logout'); await this.clearIdentity(); }
  async deleteAccount() { await this._request('DELETE', '/api/v1/account'); await this.clearIdentity(); }
  async getNotifications() { return await this._request('GET', '/api/v1/account/notifications') as Notifications; }
  async setNotifications(settings: Notifications) { return await this._request('PUT', '/api/v1/account/notifications', settings) as Notifications; }
  private async gameRequest(method: string, path: string, body?: unknown): Promise<ChessGame | null> {
    const result = await this._request(method, path, body) as ChessGame | { game: ChessGame | null } | null;
    return ((result && 'game' in result ? result.game : result) || null) as ChessGame | null;
  }
  async chessGetGame() { return this.gameRequest('GET', '/api/v1/chess/game'); }
  async chessNewGame(color: ChessGame['color']) { return (await this.gameRequest('POST', '/api/v1/chess/game', { color }))!; }
  async chessMove(uci: string) { return (await this.gameRequest('POST', '/api/v1/chess/game/move', { uci }))!; }
  async chessResign() { return (await this.gameRequest('POST', '/api/v1/chess/game/resign'))!; }
  async ownerChessGames() { return (await this._request('GET', '/api/v1/owner/chess/games') as { games: OwnerChessGame[] }).games; }
  async ownerChessMove(id: string, uci: string) { return (await this.gameRequest('POST', `/api/v1/owner/chess/games/${encodeURIComponent(id)}/move`, { uci })) as OwnerChessGame; }
  async ownerChessResign(id: string) { return (await this.gameRequest('POST', `/api/v1/owner/chess/games/${encodeURIComponent(id)}/resign`)) as OwnerChessGame; }
  /**
   * verify/exchange carry the current guest token as Bearer: it is the only way the gateway
   * learns which anonymous id becomes canonical on a first sign-in (its data then follows the
   * account). The guest token lives only in memory, so after the Google redirect or in a new
   * tab it is gone; a fresh one is requested for the stored visitor id. A signed-in browser
   * sends none. If /auth/guest fails, sign-in still proceeds without it.
   */
  private async signIn(path: string, body: unknown) {
    let guest: string | null = null;
    if (!this.authenticatedToken) { try { guest = await this.fetchToken(); } catch { /* Sign-in without anonymous data. */ } }
    return this.adopt(await this._request('POST', path, body, false, true, guest) as AuthToken);
  }
  /** The token is opaque (PASETO v4.local): the canonical id comes only from the body. */
  private async adopt(result: AuthToken) {
    this.disconnect(); this.token = result.token; this.authenticatedToken = true;
    const id = result.visitor_id;
    if (id) this.visitorId = id;
    try { localStorage.setItem(AUTH_TOKEN_KEY, result.token); if (id) localStorage.setItem(VISITOR_ID_KEY, id); } catch { /* Ephemeral identity. */ }
    // HTTP login succeeded even if realtime is temporarily unavailable.
    void this.connect().catch(() => this.scheduleReconnect());
    return result;
  }
  private async clearIdentity() {
    this.disconnect(); this.token = null; this.authenticatedToken = false; this.visitorId = crypto.randomUUID();
    try { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.setItem(VISITOR_ID_KEY, this.visitorId); } catch { /* Ephemeral identity. */ }
    void this.connect().catch(() => this.scheduleReconnect());
  }

  // ── PortfolioBackend pública ───────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.state === 'open' || this.state === 'connecting') return;
    this.intentionalClose = false;
    await this._openConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.sessionGeneration++;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000);
    this.ws = null;
    this.change('closed');
  }

  onEvent(handler: (event: BackendEvent) => void): () => void {
    this.events.add(handler);
    return () => { this.events.delete(handler); };
  }

  onConnectionChange(handler: (state: ConnectionState) => void): () => void {
    this.connections.add(handler);
    handler(this.state);
    return () => { this.connections.delete(handler); };
  }

  async sendMessage(message: string, lang?: ChatRequest['lang']): Promise<ChatAccepted> {
    return this._request('POST', '/api/v1/chat', { message, ...(lang ? { lang } : {}) }) as Promise<ChatAccepted>;
  }

  async sendLiveMessage(text: string, name?: string): Promise<LiveSendAccepted> {
    return this._request('POST', '/api/v1/live/messages', { text, ...(name ? { name } : {}) }) as Promise<LiveSendAccepted>;
  }

  async listLiveMessages(): Promise<LiveHistoryResponse> {
    return this._request('GET', '/api/v1/live/messages') as Promise<LiveHistoryResponse>;
  }

  async listGeneratedNodes(): Promise<GeneratedNode[]> {
    const body = await this._request('GET', '/api/v1/session/nodes') as SessionNodesResponse;
    return body.nodes;
  }

  async deleteGeneratedNode(id: string): Promise<void> {
    try {
      await this._request('DELETE', `/api/v1/session/nodes/${encodeURIComponent(id)}`);
    } catch (err) {
      // 404 significa que el nodo ya no existe — no es un error para la UI.
      if (err instanceof BackendError && err.status === 404) return;
      throw err;
    }
  }

  // ── Privado ───────────────────────────────────────────────────────────────

  private change(state: ConnectionState): void {
    this.state = state;
    this.connections.forEach(h => h(state));
  }

  private getOrCreateVisitorId(): string {
    try {
      let id = localStorage.getItem(VISITOR_ID_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(VISITOR_ID_KEY, id);
      }
      return id;
    } catch {
      // localStorage no disponible (modo privado): id efímero para esta sesión.
      if (!this.visitorId) this.visitorId = crypto.randomUUID();
      return this.visitorId;
    }
  }

  private async fetchToken(): Promise<string> {
    const visitorId = this.getOrCreateVisitorId();
    this.visitorId = visitorId;
    const res = await fetch('/auth/guest', {
      headers: { 'X-Visitor-Id': visitorId },
    });
    if (!res.ok) {
      throw new BackendError('internal', t('error.auth'), res.status);
    }
    const data = await res.json() as GuestTokenResponse;
    return data.token;
  }

  private async _openConnection(): Promise<void> {
    const generation = this.sessionGeneration;
    this.change('connecting');
    try {
      if (!this.token || !this.authenticatedToken) { const token = await this.fetchToken(); if (generation !== this.sessionGeneration) return; this.token = token; }
    } catch (err) {
      if(generation!==this.sessionGeneration)return;
      this.change('closed');
      throw err;
    }
    if (generation === this.sessionGeneration) await this._openWebSocket();
  }

  private _openWebSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${location.host}/ws?token=${encodeURIComponent(this.token!)}`,
      );
      this.ws = ws;
      let opened = false;

      ws.onopen = () => {
        if (this.ws !== ws) { ws.close(); resolve(); return; }
        opened = true;
        this.reconnectAttempt = 0;
        this.change('open');
        resolve();
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        if (this.ws !== ws) return;
        try {
          const msg: unknown = JSON.parse(ev.data);
          if (isBackendEvent(msg)) this.events.forEach(h => h(msg));
        } catch { /* Ignora mensajes malformados. */ }
      };

      ws.onclose = () => {
        if (this.ws !== ws) { if (!opened) resolve(); return; }
        this.ws = null;
        if (!opened) reject(new BackendError('internal', t('error.connection'), 503));
        if (this.intentionalClose) { this.change('closed'); return; }
        this.scheduleReconnect();
      };

      ws.onerror = () => { /* Siempre seguido de onclose — no hay que hacer nada aquí. */ };
    });
  }

  private scheduleReconnect(): void {
    this.change('reconnecting');
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;
      try {
        await this._openConnection();
      } catch { /* El onclose del siguiente intento programará el próximo retry. */ }
    }, delay);
  }

  private async _request(
    method: string,
    path: string,
    body?: unknown,
    retry = true,
    publicRequest = false,
    guestBearer: string | null = null,
  ): Promise<unknown> {
    if (!this.token && !publicRequest) throw new BackendError('internal', t('error.offline'), 503);

    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!publicRequest && this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
        ...(publicRequest && guestBearer ? { 'Authorization': `Bearer ${guestBearer}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let code: ErrorCode = 'internal';
      let message = t('error.unexpected');
      let retryAfterSec: number | undefined;
      try {
        const errBody = await res.json() as ApiErrorBody;
        code = errBody.error.code;
        message = errBody.error.message;
      } catch { /* La respuesta puede no ser JSON en errores de infraestructura. */ }
      if (res.status === 401 && code === 'unauthorized' && retry && !this.authenticatedToken && !publicRequest) {
        this.token = await this.fetchToken();
        return this._request(method, path, body, false);
      }
      if (res.status === 429) {
        const header = res.headers.get('Retry-After');
        if (header) retryAfterSec = /^\d+$/.test(header) ? Number(header) : Math.max(0, Math.ceil((Date.parse(header) - Date.now()) / 1000));
      }
      throw new BackendError(code, message, res.status, retryAfterSec);
    }

    // 202 can carry a body (chat and live: { run_id, ... }) or none (/auth/email/request).
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
}
