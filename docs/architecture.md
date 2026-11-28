# Architecture

Flow runs on your laptop. The frontend and backend are separate apps that share one TypeScript contract.

```
 browser (apps/web)  ──HTTP /api──►  apps/api (Fastify)  ──►  packages/engine  ──►  packages/db (SQLite)
                                                              │
 terminal (apps/worker) ─────────────────────────────────────┘
                                                              │
                                     packages/data ◄──────────┤  NHL API, ESPN, The Odds API
                                     claude / codex CLI ◄─────┘  AI research on your own plan
```

## A scan, step by step

1. **Slate.** Load the day's games for each league (NHL API for hockey, ESPN for NBA and NFL).
2. **Prices.** Ask The Odds API for moneyline, spread and total on every game, and player props for the first few
   games in each league (configurable, to stay inside the free 500 credits). With no key, or no credits, Flow
   falls back to ESPN's free game lines. Your Betway prices are stored separately and always win.
3. **Markets.** Group quotes into markets. Each side is priced at the line your highest-ranked book offers.
4. **Evidence.** Pull each player's game log or each team's results, with caching so a slate costs few calls.
5. **Scores.** `packages/core` computes the Flow Signal and Flow's form-based rate. Of each pair (Over and Under,
   team A and team B) Flow keeps the side with the stronger signal. Plays under 55 are left off, with a reason.
6. **Research.** The top plays go to Claude Code (or Codex) with the computed numbers. It searches for injury
   news and role changes and returns strict JSON with sources, which Flow validates before saving.
7. **Flags.** Watch labels and evidence quality are recomputed from what's stored.

`pnpm settle` grades a past day: team markets from final scores, props from the player's game log for that date.
It grades the board, Flow's saved history and your bets. See [record.md](record.md) for how results are kept and
used.

## Why these choices

- **SQLite** keeps everything in one file on your laptop, free. Drizzle makes moving to Postgres a config change.
- **Fastify + React/Vite** are fast, well known, and easy to deploy separately later.
- **CLI-based AI research** uses the Claude and ChatGPT plans you already pay for, instead of per-call API billing.
  When Flow goes public this becomes an API provider behind the same `ResearchProvider` interface.
