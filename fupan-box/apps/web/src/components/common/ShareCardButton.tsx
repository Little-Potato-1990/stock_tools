"use client";

/**
 * P1 #14 通用分享卡片
 * - 零依赖: 仅用 SVG + Canvas drawImage 把 SVG 转 PNG
 * - 支持: 复制摘要文本 / 下载 SVG / 下载 PNG
 * - 适用: WhyRoseModal / DebateModal / 长线 brief / 任何"AI 结论 + 几条要点"的场景
 *
 * 调用方式:
 *   <ShareCardButton
 *     title="贵州茅台 600519"
 *     subtitle="AI 解读 · 2025-04-22"
 *     verdict="S 罕见龙头"
 *     verdictColor="#a855f7"
 *     headline="主线核心位置, 三要素齐备"
 *     sections={[ {label:"驱动", text:"..."}, {label:"卡位", text:"..."} ]}
 *     footer="fupan-box · AI 复盘助手"
 *   />
 */

import { useState, useMemo } from "react";
import { Share2, X, Copy, Download, Image as ImageIcon, CheckCheck } from "lucide-react";

export interface ShareSection {
  label: string;
  text: string;
}

interface Props {
  title: string;
  subtitle?: string;
  verdict?: string;
  verdictColor?: string;
  headline: string;
  sections?: ShareSection[];
  footer?: string;
  /** 触发按钮的样式风格: chip (默认, 在卡片 footer 用) / icon (只显示图标) / inline (深色按钮) */
  variant?: "chip" | "icon" | "inline";
  /** 触发按钮自定义 label */
  buttonLabel?: string;
}

