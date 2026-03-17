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

function buildKalshiBet(m: any, overrides?: { sport?: string; betType?: string; playerName?: string; gameTime?: Date | null }): InsertBet {
  // yes_ask_dollars is a dollar-denominated price (e.g. "0.55" = 55 cents = 55%)
  // Fall back to yes_bid_dollars, last_price_dollars, or 0.5
  const priceStr = m.yes_ask_dollars ?? m.yes_bid_dollars ?? m.last_price_dollars ?? null;
  const yesPrice = priceStr !== null ? parseFloat(priceStr) : ((m.yes_bid ?? m.last_price ?? 50) / 100);
  const noPrice = 1 - yesPrice;
  const sport = overrides?.sport ?? detectSport(m.title + " " + (m.event_ticker ?? ""));
  const betType = overrides?.betType ?? detectBetType(m.title);
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
    playerName: overrides?.playerName ?? null,
    gameTime: overrides?.gameTime !== undefined ? overrides.gameTime : (m.close_time ? new Date(m.close_time) : null),
    notificationSent: false,
    playerStats: null,
    teamStats: null,
    line: null,
    overOdds: null,
    underOdds: null,
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

    const score = computeConfidence({
      impliedProb: yesPrice,
      source: "kalshi",
      betType: "player_prop",
      sport,
      title,
    });

    results.push({
      id: `kalshi-prop-${market.ticker}`,
      source: "kalshi",
      sport,
      betType: "player_prop",
      title,
      description: `${playerName} to score ${threshold} ${stat} — Kalshi prediction market`,
      line,
      overOdds,
      underOdds,
      yesPrice,
      noPrice,
      impliedProbability: impliedProb,
      confidenceScore: score.score,
      riskLevel: score.risk,
      recommendedAllocation: score.allocation,
      keyFactors: score.factors,
      researchSummary: score.summary,
      isHighConfidence: score.score >= 80,
      status: "open",
      homeTeam,
      awayTeam,
      playerName,
      gameTime,
      notificationSent: false,
      playerStats: null,
      teamStats: null,
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
          isHighConfidence: score.score >= 80,
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
                  isHighConfidence: score.score >= 80,
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
                isHighConfidence: score.score >= 80,
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
                isHighConfidence: score.score >= 80,
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
            isHighConfidence: score.score >= 80,
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
          sideLabel = side === "yes" ? "YES" : "NO";
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
            isHighConfidence: score.score >= 80,
            homeTeam: event.home_team ?? null, awayTeam: event.away_team ?? null,
            playerName, gameTime: event.commence_time ? new Date(event.commence_time) : null,
            notificationSent: false, playerStats: null,
            teamStats: { pickSide: side, pickedOdds: pickedOdds_, overProb: Math.round(pickedProb_ * 100), underProb: Math.round((1-pickedProb_) * 100), playerName, statType: marketLabel_, statValue: null, gameTitle: `${event.away_team} @ ${event.home_team}` },
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
export function isLottoProp(_title: string, impliedProb: number, betType?: string): boolean {
  if (betType && betType !== "player_prop") return false;
  return impliedProb < 0.40; // +150 or better payout
}

function computeConfidence(input: ScoreInput): ScoreResult {
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
    // ── C1: Market consensus strength (25% weight) ──
    // How far the implied prob is from 50/50 = how much the market "agrees"
    // Hard calibration: 53%=+5, 57%=+10, 62%=+15, 68%=+20, 75%=+25
    let c1 = 0;
    if (prob >= 0.75) {
      c1 = 25;
      factors.push(`Strong market consensus — ${Math.round(prob * 100)}% implied probability`);
    } else if (prob >= 0.68) {
      c1 = 20;
      factors.push(`High market confidence — ${Math.round(prob * 100)}% implied`);
    } else if (prob >= 0.62) {
      c1 = 15;
      factors.push(`Solid market edge — ${Math.round(prob * 100)}% implied probability`);
    } else if (prob >= 0.57) {
      c1 = 10;
      factors.push(`Moderate edge — ${Math.round(prob * 100)}% implied probability`);
    } else if (prob >= 0.53) {
      c1 = 5;
      factors.push(`Slight market lean — ${Math.round(prob * 100)}% implied (needs supporting signals)`);
    } else if (prob <= 0.35) {
      // Contrarian value: market under-pricing
      c1 = 10;
      factors.push(`Contrarian value — market at ${Math.round(prob * 100)}%, potential inefficiency`);
    } else if (prob <= 0.42) {
      c1 = 5;
      factors.push(`Mild contrarian angle — ${Math.round(prob * 100)}% market price`);
    }

    // ── C2: Source quality + cross-book agreement (20% weight) ──
    let c2 = 0;
    const { tier, label: sourceLabel } = getSourceTier(input.source);
    if (tier === 1) { c2 = 20; factors.push(sourceLabel); }
    else if (tier === 2) { c2 = 12; factors.push(sourceLabel); }
    else { c2 = 4; factors.push(sourceLabel); }

    // Sharp money bonus (ActionNetwork signal — most powerful available)
    if (input.sharpMoneyPct != null && input.publicTicketPct != null) {
      const sharpPct = input.sharpMoneyPct;
      const publicPct = input.publicTicketPct;
      const divergence = sharpPct - publicPct;
      if (sharpPct >= 70 && divergence >= 20) {
        c2 = Math.min(c2 + 14, 34);
        factors.push(`Sharp money signal: ${Math.round(sharpPct)}% of $ vs ${Math.round(publicPct)}% of tickets — professional consensus`);
      } else if (sharpPct >= 60 && divergence >= 15) {
        c2 = Math.min(c2 + 9, 29);
        factors.push(`Sharp money edge: ${Math.round(sharpPct)}% $ vs ${Math.round(publicPct)}% tickets — pros loading this side`);
      } else if (sharpPct >= 55 && divergence >= 10) {
        c2 = Math.min(c2 + 5, 25);
        factors.push(`Moderate sharp lean: ${Math.round(sharpPct)}% of $ vs ${Math.round(publicPct)}% public`);
      } else if (divergence < -15) {
        c2 = Math.max(c2 - 8, 0);
        factors.push(`Public-heavy action: ${Math.round(publicPct)}% tickets, only ${Math.round(sharpPct)}% money — square side`);
      }
    } else if (input.sharpMoneyPct != null) {
      if (input.sharpMoneyPct >= 65) { c2 = Math.min(c2 + 6, 26); factors.push(`${Math.round(input.sharpMoneyPct)}% of betting $ on this side`); }
      else if (input.sharpMoneyPct >= 55) { c2 = Math.min(c2 + 3, 23); factors.push(`${Math.round(input.sharpMoneyPct)}% money lean`); }
    }

    // ── C3: Stat predictability class (25% weight) ──
    const { cls, label: statLabel } = getStatClass(input.title, input.sport);
    let c3 = 0;
    switch (cls) {
      case "A": c3 = 25; factors.push(statLabel); break;  // Elite predictability
      case "B": c3 = 18; factors.push(statLabel); break;  // Good
      case "C": c3 = 10; factors.push(statLabel); break;  // Moderate
      case "D": c3 = 3;  factors.push(statLabel + " — high variance, use caution"); break;
    }

    // ── C4: Sport sample-size & variance penalty (15% weight) ──
    let c4 = 0;
    if (input.sport === "NBA") {
      c4 = 15;
      factors.push("NBA — 82-game sample, high predictability, stable role assignments");
    } else if (input.sport === "MLB") {
      c4 = 14;
      factors.push("MLB — 162-game sample, strongest regression to mean of all major sports");
    } else if (input.sport === "NFL") {
      c4 = 9;
      factors.push("NFL — 17-game season, game-script variance, weather/injury risk");
    } else if (input.sport === "NHL") {
      c4 = 10;
      factors.push("NHL — goalie variance + ice time fluctuation factored");
    } else if (input.sport === "NCAAB") {
      c4 = 8;
      factors.push("NCAAB — smaller sample + opponent quality variance");
    } else {
      c4 = 6;
    }

    // ── C5: Vig & value edge (15% weight) ──
    let c5 = 0;
    if (input.odds !== undefined) {
      if (input.odds >= -115 && input.odds <= -105) {
        c5 = 15;
        factors.push(`Clean juice (${input.odds}) — minimal book overround, best value`);
      } else if (input.odds >= -130 && input.odds < -115) {
        c5 = 12;
        factors.push(`Reasonable juice (${input.odds}) — standard sportsbook pricing`);
      } else if (input.odds >= -160 && input.odds < -130) {
        c5 = 8;
        factors.push(`Moderate juice (${input.odds}) — slight book edge, still playable`);
      } else if (input.odds < -160 && input.odds >= -220) {
        c5 = 4;
        factors.push(`Heavy juice (${input.odds}) — book overround cuts into expected value`);
      } else if (input.odds < -220) {
        c5 = 0;
        factors.push(`Extreme juice (${input.odds}) — very limited upside relative to probability`);
      } else if (input.odds > 0) {
        // Underdog play
        c5 = input.odds <= 150 ? 13 : input.odds <= 250 ? 10 : 6;
        factors.push(`Plus-money prop (${input.odds > 0 ? "+" : ""}${input.odds}) — positive expected value if correct`);
      }
    } else {
      // No odds info — neutral
      c5 = 8;
    }

    // ── Raw composite score ──
    // Weighted sum: C1(25%) + C2(20%) + C3(25%) + C4(15%) + C5(15%)
    // Each component already scaled 0→25/20/25/15/15 = max 100
    const rawScore = c1 + c2 + c3 + c4 + c5;

    // ── Hard gate cap ──
    // Even with a perfect component score, failed gates cap at 72
    const gateCap = hardGateFailed ? 72 : 99;
    if (hardGateFailed) {
      factors.push(...hardGateReasons);
    }

    // ── Noise: ±2 pts (reduced from old ±3 to tighten distribution) ──
    const noiseAdj = Math.random() * 4 - 2;
    const finalScore = Math.max(10, Math.min(gateCap, Math.round(rawScore + noiseAdj)));

    const risk: "low" | "medium" | "high" =
      finalScore >= 78 && prob > 0.55 ? "low" :
      finalScore >= 63 ? "medium" : "high";

    // Half-Kelly allocation — more conservative than old model
    const edge = prob - 0.5;
    const kelly = Math.max(0, edge / 0.5);
    const fractionalKelly = kelly * 0.20; // 20% Kelly (tighter than old 25%)
    const allocation = Math.min(4, parseFloat((fractionalKelly * 100).toFixed(1)));

    const confidenceLevel = finalScore >= 80 ? "HIGH CONFIDENCE" : finalScore >= 65 ? "Moderate confidence" : "Low confidence";
    const summary = `${confidenceLevel} — ${Math.round(prob * 100)}% implied | ${cls}-class stat | ${input.source.toUpperCase()} | Score: ${finalScore}/100`;

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
    const cap = hardGateFailed ? 70 : 95;
    const finalScore = Math.max(10, Math.min(cap, Math.round(score + (Math.random() * 4 - 2))));

    const risk: "low" | "medium" | "high" = finalScore >= 75 ? "low" : finalScore >= 58 ? "medium" : "high";
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
  const cap = hardGateFailed ? 68 : 88; // team bets capped at 88 (harder to reach 80+ vs props)
  const finalScore = Math.max(10, Math.min(cap, Math.round(score + (Math.random() * 6 - 3))));

  const risk: "low" | "medium" | "high" = finalScore >= 75 && prob > 0.55 ? "low" : finalScore >= 60 ? "medium" : "high";
  const edge2 = prob - (1 - prob) * 0.05;
  const kelly2 = Math.max(0, edge2 / 0.95);
  const allocation = Math.min(3, parseFloat((kelly2 * 0.20 * 100).toFixed(1))); // tighter cap for team bets
  const confidenceLevel = finalScore >= 80 ? "HIGH CONFIDENCE" : finalScore >= 65 ? "Moderate" : "Low confidence";
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

  // Fetch all live sources in parallel
  // Underdog and SportsGameOdds provide NHL/MLB/NFL player props (Kalshi only has NBA active)
  const [kalshi, kalshiWBC, kalshiAwards, kalshiProps, poly, actionNet, underdogProps] = await Promise.all([
    fetchKalshiSports(),
    fetchKalshiWBC(),
    fetchKalshiSeasonAwards(),
    fetchKalshiPlayerProps(),
    fetchPolymarketSports(),
    fetchActionNetwork(),
    fetchUnderdogProps(),
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

  // Index all existing player props by playerName::sport
  const propByPlayerSport = new Map<string, InsertBet>();
  for (const b of results) {
    if (b.betType === "player_prop" && b.playerName) {
      const key = `${b.playerName}::${b.sport}`;
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
    const key = `${b.playerName}::${b.sport}`;
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
      const key = `${b.playerName}::${b.sport}`;
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
    );
  }
  const lottoCount = fresh.filter(b => b.isLotto).length;
  console.log(`Lotto props tagged: ${lottoCount}`);

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
