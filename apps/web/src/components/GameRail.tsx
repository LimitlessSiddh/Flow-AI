import type { Board, BoardGame } from "@flow/core";
import { fmtTime, tzAbbr } from "../lib/format";
import { TeamLogo } from "./TeamLogo";

export function GameRail({
  board,
  league,
  game,
  past,
  tz,
  onGame,
}: {
  board: Board;
  league: string;
  game: string;
  past: boolean;
  tz: string;
  onGame: (id: string) => void;
}) {
  const games = board.games.filter((g) => league === "All" || g.league === league);
  if (!board.games.length) return null;
  const plays = (g: BoardGame) => board.plays.filter((p) => p.gameId === g.id && !p.dismissed);
  return (
    <div className="wrap">
      <nav className="rail" aria-label="Games">
        <button className="game all" aria-pressed={game === "all"} onClick={() => onGame("all")}>
          <span className="g-top">
            <span>{league === "All" ? "All leagues" : league}</span>
          </span>
          <span className="g-teams">All games</span>
          <span className="g-n">
            {games.length} game{games.length === 1 ? "" : "s"}
          </span>
        </button>
        {games.map((g) => {
          const ps = plays(g);
          const settled = ps.filter((p) => p.result && !p.result.push);
          const won = settled.filter((p) => p.result!.won).length;
          const final = g.status === "final";
          return (
            <button key={g.id} className="game" aria-pressed={game === g.id} onClick={() => onGame(g.id)}>
              <span className="g-top">
                <span>{g.league}</span>
                <span>
                  {final
                    ? `Final ${g.awayScore ?? ""}–${g.homeScore ?? ""}`
                    : g.status === "live"
                      ? "Live"
                      : `${fmtTime(g.startTime, tz)} ${tzAbbr(tz)}`}
                </span>
              </span>
              <span className="g-teams">
                <TeamLogo team={g.away} size={22} />
                {g.away.code}
                <span className="at">@</span>
                <TeamLogo team={g.home} size={22} />
                {g.home.code}
              </span>
              <span className="g-n">
                {!ps.length ? (
                  "No plays"
                ) : past && settled.length ? (
                  <>
                    <span className="rw">
                      {won}–{settled.length - won}
                    </span>{" "}
                    on {ps.length} {ps.length > 1 ? "plays" : "play"}
                  </>
                ) : (
                  <>
                    <b>{ps.length}</b> {ps.length > 1 ? "plays" : "play"}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
