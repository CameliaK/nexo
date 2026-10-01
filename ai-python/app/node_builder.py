import json
import logging
import re
from datetime import datetime, timezone
from uuid import uuid4

import asyncpg

from .llm.base import LLMProvider
from .rag import RagHit

log = logging.getLogger(__name__)

NODES_PER_VISITOR = 12

_CLOSED_LAYOUTS = {"text", "list", "timeline", "tags", "metrics"}
_LABEL_MAX = 40
_SUMMARY_MAX = 160
_BODY_MAX = 600
_LIST_MAX = 8
_TIMELINE_MAX = 8
_TAGS_MAX = 12
_METRICS_MAX = 6
_CHILDREN_MAX = 4


# ── DB helpers ────────────────────────────────────────────────────────────────

async def count_visitor_nodes(visitor_id: str, pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS n FROM generated_nodes WHERE visitor_id = $1",
            visitor_id,
        )
        return int(row["n"])


async def save_node(node: dict, visitor_id: str, pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO generated_nodes (id, visitor_id, node)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (id) DO NOTHING
            """,
            node["id"],
            visitor_id,
            json.dumps(node),
        )


async def list_nodes(visitor_id: str, pool: asyncpg.Pool) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT node FROM generated_nodes WHERE visitor_id = $1 ORDER BY created_at",
            visitor_id,
        )
    return [json.loads(row["node"]) for row in rows]


async def delete_node(node_id: str, visitor_id: str, pool: asyncpg.Pool) -> bool:
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM generated_nodes WHERE id = $1 AND visitor_id = $2",
            node_id,
            visitor_id,
        )
    # result is "DELETE N"; N > 0 means a row was deleted
    return result.endswith("1")


# ── Node design ───────────────────────────────────────────────────────────────

async def design_node(
    question: str,
    hits: list[RagHit],
    llm: LLMProvider,
) -> dict | None:
    """Ask the LLM to design a GeneratedNode. Returns validated dict or None on failure."""
    system = _design_prompt(question, hits)

    try:
        raw = await llm.complete(system=system, user=question)
    except Exception:
        log.exception("LLM design_node call failed")
        return None

    node = _parse_and_validate(raw, hits)
    if node is not None:
        return node

    log.warning("node design attempt 1 produced invalid output, retrying")
    retry_system = (
        f"Tu respuesta anterior no era JSON válido o no cumplía el esquema requerido.\n"
        f"Responde ÚNICAMENTE con JSON, sin ningún texto extra.\n\n{system}"
    )
    try:
        raw2 = await llm.complete(system=retry_system, user=question)
    except Exception:
        log.exception("LLM design_node retry failed")
        return None

    return _parse_and_validate(raw2, hits)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _design_prompt(question: str, hits: list[RagHit]) -> str:
    context = "\n\n".join(
        f"Fuente: {h.title} (similitud: {h.score:.2f})\n{h.body}"
        for h in hits
    )
    return f"""Eres el agente del portafolio de Kirbith Cubillas.
El visitante preguntó: "{question}"

Información relevante encontrada:
{context}

Diseña un nodo del portafolio que responda la pregunta usando SOLO la información anterior.

RESPONDE ÚNICAMENTE con JSON válido, sin markdown, sin backticks, sin texto extra:

{{
  "label": "Título (máximo 40 caracteres)",
  "summary": "Resumen del nodo (máximo 160 caracteres)",
  "layout": "tags",
  "content": {{"tags": ["tag1", "tag2", "tag3"]}},
  "children": []
}}

Reglas ESTRICTAS:
- "layout" debe ser uno de: "text", "list", "timeline", "tags", "metrics"
- layout "text"     → content: {{"body": "texto (máximo 600 caracteres)"}}
- layout "list"     → content: {{"items": ["item1", ...] (máximo 8 ítems)}}
- layout "timeline" → content: {{"entries": [{{"when": "fecha", "what": "desc"}}] (máximo 8)}}
- layout "tags"     → content: {{"tags": ["tag1", ...] (máximo 12 tags)}}
- layout "metrics"  → content: {{"items": [{{"label": "nombre", "value": "cifra"}}] (máximo 6)}}
- "children": lista de hasta 4 nodos hijo; cada hijo tiene la misma estructura sin "children"
- Todo en texto plano (sin HTML, sin markdown)
- No inventes información fuera de lo que aparece en las fuentes"""


def _parse_and_validate(raw: str, hits: list[RagHit]) -> dict | None:
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return None
        data = json.loads(m.group())
    except (json.JSONDecodeError, AttributeError):
        return None
    return _validate_node(data, hits)


def _validate_node(raw: dict, hits: list[RagHit]) -> dict | None:
    try:
        layout = str(raw.get("layout", ""))
        if layout not in _CLOSED_LAYOUTS:
            log.warning("invalid layout %r", layout)
            return None

        label = str(raw.get("label", "")).strip()[:_LABEL_MAX]
        summary = str(raw.get("summary", "")).strip()[:_SUMMARY_MAX]
        if not label or not summary:
            return None

        content = _validate_content(layout, raw.get("content", {}))
        if content is None:
            return None

        children_raw = raw.get("children", [])
        children = [
            c for c in (_validate_child(cr) for cr in (children_raw or [])[:_CHILDREN_MAX])
            if c is not None
        ]

        sources = [{"title": h.title, "ref": h.node_id} for h in hits]

        return {
            "id": f"gen_{uuid4().hex[:12]}",
            "label": label,
            "summary": summary,
            "sources": sources,
            "layout": layout,
            "content": content,
            "children": children,
            "generated": True,
            "created_at": _now_iso(),
        }
    except Exception:
        log.exception("node validation error")
        return None


def _validate_child(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    layout = str(raw.get("layout", ""))
    if layout not in _CLOSED_LAYOUTS:
        return None
    label = str(raw.get("label", "")).strip()[:_LABEL_MAX]
    summary = str(raw.get("summary", "")).strip()[:_SUMMARY_MAX]
    if not label or not summary:
        return None
    content = _validate_content(layout, raw.get("content", {}))
    if content is None:
        return None
    return {
        "id": f"gen_{uuid4().hex[:12]}",
        "label": label,
        "summary": summary,
        "sources": [],
        "layout": layout,
        "content": content,
        "generated": True,
        "created_at": _now_iso(),
    }


def _validate_content(layout: str, raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None

    if layout == "text":
        body = str(raw.get("body", "")).strip()[:_BODY_MAX]
        return {"body": body} if body else None

    if layout == "list":
        items = raw.get("items", [])
        if not isinstance(items, list):
            return None
        items = [str(x).strip() for x in items[:_LIST_MAX] if str(x).strip()]
        return {"items": items} if items else None

    if layout == "timeline":
        entries = raw.get("entries", [])
        if not isinstance(entries, list):
            return None
        valid = [
            {"when": str(e["when"]).strip(), "what": str(e["what"]).strip()}
            for e in entries[:_TIMELINE_MAX]
            if isinstance(e, dict) and e.get("when") and e.get("what")
        ]
        return {"entries": valid} if valid else None

    if layout == "tags":
        tags = raw.get("tags", [])
        if not isinstance(tags, list):
            return None
        tags = [str(x).strip() for x in tags[:_TAGS_MAX] if str(x).strip()]
        return {"tags": tags} if tags else None

    if layout == "metrics":
        items = raw.get("items", [])
        if not isinstance(items, list):
            return None
        valid = [
            {"label": str(i["label"]).strip(), "value": str(i["value"]).strip()}
            for i in items[:_METRICS_MAX]
            if isinstance(i, dict) and i.get("label") and i.get("value")
        ]
        return {"items": valid} if valid else None

    return None
