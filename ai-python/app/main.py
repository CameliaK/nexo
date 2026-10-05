import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from pydantic import BaseModel

from .agent.router import run as run_agent
from .config import load
from . import db as db_mod
from . import rag as rag_mod
from . import node_builder
from . import chess_api
from . import chess_game
from .events import EventPublisher
from .llm.budget import BudgetedLLM, LLMBudgetExceeded
from .llm.deepseek import DeepSeekProvider

log = logging.getLogger(__name__)

cfg = load()

_portfolio: dict = {}
_llm: BudgetedLLM | None = None
_rdb: aioredis.Redis | None = None
_db_pool: asyncpg.Pool | None = None
_rag_model: rag_mod.EmbeddingModel | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _portfolio, _llm, _rdb, _db_pool, _rag_model

    from .portfolio import load_portfolio
    _portfolio = load_portfolio(cfg.portfolio_path)
    log.info("portfolio loaded (%d nodes)", len(_portfolio))

    _rdb = aioredis.Redis.from_url(cfg.redis_url, decode_responses=True)
    log.info("redis connected")

    _llm = BudgetedLLM(
        DeepSeekProvider(api_key=cfg.deepseek_api_key, model=cfg.deepseek_model),
        _rdb,
        cfg.llm_daily_calls,
    )
    log.info("llm ready (daily budget %d calls)", cfg.llm_daily_calls)

    _db_pool = await db_mod.create_pool(cfg.postgres_url)

    _rag_model = rag_mod.EmbeddingModel()

    fragment_count = await db_mod.count_fragments(_db_pool)
    if fragment_count == 0:
        log.info("rag_fragments is empty — running auto-ingestion")
        count = await rag_mod.ingest(cfg.portfolio_path, _rag_model, _db_pool)
        log.info("auto-ingested %d fragments", count)
    else:
        log.info("rag_fragments has %d fragments", fragment_count)

    chess_api.init(
        _rdb,
        _db_pool,
        max_active=cfg.chess_max_active,
        expiry=chess_game.Expiry(idle_days=cfg.chess_expire_days, empty_hours=cfg.chess_empty_expire_hours),
    )
    chess_sweeper = asyncio.create_task(chess_api.expiry_loop())
    log.info("chess ready (max %d active, expire %dd idle / %dh without moves)",
             cfg.chess_max_active, cfg.chess_expire_days, cfg.chess_empty_expire_hours)

    yield

    chess_sweeper.cancel()

    if _rdb:
        await _rdb.aclose()
    if _db_pool:
        await _db_pool.close()


app = FastAPI(lifespan=lifespan)
app.include_router(chess_api.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "agent"}


# ── Internal chat endpoint (called by gateway) ────────────────────────────────

class _ChatRequest(BaseModel):
    run_id: str
    visitor_id: str
    input: str
    seq_start: int


@app.post("/internal/chat", status_code=202)
async def internal_chat(body: _ChatRequest, background_tasks: BackgroundTasks):
    if _rdb is None or _llm is None or _db_pool is None or _rag_model is None:
        raise HTTPException(status_code=503, detail="service not ready")

    background_tasks.add_task(
        run_agent,
        run_id=body.run_id,
        visitor_id=body.visitor_id,
        input_text=body.input,
        seq_start=body.seq_start,
        rdb=_rdb,
        llm=_llm,
        portfolio=_portfolio,
        db_pool=_db_pool,
        rag_model=_rag_model,
        route_threshold=cfg.route_confidence_threshold,
        n8n_webhook_url=cfg.n8n_webhook_url,
    )
    return {"status": "accepted"}


# ── Internal session/nodes endpoints (proxied by gateway) ────────────────────

@app.get("/internal/session/nodes")
async def list_session_nodes(visitor_id: str = Query(...)):
    if _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")
    nodes = await node_builder.list_nodes(visitor_id, _db_pool)
    return {"nodes": nodes}


@app.delete("/internal/session/nodes/{node_id}", status_code=204)
async def delete_session_node(node_id: str, visitor_id: str = Query(...)):
    if _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")
    deleted = await node_builder.delete_node(node_id, visitor_id, _db_pool)
    if not deleted:
        raise HTTPException(status_code=404, detail="node not found")


# ── Internal endpoints called by n8n ─────────────────────────────────────────
# These do pure compute or DB work; they never publish events themselves.
# n8n publishes events by calling /internal/events below.


