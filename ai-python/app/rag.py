import asyncio
import json
import logging
from dataclasses import dataclass

import asyncpg
import numpy as np
from sentence_transformers import SentenceTransformer

log = logging.getLogger(__name__)

# Multilingual since the 2026-10-06 calibration (docs/eval/resultados.md):
# all-MiniLM-L6-v2 scored by language rather than meaning on this Spanish
# content. Same dimension (384), so rag_fragments.embedding is unchanged.
# Pinned to a commit; the Dockerfile bakes this exact revision.
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
# Bump when build_fragments changes the stored text: forces a re-ingestion.
FRAGMENTS_VERSION = "2"
_SIMILARITY_THRESHOLD_DEFAULT = 0.35
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
        log.info("loading embedding model %s", MODEL_NAME)
        self._model = SentenceTransformer(MODEL_NAME, revision=MODEL_REVISION)
        log.info("embedding model ready")

    def embed(self, text: str) -> np.ndarray:
        return self._model.encode(text, normalize_embeddings=True)

    def embed_many(self, texts: list[str]) -> np.ndarray:
        return self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


async def search(
    query: str,
    model: EmbeddingModel,
    pool: asyncpg.Pool,
    threshold: float = _SIMILARITY_THRESHOLD_DEFAULT,
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

    hits = []
    for row in rows:
        score = float(row["score"])
        log.debug("rag candidate: %s score=%.4f threshold=%.2f", row["title"], score, threshold)
        if score >= threshold:
            hits.append(RagHit(
                node_id=row["node_id"],
                title=row["title"],
                score=score,
                source=row["source"],
                body=row["body"],
            ))
    log.info("rag search '%s': %d/%d rows above threshold %.2f", query[:60], len(hits), len(rows), threshold)
    return hits


def _content_text(content) -> str:
    """Flattens a node's content (body, items, entries…) into plain text."""
    out: list[str] = []

    def walk(v):
        if isinstance(v, str):
            out.append(v.strip())
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(content)
    return " ".join(x for x in out if x)


def build_fragments(data: dict, with_content: bool = True) -> list[dict]:
    """One fragment per portfolio node with something to say: label, summary,
    keywords and (with_content) the node's own content text. Shared by the
    ingestion and docs/eval, so both embed exactly the same text; the content
    was added after the 2026-10-06 calibration (docs/eval/resultados.md)."""
    fragments = []
    for node in data.get("nodes", []):
        summary = (node.get("summary") or "").strip()
        keywords = node.get("keywords") or []
        if not summary and len(keywords) < 2:
            continue
        body_parts = [f"{node['label']}: {summary}."]
        if keywords:
            body_parts.append(f"Palabras clave: {', '.join(keywords)}.")
        if with_content:
            extra = _content_text(node.get("content"))
            if extra:
                body_parts.append(extra)
        fragments.append({
            "node_id": node["id"],
            "source": "portfolio",
            "title": node.get("label", node["id"]),
            "body": " ".join(body_parts),
        })
    return fragments


def ingestion_stamp() -> str:
    """What the stored fragments were built with; a mismatch at startup means
    they must be re-embedded."""
    return f"{MODEL_NAME}@{MODEL_REVISION[:12]}#fragments-v{FRAGMENTS_VERSION}"


async def stored_stamp(pool: asyncpg.Pool) -> str | None:
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT value FROM rag_meta WHERE key = 'ingestion'")


async def ingest(portfolio_path: str, model: EmbeddingModel, pool: asyncpg.Pool) -> int:
    """Embed portfolio nodes and store in rag_fragments. Truncates and re-inserts (idempotent)."""
    with open(portfolio_path, encoding="utf-8") as f:
        data = json.load(f)

    fragments = build_fragments(data)

    if not fragments:
        log.warning("no fragments to ingest from %s", portfolio_path)
        return 0

    log.info("embedding %d fragments...", len(fragments))
    texts = [f["body"] for f in fragments]
    # CPU-bound; OK to block here since this only runs before the app accepts requests
    embeddings = model.embed_many(texts)

    async with pool.acquire() as conn, conn.transaction():
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
        await conn.execute(
            """INSERT INTO rag_meta (key, value) VALUES ('ingestion', $1)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
            ingestion_stamp(),
        )

    log.info("ingested %d fragments", len(fragments))
    return len(fragments)
