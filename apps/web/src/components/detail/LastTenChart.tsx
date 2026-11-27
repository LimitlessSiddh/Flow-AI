import type { PlayDetail } from "@flow/core";
import { compareLine, fmtNum, hit } from "../../lib/format";

function niceStep(r: number) {
  const p = Math.pow(10, Math.floor(Math.log10(r || 1)));
  const n = r / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export function LastTenChart({ p }: { p: PlayDetail }) {
  const W = 520,
    H = 170,
    pl = 34,
    pr = 10,
    pt = 14,
    pb = 26;
  const vals = p.log.map((g) => g.value);
  const played = vals.filter((v): v is number => v != null);
  const line = compareLine(p);
  const season = p.seasonAvg ?? line;
  const binary = p.kind === "moneyline" || p.stat === "anytimeTd";
  let lo = Math.min(0, ...played, line);
  let hi = Math.max(...played, line, season, 1);
  hi = hi + (hi - lo) * 0.12;
  if (p.kind === "spread") {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -m;
    hi = m;
  }
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const bw = (W - pl - pr) / Math.max(vals.length, 1);
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  if (binary) ticks.push(0, 1);
  else for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(+t.toFixed(4));
  if (!vals.length) return <p className="exp">No games logged yet.</p>;
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Each of the last ${vals.length} games against the line of ${p.line ?? line}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={pl - 6} y={y(t) + 4} textAnchor="end">
            {Math.round(t * 10) / 10}
          </text>
        </g>
      ))}
      {p.log.map((g, i) => {
        const x = pl + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const label = i === vals.length - 1 ? "Last" : (g.opponent ?? `G${i + 1}`);
        if (g.value == null)
          return (
            <g key={i}>
              <rect
                x={x}
                y={y(0) - 6}
                width={w}
                height={6}
                fill="none"
                stroke="var(--line-2)"
                strokeDasharray="3 2"
              />
              <text x={x + w / 2} y={H - 8} textAnchor="middle">
                DNP
              </text>
            </g>
          );
        const top = Math.min(y(g.value), y(0));
        const h = Math.max(1.5, Math.abs(y(g.value) - y(0)));
        return (
          <g key={i}>
            <rect
              x={x}
              y={top}
              width={w}
              height={h}
              rx={2}
              fill={hit(p, g.value) ? "var(--accent)" : "var(--miss)"}
            >
              <title>{`${g.date}${g.opponent ? ` vs ${g.opponent}` : ""}: ${fmtNum(p, g.value)}`}</title>
            </rect>
            <text x={x + w / 2} y={H - 8} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
      {!binary && (
        <line
          x1={pl}
          x2={W - pr}
          y1={y(season)}
          y2={y(season)}
          stroke="var(--muted)"
          strokeWidth={1.2}
          strokeDasharray="2 3"
        />
      )}
      <line x1={pl} x2={W - pr} y1={y(line)} y2={y(line)} stroke="var(--rule)" strokeWidth={1.6} />
    </svg>
  );
}