class _InternalEventItem(BaseModel):
    type: str
    data: dict


class _EventsRequest(BaseModel):
    visitor_id: str
    run_id: str
    events: list[_InternalEventItem]


@app.post("/internal/events")
async def internal_events(body: _EventsRequest):
    """Publish a batch of events to the visitor's Redis channel.

    Validates that (run_id, visitor_id) corresponds to an active run — the
    agent sets run:{run_id}:visitor when the background task starts.  A 404
    here is intentional: it means the run expired (TTL 3600 s) or never
    existed, so late events are silently discarded rather than polluting an
    unrelated channel.
    """
    if _rdb is None:
        raise HTTPException(status_code=503, detail="service not ready")

    stored_visitor = await _rdb.get(f"run:{body.run_id}:visitor")
    if stored_visitor is None or stored_visitor != body.visitor_id:
        raise HTTPException(status_code=404, detail="run not found or visitor_id mismatch")

    channel = f"events:{body.visitor_id}"
    counter_key = f"run:{body.run_id}:seq"

    for event in body.events:
        seq = int(await _rdb.incr(counter_key))
        envelope = {
            "v": 2,
            "type": event.type,
            "run_id": body.run_id,
            "seq": seq,
            "ts": _now_iso(),
            "data": event.data,
        }
        await _rdb.publish(channel, json.dumps(envelope))

    return {"published": len(body.events)}


class _RagSearchRequest(BaseModel):
    run_id: str
    visitor_id: str
    query: str


@app.post("/internal/rag_search")
async def internal_rag_search(body: _RagSearchRequest):
    """Semantic search via pgvector.  Checks visitor node cap; returns used=False if at limit."""
    if _db_pool is None or _rag_model is None:
        raise HTTPException(status_code=503, detail="service not ready")

    hits = await rag_mod.search(body.query, _rag_model, _db_pool, threshold=cfg.rag_similarity_threshold)
    used = len(hits) > 0

    if used:
        count = await node_builder.count_visitor_nodes(body.visitor_id, _db_pool)
        if count >= node_builder.NODES_PER_VISITOR:
            log.info("visitor %s at node limit (%d), used=False", body.visitor_id, count)
            used = False

    return {
        "hits": [
            {
                "node_id": h.node_id,
                "title": h.title,
                "score": round(h.score, 3),
                "source": h.source,
                "body": h.body,
            }
            for h in hits
        ],
        "used": used,
    }


class _DesignNodeRequest(BaseModel):
    run_id: str
    visitor_id: str
    question: str
    hits: list[dict]


@app.post("/internal/design_node")
async def internal_design_node(body: _DesignNodeRequest):
    """Ask the LLM to design a GeneratedNode from RAG hits.  Returns node or null."""
    if _llm is None:
        raise HTTPException(status_code=503, detail="service not ready")

    rag_hits = [
        rag_mod.RagHit(
            node_id=h.get("node_id", ""),
            title=h.get("title", ""),
            score=float(h.get("score", 0.0)),
            source=h.get("source", ""),
            body=h.get("body", ""),
        )
        for h in body.hits
    ]

    try:
        node = await node_builder.design_node(body.question, rag_hits, _llm)
    except LLMBudgetExceeded:
        # n8n's flow fails on this; the agent then reports the spent budget.
        raise HTTPException(status_code=503, detail="llm daily budget spent")
    return {"node": node}


class _SaveNodeRequest(BaseModel):
    run_id: str
    visitor_id: str
    node: dict


@app.post("/internal/save_node")
async def internal_save_node(body: _SaveNodeRequest):
    """Persist a generated node to Postgres.  Returns anchor node_id for node.spawn."""
    if _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")

    await node_builder.save_node(body.node, body.visitor_id, _db_pool)

    anchor: str | None = None
    sources = body.node.get("sources", [])
    if sources:
        anchor = sources[0].get("ref")

    return {"saved": True, "anchor": anchor}


# ── Live chat endpoints ───────────────────────────────────────────────────────


