import type { Express, Request, Response } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { runScan, fetchLivePrices, computeSharpMoneyScore, tagUrgency } from "./scanner";
import { broadcast } from "./ws";
import axios from "axios";
import * as cheerio from "cheerio";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { startSmartWalletTracker, getSmartWallets, getSignalMap, getSignalForMarket } from "./smart-wallets";
import * as fs from "fs";
import { loadMLWeights, applyMLWeights } from "./ml-weights";
import { logPicks } from "./pick_logger";
import { fetchSharpMoneyAllSports, fetchSharpMoneyBySport, fetchSharpMoneyForGame } from "./sharp_money";
import { db } from "./db";
import { signJWT, verifyJWT, hashPIN, checkPIN, isValidPIN, isValidEmail } from "./auth";
import { requireAuth, requireBasic, requirePro, requireOwner } from "./middleware";
import { sendPINResetEmail, sendWelcomeEmail, sendNewSignupNotification, SUPPORT_EMAIL } from "./email";
import crypto from "crypto";
import {
  initMlbAnalytics,
  getBatterAnalytics,
  getProjectedGameStats,
  getSteamerBatter,
  getSteamerPitcher,
  getParkFactor,
  getBvpExtended,
  getStadiumWeather,
  getPitcherAnalytics,
  computeAnalyticsBoost,
} from "./mlb-analytics";
import { registerPlayerIntelRoutes } from "./player-intel-routes";
// No payment integration — accounts are free to create, tier managed by owner

// ── ML Engine helpers (pure TypeScript — no Python dependency) ───────────────
const ML_DATA_DIR      = path.join(__dirname, "ml_data");
const ML_WEIGHTS_FILE  = path.join(ML_DATA_DIR, "ml_weights.json");
const ML_INSIGHTS_FILE = path.join(ML_DATA_DIR, "ml_insights.json");
const ML_OUTCOME_LOG   = path.join(ML_DATA_DIR, "bet_outcome_log.json");
const ML_GRADED_IDS    = path.join(ML_DATA_DIR, "graded_ids.json");
const ML_SNAPSHOT_FILE = path.join(ML_DATA_DIR, "pick_snapshots.json");
const BTS_PICKS_FILE   = path.join(ML_DATA_DIR, "bts_picks.json");

if (!fs.existsSync(ML_DATA_DIR)) fs.mkdirSync(ML_DATA_DIR, { recursive: true });
loadMLWeights(); // boot-time load; refreshed after runMLEngine()

// ── ML helpers ────────────────────────────────────────────────────────────────
function mlLoadJSON(filePath: string, def: any = []): any {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : def; }
  catch { return def; }
}

// Writes to local disk AND upserts into Postgres ml_data_store.
// Postgres is the authoritative backup — survives Railway redeploys
// without needing GITHUB_TOKEN.
function mlSaveJSON(filePath: string, data: any): void {
  const json = JSON.stringify(data, null, 2);
  // 1. Local disk (fast, used during same process lifetime)
  try { fs.writeFileSync(filePath, json); } catch { /* non-fatal */ }
  // 2. Postgres (persistent across redeploys)
  const filename = path.basename(filePath);
  db.query(
    `INSERT INTO ml_data_store (filename, content, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (filename) DO UPDATE
       SET content = EXCLUDED.content, updated_at = NOW()`,
    [filename, json]
  ).catch((e: any) => console.warn(`[ML] DB save failed for ${filename}:`, e.message));
}

// Pull all ML files from Postgres into local disk on startup.
// Falls back silently if DB not available or row missing.
async function mlPullFromDB(): Promise<void> {
  const files = [
    "bet_outcome_log.json", "pick_snapshots.json", "ml_weights.json",
    "ml_insights.json", "graded_ids.json", "bts_picks.json",
    "bts_ml_weights.json", "bts_ml_learning_log.json",
  ];
  let pulled = 0;
  for (const filename of files) {
    try {
      const row = await db.queryOne(
        `SELECT content, updated_at FROM ml_data_store WHERE filename = $1`,
        [filename]
      );
      if (!row) continue;
      const filepath = path.join(ML_DATA_DIR, filename);
      // Only overwrite local file if DB version is newer or local doesn't exist
      let localMtime = 0;
      try { localMtime = fs.statSync(filepath).mtimeMs; } catch { /* doesn't exist */ }
      const dbTime = new Date(row.updated_at).getTime();
      if (dbTime >= localMtime || !fs.existsSync(filepath)) {
        fs.mkdirSync(ML_DATA_DIR, { recursive: true });
        fs.writeFileSync(filepath, row.content, "utf-8");
        pulled++;
        console.log(`[ML-DB] ✓ Restored ${filename} from Postgres (${Math.round(row.content.length/1024)}KB)`);
      }
    } catch (e: any) {
      console.warn(`[ML-DB] Could not pull ${filename}:`, e.message);
    }
  }
  if (pulled > 0) console.log(`[ML-DB] Restored ${pulled} ML files from Postgres`);
  else console.log(`[ML-DB] No newer ML files in Postgres — using existing disk files`);
}

// Log a graded outcome (pure TS, no Python)
function logMLOutcome(record: Record<string, any>): void {
  try {
    const outcomes: any[] = mlLoadJSON(ML_OUTCOME_LOG, []);
    const idx = outcomes.findIndex((r: any) => r.betId === record.betId);
    if (idx >= 0) { outcomes[idx] = { ...outcomes[idx], ...record }; }
    else { outcomes.push(record); }
    mlSaveJSON(ML_OUTCOME_LOG, outcomes);
  } catch (e: any) { console.warn("[ML] logMLOutcome error:", e.message); }
}

// ── Auto Grader (ported from auto_grader.py) ──────────────────────────────────
const SPORT_ESPN_MAP: Record<string, [string, string]> = {
  NBA: ["basketball", "nba"],
  MLB: ["baseball",   "mlb"],
  NHL: ["hockey",     "nhl"],
  NFL: ["football",   "nfl"],
};
const STAT_MAP: Record<string, Record<string, [string, string]>> = {
  NBA: {
    PTS:["PTS","int"],POINTS:["PTS","int"],REB:["REB","int"],REBOUNDS:["REB","int"],
    AST:["AST","int"],ASSISTS:["AST","int"],STL:["STL","int"],STEALS:["STL","int"],BLK:["BLK","int"],
    BLOCKS:["BLK","int"],TO:["TO","int"],TURNOVERS:["TO","int"],
    "3PM":["3PT","fraction_left"],THREE_POINTERS_MADE:["3PT","fraction_left"],THREES:["3PT","fraction_left"],
    "PTS+REB+AST":["PTS+REB+AST","combo"],PRA:["PTS+REB+AST","combo"],
    "PTS+REB":["PTS+REB","combo"],"PTS+AST":["PTS+AST","combo"],"REB+AST":["REB+AST","combo"],
  },
  MLB: {
    H:["H","int"],HITS:["H","int"],HR:["HR","int"],HOME_RUNS:["HR","int"],
    RBI:["RBI","int"],RUNS_BATTED_IN:["RBI","int"],RBIS:["RBI","int"],
    R:["R","int"],RUNS:["R","int"],RUNS_SCORED:["R","int"],
    BB:["BB","int"],WALKS:["BB","int"],K:["K","int"],SO:["K","int"],
    STRIKEOUTS_BATTER:["K","int"],"1B":["1B","int"],SINGLES:["1B","int"],
    "2B":["2B","int"],DOUBLES:["2B","int"],"3B":["3B","int"],TRIPLES:["3B","int"],
    SB:["SB","int"],STOLEN_BASES:["SB","int"],STOLEN_BASE:["SB","int"],
    TB:["TB","int"],TOTAL_BASES:["TB","int"],
    // HRR = Hits + Runs + RBI (DraftKings combined stat)
    HRR:["H+R+RBI","combo"],HITTER_HITS_PLUS_RUNS_PLUS_RUNS_BATTED_IN:["H+R+RBI","combo"],
    // Pitcher stats
    IP:["IP","float"],PITCHER_OUTS:["IP","float"],OUTS:["OUT","int"],
    ER:["ER","int"],EARNED_RUNS:["ER","int"],STRIKEOUTS:["K","int"],
    PITCHING_K:["K","int"],PITCHER_K:["K","int"],PITCHER_STRIKEOUTS:["K","int"],
    HITS_ALLOWED:["H","int"],PITCHER_HITS:["H","int"],
    WALKS_ALLOWED:["BB","int"],PITCHER_BB:["BB","int"],ERA:["ERA","float"],
  },
  NHL: {
    G:["G","int"],GOALS:["G","int"],A:["A","int"],ASSISTS:["A","int"],
    PTS:["G+A","combo"],POINTS:["G+A","combo"],SOG:["SOG","int"],
    SHOTS:["SOG","int"],SHOTS_ON_GOAL:["SOG","int"],"+/-":["+/-","int"],
  },
  NFL: {
    PASS_YDS:["YDS","int"],PASSING_YARDS:["YDS","int"],
    RUSH_YDS:["YDS","int"],RUSHING_YARDS:["YDS","int"],
    REC:["REC","int"],RECEPTIONS:["REC","int"],
    REC_YDS:["YDS","int"],RECEIVING_YARDS:["YDS","int"],
    TD:["TD","combo"],TOUCHDOWNS:["TD","combo"],
    INT:["INT","int"],COMPLETIONS:["C/ATT","fraction_left"],
    SACKS:["SACKS","float"],TACKLES:["TOT","int"],
  },
};
const NFL_GROUPS: Record<string, string> = {
  PASS_YDS:"passing",PASSING_YARDS:"passing",
  RUSH_YDS:"rushing",RUSHING_YARDS:"rushing",
  REC_YDS:"receiving",RECEIVING_YARDS:"receiving",REC:"receiving",RECEPTIONS:"receiving",
};

function mlLastWord(s: string): string { const p = s.trim().toLowerCase().split(/\s+/); return p[p.length-1]||"";
}
function mlTeamsMatch(a: string, b: string): boolean {
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
  if (a === b) return true;
  const al = mlLastWord(a), bl = mlLastWord(b);
  if (al === bl && al.length > 3) return true;
  if (a.length > 4 && b.includes(a)) return true;
  if (b.length > 4 && a.includes(b)) return true;
  return false;
}
function mlPlayerMatch(a: string, b: string): boolean {
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
  if (a === b) return true;
  const al = a.split(/\s+/).pop()!, bl = b.split(/\s+/).pop()!;
  if (al === bl && al.length > 3) return true;
  if (a.length > 4 && b.includes(a)) return true;
  if (b.length > 4 && a.includes(b)) return true;
  const ap = a.split(/\s+/), bp = b.split(/\s+/);
  if (ap.length >= 2 && bp.length >= 2 && ap[ap.length-1] === bp[bp.length-1] && ap[0][0] === bp[0][0]) return true;
  return false;
}
function mlParseStatValue(raw: string|null|undefined, mode: string): number|null {
  if (raw == null || raw === "--" || raw === "") return null;
  const s = String(raw).trim();
  try {
    if (mode === "fraction_left") {
      for (const sep of ["/", "-"]) { if (s.includes(sep)) return parseFloat(s.split(sep)[0]); }
      return parseFloat(s);
    }
    return parseFloat(s);
  } catch { return null; }
}
function mlDetectNFLGroup(labels: string[], keys: string[]): string|null {
  const ls = labels.join(" ").toLowerCase(), ks = keys.join(" ").toLowerCase();
  if (ks.includes("passing") || (ls.includes("c/att") && ls.includes("yds") && ls.includes("int"))) return "passing";
  if (ks.includes("rushing") || (ls.includes("car") && ls.includes("yds") && ls.includes("avg"))) return "rushing";
  if (ks.includes("receiving") || (ls.includes("rec") && ls.includes("yds") && ls.includes("tgts"))) return "receiving";
  if (ks.includes("tackle") || (ls.includes("tot") && ls.includes("solo"))) return "defense";
  return null;
}
function mlExtractCombo(comboKey: string, labels: string[], stats: string[]): number|null {
  const parts = comboKey.split("+").map(p => p.trim().toUpperCase());
  let total = 0, found = false;
  for (const part of parts) {
    const idx = labels.indexOf(part);
    if (idx >= 0 && idx < stats.length) { const v = mlParseStatValue(stats[idx], "int"); if (v != null) { total += v; found = true; } }
  }
  return found ? total : null;
}
/**
 * Returns true if the player appears anywhere in the ESPN box score —
 * regardless of whether a specific stat column exists for them.
 * A DNP / scratched / inactive player will NOT appear in any stats group.
 * This is used to distinguish "player not found" (DNP → void)
 * from "player found but stat column missing" (data gap → don't void).
 */
function mlPlayerInBoxScore(summary: any, playerName: string): boolean {
  const teamsData = summary?.boxscore?.players || [];
  for (const teamData of teamsData) {
    for (const group of (teamData.statistics || [])) {
      for (const ae of (group.athletes || [])) {
        const name = ae?.athlete?.displayName || "";
        if (mlPlayerMatch(name, playerName)) return true;
      }
    }
  }
  // Also check lineScore / inactive lists if ESPN includes them
  const inactive = summary?.boxscore?.teams
    ?.flatMap((t: any) => t.roster ?? []) ?? [];
  for (const p of inactive) {
    const name = p?.athlete?.displayName || p?.displayName || "";
    if (mlPlayerMatch(name, playerName)) {
      // Player is on the roster/inactive list but has NO stats → confirmed DNP
      return false;
    }
  }
  return false;
}

function mlExtractPlayerStat(summary: any, sport: string, playerName: string, statCategory: string): number|null {
  const catKey = statCategory.toUpperCase().replace(/[\s-]/g, "_");
  const sportMap = STAT_MAP[sport] || {};
  let entry = sportMap[catKey];
  if (!entry) {
    for (const [k, v] of Object.entries(sportMap)) { if (k.includes(catKey) || catKey.includes(k)) { entry = v; break; } }
  }
  if (!entry) return null;
  const [espnKey, mode] = entry;
  const isCombo = mode === "combo";
  const teamsData = summary?.boxscore?.players || [];
  for (const teamData of teamsData) {
    for (const group of (teamData.statistics || [])) {
      const labels = (group.labels || []).map((l: string) => l.toUpperCase());
      const keys   = group.keys || [];
      const groupType = mlDetectNFLGroup(labels, keys);
      for (const ae of (group.athletes || [])) {
        const name = ae?.athlete?.displayName || "";
        if (!mlPlayerMatch(name, playerName)) continue;
        const stats = ae.stats || [];
        if (!stats.length) continue;
        if (isCombo) { const v = mlExtractCombo(espnKey, labels, stats); if (v != null) return v; continue; }
        if (sport === "NFL") { const req = NFL_GROUPS[catKey]; if (req && groupType && req !== groupType) continue; }
        const idx = labels.indexOf(espnKey.toUpperCase());
        if (idx >= 0 && idx < stats.length) { const v = mlParseStatValue(stats[idx], mode); if (v != null) return v; }
      }
    }
  }
  return null;
}
async function mlFetchESPN(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}
async function mlFetchScoreboard(sport: string, dateStr: string): Promise<any[]> {
  const [sn, lg] = SPORT_ESPN_MAP[sport] || [];
  if (!sn) return [];
  try {
    const d = await mlFetchESPN(`https://site.api.espn.com/apis/site/v2/sports/${sn}/${lg}/scoreboard?dates=${dateStr}`);
    return d.events || [];
  } catch { return []; }
}
async function mlFetchCompletedGames(sport: string, dateStr: string): Promise<any[]> {
  const events = await mlFetchScoreboard(sport, dateStr);
  const results: any[] = [];
  for (const ev of events) {
    const comp = (ev.competitions||[{}])[0];
    if (!comp.status?.type?.completed) continue;
    const home = comp.competitors?.find((c: any) => c.homeAway === "home");
    const away = comp.competitors?.find((c: any) => c.homeAway === "away");
    if (!home || !away) continue;
    const hs = parseInt(home.score||"0",10), as_ = parseInt(away.score||"0",10);
    if (isNaN(hs)||isNaN(as_)) continue;
    results.push({ gameId: ev.id, espnId: ev.id, home: home.team?.displayName||"", away: away.team?.displayName||"", homeScore: hs, awayScore: as_, date: dateStr });
  }
  return results;
}
async function mlFetchGameSummary(sport: string, espnId: string): Promise<any|null> {
  const [sn, lg] = SPORT_ESPN_MAP[sport] || [];
  if (!sn) return null;
  try { return await mlFetchESPN(`https://site.api.espn.com/apis/site/v2/sports/${sn}/${lg}/summary?event=${espnId}`); }
  catch { return null; }
}
function mlFindGame(scores: any[], home: string, away: string): any|null {
  for (const g of scores) {
    const hm = mlTeamsMatch(g.home, home)||mlTeamsMatch(g.home, away);
    const am = mlTeamsMatch(g.away, away)||mlTeamsMatch(g.away, home);
    if (hm && am) return g;
  }
  for (const g of scores) {
    if (mlTeamsMatch(g.home, home)||mlTeamsMatch(g.away, home)||mlTeamsMatch(g.home, away)||mlTeamsMatch(g.away, away)) return g;
  }
  return null;
}
function mlGradeTeamBet(snap: any, game: any): string|null {
  const betType = (snap.betType||snap.bet_type||"").toLowerCase();
  const line    = snap.line != null ? parseFloat(snap.line) : null;
  const titleUp = (snap.title||"").toUpperCase();
  const rawSide = (snap.pickSide||snap.pick_side||"").toLowerCase();
  let pickSide  = rawSide;
  if (betType === "total") {
    if (/\bUNDER\b/.test(titleUp)) pickSide = "under";
    else if (/\bOVER\b/.test(titleUp)) pickSide = "over";
  }
  const { homeScore: hs, awayScore: as_ } = game;
  const total = hs + as_;
  if (["moneyline","ml"].includes(betType)) {
    if (hs === as_) return "push";
    const homeWon = hs > as_;
    if (pickSide === "home" || mlTeamsMatch(pickSide, snap.homeTeam||"")) return homeWon ? "won" : "lost";
    if (pickSide === "away" || mlTeamsMatch(pickSide, snap.awayTeam||"")) return homeWon ? "lost" : "won";
    return null;
  }
  if (betType === "spread" && line != null) {
    const margin = as_ - hs;
    const cov = margin + line;
    if (Math.abs(cov) < 0.01) return "push";
    const awayCovered = cov > 0;
    if (pickSide === "away" || mlTeamsMatch(pickSide, snap.awayTeam||"")) return awayCovered ? "won" : "lost";
    if (pickSide === "home" || mlTeamsMatch(pickSide, snap.homeTeam||"")) return awayCovered ? "lost" : "won";
    return awayCovered ? "won" : "lost";
  }
  if (betType === "total" && line != null) {
    if (Math.abs(total - line) < 0.01) return "push";
    const wentOver = total > line;
    if (pickSide === "over") return wentOver ? "won" : "lost";
    if (pickSide === "under") return wentOver ? "lost" : "won";
    return null;
  }
  return null;
}
function mlGradePlayerProp(snap: any, summary: any): string|null {
  const playerName   = snap.playerName || snap.player_name || "";
  const statCategory = snap.statCategory || snap.stat_category || "";
  const sport        = (snap.sport||"").toUpperCase();
  const line         = snap.line != null ? parseFloat(snap.line) : null;
  if (!playerName || !statCategory || line == null || isNaN(line)) return null;
  const titleUp = (snap.title||"").toUpperCase();
  let pickSide = (snap.pickSide||"").toLowerCase();
  if (!pickSide) { if (/\bUNDER\b/.test(titleUp)) pickSide = "under"; else pickSide = "over"; }
  const actual = mlExtractPlayerStat(summary, sport, playerName, statCategory);
  if (actual == null) return null;
  if (Math.abs(actual - line) < 0.01) return "push";
  const wentOver = actual > line;
  if (pickSide === "over")  return wentOver ? "won" : "lost";
  if (pickSide === "under") return wentOver ? "lost" : "won";
  return null;
}

async function runAutoGrader(): Promise<Record<string,any>> {
  const now        = new Date();
  const snapshots: any[] = mlLoadJSON(ML_SNAPSHOT_FILE, []);
  const outcomes:  any[] = mlLoadJSON(ML_OUTCOME_LOG, []);
  const gradedIds: string[] = mlLoadJSON(ML_GRADED_IDS, []);
  const gradedSet  = new Set(gradedIds);
  const existingIds = new Set(outcomes.map((r: any) => r.betId));

  const cutoffPast   = new Date(now.getTime() - 2 * 3600 * 1000);
  const cutoffFuture = new Date(now.getTime() + 24 * 3600 * 1000);

  const pending: any[] = [];
  for (const snap of snapshots) {
    const bid = snap.betId || snap.id;
    if (existingIds.has(bid) || gradedSet.has(bid)) continue;
    const gtStr = snap.gameTime || snap.game_time;
    if (!gtStr && (snap.betType||"").toLowerCase() !== "player_prop") continue;
    const gt = gtStr ? new Date(String(gtStr).replace("Z","").replace("+00:00","")) : new Date(now.getTime() - 86400000);
    if (gt > cutoffFuture) continue;
    pending.push(snap);
  }

  console.log(`[Grader] ${pending.length} picks to grade out of ${snapshots.length} snapshots`);

  let graded = 0, skippedNoGame = 0, skippedNoSummary = 0, skippedNoStat = 0, errors = 0;

  // Group by sport
  const bySport: Record<string, any[]> = {};
  for (const snap of pending) {
    const s = (snap.sport||"").toUpperCase().replace(/BASKETBALL.*|BASKETBALL/,"NBA").replace(/BASEBALL.*|BASEBALL/,"MLB").replace(/HOCKEY.*|HOCKEY/,"NHL").replace(/FOOTBALL.*|FOOTBALL/,"NFL");
    const sport = ["NBA","MLB","NHL","NFL"].find(x => s.includes(x));
    if (!sport) { skippedNoGame++; continue; }
    if (!bySport[sport]) bySport[sport] = [];
    bySport[sport].push(snap);
  }

  for (const [sport, snaps] of Object.entries(bySport)) {
    // Collect dates to fetch
    const datesNeeded = new Set<string>();
    for (let d = -3; d <= 1; d++) {
      const dt = new Date(now.getTime() + d * 86400000);
      datesNeeded.add(dt.toISOString().slice(0,10).replace(/-/g,""));
    }
    for (const snap of snaps) {
      const gtStr = snap.gameTime || snap.game_time;
      if (!gtStr) continue;
      const dt = new Date(String(gtStr).replace("Z",""));
      for (let d = -2; d <= 1; d++) {
        const shifted = new Date(dt.getTime() + d * 86400000);
        datesNeeded.add(shifted.toISOString().slice(0,10).replace(/-/g,""));
      }
    }

    const allScores: any[] = [];
    const seenIds = new Set<string>();
    for (const dateStr of [...datesNeeded].sort()) {
      const games = await mlFetchCompletedGames(sport, dateStr);
      for (const g of games) { if (!seenIds.has(g.gameId)) { seenIds.add(g.gameId); allScores.push(g); } }
    }
    console.log(`[Grader] ${sport}: ${allScores.length} completed games, ${snaps.length} picks to grade`);

    const summaryCache: Record<string, any> = {};

    for (const snap of snaps) {
      try {
        const betType = (snap.betType||"").toLowerCase();
        const home    = snap.homeTeam || "";
        const away    = snap.awayTeam || "";
        const bid     = snap.betId || snap.id;
        const gameTime = snap.gameTime || snap.game_time;

        const game = mlFindGame(allScores, home, away);
        if (!game) { skippedNoGame++; continue; }

        let result: string|null = null;
        if (["spread","total","moneyline","ml"].includes(betType)) {
          result = mlGradeTeamBet(snap, game);
        } else if (["player_prop","prop"].includes(betType)) {
          const espnId = game.espnId || game.gameId;
          if (!espnId) { skippedNoGame++; continue; }
          if (!summaryCache[espnId]) {
            await new Promise(r => setTimeout(r, 300)); // polite rate limit
            summaryCache[espnId] = await mlFetchGameSummary(sport, espnId);
          }
          const summary = summaryCache[espnId];
          if (!summary) { skippedNoSummary++; continue; }
          result = mlGradePlayerProp(snap, summary);
          if (result == null) { skippedNoStat++; continue; }
        } else { continue; }

        if (result == null) { errors++; continue; }

        const record: any = {
          betId: bid, sport, betType: snap.betType, title: snap.title||"",
          pickSide: snap.pickSide, line: snap.line,
          playerName: snap.playerName, statCategory: snap.statCategory,
          homeTeam: home, awayTeam: away,
          homeScore: game.homeScore, awayScore: game.awayScore,
          confidenceScore: snap.confidenceScore, formEdgePct: snap.formEdgePct,
          hitRate: snap.hitRate, edgeScore: snap.edgeScore, edgeGrade: snap.edgeGrade,
          gameTime, gradedAt: new Date().toISOString(), result,
          espnGameId: game.espnId || game.gameId,
        };
        outcomes.push(record);
        gradedSet.add(bid);
        graded++;
        console.log(`[Grader] ✓ ${away} @ ${home} → ${result.toUpperCase()}`);
      } catch (e: any) { errors++; console.warn("[Grader] snap error:", e.message); }
    }
  }

  mlSaveJSON(ML_OUTCOME_LOG, outcomes);
  mlSaveJSON(ML_GRADED_IDS, [...gradedSet]);
  console.log(`[Grader] Done — graded=${graded} skippedNoGame=${skippedNoGame} errors=${errors}`);
  return { graded, skippedNoGame, skippedNoSummary, skippedNoStat, errors, totalOutcomes: outcomes.length };
}

// ── ML Engine (ported from ml_engine.py) ──────────────────────────────────────
function mlRecencyWeight(gradedAt: string|null|undefined): number {
  if (!gradedAt) return 1.0;
  try {
    const daysAgo = (Date.now() - new Date(gradedAt).getTime()) / 86400000;
    return daysAgo <= 30 ? 2.0 : daysAgo <= 90 ? 1.5 : 1.0;
  } catch { return 1.0; }
}
function mlExtractFeatures(bet: any): Record<string,any> {
  const sport    = (bet.sport||"unknown").toUpperCase();
  const betType  = (bet.betType||bet.bet_type||"unknown").toLowerCase();
  let conf       = parseFloat(bet.confidenceScore||bet.confidence_score||"50") || 50;
  const formEdge = parseFloat(bet.formEdgePct||bet.form_edge_pct||"0") || 0;
  const hitRate  = parseFloat(bet.hitRate||bet.hit_rate||"0.5") || 0.5;
  const pickSide = (bet.pickSide||bet.pick_side||"").toUpperCase();
  const statCat  = (bet.statCategory||bet.stat_category||"").toUpperCase().replace(/\s+/g,"_");
  if (bet.edgeScore != null) {
    const edgeConf = Math.max(40, Math.min(95, 55 + (parseFloat(bet.edgeScore)-5)*8));
    conf = Math.round((conf*0.4 + edgeConf*0.6)*10)/10;
  }
  const confTier = conf >= 85 ? "elite" : conf >= 70 ? "high" : conf >= 55 ? "medium" : "low";
  const edgeTier = formEdge >= 20 ? "strong_over" : formEdge >= 10 ? "moderate_over" : formEdge <= -20 ? "strong_under" : formEdge <= -10 ? "moderate_under" : "flat";
  const formTier = hitRate >= 0.8 ? "hot" : hitRate >= 0.6 ? "above_avg" : hitRate >= 0.4 ? "neutral" : "cold";
  return { sport, betType: betType, confTier, edgeTier, formTier, pickSide, conf, formEdge, hitRate, statCat };
}
function runMLEngine(): Record<string,any> {
  const outcomes: any[] = mlLoadJSON(ML_OUTCOME_LOG, []);
  const graded = outcomes.filter((b: any) => ["won","lost","push"].includes(b.result));
  const now = new Date().toISOString();
  if (graded.length < 5) {
    const r = { status:"insufficient_data", message:`Need at least 5 graded outcomes. Currently have ${graded.length}.`, sample_size: graded.length, last_run: now };
    mlSaveJSON(ML_INSIGHTS_FILE, r); return r;
  }
  // Pattern accuracy
  const buckets: Record<string, {wins:number,losses:number,pushes:number,total:number}> = {};
  const bump = (key: string, result: string, w: number) => {
    if (!buckets[key]) buckets[key] = {wins:0,losses:0,pushes:0,total:0};
    buckets[key].total += w;
    if (result==="won") buckets[key].wins += w;
    else if (result==="lost") buckets[key].losses += w;
    else buckets[key].pushes += w;
  };
  for (const bet of graded) {
    const w = mlRecencyWeight(bet.gradedAt||bet.graded_at);
    const f = mlExtractFeatures(bet);
    const r = bet.result;
    const dims = [
      `sport:${f.sport}`, `bet_type:${f.betType}`, `sport:${f.sport}|bet_type:${f.betType}`,
      `conf_tier:${f.confTier}`, `edge_tier:${f.edgeTier}`, `form_tier:${f.formTier}`,
      `pick_side:${f.pickSide}`, `sport:${f.sport}|conf_tier:${f.confTier}`,
      `sport:${f.sport}|edge_tier:${f.edgeTier}`, `bet_type:${f.betType}|conf_tier:${f.confTier}`,
      `bet_type:${f.betType}|form_tier:${f.formTier}`, `sport:${f.sport}|pick_side:${f.pickSide}`,
      ...(f.statCat ? [
        `stat_category:${f.statCat}`, `sport:${f.sport}|stat_category:${f.statCat}`,
        `stat_category:${f.statCat}|conf_tier:${f.confTier}`,
        `stat_category:${f.statCat}|pick_side:${f.pickSide}`,
      ] : []),
    ];
    for (const dim of dims) bump(dim, r, w);
  }
  const patterns: Record<string,any> = {};
  for (const [key, b] of Object.entries(buckets)) {
    if (b.total < 3) continue;
    const wr = b.wins / Math.max(b.total - b.pushes, 1);
    const adj = Math.max(-25, Math.min(25, (wr - 0.5) * 50));
    patterns[key] = { wins: Math.round(b.wins*10)/10, losses: Math.round(b.losses*10)/10, total: Math.round(b.total*10)/10, win_rate: Math.round(wr*1000)/1000, weight_adj: Math.round(adj*100)/100 };
  }
  // Stats
  const bySport: Record<string,any> = {}, byType: Record<string,any> = {}, byConf: Record<string,any> = {}, weekly: Record<string,any> = {};
  let tw=0, tl=0, tp=0;
  for (const b of graded) {
    const r = b.result, sport = (b.sport||"other").toUpperCase(), btype = (b.betType||"other").toLowerCase();
    const conf = parseFloat(b.confidenceScore||"50")||50;
    const ct = conf>=85?"elite":conf>=70?"high":conf>=55?"medium":"low";
    if (r==="won") tw++; else if (r==="lost") tl++; else tp++;
    for (const [key, map] of [[sport,bySport],[btype,byType],[ct,byConf]] as [string,Record<string,any>][]) {
      if (!map[key]) map[key]={won:0,lost:0,push:0};
      if (r==="won") map[key].won++; else if (r==="lost") map[key].lost++; else map[key].push++;
    }
    const ga = b.gradedAt||b.graded_at;
    if (ga) { try { const wk = new Date(ga).toISOString().slice(0,10); if (!weekly[wk]) weekly[wk]={won:0,lost:0}; if (r==="won") weekly[wk].won++; else if (r==="lost") weekly[wk].lost++; } catch {} }
  }
  const td = tw+tl; const wr_overall = tw/Math.max(td,1);
  const roi = Math.round(((tw*90.91)-(tl*100))/Math.max(td*100,1)*1000)/10;
  const toWR = (m: Record<string,any>) => Object.fromEntries(Object.entries(m).map(([k,v]: any) => [k, {...v, win_rate: Math.round(v.won/Math.max(v.won+v.lost,1)*1000)/1000}]));
  const stats = { total: graded.length, won: tw, lost: tl, push: tp, win_rate: Math.round(wr_overall*1000)/1000, roi_est: roi, by_sport: toWR(bySport), by_type: toWR(byType), by_conf_tier: toWR(byConf), by_week: Object.entries(weekly).sort(([a],[b_])=>a<b_?-1:1).slice(-12).map(([wk,v]: any) => ({ week: wk, won: v.won, lost: v.lost, win_rate: Math.round(v.won/Math.max(v.won+v.lost,1)*1000)/1000 })) };
  // Insights
  const insights: any[] = [];
  const ranked = Object.entries(patterns).filter(([,v]: any) => v.total>=5).sort(([,a]: any,[,b_]: any) => b_.win_rate-a.win_rate);
  for (const [key, s] of ranked.slice(0,5) as any[]) {
    const pct = Math.round(s.win_rate*1000)/10;
    insights.push({ type:"strength", pattern:key, title:`${pct}% win rate — ${key.replace(/\|/g," + ").replace(/_/g," ").replace(/:/g,": ")}`, detail:`${Math.round(s.wins)}W-${Math.round(s.losses)}L (${pct}%)`, adj:s.weight_adj, icon:"✅" });
  }
  for (const [key, s] of ranked.slice(-5).reverse() as any[]) {
    const pct = Math.round(s.win_rate*1000)/10;
    if (pct < 45) insights.push({ type:"weakness", pattern:key, title:`${pct}% win rate — ${key.replace(/\|/g," + ").replace(/_/g," ").replace(/:/g,": ")}`, detail:`${Math.round(s.wins)}W-${Math.round(s.losses)}L (${pct}%)`, adj:s.weight_adj, icon:"⚠️" });
  }
  // Weights
  const getAdj = (k: string) => patterns[k]?.weight_adj || 0;
  const sports2 = ["NBA","NFL","MLB","NHL"];
  const btypes2 = ["player_prop","spread","total","moneyline"];
  const ctiers2 = ["elite","high","medium","low"];
  const etiers2 = ["strong_over","moderate_over","flat","moderate_under","strong_under"];
  const ftiers2 = ["hot","above_avg","neutral","cold"];
  const combo: Record<string,number> = {};
  for (const sp of sports2) for (const ct of ctiers2) { const k=`sport:${sp}|conf_tier:${ct}`,v=getAdj(k); if (Math.abs(v)>=2) combo[k]=v; }
  for (const bt of btypes2) for (const ct of ctiers2) { const k=`bet_type:${bt}|conf_tier:${ct}`,v=getAdj(k); if (Math.abs(v)>=2) combo[k]=v; }
  const weights = {
    sport_weights:   Object.fromEntries(sports2.map(s => [s, getAdj(`sport:${s}`)])),
    bettype_weights: Object.fromEntries(btypes2.map(t => [t, getAdj(`bet_type:${t}`)])),
    conf_tier_cal:   Object.fromEntries(ctiers2.map(c => [c, getAdj(`conf_tier:${c}`)])),
    edge_tier_weights: Object.fromEntries(etiers2.map(e => [e, getAdj(`edge_tier:${e}`)])),
    form_tier_weights: Object.fromEntries(ftiers2.map(f => [f, getAdj(`form_tier:${f}`)])),
    pick_side_weights: { OVER: getAdj("pick_side:OVER"), UNDER: getAdj("pick_side:UNDER") },
    combo_weights: combo,
    overall_win_rate: stats.win_rate,
    sample_size: stats.total,
    last_run: now, version: "2.0",
  };
  mlSaveJSON(ML_WEIGHTS_FILE, weights);
  const payload = { status:"ok", last_run: now, sample_size: stats.total, accuracy: stats, patterns, insights, weights };
  mlSaveJSON(ML_INSIGHTS_FILE, payload);
  loadMLWeights();
  console.log(`[ML Engine] Done — ${stats.total} graded | ${stats.won}W-${stats.lost}L | ${Math.round(stats.win_rate*1000)/10}% win rate`);
  return payload;
}

// Sync ml_data/ to GitHub so outcomes survive Railway redeploys
// Uses the GitHub API to upsert files — no git CLI needed on Railway
async function syncMLDataToGitHub(): Promise<void> {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO || "abudnick8/prop-edge";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || token === "SCRUBBED_GITHUB_TOKEN") {
    console.error("[MLSync] CRITICAL: GITHUB_TOKEN env var not set on Railway — ML data will be lost on redeploy!");
    console.error("[MLSync] Fix: Railway dashboard > your service > Variables > Add GITHUB_TOKEN");
    return;
  }
  console.log(`[MLSync] Starting sync to ${repo} branch=${branch} token=${token.slice(0,8)}...`);

  const DATA_DIR = path.join(__dirname, "ml_data");
  const files    = ["bet_outcome_log.json", "pick_snapshots.json", "ml_weights.json", "ml_insights.json", "graded_ids.json", "bts_picks.json", "bts_ml_weights.json", "bts_ml_learning_log.json"];

  for (const filename of files) {
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) continue;
    try {
      const content64 = fs.readFileSync(filepath).toString("base64");
      const remotePath = `server/ml_data/${filename}`;
      const apiUrl = `https://api.github.com/repos/${repo}/contents/${remotePath}`;
      const ghHeaders = {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "clubhouse-iq-ml-sync",
      };

      // Get current SHA (needed for update — file may or may not exist)
      let sha: string | undefined;
      try {
        const getResp = await fetch(`${apiUrl}?ref=${branch}`, { headers: ghHeaders });
        if (getResp.ok) {
          const getJson = await getResp.json() as any;
          sha = getJson.sha;
        }
      } catch { /* file doesn't exist yet — create new */ }

      const body: Record<string, any> = {
        message: `[ML Auto-sync] Update ${filename}`,
        content: content64,
        branch,
      };
      if (sha) body.sha = sha;

      const putResp = await fetch(apiUrl, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify(body),
      });

      if (putResp.ok) {
        console.log(`[MLSync] ✓ Synced ${filename} to GitHub`);
      } else {
        const err = await putResp.text();
        console.warn(`[MLSync] ✗ Failed to sync ${filename}: ${putResp.status} ${err.slice(0, 300)}`);
      }
    } catch (e: any) {
      console.warn(`[MLSync] Error syncing ${filename}:`, e.message);
    }
  }
}

// Lightweight snapshot-only sync — runs after every scanner pick log
// Keeps pick_snapshots.json backed up on GitHub so restarts don't lose picks
async function syncSnapshotsToGitHub(): Promise<void> {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO || "abudnick8/prop-edge";
  const branch = "main";
  if (!token || token === "SCRUBBED_GITHUB_TOKEN") { console.warn("[MLSync] snapshots: no valid token, skipping"); return; }

  const DATA_DIR = path.join(__dirname, "ml_data");
  const filename = "pick_snapshots.json";
  const localPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(localPath)) return;

  try {
    const content  = fs.readFileSync(localPath);
    const b64      = content.toString("base64");
    const apiUrl   = `https://api.github.com/repos/${repo}/contents/server/ml_data/${filename}`;
    const headers  = { Authorization: `token ${token}`, "Content-Type": "application/json", "User-Agent": "clubhouse-iq" };

    // Get current SHA (needed for update)
    let sha: string | undefined;
    const getResp = await fetch(`${apiUrl}?ref=${branch}`, { headers });
    if (getResp.ok) {
      const j = await getResp.json() as any;
      sha = j.sha;
    }

    const body: any = { message: "chore: sync pick_snapshots", content: b64, branch };
    if (sha) body.sha = sha;

    const putResp = await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!putResp.ok) {
      const err = await putResp.text();
      console.warn(`[MLSync] snapshot sync failed: ${err.slice(0, 120)}`);
    }
  } catch (e: any) {
    console.warn(`[MLSync] snapshot sync error: ${e.message}`);
  }
}

// Pull ml_data/ from GitHub on startup so Railway has latest outcomes after redeploy
// getMLPullPromise() returns a module-level promise that resolves when startup data is loaded.
let _mlPullPromise: Promise<void> = Promise.resolve(); // set after pullMLDataFromGitHub is defined
function getMLPullPromise(): Promise<void> { return _mlPullPromise; }

async function pullMLDataFromGitHub(): Promise<void> {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO || "abudnick8/prop-edge";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || token === "SCRUBBED_GITHUB_TOKEN") { console.warn("[MLSync] pull: no valid token, skipping"); return; }

  const DATA_DIR = path.join(__dirname, "ml_data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const files = ["bet_outcome_log.json", "pick_snapshots.json", "ml_weights.json", "ml_insights.json", "graded_ids.json", "bts_picks.json", "bts_ml_weights.json", "bts_ml_learning_log.json"];
  const ghHeaders = { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "User-Agent": "clubhouse-iq-ml-sync" };

  for (const filename of files) {
    try {
      // Step 1: Get file metadata (SHA + size) via Contents API
      const metaUrl  = `https://api.github.com/repos/${repo}/contents/server/ml_data/${filename}?ref=${branch}`;
      const metaResp = await fetch(metaUrl, { headers: ghHeaders });
      if (!metaResp.ok) { console.log(`[MLSync] ${filename} not found on GitHub — skipping`); continue; }
      const meta     = await metaResp.json() as any;
      const blobSha  = meta.sha;
      const fileSize = meta.size ?? 0;

      let decoded: string;

      if (fileSize <= 900_000 && meta.encoding === "base64" && meta.content) {
        // Small file — content already inlined in the contents response
        decoded = Buffer.from((meta.content as string).replace(/\n/g, ""), "base64").toString("utf8");
      } else {
        // Large file (>1MB) — fetch the raw blob directly via Git Blobs API
        console.log(`[MLSync] ${filename} is ${Math.round(fileSize/1024)}KB — fetching via blob API`);
        const blobUrl  = `https://api.github.com/repos/${repo}/git/blobs/${blobSha}`;
        const blobResp = await fetch(blobUrl, { headers: ghHeaders });
        if (!blobResp.ok) { console.warn(`[MLSync] Blob fetch failed for ${filename}: ${blobResp.status}`); continue; }
        const blob     = await blobResp.json() as any;
        decoded        = Buffer.from((blob.content as string).replace(/\n/g, ""), "base64").toString("utf8");
      }

      // Validate JSON before writing
      try { JSON.parse(decoded); }
      catch { console.warn(`[MLSync] ${filename} from GitHub is corrupt JSON — skipping`); continue; }

      fs.writeFileSync(path.join(DATA_DIR, filename), decoded);
      console.log(`[MLSync] ✓ Pulled ${filename} from GitHub (${Math.round(decoded.length/1024)}KB)`);
    } catch (e: any) {
      console.warn(`[MLSync] Could not pull ${filename}:`, e.message);
    }
  }
}

// Start the pull immediately at module load — before any request can be served.
// DB pull runs first (no token needed), then GitHub fills any remaining gaps.
_mlPullPromise = mlPullFromDB()
  .then(() => pullMLDataFromGitHub())
  .catch((e: any) => {
    console.warn("[MLSync] Module-level startup pull failed:", e?.message);
  });

// ── Kronos Python microservice manager ───────────────────────────────────────
const KRONOS_PORT = 5050;
const KRONOS_URL  = `http://127.0.0.1:${KRONOS_PORT}`;
let kronosProc: ChildProcess | null = null;
let kronosReady = false;

function startKronos() {
  if (kronosProc) return;
  // Resolve relative to repo root (works in both dev and Railway production)
  const scriptPath = path.join(process.cwd(), "server", "kronos_service.py");
  kronosProc = spawn("python3", [scriptPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  kronosProc.stdout?.on("data", (d: Buffer) => {
    const msg = d.toString().trim();
    console.log(`[CIQ] ${msg}`);
    if (msg.includes("running on port")) kronosReady = true;
  });
  kronosProc.stderr?.on("data", (d: Buffer) => {
    console.error(`[CIQ] ${d.toString().trim()}`);
  });
  kronosProc.on("error", (err: any) => {
    if (err.code === "ENOENT") {
      console.warn("[CIQ] python3 not found — Kronos AI will be disabled.");
      kronosFailed = true;
    } else {
      console.error(`[CIQ] Spawn error: ${err.message}`);
    }
    kronosProc = null;
    kronosReady = false;
  });
  kronosProc.on("exit", (code) => {
    console.log(`[CIQ] Process exited (${code}). Will restart on next request.`);
    kronosProc = null;
    kronosReady = false;
  });
}

let kronosFailed = false; // set if python3 is unavailable

async function ensureKronos(): Promise<boolean> {
  if (kronosFailed) return false;
  if (!kronosProc) startKronos();
  if (kronosReady) return true;
  // Wait up to 4s for startup
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (kronosReady) return true;
    if (kronosFailed) return false;
    try {
      await axios.get(`${KRONOS_URL}/health`, { timeout: 500 });
      kronosReady = true;
      return true;
    } catch {}
  }
  console.warn("[CIQ] Timed out waiting for Python service — marking as unavailable");
  kronosFailed = true;
  return false;
}

// ── Player stat cache (15 min TTL) ────────────────────────────────────────────
const STAT_CACHE = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

// Map player names → Basketball-Reference slug
const BBR_SLUG: Record<string, string> = {
  "LeBron James": "jamesle01",      "Stephen Curry": "curryst01",
  "Kevin Durant": "duranke01",      "Giannis Antetokounmpo": "antetgi01",
  "Luka Doncic": "doncilu01",       "Joel Embiid": "embiijo01",
  "Nikola Jokic": "jokicni01",      "Jayson Tatum": "tatumja01",
  "Devin Booker": "bookede01",      "Damian Lillard": "lillada01",
  "Anthony Davis": "davisan02",     "Jimmy Butler": "butleji01",
  "Kyrie Irving": "irvinky01",      "Karl-Anthony Towns": "townska01",
  "Trae Young": "youngte01",        "Zion Williamson": "willizi01",
  "Donovan Mitchell": "mitchdo01",  "Bam Adebayo": "adebaba01",
  "Paul George": "georgpa01",       "Kawhi Leonard": "leonaka01",
  "James Harden": "hardeja01",      "Ja Morant": "moranja01",
  "Paolo Banchero": "banchpa01",    "Tyrese Haliburton": "halibty01",
  "Anthony Edwards": "edwaran01",   "Shai Gilgeous-Alexander": "gilgesh01",
  "Darius Garland": "garlada01",    "Tyrese Maxey": "maxeyty01",
  "De'Aaron Fox": "foxde01",        "Dejounte Murray": "murrade01",
  "OG Anunoby": "anunoog01",        "Mikal Bridges": "bridgmi01",
  "Scottie Barnes": "barnesc01",    "Jalen Green": "greenja05",
  "Cade Cunningham": "cunningca01", "Evan Mobley": "mobleev01",
  "Franz Wagner": "wagnefr01",      "Josh Giddey": "giddejo01",
  "DeMar DeRozan": "derozde01",     "Zach LaVine": "lavinza01",
  "Brandon Ingram": "ingrambr01",   "Draymond Green": "greendr01",
  "Klay Thompson": "thompkl01",     "Bradley Beal": "bealbr01",
  "Russell Westbrook": "westbru01", "Chris Paul": "paulch01",
};

// NFL Reference slugs
const PFR_SLUG: Record<string, string> = {
  "Patrick Mahomes": "MahomPa00",   "Josh Allen": "AllenJo02",
  "Lamar Jackson": "JackLa00",     "Jalen Hurts": "HurtsJa00",
  "Dak Prescott": "PresDa01",      "Justin Jefferson": "JeffJu00",
  "Tyreek Hill": "HillTy01",       "CeeDee Lamb": "LambCe00",
  "Justin Herbert": "HerbJu00",    "Joe Burrow": "BurrJo00",
  "Davante Adams": "AdamsDa11",    "Travis Kelce": "KelcTr00",
  "Stefon Diggs": "DiggSt01",      "Cooper Kupp": "KuppCo00",
  "Christian McCaffrey": "McC-Ch02","Derrick Henry": "HenrDe00",
};

// ── ESPN ID cache ─────────────────────────────────────────────────────────
// ESPN ID cache — all IDs verified via ESPN core API roster scan + direct athlete lookup.
// Any player NOT in this cache falls through to the dynamic resolveESPNId() function.
const ESPN_ID_CACHE: Record<string, string> = {
  // ── NBA (verified via ESPN core API active roster scan) ───────────────────
  "LeBron James": "1966",              "Stephen Curry": "3975",
  "Kevin Durant": "3202",              "Giannis Antetokounmpo": "3032977",
  "Luka Doncic": "3945274",            "Joel Embiid": "3059318",
  "Nikola Jokic": "3112335",           "Jayson Tatum": "4065648",
  "Devin Booker": "3136193",           "Damian Lillard": "6606",
  "Anthony Davis": "6583",             "Jimmy Butler": "6430",
  "Kyrie Irving": "6442",              "Karl-Anthony Towns": "3136195",
  "Trae Young": "4277905",             "Donovan Mitchell": "3908809",
  "Bam Adebayo": "4066261",            "Paolo Banchero": "4432573",
  "Tyrese Haliburton": "4396993",      "Anthony Edwards": "4594268",
  "Shai Gilgeous-Alexander": "4278073","Darius Garland": "4396907",
  "Tyrese Maxey": "4431678",           "De'Aaron Fox": "4066259",
  "OG Anunoby": "3934719",             "Mikal Bridges": "3147657",
  "Scottie Barnes": "4433134",         "Jalen Green": "4437244",
  "Cade Cunningham": "4432166",        "Evan Mobley": "4432158",
  "Franz Wagner": "4566434",           "Josh Giddey": "4871145",
  "DeMar DeRozan": "3978",             "Zach LaVine": "3064440",
  "Draymond Green": "6589",            "Klay Thompson": "6475",
  "Bradley Beal": "6580",              "Myles Turner": "3133628",
  "Tobias Harris": "6618",             "Khris Middleton": "6609",
  "Brook Lopez": "3971",               "Jaylen Brown": "3917376",
  "Marcus Smart": "2990969",           "Kyle Lowry": "2168",
  "Pascal Siakam": "3136196",          "Kristaps Porzingis": "3102531",
  "Jalen Brunson": "3934672",          "RJ Barrett": "4395625",
  "Immanuel Quickley": "4395724",      "Deandre Ayton": "4278129",
  "Cameron Johnson": "3138196",        "Buddy Hield": "2990984",
  "Bennedict Mathurin": "4683634",     "Andrew Nembhard": "4395712",
  "Dennis Schroder": "3032979",        "Nikola Vucevic": "6478",
  "Derrick White": "3078576",          "Al Horford": "3213",
  "Payton Pritchard": "4066354",       "Sam Hauser": "4065804",
  "Jordan Poole": "4277956",           "Bilal Coulibaly": "5104155",
  "Kyle Kuzma": "3134907",             "Deni Avdija": "4683021",
  "Bobby Portis": "3064482",
  // ── NHL (verified via ESPN site v2 team roster scan) ─────────────────────
  "Connor McDavid": "3895074",         "Nathan MacKinnon": "3041969",
  "David Pastrnak": "3114778",         "Auston Matthews": "4024123",
  "Leon Draisaitl": "3114727",         "Nikita Kucherov": "2563060",
  "Brady Tkachuk": "4319858",          "Kirill Kaprizov": "3942335",
  "Matthew Tkachuk": "4024854",        "Sebastian Aho": "3904173",
  "Mark Scheifele": "2562632",         "Jack Hughes": "4565222",
  "Cole Caufield": "4565236",          "Aleksander Barkov": "3041970",
  "Cole Sillinger": "4874725",         "Logan Stankoven": "4874899",
  "Andrei Svechnikov": "4352683",       "Seth Jarvis": "4697396",
  "Sam Reinhart": "3114722",           "Carter Verhaeghe": "3042088",
  "Jason Robertson": "4565275",         "William Nylander": "3114736",
  "Sidney Crosby": "3114",              "Evgeni Malkin": "3124",
  "Erik Karlsson": "5164",              "Cale Makar": "4233563",
  "Charlie McAvoy": "3988803",          "Sam Bennett": "3114732",
  "Roman Josi": "5180",
  "John Tavares": "5160",
  "Alex Ovechkin": "3101",              "Mitch Marner": "4063404",
  // ── MLB (verified via ESPN site v2 team roster scan) ─────────────────────
  "Shohei Ohtani": "39832",            "Mike Trout": "30836",
  "Mookie Betts": "33039",             "Juan Soto": "36969",
  "Ronald Acuna Jr.": "36185",         "Freddie Freeman": "30193",
  "Yordan Alvarez": "36018",           "Bryce Harper": "30951",
  "Trea Turner": "33710",              "Paul Goldschmidt": "31027",
  "Nolan Arenado": "31261",            "Fernando Tatis Jr.": "35983",
  "Bo Bichette": "38904",              "Vladimir Guerrero Jr.": "35002",
  "Jose Ramirez": "32801",             "Julio Rodriguez": "41044",
  "Spencer Strider": "4307825",        "Gerrit Cole": "32081",
  "Sandy Alcantara": "35241",
  // ── NFL (verified via ESPN site v2 team roster scan) ─────────────────────
  "Patrick Mahomes": "3139477",        "Josh Allen": "3915239",
  "Lamar Jackson": "3916387",          "Joe Burrow": "3915511",
  "Justin Herbert": "4038941",         "Jalen Hurts": "4040715",
  "Tua Tagovailoa": "4241479",         "Dak Prescott": "2577417",
  "Kyler Murray": "3917315",           "Trevor Lawrence": "4360310",
  "Justin Jefferson": "4262921",       "Cooper Kupp": "2977187",
  "Tyreek Hill": "3054192",            "Davante Adams": "16800",
  "Travis Kelce": "15847",             "Mark Andrews": "3116365",
  "CeeDee Lamb": "4241389",            "Ja'Marr Chase": "4362628",
  "Christian McCaffrey": "3117251",    "Derrick Henry": "3043078",
  "Nick Chubb": "3128720",             "Austin Ekeler": "3068267",
};

// ─── ESPN player ID lookup ────────────────────────────────────────────────────
async function resolveESPNId(playerName: string, sport: string): Promise<string | null> {
  // Check verified cache first
  if (ESPN_ID_CACHE[playerName]) return ESPN_ID_CACHE[playerName];

  const sportsName = sport === "NBA" ? "basketball" : sport === "NFL" ? "football" : sport === "MLB" ? "baseball" : sport === "NHL" ? "hockey" : "basketball";
  const league = sport === "NBA" ? "nba" : sport === "NFL" ? "nfl" : sport === "MLB" ? "mlb" : sport === "NHL" ? "nhl" : "nba";

  // Method 1: ESPN site search API — type=player (NOT type=athlete which returns errors)
  // The response has results[].contents[] where each item has uid = "s:40~l:46~a:{espnId}"
  try {
    // Strip accents so "Schröder" → "Schroder", "Diabaté" → "Diabate"
    const asciiName = playerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const r = await axios.get(
      `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiName)}&limit=8&type=player&sport=${sportsName}%2F${league}`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    // Results are nested: results[] → contents[]
    const allContents: any[] = [];
    for (const resultGroup of (r.data?.results ?? [])) {
      for (const c of (resultGroup.contents ?? [])) allContents.push(c);
    }
    const nameLower = asciiName.toLowerCase();
    const nameParts = nameLower.split(" ");
    for (const item of allContents) {
      const itemName = (item.displayName ?? item.name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      // Extract numeric ID from uid field ("s:40~l:46~a:4873138" → "4873138")
      const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(item.id ?? "");
      if (!id) continue;
      if (itemName === nameLower ||
          (nameParts.length >= 2 && itemName.includes(nameParts[0]) && itemName.includes(nameParts[nameParts.length - 1]))) {
        ESPN_ID_CACHE[playerName] = id;
        return id;
      }
    }
    // Fallback: take first player result
    if (allContents.length === 1) {
      const uidMatch = (allContents[0].uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(allContents[0].id ?? "");
      if (id) { ESPN_ID_CACHE[playerName] = id; return id; }
    }
  } catch { /* search failed */ }

  // Method 2: ESPN search without sport filter (broader — catches rookies, international players)
  try {
    const asciiName2 = playerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const r2 = await axios.get(
      `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiName2)}&limit=5&type=player`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const allContents2: any[] = [];
    for (const rg of (r2.data?.results ?? [])) for (const c of (rg.contents ?? [])) allContents2.push(c);
    const nameLower2 = asciiName2.toLowerCase();
    const parts2 = nameLower2.split(" ");
    for (const item of allContents2) {
      const itemName = (item.displayName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(item.id ?? "");
      if (!id) continue;
      if (itemName === nameLower2 ||
          (parts2.length >= 2 && itemName.includes(parts2[0]) && itemName.includes(parts2[parts2.length - 1]))) {
        ESPN_ID_CACHE[playerName] = id;
        return id;
      }
    }
    // Take first result as last-resort
    if (allContents2.length >= 1) {
      const uidMatch = (allContents2[0].uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(allContents2[0].id ?? "");
      if (id) { ESPN_ID_CACHE[playerName] = id; return id; }
    }
  } catch { /* fallback search failed */ }

  return null;
}

// ─── ESPN v3 game log (primary source — clean, single request per sport) ────
// site.web.api.espn.com returns labels + per-game stats + opponent info in one call.
async function fetchESPNGameLog(playerName: string, sport: string): Promise<any> {
  try {
    // Current and prior season years — we pull both so recent postseason/championship
    // games (Super Bowl, World Series, Stanley Cup, NBA Finals, All-Star) are always included.
    const currentYear = new Date().getFullYear();
    // NBA/NHL use a "season" year that represents the spring end (e.g. 2024-25 season = 2025)
    // MLB/NFL use the calendar year the season started
    const sportCfg: Record<string, { sn: string; lg: string; seasons: number[]; statMap: Record<string, string>; altLeagues?: string[] }> = {
      NBA: { sn: "basketball", lg: "nba",    seasons: [currentYear, currentYear - 1],
             statMap: { MIN: "mp", PTS: "pts", REB: "trb", AST: "ast", BLK: "blk", STL: "stl", TO: "tov", FG: "fg_made", "3PT": "fg3_made" } },
      NHL: { sn: "hockey",     lg: "nhl",    seasons: [currentYear, currentYear - 1],
             statMap: { G: "goals", A: "ast", PTS: "pts", S: "shots", "TOI/G": "toi", "+/-": "plusMinus" } },
      MLB: { sn: "baseball",   lg: "mlb",    seasons: [currentYear, currentYear - 1],
             statMap: { AB: "ab", H: "hits", "2B": "doubles", "3B": "triples", HR: "home_runs", RBI: "rbi", BB: "bb", SO: "strikeouts", AVG: "avg", OBP: "obp", SLG: "slg", R: "runs",
                         // pitching
                         IP: "ip", ER: "er", K: "strikeouts_p" },
             // WBC is a separate ESPN baseball league
             altLeagues: ["world-baseball-classic"] },
      NFL: { sn: "football",   lg: "nfl",    seasons: [currentYear - 1, currentYear - 2], // NFL season uses prior calendar year (2025)
             statMap: { YDS: "yds", TD: "td", INT: "int", ATT: "att", REC: "rec", CAR: "car", "LONG": "long" } },
    };
    const cfg = sportCfg[sport.toUpperCase()] ?? sportCfg.NBA;

    const espnId = await resolveESPNId(playerName, sport);
    if (!espnId) return null;

    // ── PRIMARY: ESPN v3 gamelog — fetch BOTH current and prior season so
    // postseason/championship/All-Star games (Super Bowl, World Series,
    // Stanley Cup Finals, NBA Finals, All-Star games) are always captured.
    let primaryGames: any[] = [];
    let dataSource = "ESPN v3";
    const seenEventIds = new Set<string>();

    // Helper: parse one season's v3 response and append unique games
    const parseV3Response = (v3Data: any) => {
      const labels: string[] = v3Data.labels ?? [];
      const eventsMap: Record<string, any> = v3Data.events ?? {};
      const entries: Array<{ entry: any; eventInfo: any }> = [];
      // Iterate ALL seasonTypes — regular season, playoffs, all-star, etc.
      for (const stype of (v3Data.seasonTypes ?? [])) {
        for (const cat of (stype.categories ?? [])) {
          for (const ev of (cat.events ?? [])) {
            const eid = String(ev.eventId ?? "");
            if (seenEventIds.has(eid)) continue; // deduplicate across seasons
            seenEventIds.add(eid);
            const evInfo = eventsMap[eid] ?? {};
            entries.push({ entry: ev, eventInfo: evInfo, labels: labels ?? [] });
          }
        }
      }
      return entries;
    };

    try {
      // Fetch both seasons in parallel — prior season first so current-season
      // games win when we sort and slice the last 5
      const seasonFetches = await Promise.allSettled(
        cfg.seasons.map(yr =>
          axios.get(
            `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
            { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }
          )
        )
      );

      let allGameEntries: Array<{ entry: any; eventInfo: any; labels?: string[] }> = [];
      for (const result of seasonFetches) {
        if (result.status === "fulfilled") {
          allGameEntries.push(...parseV3Response(result.value.data));
        }
      }

      // Sort chronologically (oldest → newest), keep ALL games for multi-window analysis
      allGameEntries.sort((a, b) => {
        const da = a.eventInfo.gameDate ?? "";
        const db = b.eventInfo.gameDate ?? "";
        return da.localeCompare(db);
      });

      for (const { entry, eventInfo, labels } of allGameEntries) {
        const stats = entry.stats ?? [];
        const statObj: Record<string, string> = {};
        labels.forEach((lbl, i) => { if (stats[i] != null) statObj[lbl] = String(stats[i]); });

        // Map sport-specific labels to our standard keys
        const mapped: Record<string, string> = {};
        for (const [label, key] of Object.entries(cfg.statMap)) {
          if (statObj[label] != null) mapped[key] = statObj[label];
        }
        // For FG split "9-21" extract made count
        if (statObj["FG"]) {
          const fgParts = statObj["FG"].split("-");
          mapped["fg_made"] = fgParts[0] ?? "0";
          mapped["fg_att"] = fgParts[1] ?? "0";
        }
        if (statObj["3PT"]) {
          const fgParts = statObj["3PT"].split("-");
          mapped["fg3_made"] = fgParts[0] ?? "0";
        }

        const opp = eventInfo.opponent?.abbreviation ?? "?";
        const atVs = eventInfo.atVs ?? "vs";
        const gameDate = eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "";
        const gameResult = eventInfo.gameResult ?? "";
        const score = eventInfo.score ?? "";
        // eventNote captures special event labels: "Super Bowl LIX", "World Series - Game 6",
        // "NBA All-Star - Championship", "Stanley Cup Finals - Game 7", etc.
        const eventNote = eventInfo.eventNote ?? eventInfo.shortName ?? "";

        primaryGames.push({
          date_game: gameDate,
          opp_id: `${atVs === "@" ? "@" : "vs"}${opp}`,
          result: gameResult ? `${gameResult} ${score}`.trim() : "",
          eventNote: eventNote,
          source: "espn_v3",
          ...mapped,
        });
      }
    } catch (v3Err: any) {
      console.warn(`[Stats] ESPN v3 failed for ${playerName}: ${v3Err.message}`);
    }

    // ── CROSS-CHECK: ESPN core API (second source) ────────────────────────────
    // Fetch in parallel with v3. If key stats differ by >10%, log a warning.
    let crossCheckGames: any[] = [];
    let dataVerified = false;
    try {
      const elogResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${cfg.sn}/leagues/${cfg.lg}/athletes/${espnId}/eventlog?limit=25`,
        { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const totalPages = elogResp.data?.events?.pageCount ?? 1;
      const lastPageResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${cfg.sn}/leagues/${cfg.lg}/athletes/${espnId}/eventlog?limit=25&page=${totalPages}`,
        { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const playedEvents: any[] = (lastPageResp.data?.events?.items ?? []).filter((e: any) => e.played === true).slice(-30);

      // Fetch per-game stats for last 5 played events
      await Promise.all(playedEvents.map(async (ev: any) => {
        try {
          const statsRef = ev?.statistics?.$ref;
          if (!statsRef) return;
          const statsResp = await axios.get(statsRef, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
          const cats: any[] = statsResp.data?.splits?.categories ?? [];
          const gs: Record<string, number> = {};
          for (const cat of cats) for (const s of (cat.stats ?? [])) gs[s.name] = s.value;
          crossCheckGames.push({
            pts: Math.round(gs.points ?? gs.totalPoints ?? 0),
            trb: Math.round(gs.rebounds ?? gs.totalRebounds ?? 0),
            ast: Math.round(gs.assists ?? 0),
          });
        } catch { /* skip */ }
      }));

      // Verify: compare pts totals between v3 and core API
      if (primaryGames.length > 0 && crossCheckGames.length > 0) {
        const v3Total = primaryGames.reduce((sum, g) => sum + (parseFloat(g.pts ?? g.goals ?? "0") || 0), 0);
        const coreTotal = crossCheckGames.reduce((sum, g) => sum + (g.pts || 0), 0);
        const diff = Math.abs(v3Total - coreTotal);
        const maxTotal = Math.max(v3Total, coreTotal, 1);
        if (diff / maxTotal > 0.15) {
          // >15% discrepancy — prefer core API data which has explicit stat names
          console.warn(`[Stats] ${playerName} discrepancy: v3=${v3Total} core=${coreTotal} — using core API`);
          dataSource = "ESPN core (cross-verified)";
          // Rebuild from core data if we have enough
          if (crossCheckGames.length >= primaryGames.length) {
            // Core data doesn't have date/opp so we keep the v3 structure but swap in core stats
            for (let i = 0; i < Math.min(primaryGames.length, crossCheckGames.length); i++) {
              const cg = crossCheckGames[i];
              primaryGames[i].pts = String(cg.pts);
              primaryGames[i].trb = String(cg.trb);
              primaryGames[i].ast = String(cg.ast);
              primaryGames[i].source = "espn_core_verified";
            }
          }
        } else {
          dataVerified = true;
        }
      }
    } catch (crossErr: any) {
      console.warn(`[Stats] Cross-check failed for ${playerName}: ${crossErr.message}`);
    }

    // If v3 returned nothing, fall back to core-only
    if (primaryGames.length === 0) {
      console.warn(`[Stats] ESPN v3 returned no games for ${playerName}, falling back to core API`);
      dataSource = "ESPN core";
      // Use crossCheckGames as primary (they have pts/trb/ast at minimum)
      primaryGames = crossCheckGames.map((g, i) => ({ ...g, date_game: "", opp_id: `G${i + 1}`, source: "espn_core" }));
    }

    // Sort ascending (oldest → newest for charts)
    primaryGames.sort((a, b) => (a.date_game || "").localeCompare(b.date_game || ""));

    // ── Season averages via ESPN v3 stats endpoint ──────────────────────────
    // The v3 stats endpoint returns categories[].statistics[] where each row is
    // a season year. Stats are a positional array matched against categories[].labels[].
    // We pick the most-recent season row, build a label→value map, then extract
    // the stats we care about by their actual ESPN label names.
    let season: Record<string, string> = {};
    // NFL: use prior calendar year (season started in 2025). NBA/NHL: spring year (2026).
    const primarySeason = sport.toUpperCase() === "NFL" ? currentYear - 1 : cfg.seasons[0];
    let seasonLabel = sport.toUpperCase() === "NFL"
      ? `${primarySeason} Season Stats (ESPN)`
      : `${primarySeason - 1}-${String(primarySeason).slice(2)} Season Averages (ESPN)`;
    try {
      const statsUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/stats?season=${primarySeason}&seasontype=2`;
      const statsResp = await axios.get(statsUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });

      // Build label→value from categories[0] (per-game/averages) which has the most
      // human-readable stats. ESPN returns stats as positional array + labels array.
      const v3cats: any[] = statsResp.data?.categories ?? [];
      const allStats: Record<string, string> = {};
      for (const cat of v3cats) {
        const labels: string[] = cat.labels ?? [];
        const statsRows: any[] = cat.statistics ?? [];
        // Find the row for the target season year; fall back to last row
        const targetRow = statsRows.find((r: any) => r?.season?.year === primarySeason)
          ?? statsRows[statsRows.length - 1];
        if (!targetRow) continue;
        const vals: string[] = targetRow.stats ?? [];
        labels.forEach((lbl, i) => {
          if (vals[i] != null && allStats[lbl] == null) allStats[lbl] = String(vals[i]);
        });
      }

      const sportUp = sport.toUpperCase();
      if (sportUp === "NBA") {
        season = {
          pts:    allStats["PTS"] ?? "—",
          reb:    allStats["REB"] ?? "—",
          ast:    allStats["AST"] ?? "—",
          stl:    allStats["STL"] ?? "—",
          blk:    allStats["BLK"] ?? "—",
          fg_pct: allStats["FG%"] ? allStats["FG%"] + "%" : "—",
          fg3_pct:allStats["3P%"] ? allStats["3P%"] + "%" : "—",
          mpg:    allStats["MIN"] ?? "—",
          gp:     allStats["GP"]  ?? "—",
          to:     allStats["TO"]  ?? "—",
        };
      } else if (sportUp === "NHL") {
        season = {
          goals:     allStats["G"]     ?? "—",
          ast:       allStats["A"]     ?? "—",
          pts:       allStats["PTS"]   ?? "—",
          shots:     allStats["SOG"]   ?? "—",
          gp:        allStats["GP"]    ?? "—",
          ppg:       allStats["PPG"]   ?? "—",
          plusMinus: allStats["+/-"]   ?? "—",
          toi:       allStats["TOI/G"] ?? "—",
        };
      } else if (sportUp === "MLB") {
        season = {
          avg:  allStats["AVG"] ?? "—",
          hr:   allStats["HR"]  ?? "—",
          rbi:  allStats["RBI"] ?? "—",
          obp:  allStats["OBP"] ?? "—",
          gp:   allStats["GP"]  ?? "—",
          hits: allStats["H"]   ?? "—",
          // pitcher stats
          era:  allStats["ERA"] ?? "—",
          k:    allStats["K"]   ?? allStats["SO"] ?? "—",
        };
      } else if (sportUp === "NFL") {
        // First category is passing; second is rushing — grab the richest one
        season = {
          gp:       allStats["GP"]  ?? "—",
          yds:      allStats["YDS"] ?? "—",
          td:       allStats["TD"]  ?? "—",
          int:      allStats["INT"] ?? "—",
          cmp_pct:  allStats["CMP%"] ? allStats["CMP%"] + "%" : "—",
          rec:      allStats["REC"] ?? "—",
          car:      allStats["CAR"] ?? "—",
        };
      }
    } catch (seasonErr: any) {
      console.warn(`[Stats] Season stats failed for ${playerName}: ${seasonErr.message}`);
    }

    const sportKey = sport.toLowerCase();
    const espnProfileUrl = `https://www.espn.com/${sportKey}/player/_/id/${espnId}`;

    // ── Build the three analysis windows ────────────────────────────────────
    // fullSeason — all available games (up to 162 MLB, 82 NBA, 82 NHL, 17 NFL)
    // last30     — medium sample
    // last5      — hot streak window
    const fullSeason = primaryGames;             // sorted asc
    const last30     = primaryGames.slice(-30);
    const last5      = primaryGames.slice(-5);

    console.log(`[Stats] ${playerName} (${sport}): ${fullSeason.length} total | last30=${last30.length} | last5=${last5.length} | source=${dataSource} | verified=${dataVerified}`);

    return {
      sport: sport.toUpperCase(),
      name: playerName,
      espnId,
      bbrUrl: espnProfileUrl,
      season,
      seasonLabel,
      recentGames:  last5,        // backward compat
      last30Games:  last30,
      allGames:     fullSeason,
      gameCount:    fullSeason.length,
      dataSource,
      dataVerified,
    };
  } catch (e: any) {
    console.warn("[Stats] fetchESPNGameLog failed:", e.message);
    return null;
  }
}

async function fetchBBRStats(playerName: string): Promise<any> {
  // First try ESPN (works for all active players)
  const espnData = await fetchESPNGameLog(playerName, "NBA");
  if (espnData) return espnData;

  // Fallback to BBR slug map for legacy support
  const slug = BBR_SLUG[playerName];
  if (!slug) return null;
  const letter = slug[0];
  const url = `https://www.basketball-reference.com/players/${letter}/${slug}.html`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Clubhouse IQ/1.0)" },
      timeout: 8000,
    });
    const $ = cheerio.load(resp.data);

    // Season averages from per_game table
    const row = $("#per_game tbody tr").not(".thead").last();
    const season: Record<string, string> = {};
    row.find("td").each((_, el) => {
      const stat = $(el).attr("data-stat");
      const val = $(el).text().trim();
      if (stat && val) season[stat] = val;
    });

    // Last 5 game log entries
    const recentGames: any[] = [];
    $("#pgl_basic tbody tr").not(".thead").not("[class*='partial']").slice(-5).each((_, row) => {
      const g: Record<string, string> = {};
      ["date_game","opp_id","pts","ast","trb","stl","blk","tov","mp"].forEach(stat => {
        g[stat] = $(row).find(`td[data-stat="${stat}"]`).text().trim();
      });
      if (g.pts) recentGames.push(g);
    });

    return {
      sport: "NBA",
      name: playerName,
      bbrUrl: url,
      season: {
        pts: season.pts_per_g || season.pts || "—",
        reb: season.trb_per_g || season.trb || "—",
        ast: season.ast_per_g || season.ast || "—",
        stl: season.stl_per_g || season.stl || "—",
        blk: season.blk_per_g || season.blk || "—",
        fg_pct: season.fg_pct || "—",
        fg3_pct: season.fg3_pct || "—",
        ft_pct: season.ft_pct || "—",
        mpg: season.mp_per_g || season.mp || "—",
        gp: season.g || "—",
      },
      recentGames,
    };
  } catch (e: any) {
    console.warn("BBR fetch failed:", e.message);
    return null;
  }
}

async function fetchPFRStats(playerName: string): Promise<any> {
  const slug = PFR_SLUG[playerName];
  if (!slug) return null;
  const url = `https://www.pro-football-reference.com/players/${slug[0]}/${slug}.htm`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Clubhouse IQ/1.0)" },
      timeout: 8000,
    });
    const $ = cheerio.load(resp.data);
    const row = $("#passing tbody tr, #rushing tbody tr, #receiving tbody tr").not(".thead").last();
    const season: Record<string, string> = {};
    row.find("td").each((_, el) => {
      const stat = $(el).attr("data-stat");
      const val = $(el).text().trim();
      if (stat && val) season[stat] = val;
    });
    return {
      sport: "NFL",
      name: playerName,
      pfrUrl: url,
      season,
    };
  } catch (e: any) {
    console.warn("PFR fetch failed:", e.message);
    return null;
  }
}

let scanInterval: NodeJS.Timeout | null = null;
let livePollInterval: NodeJS.Timeout | null = null;
// Track last live-poll result for the /api/live-poll status endpoint
let lastLivePoll: { ts: number; changed: number } = { ts: 0, changed: 0 };

export async function registerRoutes(httpServer: Server, app: Express) {
  // ── Build version endpoint — used by PWA to detect stale cache and force reload ──
  const BUILD_HASH = process.env.BUILD_HASH ?? Date.now().toString(36);
  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: BUILD_HASH });
  });

  // ── Webhook stub (no payment processor) ─────────────────────────────────
  app.post("/api/webhook", async (_req: Request, res: Response) => {
    res.status(200).json({ received: true });
  });

  // ── Auth routes ──────────────────────────────────────────────────────────────────────────

  // POST /api/auth/signup
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const { email, pin } = req.body ?? {};
      // All new accounts get full access — no tier selection needed
      const tier = "pro";

      if (!isValidEmail(email))
        return res.status(400).json({ error: "Invalid email address" });
      if (!isValidPIN(pin))
        return res.status(400).json({ error: "PIN must be exactly 4 alphanumeric characters" });

      const pinHash = await hashPIN(pin);

      // Owner bypass — always upsert, reset lockout, auto-activate as owner + pro
      const OWNER_EMAIL = "adam.budnick8@gmail.com";
      if (email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
        await db.query(
          `INSERT INTO users (email, pin_hash, pin_plain, tier, sub_status, is_owner, login_attempts, locked_until)
           VALUES (LOWER($1), $2, $3, 'pro', 'active', TRUE, 0, NULL)
           ON CONFLICT (email) DO UPDATE SET pin_hash=$2, pin_plain=$3, tier='pro', sub_status='active', is_owner=TRUE, login_attempts=0, locked_until=NULL, updated_at=NOW()`,
          [email, pinHash, pin]
        );
        sendNewSignupNotification(email, "pro").catch(() => {});
        return res.json({ success: true });
      }

      // Check if email already exists (non-owner)
      const existing = await db.queryOne(`SELECT id, sub_status FROM users WHERE email=LOWER($1)`, [email]);
      if (existing) {
        // Reactivate cancelled accounts instead of rejecting
        if (existing.sub_status === "cancelled") {
          await db.query(
            `UPDATE users SET tier='pro', sub_status='active', updated_at=NOW() WHERE email=LOWER($1)`,
            [email]
          );
          return res.json({ success: true });
        }
        return res.status(409).json({ error: "An account with that email already exists" });
      }

      // All tiers activate immediately — no payment required
      await db.query(
        `INSERT INTO users (email, pin_hash, pin_plain, tier, sub_status)
         VALUES (LOWER($1), $2, $3, $4, 'active')`,
        [email, pinHash, pin, tier]
      );

      sendNewSignupNotification(email, tier).catch(() => {});
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Auth] Signup error:", e.message);
      res.status(500).json({ error: "Signup failed" });
    }
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, pin } = req.body ?? {};
      if (!email || !pin) return res.status(400).json({ error: "Email and PIN required" });

      const user = await db.queryOne(
        `SELECT id, email, pin_hash, tier, sub_status, is_owner, is_disabled, login_attempts, locked_until, trial_expires
         FROM users WHERE email=LOWER($1)`,
        [email]
      );

      if (!user) return res.status(401).json({ error: "Invalid email or PIN" });

      // Check disabled
      if (user.is_disabled) return res.status(403).json({ error: "This account has been disabled. Contact support." });

      // Cancelled users: let them log in so they can resubscribe from within the app
      // (frontend will detect subStatus==='cancelled' and show the upgrade screen)

      // Check lockout
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
        return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
      }

      const pinOk = await checkPIN(pin, user.pin_hash);
      if (!pinOk) {
        const attempts = (user.login_attempts ?? 0) + 1;
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await db.query(
          `UPDATE users SET login_attempts=$1, locked_until=$2 WHERE id=$3`,
          [attempts, lockedUntil, user.id]
        );
        return res.status(401).json({ error: "Invalid email or PIN" });
      }

      // Auto-expire trial accounts
      if (user.trial_expires && new Date(user.trial_expires) < new Date() && !user.is_owner) {
        await db.query(`UPDATE users SET tier=NULL, sub_status='inactive', trial_code=NULL, trial_expires=NULL WHERE id=$1`, [user.id]);
        user.tier = null; user.sub_status = "inactive";
      }

      // Reset attempts on success + track login activity + backfill pin_plain if missing
      await db.query(
        `UPDATE users SET login_attempts=0, locked_until=NULL, login_count=COALESCE(login_count,0)+1, last_login=NOW(), last_active=NOW(),
         pin_plain=CASE WHEN pin_plain IS NULL THEN $2 ELSE pin_plain END
         WHERE id=$1`,
        [user.id, pin]
      );

      const token = signJWT({
        userId:  user.id,
        email:   user.email,
        tier:    user.sub_status === "active" ? user.tier : null,
        isOwner: user.is_owner ?? false,
      });

      res.json({ token, tier: user.tier, subStatus: user.sub_status, isOwner: user.is_owner });
    } catch (e: any) {
      console.error("[Auth] Login error:", e.message);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // GET /api/me — validate token + return fresh user data
  app.get("/api/me", requireAuth, async (req: Request, res: Response) => {
    try {
      // Update last_active timestamp (throttled — only update if > 5 min since last)
      await db.query(
        `UPDATE users SET last_active=NOW() WHERE id=$1 AND (last_active IS NULL OR last_active < NOW() - INTERVAL '5 minutes')`,
        [req.user!.userId]
      ).catch(() => {});

      const user = await db.queryOne(
        `SELECT id, email, tier, sub_status, is_owner, created_at, trial_expires FROM users WHERE id=$1`,
        [req.user!.userId]
      );
      if (!user) return res.status(404).json({ error: "User not found" });

      // Auto-expire trial — demote to free if trial has lapsed
      if (user.trial_expires && new Date(user.trial_expires) < new Date() && !user.is_owner) {
        await db.query(
          `UPDATE users SET tier=NULL, sub_status='inactive', trial_code=NULL, trial_expires=NULL WHERE id=$1`,
          [user.id]
        );
        user.tier = null;
        user.sub_status = "inactive";
      }

      res.json({
        id:        user.id,
        email:     user.email,
        tier:      user.sub_status === "active" ? user.tier : null,
        subStatus: user.sub_status,
        isOwner:   user.is_owner,
      });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/insights — OWNER ONLY
  // ──────────────────────────────────────────────────────────────
  app.get("/api/admin/insights", requireOwner, async (req: Request, res: Response) => {
    try {
      const now = new Date();

      // ── Owner account row (separate section) ──
      const ownerRow = await db.queryOne(`
        SELECT email, tier, sub_status, login_count, last_login, last_active, created_at
        FROM users WHERE is_owner = TRUE LIMIT 1
      `);

      // ── Subscriber counts by tier (non-owner only) ──
      const tierRows = await db.query(`
        SELECT tier, sub_status, COUNT(*) as count
        FROM users
        WHERE is_owner = FALSE
        GROUP BY tier, sub_status
        ORDER BY tier
      `);

      // ── Total users (non-owner) ──
      const totalRow = await db.queryOne(`SELECT COUNT(*) as count FROM users WHERE is_owner = FALSE`);

      // ── Active subscribers (paying, active, non-owner) ──
      const activeSubRow = await db.queryOne(`
        SELECT COUNT(*) as count FROM users
        WHERE sub_status = 'active' AND tier IN ('basic','pro') AND is_owner = FALSE
      `);

      // ── Active today (non-owner) ──
      const activeToday = await db.queryOne(`
        SELECT COUNT(*) as count FROM users
        WHERE last_active > NOW() - INTERVAL '24 hours' AND is_owner = FALSE
      `);

      // ── Active this week (non-owner) ──
      const activeWeek = await db.queryOne(`
        SELECT COUNT(*) as count FROM users
        WHERE last_active > NOW() - INTERVAL '7 days' AND is_owner = FALSE
      `);

      // ── Active this month (non-owner) ──
      const activeMonth = await db.queryOne(`
        SELECT COUNT(*) as count FROM users
        WHERE last_active > NOW() - INTERVAL '30 days' AND is_owner = FALSE
      `);

      // ── New signups this week (non-owner) ──
      const newThisWeek = await db.queryOne(`
        SELECT COUNT(*) as count FROM users
        WHERE created_at > NOW() - INTERVAL '7 days' AND is_owner = FALSE
      `);

      // ── New signups this month (non-owner) ──
      const newThisMonth = await db.queryOne(`
        SELECT COUNT(*) as count FROM users
        WHERE created_at > NOW() - INTERVAL '30 days' AND is_owner = FALSE
      `);

      // ── Top logins (non-owner users) ──
      const topUsers = await db.query(`
        SELECT email, tier, sub_status, login_count, last_login, last_active, created_at
        FROM users
        WHERE is_owner = FALSE
        ORDER BY login_count DESC NULLS LAST
        LIMIT 20
      `);

      // ── Signups per day last 30 days (non-owner) ──
      const signupTrend = await db.query(`
        SELECT DATE(created_at AT TIME ZONE 'America/Chicago') as day, COUNT(*) as count
        FROM users
        WHERE created_at > NOW() - INTERVAL '30 days' AND is_owner = FALSE
        GROUP BY day
        ORDER BY day ASC
      `);

      // ── Daily active users trend last 14 days (non-owner) ──
      const dauTrend = await db.query(`
        SELECT DATE(last_active AT TIME ZONE 'America/Chicago') as day, COUNT(*) as count
        FROM users
        WHERE last_active > NOW() - INTERVAL '14 days' AND is_owner = FALSE
        GROUP BY day
        ORDER BY day ASC
      `);

      // ── Avg logins per user (non-owner) ──
      const avgLogins = await db.queryOne(`
        SELECT ROUND(AVG(login_count), 1) as avg FROM users WHERE login_count > 0 AND is_owner = FALSE
      `);

      // Build tier breakdown
      const tiers: Record<string, { active: number; inactive: number; cancelled: number }> = {
        free:  { active: 0, inactive: 0, cancelled: 0 },
        basic: { active: 0, inactive: 0, cancelled: 0 },
        pro:   { active: 0, inactive: 0, cancelled: 0 },
      };
      for (const row of tierRows.rows) {
        const t = row.tier ?? "free";
        const s = row.sub_status ?? "inactive";
        if (!tiers[t]) tiers[t] = { active: 0, inactive: 0, cancelled: 0 };
        const key = s === "active" ? "active" : s === "cancelled" ? "cancelled" : "inactive";
        tiers[t][key] = parseInt(row.count);
      }

      res.json({
        generatedAt: now.toISOString(),
        ownerAccount: ownerRow ? {
          email:      ownerRow.email,
          tier:       ownerRow.tier,
          subStatus:  ownerRow.sub_status,
          loginCount: ownerRow.login_count ?? 0,
          lastLogin:  ownerRow.last_login,
          lastActive: ownerRow.last_active,
          joinedAt:   ownerRow.created_at,
        } : null,
        totals: {
          allUsers:          parseInt(totalRow?.count ?? "0"),
          activeSubscribers: parseInt(activeSubRow?.count ?? "0"),
          activeToday:       parseInt(activeToday?.count ?? "0"),
          activeThisWeek:    parseInt(activeWeek?.count ?? "0"),
          activeThisMonth:   parseInt(activeMonth?.count ?? "0"),
          newThisWeek:       parseInt(newThisWeek?.count ?? "0"),
          newThisMonth:      parseInt(newThisMonth?.count ?? "0"),
          avgLoginsPerUser:  parseFloat(avgLogins?.avg ?? "0"),
        },
        tiers,
        topUsers: topUsers.rows.map((u: any) => ({
          email:       u.email,
          tier:        u.tier,
          subStatus:   u.sub_status,
          loginCount:  u.login_count ?? 0,
          lastLogin:   u.last_login,
          lastActive:  u.last_active,
          joinedAt:    u.created_at,
        })),
        signupTrend: signupTrend.rows.map((r: any) => ({ day: r.day, count: parseInt(r.count) })),
        dauTrend:    dauTrend.rows.map((r: any) => ({ day: r.day, count: parseInt(r.count) })),
      });
    } catch (e: any) {
      console.error("[Insights]", e.message);
      res.status(500).json({ error: "Failed to load insights" });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // OWNER TOOLS — Promo codes, Trial codes, User management
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/admin/promo-codes ─────────────────────────────────────────────
  app.get("/api/admin/promo-codes", requireOwner, async (_req: Request, res: Response) => {
    const rows = await db.query(`SELECT * FROM promo_codes ORDER BY created_at DESC`);
    res.json(rows.rows);
  });

  // ── POST /api/admin/promo-codes ────────────────────────────────────────────
  app.post("/api/admin/promo-codes", requireOwner, async (req: Request, res: Response) => {
    const { code, discount_pct, applies_to = "both", max_uses = null, expires_at = null, duration_months = null } = req.body ?? {};
    if (!code || !discount_pct) return res.status(400).json({ error: "code and discount_pct required" });
    const upper = String(code).toUpperCase().trim();
    if (upper.length < 2 || upper.length > 20) return res.status(400).json({ error: "Code must be 2–20 characters" });
    if (discount_pct < 1 || discount_pct > 100) return res.status(400).json({ error: "Discount must be 1–100%" });
    if (duration_months !== null && (duration_months < 1 || duration_months > 24)) return res.status(400).json({ error: "Duration must be 1–24 months" });
    try {
      const row = await db.queryOne(
        `INSERT INTO promo_codes (code, discount_pct, applies_to, max_uses, expires_at, duration_months)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [upper, discount_pct, applies_to, max_uses, expires_at || null, duration_months || null]
      );
      res.json(row);
    } catch (e: any) {
      if (e.code === "23505") return res.status(409).json({ error: "Code already exists" });
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/admin/promo-codes/:id ──────────────────────────────────────
  app.delete("/api/admin/promo-codes/:id", requireOwner, async (req: Request, res: Response) => {
    await db.query(`DELETE FROM promo_codes WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  });

  // ── PATCH /api/admin/promo-codes/:id/toggle ────────────────────────────────
  app.patch("/api/admin/promo-codes/:id/toggle", requireOwner, async (req: Request, res: Response) => {
    const row = await db.queryOne(`UPDATE promo_codes SET active = NOT active WHERE id=$1 RETURNING *`, [req.params.id]);
    res.json(row);
  });

  // ── GET /api/admin/trial-codes ─────────────────────────────────────────────
  app.get("/api/admin/trial-codes", requireOwner, async (_req: Request, res: Response) => {
    const rows = await db.query(`SELECT * FROM trial_codes ORDER BY created_at DESC`);
    res.json(rows.rows);
  });

  // ── POST /api/admin/trial-codes ────────────────────────────────────────────
  app.post("/api/admin/trial-codes", requireOwner, async (req: Request, res: Response) => {
    const { code, duration_days = 7, max_uses = null, note = null, expires_at = null } = req.body ?? {};
    if (!code) return res.status(400).json({ error: "code required" });
    const upper = String(code).toUpperCase().trim();
    if (upper.length < 2 || upper.length > 20) return res.status(400).json({ error: "Code must be 2–20 characters" });
    try {
      const row = await db.queryOne(
        `INSERT INTO trial_codes (code, duration_days, max_uses, note, expires_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [upper, duration_days, max_uses, note, expires_at || null]
      );
      res.json(row);
    } catch (e: any) {
      if (e.code === "23505") return res.status(409).json({ error: "Code already exists" });
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/admin/trial-codes/:id ─────────────────────────────────────
  app.delete("/api/admin/trial-codes/:id", requireOwner, async (req: Request, res: Response) => {
    const row = await db.queryOne(`SELECT code FROM trial_codes WHERE id=$1`, [req.params.id]);
    if (row) await db.query(`DELETE FROM trial_codes WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  });

  // ── PATCH /api/admin/trial-codes/:id/toggle ───────────────────────────────
  app.patch("/api/admin/trial-codes/:id/toggle", requireOwner, async (req: Request, res: Response) => {
    const row = await db.queryOne(`UPDATE trial_codes SET active = NOT active WHERE id=$1 RETURNING *`, [req.params.id]);
    res.json(row);
  });

  // ── GET /api/admin/trial-uses — usage log ─────────────────────────────────
  app.get("/api/admin/trial-uses", requireOwner, async (_req: Request, res: Response) => {
    const rows = await db.query(`SELECT * FROM trial_code_uses ORDER BY used_at DESC LIMIT 100`);
    res.json(rows.rows);
  });

  // ── POST /api/admin/redeem-trial — login with trial code (public) ─────────
  // Creates account if needed, sets trial tier+expiry, returns JWT
  app.post("/api/admin/redeem-trial", async (req: Request, res: Response) => {
    try {
    const { code, email } = req.body ?? {};
    if (!code || !email) return res.status(400).json({ error: "code and email required" });
    const upper = String(code).toUpperCase().trim();

    // Look up trial code
    const tc = await db.queryOne(
      `SELECT * FROM trial_codes WHERE code=$1 AND active=TRUE`, [upper]
    );
    if (!tc) return res.status(404).json({ error: "Invalid or expired trial code" });
    if (tc.expires_at && new Date(tc.expires_at) < new Date()) {
      return res.status(410).json({ error: "This trial code has expired" });
    }
    if (tc.max_uses !== null && tc.uses >= tc.max_uses) {
      return res.status(410).json({ error: "This trial code has reached its usage limit" });
    }

    const trialExpires = new Date(Date.now() + tc.duration_days * 86400000);
    const lowerEmail = String(email).toLowerCase().trim();

    // Upsert user — if new, create with a random pin (they can set one later)
    // Use statically-imported crypto (dynamic import fails in esbuild bundle)
    const tempPin = crypto.randomBytes(4).toString("hex");
    const pinHash = crypto.createHash("sha256").update(tempPin).digest("hex");

    let user = await db.queryOne(`SELECT * FROM users WHERE email=$1`, [lowerEmail]);
    if (!user) {
      user = await db.queryOne(
        `INSERT INTO users (email, pin_hash, pin_plain, tier, sub_status, trial_code, trial_expires, login_count, last_login, last_active)
         VALUES ($1,$2,$3,'pro','active',$4,$5,1,NOW(),NOW()) RETURNING *`,
        [lowerEmail, pinHash, tempPin, upper, trialExpires]
      );
    } else {
      // Upgrade existing user to pro trial
      user = await db.queryOne(
        `UPDATE users SET tier='pro', sub_status='active', trial_code=$1, trial_expires=$2,
         login_count=COALESCE(login_count,0)+1, last_login=NOW(), last_active=NOW()
         WHERE email=$3 RETURNING *`,
        [upper, trialExpires, lowerEmail]
      );
    }

    // Increment trial code uses
    await db.query(`UPDATE trial_codes SET uses=uses+1 WHERE code=$1`, [upper]);

    // Log the use
    await db.query(
      `INSERT INTO trial_code_uses (code, email, trial_expires) VALUES ($1,$2,$3)`,
      [upper, lowerEmail, trialExpires]
    );

    // Issue JWT — use statically-imported signJWT, correct field is userId not id
    const token = signJWT({
      userId: user.id, email: user.email, tier: "pro",
      subStatus: "active", isOwner: false,
    });

    res.json({
      token,
      user: { email: user.email, tier: "pro", subStatus: "active", isOwner: false },
      trialExpires: trialExpires.toISOString(),
      message: `Trial access granted until ${trialExpires.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}`,
    });
    } catch (e: any) {
      console.error("[Trial] Redeem error:", e.message);
      res.status(500).json({ error: "Failed to activate trial: " + e.message });
    }
  });

  // ── GET /api/admin/dev-code — public, returns current dev access code ────────
  app.get("/api/admin/dev-code", async (_req: Request, res: Response) => {
    const row = await db.queryOne(`SELECT value FROM app_settings WHERE key='dev_code'`);
    res.json({ code: row?.value ?? "ABUD" });
  });

  // ── POST /api/auth/dev-login — public, accepts dev code, returns real owner JWT ──
  app.post("/api/auth/dev-login", async (req: Request, res: Response) => {
    try {
      const { code } = req.body ?? {};
      const row = await db.queryOne(`SELECT value FROM app_settings WHERE key='dev_code'`);
      const serverCode: string = row?.value ?? "ABUD";
      if (!code || String(code).toUpperCase().trim() !== serverCode) {
        return res.status(401).json({ error: "Invalid access code." });
      }
      const token = signJWT({ userId: 0, email: "guest@clubhouseiq.app", tier: "pro", isOwner: true });
      res.json({ token, user: { id: 0, email: "guest@clubhouseiq.app", tier: "pro", subStatus: "active", isOwner: true } });
    } catch (e: any) {
      res.status(500).json({ error: "Dev login failed" });
    }
  });

  // ── PATCH /api/admin/dev-code — owner-only, update dev code ─────────────────
  app.patch("/api/admin/dev-code", requireOwner, async (req: Request, res: Response) => {
    const { code } = req.body ?? {};
    if (!code) return res.status(400).json({ error: "code required" });
    const upper = String(code).toUpperCase().trim();
    if (upper.length < 2 || upper.length > 20) return res.status(400).json({ error: "Code must be 2–20 characters" });
    await db.query(`INSERT INTO app_settings (key, value) VALUES ('dev_code', $1) ON CONFLICT (key) DO UPDATE SET value=$1`, [upper]);
    res.json({ code: upper });
  });

  // ── POST /api/admin/force-sync — owner-only, flush all ML+BTS to Postgres+GitHub ──
  app.post("/api/admin/force-sync", requireOwner, async (_req: Request, res: Response) => {
    const results: string[] = [];
    // 1. Force-save all ML JSON files to Postgres
    const mlFiles = [
      { path: ML_OUTCOME_LOG, name: "bet_outcome_log.json" },
      { path: ML_SNAPSHOT_FILE, name: "pick_snapshots.json" },
      { path: ML_WEIGHTS_FILE, name: "ml_weights.json" },
      { path: ML_INSIGHTS_FILE, name: "ml_insights.json" },
      { path: ML_GRADED_IDS, name: "graded_ids.json" },
      { path: path.join(ML_DATA_DIR, "bts_ml_weights.json"), name: "bts_ml_weights.json" },
      { path: path.join(ML_DATA_DIR, "bts_ml_learning_log.json"), name: "bts_ml_learning_log.json" },
    ];
    for (const { path: fp, name } of mlFiles) {
      try {
        if (!fs.existsSync(fp)) { results.push(`skip: ${name} (no file)`); continue; }
        const content = fs.readFileSync(fp, "utf-8");
        await db.query(
          `INSERT INTO ml_data_store (filename, content, updated_at) VALUES ($1,$2,NOW())
           ON CONFLICT (filename) DO UPDATE SET content=EXCLUDED.content, updated_at=NOW()`,
          [name, content]
        );
        results.push(`db: ${name} (${Math.round(content.length/1024)}KB)`);
      } catch (e: any) { results.push(`err: ${name} — ${e.message}`); }
    }
    // 2. Force-save BTS picks to Postgres (ml_data_store + bts_picks rows)
    try {
      const btsJson = JSON.stringify(btsPicksCache, null, 2);
      await db.query(
        `INSERT INTO ml_data_store (filename, content, updated_at) VALUES ('bts_picks.json',$1,NOW())
         ON CONFLICT (filename) DO UPDATE SET content=EXCLUDED.content, updated_at=NOW()`,
        [btsJson]
      );
      let upserted = 0;
      for (const [date, entries] of Object.entries(btsPicksCache)) {
        for (const e of entries as BtsPickEntry[]) {
          await db.query(
            `INSERT INTO bts_picks (pick_date,player_id,player_name,team,hit_probability,locked_at,locked,result,hits,ab,graded_at,snapshot)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (pick_date,player_id) DO UPDATE SET
               player_name=EXCLUDED.player_name, hit_probability=EXCLUDED.hit_probability,
               locked_at=COALESCE(bts_picks.locked_at,EXCLUDED.locked_at), locked=EXCLUDED.locked,
               result   =CASE WHEN bts_picks.result!='pending' THEN bts_picks.result ELSE EXCLUDED.result END,
               hits     =CASE WHEN bts_picks.result!='pending' THEN bts_picks.hits ELSE EXCLUDED.hits END,
               ab       =CASE WHEN bts_picks.result!='pending' THEN bts_picks.ab ELSE EXCLUDED.ab END,
               graded_at=CASE WHEN bts_picks.result!='pending' THEN bts_picks.graded_at ELSE EXCLUDED.graded_at END,
               snapshot =EXCLUDED.snapshot`,
            [date,e.playerId,e.name??(e as any).playerName??"",e.team??"",Math.round(e.hitProbability??0),
             e.lockedAt??null,e.lockedAt!=null,e.result??"pending",e.hits??null,e.ab??null,
             e.gradedAt??null,JSON.stringify(e.snapshot??{})]
          );
          upserted++;
        }
      }
      results.push(`db: bts_picks.json + ${upserted} bts_picks rows`);
    } catch (e: any) { results.push(`err: bts_picks — ${e.message}`); }
    // 3. Trigger GitHub sync
    try {
      await syncMLDataToGitHub();
      results.push("github: sync triggered");
    } catch (e: any) { results.push(`github-err: ${e.message}`); }
    res.json({ ok: true, results });
  });

  // ── GET /api/admin/validate-promo — used by Pricing page ──────────────────
  app.get("/api/admin/validate-promo", async (req: Request, res: Response) => {
    const code = String(req.query.code ?? "").toUpperCase().trim();
    if (!code) return res.status(400).json({ error: "code required" });
    const row = await db.queryOne(
      `SELECT * FROM promo_codes WHERE code=$1 AND active=TRUE`, [code]
    );
    if (!row) return res.status(404).json({ error: "Invalid promo code" });
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: "This promo code has expired" });
    }
    if (row.max_uses !== null && row.uses >= row.max_uses) {
      return res.status(410).json({ error: "This promo code has reached its limit" });
    }
    res.json({ code: row.code, discount_pct: row.discount_pct, applies_to: row.applies_to, duration_months: row.duration_months ?? null });
  });

  // ── GET /api/admin/users — user list for owner management ─────────────────
  app.get("/api/admin/users", requireOwner, async (req: Request, res: Response) => {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const rows = search
      ? await db.query(`SELECT id,email,tier,sub_status,is_owner,is_disabled,login_count,last_active,created_at,trial_code,trial_expires,pin_plain FROM users WHERE email ILIKE $1 ORDER BY created_at DESC LIMIT 50`, [search])
      : await db.query(`SELECT id,email,tier,sub_status,is_owner,is_disabled,login_count,last_active,created_at,trial_code,trial_expires,pin_plain FROM users ORDER BY created_at DESC LIMIT 100`);
    res.json(rows.rows);
  });

  // ── PATCH /api/admin/users/:id/tier — manual tier override ────────────────
  app.patch("/api/admin/users/:id/tier", requireOwner, async (req: Request, res: Response) => {
    const { tier, sub_status = "active" } = req.body ?? {};
    if (!["free","basic","pro"].includes(tier)) return res.status(400).json({ error: "Invalid tier" });
    const row = await db.queryOne(
      `UPDATE users SET tier=$1, sub_status=$2 WHERE id=$3 AND is_owner=FALSE RETURNING id,email,tier,sub_status`,
      [tier === "free" ? null : tier, sub_status, req.params.id]
    );
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json(row);
  });

  // ── PATCH /api/admin/users/:id/pin — owner sets pin_plain for any user ─────
  app.patch("/api/admin/users/:id/pin", requireOwner, async (req: Request, res: Response) => {
    const { pin } = req.body ?? {};
    if (!pin || String(pin).length < 1) return res.status(400).json({ error: "PIN required" });
    const pinHash = await hashPIN(String(pin));
    const row = await db.queryOne(
      `UPDATE users SET pin_hash=$1, pin_plain=$2 WHERE id=$3 RETURNING id,email,pin_plain`,
      [pinHash, String(pin), req.params.id]
    );
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json(row);
  });

  // ── PATCH /api/admin/users/:id/disable — disable/enable user ──────────────
  app.patch("/api/admin/users/:id/disable", requireOwner, async (req: Request, res: Response) => {
    const row = await db.queryOne(
      `UPDATE users SET is_disabled = NOT is_disabled WHERE id=$1 AND is_owner=FALSE RETURNING id,email,is_disabled`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json(row);
  });

  // POST /api/auth/forgot-pin

  app.post("/api/auth/forgot-pin", async (req: Request, res: Response) => {
    try {
      const { email } = req.body ?? {};
      if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });

      const user = await db.queryOne(`SELECT id FROM users WHERE email=LOWER($1)`, [email]);
      // Always return success to prevent email enumeration
      if (!user) return res.json({ success: true });

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await hashPIN(rawToken.slice(0, 4)); // reuse hashPIN for storage
      // Store full token hash separately
      const fullHash = require("crypto").createHash("sha256").update(rawToken).digest("hex");
      const expires  = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.query(
        `UPDATE users SET reset_token_hash=$1, reset_token_expires=$2 WHERE id=$3`,
        [fullHash, expires, user.id]
      );

      await sendPINResetEmail(email, rawToken);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Auth] Forgot PIN error:", e.message);
      res.status(500).json({ error: "Failed to send reset email" });
    }
  });

  // POST /api/auth/reset-pin
  app.post("/api/auth/reset-pin", async (req: Request, res: Response) => {
    try {
      const { token, pin } = req.body ?? {};
      if (!token || !isValidPIN(pin))
        return res.status(400).json({ error: "Invalid request" });

      const tokenHash = require("crypto").createHash("sha256").update(token).digest("hex");
      const user = await db.queryOne(
        `SELECT id FROM users WHERE reset_token_hash=$1 AND reset_token_expires > NOW()`,
        [tokenHash]
      );
      if (!user) return res.status(400).json({ error: "Reset link is invalid or has expired" });

      const pinHash = await hashPIN(pin);
      await db.query(
        `UPDATE users SET pin_hash=$1, pin_plain=$2, reset_token_hash=NULL, reset_token_expires=NULL WHERE id=$3`,
        [pinHash, pin, user.id]
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to reset PIN" });
    }
  });

  // GET /api/auth/billing-portal — stub (no payment processor)
  app.get("/api/auth/stripe-portal", requireAuth, async (_req: Request, res: Response) => {
    res.json({ url: null });
  });

  // POST /api/auth/upgrade-checkout — upgrade tier directly, no payment
  app.post("/api/auth/upgrade-checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const { tier } = req.body ?? {};
      if (tier !== "basic" && tier !== "pro")
        return res.status(400).json({ error: "Invalid tier" });
      await db.query(
        `UPDATE users SET tier=$1, sub_status='active', updated_at=NOW() WHERE id=$2`,
        [tier, req.user!.userId]
      );
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Upgrade] Error:", e.message);
      res.status(500).json({ error: "Upgrade failed" });
    }
  });


  // Ensure ml_data directory exists
  const ML_DATA_RUNTIME = path.join(__dirname, "ml_data");
  if (!fs.existsSync(ML_DATA_RUNTIME)) fs.mkdirSync(ML_DATA_RUNTIME, { recursive: true });
  ["pick_snapshots.json", "bet_outcome_log.json", "graded_ids.json", "bts_picks.json"].forEach(f => {
    const p = path.join(ML_DATA_RUNTIME, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, "[]");
  });

  // ML data pull is started at module load (see top of file) — just track completion for scanner gate.
  let mlPullDone = false;
  _mlPullPromise
    .then(() => { mlPullDone = true; console.log("[MLSync] startup pull complete"); })
    .catch((e: any) => { mlPullDone = true; console.warn("[MLSync] startup pull error:", e.message); });

  // Start smart wallet tracker at server boot (fire-and-forget)
  startSmartWalletTracker();

  // Initialise MLB analytics (FanGraphs Steamer + park factors) at boot
  initMlbAnalytics().catch((e: any) => console.warn("[MLB-Analytics] Init error:", e.message));

  // Player Intel API routes (/api/intel/*)
  registerPlayerIntelRoutes(app);

  // ─── Bets ─────────────────────────────────────────────────────────────────
  app.get("/api/bets", async (req, res) => {
    try {
      const betsRaw = await storage.getBets();

      // ── MLB prop filter: only allowed stat types, stolen bases OVER only ──────
      const MLB_BANNED_STATS = new Set([
        "triples", "hits+runs+rbis", "h+r+rbi",
      ]);
      const bets = betsRaw.filter(bet => {
        if (bet.sport !== "MLB" || bet.betType !== "player_prop") return true;
        const statRaw = ((bet.teamStats as any)?.statType ?? "").toLowerCase();
        if (MLB_BANNED_STATS.has(statRaw)) return false;
        // Stolen Bases + Home Runs: only show OVER
        if (statRaw === "stolen bases" || statRaw === "stolen_bases" || statRaw === "home runs" || statRaw === "home_runs") {
          const side = ((bet.teamStats as any)?.pickSide ?? "").toUpperCase();
          if (side === "UNDER") return false;
        }
        return true;
      });

      // Sort all bets by confidenceScore descending (fix: was using 'confidence' which is always undefined)
      const sorted = [...bets].sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));

      // Player props: top 50 per sport, but ALWAYS include lotto bets (up to 20 per sport)
      const PROPS_PER_SPORT = 50;
      const LOTTO_PER_SPORT = 20;
      const propsBySport: Record<string, any[]> = {};
      const lottoBySport: Record<string, any[]> = {};

      // First pass: collect lotto props (guaranteed to appear)
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        if (!bet.isLotto) continue;
        const sport = bet.sport ?? 'OTHER';
        if (!lottoBySport[sport]) lottoBySport[sport] = [];
        if (lottoBySport[sport].length < LOTTO_PER_SPORT) {
          lottoBySport[sport].push(bet);
        }
      }

      // Second pass: fill remaining slots with non-lotto props up to PROPS_PER_SPORT
      const lottoIds = new Set(Object.values(lottoBySport).flat().map(b => b.id));
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        if (lottoIds.has(bet.id)) continue; // already included as lotto
        const sport = bet.sport ?? 'OTHER';
        const lottoCount = lottoBySport[sport]?.length ?? 0;
        if (!propsBySport[sport]) propsBySport[sport] = [];
        if (propsBySport[sport].length < PROPS_PER_SPORT - lottoCount) {
          propsBySport[sport].push(bet);
        }
      }

      // Merge lotto + regular props per sport
      const limitedProps: any[] = [];
      const allSports = Array.from(new Set([...Object.keys(propsBySport), ...Object.keys(lottoBySport)]));
      for (const sport of allSports) {
        limitedProps.push(...(lottoBySport[sport] ?? []));
        limitedProps.push(...(propsBySport[sport] ?? []));
      }

      // Season bets (futures — no gameTime): top 50 total
      const SEASON_LIMIT = 50;
      const seasonBets = sorted
        .filter(b => b.betType !== 'player_prop' && !b.gameTime)
        .slice(0, SEASON_LIMIT);

      // Team bets (spreads/totals/moneylines with gameTime): top 200 total
      const TEAM_LIMIT = 200;
      const teamBets = sorted
        .filter(b => b.betType !== 'player_prop' && b.gameTime)
        .slice(0, TEAM_LIMIT);

      // ── Game-time enrichment: fill null gameTime on bets using ActionNetwork data ──
      // Kalshi returns null expected_expiration_time, so player props often lack gameTime.
      // refreshGameTimeLookup() runs at startup and every 15 min, populating GAME_TIME_LOOKUP
      // and TEAM_WORD_LOOKUP with today's game times from ActionNetwork.
      await refreshGameTimeLookup(); // no-op if called recently (cached 15 min)
      const allBetsOut = [...limitedProps, ...teamBets, ...seasonBets];

      if (GAME_TIME_LOOKUP.size > 0 || TEAM_WORD_LOOKUP.size > 0) {
        for (const b of allBetsOut) {
          if (b.gameTime) continue; // already has a time
          if (b.betType === "futures" || b.betType === "season_prop") continue;

          let matched: string | undefined;

          // 1. Exact full-name matchup: "golden state warriors::boston celtics"
          if (b.awayTeam && b.homeTeam) {
            const key = `${b.awayTeam.toLowerCase()}::${b.homeTeam.toLowerCase()}`;
            matched = GAME_TIME_LOOKUP.get(key);
          }

          // 2. Partial matchup: check each lookup entry for both team words
          if (!matched && b.awayTeam && b.homeTeam) {
            const awayLast = (b.awayTeam.split(" ").pop() ?? "").toLowerCase();
            const homeLast = (b.homeTeam.split(" ").pop() ?? "").toLowerCase();
            if (awayLast.length > 3 && homeLast.length > 3) {
              for (const [k, v] of Array.from(GAME_TIME_LOOKUP)) {
                if (k.includes(awayLast) && k.includes(homeLast)) {
                  matched = v;
                  break;
                }
              }
            }
          }

          // 3. Fallback: match any individual team word
          if (!matched) {
            const words = [
              ...(b.awayTeam ?? "").split(" "),
              ...(b.homeTeam ?? "").split(" "),
            ].map(w => w.toLowerCase().trim()).filter(w => w.length > 4);
            for (const w of words) {
              const t = TEAM_WORD_LOOKUP.get(w);
              if (t) { matched = t; break; }
            }
          }

          if (matched) {
            b.gameTime = new Date(matched);
          }
        }
      }

      res.json(allBetsOut);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bets/high-confidence", async (req, res) => {
    try {
      const threshold = parseInt(req.query.threshold as string) || 85;
      const bets = await storage.getHighConfidenceBets(threshold);
      res.json(bets);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lookup by slug (for /picks/:slug and /lotto/:slug URLs)
  app.get("/api/bets/by-slug/:slug", async (req, res) => {
    try {
      const bets = await storage.getBets();
      const bet = bets.find((b) => b.slug === req.params.slug);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bets/:id", async (req, res) => {
    try {
      const bet = await storage.getBetById(req.params.id);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/bets/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const bet = await storage.updateBetStatus(req.params.id, status);
      if (!bet) return res.status(404).json({ error: "Bet not found" });

      // ML outcome log — only for definitive results
      if (status === "won" || status === "lost") {
        logMLOutcome({
          bet_id:     bet.id,
          sport:      (bet as any).sport ?? null,
          bet_type:   (bet as any).betType ?? null,
          pick_side:  (bet as any).teamStats ? (bet as any).teamStats.pickSide ?? null : null,
          line:       (bet as any).line ?? null,
          stat_value: null,
          confidence: (bet as any).confidenceScore ?? null,
          outcome:    status,
          title:      (bet as any).title ?? null,
          player:     (bet as any).playerName ?? null,
          graded_at:  new Date().toISOString(),
          source:     "manual",
        });
      }

      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/bets/:id", async (req, res) => {
    try {
      await storage.deleteBet(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // ─── ML Self-Learning Endpoints ──────────────────────────────────────────

  // GET /api/ml-insights — return latest ML insights JSON transformed for UI
  app.get("/api/ml-insights", async (_req, res) => {
    try {
      // Await the startup GitHub pull so we never serve stale empty data after a redeploy
      await Promise.race([getMLPullPromise(), new Promise(r => setTimeout(r, 30000))]);

      const EMPTY = {
        overall: { total: 0, won: 0, lost: 0, push: 0, win_rate: null },
        by_sport: {}, by_bet_type: {}, by_conf_tier: {}, by_week: [],
        strengths: [], weaknesses: [], patterns: [],
        last_run: null, sample_size: 0,
      };

      if (!fs.existsSync(ML_INSIGHTS_FILE)) return res.json(EMPTY);

      const raw = JSON.parse(fs.readFileSync(ML_INSIGHTS_FILE, "utf-8"));
      if (raw.status === "insufficient_data" || !raw.accuracy) return res.json({ ...EMPTY, message: raw.message });

      const acc = raw.accuracy ?? {};

      // ── overall ──
      const overall = {
        total:    acc.total    ?? 0,
        won:      acc.won      ?? 0,
        lost:     acc.lost     ?? 0,
        push:     acc.push     ?? 0,
        win_rate: acc.win_rate ?? null,
        roi_est:  acc.roi_est  ?? null,
      };

      // ── by_sport ──
      const by_sport: Record<string, any> = {};
      for (const [sport, s] of Object.entries(acc.by_sport ?? {})) {
        const sv = s as any;
        by_sport[sport] = { won: sv.won, lost: sv.lost, push: 0, win_rate: sv.win_rate, sample: sv.won + sv.lost };
      }

      // ── by_bet_type ──
      const by_bet_type: Record<string, any> = {};
      for (const [type, t] of Object.entries(acc.by_type ?? {})) {
        const tv = t as any;
        by_bet_type[type] = { won: tv.won, lost: tv.lost, push: 0, win_rate: tv.win_rate, sample: tv.won + tv.lost };
      }

      // ── by_conf_tier (with expected rates) ──
      const EXPECTED: Record<string, number> = { elite: 0.85, high: 0.72, medium: 0.58, low: 0.45 };
      const by_conf_tier: Record<string, any> = {};
      for (const [tier, c] of Object.entries(acc.by_conf_tier ?? {})) {
        const cv = c as any;
        by_conf_tier[tier] = { won: cv.won, lost: cv.lost, push: 0, win_rate: cv.win_rate, sample: cv.won + cv.lost, expected_rate: EXPECTED[tier] ?? 0.5 };
      }

      // ── by_week ──
      const by_week = Object.entries(acc.weekly ?? {}).map(([week, w]) => {
        const wv = w as any;
        return { week, won: wv.won, lost: wv.lost, win_rate: wv.win_rate, sample: wv.won + wv.lost };
      });

      // ── strengths / weaknesses from insights ──
      const strengths:  string[] = [];
      const weaknesses: string[] = [];
      for (const ins of (raw.insights ?? [])) {
        if (ins.type === "strength" || (ins.type === "sport" && (ins.adj ?? 0) > 0) || (ins.type === "calibration" && (ins.adj ?? 0) > 0)) {
          strengths.push(ins.title + (ins.detail ? " — " + ins.detail : ""));
        } else if (ins.type === "weakness" || (ins.type === "sport" && (ins.adj ?? 0) < 0) || (ins.type === "calibration" && (ins.adj ?? 0) < 0)) {
          weaknesses.push(ins.title + (ins.detail ? " — " + ins.detail : ""));
        }
      }

      // ── top patterns ──
      const patterns = Object.entries(raw.patterns ?? {})
        .filter(([, p]: any) => p.total >= 5)
        .map(([key, p]: any) => ({
          pattern: key.replace(/\|/g, " + ").replace(/_/g, " ").replace(/:/g, ": "),
          win_rate: Math.round(p.win_rate * 100),
          sample: Math.round(p.total),
          insight: p.win_rate >= 0.55
            ? `Strong pattern: ${Math.round(p.win_rate * 100)}% win rate across ${Math.round(p.total)} picks.`
            : p.win_rate <= 0.45
            ? `Weak pattern: only ${Math.round(p.win_rate * 100)}% win rate — model adjusting down.`
            : `Neutral pattern: ${Math.round(p.win_rate * 100)}% win rate — near baseline.`,
        }))
        .sort((a, b) => Math.abs(b.win_rate - 50) - Math.abs(a.win_rate - 50))
        .slice(0, 10);

      return res.json({
        overall, by_sport, by_bet_type, by_conf_tier, by_week,
        strengths: strengths.slice(0, 5),
        weaknesses: weaknesses.slice(0, 5),
        patterns,
        last_run:    raw.last_run ?? null,
        sample_size: acc.total ?? 0,
        weights:     raw.weights ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ml/run — trigger ML engine run (admin / nightly cron)
  app.post("/api/ml/run", async (_req, res) => {
    try {
      const result = await runMLEngine();
      res.json({ status: "ok", ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ml/grade — run auto-grader then ML engine
  app.post("/api/ml/grade", async (_req, res) => {
    try {
      const graderResult = await runAutoGrader();
      const mlResult     = runMLEngine();
      // Sync ml_data to GitHub so outcomes survive redeploys
      syncMLDataToGitHub().catch((e: any) => console.warn("[MLSync] GitHub sync error:", e.message));
      res.json({ status: "ok", grader: graderResult, ml: mlResult });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ml/snapshots — how many picks have been logged
  app.get("/api/ml/snapshots", async (_req, res) => {
    try {
      // Await startup pull — ensures Railway redeployments don't wipe history
      await Promise.race([getMLPullPromise(), new Promise(r => setTimeout(r, 30000))]);
      const snapFile = path.join(__dirname, "ml_data", "pick_snapshots.json");
      const outFile  = path.join(__dirname, "ml_data", "bet_outcome_log.json");
      const snaps    = fs.existsSync(snapFile)  ? JSON.parse(fs.readFileSync(snapFile,  "utf8")) : [];
      const outcomes = fs.existsSync(outFile)   ? JSON.parse(fs.readFileSync(outFile,   "utf8")) : [];
      const graded   = outcomes.filter((o: any) => o.result && o.result !== "open");
      const won      = graded.filter((o: any) => o.result === "won").length;
      const lost     = graded.filter((o: any) => o.result === "lost").length;
      res.json({
        snapshots: snaps.length,
        graded:    graded.length,
        open:      snaps.length - graded.length,
        won, lost,
        win_rate:  graded.length > 0 ? Math.round((won / (won + lost || 1)) * 1000) / 10 : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ml/graded-picks — full list of graded picks for the ML history log
  app.get("/api/ml/graded-picks", async (_req, res) => {
    try {
      // Await startup pull — ensures Railway redeployments don't wipe history
      await Promise.race([getMLPullPromise(), new Promise(r => setTimeout(r, 30000))]);
      const outFile = path.join(__dirname, "ml_data", "bet_outcome_log.json");
      if (!fs.existsSync(outFile)) return res.json([]);
      const outcomes: any[] = JSON.parse(fs.readFileSync(outFile, "utf8"));
      // Return newest first, include all fields the UI needs
      const picks = outcomes
        .filter((o: any) => o.result && o.result !== "open")
        .sort((a: any, b: any) => (b.gradedAt ?? "").localeCompare(a.gradedAt ?? ""))
        .map((o: any) => ({
          id:              o.betId ?? o.id ?? null,
          title:           o.title ?? null,
          sport:           o.sport ?? null,
          betType:         o.betType ?? null,
          playerName:      o.playerName ?? null,
          statCategory:    o.statCategory ?? null,
          line:            o.line ?? null,
          pickSide:        o.pickSide ?? null,
          result:          o.result,             // "won" | "lost" | "push"
          confidenceScore: o.confidenceScore ?? null,
          gameTime:        o.gameTime ?? null,
          gameDate:        o.gameDate ?? null,
          gradedAt:        o.gradedAt ?? null,
          homeTeam:        o.homeTeam ?? null,
          awayTeam:        o.awayTeam ?? null,
          homeScore:       o.homeScore ?? null,
          awayScore:       o.awayScore ?? null,
          source:          o.source ?? (o.betId?.startsWith("action") ? "ActionNetwork"
                           : o.betId?.startsWith("lm-") ? "Linemate"
                           : o.betId?.startsWith("pinnacle") ? "Pinnacle"
                           : o.betId?.startsWith("kalshi") ? "Kalshi"
                           : "Internal"),
        }));
      res.json(picks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ml/export — dump all ml_data files as JSON for backup
  app.get("/api/ml/export", (_req, res) => {
    const dir = path.join(__dirname, "ml_data");
    const files = ["pick_snapshots.json", "bet_outcome_log.json", "graded_ids.json", "ml_weights.json", "ml_insights.json", "bts_picks.json", "bts_ml_weights.json", "bts_ml_learning_log.json"];
    const result: Record<string, any> = {};
    const errors: Record<string, string> = {};
    for (const f of files) {
      try {
        const fp = path.join(dir, f);
        result[f] = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null;
      } catch (e: any) {
        // Return empty fallback so the export never 500s due to one bad file
        console.error(`[ml/export] Failed to read ${f}: ${e.message}`);
        errors[f] = e.message;
        result[f] = f.includes("snapshots") || f.includes("outcome") || f.includes("graded_ids") ? [] : {};
      }
    }
    if (Object.keys(errors).length > 0) {
      (result as any)._errors = errors;
    }
    res.json(result);
  });

  // GET /api/bts-ml-weights — current BTS ML learning weights + tier accuracy + calibration
  app.get("/api/bts-ml-weights", (_req, res) => {
    try {
      const wFile = path.join(ML_DATA_DIR, "bts_ml_weights.json");
      if (fs.existsSync(wFile)) {
        const data = JSON.parse(fs.readFileSync(wFile, "utf-8"));
        return res.json(data);
      }
      return res.json({
        version: 0,
        sampleSize: 0,
        updatedAt: null,
        featureWeights: {
          recentForm: 1.00, contactQuality: 1.00, hardContact: 1.00,
          pitcherMatchup: 1.00, opportunity: 1.00, bvp: 1.00,
          stability: 1.00, weatherImpact: 1.00, gameTotal: 1.00,
        },
        featureAccuracy: {},
        tierAccuracy: {},
        calibration: [],
        message: "No ML learning run yet — will run nightly after 10+ graded picks.",
      });
    } catch (e: any) {
      console.error("[BTS-ML] weights endpoint error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/bts-ml-learn — manually trigger a BTS ML learning run (dev/admin)
  app.post("/api/bts-ml-learn", async (_req, res) => {
    try {
      await runBtsMlLearning();
      const wFile = path.join(ML_DATA_DIR, "bts_ml_weights.json");
      if (fs.existsSync(wFile)) {
        const data = JSON.parse(fs.readFileSync(wFile, "utf-8"));
        return res.json({ success: true, ...data });
      }
      return res.json({ success: true, message: "Run complete but no weights written (need 10+ graded picks)." });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Scanner ──────────────────────────────────────────────────────────────
  app.post("/api/scan", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      // Push real-time update to all connected clients
      const allBets = await storage.getBets();
      broadcast("bets:updated", { scanned: result.scanned, total: allBets.length });
      // Log picks for ML self-learning
      try { logPicks(allBets); } catch(e: any) { console.warn("[PickLogger] error:", e.message); }
      // Fire high-confidence alerts for any bet ≥ 80
      const highConf = allBets.filter((b: any) => (b.confidenceScore ?? 0) >= 85);
      if (highConf.length > 0) {
        broadcast("bets:highconf", { count: highConf.length, top: highConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })) });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Live Price Poll status ──────────────────────────────────────────────
  // Returns timestamp of last poll and how many prices changed
  app.get("/api/live-poll", async (_req, res) => {
    res.json({
      lastPollAt: lastLivePoll.ts ? new Date(lastLivePoll.ts).toISOString() : null,
      changedCount: lastLivePoll.changed,
      pollIntervalMs: 30000,
    });
  });

  // ─── Prediction Markets — Kalshi + Polymarket Gamma + Polymarket CLOB + Manifold
  // Fair value = consensus of (Polymarket mid-price + Manifold probability) when available,
  // otherwise falls back to Polymarket market price alone.
  // Cache: 30 seconds (same cadence as the live poller)
  let predMktCache: { data: any[]; ts: number } = { data: [], ts: 0 };
  const PRED_MKT_TTL = 30_000;

  // Pre-fetch Manifold sports markets once per cache cycle (free, no auth)
  async function fetchManifoldSports(): Promise<Map<string, number>> {
    // Returns map of normalised title → probability (0-1)
    try {
      const { data } = await axios.get("https://api.manifold.markets/v0/markets", {
        params: { limit: 500, sort: "liquidity", filter: "open" },
        timeout: 8000,
      });
      const map = new Map<string, number>();
      for (const m of (data as any[])) {
        const cats: string[] = m.groupSlugs ?? [];
        const isSports = cats.some((c: string) => [
          "sports","nfl","nba","mlb","nhl","football","basketball","baseball","hockey",
          "soccer","tennis","golf","mma","boxing",
        ].includes(c.toLowerCase()));
        if (!isSports) continue;
        const prob = typeof m.probability === "number" ? m.probability : null;
        if (prob === null) continue;
        const key = (m.question ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (key) map.set(key, prob);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  // Pre-fetch Polymarket CLOB mid-prices for a set of condition IDs (no auth required)
  async function fetchClobMidPrices(conditionIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (conditionIds.length === 0) return map;
    try {
      // CLOB /prices endpoint: POST with array of token IDs (YES outcome token)
      const { data } = await axios.post("https://clob.polymarket.com/prices",
        conditionIds.map(id => ({ token_id: id })),
        { timeout: 8000, headers: { "Content-Type": "application/json" } }
      );
      for (const entry of (Array.isArray(data) ? data : [])) {
        if (entry.token_id && typeof entry.price === "number") {
          map.set(entry.token_id, entry.price);
        }
      }
    } catch { /* CLOB optional enrichment */ }
    return map;
  }

  // Compute consensus fair value from available signals
  function computeFairValue(signals: number[]): number {
    if (signals.length === 0) return 0.50;
    const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
    return Math.min(0.95, Math.max(0.05, avg));
  }

  // Fuzzy title match against Manifold map (token-overlap score)
  function findManifoldMatch(title: string, manifoldMap: Map<string, number>): number | null {
    const words = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 3);
    if (words.length < 2) return null;
    let best: number | null = null;
    let bestScore = 0;
    for (const [key, prob] of Array.from(manifoldMap)) {
      const overlap = words.filter(w => key.includes(w)).length;
      const score = overlap / words.length;
      if (score >= 0.55 && score > bestScore) {
        best = prob;
        bestScore = score;
      }
    }
    return best;
  }

  app.get("/api/prediction-markets", async (_req, res) => {
    try {
      // Serve from cache if fresh
      if (Date.now() - predMktCache.ts < PRED_MKT_TTL && predMktCache.data.length > 0) {
        return res.json(predMktCache.data);
      }

      const POLY_BASE   = "https://gamma-api.polymarket.com";
      const KALSHI_BASE  = "https://api.elections.kalshi.com/trade-api/v2";
      // ── Whale/smart-money thresholds (calibrated to real API data) ──
      // Polymarket: oneHourPriceChange is rarely available; use volume24hr spike + price change combo
      // Whale = single large institutional purchase: vol24hr >= $100K on Polymarket.
      // This is the only signal that reliably indicates a whale — a huge single-day
      // money flow that moves price. Price moves alone are noise; only raw dollar
      // volume at this scale implies a single large buyer/seller.
      const WHALE_ABS_VOL         = 100_000; // $100K+ vol24h = confirmed whale
      // Kalshi: much lower liquidity pool. $5K+ 24h vol OR 5¢+ price move from prev.
      const KALSHI_WHALE_VOL      = 5_000;   // $5K in 24h Kalshi volume = whale
      const KALSHI_PREV_PRICE_DELTA = 0.05;  // 5¢ move from previous = smart money
      const PER_CATEGORY_LIMIT    = 100;     // Show 100 most popular per sport category

      const results: any[] = [];

      // ── Fetch Manifold sports markets in parallel (free, no auth) ──────────
      const manifoldMap = await fetchManifoldSports();
      console.log(`[pred-mkt] Manifold: ${manifoldMap.size} sports markets loaded`);

      // Helper: compute fair value + rating from multi-source signals
      // Target logic:
      //   - Minimum ROI on the contract: 10% (e.g. 50¢ entry → 55¢ target)
      //   - Base ROI when edge detected: 15%
      //   - High-confluence (multi-signal): 20–25%
      //   - Single-source only (no Manifold/CLOB confirmation): use 10% floor
      //   - Overpriced markets: fade target = entry - same ROI (price must fall)
      const rateMarket = (
        title: string,
        marketPrice: number,
        clobMid: number | null,
        extraSignals?: { isWhale?: boolean; crossValidated?: boolean }
      ) => {
        const signals: number[] = [marketPrice];
        if (clobMid !== null) signals.push(clobMid);
        const manifoldProb = findManifoldMatch(title, manifoldMap);
        if (manifoldProb !== null) signals.push(manifoldProb);

        const fairValue   = computeFairValue(signals);
        const rawEdge     = fairValue - marketPrice;       // signed: + = buy, - = overpriced
        const absEdge     = Math.abs(rawEdge);
        const signalCount = signals.length;

        // ── Confluence score: how many independent signals agree ──────────
        // Each additional confirming signal adds confidence → higher target ROI
        let confluenceBonus = 0;
        if (signalCount >= 3)                   confluenceBonus += 1; // Manifold + CLOB + Gamma all align
        if (extraSignals?.isWhale)              confluenceBonus += 1; // whale money flowing in
        if (extraSignals?.crossValidated)       confluenceBonus += 1; // Kalshi/Poly cross-confirmed
        if (absEdge >= 0.08)                    confluenceBonus += 1; // very large raw edge

        // ── Minimum ROI floor (applied on entry price, not $1 face value) ─
        // floor = 10%, base = 15%, +5% per confluence point, cap 30%
        const MIN_ROI    = 0.10;
        const BASE_ROI   = 0.15;
        const targetRoi  = Math.min(0.30, BASE_ROI + confluenceBonus * 0.05);

        // For single-source markets (only Gamma signal, no CLOB or Manifold),
        // pull back to the floor — we have less conviction
        const effectiveRoi = signalCount === 1 ? MIN_ROI : targetRoi;

        // ── Price rating based on raw edge ────────────────────────────────
        let priceRating: string;
        if (Math.abs(rawEdge) < 0.03)  priceRating = "fair";
        else if (rawEdge >= 0.08)      priceRating = "great_buy";
        else if (rawEdge >= 0.03)      priceRating = "good_buy";
        else                           priceRating = "overpriced";

        // ── Entry / target prices ─────────────────────────────────────────
        // There is no shorting. Every trade is buying a contract (YES or NO).
        //
        // YES markets (great_buy / good_buy / fair):
        //   Entry = current YES price
        //   Target = entry + (entry × effectiveRoi), capped at 99¢
        //
        // NO markets (overpriced YES = good NO buy):
        //   Entry = NO price (= 1 - YES price), because that's what you pay
        //   Target = noEntry + (noEntry × effectiveRoi), capped at 99¢
        //   The NO contract pays $1.00 if the event does NOT happen
        const noPrice   = Math.round((1 - marketPrice) * 100) / 100;
        let entry: number;
        let exitTarget: number;
        if (priceRating === "overpriced") {
          // Recommend buying NO contract instead
          entry      = noPrice;
          exitTarget = Math.min(0.99, entry + entry * effectiveRoi);
        } else {
          entry      = marketPrice;
          exitTarget = Math.min(0.99, entry + entry * effectiveRoi);
        }

        // Edge % for display — always positive (we always recommend the correct side)
        const displayEdge = Math.round(effectiveRoi * 1000) / 10;

        return {
          fairValue,
          edge:        displayEdge,
          priceRating,
          entryPrice:  Math.round(entry * 100) / 100,
          exitTarget:  Math.round(exitTarget * 100) / 100,
          signalCount,
        };
      }

      // ── City/nickname → Full team name lookup ─────────────────────────────
      // Covers every city or short name that prediction markets use.
      // When a leg is just "Boston" we resolve it to the full franchise name
      // using the sport context so "Boston" → "Boston Celtics" (NBA) or
      // "Boston Red Sox" (MLB) or "Boston Bruins" (NHL).
      const TEAM_FULL_NAME: Record<string, Record<string, string>> = {
        NBA: {
          "Atlanta": "Atlanta Hawks", "Boston": "Boston Celtics",
          "Brooklyn": "Brooklyn Nets", "Charlotte": "Charlotte Hornets",
          "Chicago": "Chicago Bulls", "Cleveland": "Cleveland Cavaliers",
          "Dallas": "Dallas Mavericks", "Denver": "Denver Nuggets",
          "Detroit": "Detroit Pistons", "Golden State": "Golden State Warriors",
          "Houston": "Houston Rockets", "Indiana": "Indiana Pacers",
          "Los Angeles Clippers": "LA Clippers", "Los Angeles Lakers": "LA Lakers",
          "LA Clippers": "LA Clippers", "LA Lakers": "LA Lakers",
          "Memphis": "Memphis Grizzlies", "Miami": "Miami Heat",
          "Milwaukee": "Milwaukee Bucks", "Minnesota": "Minnesota Timberwolves",
          "New Orleans": "New Orleans Pelicans", "New York": "New York Knicks",
          "Oklahoma City": "Oklahoma City Thunder", "OKC": "Oklahoma City Thunder",
          "Orlando": "Orlando Magic", "Philadelphia": "Philadelphia 76ers",
          "Phoenix": "Phoenix Suns", "Portland": "Portland Trail Blazers",
          "Sacramento": "Sacramento Kings", "San Antonio": "San Antonio Spurs",
          "Toronto": "Toronto Raptors", "Utah": "Utah Jazz",
          "Washington": "Washington Wizards",
          "Celtics": "Boston Celtics", "Lakers": "LA Lakers",
          "Warriors": "Golden State Warriors", "Knicks": "New York Knicks",
          "Bulls": "Chicago Bulls", "Heat": "Miami Heat",
          "Bucks": "Milwaukee Bucks", "Nets": "Brooklyn Nets",
          "Nuggets": "Denver Nuggets", "Suns": "Phoenix Suns",
          "Clippers": "LA Clippers", "Mavericks": "Dallas Mavericks",
          "Mavs": "Dallas Mavericks", "Thunder": "Oklahoma City Thunder",
          "Spurs": "San Antonio Spurs", "Rockets": "Houston Rockets",
          "Grizzlies": "Memphis Grizzlies", "Pelicans": "New Orleans Pelicans",
          "Magic": "Orlando Magic", "Raptors": "Toronto Raptors",
          "Hornets": "Charlotte Hornets", "Pacers": "Indiana Pacers",
          "Kings": "Sacramento Kings", "Jazz": "Utah Jazz",
          "Pistons": "Detroit Pistons", "Cavaliers": "Cleveland Cavaliers",
          "Cavs": "Cleveland Cavaliers", "Blazers": "Portland Trail Blazers",
          "Wizards": "Washington Wizards", "Hawks": "Atlanta Hawks",
          "Timberwolves": "Minnesota Timberwolves", "Wolves": "Minnesota Timberwolves",
        },
        MLB: {
          "Arizona": "Arizona Diamondbacks", "Atlanta": "Atlanta Braves",
          "Baltimore": "Baltimore Orioles", "Boston": "Boston Red Sox",
          "Chicago Cubs": "Chicago Cubs", "Chicago White Sox": "Chicago White Sox",
          "Chicago": "Chicago Cubs", // default to Cubs when ambiguous
          "Cincinnati": "Cincinnati Reds", "Cleveland": "Cleveland Guardians",
          "Colorado": "Colorado Rockies", "Detroit": "Detroit Tigers",
          "Houston": "Houston Astros", "Kansas City": "Kansas City Royals",
          "Los Angeles Dodgers": "Los Angeles Dodgers", "LA Dodgers": "Los Angeles Dodgers",
          "Los Angeles Angels": "Los Angeles Angels", "LA Angels": "Los Angeles Angels",
          "Los Angeles": "Los Angeles Dodgers", // default to Dodgers
          "Miami": "Miami Marlins", "Milwaukee": "Milwaukee Brewers",
          "Minnesota": "Minnesota Twins", "New York Mets": "New York Mets",
          "New York Yankees": "New York Yankees", "New York": "New York Yankees",
          "Oakland": "Oakland Athletics", "Philadelphia": "Philadelphia Phillies",
          "Pittsburgh": "Pittsburgh Pirates", "San Diego": "San Diego Padres",
          "San Francisco": "San Francisco Giants", "Seattle": "Seattle Mariners",
          "St. Louis": "St. Louis Cardinals", "St Louis": "St. Louis Cardinals",
          "Tampa Bay": "Tampa Bay Rays", "Texas": "Texas Rangers",
          "Toronto": "Toronto Blue Jays", "Washington": "Washington Nationals",
          "Yankees": "New York Yankees", "Red Sox": "Boston Red Sox",
          "Dodgers": "Los Angeles Dodgers", "Cubs": "Chicago Cubs",
          "Mets": "New York Mets", "Astros": "Houston Astros",
          "Braves": "Atlanta Braves",
          "Phillies": "Philadelphia Phillies",
          "Padres": "San Diego Padres", "Brewers": "Milwaukee Brewers",
          "Mariners": "Seattle Mariners",
          "Tigers": "Detroit Tigers",
          "Royals": "Kansas City Royals", "Twins": "Minnesota Twins",
          "Guardians": "Cleveland Guardians", "Orioles": "Baltimore Orioles",
          "Rockies": "Colorado Rockies", "Reds": "Cincinnati Reds",
          "Marlins": "Miami Marlins", "Rays": "Tampa Bay Rays",
          "Athletics": "Oakland Athletics", "A's": "Oakland Athletics",
          "Pirates": "Pittsburgh Pirates", "Nationals": "Washington Nationals",
          "Diamondbacks": "Arizona Diamondbacks", "D-backs": "Arizona Diamondbacks",
          "Blue Jays": "Toronto Blue Jays",
        },
        NHL: {
          "Anaheim": "Anaheim Ducks", "Arizona": "Arizona Coyotes",
          "Boston": "Boston Bruins", "Buffalo": "Buffalo Sabres",
          "Calgary": "Calgary Flames", "Carolina": "Carolina Hurricanes",
          "Chicago": "Chicago Blackhawks", "Colorado": "Colorado Avalanche",
          "Columbus": "Columbus Blue Jackets", "Dallas": "Dallas Stars",
          "Detroit": "Detroit Red Wings", "Edmonton": "Edmonton Oilers",
          "Florida": "Florida Panthers", "Los Angeles": "Los Angeles Kings",
          "LA Kings": "Los Angeles Kings", "Minnesota": "Minnesota Wild",
          "Montreal": "Montreal Canadiens", "Nashville": "Nashville Predators",
          "New Jersey": "New Jersey Devils", "New York Islanders": "New York Islanders",
          "New York Rangers": "New York Rangers", "New York": "New York Rangers",
          "Ottawa": "Ottawa Senators", "Philadelphia": "Philadelphia Flyers",
          "Pittsburgh": "Pittsburgh Penguins", "San Jose": "San Jose Sharks",
          "Seattle": "Seattle Kraken", "St. Louis": "St. Louis Blues",
          "St Louis": "St. Louis Blues", "Tampa Bay": "Tampa Bay Lightning",
          "Toronto": "Toronto Maple Leafs", "Utah": "Utah Mammoth",
          "Vancouver": "Vancouver Canucks", "Vegas": "Vegas Golden Knights",
          "Golden Knights": "Vegas Golden Knights", "Washington": "Washington Capitals",
          "Winnipeg": "Winnipeg Jets",
          "Bruins": "Boston Bruins", "Sabres": "Buffalo Sabres",
          "Flames": "Calgary Flames", "Hurricanes": "Carolina Hurricanes",
          "Blackhawks": "Chicago Blackhawks", "Avalanche": "Colorado Avalanche",
          "Blue Jackets": "Columbus Blue Jackets", "Stars": "Dallas Stars",
          "Red Wings": "Detroit Red Wings", "Oilers": "Edmonton Oilers",
          "Kings": "Los Angeles Kings",
          "Wild": "Minnesota Wild", "Canadiens": "Montreal Canadiens",
          "Predators": "Nashville Predators", "Preds": "Nashville Predators",
          "Devils": "New Jersey Devils", "Islanders": "New York Islanders",
          "Senators": "Ottawa Senators",
          "Flyers": "Philadelphia Flyers", "Penguins": "Pittsburgh Penguins",
          "Sharks": "San Jose Sharks", "Kraken": "Seattle Kraken",
          "Blues": "St. Louis Blues", "Lightning": "Tampa Bay Lightning",
          "Maple Leafs": "Toronto Maple Leafs", "Leafs": "Toronto Maple Leafs",
          "Mammoth": "Utah Mammoth", "Canucks": "Vancouver Canucks",
          "Jets": "Winnipeg Jets", "Ducks": "Anaheim Ducks",
        },
        NFL: {
          "Arizona": "Arizona Cardinals", "Atlanta": "Atlanta Falcons",
          "Baltimore": "Baltimore Ravens", "Buffalo": "Buffalo Bills",
          "Carolina": "Carolina Panthers", "Chicago": "Chicago Bears",
          "Cincinnati": "Cincinnati Bengals", "Cleveland": "Cleveland Browns",
          "Dallas": "Dallas Cowboys", "Denver": "Denver Broncos",
          "Detroit": "Detroit Lions", "Green Bay": "Green Bay Packers",
          "Houston": "Houston Texans", "Indianapolis": "Indianapolis Colts",
          "Jacksonville": "Jacksonville Jaguars", "Kansas City": "Kansas City Chiefs",
          "Las Vegas": "Las Vegas Raiders", "Los Angeles Chargers": "Los Angeles Chargers",
          "Los Angeles Rams": "Los Angeles Rams", "Los Angeles": "Los Angeles Rams",
          "Miami": "Miami Dolphins", "Minnesota": "Minnesota Vikings",
          "New England": "New England Patriots", "New Orleans": "New Orleans Saints",
          "New York Giants": "New York Giants", "New York Jets": "New York Jets",
          "New York": "New York Giants", "Philadelphia": "Philadelphia Eagles",
          "Pittsburgh": "Pittsburgh Steelers", "San Francisco": "San Francisco 49ers",
          "Seattle": "Seattle Seahawks", "Tampa Bay": "Tampa Bay Buccaneers",
          "Tennessee": "Tennessee Titans", "Washington": "Washington Commanders",
          "Oklahoma City": "Oklahoma City Thunder", // prediction markets sometimes use wrong sport label
          "Cardinals": "Arizona Cardinals", "Falcons": "Atlanta Falcons",
          "Ravens": "Baltimore Ravens", "Bills": "Buffalo Bills",
          "Panthers": "Carolina Panthers", "Bears": "Chicago Bears",
          "Bengals": "Cincinnati Bengals", "Browns": "Cleveland Browns",
          "Cowboys": "Dallas Cowboys", "Broncos": "Denver Broncos",
          "Lions": "Detroit Lions", "Packers": "Green Bay Packers",
          "Texans": "Houston Texans", "Colts": "Indianapolis Colts",
          "Jaguars": "Jacksonville Jaguars", "Chiefs": "Kansas City Chiefs",
          "Raiders": "Las Vegas Raiders", "Chargers": "Los Angeles Chargers",
          "Rams": "Los Angeles Rams", "Dolphins": "Miami Dolphins",
          "Vikings": "Minnesota Vikings", "Patriots": "New England Patriots",
          "Saints": "New Orleans Saints", "Giants": "New York Giants",
          "Jets": "New York Jets", "Eagles": "Philadelphia Eagles",
          "Steelers": "Pittsburgh Steelers", "49ers": "San Francisco 49ers",
          "Seahawks": "Seattle Seahawks", "Buccaneers": "Tampa Bay Buccaneers",
          "Bucs": "Tampa Bay Buccaneers", "Titans": "Tennessee Titans",
          "Commanders": "Washington Commanders",
        },
        // Soccer / other — leave as-is but capitalize properly
        OTHER: {},
      };

      // Resolve a raw city/nickname string to its full franchise name.
      // Tries sport-specific lookup first, then all other sports if sport is OTHER/unknown.
      const resolveFullTeamName = (raw: string, sport: string): string  =>{
        const s = (sport || "OTHER").toUpperCase();
        const key = raw.trim();
        // Direct match in sport-specific table
        if (TEAM_FULL_NAME[s]?.[key]) return TEAM_FULL_NAME[s][key];
        // Case-insensitive match
        const lkey = key.toLowerCase();
        const table = TEAM_FULL_NAME[s] ?? {};
        for (const [k, v] of Object.entries(table)) {
          if (k.toLowerCase() === lkey) return v;
        }
        // Sport is OTHER or not found — try all sports in priority order
        if (!TEAM_FULL_NAME[s] || s === "OTHER") {
          for (const st of ["NBA", "NHL", "MLB", "NFL"]) {
            const t = TEAM_FULL_NAME[st];
            for (const [k, v] of Object.entries(t)) {
              if (k.toLowerCase() === lkey) return v;
            }
          }
        }
        return raw; // no match — return as-is
      }

      // ── Sport classifier ──────────────────────────────────────────────────
      const classifySport = (title: string, tags: string[], category: string): string  =>{
        const t = title.toLowerCase();
        const c = (category ?? "").toLowerCase();
        const allText = t + " " + tags.join(" ").toLowerCase() + " " + c;
        // Soccer/MLS signals — return Other before any big-4 check to avoid false MLB/NBA tags
        if (/\bfc\b|\bsc\b|\bcf\b|\bmls\b|portland timbers|lafc|inter miami|atlanta united|austin fc|charlotte fc|chicago fire|colorado rapids|columbus crew|dc united|fc cincinnati|fc dallas|houston dynamo|la galaxy|minnesota united|nashville sc|new england revolution|new york city fc|nycfc|orlando city|philadelphia union|real salt lake|san jose|seattle sounders|sporting kc|st\.? louis city|toronto fc|vancouver whitecaps/.test(allText)) return "Other";
        if (/\bnfl\b|football|super bowl|quarterback|touchdown/.test(allText)) return "NFL";
        if (/\bnba\b|basketball|lebron|durant|curry|celtics|lakers|knicks|heat|bucks/.test(allText)) return "NBA";
        if (/\bmlb\b|baseball|world series|home run|strikeout|pitcher|batter|mets|yankees|dodgers|cubs/.test(allText)) return "MLB";
        if (/\bnhl\b|hockey|stanley cup|puck|goal.*scored|mcdavid|ovechkin|crosby/.test(allText)) return "NHL";
        // Extended team-name detection using TEAM_FULL_NAME lookup table
        // This fires AFTER the abbreviation/keyword checks above
        try {
          // Use FULL team names (values) only — not short city keys — to avoid cross-sport city collisions
          // e.g. "Detroit" matches NBA/MLB/NHL/NFL so we skip it; "Detroit Tigers" is unambiguous
          const NBA_FULL = Object.values(TEAM_FULL_NAME.NBA).map((v: any) => (v as string).toLowerCase());
          const MLB_FULL = Object.values(TEAM_FULL_NAME.MLB).map((v: any) => (v as string).toLowerCase());
          const NHL_FULL = Object.values(TEAM_FULL_NAME.NHL).map((v: any) => (v as string).toLowerCase());
          const NFL_FULL = Object.values(TEAM_FULL_NAME.NFL).map((v: any) => (v as string).toLowerCase());
          const wordBoundary = (k: string) => new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
          // Check MLB/NHL/NFL before NBA to reduce ambiguity
          if (MLB_FULL.some(k => wordBoundary(k).test(allText))) return "MLB";
          if (NHL_FULL.some(k => wordBoundary(k).test(allText))) return "NHL";
          if (NFL_FULL.some(k => wordBoundary(k).test(allText))) return "NFL";
          if (NBA_FULL.some(k => wordBoundary(k).test(allText))) return "NBA";
        } catch { /* TEAM_FULL_NAME not yet in scope — fall through */ }
        return "Other";
      }

      // Resolve a raw Polymarket question/title so city-only or nickname team references
      // become full franchise names.  e.g. "Will Boston win?" → "Will Boston Celtics win?"
      const resolvePolymarketTitle = (rawTitle: string): string  =>{
        if (!rawTitle) return rawTitle;
        const tLow = rawTitle.toLowerCase();

        // ── RULE: Only expand team names if we can CONFIRM the sport from explicit keywords.
        // City names like "Boston", "Dallas", "Detroit" exist in NBA/MLB/NHL/NFL — expanding
        // without sport context guarantees wrong-team injection. If no sport keyword → return as-is.

        // Soccer/MLS guard — never expand
        if (/\bfc\b|\bsc\b|\bcf\b|\bmls\b|portland timbers|lafc|inter miami|atlanta united|austin fc|charlotte fc|chicago fire|colorado rapids|columbus crew|dc united|fc cincinnati|fc dallas|houston dynamo|la galaxy|minnesota united|nashville sc|new england revolution|new york city fc|nycfc|orlando city|philadelphia union|real salt lake|san jose earthquakes|seattle sounders|sporting kc|st\.? louis city|toronto fc|vancouver whitecaps/.test(tLow)) {
          return rawTitle;
        }

        // Detect sport from EXPLICIT keywords only (abbreviation or sport name)
        let detectedSport: keyof typeof TEAM_FULL_NAME | null = null;
        if (/\bnfl\b|football|super bowl|quarterback|touchdown/.test(tLow))   detectedSport = "NFL";
        else if (/\bmlb\b|baseball|world series|home run|strikeout|pitcher/.test(tLow)) detectedSport = "MLB";
        else if (/\bnhl\b|hockey|stanley cup|puck/.test(tLow))                 detectedSport = "NHL";
        else if (/\bnba\b|basketball/.test(tLow))                              detectedSport = "NBA";

        // No confirmed sport → don't guess, return raw title unchanged
        if (!detectedSport) return rawTitle;

        // Only apply the confirmed sport's lookup table
        const table = TEAM_FULL_NAME[detectedSport];

        // Nicknames that are ambiguous even within a sport (e.g. Cardinals = MLB StL or NFL AZ)
        const AMBIGUOUS_KEYS = new Set(["Rangers", "Cardinals", "Angels", "Panthers", "Giants", "Stars", "Jets", "Kings"]);

        // If title already contains ANY full team name, skip expansion
        const allFullNames: string[] = [];
        try {
          for (const t of Object.values(TEAM_FULL_NAME)) {
            allFullNames.push(...Object.values(t as Record<string, string>));
          }
        } catch { /**/ }
        if (allFullNames.some(fn => rawTitle.includes(fn))) return rawTitle;

        for (const [key, full] of Object.entries(table)) {
          if (full === key) continue;
          if (AMBIGUOUS_KEYS.has(key)) continue;
          if (rawTitle.includes(full)) continue;
          const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
          if (re.test(rawTitle)) {
            return rawTitle.replace(re, full);
          }
        }
        return rawTitle;
      }

      // ── 1. Polymarket — fetch /markets sorted by liquidity (top 150 per sport category) ──
      // Uses /markets endpoint directly (not events) so we get all price-change fields.
      // Fetches 600 top-liquidity markets across all categories, then caps at 150 per sport.
      const polyEventMap = new Map<string, number>(); // normalised title → yesPrice for cross-validation
      try {
        // Parallel batches:
        //   batch1 — top 100 by liquidity (most popular markets)
        //   batch2 — top 100 by volume24hr (most traded today = most likely to have whales)
        //   batch3 — markets closing soonest (today/imminent events first)
        //   batch4 — next 100 by volume24hr (catch more active markets)
        const todayIso = new Date().toISOString().slice(0, 10);
        const [batch1, batch2, batch3, batch4] = await Promise.allSettled([
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "liquidity",  ascending: false }, timeout: 12000 }),
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "volume24hr", ascending: false }, timeout: 12000 }),
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "end_date_min", ascending: true,  endDateMin: todayIso }, timeout: 12000 }),
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "volume24hr", ascending: false, offset: 100 }, timeout: 12000 }),
        ]);

        // Merge and deduplicate by market id
        const seenIds = new Set<string>();
        const allMarkets: any[] = [];
        for (const batch of [batch1, batch2, batch3, batch4]) {
          if (batch.status !== "fulfilled") continue;
          const data = batch.value.data;
          const mkts = Array.isArray(data) ? data : (data?.markets ?? []);
          for (const m of mkts) {
            const uid = m.id ?? m.conditionId ?? m.questionID;
            if (uid && !seenIds.has(String(uid))) {
              seenIds.add(String(uid));
              allMarkets.push(m);
            }
          }
        }
        console.log(`[pred-mkt] Polymarket raw markets: ${allMarkets.length}`);

        // Classify and bucket by sport, then cap at PER_CATEGORY_LIMIT each
        const buckets: Record<string, any[]> = { NFL: [], NBA: [], MLB: [], NHL: [], Other: [] };
        for (const m of allMarkets) {
          const tagSlugs: string[] = ((m.events ?? [])[0]?.tags ?? []).map((t: any) => t.slug ?? t.label ?? "");
          const rawQ1 = m.question ?? m.groupItemTitle ?? "";
          const sport = classifySport(resolvePolymarketTitle(rawQ1), tagSlugs, "");
          if ((buckets[sport]?.length ?? 0) < PER_CATEGORY_LIMIT) {
            buckets[sport].push(m);
          }
        }
        const cappedMarkets = Object.values(buckets).flat();
        console.log(`[pred-mkt] Polymarket after 150/category cap: ${cappedMarkets.length} markets`);

        // Collect YES token IDs for CLOB mid-price enrichment
        const conditionIds: string[] = [];
        for (const m of cappedMarkets) {
          if (m.conditionId) conditionIds.push(m.conditionId);
        }
        const clobMids = await fetchClobMidPrices(conditionIds.slice(0, 80));

        for (const m of cappedMarkets) {
          const tagSlugs: string[] = ((m.events ?? [])[0]?.tags ?? []).map((t: any) => t.slug ?? t.label ?? "");
          const rawQ2 = m.question ?? m.groupItemTitle ?? "";
          const sport = classifySport(resolvePolymarketTitle(rawQ2), tagSlugs, "");

          // Skip events whose end date has already passed
          const evEnd = (m.events ?? [])[0]?.endDate ?? m.endDate ?? null;
          if (evEnd && new Date(evEnd).getTime() <= Date.now()) continue;

          const yesPrice = parseFloat(m.lastTradePrice ?? (m.outcomePrices?.[0] ?? 0.5));
          // Skip near-resolved markets: <2¢ or >98¢ means the outcome is essentially decided
          if (isNaN(yesPrice) || yesPrice < 0.02 || yesPrice > 0.98) continue;
          const noPrice  = 1 - yesPrice;
          const bestBid  = parseFloat(m.bestBid  ?? 0) || yesPrice - 0.01;
          const bestAsk  = parseFloat(m.bestAsk  ?? 0) || yesPrice + 0.01;
          const spread   = Math.max(0, bestAsk - bestBid);

          // ── Volume: use volume24hr (correct field), fall back to volume24hrClob
          const vol24h   = parseFloat(m.volume24hr ?? m.volume24hrClob ?? m.volume ?? 0);
          const vol1wk   = parseFloat(m.volume1wk  ?? m.volume1wkClob  ?? 1);
          const dailyAvg = vol1wk / 7;
          const volSpike = dailyAvg > 100 ? vol24h / dailyAvg : (vol24h > 0 ? 3.1 : 1);

          // ── Price changes
          const ph1 = parseFloat(m.oneHourPriceChange ?? 0) || 0;
          const pd1 = parseFloat(m.oneDayPriceChange  ?? 0) || 0;
          const pw1 = parseFloat(m.oneWeekPriceChange ?? 0) || 0;

          // ── Whale detection: single large purchase — vol24hr >= $100K only ──
          const isVolWhale  = vol24h >= WHALE_ABS_VOL;

          // ── Smart wallet signal: tracked top-20 traders holding this market ──
          const condId      = m.conditionId ?? "";
          const smartSignal = condId ? getSignalForMarket(condId) : null;
          const isSmartWalletAlert = !!(smartSignal && smartSignal.walletCount >= 1 && smartSignal.totalUSDC >= 500);

          // Combine vol-whale + smart-wallet into isWhaleAlert
          const isWhaleAlert = isVolWhale || isSmartWalletAlert;

          // Direction: prefer smart wallet direction (real positions), fall back to price move
          const priceMove = ph1 !== 0 ? ph1 : pd1;
          const whaleDirection: "yes" | "no" | null = isSmartWalletAlert && smartSignal!.direction !== "mixed"
            ? smartSignal!.direction as "yes" | "no"
            : isWhaleAlert ? (priceMove >= 0 ? "yes" : "no") : null;
          const whalePriceMovePct = Math.round(Math.abs(ph1 !== 0 ? ph1 : pd1) * 1000) / 10;

          // smartScore: vol-based (0–100) + wallet count bonus + USDC size bonus
          const volScore    = isVolWhale ? Math.min(70, Math.round((vol24h / 500_000) * 70)) : 0;
          const walletBonus = isSmartWalletAlert ? Math.min(20, (smartSignal!.walletCount) * 8) : 0;
          const usdcBonus   = isSmartWalletAlert ? Math.min(10, Math.round(Math.log10(Math.max(1, smartSignal!.totalUSDC)) - 2)) : 0;
          const smartScore  = isWhaleAlert ? Math.min(100, volScore + walletBonus + usdcBonus) : 0;

          const clobMid = m.conditionId ? (clobMids.get(m.conditionId) ?? null) : null;
          const rating  = rateMarket(m.question ?? m.groupItemTitle ?? "", yesPrice, clobMid, { isWhale: isWhaleAlert });

          // Build cross-validation map
          const normKey = (m.question ?? m.groupItemTitle ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          if (normKey) polyEventMap.set(normKey, yesPrice);

          // Parse clobTokenIds for history endpoint
          let yesTokenId: string | null = null;
          try {
            const tokenIds = JSON.parse(m.clobTokenIds ?? "[]");
            yesTokenId = Array.isArray(tokenIds) && tokenIds.length > 0 ? String(tokenIds[0]) : null;
          } catch { /* keep null */ }

          // Event info (markets endpoint nests event data in m.events array)
          const evTitle = (m.events ?? [])[0]?.title ?? m.question ?? m.groupItemTitle ?? "";
          const evSlug  = (m.events ?? [])[0]?.slug ?? m.slug ?? "";
          const evEndDate = (m.events ?? [])[0]?.endDate ?? m.endDate ?? null;

          results.push({
            id:               `poly-${m.id}`,
            source:           "polymarket",
            title:            resolvePolymarketTitle(m.question ?? m.groupItemTitle ?? ""),
            event:            evTitle,
            sport,
            yesPrice,
            noPrice,
            bestBid,
            bestAsk,
            spread:           Math.round(spread * 1000) / 10,
            vol24h,
            volSpike:         Math.round(volSpike * 10) / 10,
            ph1:              Math.round(ph1 * 1000) / 10,
            pd1:              Math.round(pd1 * 1000) / 10,
            pw1:              Math.round(pw1 * 1000) / 10,
            liquidityNum:     parseFloat(m.liquidityNum ?? m.liquidity ?? 0),
            yesTokenId,
            ...rating,
            isWhaleAlert,
            whaleDirection,
            whalePriceMovePct,
            smartScore,
            gameTime:         evEndDate,
            polyUrl:          `https://polymarket.com/event/${evSlug || m.id}`,
            crossValidated:      false,
            crossPrice:          null,
            crossSource:         null,
            crossDelta:          null,
            // Smart wallet data
            smartWalletCount:    smartSignal?.walletCount ?? 0,
            smartWalletUSDC:     Math.round(smartSignal?.totalUSDC ?? 0),
            smartWalletDir:      smartSignal?.direction ?? null,
            smartWalletHolders:  smartSignal?.holders ?? [],
          });
        }
      } catch (e: any) {
        console.warn("[pred-mkt] Polymarket error:", e.message);
      }

      // ── Kalshi title cleaner ────────────────────────────────────────────────
      // Kalshi multi-game market titles are raw comma-joined strings like:
      //   "yes Derrick White: 2+,yes DeMar DeRozan: 10+,yes Julius Randle: 15+"
      // We parse these into a human-readable label + structured legs array.
      // Decode Kalshi ticker prefix → human-readable stat category
      const kalshiStatFromTicker = (ticker: string): string  =>{
        const t = (ticker ?? "").toUpperCase();
        // NBA player props
        if (t.includes("NBAREBAST")) return "REB+AST";  // must check before REB/AST
        if (t.includes("NBAPRA"))   return "PTS+REB+AST";
        if (t.includes("NBAPTS"))   return "PTS";
        if (t.includes("NBAAST"))   return "AST";
        if (t.includes("NBAREB"))   return "REB";
        if (t.includes("NBASTL"))   return "STL";
        if (t.includes("NBABLK"))   return "BLK";
        if (t.includes("NBA3PM") || t.includes("NBA3PT")) return "3PT";
        if (t.includes("NBAFG") || t.includes("NBAFGM"))  return "FGM";
        if (t.includes("NBATOV") || t.includes("NBATO"))  return "TOV";
        if (t.includes("NBAMIN"))   return "MIN";
        if (t.includes("NBA") && (t.includes("PTS") || t.includes("POINT"))) return "PTS";
        if (t.includes("NBA") && (t.includes("AST") || t.includes("ASSIST"))) return "AST";
        if (t.includes("NBA") && (t.includes("REB") || t.includes("REBOUND"))) return "REB";
        // NFL player props
        if (t.includes("NFLTD"))    return "TD";
        if (t.includes("NFLPASS") || t.includes("NFLPYD")) return "PASS YDS";
        if (t.includes("NFLRUSH") || t.includes("NFLRYD")) return "RUSH YDS";
        if (t.includes("NFLREC") || t.includes("NFLRECYD")) return "REC YDS";
        if (t.includes("NFLCOMPLETION") || t.includes("NFLCOMP")) return "COMP";
        if (t.includes("NFLINT"))   return "INT";
        if (t.includes("NFLSCK") || t.includes("NFLSACK")) return "SACK";
        // MLB player props
        if (t.includes("MLBHR"))    return "HR";
        if (t.includes("MLBRBI"))   return "RBI";
        if (t.includes("MLBK") && !t.includes("MLBKI")) return "K";
        if (t.includes("MLBHIT"))   return "HITS";
        if (t.includes("MLBSB"))    return "SB";
        if (t.includes("MLBR") && !t.includes("MLBRBI")) return "RUNS";
        // NHL player props
        if (t.includes("NHLGOAL"))  return "GOALS";
        if (t.includes("NHLAST") || t.includes("NHLASSIST")) return "ASSISTS";
        if (t.includes("NHLSHOT"))  return "SHOTS";
        if (t.includes("NHLPOINT") || t.includes("NHLPTS")) return "PTS";
        // Generic fallback: if it's a player-prop market (contains a number threshold)
        // we still want to show SOMETHING rather than nothing
        if (t.includes("NBA") || t.includes("KQMB")) return "PROP";
        if (t.includes("NFL")) return "PROP";
        if (t.includes("MLB")) return "PROP";
        if (t.includes("NHL")) return "PROP";
        return "";  // Non-player-prop — don't append anything
      }

      const annotateTeamLeg = (legText: string, dir: string, sport: string): string  =>{
        // If the leg is just a team name (no colon, no stat number, no condition words)
        // e.g. "Boston", "Minnesota", "Arsenal", "Oklahoma City"
        const hasColon      = legText.includes(":");
        const hasNumber     = /\d/.test(legText);
        const hasCondition  = /wins|beats|covers|over|under|leads|scores|advances|moneyline|spread|ml\b/i.test(legText);
        if (!hasColon && !hasNumber && !hasCondition) {
          // Plain team name — always resolve by searching ALL leagues first
          // so a multi-sport parlay doesn't mis-tag NBA teams as NHL etc.
          let fullName = legText;
          let detectedSport: string | null = null;
          const lkey = legText.trim().toLowerCase();
          // Search all four leagues regardless of what the market says
          for (const sp of ["NBA", "NHL", "MLB", "NFL"] as const) {
            const table = TEAM_FULL_NAME[sp];
            for (const [k, v] of Object.entries(table)) {
              if (k.toLowerCase() === lkey || v.toLowerCase() === lkey) {
                fullName = v;
                detectedSport = sp;
                break;
              }
            }
            if (detectedSport) break;
          }
          // If not found in any table, fall back to resolveFullTeamName with the market sport
          if (!detectedSport) {
            fullName = resolveFullTeamName(legText, sport);
            // Only use the market sport label if we confirmed the team is actually in that league
            // Don't blindly label unknown teams with the market sport
            detectedSport = null;
          }
          // Never show "(Other)" — only append sport label when it adds real context
          const sportLabel = detectedSport && detectedSport !== "OTHER" ? ` (${detectedSport})` : "";
          return `${dir} ${fullName} to Win${sportLabel}`;
        }
        // Has condition words already — just clean up any city-only team names inline
        const resolved = resolvePolymarketTitle(legText);
        return `${dir} ${resolved}`;
      }

      // ── Player → Team lookup (ESPN search, cached) ──────────────────────────
      const playerTeamCache = new Map<string, string>();
      async function getPlayerTeam(playerName: string, sport: string): Promise<string | null> {
        const key = `${playerName}::${sport}`;
        if (playerTeamCache.has(key)) return playerTeamCache.get(key)!;
        try {
          const sportCfg: Record<string, string> = {
            NBA: "basketball/nba", MLB: "baseball/mlb",
            NHL: "hockey/nhl",     NFL: "football/nfl",
          };
          const slug = sportCfg[sport.toUpperCase()];
          if (!slug) return null;
          const q = encodeURIComponent(playerName);
          const r = await axios.get(
            `https://site.web.api.espn.com/apis/common/v3/search?query=${q}&type=player&sport=${slug.split("/")[0]}&league=${slug.split("/")[1]}&limit=3`,
            { timeout: 4000, headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const hits: any[] = r.data?.items ?? r.data?.athletes ?? [];
          for (const h of hits) {
            const name: string = h.displayName ?? h.name ?? "";
            // Fuzzy match — first+last name overlap
            const nl = name.toLowerCase(); const ql = playerName.toLowerCase();
            if (nl === ql || nl.includes(ql) || ql.includes(nl)) {
              const team = h.team?.displayName ?? h.team?.name ?? h.teamName ?? null;
              if (team) { playerTeamCache.set(key, team); return team; }
            }
          }
          // fallback: ESPN search v2
          const r2 = await axios.get(
            `https://www.espn.com/search-results/search?query=${q}&type=players&sport=${slug.split("/")[0]}`,
            { timeout: 4000, headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const results2: any[] = r2.data?.results?.[0]?.contents ?? [];
          for (const item of results2) {
            const nm: string = item.name ?? "";
            if (nm.toLowerCase().includes(playerName.toLowerCase().split(" ")[1] ?? playerName.toLowerCase())) {
              const team = item.team ?? null;
              if (team) { playerTeamCache.set(key, team); return team; }
            }
          }
        } catch { /* silent */ }
        playerTeamCache.set(key, "");
        return null;
      }

      // Extract a human-readable game matchup from a Kalshi event ticker.
      // Tickers look like: KXNBA-25-BOS-LAL, KXNHL-26-TOR-BOS, KXMLB-25-NYM-ATL, etc.
      const gameFromEventTicker = (ticker: string, sport?: string): string | null  =>{
        if (!ticker) return null;
        // Strip the leading "KX<SPORT>-YY-" prefix, leaving "AWAY-HOME" team codes
        const m = ticker.match(/^KX(?:NBA|NHL|MLB|NFL|NCAAB|NCAAF)?[-_]?\d*[-_]?([A-Z]{2,4})[-_]([A-Z]{2,4})/i);
        if (m) {
          const away = m[1].toUpperCase();
          const home = m[2].toUpperCase();
          // Try to resolve abbreviations to full team names
          const sp = (sport ?? "").toUpperCase() as keyof typeof TEAM_FULL_NAME;
          const fullAway = TEAM_FULL_NAME[sp]?.[away] ?? away;
          const fullHome = TEAM_FULL_NAME[sp]?.[home] ?? home;
          return `${fullAway} @ ${fullHome}`;
        }
        // Fallback: try splitting on last two dash/underscore segments
        const parts = ticker.split(/[-_]/).filter(Boolean);
        if (parts.length >= 2) {
          const last2 = parts.slice(-2);
          if (last2.every(p => /^[A-Z]{2,4}$/.test(p))) {
            return `${last2[0]} @ ${last2[1]}`;
          }
        }
        return null;
      }

      // Detect a bare game total leg: "Over 205.5 points scored", "Under 6.5 runs", etc.
      // Returns true if the leg text is a game-level total with no team context.
      const isBareTotal = (legText: string): boolean  =>{
        return /^(?:over|under)\s+[\d.]+\s+(?:points?|runs?|goals?|runs?|pts?)(?:\s+scored)?$/i.test(legText.trim());
      }

      const cleanKalshiTitle = (
        raw: string,
        mveLegs?: Array<{ market_ticker: string; event_ticker: string; side: string }>,
        sport?: string
      ): { title: string; legs: string[] | null; isParlay: boolean } => {
        if (!raw) return { title: raw, legs: null, isParlay: false };

        // ── Pattern A: player-prop parlay — starts with "yes/no Name: line"
        const legPattern = /^(yes|no)\s+.+:\s*[\d.]+[+\-]?/i;
        // Split on comma boundaries that precede "yes " or "no "
        const parts = raw.split(/,(?=\s*(yes|no)\s+)/i).map(s => s.trim());

        if (parts.length >= 2 && legPattern.test(parts[0])) {
          // Build a stat lookup from mve_selected_legs if available
          const rawLegs = parts.map((leg, i) => {
            // Filter out junk legs that are just "yes" or "no" with nothing after them
            const stripped = leg.replace(/^(yes|no)\s*/i, "").trim();
            if (!stripped) return null;  // empty/junk — drop this leg

            const m = leg.match(/^(yes|no)\s+(.+?):\s*([\d.]+[+\-]?)(.*)$/i);
            if (!m) {
              const plain = leg.match(/^(yes|no)\s+(.+)$/i);
              if (plain) {
                const plainContent = plain[2].trim();
                if (!plainContent) return null;  // nothing meaningful
                return annotateTeamLeg(plainContent, plain[1].toUpperCase(), sport ?? "");
              }
              return leg;
            }
            const dir  = m[1].toUpperCase();
            const name = m[2].trim();
            const line = m[3].trim();
            // Try to find the matching mve leg — the index may shift if earlier legs were null
            const mveLeg = mveLegs?.[i];
            const statTicker = mveLeg?.market_ticker ?? mveLeg?.event_ticker ?? "";
            const stat = kalshiStatFromTicker(statTicker);
            const builtLeg = `${dir} ${name} ${line}${stat ? " " + stat : ""}`;
            // If this is a bare game total (no team context), append the matchup from event_ticker
            const bareCondition = `${name} ${line}${stat ? " " + stat : ""}`;
            if (isBareTotal(bareCondition) && mveLeg?.event_ticker) {
              const game = gameFromEventTicker(mveLeg.event_ticker, sport);
              if (game) return `${dir} ${bareCondition} (${game})`;
            }
            return builtLeg;
          }).filter((leg): leg is string => leg !== null && leg.trim() !== "");

          if (rawLegs.length < 1) {
            // All legs were junk — fall through to single market handler
          } else {
            const firstMatch = parts[0].match(/^(?:yes|no)\s+(.+?):/i);
            const firstName = firstMatch ? firstMatch[1].trim() : 'Multi-game';
            const title = rawLegs.length === 1
              ? rawLegs[0].replace(/^(YES|NO)\s+/i, "")  // single valid leg — just show the condition
              : `${firstName} +${rawLegs.length - 1} more (${rawLegs.length}-leg parlay)`;
            return { title, legs: rawLegs, isParlay: rawLegs.length > 1 };
          }
        }

        // ── Pattern B: cross-category team-win parlay
        //   e.g. "Vancouver wins by over 2.5 goals,no Montreal wins by over..."
        //   Parts are separated by ",yes " or ",no " WITHIN the string (no leading yes/no)
        const crossParts = raw.split(/,(?=\s*(yes|no)\s+)/i).map(s => s.trim());
        // Also try splitting on plain commas when there are 3+ parts that look like team conditions
        const commaParts = raw.split(/,\s*no\s+|,\s*yes\s+/i);
        const teamConditionPattern = /wins|leads|scores|advances|covers|over|under|beats/i;

        // Check if the raw string contains ",no " or ",yes " mid-string (cross-category)
        if (/,\s*(yes|no)\s+/i.test(raw)) {
          // Reconstruct legs with their yes/no side
          // First part may or may not start with yes/no
          const rawLegs: string[] = [];
          // Split on all ",yes " and ",no " boundaries, preserving the delimiter
          const tokens = raw.split(/(,\s*(?:yes|no)\s+)/i);
          let current = tokens[0].trim();
          for (let i = 1; i < tokens.length; i += 2) {
            rawLegs.push(current);
            const delimiter = tokens[i]; // e.g. ",no " or ",yes "
            const sideMatch = delimiter.match(/(yes|no)/i);
            const side = sideMatch ? sideMatch[1].toUpperCase() : 'YES';
            current = side + ' ' + (tokens[i + 1] ?? '').trim();
          }
          if (current) rawLegs.push(current);

          if (rawLegs.length >= 2) {
            const legs = rawLegs.map(leg => {
              // Leg might already start with YES/NO from reconstruction
              const withSide = leg.match(/^(YES|NO)\s+(.+)$/i);
              if (withSide) {
                return annotateTeamLeg(withSide[2].trim(), withSide[1].toUpperCase(), sport ?? "");
              }
              // First part had no yes/no prefix — it's a YES by default
              return annotateTeamLeg(leg.trim(), "YES", sport ?? "");
            });

            // Build a compact summary title
            // Extract the core condition from first leg (e.g. "Vancouver wins by over 2.5 goals")
            const firstLeg = legs[0].replace(/^YES\s+/i, '').replace(/^NO\s+/i, '');
            // Try to extract team name (first 1-2 words before a verb)
            const teamMatch = firstLeg.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+/i);
            const teamName = teamMatch ? teamMatch[1] : 'Multi-team';
            const title = `${teamName} +${legs.length - 1} more (${legs.length}-leg combo)`;
            return { title, legs, isParlay: true };
          }
        }

        // ── Pattern C: plain long comma list with no yes/no markers
        //   Treat as multi-condition if 3+ commas and matches team condition words
        if (raw.includes(',') && teamConditionPattern.test(raw)) {
          const simpleParts = raw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
          if (simpleParts.length >= 3) {
            const legs = simpleParts.map(p => annotateTeamLeg(p, "YES", sport ?? ""));
            const firstWord = simpleParts[0].split(/\s+/).slice(0, 2).join(' ');
            const title = `${firstWord} +${legs.length - 1} more (${legs.length}-leg combo)`;
            return { title, legs, isParlay: true };
          }
        }

        // Single market — clean up "yes Name: line" prefix
        const single = raw.match(/^(?:yes|no)\s+(.+)$/i);
        return { title: single ? single[1].trim() : raw, legs: null, isParlay: false };
      }

      // ── 2. Kalshi — all open markets, classify sport, cross-validate vs Polymarket ──
      try {
        // Fetch 400 open Kalshi markets — sorted by close_time ASC so today's events are first
        const { data: km } = await axios.get(`${KALSHI_BASE}/markets`, {
          params: { status: "open", limit: 400 },
          timeout: 10000,
        });
        const kmarkets = (km?.markets ?? []) as any[];
        // Per-category cap for Kalshi (100 limit — 100 most popular per sport)
        const kBuckets: Record<string, number> = {};
        // Sort: today-closing first (ascending close_time within 24h), then by vol24h descending
        const kNow = Date.now();
        kmarkets.sort((a: any, b: any) => {
          const atClose = a.close_time ? new Date(a.close_time).getTime() : Infinity;
          const btClose = b.close_time ? new Date(b.close_time).getTime() : Infinity;
          const aToday  = atClose > kNow && atClose <= kNow + 24 * 60 * 60 * 1000;
          const bToday  = btClose > kNow && btClose <= kNow + 24 * 60 * 60 * 1000;
          if (aToday && !bToday) return -1;
          if (!aToday && bToday) return 1;
          // Within same "today" bucket, sort by vol24h descending
          const av = parseFloat(a.volume_24h_fp ?? a.volume_24h ?? 0);
          const bv = parseFloat(b.volume_24h_fp ?? b.volume_24h ?? 0);
          return bv - av;
        });
        const kNowMs = Date.now();
        for (const m of kmarkets) {
          // Skip markets whose close_time has already passed — the event is over
          if (m.close_time && new Date(m.close_time).getTime() <= kNowMs) continue;

          const priceStr = m.yes_ask_dollars ?? m.yes_bid_dollars ?? m.last_price_dollars ?? null;
          const yesPrice = priceStr !== null ? parseFloat(priceStr) : ((m.yes_bid ?? m.last_price ?? 50) / 100);
          // Skip near-resolved markets: <2¢ or >98¢ means outcome essentially decided
          if (isNaN(yesPrice) || yesPrice < 0.02 || yesPrice > 0.98) continue;

          const noPrice  = 1 - yesPrice;
          const bestBid  = m.yes_bid_dollars ? parseFloat(m.yes_bid_dollars) : yesPrice - 0.01;
          const bestAsk  = m.yes_ask_dollars ? parseFloat(m.yes_ask_dollars) : yesPrice + 0.01;
          const spread   = Math.max(0, bestAsk - bestBid);
          const vol24h   = parseFloat(m.volume_24h_fp ?? m.volume_24h ?? m.volume_fp ?? 0);

          const sport  = classifySport(m.title ?? "", [], m.category ?? "");

          // Per-category cap: skip if bucket full
          kBuckets[sport] = (kBuckets[sport] ?? 0);
          if (kBuckets[sport] >= PER_CATEGORY_LIMIT) continue;

          // Cross-validate: find matching Polymarket market by fuzzy title
          const titleWords = (m.title ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w: string) => w.length > 3);
          let crossPrice: number | null = null;
          let crossDelta: number | null = null;
          let bestMatchScore = 0;
          for (const [polyKey, polyPrice] of polyEventMap) {
            const overlap = titleWords.filter((w: string) => polyKey.includes(w)).length;
            const score = titleWords.length > 0 ? overlap / titleWords.length : 0;
            if (score >= 0.60 && score > bestMatchScore) {
              crossPrice = polyPrice;
              bestMatchScore = score;
            }
          }
          if (crossPrice !== null) {
            crossDelta = Math.round(Math.abs(yesPrice - crossPrice) * 1000) / 10;
          }

          const prevPriceK = m.previous_price_dollars !== undefined
            ? parseFloat(m.previous_price_dollars)
            : m.previous_price !== undefined ? m.previous_price / 100 : null;

          // ── Kalshi whale detection ─────────────────────────────────
          // Kalshi has much lower liquidity than Polymarket. Whale = $5K+ vol24h
          // OR 5¢+ price move from previous close (price shock = large order hit).
          const kHasAbsVol    = vol24h >= KALSHI_WHALE_VOL;
          const kPriceDelta   = prevPriceK !== null ? Math.abs(yesPrice - prevPriceK) : 0;
          const kHasPriceMove = kPriceDelta >= KALSHI_PREV_PRICE_DELTA;
          const isWhaleAlert  = kHasAbsVol || kHasPriceMove;

          // Rate AFTER whale + cross-validation known so confluence is baked in
          const rating = rateMarket(m.title ?? "", yesPrice, null, {
            isWhale: isWhaleAlert,
            crossValidated: crossPrice !== null,
          });
          const whaleDirection = isWhaleAlert ? (yesPrice >= 0.5 ? "yes" : "no") : null;
          const whalePriceMovePct = prevPriceK !== null
            ? Math.round(Math.abs(yesPrice - prevPriceK) * 1000) / 10
            : 0;

          // smartScore for Kalshi: vol relative to $50K cap + price shock weight
          const kSmartScore = isWhaleAlert ? Math.min(100, Math.round(
            (kHasAbsVol    ? Math.min(60, (vol24h / 50_000) * 60) : 0) +
            (kHasPriceMove ? Math.min(40, (kPriceDelta / 0.20) * 40) : 0)
          )) : 0;

          const { title: kTitle, legs: kLegs, isParlay: kIsParlay } = cleanKalshiTitle(m.title ?? "", m.mve_selected_legs, sport);
          const kLegGames: (string | null)[] = (m.mve_selected_legs ?? []).map(
            (leg: { market_ticker: string; event_ticker: string; side: string }) =>
              gameFromEventTicker(leg.event_ticker, sport) ?? null
          );
          const kLegPlayerTeams: (string | null)[] = await Promise.all(
            (kLegs ?? []).map(async (legStr: string) => {
              const body = legStr.replace(/^(YES|NO)\s+/i, "").trim();
              const propMatch = body.match(/^(.+?):\s*[\d.]+/) || body.match(/^(.+?)\s+[\d.]+[+\-]?\s+/);
              const playerName = propMatch?.[1]?.trim();
              if (!playerName || playerName.length < 4) return null;
              if (/wins|beats|covers|over|under|advances/i.test(playerName)) return null;
              return getPlayerTeam(playerName, sport);
            })
          );
          results.push({
            id:               `kalshi-${m.ticker}`,
            source:           "kalshi",
            title:            kTitle,
            legs:             kLegs,
            isParlay:         kIsParlay,
            legGames:         kLegGames.length > 0 ? kLegGames : null,
            legPlayerTeams:   kLegPlayerTeams.some(t => t) ? kLegPlayerTeams : null,
            event:            m.event_ticker ?? m.title,
            sport,
            yesPrice,
            noPrice,
            bestBid,
            bestAsk,
            spread:           Math.round(spread * 1000) / 10,
            vol24h,
            volSpike:         1,
            ph1:              prevPriceK !== null ? Math.round((yesPrice - prevPriceK) * 1000) / 10 : 0,
            pd1:              prevPriceK !== null ? Math.round((yesPrice - prevPriceK) * 1000) / 10 : 0,
            previousPrice:    prevPriceK,
            pw1:              0,
            liquidityNum:     parseFloat(m.open_interest_fp ?? m.notional_value ?? 0),
            openTime:         m.open_time ?? null,
            ...rating,
            isWhaleAlert,
            whaleDirection,
            whalePriceMovePct,
            smartScore:       kSmartScore,
            gameTime:         m.close_time ?? null,
            kalshiUrl:        `https://kalshi.com/markets/${m.ticker}`,
            crossValidated:   crossPrice !== null,
            crossPrice:       crossPrice !== null ? Math.round(crossPrice * 100) / 100 : null,
            crossSource:      crossPrice !== null ? "polymarket" : null,
            crossDelta:       crossDelta,
          });
          kBuckets[sport]++;
        }

        // Back-fill crossValidation onto Polymarket entries using Kalshi as reference
        const kalshiMap = new Map<string, number>();
        for (const r of results) {
          if (r.source === "kalshi") {
            const k = r.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            if (k) kalshiMap.set(k, r.yesPrice);
          }
        }
        for (const r of results) {
          if (r.source === "polymarket" && !r.crossValidated) {
            const words = r.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w: string) => w.length > 3);
            let bestScore = 0; let kPrice: number | null = null;
            for (const [kk, kp] of kalshiMap) {
              const ov = words.filter((w: string) => kk.includes(w)).length;
              const sc = words.length > 0 ? ov / words.length : 0;
              if (sc >= 0.60 && sc > bestScore) { kPrice = kp; bestScore = sc; }
            }
            if (kPrice !== null) {
              r.crossValidated = true;
              r.crossPrice     = Math.round(kPrice * 100) / 100;
              r.crossSource    = "kalshi";
              r.crossDelta     = Math.round(Math.abs(r.yesPrice - kPrice) * 1000) / 10;
            }
          }
        }
      } catch (e: any) {
        console.warn("[pred-mkt] Kalshi error:", e.message);
      }

      // Sort: today/within-24h markets FIRST, then whale alerts, then rating
      // isTodaySrv: fires if gameTime closes within next 24 hours OR is today's date
      const isTodaySrv = (gt: string | null): boolean  =>{
        if (!gt) return false;
        try {
          const t = new Date(gt).getTime();
          const now = Date.now();
          // Fires if: closes within 24 hours from now (in-play or imminent)
          // OR the close date is today's calendar date
          const todayStr = new Date().toISOString().slice(0, 10);
          const isToday = new Date(gt).toISOString().slice(0, 10) === todayStr;
          const isWithin24h = t > now && t <= now + 24 * 60 * 60 * 1000;
          return isToday || isWithin24h;
        } catch { return false; }
      }
      const ORDER = { great_buy: 0, good_buy: 1, fair: 2, overpriced: 3 };
      results.sort((a, b) => {
        const at = isTodaySrv(a.gameTime);
        const bt = isTodaySrv(b.gameTime);
        // 1) Today/within-24h markets first
        if (at && !bt) return -1;
        if (!at && bt) return 1;
        // 2) Within today group: whales first, sorted by smartScore desc
        if (a.isWhaleAlert && !b.isWhaleAlert) return -1;
        if (!a.isWhaleAlert && b.isWhaleAlert) return 1;
        if (a.isWhaleAlert && b.isWhaleAlert) {
          return (b.smartScore ?? 0) - (a.smartScore ?? 0);
        }
        // 3) Non-whale non-today: sort by rating then by vol24h (most active first)
        const ratingDiff = (ORDER[a.priceRating as keyof typeof ORDER] ?? 9)
          - (ORDER[b.priceRating as keyof typeof ORDER] ?? 9);
        if (ratingDiff !== 0) return ratingDiff;
        return (b.vol24h ?? 0) - (a.vol24h ?? 0);
      });

      predMktCache = { data: results, ts: Date.now() };
      // Expose to market-signals endpoint via global cache
      (global as any).__predMktCache = { data: results, ts: Date.now() };
      // Invalidate market-signals cache so it re-computes with fresh markets
      MARKET_SIGNALS_CACHE.delete("market-signals");
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Price history endpoint — Polymarket CLOB timeseries + Kalshi synthetic ────────
  // GET /api/prediction-markets/history/:marketId
  // FIXES:
  //   - Use clobTokenIds[0] (YES token) NOT conditionId for CLOB /prices-history
  //   - Use startTs+endTs (Unix seconds) not `resolution` param
  //   - Build synthetic history from oneDayPriceChange / oneWeekPriceChange / oneMonthPriceChange
  //   - Kalshi /history endpoint doesn’t exist publicly — use previousPrice from cache
  app.get("/api/prediction-markets/history/:marketId", async (req, res) => {
    const { marketId } = req.params;
    try {
      if (marketId.startsWith("poly-")) {
        const rawId = marketId.replace("poly-", "");

        // Step 1: Fetch Gamma market data — we need clobTokenIds + price-change fields
        let yesTokenId: string | null = null;
        let lastTradePrice = 0.5;
        let oneDayChange   = 0;
        let oneWeekChange  = 0;
        let oneMonthChange = 0;
        try {
          const { data: mData } = await axios.get(
            `https://gamma-api.polymarket.com/markets/${rawId}`,
            { timeout: 8000 }
          );
          const cids = mData?.clobTokenIds;
          if (typeof cids === "string") {
            try { const arr = JSON.parse(cids); yesTokenId = arr?.[0] ? String(arr[0]) : null; } catch { /* noop */ }
          } else if (Array.isArray(cids) && cids.length > 0) {
            yesTokenId = String(cids[0]);
          }
          lastTradePrice = parseFloat(mData?.lastTradePrice ?? 0.5) || 0.5;
          oneDayChange   = parseFloat(mData?.oneDayPriceChange   ?? 0) || 0;
          oneWeekChange  = parseFloat(mData?.oneWeekPriceChange  ?? 0) || 0;
          oneMonthChange = parseFloat(mData?.oneMonthPriceChange ?? 0) || 0;
        } catch (e: any) {
          console.warn("[pred-hist] Gamma fetch failed:", e.message);
        }

        // Step 2: Try CLOB prices-history using YES token ID + startTs/endTs
        let clobPoints: { t: number; p: number }[] = [];
        if (yesTokenId) {
          try {
            const nowSec   = Math.floor(Date.now() / 1000);
            const startSec = nowSec - 7 * 24 * 3600;
            const { data: hist } = await axios.get("https://clob.polymarket.com/prices-history", {
              params: { market: yesTokenId, startTs: startSec, endTs: nowSec, fidelity: 3600 },
              timeout: 10000,
            });
            const raw = hist?.history ?? hist ?? [];
            if (Array.isArray(raw)) {
              clobPoints = raw
                .filter((p: any) => p && (p.t !== undefined || p.timestamp !== undefined))
                .map((p: any) => ({
                  t: typeof p.t === "number" ? p.t : parseInt(String(p.t ?? p.timestamp ?? 0)),
                  p: Math.min(1, Math.max(0, parseFloat(p.p ?? p.price ?? lastTradePrice))),
                }))
                .filter((pt: { t: number; p: number }) => pt.t > 0);
            }
            console.log(`[pred-hist] CLOB: ${clobPoints.length} pts for token ${yesTokenId.slice(0, 12)}…`);
          } catch (e: any) {
            console.warn("[pred-hist] CLOB error:", e.message);
          }
        }

        // Step 3: Synthetic history from Gamma price-change anchors
        // Anchors: now, 1d ago, 7d ago, 30d ago — interpolate between each
        const nowSec = Math.floor(Date.now() / 1000);
        const anchors = [
          { daysAgo: 0,  price: lastTradePrice },
          { daysAgo: 1,  price: Math.min(1, Math.max(0, lastTradePrice - oneDayChange)) },
          { daysAgo: 7,  price: Math.min(1, Math.max(0, lastTradePrice - oneWeekChange)) },
          { daysAgo: 30, price: Math.min(1, Math.max(0, lastTradePrice - oneMonthChange)) },
        ];
        const synthPts: { t: number; p: number }[] = [];
        for (let i = 0; i < anchors.length - 1; i++) {
          const a = anchors[i]; const b = anchors[i + 1];
          const steps = Math.max(2, Math.round((b.daysAgo - a.daysAgo) / 1.5));
          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            synthPts.push({
              t: nowSec - Math.round((a.daysAgo + frac * (b.daysAgo - a.daysAgo)) * 86400),
              p: Math.min(1, Math.max(0, a.price + frac * (b.price - a.price))),
            });
          }
        }

        // Step 4: Merge — CLOB points override synthetic in the same hour bucket
        const byHour = new Map<number, { t: number; p: number }>();
        for (const pt of synthPts) {
          const bkt = Math.floor(pt.t / 3600);
          if (!byHour.has(bkt)) byHour.set(bkt, pt);
        }
        for (const pt of clobPoints) {
          byHour.set(Math.floor(pt.t / 3600), pt); // CLOB wins
        }
        const history = Array.from(byHour.values()).sort((a, b) => a.t - b.t);

        return res.json({ source: "polymarket", history, hasRealData: clobPoints.length > 0, tokenId: yesTokenId });
      }

      // Kalshi: their public API has no /history endpoint — build synthetic from cache
      if (marketId.startsWith("kalshi-")) {
        const cachedMarket = predMktCache.data.find((m: any) => m.id === marketId);
        const lastPrice = cachedMarket?.yesPrice ?? 0.5;
        const prevPrice = cachedMarket?.previousPrice ?? null;
        const openTime  = cachedMarket?.openTime ?? null;
        const nowSec = Math.floor(Date.now() / 1000);
        const startTs = openTime
          ? Math.floor(new Date(openTime).getTime() / 1000)
          : nowSec - 24 * 3600;
        const history: { t: number; p: number }[] = [];
        const steps = 8;
        if (prevPrice !== null && prevPrice !== lastPrice) {
          for (let i = 0; i <= steps; i++) {
            const frac = i / steps;
            history.push({
              t: Math.round(startTs + frac * (nowSec - startTs)),
              p: Math.min(1, Math.max(0, prevPrice + frac * (lastPrice - prevPrice))),
            });
          }
        } else {
          const range = Math.max(0.02, Math.abs(lastPrice - 0.5) * 0.05);
          for (let i = 0; i <= steps; i++) {
            const frac = i / steps;
            history.push({
              t: Math.round(startTs + frac * (nowSec - startTs)),
              p: Math.min(1, Math.max(0, lastPrice + Math.sin(i * 1.7) * range * 0.4)),
            });
          }
        }
        return res.json({ source: "kalshi", history, isSynthetic: true });
      }

      res.json({ source: "unknown", history: [] });
    } catch (e: any) {
      console.error("[pred-hist] Error:", e.message);
      res.json({ source: "error", history: [], error: e.message });
    }
  });

  // ─── Kronos AI Forecast endpoint ───────────────────────────────────────────
  // GET /api/prediction-markets/kronos/:marketId
  // Fetches price history then proxies to the Kronos Python microservice.
  // Returns: { signal, strength, forecast, explanation, trend_slope, volatility, ... }
  const kronosCache = new Map<string, { data: any; ts: number }>();
  const KRONOS_TTL = 5 * 60_000; // 5-min cache (price history doesn't change that fast)

  // ─── Kronos Sports Pick Overlay ───────────────────────────────────────────
  // Takes raw Kronos price-model output + the market object and generates
  // a concrete sports pick with full reasoning (pick direction, edge, why).
  function buildKronosPick(k: any, mkt: any): {
    pick_label:      string;   // e.g. "BUY YES" / "BUY NO" / "PASS"
    pick_side:       "yes" | "no" | "pass";
    pick_confidence: number;   // 0-100
    pick_reasoning:  string;   // full natural-language explanation
    pick_edge_cents: number;   // current_cents vs projected_cents delta
    pick_roi_est:    string;   // estimated ROI if pick lands
    pick_grade:      "A" | "B" | "C" | "D" | "F";
  } {
    const signal   = k.signal    ?? "neutral";
    const strength = k.strength  ?? 0;
    const proj     = k.projected_cents ?? k.current_cents ?? 50;
    const curr     = k.current_cents   ?? (mkt ? Math.round((mkt.yesPrice ?? 0.5) * 100) : 50);
    const edgeCents = Math.round(proj - curr);

    // Market metadata
    const title       = mkt?.title    ?? "this market";
    const sport       = mkt?.sport    ?? "Sports";
    const yesPrice    = mkt?.yesPrice ?? 0.5;
    const noPrice     = mkt ? (1 - yesPrice) : 0.5;
    const priceRating = mkt?.priceRating ?? "fair";
    const isWhale         = mkt?.isWhaleAlert ?? false;
    const whaleSide       = mkt?.whaleDirection ?? null;
    const edge            = mkt?.edge ?? 0;
    const ph1             = mkt?.ph1 ?? 0;
    const pd1             = mkt?.pd1 ?? 0;
    const crossVal        = mkt?.crossValidated ?? false;
    const crossDelta      = mkt?.crossDelta ?? null;
    // Smart wallet data
    const swCount         = mkt?.smartWalletCount ?? 0;   // # tracked wallets holding
    const swUSDC          = mkt?.smartWalletUSDC  ?? 0;   // total USDC across wallets
    const swDir           = mkt?.smartWalletDir   ?? null; // "yes"|"no"|"mixed"|null
    const hasSmartMoney   = swCount >= 1 && swUSDC >= 500;
    const lm          = k.line_movement ?? {};
    const lb          = k.late_breaking ?? {};
    const crossover   = k.crossover ?? "none";
    const tossup      = k.tossup ?? false;
    const r2          = k.r2 ?? 0;
    const volRegime   = k.volatility_regime ?? "low";

    // ── Decide pick direction ──
    // Combine CIQ signal + market edge + whale flow + price rating
    let pickedSide: "yes" | "no" | "pass" = "pass";

    const yesSignals = [
      signal === "bullish",
      priceRating === "great_buy" || priceRating === "good_buy",
      isWhale && whaleSide === "yes",
      hasSmartMoney && swDir === "yes",      // smart wallets are holding YES
      hasSmartMoney && swCount >= 2,          // 2+ smart wallets = strong conviction
      lm.bias === "sharp_yes",
      crossover === "golden_cross",
      lb.detected && lb.direction === "bullish",
      ph1 > 1,
    ].filter(Boolean).length;

    const noSignals = [
      signal === "bearish",
      priceRating === "overpriced",
      isWhale && whaleSide === "no",
      hasSmartMoney && swDir === "no",       // smart wallets are holding NO
      lm.bias === "sharp_no",
      crossover === "death_cross",
      lb.detected && lb.direction === "bearish",
      ph1 < -1,
    ].filter(Boolean).length;

    if (yesSignals >= 2 || (signal === "bullish" && strength >= 40)) {
      pickedSide = "yes";
    } else if (noSignals >= 2 || (signal === "bearish" && strength >= 40)) {
      pickedSide = "no";
    } else if (yesSignals > noSignals && strength >= 25) {
      pickedSide = "yes";
    } else if (noSignals > yesSignals && strength >= 25) {
      pickedSide = "no";
    }

    // If tossup and low confidence, downgrade to pass
    if (tossup && strength < 40) pickedSide = "pass";

    // ── Confidence: blend Kronos strength + confluence bonus ──
    const swBonus = hasSmartMoney
      ? Math.min(20, swCount * 6 + (swUSDC >= 5000 ? 5 : 0))   // up to +20 for smart wallets
      : 0;
    const confluenceBonus =
      (isWhale ? 8 : 0) +
      (crossVal ? 6 : 0) +
      (crossover === "golden_cross" || crossover === "death_cross" ? 8 : 0) +
      (lb.detected ? 6 : 0) +
      (lm.bias !== "neutral" ? 5 : 0) +
      (r2 > 0.7 ? 5 : 0) +
      swBonus;
    const pickConfRaw = Math.min(99, Math.max(1, strength + confluenceBonus));
    // Apply ML weight nudge (no-op until we have ≥10 graded outcomes)
    const pickConf = applyMLWeights(pickConfRaw, {
      sport: mkt?.sport?.toUpperCase() ?? undefined,
      betType: "prediction_market",
      pickSide: pickedSide,
    });

    // ── Edge and ROI ──
    const entryPrice = pickedSide === "yes" ? yesPrice : noPrice;
    const roi = entryPrice > 0 ? Math.round((edgeCents / (entryPrice * 100)) * 100) : 0;
    const roiStr = roi !== 0 ? `${roi > 0 ? "+" : ""}${roi}%` : "0%";

    // ── Grade ──
    let grade: "A" | "B" | "C" | "D" | "F" = "F";
    if (pickConf >= 75 && pickedSide !== "pass" && Math.abs(edgeCents) >= 5) grade = "A";
    else if (pickConf >= 60 && pickedSide !== "pass" && Math.abs(edgeCents) >= 3) grade = "B";
    else if (pickConf >= 45 && pickedSide !== "pass") grade = "C";
    else if (pickConf >= 30 && pickedSide !== "pass") grade = "D";

    // ── Pick label ──
    const sideLabel = pickedSide === "yes" ? "BUY YES" : pickedSide === "no" ? "BUY NO" : "PASS";
    const priceLabel = pickedSide === "yes"
      ? `${Math.round(yesPrice * 100)}¢`
      : pickedSide === "no"
        ? `${Math.round(noPrice * 100)}¢`
        : "—";

    // For O/U markets, clarify whether YES = OVER or YES = UNDER in the label
    // Title pattern: "Team A vs Team B: O/U 6.5" → YES = OVER, NO = UNDER
    const titleUpper = (title ?? "").toUpperCase();
    const isOUMarket = /O\/U|OVER.UNDER|OVER\/UNDER|OU/.test(titleUpper)
                    || /^(OVER|UNDER)\s+[\d.]+/.test(titleUpper);
    // YES contract on an O/U = betting the OVER; NO = betting the UNDER
    const ouSuffix = isOUMarket && pickedSide !== "pass"
      ? pickedSide === "yes" ? " (OVER)" : " (UNDER)"
      : "";

    const pick_label = pickedSide === "pass"
      ? "PASS — No Clear Edge"
      : `${sideLabel} @ ${priceLabel}${ouSuffix}`;

    // ── Natural-language reasoning ──
    const parts: string[] = [];

    // Opening: what the pick is and why
    if (pickedSide === "yes") {
      parts.push(`Clubhouse IQ rates this a YES contract at ${Math.round(yesPrice * 100)}¢.`);
      if (signal === "bullish")
        parts.push(`Price model shows upward trend — YES contract projected to reach ${proj}¢ (currently ${curr}¢, +${Math.abs(edgeCents)}¢ edge).`);
    } else if (pickedSide === "no") {
      parts.push(`Clubhouse IQ rates this a NO contract at ${Math.round(noPrice * 100)}¢.`);
      if (signal === "bearish")
        parts.push(`YES price is fading — contract likely dropping to ${proj}¢ from ${curr}¢. Buying NO captures the ${Math.abs(edgeCents)}¢ move.`);
    } else {
      parts.push(`No clear edge detected. Market appears fairly priced or too uncertain for a confident call.`);
    }

    // Market edge signals
    if (priceRating === "great_buy" && pickedSide === "yes")
      parts.push(`Market pricing shows a great buy opportunity — YES is undervalued vs fair value (${Math.round(edge)}¢ edge).`);
    else if (priceRating === "good_buy" && pickedSide === "yes")
      parts.push(`YES appears slightly undervalued vs fair value (${Math.round(edge)}¢ edge).`);
    else if (priceRating === "overpriced" && pickedSide === "no")
      parts.push(`YES is overpriced vs fair value — smart money buys the NO contract instead.`);

    // Whale activity
    if (isWhale && whaleSide === pickedSide)
      parts.push(`Whale activity confirmed on this side — large position(s) taken, aligning with Clubhouse IQ direction.`);
    else if (isWhale && whaleSide && whaleSide !== pickedSide)
      parts.push(`Note: whale activity detected on the opposite side — factor into risk sizing.`);

    // Smart wallet (top trader) positioning
    if (hasSmartMoney && swDir === pickedSide)
      parts.push(`Smart Money confirmed: ${swCount} top-ranked Polymarket trader${swCount > 1 ? "s" : ""} holding this ${swDir?.toUpperCase()} side ($${swUSDC.toLocaleString()} USDC combined) — aligns with Clubhouse IQ pick.`);
    else if (hasSmartMoney && swDir === "mixed")
      parts.push(`Smart Money is split: ${swCount} top trader${swCount > 1 ? "s" : ""} hold positions on both sides ($${swUSDC.toLocaleString()} USDC) — market is contested.`);
    else if (hasSmartMoney && swDir && swDir !== pickedSide)
      parts.push(`Caution: ${swCount} top trader${swCount > 1 ? "s" : ""} are positioned on the ${swDir?.toUpperCase()} side ($${swUSDC.toLocaleString()} USDC) — opposite to this pick. Size carefully.`);

    // Sharp money / line movement
    if (lm.bias === "sharp_yes" && pickedSide === "yes")
      parts.push(`Sharp money detected: late YES buying (+${lm.short_slope}¢/step recent vs ${lm.long_slope}¢/step overall) — professional bettors loading up.`);
    else if (lm.bias === "sharp_no" && pickedSide === "no")
      parts.push(`Sharp money fading YES (${lm.short_slope}¢/step recent) — professional action aligns with NO.`);

    // Momentum crossover
    if (crossover === "golden_cross")
      parts.push(`Short-term momentum crossed above long-term average (golden cross) — bullish confirmation.`);
    else if (crossover === "death_cross")
      parts.push(`Short-term momentum crossed below long-term average (death cross) — bearish confirmation.`);

    // Late-breaking
    if (lb.detected)
      parts.push(`Late-breaking ${lb.direction} signal detected (${lb.magnitude}¢ move in last 3 data points) — possible injury/news catalyst.`);

    // Recent price momentum
    if (Math.abs(ph1) >= 1)
      parts.push(`1-hour price change: ${ph1 > 0 ? "+" : ""}${ph1}% — ${ph1 > 0 ? "intraday buying pressure" : "recent selling"}.`);
    if (Math.abs(pd1) >= 2)
      parts.push(`24-hour move: ${pd1 > 0 ? "+" : ""}${pd1}% — market has been ${pd1 > 0 ? "strengthening" : "weakening"} over the day.`);

    // Cross-validation
    if (crossVal && crossDelta !== null && crossDelta < 5)
      parts.push(`Cross-validated: Kalshi and Polymarket prices agree within ${crossDelta}¢ — strong consensus.`);
    else if (crossVal && crossDelta !== null && crossDelta >= 5)
      parts.push(`Price discrepancy between Kalshi and Polymarket (${crossDelta}¢ gap) — arbitrage opportunity may exist.`);

    // Model quality
    if (r2 > 0.7)
      parts.push(`Model fit is strong (R²=${r2.toFixed(2)}) — Clubhouse IQ has high confidence in this trend.`);
    else if (r2 < 0.3 && pickedSide !== "pass")
      parts.push(`Model fit is low (R²=${r2.toFixed(2)}) — noisy price history; size appropriately.`);

    // Volatility
    if (volRegime === "high")
      parts.push(`High market volatility — active information flow. Expect wider price swings.`);

    // Tossup warning
    if (tossup)
      parts.push(`Market is near 50¢ (genuine pick-em). Risk is elevated — bet small.`);

    const pick_reasoning = parts.join(" ");

    return {
      pick_label,
      pick_side:       pickedSide,
      pick_confidence: pickConf,
      pick_reasoning,
      pick_edge_cents: edgeCents,
      pick_roi_est:    roiStr,
      pick_grade:      grade,
    };
  }

  // Start Kronos at server boot
  startKronos();

  // ── Nightly ML pipeline: grade picks → run ML engine → sync to GitHub ──────
  // Runs at 2:00 AM server time (after US games finish)
  {
    const runNightlyML = async () => {
      console.log("[ML] Nightly pipeline starting...");
      try {
        // Step 1: Auto-grade picks against ESPN final scores
        const graderResult = await runAutoGrader();
        console.log("[ML] Grader done:", graderResult);
      } catch (e: any) {
        console.error("[ML] Grader error:", e.message);
      }
      try {
        // Step 2: Run ML engine to recompute weights from graded outcomes
        await runMLEngine();
        console.log("[ML] Engine run complete");
      } catch (e: any) {
        console.error("[ML] Engine error:", e.message);
      }
      try {
        // Step 3: Run BTS ML learning — analyzes which features predicted wins/losses
        await runBtsMlLearning();
        console.log("[ML] BTS ML learning complete");
      } catch (e: any) {
        console.error("[ML] BTS ML learning error:", e.message);
      }
      try {
        // Step 4: Sync ml_data/ back to GitHub so outcomes survive next redeploy
        await syncMLDataToGitHub();
        console.log("[ML] GitHub sync complete");
      } catch (e: any) {
        console.error("[ML] Sync error:", e.message);
      }
    };

    const scheduleNightlyML = () => {
      const now = new Date();
      // 2:00 AM UTC (covers games finishing in US timezones)
      const next2am = new Date(now);
      next2am.setUTCHours(7, 0, 0, 0); // 7am UTC = 2am CDT
      if (next2am <= now) next2am.setUTCDate(next2am.getUTCDate() + 1);
      const msUntil = next2am.getTime() - now.getTime();
      const hoursUntil = Math.round(msUntil / 3600000 * 10) / 10;
      console.log(`[ML] Nightly pipeline scheduled in ${hoursUntil}h`);
      setTimeout(() => {
        runNightlyML();
        // Repeat every 24h
        setInterval(runNightlyML, 24 * 60 * 60 * 1000);
      }, msUntil);
    };
    scheduleNightlyML();

    // ── BTS background re-grader: every 5 min during game window ──────────
    // Also backfills any past days that still have pending/ungraded picks.
    const runBtsRegrade = async () => {
      const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const ctH   = ctNow.getHours();

      const toDateStr = (d: Date) => [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");

      const todayStr = toDateStr(ctNow);

      // ── 1. Backfill: grade ALL past days that have any non-win picks ────────
      // Must also re-check "loss" picks: they may have been graded mid-game before
      // the player got a hit. runBtsGrader skips confirmed wins — safe to retry all.
      // Only re-check loss grades within the last 3 days (games don't stay live longer).
      // Older pending picks are also re-checked (shouldn't exist but handles edge cases).
      const threeDaysAgo = toDateStr(new Date(ctNow.getTime() - 3 * 24 * 60 * 60 * 1000));
      for (const [dateStr, entries] of Object.entries(btsPicksCache)) {
        if (dateStr >= todayStr) continue; // skip today — handled below
        const needsCheck = (entries as BtsPickEntry[]).filter(
          (e: BtsPickEntry) => {
            if (!e.result || e.result === "pending") return true; // always retry pending
            if (e.result === "win" && (e as any).gradedFinal) return false; // locked win — skip
            // Retry ANY loss that hasn't been confirmed final by the schedule API.
            // This catches mid-game premature losses (0-for-1 after 1st AB, etc.)
            // gradedFinal=false means the game wasn't confirmed Final when graded.
            if (e.result === "loss" && !(e as any).gradedFinal) return true;
            if (e.result === "loss" && dateStr >= threeDaysAgo) return true; // safety net for recent dates
            return false; // confirmed-final win, or old confirmed-final loss — skip
          }
        );
        if (needsCheck.length === 0) continue;
        console.log(`[BTS Backfill] Re-checking ${needsCheck.length} non-win picks from ${dateStr}`);
        await runBtsGrader(dateStr);
      }

      // ── 2. Today: only run during 12pm–2am CT game window ─────────────────
      if (ctH >= 12 || ctH < 2) {
        const entries = btsPicksCache[todayStr] ?? [];
        const needsRegrade = (entries as BtsPickEntry[]).filter(
          (e: BtsPickEntry) => e.result !== "win"
        );
        if (needsRegrade.length > 0) {
          console.log(`[BTS Regrader] ${needsRegrade.length} non-win picks to check for ${todayStr}`);
          await runBtsGrader(todayStr);
        }
      }
    };
    setInterval(runBtsRegrade, 5 * 60 * 1000); // every 5 min
    // Run once at startup after short delay — catches any picks missed during downtime
    setTimeout(runBtsRegrade, 30 * 1000);
  }

  app.get("/api/prediction-markets/kronos/:marketId", async (req, res) => {
    const { marketId } = req.params;
    const pred_steps = parseInt((req.query.steps as string) || "12", 10);

    // Cache check
    const cacheKey = `${marketId}:${pred_steps}`;
    const cached = kronosCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < KRONOS_TTL) {
      return res.json({ ...cached.data, cached: true });
    }

    try {
      // Step 1: Fetch price history (reuse history endpoint logic)
      let history: { t: number; p: number }[] = [];

      // Try to find the market in scan cache
      const allMarkets = await storage.getBets();
      const market = allMarkets.find((b: any) => b.id === marketId || b.polyId === marketId || b.conditionId === marketId);

      if (market?.source === "polymarket" || (!market && !marketId.startsWith("KXSPORTS"))) {
        // Polymarket: fetch CLOB history
        try {
          // Extract YES token — try clobTokenIds stored in cache
          let yesTokenId: string | null = null;
          if (market?.clobTokenIds) {
            try {
              const ids = typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
              if (Array.isArray(ids) && ids.length > 0) yesTokenId = String(ids[0]);
            } catch {}
          }
          if (!yesTokenId) {
            // Try Gamma API for token
            const gRes = await axios.get(`https://gamma-api.polymarket.com/markets/${marketId}`, { timeout: 5000 }).catch(() => null);
            if (gRes?.data?.clobTokenIds) {
              const ids = typeof gRes.data.clobTokenIds === "string" ? JSON.parse(gRes.data.clobTokenIds) : gRes.data.clobTokenIds;
              if (Array.isArray(ids) && ids.length > 0) yesTokenId = String(ids[0]);
            }
          }
          if (yesTokenId) {
            const endTs = Math.floor(Date.now() / 1000);
            const startTs = endTs - 30 * 24 * 3600;
            const hRes = await axios.get("https://clob.polymarket.com/prices-history", {
              params: { market: yesTokenId, startTs, endTs, fidelity: 60 },
              timeout: 10_000,
            });
            const raw = hRes.data?.history ?? hRes.data ?? [];
            history = (Array.isArray(raw) ? raw : []).map((pt: any) => ({ t: pt.t, p: pt.p }));
          }
        } catch (e: any) {
          console.warn("[CIQ] CLOB fetch failed:", e.message);
        }
      }

      // Build rich synthetic history from price delta anchors
      // Uses ph1 (1h), pd1 (1d), pw1 (1w) to reconstruct a 30-point price path
      // This gives Kronos enough data to detect trends, momentum, and crossovers
      if (history.length < 5) {
        const now  = Math.floor(Date.now() / 1000);
        const base = Math.max(0.02, Math.min(0.98, market?.yesPrice ?? market?.price ?? 0.5));

        // Convert % deltas back to price levels
        // ph1/pd1/pw1 are stored as percentage points (e.g. 3.2 = +3.2%)
        const ph1Raw = (market?.ph1 ?? 0) / 100;  // 1h delta as fraction
        const pd1Raw = (market?.pd1 ?? 0) / 100;  // 1d delta as fraction
        const pw1Raw = (market?.pw1 ?? 0) / 100;  // 1w delta as fraction
        const vol    = Math.max(0.003, Math.abs(pd1Raw) / 4); // volatility proxy

        // Anchor prices at known timestamps
        const p_now  = base;
        const p_1h   = Math.max(0.02, Math.min(0.98, base - ph1Raw));
        const p_1d   = Math.max(0.02, Math.min(0.98, base - pd1Raw));
        const p_1w   = Math.max(0.02, Math.min(0.98, base - pw1Raw));
        const p_2w   = Math.max(0.02, Math.min(0.98, p_1w - pw1Raw * 0.5)); // extrapolate

        // Build 30 interpolated points across 2-week window (1 per ~12h)
        // Using a simple linear interpolation between anchors + small deterministic jitter
        const anchors = [
          { t: now - 14 * 24 * 3600, p: p_2w },
          { t: now -  7 * 24 * 3600, p: p_1w },
          { t: now -  1 * 24 * 3600, p: p_1d },
          { t: now -  1 * 3600,      p: p_1h },
          { t: now,                   p: p_now },
        ];

        history = [];
        const POINTS = 30;
        const windowSecs = 14 * 24 * 3600;
        for (let i = 0; i < POINTS; i++) {
          const frac = i / (POINTS - 1);
          const ts   = now - windowSecs + Math.round(frac * windowSecs);

          // Linear interpolation between nearest anchors
          let p = p_now;
          for (let ai = 0; ai < anchors.length - 1; ai++) {
            const a0 = anchors[ai], a1 = anchors[ai + 1];
            if (ts >= a0.t && ts <= a1.t) {
              const span = a1.t - a0.t;
              const localFrac = span > 0 ? (ts - a0.t) / span : 0;
              p = a0.p + (a1.p - a0.p) * localFrac;
              break;
            }
          }

          // Deterministic jitter based on position (makes trend detectable)
          const seed   = Math.sin(i * 2.9) * 0.5 + 0.5; // pseudo-random [0,1]
          const jitter = (seed - 0.5) * vol * 0.8;
          history.push({ t: ts, p: Math.max(0.02, Math.min(0.98, p + jitter)) });
        }
      }

      // Even if market is unknown, build minimal history from any price we have
      if (history.length < 2) {
        return res.json({
          signal: "neutral", strength: 0, forecast: [],
          explanation: "No market data available for Clubhouse IQ analysis.",
          trend_slope: 0, volatility: 0, momentum: 0,
          action: "No data.", r2: 0, volatility_regime: "low",
          line_movement: { short_slope: 0, long_slope: 0, bias: "neutral", divergence: 0 },
          late_breaking: { detected: false, direction: null, magnitude: 0 },
          crossover: "none", tossup: false,
          sr: { support: null, resistance: null },
          current_cents: 0, projected_cents: 0, data_points: 0,
        });
      }

      // Step 2: Ensure Python service is up
      const ready = await ensureKronos();
      if (!ready) {
        return res.status(503).json({
          signal: "neutral", strength: 0, forecast: [],
          explanation: "Clubhouse IQ is starting up — try again in a moment.",
          error: "service_starting",
        });
      }

      // Step 3: Call Kronos (generous timeout — threaded server handles concurrency)
      const kronosRes = await axios.post(`${KRONOS_URL}/forecast`, {
        history,
        pred_steps,
      }, { timeout: 20_000 });

      const result = kronosRes.data;

      // ── Step 4: Sports Pick Overlay ────────────────────────────────────────
      // Combine CIQ price-model output with real market metadata to generate
      // a concrete, actionable sports pick with full reasoning.
      const pick = buildKronosPick(result, market);
      const enriched = { ...result, ...pick, cached: false };

      // ── Save pick to ML snapshot log so the grader can track prediction market grades ──
      if (pick.pick_side !== "pass" && market) {
        try {
          const mlDataDir = path.join(__dirname, "ml_data");
          const snapFile  = path.join(mlDataDir, "pick_snapshots.json");
          const snaps: any[] = fs.existsSync(snapFile)
            ? JSON.parse(fs.readFileSync(snapFile, "utf8"))
            : [];

          const snapId = `kronos-${marketId}-${pick.pick_side}-${Date.now()}`;
          const alreadyLogged = snaps.some((s: any) =>
            s.betId?.startsWith(`kronos-${marketId}-${pick.pick_side}`)
          );

          if (!alreadyLogged) {
            snaps.push({
              betId:           snapId,
              betType:         "prediction_market",
              sport:           market.sport ?? "Sports",
              title:           market.title ?? marketId,
              playerName:      null,
              statCategory:    null,
              line:            null,
              pickSide:        pick.pick_side,
              confidenceScore: pick.pick_confidence,
              edgeGrade:       pick.pick_grade,
              edgeScore:       pick.pick_confidence,
              gameTime:        market.endDate ?? null,
              homeTeam:        null,
              awayTeam:        null,
              loggedAt:        new Date().toISOString(),
              source:          market.source ?? "polymarket",
              pick_label:      pick.pick_label,
              pick_roi_est:    pick.pick_roi_est,
              yesPrice:        market.yesPrice ?? null,
            });
            // Keep cap at 2000
            const trimmed = snaps.slice(-2000);
            fs.writeFileSync(snapFile, JSON.stringify(trimmed, null, 2));
            console.log(`[Kronos] Saved pick snap: ${snapId} grade=${pick.pick_grade} conf=${pick.pick_confidence}`);
          }
        } catch (saveErr: any) {
          console.warn("[Kronos] Failed to save pick snap:", saveErr.message);
        }
      }

      kronosCache.set(cacheKey, { data: enriched, ts: Date.now() });
      return res.json(enriched);

    } catch (e: any) {
      console.error("[CIQ] Endpoint error:", e.message);
      return res.json({
        signal: "neutral", strength: 0, forecast: [],
        explanation: "Clubhouse IQ analysis temporarily unavailable.",
        error: e.message,
      });
    }
  });

  // ─── Linemate + PrizePicks props ──────────────────────────────────────────
  // GET /api/linemate-props?sport=nba  (nba|nfl|mlb|nhl)
  // Returns: recommended picks (SAFE/RISKY/100% Club), full market browser
  // with real lines from PrizePicks/DraftKings/Sleeper + hit rates across
  // L5/L10/L20/L30/Season windows.
  const linemateCache = new Map<string, { data: any; ts: number }>();
  const LINEMATE_TTL = 5 * 60_000; // 5-min cache

  const LINEMATE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin":  "https://linemate.io",
    "Referer": "https://linemate.io/",
    "Accept":  "application/json",
  };

  // Normalise a Linemate pick/market into a consistent shape Clubhouse IQ can use
  function normalisePick(p: any, group: string, sport: string) {
    const player     = p.player ?? {};
    const market     = p.market ?? {};
    const books      = market.books ?? p.books ?? {};

    // Collect lines per book
    const bookLines: Record<string, { line: number; overOdds: number | null; underOdds: number | null }> = {};
    for (const [bookName, bookData] of Object.entries(books as Record<string, any>)) {
      const over  = bookData?.over?.current;
      const under = bookData?.under?.current;
      if (over?.value != null) {
        bookLines[bookName] = {
          line:      over.value,
          overOdds:  over.odds?.american  ?? null,
          underOdds: under?.odds?.american ?? null,
        };
      }
    }

    // Consensus line = mode of lines across books
    const lineVals = Object.values(bookLines).map(b => b.line);
    const consensusLine = lineVals.length
      ? lineVals.sort((a, b) =>
          lineVals.filter(v => v === b).length - lineVals.filter(v => v === a).length
        )[0]
      : null;

    // Hit records — keyed by line value, then window name
    const hitRecords = p.pregameHitRecords ?? market.pregameHitRecords ?? {};
    const hitForLine = consensusLine != null ? (hitRecords[String(consensusLine)] ?? {}) : {};

    // Key windows
    const l5  = hitForLine["LAST_5"]?.all  ?? null;
    const l10 = hitForLine["LAST_10"]?.all ?? null;
    const l20 = hitForLine["LAST_20"]?.all ?? null;
    const l30 = hitForLine["LAST_30"]?.all ?? null;
    const season = hitForLine["SEASON"]?.all ?? null;
    const recentForm = hitForLine["CUSTOM_RECENT_FORM_OVER"]?.all
                    ?? hitForLine["CUSTOM_RECENT_FORM_UNDER"]?.all
                    ?? null;

    // Determine best hit rate across windows (for "100% club" detection)
    const winRates = [l5, l10, l20, l30].filter(Boolean).map((w: any) => w.hitRate ?? 0);
    const bestHitRate = winRates.length ? Math.max(...winRates) : null;

    // Insights / narratives
    const insights   = p.insights   ?? [];
    const narratives = p.narratives ?? [];
    const contextual = p.contextualInsights ?? [];
    const description = p.description ?? "";

    return {
      // Identity
      sport,
      group,
      gameId:      p.gameId ?? "",
      playerName:  player.fullName  ?? "",
      playerPos:   player.position  ?? "",
      teamCode:    p.team?.code     ?? "",
      opponent:    p.opposingTeam?.code ?? "",
      isHome:      p.home ?? null,
      gameTime:    p.timestamp ?? "",

      // Market
      marketName:    market.name ?? p.market ?? "",
      marketType:    market.type ?? "OVER_UNDER",
      outcome:       p.outcome ?? "OVER",
      consensusLine,
      bookLines,

      // Hit rates (most useful at a glance)
      hitRateL5:     l5?.hitRate     ?? null,
      hitRateL10:    l10?.hitRate    ?? null,
      hitRateL20:    l20?.hitRate    ?? null,
      hitRateL30:    l30?.hitRate    ?? null,
      hitRateSeason: season?.hitRate ?? null,
      hitRateRecentForm: recentForm?.hitRate ?? null,
      avgRecentForm: recentForm?.average ?? null,
      bestHitRate,
      is100Club:     bestHitRate != null && bestHitRate >= 100,

      // Full hit records (for detail drawer)
      hitRecords,

      // Context
      description,
      insights,
      narratives,
      contextual,
      impactingInjuries: p.impactingInjuries ?? [],
      opponentDefRank:   p.opponentDefensiveRankInsights ?? null,
    };
  }


  // ── Live Standings for Bracket Tab ────────────────────────────────────────
  // Cache: 24 hours (standings update once daily)
  const STANDINGS_TTL = 24 * 60 * 60 * 1000;  // 24h — force-bust via ?bust=1
  const standingsCache = new Map<string, { ts: number; data: any }>();

  app.get("/api/live-standings", async (req, res) => {
    const sport = ((req.query.sport as string) ?? "mlb").toLowerCase();
    const bust = req.query.bust === "1";
    const cached = standingsCache.get(sport);
    if (!bust && cached && Date.now() - cached.ts < STANDINGS_TTL) return res.json(cached.data);

    try {
      const ESPN_PATHS: Record<string, string> = {
        mlb: "baseball/mlb",
        nba: "basketball/nba",
        nhl: "hockey/nhl",
        nfl: "football/nfl",
      };
      const TOTAL_GAMES: Record<string, number> = { mlb: 162, nba: 82, nhl: 82, nfl: 17 };
      const espnPath = ESPN_PATHS[sport];
      if (!espnPath) return res.status(400).json({ error: "Unknown sport" });

      const standingsUrl = `https://site.api.espn.com/apis/v2/sports/${espnPath}/standings`;
      const standingsResp = await fetch(standingsUrl);
      if (!standingsResp.ok) throw new Error(`ESPN standings failed: ${standingsResp.status}`);
      const standingsData: any = await standingsResp.json();

      const seasonYear = standingsData?.season?.year ?? new Date().getFullYear();
      const totalGamesPerTeam = TOTAL_GAMES[sport] ?? 82;

      // Flatten all entries across all conference/division children
      const allEntries: any[] = [];
      const extractEntries = (node: any)  =>{
        const entries = node?.standings?.entries;
        if (Array.isArray(entries)) {
          allEntries.push(...entries);
        }
        if (Array.isArray(node?.children)) {
          node.children.forEach(extractEntries);
        }
      }
      extractEntries(standingsData);

      // Deduplicate by team id
      const seen = new Set<string>();
      const uniqueEntries = allEntries.filter(e => {
        const id = e?.team?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      // Parse each team's stats
      const getStat = (stats: any[], name: string): number  =>{
        const s = stats.find((x: any) => x.name === name);
        return s ? parseFloat(s.value ?? s.displayValue ?? "0") || 0 : 0;
      }
      const getStatStr = (stats: any[], name: string): string  =>{
        const s = stats.find((x: any) => x.name === name);
        return s ? (s.displayValue ?? "") : "";
      }

      // Calculate max games played to estimate season completion
      let maxGamesPlayed = 0;
      const teams = uniqueEntries.map(e => {
        const team = e.team ?? {};
        const stats = e.stats ?? [];
        const gp = getStat(stats, "gamesPlayed");
        if (gp > maxGamesPlayed) maxGamesPlayed = gp;
        const wins = getStat(stats, "wins");
        const losses = getStat(stats, "losses");
        const seed = getStat(stats, "playoffSeed");
        const pctg = getStat(stats, "winPercent");
        const ppg = getStat(stats, "avgPointsFor") || getStat(stats, "points");
        const oppPpg = getStat(stats, "avgPointsAgainst");
        const differential = getStat(stats, "differential");
        // Conference: use parent chain if available
        const conference = e._conf ?? "";
        return {
          id: team.id ?? "",
          name: team.displayName ?? team.name ?? "Unknown",
          shortName: team.shortDisplayName ?? team.abbreviation ?? "",
          abbreviation: team.abbreviation ?? "",
          logoUrl: team.logos?.[0]?.href ?? `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${sport === "mlb" ? "mlb" : sport === "nba" ? "nba" : sport === "nhl" ? "nhl" : "nfl"}/500/${(team.abbreviation ?? "").toLowerCase()}.png&w=64&h=64`,
          seed: seed,
          gamesPlayed: gp,
          wins: wins,
          losses: losses,
          winPct: pctg,
          ppg: ppg,
          oppPpg: oppPpg,
          differential: differential,
          conference: conference,
          record: `${wins}-${losses}`,
        };
      });

      // Assign conference from standings children structure
      const assignConference = (node: any, confName: string)  =>{
        const entries = node?.standings?.entries;
        if (Array.isArray(entries)) {
          entries.forEach((e: any) => { e._conf = confName; });
        }
        if (Array.isArray(node?.children)) {
          node.children.forEach((c: any) => assignConference(c, confName));
        }
      }
      // Re-do with conference info
      if (Array.isArray(standingsData?.children)) {
        standingsData.children.forEach((confNode: any) => {
          const confName = confNode.name ?? "";
          assignConference(confNode, confName);
        });
      }

      // Re-parse with conference
      const teamsWithConf = uniqueEntries.map(e => {
        const team = e.team ?? {};
        const stats = e.stats ?? [];
        const gp = getStat(stats, "gamesPlayed");
        const wins = getStat(stats, "wins");
        const losses = getStat(stats, "losses");
        const seed = getStat(stats, "playoffSeed");
        const pctg = getStat(stats, "winPercent");
        const ppg = getStat(stats, "avgPointsFor") || getStat(stats, "points");
        const oppPpg = getStat(stats, "avgPointsAgainst");
        const differential = getStat(stats, "differential");
        const gb = getStatStr(stats, "gamesBehind");
        const elim = getStat(stats, "magicNumberElimination");
        const clinch = getStat(stats, "magicNumberClinch");
        const streakStat = stats.find((x: any) => x.name === "streak");
        const streak = streakStat?.displayValue ?? "";
        // clincher: ESPN stores a numeric code when a team has clinched
        // 1=division, 2=conference, 3=playoff berth/division leader, 4=eliminated, 5=presidents trophy, 6=play-in
        // We treat codes 1,2,3,5 as "clinched playoff spot", 6 as "play-in", blank as "projected"
        const clinchCode = getStat(stats, "clincher");
        const clinchStr  = getStatStr(stats, "clincher");
        let clinchStatus: "clinched" | "playin" | "projected" | "eliminated" = "projected";
        if (clinchCode >= 1 && clinchCode <= 3) clinchStatus = "clinched";
        else if (clinchCode === 5) clinchStatus = "clinched";
        else if (clinchCode === 6) clinchStatus = "playin";
        else if (clinchCode === 4) clinchStatus = "eliminated";

        return {
          id: String(team.id ?? ""),
          espnId: String(team.id ?? ""),
          name: team.displayName ?? team.name ?? "Unknown",
          shortName: team.shortDisplayName ?? team.abbreviation ?? "",
          abbreviation: team.abbreviation ?? "",
          seed: Math.round(seed),
          gamesPlayed: Math.round(gp),
          wins: Math.round(wins),
          losses: Math.round(losses),
          winPct: pctg,
          ppg: ppg,
          oppPpg: oppPpg,
          differential: differential,
          conference: e._conf ?? "",
          record: `${Math.round(wins)}-${Math.round(losses)}`,
          gamesBehind: gb,
          streak: streak,
          clinchStatus,  // "clinched" | "playin" | "projected" | "eliminated"
          clinchCode: Math.round(clinchCode),
        };
      });

      // Compute season completion %
      // NBA/NHL: if gamesPlayed=0 it means off-season, check season year
      let seasonPct = 0;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1; // 1-based

      if (maxGamesPlayed > 0) {
        seasonPct = Math.min(100, (maxGamesPlayed / totalGamesPerTeam) * 100);
      } else {
        // gamesPlayed=0 means completed season — check if it's the right year
        // NBA: season ends ~June, next starts ~October
        // NHL: season ends ~June, next starts ~October
        // MLB: season ends ~October, next starts ~April
        // NFL: season ends ~February, next starts ~September
        const isOffseason = (sport === "nba" && (currentMonth >= 7 && currentMonth <= 9)) ||
                            (sport === "nhl" && (currentMonth >= 7 && currentMonth <= 9)) ||
                            (sport === "mlb" && (currentMonth >= 11 || currentMonth <= 2)) ||
                            (sport === "nfl" && (currentMonth >= 3 && currentMonth <= 8));
        seasonPct = isOffseason ? 0 : 100; // if not offseason and gp=0, treat as completed
      }

      // Determine bracket unlock state
      const UNLOCK_THRESHOLD = 90; // show bracket at 90% of season complete
      const bracketUnlocked = seasonPct >= UNLOCK_THRESHOLD;

      // Identify playoff teams (top 6 for MLB, top 8 for NBA/NHL, top 7 for NFL)
      const PLAYOFF_SPOTS: Record<string, number> = { mlb: 6, nba: 8, nhl: 8, nfl: 7 };
      const playoffSpots = PLAYOFF_SPOTS[sport] ?? 8;

      // Group by conference and get top seeds
      const conferences = new Map<string, any[]>();
      teamsWithConf.forEach(t => {
        const key = t.conference || "League";
        if (!conferences.has(key)) conferences.set(key, []);
        conferences.get(key)!.push(t);
      });

      const playoffTeamsByConf: Record<string, any[]> = {};
      // fullConfTeams: ALL teams sorted by seed (used for the swapper modal)
      const fullConfTeams: Record<string, any[]> = {};
      conferences.forEach((teams, confName) => {
        const sorted = [...teams].sort((a, b) => (a.seed || 99) - (b.seed || 99));
        // Exclude eliminated teams (clinchCode=4) from the bracket seedings
        const nonEliminated = sorted.filter(t => t.clinchCode !== 4);
        playoffTeamsByConf[confName] = nonEliminated.slice(0, playoffSpots);
        // Full list excludes eliminated teams (clinchCode=4)
        fullConfTeams[confName] = sorted.filter(t => t.clinchCode !== 4);
      });

      const result = {
        sport,
        seasonYear,
        seasonPct: Math.round(seasonPct * 10) / 10,
        maxGamesPlayed,
        totalGamesPerTeam,
        bracketUnlocked,
        unlockThreshold: UNLOCK_THRESHOLD,
        updatedAt: new Date().toISOString(),
        conferences: Object.fromEntries(
          Array.from(conferences.entries()).map(([name, teams]) => [
            name,
            [...teams].sort((a, b) => (a.seed || 99) - (b.seed || 99)),
          ])
        ),
        playoffTeamsByConf,
        fullConfTeams,   // all non-eliminated teams per conf (for swapper)
        allTeams: teamsWithConf,
      };

      standingsCache.set(sport, { ts: Date.now(), data: result });
      return res.json(result);
    } catch (e: any) {
      console.error("[live-standings]", e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/linemate-props", async (req, res) => {
    const sport  = ((req.query.sport as string) ?? "nba").toLowerCase();
    const cached = linemateCache.get(sport);
    if (cached && Date.now() - cached.ts < LINEMATE_TTL) return res.json(cached.data);

    try {
      const BASE = `https://api.linemate.io/api/${sport}`;

      // Parallel fetch: recommended picks + full market list
      const [straightsRes, marketsRes, gamesRes] = await Promise.allSettled([
        axios.get(`${BASE}/v1/discovery/preview/straights`, {
          params: {
            preferredProviders: "",
            limit: 20,
            groups: "SAFE,RISKY,PERFECT_HIT_RATE_ALTERNATES",
            narratives: "",
          },
          headers: LINEMATE_HEADERS, timeout: 12000,
        }),
        axios.get(`${BASE}/v2/markets`, {
          params: { levelsToInclude: "player" },
          headers: LINEMATE_HEADERS, timeout: 12000,
        }),
        axios.get(`${BASE}/v2/games/current`, {
          params: { recordType: "REGULAR" },
          headers: LINEMATE_HEADERS, timeout: 8000,
        }),
      ]);

      // ── Recommended picks ────────────────────────────────────────────────
      const picks: Record<string, any[]> = { SAFE: [], RISKY: [], "100_CLUB": [] };
      if (straightsRes.status === "fulfilled") {
        const groups = straightsRes.value.data?.groups ?? {};
        for (const [grp, items] of Object.entries(groups as Record<string, any[]>)) {
          const propGroup = grp === "PERFECT_HIT_RATE_ALTERNATES" ? "100_CLUB"
                          : grp === "SAFE"  ? "SAFE"
                          : grp === "RISKY" ? "RISKY"
                          : null;
          if (!propGroup) continue;
          const raw = (items ?? []).map(p => normalisePick(p, propGroup, sport.toUpperCase()));
          picks[propGroup] = sport === "mlb"
            ? raw.filter((p: any) => {
                const mn = (p.marketName ?? "").toUpperCase();
                if (mn === "HITTER_TRIPLES") return false;
                if ((mn === "HITTER_STOLEN_BASES" || mn === "HITTER_HOME_RUNS") && (p.pickSide ?? "").toUpperCase() === "UNDER") return false;
                return true;
              })
            : raw;
        }
      }

      // ── Full market browser ──────────────────────────────────────────────
      // MLB banned market names — triples and H+R+RBI combo are not displayed
      const MLB_BANNED_MARKETS = new Set([
        "HITTER_TRIPLES",
      ]);

      let markets: any[] = [];
      if (marketsRes.status === "fulfilled" && Array.isArray(marketsRes.value.data)) {
        markets = marketsRes.value.data
          .filter((m: any) => {
            if (!m.player || !m.name) return false;
            // For MLB: strip banned market types
            if (sport === "mlb" && MLB_BANNED_MARKETS.has(m.name)) return false;
            return true;
          })
          .map((m: any) => normalisePick(
            {
              gameId:         m.gameId,
              player:         m.player,
              team:           m.team,
              opposingTeam:   m.opposingTeam,
              isHome:         m.isHome,
              market:         m,
              outcome:        "OVER",
              pregameHitRecords: m.pregameHitRecords,
              pregameAverages:   m.pregameAverages,
            },
            "MARKET",
            sport.toUpperCase()
          ));

        // MLB: also filter stolen bases UNDER and HR UNDER from market browser
        if (sport === "mlb") {
          markets = markets.filter((m: any) => {
            const mn = (m.marketName ?? "").toUpperCase();
            if ((mn === "HITTER_STOLEN_BASES" || mn === "HITTER_HOME_RUNS") && (m.pickSide ?? "").toUpperCase() === "UNDER") return false;
            return true;
          });
        }
      }

      // ── Today's games ────────────────────────────────────────────────────
      let games: any[] = [];
      if (gamesRes.status === "fulfilled" && Array.isArray(gamesRes.value.data)) {
        games = gamesRes.value.data.map((g: any) => ({
          gameId:    g.id,
          home:      g.homeTeamCode,
          away:      g.awayTeamCode,
          timestamp: g.timestamp,
          status:    g.status,
        }));
      }

      // ── Build a flat prop-line map for scanner enrichment ─────────────────
      // Key: "PLAYERNAMELOWER:MARKETNAME" → { line, hitRateL10, hitRateL5 }
      const propLineMap: Record<string, { line: number; hitRateL5: number | null; hitRateL10: number | null; source: string }> = {};
      for (const m of markets) {
        if (!m.playerName || m.consensusLine == null) continue;
        const key = `${m.playerName.toLowerCase()}:${m.marketName}`;
        propLineMap[key] = {
          line:       m.consensusLine,
          hitRateL5:  m.hitRateL5,
          hitRateL10: m.hitRateL10,
          source:     "linemate",
        };
      }

      const result = {
        sport: sport.toUpperCase(),
        picks,
        markets,
        games,
        propLineMap,
        fetchedAt: new Date().toISOString(),
      };

      linemateCache.set(sport, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      console.error(`[linemate-props/${sport}] Error:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Top Traders — Polymarket leaderboard + recent trades ──────────────────
  // GET /api/top-traders?category=SPORTS&period=ALL&limit=20
  // Returns: top Polymarket traders by PNL + their recent sports trades
  let topTradersCache: { data: any; ts: number } = { data: null, ts: 0 };
  const TOP_TRADERS_TTL = 5 * 60_000; // 5 min cache (leaderboard changes slowly)

  app.get("/api/top-traders", async (req, res) => {
    try {
      if (Date.now() - topTradersCache.ts < TOP_TRADERS_TTL && topTradersCache.data) {
        return res.json(topTradersCache.data);
      }

      const category  = (req.query.category as string) ?? "SPORTS";
      const period    = (req.query.period   as string) ?? "ALL";
      const limit     = Math.min(25, parseInt(String(req.query.limit ?? "20"), 10));

      // ── 1. Fetch Polymarket leaderboard ──────────────────────────────────
      let traders: any[] = [];
      try {
        const { data: lb } = await axios.get("https://data-api.polymarket.com/v1/leaderboard", {
          params: { category, timePeriod: period, orderBy: "PNL", limit },
          timeout: 10000,
        });
        traders = Array.isArray(lb) ? lb : [];
      } catch (e: any) {
        console.warn("[top-traders] Polymarket leaderboard error:", e.message);
      }

      // ── 2. Fetch recent trades for top 10 traders in parallel ────────────
      // We cap at 10 to avoid too many parallel requests
      const TOP_N = Math.min(10, traders.length);
      const tradeResults = await Promise.allSettled(
        traders.slice(0, TOP_N).map(async (trader: any) => {
          const wallet = trader.proxyWallet;
          if (!wallet) return { wallet, trades: [] };
          try {
            const { data: activity } = await axios.get("https://data-api.polymarket.com/activity", {
              params: {
                user:  wallet,
                limit: 20,
                type:  "TRADE",
                side:  "BUY",
                sortBy: "TIMESTAMP",
                sortDirection: "DESC",
              },
              timeout: 8000,
            });
            const trades: any[] = Array.isArray(activity) ? activity : [];
            // Group by conditionId to compute transaction type and total size per market
            const byMarket = new Map<string, any[]>();
            for (const t of trades) {
              const cid = t.conditionId ?? t.slug ?? "unknown";
              if (!byMarket.has(cid)) byMarket.set(cid, []);
              byMarket.get(cid)!.push(t);
            }
            // Build enriched trade list — deduplicated by market, most recent first
            const enriched: any[] = [];
            for (const [, txns] of byMarket) {
              const latest  = txns[0]; // already sorted newest-first
              const total   = txns.reduce((s, t) => s + (t.usdcSize ?? 0), 0);
              const txCount = txns.length;
              // Classification:
              // single = 1 transaction
              // ongoing = same market traded 3+ times (averaging in or building position)
              // multiple = 2 transactions
              const purchaseType: "single" | "multiple" | "ongoing" =
                txCount >= 3 ? "ongoing" : txCount === 1 ? "single" : "multiple";
              enriched.push({
                market:       latest.title ?? "",
                slug:         latest.slug ?? "",
                eventSlug:    latest.eventSlug ?? "",
                outcome:      latest.outcome ?? "",
                side:         latest.side ?? "BUY",
                price:        latest.price ?? 0,
                totalUsdc:    Math.round(total * 100) / 100,
                txCount,
                purchaseType,
                timestamp:    latest.timestamp ?? 0,
                icon:         latest.icon ?? "",
                conditionId:  latest.conditionId ?? "",
                polyUrl:      latest.slug ? `https://polymarket.com/event/${latest.eventSlug || latest.slug}` : null,
              });
            }
            // Sort by total USDC spent descending (biggest bets first)
            enriched.sort((a, b) => b.totalUsdc - a.totalUsdc);
            return { wallet, trades: enriched.slice(0, 10) };
          } catch {
            return { wallet, trades: [] };
          }
        })
      );

      // ── 3. Merge leaderboard + trades ─────────────────────────────────────
      const enrichedTraders = traders.slice(0, TOP_N).map((trader: any, i: number) => {
        const result = tradeResults[i];
        const trades = result.status === "fulfilled" ? result.value.trades : [];
        const displayName = trader.userName && !trader.userName.startsWith("0x")
          ? trader.userName
          : `Trader ${(trader.rank ?? i + 1)}`;
        const shortWallet = trader.proxyWallet
          ? `${trader.proxyWallet.slice(0, 6)}…${trader.proxyWallet.slice(-4)}`
          : "";
        return {
          rank:         trader.rank ?? String(i + 1),
          wallet:       trader.proxyWallet ?? "",
          shortWallet,
          displayName,
          xUsername:    trader.xUsername ?? null,
          profileImage: trader.profileImage ?? null,
          verifiedBadge: trader.verifiedBadge ?? false,
          vol:          trader.vol  ?? 0,
          pnl:          trader.pnl  ?? 0,
          trades,
          source:       "polymarket",
        };
      });

      // Append remaining leaderboard entries (11-25) without trade detail
      for (let i = TOP_N; i < traders.length; i++) {
        const trader = traders[i];
        const displayName = trader.userName && !trader.userName.startsWith("0x")
          ? trader.userName
          : `Trader ${(trader.rank ?? i + 1)}`;
        const shortWallet = trader.proxyWallet
          ? `${trader.proxyWallet.slice(0, 6)}…${trader.proxyWallet.slice(-4)}`
          : "";
        enrichedTraders.push({
          rank:         trader.rank ?? String(i + 1),
          wallet:       trader.proxyWallet ?? "",
          shortWallet,
          displayName,
          xUsername:    trader.xUsername ?? null,
          profileImage: trader.profileImage ?? null,
          verifiedBadge: trader.verifiedBadge ?? false,
          vol:          trader.vol  ?? 0,
          pnl:          trader.pnl  ?? 0,
          trades:       [],
          source:       "polymarket",
        });
      }

      const result = {
        traders:   enrichedTraders,
        category,
        period,
        source:    "polymarket",
        fetchedAt: new Date().toISOString(),
      };

      topTradersCache = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      console.error("[top-traders] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Top Traders: positions (open bets) per wallet ─────────────────────────
  // GET /api/top-traders/positions?category=SPORTS&period=ALL&limit=20
  // Returns: all open positions held by top traders, aggregated across wallets
  let topTradersPositionsCache: { data: any; ts: number } = { data: null, ts: 0 };
  const POSITIONS_TTL = 3 * 60_000; // 3 min cache

  app.get("/api/top-traders/positions", async (req, res) => {
    try {
      if (Date.now() - topTradersPositionsCache.ts < POSITIONS_TTL && topTradersPositionsCache.data) {
        return res.json(topTradersPositionsCache.data);
      }

      const category = (req.query.category as string) ?? "SPORTS";
      const period   = (req.query.period   as string) ?? "ALL";
      const limit    = Math.min(25, parseInt(String(req.query.limit ?? "20"), 10));

      // 1. Fetch leaderboard to get wallets
      let traders: any[] = [];
      try {
        const { data: lb } = await axios.get("https://data-api.polymarket.com/v1/leaderboard", {
          params: { category, timePeriod: period, orderBy: "PNL", limit },
          timeout: 10000,
        });
        traders = Array.isArray(lb) ? lb : [];
      } catch (e: any) {
        console.warn("[top-traders/positions] leaderboard error:", e.message);
      }

      const TOP_N = Math.min(15, traders.length);

      // 2. Fetch positions for each trader in parallel
      const posResults = await Promise.allSettled(
        traders.slice(0, TOP_N).map(async (trader: any) => {
          const wallet = trader.proxyWallet;
          if (!wallet) return { trader, positions: [] };
          const displayName = trader.userName && !trader.userName.startsWith("0x")
            ? trader.userName
            : `Trader ${trader.rank ?? "?"}`;
          try {
            const { data: pos } = await axios.get("https://data-api.polymarket.com/positions", {
              params: { user: wallet, limit: 20, sizeThreshold: 5 },
              timeout: 8000,
            });
            const positions = Array.isArray(pos) ? pos : [];
            // Filter out fully resolved / redeemable / near-zero value
            const active = positions
              .filter((p: any) => !p.redeemable && (p.currentValue ?? 0) > 1)
              .map((p: any) => ({
                wallet,
                shortWallet: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
                displayName,
                xUsername:    trader.xUsername ?? null,
                profileImage: trader.profileImage ?? null,
                rank:         trader.rank ?? 0,
                pnl:          trader.pnl ?? 0,
                // Position fields
                title:        p.title ?? "",
                slug:         p.slug ?? "",
                eventSlug:    p.eventSlug ?? "",
                icon:         p.icon ?? "",
                outcome:      p.outcome ?? "",
                size:         p.size ?? 0,
                avgPrice:     p.avgPrice ?? 0,
                curPrice:     p.curPrice ?? 0,
                currentValue: p.currentValue ?? 0,
                initialValue: p.initialValue ?? 0,
                cashPnl:      p.cashPnl ?? 0,
                percentPnl:   p.percentPnl ?? 0,
                endDate:      p.endDate ?? "",
                polyUrl:      p.slug ? `https://polymarket.com/event/${p.eventSlug || p.slug}` : null,
                conditionId:  p.conditionId ?? "",
                asset:        p.asset ?? "",
              }));
            return { trader, positions: active };
          } catch {
            return { trader, positions: [] };
          }
        })
      );

      // 3. Flatten to a unified list of positions sorted by currentValue desc
      const allPositions: any[] = [];
      for (const r of posResults) {
        if (r.status === "fulfilled") {
          allPositions.push(...r.value.positions);
        }
      }
      allPositions.sort((a, b) => b.currentValue - a.currentValue);

      // Also build per-trader summary (wallet → positions)
      const byTrader: Record<string, { displayName: string; xUsername: string | null; profileImage: string | null; rank: number; pnl: number; positions: any[] }> = {};
      for (const p of allPositions) {
        if (!byTrader[p.wallet]) {
          byTrader[p.wallet] = {
            displayName:  p.displayName,
            xUsername:    p.xUsername,
            profileImage: p.profileImage,
            rank:         p.rank,
            pnl:          p.pnl,
            positions:    [],
          };
        }
        byTrader[p.wallet].positions.push(p);
      }

      const result = {
        positions:  allPositions,
        byTrader,
        category,
        period,
        fetchedAt: new Date().toISOString(),
      };

      topTradersPositionsCache = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      console.error("[top-traders/positions] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Top Traders: deep position detail ─────────────────────────────────────
  // GET /api/top-traders/position-detail?conditionId=0x...&wallet=0x...&asset=TOKEN_ID
  // Returns: market description, volume/liquidity, price history, full trade log for this wallet
  const posDetailCache = new Map<string, { data: any; ts: number }>();
  const POS_DETAIL_TTL = 2 * 60_000; // 2 min

  app.get("/api/top-traders/position-detail", async (req, res) => {
    try {
      const conditionId = req.query.conditionId as string;
      const wallet      = req.query.wallet      as string;
      const asset       = req.query.asset       as string;

      if (!conditionId || !wallet) {
        return res.status(400).json({ error: "conditionId and wallet are required" });
      }

      const cacheKey = `${conditionId}:${wallet}`;
      if (posDetailCache.has(cacheKey)) {
        const cached = posDetailCache.get(cacheKey)!;
        if (Date.now() - cached.ts < POS_DETAIL_TTL) return res.json(cached.data);
      }

      // Parallel fetch: market detail + price history + trade log
      const [marketRes, historyRes, tradesRes] = await Promise.allSettled([
        // 1. Market description, volume, resolution source
        axios.get("https://gamma-api.polymarket.com/markets", {
          params: { conditionIds: conditionId },
          timeout: 8000,
        }),
        // 2. Price history (last 30 days, daily fidelity)
        asset ? axios.get("https://clob.polymarket.com/prices-history", {
          params: { market: asset, interval: "1m", fidelity: 1440 },
          timeout: 8000,
        }) : Promise.resolve({ data: { history: [] } }),
        // 3. Full trade log for this wallet on this market
        axios.get("https://data-api.polymarket.com/activity", {
          params: { user: wallet, conditionId, type: "TRADE", limit: 50 },
          timeout: 8000,
        }),
      ]);

      // Parse market detail
      let market: any = {};
      if (marketRes.status === "fulfilled" && Array.isArray(marketRes.value.data) && marketRes.value.data.length > 0) {
        const m = marketRes.value.data[0];
        market = {
          question:         m.question ?? "",
          description:      m.description ?? "",
          resolutionSource: m.resolutionSource ?? "",
          volume:           m.volumeNum ?? m.volume ?? 0,
          volume24hr:       m.volume24hr ?? 0,
          volume1wk:        m.volume1wk ?? 0,
          volume1mo:        m.volume1mo ?? 0,
          liquidity:        m.liquidityNum ?? m.liquidity ?? 0,
          outcomePrices:    (() => { try { return JSON.parse(m.outcomePrices ?? "[]"); } catch { return []; } })(),
          outcomes:         (() => { try { return JSON.parse(m.outcomes ?? "[]"); } catch { return []; } })(),
          startDate:        m.startDateIso ?? m.startDate ?? "",
          endDate:          m.endDateIso   ?? m.endDate   ?? "",
          active:           m.active ?? true,
          closed:           m.closed ?? false,
        };
      }

      // Parse price history
      let priceHistory: { t: number; p: number }[] = [];
      if (historyRes.status === "fulfilled") {
        priceHistory = historyRes.value.data?.history ?? [];
      }

      // Parse trade log
      let trades: any[] = [];
      if (tradesRes.status === "fulfilled" && Array.isArray(tradesRes.value.data)) {
        trades = tradesRes.value.data.map((t: any) => ({
          side:      t.side ?? "BUY",
          price:     t.price ?? 0,
          size:      t.size ?? 0,
          usdcSize:  t.usdcSize ?? 0,
          outcome:   t.outcome ?? "",
          timestamp: t.timestamp ?? 0,
          txHash:    t.transactionHash ?? null,
        }));
      }

      // Summary stats from trades
      const buys        = trades.filter(t => t.side === "BUY");
      const sells       = trades.filter(t => t.side === "SELL");
      const totalIn     = buys.reduce((s, t) => s + t.usdcSize, 0);
      const totalOut    = sells.reduce((s, t) => s + t.usdcSize, 0);
      const firstTrade  = trades.length ? trades[trades.length - 1] : null;
      const latestTrade = trades.length ? trades[0] : null;

      const result = {
        market,
        priceHistory,
        trades,
        summary: {
          totalIn:      Math.round(totalIn  * 100) / 100,
          totalOut:     Math.round(totalOut * 100) / 100,
          totalTrades:  trades.length,
          buyCount:     buys.length,
          sellCount:    sells.length,
          firstTradeAt: firstTrade?.timestamp ?? 0,
          latestTradeAt: latestTrade?.timestamp ?? 0,
          avgBuyPrice:  buys.length ? buys.reduce((s, t) => s + t.price, 0) / buys.length : 0,
        },
      };

      posDetailCache.set(cacheKey, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      console.error("[position-detail] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Prediction Markets: per-market transaction type for whale alerts ──────
  // GET /api/prediction-markets/txtype/:marketId
  // Returns: purchaseType (single/multiple/ongoing) + txCount for a specific whale market
  app.get("/api/prediction-markets/txtype/:marketId", async (req, res) => {
    try {
      const { marketId } = req.params;
      // Only Polymarket markets can have wallet-based transaction lookup
      if (!marketId.startsWith("poly-")) {
        // Kalshi: use vol24h heuristic from cache
        const cached = predMktCache.data.find((m: any) => m.id === marketId);
        if (!cached) return res.json({ purchaseType: "single", txCount: 1 });
        const vol = cached.vol24h ?? 0;
        // Kalshi: vol < $2K = likely single; $2K-$8K = multiple; > $8K = ongoing
        const purchaseType = vol >= 8_000 ? "ongoing" : vol >= 2_000 ? "multiple" : "single";
        return res.json({ purchaseType, txCount: purchaseType === "ongoing" ? 5 : purchaseType === "multiple" ? 2 : 1, source: "heuristic" });
      }

      // Polymarket: look up CLOB trades for the conditionId
      const rawId = marketId.replace("poly-", "");
      const cached = predMktCache.data.find((m: any) => m.id === marketId);
      if (!cached) return res.json({ purchaseType: "single", txCount: 1, source: "not_found" });

      // Fetch recent trades on the CLOB for this market
      try {
        const { data: tradesData } = await axios.get("https://clob.polymarket.com/trades", {
          params: { market: cached.conditionId ?? rawId, limit: 50 },
          timeout: 8000,
        });
        const trades = (tradesData?.data ?? tradesData?.trades ?? (Array.isArray(tradesData) ? tradesData : [])) as any[];
        if (trades.length === 0) return res.json({ purchaseType: "single", txCount: 1, source: "clob" });

        // Group by maker address (takerAddress is the buyer for CLOB)
        const byMaker = new Map<string, number>();
        for (const t of trades) {
          const addr = t.maker ?? t.takerAddress ?? t.maker_address ?? "";
          if (addr) byMaker.set(addr, (byMaker.get(addr) ?? 0) + 1);
        }
        // Top buyer: how many transactions did they make?
        const maxTxns = Math.max(...Array.from(byMaker.values()));
        const purchaseType: "single" | "multiple" | "ongoing" =
          maxTxns >= 3 ? "ongoing" : maxTxns === 1 ? "single" : "multiple";
        return res.json({
          purchaseType,
          txCount:       maxTxns,
          totalTrades:   trades.length,
          uniqueBuyers:  byMaker.size,
          source:        "clob",
        });
      } catch {
        // CLOB may return 404 or empty — use vol24h heuristic
        const vol = cached.vol24h ?? 0;
        const purchaseType = vol >= 500_000 ? "ongoing" : vol >= 200_000 ? "multiple" : "single";
        return res.json({ purchaseType, txCount: purchaseType === "ongoing" ? 5 : purchaseType === "multiple" ? 2 : 1, source: "heuristic" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Debug endpoint — check Underdog NHL cache + current bets breakdown
  app.get("/api/debug/nhl", async (req, res) => {
    try {
      const axios = (await import("axios")).default;
      const cacheResp = await axios.get("https://raw.githubusercontent.com/abudnick8/clubhouse-iq/cache/data/underdog-cache/underdog_NHL.json", { timeout: 10000 });
      const cacheData = cacheResp.data;
      const lines: any[] = cacheData.over_under_lines ?? [];
      const goalLines = lines.filter((l: any) => {
        const ou = l.over_under ?? {};
        const appStat = ou.appearance_stat ?? {};
        return l.status === "active" && ou.category === "player_prop" && (appStat.stat ?? "").toLowerCase() === "goals";
      });
      const allBets = await storage.getBets();
      const nhlBets = allBets.filter((b: any) => b.sport === "NHL");
      const nhlGoalBets = nhlBets.filter((b: any) => b.title.toLowerCase().includes("goals"));
      const nhlLotto = nhlBets.filter((b: any) => b.isLotto);
      const nhlUnd = nhlBets.filter((b: any) => b.source === "underdog");
      const statBreakdown: Record<string, number> = {};
      for (const b of nhlUnd) { const s = (b.teamStats as any)?.statType ?? "?"; statBreakdown[s] = (statBreakdown[s] ?? 0) + 1; }
      res.json({
        cache: { totalLines: lines.length, goalLines: goalLines.length, cachedAt: cacheData.cached_at },
        bets: { nhlTotal: nhlBets.length, nhlGoals: nhlGoalBets.length, nhlLotto: nhlLotto.length, nhlUnderdog: nhlUnd.length, nhlUnderdogStats: statBreakdown },
        sampleGoalBets: nhlGoalBets.slice(0, 3).map((b: any) => b.title),
        buildTime: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API Quota Check ─────────────────────────────────────────────────────
  // TEMP DEBUG — remove after Underdog fix confirmed

  app.get("/api/quota", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const apiKey = settings.oddsApiKey;
      if (!apiKey) return res.json({ status: "no_key", used: null, remaining: null, resets: null });

      const axios = (await import("axios")).default;
      const response = await axios.head(
        `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`,
        { timeout: 8000 }
      );
      const used = parseInt(response.headers["x-requests-used"] ?? "0");
      const remaining = parseInt(response.headers["x-requests-remaining"] ?? "0");

      // The Odds API resets on the 1st of each month UTC
      const now = new Date();
      const resetDate = new Date(Date.UTC(
        now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
        now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1,
        1
      ));

      res.json({
        status: remaining > 0 ? "ok" : "exhausted",
        used,
        remaining,
        resets: resetDate.toISOString(),
        plan: remaining > 5000 ? "paid_20000" : "free_500",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── User Preferences ────────────────────────────────────────────────────────
  // GET /api/me/preferences
  app.get("/api/me/preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const result = await db.query(`SELECT preferences FROM users WHERE id=$1`, [userId]);
      res.json(result.rows[0]?.preferences ?? {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/me/preferences — merge-save user preferences
  app.patch("/api/me/preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const incoming = req.body as {
        favoriteSports?: string[];
        favoriteTeams?: string[];
        favoritePlayers?: string[];
      };
      const cur = await db.query(`SELECT preferences FROM users WHERE id=$1`, [userId]);
      const existing = cur.rows[0]?.preferences ?? {};
      const merged = { ...existing, ...incoming };
      await db.query(
        `UPDATE users SET preferences=$1::jsonb, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(merged), userId]
      );
      res.json({ ok: true, preferences: merged });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Settings ─────────────────────────────────────────────────────────────
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const updated = await storage.updateSettings(req.body);

      // Restart scan interval if interval changed
      const interval = updated.scanIntervalMinutes ?? 30;
      if (scanInterval) clearInterval(scanInterval);
      scanInterval = setInterval(async () => {
        const s = await storage.getSettings();
        await runScan(s.oddsApiKey);
      }, interval * 60 * 1000);

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Notifications ────────────────────────────────────────────────────────
  app.get("/api/notifications", async (req, res) => {
    try {
      const notifications = await storage.getNotifications();
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/notifications/unread", async (req, res) => {
    try {
      const notifications = await storage.getUnreadNotifications();
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/notifications/:id/dismiss", async (req, res) => {
    try {
      await storage.dismissNotification(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/notifications", async (req, res) => {
    try {
      await storage.clearNotifications();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Player Stats (Basketball-Reference / Pro-Football-Reference) ─────────
  app.get("/api/player-stats/:sport/:playerName", async (req, res) => {
    try {
      const { sport, playerName } = req.params;
      const cacheKey = `${sport}:${playerName}`;
      const cached = STAT_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.json(cached.data);
      }
      let data: any = null;
      const sportUp = sport.toUpperCase();
      // All sports now use ESPN v3 gamelog (reliable, no slug maps needed)
      data = await fetchESPNGameLog(playerName, sportUp);
      if (!data) return res.status(404).json({ error: "Player not found or stats unavailable" });
      STAT_CACHE.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Stats ────────────────────────────────────────────────────────────────
  // ─── Ask a Question (AI bet analysis) ──────────────────────────────────────
  app.post("/api/ask", async (req, res) => {
    try {
      const { question } = req.body as { question: string };
      if (!question?.trim()) return res.status(400).json({ error: "question is required" });

      const bets = await storage.getBets();
      const q = question.toLowerCase();
      const byConf = (a: any, b: any) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);

      // ─── Intent Detection ────────────────────────────────────────────────────────
      // Detect parlay requests: "build me a 4 player parlay", "4 leg parlay", "parlay for tonight"
      const parlayMatch = q.match(/(?:build|give|make|create|suggest|find|pick).*?(\d+)[- ]?(?:leg|player|pick|team|bet)?.*?parlay/i)
        ?? q.match(/parlay.*?(\d+)[- ]?(?:leg|player|pick|team|bet)/i)
        ?? q.match(/(\d+)[- ]?(?:leg|player|pick|team|bet)[- ]?parlay/i);
      const isParlayRequest = !!parlayMatch || (q.includes("parlay") && !q.includes("same game") && !q.includes("sgp"));
      const parlayLegs = parlayMatch ? parseInt(parlayMatch[1]) : (isParlayRequest ? 4 : 0);

      // SGP detection: "same game parlay", "sgp", "same-game"
      const isSGPRequest = q.includes("same game parlay") || q.includes("same-game parlay")
        || q.includes("sgp") || q.includes("same game props") || q.includes("same game picks");

      // Detect sport filter from question (includes optional sports)
      const sportFilter = q.includes("nba") || q.includes("basketball") ? "NBA"
        : q.includes("nfl") || q.includes("football") ? "NFL"
        : q.includes("mlb") || q.includes("baseball") ? "MLB"
        : q.includes("nhl") || q.includes("hockey") ? "NHL"
        : q.includes("mma") || q.includes("ufc") || q.includes("bellator") ? "MMA"
        : q.includes("boxing") || q.includes("fighter") ? "Boxing"
        : q.includes("ncaab") || q.includes("college basketball") || q.includes("march madness") ? "NCAAB"
        : q.includes("ncaaf") || q.includes("college football") ? "NCAAF"
        : q.includes("golf") || q.includes("pga") || q.includes("masters") ? "Golf" : null;

      // Detect if asking about best/top picks generally
      const isTopPicksRequest = !isParlayRequest && !isSGPRequest && (
        q.includes("best") || q.includes("top") || q.includes("recommend") ||
        q.includes("tonight") || q.includes("today") || q.includes("right now") ||
        q.includes("what should") || q.includes("which bet") || q.includes("good bet")
      ) && !q.match(/\b(is|should i|would|will|does|did|can|could)\b/);

      // Score all bets by relevance to the question
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      const scored = bets.map((b) => {
        let score = 0;
        const fields = [
          b.title, b.description, b.playerName, b.homeTeam, b.awayTeam,
          b.sport, b.betType, b.source, b.researchSummary,
          ...(b.keyFactors ?? []),
        ].map((f) => (f ?? "").toLowerCase());
        for (const f of fields) for (const word of words) if (f.includes(word)) score += 1;
        if (b.playerName && words.some((w) => b.playerName!.toLowerCase().includes(w))) score += 4;
        if ((b.homeTeam && words.some((w) => b.homeTeam!.toLowerCase().includes(w))) ||
            (b.awayTeam && words.some((w) => b.awayTeam!.toLowerCase().includes(w)))) score += 4;
        if (b.betType === "player_prop") score += 0.5;
        if ((b.confidenceScore ?? 0) >= 85) score += 1;
        // Sport filter bonus
        if (sportFilter && b.sport === sportFilter) score += 3;
        return { bet: b, score };
      }).sort((a, b) => b.score - a.score || byConf(a.bet, b.bet));

      const totalBets = bets.length;
      const propCount = bets.filter((b) => b.betType === "player_prop").length;
      const highConfCount = bets.filter((b) => (b.confidenceScore ?? 0) >= 85).length;

      // Helper: format a single bet for display/text
      const betSummary = (b: any, idx: number): string  =>{
        const line = b.line != null ? ` | Line: ${b.line}` : "";
        const over = b.overOdds != null ? ` | Over: ${b.overOdds > 0 ? "+" : ""}${b.overOdds}` : "";
        const under = b.underOdds != null ? ` / Under: ${b.underOdds > 0 ? "+" : ""}${b.underOdds}` : "";
        const conf = ` | Conf: ${b.confidenceScore ?? "?"}/100`;
        const risk = b.riskLevel ? ` | Risk: ${b.riskLevel}` : "";
        const matchup = b.awayTeam && b.homeTeam ? ` | ${b.awayTeam} @ ${b.homeTeam}` : "";
        const factors = b.keyFactors?.length ? `\n   Why: ${b.keyFactors.slice(0, 3).join("; ")}` : "";
        return `${idx}. [${b.sport} ${b.betType}] ${b.title}${matchup}${line}${over}${under}${conf}${risk}${factors}`;
      }

      // Helper: serialize a bet for the relatedBets response
      const serializeBet = (b: any, reason: string)  =>{
        return {
          id: b.id, title: b.title, sport: b.sport, betType: b.betType,
          playerName: b.playerName ?? null, homeTeam: b.homeTeam ?? null, awayTeam: b.awayTeam ?? null,
          confidenceScore: b.confidenceScore ?? null, riskLevel: b.riskLevel ?? null,
          line: b.line ?? null, overOdds: b.overOdds ?? null, underOdds: b.underOdds ?? null,
          recommendedAllocation: b.recommendedAllocation ?? null,
          keyFactors: (b.keyFactors ?? []).slice(0, 2),
          gameTime: b.gameTime ?? null,
          similarityReason: reason,
        };
      }

      let answer: string;
      let relatedBets: any[] = [];

      // ─── SGP MODE (Same Game Parlay) ─────────────────────────────────────
      if (isSGPRequest) {
        // Extract leg count if specified, default 3
        const sgpLegMatch = q.match(/(\d+)[- ]?(?:leg|pick|prop)?/);
        const sgpLegs = sgpLegMatch ? Math.min(Math.max(parseInt(sgpLegMatch[1]), 2), 6) : 3;

        // Extract a specific team or game if mentioned
        const teamWords = q.replace(/same.?game|parlay|sgp|props?|picks?|legs?|build|give|make|create|suggest|find/gi, "").trim().split(/\s+/).filter(w => w.length > 2);

        // Filter to player props only, score by team/game match
        const propPool = bets
          .filter(b => b.betType === "player_prop" && (b.confidenceScore ?? 0) >= 60)
          .map(b => {
            let score = 0;
            const fields = [b.playerName, b.homeTeam, b.awayTeam, b.title, b.sport].map(f => (f ?? "").toLowerCase());
            for (const f of fields) for (const w of teamWords) if (f.includes(w)) score += 3;
            if (sportFilter && b.sport === sportFilter) score += 5;
            score += (b.confidenceScore ?? 0) / 20; // confidence tiebreaker
            return { bet: b, score };
          })
          .sort((a, b) => b.score - a.score);

        // Group by game (homeTeam|awayTeam key)
        const gameGroups = new Map<string, any[]>();
        for (const { bet } of propPool) {
          const key = [bet.homeTeam, bet.awayTeam].filter(Boolean).sort().join("|");
          if (!key) continue;
          if (!gameGroups.has(key)) gameGroups.set(key, []);
          gameGroups.get(key)!.push(bet);
        }

        // Pick the best game (most high-conf props available)
        let bestGame: { key: string; bets: any[] } | null = null;
        for (const [key, gameBets] of gameGroups) {
          if (!bestGame || gameBets.length > bestGame.bets.length) {
            bestGame = { key, bets: gameBets };
          }
        }

        // If a specific game was mentioned by team name, prefer that one
        if (teamWords.length > 0) {
          for (const [key, gameBets] of gameGroups) {
            if (teamWords.some(w => key.toLowerCase().includes(w))) {
              bestGame = { key, bets: gameBets };
              break;
            }
          }
        }

        if (!bestGame || bestGame.bets.length < 2) {
          // Fallback: just use top props from any games, dedupe by player
          const fallbackLegs: any[] = [];
          const usedPlayers = new Set<string>();
          for (const { bet } of propPool) {
            if (fallbackLegs.length >= sgpLegs) break;
            if (bet.playerName && usedPlayers.has(bet.playerName.toLowerCase())) continue;
            fallbackLegs.push(bet);
            if (bet.playerName) usedPlayers.add(bet.playerName.toLowerCase());
          }
          relatedBets = fallbackLegs.map(b => serializeBet(b, "sgp leg"));
          const avgConf = fallbackLegs.length ? Math.round(fallbackLegs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / fallbackLegs.length) : 0;
          answer = `⚡ SAME GAME PARLAY — ${fallbackLegs.length} Props (avg confidence: ${avgConf}/100)\n\nNote: Not enough props found for a single game — showing top props across games.\n\n${fallbackLegs.map((b, i) => {
            const conf = b.confidenceScore ?? 0;
            const line = b.line != null ? ` | Line: ${b.line}` : "";
            const odds = b.overOdds != null ? ` (${b.overOdds > 0 ? "+" : ""}${b.overOdds})` : "";
            const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 100) ?? "";
            return `**Leg ${i+1}: ${b.title}**${line}${odds}\n   Confidence: ${conf}/100 | Player: ${b.playerName ?? "—"}\n   Why: ${why}`;
          }).join("\n\n")}\n\n⚠️ SGP odds are correlated — books may restrict parlay combinations on the same game.`;
        } else {
          // Pick top N legs from the best game, dedupe by player and stat type
          const gameBets = bestGame.bets;
          const gameName = bestGame.key.replace("|", " vs ");
          const [home, away] = bestGame.key.split("|");
          const legs: any[] = [];
          const usedPlayers = new Set<string>();
          const usedStats = new Set<string>();

          for (const b of gameBets.sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))) {
            if (legs.length >= sgpLegs) break;
            if (b.playerName && usedPlayers.has(b.playerName.toLowerCase())) continue;
            // Avoid duplicate stat categories (e.g. two "points" props)
            const statKey = (b.title ?? "").toLowerCase().match(/over|under/i) ? b.title.toLowerCase().replace(/[\d.]/g, "").trim() : b.title.toLowerCase();
            if (usedStats.has(statKey)) continue;
            legs.push(b);
            if (b.playerName) usedPlayers.add(b.playerName.toLowerCase());
            usedStats.add(statKey);
          }

          // If still short, pad from other games
          if (legs.length < sgpLegs) {
            const extra = propPool
              .map(p => p.bet)
              .filter(b => !legs.find(l => l.id === b.id) && (b.confidenceScore ?? 0) >= 65)
              .slice(0, sgpLegs - legs.length);
            legs.push(...extra);
          }

          relatedBets = legs.map(b => serializeBet(b, "sgp leg"));
          const avgConf = legs.length ? Math.round(legs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / legs.length) : 0;
          const verdict = avgConf >= 85 ? "🔥 HIGH CONFIDENCE SGP" : avgConf >= 70 ? "⚡ SOLID SGP" : "⚠️ MODERATE SGP";

          const legsText = legs.map((b, i) => {
            const conf = b.confidenceScore ?? 0;
            const confVerdict = conf >= 82 ? "✅" : conf >= 70 ? "⚠️" : "❌";
            const line = b.line != null ? ` | Line: ${b.line}` : "";
            const odds = b.overOdds != null ? ` (${b.overOdds > 0 ? "+" : ""}${b.overOdds})` : "";
            const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 120) ?? "";
            return `**Leg ${i+1}: ${b.title}**${line}${odds}\n   ${confVerdict} Confidence: ${conf}/100 | Player: ${b.playerName ?? "—"}\n   Why: ${why}`;
          }).join("\n\n");

          answer = `${verdict} — ${legs.length}-Leg SGP\n📍 Game: ${gameName}\nAvg Confidence: ${avgConf}/100\n\n${legsText}\n\n⚠️ SGP reminder: all legs must hit. Books often limit SGP payouts on correlated props (e.g. a player scoring more often leads to more assists). Check your book's SGP rules before placing.`;
        }

      // ─── PARLAY MODE ────────────────────────────────────────────────────────
      } else if (isParlayRequest) {
        const n = Math.min(Math.max(parlayLegs, 2), 8); // clamp 2-8 legs

        // Pick the top N bets, filtered by sport if specified, prioritizing props
        let pool = bets.filter((b) => {
          if (sportFilter && b.sport !== sportFilter) return false;
          return (b.confidenceScore ?? 0) >= 70;
        }).sort(byConf);

        // Prefer player props if "player parlay" was mentioned
        if (q.includes("player")) {
          const props = pool.filter((b) => b.betType === "player_prop");
          if (props.length >= n) pool = props;
        }

        // Deduplicate: no two legs from same player
        const legs: any[] = [];
        const usedPlayers = new Set<string>();
        const usedGames = new Map<string, number>(); // gameKey -> count
        for (const b of pool) {
          if (legs.length >= n) break;
          // Skip duplicate same player
          if (b.playerName && usedPlayers.has(b.playerName.toLowerCase())) continue;
          // Max 2 legs from same game
          const gameKey = [b.homeTeam, b.awayTeam].filter(Boolean).sort().join("|");
          if (gameKey && (usedGames.get(gameKey) ?? 0) >= 2) continue;
          legs.push(b);
          if (b.playerName) usedPlayers.add(b.playerName.toLowerCase());
          if (gameKey) usedGames.set(gameKey, (usedGames.get(gameKey) ?? 0) + 1);
        }

        // Fallback: if not enough legs with filters, add top high-conf bets
        if (legs.length < n) {
          const fallback = bets.filter((b) => !legs.find((l) => l.id === b.id) && (b.confidenceScore ?? 0) >= 65)
            .sort(byConf).slice(0, n - legs.length);
          legs.push(...fallback);
        }

        relatedBets = legs.map((b) => serializeBet(b, "parlay leg"));

        // Build the written answer
        const sportLabel = sportFilter ? sportFilter : "multi-sport";
        const legsText = legs.map((b, i) => {
          const conf = b.confidenceScore ?? 0;
          const verdict = conf >= 85 ? "✅ Strong" : conf >= 75 ? "⚠️ Moderate" : "⚠️ Risky";
          const line = b.line != null ? ` (Line: ${b.line})` : "";
          const odds = b.overOdds != null
            ? ` — Over ${b.overOdds > 0 ? "+" : ""}${b.overOdds} / Under ${b.underOdds ?? "?"}` : "";
          const matchup = b.awayTeam && b.homeTeam ? `\n   🏀 ${b.awayTeam} @ ${b.homeTeam}` : "";
          const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 120) ?? "Market consensus";
          return `**Leg ${i + 1}: ${b.title}**${line}${odds}\n   Confidence: ${conf}/100 ${verdict}${matchup}\n   Why: ${why}`;
        }).join("\n\n");

        const avgConf = legs.length ? Math.round(legs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / legs.length) : 0;
        const combinedVerdict = avgConf >= 82 ? "🔥 STRONG PARLAY" : avgConf >= 72 ? "⚠️ MODERATE PARLAY" : "❌ HIGH RISK PARLAY";

        answer = `${combinedVerdict} — ${n}-Leg ${sportLabel} Parlay (avg confidence: ${avgConf}/100)\n\n${legsText}\n\n⚠️ Parlay reminder: each leg must hit. The more legs, the higher the payout but lower the overall probability. Consider splitting into 2-leg parlays to reduce risk.`;

      // ─── SPECIFIC BET / PLAYER / TEAM QUESTION MODE ──────────────────────────
      } else {
        const topDirect = scored.filter((s) => s.score > 0).slice(0, Math.max(4, isTopPicksRequest ? 6 : 4));
        const context = topDirect.length > 0
          ? topDirect.map((s) => s.bet)
          : bets.filter((b) => {
              if (sportFilter && b.sport !== sportFilter) return false;
              return (b.confidenceScore ?? 0) >= 78;
            }).sort(byConf).slice(0, 5);

        const contextText = context.map((b, i) => betSummary(b, i + 1)).join("\n\n");

        // Build similar bets for the cards panel (different from the main context)
        const seen = new Set(context.map((b) => b.id));
        const topBet = context[0];
        const poolA = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (topBet?.playerName && b.playerName &&
              b.playerName.toLowerCase().includes(topBet.playerName.split(" ")[0].toLowerCase())) return true;
          if (b.playerName && words.some((w) => b.playerName!.toLowerCase().includes(w))) return true;
          if (b.homeTeam && words.some((w) => b.homeTeam!.toLowerCase().includes(w))) return true;
          if (b.awayTeam && words.some((w) => b.awayTeam!.toLowerCase().includes(w))) return true;
          return false;
        }).sort(byConf).slice(0, 3);
        poolA.forEach((b) => seen.add(b.id));

        const poolB = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (b.betType !== (topBet?.betType ?? "player_prop")) return false;
          if (topBet?.sport && b.sport !== topBet.sport) return false;
          return (b.confidenceScore ?? 0) >= 75;
        }).sort(byConf).slice(0, 3);
        poolB.forEach((b) => seen.add(b.id));

        const poolC = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (sportFilter && b.sport !== sportFilter) return false;
          return b.betType === "player_prop" && (b.confidenceScore ?? 0) >= 85;
        }).sort(byConf).slice(0, 2);

        relatedBets = [...context, ...poolA, ...poolB, ...poolC]
          .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
          .sort(byConf).slice(0, 6)
          .map((b) => serializeBet(
            b,
            context.some((c) => c.id === b.id) ? "direct match"
              : poolA.some((p) => p.id === b.id) ? "same player/team"
              : poolB.some((p) => p.id === b.id) ? "same bet type" : "high confidence pick"
          ));

        const openaiKey = process.env.OPENAI_API_KEY;

        if (openaiKey) {
          const axiosLib = (await import("axios")).default;
          const systemPrompt = `You are Clubhouse IQ, an expert sports betting analyst with access to live odds from DraftKings, FanDuel, BetMGM, and William Hill. Answer the user's EXACT question using the provided live bet data. Be direct and specific. If they ask about a specific player/team/bet, analyze exactly that. If they ask for a list or recommendations, provide that specific number. Always cite confidence scores and key factors.`;
          const userPrompt = `Live database: ${totalBets} bets, ${propCount} player props, ${highConfCount} high-confidence (80+/100).

Relevant bets from live data:
${contextText || "No direct matches found."}

User question: "${question}"

Answer their question exactly as asked. Include specific bet titles, confidence scores, and why each is a good or bad pick.`;
          try {
            const aiRes = await axiosLib.post(
              "https://api.openai.com/v1/chat/completions",
              { model: "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 600, temperature: 0.3 },
              { headers: { Authorization: `Bearer ${openaiKey}` }, timeout: 20000 }
            );
            answer = aiRes.data.choices[0].message.content.trim();
          } catch (e: any) {
            answer = buildRuleBasedAnswer(context, question, totalBets, propCount, highConfCount, sportFilter);
          }
        } else {
          answer = buildRuleBasedAnswer(context, question, totalBets, propCount, highConfCount, sportFilter);
        }
      }

      res.json({ answer, relatedBets });
    } catch (e: any) {
      console.error("Ask error:", e.message);
      res.status(500).json({ error: "Analysis failed: " + e.message });
    }
  });

  // Rule-based answer builder (used when OpenAI key not set)
  function buildRuleBasedAnswer(
    context: any[], question: string, totalBets: number, propCount: number, highConfCount: number, sportFilter: string | null
  ): string {
    if (context.length === 0) {
      const sportMsg = sportFilter ? ` for ${sportFilter}` : "";
      return `No matching bets found${sportMsg}. Database has ${totalBets} total (${propCount} props, ${highConfCount} high-confidence). Try asking about a specific player or team.`;
    }

    const isTopPicks = context.length > 1;
    if (isTopPicks) {
      const lines = context.map((b, i) => {
        const conf = b.confidenceScore ?? 0;
        const verdict = conf >= 82 ? "✅" : conf >= 70 ? "⚠️" : "❌";
        const lineStr = b.line != null ? ` (${b.line})` : "";
        const factors = b.keyFactors?.slice(0, 2).join("; ") ?? "";
        return `${verdict} **${b.title}**${lineStr} — ${conf}/100\n   ${factors || b.researchSummary?.slice(0, 100) || ""}`;
      }).join("\n\n");
      const sportLabel = sportFilter ? `${sportFilter} ` : "";
      return `📊 Top ${sportLabel}picks right now:\n\n${lines}`;
    }

    const top = context[0];
    const conf = top.confidenceScore ?? 0;
    const verdict = conf >= 85 ? "✅ STRONG BET" : conf >= 65 ? "⚠️ MODERATE" : "❌ LOW CONFIDENCE";
    const lineStr = top.line != null ? ` | Line: ${top.line}` : "";
    const overStr = top.overOdds != null ? ` | Over ${top.overOdds > 0 ? "+" : ""}${top.overOdds} / Under ${top.underOdds ?? "?"}` : "";
    const factors = top.keyFactors?.slice(0, 3).join(", ") ?? "market consensus";
    const allocStr = top.recommendedAllocation ? ` Suggested: ${top.recommendedAllocation}% bankroll.` : "";
    const research = top.researchSummary ? ` ${top.researchSummary.slice(0, 180)}` : "";
    return `${verdict}\n\n**${top.title}** — Confidence ${conf}/100 | Risk: ${top.riskLevel ?? "medium"}${lineStr}${overStr}\n${allocStr}\nKey factors: ${factors}.${research}`;
  }

  app.get("/api/stats", async (req, res) => {
    try {
      const bets = await storage.getBets();
      const settings = await storage.getSettings();
      const threshold = settings.confidenceThreshold ?? 85;

      const total = bets.length;
      const highConf = bets.filter((b) => (b.confidenceScore ?? 0) >= threshold).length;
      const bySource = bets.reduce((acc, b) => {
        acc[b.source] = (acc[b.source] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const bySport = bets.reduce((acc, b) => {
        acc[b.sport] = (acc[b.sport] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const avgScore = bets.length
        ? Math.round(bets.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / bets.length)
        : 0;

      res.json({ total, highConf, bySource, bySport, avgScore, threshold });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tracked Props ──────────────────────────────────────────────────────────
  app.get("/api/tracked-props", async (req, res) => {
    try {
      res.json(await storage.getTrackedProps());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tracked-props", async (req, res) => {
    try {
      const { nanoid } = await import("nanoid");
      const prop = await storage.addTrackedProp({ ...req.body, id: nanoid() });
      res.json(prop);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/tracked-props/:id", async (req, res) => {
    try {
      const prop = await storage.updateTrackedProp(req.params.id, req.body);
      if (!prop) return res.status(404).json({ error: "Not found" });
      res.json(prop);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/tracked-props/:id", async (req, res) => {
    try {
      await storage.deleteTrackedProp(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Refresh Tracked Props: auto-fetch live stats from ESPN + BBR ──────────
  app.post("/api/refresh-tracked-props", async (req, res) => {
    const axiosLib = (await import("axios")).default;
    const cheerio = (await import("cheerio")).load;
    const props = await storage.getTrackedProps();
    const activeProps = props.filter(p => p.status === "active");

    if (activeProps.length === 0) {
      return res.json({ updated: 0, message: "No active props to refresh" });
    }

    // ESPN athlete lookup: search by name, return season stats
    async function espnAthleteStats(playerName: string, sport: string): Promise<{ stats: Record<string, number>; source: string; athleteId?: string } | null> {
      const sportMap: Record<string, { slug: string; statsUrl: (id: string) => string }> = {
        NBA: {
          slug: "basketball/nba",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/stats?season=2025&seasontype=2`,
        },
        NFL: {
          slug: "football/nfl",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/stats?season=2024&seasontype=2`,
        },
        MLB: {
          slug: "baseball/mlb",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${id}/stats?season=2025&seasontype=2`,
        },
        NHL: {
          slug: "hockey/nhl",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${id}/stats?season=2025&seasontype=2`,
        },
      };
      const sportCfg = sportMap[sport];
      if (!sportCfg) return null;

      try {
        // Step 1: Find athlete by name
        const searchUrl = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(playerName)}&limit=5&type=athlete&sport=${sportCfg.slug}`;
        const searchResp = await axiosLib.get(searchUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
        const hits = searchResp.data?.athletes ?? searchResp.data?.results ?? [];
        let athleteId: string | null = null;
        // Find best name match
        const nameLower = playerName.toLowerCase();
        for (const hit of hits) {
          const candidate = (hit?.name ?? hit?.displayName ?? "").toLowerCase();
          if (candidate.includes(nameLower.split(" ")[0]) || nameLower.includes(candidate.split(" ")[0])) {
            athleteId = hit?.id ?? hit?.uid?.replace(/^.*athlete:\/\//,"") ?? null;
            break;
          }
        }
        if (!athleteId && hits.length > 0) athleteId = hits[0]?.id ?? null;
        if (!athleteId) return null;

        // Step 2: Get season stats
        const statsResp = await axiosLib.get(sportCfg.statsUrl(athleteId), { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
        const statsData = statsResp.data;

        // ESPN stats come as parallel arrays: categories[].stats[].name + values[]
        const parsed: Record<string, number> = {};
        const cats = statsData?.stats?.splits?.categories ?? statsData?.splits?.categories ?? [];
        for (const cat of cats) {
          const names: string[] = cat.names ?? [];
          const values: any[] = cat.values ?? [];
          names.forEach((name, i) => {
            const v = parseFloat(values[i]);
            if (!isNaN(v)) parsed[name.toLowerCase()] = v;
          });
        }
        // Fallback: top-level stats object
        if (Object.keys(parsed).length === 0) {
          const flat = statsData?.athlete?.statistics ?? statsData?.statistics ?? {};
          for (const [k, v] of Object.entries(flat)) {
            const n = parseFloat(String(v));
            if (!isNaN(n)) parsed[k.toLowerCase()] = n;
          }
        }

        return Object.keys(parsed).length > 0 ? { stats: parsed, source: "ESPN", athleteId } : null;
      } catch (e: any) {
        console.warn(`[refresh] ESPN lookup failed for ${playerName} (${sport}):`, e.message);
        return null;
      }
    }

    // Baseball Reference season stats scrape (for MLB season_long props)
    async function bbrSeasonStats(playerName: string): Promise<{ stats: Record<string, number>; source: string } | null> {
      try {
        const query = playerName.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, "+");
        const searchUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${query}&pid=&type=&redirect=1`;
        const { data: html } = await axiosLib.get(searchUrl, {
          timeout: 12000,
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          maxRedirects: 5,
        });
        const $ = cheerio(html);
        // Parse the standard stats table (batting or pitching)
        const stats: Record<string, number> = {};
        // Try to get 2025 season row from #batting_standard or #pitching_standard
        const tables = ["#batting_standard", "#pitching_standard", "#standard_fielding"];
        for (const tableId of tables) {
          const rows = $(tableId).find("tbody tr").toArray();
          // Find 2025 season row
          for (const row of rows) {
            const yr = $(row).find("[data-stat='year_id']").text().trim();
            if (yr === "2025") {
              const fields = [
                "G","PA","AB","R","H","2B","3B","HR","RBI","SB","BB","SO","BA","OBP","SLG",
                "W","L","ERA","GS","CG","SHO","SV","IP","H_allowed","ER","BB_allowed","SO_pitcher"
              ];
              for (const f of fields) {
                const v = parseFloat($(row).find(`[data-stat='${f.toLowerCase()}']`).text().trim());
                if (!isNaN(v)) stats[f.toLowerCase()] = v;
              }
              // Fallback: try attribute names
              $(row).find("[data-stat]").each((_, el) => {
                const attr = $(el).attr("data-stat") ?? "";
                const v = parseFloat($(el).text().trim());
                if (attr && !isNaN(v)) stats[attr.toLowerCase()] = v;
              });
              if (Object.keys(stats).length > 0) break;
            }
          }
          if (Object.keys(stats).length > 0) break;
        }
        return Object.keys(stats).length > 0 ? { stats, source: "Baseball Reference" } : null;
      } catch (e: any) {
        console.warn(`[refresh] BBR failed for ${playerName}:`, e.message);
        return null;
      }
    }

    // Map TrackedProp statCategory → ESPN stat key(s) to try
    const mapStatCategory = (statCategory: string, sport: string): string[]  =>{
      const cat = statCategory.toLowerCase();
      if (sport === "NBA") {
        if (cat.includes("point")) return ["pts", "points", "avgpoints"];
        if (cat.includes("assist")) return ["ast", "assists", "avgassists"];
        if (cat.includes("rebound")) return ["reb", "rebounds", "totalrebounds", "avgtotalrebounds"];
        if (cat.includes("3-point") || cat.includes("3pt") || cat.includes("three")) return ["3pm", "threepointersmade", "3ptm"];
        if (cat.includes("steal")) return ["stl", "steals", "avgsteals"];
        if (cat.includes("block")) return ["blk", "blocks", "avgblocks"];
        if (cat.includes("minute")) return ["min", "minutes", "avgminutes"];
        if (cat.includes("pra") || cat.includes("+")) return ["pts", "points"]; // sum multiple
      }
      if (sport === "NFL") {
        if (cat.includes("passing yard")) return ["passingyards", "yds", "yards"];
        if (cat.includes("passing td")) return ["passingtouchdowns", "td", "touchdowns"];
        if (cat.includes("rushing yard")) return ["rushingyards", "yds"];
        if (cat.includes("receiving yard")) return ["receivingyards", "yds"];
        if (cat.includes("reception")) return ["receptions", "rec"];
        if (cat.includes("interception")) return ["interceptions", "int"];
        if (cat.includes("tackle")) return ["totaltackles", "tackles", "tot"];
        if (cat.includes("sack")) return ["sacks"];
      }
      if (sport === "MLB") {
        if (cat.includes("home run")) return ["hr"];
        if (cat.includes("rbi")) return ["rbi"];
        if (cat.includes("hit") && !cat.includes("pitcher")) return ["h"];
        if (cat.includes("strikeout") || cat.includes("k")) return ["so", "so_pitcher", "k"];
        if (cat.includes("era")) return ["era"];
        if (cat.includes("stolen base")) return ["sb"];
        if (cat.includes("batting avg")) return ["ba", "avg"];
      }
      if (sport === "NHL") {
        if (cat.includes("goal")) return ["goals", "g"];
        if (cat.includes("assist")) return ["assists", "a"];
        if (cat.includes("point")) return ["points", "pts"];
        if (cat.includes("shot")) return ["shots", "sog", "s"];
        if (cat.includes("save")) return ["savepct", "svpct", "sv%"];
        if (cat.includes("+/-") || cat.includes("plus")) return ["plusminus", "+/-"];
      }
      return [];
    }

    const extractStatValue = (statsRecord: Record<string, number>, keys: string[]): number | null  =>{
      for (const k of keys) {
        if (statsRecord[k] !== undefined) return statsRecord[k];
      }
      // partial match
      for (const k of keys) {
        const found = Object.keys(statsRecord).find(sk => sk.includes(k) || k.includes(sk));
        if (found) return statsRecord[found];
      }
      return null;
    }

    // Process each active prop
    const results: Array<{ id: string; playerName: string; sport: string; statCategory: string; oldValue: number | null; newValue: number | null; gamesPlayed: number | null; source: string; status: string }> = [];
    let updatedCount = 0;

    for (const prop of activeProps) {
      let fetchedStats: { stats: Record<string, number>; source: string } | null = null;

      // Try ESPN first (all sports)
      const espnResult = await espnAthleteStats(prop.playerName, prop.sport);
      if (espnResult) fetchedStats = espnResult;

      // For MLB, also try Baseball Reference as backup
      if (!fetchedStats && prop.sport === "MLB") {
        fetchedStats = await bbrSeasonStats(prop.playerName);
      }

      if (!fetchedStats) {
        results.push({ id: prop.id, playerName: prop.playerName, sport: prop.sport, statCategory: prop.statCategory, oldValue: prop.currentValue ?? null, newValue: null, gamesPlayed: prop.gamesPlayed ?? null, source: "not found", status: "no_data" });
        continue;
      }

      const statKeys = mapStatCategory(prop.statCategory, prop.sport);
      let newValue = extractStatValue(fetchedStats.stats, statKeys);

      // Special case: PRA (Points+Rebounds+Assists) — sum the three
      if (!newValue && prop.statCategory.toLowerCase().includes("+")) {
        const pts = extractStatValue(fetchedStats.stats, ["pts","points"]) ?? 0;
        const reb = extractStatValue(fetchedStats.stats, ["reb","rebounds","totalrebounds"]) ?? 0;
        const ast = extractStatValue(fetchedStats.stats, ["ast","assists"]) ?? 0;
        if (pts || reb || ast) newValue = pts + reb + ast;
      }

      // Extract games played
      const gamesPlayed = extractStatValue(fetchedStats.stats, ["gp","games","g","gamesplayed"]);

      // Determine new status: if season_long, check if target already hit/missed
      let newStatus: string = prop.status ?? "active";
      if (newValue !== null && prop.propType === "season_long" && prop.status === "active") {
        if (prop.direction === "over" && newValue >= prop.targetLine) newStatus = "hit";
        // (don't auto-mark as missed for season_long — season may not be over)
      }

      const updatePayload: any = { updatedAt: new Date() };
      if (newValue !== null) updatePayload.currentValue = newValue;
      if (gamesPlayed !== null) updatePayload.gamesPlayed = Math.round(gamesPlayed);
      if (newStatus !== prop.status) updatePayload.status = newStatus;
      // Store source in notes if not already there
      if (fetchedStats.source && !(prop.notes ?? "").includes(fetchedStats.source)) {
        updatePayload.notes = prop.notes ? `${prop.notes} | 📡 ${fetchedStats.source}` : `📡 Auto-updated from ${fetchedStats.source}`;
      }

      await storage.updateTrackedProp(prop.id, updatePayload);
      updatedCount++;

      results.push({
        id: prop.id,
        playerName: prop.playerName,
        sport: prop.sport,
        statCategory: prop.statCategory,
        oldValue: prop.currentValue ?? null,
        newValue: newValue ?? null,
        gamesPlayed: gamesPlayed ? Math.round(gamesPlayed) : (prop.gamesPlayed ?? null),
        source: fetchedStats.source,
        status: newStatus,
      });
    }

    console.log(`[refresh-tracked-props] Updated ${updatedCount}/${activeProps.length} props`);
    res.json({
      updated: updatedCount,
      total: activeProps.length,
      results,
      refreshedAt: new Date().toISOString(),
    });
  });

  // ─── Debug endpoint: test each data source independently ─────────────────
  app.get("/api/debug-scan", async (req, res) => {
    const results: Record<string, any> = {};
    const axios = (await import("axios")).default;

    // 1. Underdog
    try {
      const { data } = await axios.get(
        "https://api.underdogfantasy.com/beta/v5/over_under_lines",
        {
          headers: {
            "User-Agent": "UnderdogFantasy/2.0 (com.underdogfantasy.app; build:500; iOS 17.0; iPhone14,3)",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "X-Platform": "ios",
            "X-App-Version": "2.0.0",
          },
          timeout: 20000,
          decompress: true,
        }
      );
      const lines = data?.over_under_lines ?? [];
      const active = lines.filter((l: any) => l.status === "active");
      results.underdog = { ok: true, total: lines.length, active: active.length };
    } catch (e: any) {
      results.underdog = { ok: false, error: e.message, code: e.response?.status };
    }

    // 2. SportsGameOdds
    const sgoKey = process.env.SGO_API_KEY;
    if (!sgoKey) {
      results.sgo = { ok: false, error: "SGO_API_KEY not set" };
    } else {
      try {
        const { data } = await axios.get(
          `https://api.sportsgameodds.com/v2/events?leagueID=NBA&oddID=points-PLAYER_ID-game-ou-over&ended=false&cancelled=false&includeOpposingOdds=true&apiKey=${sgoKey}`,
          { timeout: 15000 }
        );
        results.sgo = { ok: data.success, count: data.data?.length ?? 0, raw: data.success ? undefined : data };
      } catch (e: any) {
        results.sgo = { ok: false, error: e.message, code: e.response?.status };
      }
    }

    // 3. Odds API
    const oddsKey = process.env.ODDS_API_KEY;
    if (!oddsKey) {
      results.oddsApi = { ok: false, error: "ODDS_API_KEY not set" };
    } else {
      try {
        const { data } = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${oddsKey}&regions=us&markets=h2h&bookmakers=draftkings&oddsFormat=american`,
          { timeout: 15000 }
        );
        results.oddsApi = { ok: true, games: data.length };
      } catch (e: any) {
        results.oddsApi = { ok: false, error: e.message, code: e.response?.status };
      }
    }

    // 4. ActionNetwork
    try {
      const { data } = await axios.get(
        "https://api.actionnetwork.com/web/v1/scoreboard/nba?period=game&bookIds=15,30,76,123&date=" +
        new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        { timeout: 10000 }
      );
      results.actionNetwork = { ok: true, games: data?.games?.length ?? 0 };
    } catch (e: any) {
      results.actionNetwork = { ok: false, error: e.message };
    }

    // 5. Env vars present
    results.envVars = {
      ODDS_API_KEY: !!process.env.ODDS_API_KEY,
      SGO_API_KEY: !!process.env.SGO_API_KEY,
      ACTION_NETWORK_KEY: !!process.env.ACTION_NETWORK_KEY,
      API_SPORTS_KEY: !!process.env.API_SPORTS_KEY,
    };

    // 6. Current bets in DB
    const bets = await storage.getBets();
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const b of bets) {
      byType[b.betType ?? "unknown"] = (byType[b.betType ?? "unknown"] ?? 0) + 1;
      bySource[b.source ?? "unknown"] = (bySource[b.source ?? "unknown"] ?? 0) + 1;
    }
    results.currentBets = { total: bets.length, byType, bySource };

    res.json(results);
  });

  // Initial scan on startup with retry — ensures props load even if first attempt fails
  const startupScan = async (attempt = 1) => {
    try {
      console.log(`[startup] scan attempt ${attempt}...`);
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      const bets = await storage.getBets();
      const propCount = bets.filter((b: any) => b.betType === 'player_prop').length;
      console.log(`[startup] scan done: ${result.scanned} bets, ${propCount} props`);
      // Retry if we got no props (Railway cold-start network issue)
      if (propCount === 0 && attempt < 5) {
        const delay = attempt * 15000; // 15s, 30s, 45s, 60s
        console.log(`[startup] 0 props loaded, retrying in ${delay/1000}s...`);
        setTimeout(() => startupScan(attempt + 1), delay);
      }
    } catch (e: any) {
      console.warn(`[startup] scan attempt ${attempt} failed:`, e.message);
      if (attempt < 5) {
        const delay = attempt * 15000;
        console.log(`[startup] retrying in ${delay/1000}s...`);
        setTimeout(() => startupScan(attempt + 1), delay);
      }
    }
  };
  // Wait for ML pull to complete before first scan (or max 10s)
  const waitForMLPull = (elapsed = 0) => {
    if (mlPullDone || elapsed >= 30000) { // raised 10s→30s: give pull time to finish
      startupScan();
    } else {
      setTimeout(() => waitForMLPull(elapsed + 500), 500);
    }
  };
  setTimeout(() => waitForMLPull(), 3000); // 3s base delay for Railway to fully initialize

  // ── 30-second live price poller — Kalshi + Polymarket only, no ESPN ────────
  livePollInterval = setInterval(async () => {
    try {
      const updates = await fetchLivePrices();
      lastLivePoll = { ts: Date.now(), changed: updates.length };
      if (updates.length > 0) {
        broadcast("price:tick", { updates, ts: lastLivePoll.ts });

        // Broadcast mispriced markets separately with entry/exit targets
        const mispriced = updates.filter((u: any) => u.mispricing?.isMispriced);
        if (mispriced.length > 0) {
          broadcast("price:mispriced", {
            ts: lastLivePoll.ts,
            markets: mispriced.map((u: any) => ({
              id: u.id,
              priceMovement: u.priceMovement,
              newImpliedProb: u.newImpliedProb,
              fairValue:       u.mispricing.fairValue,
              mispricingEdge:  u.mispricing.mispricingEdge,
              direction:       u.mispricing.mispricingDirection,
              entryPrice:      u.mispricing.entryPrice,
              exitTarget:      u.mispricing.exitTarget,
              entryCents:      u.mispricing.entryCents,
              exitTargetCents: u.mispricing.exitTargetCents,
              edgePct:         u.mispricing.edgePct,
            })),
          });
          console.log(`[live-poll] ${mispriced.length} mispriced market(s) signaled`);
        }

        // Also fire high-conf alert if any updated bet crossed 85
        const changed = await Promise.all(
          updates.map(u => storage.getBetById(u.id))
        );
        const newHighConf = changed
          .filter(Boolean)
          .filter((b: any) => (b.confidenceScore ?? 0) >= 85 && !b.notificationSent);
        if (newHighConf.length > 0) {
          broadcast("bets:highconf", {
            count: newHighConf.length,
            top: newHighConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })),
          });
        }
        console.log(`[live-poll] ${updates.length} price update(s) broadcast`);

        // Re-run sharp money scoring on updated bets only
        const updatedBets = await Promise.all(updates.map(u => storage.getBetById(u.id)));
        for (const b of updatedBets.filter(Boolean)) {
          const sm = computeSharpMoneyScore({
            confidenceScore: (b as any).confidenceScore,
            sharpnessScore:  (b as any).sharpnessScore ?? null,
            priceMovement:   (b as any).priceMovement ?? null,
            allSources:      (b as any).allSources,
            source:          (b as any).source,
          });
          await storage.patchBetSharpMoney((b as any).id, { isSharpMoney: sm.isSharpMoney, sharpMoneyScore: sm.score });
        }
      }

      // Re-tag urgency every 30s (game times tick closer)
      await tagUrgency().catch(() => {});

    } catch (e: any) {
      console.warn("[live-poll] interval error:", e.message);
    }
  }, 30 * 1000);

  // Auto-scan every 30 min — broadcast result to all WS clients
  scanInterval = setInterval(async () => {
    try {
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      const allBets = await storage.getBets();
      broadcast("bets:updated", { scanned: result.scanned, total: allBets.length, auto: true });
      // Log picks for ML self-learning
      try { logPicks(allBets); } catch(e: any) { console.warn("[PickLogger] error:", e.message); }
      // Sync snapshots to GitHub so they survive redeploys (fire-and-forget)
      syncSnapshotsToGitHub().catch((e: any) => console.warn("[MLSync] snapshot sync error:", e.message));
      const highConf = allBets.filter((b: any) => (b.confidenceScore ?? 0) >= 85);
      if (highConf.length > 0) {
        broadcast("bets:highconf", { count: highConf.length, top: highConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })) });
      }
    } catch (e: any) {
      console.warn("[auto-scan] error:", e.message);
    }
  }, 30 * 60 * 1000);

  // ── CLV Line Value Tracker ───────────────────────────────────────────────

  // Compute sharpness score from lineMovePct and speed (0-100)
  function computeSharpness(openingLine: number | null, currentLine: number | null, openingOdds: number | null, currentOdds: number | null, createdAt: Date | null): number {
    if (openingLine == null || currentLine == null || openingLine === 0) return 0;
    const movePct = Math.abs((currentLine - openingLine) / Math.abs(openingLine)) * 100;
    // Speed factor: hours since creation (faster = sharper)
    const hoursElapsed = createdAt ? (Date.now() - createdAt.getTime()) / 3600000 : 24;
    const speedFactor = Math.max(0, 1 - hoursElapsed / 48); // decays over 48h
    // Odds movement factor
    let oddsFactor = 0;
    if (openingOdds != null && currentOdds != null) {
      const oddsMove = Math.abs(currentOdds - openingOdds);
      oddsFactor = Math.min(oddsMove / 30, 1); // 30 cent move = full factor
    }
    const raw = movePct * 4 + speedFactor * 20 + oddsFactor * 30;
    return Math.min(100, Math.round(raw));
  }

  // Fire alert if threshold crossed
  async function maybeFireClvAlert(line: any, prevLine: number | null, prevOdds: number | null): Promise<void> {
    if (line.openingLine == null || line.currentLine == null) return;
    if (line.openingLine === 0) return;
    const movePct = ((line.currentLine - line.openingLine) / Math.abs(line.openingLine)) * 100;
    const absPct = Math.abs(movePct);
    const threshold = line.alertThreshold ?? 10;
    if (absPct < threshold) return;
    // Direction check
    const direction = line.alertDirection ?? "both";
    if (direction === "favor" && movePct <= 0) return;
    if (direction === "against" && movePct >= 0) return;
    // Check we haven't already fired for this move
    const existing = await storage.getClvAlertsByLine(line.id);
    const alreadyFired = existing.some((a: any) => Math.abs(a.movePct ?? 0) >= absPct - 0.5);
    if (alreadyFired) return;
    const alertType = absPct >= threshold * 2 ? "sharp_move" : (movePct > 0 ? "move_favor" : "move_against");
    const dirLabel = movePct > 0 ? "in your favor" : "against you";
    await storage.addClvAlert({
      id: crypto.randomUUID(),
      clvLineId: line.id,
      alertType,
      message: `${line.outcomeLabel} moved ${movePct > 0 ? "+" : ""}${movePct.toFixed(1)}% ${dirLabel} (threshold: ${threshold}%)`,
      movePct,
      fromLine: line.openingLine,
      toLine: line.currentLine,
      fromOdds: line.openingOdds ?? null,
      toOdds: line.currentOdds ?? null,
      dismissed: false,
    });
  }

  app.get("/api/clv", async (req, res) => {
    try {
      const lines = await storage.getClvLines();
      res.json(lines);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/clv", async (req, res) => {
    try {
      const body = req.body;
      const line = await storage.addClvLine({
        id: crypto.randomUUID(),
        ...body,
      });
      // Auto-add opening snapshot
      if (line.openingLine != null || line.openingOdds != null) {
        await storage.addClvSnapshot({
          id: crypto.randomUUID(),
          clvLineId: line.id,
          book: line.book,
          line: line.openingLine,
          odds: line.openingOdds,
        });
      }
      res.status(201).json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv/:id", async (req, res) => {
    try {
      const line = await storage.getClvLineById(req.params.id);
      if (!line) return res.status(404).json({ error: "Not found" });
      res.json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/clv/:id", async (req, res) => {
    try {
      const existing = await storage.getClvLineById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const update = req.body;
      // Compute derived fields on update
      const newCurrentLine = update.currentLine ?? existing.currentLine;
      const newCurrentOdds = update.currentOdds ?? existing.currentOdds;
      const openingLine = existing.openingLine;
      let lineMovePct: number | null = null;
      if (openingLine != null && openingLine !== 0 && newCurrentLine != null) {
        lineMovePct = ((newCurrentLine - openingLine) / Math.abs(openingLine)) * 100;
      }
      const sharpnessScore = computeSharpness(openingLine, newCurrentLine, existing.openingOdds, newCurrentOdds, existing.createdAt);
      // If closing line provided, compute CLV
      let clvBeat: boolean | null = existing.clvBeat;
      let clvDelta: number | null = existing.clvDelta;
      const closingLine = update.closingLine ?? existing.closingLine;
      if (closingLine != null && openingLine != null) {
        clvDelta = closingLine - openingLine;
        clvBeat = clvDelta > 0;
      }
      const updated = await storage.updateClvLine(req.params.id, {
        ...update,
        lineMovePct,
        sharpnessScore,
        clvBeat,
        clvDelta,
      });
      // Add snapshot for current line
      if (update.currentLine != null || update.currentOdds != null) {
        await storage.addClvSnapshot({
          id: crypto.randomUUID(),
          clvLineId: req.params.id,
          book: existing.book,
          line: newCurrentLine,
          odds: newCurrentOdds,
        });
      }
      // Maybe fire alert
      if (updated) await maybeFireClvAlert(updated, existing.currentLine, existing.currentOdds);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/clv/:id", async (req, res) => {
    try {
      await storage.deleteClvLine(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv/:id/snapshots", async (req, res) => {
    try {
      const snaps = await storage.getClvSnapshots(req.params.id);
      res.json(snaps);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv-alerts", async (req, res) => {
    try {
      const alerts = await storage.getClvAlerts();
      res.json(alerts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/clv-alerts/:id/dismiss", async (req, res) => {
    try {
      await storage.dismissClvAlert(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Sharp Money endpoints ───────────────────────────────────────────────────
  // GET /api/sharp-money — all sports, top sharp plays today
  app.get("/api/sharp-money", async (_req, res) => {
    try {
      const data = await fetchSharpMoneyAllSports();
      res.json({ games: data, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/sharp-money/:sport — single sport (NBA/MLB/NHL/NFL)
  app.get("/api/sharp-money/:sport", async (req, res) => {
    try {
      const sport = (req.params.sport || "").toUpperCase();
      const data  = await fetchSharpMoneyBySport(sport);
      res.json({ sport, games: data, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/sharp-money/game/:sport/:home/:away — specific game
  app.get("/api/sharp-money/game/:sport/:home/:away", async (req, res) => {
    try {
      const sport = (req.params.sport || "").toUpperCase();
      const home  = decodeURIComponent(req.params.home || "");
      const away  = decodeURIComponent(req.params.away || "");
      const data  = await fetchSharpMoneyForGame(sport, home, away);
      if (!data) return res.status(404).json({ error: "Game not found" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Line Movement: auto-pull opening vs current lines from ActionNetwork ───────────
  const LINE_MOVEMENT_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_TTL = 3 * 60 * 1000; // 3-min cache

  // ── SBR MLB Consensus cache (free public % data) ──────────────────────────
  // SBR's consensus page embeds pick % in __NEXT_DATA__ gameView.consensus
  // Fields: awayMoneyLinePickPercent, homeMoneyLinePickPercent,
  //         overPickPercent, underPickPercent
  // Note: spreadPickPercent is always 0 for MLB (not tracked by SBR)
  interface SbrMlbEntry {
    awayTeam: string;       // full name, lowercased
    homeTeam: string;
    mlAwayPct: number | null;
    mlHomePct: number | null;
    overPct: number | null;
    underPct: number | null;
  }
  let SBR_MLB_CACHE: SbrMlbEntry[] = [];
  let SBR_MLB_CACHE_TS = 0;
  const SBR_MLB_TTL = 2 * 60 * 60 * 1000; // 2-hour refresh

  async function fetchSbrMlbConsensus(): Promise<SbrMlbEntry[]> {
    try {
      const { data: html } = await axios.get(
        "https://www.sportsbookreview.com/betting-odds/mlb-baseball/consensus/",
        {
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
          },
          responseType: "text",
          decompress: true,
        }
      );
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
      if (!match) { console.warn("[SBR] __NEXT_DATA__ not found"); return SBR_MLB_CACHE; }
      const nd = JSON.parse(match[1]);
      const gameRows: any[] = nd?.props?.pageProps?.oddsTableModel?.gameRows ?? [];
      const entries: SbrMlbEntry[] = [];
      for (const row of gameRows) {
        const gv = row?.gameView ?? {};
        const c  = gv?.consensus ?? {};
        const awayTeam = (gv?.awayTeam?.fullName ?? "").toLowerCase();
        const homeTeam = (gv?.homeTeam?.fullName ?? "").toLowerCase();
        if (!awayTeam || !homeTeam) continue;
        entries.push({
          awayTeam,
          homeTeam,
          mlAwayPct: c.awayMoneyLinePickPercent ?? null,
          mlHomePct: c.homeMoneyLinePickPercent ?? null,
          overPct:   c.overPickPercent   ?? null,
          underPct:  c.underPickPercent  ?? null,
        });
      }
      console.log(`[SBR] Fetched MLB consensus for ${entries.length} games`);
      SBR_MLB_CACHE = entries;
      SBR_MLB_CACHE_TS = Date.now();
      return entries;
    } catch (e: any) {
      console.warn("[SBR] fetchSbrMlbConsensus error:", e.message);
      return SBR_MLB_CACHE; // return stale data on error
    }
  }

  // Initial fetch at startup + refresh every 2 hours
  fetchSbrMlbConsensus().catch(() => {});
  setInterval(() => fetchSbrMlbConsensus().catch(() => {}), SBR_MLB_TTL);

  // Helper: match a team name against SBR entries by last word of team name
  function matchSbrEntry(awayTeam: string, homeTeam: string): SbrMlbEntry | null {
    const awLast = awayTeam.toLowerCase().split(" ").pop() ?? "";
    const hwLast = homeTeam.toLowerCase().split(" ").pop() ?? "";
    if (awLast.length < 3 || hwLast.length < 3) return null;
    for (const e of SBR_MLB_CACHE) {
      const eAwLast = e.awayTeam.split(" ").pop() ?? "";
      const eHwLast = e.homeTeam.split(" ").pop() ?? "";
      if (eAwLast === awLast && eHwLast === hwLast) return e;
      // Also try full name contains
      if (e.awayTeam.includes(awLast) && e.homeTeam.includes(hwLast)) return e;
    }
    return null;
  }

  // ── Proactive game-time lookup: populated at startup + every 15 min ──────
  // Maps "awayTeamLower::homeTeamLower" → ISO gameTime string, for all 4 sports today.
  // Used by /api/bets to fill null gameTime on Kalshi player props.
  const GAME_TIME_LOOKUP = new Map<string, string>(); // "away::home" → ISO string
  const TEAM_WORD_LOOKUP = new Map<string, string>(); // teamWord → ISO string
  let gameTimeLookupLastFetch = 0;
  const GAME_TIME_TTL = 15 * 60 * 1000;

  async function refreshGameTimeLookup() {
    if (Date.now() - gameTimeLookupLastFetch < GAME_TIME_TTL) return;
    try {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const sports = ["nba", "mlb", "nhl", "nfl"];
      const ACTION_BOOK_IDS = "15,68,30";
      await Promise.allSettled(sports.map(async (slug) => {
        try {
          const url = `https://api.actionnetwork.com/web/v1/scoreboard/publicbetting/${slug}?period=game&bookIds=${ACTION_BOOK_IDS}&date=${today}`;
          const { data } = await axios.get(url, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.actionnetwork.com/", "Authorization": `Bearer ${process.env.ACTION_NETWORK_KEY ?? "95d975972c05aa2f9ea5c3688ffc327c8afdbfe3dbd59f3545715d8e3bf7bee2"}` },
          });
          const games: any[] = data?.games ?? data?.scoreboard ?? [];
          for (const game of games) {
            const st = game.start_time ?? null;
            if (!st) continue;
            const teams: any[] = game.teams ?? [];
            const awayTeam = (teams.find((t: any) => t.id === game.away_team_id)?.full_name ?? "").toLowerCase();
            const homeTeam = (teams.find((t: any) => t.id === game.home_team_id)?.full_name ?? "").toLowerCase();
            if (awayTeam && homeTeam) {
              GAME_TIME_LOOKUP.set(`${awayTeam}::${homeTeam}`, st);
              // Also index individual words (>3 chars) from each team name
              for (const w of [...awayTeam.split(" "), ...homeTeam.split(" ")]) {
                const wl = w.trim();
                if (wl.length > 3) TEAM_WORD_LOOKUP.set(wl, st);
              }
            }
          }
        } catch { /* ignore per-sport errors */ }
      }));
      gameTimeLookupLastFetch = Date.now();
    } catch { /* ignore */ }
  }

  // Kick off initial fetch immediately (don't await — non-blocking)
  refreshGameTimeLookup().catch(() => {});

  app.get("/api/line-movement", async (req, res) => {
    try {
      const cacheKey = "lm";
      const cached = LINE_MOVEMENT_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LM_TTL) {
        return res.json(cached.data);
      }

      const nowUtc = new Date();
      // Check yesterday + today + tomorrow UTC to catch all timezone windows
      const yesterdayUtc = new Date(nowUtc.getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      const todayUtc     = nowUtc.toISOString().slice(0, 10).replace(/-/g, "");
      const tomorrowUtc  = new Date(nowUtc.getTime() + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      const datesToCheck = [yesterdayUtc, todayUtc, tomorrowUtc];

      const sports = [
        { slug: "nba", label: "NBA" },
        { slug: "mlb", label: "MLB" },
        { slug: "nhl", label: "NHL" },
        { slug: "nfl", label: "NFL" },
      ];

      const results: any[] = [];

      await Promise.allSettled(sports.map(async ({ slug, label }) => {
        try {
          const anHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://www.actionnetwork.com/",
          };

          // ── Step 1: Collect games from ActionNetwork /scoreboard (no auth needed, has public %) ──
          const seenIds = new Set<string>();
          const allGames: any[] = [];
          for (const date of datesToCheck) {
            const url = `https://api.actionnetwork.com/web/v1/scoreboard/${slug}?date=${date}`;
            const { data } = await axios.get(url, { timeout: 10000, headers: anHeaders }).catch(() => ({ data: {} }));
            for (const g of (data?.games ?? [])) {
              if (!seenIds.has(String(g.id))) { seenIds.add(String(g.id)); allGames.push(g); }
            }
          }

          // Only games within next 48h (or already in-progress)
          const cutoff = new Date(nowUtc.getTime() + 48 * 3600 * 1000);
          const games = allGames.filter((g: any) => {
            const st = g.start_time ? new Date(g.start_time) : null;
            if (!st) return true;
            // Include in-progress + scheduled within 48h; exclude completed
            const status = (g.status ?? "").toLowerCase();
            if (status === "complete" || status === "closed" || status === "final") return false;
            return st <= cutoff;
          });

          // ── Step 2: For each game, build the LM entry ──
          for (const game of games) {
            const teams: any[] = game.teams ?? [];
            const awayTeamObj = teams.find((t: any) => t.id === game.away_team_id) ?? teams[0] ?? {};
            const homeTeamObj = teams.find((t: any) => t.id === game.home_team_id) ?? teams[1] ?? {};
            const awayTeam = awayTeamObj.full_name ?? awayTeamObj.display_name ?? "Away";
            const homeTeam = homeTeamObj.full_name ?? homeTeamObj.display_name ?? "Home";
            const gameTime = game.start_time ?? null;

            // Sort odds by inserted time
            const oddsArr: any[] = (game.odds ?? []).sort((a: any, b: any) =>
              (a.inserted ?? "").localeCompare(b.inserted ?? "")
            );
            if (oddsArr.length < 1) continue;

            // ── Filter out alt lines / F5 lines ──────────────────────────────
            // MLB run line is always ±1.5; totals < 6 are F5/alt lines.
            // NBA/NHL spreads are rarely > 20; NFL rarely > 30.
            // Any entry with a suspiciously small total (< 6 for MLB, < 150 for NBA/NHL
            // ML context) or a non-standard spread is an alt/F5 — exclude it from
            // opening/current line calculations to prevent false steam signals.
            // Minimum realistic full-game totals by sport
            const MIN_TOTAL: Record<string, number> = { MLB: 6, NBA: 180, NHL: 4.5, NFL: 30 };
            const MAX_TOTAL: Record<string, number> = { MLB: 16, NBA: 260, NHL: 9,   NFL: 65 };

            const isAltLine = (o: any): boolean => {
              const minT = MIN_TOTAL[label];
              const maxT = MAX_TOTAL[label];
              // Filter out F5, alt, or live-score entries that have unrealistic totals
              if (o.total != null && minT != null && (o.total < minT || o.total > maxT)) return true;
              if (label === "MLB") {
                // Run line is always ±1.5 — any other spread value is an alt line
                if (o.spread_away != null && Math.abs(Math.abs(o.spread_away) - 1.5) > 0.1) return true;
              }
              return false;
            };
            const fullGameOdds = oddsArr.filter((o: any) => !isAltLine(o));
            const oddsForLines = fullGameOdds.length > 0 ? fullGameOdds : oddsArr;

            const opening = oddsForLines[0];
            // Current = latest entry that has at least some data
            const withLines  = oddsForLines.filter((o: any) => o.spread_away != null || o.total != null || o.ml_away != null);
            const withPublic = oddsArr.filter((o: any) => o.spread_away_public != null || o.ml_away_public != null || o.total_over_public != null);
            const current = oddsForLines[oddsForLines.length - 1];
            const bestLines  = withLines.length  > 0 ? withLines[withLines.length - 1]   : current;
            const bestPublic = withPublic.length > 0 ? withPublic[withPublic.length - 1] : current;

            // Spread
            let spreadOpen    = opening.spread_away ?? null;
            let spreadCurrent = bestLines.spread_away ?? null;
            let spreadMove    = (spreadOpen != null && spreadCurrent != null) ? +(spreadCurrent - spreadOpen).toFixed(1) : null;

            // Total
            let totalOpen    = opening.total ?? null;
            let totalCurrent = bestLines.total ?? null;
            let totalMove    = (totalOpen != null && totalCurrent != null) ? +(totalCurrent - totalOpen).toFixed(1) : null;

            // ML
            let mlAwayOpen    = opening.ml_away  ?? null;
            let mlHomeOpen    = opening.ml_home  ?? null;
            let mlAwayCurrent = bestLines.ml_away ?? null;
            let mlHomeCurrent = bestLines.ml_home ?? null;

            // Public / sharp %
            let spreadAwayPublic = bestPublic.spread_away_public ?? null;
            let spreadAwayMoney  = bestPublic.spread_away_money  ?? null;
            let spreadHomePublic = bestPublic.spread_home_public ?? null;
            let spreadHomeMoney  = bestPublic.spread_home_money  ?? null;
            let totalOverPublic  = bestPublic.total_over_public  ?? null;
            let totalOverMoney   = bestPublic.total_over_money   ?? null;
            let totalUnderPublic = bestPublic.total_under_public ?? null;
            let totalUnderMoney  = bestPublic.total_under_money  ?? null;
            let mlAwayPublic     = bestPublic.ml_away_public     ?? null;
            let mlAwayMoney      = bestPublic.ml_away_money      ?? null;
            let mlHomePublic     = bestPublic.ml_home_public     ?? null;
            let mlHomeMoney      = bestPublic.ml_home_money      ?? null;
            const numBets        = bestPublic.num_bets ?? current.num_bets ?? game.num_bets ?? null;

            // ── Step 3: If lines are missing, supplement with ESPN odds ──
            const hasLines = spreadCurrent != null || totalCurrent != null || mlAwayCurrent != null;
            if (!hasLines) {
              try {
                const espnSportMap: Record<string,{sn:string;lg:string}> = {
                  nba: { sn:"basketball", lg:"nba" },
                  mlb: { sn:"baseball",   lg:"mlb" },
                  nhl: { sn:"hockey",     lg:"nhl" },
                  nfl: { sn:"football",   lg:"nfl" },
                };
                const esp = espnSportMap[slug];
                if (!esp) continue;

                // Find matching ESPN event by team name
                for (const date of datesToCheck) {
                  const evUrl = `https://sports.core.api.espn.com/v2/sports/${esp.sn}/leagues/${esp.lg}/events?limit=30&dates=${date}`;
                  const { data: evListData } = await axios.get(evUrl, { timeout: 8000 }).catch(() => ({ data: {} }));
                  const evItems: any[] = evListData?.items ?? [];

                  let matched = false;
                  for (const evItem of evItems) {
                    const { data: evData } = await axios.get(evItem.$ref, { timeout: 6000 }).catch(() => ({ data: {} }));
                    const evName: string = evData.name ?? "";
                    const atIdx = evName.lastIndexOf(" at ");
                    if (atIdx < 0) continue;
                    const espAway = evName.slice(0, atIdx).trim().toLowerCase();
                    const espHome = evName.slice(atIdx + 4).trim().toLowerCase();
                    const anAway = awayTeam.toLowerCase();
                    const anHome = homeTeam.toLowerCase();
                    // Match by last word of team name
                    const awLast = anAway.split(" ").pop() ?? "";
                    const hwLast = anHome.split(" ").pop() ?? "";
                    if (awLast.length < 3 || hwLast.length < 3) continue;
                    if (!espAway.includes(awLast) || !espHome.includes(hwLast)) continue;

                    const comp = evData.competitions?.[0] ?? {};
                    const oddsRef: string | undefined = comp.odds?.$ref;
                    if (!oddsRef) { matched = true; break; }

                    const { data: oddsData } = await axios.get(oddsRef, { timeout: 6000 }).catch(() => ({ data: {} }));
                    const entry: any = (oddsData.items ?? [])[0];
                    if (!entry) { matched = true; break; }

                    // ESPN spread: entry.spread = home spread, so away = -entry.spread
                    const homeSpreadEspn: number | null = entry.spread ?? null;
                    spreadCurrent = homeSpreadEspn != null ? -homeSpreadEspn : null;
                    const awSpreadOpenStr: string = entry.awayTeamOdds?.open?.pointSpread?.american ?? "";
                    spreadOpen = awSpreadOpenStr ? parseFloat(awSpreadOpenStr) : null;
                    spreadMove = (spreadOpen != null && spreadCurrent != null) ? +(spreadCurrent - spreadOpen).toFixed(1) : null;

                    const totOpenStr: string = entry.open?.total?.american ?? "";
                    totalOpen    = totOpenStr ? parseFloat(totOpenStr) : null;
                    totalCurrent = entry.overUnder ?? null;
                    totalMove    = (totalOpen != null && totalCurrent != null) ? +(totalCurrent - totalOpen).toFixed(1) : null;

                    const mlAwayOpenStr: string = entry.awayTeamOdds?.open?.moneyLine?.american ?? "";
                    const mlHomeOpenStr: string = entry.homeTeamOdds?.open?.moneyLine?.american ?? "";
                    mlAwayOpen    = mlAwayOpenStr ? parseFloat(mlAwayOpenStr) : null;
                    mlHomeOpen    = mlHomeOpenStr ? parseFloat(mlHomeOpenStr) : null;
                    mlAwayCurrent = entry.awayTeamOdds?.moneyLine ?? null;
                    mlHomeCurrent = entry.homeTeamOdds?.moneyLine ?? null;

                    matched = true;
                    break;
                  }
                  if (matched) break;
                }
              } catch { /* ESPN supplement failed — continue with what we have */ }
            }

            // Skip if still no lines at all
            if (spreadCurrent == null && totalCurrent == null && mlAwayCurrent == null && mlHomeCurrent == null) continue;

            results.push({
              id: `lm-${slug}-${game.id}`,
              sport: label,
              awayTeam,
              homeTeam,
              gameTime,
              status: game.status ?? "scheduled",
              openingInserted: opening.inserted ?? null,
              currentInserted: current.inserted  ?? null,
              numBets,
              spread: {
                open:       spreadOpen,
                current:    spreadCurrent,
                move:       spreadMove,
                awayPublic: spreadAwayPublic,
                awayMoney:  spreadAwayMoney,
                homePublic: spreadHomePublic,
                homeMoney:  spreadHomeMoney,
              },
              total: {
                open:        totalOpen,
                current:     totalCurrent,
                move:        totalMove,
                overPublic:  totalOverPublic,
                overMoney:   totalOverMoney,
                underPublic: totalUnderPublic,
                underMoney:  totalUnderMoney,
              },
              moneyline: {
                awayOpen:    mlAwayOpen,
                awayCurrent: mlAwayCurrent,
                homeOpen:    mlHomeOpen,
                homeCurrent: mlHomeCurrent,
                awayPublic:  mlAwayPublic,
                awayMoney:   mlAwayMoney,
                homePublic:  mlHomePublic,
                homeMoney:   mlHomeMoney,
              },
            });
          }
        } catch (e: any) {
          console.warn(`[LineMovement] ${slug} error:`, e.message);
        }
      }));

      // ── Inject SBR MLB public pick % into MLB games ──────────────────────
      // If the SBR cache is stale, trigger a background refresh
      if (Date.now() - SBR_MLB_CACHE_TS > SBR_MLB_TTL) {
        fetchSbrMlbConsensus().catch(() => {});
      }
      for (const game of results) {
        if (game.sport !== "MLB") continue;
        const sbr = matchSbrEntry(game.awayTeam, game.homeTeam);
        if (!sbr) continue;
        // Only fill in if ActionNetwork didn't already provide values
        const ml = game.moneyline;
        if (ml.awayPublic == null && sbr.mlAwayPct != null) {
          ml.awayPublic = Math.round(sbr.mlAwayPct);
        }
        if (ml.homePublic == null && sbr.mlHomePct != null) {
          ml.homePublic = Math.round(sbr.mlHomePct);
        }
        const tot = game.total;
        if (tot.overPublic == null && sbr.overPct != null) {
          tot.overPublic = Math.round(sbr.overPct);
        }
        if (tot.underPublic == null && sbr.underPct != null) {
          tot.underPublic = Math.round(sbr.underPct);
        }
      }

      // Sort: most movement first
      results.sort((a, b) => {
        const aMove = Math.abs(a.spread?.move ?? 0) + Math.abs(a.total?.move ?? 0);
        const bMove = Math.abs(b.spread?.move ?? 0) + Math.abs(b.total?.move ?? 0);
        return bMove - aMove;
      });

      LINE_MOVEMENT_CACHE.set(cacheKey, { data: results, ts: Date.now() });
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Line Movement Intelligence: auto-research significant moves ─────────────
  const LM_RESEARCH_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_RESEARCH_TTL = 30 * 60 * 1000; // 30-min cache per game

  // Thresholds for "significant" movement
  const SIGNIFICANT_SPREAD = 1.5;  // spread moved >= 1.5 pts
  const SIGNIFICANT_TOTAL  = 1.5;  // total moved >= 1.5 pts
  const STEAM_SPREAD       = 3.0;
  const STEAM_TOTAL        = 3.0;
  const SIGNIFICANT_ML     = 30;   // ML moved >= 30 cents

  async function fetchGoogleNewsRSS(query: string): Promise<{ title: string; link: string; pubDate: string }[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
      const { data } = await axios.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const $ = cheerio.load(data, { xmlMode: true });
      const items: { title: string; link: string; pubDate: string }[] = [];
      $('item').slice(0, 5).each((_, el) => {
        items.push({
          title: $(el).find('title').text().trim(),
          link:  $(el).find('link').text().trim() || $(el).find('guid').text().trim(),
          pubDate: $(el).find('pubDate').text().trim(),
        });
      });
      return items;
    } catch { return []; }
  }

  async function fetchESPNInjuries(sport: string): Promise<{ player: string; status: string; team: string }[]> {
    const sportMap: Record<string, { sn: string; lg: string }> = {
      NBA: { sn: "basketball", lg: "nba" },
      MLB: { sn: "baseball",   lg: "mlb" },
      NHL: { sn: "hockey",     lg: "nhl" },
      NFL: { sn: "football",   lg: "nfl" },
    };
    const s = sportMap[sport];
    if (!s) return [];
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${s.sn}/${s.lg}/injuries`;
      const { data } = await axios.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const teams: any[] = data?.teams ?? [];
      const injuries: { player: string; status: string; team: string }[] = [];
      for (const team of teams) {
        const name = team.team?.displayName ?? "";
        for (const inj of (team.injuries ?? [])) {
          const pName = inj.athlete?.displayName ?? "";
          const status = inj.status ?? inj.type?.description ?? "Questionable";
          if (pName) injuries.push({ player: pName, status, team: name });
        }
      }
      return injuries;
    } catch { return []; }
  }

  // ── MLB city map for RotoGrinders / NFLWeather lookup ───────────────────────
  const TEAM_CITY: Record<string, string> = {
    // MLB
    "Yankees": "New York", "Mets": "New York", "Red Sox": "Boston", "Blue Jays": "Toronto",
    "Rays": "Tampa", "Orioles": "Baltimore", "White Sox": "Chicago", "Cubs": "Chicago",
    "Indians": "Cleveland", "Guardians": "Cleveland", "Tigers": "Detroit", "Royals": "Kansas City",
    "Twins": "Minneapolis", "Astros": "Houston", "Athletics": "Oakland", "Angels": "Anaheim",
    "Mariners": "Seattle", "Rangers": "Arlington", "Dodgers": "Los Angeles", "Giants": "San Francisco",
    "Padres": "San Diego", "Rockies": "Denver", "Diamondbacks": "Phoenix", "Braves": "Atlanta",
    "Marlins": "Miami", "Phillies": "Philadelphia", "Nationals": "Washington", "Mets": "New York",
    "Reds": "Cincinnati", "Brewers": "Milwaukee", "Cardinals": "St. Louis", "Pirates": "Pittsburgh",
    // NFL
    "Bears": "Chicago", "Lions": "Detroit", "Packers": "Green Bay", "Vikings": "Minneapolis",
    "Falcons": "Atlanta", "Panthers": "Charlotte", "Saints": "New Orleans", "Buccaneers": "Tampa",
    "Cardinals": "Phoenix", "Rams": "Los Angeles", "49ers": "San Francisco", "Seahawks": "Seattle",
    "Cowboys": "Dallas", "Giants": "New York", "Eagles": "Philadelphia", "Commanders": "Washington",
    "Browns": "Cleveland", "Steelers": "Pittsburgh", "Ravens": "Baltimore", "Bengals": "Cincinnati",
    "Texans": "Houston", "Colts": "Indianapolis", "Titans": "Nashville", "Jaguars": "Jacksonville",
    "Chiefs": "Kansas City", "Raiders": "Las Vegas", "Chargers": "Los Angeles", "Broncos": "Denver",
    "Bills": "Buffalo", "Dolphins": "Miami", "Patriots": "Boston", "Jets": "New York",
  };

  function getCityFromTeam(teamName: string): string {
    for (const [team, city] of Object.entries(TEAM_CITY)) {
      if (teamName.includes(team)) return city;
    }
    // Fallback: strip last word (team nickname) to get city
    const words = teamName.trim().split(/\s+/);
    return words.slice(0, -1).join(" ") || teamName;
  }

  // ── Dome/retractable roof stadiums — weather has zero impact ───────────
  const DOME_VENUES: Set<string> = new Set([
    // MLB fully enclosed / retractable (closed default)
    "Tropicana Field","Minute Maid Park","Globe Life Field","American Family Field",
    "Rogers Centre","loanDepot park","Chase Field","T-Mobile Park",
    // NFL
    "Lucas Oil Stadium","Ford Field","Mercedes-Benz Stadium","State Farm Stadium",
    "Allegiant Stadium","SoFi Stadium","AT&T Stadium","NRG Stadium",
    "U.S. Bank Stadium","Caesars Superdome",
  ]);

  // Outfield wind direction lookup: compass bearing → is wind blowing OUT to CF?
  // "Out to CF" = wind bearing within ±45° of 0° (North compass = toward CF in most parks)
  // Simplified: out directions = N, NNE, NNW, NE, NW (blowing toward outfield)
  const OUT_DIRS = new Set(["N","NNE","NNW","NE","NW","NEN","NWN"]);
  const IN_DIRS  = new Set(["S","SSE","SSW","SE","SW","SES","SWS"]);

  // Structured weather type — used everywhere in the app
  interface WeatherData {
    tempF:       number;
    windMph:     number;
    windDir:     string;   // 16-point compass, e.g. "NNW"
    windOut:     boolean;  // blowing toward outfield
    windIn:      boolean;  // blowing in from outfield
    humidity:    number;   // 0-100
    precipInches:number;   // today's precip in inches
    cloudPct:    number;   // cloud cover 0-100
    description: string;   // human-readable e.g. "Partly Cloudy"
    isDome:      boolean;
    // Derived impact scores (0.0–1.0, neutral = 0.5)
    hitterImpact:  number; // >0.5 = hitter-friendly, <0.5 = pitcher-friendly
    scoringImpact: number; // >0.5 = high scoring, <0.5 = low scoring
    impactLabel:   string; // e.g. "🌬️ Wind blowing in — pitcher's park today"
    impactTier:    "major" | "moderate" | "minor" | "neutral";
    source:        string;
  }

  // In-memory weather cache keyed by "TEAM:SPORT:DATE"
  const weatherCache = new Map<string, { data: WeatherData; ts: number }>();
  const WEATHER_TTL = 30 * 60 * 1000; // 30 min

  function computeWeatherImpact(w: Omit<WeatherData, "hitterImpact" | "scoringImpact" | "impactLabel" | "impactTier">): Pick<WeatherData, "hitterImpact" | "scoringImpact" | "impactLabel" | "impactTier"> {
    if (w.isDome) {
      return { hitterImpact: 0.50, scoringImpact: 0.50, impactLabel: "🏟️ Dome — weather neutral", impactTier: "neutral" };
    }
    let score = 0.50;
    const labels: string[] = [];

    // Temperature effect (cold suppresses offense; heat aids carry)
    if      (w.tempF >= 85) { score += 0.10; labels.push(`☀️ Hot ${w.tempF}°F`); }
    else if (w.tempF >= 72) { score += 0.05; labels.push(`🌤 Warm ${w.tempF}°F`); }
    else if (w.tempF <= 45) { score -= 0.12; labels.push(`🥶 Cold ${w.tempF}°F`); }
    else if (w.tempF <= 55) { score -= 0.07; labels.push(`🌡 Cool ${w.tempF}°F`); }

    // Wind effect (strongest signal)
    if (w.windMph >= 15) {
      if (w.windOut)     { score += 0.16; labels.push(`🌬️ Wind ${w.windMph}mph OUT`); }
      else if (w.windIn) { score -= 0.16; labels.push(`💨 Wind ${w.windMph}mph IN`); }
      else               { score -= 0.04; labels.push(`💨 Cross-wind ${w.windMph}mph`); }
    } else if (w.windMph >= 10) {
      if (w.windOut)     { score += 0.09; labels.push(`🌬️ Wind ${w.windMph}mph out`); }
      else if (w.windIn) { score -= 0.09; labels.push(`💨 Wind ${w.windMph}mph in`); }
    } else if (w.windMph >= 6) {
      if (w.windOut)     { score += 0.04; }
      else if (w.windIn) { score -= 0.04; }
    }

    // Rain / precipitation
    if (w.precipInches >= 0.1)      { score -= 0.14; labels.push(`🌧️ Rain ${w.precipInches}"`) ; }
    else if (w.precipInches >= 0.02) { score -= 0.06; labels.push("🌦 Light rain"); }

    // Humidity (humid air is slightly less dense = ball carries slightly further)
    if (w.humidity >= 80 && w.tempF >= 65) score += 0.02;

    score = Math.max(0.10, Math.min(0.90, score));
    const delta = score - 0.50;
    const tier: WeatherData["impactTier"] = Math.abs(delta) >= 0.14 ? "major"
                                           : Math.abs(delta) >= 0.07 ? "moderate"
                                           : Math.abs(delta) >= 0.03 ? "minor"
                                           : "neutral";

    const impactLabel = labels.length > 0
      ? labels.join(" · ")
      : score >= 0.55 ? "🌤 Hitter-friendly conditions"
      : score <= 0.45 ? "🏟️ Pitcher-friendly conditions"
      : "⚖️ Weather neutral";

    return { hitterImpact: score, scoringImpact: score, impactLabel, impactTier: tier };
  }

  async function fetchStructuredWeather(homeTeam: string, sport: string, venueName?: string): Promise<WeatherData | null> {
    // ── Dome check first ──────────────────────────────────────────────
    const isDome = !!(venueName && DOME_VENUES.has(venueName))
                || (sport !== "MLB" && sport !== "NFL" && sport !== "CFB");
    if (isDome) {
      const base = { tempF:72, windMph:0, windDir:"N", windOut:false, windIn:false,
                     humidity:50, precipInches:0, cloudPct:0, description:"Dome",
                     isDome:true, source:"dome" };
      return { ...base, ...computeWeatherImpact(base) };
    }

    const city = getCityFromTeam(homeTeam);
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `${homeTeam}:${sport}:${today}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < WEATHER_TTL) return cached.data;

    // ── wttr.in JSON API — structured, reliable, free ────────────────
    try {
      const encoded = encodeURIComponent(city);
      const { data } = await axios.get(`https://wttr.in/${encoded}?format=j1`, {
        timeout: 8000,
        headers: { "User-Agent": "curl/7.64.1" },
      });
      const cur = data?.current_condition?.[0];
      if (!cur) throw new Error("no current_condition");

      const tempF       = parseInt(cur.temp_F        ?? "70",  10);
      const windMph     = parseInt(cur.windspeedMiles ?? "0",   10);
      const windDir     = (cur.winddir16Point ?? "N") as string;
      const humidity    = parseInt(cur.humidity       ?? "50",  10);
      const precipInches= parseFloat(cur.precipInches ?? "0");
      const cloudPct    = parseInt(cur.cloudcover     ?? "0",   10);
      const description = cur.weatherDesc?.[0]?.value ?? "Clear";
      const windOut     = OUT_DIRS.has(windDir);
      const windIn      = IN_DIRS.has(windDir);

      const base = { tempF, windMph, windDir, windOut, windIn, humidity, precipInches, cloudPct, description, isDome: false };
      const impact = computeWeatherImpact(base);
      const result: WeatherData = { ...base, ...impact, source: "wttr.in" };
      weatherCache.set(cacheKey, { data: result, ts: Date.now() });
      return result;
    } catch (e: any) {
      console.warn(`[Weather] wttr.in failed for ${city}:`, e.message);
    }

    // ── Fallback: plain wttr.in text format ───────────────────────────
    try {
      const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=3&u`, {
        timeout: 5000, headers: { "User-Agent": "curl/7.64.1" },
      });
      if (typeof data === "string") {
        const tempM = data.match(/([0-9]{2,3})°F/);
        const windM = data.match(/([0-9]+)mph/);
        const tempF   = tempM ? parseInt(tempM[1], 10) : 70;
        const windMph = windM ? parseInt(windM[1], 10) : 0;
        const base = { tempF, windMph, windDir: "N", windOut: false, windIn: false,
                       humidity: 50, precipInches: 0, cloudPct: 50, description: data.trim(), isDome: false };
        const impact = computeWeatherImpact(base);
        const result: WeatherData = { ...base, ...impact, source: "wttr.in-text" };
        weatherCache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      }
    } catch { return null; }

    return null;
  }

  // Legacy string wrapper — keeps existing fetchWeather() callers working
  async function fetchWeather(homeTeam: string, sport: string): Promise<string | null> {
    const w = await fetchStructuredWeather(homeTeam, sport);
    if (!w) return null;
    if (w.isDome) return `🏟️ Dome — weather neutral`;
    const parts = [`${w.tempF}°F`];
    if (w.windMph > 0) parts.push(`Wind ${w.windMph}mph ${w.windDir}`);
    if (w.precipInches > 0) parts.push(`Rain ${w.precipInches}"`);
    return `${getCityFromTeam(homeTeam)}: ${parts.join(" · ")}`;
  }


  function buildMovementSummary(game: any): string {
    const parts: string[] = [];
    const spreadMove = game.spread?.move;
    const totalMove  = game.total?.move;
    const mlAwayMove = (game.moneyline?.awayOpen != null && game.moneyline?.awayCurrent != null)
      ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null;
    const mlHomeMove = (game.moneyline?.homeOpen != null && game.moneyline?.homeCurrent != null)
      ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null;

    if (spreadMove != null && spreadMove !== 0) {
      const severity = Math.abs(spreadMove) >= STEAM_SPREAD ? "🔥 STEAM" : "⚡ Significant";
      parts.push(`${severity}: Spread moved ${spreadMove > 0 ? "+" : ""}${spreadMove} (${game.awayTeam} @ ${game.homeTeam})`);
    }
    if (totalMove != null && totalMove !== 0) {
      const severity = Math.abs(totalMove) >= STEAM_TOTAL ? "🔥 STEAM" : "⚡ Significant";
      parts.push(`${severity}: Total moved ${totalMove > 0 ? "+" : ""}${totalMove} (O/U ${game.total?.open} → ${game.total?.current})`);
    }
    if (mlAwayMove != null && Math.abs(mlAwayMove) >= SIGNIFICANT_ML) {
      parts.push(`ML shift: ${game.awayTeam} ML moved ${mlAwayMove > 0 ? "+" : ""}${mlAwayMove}`);
    }
    if (mlHomeMove != null && Math.abs(mlHomeMove) >= SIGNIFICANT_ML) {
      parts.push(`ML shift: ${game.homeTeam} ML moved ${mlHomeMove > 0 ? "+" : ""}${mlHomeMove}`);
    }

    // Sharp signal
    const spreadMoneyAway = game.spread?.awayMoney;
    const spreadPublicAway = game.spread?.awayPublic;
    if (spreadMoneyAway != null && spreadPublicAway != null) {
      const div = spreadMoneyAway - spreadPublicAway;
      if (spreadMoneyAway >= 65 && div >= 20)
        parts.push(`💰 Sharp: ${game.awayTeam} getting ${spreadMoneyAway}% of spread money vs ${spreadPublicAway}% public bets`);
      else if (spreadMoneyAway <= 35 && div <= -20)
        parts.push(`💰 Fade signal: ${game.awayTeam} only ${spreadMoneyAway}% of money despite public support`);
    }
    const mlMoney = game.moneyline?.awayMoney;
    const mlPublic = game.moneyline?.awayPublic;
    if (mlMoney != null && mlPublic != null) {
      const div = mlMoney - mlPublic;
      if (mlMoney >= 65 && div >= 20)
        parts.push(`💰 ML Sharp: ${game.awayTeam} drawing ${mlMoney}% of ML money`);
    }

    return parts.join(" | ");
  }


  // ─── Clubhouse IQ on-demand grade for Line Movement page ──────────────────
  // POST /api/line-movement/ciq
  // Body: { sport, homeTeam, awayTeam, spread?, total?, mlHome?, mlAway?,
  //         spreadMove?, homeRecord?, awayRecord?, homeMoneyPct?, awayMoneyPct? }
  // Calls edge_grade.py directly and returns the full grade result
  app.post("/api/line-movement/ciq", async (req, res) => {
    try {
      const { sport, homeTeam, awayTeam, spread, awaySpread, total, mlHome, mlAway,
              spreadMove, homeRecord, awayRecord, homeMoneyPct, awayMoneyPct,
              spreadAwayPct, spreadHomePct } = req.body ?? {};

      if (!sport || !homeTeam || !awayTeam) {
        return res.status(400).json({ error: "sport, homeTeam, awayTeam required" });
      }

      // LM data gives us the AWAY team's spread (e.g. -15.5 = away is -15.5 favorite)
      // Home spread is the inverse
      const awayLine  = awaySpread ?? spread ?? null;
      const homeML    = mlHome ?? null;
      const awayML    = mlAway ?? null;

      // Determine pick side — priority: sharp money % → moneyline implied prob → spread
      let pickSide: "home" | "away" = "home";
      const sharpHome = spreadHomePct ?? homeMoneyPct ?? null;
      const sharpAway = spreadAwayPct ?? awayMoneyPct ?? null;

      if (sharpHome != null && sharpAway != null) {
        pickSide = sharpAway >= sharpHome ? "away" : "home";
      } else if (homeML != null && awayML != null) {
        const homeProb = homeML < 0 ? Math.abs(homeML) / (Math.abs(homeML) + 100) : 100 / (homeML + 100);
        const awayProb = awayML < 0 ? Math.abs(awayML) / (Math.abs(awayML) + 100) : 100 / (awayML + 100);
        pickSide = awayProb >= homeProb ? "away" : "home";
      } else if (awayLine != null) {
        // Negative away spread = away is the favorite
        pickSide = awayLine < 0 ? "away" : "home";
      }

      // ── Fetch structured weather for outdoor sports ─────────────────
      let weatherPayload: any = null;
      if (sport === "MLB" || sport === "NFL" || sport === "CFB") {
        try {
          const sw = await fetchStructuredWeather(homeTeam, sport);
          if (sw) {
            weatherPayload = {
              tempF: sw.tempF, windMph: sw.windMph, windDir: sw.windDir,
              windOut: sw.windOut, windIn: sw.windIn,
              humidity: sw.humidity, precipInches: sw.precipInches,
              isDome: sw.isDome, impactLabel: sw.impactLabel,
              impactTier: sw.impactTier, hitterImpact: sw.hitterImpact,
            };
          }
        } catch { /* weather optional */ }
      }

      const payload = {
        sport,
        homeTeam,
        awayTeam,
        pickSide,
        homeRecord:   homeRecord ?? "0-0",
        awayRecord:   awayRecord ?? "0-0",
        homeML:       homeML,
        awayML:       awayML,
        spreadHome:   awayLine != null ? -awayLine : null,
        spreadDelta:  spreadMove ?? 0,
        homeMoneyPct: homeMoneyPct ?? null,
        awayMoneyPct: awayMoneyPct ?? null,
        total:        total ?? null,
        weather:      weatherPayload,
      };

      // Resolve edge_grade.py — try multiple paths since __dirname=dist/ in production
      const fs = await import("fs");
      const candidatePaths = [
        path.join(process.cwd(), "server", "edge_grade.py"),
        path.join(__dirname, "edge_grade.py"),
        path.join(__dirname, "..", "server", "edge_grade.py"),
      ];
      const pyPath = candidatePaths.find(p => fs.existsSync(p)) ?? candidatePaths[0];
      console.log(`[CIQ/LM] Using edge_grade.py at: ${pyPath} (exists: ${fs.existsSync(pyPath)})`);

      const result = await new Promise<any>((resolve) => {
        const child = spawn("python3", [pyPath, "grade", JSON.stringify(payload)], { timeout: 15000 });
        let out = "";
        let err = "";
        child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
        child.on("close", (code: number) => {
          if (code !== 0 || !out.trim()) {
            console.warn(`[CIQ/LM] edge_grade exited ${code}. stderr: ${err.slice(0, 400)}`);
            resolve(null);
            return;
          }
          try { resolve(JSON.parse(out.trim())); }
          catch (e) { console.warn("[CIQ/LM] JSON parse failed:", out.slice(0, 200)); resolve(null); }
        });
        child.on("error", (e: any) => { console.warn("[CIQ/LM] spawn error:", e.message); resolve(null); });
      });

      if (!result) {
        return res.status(200).json({ available: false, reason: "grade engine unavailable" });
      }

      const pickTeam = pickSide === "home" ? homeTeam : awayTeam;
      const pickedOdds = pickSide === "home" ? (mlHome ?? null) : (mlAway ?? null);

      return res.json({
        available: true,
        grade:       result.grade,
        score:       result.score,
        confidence:  result.confidence,
        sizing:      result.sizing,
        ev:          result.ev,
        chains:      result.chains_fired ?? result.chains ?? [],
        variables:   result.variables ?? {},
        peter:       result.peter ?? { flags: [], has_kill: false },
        pickSide,
        pickTeam,
        pickedOdds,
      });
    } catch (e: any) {
      console.error("[CIQ/LM] Error:", e.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/line-movement/research/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;

      // Serve from cache if fresh
      const cached = LM_RESEARCH_CACHE.get(gameId);
      if (cached && Date.now() - cached.ts < LM_RESEARCH_TTL) {
        return res.json(cached.data);
      }

      // Find the game from the line movement cache
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      const game = lmCache?.data?.find((g: any) => g.id === gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found in line movement cache. Refresh the page first." });
      }

      const { sport, awayTeam, homeTeam, gameTime } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;
      const moveSummary = buildMovementSummary(game);

      // Run all research in parallel
      const [injuryData, newsRaw, newsTeamA, newsTeamB, weather] = await Promise.allSettled([
        fetchESPNInjuries(sport),
        fetchGoogleNewsRSS(`${awayTeam} ${homeTeam} betting odds line movement`),
        fetchGoogleNewsRSS(`${awayTeam} injury report ${sport}`),
        fetchGoogleNewsRSS(`${homeTeam} injury report ${sport}`),
        fetchWeather(homeTeam, sport),
      ]);

      const allInjuries: { player: string; status: string; team: string }[] =
        injuryData.status === "fulfilled" ? injuryData.value : [];

      // Filter injuries to teams in this game
      const awayWords = awayTeam.split(" ");
      const homeWords = homeTeam.split(" ");
      const gameInjuries = allInjuries.filter(inj => {
        const t = inj.team.toLowerCase();
        return awayWords.some(w => w.length > 3 && t.includes(w.toLowerCase())) ||
               homeWords.some(w => w.length > 3 && t.includes(w.toLowerCase()));
      }).slice(0, 10);

      // Combine news results
      const allNews: { title: string; link: string; pubDate: string }[] = [
        ...(newsRaw.status === "fulfilled" ? newsRaw.value : []),
        ...(newsTeamA.status === "fulfilled" ? newsTeamA.value : []),
        ...(newsTeamB.status === "fulfilled" ? newsTeamB.value : []),
      ];
      // Deduplicate by title similarity
      const seen = new Set<string>();
      const dedupedNews = allNews.filter(n => {
        const key = n.title.toLowerCase().slice(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8);

      const weatherInfo = weather.status === "fulfilled" ? weather.value : null;

      // Build a concise AI-style summary
      const summaryParts: string[] = [];

      // Movement reason
      if (moveSummary) {
        summaryParts.push(`📊 **Movement**: ${moveSummary}`);
      }

      // Injury flags
      if (gameInjuries.length > 0) {
        const injList = gameInjuries.map(i => `${i.player} (${i.team}) — ${i.status}`).join("; ");
        summaryParts.push(`🏥 **Injuries**: ${injList}`);
      } else {
        summaryParts.push(`🏥 **Injuries**: No major injuries found via ESPN`);
      }

      // Weather
      if (weatherInfo) {
        const weatherF = weatherInfo.replace(/\+?(-?\d+)°C/g, (_: string, n: string) => `${Math.round(+n * 9/5 + 32)}°F`);
        summaryParts.push(`🌤 **Weather**: ${weatherF}`);
      }

      // Sharp money signal
      const spreadAwayMoney = game.spread?.awayMoney;
      const spreadAwayPublic = game.spread?.awayPublic;
      const totalOverMoney = game.total?.overMoney;
      const totalOverPublic = game.total?.overPublic;
      const sharpNotes: string[] = [];
      if (spreadAwayMoney != null && spreadAwayPublic != null) {
        const div = spreadAwayMoney - spreadAwayPublic;
        if (Math.abs(div) >= 15) {
          sharpNotes.push(`${awayTeam} spread: ${spreadAwayMoney}% money vs ${spreadAwayPublic}% tickets (${div > 0 ? "sharp lean" : "public fade"})`);
        }
      }
      if (totalOverMoney != null && totalOverPublic != null) {
        const div = totalOverMoney - totalOverPublic;
        if (Math.abs(div) >= 15) {
          sharpNotes.push(`Over: ${totalOverMoney}% money vs ${totalOverPublic}% tickets (${div > 0 ? "sharp over" : "sharp under"})`);
        }
      }
      if (game.numBets != null) {
        sharpNotes.push(`Total bets tracked: ${game.numBets.toLocaleString()}`);
      }
      if (sharpNotes.length > 0) {
        summaryParts.push(`💰 **Sharp Money**: ${sharpNotes.join(" | ")}`);
      }

      // News headlines
      if (dedupedNews.length > 0) {
        const headlineStr = dedupedNews
          .slice(0, 4)
          .map(n => `• ${n.title}`)
          .join("\n");
        summaryParts.push(`📰 **Recent News**:\n${headlineStr}`);
      }

      const result = {
        gameId,
        gameName,
        sport,
        gameTime,
        moveSummary,
        injuries: gameInjuries,
        weather: weatherInfo,
        news: dedupedNews,
        sharpSignals: sharpNotes,
        summary: summaryParts.join("\n\n"),
        researchedAt: new Date().toISOString(),
      };

      LM_RESEARCH_CACHE.set(gameId, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Steam / Book-Error Intel Endpoint ──────────────────────────────────────
  // GET /api/line-movement/intel/:gameId
  // Auto-fires when a steam move or book error is detected on a game card.
  // Returns a concise "why did the line move?" card: injuries, news, weather,
  // sharp signal breakdown.  Cached 15 min.
  const LM_INTEL_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_INTEL_TTL = 15 * 60 * 1000;

  app.get("/api/line-movement/intel/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;

      // Serve from cache if fresh
      const cached = LM_INTEL_CACHE.get(gameId);
      if (cached && Date.now() - cached.ts < LM_INTEL_TTL) {
        return res.json({ ...cached.data, cached: true });
      }

      // Find the game from the line movement cache
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      const game = lmCache?.data?.find((g: any) => g.id === gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found — refresh line movement data first." });
      }

      const { sport, awayTeam, homeTeam, gameTime, spread, total, moneyline } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;

      // Detect trigger type
      const spreadMove = spread?.move ?? 0;
      const totalMove  = total?.move ?? 0;
      const mlAwayMove = (moneyline?.awayOpen != null && moneyline?.awayCurrent != null)
        ? moneyline.awayCurrent - moneyline.awayOpen : 0;
      const mlHomeMove = (moneyline?.homeOpen != null && moneyline?.homeCurrent != null)
        ? moneyline.homeCurrent - moneyline.homeOpen : 0;

      const isSteam      = Math.abs(spreadMove) >= STEAM_SPREAD || Math.abs(totalMove) >= STEAM_TOTAL;
      const isRLM        = (() => {
        if (spread?.awayPublic != null && spreadMove !== 0) {
          const pub = spread.awayPublic;
          if (pub >= 60 && spreadMove > 0.5) return true;  // public on away, line moved against them
          if (pub <= 38 && spreadMove < -0.5) return true; // public on home, line moved against them
        }
        if (total?.overPublic != null && totalMove !== 0) {
          const pub = total.overPublic;
          if (pub >= 60 && totalMove < -0.5) return true;
          if (pub <= 38 && totalMove > 0.5) return true;
        }
        return false;
      })();
      const isSharpDiv   = (() => {
        if (spread?.awayMoney != null && spread?.awayPublic != null) {
          return Math.abs(spread.awayMoney - spread.awayPublic) >= 25;
        }
        return false;
      })();
      const isMLBigMove  = Math.abs(mlAwayMove) >= SIGNIFICANT_ML || Math.abs(mlHomeMove) >= SIGNIFICANT_ML;

      // Determine trigger label
      let triggerType = "line_alert";
      let triggerLabel = "Line Alert";
      if (isSteam)     { triggerType = "steam";   triggerLabel = "Steam Move"; }
      else if (isRLM)  { triggerType = "rlm";     triggerLabel = "Reverse Line Movement"; }
      else if (isSharpDiv) { triggerType = "sharp_div"; triggerLabel = "Sharp/Public Split"; }
      else if (isMLBigMove) { triggerType = "ml_move"; triggerLabel = "Big ML Move"; }

      // Parallel research: injuries + 3 news queries + weather
      const searchQueries = [
        `${awayTeam} ${homeTeam} ${sport} injury update today`,
        `${awayTeam} ${homeTeam} line movement betting news today`,
        `${awayTeam} OR ${homeTeam} game news ${new Date().toISOString().slice(0, 10)}`,
      ];

      const [injuryData, news1, news2, news3, weather] = await Promise.allSettled([
        fetchESPNInjuries(sport),
        fetchGoogleNewsRSS(searchQueries[0]),
        fetchGoogleNewsRSS(searchQueries[1]),
        fetchGoogleNewsRSS(searchQueries[2]),
        fetchWeather(homeTeam, sport),
      ]);

      // Injuries — filter to this game's teams
      const allInj: { player: string; status: string; team: string }[] =
        injuryData.status === "fulfilled" ? injuryData.value : [];
      const awayWords = awayTeam.split(" ");
      const homeWords = homeTeam.split(" ");
      const gameInjuries = allInj.filter(inj => {
        const t = inj.team.toLowerCase();
        return awayWords.some((w: string) => w.length > 3 && t.includes(w.toLowerCase())) ||
               homeWords.some((w: string) => w.length > 3 && t.includes(w.toLowerCase()));
      }).slice(0, 6);

      // Deduplicate news across 3 queries
      const rawNews = [
        ...(news1.status === "fulfilled" ? news1.value : []),
        ...(news2.status === "fulfilled" ? news2.value : []),
        ...(news3.status === "fulfilled" ? news3.value : []),
      ];
      const seen = new Set<string>();
      const dedupedNews = rawNews.filter(n => {
        const key = n.title.toLowerCase().slice(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 6);

      // Build a prioritized reason list (shown as intel bullets)
      const reasons: { icon: string; type: string; text: string; severity: "high" | "medium" | "low" }[] = [];

      // 1. Injury intel — highest priority
      const outPlayers = gameInjuries.filter(i => /out|doubtful/i.test(i.status));
      const qPlayers   = gameInjuries.filter(i => /questionable|probable/i.test(i.status));
      if (outPlayers.length > 0) {
        reasons.push({
          icon: "🏥",
          type: "injury",
          text: `Key injuries: ${outPlayers.map(i => `${i.player} (${i.team}) — ${i.status}`).join(", ")}`,
          severity: "high",
        });
      }
      if (qPlayers.length > 0) {
        reasons.push({
          icon: "⚠️",
          type: "injury",
          text: `Questionable: ${qPlayers.map(i => `${i.player} (${i.team})`).join(", ")}`,
          severity: "medium",
        });
      }

      // 2. Sharp money signal
      const spreadMoneyAway = spread?.awayMoney;
      const spreadPublicAway = spread?.awayPublic;
      if (spreadMoneyAway != null && spreadPublicAway != null) {
        const div = spreadMoneyAway - spreadPublicAway;
        if (Math.abs(div) >= 15) {
          const sharpSide = div > 0 ? awayTeam : homeTeam;
          const pct = div > 0 ? spreadMoneyAway : (100 - spreadMoneyAway);
          const pubPct = div > 0 ? spreadPublicAway : (100 - spreadPublicAway);
          reasons.push({
            icon: "💰",
            type: "sharp_money",
            text: `Sharp money on ${sharpSide}: ${pct}% of $ vs ${pubPct}% of tickets — ${Math.abs(div)}-pt split`,
            severity: Math.abs(div) >= 25 ? "high" : "medium",
          });
        }
      }
      const mlMoneyAway = moneyline?.awayMoney;
      const mlPublicAway = moneyline?.awayPublic;
      if (mlMoneyAway != null && mlPublicAway != null) {
        const div = mlMoneyAway - mlPublicAway;
        if (Math.abs(div) >= 20) {
          const sharpSide = div > 0 ? awayTeam : homeTeam;
          const pct = div > 0 ? mlMoneyAway : (100 - mlMoneyAway);
          reasons.push({
            icon: "💰",
            type: "sharp_money",
            text: `ML sharp action: ${sharpSide} drawing ${pct}% of ML money`,
            severity: "medium",
          });
        }
      }

      // 3. Weather (outdoor sports)
      const weatherInfo = weather.status === "fulfilled" ? weather.value : null;
      if (weatherInfo) {
        const weatherInfo2 = weatherInfo.replace(/\+?(-?\d+)°C/g, (_: string, n: string) => `${Math.round(+n * 9/5 + 32)}°F`);
        const hasWind = /wind/i.test(weatherInfo2);
        const hasRain = /rain|storm|snow/i.test(weatherInfo2);
        reasons.push({
          icon: hasWind ? "💨" : hasRain ? "🌧" : "🌤",
          type: "weather",
          text: `Weather: ${weatherInfo2}`,
          severity: (hasWind || hasRain) ? "high" : "low",
        });
      }

      // 4. Line movement context
      if (Math.abs(spreadMove) > 0) {
        const side = spreadMove < 0 ? awayTeam : homeTeam;
        reasons.push({
          icon: "📊",
          type: "line_move",
          text: `Spread moved ${spreadMove > 0 ? "+" : ""}${spreadMove} pts toward ${side} (${spread?.open != null ? (spread.open > 0 ? "+" : "") + spread.open : "?"} → ${spread?.current != null ? (spread.current > 0 ? "+" : "") + spread.current : "?"})`,
          severity: Math.abs(spreadMove) >= 3 ? "high" : "medium",
        });
      }
      if (Math.abs(totalMove) > 0) {
        const dir = totalMove > 0 ? "Over" : "Under";
        reasons.push({
          icon: "📊",
          type: "line_move",
          text: `Total steamed ${Math.abs(totalMove)} pts to the ${dir} (${total?.open} → ${total?.current})`,
          severity: Math.abs(totalMove) >= 3 ? "high" : "medium",
        });
      }

      // 5. News headlines — scan for relevant keywords
      const relevantNews = dedupedNews.filter(n => {
        const t = n.title.toLowerCase();
        const teamKeywords = [...awayTeam.split(" "), ...homeTeam.split(" ")]
          .filter((w: string) => w.length > 3)
          .map((w: string) => w.toLowerCase());
        return teamKeywords.some((kw: string) => t.includes(kw)) ||
          /injur|scratch|lineup|roster|suspend|trade|deal|weather|wind|rain|snow|out|dnp|questionable|ruled/i.test(t);
      }).slice(0, 4);

      // Build concise summary headline
      const topReason = reasons.find(r => r.severity === "high") ?? reasons[0] ?? null;
      let headline = "";
      if (isSteam) {
        headline = `🔥 Steam detected on ${gameName}`;
        if (topReason) headline += ` — ${topReason.text.replace(/^[^\w]*/, "")}`;
      } else if (isRLM) {
        headline = `↩ Reverse Line Movement on ${gameName}`;
        if (topReason) headline += ` — ${topReason.text.replace(/^[^\w]*/, "")}`;
      } else {
        headline = `⚡ Line Alert: ${gameName}`;
        if (topReason) headline += ` — ${topReason.text.replace(/^[^\w]*/, "")}`;
      }

      const result = {
        gameId,
        gameName,
        sport,
        gameTime,
        triggerType,
        triggerLabel,
        isSteam,
        isRLM,
        isSharpDiv,
        headline,
        reasons,
        relevantNews,
        injuries: gameInjuries,
        weather: weatherInfo,
        analyzedAt: new Date().toISOString(),
      };

      LM_INTEL_CACHE.set(gameId, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Book Error Detection ─────────────────────────────────────────────────────
  const LM_ERRORS_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_ERRORS_TTL = 10 * 60 * 1000; // 10-min cache

  interface BookError {
    id: string;
    gameId: string;
    gameName: string;
    sport: string;
    gameTime: string | null;
    errorType: "mispriced_spread" | "mispriced_total" | "mispriced_ml" | "reverse_line_movement" | "sharp_divergence" | "stale_line";
    betType: string;          // e.g. "Spread (Lakers -4.5)"
    actualLine: string;       // what the book currently shows
    mistake: string;          // description of the error
    correctLine: string;      // what the line should likely be
    betIdea: string;          // how to profit
    confidence: number;       // 1-100
    severity: "high" | "medium" | "low";
  }

  function detectBookErrors(games: any[]): BookError[] {
    const errors: BookError[] = [];

    for (const game of games) {
      const { id, sport, awayTeam, homeTeam, gameTime, spread, total, moneyline } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;
      let errIdx = 0;
      const mkId = (type: string) => `err-${id}-${type}-${errIdx++}`;

      // ── 1. Reverse Line Movement (RLM) — spread ──────────────────────────
      // Public is hammering one side but line moved the other way → sharp money on opposite
      if (spread.awayPublic != null && spread.awayMoney != null && spread.move != null) {
        const publicPct = spread.awayPublic;  // % of bets on away spread
        const moneyPct  = spread.awayMoney;   // % of money on away spread
        const move      = spread.move;

        // Case A: public loves away (+favor) but line moved against them (away spread got worse)
        if (publicPct >= 60 && move > 0.5) {
          // Away gets more public bets but spread rose (harder to cover) → book/sharps fading away
          errors.push({
            id: mkId("rlm-spread-away"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Spread — ${awayTeam}`,
            actualLine: `${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current}`,
            mistake: `${publicPct}% of bets are on ${awayTeam} but the line has moved ${move > 0 ? "+" : ""}${move} against them (from ${spread.open > 0 ? "+" : ""}${spread.open}). This is a classic Reverse Line Movement signal — sharps are fading the public.`,
            correctLine: `Sharp money says ${homeTeam} side has value at current spread`,
            betIdea: `Bet ${homeTeam} ${spread.current > 0 ? "-" : "+"}${Math.abs(spread.current ?? 0)} — line is moving in their favor despite public being on the other side. This is an exploitable mispricing vs. the public-facing number.`,
            confidence: Math.min(90, 55 + Math.round(publicPct * 0.4) + Math.round(Math.abs(move) * 5)),
            severity: publicPct >= 75 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }

        // Case B: public loves home (away gets <40% of bets) but line moved in away's favor
        if (publicPct <= 38 && move < -0.5) {
          errors.push({
            id: mkId("rlm-spread-home"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Spread — ${homeTeam}`,
            actualLine: `${homeTeam} ${(-(spread.current ?? 0)) > 0 ? "+" : ""}${-(spread.current ?? 0)}`,
            mistake: `${100 - publicPct}% of bets are on ${homeTeam} but the spread has moved ${Math.abs(move)} points in ${awayTeam}'s favor (from ${spread.open} → ${spread.current}). Sharps are going against the public.`,
            correctLine: `Sharp action suggests ${awayTeam} is undervalued at this spread`,
            betIdea: `Bet ${awayTeam} spread — sharp money is pushing this line in their direction despite public fade. The discrepancy between public bets and line direction is a textbook RLM edge.`,
            confidence: Math.min(88, 55 + Math.round((100 - publicPct) * 0.4) + Math.round(Math.abs(move) * 5)),
            severity: (100 - publicPct) >= 75 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }
      }

      // ── 2. Sharp vs Public Divergence ≥25 pts (spread) ───────────────────
      if (spread.awayMoney != null && spread.awayPublic != null) {
        const div = spread.awayMoney - spread.awayPublic;
        if (Math.abs(div) >= 25) {
          const sharpSide = div > 0 ? awayTeam : homeTeam;
          const publicSide = div > 0 ? homeTeam : awayTeam;
          const sharpPct = div > 0 ? spread.awayMoney : (100 - spread.awayMoney);
          const publicPct2 = div > 0 ? spread.awayPublic : (100 - spread.awayPublic);
          const sharpLine = div > 0
            ? `${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current}`
            : `${homeTeam} ${(-(spread.current ?? 0)) > 0 ? "+" : ""}${-(spread.current ?? 0)}`;
          errors.push({
            id: mkId("div-spread"),
            gameId: id, gameName, sport, gameTime,
            errorType: "sharp_divergence",
            betType: `Spread — ${sharpSide}`,
            actualLine: sharpLine,
            mistake: `Massive sharp vs. public split: ${sharpPct}% of money on ${sharpSide} but only ${publicPct2}% of bets — a ${Math.abs(div)}-point divergence. The book's current spread does not fully reflect the sharp action, creating an exploitable window.`,
            correctLine: `Market should be pricing ${sharpSide} more favorably (sharp money dominant)`,
            betIdea: `Bet ${sharpSide} on the spread. When sharp money and public money diverge by 25+ points, following the sharp side has a documented positive expectation. Act before the line corrects.`,
            confidence: Math.min(85, 55 + Math.round(Math.abs(div) * 0.8)),
            severity: Math.abs(div) >= 35 ? "high" : "medium",
          });
        }
      }

      // ── 3. Reverse Line Movement — total ─────────────────────────────────
      if (total.overPublic != null && total.overMoney != null && total.move != null) {
        const overPub = total.overPublic;
        const overMon = total.overMoney;
        const move    = total.move;

        // Public loves OVER but total went DOWN
        if (overPub >= 60 && move < -0.5) {
          errors.push({
            id: mkId("rlm-total-under"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Total (O/U)`,
            actualLine: `O/U ${total.current} (opened ${total.open})`,
            mistake: `${overPub}% of bets are on the OVER but the total dropped ${Math.abs(move)} points (${total.open} → ${total.current}). Sharp money is hammering the UNDER while the public piles onto the over.`,
            correctLine: `Total likely should stay near ${total.open} if only public money — sharp pressure is pulling it under`,
            betIdea: `Bet the UNDER at ${total.current}. Sharps are driving this total down against overwhelming public over action — a classic fade-the-public edge. Current number is artificially soft relative to sharp signals.`,
            confidence: Math.min(88, 55 + Math.round(overPub * 0.35) + Math.round(Math.abs(move) * 6)),
            severity: overPub >= 70 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }

        // Public loves UNDER but total went UP
        if (overPub <= 38 && move > 0.5) {
          errors.push({
            id: mkId("rlm-total-over"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Total (O/U)`,
            actualLine: `O/U ${total.current} (opened ${total.open})`,
            mistake: `${100 - overPub}% of bets are on the UNDER but the total rose ${move} points (${total.open} → ${total.current}). Sharp money is on the OVER against public under sentiment.`,
            correctLine: `Total should reflect sharp OVER pressure — current line still undervalues it`,
            betIdea: `Bet the OVER at ${total.current}. Sharp money is inflating this total against public consensus. Get in now before further line movement pushes the number higher.`,
            confidence: Math.min(85, 55 + Math.round((100 - overPub) * 0.35) + Math.round(Math.abs(move) * 6)),
            severity: (100 - overPub) >= 70 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }
      }

      // ── 4. Stale Line — sharp money extreme but NO line movement ─────────
      // A book hasn't moved despite overwhelming sharp action → arbitrage window
      if (spread.awayMoney != null && spread.awayPublic != null && (spread.move == null || spread.move === 0)) {
        const div = Math.abs(spread.awayMoney - spread.awayPublic);
        if (div >= 30 && spread.awayMoney >= 65) {
          errors.push({
            id: mkId("stale-spread"),
            gameId: id, gameName, sport, gameTime,
            errorType: "stale_line",
            betType: `Spread — ${awayTeam}`,
            actualLine: `${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current} (no movement from open)`,
            mistake: `${spread.awayMoney}% of money on ${awayTeam} but the spread has NOT moved from ${spread.open}. The book is either slow to react or intentionally holding a stale line — creating a window before the inevitable correction.`,
            correctLine: `Expect ${awayTeam} spread to move ~0.5–1 pt in their favor once books re-price`,
            betIdea: `Bet ${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current} NOW before the line moves. Stale lines with extreme sharp money imbalances typically correct within hours — this is a time-sensitive value window.`,
            confidence: Math.min(80, 50 + Math.round(div * 0.7)),
            severity: div >= 40 ? "high" : "medium",
          });
        }
      }

      // ── 5. ML vs Spread Inconsistency ────────────────────────────────────
      // If spread has away as heavy favorite but ML says it's close (or vice versa)
      if (spread.current != null && moneyline.awayCurrent != null && moneyline.homeCurrent != null) {
        const spreadFavorsAway = spread.current < -3.5; // away favored by more than 3.5
        const mlFavorsHome = moneyline.homeCurrent < moneyline.awayCurrent && moneyline.homeCurrent < -110;

        if (spreadFavorsAway && mlFavorsHome) {
          errors.push({
            id: mkId("ml-spread-mismatch"),
            gameId: id, gameName, sport, gameTime,
            errorType: "mispriced_ml",
            betType: `Moneyline — ${homeTeam}`,
            actualLine: `${awayTeam} spread: ${spread.current} | ${homeTeam} ML: ${moneyline.homeCurrent > 0 ? "+" : ""}${moneyline.homeCurrent}`,
            mistake: `Spread has ${awayTeam} as a ${Math.abs(spread.current)}-point favorite yet the moneyline favors ${homeTeam}. This is a cross-market inconsistency — the spread and ML are telling opposite stories about the game's expected outcome.`,
            correctLine: `Spread and ML should align. Either the spread overvalues ${awayTeam} or the ML undervalues them.`,
            betIdea: `Two angles: (1) Bet ${awayTeam} ML — if you believe the spread, the ML is priced wrong and offers value. (2) Bet ${homeTeam} spread — if you believe the ML, the spread is too generous to ${awayTeam}. Verify both numbers across books before placing.`,
            confidence: 72,
            severity: "medium",
          });
        }

        const spreadFavorsHome = spread.current > 3.5;
        const mlFavorsAway = moneyline.awayCurrent < moneyline.homeCurrent && moneyline.awayCurrent < -110;
        if (spreadFavorsHome && mlFavorsAway) {
          errors.push({
            id: mkId("ml-spread-mismatch-2"),
            gameId: id, gameName, sport, gameTime,
            errorType: "mispriced_ml",
            betType: `Moneyline — ${awayTeam}`,
            actualLine: `${homeTeam} spread: ${(-(spread.current ?? 0)) > 0 ? "+" : ""}${-(spread.current ?? 0)} | ${awayTeam} ML: ${moneyline.awayCurrent > 0 ? "+" : ""}${moneyline.awayCurrent}`,
            mistake: `Spread has ${homeTeam} as a ${spread.current}-point favorite yet the moneyline favors ${awayTeam}. The two markets disagree on the outright winner — a pricing inconsistency that shouldn't persist.`,
            correctLine: `Spread and ML should align — one of these markets is mispriced.`,
            betIdea: `Bet ${homeTeam} ML — if you trust the spread, the ML is mispriced and gives value on the spread's implied favorite. Verify the current ML across DraftKings, FanDuel, and BetMGM before placing.`,
            confidence: 70,
            severity: "medium",
          });
        }
      }

      // ── 6. Sharp Total Divergence ≥25 pts ────────────────────────────────
      if (total.overMoney != null && total.overPublic != null) {
        const div = total.overMoney - total.overPublic;
        if (Math.abs(div) >= 25) {
          const sharpSide = div > 0 ? "OVER" : "UNDER";
          const sharpPct = div > 0 ? total.overMoney : (100 - total.overMoney!);
          const publicPct3 = div > 0 ? total.overPublic : (100 - total.overPublic!);
          errors.push({
            id: mkId("div-total"),
            gameId: id, gameName, sport, gameTime,
            errorType: "sharp_divergence",
            betType: `Total (${sharpSide})`,
            actualLine: `O/U ${total.current}`,
            mistake: `${sharpPct}% of money on the ${sharpSide} vs only ${publicPct3}% of tickets — a ${Math.abs(div)}-point sharp/public split on the total. The book's number doesn't yet reflect the full sharp signal.`,
            correctLine: `Sharp pressure suggests the total should move ${div > 0 ? "up" : "down"} from current ${total.current}`,
            betIdea: `Bet ${sharpSide} at ${total.current}. The sharp money split on totals of this magnitude historically precedes line movement. Take the current number before the book adjusts.`,
            confidence: Math.min(82, 52 + Math.round(Math.abs(div) * 0.7)),
            severity: Math.abs(div) >= 35 ? "high" : "medium",
          });
        }
      }
    }

    // Sort: high severity first, then by confidence descending
    errors.sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 };
      if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
      return b.confidence - a.confidence;
    });

    return errors;
  }

  app.get("/api/line-movement/errors", async (_req, res) => {
    try {
      const cacheKey = "lm-errors";
      const cached = LM_ERRORS_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LM_ERRORS_TTL) {
        return res.json(cached.data);
      }

      // Pull games from the line movement cache (or fetch fresh if needed)
      let games: any[] = [];
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      if (lmCache && Date.now() - lmCache.ts < LM_TTL) {
        games = lmCache.data;
      } else {
        // Trigger a fresh fetch by calling the LM endpoint logic inline (light version)
        // Just return empty for now — client should load /api/line-movement first
        return res.json([]);
      }

      const errors = detectBookErrors(games);
      LM_ERRORS_CACHE.set(cacheKey, { data: errors, ts: Date.now() });
      res.json(errors);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // ─── Market Signals — overlaps between model picks and prediction markets ──────
  // Returns a ranked list of bets where our model AND prediction markets agree.
  // Used to power the "Top Market-Backed Props" dashboard module and BetCard badges.
  const MARKET_SIGNALS_CACHE = new Map<string, { ts: number; data: any[] }>();
  const MARKET_SIGNALS_TTL = 60_000; // 1 minute


  // ─── GET /api/live-scores — ESPN scoreboard proxy for all 4 major sports ─────
  // Free ESPN public API — no auth required. Cached 30s for live games.
  const LIVE_SCORES_CACHE = new Map<string, { data: any; ts: number }>();
  const LIVE_SCORES_TTL   = 30_000; // 30 seconds

  app.get("/api/live-scores", async (req, res) => {
    try {
      const sport = (req.query.sport as string ?? "all").toLowerCase();
      const cacheKey = `live-scores-${sport}`;
      const cached = LIVE_SCORES_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LIVE_SCORES_TTL) {
        return res.json(cached.data);
      }

      const SPORTS = [
        { key: "nba",  sn: "basketball", lg: "nba"      },
        { key: "mlb",  sn: "baseball",   lg: "mlb"      },
        { key: "nhl",  sn: "hockey",     lg: "nhl"      },
        { key: "nfl",  sn: "football",   lg: "nfl"      },
      ];

      const targets = sport === "all" ? SPORTS : SPORTS.filter(s => s.key === sport);

      const results: Record<string, any[]> = {};

      await Promise.all(targets.map(async (s) => {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${s.sn}/${s.lg}/scoreboard`;
          const r   = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) { results[s.key] = []; return; }
          const d   = await r.json() as any;

          results[s.key] = (d.events ?? []).map((ev: any) => {
            const comp = ev.competitions?.[0] ?? {};
            const status = ev.status ?? {};
            const sit    = comp.situation ?? null;

            const teams = (comp.competitors ?? []).map((t: any) => ({
              id:           t.id,
              abbr:         t.team?.abbreviation ?? "?",
              displayName:  t.team?.displayName ?? "",
              shortName:    t.team?.shortDisplayName ?? "",
              logo:         t.team?.logo ?? null,
              color:        t.team?.color ? `#${t.team.color}` : null,
              score:        t.score ?? "0",
              homeAway:     t.homeAway,
              linescores:   (t.linescores ?? []).map((ls: any) => ({
                period: ls.period,
                value:  ls.displayValue ?? "0",
              })),
              records:      (t.records ?? []).map((rec: any) => rec.summary).slice(0, 1),
            }));

            // Stat leaders shown on scoreboard (pitching/hitting/scoring leaders)
            const leaders = (comp.leaders ?? []).flatMap((lg: any) =>
              (lg.leaders ?? []).slice(0, 2).map((l: any) => ({
                category:    lg.shortDisplayName ?? lg.abbreviation,
                displayValue: l.displayValue,
                athlete: {
                  id:       l.athlete?.id,
                  name:     l.athlete?.shortName ?? l.athlete?.displayName,
                  headshot: l.athlete?.headshot ?? null,
                  position: l.athlete?.position ?? null,
                  teamId:   l.athlete?.team?.id ?? null,
                },
              }))
            ).slice(0, 6);

            return {
              id:         ev.id,
              uid:        ev.uid,
              sport:      s.key.toUpperCase(),
              name:       ev.name,
              shortName:  ev.shortName,
              date:       ev.date,
              status: {
                state:       status.type?.state ?? "pre",          // "pre"|"in"|"post"
                description: status.type?.description ?? "Scheduled",
                detail:      status.type?.detail ?? "",
                shortDetail: status.type?.shortDetail ?? "",
                period:      status.period ?? 0,
                clock:       status.displayClock ?? "0:00",
                completed:   status.type?.completed ?? false,
              },
              venue: comp.venue ? {
                name: comp.venue.fullName,
                city: comp.venue.address?.city,
              } : null,
              teams,
              situation: sit ? {
                lastPlay:  sit.lastPlay?.text ?? null,
                balls:     sit.balls,
                strikes:   sit.strikes,
                outs:      sit.outs,
                onFirst:   sit.onFirst ?? false,
                onSecond:  sit.onSecond ?? false,
                onThird:   sit.onThird ?? false,
                pitcher: sit.pitcher ? {
                  name:     sit.pitcher.athlete?.displayName,
                  summary:  sit.pitcher.summary,
                  headshot: sit.pitcher.athlete?.headshot ?? null,
                } : null,
                batter: sit.batter ? {
                  name:     sit.batter.athlete?.displayName,
                  summary:  sit.batter.summary,
                  headshot: sit.batter.athlete?.headshot ?? null,
                } : null,
              } : null,
              leaders,
              broadcasts: (comp.broadcasts ?? []).flatMap((b: any) => b.names ?? []).slice(0, 2),
            };
          });
        } catch {
          results[s.key] = [];
        }
      }));

      const payload = { sports: results, updatedAt: new Date().toISOString() };
      LIVE_SCORES_CACHE.set(cacheKey, { data: payload, ts: Date.now() });
      res.json(payload);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/market-signals", async (_req, res) => {
    try {
      const cacheKey = "market-signals";
      const cached = MARKET_SIGNALS_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < MARKET_SIGNALS_TTL) {
        return res.json(cached.data);
      }

      // Pull current open sports bets
      const allBets = await storage.getBets();
      const sportsBets = allBets.filter(
        (b: any) => b.status === "open" &&
          ["NBA","NFL","MLB","NHL"].includes(b.sport) &&
          ["player_prop","spread","total","moneyline"].includes(b.betType ?? "")
      );

      // Fetch prediction markets from cache populated by /api/prediction-markets
      let predMarkets: any[] = [];
      try {
        const pmCached = (global as any).__predMktCache;
        if (pmCached && Date.now() - pmCached.ts < 120_000) {
          predMarkets = pmCached.data;
        }
      } catch {}

      // Normalize string for fuzzy matching
      const normStr = (s: string): string  =>{
        return (s ?? "").toLowerCase()
          .replace(/[^a-z0-9 ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Count word overlap between two normalized strings
      const wordOverlap = (a: string, b: string): number  =>{
        const wa = new Set(a.split(" ").filter((w: string) => w.length > 2));
        const wb = b.split(" ").filter((w: string) => w.length > 2);
        return wb.filter((w: string) => wa.has(w)).length;
      }

      // Sports-only prediction markets (exclude OTHER / geopolitics / crypto etc.)
      const sportsMarkets = predMarkets.filter(
        (m: any) => m.sport && !["OTHER","CRYPTO","POLITICS","WEATHER","MACRO"].includes(m.sport)
      );

      const signals: any[] = [];

      for (const bet of sportsBets) {
        const betNorm = normStr(
          [bet.title, bet.playerName ?? "", bet.homeTeam ?? "", bet.awayTeam ?? ""].join(" ")
        );
        let bestMatch: any = null;
        let bestScore = 0;

        for (const m of sportsMarkets) {
          // Only match same sport
          if (bet.sport && m.sport && m.sport !== bet.sport) continue;

          const mNorm = normStr(
            [m.title, m.event ?? "", ...(m.legs ?? [])].join(" ")
          );
          const overlap = wordOverlap(betNorm, mNorm);
          // Boost if player name words all appear in the market
          const playerWords = normStr(bet.playerName ?? "").split(" ").filter((w: string) => w.length > 2);
          const playerHit = playerWords.length > 0 && playerWords.every((w: string) => mNorm.includes(w));
          const score = playerHit ? overlap + 3 : overlap;
          if (score >= 2 && score > bestScore) {
            bestScore = score;
            bestMatch = m;
          }
        }

        if (!bestMatch) continue;

        const yesPrice    = bestMatch.yesPrice   ?? 0.5;
        const fairPrice   = bestMatch.fairPrice  ?? bestMatch.yesPrice ?? 0.5;
        const entry       = bestMatch.entry      ?? bestMatch.yesPrice ?? 0.5;
        const target      = bestMatch.target     ?? Math.min(1, (bestMatch.yesPrice ?? 0.5) + 0.10);
        const edge        = Math.round((fairPrice - yesPrice) * 100);
        const priceRating = bestMatch.priceRating ?? "fair";
        const modelScore  = bet.confidenceScore  ?? 50;

        // Agreement: does the market consensus align with our model pick?
        const marketBull = yesPrice >= 0.55 || priceRating === "good_buy" || priceRating === "great_buy";
        const marketBear = yesPrice <= 0.35 || priceRating === "overpriced";
        let agreement: "confirms" | "disagrees" | "neutral" = "neutral";
        let agreementStrength = 0;
        if (marketBull && modelScore >= 70) {
          agreement = "confirms";
          agreementStrength = Math.min(100, Math.round(modelScore * 0.5 + yesPrice * 50));
        } else if (marketBear && modelScore >= 70) {
          agreement = "disagrees";
          agreementStrength = Math.min(100, Math.round((1 - yesPrice) * 70));
        } else {
          agreementStrength = Math.round(Math.abs(yesPrice - 0.5) * 60);
        }

        // Combined score: model confidence (50%) + agreement (30%) + whale/edge/vol bonuses (20%)
        const whaleBonus = bestMatch.isWhaleAlert ? 20 : 0;
        const edgeBonus  = Math.min(15, Math.max(0, edge));
        const volBonus   = (bestMatch.vol24h ?? 0) >= 50_000 ? 10 : (bestMatch.vol24h ?? 0) >= 10_000 ? 5 : 0;
        const combinedScore = Math.min(100, Math.round(
          modelScore * 0.5 + agreementStrength * 0.3 + whaleBonus + edgeBonus + volBonus
        ));

        signals.push({
          betId:            bet.id,
          betTitle:         bet.title,
          betSport:         bet.sport,
          betType:          bet.betType ?? "player_prop",
          betScore:         modelScore,
          playerName:       bet.playerName ?? null,
          homeTeam:         bet.homeTeam  ?? null,
          awayTeam:         bet.awayTeam  ?? null,
          gameTime:         bet.gameTime  ?? null,
          marketId:         bestMatch.id,
          marketTitle:      bestMatch.title,
          marketSource:     bestMatch.source,
          marketSport:      bestMatch.sport,
          marketUrl:        bestMatch.kalshiUrl ?? null,
          yesPrice,
          fairPrice,
          entry,
          target,
          ph1:              bestMatch.ph1 ?? bestMatch.pd1 ?? 0,
          priceRating,
          isWhale:          bestMatch.isWhaleAlert  ?? false,
          smartScore:       bestMatch.smartScore    ?? 0,
          vol24h:           bestMatch.vol24h        ?? 0,
          crossValidated:   bestMatch.crossValidated ?? false,
          agreement,
          agreementStrength,
          combinedScore,
          edge,
        });
      }

      // Sort: confirms first, then by combinedScore desc
      signals.sort((a: any, b: any) => {
        if (a.agreement === "confirms" && b.agreement !== "confirms") return -1;
        if (a.agreement !== "confirms" && b.agreement === "confirms") return 1;
        return b.combinedScore - a.combinedScore;
      });

      const top = signals.slice(0, 25);
      MARKET_SIGNALS_CACHE.set(cacheKey, { ts: Date.now(), data: top });
      res.json(top);
    } catch (e: any) {
      console.warn("[market-signals] error:", e.message);
      res.json([]);
    }
  });

  // GET /api/smart-wallets — expose tracked whale wallet data + signal map
  app.get("/api/smart-wallets", async (_req, res) => {
    try {
      const wallets  = getSmartWallets();
      const signalMap = getSignalMap();
      res.json({ wallets, signalMap, count: wallets.length, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // BTS daily picks cache — keyed by "YYYY-MM-DD"
  // Once a date's picks are set they NEVER shrink (max 10 enforced at
  // write-time). At midnight CT the old date's key is simply not looked
  // up anymore, and the new date starts fresh.
  // ─────────────────────────────────────────────────────────────────────
  interface BtsPickEntry {
    playerId:        number;
    name:            string;
    team:            string;
    hitProbability:  number;
    lockedAt:        string; // ISO timestamp when the pick was cemented
    // result fields — filled in by the grader
    result:          "win" | "loss" | "pending" | "no_game";
    hits:            number | null; // actual hits recorded
    ab:              number | null; // at-bats
    gradedAt:        string | null; // ISO when grade was set
    gradedFinal:     boolean;        // true once graded from a Final box score (full game stats)
    // snapshot of the full pick object for display
    snapshot:        any;
  }

  // date string → array of up to 10 locked picks
  const btsPicksCache: Record<string, BtsPickEntry[]> = {};

  // Accumulated season record for BTS (wins/losses across all graded days)
  const btsSeasonRecord: { wins: number; losses: number; pending: number } =
    { wins: 0, losses: 0, pending: 0 };

  // ── CIQ Streak state — declared early so runBtsGrader can reference it ──
  interface CiqStreakDayEntry {
    date:         string;
    picks:        CiqStreakPick[];
    isDouble:     boolean;
    result:       "win" | "loss" | "pending";
    streakBefore: number;
    streakAfter:  number | null;
  }
  interface CiqStreakPick {
    playerId: string;
    name:     string;
    team:     string;
    score:    number;
    result:   "win" | "loss" | "pending";
    hits:     number | null;
    ab:       number | null;
    gradedAt: string | null;
  }
  interface CiqStreakState {
    currentStreak: number;
    bestStreak:    number;
    goal:          number;
    totalDays:     number;
    totalWins:     number;
    totalLosses:   number;
    history:       CiqStreakDayEntry[];
    lastPickDate:  string | null;
  }
  const ciqStreakState: CiqStreakState = {
    currentStreak: 0, bestStreak: 0, goal: 57,
    totalDays: 0, totalWins: 0, totalLosses: 0,
    history: [], lastPickDate: null,
  };

  // Track the last date btsSeasonRecord was fully reconciled from btsPicksCache
  let btsLastReconcileDate = "";

  function reconcileSeasonRecord() {
    let w = 0, l = 0, p = 0;
    for (const entries of Object.values(btsPicksCache)) {
      for (const e of entries) {
        if (e.result === "win")     w++;
        else if (e.result === "loss")    l++;
        else if (e.result === "pending") p++;
      }
    }
    btsSeasonRecord.wins    = w;
    btsSeasonRecord.losses  = l;
    btsSeasonRecord.pending = p;
  }

  // ── Persist btsPicksCache to disk + Postgres (source of truth) ─────────
  const BTS_PICKS_PATH = path.join(__dirname, "ml_data", "bts_picks.json");

  let _btsSyncTimer: ReturnType<typeof setTimeout> | null = null;
  function saveBtsPicksCache() {
    const json = JSON.stringify(btsPicksCache, null, 2);
    // 1. Local disk
    try {
      fs.mkdirSync(path.dirname(BTS_PICKS_PATH), { recursive: true });
      fs.writeFileSync(BTS_PICKS_PATH, json, "utf-8");
    } catch (e: any) {
      console.warn("[BTS] Failed to save bts_picks.json:", e.message);
    }
    // 2. Postgres ml_data_store (immediate, no token needed)
    db.query(
      `INSERT INTO ml_data_store (filename, content, updated_at)
       VALUES ('bts_picks.json', $1, NOW())
       ON CONFLICT (filename) DO UPDATE
         SET content = EXCLUDED.content, updated_at = NOW()`,
      [json]
    ).catch((e: any) => console.warn("[BTS] DB save error:", e.message));
    // 3. Also upsert each pick row into bts_picks table for direct DB querying
    for (const [date, entries] of Object.entries(btsPicksCache)) {
      for (const e of entries as BtsPickEntry[]) {
        db.query(
          `INSERT INTO bts_picks
             (pick_date, player_id, player_name, team, hit_probability,
              locked_at, locked, result, hits, ab, graded_at, snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (pick_date, player_id) DO UPDATE SET
             player_name    = EXCLUDED.player_name,
             hit_probability= EXCLUDED.hit_probability,
             locked_at      = COALESCE(bts_picks.locked_at, EXCLUDED.locked_at),
             locked         = EXCLUDED.locked,
             result         = CASE WHEN bts_picks.result != 'pending' THEN bts_picks.result ELSE EXCLUDED.result END,
             hits           = CASE WHEN bts_picks.result != 'pending' THEN bts_picks.hits ELSE EXCLUDED.hits END,
             ab             = CASE WHEN bts_picks.result != 'pending' THEN bts_picks.ab ELSE EXCLUDED.ab END,
             graded_at      = CASE WHEN bts_picks.result != 'pending' THEN bts_picks.graded_at ELSE EXCLUDED.graded_at END,
             snapshot       = EXCLUDED.snapshot`,
          [
            date,
            e.playerId,
            e.name ?? (e as any).playerName ?? "",
            e.team ?? "",
            Math.round(e.hitProbability ?? 0),
            e.lockedAt ?? null,
            e.lockedAt != null,
            e.result ?? "pending",
            e.hits ?? null,
            e.ab ?? null,
            e.gradedAt ?? null,
            JSON.stringify(e.snapshot ?? {}),
          ]
        ).catch(() => { /* non-fatal */ });
      }
    }
    // 4. Debounced GitHub sync (best-effort, requires GITHUB_TOKEN)
    if (_btsSyncTimer) clearTimeout(_btsSyncTimer);
    _btsSyncTimer = setTimeout(() => {
      _btsSyncTimer = null;
      syncMLDataToGitHub().catch((e: any) => console.warn("[BTS] GitHub sync error:", e.message));
    }, 30_000);
  }

  // Merge a parsed JSON object into btsPicksCache
  function mergeBtsJSON(parsed: Record<string, any[]>) {
    for (const [date, entries] of Object.entries(parsed)) {
      if (!btsPicksCache[date]) {
        btsPicksCache[date] = entries as BtsPickEntry[];
      } else {
        for (const incoming of entries) {
          const existing = btsPicksCache[date].find((e: BtsPickEntry) => e.playerId === incoming.playerId);
          if (!existing) {
            // New pick not yet in memory — always add it
            btsPicksCache[date].push(incoming);
          } else {
            // Graded result always wins over pending; also keep best snapshot
            if (existing.result === "pending" && incoming.result !== "pending") {
              Object.assign(existing, incoming);
            } else if (existing.result !== "pending" && incoming.result === "pending") {
              // Keep existing graded — only refresh snapshot
              existing.snapshot = incoming.snapshot ?? existing.snapshot;
            } else if (existing.result !== "pending" && incoming.result !== "pending") {
              // Both graded — keep the more recent graded_at
              const existMs = existing.gradedAt ? new Date(existing.gradedAt).getTime() : 0;
              const incomMs = incoming.gradedAt ? new Date(incoming.gradedAt).getTime() : 0;
              if (incomMs > existMs) Object.assign(existing, incoming);
            }
            // Both pending — keep existing (already in memory, no change needed)
          }
        }
      }
    }
  }

  async function loadBtsPicksCache() {
    // 1. Load from Postgres bts_picks table first (most current after any redeploy)
    try {
      const rows = await db.query(`SELECT * FROM bts_picks ORDER BY pick_date DESC`);
      if (rows.rows && rows.rows.length > 0) {
        const fromDB: Record<string, BtsPickEntry[]> = {};
        for (const r of rows.rows) {
          if (!fromDB[r.pick_date]) fromDB[r.pick_date] = [];
          fromDB[r.pick_date].push({
            playerId:       r.player_id,
            name:           r.player_name,
            team:           r.team,
            hitProbability: r.hit_probability,
            lockedAt:       r.locked_at,
            result:         r.result,
            hits:           r.hits,
            ab:             r.ab,
            gradedAt:       r.graded_at,
            // gradedFinal starts false for all DB entries; the grader sets it
            // to true once the game log (authoritative) returns isFinal=true
            gradedFinal:    false,
            snapshot:       r.snapshot ?? {},
          } as BtsPickEntry);
        }
        mergeBtsJSON(fromDB);
        console.log(`[BTS-DB] Loaded ${rows.rows.length} picks from Postgres (${Object.keys(fromDB).length} days)`);
      }
    } catch (e: any) {
      console.warn("[BTS-DB] Could not load from Postgres:", e.message);
    }
    // 2. Also load from JSON file on disk (fills gaps if DB rows are missing)
    try {
      if (fs.existsSync(BTS_PICKS_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(BTS_PICKS_PATH, "utf-8"));
        mergeBtsJSON(parsed);
        console.log(`[BTS] Merged disk bts_picks.json — ${Object.keys(btsPicksCache).length} total days`);
      }
    } catch (e: any) {
      console.warn("[BTS] Failed to load bts_picks.json:", e.message);
    }
    reconcileSeasonRecord();
  }

  // Load persisted BTS picks after the startup pull resolves
  _mlPullPromise.then(() => loadBtsPicksCache()).catch(() => loadBtsPicksCache());

  // ── Grader: fetch actual hit stats for a player on a given date ──────
  // Strategy:
  //   1. MLB game log API (primary) — pinned to exact date
  //   2. MLB schedule → boxscore API (fallback when game log lags by hours)
  //   3. Return null only if genuinely no data available yet
  async function gradePickForDate(playerId: number, dateStr: string): Promise<{ hits: number; ab: number; isFinal: boolean } | null> {
    const normalize = (d: string) => {
      if (!d) return "";
      const mmdd = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (mmdd) return `${mmdd[3]}-${mmdd[1]}-${mmdd[2]}`;
      return d.slice(0, 10);
    };

    // ── Attempt 1: Game log API + game-state cross-check ─────────────
    // The MLB stats game log can return partial mid-game stats as soon as
    // the player has their first PA. We MUST confirm the game is Final
    // before trusting the result — otherwise a player who goes 0-for-1
    // in the 2nd inning gets incorrectly locked as a loss.
    try {
      const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=hitting&season=2026&startDate=${dateStr}&endDate=${dateStr}&limit=5`;
      const r = await axios.get(url, { timeout: 8000 });
      const splits = r.data?.stats?.[0]?.splits ?? [];
      const todaySplit = splits.find((s: any) => normalize(s.date) === dateStr)
                      ?? (splits.length === 1 ? splits[0] : null);
      if (todaySplit) {
        const hits  = parseInt(todaySplit.stat?.hits   ?? "0", 10);
        const ab    = parseInt(todaySplit.stat?.atBats ?? "0", 10);
        const gamePk: number | undefined = todaySplit.game?.gamePk;
        if (ab > 0) {
          // Cross-check: confirm the game is actually Final before locking
          let gameIsFinal = false;
          try {
            if (gamePk) {
              // Schedule API is the most reliable source of game state
              const schedR2 = await axios.get(
                `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${gamePk}`,
                { timeout: 6000 }
              );
              const gameEntry = schedR2.data?.dates?.[0]?.games?.[0];
              if (gameEntry?.status?.abstractGameState === "Final") {
                gameIsFinal = true;
              }
            }
          } catch { /* if check fails, fall through to boxscore */ }
          if (gameIsFinal) {
            return { hits, ab, isFinal: true };
          }
          // Game not yet Final — return current stats as non-final so we keep re-grading
          return { hits, ab, isFinal: false };
        }
      }
    } catch { /* fall through to boxscore */ }

    // ── Attempt 2: Schedule → Boxscore (handles game log lag) ────────
    try {
      const schedUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=team`;
      const schedR   = await axios.get(schedUrl, { timeout: 8000 });
      const gameDates = schedR.data?.dates ?? [];
      const games     = gameDates.flatMap((d: any) => d.games ?? []);

      for (const game of games) {
        const state = game.status?.abstractGameState; // "Preview"|"Live"|"Final"
        if (state === "Preview") continue;
        try {
          const boxUrl = `https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`;
          const boxR   = await axios.get(boxUrl, { timeout: 8000 });
          const teams  = boxR.data?.teams ?? {};
          for (const side of ["home", "away"]) {
            const players = Object.values(teams[side]?.players ?? {}) as any[];
            const p = players.find((pl: any) => pl.person?.id === playerId);
            if (p) {
              const stats = p.stats?.batting ?? {};
              const ab    = parseInt(stats.atBats ?? "-1", 10);
              const hits  = parseInt(stats.hits   ?? "0",  10);
              // Boxscore is ONLY used to detect a mid-game early hit.
              // NEVER mark isFinal=true from boxscore — game log is the only
              // authoritative Final source. A boxscore "Final" can lag or mismatch.
              if (hits > 0 && ab >= 0) {
                return { hits, ab, isFinal: false }; // keep re-grading until game log confirms
              }
              // 0 hits (live or final from boxscore) — return null, wait for game log
            }
          }
        } catch { /* skip this game */ }
      }
    } catch { /* boxscore fallback failed */ }

    return null; // no data yet
  }

  // ── Run grader for all pending picks on a given date ─────────────────
  // forceRegrade=true bypasses all locks and re-grades every pick from the MLB game log.
  // Used by the /api/bts/regrade-all endpoint to correct bad historical grades.
  async function runBtsGrader(dateStr: string, forceRegrade = false) {
    const entries = btsPicksCache[dateStr];
    if (!entries?.length) return;
    let changed = false;
    const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
    const isToday   = dateStr === todayStr;

    // Dates within 2 days of today that may still have unresolved picks
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toLocaleDateString("en-CA");
    const isRecent = dateStr >= twoDaysAgo;

    for (const entry of entries) {
      if (!forceRegrade) {
        const alreadyGraded = entry.result !== "pending";
        const lockedFinal   = (entry as any).gradedFinal === true;

        if (alreadyGraded) {
          // Wins locked as final — never touch again
          if (entry.result === "win" && lockedFinal) continue;
          // Historical non-recent dates — only re-check if not yet locked
          if (!isRecent && lockedFinal) continue;
          // Recent loss that was graded non-final — ALWAYS re-check.
          // A player graded mid-game as 0-for-1 must keep re-grading until
          // the game is confirmed Final by the schedule API.
          if (entry.result === "loss" && !lockedFinal) { /* fall through to re-grade */ }
          // Fully locked historical pick — skip
          else if (!isToday && lockedFinal) continue;
          // Today — skip only wins already locked final
          else if (isToday && entry.result === "win" && lockedFinal) continue;
        }
      }
      // Only try grading if the game start time has passed
      const gameStartMs = entry.snapshot?.game?.gameStartMs;
      if (gameStartMs && Date.now() < gameStartMs) continue;
      const result = await gradePickForDate(entry.playerId, dateStr);
      if (result === null) continue; // no data yet — stay pending
      // Require at least 1 AB to update (ab=0 mid-game = hasn't batted yet)
      if (result.ab === 0) continue;

      // KEY RULE:
      //   WIN  → lock immediately (a hit can only stay or go up, never removed)
      //   LOSS → ONLY write when game is confirmed Final.
      //          While game is Live with 0 hits, keep result=pending but
      //          still update hits/ab so the live stat line shows correctly.
      const wouldBeWin = result.hits > 0;
      const newResult = wouldBeWin ? "win" : (result.isFinal ? "loss" : "pending");

      // Determine what changed
      const alreadyFinal = (entry as any).gradedFinal === true;
      const hitsChanged   = entry.hits !== result.hits || entry.ab !== result.ab;
      const resultChanged = entry.result !== newResult;
      if (!hitsChanged && !resultChanged && (alreadyFinal || !result.isFinal)) continue;

      // Always update live hit/ab counters so the card shows current stats
      entry.hits  = result.hits;
      entry.ab    = result.ab;
      entry.gradedAt = new Date().toISOString();

      // Only overwrite result if it actually changes to something meaningful
      if (resultChanged) entry.result = newResult;

      // Lock gradedFinal=true only when confirmed final
      if (result.isFinal) (entry as any).gradedFinal = true;

      changed = true;
      console.log(`[BTS Regrader] ${entry.name} -> ${newResult} (${result.hits}/${result.ab}) isFinal=${result.isFinal}`);

      // forceRegrade: bypass ON CONFLICT guard with a direct UPDATE
      if (forceRegrade && result.isFinal) {
        db.query(
          `UPDATE bts_picks SET result=$1, hits=$2, ab=$3, graded_at=$4
           WHERE pick_date=$5 AND player_id=$6`,
          [newResult, result.hits, result.ab, entry.gradedAt, dateStr, entry.playerId]
        ).catch(() => { /* non-fatal */ });
      }

      // ── Back-fill outcome into daily candidate log ─────────────────
      try {
        const logDir  = path.join(__dirname, "bts_logs");
        const logPath = path.join(logDir, `${dateStr}.json`);
        if (fs.existsSync(logPath)) {
          const logData: any[] = JSON.parse(fs.readFileSync(logPath, "utf8"));
          const logEntry = logData.find((e: any) => e.playerId === entry.playerId);
          if (logEntry) {
            logEntry.result  = entry.result;
            logEntry.hits    = entry.hits;
            logEntry.ab      = entry.ab;
            logEntry.gradedAt = entry.gradedAt;
            fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
          }
        }
      } catch { /* non-fatal */ }
    }
    if (changed) {
      reconcileSeasonRecord();
      saveBtsPicksCache();
      // Keep CIQ streak in sync — deferred so hoisted functions are available
      setTimeout(async () => {
        try {
          const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
          const todayStr = `${ct.getFullYear()}-${String(ct.getMonth()+1).padStart(2,"0")}-${String(ct.getDate()).padStart(2,"0")}`;
          if (dateStr === todayStr && ciqStreakState.lastPickDate !== todayStr) {
            await selectCiqStreakPicksForDate(todayStr).catch(() => {});
          }
          // Always try to grade — handles carry-over players not in btsPicksCache
          await gradeCiqStreakForDate(dateStr);
        } catch { /* non-fatal */ }
      }, 0);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // BTS ML LEARNING — nightly feature-correlation analysis
  // Reads all graded bts_picks + bts_logs feature entries.
  // For each feature, computes correlation with hit outcome (win=1 / loss=0).
  // Outputs bts_ml_weights.json with adjusted multipliers for scoreHitter.
  // Synced to GitHub so weights survive redeploys.
  // ─────────────────────────────────────────────────────────────────────
  const BTS_ML_WEIGHTS_FILE = path.join(ML_DATA_DIR, "bts_ml_weights.json");
  const BTS_ML_LEARNING_LOG = path.join(ML_DATA_DIR, "bts_ml_learning_log.json");

  function getDefaultBtsMlWeights() {
    return {
      version: 1,
      sampleSize: 0,
      updatedAt: new Date().toISOString(),
      featureWeights: {
        recentForm:       1.00,
        contactQuality:   1.00,
        hardContact:      1.00,
        pitcherMatchup:   1.00,
        opportunity:      1.00,
        bvp:              1.00,
        stability:        1.00,
        weatherImpact:    1.00,
        gameTotal:        1.00,
      } as Record<string, number>,
      featureAccuracy: {} as Record<string, { wins: number; losses: number; accuracy: number }>,
      tierAccuracy: {} as Record<string, { wins: number; losses: number; accuracy: number }>,
      calibration: [] as Array<{ bucket: string; predicted: number; actual: number; n: number }>,
    };
  }

  function loadBtsMlWeights() {
    try {
      if (fs.existsSync(BTS_ML_WEIGHTS_FILE)) {
        return JSON.parse(fs.readFileSync(BTS_ML_WEIGHTS_FILE, "utf-8"));
      }
    } catch { /* use defaults */ }
    return getDefaultBtsMlWeights();
  }

  async function runBtsMlLearning(): Promise<void> {
    console.log("[BTS-ML] Starting nightly ML learning run...");
    try {
      // 1. Collect all graded picks from btsPicksCache (attach date from cache key)
      const gradedPicks: Array<BtsPickEntry & { date: string }> = [];
      for (const [date, entries] of Object.entries(btsPicksCache)) {
        for (const e of entries) {
          if (e.result === "win" || e.result === "loss") gradedPicks.push({ ...e, date });
        }
      }
      if (gradedPicks.length < 10) {
        console.log(`[BTS-ML] Only ${gradedPicks.length} graded picks — skipping (need 10+)`);
        return;
      }
      console.log(`[BTS-ML] Analyzing ${gradedPicks.length} graded picks...`);

      // 2. Load feature logs from bts_logs/
      const logDir = path.join(__dirname, "bts_logs");
      const featureMap: Record<number, any> = {};
      if (fs.existsSync(logDir)) {
        const logFiles = fs.readdirSync(logDir)
          .filter((f: string) => f.endsWith(".json"))
          .sort();
        for (const lf of logFiles) {
          try {
            const entries: any[] = JSON.parse(fs.readFileSync(path.join(logDir, lf), "utf-8"));
            for (const e of entries) { featureMap[e.playerId] = e; }
          } catch { /* skip corrupt log */ }
        }
      }
      console.log(`[BTS-ML] Loaded feature logs for ${Object.keys(featureMap).length} unique players`);

      // 3. Merge picks with feature logs
      const logDirExists = fs.existsSync(logDir);
      const enrichedPicks: Array<{ outcome: 1|0; features: any; tier: string }> = [];
      for (const pick of gradedPicks) {
        const outcome: 1|0 = pick.result === "win" ? 1 : 0;
        let featureEntry: any = null;
        if (logDirExists) {
          const dateLogPath = path.join(logDir, `${pick.date}.json`);
          if (fs.existsSync(dateLogPath)) {
            try {
              const dayLog: any[] = JSON.parse(fs.readFileSync(dateLogPath, "utf-8"));
              featureEntry = dayLog.find((e: any) => e.playerId === pick.playerId) ?? null;
            } catch { /* fallback to featureMap */ }
          }
        }
        if (!featureEntry) featureEntry = featureMap[pick.playerId] ?? null;
        enrichedPicks.push({
          outcome,
          tier: (pick as any).confidenceTier ?? featureEntry?.confTier ?? "D",
          features: featureEntry ?? {
            hitProbability: pick.hitProbability,
            rawScore:       pick.rawScore,
            avg14:          pick.avg14,
            avg30:          pick.avg30,
            xwoba:          (pick as any).xwoba ?? null,
            xba:            (pick as any).xba   ?? null,
            hardHitPct:     (pick as any).hardHitPct ?? null,
            kPct:           (pick as any).kPct ?? null,
            pitcherXwoba:   (pick as any).pitcherXwoba ?? null,
            pitcherLast3ERA:(pick as any).pitcherLast3ERA ?? null,
            gameTotal:      (pick as any).gameTotal ?? null,
            lineupSlot:     (pick as any).lineupSlot ?? null,
          },
        });
      }

      // 4. Compute point-biserial correlation for each feature
      const computeCorrelation = (values: number[], outcomes: (1|0)[]): number => {
        const n = values.length;
        if (n < 5) return 0;
        const n1 = outcomes.filter(o => o === 1).length;
        const n0 = n - n1;
        if (n1 === 0 || n0 === 0) return 0;
        const avg = values.reduce((a, b) => a + b, 0) / n;
        const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
        const std = Math.sqrt(variance);
        if (std < 0.001) return 0;
        const m1 = values.filter((_, i) => outcomes[i] === 1).reduce((a, b) => a + b, 0) / n1;
        const m0 = values.filter((_, i) => outcomes[i] === 0).reduce((a, b) => a + b, 0) / n0;
        return (m1 - m0) / std * Math.sqrt((n1 * n0) / (n * n));
      };
      const extractFeature = (key: string, transform?: (v: number) => number) => {
        const vals: number[] = [];
        const outs: (1|0)[] = [];
        for (const { features, outcome } of enrichedPicks) {
          const raw = features?.[key];
          if (raw == null || isNaN(+raw)) continue;
          vals.push(transform ? transform(+raw) : +raw);
          outs.push(outcome);
        }
        return { vals, outs };
      };

      type FeatureDef = { name: string; keys: string[]; transform?: (v: number) => number };
      const featureDefs: FeatureDef[] = [
        { name: "recentForm",     keys: ["avg14", "avg30"] },
        { name: "contactQuality", keys: ["xwoba", "xba", "xwoba15d", "xwoba30d"] },
        { name: "hardContact",    keys: ["hardHitPct", "barrelPct"] },
        { name: "pitcherMatchup", keys: ["pitcherXwoba", "pitcherLast3ERA", "pitchTypeMatchup"] },
        { name: "opportunity",    keys: ["lineupSlot"], transform: (v) => 10 - v },
        { name: "bvp",            keys: [] },
        { name: "stability",      keys: ["ghp14"] },
        { name: "weatherImpact",  keys: ["hitterImpact"] },
        { name: "gameTotal",      keys: ["gameTotal"] },
      ];

      const featureCorrelations: Record<string, { corr: number; n: number; wins: number; losses: number }> = {};
      for (const { name, keys, transform } of featureDefs) {
        if (keys.length === 0) { featureCorrelations[name] = { corr: 0, n: 0, wins: 0, losses: 0 }; continue; }
        const corrVals: number[] = [];
        let maxN = 0, totalWins = 0, totalLosses = 0;
        for (const key of keys) {
          const { vals, outs } = extractFeature(key, transform);
          if (vals.length < 5) continue;
          corrVals.push(computeCorrelation(vals, outs));
          maxN = Math.max(maxN, vals.length);
          totalWins   += outs.filter(o => o === 1).length;
          totalLosses += outs.filter(o => o === 0).length;
        }
        featureCorrelations[name] = {
          corr:   corrVals.length > 0 ? corrVals.reduce((a, b) => a + b, 0) / corrVals.length : 0,
          n:      maxN,
          wins:   Math.round(totalWins   / Math.max(1, keys.length)),
          losses: Math.round(totalLosses / Math.max(1, keys.length)),
        };
      }

      // 5. Convert correlations to multiplier adjustments
      const existing = loadBtsMlWeights();
      const dampFactor = gradedPicks.length >= 200 ? 0.25
                       : gradedPicks.length >= 50  ? 0.15
                       : 0.08;
      const newFeatureWeights: Record<string, number> = { ...(existing.featureWeights ?? {}) };
      for (const [fname, { corr }] of Object.entries(featureCorrelations)) {
        const oldW = newFeatureWeights[fname] ?? 1.00;
        const delta = corr * dampFactor;
        const rawNew = oldW * (1 + delta);
        newFeatureWeights[fname] = Math.round(Math.min(1.35, Math.max(0.70, rawNew)) * 1000) / 1000;
      }

      // 6. Tier accuracy
      const tierCounts: Record<string, { wins: number; losses: number }> = {};
      for (const { outcome, tier } of enrichedPicks) {
        if (!tierCounts[tier]) tierCounts[tier] = { wins: 0, losses: 0 };
        if (outcome === 1) tierCounts[tier].wins++; else tierCounts[tier].losses++;
      }
      const tierAccuracy: Record<string, any> = {};
      for (const [tier, { wins, losses }] of Object.entries(tierCounts)) {
        const total = wins + losses;
        tierAccuracy[tier] = { wins, losses, accuracy: total > 0 ? Math.round(wins / total * 1000) / 10 : 0 };
      }

      // 7. Feature accuracy by median split
      const featureAccuracy: Record<string, any> = {};
      for (const { name, keys } of featureDefs) {
        if (keys.length === 0) continue;
        const { vals, outs } = extractFeature(keys[0]);
        if (vals.length < 5) continue;
        const sorted = [...vals].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        let aW = 0, aL = 0, bW = 0, bL = 0;
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] >= median) { outs[i] === 1 ? aW++ : aL++; }
          else                   { outs[i] === 1 ? bW++ : bL++; }
        }
        const at = aW + aL, bt = bW + bL;
        featureAccuracy[name] = {
          wins:          aW,
          losses:        aL,
          accuracy:      at > 0 ? Math.round(aW / at * 1000) / 10 : 0,
          belowAccuracy: bt > 0 ? Math.round(bW / bt * 1000) / 10 : 0,
          correlation:   Math.round((featureCorrelations[name]?.corr ?? 0) * 1000) / 1000,
        };
      }

      // 8. Probability calibration buckets
      const buckets: Record<string, { n: number; wins: number; sumProb: number }> = {};
      for (const { outcome, features } of enrichedPicks) {
        const prob = features?.hitProbability;
        if (prob == null || isNaN(+prob)) continue;
        const p = +prob;
        const bucket = p >= 80 ? "80+" : p >= 75 ? "75-80" : p >= 70 ? "70-75" : p >= 65 ? "65-70" : "<65";
        if (!buckets[bucket]) buckets[bucket] = { n: 0, wins: 0, sumProb: 0 };
        buckets[bucket].n++;
        buckets[bucket].wins += outcome;
        buckets[bucket].sumProb += p;
      }
      const calibration = Object.entries(buckets)
        .map(([bucket, { n, wins, sumProb }]) => ({
          bucket,
          predicted: Math.round(sumProb / n * 10) / 10,
          actual:    Math.round(wins / n * 1000) / 10,
          n,
        }))
        .sort((a, b) => b.predicted - a.predicted);

      // 9. Write bts_ml_weights.json
      const updated = {
        version:         (existing.version ?? 0) + 1,
        sampleSize:      gradedPicks.length,
        updatedAt:       new Date().toISOString(),
        featureWeights:  newFeatureWeights,
        featureAccuracy,
        tierAccuracy,
        calibration,
        rawCorrelations: featureCorrelations,
        dampFactor,
      };
      fs.writeFileSync(BTS_ML_WEIGHTS_FILE, JSON.stringify(updated, null, 2), "utf-8");
      console.log(`[BTS-ML] Weights updated (v${updated.version}) — sample=${gradedPicks.length}`);

      // 10. Append to learning log (keep last 90 runs)
      const logEntries: any[] = [];
      try {
        if (fs.existsSync(BTS_ML_LEARNING_LOG)) {
          const parsed = JSON.parse(fs.readFileSync(BTS_ML_LEARNING_LOG, "utf-8"));
          if (Array.isArray(parsed)) logEntries.push(...parsed);
        }
      } catch { /* start fresh */ }
      logEntries.push({
        runAt:          updated.updatedAt,
        version:        updated.version,
        sampleSize:     gradedPicks.length,
        featureWeights: newFeatureWeights,
        tierAccuracy,
        topInsight: Object.entries(featureAccuracy)
          .sort((a: any, b: any) => (b[1].correlation ?? 0) - (a[1].correlation ?? 0))
          .slice(0, 3)
          .map(([name, data]: any) => `${name}: corr=${data.correlation}, acc=${data.accuracy}%`)
          .join(" | "),
      });
      fs.writeFileSync(BTS_ML_LEARNING_LOG, JSON.stringify(logEntries.slice(-90), null, 2), "utf-8");

      // 11. Sync everything to GitHub
      await syncMLDataToGitHub();
      console.log("[BTS-ML] Learning run complete and synced to GitHub");
    } catch (e: any) {
      console.error("[BTS-ML] Learning run failed:", e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/bts/live-stats  — Lightweight endpoint: returns only result/hits/ab
  // from the in-memory cache. No MLB API calls. Safe to poll every 30s.
  // ─────────────────────────────────────────────────────────────────────
  app.get("/api/bts/live-stats", async (_req, res) => {
    try {
      const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const todayStr = `${ct.getFullYear()}-${String(ct.getMonth()+1).padStart(2,"0")}-${String(ct.getDate()).padStart(2,"0")}`;
      const entries = btsPicksCache[todayStr] ?? [];
      res.json({
        date: todayStr,
        picks: entries.map(e => ({
          playerId: e.playerId,
          name:     e.name,
          result:   e.result,
          hits:     e.hits  ?? null,
          ab:       e.ab    ?? null,
          gradedAt: e.gradedAt ?? null,
          gradedFinal: (e as any).gradedFinal ?? null,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/bts-picks  — Beat‑the‑Streak daily hitter recommendations
  // ─────────────────────────────────────────────────────────────────────
  app.get("/api/bts-picks", async (req, res) => {
    try {
      // Always derive today's date in Central Time (CT) so that after midnight
      // UTC but before midnight CT we don't accidentally serve tomorrow's slate.
      const ctNowForDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const ctDateStr = [
        ctNowForDate.getFullYear(),
        String(ctNowForDate.getMonth() + 1).padStart(2, "0"),
        String(ctNowForDate.getDate()).padStart(2, "0"),
      ].join("-");
      const targetDate = (req.query.date as string) || ctDateStr;

      // ── 8 AM CT gate: don't populate picks before 8:00 AM Central ─────
      // Only enforce the gate when the date isn't being overridden by query param.
      if (!req.query.date) {
        const ctGateHour = ctNowForDate.getHours();
        const ctGateMin  = ctNowForDate.getMinutes();
        if (ctGateHour < 8) {
          return res.json({
            date: targetDate,
            slate: [],
            picks: [],
            todayRecord:  { wins: 0, losses: 0, pending: 0, winPct: null },
            seasonRecord: { wins: btsSeasonRecord.wins, losses: btsSeasonRecord.losses, winPct: null },
            message: `BTS picks are available starting at 8:00 AM CT. Check back in ${8 - ctGateHour - (ctGateMin > 0 ? 1 : 0)}h ${ctGateMin > 0 ? 60 - ctGateMin : 0}m.`,
          });
        }
      }

      // ── 1. MLB Schedule (probable pitchers, lineups, venue) ──────────
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${targetDate}&hydrate=probablePitcher,lineups,linescore,venue,weather,team`;
      const schedResp = await axios.get(scheduleUrl);
      const schedDates = schedResp.data?.dates ?? [];
      const games: any[] = schedDates[0]?.games ?? [];
      console.log(`[BTS] date=${targetDate} games=${games.length} ctHour=${ctNowForDate.getHours()}:${ctNowForDate.getMinutes()}`);

      if (!games.length) {
        return res.json({ date: targetDate, slate: [], picks: [], error: "No MLB games scheduled" });
      }

      // ── 2. ESPN odds → game totals per matchup ──────────────────────
      // ESPN scoreboard gives us event IDs; then fetch odds per event
      const espnBoard = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${targetDate.replace(/-/g, "")}`);
      const espnEvents: any[] = espnBoard.data?.events ?? [];
      const espnOddsMap: Record<string, number> = {}; // "AWAY_HOME" -> total
      for (const ev of espnEvents) {
        try {
          const comp = ev.competitions?.[0];
          const eventId = comp?.id;
          if (!eventId) continue;
          const oddsResp = await axios.get(
            `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${eventId}/competitions/${eventId}/odds`
          );
          const oddsItems: any[] = oddsResp.data?.items ?? [];
          const total = oddsItems[0]?.overUnder;
          if (total) {
            const teams = comp.competitors?.map((c: any) => c.team?.abbreviation?.toUpperCase()) ?? [];
            const key = teams.sort().join("_");
            espnOddsMap[key] = parseFloat(total);
          }
        } catch { /* skip */ }
      }

      // ── Shared CSV parser (handles quoted fields containing commas) ──
      function parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let cur = "", inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === "," && !inQuote) { result.push(cur.trim()); cur = ""; }
          else { cur += ch; }
        }
        result.push(cur.trim());
        return result;
      }

      // ── 3. Baseball Savant Statcast leaderboard (expanded: xBA, xwOBA, HH%, barrel%, EV50, LA, BABIP) ──
      let savantMap: Record<string, any> = {}; // keyed by mlbam player_id
      try {
        const savantResp = await axios.get(
          `https://baseballsavant.mlb.com/leaderboard/custom?year=2026&type=batter&filter=&sort=4&sortDir=desc&min=1&selections=xba,xwoba,exit_velocity_avg,hard_hit_percent,barrel_batted_rate,launch_angle_avg,babip,xbabip,bb_percent,k_percent,whiff_percent,z_contact_percent,oz_contact_percent,sprint_speed&csv=true`,
          { headers: { "Accept": "text/csv" } }
        );
        const csvText: string = savantResp.data;
        const lines = csvText.replace(/^\uFEFF/, "").split("\n");
        const header = parseCSVLine(lines[0]); // quoted-field-aware split
        // Find player_id column index dynamically (robust against column order changes)
        const pidColIdx = header.indexOf("player_id");
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const row = parseCSVLine(line);
          if (row.length < 4) continue;
          const obj: any = {};
          header.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
          const pid = pidColIdx >= 0 ? (row[pidColIdx] ?? "").trim() : "";
          if (pid && !isNaN(Number(pid))) savantMap[pid] = obj;
        }
      } catch { /* savant unavailable */ }

      // ── 3b. Baseball Savant pitcher leaderboard (expanded: xBA, xwOBA, HH%, barrel%, GB%, FB%) ──
      let pitcherSavantMap: Record<string, any> = {}; // keyed by mlbam player_id
      try {
        const pSavantResp = await axios.get(
          `https://baseballsavant.mlb.com/leaderboard/custom?year=2026&type=pitcher&filter=&sort=4&sortDir=desc&min=1&selections=xba,xwoba,exit_velocity_avg,hard_hit_percent,barrel_batted_rate,groundballs_percent,flyballs_percent,bb_percent,k_percent,whiff_percent,p_swinging_strike_perc&csv=true`,
          { headers: { "Accept": "text/csv" } }
        );
        const pCsvText: string = pSavantResp.data;
        const pLines = pCsvText.replace(/^\uFEFF/, "").split("\n");
        const pHeader = parseCSVLine(pLines[0]); // quoted-field-aware split
        const pPidColIdx = pHeader.indexOf("player_id");
        for (let i = 1; i < pLines.length; i++) {
          const line = pLines[i].trim();
          if (!line) continue;
          const row = parseCSVLine(line);
          if (row.length < 4) continue;
          const obj: any = {};
          pHeader.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
          const pid = pPidColIdx >= 0 ? (row[pPidColIdx] ?? "").trim() : "";
          if (pid && !isNaN(Number(pid))) pitcherSavantMap[pid] = obj;
        }
      } catch { /* pitcher savant unavailable */ }

      // ── 3b2. Statcast rolling 15d window (batter) — xBA/xwOBA/HH%/barrel% ──
      // Captures recent hot/cold streaks that season averages obscure.
      // Blended with season in scoreHitter: 40% rolling-15d + 60% season
      let savantMap15d: Record<string, any> = {};
      try {
        const now15d  = new Date(); now15d.setDate(now15d.getDate() - 15);
        const s15d    = now15d.toISOString().slice(0, 10);
        const e15d    = new Date().toISOString().slice(0, 10);
        const r15 = await axios.get(
          `https://baseballsavant.mlb.com/leaderboard/custom?year=2026&type=batter&filter=&sort=4&sortDir=desc&min=1&startDate=${s15d}&endDate=${e15d}&selections=xba,xwoba,hard_hit_percent,barrel_batted_rate,whiff_percent,z_contact_percent&csv=true`,
          { headers: { "Accept": "text/csv" } }
        );
        const lines15 = (r15.data as string).replace(/^\uFEFF/, "").split("\n");
        const hdr15   = parseCSVLine(lines15[0]);
        const pid15   = hdr15.indexOf("player_id");
        for (let i = 1; i < lines15.length; i++) {
          const line = lines15[i].trim(); if (!line) continue;
          const row  = parseCSVLine(line); if (row.length < 4) continue;
          const obj: any = {}; hdr15.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
          const pid = pid15 >= 0 ? (row[pid15] ?? "").trim() : "";
          if (pid && !isNaN(Number(pid))) savantMap15d[pid] = obj;
        }
      } catch { /* rolling 15d unavailable — fall back to season */ }

      // ── 3b3. Statcast rolling 30d window (batter) ──
      let savantMap30d: Record<string, any> = {};
      try {
        const now30d  = new Date(); now30d.setDate(now30d.getDate() - 30);
        const s30d    = now30d.toISOString().slice(0, 10);
        const e30d    = new Date().toISOString().slice(0, 10);
        const r30 = await axios.get(
          `https://baseballsavant.mlb.com/leaderboard/custom?year=2026&type=batter&filter=&sort=4&sortDir=desc&min=1&startDate=${s30d}&endDate=${e30d}&selections=xba,xwoba,hard_hit_percent,barrel_batted_rate,whiff_percent,z_contact_percent&csv=true`,
          { headers: { "Accept": "text/csv" } }
        );
        const lines30 = (r30.data as string).replace(/^\uFEFF/, "").split("\n");
        const hdr30   = parseCSVLine(lines30[0]);
        const pid30   = hdr30.indexOf("player_id");
        for (let i = 1; i < lines30.length; i++) {
          const line = lines30[i].trim(); if (!line) continue;
          const row  = parseCSVLine(line); if (row.length < 4) continue;
          const obj: any = {}; hdr30.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
          const pid = pid30 >= 0 ? (row[pid30] ?? "").trim() : "";
          if (pid && !isNaN(Number(pid))) savantMap30d[pid] = obj;
        }
      } catch { /* rolling 30d unavailable — fall back to season */ }

      // ── 3c. Helper: fetch pitcher season stats + last-5 starts ERA ──
      const pitcherSeasonCache: Record<number, any> = {};
      async function getPitcherSeasonStats(pitcherId: number) {
        if (pitcherSeasonCache[pitcherId]) return pitcherSeasonCache[pitcherId];
        try {
          const [rSeason, rLog] = await Promise.allSettled([
            axios.get(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching&season=2026`),
            axios.get(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=2026&limit=5`),
          ]);
          const stat   = rSeason.status === "fulfilled" ? (rSeason.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}) : {};
          const splits = rLog.status === "fulfilled"    ? (rLog.value.data?.stats?.[0]?.splits ?? [])              : [];

          const ip    = parseFloat(stat.inningsPitched ?? "0") || 0;
          const er    = parseInt(stat.earnedRuns ?? "0") || 0;
          const so    = parseInt(stat.strikeOuts ?? "0") || 0;
          const bb    = parseInt(stat.baseOnBalls ?? "0") || 0;
          const hits  = parseInt(stat.hits ?? "0") || 0;
          const era   = ip > 0 ? parseFloat(((er * 9) / ip).toFixed(2)) : null;
          const k9    = ip > 0 ? parseFloat(((so * 9) / ip).toFixed(1)) : null;
          const whip  = ip > 0 ? parseFloat(((bb + hits) / ip).toFixed(2)) : null;

          // Last-5 starts ERA
          let last5ERA: number | null = null;
          // Last-3 starts: IP trend + ERA (Phase 2) — used for leash probability
          let last3ERA: number | null = null;
          let last3AvgIP: number | null = null;   // avg innings per start last 3
          let last3H9: number | null = null;       // hits/9 last 3 starts (hittability)
          let leashProbability: number = 0.85;     // prob pitcher goes 5+ IP (default starter)
          if (splits.length >= 2) {
            const last5 = splits.slice(0, 5);
            const l5er  = last5.reduce((s: number, g: any) => s + (parseInt(g.stat?.earnedRuns ?? "0") || 0), 0);
            const l5ip  = last5.reduce((s: number, g: any) => s + (parseFloat(g.stat?.inningsPitched ?? "0") || 0), 0);
            last5ERA = l5ip > 0 ? parseFloat(((l5er * 9) / l5ip).toFixed(2)) : null;

            // ── Phase 2: last-3 starts deeper analysis ───────────────────
            const last3 = splits.slice(0, 3);
            const l3er  = last3.reduce((s: number, g: any) => s + (parseInt(g.stat?.earnedRuns ?? "0") || 0), 0);
            const l3ip  = last3.reduce((s: number, g: any) => s + (parseFloat(g.stat?.inningsPitched ?? "0") || 0), 0);
            const l3h   = last3.reduce((s: number, g: any) => s + (parseInt(g.stat?.hits ?? "0") || 0), 0);
            last3ERA    = l3ip > 0 ? parseFloat(((l3er * 9) / l3ip).toFixed(2)) : null;
            last3AvgIP  = last3.length > 0 ? parseFloat((l3ip / last3.length).toFixed(1)) : null;
            last3H9     = l3ip > 0 ? parseFloat(((l3h * 9) / l3ip).toFixed(1)) : null;

            // ── Leash probability: likelihood pitcher goes 5+ IP ────────
            // Key signals: recent avg IP, recent ERA trend, total season IP
            // Low leash = more bullpen exposure = more PA opportunities for batters
            if (last3AvgIP !== null) {
              if (last3AvgIP >= 6.0) leashProbability = 0.92;        // ace-level workload
              else if (last3AvgIP >= 5.0) leashProbability = 0.80;   // average
              else if (last3AvgIP >= 4.0) leashProbability = 0.60;   // short leash
              else leashProbability = 0.40;                           // likely bullpen game soon
            }
            // Adjust for recent ERA trend — struggling starters get shorter leash
            if (last3ERA !== null && last3ERA > 5.5) leashProbability -= 0.15;
            else if (last3ERA !== null && last3ERA < 3.0) leashProbability += 0.08;
            leashProbability = Math.max(0.20, Math.min(0.95, leashProbability));
          }

          const result = { era, k9, whip, ip, last5ERA, last3ERA, last3AvgIP, last3H9, leashProbability };
          pitcherSeasonCache[pitcherId] = result;
          return result;
        } catch { return { era: null, k9: null, whip: null, ip: 0, last5ERA: null, last3ERA: null, last3AvgIP: null, last3H9: null, leashProbability: 0.85 }; }
      }

      // ── 4. Helper: fetch pitcher vs LHB/RHB splits (BA + xwOBA + PA count) ──
      async function getPitcherSplits(pitcherId: number) {
        try {
          const r = await axios.get(
            `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=2026&sitCodes=vl,vr`
          );
          const result: Record<string, any> = {
            vsLeft: 0.250, vsRight: 0.250,
            vsLeftPA: 0,   vsRightPA: 0,
            vsLeftXwoba: null, vsRightXwoba: null,
          };
          for (const stat of r.data?.stats ?? []) {
            for (const sp of stat?.splits ?? []) {
              const desc = sp.split?.description ?? "";
              const avg  = parseFloat(sp.stat?.avg ?? "0");
              const pa   = parseInt(sp.stat?.plateAppearances ?? sp.stat?.atBats ?? "0");
              if (pa < 5) continue; // too few PA — unreliable
              if (desc.includes("Left"))  { result.vsLeft  = avg; result.vsLeftPA  = pa; }
              if (desc.includes("Right")) { result.vsRight = avg; result.vsRightPA = pa; }
            }
          }
          return result;
        } catch { return { vsLeft: 0.250, vsRight: 0.250, vsLeftPA: 0, vsRightPA: 0, vsLeftXwoba: null, vsRightXwoba: null }; }
      }

      // ── 4b2. Helper: pitch arsenal matchup (Phase 2) ──────────────────
      // Fetches pitcher's primary pitch types + batter wOBA vs each.
      // Pitch types: FF (4-seam), SL (slider), CH (changeup), CU (curve), SI (sinker), FC (cutter)
      // Returns a weighted "pitchTypeMatchupScore" 0-1 (higher = batter-favorable matchup)
      const pitchArsenalCache: Record<string, any> = {};
      async function getPitchArsenalMatchup(pitcherId: number, batterId: number, bats: string): Promise<number | null> {
        const cacheKey = `${pitcherId}_${batterId}_${bats}`;
        if (pitchArsenalCache[cacheKey] !== undefined) return pitchArsenalCache[cacheKey];
        try {
          // Step 1: Get pitcher arsenal (pitch types + usage %)
          const pitchTypes = ["FF", "SL", "CH", "CU", "SI", "FC"];
          const arsenalResults: Array<{ type: string; usage: number; pitcherWoba: number }> = [];

          for (const pt of pitchTypes) {
            try {
              const r = await axios.get(
                `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&pitchType=${pt}&year=2026&team=&min=1&sort=run_value_per_100&sortDir=desc&csv=true`,
                { headers: { "Accept": "text/csv" }, timeout: 5000 }
              );
              const lines = (r.data as string).replace(/^\uFEFF/, "").split("\n");
              const hdr   = parseCSVLine(lines[0]);
              const pidIdx  = hdr.indexOf("player_id");
              const usageIdx = hdr.indexOf("pitch_usage");
              const wobaIdx  = hdr.indexOf("woba");
              if (pidIdx < 0) continue;
              for (let i = 1; i < lines.length; i++) {
                const ln = lines[i].trim(); if (!ln) continue;
                const row = parseCSVLine(ln);
                const pid = (row[pidIdx] ?? "").trim();
                if (pid !== String(pitcherId)) continue;
                const usage = parseFloat(row[usageIdx] ?? "0") || 0;
                const woba  = parseFloat(row[wobaIdx]  ?? "0") || 0;
                if (usage > 5) arsenalResults.push({ type: pt, usage, pitcherWoba: woba });
                break;
              }
            } catch { /* skip this pitch type */ }
          }

          if (!arsenalResults.length) { pitchArsenalCache[cacheKey] = null; return null; }

          // Step 2: Get batter wOBA vs each pitch type
          const totalUsage = arsenalResults.reduce((s, a) => s + a.usage, 0) || 100;
          let weightedScore = 0;
          let weightSum = 0;

          for (const arsenal of arsenalResults) {
            const weight = arsenal.usage / totalUsage;
            try {
              const rb = await axios.get(
                `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=batter&pitchType=${arsenal.type}&year=2026&team=&min=1&sort=woba&sortDir=desc&csv=true`,
                { headers: { "Accept": "text/csv" } }
              );
              const bLines = (rb.data as string).replace(/^\uFEFF/, "").split("\n");
              const bHdr   = parseCSVLine(bLines[0]);
              const bPidIdx  = bHdr.indexOf("player_id");
              const bWobaIdx = bHdr.indexOf("woba");
              if (bPidIdx < 0) { weightedScore += weight * 0.320; weightSum += weight; continue; }
              let batterWoba: number | null = null;
              for (let i = 1; i < bLines.length; i++) {
                const ln = bLines[i].trim(); if (!ln) continue;
                const row = parseCSVLine(ln);
                const pid = (row[bPidIdx] ?? "").trim();
                if (pid !== String(batterId)) continue;
                batterWoba = parseFloat(row[bWobaIdx] ?? "0") || null;
                break;
              }
              // Score: batter wOBA vs this pitch type, norm 0.200-0.500
              const matchupScore = batterWoba !== null
                ? Math.max(0, Math.min(1, (batterWoba - 0.200) / 0.300))
                : 0.40; // neutral fallback
              weightedScore += weight * matchupScore;
              weightSum     += weight;
            } catch { weightedScore += weight * 0.40; weightSum += weight; }
          }

          const finalScore = weightSum > 0 ? weightedScore / weightSum : null;
          pitchArsenalCache[cacheKey] = finalScore;
          return finalScore;
        } catch { pitchArsenalCache[cacheKey] = null; return null; }
      }

      // ── 4b. Helper: Batter vs Pitcher career history ────────────────
      const bvpCache: Record<string, any> = {};
      async function getBvP(hitterId: number, pitcherId: number): Promise<{
        avg: number | null; hits: number; ab: number;
        obp: number | null; slg: number | null; ops: number | null;
        signal: "elite" | "strong" | "weak" | "none";
      }> {
        const cacheKey = `${hitterId}_${pitcherId}`;
        if (bvpCache[cacheKey]) return bvpCache[cacheKey];
        try {
          const r = await axios.get(
            `https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=vsPlayer&group=hitting&season=2026&opposingPlayerId=${pitcherId}`
          );
          // Try career splits too
          const rCareer = await axios.get(
            `https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=vsPlayerTotal&group=hitting&opposingPlayerId=${pitcherId}`
          ).catch(() => null);

          const seasonSplit = r.data?.stats?.[0]?.splits?.[0]?.stat;
          const careerSplit = rCareer?.data?.stats?.[0]?.splits?.[0]?.stat;

          // Prefer season if >=5 AB, else career if >=10 AB, else null
          let hits = 0, ab = 0;
          let avg: number | null = null;
          let obp: number | null = null;
          let slg: number | null = null;
          let ops: number | null = null;
          const parseSplit = (sp: any) => ({
            ab:   parseInt(sp.atBats      ?? "0") || 0,
            hits: parseInt(sp.hits        ?? "0") || 0,
            avg:  parseFloat(sp.avg       ?? "0") || null,
            obp:  parseFloat(sp.obp       ?? "0") || null,
            slg:  parseFloat(sp.slg       ?? "0") || null,
            ops:  parseFloat(sp.ops       ?? "0") || null,
          });
          if (seasonSplit && parseInt(seasonSplit.atBats ?? "0") >= 5) {
            const s = parseSplit(seasonSplit);
            ({ ab, hits, avg, obp, slg, ops } = s);
          } else if (careerSplit && parseInt(careerSplit.atBats ?? "0") >= 10) {
            const s = parseSplit(careerSplit);
            ({ ab, hits, avg, obp, slg, ops } = s);
          }

          // Compute OPS manually if API returns it null but we have OBP+SLG
          if (ops === null && obp !== null && slg !== null) ops = obp + slg;

          // Signal tiers — now uses BOTH avg AND ops for more accuracy:
          // elite:  avg >= .500 OR (avg >= .400 AND ops >= .950) with >= 10 AB
          // strong: avg >= .300 with >= 20 AB OR avg >= .350 with >= 10 AB
          // weak:   avg <  .150 with >= 15 AB
          const signal: "elite" | "strong" | "weak" | "none" =
            (ab >= 10 && avg !== null && (avg >= 0.500 || (avg >= 0.400 && (ops ?? 0) >= 0.950))) ? "elite" :
            (ab >= 10 && avg !== null && avg >= 0.350) ? "strong" :
            (ab >= 20 && avg !== null && avg >= 0.300) ? "strong" :
            (ab >= 15 && avg !== null && avg <  0.150) ? "weak"   : "none";

          const result = { avg, hits, ab, obp, slg, ops, signal };
          bvpCache[cacheKey] = result;
          return result;
        } catch { return { avg: null, hits: 0, ab: 0, obp: null, slg: null, ops: null, signal: "none" }; }
      }

      // ── 5. Helper: fetch hitter stats (30d, 14d, 7d, season, gamelog) ─
      async function getHitterStats(hitterId: number) {
        const today = new Date();
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const d30 = new Date(today); d30.setDate(today.getDate() - 30);
        const d14 = new Date(today); d14.setDate(today.getDate() - 14);
        const d7  = new Date(today); d7.setDate(today.getDate()  - 7);

        const [r30, r14, r7, rSeason, rLog, rHASplit, rDNSplit] = await Promise.allSettled([
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=byDateRange&group=hitting&season=2026&startDate=${fmt(d30)}&endDate=${fmt(today)}`),
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=byDateRange&group=hitting&season=2026&startDate=${fmt(d14)}&endDate=${fmt(today)}`),
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=byDateRange&group=hitting&season=2026&startDate=${fmt(d7)}&endDate=${fmt(today)}`),
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=season&group=hitting&season=2026`),
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=gameLog&group=hitting&season=2026&limit=14`),
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=h,a`),
          axios.get(`https://statsapi.mlb.com/api/v1/people/${hitterId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=d,n`),
        ]);

        function extractStat(result: PromiseSettledResult<any>) {
          if (result.status !== "fulfilled") return {};
          return result.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {};
        }
        function extractSplits(result: PromiseSettledResult<any>): any[] {
          if (result.status !== "fulfilled") return [];
          return result.value.data?.stats?.[0]?.splits ?? [];
        }

        const s30     = extractStat(r30);
        const s14     = extractStat(r14);
        const s7      = extractStat(r7);
        const sSeason = extractStat(rSeason);
        const gamelog = extractSplits(rLog);

        // Home / away splits (min 30 PA to trust sample)
        let avgHome: number | null = null;
        let avgAway: number | null = null;
        if (rHASplit.status === "fulfilled") {
          for (const sg of rHASplit.value.data?.stats ?? []) {
            for (const sp of sg?.splits ?? []) {
              const desc = (sp.split?.description ?? "").toLowerCase();
              const pa   = parseInt(sp.stat?.plateAppearances ?? sp.stat?.atBats ?? "0") || 0;
              if (pa < 30) continue;
              const avg = parseFloat(sp.stat?.avg ?? "0") || null;
              if (desc.includes("home"))  avgHome = avg;
              if (desc.includes("away"))  avgAway = avg;
            }
          }
        }

        // Games with hit % (last 14 games from game log)
        const last14Games = gamelog.slice(0, 14);
        const ghp14 = last14Games.length > 0
          ? last14Games.filter((g: any) => parseInt(g.stat?.hits ?? "0") > 0).length / last14Games.length
          : 0.5;

        // BABIP luck flag: if recent BABIP >> xBABIP by 50+ pts, flag as luck-inflated
        const babip14 = (() => {
          const h14 = last14Games.reduce((s: number, g: any) => s + (parseInt(g.stat?.hits ?? "0")), 0);
          const ab14 = last14Games.reduce((s: number, g: any) => s + (parseInt(g.stat?.atBats ?? "0")), 0);
          const hr14 = last14Games.reduce((s: number, g: any) => s + (parseInt(g.stat?.homeRuns ?? "0")), 0);
          const k14  = last14Games.reduce((s: number, g: any) => s + (parseInt(g.stat?.strikeOuts ?? "0")), 0);
          const denom = ab14 - k14 - hr14;
          return denom > 0 ? (h14 - hr14) / denom : null;
        })();

        // Expected PA per game based on lineup slot (approximation)
        // Top of order gets ~4.5 PA, bottom ~3.3 PA
        const paPerGame = 4.5; // default; overridden in buildCandidates by slot

        return {
          avg30: parseFloat(s30.avg ?? "0") || 0,
          avg14: parseFloat(s14.avg ?? "0") || 0,
          avg7:  parseFloat(s7.avg  ?? "0") || 0,
          avgSeason: parseFloat(sSeason.avg ?? "0") || 0,
          babip14,
          kPct: parseFloat(sSeason.strikePercentage ?? "0") / 100 || 0.20,
          bbPct: parseFloat(sSeason.walkPercentage ?? "0") / 100 || 0.08,
          obp: parseFloat(sSeason.obp ?? "0") || 0,
          slg: parseFloat(sSeason.slg ?? "0") || 0,
          ghp14,
          avgHome,
          avgAway,
          // Batted-ball profile: GO/AO ratio from season stats
          // < 0.8 = fly ball hitter; > 1.3 = ground ball hitter; ~1.0 = balanced
          goAoRatio: parseFloat(sSeason.groundOutsToAirouts ?? "0") || 1.0,
          gamelog: last14Games.slice(0, 5).map((g: any) => ({
            date: g.date,
            hits: parseInt(g.stat?.hits ?? "0"),
            ab:   parseInt(g.stat?.atBats ?? "0"),
          })),
          // ── Day/night split AVG (min 30 PA to trust) ──────────────────
          avgDay:  (() => {
            if (rDNSplit.status !== "fulfilled") return null;
            for (const sg of rDNSplit.value.data?.stats ?? []) {
              for (const sp of sg?.splits ?? []) {
                const desc = (sp.split?.description ?? "").toLowerCase();
                const pa   = parseInt(sp.stat?.plateAppearances ?? sp.stat?.atBats ?? "0") || 0;
                if (pa < 30) continue;
                if (desc.includes("day")) return parseFloat(sp.stat?.avg ?? "0") || null;
              }
            }
            return null;
          })(),
          avgNight: (() => {
            if (rDNSplit.status !== "fulfilled") return null;
            for (const sg of rDNSplit.value.data?.stats ?? []) {
              for (const sp of sg?.splits ?? []) {
                const desc = (sp.split?.description ?? "").toLowerCase();
                const pa   = parseInt(sp.stat?.plateAppearances ?? sp.stat?.atBats ?? "0") || 0;
                if (pa < 30) continue;
                if (desc.includes("night")) return parseFloat(sp.stat?.avg ?? "0") || null;
              }
            }
            return null;
          })(),
          // ── Active hit streak (consecutive games with ≥1 hit from most recent) ──
          hitStreak: (() => {
            let streak = 0;
            for (const g of last14Games) {
              const h = parseInt(g.stat?.hits ?? "0");
              const ab = parseInt(g.stat?.atBats ?? "0");
              if (ab === 0) continue; // skip no-AB games (DH off, etc.)
              if (h > 0) streak++;
              else break; // streak ends
            }
            return streak;
          })(),
        };
      }

      // ── 6. Score a single hitter ────────────────────────────────────
      // ── Park factor table (singles + hits per PA, park-adjusted) ────────
      // Values = hit factor relative to league average (1.00).
      const PARK_HIT_FACTORS: Record<string, number> = {
        "Coors Field": 1.18,          "Great American Ball Park": 1.10,
        "Minute Maid Park": 1.07,     "Globe Life Field": 1.06,
        "American Family Field": 1.06,"Fenway Park": 1.05,
        "Camden Yards": 1.04,         "Kauffman Stadium": 1.04,
        "Target Field": 1.03,         "Wrigley Field": 1.03,
        "Yankee Stadium": 1.02,       "Truist Park": 1.01,
        "PNC Park": 0.99,             "Progressive Field": 0.98,
        "Busch Stadium": 0.97,        "Citi Field": 0.97,
        "Dodger Stadium": 0.96,       "T-Mobile Park": 0.96,
        "Tropicana Field": 0.96,      "RingCentral Coliseum": 0.96,
        "loanDepot park": 0.95,       "Marlins Park": 0.95,
        "Oracle Park": 0.94,          "Petco Park": 0.93,
      };

      // ── 6. Score a single hitter (v3 — high-quality signal model) ──────────────
      // Philosophy: fewer high-quality variables > many weak ones.
      // Focus areas: Opportunity, Contact Ability, Matchup, Environment, Price.
      // Weights sum to 1.00:
      //   Form 14% | Contact Quality 16% | Hard Contact 10% | Matchup 26%
      //   Opportunity 18% | BvP 8% | Stability Anchor 8%
      function scoreHitter(
        hitter: any,
        pitcherSplits: any,
        savant: any,         // season Statcast
        savant15d: any,      // Phase 2: rolling 15d Statcast
        savant30d: any,      // Phase 2: rolling 30d Statcast
        pitcherSavant: any,
        total: number,
        weather: any,
        venue: string,
        bvp: { avg: number | null; ab: number; signal: string },
        lineupSlot: number,
        oppPitcherSeasonStats: any,
        isHomeGame: boolean,
        pitchTypeMatchup: number | null, // Phase 2: weighted wOBA vs pitcher arsenal (0-1)
        venueCareerAvg: number | null,   // Career AVG at today's specific ballpark (last 5 seasons)
        venueCareerAB: number,           // AB sample size at this venue
        vsTeamAvg: number | null,        // Season AVG vs today's opponent team
        vsTeamAB: number,                // AB vs team this season
        goAoRatio: number,               // Ground-outs to Air-outs ratio (batted-ball profile)
        venueCareerSlg: number | null,   // Career SLG at venue (extra-base hit tendency)
        venueCareerHrRate: number | null,// Career HR/AB at venue
        venueCareerIso: number | null,   // Career ISO (SLG-AVG) at venue — power indicator
        // Phase 3 additions:
        isDay: boolean,                  // day game (true) vs night game (false)
        bullpenEra: number | null,       // opposing bullpen ERA this season
        bullpenWhip: number | null,      // opposing bullpen WHIP this season
        sprintSpeed: number | null,      // Savant sprint speed (ft/sec) — infield hit predictor
      ): number {
        const bats = hitter.bats;
        const pitcherAvgAllowed = bats === "L" ? (pitcherSplits.vsLeft  || 0.250) : (pitcherSplits.vsRight  || 0.250);
        const pitcherPA         = bats === "L" ? (pitcherSplits.vsLeftPA || 0)    : (pitcherSplits.vsRightPA || 0);
        const norm = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

        // ── Statcast confidence gate (volume) ──
        const battedBalls  = parseInt(savant?.pa ?? savant?.ab_count ?? "0") || 0;
        const statcastConf = battedBalls >= 50 ? 1.0 : battedBalls >= 20 ? 0.70 : 0.40;

        // ══ COMPONENT 1: Recent Form (15%) ══
        // BABIP luck regression — only regress if BABIP significantly exceeds xBABIP
        // AND contact quality is poor (low hard-hit, low barrels). If they're barreling
        // the ball, the high BABIP may be real — don't penalize genuine hot streaks.
        const babip14 = hitter.babip14 ?? null;
        const xbabipV       = parseFloat(savant?.xbabip ?? "0") || null;
        const xbaForBabip   = parseFloat(savant?.xba    ?? "0") || hitter.avgSeason || 0.250;
        const hhForBabip    = parseFloat(savant?.hard_hit_percent ?? "0") || 0;
        const barrelForBabip= parseFloat(savant?.barrel_batted_rate ?? "0") || 0;
        const contactQualityOk = hhForBabip >= 38 || barrelForBabip >= 7; // hard contact supports high BABIP
        let adj14 = hitter.avg14 ?? 0;
        if (babip14 !== null && xbabipV !== null && babip14 - xbabipV > 0.055 && !contactQualityOk) {
          adj14 = adj14 * 0.70 + xbaForBabip * 0.30; // softer regression (was 40%, now 30%)
        }
        // Active hit streak bonus: consecutive games with a hit from most recent
        // A player on a 5+ game streak is genuinely locked in — add momentum signal
        const hitStreak = hitter.hitStreak ?? 0;
        const streakBonus = hitStreak >= 10 ? 0.12   // historic hot streak
                          : hitStreak >= 7  ? 0.09
                          : hitStreak >= 5  ? 0.06
                          : hitStreak >= 3  ? 0.03
                          : 0;
        // Day/night split adjustment: use actual split avg if available (min 30 PA)
        const isDayGame   = isDay;
        const splitDNAvg  = isDayGame ? (hitter.avgDay ?? null) : (hitter.avgNight ?? null);
        const dnAdj       = splitDNAvg !== null
          ? (norm(splitDNAvg, 0.180, 0.380) - 0.50) * 0.08  // +/- 4pts to form
          : 0;
        // Form weights: L7 30%, L14 35%, L30 15%, GHP14 10%, streak 7%, D/N 3%
        const formBase = (
          norm(adj14,               0.150, 0.400) * 0.35 +
          norm(hitter.avg30 ?? 0,   0.150, 0.380) * 0.15 +
          norm(hitter.avg7  ?? 0,   0.150, 0.380) * 0.30 +
          norm(hitter.ghp14 ?? 0.5, 0.300, 0.900) * 0.10 +
          Math.min(1, (hitter.ghp14 ?? 0.5) + streakBonus) * 0.07 +
          (0.50 + dnAdj)                           * 0.03
        );
        const form = Math.max(0, Math.min(1, formBase));

        // ══ COMPONENT 2: Contact Quality / Volatility Control (19%) ══
        // Phase 2: blend season + 30d + 15d Statcast for xBA/xwOBA/HH%/zCon
        // Weights: season 50%, last-30d 30%, last-15d 20% (hot streak signal)
        const kPct  = hitter.kPct  ?? 0.22;
        const bbPct = hitter.bbPct ?? 0.08;
        // Blended xBA
        const xbaSeason = parseFloat(savant?.xba   ?? "0") || null;
        const xba30d    = parseFloat(savant30d?.xba ?? "0") || null;
        const xba15d    = parseFloat(savant15d?.xba ?? "0") || null;
        const xbaV = xbaSeason !== null
          ? (xbaSeason * 0.50 + (xba30d ?? xbaSeason) * 0.30 + (xba15d ?? xbaSeason) * 0.20)
          : hitter.avgSeason || 0.250;
        // Blended xwOBA
        const xwobaSeason = parseFloat(savant?.xwoba   ?? "0") || null;
        const xwoba30d    = parseFloat(savant30d?.xwoba ?? "0") || null;
        const xwoba15d    = parseFloat(savant15d?.xwoba ?? "0") || null;
        const xwobaV = xwobaSeason !== null
          ? (xwobaSeason * 0.50 + (xwoba30d ?? xwobaSeason) * 0.30 + (xwoba15d ?? xwobaSeason) * 0.20)
          : 0.320;
        // Blended HH%
        const hhSeason = parseFloat(savant?.hard_hit_percent   ?? "0") / 100 || null;
        const hh30d    = parseFloat(savant30d?.hard_hit_percent ?? "0") / 100 || null;
        const hh15d    = parseFloat(savant15d?.hard_hit_percent ?? "0") / 100 || null;
        const hhBlended = hhSeason !== null
          ? (hhSeason * 0.50 + (hh30d ?? hhSeason) * 0.30 + (hh15d ?? hhSeason) * 0.20)
          : 0.35;
        // Blended zone contact
        const zConSeason = parseFloat(savant?.z_contact_percent   ?? "0") / 100 || null;
        const zCon30d    = parseFloat(savant30d?.z_contact_percent ?? "0") / 100 || null;
        const zCon15d    = parseFloat(savant15d?.z_contact_percent ?? "0") / 100 || null;
        const zConPct = zConSeason !== null
          ? (zConSeason * 0.50 + (zCon30d ?? zConSeason) * 0.30 + (zCon15d ?? zConSeason) * 0.20)
          : 0.82;
        const whiffPct= parseFloat(savant?.whiff_percent ?? "0") / 100 || 0.25;
        // Out-of-zone contact %: batters who make contact on pitches outside the zone
        // spray more hits (weak contact, but still reaches base more). High oz_contact
        // = better at protecting the plate and making something out of bad pitches.
        const ozConSeason = parseFloat(savant?.oz_contact_percent   ?? "0") / 100 || null;
        const ozCon30d    = parseFloat(savant30d?.oz_contact_percent ?? "0") / 100 || null;
        const ozCon15d    = parseFloat(savant15d?.oz_contact_percent ?? "0") / 100 || null;
        const ozConPct = ozConSeason !== null
          ? (ozConSeason * 0.50 + (ozCon30d ?? ozConSeason) * 0.30 + (ozCon15d ?? ozConSeason) * 0.20)
          : 0.65; // league avg ~65%
        // Sprint speed bonus: fast runners beat out more infield hits → higher BABIP
        // ≥ 28.0 ft/sec = above average; ≥ 29.5 = elite speed (top 10%)
        const sprintBonus = sprintSpeed !== null
          ? (sprintSpeed >= 29.5 ? 0.08
           : sprintSpeed >= 28.5 ? 0.05
           : sprintSpeed >= 28.0 ? 0.03
           : sprintSpeed <= 26.5 ? -0.03  // slow runner — fewer infield hits
           : 0)
          : 0;
        // Volatility penalty: high K% + high whiff = boom/bust = fewer singles
        const volatilityPenalty = Math.max(0, (kPct - 0.22) * 1.60 + (whiffPct - 0.28) * 1.10);
        const contactRaw = (
          norm(xbaV,    0.200, 0.380) * 0.25 +
          norm(xwobaV,  0.280, 0.430) * 0.22 +
          norm(zConPct, 0.700, 0.950) * 0.20 +
          norm(ozConPct,0.550, 0.850) * 0.13 +  // oz_contact — new
          norm(1-kPct,  0.630, 0.900) * 0.13 +
          norm(bbPct,   0.040, 0.180) * 0.07
        );
        const contact = Math.max(0.20,
          contactRaw * statcastConf + (1 - statcastConf) * 0.45 - volatilityPenalty * 0.10 + sprintBonus * statcastConf
        );

        // ══ COMPONENT 3: Hard Contact & Exit Velocity Profile (10%) ══
        // Phase 2: use blended hhBlended from above
        const barrelPct = parseFloat(savant?.barrel_batted_rate ?? "0") / 100 || 0.08;
        const laRaw     = parseFloat(savant?.launch_angle_avg   ?? "0") || 12;
        const laNorm = (laRaw >= 8 && laRaw <= 22) ? 1.0
                     : (laRaw >= 4 && laRaw <= 27) ? 0.75 : 0.50;
        const hardContactRaw = (
          norm(hhBlended, 0.25, 0.55) * 0.50 +
          norm(barrelPct, 0.04, 0.18) * 0.25 +
          laNorm                      * 0.25
        );
        const hardContact = hardContactRaw * statcastConf + (1 - statcastConf) * 0.45;

        // ══ COMPONENT 4: Pitcher Matchup + Environment (24%) ══
        // Phase 2 upgrades:
        //  (a) Pitch-type matchup score blended into hittability (30% weight)
        //  (b) Last-3 starts replaces last-5 for pitcher form
        //  (c) Leash probability adjusts opportunity (handled in opp. component)
        //  (d) Park × weather MULTIPLICATIVE interaction (not additive)
        const pitcherXwoba = parseFloat(pitcherSavant?.xwoba              ?? "0") || null;
        const pitcherGbPct = parseFloat(pitcherSavant?.groundballs_percent ?? "0") / 100 || 0.43;
        const pitcherFbPct = parseFloat(pitcherSavant?.flyballs_percent    ?? "0") / 100 || 0.35;
        const pitcherBbPct = parseFloat(pitcherSavant?.bb_percent          ?? "0") / 100 || 0.08;
        const pitcherSwStr = parseFloat(pitcherSavant?.p_swinging_strike_perc ?? "0") / 100 || 0.10;
        const pitcherKPct  = parseFloat(pitcherSavant?.k_percent           ?? "0") / 100 || 0.22;
        // Platoon BA — weight toward actual split as sample grows, blend toward
        // league-average platoon split (LHB vs RHP ~.255, RHB vs LHP ~.248) when thin.
        // Full trust at 100+ PA, 50% blend at 20 PA, league avg below 10 PA.
        const leaguePlatoonAvg = bats === "L" ? 0.255 : 0.248; // L vs RHP, R vs LHP
        const platoonBA = pitcherPA >= 100
          ? pitcherAvgAllowed
          : pitcherPA >= 20
            ? pitcherAvgAllowed * (pitcherPA / 100) + leaguePlatoonAvg * (1 - pitcherPA / 100)
            : pitcherPA > 0
              ? pitcherAvgAllowed * (pitcherPA / 100) + leaguePlatoonAvg * (1 - pitcherPA / 100)
              : leaguePlatoonAvg;
        const platoon = norm(platoonBA, 0.215, 0.340);
        // Pitcher hittability: xwOBA + pitch-type matchup blend
        // Phase 2: if pitch-type matchup available, weight it 30% alongside xwOBA 70%
        const pitcherHittabilityBase = pitcherXwoba !== null
          ? norm(pitcherXwoba, 0.280, 0.430)
          : platoon;
        const pitcherHittability = pitchTypeMatchup !== null
          ? pitcherHittabilityBase * 0.70 + pitchTypeMatchup * 0.30
          : pitcherHittabilityBase;
        // Phase 2: pitcher form uses last-3 ERA (more recent signal) + last-5 fallback
        const last3ERA    = oppPitcherSeasonStats?.last3ERA  ?? null;
        const last5ERA    = oppPitcherSeasonStats?.last5ERA  ?? null;
        const last3H9     = oppPitcherSeasonStats?.last3H9   ?? null;
        const pitcherWHIP = oppPitcherSeasonStats?.whip      ?? null;
        const pitcherFormScore = (() => {
          let s = 0.50;
          // Phase 2: prefer last-3 ERA over last-5 (most recent 3 starts = better signal)
          const recentERA = last3ERA ?? last5ERA;
          if (recentERA    !== null) s += (norm(recentERA, 3.00, 7.00) - 0.50) * 0.45;
          if (pitcherWHIP  !== null) s += (norm(2.0 - pitcherWHIP, 0.50, 1.50) - 0.50) * 0.15;
          // Phase 2: last-3 hits/9 gives direct hittability signal
          if (last3H9      !== null) s += (norm(last3H9, 5.0, 12.0) - 0.50) * 0.15;
          s -= norm(pitcherSwStr, 0.07, 0.18) * 0.15;
          s -= norm(pitcherKPct,  0.18, 0.35) * 0.10;
          s += norm(pitcherBbPct, 0.06, 0.14) * 0.05;
          return Math.max(0, Math.min(1, s));
        })();
        // Game total (implied scoring environment)
        const totalBoost = norm(total, 7.5, 12.0);

        // ── Bullpen quality adjustment ─────────────────────────────────────
        // 30%+ of PA are against relievers. Weak bullpen = more hitter-friendly PA.
        // Interacts with leash probability: low leash + weak pen = big PA opportunity.
        const penEra  = bullpenEra  ?? 4.20; // league avg bullpen ERA ~4.20
        const penWhip = bullpenWhip ?? 1.35; // league avg bullpen WHIP ~1.35
        const bullpenScore = (
          norm(penEra,  3.00, 6.00) * 0.60 +  // high ERA = easier for hitters
          norm(penWhip, 0.90, 1.80) * 0.40
        );
        // TTO (Times Through Order) penalty baked into leash+slot interaction:
        // Short-leash pitcher (≤0.60) means hitters see more relievers early.
        // BUT if the starter IS going deep (high leash), lineup slots 7-9 face
        // a pitcher for the 3rd time — historically ~30pts better for hitters.
        // Model this as a bonus for bottom-order when starter goes deep.
        const ttoBonus = (() => {
          const leashProb2 = oppPitcherSeasonStats?.leashProbability ?? 0.85;
          if (leashProb2 >= 0.80 && lineupSlot >= 7) {
            // Bottom of order sees starter 3rd time through in a long game
            return 0.06;
          }
          if (leashProb2 <= 0.50 && lineupSlot <= 5) {
            // Short leash means relievers early — top order sees soft pen sooner
            return 0.04;
          }
          return 0;
        })();
        // ── Phase 2: Park × weather MULTIPLICATIVE interaction ──────────
        // Previously: additive (park + weather as separate additive terms)
        // Now: parkFactor scales the weather effect (hot day in Coors >> hot day in Petco)
        const parkFactor    = PARK_HIT_FACTORS[venue] ?? 1.00;
        const parkBoostRaw  = norm(parkFactor, 0.90, 1.22);          // 0-1 park friendliness
        const tempF         = weather?.tempF   ?? 70;
        const windMph       = weather?.windMph ?? 5;
        const windOut       = weather?.windOut ?? false;
        const tempMult = 1.0 + Math.max(0, (tempF - 60) / 80) * 0.12;
        const windMult = windOut && windMph >= 15 ? 1.12
                       : windOut && windMph >= 10 ? 1.08
                       : windOut && windMph >= 6  ? 1.04
                       : weather?.windIn && windMph >= 15 ? 0.88
                       : weather?.windIn && windMph >= 10 ? 0.92
                       : 1.00;
        // Rain penalty: reduces ball-in-play opportunities
        const precipPenalty = (weather?.precipInches ?? 0) >= 0.10 ? 0.88
                            : (weather?.precipInches ?? 0) >= 0.02 ? 0.94
                            : 1.00;
        // Dome: ignore all weather effects
        const domeNeutral = (weather?.isDome ?? false) ? 1.0 : 1.0; // always 1, but explicit
        // Multiplicative: park × temp × wind × precip
        const envRaw  = parkBoostRaw * tempMult * windMult * precipPenalty;
        const envScore = Math.min(1.0, Math.max(0.1, envRaw));
        const matchup = (
          pitcherHittability * 0.33 +  // starter hittability
          pitcherFormScore   * 0.24 +  // starter recent form
          totalBoost         * 0.17 +  // game total environment
          envScore           * 0.13 +  // park × weather
          bullpenScore       * 0.08 +  // bullpen quality (new)
          Math.min(1, 0.50 + ttoBonus) * 0.05  // TTO interaction (new)
        );

        // ══ COMPONENT 5: Opportunity / Lineup Slot + EPA (20%) ══
        // Phase 2: adds leash probability — low leash = more bullpen innings = PA opportunity
        // PA tiers: 1-3 strong, 4-5 moderate, 6-7 mild downgrade, 8-9 downgrade
        const impliedRuns  = total / 2;
        const impliedBoost = norm(impliedRuns, 3.5, 6.5) * 0.08;
        const rawSlotScore = lineupSlot <= 3 ? 0.88
                           : lineupSlot <= 5 ? 0.66
                           : lineupSlot <= 7 ? 0.44
                           : 0.28;
        // EPA gate: projected PA < 3.8 gets a downgrade flag
        const projectedPA = lineupSlot <= 3 ? 4.6
                          : lineupSlot <= 5 ? 4.0
                          : lineupSlot <= 7 ? 3.6
                          : 3.2;
        const epaGatePenalty = projectedPA < 3.8 ? 0.07 : 0;
        // Home/away split adjustment
        const splitAvg = isHomeGame ? (hitter.avgHome ?? null) : (hitter.avgAway ?? null);
        const splitAdj = splitAvg !== null ? (norm(splitAvg, 0.200, 0.380) - 0.50) * 0.08 : 0;
        // Phase 2: leash probability adjustment
        // Low-leash pitcher → more bullpen exposure → top-order hitters see more soft relievers
        // High-leash ace → fewer plate appearances against vulnerable pen
        const leashProb = oppPitcherSeasonStats?.leashProbability ?? 0.85;
        // Short leash (≤0.60) gives up to +0.05 bonus for slots 1-5 (PA opportunity boost)
        const leashBonus = lineupSlot <= 5 ? (1.0 - leashProb) * 0.10 : 0;
        const opportunity = Math.max(0, Math.min(1,
          rawSlotScore + impliedBoost + splitAdj - epaGatePenalty + leashBonus
        ));

        // ══ COMPONENT 6: BvP + Vs-Team ── (dynamic 6–18%) ══
        // BvP is now tiered: elite / strong / weak / none.
        // Elite tier (.500+ avg OR .400+ avg with .950+ OPS vs this pitcher)
        // triggers a significant score boost that can override mediocre season numbers.
        // OPS is used alongside avg to confirm quality of the BvP edge:
        //   - High avg + high OPS (extra bases) = true dominance of this pitcher
        //   - High avg + low OPS = singles hitter, still good but weighted less
        const bvpOps = (bvp as any).ops as number | null ?? null;
        const bvpSlg = (bvp as any).slg as number | null ?? null;
        const bvpObp = (bvp as any).obp as number | null ?? null;
        // Base score from signal tier
        const bvpPitcherScore = bvp.signal === "elite"  ? 0.95
                              : bvp.signal === "strong" ? 0.80
                              : bvp.signal === "weak"   ? 0.20
                              : 0.50;
        // OPS modifier: if elite/strong BvP, scale up further based on actual OPS quality
        // .950+ OPS vs pitcher is exceptional; 1.000+ is rare dominance
        const bvpOpsBoost = (bvp.signal === "elite" || bvp.signal === "strong") && bvpOps !== null
          ? Math.min(0.08, Math.max(0, (bvpOps - 0.800) * 0.15)) // +0 at .800, +0.08 at 1.333
          : 0;
        const adjustedBvpScore = Math.min(1.0, bvpPitcherScore + bvpOpsBoost);
        const vsTeamScore = vsTeamAB >= 10 && vsTeamAvg !== null
          ? norm(vsTeamAvg, 0.180, 0.380)
          : 0.50;
        // Blend: trust BvP more when signal is strong/elite
        const bvpScore = bvp.signal === "none" || bvp.ab < 10
          ? adjustedBvpScore * 0.50 + vsTeamScore * 0.50
          : bvp.signal === "elite"
            ? adjustedBvpScore * 0.90 + vsTeamScore * 0.10  // elite BvP dominates
            : adjustedBvpScore * 0.75 + vsTeamScore * 0.25;

        // ══ COMPONENT 7: Venue Career History (4%) ══
        // Blends career AVG, SLG, and ISO at this specific ballpark.
        // AVG = hit frequency, SLG = hit quality, ISO = extra-base power at this park.
        // Requires 20+ career AB at the venue to weight meaningfully.
        let venueScore = 0.50; // neutral default
        if (venueCareerAvg !== null && venueCareerAB >= 20) {
          const avgScore = norm(venueCareerAvg, 0.180, 0.380);
          const slgScore = venueCareerSlg !== null
            ? norm(venueCareerSlg, 0.280, 0.600)
            : avgScore; // fall back to AVG signal if no SLG
          const isoScore = venueCareerIso !== null
            ? norm(venueCareerIso, 0.050, 0.250)
            : 0.50; // neutral if no ISO
          // Weighted blend: AVG 60%, SLG 25%, ISO 15%
          // AVG is the primary signal (hit probability), SLG/ISO add context
          venueScore = avgScore * 0.60 + slgScore * 0.25 + isoScore * 0.15;
        }

        // ══ COMPONENT 8: Batted-Ball Profile vs Pitcher Type (3%) ══
        // GO/AO ratio interaction with pitcher's groundball tendency.
        // GB pitcher (pitcherGbPct >= 0.52) + FB hitter (goAoRatio < 0.80) = disadvantage.
        // GB pitcher + GB hitter = slight advantage (more put-in-play, less K).
        const pitcherGbPctScore = parseFloat(pitcherSavant?.groundballs_percent ?? "0") / 100 || 0.43;
        let battedBallBonus = 0.50;
        if (goAoRatio < 0.80) {
          // Fly-ball hitter: bonus vs FB pitchers, penalty vs GB pitchers
          battedBallBonus = pitcherGbPctScore >= 0.52 ? 0.35 : 0.60;
        } else if (goAoRatio > 1.30) {
          // Ground-ball hitter: slight bonus vs anyone (more contact, fewer Ks)
          battedBallBonus = pitcherGbPctScore >= 0.52 ? 0.55 : 0.50;
        }

        // ══ STABILITY ANCHOR (7%) ══ — small residual to prevent runaway scores
        const stabilityScore = lineupSlot <= 5
          ? 0.60 + (hitter.ghp14 ?? 0.5) * 0.20
          : 0.40;

        // ── Final weighted composite (Phase 3 rebalance) ────────────────────
        //
        // Weight philosophy — ranked by predictive impact for single-game hit probability:
        //   Matchup (pitcher+bullpen+TTO+env) — biggest daily variable    → 25%
        //   Recent Form (streak, D/N, L7/L14) — hot/cold state            → 15%
        //   Opportunity (lineup slot, PA projection, leash)               → 18%
        //   Contact Quality (xBA, xwOBA, zCon, ozCon, sprint, K%)        → 16%
        //   BvP + Vs-Team — scales with signal quality (6-18%)            → dynamic
        //   Hard Contact (HH%, barrel%, launch angle)                     → 8%
        //   Venue Career History                                           → 5%
        //   Batted-Ball Profile vs pitcher type                           → 3%
        //   Stability Anchor                                               → 5%
        //
        // BvP weight scales: elite → 18%, strong → 12%, neutral → 6%
        // Extra BvP weight drawn from matchup (60%) and form (40%)
        const bvpWeight = bvp.signal === "elite"  ? 0.18
                        : bvp.signal === "strong" ? 0.12
                        : 0.06;
        const extraBvp  = bvpWeight - 0.06;
        const formW     = Math.max(0.10, 0.15 - extraBvp * 0.40);
        const matchupW  = Math.max(0.19, 0.25 - extraBvp * 0.60);
        const rawNom = (
          form            * formW     +   // 15% base (form + streak + D/N)
          contact         * 0.16      +   // 16% (xBA, xwOBA, zCon, ozCon, sprint, K%)
          hardContact     * 0.08      +   // 8%  (HH%, barrel%, launch angle)
          matchup         * matchupW  +   // 25% base (starter + bullpen + TTO + env)
          opportunity     * 0.18      +   // 18% (lineup slot, leash, home/away)
          bvpScore        * bvpWeight +   // 6-18% dynamic
          venueScore      * 0.05      +   // 5%  (career park splits)
          battedBallBonus * 0.03      +   // 3%  (GB/FB vs pitcher type)
          stabilityScore  * 0.05          // 5%  anchor
        );
        // Normalize by actual weight sum so output stays in 0-1 range
        const totalW = formW + 0.16 + 0.08 + matchupW + 0.18 + bvpWeight + 0.05 + 0.03 + 0.05;
        const raw = rawNom / totalW;
        return Math.max(0, Math.min(1, raw));
      }


      // ── 7. Build slate of high-total games ──────────────────────────
      // ── Strict BTS eligibility thresholds ─────────────────────────
      // A player must pass ALL three soft gates OR qualify via the override.
      // If they fail the soft gates but every extreme-metric fires, they
      // can still appear — but this should be rare (maybe 1-2 players/day).
      // ── BTS Eligibility Thresholds (Phase 1: hard gates removed) ──
      // Hard BA gates (MIN_AVG14, MIN_GHP14, MIN_SEASON_AVG) REMOVED.
      // The calibrated model score + implied probability edge now do all filtering.
      // Only two hard rules remain: game total floor + min calibrated probability.
      const MIN_TOTAL           = 8.0;   // game O/U floor — low-total games still skipped
      const MIN_PLATOON_PA      = 5;     // min PA faced to trust platoon BA
      const MIN_PLATOON_XWOBA   = 0.300; // relaxed from .310 — edge filter handles weak matchups
      const MIN_PLATOON_BA_HARD = 0.215; // relaxed — xwOBA preferred anyway
      const MIN_HIT_PROBABILITY = 60;    // lowered from 62 — edge filter handles quality control

      // Override: flags hitters with elite Statcast profiles despite cold surface stats.
      // Phase 1 requirements: 30+ batted balls (Statcast volume), 15+ PA in last 14 days (active),
      // and 4 of 6 quality signals. Override picks are ranked last and capped at 1/day.
      function passesOverride(stats: any, savant: any, pitcherXwoba: number | null, pitcherBA: number): boolean {
        const xba     = parseFloat(savant?.xba               ?? "0") || 0;
        const hardHit = parseFloat(savant?.hard_hit_percent  ?? "0") || 0;
        const barrels = parseFloat(savant?.barrel_batted_rate ?? "0") || 0;
        const whiff   = parseFloat(savant?.whiff_percent     ?? "0") || 99;
        const savantPA = parseInt(savant?.pa ?? savant?.ab_count ?? "0") || 0;
        if (savantPA < 30) return false; // Statcast volume gate
        // Minimum recent PA: must have 15+ PA in last 14 days (ensures player is active/healthy)
        // Approximate from avg14 * ghp14 * 14games * ~4PA/game; simpler: check avg14 has a sample
        const recentPA = (stats.ghp14 ?? 0) * 14 * 3.5; // estimated PA in 14d window
        if (recentPA < 15) return false;
        const matchupOk  = pitcherXwoba !== null ? pitcherXwoba >= 0.370 : pitcherBA >= 0.285;
        const signals: boolean[] = [
          xba >= 0.310,                   // elite expected contact
          hardHit >= 46,                  // hard hit rate
          barrels >= 9,                   // barrel rate
          (stats.ghp14 ?? 0) >= 0.70,    // hit in 70%+ of recent games (relaxed from 75%)
          matchupOk,                      // favorable matchup
          whiff <= 22,                    // makes contact consistently
        ];
        const positiveCount = signals.filter(Boolean).length;
        return positiveCount >= 4; // require 4 of 6 signals
      }
      const slateGames: any[] = [];
      let candidatePicks: any[] = [];

      for (const game of games) {
        const homeTeam = game.teams?.home;
        const awayTeam = game.teams?.away;
        if (!homeTeam || !awayTeam) continue;

        const homeAbbr = homeTeam.team?.abbreviation?.toUpperCase() ?? "";
        const awayAbbr = awayTeam.team?.abbreviation?.toUpperCase() ?? "";
        const oddsKey  = [homeAbbr, awayAbbr].sort().join("_");
        const total    = espnOddsMap[oddsKey] ?? 8.5;

        const venue         = game.venue?.name ?? "";
        const rawScheduleW  = game.weather ?? {};
        const rawWind       = rawScheduleW.wind ?? "";
        const rawTempF      = parseFloat(rawScheduleW.temp ?? "70");
        const rawWindMph    = parseFloat((rawWind.match(/(\d+) mph/) ?? ["0","0"])[1]);
        const rawWindOut    = rawWind.toLowerCase().includes("out");

        // ── Structured weather via wttr.in (30-min cache, dome-aware) ──
        let sw: any = null;
        try {
          sw = await fetchStructuredWeather(homeTeam?.team?.name ?? "", "MLB", venue);
        } catch { /* use schedule weather below */ }

        const tempF        = sw?.tempF        ?? rawTempF;
        const windMph      = sw?.windMph      ?? rawWindMph;
        const windOut      = sw?.windOut      ?? rawWindOut;
        const windIn       = sw?.windIn       ?? false;
        const humidity     = sw?.humidity     ?? 50;
        const precipInches = sw?.precipInches ?? 0;
        const isDome       = sw?.isDome       ?? false;
        const impactLabel  = sw?.impactLabel  ?? "";
        const impactTier   = sw?.impactTier   ?? "neutral";
        const hitterImpact = sw?.hitterImpact ?? 0.50;
        const wind         = sw
          ? `${sw.windMph} mph ${sw.windDir}${sw.windOut ? " (out)" : sw.windIn ? " (in)" : ""}`
          : rawWind;

        const gameDate  = game.gameDate ?? "";
        const localTime = gameDate ? new Date(gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : "TBD";

        const slateEntry = {
          gameId: game.gamePk,
          matchup: `${awayTeam.team?.name} @ ${homeTeam.team?.name}`,
          venue,
          total,
          meetsFilter: total >= MIN_TOTAL,
          weather: { tempF, wind, windMph, windDir: sw?.windDir ?? "", windOut, windIn, humidity, precipInches, isDome, impactLabel, impactTier, hitterImpact },
          gameTime: localTime,
          homePitcher: homeTeam.probablePitcher ? { id: homeTeam.probablePitcher.id, name: homeTeam.probablePitcher.fullName } : null,
          awayPitcher: awayTeam.probablePitcher ? { id: awayTeam.probablePitcher.id, name: awayTeam.probablePitcher.fullName } : null,
        };
        slateGames.push(slateEntry);

        if (!slateEntry.meetsFilter) continue;

        // ── Per-game try/catch so one bad game never kills remaining games ──
        try {

        // Get pitcher splits + season stats for both pitchers
        const [homeSplits, awaySplits, homeSeasonStats, awaySeasonStats] = await Promise.all([
          homeTeam.probablePitcher?.id ? getPitcherSplits(homeTeam.probablePitcher.id) : Promise.resolve({ vsLeft: 0.250, vsRight: 0.250 }),
          awayTeam.probablePitcher?.id ? getPitcherSplits(awayTeam.probablePitcher.id) : Promise.resolve({ vsLeft: 0.250, vsRight: 0.250 }),
          homeTeam.probablePitcher?.id ? getPitcherSeasonStats(homeTeam.probablePitcher.id) : Promise.resolve({ era: null, k9: null, whip: null, ip: 0 }),
          awayTeam.probablePitcher?.id ? getPitcherSeasonStats(awayTeam.probablePitcher.id) : Promise.resolve({ era: null, k9: null, whip: null, ip: 0 }),
        ]);
        // Resolve pitcher savant data for both pitchers
        const homePitcherSavant = homeTeam.probablePitcher?.id ? (pitcherSavantMap[String(homeTeam.probablePitcher.id)] ?? {}) : {};
        const awayPitcherSavant = awayTeam.probablePitcher?.id ? (pitcherSavantMap[String(awayTeam.probablePitcher.id)] ?? {}) : {};

        // Get confirmed or projected lineups
        const lineups = game.lineups ?? {};
        const confirmedHome: any[] = lineups.homePlayers ?? [];
        const confirmedAway: any[] = lineups.awayPlayers ?? [];

        // ── Projected lineup fallback via recent boxscores ──────────
        async function getProjectedLineup(teamId: number, preferHome: boolean): Promise<any[]> {
          try {
            const recentSched = await axios.get(
              `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&season=2026&gameType=R&limit=8`,
              { timeout: 8000 }
            );
            const recentDates: any[] = recentSched.data?.dates ?? [];
            const recentGames: any[] = recentDates
              .flatMap((d: any) => d.games ?? [])
              .filter((g: any) => g.status?.abstractGameState === "Final")
              .slice(0, 3);

            const orderTally: Record<number, number[]> = {};
            for (const rg of recentGames) {
              try {
                const box = await axios.get(`https://statsapi.mlb.com/api/v1/game/${rg.gamePk}/boxscore`, { timeout: 8000 });
                // Figure out which side this team was
                const homeId = box.data?.teams?.home?.team?.id;
                const boxSide = homeId === teamId ? "home" : "away";
                const teamBox = box.data?.teams?.[boxSide] ?? {};
                const battingOrder: number[] = teamBox.battingOrder ?? [];
                battingOrder.forEach((pid: number, idx: number) => {
                  if (!orderTally[pid]) orderTally[pid] = [];
                  orderTally[pid].push(idx + 1);
                });
              } catch { /* skip */ }
            }

            if (!Object.keys(orderTally).length) return [];

            return Object.entries(orderTally)
              .map(([pid, slots]) => ({
                id: parseInt(pid),
                person: { id: parseInt(pid) },
                lineupSource: "projected" as const,
                medianSlot: slots.sort((a, b) => a - b)[Math.floor(slots.length / 2)],
              }))
              .filter(p => p.medianSlot <= 5)
              .sort((a, b) => a.medianSlot - b.medianSlot)
              .slice(0, 5);
          } catch { return []; }
        }

        let homePlayers: any[];
        let awayPlayers: any[];
        let homeLineupSource: string;
        let awayLineupSource: string;

        if (confirmedHome.length > 0) {
          homePlayers = confirmedHome.map((p: any) => ({ ...p, lineupSource: "confirmed" }));
          homeLineupSource = "confirmed";
        } else {
          homePlayers = await getProjectedLineup(homeTeam.team?.id, true);
          homeLineupSource = homePlayers.length > 0 ? "projected" : "unavailable";
        }

        if (confirmedAway.length > 0) {
          awayPlayers = confirmedAway.map((p: any) => ({ ...p, lineupSource: "confirmed" }));
          awayLineupSource = "confirmed";
        } else {
          awayPlayers = await getProjectedLineup(awayTeam.team?.id, false);
          awayLineupSource = awayPlayers.length > 0 ? "projected" : "unavailable";
        }
        console.log(`[BTS] ${slateEntry.matchup} home=${homeLineupSource}(${homePlayers.length}) away=${awayLineupSource}(${awayPlayers.length}) total=${total}`);
        if (homePlayers.length === 0 && awayPlayers.length === 0) { console.warn(`[BTS] SKIPPING ${slateEntry.matchup} — no lineup data`); }

        // Scratch detection: if we previously had a projected pick whose ID
        // is NOT in the now-confirmed lineup, it gets flagged as scratched
        const confirmedHomeIds = new Set(confirmedHome.map((p: any) => p.id ?? p.person?.id));
        const confirmedAwayIds = new Set(confirmedAway.map((p: any) => p.id ?? p.person?.id));

        // ── Hit prop implied probability lookup (Linemate MLB data) ──────
        // Keyed by lowercase player name. Built once per game loop.
        const hitPropImpliedMap: Record<string, number> = {};
        try {
          // Pull from already-cached linemate /api/mlb/v2/markets data
          // We use the in-process linemate cache if available, else skip gracefully
          const lmCached = linemateCache.get("mlb");
          if (lmCached) {
            const markets = lmCached.data?.markets ?? [];
            for (const m of markets) {
              const mName = (m.marketName ?? m.market?.name ?? "").toUpperCase();
              if (!mName.includes("HITTER_HITS") && mName !== "HITTER_HITS") continue;
              const playerName = (m.playerName ?? m.player?.name ?? "").toLowerCase();
              if (!playerName) continue;
              // Prefer OVER line; odds in American format
              const overOdds = m.overOdds ?? m.odds ?? null;
              if (overOdds === null) continue;
              // Convert American odds to implied probability
              const imp = overOdds < 0
                ? Math.abs(overOdds) / (Math.abs(overOdds) + 100)
                : 100 / (overOdds + 100);
              // Remove vig: rough devig (both sides rarely available; use as-is ~0.9x)
              hitPropImpliedMap[playerName] = Math.min(0.90, imp * 0.95);
            }
          }
        } catch { /* sportsbook data unavailable — no edge filter applied */ }

        const buildCandidates = async (players: any[], side: "home" | "away", pitcherSplits: any, teamName: string, lineupSrc: string, oppPitcherSeasonStats: any, oppPitcherSavant: any) => {
          console.log(`[BTS] buildCandidates team=${teamName} side=${side} players=${players.length} src=${lineupSrc}`);
          const candidates: any[] = [];
          for (let slotIdx = 0; slotIdx < Math.min(players.length, 8); slotIdx++) {
            const p = players[slotIdx];
            const pid = p.id ?? p.person?.id;
            if (!pid) continue;
            try {
              // Fetch player profile for bats (L/R/S)
              let profileResp: any;
              try {
                profileResp = await axios.get(`https://statsapi.mlb.com/api/v1/people/${pid}?hydrate=stats(group=hitting,type=season,season=2026)`, { timeout: 8000 });
              } catch (profileErr: any) {
                console.warn(`[BTS] profile fetch failed pid=${pid} team=${teamName}: ${profileErr.message}`);
                continue;
              }
              const person = profileResp.data?.people?.[0];
              if (!person) { console.warn(`[BTS] no person data pid=${pid} team=${teamName}`); continue; }
              const bats = person.batSide?.code ?? "R";
              const fullName = person.fullName ?? p.fullName ?? "Unknown";

              // ── Gate 1: Platoon filter (softened — uses xwOBA allowed if available) ──
              const pitcherAvgVsMe   = bats === "L" ? pitcherSplits.vsLeft  : pitcherSplits.vsRight;
              const pitcherPAvsMe    = bats === "L" ? pitcherSplits.vsLeftPA : pitcherSplits.vsRightPA;
              const pitcherXwobaVsMe = bats === "L" ? pitcherSplits.vsLeftXwoba : pitcherSplits.vsRightXwoba;
              // Prefer xwOBA allowed (more predictive) if available; fall back to BA
              const platoonOk = pitcherXwobaVsMe !== null
                ? pitcherXwobaVsMe >= MIN_PLATOON_XWOBA
                : (pitcherPAvsMe < MIN_PLATOON_PA ? true : pitcherAvgVsMe >= MIN_PLATOON_BA_HARD);
              if (!platoonOk) { console.log(`[BTS] platoon filter OUT: pid=${pid} name=${person?.fullName} bats=${bats} xwoba=${pitcherXwobaVsMe} ba=${pitcherAvgVsMe}`); continue; }

              // Scratch detection: was this a projected player who's now absent from confirmed lineup?
              const confirmedIds = side === "home" ? confirmedHomeIds : confirmedAwayIds;
              const hasConfirmedLineup = side === "home" ? confirmedHome.length > 0 : confirmedAway.length > 0;
              const isScratched = lineupSrc === "projected" && hasConfirmedLineup && !confirmedIds.has(pid);

              const stats    = await getHitterStats(pid);
              const savant   = savantMap[String(pid)]    ?? {};  // season Statcast
              const sav15d   = savantMap15d[String(pid)] ?? {};  // Phase 2: rolling 15d
              const sav30d   = savantMap30d[String(pid)] ?? {};  // Phase 2: rolling 30d

              // ── Gate 2: Removed hard BA/GHP/season gates (Phase 1) ──
              // Model score + edge filter now handle quality control.
              const pitcherXwobaForOverride = parseFloat(oppPitcherSavant?.xwoba ?? "0") || null;
              const isOverridePick = passesOverride(stats, savant, pitcherXwobaForOverride, pitcherAvgVsMe)
                && ((stats.avg14 ?? 0) < 0.200 || (stats.avgSeason ?? 0) < 0.195);

              // ── BvP: fetch career/season history vs today's starter ──
              const opponentPitcherId = side === "home" ? awayTeam.probablePitcher?.id : homeTeam.probablePitcher?.id;
              const bvp = opponentPitcherId
                ? await getBvP(pid, opponentPitcherId)
                : { avg: null, hits: 0, ab: 0, signal: "none" };

              // ── Phase 2: pitch-type matchup score ─────────────────────────
              // Wrapped in its own try/catch — a timeout here must NOT silently drop the candidate
              // Fetched per batter-pitcher pair; cached in pitchArsenalCache
              let pitchMatchup: number | null = null;
              try { pitchMatchup = opponentPitcherId
                ? await getPitchArsenalMatchup(opponentPitcherId, pid, bats)
                : null; } catch { pitchMatchup = null; }

              // ── PlayerIntel data: career venue splits + vs-team stats ─────
              // Fetch career park splits for today's venue (last 5 seasons)
              let venueCareerAvg:    number | null = null;
              let venueCareerAB      = 0;
              let venueCareerSlg:    number | null = null;
              let venueCareerHrRate: number | null = null;
              let venueCareerIso:    number | null = null;
              try {
                const parkResp = await axios.get(
                  `http://localhost:${process.env.PORT ?? 5000}/api/intel/park-splits/${pid}`,
                  { timeout: 6000 }
                );
                const venueEntry = (parkResp.data?.venues ?? []).find(
                  (v: any) => (v.venue ?? "").toLowerCase() === (venue ?? "").toLowerCase()
                );
                if (venueEntry && venueEntry.AB >= 10) {
                  const vAB = venueEntry.AB ?? venueEntry.atBats ?? 0;
                  const vAVG = typeof venueEntry.avg === "number" ? venueEntry.avg
                    : parseFloat(String(venueEntry.avg ?? "0")) || null;
                  const vSLG = typeof venueEntry.slg === "number" ? venueEntry.slg
                    : parseFloat(String(venueEntry.slg ?? "0")) || null;
                  const vHR  = venueEntry.HR ?? venueEntry.homeRuns ?? venueEntry.hr ?? 0;
                  const vTB  = venueEntry.totalBases ?? 0;
                  venueCareerAvg    = vAVG;
                  venueCareerAB     = vAB;
                  venueCareerSlg    = vSLG ?? (vAB > 0 ? vTB / vAB : null);
                  venueCareerHrRate = vAB > 0 ? vHR / vAB : null;
                  venueCareerIso    = (venueCareerSlg !== null && vAVG !== null)
                    ? Math.max(0, venueCareerSlg - vAVG) : null;
                }
              } catch { /* non-blocking */ }

              // Vs-team season stats (opponent team name)
              let vsTeamAvg: number | null = null;
              let vsTeamAB  = 0;
              try {
                const oppTeamId = side === "home" ? awayTeam.team?.id : homeTeam.team?.id;
                if (oppTeamId) {
                  const vsResp = await axios.get(
                    `https://statsapi.mlb.com/api/v1/people/${pid}/stats?stats=vsTeam&group=hitting&season=2026&opposingTeamId=${oppTeamId}&gameType=R`,
                    { timeout: 6000 }
                  );
                  const vsSplits = vsResp.data?.stats?.[0]?.splits ?? [];
                  // Aggregate all per-game splits into totals
                  let totalH = 0, totalAB = 0, totalTB = 0;
                  for (const sp of vsSplits) {
                    totalH  += parseInt(sp.stat?.hits      ?? "0") || 0;
                    totalAB += parseInt(sp.stat?.atBats    ?? "0") || 0;
                  }
                  if (totalAB >= 5) {
                    vsTeamAvg = totalH / totalAB;
                    vsTeamAB  = totalAB;
                  }
                }
              } catch { /* non-blocking */ }

              const lineupSlot = p.medianSlot ?? (slotIdx + 1);
              const goAoRatio  = stats.goAoRatio ?? 1.0;

              // ── Day/night: determine if game is a day game ─────────────
              const gameHour = game.gameDate ? new Date(game.gameDate).getUTCHours() : 18;
              // Central time offset approx: UTC-5 (CDT) or UTC-6 (CST)
              const localHour = (gameHour - 5 + 24) % 24;
              const isDay = localHour < 17; // games starting before 5pm local = day game

              // ── Opposing bullpen stats ─────────────────────────────────
              // Fetch from MLB API team pitching stats (bullpen = total - starter)
              let bullpenEra: number | null = null;
              let bullpenWhip: number | null = null;
              try {
                const oppTeamId2 = side === "home" ? awayTeam.team?.id : homeTeam.team?.id;
                if (oppTeamId2) {
                  const penResp = await axios.get(
                    `https://statsapi.mlb.com/api/v1/teams/${oppTeamId2}/stats?stats=season&group=pitching&season=2026&gameType=R`,
                    { timeout: 6000 }
                  );
                  const penStat = penResp.data?.stats?.[0]?.splits?.[0]?.stat ?? {};
                  // Total team ERA/WHIP as proxy (bullpen slightly worse than total)
                  const teamEra  = parseFloat(penStat.era  ?? "0") || null;
                  const teamWhip = parseFloat(penStat.whip ?? "0") || null;
                  // Rough adjustment: bullpen ERA ~0.40 higher than team ERA
                  bullpenEra  = teamEra  !== null ? teamEra  + 0.40 : null;
                  bullpenWhip = teamWhip !== null ? teamWhip + 0.08 : null;
                }
              } catch { /* non-blocking */ }

              // ── Sprint speed from Savant ───────────────────────────────
              const sprintSpeed = parseFloat(savant?.sprint_speed ?? "0") || null;

              const rawScore = scoreHitter(
                { ...stats, bats },
                pitcherSplits,
                savant,
                sav15d,
                sav30d,
                oppPitcherSavant,
                total,
                { tempF, windMph, windOut, windIn, humidity, precipInches, isDome },
                venue,
                bvp,
                lineupSlot,
                oppPitcherSeasonStats,
                side === "home",
                pitchMatchup,
                venueCareerAvg,
                venueCareerAB,
                vsTeamAvg,
                vsTeamAB,
                goAoRatio,
                venueCareerSlg,
                venueCareerHrRate,
                venueCareerIso,
                isDay,
                bullpenEra,
                bullpenWhip,
                sprintSpeed,
              );

              // ── Calibrated probability (Phase 1: logistic sigmoid) ──────
              // Replaces raw × 1.333. Logistic is fit on observed MLB hit rates:
              // sigmoid params: center=0.50 (average hitter), scale=5.0
              // Maps: raw 0.35 → ~54%, raw 0.50 → 62%, raw 0.60 → 69%, raw 0.70 → 75%
              const logisticCal = (r: number) => {
                const logit = 5.0 * (r - 0.50);
                const sig   = 1 / (1 + Math.exp(-logit));
                // Rescale from (0.27, 0.73) to (0.45, 0.82) — MLB hit rate range
                return 0.45 + sig * 0.37;
              };
              const hitProbabilityBase = Math.min(0.80, logisticCal(rawScore));

              // ── MLB Analytics boost (Steamer + park factor + BvP extended + weather + pitcher proj) ──
              // Run in parallel with existing scoring; wraps hit probability post-logistic
              let analyticsBoostMult = 1.0;
              let analyticsNote      = "";
              let steamerProj: any   = null;
              let projectedStats: any = null;
              try {
                const opponentPidForAnalytics = side === "home" ? awayTeam.probablePitcher?.id : homeTeam.probablePitcher?.id;
                const [pkFactor, wxData, bvpExt, pitcherAn] = await Promise.all([
                  getParkFactor(venue),
                  getStadiumWeather(venue, game.gameDate ? new Date(game.gameDate).getTime() : undefined),
                  opponentPidForAnalytics ? getBvpExtended(pid, opponentPidForAnalytics) : Promise.resolve(null),
                  opponentPidForAnalytics ? getPitcherAnalytics(opponentPidForAnalytics) : Promise.resolve(null),
                ]);
                const steamerBatter = getSteamerBatter(String(pid));
                steamerProj = steamerBatter;
                const { boost, note } = computeAnalyticsBoost(steamerBatter, pkFactor, bvpExt, wxData, pitcherAn);
                analyticsBoostMult = boost;
                // Extend the note with venue career avg + vs-team avg
                const noteParts: string[] = note ? [note] : [];
                if (venueCareerAvg !== null && venueCareerAB >= 10) {
                  const venueAvgStr = venueCareerAvg.toFixed(3).replace("0.", ".");
                  let venueNote = `Career .${venueAvgStr.replace(".","")} at ${venue} (${venueCareerAB} AB)`;
                  if (venueCareerSlg !== null) {
                    const slgStr = venueCareerSlg.toFixed(3).replace("0.", ".");
                    venueNote += ` / .${slgStr.replace(".","")} SLG`;
                  }
                  if (venueCareerIso !== null && venueCareerIso >= 0.120) {
                    venueNote += ` ⚡ Power park`;
                  } else if (venueCareerIso !== null && venueCareerIso < 0.080) {
                    venueNote += ` 🟡 Singles park`;
                  }
                  noteParts.push(venueNote);
                }
                if (vsTeamAvg !== null && vsTeamAB >= 5) {
                  const oppName = side === "home" ? (awayTeam.team?.name ?? "opponent") : (homeTeam.team?.name ?? "opponent");
                  const vsStr = vsTeamAvg.toFixed(3).replace("0.", ".");
                  noteParts.push(`${vsTeamAB} AB vs ${oppName} this season (.${vsStr.replace(".","")})`);
                }
                if (goAoRatio < 0.80) noteParts.push(`Fly-ball hitter (GO/AO ${goAoRatio.toFixed(2)})`);
                else if (goAoRatio > 1.30) noteParts.push(`Ground-ball hitter (GO/AO ${goAoRatio.toFixed(2)})`);
                // BvP note: show avg + OPS vs today's starter when signal is meaningful
                if (bvp.avg !== null && bvp.ab >= 10) {
                  const bvpAvgStr = bvp.avg.toFixed(3).replace("0.", ".");
                  const bvpOpsVal = (bvp as any).ops as number | null ?? null;
                  let bvpNote = `${bvp.hits}-for-${bvp.ab} (.${bvpAvgStr.replace(".","")}) vs today's starter`;
                  if (bvpOpsVal !== null) {
                    bvpNote += ` | OPS ${bvpOpsVal.toFixed(3)}`;
                  }
                  if (bvp.signal === "elite") {
                    bvpNote = `ELITE MATCHUP: ` + bvpNote;
                  } else if (bvp.signal === "strong") {
                    bvpNote = `Strong BvP: ` + bvpNote;
                  } else if (bvp.signal === "weak") {
                    bvpNote = `Weak BvP: ` + bvpNote;
                  }
                  noteParts.unshift(bvpNote); // put BvP first in the note
                }
                analyticsNote = noteParts.join(" · ") || "Standard conditions";
                // Projected per-game stats for explanation drawer
                projectedStats = getProjectedGameStats(String(pid), venue, opponentPidForAnalytics ? String(opponentPidForAnalytics) : undefined);
              } catch (analyticsErr: any) {
                console.warn(`[BTS] analytics boost error pid=${pid}: ${analyticsErr.message}`);
              }

              // Apply analytics boost — caps at ±10% of base probability
              const hitProbability = Math.min(0.82, Math.max(0.45,
                hitProbabilityBase * analyticsBoostMult
              ));
              const hitProbabilityPct = Math.round(hitProbability * 100);

              // ── Sportsbook edge filter ────────────────────────────────────
              // Compare model probability to implied book probability.
              // Edge = model - implied. Positive edge = bet. No odds = no filter.
              const playerNameKey = fullName.toLowerCase();
              const impliedProb   = hitPropImpliedMap[playerNameKey] ?? null;
              const edge          = impliedProb !== null ? hitProbability - impliedProb : null;
              // Tier thresholds: A needs edge >= +6%, B >= +3%, C >= 0%
              // If no book line: include based on model score alone (edge = null)
              const hasPositiveEdge = edge === null || edge >= 0;
              if (!hasPositiveEdge) { console.log(`[BTS] edge filter OUT: ${fullName} pid=${pid} edge=${edge !== null ? Math.round(edge*100) : "n/a"}% implied=${impliedProb !== null ? Math.round(impliedProb*100) : "n/a"}%`); continue; } // negative edge = skip

              // ── Confidence tier (Phase 1: incorporates edge + slot + probability) ──
              const confTierBTS: "A" | "B" | "C" = (() => {
                const edgePct = (edge ?? 0) * 100;
                if (hitProbabilityPct >= 68 && lineupSlot <= 4 && edgePct >= 6) return "A";
                if (hitProbabilityPct >= 64 && edgePct >= 3) return "B";
                return "C";
              })();

              // ── Gate 3: Minimum calibrated hit probability ────────────────
              if (hitProbabilityPct < MIN_HIT_PROBABILITY) { console.log(`[BTS] prob filter OUT: ${fullName} pid=${pid} prob=${hitProbabilityPct} raw=${rawScore.toFixed(3)}`); continue; }

              const playerLineupSource = p.lineupSource ?? lineupSrc;

              console.log(`[BTS] CANDIDATE: ${fullName} pid=${pid} prob=${hitProbabilityPct} tier=${confTierBTS} slot=${lineupSlot} bats=${bats}`);
              candidates.push({
                playerId: pid,
                name: fullName,
                team: teamName,
                side,
                bats,
                lineupSlot,
                lineupSource: playerLineupSource,
                isScratched,
                isOverridePick,
                opponentPitcher: side === "home"
                  ? { name: awayTeam.probablePitcher?.fullName ?? "TBD", id: awayTeam.probablePitcher?.id, hand: "R" }
                  : { name: homeTeam.probablePitcher?.fullName ?? "TBD", id: homeTeam.probablePitcher?.id, hand: "R" },
                pitcherAvgAllowed: pitcherAvgVsMe,
                bvp: { avg: bvp.avg, hits: bvp.hits, ab: bvp.ab, signal: bvp.signal },
                pitcherStats: {
                  era:             oppPitcherSeasonStats?.era              ?? null,
                  last5ERA:        oppPitcherSeasonStats?.last5ERA         ?? null,
                  last3ERA:        oppPitcherSeasonStats?.last3ERA         ?? null,   // Phase 2
                  last3AvgIP:      oppPitcherSeasonStats?.last3AvgIP       ?? null,   // Phase 2
                  last3H9:         oppPitcherSeasonStats?.last3H9          ?? null,   // Phase 2
                  leashProbability:oppPitcherSeasonStats?.leashProbability ?? null,   // Phase 2
                  k9:              oppPitcherSeasonStats?.k9               ?? null,
                  whip:            oppPitcherSeasonStats?.whip             ?? null,
                  ip:              oppPitcherSeasonStats?.ip               ?? 0,
                  xba:        parseFloat(oppPitcherSavant?.xba              ?? "0") || null,
                  xwoba:      parseFloat(oppPitcherSavant?.xwoba            ?? "0") || null,
                  hardHitPct: parseFloat(oppPitcherSavant?.hard_hit_percent ?? "0") || null,
                  gbPct:      parseFloat(oppPitcherSavant?.groundballs_percent    ?? "0") || null,
                  fbPct:      parseFloat(oppPitcherSavant?.flyballs_percent     ?? "0") || null,
                  swStrPct:   parseFloat(oppPitcherSavant?.p_swinging_strike_perc ?? "0") || null,
                  pitcherKPct:parseFloat(oppPitcherSavant?.k_percent             ?? "0") || null,
                  pitcherBbPct:parseFloat(oppPitcherSavant?.bb_percent           ?? "0") || null,
                },
                stats: {
                  avg14:      stats.avg14,
                  avg30:      stats.avg30,
                  avg7:       stats.avg7,
                  avgSeason:  stats.avgSeason,
                  babip14:    stats.babip14,
                  ghp14:      stats.ghp14,
                  kPct:       stats.kPct,
                  bbPct:      stats.bbPct,
                  xba:        parseFloat(savant?.xba               ?? "0") || null,
                  xwoba:      parseFloat(savant?.xwoba             ?? "0") || null,
                  hardHitPct: parseFloat(savant?.hard_hit_percent  ?? "0") || null,
                  barrelPct:  parseFloat(savant?.barrel_batted_rate ?? "0") || null,
                  launchAngle:parseFloat(savant?.launch_angle_avg  ?? "0") || null,
                  xbabip:     parseFloat(savant?.xbabip            ?? "0") || null,
                  whiffPct:   parseFloat(savant?.whiff_percent    ?? "0") || null,
                  zContactPct:parseFloat(savant?.z_contact_percent ?? "0") || null,
                  sprintSpeed:parseFloat(savant?.sprint_speed     ?? "0") || null,
                  ozContactPct:parseFloat(savant?.oz_contact_percent ?? "0") || null,
                  avgHome:    stats.avgHome ?? null,
                  avgAway:    stats.avgAway ?? null,
                  // Phase 3 additions:
                  avgDay:     stats.avgDay    ?? null,
                  avgNight:   stats.avgNight  ?? null,
                  hitStreak:  stats.hitStreak ?? 0,
                  bullpenEra: bullpenEra      ?? null,
                  bullpenWhip: bullpenWhip    ?? null,
                  isDay:      isDay,
                  // Phase 2: rolling Statcast windows
                  xba15d:     parseFloat(sav15d?.xba               ?? "0") || null,
                  xwoba15d:   parseFloat(sav15d?.xwoba             ?? "0") || null,
                  hardHit15d: parseFloat(sav15d?.hard_hit_percent  ?? "0") || null,
                  xba30d:     parseFloat(sav30d?.xba               ?? "0") || null,
                  xwoba30d:   parseFloat(sav30d?.xwoba             ?? "0") || null,
                  hardHit30d: parseFloat(sav30d?.hard_hit_percent  ?? "0") || null,
                  // Phase 2: pitch-type matchup score
                  pitchTypeMatchup: pitchMatchup !== null ? Math.round(pitchMatchup * 100) : null,
                  // PlayerIntel signals
                  venueCareerAvg:    venueCareerAvg    !== null ? parseFloat(venueCareerAvg.toFixed(3))    : null,
                  venueCareerAB,
                  venueCareerSlg:    venueCareerSlg    !== null ? parseFloat(venueCareerSlg.toFixed(3))    : null,
                  venueCareerHrRate: venueCareerHrRate !== null ? parseFloat(venueCareerHrRate.toFixed(4))  : null,
                  venueCareerIso:    venueCareerIso    !== null ? parseFloat(venueCareerIso.toFixed(3))    : null,
                  vsTeamAvg:         vsTeamAvg         !== null ? parseFloat(vsTeamAvg.toFixed(3))         : null,
                  vsTeamAB,
                  goAoRatio:         parseFloat(goAoRatio.toFixed(2)),
                },
                gamelog: stats.gamelog,
                game: {
                  matchup:     slateEntry.matchup,
                  total,
                  venue,
                  gameTime:    localTime,
                  gameStartMs: gameDate ? new Date(gameDate).getTime() : null,
                  weather: {
                    tempF, wind, windMph, windDir: sw?.windDir ?? "",
                    windOut, windIn, humidity, precipInches, isDome,
                    impactLabel, impactTier, hitterImpact,
                  },
                },
                rawScore,
                hitProbability:  hitProbabilityPct,
                impliedProb:     impliedProb !== null ? Math.round(impliedProb * 100) : null,
                edge:            edge !== null ? Math.round(edge * 100) : null,
                inTargetRange:   hitProbability >= 0.60 && hitProbability <= 0.80,
                confidenceTier:  confTierBTS,
                // MLB Analytics layer
                analyticsBoost:  parseFloat(analyticsBoostMult.toFixed(3)),
                analyticsNote,
                steamerProjection: steamerProj ? {
                  projAVG:     steamerProj.avg,
                  projOBP:     steamerProj.obp,
                  projSLG:     steamerProj.slg,
                  projwOBA:    steamerProj.woba,
                  projHperGame: steamerProj.hPerGame,
                  projHRperGame:steamerProj.hrPerGame,
                  projRperGame: steamerProj.rPerGame,
                  projRBIperGame:steamerProj.rbiPerGame,
                  projTBperGame: steamerProj.tbPerGame,
                  wrcPlus:     steamerProj.wrcPlus,
                  war:         steamerProj.war,
                } : null,
                projectedGameStats: projectedStats,
              });
            } catch (playerErr: any) { console.warn(`[BTS] player scoring error pid=${p.id ?? p.person?.id} team=${teamName} slot=${slotIdx}: ${playerErr.message}`); }
          }
          return candidates;
        };

        const [homeCandidates, awayCandidates] = await Promise.all([
          buildCandidates(homePlayers, "home", awaySplits, homeTeam.team?.name ?? "", homeLineupSource, awaySeasonStats, awayPitcherSavant),
          buildCandidates(awayPlayers, "away", homeSplits, awayTeam.team?.name ?? "", awayLineupSource, homeSeasonStats, homePitcherSavant),
        ]);

        candidatePicks.push(...homeCandidates, ...awayCandidates);
        console.log(`[BTS] game=${slateEntry.matchup} home=${homeCandidates.length} away=${awayCandidates.length} candidates`);

        } catch (gameErr: any) {
          console.warn(`[BTS] game processing error for ${slateEntry?.matchup ?? game.gamePk}: ${gameErr.message}`);
        }
      }

      console.log(`[BTS] game loop complete — totalCandidates=${candidatePicks.length}`);

      // ── 7b. Daily candidate log (Phase 1) ────────────────────────────
      // Logs every scored candidate with features, scores, edge, and decision.
      // Written to server/bts_logs/YYYY-MM-DD.json for backtesting + calibration.
      try {
        const logDir  = path.join(__dirname, "bts_logs");
        const logPath = path.join(logDir, `${targetDate}.json`);
        let existing: any[] = [];
        try {
          if (fs.existsSync(logPath)) existing = JSON.parse(fs.readFileSync(logPath, "utf8"));
        } catch {}
        const existingIds = new Set(existing.map((e: any) => e.playerId));
        const newEntries  = candidatePicks
          .filter((p: any) => !existingIds.has(p.playerId))
          .map((p: any) => ({
            loggedAt:       new Date().toISOString(),
            date:           targetDate,
            playerId:       p.playerId,
            name:           p.name,
            team:           p.team,
            lineupSlot:     p.lineupSlot,
            side:           p.side,
            bats:           p.bats,
            rawScore:       p.rawScore,
            hitProbability: p.hitProbability,
            confTier:       p.confidenceTier,
            isOverride:     p.isOverridePick,
            impliedProb:    p.impliedProb,
            edge:           p.edge,
            avg14:          p.stats?.avg14,
            avg30:          p.stats?.avg30,
            ghp14:          p.stats?.ghp14,
            avgSeason:      p.stats?.avgSeason,
            xba:            p.stats?.xba,
            xwoba:          p.stats?.xwoba,
            kPct:           p.stats?.kPct,
            whiffPct:       p.stats?.whiffPct,
            zContactPct:    p.stats?.zContactPct,
            hardHitPct:     p.stats?.hardHitPct,
            barrelPct:      p.stats?.barrelPct,
            launchAngle:    p.stats?.launchAngle,
            pitcherXwoba:    p.pitcherStats?.xwoba,
            pitcherLast5ERA: p.pitcherStats?.last5ERA,
            pitcherLast3ERA: p.pitcherStats?.last3ERA,        // Phase 2
            pitcherLeash:    p.pitcherStats?.leashProbability, // Phase 2
            xba15d:          p.stats?.xba15d,                 // Phase 2
            xwoba15d:        p.stats?.xwoba15d,               // Phase 2
            xba30d:          p.stats?.xba30d,                 // Phase 2
            xwoba30d:        p.stats?.xwoba30d,               // Phase 2
            pitchTypeMatchup:p.stats?.pitchTypeMatchup,       // Phase 2
            venue:           p.game?.venue,
            gameTotal:       p.game?.total,
            result:          "pending",
            hits:            null,
            ab:              null,
          }));
        if (newEntries.length > 0) {
          if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
          fs.writeFileSync(logPath, JSON.stringify([...existing, ...newEntries], null, 2));
        }
      } catch (logErr) { /* non-fatal — log failure doesn't block picks */ }

      // ── 8. One-per-team rule + hard 15-pick cap ─────────────────────
      // Filter out any players the owner manually removed today
      const todayExcluded = btsExcludedByDate[targetDate] ?? new Set<number>();
      if (todayExcluded.size > 0) {
        candidatePicks = candidatePicks.filter((p: any) => !todayExcluded.has(p.playerId));
      }
      // CRITICAL: only allow candidates whose game has NOT started yet
      // This prevents replacing a scratched player with someone already mid-game
      const nowMsForCandidates = Date.now();
      candidatePicks = candidatePicks.filter((p: any) => {
        const startMs = p.game?.gameStartMs ?? null;
        if (!startMs) return true; // no start time known — include
        return nowMsForCandidates < startMs; // only future games
      });
      // ── Repeat-appearance penalty + form re-weighting ─────────────────────
      // Rule: A player cannot appear 2 days in a row UNLESS their analysis
      // is "near-perfect" — meaning ALL key signals strongly align.
      // Near-perfect = rawScore >= 0.68 AND all of these hold:
      //   1. L7 avg >= season avg + 0.050 (hot last 7)
      //   2. L14 avg >= season avg + 0.030 (sustained form)
      //   3. BvP signal is "Elite" or "Strong" (good matchup vs this pitcher)
      //   4. rawScore >= 0.68 (top-tier composite score)
      //   5. ghp14 >= 0.65 (getting on base at a strong clip recently)
      // If NOT near-perfect, repeat players are blocked entirely (not just penalized).
      // MAX_REPEATS cap still applies even for near-perfect players (max 3).

      const yesterdayStr = (() => {
        const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return d.toLocaleDateString("en-CA");
      })();
      const yesterdayIds = new Set<number>(
        (btsPicksCache[yesterdayStr] ?? []).map((e: BtsPickEntry) => e.playerId)
      );

      // Helper: determine if a repeat player qualifies as "near-perfect"
      function isNearPerfectRepeat(p: any): boolean {
        const snap       = p.snapshot ?? {};
        const stats      = snap.stats ?? {};
        const rawScore   = snap.rawScore ?? p.rawScore ?? 0;
        const avg7       = stats.avg7   ?? p.avg7   ?? null;
        const avg14      = stats.avg14  ?? p.avg14  ?? null;
        const ghp14      = stats.ghp14  ?? p.ghp14  ?? null;
        const seasonAvg  = stats.avgSeason ?? p.avgSeason ?? 0.260;
        // bvp.signal stored as lowercase ("elite","strong","weak","none")
        // at p.bvp.signal or snap.bvp.signal
        const bvpSignal  = (snap.bvp?.signal ?? p.bvp?.signal ?? "").toLowerCase();

        // Must have a high composite score
        if (rawScore < 0.68) return false;
        // Must be hot recently (L7 above season pace)
        if (avg7 === null || avg7 < seasonAvg + 0.050) return false;
        // Must have sustained form (L14 also above season pace)
        if (avg14 === null || avg14 < seasonAvg + 0.030) return false;
        // Must be getting on base consistently
        if (ghp14 === null || ghp14 < 0.65) return false;
        // Must have a favorable BvP matchup (elite or strong vs this specific pitcher)
        const goodBvp = bvpSignal === "elite" || bvpSignal === "strong";
        if (!goodBvp) return false;
        // All criteria met — this is a genuine near-perfect pick
        return true;
      }

      for (const p of candidatePicks) {
        const avg7      = p.snapshot?.stats?.avg7   ?? p.avg7   ?? null;
        const avg14     = p.snapshot?.stats?.avg14  ?? p.avg14  ?? null;
        const ghp14     = p.snapshot?.stats?.ghp14  ?? p.ghp14  ?? null;
        const seasonAvg = p.snapshot?.stats?.avgSeason ?? p.avgSeason ?? 0.260;

        let formMult = 1.0;
        if (avg7  !== null && avg7  >= seasonAvg + 0.060) formMult += 0.025;
        if (avg14 !== null && avg14 >= seasonAvg + 0.040) formMult += 0.020;
        if (ghp14 !== null && ghp14 >= 0.70)              formMult += 0.015;
        if (avg7  !== null && avg7  <= seasonAvg - 0.060) formMult -= 0.030;
        if (avg14 !== null && avg14 <= seasonAvg - 0.040) formMult -= 0.020;

        const isRepeat      = yesterdayIds.has(p.playerId);
        const nearPerfect   = isRepeat ? isNearPerfectRepeat(p) : false;

        if (isRepeat && !nearPerfect) {
          // Block outright — will be filtered in the carry-over cap below
          formMult -= 0.25; // heavy penalty ensures they fall below any real candidate
        } else if (isRepeat && nearPerfect) {
          // Near-perfect repeat: still apply a small penalty so they don't crowd out
          // genuinely fresh picks, but allow them through if they truly stand out
          formMult -= 0.02;
          p._nearPerfectRepeat = true;
        }

        const hpDecimal  = p.hitProbability / 100;
        const hpAdjusted = Math.min(0.82, Math.max(0.45, hpDecimal * formMult));
        p.hitProbability     = hpAdjusted;
        p.hitProbabilityPct  = Math.round(hpAdjusted * 100);
        p._repeatYesterday   = isRepeat;
      }

      // Sort: override picks last, then by adjusted probability
      candidatePicks.sort((a, b) => {
        if (a.isOverridePick !== b.isOverridePick) return a.isOverridePick ? 1 : -1;
        return b.hitProbability - a.hitProbability;
      });

      // ── Carry-over cap ──────────────────────────────────────────────────────
      // Non-near-perfect repeat players are blocked outright (heavy formMult penalty
      // pushes them to the bottom, and this gate hard-blocks them as a safety net).
      // Near-perfect repeats are allowed through but capped at MAX_REPEATS (3).
      const seenTeams  = new Set<string>();
      const freshPicks: any[] = [];
      let repeatCount = 0;
      const MAX_REPEATS = 3; // absolute max carry-overs even for near-perfect repeats
      for (const p of candidatePicks) {
        if (seenTeams.has(p.team)) continue;
        // Hard block: repeat player who did NOT qualify as near-perfect
        if (p._repeatYesterday && !p._nearPerfectRepeat) continue;
        // Cap near-perfect repeats at 3 total
        if (p._repeatYesterday && repeatCount >= MAX_REPEATS) continue;
        seenTeams.add(p.team);
        freshPicks.push(p);
        if (p._repeatYesterday) repeatCount++;
        if (freshPicks.length >= 10) break;
      }

      // ── Merge into the daily persistent cache ──────────────────────────
      // Rule: once a player is in today's cache they stay ALL day.
      // New players from freshPicks can be added (up to the 10-cap).
      // Existing cached players are NEVER removed.
      if (!btsPicksCache[targetDate]) {
        btsPicksCache[targetDate] = [];
      }
      const cachedEntries = btsPicksCache[targetDate];
      const cachedIds = new Set(cachedEntries.map((e: BtsPickEntry) => e.playerId));

      for (const pick of freshPicks) {
        if (cachedIds.has(pick.playerId)) {
          // Already cached — refresh snapshot + probability but keep lockedAt/result
          const existing = cachedEntries.find((e: BtsPickEntry) => e.playerId === pick.playerId)!;
          existing.snapshot       = pick;
          existing.hitProbability = pick.hitProbability;
          continue;
        }
        if (cachedEntries.length >= (targetDate === "2026-05-06" ? 15 : 10)) break; // 15 cap on 5/6/26 only, 10 all other days
        cachedEntries.push({
          playerId:       pick.playerId,
          name:           pick.name,
          team:           pick.team,
          hitProbability: pick.hitProbability,
          lockedAt:       new Date().toISOString(),
          result:         "pending",
          hits:           null,
          ab:             null,
          gradedAt:       null,
          gradedFinal:    false,
          snapshot:       pick,
        } as BtsPickEntry);
        saveBtsPicksCache(); // persist new pick immediately
        cachedIds.add(pick.playerId);
      }


      // ── Scratch-swap: replace confirmed-scratched picks before game starts ─────
      // Rule: if a cached pick's player is confirmed NOT in the official lineup
      // AND the game hasn't started yet → swap them with the best available
      // candidate from the same team who IS confirmed in the lineup.
      // This override applies even after the 11:45 AM CT deadline because
      // a player being out of the lineup is a data-confirmed fact, not a guess.
      const nowMsForSwap = Date.now();
      for (let ci = 0; ci < cachedEntries.length; ci++) {
        const entry = cachedEntries[ci];
        const snap  = entry.snapshot;
        if (!snap) continue;

        // Only swap if the pick is scratched AND the game hasn't started yet
        // (don't swap in-progress or already-graded picks)
        const gameStartMs = snap.game?.gameStartMs ?? null;
        const gameStarted = gameStartMs ? nowMsForSwap >= gameStartMs : false;
        if (!snap.isScratched || gameStarted) continue;
        if (entry.result !== "pending") continue; // already graded — leave alone

        // Find the best replacement: same team, confirmed in lineup, not already cached
        const cachedIdSet = new Set(cachedEntries.map((e: BtsPickEntry) => e.playerId));
        const replacement = candidatePicks
          .filter(c =>
            c.team === snap.team &&                     // same team
            c.playerId !== snap.playerId &&             // not the same player
            !cachedIdSet.has(c.playerId) &&            // not already cached
            c.lineupSource === "confirmed" &&           // must be in confirmed lineup
            !c.isScratched                             // definitely not scratched
          )
          .sort((a: any, b: any) => b.hitProbability - a.hitProbability)[0] ?? null;

        if (!replacement) {
          console.log(`[BTS Scratch-Swap] No confirmed replacement for scratched ${snap.name} (${snap.team}) — keeping slot`);
          continue;
        }

        console.log(`[BTS Scratch-Swap] Replacing scratched ${snap.name} → ${replacement.name} (${snap.team}) pre-game`);

        // Replace in-place — keep the original lockedAt timestamp
        cachedEntries[ci] = {
          playerId:       replacement.playerId,
          name:           replacement.name,
          team:           replacement.team,
          hitProbability: replacement.hitProbability,
          lockedAt:       entry.lockedAt,   // preserve original lock time
          result:         "pending",
          hits:           null,
          ab:             null,
          gradedAt:       null,
          gradedFinal:    false,
          snapshot:       { ...replacement, swappedFrom: snap.name, swapReason: "scratched_from_lineup" },
        } as BtsPickEntry;
      }

      // Persist any scratch-swaps made above
      if (cachedEntries.some((e: BtsPickEntry) => e.snapshot?.swapReason === "scratched_from_lineup")) {
        saveBtsPicksCache();
      }

      // ── Run grader on today's cached picks ────────────────────────────
      await runBtsGrader(targetDate);

      // Rebuild topPicks from cache so display order = entry order (pick added first = rank 1)
      const topPicks: any[] = cachedEntries.map((e: BtsPickEntry) => {
        const snap = e.snapshot ?? {};
        // Normalise hitProbability — always a whole number (0–100).
        // Source priority: snapshot (full pick object) > BtsPickEntry.hitProbability (DB integer).
        // Guard: if value is a strict decimal (has fractional part and < 2), multiply by 100.
        // Values of 1 or 2 from a corrupted DB store are treated as whole-number 1% or 2%.
        // Compute correct hitProbability pct from rawScore when available.
        // rawScore → logistic → probability. This is always accurate per-player.
        // Fallback chain: recompute from rawScore > hitProbabilityPct > hitProbability.
        // The stored snap.hitProbability may be the cap value (0.82) for old picks.
        const snapRawScore = snap.rawScore ?? null;
        const logisticFromRaw = (r: number) => {
          const logit = 5.0 * (r - 0.50);
          const sig   = 1 / (1 + Math.exp(-logit));
          return Math.round((0.45 + sig * 0.37) * 100); // whole-number pct
        };
        const recomputedProb = snapRawScore != null ? logisticFromRaw(snapRawScore) : null;
        const rawProb = snap.hitProbabilityPct ?? snap.hitProbability ?? e.hitProbability ?? null;
        const storedNorm = rawProb != null
          ? (rawProb > 0 && rawProb < 2 && !Number.isInteger(rawProb)
              ? Math.round(rawProb * 100)
              : Math.round(rawProb))
          : null;
        // If stored value is the cap (82) and we have rawScore, prefer recomputed
        const normProb = (storedNorm === 82 && recomputedProb != null && recomputedProb !== 82)
          ? recomputedProb
          : (storedNorm ?? recomputedProb);
        return {
          ...snap,
          hitProbability: normProb,
          result:    e.result,
          hits:      e.hits,
          ab:        e.ab,
          gradedAt:  e.gradedAt,
          lockedAt:  e.lockedAt,
        };
      });


      // ── 9. Generate AI-style summary per pick (2–4 sentences + bullets) ────────
      for (const pick of topPicks) {
        const p = pick;
        if (!p.stats) continue;  // guard: skip if snapshot missing stats (malformed entry)
        const avg14Str  = p.stats.avg14  ? "." + Math.round(p.stats.avg14  * 1000).toString().padStart(3, "0") : null;
        const avg7Str   = p.stats.avg7   ? "." + Math.round(p.stats.avg7   * 1000).toString().padStart(3, "0") : null;
        const xbaStr    = p.stats.xba    ? "." + Math.round(p.stats.xba    * 1000).toString().padStart(3, "0") : null;
        const pitcherStr = p.pitcherAvgAllowed ? "." + Math.round(p.pitcherAvgAllowed * 1000).toString().padStart(3, "0") : null;
        const side = p.bats === "L" ? "left-handed batters" : "right-handed batters";
        const pitcherName = p.opponentPitcher?.name ?? "today's starter";

        // ─ Opening sentence ─
        let opening = "";
        if (p.stats.avg14 >= 0.300) {
          opening = `🔥 ${p.name} is absolutely locked in, hitting ${avg14Str} over the last 14 days — one of the hottest bats on today's slate.`;
        } else if (p.stats.avg14 >= 0.280) {
          opening = `⚡ ${p.name} is in strong form, raking at ${avg14Str} over the last 14 days with consistent plate appearances.`;
        } else if (p.stats.avg14 >= 0.250) {
          opening = `📊 ${p.name} is putting together solid numbers, batting ${avg14Str} across the last two weeks.`;
        } else if (p.isOverridePick) {
          opening = `⚠️ ${p.name} is in a cold stretch at ${avg14Str} over the last 14 days but is here on a **Statcast override** — elite underlying contact metrics and a highly hittable matchup forced the model’s hand.`;
        } else {
          opening = `🧊 ${p.name} is in a bit of a cold stretch at ${avg14Str} over the last 14 days, but the matchup and underlying metrics still offer value today.`;
        }

        // ─ Bullet points (collect the strongest signals) ─
        const bullets: string[] = [];

        // GHP
        if (p.stats.ghp14 !== undefined && p.stats.ghp14 !== null) {
          const ghpPct = Math.round(p.stats.ghp14 * 100);
          if (ghpPct >= 80) bullets.push(`💥 Hit in **${ghpPct}%** of the last 14 games (elite streak consistency)`);
          else if (ghpPct >= 65) bullets.push(`✅ Recorded a hit in **${ghpPct}%** of the last 14 games`);
          else if (ghpPct >= 50) bullets.push(`📅 Got a hit in **${ghpPct}%** of L14 games`);
        }

        // 7d hot streak
        if (avg7Str && p.stats.avg7 >= 0.300) {
          bullets.push(`🔥 Hitting **${avg7Str}** over the last 7 days — currently in peak hot-streak territory`);
        }

        // Pitcher matchup
        if (pitcherStr) {
          if (p.pitcherAvgAllowed >= 0.290) {
            bullets.push(`🎯 Faces **${pitcherName}**, who allows **.${Math.round(p.pitcherAvgAllowed*1000).toString().padStart(3,"0")}** BA vs ${side} — a highly favorable matchup`);
          } else if (p.pitcherAvgAllowed >= 0.260) {
            bullets.push(`⚡ Opponent **${pitcherName}** allows **${pitcherStr}** to ${side} this season`);
          } else if (p.pitcherAvgAllowed < 0.230) {
            bullets.push(`⚠️ **${pitcherName}** is tough on ${side} (**${pitcherStr}** BA allowed) — matchup is the key risk here`);
          }
        }

        // Statcast quality
        if (xbaStr && p.stats.xba >= 0.310) {
          bullets.push(`📊 Statcast xBA of **${xbaStr}** confirms he's hitting the ball with elite quality, not just luck`);
        } else if (xbaStr && p.stats.xba >= 0.290) {
          bullets.push(`📊 Strong Statcast xBA **${xbaStr}** — quality of contact backs up the surface stats`);
        }
        if (p.stats.hardHitPct && p.stats.hardHitPct >= 45) {
          bullets.push(`🔨 **${p.stats.hardHitPct.toFixed(0)}%** hard-hit rate — consistently barreling the ball at 95+ mph`);
        } else if (p.stats.hardHitPct && p.stats.hardHitPct >= 38) {
          bullets.push(`🔨 **${p.stats.hardHitPct.toFixed(0)}%** hard-hit rate keeps him in play as a quality-contact pick`);
        }

        // xwOBA
        if (p.stats.xwoba && p.stats.xwoba >= 0.370) {
          bullets.push(`🎯 xwOBA of **.${Math.round(p.stats.xwoba*1000).toString().padStart(3,"0")}** ranks him among the best hitters in the game right now`);
        }

        // Game environment
        if (p.game?.total >= 10) {
          bullets.push(`🏙️ High-total game (O/U ${p.game.total}) — offenses are expected to produce today`);
        } else if (p.game?.total >= 9) {
          bullets.push(`🏙️ Game total set at ${p.game.total} — favorable run environment`);
        }

        // Weather note — uses structured weather impact
        if (p.game?.weather) {
          const w = p.game.weather;
          if (w.isDome) {
            // dome: no weather bullet
          } else if (w.impactTier === "major" || w.impactTier === "moderate") {
            bullets.push(w.impactLabel);
            if (w.precipInches >= 0.05) bullets.push(`🌧️ Rain in forecast — watch for postponement`);
          } else if (w.tempF >= 75) {
            bullets.push(`☀️ Warm ${w.tempF}°F — hitter-friendly conditions${w.windMph > 5 ? " · wind " + w.windMph + "mph " + w.windDir : ""}`);
          } else if (w.tempF <= 50) {
            bullets.push(`🥶 Cold ${w.tempF}°F at first pitch — can suppress offense`);
          } else if (w.windMph >= 8 && (w.windOut || w.windIn)) {
            bullets.push(w.impactLabel);
          }
        }

        // Lineup confirmation bonus
        if (p.lineupSource === "confirmed") {
          bullets.push(`✅ Officially confirmed in today's batting order — no lineup risk`);
        } else {
          bullets.push(`📡 Projected in lineup based on recent batting order — confirm before locking in`);
        }

        // Cap bullets to 4 for readability
        const finalBullets = bullets.slice(0, 4);

        // Assemble full summary
        pick.rationale = opening + "\n" + finalBullets.map(b => `• ${b}`).join("\n");
      }

      // ── Deadline + 30-min pre-game lock logic ──────────────────────────────
      const nowMs    = Date.now();
      const ctNow    = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const ctHour   = ctNow.getHours();
      const ctMin    = ctNow.getMinutes();
      const THIRTY_MIN_MS = 30 * 60 * 1000;

      // Past 11:45 AM CT → global deadline crossed
      const pastDeadline = ctHour > 11 || (ctHour === 11 && ctMin >= 45);

      // Annotate each pick with its individual lock state:
      //   locked = true  → pick is on the card and cannot be removed until day ends
      //   locked = false → pick can still update (before 11:45 AND >30 min before game)
      //   eligible = false → game already started (>0 min past first pitch) — hide pick
      const annotatedPicks = topPicks.map(p => {
        const startMs    = p.game?.gameStartMs ?? null;
        const minsToGame = startMs ? (startMs - nowMs) / 60000 : Infinity;
        const gameStarted = startMs ? nowMs >= startMs : false;

        // Pick is locked once either condition is met:
        //   1. Past 11:45 AM CT global deadline, OR
        //   2. Within 30 min of this specific game's first pitch
        const locked = pastDeadline || minsToGame <= 30;

        // Pick is eligible to show as long as game hasn't started
        // (once the game is live/complete the pick stays visible all day —
        //  we only hide if it's >0 min past start AND past today entirely)
        return { ...p, locked, minsToGame: Math.round(minsToGame), gameStarted };
      });

      // After global deadline: ALL cached picks stay on card all day
      // Before global deadline: only keep picks whose game hasn't started yet
      //   (but any pick that came in via the cache — i.e. was previously locked—
      //    always stays visible regardless of game start status)
      const finalPicks = annotatedPicks.filter(p => {
        // Always show a pick once it's been graded (result known) or locked
        if (p.locked || p.result === "win" || p.result === "loss") return true;
        // Before deadline: hide a pick only if the game has already started AND
        // the pick was never locked in (pre-deadline, no lineup yet)
        if (!pastDeadline && p.gameStarted && !p.locked) return false;
        return true;
      });

      const confirmedCount = finalPicks.filter(p => p.lineupSource === "confirmed").length;
      const projectedCount = finalPicks.filter(p => p.lineupSource === "projected").length;
      const scratchedCount = finalPicks.filter(p => p.isScratched).length;

      // Season record (accumulated across all in-memory graded picks)
      const todayWins    = cachedEntries.filter((e: BtsPickEntry) => e.result === "win").length;
      const todayLosses  = cachedEntries.filter((e: BtsPickEntry) => e.result === "loss").length;
      const todayPending = cachedEntries.filter((e: BtsPickEntry) => e.result === "pending").length;
      const todayWinPct  = (todayWins + todayLosses) > 0
        ? Math.round((todayWins / (todayWins + todayLosses)) * 100)
        : null;

      const seasonTotal   = btsSeasonRecord.wins + btsSeasonRecord.losses;
      const seasonWinPct  = seasonTotal > 0
        ? Math.round((btsSeasonRecord.wins / seasonTotal) * 100)
        : null;

      res.json({
        date:          targetDate,
        generatedAt:   new Date().toISOString(),
        pastDeadline,
        nowMs,
        confirmedCount,
        projectedCount,
        scratchedCount,
        slate:        slateGames,
        picks:        finalPicks,
        bestPick:     finalPicks[0] ?? null,
        doubleDowns:  finalPicks.slice(1, 4),
        dataLimited:  games.filter((g: any) => !g.teams?.home?.probablePitcher || !g.teams?.away?.probablePitcher).length,
        // Grading / record data
        todayRecord:  { wins: todayWins, losses: todayLosses, pending: todayPending, winPct: todayWinPct },
        seasonRecord: { wins: btsSeasonRecord.wins, losses: btsSeasonRecord.losses, winPct: seasonWinPct },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/bts/reanalyze (owner only)
  // Removes picks for today's date where the game hasn't started and the
  // result is still pending, then returns a cleared list so the next
  // GET /api/bts-picks re-runs a fresh analysis.
  // Picks where the game is in-progress or complete are NEVER removed.
  // ─────────────────────────────────────────────────────────────────────
  // POST /api/bts/inject — owner-only: force-add specific players into today's cache immediately
  // Body: { players: [{ playerId, name, team, hitProbability }] }
  app.post("/api/bts/inject", requireOwner, async (req, res) => {
    try {
      const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const targetDate = [
        ctNow.getFullYear(),
        String(ctNow.getMonth() + 1).padStart(2, "0"),
        String(ctNow.getDate()).padStart(2, "0"),
      ].join("-");
      const players: any[] = req.body?.players ?? [];
      if (!players.length) return res.status(400).json({ error: "players array required" });
      if (!btsPicksCache[targetDate]) btsPicksCache[targetDate] = [];
      const cache = btsPicksCache[targetDate];
      const existingIds = new Set(cache.map((e: BtsPickEntry) => e.playerId));
      const added: string[] = [];
      for (const p of players) {
        if (existingIds.has(p.playerId)) { continue; }
        if (cache.length >= (targetDate === "2026-05-06" ? 15 : 10)) break; // 15 cap on 5/6/26 only, 10 all other days
        cache.push({
          playerId:       p.playerId,
          name:           p.name,
          team:           p.team ?? "",
          hitProbability: p.hitProbability ?? 70,
          lockedAt:       new Date().toISOString(),
          result:         "pending",
          hits:           null,
          ab:             null,
          gradedAt:       null,
          gradedFinal:    false,
          snapshot:       { playerId: p.playerId, name: p.name, team: p.team, hitProbability: p.hitProbability, manuallyAdded: true },
        } as BtsPickEntry);
        existingIds.add(p.playerId);
        added.push(p.name);
      }
      saveBtsPicksCache();
      console.log(`[BTS] Injected by owner: ${added.join(", ")}`);
      res.json({ ok: true, added, total: cache.length, date: targetDate });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/bts/override-result — owner only
  // Body: { playerId, date?, result: 'win'|'loss'|'pending', hits?, ab? }
  // Overrides the graded result for an already-graded BTS pick.
  // Only applicable to picks with result === 'win' or 'loss'.
  // ─────────────────────────────────────────────────────────────────────
  app.post("/api/bts/override-result", requireOwner, async (req, res) => {
    try {
      const { playerId, result, hits, ab, date } = req.body ?? {};
      if (!playerId || !result) return res.status(400).json({ error: "playerId and result required" });
      if (!["win", "loss", "pending"].includes(result)) return res.status(400).json({ error: "result must be win, loss, or pending" });

      const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const targetDate = date ?? [
        ctNow.getFullYear(),
        String(ctNow.getMonth() + 1).padStart(2, "0"),
        String(ctNow.getDate()).padStart(2, "0"),
      ].join("-");

      const cache: BtsPickEntry[] = btsPicksCache[targetDate] ?? [];
      const pick = cache.find(e => e.playerId === Number(playerId));
      if (!pick) return res.status(404).json({ error: "Pick not found for that date" });

      const prevResult = pick.result;
      pick.result    = result as any;
      pick.hits      = hits   ?? pick.hits;
      pick.ab        = ab     ?? pick.ab;
      pick.gradedAt  = new Date().toISOString();

      // Recalculate season record
      let wins = 0, losses = 0;
      for (const [, entries] of Object.entries(btsPicksCache)) {
        for (const e of entries as BtsPickEntry[]) {
          if (e.result === "win")  wins++;
          else if (e.result === "loss") losses++;
        }
      }
      btsSeasonRecord.wins   = wins;
      btsSeasonRecord.losses = losses;

      saveBtsPicksCache();

      // Persist to DB
      await db.query(
        `UPDATE bts_picks SET result=$1, hits=$2, ab=$3, graded_at=NOW() WHERE pick_date=$4 AND player_id=$5`,
        [result, pick.hits ?? null, pick.ab ?? null, targetDate, playerId]
      ).catch(() => {});

      console.log(`[BTS] Owner override: ${pick.name} ${prevResult} → ${result} on ${targetDate}`);
      res.json({ ok: true, playerId, name: pick.name, prevResult, newResult: result });
    } catch (e: any) {
      console.error("[BTS] override-result error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/bts/remove-player — owner only
  // Body: { playerId: number, name: string }
  // Removes a single pending pre-game pick and excludes them from today's
  // re-generation so BTS can find a replacement on the next GET /api/bts-picks.
  // ─────────────────────────────────────────────────────────────────────
  const btsExcludedByDate: Record<string, Set<number>> = {};

  app.post("/api/bts/remove-player", requireOwner, async (req, res) => {
    try {
      const { playerId, name } = req.body ?? {};
      if (!playerId) return res.status(400).json({ error: "playerId required" });

      const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const targetDate = [
        ctNow.getFullYear(),
        String(ctNow.getMonth() + 1).padStart(2, "0"),
        String(ctNow.getDate()).padStart(2, "0"),
      ].join("-");

      const nowMs = Date.now();
      const existing: BtsPickEntry[] = btsPicksCache[targetDate] ?? [];
      const pick = existing.find(e => e.playerId === Number(playerId));

      if (!pick) return res.status(404).json({ error: `Player not found in today's picks` });

      // Block removal if already graded or game in progress
      const snap = pick.snapshot as any;
      const gameStartMs: number | null = snap?.game?.gameStartMs ?? snap?.gameStartMs ?? null;
      const gameState: string = snap?.game?.state ?? snap?.state ?? "";
      const isGraded  = pick.result !== "pending";
      const isPlaying = gameState === "in_progress" || gameState === "in" ||
                        (gameStartMs != null && nowMs > gameStartMs + 10 * 60_000);

      // Allow removal of graded picks too (owner override from Insights)
      // Allow removal even if game is in progress (owner may be catching a late scratch)

      // Remove from in-memory cache
      btsPicksCache[targetDate] = existing.filter(e => e.playerId !== Number(playerId));

      // Recalculate season record after removal
      let wins = 0, losses = 0;
      for (const [, entries] of Object.entries(btsPicksCache)) {
        for (const e of entries as BtsPickEntry[]) {
          if (e.result === "win")  wins++;
          else if (e.result === "loss") losses++;
        }
      }
      btsSeasonRecord.wins   = wins;
      btsSeasonRecord.losses = losses;

      // Add to exclusion set so re-generation skips them today
      if (!btsExcludedByDate[targetDate]) btsExcludedByDate[targetDate] = new Set();
      btsExcludedByDate[targetDate].add(Number(playerId));

      // Persist removal to DB (any result)
      await db.query(
        `DELETE FROM bts_picks WHERE pick_date=$1 AND player_id=$2`,
        [targetDate, playerId]
      ).catch(() => {});

      saveBtsPicksCache();

      console.log(`[BTS] Owner removed ${name ?? pick.name} (#${playerId}) from ${targetDate} picks. Excluded for re-gen.`);

      res.json({
        ok: true,
        removed: name ?? pick.name,
        remaining: btsPicksCache[targetDate].length,
        message: `${name ?? pick.name} removed. Refresh BTS picks to find a replacement.`,
      });
    } catch (e: any) {
      console.error("[BTS] remove-player error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/bts/reanalyze", requireOwner, async (req, res) => {
    try {
      const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const targetDate = [
        ctNow.getFullYear(),
        String(ctNow.getMonth() + 1).padStart(2, "0"),
        String(ctNow.getDate()).padStart(2, "0"),
      ].join("-");

      const nowMs = Date.now();
      const existing: BtsPickEntry[] = btsPicksCache[targetDate] ?? [];

      // Keep picks where: result is NOT pending (graded win/loss/no_game)
      // OR game is already in-progress (gameStartMs in past by more than 10 min).
      // Remove picks where result is still pending AND game has not started yet.
      const kept: BtsPickEntry[] = [];
      const removed: string[] = [];

      for (const entry of existing) {
        const snap = entry.snapshot as any;
        const gameStartMs: number | null = snap?.game?.gameStartMs ?? snap?.gameStartMs ?? null;
        const gameState: string  = snap?.game?.state ?? snap?.state ?? "";
        const isGraded  = entry.result !== "pending";
        const isPlaying = gameState === "in_progress" || gameState === "in" ||
                          (gameStartMs != null && nowMs > gameStartMs + 10 * 60_000);

        if (isGraded || isPlaying) {
          kept.push(entry);
        } else {
          removed.push(entry.name ?? (entry as any).playerName ?? String(entry.playerId));
        }
      }

      // Update the in-memory cache
      btsPicksCache[targetDate] = kept;

      // Persist the cleared cache to DB + disk
      saveBtsPicksCache();

      // Also remove cleared rows from bts_picks table
      if (removed.length > 0 && existing.length > kept.length) {
        const keptIds = kept.map(e => e.playerId);
        await db.query(
          `DELETE FROM bts_picks WHERE pick_date = $1 AND player_id != ALL($2::int[]) AND result = 'pending'`,
          [targetDate, keptIds]
        ).catch(() => { /* non-fatal */ });
      }

      console.log(`[BTS] Reanalyze by owner: removed ${removed.length} picks (${removed.join(", ")}), kept ${kept.length}`);

      res.json({
        ok: true,
        date: targetDate,
        removed: removed.length,
        removedNames: removed,
        kept: kept.length,
        message: removed.length === 0
          ? "No eligible picks to remove — all picks are graded or their game is in progress."
          : `Removed ${removed.length} pre-game pick${removed.length > 1 ? "s" : ""}. Refresh BTS to get fresh analysis.`,
      });
    } catch (e: any) {
      console.error("[BTS] reanalyze error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/bts/regrade-all — owner only
  // Forces a full re-grade of every historical BTS pick from the MLB
  // game log API. Bypasses the alreadyGraded guard and the ON CONFLICT
  // guard so wrong results (e.g. premature 0-for-1 losses) are corrected.
  // Only writes when gradePickForDate returns isFinal=true.
  // ─────────────────────────────────────────────────────────────────────
  app.post("/api/bts/regrade-all", requireOwner, async (_req, res) => {
    try {
      const dates = Object.keys(btsPicksCache).sort();
      if (dates.length === 0) {
        return res.json({ ok: true, message: "No picks in cache to regrade.", dates: [] });
      }
      console.log(`[BTS Regrade-All] Starting regrade for ${dates.length} date(s): ${dates.join(", ")}`);
      const results: Record<string, string> = {};
      for (const dateStr of dates) {
        const before = (btsPicksCache[dateStr] ?? []).map((e: BtsPickEntry) => ({
          name: e.name, result: e.result, hits: e.hits, ab: e.ab,
        }));
        await runBtsGrader(dateStr, true);
        const after = (btsPicksCache[dateStr] ?? []).map((e: BtsPickEntry) => ({
          name: e.name, result: e.result, hits: e.hits, ab: e.ab,
        }));
        const changed = JSON.stringify(before) !== JSON.stringify(after);
        results[dateStr] = changed ? "updated" : "no_change";
        console.log(`[BTS Regrade-All] ${dateStr}: ${results[dateStr]}`);
      }
      reconcileSeasonRecord();
      saveBtsPicksCache();
      const updatedCount = Object.values(results).filter(v => v === "updated").length;
      console.log(`[BTS Regrade-All] Complete. ${updatedCount}/${dates.length} dates had corrections.`);
      res.json({
        ok: true,
        message: `Regrade complete. ${updatedCount} of ${dates.length} date(s) had corrections.`,
        results,
      });
    } catch (e: any) {
      console.error("[BTS] regrade-all error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/bts-analytics — aggregated win-rate splits across all historical picks
  // Used by the BTS Analytics panel on the client.
  app.get("/api/bts-analytics", async (_req, res) => {
    try {
      const allDays = Object.entries(btsPicksCache)
        .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
        .sort(([a], [b]) => a.localeCompare(b));

      type Split = { wins: number; total: number };
      const mk = (): Split => ({ wins: 0, total: 0 });
      const add = (s: Split, result: string) => { s.total++; if (result === "win") s.wins++; };
      const pct = (s: Split) => s.total ? Math.round(s.wins / s.total * 100) : null;

      // Grouped splits
      const byDow:  Record<string, Split> = {};
      const bySlot: Record<string, Split> = {};
      const byBvp:  Record<string, Split> = {};
      const byTier: Record<string, Split> = {};
      const byBats: Record<string, Split> = {};
      const bySide: Record<string, Split> = {};
      const byProb: Record<string, Split> = {};
      const byDay:  Record<string, Split> = {};
      const byDate: { date: string; wins: number; losses: number; pct: number }[] = [];
      const probBands = ["60-64%","65-69%","70-74%","75-79%","80-84%","85%+"];

      for (const [date, entries] of allDays) {
        const dt = new Date(date + "T12:00:00Z");
        const dow = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dt.getUTCDay()];
        let dayW = 0, dayL = 0;

        for (const e of (entries as BtsPickEntry[])) {
          const r = e.result;
          if (r !== "win" && r !== "loss") continue;
          const snap: any = (e as any).snapshot ?? {};
          const stats: any = snap.stats ?? {};

          // Day of week
          if (!byDow[dow]) byDow[dow] = mk();
          add(byDow[dow], r);

          // Lineup slot
          const slot = snap.lineupSlot ?? null;
          if (slot) {
            const key = `Slot ${slot}`;
            if (!bySlot[key]) bySlot[key] = mk();
            add(bySlot[key], r);
          }

          // BvP signal
          const bvpSig = snap.bvp?.signal ?? "none";
          if (!byBvp[bvpSig]) byBvp[bvpSig] = mk();
          add(byBvp[bvpSig], r);

          // Confidence tier
          const tier = snap.confidenceTier ?? null;
          if (tier) {
            if (!byTier[tier]) byTier[tier] = mk();
            add(byTier[tier], r);
          }

          // Bats handedness
          const bats = snap.bats ?? null;
          if (bats) {
            const bKey = bats === "L" ? "Left" : bats === "R" ? "Right" : "Switch";
            if (!byBats[bKey]) byBats[bKey] = mk();
            add(byBats[bKey], r);
          }

          // Home vs Away
          const side = snap.side ?? null;
          if (side) {
            const sKey = side === "home" ? "Home" : "Away";
            if (!bySide[sKey]) bySide[sKey] = mk();
            add(bySide[sKey], r);
          }

          // Day vs Night (Phase 3 — may be null for older picks)
          const isDayGame = snap.isDay ?? null;
          if (isDayGame !== null) {
            const dnKey = isDayGame ? "Day" : "Night";
            if (!byDay[dnKey]) byDay[dnKey] = mk();
            add(byDay[dnKey], r);
          }

          // Probability bands
          const prob = snap.hitProbabilityPct ?? null;
          if (prob !== null) {
            const band = prob >= 85 ? "85%+" : prob >= 80 ? "80-84%" : prob >= 75 ? "75-79%"
                       : prob >= 70 ? "70-74%" : prob >= 65 ? "65-69%" : "60-64%";
            if (!byProb[band]) byProb[band] = mk();
            add(byProb[band], r);
          }

          if (r === "win") dayW++; else dayL++;
        }

        if (dayW + dayL > 0) {
          byDate.push({ date, wins: dayW, losses: dayL, pct: Math.round(dayW / (dayW + dayL) * 100) });
        }
      }

      // Format splits as sorted arrays
      const fmt = (map: Record<string, Split>, order?: string[]) => {
        const keys = order ?? Object.keys(map).sort();
        return keys.filter(k => map[k]).map(k => ({
          label: k,
          wins:  map[k].wins,
          total: map[k].total,
          pct:   pct(map[k]),
        }));
      };

      const DOW_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
      const SLOT_ORDER = Array.from({length:9},(_,i)=>`Slot ${i+1}`);
      const BVP_ORDER  = ["elite","strong","none"];
      const TIER_ORDER = ["A+","A","B","C"];

      res.json({
        total: allDays.reduce((s,[,e]) => s + (e as BtsPickEntry[]).filter(p => p.result==="win"||p.result==="loss").length, 0),
        byDow:  fmt(byDow, DOW_ORDER),
        bySlot: fmt(bySlot, SLOT_ORDER),
        byBvp:  fmt(byBvp, BVP_ORDER),
        byTier: fmt(byTier, TIER_ORDER),
        byBats: fmt(byBats, ["Left","Right","Switch"]),
        bySide: fmt(bySide, ["Home","Away"]),
        byDay:  fmt(byDay,  ["Day","Night"]),
        byProb: fmt(byProb, probBands),
        byDate: byDate.reverse(), // most recent first
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/bts-history — all historical BTS picks grouped by date
  // Survives redeployments via bts_picks.json persisted to GitHub.
  // ─────────────────────────────────────────────────────────────────────
  app.get("/api/bts-history", async (_req, res) => {
    try {
      await Promise.race([getMLPullPromise(), new Promise(r => setTimeout(r, 30000))]);
      // Build a list of days sorted descending, each with picks + record
      const days = Object.entries(btsPicksCache)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, entries]) => {
          const wins    = (entries as BtsPickEntry[]).filter(e => e.result === "win").length;
          const losses  = (entries as BtsPickEntry[]).filter(e => e.result === "loss").length;
          const pending = (entries as BtsPickEntry[]).filter(e => e.result === "pending").length;
          const winPct  = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null;
          const normalizedPicks = (entries as BtsPickEntry[]).map(e => {
            const snap = (e as any).snapshot ?? {};
            // Recompute from rawScore when stored value is the cap (0.82 → 82 for everyone)
            const snapRawScore2 = snap.rawScore ?? null;
            const logisticFromRaw2 = (r: number) => {
              const logit = 5.0 * (r - 0.50);
              const sig   = 1 / (1 + Math.exp(-logit));
              return Math.round((0.45 + sig * 0.37) * 100);
            };
            const recomputedProb2 = snapRawScore2 != null ? logisticFromRaw2(snapRawScore2) : null;
            const rawProb = snap.hitProbabilityPct ?? snap.hitProbability ?? e.hitProbability ?? null;
            const storedNorm2 = rawProb != null
              ? (rawProb > 0 && rawProb < 2 && !Number.isInteger(rawProb)
                  ? Math.round(rawProb * 100)
                  : Math.round(rawProb))
              : null;
            const normProb = (storedNorm2 === 82 && recomputedProb2 != null && recomputedProb2 !== 82)
              ? recomputedProb2
              : (storedNorm2 ?? recomputedProb2);
            return { ...e, hitProbability: normProb };
          });
          return { date, picks: normalizedPicks, wins, losses, pending, winPct };
        });

      const totalWins   = btsSeasonRecord.wins;
      const totalLosses = btsSeasonRecord.losses;
      const seasonWinPct = (totalWins + totalLosses) > 0
        ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : null;

      // Yesterday: most recent fully-graded day (no pending picks)
      const fullyGraded = days.filter(d => d.pending === 0 && (d.wins + d.losses) > 0);
      const yesterdayDay = fullyGraded[0] ?? null;

      res.json({
        days,
        seasonRecord:    { wins: totalWins, losses: totalLosses, winPct: seasonWinPct },
        yesterdayRecord: yesterdayDay
          ? { date: yesterdayDay.date, wins: yesterdayDay.wins, losses: yesterdayDay.losses, winPct: yesterdayDay.winPct }
          : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message, days: [], seasonRecord: { wins: 0, losses: 0, winPct: null }, yesterdayRecord: null });
    }
  });


  // ════════════════════════════════════════════════════════════════════
  // CLUBHOUSE IQ AUTO-STREAK
  // Runs its own Beat-the-Streak attempt separate from user picks.
  // Each day it selects 1 or 2 players. If 1 pick: must get a hit to
  // advance by 1. If 2 picks (double-down): BOTH must get a hit to
  // advance by 2, otherwise streak resets to 0. Goal: reach 57 (beat 56).
  // ════════════════════════════════════════════════════════════════════

  const CIQ_STREAK_PATH = path.join(__dirname, "ml_data", "ciq_streak.json");

  async function loadCiqStreak() {
    try {
      if (fs.existsSync(CIQ_STREAK_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(CIQ_STREAK_PATH, "utf-8"));
        Object.assign(ciqStreakState, parsed);
        console.log(`[CIQ Streak] Loaded from disk: streak=${ciqStreakState.currentStreak}`);
        return;
      }
      const row = await db.queryOne(`SELECT content FROM ml_data_store WHERE filename='ciq_streak.json'`);
      if (row) {
        Object.assign(ciqStreakState, JSON.parse(row.content));
        console.log(`[CIQ Streak] Loaded from DB: streak=${ciqStreakState.currentStreak}`);
      }
    } catch (e: any) { console.warn("[CIQ Streak] Load failed:", e.message); }
  }

  function saveCiqStreak() {
    const json = JSON.stringify(ciqStreakState, null, 2);
    try {
      fs.mkdirSync(path.dirname(CIQ_STREAK_PATH), { recursive: true });
      fs.writeFileSync(CIQ_STREAK_PATH, json, "utf-8");
    } catch { /* non-fatal */ }
    db.query(
      `INSERT INTO ml_data_store (filename, content, updated_at) VALUES ('ciq_streak.json',$1,NOW())
       ON CONFLICT (filename) DO UPDATE SET content=$1, updated_at=NOW()`,
      [json]
    ).catch((e: any) => console.warn("[CIQ Streak] DB save:", e.message));
  }

  function ciqCtDateStr(): string {
    const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
    return `${ct.getFullYear()}-${String(ct.getMonth()+1).padStart(2,"0")}-${String(ct.getDate()).padStart(2,"0")}`;
  }

  // Select today's CIQ picks from the top scored BTS candidates already in btsPicksCache.
  // Double-down (2 picks) when top 2 are both high confidence (score ≥ 82 / 78).
  // Single pick otherwise.
  // Helper: compute display probability from a BtsPickEntry (uses rawScore when available)
  function computeEntryProb(e: BtsPickEntry): number {
    const snap = e.snapshot ?? {};
    const rawScore = snap.rawScore ?? null;
    if (rawScore != null) {
      const logit = 5.0 * (rawScore - 0.50);
      const sig   = 1 / (1 + Math.exp(-logit));
      return Math.round((0.45 + sig * 0.37) * 100);
    }
    // Fallback: use stored value
    const stored = snap.hitProbabilityPct ?? snap.hitProbability ?? e.hitProbability ?? null;
    if (stored == null) return 0;
    if (stored > 0 && stored < 2 && !Number.isInteger(stored)) return Math.round(stored * 100);
    return Math.round(stored);
  }

  async function selectCiqStreakPicksForDate(dateStr: string) {
    const existing = ciqStreakState.history.find(d => d.date === dateStr);
    if (existing) return existing;

    const cachedEntries = btsPicksCache[dateStr];
    if (!cachedEntries?.length) return null;

    // Sort by rawScore (most accurate) — avoids the 0.82-cap tie problem
    const scored = [...cachedEntries]
      .filter(e => e.snapshot != null)
      .sort((a, b) => {
        const aScore = (a.snapshot?.rawScore ?? 0);
        const bScore = (b.snapshot?.rawScore ?? 0);
        return bScore - aScore;
      });

    if (scored.length === 0) return null;

    const top1 = scored[0];
    const top2 = scored[1];
    const prob1 = computeEntryProb(top1);
    const prob2 = top2 ? computeEntryProb(top2) : 0;
    const isDouble = prob1 >= 75 && prob2 >= 72 && top2 != null;
    const chosen = isDouble ? [top1, top2] : [top1];

    const picks: CiqStreakPick[] = chosen.map(e => ({
      playerId: e.playerId,
      name:     e.name,
      team:     e.snapshot?.team ?? "",
      score:    computeEntryProb(e),
      result:   e.result === "win" ? "win" : e.result === "loss" ? "loss" : "pending",
      hits:     e.hits ?? null,
      ab:       e.ab ?? null,
      gradedAt: e.gradedAt ?? null,
    }));

    const dayEntry: CiqStreakDayEntry = {
      date:         dateStr,
      picks,
      isDouble,
      result:       "pending",
      streakBefore: ciqStreakState.currentStreak,
      streakAfter:  null,
    };

    ciqStreakState.history.push(dayEntry);
    ciqStreakState.lastPickDate = dateStr;
    saveCiqStreak();
    console.log(`[CIQ Streak] Picked for ${dateStr}: ${picks.map(p => p.name).join(" + ")} (${isDouble ? "double-down" : "single"}), streak in: ${dayEntry.streakBefore}`);
    return dayEntry;
  }

  // Grade CIQ streak picks by syncing from btsPicksCache after runBtsGrader runs.
  // If a CIQ pick player isn't in btsPicksCache for that date (e.g. carry-over from prior day),
  // falls back to MLB game-log API to get their hit result directly.
  async function gradeCiqStreakForDate(dateStr: string, force = false) {
    const dayEntry = ciqStreakState.history.find(d => d.date === dateStr);
    if (!dayEntry) return;
    // Skip already-graded entries unless forced (e.g. from regrade endpoint)
    if (!force && dayEntry.result !== "pending") return;

    const cachedEntries = btsPicksCache[dateStr] ?? [];
    let anyPending = false;

    for (const pick of dayEntry.picks) {
      if (pick.result === "win" || pick.result === "loss") continue; // already resolved

      // First try btsPicksCache
      const cached = cachedEntries.find(e => e.playerId === pick.playerId);
      if (cached) {
        if (cached.result === "win" || cached.result === "loss") {
          pick.result   = cached.result;
          pick.hits     = cached.hits ?? null;
          pick.ab       = cached.ab ?? null;
          pick.gradedAt = cached.gradedAt ?? null;
        } else {
          anyPending = true;
        }
        continue;
      }

      // Not in btsPicksCache — look up via MLB game-log API directly
      try {
        const glRes = await fetch(
          `https://statsapi.mlb.com/api/v1/people/${pick.playerId}/stats?stats=gameLog&season=${dateStr.slice(0,4)}&sportId=1`
        );
        const glData: any = await glRes.json();
        const splits: any[] = glData?.stats?.[0]?.splits ?? [];
        const gameSplit = splits.find((s: any) => s.date === dateStr);

        if (!gameSplit) {
          // No game log entry — could mean:
          //   a) game hasn't started yet (Preview/Pre-Game) → keep pending
          //   b) true DNP / off-day → loss
          // Check schedule for this player's team to distinguish.
          try {
            // Use the season-long game log to find the player's team, then check today's schedule
            const teamRes = await fetch(`https://statsapi.mlb.com/api/v1/people/${pick.playerId}?hydrate=currentTeam`);
            const teamData: any = await teamRes.json();
            const teamId = teamData?.people?.[0]?.currentTeam?.id;
            if (teamId) {
              const schRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&teamId=${teamId}`);
              const schData: any = await schRes.json();
              const todayGame = schData?.dates?.[0]?.games?.[0];
              if (todayGame) {
                const state = todayGame.status?.abstractGameState ?? "";
                if (state !== "Final") {
                  // Game exists but hasn't finished (Preview or Live) — keep pending
                  console.log(`[CIQ Streak] ${pick.name} game is ${state} on ${dateStr} — keeping pending`);
                  anyPending = true;
                  continue;
                }
                // Game is Final and no hits logged — true 0-for-something
                // The game log API may lag; treat as 0-for-0 loss
              }
              // No game at all for team today → true DNP → loss
            }
          } catch { /* non-fatal — fall through to loss */ }

          pick.result   = "loss";
          pick.hits     = 0;
          pick.ab       = 0;
          pick.gradedAt = new Date().toISOString();
          console.log(`[CIQ Streak] ${pick.name} had no game on ${dateStr} (DNP) → loss`);
          continue;
        }

        const hits = gameSplit.stat?.hits ?? 0;
        const ab   = gameSplit.stat?.atBats ?? 0;

        // Check if the game is Final before locking
        // Get gamePk from the split if available, then verify state
        const gamePk = gameSplit.game?.gamePk;
        let isFinal = false;
        if (gamePk) {
          try {
            const schRes = await fetch(
              `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${gamePk}`
            );
            const schData: any = await schRes.json();
            const gameInfo = schData?.dates?.[0]?.games?.[0];
            isFinal = gameInfo?.status?.abstractGameState === "Final";
          } catch { isFinal = false; }
        }

        // Always update live hit/ab so the card shows current stats even mid-game
        if (ab > 0 || hits > 0) {
          pick.hits = hits;
          pick.ab   = ab;
        }

        if (!isFinal) {
          // Game not over yet — keep pending, but only a win can be locked early
          if (hits >= 1) {
            // Has a hit already — lock as win immediately
            pick.result   = "win";
            pick.gradedAt = new Date().toISOString();
            console.log(`[CIQ Streak] MLB API: ${pick.name} on ${dateStr} → ${hits}-for-${ab} mid-game WIN (locked)`);
          } else {
            anyPending = true;
          }
          continue;
        }

        pick.result   = hits >= 1 ? "win" : "loss";
        pick.gradedAt = new Date().toISOString();
        console.log(`[CIQ Streak] MLB API fallback: ${pick.name} on ${dateStr} → ${hits}-for-${ab} → ${pick.result}`);
      } catch (e: any) {
        console.warn(`[CIQ Streak] MLB API fallback failed for ${pick.name}: ${e.message}`);
        anyPending = true;
      }
    }

    if (anyPending) return;

    const allWon = dayEntry.picks.every(p => p.result === "win");
    dayEntry.result = allWon ? "win" : "loss";

    if (allWon) {
      dayEntry.streakAfter     = dayEntry.streakBefore + dayEntry.picks.length;
      ciqStreakState.currentStreak = dayEntry.streakAfter;
      ciqStreakState.totalWins++;
    } else {
      dayEntry.streakAfter     = 0;
      ciqStreakState.currentStreak = 0;
      ciqStreakState.totalLosses++;
    }
    ciqStreakState.totalDays++;
    if (ciqStreakState.currentStreak > ciqStreakState.bestStreak)
      ciqStreakState.bestStreak = ciqStreakState.currentStreak;

    saveCiqStreak();
    console.log(`[CIQ Streak] ${dateStr}: ${dayEntry.result} → streak now ${ciqStreakState.currentStreak}`);
  }

  // Kick off CIQ streak load on server init
  loadCiqStreak().then(async () => {
    // After loading, grade any pending history entries using current btsPicksCache
    for (const entry of ciqStreakState.history) {
      if (entry.result === "pending") await gradeCiqStreakForDate(entry.date);
    }
  });

  // GET /api/bts/ciq-streak
  app.get("/api/bts/ciq-streak", async (_req, res) => {
    try {
      const todayStr = ciqCtDateStr();
      // Auto-pick today if we haven't yet and BTS picks are available
      if (ciqStreakState.lastPickDate !== todayStr) {
        await selectCiqStreakPicksForDate(todayStr);
      }
      // Re-grade any pending days (async — uses MLB API fallback for players not in btsPicksCache)
      for (const entry of ciqStreakState.history) {
        if (entry.result === "pending") await gradeCiqStreakForDate(entry.date);
      }
      const recentHistory = [...ciqStreakState.history]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30);
      res.json({
        currentStreak: ciqStreakState.currentStreak,
        bestStreak:    ciqStreakState.bestStreak,
        goal:          ciqStreakState.goal,
        totalDays:     ciqStreakState.totalDays,
        totalWins:     ciqStreakState.totalWins,
        totalLosses:   ciqStreakState.totalLosses,
        today:         ciqStreakState.history.find(d => d.date === todayStr) ?? null,
        history:       recentHistory,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/bts/reset-ciq-today — owner only
  // Removes today's CIQ streak pick so it can be repicked fresh.
  // Resets lastPickDate so selectCiqStreakPicksForDate will run again.
  // Does NOT affect streak history for prior days.
  app.post("/api/bts/reset-ciq-today", requireOwner, async (_req, res) => {
    try {
      const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const todayStr = `${ct.getFullYear()}-${String(ct.getMonth()+1).padStart(2,"0")}-${String(ct.getDate()).padStart(2,"0")}`;

      // Remove today's entry from history
      const before = ciqStreakState.history.length;
      ciqStreakState.history = ciqStreakState.history.filter(d => d.date !== todayStr);
      const removed = before - ciqStreakState.history.length;

      // Reset lastPickDate so it re-selects today
      if (ciqStreakState.lastPickDate === todayStr) {
        ciqStreakState.lastPickDate = null;
      }

      saveCiqStreak();

      // Immediately re-select today's pick
      await selectCiqStreakPicksForDate(todayStr).catch(() => {});

      const newToday = ciqStreakState.history.find(d => d.date === todayStr);
      res.json({
        ok: true,
        removed,
        todayStr,
        newPick: newToday ?? null,
        message: removed > 0
          ? `Today's CIQ pick reset. New pick: ${newToday?.picks?.map((p: any) => p.name).join(" + ") ?? "none yet"}`
          : "No today entry found to remove.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/bts/regrade-ciq-streak — owner only
  // Rebuilds the entire CIQ streak from scratch using the corrected
  // btsPicksCache. Re-syncs pick results, then replays the streak
  // counters chronologically so streakBefore/After/totals are accurate.
  // ─────────────────────────────────────────────────────────────────────
  app.post("/api/bts/regrade-ciq-streak", requireOwner, async (_req, res) => {
    try {
      // Step 1: Re-sync pick results — btsPicksCache first, MLB API fallback for carry-over players
      // Reset all non-resolved picks so gradeCiqStreakForDate can reprocess them
      for (const dayEntry of ciqStreakState.history) {
        // Always reset every day so gradeCiqStreakForDate can reprocess cleanly
        dayEntry.result = "pending";
        for (const pick of dayEntry.picks) {
          // Only reset picks that were graded (win or loss) — re-verify from cache / MLB API
          if (pick.result === "win" || pick.result === "loss") {
            pick.result   = "pending";
            pick.hits     = null;
            pick.ab       = null;
            pick.gradedAt = null;
          }
        }
      }
      // Now run gradeCiqStreakForDate for every entry with force=true
      // so already-graded entries are re-evaluated after the reset above
      for (const dayEntry of ciqStreakState.history) {
        await gradeCiqStreakForDate(dayEntry.date, true);
      }

      // Step 2: Sort history chronologically and replay streak counters
      const sorted = [...ciqStreakState.history].sort((a, b) => a.date.localeCompare(b.date));
      let streak    = 0;
      let best      = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let totalDays = 0;

      for (const dayEntry of sorted) {
        const anyPending = dayEntry.picks.some(p => p.result === "pending");
        if (anyPending) {
          // Not yet gradeable — keep as pending, carry streak forward unchanged
          dayEntry.streakBefore = streak;
          dayEntry.streakAfter  = null;
          dayEntry.result       = "pending";
          continue;
        }
        const allWon = dayEntry.picks.every(p => p.result === "win");
        dayEntry.streakBefore = streak;
        if (allWon) {
          streak += dayEntry.picks.length;
          dayEntry.streakAfter = streak;
          dayEntry.result      = "win";
          totalWins++;
        } else {
          streak = 0;
          dayEntry.streakAfter = 0;
          dayEntry.result      = "loss";
          totalLosses++;
        }
        totalDays++;
        if (streak > best) best = streak;
      }

      // Step 3: Commit rebuilt state
      ciqStreakState.history      = sorted;
      ciqStreakState.currentStreak = streak;
      ciqStreakState.bestStreak    = best;
      ciqStreakState.totalWins     = totalWins;
      ciqStreakState.totalLosses   = totalLosses;
      ciqStreakState.totalDays     = totalDays;
      saveCiqStreak();

      console.log(`[CIQ Streak Regrade] Complete. streak=${streak} best=${best} wins=${totalWins} losses=${totalLosses}`);
      res.json({
        ok: true,
        currentStreak: streak,
        bestStreak:    best,
        totalWins,
        totalLosses,
        totalDays,
        history: sorted.slice(-10).reverse(),
      });
    } catch (e: any) {
      console.error("[CIQ Streak Regrade] error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // GET /api/fantasy-intel  — Live fantasy intelligence across all sports
  // Sources: ESPN rosters/news/transactions, Sleeper player DB + trending
  // Cached 15 min server-side to avoid hammering free APIs
  // ════════════════════════════════════════════════════════════════════
  let fantasyIntelCache: { data: any; ts: number } | null = null;
  const FANTASY_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  app.get("/api/fantasy-intel", async (req, res) => {
    try {
      const sport = (req.query.sport as string || "ALL").toUpperCase();
      const forceRefresh = req.query.refresh === "1";

      // Serve cached if fresh
      if (!forceRefresh && fantasyIntelCache && Date.now() - fantasyIntelCache.ts < FANTASY_CACHE_TTL) {
        const cached = fantasyIntelCache.data;
        if (sport === "ALL") return res.json(cached);
        return res.json({ ...cached, players: cached.players.filter((p: any) => p.sport === sport) });
      }

      // ── 1. Sleeper player DB — full roster with team/position/status ──
      const [sleeperRes, sleeperTrendAddRes, sleeperTrendDropRes] = await Promise.all([
        fetch("https://api.sleeper.app/v1/players/nfl", { signal: AbortSignal.timeout(12000) }),
        fetch("https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=30", { signal: AbortSignal.timeout(8000) }),
        fetch("https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=48&limit=20", { signal: AbortSignal.timeout(8000) }),
      ]);

      const sleeperPlayers: Record<string, any> = sleeperRes.ok ? await sleeperRes.json() : {};
      const trendAdd: any[] = sleeperTrendAddRes.ok ? await sleeperTrendAddRes.json() : [];
      const trendDrop: any[] = sleeperTrendDropRes.ok ? await sleeperTrendDropRes.json() : [];
      const trendAddIds = new Set(trendAdd.map((t: any) => t.player_id));
      const trendDropIds = new Set(trendDrop.map((t: any) => t.player_id));

      // Build Sleeper lookup by full_name
      const sleeperByName: Record<string, any> = {};
      const sleeperById: Record<string, any> = {};
      for (const [pid, p] of Object.entries(sleeperPlayers)) {
        if (p.full_name) sleeperByName[p.full_name.toLowerCase()] = { ...p, sleeper_id: pid };
        sleeperById[pid] = { ...p, sleeper_id: pid };
      }

      // ── 2. ESPN news (all sports) — injuries, transactions, analysis ──
      const espnSports = [
        { sport: "NFL", path: "football/nfl" },
        { sport: "NBA", path: "basketball/nba" },
        { sport: "MLB", path: "baseball/mlb" },
        { sport: "NHL", path: "hockey/nhl" },
      ];

      const newsMap: Record<string, any[]> = {}; // playerName -> alerts[]
      const teamNewsMap: Record<string, any[]> = {}; // teamName -> alerts[]

      await Promise.all(espnSports.map(async ({ sport: sp, path }) => {
        try {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/news?limit=50`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return;
          const data = await r.json();
          for (const article of (data.articles || [])) {
            const headline = article.headline || "";
            const published = article.published || "";
            const link = article.links?.web?.href || "";
            const lower = headline.toLowerCase();

            // Categorize
            const isInjury = /injur|questionable|out|ruled|day-to-day|il |injured list|concussion|suspend|scratch|dnp/i.test(headline);
            const isTrade = /trade|deal|acquire|sent to|exchange/i.test(headline);
            const isDraft = /draft|pick|round|select/i.test(headline);
            const isSigning = /sign|contract|agree|ink|deal/i.test(headline);
            const isAnalysis = /outlook|breakout|bust|project|fantasy|must|start|sit|add|waiver/i.test(headline);
            const type = isInjury ? "injury" : isTrade ? "trade" : isDraft ? "draft" : isSigning ? "signing" : isAnalysis ? "analysis" : "news";

            const alert = { headline, published, type, sport: sp, link };

            // Map to athletes in article
            for (const cat of (article.categories || [])) {
              if (cat.type === "athlete") {
                const name = cat.athlete?.displayName || cat.description;
                if (name) {
                  if (!newsMap[name]) newsMap[name] = [];
                  newsMap[name].push(alert);
                }
              }
              if (cat.type === "team") {
                const tname = cat.team?.displayName || cat.description;
                if (tname) {
                  if (!teamNewsMap[tname]) teamNewsMap[tname] = [];
                  if (teamNewsMap[tname].length < 5) teamNewsMap[tname].push(alert);
                }
              }
            }
          }
        } catch (_) {}
      }));

      // ── 3. ESPN NFL transactions feed ──
      const transactions: any[] = [];
      try {
        const txRes = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?limit=40", { signal: AbortSignal.timeout(8000) });
        if (txRes.ok) {
          const txData = await txRes.json();
          for (const t of (txData.transactions || []).slice(0, 30)) {
            transactions.push({
              date: t.date,
              description: t.description,
              team: t.team?.abbreviation || "",
              teamName: t.team?.displayName || "",
              teamLogo: t.team?.logos?.[0]?.href || "",
            });
          }
        }
      } catch (_) {}

      // Also get NBA transactions
      try {
        const txRes = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/transactions?limit=20", { signal: AbortSignal.timeout(8000) });
        if (txRes.ok) {
          const txData = await txRes.json();
          for (const t of (txData.transactions || []).slice(0, 15)) {
            transactions.push({
              date: t.date,
              description: t.description,
              team: t.team?.abbreviation || "",
              teamName: t.team?.displayName || "",
              teamLogo: t.team?.logos?.[0]?.href || "",
              sport: "NBA",
            });
          }
        }
      } catch (_) {}

      // MLB transactions
      try {
        const txRes = await fetch("https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/transactions?limit=20", { signal: AbortSignal.timeout(8000) });
        if (txRes.ok) {
          const txData = await txRes.json();
          for (const t of (txData.transactions || []).slice(0, 15)) {
            transactions.push({
              date: t.date,
              description: t.description,
              team: t.team?.abbreviation || "",
              teamName: t.team?.displayName || "",
              teamLogo: t.team?.logos?.[0]?.href || "",
              sport: "MLB",
            });
          }
        }
      } catch (_) {}

      transactions.sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      // ── 4. ESPN rosters (NFL + NBA + MLB skill positions) ──
      // NFL team IDs
      const NFL_TEAMS: Record<string, string> = {
        "22":"ARI","1":"ATL","33":"BAL","2":"BUF","29":"CAR","3":"CHI","4":"CIN","5":"CLE",
        "6":"DAL","7":"DEN","8":"DET","9":"GB","34":"HOU","11":"IND","30":"JAX","12":"KC",
        "13":"LV","24":"LAC","14":"LAR","15":"MIA","16":"MIN","17":"NE","18":"NO","19":"NYG",
        "20":"NYJ","21":"PHI","23":"PIT","25":"SF","26":"SEA","27":"TB","10":"TEN","28":"WSH",
      };
      const NFL_TEAM_NAMES: Record<string, string> = {
        "22":"Arizona Cardinals","1":"Atlanta Falcons","33":"Baltimore Ravens","2":"Buffalo Bills",
        "29":"Carolina Panthers","3":"Chicago Bears","4":"Cincinnati Bengals","5":"Cleveland Browns",
        "6":"Dallas Cowboys","7":"Denver Broncos","8":"Detroit Lions","9":"Green Bay Packers",
        "34":"Houston Texans","11":"Indianapolis Colts","30":"Jacksonville Jaguars","12":"Kansas City Chiefs",
        "13":"Las Vegas Raiders","24":"Los Angeles Chargers","14":"Los Angeles Rams","15":"Miami Dolphins",
        "16":"Minnesota Vikings","17":"New England Patriots","18":"New Orleans Saints","19":"New York Giants",
        "20":"New York Jets","21":"Philadelphia Eagles","23":"Pittsburgh Steelers","25":"San Francisco 49ers",
        "26":"Seattle Seahawks","27":"Tampa Bay Buccaneers","10":"Tennessee Titans","28":"Washington Commanders",
      };

      const SKILL_POSITIONS_NFL = new Set(["QB","RB","WR","TE","K"]);
      const SKILL_POSITIONS_NBA = new Set(["PG","SG","SF","PF","C","G","F"]);
      const SKILL_POSITIONS_MLB = new Set(["SP","RP","C","1B","2B","3B","SS","LF","CF","RF","OF","DH","P"]);

      const players: any[] = [];

      // Fetch NFL rosters in parallel (all 32 teams)
      const nflRosterResults = await Promise.allSettled(
        Object.entries(NFL_TEAMS).map(async ([id, abbr]) => {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) return [];
          const data = await r.json();
          const teamName = NFL_TEAM_NAMES[id] || abbr;
          const result: any[] = [];
          for (const group of (data.athletes || [])) {
            for (const a of (group.items || [])) {
              const posAbbr = a.position?.abbreviation || "";
              if (!SKILL_POSITIONS_NFL.has(posAbbr)) continue;
              const name = a.displayName || "";
              const sleeperData = sleeperByName[name.toLowerCase()];
              const playerAlerts = newsMap[name] || [];
              const isTrendingAdd = sleeperData && trendAddIds.has(sleeperData.sleeper_id);
              const isTrendingDrop = sleeperData && trendDropIds.has(sleeperData.sleeper_id);
              const injuryAlert = playerAlerts.find((x: any) => x.type === "injury");
              const latestNews = playerAlerts[0] || null;
              const isRookie = (a.experience?.years ?? 99) === 0;

              result.push({
                id: `nfl-${a.id}`,
                espnId: a.id,
                name,
                sport: "NFL",
                team: abbr,
                teamName,
                position: posAbbr,
                jersey: a.jersey || null,
                status: a.status?.type || "active",
                injuryStatus: injuryAlert?.headline ? detectFantasyInjury(injuryAlert.headline) : (a.injuries?.[0]?.status || null),
                experience: a.experience?.years ?? null,
                isRookie,
                isTrendingAdd,
                isTrendingDrop,
                sleeperRank: sleeperData?.search_rank || null,
                newsAlerts: playerAlerts.slice(0, 3),
                latestNews,
                headshot: `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${a.id}.png&w=96&h=70&scale=crop`,
              });
            }
          }
          return result;
        })
      );

      for (const r of nflRosterResults) {
        if (r.status === "fulfilled") players.push(...r.value);
      }

      // ── 5. NBA rosters (sample top teams) ──
      const NBA_TEAM_IDS = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"];
      const nbaRosterResults = await Promise.allSettled(
        NBA_TEAM_IDS.map(async (id) => {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${id}/roster`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) return [];
          const data = await r.json();
          const teamAbbr = data.team?.abbreviation || id;
          const teamName = data.team?.displayName || id;
          const result: any[] = [];
          for (const a of (data.athletes || [])) {
            const posAbbr = a.position?.abbreviation || "";
            if (!SKILL_POSITIONS_NBA.has(posAbbr)) continue;
            const name = a.displayName || "";
            const playerAlerts = newsMap[name] || [];
            const injuryAlert = playerAlerts.find((x: any) => x.type === "injury");
            result.push({
              id: `nba-${a.id}`,
              espnId: a.id,
              name,
              sport: "NBA",
              team: teamAbbr,
              teamName,
              position: posAbbr,
              jersey: a.jersey || null,
              status: a.status?.type || "active",
              injuryStatus: injuryAlert?.headline ? detectFantasyInjury(injuryAlert.headline) : (a.injuries?.[0]?.status || null),
              experience: a.experience?.years ?? null,
              isRookie: (a.experience?.years ?? 99) === 0,
              isTrendingAdd: false,
              isTrendingDrop: false,
              newsAlerts: playerAlerts.slice(0, 3),
              latestNews: playerAlerts[0] || null,
              headshot: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${a.id}.png&w=96&h=70&scale=crop`,
            });
          }
          return result;
        })
      );
      for (const r of nbaRosterResults) {
        if (r.status === "fulfilled") players.push(...r.value);
      }

      // ── 6. MLB rosters ──
      const MLB_TEAM_IDS = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"];
      const mlbRosterResults = await Promise.allSettled(
        MLB_TEAM_IDS.map(async (id) => {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${id}/roster`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) return [];
          const data = await r.json();
          const teamAbbr = data.team?.abbreviation || id;
          const teamName = data.team?.displayName || id;
          const result: any[] = [];
          for (const a of (data.athletes || [])) {
            const posAbbr = a.position?.abbreviation || "";
            const name = a.displayName || "";
            const playerAlerts = newsMap[name] || [];
            const injuryAlert = playerAlerts.find((x: any) => x.type === "injury");
            result.push({
              id: `mlb-${a.id}`,
              espnId: a.id,
              name,
              sport: "MLB",
              team: teamAbbr,
              teamName,
              position: posAbbr,
              jersey: a.jersey || null,
              status: a.status?.type || "active",
              injuryStatus: injuryAlert?.headline ? detectFantasyInjury(injuryAlert.headline) : (a.injuries?.[0]?.status || null),
              experience: a.experience?.years ?? null,
              isRookie: (a.experience?.years ?? 99) === 0,
              isTrendingAdd: false,
              isTrendingDrop: false,
              newsAlerts: playerAlerts.slice(0, 3),
              latestNews: playerAlerts[0] || null,
              headshot: `https://a.espncdn.com/combiner/i?img=/i/headshots/mlb/players/full/${a.id}.png&w=96&h=70&scale=crop`,
            });
          }
          return result;
        })
      );
      for (const r of mlbRosterResults) {
        if (r.status === "fulfilled") players.push(...r.value);
      }

      // ── 7. NHL rosters ──
      const NHL_TEAM_IDS = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","32"];
      const nhlRosterResults = await Promise.allSettled(
        NHL_TEAM_IDS.map(async (id) => {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${id}/roster`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) return [];
          const data = await r.json();
          const teamAbbr = data.team?.abbreviation || id;
          const teamName = data.team?.displayName || id;
          const result: any[] = [];
          for (const a of (data.athletes || [])) {
            const posAbbr = a.position?.abbreviation || "";
            if (posAbbr === "G") return result; // skip goalies for now (not fantasy skill)
            const name = a.displayName || "";
            const playerAlerts = newsMap[name] || [];
            const injuryAlert = playerAlerts.find((x: any) => x.type === "injury");
            result.push({
              id: `nhl-${a.id}`,
              espnId: a.id,
              name,
              sport: "NHL",
              team: teamAbbr,
              teamName,
              position: posAbbr,
              jersey: a.jersey || null,
              status: a.status?.type || "active",
              injuryStatus: injuryAlert?.headline ? detectFantasyInjury(injuryAlert.headline) : (a.injuries?.[0]?.status || null),
              experience: a.experience?.years ?? null,
              isRookie: (a.experience?.years ?? 99) === 0,
              isTrendingAdd: false,
              isTrendingDrop: false,
              newsAlerts: playerAlerts.slice(0, 3),
              latestNews: playerAlerts[0] || null,
              headshot: `https://a.espncdn.com/combiner/i?img=/i/headshots/nhl/players/full/${a.id}.png&w=96&h=70&scale=crop`,
            });
          }
          return result;
        })
      );
      for (const r of nhlRosterResults) {
        if (r.status === "fulfilled") players.push(...r.value);
      }

      // ── 8. Inject trending signals ──
      // Sleeper trending applies to NFL only (they have Sleeper IDs)
      // Already flagged isTrendingAdd/Drop above for NFL

      // ── 9. Build team roster map (for team drill-down) ──
      const teamRosters: Record<string, any[]> = {};
      for (const p of players) {
        const key = `${p.sport}-${p.team}`;
        if (!teamRosters[key]) teamRosters[key] = [];
        teamRosters[key].push(p);
      }

      // ── 10. Headlines feed (top 20 fantasy-relevant stories) ──
      const headlines: any[] = [];
      for (const [, alerts] of Object.entries(newsMap)) {
        for (const a of alerts) {
          if (!headlines.find(h => h.headline === a.headline)) {
            headlines.push(a);
          }
        }
      }
      headlines.sort((a: any, b: any) => new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime());

      const result = {
        generatedAt: new Date().toISOString(),
        players,
        transactions: transactions.slice(0, 50),
        headlines: headlines.slice(0, 40),
        teamRosters,
        trendingAdd: trendAdd.slice(0, 10).map((t: any) => ({
          count: t.count,
          player: sleeperById[t.player_id] ? {
            name: sleeperById[t.player_id].full_name,
            position: sleeperById[t.player_id].position,
            team: sleeperById[t.player_id].team,
            sport: "NFL",
          } : null,
        })).filter((t: any) => t.player),
        trendingDrop: trendDrop.slice(0, 10).map((t: any) => ({
          count: t.count,
          player: sleeperById[t.player_id] ? {
            name: sleeperById[t.player_id].full_name,
            position: sleeperById[t.player_id].position,
            team: sleeperById[t.player_id].team,
            sport: "NFL",
          } : null,
        })).filter((t: any) => t.player),
      };

      // Cache it
      fantasyIntelCache = { data: result, ts: Date.now() };

      if (sport === "ALL") return res.json(result);
      return res.json({ ...result, players: result.players.filter((p: any) => p.sport === sport) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OWNER ADMIN PANEL — Sections 1-7
  // ═══════════════════════════════════════════════════════════════════════════

  // Helper: write audit log entry
  async function auditLog(actor: string, action: string, target?: string, detail?: string) {
    try {
      await db.query(`INSERT INTO audit_log (actor,action,target,detail) VALUES ($1,$2,$3,$4)`,
        [actor, action, target ?? null, detail ?? null]);
    } catch { /* non-fatal */ }
  }

  // ── Section 1: Enhanced user control ──────────────────────────────────────

  // GET /api/admin/users/:id/history — login history
  app.get("/api/admin/users/:id/history", requireOwner, async (req: Request, res: Response) => {
    const logs = await db.query(
      `SELECT action, detail, ts FROM audit_log WHERE target=$1 ORDER BY ts DESC LIMIT 30`,
      [req.params.id]
    );
    res.json(logs.rows);
  });

  // POST /api/admin/users/:id/refund — cancel and deactivate user
  app.post("/api/admin/users/:id/refund", requireOwner, async (req: Request, res: Response) => {
    const user = await db.queryOne(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
    if (!user) return res.status(400).json({ error: "User not found" });
    try {
      await db.query(`UPDATE users SET sub_status='cancelled', tier=NULL WHERE id=$1`, [req.params.id]);
      await auditLog((req as any).user?.email ?? "owner", "refund", req.params.id, `Cancelled by owner`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/users/:id/cancel — cancel membership
  app.post("/api/admin/users/:id/cancel", requireOwner, async (req: Request, res: Response) => {
    const user = await db.queryOne(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
    if (!user) return res.status(404).json({ error: "User not found" });
    try {
      await db.query(`UPDATE users SET sub_status='cancelled', tier=NULL WHERE id=$1`, [req.params.id]);
      await auditLog((req as any).user?.email ?? "owner", "cancel_sub", req.params.id, `Cancelled subscription`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/users/:id/extend-trial — extend trial by N days
  app.post("/api/admin/users/:id/extend-trial", requireOwner, async (req: Request, res: Response) => {
    const { days } = req.body ?? {};
    const d = parseInt(days);
    if (!d || d < 1 || d > 365) return res.status(400).json({ error: "Days must be 1-365" });
    const user = await db.queryOne(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const base = user.trial_expires && new Date(user.trial_expires) > new Date() ? new Date(user.trial_expires) : new Date();
    base.setDate(base.getDate() + d);
    await db.query(`UPDATE users SET trial_expires=$1, sub_status='active', tier='pro' WHERE id=$2`, [base, req.params.id]);
    await auditLog((req as any).user?.email ?? "owner", "extend_trial", req.params.id, `Extended trial by ${d} days`);
    res.json({ success: true, trial_expires: base });
  });

  // PATCH /api/admin/users/:id/flag — flag/unflag suspicious account
  app.patch("/api/admin/users/:id/flag", requireOwner, async (req: Request, res: Response) => {
    const { reason } = req.body ?? {};
    const row = await db.queryOne(
      `UPDATE users SET is_flagged = NOT is_flagged, flag_reason = CASE WHEN NOT is_flagged THEN $2 ELSE NULL END WHERE id=$1 RETURNING id,email,is_flagged,flag_reason`,
      [req.params.id, reason ?? "Flagged by admin"]
    );
    if (!row) return res.status(404).json({ error: "Not found" });
    await auditLog((req as any).user?.email ?? "owner", row.is_flagged ? "flag_user" : "unflag_user", req.params.id, reason ?? "");
    res.json(row);
  });

  // ── Section 2: Feature Flags ───────────────────────────────────────────────

  app.get("/api/admin/feature-flags", requireOwner, async (_req: Request, res: Response) => {
    const rows = await db.query(`SELECT * FROM feature_flags ORDER BY min_tier, label`);
    res.json(rows.rows);
  });

  app.patch("/api/admin/feature-flags/:id", requireOwner, async (req: Request, res: Response) => {
    const { enabled, min_tier, kill_switch } = req.body ?? {};
    const sets: string[] = ["updated_at=NOW()"];
    const vals: any[] = [];
    if (enabled !== undefined) { vals.push(enabled); sets.push(`enabled=$${vals.length}`); }
    if (min_tier !== undefined) { vals.push(min_tier); sets.push(`min_tier=$${vals.length}`); }
    if (kill_switch !== undefined) { vals.push(kill_switch); sets.push(`kill_switch=$${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.id);
    const row = await db.queryOne(
      `UPDATE feature_flags SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    if (!row) return res.status(404).json({ error: "Flag not found" });
    await auditLog((req as any).user?.email ?? "owner", "update_feature_flag", row.key,
      JSON.stringify({ enabled, min_tier, kill_switch }));
    res.json(row);
  });

  // Public endpoint: frontend reads feature flags to conditionally show tabs
  app.get("/api/feature-flags", async (_req: Request, res: Response) => {
    const rows = await db.query(`SELECT key, enabled, min_tier, kill_switch FROM feature_flags`);
    const map: Record<string, any> = {};
    for (const r of rows.rows) map[r.key] = r;
    res.json(map);
  });

  // POST /api/track-page — lightweight tab usage tracker (auth optional)
  app.post("/api/track-page", async (req: Request, res: Response) => {
    const { page } = req.body ?? {};
    if (!page) return res.json({ ok: true });
    const authHeader = req.headers.authorization;
    let userId: number | null = null;
    if (authHeader) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const payload = verifyJWT(token) as any;
        userId = payload?.userId ?? null;
      } catch { /* ok */ }
    }
    await db.query(`INSERT INTO page_events (user_id, page) VALUES ($1,$2)`, [userId, page]).catch(() => {});
    res.json({ ok: true });
  });

  // ── Section 3: API Health ──────────────────────────────────────────────────

  app.get("/api/admin/api-health", requireOwner, async (_req: Request, res: Response) => {
    // Last result per service
    const rows = await db.query(`
      SELECT DISTINCT ON (service) service, status, latency_ms, error, ts
      FROM api_health_log ORDER BY service, ts DESC
    `);
    // Error count last 24h per service
    const errs = await db.query(`
      SELECT service, COUNT(*) as err_count FROM api_health_log
      WHERE status='error' AND ts > NOW()-INTERVAL '24 hours' GROUP BY service
    `);
    const errMap: Record<string,number> = {};
    for (const r of errs.rows) errMap[r.service] = parseInt(r.err_count);
    const result = rows.rows.map((r: any) => ({ ...r, errors_24h: errMap[r.service] ?? 0 }));
    res.json(result);
  });

  app.get("/api/admin/api-health/logs", requireOwner, async (req: Request, res: Response) => {
    const service = req.query.service as string | undefined;
    const rows = service
      ? await db.query(`SELECT * FROM api_health_log WHERE service=$1 ORDER BY ts DESC LIMIT 50`, [service])
      : await db.query(`SELECT * FROM api_health_log ORDER BY ts DESC LIMIT 100`);
    res.json(rows.rows);
  });

  // DELETE /api/admin/api-health/errors — clear all error entries from the log
  app.delete("/api/admin/api-health/errors", requireOwner, async (req: Request, res: Response) => {
    try {
      const { service } = req.query as { service?: string };
      if (service) {
        await db.query(`DELETE FROM api_health_log WHERE status='error' AND service=$1`, [service]);
      } else {
        await db.query(`DELETE FROM api_health_log WHERE status='error'`);
      }
      await auditLog((req as any).user?.email ?? "owner", "clear_api_errors", service ?? "all");
      res.json({ ok: true, cleared: service ?? "all" });
    } catch (e: any) {
      console.error("[clear-api-errors]", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/admin/api-health/ping — ping a specific service and record result
  app.post("/api/admin/api-health/ping", requireOwner, async (req: Request, res: Response) => {
    const { service } = req.body ?? {};
    const oddsApiKey = process.env.ODDS_API_KEY || "15c62ebc-0905-4858-87e4-87160b253149";
    const SERVICES: Record<string, { url: string; headers?: any }> = {
      odds_api:       { url: `https://api.the-odds-api.com/v4/sports?apiKey=${oddsApiKey}` },
      espn:           { url: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard` },
      mlb_stats:      { url: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${new Date().toISOString().split('T')[0]}` },
      action_network: { url: `https://api.actionnetwork.com/web/v1/scoreboard/mlb?date=${new Date().toISOString().split('T')[0].replace(/-/g,'')}`, headers: { 'x-api-key': process.env.ACTION_NETWORK_KEY || '95d975972c05aa2f9ea5c3688ffc327c8afdbfe3dbd59f3545715d8e3bf7bee2', 'User-Agent': 'Mozilla/5.0 (compatible; ClubhouseIQ/1.0)', 'Referer': 'https://www.actionnetwork.com/' } },
      // wttr.in blocks datacenter IPs — use json format which is more permissive
      weather:        { url: `https://wttr.in/Chicago?format=j1`, headers: { 'User-Agent': 'curl/7.68.0', 'Accept': 'application/json' } },
    };
    const svc = SERVICES[service];
    if (!svc) return res.status(400).json({ error: `Unknown service: ${service}` });
    const start = Date.now();
    try {
      await axios.get(svc.url, { headers: svc.headers ?? {}, timeout: 8000 });
      const latency = Date.now() - start;
      await db.query(`INSERT INTO api_health_log (service,status,latency_ms) VALUES ($1,'ok',$2)`, [service, latency]);
      res.json({ service, status: 'ok', latency_ms: latency });
    } catch (e: any) {
      const latency = Date.now() - start;
      const errMsg = e.response?.status ? `HTTP ${e.response.status}` : e.message;
      await db.query(`INSERT INTO api_health_log (service,status,latency_ms,error) VALUES ($1,'error',$2,$3)`, [service, latency, errMsg]);
      res.json({ service, status: 'error', latency_ms: latency, error: errMsg });
    }
  });

  // ── Section 4: Analytics ──────────────────────────────────────────────────

  app.get("/api/admin/analytics", requireOwner, async (_req: Request, res: Response) => {
    try {
      // Tab usage (last 7 days)
      const tabUsage = await db.query(`
        SELECT page, COUNT(*) as views FROM page_events
        WHERE ts > NOW()-INTERVAL '7 days' GROUP BY page ORDER BY views DESC LIMIT 15
      `);

      // Conversion funnel
      const funnel = await db.query(`
        SELECT
          COUNT(CASE WHEN tier IS NULL THEN 1 END) as free_count,
          COUNT(CASE WHEN tier='basic' THEN 1 END) as basic_count,
          COUNT(CASE WHEN tier='pro'   THEN 1 END) as pro_count
        FROM users WHERE NOT is_owner
      `);

      // MRR from DB (approx: basic=$5, pro=$15, active subs only)
      const mrrData = await db.query(`
        SELECT tier, COUNT(*) as cnt FROM users
        WHERE sub_status='active' AND tier IN ('basic','pro') AND NOT is_owner GROUP BY tier
      `);
      let mrr = 0;
      for (const r of mrrData.rows) {
        mrr += (r.tier === 'pro' ? 15 : 5) * parseInt(r.cnt);
      }

      // Churn (cancelled in last 30 days) — approximate from audit log
      const churn = await db.query(`
        SELECT COUNT(*) as cnt FROM audit_log
        WHERE action='cancel_sub' AND ts > NOW()-INTERVAL '30 days'
      `);

      // Revenue from DB — approximate from active subscriptions
      const revenueData = await db.query(`
        SELECT tier, COUNT(*) as cnt FROM users
        WHERE sub_status='active' AND tier IS NOT NULL AND is_owner=FALSE
        GROUP BY tier
      `);
      let whopRevenue = 0;
      for (const row of revenueData.rows) {
        const price = row.tier === 'pro' ? 15 : row.tier === 'basic' ? 5 : 0;
        whopRevenue += price * parseInt(row.cnt);
      }

      res.json({
        tabUsage: tabUsage.rows,
        funnel: funnel.rows[0],
        mrr,
        churn_30d: parseInt(churn.rows[0].cnt),
        gumroad_revenue_30d: whopRevenue,
        stripe_refunds_30d: 0,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Section 5: Notifications & Messaging ──────────────────────────────────

  // POST /api/admin/send-blast — email blast to tier(s)
  app.post("/api/admin/send-blast", requireOwner, async (req: Request, res: Response) => {
    const { subject, body, tiers } = req.body ?? {};
    if (!subject || !body) return res.status(400).json({ error: "Subject and body required" });
    const tierFilter = Array.isArray(tiers) && tiers.length > 0
      ? tiers : ['free', 'basic', 'pro'];
    // Map 'free' tier to NULL in DB
    const conditions = tierFilter.map((t: string) => t === 'free' ? `tier IS NULL` : `tier='${t}'`);
    const users = await db.query(
      `SELECT email FROM users WHERE (${conditions.join(' OR ')}) AND NOT is_disabled AND NOT is_owner`
    );
    if (!users.rows.length) return res.json({ success: true, sent: 0 });
    try {
      const resendClient = new (await import('resend')).Resend(process.env.RESEND_API_KEY!);
      const FROM = "Clubhouse IQ <noreply@clubhouseiq.app>";
      let sent = 0;
      // Send in batches of 10
      for (let i = 0; i < users.rows.length; i += 10) {
        const batch = users.rows.slice(i, i+10);
        await Promise.all(batch.map((u: any) =>
          resendClient.emails.send({ from: FROM, to: u.email, subject, html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;"><p style="white-space:pre-wrap;color:#131A24">${body}</p><hr style="margin:24px 0;border:none;border-top:1px solid #eee"/><p style="color:#8A9BB0;font-size:11px">Clubhouse IQ · <a href="https://clubhouse-iq.up.railway.app">clubhouse-iq.up.railway.app</a></p></div>` })
        ));
        sent += batch.length;
      }
      await auditLog((req as any).user?.email ?? "owner", "email_blast", undefined, `Sent to ${sent} users: "${subject}"`);
      res.json({ success: true, sent });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/announcement — set/clear in-app banner
  app.post("/api/admin/announcement", requireOwner, async (req: Request, res: Response) => {
    const { message, type } = req.body ?? {}; // type: info|warning|success
    if (message) {
      await db.query(`INSERT INTO app_settings (key,value) VALUES ('announcement', $1) ON CONFLICT (key) DO UPDATE SET value=$1`, [JSON.stringify({ message, type: type ?? 'info', ts: new Date().toISOString() })]);
    } else {
      await db.query(`DELETE FROM app_settings WHERE key='announcement'`);
    }
    res.json({ success: true });
  });

  // GET /api/announcement — public, used by frontend to show banner
  app.get("/api/announcement", async (_req: Request, res: Response) => {
    const row = await db.queryOne(`SELECT value FROM app_settings WHERE key='announcement'`);
    if (!row) return res.json(null);
    try { res.json(JSON.parse(row.value)); } catch { res.json(null); }
  });

  // ── Section 6: Deployment / Version Info ──────────────────────────────────

  app.get("/api/admin/deployment", requireOwner, async (_req: Request, res: Response) => {
    // Read version info baked in at build time (if present)
    let gitSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? null;
    let deployedAt = process.env.RAILWAY_DEPLOYMENT_ID ? null : null; // Railway doesn't expose this easily
    let branch = process.env.RAILWAY_GIT_BRANCH ?? "main";
    // Try to read from a baked-in version file
    try {
      const vf = require('fs').readFileSync(require('path').join(__dirname, '../version.json'), 'utf-8');
      const vd = JSON.parse(vf);
      gitSha = gitSha ?? vd.sha;
      deployedAt = vd.buildTime;
      branch = vd.branch ?? branch;
    } catch { /* ok */ }
    res.json({
      git_sha: gitSha,
      git_sha_short: gitSha ? gitSha.slice(0,8) : null,
      branch,
      deployed_at: deployedAt,
      github_url: gitSha ? `https://github.com/abudnick8/prop-edge/commit/${gitSha}` : "https://github.com/abudnick8/prop-edge",
      railway_url: "https://railway.app/project/c88d82a5-56b0-452e-8840-66587aeb94a9",
      app_url: "https://clubhouse-iq.up.railway.app",
    });
  });

  // ── Section 7: System Settings — API keys, audit log ─────────────────────

  // GET /api/admin/audit-log
  app.get("/api/admin/audit-log", requireOwner, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string ?? "50"), 200);
    const rows = await db.query(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT $1`, [limit]);
    res.json(rows.rows);
  });

  // GET/PATCH /api/admin/api-keys — owner manages API keys stored in app_settings
  app.get("/api/admin/api-keys", requireOwner, async (_req: Request, res: Response) => {
    const keys = ['odds_api_key', 'action_network_key'];
    const rows = await db.query(`SELECT key,value FROM app_settings WHERE key=ANY($1)`, [keys]);
    const result: Record<string,string> = {};
    for (const r of rows.rows) {
      // Mask all but last 4 chars
      result[r.key] = r.value.length > 8 ? '•'.repeat(r.value.length - 4) + r.value.slice(-4) : r.value;
    }
    res.json(result);
  });

  app.patch("/api/admin/api-keys", requireOwner, async (req: Request, res: Response) => {
    const allowed = ['odds_api_key', 'action_network_key'];
    const updates = req.body ?? {};
    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.includes(key)) continue;
      await db.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]);
    }
    await auditLog((req as any).user?.email ?? "owner", "update_api_keys", undefined, Object.keys(updates).join(", "));
    res.json({ success: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ══ THE BOOK — Owner-only paper sportsbook ════════════════════════════════════

  // ─ Helper: American odds → decimal multiplier ─────────────────────
  function americanToDecimal(odds: number): number {
    if (odds >= 100) return odds / 100 + 1;
    return 100 / Math.abs(odds) + 1;
  }

  // ─ Parlay payout calc ─────────────────────────────────────
  function calcParlayPayout(stake: number, oddsArr: number[]): number {
    const mult = oddsArr.reduce((acc, o) => acc * americanToDecimal(o), 1);
    return parseFloat((stake * mult).toFixed(2));
  }

  // ─ Round Robin combos ─────────────────────────────────
  function getCombinations<T>(arr: T[], size: number): T[][] {
    if (size > arr.length) return [];
    if (size === 1) return arr.map(x => [x]);
    return arr.flatMap((x, i) =>
      getCombinations(arr.slice(i + 1), size - 1).map(rest => [x, ...rest])
    );
  }

  // ─ Fetch DraftKings odds from The Odds API ──────────────────
  async function getOddsApiKey(): Promise<string> {
    // Prefer env var, fall back to DB settings
    if (process.env.ODDS_API_KEY) return process.env.ODDS_API_KEY;
    try {
      const s = await storage.getSettings();
      return s?.oddsApiKey ?? "";
    } catch { return ""; }
  }

  async function fetchDraftKingsOdds(sport: string): Promise<any[]> {
    const sportMap: Record<string, string> = {
      mlb: "baseball_mlb",
      nfl: "americanfootball_nfl",
      nba: "basketball_nba",
      nhl: "icehockey_nhl",
    };
    const sportKey = sportMap[sport.toLowerCase()];
    if (!sportKey) return [];
    const apiKey = await getOddsApiKey();
    if (!apiKey) return [];
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings,fanduel,betmgm&oddsFormat=american`;
      const resp = await axios.get(url, { timeout: 8000 });
      const now = Date.now();
      // Only return games that have NOT started yet (commence_time in the future)
      const games: any[] = resp.data ?? [];
      return games.filter(g => {
        const ct = g.commence_time ? new Date(g.commence_time).getTime() : 0;
        return ct > now;
      });
    } catch (e: any) {
      console.warn(`[Book] DraftKings odds fetch error (${sport}):`, e.message);
      return [];
    }
  }

  // MLB prop market keys allowed (per user rules)
  const MLB_PROP_MARKETS = [
    "player_hits",
    "player_hrr",
    "player_home_runs",
    "player_runs_scored",
    "player_rbis",
    "player_total_bases",
    "player_singles",
    "player_doubles",
    "player_stolen_bases",
    "player_strikeouts",
    "player_pitcher_strikeouts",
    "player_pitcher_outs",
    "player_hits_allowed",
    "player_earned_runs",
    "player_walks",
    "player_pitcher_walks",
    "player_first_innings_runs_allowed",
  ];

  const NBA_NHL_NFL_PROP_MARKETS = [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_blocks",
    "player_steals",
    "player_points_rebounds_assists",
    "player_anytime_td",
    "player_reception_yards",
    "player_rushing_yards",
    "player_passing_yards",
    "player_passing_tds",
    "player_receptions",
    "player_shots_on_goal",
    "player_goal_scorer",
  ];

  // ─ Linemate market name → Odds API style key mapping ───────────────────
  const LINEMATE_TO_PROP_KEY: Record<string, string> = {
    // MLB hitter
    HITTER_HITS:                                   "player_hits",
    HITTER_HITS_PLUS_RUNS_PLUS_RUNS_BATTED_IN:     "player_hrr",
    HITTER_HOME_RUNS:                              "player_home_runs",
    HITTER_TOTAL_BASES:             "player_total_bases",
    HITTER_RUNS_BATTED_IN:          "player_rbis",
    HITTER_RUNS:                    "player_runs_scored",
    HITTER_SINGLES:                 "player_singles",
    HITTER_DOUBLES:                 "player_doubles",
    HITTER_STOLEN_BASES:            "player_stolen_bases",
    HITTER_STRIKEOUTS:              "player_strikeouts",
    // MLB pitcher
    PITCHER_STRIKEOUTS:             "player_pitcher_strikeouts",
    PITCHER_OUTS:                   "player_pitcher_outs",
    PITCHER_HITS_ALLOWED:           "player_hits_allowed",
    PITCHER_EARNED_RUNS:            "player_earned_runs",
    PITCHER_WALKS:                  "player_pitcher_walks",
    PITCHER_INNINGS_PITCHED:        "player_pitcher_outs",
    // NBA
    POINTS:                         "player_points",
    REBOUNDS:                       "player_rebounds",
    ASSISTS:                        "player_assists",
    THREE_POINTERS_MADE:            "player_threes",
    BLOCKS:                         "player_blocks",
    STEALS:                         "player_steals",
    POINTS_REBOUNDS_ASSISTS:        "player_points_rebounds_assists",
    // NHL
    SHOTS_ON_GOAL:                  "player_shots_on_goal",
    GOALS:                          "player_goals",
    // NFL
    PASSING_YARDS:                  "player_passing_yards",
    PASSING_TOUCHDOWNS:             "player_passing_tds",
    RUSHING_YARDS:                  "player_rushing_yards",
    RECEIVING_YARDS:                "player_reception_yards",
    RECEPTIONS:                     "player_receptions",
    ANYTIME_TOUCHDOWN:              "player_anytime_td",
  };

  // Linemate game code → Odds API event id cache (populated when linemate data fetched)
  const linematePropCache: Record<string, { markets: any[]; fetchedAt: number }> = {};
  const LINEMATE_PROP_CACHE_TTL = 8 * 60 * 1000; // 8 minutes

  // ─ Fetch player props from Linemate (free, no plan restriction) ──────────────
  // Dedicated raw-market cache for Book props (separate from Props Hub cache)
  const bookRawCache: Record<string, { raw: any[]; ts: number }> = {};
  const BOOK_RAW_TTL = 8 * 60_000; // 8-min cache

  async function fetchDraftKingsProps(sport: string, eventId: string): Promise<any[]> {
    const sportKey = sport.toLowerCase();
    const cacheKey = `${sportKey}:${eventId}`;

    // Return from cache if fresh
    const cached = linematePropCache[cacheKey];
    if (cached && Date.now() - cached.fetchedAt < LINEMATE_PROP_CACHE_TTL) {
      return cached.markets;
    }

    try {
      // 1. Always use raw Linemate data (books + alternates) — use dedicated Book raw cache
      //    Never use Props Hub linemateCache (it strips rawMarkets)
      let rawFiltered: any[] = [];
      const rawCached = bookRawCache[sportKey];
      if (rawCached && Date.now() - rawCached.ts < BOOK_RAW_TTL) {
        rawFiltered = rawCached.raw;
      } else {
        const BASE = `https://api.linemate.io/api/${sportKey}`;
        const marketsRes = await axios.get(`${BASE}/v2/markets`, {
          params: { levelsToInclude: "player" },
          headers: LINEMATE_HEADERS,
          timeout: 12000,
        });
        const raw: any[] = Array.isArray(marketsRes.data) ? marketsRes.data : [];
        rawFiltered = raw.filter((m: any) => m.player && m.name);
        bookRawCache[sportKey] = { raw: rawFiltered, ts: Date.now() };
      }
      const linemateMarkets: any[] = rawFiltered.map((m: any) => normalisePick(
          { gameId: m.gameId, player: m.player, team: m.team, opposingTeam: m.opposingTeam, isHome: m.isHome, market: m, outcome: "OVER", pregameHitRecords: m.pregameHitRecords, pregameAverages: m.pregameAverages },
          "MARKET", sportKey.toUpperCase()
        ));
      // Keep linemateCache updated for Props Hub benefit too
      const lmExisting = linemateCache.get(sportKey)?.data ?? {};
      if (!linemateCache.get(sportKey) || Date.now() - (linemateCache.get(sportKey)?.ts ?? 0) > LINEMATE_TTL) {
        linemateCache.set(sportKey, { data: { ...lmExisting, markets: linemateMarkets, rawMarkets: rawFiltered }, ts: Date.now() });
      }

      // 2. Also fetch the odds API for this event for actual odds (American format)
      //    Falls back to -110/-110 if unavailable
      const apiKey = await getOddsApiKey();
      let oddsMap: Record<string, { overOdds: number; underOdds: number }> = {};
      // Try to get h2h odds (we know those work) — props odds not available on free plan
      // We'll use the bookLines from linemate itself for odds

      // 3. Convert raw linemate markets into Book's market/outcome format
      //    Raw linemate data has books.bookname.over.alternates with additional lines+odds

      // Helper: extract all {line, overOdds, underOdds} from raw linemate books object
      // ── Odds math helpers ───────────────────────────────────────────────────
      function americanToProb(odds: number): number {
        return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
      }
      function probToAmerican(prob: number): number {
        if (prob <= 0 || prob >= 1) return -110;
        return prob >= 0.5
          ? Math.round(-prob / (1 - prob) * 100)
          : Math.round((1 - prob) / prob * 100);
      }
      function medianOf(arr: number[]): number {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      }

      function extractLines(books: any): { line: number; overOdds: number | null; underOdds: number | null }[] {
        if (!books || typeof books !== "object") return [];

        // Collect ALL over and under odds per line across every book
        // overSamples / underSamples: Map<line, number[]>
        const overSamples  = new Map<number, number[]>();
        const underSamples = new Map<number, number[]>();

        const addSample = (map: Map<number, number[]>, line: number, odds: number) => {
          if (!map.has(line)) map.set(line, []);
          map.get(line)!.push(odds);
        };

        for (const bdata of Object.values(books as Record<string, any>)) {
          if (!bdata || typeof bdata !== "object") continue;
          const over  = (bdata as any).over  ?? null;
          const under = (bdata as any).under ?? null;

          // Main line for this book
          const overMain  = over?.current  ?? null;
          const underMain = under?.current ?? null;
          if (overMain?.value  != null && overMain?.odds?.american  != null)
            addSample(overSamples,  overMain.value,  overMain.odds.american);
          if (underMain?.value != null && underMain?.odds?.american != null)
            addSample(underSamples, underMain.value, underMain.odds.american);

          // Over alternates (most books only supply over alts, not under alts)
          for (const [altKey, altData] of Object.entries((over?.alternates  ?? {}) as Record<string, any>)) {
            const aVal = parseFloat(altKey);
            if (isNaN(aVal) || altData?.odds?.american == null) continue;
            addSample(overSamples, aVal, altData.odds.american);
          }
          // Under alternates (rarely present, but capture if available)
          for (const [altKey, altData] of Object.entries((under?.alternates ?? {}) as Record<string, any>)) {
            const aVal = parseFloat(altKey);
            if (isNaN(aVal) || altData?.odds?.american == null) continue;
            addSample(underSamples, aVal, altData.odds.american);
          }
        }

        // Compute median over odds per line
        const allLines = new Set([...overSamples.keys(), ...underSamples.keys()]);
        if (!allLines.size) return [];

        // Observe vig from the line that has BOTH over and under real odds
        let observedVig = 1.045; // default 4.5% vig
        for (const line of allLines) {
          const oSamples = overSamples.get(line) ?? [];
          const uSamples = underSamples.get(line) ?? [];
          if (oSamples.length > 0 && uSamples.length > 0) {
            const oProb = americanToProb(medianOf(oSamples));
            const uProb = americanToProb(medianOf(uSamples));
            const v = oProb + uProb;
            if (v > 1.0 && v < 1.15) { observedVig = v; break; }
          }
        }

        const result: { line: number; overOdds: number; underOdds: number }[] = [];
        for (const line of allLines) {
          const oSamples = overSamples.get(line) ?? [];
          const uSamples = underSamples.get(line) ?? [];
          if (!oSamples.length && !uSamples.length) continue;

          const overOdds  = oSamples.length  ? Math.round(medianOf(oSamples))  : null;
          const underOdds = uSamples.length  ? Math.round(medianOf(uSamples)) : null;

          // Derive missing side from the other using observed vig
          const finalOver  = overOdds  ?? (underOdds != null
            ? probToAmerican(observedVig - americanToProb(underOdds)) : null);
          const finalUnder = underOdds ?? (overOdds  != null
            ? probToAmerican(observedVig - americanToProb(overOdds))  : null);

          if (finalOver == null || finalUnder == null) continue;
          result.push({ line, overOdds: finalOver, underOdds: finalUnder });
        }

        return result.sort((a, b) => a.line - b.line);
      }

      // Group by market type (prop key)
      const marketMap: Record<string, any> = {};

      // Work from raw linemate data when available to get alternates
      // Re-read from cache after potential fresh fetch (lmCached captured before fetch may be stale)
      // Use dedicated bookRawCache (always has rawMarkets, unlike Props Hub linemateCache)
      const rawLmData: any[] = bookRawCache[sportKey]?.raw ?? [];
      const sourceArr = rawLmData.length > 0 ? rawLmData : linemateMarkets;
      const usingRaw  = rawLmData.length > 0;

      // Dedup map: key = "propKey:playerName:Over|Under" → best outcome candidate
      // "Best" = most alternates (most book data = most accurate median odds)
      const playerOutcomeMap = new Map<string, any>();

      for (const m of sourceArr) {
        const playerName = usingRaw ? (m.player?.fullName ?? "") : (m.playerName ?? "");
        const marketName = usingRaw ? (m.name ?? "")            : (m.marketName ?? "");
        const teamCode   = usingRaw ? (m.team?.code ?? "")      : (m.teamCode ?? "");
        const position   = usingRaw ? (m.player?.position ?? "") : (m.playerPos ?? "");
        const gameId     = m.gameId ?? null;
        const books      = usingRaw ? (m.books ?? {}) : {};

        if (!playerName || !marketName) continue;
        const propKey = LINEMATE_TO_PROP_KEY[marketName] ?? null;
        if (!propKey) continue;

        // Build sorted list of available lines with odds
        let allLines: { line: number; overOdds: number | null; underOdds: number | null }[] = [];
        if (usingRaw && Object.keys(books).length > 0) {
          allLines = extractLines(books);
        }
        // Fallback to normalized bookLines
        if (allLines.length === 0) {
          const bl = m.bookLines ?? {};
          const be = Object.values(bl) as any[];
          const cl = m.consensusLine ?? null;
          if (cl != null) {
            allLines = [{ line: cl, overOdds: be.find((b: any) => b.overOdds != null)?.overOdds ?? -110, underOdds: be.find((b: any) => b.underOdds != null)?.underOdds ?? -110 }];
          }
        }
        if (allLines.length === 0) continue;

        // Primary line: lowest line that has overOdds, or just first
        const primaryLine = allLines.find(l => l.overOdds != null) ?? allLines[0];

        // Over outcome — includes all alternate lines with odds
        const overAlternates = allLines.filter(l => l.overOdds != null).map(l => ({ line: l.line, overOdds: l.overOdds!, underOdds: l.underOdds }));
        const overCandidate = {
          name:        "Over",
          description: playerName,
          point:       primaryLine.line,
          price:       primaryLine.overOdds ?? -110,
          team:        teamCode || null,
          position:    position || null,
          gameId,
          alternates:  overAlternates,
          _propKey:    propKey,
        };
        const overKey = `${propKey}:${playerName}:Over`;
        const existingOver = playerOutcomeMap.get(overKey);
        // Keep whichever has more alternates (more book samples = better median odds)
        if (!existingOver || overAlternates.length > (existingOver.alternates?.length ?? 0)) {
          playerOutcomeMap.set(overKey, overCandidate);
        }

        // Under outcome — skip for HR and SB (user rule: only overs shown)
        if (propKey !== "player_home_runs" && propKey !== "player_stolen_bases") {
          const underLines = allLines.filter(l => l.underOdds != null);
          const underPrimary = underLines[underLines.length - 1] ?? primaryLine; // highest line for under
          const underAlternates = underLines.map(l => ({ line: l.line, overOdds: l.overOdds, underOdds: l.underOdds! }));
          const underCandidate = {
            name:        "Under",
            description: playerName,
            point:       underPrimary.line,
            price:       underPrimary.underOdds ?? -110,
            team:        teamCode || null,
            position:    position || null,
            gameId,
            alternates:  underAlternates,
            _propKey:    propKey,
          };
          const underKey = `${propKey}:${playerName}:Under`;
          const existingUnder = playerOutcomeMap.get(underKey);
          if (!existingUnder || underAlternates.length > (existingUnder.alternates?.length ?? 0)) {
            playerOutcomeMap.set(underKey, underCandidate);
          }
        }
      }

      // Populate marketMap from deduplicated outcomes
      for (const outcome of playerOutcomeMap.values()) {
        const { _propKey, ...outcomeData } = outcome;
        if (!marketMap[_propKey]) {
          marketMap[_propKey] = { key: _propKey, outcomes: [], bookmaker: "linemate" };
        }
        marketMap[_propKey].outcomes.push(outcomeData);
      }

      const markets = Object.values(marketMap);
      console.log(`[Book Props] linemate ${sport}: ${markets.length} markets, ${markets.reduce((s: number, m: any) => s + m.outcomes.length, 0)} outcomes`);

      // Cache per-sport (not per eventId) since linemate data covers all games
      linematePropCache[`${sportKey}:ALL`] = { markets, fetchedAt: Date.now() };
      linematePropCache[cacheKey] = { markets, fetchedAt: Date.now() };

      return markets;
    } catch (e: any) {
      console.error(`[Book Props] Linemate fetch error:`, e.message);
      return [];
    }
  }

  // ─ Book grader: grade all open legs that have results available ───
  async function gradeBookLegs(): Promise<void> {
    try {
      const openLegs = await db.query(
        `SELECT l.*, s.account_id, s.slip_type, s.stake, s.id as slip_id
         FROM book_legs l
         JOIN book_slips s ON l.slip_id = s.id
         WHERE l.result = 'pending' AND s.status = 'open'
         ORDER BY l.game_date ASC`
      );
      if (!openLegs.rows.length) return;

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

      for (const leg of openLegs.rows) {
        let result: "win" | "loss" | "push" | "void" | null = null;
        let actualValue: number | null = null;

        // Only grade games from today or earlier
        if (leg.game_date > today) continue;

        try {
          if (leg.bet_type === "prop" && leg.stat_type) {
            // Resolve player_id by name if not stored
            let playerId = leg.player_id ?? null;
            if (!playerId && leg.player_name) {
              try {
                const searchResp = await axios.get(
                  `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(leg.player_name)}&sportId=1`,
                  { timeout: 4000 }
                );
                const people = searchResp.data?.people ?? [];
                if (people.length > 0) {
                  playerId = people[0].id;
                  // Persist it so we don’t look it up again
                  await db.query(`UPDATE book_legs SET player_id=$1 WHERE id=$2`, [playerId, leg.id]);
                }
              } catch { /* search failed, fall through */ }
            }

            // Use ESPN boxscore via existing mlExtractPlayerStat for all sports
            const sportKey = (leg.sport ?? "mlb").toLowerCase();
            const espnSport = ({ baseball_mlb:"MLB", mlb:"MLB", basketball_nba:"NBA", nba:"NBA", icehockey_nhl:"NHL", nhl:"NHL", americanfootball_nfl:"NFL", nfl:"NFL" } as Record<string,string>)[sportKey] ?? "MLB";
            // leg.stat_type stored as "player_hits", "player_hrr", etc.
            const PROP_TO_STAT: Record<string,string> = {
              player_hits:"HITS", player_home_runs:"HR", player_rbis:"RBI", player_runs_scored:"RUNS_SCORED",
              player_total_bases:"TOTAL_BASES", player_singles:"SINGLES", player_doubles:"DOUBLES",
              player_stolen_bases:"STOLEN_BASES", player_strikeouts:"STRIKEOUTS_BATTER",
              player_pitcher_strikeouts:"PITCHER_K", player_pitcher_outs:"PITCHER_OUTS",
              player_hits_allowed:"HITS_ALLOWED", player_earned_runs:"EARNED_RUNS",
              player_walks:"WALKS", player_pitcher_walks:"WALKS_ALLOWED",
              player_points:"POINTS", player_rebounds:"REBOUNDS", player_assists:"ASSISTS",
              player_threes:"3PM", player_blocks:"BLOCKS", player_steals:"STEALS",
              player_points_rebounds_assists:"PRA",
              player_passing_yards:"PASS_YDS", player_rushing_yards:"RUSH_YDS",
              player_reception_yards:"REC_YDS", player_receptions:"RECEPTIONS",
              player_passing_tds:"TOUCHDOWNS", player_shots_on_goal:"SHOTS_ON_GOAL",
              player_goals:"GOALS", player_hrr:"HRR",
              // Also support stripped versions (legacy)
              hits:"HITS", home_runs:"HR", rbis:"RBI", runs_scored:"RUNS_SCORED",
              total_bases:"TOTAL_BASES", singles:"SINGLES", doubles:"DOUBLES",
              stolen_bases:"STOLEN_BASES", strikeouts:"STRIKEOUTS_BATTER",
              pitcher_strikeouts:"PITCHER_K", pitcher_outs:"PITCHER_OUTS",
              hits_allowed:"HITS_ALLOWED", earned_runs:"EARNED_RUNS",
              walks:"WALKS", pitcher_walks:"WALKS_ALLOWED",
              points:"POINTS", rebounds:"REBOUNDS", assists:"ASSISTS",
              threes:"3PM", blocks:"BLOCKS", steals:"STEALS",
              points_rebounds_assists:"PRA", hrr:"HRR",
            };
            const statCat = PROP_TO_STAT[leg.stat_type] ?? PROP_TO_STAT[leg.stat_type?.replace("player_","")] ?? leg.stat_type?.toUpperCase();

            // Fetch ESPN scoreboard — check leg's game_date AND adjacent dates to handle UTC/CDT offset
            const legDateStr = (leg.game_date ?? "").replace(/-/g, ""); // e.g. "20260510"
            const nowMs = Date.now();
            const utcDateStr = new Date(nowMs).toISOString().slice(0,10).replace(/-/g,"");
            const cdtDateStr = new Date(nowMs - 5*3600*1000).toISOString().slice(0,10).replace(/-/g,"");
            const datesToCheck = [...new Set([legDateStr, cdtDateStr, utcDateStr].filter(Boolean))];
            let allEvents: any[] = [];
            for (const ds of datesToCheck) {
              const evs = await mlFetchScoreboard(espnSport, ds);
              allEvents = allEvents.concat(evs);
            }
            // Deduplicate by event id
            const seenEvIds = new Set<string>();
            allEvents = allEvents.filter((ev: any) => { if (seenEvIds.has(ev.id)) return false; seenEvIds.add(ev.id); return true; });
            const matchedEvent = allEvents.find((ev: any) => {
              const comp = ev.competitions?.[0];
              const teams = (comp?.competitors ?? []).map((c: any) => c.team?.displayName ?? "");
              return teams.some((t: string) => mlTeamsMatch(t, leg.home_team ?? "")) ||
                     teams.some((t: string) => mlTeamsMatch(t, leg.away_team ?? ""));
            });
            if (!matchedEvent) continue;

            const statusType = matchedEvent.competitions?.[0]?.status?.type;
            if (!statusType?.completed) continue; // game not finished yet

            const summary = await mlFetchGameSummary(espnSport, matchedEvent.id);
            if (!summary) continue;

            const playerName = leg.player_name ?? "";

            // Step 1 — confirm the player actually appeared in the box score
            const playedInGame = mlPlayerInBoxScore(summary, playerName);

            if (!playedInGame) {
              // Player absent from completed box score → DNP/scratch/injury → void
              result = "void";
              actualValue = null;
            } else {
              // Step 2 — player confirmed in game, extract their stat
              const stat = mlExtractPlayerStat(summary, espnSport, playerName, statCat);
              if (stat === null) {
                // Player was in the game but the specific stat column is missing
                // (data gap, wrong stat key, etc.) — do NOT void, skip and retry later
                continue;
              }
              actualValue = stat;
              // stat = 0 is a valid result (e.g. 0 hits, 0 RBI) — grade it normally
              if (actualValue === leg.line) result = "push";
              else if (leg.over_under === "over") result = actualValue > leg.line ? "win" : "loss";
              else result = actualValue < leg.line ? "win" : "loss";
            }

          } else if (leg.bet_type === "moneyline" || leg.bet_type === "spread" || leg.bet_type === "total") {
            // Use ESPN for all sports (supports MLB, NBA, NHL, NFL)
            const sportKey2 = (leg.sport ?? "mlb").toLowerCase();
            const espnSport2 = ({ baseball_mlb:"MLB", mlb:"MLB", basketball_nba:"NBA", nba:"NBA", icehockey_nhl:"NHL", nhl:"NHL", americanfootball_nfl:"NFL", nfl:"NFL" } as Record<string,string>)[sportKey2] ?? "MLB";
            const legDateStr2 = (leg.game_date ?? "").replace(/-/g, "");
            const nowMs2 = Date.now();
            const cdtDateStr2 = new Date(nowMs2 - 5*3600*1000).toISOString().slice(0,10).replace(/-/g,"");
            const utcDateStr2 = new Date(nowMs2).toISOString().slice(0,10).replace(/-/g,"");
            const dates2 = [...new Set([legDateStr2, cdtDateStr2, utcDateStr2].filter(Boolean))];
            let allEvents2: any[] = [];
            for (const ds of dates2) {
              const evs = await mlFetchScoreboard(espnSport2, ds);
              allEvents2 = allEvents2.concat(evs);
            }
            const seenIds2 = new Set<string>();
            allEvents2 = allEvents2.filter((ev: any) => { if (seenIds2.has(ev.id)) return false; seenIds2.add(ev.id); return true; });
            const matchedEvent2 = allEvents2.find((ev: any) => {
              const comp = ev.competitions?.[0];
              const teams = (comp?.competitors ?? []).map((c: any) => c.team?.displayName ?? "");
              return teams.some((t: string) => mlTeamsMatch(t, leg.home_team ?? "")) ||
                     teams.some((t: string) => mlTeamsMatch(t, leg.away_team ?? ""));
            });
            if (!matchedEvent2) continue;
            if (!matchedEvent2.competitions?.[0]?.status?.type?.completed) continue;

            const comp2 = matchedEvent2.competitions[0];
            const homeComp2 = comp2.competitors?.find((c: any) => c.homeAway === "home");
            const awayComp2 = comp2.competitors?.find((c: any) => c.homeAway === "away");
            const homeScore = parseFloat(homeComp2?.score ?? "0");
            const awayScore = parseFloat(awayComp2?.score ?? "0");

            if (leg.bet_type === "moneyline") {
              const label = leg.pick_label.toLowerCase();
              const homeTeamWords = (leg.home_team ?? "").toLowerCase().split(" ");
              const pickedHome = homeTeamWords.some((w: string) => w.length > 2 && label.includes(w));
              const homeWon = homeScore > awayScore;
              if (homeScore === awayScore) result = "push";
              else result = (pickedHome && homeWon) || (!pickedHome && !homeWon) ? "win" : "loss";
            } else if (leg.bet_type === "spread") {
              const label = leg.pick_label.toLowerCase();
              const homeTeamWords = (leg.home_team ?? "").toLowerCase().split(" ");
              const pickedHome = homeTeamWords.some((w: string) => w.length > 2 && label.includes(w));
              const adjustedScore = pickedHome ? homeScore + leg.line : awayScore + leg.line;
              const opponentScore = pickedHome ? awayScore : homeScore;
              if (adjustedScore === opponentScore) result = "push";
              else result = adjustedScore > opponentScore ? "win" : "loss";
            } else if (leg.bet_type === "total") {
              const total = homeScore + awayScore;
              if (total === leg.line) result = "push";
              else result = (leg.over_under === "over" ? total > leg.line : total < leg.line) ? "win" : "loss";
            }
          }
        } catch { continue; }

        if (!result) continue;

        // Update leg result
        await db.query(
          `UPDATE book_legs SET result=$1, actual_value=$2, graded_at=NOW() WHERE id=$3`,
          [result, actualValue, leg.id]
        );

        // Check if all legs in slip are graded
        const slipLegs = await db.query(
          `SELECT result FROM book_legs WHERE slip_id=$1`, [leg.slip_id]
        );
        const legResults = slipLegs.rows.map((r: any) => r.result);
        if (legResults.includes("pending")) continue; // still waiting on other legs

        // Determine slip outcome
        // Parlay rules:
        //   void / push legs are REMOVED from the parlay (reduced-odds payout)
        //   remaining win legs = won at adjusted odds
        //   any loss = lost
        //   all void/push = push (stake returned)
        //   all void = void (stake returned)
        let slipStatus: string;
        const nonVoidResults  = legResults.filter((r: string) => r !== "void");
        const activeResults   = nonVoidResults.filter((r: string) => r !== "push"); // wins & losses only

        if (legResults.every((r: string) => r === "void")) {
          slipStatus = "void";                                                   // all voided
        } else if (nonVoidResults.length === 0 || nonVoidResults.every((r: string) => r === "push")) {
          slipStatus = "push";                                                   // all push (or only pushes remain)
        } else if (activeResults.some((r: string) => r === "loss")) {
          slipStatus = "lost";                                                   // any loss kills the parlay
        } else if (activeResults.every((r: string) => r === "win") && activeResults.length > 0) {
          slipStatus = "won";                                                    // all active legs won (push/void removed)
        } else {
          slipStatus = "push";                                                   // fallback
        }

        // Payout: win legs only (push and void legs removed from odds)
        let finalPayout = 0;
        if (slipStatus === "won") {
          const activeLeg = await db.query(
            `SELECT odds_american FROM book_legs WHERE slip_id=$1 AND result = 'win'`, [leg.slip_id]
          );
          const activeOdds = activeLeg.rows.map((r: any) => r.odds_american);
          const slip = await db.queryOne(`SELECT * FROM book_slips WHERE id=$1`, [leg.slip_id]);
          if (activeOdds.length === 1) {
            finalPayout = parseFloat((slip.stake * americanToDecimal(activeOdds[0])).toFixed(2));
          } else if (activeOdds.length > 1) {
            finalPayout = calcParlayPayout(slip.stake, activeOdds);
          }
        } else if (slipStatus === "push" || slipStatus === "void") {
          const slip = await db.queryOne(`SELECT stake FROM book_slips WHERE id=$1`, [leg.slip_id]);
          finalPayout = parseFloat(slip.stake);
        }

        // Settle this slip (could be a child parlay inside an RR)
        await db.query(
          `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
          [slipStatus, slipStatus === "lost" ? 0 : (finalPayout || null), leg.slip_id]
        );

        // Credit account if won/push/void
        if (finalPayout > 0 && slipStatus !== "lost") {
          await db.query(
            `UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`,
            [finalPayout, leg.account_id]
          );
          const txType = slipStatus === "won" ? "win" : slipStatus === "push" ? "push" : "void_refund";
          await db.query(
            `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note)
             VALUES ($1,$2,$3,$4,$5)`,
            [leg.account_id, finalPayout, txType, leg.slip_id, `Slip #${leg.slip_id} settled: ${slipStatus}`]
          );
        }

        // If this slip is a child parlay of an RR, check if all siblings are settled too
        const parentCheck = await db.queryOne(
          `SELECT rr_parent_id FROM book_slips WHERE id=$1`, [leg.slip_id]
        );
        if (parentCheck?.rr_parent_id) {
          const parentId = parentCheck.rr_parent_id;
          const siblings = await db.query(
            `SELECT status, payout_received FROM book_slips WHERE rr_parent_id=$1`, [parentId]
          );
          const allSettled = siblings.rows.every((r: any) => r.status !== "open");
          if (allSettled) {
            // Roll up: RR parent wins if ANY child won
            const anyWon = siblings.rows.some((r: any) => r.status === "won");
            const allVoid = siblings.rows.every((r: any) => r.status === "void");
            const parentStatus = allVoid ? "void" : anyWon ? "won" : "lost";
            const totalChildPayout = siblings.rows.reduce((s: number, r: any) => s + parseFloat(r.payout_received ?? 0), 0);
            await db.query(
              `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
              [parentStatus, totalChildPayout || null, parentId]
            );
            console.log(`[Book] RR parent #${parentId} settled: ${parentStatus}, total payout: ${totalChildPayout}`);
          }
        }
      }
    } catch (e: any) {
      console.warn("[Book] Grader error:", e.message);
    }
  }

  // ─ Force-settle helper: sweeps any slip where all legs are graded but slip is still open ─
  async function forceSettleStalledSlips(): Promise<{ forceSettled: number; rrSettled: number }> {
    let forceSettled = 0;
    let rrSettled = 0;
    try {
      // Settle any slip (including RR child parlays) where no pending legs remain
      const stalledSlips = await db.query(
        `SELECT s.id, s.account_id, s.slip_type, s.stake, s.rr_parent_id
         FROM book_slips s
         WHERE s.status = 'open'
           AND NOT EXISTS (
             SELECT 1 FROM book_legs l
             WHERE l.slip_id = s.id AND l.result = 'pending'
           )
           AND EXISTS (
             SELECT 1 FROM book_legs l WHERE l.slip_id = s.id
           )`
      );
      for (const slip of stalledSlips.rows) {
        const legsQ = await db.query(`SELECT result, odds_american FROM book_legs WHERE slip_id=$1`, [slip.id]);
        const legResults = legsQ.rows.map((r: any) => r.result);
        if (legResults.length === 0 || legResults.includes("pending")) continue;
        const fssNonVoid   = legResults.filter((r: string) => r !== "void");
        const fssActive    = fssNonVoid.filter((r: string) => r !== "push");
        let slipStatus: string;
        if (legResults.every((r: string) => r === "void"))                                        slipStatus = "void";
        else if (fssNonVoid.length === 0 || fssNonVoid.every((r: string) => r === "push"))        slipStatus = "push";
        else if (fssActive.some((r: string) => r === "loss"))                                     slipStatus = "lost";
        else if (fssActive.every((r: string) => r === "win") && fssActive.length > 0)             slipStatus = "won";
        else                                                                                       slipStatus = "push";
        let finalPayout = 0;
        if (slipStatus === "won") {
          const winOdds = legsQ.rows.filter((r: any) => r.result === "win").map((r: any) => r.odds_american);
          finalPayout = winOdds.length === 1
            ? parseFloat((slip.stake * americanToDecimal(winOdds[0])).toFixed(2))
            : calcParlayPayout(slip.stake, winOdds);
        } else if (slipStatus === "push" || slipStatus === "void") {
          finalPayout = parseFloat(slip.stake);
        }
        await db.query(
          `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
          [slipStatus, slipStatus === "lost" ? 0 : (finalPayout || null), slip.id]
        );
        if (finalPayout > 0 && slipStatus !== "lost") {
          await db.query(`UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`, [finalPayout, slip.account_id]);
          await db.query(
            `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note) VALUES ($1,$2,$3,$4,$5)`,
            [slip.account_id, finalPayout, slipStatus === "won" ? "win" : "push", slip.id, `Force-settled #${slip.id}: ${slipStatus}`]
          );
        }
        forceSettled++;
      }

      // Roll up RR parents where all children are now settled
      const openRRParents = await db.query(
        `SELECT id, account_id FROM book_slips WHERE status='open' AND slip_type='round_robin' AND rr_parent_id IS NULL`
      );
      for (const parent of openRRParents.rows) {
        const children = await db.query(
          `SELECT status, payout_received FROM book_slips WHERE rr_parent_id=$1`, [parent.id]
        );
        if (!children.rows.length) continue;
        const allDone = children.rows.every((r: any) => r.status !== "open");
        if (!allDone) continue;
        const anyWon   = children.rows.some((r: any) => r.status === "won");
        const allVoid  = children.rows.every((r: any) => r.status === "void");
        const parentStatus = allVoid ? "void" : anyWon ? "won" : "lost";
        const totalPayout  = children.rows.reduce((s: number, r: any) => s + parseFloat(r.payout_received ?? 0), 0);
        await db.query(
          `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
          [parentStatus, totalPayout || null, parent.id]
        );
        rrSettled++;
      }
    } catch (e: any) {
      console.warn("[Book] forceSettle error:", e.message);
    }
    return { forceSettled, rrSettled };
  }

  // Run book grader + stall sweep every 5 minutes
  setInterval(async () => {
    await gradeBookLegs();
    await forceSettleStalledSlips();
  }, 5 * 60 * 1000);

  // One-time fix: zero out payout_received on lost slips that were incorrectly credited
  (async () => {
    try {
      // Find lost slips that have a positive payout stored
      const badLost = await db.query(
        `SELECT s.id, s.account_id, s.payout_received
         FROM book_slips s
         WHERE s.status = 'lost' AND s.payout_received > 0`
      );
      for (const slip of badLost.rows) {
        const wrongPayout = parseFloat(slip.payout_received);
        // Zero out the stored payout
        await db.query(`UPDATE book_slips SET payout_received = 0 WHERE id=$1`, [slip.id]);
        // Check if a "win" transaction was posted for this slip and reverse it
        const badTx = await db.query(
          `SELECT id, amount FROM book_transactions WHERE slip_id=$1 AND tx_type='win'`, [slip.id]
        );
        for (const tx of badTx.rows) {
          const amt = parseFloat(tx.amount);
          await db.query(`UPDATE book_accounts SET balance = GREATEST(0, balance - $1) WHERE id=$2`, [amt, slip.account_id]);
          await db.query(`DELETE FROM book_transactions WHERE id=$1`, [tx.id]);
          console.log(`[Book] Reversed incorrect win credit of ${amt} for lost slip #${slip.id}`);
        }
      }
      if (badLost.rows.length > 0) console.log(`[Book] Fixed ${badLost.rows.length} incorrectly credited lost slips`);
    } catch (e: any) {
      console.warn("[Book] Lost-slip credit fix error:", e.message);
    }
  })();

  // ─ POST /api/book/fix-legs ── owner tool to correct wrong team/stat on pending legs ──
  app.post("/api/book/fix-legs", requireOwner, async (req: Request, res: Response) => {
    try {
      const { playerName, homeTeam, awayTeam, gameDate, fixDate, statType, forceStatType } = req.body ?? {};
      const setClauses: string[] = [];
      const params: any[] = [];
      if (homeTeam)  { params.push(homeTeam);  setClauses.push(`home_team=$${params.length}`); }
      if (awayTeam)  { params.push(awayTeam);  setClauses.push(`away_team=$${params.length}`); }
      if (fixDate)   { params.push(fixDate);   setClauses.push(`game_date=$${params.length}`); }
      // statType: only update legs that DON'T already have a specific stat type
      // (i.e. only update legs with stripped/generic types like 'hits', 'hrr', null)
      // unless forceStatType=true is passed explicitly
      if (statType) {
        params.push(statType);
        setClauses.push(`stat_type=$${params.length}`);
      }
      if (!setClauses.length) return res.status(400).json({ error: "nothing to update" });
      // Build WHERE clause — if playerName is '%' treat as wildcard across all players
      const whereParts: string[] = ["result='pending'"];
      if (gameDate) whereParts.push(`game_date='${gameDate}'`);
      if (playerName && playerName !== "%") {
        params.push(playerName);
        whereParts.push(`player_name ILIKE $${params.length}`);
      }
      // SAFETY: when statType is provided without forceStatType=true, only overwrite legs
      // that have a stripped/generic stat_type (no 'player_' prefix) or are null.
      // This prevents accidentally overwriting specific types like player_hrr, player_total_bases, etc.
      // Pass forceStatType:true in the request body to bypass this guard.
      if (statType && !forceStatType) {
        whereParts.push(`(stat_type IS NULL OR stat_type NOT LIKE 'player_%')`);
      }
      const result = await db.query(
        `UPDATE book_legs SET ${setClauses.join(",")} WHERE ${whereParts.join(" AND ")}`,
        params
      );
      res.json({ ok: true, updated: result.rowCount });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ GET /api/book/debug-legs ─────────────────────────────────────────────
  app.get("/api/book/debug-legs", requireOwner, async (req: Request, res: Response) => {
    try {
      const legs = await db.query(
        `SELECT l.id, l.player_name, l.bet_type, l.stat_type, l.game_date, l.sport,
                l.home_team, l.away_team, l.result, l.line, l.over_under
         FROM book_legs l
         JOIN book_slips s ON l.slip_id = s.id
         WHERE l.result = 'pending' AND s.status = 'open'
         ORDER BY l.game_date ASC LIMIT 50`
      );
      res.json({ legs: legs.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ POST /api/book/grade-now ───────────────────────────────────────────
  // Owner-only manual trigger to run the grader immediately
  app.post("/api/book/grade-now", requireOwner, async (req: Request, res: Response) => {
    try {
      await gradeBookLegs();
      const { forceSettled, rrSettled } = await forceSettleStalledSlips();
      res.json({ ok: true, forceSettled, rrSettled });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ GET /api/book/accounts ────────────────────────────────────
  app.get("/api/book/accounts", requireOwner, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.userId;
      const accounts = await db.query(
        `SELECT a.*,
           COALESCE(SUM(CASE WHEN s.status='won' THEN s.payout_received - s.stake ELSE 0 END),0) as total_profit,
           COUNT(CASE WHEN s.status IN ('won','lost','push') THEN 1 END) as settled_slips,
           COUNT(CASE WHEN s.status='won' THEN 1 END) as won_slips,
           COUNT(CASE WHEN s.status='open' THEN 1 END) as open_slips
         FROM book_accounts a
         LEFT JOIN book_slips s ON s.account_id = a.id
         WHERE a.user_id=$1
         GROUP BY a.id ORDER BY a.created_at ASC`,
        [userId]
      );
      res.json({ accounts: accounts.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ POST /api/book/accounts ─────────────────────────────────
  app.post("/api/book/accounts", requireOwner, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.userId;
      const { name } = req.body ?? {};
      const acct = await db.queryOne(
        `INSERT INTO book_accounts (user_id, name, balance) VALUES ($1,$2,10000) RETURNING *`,
        [userId, name ?? "New Account"]
      );
      await db.query(
        `INSERT INTO book_transactions (account_id, amount, tx_type, note) VALUES ($1,10000,'deposit','Starting balance')`,
        [acct.id]
      );
      res.json({ account: acct });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ PATCH /api/book/accounts/:id ────────────────────────────
  app.patch("/api/book/accounts/:id", requireOwner, async (req: Request, res: Response) => {
    try {
      const { name, addCoins, removeCoins } = req.body ?? {};
      const id = parseInt(req.params.id);
      if (name) await db.query(`UPDATE book_accounts SET name=$1 WHERE id=$2`, [name, id]);
      if (addCoins && addCoins > 0) {
        await db.query(`UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`, [addCoins, id]);
        await db.query(
          `INSERT INTO book_transactions (account_id, amount, tx_type, note) VALUES ($1,$2,'deposit','Manual deposit')`,
          [id, addCoins]
        );
      }
      if (removeCoins && removeCoins > 0) {
        // Clamp so balance never goes below 0
        await db.query(`UPDATE book_accounts SET balance = GREATEST(0, balance - $1) WHERE id=$2`, [removeCoins, id]);
        await db.query(
          `INSERT INTO book_transactions (account_id, amount, tx_type, note) VALUES ($1,$2,'withdrawal','Manual withdrawal')`,
          [id, removeCoins]
        );
      }
      const updated = await db.queryOne(`SELECT * FROM book_accounts WHERE id=$1`, [id]);
      res.json({ account: updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ DELETE /api/book/accounts/:id ───────────────────────────
  app.delete("/api/book/accounts/:id", requireOwner, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const acct = await db.queryOne(`SELECT id, name FROM book_accounts WHERE id=$1`, [id]);
      if (!acct) return res.status(404).json({ error: "Account not found" });
      // All child tables have ON DELETE CASCADE on account_id, so one delete handles everything
      const result = await db.query(`DELETE FROM book_accounts WHERE id=$1`, [id]);
      console.log(`[Book] Deleted account ${id} (${acct.name}), rows affected: ${result?.rowCount ?? 'unknown'}`);
      res.json({ ok: true, deleted: id });
    } catch (e: any) {
      console.error(`[Book] Delete account error:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─ GET /api/book/odds?sport=mlb ────────────────────────────
  app.get("/api/book/odds", requireOwner, async (req: Request, res: Response) => {
    try {
      const sport = (req.query.sport as string) ?? "mlb";
      const odds = await fetchDraftKingsOdds(sport);
      res.json({ sport, games: odds });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ GET /api/book/props?sport=mlb&eventId=xxx&homeTeam=X&awayTeam=Y ─────────
  app.get("/api/book/props", requireOwner, async (req: Request, res: Response) => {
    try {
      const sport     = (req.query.sport as string) ?? "mlb";
      const eventId   = req.query.eventId as string;
      const homeTeam  = (req.query.homeTeam as string) ?? "";
      const awayTeam  = (req.query.awayTeam as string) ?? "";
      const debug     = req.query.debug === "1";
      if (!eventId) return res.status(400).json({ error: "eventId required" });

      // Debug: show what key is resolved
      if (debug) {
        const k = await getOddsApiKey();
        const hasEnv = !!process.env.ODDS_API_KEY;
        const dbSettings = await storage.getSettings();
        const hasDb = !!dbSettings?.oddsApiKey;
        // Live API test — bulk endpoint for player props
        let apiTestResult: any = {};
        const sportKey = sport.toLowerCase() === "mlb" ? "baseball_mlb" :
                         sport.toLowerCase() === "nba" ? "basketball_nba" :
                         sport.toLowerCase() === "nhl" ? "icehockey_nhl" : "basketball_nba";
        if (k) {
          try {
            const testUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${k}&regions=us&markets=player_points,player_hits&bookmakers=draftkings,fanduel&oddsFormat=american`;
            const testResp = await axios.get(testUrl, { timeout: 10000 });
            const events: any[] = Array.isArray(testResp.data) ? testResp.data : [];
            const propEvents = events.filter((e: any) =>
              e.bookmakers?.some((b: any) => b.markets?.length > 0)
            );
            apiTestResult = {
              ok: true,
              totalEvents: events.length,
              eventsWithProps: propEvents.length,
              sampleEventIds: propEvents.slice(0, 3).map((e: any) => e.id),
              remainingRequests: testResp.headers["x-requests-remaining"],
              usedRequests: testResp.headers["x-requests-used"],
              rawSample: propEvents[0] ? {
                id: propEvents[0].id,
                teams: `${propEvents[0].away_team} @ ${propEvents[0].home_team}`,
                bookmakers: propEvents[0].bookmakers?.map((b: any) => ({
                  key: b.key,
                  markets: b.markets?.map((m: any) => `${m.key}(${m.outcomes?.length})`)
                }))
              } : null
            };
          } catch (e: any) {
            apiTestResult = { ok: false, error: e.response?.data?.message ?? e.message, status: e.response?.status };
          }
        }
        return res.json({ debug: true, hasEnvKey: hasEnv, hasDbKey: hasDb, keyFirst8: k ? k.slice(0,8) : "NONE", apiTest: apiTestResult });
      }

      const allMarkets = await fetchDraftKingsProps(sport, eventId);

      // Explicit Odds-API full name → Linemate short code map (avoids fuzzy false matches)
      const ODDS_TO_LM: Record<string, string> = {
        // MLB
        "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
        "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
        "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL",
        "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
        "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
        "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
        "New York Yankees": "NYY", "Oakland Athletics": "OAK", "Philadelphia Phillies": "PHI",
        "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
        "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
        "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH",
        "Athletics": "OAK",
        // NBA
        "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
        "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
        "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
        "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
        "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
        "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
        "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
        "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
        "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
        "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
        // NFL
        "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
        "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
        "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
        "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
        "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
        "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
        "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
        "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
        "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
        "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
        "Tennessee Titans": "TEN", "Washington Commanders": "WSH",
        // NHL
        "Anaheim Ducks": "ANA", "Arizona Coyotes": "ARI", "Boston Bruins": "BOS",
        "Buffalo Sabres": "BUF", "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR",
        "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ",
        "Dallas Stars": "DAL", "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM",
        "Florida Panthers": "FLA", "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN",
        "Montreal Canadiens": "MTL", "Nashville Predators": "NSH", "New Jersey Devils": "NJD",
        "New York Islanders": "NYI", "New York Rangers": "NYR", "Ottawa Senators": "OTT",
        "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS",
        "Seattle Kraken": "SEA", "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL",
        "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN",
        "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
      };

      // Resolve the two team codes for this game
      const teamCodesToAllow = new Set<string>();
      for (const teamName of [homeTeam, awayTeam].filter(Boolean)) {
        const code = ODDS_TO_LM[teamName];
        if (code) {
          teamCodesToAllow.add(code);
        } else {
          // Fallback: last word of team name as code guess (e.g. "Mets" → "NYM" won't match, but at least we tried)
          // Also try scanning actual outcome team codes to see if any code is contained in the team name
          console.log(`[Book Props] No exact code mapping for "${teamName}" — trying fuzzy fallback`);
          const nameLower = teamName.toLowerCase();
          const lastName = nameLower.split(" ").pop() ?? "";
          for (const m of allMarkets) {
            for (const o of (m.outcomes ?? [])) {
              const code2 = (o.team ?? "").toUpperCase();
              if (!code2) continue;
              // Only match if the code is 2-3 chars and is a clean abbreviation of the city/team
              // Never match generic short words
              if (code2.length >= 2 && code2.length <= 4 &&
                  (nameLower.includes(code2.toLowerCase()) && code2.length >= 3)) {
                teamCodesToAllow.add(o.team);
              }
            }
          }
        }
      }

      let allowedCodes: Set<string> | null = teamCodesToAllow.size > 0 ? teamCodesToAllow : null;

      // Filter markets to only this game's teams, then enrich with full team name
      const enriched = allMarkets
        .map((m: any) => ({
          ...m,
          outcomes: (m.outcomes ?? []).filter((o: any) =>
            !allowedCodes || allowedCodes.has(o.team)
          ).map((o: any) => ({
            ...o,
            // Map linemate team code to full team name
            team: o.team
              ? ([homeTeam, awayTeam].find((t: string) => t?.toLowerCase().includes((o.team ?? "").toLowerCase())) ?? o.team)
              : null,
          })),
        }))
        .filter((m: any) => m.outcomes.length > 0);

      res.json({ markets: enriched, homeTeam, awayTeam });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ POST /api/book/bet ──────────────────────────────────────
  // Body: { accountId, slipType, stake, legs: [{ sport, betType, gameId, homeTeam, awayTeam,
  //         playerId, playerName, statType, line, overUnder, pickLabel, oddsAmerican, gameDate, gameTime }]
  //         rrSize? (for round robin — 2 or 3 legs per combo) }
  app.post("/api/book/bet", requireOwner, async (req: Request, res: Response) => {
    try {
      const { accountId, slipType, stake, legs, rrSize } = req.body ?? {};
      if (!accountId || !stake || !legs?.length) return res.status(400).json({ error: "accountId, stake, legs required" });
      if (stake <= 0) return res.status(400).json({ error: "Stake must be positive" });

      const account = await db.queryOne(`SELECT * FROM book_accounts WHERE id=$1`, [accountId]);
      if (!account) return res.status(404).json({ error: "Account not found" });

      if (slipType === "round_robin") {
        const comboSize = rrSize ?? 2;
        const combos = getCombinations(legs, comboSize);
        if (!combos.length) return res.status(400).json({ error: "Not enough legs for round robin" });

        const stakePerCombo = parseFloat((stake / combos.length).toFixed(2));
        const totalStake = stakePerCombo * combos.length;
        if (parseFloat(account.balance) < totalStake)
          return res.status(400).json({ error: `Insufficient coins. Need ${totalStake}, have ${account.balance}` });

        // Create parent RR slip (no payout — just a container)
        const parent = await db.queryOne(
          `INSERT INTO book_slips (account_id, slip_type, stake, potential_payout, status)
           VALUES ($1,'round_robin',$2,$3,'open') RETURNING *`,
          [accountId, totalStake, 0]
        );

        const childSlips: any[] = [];
        for (const combo of combos) {
          const comboOdds = combo.map((l: any) => l.oddsAmerican);
          const comboPayout = calcParlayPayout(stakePerCombo, comboOdds);
          const child = await db.queryOne(
            `INSERT INTO book_slips (account_id, slip_type, rr_parent_id, stake, potential_payout, status)
             VALUES ($1,'parlay',$2,$3,$4,'open') RETURNING *`,
            [accountId, parent.id, stakePerCombo, comboPayout]
          );
          for (const leg of combo) {
            await db.query(
              `INSERT INTO book_legs (slip_id,sport,bet_type,game_id,home_team,away_team,player_id,player_name,stat_type,line,over_under,pick_label,odds_american,game_date,game_time)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
              [child.id,leg.sport,leg.betType,leg.gameId,leg.homeTeam,leg.awayTeam,leg.playerId,leg.playerName,leg.statType,leg.line,leg.overUnder,leg.pickLabel,leg.oddsAmerican,leg.gameDate,leg.gameTime]
            );
          }
          childSlips.push(child);
        }

        await db.query(`UPDATE book_accounts SET balance = balance - $1 WHERE id=$2`, [totalStake, accountId]);
        await db.query(
          `INSERT INTO book_transactions (account_id,amount,tx_type,slip_id,note) VALUES ($1,$2,'stake',$3,$4)`,
          [accountId, -totalStake, parent.id, `RR ${combos.length}x${comboSize}-leg parlays`]
        );
        return res.json({ ok: true, slipType: "round_robin", parentId: parent.id, combos: childSlips.length, totalStake });
      }

      // Single or Parlay
      const oddsArr = legs.map((l: any) => l.oddsAmerican);
      const payout = slipType === "parlay"
        ? calcParlayPayout(stake, oddsArr)
        : parseFloat((stake * americanToDecimal(oddsArr[0])).toFixed(2));

      if (parseFloat(account.balance) < stake)
        return res.status(400).json({ error: `Insufficient coins. Need ${stake}, have ${account.balance}` });

      const slip = await db.queryOne(
        `INSERT INTO book_slips (account_id,slip_type,stake,potential_payout,status)
         VALUES ($1,$2,$3,$4,'open') RETURNING *`,
        [accountId, slipType, stake, payout]
      );
      for (const leg of legs) {
        await db.query(
          `INSERT INTO book_legs (slip_id,sport,bet_type,game_id,home_team,away_team,player_id,player_name,stat_type,line,over_under,pick_label,odds_american,game_date,game_time)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [slip.id,leg.sport,leg.betType,leg.gameId,leg.homeTeam,leg.awayTeam,leg.playerId,leg.playerName,leg.statType,leg.line,leg.overUnder,leg.pickLabel,leg.oddsAmerican,leg.gameDate,leg.gameTime]
        );
      }
      await db.query(`UPDATE book_accounts SET balance = balance - $1 WHERE id=$2`, [stake, accountId]);
      await db.query(
        `INSERT INTO book_transactions (account_id,amount,tx_type,slip_id,note) VALUES ($1,$2,'stake',$3,$4)`,
        [accountId, -stake, slip.id, `${slipType} bet placed`]
      );
      res.json({ ok: true, slipType, slipId: slip.id, stake, potentialPayout: payout });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ GET /api/book/slips?accountId=&status=open|settled|all ───────
  app.get("/api/book/slips", requireOwner, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.query.accountId as string);
      const status    = (req.query.status as string) ?? "all";
      const limit     = parseInt((req.query.limit as string) ?? "50");
      let where = `WHERE s.account_id=$1`;
      if (status === "open")    where += ` AND s.status='open'`;
      if (status === "settled") where += ` AND s.status IN ('won','lost','push','void')`;

      // LEFT JOIN so RR parent slips (no direct legs) still appear.
      // For RR parents, aggregate child legs separately and merge in.
      const slips = await db.query(
        `SELECT s.*,
           COALESCE(json_agg(l ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]'::json) as legs
         FROM book_slips s
         LEFT JOIN book_legs l ON l.slip_id = s.id
         ${where} AND s.rr_parent_id IS NULL
         GROUP BY s.id
         ORDER BY s.placed_at DESC
         LIMIT $2`,
        [accountId, limit]
      );

      // For round_robin parent slips (legs=[]), fetch all child legs so UI can display them
      const rows = slips.rows;
      const rrParentIds = rows
        .filter((r: any) => r.slip_type === "round_robin" && (!r.legs || r.legs.length === 0))
        .map((r: any) => r.id);

      if (rrParentIds.length > 0) {
        // Fetch child slips with their legs grouped per combo
        const childSlipsQ = await db.query(
          `SELECT cs.id, cs.rr_parent_id, cs.status as child_status, cs.potential_payout as child_payout,
                  COALESCE(json_agg(l ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]'::json) as legs
           FROM book_slips cs
           LEFT JOIN book_legs l ON l.slip_id = cs.id
           WHERE cs.rr_parent_id = ANY($1::int[])
           GROUP BY cs.id`,
          [rrParentIds]
        );
        // Map: parentId -> array of child slips
        const childSlipsByParent: Record<number, any[]> = {};
        for (const cs of childSlipsQ.rows) {
          if (!childSlipsByParent[cs.rr_parent_id]) childSlipsByParent[cs.rr_parent_id] = [];
          childSlipsByParent[cs.rr_parent_id].push(cs);
        }
        // Merge into parent rows
        for (const row of rows) {
          if (row.slip_type === "round_robin" && childSlipsByParent[row.id]) {
            row.rr_combos = childSlipsByParent[row.id]; // array of {id, child_status, child_payout, legs[]}
            // For display: flatten all unique legs across combos
            const legMap = new Map<string, any>();
            for (const combo of childSlipsByParent[row.id]) {
              for (const leg of combo.legs) {
                const key = `${leg.game_id}:${leg.bet_type}:${leg.pick_label}`;
                if (!legMap.has(key)) legMap.set(key, leg);
              }
            }
            row.legs = Array.from(legMap.values());
          }
        }
      }

      res.json({ slips: rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ POST /api/book/settle-leg ─────────────────────────────────────────────
  // Owner-only: manually settle a single leg as push or void (e.g. postponed game).
  // After updating the leg, re-evaluates the parent slip settlement.
  app.post("/api/book/settle-leg", requireOwner, async (req: Request, res: Response) => {
    try {
      const { legId, result } = req.body ?? {};
      if (!legId || !["push", "void"].includes(result)) {
        return res.status(400).json({ error: "legId and result (push|void) required" });
      }

      // Update the leg
      await db.query(
        `UPDATE book_legs SET result=$1, graded_at=NOW(), note='Manual: postponed/rescheduled' WHERE id=$2`,
        [result, legId]
      );

      // Get slip info for this leg
      const leg = await db.queryOne(`SELECT * FROM book_legs WHERE id=$1`, [legId]);
      if (!leg) return res.status(404).json({ error: "Leg not found" });

      const slipId = leg.slip_id;

      // Check if all legs in slip are now graded
      const slipLegs = await db.query(`SELECT result, odds_american FROM book_legs WHERE slip_id=$1`, [slipId]);
      const legResults = slipLegs.rows.map((r: any) => r.result);

      if (legResults.includes("pending")) {
        return res.json({ ok: true, slipSettled: false, message: "Leg settled. Slip still has pending legs." });
      }

      // All legs graded — determine slip outcome
      // Parlay rules: push/void legs are removed; remaining wins = won at adjusted odds
      const slip = await db.queryOne(`SELECT * FROM book_slips WHERE id=$1`, [slipId]);
      const msNonVoid  = legResults.filter((r: string) => r !== "void");
      const msActive   = msNonVoid.filter((r: string) => r !== "push");
      let slipStatus: string;
      if (legResults.every((r: string) => r === "void"))                                   slipStatus = "void";
      else if (msNonVoid.length === 0 || msNonVoid.every((r: string) => r === "push"))     slipStatus = "push";
      else if (msActive.some((r: string) => r === "loss"))                                 slipStatus = "lost";
      else if (msActive.every((r: string) => r === "win") && msActive.length > 0)          slipStatus = "won";
      else                                                                                  slipStatus = "push";

      let finalPayout = 0;
      if (slipStatus === "won") {
        // Payout calculated on win legs only (push/void removed)
        const winOdds = slipLegs.rows.filter((r: any) => r.result === "win").map((r: any) => r.odds_american);
        finalPayout = winOdds.length === 1
          ? parseFloat((slip.stake * americanToDecimal(winOdds[0])).toFixed(2))
          : calcParlayPayout(slip.stake, winOdds);
      } else if (slipStatus === "push" || slipStatus === "void") {
        finalPayout = parseFloat(slip.stake); // stake returned
      }

      await db.query(
        `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
        [slipStatus, slipStatus === "lost" ? 0 : (finalPayout || null), slipId]
      );

      if (finalPayout > 0) {
        await db.query(`UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`, [finalPayout, slip.account_id]);
        const txType = slipStatus === "won" ? "win" : slipStatus === "push" ? "push" : "void_refund";
        await db.query(
          `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note) VALUES ($1,$2,$3,$4,$5)`,
          [slip.account_id, finalPayout, txType, slipId, `Leg #${legId} settled as ${result} → slip ${slipStatus}`]
        );
      }

      // Roll up RR parent if applicable
      const parentCheck = await db.queryOne(`SELECT rr_parent_id FROM book_slips WHERE id=$1`, [slipId]);
      if (parentCheck?.rr_parent_id) {
        const parentId = parentCheck.rr_parent_id;
        const siblings = await db.query(`SELECT status, payout_received FROM book_slips WHERE rr_parent_id=$1`, [parentId]);
        if (siblings.rows.every((r: any) => r.status !== "open")) {
          const anyWon = siblings.rows.some((r: any) => r.status === "won");
          const allVoid = siblings.rows.every((r: any) => r.status === "void");
          const parentStatus = allVoid ? "void" : anyWon ? "won" : "lost";
          const totalPayout = siblings.rows.reduce((s: number, r: any) => s + parseFloat(r.payout_received ?? 0), 0);
          await db.query(`UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`, [parentStatus, totalPayout || null, parentId]);
        }
      }

      res.json({ ok: true, slipSettled: true, slipStatus, finalPayout });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ GET /api/book/transactions?accountId= ─────────────────────
  // ─ GET /api/book/slip-progress?slipId= ──────────────────────────────────
  // Returns live ESPN stat progress for every leg in a slip.
  app.get("/api/book/slip-progress", requireOwner, async (req: Request, res: Response) => {
    try {
      const slipId = parseInt(req.query.slipId as string);
      if (!slipId) return res.status(400).json({ error: "slipId required" });

      const slip = await db.queryOne(`SELECT * FROM book_slips WHERE id=$1`, [slipId]);
      if (!slip) return res.status(404).json({ error: "Slip not found" });

      let legs: any[];
      if (slip.slip_type === "round_robin") {
        const childLegs = await db.query(
          `SELECT DISTINCT ON (l.game_id, l.bet_type, l.pick_label) l.*
           FROM book_slips cs JOIN book_legs l ON l.slip_id = cs.id
           WHERE cs.rr_parent_id=$1 ORDER BY l.game_id, l.bet_type, l.pick_label, l.id`,
          [slipId]
        );
        legs = childLegs.rows;
      } else {
        const result = await db.query(`SELECT * FROM book_legs WHERE slip_id=$1 ORDER BY id`, [slipId]);
        legs = result.rows;
      }

      const PROP_TO_STAT: Record<string, string> = {
        player_hits: "HITS", player_home_runs: "HR", player_rbis: "RBI",
        player_runs_scored: "RUNS_SCORED", player_total_bases: "TOTAL_BASES",
        player_singles: "SINGLES", player_doubles: "DOUBLES",
        player_stolen_bases: "STOLEN_BASES", player_strikeouts: "STRIKEOUTS_BATTER",
        player_pitcher_strikeouts: "PITCHER_K", player_pitcher_outs: "PITCHER_OUTS",
        player_hits_allowed: "HITS_ALLOWED", player_earned_runs: "EARNED_RUNS",
        player_walks: "WALKS", player_pitcher_walks: "WALKS_ALLOWED",
        player_points: "POINTS", player_rebounds: "REBOUNDS", player_assists: "ASSISTS",
        player_threes: "3PM", player_blocks: "BLOCKS", player_steals: "STEALS",
        player_points_rebounds_assists: "PRA",
        player_passing_yards: "PASS_YDS", player_rushing_yards: "RUSH_YDS",
        player_reception_yards: "REC_YDS", player_receptions: "RECEPTIONS",
        player_passing_tds: "TOUCHDOWNS", player_shots_on_goal: "SHOTS_ON_GOAL",
        player_goals: "GOALS",
        // HRR = Hits + Runs + RBI combined
        player_hrr: "HRR",
      };

      const SPORT_KEY_MAP: Record<string, string> = {
        baseball_mlb: "MLB", mlb: "MLB",
        basketball_nba: "NBA", nba: "NBA",
        icehockey_nhl: "NHL", nhl: "NHL",
        americanfootball_nfl: "NFL", nfl: "NFL",
      };

      // Cache ESPN scoreboard + summaries within this request
      const scoreboardCache: Record<string, any[]> = {};
      const summaryCache: Record<string, any> = {};

      const results = await Promise.all(legs.map(async (leg: any) => {
        const base: any = {
          legId: leg.id, playerName: leg.player_name, statType: leg.stat_type,
          line: leg.line, overUnder: leg.over_under, pickLabel: leg.pick_label,
          oddsAmerican: leg.odds_american, gameDate: leg.game_date,
          homeTeam: leg.home_team, awayTeam: leg.away_team, betType: leg.bet_type,
          currentStat: null, gameStatus: "scheduled",
          status: leg.result ?? "pending", legResult: leg.result ?? null,
        };

        // Team bets or no stat type — skip stat lookup
        if (!leg.player_name || !leg.stat_type) return base;

        const sportKey = (leg.sport ?? "mlb").toLowerCase();
        const espnSport = SPORT_KEY_MAP[sportKey] ?? "MLB";
        const statCat = PROP_TO_STAT[leg.stat_type] ?? leg.stat_type?.toUpperCase().replace("PLAYER_", "");

        try {
          // Use CDT date (UTC-5) to avoid fetching wrong day after 7pm CDT
          const cdtNow = new Date(Date.now() - 5 * 3600 * 1000);
          const today = cdtNow.toISOString().slice(0,10).replace(/-/g,"");
          const yesterday = new Date(cdtNow.getTime() - 86400000).toISOString().slice(0,10).replace(/-/g,"");
          if (!scoreboardCache[espnSport]) {
            // Fetch both today and yesterday to catch late-graded games
            const [todayEvents, yestEvents] = await Promise.all([
              mlFetchScoreboard(espnSport, today),
              mlFetchScoreboard(espnSport, yesterday),
            ]);
            scoreboardCache[espnSport] = [...todayEvents, ...yestEvents];
          }
          const events: any[] = scoreboardCache[espnSport] ?? [];

          const matchedEvent = events.find((ev: any) => {
            const comp = ev.competitions?.[0];
            const teams = (comp?.competitors ?? []).map((c: any) => c.team?.displayName ?? "");
            return teams.some((t: string) => mlTeamsMatch(t, leg.home_team ?? "")) ||
                   teams.some((t: string) => mlTeamsMatch(t, leg.away_team ?? ""));
          });
          if (!matchedEvent) return base;

          const comp = matchedEvent.competitions?.[0];
          const statusType = comp?.status?.type;
          const gameState = statusType?.name ?? "STATUS_SCHEDULED";
          const POSTPONED_STATES = ["STATUS_POSTPONED", "STATUS_SUSPENDED", "STATUS_CANCELED", "STATUS_CANCELLED", "STATUS_RAIN_DELAY", "STATUS_DELAYED"];
          let gameStatus = "scheduled";
          if (statusType?.completed) gameStatus = "final";
          else if (POSTPONED_STATES.includes(gameState)) gameStatus = "postponed";
          else if (gameState === "STATUS_IN_PROGRESS" || gameState === "STATUS_HALFTIME" || gameState === "STATUS_END_PERIOD") gameStatus = "live";
          base.gameStatus = gameStatus;
          if (gameStatus === "postponed") {
            base.postponedReason = comp?.status?.type?.description ?? gameState.replace("STATUS_", "").replace(/_/g, " ");
          }

          // Get score
          const homeComp = comp?.competitors?.find((c: any) => c.homeAway === "home");
          const awayComp = comp?.competitors?.find((c: any) => c.homeAway === "away");
          base.homeScore = homeComp?.score ?? null;
          base.awayScore = awayComp?.score ?? null;
          base.gamePeriod = comp?.status?.displayClock ?? null;
          // Build a human-readable period/inning label per sport
          const period = comp?.status?.period ?? null;
          const clockStr = comp?.status?.displayClock ?? null;
          const statusDesc = comp?.status?.type?.description ?? "";
          const statusName = comp?.status?.type?.name ?? "";
          if (period) {
            if (espnSport === "MLB") {
              // ESPN uses displayClock for "Top" or "Bot" in MLB
              const half = (clockStr ?? "").toLowerCase().includes("bot") ||
                           (statusDesc ?? "").toLowerCase().includes("bot") ?
                           "Bot" : "Top";
              const ordinals = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];
              base.gamePeriodLabel = `${half} ${ordinals[period - 1] ?? period + "th"}`;
              base.gamePeriod = null; // clock not meaningful for MLB
            } else if (espnSport === "NBA") {
              if (statusName === "STATUS_HALFTIME") {
                base.gamePeriodLabel = "Halftime";
              } else if (period > 4) {
                base.gamePeriodLabel = `OT${period - 4 > 1 ? (period - 4) : ""}`;
              } else {
                base.gamePeriodLabel = `Q${period}`;
              }
            } else if (espnSport === "NHL") {
              if (period > 3) {
                base.gamePeriodLabel = statusName === "STATUS_SHOOTOUT" ? "Shootout" : `OT${period - 3 > 1 ? (period - 3) : ""}`;
              } else {
                base.gamePeriodLabel = `${["1st","2nd","3rd"][period - 1] ?? period + "rd"} Period`;
              }
            } else if (espnSport === "NFL") {
              if (statusName === "STATUS_HALFTIME") {
                base.gamePeriodLabel = "Halftime";
              } else if (period > 4) {
                base.gamePeriodLabel = "OT";
              } else {
                base.gamePeriodLabel = `Q${period}`;
              }
            } else {
              base.gamePeriodLabel = `Period ${period}`;
            }
          } else {
            base.gamePeriodLabel = null;
          }

          if (gameStatus === "scheduled" || gameStatus === "postponed") return base;

          const espnId = matchedEvent.id;
          if (!summaryCache[espnId]) {
            summaryCache[espnId] = await mlFetchGameSummary(espnSport, espnId);
          }
          const summary = summaryCache[espnId];
          if (!summary) return base;

          const stat = mlExtractPlayerStat(summary, espnSport, leg.player_name, statCat);
          base.currentStat = stat;

          if (stat !== null && leg.result == null) {
            const line = parseFloat(leg.line);
            const isOver = (leg.over_under ?? "over") === "over";
            if (gameStatus === "final") {
              if (isOver) base.status = stat > line ? "win" : stat === line ? "push" : "loss";
              else        base.status = stat < line ? "win" : stat === line ? "push" : "loss";
            } else {
              if (isOver) base.status = stat >= line ? "winning" : "losing";
              else        base.status = stat <= line ? "winning" : "losing";
            }
          }
        } catch { /* ESPN unavailable */ }

        return base;
      }));

      res.json({ legs: results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/book/transactions", requireOwner, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.query.accountId as string);
      const txns = await db.query(
        `SELECT * FROM book_transactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [accountId]
      );
      res.json({ transactions: txns.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─ GET /api/book/insights?accountId= ───────────────────────
  app.get("/api/book/insights", requireOwner, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.query.accountId as string);

      const slips = await db.query(
        `SELECT s.slip_type, s.status, s.stake, s.payout_received,
                l.sport, l.bet_type, l.stat_type, l.odds_american, l.result as leg_result
         FROM book_slips s
         JOIN book_legs l ON l.slip_id = s.id
         WHERE s.account_id=$1 AND s.status IN ('won','lost','push') AND s.rr_parent_id IS NULL`,
        [accountId]
      );

      const bankroll = await db.query(
        `SELECT amount, tx_type, created_at FROM book_transactions WHERE account_id=$1 ORDER BY created_at ASC`,
        [accountId]
      );

      // ROI by bet type
      const roiByType: Record<string, { stake: number; profit: number; count: number; wins: number }> = {};
      const roiBySport: Record<string, { stake: number; profit: number; count: number; wins: number }> = {};
      const roiByStatType: Record<string, { stake: number; profit: number; count: number; wins: number }> = {};

      for (const row of slips.rows) {
        const profit = row.status === "won" ? parseFloat(row.payout_received) - parseFloat(row.stake)
                     : row.status === "push" ? 0
                     : -parseFloat(row.stake);
        const key = row.slip_type;
        if (!roiByType[key]) roiByType[key] = { stake: 0, profit: 0, count: 0, wins: 0 };
        roiByType[key].stake  += parseFloat(row.stake);
        roiByType[key].profit += profit;
        roiByType[key].count  += 1;
        if (row.status === "won") roiByType[key].wins += 1;

        const sk = row.sport ?? "unknown";
        if (!roiBySport[sk]) roiBySport[sk] = { stake: 0, profit: 0, count: 0, wins: 0 };
        roiBySport[sk].stake  += parseFloat(row.stake);
        roiBySport[sk].profit += profit;
        roiBySport[sk].count  += 1;
        if (row.status === "won") roiBySport[sk].wins += 1;

        if (row.stat_type) {
          const stk = row.stat_type;
          if (!roiByStatType[stk]) roiByStatType[stk] = { stake: 0, profit: 0, count: 0, wins: 0 };
          roiByStatType[stk].stake  += parseFloat(row.stake);
          roiByStatType[stk].profit += profit;
          roiByStatType[stk].count  += 1;
          if (row.status === "won") roiByStatType[stk].wins += 1;
        }
      }

      // Bankroll curve (running balance)
      // tx_types that reduce balance: 'stake', 'withdrawal'
      // tx_types that increase balance: 'deposit', 'win', 'push', 'void_refund'
      const DEBIT_TYPES = new Set(["stake", "withdrawal"]);
      let running = 0;
      const curve = bankroll.rows.map((t: any) => {
        const amt = parseFloat(t.amount);
        running += DEBIT_TYPES.has(t.tx_type) ? -amt : amt;
        return { ts: t.created_at, balance: parseFloat(running.toFixed(2)), type: t.tx_type };
      });

      // Build insight tips
      const tips: string[] = [];
      for (const [type, d] of Object.entries(roiByType)) {
        const roi = d.stake > 0 ? (d.profit / d.stake * 100) : 0;
        if (type === "parlay" && roi < -10) tips.push(`Your parlay ROI is ${roi.toFixed(1)}% — consider fewer legs or smaller parlay stakes.`);
        if (type === "single" && roi > 5)  tips.push(`Singles are your best bet type at ${roi.toFixed(1)}% ROI.`);
      }
      for (const [sport, d] of Object.entries(roiBySport)) {
        const roi = d.stake > 0 ? (d.profit / d.stake * 100) : 0;
        if (roi > 10 && d.count >= 5) tips.push(`${sport.toUpperCase()} bets are profitable at ${roi.toFixed(1)}% ROI over ${d.count} bets.`);
        if (roi < -15 && d.count >= 5) tips.push(`${sport.toUpperCase()} is costing you — ${roi.toFixed(1)}% ROI. Consider skipping or reducing stake.`);
      }
      for (const [st, d] of Object.entries(roiByStatType)) {
        const roi = d.stake > 0 ? (d.profit / d.stake * 100) : 0;
        if (roi > 15 && d.count >= 3) tips.push(`${st} props are hitting at ${roi.toFixed(1)}% ROI — lean into these.`);
      }
      if (tips.length === 0) tips.push("Place more bets to unlock performance insights.");

      res.json({
        roiByType: Object.entries(roiByType).map(([k,v]) => ({ type: k, ...v, roi: v.stake > 0 ? +(v.profit/v.stake*100).toFixed(1) : 0, winPct: v.count > 0 ? +(v.wins/v.count*100).toFixed(1) : 0 })),
        roiBySport: Object.entries(roiBySport).map(([k,v]) => ({ sport: k, ...v, roi: v.stake > 0 ? +(v.profit/v.stake*100).toFixed(1) : 0, winPct: v.count > 0 ? +(v.wins/v.count*100).toFixed(1) : 0 })),
        roiByStatType: Object.entries(roiByStatType).map(([k,v]) => ({ statType: k, ...v, roi: v.stake > 0 ? +(v.profit/v.stake*100).toFixed(1) : 0, winPct: v.count > 0 ? +(v.wins/v.count*100).toFixed(1) : 0 })),
        bankrollCurve: curve,
        tips,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // (duplicate grade-now removed — the full implementation is registered earlier)

  // ─ PATCH /api/book/legs/:id/override — owner: manually correct a graded leg ────
  // Body: { result: 'win'|'loss'|'push'|'void', actualValue?: number, note?: string }
  app.patch("/api/book/legs/:id/override", requireOwner, async (req: Request, res: Response) => {
    try {
      const legId = parseInt(req.params.id);
      const { result, actualValue, note } = req.body ?? {};
      const allowed = ["win", "loss", "push", "void"];
      if (!allowed.includes(result)) return res.status(400).json({ error: "result must be win|loss|push|void" });

      // Get the leg + its slip + account
      const leg = await db.queryOne(
        `SELECT l.*, s.account_id, s.stake, s.status as slip_status, s.payout_received
         FROM book_legs l
         JOIN book_slips s ON l.slip_id = s.id
         WHERE l.id = $1`, [legId]
      );
      if (!leg) return res.status(404).json({ error: "Leg not found" });

      const prevResult = leg.result;
      const slipId     = leg.slip_id;
      const accountId  = leg.account_id;

      // 1. Update the leg
      await db.query(
        `UPDATE book_legs SET result=$1, actual_value=COALESCE($2, actual_value),
         graded_at=NOW() WHERE id=$3`,
        [result, actualValue ?? null, legId]
      );

      // 2. Recalculate slip status from all legs
      const allLegs = await db.query(
        `SELECT result, odds_american FROM book_legs WHERE slip_id=$1`, [slipId]
      );
      const legResults = allLegs.rows.map((r: any) => r.result);

      // If any leg still pending, leave slip open
      if (legResults.includes("pending")) {
        return res.json({ ok: true, legId, newResult: result, slipStatus: "still_open", note: "Slip still has pending legs" });
      }

      // Determine new slip status
      let newSlipStatus: string;
      const activeResults = legResults.filter((r: string) => r !== "void");
      if (activeResults.length === 0)             newSlipStatus = "void";
      else if (activeResults.every((r: string) => r === "win")) newSlipStatus = "won";
      else if (activeResults.some((r: string) => r === "loss")) newSlipStatus = "lost";
      else                                         newSlipStatus = "push";

      // 3. Reverse previous settlement if slip was already settled
      const wasSettled = ["won", "lost", "push", "void"].includes(leg.slip_status);
      if (wasSettled && leg.payout_received > 0) {
        // Claw back the old payout
        await db.query(
          `UPDATE book_accounts SET balance = balance - $1 WHERE id=$2`,
          [leg.payout_received, accountId]
        );
        await db.query(
          `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note)
           VALUES ($1,$2,'stake',$3,$4)`,
          [accountId, -parseFloat(leg.payout_received), slipId,
           `Override reversal: slip #${slipId} (was ${leg.slip_status})`]
        );
      }

      // 4. Calculate new payout
      let newPayout = 0;
      if (newSlipStatus === "won") {
        const activeOddsRows = await db.query(
          `SELECT odds_american FROM book_legs WHERE slip_id=$1 AND result != 'void'`, [slipId]
        );
        const activeOdds = activeOddsRows.rows.map((r: any) => r.odds_american);
        const slipRow = await db.queryOne(`SELECT * FROM book_slips WHERE id=$1`, [slipId]);
        newPayout = activeOdds.length === 1
          ? parseFloat((parseFloat(slipRow.stake) * americanToDecimal(activeOdds[0])).toFixed(2))
          : calcParlayPayout(parseFloat(slipRow.stake), activeOdds);
      } else if (newSlipStatus === "push" || newSlipStatus === "void") {
        const slipRow = await db.queryOne(`SELECT stake FROM book_slips WHERE id=$1`, [slipId]);
        newPayout = parseFloat(slipRow.stake);
      }

      // 5. Settle slip with new values
      await db.query(
        `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
        [newSlipStatus, newPayout || null, slipId]
      );

      // 6. Credit new payout to account
      if (newPayout > 0) {
        await db.query(
          `UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`,
          [newPayout, accountId]
        );
        const txType = newSlipStatus === "won" ? "win" : newSlipStatus === "push" ? "push" : "void_refund";
        await db.query(
          `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note)
           VALUES ($1,$2,$3,$4,$5)`,
          [accountId, newPayout, txType, slipId,
           `Override by owner: leg #${legId} ${prevResult} → ${result}${note ? " ("+note+")" : ""}`]
        );
      }

      // 7. RR parent rollup — if this slip is an RR child, check if all siblings are done
      const slipMeta = await db.queryOne(`SELECT rr_parent_id FROM book_slips WHERE id=$1`, [slipId]);
      if (slipMeta?.rr_parent_id) {
        const parentId = slipMeta.rr_parent_id;
        const siblings = await db.query(
          `SELECT status, payout_received FROM book_slips WHERE rr_parent_id=$1`, [parentId]
        );
        const allDone = siblings.rows.every((r: any) => r.status !== "open");
        if (allDone) {
          const anyWon  = siblings.rows.some((r: any) => r.status === "won");
          const allVoid = siblings.rows.every((r: any) => r.status === "void");
          const parentStatus = allVoid ? "void" : anyWon ? "won" : "lost";
          const totalPayout  = siblings.rows.reduce((s: number, r: any) => s + parseFloat(r.payout_received ?? 0), 0);
          await db.query(
            `UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`,
            [parentStatus, totalPayout || null, parentId]
          );
        }
      }

      // 8. Force-sweep any other stalled slips for this account now that we've changed a leg
      const stalledSlips = await db.query(
        `SELECT s.id, s.account_id, s.stake FROM book_slips s
         WHERE s.account_id=$1 AND s.status='open' AND s.rr_parent_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM book_legs l WHERE l.slip_id=s.id AND l.result='pending')
           AND EXISTS (SELECT 1 FROM book_legs l WHERE l.slip_id=s.id)`,
        [accountId]
      );
      for (const stalled of stalledSlips.rows) {
        const sLegs = await db.query(`SELECT result, odds_american FROM book_legs WHERE slip_id=$1`, [stalled.id]);
        const sResults = sLegs.rows.map((r: any) => r.result);
        if (!sResults.length || sResults.includes("pending")) continue;
        const active = sResults.filter((r: string) => r !== "void");
        let ss: string;
        if (active.length === 0) ss = "void";
        else if (active.every((r: string) => r === "win")) ss = "won";
        else if (active.some((r: string) => r === "loss")) ss = "lost";
        else ss = "push";
        let sp = 0;
        if (ss === "won") {
          const wo = sLegs.rows.filter((r: any) => r.result !== "void").map((r: any) => r.odds_american);
          sp = wo.length === 1 ? parseFloat((parseFloat(stalled.stake) * americanToDecimal(wo[0])).toFixed(2)) : calcParlayPayout(parseFloat(stalled.stake), wo);
        } else if (ss === "push" || ss === "void") {
          sp = parseFloat(stalled.stake);
        }
        await db.query(`UPDATE book_slips SET status=$1, settled_at=NOW(), payout_received=$2 WHERE id=$3`, [ss, sp || null, stalled.id]);
        if (sp > 0) {
          await db.query(`UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`, [sp, stalled.account_id]);
          await db.query(
            `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note) VALUES ($1,$2,$3,$4,$5)`,
            [stalled.account_id, sp, ss === "won" ? "win" : "push", stalled.id, `Auto-settled stalled slip #${stalled.id}: ${ss}`]
          );
        }
      }

      await auditLog(
        (req as any).user?.email ?? "owner", "book_override",
        `leg:${legId} slip:${slipId}`,
        `${prevResult} → ${result}${note ? " note:"+note : ""}`
      );

      res.json({
        ok: true, legId,
        prevResult, newResult: result,
        slipId, newSlipStatus, newPayout,
        message: `Leg #${legId} updated: ${prevResult} → ${result}. Slip #${slipId} is now ${newSlipStatus}.`,
      });
    } catch (e: any) {
      console.error("[Book] Override error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─ PATCH /api/book/slips/:id/void — owner: void an entire slip ────
  app.patch("/api/book/slips/:id/void", requireOwner, async (req: Request, res: Response) => {
    try {
      const slipId  = parseInt(req.params.id);
      const { note } = req.body ?? {};
      const slip = await db.queryOne(`SELECT * FROM book_slips WHERE id=$1`, [slipId]);
      if (!slip) return res.status(404).json({ error: "Slip not found" });

      // Refund stake if not already voided
      if (slip.status !== "void") {
        // If previously settled with payout, claw it back first
        if (slip.payout_received > 0) {
          await db.query(
            `UPDATE book_accounts SET balance = balance - $1 WHERE id=$2`,
            [slip.payout_received, slip.account_id]
          );
        }
        // Refund original stake
        await db.query(
          `UPDATE book_accounts SET balance = balance + $1 WHERE id=$2`,
          [slip.stake, slip.account_id]
        );
        await db.query(
          `INSERT INTO book_transactions (account_id, amount, tx_type, slip_id, note)
           VALUES ($1,$2,'void_refund',$3,$4)`,
          [slip.account_id, parseFloat(slip.stake), slipId,
           `Slip #${slipId} voided by owner${note ? ": "+note : ""}`]
        );
      }

      await db.query(`UPDATE book_slips SET status='void', settled_at=NOW() WHERE id=$1`, [slipId]);
      await db.query(`UPDATE book_legs SET result='void', graded_at=NOW() WHERE slip_id=$1 AND result='pending'`, [slipId]);

      await auditLog(
        (req as any).user?.email ?? "owner", "book_void_slip",
        `slip:${slipId}`, note ?? ""
      );

      res.json({ ok: true, slipId, message: `Slip #${slipId} voided. Stake refunded.` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  function detectFantasyInjury(headline: string): string | null {
    const h = headline.toLowerCase();
    if (h.includes("60-day") || h.includes("season-ending") || h.includes("out for season")) return "Out (Season)";
    if (h.includes("10-day il") || h.includes("15-day il") || h.includes("injured list")) return "IL";
    if (h.includes("concussion")) return "Concussion Protocol";
    if (h.includes("ruled out") || h.includes("out indefinitely") || h.includes("placed on")) return "Out";
    if (h.includes("day-to-day")) return "Day-to-Day";
    if (h.includes("questionable")) return "Questionable";
    if (h.includes("doubtful")) return "Doubtful";
    if (h.includes("activated") || h.includes("returned from")) return "Activated";
    if (h.includes("suspend")) return "Suspended";
    return null;
  }


  return httpServer;
}
