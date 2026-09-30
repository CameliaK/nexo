import json
from datetime import datetime, timezone

import redis.asyncio as aioredis


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class EventPublisher:
    def __init__(
        self,
        rdb: aioredis.Redis,
        visitor_id: str,
        run_id: str,
        seq_start: int,
    ) -> None:
        self._rdb = rdb
        self._channel = f"events:{visitor_id}"
        self._run_id = run_id
        self._seq = seq_start

    async def publish(self, type_: str, data: dict) -> None:
        envelope = {
            "v": 2,
            "type": type_,
            "run_id": self._run_id,
            "seq": self._seq,
            "ts": _now_iso(),
            "data": data,
        }
        self._seq += 1
        await self._rdb.publish(self._channel, json.dumps(envelope))
