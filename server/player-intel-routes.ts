/**
 * Player Intel API Routes
 * Provides search, profile, BvP, park splits, and vs-team endpoints
 * for MLB, NBA, NFL, and NHL.
 */

import axios from "axios";
import { Express } from "express";
import { getBvpExtended, getParkFactor, BvpResult } from "./mlb-analytics";

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_HOUR_MS  = 60 * 60 * 1000;
const ONE_DAY_MS   = 24 * ONE_HOUR_MS;
const LOG_PREFIX   = "[PlayerIntel]";

// ─── Cache ────────────────────────────────────────────────────────────────────

const searchCache:    Map<string, { data: any; ts: number }> = new Map();
const profileCache:   Map<string, { data: any; ts: number }> = new Map();
const bvpCache:       Map<string, { data: any; ts: number }> = new Map();
const parkCache:      Map<string, { data: any; ts: number }> = new Map();
const vsTeamCache:    Map<string, { data: any; ts: number }> = new Map();

function getCache(cache: Map<string, { data: any; ts: number }>, key: string, ttl: number): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

function setCache(cache: Map<string, { data: any; ts: number }>, key: string, data: any): void {
  cache.set(key, { data, ts: Date.now() });
}

// ─── Sport Mapping Helpers ─────────────────────────────────────────────────

type Sport = "MLB" | "NBA" | "NFL" | "NHL";

const ESPN_SPORT_MAP: Record<Sport, { sport: string; league: string; headshotSport: string }> = {
  MLB: { sport: "baseball",   league: "mlb", headshotSport: "mlb" },
  NBA: { sport: "basketball", league: "nba", headshotSport: "nba" },
  NFL: { sport: "football",   league: "nfl", headshotSport: "nfl" },
  NHL: { sport: "hockey",     league: "nhl", headshotSport: "nhl" },
};

function espnHeadshot(headshotSport: string, espnId: string): string {
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/${headshotSport}/players/full/${espnId}.png&w=96&h=70&scale=crop`;
}

const AXIOS_HEADERS = { "User-Agent": "Mozilla/5.0" };
const AXIOS_TIMEOUT = 8000;

// ─── MLB Team Abbreviation → Team ID Map ──────────────────────────────────

const MLB_TEAM_IDS: Record<string, number> = {
  ARI: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CWS: 145, CIN: 113,
  CLE: 114, COL: 115, DET: 116, HOU: 117, KC:  118, LAA: 108, LAD: 119,
  MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, OAK: 133, PHI: 143,
  PIT: 134, SD:  135, SEA: 136, SF:  137, STL: 138, TB:  139, TEX: 140,
  TOR: 141, WSH: 120,
};

// ─── Endpoint Implementations ─────────────────────────────────────────────

/**
 * GET /api/intel/search?q=<name>&sport=<MLB|NBA|NFL|NHL>
 * Searches ESPN for players by name and optional sport filter.
 */
async function handleSearch(q: string, sport?: string): Promise<any[]> {
  const asciiQ = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Build sports to search
  const sportsToSearch: Sport[] = sport
    ? [sport.toUpperCase() as Sport]
    : ["MLB", "NBA", "NFL", "NHL"];

  const results: any[] = [];
  const seenIds = new Set<string>();

  for (const s of sportsToSearch) {
    const mapping = ESPN_SPORT_MAP[s];
    if (!mapping) continue;
    try {
      const url = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiQ)}&limit=8&type=player&sport=${mapping.sport}%2F${mapping.league}`;
      const r = await axios.get(url, { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS });

      const allContents: any[] = [];
      for (const rg of (r.data?.results ?? [])) {
        for (const c of (rg.contents ?? [])) allContents.push(c);
      }

      for (const item of allContents) {
        const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
        const espnId = uidMatch ? uidMatch[1] : String(item.id ?? "");
        if (!espnId || seenIds.has(espnId)) continue;
        seenIds.add(espnId);

        results.push({
          espnId,
          name:     item.displayName ?? item.name ?? "",
          sport:    s,
          team:     item.team?.abbreviation ?? item.teamName ?? null,
          position: item.position?.abbreviation ?? item.positionText ?? null,
          headshot: espnHeadshot(mapping.headshotSport, espnId),
        });
      }
    } catch (err: any) {
      console.warn(`${LOG_PREFIX} search failed for sport ${s}:`, err.message);
    }
  }

  return results;
}

/**
 * GET /api/intel/player/:sport/:espnId
 * Returns full player profile, season stats, game log, and splits.
 */
