import logging

from app.logsafe import _AccessQueryFilter


def test_access_log_drops_client_and_query():
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        ("203.0.113.7:51234", "GET", "/internal/nodes?visitor_id=abc", "1.1", 200),
        None,
    )
    assert _AccessQueryFilter().filter(record)
    line = record.getMessage()
    assert "203.0.113.7" not in line
    assert "visitor_id" not in line
    assert line == '- - "GET /internal/nodes HTTP/1.1" 200'
