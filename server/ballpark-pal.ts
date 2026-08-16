// ═══════════════════════════════════════════════════════════════════════════
// Ballpark Pal API integration — MLB simulation-based analytics
// Docs: https://www.ballparkpal.com/api/docs/
//
// Ballpark Pal simulates every MLB game ~3,000 times before first pitch and
// exposes: modeled game/team/batter/pitcher probabilities, simulated stat
// projections, park factors (stadium + weather split out), and a
// batter-vs-pitcher matchup model.
//
// This module is an ADDITIVE enhancement layer. Every function degrades
// gracefully — on missing key, auth failure, rate limit, quota exhaustion,
// or any network error, it returns null/empty and the caller must fall back
// to Clubhouse IQ's existing internal analysis (MLB Stats API splits, Savant
// leaderboards, internal Monte Carlo sim, internal park/weather model).
// Ballpark Pal is NEVER a hard dependency — see BallparkPalGlossary.tsx for
// the documented fallback mapping shown to users.
// ═══════════════════════════════════════════════════════════════════════════

const BPP_BASE = "https://www.ballparkpal.com/api/v1";

function bppKey(): string | null {
  const k = process.env.BALLPARK_PAL_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : null;
}

// ── Circuit breaker: if BPP fails repeatedly, stop hammering it for a while ──
let _bppOutageUntil = 0;
const BPP_OUTAGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

export function bppIsAvailable(): boolean {
  if (!bppKey()) return false;
  return Date.now() > _bppOutageUntil;
}

function _tripOutage() {
  _bppOutageUntil = Date.now() + BPP_OUTAGE_COOLDOWN_MS;
}

// ── Generic cached GET ───────────────────────────────────────────────────────
interface CacheEntry { data: any; expires: number; }
const _cache = new Map<string, CacheEntry>();

