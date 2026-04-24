"""持仓 / 历史成交 截图 OCR — OpenAI Vision (gpt-4o) + 结构化 JSON.

针对同花顺手机版（含中信建投/华泰/国泰君安等使用同花顺技术栈的券商）特化。
"""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.llm_service import _get_client
from app.config import get_settings
from app.models.stock import Stock

logger = logging.getLogger(__name__)

# --- Prompts: 针对同花顺手机版真实布局特化 ----------------------------------------------------

_HOLDING_VISION_PROMPT = """你是 A 股证券 APP「持仓页」截图识别助手，专攻同花顺手机版
（含中信建投、华泰、国泰君安、平安等所有使用同花顺技术栈的券商 APP）。

【典型截图特征】
- 顶部红色 Header：券商名（如「中信建投证券」）+ 账户尾号（**XXXX）
- 标签页：买入 / 卖出 / 撤单 / 持仓（高亮）/ 查询
- 资产汇总卡（位于持仓列表上方）：
    总资产 / 总盈亏 / 当日参考盈亏（带百分比）
    总市值 / 可用 / 可取
- 持仓股列表 4 列：「市值/股票名」、「盈亏/盈亏%」、「持仓/可用」、「成本/现价」
  ⚠️ 每个 cell 是【上下双行】结构，必须按列对齐识别：
    第 1 列：上行=股票名（彩色），下行=市值（元）
    第 2 列：上行=盈亏金额（红正/蓝负），下行=盈亏百分比
    第 3 列：上行=持仓数量（股），下行=可用数量（股）
    第 4 列：上行=成本价（元），下行=现价（元）

【⚡ 完整性铁律 - 最高优先级 - 违反即任务失败 ⚡】
1. 你必须输出截图中【每一个可见的持仓行】, 一行都不能漏
2. 在内心先数：「持仓股」列表区域可见 N 行 → items 数组长度必须 = N
3. 不要只输出第一行就停止, 不要"给个示例"了事
4. 即使有 10 行、20 行也要全部抽出, 不准跳行
5. 在 warnings 里加一条 "row_count_check: 截图可见 N 行, 已抽取 N 行" 自我证明

【其他约束】
1. 同花顺持仓页【完全没有】股票代码列, items[].code 一律输出 null, 由后端按 name 反查
2. 颜色编码：红色=正盈亏, 绿色或蓝色=负盈亏；负号 "-" 必须保留
3. 数字单位与精度：
   - 市值/盈亏：元, 保留 2 位小数
   - 持仓/可用：股, 整数
   - 成本/现价：元, 保留 3 位小数
   - 百分比：8.597% → 输出 8.597（裸数字不带 %）, 亏损 -7.098% → -7.098
4. 资产汇总放到 account_summary 字段, 绝对不要混进 items
5. 账户尾号识别为 4 位数字（如 "**4370" → "4370"）

【输出 JSON 结构 - 严格遵守】
{
  "screen_type": "holding_page",
  "broker_hint": "中信建投证券",
  "account_label_hint": "4370",
  "as_of": null,
  "account_summary": {
    "total_asset": 617670.28,
    "total_pnl": 6203.66,
    "today_ref_pnl": -15698.00,
    "today_ref_pnl_pct": -2.48,
    "total_market_value": 391456.00,
    "available_cash": 226024.00,
    "withdrawable_cash": 226024.00,
    "position_ratio": 63.4
  },
  "items": [
    {
      "code": null,
      "name": "兆易创新",
      "qty": 500,
      "available_qty": 500,
      "avg_cost": 274.132,
      "market_price": 297.700,
      "market_value": 148850.00,
      "pnl": 11783.78,
      "pnl_pct": 8.597
    }
  ],
  "extraction_confidence": "high|medium|low",
  "warnings": []
}
"""

