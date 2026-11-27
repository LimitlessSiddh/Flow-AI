import type { Board, DaySummary, Meta, PlayDetail, ScanStatus } from "@flow/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError("Can't reach Flow's backend. Is `pnpm dev` running?", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

const json = (b: unknown) => JSON.stringify(b);

export const api = {
  meta: () => req<Meta>("/api/meta"),
  board: (date: string) => req<Board>(`/api/board?date=${date}`),
  dates: (from: string, to: string) => req<DaySummary[]>(`/api/dates?from=${from}&to=${to}`),
  play: (id: string) => req<PlayDetail>(`/api/plays/${encodeURIComponent(id)}`),
  setState: (id: string, patch: Partial<{ saved: boolean; dismissed: boolean; tracked: boolean }>) =>
    req<{ ok: true }>(`/api/plays/${encodeURIComponent(id)}/state`, { method: "PATCH", body: json(patch) }),
  setPrice: (id: string, odds: string, line?: number | null) =>
    req<PlayDetail>(`/api/plays/${encodeURIComponent(id)}/price`, {
      method: "PUT",
      body: json({ odds, line }),
    }),
  clearPrice: (id: string) =>
    req<PlayDetail>(`/api/plays/${encodeURIComponent(id)}/price`, { method: "DELETE" }),
  addPlay: (b: {
    date: string;
    league: string;
    player: string;
    stat: string;
    side: string;
    line: number;
    odds: string;
  }) => req<PlayDetail>("/api/plays", { method: "POST", body: json(b) }),
  scan: (date: string) =>
    req<{ id: string | null; date: string }>("/api/scan", { method: "POST", body: json({ date }) }),
  scanStatus: (id: string) => req<ScanStatus>(`/api/scan/${id}`),
  settle: (date: string) => req<{ settled: number }>("/api/settle", { method: "POST", body: json({ date }) }),
  saveSettings: (s: Partial<{ oddsFormat: "american" | "decimal"; theme: string }>) =>
    req<{ ok: true }>("/api/settings", { method: "PUT", body: json(s) }),
};
