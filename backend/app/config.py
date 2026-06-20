"""Centralised configuration loaded from environment / .env.

All settings have defaults tuned to the buyer's Christchurch profile so the app
runs out of the box. Override anything in a `.env` file (see `.env.example`).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root = two levels up from this file (backend/app/config.py -> repo/)
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = f"sqlite:///{DATA_DIR / 'housescout.db'}"

    # LINZ
    linz_api_key: str = ""

    # LM Studio (local Gemma)
    lmstudio_base_url: str = "http://localhost:1234/v1"
    lmstudio_api_key: str = "lm-studio"
    lmstudio_chat_model: str = ""
    lmstudio_embed_model: str = ""

    # Buyer profile
    max_price: float = 500_000
    preapproval: float = 480_000
    deposit: float = 50_000
    default_mortgage_rate: float = 0.0519
    default_term_years: int = 30
    boarder_weekly_rent: float = 220

    # Scraper
    scrape_region: str = "canterbury"
    scrape_district: str = "christchurch-city"
    scrape_interval_hours: int = 6
    scrape_user_agent: str = "HouseScout/0.1 (personal use)"


@lru_cache
def get_settings() -> Settings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return Settings()


settings = get_settings()
