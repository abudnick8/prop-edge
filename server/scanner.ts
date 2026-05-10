/**
 * Sports Prediction Market Scanner
 * Fetches markets from Kalshi (public), Polymarket (public), and
 * The Odds API (DraftKings, Underdog lines) then runs confidence scoring.
 */

import axios from "axios";
import { InsertBet } from "@shared/schema";
import { storage } from "./storage";
import { applyMLWeights } from "./ml-weights";
import { spawn } from "child_process";
import path from "path";

// ─── Edge Crew v3 Grade Engine ───────────────────────────────────────────────
// Calls server/edge_grade.py via spawn for team-bet grading.
// Props continue to use computeConfidence() — edge-crew doesn't cover props.

interface EdgeGradeResult {
  score:      number;       // 1–10
  confidence: number;       // 40–95 (maps to Clubhouse IQ 0–100 scale)
  grade:      string;       // A+, A, A-, B+, B, B-, C+, C, D, F
  sizing:     string;       // 2u, 1.5u, 1u, PASS
  factors:    string[];     // human-readable variable notes
  ev:         { ev_pct: number | null; ev_grade: string; kelly_units: string; true_prob: number | null; implied_prob: number | null; edge: number | null; moneyline: number | null };
  peter:      { flags: any[]; adjustment: number; has_kill: boolean };
  variables:  Record<string, any>;
  chains_fired?: string[];
  chains?: string[];  // alias from edge_grade.py
}

function callEdgeGrade(payload: Record<string, any>): Promise<EdgeGradeResult | null> {
  return new Promise((resolve) => {
    const pyPath = path.join(__dirname, "edge_grade.py");
    const child = spawn("python3", [pyPath, "grade", JSON.stringify(payload)], { timeout: 15000 });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("close", (code: number) => {
      if (code !== 0 || !out.trim()) {
        if (err) console.warn("[EdgeGrade] stderr:", err.slice(0, 300));
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(out.trim()) as EdgeGradeResult);
      } catch {
        resolve(null);
      }
    });
    child.on("error", () => resolve(null));
  });
}

/** Map EdgeGradeResult → ScoreResult shape that the rest of scanner expects */
function edgeGradeToScore(eg: EdgeGradeResult, fallback: any): { score: number; risk: "low" | "medium" | "high"; allocation: number; factors: string[]; summary: string } {
  const score = eg.confidence;
  const risk: "low" | "medium" | "high" = score >= 80 ? "low" : score >= 65 ? "medium" : "high";
  const allocation = eg.sizing === "2u" ? 4 : eg.sizing === "1.5u" ? 3 : eg.sizing === "1u" ? 2 : 1;
  const evStr = eg.ev?.ev_pct != null ? ` | EV ${eg.ev.ev_pct > 0 ? "+" : ""}${eg.ev.ev_pct}%` : "";
  const summary = `Grade ${eg.grade} (${eg.sizing}) — Edge Crew score ${eg.score.toFixed(1)}/10${evStr}`;
  return { score, risk, allocation, factors: eg.factors, summary };
}

// ─── ESPN Stat Cache ──────────────────────────────────────────────────────────
// In-memory cache keyed by `playerName::sport::statKey` → recent average
// TTL: 4 hours — enough for a full scan cycle without hammering ESPN
interface StatCacheEntry { avg: number | null; fetchedAt: number; }
const ESPN_STAT_CACHE = new Map<string, StatCacheEntry>();
const ESPN_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

// Stat key mappings: Underdog/SGO stat name → ESPN game-log key
// For combo props, maps raw stat key → array of ESPN keys to sum
const COMBO_STAT_MAP: Record<string, Record<string, string[]>> = {
  NBA: {
    pts_rebs_asts:            ["pts", "trb", "ast"],
    "pts+rebs+asts":          ["pts", "trb", "ast"],
    "points+rebounds+assists":["pts", "trb", "ast"],
    pts_rebs:                 ["pts", "trb"],
    "pts+rebs":               ["pts", "trb"],
    pts_asts:                 ["pts", "ast"],
    "pts+asts":               ["pts", "ast"],
    rebs_asts:                ["trb", "ast"],
    "rebs+asts":              ["trb", "ast"],
    // blocks + steals combo
    blks_stls:                ["blk", "stl"],
    "blks+stls":              ["blk", "stl"],
    "blocks+steals":          ["blk", "stl"],
    "blocks + steals":        ["blk", "stl"],
  },
  MLB: {
    hits_runs_rbis:           ["hits", "runs", "rbi"],
    "hits+runs+rbis":         ["hits", "runs", "rbi"],
    "hits + runs + rbis":     ["hits", "runs", "rbi"],
    "hits runs rbis":         ["hits", "runs", "rbi"],
    // total_bases: use hits as ESPN proxy (TB not exposed in game log)
    total_bases:              ["hits"],
  },
  NHL: {
    "goals+assists":          ["goals", "ast"],
    "goals + assists":        ["goals", "ast"],
    // NHL "points" prop = goals + assists (ESPN game log: goals col + ast col)
    points:                   ["goals", "ast"],
    power_play_points:        ["goals", "ast"],
  },
};

const STAT_KEY_MAP: Record<string, Record<string, string>> = {
  NBA: {
    points: "pts", assists: "ast", rebounds: "trb",
    blocks: "blk", steals: "stl", threes: "fg3_made",
    // NOTE: combo props (pts_rebs_asts etc.) are handled via COMBO_STAT_MAP above
  },
  NHL: {
    goals: "goals", assists_hockey: "ast", shots: "shots", assists: "ast",
    saves: "saves", blocked_shots: "blocked_shots", faceoffs_won: "faceoffs_won",
    plus_minus: "plusMinus",
    // "points" in NHL = goals+assists — handled via COMBO_STAT_MAP
    // "power_play_points" not in ESPN game log — skip
  },
  MLB: {
    hits: "hits", home_runs: "home_runs",
    rbi: "rbi",   rbis: "rbi",  // Underdog uses "rbis", ESPN key is "rbi"
    strikeouts: "strikeouts",
    runs: "runs", stolen_bases: "stolen_bases",
    walks_allowed: "bb",
    total_bases: "hits",          // ESPN doesn't expose TB — hits is the closest proxy
    pitch_outs: "strikeouts",     // Underdog pitching outs — proxy via SO
    // hits_runs_rbis handled via COMBO_STAT_MAP
  },
  NFL: {
    passing_yards: "yds", rushing_yards: "yds", receiving_yards: "yds",
    receptions: "rec", touchdowns: "td",
  },
};

// In-memory ESPN player ID cache (never expires — IDs don't change)
const ESPN_ID_CACHE = new Map<string, string | null>();

