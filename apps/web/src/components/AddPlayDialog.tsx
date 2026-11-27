import type { Meta } from "@flow/core";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useInvalidate } from "../hooks/queries";

/** Score a prop you found in your Betway app. Flow pulls the player's game logs and rates it. */
export function AddPlayDialog({
  meta,
  date,
  onClose,
  onAdded,
}: {
  meta: Meta;
  date: string;
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const [league, setLeague] = useState("NBA");
  const stats = meta.stats[league] ?? [];
  const [stat, setStat] = useState(stats[0]?.key ?? "points");
  const [player, setPlayer] = useState("");
  const [side, setSide] = useState<"Over" | "Under">("Over");
  const [line, setLine] = useState("");
  const [odds, setOdds] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const yesNo = stat === "anytimeTd";
  const inv = useInvalidate();
  const m = useMutation({
    mutationFn: () =>
      api.addPlay({
        date,
        league,
        player,
        stat,
        side: yesNo ? "Over" : side,
        line: yesNo ? 0.5 : Number(line),
        odds,
      }),
    onSuccess: (p) => {
      inv();
      onAdded(p.id);
    },
  });
  useEffect(() => {
    ref.current?.showModal();
  }, []);
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
          m.mutate();
        }}
      >
        <div className="dlg-head">
          <h2>Add a play from {meta.preferredBook}</h2>
          <button type="button" className="tb icon" aria-label="Close" onClick={onClose}>
            <X className="ico" />
          </button>
        </div>
        <p className="exp">
          Found a prop in your app? Type it in. Flow pulls the player's game logs and rates it with your
          price.
        </p>
        <div className="tabs" role="group" aria-label="League">
          {meta.leagues.map((l) => (
            <button type="button" key={l} aria-pressed={league === l} onClick={() => pickLeague(l)}>
              {l}
            </button>
          ))}
        </div>
        <label className="fld">
          <span>Player</span>
          <input
            required
            minLength={2}
            placeholder="Full name, e.g. Jayson Tatum"
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            autoFocus
          />
        </label>
        <div className="fld-row">
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
        <div className="fld-row">
          {!yesNo && (
            <label className="fld">
              <span>Line</span>
              <input
                required
                inputMode="decimal"
                placeholder="26.5"
                value={line}
                onChange={(e) => setLine(e.target.value)}
              />
            </label>
          )}
          <label className="fld">
            <span>{meta.preferredBook} odds</span>
            <input
              required
              inputMode="decimal"
              placeholder="-115 or 1.87"
              value={odds}
              onChange={(e) => setOdds(e.target.value)}
            />
          </label>
        </div>
        {m.error && <p className="err">{m.error.message}</p>}
        <div className="dlg-foot">
          <button type="button" className="tb" onClick={onClose}>
            Cancel
          </button>
          <button className="tb primary" disabled={m.isPending || !player || !odds || (!yesNo && !line)}>
            {m.isPending ? "Pulling game logs" : "Rate this play"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
