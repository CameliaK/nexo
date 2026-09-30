import json
import logging
import re
import time
from typing import AsyncIterator

import redis.asyncio as aioredis

from ..events import EventPublisher
from ..llm.base import LLMProvider

log = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7

# Raised when the LLM call fails so the outer handler can close the right hops.
class _LLMError(Exception):
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
    route_threshold: float = CONFIDENCE_THRESHOLD,
) -> None:
    pub = EventPublisher(rdb, visitor_id, run_id, seq_start)
    run_start = time.monotonic()
    h2_start = run_start

    try:
        # seq 4 — understand active
        await pub.publish("process.step", {
            "step": "understand", "status": "active", "label": "Entendiendo la pregunta",
        })

        # seq 5 — h2 gateway→agent start
        h2_start = time.monotonic()
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "start", "label": "Envía la pregunta al agente",
        })

        # seq 6 — h3 agent→llm start
        h3_start = time.monotonic()
        await pub.publish("trace.hop", {
            "hop_id": "h3", "from": "agent", "to": "llm",
            "phase": "start", "label": "Entiende la pregunta",
        })

        try:
            result = await _understand(llm, input_text, portfolio)
        except Exception as exc:
            log.exception("LLM understand failed run=%s visitor=%s", run_id, visitor_id)
            h3_ms = int((time.monotonic() - h3_start) * 1000)
            await pub.publish("trace.hop", {
                "hop_id": "h3", "from": "agent", "to": "llm",
                "phase": "error", "detail": "El proveedor no respondió", "duration_ms": h3_ms,
            })
            raise _LLMError(h2_start) from exc

        h3_ms = int((time.monotonic() - h3_start) * 1000)

        # seq 7 — h3 end
        await pub.publish("trace.hop", {
            "hop_id": "h3", "from": "agent", "to": "llm",
            "phase": "end", "detail": f"Tema: {result['topic']}", "duration_ms": h3_ms,
        })

        # seq 8 — understand done
        await pub.publish("process.step", {"step": "understand", "status": "done"})

        # seq 9 — search_nodes active
        await pub.publish("process.step", {
            "step": "search_nodes", "status": "active", "label": "Buscando en mis nodos",
        })

        path = [nid for nid in result.get("path", []) if nid in portfolio]
        confidence = float(result.get("confidence", 0.0))
        reason = result.get("reason", "")
        is_route = confidence >= route_threshold and bool(path)

        if is_route:
            # seq 10 — route.plan
            await pub.publish("route.plan", {
                "path": path, "confidence": confidence, "reason": reason,
            })
            # seq 11–14
            await pub.publish("process.step", {"step": "search_nodes", "status": "done"})
            await pub.publish("process.step", {"step": "search_base", "status": "skipped"})
            await pub.publish("process.step", {"step": "design_node", "status": "skipped"})
            await pub.publish("process.step", {"step": "create_node", "status": "skipped"})
            # route steps
            for i, node_id in enumerate(path):
                await pub.publish("route.step", {"node_id": node_id, "index": i})
            final_outcome = "route"
            answer_system = _route_answer_system(input_text, path, portfolio)
        else:
            await pub.publish("process.step", {"step": "search_nodes", "status": "done"})
            await pub.publish("process.step", {"step": "search_base", "status": "skipped"})
            await pub.publish("process.step", {"step": "design_node", "status": "skipped"})
            await pub.publish("process.step", {"step": "create_node", "status": "skipped"})
            final_outcome = "unknown"
            answer_system = _unknown_answer_system(input_text)

        # answer phase
        await pub.publish("process.step", {
            "step": "answer", "status": "active", "label": "Redactando la respuesta",
        })

        h4_start = time.monotonic()
        await pub.publish("trace.hop", {
            "hop_id": "h4", "from": "agent", "to": "llm",
            "phase": "start", "label": "Redacta la respuesta",
        })

        try:
            async for chunk in llm.stream(system=answer_system, user=input_text):
                await pub.publish("answer.chunk", {"text": chunk})
        except Exception as exc:
            log.exception("LLM stream failed run=%s visitor=%s", run_id, visitor_id)
            h4_ms = int((time.monotonic() - h4_start) * 1000)
            await pub.publish("trace.hop", {
                "hop_id": "h4", "from": "agent", "to": "llm",
                "phase": "error", "detail": "El proveedor no respondió", "duration_ms": h4_ms,
            })
            raise _LLMError(h2_start) from exc

        h4_ms = int((time.monotonic() - h4_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h4", "from": "agent", "to": "llm",
            "phase": "end", "duration_ms": h4_ms,
        })
        await pub.publish("process.step", {"step": "answer", "status": "done"})

        # h2 end
        h2_ms = int((time.monotonic() - h2_start) * 1000)
        await pub.publish("trace.hop", {
            "hop_id": "h2", "from": "gateway", "to": "agent",
            "phase": "end", "duration_ms": h2_ms,
        })

        # run.done
        run_ms = int((time.monotonic() - run_start) * 1000)
        await pub.publish("run.done", {"outcome": final_outcome, "duration_ms": run_ms})

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


# ── LLM helpers ──────────────────────────────────────────────────────────────

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
        return {
            "outcome": "route",
            "confidence": 0.0,
            "path": [],
            "reason": "",
            "topic": "la pregunta",
        }


def _route_answer_system(question: str, path: list, portfolio: dict) -> str:
    path_labels = "\n".join(
        f"- {portfolio[nid]['label']}: {portfolio[nid].get('summary', '')}"
        for nid in path
        if nid in portfolio
    )
    return f"""Eres el agente del portafolio de Kirbith Cubillas.
La pregunta fue: "{question}"
Llevaste al visitante a estos nodos:
{path_labels}

Escribe una respuesta BREVE (2-3 oraciones) en español:
- Responde directamente a la pregunta basándote en la información de los nodos
- Menciona que llevaste al visitante a ese nodo
- Solo texto plano, sin markdown ni listas"""


def _unknown_answer_system(question: str) -> str:
    return f"""Eres el agente del portafolio de Kirbith Cubillas.
La pregunta fue: "{question}"
No encontraste información relevante en el portafolio.

Escribe una respuesta BREVE (1-2 oraciones) en español:
- Di que no tienes información sobre eso en el portafolio
- Sugiere contactar al dueño por el chat en vivo
- Solo texto plano, sin markdown"""
