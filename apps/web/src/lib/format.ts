import { formatOdds, type OddsFormat, type PlaySummary } from "@flow/core";

export const fmtOdds = (odds: number, f: OddsFormat) => formatOdds(odds, f);
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function fmtNum(p: Pick<PlaySummary, "kind" | "stat">, v: number): string {
  if (p.kind === "spread") return (v > 0 ? "+" : "") + v.toFixed(1);
  if (p.stat === "anytimeTd") return v.toFixed(2);
  return (Math.round(v * 10) / 10).toString();
}

export function fmtValue(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : "–"}${Math.abs(v).toFixed(1)}%`;
}

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
export const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseIso = parse;
export const fmtDay = (iso: string) =>
  parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function fmtTime(isoInstant: string, tz: string): string {
  return new Date(isoInstant).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

export function tzAbbr(tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

export function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "Points over 26.5", "Moneyline", "Spread -4.5", "Total over 228.5" */
export function marketShort(p: PlaySummary): string {
  if (p.kind === "moneyline") return "Moneyline";
  if (p.kind === "spread") return `Spread ${p.line != null && p.line > 0 ? "+" : ""}${p.line}`;
  if (p.kind === "total") return `Total ${p.side.toLowerCase()} ${p.line}`;
  if (p.stat === "anytimeTd") return "Anytime touchdown";
  if (p.stat === "goals" && p.line === 0.5) return "Anytime goal";
  return `${p.statLabel} ${p.side.toLowerCase()} ${p.line}`;
}

export function hit(p: Pick<PlaySummary, "kind" | "line" | "side">, v: number): boolean {
  const line = compareLine(p);
  return p.side === "Under" ? v < line : v > line;
}

/** The number each game's value is judged against (spreads compare margin with the points). */
export function compareLine(p: Pick<PlaySummary, "kind" | "line">): number {
  if (p.kind === "moneyline") return 0.5;
  if (p.kind === "spread") return -(p.line ?? 0);
  return p.line ?? 0;
}

/** "+$12.10", "–$10.00" */
export function fmtMoney(x: number): string {
  return `${x >= 0 ? "+" : "–"}$${Math.abs(x).toFixed(2)}`;
}

/** 0.583 → "58%" */
export const pct0 = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/** ROI 0.3 → "+30%" */
export const signedPct = (x: number | null) =>
  x == null ? "—" : `${x >= 0 ? "+" : "–"}${Math.abs(Math.round(x * 100))}%`;
