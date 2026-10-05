import json
import logging
import re
import time
from typing import AsyncIterator  # noqa: F401 — kept for LLMProvider type doc

import asyncpg
import httpx
import redis.asyncio as aioredis

from .. import node_builder
from .. import rag as rag_mod
from ..events import EventPublisher
from ..llm.base import LLMProvider
from ..llm.budget import BudgetedLLM, LLMBudgetExceeded
from ..rag import EmbeddingModel

log = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7


class _LLMError(Exception):
    def __init__(self, h2_start: float) -> None:
        self.h2_start = h2_start


class _BudgetError(Exception):
    """The daily LLM budget is spent; no further provider call is made."""
    def __init__(self, h2_start: float) -> None:
        self.h2_start = h2_start


# Same key and compare-and-delete as the gateway (internal/chat): the mark
# holds the run_id, so releasing never frees a newer query's mark.
_RELEASE_ACTIVE = (
    'if redis.call("GET", KEYS[1]) == ARGV[1] then '
    'return redis.call("DEL", KEYS[1]) end return 0'
)


async def _release_active(rdb: aioredis.Redis, visitor_id: str, run_id: str) -> None:
    try:
        await rdb.eval(_RELEASE_ACTIVE, 1, f"chat:active:{visitor_id}", run_id)
    except Exception:
        log.exception("release active query failed run=%s", run_id)


async def _budget_spent(llm: LLMProvider) -> bool:
    try:
        return isinstance(llm, BudgetedLLM) and await llm.exhausted()
    except Exception:
        return False


class _N8NError(Exception):
    """Raised when the n8n webhook call fails; outer handler publishes run.error."""
    def __init__(self, h2_start: float) -> None:
        self.h2_start = h2_start


