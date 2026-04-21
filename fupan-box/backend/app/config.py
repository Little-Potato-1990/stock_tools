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

    # === 新闻聚合 (Phase 1) ===
    # 自定义额外 RSS feeds, 格式 "name1::url1,name2::url2"
    news_rss_feeds: str = ""
    # ingest 时间窗 (小时); celery beat 每 30 分钟跑一次, 窗口 12h 兼顾历史回填
    news_ingest_window_hours: float = 12.0
    # ingest 时是否同步调 LLM 打标 (生产环境可以开)
    news_ingest_do_tag: bool = True
    # AI 打标用的模型 (deepseek-v3 性价比最高)
    news_tag_model: str = "deepseek-v3"

    # === Phase 4 RAG ===
    # OpenAI 兼容 embedding 模型 (default: text-embedding-3-small = 1536 dim)
    # 若换 bge-large-zh (1024) / m3e-large (768), 需同步改 news_embedding_dim 并重建索引
    news_embedding_model: str = "text-embedding-3-small"
    news_embedding_dim: int = 1536
    # 单批 embedding 发送条数 (OpenAI: 推荐 ≤ 512; 自托管模型可调小)
    news_embedding_batch: int = 32
    # 后台任务每轮处理多少条 pending 新闻 (限速控本)
    news_embedding_per_run: int = 200

    # 开发模式: backend lifespan 内顺手 spawn celery worker + beat 子进程, 一个命令拉起全栈.
    # 生产模式 (docker-compose) 应设为 0, 让 worker / beat 各自独立服务管理.
    dev_embed_celery: bool = True
    dev_embed_celery_concurrency: int = 2  # worker -c 参数, 本地 2 足够

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
