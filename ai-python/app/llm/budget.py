"""Global daily budget of LLM calls (contract §12: daily spend cap).

Every provider call — complete() and stream() — first increments a Redis
counter for the current UTC day. Past LLM_DAILY_CALLS the call is refused
with LLMBudgetExceeded *before* reaching the provider. The key is per day
(llm:calls:YYYY-MM-DD, UTC) and expires after 48 h, so it resets daily.
"""
from datetime import datetime, timezone
from typing import AsyncIterator

import redis.asyncio as aioredis

from .base import LLMProvider

_KEY_TTL_S = 48 * 3600


class LLMBudgetExceeded(Exception):
    """The daily LLM call budget is spent; the provider was not called."""


def budget_key(now: datetime | None = None) -> str:
    day = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    return f"llm:calls:{day}"


class BudgetedLLM(LLMProvider):
    def __init__(self, inner: LLMProvider, rdb: aioredis.Redis, daily_calls: int) -> None:
        self._inner = inner
        self._rdb = rdb
        self._limit = daily_calls

    async def exhausted(self) -> bool:
        """True when no call is left today (checked before starting a run)."""
        used = await self._rdb.get(budget_key())
        return used is not None and int(used) >= self._limit

    async def _spend(self) -> None:
        key = budget_key()
        async with self._rdb.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, _KEY_TTL_S, nx=True)
            used, _ = await pipe.execute()
        if int(used) > self._limit:
            raise LLMBudgetExceeded(f"daily LLM budget of {self._limit} calls spent")

    async def complete(self, system: str, user: str) -> str:
        await self._spend()
        return await self._inner.complete(system=system, user=user)

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        await self._spend()
        async for chunk in self._inner.stream(system=system, user=user):
            yield chunk