const CARD_W = 720;
const CARD_H = 1080;
const PADDING = 56;

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 粗略中英文混合自动换行: 中文按字, 英文按词 */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  let chCount = 0;
  // 1 中文 = 2, 半角 = 1
  const widthOf = (c: string) => (/[\u4e00-\u9fa5\uFF00-\uFFEF]/.test(c) ? 2 : 1);
  for (const ch of text) {
    const w = widthOf(ch);
    if (chCount + w > maxCharsPerLine) {
      lines.push(line);
      line = ch;
      chCount = w;
    } else {
      line += ch;
      chCount += w;
    }
    if (ch === "\n") {
      lines.push(line);
      line = "";
      chCount = 0;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildSvg(props: Required<Pick<Props, "title" | "headline">> & {
  subtitle?: string;
  verdict?: string;
  verdictColor: string;
  sections: ShareSection[];
  footer: string;
}): string {
  const { title, subtitle, verdict, verdictColor, headline, sections, footer } = props;
  const lineHeightHeadline = 60;
  const headlineLines = wrapText(headline, 22).slice(0, 4);

  let y = PADDING + 60; // 顶部预留品牌条
  const out: string[] = [];

  out.push(
    `<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="#0a0a0c" />`,
  );
  // 顶部品牌条
  out.push(
    `<rect x="0" y="0" width="${CARD_W}" height="48" fill="${verdictColor}" opacity="0.18" />`,
  );
  out.push(
    `<text x="${PADDING}" y="32" fill="${verdictColor}" font-size="20" font-weight="700" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">⚡ fupan-box · AI 复盘助手</text>`,
  );

  // 主标题
  y += 20;
  out.push(
    `<text x="${PADDING}" y="${y}" fill="#ffffff" font-size="36" font-weight="800" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(title)}</text>`,
  );
  y += 40;
  if (subtitle) {
    out.push(
      `<text x="${PADDING}" y="${y}" fill="#9ca3af" font-size="20" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(subtitle)}</text>`,
    );
    y += 30;
  }

  // verdict 徽章
  if (verdict) {
    const padX = 18;
    const badgeH = 44;
    const labelW = verdict.length * 22 + padX * 2;
    y += 24;
    out.push(
      `<rect x="${PADDING}" y="${y}" rx="6" ry="6" width="${labelW}" height="${badgeH}" fill="${verdictColor}" />`,
    );
    out.push(
      `<text x="${PADDING + padX}" y="${y + 31}" fill="#ffffff" font-size="22" font-weight="800" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(verdict)}</text>`,
    );
    y += badgeH;
  }

  // 主 headline
  y += 36;
  for (const line of headlineLines) {
    out.push(
      `<text x="${PADDING}" y="${y}" fill="#ffffff" font-size="40" font-weight="700" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(line)}</text>`,
    );
    y += lineHeightHeadline;
  }

  // 分隔线
  y += 16;
  out.push(
    `<line x1="${PADDING}" y1="${y}" x2="${CARD_W - PADDING}" y2="${y}" stroke="#1f2937" stroke-width="1" />`,
  );
  y += 32;

  // 各 section
  const sectionLineH = 32;
  for (const sec of sections.slice(0, 6)) {
    out.push(
      `<text x="${PADDING}" y="${y}" fill="${verdictColor}" font-size="20" font-weight="800" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(sec.label)}</text>`,
    );
    y += 28;
    const wrapped = wrapText(sec.text, 30).slice(0, 3);
    for (const w of wrapped) {
      out.push(
        `<text x="${PADDING}" y="${y}" fill="#e5e7eb" font-size="22" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(w)}</text>`,
      );
      y += sectionLineH;
    }
    y += 18;
    if (y > CARD_H - 120) break;
  }

  // 底部 footer
  out.push(
    `<rect x="0" y="${CARD_H - 64}" width="${CARD_W}" height="64" fill="#111827" />`,
  );
  out.push(
    `<text x="${PADDING}" y="${CARD_H - 24}" fill="#9ca3af" font-size="18" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(footer)}</text>`,
  );
  out.push(
    `<text x="${CARD_W - PADDING}" y="${CARD_H - 24}" fill="#6b7280" font-size="16" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" text-anchor="end">${escapeXml(new Date().toISOString().slice(0, 10))} · 仅供参考, 非投资建议</text>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
${out.join("\n")}
</svg>`;
}

function buildPlainText(props: {
  title: string;
  subtitle?: string;
  verdict?: string;
  headline: string;
  sections: ShareSection[];
  footer: string;
}): string {
  const lines: string[] = [];
  lines.push(`【${props.title}】`);
  if (props.verdict) lines.push(`▶ ${props.verdict}`);
  lines.push(props.headline);
  lines.push("");
  for (const s of props.sections) {
    lines.push(`· ${s.label}: ${s.text}`);
  }
  lines.push("");
  if (props.subtitle) lines.push(props.subtitle);
  lines.push(`— ${props.footer}`);
  lines.push("仅供参考, 非投资建议");
  return lines.join("\n");
}

async function svgToPngBlob(svgText: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error("Canvas 2D context not available"));
      }
      ctx.drawImage(img, 0, 0, CARD_W, CARD_H);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("toBlob failed"));
      }, "image/png");
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function ShareCardButton({
  title,
  subtitle,
  verdict,
  verdictColor = "#a855f7",
  headline,
  sections = [],
  footer = "fupan-box · AI 复盘助手",
  variant = "chip",
  buttonLabel = "分享",
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"png" | "svg" | "text" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const svg = useMemo(
    () => buildSvg({ title, subtitle, verdict, verdictColor, headline, sections, footer }),
    [title, subtitle, verdict, verdictColor, headline, sections, footer],
  );
  const plain = useMemo(
    () => buildPlainText({ title, subtitle, verdict, headline, sections, footer }),
    [title, subtitle, verdict, headline, sections, footer],
  );
  const safeFilename = title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 40);

  const handleCopy = async () => {
    setBusy("text");
    setError(null);
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(`复制失败: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadSvg = () => {
    setBusy("svg");
    try {
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, `${safeFilename}.svg`);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPng = async () => {
    setBusy("png");
    setError(null);
    try {
      const blob = await svgToPngBlob(svg);
      downloadBlob(blob, `${safeFilename}.png`);
    } catch (e) {
      setError(`PNG 转换失败 (浏览器限制?): ${(e as Error).message} . 请改用「下载 SVG」或截图.`);
    } finally {
      setBusy(null);
    }
  };

  const triggerStyles: Record<NonNullable<Props["variant"]>, React.CSSProperties> = {
    chip: {
      padding: "1px 6px",
      background: "var(--bg-tertiary)",
      color: "var(--text-muted)",
      border: "1px solid var(--border-color)",
      borderRadius: 3,
      fontSize: 10,
    },
    icon: {
      padding: 6,
      background: "transparent",
      color: "var(--text-muted)",
      border: "none",
      borderRadius: 4,
      fontSize: 11,
    },
    inline: {
      padding: "4px 10px",
      background: verdictColor,
      color: "#fff",
      border: "none",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
    },
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 transition-opacity hover:opacity-80"
        style={triggerStyles[variant]}
        title="生成可分享卡片 (复制文字 / 下载 PNG / 下载 SVG)"
      >
        <Share2 size={variant === "inline" ? 11 : 10} />
        {variant === "icon" ? null : buttonLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-lg overflow-hidden flex flex-col"
            style={{
              width: 460,
              maxWidth: "92vw",
              maxHeight: "92vh",
              background: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{
                background: "var(--bg-secondary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              <div className="flex items-center gap-2">
                <Share2 size={14} style={{ color: verdictColor }} />
                <span className="font-bold" style={{ color: "var(--text-primary)", fontSize: 13 }}>
                  分享卡片预览
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {CARD_W}×{CARD_H} · 适配朋友圈 / 微信群
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={14} />
              </button>
            </div>

            <div
              className="overflow-y-auto p-3 flex-1"
              style={{ background: "var(--bg-tertiary)" }}
            >
              <div
                className="rounded mx-auto"
                style={{
                  width: "100%",
                  aspectRatio: `${CARD_W} / ${CARD_H}`,
                  maxWidth: 360,
                  background: "#0a0a0c",
                  overflow: "hidden",
                  border: "1px solid var(--border-color)",
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>

            {error && (
              <div
                className="px-3 py-2 text-xs"
                style={{
                  background: "rgba(239,68,68,0.10)",
                  borderTop: "1px solid rgba(239,68,68,0.4)",
                  color: "var(--accent-red)",
                }}
              >
                {error}
              </div>
            )}

            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{
                background: "var(--bg-secondary)",
                borderTop: "1px solid var(--border-color)",
              }}
            >
              <button
                onClick={handleCopy}
                disabled={busy === "text"}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded transition-opacity hover:opacity-80"
                style={{
                  background: copied ? "var(--accent-green)" : "var(--bg-tertiary)",
                  color: copied ? "#fff" : "var(--text-secondary)",
                  border: "1px solid var(--border-color)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
                {copied ? "已复制摘要" : "复制摘要文本"}
              </button>
              <button
                onClick={handleDownloadPng}
                disabled={busy === "png"}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded transition-opacity hover:opacity-80"
                style={{
                  background: verdictColor,
                  color: "#fff",
                  border: "none",
                  fontSize: 11,
                  fontWeight: 700,
                }}
                title="生成 PNG 后下载, 直接发朋友圈"
              >
                <ImageIcon size={12} />
                {busy === "png" ? "生成中..." : "下载 PNG"}
              </button>
              <button
                onClick={handleDownloadSvg}
                disabled={busy === "svg"}
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded transition-opacity hover:opacity-80"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-color)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
                title="原矢量, 适合再编辑"
              >
                <Download size={12} />
                SVG
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
