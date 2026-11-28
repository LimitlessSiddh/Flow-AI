import { MODEL_VERSION } from "@flow/core";
import { and, eq, playHistory, plays as playsT, type Db, type NewHistory } from "@flow/db";
import { getBoard, type BoardOptions } from "../board.js";

/**
 * Copy the day's board into play_history, so every play Flow showed is kept for grading.
 * Only plays whose game hasn't started are written: once a game starts its snapshot is final, so later scans
 * or price edits can't rewrite what Flow said before the game. Plays a later pre-game scan dropped are kept,
 * marked off the board, and left out of the record.
 * Returns how many plays were written.
 */
export function snapshotDate(db: Db, date: string, o: BoardOptions, now = new Date()): number {
  const board = getBoard(db, date, o);
  const games = new Map(board.games.map((g) => [g.id, g]));
  const notStarted = (gameId: string) => {
    const g = games.get(gameId);
    return !!g && g.status === "scheduled" && Date.parse(g.startTime) > now.getTime();
  };
  const subjectIds = new Map(
    db
      .select({ id: playsT.id, subjectId: playsT.subjectId })
      .from(playsT)
      .where(eq(playsT.date, date))
      .all()
      .map((r) => [r.id, r.subjectId]),
  );
  const at = now.toISOString();
  let written = 0;
  db.transaction((tx) => {
    const seen = new Set<string>();
    for (const p of board.plays) {
      if (!notStarted(p.gameId)) continue;
      seen.add(p.id);
      const row: NewHistory = {
        playId: p.id,
        date: p.date,
        gameId: p.gameId,
        league: p.league,
        kind: p.kind,
        subject: p.subject,
        subjectId: subjectIds.get(p.id) ?? null,
        team: p.team,
        stat: p.stat,
        side: p.side,
        line: p.line,
        lineSource: p.lineSource,
        startTime: games.get(p.gameId)!.startTime,
        signal: p.signal,
        model: p.model,
        estimate: p.estimate,
        value: p.value,
        odds: p.price?.odds ?? null,
        book: p.price?.book ?? null,
        bookTitle: p.price?.bookTitle ?? null,
        priceOrigin: p.price?.origin ?? null,
        quality: p.quality,
        watchCount: p.watch.length,
        origin: p.origin,
        modelVersion: MODEL_VERSION,
        onBoard: true,
        firstSeenAt: at,
        snapshotAt: at,
      };
      const { firstSeenAt: _keep, ...update } = row;
      tx.insert(playHistory)
        .values(row)
        .onConflictDoUpdate({ target: playHistory.playId, set: update })
        .run();
      written++;
    }
    const stored = tx
      .select({ id: playHistory.playId, gameId: playHistory.gameId })
      .from(playHistory)
      .where(and(eq(playHistory.date, date), eq(playHistory.onBoard, true)))
      .all();
    for (const r of stored) {
      if (seen.has(r.id) || !notStarted(r.gameId)) continue;
      tx.update(playHistory)
        .set({ onBoard: false, snapshotAt: at })
        .where(eq(playHistory.playId, r.id))
        .run();
    }
  });
  return written;
}