async def _run_live_out(
    *,
    run_id: str,
    visitor_id: str,
    message_id: str,
    text: str,
    name: str | None,
    seq_start: int,
    rdb: aioredis.Redis,
    db_pool: asyncpg.Pool,
    n8n_url: str,
) -> None:
    conversation_id = f"conv:{visitor_id}"
    await rdb.set(f"run:{run_id}:seq", seq_start - 1, ex=3600)
    pub = EventPublisher(rdb, visitor_id, run_id)

    ts = datetime.now(timezone.utc)
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO live_messages
                     (id, conversation_id, visitor_id, from_kind, name, text, ts)
                   VALUES ($1, $2, $3, 'visitor', $4, $5, $6)""",
                message_id, conversation_id, visitor_id, name, text, ts,
            )
    except Exception as exc:
        log.error("live_out: db insert failed run=%s: %s", run_id, exc)
        await pub.publish("run.error", {"code": "internal", "message": "Error al guardar el mensaje.", "retryable": True})
        return

    await pub.publish("trace.hop", {"hop_id": "h1", "from": "gateway", "to": "postgres", "phase": "start", "label": "Guardando mensaje"})
    await pub.publish("trace.hop", {"hop_id": "h1", "from": "gateway", "to": "postgres", "phase": "end", "duration_ms": 0})
    await pub.publish("trace.hop", {"hop_id": "h2", "from": "gateway", "to": "n8n", "phase": "start", "label": "Enviando notificación"})

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(n8n_url, json={
                "visitor_id": visitor_id,
                "message_id": message_id,
                "text": text,
                "name": name or "visitante",
                "run_id": run_id,
                "telegram_bot_token": cfg.telegram_bot_token,
                "telegram_chat_id": cfg.telegram_chat_id,
            })

        if resp.status_code == 200:
            data = resp.json()
            telegram_msg_id = data.get("telegram_msg_id")
            if telegram_msg_id:
                async with db_pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE live_messages SET telegram_msg_id=$1 WHERE id=$2",
                        telegram_msg_id, message_id,
                    )
            await pub.publish("live.delivery", {"message_id": message_id, "status": "sent"})
            await pub.publish("trace.hop", {"hop_id": "h3", "from": "n8n", "to": "owner_channel", "phase": "start", "label": "Enviando a Telegram"})
            await pub.publish("trace.hop", {"hop_id": "h3", "from": "n8n", "to": "owner_channel", "phase": "end", "duration_ms": 0})
            await pub.publish("trace.hop", {"hop_id": "h2", "from": "gateway", "to": "n8n", "phase": "end", "duration_ms": 0})
            await pub.publish("live.delivery", {"message_id": message_id, "status": "delivered_to_owner"})
            await pub.publish("run.done", {"outcome": "delivered"})
        else:
            log.warning("live_out: n8n returned %d run=%s", resp.status_code, run_id)
            await pub.publish("trace.hop", {"hop_id": "h2", "from": "gateway", "to": "n8n", "phase": "error", "detail": "Error en la notificación"})
            await pub.publish("run.error", {"code": "delivery_failed", "message": "No se pudo enviar el mensaje.", "retryable": True})

    except Exception as exc:
        log.error("live_out: n8n call failed run=%s: %s", run_id, exc)
        await pub.publish("trace.hop", {"hop_id": "h2", "from": "gateway", "to": "n8n", "phase": "error", "detail": str(exc)[:100]})
        await pub.publish("run.error", {"code": "internal", "message": "Error de conexión interna.", "retryable": True})


class _LiveMessageRequest(BaseModel):
    run_id: str
    visitor_id: str
    message_id: str
    text: str
    name: str | None = None
    seq_start: int


@app.post("/internal/live/messages", status_code=202)
async def internal_live_messages(body: _LiveMessageRequest, background_tasks: BackgroundTasks):
    if _rdb is None or _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")
    background_tasks.add_task(
        _run_live_out,
        run_id=body.run_id,
        visitor_id=body.visitor_id,
        message_id=body.message_id,
        text=body.text,
        name=body.name,
        seq_start=body.seq_start,
        rdb=_rdb,
        db_pool=_db_pool,
        n8n_url=cfg.n8n_live_outbound_url,
    )
    return {"status": "accepted"}


@app.get("/internal/live/messages")
async def internal_live_list(visitor_id: str = Query(...)):
    if _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")
    async with _db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, from_kind, text, ts FROM live_messages WHERE visitor_id=$1 ORDER BY ts ASC",
            visitor_id,
        )
    if not rows:
        return {"conversation_id": None, "messages": []}
    return {
        "conversation_id": f"conv:{visitor_id}",
        "messages": [
            {
                "id": r["id"],
                "from": r["from_kind"],
                "text": r["text"],
                "ts": r["ts"].isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            }
            for r in rows
        ],
    }


async def _dispatch_owner_reply(
    telegram_reply_to_id: int,
    text: str,
    rdb: aioredis.Redis,
    db_pool: asyncpg.Pool,
) -> bool:
    """Saves an owner reply and publishes live_in events. Returns False if message not found."""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT visitor_id, conversation_id FROM live_messages WHERE telegram_msg_id=$1",
            telegram_reply_to_id,
        )

    if not row:
        return False

    visitor_id = row["visitor_id"]
    conversation_id = row["conversation_id"]
    message_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc)

    async with db_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO live_messages (id, conversation_id, visitor_id, from_kind, text, ts)
               VALUES ($1, $2, $3, 'owner', $4, $5)""",
            message_id, conversation_id, visitor_id, text, ts,
        )

    run_id = str(uuid.uuid4())
    await rdb.set(f"run:{run_id}:seq", 0, ex=3600)
    pub = EventPublisher(rdb, visitor_id, run_id)

    ts_str = ts.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    await pub.publish("run.start", {"kind": "live_in", "content_version": 2})
    await pub.publish("trace.hop", {"hop_id": "h1", "from": "owner_channel", "to": "n8n", "phase": "start", "label": "Respuesta del dueño"})
    await pub.publish("trace.hop", {"hop_id": "h1", "from": "owner_channel", "to": "n8n", "phase": "end", "duration_ms": 0})
    await pub.publish("trace.hop", {"hop_id": "h2", "from": "n8n", "to": "postgres", "phase": "start", "label": "Guardando respuesta"})
    await pub.publish("trace.hop", {"hop_id": "h2", "from": "n8n", "to": "postgres", "phase": "end", "duration_ms": 0})
    await pub.publish("trace.hop", {"hop_id": "h3", "from": "n8n", "to": "redis", "phase": "start", "label": "Publicando evento"})
    await pub.publish("live.message", {
        "conversation_id": conversation_id,
        "message": {"id": message_id, "from": "owner", "text": text, "ts": ts_str},
    })
    await pub.publish("trace.hop", {"hop_id": "h3", "from": "n8n", "to": "redis", "phase": "end", "duration_ms": 0})
    await pub.publish("run.done", {"outcome": "received"})
    return True