async function handlePlayerProfile(sport: Sport, espnId: string): Promise<any> {
  const mapping = ESPN_SPORT_MAP[sport];
  if (!mapping) throw new Error(`Unsupported sport: ${sport}`);

  // Fetch ESPN overview for base info + season stats
  const overviewUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${mapping.sport}/${mapping.league}/athletes/${espnId}/overview`;
  const gamelogUrl  = `https://site.web.api.espn.com/apis/common/v3/sports/${mapping.sport}/${mapping.league}/athletes/${espnId}/gamelog?season=2026`;

  const [overviewRes, gamelogRes] = await Promise.allSettled([
    axios.get(overviewUrl,  { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }),
    axios.get(gamelogUrl,   { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }),
  ]);

  const overviewData = overviewRes.status === "fulfilled" ? overviewRes.value.data : null;
  const gamelogData  = gamelogRes.status  === "fulfilled" ? gamelogRes.value.data  : null;

  // Extract athlete base info
  const athlete = overviewData?.athlete ?? overviewData?.player ?? {};
  const name     = athlete.displayName ?? athlete.fullName ?? "";
  const team     = athlete.team?.abbreviation ?? athlete.teamAbbrev ?? null;
  const position = athlete.position?.abbreviation ?? null;
  const headshot = espnHeadshot(mapping.headshotSport, espnId);

  // Extract season stats
  const seasonStats = extractSeasonStats(overviewData, sport);

  // Extract last 10 games from gamelog
  const gamelog = extractGamelog(gamelogData, sport, 10);

  // Extract splits
  const splits = extractSplits(overviewData, sport);

  return {
    espnId,
    name,
    sport,
    team,
    position,
    headshot,
    seasonStats,
    gamelog,
    splits,
    steamerProjection: null, // Populated separately via mlb-analytics if MLB
    statcastData:      null,
  };
}

/** Pull sport-specific season stats from ESPN overview payload */
function extractSeasonStats(overviewData: any, sport: Sport): Record<string, any> {
  const stats: Record<string, any> = {};
  if (!overviewData) return stats;

  // ESPN overview nests stats in different places depending on sport
  const statsArray: any[] =
    overviewData?.stats?.splits?.categories ??
    overviewData?.statistics?.splits?.categories ??
    overviewData?.seasonStats ??
    [];

  const statMap: Record<string, any> = {};
  for (const cat of statsArray) {
    for (const stat of (cat.stats ?? [])) {
      statMap[stat.abbreviation ?? stat.name] = stat.displayValue ?? stat.value;
    }
  }

  switch (sport) {
    case "MLB":
      return pickStats(statMap, ["AVG", "OBP", "SLG", "OPS", "HR", "RBI", "R", "SB", "H", "AB", "BB", "SO"]);
    case "NBA":
      return pickStats(statMap, ["PTS", "REB", "AST", "BLK", "STL", "FG%", "3P%", "FT%", "MIN"]);
    case "NHL":
      return pickStats(statMap, ["G", "A", "PTS", "+/-", "PIM", "S", "TOI"]);
    case "NFL":
      // Return full map; consumer can filter by position
      return pickStats(statMap, [
        "ATT", "CMP", "YDS", "TD", "INT",          // QB
        "CAR", "YDS", "TD", "REC", "RECYDS",       // RB
        "REC", "YDS", "TD",                         // WR/TE
        "SKS", "TKL",                               // DEF
      ]);
    default:
      return statMap;
  }
}

function pickStats(map: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (map[k] !== undefined) out[k] = map[k];
  }
  // Also include anything that was found
  return Object.keys(out).length > 0 ? out : map;
}

/** Extract last N game entries from ESPN gamelog payload */
function extractGamelog(gamelogData: any, sport: Sport, limit: number): any[] {
  if (!gamelogData) return [];

  // ESPN gamelog shape: events[] or gameLog.events[]
  const events: any[] =
    gamelogData?.gameLog?.events ?? gamelogData?.events ?? [];

  const games: any[] = [];
  for (const ev of events) {
    if (games.length >= limit) break;
    const game: Record<string, any> = {
      date:     ev.gameDate ?? ev.date ?? null,
      opponent: ev.opponent?.abbreviation ?? ev.opponent ?? null,
      result:   ev.result ?? null,
    };
    // Flatten stats for this game
    for (const cat of (ev.stats?.categories ?? ev.categories ?? [])) {
      for (const s of (cat.stats ?? [])) {
        game[s.abbreviation ?? s.name] = s.displayValue ?? s.value;
      }
    }
    games.push(game);
  }
  return games;
}

