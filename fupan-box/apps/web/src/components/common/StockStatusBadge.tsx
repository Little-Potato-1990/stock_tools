"use client";

import type { CSSProperties, FC, ReactNode } from "react";

export type StockStatus = "listed_active" | "st" | "star_st" | "suspended" | "delisted";

interface Props {
  status?: StockStatus | null;
  board?: string | null;
  size?: "sm" | "md";
}

function boardAbbr(board: string | null | undefined): string | null {
  if (!board) return null;
  if (board.includes("科创")) return "科";
  if (board.includes("创业")) return "创";
  if (board.includes("北交")) return "北";
  return null;
}

/** 在股票名旁边显示 ST / *ST / 退 / 停 等小徽章. listed_active 不显示. */
const StockStatusBadge: FC<Props> = ({ status, board, size = "sm" }) => {
  const sm = size === "sm";
  const fs = sm ? 9 : 11;
  const br: CSSProperties = { borderRadius: 3, fontSize: fs, fontWeight: 700, lineHeight: sm ? "13px" : "15px", flexShrink: 0 };

  const boardShort = boardAbbr(board);
  const showBoard = Boolean(boardShort);

  let statusEl: ReactNode = null;
  if (status && status !== "listed_active") {
    if (status === "st") {
      statusEl = (
        <span
          className="inline-flex items-center"
          style={{ ...br, border: "1px solid rgba(234, 179, 8, 0.65)", color: "#fbbf24", background: "rgba(234, 179, 8, 0.08)" }}
        >
          ST
        </span>
      );
    } else if (status === "star_st") {
      statusEl = (
        <span
          className="inline-flex items-center"
          style={{ ...br, border: "1px solid rgba(248, 113, 113, 0.7)", color: "var(--accent-red, #f87171)", background: "rgba(248, 113, 113, 0.08)" }}
        >
          *ST
        </span>
      );
    } else if (status === "delisted") {
      statusEl = (
        <span
          className="inline-flex items-center"
          style={{ ...br, border: "none", color: "var(--text-secondary, #a1a1aa)", background: "rgba(113, 113, 122, 0.45)" }}
        >
          退市
        </span>
      );
    } else if (status === "suspended") {
      statusEl = (
        <span
          className="inline-flex items-center"
          style={{ ...br, border: "1px solid rgba(100, 116, 139, 0.55)", color: "rgb(148, 163, 184)", background: "rgba(71, 85, 105, 0.2)" }}
        >
          停牌
        </span>
      );
    }
  }

  if (!statusEl && !showBoard) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {statusEl}
      {showBoard && (
        <span style={{ fontSize: sm ? 8 : 10, color: "var(--text-muted)", fontWeight: 600 }}>{boardShort}</span>
      )}
    </span>
  );
};

export default StockStatusBadge;
