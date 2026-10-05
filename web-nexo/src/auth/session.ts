import { Chess } from 'chess.js';
import { BackendError, type AuthMe, type BackendEvent, type ChessGame, type OwnerChessGame, type PortfolioBackend } from '../backend/types';
import { t, type UIKey } from '../i18n';
export const unavailable = (error: unknown) => error instanceof BackendError && (error.status === 404 || error.status === 503);
export function errorText(error: unknown) {
  if (unavailable(error)) return t('auth.soon');
  if (error instanceof BackendError) {
    const keys: Partial<Record<BackendError['code'], UIKey>> = { login_required: 'auth.required', forbidden: 'auth.forbidden', not_your_turn: 'chess.notYourTurn', illegal_move: 'chess.illegalRemote', rate_limited: 'auth.rateLimited', unauthorized: 'auth.invalidLink' };
    if (keys[error.code]) return t(keys[error.code]!);
  }
  return t('auth.error');
}
/**
 * What a click on the chess node does. Only a guest whose backend answers is asked to sign in;
 * with a session (user/owner) a failing or missing chess API opens the board in its
 * "Coming soon" / retry state, never the access panel.
 */
export function chessGate(account: Pick<AccountChess, 'me' | 'available'>): 'login' | 'open' {
  return account.me.mode === 'guest' && account.available ? 'login' : 'open';
}
export function chessNode(account: Pick<AccountChess, 'me' | 'available' | 'unread' | 'nodeLabel'>) {
  return { locked: chessGate(account) === 'login', unread: account.unread, label: account.nodeLabel };
}
/** The server owns the game; a speculative board is discarded on rejection. */
export class AccountChess {
  me: AuthMe = { mode: 'guest' };
  available = true;
  ready = false;
  busy = false;
  error: unknown = null;
  notifications = true;
  notificationsReady = false;
  accountError: unknown = null;
  playerGame: ChessGame | null = null;
  ownerGames: OwnerChessGame[] = [];
  ownerId: string | null = null;
  unread = false;
  panelOpen = false;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private revision = 0;
  private stopEvent: () => void;
  constructor(public readonly backend: PortfolioBackend) { this.stopEvent = backend.onEvent(e => this.receive(e)); }
  subscribe(fn: () => void) { this.listeners.add(fn); fn(); return () => { this.listeners.delete(fn); }; }
  notify() { this.listeners.forEach(fn => fn()); }
  get game() { return this.ownerId ? this.ownerGames.find(g => g.id === this.ownerId) || null : this.playerGame; }
  get side() { return this.game ? this.ownerId ? this.game.color === 'w' ? 'b' : 'w' : this.game.color : 'w'; }
  get canMove() { return !this.busy && this.me.mode !== 'guest' && this.game?.status === 'active' && this.game.turn === (this.ownerId ? 'owner' : 'player'); }
  get nodeLabel() { return !this.available ? t('auth.soon') : this.me.mode === 'guest' ? t('auth.required') : this.unread ? t('chess.newMove') : t('chess.nodeCaption'); }
  async refresh() {
    const epoch = ++this.epoch; this.ready = false; this.error = null; this.notify();
    try {
      const me = await this.backend.authMe(); if (epoch !== this.epoch) return;
      this.me = me; this.available = true;
      if (me.mode === 'guest') { this.notificationsReady=false;this.accountError=null;this.playerGame = null; this.ownerGames = []; this.ownerId = null; this.unread = false; }
      else {
        const revision = this.revision, ownerSnapshot = new Map(this.ownerGames.map(game => [game.id, game]));
        const results = await Promise.allSettled([this.backend.chessGetGame(), this.backend.getNotifications(), ...(me.mode === 'owner' ? [this.backend.ownerChessGames()] : [])]);
        if (epoch !== this.epoch) return;
        const [game, settings, games] = results;
        if (game.status === 'fulfilled' && revision === this.revision) this.playerGame = game.value as ChessGame | null;
        else if (game.status === 'rejected') { if (unavailable(game.reason)) this.available = false; else this.error = game.reason; }
        if (settings.status === 'fulfilled') { this.notifications = (settings.value as { chess_email: boolean }).chess_email; this.notificationsReady=true;this.accountError=null; } else {this.notificationsReady=false;this.accountError=settings.reason}
        if (games?.status === 'fulfilled') {
          // A WS update can arrive while the HTTP list is loading, including the first load.
          const changed = new Map(this.ownerGames.filter(game => ownerSnapshot.get(game.id) !== game).map(game => [game.id, game]));
          const loaded = games.value as OwnerChessGame[];
          this.ownerGames = [...loaded.map(game => changed.get(game.id) || game), ...[...changed.values()].filter(game => !loaded.some(old => old.id === game.id))];
        }
        if (games?.status === 'rejected') this.error = games.reason;
        if (me.mode !== 'owner') { this.ownerGames = []; this.ownerId = null; }
      }
    } catch (error) { if (epoch !== this.epoch) return; if (unavailable(error)) this.available = false; else this.error = error; if(error instanceof BackendError && error.status===401){this.me={mode:'guest'};this.playerGame=null;this.ownerGames=[];this.ownerId=null;this.unread=false} }
    if (epoch === this.epoch) { this.ready = true; this.notify(); }
  }
  selectPlayer() { this.ownerId = null; this.error = null; this.unread = false; this.notify(); }
  selectOwner(id: string) { if (this.me.mode !== 'owner' || !this.ownerGames.some(g => g.id === id)) return false; this.ownerId = id; this.error = null; this.notify(); return true; }
  open(open: boolean) { this.panelOpen = open; if (open && !this.ownerId) this.unread = false; this.notify(); }
  private setGame(game: ChessGame) {
    if (this.ownerId) this.ownerGames = this.ownerGames.map(g => g.id === game.id ? { ...g, ...game } : g);
    else this.playerGame = game;
  }
  private async action(work: () => Promise<ChessGame>, speculative?: ChessGame) {
    if (this.busy) return;
    const epoch = this.epoch, before = this.game, ownerId = this.ownerId, revision = this.revision;
    this.busy = true; this.error = null; if (speculative) this.setGame(speculative); this.notify();
    try { const game = await work(); if (epoch === this.epoch && ownerId === this.ownerId && revision === this.revision) this.setGame(game); }
    catch (error) {
      if (epoch !== this.epoch || ownerId !== this.ownerId) return;
      if (before && revision === this.revision) this.setGame(before);
      this.error = error;
      if (unavailable(error)) this.available = false;
      if (error instanceof BackendError && error.code === 'login_required') this.me = { mode: 'guest' };
      this.notify();
      if (error instanceof BackendError && (error.status === 409 || error.status === 422)) {
        try { const current = ownerId ? (await this.backend.ownerChessGames()).find(g => g.id === ownerId) : await this.backend.chessGetGame(); if (current && epoch === this.epoch && ownerId === this.ownerId) this.setGame(current); } catch { /* Keep the last confirmed position. */ }
      }
    } finally { this.busy = false; this.notify(); }
  }
  async newGame(color: ChessGame['color']) { if (this.me.mode === 'guest' || this.ownerId) return; await this.action(() => this.backend.chessNewGame(color)); }
  async move(uci: string) {
    if (!this.canMove || !this.game) return;
    const board = new Chess(this.game.fen);
    try { board.move(uci); } catch { this.error = new BackendError('illegal_move', '', 422); this.notify(); return; }
    const moved=board.history({verbose:true}).at(-1)!;
    const optimistic = { ...this.game, fen: board.fen(), moves:[...this.game.moves,{uci,san:moved.san,by:this.ownerId?'owner' as const:'player' as const,ts:new Date().toISOString()}] };
    const id = this.ownerId;
    await this.action(() => id ? this.backend.ownerChessMove(id, uci) : this.backend.chessMove(uci), optimistic);
  }
  async resign() { if (!this.game || this.game.status !== 'active') return; const id = this.ownerId; await this.action(() => id ? this.backend.ownerChessResign(id) : this.backend.chessResign()); }
  async refreshNotifications() {
    if(this.me.mode==='guest')return;
    const epoch=this.epoch;this.notificationsReady=false;this.accountError=null;this.notify();
    try {const settings=await this.backend.getNotifications();if(epoch!==this.epoch)return;this.notifications=settings.chess_email;this.notificationsReady=true;this.accountError=null}
    catch(error){if(epoch!==this.epoch)return;this.accountError=error;this.notificationsReady=false}this.notify();
  }
  async setNotifications(enabled: boolean) {
    const epoch=this.epoch;
    try {const settings=await this.backend.setNotifications({chess_email:enabled});if(epoch!==this.epoch)return;this.notifications=settings.chess_email;this.accountError=null}
    catch(error){if(epoch!==this.epoch)return;this.accountError=error}this.notify();
  }
  async signOut(remove = false) {
    if(this.busy)return;++this.epoch;this.busy=true;this.accountError=null;this.notify();
    try { if (remove) await this.backend.deleteAccount(); else await this.backend.logout(); this.me={mode:'guest'};this.notificationsReady=false;this.accountError=null;this.ownerId = null; this.ownerGames = []; this.playerGame = null; this.unread = false; this.notify(); await this.refresh(); }
    catch (error) { this.accountError = error; }
    finally{this.busy=false;this.notify()}
  }
  receive(event: BackendEvent) {
    if (this.me.mode === 'guest') return;
    if (event.type === 'chess.move') {
      const game = event.data.game;
      if (this.playerGame && game.id !== this.playerGame.id) return;
      if (this.playerGame && game.moves.length <= this.playerGame.moves.length && game.updated_at <= this.playerGame.updated_at) return;
      this.revision++; this.playerGame = game;
      if (!this.panelOpen || this.ownerId) this.unread = true;
      this.notify();
    } else if (event.type === 'owner.chess' && this.me.mode === 'owner') {
      const game = event.data.game, old = this.ownerGames.find(g => g.id === game.id);
      if (old && (game.moves.length < old.moves.length || game.updated_at < old.updated_at)) return;
      if(this.ownerId===game.id)this.revision++; this.ownerGames = [game, ...this.ownerGames.filter(g => g.id !== game.id)]; this.notify();
    }
  }
  dispose() { ++this.epoch; this.stopEvent(); this.listeners.clear(); }
}
