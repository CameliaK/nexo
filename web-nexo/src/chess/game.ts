import { t } from '../i18n';
import { Chess, type Color, type PieceSymbol, type Square, type Move } from 'chess.js';

export type Promotion = 'q' | 'r' | 'b' | 'n';
export interface PositionPiece { square: Square; type: PieceSymbol; color: Color }
export interface GameStatus { ended: boolean; title: string; detail: string; claimable: boolean }
const name = (color: Color) => color === 'w' ? t('common.visitor') : 'Kirbith';
const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** In-memory rules only. chess.js validates moves; draw claims are kept separate
 * from automatic fivefold repetition / 75-move draws. */
export class ChessGame {
  private engine: Chess;
  private positions: string[];
  private claimed = false;
  constructor(fen?: string) {
    this.engine = new Chess(fen);
    this.positions = [positionKey(this.engine.fen())];
  }
  get fen() { return this.engine.fen(); }
  get turn() { return this.engine.turn(); }
  get pieces(): PositionPiece[] { return this.engine.board().flat().filter((p): p is PositionPiece => p !== null); }
  get history() { return this.engine.history({ verbose: true }); }
  get check() { return this.engine.isCheck(); }
  legal(square?: Square): Move[] {
    if (this.status.ended) return [];
    return square ? this.engine.moves({ square, verbose: true }) : this.engine.moves({ verbose: true });
  }
  get status(): GameStatus {
    const repetitions = this.positions.filter(p => p === positionKey(this.fen)).length;
    const halfmoves = Number(this.fen.split(' ')[4]);
    let title = t('chess.turn',{name:name(this.turn)}), detail = this.turn === 'w' ? t('chess.whiteTurn') : t('chess.blackTurn');
    let ended = true;
    if (this.engine.isCheckmate()) { title = t('chess.mate',{name:name(this.turn === 'w' ? 'b' : 'w')}); detail = t('chess.goodGame'); }
    else if (this.claimed) { title = t('chess.claimed'); detail = t('chess.claimedDetail'); }
    else if (this.engine.isStalemate()) { title = t('chess.stalemate'); detail = t('chess.stalemateDetail'); }
    else if (this.engine.isInsufficientMaterial()) { title = t('chess.insufficient'); detail = t('chess.insufficientDetail'); }
    else if (repetitions >= 5) { title = t('chess.fivefold'); detail = t('chess.fivefoldDetail'); }
    else if (halfmoves >= 150) { title = t('chess.seventyFive'); detail = t('chess.seventyFiveDetail'); }
    else { ended = false; if (this.check) detail = t('chess.check'); }
    return { ended, title, detail, claimable: !ended && (repetitions >= 3 || halfmoves >= 100) };
  }
  move(from: Square, to: Square, promotion: Promotion = 'q'): Move | null {
    if (!this.legal(from).some(m => m.to === to && (!m.promotion || m.promotion === promotion))) return null;
    const move = this.engine.move({ from, to, promotion });
    this.positions.push(positionKey(this.fen));
    return move;
  }
  /** A draw may also be claimed by announcing an intended legal move. */
  canClaimWith(from: Square, to: Square, promotion: Promotion = 'q') {
    if (!this.legal(from).some(m => m.to === to && (!m.promotion || m.promotion === promotion))) return false;
    const preview = new Chess(this.fen);
    preview.move({ from, to, promotion });
    return Number(preview.fen().split(' ')[4]) >= 100 || this.positions.filter(p => p === positionKey(preview.fen())).length >= 2;
  }
  get canAnnounceClaim() {
    if(this.status.ended)return false;
    const counts=new Map<string,number>();
    for(const key of this.positions)counts.set(key,(counts.get(key)||0)+1);
    if(Number(this.fen.split(' ')[4])<99&&![...counts.values()].some(n=>n>=2))return false;
    return this.legal().some(m=>{
      const preview=new Chess(this.fen);preview.move({from:m.from,to:m.to,promotion:m.promotion});
      return Number(preview.fen().split(' ')[4])>=100||(counts.get(positionKey(preview.fen()))||0)>=2;
    });
  }
  claim(from?: Square, to?: Square, promotion?: Promotion) {
    if (!this.status.claimable && !(from && to && this.canClaimWith(from, to, promotion))) return false;
    this.claimed = true;
    return true;
  }
  loadRemote(fen: string, moves: { uci: string }[]) {
    const replay = new Chess();
    try { for (const move of moves) replay.move(move.uci); this.engine = replay.fen() === fen ? replay : new Chess(fen); }
    catch { this.engine = new Chess(fen); }
    this.positions = [positionKey(fen)]; this.claimed = false;
  }
  reset() { this.engine.reset(); this.positions = [positionKey(this.fen)]; this.claimed = false; }
}
