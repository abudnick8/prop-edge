/**
 * Baseball Trigger Engine — Clubhouse IQ
 *
 * Architecture:
 *   - MLB GUMBO live feed polling every 2s per active game (no public WS from MLB)
 *   - The-Odds-API REST polling every 30s for ML odds (free tier — no WS available)
 *   - Event normalization → Markov win-probability → trigger evaluation → debounce → broadcast
 *   - Latency tracked: sourceTs → receiveTs → computeTs → alertTs
 *
 * Trigger Tiers:
 *   Tier 1 (CRITICAL): Late-inning, tie/1-run, RISP; extra innings; bullpen downgrade
 *   Tier 2 (HIGH):     Steal/wild-pitch/PB/pickoff changing base state; sudden leadoff HR
 *   Tier 3 (WATCH):    Edge shift ≥5%, model vs market divergence
 */

import axios from "axios";
import { broadcast } from "./ws";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchupData {
  batterId:    number;
  pitcherId:   number;
  batterName:  string;
  pitcherName: string;
  batSide:     "L" | "R" | "S";   // batter handedness
  pitchHand:   "L" | "R";         // pitcher handedness
  // Batter stats
  batterAvgVsPitchHand: number;   // AVG vs this pitcher's hand (2026)
  batterObpVsPitchHand: number;
  batterSlgVsPitchHand: number;
  batterHRRate:   number;          // HR per PA vs this hand
  batterKRate:    number;          // K per PA vs this hand
  batterBBRate:   number;          // BB per PA vs this hand
  batterRecent15: number;          // AVG last 15 days (form)
  batterBvpAvg:   number | null;   // career AVG vs this specific pitcher (null if <4 PA)
  batterBvpPA:    number;          // career PA vs this pitcher
  // Pitcher stats
  pitcherEra:          number;
  pitcherWhip:         number;
  pitcherK9:           number;
  pitcherBB9:          number;
  pitcherAvgVsBatSide: number;     // AVG allowed vs this batter's hand
  pitcherHRPer9:       number;
  fetchedAt: number;
}

export interface GameState {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  inning: number;
  isTopInning: boolean;
  outs: number;
  runnersOn: { first: boolean; second: boolean; third: boolean };
  pitcherName: string;
  batterName: string;
  batterId:   number | null;
  pitcherId:  number | null;
  batSide:    string;
  pitchHand:  string;
  abstractGameState: "Preview" | "Live" | "Final";
  detailedState: string;
  lastPlay: string;
  lastEventType: string; // "strikeout","walk","hit","homeRun","stolenBase","wildPitch",...
  balls: number;
  strikes: number;
  currentPitchCount: number;
  homeProbWin: number;   // Markov model 0–1
  marketHomeProbWin: number | null; // from odds API 0–1
  edge: number | null;   // homeProbWin - marketHomeProbWin, signed
  matchup: MatchupData | null;  // live BvP matchup data
  sourceTs: number;
  receiveTs: number;
  computeTs: number;
}

export interface TriggerAlert {
  id: string;
  gamePk: number;
  tier: 1 | 2 | 3;
  type: string;
  headline: string;
  body: string;
  situation: string;
  swingTeam: string;  // team that could benefit most from next play
  swingScenarios: string[];  // "Double play ends threat" / "Walk-off HR possible"
  favoredTeam: string;
  underdogTeam: string;
  modelEdge: number | null;
  triggerScore: number;
  sourceTs: number;
  receiveTs: number;
  computeTs: number;
  alertTs: number;
  latencyMs: { ingest: number; compute: number; total: number };
}

// ─── State ────────────────────────────────────────────────────────────────────

const gameStates = new Map<number, GameState>();
const lastAlertByType = new Map<string, { ts: number; edge: number | null }>();
const sseClients = new Set<any>(); // SSE res objects
let engineRunning = false;
let lastOddsTs = 0;
let lastGumboTs: Record<number, number> = {};
let oddsMap: Record<string, { homeML: number; awayML: number }> = {};
const alertHistory: TriggerAlert[] = []; // last 50 alerts

// ─── Matchup cache: keyed "batterId_pitcherId", TTL 20 min ────────────────────
const _matchupCache: Record<string, { ts: number; data: MatchupData }> = {};
const MATCHUP_TTL_MS = 20 * 60 * 1000;

async function fetchMatchupData(
  batterId: number, pitcherId: number,
  batterName: string, pitcherName: string,
  batSide: string, pitchHand: string,
): Promise<MatchupData | null> {
  const key = `${batterId}_${pitcherId}`;
  const cached = _matchupCache[key];
  if (cached && Date.now() - cached.ts < MATCHUP_TTL_MS) return cached.data;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const d15 = new Date(); d15.setDate(d15.getDate() - 15);
    const d15s = d15.toISOString().slice(0, 10);

    // Normalise handedness codes
    const pitchSitCode = pitchHand === "L" ? "vl" : "vr";  // batter vs L or R pitcher
    const batSitCode   = batSide  === "L" ? "vl" : "vr";   // pitcher vs L or R batter

    const [
      rBatterHand, rBatterRecent, rBvP, rPitcherSeason, rPitcherHand
    ] = await Promise.allSettled([
      // 1. Batter vs pitcher hand (2026)
      axios.get(`https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=${pitchSitCode}`, { timeout: 6000 }),
      // 2. Batter last 15 days
      axios.get(`https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=byDateRange&group=hitting&season=2026&startDate=${d15s}&endDate=${today}`, { timeout: 6000 }),
      // 3. BvP career vs this specific pitcher
      axios.get(`https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}&season=2026`, { timeout: 6000 }),
      // 4. Pitcher season (ERA, WHIP, K/9, BB/9, HR/9)
      axios.get(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching&season=2026`, { timeout: 6000 }),
      // 5. Pitcher vs batter hand
      axios.get(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=2026&sitCodes=${batSitCode}`, { timeout: 6000 }),
    ]);

    // Parse batter vs pitcher hand
    const bhs = rBatterHand.status === "fulfilled"
      ? rBatterHand.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}
      : {};
    const batterAvgVsPitchHand = parseFloat(bhs.avg ?? "0") || 0.250;
    const batterObpVsPitchHand = parseFloat(bhs.obp ?? "0") || 0.320;
    const batterSlgVsPitchHand = parseFloat(bhs.slg ?? "0") || 0.380;
    const bAtBats = bhs.atBats ?? 0;
    const bHR     = bhs.homeRuns ?? 0;
    const bK      = bhs.strikeOuts ?? 0;
    const bBB     = bhs.baseOnBalls ?? 0;
    const bPA     = bAtBats + bBB + (bhs.hitByPitch ?? 0) + (bhs.sacFlies ?? 0) || 1;
    const batterHRRate = bHR / bPA;
    const batterKRate  = bK  / bPA;
    const batterBBRate = bBB / bPA;

    // Parse batter recent 15d
    const rec = rBatterRecent.status === "fulfilled"
      ? rBatterRecent.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}
      : {};
    const batterRecent15 = parseFloat(rec.avg ?? "0") || batterAvgVsPitchHand;

    // Parse BvP
    const bvpStat = rBvP.status === "fulfilled"
      ? rBvP.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}
      : {};
    const bvpPA  = bvpStat.plateAppearances ?? 0;
    const bvpAvg = bvpPA >= 4 ? (parseFloat(bvpStat.avg ?? "0") || null) : null;

    // Parse pitcher season
    const pss = rPitcherSeason.status === "fulfilled"
      ? rPitcherSeason.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}
      : {};
    const pitcherEra  = parseFloat(pss.era  ?? "4.50") || 4.50;
    const pitcherWhip = parseFloat(pss.whip ?? "1.30") || 1.30;
    const pitcherK9   = parseFloat(pss.strikeoutsPer9Inn ?? "8.0") || 8.0;
    const pitcherBB9  = parseFloat(pss.walksPer9Inn      ?? "3.0") || 3.0;
    const ip          = parseFloat(pss.inningsPitched    ?? "1")   || 1;
    const pitcherHRPer9 = ((pss.homeRuns ?? 1) / ip) * 9;

    // Parse pitcher vs batter hand
    const phs = rPitcherHand.status === "fulfilled"
      ? rPitcherHand.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}
      : {};
    const pitcherAvgVsBatSide = parseFloat(phs.avg ?? "0") || parseFloat(pss.avg ?? "0.250") || 0.250;

    const data: MatchupData = {
      batterId, pitcherId, batterName, pitcherName,
      batSide: (batSide || "R") as "L" | "R" | "S",
      pitchHand: (pitchHand || "R") as "L" | "R",
      batterAvgVsPitchHand, batterObpVsPitchHand, batterSlgVsPitchHand,
      batterHRRate, batterKRate, batterBBRate,
      batterRecent15, batterBvpAvg: bvpAvg, batterBvpPA: bvpPA,
      pitcherEra, pitcherWhip, pitcherK9, pitcherBB9,
      pitcherAvgVsBatSide, pitcherHRPer9,
      fetchedAt: Date.now(),
    };

    _matchupCache[key] = { ts: Date.now(), data };
    console.log(`[TriggerEngine] matchup fetched: ${batterName} vs ${pitcherName} | BvP AVG: ${bvpAvg ?? "N/A"} (${bvpPA} PA) | batter ${pitchSitCode}: ${batterAvgVsPitchHand.toFixed(3)}`);
    return data;
  } catch (e: any) {
    console.warn(`[TriggerEngine] matchup fetch error ${batterId} vs ${pitcherId}:`, e.message);
    return null;
  }
}

