import { normName } from "@flow/data";

export function playId(p: {
  date: string;
  kind: string;
  subject: string;
  stat?: string | null;
  side: string;
}) {
  return [p.date, p.kind, normName(p.subject).replace(/ /g, "-"), p.stat ?? "", normName(p.side)]
    .filter(Boolean)
    .join(":");
}

export const MANUAL_BOOK = "betway";
