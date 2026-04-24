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
    # 截图 OCR 专用视觉模型. 同花顺持仓/成交识别走这个.
    # 默认 claude-sonnet-4-5: 长截图列表行抽取完整 (haiku-4-5 实测会漏行);
    # 单张成本约 ¥0.18, 个人用户充 ¥40 够 200+ 张.
    # 如代理换通道, 改环境变量 VISION_OCR_MODEL 即可, 无需改代码.
    vision_ocr_model: str = "claude-sonnet-4-5-20250929"

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

    # === Phase 5 方法论文库 (Methodology) ===
    # 方法论 markdown 文章根目录. 默认 backend 同级 content/methodology;
    # 容器部署时可以通过环境变量覆盖 (例如 /app/content/methodology).
    methodology_content_dir: str = ""

    # === Phase 1 限流 ===
    # 匿名 IP / 登录 user 滑窗限流, 60 秒窗口
    rate_limit_anonymous_per_min: int = 60
    rate_limit_user_per_min: int = 300
    rate_limit_enabled: bool = True

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
