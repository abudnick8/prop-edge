/**
 * Clubhouse IQ — Sharp Money Engine
 * ══════════════════════════════════
 * Sources:
 *  1. Pinnacle Guest API  — no key needed. Per-matchup markets endpoint.
 *     key format: s;0;m (ML), s;0;s;{line} (spread), s;0;ou;{line} (total)
 *  2. OddsPapi (free key) — Pinnacle + 350 books. 250 req/month.
 *  3. ActionNetwork        — public bet % surfacing (server-to-server via key).
 */

// ── Constants ────────────────────────────────────────────────────────────────

const PINNACLE_GUEST_BASE = "https://guest.api.arcadia.pinnacle.com/0.1";

const ODDSPAPI_BASE = "https://api.oddspapi.io/v4";
const ODDSPAPI_KEY  = process.env.ODDSPAPI_KEY || "15c62ebc-0905-4858-87e4-87160b253149";

const ACTION_BASE = "https://api.actionnetwork.com/web/v1";
const ACTION_KEY  = process.env.ACTION_NETWORK_KEY || "95d975972c05aa2f9ea5c3688ffc327c8afdbfe3dbd59f3545715d8e3bf7bee2";

// Pinnacle Guest API league IDs
const PINNACLE_LEAGUES: Record<string, number> = {
  NBA: 487,
  MLB: 246,
  NHL: 1456,
  NFL: 889,
};

const ODDSPAPI_TOURNAMENTS: Record<string, number> = {
  NBA: 132,
  MLB: 34,
  NHL: 153,
  NFL: 31,
};

const ACTION_SLUGS: Record<string, string> = {
  NBA: "nba",
  MLB: "mlb",
  NHL: "nhl",
  NFL: "nfl",
};

const SOFT_BOOKS = ["draftkings", "fanduel", "bet365", "betmgm", "caesars"];