async def run(
    *,
    run_id: str,
    visitor_id: str,
    input_text: str,
    seq_start: int,
    rdb: aioredis.Redis,
    llm: LLMProvider,
    portfolio: dict[str, dict],
    db_pool: asyncpg.Pool,
    rag_model: EmbeddingModel,
    route_threshold: float = CONFIDENCE_THRESHOLD,
    n8n_webhook_url: str,
) -> None:
    # Initialise the atomic seq counter and run metadata for /internal/events validation.
    # TTL of 3600 s is intentional: a run this stale is already abandoned from the
    # visitor's perspective; any late events would be silently dropped (404 from
    # /internal/events), which is preferable to keeping stale keys forever.
    await rdb.set(f"run:{run_id}:seq",     seq_start - 1, ex=3600)
    await rdb.set(f"run:{run_id}:visitor", visitor_id,    ex=3600)

    pub = EventPublisher(rdb, visitor_id, run_id)
    run_start = time.monotonic()
    h2_start = run_start

    try:
        await pub.publish("process.step", {
            "step": "understand", "status": "active", "label": "Entendiendo la pregunta",
        })

        h2_start = time.monotonic()
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "start", "label": "Envía la pregunta al agente",
        })

        # Daily budget already spent: answer without calling the provider.
        if await _budget_spent(llm):
            raise _BudgetError(h2_start)

        h3_start = time.monotonic()
        await pub.publish("trace.hop", {
            "hop_id": "h3", "from": "agent", "to": "llm",
            "phase": "start", "label": "Entiende la pregunta",
        })

        try:
            result = await _understand(llm, input_text, portfolio)
        except LLMBudgetExceeded as exc:
            h3_ms = int((time.monotonic() - h3_start) * 1000)
            await pub.publish("trace.hop", {
                "hop_id": "h3", "from": "agent", "to": "llm",
                "phase": "error", "detail": "Límite diario del modelo alcanzado", "duration_ms": h3_ms,
            })
            raise _BudgetError(h2_start) from exc
        except Exception as exc:
            log.exception("LLM understand failed run=%s visitor=%s", run_id, visitor_id)
            h3_ms = int((time.monotonic() - h3_start) * 1000)
            await pub.publish("trace.hop", {
                "hop_id": "h3", "from": "agent", "to": "llm",
                "phase": "error", "detail": "El proveedor no respondió", "duration_ms": h3_ms,
            })
            raise _LLMError(h2_start) from exc

        h3_ms = int((time.monotonic() - h3_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h3", "from": "agent", "to": "llm",
            "phase": "end", "detail": f"Tema: {result['topic']}", "duration_ms": h3_ms,
        })
        await pub.publish("process.step", {"step": "understand", "status": "done"})
        await pub.publish("process.step", {
            "step": "search_nodes", "status": "active", "label": "Buscando en mis nodos",
        })

        path = [nid for nid in result.get("path", []) if nid in portfolio]
        confidence = float(result.get("confidence", 0.0))
        reason = result.get("reason", "")
        is_route = confidence >= route_threshold and bool(path)

        if is_route:
            await pub.publish("route.plan", {
                "path": path, "confidence": confidence, "reason": reason,
            })
            await pub.publish("process.step", {"step": "search_nodes", "status": "done"})
            await pub.publish("process.step", {"step": "search_base", "status": "skipped"})
            await pub.publish("process.step", {"step": "design_node", "status": "skipped"})
            await pub.publish("process.step", {"step": "create_node", "status": "skipped"})
            for i, node_id in enumerate(path):
                await pub.publish("route.step", {"node_id": node_id, "index": i})
            final_outcome = "route"
            answer_hop_id = "h4"
            answer_system = _route_answer_system(input_text, path, portfolio)
        else:
            await pub.publish("process.step", {"step": "search_nodes", "status": "done"})
            final_outcome, answer_hop_id, answer_system = await _n8n_deep_route(
                pub=pub,
                run_id=run_id,
                visitor_id=visitor_id,
                input_text=input_text,
                understand_result=result,
                n8n_webhook_url=n8n_webhook_url,
                h2_start=h2_start,
            )

        # ── Answer phase (shared for all outcomes) ────────────────────────────
        await pub.publish("process.step", {
            "step": "answer", "status": "active", "label": "Redactando la respuesta",
        })

        h_ans_start = time.monotonic()
        await pub.publish("trace.hop", {
            "hop_id": answer_hop_id, "from": "agent", "to": "llm",
            "phase": "start", "label": "Redacta la respuesta",
        })

        try:
            async for chunk in llm.stream(system=answer_system, user=input_text):
                await pub.publish("answer.chunk", {"text": chunk})
        except LLMBudgetExceeded as exc:
            h_ans_ms = int((time.monotonic() - h_ans_start) * 1000)
            await pub.publish("trace.hop", {
                "hop_id": answer_hop_id, "from": "agent", "to": "llm",
                "phase": "error", "detail": "Límite diario del modelo alcanzado", "duration_ms": h_ans_ms,
            })
            raise _BudgetError(h2_start) from exc
        except Exception as exc:
            log.exception("LLM stream failed run=%s visitor=%s", run_id, visitor_id)
            h_ans_ms = int((time.monotonic() - h_ans_start) * 1000)
            await pub.publish("trace.hop", {
                "hop_id": answer_hop_id, "from": "agent", "to": "llm",
                "phase": "error", "detail": "El proveedor no respondió", "duration_ms": h_ans_ms,
            })
            raise _LLMError(h2_start) from exc

        h_ans_ms = int((time.monotonic() - h_ans_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": answer_hop_id, "from": "agent", "to": "llm",
            "phase": "end", "duration_ms": h_ans_ms,
        })
        await pub.publish("process.step", {"step": "answer", "status": "done"})

        h2_ms = int((time.monotonic() - h2_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "end", "duration_ms": h2_ms,
        })

        run_ms = int((time.monotonic() - run_start) * 1000)
        await pub.publish("run.done", {"outcome": final_outcome, "duration_ms": run_ms})

    except _BudgetError as exc:
        await _publish_budget_error(pub, exc.h2_start)

    except _N8NError as exc:
        # design_node answers 503 to n8n when the budget runs out mid-flow.
        if await _budget_spent(llm):
            await _publish_budget_error(pub, exc.h2_start)
            return
        h2_ms = int((time.monotonic() - exc.h2_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "error",
            "detail": "El flujo de búsqueda no está disponible",
            "duration_ms": h2_ms,
        })
        await pub.publish("run.error", {
            "code": "internal",
            "message": "El flujo de búsqueda no está disponible en este momento. Intenta de nuevo.",
            "retryable": True,
        })

    except _LLMError as exc:
        h2_ms = int((time.monotonic() - exc.h2_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "error",
            "detail": "El agente no pudo completar la consulta",
            "duration_ms": h2_ms,
        })
        await pub.publish("run.error", {
            "code": "llm_unavailable",
            "message": "El modelo no está disponible en este momento. Intenta de nuevo en un momento.",
            "retryable": True,
        })

    except Exception:
        log.exception("unexpected error run=%s visitor=%s", run_id, visitor_id)
        h2_ms = int((time.monotonic() - h2_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "error", "detail": "Error interno", "duration_ms": h2_ms,
        })
        await pub.publish("run.error", {
            "code": "internal",
            "message": "Error interno del agente.",
            "retryable": False,
        })

    finally:
        # run.done / run.error has been published (or the run died): free the
        # visitor's "one active query" mark taken by the gateway.
        await _release_active(rdb, visitor_id, run_id)


