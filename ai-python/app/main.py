import json
import logging
from contextlib import asynccontextmanager

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

# from .llm.gemini import GeminiProvider  # disponible si se vuelve a Gemini

log = logging.getLogger(__name__)

cfg = load()

_portfolio: dict = {}
_llm: DeepSeekProvider | None = None
_rdb: aioredis.Redis | None = None
_db_pool: asyncpg.Pool | None = None
_rag_model: rag_mod.EmbeddingModel | None = None


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
