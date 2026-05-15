/**
 * Player Intel API Routes
 * Provides search, profile, BvP, park splits, and vs-team endpoints
 * for MLB, NBA, NFL, and NHL.
 *
 * Response shapes are normalized to match exactly what PlayerIntel.tsx expects.
 */

import axios from "axios";
import { Express } from "express";
import { getBvpExtended, getParkFactor, resolveMlbamId, BvpResult } from "./mlb-analytics";

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_HOUR_MS  = 60 * 60 * 1000;
const ONE_DAY_MS   = 24 * ONE_HOUR_MS;
const LOG_PREFIX   = "[PlayerIntel]";

// ─── Cache ────────────────────────────────────────────────────────────────────

const searchCache:  Map<string, { data: any; ts: number }> = new Map();
const profileCache: Map<string, { data: any; ts: number }> = new Map();
const bvpCache:     Map<string, { data: any; ts: number }> = new Map();
const parkCache:    Map<string, { data: any; ts: number }> = new Map();
const vsTeamCache:  Map<string, { data: any; ts: number }> = new Map();

function getCache(cache: Map<string, { data: any; ts: number }>, key: string, ttl: number): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

function setCache(cache: Map<string, { data: any; ts: number }>, key: string, data: any): void {
  cache.set(key, { data, ts: Date.now() });
}

// ─── Sport Mapping ─────────────────────────────────────────────────────────

type Sport = "MLB" | "NBA" | "NFL" | "NHL";

const ESPN_SPORT_MAP: Record<Sport, { sport: string; league: string; headshotSport: string }> = {
  MLB: { sport: "baseball",   league: "mlb", headshotSport: "mlb" },
  NBA: { sport: "basketball", league: "nba", headshotSport: "nba" },
  NFL: { sport: "football",   league: "nfl", headshotSport: "nfl" },
  NHL: { sport: "hockey",     league: "nhl", headshotSport: "nhl" },
};

// ESPN UID league IDs for post-filtering
const ESPN_LEAGUE_ID_MAP: Record<Sport, string[]> = {
  MLB: ["10"],
  NBA: ["46"],
  NFL: ["28"],
  NHL: ["90"],
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

// ─── Stat Config per Sport ─────────────────────────────────────────────────

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
      statMap: { MIN: "MIN", PTS: "PTS", REB: "REB", AST: "AST", BLK: "BLK", STL: "STL", TO: "TO", FG: "FG", "3PT": "3PT" },
    },
    NHL: {
      sn: "hockey", lg: "nhl",
      seasons: [currentYear, currentYear - 1],
      statMap: { G: "G", A: "A", PTS: "PTS", S: "S", "TOI/G": "TOI", "+/-": "+/-" },
    },
    MLB: {
      sn: "baseball", lg: "mlb",
      seasons: [currentYear, currentYear - 1],
      statMap: {
        AB: "AB", H: "H", "2B": "2B", "3B": "3B", HR: "HR",
        RBI: "RBI", BB: "BB", SO: "SO", AVG: "AVG", OBP: "OBP", SLG: "SLG", R: "R",
        IP: "IP", ER: "ER", K: "K",
      },
    },
    NFL: {
      sn: "football", lg: "nfl",
      seasons: [currentYear - 1, currentYear - 2],
      statMap: { YDS: "YDS", TD: "TD", INT: "INT", ATT: "ATT", REC: "REC", CAR: "CAR", LONG: "LONG", CMP: "CMP" },
    },
  };
  return cfgs[sport];
}

// ─── Endpoint Implementations ─────────────────────────────────────────────

/**
 * Search ESPN for players. Post-filters by UID league ID so sport tabs are strict.
 */
async function handleSearch(q: string, sport?: string): Promise<any[]> {
  const asciiQ = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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

      const validLeagueIds = ESPN_LEAGUE_ID_MAP[s];

      for (const item of allContents) {
        const uid: string = item.uid ?? "";
        const uidMatch = uid.match(/~a:(\d+)/);
        const espnId = uidMatch ? uidMatch[1] : String(item.id ?? "");
        if (!espnId || seenIds.has(espnId)) continue;

        // Post-filter by league ID in UID
        const leagueMatch = uid.match(/~l:(\d+)~/);
        const uidLeagueId = leagueMatch ? leagueMatch[1] : null;
        if (uidLeagueId && validLeagueIds.length > 0 && !validLeagueIds.includes(uidLeagueId)) {
          continue;
        }

        seenIds.add(espnId);
        results.push({
          espnId,
          name:     item.displayName ?? item.name ?? "",
          sport:    s,
          team:     item.team?.abbreviation ?? item.teamName ?? null,
          teamAbbr: item.team?.abbreviation ?? item.teamName ?? null,
          position: item.position?.abbreviation ?? item.positionText ?? null,
          headshot: espnHeadshot(mapping.headshotSport, espnId),
          headshotUrl: espnHeadshot(mapping.headshotSport, espnId),
        });
      }
    } catch (err: any) {
      console.warn(`${LOG_PREFIX} search failed for sport ${s}:`, err.message);
    }
  }

  return results;
}

