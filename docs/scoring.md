# Scoring

All of this lives in `packages/core/src/score.ts` and is covered by tests.

## Flow Signal (0 to 100)

Three parts, each mapped to 0..1, weighted and scaled to 100:

| Part              | Weight | What it measures                                                                  |
| ----------------- | ------ | --------------------------------------------------------------------------------- |
| Recent clear rate | 50%    | Share of games over the line in the last 5, 8 and 10 (weighted .5 / .3 / .2)      |
| Lift              | 25%    | Last-10 average against the season average, in standard deviations (capped at ±2) |
| Cushion           | 25%    | Last-5 average against the line, in standard deviations (capped at ±2)            |

That gives the **form signal**. The Flow Signal on the board then blends in Flow's own chance the play hits
(the form rate below, or the matchup model for team markets): 60% form signal + 40% model points, where a 50%
chance is 50 points, 65% is 75 and 80% or more is 100. A hot streak that the model rates as a coin flip can no
longer reach the top of the board. Neither part uses the price. With no model chance, the signal is form alone.

Tiers: 80+ Hot, 65 to 79 Warm, under 65 Mild. Fewer than 5 games: no signal.

## Bet value

1. **Form rate:** last-10 clear rate shrunk toward the season clear rate, worth 12 games of season evidence.
   Fewer than 8 games: not rated.
2. **Price chance:** the break-even chance the odds imply (vig included).
3. **Flow's estimate:** price chance + 35% × (form rate − price chance). Markets are hard to beat, so Flow only
   moves part of the way toward form. `FORM_WEIGHT` will be tuned once tracked results build up.
4. **Value:** estimate − price chance, in percentage points. +3 or more is a good price, 0 to 3 a small edge,
   below 0 priced in.

## Watch

A play gets Watch when any of these hold: fewer than 8 games this season, fewer than 7 of the last 10 played,
a price older than 3 hours, listed questionable, or no news source confirmed the context.

## Team markets (moneyline, spread, total)

Past cover rates against today's line are misleading, because every past game had its own line and opponent. So
team markets get their form rate from a matchup model in `packages/core/src/matchup.ts`:

- **Team strength** = average margin, half last 10 and half season.
- **Expected margin** = 0.7 × (team strength − opponent strength) ± home edge (NBA 2.5, NFL 1.5, NHL 0.25).
- **Expected total** = the average of both teams' game totals, half last 10 and half season.
- The chance comes from a normal curve around that number (margin spread: NBA 12, NFL 13.5, NHL 2.3 goals;
  total spread: NBA 18, NFL 13.5, NHL 2.2 goals). It then goes through the same market blend as props.

The Flow Signal for team markets is recent form against today's number, blended with this model's chance.
