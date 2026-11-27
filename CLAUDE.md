# Flow: notes for Claude

- Monorepo: pnpm workspaces. Apps in `apps/` (web, api, worker), shared code in `packages/` (core, data, db, engine).
- Numbers come from `packages/core` only. Never let AI output change a computed stat, price or score.
- Run `pnpm check` before committing. Tests use Vitest; the engine has an end-to-end test with fake sources.
- Schema changes: edit `packages/db/src/schema.ts`, then `pnpm --filter @flow/db generate`. Never edit generated SQL.
- UI follows the design in the original prototype: pure black dark mode, cool greys, colour roles (cyan = form and
  action, mint/rose = value up/down, lemon = Watch), Lucide icons only, Unbounded for the wordmark and big numbers,
  Geist for UI text. Plain language for an 18 to 30 year old bettor.
- Flow never places bets. Copy must not tell people what to bet.
