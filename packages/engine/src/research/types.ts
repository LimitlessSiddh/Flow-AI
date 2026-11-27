import { z } from "zod";

export const ResearchResult = z.object({
  availability: z.object({
    status: z.enum(["ok", "questionable", "out", "unknown"]),
    text: z.string().min(1).max(400),
  }),
  read: z.string().min(1).max(700),
  counter: z.string().min(1).max(500),
  context: z
    .array(z.object({ label: z.string().max(60), recent: z.number(), season: z.number() }))
    .max(4)
    .default([]),
  sources: z
    .array(
      z.object({
        publisher: z.string().min(1).max(80),
        title: z.string().min(1).max(200),
        url: z.string().url(),
        corroborated: z.boolean().default(false),
      }),
    )
    .max(6)
    .default([]),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

export interface ResearchFacts {
  league: string;
  game: string; // "BOS @ ORL, 7:00 PM ET"
  market: string; // "Marcus Hale, Points Over 26.5"
  subject: string;
  team?: string;
  price: string; // "-115 at Betway"
  form: string; // computed, plain sentence
  signal: number | null;
  value: number | null;
}

export interface ResearchProvider {
  name: string;
  research(facts: ResearchFacts, signal?: AbortSignal): Promise<ResearchResult>;
}

export function buildPrompt(f: ResearchFacts): string {
  return `You are the research step of Flow, a sports betting research tool. Flow never places bets.

Play: ${f.market}
League: ${f.league}. Game: ${f.game}. Price: ${f.price}.
Flow already computed these numbers from official game logs. Do not change or recompute them:
${f.form}
Flow Signal: ${f.signal ?? "not enough games"}. Bet value: ${f.value == null ? "not estimated" : f.value.toFixed(1) + " percentage points"}.

Search the web now for:
1. Availability: is ${f.subject} expected to play? Latest injury report or team news from today or yesterday.
2. Role or context changes that explain the recent form (minutes, line or unit changes, starters out, opponent news).
3. The strongest honest reason this play might NOT hit.

Rules:
- Use only reputable sources (league sites, team sites, ESPN, The Athletic, major outlets, official injury reports). Include each URL you used.
- Mark a source "corroborated": true only if another independent source says the same thing.
- Never invent statistics. If you can't find news, say so plainly and use status "unknown".
- Plain language, short sentences, for an 18 to 30 year old bettor. No hype, no betting advice.
- "read" is 2 to 3 sentences explaining why this play showed up. "counter" is 1 to 2 sentences.

Reply with ONLY a JSON object, no other text:
{"availability":{"status":"ok|questionable|out|unknown","text":"..."},"read":"...","counter":"...","context":[{"label":"...","recent":0,"season":0}],"sources":[{"publisher":"...","title":"...","url":"https://...","corroborated":false}]}`;
}

/** Pull the first JSON object out of model text (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in the research reply");
  return JSON.parse(body.slice(start, end + 1));
}
