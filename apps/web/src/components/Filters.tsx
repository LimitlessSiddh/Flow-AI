export interface FilterState {
  league: string;
  game: string;
  market: string;
  minSig: number;
  watch: boolean;
  savedOnly: boolean;
  sort: "signal" | "value" | "time";
}

export const DEFAULT_FILTERS: FilterState = {
  league: "All",
  game: "all",
  market: "all",
  minSig: 0,
  watch: true,
  savedOnly: false,
  sort: "signal",
};

export function Filters({ f, set }: { f: FilterState; set: (p: Partial<FilterState>) => void }) {
  return (
    <div className="filters">
      <div className="tabs" role="group" aria-label="League">
        {["All", "NBA", "NFL", "NHL"].map((l) => (
          <button key={l} aria-pressed={f.league === l} onClick={() => set({ league: l, game: "all" })}>
            {l}
          </button>
        ))}
      </div>
      <label className="sel">
        Market
        <select value={f.market} onChange={(e) => set({ market: e.target.value })}>
          <option value="all">All</option>
          <option value="prop">Player props</option>
          <option value="moneyline">Moneyline</option>
          <option value="spread">Spread</option>
          <option value="total">Game total</option>
        </select>
      </label>
      <label className="sel">
        Signal
        <select value={f.minSig} onChange={(e) => set({ minSig: Number(e.target.value) })}>
          <option value={0}>Any</option>
          <option value={65}>Warm and Hot</option>
          <option value={80}>Hot only</option>
        </select>
      </label>
      <label className="sel">
        Sort
        <select value={f.sort} onChange={(e) => set({ sort: e.target.value as FilterState["sort"] })}>
          <option value="signal">Flow Signal</option>
          <option value="value">Bet value</option>
          <option value="time">Start time</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={f.watch} onChange={(e) => set({ watch: e.target.checked })} /> Watch
      </label>
      <label className="check">
        <input type="checkbox" checked={f.savedOnly} onChange={(e) => set({ savedOnly: e.target.checked })} />{" "}
        Saved only
      </label>
    </div>
  );
}
