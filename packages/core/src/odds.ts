import type { OddsFormat } from "./types.js";

/** Break-even probability implied by American odds (vig included). */
export function impliedFromAmerican(odds: number): number {
  assertAmerican(odds);
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

export function americanToDecimal(odds: number): number {
  assertAmerican(odds);
  return odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
}

export function decimalToAmerican(decimal: number): number {
  if (!(decimal > 1)) throw new RangeError(`Decimal odds must be above 1, got ${decimal}`);
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Profit on a 1-unit stake if the bet wins. */
export function payoutPerUnit(odds: number): number {
  return americanToDecimal(odds) - 1;
}

export function formatOdds(odds: number, format: OddsFormat = "american"): string {
  if (format === "decimal") return americanToDecimal(odds).toFixed(2);
  return odds > 0 ? `+${odds}` : String(odds);
}

/** Parse what a person types: "-115", "+105", "105", "1.87". */
export function parseOdds(input: string): number | null {
  const s = input.trim().replace(/\s+/g, "");
  if (!s) return null;
  if (/^[+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Math.abs(n) < 100) return null;
    return n;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = Number(s);
    return d > 1 ? decimalToAmerican(d) : null;
  }
  return null;
}

function assertAmerican(odds: number) {
  if (!Number.isFinite(odds) || (odds > -100 && odds < 100)) {
    throw new RangeError(`American odds must be <= -100 or >= +100, got ${odds}`);
  }
}