// Resolve ESPN athlete ID by name (simplified search)
async function resolveESPNPlayerIdForScanner(playerName: string, sport: string): Promise<string | null> {
  const idKey = `${playerName}::${sport}`;
  if (ESPN_ID_CACHE.has(idKey)) return ESPN_ID_CACHE.get(idKey)!;
  try {
    const sportCfg: Record<string, { sn: string; lg: string }> = {
      NBA: { sn: "basketball", lg: "nba" },
      NHL: { sn: "hockey",     lg: "nhl" },
      MLB: { sn: "baseball",   lg: "mlb" },
      NFL: { sn: "football",   lg: "nfl" },
    };
    const cfg = sportCfg[sport.toUpperCase()];
    if (!cfg) { ESPN_ID_CACHE.set(idKey, null); return null; }
    const query = encodeURIComponent(playerName);
    // Try the athlete search endpoint — ESPN's suggest API is more reliable
    const { data } = await axios.get(
      `https://site.api.espn.com/apis/common/v3/search?query=${query}&sport=${cfg.sn}&league=${cfg.lg}&limit=3&type=player`,
      { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const items = data?.results?.[0]?.contents ?? data?.athletes ?? data?.items ?? [];
    if (items.length > 0) {
      const first = items[0];
      const id = String(first.id ?? first.uid ?? first.athlete?.id ?? first.dataSourceIdentifier ?? "").replace(/^.*athlete\//, "").replace(/\?.*/, "");
      if (id && id.length > 0) { ESPN_ID_CACHE.set(idKey, id); return id; }
    }
    ESPN_ID_CACHE.set(idKey, null);
    return null;
  } catch { ESPN_ID_CACHE.set(idKey, null); return null; }
}

// Fetch L5 average for a player's specific stat from ESPN game log
async function fetchRecentStatAvg(
  playerName: string,
  sport: string,
  statRaw: string  // Underdog/SGO raw stat key (e.g. "points", "goals", "passing_yards")
): Promise<number | null> {
  const statKey = STAT_KEY_MAP[sport.toUpperCase()]?.[statRaw];
  if (!statKey) return null;

  const cacheKey = `${playerName}::${sport}::${statKey}`;
  const cached = ESPN_STAT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ESPN_CACHE_TTL_MS) return cached.avg;

  try {
    const espnId = await resolveESPNPlayerIdForScanner(playerName, sport);
    if (!espnId) { ESPN_STAT_CACHE.set(cacheKey, { avg: null, fetchedAt: Date.now() }); return null; }

    const sportCfg: Record<string, { sn: string; lg: string; seasons: number[]; statMap: Record<string, string> }> = {
      NBA: { sn: "basketball", lg: "nba",  seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
             statMap: { MIN: "mp", PTS: "pts", REB: "trb", AST: "ast", BLK: "blk", STL: "stl", TO: "tov", FG: "fg_made", "3PT": "fg3_made" } },
      NHL: { sn: "hockey",    lg: "nhl",  seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
             statMap: { G: "goals", A: "ast", PTS: "pts", S: "shots" } },
      MLB: { sn: "baseball",  lg: "mlb",  seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
             statMap: { H: "hits", HR: "home_runs", RBI: "rbi", SO: "strikeouts", R: "runs" } },
      NFL: { sn: "football",  lg: "nfl",  seasons: [new Date().getFullYear() - 1, new Date().getFullYear() - 2],
             statMap: { YDS: "yds", TD: "td", REC: "rec", CAR: "car" } },
    };
    const cfg = sportCfg[sport.toUpperCase()];
    if (!cfg) { ESPN_STAT_CACHE.set(cacheKey, { avg: null, fetchedAt: Date.now() }); return null; }

    const seenIds = new Set<string>();
    let allEntries: Array<{ stats: any[]; labels: string[] }> = [];

    const results = await Promise.allSettled(
      cfg.seasons.map(yr =>
        axios.get(
          `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
          { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
        )
      )
    );

    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      const v3 = res.value.data;
      const labels: string[] = v3.labels ?? [];
      const eventsMap: Record<string, any> = v3.events ?? {};
      for (const stype of (v3.seasonTypes ?? [])) {
        for (const cat of (stype.categories ?? [])) {
          for (const ev of (cat.events ?? [])) {
            const eid = String(ev.eventId ?? "");
            if (seenIds.has(eid)) continue;
            seenIds.add(eid);
            allEntries.push({ stats: ev.stats ?? [], labels });
          }
        }
      }
    }

    // Sort by event order and take last 5
    const last5 = allEntries.slice(-5);
    const values: number[] = [];
    for (const { stats, labels } of last5) {
      // Find the ESPN label that maps to our statKey
      const espnLabel = Object.entries(cfg.statMap).find(([, v]) => v === statKey)?.[0];
      if (!espnLabel) continue;
      // Handle split stats like "9-21" for FG
      let idx = labels.indexOf(espnLabel);
      if (idx < 0) continue;
      const raw = String(stats[idx] ?? "");
      const val = raw.includes("-") ? parseFloat(raw.split("-")[0]) : parseFloat(raw);
      if (!isNaN(val)) values.push(val);
    }

    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    ESPN_STAT_CACHE.set(cacheKey, { avg, fetchedAt: Date.now() });
    return avg;
  } catch {
    ESPN_STAT_CACHE.set(cacheKey, { avg: null, fetchedAt: Date.now() });
    return null;
  }
}

// Fetch L5 average for a COMBO stat (sum of multiple ESPN keys, e.g. pts+trb+ast)
async function fetchComboStatAvg(
  playerName: string,
  sport: string,
  comboKeys: string[]  // ESPN stat keys to sum, e.g. ["pts", "trb", "ast"]
): Promise<number | null> {
  const avgs = await Promise.all(
    comboKeys.map(k => fetchRecentStatAvgByKey(playerName, sport, k))
  );
  if (avgs.every(a => a === null)) return null;
  return avgs.reduce((sum, a) => sum + (a ?? 0), 0);
}

// Low-level: fetch L5 avg by ESPN key directly (used by both single and combo fetchers)
async function fetchRecentStatAvgByKey(
  playerName: string,
  sport: string,
  espnStatKey: string  // the ESPN game-log key (e.g. "pts", "trb", "ast")
): Promise<number | null> {
  // Reverse-lookup: find a raw Underdog stat key that maps to this ESPN key
  // so we can use the existing cache infrastructure
  const sportMap = STAT_KEY_MAP[sport.toUpperCase()] ?? {};
  const rawStatKey = Object.entries(sportMap).find(([, v]) => v === espnStatKey)?.[0] ?? espnStatKey;
  return fetchRecentStatAvg(playerName, sport, rawStatKey);
}

// Compute form edge: recentAvg vs line → positive = beating line, negative = falling short
// Returns null if no data available
function computeFormEdge(recentAvg: number | null, line: number): number | null {
  if (recentAvg === null || line <= 0) return null;
  return (recentAvg - line) / line;  // fractional edge, e.g. 0.15 = 15% above line
}

// ── Fetch per-game values for a single ESPN stat key (last 5 games) ─────────
// Returns the raw numeric values in game order (most recent last).
async function fetchPerGameStatValues(
  playerName: string,
  sport: string,
  espnStatKey: string  // ESPN game-log column key, e.g. "pts", "trb", "ast"
): Promise<number[]> {
  const sportCfg: Record<string, { sn: string; lg: string; seasons: number[]; statMap: Record<string, string> }> = {
    NBA: { sn: "basketball", lg: "nba",  seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
           statMap: { MIN: "mp", PTS: "pts", REB: "trb", AST: "ast", BLK: "blk", STL: "stl", TO: "tov", FG: "fg_made", "3PT": "fg3_made" } },
    NHL: { sn: "hockey",    lg: "nhl",  seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
           statMap: { G: "goals", A: "ast", PTS: "pts", S: "shots" } },
    MLB: { sn: "baseball",  lg: "mlb",  seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
           statMap: { H: "hits", HR: "home_runs", RBI: "rbi", SO: "strikeouts", R: "runs" } },
    NFL: { sn: "football",  lg: "nfl",  seasons: [new Date().getFullYear() - 1, new Date().getFullYear() - 2],
           statMap: { YDS: "yds", TD: "td", REC: "rec", CAR: "car" } },
  };
  try {
    const cfg = sportCfg[sport.toUpperCase()];
    if (!cfg) return [];
    const espnId = await resolveESPNPlayerIdForScanner(playerName, sport);
    if (!espnId) return [];

    const seenIds = new Set<string>();
    const allEntries: Array<{ stats: any[]; labels: string[] }> = [];
    const results = await Promise.allSettled(
      cfg.seasons.map(yr =>
        axios.get(
          `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
          { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
        )
      )
    );
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      const v3 = res.value.data;
      const labels: string[] = v3.labels ?? [];
      for (const stype of (v3.seasonTypes ?? [])) {
        for (const cat of (stype.categories ?? [])) {
          for (const ev of (cat.events ?? [])) {
            const eid = String(ev.eventId ?? "");
            if (seenIds.has(eid)) continue;
            seenIds.add(eid);
            allEntries.push({ stats: ev.stats ?? [], labels });
          }
        }
      }
    }
    const last5 = allEntries.slice(-5);
    const espnLabel = Object.entries(cfg.statMap).find(([, v]) => v === espnStatKey)?.[0];
    if (!espnLabel) return [];
    const values: number[] = [];
    for (const { stats, labels } of last5) {
      const idx = labels.indexOf(espnLabel);
      if (idx < 0) continue;
      const raw = String(stats[idx] ?? "");
      const val = raw.includes("-") ? parseFloat(raw.split("-")[0]) : parseFloat(raw);
      if (!isNaN(val)) values.push(val);
    }
    return values;
  } catch { return []; }
}

// ── Cross-validate recentAvg against per-game data ─────────────────────────
// For combo stats: re-fetch each component per-game, sum them, and compute the true avg.
// For single stats: re-fetch per-game values directly.
// If the cached recentAvg diverges from the per-game truth by >20%,
// the cross-validated (correct) value is returned and a warning is logged.
async function crossValidateRecentAvg(
  playerName: string,
  sport: string,
  comboKeys: string[] | null,   // ESPN keys to sum (combo), or null for single stat
  singleStatRaw: string | null, // Underdog raw key for single stats
  line: number,
  cachedAvg: number | null
): Promise<{ validatedAvg: number | null; perGameValues: number[]; hitRate: number | null; diverged: boolean }> {
  try {
    let perGameValues: number[] = [];

    if (comboKeys && comboKeys.length > 0) {
      // Fetch per-game values for each component then sum per game
      const perGameComponents = await Promise.all(
        comboKeys.map(k => fetchPerGameStatValues(playerName, sport, k))
      );
      // Align by game index (use shortest non-empty array length)
      const maxLen = Math.max(...perGameComponents.map(c => c.length));
      if (maxLen > 0) {
        for (let i = 0; i < maxLen; i++) {
          const gameSum = perGameComponents.reduce((sum, comp) => sum + (comp[i] ?? 0), 0);
          perGameValues.push(gameSum);
        }
      }
    } else if (singleStatRaw) {
      const espnKey = STAT_KEY_MAP[sport.toUpperCase()]?.[singleStatRaw];
      if (espnKey) {
        perGameValues = await fetchPerGameStatValues(playerName, sport, espnKey);
      }
    }

    if (perGameValues.length === 0) {
      return { validatedAvg: cachedAvg, perGameValues: [], hitRate: null, diverged: false };
    }

    // Compute true avg from per-game data
    const trueAvg = perGameValues.reduce((a, b) => a + b, 0) / perGameValues.length;

    // Hit rate: how many games actually beat the line for each direction
    const overHits = perGameValues.filter(v => v >= line).length;
    const hitRate = overHits / perGameValues.length; // fraction going OVER (0–1)

    // Check divergence
    let diverged = false;
    if (cachedAvg !== null && Math.abs(trueAvg - cachedAvg) / Math.max(line, 1) > 0.20) {
      console.warn(
        `[CrossValidate] ${playerName} ${sport}: cached L5 avg ${cachedAvg?.toFixed(1)} diverges from ` +
        `per-game truth ${trueAvg.toFixed(1)} (line ${line}). Using corrected value.`
      );
      diverged = true;
    }

    return {
      validatedAvg: diverged ? parseFloat(trueAvg.toFixed(2)) : cachedAvg,
      perGameValues,
      hitRate,
      diverged,
    };
  } catch {
    return { validatedAvg: cachedAvg, perGameValues: [], hitRate: null, diverged: false };
  }
}

// Determine analytically best pick side by combining market signal + form signal
// formEdge: positive = player exceeds line recently, negative = player falls short
// hitRate: fraction of L5 games where stat >= line (OVER hits) — used as safety cross-check
function analyticalPickSide(
  marketPickSide: string,
  formEdge: number | null,
  isLottoStat: boolean,
  hitRate: number | null = null  // 0–1: fraction of L5 games that went OVER the line
): { pickSide: string; formFlipped: boolean; safetyOverride: boolean; safetyNote: string | null } {
  if (formEdge === null) {
    // No form data — for lotto stats always OVER; otherwise follow market
    return { pickSide: isLottoStat ? "OVER" : marketPickSide, formFlipped: false, safetyOverride: false, safetyNote: null };
  }

  if (isLottoStat) {
    return { pickSide: "OVER", formFlipped: false, safetyOverride: false, safetyNote: null };
  }

  // ── Determine initial pick from form edge ──────────────────────────────────
  let candidateSide: string;
  if (formEdge >= 0.15) {
    candidateSide = "OVER";
  } else if (formEdge <= -0.15) {
    candidateSide = "UNDER";
  } else {
    candidateSide = marketPickSide;  // within 15% band — defer to market
  }
  const formFlipped = candidateSide !== marketPickSide;

  // ── Safety cross-check: hit-rate must agree with candidate side ───────────────
  // hitRate = fraction of L5 games where stat >= line (OVER hits).
  // If the candidate side says UNDER but the player hit OVER in ≥3/5 games,
  // OR the candidate says OVER but the player only hit OVER in ≤2/5 games,
  // the hit-rate directly contradicts the avg-based signal.
  // In that case we revert to market and flag the conflict.
  if (hitRate !== null) {
    const underHitRate = 1 - hitRate;  // fraction of games where stat < line (UNDER hits)

    if (candidateSide === "UNDER" && hitRate >= 0.60) {
      // Avg is below line BUT player beats the line 3+/5 games — volatile player, avg is misleading
      // Revert to market direction, mark safety override
      const note = `Safety override: avg-based signal said UNDER but player hit OVER in ${Math.round(hitRate * 100)}% of L5 games — reverting to market (${marketPickSide})`;
      console.warn(`[SafetyCheck] ${note}`);
      return { pickSide: marketPickSide, formFlipped: false, safetyOverride: true, safetyNote: note };
    }

    if (candidateSide === "OVER" && underHitRate >= 0.60) {
      // Avg is above line BUT player hits UNDER in 3+/5 games — volatile player, avg is misleading
      const note = `Safety override: avg-based signal said OVER but player hit UNDER in ${Math.round(underHitRate * 100)}% of L5 games — reverting to market (${marketPickSide})`;
      console.warn(`[SafetyCheck] ${note}`);
      return { pickSide: marketPickSide, formFlipped: false, safetyOverride: true, safetyNote: note };
    }
  }

  return { pickSide: candidateSide, formFlipped, safetyOverride: false, safetyNote: null };
}

// ─── Slug utility ──────────────────────────────────────────────────────────────────────
// Generates a stable, URL-friendly slug from a bet title + a 6-char suffix
// derived from the bet ID so duplicates are always unique.
// e.g. "Matas Buzelis Over 1.5 Assists" + "kalshi-prop-XYZ" → "matas-buzelis-over-1-5-assists-ab3f7c"
export function generateBetSlug(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/[^a-z0-9\s-]/g, "")                         // keep alphanumeric + spaces
    .replace(/\s+/g, "-")                                  // spaces → dashes
    .replace(/-+/g, "-")                                   // collapse multiple dashes
    .replace(/^-+|-+$/g, "")                               // trim edge dashes
    .slice(0, 60);                                         // max 60 chars
  // 6-char suffix: hash the id deterministically
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  const suffix = Math.abs(hash).toString(36).padStart(6, "0").slice(0, 6);
  return `${base}-${suffix}`;
}

// ─── Kalshi public API ────────────────────────────────────────────────────────
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

async function fetchKalshiSports(): Promise<InsertBet[]> {
  try {
    const { data } = await axios.get(`${KALSHI_BASE}/markets`, {
      params: { status: "open", limit: 200 },
      timeout: 10000,
    });
    const markets = (data?.markets ?? []) as any[];
    return markets
      .filter((m: any) => {
        const cat = (m.category ?? "").toLowerCase();
        const title = (m.title ?? "").toLowerCase();
        return (
          cat === "sports" ||
          ["nfl", "nba", "mlb", "nhl", "football", "basketball", "baseball", "hockey"].some(
            (s) => title.includes(s) || cat.includes(s)
          )
        );
      })
      .map((m: any) => buildKalshiBet(m));
  } catch (e: any) {
    console.warn("Kalshi fetch error:", e.message);
    return [];
  }
}

function buildKalshiBet(m: any, overrides?: { sport?: string; betType?: string; playerName?: string; gameTime?: Date | null }): InsertBet {
  // yes_ask_dollars is a dollar-denominated price (e.g. "0.55" = 55 cents = 55%)
  // Fall back to yes_bid_dollars, last_price_dollars, or 0.5
  const priceStr = m.yes_ask_dollars ?? m.yes_bid_dollars ?? m.last_price_dollars ?? null;
  const yesPrice = priceStr !== null ? parseFloat(priceStr) : ((m.yes_bid ?? m.last_price ?? 50) / 100);
  const noPrice = 1 - yesPrice;
  const sport = overrides?.sport ?? detectSport(m.title + " " + (m.event_ticker ?? ""));
  const betType = overrides?.betType ?? detectBetType(m.title);

  // Determine pick direction: yes = event happens (OVER threshold) / no = UNDER
  // For player props: yesPrice > 0.5 means "over" is favored
  const pickSide = yesPrice >= 0.5 ? "OVER" : "UNDER";
  const pickedOdds = yesPrice >= 0.5
    ? (yesPrice >= 1 ? -10000 : Math.round(-(yesPrice / (1 - yesPrice)) * 100))
    : (noPrice >= 1 ? -10000 : Math.round(((1 - noPrice) / noPrice) * 100));
  const pickedProb = yesPrice >= 0.5 ? yesPrice : noPrice;

  // Convert prices to American odds
  const overOdds = yesPrice >= 0.5
    ? Math.round(-(yesPrice / (1 - yesPrice)) * 100)
    : Math.round(((1 - yesPrice) / yesPrice) * 100);
  const underOdds = noPrice >= 0.5
    ? Math.round(-(noPrice / (1 - noPrice)) * 100)
    : Math.round(((1 - noPrice) / noPrice) * 100);

  const score = computeConfidence({
    impliedProb: pickedProb,
    source: "kalshi",
    betType,
    sport,
    title: m.title,
  });

  // Build a title with [TAKE OVER/UNDER] prefix so BetCard can always parse direction
  const oddsStr = pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`;
  const rawTitle: string = m.title ?? m.ticker ?? "";
  const titleWithPrefix = rawTitle.startsWith("[TAKE") ? rawTitle
    : `[TAKE ${pickSide} @ ${oddsStr}] ${rawTitle}`;

  return {
    id: `kalshi-${m.ticker}`,
    source: "kalshi",
    sport,
    betType,
    title: titleWithPrefix,
    description: m.subtitle ?? m.rules_primary ?? "",
    yesPrice,
    noPrice,
    impliedProbability: pickedProb,
    confidenceScore: score.score,
    riskLevel: score.risk,
    recommendedAllocation: score.allocation,
    keyFactors: score.factors,
    researchSummary: score.summary,
    isHighConfidence: score.score >= 85,
    status: "open",
    homeTeam: null,
    awayTeam: null,
    playerName: overrides?.playerName ?? null,
    gameTime: overrides?.gameTime !== undefined ? overrides.gameTime : (m.close_time ? new Date(m.close_time) : null),
    notificationSent: false,
    playerStats: null,
    teamStats: { pickSide, pickedOdds, overProb: Math.round(yesPrice * 100), underProb: Math.round(noPrice * 100), playerName: overrides?.playerName ?? null, statType: null, statValue: null, gameTitle: rawTitle },
    line: null,
    overOdds,
    underOdds,
  };
}

// ─── Kalshi Player Props (NBA/NHL/MLB individual stat thresholds) ────────────
// Fetches individual player prop markets from Kalshi structured series
// This serves as a backup when The Odds API quota is exhausted
async function fetchKalshiPlayerProps(): Promise<InsertBet[]> {
  const results: InsertBet[] = [];

  // All known Kalshi player prop series across major sports.
  // Series with 0 active events are skipped automatically — no error, just empty.
  // NHL/MLB/NFL series will auto-populate when Kalshi launches them for that season.
  const ALL_SERIES: Record<string, { stat: string; sport: string }> = {
    // NBA (active all season)
    KXNBAPTS: { stat: "Points",      sport: "NBA" },
    KXNBAAST: { stat: "Assists",     sport: "NBA" },
    KXNBAREB: { stat: "Rebounds",    sport: "NBA" },
    KXNBASTL: { stat: "Steals",      sport: "NBA" },
    KXNBABLK: { stat: "Blocks",      sport: "NBA" },
    KXNBA3PT: { stat: "3-Pointers",  sport: "NBA" },
    KXNBAPAR: { stat: "Pts+Ast+Reb", sport: "NBA" },
    // MLB (active April–October)
    KXMLBHR:    { stat: "Home Runs",    sport: "MLB" },
    KXMLBHITS:  { stat: "Hits",         sport: "MLB" },
    KXMLBSO:    { stat: "Strikeouts",   sport: "MLB" },
    KXMLBRBI:   { stat: "RBIs",         sport: "MLB" },
    KXMLBBB:    { stat: "Walks",        sport: "MLB" },
    KXMLBSB:    { stat: "Stolen Bases", sport: "MLB" },
    // NHL (active October–June)
    KXNHLGLS: { stat: "Goals",         sport: "NHL" },
    KXNHLAST: { stat: "Assists",       sport: "NHL" },
    KXNHLPTS: { stat: "Points",        sport: "NHL" },
    KXNHLSOG: { stat: "Shots on Goal", sport: "NHL" },
    // NFL (active September–February)
    KXNFLPAYDS:  { stat: "Passing Yards",   sport: "NFL" },
    KXNFLRUYDS:  { stat: "Rushing Yards",   sport: "NFL" },
    KXNFLRECYDS: { stat: "Receiving Yards", sport: "NFL" },
    KXNFLTD:     { stat: "Touchdowns",      sport: "NFL" },
    KXNFLREC:    { stat: "Receptions",      sport: "NFL" },
    KXNFLCMP:    { stat: "Completions",     sport: "NFL" },
  };

  // Pick the best threshold line per player per stat (closest to 50% yes price = most interesting)
  // We want the line where yes_ask is nearest 0.5 — that's the true prop line
  const playerBestLine = new Map<string, { line: number; yesPrice: number; market: any; stat: string; sport: string; event: any }>();

  for (const [seriesTicker, { stat, sport }] of Object.entries(ALL_SERIES)) {
    try {
      // Get all open events for this series
      const eventsRes = await axios.get(`${KALSHI_BASE}/events`, {
        params: { status: "open", series_ticker: seriesTicker, limit: 20 },
        timeout: 8000,
      });
      const events: any[] = eventsRes.data?.events ?? [];

      for (const event of events) {
        // Parse game teams from event ticker e.g. KXNBAPTS-26MAR17SASSAC → SAS vs SAC
        const eventTitle: string = event.title ?? "";
        const [awayPart, homePart] = eventTitle.split(" at ");
        const awayTeam = awayPart?.trim() ?? null;
        const homeTeam = homePart?.replace(/:.*/,"").trim() ?? null;
        const gameTime = event.expected_expiration_time ? new Date(event.expected_expiration_time) : null;

        // Get all markets within this event
        const eventRes = await axios.get(`${KALSHI_BASE}/events/${event.event_ticker}`, {
          timeout: 8000,
        });
        const markets: any[] = eventRes.data?.markets ?? [];

        // Group by player (extracted from yes_sub_title e.g. "Victor Wembanyama: 20+")
        const byPlayer = new Map<string, any[]>();
        for (const m of markets) {
          const sub: string = m.yes_sub_title ?? m.subtitle ?? "";
          if (!sub.includes(":")) continue;
          const playerName = sub.split(":")[0].trim();
          if (!byPlayer.has(playerName)) byPlayer.set(playerName, []);
          byPlayer.get(playerName)!.push({ ...m, _awayTeam: awayTeam, _homeTeam: homeTeam, _gameTime: gameTime });
        }

        // For each player, pick the line closest to 50% (most contested = true market line)
        for (const [playerName, pMarkets] of byPlayer) {
          const key = `${playerName}::${stat}`;
          let best: any = null;
          let bestDist = 999;
          for (const m of pMarkets) {
            const priceStr = m.yes_ask_dollars ?? m.last_price_dollars;
            if (!priceStr) continue;
            const price = parseFloat(priceStr);
            const dist = Math.abs(price - 0.5);
            if (dist < bestDist) {
              bestDist = dist;
              best = m;
            }
          }
          if (!best) continue;

          // Only update if this is better than what we already have
          if (!playerBestLine.has(key) || bestDist < Math.abs((playerBestLine.get(key)!.yesPrice) - 0.5)) {
            const priceStr = best.yes_ask_dollars ?? best.last_price_dollars;
            playerBestLine.set(key, {
              line: best.floor_strike ?? 0,
              yesPrice: parseFloat(priceStr),
              market: best,
              stat,
              sport,
              event,
            });
          }
        }

        // Throttle between event fetches
        await new Promise(r => setTimeout(r, 150));
      }

      // Throttle between series
      await new Promise(r => setTimeout(r, 200));
    } catch (e: any) {
      console.warn(`Kalshi props fetch error (${seriesTicker}):`, e.message);
    }
  }

  // Convert best lines to InsertBet objects
  for (const [key, { line, yesPrice, market, stat, sport, event }] of playerBestLine) {
    const playerName = key.split("::")[0];
    const noPrice = 1 - yesPrice;
    const sub: string = market.yes_sub_title ?? market.subtitle ?? "";
    const threshold = sub.includes(":") ? sub.split(":")[1].trim() : `${line}+`;
    const title = `${playerName} Over ${line} ${stat}`;
    const eventTitle: string = event.title ?? "";
    const [awayPart, homePart] = eventTitle.split(" at ");
    const awayTeam = awayPart?.trim() ?? null;
    const homeTeam = homePart?.replace(/:.*/,"").trim() ?? null;
    const gameTime = market._gameTime ?? null;

    // Convert 0-1 price to American odds for display
    const impliedProb = yesPrice;
    const overOdds = impliedProb >= 0.5
      ? Math.round(-(impliedProb / (1 - impliedProb)) * 100)
      : Math.round(((1 - impliedProb) / impliedProb) * 100);
    const underOdds = noPrice >= 0.5
      ? Math.round(-(noPrice / (1 - noPrice)) * 100)
      : Math.round(((1 - noPrice) / noPrice) * 100);

    // Pick direction: yesPrice >= 0.5 = "YES" (OVER) is favored, otherwise UNDER
    const propPickSide = yesPrice >= 0.5 ? "OVER" : "UNDER";
    const propPickedOdds = propPickSide === "OVER" ? overOdds : underOdds;
    const propPickedProb = propPickSide === "OVER" ? yesPrice : noPrice;
    const propOddsStr = propPickedOdds > 0 ? `+${propPickedOdds}` : `${propPickedOdds}`;
    const titledTitle = `[TAKE ${propPickSide} ${line} @ ${propOddsStr}] ${playerName} — ${stat}`;

    const score = computeConfidence({
      impliedProb: propPickedProb,
      source: "kalshi",
      betType: "player_prop",
      sport,
      title: titledTitle,
    });

    results.push({
      id: `kalshi-prop-${market.ticker}`,
      source: "kalshi",
      sport,
      betType: "player_prop",
      title: titledTitle,
      description: `${playerName} to score ${threshold} ${stat} — Kalshi prediction market`,
      line,
      overOdds,
      underOdds,
      yesPrice,
      noPrice,
      impliedProbability: propPickedProb,
      confidenceScore: score.score,
      riskLevel: score.risk,
      recommendedAllocation: score.allocation,
      keyFactors: [`${propPickSide} ${line} ${stat} (Kalshi)`, ...score.factors],
      researchSummary: score.summary,
      isHighConfidence: score.score >= 85,
      status: "open",
      homeTeam,
      awayTeam,
      playerName,
      gameTime,
      notificationSent: false,
      playerStats: null,
      teamStats: {
        pickSide: propPickSide,
        pickedOdds: propPickedOdds,
        overProb: Math.round(yesPrice * 100),
        underProb: Math.round(noPrice * 100),
        playerName,
        statType: stat,
        statValue: line,
        gameTitle: homeTeam && awayTeam ? `${awayTeam} @ ${homeTeam}` : (homeTeam ?? awayTeam ?? ""),
      },
    });
  }

  console.log(`Kalshi player props: ${results.length} props across NBA/MLB/NHL/NFL`);
  return results;
}

// ─── Kalshi WBC markets (targeted series fetch) ───────────────────────────────
// Fetches WBC game winners, spreads, totals, and MVP awards from Kalshi
async function fetchKalshiWBC(): Promise<InsertBet[]> {
  const WBC_SERIES = [
    { ticker: "KXWBCGAME",   betType: "moneyline",   sport: "MLB" },
    { ticker: "KXWBCSPREAD", betType: "spread",       sport: "MLB" },
    { ticker: "KXWBCTOTAL",  betType: "total",        sport: "MLB" },
    { ticker: "KXWBCMVP",   betType: "season_prop",  sport: "MLB" },
  ];
  const bets: InsertBet[] = [];

  for (const { ticker, betType, sport } of WBC_SERIES) {
    try {
      const { data } = await axios.get(`${KALSHI_BASE}/markets`, {
        params: { status: "open", series_ticker: ticker, limit: 50 },
        timeout: 10000,
      });
      const markets = (data?.markets ?? []) as any[];

      // For totals: only keep the single "best" line (closest to 50/50 = most informative)
      let filtered = markets;
      if (ticker === "KXWBCTOTAL") {
        // Group by event_ticker, pick the market closest to 50% yes_ask
        const byEvent: Record<string, any[]> = {};
        for (const m of markets) {
          const ev = m.event_ticker ?? "unknown";
          if (!byEvent[ev]) byEvent[ev] = [];
          byEvent[ev].push(m);
        }
        filtered = [];
        for (const group of Object.values(byEvent)) {
          // Pick the line closest to 50 cents (most uncertain = most interesting to bet)
          const best = group.reduce((a, b) => {
            const aP = Math.abs(parseFloat(a.yes_ask_dollars ?? "0.5") - 0.5);
            const bP = Math.abs(parseFloat(b.yes_ask_dollars ?? "0.5") - 0.5);
            return aP < bP ? a : b;
          });
          filtered.push(best);
        }
      }

      // For spreads: only keep -1.5 run lines (most standard)
      if (ticker === "KXWBCSPREAD") {
        // Group by event, keep one per team per event (the -1.5 line if available, else closest)
        const byEvent: Record<string, any[]> = {};
        for (const m of markets) {
          const ev = m.event_ticker ?? "unknown";
          if (!byEvent[ev]) byEvent[ev] = [];
          byEvent[ev].push(m);
        }
        filtered = [];
        for (const group of Object.values(byEvent)) {
          // Prefer -1.5 lines (ticker suffix -USA2, -DOM2, -VEN2, -ITA2)
          const halfRun = group.filter(m => m.ticker.endsWith("2"));
          filtered.push(...(halfRun.length > 0 ? halfRun : group.slice(0, 2)));
        }
      }

      // For MVP: extract player name from title "Will {Player} win World Baseball Classic MVP"
      for (const m of filtered) {
        const playerName = betType === "season_prop"
          ? (m.title.match(/Will ([\w\s.]+?) win/)?.[1]?.trim() ?? null)
          : null;

        // Enrich title for WBC context
        const enrichedTitle = betType === "season_prop"
          ? m.title  // already descriptive
          : `WBC: ${m.title}`;

        bets.push(buildKalshiBet({ ...m, title: enrichedTitle }, {
          sport,
          betType,
          playerName,
          gameTime: m.close_time ? new Date(m.close_time) : null,
        }));
      }
    } catch (e: any) {
      console.warn(`Kalshi WBC ${ticker} fetch error:`, e.message);
    }
  }

  console.log(`Kalshi WBC: ${bets.length} markets fetched`);
  return bets;
}

// ─── Kalshi Season Award markets (MLB MVP, NFL MVP, NBA MVP) ──────────────────
// These are season-long "who wins the award" markets = season_prop betType
async function fetchKalshiSeasonAwards(): Promise<InsertBet[]> {
  const AWARD_SERIES: Array<{ ticker: string; sport: string; label: string }> = [
    { ticker: "KXMLBALMVP",  sport: "MLB", label: "AL MVP" },
    { ticker: "KXMLBNLMVP",  sport: "MLB", label: "NL MVP" },
    { ticker: "KXNBAMVP",    sport: "NBA", label: "NBA MVP" },
    { ticker: "KXNFLMVP",    sport: "NFL", label: "NFL MVP" },
    { ticker: "KXWBCMVP",    sport: "MLB", label: "WBC MVP" },  // also covered in WBC but deduplicated by ID
  ];
  const bets: InsertBet[] = [];

  for (const { ticker, sport, label } of AWARD_SERIES) {
    try {
      const { data } = await axios.get(`${KALSHI_BASE}/markets`, {
        params: { status: "open", series_ticker: ticker, limit: 100 },
        timeout: 10000,
      });
      const markets = (data?.markets ?? []) as any[];

      // Filter out TIE/Co-Winners and very low probability (<2%) options to keep signal high
      const meaningful = markets.filter((m: any) => {
        const price = parseFloat(m.yes_ask_dollars ?? "0");
        const isTie = m.ticker.includes("-TIE");
        return !isTie && price >= 0.02; // at least 2% implied probability
      });

      // Sort by yes_ask descending (highest probability first) and take top 15
      meaningful.sort((a: any, b: any) => parseFloat(b.yes_ask_dollars ?? "0") - parseFloat(a.yes_ask_dollars ?? "0"));
      const top = meaningful.slice(0, 15);

      for (const m of top) {
        // Extract player name from: "Will {Player} win {label}?" or "Who will win MVP?"
        const playerName =
          m.title.match(/Will ([\w\s.'\-Jr.]+?) win/)?.[1]?.trim() ??
          m.title.match(/Will ([\w\s.'\-Jr.]+?)\?/)?.[1]?.trim() ??
          null;

        // Build a clean descriptive title
        const cleanTitle = playerName
          ? `${playerName} wins ${label}`
          : m.title;

        const price = parseFloat(m.yes_ask_dollars ?? "0.05");
        const score = computeConfidence({
          impliedProb: price,
          source: "kalshi",
          betType: "season_prop",
          sport,
          title: cleanTitle,
        });

        bets.push({
          id: `kalshi-${m.ticker}`,
          source: "kalshi",
          sport,
          betType: "season_prop",
          title: cleanTitle,
          description: `Kalshi prediction market: ${m.title} | Implied probability: ${Math.round(price * 100)}%`,
          yesPrice: price,
          noPrice: 1 - price,
          impliedProbability: price,
          confidenceScore: score.score,
          riskLevel: score.risk,
          recommendedAllocation: score.allocation,
          keyFactors: [`Kalshi market implied prob: ${Math.round(price * 100)}%`, `Award: ${label}`, ...score.factors],
          researchSummary: score.summary,
          isHighConfidence: score.score >= 85,
          status: "open",
          homeTeam: null,
          awayTeam: null,
          playerName,
          gameTime: null, // season awards have no game time
          notificationSent: false,
          playerStats: null,
          teamStats: null,
          line: null,
          overOdds: null,
          underOdds: null,
        });
      }

      console.log(`Kalshi ${label}: ${top.length} award markets`);
    } catch (e: any) {
      console.warn(`Kalshi season awards ${ticker} fetch error:`, e.message);
    }
  }

  console.log(`Kalshi Season Awards total: ${bets.length} markets`);
  return bets;
}

// ─── ActionNetwork API ────────────────────────────────────────────────────────
// With auth key: returns real public betting % + sharp money % for all books.
// Without key: falls back to browser headers (public, no money data).
const ACTION_SPORTS: Record<string, string> = {
  NBA: "nba",
  NFL: "nfl",
  MLB: "mlb",
  NHL: "nhl",
  NCAAB: "ncaab",
  NCAAF: "ncaaf",
};
// Book IDs for major US sportsbooks on ActionNetwork
const ACTION_BOOK_IDS = "15,30,366,283,68,351,348,355,76,75";
// ActionNetwork API key (enables public betting % + sharp money data)
const ACTION_API_KEY = process.env.ACTION_NETWORK_KEY ?? "95d975972c05aa2f9ea5c3688ffc327c8afdbfe3dbd59f3545715d8e3bf7bee2";

// ─── API-Sports (bb2db2357407d316eb56cc5cf0dcfcb8) — player stats for confidence boosts ───
const API_SPORTS_KEY = process.env.API_SPORTS_KEY ?? "bb2db2357407d316eb56cc5cf0dcfcb8";
const API_SPORTS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hour cache — only 100 req/day
let apiSportsCache: { ts: number; statsMap: Map<string, any> } | null = null;

async function fetchApiSportsPlayerStats(): Promise<Map<string, any>> {
  if (!API_SPORTS_KEY) return new Map();
  if (apiSportsCache && Date.now() - apiSportsCache.ts < API_SPORTS_CACHE_TTL) {
    return apiSportsCache.statsMap;
  }

  const statsMap = new Map<string, any>(); // keyed by "FIRSTNAME LASTNAME" normalized
  try {
    const today = new Date().toISOString().split("T")[0];
    // Fetch NBA games for today (1 request)
    const nbaResp = await axios.get("https://v2.nba.api-sports.io/games", {
      headers: { "x-rapidapi-key": API_SPORTS_KEY, "x-rapidapi-host": "v2.nba.api-sports.io" },
      params: { date: today },
      timeout: 8000,
    });
    const nbaGames: any[] = nbaResp.data?.response ?? [];
    // Fetch player stats for up to 3 live/recent games (3 requests)
    let reqCount = 0;
    for (const game of nbaGames.slice(0, 3)) {
      if (reqCount >= 3) break;
      try {
        const statsResp = await axios.get("https://v2.nba.api-sports.io/players/statistics", {
          headers: { "x-rapidapi-key": API_SPORTS_KEY, "x-rapidapi-host": "v2.nba.api-sports.io" },
          params: { game: game.id },
          timeout: 8000,
        });
        const players: any[] = statsResp.data?.response ?? [];
        for (const p of players) {
          const name = `${p.player?.firstname ?? ""} ${p.player?.lastname ?? ""}`.trim().toLowerCase();
          if (name) statsMap.set(name, p);
        }
        reqCount++;
      } catch { /* silent */ }
    }
    console.log(`[API-Sports] NBA player stats loaded: ${statsMap.size} players from ${reqCount} games`);
  } catch (e: any) {
    console.warn("[API-Sports] Error:", e.message);
  }

  apiSportsCache = { ts: Date.now(), statsMap };
  return statsMap;
}

function applyApiSportsBoosts(bets: InsertBet[], statsMap: Map<string, any>): InsertBet[] {
  if (statsMap.size === 0) return bets;
  return bets.map(bet => {
    if (bet.betType !== "player_prop" || !bet.playerName) return bet;
    const key = bet.playerName.toLowerCase();
    const stats = statsMap.get(key);
    if (!stats) return bet;
    // Boost confidence if player has strong recent stats relevant to their prop
    const statType = (bet.teamStats as any)?.statType?.toLowerCase() ?? "";
    const points = stats.points ?? 0;
    const rebounds = stats.totReb ?? 0;
    const assists = stats.assists ?? 0;
    let boost = 0;
    let factor = "";
    if (statType.includes("point") && points > 20) { boost = 3; factor = `Recent: ${points}pts avg`; }
    else if (statType.includes("rebound") && rebounds > 8) { boost = 3; factor = `Recent: ${rebounds}reb avg`; }
    else if (statType.includes("assist") && assists > 6) { boost = 3; factor = `Recent: ${assists}ast avg`; }
    else if (points > 0 || rebounds > 0) { boost = 1; factor = `API-Sports: ${points}pts/${rebounds}reb`; }
    if (boost === 0) return bet;
    const newScore = Math.min(99, (bet.confidenceScore ?? 50) + boost);
    return {
      ...bet,
      confidenceScore: newScore,
      isHighConfidence: newScore >= 85,
      keyFactors: [...(bet.keyFactors ?? []), factor].slice(0, 8),
    };
  });
}


// ── Build Edge Crew grade payload from ActionNetwork game object ──────────────
function buildEdgePayload(
  game: any,
  awayTeamObj: any,
  homeTeamObj: any,
  awayTeam: string,
  homeTeam: string,
  sportLabel: string,
  pickSide: "home" | "away",
  mlHome: number | null,
  mlAway: number | null,
  spreadDelta: number | null,
  spreadHome: number | null,
): Record<string, any> {
  const hr = (awayTeamObj as any)?.record ?? (homeTeamObj as any)?.record ?? null;
  const homeRecord = (homeTeamObj as any)?.record ?? "0-0";
  const awayRecord = (awayTeamObj as any)?.record ?? "0-0";
  return {
    sport:      sportLabel,
    homeTeam,
    awayTeam,
    pickSide,
    homeRecord,
    awayRecord,
    homeML:     mlHome ?? null,
    awayML:     mlAway ?? null,
    spreadHome: spreadHome ?? null,
    spreadDelta: spreadDelta ?? 0,
    // Sharp money %
    homeMoneyPct: game.odds?.[0]?.ml_home_money ?? null,
    awayMoneyPct: game.odds?.[0]?.ml_away_money ?? null,
  };
}

async function fetchActionNetwork(): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  const seen = new Set<string>();

  // Fetch today AND tomorrow to catch evening/late games across midnight UTC
  const dates: string[] = [];
  for (let offset = 0; offset <= 1; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    dates.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
  }

  for (const [sportLabel, sportSlug] of Object.entries(ACTION_SPORTS)) {
    for (const dateStr of dates) {
      try {
        const url = `https://api.actionnetwork.com/web/v1/scoreboard/publicbetting/${sportSlug}?period=game&bookIds=${ACTION_BOOK_IDS}&date=${dateStr}`;
        // Use auth key if available (unlocks public % + sharp money % data)
        // NOTE: ActionNetwork API blocks requests with User-Agent header when auth key is used
        // so we must set User-Agent to empty string to bypass that check.
        const { data } = await axios.get(url, {
          timeout: 10000,
          headers: ACTION_API_KEY
            ? {
                "Authorization": `Bearer ${ACTION_API_KEY}`,
                "Accept": "application/json",
                "User-Agent": "",  // Must be empty — AN API blocks custom UAs with auth
              }
            : {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.actionnetwork.com/",
                "Origin": "https://www.actionnetwork.com",
              },
        });

        const games: any[] = data?.games ?? data?.scoreboard ?? [];
        for (const game of games) {
          // Skip already-finished games
          const status = game.status ?? "";
          if (status === "complete" || status === "closed" || status === "final") continue;

          // Resolve team names from teams[] array keyed by id
          const teams: any[] = game.teams ?? [];
          const awayTeamObj = teams.find((t: any) => t.id === game.away_team_id) ?? teams[0] ?? {};
          const homeTeamObj = teams.find((t: any) => t.id === game.home_team_id) ?? teams[1] ?? {};
          const awayTeam = awayTeamObj.full_name ?? awayTeamObj.display_name ?? "Away";
          const homeTeam = homeTeamObj.full_name ?? homeTeamObj.display_name ?? "Home";

          // start_time is ISO string (e.g. "2026-03-15T00:30:00.000Z")
          const gameTime = game.start_time ? new Date(game.start_time) : null;

          // Find the best odds entry — prefer one with public/money % data (book 15 = DraftKings)
          const oddsArr: any[] = game.odds ?? [];
          if (oddsArr.length === 0) continue;
          // Pick the entry with the most non-null money fields (auth key data is on book 15)
          const oddsLine = oddsArr.reduce((best: any, curr: any) => {
            const bestMoney = Object.keys(best).filter(k => k.includes('_money') && best[k] != null).length;
            const currMoney = Object.keys(curr).filter(k => k.includes('_money') && curr[k] != null).length;
            return currMoney > bestMoney ? curr : best;
          }, oddsArr[0]);
          if (!oddsLine) continue;

          // ── Moneyline pick ──
          const mlHome = oddsLine.ml_home;
          const mlAway = oddsLine.ml_away;
          if (mlHome != null && mlAway != null) {
            const homeProb = americanToImplied(mlHome);
            const awayProb = americanToImplied(mlAway);

            // Use public money % if available (requires auth key), otherwise fall back to implied prob
            const homeMoneyRaw = oddsLine.ml_home_money;     // % of $ on home
            const awayMoneyRaw = oddsLine.ml_away_money;     // % of $ on away
            const homePublicRaw = oddsLine.ml_home_public;   // % of tickets on home
            const awayPublicRaw = oddsLine.ml_away_public;   // % of tickets on away
            const usePublic = homeMoneyRaw != null && awayMoneyRaw != null;
            const homeSignal = usePublic ? (homeMoneyRaw / 100) : homeProb;
            const awaySignal = usePublic ? (awayMoneyRaw / 100) : awayProb;

            const pickSide = homeSignal >= awaySignal ? "home" : "away";
            const pickTeam = pickSide === "home" ? homeTeam : awayTeam;
            const pickedOdds = pickSide === "home" ? mlHome : mlAway;
            const pickedProb = pickSide === "home" ? homeProb : awayProb;
            // Sharp money % and public ticket % for this pick's side
            const pickedSharpMoney = pickSide === "home" ? homeMoneyRaw : awayMoneyRaw;
            const pickedPublicTicket = pickSide === "home" ? homePublicRaw : awayPublicRaw;

            if (pickedProb >= 0.52) { // only pick clear favorites
              const label = usePublic
                ? `${Math.round(homeSignal > awaySignal ? homeSignal : awaySignal)}% sharp money on ${pickTeam}`
                : `ML favourite: ${pickedOdds > 0 ? "+" : ""}${pickedOdds}`;
              const title = `${awayTeam} @ ${homeTeam} — ${pickTeam} ML (${pickedOdds > 0 ? "+" : ""}${pickedOdds})`;
              const id = `action-${sportSlug}-${game.id}-ml`;
              if (!seen.has(id)) {
                seen.add(id);
                const baseScore = computeConfidence({ impliedProb: pickedProb, source: "actionnetwork", betType: "moneyline", sport: sportLabel, title, odds: pickedOdds, sharpMoneyPct: pickedSharpMoney, publicTicketPct: pickedPublicTicket });
                // Try Clubhouse IQ grade engine first; fall back to computeConfidence
                const egPayload = buildEdgePayload(game, awayTeamObj, homeTeamObj, awayTeam, homeTeam, sportLabel, pickSide as "home"|"away", mlHome, mlAway, null, null);
                const eg = await callEdgeGrade(egPayload);
                const score = eg ? { ...edgeGradeToScore(eg, baseScore), edgeGrade: eg.grade, edgeSizing: eg.sizing, edgeScore: eg.score, edgeVariables: eg.variables, edgeChains: eg.chains_fired ?? eg.chains, edgePeter: eg.peter, edgeEV: eg.ev } : baseScore;
                bets.push({
                  id, source: "actionnetwork", sport: sportLabel, betType: "moneyline", title,
                  description: `ActionNetwork line — ${label}`,
                  line: null, overOdds: pickedOdds, underOdds: null,
                  impliedProbability: pickedProb, confidenceScore: score.score,
                  riskLevel: score.risk, recommendedAllocation: score.allocation,
                  keyFactors: [label, ...score.factors], researchSummary: score.summary,
                  isHighConfidence: score.score >= 85,
                  homeTeam, awayTeam, playerName: null, gameTime,
                  notificationSent: false, playerStats: null,
                  teamStats: (score as any).edgeGrade ? {
                    edgeGrade: (score as any).edgeGrade,
                    edgeSizing: (score as any).edgeSizing,
                    edgeScore: (score as any).edgeScore,
                    edgeEV: (score as any).edgeEV,
                    edgeVariables: (score as any).edgeVariables,
                    edgeChains: (score as any).edgeChains,
                    edgePeter: (score as any).edgePeter,
                  } : null,
                  yesPrice: null, noPrice: null,
                });
              }
            }
          }

          // ── Spread pick ──
          const spreadHome = oddsLine.spread_home;
          const spreadHomeLine = oddsLine.spread_home_line;
          const spreadAway = oddsLine.spread_away;
          const spreadAwayLine = oddsLine.spread_away_line;
          if (spreadHome != null && spreadHomeLine != null) {
            const homeSpreadProb = americanToImplied(spreadHomeLine);
            const awaySpreadProb = americanToImplied(spreadAwayLine ?? spreadHomeLine);

            const homeSpreadMoney = oddsLine.spread_home_money;
            const awaySpreadMoney = oddsLine.spread_away_money;
            const homeSpreadPublic = oddsLine.spread_home_public;
            const awaySpreadPublic = oddsLine.spread_away_public;
            const usePublicSpread = homeSpreadMoney != null && awaySpreadMoney != null;
            const homeSpreadSignal = usePublicSpread ? homeSpreadMoney / 100 : homeSpreadProb;
            const awaySpreadSignal = usePublicSpread ? awaySpreadMoney / 100 : awaySpreadProb;

            const pickSpreadSide = homeSpreadSignal >= awaySpreadSignal ? "home" : "away";
            const pickSpreadTeam = pickSpreadSide === "home" ? homeTeam : awayTeam;
            const pickSpreadLine = pickSpreadSide === "home" ? spreadHome : spreadAway;
            const pickSpreadOdds = pickSpreadSide === "home" ? spreadHomeLine : (spreadAwayLine ?? spreadHomeLine);
            const pickSpreadProb = pickSpreadSide === "home" ? homeSpreadProb : awaySpreadProb;
            const pickedSpreadSharpMoney = pickSpreadSide === "home" ? homeSpreadMoney : awaySpreadMoney;
            const pickedSpreadPublicTicket = pickSpreadSide === "home" ? homeSpreadPublic : awaySpreadPublic;
            const lineStr = pickSpreadLine > 0 ? `+${pickSpreadLine}` : `${pickSpreadLine}`;
            const oddsStr = pickSpreadOdds > 0 ? `+${pickSpreadOdds}` : `${pickSpreadOdds}`;

            const spreadLabel = usePublicSpread
              ? `${Math.round(homeSpreadSignal > awaySpreadSignal ? homeSpreadSignal : awaySpreadSignal)}% sharp money on ${pickSpreadTeam} ${lineStr}`
              : `${pickSpreadTeam} ${lineStr} (${oddsStr})`;
            const spreadTitle = `${awayTeam} @ ${homeTeam} — ${pickSpreadTeam} ${lineStr} (${oddsStr})`;
            const spreadId = `action-${sportSlug}-${game.id}-spread`;
            if (!seen.has(spreadId)) {
              seen.add(spreadId);
              const baseSpreadScore = computeConfidence({ impliedProb: pickSpreadProb, source: "actionnetwork", betType: "spread", sport: sportLabel, title: spreadTitle, odds: pickSpreadOdds, line: pickSpreadLine, sharpMoneyPct: pickedSpreadSharpMoney, publicTicketPct: pickedSpreadPublicTicket });
              const egSpreadPayload = buildEdgePayload(game, awayTeamObj, homeTeamObj, awayTeam, homeTeam, sportLabel, pickSpreadSide as "home"|"away", mlHome, mlAway, null, pickSpreadLine ?? null);
              const egSpread = await callEdgeGrade(egSpreadPayload);
              const score = egSpread ? { ...edgeGradeToScore(egSpread, baseSpreadScore), edgeGrade: egSpread.grade, edgeSizing: egSpread.sizing, edgeScore: egSpread.score, edgeVariables: egSpread.variables, edgeChains: egSpread.chains_fired ?? egSpread.chains, edgePeter: egSpread.peter, edgeEV: egSpread.ev } : baseSpreadScore;
              bets.push({
                id: spreadId, source: "actionnetwork", sport: sportLabel, betType: "spread", title: spreadTitle,
                description: `ActionNetwork spread — ${spreadLabel}`,
                line: pickSpreadLine, overOdds: pickSpreadOdds, underOdds: null,
                impliedProbability: pickSpreadProb, confidenceScore: score.score,
                riskLevel: score.risk, recommendedAllocation: score.allocation,
                keyFactors: [spreadLabel, ...score.factors], researchSummary: score.summary,
                isHighConfidence: score.score >= 85,
                homeTeam, awayTeam, playerName: null, gameTime,
                notificationSent: false, playerStats: null,
                teamStats: (score as any).edgeGrade ? {
                  edgeGrade: (score as any).edgeGrade,
                  edgeSizing: (score as any).edgeSizing,
                  edgeScore: (score as any).edgeScore,
                  edgeEV: (score as any).edgeEV,
                  edgeVariables: (score as any).edgeVariables,
                  edgeChains: (score as any).edgeChains,
                  edgePeter: (score as any).edgePeter,
                } : null,
                yesPrice: null, noPrice: null,
              });
            }
          }

          // ── Total pick ──
          const total = oddsLine.total;
          const overOdds = oddsLine.over;
          const underOdds = oddsLine.under;
          if (total != null && overOdds != null && underOdds != null) {
            const overProb = americanToImplied(overOdds);
            const underProb = americanToImplied(underOdds);

            const overMoneyPct = oddsLine.total_over_money;
            const underMoneyPct = oddsLine.total_under_money;
            const overPublicPct = oddsLine.total_over_public;
            const underPublicPct = oddsLine.total_under_public;
            const usePublicTotal = overMoneyPct != null && underMoneyPct != null;
            const overSignal = usePublicTotal ? overMoneyPct / 100 : overProb;
            const underSignal = usePublicTotal ? underMoneyPct / 100 : underProb;

            const pickTotalSide = overSignal >= underSignal ? "over" : "under";
            const pickTotalOdds = pickTotalSide === "over" ? overOdds : underOdds;
            const pickTotalProb = pickTotalSide === "over" ? overProb : underProb;
            const pickedTotalSharpMoney = pickTotalSide === "over" ? overMoneyPct : underMoneyPct;
            const pickedTotalPublicTicket = pickTotalSide === "over" ? overPublicPct : underPublicPct;
            const totalOddsStr = pickTotalOdds > 0 ? `+${pickTotalOdds}` : `${pickTotalOdds}`;

            const totalLabel = usePublicTotal
              ? `${Math.round(overSignal > underSignal ? overSignal : underSignal)}% sharp money on ${pickTotalSide.toUpperCase()} ${total}`
              : `${pickTotalSide.toUpperCase()} ${total} (${totalOddsStr})`;
            const totalTitle = `${awayTeam} @ ${homeTeam} — ${pickTotalSide === "over" ? "OVER" : "UNDER"} ${total} (${totalOddsStr})`;
            const totalId = `action-${sportSlug}-${game.id}-total`;
            if (!seen.has(totalId)) {
              seen.add(totalId);
              const baseTotalScore = computeConfidence({ impliedProb: pickTotalProb, source: "actionnetwork", betType: "total", sport: sportLabel, title: totalTitle, odds: pickTotalOdds, line: total, sharpMoneyPct: pickedTotalSharpMoney, publicTicketPct: pickedTotalPublicTicket });
              // Totals: pick "home" side as a proxy (over = offense, grade the home side)
              const egTotalPayload = buildEdgePayload(game, awayTeamObj, homeTeamObj, awayTeam, homeTeam, sportLabel, "home", mlHome, mlAway, null, total ?? null);
              const egTotal = await callEdgeGrade(egTotalPayload);
              const score = egTotal ? { ...edgeGradeToScore(egTotal, baseTotalScore), edgeGrade: egTotal.grade, edgeSizing: egTotal.sizing, edgeScore: egTotal.score, edgeVariables: egTotal.variables, edgeChains: egTotal.chains_fired ?? egTotal.chains, edgePeter: egTotal.peter, edgeEV: egTotal.ev } : baseTotalScore;
              bets.push({
                id: totalId, source: "actionnetwork", sport: sportLabel, betType: "total", title: totalTitle,
                description: `ActionNetwork total — ${totalLabel}`,
                line: total, overOdds, underOdds,
                impliedProbability: pickTotalProb, confidenceScore: score.score,
                riskLevel: score.risk, recommendedAllocation: score.allocation,
                keyFactors: [totalLabel, ...score.factors], researchSummary: score.summary,
                isHighConfidence: score.score >= 85,
                homeTeam, awayTeam, playerName: null, gameTime,
                notificationSent: false, playerStats: null,
                teamStats: (score as any).edgeGrade ? {
                  edgeGrade: (score as any).edgeGrade,
                  edgeSizing: (score as any).edgeSizing,
                  edgeScore: (score as any).edgeScore,
                  edgeEV: (score as any).edgeEV,
                  edgeVariables: (score as any).edgeVariables,
                  edgeChains: (score as any).edgeChains,
                  edgePeter: (score as any).edgePeter,
                } : null,
                yesPrice: null, noPrice: null,
              });
            }
          }
        }
      } catch (e: any) {
        console.warn(`ActionNetwork fetch error (${sportLabel} ${dateStr}):`, e.message);
      }
    }
  }
  console.log(`ActionNetwork: ${bets.length} game picks (moneyline + spread + total)`);
  return bets;
}

