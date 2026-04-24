"""截图导入持仓、成交原始流水, 与导入作业 API."""

from __future__ import annotations

import logging
from collections import OrderedDict
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.quota import check_and_log_quota
from app.config import get_settings
from app.database import get_db
from app.models.user import User, UserHolding, UserImportJob, UserTradeRaw
from app.services.import_ocr import (
    fill_codes_for_holdings,
    fill_codes_for_trades,
    ocr_holding_screenshot,
    ocr_trade_history_screenshot,
)
from app.services.trade_matcher import materialize_trades, reconcile_and_repair

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_FILE_BYTES = 5 * 1024 * 1024


def _use_real_vision() -> bool:
    s = get_settings()
    return bool(s.openai_api_key and s.openai_api_key.strip())


def _parse_item_date(s: str | None) -> date | None:
    if not s:
        return None
    t = str(s).strip()[:10]
    try:
        return date.fromisoformat(t)
    except ValueError:
        return None


@router.post("/holdings/screenshot")
async def import_holdings_screenshot(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files: list[UploadFile] = File(),
):
    if not files:
        raise HTTPException(400, "需要至少 1 个文件: files")
    now = datetime.now()
    job = UserImportJob(
        user_id=user.id,
        kind="holdings",
        source="screenshot",
        status="pending",
        file_count=len(files),
        created_at=now,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    all_warnings: list[str] = []
    raw_ocr: list[dict] = []
    account_summaries: list[dict] = []
    broker_hints: list[str] = []
    account_label_hints: list[str] = []
    try:
        job.status = "processing"
        await db.commit()
        merged: "OrderedDict[tuple[str, str], dict]" = OrderedDict()
        for f in files:
            data = await f.read()
            if len(data) > _MAX_FILE_BYTES:
                raise HTTPException(413, f"单文件超 5MB: {f.filename}")
            if _use_real_vision():
                await check_and_log_quota(db, user, action="chat", model="gpt-4o", cost_pts=1)
            ocr = await ocr_holding_screenshot(data)
            ocr, extra_w = await fill_codes_for_holdings(db, ocr)
            raw_ocr.append(ocr)
            if ocr.get("account_summary"):
                account_summaries.append(ocr["account_summary"])
            if ocr.get("broker_hint"):
                broker_hints.append(str(ocr["broker_hint"]))
            if ocr.get("account_label_hint"):
                account_label_hints.append(str(ocr["account_label_hint"]))
            w = ocr.get("warnings") or []
            if isinstance(w, list):
                all_warnings.extend(str(x) for x in w)
            all_warnings.extend(extra_w)
            for it in ocr.get("items") or []:
                if not isinstance(it, dict):
                    continue
                code = str(it.get("code", "") or "")
                if not code:
                    continue
                alabel = "default"
                merged[(code, alabel)] = it
        parsed_items = list(merged.values())
        upserted = 0
        for it in parsed_items:
            if not it.get("code"):
                continue
            upserted += 1
            stmt = insert(UserHolding).values(
                user_id=user.id,
                stock_code=str(it["code"]),
                stock_name=it.get("name"),
                qty=int(it.get("qty", 0) or 0),
                available_qty=it.get("available_qty")
                if it.get("available_qty") is not None
                else it.get("qty"),
                avg_cost=it.get("avg_cost"),
                market_price=it.get("market_price"),
                market_value=it.get("market_value"),
                pnl=it.get("pnl"),
                pnl_pct=it.get("pnl_pct"),
                account_label="default",
                source="screenshot",
                last_sync_at=datetime.now(),
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_user_holdings",
                set_={
                    "stock_name": stmt.excluded.stock_name,
                    "qty": stmt.excluded.qty,
                    "available_qty": stmt.excluded.available_qty,
                    "avg_cost": stmt.excluded.avg_cost,
                    "market_price": stmt.excluded.market_price,
                    "market_value": stmt.excluded.market_value,
                    "pnl": stmt.excluded.pnl,
                    "pnl_pct": stmt.excluded.pnl_pct,
                    "source": stmt.excluded.source,
                    "last_sync_at": datetime.now(),
                },
            )
            await db.execute(stmt)
        await db.commit()

        # holdings 更新后, 也跑一次 reconcile 让数据完整性卡片刷新
        # (用户可能先传 trades, 此时 holdings 缺失导致全是 implied_no_holding;
        #  补传 holdings 后能识别需要 virtual_initial 的股票并自动注入)
        try:
            recon = await reconcile_and_repair(db, user.id)
        except Exception as e:
            logger.exception("reconcile_and_repair failed (non-fatal): %s", e)
            recon = None

        job.status = "done"
        job.raw_payload = raw_ocr
        job.parsed_payload = parsed_items
        job.summary = {
            "parsed_count": len(parsed_items),
            "upserted": upserted,
            "warnings_merged": len(all_warnings),
            "broker_hint": broker_hints[0] if broker_hints else None,
            "account_label_hint": account_label_hints[0] if account_label_hints else None,
            "account_summary": account_summaries[0] if account_summaries else None,
            "reconciliation": recon,
        }
        job.finished_at = datetime.now()
        await db.commit()
        return {
            "job_id": job.id,
            "parsed_count": len(parsed_items),
            "upserted": upserted,
            "warnings": all_warnings,
            "broker_hint": broker_hints[0] if broker_hints else None,
            "account_label_hint": account_label_hints[0] if account_label_hints else None,
            "account_summary": account_summaries[0] if account_summaries else None,
            "reconciliation": recon,
        }
    except HTTPException as he:
        try:
            job.status = "failed"
            job.error = f"http:{he.status_code}"
            job.finished_at = datetime.now()
            await db.commit()
        except Exception:
            pass
        raise
    except Exception as e:
        logger.exception("import_holdings: %s", e)
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.finished_at = datetime.now()
            await db.commit()
        except Exception:
            pass
        raise HTTPException(500, str(e)) from e


@router.post("/trades/screenshot")
async def import_trades_screenshot(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files: list[UploadFile] = File(),
):
    if not files:
        raise HTTPException(400, "需要至少 1 个文件: files")
    now = datetime.now()
    job = UserImportJob(
        user_id=user.id,
        kind="trades",
        source="screenshot",
        status="pending",
        file_count=len(files),
        created_at=now,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    all_warnings: list[str] = []
    raw_ocr: list[dict] = []
    raw_inserted = 0
    raw_skipped = 0
    skipped_no_code = 0
    skipped_zero_qty = 0
    parsed_rows: list[dict] = []
    broker_hints: list[str] = []
    account_label_hints: list[str] = []
    try:
        job.status = "processing"
        await db.commit()
        for f in files:
            data = await f.read()
            if len(data) > _MAX_FILE_BYTES:
                raise HTTPException(413, f"单文件超 5MB: {f.filename}")
            if _use_real_vision():
                await check_and_log_quota(db, user, action="chat", model="gpt-4o", cost_pts=1)
            ocr = await ocr_trade_history_screenshot(data)
            ocr, extra_w = await fill_codes_for_trades(db, ocr)
            raw_ocr.append(ocr)
            if ocr.get("broker_hint"):
                broker_hints.append(str(ocr["broker_hint"]))
            if ocr.get("account_label_hint"):
                account_label_hints.append(str(ocr["account_label_hint"]))
            w = ocr.get("warnings") or []
            if isinstance(w, list):
                all_warnings.extend(str(x) for x in w)
            all_warnings.extend(extra_w)

            # 同花顺手机版没 contract_no, 同时间真实拆单 (如 100/100/400 同 15:00:00)
            # 会被 (date,time,code,side,price,qty) 自然唯一约束误判为重复.
            # 解决: 给同批内完全相同的多行追加确定性 dup_idx 到 contract_no.
            # 同张图重传时 OCR 行序一致 -> dup_idx 一致 -> contract_no 一致 -> 仍能去重 (idempotent).
            seen_keys: dict[tuple, int] = {}
            for it in ocr.get("items") or []:
                if not isinstance(it, dict):
                    continue
                key = (
                    str(it.get("trade_date") or ""),
                    str(it.get("trade_time") or ""),
                    str(it.get("code") or ""),
                    str(it.get("side") or ""),
                    str(it.get("price") or ""),
                    str(it.get("qty") or ""),
                )
                idx = seen_keys.get(key, 0)
                seen_keys[key] = idx + 1
                if idx > 0 and not (it.get("contract_no") and str(it["contract_no"]).strip()):
                    it["contract_no"] = (
                        f"ocr:{user.id}:{key[0]}:{key[1]}:{key[2]}:{key[3]}:{key[4]}:{key[5]}:{idx}"
                    )

            for it in ocr.get("items") or []:
                if not isinstance(it, dict):
                    continue
                td = _parse_item_date(it.get("trade_date"))
                if not td:
                    all_warnings.append(f"skip row: 无有效 trade_date {it!r}")
                    continue
                cno = it.get("contract_no")
                if cno is not None and str(cno).strip() == "":
                    cno = None
                else:
                    cno = str(cno) if cno else None
                side = it.get("side", "buy")
                if str(side) not in ("buy", "sell"):
                    all_warnings.append(f"skip: side 非法 {it}")
                    continue
                tt = it.get("trade_time")
                if tt is not None and str(tt).strip() == "":
                    tt = None
                raw = UserTradeRaw(
                    user_id=user.id,
                    trade_date=td,
                    trade_time=tt,
                    stock_code=str(it.get("code", "")).zfill(6)[-6:]
                    if it.get("code")
                    else "",
                    stock_name=it.get("name"),
                    side=str(side).lower()[:8],
                    price=float(it.get("price", 0) or 0),
                    qty=int(it.get("qty", 0) or 0),
                    amount=it.get("amount"),
                    fee=float(it.get("fee", 0) or 0),
                    stamp_tax=float(it.get("stamp_tax", 0) or 0),
                    transfer_fee=float(it.get("transfer_fee", 0) or 0),
                    contract_no=cno,
                    account_label="default",
                    source="screenshot",
                )
                if not raw.stock_code or len(raw.stock_code) < 4:
                    skipped_no_code += 1
                    all_warnings.append(
                        f"skip: 未匹配代码 {raw.stock_name or it.get('name')!r} ({raw.trade_date} {raw.side} {raw.qty}@{raw.price})"
                    )
                    continue
                if raw.qty <= 0 or raw.price <= 0:
                    skipped_zero_qty += 1
                    all_warnings.append(
                        f"skip: 非交易行 qty/price=0 {raw.stock_name!r} {raw.trade_date}"
                    )
                    continue
                try:
                    async with db.begin_nested():
                        db.add(raw)
                        await db.flush()
                    raw_inserted += 1
                    parsed_rows.append(
                        {
                            "stock_code": raw.stock_code,
                            "trade_date": raw.trade_date.isoformat(),
                            "trade_time": raw.trade_time,
                            "side": raw.side,
                            "qty": raw.qty,
                            "price": raw.price,
                            "contract_no": raw.contract_no,
                        }
                    )
                except IntegrityError:
                    raw_skipped += 1
        await db.commit()

        # 端到端: 配对 → 诊断 → 注入 virtual_initial → 重配对 → 终态报告
        # 自动调用; 没持仓数据(holdings)时仍能跑(per_stock 全是 implied_no_holding 类),
        # 注入步骤会因 ground_truth_qty=0 跳过.
        try:
            recon = await reconcile_and_repair(db, user.id)
        except Exception as e:
            logger.exception("reconcile_and_repair failed (non-fatal): %s", e)
            recon = None
        paired_total = int(recon["round_trips_total"]) if recon else 0

        job.status = "done"
        job.raw_payload = raw_ocr
        job.parsed_payload = parsed_rows
        job.summary = {
            "raw_inserted": raw_inserted,
            "raw_skipped_duplicate": raw_skipped,
            "skipped_no_code": skipped_no_code,
            "skipped_zero_qty": skipped_zero_qty,
            "paired_trades": paired_total,
            "broker_hint": broker_hints[0] if broker_hints else None,
            "account_label_hint": account_label_hints[0] if account_label_hints else None,
            "reconciliation": recon,
        }
        job.finished_at = datetime.now()
        await db.commit()
        return {
            "job_id": job.id,
            "raw_inserted": raw_inserted,
            "raw_skipped_duplicate": raw_skipped,
            "skipped_no_code": skipped_no_code,
            "skipped_zero_qty": skipped_zero_qty,
            "paired_trades": paired_total,
            "warnings": all_warnings,
            "broker_hint": broker_hints[0] if broker_hints else None,
            "account_label_hint": account_label_hints[0] if account_label_hints else None,
            "reconciliation": recon,
        }
    except HTTPException as he:
        try:
            job.status = "failed"
            job.error = f"http:{he.status_code}"
            job.finished_at = datetime.now()
            await db.commit()
        except Exception:
            pass
        raise
    except Exception as e:
        logger.exception("import_trades: %s", e)
        try:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.finished_at = datetime.now()
            await db.commit()
        except Exception:
            pass
        raise HTTPException(500, str(e)) from e


@router.get("/reconciliation")
async def get_reconciliation(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """随时查询当前用户的 raw 流水 vs 截图持仓数据完整性诊断 (不触发注入)."""
    from app.services.trade_matcher import compute_reconciliation
    return await compute_reconciliation(db, user.id)


@router.post("/reconciliation/repair")
async def repair_reconciliation(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """显式触发: 跑配对 + 注入 virtual_initial + 重配对 + 终态报告."""
    return await reconcile_and_repair(db, user.id)


@router.get("/jobs")
async def list_import_jobs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(UserImportJob)
        .where(UserImportJob.user_id == user.id)
        .order_by(desc(UserImportJob.created_at))
        .limit(20)
    )
    rows = r.scalars().all()
    return {
        "items": [
            {
                "id": j.id,
                "kind": j.kind,
                "source": j.source,
                "status": j.status,
                "file_count": j.file_count,
                "summary": j.summary,
                "error": (j.error or "")[:500] if j.error else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            }
            for j in rows
        ]
    }


@router.get("/holdings")
async def list_user_holdings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """当前用户持仓列表 (按 market_value 降序, 兜底按 stock_code).

    数据源: UserHolding (由持仓截图 OCR upsert 写入).
    """
    r = await db.execute(
        select(UserHolding).where(UserHolding.user_id == user.id)
    )
    rows = r.scalars().all()
    rows = sorted(
        rows,
        key=lambda h: (
            -(h.market_value or 0.0),
            h.stock_code,
        ),
    )
    return {
        "items": [
            {
                "id": h.id,
                "stock_code": h.stock_code,
                "stock_name": h.stock_name,
                "qty": h.qty,
                "available_qty": h.available_qty,
                "avg_cost": h.avg_cost,
                "market_price": h.market_price,
                "market_value": h.market_value,
                "pnl": h.pnl,
                "pnl_pct": h.pnl_pct,
                "first_buy_date": h.first_buy_date.isoformat() if h.first_buy_date else None,
                "holding_days": h.holding_days,
                "account_label": h.account_label,
                "user_tag": h.user_tag,
                "source": h.source,
                "last_sync_at": h.last_sync_at.isoformat() if h.last_sync_at else None,
            }
            for h in rows
        ]
    }


@router.get("/trades/raw")
async def list_user_trades_raw(
    limit: int = 200,
    offset: int = 0,
    code: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """当前用户的原始成交流水 (按 trade_date desc, id desc).

    用于「我的持仓」页面展示截图导入后的明细。
    - limit: 默认 200, 上限 500
    - offset: 分页
    - code: 可选过滤股票代码
    """
    limit = max(1, min(int(limit or 200), 500))
    offset = max(0, int(offset or 0))
    q = select(UserTradeRaw).where(UserTradeRaw.user_id == user.id)
    if code:
        q = q.where(UserTradeRaw.stock_code == code.strip())

    total_q = select(UserTradeRaw.id).where(UserTradeRaw.user_id == user.id)
    if code:
        total_q = total_q.where(UserTradeRaw.stock_code == code.strip())
    total_r = await db.execute(total_q)
    total = len(total_r.scalars().all())

    q = q.order_by(desc(UserTradeRaw.trade_date), desc(UserTradeRaw.id)).offset(offset).limit(limit)
    r = await db.execute(q)
    rows = r.scalars().all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": t.id,
                "trade_date": t.trade_date.isoformat() if t.trade_date else None,
                "trade_time": t.trade_time,
                "stock_code": t.stock_code,
                "stock_name": t.stock_name,
                "side": t.side,
                "price": t.price,
                "qty": t.qty,
                "amount": t.amount,
                "fee": t.fee,
                "stamp_tax": t.stamp_tax,
                "transfer_fee": t.transfer_fee,
                "contract_no": t.contract_no,
                "account_label": t.account_label,
                "source": t.source,
                "matched_trade_id": t.matched_trade_id,
            }
            for t in rows
        ],
    }


@router.get("/jobs/{job_id}")
async def get_import_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(UserImportJob).where(
            UserImportJob.id == job_id, UserImportJob.user_id == user.id
        )
    )
    j = r.scalar_one_or_none()
    if not j:
        raise HTTPException(404, "job not found")
    return {
        "id": j.id,
        "kind": j.kind,
        "source": j.source,
        "status": j.status,
        "file_count": j.file_count,
        "raw_payload": j.raw_payload,
        "parsed_payload": j.parsed_payload,
        "summary": j.summary,
        "error": j.error,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
    }
