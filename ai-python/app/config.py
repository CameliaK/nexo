import os
from dataclasses import dataclass


@dataclass
class Config:
    deepseek_api_key: str
    deepseek_model: str
    redis_url: str
    portfolio_path: str
    route_confidence_threshold: float = 0.7


def load() -> Config:
    return Config(
        deepseek_api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
        deepseek_model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379"),
        portfolio_path=os.environ.get("PORTFOLIO_PATH", "/docs/portfolio-content.json"),
        route_confidence_threshold=float(
            os.environ.get("ROUTE_CONFIDENCE_THRESHOLD", "0.7")
        ),
    )
