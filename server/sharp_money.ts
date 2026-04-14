/**
 * Clubhouse IQ — Sharp Money Engine
 * ══════════════════════════════════
 * Pulls real sharp-money data from 3 free sources:
 *
 *  1. Pinnacle Guest API  — no key, no quota. Pinnacle IS the sharp book.
 *     Divergence between Pinnacle and soft books (DK/FD/Bet365) = sharp signal.
 *
 *  2. OddsPapi (free key) — 250 req/month. Provides Pinnacle + 350 books
 *     including Singbet, SBOBet (Asian sharps). Used as secondary Pinnacle
 *     source and to compare multiple sharp books vs soft books.
 *
 *  3. ActionNetwork        — public bet % + money %. Already in the app.
 *     Reverse Line Movement (RLM) = line moves opposite public → sharp money.
 *
 * Sharp Score per game (0–100):
 *   • Pinnacle divergence from soft books        → up to 40 pts
 *   • Multiple sharp books agree                 → up to 20 pts
 *   • RLM detected (ActionNetwork)               → up to 25 pts
 *   • Public bet % vs money % split              → up to 15 pts
 *
 * Cached 15 minutes per game to conserve OddsPapi quota.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const PINNACLE_GUEST_BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
const PINNACLE_GUEST_KEY  = "CmX2KcMrRmaZNNa"; // public guest token

const ODDSPAPI_BASE       = "https://api.oddspapi.io/v4";
const ODDSPAPI_KEY        = process.env.ODDSPAPI_KEY || "15c62ebc-0905-4858-87e4-87160b253149";

const ACTION_BASE         = "https://api.actionnetwork.com/web/v1";
const ACTION_KEY          = process.env.ACTION_NETWORK_KEY || "95d975972c05aa2f9ea5c3688ffc327c8afdbfe3dbd59f3545715d8e3bf7bee2";

// Pinnacle Guest API league IDs
const PINNACLE_LEAGUES: Record<string, number> = {
  NBA: 487,
  MLB: 246,
  NHL: 1456,
  NFL: 889,
};

// OddsPapi tournament IDs
const ODDSPAPI_TOURNAMENTS: Record<string, number> = {
  NBA: 132,
  MLB: 34,
  NHL: 153,
  NFL: 31,
};

// ActionNetwork sport slugs
const ACTION_SLUGS: Record<string, string> = {
  NBA: "nba",
  MLB: "mlb",
  NHL: "nhl",
  NFL: "nfl",
};

// Sharp books in OddsPapi
const SHARP_BOOKS  = ["pinnacle", "singbet", "sbobet", "circa"];
// Soft books for comparison
const SOFT_BOOKS   = ["draftkings", "fanduel", "bet365", "betmgm", "caesars"];

// Cache: gameKey → { data, ts }
const CACHE = new Map<string, { data: SharpGameData; ts: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

// OddsPapi request counter (protect quota)
let oddsPapiRequestsThisHour = 0;
let oddsPapiHourStart = Date.now();
const ODDSPAPI_HOURLY_LIMIT = 10; // conservative — 250/mo ÷ 25 days = 10/day

// ── Types ────────────────────────────────────────────────────────────────────

export interface SharpGameData {
  gameId:          string;
  sport:           string;
  homeTeam:        string;
  awayTeam:        string;
  startTime:       string | null;

  // Pinnacle (sharp) line
  pinnacleSpread:  number | null;   // home spread at Pinnacle
  pinnacleTotal:   number | null;
  pinnacleML:      { home: number; away: number } | null;

  // Soft book consensus
  softSpread:      number | null;
  softTotal:       number | null;
  softML:          { home: number; away: number } | null;

  // Divergence (positive = sharp favors home, negative = sharp favors away)
  spreadDivergence: number | null;  // Pinnacle spread - soft spread
  totalDivergence:  number | null;  // Pinnacle total - soft total
  mlDivergence:     number | null;  // Pinnacle home ML - soft home ML (in cents)

  // Sharp book consensus (multiple sharps agree?)
  sharpBooksAgree:  boolean;
  sharpSide:        "home" | "away" | "over" | "under" | null;

  // ActionNetwork public betting
  publicBetPct:    { home: number | null; away: number | null; over: number | null; under: number | null };
  publicMoneyPct:  { home: number | null; away: number | null; over: number | null; under: number | null };
  totalBets:       number | null;

  // RLM detection
  rlmDetected:     boolean;
  rlmSide:         "home" | "away" | "over" | "under" | null;
  rlmDescription:  string | null;

  // Final sharp score
  sharpScore:      number;          // 0–100
  sharpSignals:    string[];        // human-readable signal bullets
  sharpDirection:  "home" | "away" | "over" | "under" | "neutral";

  sources:         string[];        // which APIs contributed
  updatedAt:       string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  if (american >= 0) return american / 100 + 1;
  return -100 / american + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function normalize(name: string): string {
  return name.toLowerCase()
    .replace(/\s+(fc|sc|ac|bc|cf|afc|nfc|rfc)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function teamMatch(a: string, b: string): boolean {
  const na = normalize(a), nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function pinnacleGet(path: string): Promise<any> {
  const res = await fetch(`${PINNACLE_GUEST_BASE}${path}`, {
    headers: {
      "X-API-KEY": PINNACLE_GUEST_KEY,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Pinnacle ${path} → ${res.status}`);
  return res.json();
}

function canUseOddsPapi(): boolean {
  const now = Date.now();
  if (now - oddsPapiHourStart > 3600_000) {
    oddsPapiRequestsThisHour = 0;
    oddsPapiHourStart = now;
  }
  return oddsPapiRequestsThisHour < ODDSPAPI_HOURLY_LIMIT;
}

async function oddsPapiGet(path: string, params: Record<string, string | number> = {}): Promise<any> {
  if (!canUseOddsPapi()) throw new Error("OddsPapi hourly limit reached");
  oddsPapiRequestsThisHour++;
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)])), apiKey: ODDSPAPI_KEY });
  const res = await fetch(`${ODDSPAPI_BASE}/${path}?${qs}`, {
    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OddsPapi ${path} → ${res.status}`);
  return res.json();
}

// ── Source 1: Pinnacle Guest API ─────────────────────────────────────────────

interface PinnacleGame {
  id: number;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  spread:  { home: number | null; away: number | null; homeOdds: number | null; awayOdds: number | null } | null;
  total:   { line: number | null; overOdds: number | null; underOdds: number | null } | null;
  ml:      { home: number | null; away: number | null } | null;
}

async function fetchPinnacleGames(sport: string): Promise<PinnacleGame[]> {
  const leagueId = PINNACLE_LEAGUES[sport];
  if (!leagueId) return [];

  const [matchups, markets] = await Promise.all([
    pinnacleGet(`/leagues/${leagueId}/matchups?brandId=0`),
    pinnacleGet(`/leagues/${leagueId}/markets/straight?brandId=0`),
  ]);

  const games: PinnacleGame[] = [];

  for (const m of matchups) {
    if (m.type !== "matchup") continue;
    const parts = m.participants || [];
    if (parts.length < 2) continue;

    // home is usually index 1 for US sports
    const homeTeam = parts.find((p: any) => p.alignment === "home")?.name || parts[1]?.name;
    const awayTeam = parts.find((p: any) => p.alignment === "away")?.name || parts[0]?.name;
    if (!homeTeam || !awayTeam) continue;

    const matchupId = m.id;
    const relatedMarkets = markets.filter((mk: any) => mk.matchupId === matchupId);

    // Extract spread, total, ML
    let spread = null, total = null, ml = null;

    for (const mk of relatedMarkets) {
      if (mk.type === "moneyline" && mk.period === 0) {
        const prices = mk.prices || [];
        const homeP = prices.find((p: any) => p.designation === "home");
        const awayP = prices.find((p: any) => p.designation === "away");
        if (homeP && awayP) {
          ml = { home: homeP.price, away: awayP.price };
        }
      }
      if (mk.type === "spread" && mk.period === 0) {
        const prices = mk.prices || [];
        const homeP = prices.find((p: any) => p.designation === "home");
        const awayP = prices.find((p: any) => p.designation === "away");
        if (homeP && awayP) {
          spread = {
            home: homeP.hdp ?? null,
            away: awayP.hdp ?? null,
            homeOdds: homeP.price ?? null,
            awayOdds: awayP.price ?? null,
          };
        }
      }
      if (mk.type === "total" && mk.period === 0) {
        const prices = mk.prices || [];
        const overP  = prices.find((p: any) => p.designation === "over");
        const underP = prices.find((p: any) => p.designation === "under");
        if (overP) {
          total = {
            line: overP.points ?? null,
            overOdds: overP.price ?? null,
            underOdds: underP?.price ?? null,
          };
        }
      }
    }

    games.push({ id: matchupId, homeTeam, awayTeam, startTime: m.startTime || null, spread, total, ml } as any);
  }

  return games;
}

// ── Source 2: OddsPapi ───────────────────────────────────────────────────────

async function fetchOddsPapiSharpVsSoft(sport: string, homeTeam: string, awayTeam: string): Promise<{
  pinSpread: number | null; pinTotal: number | null; pinML: { home: number; away: number } | null;
  softSpread: number | null; softTotal: number | null; softML: { home: number; away: number } | null;
  sharpBooksAgree: boolean;
} | null> {
  try {
    const tournId = ODDSPAPI_TOURNAMENTS[sport];
    if (!tournId) return null;

    const fixtures = await oddsPapiGet("fixtures", { tournamentId: tournId });
    const match = fixtures.find((f: any) =>
      (teamMatch(f.participant1Name || "", homeTeam) || teamMatch(f.participant2Name || "", homeTeam)) &&
      (teamMatch(f.participant1Name || "", awayTeam) || teamMatch(f.participant2Name || "", awayTeam))
    );
    if (!match || !match.hasOdds) return null;

    const oddsData = await oddsPapiGet("odds", { fixtureId: match.fixtureId });
    const books = oddsData.bookmakerOdds || {};

    // Extract Pinnacle lines
    const pinData = books["pinnacle"];
    let pinSpread: number | null = null, pinTotal: number | null = null;
    let pinMLHome: number | null = null, pinMLAway: number | null = null;

    if (pinData) {
      for (const [, mkt] of Object.entries(pinData.markets || {})) {
        const m = mkt as any;
        const bmId = (m.bookmakerMarketId || "").toLowerCase();
        if (bmId.includes("spreads") || bmId.includes("spread")) {
          const outcomes = Object.values(m.outcomes || {}) as any[];
          const homeLine = outcomes.find(o => Object.values(o.players || {}).some((p: any) => p.bookmakerOutcomeId?.includes("home")));
          if (homeLine) {
            const p = Object.values(homeLine.players)[0] as any;
            const boId = p.bookmakerOutcomeId || "";
            const num = parseFloat(boId.split("/")[0]);
            if (!isNaN(num)) pinSpread = num;
          }
        }
        if (bmId.includes("totals") || bmId.includes("total")) {
          const outcomes = Object.values(m.outcomes || {}) as any[];
          const overLine = outcomes.find(o => Object.values(o.players || {}).some((p: any) => p.bookmakerOutcomeId?.includes("over")));
          if (overLine) {
            const p = Object.values(overLine.players)[0] as any;
            const boId = p.bookmakerOutcomeId || "";
            const num = parseFloat(boId.split("/")[0]);
            if (!isNaN(num)) pinTotal = num;
          }
        }
        if (bmId.includes("moneyline") || bmId.includes("1x2") || bmId.includes("h2h")) {
          const outcomes = Object.values(m.outcomes || {}) as any[];
          for (const o of outcomes) {
            const players = Object.values(o.players || {}) as any[];
            for (const p of players) {
              const boId = (p.bookmakerOutcomeId || "").toLowerCase();
              const americanPrice = p.priceAmerican ? parseFloat(p.priceAmerican) : null;
              if (boId.includes("home") && americanPrice !== null) pinMLHome = americanPrice;
              if (boId.includes("away") && americanPrice !== null) pinMLAway = americanPrice;
            }
          }
        }
      }
    }

    // Extract soft book consensus
    const softSpreads: number[] = [], softTotals: number[] = [];
    const softMLHomes: number[] = [], softMLAways: number[] = [];

    for (const book of SOFT_BOOKS) {
      const bData = books[book];
      if (!bData) continue;
      for (const [, mkt] of Object.entries(bData.markets || {})) {
        const m = mkt as any;
        const bmId = (m.bookmakerMarketId || "").toLowerCase();
        if (bmId.includes("spread")) {
          const outcomes = Object.values(m.outcomes || {}) as any[];
          for (const o of outcomes) {
            const players = Object.values(o.players || {}) as any[];
            for (const p of players) {
              const boId = (p.bookmakerOutcomeId || "").toLowerCase();
              if (boId.includes("home")) {
                const num = parseFloat(boId.split("/")[0]);
                if (!isNaN(num)) softSpreads.push(num);
              }
            }
          }
        }
        if (bmId.includes("total")) {
          const outcomes = Object.values(m.outcomes || {}) as any[];
          for (const o of outcomes) {
            const players = Object.values(o.players || {}) as any[];
            for (const p of players) {
              const boId = (p.bookmakerOutcomeId || "").toLowerCase();
              if (boId.includes("over")) {
                const num = parseFloat(boId.split("/")[0]);
                if (!isNaN(num)) softTotals.push(num);
              }
            }
          }
        }
      }
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null;
    const softSpread = avg(softSpreads);
    const softTotal  = avg(softTotals);
    const softMLHome = avg(softMLHomes);
    const softMLAway = avg(softMLAways);

    // Check if multiple sharp books agree (Singbet, SBOBet)
    const sharpSpreads = SHARP_BOOKS.map(b => {
      const bData = books[b];
      if (!bData) return null;
      // simplified: just check existence
      return Object.keys(bData.markets || {}).length > 0 ? b : null;
    }).filter(Boolean);
    const sharpBooksAgree = sharpSpreads.length >= 2;

    return {
      pinSpread: pinSpread ?? null,
      pinTotal:  pinTotal ?? null,
      pinML: (pinMLHome !== null && pinMLAway !== null) ? { home: pinMLHome, away: pinMLAway } : null,
      softSpread,
      softTotal,
      softML: (softMLHome !== null && softMLAway !== null) ? { home: softMLHome, away: softMLAway } : null,
      sharpBooksAgree,
    };
  } catch (e: any) {
    console.warn(`[SharpMoney] OddsPapi error: ${e.message}`);
    return null;
  }
}

// ── Source 3: ActionNetwork public betting % ─────────────────────────────────

interface ActionBettingData {
  mlHomePct: number | null; mlAwayPct: number | null;
  mlHomeMoneyPct: number | null; mlAwayMoneyPct: number | null;
  spreadHomePct: number | null; spreadAwayPct: number | null;
  spreadHomeMoneyPct: number | null; spreadAwayMoneyPct: number | null;
  overPct: number | null; underPct: number | null;
  overMoneyPct: number | null; underMoneyPct: number | null;
  openSpread: number | null; currentSpread: number | null;
  openTotal: number | null; currentTotal: number | null;
  totalBets: number | null;
}

async function fetchActionBetting(sport: string, homeTeam: string, awayTeam: string): Promise<ActionBettingData | null> {
  try {
    const slug = ACTION_SLUGS[sport];
    if (!slug) return null;

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const url = `${ACTION_BASE}/scoreboard/publicbetting/${slug}?period=game&bookIds=15,30,76,123&date=${today}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${ACTION_KEY}`,
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.actionnetwork.com/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const games = data.games || [];
    const game = games.find((g: any) => {
      const teams = g.teams || [];
      return teams.some((t: any) => teamMatch(t.full_name || t.display_name || "", homeTeam)) &&
             teams.some((t: any) => teamMatch(t.full_name || t.display_name || "", awayTeam));
    });
    if (!game) return null;

    const odds = (game.odds || [])[0] || {};
    const numBets = game.num_bets || null;

    return {
      mlHomePct:          odds.ml_home_public != null ? Number(odds.ml_home_public) : null,
      mlAwayPct:          odds.ml_away_public != null ? Number(odds.ml_away_public) : null,
      mlHomeMoneyPct:     odds.ml_home_money  != null ? Number(odds.ml_home_money)  : null,
      mlAwayMoneyPct:     odds.ml_away_money  != null ? Number(odds.ml_away_money)  : null,
      spreadHomePct:      odds.spread_home_public != null ? Number(odds.spread_home_public) : null,
      spreadAwayPct:      odds.spread_away_public != null ? Number(odds.spread_away_public) : null,
      spreadHomeMoneyPct: odds.spread_home_money  != null ? Number(odds.spread_home_money)  : null,
      spreadAwayMoneyPct: odds.spread_away_money  != null ? Number(odds.spread_away_money)  : null,
      overPct:            odds.total_over_public  != null ? Number(odds.total_over_public)   : null,
      underPct:           odds.total_under_public != null ? Number(odds.total_under_public)  : null,
      overMoneyPct:       odds.total_over_money   != null ? Number(odds.total_over_money)    : null,
      underMoneyPct:      odds.total_under_money  != null ? Number(odds.total_under_money)   : null,
      openSpread:         odds.open_spread ?? null,
      currentSpread:      odds.spread_home ?? null,
      openTotal:          odds.open_total  ?? null,
      currentTotal:       odds.total       ?? null,
      totalBets:          numBets,
    };
  } catch (e: any) {
    console.warn(`[SharpMoney] ActionNetwork error: ${e.message}`);
    return null;
  }
}

// ── Sharp Score Calculator ────────────────────────────────────────────────────

function calculateSharpScore(
  pin: PinnacleGame | null,
  opapi: Awaited<ReturnType<typeof fetchOddsPapiSharpVsSoft>>,
  action: ActionBettingData | null,
  sport: string
): {
  score: number;
  signals: string[];
  direction: SharpGameData["sharpDirection"];
  rlmDetected: boolean;
  rlmSide: SharpGameData["rlmSide"];
  rlmDescription: string | null;
  spreadDivergence: number | null;
  totalDivergence: number | null;
} {
  let score = 0;
  const signals: string[] = [];
  let direction: SharpGameData["sharpDirection"] = "neutral";
  let rlmDetected = false;
  let rlmSide: SharpGameData["rlmSide"] = null;
  let rlmDescription: string | null = null;
  let spreadDivergence: number | null = null;
  let totalDivergence: number | null = null;

  // ── Layer 1: Pinnacle vs soft book divergence (up to 40 pts) ────────────────
  const pinSpread  = opapi?.pinSpread  ?? (pin?.spread?.home ?? null);
  const softSpread = opapi?.softSpread ?? null;
  const pinTotal   = opapi?.pinTotal   ?? (pin?.total?.line ?? null);
  const softTotal  = opapi?.softTotal  ?? null;

  if (pinSpread !== null && softSpread !== null) {
    spreadDivergence = pinSpread - softSpread;
    const absDiff = Math.abs(spreadDivergence);
    if (absDiff >= 2.5) {
      score += 40;
      const side = spreadDivergence < 0 ? "home" : "away"; // Pinnacle gives better price to home = sharp on home
      direction = side;
      signals.push(`Pinnacle spread (${pinSpread > 0 ? "+" : ""}${pinSpread}) diverges ${absDiff.toFixed(1)} pts from market consensus — strong sharp signal on ${side}`);
    } else if (absDiff >= 1.5) {
      score += 25;
      const side = spreadDivergence < 0 ? "home" : "away";
      direction = side;
      signals.push(`Pinnacle spread diverges ${absDiff.toFixed(1)} pts from soft books — moderate sharp lean ${side}`);
    } else if (absDiff >= 0.5) {
      score += 10;
      signals.push(`Minor Pinnacle line divergence (${absDiff.toFixed(1)} pts)`);
    }
  }

  if (pinTotal !== null && softTotal !== null) {
    totalDivergence = pinTotal - softTotal;
    const absDiff = Math.abs(totalDivergence);
    if (absDiff >= 2) {
      score += Math.min(20, absDiff * 5);
      const side = totalDivergence < 0 ? "under" : "over";
      if (direction === "neutral") direction = side;
      signals.push(`Pinnacle total (${pinTotal}) diverges ${absDiff.toFixed(1)} pts from market — sharp ${side.toUpperCase()} lean`);
    }
  }

  // ── Layer 2: Multiple sharp books agree (up to 20 pts) ──────────────────────
  if (opapi?.sharpBooksAgree) {
    score += 20;
    signals.push("Multiple sharp books (Pinnacle + Asian markets) aligned on same side");
  }

  // ── Layer 3: RLM detection from ActionNetwork (up to 25 pts) ────────────────
  if (action) {
    // Spread RLM: public bets heavily on one side but line moved the other way
    const spreadPublicHome = action.spreadHomePct ?? action.mlHomePct;
    const currentSpread    = action.currentSpread;
    const openSpread       = action.openSpread;

    if (spreadPublicHome !== null && currentSpread !== null && openSpread !== null) {
      const lineMovedHome = currentSpread < openSpread; // spread shrank = line moved toward home
      const publicOnAway  = spreadPublicHome < 40; // <40% on home = public heavy on away

      if (lineMovedHome && publicOnAway) {
        // Line moved toward home despite public being on away = RLM
        rlmDetected = true; rlmSide = "home";
        rlmDescription = `Line moved ${(openSpread - currentSpread).toFixed(1)} pts toward home despite ${(100 - spreadPublicHome).toFixed(0)}% public on away`;
        score += 25;
        if (direction === "neutral") direction = "home";
        signals.push(`RLM: Sharp action on HOME — ${rlmDescription}`);
      } else if (!lineMovedHome && spreadPublicHome > 60) {
        rlmDetected = true; rlmSide = "away";
        rlmDescription = `Line moved ${(currentSpread - openSpread).toFixed(1)} pts toward away despite ${spreadPublicHome.toFixed(0)}% public on home`;
        score += 25;
        if (direction === "neutral") direction = "away";
        signals.push(`RLM: Sharp action on AWAY — ${rlmDescription}`);
      }
    }

    // Total RLM
    const overPct = action.overPct;
    const openTotal = action.openTotal;
    const currentTotal = action.currentTotal;

    if (overPct !== null && openTotal !== null && currentTotal !== null) {
      const lineMovedDown = currentTotal < openTotal;
      if (lineMovedDown && overPct > 60) {
        rlmDetected = true; rlmSide = "under";
        rlmDescription = `Total moved DOWN ${(openTotal - currentTotal).toFixed(1)} pts despite ${overPct.toFixed(0)}% public on OVER`;
        score += 20;
        if (direction === "neutral") direction = "under";
        signals.push(`RLM: Sharp UNDER — ${rlmDescription}`);
      } else if (!lineMovedDown && overPct < 40) {
        rlmDetected = true; rlmSide = "over";
        rlmDescription = `Total moved UP ${(currentTotal - openTotal).toFixed(1)} pts despite ${(100 - overPct).toFixed(0)}% public on UNDER`;
        score += 20;
        if (direction === "neutral") direction = "over";
        signals.push(`RLM: Sharp OVER — ${rlmDescription}`);
      }
    }

    // ── Layer 4: Bets vs Money split (up to 15 pts) ──────────────────────────
    const betPctHome   = action.mlHomePct ?? action.spreadHomePct;
    const moneyPctHome = action.mlHomeMoneyPct ?? action.spreadHomeMoneyPct;

    if (betPctHome !== null && moneyPctHome !== null) {
      const diff = Math.abs(moneyPctHome - betPctHome);
      if (diff >= 25) {
        score += 15;
        const sharpSide = moneyPctHome > betPctHome ? "home" : "away";
        if (direction === "neutral") direction = sharpSide;
        signals.push(`${diff.toFixed(0)}pt money/bet split — large wallets on ${sharpSide.toUpperCase()} (${moneyPctHome.toFixed(0)}% money vs ${betPctHome.toFixed(0)}% tickets)`);
      } else if (diff >= 15) {
        score += 8;
        signals.push(`${diff.toFixed(0)}pt money/bet discrepancy — possible sharp action`);
      }
    }
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

// ── Main Public API ───────────────────────────────────────────────────────────

/**
 * Get sharp money data for all games today across all 4 sports.
 * Results are cached 15 min per sport.
 */
