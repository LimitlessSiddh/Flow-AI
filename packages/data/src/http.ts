import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class SourceError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface FetchOptions {
  /** Cache the body on disk for this many seconds. 0 = no cache. */
  ttl?: number;
  timeoutMs?: number;
  retries?: number;
  /** Called with response headers (used for Odds API credit counts). */
  onHeaders?: (h: Headers) => void;
}

let cacheDir: string | null = null;
export function setCacheDir(dir: string | null) {
  cacheDir = dir;
}

const USER_AGENT = "flow-research/0.1 (personal research tool)";

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { ttl = 0, timeoutMs = 15000, retries = 2 } = opts;
  const key = cacheDir && ttl > 0 ? join(cacheDir, hashKey(url) + ".json") : null;
  if (key) {
    const hit = await readCache(key, ttl);
    if (hit !== undefined) return hit as T;
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      opts.onHeaders?.(res.headers);
      if (res.status === 404) throw new SourceError(`Not found`, redact(url), 404);
      if (res.status === 401 || res.status === 403)
        throw new SourceError(`Refused (${res.status})`, redact(url), res.status);
      if (res.status === 429 || res.status >= 500) throw new SourceError(`HTTP ${res.status}`, redact(url), res.status);
      if (!res.ok) throw new SourceError(`HTTP ${res.status}`, redact(url), res.status);
      const body = (await res.json()) as T;
      if (key) await writeCache(key, body);
      return body;
    } catch (e) {
      lastErr = e;
      const status = e instanceof SourceError ? e.status : undefined;
      if (status && status < 500 && status !== 429) break; // not worth retrying
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  if (lastErr instanceof SourceError) throw lastErr;
  const cause = lastErr instanceof Error ? (lastErr.cause as { code?: string } | undefined)?.code : undefined;
  const text = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new SourceError(cause ? `${text} (${cause})` : text, redact(url));
}

/** Never log API keys. */
export function redact(url: string): string {
  return url.replace(/(apiKey=)[^&]+/i, "$1***");
}

function hashKey(s: string) {
  return createHash("sha1").update(s).digest("hex");
}

async function readCache(path: string, ttl: number): Promise<unknown> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { at: number; body: unknown };
    if (Date.now() - raw.at < ttl * 1000) return raw.body;
  } catch {
    /* miss */
  }
  return undefined;
}

async function writeCache(path: string, body: unknown) {
  if (!cacheDir) return;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, JSON.stringify({ at: Date.now(), body }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run async work with a concurrency limit, to be polite to free sources. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}
