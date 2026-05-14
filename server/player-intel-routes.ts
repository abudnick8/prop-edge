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

      // Normalize to client BvPData shape:
      // { seasonBvP, careerBvP, signal }
      // "source" from getBvpExtended tells us if it's season or career data
      const statBlock = {
        AB:  bvp.ab,
        H:   bvp.hits,
        HR:  bvp.hr,
        RBI: bvp.rbi,
        TB:  bvp.tb,
        AVG: bvp.avg ?? (bvp.ab > 0 ? +(bvp.hits / bvp.ab).toFixed(3) : null),
        OBP: bvp.obp,
        SLG: bvp.slg,
      };

      const result = {
        seasonBvP: bvp.source === "season" ? statBlock : (bvp.ab > 0 ? statBlock : null),
        careerBvP: bvp.source === "career" ? statBlock : null,
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

      const statBlock = {
        AB:  bvp.ab,
        H:   bvp.hits,
        HR:  bvp.hr,
        RBI: bvp.rbi,
        TB:  bvp.tb,
        AVG: bvp.avg ?? (bvp.ab > 0 ? +(bvp.hits / bvp.ab).toFixed(3) : null),
        OBP: bvp.obp,
        SLG: bvp.slg,
      };

      const result = {
        seasonBvP: bvp.source === "season" ? statBlock : (bvp.ab > 0 ? statBlock : null),
        careerBvP: bvp.source === "career" ? statBlock : null,
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
  app.get("/api/intel/park-splits/:playerId", async (req, res) => {
    try {
      const playerIdNum = parseInt(req.params.playerId, 10);
      if (isNaN(playerIdNum)) return res.status(400).json({ error: "playerId must be a numeric MLBAM ID" });

      const cacheKey = `park-splits:${playerIdNum}`;
      const cached = getCache(parkCache, cacheKey, ONE_DAY_MS);
      if (cached) return res.json(cached);

      console.log(`${LOG_PREFIX} park splits playerId=${playerIdNum}`);

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
        for (const sp of (haRes.value.data?.stats?.[0]?.splits ?? [])) {
          const desc = (sp.split?.description ?? "").toLowerCase();
          if (sp.split?.code === "h" || desc.includes("home")) home = flattenMLBStats(sp.stat);
          else if (sp.split?.code === "a" || desc.includes("away")) away = flattenMLBStats(sp.stat);
        }
      }

      const venues: any[] = [];
      if (venueRes.status === "fulfilled") {
        for (const sp of (venueRes.value.data?.stats?.[0]?.splits ?? [])) {
          const venueName = sp.split?.description ?? sp.venue?.name ?? "Unknown";
          let parkFactor: any = null;
          try { parkFactor = await getParkFactor(venueName); } catch { /* ok */ }
          venues.push({ venue: venueName, ...flattenMLBStats(sp.stat), parkFactor: parkFactor ?? null });
        }
      }

      const result = { home, away, venues };
      setCache(parkCache, cacheKey, result);
      return res.json(result);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} park-splits error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── 5. Vs-Team — /api/intel/vs-team/:sport/:playerId/:teamAbbr ───────────
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

  const seasonStats = seasonRes.status === "fulfilled" ? flattenMLBStats(seasonRes.value.data?.stats?.[0]?.splits?.[0]?.stat) : {};
  const careerStats = careerRes.status === "fulfilled" ? flattenMLBStats(careerRes.value.data?.stats?.[0]?.splits?.[0]?.stat) : {};

  const recentGames: any[] = [];
  if (seasonRes.status === "fulfilled") {
    for (const sp of (seasonRes.value.data?.stats?.[0]?.splits ?? []).slice(0, 5)) {
      recentGames.push({ date: sp.date ?? null, team: teamAbbr, stats: flattenMLBStats(sp.stat) });
    }
  }

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