_TRADE_VISION_PROMPT = """你是 A 股证券 APP「历史成交」页截图识别助手，专攻同花顺手机版
（含中信建投、华泰、国泰君安、平安等所有使用同花顺技术栈的券商 APP）。

【典型截图特征】
- 顶部红色 Header：券商名 + 账户尾号（**XXXX）
- 标签页：当日委托 / 当日成交 / 历史委托 / 历史成交（高亮）
- Filter chip：默认 / 按股票 / 按做T，下方日期范围（YYYY-MM-DD ~ YYYY-MM-DD）+ 红色「确定」按钮
- 列头 4 列：「成交日期」、「成交价」、「成交量」、「成交额」
- 每行是【上下双行】结构：
    第 1 列：上行=股票名（彩色：红=买入相关、蓝=卖出相关），下行=日期+时间紧凑格式（如 "20260331 14:02:34"）
    第 2 列：成交价（3 位小数）
    第 3 列：成交量（整数股）
    第 4 列：上行=成交额（3 位小数），下行=红色「买入」或蓝色「卖出」标签
- 股票名左侧有【小色块徽章】「买」（红底白字）或「卖」（蓝底白字）

【⚠️ 必须跳过的非交易行 - 极其重要】
同花顺会把以下条目混在历史成交列表里，必须【全部跳过】，绝对不要放进 items：
- "智能投顾佣金"（特征：成交价=0.000，成交量=0，时间=00:00:00，无买/卖徽章）
- "现金分红" / "股息税" / "送股" / "转增" / "新股配号" / "公司行为"
- 任何 price=0 或 qty=0 的行
- 任何股票名旁【没有】红色「买」或蓝色「卖」徽章的行
判定铁律：必须能明确看到「买」或「卖」徽章，否则一律跳过。

【⚠️ 时间识别铁律 - 防止 OCR 时间 leak】
每个真实成交行的【日期+时间】只能从该行【自己】的第二行文字读取
绝对不允许：把上一行(尤其智投佣金的 00:00:00)或下一行的时间错误归属到当前真实成交行
A 股真实成交时间一定在 09:30:00-15:00:00 之间, 绝不可能是 00:00:00
如果某真实成交行的时间识别为 00:00:00, 说明你看错行了, 必须重新对齐

【⚡ 完整性铁律 - 最高优先级 - 违反即任务失败 ⚡】
1. 你必须输出截图中【每一笔可见的真实成交行】(有"买"或"卖"徽章的), 一笔都不能漏
2. 在内心先数：截图列表区域【可见 N 笔有买/卖徽章的成交】 → items 数组长度必须 = N
3. 不要只输出前 1-2 笔就停止, 不要"给个示例"了事
4. 即使列表有 10 笔、20 笔也要全部抽出, 不准跳行
5. 同一股票同一时间多笔(如 3 笔同 15:00:00 但 qty 不同)必须各算一行, 绝不合并
6. 在 warnings 里加一条 "row_count_check: 截图可见 N 笔成交 + M 笔已跳过(佣金/分红等), 已抽取 N 笔" 自我证明

【其他约束】
1. 同花顺手机版【完全没有】股票代码列, items[].code 一律输出 null, 后端反查
2. 同花顺手机版【完全没有】手续费/印花税/过户费/合同编号, 相关字段全部置 0 或 null
3. 日期时间格式转换：
   - "20260331" → "2026-03-31"
   - "20260331 14:02:34" → trade_date="2026-03-31", trade_time="14:02:34"
   - 时间为 "00:00:00" 通常代表非交易行(公司行为), 需结合是否有买/卖徽章判断
4. side 判定：徽章「买」→ "buy", 徽章「卖」→ "sell"

【输出 JSON 结构 - 严格遵守】
{
  "screen_type": "trade_history_page",
  "broker_hint": "中信建投证券",
  "account_label_hint": "4370",
  "date_range": {"start": "2026-01-01", "end": "2026-04-24"},
  "items": [
    {
      "trade_date": "2026-03-31",
      "trade_time": "14:02:34",
      "code": null,
      "name": "兆易创新",
      "side": "buy",
      "price": 241.390,
      "qty": 200,
      "amount": 48278.000,
      "fee": 0,
      "stamp_tax": 0,
      "transfer_fee": 0,
      "contract_no": null
    },
    {
      "trade_date": "2026-03-04",
      "trade_time": "13:00:07",
      "code": null,
      "name": "兆易创新",
      "side": "sell",
      "price": 281.221,
      "qty": 800,
      "amount": 224977.000,
      "fee": 0,
      "stamp_tax": 0,
      "transfer_fee": 0,
      "contract_no": null
    }
  ],
  "extraction_confidence": "high|medium|low",
  "warnings": []
}
"""

_SCHEMA_HINT_HOLDING = "请严格按上面 JSON 结构输出，不要加任何额外字段或注释。"
_SCHEMA_HINT_TRADE = "请严格按上面 JSON 结构输出，不要加任何额外字段或注释。"


