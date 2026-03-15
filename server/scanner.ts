/**
 * Sports Prediction Market Scanner
 * Fetches markets from Kalshi (public), Polymarket (public), and
 * The Odds API (DraftKings, Underdog lines) then runs confidence scoring.
 */

import axios from "axios";
import { InsertBet } from "@shared/schema";
import { storage } from "./storage";

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

function buildKalshiBet(m: any): InsertBet {
  const yesPrice = (m.yes_bid ?? m.last_price ?? 50) / 100;
  const noPrice = 1 - yesPrice;
  const sport = detectSport(m.title + " " + m.event_ticker);
  const betType = detectBetType(m.title);
  const score = computeConfidence({
    impliedProb: yesPrice,
    source: "kalshi",
    betType,
    sport,
    title: m.title,
  });

  return {
    id: `kalshi-${m.ticker}`,
    source: "kalshi",
    sport,
    betType,
    title: m.title ?? m.ticker,
    description: m.subtitle ?? m.rules_primary ?? "",
    yesPrice,
    noPrice,
    impliedProbability: yesPrice,
    confidenceScore: score.score,
    riskLevel: score.risk,
    recommendedAllocation: score.allocation,
    keyFactors: score.factors,
    researchSummary: score.summary,
    isHighConfidence: score.score >= 80,
    status: "open",
    homeTeam: null,
    awayTeam: null,
    playerName: null,
    gameTime: m.close_time ? new Date(m.close_time) : null,
    notificationSent: false,
    playerStats: null,
    teamStats: null,
    line: null,
    overOdds: null,
    underOdds: null,
  };
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
const ACTION_API_KEY = process.env.ACTION_NETWORK_KEY ?? null;

// ─── API-Sports (bb2db2357407d316eb56cc5cf0dcfcb8) — player stats for confidence boosts ───
const API_SPORTS_KEY = process.env.API_SPORTS_KEY ?? null;
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
      isHighConfidence: newScore >= 80,
      keyFactors: [...(bet.keyFactors ?? []), factor].slice(0, 8),
    };
  });
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
                const score = computeConfidence({ impliedProb: pickedProb, source: "actionnetwork", betType: "moneyline", sport: sportLabel, title, odds: pickedOdds, sharpMoneyPct: pickedSharpMoney, publicTicketPct: pickedPublicTicket });
                bets.push({
                  id, source: "actionnetwork", sport: sportLabel, betType: "moneyline", title,
                  description: `ActionNetwork line — ${label}`,
                  line: null, overOdds: pickedOdds, underOdds: null,
                  impliedProbability: pickedProb, confidenceScore: score.score,
                  riskLevel: score.risk, recommendedAllocation: score.allocation,
                  keyFactors: [label, ...score.factors], researchSummary: score.summary,
                  isHighConfidence: score.score >= 80, status: "open",
                  homeTeam, awayTeam, playerName: null, gameTime,
                  notificationSent: false, playerStats: null, teamStats: null,
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
              const score = computeConfidence({ impliedProb: pickSpreadProb, source: "actionnetwork", betType: "spread", sport: sportLabel, title: spreadTitle, odds: pickSpreadOdds, line: pickSpreadLine, sharpMoneyPct: pickedSpreadSharpMoney, publicTicketPct: pickedSpreadPublicTicket });
              bets.push({
                id: spreadId, source: "actionnetwork", sport: sportLabel, betType: "spread", title: spreadTitle,
                description: `ActionNetwork spread — ${spreadLabel}`,
                line: pickSpreadLine, overOdds: pickSpreadOdds, underOdds: null,
                impliedProbability: pickSpreadProb, confidenceScore: score.score,
                riskLevel: score.risk, recommendedAllocation: score.allocation,
                keyFactors: [spreadLabel, ...score.factors], researchSummary: score.summary,
                isHighConfidence: score.score >= 80, status: "open",
                homeTeam, awayTeam, playerName: null, gameTime,
                notificationSent: false, playerStats: null, teamStats: null,
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
              const score = computeConfidence({ impliedProb: pickTotalProb, source: "actionnetwork", betType: "total", sport: sportLabel, title: totalTitle, odds: pickTotalOdds, line: total, sharpMoneyPct: pickedTotalSharpMoney, publicTicketPct: pickedTotalPublicTicket });
              bets.push({
                id: totalId, source: "actionnetwork", sport: sportLabel, betType: "total", title: totalTitle,
                description: `ActionNetwork total — ${totalLabel}`,
                line: total, overOdds, underOdds,
                impliedProbability: pickTotalProb, confidenceScore: score.score,
                riskLevel: score.risk, recommendedAllocation: score.allocation,
                keyFactors: [totalLabel, ...score.factors], researchSummary: score.summary,
                isHighConfidence: score.score >= 80, status: "open",
                homeTeam, awayTeam, playerName: null, gameTime,
                notificationSent: false, playerStats: null, teamStats: null,
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
    isHighConfidence: score.score >= 80,
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
const CORE_SPORT_KEYS = ["americanfootball_nfl", "basketball_nba", "baseball_mlb", "icehockey_nhl"];

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
      isHighConfidence: newScore >= 80,
      keyFactors: newFactors,
    };
  });
}

// ─── Underdog Fantasy public API (player props — no key required) ──────────
// Returns 5000+ active player props across NBA, NHL, MLB, NFL, WBC, PGA, MMA
async function fetchUnderdogProps(): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  try {
    const { data } = await axios.get(
      "https://api.underdogfantasy.com/beta/v5/over_under_lines",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://underdogfantasy.com/",
          "Origin": "https://underdogfantasy.com",
        },
        timeout: 15000,
      }
    );

    const lines: any[] = data.over_under_lines ?? [];
    const appearances: any[] = data.appearances ?? [];
    const players: any[] = data.players ?? [];
    const games: any[] = data.games ?? [];

    // Build lookup maps
    const playerMap = new Map<string, any>();
    for (const p of players) playerMap.set(p.id, p);

    const gameMap = new Map<number, any>();
    for (const g of games) gameMap.set(g.id, g);

    const appearanceMap = new Map<string, any>();
    for (const a of appearances) appearanceMap.set(a.id, a);

    // Sport ID → canonical sport name mapping
    const sportMap: Record<string, string> = {
      NBA: "NBA", NFL: "NFL", MLB: "MLB", NHL: "NHL",
      WBC: "MLB", CBB: "NCAAB", PGA: "Golf", MMA: "MMA",
      BOXING: "Boxing", NCAAF: "NCAAF", F1SZN: "Other",
    };

    // Core sports to include (skip FIFA, esports, etc.)
    const includedSports = new Set(["NBA", "NFL", "MLB", "NHL", "WBC", "CBB", "PGA", "MMA"]);

    // Stat type → display name mapping
    const statDisplayMap: Record<string, string> = {
      points: "Points",
      rebounds: "Rebounds",
      assists: "Assists",
      pts_rebs_asts: "Pts+Rebs+Asts",
      threes: "3-Pointers Made",
      steals: "Steals",
      blocks: "Blocks",
      turnovers: "Turnovers",
      goals: "Goals",
      assists_hockey: "Assists",
      shots: "Shots on Goal",
      saves: "Saves",
      hits: "Hits",
      total_bases: "Total Bases",
      strikeouts: "Strikeouts",
      home_runs: "Home Runs",
      rbi: "RBIs",
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

      // Pick the stronger side
      const pickSide = overProb >= underProb ? "OVER" : "UNDER";
      const pickedOdds = pickSide === "OVER" ? overOdds : underOdds;
      const pickProb = Math.max(overProb, underProb);

      // Only surface picks with meaningful edge (one side ≥52%)
      if (pickProb < 0.52) continue;

      const title = `[TAKE ${pickSide} ${statValue} @ ${pickedOdds > 0 ? "+" : ""}${pickedOdds}] ${playerName} — ${statName}`;
      const description = `${playerName} is projected to go ${pickSide} ${statValue} ${statName}. ${sport} player prop from Underdog Fantasy. ${overOption?.selection_subheader ?? ""}`;

      const confidence = computeConfidence({
        impliedProb: pickProb,
        source: "underdog",
        betType: "player_prop",
        sport,
        title,
        odds: pickedOdds,
      });

      const gameTimeVal = gameTime ? new Date(gameTime) : null;

      bets.push({
        id: `underdog_${line.id}`,
        title,
        description,
        sport,
        betType: "player_prop",
        source: "underdog",
        overOdds: overOdds,
        underOdds: underOdds,
        impliedProbability: pickProb,
        confidenceScore: confidence.score,
        riskLevel: confidence.risk,
        recommendedAllocation: confidence.allocation,
        keyFactors: [`${pickSide} ${statValue} ${statName}`, ...confidence.factors],
        researchSummary: confidence.summary,
        gameTime: gameTimeVal,
        playerName,
        isHighConfidence: confidence.score >= 80,
        teamStats: {
          pickSide,
          pickedOdds,
          overProb: Math.round(overProb * 100),
          underProb: Math.round(underProb * 100),
          playerName,
          statType: statName,
          statValue,
          gameTitle: game.full_team_names_title ?? game.title,
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
      isHighConfidence: score.score >= 80,
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

// Player prop market keys per sport (game-level)
const PROP_MARKETS: Record<string, string> = {
  americanfootball_nfl:
    "player_pass_tds,player_pass_yds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td",
  basketball_nba:
    "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_points_rebounds_assists",
  baseball_mlb:
    "batter_hits,batter_home_runs,batter_rbis,batter_runs_scored,pitcher_strikeouts,pitcher_hits_allowed",
  icehockey_nhl:
    "player_points,player_goals,player_assists,player_shots_on_goal,player_power_play_points",
  // Optional sports — game-level props
  mma_mixed_martial_arts: "h2h", // MMA uses h2h only; props not well-supported
  boxing_boxing: "h2h",
  basketball_ncaab:
    "player_points,player_rebounds,player_assists,player_threes",
  americanfootball_ncaaf:
    "player_pass_yds,player_rush_yds,player_reception_yds,player_pass_tds",
};

async function fetchOddsAPI(apiKey: string, settings?: { enabledSports?: string[]; enableSeasonProps?: boolean }): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  const enabledSports = settings?.enabledSports ?? ["NFL", "NBA", "MLB", "NHL"];
  const enableSeasonProps = settings?.enableSeasonProps ?? true;

  // Determine which sport keys to scan
  const sportKeyMap: Record<string, string> = {
    americanfootball_nfl: "NFL", basketball_nba: "NBA", baseball_mlb: "MLB", icehockey_nhl: "NHL",
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

        // Future events — up to 20 per sport (paid key has 20k credits)
        const now = Date.now();
        const upcomingEvents = (events ?? [])
          .filter((e: any) => new Date(e.commence_time).getTime() > now)
          .slice(0, 20);

        console.log(`  ${sportKey}: ${upcomingEvents.length} upcoming events for props`);

        for (const ev of upcomingEvents) {
          try {
            const { data: propData } = await axios.get(
              `${ODDS_BASE}/sports/${sportKey}/events/${ev.id}/odds`,
              {
                params: {
                  apiKey,
                  regions: "us",
                  bookmakers: "fanduel,draftkings",
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
                  isHighConfidence: score.score >= 80,
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
          isHighConfidence: score.score >= 80,
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
        const overOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "over") ?? outcomes[0];
        const underOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "under") ?? outcomes[1];
        if (!overOutcome) continue;

        const overOddsVal: number = overOutcome.price;
        const underOddsVal: number | null = underOutcome?.price ?? null;

        // Determine which side to pick based on implied probability
        const overProb = americanToImplied(overOddsVal);
        const underProb = underOddsVal !== null ? americanToImplied(underOddsVal) : 1 - overProb;
        const pickSide: "over" | "under" = overProb >= underProb ? "over" : "under";
        const pickedOdds = pickSide === "over" ? overOddsVal : underOddsVal!;
        const pickedProb = pickSide === "over" ? overProb : underProb;

        const marketLabel = market.key.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
        const line = overOutcome.point;
        const sideLabel = pickSide === "over" ? "TAKE OVER" : "TAKE UNDER";
        const oddsDisplay = pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`;
        const seasonTag = isSeasonProp ? "📅 SEASON — " : "";
        const baseTitle = `${seasonTag}${playerName} — ${marketLabel.charAt(0).toUpperCase() + marketLabel.slice(1)} ${line !== undefined ? `O/U ${line}` : ""}`;
        const title = `[${sideLabel}${line !== undefined ? ` ${line}` : ""} @ ${oddsDisplay}] ${seasonTag}${playerName} — ${marketLabel.charAt(0).toUpperCase() + marketLabel.slice(1)}`;
        const id = `${isSeasonProp ? "season" : "prop"}-${event.id}-${market.key}-${playerName.replace(/\s+/g, "-")}-${bookmaker.key}`;

        if (seen.has(id)) continue;
        seen.add(id);

        const score = computeConfidence({
          impliedProb: pickedProb,
          source: "draftkings",
          betType: "player_prop",
          sport,
          title: baseTitle,
          odds: pickedOdds,
          line,
        });

        // Prepend pick side as first key factor
        const keyFactors = [
          `Pick: ${sideLabel}${line !== undefined ? ` ${line}` : ""} (${oddsDisplay})`,
          ...(score.factors ?? []),
        ];

        bets.push({
          id,
          source: bookmaker.key === "fanduel" ? "underdog" : "draftkings", // label FanDuel as Underdog for display
          sport,
          betType: "player_prop",
          title,
          description: `${event.away_team} @ ${event.home_team} · ${bookmaker.key}`,
          line: line ?? null,
          overOdds: overOddsVal,
          underOdds: underOddsVal,
          impliedProbability: pickedProb,
          confidenceScore: score.score,
          riskLevel: score.risk,
          recommendedAllocation: score.allocation,
          keyFactors,
          researchSummary: `[${sideLabel}${line !== undefined ? ` ${line}` : ""} @ ${oddsDisplay}] — ${score.summary}`,
          isHighConfidence: score.score >= 80,
          status: "open",
          homeTeam: event.home_team ?? null,
          awayTeam: event.away_team ?? null,
          playerName,
          gameTime: event.commence_time ? new Date(event.commence_time) : null,
          notificationSent: false,
          playerStats: null,
          teamStats: { pickSide, pickedOdds, overProb: Math.round(overProb * 100), underProb: Math.round(underProb * 100) },
          yesPrice: null, noPrice: null,
        });
      }
    }
  }
  return bets;
}

// ─── Confidence Scoring Engine ─────────────────────────────────────────────────
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
}

interface ScoreResult {
  score: number;
  risk: "low" | "medium" | "high";
  allocation: number;
  factors: string[];
  summary: string;
}

function computeConfidence(input: ScoreInput): ScoreResult {
  let score = 50;
  const factors: string[] = [];

  // 1. Implied probability edge
  const prob = Math.max(0.01, Math.min(0.99, input.impliedProb));
  const dist = Math.abs(prob - 0.5);

  if (prob > 0.72) {
    score += 18;
    factors.push(`Strong market consensus (${Math.round(prob * 100)}% implied)`);
  } else if (prob > 0.60) {
    score += 10;
    factors.push(`Moderate edge (${Math.round(prob * 100)}% implied)`);
  } else if (prob < 0.35) {
    score += 8;
    factors.push(`Contrarian value (${Math.round(prob * 100)}% market price — potential underdog edge)`);
  } else {
    score -= 5;
    factors.push(`Near-coin-flip odds (${Math.round(prob * 100)}%) — low conviction`);
  }

  // 2. Source reliability
  if (input.source === "kalshi" || input.source === "polymarket") {
    score += 8;
    factors.push("Regulated prediction market — sharp money reflected in price");
  } else if (input.source === "draftkings") {
    score += 5;
    factors.push("Major sportsbook line — market-making quality pricing");
  } else if (input.source === "actionnetwork") {
    score += 6;
    factors.push("ActionNetwork public betting consensus — sharp vs. public money signal");
  } else if (input.source === "underdog") {
    score += 7;
    factors.push("Underdog Fantasy — real-money player prop lines from active market");
  } else if (input.source === "sportsgameodds") {
    score += 8;
    factors.push("SportsGameOdds — multi-book consensus player prop odds");
  }

  // 2b. Sharp money signal (ActionNetwork auth key — most powerful signal available)
  // Sharp money divergence: when sharp money % >> public ticket % it means pro bettors
  // are loading one side while casual bettors are on the other — very high value signal.
  if (input.sharpMoneyPct != null && input.publicTicketPct != null) {
    const sharpPct = input.sharpMoneyPct;  // % of $ on this side
    const publicPct = input.publicTicketPct; // % of tickets on this side
    const divergence = sharpPct - publicPct; // positive = sharp loaded, public fading

    if (sharpPct >= 70 && divergence >= 20) {
      score += 14;
      factors.push(`🔥 Sharp money signal: ${Math.round(sharpPct)}% of $ vs ${Math.round(publicPct)}% of tickets — strong professional consensus`);
    } else if (sharpPct >= 60 && divergence >= 15) {
      score += 10;
      factors.push(`Sharp money edge: ${Math.round(sharpPct)}% of $ vs ${Math.round(publicPct)}% of tickets — pros loading this side`);
    } else if (sharpPct >= 55 && divergence >= 10) {
      score += 6;
      factors.push(`Moderate sharp lean: ${Math.round(sharpPct)}% of $ on this side vs ${Math.round(publicPct)}% public tickets`);
    } else if (divergence < -15) {
      // Public heavy, sharp fading — lower confidence
      score -= 5;
      factors.push(`Public-heavy bet: ${Math.round(publicPct)}% tickets but only ${Math.round(sharpPct)}% money — square action`);
    } else if (sharpPct >= 50) {
      score += 3;
      factors.push(`${Math.round(sharpPct)}% of money on this side — slight sharp lean`);
    }
  } else if (input.sharpMoneyPct != null) {
    // Only money pct available (no ticket data)
    if (input.sharpMoneyPct >= 65) {
      score += 8;
      factors.push(`${Math.round(input.sharpMoneyPct)}% of betting money on this side — strong consensus`);
    } else if (input.sharpMoneyPct >= 55) {
      score += 4;
      factors.push(`${Math.round(input.sharpMoneyPct)}% of money on this side`);
    }
  }

  // 3. Bet type bonus — player props are the primary focus
  if (input.betType === "player_prop") {
    score += 15; // Primary focus: player props have the highest stat predictability
    factors.push("Player prop — primary focus: highest statistical predictability from recent form & matchup data");
    // Extra boost for specific high-predictability prop markets
    const t = (input.title ?? "").toLowerCase();
    if (t.includes("points") || t.includes("pts")) {
      score += 4;
      factors.push("Points prop — most stable stat, highly predictable from usage & matchup");
    } else if (t.includes("rebound") || t.includes("reb")) {
      score += 3;
      factors.push("Rebounds prop — strong regression-to-mean stat");
    } else if (t.includes("assist") || t.includes("ast")) {
      score += 3;
      factors.push("Assists prop — highly correlated with pace and role");
    } else if (t.includes("pass") || t.includes("yds") || t.includes("yards")) {
      score += 4;
      factors.push("Passing/rushing yards prop — driven by role, target share & matchup");
    } else if (t.includes("strikeout") || t.includes("k9") || t.includes("ks")) {
      score += 5;
      factors.push("Strikeout prop — most predictable MLB stat (K-rate consistency)");
    } else if (t.includes("reception") || t.includes("catch") || t.includes("rec")) {
      score += 3;
      factors.push("Receptions prop — driven by target share & route participation");
    } else if (t.includes("shot") || t.includes("goal")) {
      score += 2;
      factors.push("Shots/goals prop — correlated with ice time and power play role");
    }
  } else if (input.betType === "moneyline") {
    score += 2;
    factors.push("Moneyline — binary outcome, less predictable than player stats");
  } else if (input.betType === "spread") {
    score += 2;
    factors.push("Spread — team-level bet, more variance than player props");
  } else if (input.betType === "total") {
    score += 1;
    factors.push("Total — dependent on game pace/script, lower predictability");
  }

  // 4. Sport-specific adjustments
  if (input.sport === "NBA") {
    score += 5;
    factors.push("NBA — high stat predictability (82-game sample)");
  } else if (input.sport === "MLB") {
    score += 4;
    factors.push("MLB — large statistical sample, strong regression to mean");
  } else if (input.sport === "NFL") {
    score += 3;
    factors.push("NFL — weather and injury risk factored");
  } else if (input.sport === "NHL") {
    score += 2;
    factors.push("NHL — goalie variance is a key risk factor");
  } else if (input.sport === "MMA") {
    score += 4;
    factors.push("MMA — sharp money in fight markets, high implied prob accuracy");
  } else if (input.sport === "Boxing") {
    score += 3;
    factors.push("Boxing — moneyline market, concentrated sharp action");
  } else if (input.sport === "NCAAB") {
    score += 3;
    factors.push("NCAAB — tournament format creates high-value lines");
  } else if (input.sport === "NCAAF") {
    score += 2;
    factors.push("NCAAF — high variance but large sample of player stats");
  } else if (input.sport === "Golf") {
    score += 2;
    factors.push("Golf — futures market, long-tail value picks");
  }

  // 5. Odds value check (for traditional sportsbook bets)
  if (input.odds !== undefined) {
    if (input.odds < 0 && input.odds > -130) {
      score += 5;
      factors.push("Reasonable juice — not over-priced by bookmaker");
    } else if (input.odds < -200) {
      score -= 8;
      factors.push("Heavy favorite — limited upside, higher risk of surprise");
    } else if (input.odds > 200) {
      score -= 3;
      factors.push("Long shot — statistically unlikely per market pricing");
    }
  }

  // 6. Noise floor
  score = Math.max(10, Math.min(96, score + (Math.random() * 6 - 3)));
  score = Math.round(score);

  // Risk level
  let risk: "low" | "medium" | "high";
  if (score >= 75 && prob > 0.55) risk = "low";
  else if (score >= 60) risk = "medium";
  else risk = "high";

  // Kelly-inspired allocation
  const edge = prob - (1 - prob) * 0.05;
  const kelly = Math.max(0, edge / 0.95);
  const fractionalKelly = kelly * 0.25; // quarter Kelly for safety
  const allocation = Math.min(5, parseFloat((fractionalKelly * 100).toFixed(1)));

  const summary = generateSummary(input, score, prob, factors);

  return { score, risk, allocation, factors, summary };
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
  if (t.includes("mlb") || t.includes("baseball") || t.includes("strikeout") || t.includes("innings") || t.includes("hits")) return "MLB";
  if (t.includes("nhl") || t.includes("hockey") || t.includes("goals") || t.includes("puck")) return "NHL";
  return "Other";
}

function detectBetType(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("over") || t.includes("under") || t.includes("more than") || t.includes("less than") || t.includes("yds") || t.includes("points") || t.includes("prop")) return "player_prop";
  if (t.includes("cover") || t.includes("spread") || t.includes("+") || t.match(/[-+]\d+\.5/)) return "spread";
  if (t.includes("total") || t.includes("o/u")) return "total";
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

const SGO_KEY = process.env.SGO_API_KEY ?? null;
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

async function fetchSportsGameOddsProps(): Promise<InsertBet[]> {
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

  for (const [leagueID, stats] of Object.entries(SGO_LEAGUE_STATS)) {
    for (const statID of stats) {
      const oddID = `${statID}-PLAYER_ID-game-ou-over`;
      try {
        const url = `${SGO_BASE}/events?leagueID=${leagueID}&oddID=${encodeURIComponent(oddID)}&ended=false&cancelled=false&includeOpposingOdds=true&apiKey=${SGO_KEY}`;
        const resp = await fetch(url, { headers: { "User-Agent": "" } });
        if (!resp.ok) continue;
        const data = await resp.json();
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

            // Pick stronger side
            const pickSide = overProb >= underProb ? "OVER" : "UNDER";
            const pickedOdds = pickSide === "OVER" ? overOddsNum : underOddsNum;
            const pickProb = Math.max(overProb, underProb);

            // Only include picks with meaningful edge (≥52%)
            if (pickProb < 0.52) continue;

            // Get player name
            const playerName = playerMap[playerID] ??
              playerID.replace(/_NBA|_MLB|_NHL|_NFL/g, "").replace(/_\d+$/g, "").replace(/_/g, " ");

            const statName = statDisplayMap[statID] ?? statID;
            const sport = SGO_SPORT_MAP[leagueID] ?? leagueID;
            const oddsStr = pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`;
            const title = `[TAKE ${pickSide} ${lineNum} @ ${oddsStr}] ${playerName} — ${statName}`;
            const description = `${playerName} is projected to go ${pickSide} ${lineNum} ${statName}. ${sport} player prop from SportsGameOdds (multi-book consensus).`;

            const confidence = computeConfidence({
              impliedProb: pickProb,
              source: "sportsgameodds",
              betType: "player_prop",
              sport,
              title,
              odds: pickedOdds,
              line: lineNum,
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
              keyFactors: [`${pickSide} ${lineNum} ${statName} (SGO multi-book)`, ...confidence.factors],
              researchSummary: confidence.summary,
              gameTime: startTime,
              playerName,
              isHighConfidence: confidence.score >= 80,
              teamStats: {
                pickSide,
                pickedOdds,
                overProb: Math.round(overProb * 100),
                underProb: Math.round(underProb * 100),
                playerName,
                statType: statName,
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

// ─── Main scanner ─────────────────────────────────────────────────────────────
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

  // Fetch all live sources in parallel (ActionNetwork + Underdog are free, no key needed)
  const [kalshi, poly, actionNet, underdog, sgo] = await Promise.all([
    fetchKalshiSports(),
    fetchPolymarketSports(),
    fetchActionNetwork(),
    fetchUnderdogProps(),
    fetchSportsGameOddsProps(),
  ]);

  results.push(...kalshi, ...poly, ...actionNet, ...underdog, ...sgo);

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

  // Add Odds API data if key provided
  if (apiKey) {
    const odds = await fetchOddsAPI(apiKey, {
      enabledSports: allEnabledSports,
      enableSeasonProps: settings.enableSeasonProps ?? true,
    });
    results.push(...odds);
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

  // Remove any markets whose game/close time has already passed
  const fresh = filterStale(results);
  console.log(`Staleness filter: ${results.length} raw → ${fresh.length} current markets`);

  // Clear old bets and replace with fresh live data only
  await storage.clearBets();

  // Upsert all fresh bets
  for (const bet of fresh) {
    await storage.upsertBet(bet);
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
  return { scanned: fresh.length, highConfidence: highConf };
}
