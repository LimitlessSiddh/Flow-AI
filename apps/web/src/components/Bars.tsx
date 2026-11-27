import type { Board } from "@flow/core";
import { fmtDay } from "../lib/format";

export function HelpPanel() {
  return (
    <div className="help">
      <div className="wrap">
        <p>
          <b>Flow Signal, 0 to 100</b>Is the player or team hot right now? It compares the last 5, 8 and 10
          games with their own season. 65 and up is Warm, 80 and up is Hot. It ignores the price.
        </p>
        <p>
          <b>Bet value</b>Is the price good? The odds imply a break-even chance. Flow makes its own estimate.
          Value is the gap: plus means the price is in your favour, minus means the streak is already priced
          in.
        </p>
        <p>
          <b>Watch</b>The data is thin, stale or uncertain. Look, but don't lean on it. Flow never places
          bets. Type in your Betway price on any play to use your book's real number.
        </p>
      </div>
    </div>
  );
}

export function ScanBar({ steps }: { steps: { text: string; level: string }[] }) {
  const last = steps.slice(-5);
  return (
    <div className="scanbar" role="status" aria-live="polite">
      <div className="wrap">
        {last.length === 0 && (
          <span className="step on">
            <i />
            Starting scan
          </span>
        )}
        {last.map((s, i) => (
          <span
            key={i}
            className={`step ${i === last.length - 1 ? "on" : "done"} ${s.level === "warn" ? "warn" : ""}`}
          >
            <i />
            {s.text}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PastBar({
  board,
  onToday,
  onSettle,
  settling,
}: {
  board: Board;
  onToday: () => void;
  onSettle: () => void;
  settling: boolean;
}) {
  const hot = board.plays.filter((p) => p.tier === "Hot" && p.result && !p.result.push);
  const hw = hot.filter((p) => p.result!.won).length;
  const { won, lost, pending } = board.record;
  return (
    <div className="pastbar">
      <div className="wrap">
        <span>
          <b>{fmtDay(board.date)}</b>
          {won + lost > 0 ? (
            <>
              {" "}
              · Plays went{" "}
              <span className="w">
                {won}–{lost}
              </span>
              {hot.length ? ` · Hot plays ${hw}–${hot.length - hw}` : ""}
            </>
          ) : board.plays.length ? (
            " · Not graded yet"
          ) : (
            " · No plays saved for this day"
          )}
        </span>
        {pending > 0 && (
          <button className="tb" onClick={onSettle} disabled={settling}>
            {settling ? "Grading" : `Grade ${pending} results`}
          </button>
        )}
        <button className="tb" onClick={onToday}>
          Back to today
        </button>
      </div>
    </div>
  );
}
