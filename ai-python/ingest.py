#!/usr/bin/env python3
"""
Re-ingestion script: embeds docs/portfolio-content.json and loads it into
the rag_fragments table (truncates and re-inserts — safe to re-run).

Usage (from inside the container):
  docker compose exec agent python ingest.py
"""
import asyncio
import logging

import asyncpg
from pgvector.asyncpg import register_vector

from app.config import load
from app.rag import EmbeddingModel, ingest

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


async def main() -> None:
    cfg = load()
    model = EmbeddingModel()
    pool = await asyncpg.create_pool(cfg.postgres_url, init=register_vector, min_size=1, max_size=1)
    try:
        count = await ingest(cfg.portfolio_path, model, pool)
        print(f"✓ {count} fragments ingested", flush=True)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
