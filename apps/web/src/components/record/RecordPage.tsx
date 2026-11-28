import {
  addDays,
  type CalibrationBucket,
  type Meta,
  type OddsFormat,
  type PickView,
  type RecordReport,
  type RecordSplit,
  type RecordStats,
  type RecordView,
  STAKE_DOLLARS,
} from "@flow/core";
import { CircleAlert, Download, Eye, Plus } from "lucide-react";
import { useState } from "react";
import { api, type RecordParams } from "../../api/client";
import { useRecord } from "../../hooks/queries";
import { load, save } from "../../lib/store";
import { fmtDay, fmtMoney, fmtOdds, pct0, signedPct } from "../../lib/format";
import { PickDialog } from "./PickDialog";

type Range = "7" | "30" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "all", label: "All time" },
];

/** My Record: how your bets and Flow's plays actually did, and whether Flow's chances are honest. */
export function RecordPage({
  meta,
  fmt,
  toast,
}: {
  meta: Meta;
  fmt: OddsFormat;
  toast: (msg: string) => void;
}) {
  const [opts, setOpts] = useState(() =>
    load<{ view: RecordView; range: Range; league: string | null }>("flow-record", {
      view: "picks",
      range: "all",
      league: null,
    }),
  );
  const set = (p: Partial<typeof opts>) =>
    setOpts((cur) => {
      const next = { ...cur, ...p };
      save("flow-record", next);
      return next;
    });
  const params: RecordParams = {
    view: opts.view,
    league: opts.league,
    from: opts.range === "all" ? null : addDays(meta.today, -(Number(opts.range) - 1)),
  };
  const { data: r, error } = useRecord(params);
  const [dialog, setDialog] = useState<{ pick?: PickView } | null>(null);
  const mine = opts.view === "picks";

  return (
    <main className="wrap record">
      <div className="rec-bar">
        <div className="tabs" role="group" aria-label="Whose record">
          <button aria-pressed={mine} onClick={() => set({ view: "picks" })}>
            Your bets
          </button>
          <button aria-pressed={!mine} onClick={() => set({ view: "all" })}>
            Every Flow play
          </button>
        </div>
        <div className="tabs" role="group" aria-label="Time range">
          {RANGES.map((x) => (
            <button key={x.key} aria-pressed={opts.range === x.key} onClick={() => set({ range: x.key })}>
              {x.label}
            </button>
          ))}
        </div>
        <label className="sel">
          <span>League</span>
          <select value={opts.league ?? ""} onChange={(e) => set({ league: e.target.value || null })}>
            <option value="">All</option>
            {meta.leagues.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <a className="tb" href={api.recordCsvUrl(params)} download>
          <Download className="ico" />
          <span>Spreadsheet</span>
        </a>
        <button className="tb primary" onClick={() => setDialog({})}>
          <Plus className="ico" />
          <span>Log a bet</span>
        </button>
      </div>

      {error && <div className="empty">{error.message}</div>}
      {!r && !error && <div className="empty">Loading your record…</div>}
      {r && <Report r={r} mine={mine} fmt={fmt} onEdit={(pick) => setDialog({ pick })} />}

      {dialog && (
        <PickDialog
          meta={meta}
          pick={dialog.pick}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            toast(msg);
          }}
        />
      )}
    </main>
  );
}

