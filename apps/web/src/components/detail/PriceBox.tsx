import { parseOdds, type OddsFormat, type PlayDetail } from "@flow/core";
import { useState } from "react";
import { useSetPrice } from "../../hooks/queries";
import { ago, fmtOdds, pct } from "../../lib/format";

/** Every price Flow found, plus the box where you type the price your Betway app shows. */
export function PriceBox({
  p,
  fmt,
  preferredBook,
  disabled,
}: {
  p: PlayDetail;
  fmt: OddsFormat;
  preferredBook: string;
  disabled: boolean;
}) {
  const mine = p.prices.find((x) => x.origin === "manual");
  const [text, setText] = useState("");
  const isProp = p.kind === "prop";
  const [lineText, setLineText] = useState(isProp && p.line != null ? String(p.line) : "");
  const [err, setErr] = useState<string | null>(null);
  const m = useSetPrice();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parseOdds(text) == null) return setErr("Type odds like -115, +105 or 1.87");
    const line = isProp ? Number(lineText) : null;
    if (isProp && (!lineText.trim() || !Number.isFinite(line) || line! < 0))
      return setErr("Type the line, like 26.5");
    setErr(null);
    m.mutate(
      { id: p.id, odds: text.trim(), line },
      { onSuccess: () => setText(""), onError: (x) => setErr(x.message) },
    );
  };
  return (
    <div className="prices">
      <h3>
        Prices
        <span className="aside">
          {mine
            ? `Using your ${preferredBook} price`
            : p.lineSource === "estimated"
              ? `Line estimated by Flow`
              : `No ${preferredBook} price yet`}
        </span>
      </h3>
      {!disabled && (
        <form className="mybook" onSubmit={submit}>
          <label htmlFor={isProp ? "mybook-line" : "mybook-odds"}>
            Your {preferredBook} {isProp ? "line and price" : "price"}
          </label>
          {isProp && (
            <input
              id="mybook-line"
              className="line"
              inputMode="decimal"
              placeholder="26.5"
              aria-label={`${preferredBook} line`}
              value={lineText}
              onChange={(e) => setLineText(e.target.value)}
            />
          )}
          <input
            id="mybook-odds"
            aria-label={`${preferredBook} price`}
            inputMode="decimal"
            placeholder={fmt === "decimal" ? "1.87" : "-115"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={!!err}
          />
          <button className="tb primary" disabled={!text.trim() || m.isPending}>
            {mine ? "Update" : "Use this price"}
          </button>
          {mine && (
            <button
              type="button"
              className="tb"
              onClick={() => m.mutate({ id: p.id, odds: null }, { onError: (x) => setErr(x.message) })}
            >
              Clear
            </button>
          )}
          {err && <span className="err">{err}</span>}
        </form>
      )}
      {p.prices.length ? (
        <ul className="booklist">
          {p.prices.map((x) => (
            <li key={x.book} className={p.price?.book === x.book ? "used" : ""}>
              <span className="bn">{x.bookTitle}</span>
              <span className="bo">{fmtOdds(x.odds, fmt)}</span>
              <span className="bi">needs {pct(x.implied)}</span>
              <span className="bt">{x.origin === "manual" ? "you entered" : ago(x.retrievedAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="exp">No sportsbook prices found for this market.</p>
      )}
    </div>
  );
}
