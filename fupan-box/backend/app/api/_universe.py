"""universe= 查询参数 → SQL where 子句 helper."""

from app.models.stock import Stock

UNIVERSE_FILTERS = {
    "default": lambda: Stock.status.in_(["listed_active", "st", "star_st"]),
    "wide": lambda: None,  # 不过滤
    "active_only": lambda: Stock.status == "listed_active",
    "st_only": lambda: Stock.status.in_(["st", "star_st"]),
    "delisted_only": lambda: Stock.status == "delisted",
}


def universe_clause(universe: str = "default"):
    """返回可加入 SQLAlchemy where 的 clause；无过滤返 None。"""
    fn = UNIVERSE_FILTERS.get(universe, UNIVERSE_FILTERS["default"])
    return fn()
