/** Normalize a person or team name for matching across sources. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (x === y) return true;
  // "J. Tatum" vs "Jayson Tatum"
  const [xf, ...xl] = x.split(" ");
  const [yf, ...yl] = y.split(" ");
  if (xl.join(" ") && xl.join(" ") === yl.join(" ") && xf && yf && (xf[0] === yf[0])) {
    return xf.length === 1 || yf.length === 1;
  }
  return false;
}

export function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  return items.find((p) => normName(p.name) === normName(name)) ?? items.find((p) => sameName(p.name, name));
}