def _image_mime_base64_url(image_bytes: bytes) -> str:
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    elif image_bytes[:2] == b"\xff\xd8":
        mime = "image/jpeg"
    elif image_bytes[:6] in (b"GIF87a", b"GIF89a"):
        mime = "image/gif"
    else:
        mime = "image/jpeg"
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _is_valid_stock_code(code: str) -> bool:
    return bool(re.fullmatch(r"\d{6}", code))


def _coerce_holding_result(raw: dict[str, Any]) -> dict[str, Any]:
    warnings: list[str] = list(raw.get("warnings") or [])
    if raw.get("screen_type") != "holding_page":
        warnings.append("schema: screen_type 应为 holding_page")
    items_in = raw.get("items") or []
    items_out: list[dict[str, Any]] = []
    for it in items_in:
        if not isinstance(it, dict):
            warnings.append("schema: item 非对象")
            continue
        code_raw = it.get("code")
        code = "" if code_raw in (None, "", "null") else str(code_raw)
        if code and not _is_valid_stock_code(code):
            warnings.append(f"schema: code 非6位数字: {code!r}, 已忽略待反查")
            code = ""
        name = it.get("name")
        if name is not None and not isinstance(name, str):
            name = str(name)
        try:
            qty = int(it.get("qty", 0) or 0)
        except (TypeError, ValueError):
            qty = 0
            warnings.append("schema: qty 非整数")
        try:
            aq = it.get("available_qty")
            available_qty = int(aq) if aq is not None else qty
        except (TypeError, ValueError):
            available_qty = qty
        for key in ("avg_cost", "market_price", "market_value", "pnl", "pnl_pct"):
            v = it.get(key)
            if v is not None and not isinstance(v, (int, float)):
                try:
                    it[key] = float(v)
                except (TypeError, ValueError):
                    it[key] = None
                    warnings.append(f"schema: {key} 非数字")
        items_out.append({
            "code": code,
            "name": name,
            "qty": qty,
            "available_qty": available_qty,
            "avg_cost": it.get("avg_cost"),
            "market_price": it.get("market_price"),
            "market_value": it.get("market_value"),
            "pnl": it.get("pnl"),
            "pnl_pct": it.get("pnl_pct"),
        })
    conf0 = raw.get("extraction_confidence", "low")
    if conf0 not in ("high", "medium", "low"):
        warnings.append("schema: extraction_confidence 非法")
    as_of = raw.get("as_of")
    if as_of is not None and as_of != "" and not re.match(
        r"\d{4}-\d{2}-\d{2}$", str(as_of)
    ):
        warnings.append("schema: as_of 日期格式异常")
    summary = raw.get("account_summary")
    if summary is not None and not isinstance(summary, dict):
        summary = None
    account_hint = raw.get("account_label_hint")
    if account_hint is not None:
        account_hint = str(account_hint).strip() or None
    return {
        "screen_type": "holding_page",
        "broker_hint": raw.get("broker_hint"),
        "account_label_hint": account_hint,
        "as_of": as_of,
        "account_summary": summary,
        "items": items_out,
        "extraction_confidence": conf0
        if conf0 in ("high", "medium", "low")
        else "low",
        "warnings": warnings,
    }