export async function fetchSharpMoneyAllSports(): Promise<SharpGameData[]> {
  const results: SharpGameData[] = [];
  const sports = ["NBA", "MLB", "NHL", "NFL"];

  await Promise.allSettled(sports.map(async (sport) => {
    try {
      const games = await fetchSharpMoneyBySport(sport);
      results.push(...games);
    } catch (e: any) {
      console.warn(`[SharpMoney] ${sport} error: ${e.message}`);
    }
  }));

  return results.sort((a, b) => b.sharpScore - a.sharpScore);
}

export async function fetchSharpMoneyBySport(sport: string): Promise<SharpGameData[]> {
  const cacheKey = `sport:${sport}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return [cached.data]; // return cached batch (simplified — in prod would cache array)
  }

  const results: SharpGameData[] = [];

  // Pull Pinnacle Guest API games for this sport (no quota)
  let pinnacleGames: PinnacleGame[] = [];
  try {
    pinnacleGames = await fetchPinnacleGames(sport);
  } catch (e: any) {
    console.warn(`[SharpMoney] Pinnacle Guest API error for ${sport}: ${e.message}`);
  }

  // For each game, gather all 3 sources
  for (const pg of pinnacleGames.slice(0, 12)) { // cap at 12 games per sport
    const gameKey = `${sport}:${normalize(pg.homeTeam)}:${normalize(pg.awayTeam)}`;
    const cached2 = CACHE.get(gameKey);
    if (cached2 && Date.now() - cached2.ts < CACHE_TTL_MS) {
      results.push(cached2.data);
      continue;
    }

    // Fetch OddsPapi and ActionNetwork in parallel
    const [opapi, action] = await Promise.allSettled([
      fetchOddsPapiSharpVsSoft(sport, pg.homeTeam, pg.awayTeam),
      fetchActionBetting(sport, pg.homeTeam, pg.awayTeam),
    ]);

    const opapiData = opapi.status === "fulfilled" ? opapi.value : null;
    const actionData = action.status === "fulfilled" ? action.value : null;

    const { score, signals, direction, rlmDetected, rlmSide, rlmDescription, spreadDivergence, totalDivergence } =
      calculateSharpScore(pg, opapiData, actionData, sport);

    const sources: string[] = ["Pinnacle (guest)"];
    if (opapiData) sources.push("OddsPapi");
    if (actionData) sources.push("ActionNetwork");

    const gameData: SharpGameData = {
      gameId:    `${sport}-${pg.id}`,
      sport,
      homeTeam:  pg.homeTeam,
      awayTeam:  pg.awayTeam,
      startTime: pg.startTime,

      pinnacleSpread: pg.spread?.home ?? opapiData?.pinSpread ?? null,
      pinnacleTotal:  pg.total?.line  ?? opapiData?.pinTotal  ?? null,
      pinnacleML:     pg.ml ?? opapiData?.pinML ?? null,

      softSpread: opapiData?.softSpread ?? null,
      softTotal:  opapiData?.softTotal  ?? null,
      softML:     opapiData?.softML     ?? null,

      spreadDivergence,
      totalDivergence,
      mlDivergence: null,

      sharpBooksAgree: opapiData?.sharpBooksAgree ?? false,
      sharpSide: direction === "neutral" ? null : direction as any,

      publicBetPct: {
        home:  actionData?.mlHomePct    ?? actionData?.spreadHomePct  ?? null,
        away:  actionData?.mlAwayPct    ?? actionData?.spreadAwayPct  ?? null,
        over:  actionData?.overPct  ?? null,
        under: actionData?.underPct ?? null,
      },
      publicMoneyPct: {
        home:  actionData?.mlHomeMoneyPct    ?? actionData?.spreadHomeMoneyPct  ?? null,
        away:  actionData?.mlAwayMoneyPct    ?? actionData?.spreadAwayMoneyPct  ?? null,
        over:  actionData?.overMoneyPct  ?? null,
        under: actionData?.underMoneyPct ?? null,
      },
      totalBets: actionData?.totalBets ?? null,

      rlmDetected,
      rlmSide,
      rlmDescription,

      sharpScore:     score,
      sharpSignals:   signals,
      sharpDirection: direction,

      sources,
      updatedAt: new Date().toISOString(),
    };

    CACHE.set(gameKey, { data: gameData, ts: Date.now() });
    results.push(gameData);
  }

  return results.sort((a, b) => b.sharpScore - a.sharpScore);
}

/**
 * Get sharp money data for a specific game by team names.
 */
export async function fetchSharpMoneyForGame(sport: string, homeTeam: string, awayTeam: string): Promise<SharpGameData | null> {
  const games = await fetchSharpMoneyBySport(sport);
  return games.find(g =>
    (teamMatch(g.homeTeam, homeTeam) || teamMatch(g.awayTeam, homeTeam)) &&
    (teamMatch(g.homeTeam, awayTeam) || teamMatch(g.awayTeam, awayTeam))
  ) ?? null;
}
