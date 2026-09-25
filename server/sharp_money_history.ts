/**
 * Clubhouse IQ — Sharp Money History
 * ═══════════════════════════════════
 * Sharp/soft-book comparisons (server/sharp_money.ts) only exist while a
 * market is open — once a game starts, those books close the market and the
 * live feed no longer has anything to show. This module periodically
 * persists a copy of the live Sharp Money data to Postgres so that a
 * "closing" snapshot (the last capture taken before the game started)
 * remains available afterward — letting Previous Day render the same chart
 * with real historical numbers instead of hiding it.
 *
 * Storage follows the same raw-SQL pattern used elsewhere in server/db.ts
 * (bts_picks, ml_data_store, etc.) rather than the (currently unused,
 * in-memory) drizzle/storage.ts layer, since this needs to survive redeploys.
 */

import { db } from "./db";
import { fetchSharpMoneyAllSports, normalize, type SharpGameData } from "./sharp_money";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
export const etDateStr = (d: Date): string => ET_DATE_FMT.format(d);

function gameKey(g: Pick<SharpGameData, "sport" | "homeTeam" | "awayTeam">): string {
  return `${g.sport}:${normalize(g.homeTeam)}:${normalize(g.awayTeam)}`;
}

/** Fetch the current live Sharp Money data and persist one snapshot row per
 * game. Safe to call on a timer — cheap upserts, and rows are pruned after
 * 10 days by the migration in db.ts. Never throws; logs and returns on error
 * so a snapshot failure never takes down the interval loop. */
export async function captureSharpMoneySnapshot(): Promise<void> {
  try {
    const games = await fetchSharpMoneyAllSports();
    if (!games.length) return;
    for (const g of games) {
      try {
        await db.query(
          `INSERT INTO sharp_money_snapshots (game_key, sport, home_team, away_team, start_time, data)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [gameKey(g), g.sport, g.homeTeam, g.awayTeam, g.startTime, JSON.stringify(g)],
        );
      } catch (e: any) {
        console.warn(`[SharpMoneyHistory] snapshot insert failed for ${g.sport} ${g.awayTeam}@${g.homeTeam}: ${e.message}`);
      }
    }
    console.log(`[SharpMoneyHistory] captured ${games.length} snapshots`);
  } catch (e: any) {
    console.warn(`[SharpMoneyHistory] capture failed: ${e.message}`);
  }
}

/** Start the periodic capture job. Call once at server boot. */
export function startSharpMoneyHistoryJob(intervalMs = 20 * 60 * 1000): void {
  captureSharpMoneySnapshot().catch(() => {});
  setInterval(() => captureSharpMoneySnapshot().catch(() => {}), intervalMs);
}

/** Closing (last pre-game) snapshot for every game whose ET calendar day
 * matches `targetET` ("YYYY-MM-DD"). For each distinct game, picks the most
 * recent capture whose captured_at is at or before that game's start_time —
 * i.e. the market picture right before the game began, not a stale one from
 * days earlier or one accidentally taken mid-game. */
export async function getSharpMoneyHistoryForDay(targetET: string): Promise<{ games: SharpGameData[]; asOf: string | null }> {
  // Widen the SQL window to target date ± 1 day (covers UTC/ET offset), then
  // filter precisely in JS with the same etDateStr() used by /api/line-movement
  // so "day" means exactly the same thing everywhere in the app.
  const rows = await db.query(
    `SELECT DISTINCT ON (game_key) game_key, sport, home_team, away_team, start_time, captured_at, data
     FROM sharp_money_snapshots
     WHERE start_time >= ($1::date - INTERVAL '1 day') AND start_time <= ($1::date + INTERVAL '2 days')
       AND captured_at <= start_time
     ORDER BY game_key, captured_at DESC`,
    [targetET],
  );

  const games: SharpGameData[] = [];
  let latestCapture: Date | null = null;
  for (const row of rows.rows as any[]) {
    if (!row.start_time || etDateStr(new Date(row.start_time)) !== targetET) continue;
    games.push(row.data as SharpGameData);
    const capturedAt = new Date(row.captured_at);
    if (!latestCapture || capturedAt > latestCapture) latestCapture = capturedAt;
  }
  games.sort((a, b) => b.sharpScore - a.sharpScore);
  return { games, asOf: latestCapture ? latestCapture.toISOString() : null };
}
