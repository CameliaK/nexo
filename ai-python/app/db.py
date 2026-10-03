import logging

import asyncpg
from pgvector.asyncpg import register_vector

log = logging.getLogger(__name__)

_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    """
    CREATE TABLE IF NOT EXISTS rag_fragments (
      id        SERIAL PRIMARY KEY,
      node_id   TEXT NOT NULL,
      source    TEXT NOT NULL DEFAULT 'portfolio',
      title     TEXT NOT NULL,
      body      TEXT NOT NULL,
      embedding vector(384) NOT NULL
    )
    """,
    # HNSW index works on empty tables; no need to pre-populate like IVFFlat
    """
    CREATE INDEX IF NOT EXISTS rag_fragments_emb_idx
      ON rag_fragments USING hnsw (embedding vector_cosine_ops)
    """,
    """
    CREATE TABLE IF NOT EXISTS generated_nodes (
      id         TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      node       JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS generated_nodes_visitor_idx
      ON generated_nodes (visitor_id)
    """,
    """
    CREATE TABLE IF NOT EXISTS live_messages (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL,
      visitor_id       TEXT NOT NULL,
      from_kind        TEXT NOT NULL CHECK (from_kind IN ('visitor', 'owner')),
      name             TEXT,
      text             TEXT NOT NULL,
      telegram_msg_id  INTEGER,
      ts               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS live_messages_visitor
      ON live_messages (visitor_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS live_messages_conv
      ON live_messages (conversation_id)
    """,
]


async def create_pool(url: str) -> asyncpg.Pool:
    # register_vector needs the vector type to already exist; bootstrap it first
    bootstrap = await asyncpg.connect(url)
    try:
        await bootstrap.execute("CREATE EXTENSION IF NOT EXISTS vector")
    finally:
        await bootstrap.close()

    pool = await asyncpg.create_pool(url, init=register_vector, min_size=1, max_size=5)
    async with pool.acquire() as conn:
        for stmt in _STATEMENTS[1:]:  # extension already created above
            stmt = stmt.strip()
            if stmt:
                await conn.execute(stmt)
    log.info("db schema ready")
    return pool


async def count_fragments(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM rag_fragments")
        return int(row["n"])