class _OwnerReplyRequest(BaseModel):
    telegram_reply_to_id: int
    text: str


@app.post("/internal/live/owner-reply")
async def internal_live_owner_reply(body: _OwnerReplyRequest):
    if _rdb is None or _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")
    found = await _dispatch_owner_reply(body.telegram_reply_to_id, body.text, _rdb, _db_pool)
    if not found:
        raise HTTPException(status_code=422, detail="reply to unknown message")
    return {"ok": True}


@app.post("/internal/telegram/poll")
async def internal_telegram_poll():
    """Called by n8n on a schedule to poll Telegram for owner replies."""
    if _rdb is None or _db_pool is None:
        raise HTTPException(status_code=503, detail="service not ready")

    token = cfg.telegram_bot_token
    if not token:
        raise HTTPException(status_code=503, detail="Telegram not configured")

    offset_key = "telegram:poll:offset"
    raw = await _rdb.get(offset_key)
    offset = int(raw) if raw else 0

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params={"offset": offset, "timeout": 1, "allowed_updates": "message"},
            )
        data = resp.json()
    except Exception as exc:
        log.error("telegram poll failed: %s", exc)
        return {"processed": 0, "error": str(exc)}

    if not data.get("ok") or not data.get("result"):
        return {"processed": 0}

    updates = data["result"]
    await _rdb.set(offset_key, updates[-1]["update_id"] + 1)

    processed = 0
    for update in updates:
        msg = update.get("message", {})
        if not msg.get("reply_to_message") or not msg.get("text"):
            continue
        try:
            found = await _dispatch_owner_reply(
                msg["reply_to_message"]["message_id"],
                msg["text"],
                _rdb,
                _db_pool,
            )
            if found:
                processed += 1
            else:
                log.warning("telegram poll: reply to unknown telegram_msg_id=%d", msg["reply_to_message"]["message_id"])
        except Exception as exc:
            log.error("telegram poll: error processing reply: %s", exc)

    return {"processed": processed, "total_updates": len(updates)}