async function bppGet(path: string, params: Record<string, string | number>, ttlMs: number): Promise<any | null> {
  const key = bppKey();
  if (!key) return null;
  if (Date.now() < _bppOutageUntil) return null;

  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const cacheKey = `${path}?${qs.toString()}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const r = await fetch(`${BPP_BASE}${path}?${qs.toString()}`, {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 || r.status === 403) {
      console.warn(`[BallparkPal] auth/subscription error on ${path} (${r.status}) — disabling for cooldown`);
      _tripOutage();
      return null;
    }
    if (r.status === 429) {
      console.warn(`[BallparkPal] rate limited / quota exceeded on ${path} — disabling for cooldown`);
      _tripOutage();
      return null;
    }
    if (!r.ok) {
      console.warn(`[BallparkPal] ${path} returned ${r.status}`);
      return null;
    }
    const json = await r.json();
    const data = json?.data ?? null;
    _cache.set(cacheKey, { data, expires: Date.now() + ttlMs });
    return data;
  } catch (e: any) {
    console.warn(`[BallparkPal] fetch failed for ${path}:`, e.message);
    return null;
  }
}

const TTL_GAMES      = 30 * 60 * 1000; // 30 min — lineups can firm up during the day
const TTL_MATCHUPS   = 30 * 60 * 1000;
const TTL_PARKFACTOR = 60 * 60 * 1000; // park/weather factors move slowly
const TTL_AVERAGES   = 30 * 60 * 1000;
const TTL_PROBS      = 15 * 60 * 1000; // closest to "live" — shorter TTL

// ── /games — list of today's/future games with BPP's internal gameId ────────
export interface BppGame {
  gameId: number; gameDate: string; gameTime: string; gameTimeUTC: string;
  teamAwayId: number; teamHomeId: number; venueId: number; lineupsOfficial: boolean;
}
export async function bppGetGames(date: string): Promise<BppGame[]> {
  const data = await bppGet("/games", { date }, TTL_GAMES);
  return data?.items ?? [];
}

// Match a Clubhouse IQ (MLB Stats API) gamePk to BPP's own gameId via team ID pair.
// BPP team IDs are the same numeric IDs as MLB Stats API (confirmed: 145=CHW,116=DET,etc).
export async function bppFindGameId(date: string, awayTeamId: number, homeTeamId: number): Promise<number | null> {
  const games = await bppGetGames(date);
  const match = games.find(g => g.teamAwayId === awayTeamId && g.teamHomeId === homeTeamId);
  return match?.gameId ?? null;
}

// ── /matchups — BvP outcome probabilities for ALL probable matchups on a date ──
export interface BppMatchup {
  gameId: number; batterId: number; batterName: string; batterTeam: string;
  pitcherId: number; pitcherName: string; pitcherTeam: string;
  homeRunProbability: number; doubleTripleProbability: number; singleProbability: number;
  walkProbability: number; strikeoutProbability: number;
  runsCreatedVsTypical: number; homeRunVsTypical: number; doubleTripleVsTypical: number;
  singleVsTypical: number; walkVsTypical: number; strikeoutVsTypical: number;
}
let _matchupsByDateCache: Record<string, BppMatchup[]> = {};
export async function bppGetMatchupsForDate(date: string): Promise<BppMatchup[]> {
  const data = await bppGet("/matchups", { date }, TTL_MATCHUPS);
  const items = data?.items ?? [];
  _matchupsByDateCache[date] = items;
  return items;
}
export async function bppGetMatchup(date: string, batterId: number, pitcherId: number): Promise<BppMatchup | null> {
  let list = _matchupsByDateCache[date];
  if (!list) list = await bppGetMatchupsForDate(date);
  const hit = list.find(m => m.batterId === batterId && m.pitcherId === pitcherId);
  if (hit) return hit;
  // Fallback: on-demand any-pair prediction (rare — late lineup swap, call-up, etc.)
  const predicted = await bppGet("/matchups/predict", { batterId, pitcherId }, TTL_MATCHUPS);
  return predicted ?? null;
}

// ── /parkfactors — game-level combined park+weather factors ─────────────────
export interface BppParkFactor {
  gameId: number; gameTime: string; teamAway: string; teamHome: string;
  runsPercent: number; homeRunsPercent: number; doublesTriplesPercent: number; singlesPercent: number;
  runsAmount: number; homeRunsAmount: number; doublesTriplesAmount: number; singlesAmount: number;
}
export async function bppGetParkFactorsForDate(date: string): Promise<BppParkFactor[]> {
  const data = await bppGet("/parkfactors", { date }, TTL_PARKFACTOR);
  return data?.items ?? [];
}
export async function bppGetParkFactorForGame(date: string, gameId: number): Promise<BppParkFactor | null> {
  const list = await bppGetParkFactorsForDate(date);
  return list.find(p => p.gameId === gameId) ?? null;
}

// ── /parkfactors/hitters — per-hitter combined + stadium-only + weather-only ──
export interface BppHitterParkFactor {
  gameId: number; playerId: number; playerName: string; team: string;
  homeRuns: number; doublesTriples: number; singles: number;
  homeRunsStadium: number; doublesTriplesStadium: number; singlesStadium: number;
  homeRunsWeather: number; doublesTriplesWeather: number; singlesWeather: number;
}
export async function bppGetHitterParkFactors(gameId: number): Promise<BppHitterParkFactor[]> {
  const data = await bppGet("/parkfactors/hitters", { gameId }, TTL_PARKFACTOR);
  return data?.items ?? [];
}
export async function bppGetHitterParkFactor(gameId: number, playerId: number): Promise<BppHitterParkFactor | null> {
  const list = await bppGetHitterParkFactors(gameId);
  return list.find(p => p.playerId === playerId) ?? null;
}

// ── /projections/averages — simulated per-game stat projections ─────────────
export interface BppBatterAverage {
  playerId: number; playerName: string; teamId: number; team: string; battingPosition: number;
  plateAppearances: number; atBats: number; singles: number; doubles: number; triples: number;
  homeRuns: number; hits: number; totalBases: number; rbis: number; runs: number;
  walks: number; strikeouts: number; stolenBaseSuccesses: number;
  fantasyPointsDK: number; fantasyPointsFD: number;
}
export interface BppAveragesResponse {
  gameId: number; batters: BppBatterAverage[]; pitchers: any[]; teams: any[];
}
export async function bppGetAverages(gameId: number): Promise<BppAveragesResponse | null> {
  return await bppGet("/projections/averages", { gameId }, TTL_AVERAGES);
}
export async function bppGetBatterAverage(gameId: number, playerId: number): Promise<BppBatterAverage | null> {
  const data = await bppGetAverages(gameId);
  return data?.batters?.find((b: BppBatterAverage) => b.playerId === playerId) ?? null;
}

// ── /projections/probabilities — modeled market probabilities (ML, totals) ──
export interface BppProbabilityItem {
  marketType: string; marketKey: string; displayName: string; line: number | null;
  side: string; odds: number; probability: number; average: number | null;
  subject: { type: string; id: number }; teamId?: number;
}
export async function bppGetProbabilities(gameId: number): Promise<BppProbabilityItem[]> {
  const data = await bppGet("/projections/probabilities", { gameId }, TTL_PROBS);
  return data?.items ?? [];
}
// Convenience: BPP's modeled win probability for a specific team in a game.
export async function bppGetTeamWinProbability(gameId: number, teamId: number): Promise<number | null> {
  const items = await bppGetProbabilities(gameId);
  const ml = items.find(i => i.marketType === "team" && i.displayName === "Moneyline" && i.teamId === teamId && i.side === "over");
  return ml?.probability ?? null;
}
// Convenience: BPP's modeled total runs for a game (from the "average" field on the Total Runs market).
export async function bppGetTotalRunsProjection(gameId: number): Promise<number | null> {
  const items = await bppGetProbabilities(gameId);
  const totalsRow = items.find(i => i.marketType === "game" && i.displayName === "Total Runs" && i.average !== null);
  return totalsRow?.average ?? null;
}

// ── Normalized 0-1 scoring helpers for blending into existing engines ───────

// Converts BPP's hit-probability signal for a batter into a 0-1 score comparable
// to Clubhouse IQ's internal hit-probability components.
// hits/PA from averages endpoint ≈ per-game expected hits; typical range ~0.35-1.3.
export function bppBatterHitScore(avg: BppBatterAverage | null): number | null {
  if (!avg || avg.plateAppearances <= 0) return null;
  const hitRate = avg.hits / avg.plateAppearances; // expected hits per PA
  // Typical MLB hit rate per PA ~0.21 (.260ish AVG w/ BB mixed in); scale 0.12-0.34
  const norm = Math.max(0, Math.min(1, (hitRate - 0.12) / (0.34 - 0.12)));
  return norm;
}

// Converts a BPP matchup row into a 0-1 "batter-favorable" score using
// vs-typical deviations (positive = batter outperforming their normal rate
// against this specific pitcher; negative = suppressed).
export function bppMatchupScore(m: BppMatchup | null): number | null {
  if (!m) return null;
  // Weight: singles/doubles/HR upside minus strikeout upside, all vs-typical %.
  const positive = (m.singleVsTypical + m.doubleTripleVsTypical + m.homeRunVsTypical) / 3;
  const negative = m.strikeoutVsTypical;
  const net = positive - negative * 0.5; // typical range roughly -60 to +60
  const norm = Math.max(0, Math.min(1, 0.5 + net / 120));
  return norm;
}

// Converts a hitter's combined park factor (stadium × weather) into a 0-1 score.
// 1.00 = league average; >1 favors hitter, <1 suppresses.
export function bppParkFactorScore(pf: BppHitterParkFactor | null): number | null {
  if (!pf) return null;
  const combined = (pf.homeRuns + pf.doublesTriples + pf.singles) / 3;
  const norm = Math.max(0, Math.min(1, (combined - 0.75) / (1.30 - 0.75)));
  return norm;
}

export function bppCacheStats() {
  return { entries: _cache.size, outageActive: Date.now() < _bppOutageUntil, hasKey: !!bppKey() };
}
