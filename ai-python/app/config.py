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
    n8n_live_outbound_url: str
    telegram_bot_token: str
    telegram_chat_id: str
    route_confidence_threshold: float = 0.7
    rag_similarity_threshold: float = 0.35
    llm_daily_calls: int = 1500
    public_base_url: str = "http://localhost"
    chess_max_active: int = 5
    chess_expire_days: int = 30
    chess_empty_expire_hours: int = 48
    chess_notify_minutes: int = 10
    skills_path: str = "/knowledge/skills.json"
    node_forming_event: bool = True
    nodes_retention_days: int = 90
    live_retention_days: int = 180


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
        n8n_live_outbound_url=os.environ.get(
            "N8N_LIVE_OUTBOUND_URL", "http://n8n:5678/webhook/nexo-live-outbound"
        ),
        telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=os.environ.get("TELEGRAM_CHAT_ID", ""),
        route_confidence_threshold=float(
            os.environ.get("ROUTE_CONFIDENCE_THRESHOLD", "0.7")
        ),
        rag_similarity_threshold=float(
            os.environ.get("RAG_SIMILARITY_THRESHOLD", "0.35")
        ),
        llm_daily_calls=int(os.environ.get("LLM_DAILY_CALLS", "1500")),
        public_base_url=os.environ.get("PUBLIC_BASE_URL", "http://localhost").rstrip("/"),
        chess_max_active=int(os.environ.get("CHESS_MAX_ACTIVE", "5")),
        chess_expire_days=int(os.environ.get("CHESS_EXPIRE_DAYS", "30")),
        chess_empty_expire_hours=int(os.environ.get("CHESS_EMPTY_EXPIRE_HOURS", "48")),
        chess_notify_minutes=int(os.environ.get("CHESS_NOTIFY_MINUTES", "10")),
        skills_path=os.environ.get("SKILLS_PATH", "/knowledge/skills.json"),
        node_forming_event=os.environ.get("NODE_FORMING_EVENT", "true").strip().lower() == "true",
        nodes_retention_days=int(os.environ.get("NODES_RETENTION_DAYS", "90")),
        live_retention_days=int(os.environ.get("LIVE_RETENTION_DAYS", "180")),
    )
