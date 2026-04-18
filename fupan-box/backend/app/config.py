from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/fupan_box"
    database_url_sync: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/fupan_box"
    redis_url: str = "redis://localhost:6379/0"

    secret_key: str = "change-me-to-a-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440

    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o-mini"

    data_source: str = "akshare"
    tushare_token: str = ""

    ai_free_quota_daily: int = 5

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