/** Extract home/away or other splits from ESPN overview */
function extractSplits(overviewData: any, _sport: Sport): Record<string, any> {
  const splitData: Record<string, any> = {};
  if (!overviewData) return splitData;

  const splitGroups: any[] =
    overviewData?.stats?.splits?.splitCategories ??
    overviewData?.statistics?.splits?.splitCategories ??
    [];

  for (const sg of splitGroups) {
    const label = sg.displayName ?? sg.name ?? "misc";
    splitData[label] = {};
    for (const sp of (sg.splits ?? [])) {
      const splitName = sp.displayName ?? sp.abbreviation ?? "unknown";
      const vals: Record<string, any> = {};
      for (const cat of (sp.categories ?? [])) {
        for (const s of (cat.stats ?? [])) {
          vals[s.abbreviation ?? s.name] = s.displayValue ?? s.value;
        }
      }
      splitData[label][splitName] = vals;
    }
  }
  return splitData;
}

// ─── Route Registration ────────────────────────────────────────────────────

export function registerPlayerIntelRoutes(app: Express): void {
  console.log(`${LOG_PREFIX} Registering Player Intel routes`);

  // ── 1. Search ────────────────────────────────────────────────────────────
  app.get("/api/intel/search", async (req, res) => {
    try {
      const { q, sport } = req.query as { q?: string; sport?: string };
      if (!q || q.trim() === "") {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const cacheKey = `search:${q.toLowerCase()}:${(sport ?? "all").toLowerCase()}`;
      const cached = getCache(searchCache, cacheKey, ONE_HOUR_MS);
      if (cached) {
        console.log(`${LOG_PREFIX} search cache hit: ${cacheKey}`);
        return res.json(cached);
      }

      console.log(`${LOG_PREFIX} search: q="${q}" sport="${sport ?? "all"}"`);
      const results = await handleSearch(q.trim(), sport);

      setCache(searchCache, cacheKey, results);
      return res.json(results);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} search error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 2. Player Profile ────────────────────────────────────────────────────
  app.get("/api/intel/player/:sport/:espnId", async (req, res) => {
    try {
      const { sport, espnId } = req.params;
      const sportUp = sport.toUpperCase() as Sport;

      if (!ESPN_SPORT_MAP[sportUp]) {
        return res.status(400).json({ error: `Unsupported sport: ${sport}. Use MLB, NBA, NFL, or NHL.` });
      }

      const cacheKey = `profile:${sportUp}:${espnId}`;
      const cached = getCache(profileCache, cacheKey, ONE_HOUR_MS);
      if (cached) {
        console.log(`${LOG_PREFIX} profile cache hit: ${cacheKey}`);
        return res.json(cached);
      }

      console.log(`${LOG_PREFIX} fetching profile for ${sportUp} espnId=${espnId}`);
      const profile = await handlePlayerProfile(sportUp, espnId);

      setCache(profileCache, cacheKey, profile);
      return res.json(profile);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} player profile error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 3. BvP (MLB only) ────────────────────────────────────────────────────
  app.get("/api/intel/bvp/:batterId/:pitcherId", async (req, res) => {
    try {
      const batterId  = parseInt(req.params.batterId,  10);
      const pitcherId = parseInt(req.params.pitcherId, 10);

      if (isNaN(batterId) || isNaN(pitcherId)) {
        return res.status(400).json({ error: "batterId and pitcherId must be numeric MLBAM IDs" });
      }

      const cacheKey = `bvp:${batterId}:${pitcherId}`;
      const cached = getCache(bvpCache, cacheKey, ONE_HOUR_MS);
      if (cached) {
        console.log(`${LOG_PREFIX} bvp cache hit: ${cacheKey}`);
        return res.json(cached);
      }

      console.log(`${LOG_PREFIX} fetching BvP batter=${batterId} pitcher=${pitcherId}`);
      const bvp: BvpResult = await getBvpExtended(batterId, pitcherId);

      // Enrich with derived rates
      const hitPct  = bvp.ab > 0 ? +(bvp.hits / bvp.ab).toFixed(3) : null;
      const hrPct   = bvp.ab > 0 ? +(bvp.hr   / bvp.ab).toFixed(3) : null;

      // k% requires strikeout data — not in BvpResult, so omit for now
      const enriched = {
        ...bvp,
        hitPct,
        hrPct,
        kPct: null, // strikeout data not available in BvpResult
      };

      setCache(bvpCache, cacheKey, enriched);
      return res.json(enriched);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} bvp error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 4. Park Splits (MLB only) ─────────────────────────────────────────────
  app.get("/api/intel/park-splits/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const playerIdNum = parseInt(playerId, 10);

      if (isNaN(playerIdNum)) {
        return res.status(400).json({ error: "playerId must be a numeric MLBAM ID" });
      }

      const cacheKey = `park-splits:${playerId}`;
      const cached = getCache(parkCache, cacheKey, ONE_DAY_MS);
      if (cached) {
        console.log(`${LOG_PREFIX} park-splits cache hit: ${cacheKey}`);
        return res.json(cached);
      }

      console.log(`${LOG_PREFIX} fetching park splits for playerId=${playerId}`);

      // Fetch home/away splits
      const [haRes, venueRes] = await Promise.allSettled([
        axios.get(
          `https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=h,a`,
          { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
        ),
        axios.get(
          `https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=venue`,
          { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
        ),
      ]);

      // Parse home/away
      let home: any = {};
      let away: any = {};
      if (haRes.status === "fulfilled") {
        const splits: any[] = haRes.value.data?.stats?.[0]?.splits ?? [];
        for (const sp of splits) {
          const code = sp.split?.code ?? sp.split?.description ?? "";
          if (code === "h" || (sp.split?.description ?? "").toLowerCase().includes("home")) {
            home = flattenMLBStats(sp.stat);
          } else if (code === "a" || (sp.split?.description ?? "").toLowerCase().includes("away")) {
            away = flattenMLBStats(sp.stat);
          }
        }
      }

      // Parse venue splits, enrich with park factor
      const venueResults: any[] = [];
      if (venueRes.status === "fulfilled") {
        const venueSplits: any[] = venueRes.value.data?.stats?.[0]?.splits ?? [];
        for (const sp of venueSplits) {
          const venueName = sp.split?.description ?? sp.venue?.name ?? "Unknown";
          let parkFactor: any = null;
          try {
            parkFactor = await getParkFactor(venueName);
          } catch {
            // park factor unavailable for this venue
          }
          venueResults.push({
            venue: venueName,
            ...flattenMLBStats(sp.stat),
            parkFactor: parkFactor ?? null,
          });
        }
      }

      const result = { home, away, venues: venueResults };
      setCache(parkCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} park-splits error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 5. Vs-Team ───────────────────────────────────────────────────────────
  app.get("/api/intel/vs-team/:sport/:playerId/:teamAbbr", async (req, res) => {
    try {
      const { sport, playerId, teamAbbr } = req.params;
      const sportUp = sport.toUpperCase() as Sport;

      if (!ESPN_SPORT_MAP[sportUp]) {
        return res.status(400).json({ error: `Unsupported sport: ${sport}. Use MLB, NBA, NFL, or NHL.` });
      }

      const cacheKey = `vs-team:${sportUp}:${playerId}:${teamAbbr.toUpperCase()}`;
      const cached = getCache(vsTeamCache, cacheKey, ONE_HOUR_MS);
      if (cached) {
        console.log(`${LOG_PREFIX} vs-team cache hit: ${cacheKey}`);
        return res.json(cached);
      }

      console.log(`${LOG_PREFIX} fetching vs-team ${sportUp} player=${playerId} vs ${teamAbbr}`);

      let result: any;

      if (sportUp === "MLB") {
        result = await fetchMLBVsTeam(playerId, teamAbbr.toUpperCase());
      } else {
        result = await fetchESPNVsTeam(sportUp, playerId, teamAbbr.toUpperCase());
      }

      setCache(vsTeamCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} vs-team error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  console.log(`${LOG_PREFIX} Player Intel routes registered`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Flatten MLB Stats API stat object to a plain key-value map */
function flattenMLBStats(stat: any): Record<string, any> {
  if (!stat) return {};
  return {
    avg:       stat.avg       ?? null,
    obp:       stat.obp       ?? null,
    slg:       stat.slg       ?? null,
    ops:       stat.ops       ?? null,
    hr:        stat.homeRuns  ?? null,
    rbi:       stat.rbi       ?? null,
    hits:      stat.hits      ?? null,
    atBats:    stat.atBats    ?? null,
    walks:     stat.baseOnBalls ?? null,
    strikeOuts:stat.strikeOuts ?? null,
    doubles:   stat.doubles   ?? null,
    triples:   stat.triples   ?? null,
    runs:      stat.runs      ?? null,
    stolenBases: stat.stolenBases ?? null,
    gamesPlayed: stat.gamesPlayed ?? null,
  };
}

/** Fetch MLB batter vs team stats (season + career) from Stats API */
async function fetchMLBVsTeam(playerId: string, teamAbbr: string): Promise<any> {
  const teamId = MLB_TEAM_IDS[teamAbbr];
  if (!teamId) {
    throw new Error(`Unknown MLB team abbreviation: ${teamAbbr}. Valid: ${Object.keys(MLB_TEAM_IDS).join(", ")}`);
  }

  const playerIdNum = parseInt(playerId, 10);
  if (isNaN(playerIdNum)) throw new Error("playerId must be a numeric MLBAM ID for MLB");

  const [seasonRes, careerRes] = await Promise.allSettled([
    axios.get(
      `https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=vsTeam&group=hitting&season=2026&opposingTeamId=${teamId}`,
      { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
    ),
    axios.get(
      `https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=vsTeamTotal&group=hitting&opposingTeamId=${teamId}`,
      { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
    ),
  ]);

  const seasonStats = seasonRes.status === "fulfilled"
    ? flattenMLBStats(seasonRes.value.data?.stats?.[0]?.splits?.[0]?.stat)
    : {};

  const careerStats = careerRes.status === "fulfilled"
    ? flattenMLBStats(careerRes.value.data?.stats?.[0]?.splits?.[0]?.stat)
    : {};

  // Recent games vs this team: pull from vsTeam splits array (up to 5)
  const recentGames: any[] = [];
  if (seasonRes.status === "fulfilled") {
    const splits: any[] = seasonRes.value.data?.stats?.[0]?.splits ?? [];
    for (const sp of splits.slice(0, 5)) {
      recentGames.push({
        date:  sp.date ?? null,
        team:  teamAbbr,
        stats: flattenMLBStats(sp.stat),
      });
    }
  }

  return { seasonStats, careerStats, recentGames };
}

/** Fetch non-MLB player vs team stats via ESPN game log, filtered by opponent */
async function fetchESPNVsTeam(sport: Sport, playerId: string, teamAbbr: string): Promise<any> {
  const mapping = ESPN_SPORT_MAP[sport];

  // Pull a broader game log (up to 82 for NBA, 17 for NFL, 82 for NHL)
  let gamelogData: any = null;
  try {
    const url = `https://site.web.api.espn.com/apis/common/v3/sports/${mapping.sport}/${mapping.league}/athletes/${playerId}/gamelog?season=2026`;
    const r = await axios.get(url, { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS });
    gamelogData = r.data;
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} ESPN gamelog fetch failed for ${sport}:`, err.message);
  }

  const events: any[] = gamelogData?.gameLog?.events ?? gamelogData?.events ?? [];
  const vsGames: any[] = [];

  for (const ev of events) {
    const oppAbbr = (ev.opponent?.abbreviation ?? ev.opponent ?? "").toUpperCase();
    if (oppAbbr !== teamAbbr) continue;

    const game: Record<string, any> = {
      date:     ev.gameDate ?? ev.date ?? null,
      opponent: oppAbbr,
      result:   ev.result ?? null,
    };
    for (const cat of (ev.stats?.categories ?? ev.categories ?? [])) {
      for (const s of (cat.stats ?? [])) {
        game[s.abbreviation ?? s.name] = s.displayValue ?? s.value;
      }
    }
    vsGames.push(game);
  }

  // Aggregate season stats vs this team from the filtered games
  const recentGames = vsGames.slice(-5);

  return {
    seasonStats: aggregateGameStats(vsGames),
    careerStats: {}, // Historical multi-season career data not available via ESPN gamelog
    recentGames,
  };
}

/** Aggregate numeric stats across an array of game objects */
function aggregateGameStats(games: any[]): Record<string, any> {
  if (games.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const g of games) {
    for (const [k, v] of Object.entries(g)) {
      if (k === "date" || k === "opponent" || k === "result") continue;
      const n = parseFloat(String(v));
      if (!isNaN(n)) {
        sums[k]   = (sums[k]   ?? 0) + n;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }

  const agg: Record<string, any> = { gamesPlayed: games.length };
  for (const k of Object.keys(sums)) {
    // Ratios (percentages) → average; counting stats → sum
    const isRate = k.includes("%") || k === "AVG" || k === "OBP" || k === "SLG" || k === "OPS"
      || k === "FG%" || k === "3P%" || k === "FT%" || k === "ERA" || k === "WHIP";
    agg[k] = isRate
      ? +(sums[k] / counts[k]).toFixed(3)
      : sums[k];
  }
  return agg;
}
