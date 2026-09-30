from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from .agent.router import run as run_agent
from .config import load
from .llm.gemini import GeminiProvider
from .portfolio import load_portfolio

cfg = load()

_portfolio: dict = {}
_llm: GeminiProvider | None = None
_rdb: aioredis.Redis | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _portfolio, _llm, _rdb

    _portfolio = load_portfolio(cfg.portfolio_path)
    print(f"portfolio loaded ({len(_portfolio)} nodes)", flush=True)

    _llm = GeminiProvider(api_key=cfg.gemini_api_key, model=cfg.gemini_model)
    print("llm ready", flush=True)

    _rdb = aioredis.Redis.from_url(cfg.redis_url, decode_responses=True)
    print("redis connected", flush=True)

    yield

    if _rdb:
        await _rdb.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "agent"}


class _ChatRequest(BaseModel):
    run_id: str
    visitor_id: str
    input: str
    seq_start: int


@app.post("/internal/chat", status_code=202)
async def internal_chat(body: _ChatRequest, background_tasks: BackgroundTasks):
    if _rdb is None or _llm is None:
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
        route_threshold=cfg.route_confidence_threshold,
    )
    return {"status": "accepted"}
