import os
from dataclasses import dataclass, field


@dataclass
class Config:
    gemini_api_key: str
    gemini_model: str
    redis_url: str
    portfolio_path: str
    route_confidence_threshold: float = 0.7


def load() -> Config:
    return Config(
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379"),
        portfolio_path=os.environ.get("PORTFOLIO_PATH", "/docs/portfolio-content.json"),
        route_confidence_threshold=float(
            os.environ.get("ROUTE_CONFIDENCE_THRESHOLD", "0.7")
        ),
    )
