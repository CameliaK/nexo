"""Hidden chess: the server decides legality, turn, mate, draws and resignation.

Games live in chess_games (created by the gateway's accounts migration, FK to
accounts with ON DELETE CASCADE). The player is always an account; the owner
plays the other side from the web panel. python-chess (PyPI "chess" 1.11.2)
does the rules: Move.from_uci, Board.is_legal, Board.san, Board.push,
Board.outcome(claim_draw=True).
"""

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg
import chess

log = logging.getLogger(__name__)

# One transaction-scoped lock serialises "count active games, then insert".
_ACTIVE_LOCK = 0x6E65786F  # "nexo"

_COLS = """g.id::text AS id, g.account_id::text AS account_id, g.tag, g.color, g.fen,
           g.moves, g.turn, g.status, g.updated_at, a.email, a.visitor_id"""


class ChessError(Exception):
    """Maps to the contract's error body: {error: {code, message}}."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class Expiry:
    idle_days: int
    empty_hours: int


def tag_for(game_id: str) -> str:
    """4 hex chars of sha256(game id) — never derived from the player's email."""
    return hashlib.sha256(game_id.encode()).hexdigest()[:4].upper()


def email_hint(email: str) -> str:
    """Same form as the gateway's mask.Email: "k***@gmail.com"."""
    at = email.rfind("@")
    if at < 1 or at == len(email) - 1:
        return "***"
    return email[:1] + "***" + email[at:]


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _moves(raw) -> list:
    # asyncpg returns JSONB as str unless a codec is registered.
    return json.loads(raw) if isinstance(raw, str) else list(raw or [])


def player_view(row) -> dict:
    return {
        "id": row["id"],
        "color": row["color"],
        "fen": row["fen"],
        "moves": _moves(row["moves"]),
        "turn": row["turn"],
        "status": row["status"],
        "updated_at": _iso(row["updated_at"]),
    }


def owner_view(row) -> dict:
    return {**player_view(row), "tag": row["tag"], "player_hint": email_hint(row["email"])}


def _turn(board: chess.Board, color: str) -> str:
    return "player" if (board.turn == chess.WHITE) == (color == "w") else "owner"


def _status(board: chess.Board) -> str:
    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        return "active"
    if outcome.termination == chess.Termination.CHECKMATE:
        return "checkmate"
    if outcome.termination == chess.Termination.STALEMATE:
        return "stalemate"
    return "draw"


def _parse_id(game_id: str) -> str:
    try:
        return str(uuid.UUID(game_id))
    except (ValueError, TypeError):
        raise ChessError(404, "invalid_request", "game not found")


def _expired_sql(exp: Expiry) -> str:
    return (
        f"(g.updated_at < now() - interval '{int(exp.idle_days)} days'"
        f" OR (jsonb_array_length(g.moves) = 0"
        f" AND g.created_at < now() - interval '{int(exp.empty_hours)} hours'))"
    )


async def expire(pool: asyncpg.Pool, exp: Expiry) -> int:
    """Deletes games idle for exp.idle_days, or still without a single move
    after exp.empty_hours."""
    async with pool.acquire() as conn:
        status = await conn.execute(f"DELETE FROM chess_games g WHERE {_expired_sql(exp)}")
    n = int(status.split()[-1])
    if n:
        log.info("chess: expired %d game(s)", n)
    return n


# ── Player ────────────────────────────────────────────────────────────────────


async def player_game(pool: asyncpg.Pool, account_id: str):
    """The active game or, if none, the last finished one."""
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            f"""SELECT {_COLS} FROM chess_games g JOIN accounts a ON a.id = g.account_id
                WHERE g.account_id = $1
                ORDER BY (g.status = 'active') DESC, g.updated_at DESC LIMIT 1""",
            account_id,
        )


