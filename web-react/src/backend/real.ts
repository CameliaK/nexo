import { BackendError } from './types';
import type { PortfolioBackend, BackendEvent, ConnectionState, ChatAccepted, LiveSendAccepted, LiveHistoryResponse, GeneratedNode } from './types';

/** Connection adapter placeholder. HTTP, guest auth and WebSocket will live
 * here when a real backend exists; the rest of the UI never imports transport. */
export class RealBackend implements PortfolioBackend {
  private connections = new Set<(state: ConnectionState) => void>();
  private unavailable(): never { throw new BackendError('internal', 'El backend todavía no está disponible.', 503); }
  async connect(): Promise<void> { this.connections.forEach(handler => handler('closed')); this.unavailable(); }
  disconnect() { this.connections.forEach(handler => handler('closed')); }
  onEvent(_handler: (event: BackendEvent) => void) { return () => {}; }
  onConnectionChange(handler: (state: ConnectionState) => void) { this.connections.add(handler); handler('closed'); return () => { this.connections.delete(handler); }; }
  async sendMessage(_message: string): Promise<ChatAccepted> { return this.unavailable(); }
  async sendLiveMessage(_text: string, _name?: string): Promise<LiveSendAccepted> { return this.unavailable(); }
  async listLiveMessages(): Promise<LiveHistoryResponse> { return this.unavailable(); }
  async listGeneratedNodes(): Promise<GeneratedNode[]> { return this.unavailable(); }
  async deleteGeneratedNode(_id: string): Promise<void> { return this.unavailable(); }
}
