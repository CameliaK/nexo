import { Chess } from 'chess.js';
import { BackendError, type AuthMe, type AuthToken, type BackendEvent, type ChessGame, type OwnerChessGame, type Notifications } from './types';
import type { Clock } from './mock';
import { t } from '../i18n';

type Saved = { me: AuthMe; settings: Notifications; game: ChessGame | null; games: OwnerChessGame[]; link: string | null; code: string | null; email: string; id: string; previousMe?: AuthMe };
export class MockAccount {
  private saved: Saved = { me: { mode: 'guest' }, settings: { chess_email: true }, game: null, games: [], link: null, code: null, email: '', id: crypto.randomUUID() };
  private requestedAt = -Infinity;
  constructor(private time: Clock, private emit: (event: BackendEvent) => void, private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try { const saved = JSON.parse(storage?.getItem('nexo.mock.account.v1') || 'null'); if (saved?.me && Array.isArray(saved.games)) this.saved = saved; } catch { /* Memory fallback. */ }
    if (!this.saved.games.length) {
      for (const [tag, moves, color] of [['A3F2', ['e2e4'], 'w'], ['B7C1', ['d2d4','d7d5'], 'w'], ['D9E4', ['f2f3','e7e5','g2g4','d8h4'], 'w']] as const) {
        const game = this.make(color); game.tag = tag;
        for (const uci of moves) this.apply(game, uci);
        this.saved.games.push(game);
      }
    }
  }
  private persist() { try { this.storage?.setItem('nexo.mock.account.v1', JSON.stringify(this.saved)); } catch { /* Memory fallback. */ } }
  private stamp() { return new Date(this.time.now()).toISOString(); }
  private require(owner = false) {
    if (this.saved.me.mode === 'guest') throw new BackendError('login_required', t('auth.required'), 401);
    if (owner && this.saved.me.mode !== 'owner') throw new BackendError('forbidden', t('auth.forbidden'), 403);
  }
  async authMe() { return structuredClone(this.saved.me); }
  async requestEmailLogin(email: string, _lang: 'es' | 'en') {
    if (this.time.now() - this.requestedAt < 30000) throw new BackendError('rate_limited', t('auth.rateLimited'), 429, 30);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BackendError('invalid_request', t('auth.emailInvalid'), 400);
    this.requestedAt = this.time.now(); this.saved.email = email; this.saved.link = crypto.randomUUID(); this.persist();
  }
  simulatedLink() { return this.saved.link ? '#/login/confirm?t=' + encodeURIComponent(this.saved.link) : null; }
  private login(): AuthToken {
    this.saved.me = { mode: 'user', email_hint: (this.saved.email[0] || 'k') + '***@' + (this.saved.email.split('@')[1] || 'gmail.com') };
    this.persist(); const token = 'mock.session.' + this.saved.id;
    try { this.storage?.setItem('nexo.visitor_id', this.saved.id); } catch { /* Memory fallback. */ }
    return { token, visitor_id: this.saved.id };
  }
  async verifyEmailLogin(token: string) {
    if (!token || token !== this.saved.link) throw new BackendError('unauthorized', t('auth.invalidLink'), 401);
    this.saved.link = null; return this.login();
  }
  async startGoogleLogin() {
    this.saved.code = crypto.randomUUID(); this.persist(); location.hash = '/login/done?code=' + this.saved.code;
  }
  async exchangeCode(code: string) {
    if (!code || code !== this.saved.code) throw new BackendError('unauthorized', t('auth.invalidLink'), 401);
    this.saved.code = null; return this.login();
  }
  async clearSession() { this.saved.id = crypto.randomUUID(); this.saved.link = null; this.saved.code = null; await this.logout(); }
  async logout() { this.saved.me = { mode: 'guest' }; this.saved.previousMe=undefined; this.persist(); }
  async unsubscribe(token: string) { if (!token) throw new BackendError('invalid_request', t('auth.invalidLink'), 400); this.saved.settings.chess_email = false; this.persist(); }
  async getNotifications() { this.require(); return { ...this.saved.settings }; }
  async setNotifications(value: Notifications) { this.require(); this.saved.settings = { ...value }; this.persist(); return { ...value }; }
  async deleteAccount() { this.require(); this.saved.game = null; this.saved.games = this.saved.games.filter(g => g.player_hint !== this.saved.me.email_hint); this.saved.id = crypto.randomUUID(); this.saved.email='';this.saved.link=null;this.saved.code=null; this.saved.settings = { chess_email: true }; await this.logout(); }
  async setOwnerMode(owner: boolean) {
    if(owner){if(this.saved.me.mode!=='owner')this.saved.previousMe={...this.saved.me};this.saved.me={mode:'owner',email_hint:'k***@gmail.com'}}
    else this.saved.me=this.saved.previousMe||{mode:'guest'};
    this.persist();
  }
  async simulateReply() {
    this.require();const game=this.saved.game as OwnerChessGame|null;
    if(!game||game.status!=='active'||game.turn!=='owner')throw new BackendError('not_your_turn',t('chess.notYourTurn'),409);
    const move=new Chess(game.fen).moves({verbose:true})[0];this.apply(game,move.from+move.to+(move.promotion||''));this.notify(game,'move');
    this.emit({v:2,type:'chess.move',run_id:game.id,seq:game.moves.length,ts:this.stamp(),data:{game:structuredClone(game)}});
  }
  private make(color: ChessGame['color']): OwnerChessGame { return { id: crypto.randomUUID(), tag: crypto.randomUUID().slice(0,4).toUpperCase(), player_hint: this.saved.me.email_hint || 'k***@gmail.com', color, fen: new Chess().fen(), moves: [], turn: color === 'w' ? 'player' : 'owner', status: 'active', updated_at: this.stamp() }; }
  private notify(game: OwnerChessGame, reason: 'new' | 'move' | 'resign') {
    this.saved.games = this.saved.games.map(g => g.id === game.id ? game : g);
    if (this.saved.game?.id === game.id) this.saved.game = game;
    this.persist();
    if (this.saved.me.mode === 'owner') this.emit({ v: 2, type: 'owner.chess', run_id: game.id, seq: game.moves.length + 1, ts: this.stamp(), data: { game: structuredClone(game), reason } });
  }
  private apply(game: ChessGame, uci: string) {
    const engine = new Chess(game.fen); let move;
    try { if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw Error(); move = engine.move(uci); } catch { throw new BackendError('illegal_move', t('chess.illegalRemote'), 422); }
    game.moves.push({ san: move.san, uci, by: game.turn, ts: this.stamp() }); game.fen = engine.fen(); game.turn = engine.turn() === game.color ? 'player' : 'owner';
    game.status = engine.isCheckmate() ? 'checkmate' : engine.isStalemate() ? 'stalemate' : engine.isDraw() ? 'draw' : 'active'; game.updated_at = this.stamp();
  }
  async chessGetGame() { this.require(); return structuredClone(this.saved.game); }
  async chessNewGame(color: ChessGame['color']) {
    this.require(); if (this.saved.game?.status === 'active') throw new BackendError('busy', t('chess.finishFirst'), 409);
    const game = this.make(color); this.saved.game = game; this.saved.games.push(game); this.notify(game, 'new'); return structuredClone(game);
  }
  async chessMove(uci: string) {
    this.require(); const game = this.saved.game as OwnerChessGame | null;
    if (!game || game.turn !== 'player' || game.status !== 'active') throw new BackendError('not_your_turn', t('chess.notYourTurn'), 409);
    this.apply(game, uci); this.notify(game, 'move'); return structuredClone(game);
  }
  async chessResign() { this.require(); const game = this.saved.game as OwnerChessGame | null; if (!game) throw new BackendError('invalid_request', t('chess.noGame'), 400); game.status = 'resigned'; game.updated_at = this.stamp(); this.notify(game, 'resign'); return structuredClone(game); }
  async ownerChessGames() { this.require(true); return structuredClone(this.saved.games); }
  async ownerChessMove(id: string, uci: string) {
    this.require(true); const game = this.saved.games.find(g => g.id === id);
    if (!game || game.turn !== 'owner' || game.status !== 'active') throw new BackendError('not_your_turn', t('chess.notYourTurn'), 409);
    this.apply(game, uci); if (this.saved.game?.id === id) this.saved.game = game;
    this.notify(game, 'move');
    // Player updates are independent of an outgoing chat run or open board.
    this.emit({ v: 2, type: 'chess.move', run_id: id, seq: game.moves.length, ts: this.stamp(), data: { game: structuredClone(game) } });
    return structuredClone(game);
  }
  async ownerChessResign(id: string) { this.require(true); const game = this.saved.games.find(g => g.id === id); if (!game) throw new BackendError('invalid_request', t('chess.noGame'), 404); game.status = 'resigned'; game.updated_at = this.stamp(); this.notify(game, 'resign'); return structuredClone(game); }
}
