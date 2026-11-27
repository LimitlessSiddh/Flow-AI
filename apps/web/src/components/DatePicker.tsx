import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDates } from "../hooks/queries";
import { fmtDay, isoOf, parseIso } from "../lib/format";

const MIN_DAY_OFFSET = 200; // how far back the calendar goes

export function DatePicker({
  date,
  today,
  anchor,
  onPick,
  onClose,
}: {
  date: string;
  today: string;
  anchor: HTMLElement | null;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const sel = parseIso(date);
  const t = parseIso(today);
  const min = new Date(t.getFullYear(), t.getMonth(), t.getDate() - MIN_DAY_OFFSET);
  const [month, setMonth] = useState(new Date(sel.getFullYear(), sel.getMonth(), 1));
  const ref = useRef<HTMLDivElement>(null);
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const { data: summary } = useDates(isoOf(new Date(y, m, 1)), isoOf(new Date(y, m, days)), true);
  const byDay = new Map((summary ?? []).map((d) => [d.date, d]));
  const yest = isoOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1));
  const rect = anchor?.getBoundingClientRect();

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node))
        onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  const cells = [];
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(new Date(y, m, d));
    const off = iso > today || parseIso(iso) < min;
    const s = byDay.get(iso);
    const label = `${fmtDay(iso)}${s ? `, ${s.plays} plays${s.won + s.lost ? `, went ${s.won}–${s.lost}` : ""}` : ""}`;
    cells.push(
      <button
        key={iso}
        disabled={off}
        className={[iso === today ? "today" : "", s ? "has" : ""].join(" ")}
        aria-pressed={iso === date}
        aria-label={label}
        title={label}
        onClick={() => onPick(iso)}
      >
        {d}
      </button>,
    );
  }

  return (
    <div
      ref={ref}
      className="cal"
      role="dialog"
      aria-label="Pick a date"
      style={
        rect ? { left: Math.max(16, Math.min(rect.left, innerWidth - 316)), top: rect.bottom + 8 } : undefined
      }
    >
      <div className="cal-head">
        <button
          className="tb icon"
          disabled={new Date(y, m, 1) <= min}
          aria-label="Previous month"
          onClick={() => setMonth(new Date(y, m - 1, 1))}
        >
          <ChevronLeft className="ico" />
        </button>
        <b>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b>
        <button
          className="tb icon"
          disabled={new Date(y, m + 1, 1) > t}
          aria-label="Next month"
          onClick={() => setMonth(new Date(y, m + 1, 1))}
        >
          <ChevronRight className="ico" />
        </button>
      </div>
      <div className="cal-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="wd">
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {cells}
      </div>
      <div className="cal-quick">
        <button className="tb" onClick={() => onPick(today)}>
          Today
        </button>
        <button className="tb" onClick={() => onPick(yest)}>
          Yesterday
        </button>
      </div>
      <div className="cal-note">Days in bold have plays. Pick one to see how they did.</div>
    </div>
  );
}
