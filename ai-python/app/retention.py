"""Data retention for what the agent stores per visitor_id.

- Generated nodes are deleted after NODES_RETENTION_DAYS without activity.
  Activity is the visitor loading their nodes (GET /api/v1/session/nodes on
  page load), which refreshes last_seen_at; a node never seen since creation
  counts from created_at.
- Live-chat messages are deleted LIVE_RETENTION_DAYS after they were sent
  (ts), one by one.
- delete_visitor erases both for one visitor (DELETE /api/v1/session/data).
"""

import asyncio
import logging
from dataclasses import dataclass

import asyncpg

log = logging.getLogger(__name__)

_SWEEP_EVERY_S = 3600


@dataclass
class Retention:
    nodes_days: int
    live_days: int


def _count(status: str) -> int:
    # asyncpg returns the command tag, e.g. "DELETE 3".
    return int(status.split()[-1])


async def sweep(pool: asyncpg.Pool, r: Retention) -> tuple[int, int]:
    async with pool.acquire() as conn:
        nodes = _count(await conn.execute(
            "DELETE FROM generated_nodes WHERE last_seen_at < now() - make_interval(days => $1)",
            r.nodes_days,
        ))
        messages = _count(await conn.execute(
            "DELETE FROM live_messages WHERE ts < now() - make_interval(days => $1)",
            r.live_days,
        ))
    if nodes or messages:
        log.warning("retention: deleted %d generated node(s), %d live message(s)", nodes, messages)
    return nodes, messages


async def loop(pool: asyncpg.Pool, r: Retention) -> None:
    """Periodic sweep; the first one runs at startup."""
    while True:
        try:
            await sweep(pool, r)
        except Exception as exc:  # keep sweeping on the next tick
            log.error("retention: sweep failed: %s", exc)
        await asyncio.sleep(_SWEEP_EVERY_S)


async def delete_visitor(pool: asyncpg.Pool, visitor_id: str) -> tuple[int, int]:
    async with pool.acquire() as conn:
        async with conn.transaction():
            nodes = _count(await conn.execute(
                "DELETE FROM generated_nodes WHERE visitor_id = $1", visitor_id))
            messages = _count(await conn.execute(
                "DELETE FROM live_messages WHERE visitor_id = $1", visitor_id))
    return nodes, messages
