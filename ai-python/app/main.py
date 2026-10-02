import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg
import redis.asyncio as aioredis
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from pydantic import BaseModel

from .agent.router import run as run_agent
from .config import load
from . import db as db_mod
from . import rag as rag_mod
from . import node_builder
from .llm.deepseek import DeepSeekProvider

log = logging.getLogger(__name__)

cfg = load()

_portfolio: dict = {}
_llm: DeepSeekProvider | None = None
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

    _llm = DeepSeekProvider(api_key=cfg.deepseek_api_key, model=cfg.deepseek_model)
    log.info("llm ready")

    _rdb = aioredis.Redis.from_url(cfg.redis_url, decode_responses=True)
    log.info("redis connected")

    _db_pool = await db_mod.create_pool(cfg.postgres_url)

    _rag_model = rag_mod.EmbeddingModel()

    fragment_count = await db_mod.count_fragments(_db_pool)
    if fragment_count == 0:
        log.info("rag_fragments is empty — running auto-ingestion")
        count = await rag_mod.ingest(cfg.portfolio_path, _rag_model, _db_pool)
        log.info("auto-ingested %d fragments", count)
    else:
        log.info("rag_fragments has %d fragments", fragment_count)

    yield

    if _rdb:
        await _rdb.aclose()
    if _db_pool:
        await _db_pool.close()


app = FastAPI(lifespan=lifespan)


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

    node = await node_builder.design_node(body.question, rag_hits, _llm)
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
