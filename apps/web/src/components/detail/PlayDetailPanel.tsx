import type { BoardGame, OddsFormat, PlayDetail } from "@flow/core";
import {
  Bookmark,
  BookmarkCheck,
  ChartLine,
  Check,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Eye,
  TrendingDown,
  X,
} from "lucide-react";
import { usePlay, usePlayState } from "../../hooks/queries";
import { ago, fmtDay, fmtNum, fmtOdds, fmtTime, marketShort, tzAbbr } from "../../lib/format";
import { resultText } from "../PlayList";
import { TeamLogo, TeamPair } from "../TeamLogo";
import { LastTenChart } from "./LastTenChart";
import { PriceBox } from "./PriceBox";
import { ScoreCard } from "./ScoreCard";

const POS: Record<string, string> = {
  F: "Forward",
  G: "Guard",
  C: "Center",
  PG: "Point guard",
  SG: "Shooting guard",
  SF: "Small forward",
  PF: "Power forward",
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  L: "Left wing",
  R: "Right wing",
  D: "Defense",
};

export function PlayDetailPanel(props: {
  id: string | null;
  game: (id: string) => BoardGame | undefined;
  past: boolean;
  fmt: OddsFormat;
  tz: string;
  preferredBook: string;
  onClose: () => void;
  onDismiss: (id: string) => void;
  toast: (msg: string) => void;
}) {
  const { data: p, isLoading, error } = usePlay(props.id);
  return (
    <aside className={`detail ${props.id ? "" : "closed"}`} aria-label="Play detail">
      {!props.id ? null : isLoading ? (
        <div className="d-in">
          <div className="empty">Loading the evidence…</div>
        </div>
      ) : error || !p ? (
        <div className="d-in">
          <div className="empty">
            <b>Couldn't load this play.</b>
            {error?.message}
          </div>
        </div>
      ) : (
        <Detail {...props} p={p} />
      )}
    </aside>
  );
}

