import type { Meta, Outcome, PickInput, PickView } from "@flow/core";
import { useMutation } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useInvalidate } from "../../hooks/queries";
import { fmtDay } from "../../lib/format";

type Kind = PickInput["kind"];
const KINDS: { key: Kind; label: string }[] = [
  { key: "prop", label: "Player prop" },
  { key: "moneyline", label: "Moneyline" },
  { key: "spread", label: "Spread" },
  { key: "total", label: "Game total" },
];
const RESULTS: { key: Outcome | ""; label: string }[] = [
  { key: "", label: "Let Flow grade it" },
  { key: "win", label: "Won" },
  { key: "loss", label: "Lost" },
  { key: "push", label: "Push" },
  { key: "void", label: "Void (refunded)" },
];

/**
 * Log a bet you placed (any day, any market), or fix one already logged.
 * Flow finds the game and player itself and grades it after the game unless you set the result.
 */
export function PickDialog({
  meta,
  pick,
  onClose,
  onDone,
}: {
  meta: Meta;
  /** editing this pick; absent = logging a new one */
  pick?: PickView;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const inv = useInvalidate();
  const [date, setDate] = useState(meta.today);
  const [league, setLeague] = useState("NBA");
  const [kind, setKind] = useState<Kind>("prop");
  const [subject, setSubject] = useState("");
  const stats = meta.stats[league] ?? [];
  const [stat, setStat] = useState(stats[0]?.key ?? "points");
  const [side, setSide] = useState<"Over" | "Under">("Over");
  const [line, setLine] = useState(pick?.line != null ? String(pick.line) : "");
  const [odds, setOdds] = useState(
    pick?.odds != null ? String(pick.odds > 0 ? `+${pick.odds}` : pick.odds) : "",
  );
  const [outcome, setOutcome] = useState<Outcome | "">(pick?.gradedBy === "you" ? (pick.outcome ?? "") : "");

  const k = pick ? (pick.kind as Kind) : kind;
  const needsLine = k !== "moneyline";
  const yesNo = k === "prop" && stat === "anytimeTd";
  const lineNum = line.trim() === "" ? null : Number(line);
  const lineOk = !needsLine || yesNo || (lineNum != null && Number.isFinite(lineNum));

  const save = useMutation({
    mutationFn: async () => {
      if (pick) {
        await api.updatePick(pick.id, {
          odds: odds.trim() || null,
          ...(needsLine ? { line: lineNum } : {}),
          outcome: outcome || null,
        });
        return "Saved.";
      }
      await api.logPick({
        date,
        league,
        kind,
        subject,
        stat: kind === "prop" ? stat : null,
        side: kind === "prop" || kind === "total" ? (yesNo ? "Over" : side) : null,
        line: !needsLine ? null : yesNo ? 0.5 : lineNum,
        odds: odds.trim() || null,
        outcome: outcome || null,
      });
      return outcome ? "Logged with your result." : "Logged. Flow grades it after the game.";
    },
    onSuccess: (msg) => {
      inv();
      onDone(msg);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deletePick(pick!.id),
    onSuccess: () => {
      inv();
      onDone("Removed from My Record.");
    },
  });
  const pickLeague = (l: string) => {
    setLeague(l);
    setStat(meta.stats[l]?.[0]?.key ?? "points");
  };

  return (
    <dialog ref={ref} className="dlg" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="dlg-head">
          <h2>{pick ? "Edit this bet" : "Log a bet"}</h2>
          <button type="button" className="tb icon" aria-label="Close" onClick={onClose}>
            <X className="ico" />
          </button>
        </div>
        {pick ? (
          <p className="exp">
            <b>
              {pick.kind === "prop" ? `${pick.subject} · ` : ""}
              {pick.market}
            </b>{" "}
            · {pick.league} · {fmtDay(pick.date)}
          </p>
        ) : (
          <>
            <p className="exp">
              Placed a bet Flow didn't list, or one from an earlier day? Type it in. Flow finds the game and
              grades it.
            </p>
            <div className="tabs" role="group" aria-label="League">
              {meta.leagues.map((l) => (
                <button type="button" key={l} aria-pressed={league === l} onClick={() => pickLeague(l)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="fld-row">
              <label className="fld">
                <span>Bet type</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  {KINDS.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span>Game day</span>
                <input
                  type="date"
                  required
                  max={meta.today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <label className="fld">
              <span>{kind === "prop" ? "Player" : kind === "total" ? "Either team" : "Team you bet on"}</span>
              <input
                required
                minLength={2}
                placeholder={kind === "prop" ? "Full name, e.g. Collin Sexton" : "e.g. Knicks or NYK"}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                autoFocus
              />
            </label>
            {(kind === "prop" || kind === "total") && (
              <div className="fld-row">
                {kind === "prop" && (
                  <label className="fld">
                    <span>Stat</span>
                    <select value={stat} onChange={(e) => setStat(e.target.value)}>
                      {stats.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!yesNo && (
                  <label className="fld">
                    <span>Side</span>
                    <select value={side} onChange={(e) => setSide(e.target.value as "Over" | "Under")}>
                      <option>Over</option>
                      <option>Under</option>
                    </select>
                  </label>
                )}
              </div>
            )}
          </>
        )}
        <div className="fld-row">
          {needsLine && !yesNo && (
            <label className="fld">
              <span>{k === "spread" ? "Points (e.g. +10.5)" : "Line"}</span>
              <input
                required
                inputMode="decimal"
                placeholder={k === "spread" ? "+10.5" : "8.5"}
                value={line}
                onChange={(e) => setLine(e.target.value.replace(/^\+/, ""))}
              />
            </label>
          )}
          <label className="fld">
            <span>Your {meta.preferredBook} price</span>
            <input
              inputMode="decimal"
              placeholder="-115 or 2.10"
              value={odds}
              onChange={(e) => setOdds(e.target.value)}
            />
          </label>
        </div>
        <label className="fld">
          <span>Result</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome | "")}>
            {RESULTS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {!odds.trim() && <p className="exp">No price? It still counts in your record, but not in profit.</p>}
        {(save.error ?? remove.error) && <p className="err">{(save.error ?? remove.error)!.message}</p>}
        <div className="dlg-foot">
          {pick && (
            <button
              type="button"
              className="tb danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="ico" />
              Remove
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="tb" onClick={onClose}>
            Cancel
          </button>
          <button
            className="tb primary"
            disabled={save.isPending || (!pick && subject.length < 2) || !lineOk}
          >
            {save.isPending ? (pick ? "Saving" : "Finding the game") : pick ? "Save" : "Log bet"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
