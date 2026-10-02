import json
from datetime import datetime, timezone

import redis.asyncio as aioredis


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class EventPublisher:
    """Publishes backend events to a Redis Pub/Sub channel.

    Seq numbers come from an atomic Redis INCR counter (run:{run_id}:seq) so
    multiple callers (agent background task + n8n via /internal/events) never
    produce duplicate or out-of-order seqs.  The caller must initialise the
    counter with ``rdb.set(f"run:{run_id}:seq", seq_start - 1, ex=3600)``
    before constructing this object.
    """

    def __init__(
        self,
        rdb: aioredis.Redis,
        visitor_id: str,
        run_id: str,
    ) -> None:
        self._rdb = rdb
        self._channel = f"events:{visitor_id}"
        self._run_id = run_id
        self._counter_key = f"run:{run_id}:seq"

    async def publish(self, type_: str, data: dict) -> None:
        seq = int(await self._rdb.incr(self._counter_key))
        envelope = {
            "v": 2,
            "type": type_,
            "run_id": self._run_id,
            "seq": seq,
            "ts": _now_iso(),
            "data": data,
        }
        await self._rdb.publish(self._channel, json.dumps(envelope))
