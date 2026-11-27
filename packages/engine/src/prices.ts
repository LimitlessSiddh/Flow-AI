import { impliedFromAmerican } from "@flow/core";
import type { PriceRow } from "@flow/db";
import { MANUAL_BOOK } from "./ids.js";

/** The price Flow uses: your Betway price if you entered one, then your books in order, then anything else. */
export function pickPrice(prices: PriceRow[], bookOrder: string[]): PriceRow | null {
  if (!prices.length) return null;
  const rank = (p: PriceRow) => {
    if (p.book === MANUAL_BOOK) return -1;
    const i = bookOrder.indexOf(p.book);
    return i >= 0 ? i : 100;
  };
  return [...prices].sort(
    (a, b) => rank(a) - rank(b) || impliedFromAmerican(a.odds) - impliedFromAmerican(b.odds),
  )[0]!;
}

export function minutesOld(iso: string, now = new Date()): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 60000);
}
