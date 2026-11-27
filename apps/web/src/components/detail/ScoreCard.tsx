import type { OddsFormat, PlayDetail } from "@flow/core";
import { Eye, Flame } from "lucide-react";
import { fmtNum, fmtOdds, pct } from "../../lib/format";

/** Flow Signal and Bet value: one card, two rows on one grid, 20-block strips. */
export function ScoreCard({ p, fmt }: { p: PlayDetail; fmt: OddsFormat }) {
  const tier = p.tier ?? "Mild";
  const on = Math.round((p.signal ?? 0) / 5);
  const w = [10, 8, 5].map((n) => p.windows.find((x) => x.n === n)).find(Boolean);
  const unitWord = p.unit;
  const sigCap = w ? (
    p.kind === "spread" ? (
      <>
        Avg {p.unit}, last {w.n}: <b>{fmtNum(p, w.avg)}</b> · Season: <b>{fmtNum(p, p.seasonAvg ?? 0)}</b>
      </>
    ) : p.kind === "moneyline" ? (
      <>
        Won <b>{w.hits}</b> of the last {w.n} · Season: <b>{Math.round((p.seasonAvg ?? 0) * 100)}%</b>
      </>
    ) : (
      <>
        Last {w.n}: <b>{fmtNum(p, w.avg)}</b> {unitWord} a game · Season: <b>{fmtNum(p, p.seasonAvg ?? 0)}</b>
      </>
    )
  ) : (
    <>Only {p.seasonGames ?? 0} games so far this season.</>
  );

  const imp = p.price ? p.price.implied * 100 : null;
  const model = p.estimate == null ? null : p.estimate * 100;
  const v = p.value;
  const mid = imp == null ? 50 : model == null ? imp : (imp + model) / 2;
  const lo = Math.max(0, Math.min(70, Math.round((mid - 15) / 5) * 5));
  const seg = (i: number) => {
    const m = lo + 1.5 * i + 0.75;
    if (imp == null) return "";
    let k = m < imp ? "p" : "";
    if (model != null) {
      if (model > imp && m >= imp && m < model) k = "g";
      if (model < imp && m >= model && m < imp) k = "r";
    }
    return k;
  };
  const priceTxt = p.price ? fmtOdds(p.price.odds, fmt) : null;
  const valCap = !p.price ? (
    "No price yet. Type in your Betway price below to see the value."
  ) : v == null ? (
    "Not rated. There isn't enough evidence for Flow to estimate a chance."
  ) : v >= 0 ? (
    <>
      Flow thinks this hits more often than <b>{priceTxt}</b> needs. That gap is the value.
    </>
  ) : (
    <>
      <b>{priceTxt}</b> already expects more than Flow does. The streak is priced in.
    </>
  );

  return (
    <div className="scores">
      <div className="sc">
        <div className="sc-l">
          <span className="sc-k">Flow Signal</span>
          <div className={`big ${tier === "Hot" ? "hot" : ""} ${p.signal == null ? "na" : ""}`}>
            {p.signal ?? "N/A"}
          </div>
          <span className={`chip ${tier === "Hot" ? "hot" : ""}`}>
            {tier === "Hot" && <Flame className="ico" />}
            {tier}
          </span>
        </div>
        <div className="sc-r">
          <div
            className={`meter ${tier.toLowerCase()}`}
            role="img"
            aria-label={`Flow Signal ${p.signal ?? "not rated"} out of 100, ${tier}`}
          >
            {Array.from({ length: 20 }, (_, i) => (
              <i key={i} className={i < on ? "on" : ""} />
            ))}
          </div>
          <div className="mlab" aria-hidden="true">
            <span>0</span>
            <span className={tier === "Warm" ? "cur" : ""}>65</span>
            <span className={tier === "Hot" ? "cur" : ""}>80</span>
            <span>100</span>
          </div>
          <div className="sc-cap">{sigCap}</div>
        </div>
      </div>
      <div className="sc">
        <div className="sc-l">
          <span className="sc-k">Bet value</span>
          {v == null ? (
            <div className="big na">N/A</div>
          ) : (
            <div className={`big ${v >= 0 ? "pos" : "neg"}`}>
              {v >= 0 ? "+" : "–"}
              {Math.abs(v).toFixed(1)}
              <small>%</small>
            </div>
          )}
          {v == null ? (
            <span className="chip watch">
              <Eye className="ico" />
              Not rated
            </span>
          ) : (
            <span className={`chip ${v >= 3 ? "pos" : v < 0 ? "neg" : ""}`}>{p.valueLabel}</span>
          )}
        </div>
        <div className="sc-r">
          <div
            className="vtrack"
            role="img"
            aria-label={`Price needs ${imp == null ? "unknown" : imp.toFixed(1) + "%"}, Flow thinks ${model == null ? "not rated" : model.toFixed(1) + "%"}`}
          >
            {Array.from({ length: 20 }, (_, i) => (
              <i key={i} className={seg(i)} />
            ))}
          </div>
          <div className="vleg">
            <span style={{ ["--sw" as string]: "var(--muted)" }}>
              Price needs <b>{p.price ? pct(p.price.implied) : "—"}</b>
            </span>
            {model == null ? (
              <span style={{ ["--sw" as string]: "var(--miss)" }}>
                Flow <b className="na">not rated</b>
              </span>
            ) : (
              <span style={{ ["--sw" as string]: imp != null && model >= imp ? "var(--pos)" : "var(--neg)" }}>
                Flow <b>{pct(p.estimate!)}</b>
              </span>
            )}
          </div>
          <div className="sc-cap">{valCap}</div>
        </div>
      </div>
    </div>
  );
}
