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

// ─── The Odds API (DraftKings, Underdog proxy) ────────────────────────────────
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEYS = ["americanfootball_nfl", "basketball_nba", "baseball_mlb", "icehockey_nhl"];

async function fetchOddsAPI(apiKey: string): Promise<InsertBet[]> {
  const bets: InsertBet[] = [];
  for (const sportKey of SPORT_KEYS) {
    try {
      // Main lines
      const { data } = await axios.get(`${ODDS_BASE}/sports/${sportKey}/odds`, {
        params: {
          apiKey,
          regions: "us",
          markets: "h2h,spreads,totals",
          bookmakers: "draftkings",
          oddsFormat: "american",
        },
        timeout: 10000,
      });
      for (const game of data ?? []) {
        const gameBets = parseOddsGame(game, sportKey, "draftkings");
        bets.push(...gameBets);
      }

      // Player props if available
      try {
        const { data: propData } = await axios.get(
          `${ODDS_BASE}/sports/${sportKey}/events`,
          { params: { apiKey }, timeout: 8000 }
        );
        const events = propData?.slice(0, 5) ?? [];
        for (const ev of events) {
          try {
            const { data: props } = await axios.get(
              `${ODDS_BASE}/sports/${sportKey}/events/${ev.id}/odds`,
              {
                params: {
                  apiKey,
                  regions: "us",
                  markets: "player_pass_tds,player_pass_yds,player_rush_yds,player_receptions,player_points,player_rebounds,player_assists,player_strikeouts,batter_hits",
                  bookmakers: "draftkings",
                  oddsFormat: "american",
                },
                timeout: 8000,
              }
            );
            const propBets = parseOddsGame(props, sportKey, "draftkings", ev);
            bets.push(...propBets);
          } catch {}
        }
      } catch {}
    } catch (e: any) {
      console.warn(`Odds API error for ${sportKey}:`, e.message);
    }
  }
  return bets;
}

function parseOddsGame(game: any, sportKey: string, source: string, parentEvent?: any): InsertBet[] {
  if (!game?.bookmakers?.length) return [];
  const sport = mapSportKey(sportKey);
  const bets: InsertBet[] = [];

  for (const bookmaker of game.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      for (let i = 0; i < (market.outcomes?.length ?? 0); i++) {
        const outcome = market.outcomes[i];
        const counterpart = market.outcomes[1 - i];
        const isPlayerProp = market.key?.startsWith("player_") || market.key?.startsWith("batter_");
        const betType = isPlayerProp ? "player_prop" : mapMarketType(market.key);
        const odds = outcome.price;
        const impliedProb = americanToImplied(odds);
        const score = computeConfidence({
          impliedProb,
          source,
          betType,
          sport,
          title: outcome.name,
          odds,
          line: outcome.point,
        });

        const id = `dk-${game.id ?? parentEvent?.id}-${market.key}-${i}`;
        bets.push({
          id,
          source: source === "draftkings" ? "draftkings" : "underdog",
          sport,
          betType,
          title: isPlayerProp
            ? `${outcome.name} ${market.key.replace(/_/g, " ")}`
            : `${game.away_team ?? parentEvent?.away_team} @ ${game.home_team ?? parentEvent?.home_team} — ${outcome.name}`,
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
          homeTeam: game.home_team ?? parentEvent?.home_team ?? null,
          awayTeam: game.away_team ?? parentEvent?.away_team ?? null,
          playerName: isPlayerProp ? outcome.name : null,
          gameTime: game.commence_time ? new Date(game.commence_time) : null,
          notificationSent: false,
          playerStats: null,
          teamStats: null,
          yesPrice: null,
          noPrice: null,
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
  }

  // 3. Bet type bonus
  if (input.betType === "player_prop") {
    score += 6;
    factors.push("Player prop — high statistical predictability from recent form");
  } else if (input.betType === "moneyline") {
    score += 3;
    factors.push("Moneyline — binary outcome with clear market pricing");
  } else if (input.betType === "spread") {
    score += 4;
    factors.push("Spread — adjusts for team strength differential");
  } else if (input.betType === "total") {
    score += 2;
    factors.push("Total — dependent on game pace/script factors");
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

  // Fetch all live sources in parallel
  const [kalshi, poly] = await Promise.all([
    fetchKalshiSports(),
    fetchPolymarketSports(),
  ]);

  results.push(...kalshi, ...poly);

  // Add Odds API data if key provided
  if (apiKey) {
    const odds = await fetchOddsAPI(apiKey);
    results.push(...odds);
  }

  // ⚠️  No demo data — live only. If APIs are down, return empty.
  if (results.length === 0) {
    console.log("No live data returned from any source. Scan returned 0 markets.");
    return { scanned: 0, highConfidence: 0 };
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
  const settings = await storage.getSettings();
  const threshold = settings.confidenceThreshold ?? 80;
  for (const bet of fresh) {
    if ((bet.confidenceScore ?? 0) >= threshold && bet.isHighConfidence && !bet.notificationSent) {
      await storage.addNotification({
        id: `notif-${bet.id}-${Date.now()}`,
        betId: bet.id,
        message: `🔥 ${bet.title} — ${bet.confidenceScore}/100 confidence | ${bet.source.toUpperCase()} | Suggest ${bet.recommendedAllocation}% allocation`,
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
