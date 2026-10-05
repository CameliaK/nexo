"""Internal chess endpoints, proxied by the gateway (which owns auth and the
per-account move limit). Every mutating call belongs to a run that the gateway
opened (run.start kind "chess"); the agent adds its own trace.hop events to
it and publishes the game events:

- owner.chess → events:owner, on every change (player or owner).
- chess.move  → events:{player visitor_id}, when the owner moves or resigns,
  whether or not the player has the page open.

When the player moves, the owner also gets a Telegram notice through the
existing n8n outbound flow ("♟ #TAG · abrir partida" + link to the panel), at
most once per game every CHESS_NOTIFY_MINUTES. Telegram only notifies: it
never carries moves, and the notice never carries the player's email.
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import chess_game as cg
from .events import EventPublisher

log = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/chess")

_EXPIRY_EVERY_S = 3600


@dataclass
class TelegramNotice:
    n8n_url: str
    bot_token: str
    chat_id: str
    public_base_url: str
    every_minutes: int


class _State:
    rdb: aioredis.Redis | None = None
    pool: asyncpg.Pool | None = None
    max_active: int = 5
    expiry = cg.Expiry(idle_days=30, empty_hours=48)
    telegram: TelegramNotice | None = None


state = _State()


def init(rdb: aioredis.Redis, pool: asyncpg.Pool, *, max_active: int, expiry: cg.Expiry,
         telegram: TelegramNotice) -> None:
    state.rdb, state.pool, state.max_active, state.expiry = rdb, pool, max_active, expiry
    state.telegram = telegram


async def expiry_loop() -> None:
    """Periodic sweep: idle games (30 days) and games without moves (48 h)."""
    while True:
        try:
            await cg.expire(state.pool, state.expiry)
        except Exception as exc:  # keep sweeping on the next tick
            log.error("chess: expiry sweep failed: %s", exc)
        await asyncio.sleep(_EXPIRY_EVERY_S)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _err(e: cg.ChessError) -> JSONResponse:
    return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})


async def _game_event(channel: str, type_: str, game: dict, seq: int, **extra) -> None:
    # Same envelope as the mock: run_id is the game id, seq follows the moves.
    envelope = {"v": 2, "type": type_, "run_id": game["id"], "seq": seq, "ts": _now_iso(),
                "data": {"game": game, **extra}}
    await state.rdb.publish(channel, json.dumps(envelope))


class _Hops:
    """trace.hop events on the actor's channel, inside the gateway's run."""

    def __init__(self, visitor_id: str | None, run_id: str | None) -> None:
        self._pub = EventPublisher(state.rdb, visitor_id, run_id) if visitor_id and run_id else None

    async def start(self, hop_id: str, frm: str, to: str, label: str) -> None:
        if self._pub:
            await self._pub.publish("trace.hop", {"hop_id": hop_id, "from": frm, "to": to,
                                                  "phase": "start", "label": label})

    async def end(self, hop_id: str, frm: str, to: str) -> None:
        if self._pub:
            await self._pub.publish("trace.hop", {"hop_id": hop_id, "from": frm, "to": to,
                                                  "phase": "end", "duration_ms": 0})

    async def error(self, hop_id: str, frm: str, to: str, detail: str) -> None:
        if self._pub:
            await self._pub.publish("trace.hop", {"hop_id": hop_id, "from": frm, "to": to,
                                                  "phase": "error", "detail": detail})


async def _notify_owner(row, reason: str, hops: _Hops) -> None:
    game = cg.owner_view(row)
    await hops.start("a2", "agent", "redis", "Avisando al dueño")
    await _game_event("events:owner", "owner.chess", game, len(game["moves"]) + 1, reason=reason)
    await hops.end("a2", "agent", "redis")


async def _telegram_owner(row, hops: _Hops) -> None:
    """Notice to the owner on Telegram, at most once per game per window. The
    window is claimed before sending (two quick moves never both notify) and
    released if the send fails."""
    tg = state.telegram
    if not tg or not tg.bot_token or not tg.chat_id:
        return
    key = f"chess:notify:{row['id']}"
    if not await state.rdb.set(key, 1, nx=True, ex=tg.every_minutes * 60):
        return
    await hops.start("a3", "agent", "n8n", "Aviso al dueño")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(tg.n8n_url, json={
                "kind": "chess",
                "tag": row["tag"],
                "link": f"{tg.public_base_url}/#/owner/chess?game={row['id']}",
                "telegram_bot_token": tg.bot_token,
                "telegram_chat_id": tg.chat_id,
            })
        ok = resp.status_code == 200 and resp.json().get("ok") is True
    except Exception as exc:
        log.error("chess: telegram notice tag=%s failed: %s", row["tag"], exc)
        ok = False
    if not ok:
        await state.rdb.delete(key)
        await hops.error("a3", "agent", "n8n", "Aviso no enviado")
        return
    await hops.start("a4", "n8n", "owner_channel", "Telegram")
    await hops.end("a4", "n8n", "owner_channel")
    await hops.end("a3", "agent", "n8n")
    log.info("chess: telegram notice sent tag=%s", row["tag"])


async def _notify_player(row, reason: str, hops: _Hops) -> None:
    await hops.start("a2", "agent", "redis", "Avisando al jugador")
    player = cg.player_view(row)
    await _game_event(f"events:{row['visitor_id']}", "chess.move", player, len(player["moves"]))
    # Other owner tabs stay in sync too.
    owner = cg.owner_view(row)
    await _game_event("events:owner", "owner.chess", owner, len(owner["moves"]) + 1, reason=reason)
    await hops.end("a2", "agent", "redis")


async def _saving(hops: _Hops, action):
    await hops.start("a1", "agent", "postgres", "Guardando partida")
    try:
        row = await action
    except cg.ChessError as e:
        await hops.error("a1", "agent", "postgres", e.message)
        raise
    await hops.end("a1", "agent", "postgres")
    return row


# ── Player ────────────────────────────────────────────────────────────────────


class _PlayerReq(BaseModel):
    account_id: str
    visitor_id: str | None = None
    run_id: str | None = None
    color: str | None = None
    uci: str | None = None


@router.get("/game")
async def get_game(account_id: str):
    row = await cg.player_game(state.pool, account_id)
    return {"game": cg.player_view(row) if row else None}


@router.post("/game")
async def create_game(body: _PlayerReq):
    hops = _Hops(body.visitor_id, body.run_id)
    try:
        row = await _saving(hops, cg.new_game(state.pool, body.account_id, body.color or "",
                                              state.max_active, state.expiry))
    except cg.ChessError as e:
        return _err(e)
    await _notify_owner(row, "new", hops)
    log.info("chess: new game tag=%s color=%s", row["tag"], row["color"])
    return {"game": cg.player_view(row)}


@router.post("/game/move")
async def move(body: _PlayerReq):
    hops = _Hops(body.visitor_id, body.run_id)
    try:
        row = await _saving(hops, cg.player_move(state.pool, body.account_id, body.uci or ""))
    except cg.ChessError as e:
        return _err(e)
    await _notify_owner(row, "move", hops)
    await _telegram_owner(row, hops)
    return {"game": cg.player_view(row)}


@router.post("/game/resign")
async def resign(body: _PlayerReq):
    hops = _Hops(body.visitor_id, body.run_id)
    try:
        row = await _saving(hops, cg.player_resign(state.pool, body.account_id))
    except cg.ChessError as e:
        return _err(e)
    await _notify_owner(row, "resign", hops)
    log.info("chess: player resigned tag=%s", row["tag"])
    return {"game": cg.player_view(row)}


# ── Owner ─────────────────────────────────────────────────────────────────────


class _OwnerReq(BaseModel):
    visitor_id: str | None = None
    run_id: str | None = None
    uci: str | None = None


def _owner_result(row) -> dict:
    # "player" is for the gateway only (email notice); it strips it.
    return {"game": cg.owner_view(row),
            "player": {"account_id": row["account_id"], "visitor_id": row["visitor_id"]}}


@router.get("/owner/games")
async def owner_list():
    return {"games": [cg.owner_view(r) for r in await cg.owner_games(state.pool)]}


@router.get("/owner/games/{game_id}")
async def owner_get(game_id: str):
    try:
        return {"game": cg.owner_view(await cg.owner_game(state.pool, game_id))}
    except cg.ChessError as e:
        return _err(e)


@router.post("/owner/games/{game_id}/move")
async def owner_move(game_id: str, body: _OwnerReq):
    hops = _Hops(body.visitor_id, body.run_id)
    try:
        row = await _saving(hops, cg.owner_move(state.pool, game_id, body.uci or ""))
    except cg.ChessError as e:
        return _err(e)
    await _notify_player(row, "move", hops)
    return _owner_result(row)


@router.post("/owner/games/{game_id}/resign")
async def owner_resign(game_id: str, body: _OwnerReq):
    hops = _Hops(body.visitor_id, body.run_id)
    try:
        row = await _saving(hops, cg.owner_resign(state.pool, game_id))
    except cg.ChessError as e:
        return _err(e)
    await _notify_player(row, "resign", hops)
    log.info("chess: owner resigned tag=%s", row["tag"])
    return _owner_result(row)
