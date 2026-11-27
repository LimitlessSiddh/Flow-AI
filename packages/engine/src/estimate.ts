import { estimateLine, LINE_RULES, mean, MIN_ROLE_MINUTES, type League } from "@flow/core";
import { mapLimit, normName, type Game, type Player, type PlayerGame, type StatKey } from "@flow/data";
import type { Market } from "./analyze.js";

/** NFL props worth rating by position. Other positions (OL, defence, kickers) have no props. */
const NFL_STATS: Record<string, StatKey[]> = {
  QB: ["passYds", "rushYds", "anytimeTd"],
  RB: ["rushYds", "recYds", "receptions", "anytimeTd"],
  WR: ["recYds", "receptions", "anytimeTd"],
  TE: ["recYds", "receptions", "anytimeTd"],
};

export interface EstimateSource {
  roster(lg: League, team: Game["home"]): Promise<Player[]>;
  log(lg: League, p: Player): Promise<PlayerGame[]>;
}

export interface EstimatedGroup {
  m: Market;
  quotes: [];
}

/**
 * Props for every player in the given games, each at a line Flow estimates from the player's own numbers.
 * Skips any player and stat that already has a real price (`priced` holds "gameId|player|stat" keys).
 * Each entry is a group of sides (Over and Under, or Over only for yes/no props), like groupMarkets returns.
 */
export async function estimatedMarkets(
  src: EstimateSource,
  games: Game[],
  date: string,
  priced: Set<string>,
): Promise<EstimatedGroup[][]> {
  const jobs: { game: Game; player: Player }[] = [];
  for (const game of games) {
    const lg = game.league as League;
    const [h, a] = await Promise.all([src.roster(lg, game.home), src.roster(lg, game.away)]);
    for (const player of [...h, ...a]) {
      if (lg === "NFL" && !NFL_STATS[player.position ?? ""]) continue;
      jobs.push({ game, player });
    }
  }
  const out: EstimatedGroup[][] = [];
  await mapLimit(jobs, 6, async ({ game, player }) => {
    const lg = game.league as League;
    let log: PlayerGame[];
    try {
      log = await src.log(lg, player);
    } catch {
      return;
    }
    const minRole = MIN_ROLE_MINUTES[lg];
    if (minRole != null) {
      const mins = log
        .slice(-10)
        .map((g) => g.minutes)
        .filter((x): x is number => x != null);
      if (mins.length < 5 || mean(mins) < minRole) return;
    }
    const stats =
      lg === "NFL" ? NFL_STATS[player.position ?? ""]! : (Object.keys(LINE_RULES[lg]) as StatKey[]);
    for (const stat of stats) {
      if (priced.has(pricedKey(game.id, player.name, stat))) continue;
      const rule = LINE_RULES[lg][stat];
      if (!rule) continue;
      const values = log.map((g) => g.stats[stat]).filter((v): v is number => v != null);
      const line = estimateLine(values, rule);
      if (line == null) continue;
      const sides = rule.fixed != null ? ["Over"] : ["Over", "Under"];
      out.push(
        sides.map((side) => ({
          m: {
            date,
            game,
            kind: "prop" as const,
            subject: player.name,
            team: player.team,
            stat,
            side,
            line,
            estimated: true,
          },
          quotes: [],
        })),
      );
    }
  });
  return out;
}

export const pricedKey = (gameId: string, player: string, stat: string) =>
  `${gameId}|${normName(player)}|${stat}`;
