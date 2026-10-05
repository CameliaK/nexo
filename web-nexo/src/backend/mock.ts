import { MockAccount } from './mock-account';
import type { ChessGame, Notifications } from './types';
import { t } from '../i18n';
import scenariosFile from '../data/mock-scenarios.json';
import { BackendError, LIMITS, isBackendEvent } from './types';
import type { PortfolioBackend, BackendEvent, ConnectionState, GeneratedNode, LiveMessage } from './types';
import { generatedSize } from './generated';

export interface Clock {
  now(): number;
  schedule(fn: () => void, delay: number): unknown;
  cancel(id: unknown): void;
}
const clock: Clock = { now: Date.now, schedule: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>) };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type Saved = { conversation: string | null; messages: LiveMessage[]; nodes: GeneratedNode[] };
export const scenarioIds = scenariosFile.scenarios.map(s => s.id);

/** Local development only. Timers model transport; no network is involved. */
export class MockBackend implements PortfolioBackend {
  private events = new Set<(event: BackendEvent) => void>();
  private connections = new Set<(state: ConnectionState) => void>();
  private timers = new Set<unknown>();
  private state: ConnectionState = 'closed';
  private chatRun: string | null = null;
  private saved: Saved = { conversation: null, messages: [], nodes: [] };
  private account: MockAccount;
  constructor(private time: Clock = clock, private storage?: StorageLike) {
    this.account = new MockAccount(time, event => this.events.forEach(handler => handler(event)), storage);
    try { const saved = JSON.parse(storage?.getItem('nexo.mock.session.v2') || 'null'); if (saved && Array.isArray(saved.messages) && Array.isArray(saved.nodes)) this.saved = saved; } catch { /* Storage can be unavailable. */ }
  }
  private persist() { try { this.storage?.setItem('nexo.mock.session.v2', JSON.stringify(this.saved)); } catch { /* In-memory mode remains usable. */ } }
  private change(state: ConnectionState) { this.state = state; this.connections.forEach(handler => handler(state)); }
  async connect() { if (this.state === 'open') return; this.change('connecting'); this.change('open'); }
  disconnect() { this.timers.forEach(id => this.time.cancel(id)); this.timers.clear(); this.chatRun = null; this.change('closed'); }
  onEvent(handler: (event: BackendEvent) => void) { this.events.add(handler); return () => { this.events.delete(handler); }; }
  onConnectionChange(handler: (state: ConnectionState) => void) { this.connections.add(handler); handler(this.state); return () => { this.connections.delete(handler); }; }
  private later(fn: () => void, delay: number) { const id = this.time.schedule(() => { this.timers.delete(id); fn(); }, delay); this.timers.add(id); }
  private ensureOpen() { if (this.state !== 'open') throw new BackendError('internal', t('error.mockOffline'), 503); }
  private validate(text: string, limit: number) { if (!text.trim() || text.length > limit) throw new BackendError('invalid_request', t('error.characters',{limit}), 400); }
  async sendMessage(message: string, _lang?: 'es' | 'en') {
    this.ensureOpen(); this.validate(message, LIMITS.messageMaxChars);
    for (const code of ['429', '409'] as const) if (message.startsWith('/' + code)) {
      const error = scenariosFile.http_errors[code];
      throw new BackendError(error.body.error.code as 'rate_limited' | 'busy', error.body.error.message, error.status, code === '429' ? Number(scenariosFile.http_errors['429'].headers['Retry-After']) : undefined);
    }
    if (this.chatRun) throw new BackendError('busy', t('error.busy'), 409);
    const selected = scenariosFile.scenarios.find(s => s.trigger === 'chat' && s.match?.some(word => message.toLowerCase().includes(word)))?.id || scenariosFile.default_scenario;
    return { run_id: this.playScenario(selected, message).run_id };
  }
  async sendLiveMessage(text: string, name?: string) {
    this.validate(text, LIMITS.liveMessageMaxChars);
    if ((name?.length || 0) > LIMITS.liveNameMaxChars) throw new BackendError('invalid_request', t('error.name'), 400);
    const accepted = this.playScenario('live-out', text);
    return { run_id: accepted.run_id, message_id: accepted.message_id };
  }
  async listLiveMessages() { return structuredClone({ conversation_id: this.saved.conversation, messages: this.saved.messages }); }
  async listGeneratedNodes() { return structuredClone(this.saved.nodes); }
  async deleteGeneratedNode(id: string) { this.saved.nodes = this.saved.nodes.filter(n => n.id !== id).map(n=>n.children?{...n,children:n.children.filter(child=>child.id!==id)}:n); this.persist(); }