// ─── Polymarket public API ────────────────────────────────────────────────────
const POLY_BASE = "https://gamma-api.polymarket.com";

async function fetchPolymarketSports(): Promise<InsertBet[]> {
  try {
    const { data } = await axios.get(`${POLY_BASE}/events`, {
      params: { limit: 200, active: true, tag_slug: "sports" },
      timeout: 10000,
    });
    const events = Array.isArray(data) ? data : (data?.events ?? data?.data ?? []);
    const bets: InsertBet[] = [];
    for (const ev of events.slice(0, 80)) {
      const markets = ev.markets ?? [];
      for (const m of markets) {
        bets.push(buildPolyBet(ev, m));
      }
    }
    return bets;
  } catch (e: any) {
    console.warn("Polymarket fetch error:", e.message);
    return [];
  }
}

function buildPolyBet(ev: any, m: any): InsertBet {
  const yesPrice = parseFloat(m.outcomePrices?.[0] ?? m.lastTradePrice ?? 0.5);
  const noPrice = 1 - yesPrice;
  const sport = detectSport(ev.title + " " + (ev.tags?.join(" ") ?? ""));
  const betType = detectBetType(ev.title + " " + m.question);
  const score = computeConfidence({
    impliedProb: yesPrice,
    source: "polymarket",
    betType,
    sport,
    title: ev.title,
  });

  return {
    id: `poly-${m.id ?? ev.id}`,
    source: "polymarket",
    sport,
    betType,
    title: m.question ?? ev.title,
    description: ev.description ?? "",
    yesPrice,
    noPrice,
    impliedProbability: yesPrice,
    confidenceScore: score.score,
    riskLevel: score.risk,
    recommendedAllocation: score.allocation,
    keyFactors: score.factors,
    researchSummary: score.summary,
    isHighConfidence: score.score >= 85,
    status: "open",
    homeTeam: null,
    awayTeam: null,
    playerName: null,
    gameTime: ev.endDate ? new Date(ev.endDate) : null,
    notificationSent: false,
    playerStats: null,
    teamStats: null,
    line: null,
    overOdds: null,
    underOdds: null,
  };
}

// ─── The Odds API (DraftKings + FanDuel for player props) ────────────────────
const ODDS_BASE = "https://api.the-odds-api.com/v4";

// Core sports — always scanned
const CORE_SPORT_KEYS = ["americanfootball_nfl", "basketball_nba", "baseball_mlb", "baseball_mlb_preseason", "icehockey_nhl"];

// Optional sports — scanned when enabled in settings
const OPTIONAL_SPORT_KEYS = [
  "mma_mixed_martial_arts",
  "boxing_boxing",
  "basketball_ncaab",
  "americanfootball_ncaaf",
];

// Season/futures markets — championship winner outrights (no game time, always kept)
const SEASON_FUTURES_KEYS = [
  "baseball_mlb_world_series_winner",
  "basketball_nba_championship_winner",
  "basketball_ncaab_championship_winner",
  "icehockey_nhl_championship_winner",
  "golf_masters_tournament_winner",
  "golf_pga_championship_winner",
  "golf_the_open_championship_winner",
  "golf_us_open_winner",
];

// Season-long player props are handled via SEASON_FUTURES_KEYS (outright winner markets).
// The Odds API does not support "_season" market strings — those do not exist.
// Season prop analysis is delivered through championship outrights (World Series winner,
// NBA title winner, etc.) which are confirmed active and return real lines.

// ─── Apify DraftKings DFS — player salary/value boosts ─────────────────────────────────
// Runs DraftKings DFS actor to get player salaries — high salary = implied high value/usage.
// Returns a map of playerName (lowercase) → { salary, sport }.
// One Apify call per scan, budget-aware (skips if quota would exceed $5/mo).
const APIFY_ACTOR_ID = "0ZaPR6PaZu03JW9ov"; // DraftKings DFS scraper
const APIFY_BASE = "https://api.apify.com/v2";

// In-memory cache to avoid re-running Apify on every scan (30-min TTL)
let apifyDFSCache: { data: Map<string, { salary: number; sport: string }>; ts: number } | null = null;
const APIFY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchApifyDFSSalaries(apifyKey: string): Promise<Map<string, { salary: number; sport: string }>> {
  const now = Date.now();
  if (apifyDFSCache && now - apifyDFSCache.ts < APIFY_CACHE_TTL) {
    console.log(`[Apify] Using cached DFS salary data (${apifyDFSCache.data.size} players)`);
    return apifyDFSCache.data;
  }

  const salaryMap = new Map<string, { salary: number; sport: string }>();
  const sports = ["NBA", "NHL", "MLB", "NFL"];

  try {
    // Check monthly budget before running
    const limitsRes = await axios.get(`${APIFY_BASE}/users/me/limits`, {
      params: { token: apifyKey }, timeout: 5000,
    });
    const current = limitsRes.data?.data?.current?.monthlyUsageUsd ?? 0;
    const limit = limitsRes.data?.data?.limits?.maxMonthlyUsageUsd ?? 5;
    if (current > limit * 0.9) {
      console.log(`[Apify] Budget near limit ($${current.toFixed(2)}/$${limit}) — skipping DFS fetch`);
      return salaryMap;
    }

    // Run actor for each sport in parallel (budget: ~$0.30 each, ~$1.20 total)
    const runs = await Promise.allSettled(
      sports.map(sport =>
        axios.post(
          `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs`,
          { sport },
          { params: { token: apifyKey, waitForFinish: 45 }, timeout: 55000 }
        )
      )
    );

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const sport = sports[i];
      if (run.status !== "fulfilled") {
        console.warn(`[Apify] ${sport} run failed:`, (run as PromiseRejectedResult).reason?.message);
        continue;
      }
      const dsId = run.value.data?.data?.defaultDatasetId;
      if (!dsId) continue;

      const itemsRes = await axios.get(`${APIFY_BASE}/datasets/${dsId}/items`, {
        params: { token: apifyKey, limit: 500, clean: true }, timeout: 10000,
      });
      const items: any[] = itemsRes.data ?? [];

      for (const item of items) {
        if (item.type !== "player" || !item.playerName || !item.salary) continue;
        const key = item.playerName.toLowerCase();
        const existing = salaryMap.get(key);
        if (!existing || item.salary > existing.salary) {
          salaryMap.set(key, { salary: item.salary, sport });
        }
      }
      console.log(`[Apify] ${sport}: loaded ${items.filter((x:any) => x.type === 'player').length} player salaries`);
    }

    apifyDFSCache = { data: salaryMap, ts: Date.now() };
    console.log(`[Apify] Total DFS salary map: ${salaryMap.size} players`);
  } catch (e: any) {
    console.warn("[Apify] DFS fetch error:", e.message);
  }

  return salaryMap;
}

/**
 * Boost confidence scores for player props where the player has a high DFS salary.
 * High salary = DraftKings implies high projected usage/performance.
 */
function applyApifyDFSBoosts(
  bets: InsertBet[],
  salaryMap: Map<string, { salary: number; sport: string }>
): InsertBet[] {
  if (salaryMap.size === 0) return [...bets]; // Return a copy to prevent mutation bugs

  // Per-sport salary thresholds for bonuses
  const thresholds: Record<string, { top: number; mid: number }> = {
    NBA: { top: 8000, mid: 6000 },
    NHL: { top: 7000, mid: 5500 },
    MLB: { top: 5000, mid: 3800 },
    NFL: { top: 8000, mid: 6000 },
  };

  return bets.map(bet => {
    if (bet.betType !== "player_prop") return bet;
    const ts = bet.teamStats as any;
    const pName = (ts?.playerName ?? bet.playerName ?? "").toLowerCase();
    if (!pName) return bet;

    const entry = salaryMap.get(pName);
    if (!entry) return bet;

    const thresh = thresholds[entry.sport] ?? { top: 7000, mid: 5000 };
    let boost = 0;
    let factor = "";

    if (entry.salary >= thresh.top) {
      boost = 8;
      factor = `DraftKings DFS elite salary ($${entry.salary.toLocaleString()}) — top-tier projected usage`;
    } else if (entry.salary >= thresh.mid) {
      boost = 4;
      factor = `DraftKings DFS solid salary ($${entry.salary.toLocaleString()}) — good projected value`;
    } else {
      boost = 1;
      factor = `DraftKings DFS active ($${entry.salary.toLocaleString()})  — confirmed in game slate`;
    }

    const newScore = Math.min(99, (bet.confidenceScore ?? 50) + boost);
    const newFactors = [...((bet.keyFactors as string[]) ?? []), factor];

    return {
      ...bet,
      confidenceScore: newScore,
      isHighConfidence: newScore >= 85,
      keyFactors: newFactors,
    };
  });
}

// ─── Underdog Fantasy public API (player props — no key required) — v2 fix: solo_games merged ──
// Returns 5000+ active player props across NBA, NHL, MLB, NFL, WBC, PGA, MMA
// enabledSports: when provided, only process lines for those sports (respects optional sport toggles)
async function fetchUnderdogProps(enabledSports?: string[]): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  try {
    // Underdog API (api.underdogfantasy.com) blocks Railway's datacenter IP via Cloudflare.
    // Workaround: a GitHub Actions workflow fetches data every 30 min from a GH runner
    // (not CF-blocked) and commits it to the `cache` branch of this repo.
    // Railway reads the cached JSON via raw.githubusercontent.com — no IP block.
    const CACHE_BASE = "https://raw.githubusercontent.com/abudnick8/clubhouse-iq/cache/data/underdog-cache";
    const UNDERDOG_SPORTS = ["NBA", "NHL", "MLB", "NFL"];

    const sportResponses = await Promise.allSettled(
      UNDERDOG_SPORTS.map(sport =>
        axios.get(`${CACHE_BASE}/underdog_${sport}.json`, {
          timeout: 15000,
          // Add cache-bust query param so Railway doesn't get stale CDN responses
          params: { _t: Math.floor(Date.now() / (5 * 60 * 1000)) }, // 5-min CDN window
        })
      )
    );

    // Merge all sport responses into a single unified data object
    const merged: { over_under_lines: any[]; appearances: any[]; players: any[]; games: any[]; solo_games: any[] } = {
      over_under_lines: [], appearances: [], players: [], games: [], solo_games: [],
    };
    const seenIds = { appearances: new Set<string>(), players: new Set<string>(), games: new Set<number>(), solo_games: new Set<number>() };
    let fetchedSports: string[] = [];

    for (let i = 0; i < sportResponses.length; i++) {
      const resp = sportResponses[i];
      if (resp.status === "rejected") {
        console.warn(`[Underdog] ${UNDERDOG_SPORTS[i]} cache fetch failed: ${(resp as any).reason?.message}`);
        continue;
      }
      const d = (resp as any).value.data;
      // Skip sports that are still at "init" (never fetched) or have no lines
      const cachedAt: string = d.cached_at ?? "init";
      const lineCount = (d.over_under_lines ?? []).length;
      if (cachedAt === "init" || lineCount === 0) {
        console.log(`[Underdog] ${UNDERDOG_SPORTS[i]} cache is empty (cached_at=${cachedAt})`);
        continue;
      }
      // Warn if cache is stale (>2 hours old)
      const cacheAge = Date.now() - new Date(cachedAt).getTime();
      if (cacheAge > 2 * 60 * 60 * 1000) {
        console.warn(`[Underdog] ${UNDERDOG_SPORTS[i]} cache is stale (${Math.round(cacheAge/60000)}min old)`);
      }
      fetchedSports.push(UNDERDOG_SPORTS[i]);
      merged.over_under_lines.push(...(d.over_under_lines ?? []));
      for (const a of (d.appearances ?? [])) { if (!seenIds.appearances.has(a.id)) { merged.appearances.push(a); seenIds.appearances.add(a.id); } }
      for (const p of (d.players ?? []))      { if (!seenIds.players.has(p.id))     { merged.players.push(p);     seenIds.players.add(p.id);     } }
      for (const g of (d.games ?? []))        { if (!seenIds.games.has(g.id))       { merged.games.push(g);       seenIds.games.add(g.id);       } }
      for (const g of (d.solo_games ?? []))   { if (!seenIds.solo_games.has(g.id))  { merged.solo_games.push(g);  seenIds.solo_games.add(g.id);  } }
    }
    console.log(`[Underdog] Loaded ${merged.over_under_lines.length} lines from cache — sports: ${fetchedSports.join(", ")}`);
    const data = merged;

    const lines: any[] = data.over_under_lines ?? [];
    const appearances: any[] = data.appearances ?? [];
    const players: any[] = data.players ?? [];
    const games: any[] = data.games ?? [];
    const soloGames: any[] = data.solo_games ?? []; // individual matchups (tennis, golf, MMA, etc.)

    // Build lookup maps
    const playerMap = new Map<string, any>();
    for (const p of players) playerMap.set(p.id, p);

    // Merge games + solo_games — solo_games covers 1v1 events (tennis, MMA, golf rounds)
    const gameMap = new Map<number, any>();
    for (const g of games) gameMap.set(g.id, g);
    for (const g of soloGames) gameMap.set(g.id, g); // <-- FIX: was missing solo_games

    const appearanceMap = new Map<string, any>();
    for (const a of appearances) appearanceMap.set(a.id, a);

    // Sport ID → canonical sport name mapping
    const sportMap: Record<string, string> = {
      NBA: "NBA", NFL: "NFL", MLB: "MLB", NHL: "NHL",
      WBC: "MLB", CBB: "NCAAB", PGA: "Golf", MMA: "MMA",
      BOXING: "Boxing", NCAAF: "NCAAF", F1SZN: "Other",
    };

    // Core sports to include (skip FIFA, esports, etc.)
    // If enabledSports is provided, filter to only those sports;
    // otherwise fall back to the default core set.
    // Underdog sport IDs → canonical sport names (via sportMap above):
    //   MMA → "MMA", BOXING → "Boxing", CBB → "NCAAB", PGA → "Golf", NCAAF → "NCAAF"
    const allCoreSports = ["NBA", "NFL", "MLB", "NHL", "WBC", "CBB", "PGA", "MMA", "BOXING", "NCAAF"];
    const includedSports = enabledSports
      ? new Set(allCoreSports.filter(sid => {
          const canonicalName = sportMap[sid] ?? sid;
          return enabledSports.includes(canonicalName);
        }))
      : new Set(["NBA", "NFL", "MLB", "NHL", "WBC", "CBB", "PGA", "MMA"]);

    // Stat type → display name mapping
    const statDisplayMap: Record<string, string> = {
      // NBA
      points: "Points",
      rebounds: "Rebounds",
      assists: "Assists",
      pts_rebs_asts: "Pts + Rebs + Asts",
      pts_rebs: "Points + Rebounds",
      pts_asts: "Points + Assists",
      rebs_asts: "Rebounds + Assists",
      blks_stls: "Blocks + Steals",
      period_1_pts_rebs_asts: "1Q Pts + Rebs + Asts",
      period_1_2_pts_rebs_asts: "1H Pts + Rebs + Asts",
      threes: "3-Pointers Made",
      three_points_made: "3-Pointers Made",
      steals: "Steals",
      blocks: "Blocks",
      turnovers: "Turnovers",
      // NHL
      goals: "Goals",
      assists_hockey: "Assists",
      shots: "Shots on Goal",
      saves: "Saves",
      blocked_shots: "Blocked Shots",
      faceoffs_won: "Faceoffs Won",
      plus_minus: "Plus/Minus",
      power_play_points: "Power Play Points",
      // MLB
      hits: "Hits",
      total_bases: "Total Bases",
      strikeouts: "Strikeouts",
      home_runs: "Home Runs",
      rbi: "RBIs",
      rbis: "RBIs",
      runs: "Runs",
      stolen_bases: "Stolen Bases",
      hits_runs_rbis: "Hits + Runs + RBIs",
      pitch_outs: "Pitching Outs",
      // NFL
      passing_yards: "Passing Yards",
      rushing_yards: "Rushing Yards",
      receiving_yards: "Receiving Yards",
      receptions: "Receptions",
      touchdowns: "Touchdowns",
      kills: "Kills",
      finishing_position: "Finishing Position",
    };

    const now = Date.now();
    let count = 0;

    // ── Pre-warm ESPN stat cache for all unique player+sport+stat combos ──
    // We collect all combos upfront, fetch them in parallel (cap=12), then
    // the inner loop hits the cache instantly instead of blocking on HTTP.
    type WarmKey = { playerName: string; sport: string; statKey: string };
    const warmSet = new Map<string, WarmKey>();
    for (const line of lines) {
      if (line.status !== "active") continue;
      const ou2 = line.over_under;
      if (!ou2 || ou2.category !== "player_prop") continue;
      const as2 = ou2.appearance_stat;
      if (!as2) continue;
      const app2 = appearanceMap.get(as2.appearance_id);
      if (!app2) continue;
      const pl2 = playerMap.get(app2.player_id);
      if (!pl2) continue;
      const sid2 = pl2.sport_id ?? "";
      if (!includedSports.has(sid2)) continue;
      const sp2 = sportMap[sid2] ?? "Other";
      const pName2 = `${pl2.first_name} ${pl2.last_name}`;
      const statRaw2 = (as2.stat ?? "").toLowerCase();
      // Skip if no single-key mapping AND not a combo (combos handled at fetch time)
      if (!STAT_KEY_MAP[sp2]?.[statRaw2] && !COMBO_STAT_MAP[sp2]?.[statRaw2]) continue;
      const wk = `${pName2}::${sp2}::${statRaw2}`;
      if (!warmSet.has(wk)) warmSet.set(wk, { playerName: pName2, sport: sp2, statKey: statRaw2 });
    }
    // Parallel fetch with concurrency=12 and a hard 20s total timeout.
    // If ESPN is slow/down the scan proceeds without form data (cache misses
    // return null and analyticalPickSide falls back to market-only behavior).
    const warmKeys = [...warmSet.values()];
    const CONCURRENCY = 12;
    const warmStart = Date.now();
    const MAX_WARM_MS = 20000; // never block scan more than 20s for ESPN
    try {
      await Promise.race([
        (async () => {
          for (let wi = 0; wi < warmKeys.length; wi += CONCURRENCY) {
            if (Date.now() - warmStart > MAX_WARM_MS) break; // bail early if slow
            await Promise.allSettled(
              warmKeys.slice(wi, wi + CONCURRENCY).map(wk => {
                const comboKs = COMBO_STAT_MAP[wk.sport]?.[wk.statKey];
                return comboKs
                  ? fetchComboStatAvg(wk.playerName, wk.sport, comboKs)
                  : fetchRecentStatAvg(wk.playerName, wk.sport, wk.statKey);
              })
            );
          }
        })(),
        new Promise(resolve => setTimeout(resolve, MAX_WARM_MS)),
      ]);
    } catch { /* swallow — cache may be partially warm, that's fine */ }
    const warmedCount = warmKeys.filter(wk => ESPN_STAT_CACHE.has(`${wk.playerName}::${wk.sport}::${STAT_KEY_MAP[wk.sport]?.[wk.statKey] ?? wk.statKey}`)).length;
    console.log(`[Underdog] ESPN cache pre-warm: ${warmedCount}/${warmKeys.length} resolved in ${Date.now()-warmStart}ms`);

    for (const line of lines) {
      if (line.status !== "active") continue;

      const ou = line.over_under;
      if (!ou || ou.category !== "player_prop") continue;

      const appearanceStat = ou.appearance_stat;
      if (!appearanceStat) continue;

      const appearanceId = appearanceStat.appearance_id;
      const appearance = appearanceMap.get(appearanceId);
      if (!appearance) continue;

      const player = playerMap.get(appearance.player_id);
      if (!player) continue;

      const sportId = player.sport_id ?? "";
      if (!includedSports.has(sportId)) continue;

      const sport = sportMap[sportId] ?? "Other";

      const game = gameMap.get(appearance.match_id);
      if (!game) continue;

      // Skip only completed/cancelled games — keep in-progress (live props still bettable)
      if (game.status === "complete" || game.status === "cancelled") continue;

      const gameTime = game.scheduled_at ? new Date(game.scheduled_at).toISOString() : null;

      // Skip if game started more than 4 hours ago (props likely settled)
      if (gameTime && new Date(gameTime).getTime() < now - 4 * 60 * 60 * 1000) continue;

      const playerName = `${player.first_name} ${player.last_name}`;
      const statName = appearanceStat.display_stat ?? statDisplayMap[appearanceStat.stat] ?? appearanceStat.stat ?? "Prop";
      const statValue = parseFloat(line.stat_value ?? "0");

      // Get odds from options (Higher = over, Lower = under)
      const options = line.options ?? [];
      const overOption = options.find((o: any) => o.choice === "higher");
      const underOption = options.find((o: any) => o.choice === "lower");

      const overOdds = overOption ? parseInt(overOption.american_price ?? "-110") : -110;
      const underOdds = underOption ? parseInt(underOption.american_price ?? "-110") : -110;

      // Implied probabilities
      const toProb = (odds: number) =>
        odds < 0 ? (-odds / (-odds + 100)) : (100 / (odds + 100));

      const overProb = toProb(overOdds);
      const underProb = toProb(underOdds);

      // Check if this is a lotto stat type for this sport
      // Lotto stats: NHL goals, MLB home runs, NFL touchdowns, NBA points
      const statRaw = (appearanceStat.stat ?? "").toLowerCase();
      const statNameLower = statName.toLowerCase();
      const isLottoStat =
        (sport === "NHL" && (statRaw === "goals" || statNameLower === "goals")) ||
        (sport === "MLB" && (statRaw === "home_runs" || statNameLower.includes("home run"))) ||
        (sport === "NFL" && (statRaw === "touchdowns" || statNameLower.includes("touchdown"))) ||
        (sport === "NBA" && statRaw === "points" && statNameLower === "points");

      // ── Fetch recent form data from ESPN + cross-validate ──
      // statRaw is the Underdog key (e.g. "points", "goals", "pts_rebs_asts")
      const statRawKey = (appearanceStat.stat ?? "").toLowerCase();
      const comboKeys = COMBO_STAT_MAP[sport]?.[statRawKey];

      // Step 1: Fetch cached avg (fast, may be stale for combos)
      const cachedAvg = comboKeys
        ? await fetchComboStatAvg(playerName, sport, comboKeys)
        : await fetchRecentStatAvg(playerName, sport, statRawKey);

      // Step 2: Cross-validate — re-compute per-game and detect divergence
      const { validatedAvg, perGameValues, hitRate, diverged } = await crossValidateRecentAvg(
        playerName, sport,
        comboKeys ?? null,
        comboKeys ? null : statRawKey,
        statValue,
        cachedAvg
      );
      const recentAvg = validatedAvg;
      const formEdgeVal = computeFormEdge(recentAvg, statValue);

      // Market-implied pick side
      const marketPickSide = overProb >= underProb ? "OVER" : "UNDER";

      // Step 3: Analytically-chosen pick side with hit-rate safety cross-check
      const { pickSide, formFlipped, safetyOverride, safetyNote } = analyticalPickSide(
        marketPickSide, formEdgeVal, isLottoStat, hitRate
      );

      let pickedOdds: number;
      let pickProb: number;

      if (isLottoStat) {
        // Lotto stats: always OVER (high-reward long shots)
        pickedOdds = overOdds;
        pickProb = overProb;
      } else {
        pickedOdds = pickSide === "OVER" ? overOdds : underOdds;
        pickProb = pickSide === "OVER" ? overProb : underProb;
        // Only surface non-lotto picks with meaningful edge (one side ≥52%)
        // Safety overrides revert to market so use market's picked side prob as threshold base
        const edgeThreshold = (formFlipped && !safetyOverride) ? 0.50 : 0.52;
        if (Math.max(overProb, underProb) < edgeThreshold) continue;
      }

      const formLabel = recentAvg != null
        ? ` (L5 avg: ${recentAvg.toFixed(1)}${diverged ? " ⚠️ corrected" : ""})`
        : "";
      const title = `[TAKE ${pickSide} ${statValue} @ ${pickedOdds > 0 ? "+" : ""}${pickedOdds}] ${playerName} — ${statName}`;
      const description = `${playerName} is projected to go ${pickSide} ${statValue} ${statName}${formLabel}. ${sport} player prop from Underdog Fantasy. ${overOption?.selection_subheader ?? ""}`;

      // Build extra key factors from safety/divergence flags
      const extraFactors: string[] = [];
      if (diverged) {
        extraFactors.push(`⚠️ Stat data corrected: cached avg was mismatched — using per-game cross-validated value (${recentAvg?.toFixed(1)})`);
      }
      if (safetyNote) {
        extraFactors.push(`⚠️ ${safetyNote}`);
      }
      if (hitRate !== null && perGameValues.length >= 3) {
        const overHits = Math.round(hitRate * perGameValues.length);
        const underHits = perGameValues.length - overHits;
        const dir = pickSide === "OVER" ? "OVER" : "UNDER";
        const hits = pickSide === "OVER" ? overHits : underHits;
        extraFactors.push(`Hit rate check: ${hits}/${perGameValues.length} recent games went ${dir} ${statValue}`);
      }

      const confidence = computeConfidence({
        impliedProb: pickProb,
        source: "underdog",
        betType: "player_prop",
        sport,
        title,
        odds: pickedOdds,
        line: statValue,
        recentAvg,
        formEdge: formEdgeVal,
        formFlipped: formFlipped && !safetyOverride,
      });

      const gameTimeVal = gameTime ? new Date(gameTime) : null;

      // Parse "Away Team @ Home Team" from game title
      const gameTitle: string = game.full_team_names_title ?? game.full_title ?? game.abbreviated_title ?? "";
      const atIdx = gameTitle.indexOf(" @ ");
      const awayTeam = atIdx >= 0 ? gameTitle.substring(0, atIdx).trim() : undefined;
      const homeTeam = atIdx >= 0 ? gameTitle.substring(atIdx + 3).trim() : undefined;

      bets.push({
        id: `underdog_${line.id}`,
        title,
        description,
        sport,
        betType: "player_prop",
        source: "underdog",
        line: statValue,
        overOdds: overOdds,
        underOdds: underOdds,
        impliedProbability: pickProb,
        confidenceScore: confidence.score,
        riskLevel: confidence.risk,
        recommendedAllocation: confidence.allocation,
        keyFactors: [`${pickSide} ${statValue} ${statName}`, ...extraFactors, ...confidence.factors],
        researchSummary: confidence.summary,
        gameTime: gameTimeVal,
        playerName,
        homeTeam,
        awayTeam,
        isHighConfidence: confidence.score >= 85,
        // ── Stat-vs-line edge (TikTok model) ────────────────────────────────────────
        recentAvg:     recentAvg ?? null,
        formEdgePct:   formEdgeVal != null ? Math.round(formEdgeVal * 1000) / 10 : null,
        hitRate:       hitRate ?? null,
        hitRateGames:  perGameValues.length > 0 ? perGameValues.length : null,
        perGameValues: perGameValues.slice(-6),   // last 6 games for sparkline
        statName:      statName ?? null,
        teamStats: {
          pickSide,
          pickedOdds,
          overProb: Math.round(overProb * 100),
          underProb: Math.round(underProb * 100),
          playerName,
          statType: statName,
          statRaw: statRawKey,   // raw Underdog key e.g. "pts_rebs_asts"
          statValue,
          gameTitle,
        },
      });
      count++;
    }

    console.log(`[Underdog] Fetched ${count} active player props`);
  } catch (e: any) {
    console.warn("[Underdog] fetch error:", e.message);
  }
  return bets;
}

