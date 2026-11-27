export * from "./types.js";
export * from "./http.js";
export * from "./names.js";
export { EspnSource, parseEspnGamelog } from "./espn/espn.js";
export { NhlSource, parseNhlGameLog, toiMinutes } from "./nhl/nhl.js";
export * from "./odds/oddsApi.js";

import type { League } from "@flow/core";
import { EspnSource } from "./espn/espn.js";
import { NhlSource } from "./nhl/nhl.js";
import type { LeagueSource } from "./types.js";

export function leagueSources(tz: string): Record<League, LeagueSource> {
  return { NBA: new EspnSource("NBA", tz), NFL: new EspnSource("NFL", tz), NHL: new NhlSource(tz) };
}
