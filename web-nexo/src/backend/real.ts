import { BackendError, isBackendEvent } from './types';
import type {
  PortfolioBackend,
  BackendEvent,
  ConnectionState,
  ChatAccepted,
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

  // ── PortfolioBackend pública ───────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.state === 'open' || this.state === 'connecting') return;
    this.intentionalClose = false;
    await this._openConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
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

  async sendMessage(message: string): Promise<ChatAccepted> {
    return this._request('POST', '/api/v1/chat', { message }) as Promise<ChatAccepted>;
  }

  // Fase 5 — el backend de chat en vivo no existe todavía.
  async sendLiveMessage(_text: string, _name?: string): Promise<LiveSendAccepted> {
    throw new BackendError('internal', 'El chat en vivo aún no está disponible.', 503);
  }
  async listLiveMessages(): Promise<LiveHistoryResponse> {
    throw new BackendError('internal', 'El chat en vivo aún no está disponible.', 503);
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
      throw new BackendError('internal', 'No se pudo autenticar con el servidor.', res.status);
    }
    const data = await res.json() as GuestTokenResponse;
    return data.token;
  }

  private async _openConnection(): Promise<void> {
    this.change('connecting');
    try {
      this.token = await this.fetchToken();
    } catch (err) {
      this.change('closed');
      throw err;
    }
    await this._openWebSocket();
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
        opened = true;
        this.reconnectAttempt = 0;
        this.change('open');
        resolve();
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          const msg: unknown = JSON.parse(ev.data);
          if (isBackendEvent(msg)) this.events.forEach(h => h(msg));
        } catch { /* Ignora mensajes malformados. */ }
      };

      ws.onclose = () => {
        this.ws = null;
        if (!opened) reject(new BackendError('internal', 'No se pudo abrir la conexión.', 503));
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
  ): Promise<unknown> {
    if (!this.token) throw new BackendError('internal', 'Sin conexión al servidor.', 503);

    const res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'Authorization': `Bearer ${this.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && retry) {
      // Token vencido: refresca y reintenta una vez.
      this.token = await this.fetchToken();
      return this._request(method, path, body, false);
    }

    if (!res.ok) {
      let code: ErrorCode = 'internal';
      let message = 'Error inesperado del servidor.';
      let retryAfterSec: number | undefined;
      try {
        const errBody = await res.json() as ApiErrorBody;
        code = errBody.error.code;
        message = errBody.error.message;
      } catch { /* La respuesta puede no ser JSON en errores de infraestructura. */ }
      if (res.status === 429) {
        const header = res.headers.get('Retry-After');
        if (header) retryAfterSec = Number(header);
      }
      throw new BackendError(code, message, res.status, retryAfterSec);
    }

    if (res.status === 204) return undefined;
    return res.json();
  }
}