/**
 * Fetch player profile using proven ESPN v3 gamelog pattern.
 * Response is normalized to match the PlayerData interface in PlayerIntel.tsx:
 *   - season: Record<string, any>   (season stats)
 *   - gamelog: GameLogEntry[]       (last 10 games, with opp/date fields)
 *   - splits: { home, away }
 *   - mlbamId: string | null        (MLB only — for BvP endpoint)
 *   - avg30, avg14                  (MLB only — batting average windows)
 */
async function handlePlayerProfile(sport: Sport, espnId: string): Promise<any> {
  const mapping = ESPN_SPORT_MAP[sport];
  if (!mapping) throw new Error(`Unsupported sport: ${sport}`);

  const cfg = getStatCfg(sport);

  // ── Step 1: Fetch player bio ──────────────────────────────────────────────
  let name = "";
  let team: string | null = null;
  let position: string | null = null;
  let jerseyNumber: string | null = null;
  let headshot = espnHeadshot(mapping.headshotSport, espnId);

  try {
    const athleteUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${mapping.sport}/${mapping.league}/athletes/${espnId}`;
    const athleteRes = await axios.get(athleteUrl, { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS });
    const ath = athleteRes.data?.athlete ?? athleteRes.data ?? {};
    name         = ath.displayName ?? ath.fullName ?? ath.name ?? "";
    team         = ath.team?.abbreviation ?? null;
    position     = ath.position?.abbreviation ?? null;
    jerseyNumber = ath.jersey ?? null;
    // Prefer ESPN CDN headshot from athlete object if available
    const hsHref = ath.headshot?.href ?? ath.headshot ?? null;
    if (hsHref) headshot = hsHref;
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} athlete bio failed for ${espnId}:`, err.message);
  }

  // ── Step 2: Fetch v3 gamelogs for current + prior season ─────────────────
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
          entries.push({ entry: ev, eventInfo: eventsMap[eid] ?? {}, labels });
        }
      }
    }
    return entries;
  };

  let allGameEntries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];

  try {
    const fetches = await Promise.allSettled(
      cfg.seasons.map(yr =>
        axios.get(
          `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
          { timeout: 10000, headers: AXIOS_HEADERS }
        )
      )
    );
    for (const r of fetches) {
      if (r.status === "fulfilled") allGameEntries.push(...parseV3Response(r.value.data));
    }
    // Sort chronologically oldest → newest
    allGameEntries.sort((a, b) => (a.eventInfo.gameDate ?? "").localeCompare(b.eventInfo.gameDate ?? ""));
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} v3 gamelog failed for ${sport} ${espnId}:`, err.message);
  }

  // ── Step 3: Build normalized game objects ──────────────────────────────────
  const allGames: any[] = allGameEntries.map(({ entry, eventInfo, labels }) => {
    const stats = entry.stats ?? [];
    const raw: Record<string, string> = {};
    labels.forEach((lbl, i) => { if (stats[i] != null) raw[lbl] = String(stats[i]); });

    // Handle FG "made-att" splits for NBA
    if (raw["FG"]) {
      const [m, a] = raw["FG"].split("-");
      raw["FGM"] = m ?? "0"; raw["FGA"] = a ?? "0";
    }
    if (raw["3PT"]) {
      const [m] = raw["3PT"].split("-");
      raw["3PTM"] = m ?? "0";
    }

    const opp      = eventInfo.opponent?.abbreviation ?? "?";
    const atVs     = eventInfo.atVs ?? "vs";
    const gameDate = eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "";
    const gameResult = eventInfo.gameResult ?? "";
    const score    = eventInfo.score ?? "";

    return {
      // Client-compatible keys
      date_game: gameDate,
      opp:       atVs === "@" ? `@${opp}` : `vs ${opp}`,  // "opp" is what the client uses
      result:    gameResult ? `${gameResult} ${score}`.trim() : "",
      // All raw stat labels
      ...raw,
    };
  });

  // ── Step 4: Build season stats (aggregate) ────────────────────────────────
  // Only aggregate current season (most recent year in cfg.seasons)
  const currentSeasonGames = allGames.filter(g => {
    const yr = (g.date_game ?? "").slice(0, 4);
    return yr === String(cfg.seasons[0]);
  });
  const season = buildSeasonStats(currentSeasonGames.length > 0 ? currentSeasonGames : allGames, sport);

  // ── Step 5: Last 10 gamelog ───────────────────────────────────────────────
  const gamelog = allGames.slice(-10);

  // ── Step 6: Home/Away splits ──────────────────────────────────────────────
  const homeGames = allGames.filter(g => !String(g.opp ?? "").startsWith("@"));
  const awayGames = allGames.filter(g =>  String(g.opp ?? "").startsWith("@"));
  const splits = {
    home: aggregateRawStats(homeGames),
    away: aggregateRawStats(awayGames),
  };

  // ── Step 7: MLB-specific extras ───────────────────────────────────────────
  let mlbamId: string | null = null;
  let avg30: number | undefined;
  let avg14: number | undefined;

  if (sport === "MLB" && name) {
    try {
      mlbamId = await resolveMlbamId(name);
    } catch { /* non-fatal */ }

    // Batting average windows — recent games with AB > 0
    const battingGames = allGames.filter(g => parseInt(g.AB ?? "0") > 0);
    const last30 = battingGames.slice(-30);
    const last14 = battingGames.slice(-14);
    if (last30.length >= 5) {
      const h30 = last30.reduce((s, g) => s + parseInt(g.H ?? "0"), 0);
      const ab30 = last30.reduce((s, g) => s + parseInt(g.AB ?? "0"), 0);
      if (ab30 > 0) avg30 = +(h30 / ab30).toFixed(3);
    }
    if (last14.length >= 3) {
      const h14 = last14.reduce((s, g) => s + parseInt(g.H ?? "0"), 0);
      const ab14 = last14.reduce((s, g) => s + parseInt(g.AB ?? "0"), 0);
      if (ab14 > 0) avg14 = +(h14 / ab14).toFixed(3);
    }
  }

  return {
    espnId,
    name,
    sport,
    team,
    teamAbbr: team,
    position,
    jerseyNumber,
    headshot,
    headshotUrl: headshot,
    season,         // <-- matches PlayerData.season
    gamelog,        // <-- each entry has opp/date_game keys matching GameLogEntry
    splits,         // <-- { home: {...}, away: {...} }
    mlbamId,        // <-- for BvP (MLB only)
    avg30,
    avg14,
    steamer: null,
    statcastData: null,
  };
}

/** Build season aggregate stats from game entries, returning client-expected keys */
function buildSeasonStats(games: any[], sport: Sport): Record<string, any> {
  if (games.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const rateKeys = new Set(["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "FG%", "3P%", "FT%"]);

  for (const g of games) {
    for (const [k, v] of Object.entries(g)) {
      if (["date_game", "opp", "result", "FG", "3PT"].includes(k)) continue;
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

  // Return with keys the client checks: lowercase fallbacks too
  switch (sport) {
    case "MLB": {
      const s = agg;
      // IP is stored as decimal innings (e.g. 50.3 meaning 50 1/3 IP) — round display
      const ipVal = s.IP != null ? Math.round(s.IP * 10) / 10 : null;
      return {
        gamesPlayed: s.gamesPlayed,
        // Batting
        AVG: s.AVG ?? null,  avg: s.AVG ?? null,
        OBP: s.OBP ?? null,  obp: s.OBP ?? null,
        SLG: s.SLG ?? null,  slg: s.SLG ?? null,
        HR:  s.HR  ?? null,  hr:  s.HR  ?? null,
        RBI: s.RBI ?? null,  rbi: s.RBI ?? null,
        R:   s.R   ?? null,  r:   s.R   ?? null,
        H:   s.H   ?? null,  h:   s.H   ?? null,
        BB:  s.BB  ?? null,  bb:  s.BB  ?? null,
        SO:  s.SO  ?? null,  so:  s.SO  ?? null,
        K:   s.K  ?? s.SO ?? null,  // pitchers use K label, batters use SO
        SB:  s.SB  ?? null,  sb:  s.SB  ?? null,
        "2B": s["2B"] ?? null,
        "3B": s["3B"] ?? null,
        AB:  s.AB  ?? null,
        // Pitching
        IP:  ipVal,  ip: ipVal,
        ER:  s.ER  ?? null,  er: s.ER  ?? null,
      };
    }
    case "NBA": {
      return {
        gamesPlayed: agg.gamesPlayed,
        PTS: agg.PTS ?? null, pts: agg.PTS ?? null,
        REB: agg.REB ?? null, reb: agg.REB ?? null,
        AST: agg.AST ?? null, ast: agg.AST ?? null,
        BLK: agg.BLK ?? null, blk: agg.BLK ?? null,
        STL: agg.STL ?? null, stl: agg.STL ?? null,
        TO:  agg.TO  ?? null,
        MIN: agg.MIN ?? null,
      };
    }
    case "NHL": {
      return {
        gamesPlayed: agg.gamesPlayed,
        G:    agg.G    ?? null,
        A:    agg.A    ?? null,
        PTS:  agg.PTS  ?? null,
        "+/-": agg["+/-"] ?? null,
        S:    agg.S    ?? null,
        TOI:  agg.TOI  ?? null,
      };
    }
    case "NFL": {
      return {
        gamesPlayed: agg.gamesPlayed,
        YDS: agg.YDS ?? null, ATT: agg.ATT ?? null,
        CMP: agg.CMP ?? null, TD: agg.TD ?? null,
        INT: agg.INT ?? null, REC: agg.REC ?? null,
        CAR: agg.CAR ?? null,
      };
    }
    default: return agg;
  }
}

/** Aggregate raw stat fields across game entries for splits */
function aggregateRawStats(games: any[]): Record<string, any> {
  if (games.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const rateKeys = new Set(["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP"]);

  for (const g of games) {
    for (const [k, v] of Object.entries(g)) {
      if (["date_game", "opp", "result", "FG", "3PT"].includes(k)) continue;
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
    // Also add lowercase aliases so the client can check both
    agg[k.toLowerCase()] = agg[k];
  }
  return agg;
}

// ─── Route Registration ────────────────────────────────────────────────────

export function registerPlayerIntelRoutes(app: Express): void {
  console.log(`${LOG_PREFIX} Registering Player Intel routes`);

  // ── 1. Search ────────────────────────────────────────────────────────────
  app.get("/api/intel/search", async (req, res) => {
    try {
      const { q, sport } = req.query as { q?: string; sport?: string };
      if (!q || q.trim() === "") return res.status(400).json({ error: "Query 'q' is required" });

      const cacheKey = `search:${q.toLowerCase()}:${(sport ?? "all").toLowerCase()}`;
      const cached = getCache(searchCache, cacheKey, ONE_HOUR_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} search q="${q}" sport="${sport ?? "all"}"`);
      const results = await handleSearch(q.trim(), sport);
      setCache(searchCache, cacheKey, results);
      return res.json(results);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} search error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 2. Player Profile ─────────────────────────────────────────────────────
  app.get("/api/intel/player/:sport/:espnId", async (req, res) => {
    try {
      const { sport, espnId } = req.params;
      const sportUp = sport.toUpperCase() as Sport;
      if (!ESPN_SPORT_MAP[sportUp]) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

      const cacheKey = `profile_v3:${sportUp}:${espnId}`;
      const cached = getCache(profileCache, cacheKey, ONE_HOUR_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} fetching profile ${sportUp} espnId=${espnId}`);
      const profile = await handlePlayerProfile(sportUp, espnId);

      // Only cache if we got real data
      const hasData = profile.name || (profile.gamelog?.length ?? 0) > 0;
      if (hasData) setCache(profileCache, cacheKey, profile);
      return res.json(profile);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} profile error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 3. BvP — path params: /api/intel/bvp/:batterId/:pitcherId ─────────────
  // batterId and pitcherId are MLBAM IDs (numeric)
  app.get("/api/intel/bvp/:batterId/:pitcherId", async (req, res) => {
    try {
      const batterId  = parseInt(req.params.batterId,  10);
      const pitcherId = parseInt(req.params.pitcherId, 10);
      if (isNaN(batterId) || isNaN(pitcherId)) {
        return res.status(400).json({ error: "batterId and pitcherId must be numeric MLBAM IDs" });
      }

      const cacheKey = `bvp:${batterId}:${pitcherId}`;
      const cached = getCache(bvpCache, cacheKey, ONE_HOUR_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} BvP batter=${batterId} pitcher=${pitcherId}`);
      const bvp: BvpResult = await getBvpExtended(batterId, pitcherId);

      const result = {
        seasonBvP: bvp.seasonData ? { ...bvp.seasonData, doubles: bvp.seasonData.doubles, BB: bvp.seasonData.walks, K: bvp.seasonData.strikeOuts, R: bvp.seasonData.runs } : null,
        careerBvP: bvp.careerData ? { ...bvp.careerData, doubles: bvp.careerData.doubles, BB: bvp.careerData.walks, K: bvp.careerData.strikeOuts, R: bvp.careerData.runs } : null,
        signal:    bvp.signal === "strong" ? "strong" : bvp.signal === "weak" ? "struggles" : "neutral",
        rawBvp:    bvp,
      };

      setCache(bvpCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} bvp error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 3b. BvP by name — /api/intel/bvp-name?batter=X&pitcher=Y ─────────────
  // Resolves names → MLBAM IDs then proxies to BvP
  app.get("/api/intel/bvp-name", async (req, res) => {
    try {
      const { batter, pitcher } = req.query as { batter?: string; pitcher?: string };
      if (!batter || !pitcher) return res.status(400).json({ error: "batter and pitcher names required" });

      const cacheKey = `bvp-name:${batter.toLowerCase()}:${pitcher.toLowerCase()}`;
      const cached = getCache(bvpCache, cacheKey, ONE_HOUR_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} BvP by name: "${batter}" vs "${pitcher}"`);
      const [batterId, pitcherId] = await Promise.all([
        resolveMlbamId(batter),
        resolveMlbamId(pitcher),
      ]);

      if (!batterId || !pitcherId) {
        return res.status(404).json({
          error: `Could not resolve MLBAM IDs. Batter: ${batterId ?? "not found"}, Pitcher: ${pitcherId ?? "not found"}`,
          batterFound:  !!batterId,
          pitcherFound: !!pitcherId,
        });
      }

      const bvp: BvpResult = await getBvpExtended(Number(batterId), Number(pitcherId));

      // Try FanGraphs as second source if MLB Stats API returned nothing
      let seasonBvP = bvp.seasonData ? { ...bvp.seasonData, BB: bvp.seasonData.walks, K: bvp.seasonData.strikeOuts, R: bvp.seasonData.runs } : null;
      let careerBvP = bvp.careerData ? { ...bvp.careerData, BB: bvp.careerData.walks, K: bvp.careerData.strikeOuts, R: bvp.careerData.runs } : null;

      if (!seasonBvP && !careerBvP) {
        // Second source: Retrosheet/Baseball Reference game-finder style via MLB Stats API career splits
        // Try fetching with no season filter (all-time) as a deeper fallback
        try {
          const careerFallback = await axios.get(
            `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}`,
            { timeout: 8000 }
          );
          const allTimeSplits = careerFallback.data?.stats?.[0]?.splits ?? [];
          if (allTimeSplits.length > 0) {
            // Aggregate all splits
            let ab = 0, hits = 0, hr = 0, rbi = 0, tb = 0, doubles = 0, walks = 0, strikeOuts = 0, runs = 0;
            for (const sp of allTimeSplits) {
              const s = sp.stat ?? {};
              ab          += parseInt(s.atBats       ?? "0");
              hits        += parseInt(s.hits         ?? "0");
              hr          += parseInt(s.homeRuns     ?? "0");
              rbi         += parseInt(s.rbi          ?? "0");
              tb          += parseInt(s.totalBases   ?? "0");
              doubles     += parseInt(s.doubles      ?? "0");
              walks       += parseInt(s.baseOnBalls  ?? "0");
              strikeOuts  += parseInt(s.strikeOuts   ?? "0");
              runs        += parseInt(s.runs         ?? "0");
            }
            if (ab > 0) {
              const avgFb  = parseFloat((hits / ab).toFixed(3));
              const obpFb  = walks + hits > 0 ? parseFloat(((hits + walks) / (ab + walks)).toFixed(3)) : null;
              const slgFb  = parseFloat((tb / ab).toFixed(3));
              const opsFb  = (obpFb != null) ? parseFloat((obpFb + slgFb).toFixed(3)) : null;
              careerBvP = { AB: ab, H: hits, HR: hr, RBI: rbi, TB: tb, doubles, BB: walks, K: strikeOuts, R: runs, AVG: avgFb, OBP: obpFb, SLG: slgFb, OPS: opsFb };
              console.log(`${LOG_PREFIX} BvP fallback (all-time): batter=${batterId} vs pitcher=${pitcherId}, AB=${ab}`);
            }
          }
        } catch (e2: any) {
          console.warn(`${LOG_PREFIX} BvP fallback error:`, e2.message);
        }
      }

      const result = {
        seasonBvP,
        careerBvP,
        signal:    bvp.signal === "strong" ? "strong" : bvp.signal === "weak" ? "struggles" : "neutral",
        rawBvp:    bvp,
        batterId,
        pitcherId,
      };

      setCache(bvpCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} bvp-name error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 4. Park Splits — /api/intel/park-splits/:playerId ────────────────────
  // Career venue aggregation: fetch gamelogs for last 5 seasons, resolve venues
  // via batch schedule call, then aggregate hitting stats per ballpark.
  app.get("/api/intel/park-splits/:playerId", async (req, res) => {
    try {
      const playerIdNum = parseInt(req.params.playerId, 10);
      if (isNaN(playerIdNum)) return res.status(400).json({ error: "playerId must be a numeric MLBAM ID" });

      const cacheKey = `park-splits-career:${playerIdNum}`;
      const cached = getCache(parkCache, cacheKey, ONE_DAY_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} park splits (career) playerId=${playerIdNum}`);

      const currentYear = new Date().getFullYear();
      const seasons = [currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4];

      // ── Career Home/Away splits (no season param = career aggregate) ────────
      const haRes = await axios.get(
        `https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=statSplits&group=hitting&sitCodes=h,a&gameType=R`,
        { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
      ).catch(() => null);

      let home: any = {};
      let away: any = {};
      if (haRes?.data?.stats?.[0]?.splits) {
        for (const sp of haRes.data.stats[0].splits) {
          const code = sp.split?.code ?? "";
          const desc = (sp.split?.description ?? "").toLowerCase();
          if (code === "h" || desc.includes("home")) home = flattenMLBStats(sp.stat);
          else if (code === "a" || desc.includes("away")) away = flattenMLBStats(sp.stat);
        }
      }

      // ── Fetch gamelogs for each season in parallel ───────────────────────
      const gamelogResponses = await Promise.allSettled(
        seasons.map(yr =>
          axios.get(
            `https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=gameLog&group=hitting&season=${yr}&gameType=R`,
            { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
          )
        )
      );

      // ── Collect all games with their gamePk and per-game stats ───────────
      interface GameEntry { gamePk: number; stat: any; }
      const allGames: GameEntry[] = [];
      for (const res of gamelogResponses) {
        if (res.status !== "fulfilled") continue;
        for (const sp of (res.value.data?.stats?.[0]?.splits ?? [])) {
          const pk = sp.game?.gamePk;
          if (pk && sp.stat) allGames.push({ gamePk: pk, stat: sp.stat });
        }
      }

      // ── Batch resolve venues via schedule API ────────────────────────────
      const pkToVenue: Record<number, string> = {};
      if (allGames.length > 0) {
        const uniquePks = [...new Set(allGames.map(g => g.gamePk))];
        // Split into chunks of 200 to avoid URL length issues
        const chunkSize = 200;
        for (let i = 0; i < uniquePks.length; i += chunkSize) {
          const chunk = uniquePks.slice(i, i + chunkSize);
          try {
            const schedRes = await axios.get(
              `https://statsapi.mlb.com/api/v1/schedule?gamePks=${chunk.join(",")}&hydrate=venue&fields=dates,games,gamePk,venue,name`,
              { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
            );
            for (const date of (schedRes.data?.dates ?? [])) {
              for (const g of (date.games ?? [])) {
                if (g.gamePk && g.venue?.name) {
                  pkToVenue[g.gamePk] = g.venue.name;
                }
              }
            }
          } catch { /* skip chunk on error */ }
        }
      }

      // ── Aggregate stats per venue ────────────────────────────────────────
      interface VenueAgg {
        G: number; AB: number; H: number; HR: number; RBI: number; R: number;
        BB: number; K: number; SB: number; TB: number;
        doubles: number; triples: number;
        obpNum: number; slgNum: number; opsNum: number;
      }
      const venueAgg: Record<string, VenueAgg> = {};

      for (const { gamePk, stat } of allGames) {
        const venueName = pkToVenue[gamePk];
        if (!venueName) continue;
        if (!venueAgg[venueName]) {
          venueAgg[venueName] = { G:0, AB:0, H:0, HR:0, RBI:0, R:0, BB:0, K:0, SB:0, TB:0, doubles:0, triples:0, obpNum:0, slgNum:0, opsNum:0 };
        }
        const a = venueAgg[venueName];
        a.G   += stat.gamesPlayed  ?? 1;
        a.AB  += stat.atBats       ?? 0;
        a.H   += stat.hits         ?? 0;
        a.HR  += stat.homeRuns     ?? 0;
        a.RBI += stat.rbi          ?? 0;
        a.R   += stat.runs         ?? 0;
        a.BB  += stat.baseOnBalls  ?? 0;
        a.K   += stat.strikeOuts   ?? 0;
        a.SB  += stat.stolenBases  ?? 0;
        a.TB  += stat.totalBases   ?? 0;
        a.doubles += stat.doubles  ?? 0;
        a.triples += stat.triples  ?? 0;
      }

      // ── Compute derived stats and build venue array ──────────────────────
      const venues: any[] = [];
      for (const [venueName, a] of Object.entries(venueAgg)) {
        const avg = a.AB > 0 ? (a.H / a.AB) : 0;
        const obp = (a.AB + a.BB) > 0 ? ((a.H + a.BB) / (a.AB + a.BB)) : 0;
        const slg = a.AB > 0 ? (a.TB / a.AB) : 0;
        const ops = obp + slg;
        let parkFactor: any = null;
        try { parkFactor = await getParkFactor(venueName); } catch { /* ok */ }
        // Use field names the client expects (matches flattenMLBStats keys)
        venues.push({
          venue:        venueName,
          gamesPlayed:  a.G,
          atBats:       a.AB,
          hits:         a.H,
          homeRuns:     a.HR,
          rbi:          a.RBI,
          runs:         a.R,
          baseOnBalls:  a.BB,
          strikeOuts:   a.K,
          stolenBases:  a.SB,
          totalBases:   a.TB,
          doubles:      a.doubles,
          triples:      a.triples,
          // lowercase aliases for STAT_OPTIONS keys
          avg:          avg > 0 ? avg : 0,
          obp:          obp > 0 ? obp : 0,
          slg:          slg > 0 ? slg : 0,
          ops:          ops > 0 ? ops : 0,
          hr:           a.HR,
          walks:        a.BB,
          // also used in detail chip grid
          G:    a.G,
          AB:   a.AB,
          H:    a.H,
          HR:   a.HR,
          RBI:  a.RBI,
          R:    a.R,
          BB:   a.BB,
          K:    a.K,
          SB:   a.SB,
          parkFactor: parkFactor ?? null,
        });
      }

      // Sort by most AB (most-played parks first)
      venues.sort((a, b) => b.AB - a.AB);

      const result = { home, away, venues, careerSeasons: seasons.length };
      setCache(parkCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} park-splits error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 5. Spray Chart — /api/intel/spray-chart/:mlbamId ──────────────────────
  // Fetches play-by-play for all games in the last 3 seasons, extracts hit
  // coordinates (coordX, coordY) from playEvents.hitData for the given batter.
  app.get("/api/intel/spray-chart/:mlbamId", async (req, res) => {
    try {
      const mlbamId = parseInt(req.params.mlbamId, 10);
      if (isNaN(mlbamId)) return res.status(400).json({ error: "mlbamId must be numeric" });

      const cacheKey = `spray-chart:${mlbamId}`;
      const cached = getCache(parkCache, cacheKey, ONE_DAY_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} spray chart mlbamId=${mlbamId}`);

      const currentYear = new Date().getFullYear();
      const seasons = [currentYear, currentYear - 1, currentYear - 2];

      // 1. Fetch gamelogs for last 3 seasons to get gamePks
      const gamelogResults = await Promise.allSettled(
        seasons.map(yr =>
          axios.get(
            `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&group=hitting&season=${yr}&gameType=R`,
            { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }
          )
        )
      );

      const gamePks: number[] = [];
      for (const res of gamelogResults) {
        if (res.status !== "fulfilled") continue;
        for (const sp of (res.value.data?.stats?.[0]?.splits ?? [])) {
          const pk = sp.game?.gamePk;
          if (pk) gamePks.push(pk);
        }
      }

      if (gamePks.length === 0) {
        return res.json({ hits: [], total: 0 });
      }

      // 2. Fetch play-by-play for each game — cap at 100 most recent games
      // (full feed is ~870KB each; 100 games ≈ 87MB, manageable in ~10s)
      const recentPks = gamePks.slice(-100);
      const PBP_CONCURRENCY = 15;
      const hits: any[] = [];

      for (let i = 0; i < recentPks.length; i += PBP_CONCURRENCY) {
        const chunk = recentPks.slice(i, i + PBP_CONCURRENCY);
        const pbpResults = await Promise.allSettled(
          chunk.map(pk =>
            axios.get(
              `https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`,
              { timeout: 12000, headers: AXIOS_HEADERS }
            )
          )
        );

        for (const r of pbpResults) {
          if (r.status !== "fulfilled") continue;
          const allPlays = r.value.data?.liveData?.plays?.allPlays ?? [];
          for (const play of allPlays) {
            // Must be this batter
            if (play.matchup?.batter?.id !== mlbamId) continue;
            const event = play.result?.event ?? "";
            // Scan playEvents for hitData
            for (const ev of (play.playEvents ?? [])) {
              const hd = ev.hitData;
              if (!hd?.coordinates?.coordX) continue;
              hits.push({
                x:          hd.coordinates.coordX,
                y:          hd.coordinates.coordY,
                event:      event,
                trajectory: hd.trajectory ?? "",
                speed:      hd.launchSpeed ?? null,
                angle:      hd.launchAngle ?? null,
                distance:   hd.totalDistance ?? null,
              });
            }
          }
        }
      }

      const result = { hits, total: hits.length };
      setCache(parkCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} spray-chart error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 6. Vs-Team — /api/intel/vs-team/:sport/:playerId/:teamAbbr ───────────
  app.get("/api/intel/vs-team/:sport/:playerId/:teamAbbr", async (req, res) => {
    try {
      const { sport, playerId, teamAbbr } = req.params;
      const sportUp = sport.toUpperCase() as Sport;
      if (!ESPN_SPORT_MAP[sportUp]) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

      const cacheKey = `vs-team:${sportUp}:${playerId}:${teamAbbr.toUpperCase()}`;
      const cached = getCache(vsTeamCache, cacheKey, ONE_HOUR_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} vs-team ${sportUp} player=${playerId} vs ${teamAbbr}`);

      const result = sportUp === "MLB"
        ? await fetchMLBVsTeam(playerId, teamAbbr.toUpperCase())
        : await fetchESPNVsTeam(sportUp, playerId, teamAbbr.toUpperCase());

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

async function fetchMLBVsTeam(playerId: string, teamAbbr: string): Promise<any> {
  const teamId = MLB_TEAM_IDS[teamAbbr];
  if (!teamId) throw new Error(`Unknown MLB team: ${teamAbbr}`);
  const playerIdNum = parseInt(playerId, 10);
  if (isNaN(playerIdNum)) throw new Error("playerId must be numeric MLBAM ID for MLB");

  const [seasonRes, careerRes] = await Promise.allSettled([
    axios.get(`https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=vsTeam&group=hitting&season=2026&opposingTeamId=${teamId}`, { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }),
    axios.get(`https://statsapi.mlb.com/api/v1/people/${playerIdNum}/stats?stats=vsTeamTotal&group=hitting&opposingTeamId=${teamId}`, { timeout: AXIOS_TIMEOUT, headers: AXIOS_HEADERS }),
  ]);

  // vsTeamTotal gives the season aggregate; vsTeam gives individual game splits
  const careerStats = careerRes.status === "fulfilled" ? flattenMLBStats(careerRes.value.data?.stats?.[0]?.splits?.[0]?.stat) : {};

  // Aggregate ALL per-game splits from vsTeam for season totals (more accurate than first split)
  const allGameSplits = seasonRes.status === "fulfilled" ? (seasonRes.value.data?.stats?.[0]?.splits ?? []) : [];

  let seasonStats: Record<string, any> = {};
  if (allGameSplits.length > 0) {
    // Sum counting stats, compute rate stats
    let ab = 0, hits = 0, hr = 0, rbi = 0, tb = 0, doubles = 0, triples = 0, walks = 0, strikeOuts = 0, runs = 0, stolenBases = 0, gamesPlayed = allGameSplits.length;
    for (const sp of allGameSplits) {
      const s = sp.stat ?? {};
      ab          += parseInt(s.atBats       ?? "0");
      hits        += parseInt(s.hits         ?? "0");
      hr          += parseInt(s.homeRuns     ?? "0");
      rbi         += parseInt(s.rbi          ?? "0");
      tb          += parseInt(s.totalBases   ?? "0");
      doubles     += parseInt(s.doubles      ?? "0");
      triples     += parseInt(s.triples      ?? "0");
      walks       += parseInt(s.baseOnBalls  ?? "0");
      strikeOuts  += parseInt(s.strikeOuts   ?? "0");
      runs        += parseInt(s.runs         ?? "0");
      stolenBases += parseInt(s.stolenBases  ?? "0");
    }
    const avg = ab > 0 ? parseFloat((hits / ab).toFixed(3)) : null;
    const obp = (ab + walks) > 0 ? parseFloat(((hits + walks) / (ab + walks)).toFixed(3)) : null;
    const slg = ab > 0 ? parseFloat((tb / ab).toFixed(3)) : null;
    const ops = (obp != null && slg != null) ? parseFloat((obp + slg).toFixed(3)) : null;
    seasonStats = { avg, obp, slg, ops, hr, rbi, hits, atBats: ab, walks, strikeOuts, doubles, triples, runs, stolenBases, gamesPlayed };
  }

  // Build per-game table: flatten nested stats to top-level keys
  const recentGames = allGameSplits.slice().reverse().slice(0, 10).map((sp: any) => {
    const flat = flattenMLBStats(sp.stat);
    return {
      date:   sp.date   ?? sp.stat?.date ?? null,
      opp:    teamAbbr,
      result: sp.isWin ? "W" : "L",
      H:      flat.hits        ?? null,
      AB:     flat.atBats      ?? null,
      HR:     flat.hr          ?? null,
      RBI:    flat.rbi         ?? null,
      BB:     flat.walks       ?? null,
      K:      flat.strikeOuts  ?? null,
      "2B":   flat.doubles     ?? null,
      TB:     sp.stat?.totalBases ?? null,
      R:      flat.runs        ?? null,
      AVG:    flat.avg         ?? null,
      OBP:    flat.obp         ?? null,
      SLG:    flat.slg         ?? null,
    };
  });

  return { seasonStats, careerStats, recentGames };
}

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
          entries.push({ entry: ev, eventInfo: eventsMap[eid] ?? {}, labels });
        }
      }
    }
    return entries;
  };

  let allEntries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];
  try {
    const fetches = await Promise.allSettled(
      cfg.seasons.map(yr =>
        axios.get(`https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${playerId}/gamelog?season=${yr}`, { timeout: 10000, headers: AXIOS_HEADERS })
      )
    );
    for (const r of fetches) {
      if (r.status === "fulfilled") allEntries.push(...parseV3Response(r.value.data));
    }
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} vs-team gamelog failed:`, err.message);
  }

  const vsEntries = allEntries.filter(({ eventInfo }) =>
    (eventInfo.opponent?.abbreviation ?? "").toUpperCase() === teamAbbr
  );

  const games = vsEntries.map(({ entry, eventInfo, labels }) => {
    const stats = entry.stats ?? [];
    const raw: Record<string, string> = {};
    labels.forEach((lbl, i) => { if (stats[i] != null) raw[lbl] = String(stats[i]); });
    return {
      date: eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "",
      opp:  teamAbbr,
      result: eventInfo.gameResult ?? "",
      ...raw,
    };
  });

  games.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return {
    seasonStats: aggregateGames(games),
    careerStats: {},
    recentGames: games.slice(-5),
  };
}

function aggregateGames(games: any[]): Record<string, any> {
  if (games.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const g of games) {
    for (const [k, v] of Object.entries(g)) {
      if (["date", "opp", "result"].includes(k)) continue;
      if (String(v).includes("-") && String(v).split("-").length === 2) continue;
      const n = parseFloat(String(v));
      if (!isNaN(n)) { sums[k] = (sums[k] ?? 0) + n; counts[k] = (counts[k] ?? 0) + 1; }
    }
  }
  const agg: Record<string, any> = { gamesPlayed: games.length };
  for (const k of Object.keys(sums)) {
    const isRate = ["AVG","OBP","SLG","OPS","ERA","WHIP"].includes(k) || k.includes("%");
    agg[k] = isRate ? +(sums[k] / counts[k]).toFixed(3) : sums[k];
  }
  return agg;
}
