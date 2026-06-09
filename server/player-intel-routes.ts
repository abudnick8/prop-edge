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

// ─── Venue name aliases ─────────────────────────────────────────────────────
// Maps old/alternate MLB API venue names → canonical names used in the client's
// ALL_MLB_STADIUMS list so spray chart and park splits always match correctly.
const VENUE_ALIASES: Record<string, string> = {
  // White Sox — renamed from "Guaranteed Rate Field" to "Rate Field" in 2025, then back
  "rate field":                      "Guaranteed Rate Field",
  // A's — old Oakland park still referenced in older game logs
  // New Sacramento park uses its own entry, no alias needed
  // Neutral-site / international series
  "estadio alfredo harp helu":       "Estadio Alfredo Harp Helu",  // already in client list
  // Any other common variations
  "seatgeek stadium":                "Guaranteed Rate Field",
  "comiskey park":                   "Guaranteed Rate Field",
};

/** Normalize a venue name from the MLB schedule API to match ALL_MLB_STADIUMS. */
function normalizeVenueName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  return VENUE_ALIASES[key] ?? name;
}

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
      statMap: { MIN: "MIN", PTS: "PTS", REB: "REB", AST: "AST", BLK: "BLK", STL: "STL", TO: "TO", FG: "FG", "3PT": "3PT", FT: "FT", FTM: "FTM", FTA: "FTA" },
    },
    NHL: {
      sn: "hockey", lg: "nhl",
      seasons: [currentYear, currentYear - 1],
      statMap: { G: "G", A: "A", PTS: "PTS", S: "S", "TOI/G": "TOI", "+/-": "+/-", PIM: "PIM", BLK: "BLK", BS: "BS", HITS: "HITS" },
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
      statMap: { YDS: "YDS", TD: "TD", INT: "INT", ATT: "ATT", REC: "REC", CAR: "CAR", LONG: "LONG", CMP: "CMP", RTG: "RTG", QBR: "QBR", RATE: "RATE", RECYDS: "RECYDS", RYDS: "RYDS", TGT: "TGT", TGTS: "TGTS", FUM: "FUM" },
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

    // ── NFL has duplicate label names (passing YDS vs rushing YDS, etc.)
    // Must use positional index to disambiguate.
    if (sport === "NFL") {
      // QB layout:  CMP ATT YDS CMP% AVG TD INT LNG SACK RTG QBR | CAR YDS AVG TD LNG
      // RB layout:  CAR YDS AVG TD LNG | REC TGTS YDS AVG TD LNG | FUM LST FF KB
      // WR/TE layout: REC TGTS YDS AVG TD LNG | CAR YDS AVG LNG TD | FUM LST FF KB
      const s = (i: number) => stats[i] != null ? String(stats[i]) : undefined;
      if (labels[0] === "CMP" && labels[1] === "ATT") {
        // QB
        raw["CMP"]      = s(0) ?? "0";
        raw["ATT"]      = s(1) ?? "0";
        raw["YDS"]      = s(2) ?? "0";   // passing yards
        raw["CMP%"]     = s(3) ?? "0";
        raw["AVG"]      = s(4) ?? "0";   // yards/attempt
        raw["TD"]       = s(5) ?? "0";
        raw["INT"]      = s(6) ?? "0";
        raw["LNG"]      = s(7) ?? "0";
        raw["SACK"]     = s(8) ?? "0";
        raw["RTG"]      = s(9) ?? "0";
        raw["rating"]   = s(9) ?? "0";   // passer rating alias
        raw["QBR"]      = s(10) ?? "0";
        raw["RUSH_CAR"] = s(11) ?? "0";  // QB rushing carries
        raw["RUSH_YDS"] = s(12) ?? "0";  // QB rushing yards
      } else if (labels[0] === "CAR") {
        // RB
        raw["CAR"]      = s(0) ?? "0";
        raw["YDS"]      = s(1) ?? "0";   // rush yards
        raw["AVG"]      = s(2) ?? "0";   // ypc
        raw["TD"]       = s(3) ?? "0";
        raw["LNG"]      = s(4) ?? "0";
        raw["REC"]      = s(5) ?? "0";
        raw["TGTS"]     = s(6) ?? "0";
        raw["RecYDS"]   = s(7) ?? "0";   // receiving yards
        raw["RecAVG"]   = s(8) ?? "0";
        raw["RecTD"]    = s(9) ?? "0";
        raw["FUM"]      = s(11) ?? "0";
      } else if (labels[0] === "REC") {
        // WR / TE
        raw["REC"]      = s(0) ?? "0";
        raw["TGTS"]     = s(1) ?? "0";
        raw["YDS"]      = s(2) ?? "0";   // receiving yards
        raw["AVG"]      = s(3) ?? "0";   // ypr
        raw["TD"]       = s(4) ?? "0";
        raw["LNG"]      = s(5) ?? "0";
        raw["CAR"]      = s(6) ?? "0";   // rush attempts (if any)
        raw["RUSH_YDS"] = s(7) ?? "0";
        raw["FUM"]      = s(11) ?? "0";
      } else {
        // Generic fallback
        labels.forEach((lbl, i) => { if (stats[i] != null) raw[lbl] = String(stats[i]); });
      }
    } else {
      // All other sports: label → value (no duplicate issues)
      labels.forEach((lbl, i) => { if (stats[i] != null) raw[lbl] = String(stats[i]); });
    }

    // ── NBA: split "made-att" strings ──
    // ESPN sends FG/3PT/FT as "8-18", "2-6", "6-8" — split into made+att
    if (raw["FG"]) {
      const [m, a] = raw["FG"].split("-");
      raw["FGM"] = m ?? "0"; raw["FGA"] = a ?? "0";
      if (a && parseFloat(a) > 0) raw["FG%"] = (parseFloat(m ?? "0") / parseFloat(a) * 100).toFixed(1);
    }
    if (raw["3PT"]) {
      const [m, a] = raw["3PT"].split("-");
      raw["3PTM"] = m ?? "0"; raw["3PTA"] = a ?? "0";
      // ESPN also sends 3P% directly as a label (e.g. "33.3") — keep it if present, derive if not
      if (!raw["3P%"] && a && parseFloat(a) > 0)
        raw["3P%"] = (parseFloat(m ?? "0") / parseFloat(a) * 100).toFixed(1);
    }
    if (raw["FT"]) {
      const [m, a] = raw["FT"].split("-");
      raw["FTM"] = m ?? "0"; raw["FTA"] = a ?? "0";
      if (!raw["FT%"] && a && parseFloat(a) > 0)
        raw["FT%"] = (parseFloat(m ?? "0") / parseFloat(a) * 100).toFixed(1);
    }

    // ── MLB: derive Total Bases per game (hitters only) ──
    if (raw["H"] != null && raw["IP"] == null) {
      const h  = parseFloat(raw["H"]  ?? "0") || 0;
      const d  = parseFloat(raw["2B"] ?? "0") || 0;
      const t  = parseFloat(raw["3B"] ?? "0") || 0;
      const hr = parseFloat(raw["HR"] ?? "0") || 0;
      const singles = Math.max(0, h - d - t - hr);
      raw["TB"] = String(singles + 2 * d + 3 * t + 4 * hr);
    }
    // ── MLB pitcher: normalize K alias from SO ──
    if (raw["IP"] != null) {
      if (raw["SO"] != null && raw["K"] == null) raw["K"] = raw["SO"];
      // ESPN v3 pitcher labels: IP ER R H BB SO HR ERA WHIP (already mapped via labels.forEach)
      // H_allowed alias so client can show hits allowed separately from H (batting)
      if (raw["H"] != null) { raw["H_allowed"] = raw["H"]; delete raw["H"]; }
      if (raw["HR"] != null) { raw["HR_allowed"] = raw["HR"]; delete raw["HR"]; }
    }

    // ── NHL: shots alias (ESPN label "S") ──
    if (raw["S"] != null) raw["SOG"] = raw["S"];

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
  const season = buildSeasonStats(currentSeasonGames.length > 0 ? currentSeasonGames : allGames, sport, position ?? undefined);

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
function buildSeasonStats(games: any[], sport: Sport, position?: string | null): Record<string, any> {
  if (games.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const rateKeys = new Set([
    // MLB rates
    "AVG", "OBP", "SLG", "OPS", "ERA", "WHIP",
    // NBA rates (ESPN sends these already as per-game averages)
    "FG%", "3P%", "FT%", "MIN",
    // NFL rates
    "CMP%", "RTG", "QBR", "AVG",
    // NHL rates (ESPN sends TOI/G as per-game, SPCT as pct)
    "TOI/G", "TOI", "SPCT",
  ]);

  for (const g of games) {
    for (const [k, v] of Object.entries(g)) {
      // Skip raw made-att strings, non-stat fields, and LONG/LNG (not useful for averages)
      if (["date_game", "opp", "result", "FG", "3PT", "FT", "LNG", "LONG", "LNG"].includes(k)) continue;
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
      const PITCHER_POS = new Set(["SP", "RP", "P", "CP", "MR"]);
      const isPitcher = position != null && PITCHER_POS.has(position.toUpperCase());
      // IP is stored as decimal innings — round display
      const ipVal = s.IP != null ? Math.round(s.IP * 10) / 10 : null;

      if (isPitcher) {
        // Pitching stats: ERA/WHIP are rate keys → already averaged
        const gp = s.gamesPlayed || 1;
        const kPerGame = s.K != null ? +(s.K / gp).toFixed(1) : null;
        return {
          gamesPlayed: s.gamesPlayed,
          isPitcher: true,
          IP:          ipVal,          ip: ipVal,
          ERA:         s.ERA ?? null,  era: s.ERA ?? null,
          WHIP:        s.WHIP ?? null, whip: s.WHIP ?? null,
          K:           s.K   ?? null,  k:   s.K   ?? null,
          BB:          s.BB  ?? null,  bb:  s.BB  ?? null,
          ER:          s.ER  ?? null,  er:  s.ER  ?? null,
          R:           s.R   ?? null,  r:   s.R   ?? null,
          H_allowed:   s.H_allowed ?? null,
          HR_allowed:  s.HR_allowed ?? null,
          kPerGame,
          // Wins/Losses are not in v3 gamelog — left null
          W:  null,
          L:  null,
          SV: s.SV ?? null,
        };
      }

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
        K:   s.K  ?? s.SO ?? null,
        SB:  s.SB  ?? null,  sb:  s.SB  ?? null,
        TB:  s.TB  ?? null,  tb:  s.TB  ?? null,
        "2B": s["2B"] ?? null,
        "3B": s["3B"] ?? null,
        AB:  s.AB  ?? null,
      };
    }
    case "NBA": {
      const gp = agg.gamesPlayed || 1;
      // FG%/3P%/FT% — ESPN sends these as rate labels directly (e.g. "FG%" = "44.4")
      // They get averaged via rateKeys above. Also derive from FGM/FGA totals as fallback.
      const fgPct = agg["FG%"] ?? (agg.FGA > 0 ? +(agg.FGM / agg.FGA * 100).toFixed(1) : null);
      const tpPct = agg["3P%"] ?? (agg["3PTA"] > 0 ? +(agg["3PTM"] / agg["3PTA"] * 100).toFixed(1) : null);
      const ftPct = agg["FT%"] ?? (agg.FTA > 0 ? +(agg.FTM / agg.FTA * 100).toFixed(1) : null);
      // MIN comes in per-game from ESPN (not a season total) — already averaged via rateKeys
      const minPerGame = agg.MIN ?? null;
      return {
        gamesPlayed: agg.gamesPlayed,
        PTS: agg.PTS ?? null,
        REB: agg.REB ?? null,
        AST: agg.AST ?? null,
        BLK: agg.BLK ?? null,
        STL: agg.STL ?? null,
        TO:  agg.TO  ?? null,
        // Per-game averages
        ppg: agg.PTS != null ? +(agg.PTS / gp).toFixed(1) : null,
        rpg: agg.REB != null ? +(agg.REB / gp).toFixed(1) : null,
        apg: agg.AST != null ? +(agg.AST / gp).toFixed(1) : null,
        bpg: agg.BLK != null ? +(agg.BLK / gp).toFixed(1) : null,
        spg: agg.STL != null ? +(agg.STL / gp).toFixed(1) : null,
        // Shooting pcts (both cases for client key lookup)
        "fg%": fgPct,  "FG%": fgPct,
        "3p%": tpPct,  "3P%": tpPct,
        "ft%": ftPct,  "FT%": ftPct,
        MIN: minPerGame,  min: minPerGame,
      };
    }
    case "NHL": {
      const gp = agg.gamesPlayed || 1;
      const GOALIE_POS = new Set(["G", "GT", "GK"]);
      const isGoalie = position != null && GOALIE_POS.has(position.toUpperCase());
      // TOI/G comes in as per-game string "20:52" — keep as-is (averaged via rateKeys)
      const toiPerGame = agg["TOI/G"] ?? agg.TOI ?? null;
      const pim = agg.PIM ?? null;
      const shots = agg.S ?? null;
      const sogPerGame = shots != null ? +(shots / gp).toFixed(1) : null;

      if (isGoalie) {
        // Goalie stats: GA, SA, SV, SV%, GAA, SO (shutouts)
        // ESPN v3 goalie labels: GA SA SV SV% GAA SO MIN W L OTL
        const svPct = agg["SV%"] ?? agg.SVPCT ?? null;
        const gaa = agg.GAA ?? null;
        return {
          gamesPlayed: agg.gamesPlayed,
          isGoalie: true,
          W:    agg.W   ?? null,
          L:    agg.L   ?? null,
          OTL:  agg.OTL ?? null,
          GA:   agg.GA  ?? null,
          SA:   agg.SA  ?? null,
          SV:   agg.SV  ?? null,
          "SV%": svPct,  sv_pct: svPct,
          GAA:  gaa,  gaa: gaa,
          SO:   agg.SO ?? agg.SHO ?? null,
          MIN:  agg.MIN ?? null,
          TOI:  toiPerGame,  toi: toiPerGame,
        };
      }

      return {
        gamesPlayed: agg.gamesPlayed,
        G:   agg.G   ?? null,
        A:   agg.A   ?? null,
        PTS: agg.PTS ?? null,
        "+/-": agg["+/-"] ?? null,
        S:   shots,
        PIM: pim,  pim: pim,
        sog_per_game: sogPerGame,  SOG_G: sogPerGame,
        TOI: toiPerGame,  toi: toiPerGame,
        // Bonus labels available
        PPG: agg.PPG ?? null,
        SPCT: agg.SPCT ?? null,
      };
    }
    case "NFL": {
      // After positional parsing, keys are unambiguous:
      // QB: YDS=pass yds, RUSH_YDS=rush yds, CMP, ATT, TD, INT, RTG=rating
      // RB: YDS=rush yds, RecYDS=rec yds, CAR, REC, TGTS, AVG=ypc
      // WR/TE: YDS=rec yds, REC, TGTS, AVG=ypr, RUSH_YDS=rush yds
      const rating = agg.RTG ?? agg.QBR ?? null;
      const cmpPct = agg.ATT > 0 ? +(agg.CMP / agg.ATT * 100).toFixed(1) : null;
      const ypc    = agg.CAR > 0 && agg["YDS"] ? +(agg["YDS"] / agg.CAR).toFixed(1) : null;
      const ypr    = agg.REC > 0 && agg.RecYDS ? +(agg.RecYDS / agg.REC).toFixed(1)
                   : agg.REC > 0 && agg["YDS"]  ? +(agg["YDS"]  / agg.REC).toFixed(1) : null;
      return {
        gamesPlayed: agg.gamesPlayed,
        // Passing (QB)
        YDS:     agg.YDS   ?? null,  yds: agg.YDS ?? null,
        ATT:     agg.ATT   ?? null,
        CMP:     agg.CMP   ?? null,
        TD:      agg.TD    ?? null,  td:  agg.TD  ?? null,
        INT:     agg.INT   ?? null,  int: agg.INT ?? null,
        RATING:  rating,             rating: rating,
        CMP_PCT: cmpPct,             cmp_pct: cmpPct,
        // Rushing (QB/RB share YDS; RB also has RUSH_YDS alias)
        CAR:      agg.CAR      ?? null,
        RUSH_YDS: agg.RUSH_YDS ?? agg.YDS ?? null,
        rush_yds: agg.RUSH_YDS ?? agg.YDS ?? null,
        YPC: ypc,  ypc: ypc,
        // Receiving (RB/WR/TE)
        REC:     agg.REC    ?? null,  rec: agg.REC ?? null,
        RecYDS:  agg.RecYDS ?? null,  rec_yds: agg.RecYDS ?? null,  REC_YDS: agg.RecYDS ?? null,
        TGTS:    agg.TGTS   ?? null,  tgts: agg.TGTS ?? null,
        YPR: ypr,  ypr: ypr,
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


// ─── Stadium Factor Data ──────────────────────────────────────────────────────
// MLB park factors from Baseball Reference / Statcast historical data.
// hitFactor/hrFactor/runFactor: 1.00 = league avg, >1.05 hitter-friendly,
// <0.95 pitcher-friendly. Elevation in feet, distances in feet.

interface MlbStadiumFactor {
  venue: string; team: string; abbr: string; div: string;
  dome: boolean; retractable: boolean; elevation: number; surface: string;
  hitFactor: number; hrFactor: number; runFactor: number;
  lf: number; cf: number; rf: number; lfWall: number; rfWall: number;
  windTendency: string; notes: string;
}

const MLB_STADIUM_FACTORS: MlbStadiumFactor[] = [
  { venue:"Truist Park",              team:"Braves",        abbr:"ATL", div:"NL East",    dome:false, retractable:false, elevation:1050, surface:"Grass",     hitFactor:0.96, hrFactor:0.94, runFactor:0.95, lf:335, cf:400, rf:325, lfWall:8,  rfWall:8,  windTendency:"Variable", notes:"Slight pitcher lean; consistent temps reduce scoring swings." },
  { venue:"Citi Field",               team:"Mets",          abbr:"NYM", div:"NL East",    dome:false, retractable:false, elevation:20,   surface:"Grass",     hitFactor:0.94, hrFactor:0.89, runFactor:0.93, lf:335, cf:408, rf:330, lfWall:8,  rfWall:8,  windTendency:"In",       notes:"Strong marine winds suppress HR; deep alleys neutralize gap power." },
  { venue:"Citizens Bank Park",       team:"Phillies",      abbr:"PHI", div:"NL East",    dome:false, retractable:false, elevation:20,   surface:"Grass",     hitFactor:1.05, hrFactor:1.10, runFactor:1.06, lf:329, cf:401, rf:330, lfWall:8,  rfWall:8,  windTendency:"Out",      notes:"Hitter-friendly; humid summers and short porch boost HR." },
  { venue:"Nationals Park",           team:"Nationals",     abbr:"WSH", div:"NL East",    dome:false, retractable:false, elevation:25,   surface:"Grass",     hitFactor:0.97, hrFactor:0.97, runFactor:0.97, lf:336, cf:402, rf:335, lfWall:8,  rfWall:8,  windTendency:"Variable", notes:"Neutral park; slightly suppresses offense vs league average." },
  { venue:"loanDepot park",           team:"Marlins",       abbr:"MIA", div:"NL East",    dome:true,  retractable:true,  elevation:6,    surface:"Grass",     hitFactor:0.91, hrFactor:0.87, runFactor:0.90, lf:340, cf:407, rf:335, lfWall:8,  rfWall:8,  windTendency:"Dome",     notes:"Strong pitcher park; retractable roof controls humidity and heat." },
  { venue:"Wrigley Field",            team:"Cubs",          abbr:"CHC", div:"NL Central", dome:false, retractable:false, elevation:595,  surface:"Grass",     hitFactor:1.07, hrFactor:1.12, runFactor:1.06, lf:355, cf:400, rf:353, lfWall:15, rfWall:11, windTendency:"Variable", notes:"Wind is the key variable - can be a HR haven or graveyard on any given day." },
  { venue:"Great American Ball Park", team:"Reds",          abbr:"CIN", div:"NL Central", dome:false, retractable:false, elevation:490,  surface:"Grass",     hitFactor:1.08, hrFactor:1.16, runFactor:1.09, lf:328, cf:404, rf:325, lfWall:12, rfWall:12, windTendency:"Out",      notes:"One of MLB's most hitter-friendly; short walls and river wind plays out." },
  { venue:"American Family Field",    team:"Brewers",       abbr:"MIL", div:"NL Central", dome:false, retractable:true,  elevation:635,  surface:"Grass",     hitFactor:1.03, hrFactor:1.05, runFactor:1.03, lf:344, cf:400, rf:345, lfWall:8,  rfWall:8,  windTendency:"Variable", notes:"Retractable roof; slight hitter lean when open." },
  { venue:"Busch Stadium",            team:"Cardinals",     abbr:"STL", div:"NL Central", dome:false, retractable:false, elevation:465,  surface:"Grass",     hitFactor:0.97, hrFactor:0.94, runFactor:0.96, lf:336, cf:400, rf:335, lfWall:8,  rfWall:8,  windTendency:"Variable", notes:"Neutral-to-pitcher lean; suppresses HR slightly below league average." },
  { venue:"PNC Park",                 team:"Pirates",       abbr:"PIT", div:"NL Central", dome:false, retractable:false, elevation:730,  surface:"Grass",     hitFactor:0.96, hrFactor:0.93, runFactor:0.95, lf:325, cf:399, rf:320, lfWall:6,  rfWall:21, windTendency:"In",       notes:"High RF wall offsets short distances; river wind typically plays in." },
  { venue:"Dodger Stadium",           team:"Dodgers",       abbr:"LAD", div:"NL West",    dome:false, retractable:false, elevation:500,  surface:"Grass",     hitFactor:0.97, hrFactor:0.94, runFactor:0.96, lf:330, cf:395, rf:330, lfWall:4,  rfWall:4,  windTendency:"In",       notes:"Marine layer suppresses HR; vast foul territory removes extra outs from offense." },
  { venue:"Oracle Park",              team:"Giants",        abbr:"SF",  div:"NL West",    dome:false, retractable:false, elevation:0,    surface:"Grass",     hitFactor:0.92, hrFactor:0.84, runFactor:0.91, lf:339, cf:399, rf:309, lfWall:8,  rfWall:24, windTendency:"In",       notes:"Cold bay winds devastate HR; McCovey Cove RF quirk benefits LHH." },
  { venue:"Petco Park",               team:"Padres",        abbr:"SD",  div:"NL West",    dome:false, retractable:false, elevation:20,   surface:"Grass",     hitFactor:0.93, hrFactor:0.90, runFactor:0.93, lf:336, cf:396, rf:322, lfWall:8,  rfWall:8,  windTendency:"In",       notes:"Ocean breeze consistently suppresses offense across all categories." },
  { venue:"Chase Field",              team:"Diamondbacks",  abbr:"ARI", div:"NL West",    dome:true,  retractable:true,  elevation:1082, surface:"Grass",     hitFactor:1.05, hrFactor:1.08, runFactor:1.05, lf:330, cf:407, rf:335, lfWall:7,  rfWall:25, windTendency:"Dome",     notes:"High altitude boosts ball carry; retractable roof traps heat in summer months." },
  { venue:"Coors Field",              team:"Rockies",       abbr:"COL", div:"NL West",    dome:false, retractable:false, elevation:5280, surface:"Grass",     hitFactor:1.28, hrFactor:1.35, runFactor:1.31, lf:347, cf:415, rf:350, lfWall:8,  rfWall:8,  windTendency:"Out",      notes:"Most extreme hitter park in MLB - thin air at mile high maximizes carry on everything." },
  { venue:"Fenway Park",              team:"Red Sox",       abbr:"BOS", div:"AL East",    dome:false, retractable:false, elevation:21,   surface:"Grass",     hitFactor:1.06, hrFactor:1.02, runFactor:1.06, lf:310, cf:420, rf:302, lfWall:37, rfWall:5,  windTendency:"Variable", notes:"Green Monster trades LF HR for doubles; Pesky Pole gifts RF HR to LHH." },
  { venue:"Yankee Stadium",           team:"Yankees",       abbr:"NYY", div:"AL East",    dome:false, retractable:false, elevation:55,   surface:"Grass",     hitFactor:1.04, hrFactor:1.13, runFactor:1.06, lf:318, cf:408, rf:314, lfWall:8,  rfWall:8,  windTendency:"Out",      notes:"Short porches heavily favor LHH power; RF porch is a LHH goldmine." },
  { venue:"Rogers Centre",            team:"Blue Jays",     abbr:"TOR", div:"AL East",    dome:true,  retractable:true,  elevation:252,  surface:"AstroTurf", hitFactor:1.04, hrFactor:1.06, runFactor:1.05, lf:328, cf:400, rf:328, lfWall:10, rfWall:10, windTendency:"Dome",     notes:"Hard turf generates extra singles and doubles; enclosed environment boosts offense." },
  { venue:"Oriole Park at Camden Yards",team:"Orioles",     abbr:"BAL", div:"AL East",    dome:false, retractable:false, elevation:20,   surface:"Grass",     hitFactor:1.05, hrFactor:1.08, runFactor:1.05, lf:333, cf:410, rf:318, lfWall:7,  rfWall:7,  windTendency:"Variable", notes:"Hitter-friendly; short RF and summer heat boost HR totals." },
  { venue:"Tropicana Field",          team:"Rays",          abbr:"TB",  div:"AL East",    dome:true,  retractable:false, elevation:15,   surface:"AstroTurf", hitFactor:0.95, hrFactor:0.94, runFactor:0.94, lf:315, cf:404, rf:322, lfWall:11, rfWall:11, windTendency:"Dome",     notes:"Catwalk rings can interfere with fly balls; artificial turf speeds up ground balls." },
  { venue:"Guaranteed Rate Field",    team:"White Sox",     abbr:"CWS", div:"AL Central", dome:false, retractable:false, elevation:595,  surface:"Grass",     hitFactor:1.03, hrFactor:1.07, runFactor:1.04, lf:330, cf:400, rf:335, lfWall:8,  rfWall:8,  windTendency:"Out",      notes:"Wind off Lake Michigan can play out; slight hitter lean overall." },
  { venue:"Progressive Field",        team:"Guardians",     abbr:"CLE", div:"AL Central", dome:false, retractable:false, elevation:650,  surface:"Grass",     hitFactor:0.97, hrFactor:0.96, runFactor:0.97, lf:325, cf:405, rf:325, lfWall:19, rfWall:8,  windTendency:"In",       notes:"Lake Erie winds typically suppress offense; high LF wall kills pull-side HR." },
  { venue:"Comerica Park",            team:"Tigers",        abbr:"DET", div:"AL Central", dome:false, retractable:false, elevation:600,  surface:"Grass",     hitFactor:0.94, hrFactor:0.88, runFactor:0.93, lf:345, cf:420, rf:330, lfWall:7,  rfWall:7,  windTendency:"In",       notes:"Deep CF and LF suppress HR strongly; one of MLB's most pitcher-friendly parks." },
  { venue:"Kauffman Stadium",         team:"Royals",        abbr:"KC",  div:"AL Central", dome:false, retractable:false, elevation:750,  surface:"Grass",     hitFactor:0.96, hrFactor:0.93, runFactor:0.95, lf:330, cf:410, rf:330, lfWall:9,  rfWall:9,  windTendency:"Variable", notes:"Spacious gaps favor pitchers; deep CF and consistent winds suppress fly ball offense." },
  { venue:"Target Field",             team:"Twins",         abbr:"MIN", div:"AL Central", dome:false, retractable:false, elevation:830,  surface:"Grass",     hitFactor:1.02, hrFactor:1.04, runFactor:1.02, lf:339, cf:404, rf:328, lfWall:8,  rfWall:23, windTendency:"Variable", notes:"Slight hitter lean; cold early-season temperatures suppress offense in April." },
  { venue:"Globe Life Field",         team:"Rangers",       abbr:"TEX", div:"AL West",    dome:true,  retractable:true,  elevation:551,  surface:"Grass",     hitFactor:1.06, hrFactor:1.10, runFactor:1.07, lf:329, cf:407, rf:326, lfWall:8,  rfWall:8,  windTendency:"Dome",     notes:"Retractable roof traps Texas summer heat; strong hitter boost since opening." },
  { venue:"Minute Maid Park",         team:"Astros",        abbr:"HOU", div:"AL West",    dome:true,  retractable:true,  elevation:43,   surface:"Grass",     hitFactor:1.05, hrFactor:1.08, runFactor:1.05, lf:315, cf:435, rf:326, lfWall:19, rfWall:7,  windTendency:"Dome",     notes:"Vast CF, but short LF corner boosts LHH HR; enclosed in summer heat." },
  { venue:"T-Mobile Park",            team:"Mariners",      abbr:"SEA", div:"AL West",    dome:false, retractable:true,  elevation:20,   surface:"Grass",     hitFactor:0.94, hrFactor:0.91, runFactor:0.93, lf:331, cf:401, rf:326, lfWall:8,  rfWall:8,  windTendency:"In",       notes:"Marine air suppresses ball flight; one of MLB's better pitcher-friendly parks." },
  { venue:"Angel Stadium",            team:"Angels",        abbr:"LAA", div:"AL West",    dome:false, retractable:false, elevation:160,  surface:"Grass",     hitFactor:0.97, hrFactor:0.95, runFactor:0.96, lf:330, cf:396, rf:330, lfWall:8,  rfWall:8,  windTendency:"Variable", notes:"Neutral park overall; rock pile in CF is a famous quirk but doesn't affect play." },
  { venue:"Oakland Coliseum",         team:"Athletics",     abbr:"OAK", div:"AL West",    dome:false, retractable:false, elevation:5,    surface:"Grass",     hitFactor:0.90, hrFactor:0.87, runFactor:0.89, lf:330, cf:400, rf:330, lfWall:8,  rfWall:8,  windTendency:"In",       notes:"Notorious pitcher's park; bay foul air and massive foul territory kills offense." },
  { venue:"Journey Bank Ballpark",    team:"Athletics",     abbr:"OAK", div:"AL West",    dome:false, retractable:false, elevation:4500, surface:"Grass",     hitFactor:1.04, hrFactor:1.08, runFactor:1.04, lf:328, cf:400, rf:328, lfWall:8,  rfWall:8,  windTendency:"Variable", notes:"High desert altitude provides carry; newer park still accumulating historical data." },
];

interface NflStadiumFactor {
  venue: string; team: string; abbr: string; conf: string; div: string;
  dome: boolean; retractable: boolean; elevation: number; surface: string;
  weatherRisk: string; windFactor: string; scoringFactor: number; notes: string;
}

const NFL_STADIUM_FACTORS: NflStadiumFactor[] = [
  { venue:"Gillette Stadium",          team:"Patriots",     abbr:"NE",  conf:"AFC", div:"AFC East",  dome:false, retractable:false, elevation:30,   surface:"FieldTurf",  weatherRisk:"High",     windFactor:"High",     scoringFactor:0.97, notes:"Cold NE winters suppress passing; wind off Foxboro swamp is unpredictable and strong." },
  { venue:"Highmark Stadium",          team:"Bills",        abbr:"BUF", conf:"AFC", div:"AFC East",  dome:false, retractable:false, elevation:600,  surface:"AstroTurf",  weatherRisk:"High",     windFactor:"High",     scoringFactor:0.95, notes:"Notorious for blizzards and brutal cold; lake-effect snow is a genuine game-changer." },
  { venue:"MetLife Stadium",           team:"Giants/Jets",  abbr:"NYG", conf:"AFC", div:"AFC East",  dome:false, retractable:false, elevation:5,    surface:"FieldTurf",  weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:0.98, notes:"Open bowl creates swirling winds; late-season games are heavily weather-impacted." },
  { venue:"Hard Rock Stadium",         team:"Dolphins",     abbr:"MIA", conf:"AFC", div:"AFC East",  dome:false, retractable:false, elevation:10,   surface:"Grass",      weatherRisk:"Moderate", windFactor:"Low",      scoringFactor:1.02, notes:"Heat and humidity can affect conditioning; partial roof shelters some sections." },
  { venue:"M&T Bank Stadium",          team:"Ravens",       abbr:"BAL", conf:"AFC", div:"AFC North", dome:false, retractable:false, elevation:20,   surface:"Grass",      weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:1.00, notes:"Inner Harbor location creates variable winds; neutral overall scoring environment." },
  { venue:"Acrisure Stadium",          team:"Steelers",     abbr:"PIT", conf:"AFC", div:"AFC North", dome:false, retractable:false, elevation:900,  surface:"Grass",      weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:0.97, notes:"River valley location; cold and wind suppress scoring late in the season." },
  { venue:"Huntington Bank Field",     team:"Browns",       abbr:"CLE", conf:"AFC", div:"AFC North", dome:false, retractable:false, elevation:650,  surface:"Grass",      weatherRisk:"High",     windFactor:"High",     scoringFactor:0.94, notes:"Lake Erie winds among most impactful in NFL; brutal December conditions." },
  { venue:"Paycor Stadium",            team:"Bengals",      abbr:"CIN", conf:"AFC", div:"AFC North", dome:false, retractable:false, elevation:490,  surface:"Grass",      weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:1.00, notes:"Ohio River location; moderate weather effects, no extreme conditions." },
  { venue:"NRG Stadium",               team:"Texans",       abbr:"HOU", conf:"AFC", div:"AFC South", dome:true,  retractable:true,  elevation:43,   surface:"Grass",      weatherRisk:"None",     windFactor:"None",     scoringFactor:1.05, notes:"Indoor environment eliminates weather variable; consistent high-scoring environment." },
  { venue:"Lucas Oil Stadium",         team:"Colts",        abbr:"IND", conf:"AFC", div:"AFC South", dome:true,  retractable:true,  elevation:715,  surface:"FieldTurf",  weatherRisk:"None",     windFactor:"None",     scoringFactor:1.06, notes:"Dome boosts the pass game; one of NFL's highest-scoring indoor venues." },
  { venue:"EverBank Stadium",          team:"Jaguars",      abbr:"JAX", conf:"AFC", div:"AFC South", dome:false, retractable:false, elevation:10,   surface:"Grass",      weatherRisk:"Moderate", windFactor:"Low",      scoringFactor:1.01, notes:"Humid Florida weather; consistent but hot conditions can tire defenses." },
  { venue:"Nissan Stadium",            team:"Titans",       abbr:"TEN", conf:"AFC", div:"AFC South", dome:false, retractable:false, elevation:440,  surface:"Grass",      weatherRisk:"Low",      windFactor:"Low",      scoringFactor:1.00, notes:"Mild Tennessee climate; Cumberland River adds some wind variability." },
  { venue:"Arrowhead Stadium",         team:"Chiefs",       abbr:"KC",  conf:"AFC", div:"AFC West",  dome:false, retractable:false, elevation:750,  surface:"Grass",      weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:1.02, notes:"Loudest stadium in NFL; wind affects kickers significantly in January." },
  { venue:"Allegiant Stadium",         team:"Raiders",      abbr:"LV",  conf:"AFC", div:"AFC West",  dome:true,  retractable:false, elevation:2001, surface:"Grass",      weatherRisk:"None",     windFactor:"None",     scoringFactor:1.07, notes:"Desert dome at high elevation with rollout grass; top offensive scoring environment." },
  { venue:"SoFi Stadium",              team:"Chargers/Rams",abbr:"LAC", conf:"AFC", div:"AFC West",  dome:true,  retractable:false, elevation:100,  surface:"Grass",      weatherRisk:"None",     windFactor:"None",     scoringFactor:1.05, notes:"Modern translucent-roof dome; consistent and strong passing environment." },
  { venue:"Empower Field at Mile High", team:"Broncos",     abbr:"DEN", conf:"AFC", div:"AFC West",  dome:false, retractable:false, elevation:5280, surface:"Grass",      weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:1.04, notes:"Mile High altitude boosts ball carry; thin air aids kickers and deep routes significantly." },
  { venue:"AT&T Stadium",              team:"Cowboys",      abbr:"DAL", conf:"NFC", div:"NFC East",  dome:true,  retractable:true,  elevation:551,  surface:"FieldTurf",  weatherRisk:"None",     windFactor:"None",     scoringFactor:1.08, notes:"Jerry World retractable dome is one of NFL's top offensive environments." },
  { venue:"Lincoln Financial Field",   team:"Eagles",       abbr:"PHI", conf:"NFC", div:"NFC East",  dome:false, retractable:false, elevation:20,   surface:"Grass",      weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:1.00, notes:"Open stadium; late-season cold and wind suppress scoring meaningfully." },
  { venue:"FedExField",                team:"Commanders",   abbr:"WSH", conf:"NFC", div:"NFC East",  dome:false, retractable:false, elevation:150,  surface:"Grass",      weatherRisk:"Low",      windFactor:"Low",      scoringFactor:0.99, notes:"Mid-Atlantic climate; generally mild effects on scoring." },
  { venue:"U.S. Bank Stadium",         team:"Vikings",      abbr:"MIN", conf:"NFC", div:"NFC North", dome:true,  retractable:false, elevation:830,  surface:"FieldTurf",  weatherRisk:"None",     windFactor:"None",     scoringFactor:1.07, notes:"Fixed dome eliminates Minnesota cold; one of best passing environments in the NFL." },
  { venue:"Lambeau Field",             team:"Packers",      abbr:"GB",  conf:"NFC", div:"NFC North", dome:false, retractable:false, elevation:780,  surface:"Grass",      weatherRisk:"High",     windFactor:"High",     scoringFactor:0.93, notes:"Frozen tundra in January; wind and cold devastate visiting passing attacks." },
  { venue:"Soldier Field",             team:"Bears",        abbr:"CHI", conf:"NFC", div:"NFC North", dome:false, retractable:false, elevation:595,  surface:"Grass",      weatherRisk:"High",     windFactor:"High",     scoringFactor:0.94, notes:"Lake Michigan wind is one of the most impactful in the NFL; late-season = run-heavy." },
  { venue:"Ford Field",                team:"Lions",        abbr:"DET", conf:"NFC", div:"NFC North", dome:true,  retractable:false, elevation:600,  surface:"FieldTurf",  weatherRisk:"None",     windFactor:"None",     scoringFactor:1.06, notes:"Fixed dome; fast turf and indoor control make it a pass-friendly environment." },
  { venue:"Mercedes-Benz Stadium",     team:"Falcons",      abbr:"ATL", conf:"NFC", div:"NFC South", dome:true,  retractable:true,  elevation:1050, surface:"FieldTurf",  weatherRisk:"None",     windFactor:"None",     scoringFactor:1.06, notes:"Unique petal roof design; retractable and enclosed. Fast turf boosts scoring." },
  { venue:"Bank of America Stadium",   team:"Panthers",     abbr:"CAR", conf:"NFC", div:"NFC South", dome:false, retractable:false, elevation:750,  surface:"Grass",      weatherRisk:"Low",      windFactor:"Low",      scoringFactor:1.00, notes:"Charlotte climate is mild; open stadium but rarely severely weather-impacted." },
  { venue:"Caesars Superdome",         team:"Saints",       abbr:"NO",  conf:"NFC", div:"NFC South", dome:true,  retractable:false, elevation:3,    surface:"FieldTurf",  weatherRisk:"None",     windFactor:"None",     scoringFactor:1.05, notes:"Classic dome; fast turf and enclosed environment are consistent passing boosters." },
  { venue:"Raymond James Stadium",     team:"Buccaneers",   abbr:"TB",  conf:"NFC", div:"NFC South", dome:false, retractable:false, elevation:15,   surface:"Grass",      weatherRisk:"Low",      windFactor:"Low",      scoringFactor:1.02, notes:"Florida warmth and humidity; rarely severe weather outside hurricane season." },
  { venue:"State Farm Stadium",        team:"Cardinals",    abbr:"ARI", conf:"NFC", div:"NFC West",  dome:true,  retractable:true,  elevation:1082, surface:"Grass",      weatherRisk:"None",     windFactor:"None",     scoringFactor:1.06, notes:"Retractable roof and rollout grass field; consistent indoor conditions." },
  { venue:"Levi's Stadium",            team:"49ers",        abbr:"SF",  conf:"NFC", div:"NFC West",  dome:false, retractable:false, elevation:30,   surface:"Grass",      weatherRisk:"Low",      windFactor:"Moderate", scoringFactor:1.01, notes:"Bay Area wind can affect kickers; overall mild climate." },
  { venue:"Lumen Field",               team:"Seahawks",     abbr:"SEA", conf:"NFC", div:"NFC West",  dome:false, retractable:false, elevation:20,   surface:"FieldTurf",  weatherRisk:"Moderate", windFactor:"Moderate", scoringFactor:0.99, notes:"12th Man crowd noise disrupts visiting OL; rain and wind add further elements." },
  { venue:"SoFi Stadium",              team:"Rams",         abbr:"LAR", conf:"NFC", div:"NFC West",  dome:true,  retractable:false, elevation:100,  surface:"Grass",      weatherRisk:"None",     windFactor:"None",     scoringFactor:1.05, notes:"Modern translucent dome; consistent offensive environment for both teams." },
];

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
                  pkToVenue[g.gamePk] = normalizeVenueName(g.venue.name) ?? g.venue.name;
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

      // 2. Fetch play-by-play for each game — cap at 60 most recent games
      // (full feed ~870KB each; 60 games processed at concurrency 20 finishes in ~20s)
      const recentPks = gamePks.slice(-60);

      // ── Resolve venue names for each gamePk ────────────────────────────────
      const pkToVenueSpray: Record<number, string> = {};
      const PK_CHUNK = 50;
      for (let i = 0; i < recentPks.length; i += PK_CHUNK) {
        const chunk = recentPks.slice(i, i + PK_CHUNK);
        try {
          const schedRes = await axios.get(
            `https://statsapi.mlb.com/api/v1/schedule?gamePks=${chunk.join(",")}&hydrate=venue&fields=dates,games,gamePk,venue,name`,
            { timeout: 10000, headers: AXIOS_HEADERS }
          );
          for (const d of (schedRes.data?.dates ?? [])) {
            for (const g of (d.games ?? [])) {
              if (g.gamePk && g.venue?.name) pkToVenueSpray[g.gamePk] = normalizeVenueName(g.venue.name) ?? g.venue.name;
            }
          }
        } catch { /* non-fatal — venue stays undefined */ }
      }

      const PBP_CONCURRENCY = 20;
      const hits: any[] = [];

      for (let i = 0; i < recentPks.length; i += PBP_CONCURRENCY) {
        const chunk = recentPks.slice(i, i + PBP_CONCURRENCY);
        const pbpResults = await Promise.allSettled(
          chunk.map(pk =>
            axios.get(
              `https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`,
              { timeout: 12000, headers: AXIOS_HEADERS }
            ).then(r => ({ pk, data: r.data }))
          )
        );

        for (const r of pbpResults) {
          if (r.status !== "fulfilled") continue;
          const { pk, data } = r.value;
          const venueName = pkToVenueSpray[pk] ?? null;
          const allPlays = data?.liveData?.plays?.allPlays ?? [];
          for (const play of allPlays) {
            // Must be this batter
            if (play.matchup?.batter?.id !== mlbamId) continue;
            const event = play.result?.event ?? "";
            // Scan playEvents for hitData
            for (const ev of (play.playEvents ?? [])) {
              const hd = ev.hitData;
              // Use != null instead of falsy check so coordX=0 is not skipped
              if (!hd?.coordinates || hd.coordinates.coordX == null) continue;
              hits.push({
                x:          hd.coordinates.coordX,
                y:          hd.coordinates.coordY,
                event:      event,
                trajectory: hd.trajectory ?? "",
                speed:      hd.launchSpeed ?? null,
                angle:      hd.launchAngle ?? null,
                distance:   hd.totalDistance ?? null,
                venue:      venueName,
              });
            }
          }
        }
      }

      const result = { hits, total: hits.length };
      // Only cache if we actually got hits — don't cache 0-hit results
      // (wrong mlbamId or network glitch) to avoid stale empty charts
      if (hits.length > 0) setCache(parkCache, cacheKey, result);
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

  // ── 7. Team List — /api/intel/teams/:sport ─────────────────────────────────
  // Returns all teams for a sport so the client can do local filtering
  app.get("/api/intel/teams/:sport", async (req, res) => {
    try {
      const sportUp = req.params.sport.toUpperCase() as Sport;
      const mapping = ESPN_SPORT_MAP[sportUp];
      if (!mapping) return res.status(400).json({ error: `Unsupported sport: ${req.params.sport}` });

      const cacheKey = `teams:${sportUp}`;
      const cached = getCache(parkCache, cacheKey, 24 * 60 * 60 * 1000); // 24h cache
      if (cached) return res.json(cached);

      const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.sport}/${mapping.league}/teams?limit=50`;
      const r = await axios.get(url, { timeout: 8000, headers: AXIOS_HEADERS });
      const rawTeams = r.data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
      const teams = rawTeams.map((t: any) => ({
        name:      t.team?.displayName     ?? t.team?.name ?? "",
        shortName: t.team?.shortDisplayName ?? t.team?.name ?? "",
        abbr:      t.team?.abbreviation     ?? "",
        logo:      t.team?.logos?.[0]?.href ?? null,
        color:     t.team?.color            ?? null,
      })).filter((t: any) => t.abbr);

      teams.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setCache(parkCache, cacheKey, teams);
      return res.json(teams);
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} teams error:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Stadium Factors — /api/intel/stadium-factors ──────────────────────
  // Returns static + semi-static park factor data for all MLB/NFL stadiums.
  // MLB: hit factor, HR factor, run factor, dimensions, elevation, surface
  // NFL: dome/open, surface, weather risk, elevation
  app.get("/api/intel/stadium-factors", (_req, res) => {
    res.json({ mlb: MLB_STADIUM_FACTORS, nfl: NFL_STADIUM_FACTORS });
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