function Report({
  r,
  mine,
  fmt,
  onEdit,
}: {
  r: RecordReport;
  mine: boolean;
  fmt: OddsFormat;
  onEdit: (p: PickView) => void;
}) {
  const s = r.stats;
  const decided = s.won + s.lost;
  const unit = mine ? "bet" : "play";
  return (
    <>
      <SampleNote r={r} mine={mine} />
      <section className="rec-stats" aria-label="Summary">
        <Stat
          label="Record"
          big={`${s.won}–${s.lost}${s.push ? `–${s.push}` : ""}`}
          sub={
            s.pending
              ? `${s.pending} waiting on results`
              : s.push
                ? "wins, losses, pushes"
                : "wins and losses"
          }
        />
        <Stat
          label="Win rate"
          big={pct0(s.winRate)}
          sub={
            s.expectedWinRate != null
              ? `Flow expected ${pct0(s.expectedWinRate)}`
              : "Flow had no chance for these"
          }
        />
        <Stat
          label={`Profit at $${r.stake} a ${unit}`}
          big={s.priced ? fmtMoney(r.profit) : "—"}
          tone={!s.priced ? undefined : r.profit >= 0 ? "pos" : "neg"}
          sub={
            s.priced
              ? `ROI ${signedPct(s.roi)} on ${s.priced} with a price`
              : decided
                ? "Add your prices to see profit"
                : "No results yet"
          }
        />
        <Stat
          label="Beat the closing price"
          big={s.clv.n ? `${s.clv.beat} of ${s.clv.n}` : "—"}
          tone={s.clv.n ? (s.clv.beat * 2 >= s.clv.n ? "pos" : "neg") : undefined}
          sub={
            s.clv.n
              ? `Average ${s.clv.avg! >= 0 ? "+" : "–"}${Math.abs(s.clv.avg!).toFixed(1)} pts of chance`
              : "Saved when the app is open before games start"
          }
        />
      </section>

      <div className="rec-pair">
        <section className="rec-panel">
          <h3>Are Flow's chances honest?</h3>
          <p className="exp">The bar is how often plays hit. The tick is the chance Flow gave them.</p>
          <Calibration buckets={r.calibration.buckets} />
        </section>
        <section className="rec-panel">
          <ProfitByDay days={r.byDay} total={r.profit} unit={unit} />
        </section>
      </div>
      {!mine && <Tuning r={r} />}

      <section className="rec-panel">
        <h3>Where Flow wins</h3>
        <p className="exp">
          The same {unit}s, split four ways. Profit is at ${r.stake} a {unit}.
        </p>
        <div className="rec-splits">
          <SplitBlock title="Bet type" rows={r.byKind} />
          <SplitBlock title="Sport" rows={r.byLeague} />
          <SplitBlock title="Flow Signal" rows={r.byTier} />
          <SplitBlock title="Bet value" rows={r.byValue} />
        </div>
      </section>

      {mine && r.picks.length > 0 && <PickTable picks={r.picks} fmt={fmt} onEdit={onEdit} />}
    </>
  );
}

function SampleNote({ r, mine }: { r: RecordReport; mine: boolean }) {
  const n = r.stats.won + r.stats.lost;
  const text =
    r.stage === "none"
      ? mine
        ? 'Nothing graded yet. Press "I bet this" on any play, or Log a bet here. Flow grades results the morning after.'
        : "Nothing graded yet. Every play Flow shows is saved, and graded once its game is final."
      : r.stage === "early"
        ? `${n} graded. Under 100, luck decides most of this. Closing price and the honesty check settle faster than wins and losses.`
        : r.stage === "building"
          ? `${n} graded. Patterns here are starting to mean something.`
          : `${n} graded. A solid sample.`;
  return (
    <>
      <div className={`note ${r.stage === "early" || r.stage === "none" ? "watch" : ""}`}>
        <Eye className="ico" />
        <span>{text}</span>
      </div>
      {r.ungraded > 0 && (
        <div className="note watch">
          <CircleAlert className="ico" />
          <span>
            <b>{r.ungraded} couldn't be graded.</b> Their games ended but the stats source had no result.
            Check them by hand{mine ? " with Edit" : ""}.
          </span>
        </div>
      )}
    </>
  );
}

function Stat({ label, big, sub, tone }: { label: string; big: string; sub: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rec-stat">
      <span className="lbl">{label}</span>
      <span className={`big ${tone ?? ""}`}>{big}</span>
      <span className="sub">{sub}</span>
    </div>
  );
}

