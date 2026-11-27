import type { Board, BoardGame, OddsFormat, PlaySummary } from "@flow/core";
import { fmtNum, fmtOdds, fmtTime, fmtValue, marketShort } from "../lib/format";
import type { FilterState } from "./Filters";
import { FormTape, rowNote } from "./FormTape";
import { TeamLogo, TeamPair } from "./TeamLogo";

export function filterPlays(board: Board, f: FilterState, past: boolean): PlaySummary[] {
  const start = new Map(board.games.map((g) => [g.id, g.startTime]));
  const league = new Map(board.games.map((g) => [g.id, g.league]));
  let r = board.plays.filter((p) => past || !p.dismissed);
  if (f.league !== "All") r = r.filter((p) => (league.get(p.gameId) ?? p.league) === f.league);
  if (f.game !== "all") r = r.filter((p) => p.gameId === f.game);
  if (f.market !== "all") r = r.filter((p) => p.kind === f.market);
  if (f.lines !== "all") r = r.filter((p) => p.lineSource === f.lines);
  r = r.filter((p) => (p.signal ?? 0) >= f.minSig);
  if (!f.watch) r = r.filter((p) => !p.watch.length);
  if (f.savedOnly) r = r.filter((p) => p.saved);
  const sig = (p: PlaySummary) => p.signal ?? -1;
  if (f.sort === "signal") r.sort((a, b) => sig(b) - sig(a));
  if (f.sort === "value") r.sort((a, b) => (b.value ?? -99) - (a.value ?? -99));
  if (f.sort === "time")
    r.sort((a, b) => (start.get(a.gameId) ?? "").localeCompare(start.get(b.gameId) ?? "") || sig(b) - sig(a));
  // plays with solid evidence rank above Watch plays within the chosen sort
  return r.sort((a, b) => Number(a.watch.length > 0) - Number(b.watch.length > 0));
}

export function resultText(p: PlaySummary): string {
  const r = p.result!;
  if (r.push) return r.value == null ? "Didn't play, usually voided" : "Push";
  const v = r.value ?? 0;
  if (p.stat === "anytimeTd") return v ? "Scored" : "Didn't score";
  if (p.kind === "moneyline") return `${v > 0 ? "Won" : "Lost"} by ${Math.abs(v)}`;
  if (p.kind === "spread") return `${p.subject} ${v > 0 ? "won" : "lost"} the game by ${Math.abs(v)}`;
  return `Final ${fmtNum(p, v)} ${p.unit}`;
}

function Row({
  p,
  game,
  selected,
  past,
  fmt,
  tz,
  onSelect,
}: {
  p: PlaySummary;
  game: BoardGame | undefined;
  selected: boolean;
  past: boolean;
  fmt: OddsFormat;
  tz: string;
  onSelect: () => void;
}) {
  const team = game && p.team ? (p.team === game.home.code ? game.home : game.away) : undefined;
  const opp = game
    ? p.team
      ? p.team === game.home.code
        ? `vs ${game.away.code}`
        : `at ${game.home.code}`
      : `${game.away.code} @ ${game.home.code}`
    : p.league;
  const time = game ? fmtTime(game.startTime, tz) : "";
  const price = p.price ? (
    ` · ${fmtOdds(p.price.odds, fmt)}`
  ) : p.lineSource === "estimated" ? (
    <span className="est"> · est. line</span>
  ) : (
    ""
  );
  const who =
    p.kind === "total"
      ? `${game?.away.code ?? ""} @ ${game?.home.code ?? ""}`
      : p.kind === "prop"
        ? p.subject
        : (team?.name ?? p.subject);
  const flags = (
    <>
      {p.watch.length > 0 && (
        <>
          {" · "}
          <span className="flag watch">Watch</span>
        </>
      )}
      {p.saved && (
        <>
          {" · "}
          <span className="flag saved">Saved</span>
        </>
      )}
    </>
  );
  const t = p.tier?.toLowerCase() ?? "mild";
  return (
    <button className="row" aria-current={selected} onClick={onSelect}>
      <span className="who">
        {team ? (
          <TeamLogo team={team} size={34} />
        ) : (
          <TeamPair away={game?.away} home={game?.home} size={24} />
        )}
        <span className="wt">
          <div className="n">{who}</div>
          <div className="m">
            {marketShort(p)}
            {price}
          </div>
          <div className="g">
            {opp} · {time}
            {flags}
          </div>
        </span>
      </span>
      <span className="c-pick">
        {marketShort(p)}
        {price}
        {p.price && !p.isPreferredBook && <span className="bk"> · {p.price.bookTitle}</span>}
      </span>
      <span className="c-game">
        {opp} · {time}
        {flags}
      </span>
      <span className="tapebox">
        {past && p.result ? (
          <span className={`res ${p.result.push ? "" : p.result.won ? "won" : "lost"}`}>
            <b>{p.result.push ? "Void" : p.result.won ? "Won" : "Lost"}</b>
            <small>{resultText(p)}</small>
          </span>
        ) : (
          <>
            <FormTape p={p} />
            {rowNote(p)}
          </>
        )}
      </span>
      <span className={`sig ${t}`} title={p.tier ?? ""}>
        {p.signal ?? "—"}
      </span>
      <span className={`val ${p.value == null ? "na" : p.value >= 0 ? "pos" : "neg"}`}>
        {fmtValue(p.value)}
      </span>
    </button>
  );
}

export function PlayList({
  board,
  plays,
  f,
  sel,
  past,
  fmt,
  tz,
  onSelect,
  emptyHint,
}: {
  board: Board;
  plays: PlaySummary[];
  f: FilterState;
  sel: string | null;
  past: boolean;
  fmt: OddsFormat;
  tz: string;
  onSelect: (id: string) => void;
  emptyHint: React.ReactNode;
}) {
  const g = f.game !== "all" ? board.games.find((x) => x.id === f.game) : undefined;
  const games = new Map(board.games.map((x) => [x.id, x]));
  return (
    <>
      <div className="listhead">
        <h2>
          {plays.length} {plays.length === 1 ? "play" : "plays"}
          {g ? ` · ${g.away.code} @ ${g.home.code}` : ""}
        </h2>
        <span className="lh-x">Pick</span>
        <span className="lh-x">Game</span>
        <span>{past ? "Result" : "Last 10"}</span>
        <span>Signal</span>
        <span>Value</span>
      </div>
      <div>
        {plays.length ? (
          plays.map((p) => (
            <Row
              key={p.id}
              p={p}
              game={games.get(p.gameId)}
              selected={sel === p.id}
              past={past}
              fmt={fmt}
              tz={tz}
              onSelect={() => onSelect(p.id)}
            />
          ))
        ) : (
          <div className="empty">{emptyHint}</div>
        )}
      </div>
      {board.leftOff.length > 0 && (
        <details className="supp">
          <summary>
            {board.leftOff.length} {board.leftOff.length === 1 ? "market" : "markets"} left off the board
          </summary>
          <ul>
            {board.leftOff.map((l, i) => (
              <li key={i}>
                <b>{l.market}.</b> {l.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
