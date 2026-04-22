"use client";

import React from "react";

/**
 * SkillTagText - 识别并美化 AI 输出里的【XX视角】或【中立视角】标签
 *
 * 模式：在文本最前面 / 段首 / 内联出现 `【XX视角】`（XX 任意 1-12 个字符）时，
 * 把它渲染成一个紫色高亮 chip；其它内容按原样输出。
 *
 * 设计原则：
 * - 不破坏原有 whitespace-pre-wrap 排版；用 inline-flex 的 chip 内嵌
 * - 兼容流式输出（标签可能在中途出现）
 * - 不识别其它 AI 习惯的【】内容（如「【关键证据】」），仅匹配以「视角」结尾的两字短语
 */

const TAG_REGEX = /【([^【】]{1,12}视角)】/g;

export function SkillTagText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!text) {
    return null;
  }
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(text)) !== null) {
    const idx = match.index;
    if (idx > lastIdx) {
      parts.push(text.slice(lastIdx, idx));
    }
    parts.push(
      <span
        key={`${idx}-${match[1]}`}
        className="inline-flex items-center align-baseline"
        style={{
          padding: "1px 6px",
          margin: "0 2px",
          borderRadius: 4,
          background: "rgba(139,92,246,0.16)",
          color: "var(--accent-purple)",
          border: "1px solid rgba(139,92,246,0.32)",
          fontSize: "0.85em",
          fontWeight: 700,
          lineHeight: 1.2,
        }}
        title="本段是按当前激活体系视角生成的"
      >
        {match[1]}
      </span>,
    );
    lastIdx = idx + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return (
    <span className={className} style={style}>
      {parts}
    </span>
  );
}
