# Flow

Flow is a sports betting research board for the NBA, NFL and NHL. Each day it finds the plays where recent form
stands out, compares them with the price, and shows the evidence. **It never places bets.**

Every play gets two scores:

- **Flow Signal (0 to 100):** is the player or team hot right now? It compares the last 5, 8 and 10 games with
  the season. 65 and up is Warm, 80 and up is Hot. It ignores the price.
- **Bet value:** is the price good? The odds imply a break-even chance. Flow's estimate starts at the market's
  chance and moves part of the way toward recent form. Value is the gap between the two.

Plays with thin, stale or uncertain evidence are labelled **Watch**.

## Run it on your laptop

You need a Mac (or any computer) with Node 22 and pnpm.

```bash
# 1. Tools (once)
brew install node@22          # or use nvm: nvm install 22
corepack enable                # gives you pnpm

# 2. Code
git clone https://github.com/LimitlessSiddh/Flow-AI.git flow && cd flow
pnpm install

# 3. Settings
cp .env.example .env           # then open .env and paste your free Odds API key

# 4. Check every data source from this computer
pnpm health

# 5. Start the app
pnpm dev                       # opens the API on :8787 and the board on http://localhost:5173
```

Then press **Scan** on the board, or run `pnpm scan` in another terminal. A scan takes a minute or two.

### Free accounts you need

| What                                                                                       | Why                                              | Cost                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------ |
| [The Odds API](https://the-odds-api.com) key                                               | Backup sportsbook prices and player props        | Free plan, 500 credits a month |
| [Claude Code](https://docs.claude.com/en/docs/claude-code) signed in with your Claude plan | AI research: injury news, role changes, sources  | Included in Claude Pro         |
| or [Codex CLI](https://github.com/openai/codex) signed in with ChatGPT                     | Backup research tool (`RESEARCH_PROVIDER=codex`) | Included in ChatGPT Plus       |

Stats come from the NHL's public API and ESPN's public data. No key needed.

### Your Betway prices

Betway Ontario isn't covered by any free odds feed, so Flow shows a labelled backup book until you add yours:

- Open any play and type the price from your Betway app into **Your Betway price**. Bet value updates at once.
- Found a prop in the app that Flow didn't list? Press **Add play**, type it in, and Flow rates it.

Odds show as American by default. Switch to decimal with the `-110 | 1.91` toggle in the header.

## Everyday commands

| Command                                                     | What it does                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                                                  | Run the API and the board together                                   |
| `pnpm scan [YYYY-MM-DD] [--no-research] [--league NBA,NHL]` | Build the board for a day (default today)                            |
| `pnpm settle [YYYY-MM-DD]`                                  | Grade a day's plays once games are final (default yesterday)         |
| `pnpm health`                                               | Check every data source and your research tool                       |
| `pnpm check`                                                | Type check, lint and test everything                                 |
| `pnpm --filter @flow/worker seed:demo`                      | Fill `data/demo.db` with made-up games, for UI work without internet |

## How the code is organized

```
apps/
  web/       React + Vite frontend (the board)
  api/       Fastify REST backend
  worker/    Command-line jobs: scan, settle, doctor
packages/
  core/      Odds math, scoring and the API contract. Pure functions, fully tested
  data/      Adapters for the NHL API, ESPN and The Odds API
  db/        SQLite schema and migrations (Drizzle ORM)
  engine/    The pipeline: scan a slate, score, research, settle, read the board
docs/        Architecture, scoring and data source notes
```

See [docs/architecture.md](docs/architecture.md) for how a scan works, and [docs/scoring.md](docs/scoring.md) for
the exact formulas.

## Ground rules

- Numbers come from code, not from AI. The AI step only reads news and explains; every figure it sees was computed
  by `packages/core`.
- Every price shows its book and when it was checked. Flow never invents a line.
- Team logos load from the leagues' and ESPN's public image servers. They are trademarks: fine for a personal
  tool, but they need licensing before Flow is offered to the public.
