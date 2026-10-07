import json


def load_portfolio(path: str) -> dict[str, dict]:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return {
        node["id"]: {
            "id": node["id"],
            "parent": node.get("parent"),
            "label": node.get("label", ""),
            "summary": node.get("summary", ""),
            "keywords": node.get("keywords", []),
            # What a route answer is grounded on (app/route_check.py).
            "type": node.get("type"),
            "tagline": node.get("tagline"),
            "status": node.get("status"),
            "content": node.get("content"),
            "architecture": node.get("architecture"),
        }
        for node in raw.get("nodes", [])
    }