async def _publish_budget_error(pub: EventPublisher, h2_start: float) -> None:
    log.warning("daily LLM budget spent; run answered without calling the provider")
    h2_ms = int((time.monotonic() - h2_start) * 1000)
    await pub.publish("trace.hop", {
        "hop_id": "h2", "from": "gateway", "to": "agent",
        "phase": "error", "detail": "Límite diario del modelo alcanzado", "duration_ms": h2_ms,
    })
    await pub.publish("run.error", {
        "code": "llm_unavailable",
        "message": "Por hoy alcancé mi límite de consultas al modelo. Vuelve mañana o escríbeme por el chat en vivo.",
        "retryable": False,
    })


async def _n8n_deep_route(
    *,
    pub: EventPublisher,
    run_id: str,
    visitor_id: str,
    input_text: str,
    understand_result: dict,
    n8n_webhook_url: str,
    h2_start: float,
) -> tuple[str, str, str]:
    """
    Call the n8n deep-route webhook (RAG + design + save).

    n8n publishes h5/h6/h7 events and process.step intermediates via
    /internal/events.  This function publishes h4 (agent→n8n) and the
    process.step closing events after n8n responds.

    Returns (final_outcome, answer_hop_id, answer_system).
    Raises _N8NError on network/HTTP failure so the outer handler closes
    h2 and emits run.error — there is no silent fallback.
    """
    await pub.publish("process.step", {
        "step": "search_base", "status": "active", "label": "Buscando en la base de conocimiento",
    })

    h4_start = time.monotonic()
    await pub.publish("trace.hop", {
        "hop_id": "h4", "from": "agent", "to": "n8n",
        "phase": "start", "label": "Lanza el flujo de búsqueda",
    })

    query = understand_result.get("topic", input_text)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                n8n_webhook_url,
                json={
                    "run_id": run_id,
                    "visitor_id": visitor_id,
                    "question": input_text,
                    "query": query,
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            n8n_result = resp.json()
    except Exception as exc:
        log.exception("n8n webhook failed run=%s visitor=%s url=%s", run_id, visitor_id, n8n_webhook_url)
        h4_ms = int((time.monotonic() - h4_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h4", "from": "agent", "to": "n8n",
            "phase": "error", "detail": "n8n no respondió", "duration_ms": h4_ms,
        })
        raise _N8NError(h2_start) from exc

    h4_ms = int((time.monotonic() - h4_start) * 1000)
    await pub.publish("trace.hop", {
        "hop_id": "h4", "from": "agent", "to": "n8n",
        "phase": "end", "duration_ms": h4_ms,
    })

    outcome = n8n_result.get("outcome", "unknown")
    node = n8n_result.get("node")

    if outcome == "generated" and node is not None:
        # n8n already published search_base:done, design_node:done, create_node:active, h7:end
        await pub.publish("process.step", {"step": "create_node", "status": "done"})
        return "generated", "h8", _generated_answer_system(input_text, node)
    else:
        # n8n published h5 events only; agent closes the process.step chain
        await pub.publish("process.step", {"step": "search_base", "status": "done"})
        await pub.publish("process.step", {"step": "design_node", "status": "skipped"})
        await pub.publish("process.step", {"step": "create_node", "status": "skipped"})
        return "unknown", "h6", _unknown_answer_system(input_text)


# ── LLM helpers ───────────────────────────────────────────────────────────────

def _nodes_map(portfolio: dict) -> str:
    lines = []
    for nid, n in portfolio.items():
        kw = ", ".join(n.get("keywords") or [])
        lines.append(f"{nid} | {n['label']} | {n['summary']} | {kw}")
    return "\n".join(lines)


async def _understand(llm: LLMProvider, question: str, portfolio: dict) -> dict:
    system = f"""Eres el agente del portafolio de Kirbith Cubillas.
Analiza la pregunta y decide si corresponde a algún nodo del portafolio.

Nodos disponibles (id | label | resumen | palabras clave):
{_nodes_map(portfolio)}

Responde ÚNICAMENTE con JSON válido, sin markdown ni backticks:
{{"outcome": "route", "confidence": 0.92, "path": ["nodo-padre", "nodo-hijo"], "reason": "Motivo breve", "topic": "Tema de la pregunta"}}

Reglas:
- outcome siempre "route"
- confidence entre 0.0 y 1.0
- path: lista de ids del portafolio relevantes (máximo 3, del más general al más específico)
- Si no hay nodo con confidence >= {CONFIDENCE_THRESHOLD}: path vacío y confidence baja
"""
    raw = await llm.complete(system=system, user=question)
    return _parse_json(raw)


def _parse_json(raw: str) -> dict:
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group() if m else raw)
        return {
            "outcome": str(data.get("outcome", "route")),
            "confidence": float(data.get("confidence", 0.0)),
            "path": list(data.get("path", [])),
            "reason": str(data.get("reason", "")),
            "topic": str(data.get("topic", "la pregunta")),
        }
    except Exception:
        return {"outcome": "route", "confidence": 0.0, "path": [], "reason": "", "topic": "la pregunta"}