  authMe() { return this.account.authMe(); }
  requestEmailLogin(email: string, lang: 'es' | 'en') { return this.account.requestEmailLogin(email, lang); }
  verifyEmailLogin(token: string) { return this.account.verifyEmailLogin(token); }
  startGoogleLogin() { return this.account.startGoogleLogin(); }
  exchangeCode(code: string) { return this.account.exchangeCode(code); }
  logout() { return this.account.logout(); }
  unsubscribe(token: string) { return this.account.unsubscribe(token); }
  getNotifications() { return this.account.getNotifications(); }
  setNotifications(value: Notifications) { return this.account.setNotifications(value); }
  async deleteAccount() { await this.account.deleteAccount(); this.saved = { conversation: null, messages: [], nodes: [] }; this.persist(); }
  chessGetGame() { return this.account.chessGetGame(); }
  chessNewGame(color: ChessGame['color']) { return this.account.chessNewGame(color); }
  chessMove(uci: string) { return this.account.chessMove(uci); }
  chessResign() { return this.account.chessResign(); }
  ownerChessGames() { return this.account.ownerChessGames(); }
  ownerChessMove(id: string, uci: string) { return this.account.ownerChessMove(id, uci); }
  ownerChessResign(id: string) { return this.account.ownerChessResign(id); }
  simulatedLink() { return this.account.simulatedLink(); }
  simulateReply() { return this.account.simulateReply(); }
  setOwnerMode(owner: boolean) { return this.account.setOwnerMode(owner); }

  /** Only the development composition root exposes this, never production UI. */
  playScenario(id: string, input = t('mock.testMessage')) {
    this.ensureOpen();
    const scenario = scenariosFile.scenarios.find(s => s.id === id);
    if (!scenario) throw new BackendError('invalid_request', t('error.scenario'), 400);
    if (scenario.trigger === 'chat' && this.chatRun) throw new BackendError('busy', t('error.busy'), 409);
    const run_id = crypto.randomUUID(), message_id = crypto.randomUUID();
    if (scenario.trigger === 'chat') this.chatRun = run_id;
    if (scenario.trigger !== 'chat' && !this.saved.conversation) this.saved.conversation = crypto.randomUUID();
    if (scenario.id === 'live-out') this.saved.messages.push({ id: message_id, from: 'visitor', text: input, ts: new Date(this.time.now()).toISOString() });
    this.persist();
    const tokens: Record<string, string> = { run_id, message_id, input, conversation_id: this.saved.conversation || '' };
    const replace = (value: unknown): unknown => {
      if (typeof value === 'string') return value.replace(/\{\{(run_id|now|input|message_id|conversation_id)\}\}/g, (_, key) => key === 'now' ? new Date(this.time.now()).toISOString() : tokens[key]);
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
      return value;
    };
    let elapsed = 0;
    for (const entry of scenario.events) {
      elapsed += entry.delay_ms;
      this.later(() => {
        const event = replace(entry.event);
        if (!isBackendEvent(event)) return;
        if (event.type === 'node.spawn') {
          if (!this.saved.nodes.some(n=>n.id===event.data.node.id)&&this.saved.nodes.reduce((sum,node)=>sum+generatedSize(node),0)+generatedSize(event.data.node) <= LIMITS.generatedNodesPerSession) this.saved.nodes.push(event.data.node);
          this.persist();
        }
        if (event.type === 'live.message') { this.saved.messages.push(event.data.message); this.persist(); }
        if ((event.type === 'run.done' || event.type === 'run.error') && this.chatRun === run_id) this.chatRun = null;
        this.events.forEach(handler => handler(event));
      }, elapsed);
    }
    if (scenario.followup) this.later(() => this.playScenario(scenario.followup!.scenario), elapsed + scenario.followup.delay_ms);
    return { run_id, message_id };
  }
}
