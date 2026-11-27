import type { Board, OddsFormat } from "@flow/core";
import { Calendar, ChevronDown, CircleHelp, Moon, Plus, RefreshCw, Sun } from "lucide-react";
import { useState } from "react";
import { fmtDay, fmtTime } from "../lib/format";
import { Brand } from "./Brand";
import { DatePicker } from "./DatePicker";

export function Header(props: {
  date: string;
  today: string;
  tz: string;
  board: Board | undefined;
  scanning: boolean;
  oddsFormat: OddsFormat;
  theme: "dark" | "light";
  helpOpen: boolean;
  onDate: (iso: string) => void;
  onScan: () => void;
  onHelp: () => void;
  onTheme: () => void;
  onOddsFormat: (f: OddsFormat) => void;
  onAdd: () => void;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const isPast = props.date !== props.today;
  const scan = props.board?.scan;
  const week = props.board?.week;
  return (
    <header className="top">
      <div className="wrap">
        <Brand />
        <div className="when">
          <button
            ref={setAnchor}
            className="datebtn"
            aria-haspopup="dialog"
            aria-expanded={calOpen}
            onClick={() => setCalOpen((o) => !o)}
          >
            <Calendar className="ico" />
            <span>
              {props.date === props.today ? <span className="today-pre">Today · </span> : ""}
              {fmtDay(props.date)}
            </span>
            <ChevronDown className="ico" />
          </button>
        </div>
        <div className="spacer" />
        <div className="meta">
          {!isPast && scan?.finishedAt && scan.status === "done" && (
            <span className="scan">
              Scanned <b>{fmtTime(scan.finishedAt, props.tz)}</b>
            </span>
          )}
          {week && week.won + week.lost > 0 && (
            <span className="rec">
              Tracked{" "}
              <b>
                {week.won}–{week.lost}
              </b>{" "}
              this week
            </span>
          )}
        </div>
        <div className="tabs odds-fmt" role="group" aria-label="Odds format">
          <button
            aria-pressed={props.oddsFormat === "american"}
            onClick={() => props.onOddsFormat("american")}
            title="American odds"
          >
            -110
          </button>
          <button
            aria-pressed={props.oddsFormat === "decimal"}
            onClick={() => props.onOddsFormat("decimal")}
            title="Decimal odds"
          >
            1.91
          </button>
        </div>
        <button className="tb" onClick={props.onAdd} aria-label="Add a play">
          <Plus className="ico" />
          <span>Add play</span>
        </button>
        <button className="tb" aria-label="Scores" aria-expanded={props.helpOpen} onClick={props.onHelp}>
          <CircleHelp className="ico" />
          <span>Scores</span>
        </button>
        <button
          className="tb icon"
          aria-label={props.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={props.onTheme}
        >
          {props.theme === "dark" ? <Sun className="ico" /> : <Moon className="ico" />}
        </button>
        {!isPast && (
          <button
            className="tb primary"
            id="scanBtn"
            aria-label="Rescan"
            disabled={props.scanning}
            onClick={props.onScan}
          >
            <RefreshCw className={`ico ${props.scanning ? "spin" : ""}`} />
            <span>{props.scanning ? "Scanning" : scan ? "Rescan" : "Scan"}</span>
          </button>
        )}
      </div>
      {calOpen && (
        <DatePicker
          date={props.date}
          today={props.today}
          anchor={anchor}
          onClose={() => setCalOpen(false)}
          onPick={(d) => {
            setCalOpen(false);
            props.onDate(d);
          }}
        />
      )}
    </header>
  );
}