function Calibration({ buckets }: { buckets: CalibrationBucket[] }) {
  return (
    <div className="calib">
      <div className="legend">
        <span>
          <i style={{ background: "var(--accent)" }} />
          Hit rate
        </span>
        <span>
          <i style={{ background: "var(--fg)", width: 2, height: 10 }} />
          Flow's chance
        </span>
      </div>
      <ul>
        {buckets.map((b) => {
          const label = `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`;
          const tip = b.n
            ? `Flow said ${pct0(b.predicted)} on average. ${Math.round((b.actual ?? 0) * b.n)} of ${b.n} hit (${pct0(b.actual)}).`
            : "No plays in this range yet.";
          return (
            <li key={b.from} title={tip}>
              <span className="c-l">{b.from === 0 ? "Under 40%" : b.to === 1 ? "70% and up" : label}</span>
              <span className="c-track" aria-hidden="true">
                {b.n > 0 && <i className="c-bar" style={{ width: `${(b.actual ?? 0) * 100}%` }} />}
                {b.predicted != null && <i className="c-tick" style={{ left: `${b.predicted * 100}%` }} />}
              </span>
              <span className="c-n">{b.n ? `${pct0(b.actual)} of ${b.n}` : "—"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Tuning({ r }: { r: RecordReport }) {
  const t = r.tuning;
  const now = Math.round(t.current * 100);
  return (
    <div className="note">
      <span>
        <b>Tuning Flow.</b> Flow's chance starts at the price's chance and moves {now}% of the way toward
        recent form.{" "}
        {t.best == null
          ? `After ${t.needed} graded plays with a real price (${t.n} so far), this shows whether ${now}% is right.`
          : t.best === t.current
            ? `${t.n} graded plays say ${now}% is right.`
            : `${t.n} graded plays fit ${Math.round(t.best * 100)}% best. ${t.best < t.current ? "Lower means trust the price more." : "Higher means trust recent form more."} We change it only after a review.`}
      </span>
    </div>
  );
}

function SplitBlock({ title, rows }: { title: string; rows: RecordSplit[] }) {
  return (
    <div className="split">
      <div className="split-h">
        <span>{title}</span>
        <span>Record</span>
        <span>Win</span>
        <span>Profit</span>
      </div>
      {rows.length === 0 && <div className="split-r na">Nothing yet</div>}
      {rows.map((x) => (
        <div
          className="split-r"
          key={x.key}
          title={x.stats.roi != null ? `ROI ${signedPct(x.stats.roi)}` : undefined}
        >
          <span className="split-l">{x.label}</span>
          <span className="lead">{recordText(x.stats)}</span>
          <span>{pct0(x.stats.winRate)}</span>
          <MoneyText units={x.stats.priced ? x.stats.units : null} />
        </div>
      ))}
    </div>
  );
}

function MoneyText({ units }: { units: number | null }) {
  if (units == null) return <span className="na">—</span>;
  const d = Math.round(units * STAKE_DOLLARS * 100) / 100;
  return <span className={tone(d)}>{fmtMoney(d)}</span>;
}

const tone = (x: number | null) => (x == null || x === 0 ? "" : x > 0 ? "pos" : "neg");
const recordText = (s: RecordStats) =>
  `${s.won}–${s.lost}${s.push ? `–${s.push}` : ""}${s.pending ? ` (${s.pending} waiting)` : ""}`;

const RESULT: Record<string, { text: string; cls: string }> = {
  win: { text: "Won", cls: "pos" },
  loss: { text: "Lost", cls: "neg" },
  push: { text: "Push", cls: "na" },
  void: { text: "Void", cls: "na" },
};

const PICKS_SHOWN = 10;

function PickTable({
  picks,
  fmt,
  onEdit,
}: {
  picks: PickView[];
  fmt: OddsFormat;
  onEdit: (p: PickView) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? picks : picks.slice(0, PICKS_SHOWN);
  return (
    <section className="rec-panel tbl-wrap rec-picks">
      <h3>
        Your bets <span className="aside">Click a bet to fix its price or result</span>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Bet</th>
            <th>Day</th>
            <th>Price</th>
            <th>Flow's chance</th>
            <th>Closing price</th>
            <th>Result</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => {
            const res = p.outcome ? RESULT[p.outcome]! : null;
            return (
              <tr
                key={p.id}
                tabIndex={0}
                onClick={() => onEdit(p)}
                onKeyDown={(e) => e.key === "Enter" && onEdit(p)}
              >
                <td className="lead">
                  {p.kind === "prop" ? `${p.subject} · ` : ""}
                  {p.market}
                  <small>{p.league}</small>
                </td>
                <td>{fmtDay(p.date)}</td>
                <td>{p.odds != null ? fmtOdds(p.odds, fmt) : <span className="na">Not entered</span>}</td>
                <td>{p.estimate != null ? pct0(p.estimate) : <span className="na">—</span>}</td>
                <td className={p.clv == null ? "" : p.clv > 0 ? "pos" : p.clv < 0 ? "neg" : ""}>
                  {p.closeOdds != null ? fmtOdds(p.closeOdds, fmt) : <span className="na">—</span>}
                  {p.closeOdds != null && p.clv == null && <small>other line</small>}
                </td>
                <td className={res?.cls ?? "na"}>
                  {res ? res.text : "Waiting"}
                  {p.gradedBy === "you" && <small>set by you</small>}
                </td>
                <td className={tone(p.profit)}>
                  {p.profit != null ? fmtMoney(p.profit) : <span className="na">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {picks.length > PICKS_SHOWN && (
        <button className="tb rec-more" onClick={() => setAll((x) => !x)}>
          {all ? `Show the latest ${PICKS_SHOWN}` : `Show all ${picks.length} bets`}
        </button>
      )}
    </section>
  );
}

const DAYS_SHOWN = 30;

/** Daily profit as bars around a zero line: mint above, rose below. Hover a bar for that day's record. */
function ProfitByDay({
  days,
  total: allTotal,
  unit,
}: {
  days: RecordReport["byDay"];
  total: number;
  unit: string;
}) {
  const shown = days.slice(0, DAYS_SHOWN).reverse();
  const priced = shown.filter((d) => d.stats.priced > 0);
  // The headline total comes from the report (core math); only a cut-down window sums its own days.
  const total = days.length <= DAYS_SHOWN ? allTotal : priced.reduce((t, d) => t + d.profit, 0);
  const up = Math.max(0, ...priced.map((d) => d.profit));
  const down = Math.max(0, ...priced.map((d) => -d.profit));
  const span = up + down || 1;
  const best = priced.length ? priced.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
  const worst = priced.length ? priced.reduce((a, b) => (b.profit < a.profit ? b : a)) : null;
  return (
    <>
      <h3>
        Profit by day
        {priced.length > 0 && <span className={`aside ${tone(total)}`}>{fmtMoney(total)}</span>}
      </h3>
      <p className="exp">
        {best && worst
          ? `Best day ${fmtMoney(best.profit)}. Worst day ${fmtMoney(worst.profit)}.`
          : `Shows up once a ${unit} with a price is graded.`}
      </p>
      <div className="pbd" role="img" aria-label={`Profit by day over ${shown.length} days`}>
        <div className="pbd-plot" style={{ ["--zero" as string]: `${(up / span) * 100}%` }}>
          {shown.map((d) => {
            const h = d.stats.priced ? (Math.abs(d.profit) / span) * 100 : 0;
            return (
              <span
                key={d.date}
                className="pbd-col"
                title={`${fmtDay(d.date)}: ${recordText(d.stats)}${d.stats.priced ? `, ${fmtMoney(d.profit)}` : ""}`}
              >
                <i
                  className={d.profit >= 0 ? "pos" : "neg"}
                  style={{ height: `${Math.max(h, d.stats.priced ? 1.5 : 0)}%` }}
                />
              </span>
            );
          })}
        </div>
        {shown.length > 0 && (
          <div className="pbd-x">
            <span>{fmtDay(shown[0]!.date)}</span>
            <span>{fmtDay(shown[shown.length - 1]!.date)}</span>
          </div>
        )}
      </div>
    </>
  );
}
