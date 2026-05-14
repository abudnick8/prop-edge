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

// ESPN UID sport prefixes used to post-filter results by sport
// uid format: "s:{sportId}~l:{leagueId}~a:{athleteId}"
// sportIds: baseball=1, basketball=40, football=20, hockey=70 (approximate — we match on leagueId)
// leagueIds: mlb=10, nba=46, nfl=28, nhl=90
const ESPN_LEAGUE_ID_MAP: Record<Sport, string[]> = {
  MLB: ["10"],      // MLB league id in ESPN UID
  NBA: ["46"],      // NBA
  NFL: ["28"],      // NFL
  NHL: ["90"],      // NHL
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

// ─── Stat Config per Sport (mirrors fetchESPNGameLog in routes.ts) ──────────

interface SportStatCfg {
  sn: string;
  lg: string;
  seasons: number[];
  statMap: Record<string, string>;
}

function getStatCfg(sport: Sport): SportStatCfg {
  const currentYear = new Date().getFullYear();
  const cfgs: Record<Sport, SportStatCfg> = {
    NBA: {
      sn: "basketball", lg: "nba",
      seasons: [currentYear, currentYear - 1],
      statMap: { MIN: "mp", PTS: "pts", REB: "trb", AST: "ast", BLK: "blk", STL: "stl", TO: "tov", FG: "fg_made", "3PT": "fg3_made" },
    },
    NHL: {
      sn: "hockey", lg: "nhl",
      seasons: [currentYear, currentYear - 1],
      statMap: { G: "goals", A: "ast", PTS: "pts", S: "shots", "TOI/G": "toi", "+/-": "plusMinus" },
    },
    MLB: {
      sn: "baseball", lg: "mlb",
      seasons: [currentYear, currentYear - 1],
      statMap: {
        AB: "ab", H: "hits", "2B": "doubles", "3B": "triples", HR: "home_runs",
        RBI: "rbi", BB: "bb", SO: "strikeouts", AVG: "avg", OBP: "obp", SLG: "slg", R: "runs",
        IP: "ip", ER: "er", K: "strikeouts_p",
      },
    },
    NFL: {
      sn: "football", lg: "nfl",
      seasons: [currentYear - 1, currentYear - 2],
      statMap: { YDS: "yds", TD: "td", INT: "int", ATT: "att", REC: "rec", CAR: "car", LONG: "long" },
    },
  };
  return cfgs[sport];
}

// ─── Endpoint Implementations ─────────────────────────────────────────────

/**
 * GET /api/intel/search?q=<name>&sport=<MLB|NBA|NFL|NHL>
 * Searches ESPN for players by name and optional sport filter.
 * Post-filters results using the ESPN UID league ID to ensure sport accuracy.
 */
async function handleSearch(q: string, sport?: string): Promise<any[]> {
  const asciiQ = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Build sports to search
  const sportsToSearch: Sport[] = sport && sport.toUpperCase() !== "ALL"
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

      // Valid ESPN league IDs for this sport (for post-filtering)
      const validLeagueIds = ESPN_LEAGUE_ID_MAP[s];

      for (const item of allContents) {
        const uid: string = item.uid ?? "";
        const uidMatch = uid.match(/~a:(\d+)/);
        const espnId = uidMatch ? uidMatch[1] : String(item.id ?? "");
        if (!espnId || seenIds.has(espnId)) continue;

        // Post-filter: check if UID league segment matches expected league IDs
        // uid format: "s:{sportId}~l:{leagueId}~a:{athleteId}"
        const leagueMatch = uid.match(/~l:(\d+)~/);
        const uidLeagueId = leagueMatch ? leagueMatch[1] : null;
        if (uidLeagueId && validLeagueIds.length > 0) {
          // If we can parse the league id and it doesn't match, skip
          if (!validLeagueIds.includes(uidLeagueId)) {
            console.log(`${LOG_PREFIX} skipping ${item.displayName ?? ""} uid=${uid} (league ${uidLeagueId} not in ${validLeagueIds} for ${s})`);
            continue;
          }
        }

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
 * Uses proven ESPN v3 gamelog endpoint (same pattern as fetchESPNGameLog in routes.ts).
 */
async function handlePlayerProfile(sport: Sport, espnId: string): Promise<any> {
  const mapping = ESPN_SPORT_MAP[sport];
  if (!mapping) throw new Error(`Unsupported sport: ${sport}`);

  const cfg = getStatCfg(sport);

  // ── Step 1: Fetch player bio from ESPN athlete endpoint ──
  let name = "";
  let team: string | null = null;
  let position: string | null = null;
  let jerseyNumber: string | null = null;

  try {
    const athleteUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${mapping.sport}/${mapping.league}/athletes/${espnId}`;
    const athleteRes = await axios.get(athleteUrl, { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS });
    const ath = athleteRes.data?.athlete ?? athleteRes.data ?? {};
    name        = ath.displayName ?? ath.fullName ?? ath.name ?? "";
    team        = ath.team?.abbreviation ?? ath.teamAbbrev ?? null;
    position    = ath.position?.abbreviation ?? null;
    jerseyNumber = ath.jersey ?? null;
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} athlete bio fetch failed for ${espnId}:`, err.message);
    // Non-fatal — name will be empty, still return stats
  }

  // ── Step 2: Fetch gamelogs via proven v3 pattern ──────────────────────────
  // Same exact approach as fetchESPNGameLog in routes.ts
  const seenEventIds = new Set<string>();

  const parseV3Response = (v3Data: any): Array<{ entry: any; eventInfo: any; labels: string[] }> => {
    const labels: string[] = v3Data.labels ?? [];
    const eventsMap: Record<string, any> = v3Data.events ?? {};
    const entries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];
    for (const stype of (v3Data.seasonTypes ?? [])) {
      for (const cat of (stype.categories ?? [])) {
        for (const ev of (cat.events ?? [])) {
          const eid = String(ev.eventId ?? "");
          if (seenEventIds.has(eid)) continue;
          seenEventIds.add(eid);
          const evInfo = eventsMap[eid] ?? {};
          entries.push({ entry: ev, eventInfo: evInfo, labels });
        }
      }
    }
    return entries;
  };

  let allGameEntries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];

  try {
    const seasonFetches = await Promise.allSettled(
      cfg.seasons.map(yr =>
        axios.get(
          `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
          { timeout: 10000, headers: AXIOS_HEADERS }
        )
      )
    );

    for (const result of seasonFetches) {
      if (result.status === "fulfilled") {
        allGameEntries.push(...parseV3Response(result.value.data));
      }
    }

    // Sort chronologically oldest → newest
    allGameEntries.sort((a, b) => {
      const da = a.eventInfo.gameDate ?? "";
      const db = b.eventInfo.gameDate ?? "";
      return da.localeCompare(db);
    });
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} v3 gamelog fetch failed for ${sport} ${espnId}:`, err.message);
  }

  // ── Step 3: Build normalized game objects ──────────────────────────────────
  const allGames: any[] = [];

  for (const { entry, eventInfo, labels } of allGameEntries) {
    const stats = entry.stats ?? [];
    const statObj: Record<string, string> = {};
    labels.forEach((lbl, i) => { if (stats[i] != null) statObj[lbl] = String(stats[i]); });

    // Map sport-specific labels to standard keys
    const mapped: Record<string, string> = {};
    for (const [label, key] of Object.entries(cfg.statMap)) {
      if (statObj[label] != null) mapped[key] = statObj[label];
    }
    // Handle FG split "9-21"
    if (statObj["FG"]) {
      const fgParts = statObj["FG"].split("-");
      mapped["fg_made"] = fgParts[0] ?? "0";
      mapped["fg_att"]  = fgParts[1] ?? "0";
    }
    if (statObj["3PT"]) {
      const fgParts = statObj["3PT"].split("-");
      mapped["fg3_made"] = fgParts[0] ?? "0";
    }

    const opp      = eventInfo.opponent?.abbreviation ?? "?";
    const atVs     = eventInfo.atVs ?? "vs";
    const gameDate = eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "";
    const gameResult = eventInfo.gameResult ?? "";
    const score    = eventInfo.score ?? "";
    const eventNote = eventInfo.eventNote ?? eventInfo.shortName ?? "";

    // Also keep raw labels for the sport-specific columns
    const rawStats: Record<string, string> = { ...statObj };

    allGames.push({
      date_game:  gameDate,
      opp_id:     `${atVs === "@" ? "@" : "vs"}${opp}`,
      result:     gameResult ? `${gameResult} ${score}`.trim() : "",
      eventNote,
      source:     "espn_v3",
      ...mapped,
      raw:        rawStats,
    });
  }

  // ── Step 4: Derive game log (last 10 displayed to user) ───────────────────
  const gamelog = buildGamelog(allGames, sport, 10);

  // ── Step 5: Derive season stats (aggregate full season) ───────────────────
  const seasonStats = buildSeasonStats(allGames, sport);

  // ── Step 6: Derive home/away splits from game data ────────────────────────
  const splits = buildSplits(allGames);

  const headshot = espnHeadshot(mapping.headshotSport, espnId);

  return {
    espnId,
    name,
    sport,
    team,
    position,
    jerseyNumber,
    headshot,
    seasonStats,
    gamelog,
    splits,
    steamerProjection: null,
    statcastData: null,
  };
}

/** Build game log display (last N games for user display) */
function buildGamelog(allGames: any[], sport: Sport, limit: number): any[] {
  const recent = allGames.slice(-limit);
  return recent.map(g => {
    const base: Record<string, any> = {
      date:     g.date_game,
      opponent: g.opp_id,
      result:   g.result,
    };
    switch (sport) {
      case "MLB":
        Object.assign(base, {
          H:   g.hits ?? g.raw?.H ?? null,
          AB:  g.ab   ?? g.raw?.AB ?? null,
          HR:  g.home_runs ?? g.raw?.HR ?? null,
          RBI: g.rbi  ?? g.raw?.RBI ?? null,
          R:   g.runs ?? g.raw?.R ?? null,
          BB:  g.bb   ?? g.raw?.BB ?? null,
          SO:  g.strikeouts ?? g.raw?.SO ?? null,
          AVG: g.avg  ?? g.raw?.AVG ?? null,
          // Pitching
          IP:  g.ip   ?? g.raw?.IP ?? null,
          ER:  g.er   ?? g.raw?.ER ?? null,
          K:   g.strikeouts_p ?? g.raw?.K ?? null,
        });
        break;
      case "NBA":
        Object.assign(base, {
          PTS: g.pts ?? g.raw?.PTS ?? null,
          REB: g.trb ?? g.raw?.REB ?? null,
          AST: g.ast ?? g.raw?.AST ?? null,
          BLK: g.blk ?? g.raw?.BLK ?? null,
          STL: g.stl ?? g.raw?.STL ?? null,
          TO:  g.tov ?? g.raw?.TO  ?? null,
          MIN: g.mp  ?? g.raw?.MIN ?? null,
        });
        break;
      case "NHL":
        Object.assign(base, {
          G:    g.goals     ?? g.raw?.G   ?? null,
          A:    g.ast       ?? g.raw?.A   ?? null,
          PTS:  g.pts       ?? g.raw?.PTS ?? null,
          "+/-": g.plusMinus ?? g.raw?.["+/-"] ?? null,
          S:    g.shots     ?? g.raw?.S   ?? null,
        });
        break;
      case "NFL":
        Object.assign(base, {
          YDS: g.yds ?? g.raw?.YDS ?? null,
          TD:  g.td  ?? g.raw?.TD  ?? null,
          INT: g.int ?? g.raw?.INT ?? null,
          ATT: g.att ?? g.raw?.ATT ?? null,
          REC: g.rec ?? g.raw?.REC ?? null,
          CAR: g.car ?? g.raw?.CAR ?? null,
        });
        break;
    }
    return base;
  });
}

/** Build aggregate season stats from all game entries */
function buildSeasonStats(allGames: any[], sport: Sport): Record<string, any> {
  if (allGames.length === 0) return {};

  // Use the raw label map which has the exact stat names
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const rateKeys = new Set(["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "FG%", "3P%", "FT%"]);

  for (const g of allGames) {
    const raw = g.raw ?? {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === "date_game" || k === "opp_id" || k === "result") continue;
      // Skip composite stats like "9-21"
      if (String(v).includes("-") && String(v).split("-").length === 2) continue;
      const n = parseFloat(String(v));
      if (!isNaN(n)) {
        sums[k]   = (sums[k]   ?? 0) + n;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }

  const agg: Record<string, any> = { gamesPlayed: allGames.length };
  for (const k of Object.keys(sums)) {
    const isRate = rateKeys.has(k) || k.includes("%");
    agg[k] = isRate
      ? +(sums[k] / counts[k]).toFixed(3)
      : sums[k];
  }

  // Sport-specific picks
  switch (sport) {
    case "MLB":
      return pickFields(agg, ["gamesPlayed", "AB", "H", "HR", "RBI", "R", "BB", "SO", "AVG", "OBP", "SLG", "IP", "ER", "K", "2B", "3B", "SB"]);
    case "NBA":
      return pickFields(agg, ["gamesPlayed", "PTS", "REB", "AST", "BLK", "STL", "TO", "MIN", "FG%", "3P%", "FT%"]);
    case "NHL":
      return pickFields(agg, ["gamesPlayed", "G", "A", "PTS", "+/-", "S"]);
    case "NFL":
      return pickFields(agg, ["gamesPlayed", "YDS", "TD", "INT", "ATT", "REC", "CAR"]);
    default:
      return agg;
  }
}

function pickFields(obj: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  }
  return Object.keys(out).length > 0 ? out : obj;
}

/** Build home/away splits from game objects using opp_id prefix */
function buildSplits(allGames: any[]): Record<string, any> {
  const homeGames = allGames.filter(g => !String(g.opp_id ?? "").startsWith("@"));
  const awayGames = allGames.filter(g => String(g.opp_id ?? "").startsWith("@"));

  const aggregateRaw = (games: any[]): Record<string, any> => {
    if (games.length === 0) return {};
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};
    const rateKeys = new Set(["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "FG%", "3P%", "FT%"]);
    for (const g of games) {
      const raw = g.raw ?? {};
      for (const [k, v] of Object.entries(raw)) {
        if (String(v).includes("-") && String(v).split("-").length === 2) continue;
        const n = parseFloat(String(v));
        if (!isNaN(n)) {
          sums[k]   = (sums[k]   ?? 0) + n;
          counts[k] = (counts[k] ?? 0) + 1;
        }
      }
    }
    const agg: Record<string, any> = { gamesPlayed: games.length };
    for (const k of Object.keys(sums)) {
      const isRate = rateKeys.has(k) || k.includes("%");
      agg[k] = isRate ? +(sums[k] / counts[k]).toFixed(3) : sums[k];
    }
    return agg;
  };

  return {
    "Home/Away": {
      Home: aggregateRaw(homeGames),
      Away: aggregateRaw(awayGames),
    },
  };
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

      // Only cache if we got meaningful data (prevents caching cold-start empty results)
      const hasData = profile.name || profile.gamelog?.length > 0 || Object.keys(profile.seasonStats ?? {}).length > 0;
      if (hasData) setCache(profileCache, cacheKey, profile);
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

      const hitPct  = bvp.ab > 0 ? +(bvp.hits / bvp.ab).toFixed(3) : null;
      const hrPct   = bvp.ab > 0 ? +(bvp.hr   / bvp.ab).toFixed(3) : null;

      const enriched = {
        ...bvp,
        hitPct,
        hrPct,
        kPct: null,
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
    avg:         stat.avg         ?? null,
    obp:         stat.obp         ?? null,
    slg:         stat.slg         ?? null,
    ops:         stat.ops         ?? null,
    hr:          stat.homeRuns    ?? null,
    rbi:         stat.rbi         ?? null,
    hits:        stat.hits        ?? null,
    atBats:      stat.atBats      ?? null,
    walks:       stat.baseOnBalls ?? null,
    strikeOuts:  stat.strikeOuts  ?? null,
    doubles:     stat.doubles     ?? null,
    triples:     stat.triples     ?? null,
    runs:        stat.runs        ?? null,
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

/** Fetch non-MLB player vs team stats via ESPN v3 game log, filtered by opponent */
async function fetchESPNVsTeam(sport: Sport, playerId: string, teamAbbr: string): Promise<any> {
  const cfg = getStatCfg(sport);
  const seenEventIds = new Set<string>();

  const parseV3Response = (v3Data: any): Array<{ entry: any; eventInfo: any; labels: string[] }> => {
    const labels: string[] = v3Data.labels ?? [];
    const eventsMap: Record<string, any> = v3Data.events ?? {};
    const entries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];
    for (const stype of (v3Data.seasonTypes ?? [])) {
      for (const cat of (stype.categories ?? [])) {
        for (const ev of (cat.events ?? [])) {
          const eid = String(ev.eventId ?? "");
          if (seenEventIds.has(eid)) continue;
          seenEventIds.add(eid);
          const evInfo = eventsMap[eid] ?? {};
          entries.push({ entry: ev, eventInfo: evInfo, labels });
        }
      }
    }
    return entries;
  };

  let allEntries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];

  try {
    const fetches = await Promise.allSettled(
      cfg.seasons.map(yr =>
        axios.get(
          `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${playerId}/gamelog?season=${yr}`,
          { timeout: 10000, headers: AXIOS_HEADERS }
        )
      )
    );
    for (const r of fetches) {
      if (r.status === "fulfilled") allEntries.push(...parseV3Response(r.value.data));
    }
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} v3 gamelog fetch failed for ${sport}:`, err.message);
  }

  // Filter by opponent abbreviation
  const vsEntries = allEntries.filter(({ eventInfo }) => {
    const opp = (eventInfo.opponent?.abbreviation ?? "").toUpperCase();
    return opp === teamAbbr;
  });

  // Build game list
  const games: any[] = vsEntries.map(({ entry, eventInfo, labels }) => {
    const stats = entry.stats ?? [];
    const statObj: Record<string, string> = {};
    labels.forEach((lbl, i) => { if (stats[i] != null) statObj[lbl] = String(stats[i]); });
    return {
      date:     eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "",
      opponent: teamAbbr,
      result:   eventInfo.gameResult ?? "",
      ...statObj,
    };
  });

  games.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return {
    seasonStats: aggregateGameStats(games),
    careerStats: {},
    recentGames: games.slice(-5),
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
      if (String(v).includes("-") && String(v).split("-").length === 2) continue;
      const n = parseFloat(String(v));
      if (!isNaN(n)) {
        sums[k]   = (sums[k]   ?? 0) + n;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }

  const agg: Record<string, any> = { gamesPlayed: games.length };
  for (const k of Object.keys(sums)) {
    const isRate = k.includes("%") || k === "AVG" || k === "OBP" || k === "SLG" || k === "OPS"
      || k === "FG%" || k === "3P%" || k === "FT%" || k === "ERA" || k === "WHIP";
    agg[k] = isRate
      ? +(sums[k] / counts[k]).toFixed(3)
      : sums[k];
  }
  return agg;
}
