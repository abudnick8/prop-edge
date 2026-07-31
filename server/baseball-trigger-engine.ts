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
  if (!key) return;
  try {
    const r = await axios.get(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${key}&regions=us&markets=h2h&oddsFormat=american`,
      { timeout: 8000 }
    );
    const newMap: Record<string, { homeML: number; awayML: number }> = {};
    for (const game of (r.data ?? [])) {
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
    oddsMap = newMap;
    lastOddsTs = Date.now();
  } catch (e: any) {
    console.warn("[TriggerEngine] odds fetch failed:", e.message);
  }
}

// ─── GUMBO live feed polling ──────────────────────────────────────────────────

async function fetchGumboState(gamePk: number): Promise<any | null> {
  try {
    const r = await axios.get(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live?fields=gameData,liveData,metaData`,
      { timeout: 5000 }
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
    const lastPlay: string    = result.description ?? "";
    const lastEventType: string = result.event ?? "";
    const balls: number   = count.balls   ?? 0;
    const strikes: number = count.strikes ?? 0;
    const currentPitchCount: number = currentPlay.pitchIndex?.length ?? 0;

    const sourceTs: number = raw.metaData?.timeStamp
      ? new Date(raw.metaData.timeStamp).getTime()
      : receiveTs;

    const partial: GameState = {
      gamePk, homeTeam, awayTeam, homeScore, awayScore,
      inning, isTopInning, outs, runnersOn,
      pitcherName, batterName,
      abstractGameState, detailedState,
      lastPlay, lastEventType,
      balls, strikes, currentPitchCount,
      homeProbWin: 0.5,
      marketHomeProbWin: null,
      edge: null,
      sourceTs, receiveTs, computeTs: 0,
    };

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
    const r = await axios.get(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&gameType=R&fields=dates,games,gamePk,status,abstractGameState`,
      { timeout: 8000 }
    );
    const games: any[] = r.data?.dates?.[0]?.games ?? [];
    return games
      .filter((g: any) => ["Live", "Preview"].includes(g.status?.abstractGameState ?? ""))
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

  // Evaluate trigger
  const alert = evaluateTrigger(prev, curr);
  if (alert) {
    engineStatus.alertCount++;
    console.log(`[TriggerEngine] TIER ${alert.tier} ALERT: ${alert.headline}`);
    broadcast("mlb:trigger", alert);
    broadcastSse("trigger", alert);

    // Tier 1: also push Discord webhook if configured
    if (alert.tier === 1) {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (webhookUrl) {
        axios.post(webhookUrl, {
          embeds: [{
            title: `⚾ ${alert.headline}`,
            description: `${alert.body}\n\n**Scenarios:**\n${alert.swingScenarios.map(s => `• ${s}`).join("\n")}`,
            color: alert.tier === 1 ? 0xFF4444 : alert.tier === 2 ? 0xFF8C00 : 0x4488FF,
            footer: { text: `Edge: ${alert.modelEdge != null ? alert.modelEdge + "%" : "model only"} | Latency: ${alert.latencyMs.total}ms` },
            timestamp: new Date(alert.alertTs).toISOString(),
          }]
        }).catch(() => {});
      }
    }

    // Remove finished games
    if (curr.abstractGameState === "Final") {
      activeGamePks.delete(gamePk);
    }
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
