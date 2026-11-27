import { normName } from "@flow/data";

/** Includes the league, since team codes repeat across leagues (DAL, MIN, UTAH, BOS...). */
export function playId(p: {
  date: string;
  league: string;
  kind: string;
  subject: string;
  stat?: string | null;
  side: string;
}) {
  return [
    p.date,
    p.league.toLowerCase(),
    p.kind,
    normName(p.subject).replace(/ /g, "-"),
    p.stat ?? "",
    normName(p.side),
  ]
    .filter(Boolean)
    .join(":");
}

export const MANUAL_BOOK = "betway";
