/**
 * 通用 5 日 sparkline (面积图 + 折线 + 末点圆).
 * 替代 LhbEvidenceGrid / LadderEvidenceGrid / SentimentEvidenceGrid 中
 * 完全一致的本地实现.
 */

const W = 140;
const H = 36;
const PAD = 4;

export function Sparkline({
  values,
  color,
  highlight,
}: {
  values: number[];
  color: string;
  highlight: boolean;
}) {
  if (values.length === 0) {
    return (
      <div
        style={{
          width: W,
          height: H,
          background: "var(--bg-secondary)",
          borderRadius: 3,
        }}
      />
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (W - PAD * 2) / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(" L ")}`;
  const lastX = PAD + (values.length - 1) * stepX;
  const areaPath = `${path} L ${lastX.toFixed(1)},${H - PAD} L ${PAD},${H - PAD} Z`;
  const lastV = values[values.length - 1];
  const lastY = H - PAD - ((lastV - min) / range) * (H - PAD * 2);

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <path d={areaPath} fill={color} fillOpacity={highlight ? 0.25 : 0.12} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={highlight ? 2 : 1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={highlight ? 3 : 2}
        fill={color}
        stroke="var(--bg-card)"
        strokeWidth={1}
      />
    </svg>
  );
}
