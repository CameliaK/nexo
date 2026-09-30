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
        }
        for node in raw.get("nodes", [])
    }
