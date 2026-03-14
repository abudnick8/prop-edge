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

// ─── ActionNetwork public API (no key required) ─────────────────────────────
// Provides public betting % (money & tickets) for spreads/totals/moneylines.
// Used as a supplemental consensus signal, especially when Odds API quota is exhausted.
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

async function fetchActionNetwork(): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  for (const [sportLabel, sportSlug] of Object.entries(ACTION_SPORTS)) {
    try {
      const url = `https://api.actionnetwork.com/web/v1/scoreboard/publicbetting/${sportSlug}?period=game&bookIds=${ACTION_BOOK_IDS}&date=${dateStr}`;
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.actionnetwork.com/",
          "Origin": "https://www.actionnetwork.com",
        },
      });

      const games = data?.games ?? data?.scoreboard ?? [];
      for (const game of games) {
        const homeTeam = game.home_team?.display_name ?? game.home_team?.name ?? "Home";
        const awayTeam = game.away_team?.display_name ?? game.away_team?.name ?? "Away";
        const gameTime = game.start_time ? new Date(game.start_time * 1000) : null;
        const markets = game.public_betting ?? game.odds ?? [];

        for (const mkt of markets) {
          const betType: string =
            mkt.type === "spread" ? "spread" :
            mkt.type === "total" ? "total" : "moneyline";

          // Money % tells us where sharp/public money is going
          const homeMoneyPct = parseFloat(mkt.home_money ?? mkt.money_home ?? "50") / 100;
          const awayMoneyPct = 1 - homeMoneyPct;

          // Determine stronger side
          const pickSide = homeMoneyPct >= awayMoneyPct ? "home" : "away";
          const pickTeam = pickSide === "home" ? homeTeam : awayTeam;
          const pickProb = pickSide === "home" ? homeMoneyPct : awayMoneyPct;

          if (pickProb < 0.52) continue; // skip near-50/50 signals — not actionable

          const line = mkt.current_line ?? mkt.line ?? null;
          const lineStr = line != null ? ` ${line > 0 ? "+" : ""}${line}` : "";
          const title = betType === "total"
            ? `${awayTeam} @ ${homeTeam} — Total ${mkt.over_money_pct ?? Math.round(homeMoneyPct * 100)}% on Over`
            : `${awayTeam} @ ${homeTeam} — ${pickTeam}${lineStr} (${Math.round(pickProb * 100)}% public money)`;

          const id = `action-${sportSlug}-${game.id ?? game.game_id ?? Date.now()}-${betType}-${pickSide}`;
          const score = computeConfidence({
            impliedProb: pickProb,
            source: "actionnetwork",
            betType,
            sport: sportLabel,
            title,
          });

          bets.push({
            id,
            source: "actionnetwork",
            sport: sportLabel,
            betType,
            title,
            description: `Public betting consensus via ActionNetwork — ${Math.round(pickProb * 100)}% of money on ${pickTeam}`,
            line: line ?? null,
            overOdds: null,
            underOdds: null,
            impliedProbability: pickProb,
            confidenceScore: score.score,
            riskLevel: score.risk,
            recommendedAllocation: score.allocation,
            keyFactors: [`${Math.round(pickProb * 100)}% public money on ${pickTeam}`, ...score.factors],
            researchSummary: score.summary,
            isHighConfidence: score.score >= 80,
            status: "open",
            homeTeam,
            awayTeam,
            playerName: null,
            gameTime,
            notificationSent: false,
            playerStats: null,
            teamStats: null,
            yesPrice: null,
            noPrice: null,
          });
        }
      }
    } catch (e: any) {
      console.warn(`ActionNetwork fetch error (${sportLabel}):`, e.message);
    }
  }
  console.log(`ActionNetwork: ${bets.length} consensus picks`);
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

        // Only future events, up to 8 per sport to conserve quota
        const now = Date.now();
        const upcomingEvents = (events ?? [])
          .filter((e: any) => new Date(e.commence_time).getTime() > now)
          .slice(0, 8);

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
  return bets.filter((b) => {
    if (!b.gameTime) return true; // no time info — keep (e.g. futures)
    return new Date(b.gameTime).getTime() > now;
  });
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

  // Fetch all live sources in parallel (ActionNetwork is free, no key needed)
  const [kalshi, poly, actionNet] = await Promise.all([
    fetchKalshiSports(),
    fetchPolymarketSports(),
    fetchActionNetwork(),
  ]);

  results.push(...kalshi, ...poly, ...actionNet);

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
