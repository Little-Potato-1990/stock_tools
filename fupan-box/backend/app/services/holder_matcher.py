"""持有人身份匹配——把"中央汇金资产管理有限责任公司"标准化为"中央汇金"."""
from __future__ import annotations
import re
from typing import Iterable
from sqlalchemy.orm import Session
from app.models.holder import HolderIdentityRegistry


_NORM_PATTERN = re.compile(r"[^\w\u4e00-\u9fff]+")


def _normalize(name: str) -> str:
    """去标点 / 大小写 / 多余空格."""
    if not name:
        return ""
    return _NORM_PATTERN.sub("", name.lower())


class HolderIdentityMatcher:
    """从 holder_identity_registry 装载别名表, 提供 match() 服务."""

    def __init__(self, session: Session):
        self.session = session
        self._index: list[tuple[str, str, str, str | None, int]] = []
        # (normalized_alias, canonical_name, holder_type, fund_company, weight)
        self._loaded = False

    def reload(self):
        self._index.clear()
        regs = self.session.query(HolderIdentityRegistry).filter(
            HolderIdentityRegistry.is_active.is_(True)
        ).all()
        for r in regs:
            for al in r.aliases or [r.canonical_name]:
                key = _normalize(al)
                if key:
                    self._index.append((key, r.canonical_name, r.holder_type, r.fund_company, r.weight))
            ck = _normalize(r.canonical_name)
            if ck:
                self._index.append((ck, r.canonical_name, r.holder_type, r.fund_company, r.weight))
        self._index.sort(key=lambda x: -len(x[0]))  # 长别名优先匹配
        self._loaded = True

    def _ensure(self):
        if not self._loaded:
            self.reload()

    def match(self, holder_name: str) -> tuple[str | None, str, str | None]:
        """返回 (canonical_name, holder_type, fund_company); 没匹配上返回 (None, "other", None)."""
        self._ensure()
        if not holder_name:
            return None, "other", None
        key = _normalize(holder_name)
        if not key:
            return None, "other", None
        for alias_key, canonical, htype, fund_co, _w in self._index:
            if alias_key in key or key in alias_key:
                return canonical, htype, fund_co
        # 简单启发: 含"基金管理" => fund; 含"保险"/"人寿"/"财险" => insurance
        if any(s in holder_name for s in ("基金管理", "基金股份")):
            return None, "fund", None
        if any(s in holder_name for s in ("保险", "人寿", "财险", "资产管理")):
            return None, "insurance", None
        if any(s in holder_name for s in ("社保",)):
            return None, "social", None
        return None, "other", None

    def match_many(self, names: Iterable[str]) -> dict[str, tuple[str | None, str, str | None]]:
        return {n: self.match(n) for n in names}