def _coerce_trade_result(raw: dict[str, Any]) -> dict[str, Any]:
    warnings: list[str] = list(raw.get("warnings") or [])
    if raw.get("screen_type") != "trade_history_page":
        warnings.append("schema: screen_type 应为 trade_history_page")
    items_in = raw.get("items") or []
    items_out: list[dict[str, Any]] = []
    for it in items_in:
        if not isinstance(it, dict):
            warnings.append("schema: item 非对象")
            continue
        code_raw = it.get("code")
        code = "" if code_raw in (None, "", "null") else str(code_raw)
        if code and not _is_valid_stock_code(code):
            warnings.append(f"schema: code 非6位数字: {code!r}, 已忽略待反查")
            code = ""
        side = str(it.get("side", "")).lower()
        if side not in ("buy", "sell"):
            warnings.append(f"schema: side 应为 buy|sell, 得 {it.get('side')!r}")
        td = it.get("trade_date")
        if td is not None and not re.match(r"\d{4}-\d{2}-\d{2}$", str(td)):
            warnings.append("schema: trade_date 格式异常")
        tt = it.get("trade_time")
        if tt is not None and not re.match(r"\d{1,2}:\d{2}:\d{2}$", str(tt)):
            warnings.append("schema: trade_time 格式异常")
        # A 股真实成交时间一定在 09:30:00-15:00:00 之间, 00:00:00 是非交易行 OCR 误读 → 整行剔除
        if str(tt).strip() == "00:00:00":
            warnings.append(
                f"剔除: trade_time=00:00:00 疑似非交易行 OCR 误读 ({it.get('trade_date')} {it.get('name')} {side} {it.get('qty')}@{it.get('price')})"
            )
            continue
        for key, default in (
            ("price", 0.0), ("qty", 0), ("amount", 0.0),
            ("fee", 0.0), ("stamp_tax", 0.0), ("transfer_fee", 0.0),
        ):
            v = it.get(key, default)
            if key == "qty":
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    v = 0
                    warnings.append("schema: qty 非整数")
            else:
                try:
                    v = float(v) if v is not None else 0.0
                except (TypeError, ValueError):
                    v = 0.0
            it[key] = v
        cno = it.get("contract_no")
        if cno is not None and cno != "":
            cno = str(cno)
        else:
            cno = None
        items_out.append({
            "trade_date": str(td) if td else None,
            "trade_time": str(tt) if tt else None,
            "code": code,
            "name": it.get("name"),
            "side": side if side in ("buy", "sell") else "buy",
            "price": float(it.get("price", 0) or 0),
            "qty": int(it.get("qty", 0) or 0),
            "amount": it.get("amount"),
            "fee": float(it.get("fee", 0) or 0),
            "stamp_tax": float(it.get("stamp_tax", 0) or 0),
            "transfer_fee": float(it.get("transfer_fee", 0) or 0),
            "contract_no": cno,
        })
    account_hint = raw.get("account_label_hint")
    if account_hint is not None:
        account_hint = str(account_hint).strip() or None
    date_range = raw.get("date_range")
    if date_range is not None and not isinstance(date_range, dict):
        date_range = None
    return {
        "screen_type": "trade_history_page",
        "broker_hint": raw.get("broker_hint"),
        "account_label_hint": account_hint,
        "date_range": date_range,
        "items": items_out,
        "extraction_confidence": raw.get("extraction_confidence", "low")
        if raw.get("extraction_confidence") in ("high", "medium", "low")
        else "low",
        "warnings": warnings,
    }


# --- Stock name → code 反查 ---------------------------------------------------------------

_NAME_CODE_CACHE: dict[str, str | None] = {}


async def lookup_codes_by_names(
    db: AsyncSession, names: list[str]
) -> dict[str, str | None]:
    """用现有 stocks 表把股票名反查成 6 位代码。

    策略:
        1. 先查内存缓存
        2. 一次 IN 查询拿全部精确匹配
        3. 没命中的再逐个尝试模糊匹配 (LIKE %name%, 限制 1 条且去 ST 前缀)
        4. 仍找不到的返回 None, 调用方记 warning

    返回:
        {name: code or None}, 包含输入的全部去重后名字
    """
    out: dict[str, str | None] = {}
    todo: list[str] = []
    for n in names:
        if not n:
            continue
        nn = str(n).strip()
        if not nn:
            continue
        if nn in _NAME_CODE_CACHE:
            out[nn] = _NAME_CODE_CACHE[nn]
        else:
            todo.append(nn)

    if not todo:
        return out

    todo_uniq = list(dict.fromkeys(todo))
    rows = (
        await db.execute(
            select(Stock.name, Stock.code).where(Stock.name.in_(todo_uniq))
        )
    ).all()
    exact = {r[0]: r[1] for r in rows}
    for n in todo_uniq:
        if n in exact:
            out[n] = exact[n]
            _NAME_CODE_CACHE[n] = exact[n]
            continue
        # 兜底: 去掉常见前缀后精确匹配; 再不行 LIKE
        stripped = re.sub(r"^(ST|\*ST|XR|XD|DR|N)\s*", "", n).strip()
        candidate: str | None = None
        if stripped and stripped != n:
            r = (
                await db.execute(
                    select(Stock.code).where(Stock.name == stripped).limit(1)
                )
            ).first()
            candidate = r[0] if r else None
        if candidate is None:
            r = (
                await db.execute(
                    select(Stock.code)
                    .where(Stock.name.like(f"%{n}%"))
                    .order_by(Stock.code)
                    .limit(1)
                )
            ).first()
            candidate = r[0] if r else None
        out[n] = candidate
        _NAME_CODE_CACHE[n] = candidate
    return out


