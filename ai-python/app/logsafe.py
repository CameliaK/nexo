"""Log-safe forms of identifiers, same rules as the gateway's mask package:
the canonical visitor_id works as the guest credential, so it is never
logged whole (first 8 characters + "…"), and URLs lose their query string."""

import logging
import re

_QUERY = re.compile(r"\?[^ \"]*")


def mask_id(value: str | None) -> str:
    value = value or ""
    return value if len(value) <= 8 else value[:8] + "…"


class _AccessQueryFilter(logging.Filter):
    """uvicorn's access log prints the full path; internal routes carry
    ?visitor_id=… there. Keep the path, drop the query string. The client
    address goes too: today it is only the gateway's or n8n's container (the
    agent is not published), but with proxy headers it would be the
    visitor's IP, and nothing here needs it."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) == 5:
            _client, method, path, version, status = record.args
            record.args = ("-", method, _QUERY.sub("", str(path)), version, status)
        return True


def install() -> None:
    logging.getLogger("uvicorn.access").addFilter(_AccessQueryFilter())


_BOT_TOKEN = re.compile(r"bot\d+:[A-Za-z0-9_-]+")


def redact(text: object) -> str:
    """Exception text may carry a Telegram API URL (…/bot<token>/…)."""
    return _BOT_TOKEN.sub("bot***", str(text))
