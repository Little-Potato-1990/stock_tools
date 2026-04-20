import json
import logging
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.snapshot import DailySnapshot

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        s = get_settings()
        _client = AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url)
    return _client


_MODULE_LABELS = {
    "today": "今日复盘",
    "sentiment": "大盘情绪",
    "ladder": "连板天梯",
    "strong": "强势股",
    "themes": "题材",
    "industries": "行业",
    "capital": "资金分析",
    "lhb": "龙虎榜",
    "search": "搜索",
    "news": "资讯",
    "watchlist": "自选股",
    "ai_track": "AI 战绩",
    "my_review": "我的复盘 (个人交易)",
    "account": "账户套餐",
    "dashboard": "仪表盘",
    "bigdata": "大数据",
}


_RECENT_KIND_LABEL = {
    "stock": "查看个股",
    "theme": "查看题材",
    "ai_explain": "AI 解读",
}


def _format_user_context(context: dict | None) -> str:
    if not context:
        return ""
    lines: list[str] = []
    if context.get("module"):
        m = context["module"]
        lines.append(f"- 当前页面: {_MODULE_LABELS.get(m, m)}")
    if context.get("stockCode"):
        nm = context.get("stockName") or ""
        code = context["stockCode"]
        lines.append(f"- 当前关注个股: {nm}({code})" if nm else f"- 当前关注个股: {code}")
    if context.get("theme"):
        lines.append(f"- 当前关注题材: {context['theme']}")

    watchlist = context.get("watchlist") or []
    if watchlist:
        codes = ", ".join(
            f"{w.get('name') or ''}({w['code']})" if w.get("name") else w["code"]
            for w in watchlist[:30]
            if isinstance(w, dict) and w.get("code")
        )
        if codes:
            lines.append(f"- 用户自选股 ({len(watchlist)}): {codes}")

    recent = context.get("recent") or []
    if recent:
        bits = []
        for r in recent[:6]:
            if not isinstance(r, dict):
                continue
            kind = _RECENT_KIND_LABEL.get(r.get("kind", ""), r.get("kind", ""))
            label = r.get("label") or r.get("key", "")
            ago = r.get("ago_min")
            tail = f" ({ago}分钟前)" if isinstance(ago, int) and ago < 240 else ""
            bits.append(f"{kind}「{label}」{tail}")
        if bits:
            lines.append(f"- 最近交互: {' / '.join(bits)}")

    if not lines:
        return ""
    return (
        "\n\n[用户上下文] 用户提问时可能省略主语, 优先按以下信息推断意图:\n"
        + "\n".join(lines)
        + "\n规则: (1) 提到\"我的票/我自选\"指自选股列表; "
        "(2) 提到\"刚才那只/这只\"按最近交互推断; "
        "(3) 涉及自选股/最近股票时, 即使用户没明确点名, 也要主动提示是否需要重点分析。"
    )


def build_system_prompt(
    trade_date: str | None,
    user_context: dict | None = None,
    db_sync_url: str | None = None,
) -> str:
    """Construct system prompt with market context for the given trade date."""
    base = (
        "你是「复盘 AI 助手」，专注于 A 股超短线复盘分析。"
        "用户会询问涨停、连板、题材、行业、情绪等问题。"
        "请简洁专业地回答，使用中文，适当引用具体数据。"
    )

    base += _format_user_context(user_context)

    if not trade_date:
        return base

    context_parts: list[str] = []
    try:
        from sqlalchemy import create_engine
        settings = get_settings()
        engine = create_engine(settings.database_url_sync)
        with Session(engine) as session:
            for stype in ("overview", "ladder"):
                row = session.execute(
                    select(DailySnapshot)
                    .where(DailySnapshot.trade_date == trade_date, DailySnapshot.snapshot_type == stype)
                    .order_by(DailySnapshot.id.desc())
                    .limit(1)
                ).scalar_one_or_none()
                if row and row.data:
                    context_parts.append(f"[{stype}] {json.dumps(row.data, ensure_ascii=False)[:1500]}")
        engine.dispose()
    except Exception as e:
        logger.warning(f"Failed to load market context: {e}")

    if context_parts:
        return base + f"\n\n以下是 {trade_date} 的市场数据摘要，回答时可引用：\n" + "\n".join(context_parts)
    return base


async def stream_chat(
    model_id: str,
    messages: list[dict],
    trade_date: str | None = None,
    user_context: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream chat completion, yielding SSE-formatted lines."""
    client = _get_client()

    system_prompt = build_system_prompt(trade_date, user_context=user_context)
    full_messages = [{"role": "system", "content": system_prompt}] + messages

    collected = []

    try:
        response = await client.chat.completions.create(
            model=model_id,
            messages=full_messages,
            stream=True,
            max_tokens=2000,
        )

        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                token = delta.content
                collected.append(token)
                yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"

    except Exception as e:
        logger.error(f"LLM stream error: {e}")
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    full_response = "".join(collected)
    yield f"data: {json.dumps({'done': True, 'full_content': full_response}, ensure_ascii=False)}\n\n"
