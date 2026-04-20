"""Service layer.

把跨 API / 跨 Celery task 复用的纯业务逻辑放在这里, 让:
- `app/api/*` 只做 HTTP 协议 (鉴权 / 参数校验 / 序列化)
- `app/tasks/*` 只做 celery wrap (定时 / 重试 / sync 包装)
- `app/ai/*` 只做 LLM prompt + heuristic + merge
- `app/services/*` 是上述三层的"业务中枢", 负责"加什么缓存 / 跑哪些组合 / 什么阈值过滤"

避免出现 API 层直接 `from app.tasks.xxx import _private_async` 的反向耦合.
"""