// ─── Seed futures data ───────────────────────────────────────────────────────
// Used as fallback when The Odds API quota is exhausted.
// Updated periodically — reflects real DraftKings odds from the time of last build.
// When the API has quota, live data overwrites these automatically.
interface SeedFuture {
  name: string;          // Team / player name
  odds: number;          // American odds
  sport: string;         // Display sport label
  event: string;         // Championship name
  sportKey: string;      // Odds API key
}

const SEED_FUTURES: SeedFuture[] = [
  // MLB World Series 2026 (spring training odds)
  { name: "New York Yankees",     odds: 600,   sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "Los Angeles Dodgers",  odds: 350,   sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "Atlanta Braves",       odds: 900,   sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "Philadelphia Phillies",odds: 800,   sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "Houston Astros",       odds: 1200,  sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "San Diego Padres",     odds: 1400,  sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "Baltimore Orioles",    odds: 1800,  sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  { name: "Texas Rangers",        odds: 1600,  sport: "MLB",   event: "MLB World Series Winner 2026",        sportKey: "baseball_mlb_world_series_winner" },
  // NBA Championship 2025-26
  { name: "Oklahoma City Thunder",odds: 200,   sport: "NBA",   event: "NBA Championship Winner 2025/2026",   sportKey: "basketball_nba_championship_winner" },
  { name: "Boston Celtics",       odds: 400,   sport: "NBA",   event: "NBA Championship Winner 2025/2026",   sportKey: "basketball_nba_championship_winner" },
  { name: "Cleveland Cavaliers",  odds: 600,   sport: "NBA",   event: "NBA Championship Winner 2025/2026",   sportKey: "basketball_nba_championship_winner" },
  { name: "Golden State Warriors",odds: 1400,  sport: "NBA",   event: "NBA Championship Winner 2025/2026",   sportKey: "basketball_nba_championship_winner" },
  { name: "Minnesota Timberwolves",odds: 900,  sport: "NBA",   event: "NBA Championship Winner 2025/2026",   sportKey: "basketball_nba_championship_winner" },
  { name: "Houston Rockets",      odds: 1200,  sport: "NBA",   event: "NBA Championship Winner 2025/2026",   sportKey: "basketball_nba_championship_winner" },
  // NHL Stanley Cup 2025-26
  { name: "Florida Panthers",     odds: 500,   sport: "NHL",   event: "NHL Stanley Cup Winner 2025/2026",    sportKey: "icehockey_nhl_championship_winner" },
  { name: "Winnipeg Jets",        odds: 600,   sport: "NHL",   event: "NHL Stanley Cup Winner 2025/2026",    sportKey: "icehockey_nhl_championship_winner" },
  { name: "Edmonton Oilers",      odds: 700,   sport: "NHL",   event: "NHL Stanley Cup Winner 2025/2026",    sportKey: "icehockey_nhl_championship_winner" },
  { name: "Colorado Avalanche",   odds: 900,   sport: "NHL",   event: "NHL Stanley Cup Winner 2025/2026",    sportKey: "icehockey_nhl_championship_winner" },
  { name: "Tampa Bay Lightning",  odds: 1100,  sport: "NHL",   event: "NHL Stanley Cup Winner 2025/2026",    sportKey: "icehockey_nhl_championship_winner" },
  // NCAAB March Madness 2026
  { name: "Duke Blue Devils",     odds: 500,   sport: "NCAAB", event: "NCAAB Championship Winner 2026",      sportKey: "basketball_ncaab_championship_winner" },
  { name: "Kansas Jayhawks",      odds: 700,   sport: "NCAAB", event: "NCAAB Championship Winner 2026",      sportKey: "basketball_ncaab_championship_winner" },
  { name: "Auburn Tigers",        odds: 600,   sport: "NCAAB", event: "NCAAB Championship Winner 2026",      sportKey: "basketball_ncaab_championship_winner" },
  { name: "Florida Gators",       odds: 1000,  sport: "NCAAB", event: "NCAAB Championship Winner 2026",      sportKey: "basketball_ncaab_championship_winner" },
  { name: "Houston Cougars",      odds: 1200,  sport: "NCAAB", event: "NCAAB Championship Winner 2026",      sportKey: "basketball_ncaab_championship_winner" },
  // Golf — 2026 Masters
  { name: "Scottie Scheffler",    odds: 450,   sport: "Golf",  event: "Masters Tournament Winner 2026",      sportKey: "golf_masters_tournament_winner" },
  { name: "Rory McIlroy",         odds: 900,   sport: "Golf",  event: "Masters Tournament Winner 2026",      sportKey: "golf_masters_tournament_winner" },
  { name: "Jon Rahm",             odds: 1200,  sport: "Golf",  event: "Masters Tournament Winner 2026",      sportKey: "golf_masters_tournament_winner" },
  { name: "Xander Schauffele",    odds: 1400,  sport: "Golf",  event: "Masters Tournament Winner 2026",      sportKey: "golf_masters_tournament_winner" },
  { name: "Collin Morikawa",      odds: 1600,  sport: "Golf",  event: "Masters Tournament Winner 2026",      sportKey: "golf_masters_tournament_winner" },
  // Golf — 2026 PGA Championship
  { name: "Scottie Scheffler",    odds: 500,   sport: "Golf",  event: "PGA Championship Winner 2026",        sportKey: "golf_pga_championship_winner" },
  { name: "Rory McIlroy",         odds: 800,   sport: "Golf",  event: "PGA Championship Winner 2026",        sportKey: "golf_pga_championship_winner" },
  { name: "Viktor Hovland",       odds: 1400,  sport: "Golf",  event: "PGA Championship Winner 2026",        sportKey: "golf_pga_championship_winner" },
  // Golf — 2026 US Open
  { name: "Scottie Scheffler",    odds: 450,   sport: "Golf",  event: "US Open Winner 2026",                 sportKey: "golf_us_open_winner" },
  { name: "Wyndham Clark",        odds: 2000,  sport: "Golf",  event: "US Open Winner 2026",                 sportKey: "golf_us_open_winner" },
  { name: "Rory McIlroy",         odds: 900,   sport: "Golf",  event: "US Open Winner 2026",                 sportKey: "golf_us_open_winner" },
];

function buildSeedFutures(): InsertBet[] {
  return SEED_FUTURES.map((f) => {
    const impliedProb = americanToImplied(f.odds);
    const oddsDisplay = f.odds > 0 ? `+${f.odds}` : `${f.odds}`;
    const title = `${f.name} to win ${f.event}`;
    const id = `seed-futures-${f.sportKey}-${f.name.replace(/\s+/g, "-").toLowerCase()}`;
    const score = computeConfidence({
      impliedProb,
      source: "draftkings",
      betType: "moneyline",
      sport: f.sport,
      title,
      odds: f.odds,
    });
    return {
      id,
      source: "draftkings",
      sport: f.sport,
      betType: "moneyline",
      title,
      description: `Season outright — ${oddsDisplay} odds (seed data — refreshes when API quota resets)`,
      line: null,
      overOdds: f.odds,
      underOdds: null,
      impliedProbability: impliedProb,
      confidenceScore: score.score,
      riskLevel: score.risk,
      recommendedAllocation: score.allocation,
      keyFactors: [`Season futures: ${oddsDisplay}`, ...score.factors],
      researchSummary: `[SEASON FUTURES ${oddsDisplay}] — ${score.summary}`,
      isHighConfidence: score.score >= 85,
      status: "open",
      homeTeam: null,
      awayTeam: null,
      playerName: f.name,
      gameTime: null,
      notificationSent: false,
      playerStats: null,
      teamStats: { pickSide: "over", pickedOdds: f.odds, overProb: Math.round(impliedProb * 100), underProb: 0, isFutures: true },
      yesPrice: null,
      noPrice: null,
    } as InsertBet;
  });
}

// Player prop market keys per sport (game-level) — Odds API paid tier supports all of these
const PROP_MARKETS: Record<string, string> = {
  americanfootball_nfl:
    "player_pass_tds,player_pass_yds,player_pass_completions,player_pass_attempts,player_pass_interceptions," +
    "player_rush_yds,player_rush_attempts,player_rush_longest," +
    "player_receptions,player_reception_yds,player_reception_longest,player_anytime_td,player_1st_td",
  basketball_nba:
    "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals," +
    "player_points_rebounds_assists,player_points_rebounds,player_points_assists,player_rebounds_assists," +
    "player_turnovers,player_double_double",
  baseball_mlb:
    "batter_hits,batter_home_runs,batter_rbis,batter_runs_scored,batter_total_bases," +
    "batter_stolen_bases,batter_walks,pitcher_strikeouts,pitcher_hits_allowed," +
    "pitcher_walks,pitcher_outs,pitcher_earned_runs",
  icehockey_nhl:
    "player_points,player_goals,player_assists,player_shots_on_goal," +
    "player_power_play_points,player_blocked_shots,player_total_saves",
  // Optional sports
  mma_mixed_martial_arts: "h2h",
  boxing_boxing: "h2h",
  basketball_ncaab:
    "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals",
  americanfootball_ncaaf:
    "player_pass_yds,player_rush_yds,player_reception_yds,player_pass_tds,player_receptions",
};

async function fetchOddsAPI(apiKey: string, settings?: { enabledSports?: string[]; enableSeasonProps?: boolean }): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  const enabledSports = settings?.enabledSports ?? ["NFL", "NBA", "MLB", "NHL"];
  const enableSeasonProps = settings?.enableSeasonProps ?? true;

  // Determine which sport keys to scan
  const sportKeyMap: Record<string, string> = {
    americanfootball_nfl: "NFL", basketball_nba: "NBA", baseball_mlb: "MLB", baseball_mlb_preseason: "MLB", icehockey_nhl: "NHL",
    mma_mixed_martial_arts: "MMA", boxing_boxing: "Boxing",
    basketball_ncaab: "NCAAB", americanfootball_ncaaf: "NCAAF",
  };

  const allGameKeys = [...CORE_SPORT_KEYS, ...OPTIONAL_SPORT_KEYS];
  const activeSportKeys = allGameKeys.filter(
    (k) => enabledSports.includes(sportKeyMap[k] ?? "Other")
  );

  for (const sportKey of activeSportKeys) {
    const isMMAorBoxing = sportKey === "mma_mixed_martial_arts" || sportKey === "boxing_boxing";

    // ── 1. Main game lines (spreads, totals, moneylines) ──
    try {
      const { data } = await axios.get(`${ODDS_BASE}/sports/${sportKey}/odds`, {
        params: {
          apiKey,
          regions: "us",
          markets: "h2h,spreads,totals",
          bookmakers: "draftkings,fanduel",
          oddsFormat: "american",
        },
        timeout: 12000,
      });
      for (const game of data ?? []) {
        bets.push(...parseGameLines(game, sportKey));
      }
    } catch (e: any) {
      console.warn(`Game lines error for ${sportKey}:`, e.message);
    }

    // ── 2. Player props (skip MMA/Boxing — h2h only for those) ──
    if (!isMMAorBoxing) {
      try {
        const { data: events } = await axios.get(`${ODDS_BASE}/sports/${sportKey}/events`, {
          params: { apiKey },
          timeout: 10000,
        });

        // Future events — up to 30 per sport (paid key has 18k+ credits)
        const now = Date.now();
        const upcomingEvents = (events ?? [])
          .filter((e: any) => new Date(e.commence_time).getTime() > now)
          .slice(0, 30);

        console.log(`  ${sportKey}: ${upcomingEvents.length} upcoming events for props`);

        for (const ev of upcomingEvents) {
          try {
            const { data: propData } = await axios.get(
              `${ODDS_BASE}/sports/${sportKey}/events/${ev.id}/odds`,
              {
                params: {
                  apiKey,
                  regions: "us",
                  bookmakers: "fanduel,draftkings,betmgm,williamhill_us",
                  markets: PROP_MARKETS[sportKey] ?? "player_points",
                  oddsFormat: "american",
                },
                timeout: 10000,
              }
            );
            const propBets = parsePlayerProps(propData, ev, sportKey);
            console.log(`    ${ev.away_team} @ ${ev.home_team}: ${propBets.length} props`);
            bets.push(...propBets);
          } catch (e: any) {
            console.warn(`  Props error for event ${ev.id}:`, e.message);
          }
        }
      } catch (e: any) {
        console.warn(`Events/props error for ${sportKey}:`, e.message);
      }
    }

  }

  // ── 4. Season futures / championship winner outrights ──
  if (enableSeasonProps) {
    for (const futuresKey of SEASON_FUTURES_KEYS) {
      const sport = mapSportKey(futuresKey);
      // Only fetch if parent sport is enabled
      const parentEnabled =
        (futuresKey.startsWith("baseball_mlb") && enabledSports.includes("MLB")) ||
        (futuresKey.startsWith("basketball_nba") && enabledSports.includes("NBA")) ||
        (futuresKey.startsWith("basketball_ncaab") && enabledSports.includes("NCAAB")) ||
        (futuresKey.startsWith("icehockey_nhl") && enabledSports.includes("NHL")) ||
        (futuresKey.startsWith("golf_") && enabledSports.includes("Golf")) ||
        true; // default include

      if (!parentEnabled) continue;

      try {
        const { data } = await axios.get(`${ODDS_BASE}/sports/${futuresKey}/odds`, {
          params: {
            apiKey,
            regions: "us",
            markets: "outrights",
            bookmakers: "draftkings,fanduel",
            oddsFormat: "american",
          },
          timeout: 12000,
        });

        for (const market of data ?? []) {
          for (const bk of market.bookmakers ?? []) {
            for (const mk of bk.markets ?? []) {
              for (const outcome of mk.outcomes ?? []) {
                const odds = outcome.price;
                const impliedProb = americanToImplied(odds);
                const oddsDisplay = odds > 0 ? `+${odds}` : `${odds}`;
                const sportLabel = mapSportKey(futuresKey);
                const eventLabel = market.sport_title ?? futuresKey.replace(/_/g, " ").replace(/winner$/, "Winner");
                const title = `${outcome.name} to win ${eventLabel}`;
                const id = `futures-${futuresKey}-${outcome.name.replace(/\s+/g, "-")}-${bk.key}`;
                const score = computeConfidence({
                  impliedProb,
                  source: bk.key === "fanduel" ? "underdog" : "draftkings",
                  betType: "moneyline",
                  sport: mapSportKey(futuresKey),
                  title,
                  odds,
                });
                bets.push({
                  id,
                  source: bk.key === "fanduel" ? "underdog" : "draftkings",
                  sport: mapSportKey(futuresKey),
                  betType: "moneyline",
                  title,
                  description: `Season outright — ${oddsDisplay} odds`,
                  line: null,
                  overOdds: odds,
                  underOdds: null,
                  impliedProbability: impliedProb,
                  confidenceScore: score.score,
                  riskLevel: score.risk,
                  recommendedAllocation: score.allocation,
                  keyFactors: [`Season futures pick: ${oddsDisplay}`, ...score.factors],
                  researchSummary: `[SEASON FUTURES ${oddsDisplay}] — ${score.summary}`,
                  isHighConfidence: score.score >= 85,
                  status: "open",
                  homeTeam: null,
                  awayTeam: null,
                  playerName: outcome.name,
                  gameTime: null, // no game time — season-long; filterStale keeps nulls
                  notificationSent: false,
                  playerStats: null,
                  teamStats: { pickSide: "over", pickedOdds: odds, overProb: Math.round(impliedProb * 100), underProb: 0, isFutures: true },
                  yesPrice: null,
                  noPrice: null,
                });
              }
            }
          }
        }
        console.log(`  Futures ${futuresKey}: done`);
      } catch (e: any) {
        console.warn(`Futures error for ${futuresKey}:`, e.message);
      }
    }
  }

  console.log(`Odds API total: ${bets.length} bets (game lines + props + futures)`);
  return bets;
}

