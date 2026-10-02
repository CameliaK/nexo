import os
from dataclasses import dataclass


@dataclass
class Config:
    deepseek_api_key: str
    deepseek_model: str
    redis_url: str
    postgres_url: str
    portfolio_path: str
    n8n_webhook_url: str
    route_confidence_threshold: float = 0.7
    rag_similarity_threshold: float = 0.75


def load() -> Config:
    return Config(
        deepseek_api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
        deepseek_model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379"),
        postgres_url=os.environ.get(
            "POSTGRES_URL", "postgresql://nexo:nexo@postgres:5432/nexo"
        ),
        portfolio_path=os.environ.get("PORTFOLIO_PATH", "/docs/portfolio-content.json"),
        n8n_webhook_url=os.environ.get(
            "N8N_WEBHOOK_URL", "http://n8n:5678/webhook/nexo-deep-route"
        ),
        route_confidence_threshold=float(
            os.environ.get("ROUTE_CONFIDENCE_THRESHOLD", "0.7")
        ),
        rag_similarity_threshold=float(
            os.environ.get("RAG_SIMILARITY_THRESHOLD", "0.75")
        ),
    )
