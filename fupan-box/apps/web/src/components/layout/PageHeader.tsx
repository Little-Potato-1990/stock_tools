"use client";

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** 不显示头部下方的分割线 */
  noBorder?: boolean;
}

export function PageHeader({ title, subtitle, actions, noBorder }: Props) {
  return (
    <div
      className="flex items-center justify-between px-4"
      style={{
        height: 44,
        borderBottom: noBorder ? "none" : "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
      }}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <h1
          className="font-bold truncate"
          style={{ color: "var(--text-primary)", fontSize: "var(--font-lg)" }}
        >
          {title}
        </h1>
        {subtitle && (
          <span
            className="truncate"
            style={{ color: "var(--text-muted)", fontSize: 11 }}
          >
            {subtitle}
          </span>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}