// Parse standard game lines (h2h, spreads, totals)
function parseGameLines(game: any, sportKey: string): InsertBet[] {
  if (!game?.bookmakers?.length) return [];
  const sport = mapSportKey(sportKey);
  const bets: InsertBet[] = [];
  const seen = new Set<string>();

  for (const bookmaker of game.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      const betType = mapMarketType(market.key);
      for (let i = 0; i < (market.outcomes?.length ?? 0); i++) {
        const outcome = market.outcomes[i];
        const counterpart = market.outcomes[1 - i];
        const odds = outcome.price;
        const impliedProb = americanToImplied(odds);
        const title = `${game.away_team} @ ${game.home_team} — ${outcome.name}`;
        const id = `dk-${game.id}-${market.key}-${outcome.name.replace(/\s+/g, "-")}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const score = computeConfidence({ impliedProb, source: "draftkings", betType, sport, title, odds, line: outcome.point });
        bets.push({
          id,
          source: "draftkings",
          sport, betType, title,
          description: market.key.replace(/_/g, " "),
          line: outcome.point ?? null,
          overOdds: odds,
          underOdds: counterpart?.price ?? null,
          impliedProbability: impliedProb,
          confidenceScore: score.score,
          riskLevel: score.risk,
          recommendedAllocation: score.allocation,
          keyFactors: score.factors,
          researchSummary: score.summary,
          isHighConfidence: score.score >= 85,
          status: "open",
          homeTeam: game.home_team ?? null,
          awayTeam: game.away_team ?? null,
          playerName: null,
          gameTime: game.commence_time ? new Date(game.commence_time) : null,
          notificationSent: false,
          playerStats: null, teamStats: null,
          yesPrice: null, noPrice: null,
        });
      }
    }
  }
  return bets;
}

// Parse player props — outcomes use `description` for player name, `name` for over/under
function parsePlayerProps(game: any, event: any, sportKey: string, isSeasonProp = false): InsertBet[] {
  if (!game?.bookmakers?.length) return [];
  const sport = mapSportKey(sportKey);
  const bets: InsertBet[] = [];
  const seen = new Set<string>();

  for (const bookmaker of game.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      // Group outcomes by player (description field)
      const byPlayer = new Map<string, any[]>();
      for (const o of market.outcomes ?? []) {
        const playerName = o.description ?? o.name; // description = player name in prop markets
        if (!byPlayer.has(playerName)) byPlayer.set(playerName, []);
        byPlayer.get(playerName)!.push(o);
      }

      for (const [playerName, outcomes] of byPlayer) {
        // Find over and under outcomes
        const overOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "over");
        const underOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "under");

        // Yes/No markets (double double, anytime TD, etc.) — pick the stronger side
        const yesOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "yes");
        const noOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "no");

        let overOddsVal: number;
        let underOddsVal: number | null;
        let sideLabel: string;
        let line: number | undefined;

        if (overOutcome && underOutcome) {
          // Standard over/under prop
          overOddsVal = overOutcome.price;
          underOddsVal = underOutcome.price ?? null;
          line = overOutcome.point;
          const overProb = americanToImplied(overOddsVal);
          const underProb = underOddsVal !== null ? americanToImplied(underOddsVal) : 1 - overProb;
          const side = overProb >= underProb ? "over" : "under";
          sideLabel = side === "over" ? "TAKE OVER" : "TAKE UNDER";
          const pickedOdds_ = side === "over" ? overOddsVal : underOddsVal!;
          const pickedProb_ = side === "over" ? overProb : underProb;
          const marketLabel_ = market.key.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
          const oddsDisplay_ = pickedOdds_ > 0 ? `+${pickedOdds_}` : `${pickedOdds_}`;
          const seasonTag_ = isSeasonProp ? "\uD83D\uDCC5 SEASON \u2014 " : "";
          const baseTitle_ = `${seasonTag_}${playerName} \u2014 ${marketLabel_.charAt(0).toUpperCase() + marketLabel_.slice(1)} ${line !== undefined ? `O/U ${line}` : ""}`;
          const title = `[${sideLabel}${line !== undefined ? ` ${line}` : ""} @ ${oddsDisplay_}] ${seasonTag_}${playerName} \u2014 ${marketLabel_.charAt(0).toUpperCase() + marketLabel_.slice(1)}`;
          const id = `${isSeasonProp ? "season" : "prop"}-${event.id}-${market.key}-${playerName.replace(/\s+/g, "-")}-${bookmaker.key}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const score = computeConfidence({ impliedProb: pickedProb_, source: bookmaker.key, betType: "player_prop", sport, title: baseTitle_, odds: pickedOdds_, line });
          bets.push({
            id, source: bookmaker.key, sport, betType: "player_prop", title,
            description: `${event.away_team} @ ${event.home_team} \u00B7 ${bookmaker.key}`,
            line: line ?? null, overOdds: overOddsVal, underOdds: underOddsVal,
            impliedProbability: pickedProb_, confidenceScore: score.score, riskLevel: score.risk,
            recommendedAllocation: score.allocation,
            keyFactors: [`Pick: ${sideLabel}${line !== undefined ? ` ${line}` : ""} (${oddsDisplay_})`, ...(score.factors ?? [])],
            researchSummary: `[${sideLabel}${line !== undefined ? ` ${line}` : ""} @ ${oddsDisplay_}] \u2014 ${score.summary}`,
            isHighConfidence: score.score >= 85,
            homeTeam: event.home_team ?? null, awayTeam: event.away_team ?? null,
            playerName, gameTime: event.commence_time ? new Date(event.commence_time) : null,
            notificationSent: false, playerStats: null,
            teamStats: { pickSide: side, pickedOdds: pickedOdds_, overProb: Math.round(pickedProb_ * 100), underProb: Math.round((1-pickedProb_) * 100), playerName, statType: marketLabel_, statValue: line, gameTitle: `${event.away_team} @ ${event.home_team}` },
            yesPrice: null, noPrice: null,
          });
          continue;
        } else if (yesOutcome) {
          // Yes/No market — pick stronger side
          overOddsVal = yesOutcome.price;
          underOddsVal = noOutcome?.price ?? null;
          line = undefined;
          const yesProb = americanToImplied(overOddsVal);
          const noProb = underOddsVal !== null ? americanToImplied(underOddsVal) : 1 - yesProb;
          const side = yesProb >= noProb ? "yes" : "no";
          const pickedOdds_ = side === "yes" ? overOddsVal : underOddsVal!;
          const pickedProb_ = side === "yes" ? yesProb : noProb;
          if (pickedOdds_ == null || isNaN(pickedOdds_)) continue; // skip if no valid odds
          // Yes/No markets: "yes" = OVER (event happens), "no" = UNDER
          const yesNoPickSide = side === "yes" ? "OVER" : "UNDER";
          sideLabel = side === "yes" ? "TAKE OVER" : "TAKE UNDER";
          const marketLabel_ = market.key.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
          const oddsDisplay_ = pickedOdds_ > 0 ? `+${pickedOdds_}` : `${pickedOdds_}`;
          const seasonTag_ = isSeasonProp ? "\uD83D\uDCC5 SEASON \u2014 " : "";
          const baseTitle_ = `${seasonTag_}${playerName} \u2014 ${marketLabel_.charAt(0).toUpperCase() + marketLabel_.slice(1)}`;
          const title = `[${sideLabel} @ ${oddsDisplay_}] ${seasonTag_}${playerName} \u2014 ${marketLabel_.charAt(0).toUpperCase() + marketLabel_.slice(1)}`;
          const id = `${isSeasonProp ? "season" : "prop"}-${event.id}-${market.key}-${playerName.replace(/\s+/g, "-")}-${bookmaker.key}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const score = computeConfidence({ impliedProb: pickedProb_, source: bookmaker.key, betType: "player_prop", sport, title: baseTitle_, odds: pickedOdds_ });
          bets.push({
            id, source: bookmaker.key, sport, betType: "player_prop", title,
            description: `${event.away_team} @ ${event.home_team} \u00B7 ${bookmaker.key}`,
            line: null, overOdds: overOddsVal, underOdds: underOddsVal,
            impliedProbability: pickedProb_, confidenceScore: score.score, riskLevel: score.risk,
            recommendedAllocation: score.allocation,
            keyFactors: [`Pick: ${sideLabel} (${oddsDisplay_})`, ...(score.factors ?? [])],
            researchSummary: `[${sideLabel} @ ${oddsDisplay_}] \u2014 ${score.summary}`,
            isHighConfidence: score.score >= 85,
            homeTeam: event.home_team ?? null, awayTeam: event.away_team ?? null,
            playerName, gameTime: event.commence_time ? new Date(event.commence_time) : null,
            notificationSent: false, playerStats: null,
            teamStats: { pickSide: yesNoPickSide, pickedOdds: pickedOdds_, overProb: Math.round(pickedProb_ * 100), underProb: Math.round((1-pickedProb_) * 100), playerName, statType: marketLabel_, statValue: null, gameTitle: `${event.away_team} @ ${event.home_team}` },
            yesPrice: null, noPrice: null,
          });
          continue;
        } else {
          continue; // skip unrecognized market structure
        }

        // all cases handled above with continue — this is never reached
      }
    }
  }
  return bets;
}

// ─── Confidence Scoring Engine ─────────────────────────────────────────────────
/**
 * Multi-component confidence model inspired by the bracket engine approach.
 *
 * For PLAYER PROPS (primary focus) — 5-component model:
 *   C1. Market consensus strength (25%) — how far the implied prob is from 50/50
 *   C2. Source quality & cross-book agreement (20%) — is the line coming from sharp books?
 *   C3. Stat predictability class (25%) — how historically consistent is this exact prop type?
 *   C4. Sport sample-size & variance (15%) — NBA 82-game sample vs NFL 17-game high-variance
 *   C5. Vig & value edge (15%) — fair odds vs bookmaker juice
 *
 * For TEAM BETS (moneyline / spread / total):
 *   Uses a simplified version — heavily penalized vs player props.
 *
 * For SEASON PROPS / FUTURES:
 *   Separate scoring path — long-tail odds treated differently.
 *
 * Hard gates (must PASS ALL to reach 80+):
 *   - Implied prob must be ≥ 55% (or ≤ 40% for contrarian plays)
 *   - Odds must not be heavier than -250 (over-juiced = capped at 72)
 *   - Source must be tier-1 or tier-2
 *   - Stat type must have stability class ≥ B
 */
interface ScoreInput {
  impliedProb: number;
  source: string;
  betType: string;
  sport: string;
  title: string;
  odds?: number;
  line?: number | null;
  // ActionNetwork sharp money signals (when auth key is present)
  sharpMoneyPct?: number | null;   // % of money on this side ("sharp" bettors)
  publicTicketPct?: number | null; // % of tickets (public bettors) on this side
  // C6: Recent form data (from ESPN game log)
  recentAvg?: number | null;   // player's L5 game average for this stat
  formEdge?: number | null;    // (recentAvg - line) / line — positive = exceeds line
  formFlipped?: boolean;       // true if analytic side disagrees with market side
  // C7: Book line value (edge %) — added after edge analysis pass
  edgePctHint?: number | null;  // pre-computed edge % from multi-book comparison
  // ML priority signals
  statCategory?: string | null;      // e.g. "hits", "home_runs" — feeds per-stat ML weights
  linematePriority?: boolean;        // true = Props Hub (Linemate) confirmed this pick
}

interface ScoreResult {
  score: number;
  risk: "low" | "medium" | "high";
  allocation: number;
  factors: string[];
  summary: string;
}

// ── Stat predictability classes (A = most predictable → D = high variance) ──
// Based on historical regression-to-mean coefficients across NBA/NFL/MLB/NHL research.
// Higher class = more predictable = deserves a higher confidence boost.
type StatClass = "A" | "B" | "C" | "D";

function getStatClass(title: string, sport: string): { cls: StatClass; label: string } {
  const t = title.toLowerCase();

  // ── MLB (highest per-game sample, strong regression to mean) ──
  if (sport === "MLB") {
    if (t.includes("strikeout") || t.includes(" ks") || t.includes("k9")) return { cls: "A", label: "Pitcher strikeouts — most consistent MLB stat (r≈0.89 year-over-year)" };
    if (t.includes("hit") || t.includes("total base")) return { cls: "B", label: "Batting hits/total bases — strong regression to mean over large sample" };
    if (t.includes("home run")) return { cls: "C", label: "Home runs — predictable rate but high game-to-game variance" };
    if (t.includes("run") || t.includes("rbi")) return { cls: "C", label: "Runs/RBIs — lineup-dependent, moderate variance" };
    if (t.includes("out") || t.includes("inning")) return { cls: "B", label: "Pitcher outs — correlated with K-rate and game script" };
  }

  // ── NBA (82-game sample, role/usage highly predictable) ──
  if (sport === "NBA") {
    if (t.includes("point") || t.includes(" pts")) return { cls: "A", label: "NBA points — most stable, tied directly to usage rate & shot attempts" };
    if (t.includes("rebound") || t.includes(" reb")) return { cls: "A", label: "NBA rebounds — consistent per-minute rate, high regression to mean" };
    if (t.includes("assist") || t.includes(" ast")) return { cls: "A", label: "NBA assists — strongly tied to role and pace, very predictable" };
    if (t.includes("three") || t.includes("3pt") || t.includes("3-point")) return { cls: "B", label: "3-pointers — attempt rate consistent, made total has shooting variance" };
    if (t.includes("block") || t.includes(" blk")) return { cls: "B", label: "Blocks — correlated with matchup and rim-protection role" };
    if (t.includes("steal") || t.includes(" stl")) return { cls: "C", label: "Steals — low per-game counts, high variance on small totals" };
    if (t.includes("pts+reb") || t.includes("pts+ast") || t.includes("reb+ast") || t.includes("pra") || t.includes("pts+reb+ast")) return { cls: "A", label: "NBA combo prop — combined stat reduces single-category variance significantly" };
  }

  // ── NFL (high variance per game, but target share is predictable) ──
  if (sport === "NFL") {
    if (t.includes("reception") || t.includes("catch") || t.includes(" rec ")) return { cls: "B", label: "Receptions — target share and route participation rates are stable" };
    if (t.includes("receiving yard") || t.includes("rec yds")) return { cls: "B", label: "Receiving yards — driven by target share × yards-per-target" };
    if (t.includes("passing yard") || t.includes("pass yds")) return { cls: "B", label: "Passing yards — highly correlated with game script and team pace" };
    if (t.includes("rushing yard") || t.includes("rush yds")) return { cls: "C", label: "Rushing yards — snap share predictable but yards/carry has high variance" };
    if (t.includes("touchdown") || t.includes(" td")) return { cls: "D", label: "Touchdowns — binary, low-count outcome — highest per-play variance" };
    if (t.includes("interception") || t.includes(" int")) return { cls: "D", label: "Interceptions — very high variance, near-random per game" };
  }

  // ── NHL ──
  if (sport === "NHL") {
    if (t.includes("shot")) return { cls: "B", label: "Shots on goal — tied to ice time and power play role" };
    if (t.includes("goal") && !t.includes("goalie")) return { cls: "C", label: "Goals — shot rate predictable, shooting% has variance" };
    if (t.includes("assist") || t.includes("point")) return { cls: "B", label: "NHL points/assists — correlated with line placement and PP time" };
  }

  return { cls: "C", label: "Prop — moderate predictability" };
}

// ── Source tier ratings ──
// Tier 1 = sharpest, most liquid markets
// Tier 2 = reliable sportsbook lines
// Tier 3 = lower liquidity / aggregated
function getSourceTier(source: string): { tier: 1 | 2 | 3; label: string } {
  switch (source) {
    case "kalshi":         return { tier: 1, label: "Kalshi — regulated prediction market, sharp money is reflected in price" };
    case "polymarket":    return { tier: 1, label: "Polymarket — global prediction market, large-cap markets are highly efficient" };
    case "draftkings":    return { tier: 2, label: "DraftKings — major sportsbook, tight lines on high-volume markets" };
    case "sportsgameodds": return { tier: 1, label: "SportsGameOdds — multi-book consensus props, cross-book agreement = high conviction" };
    case "actionnetwork": return { tier: 2, label: "ActionNetwork — public betting consensus + sharp vs. square money flows" };
    case "underdog":      return { tier: 2, label: "Underdog Fantasy — real-money player prop lines" };
    default:              return { tier: 3, label: `${source} — supplemental data source` };
  }
}

// ─── Lotto prop detection ─────────────────────────────────────────────────────
// "Lotto" props are high-payout / low-implied-probability bets:
//   • Stat categories that are rare/event-based (HR, TD, Goal, Block, Stolen Base, etc.)
//   • AND implied probability < 40% (i.e. paying +150 or better)
// Lotto props: any player_prop the market prices at < 40% implied probability.
// At that threshold the payout is +150 or better — these are high-reward,
// lower-probability outcomes that form the "Lotto" bucket.
// The frontend enforces 5-min / 10-max per sport per day.
export function isLottoProp(title: string, impliedProb: number, betType?: string, sport?: string): boolean {
  if (betType && betType !== "player_prop") return false;
  if (impliedProb >= 0.40) return false; // must be +150 or better

  // Strict per-sport stat rules — only tag the specific lotto stat for each sport
  const t = title.toLowerCase();
  if (sport === "MLB") {
    return t.includes("home run") || t.includes("home_run") || t.includes("batter_home_runs");
  }
  if (sport === "NHL") {
    const hasGoal = t.includes("— goals") || t.includes("goals o/u") || t.includes("anytime goal") || /\bgoals\b/.test(t);
    const isCombo = t.includes("assists") || t.includes("shots") || t.includes("points") || t.includes("sog");
    return hasGoal && !isCombo;
  }
  if (sport === "NFL") {
    return t.includes("touchdown") || t.includes("anytime td") || t.includes("anytime_td") ||
           t.includes("1st td") || t.includes("1st_td") || t.includes("first td") || t.includes("to score");
  }
  if (sport === "NBA") {
    const hasPoints = t.includes("— points") || t.includes("points o/u") || /\bpoints\b/.test(t);
    const isCombo = t.includes("rebounds") || t.includes("assists") || t.includes("blocks") ||
                    t.includes("steals") || t.includes("threes") || t.includes("pra") ||
                    t.includes("pts+") || t.includes("pts &");
    return hasPoints && !isCombo;
  }
  // For any other sport, fall back to odds-only check
  return true;
}

function computeConfidenceRaw(input: ScoreInput): ScoreResult {
  const prob = Math.max(0.01, Math.min(0.99, input.impliedProb));
  const factors: string[] = [];
  const isPlayerProp = input.betType === "player_prop";
  const isSeasonProp = input.betType === "season_prop";

  // =========================================================================
  // HARD GATES — fail any of these and score is capped at 72
  // These prevent inflated scores on structurally weak bets.
  // =========================================================================
  let hardGateFailed = false;
  const hardGateReasons: string[] = [];

  // Gate 1: implied prob must have real edge — block only true coin-flip zone (48-52%)
  // Note: -115 juice = 53.5% implied, which is standard and should NOT be gated.
  // We only block the true toss-up band where there is genuinely no market edge.
  if (prob >= 0.48 && prob < 0.52) {
    hardGateFailed = true;
    hardGateReasons.push(`True coin-flip pricing (${Math.round(prob * 100)}% implied) — no identifiable edge`);
  }

  // Gate 2: no over-juiced favorites for player props
  if (isPlayerProp && input.odds !== undefined && input.odds < -280) {
    hardGateFailed = true;
    hardGateReasons.push(`Extreme juice (${input.odds}) — limited upside even if correct`);
  }

  // Gate 3: source must be tier 1 or 2 for high-confidence designation
  const { tier: sourceTier } = getSourceTier(input.source);
  if (sourceTier === 3) {
    hardGateFailed = true;
    hardGateReasons.push(`Low-tier source (${input.source}) — insufficient market depth`);
  }

  // =========================================================================
  // PLAYER PROP PATH — full 5-component model
  // =========================================================================
  if (isPlayerProp) {
    // ── C1: Market consensus strength (20% weight — tightened scale) ──
    // Harder calibration: prob thresholds raised, max reduced from 25→20
    // 53%=+3, 58%=+7, 63%=+11, 69%=+15, 75%=+20
    let c1 = 0;
    if (prob >= 0.78) {
      c1 = 20;
      factors.push(`Strong market consensus — ${Math.round(prob * 100)}% implied probability`);
    } else if (prob >= 0.72) {
      c1 = 16;
      factors.push(`High market confidence — ${Math.round(prob * 100)}% implied`);
    } else if (prob >= 0.65) {
      c1 = 12;
      factors.push(`Solid market edge — ${Math.round(prob * 100)}% implied probability`);
    } else if (prob >= 0.59) {
      c1 = 8;
      factors.push(`Moderate edge — ${Math.round(prob * 100)}% implied probability`);
    } else if (prob >= 0.54) {
      c1 = 4;
      factors.push(`Slight market lean — ${Math.round(prob * 100)}% implied (needs supporting signals)`);
    } else if (prob <= 0.32) {
      // Contrarian value: market under-pricing
      c1 = 8;
      factors.push(`Contrarian value — market at ${Math.round(prob * 100)}%, potential inefficiency`);
    } else if (prob <= 0.40) {
      c1 = 4;
      factors.push(`Mild contrarian angle — ${Math.round(prob * 100)}% market price`);
    }

    // ── C2: Source quality + cross-book agreement (16% weight — tightened, max 16→28 w/ sharp) ──
    let c2 = 0;
    const { tier, label: sourceLabel } = getSourceTier(input.source);
    if (tier === 1) { c2 = 16; factors.push(sourceLabel); }
    else if (tier === 2) { c2 = 10; factors.push(sourceLabel); }
    else { c2 = 3; factors.push(sourceLabel); }

    // Sharp money bonus (ActionNetwork signal — most powerful available)
    // Thresholds raised: need stronger divergence to earn the bonus
    if (input.sharpMoneyPct != null && input.publicTicketPct != null) {
      const sharpPct = input.sharpMoneyPct;
      const publicPct = input.publicTicketPct;
      const divergence = sharpPct - publicPct;
      if (sharpPct >= 75 && divergence >= 25) {
        c2 = Math.min(c2 + 12, 28);
        factors.push(`Sharp money signal: ${Math.round(sharpPct)}% of $ vs ${Math.round(publicPct)}% of tickets — professional consensus`);
      } else if (sharpPct >= 65 && divergence >= 18) {
        c2 = Math.min(c2 + 8, 24);
        factors.push(`Sharp money edge: ${Math.round(sharpPct)}% $ vs ${Math.round(publicPct)}% tickets — pros loading this side`);
      } else if (sharpPct >= 58 && divergence >= 12) {
        c2 = Math.min(c2 + 4, 20);
        factors.push(`Moderate sharp lean: ${Math.round(sharpPct)}% of $ vs ${Math.round(publicPct)}% public`);
      } else if (divergence < -15) {
        c2 = Math.max(c2 - 10, 0);
        factors.push(`Public-heavy action: ${Math.round(publicPct)}% tickets, only ${Math.round(sharpPct)}% money — square side`);
      }
    } else if (input.sharpMoneyPct != null) {
      if (input.sharpMoneyPct >= 68) { c2 = Math.min(c2 + 5, 21); factors.push(`${Math.round(input.sharpMoneyPct)}% of betting $ on this side`); }
      else if (input.sharpMoneyPct >= 58) { c2 = Math.min(c2 + 2, 18); factors.push(`${Math.round(input.sharpMoneyPct)}% money lean`); }
    }

    // ── C3: Stat predictability class (22% weight — B/C tightened) ──
    const { cls, label: statLabel } = getStatClass(input.title, input.sport);
    let c3 = 0;
    switch (cls) {
      case "A": c3 = 22; factors.push(statLabel); break;  // Elite predictability
      case "B": c3 = 14; factors.push(statLabel); break;  // Good (was 18)
      case "C": c3 = 7;  factors.push(statLabel); break;  // Moderate (was 10)
      case "D": c3 = 2;  factors.push(statLabel + " — high variance, use caution"); break;
    }

    // ── C4: Sport sample-size & variance penalty (13% weight — trimmed from 15) ──
    let c4 = 0;
    if (input.sport === "NBA") {
      c4 = 13;
      factors.push("NBA — 82-game sample, high predictability, stable role assignments");
    } else if (input.sport === "MLB") {
      c4 = 12;
      factors.push("MLB — 162-game sample, strongest regression to mean of all major sports");
    } else if (input.sport === "NFL") {
      c4 = 7;
      factors.push("NFL — 17-game season, game-script variance, weather/injury risk");
    } else if (input.sport === "NHL") {
      c4 = 8;
      factors.push("NHL — goalie variance + ice time fluctuation factored");
    } else if (input.sport === "NCAAB") {
      c4 = 6;
      factors.push("NCAAB — smaller sample + opponent quality variance");
    } else {
      c4 = 4;
    }

    // ── C5: Vig & value edge (12% weight — reduced from 15) ──
    let c5 = 0;
    if (input.odds !== undefined) {
      if (input.odds >= -112 && input.odds <= -105) {
        c5 = 12;
        factors.push(`Clean juice (${input.odds}) — minimal book overround, best value`);
      } else if (input.odds >= -128 && input.odds < -112) {
        c5 = 9;
        factors.push(`Reasonable juice (${input.odds}) — standard sportsbook pricing`);
      } else if (input.odds >= -160 && input.odds < -128) {
        c5 = 6;
        factors.push(`Moderate juice (${input.odds}) — slight book edge, still playable`);
      } else if (input.odds < -160 && input.odds >= -220) {
        c5 = 2;
        factors.push(`Heavy juice (${input.odds}) — book overround cuts into expected value`);
      } else if (input.odds < -220) {
        c5 = 0;
        factors.push(`Extreme juice (${input.odds}) — very limited upside relative to probability`);
      } else if (input.odds > 0) {
        // Underdog play
        c5 = input.odds <= 150 ? 10 : input.odds <= 250 ? 7 : 4;
        factors.push(`Plus-money prop (${input.odds > 0 ? "+" : ""}${input.odds}) — positive expected value if correct`);
      }
    } else {
      // No odds info — neutral
      c5 = 6;
    }

    // ── C6: Recent form vs line (up to ±12 pts bonus / -15 penalty — tightened) ──
    // Key player-specific signal: L5 average vs the posted line.
    // Max bonus reduced 15→12; conflict penalty deepened -12→-15.
    let c6 = 0;
    if (input.formEdge != null) {
      const edge6 = input.formEdge;
      const formPct = Math.round(Math.abs(edge6) * 100);
      if (input.formFlipped) {
        // Analytic side conflicts with market — penalize more aggressively
        if (Math.abs(edge6) >= 0.25) {
          c6 = -15;
          factors.push(`Form warning: L5 avg ${edge6 > 0 ? "exceeds" : "trails"} line by ${formPct}% — analytic side differs from market (heavy conflict)`);
        } else if (Math.abs(edge6) >= 0.15) {
          c6 = -8;
          factors.push(`Form caution: L5 avg ${edge6 > 0 ? "exceeds" : "trails"} line by ${formPct}% — mild conflict with market direction`);
        } else {
          c6 = -3;
          factors.push(`Slight form divergence — L5 trend weakly disagrees with picked direction`);
        }
      } else {
        // Form agrees with (or defers to) picked side
        if (edge6 >= 0.35) {
          c6 = 12;
          factors.push(`Strong recent form: L5 avg is ${formPct}% above line — player has been crushing this number`);
        } else if (edge6 >= 0.25) {
          c6 = 9;
          factors.push(`Good recent form: L5 avg is ${formPct}% above line — consistent performer vs this number`);
        } else if (edge6 >= 0.12) {
          c6 = 6;
          factors.push(`Positive recent trend: L5 avg is ${formPct}% above line`);
        } else if (edge6 <= -0.35) {
          c6 = 12;
          factors.push(`Cold streak confirmed: L5 avg is ${formPct}% below line — UNDER well-supported by recent form`);
        } else if (edge6 <= -0.25) {
          c6 = 9;
          factors.push(`Form supports UNDER: L5 avg trails line by ${formPct}%`);
        } else if (edge6 <= -0.12) {
          c6 = 6;
          factors.push(`Mild downtrend: L5 avg trails line by ${formPct}%`);
        } else {
          c6 = 3;
          if (input.recentAvg != null && input.line != null) {
            factors.push(`Recent form neutral: L5 avg ${input.recentAvg.toFixed(1)} vs line ${input.line} — within 12% band, market signal used`);
          }
        }
      }
    }
    // c6 range: -15 to +12

    // ── Raw composite score ──
    // C1(20) + C2(16→28) + C3(22) + C4(13) + C5(12) + C6(-15 to +12) = theoretical max ~107
    // Harder scale: must fire on nearly every component to reach 85+ threshold.
    const rawScore = c1 + c2 + c3 + c4 + c5 + c6;

    // ── Hard gate cap ──
    // Gate cap tightened: 72 → 66 so gated bets stay in the low-confidence tier
    const gateCap = hardGateFailed ? 66 : 97;
    if (hardGateFailed) {
      factors.push(...hardGateReasons);
    }

    // ── Noise: ±2 pts ──
    const noiseAdj = Math.random() * 4 - 2;
    const finalScore = Math.max(10, Math.min(gateCap, Math.round(rawScore + noiseAdj)));

    // Harder risk thresholds — "low" now requires 83+ (was 78)
    const risk: "low" | "medium" | "high" =
      finalScore >= 83 && prob > 0.57 ? "low" :
      finalScore >= 67 ? "medium" : "high";

    // Half-Kelly allocation — conservative
    const edge = prob - 0.5;
    const kelly = Math.max(0, edge / 0.5);
    const fractionalKelly = kelly * 0.20;
    const allocation = Math.min(4, parseFloat((fractionalKelly * 100).toFixed(1)));

    // Harder label thresholds — HIGH CONFIDENCE now requires 85 (was 80), Moderate 70 (was 65)
    const confidenceLevel = finalScore >= 85 ? "HIGH CONFIDENCE" : finalScore >= 70 ? "Moderate confidence" : "Low confidence";
    const formNote = input.recentAvg != null ? ` | L5 avg: ${input.recentAvg.toFixed(1)}` : "";
    const summary = `${confidenceLevel} — ${Math.round(prob * 100)}% implied | ${cls}-class stat | ${input.source.toUpperCase()}${formNote} | Score: ${finalScore}/100`;

    return { score: finalScore, risk, allocation, factors, summary };
  }

  // =========================================================================
  // SEASON PROP / FUTURES PATH
  // =========================================================================
  if (isSeasonProp) {
    let score = 40; // start lower — long-range futures have more uncertainty

    // Source quality
    const { tier, label: sourceLabel } = getSourceTier(input.source);
    score += tier === 1 ? 12 : tier === 2 ? 8 : 3;
    factors.push(sourceLabel);

    // Long-shot vs chalk — futures with high implied prob are higher confidence
    if (prob >= 0.50) { score += 20; factors.push(`Implied favorite (${Math.round(prob * 100)}%) — market rates this as most likely outcome`); }
    else if (prob >= 0.30) { score += 12; factors.push(`Moderate futures probability (${Math.round(prob * 100)}%)`); }
    else if (prob >= 0.15) { score += 6; factors.push(`Long-shot futures play (${Math.round(prob * 100)}%) — value hunting`); }
    else { score += 2; factors.push(`Speculative futures (${Math.round(prob * 100)}%) — low probability, high uncertainty`); }

    // Odds value
    if (input.odds !== undefined && input.odds > 200) {
      score += 5;
      factors.push(`Plus-money futures (+${input.odds}) — upside outweighs probability cost`);
    } else if (input.odds !== undefined && input.odds < -200) {
      score -= 5;
      factors.push(`Chalk futures (${input.odds}) — limited return on invested capital`);
    }

    // Sharp signals still apply
    if (input.sharpMoneyPct != null && (input.sharpMoneyPct ?? 0) >= 60) {
      score += 8;
      factors.push(`${Math.round(input.sharpMoneyPct ?? 0)}% of futures money on this side — sharp consensus`);
    }

    if (hardGateFailed) factors.push(...hardGateReasons);
    const cap = hardGateFailed ? 63 : 88; // tightened: 70→63 gate cap, 95→88 max
    const finalScore = Math.max(10, Math.min(cap, Math.round(score + (Math.random() * 4 - 2))));

    const risk: "low" | "medium" | "high" = finalScore >= 80 ? "low" : finalScore >= 63 ? "medium" : "high";
    const edge = Math.max(0, prob - 0.5);
    const allocation = Math.min(3, parseFloat(((edge * 0.15) * 100).toFixed(1)));
    const summary = `Futures — ${Math.round(prob * 100)}% implied | ${input.source.toUpperCase()} | Score: ${finalScore}/100`;
    return { score: finalScore, risk, allocation, factors, summary };
  }

  // =========================================================================
  // TEAM BET PATH (moneyline / spread / total)
  // Structurally less predictable than player props — scored more conservatively.
  // =========================================================================
  let score = 40;

  // Market edge
  if (prob >= 0.72) { score += 15; factors.push(`Strong favorite (${Math.round(prob * 100)}% implied)`); }
  else if (prob >= 0.62) { score += 9; factors.push(`Solid edge (${Math.round(prob * 100)}% implied)`); }
  else if (prob >= 0.55) { score += 4; factors.push(`Moderate edge (${Math.round(prob * 100)}%)`); }
  else if (prob < 0.40) { score += 7; factors.push(`Contrarian angle (${Math.round(prob * 100)}% market price)`); }
  else { score -= 5; factors.push(`Near coin-flip (${Math.round(prob * 100)}%) — low conviction`); }

  // Source
  const { tier: sTier, label: sLabel } = getSourceTier(input.source);
  score += sTier === 1 ? 8 : sTier === 2 ? 5 : 2;
  factors.push(sLabel);

  // Bet type
  if (input.betType === "spread") { score += 2; factors.push("Spread — covers game script and injury effects"); }
  else if (input.betType === "total") { score += 1; factors.push("Total — game-script dependent, consider weather/pace"); }
  else { score += 0; factors.push("Moneyline — binary outcome, favored team still loses ~30% of the time"); }

  // Sport variance
  if (input.sport === "NBA") { score += 5; factors.push("NBA — highest scoring, spreads are most predictable team bet"); }
  else if (input.sport === "MLB") { score += 3; factors.push("MLB — pitching matchup is key, large variance per game"); }
  else if (input.sport === "NFL") { score += 2; factors.push("NFL — any given Sunday effect, line movement is the signal"); }
  else if (input.sport === "NHL") { score += 1; factors.push("NHL — goalie is the largest variance factor"); }

  // Odds check
  if (input.odds !== undefined) {
    if (input.odds < 0 && input.odds > -130) { score += 4; factors.push("Reasonable juice — not over-priced"); }
    else if (input.odds < -250) { score -= 8; factors.push("Heavy favorite — limited expected value"); }
    else if (input.odds > 200) { score -= 2; factors.push("Long shot — statistically unlikely"); }
  }

  // Sharp signal
  if (input.sharpMoneyPct != null && input.publicTicketPct != null) {
    const div = input.sharpMoneyPct - input.publicTicketPct;
    if (input.sharpMoneyPct >= 65 && div >= 15) { score += 10; factors.push(`Sharp money signal: ${Math.round(input.sharpMoneyPct)}% $ vs ${Math.round(input.publicTicketPct)}% tickets`); }
    else if (input.sharpMoneyPct >= 55 && div >= 10) { score += 5; factors.push(`Moderate sharp lean: ${Math.round(input.sharpMoneyPct)}% of $ on this side`); }
    else if (div < -15) { score -= 5; factors.push(`Public-heavy side: ${Math.round(input.publicTicketPct ?? 0)}% tickets, limited sharp support`); }
  }

  if (hardGateFailed) factors.push(...hardGateReasons);
  const cap = hardGateFailed ? 62 : 82; // tightened: gate 68→62, max 88→82
  const finalScore = Math.max(10, Math.min(cap, Math.round(score + (Math.random() * 6 - 3))));

  // Harder risk/label thresholds for team bets
  const risk: "low" | "medium" | "high" = finalScore >= 79 && prob > 0.57 ? "low" : finalScore >= 64 ? "medium" : "high";
  const edge2 = prob - (1 - prob) * 0.05;
  const kelly2 = Math.max(0, edge2 / 0.95);
  const allocation = Math.min(3, parseFloat((kelly2 * 0.20 * 100).toFixed(1)));
  const confidenceLevel = finalScore >= 85 ? "HIGH CONFIDENCE" : finalScore >= 70 ? "Moderate" : "Low confidence";
  const summary = `${confidenceLevel} — ${Math.round(prob * 100)}% implied | ${input.betType} | ${input.source.toUpperCase()} | Score: ${finalScore}/100`;
  return { score: finalScore, risk, allocation, factors, summary };
}

function generateSummary(input: ScoreInput, score: number, prob: number, factors: string[]): string {
  const confidence = score >= 80 ? "HIGH CONFIDENCE" : score >= 65 ? "Moderate confidence" : "Low confidence";
  const probPct = Math.round(prob * 100);
  return `${confidence} pick from ${input.source.toUpperCase()} — market prices this at ${probPct}% probability. ${factors[0] ?? ""}. Score: ${score}/100.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function detectSport(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("nfl") || t.includes("football") || t.includes("qb") || t.includes("touchdown") || t.includes("rushing") || t.includes("passing")) return "NFL";
  if (t.includes("nba") || t.includes("basketball") || t.includes("points") || t.includes("rebounds") || t.includes("assists")) return "NBA";
  // WBC must be checked before generic MLB since WBC titles don't say "mlb"
  if (t.includes("world baseball classic") || t.includes("wbc") || t.includes("kxwbc")) return "MLB";
  if (t.includes("mlb") || t.includes("baseball") || t.includes("strikeout") || t.includes("innings") || t.includes("hits") || t.includes("runs")) return "MLB";
  if (t.includes("nhl") || t.includes("hockey") || t.includes("goals") || t.includes("puck")) return "NHL";
  return "Other";
}

function detectBetType(text: string): string {
  const t = text.toLowerCase();
  // Season-long awards and futures
  if (t.includes("win mvp") || t.includes("wins mvp") || t.includes("win al mvp") || t.includes("win nl mvp") || t.includes("win nba mvp") || t.includes("win nfl mvp") || t.includes("win the mvp") || t.includes("win world baseball classic mvp") || t.includes("cy young") || t.includes("rookie of the year") || t.includes("wins award") || t.includes("world series") || t.includes("championship winner")) return "season_prop";
  if (t.includes("over") || t.includes("under") || t.includes("more than") || t.includes("less than") || t.includes("yds") || t.includes("prop")) return "player_prop";
  if (t.includes("cover") || t.includes("spread") || t.includes("wins by over") || t.match(/[-+]\d+\.5/)) return "spread";
  if (t.includes("total") || t.includes("total runs") || t.includes("o/u")) return "total";
  return "moneyline";
}

function mapSportKey(key: string): string {
  const map: Record<string, string> = {
    americanfootball_nfl: "NFL",
    basketball_nba: "NBA",
    baseball_mlb: "MLB",
    icehockey_nhl: "NHL",
    mma_mixed_martial_arts: "MMA",
    boxing_boxing: "Boxing",
    basketball_ncaab: "NCAAB",
    americanfootball_ncaaf: "NCAAF",
    // Season futures — mapped to sport group
    baseball_mlb_world_series_winner: "MLB",
    basketball_nba_championship_winner: "NBA",
    basketball_ncaab_championship_winner: "NCAAB",
    icehockey_nhl_championship_winner: "NHL",
    golf_masters_tournament_winner: "Golf",
    golf_pga_championship_winner: "Golf",
    golf_the_open_championship_winner: "Golf",
    golf_us_open_winner: "Golf",
  };
  return map[key] ?? "Other";
}

function mapMarketType(key: string): string {
  if (key === "h2h") return "moneyline";
  if (key === "spreads") return "spread";
  if (key === "totals") return "total";
  if (key?.startsWith("player_") || key?.startsWith("batter_")) return "player_prop";
  return "moneyline";
}

function americanToImplied(odds: number): number {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

// ─── Staleness filter ─────────────────────────────────────────────────────────
// Drop any market whose close/game time is already in the past.
function filterStale(bets: InsertBet[]): InsertBet[] {
  const now = Date.now();
  const GRACE_MS = 4 * 60 * 60 * 1000; // 4-hour grace — keep in-progress/live game props
  return bets.filter((b) => {
    if (!b.gameTime) return true; // no time info — keep (e.g. futures)
    // Keep if game starts in future OR started within the last 4 hours (live/in-progress)
    return new Date(b.gameTime).getTime() > now - GRACE_MS;
  });
}

// ─── SportsGameOdds API — cross-book player prop odds ─────────────────────
// Key: 8befbaf9705fc690a79e0b6ebeff6d8f
// Free tier: leagueID or eventID required. Provides multi-book player props
// for NBA, MLB, NHL, NFL with bookOverUnder lines and bookOdds.

const SGO_KEY = process.env.SGO_API_KEY ?? "8befbaf9705fc690a79e0b6ebeff6d8f";
const SGO_BASE = "https://api.sportsgameodds.com/v2";

// Map of leagueID → array of stat IDs to fetch player props for
const SGO_LEAGUE_STATS: Record<string, string[]> = {
  NBA: ["points", "rebounds", "assists", "blocks", "steals", "threePointersMade", "points+rebounds+assists"],
  MLB: ["pitching_strikeouts", "batting_hits", "batting_totalBases", "batting_homeRuns", "pitching_outs"],
  NHL: ["shots", "goals+assists", "shots_onGoal", "points"],
  NFL: ["passing_yards", "rushing_yards", "receiving_yards", "passing_touchdowns", "receptions"],
};

const SGO_SPORT_MAP: Record<string, string> = {
  NBA: "NBA",
  MLB: "MLB",
  NHL: "NHL",
  NFL: "NFL",
  NCAAB: "NCAAB",
};

async function fetchSportsGameOddsProps(enabledSports?: string[]): Promise<InsertBet[]> {
  if (!SGO_KEY) return [];

  const bets: InsertBet[] = [];
  const statDisplayMap: Record<string, string> = {
    points: "Points", rebounds: "Rebounds", assists: "Assists",
    blocks: "Blocks", steals: "Steals", threePointersMade: "3-Pointers Made",
    "points+rebounds+assists": "Pts+Reb+Ast",
    pitching_strikeouts: "Strikeouts", batting_hits: "Hits",
    batting_totalBases: "Total Bases", batting_homeRuns: "Home Runs",
    pitching_outs: "Outs Recorded",
    shots: "Shots", "goals+assists": "Goals+Assists",
    shots_onGoal: "Shots on Goal",
    passing_yards: "Passing Yards", rushing_yards: "Rushing Yards",
    receiving_yards: "Receiving Yards", passing_touchdowns: "Pass TDs",
    receptions: "Receptions",
  };

  const toProb = (odds: number) =>
    odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);

  // Filter leagues by enabled sports (respects optional sport toggles)
  const activeLeagues = Object.entries(SGO_LEAGUE_STATS).filter(([leagueID]) => {
    if (!enabledSports) return true; // no filter = all leagues
    const sport = SGO_SPORT_MAP[leagueID] ?? leagueID;
    return enabledSports.includes(sport);
  });

  for (const [leagueID, stats] of activeLeagues) {
    for (const statID of stats) {
      const oddID = `${statID}-PLAYER_ID-game-ou-over`;
      try {
        const url = `${SGO_BASE}/events?leagueID=${leagueID}&oddID=${encodeURIComponent(oddID)}&ended=false&cancelled=false&includeOpposingOdds=true&apiKey=${SGO_KEY}`;
        const { data } = await axios.get(url, { timeout: 15000 });
        if (!data.success || !Array.isArray(data.data)) continue;

        const events: any[] = data.data;
        for (const ev of events) {
          const homeTeam = ev.teams?.home?.names?.medium ?? "";
          const awayTeam = ev.teams?.away?.names?.medium ?? "";
          const gameTitle = awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : "";
          const startTime = ev.startTime ? new Date(ev.startTime) : null;
          const odds = ev.odds ?? {};

          // Extract player names from players array
          const playerMap: Record<string, string> = {};
          if (Array.isArray(ev.players)) {
            for (const p of ev.players) {
              if (p.playerID && p.firstName && p.lastName) {
                playerMap[p.playerID] = `${p.firstName} ${p.lastName}`;
              } else if (p.playerID && p.name) {
                playerMap[p.playerID] = p.name;
              }
            }
          }

          // Process each over/under prop pair
          for (const [oddKey, overOdd] of Object.entries(odds) as [string, any][]) {
            if (!oddKey.endsWith("-over")) continue;
            if (overOdd.ended || overOdd.cancelled) continue;

            const playerID = overOdd.playerID ?? overOdd.statEntityID;
            if (!playerID || playerID === "PLAYER_ID") continue;

            // Get bookmaker odds
            const overOddsRaw = overOdd.bookOdds ?? overOdd.fairOdds;
            const line = overOdd.bookOverUnder ?? overOdd.fairOverUnder;
            if (!overOddsRaw || !line) continue;

            // Get corresponding under odd
            const underKey = oddKey.replace("-over", "-under");
            const underOdd = odds[underKey];
            const underOddsRaw = underOdd?.bookOdds ?? underOdd?.fairOdds ?? overOddsRaw;

            const overOddsNum = parseInt(overOddsRaw);
            const underOddsNum = parseInt(underOddsRaw);
            const lineNum = parseFloat(line);
            if (isNaN(overOddsNum) || isNaN(lineNum)) continue;

            const overProb = toProb(overOddsNum);
            const underProb = toProb(underOddsNum);

            // Market-implied pick side
            const marketPickSideSGO = overProb >= underProb ? "OVER" : "UNDER";

            // Get player name early so we can fetch form data
            const playerName = playerMap[playerID] ??
              playerID.replace(/_NBA|_MLB|_NHL|_NFL/g, "").replace(/_\d+$/g, "").replace(/_/g, " ");

            const statName = statDisplayMap[statID] ?? statID;
            const sport = SGO_SPORT_MAP[leagueID] ?? leagueID;

            // ── Fetch recent form data from ESPN + cross-validate ──
            const statIDLower = statID.toLowerCase();
            const comboKeysSGO = COMBO_STAT_MAP[sport]?.[statIDLower];

            // Step 1: Fetch cached avg
            const cachedAvgSGO = comboKeysSGO
              ? await fetchComboStatAvg(playerName, sport, comboKeysSGO)
              : await fetchRecentStatAvg(playerName, sport, statIDLower);

            // Step 2: Cross-validate per-game and detect divergence
            const { validatedAvg: validatedAvgSGO, perGameValues: pgvSGO, hitRate: hitRateSGO, diverged: divergedSGO } =
              await crossValidateRecentAvg(
                playerName, sport,
                comboKeysSGO ?? null,
                comboKeysSGO ? null : statIDLower,
                lineNum, cachedAvgSGO
              );
            const recentAvgSGO = validatedAvgSGO;
            const formEdgeSGO = computeFormEdge(recentAvgSGO, lineNum);

            // Step 3: Analytically-chosen pick side with hit-rate safety check
            const isLottoStatSGO =
              (sport === "NHL" && statIDLower === "goals") ||
              (sport === "MLB" && statIDLower === "home_runs") ||
              (sport === "NFL" && statIDLower === "touchdowns") ||
              (sport === "NBA" && statIDLower === "points");

            const { pickSide, formFlipped: formFlippedSGO, safetyOverride: safetyOverrideSGO, safetyNote: safetyNoteSGO } =
              analyticalPickSide(marketPickSideSGO, formEdgeSGO, isLottoStatSGO, hitRateSGO);
            const pickedOdds = pickSide === "OVER" ? overOddsNum : underOddsNum;
            const pickProb = pickSide === "OVER" ? overProb : underProb;

            // Only include picks with meaningful edge (≥52%)
            const sgoEdgeThreshold = (formFlippedSGO && !safetyOverrideSGO) ? 0.50 : 0.52;
            if (Math.max(overProb, underProb) < sgoEdgeThreshold) continue;

            const formLabelSGO = recentAvgSGO != null
              ? ` (L5 avg: ${recentAvgSGO.toFixed(1)}${divergedSGO ? " ⚠️ corrected" : ""})`
              : "";
            const oddsStr = pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`;
            const title = `[TAKE ${pickSide} ${lineNum} @ ${oddsStr}] ${playerName} — ${statName}`;
            const description = `${playerName} is projected to go ${pickSide} ${lineNum} ${statName}${formLabelSGO}. ${sport} player prop from SportsGameOdds (multi-book consensus).`;

            const extraFactorsSGO: string[] = [];
            if (divergedSGO) extraFactorsSGO.push(`⚠️ Stat data corrected: cached avg was mismatched — using per-game cross-validated value (${recentAvgSGO?.toFixed(1)})`);
            if (safetyNoteSGO) extraFactorsSGO.push(`⚠️ ${safetyNoteSGO}`);
            if (hitRateSGO !== null && pgvSGO.length >= 3) {
              const overHitsSGO = Math.round(hitRateSGO * pgvSGO.length);
              const underHitsSGO = pgvSGO.length - overHitsSGO;
              const dirSGO = pickSide === "OVER" ? "OVER" : "UNDER";
              const hitsSGO = pickSide === "OVER" ? overHitsSGO : underHitsSGO;
              extraFactorsSGO.push(`Hit rate check: ${hitsSGO}/${pgvSGO.length} recent games went ${dirSGO} ${lineNum}`);
            }

            const confidence = computeConfidence({
              impliedProb: pickProb,
              source: "sportsgameodds",
              betType: "player_prop",
              sport,
              title,
              odds: pickedOdds,
              line: lineNum,
              recentAvg: recentAvgSGO,
              formEdge: formEdgeSGO,
              formFlipped: formFlippedSGO && !safetyOverrideSGO,
            });

            const id = `sgo_${ev.eventID}_${playerID}_${statID}`;

            bets.push({
              id,
              title,
              description,
              sport,
              betType: "player_prop",
              source: "sportsgameodds",
              overOdds: overOddsNum,
              underOdds: underOddsNum,
              impliedProbability: pickProb,
              confidenceScore: confidence.score,
              riskLevel: confidence.risk,
              recommendedAllocation: confidence.allocation,
              keyFactors: [`${pickSide} ${lineNum} ${statName} (SGO multi-book)`, ...extraFactorsSGO, ...confidence.factors],
              researchSummary: confidence.summary,
              gameTime: startTime,
              playerName,
              isHighConfidence: confidence.score >= 85,
              // ── Stat-vs-line edge (TikTok model) ────────────────────────────────────────
              recentAvg:     recentAvgSGO ?? null,
              formEdgePct:   formEdgeSGO != null ? Math.round(formEdgeSGO * 1000) / 10 : null,
              hitRate:       hitRateSGO ?? null,
              hitRateGames:  pgvSGO.length > 0 ? pgvSGO.length : null,
              perGameValues: pgvSGO.slice(-6),
              statName:      statName ?? null,
              teamStats: {
                pickSide,
                pickedOdds,
                overProb: Math.round(overProb * 100),
                underProb: Math.round(underProb * 100),
                playerName,
                statType: statName,
                statRaw: statIDLower,   // raw SGO stat key e.g. "pts_rebs_asts"
                statValue: lineNum,
                gameTitle,
              },
              homeTeam,
              awayTeam,
              line: lineNum,
              yesPrice: null,
              noPrice: null,
              playerStats: null,
              notificationSent: false,
            });
          }
        }
      } catch (e: any) {
        console.warn(`[SGO] Error fetching ${leagueID} ${statID}:`, e.message);
      }
    }
  }

  // Deduplicate: if same player+stat+game already exists from Underdog, SGO adds value
  // but don't duplicate — keep SGO as supplement for lines not in Underdog
  console.log(`[SportsGameOdds] Fetched ${bets.length} player prop picks across all leagues`);
  return bets;
}


// ─── Linemate MLB Player Props (primary source when Odds API unavailable) ─────
// Fetches allowed MLB player prop markets from Linemate's free public API.
// Allowed: Hits, HR, Runs, RBIs, Total Bases, Singles, Doubles, Stolen Bases (OVER only),
//          Pitcher Strikeouts, Pitcher Outs, Pitcher Hits Allowed, Pitcher Earned Runs, Pitcher Walks
// Banned: Triples, H+R+RBI combos
// Returns full bet cards with DraftKings/FanDuel/BetMGM lines + hit rate history.
const LINEMATE_MARKET_MAP: Record<string, { statType: string; label: string }> = {
  HITTER_HITS:                   { statType: "hits",          label: "Hits" },
  HITTER_HOME_RUNS:              { statType: "home runs",     label: "Home Runs" },
  HITTER_RUNS:                   { statType: "runs scored",   label: "Runs Scored" },
  HITTER_RUNS_BATTED_IN:         { statType: "rbis",          label: "RBIs" },
  HITTER_TOTAL_BASES:            { statType: "total bases",   label: "Total Bases" },
  HITTER_STOLEN_BASES:           { statType: "stolen bases",  label: "Stolen Bases" },
  HITTER_SINGLES:                { statType: "singles",       label: "Singles" },
  HITTER_DOUBLES:                { statType: "doubles",       label: "Doubles" },
  PITCHER_STRIKEOUTS:            { statType: "strikeouts",    label: "Strikeouts" },
  PITCHER_EARNED_RUNS:           { statType: "earned runs",   label: "Earned Runs" },
  PITCHER_HITS_ALLOWED:          { statType: "hits allowed",  label: "Hits Allowed" },
  PITCHER_WALKS_ALLOWED:         { statType: "walks",         label: "Walks" },
  PITCHER_OUTS:                  { statType: "outs",          label: "Pitcher Outs" },
};
// US-facing books in priority order
const LM_US_BOOKS = ["draftkings", "fanduel", "betmgm", "fanatics", "caesars", "bet365"];

async function fetchLinemateMLBProps(): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  try {
    const LINEMATE_HEADERS = {
      "Origin":     "https://linemate.io",
      "Referer":    "https://linemate.io/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":     "application/json",
    };
    const { data } = await axios.get(
      "https://api.linemate.io/api/mlb/v2/markets?levelsToInclude=player",
      { headers: LINEMATE_HEADERS, timeout: 20000 }
    );
    const markets: any[] = Array.isArray(data) ? data : (data?.markets ?? data?.data?.markets ?? []);
    if (!markets.length) {
      console.log("[Linemate/MLB] No markets returned");
      return bets;
    }

    const seen = new Set<string>();
    let parsed = 0, skipped = 0;

    for (const mkt of markets) {
      const marketName: string = mkt.name ?? "";
      const mapping = LINEMATE_MARKET_MAP[marketName];
      if (!mapping) { skipped++; continue; }

      // Stolen Bases: only show OVER picks — UNDER is not useful for display
      // (we still need to compute the side first, so we defer this check to after side calc)
      // Triples and H+R+RBI are removed from LINEMATE_MARKET_MAP entirely — no further check needed

      // Player info
      const player = mkt.player ?? {};
      const playerName: string = player.fullName ?? `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();
      if (!playerName) { skipped++; continue; }

      const team    = mkt.team ?? {};
      const opp     = mkt.opposingTeam ?? {};
      const teamCode = team.code ?? team.name ?? "";
      const oppCode  = opp.code ?? opp.name ?? "";
      const isHome: boolean = mkt.isHome ?? false;
      const homeTeam = isHome ? teamCode : oppCode;
      const awayTeam = isHome ? oppCode : teamCode;
      const gameId: string = mkt.gameId ?? `${awayTeam}-${homeTeam}`;
      const batterHand: "L" | "R" | null = player.battingHand === "Right" ? "R" : player.battingHand === "Left" ? "L" : null;

      // Find best US book line — prefer DraftKings, fallback down list
      let bestBook = "";
      let overLine: number | null = null;
      let overOdds: number | null = null;
      let underOdds: number | null = null;
      const books: Record<string, any> = mkt.books ?? {};
      for (const book of LM_US_BOOKS) {
        const bk = books[book];
        if (!bk) continue;
        const ov = bk.over?.current;
        if (ov?.value != null) {
          bestBook = book;
          overLine = ov.value;
          overOdds = ov.odds?.american ?? null;
          underOdds = bk.under?.current?.odds?.american ?? null;
          break;
        }
      }
      // If no US book, try any book
      if (overLine === null) {
        for (const [book, bk] of Object.entries(books)) {
          const ov = (bk as any).over?.current;
          if (ov?.value != null) {
            bestBook = book;
            overLine = ov.value;
            overOdds = ov.odds?.american ?? null;
            underOdds = (bk as any).under?.current?.odds?.american ?? null;
            break;
          }
        }
      }
      if (overLine === null) { skipped++; continue; }

      // Deduplicate: one card per player+stat
      const dedupeKey = `lm-mlb-${playerName}-${mapping.statType}-${gameId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Hit rate — find records for the overLine threshold
      const hitRecords: Record<string, any> = mkt.pregameHitRecords ?? {};
      const lineKey = String(overLine);
      const nearKey = Object.keys(hitRecords).find(k => Math.abs(parseFloat(k) - overLine!) <= 0.5) ?? null;
      const rec = hitRecords[lineKey] ?? (nearKey ? hitRecords[nearKey] : null);
      const hitRateL5  = rec?.LAST_5?.all?.hitRate  != null ? rec.LAST_5.all.hitRate / 100  : null;
      const hitRateL10 = rec?.LAST_10?.all?.hitRate != null ? rec.LAST_10.all.hitRate / 100 : null;
      const hitRateL20 = rec?.LAST_20?.all?.hitRate != null ? rec.LAST_20.all.hitRate / 100 : null;

      // Compute implied prob + pick side
      const overProb  = overOdds  != null ? americanToImplied(overOdds)  : 0.5;
      const underProb = underOdds != null ? americanToImplied(underOdds) : 1 - overProb;
      const side = overProb >= underProb ? "over" : "under";
      const pickedProb = side === "over" ? overProb : underProb;
      const pickedOdds = side === "over" ? overOdds : underOdds;
      const oddsDisplay = pickedOdds != null ? (pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`) : "";

      // Stolen Bases + Home Runs: only display OVER picks
      if ((marketName === "HITTER_STOLEN_BASES" || marketName === "HITTER_HOME_RUNS") && side !== "over") { skipped++; continue; }

      // Form edge: hit rate vs 50% baseline
      const formEdge = hitRateL5 != null ? hitRateL5 - 0.5 : null;

      const title = `[TAKE ${side.toUpperCase()}${overLine != null ? ` ${overLine}` : ""}${oddsDisplay ? ` @ ${oddsDisplay}` : ""}] ${playerName} — ${mapping.label}`;
      const gameTitle = `${awayTeam} @ ${homeTeam}`;

      const scoreInput: ScoreInput = {
        impliedProb:     pickedProb,
        source:          bestBook || "linemate",
        betType:         "player_prop",
        sport:           "MLB",
        title,
        odds:            pickedOdds ?? undefined,
        line:            overLine,
        formEdge:        formEdge,
        formFlipped:     false,
        recentAvg:       hitRateL5 != null ? overLine * (0.5 + hitRateL5) : null,
        statCategory:    mapping.statType,
        linematePriority: true,  // always true — this IS the Linemate source
      };
      const score = computeConfidence(scoreInput);

      // Build allSources from all US books that have this line
      const allSources: any[] = [];
      for (const book of LM_US_BOOKS) {
        const bk = books[book];
        const ov = bk?.over?.current;
        if (!ov?.value) continue;
        allSources.push({
          source:      book,
          line:        ov.value,
          overOdds:    ov.odds?.american ?? null,
          underOdds:   bk?.under?.current?.odds?.american ?? null,
          impliedProb: ov.odds?.american != null ? americanToImplied(ov.odds.american) : null,
          pickSide:    side.toUpperCase(),
        });
      }
      if (!allSources.length) {
        allSources.push({ source: bestBook || "linemate", line: overLine, overOdds, underOdds, pickSide: side.toUpperCase() });
      }

      const keyFactors: string[] = [];
      if (hitRateL5  != null) keyFactors.push(`L5 hit rate: ${Math.round(hitRateL5 * 100)}% vs ${overLine} line`);
      if (hitRateL10 != null) keyFactors.push(`L10 hit rate: ${Math.round(hitRateL10 * 100)}%`);
      if (allSources.length >= 2) keyFactors.push(`${allSources.length} books agree on line ${overLine}`);
      keyFactors.push(...(score.factors ?? []));

      bets.push({
        id:                 dedupeKey,
        source:             "linemate",
        sport:              "MLB",
        betType:            "player_prop",
        title,
        description:        `${gameTitle} · ${mapping.label} O/U ${overLine}`,
        line:               overLine,
        overOdds:           overOdds ?? null,
        underOdds:          underOdds ?? null,
        impliedProbability: pickedProb,
        confidenceScore:    score.score,
        riskLevel:          score.risk,
        recommendedAllocation: score.allocation,
        keyFactors:         keyFactors.slice(0, 8),
        researchSummary:    score.summary,
        isHighConfidence:   score.score >= 85,
        status:             "open",
        homeTeam:           homeTeam || null,
        awayTeam:           awayTeam || null,
        playerName,
        gameTime:           null, // ESPN scoreboard enriches this
        notificationSent:   false,
        playerStats:        null,
        teamStats: {
          pickSide:        side.toUpperCase(),
          pickedOdds:      pickedOdds ?? null,
          overProb:        Math.round(overProb * 100),
          underProb:       Math.round(underProb * 100),
          playerName,
          statType:        mapping.statType,
          statValue:       overLine,
          gameTitle,
          lmHitRateL5:     hitRateL5,
          lmHitRateL10:    hitRateL10,
          lmConsensusLine: overLine,
          linematePriority: true,
          batterHand,
        },
        allSources,
        yesPrice: null,
        noPrice:  null,
      });
      parsed++;
    }
    console.log(`[Linemate/MLB] Parsed ${parsed} props, skipped ${skipped} (${markets.length} total markets)`);
  } catch (e: any) {
    console.warn(`[Linemate/MLB] Fetch failed: ${e.message}`);
  }
  return bets;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────
function computeConfidence(input: ScoreInput): ScoreResult {
  const result = computeConfidenceRaw(input);
  // Apply ML weight nudge — MLB gets lower sample threshold + higher multiplier
  const mlScore = applyMLWeights(result.score, {
    sport:            input.sport,
    betType:          input.betType,
    formEdgePct:      typeof input.formEdge === "number" ? input.formEdge * 100 : undefined,
    hitRate:          undefined,
    statCategory:     input.statCategory ?? undefined,
    linematePriority: input.linematePriority ?? false,
  });
  return { ...result, score: mlScore };
}

export async function runScan(apiKey?: string | null): Promise<{ scanned: number; highConfidence: number }> {
  console.log("Running market scan...");
  const results: InsertBet[] = [];

  // Load settings first so we can pass sport preferences to the scanner
  const settings = await storage.getSettings();

  // Build combined enabled sports list (core + optional)
  const allEnabledSports = [
    ...(settings.enabledSports ?? ["NFL", "NBA", "MLB", "NHL"]),
    ...(settings.enabledOptionalSports ?? []),
  ];

  // Fetch all live sources in parallel
  // Underdog and SportsGameOdds provide NHL/MLB/NFL player props (Kalshi only has NBA active)
  const [kalshi, kalshiWBC, kalshiAwards, kalshiProps, poly, actionNet, underdogProps, sgoProps, linemateMlbProps] = await Promise.all([
    fetchKalshiSports(),
    fetchKalshiWBC(),
    fetchKalshiSeasonAwards(),
    fetchKalshiPlayerProps(),
    fetchPolymarketSports(),
    fetchActionNetwork(),
    fetchUnderdogProps(allEnabledSports),
    fetchSportsGameOddsProps(allEnabledSports),
    allEnabledSports.includes("MLB") ? fetchLinemateMLBProps() : Promise.resolve([]),
  ]);

  // Merge all Kalshi results, deduplicating by ID
  const kalshiAll = [...kalshi];
  const kalshiIds = new Set(kalshiAll.map(b => b.id));
  for (const b of [...kalshiWBC, ...kalshiAwards, ...kalshiProps]) {
    if (!kalshiIds.has(b.id)) {
      kalshiAll.push(b);
      kalshiIds.add(b.id);
    }
  }

  results.push(...kalshiAll, ...poly, ...actionNet);
  console.log(`Kalshi sources: ${kalshi.length} generic + ${kalshiWBC.length} WBC + ${kalshiAwards.length} season awards + ${kalshiProps.length} player props = ${kalshiAll.length} unique`);
  console.log(`Linemate MLB props fetched: ${linemateMlbProps.length}`);
  console.log(`Underdog player props fetched: ${underdogProps.length}`);

  // ── Multi-source player prop aggregation ──────────────────────────────────
  // Goal: one bet card per player+sport, showing all sources that price the same prop.
  // Priority: Kalshi > Underdog > DraftKings (by pricing reliability)
  // For each player prop from Underdog:
  //   • If Kalshi already has a prop for this player+sport → attach Underdog odds to
  //     the Kalshi bet's allSources array (don't add a separate card)
  //   • Otherwise → add as primary card (Underdog line is the canonical line)
  // Same logic applies to DraftKings props pulled later via Odds API.
  //
  // allSources shape: [{ source, overOdds, underOdds, line, impliedProb, pickSide }]

  // Index all existing player props by playerName::sport::statType
  // Use statType in key so e.g. Goals don't get swallowed into Assists/Shots cards
  function getStatTypeKey(bet: InsertBet): string {
    const ts = bet.teamStats as { statType?: string } | null;
    const stat = (ts?.statType ?? "").toLowerCase().trim();
    return stat || "prop";
  }
  const propByPlayerSport = new Map<string, InsertBet>();
  for (const b of results) {
    if (b.betType === "player_prop" && b.playerName) {
      const key = `${b.playerName}::${b.sport}::${getStatTypeKey(b)}`;
      if (!propByPlayerSport.has(key)) propByPlayerSport.set(key, b);
    }
  }

  // Seed allSources on existing primary bets from their own source
  for (const b of propByPlayerSport.values()) {
    if (!b.allSources) {
      const ts = b.teamStats as { pickSide?: string } | null;
      b.allSources = [{
        source: b.source,
        overOdds: b.overOdds ?? undefined,
        underOdds: b.underOdds ?? undefined,
        line: b.line ?? undefined,
        impliedProb: b.impliedProbability ?? undefined,
        pickSide: ts?.pickSide ?? undefined,
      }];
    }
  }

  let underdogMerged = 0, underdogAdded = 0;
  for (const b of underdogProps) {
    const key = `${b.playerName}::${b.sport}::${getStatTypeKey(b)}`;
    const primary = propByPlayerSport.get(key);
    const ts = b.teamStats as { pickSide?: string; pickedOdds?: number } | null;
    const sourceEntry = {
      source: b.source,
      overOdds: b.overOdds ?? undefined,
      underOdds: b.underOdds ?? undefined,
      line: b.line ?? undefined,
      impliedProb: b.impliedProbability ?? undefined,
      pickSide: ts?.pickSide ?? undefined,
    };
    if (primary) {
      // Attach Underdog odds to existing primary bet
      if (!primary.allSources) primary.allSources = [];
      const alreadyHasSource = primary.allSources.some(s => s.source === "underdog");
      if (!alreadyHasSource) {
        primary.allSources.push(sourceEntry);
        // Boost confidence +3 when multiple independent sources agree on same player prop
        if (primary.confidenceScore !== null && primary.confidenceScore !== undefined) {
          primary.confidenceScore = Math.min(98, primary.confidenceScore + 3);
        }
      }
      // ── KEY FIX: Copy gameTime/homeTeam/awayTeam from Underdog if primary (Kalshi) has none
      if (!primary.gameTime && b.gameTime) {
        primary.gameTime = b.gameTime;
      }
      if (!primary.homeTeam && b.homeTeam) primary.homeTeam = b.homeTeam;
      if (!primary.awayTeam && b.awayTeam) primary.awayTeam = b.awayTeam;
      underdogMerged++;
    } else {
      // New player not in Kalshi — Underdog is primary
      b.allSources = [sourceEntry];
      results.push(b);
      propByPlayerSport.set(key, b);
      underdogAdded++;
    }
  }
  console.log(`Underdog merge: ${underdogMerged} merged into existing props, ${underdogAdded} new props added`);

  // ── SGO player prop merge (same priority as Underdog — attaches to existing card or adds new) ──
  let sgoMerged = 0, sgoAdded = 0;
  for (const b of sgoProps) {
    const key = `${b.playerName}::${b.sport}::${getStatTypeKey(b)}`;
    const primary = propByPlayerSport.get(key);
    const ts = b.teamStats as { pickSide?: string } | null;
    const sourceEntry = {
      source: b.source,
      overOdds: b.overOdds ?? undefined,
      underOdds: b.underOdds ?? undefined,
      line: b.line ?? undefined,
      impliedProb: b.impliedProbability ?? undefined,
      pickSide: ts?.pickSide ?? undefined,
    };
    if (primary) {
      if (!primary.allSources) primary.allSources = [];
      const alreadyHas = primary.allSources.some(s => s.source === b.source);
      if (!alreadyHas) {
        primary.allSources.push(sourceEntry);
        if (primary.confidenceScore !== null && primary.confidenceScore !== undefined) {
          primary.confidenceScore = Math.min(98, primary.confidenceScore + 3);
        }
      }
      if (!primary.gameTime && b.gameTime) primary.gameTime = b.gameTime;
      if (!primary.homeTeam && b.homeTeam) primary.homeTeam = b.homeTeam;
      if (!primary.awayTeam && b.awayTeam) primary.awayTeam = b.awayTeam;
      sgoMerged++;
    } else {
      b.allSources = [sourceEntry];
      results.push(b);
      propByPlayerSport.set(key, b);
      sgoAdded++;
    }
  }
  console.log(`SGO merge: ${sgoMerged} merged into existing props, ${sgoAdded} new props added`);

  // ── Linemate MLB props merge ───────────────────────────────────────────────
  // These are primary bet cards built directly from Linemate. Merge into existing
  // cards if same player+stat already exists (e.g. from Kalshi HR), otherwise add new.
  let lmMlbMerged = 0, lmMlbAdded = 0;
  for (const b of linemateMlbProps) {
    const key = `${b.playerName}::${b.sport}::${getStatTypeKey(b)}`;
    const primary = propByPlayerSport.get(key);
    if (primary) {
      // Already have a card for this player+stat — attach Linemate book lines as allSources
      if (!primary.allSources) primary.allSources = [];
      for (const src of (b.allSources ?? [])) {
        if (!primary.allSources.some(s => s.source === src.source)) {
          primary.allSources.push(src);
        }
      }
      // Copy hit rate data onto existing card's teamStats
      if (primary.teamStats && typeof primary.teamStats === "object") {
        const lmTs = b.teamStats as any;
        const pTs = primary.teamStats as any;
        if (pTs.lmHitRateL5 == null && lmTs.lmHitRateL5 != null) pTs.lmHitRateL5 = lmTs.lmHitRateL5;
        if (pTs.lmHitRateL10 == null && lmTs.lmHitRateL10 != null) pTs.lmHitRateL10 = lmTs.lmHitRateL10;
        if (!pTs.lmConsensusLine && lmTs.lmConsensusLine != null) pTs.lmConsensusLine = lmTs.lmConsensusLine;
        if (!pTs.linematePriority) pTs.linematePriority = true;
        // Carry batting hand for platoon splits
        if (!pTs.batterHand && lmTs.batterHand) pTs.batterHand = lmTs.batterHand;
      }
      // Boost confidence for multi-source confirmation
      if (primary.confidenceScore != null) {
        primary.confidenceScore = Math.min(98, primary.confidenceScore + 4);
      }
      if (!primary.gameTime && b.gameTime) primary.gameTime = b.gameTime;
      if (!primary.homeTeam && b.homeTeam) primary.homeTeam = b.homeTeam;
      if (!primary.awayTeam && b.awayTeam) primary.awayTeam = b.awayTeam;
      lmMlbMerged++;
    } else {
      // New player+stat card from Linemate — this IS primary
      results.push(b);
      propByPlayerSport.set(key, b);
      lmMlbAdded++;
    }
  }
  console.log(`Linemate MLB merge: ${lmMlbMerged} merged, ${lmMlbAdded} new props added`);

  // ── Linemate enrichment ─────────────────────────────────────────────────────
  // Fetch consensus lines + hit rates from Linemate (PrizePicks/DraftKings/Sleeper/etc.)
  // for all 4 sports in parallel. Enrich existing player prop cards with:
  //   • Real consensus line (if current card has no line)
  //   • L5/L10 hit rates stored on teamStats for display in BetDetail
  //   • Confidence boost: +2 if Linemate confirms line, +3 if hitRateL5 >= 70%
  // Also adds "linemate" as an entry in allSources so the card shows it as a source.
  // This runs regardless of Odds API quota — it's a free independent enrichment source.
  try {
    // Map from scanner stat type (lower) → Linemate marketName (upper)
    const STAT_TO_LINEMATE: Record<string, string> = {
      // NBA
      points: "POINTS", assists: "ASSISTS", rebounds: "REBOUNDS",
      blocks: "BLOCKS", steals: "STEALS", threes: "THREE_POINTERS_MADE",
      "three pointers made": "THREE_POINTERS_MADE",
      "points rebounds assists": "PTS_REB_AST",
      // NHL
      goals: "GOALS", shots: "SHOTS_ON_GOAL", saves: "SAVES",
      "shots on goal": "SHOTS_ON_GOAL",
      // MLB — statType comes from market.key stripped of batter_/pitcher_ prefix, spaces not underscores
      hits: "HITS",
      home_runs: "HOME_RUNS", "home runs": "HOME_RUNS",
      rbi: "RBIS", rbis: "RBIS",
      strikeouts: "STRIKEOUTS",
      runs: "RUNS",
      "runs scored": "RUNS", runs_scored: "RUNS",
      "total bases": "TOTAL_BASES", total_bases: "TOTAL_BASES",
      "stolen bases": "STOLEN_BASES", stolen_bases: "STOLEN_BASES",
      walks: "WALKS",
      "hits allowed": "HITS_ALLOWED", hits_allowed: "HITS_ALLOWED",
      "earned runs": "EARNED_RUNS", earned_runs: "EARNED_RUNS",
      outs: "OUTS",
      // NFL
      passing_yards: "PASSING_YARDS", "passing yards": "PASSING_YARDS",
      rushing_yards: "RUSHING_YARDS", "rushing yards": "RUSHING_YARDS",
      receiving_yards: "RECEIVING_YARDS", "receiving yards": "RECEIVING_YARDS",
      receptions: "RECEPTIONS",
      touchdowns: "TOUCHDOWNS",
    };

    const SPORT_TO_LINEMATE: Record<string, string> = {
      NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl",
    };

    // Collect which sports we actually need to fetch
    const sportsNeeded = new Set<string>();
    for (const b of results) {
      if (b.betType === "player_prop" && b.playerName && b.sport) {
        const lm = SPORT_TO_LINEMATE[b.sport.toUpperCase()];
        if (lm) sportsNeeded.add(lm);
      }
    }

    if (sportsNeeded.size > 0) {
      // Fetch Linemate data for all needed sports in parallel
      const linerateMaps = await Promise.all(
        Array.from(sportsNeeded).map(async (lmSport) => {
          try {
            const baseUrl = `https://api.linemate.io/api/${lmSport}`;
            const LINEMATE_HEADERS = {
              "Origin": "https://linemate.io",
              "Referer": "https://linemate.io/",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "application/json",
            };
            const { data } = await axios.get(
              `${baseUrl}/v2/markets?levelsToInclude=player`,
              { headers: LINEMATE_HEADERS, timeout: 12000 }
            );
            // Build propLineMap: key = "playernamelower:MARKETNAME"
            const propLineMap: Record<string, { line: number; hitRateL5: number | null; hitRateL10: number | null }> = {};
            const markets: any[] = data?.data?.markets ?? data?.markets ?? [];
            for (const mkt of markets) {
              const player = mkt.playerName ?? mkt.player_name ?? "";
              if (!player) continue;
              const marketName = (mkt.marketName ?? mkt.market_name ?? "").toUpperCase();
              if (!marketName) continue;
              // Consensus line = mode across book lines
              const lines = Object.values(mkt.bookLines ?? {}) as any[];
              const lineVals = lines.map((l: any) => l.line).filter((l: any) => typeof l === "number");
              if (lineVals.length === 0) continue;
              const freq: Record<number, number> = {};
              let bestLine = lineVals[0], bestFreq = 0;
              for (const v of lineVals) {
                freq[v] = (freq[v] ?? 0) + 1;
                if (freq[v] > bestFreq) { bestFreq = freq[v]; bestLine = v; }
              }
              const hrWindows = mkt.hitRateWindows ?? mkt.hitRates ?? {};
              const l5 = hrWindows.LAST_5?.hitRate ?? null;
              const l10 = hrWindows.LAST_10?.hitRate ?? null;
              const key = `${player.toLowerCase().replace(/\s+/g, "")}:${marketName}`;
              propLineMap[key] = { line: bestLine, hitRateL5: l5, hitRateL10: l10 };
            }
            return { sport: lmSport.toUpperCase(), propLineMap };
          } catch (e: any) {
            console.warn(`[scanner/linemate/${lmSport}] fetch failed: ${e.message}`);
            return { sport: lmSport.toUpperCase(), propLineMap: {} };
          }
        })
      );

      // Build a combined lookup by sport
      const lmBySport = new Map<string, Record<string, { line: number; hitRateL5: number | null; hitRateL10: number | null }>>();
      for (const { sport, propLineMap } of linerateMaps) {
        lmBySport.set(sport, propLineMap);
      }

      let lmEnriched = 0;
      for (const b of results) {
        if (b.betType !== "player_prop" || !b.playerName || !b.sport) continue;
        const propLineMap = lmBySport.get(b.sport.toUpperCase());
        if (!propLineMap) continue;

        const ts = b.teamStats as { statType?: string; pickSide?: string } | null;
        const statRaw = (ts?.statType ?? "").toLowerCase().trim();
        const lmMarket = STAT_TO_LINEMATE[statRaw];
        if (!lmMarket) continue;

        const playerKey = b.playerName.toLowerCase().replace(/\s+/g, "");
        const lmData = propLineMap[`${playerKey}:${lmMarket}`];
        if (!lmData) continue;

        let boost = 0;
        const factors: string[] = [];

        // Fill missing line from Linemate consensus
        if (b.line === null || b.line === undefined) {
          b.line = lmData.line;
          factors.push(`Linemate consensus line: ${lmData.line}`);
          boost += 2;
        } else if (Math.abs((b.line ?? 0) - lmData.line) <= 0.5) {
          // Line confirms — small boost
          boost += 2;
          factors.push(`Linemate confirms line ${lmData.line}`);
        }

        // High hit rate boost
        if (lmData.hitRateL5 !== null && lmData.hitRateL5 >= 0.7) {
          boost += 3;
          factors.push(`L5 hit rate: ${Math.round(lmData.hitRateL5 * 100)}%`);
        } else if (lmData.hitRateL10 !== null && lmData.hitRateL10 >= 0.7) {
          boost += 2;
          factors.push(`L10 hit rate: ${Math.round(lmData.hitRateL10 * 100)}%`);
        }

        if (boost > 0) {
          b.confidenceScore = Math.min(98, (b.confidenceScore ?? 50) + boost);
          b.isHighConfidence = (b.confidenceScore ?? 0) >= 85;
          b.keyFactors = [...(b.keyFactors ?? []), ...factors].slice(0, 8);
          // Store hit rates on teamStats for BetDetail display
          if (b.teamStats && typeof b.teamStats === "object") {
            (b.teamStats as any).lmHitRateL5 = lmData.hitRateL5;
            (b.teamStats as any).lmHitRateL10 = lmData.hitRateL10;
            (b.teamStats as any).lmConsensusLine = lmData.line;
          }
          // Add Linemate as a source entry
          if (!b.allSources) b.allSources = [];
          if (!b.allSources.some(s => s.source === "linemate")) {
            b.allSources.push({
              source: "linemate",
              line: lmData.line,
              overOdds: undefined,
              underOdds: undefined,
              impliedProb: lmData.hitRateL5 ?? undefined,
              pickSide: ts?.pickSide ?? undefined,
            });
          }
          // Tag bet as Props Hub confirmed — picked up by applyMLWeights for extra boost
          if (b.teamStats && typeof b.teamStats === "object") {
            (b.teamStats as any).linematePriority = true;
          }
          lmEnriched++;
        }
      }
      console.log(`Linemate enrichment: ${lmEnriched} player props enriched with consensus lines + hit rates`);
    }
  } catch (e: any) {
    console.warn(`[scanner/linemate] Enrichment skipped: ${e.message}`);
  }


  // ── MLB Platoon Split Enrichment ─────────────────────────────────────────────
  // For every MLB batter prop, look up today's starting pitcher handedness and
  // their batting average allowed vs R vs L batters.
  // → Batter is R + pitcher's BAA vs R is high (≥.270) = confidence boost +4-6
  // → Batter is R + pitcher's BAA vs R is low  (≤.220) = confidence penalty -4-6
  // → Same logic for lefties.
  // Uses ESPN's free public API — no key required.
  try {
    const mlbBatterProps = results.filter(b =>
      b.sport === "MLB" && b.betType === "player_prop" &&
      b.playerName && b.homeTeam && b.awayTeam
    );

    if (mlbBatterProps.length > 0) {
      // Collect unique games that have batter props
      const gameKeys = new Set<string>();
      for (const b of mlbBatterProps) {
        const gk = `${b.awayTeam}|${b.homeTeam}`;
        gameKeys.add(gk);
      }

      // Fetch today's MLB scoreboard from ESPN to get game IDs + starting pitchers
      type PitcherInfo = { name: string; hand: "L" | "R" | null; baaVsR: number | null; baaVsL: number | null };
      const gamePitcherMap = new Map<string, { home: PitcherInfo | null; away: PitcherInfo | null }>();

      try {
        const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
        const sbRes = await axios.get(
          `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${today}`,
          { timeout: 8000 }
        );
        const events: any[] = sbRes.data?.events ?? [];

        for (const ev of events) {
          const comp = ev.competitions?.[0];
          if (!comp) continue;
          const homeComp = comp.competitors?.find((c: any) => c.homeAway === "home");
          const awayComp = comp.competitors?.find((c: any) => c.homeAway === "away");
          const homeTeamName = homeComp?.team?.abbreviation ?? homeComp?.team?.displayName ?? "";
          const awayTeamName = awayComp?.team?.displayName ?? awayComp?.team?.abbreviation ?? "";
          const gameId = ev.id;

          // Get probable pitchers from the game summary leaders/probables endpoint
          let homePitcher: PitcherInfo | null = null;
          let awayPitcher: PitcherInfo | null = null;
          try {
            const summaryRes = await axios.get(
              `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${gameId}`,
              { timeout: 8000 }
            );
            const probables: any[] = summaryRes.data?.probables ?? [];
            for (const p of probables) {
              const hand = p.athlete?.displayName ? null : null; // ESPN doesn't expose handedness in summary
              const teamId = p.team?.id;
              const isHome = homeComp?.team?.id === teamId;
              const pitcherInfo: PitcherInfo = {
                name: p.athlete?.displayName ?? p.athlete?.fullName ?? "",
                hand: null, // will try to enrich below
                baaVsR: null,
                baaVsL: null,
              };
              // Try athlete stats endpoint for splits
              const athleteId = p.athlete?.id;
              if (athleteId) {
                try {
                  const statsRes = await axios.get(
                    `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/athletes/${athleteId}/splits`,
                    { timeout: 6000 }
                  );
                  const splitCats: any[] = statsRes.data?.splitCategories ?? [];
                  for (const cat of splitCats) {
                    if (!cat.displayName?.toLowerCase().includes("batter hand")) continue;
                    for (const split of cat.splits ?? []) {
                      // split.displayName e.g. "vs. Right-Handed Batters", "vs. Left-Handed Batters"
                      const dn: string = (split.displayName ?? "").toLowerCase();
                      const stats: any[] = split.stats ?? [];
                      // Find BAA (batting average against) — usually index 6 in ESPN pitcher splits
                      const baaRaw = stats.find((s: any) => s.name === "avg" || s.abbreviation === "AVG" || s.abbreviation === "BAA");
                      const baa = baaRaw ? parseFloat(baaRaw.value ?? baaRaw.displayValue ?? "0") : null;
                      if (dn.includes("right")) pitcherInfo.baaVsR = baa;
                      else if (dn.includes("left")) pitcherInfo.baaVsL = baa;
                    }
                  }
                  // Get handedness from athlete profile
                  const profileRes = await axios.get(
                    `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/athletes/${athleteId}`,
                    { timeout: 5000 }
                  );
                  const throwHand = profileRes.data?.athlete?.throwingHand?.abbreviation ?? null;
                  pitcherInfo.hand = throwHand === "R" ? "R" : throwHand === "L" ? "L" : null;
                } catch { /* stats fetch failed — use pitcher without splits */ }
              }
              if (isHome) homePitcher = pitcherInfo;
              else awayPitcher = pitcherInfo;
            }
          } catch { /* summary fetch failed for this game */ }

          // Store by home+away team name combo
          const gk = `${awayTeamName}|${homeTeamName}`;
          gamePitcherMap.set(gk, { home: homePitcher, away: awayPitcher });
        }
      } catch (e: any) {
        console.warn(`[PlatoonSplit] ESPN scoreboard fetch failed: ${e.message}`);
      }

      // Now enrich batter props
      let platoonEnriched = 0;
      for (const b of mlbBatterProps) {
        const gk = `${b.awayTeam}|${b.homeTeam}`;
        const pitchers = gamePitcherMap.get(gk);
        if (!pitchers) continue;

        // Which pitcher does this batter face?
        // If batter's team is away → they face the home pitcher (and vice versa)
        const ts = b.teamStats as { playerName?: string; gameTitle?: string; batterHand?: "L" | "R"; platoonNote?: string } | null;
        const isHomeBatter = b.homeTeam && b.awayTeam &&
          (b.playerName ?? "").length > 0;  // we'll use team assignment below

        // Determine batter team from description (away @ home format)
        const descTeam = (b.description ?? "").includes(b.awayTeam ?? "!!") ? "away" : "home";
        const facingPitcher = descTeam === "away" ? pitchers.home : pitchers.away;
        if (!facingPitcher) continue;

        // Get batter handedness — try to determine from name patterns or default to unknown
        // ESPN athlete endpoint would have this, but to avoid per-player API calls
        // we use the statType as a proxy: if stat is batter-specific, try to look up
        const statRaw = (ts as any)?.statType ?? "";
        const isBatterStat = ["hits", "home runs", "rbis", "runs scored", "total bases", "stolen bases", "walks"].some(s => statRaw.toLowerCase().includes(s));
        if (!isBatterStat) continue;

        // We don't know batter hand without an extra API call per player.
        // Use aggregate BAA as a fallback (if pitcher has very high or low overall BAA).
        // When we DO know hand (from previous ML enrichment or stored data), use split.
        const batterHand: "L" | "R" | null = (ts as any)?.batterHand ?? null;

        let platoonAdj = 0;
        let platoonNote = "";

        if (batterHand && (facingPitcher.baaVsR !== null || facingPitcher.baaVsL !== null)) {
          // Full split data available
          const baa = batterHand === "R" ? facingPitcher.baaVsR : facingPitcher.baaVsL;
          if (baa !== null) {
            if (baa >= 0.290) {
              platoonAdj = 7;
              platoonNote = `Pitcher allows .${Math.round(baa * 1000)} BAA vs ${batterHand}HB — strong platoon advantage`;
            } else if (baa >= 0.270) {
              platoonAdj = 4;
              platoonNote = `Pitcher allows .${Math.round(baa * 1000)} BAA vs ${batterHand}HB — favorable matchup`;
            } else if (baa >= 0.250) {
              platoonAdj = 1;
              platoonNote = `Pitcher allows .${Math.round(baa * 1000)} BAA vs ${batterHand}HB — neutral matchup`;
            } else if (baa <= 0.200) {
              platoonAdj = -7;
              platoonNote = `Pitcher holds ${batterHand}HB to .${Math.round(baa * 1000)} — tough platoon matchup`;
            } else if (baa <= 0.220) {
              platoonAdj = -4;
              platoonNote = `Pitcher tough vs ${batterHand}HB (.${Math.round(baa * 1000)} BAA) — slight downgrade`;
            } else {
              platoonAdj = 0;
              platoonNote = `Pitcher BAA .${Math.round(baa * 1000)} vs ${batterHand}HB — roughly league-average`;
            }
          }
        } else if (facingPitcher.baaVsR !== null && facingPitcher.baaVsL !== null) {
          // Know both splits but not batter hand — use average as rough signal
          const avgBaa = (facingPitcher.baaVsR + facingPitcher.baaVsL) / 2;
          if (avgBaa >= 0.280) {
            platoonAdj = 3;
            platoonNote = `${facingPitcher.name ?? "Starter"} overall BAA .${Math.round(avgBaa * 1000)} — pitcher trending soft`;
          } else if (avgBaa <= 0.215) {
            platoonAdj = -3;
            platoonNote = `${facingPitcher.name ?? "Starter"} overall BAA .${Math.round(avgBaa * 1000)} — dominant pitcher`;
          }
        } else if (facingPitcher.name) {
          // Only have pitcher name — at least note the matchup
          platoonNote = `Facing ${facingPitcher.name}`;
        }

        if (platoonAdj !== 0 || platoonNote) {
          if (platoonAdj !== 0) {
            b.confidenceScore = Math.min(98, Math.max(10, (b.confidenceScore ?? 50) + platoonAdj));
            b.isHighConfidence = (b.confidenceScore ?? 0) >= 85;
          }
          if (platoonNote) {
            b.keyFactors = [...(b.keyFactors ?? []), platoonNote].slice(0, 8);
          }
          if (b.teamStats && typeof b.teamStats === "object") {
            (b.teamStats as any).platoonNote = platoonNote;
            (b.teamStats as any).platoonAdj = platoonAdj;
            if (facingPitcher.name) (b.teamStats as any).facingPitcher = facingPitcher.name;
          }
          platoonEnriched++;
        }
      }
      console.log(`[PlatoonSplit] Enriched ${platoonEnriched} MLB batter props with pitcher split data`);
    }
  } catch (e: any) {
    console.warn(`[PlatoonSplit] MLB platoon enrichment failed: ${e.message}`);
  }

  // Apply Apify DFS salary boosts to player props (budget-aware, 30-min cache)
  const apifyKey = process.env.APIFY_API_KEY ?? null;
  if (apifyKey) {
    const salaryMap = await fetchApifyDFSSalaries(apifyKey);
    const boosted = applyApifyDFSBoosts(results, salaryMap);
    results.length = 0;
    results.push(...boosted);
  }

  // Apply API-Sports player stats boosts (6-hour cache, 100 req/day limit)
  if (API_SPORTS_KEY) {
    const statsMap = await fetchApiSportsPlayerStats();
    if (statsMap.size > 0) {
      const boosted = applyApiSportsBoosts(results, statsMap);
      results.length = 0;
      results.push(...boosted);
    }
  }

  // Odds API — always use hardcoded key (Railway env var has wrong key, ignore apiKey param)
  const effectiveOddsKey = "4134e9d0ec483414517b0ae8dea7437c";
  const odds = await fetchOddsAPI(effectiveOddsKey, {
    enabledSports: allEnabledSports,
    enableSeasonProps: settings.enableSeasonProps ?? true,
  });
  // Merge DraftKings/Odds API player props into allSources on existing cards
  let dkMerged = 0, dkAdded = 0;
  for (const b of odds) {
    if (b.betType === "player_prop" && b.playerName) {
      const key = `${b.playerName}::${b.sport}::${getStatTypeKey(b)}`;
      const primary = propByPlayerSport.get(key);
      const ts = b.teamStats as { pickSide?: string } | null;
      const sourceEntry = {
        source: b.source,
        overOdds: b.overOdds ?? undefined,
        underOdds: b.underOdds ?? undefined,
        line: b.line ?? undefined,
        impliedProb: b.impliedProbability ?? undefined,
        pickSide: ts?.pickSide ?? undefined,
      };
      if (primary) {
        if (!primary.allSources) primary.allSources = [];
        const alreadyHasSource = primary.allSources.some(s => s.source === b.source);
        if (!alreadyHasSource) {
          primary.allSources.push(sourceEntry);
          // Boost confidence +2 for each additional book confirming the line
          if (primary.confidenceScore !== null && primary.confidenceScore !== undefined) {
            primary.confidenceScore = Math.min(98, primary.confidenceScore + 2);
          }
        }
        dkMerged++;
      } else {
        b.allSources = [sourceEntry];
        results.push(b);
        propByPlayerSport.set(key, b);
        dkAdded++;
      }
    } else {
      // Non-prop bets (spreads, totals, moneylines) go straight in
      results.push(b);
    }
  }
  if (dkMerged + dkAdded > 0) {
    console.log(`Odds API props: ${dkMerged} merged into existing cards, ${dkAdded} new cards added`);
  }

  // If no live data came back, seed with known futures so the app always has content
  if (results.length === 0) {
    console.log("No live data from APIs — loading seed futures data.");
    const seeds = buildSeedFutures();
    results.push(...seeds);
    console.log(`Seeded ${seeds.length} futures picks as fallback.`);
  } else {
    // Even with live data, ensure seed futures appear if API quota blocked futures fetch
    // (only add seeds that aren't already in results)
    const existingIds = new Set(results.map(b => b.id));
    const missingSeeds = buildSeedFutures().filter(s => !existingIds.has(s.id));
    if (missingSeeds.length > 0) {
      console.log(`Adding ${missingSeeds.length} seed futures to supplement live data.`);
      results.push(...missingSeeds);
    }
  }

  // ── Guarantee NHL goal lotto bets are present (minimum 5, max 10) ────────
  // Lotto stats (NHL goals, MLB HRs, NFL TDs, NBA pts) from Underdog must always
  // appear as separate bet cards — never merged/absorbed. Re-inject them here.
  const lottoStatResults = underdogProps.filter(b => {
    if (b.sport !== "NHL" && b.sport !== "MLB" && b.sport !== "NFL" && b.sport !== "NBA") return false;
    const ts = b.teamStats as { statType?: string } | null;
    const st = (ts?.statType ?? "").toLowerCase();
    const isGoals  = b.sport === "NHL" && st === "goals";
    const isHR     = b.sport === "MLB" && (st === "home runs" || st.includes("home run"));
    const isTD     = b.sport === "NFL" && st.includes("touchdown");
    const isPts    = b.sport === "NBA" && st === "points";
    return isGoals || isHR || isTD || isPts;
  });
  if (lottoStatResults.length > 0) {
    const existingIds = new Set(results.map(b => b.id));
    let injected = 0;
    for (const b of lottoStatResults) {
      if (!existingIds.has(b.id)) {
        b.isLotto = true;
        results.push(b);
        existingIds.add(b.id);
        injected++;
      }
    }
    if (injected > 0) {
      console.log(`[Lotto] Injected ${injected} lotto bets directly (bypassing merge filter)`);
    }
    // Per-sport breakdown
    const byS: Record<string, number> = {};
    for (const b of lottoStatResults) { byS[b.sport] = (byS[b.sport] ?? 0) + 1; }
    console.log(`[Lotto] Underdog lotto stat breakdown: ${JSON.stringify(byS)}`);
  }

  // Remove any markets whose game/close time has already passed
  const fresh = filterStale(results);
  console.log(`Staleness filter: ${results.length} raw → ${fresh.length} current markets`);

  // ── Tag lotto props ──────────────────────────────────────────────────────────
  // Mark any player prop that matches a lotto stat category AND pays +150 or better
  for (const bet of fresh) {
    bet.isLotto = isLottoProp(
      bet.title,
      bet.impliedProbability ?? bet.yesPrice ?? 0.5,
      bet.betType ?? undefined,
      bet.sport ?? undefined,
    );
  }
  const lottoCount = fresh.filter(b => b.isLotto).length;
  console.log(`Lotto props tagged: ${lottoCount}`);

  // Clear old bets and replace with fresh live data only
  await storage.clearBets();

  // Upsert all fresh bets — ensure each has a stable slug
  for (const bet of fresh) {
    await storage.upsertBet({ ...bet, slug: bet.slug ?? generateBetSlug(bet.title, bet.id) });
  }

  // Generate notifications for new high-confidence bets (live data only)
  // (settings already loaded above)
  const threshold = settings.confidenceThreshold ?? 80;
  for (const bet of fresh) {
    if ((bet.confidenceScore ?? 0) >= threshold && bet.isHighConfidence && !bet.notificationSent) {
      await storage.addNotification({
        id: `notif-${bet.id}-${Date.now()}`,
        betId: bet.id,
        message: bet.betType === "player_prop" && bet.teamStats && (bet.teamStats as any).pickSide
          ? `🔥 ${(bet.teamStats as any).pickSide === "over" ? "▲ TAKE OVER" : "▼ TAKE UNDER"} — ${bet.playerName ?? bet.title} — ${bet.confidenceScore}/100 confidence | ${bet.source.toUpperCase()} | Suggest ${bet.recommendedAllocation}% allocation`
          : `🔥 ${bet.title} — ${bet.confidenceScore}/100 confidence | ${bet.source.toUpperCase()} | Suggest ${bet.recommendedAllocation}% allocation`,
        confidenceScore: bet.confidenceScore,
        dismissed: false,
      });
      // Mark as notified
      const stored = await storage.getBetById(bet.id);
      if (stored) {
        await storage.upsertBet({ ...stored, notificationSent: true });
      }
    }
  }

  const highConf = fresh.filter((b) => (b.confidenceScore ?? 0) >= threshold).length;
  console.log(`Scan complete: ${fresh.length} live markets, ${highConf} high-confidence`);

  // ── Post-scan enrichment: sharp money + arb + urgency ───────────────────────
  // Tag sharp money on every stored bet
  try {
    const storedBets = await storage.getBets();
    for (const b of storedBets) {
      const sm = computeSharpMoneyScore({
        confidenceScore: b.confidenceScore,
        sharpnessScore:  (b as any).sharpnessScore ?? null,
        priceMovement:   (b as any).priceMovement ?? null,
        allSources:      b.allSources,
        source:          b.source,
      });
      if (sm.isSharpMoney || sm.score > 0) {
        await storage.patchBetSharpMoney(b.id, { isSharpMoney: sm.isSharpMoney, sharpMoneyScore: sm.score });
      }
    }
    console.log(`[sharp] tagged sharp money on ${storedBets.length} bets`);
  } catch (e: any) { console.warn("[sharp] error:", e.message); }

  // Detect cross-market arb windows (Kalshi vs Polymarket)
  try {
    await detectArbWindows();
    console.log("[arb] cross-market arb detection complete");
  } catch (e: any) { console.warn("[arb] error:", e.message); }

  // Tag urgency / closing-soon markets
  try {
    await tagUrgency();
    console.log("[urgency] closing-soon tagging complete");
  } catch (e: any) { console.warn("[urgency] error:", e.message); }

  // ── Edge Analysis: compute edge %, best book, and tier for every bet ───────────
  try {
    await computeAndTagEdge();
    console.log("[edge] edge analysis complete");
  } catch (e: any) { console.warn("[edge] error:", e.message); }

  return { scanned: fresh.length, highConfidence: highConf };
}


// ─── Edge Analysis Engine ───────────────────────────────────────────────────────────
//
// For every open bet, computes:
//   edgePct   — how much value the model sees vs the book’s implied probability
//   edgeTier  — A+ (≥15%), A (≥10%), B (≥5%), C (<5%)
//   bestBook  — the book in allSources that has the most favorable odds for the pick
//
// Edge calculation:
//   For sportsbook props/lines: fairValue (from confidence score) - impliedProbability
//   For prediction markets    : uses existing computeMispricing() logic
//
// Tier thresholds are intentionally strict so A+ is rare and meaningful.
// ─────────────────────────────────────────────────────────────────────────────

// Pretty-print a book name
function prettyBook(key: string): string {
  const MAP: Record<string, string> = {
    draftkings:        "DraftKings",
    fanduel:           "FanDuel",
    betmgm:            "BetMGM",
    williamhill_us:    "Caesars",
    caesars:           "Caesars",
    underdog:          "Underdog",
    pointsbetus:       "PointsBet",
    betrivers:         "BetRivers",
    unibet_us:         "Unibet",
    bovada:            "Bovada",
    mybookieag:        "MyBookie",
    actionnetwork:     "ActionNetwork",
  };
  return MAP[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

// Format American odds for display
function fmtOdds(o: number): string {
  return o > 0 ? `+${o}` : `${o}`;
}

// Convert American odds → implied probability (removing vig estimate)
function oddsToProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

// Assign edge tier based on edge % + confidence + sharp money
function assignEdgeTier(
  edgePct: number,
  confidenceScore: number,
  isSharpMoney: boolean,
): "A+" | "A" | "B" | "C" {
  // Sharp money bonus: if sharps are aligned, allow tier upgrade
  const sharpBonus = isSharpMoney ? 2 : 0;
  const effectiveEdge = edgePct + sharpBonus;

  if (effectiveEdge >= 15 && confidenceScore >= 82) return "A+";
  if (effectiveEdge >= 10 && confidenceScore >= 75) return "A";
  if (effectiveEdge >= 5  && confidenceScore >= 65) return "B";
  return "C";
}

async function computeAndTagEdge(): Promise<void> {
  const bets = await storage.getBets();

  for (const bet of bets) {
    if (bet.status !== "open") continue;

    // ── 1. Compute edge % ──────────────────────────────────────────────
    const conf  = bet.confidenceScore ?? 50;
    const score = Math.max(0, Math.min(100, conf));

    // Fair value: linear calibration (score 50→0.50, 85→0.78, 100→0.90)
    const fairValue = 0.10 + (score / 100) * 0.80;

    // Market price: prediction markets use yesPrice; sportsbook uses impliedProbability
    const isPredMkt = bet.source === "kalshi" || bet.source === "polymarket";
    const marketPrice = isPredMkt
      ? (bet.yesPrice ?? bet.impliedProbability ?? 0.5)
      : (bet.impliedProbability ?? 0.5);

    const rawEdge = fairValue - marketPrice;  // positive = model sees value
    const edgePct = Math.round(Math.abs(rawEdge) * 1000) / 10;  // e.g. 12.4

    // ── 2. Find best book from allSources ───────────────────────────────────
    let bestBook: string | null = null;
    let bestBookKey: string | null = null;
    let bestBookOdds: number | null = null;

    if (bet.allSources && bet.allSources.length > 0) {
      // Determine pick side from the bet
      const pickSideLower = ((bet.teamStats as any)?.pickSide ?? "").toLowerCase();
      const isOver  = pickSideLower === "over"  || (bet.pick ?? "").toLowerCase().includes("over");
      const isUnder = pickSideLower === "under" || (bet.pick ?? "").toLowerCase().includes("under");

      // For each source, find the odds for the correct side
      // Best = least juice (highest American odds = least negative or most positive)
      let bestValue = -Infinity;

      for (const src of bet.allSources) {
        if (!src.source) continue;

        let sideOdds: number | undefined;
        if (isUnder && src.underOdds != null) {
          sideOdds = src.underOdds;
        } else if (!isUnder && src.overOdds != null) {
          sideOdds = src.overOdds;
        } else if (src.overOdds != null) {
          sideOdds = src.overOdds;  // fallback to over
        }

        if (sideOdds == null) continue;

        // Higher American odds = better value (e.g. -105 beats -115)
        if (sideOdds > bestValue) {
          bestValue    = sideOdds;
          bestBookKey  = src.source;
          bestBookOdds = sideOdds;
          bestBook     = `${prettyBook(src.source)} ${fmtOdds(sideOdds)}`;
        }
      }
    }

    // If no allSources data, fall back to bet's own source + odds
    if (!bestBook && bet.overOdds != null) {
      const odds = ((bet.teamStats as any)?.pickSide === "under" ? bet.underOdds : bet.overOdds) ?? bet.overOdds;
      if (odds != null) {
        bestBook     = `${prettyBook(bet.source)} ${fmtOdds(odds)}`;
        bestBookKey  = bet.source;
        bestBookOdds = odds;
      }
    }

    // ── 3. Assign tier ────────────────────────────────────────────────────
    const edgeTier = assignEdgeTier(edgePct, conf, bet.isSharpMoney ?? false);

    // ── 4. Persist ──────────────────────────────────────────────────────────
    await storage.patchBetEdge(bet.id, {
      edgePct,
      edgeTier,
      bestBook,
      bestBookKey,
      bestBookOdds,
    });
  }
}

// ─── Fair Value + Mispricing Engine ─────────────────────────────────────────
//
// THEORY:
//   Prediction markets (Kalshi, Polymarket) price YES contracts in cents (0–1).
//   A market is MISPRICED when its current traded probability diverges from the
//   model's estimated "fair value" by a meaningful edge (default ≥5%).
//
//   Fair value = confidence-score-derived probability anchored to the scoring model.
//   Entry price  = current market price (what you pay to enter RIGHT NOW).
//   Exit target  = captures ~85% of the gap to fair value, leaving a safety buffer.
//
const MISPRICING_THRESHOLD = 0.05; // 5 percentage points minimum to signal

export interface MispricingResult {
  fairValue: number;           // model estimate (0-1)
  marketPrice: number;         // current traded price (0-1)
  mispricingEdge: number;      // fairValue - marketPrice (+ = underpriced)
  entryPrice: number;          // price to enter now (0-1)
  exitTarget: number;          // price target to exit / take profit (0-1)
  isMispriced: boolean;
  mispricingDirection: "underpriced" | "overpriced" | "fair";
  entryCents: number;          // entry price in cents  e.g. 42
  exitTargetCents: number;     // exit target in cents  e.g. 55
  edgePct: number;             // edge as percentage    e.g. 8.3
}

/**
 * computeMispricing
 *
 * Derives fair value from the model confidence score and compares to the
 * live market price. Returns full mispricing analysis with entry/exit prices.
 * Only meaningful for Kalshi and Polymarket (binary prediction markets).
 *
 * Calibration:
 *   score 50 → fair ~0.50 | score 70 → fair ~0.66 | score 85 → fair ~0.78
 *   score 90 → fair ~0.82 | score 95 → fair ~0.86
 */
export function computeMispricing(
  confidenceScore: number,
  marketPrice: number,   // current yes price (0-1)
): MispricingResult {
  // Step 1: Convert confidence score → fair probability via calibrated S-curve
  const scoreFrac = Math.max(0, Math.min(1, confidenceScore / 100));
  // Linear mapping: score 0 → 0.10, score 100 → 0.90
  const rawFair   = 0.10 + scoreFrac * 0.80;
  const fairValue = Math.min(0.92, Math.max(0.08, rawFair));

  // Step 2: Edge = difference between model fair value and what the market offers
  const mispricingEdge = fairValue - marketPrice;
  const absEdge        = Math.abs(mispricingEdge);
  const isMispriced    = absEdge >= MISPRICING_THRESHOLD;

  const mispricingDirection: "underpriced" | "overpriced" | "fair" =
    mispricingEdge >=  MISPRICING_THRESHOLD ? "underpriced" :
    mispricingEdge <= -MISPRICING_THRESHOLD ? "overpriced"  : "fair";

  // Step 3: Entry price = what you pay right now
  //   Underpriced YES → buy YES at current market price
  //   Overpriced YES  → buy NO at (1 - marketPrice)
  const VIG_BUFFER = 0.015; // ~1.5 cent vig cushion
  const entryPrice = mispricingDirection === "overpriced"
    ? 1 - marketPrice            // buying NO
    : marketPrice + VIG_BUFFER;  // buying YES

  // Step 4: Exit target = converge 85% of the gap toward fair value
  //   e.g. market=0.42, fair=0.55 → gap=0.13, exit at 0.42 + 0.13×0.85 ≈ 0.53
  let exitTarget: number;
  if (mispricingDirection === "underpriced") {
    exitTarget = marketPrice + absEdge * 0.85;
  } else if (mispricingDirection === "overpriced") {
    const noEntry = 1 - marketPrice;
    const noFair  = 1 - fairValue;
    exitTarget    = noEntry + (noFair - noEntry) * 0.85;
  } else {
    exitTarget = fairValue;
  }
  exitTarget = Math.min(0.97, Math.max(0.03, exitTarget));

  const clampedEntry = Math.min(0.97, Math.max(0.03, entryPrice));
  return {
    fairValue,
    marketPrice,
    mispricingEdge,
    entryPrice:      clampedEntry,
    exitTarget,
    isMispriced,
    mispricingDirection,
    entryCents:      Math.round(clampedEntry * 100),
    exitTargetCents: Math.round(exitTarget  * 100),
    edgePct:         Math.round(absEdge * 1000) / 10,
  };
}

// ─── Live 30-second Price Poller ─────────────────────────────────────────────
// Lightweight function — only hits Kalshi + Polymarket (2 HTTP requests).
// Matches returned prices to existing bets by ID.
// If implied probability changed ≥ 0.5%, patches the bet with movement data.
// Returns only the bets whose prices changed.

export interface LivePriceUpdate {
  id: string;
  prevImpliedProb: number;
  newImpliedProb: number;
  priceMovement: "up" | "down" | "neutral";
  priceMovementPct: number;
  liveOddsOver: number | null;
  liveOddsUnder: number | null;
  mispricing?: MispricingResult; // present when |edge| >= 5%
}


// ─── Sharp Money Tagger ───────────────────────────────────────────────────────
// Uses the existing sharpness score from CLV line snapshots, supplemented by:
//   • High confidence score (proxy for model-perceived sharp edge)
//   • Price movement direction matching pick side (confirming action)
//   • Multi-source confirmation (bet appears on 2+ books)
// Score 0-100; isSharpMoney = true when >= 60

export function computeSharpMoneyScore(bet: {
  confidenceScore?: number | null;
  sharpnessScore?: number | null;   // from CLV snapshot if available
  priceMovement?: string | null;    // "up" | "down" — recent 30s tick
  allSources?: Array<{ source: string }> | null;
  source?: string;
}): { score: number; isSharpMoney: boolean } {
  let score = 0;

  // Component 1: CLV sharpness score (0-40 pts) — most reliable signal
  const clvSharp = bet.sharpnessScore ?? 0;
  score += Math.min(40, clvSharp * 0.40);

  // Component 2: Model confidence (0-30 pts) — high confidence = model sees edge
  const conf = bet.confidenceScore ?? 50;
  if (conf >= 85) score += 30;
  else if (conf >= 75) score += 20;
  else if (conf >= 65) score += 10;

  // Component 3: Multi-source confirmation (0-20 pts)
  // If the bet shows up on multiple books, sharps have been placing
  const sourceCount = (bet.allSources?.length ?? 1);
  if (sourceCount >= 3) score += 20;
  else if (sourceCount === 2) score += 12;

  // Component 4: Recent price movement aligning with pick (0-10 pts)
  // Prediction market price moving up = public buying YES = confirming sharp action
  if (bet.priceMovement === "up") score += 10;
  else if (bet.priceMovement === "down") score += 5; // contrarian sharp plays also valid

  const finalScore = Math.min(100, Math.round(score));
  return { score: finalScore, isSharpMoney: finalScore >= 60 };
}

// ─── Cross-market Arb Detector ────────────────────────────────────────────────
// Scans all stored bets for the same event priced differently on Kalshi vs Polymarket.
// Matching strategy: normalize title to lowercase tokens, find pairs where
//   |kalshiProb - polyProb| >= ARB_THRESHOLD (4%)
// The cheaper side is the "buy" — lock in both sides for a guaranteed profit.

const ARB_THRESHOLD = 0.04; // 4% spread minimum

export async function detectArbWindows(): Promise<void> {
  const allBets = await storage.getBets();
  const kalshiBets = allBets.filter(b => b.source === "kalshi");
  const polyBets   = allBets.filter(b => b.source === "polymarket");

  for (const kb of kalshiBets) {
    const kProb = kb.impliedProbability ?? kb.yesPrice ?? null;
    if (kProb == null) continue;
    const kTokens = tokenize(kb.title);

    for (const pb of polyBets) {
      const pProb = pb.impliedProbability ?? pb.yesPrice ?? null;
      if (pProb == null) continue;

      // Title similarity — at least 3 matching significant tokens
      const pTokens = tokenize(pb.title);
      const shared  = kTokens.filter(t => pTokens.includes(t));
      if (shared.length < 3) continue;

      const spread = Math.abs(kProb - pProb);
      if (spread < ARB_THRESHOLD) continue;

      // Determine which side to buy
      const kalshiIsCheaper = kProb < pProb;
      const buySide    = kalshiIsCheaper ? "kalshi"     : "polymarket";
      const sellSide   = kalshiIsCheaper ? "polymarket" : "kalshi";
      const buyPrice   = kalshiIsCheaper ? kProb        : pProb;
      const sellPrice  = kalshiIsCheaper ? pProb        : kProb;
      const spreadPct  = Math.round(spread * 1000) / 10;

      // Tag the Kalshi bet (primary) with arb data
      await storage.patchBetArb(kb.id, {
        isArbWindow: true,
        arbSpreadPct: spreadPct,
        arbBuySide:   buySide,
        arbSellSide:  sellSide,
        arbBuyPrice:  buyPrice,
        arbSellPrice: sellPrice,
      });
      // Also tag the Polymarket bet
      await storage.patchBetArb(pb.id, {
        isArbWindow: true,
        arbSpreadPct: spreadPct,
        arbBuySide:   buySide,
        arbSellSide:  sellSide,
        arbBuyPrice:  buyPrice,
        arbSellPrice: sellPrice,
      });
    }
  }
}

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 3 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  "will", "the", "and", "for", "over", "under", "with", "that", "this",
  "from", "have", "been", "they", "more", "than", "game", "match",
  "team", "play", "wins", "beat", "score", "first", "total", "points",
]);

// ─── Urgency Tagger ───────────────────────────────────────────────────────────
// Tags prediction market bets as "closing soon" when game starts within 3 hours.
// Also resets the flag for bets that have passed close time.
// Called at the end of runScan and also from the 30s live poller.

const CLOSING_SOON_MINUTES = 180; // 3 hours

export async function tagUrgency(): Promise<void> {
  const allBets = await storage.getBets();
  const now = Date.now();
  for (const bet of allBets) {
    if (!bet.gameTime) continue;
    // Only tag prediction markets — sportsbook bets have open odds until game time
    if (bet.source !== "kalshi" && bet.source !== "polymarket") continue;
    const gt = new Date(bet.gameTime).getTime();
    const diffMs  = gt - now;
    const diffMin = Math.floor(diffMs / 60000);
    const isClosingSoon = diffMin >= 0 && diffMin <= CLOSING_SOON_MINUTES;
    await storage.patchBetUrgency(bet.id, {
      isClosingSoon,
      minutesToClose: Math.max(0, diffMin),
    });
  }
}

export async function fetchLivePrices(): Promise<LivePriceUpdate[]> {
  const updates: LivePriceUpdate[] = [];

  try {
    // ── 1. Build a quick lookup: betId → current stored implied prob ──────────
    const allBets = await storage.getBets();
    const betMap = new Map<string, { impliedProb: number; liveOddsOver: number | null; liveOddsUnder: number | null; confidenceScore: number }>();
    for (const b of allBets) {
      betMap.set(b.id, {
        impliedProb: b.impliedProbability ?? b.yesPrice ?? 0.5,
        liveOddsOver: (b as any).liveOddsOver ?? null,
        liveOddsUnder: (b as any).liveOddsUnder ?? null,
        confidenceScore: b.confidenceScore ?? 50,
      });
    }

    // ── 2. Fetch Kalshi open markets ──────────────────────────────────────────
    try {
      const { data: kd } = await axios.get(`${KALSHI_BASE}/markets`, {
        params: { status: "open", limit: 200 },
        timeout: 8000,
      });
      const kMarkets = (kd?.markets ?? []) as any[];
      for (const m of kMarkets) {
        const id = `kalshi-${m.ticker}`;
        const stored = betMap.get(id);
        if (!stored) continue; // not a bet we're tracking
        const priceStr = m.yes_ask_dollars ?? m.yes_bid_dollars ?? m.last_price_dollars ?? null;
        const newYes = priceStr !== null ? parseFloat(priceStr) : ((m.yes_bid ?? m.last_price ?? 50) / 100);
        const newNo = 1 - newYes;
        const newImplied = newYes; // implied prob of the "yes" outcome

        const delta = newImplied - stored.impliedProb;
        if (Math.abs(delta) < 0.005) continue; // < 0.5% change — skip

        // Compute movement metrics
        const priceMovement: "up" | "down" | "neutral" = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
        const priceMovementPct = stored.impliedProb > 0
          ? Math.round((delta / stored.impliedProb) * 10000) / 100
          : 0;

        // American odds for over/under
        const liveOddsOver = newYes >= 0.5
          ? Math.round(-(newYes / (1 - newYes)) * 100)
          : Math.round(((1 - newYes) / newYes) * 100);
        const liveOddsUnder = newNo >= 0.5
          ? Math.round(-(newNo / (1 - newNo)) * 100)
          : Math.round(((1 - newNo) / newNo) * 100);

        await storage.patchBetLivePrice(id, {
          prevImpliedProb: stored.impliedProb,
          priceMovement,
          priceMovementPct,
          liveOddsOver,
          liveOddsUnder,
        });
        // Mispricing detection — run on every tick
        const misp = computeMispricing(stored.confidenceScore, newImplied);
        if (misp.isMispriced) {
          await storage.patchBetMispricing(id, {
            fairValue: misp.fairValue,
            mispricingEdge: misp.mispricingEdge,
            entryPrice: misp.entryPrice,
            exitTarget: misp.exitTarget,
            isMispriced: true,
            mispricingDirection: misp.mispricingDirection,
          });
        }
        updates.push({ id, prevImpliedProb: stored.impliedProb, newImpliedProb: newImplied, priceMovement, priceMovementPct, liveOddsOver, liveOddsUnder, mispricing: misp.isMispriced ? misp : undefined });
      }
    } catch (e: any) {
      console.warn("[live-poll] Kalshi error:", e.message);
    }

    // ── 3. Fetch Polymarket sports events ────────────────────────────────────
    try {
      const { data: pd } = await axios.get(`${POLY_BASE}/events`, {
        params: { limit: 200, active: true, tag_slug: "sports" },
        timeout: 8000,
      });
      const events = Array.isArray(pd) ? pd : (pd?.events ?? pd?.data ?? []);
      for (const ev of events) {
        for (const m of (ev.markets ?? [])) {
          const id = `poly-${m.id ?? ev.id}`;
          const stored = betMap.get(id);
          if (!stored) continue;

          const newYes = parseFloat(m.outcomePrices?.[0] ?? m.lastTradePrice ?? 0.5);
          const newNo = 1 - newYes;
          const delta = newYes - stored.impliedProb;
          if (Math.abs(delta) < 0.005) continue;

          const priceMovement: "up" | "down" | "neutral" = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
          const priceMovementPct = stored.impliedProb > 0
            ? Math.round((delta / stored.impliedProb) * 10000) / 100
            : 0;

          const liveOddsOver = newYes >= 0.5
            ? Math.round(-(newYes / (1 - newYes)) * 100)
            : Math.round(((1 - newYes) / newYes) * 100);
          const liveOddsUnder = newNo >= 0.5
            ? Math.round(-(newNo / (1 - newNo)) * 100)
            : Math.round(((1 - newNo) / newNo) * 100);

          await storage.patchBetLivePrice(id, {
            prevImpliedProb: stored.impliedProb,
            priceMovement,
            priceMovementPct,
            liveOddsOver,
            liveOddsUnder,
          });
          // Mispricing detection
          const misp = computeMispricing(stored.confidenceScore, newYes);
          if (misp.isMispriced) {
            await storage.patchBetMispricing(id, {
              fairValue: misp.fairValue,
              mispricingEdge: misp.mispricingEdge,
              entryPrice: misp.entryPrice,
              exitTarget: misp.exitTarget,
              isMispriced: true,
              mispricingDirection: misp.mispricingDirection,
            });
          }
          updates.push({ id, prevImpliedProb: stored.impliedProb, newImpliedProb: newYes, priceMovement, priceMovementPct, liveOddsOver, liveOddsUnder, mispricing: misp.isMispriced ? misp : undefined });
        }
      }
    } catch (e: any) {
      console.warn("[live-poll] Polymarket error:", e.message);
    }
  } catch (e: any) {
    console.warn("[live-poll] outer error:", e.message);
  }

  return updates;
}
