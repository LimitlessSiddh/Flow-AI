import type { OddsFormat } from "@flow/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import { AddPlayDialog } from "./components/AddPlayDialog";
import { HelpPanel, PastBar, ScanBar } from "./components/Bars";
import { PlayDetailPanel } from "./components/detail/PlayDetailPanel";
import { DEFAULT_FILTERS, Filters, type FilterState } from "./components/Filters";
import { GameRail } from "./components/GameRail";
import { Header } from "./components/Header";
import { filterPlays, PlayList } from "./components/PlayList";
import { Toast, type ToastMsg } from "./components/Toast";
import { useBoard, useInvalidate, useMeta, usePlayState } from "./hooks/queries";
import { load, save } from "./lib/store";

type Theme = "dark" | "light";
const systemTheme = (): Theme => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
const mobile = () => matchMedia("(max-width:900px)").matches;

export function App() {
  const { data: meta, error: metaErr } = useMeta();
  const today = meta?.today;
  const tz = meta?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [picked, setDate] = useState<string | undefined>();
  const date = picked ?? today;
  const { data: board, error: boardErr } = useBoard(date);
  const past = !!date && !!today && date !== today;

  const [f, setF] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    ...load("flow-filters", {}),
    game: "all",
  }));
  const setFilters = (p: Partial<FilterState>) =>
    setF((cur) => {
      const next = { ...cur, ...p };
      save("flow-filters", { ...next, game: "all" });
      return next;
    });

  const [sel, setSel] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null);
  const select = useCallback((id: string | null) => {
    setSel(id);
    history.replaceState(null, "", id ? `#${encodeURIComponent(id)}` : location.pathname + location.search);
  }, []);

  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) || systemTheme(),
  );
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    save("flow-theme", next);
    try {
      localStorage.setItem("flow-theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };

  const [fmtOverride, setFmt] = useState<OddsFormat | null>(null);
  const fmt: OddsFormat = fmtOverride ?? (meta?.settings.oddsFormat === "decimal" ? "decimal" : "american");
  const setOddsFormat = (x: OddsFormat) => {
    setFmt(x);
    api.saveSettings({ oddsFormat: x }).catch(() => {});
  };

  const [helpOpen, setHelpOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToastMsg] = useState<ToastMsg | null>(null);
  const tTimer = useRef<number>(undefined);
  const showToast = useCallback((text: string, undo?: () => void) => {
    setToastMsg({ text, undo });
    clearTimeout(tTimer.current);
    tTimer.current = window.setTimeout(() => setToastMsg(null), 4500);
  }, []);

  // scanning
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const [scan, setScan] = useState<{ id: string; steps: { text: string; level: string }[] } | null>(null);
  const runScan = async () => {
    if (!date) return;
    try {
      const r = await api.scan(date);
      if (r.id) setScan({ id: r.id, steps: [] });
    } catch (e) {
      showToast((e as Error).message);
    }
  };
  useEffect(() => {
    if (!scan) return;
    const t = window.setInterval(async () => {
      try {
        const s = await api.scanStatus(scan.id);
        setScan({ id: scan.id, steps: s.steps });
        if (s.status !== "running") {
          clearInterval(t);
          setScan(null);
          invalidate();
          showToast(
            s.status === "done"
              ? `Scan finished. ${s.playCount ?? 0} plays on the board.`
              : "The scan failed. Check the server log.",
          );
        } else qc.invalidateQueries({ queryKey: ["board"] });
      } catch {
        /* keep polling */
      }
    }, 1200);
    return () => clearInterval(t);
  }, [scan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [settling, setSettling] = useState(false);
  const settle = async () => {
    if (!date) return;
    setSettling(true);
    try {
      const r = await api.settle(date);
      invalidate();
      showToast(r.settled ? `Graded ${r.settled} plays.` : "No final games to grade yet.");
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setSettling(false);
    }
  };

  const state = usePlayState();
  const dismiss = (id: string) => {
    state.mutate({ id, patch: { dismissed: true } });
    select(null);
    showToast("Dismissed. It won't show again today.", () =>
      state.mutate({ id, patch: { dismissed: false } }),
    );
  };

  const plays = useMemo(() => (board ? filterPlays(board, f, past) : []), [board, f, past]);
  const games = useMemo(() => new Map((board?.games ?? []).map((g) => [g.id, g])), [board]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sel && !document.querySelector("dialog[open]")) select(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [sel, select]);

  const changeDate = (d: string) => {
    setDate(d);
    select(null);
    setFilters({ game: "all" });
  };

  const err = metaErr ?? boardErr;
  const noScanYet = board && !board.scan && !board.plays.length && !past;
  const emptyHint = noScanYet ? (
    <>
      <b>No scan yet today.</b>Press Scan to pull today's games, prices and game logs. It takes a minute or
      two.
    </>
  ) : past && !board?.plays.length ? (
    <>
      <b>No plays saved for this day.</b>Flow only keeps days it scanned.
    </>
  ) : (
    <>
      <b>Nothing matches these filters.</b>Try a lower signal level, or turn Watch back on.
    </>
  );

  return (
    <>
      <Header
        date={date ?? today ?? ""}
        today={today ?? ""}
        tz={tz}
        board={board}
        scanning={!!scan}
        oddsFormat={fmt}
        theme={theme}
        helpOpen={helpOpen}
        onDate={changeDate}
        onScan={runScan}
        onHelp={() => setHelpOpen((o) => !o)}
        onTheme={toggleTheme}
        onOddsFormat={setOddsFormat}
        onAdd={() => setAddOpen(true)}
      />
      {err && (
        <div className="errbar" role="alert">
          <div className="wrap">{err.message}</div>
        </div>
      )}
      {past && board && (
        <PastBar
          board={board}
          onToday={() => today && changeDate(today)}
          onSettle={settle}
          settling={settling}
        />
      )}
      {scan && <ScanBar steps={scan.steps} />}
      {helpOpen && <HelpPanel />}
      {board && (
        <GameRail
          board={board}
          league={f.league}
          game={f.game}
          past={past}
          tz={tz}
          onGame={(g) => setFilters(g === "all" ? { game: g } : { game: g, league: "All" })}
        />
      )}
      <main className={`wrap main ${sel ? "open" : ""}`}>
        <section className="listcol" aria-label="Plays">
          <Filters f={f} set={setFilters} />
          {board ? (
            <PlayList
              board={board}
              plays={plays}
              f={f}
              sel={sel}
              past={past}
              fmt={fmt}
              tz={tz}
              onSelect={(id) => select(sel === id && !mobile() ? null : id)}
              emptyHint={emptyHint}
            />
          ) : (
            !err && <div className="empty">Loading the board…</div>
          )}
        </section>
        <PlayDetailPanel
          id={sel}
          game={(id) => games.get(id)}
          past={past}
          fmt={fmt}
          tz={tz}
          preferredBook={meta?.preferredBook ?? "Betway"}
          onClose={() => select(null)}
          onDismiss={dismiss}
          toast={showToast}
        />
      </main>
      <footer className="wrap">
        Flow is a research tool. It shows evidence and prices, and you make the call. It never places bets.
        Stats from NHL.com and ESPN. Prices from {meta?.preferredBook ?? "Betway"} when you enter them,
        otherwise from the backup books listed on each play.
      </footer>
      <Toast t={toast} onDone={() => setToastMsg(null)} />
      {addOpen && meta && date && (
        <AddPlayDialog
          meta={meta}
          date={date}
          onClose={() => setAddOpen(false)}
          onAdded={(id) => {
            setAddOpen(false);
            select(id);
            showToast("Added and rated with your price.");
          }}
        />
      )}
    </>
  );
}