def _route_answer_system(question: str, path: list, portfolio: dict) -> str:
    path_labels = "\n".join(
        f"- {portfolio[nid]['label']}: {portfolio[nid].get('summary', '')}"
        for nid in path if nid in portfolio
    )
    return f"""Eres el agente del portafolio de Kirbith Cubillas.
La pregunta fue: "{question}"
Llevaste al visitante a estos nodos:
{path_labels}

Escribe una respuesta BREVE (2-3 oraciones) en español:
- Responde directamente a la pregunta basándote en la información de los nodos
- Menciona que llevaste al visitante a ese nodo
- Solo texto plano, sin markdown ni listas"""


def _generated_answer_system(question: str, node: dict) -> str:
    return f"""Eres el agente del portafolio de Kirbith Cubillas.
La pregunta fue: "{question}"
Creaste un nodo nuevo: "{node['label']}" — {node['summary']}

Escribe una respuesta BREVE (2-3 oraciones) en español:
- Di que no tenías un nodo para eso y que creaste uno nuevo específicamente para el visitante
- Menciona brevemente qué contiene el nodo
- Solo texto plano, sin markdown ni listas"""


def _unknown_answer_system(question: str) -> str:
    return f"""Eres el agente del portafolio de Kirbith Cubillas.
La pregunta fue: "{question}"
No encontraste información relevante en el portafolio ni en la base de conocimiento.

Escribe una respuesta BREVE (1-2 oraciones) en español:
- Di que no tienes información sobre eso
- Sugiere contactar al dueño por el chat en vivo
- Solo texto plano, sin markdown"""
