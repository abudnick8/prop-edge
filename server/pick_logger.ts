/**
 * Clubhouse IQ — Pick Logger
 * ══════════════════════════
 * Called after every scanner run to snapshot high-confidence picks
 * into ml_data/pick_snapshots.json for the auto-grader to grade later.
 *
 * Only logs picks that:
 *  - Have a gameTime (so the grader knows when to check)
 *  - Are team bets (spread/total/moneyline) — player props need box scores
 *  - Haven't already been logged (deduped by bet id)
 */

import fs from "fs";
import path from "path";

const DATA_DIR      = path.join(process.cwd(), "server", "ml_data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "pick_snapshots.json");

type PickSnapshot = {
  betId:           string;
  title:           string;
  sport:           string;
  betType:         string;
  homeTeam:        string | null;
  awayTeam:        string | null;
  playerName:      string | null;
  statCategory:    string | null;
  line:            number | null;
  pickSide:        string | null;    // "home" | "away" | "over" | "under"
  confidenceScore: number | null;
  formEdgePct:     number | null;
  hitRate:         number | null;
  edgeScore:       number | null;
  edgeGrade:       string | null;
  edgeSizing:      string | null;
  gameTime:        string | null;    // ISO string
  loggedAt:        string;
};

function loadSnapshots(): PickSnapshot[] {
  if (!fs.existsSync(SNAPSHOT_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as PickSnapshot[];
  } catch {
    return [];
  }
}

function saveSnapshots(snaps: PickSnapshot[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snaps, null, 2));
}

export function logPicks(bets: any[]): void {
  const existing = loadSnapshots();
  const existingIds = new Set(existing.map(s => s.betId));

  const now = new Date().toISOString();
  let added = 0;

  for (const bet of bets) {
    // Skip if already logged
    if (existingIds.has(bet.id)) continue;

    // Must have a gameTime to be gradeable
    if (!bet.gameTime) continue;

    // Skip futures/season props (no single game result)
    const btype = (bet.betType || "").toLowerCase();
    if (btype === "futures" || btype === "season_prop") continue;

    // Infer pickSide from available fields
    let pickSide: string | null = null;
    if (bet.pickSide) {
      pickSide = String(bet.pickSide).toLowerCase();
    } else if (btype === "total") {
      // For totals, infer from whether we like over or under
      // formEdgePct > 0 = over, < 0 = under
      const fe = bet.formEdgePct ?? 0;
      pickSide = fe >= 0 ? "over" : "under";
    } else if (btype === "spread" || btype === "moneyline") {
      // Default: if confidenceScore > 50 pick is on the team flagged in title
      // We'll store raw and let the grader figure it out
      pickSide = bet.pickTeam
        ? (bet.pickTeam === bet.homeTeam ? "home" : "away")
        : null;
    }

    const snap: PickSnapshot = {
      betId:           bet.id,
      title:           bet.title || "",
      sport:           (bet.sport || "").toUpperCase(),
      betType:         btype,
      homeTeam:        bet.homeTeam   ?? null,
      awayTeam:        bet.awayTeam   ?? null,
      playerName:      bet.playerName ?? null,
      statCategory:    bet.statCategory ?? null,
      line:            bet.line        ?? null,
      pickSide,
      confidenceScore: bet.confidenceScore ?? null,
      formEdgePct:     bet.formEdgePct     ?? null,
      hitRate:         bet.hitRate         ?? null,
      edgeScore:       bet.edgeScore       ?? null,
      edgeGrade:       bet.edgeGrade       ?? null,
      edgeSizing:      bet.edgeSizing      ?? null,
      gameTime:        bet.gameTime instanceof Date
                         ? bet.gameTime.toISOString()
                         : (bet.gameTime ? String(bet.gameTime) : null),
      loggedAt:        now,
    };

    existing.push(snap);
    existingIds.add(bet.id);
    added++;
  }

  if (added > 0) {
    // Cap at 2000 most recent snapshots to keep file size manageable
    const trimmed = existing.slice(-2000);
    saveSnapshots(trimmed);
    console.log(`[PickLogger] Logged ${added} new picks (total: ${trimmed.length})`);
  }
}