async def new_game(pool: asyncpg.Pool, account_id: str, color: str, max_active: int, exp: Expiry):
    if color not in ("w", "b"):
        raise ChessError(400, "invalid_request", "color must be 'w' or 'b'")
    game_id = str(uuid.uuid4())
    board = chess.Board()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _ACTIVE_LOCK)
            # Stale games must never hold a slot between two sweeps.
            await conn.execute(f"DELETE FROM chess_games g WHERE {_expired_sql(exp)}")
            mine = await conn.fetchval(
                "SELECT 1 FROM chess_games WHERE account_id = $1 AND status = 'active'", account_id
            )
            if mine:
                raise ChessError(409, "busy", "finish your current game first")
            active = await conn.fetchval("SELECT count(*) FROM chess_games WHERE status = 'active'")
            if active >= max_active:
                raise ChessError(409, "busy", "too many games in progress, try again later")
            await conn.execute(
                """INSERT INTO chess_games (id, account_id, tag, color, fen, moves, turn, status)
                   VALUES ($1, $2, $3, $4, $5, '[]', $6, 'active')""",
                game_id, account_id, tag_for(game_id), color, board.fen(), _turn(board, color),
            )
            return await _fetch(conn, game_id)


async def player_move(pool: asyncpg.Pool, account_id: str, uci: str):
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """SELECT id::text FROM chess_games WHERE account_id = $1 AND status = 'active'
                   FOR UPDATE""",
                account_id,
            )
            if row is None:
                raise ChessError(409, "not_your_turn", "no game in progress")
            return await _apply(conn, row["id"], "player", uci)


async def player_resign(pool: asyncpg.Pool, account_id: str):
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """SELECT id::text FROM chess_games WHERE account_id = $1 AND status = 'active'
                   FOR UPDATE""",
                account_id,
            )
            if row is None:
                raise ChessError(400, "invalid_request", "no game in progress")
            return await _resign(conn, row["id"])


# ── Owner ─────────────────────────────────────────────────────────────────────


async def owner_games(pool: asyncpg.Pool) -> list:
    async with pool.acquire() as conn:
        return await conn.fetch(
            f"""SELECT {_COLS} FROM chess_games g JOIN accounts a ON a.id = g.account_id
                ORDER BY (g.status = 'active') DESC, g.updated_at DESC LIMIT 200"""
        )


async def owner_game(pool: asyncpg.Pool, game_id: str):
    game_id = _parse_id(game_id)
    async with pool.acquire() as conn:
        row = await _fetch(conn, game_id)
    if row is None:
        raise ChessError(404, "invalid_request", "game not found")
    return row


async def owner_move(pool: asyncpg.Pool, game_id: str, uci: str):
    game_id = _parse_id(game_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock(conn, game_id)
            return await _apply(conn, game_id, "owner", uci)


async def owner_resign(pool: asyncpg.Pool, game_id: str):
    game_id = _parse_id(game_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock(conn, game_id)
            return await _resign(conn, game_id)


# ── Shared ────────────────────────────────────────────────────────────────────


async def _fetch(conn, game_id: str):
    return await conn.fetchrow(
        f"SELECT {_COLS} FROM chess_games g JOIN accounts a ON a.id = g.account_id WHERE g.id = $1",
        game_id,
    )


async def _lock(conn, game_id: str) -> None:
    if await conn.fetchval("SELECT 1 FROM chess_games WHERE id = $1 FOR UPDATE", game_id) is None:
        raise ChessError(404, "invalid_request", "game not found")


async def _apply(conn, game_id: str, by: str, uci: str):
    """Validates and stores one move. Caller holds the row lock."""
    row = await _fetch(conn, game_id)
    if row["status"] != "active" or row["turn"] != by:
        raise ChessError(409, "not_your_turn", "it is not your turn")
    board = chess.Board(row["fen"])
    try:
        move = chess.Move.from_uci(uci if isinstance(uci, str) else "")
    except ValueError:
        raise ChessError(422, "illegal_move", "illegal move")
    if not board.is_legal(move):
        raise ChessError(422, "illegal_move", "illegal move")
    san = board.san(move)
    board.push(move)
    now = datetime.now(timezone.utc)
    moves = _moves(row["moves"]) + [{"san": san, "uci": move.uci(), "by": by, "ts": _iso(now)}]
    await conn.execute(
        """UPDATE chess_games SET fen = $2, moves = $3::jsonb, turn = $4, status = $5, updated_at = $6
           WHERE id = $1""",
        game_id, board.fen(), json.dumps(moves), _turn(board, row["color"]), _status(board), now,
    )
    return await _fetch(conn, game_id)


async def _resign(conn, game_id: str):
    row = await _fetch(conn, game_id)
    if row["status"] != "active":
        raise ChessError(409, "not_your_turn", "the game is already over")
    await conn.execute(
        "UPDATE chess_games SET status = 'resigned', updated_at = now() WHERE id = $1", game_id
    )
    return await _fetch(conn, game_id)
