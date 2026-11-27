import type { PlaySummary } from "@flow/core";
import { compareLine, fmtNum, hit } from "../lib/format";

/** The row's signature: one bar per game, cyan when it cleared the line. */
export function FormTape({ p }: { p: PlaySummary }) {
  const played = p.log.map((g) => g.value).filter((v): v is number => v != null);
  const line = compareLine(p);
  const max = Math.max(...played.map(Math.abs), Math.abs(line), 1);
  const min = Math.min(...played, 0);
  const cleared = played.filter((v) => hit(p, v)).length;
  return (
    <span className="tape" aria-label={`Last ${played.length} games: ${cleared} cleared the line`}>
      {p.log.map((g, i) => {
        if (g.value == null) return <i key={i} className="dnp" title="Did not play" />;
        const h =
          p.kind === "spread"
            ? 6 + Math.max(0, (g.value - min) / (max * 2)) * 18
            : Math.max(4, (Math.abs(g.value) / max) * 24);
        return (
          <i
            key={i}
            className={hit(p, g.value) ? "hit" : ""}
            style={{ height: `${h.toFixed(0)}px` }}
            title={`${g.date}${g.opponent ? ` vs ${g.opponent}` : ""}: ${fmtNum(p, g.value)}`}
          />
        );
      })}
    </span>
  );
}

export function rowNote(p: PlaySummary) {
  if (p.streak >= 3) return <small className="hot">{p.streak} straight</small>;
  const w5 = p.windows.find((w) => w.n === 5);
  if (w5) return <small>{w5.hits} of last 5</small>;
  const played = p.log.filter((g) => g.value != null);
  return (
    <small>
      {played.filter((g) => hit(p, g.value!)).length} of last {played.length}
    </small>
  );
}