// Cache
const GAME_CACHE = new Map<string, { data: SharpGameData; ts: number }>();
const SPORT_CACHE = new Map<string, { games: SharpGameData[]; ts: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

// OddsPapi quota guard
let oddsPapiRequestsThisHour = 0;
let oddsPapiHourStart = Date.now();
const ODDSPAPI_HOURLY_LIMIT = 10;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SharpGameData {
  gameId:           string;
  sport:            string;
  homeTeam:         string;
  awayTeam:         string;
  startTime:        string | null;

  pinnacleSpread:   number | null;
  pinnacleTotal:    number | null;
  pinnacleML:       { home: number; away: number } | null;

  softSpread:       number | null;
  softTotal:        number | null;
  softML:           { home: number; away: number } | null;

  spreadDivergence: number | null;
  totalDivergence:  number | null;
  mlDivergence:     number | null;

  sharpBooksAgree:  boolean;
  sharpSide:        "home" | "away" | "over" | "under" | null;

  publicBetPct:    { home: number | null; away: number | null; over: number | null; under: number | null };
  publicMoneyPct:  { home: number | null; away: number | null; over: number | null; under: number | null };
  totalBets:       number | null;

  rlmDetected:     boolean;
  rlmSide:         "home" | "away" | "over" | "under" | null;
  rlmDescription:  string | null;

  sharpScore:      number;
  sharpSignals:    string[];
  sharpDirection:  "home" | "away" | "over" | "under" | "neutral";

  sources:         string[];
  updatedAt:       string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamMatch(a: string, b: string): boolean {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function canUseOddsPapi(): boolean {
  const now = Date.now();
  if (now - oddsPapiHourStart > 3_600_000) {
    oddsPapiRequestsThisHour = 0;
    oddsPapiHourStart = now;
  }
  return oddsPapiRequestsThisHour < ODDSPAPI_HOURLY_LIMIT;
}

// ── Source 1: Pinnacle Guest API ─────────────────────────────────────────────
// Step 1: GET /0.1/leagues/{id}/matchups?brandId=0  → list of matchups (no odds)
// Step 2: GET /0.1/matchups/{id}/markets/straight   → actual lines for each game

interface PinnacleMatchup {
  id: number;
  homeTeam: string;
  awayTeam: string;
  startTime: string | null;
}

interface PinnacleOdds {
  spread: number | null;     // home spread (closest-to-even line)
  total:  number | null;     // over/under line (closest-to-even)
  mlHome: number | null;     // home ML (American)
  mlAway: number | null;     // away ML (American)
}

async function fetchPinnacleMatchups(sport: string): Promise<PinnacleMatchup[]> {
  const leagueId = PINNACLE_LEAGUES[sport];
  if (!leagueId) return [];

  const res = await fetch(
    `${PINNACLE_GUEST_BASE}/leagues/${leagueId}/matchups?brandId=0`,
    { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`Pinnacle matchups ${sport} → ${res.status}`);

  const data: any[] = await res.json();
  const results: PinnacleMatchup[] = [];

  for (const m of data) {
    if (m.type !== "matchup" || !m.hasMarkets) continue;
    const parts: any[] = m.participants || [];
    const home = parts.find((p: any) => p.alignment === "home")?.name;
    const away = parts.find((p: any) => p.alignment === "away")?.name;
    if (!home || !away) continue;
    results.push({ id: m.id, homeTeam: home, awayTeam: away, startTime: m.startTime || null });
  }

  return results;
}

async function fetchPinnacleOdds(matchupId: number): Promise<PinnacleOdds> {
  const res = await fetch(
    `${PINNACLE_GUEST_BASE}/matchups/${matchupId}/markets/straight`,
    { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) return { spread: null, total: null, mlHome: null, mlAway: null };

  const markets: any[] = await res.json();

  let mlHome: number | null = null;
  let mlAway: number | null = null;
  let mainSpread: number | null = null;
  let mainTotal:  number | null = null;
  let bestSpreadAbsOdds = Infinity;
  let bestTotalAbsOdds  = Infinity;

  for (const mkt of markets) {
    const key: string = mkt.key || "";
    const prices: any[] = mkt.prices || [];

    // Moneyline: key = "s;0;m"
    if (key === "s;0;m") {
      for (const p of prices) {
        if (p.designation === "home") mlHome = p.price ?? null;
        if (p.designation === "away") mlAway = p.price ?? null;
      }
    }

    // Spread: key = "s;0;s;{line}" — pick closest-to-even (-110 is standard)
    if (/^s;0;s;/.test(key) && !mkt.isAlternate) {
      for (const p of prices) {
        if (p.designation === "home") {
          const absOdds = Math.abs(p.price - (-110));
          if (absOdds < bestSpreadAbsOdds) {
            bestSpreadAbsOdds = absOdds;
            mainSpread = p.points ?? null;
          }
        }
      }
    }

    // Total O/U: key = "s;0;ou;{line}"
    if (/^s;0;ou;/.test(key) && !mkt.isAlternate) {
      for (const p of prices) {
        if (p.designation === "over") {
          const absOdds = Math.abs(p.price - (-110));
          if (absOdds < bestTotalAbsOdds) {
            bestTotalAbsOdds = absOdds;
            mainTotal = p.points ?? null;
          }
        }
      }
    }
  }

  return { spread: mainSpread, total: mainTotal, mlHome, mlAway };
}

// ── Source 2: OddsPapi ───────────────────────────────────────────────────────

async function fetchOddsPapiData(sport: string, homeTeam: string, awayTeam: string): Promise<{
  softSpread: number | null;
  softTotal:  number | null;
  softMLHome: number | null;
  softMLAway: number | null;
  sharpBooksAgree: boolean;
} | null> {
  if (!canUseOddsPapi()) return null;
  try {
    const tournId = ODDSPAPI_TOURNAMENTS[sport];
    if (!tournId) return null;

    oddsPapiRequestsThisHour++;
    const qs = new URLSearchParams({ tournamentId: String(tournId), apiKey: ODDSPAPI_KEY });
    const res = await fetch(`${ODDSPAPI_BASE}/fixtures?${qs}`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const fixtures: any[] = await res.json();
    const match = fixtures.find((f: any) =>
      (teamMatch(f.participant1Name || "", homeTeam) || teamMatch(f.participant2Name || "", homeTeam)) &&
      (teamMatch(f.participant1Name || "", awayTeam) || teamMatch(f.participant2Name || "", awayTeam))
    );
    if (!match?.fixtureId) return null;

    oddsPapiRequestsThisHour++;
    const qs2 = new URLSearchParams({ fixtureId: String(match.fixtureId), apiKey: ODDSPAPI_KEY });
    const res2 = await fetch(`${ODDSPAPI_BASE}/odds?${qs2}`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res2.ok) return null;

    const oddsData: any = await res2.json();
    const books = oddsData.bookmakerOdds || {};

    const softSpreads: number[] = [];
    const softTotals:  number[] = [];
    const softMLHomes: number[] = [];
    const softMLAways: number[] = [];

    for (const book of SOFT_BOOKS) {
      const bData = books[book];
      if (!bData) continue;
      for (const [, mkt] of Array.from(Object.entries(bData.markets || {}))) {
        const m = mkt as any;
        const bmId = (m.bookmakerMarketId || "").toLowerCase();
        const outcomes = Object.values(m.outcomes || {}) as any[];

        if (bmId.includes("spread")) {
          for (const o of outcomes) {
            for (const p of Object.values(o.players || {}) as any[]) {
              const boId = (p.bookmakerOutcomeId || "").toLowerCase();
              if (boId.includes("home")) {
                const num = parseFloat(boId);
                if (!isNaN(num)) softSpreads.push(num);
              }
            }
          }
        }
        if (bmId.includes("total")) {
          for (const o of outcomes) {
            for (const p of Object.values(o.players || {}) as any[]) {
              const boId = (p.bookmakerOutcomeId || "").toLowerCase();
              if (boId.includes("over")) {
                const num = parseFloat(boId);
                if (!isNaN(num)) softTotals.push(num);
              }
            }
          }
        }
        if (bmId.includes("moneyline") || bmId.includes("h2h")) {
          for (const o of outcomes) {
            for (const p of Object.values(o.players || {}) as any[]) {
              const boId = (p.bookmakerOutcomeId || "").toLowerCase();
              const price = p.priceAmerican ? parseFloat(p.priceAmerican) : null;
              if (price !== null) {
                if (boId.includes("home")) softMLHomes.push(price);
                if (boId.includes("away")) softMLAways.push(price);
              }
            }
          }
        }
      }
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // Check if Asian sharp books (singbet, sbobet) are present
    const sharpBooksPresent = ["pinnacle", "singbet", "sbobet"].filter(b => books[b] && Object.keys(books[b].markets || {}).length > 0);
    const sharpBooksAgree = sharpBooksPresent.length >= 2;

    return {
      softSpread:      avg(softSpreads),
      softTotal:       avg(softTotals),
      softMLHome:      avg(softMLHomes),
      softMLAway:      avg(softMLAways),
      sharpBooksAgree,
    };
  } catch (e: any) {
    console.warn(`[SharpMoney] OddsPapi error: ${e.message}`);
    return null;
  }
}

// ── Source 3: ActionNetwork public betting % ─────────────────────────────────

interface ActionData {
  spreadHomePct: number | null;
  spreadHomeMoneyPct: number | null;
  overPct: number | null;
  overMoneyPct: number | null;
  mlHomePct: number | null;
  mlHomeMoneyPct: number | null;
  openSpread: number | null;
  currentSpread: number | null;
  openTotal: number | null;
  currentTotal: number | null;
  totalBets: number | null;
}

async function fetchActionData(sport: string, homeTeam: string, awayTeam: string): Promise<ActionData | null> {
  try {
    const slug = ACTION_SLUGS[sport];
    if (!slug) return null;

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    // Try both the public scoreboard and the authenticated endpoint
    const urls = [
      `${ACTION_BASE}/scoreboard/publicbetting/${slug}?period=game&bookIds=15,30,76,123&date=${today}`,
      `${ACTION_BASE}/games?sport=${slug}&date=${today}`,
    ];

    for (const url of urls) {
      const res = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${ACTION_KEY}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://www.actionnetwork.com/",
          "Origin": "https://www.actionnetwork.com",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;

      const data: any = await res.json();
      const games: any[] = data.games || data || [];

      const game = games.find((g: any) => {
        const teams: any[] = g.teams || [];
        const names = teams.map((t: any) => t.full_name || t.display_name || t.name || "");
        return names.some(n => teamMatch(n, homeTeam)) && names.some(n => teamMatch(n, awayTeam));
      });
      if (!game) continue;

      const odds = (game.odds || [])[0] || {};
      return {
        spreadHomePct:      odds.spread_home_public != null ? Number(odds.spread_home_public) : null,
        spreadHomeMoneyPct: odds.spread_home_money  != null ? Number(odds.spread_home_money)  : null,
        overPct:            odds.total_over_public  != null ? Number(odds.total_over_public)   : null,
        overMoneyPct:       odds.total_over_money   != null ? Number(odds.total_over_money)    : null,
        mlHomePct:          odds.ml_home_public     != null ? Number(odds.ml_home_public)      : null,
        mlHomeMoneyPct:     odds.ml_home_money      != null ? Number(odds.ml_home_money)       : null,
        openSpread:         odds.open_spread ?? null,
        currentSpread:      odds.spread_home ?? null,
        openTotal:          odds.open_total  ?? null,
        currentTotal:       odds.total       ?? null,
        totalBets:          game.num_bets    ?? null,
      };
    }
    return null;
  } catch (e: any) {
    console.warn(`[SharpMoney] ActionNetwork error: ${e.message}`);
    return null;
  }
}

// ── Sharp Score Calculator ────────────────────────────────────────────────────

function buildSharpScore(
  pinOdds: PinnacleOdds,
  softData: Awaited<ReturnType<typeof fetchOddsPapiData>>,
  action: ActionData | null,
): {
  score: number;
  signals: string[];
  direction: SharpGameData["sharpDirection"];
  rlmDetected: boolean;
  rlmSide: SharpGameData["rlmSide"];
  rlmDescription: string | null;
  spreadDivergence: number | null;
  totalDivergence:  number | null;
} {
  let score = 0;
  const signals: string[] = [];
  let direction: SharpGameData["sharpDirection"] = "neutral";
  let rlmDetected = false;
  let rlmSide: SharpGameData["rlmSide"] = null;
  let rlmDescription: string | null = null;
  let spreadDivergence: number | null = null;
  let totalDivergence:  number | null = null;

  // ── Layer 1: Pinnacle vs soft book divergence (up to 40 pts) ─────────────
  const pinSpread  = pinOdds.spread;
  const softSpread = softData?.softSpread ?? null;
  const pinTotal   = pinOdds.total;
  const softTotal  = softData?.softTotal ?? null;

  if (pinSpread !== null && softSpread !== null) {
    spreadDivergence = +(pinSpread - softSpread).toFixed(1);
    const abs = Math.abs(spreadDivergence);
    if (abs >= 2.5) {
      score += 40;
      const side = spreadDivergence < 0 ? "home" : "away";
      direction = side;
      signals.push(`Pinnacle spread (${pinSpread > 0 ? "+" : ""}${pinSpread}) diverges ${abs.toFixed(1)} pts from market — strong sharp signal on ${side.toUpperCase()}`);
    } else if (abs >= 1.5) {
      score += 25;
      const side = spreadDivergence < 0 ? "home" : "away";
      direction = side;
      signals.push(`Pinnacle spread diverges ${abs.toFixed(1)} pts from soft books — moderate sharp lean ${side.toUpperCase()}`);
    } else if (abs >= 0.5) {
      score += 10;
      signals.push(`Minor Pinnacle line divergence (${abs.toFixed(1)} pts) vs. soft book consensus`);
    }
  }

  if (pinTotal !== null && softTotal !== null) {
    totalDivergence = +(pinTotal - softTotal).toFixed(1);
    const abs = Math.abs(totalDivergence);
    if (abs >= 2) {
      score += Math.min(20, Math.round(abs * 5));
      const side: SharpGameData["sharpDirection"] = totalDivergence < 0 ? "under" : "over";
      if (direction === "neutral") direction = side;
      signals.push(`Pinnacle total (${pinTotal}) diverges ${abs.toFixed(1)} pts from market — sharp ${side.toUpperCase()} lean`);
    }
  }

  // ── Layer 2: Multiple sharp books agree (up to 20 pts) ───────────────────
  if (softData?.sharpBooksAgree) {
    score += 20;
    signals.push("Multiple sharp books (Pinnacle + Asian markets) aligned on same side");
  }

  // ── Layer 3: RLM detection from ActionNetwork (up to 25 pts) ─────────────
  if (action) {
    const spreadPubHome = action.spreadHomePct ?? action.mlHomePct;
    const openSpread    = action.openSpread;
    const curSpread     = action.currentSpread;

    if (spreadPubHome !== null && openSpread !== null && curSpread !== null && openSpread !== curSpread) {
      const lineMovedHome = curSpread < openSpread;
      const movedAmt      = Math.abs(curSpread - openSpread);

      if (lineMovedHome && spreadPubHome < 40) {
        rlmDetected = true; rlmSide = "home";
        rlmDescription = `Line moved ${movedAmt.toFixed(1)} pts toward HOME despite ${(100 - spreadPubHome).toFixed(0)}% public on AWAY`;
        score += 25;
        if (direction === "neutral") direction = "home";
        signals.push(`🚨 RLM: Sharp on HOME — ${rlmDescription}`);
      } else if (!lineMovedHome && spreadPubHome > 60) {
        rlmDetected = true; rlmSide = "away";
        rlmDescription = `Line moved ${movedAmt.toFixed(1)} pts toward AWAY despite ${spreadPubHome.toFixed(0)}% public on HOME`;
        score += 25;
        if (direction === "neutral") direction = "away";
        signals.push(`🚨 RLM: Sharp on AWAY — ${rlmDescription}`);
      }
    }

    const overPct    = action.overPct;
    const openTotal  = action.openTotal;
    const curTotal   = action.currentTotal;

    if (overPct !== null && openTotal !== null && curTotal !== null && openTotal !== curTotal) {
      const movedDown = curTotal < openTotal;
      const movedAmt  = Math.abs(curTotal - openTotal);

      if (movedDown && overPct > 60) {
        rlmDetected = true; rlmSide = "under";
        rlmDescription = `Total moved DOWN ${movedAmt.toFixed(1)} pts despite ${overPct.toFixed(0)}% public on OVER`;
        score += 20;
        if (direction === "neutral") direction = "under";
        signals.push(`🚨 RLM: Sharp UNDER — ${rlmDescription}`);
      } else if (!movedDown && overPct < 40) {
        rlmDetected = true; rlmSide = "over";
        rlmDescription = `Total moved UP ${movedAmt.toFixed(1)} pts despite ${(100 - overPct).toFixed(0)}% public on UNDER`;
        score += 20;
        if (direction === "neutral") direction = "over";
        signals.push(`🚨 RLM: Sharp OVER — ${rlmDescription}`);
      }
    }

    // ── Layer 4: Bet vs Money % split (up to 15 pts) ──────────────────────
    const betPct   = action.spreadHomePct ?? action.mlHomePct;
    const moneyPct = action.spreadHomeMoneyPct ?? action.mlHomeMoneyPct;

    if (betPct !== null && moneyPct !== null) {
      const diff = Math.abs(moneyPct - betPct);
      if (diff >= 25) {
        score += 15;
        const side = moneyPct > betPct ? "home" : "away";
        if (direction === "neutral") direction = side;
        signals.push(`${diff.toFixed(0)}pt money/ticket split — large wallets on ${side.toUpperCase()} (${moneyPct.toFixed(0)}% money vs ${betPct.toFixed(0)}% tickets)`);
      } else if (diff >= 15) {
        score += 8;
        signals.push(`${diff.toFixed(0)}pt money/ticket gap — possible sharp action`);
      }
    }
  }

  // If no signals at all, add a baseline note from Pinnacle lines
  if (signals.length === 0 && (pinOdds.spread !== null || pinOdds.total !== null)) {
    signals.push(`Pinnacle lines: spread ${pinOdds.spread ?? "N/A"} | total ${pinOdds.total ?? "N/A"} | ML home ${pinOdds.mlHome ?? "N/A"}`);
  }

  return {
    score: Math.min(100, score),
    signals,
    direction,
    rlmDetected,
    rlmSide,
    rlmDescription,
    spreadDivergence,
    totalDivergence,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchSharpMoneyAllSports(): Promise<SharpGameData[]> {
  const results: SharpGameData[] = [];
  await Promise.allSettled(["NBA", "MLB", "NHL", "NFL"].map(async (sport) => {
    try {
      const games = await fetchSharpMoneyBySport(sport);
      results.push(...games);
    } catch (e: any) {
      console.warn(`[SharpMoney] ${sport} top-level error: ${e.message}`);
    }
  }));
  return results.sort((a, b) => b.sharpScore - a.sharpScore);
}

export async function fetchSharpMoneyBySport(sport: string): Promise<SharpGameData[]> {
  const cached = SPORT_CACHE.get(sport);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.games;

  // Step 1: Get matchup list
  let matchups: PinnacleMatchup[] = [];
  try {
    matchups = await fetchPinnacleMatchups(sport);
  } catch (e: any) {
    console.warn(`[SharpMoney] Pinnacle matchups ${sport}: ${e.message}`);
    SPORT_CACHE.set(sport, { games: [], ts: Date.now() });
    return [];
  }

  if (matchups.length === 0) {
    SPORT_CACHE.set(sport, { games: [], ts: Date.now() });
    return [];
  }

  console.log(`[SharpMoney] ${sport}: ${matchups.length} matchups from Pinnacle`);

  // Step 2: Fetch odds + soft/action data for each game (capped at 12)
  const results: SharpGameData[] = [];

  for (const mu of matchups.slice(0, 12)) {
    const gameKey = `${sport}:${normalize(mu.homeTeam)}:${normalize(mu.awayTeam)}`;
    const cachedGame = GAME_CACHE.get(gameKey);
    if (cachedGame && Date.now() - cachedGame.ts < CACHE_TTL_MS) {
      results.push(cachedGame.data);
      continue;
    }

    // Fetch Pinnacle odds + soft/action data in parallel
    const [pinResult, softResult, actionResult] = await Promise.allSettled([
      fetchPinnacleOdds(mu.id),
      fetchOddsPapiData(sport, mu.homeTeam, mu.awayTeam),
      fetchActionData(sport, mu.homeTeam, mu.awayTeam),
    ]);

    const pinOdds  = pinResult.status  === "fulfilled" ? pinResult.value  : { spread: null, total: null, mlHome: null, mlAway: null };
    const softData = softResult.status === "fulfilled" ? softResult.value : null;
    const action   = actionResult.status === "fulfilled" ? actionResult.value : null;

    const { score, signals, direction, rlmDetected, rlmSide, rlmDescription, spreadDivergence, totalDivergence } =
      buildSharpScore(pinOdds, softData, action);

    const sources: string[] = ["Pinnacle"];
    if (softData) sources.push("OddsPapi");
    if (action)   sources.push("ActionNetwork");

    const gameData: SharpGameData = {
      gameId:    `${sport}-${mu.id}`,
      sport,
      homeTeam:  mu.homeTeam,
      awayTeam:  mu.awayTeam,
      startTime: mu.startTime,

      pinnacleSpread: pinOdds.spread,
      pinnacleTotal:  pinOdds.total,
      pinnacleML:     (pinOdds.mlHome !== null && pinOdds.mlAway !== null)
                        ? { home: pinOdds.mlHome, away: pinOdds.mlAway }
                        : null,

      softSpread: softData?.softSpread ?? null,
      softTotal:  softData?.softTotal  ?? null,
      softML:     (softData?.softMLHome != null && softData?.softMLAway != null)
                    ? { home: softData.softMLHome!, away: softData.softMLAway! }
                    : null,

      spreadDivergence,
      totalDivergence,
      mlDivergence: null,

      sharpBooksAgree: softData?.sharpBooksAgree ?? false,
      sharpSide: direction === "neutral" ? null : (direction as "home" | "away" | "over" | "under"),

      publicBetPct: {
        home:  action?.mlHomePct    ?? action?.spreadHomePct ?? null,
        away:  action ? (action.mlHomePct != null ? 100 - action.mlHomePct : action.spreadHomePct != null ? 100 - action.spreadHomePct : null) : null,
        over:  action?.overPct      ?? null,
        under: action?.overPct != null ? 100 - action.overPct : null,
      },
      publicMoneyPct: {
        home:  action?.mlHomeMoneyPct    ?? action?.spreadHomeMoneyPct ?? null,
        away:  action ? (action.mlHomeMoneyPct != null ? 100 - action.mlHomeMoneyPct : null) : null,
        over:  action?.overMoneyPct  ?? null,
        under: action?.overMoneyPct != null ? 100 - action.overMoneyPct : null,
      },
      totalBets: action?.totalBets ?? null,

      rlmDetected,
      rlmSide,
      rlmDescription,

      sharpScore:      score,
      sharpSignals:    signals,
      sharpDirection:  direction,

      sources,
      updatedAt: new Date().toISOString(),
    };

    GAME_CACHE.set(gameKey, { data: gameData, ts: Date.now() });
    results.push(gameData);
  }

  const sorted = results.sort((a, b) => b.sharpScore - a.sharpScore);
  SPORT_CACHE.set(sport, { games: sorted, ts: Date.now() });
  return sorted;
}

export async function fetchSharpMoneyForGame(sport: string, homeTeam: string, awayTeam: string): Promise<SharpGameData | null> {
  const games = await fetchSharpMoneyBySport(sport);
  return games.find(g =>
    (teamMatch(g.homeTeam, homeTeam) || teamMatch(g.awayTeam, homeTeam)) &&
    (teamMatch(g.homeTeam, awayTeam) || teamMatch(g.awayTeam, awayTeam))
  ) ?? null;
}