async def fill_codes_for_holdings(
    db: AsyncSession, parsed: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """给 holdings OCR 结果回填 code, 返回 (parsed, extra_warnings)."""
    extra: list[str] = []
    items = parsed.get("items") or []
    need: list[str] = [
        str(it.get("name") or "")
        for it in items
        if not it.get("code") and it.get("name")
    ]
    mp = await lookup_codes_by_names(db, need) if need else {}
    for it in items:
        if it.get("code"):
            continue
        nm = str(it.get("name") or "").strip()
        if not nm:
            extra.append(f"持仓行无名字, 已跳过: {it!r}")
            it["code"] = ""
            continue
        c = mp.get(nm)
        if c:
            it["code"] = c
        else:
            it["code"] = ""
            extra.append(f"未匹配股票代码 (持仓): {nm}, 请手动确认")
    return parsed, extra


async def fill_codes_for_trades(
    db: AsyncSession, parsed: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """给 trade_history OCR 结果回填 code."""
    extra: list[str] = []
    items = parsed.get("items") or []
    need: list[str] = [
        str(it.get("name") or "")
        for it in items
        if not it.get("code") and it.get("name")
    ]
    mp = await lookup_codes_by_names(db, need) if need else {}
    for it in items:
        if it.get("code"):
            continue
        nm = str(it.get("name") or "").strip()
        if not nm:
            extra.append(f"成交行无名字, 已跳过: {it!r}")
            it["code"] = ""
            continue
        c = mp.get(nm)
        if c:
            it["code"] = c
        else:
            it["code"] = ""
            extra.append(f"未匹配股票代码 (成交): {nm}, 请手动确认")
    return parsed, extra


async def _call_vision(image_bytes: bytes, prompt: str, schema_hint: str) -> dict[str, Any]:
    s = get_settings()
    if not (s.openai_api_key and s.openai_api_key.strip()):
        return {}

    user_content: list[dict[str, Any]] = [
        {"type": "text", "text": f"{prompt}\n\n{schema_hint}"},
        {"type": "image_url", "image_url": {"url": _image_mime_base64_url(image_bytes)}},
    ]
    client = _get_client()
    model_name = s.vision_ocr_model or "claude-haiku-4-5-20251001"
    # 优先尝试强制 JSON; 部分模型 (Claude / Gemini 经代理) 不支持 response_format,
    # 失败回退到纯文本 prompt 强约束 + 容错解析.
    last_err: Exception | None = None
    for use_json_mode in (True, False):
        kwargs: dict[str, Any] = {
            "model": model_name,
            "messages": [{"role": "user", "content": user_content}],
            "max_tokens": 4096,
            "temperature": 0,
        }
        if use_json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            resp = await client.chat.completions.create(**kwargs)
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            if use_json_mode and (
                "response_format" in msg
                or "json_object" in msg
                or "not supported" in msg
                or "invalid_request_error" in msg
            ):
                continue
            raise
        choice = resp.choices[0] if resp.choices else None
        if not choice or not choice.message or not choice.message.content:
            raise ValueError("empty vision response")
        text = choice.message.content.strip()
        # 容错: 部分模型可能包 ```json ... ``` 或前后带解释段
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        # 找第一个 { 到最后一个 } 之间的子串
        if not text.startswith("{"):
            l = text.find("{")
            r = text.rfind("}")
            if l >= 0 and r > l:
                text = text[l : r + 1]
        return json.loads(text)
    if last_err:
        raise last_err
    raise ValueError("vision call exhausted retries")


async def ocr_holding_screenshot(image_bytes: bytes) -> dict[str, Any]:
    s = get_settings()
    if not (s.openai_api_key and s.openai_api_key.strip()):
        return _coerce_holding_result(_mock_holding())
    try:
        raw = await _call_vision(image_bytes, _HOLDING_VISION_PROMPT, _SCHEMA_HINT_HOLDING)
    except Exception as e:
        logger.exception("ocr holding: %s", e)
        w = _mock_holding()
        w["warnings"] = list(w.get("warnings") or []) + [f"ocr_error: {e!s}"]
        return _coerce_holding_result(w)
    if not raw:
        return _coerce_holding_result(_mock_holding())
    return _coerce_holding_result(raw)


async def ocr_trade_history_screenshot(image_bytes: bytes) -> dict[str, Any]:
    s = get_settings()
    if not (s.openai_api_key and s.openai_api_key.strip()):
        return _coerce_trade_result(_mock_trade())
    try:
        raw = await _call_vision(image_bytes, _TRADE_VISION_PROMPT, _SCHEMA_HINT_TRADE)
    except Exception as e:
        logger.exception("ocr trade: %s", e)
        w = _mock_trade()
        w["warnings"] = list(w.get("warnings") or []) + [f"ocr_error: {e!s}"]
        return _coerce_trade_result(w)
    if not raw:
        return _coerce_trade_result(_mock_trade())
    return _coerce_trade_result(raw)


def _mock_holding() -> dict[str, Any]:
    """Mock 数据 - 用真实截图里的中信建投 4370 账户做样本."""
    return {
        "screen_type": "holding_page",
        "broker_hint": "中信建投证券",
        "account_label_hint": "4370",
        "as_of": None,
        "account_summary": {
            "total_asset": 617670.28,
            "total_pnl": 6203.66,
            "today_ref_pnl": -15698.00,
            "today_ref_pnl_pct": -2.48,
            "total_market_value": 391456.00,
            "available_cash": 226024.00,
            "withdrawable_cash": 226024.00,
            "position_ratio": 63.4,
        },
        "items": [
            {
                "code": None,
                "name": "兆易创新",
                "qty": 500,
                "available_qty": 500,
                "avg_cost": 274.132,
                "market_price": 297.700,
                "market_value": 148850.00,
                "pnl": 11783.78,
                "pnl_pct": 8.597,
            },
            {
                "code": None,
                "name": "中国卫星",
                "qty": 1100,
                "available_qty": 1100,
                "avg_cost": 103.658,
                "market_price": 96.300,
                "market_value": 105930.00,
                "pnl": -8094.10,
                "pnl_pct": -7.098,
            },
            {
                "code": None,
                "name": "沪电股份",
                "qty": 700,
                "available_qty": 700,
                "avg_cost": 100.217,
                "market_price": 102.380,
                "market_value": 71666.00,
                "pnl": 1514.34,
                "pnl_pct": 2.158,
            },
            {
                "code": None,
                "name": "工业富联",
                "qty": 1000,
                "available_qty": 1000,
                "avg_cost": 64.010,
                "market_price": 65.010,
                "market_value": 65010.00,
                "pnl": 999.64,
                "pnl_pct": 1.562,
            },
        ],
        "extraction_confidence": "low",
        "warnings": ["mock: OPENAI_API_KEY 未配置, 返回演示数据 (中信建投样例)"],
    }


def _mock_trade() -> dict[str, Any]:
    """Mock 数据 - 用真实截图里兆易创新的成交流水做样本."""
    return {
        "screen_type": "trade_history_page",
        "broker_hint": "中信建投证券",
        "account_label_hint": "4370",
        "date_range": {"start": "2026-01-01", "end": "2026-04-24"},
        "items": [
            {
                "trade_date": "2026-03-31", "trade_time": "14:02:34",
                "code": None, "name": "兆易创新", "side": "buy",
                "price": 241.390, "qty": 200, "amount": 48278.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
            {
                "trade_date": "2026-03-04", "trade_time": "13:00:07",
                "code": None, "name": "兆易创新", "side": "sell",
                "price": 281.221, "qty": 800, "amount": 224977.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
            {
                "trade_date": "2026-02-11", "trade_time": "10:40:17",
                "code": None, "name": "兆易创新", "side": "buy",
                "price": 283.100, "qty": 200, "amount": 56620.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
            {
                "trade_date": "2026-02-10", "trade_time": "10:25:16",
                "code": None, "name": "兆易创新", "side": "buy",
                "price": 289.760, "qty": 400, "amount": 115904.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
            {
                "trade_date": "2026-02-09", "trade_time": "15:00:00",
                "code": None, "name": "兆易创新", "side": "buy",
                "price": 292.980, "qty": 100, "amount": 29298.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
            {
                "trade_date": "2026-02-09", "trade_time": "15:00:00",
                "code": None, "name": "兆易创新", "side": "buy",
                "price": 292.980, "qty": 100, "amount": 29298.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
            {
                "trade_date": "2026-02-09", "trade_time": "15:00:00",
                "code": None, "name": "兆易创新", "side": "buy",
                "price": 292.980, "qty": 400, "amount": 117192.000,
                "fee": 0, "stamp_tax": 0, "transfer_fee": 0, "contract_no": None,
            },
        ],
        "extraction_confidence": "low",
        "warnings": ["mock: OPENAI_API_KEY 未配置, 返回演示数据 (中信建投样例)"],
    }
