"""Behaviour of the agent on node requests (docs/eval/peticiones.json).

Each case runs the real agent flow (app.agent.router.run) with the real LLM,
n8n, Redis and Postgres of the dev stack — the gateway is skipped. Every case
uses a fresh throwaway visitor id, whose generated nodes are deleted at the
end. The events published to that visitor's channel are the result: outcome,
route path, generated node and answer text, checked against the case.

LLM calls are counted twice: the calls this process makes (understand and
answer) and the global daily counter (llm:calls:<day>), which also counts the
design_node calls the running agent makes for n8n.

Run (one-off container with the agent image, sources mounted; the running
agent must already have this branch's code, since n8n calls it):
  docker compose run --rm --no-deps -e PYTHONPATH=/src \
    -v ./ai-python:/src:ro -v ./docs:/docs:ro -v ./knowledge:/knowledge:ro agent \
    python /src/eval/eval_agent.py [case ids…] > docs/eval/peticiones-resultados.json
"""

import asyncio
import json
import re
import sys
import uuid

import redis.asyncio as aioredis

from app import db as db_mod
from app import retention
from app.agent import router
from app.config import load
from app.llm.base import LLMProvider
from app.llm.budget import BudgetedLLM, budget_key
from app.llm.deepseek import DeepSeekProvider
from app.portfolio import load_portfolio
from app.skills import SkillsIndex, normalize

CASES = "/docs/eval/peticiones.json"
TIMEOUT_S = 150

# A sentence that says something does not exist / is not on record.
DENIAL = re.compile(
    r"\b(no tengo|no hay|no encontr\w*|no exist\w*|no cuento con|sin)\s+(ningun[oa]?\s+)?"
    r"(registro|informacion|datos|experiencia|evidencia)"
    r"|\b(don ?t|do not|doesn ?t|does not)\s+have\s+(any\s+)?(verified\s+)?(record|information|experience|data)"
    r"|\bno\s+(verified\s+)?(record|information|evidence)\b|\bthere (is|are) no\b|\bcould ?n ?o?t find\b"
)
FIRST_PERSON = re.compile(r"entendi que te refieres a kirbith|i understood (that )?you mean kirbith")


class CountingLLM(LLMProvider):
    def __init__(self, inner: LLMProvider) -> None:
        self.inner, self.calls = inner, 0

    async def complete(self, system: str, user: str) -> str:
        self.calls += 1
        return await self.inner.complete(system=system, user=user)

    async def stream(self, system: str, user: str):
        self.calls += 1
        async for chunk in self.inner.stream(system=system, user=user):
            yield chunk


def sentences(text: str) -> list[str]:
    """Split before normalizing: normalize() drops ? ! and apostrophes."""
    return [normalize(s) for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def check(case: dict, res: dict) -> list[str]:
    fails = []
    if res["outcome"] not in case["outcome"]:
        fails.append(f"outcome {res['outcome']} not in {case['outcome']}")
    if case.get("node") and res["outcome"] == "route" and (res["path"] or [None])[-1] != case["node"]:
        fails.append(f"route ends at {res['path'][-1:]} not {case['node']}")
    answer = normalize(res["answer"])
    if case.get("first_person") and not FIRST_PERSON.search(answer):
        fails.append("does not say it understood the question is about Kirbith")
    for term in case.get("must_not_deny", []):
        t = normalize(term)
        for s in sentences(res["answer"]):
            if re.search(rf"\b{re.escape(t)}\b", s) and DENIAL.search(s):
                fails.append(f"denies '{term}': {s[:120]}")
    if res["node"]:
        node_text = normalize(json.dumps(res["node"], ensure_ascii=False))
        for claim in case.get("node_must_not_claim", []):
            if normalize(claim) in node_text:
                fails.append(f"node claims '{claim}'")
        if not res["node"].get("sources"):
            fails.append("generated node without sources")
    return fails


async def run_case(case, *, rdb, llm, counting, portfolio, pool, skills, cfg) -> dict:
    visitor, run_id = f"eval-{uuid.uuid4()}", str(uuid.uuid4())
    pubsub = rdb.pubsub()
    await pubsub.subscribe(f"events:{visitor}")
    calls_before, day_before = counting.calls, int(await rdb.get(budget_key()) or 0)
    task = asyncio.create_task(router.run(
        run_id=run_id, visitor_id=visitor, input_text=case["q"], seq_start=4, rdb=rdb, llm=llm,
        portfolio=portfolio, db_pool=pool, rag_model=None, route_threshold=cfg.route_confidence_threshold,
        n8n_webhook_url=cfg.n8n_webhook_url, skills=skills, lang=case.get("lang")))
    res = {"outcome": None, "path": [], "node": None, "answer": "", "hits": [], "error": None}
    try:
        async with asyncio.timeout(TIMEOUT_S):
            async for msg in pubsub.listen():
                if msg["type"] != "message":
                    continue
                ev = json.loads(msg["data"])
                t, d = ev["type"], ev["data"]
                if t == "route.plan":
                    res["path"] = d["path"]
                elif t == "node.spawn":
                    res["node"] = d["node"]
                elif t == "rag.result":
                    res["hits"] = [h["title"] for h in d["hits"]]
                elif t == "answer.chunk":
                    res["answer"] += d["text"]
                elif t == "run.done":
                    res["outcome"] = d["outcome"]
                    break
                elif t == "run.error":
                    res["outcome"], res["error"] = "error", d
                    break
    except TimeoutError:
        res["outcome"] = "timeout"
    await task
    await pubsub.unsubscribe()
    await pubsub.aclose()
    await retention.delete_visitor(pool, visitor)
    res["llm_calls_eval"] = counting.calls - calls_before
    res["llm_calls_day_delta"] = int(await rdb.get(budget_key()) or 0) - day_before
    return res


async def main() -> None:
    cfg = load()
    only = set(sys.argv[1:])
    cases = [c for c in json.load(open(CASES, encoding="utf-8"))["cases"] if not only or c["id"] in only]
    rdb = aioredis.Redis.from_url(cfg.redis_url, decode_responses=True)
    counting = CountingLLM(DeepSeekProvider(api_key=cfg.deepseek_api_key, model=cfg.deepseek_model))
    llm = BudgetedLLM(counting, rdb, cfg.llm_daily_calls)
    pool = await db_mod.create_pool(cfg.postgres_url)
    portfolio = load_portfolio(cfg.portfolio_path)
    skills = SkillsIndex(cfg.skills_path)

    report, passed = [], 0
    for case in cases:
        res = await run_case(case, rdb=rdb, llm=llm, counting=counting, portfolio=portfolio,
                             pool=pool, skills=skills, cfg=cfg)
        fails = check(case, res)
        passed += not fails
        report.append({"id": case["id"], "q": case["q"], "ok": not fails, "fails": fails, **res})
        print(f"{case['id']} {'OK  ' if not fails else 'FAIL'} {res['outcome']:9} "
              f"{(res['path'] or [''])[-1]:32} llm={res['llm_calls_day_delta']} {'; '.join(fails)}",
              file=sys.stderr)

    total_eval = sum(r["llm_calls_eval"] for r in report)
    total_day = sum(r["llm_calls_day_delta"] for r in report)
    print(f"{passed}/{len(report)} OK — llamadas al LLM: {total_day} en total "
          f"({total_eval} de este proceso, {total_day - total_eval} de design_node)", file=sys.stderr)
    json.dump({"passed": passed, "cases": len(report), "llm_calls": total_day,
               "results": report}, sys.stdout, ensure_ascii=False, indent=1)
    await pool.close()
    await rdb.aclose()


if __name__ == "__main__":
    asyncio.run(main())
