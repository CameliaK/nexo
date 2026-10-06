import { GuestTokens, retryAfterMs } from './guest-token';
import { clearLocalSession, AUTH_TOKEN_KEY } from './identity';
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
  SessionNodesResponse,
  ApiErrorBody,
  ErrorCode,
} from './types';

const VISITOR_ID_KEY = 'nexo.visitor_id';
// Esperas de reconexión (ms): 1 s, 2 s, 4 s, 8 s, se satura en 15 s
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000] as const;

export class RealBackend implements PortfolioBackend {
  private token: string | null = null;
  private guestTokens = new GuestTokens();
  private connecting: Promise<void> | null = null;
  private visitorId: string | null = null;
  private ws: WebSocket | null = null;
  private events = new Set<(event: BackendEvent) => void>();
  private connections = new Set<(state: ConnectionState) => void>();
  private state: ConnectionState = 'closed';
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private ticketRetryAt = 0;

  constructor() {
    try { this.token = localStorage.getItem(AUTH_TOKEN_KEY); this.authenticatedToken = !!this.token;if(this.authenticatedToken)this.guestTokens.clear(); } catch { /* Ephemeral session. */ }
  }
  private authenticatedToken = false;
  private sessionGeneration = 0;
  async authMe(): Promise<AuthMe> {
    const wasAccount=this.authenticatedToken,generation=this.sessionGeneration;
    try { return await this._request('GET', '/api/v1/auth/me') as AuthMe; }
    catch(error){if(error instanceof BackendError&&error.status===401&&wasAccount&&generation===this.sessionGeneration){await this.clearIdentity();return {mode:'guest'}}throw error}
  }
  async requestEmailLogin(email: string, lang: 'es' | 'en') { await this._request('POST', '/auth/email/request', { email, lang }, false, true); }
  async verifyEmailLogin(token: string) { return this.signIn('/auth/email/verify', { token }); }
  async startGoogleLogin() { location.assign('/auth/google/login'); }
  async exchangeCode(code: string) { return this.signIn('/auth/exchange', { code }); }
  async unsubscribe(token: string) { await this._request('POST', '/auth/unsubscribe', { token }, false, true); }
  async logout() { await this._request('POST', '/auth/logout'); await this.clearIdentity(); }
  async deleteSessionData() {
    await this._request('DELETE', '/api/v1/session/data');
    this.disconnect(); this.guestTokens.clear(); this.token = null; this.authenticatedToken = false; this.visitorId = null;
    clearLocalSession();
  }
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
   * account). The persisted guest token is reused after redirects and reloads. A signed-in browser
   * sends none. If /auth/guest fails, sign-in still proceeds without it.
   */
  private async signIn(path: string, body: unknown) {
    let guest: string | null = null;
    if (!this.authenticatedToken) { try { guest = await this.fetchToken(); } catch { /* Sign-in without anonymous data. */ } }
    return this.adopt(await this._request('POST', path, body, false, true, guest) as AuthToken);
  }
  /** The token is opaque (PASETO v4.local): the canonical id comes only from the body. */
  private async adopt(result: AuthToken) {
    this.disconnect(); this.guestTokens.clear();this.token = result.token; this.authenticatedToken = true;
    const id = result.visitor_id;
    if (id) this.visitorId = id;
    try { localStorage.setItem(AUTH_TOKEN_KEY, result.token); if (id) localStorage.setItem(VISITOR_ID_KEY, id); } catch { /* Ephemeral identity. */ }
    // HTTP login succeeded even if realtime is temporarily unavailable.
    void this.connect().catch(() => {});
    return result;
  }
  private async clearIdentity() {
    this.disconnect(); this.guestTokens.clear();this.token = null; this.authenticatedToken = false; this.visitorId = crypto.randomUUID();
    try { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.setItem(VISITOR_ID_KEY, this.visitorId); } catch { /* Ephemeral identity. */ }
    void this.connect().catch(() => {});
  }

  // ── PortfolioBackend pública ───────────────────────────────────────────────

  connect(): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    if (this.connecting) return this.connecting;
    if(this.reconnectTimer!==null){clearTimeout(this.reconnectTimer);this.reconnectTimer=null}
    this.intentionalClose = false;
    const generation=this.sessionGeneration;
    const attempt=this._openConnection().catch(error=>{
      if(generation===this.sessionGeneration&&!this.intentionalClose)this.scheduleReconnect();
      throw error;
    }).finally(()=>{if(this.connecting===attempt)this.connecting=null});
    this.connecting=attempt;return attempt;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.sessionGeneration++;this.connecting=null;this.reconnectAttempt=0;
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
    if(this.state===state)return;
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
    const visitorId=this.getOrCreateVisitorId();
    if(this.visitorId&&this.visitorId!==visitorId){this.guestTokens.clear();if(!this.authenticatedToken)this.token=null}
    this.visitorId=visitorId;return this.guestTokens.get(visitorId);
  }
  private async authorization():Promise<string>{
    if(this.authenticatedToken&&this.token)return this.token;
    const generation=this.sessionGeneration;
    let token:string;try{token=await this.fetchToken()}catch(error){if(error instanceof BackendError&&error.status===429&&generation===this.sessionGeneration&&!this.intentionalClose)this.scheduleReconnect();throw error}
    if(generation!==this.sessionGeneration)throw new BackendError('internal',t('error.offline'),503);
    this.token=token;return token;
  }
  private async _openConnection(): Promise<void> {
    const generation = this.sessionGeneration;
    this.change('connecting');
    if (this.ticketRetryAt > Date.now()) throw new BackendError('rate_limited', t('connection.retrying'), 429, Math.ceil((this.ticketRetryAt - Date.now()) / 1000));
    try {
      const result = await this._request('POST', '/api/v1/ws-ticket') as { ticket: string; expires_in: number };
      if (generation !== this.sessionGeneration) return;
      if (typeof result?.ticket !== 'string' || !result.ticket || !(result.expires_in > 0)) throw new BackendError('internal', t('error.connection'), 503);
      await this._openWebSocket(result.ticket);
    } catch (error) {
      if (generation !== this.sessionGeneration) return;
      if (error instanceof BackendError && error.status === 429 && (this.authenticatedToken || this.guestTokens.retryUntil <= Date.now())) this.ticketRetryAt = Date.now() + (error.retryAfterSec ?? 30) * 1000;
      throw error;
    }
  }

  private _openWebSocket(ticket: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${location.host}/ws?ticket=${encodeURIComponent(ticket)}`,
      );
      this.ws = ws;
      let opened = false;
      const generation=this.sessionGeneration;

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

      ws.onclose = (event) => {
        if (this.ws !== ws) { if (!opened) resolve(); return; }
        this.ws = null;
        if (!opened) reject(new BackendError('internal', t('error.connection'), 503));
        if (this.intentionalClose) { this.change('closed'); return; }
        this.change('reconnecting');
        // Browser WS errors do not expose an HTTP 401. Validate through the
        // existing HTTP endpoint after a failed handshake/abnormal close only.
        if(!this.authenticatedToken&&(!opened||event?.code===1006||event?.code===4401)){
          void this._request('GET','/api/v1/auth/me').catch(()=>{}).finally(()=>{if(generation===this.sessionGeneration&&!this.intentionalClose)this.scheduleReconnect()});
        }else this.scheduleReconnect();
      };

      ws.onerror = () => { /* Siempre seguido de onclose — no hay que hacer nada aquí. */ };
    });
  }

  private scheduleReconnect(): void {
    if(this.intentionalClose||this.reconnectTimer!==null)return;
    const previous=this.ws;this.ws=null;previous?.close(1000);
    this.change('reconnecting');
    const base=RECONNECT_DELAYS[Math.min(this.reconnectAttempt++,RECONNECT_DELAYS.length-1)];
    const delay=Math.max(Math.min(15000,base*(.85+Math.random()*.3)),this.ticketRetryAt-Date.now(),(this.authenticatedToken?0:this.guestTokens.retryUntil-Date.now()));
    this.reconnectTimer=setTimeout(()=>{
      this.reconnectTimer=null;
      if(!this.intentionalClose)void this.connect().catch(()=>{});
    },Math.min(delay,2147483647));
  }

  private async _request(
    method: string,
    path: string,
    body?: unknown,
    retry = true,
    publicRequest = false,
    guestBearer: string | null = null,
  ): Promise<unknown> {
    const sentToken=publicRequest?guestBearer:await this.authorization();

    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!publicRequest && sentToken ? { 'Authorization': `Bearer ${sentToken}` } : {}),
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
      if(res.status===401&&publicRequest&&guestBearer&&!this.authenticatedToken)this.guestTokens.invalidate(guestBearer);
      if (res.status === 401 && !this.authenticatedToken && !publicRequest) {
        this.guestTokens.invalidate(sentToken!);if(this.token===sentToken)this.token=null;
        if(retry)return this._request(method, path, body, false);
      }
      if (res.status === 429) retryAfterSec = Math.ceil(retryAfterMs(res.headers.get('Retry-After'))/1000);
      throw new BackendError(code, message, res.status, retryAfterSec);
    }

    // 202 can carry a body (chat and live: { run_id, ... }) or none (/auth/email/request).
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
}
