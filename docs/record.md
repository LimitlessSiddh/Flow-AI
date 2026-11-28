# My Record: how Flow keeps and uses results

The point of My Record is to test whether Flow works, with data instead of a feeling. A handful of bets can't
answer that; hundreds of graded plays can. So Flow saves **every** play it shows, not only the ones you bet,
grades them from official box scores, and turns them into a few honest checks.

## What gets stored

Two tables in the same SQLite file as the board (`data/flow.db`). Both are append-and-grade: rows are written
before a game, frozen when it starts, and only gain a result afterwards.

| Table          | One row per                | Written when                                    | Holds                                                                                                                                                    |
| -------------- | -------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play_history` | play Flow put on the board | every scan, and when you change a price         | market, line, Flow Signal, Flow's form rate (`model`), Flow's chance at the price (`estimate`), the price and book, model version, closing price, result |
| `picks`        | bet you placed             | "I bet this", Log a bet, or `pnpm picks import` | the same snapshot of Flow's numbers, **your** price, closing price, result, and whether Flow or you graded it                                            |

Why separate from `plays`: the board table is a working copy. Each scan rewrites it and deletes plays that
dropped off, which is right for the board but would quietly erase history. `play_history` never loses a row; a
play a later pre-game scan dropped is kept and marked `on_board = false`, and the record leaves it out.

Why snapshots freeze at the start: so nothing (a rescan, a price you type later) can rewrite what Flow said
before the game. That keeps the test honest.

`model_version` (for example `signal-v2+form0.35`) is stamped on every row, so when the model changes we can
compare old and new versions instead of mixing them.

## How it fills in

```
 scan ──► plays (board) ──► play_history (snapshot, until the game starts)
 "I bet this" / Log a bet ──► picks
 every 10 min while the app runs ──► closing prices for games starting within 40 min
 on startup + every hour ──► grade the last 3 days from NHL / ESPN box scores
```

- **Grading** (`packages/engine/src/settle.ts`) uses final scores for team markets and the player's game log for
  props. A player who didn't play is graded `void`, like the books do. If the stats source has no answer, the row
  stays ungraded and the record page flags it after 8 hours so you can check it by hand. A result you set
  yourself is never overwritten.
- **Closing prices** (`record/close.ts`): game lines come free from ESPN. Prop prices cost Odds API credits, so
  Flow only fetches them for your prop picks, once per game, in the last 20 minutes, and never below the credit
  reserve. The close only counts against your price when it's for the same line.
- **The math** (`packages/core/src/record.ts`) is pure and tested: grading, profit at a flat $10, ROI, closing
  line value, calibration buckets and the form-weight fit.

## How the data improves Flow

| Check                               | Question it answers                                         | What we do with it                                                                                           |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Calibration                         | Do Flow's 60% plays hit about 60%?                          | If Flow is over-confident, lean more on the price                                                            |
| Form weight fit                     | How far should Flow move from the price toward recent form? | Today 35%. After 150 priced results the page shows the best fit; we change `FORM_WEIGHT` only after a review |
| Splits (type, sport, signal, value) | Which kinds of plays actually win?                          | Raise or lower the bar for weak groups, or hide them                                                         |
| Closing line value                  | Was your price better than the price at the start?          | The fastest honest signal: it settles in weeks, wins take months                                             |

Every number stays computed in code. AI never grades a result or changes a stat.

## Why this stack (and what we skipped)

- **SQLite, same file.** One user, one laptop, a few hundred rows a day: about 100k rows a year, which SQLite
  reads in milliseconds. No server to run, free, and Drizzle keeps the move to Postgres a config change when
  Flow has more users.
- **Timers inside the API process, no Redis or queue.** The jobs are two small loops (closing prices, grading)
  for one person. A queue (Redis, BullMQ) earns its keep with many workers or many users; here it would be one
  more thing to install and keep running for no gain. The same functions run from the terminal
  (`pnpm settle`, `pnpm close`), so a cron job or a hosted scheduler can call them later without changes.
- **Box scores, not web searches, for grading.** Official stats are free, exact and instant; searching a few
  hundred plays a night would be slower, cost usage, and could misread a page.
- **CSV export.** `Spreadsheet` on the record page (or `/api/record.csv`) downloads every row, for your own
  analysis in Sheets or anywhere else.

When Flow goes multi-user: move to Postgres, run grading and closing prices as scheduled jobs on the server
(that's when a queue makes sense), and add a user id to `picks`. The tables are shaped for that already.