function Detail({
  p,
  game,
  past,
  fmt,
  tz,
  preferredBook,
  onClose,
  onDismiss,
  toast,
}: Parameters<typeof PlayDetailPanel>[0] & { p: PlayDetail }) {
  const g = game(p.gameId);
  const st = usePlayState();
  const team = g && p.team ? (p.team === g.home.code ? g.home : g.away) : undefined;
  const name =
    p.kind === "total"
      ? `${g?.away.code} @ ${g?.home.code}`
      : p.kind === "prop"
        ? p.subject
        : (team?.name ?? p.subject);
  const when = g ? `${fmtTime(g.startTime, tz)} ${tzAbbr(tz)}` : "";
  const sub = [
    p.kind === "prop" ? p.team : null,
    p.position ? (POS[p.position] ?? p.position) : null,
    g ? `${g.away.code} @ ${g.home.code}` : p.league,
    when,
  ]
    .filter(Boolean)
    .join(" · ");
  const winRows = [5, 8, 10].map((n) => {
    const w = p.windows.find((x) => x.n === n);
    if (!w)
      return (
        <tr key={n}>
          <td>Last {n}</td>
          <td className="na" colSpan={3}>
            Not enough games yet
          </td>
        </tr>
      );
    const d = w.avg - (p.seasonAvg ?? 0);
    return (
      <tr key={n}>
        <td>Last {n}</td>
        <td className="lead">{fmtNum(p, w.avg)}</td>
        <td>
          {w.hits} of {n}
        </td>
        <td className={d >= 0 ? "pos" : "neg"}>
          {d >= 0 ? "+" : ""}
          {fmtNum({ kind: "x", stat: p.stat }, d)}
        </td>
      </tr>
    );
  });
  const avail = p.availability;
  const qLabel = ["", "low", "medium", "high"][p.quality] ?? "low";
  const toggle = (k: "saved" | "tracked", msgOn: string, msgOff: string) =>
    st.mutate({ id: p.id, patch: { [k]: !p[k] } }, { onSuccess: () => toast(!p[k] ? msgOn : msgOff) });

  return (
    <div className="d-in">
      <div className="d-head">
        <button className="tb d-back" onClick={onClose}>
          <ChevronLeft className="ico" />
          Board
        </button>
        <button className="tb icon d-close" aria-label="Close details" onClick={onClose}>
          <X className="ico" />
        </button>
        <div className="d-id">
          {team ? <TeamLogo team={team} size={52} /> : <TeamPair away={g?.away} home={g?.home} size={40} />}
          <h2 className="d-name">
            {name}
            <small>{sub}</small>
          </h2>
        </div>
        <div className="d-market">{marketShort(p)}</div>
        <div className="d-line">
          {p.price ? (
            <>
              <span>
                <b>{fmtOdds(p.price.odds, fmt)}</b> at {p.price.bookTitle}
              </span>
              <span>
                {p.price.origin === "manual"
                  ? "Price you entered"
                  : `Price checked ${fmtTime(p.price.retrievedAt, tz)}`}
              </span>
              {!p.isPreferredBook && (
                <span className="nobook">No {preferredBook} price, showing a backup book</span>
              )}
            </>
          ) : (
            <span>No price found yet</span>
          )}
        </div>
        {p.watch.length > 0 && (
          <div className="note watch">
            <Eye className="ico" />
            <span>
              <b>Watch.</b> {p.watch.join(" ")}
            </span>
          </div>
        )}
        {past && p.result && (
          <div className={`resbox ${p.result.push ? "" : p.result.won ? "won" : "lost"}`}>
            <b>{p.result.push ? "Void" : p.result.won ? "Won" : "Lost"}</b>
            <span>
              {resultText(p)}
              {p.line != null ? ` against a line of ${p.line}` : ""} · {fmtDay(p.date)}
            </span>
          </div>
        )}
      </div>

      <ScoreCard p={p} fmt={fmt} />
      <PriceBox p={p} fmt={fmt} preferredBook={preferredBook} disabled={past} />

      {p.read && (
        <div>
          <h3>The read {p.researchedBy && <span className="aside">Researched by {p.researchedBy}</span>}</h3>
          <p className="read">{p.read}</p>
        </div>
      )}
      <div>
        <h3>Last {p.log.length} games</h3>
        <LastTenChart p={p} />
        <div className="legend">
          <span>
            <i style={{ background: "var(--accent)" }} />
            Cleared {p.kind === "moneyline" ? "(won)" : p.line}
          </span>
          <span>
            <i style={{ background: "var(--miss)" }} />
            Fell short
          </span>
          <span>
            <i style={{ background: "var(--rule)", height: 2 }} />
            Line
          </span>
          {p.kind !== "moneyline" && p.stat !== "anytimeTd" && (
            <span>
              <i style={{ background: "var(--muted)", height: 2 }} />
              Season avg {fmtNum(p, p.seasonAvg ?? 0)}
            </span>
          )}
        </div>
      </div>
      {p.kind !== "moneyline" && (
        <div className="tbl-wrap">
          <h3>Recent form vs season</h3>
          <table>
            <thead>
              <tr>
                <th />
                <th>Avg {p.unit}</th>
                <th>Cleared</th>
                <th>vs season</th>
              </tr>
            </thead>
            <tbody>
              {winRows}
              <tr>
                <td>Season</td>
                <td className="lead">{fmtNum(p, p.seasonAvg ?? 0)}</td>
                <td>{p.seasonGames} games</td>
                <td className="na">baseline</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {p.context.length > 0 && (
        <div className="tbl-wrap">
          <h3>Role and context</h3>
          <table>
            <thead>
              <tr>
                <th />
                <th>Last 5</th>
                <th>Season</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {p.context.map((c) => {
                const d = Math.round((c.recent - c.season) * 10) / 10;
                return (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td className="lead">{c.recent}</td>
                    <td>{c.season}</td>
                    <td className={d > 0 ? "pos" : d < 0 ? "neg" : "na"}>
                      {d > 0 ? "+" : ""}
                      {d}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {avail && (
        <div>
          <h3>Availability</h3>
          <div className="note">
            {avail.status === "ok" ? (
              <CircleCheck className="ico ok" />
            ) : (
              <CircleAlert className="ico warn" />
            )}
            <span>{avail.text}</span>
          </div>
        </div>
      )}
      {p.counter && (
        <div className="counter">
          <h3>
            <TrendingDown className="ico" />
            Why it might not hold
          </h3>
          <p>{p.counter}</p>
        </div>
      )}
      <div>
        <h3>
          Sources <span className="aside">Evidence {qLabel}</span>
        </h3>
        <ul className="sources">
          {p.sources.map((s, i) => (
            <li key={i}>
              <span className="pub">{s.publisher}</span>
              <span className="ts">{fmtTime(s.retrievedAt, tz)}</span>
              <span className="what">
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.title}
                </a>
              </span>
              <span className={`cor ${s.corroborated ? "yes" : "no"}`}>
                {s.corroborated ? <CheckCheck className="ico" /> : <Check className="ico" />}
                {s.corroborated ? "Confirmed twice" : "One source"}
              </span>
            </li>
          ))}
          <li>
            <span className="pub">{p.league === "NHL" ? "NHL.com" : "ESPN"}</span>
            <span className="ts">{ago(p.updatedAt)}</span>
            <span className="what">Game logs and box scores</span>
            <span className="cor yes">
              <CheckCheck className="ico" />
              Official stats
            </span>
          </li>
        </ul>
      </div>
      <div className="actions">
        <button
          className="tb"
          aria-pressed={p.saved}
          onClick={() => toggle("saved", "Saved to your list", "Removed from saved")}
        >
          {p.saved ? <BookmarkCheck className="ico" /> : <Bookmark className="ico" />}
          {p.saved ? "Saved" : "Save"}
        </button>
        {!past && (
          <button
            className="tb"
            aria-pressed={p.tracked}
            onClick={() => toggle("tracked", "Flow will grade this after the game", "Stopped tracking")}
          >
            <ChartLine className="ico" />
            {p.tracked ? "Tracking" : "Track result"}
          </button>
        )}
        <button className="tb" onClick={() => onDismiss(p.id)}>
          <X className="ico" />
          Dismiss
        </button>
        <span className="fine">
          Flow doesn't place bets. Tracking records the result so you can see how Flow's picks did.
        </span>
      </div>
    </div>
  );
}