// ─── SSE client management ────────────────────────────────────────────────────

export function addSseClient(res: any) {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

function broadcastSse(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

// ─── Win Probability — Markov model ──────────────────────────────────────────
// Simplified inning-state model. Uses run expectancy table and score delta.
// Good enough for real-time triggering; replace with full Markov matrix later.

const RUN_EXPECTANCY: Record<string, number> = {
  // bases_outs → expected runs remainder of inning
  "000_0": 0.555, "000_1": 0.297, "000_2": 0.117,
  "100_0": 0.953, "100_1": 0.573, "100_2": 0.251,
  "020_0": 1.189, "020_1": 0.725, "020_2": 0.344,
  "003_0": 1.482, "003_1": 0.983, "003_2": 0.387,
  "120_0": 1.588, "120_1": 0.981, "120_2": 0.457,
  "103_0": 1.900, "103_1": 1.243, "103_2": 0.502,
  "023_0": 2.050, "023_1": 1.467, "023_2": 0.648,
  "123_0": 2.417, "123_1": 1.811, "123_2": 0.799,
};

function baseKey(s: GameState): string {
  const b = s.runnersOn;
  return `${b.first ? "1" : "0"}${b.second ? "2" : "0"}${b.third ? "3" : "0"}_${s.outs}`;
}

function runExpectancy(s: GameState): number {
  return RUN_EXPECTANCY[baseKey(s)] ?? 0.3;
}

/**
 * Compute home win probability using:
 *   - Score delta
 *   - Innings remaining
 *   - Run expectancy in current half-inning
 */
export function computeWinProbability(s: GameState): number {
  if (s.abstractGameState === "Final") return s.homeScore > s.awayScore ? 1 : 0;
  if (s.abstractGameState === "Preview") return 0.5;

  const scoreDelta = s.homeScore - s.awayScore; // positive = home leading
  const inningsRemaining = Math.max(0, 9 - s.inning + (s.isTopInning ? 0.5 : 0));
  const runEx = runExpectancy(s);

  // Sigmoid on score delta weighted by innings remaining
  // The later the inning, the more a 1-run lead matters
  const leverage = inningsRemaining <= 0 ? 10 : (3.0 / inningsRemaining);
  const effectiveDelta = scoreDelta + (s.isTopInning ? -runEx : runEx) * 0.3;
  const logit = effectiveDelta * leverage;
  const prob = 1 / (1 + Math.exp(-logit));

  // Clamp to 5–95% (never fully certain mid-game)
  return Math.max(0.05, Math.min(0.95, prob));
}

// ─── Odds ingestion ───────────────────────────────────────────────────────────

function impliedProb(ml: number): number {
  if (ml === 0) return 0.5;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

async function fetchOdds(): Promise<void> {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    console.warn("[TriggerEngine] ODDS_API_KEY not set — running model-only mode");
    lastOddsTs = Date.now(); // prevent repeated log spam
    return;
  }
  try {
    const r = await axios.get(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${key}&regions=us&markets=h2h&oddsFormat=american`,
      { timeout: 10000 }
    );
    if (!Array.isArray(r.data)) {
      console.warn("[TriggerEngine] odds API unexpected response:", JSON.stringify(r.data).slice(0, 200));
      lastOddsTs = Date.now();
      return;
    }
    const newMap: Record<string, { homeML: number; awayML: number }> = {};
    for (const game of r.data) {
      const homeTeam: string = game.home_team ?? "";
      const bk = game.bookmakers?.[0];
      if (!bk) continue;
      const market = bk.markets?.find((m: any) => m.key === "h2h");
      if (!market) continue;
      const homeOutcome = market.outcomes?.find((o: any) => o.name === homeTeam);
      const awayOutcome = market.outcomes?.find((o: any) => o.name !== homeTeam);
      if (homeOutcome && awayOutcome) {
        newMap[homeTeam] = { homeML: homeOutcome.price, awayML: awayOutcome.price };
      }
    }
    const count = Object.keys(newMap).length;
    console.log(`[TriggerEngine] odds refreshed — ${count} games with ML lines`);
    oddsMap = newMap;
    lastOddsTs = Date.now();
  } catch (e: any) {
    console.warn("[TriggerEngine] odds fetch failed:", e.message, "| remaining map:", Object.keys(oddsMap).length, "entries");
    // Keep lastOddsTs stale so UI shows orange freshness warning
    // but don't clear existing odds — they degrade gracefully
  }
}

// ─── GUMBO live feed polling ──────────────────────────────────────────────────

async function fetchGumboState(gamePk: number): Promise<any | null> {
  try {
    // NOTE: do NOT use ?fields= filter — it strips gameData/liveData contents entirely
    const r = await axios.get(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
      { timeout: 8000 }
    );
    return r.data;
  } catch (e: any) {
    console.warn(`[TriggerEngine] GUMBO fetch failed gamePk=${gamePk}:`, e.message);
    return null;
  }
}

function parseGumboState(gamePk: number, raw: any): GameState | null {
  const receiveTs = Date.now();
  try {
    const gd = raw.gameData ?? {};
    const ld = raw.liveData ?? {};
    const ls = ld.linescore ?? {};
    const plays = ld.plays ?? {};
    const currentPlay = plays.currentPlay ?? {};
    const matchup = currentPlay.matchup ?? {};
    const result = currentPlay.result ?? {};
    const count = currentPlay.count ?? {};

    const homeTeam: string = gd.teams?.home?.teamName ?? gd.teams?.home?.name ?? "";
    const awayTeam: string = gd.teams?.away?.teamName ?? gd.teams?.away?.name ?? "";
    const homeScore: number = ls.teams?.home?.runs ?? gd.teams?.home?.score ?? 0;
    const awayScore: number = ls.teams?.away?.runs ?? gd.teams?.away?.score ?? 0;
    const inning: number = ls.currentInning ?? 1;
    const isTopInning: boolean = ls.isTopInning ?? true;
    const outs: number = Math.min(2, ls.outs ?? 0);

    const offense = ls.offense ?? {};
    const runnersOn = {
      first:  !!offense.first,
      second: !!offense.second,
      third:  !!offense.third,
    };

    const abstractGameState: "Preview" | "Live" | "Final" =
      (gd.status?.abstractGameState as any) ?? "Preview";
    const detailedState: string = gd.status?.detailedState ?? "";

    const pitcherName: string = matchup.pitcher?.fullName ?? ls.defense?.pitcher?.fullName ?? "";
    const batterName: string  = matchup.batter?.fullName  ?? ls.offense?.batter?.fullName  ?? "";
    const batterId:   number | null = matchup.batter?.id   ?? null;
    const pitcherId:  number | null = matchup.pitcher?.id  ?? null;
    const batSide:  string = matchup.batSide?.code  ?? "R";
    const pitchHand: string = matchup.pitchHand?.code ?? "R";
    const lastPlay: string    = result.description ?? "";
    const lastEventType: string = result.event ?? "";
    const balls: number   = count.balls   ?? 0;
    const strikes: number = count.strikes ?? 0;
    const currentPitchCount: number = currentPlay.pitchIndex?.length ?? 0;

    const sourceTs: number = raw.metaData?.timeStamp
      ? new Date(raw.metaData.timeStamp).getTime()
      : receiveTs;

    // Pull matchup from cache (background-fetched, non-blocking)
    const matchupKey = batterId && pitcherId ? `${batterId}_${pitcherId}` : null;
    const cachedMatchup = matchupKey && _matchupCache[matchupKey]?.data
      ? _matchupCache[matchupKey].data
      : null;

    const partial: GameState = {
      gamePk, homeTeam, awayTeam, homeScore, awayScore,
      inning, isTopInning, outs, runnersOn,
      pitcherName, batterName, batterId, pitcherId, batSide, pitchHand,
      abstractGameState, detailedState,
      lastPlay, lastEventType,
      balls, strikes, currentPitchCount,
      homeProbWin: 0.5,
      marketHomeProbWin: null,
      edge: null,
      matchup: cachedMatchup,
      sourceTs, receiveTs, computeTs: 0,
    };

    // Kick off background matchup fetch if batter/pitcher changed or cache miss
    if (batterId && pitcherId && !cachedMatchup) {
      fetchMatchupData(batterId, pitcherId, batterName, pitcherName, batSide, pitchHand)
        .catch(() => {}); // background, non-blocking
    }

    partial.homeProbWin = computeWinProbability(partial);

    // Attach market probability
    const odds = oddsMap[homeTeam];
    if (odds) {
      const rawHome = impliedProb(odds.homeML);
      const rawAway = impliedProb(odds.awayML);
      const total = rawHome + rawAway;
      partial.marketHomeProbWin = total > 0 ? rawHome / total : rawHome; // remove vig
      partial.edge = parseFloat((partial.homeProbWin - partial.marketHomeProbWin).toFixed(4));
    }

    partial.computeTs = Date.now();
    return partial;
  } catch (e: any) {
    console.warn(`[TriggerEngine] parse error gamePk=${gamePk}:`, e.message);
    return null;
  }
}

// ─── Trigger evaluation ───────────────────────────────────────────────────────

function isMeaningfulChange(prev: GameState | undefined, next: GameState): boolean {
  if (!prev) return true;
  if (prev.homeScore !== next.homeScore || prev.awayScore !== next.awayScore) return true;
  if (prev.inning !== next.inning || prev.isTopInning !== next.isTopInning) return true;
  if (prev.outs !== next.outs) return true;
  const prevR = prev.runnersOn;
  const nextR = next.runnersOn;
  if (prevR.first !== nextR.first || prevR.second !== nextR.second || prevR.third !== nextR.third) return true;
  if (prev.pitcherName !== next.pitcherName) return true; // bullpen change
  if (Math.abs((prev.homeProbWin ?? 0.5) - next.homeProbWin) >= 0.04) return true;
  return false;
}

function assessLeverage(s: GameState): number {
  // Leverage Index approximation: high in late innings, close games, runners on
  const runnersCount = [s.runnersOn.first, s.runnersOn.second, s.runnersOn.third].filter(Boolean).length;
  const scoreDelta   = Math.abs(s.homeScore - s.awayScore);
  const inningWeight = s.inning >= 7 ? (s.inning >= 9 ? 3.0 : 2.0) : s.inning >= 5 ? 1.4 : 1.0;
  const closeGame    = scoreDelta <= 1 ? 2.0 : scoreDelta <= 2 ? 1.4 : 1.0;
  const runnersBoost = runnersCount >= 2 ? 1.5 : runnersCount === 1 ? 1.2 : 1.0;
  return inningWeight * closeGame * runnersBoost;
}

function buildSwingScenarios(s: GameState, tier: number): string[] {
  const scenarios: string[] = [];
  const scoreDelta = s.homeScore - s.awayScore;
  const leadingTeam = scoreDelta > 0 ? s.homeTeam : scoreDelta < 0 ? s.awayTeam : "Tied";
  const trailingTeam = scoreDelta > 0 ? s.awayTeam : s.homeTeam;

  const r = s.runnersOn;
  const hasRunners = r.first || r.second || r.third;
  const isLate = s.inning >= 7;
  const isClose = Math.abs(scoreDelta) <= 1;
  const isExtra = s.inning > 9;

  if (isExtra) {
    scenarios.push("Walk-off hit wins it instantly — any extra-base hit likely ends the game");
    scenarios.push("Wild pitch or passed ball could score the runner from 2nd");
  }
  if (isLate && isClose && r.second) {
    scenarios.push("Sacrifice fly or single to center scores the go-ahead run");
    scenarios.push("Double play kills the rally — 2 outs quickly clears the threat");
  }
  if (isLate && isClose && r.first) {
    scenarios.push("Stolen base advances runner into scoring position — stolen base attempt likely");
    scenarios.push("Ground-rule double puts runners at 2nd & 3rd with less than 2 outs");
  }
  if (s.outs === 2 && hasRunners && isClose) {
    scenarios.push("2-out clutch hit — pitcher one strike away from escaping; high-leverage pitch");
    scenarios.push("Walk extends the inning and forces another batter in the spot");
  }
  if (!hasRunners && isLate && isClose) {
    scenarios.push("Leadoff hit or walk becomes massive — opens the door to a rally");
    scenarios.push("Leadoff strikeout or groundout nearly locks in current result");
  }
  if (s.lastEventType.toLowerCase().includes("pitchingsubstitution") || 
      s.lastEventType.toLowerCase().includes("bullpen")) {
    scenarios.push("Bullpen change — fresh arm vs lineup that may struggle against new handedness");
    scenarios.push("If reliever blows the lead, market will reprice immediately");
  }

  return scenarios.slice(0, 3);
}

function evaluateTrigger(prev: GameState | undefined, curr: GameState): TriggerAlert | null {
  if (curr.abstractGameState !== "Live") return null;
  if (!isMeaningfulChange(prev, curr)) return null;

  const scoreDelta   = curr.homeScore - curr.awayScore;
  const isClose      = Math.abs(scoreDelta) <= 1;
  const isLate       = curr.inning >= 7;
  const isExtra      = curr.inning > 9;
  const runnersOn    = [curr.runnersOn.first, curr.runnersOn.second, curr.runnersOn.third];
  const runnersCount = runnersOn.filter(Boolean).length;
  const risp         = curr.runnersOn.second || curr.runnersOn.third;
  const leverage     = assessLeverage(curr);
  const edge         = curr.edge;
  const edgeAbs      = edge !== null ? Math.abs(edge) : 0;
  const pitcherChanged = prev ? prev.pitcherName !== curr.pitcherName && curr.pitcherName !== "" : false;

  // Tier 1 conditions
  const isTier1 =
    (isExtra) ||
    (isLate && isClose && risp && curr.outs < 2) ||
    (isLate && isClose && runnersCount >= 2) ||
    (pitcherChanged && isLate && isClose) ||
    (isLate && curr.inning >= 9 && Math.abs(scoreDelta) === 0);

  // Tier 2 conditions
  const isTier2 =
    ["stolenBase", "wildPitch", "passedBall", "pickoff", "homeRun"].includes(curr.lastEventType) ||
    (risp && isClose && curr.outs === 0 && !isLate) ||
    (edgeAbs >= 0.10 && !isTier1);

  // Tier 3 conditions (market edge shifts)
  const isTier3 =
    edgeAbs >= 0.05 ||
    (runnersCount >= 2 && leverage >= 1.5);

  const tier: 1 | 2 | 3 = isTier1 ? 1 : isTier2 ? 2 : isTier3 ? 3 : 3;
  const triggerScore = Math.round(Math.min(100, leverage * 20 + edgeAbs * 200));

  // Cooldown — same trigger key per game must show material improvement
  const cooldownKey = `${curr.gamePk}_t${tier}_${curr.inning}_${curr.isTopInning ? "T" : "B"}`;
  const last = lastAlertByType.get(cooldownKey);
  const cooldownMs = tier === 1 ? 60_000 : tier === 2 ? 90_000 : 180_000;
  const now = Date.now();
  if (last) {
    const edgeImproved = edge !== null && last.edge !== null && Math.abs(edge) > Math.abs(last.edge) + 0.04;
    if (now - last.ts < cooldownMs && !edgeImproved) return null;
  }

  // Build alert
  const favoredTeam  = curr.homeProbWin >= 0.5 ? curr.homeTeam : curr.awayTeam;
  const underdogTeam = curr.homeProbWin >= 0.5 ? curr.awayTeam : curr.homeTeam;
  const swingTeam    = scoreDelta < 0 ? curr.homeTeam : curr.awayTeam; // trailing team benefits most

  let headline = "";
  let alertType = "";
  if (isExtra) {
    headline = `EXTRA INNINGS — ${curr.homeTeam} ${curr.homeScore}–${curr.awayScore} ${curr.awayTeam}`;
    alertType = "extra_innings";
  } else if (pitcherChanged) {
    headline = `BULLPEN CHANGE — ${curr.pitcherName} now pitching for ${curr.homeScore > curr.awayScore ? curr.homeTeam : curr.awayTeam}`;
    alertType = "bullpen_change";
  } else if (curr.lastEventType === "homeRun") {
    headline = `HOME RUN — ${curr.batterName} shifts momentum`;
    alertType = "home_run";
  } else if (risp && isLate && isClose) {
    const baseDesc = [
      curr.runnersOn.first ? "1st" : "",
      curr.runnersOn.second ? "2nd" : "",
      curr.runnersOn.third ? "3rd" : "",
    ].filter(Boolean).join(" & ");
    headline = `HIGH LEVERAGE — ${curr.inning}${curr.isTopInning ? "T" : "B"} | Runners on ${baseDesc} | ${curr.outs} out | Tie/±1`;
    alertType = "late_risp";
  } else if (curr.lastEventType === "stolenBase") {
    headline = `STOLEN BASE — ${curr.batterName} advances, changes run expectancy`;
    alertType = "stolen_base";
  } else if (["wildPitch", "passedBall"].includes(curr.lastEventType)) {
    headline = `${curr.lastEventType === "wildPitch" ? "WILD PITCH" : "PASSED BALL"} — hidden run event`;
    alertType = curr.lastEventType;
  } else if (edgeAbs >= 0.05) {
    const dir = edge !== null && edge > 0 ? "HOME" : "AWAY";
    headline = `MARKET EDGE — ${dir} model edge ${Math.round(edgeAbs * 100)}% vs market`;
    alertType = "market_edge";
  } else {
    headline = `STATE CHANGE — ${curr.homeTeam} ${curr.homeScore}–${curr.awayScore} ${curr.awayTeam} | ${curr.inning}${curr.isTopInning ? "T" : "B"}`;
    alertType = "state_change";
  }

  const inningStr = `${curr.inning}${curr.isTopInning ? "T" : "B"}`;
  const runnerDesc = runnersCount === 0 ? "bases empty"
    : [curr.runnersOn.first && "1st", curr.runnersOn.second && "2nd", curr.runnersOn.third && "3rd"]
        .filter(Boolean).join(", ") + " on";
  const body = `${inningStr} | ${curr.outs} out | ${runnerDesc} | Score: ${curr.awayTeam} ${curr.awayScore}–${curr.homeScore} ${curr.homeTeam}`;

  const swingScenarios = buildSwingScenarios(curr, tier);

  const alertTs = Date.now();
  const alert: TriggerAlert = {
    id: `${curr.gamePk}_${alertTs}`,
    gamePk: curr.gamePk,
    tier,
    type: alertType,
    headline,
    body,
    situation: body,
    swingTeam,
    swingScenarios,
    favoredTeam,
    underdogTeam,
    modelEdge: edge !== null ? parseFloat((edge * 100).toFixed(1)) : null,
    triggerScore,
    sourceTs: curr.sourceTs,
    receiveTs: curr.receiveTs,
    computeTs: curr.computeTs,
    alertTs,
    latencyMs: {
      ingest:  curr.receiveTs - curr.sourceTs,
      compute: curr.computeTs - curr.receiveTs,
      total:   alertTs - curr.sourceTs,
    },
  };

  lastAlertByType.set(cooldownKey, { ts: alertTs, edge });
  alertHistory.unshift(alert);
  if (alertHistory.length > 50) alertHistory.pop();

  return alert;
}

// ─── Game discovery — find today's live/upcoming games ───────────────────────

async function fetchTodayGamePks(): Promise<number[]> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // NOTE: do NOT use ?fields= filter — it strips nested status fields
    const r = await axios.get(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&gameType=R`,
      { timeout: 8000 }
    );
    const games: any[] = r.data?.dates?.[0]?.games ?? [];
    return games
      .filter((g: any) => {
        const state = g.status?.abstractGameState ?? "";
        return ["Live", "Preview", "Warmup"].includes(state);
      })
      .map((g: any) => g.gamePk)
      .filter(Boolean);
  } catch (e: any) {
    console.warn("[TriggerEngine] schedule fetch failed:", e.message);
    return [];
  }
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

let activeGamePks: Set<number> = new Set();
let scheduleLastFetched = 0;
let engineStatus = {
  running: false,
  activeGames: 0,
  lastOddsTs: 0,
  lastGumboTs: {} as Record<number, number>,
  alertCount: 0,
  errors: 0,
};

async function pollGame(gamePk: number) {
  const raw = await fetchGumboState(gamePk);
  if (!raw) { engineStatus.errors++; return; }

  const prev = gameStates.get(gamePk);
  const curr = parseGumboState(gamePk, raw);
  if (!curr) { engineStatus.errors++; return; }

  gameStates.set(gamePk, curr);
  lastGumboTs[gamePk] = Date.now();
  engineStatus.lastGumboTs = { ...lastGumboTs };

  // Broadcast full state to WS clients
  broadcast("mlb:gameState", {
    gamePk,
    state: curr,
    secsSinceSource: Math.round((Date.now() - curr.sourceTs) / 1000),
  });

  // Helper: fire Discord webhook for high-tier alerts
  function fireDiscord(a: TriggerAlert) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;
    axios.post(webhookUrl, {
      embeds: [{
        title: `⚾ ${a.headline}`,
        description: `${a.body}\n\n**Scenarios:**\n${a.swingScenarios.map(s => `• ${s}`).join("\n")}`,
        color: a.tier === 1 ? 0xFF4444 : a.tier === 2 ? 0xFF8C00 : 0x4488FF,
        footer: { text: `Edge: ${a.modelEdge != null ? a.modelEdge + "%" : "model only"} | Latency: ${a.latencyMs.total}ms | ${a.type}` },
        timestamp: new Date(a.alertTs).toISOString(),
      }]
    }).catch(() => {});
  }

  // Evaluate post-play trigger (fires after a meaningful state change)
  const alert = evaluateTrigger(prev, curr);
  if (alert) {
    engineStatus.alertCount++;
    console.log(`[TriggerEngine] TIER ${alert.tier} ALERT: ${alert.headline}`);
    broadcast("mlb:trigger", alert);
    broadcastSse("trigger", alert);
    if (alert.tier === 1) fireDiscord(alert);
  }

  // Evaluate pre-play anticipatory trigger (fires on current state BEFORE next pitch)
  const preAlert = evaluatePrePlayTrigger(curr);
  if (preAlert) {
    engineStatus.alertCount++;
    console.log(`[TriggerEngine] PRE-PLAY TIER ${preAlert.tier}: ${preAlert.headline}`);
    broadcast("mlb:trigger", preAlert);
    broadcastSse("trigger", preAlert);
    if (preAlert.tier === 1) fireDiscord(preAlert);
  }

  // Remove finished games
  if (curr.abstractGameState === "Final") {
    activeGamePks.delete(gamePk);
  }
}

async function mainLoop() {
  if (!engineRunning) return;

  const now = Date.now();

  // Refresh game list every 60s
  if (now - scheduleLastFetched > 60_000) {
    const pks = await fetchTodayGamePks();
    for (const pk of pks) activeGamePks.add(pk);
    scheduleLastFetched = now;
    engineStatus.activeGames = activeGamePks.size;
  }

  // Refresh odds every 30s
  if (now - lastOddsTs > 30_000) {
    fetchOdds().catch(() => {});
    engineStatus.lastOddsTs = lastOddsTs;
  }

  // Poll all active games in parallel (2s cadence enforced by interval)
  if (activeGamePks.size > 0) {
    await Promise.allSettled([...activeGamePks].map(pk => pollGame(pk)));
  }

  // Broadcast status to SSE clients every cycle
  broadcastSse("status", getEngineStatus());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getEngineStatus() {
  const now = Date.now();
  const gumboFreshness: Record<number, number> = {};
  for (const [pk, ts] of Object.entries(lastGumboTs)) {
    gumboFreshness[Number(pk)] = Math.round((now - ts) / 1000);
  }

  return {
    running: engineRunning,
    activeGames: activeGamePks.size,
    gamePks: [...activeGamePks],
    lastOddsSecs: lastOddsTs ? Math.round((now - lastOddsTs) / 1000) : null,
    lastGumboSecs: gumboFreshness,
    alertCount: engineStatus.alertCount,
    errors: engineStatus.errors,
    recentAlerts: alertHistory.slice(0, 10),
    gameStates: Object.fromEntries(
      [...gameStates.entries()].map(([pk, s]) => [pk, {
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        homeScore: s.homeScore,
        awayScore: s.awayScore,
        inning: s.inning,
        isTopInning: s.isTopInning,
        outs: s.outs,
        runnersOn: s.runnersOn,
        homeProbWin: s.homeProbWin,
        marketHomeProbWin: s.marketHomeProbWin,
        edge: s.edge,
        abstractGameState: s.abstractGameState,
        pitcherName: s.pitcherName,
        batterName: s.batterName,
        lastEventType: s.lastEventType,
        secsSinceUpdate: Math.round((now - s.receiveTs) / 1000),
        matchup: s.matchup ? {
          batterName:           s.matchup.batterName,
          pitcherName:          s.matchup.pitcherName,
          batSide:              s.matchup.batSide,
          pitchHand:            s.matchup.pitchHand,
          batterAvgVsPitchHand: s.matchup.batterAvgVsPitchHand,
          batterRecent15:       s.matchup.batterRecent15,
          batterBvpAvg:         s.matchup.batterBvpAvg,
          batterBvpPA:          s.matchup.batterBvpPA,
          pitcherEra:           s.matchup.pitcherEra,
          pitcherK9:            s.matchup.pitcherK9,
          pitcherBB9:           s.matchup.pitcherBB9,
        } : null,
      }])
    ),
  };
}

export function getRecentAlerts(): TriggerAlert[] {
  return alertHistory.slice(0, 20);
}

export function startTriggerEngine() {
  if (engineRunning) return;
  engineRunning = true;
  engineStatus.running = true;
  console.log("[TriggerEngine] Starting — polling every 2s per game");

  // Immediate first run
  mainLoop().catch(console.error);

  // Poll every 2 seconds
  setInterval(() => {
    mainLoop().catch(console.error);
  }, 2_000);

  // Odds every 30s (independent of game poll)
  fetchOdds().catch(() => {});
  setInterval(() => fetchOdds().catch(() => {}), 30_000);
}

export function stopTriggerEngine() {
  engineRunning = false;
  engineStatus.running = false;
}

// ─── Pre-play anticipatory trigger ───────────────────────────────────────────
// Fires BEFORE the next pitch based on the current base/score/out state.
// Simulates the most probable next plays and calculates how much win probability
// would shift. If a single common play (single, out, HR, walk) would move WP
// by ≥12pp, fire an anticipatory alert so the user knows BEFORE it happens.

interface PlayOutcome {
  label: string;         // "Base hit", "Home run", "Out", etc.
  probability: number;   // 0–1 rough base rate
  homeScoreDelta: number;
  awayScoreDelta: number;
  newRunners: { first: boolean; second: boolean; third: boolean };
  newOuts: number;       // outs added (0 or 1); if 3 total → end half inning
  newHomeProbWin: number;
  wpShift: number;       // signed: positive = good for home, negative = good for away
}

function simulateNextPlay(curr: GameState): PlayOutcome[] {
  const outcomes: PlayOutcome[] = [];
  const r = curr.runnersOn;
  const isTopInning = curr.isTopInning;
  const m = curr.matchup; // live matchup data (may be null on first poll)

  // ── Derive matchup-adjusted probabilities ────────────────────────────────
  // League averages as baseline, then blend in matchup data when available.
  // Weights: 40% batter vs pitcher-hand, 30% pitcher ERA/K9 quality,
  //          20% batter recent form (L15), 10% BvP head-to-head history.

  const LG_AVG       = 0.248;  // 2026 MLB average
  const LG_OBP       = 0.318;
  const LG_HR_RATE   = 0.035;  // HR per PA
  const LG_K_RATE    = 0.228;
  const LG_BB_RATE   = 0.083;
  const LG_HIT_RATE  = LG_AVG; // approx
  const LG_XBH_RATE  = 0.082;  // non-HR extra base hits per PA

  let hitRate   = LG_HIT_RATE;
  let xbhRate   = LG_XBH_RATE;
  let hrRate    = LG_HR_RATE;
  let kRate     = LG_K_RATE;
  let bbRate    = LG_BB_RATE;

  if (m) {
    // Batter component: AVG vs pitcher hand + recent form
    const batterAdj  = m.batterAvgVsPitchHand * 0.40 + m.batterRecent15 * 0.20;
    const bvpAdj     = m.batterBvpAvg != null && m.batterBvpPA >= 10
      ? m.batterBvpAvg * 0.10 : batterAdj * 0.10;
    const pitcherAdj = m.pitcherAvgVsBatSide * 0.30;
    hitRate = batterAdj + pitcherAdj + bvpAdj;

    // SLG-based XBH rate: if batter slugs well vs this arm, more XBH
    const batterSLGAdj = (m.batterSlgVsPitchHand - m.batterAvgVsPitchHand) * 0.35;
    xbhRate = Math.max(0.03, Math.min(0.15, LG_XBH_RATE + batterSLGAdj));

    // HR rate: blended batter HR/PA vs this arm + pitcher HR/9 context
    const pitcherHRFactor = m.pitcherHRPer9 / 9; // per PA estimate
    hrRate = Math.max(0.005, Math.min(0.12,
      m.batterHRRate * 0.50 + pitcherHRFactor * 0.30 + LG_HR_RATE * 0.20
    ));

    // K rate: pitcher K/9 scaled to per-PA, blended with batter K tendency
    const pitcherKPerPA = m.pitcherK9 / (27 + m.pitcherBB9 + m.pitcherK9 * 0.3);
    kRate = Math.max(0.05, Math.min(0.45,
      m.batterKRate * 0.45 + pitcherKPerPA * 0.40 + LG_K_RATE * 0.15
    ));

    // BB rate: pitcher BB/9 + batter BB tendency
    const pitcherBBPerPA = m.pitcherBB9 / 35;
    bbRate = Math.max(0.02, Math.min(0.20,
      m.batterBBRate * 0.40 + pitcherBBPerPA * 0.40 + LG_BB_RATE * 0.20
    ));

    // BvP override: if 15+ PA history, boost/suppress hit rate
    if (m.batterBvpAvg !== null && m.batterBvpPA >= 15) {
      const bvpWeight = Math.min(0.25, m.batterBvpPA / 60);
      hitRate = hitRate * (1 - bvpWeight) + m.batterBvpAvg * bvpWeight;
    }
  }

  // Normalise so probabilities sum reasonably (hit/xbh are subsets of outcomes)
  // Final PA outcome distribution:
  //   HR: hrRate | XBH (non-HR): xbhRate | Single: hitRate - xbhRate - hrRate
  //   BB: bbRate | K: kRate | Out (other): remainder
  const singleRate = Math.max(0, hitRate - xbhRate - hrRate);
  const outRate    = Math.max(0.10, 1 - singleRate - xbhRate - hrRate - bbRate - kRate);

  // Helper: build a hypothetical state and compute win prob
  function hypothetical(
    scoreDelta: { home: number; away: number },
    newRunners: { first: boolean; second: boolean; third: boolean },
    addOuts: number,
  ): number {
    const newOuts = Math.min(3, curr.outs + addOuts);
    const endHalf = newOuts >= 3;
    const hy: GameState = {
      ...curr,
      homeScore: curr.homeScore + scoreDelta.home,
      awayScore: curr.awayScore + scoreDelta.away,
      runnersOn: endHalf ? { first: false, second: false, third: false } : newRunners,
      outs: endHalf ? 0 : newOuts,
      inning: endHalf && !isTopInning ? curr.inning + 1 : curr.inning,
      isTopInning: endHalf ? !isTopInning : isTopInning,
    };
    return computeWinProbability(hy);
  }

  const runsOnSingle = (isTopInning ? -1 : 1) * (
    (r.third ? 1 : 0) + (r.second && curr.outs < 2 ? 1 : 0)
  );
  const runsOnDouble = (isTopInning ? -1 : 1) * (
    (r.third ? 1 : 0) + (r.second ? 1 : 0) + (r.first ? 1 : 0)
  );
  const runsOnHR = (isTopInning ? -1 : 1) * (
    1 + (r.first ? 1 : 0) + (r.second ? 1 : 0) + (r.third ? 1 : 0)
  );

  // ── Single ───────────────────────────────────────────────────────────────
  const singleRunners = { first: true, second: r.first, third: r.second && curr.outs >= 2 ? false : r.second };
  const singleProb = hypothetical(
    isTopInning ? { home: 0, away: -runsOnSingle } : { home: runsOnSingle, away: 0 },
    singleRunners, 0
  );
  const singleLabel = m
    ? `Single (batter ${m.batterAvgVsPitchHand.toFixed(3)} vs ${m.pitchHand}HP)`
    : "Base hit (single)";
  outcomes.push({
    label: singleLabel,
    probability: singleRate,
    homeScoreDelta: isTopInning ? 0 : runsOnSingle,
    awayScoreDelta: isTopInning ? Math.abs(runsOnSingle) : 0,
    newRunners: singleRunners, newOuts: 0,
    newHomeProbWin: singleProb, wpShift: singleProb - curr.homeProbWin,
  });

  // ── Extra-base hit (double) ───────────────────────────────────────────────
  const xbhRunners = { first: false, second: true, third: false };
  const xbhProb = hypothetical(
    isTopInning ? { home: 0, away: -runsOnDouble } : { home: runsOnDouble, away: 0 },
    xbhRunners, 0
  );
  outcomes.push({
    label: "Extra-base hit (double/triple)",
    probability: xbhRate,
    homeScoreDelta: isTopInning ? 0 : runsOnDouble,
    awayScoreDelta: isTopInning ? Math.abs(runsOnDouble) : 0,
    newRunners: xbhRunners, newOuts: 0,
    newHomeProbWin: xbhProb, wpShift: xbhProb - curr.homeProbWin,
  });

  // ── Home run ──────────────────────────────────────────────────────────────
  const hrTotal = Math.abs(runsOnHR);
  const hrProb = hypothetical(
    isTopInning ? { home: 0, away: hrTotal } : { home: hrTotal, away: 0 },
    { first: false, second: false, third: false }, 0
  );
  const hrLabel = m
    ? `Home run (HR/PA: ${(m.batterHRRate * 100).toFixed(1)}% vs ${m.pitchHand}HP, pitcher ${m.pitcherHRPer9.toFixed(1)} HR/9)`
    : "Home run";
  outcomes.push({
    label: hrLabel,
    probability: hrRate,
    homeScoreDelta: isTopInning ? 0 : hrTotal,
    awayScoreDelta: isTopInning ? hrTotal : 0,
    newRunners: { first: false, second: false, third: false }, newOuts: 0,
    newHomeProbWin: hrProb, wpShift: hrProb - curr.homeProbWin,
  });

  // ── Walk ──────────────────────────────────────────────────────────────────
  const walkRunners = {
    first: true,
    second: r.first || r.second,
    third: r.second && r.first ? true : r.third,
  };
  const walkRuns = r.first && r.second && r.third ? 1 : 0;
  const walkProb = hypothetical(
    isTopInning ? { home: 0, away: walkRuns } : { home: walkRuns, away: 0 },
    walkRunners, 0
  );
  const walkLabel = m
    ? `Walk (pitcher ${m.pitcherBB9.toFixed(1)} BB/9, batter BB/PA: ${(m.batterBBRate * 100).toFixed(0)}%)`
    : "Walk";
  outcomes.push({
    label: walkLabel,
    probability: bbRate,
    homeScoreDelta: isTopInning ? 0 : walkRuns,
    awayScoreDelta: isTopInning ? walkRuns : 0,
    newRunners: walkRunners, newOuts: 0,
    newHomeProbWin: walkProb, wpShift: walkProb - curr.homeProbWin,
  });

  // ── Strikeout ─────────────────────────────────────────────────────────────
  const kProb = hypothetical({ home: 0, away: 0 }, { ...r }, 1);
  const kLabel = m
    ? `Strikeout (pitcher ${m.pitcherK9.toFixed(1)} K/9, batter K/PA: ${(m.batterKRate * 100).toFixed(0)}%)`
    : "Strikeout";
  outcomes.push({
    label: kLabel,
    probability: kRate,
    homeScoreDelta: 0, awayScoreDelta: 0,
    newRunners: { ...r }, newOuts: 1,
    newHomeProbWin: kProb, wpShift: kProb - curr.homeProbWin,
  });

  // ── Groundout / flyout ────────────────────────────────────────────────────
  const outProb = hypothetical({ home: 0, away: 0 }, { ...r }, 1);
  outcomes.push({
    label: "Out (groundout/flyout)",
    probability: outRate,
    homeScoreDelta: 0, awayScoreDelta: 0,
    newRunners: { ...r }, newOuts: 1,
    newHomeProbWin: outProb, wpShift: outProb - curr.homeProbWin,
  });

  // ── Sac fly (runner on 3rd, < 2 outs) ────────────────────────────────────
  if (r.third && curr.outs < 2) {
    const sfRuns = 1;
    const sfProb = hypothetical(
      isTopInning ? { home: 0, away: sfRuns } : { home: sfRuns, away: 0 },
      { first: r.first, second: r.second, third: false }, 1
    );
    outcomes.push({
      label: "Sacrifice fly (scores runner from 3rd)",
      probability: 0.04,
      homeScoreDelta: isTopInning ? 0 : sfRuns,
      awayScoreDelta: isTopInning ? sfRuns : 0,
      newRunners: { first: r.first, second: r.second, third: false },
      newOuts: 1,
      newHomeProbWin: sfProb,
      wpShift: sfProb - curr.homeProbWin,
    });
  }

  // ── Double play (runner on 1st, < 2 outs) ────────────────────────────────
  if (r.first && curr.outs < 2) {
    const dpProb = hypothetical({ home: 0, away: 0 }, { first: false, second: r.second, third: r.third }, 2);
    outcomes.push({
      label: "Double play (ends threat)",
      probability: 0.08,
      homeScoreDelta: 0,
      awayScoreDelta: 0,
      newRunners: { first: false, second: r.second, third: r.third },
      newOuts: 2,
      newHomeProbWin: dpProb,
      wpShift: dpProb - curr.homeProbWin,
    });
  }

  return outcomes;
}

interface PrePlaySwing {
  maxUpside: PlayOutcome;    // biggest positive shift
  maxDownside: PlayOutcome;  // biggest negative shift
  allOutcomes: PlayOutcome[];
  swingRange: number;        // upside.wpShift - downside.wpShift (total swing)
  battingTeam: string;
  fieldingTeam: string;
  alertMessage: string;
  marketImplied: number | null;
}

export function computePrePlaySwing(curr: GameState): PrePlaySwing | null {
  if (curr.abstractGameState !== "Live") return null;
  if (curr.outs >= 3) return null; // half inning is over

  const outcomes = simulateNextPlay(curr);

  // From trailing team's perspective, find the best and worst outcome
  const scoreDelta = curr.homeScore - curr.awayScore;
  const battingTeam  = curr.isTopInning ? curr.awayTeam : curr.homeTeam;
  const fieldingTeam = curr.isTopInning ? curr.homeTeam : curr.awayTeam;

  // Sort by wpShift — for the batting team (away = top, home = bottom)
  // Positive wpShift always = good for home. Flip sign for away team at bat.
  const flip = curr.isTopInning ? -1 : 1;
  const sorted = [...outcomes].sort((a, b) => flip * b.wpShift - flip * a.wpShift);

  const maxUpside   = sorted[0];  // best outcome for batting team
  const maxDownside = sorted[sorted.length - 1]; // worst for batting team

  const swingRange = Math.abs(maxUpside.wpShift - maxDownside.wpShift);

  // Only meaningful if swing range is significant
  if (swingRange < 0.10) return null;

  // Format market implied if available
  const marketTeamProb = curr.marketHomeProbWin != null
    ? curr.isTopInning
      ? 1 - curr.marketHomeProbWin  // away team at bat
      : curr.marketHomeProbWin      // home team at bat
    : null;

  // Build human-readable alert message
  const runnerDesc = [
    curr.runnersOn.first  && "1st",
    curr.runnersOn.second && "2nd",
    curr.runnersOn.third  && "3rd",
  ].filter(Boolean).join(" & ") || "empty";

  const scoreLine = `${curr.awayTeam} ${curr.awayScore}–${curr.homeScore} ${curr.homeTeam}`;
  const upsideShiftPct = Math.round(Math.abs(maxUpside.wpShift) * 100);
  const downsideShiftPct = Math.round(Math.abs(maxDownside.wpShift) * 100);

  let alertMessage = `${battingTeam} batting, runners on ${runnerDesc}, ${curr.outs} out. `;
  alertMessage += `${scoreLine}. `;
  alertMessage += `${maxUpside.label} shifts win odds +${upsideShiftPct}pp for ${battingTeam}`;
  if (marketTeamProb != null) {
    alertMessage += ` (market: ${Math.round(marketTeamProb * 100)}% ${battingTeam})`;
  }
  alertMessage += `. ${maxDownside.label} shifts ${downsideShiftPct}pp against.`;

  return {
    maxUpside,
    maxDownside,
    allOutcomes: outcomes,
    swingRange,
    battingTeam,
    fieldingTeam,
    alertMessage,
    marketImplied: marketTeamProb,
  };
}

// ─── Hook pre-play trigger into main evaluateTrigger ─────────────────────────
// Called from pollGame after every GUMBO update. Runs simulateNextPlay on the
// CURRENT state (before next pitch) and fires if the swing potential is high.

export function evaluatePrePlayTrigger(curr: GameState): TriggerAlert | null {
  if (curr.abstractGameState !== "Live") return null;

  const swing = computePrePlaySwing(curr);
  if (!swing) return null;

  // Only fire if swing range is meaningful
  // Tier 1: any single play could shift WP ≥20pp AND game is close (±1) and late (≥7th)
  // Tier 2: swing range ≥15pp, close game any inning
  // Tier 3: swing range ≥10pp general
  const isClose = Math.abs(curr.homeScore - curr.awayScore) <= 2;
  const isLate  = curr.inning >= 7;
  const swingPct = Math.round(swing.swingRange * 100);
  const upsidePct = Math.round(Math.abs(swing.maxUpside.wpShift) * 100);

  const tier: 1 | 2 | 3 =
    (upsidePct >= 20 && isClose && isLate) ? 1 :
    (swing.swingRange >= 0.15 && isClose) ? 2 :
    (swing.swingRange >= 0.10) ? 3 : 3;

  if (swing.swingRange < 0.10) return null;

  // Cooldown: pre-play triggers use a separate key and fire at most once per at-bat state
  const r = curr.runnersOn;
  const stateKey = `preplay_${curr.gamePk}_${curr.inning}${curr.isTopInning ? "T" : "B"}_${curr.outs}_${r.first?1:0}${r.second?1:0}${r.third?1:0}`;
  const last = lastAlertByType.get(stateKey);
  if (last && Date.now() - last.ts < 45_000) return null; // 45s per identical state

  const scoreDelta = curr.homeScore - curr.awayScore;
  const trailingTeam = scoreDelta > 0 ? curr.awayTeam : scoreDelta < 0 ? curr.homeTeam : null;
  const leadingTeam  = scoreDelta > 0 ? curr.homeTeam : scoreDelta < 0 ? curr.awayTeam : null;

  // Build swing scenario lines for the UI
  const topOutcomes = [...swing.allOutcomes]
    .filter(o => Math.abs(o.wpShift) >= 0.06)
    .sort((a, b) => (curr.isTopInning ? -1 : 1) * b.wpShift - (curr.isTopInning ? -1 : 1) * a.wpShift)
    .slice(0, 4);

  const swingScenarios = topOutcomes.map(o => {
    const shiftPct = Math.round(Math.abs(o.wpShift) * 100);
    const beneficial = (curr.isTopInning ? o.wpShift < 0 : o.wpShift > 0);
    const arrow = beneficial ? "▲" : "▼";
    const teamName = beneficial ? swing.battingTeam : swing.fieldingTeam;
    return `${o.label}: ${arrow}${shiftPct}pp for ${teamName} (p≈${Math.round(o.probability * 100)}%)`;
  });

  const runnerDesc = [
    curr.runnersOn.first  && "1st",
    curr.runnersOn.second && "2nd",
    curr.runnersOn.third  && "3rd",
  ].filter(Boolean).join(" & ") || "bases empty";

  const inningStr = `${curr.inning}${curr.isTopInning ? "T" : "B"}`;
  const marketLine = swing.marketImplied != null
    ? `Market: ${Math.round(swing.marketImplied * 100)}% ${swing.battingTeam}`
    : "market odds updating";

  const headline = tier === 1
    ? `PRE-PLAY ALERT — ${swing.battingTeam} at bat, ${runnerDesc}, ${curr.outs} out — ${upsidePct}pp swing possible`
    : `SWING WATCH — ${inningStr} | ${swing.battingTeam} | ${runnerDesc} | ${curr.outs} out | ${swingPct}pp range`;

  const body = `${curr.awayTeam} ${curr.awayScore}–${curr.homeScore} ${curr.homeTeam} | ${inningStr} | ${runnerDesc} | ${curr.outs} out | ${marketLine}`;

  const alertTs = Date.now();
  lastAlertByType.set(stateKey, { ts: alertTs, edge: curr.edge });

  const alert: TriggerAlert = {
    id: `preplay_${curr.gamePk}_${alertTs}`,
    gamePk: curr.gamePk,
    tier,
    type: "pre_play",
    headline,
    body,
    situation: swing.alertMessage,
    swingTeam: swing.battingTeam,
    swingScenarios,
    favoredTeam: curr.homeProbWin >= 0.5 ? curr.homeTeam : curr.awayTeam,
    underdogTeam: curr.homeProbWin >= 0.5 ? curr.awayTeam : curr.homeTeam,
    modelEdge: curr.edge !== null ? parseFloat((curr.edge * 100).toFixed(1)) : null,
    triggerScore: Math.min(100, Math.round(upsidePct * 1.5 + (isLate ? 20 : 0) + (isClose ? 15 : 0))),
    sourceTs: curr.sourceTs,
    receiveTs: curr.receiveTs,
    computeTs: curr.computeTs,
    alertTs,
    latencyMs: {
      ingest:  curr.receiveTs - curr.sourceTs,
      compute: curr.computeTs - curr.receiveTs,
      total:   alertTs - curr.sourceTs,
    },
  };

  alertHistory.unshift(alert);
  if (alertHistory.length > 50) alertHistory.pop();

  return alert;
}
