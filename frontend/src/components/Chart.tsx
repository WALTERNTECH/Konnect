import { useState } from "react";

// Small, dependency-free charts in the brand colours.

export function BarChart({ data, format = (n) => String(n), height = 220 }: { data: { label: string; value: number }[]; format?: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640;
  const pad = { l: 8, r: 8, t: 24, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (w - pad.l - pad.r) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="chart" role="img" aria-label="Chart" preserveAspectRatio="none" style={{ height }}>
      <line x1={pad.l} x2={w - pad.r} y1={height - pad.b} y2={height - pad.b} className="axis" />
      {data.map((d, i) => {
        const h = ((height - pad.t - pad.b) * d.value) / max;
        const x = pad.l + i * bw + bw * 0.18;
        const y = height - pad.b - h;
        return (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={pad.l + i * bw} y={pad.t} width={bw} height={height - pad.t - pad.b} fill="transparent" />
            <rect x={x} y={y} width={bw * 0.64} height={Math.max(h, d.value ? 2 : 0)} rx={4} className={`bar ${i === data.length - 1 || hover === i ? "hi" : ""}`} />
            <text x={x + bw * 0.32} y={height - 8} textAnchor="middle">
              {d.label}
            </text>
            {(hover === i || (hover === null && i === data.length - 1)) && d.value > 0 && (
              <text x={x + bw * 0.32} y={Math.max(14, y - 8)} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 600 }}>
                {format(d.value)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function AreaChart({ data, height = 180, format = (n) => String(n) }: { data: { label: string; value: number }[]; height?: number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640;
  const pad = { l: 4, r: 4, t: 18, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => height - pad.b - ((height - pad.t - pad.b) * v) / max;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${height - pad.b} L${x(0)},${height - pad.b} Z`;
  const h = hover ?? data.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="chart" style={{ height }} preserveAspectRatio="none" onMouseLeave={() => setHover(null)} role="img" aria-label="Trend">
      <path d={area} className="area" />
      <path d={line} className="line" vectorEffect="non-scaling-stroke" />
      <line x1={pad.l} x2={w - pad.r} y1={height - pad.b} y2={height - pad.b} className="axis" />
      {data.map((d, i) => (
        <rect key={d.label} x={x(i) - w / data.length / 2} y={0} width={w / data.length} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
      ))}
      {data[h] && (
        <>
          <circle cx={x(h)} cy={y(data[h].value)} r={4} fill="var(--accent)" />
          <text x={Math.min(w - 40, Math.max(40, x(h)))} y={12} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 600 }}>
            {format(data[h].value)} · {data[h].label}
          </text>
        </>
      )}
    </svg>
  );
}
