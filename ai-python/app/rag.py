import asyncio
import json
import logging
from dataclasses import dataclass

import asyncpg
import numpy as np
from sentence_transformers import SentenceTransformer

log = logging.getLogger(__name__)

_MODEL_NAME = "all-MiniLM-L6-v2"
SIMILARITY_THRESHOLD = 0.75
_TOP_K = 5


@dataclass
class RagHit:
    node_id: str
    title: str
    score: float
    source: str
    body: str


class EmbeddingModel:
    def __init__(self) -> None:
        log.info("loading embedding model %s", _MODEL_NAME)
        self._model = SentenceTransformer(_MODEL_NAME)
        log.info("embedding model ready")

    def embed(self, text: str) -> np.ndarray:
        return self._model.encode(text, normalize_embeddings=True)

    def embed_many(self, texts: list[str]) -> np.ndarray:
        return self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


async def search(
    query: str,
    model: EmbeddingModel,
    pool: asyncpg.Pool,
    threshold: float = SIMILARITY_THRESHOLD,
    top_k: int = _TOP_K,
) -> list[RagHit]:
    loop = asyncio.get_running_loop()
    q_emb = await loop.run_in_executor(None, model.embed, query)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT node_id, title, source, body,
                   1 - (embedding <=> $1) AS score
            FROM rag_fragments
            ORDER BY embedding <=> $1
            LIMIT $2
            """,
            q_emb,
            top_k,
        )

    return [
        RagHit(
            node_id=row["node_id"],
            title=row["title"],
            score=float(row["score"]),
            source=row["source"],
            body=row["body"],
        )
        for row in rows
        if float(row["score"]) >= threshold
    ]


async def ingest(portfolio_path: str, model: EmbeddingModel, pool: asyncpg.Pool) -> int:
    """Embed portfolio nodes and store in rag_fragments. Truncates and re-inserts (idempotent)."""
    with open(portfolio_path, encoding="utf-8") as f:
        data = json.load(f)

    fragments = []
    for node in data.get("nodes", []):
        summary = node.get("summary", "").strip()
        keywords = node.get("keywords", [])
        if not summary and len(keywords) < 2:
            continue
        body_parts = [f"{node['label']}: {summary}."]
        if keywords:
            body_parts.append(f"Palabras clave: {', '.join(keywords)}.")
        fragments.append({
            "node_id": node["id"],
            "source": "portfolio",
            "title": node.get("label", node["id"]),
            "body": " ".join(body_parts),
        })

    if not fragments:
        log.warning("no fragments to ingest from %s", portfolio_path)
        return 0

    log.info("embedding %d fragments...", len(fragments))
    texts = [f["body"] for f in fragments]
    # CPU-bound; OK to block here since this only runs before the app accepts requests
    embeddings = model.embed_many(texts)

    async with pool.acquire() as conn:
        await conn.execute("TRUNCATE rag_fragments RESTART IDENTITY")
        await conn.executemany(
            """
            INSERT INTO rag_fragments (node_id, source, title, body, embedding)
            VALUES ($1, $2, $3, $4, $5)
            """,
            [
                (f["node_id"], f["source"], f["title"], f["body"], emb)
                for f, emb in zip(fragments, embeddings)
            ],
        )

    log.info("ingested %d fragments", len(fragments))
    return len(fragments)
