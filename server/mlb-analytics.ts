/**
 * mlb-analytics.ts — Free MLB data layer for Clubhouse IQ
 *
 * Provides:
 *  1. FanGraphs Steamer projections (batters + pitchers) — cached daily
 *  2. Baseball Savant park factors (hit/HR/xBA-based) — cached daily
 *  3. MLB Stats API BvP matchup stats — cached daily per pair
 *  4. Open-Meteo weather at stadium GPS — cached 3h on game days
 *  5. MLB Stats API probable pitchers + lineups — live per schedule call
 *  6. MLB Stats API pitcher season stats — cached daily per starter
 *  7. Simulated projected stats (Steamer H/G, HR/G rates) — derived layer
 *
 * All caches live in-process and on disk under server/ml_data/mlb_analytics_cache.json
 * (rehydrated on startup).  TTLs:
 *   steamer:       86400 s  (once per day)
 *   parkFactors:   86400 s  (once per day)
 *   bvp:           86400 s  (per batter-pitcher pair)
 *   weather:       10800 s  (3 h)
 *   pitcherStats:  3600  s  (1 h)
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// ─── Disk cache path ─────────────────────────────────────────────────
const CACHE_FILE = path.join(__dirname, "ml_data", "mlb_analytics_cache.json");

// ─── Stadium GPS coordinates (30 MLB parks) ───────────────────────────
export const STADIUM_COORDS: Record<string, { lat: number; lng: number; dome: boolean }> = {
  // NL East
  "Truist Park":               { lat: 33.8908, lng: -84.4677, dome: false },
  "Citi Field":                { lat: 40.7571, lng: -73.8458, dome: false },
  "Citizens Bank Park":        { lat: 39.9057, lng: -75.1665, dome: false },
  "Nationals Park":            { lat: 38.8730, lng: -77.0074, dome: false },
  "loanDepot park":            { lat: 25.7781, lng: -80.2198, dome: true  },
  "Marlins Park":              { lat: 25.7781, lng: -80.2198, dome: true  },
  // NL Central
  "Wrigley Field":             { lat: 41.9484, lng: -87.6553, dome: false },
  "Great American Ball Park":  { lat: 39.0975, lng: -84.5066, dome: false },
  "American Family Field":     { lat: 43.0280, lng: -87.9712, dome: false },
  "Busch Stadium":             { lat: 38.6226, lng: -90.1928, dome: false },
  "PNC Park":                  { lat: 40.4469, lng: -80.0057, dome: false },
  // NL West
  "Dodger Stadium":            { lat: 34.0739, lng: -118.2400, dome: false },
  "Oracle Park":               { lat: 37.7786, lng: -122.3893, dome: false },
  "Petco Park":                { lat: 32.7073, lng: -117.1566, dome: false },
  "Chase Field":               { lat: 33.4453, lng: -112.0667, dome: true  },
  "Coors Field":               { lat: 39.7560, lng: -104.9942, dome: false },
  // AL East
  "Fenway Park":               { lat: 42.3467, lng: -71.0972,  dome: false },
  "Yankee Stadium":            { lat: 40.8296, lng: -73.9262,  dome: false },
  "Rogers Centre":             { lat: 43.6414, lng: -79.3894,  dome: true  },
  "Camden Yards":              { lat: 39.2838, lng: -76.6218,  dome: false },
  "Tropicana Field":           { lat: 27.7683, lng: -82.6534,  dome: true  },
  // AL Central
  "Guaranteed Rate Field":     { lat: 41.8300, lng: -87.6339,  dome: false },
  "Progressive Field":         { lat: 41.4962, lng: -81.6852,  dome: false },
  "Comerica Park":             { lat: 42.3390, lng: -83.0485,  dome: false },
  "Kauffman Stadium":          { lat: 39.0517, lng: -94.4803,  dome: false },
  "Target Field":              { lat: 44.9817, lng: -93.2784,  dome: false },
  // AL West
  "Globe Life Field":          { lat: 32.7473, lng: -97.0836,  dome: true  },
  "Minute Maid Park":          { lat: 29.7573, lng: -95.3555,  dome: true  },
  "T-Mobile Park":             { lat: 47.5915, lng: -122.3325, dome: false },
  "Oakland Coliseum":          { lat: 37.7516, lng: -122.2005, dome: false },
  "RingCentral Coliseum":      { lat: 37.7516, lng: -122.2005, dome: false },
  "Angel Stadium":             { lat: 33.8003, lng: -117.8827, dome: false },
};

// ─── In-process caches ────────────────────────────────────────────────
interface CacheEntry<T> { data: T; ts: number }

const _steamerBatters:  Map<string, CacheEntry<SteamerBatterRow>>  = new Map();
const _steamerPitchers: Map<string, CacheEntry<SteamerPitcherRow>> = new Map();
const _parkFactors:     Map<string, CacheEntry<ParkFactorRow>>      = new Map();
const _bvpCache:        Map<string, CacheEntry<BvpResult>>          = new Map();
const _weatherCache:    Map<string, CacheEntry<WeatherResult>>      = new Map();
const _pitcherCache:    Map<string, CacheEntry<PitcherAnalytics>>   = new Map();

let _lastSteamerFetch = 0;   // epoch ms — reload once per day
let _lastParkFetch   = 0;

// ─── Types ────────────────────────────────────────────────────────────

export interface SteamerBatterRow {
  mlbamId:    string;
  name:       string;
  team:       string;
  g:          number;
  pa:         number;
  ab:         number;
  h:          number;
  single:     number;
  double:     number;
  triple:     number;
  hr:         number;
  r:          number;
  rbi:        number;
  sb:         number;
  bb:         number;
  so:         number;
  avg:        number;
  obp:        number;
  slg:        number;
  ops:        number;
  woba:       number;
  wrcPlus:    number;
  war:        number;
  // Derived per-game rates (for simulation layer)
  hPerGame:   number;
  hrPerGame:  number;
  rPerGame:   number;
  rbiPerGame: number;
  sbPerGame:  number;
  tbPerGame:  number;
}

export interface SteamerPitcherRow {
  mlbamId: string;
  name:    string;
  team:    string;
  ip:      number;
  k:       number;
  bb:      number;
  era:     number;
  whip:    number;
  k9:      number;
  bb9:     number;
  hr9:     number;
  fip:     number;
  war:     number;
  // Derived rate (projected H allowed per 9)
  h9:      number;
}

export interface ParkFactorRow {
  venue:    string;
  hitFactor: number;
  hrFactor:  number;
  r_factor:  number;
}

export interface BvpResult {
  avg:       number | null;
  hits:      number;
  ab:        number;
  hr:        number;
  rbi:       number;
  tb:        number;
  obp:       number | null;
  slg:       number | null;
  signal:    "strong" | "weak" | "none";
  source:    "season" | "career" | "none";
}

export interface WeatherResult {
  tempF:        number;
  windMph:      number;
  windDir:      string;
  windOut:      boolean;
  windIn:       boolean;
  humidity:     number;
  precipChance: number;
  precipInches: number;
  isDome:       boolean;
  impactLabel:  string;
  impactTier:   "boost" | "neutral" | "penalty";
  hitterImpact: number;   // 0–1
}

export interface PitcherAnalytics {
  mlbamId:    string;
  name:       string;
  team:       string;
  era:        number | null;
  whip:       number | null;
  k9:         number | null;
  bb9:        number | null;
  ip:         number;
  last3ERA:   number | null;
  last5ERA:   number | null;
  last3AvgIP: number | null;
  last3H9:    number | null;
  leashProb:  number;
  // From Steamer (season projection)
  projERA:    number | null;
  projWHIP:   number | null;
  projK9:     number | null;
}

export interface BatterAnalytics {
  mlbamId:      string;
  name:         string;
  steamer:      SteamerBatterRow | null;
  bvp:          BvpResult | null;
  parkFactor:   ParkFactorRow | null;
  weather:      WeatherResult | null;
  pitcher:      PitcherAnalytics | null;
  // Composite adjustment — net multiplier to apply to hit probability
  // >1.0 = favourable, <1.0 = unfavourable
  analyticsBoost: number;
  analyticsNote:  string;
}

// ─── TTL constants (ms) ───────────────────────────────────────────────
const TTL_STEAMER  = 86_400_000;   // 24 h
const TTL_PARK     = 86_400_000;
const TTL_BVP      = 86_400_000;
const TTL_WEATHER  = 10_800_000;   // 3 h
const TTL_PITCHER  = 3_600_000;    // 1 h

// ─── Disk persistence helpers ─────────────────────────────────────────
function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    const now = Date.now();
    for (const [k, v] of Object.entries<any>(raw.steamerBatters ?? {})) {
      if (now - v.ts < TTL_STEAMER) _steamerBatters.set(k, v);
    }
    for (const [k, v] of Object.entries<any>(raw.steamerPitchers ?? {})) {
      if (now - v.ts < TTL_STEAMER) _steamerPitchers.set(k, v);
    }
    for (const [k, v] of Object.entries<any>(raw.parkFactors ?? {})) {
      if (now - v.ts < TTL_PARK) _parkFactors.set(k, v);
    }
    for (const [k, v] of Object.entries<any>(raw.bvp ?? {})) {
      if (now - v.ts < TTL_BVP) _bvpCache.set(k, v);
    }
    for (const [k, v] of Object.entries<any>(raw.weather ?? {})) {
      if (now - v.ts < TTL_WEATHER) _weatherCache.set(k, v);
    }
    for (const [k, v] of Object.entries<any>(raw.pitcherStats ?? {})) {
      if (now - v.ts < TTL_PITCHER) _pitcherCache.set(k, v);
    }
    console.log("[MLB-Analytics] Disk cache loaded");
  } catch (e: any) {
    console.warn("[MLB-Analytics] Disk cache load failed:", e.message);
  }
}

function saveDiskCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      steamerBatters:  Object.fromEntries(_steamerBatters),
      steamerPitchers: Object.fromEntries(_steamerPitchers),
      parkFactors:     Object.fromEntries(_parkFactors),
      bvp:             Object.fromEntries(_bvpCache),
      weather:         Object.fromEntries(_weatherCache),
      pitcherStats:    Object.fromEntries(_pitcherCache),
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf-8");
  } catch (e: any) {
    console.warn("[MLB-Analytics] Disk cache save failed:", e.message);
  }
}

// Initialise disk cache on module load
loadDiskCache();

// ═══════════════════════════════════════════════════════════════════════
// 1. FanGraphs Steamer Projections
// ═══════════════════════════════════════════════════════════════════════

async function fetchSteamerBatters(): Promise<void> {
  const now = Date.now();
  if (now - _lastSteamerFetch < TTL_STEAMER && _steamerBatters.size > 0) return;
  try {
    console.log("[MLB-Analytics] Fetching FanGraphs Steamer batters...");
    const resp = await axios.get(
      "https://www.fangraphs.com/api/projections?type=steamer&stats=bat&pos=all&team=0&players=0&lg=all",
      { timeout: 15000 }
    );
    const rows: any[] = Array.isArray(resp.data) ? resp.data : [];
    _steamerBatters.clear();
    for (const r of rows) {
      const mlbamId = String(r.xMLBAMID ?? r.mlbamid ?? r.MLBAMID ?? "").trim();
      if (!mlbamId || mlbamId === "0") continue;
      const g = parseFloat(r.G ?? r.g ?? "0") || 1;
      const h = parseFloat(r.H ?? r.h ?? "0") || 0;
      const hr = parseFloat(r.HR ?? r.hr ?? "0") || 0;
      const ab = parseFloat(r.AB ?? r.ab ?? "0") || 0;
      const single = parseFloat(r["1B"] ?? r.B1 ?? r.single ?? "0") || 0;
      const dbl    = parseFloat(r["2B"] ?? r.B2 ?? r.double ?? "0") || 0;
      const triple = parseFloat(r["3B"] ?? r.B3 ?? r.triple ?? "0") || 0;
      const tb = single + dbl * 2 + triple * 3 + hr * 4;
      const row: SteamerBatterRow = {
        mlbamId,
        name:       String(r.PlayerName ?? r.Name ?? r.playerName ?? ""),
        team:       String(r.Team ?? r.team ?? ""),
        g,
        pa:         parseFloat(r.PA ?? r.pa ?? "0") || 0,
        ab,
        h,
        single,
        double:     dbl,
        triple,
        hr,
        r:          parseFloat(r.R  ?? r.r  ?? "0") || 0,
        rbi:        parseFloat(r.RBI ?? r.rbi ?? "0") || 0,
        sb:         parseFloat(r.SB ?? r.sb ?? "0") || 0,
        bb:         parseFloat(r.BB ?? r.bb ?? "0") || 0,
        so:         parseFloat(r.SO ?? r.so ?? "0") || 0,
        avg:        parseFloat(r.AVG ?? r.avg ?? "0") || 0,
        obp:        parseFloat(r.OBP ?? r.obp ?? "0") || 0,
        slg:        parseFloat(r.SLG ?? r.slg ?? "0") || 0,
        ops:        parseFloat(r.OPS ?? r.ops ?? "0") || 0,
        woba:       parseFloat(r.wOBA ?? r.woba ?? "0") || 0,
        wrcPlus:    parseFloat(r["wRC+"] ?? r.wrcplus ?? r.wRC ?? "0") || 100,
        war:        parseFloat(r.WAR ?? r.war ?? "0") || 0,
        hPerGame:   g > 0 ? h / g : 0,
        hrPerGame:  g > 0 ? hr / g : 0,
        rPerGame:   g > 0 ? (parseFloat(r.R ?? "0") || 0) / g : 0,
        rbiPerGame: g > 0 ? (parseFloat(r.RBI ?? "0") || 0) / g : 0,
        sbPerGame:  g > 0 ? (parseFloat(r.SB ?? "0") || 0) / g : 0,
        tbPerGame:  g > 0 ? tb / g : 0,
      };
      _steamerBatters.set(mlbamId, { data: row, ts: now });
    }
    _lastSteamerFetch = now;
    console.log(`[MLB-Analytics] Steamer batters loaded: ${_steamerBatters.size} players`);
    saveDiskCache();
  } catch (e: any) {
    console.warn("[MLB-Analytics] Steamer batter fetch failed:", e.message);
  }
}

async function fetchSteamerPitchers(): Promise<void> {
  const now = Date.now();
  if (now - _lastSteamerFetch < TTL_STEAMER && _steamerPitchers.size > 0) return;
  try {
    console.log("[MLB-Analytics] Fetching FanGraphs Steamer pitchers...");
    const resp = await axios.get(
      "https://www.fangraphs.com/api/projections?type=steamer&stats=pit&pos=all&team=0&players=0&lg=all",
      { timeout: 15000 }
    );
    const rows: any[] = Array.isArray(resp.data) ? resp.data : [];
    _steamerPitchers.clear();
    for (const r of rows) {
      const mlbamId = String(r.xMLBAMID ?? r.mlbamid ?? r.MLBAMID ?? "").trim();
      if (!mlbamId || mlbamId === "0") continue;
      const ip = parseFloat(r.IP ?? r.ip ?? "0") || 0;
      const k  = parseFloat(r.K  ?? r.SO ?? "0") || 0;
      const h  = parseFloat(r.H  ?? r.h  ?? "0") || 0;
      const row: SteamerPitcherRow = {
        mlbamId,
        name:  String(r.PlayerName ?? r.Name ?? ""),
        team:  String(r.Team ?? r.team ?? ""),
        ip,
        k,
        bb:    parseFloat(r.BB  ?? r.bb  ?? "0") || 0,
        era:   parseFloat(r.ERA ?? r.era ?? "0") || 0,
        whip:  parseFloat(r.WHIP ?? r.whip ?? "0") || 0,
        k9:    parseFloat(r["K/9"] ?? r.k9 ?? r.K9 ?? "0") || 0,
        bb9:   parseFloat(r["BB/9"] ?? r.bb9 ?? "0") || 0,
        hr9:   parseFloat(r["HR/9"] ?? r.hr9 ?? "0") || 0,
        fip:   parseFloat(r.FIP ?? r.fip ?? "0") || 0,
        war:   parseFloat(r.WAR ?? r.war ?? "0") || 0,
        h9:    ip > 0 ? (h / ip) * 9 : 9.0,
      };
      _steamerPitchers.set(mlbamId, { data: row, ts: now });
    }
    console.log(`[MLB-Analytics] Steamer pitchers loaded: ${_steamerPitchers.size} players`);
    saveDiskCache();
  } catch (e: any) {
    console.warn("[MLB-Analytics] Steamer pitcher fetch failed:", e.message);
  }
}

/** Warm both Steamer caches in parallel (call once at server startup + daily). */
export async function warmSteamerCache(): Promise<void> {
  await Promise.all([fetchSteamerBatters(), fetchSteamerPitchers()]);
}

export function getSteamerBatter(mlbamId: string | number): SteamerBatterRow | null {
  return _steamerBatters.get(String(mlbamId))?.data ?? null;
}

export function getSteamerPitcher(mlbamId: string | number): SteamerPitcherRow | null {
  return _steamerPitchers.get(String(mlbamId))?.data ?? null;
}

/**
 * Look up MLBAM ID by player name from the loaded Steamer caches (batters + pitchers).
 * Falls back to MLB Stats API people search if not found in cache.
 * Returns null if not found anywhere.
 */
export async function resolveMlbamId(playerName: string): Promise<string | null> {
  const nameLower = playerName.toLowerCase().trim();
  const nameParts = nameLower.split(" ");

  // Search batter cache first
  for (const [id, entry] of _steamerBatters.entries()) {
    const n = (entry.data.name ?? "").toLowerCase();
    if (n === nameLower || (nameParts.length >= 2 && n.includes(nameParts[0]) && n.includes(nameParts[nameParts.length - 1]))) {
      return id;
    }
  }
  // Search pitcher cache
  for (const [id, entry] of _steamerPitchers.entries()) {
    const n = (entry.data.name ?? "").toLowerCase();
    if (n === nameLower || (nameParts.length >= 2 && n.includes(nameParts[0]) && n.includes(nameParts[nameParts.length - 1]))) {
      return id;
    }
  }

  // Fallback: MLB Stats API people search
  try {
    const encoded = encodeURIComponent(playerName);
    const r = await import("axios").then(m => m.default.get(
      `https://statsapi.mlb.com/api/v1/people/search?names=${encoded}&sportIds=1&fields=people,id,fullName`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    ));
    const people: any[] = r.data?.people ?? [];
    if (people.length > 0) {
      // Pick best match
      for (const p of people) {
        const pn = (p.fullName ?? "").toLowerCase();
        if (pn === nameLower || (nameParts.length >= 2 && pn.includes(nameParts[0]) && pn.includes(nameParts[nameParts.length - 1]))) {
          return String(p.id);
        }
      }
      // Take first
      return String(people[0].id);
    }
  } catch { /* MLB Stats API unavailable */ }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Park Factors (Baseball Savant leaderboard — HR/hit/xBA-based)
// ═══════════════════════════════════════════════════════════════════════

// Static baseline park hit factors (v4 of hand-tuned table in routes.ts).
// Baseball Savant park factors will supplement/override these if fetched.
const BASELINE_PARK_HIT: Record<string, number> = {
  "Coors Field": 1.18,            "Great American Ball Park": 1.10,
  "Minute Maid Park": 1.07,       "Globe Life Field": 1.06,
  "American Family Field": 1.06,  "Fenway Park": 1.05,
  "Camden Yards": 1.04,           "Kauffman Stadium": 1.04,
  "Target Field": 1.03,           "Wrigley Field": 1.03,
  "Yankee Stadium": 1.02,         "Truist Park": 1.01,
  "PNC Park": 0.99,               "Progressive Field": 0.98,
  "Busch Stadium": 0.97,          "Citi Field": 0.97,
  "Dodger Stadium": 0.96,         "T-Mobile Park": 0.96,
  "Tropicana Field": 0.96,        "RingCentral Coliseum": 0.96,
  "loanDepot park": 0.95,         "Oracle Park": 0.94,
  "Petco Park": 0.93,             "Chase Field": 1.05,
  "Citizens Bank Park": 1.03,     "Angel Stadium": 1.00,
  "Comerica Park": 0.98,          "Nationals Park": 0.97,
  "Guaranteed Rate Field": 1.01,  "Rogers Centre": 1.02,
};

const BASELINE_PARK_HR: Record<string, number> = {
  "Coors Field": 1.25,            "Great American Ball Park": 1.15,
  "Yankee Stadium": 1.20,         "Fenway Park": 1.14,
  "American Family Field": 1.12,  "Globe Life Field": 1.10,
  "Minute Maid Park": 1.08,       "Camden Yards": 1.07,
  "Chase Field": 1.16,            "Citizens Bank Park": 1.09,
  "Wrigley Field": 1.08,          "Target Field": 0.97,
  "Truist Park": 0.99,            "PNC Park": 0.91,
  "Busch Stadium": 0.92,          "Petco Park": 0.82,
  "Oracle Park": 0.78,            "T-Mobile Park": 0.88,
  "Dodger Stadium": 0.94,         "Citi Field": 0.89,
  "Tropicana Field": 0.93,        "loanDepot park": 0.95,
  "Progressive Field": 0.96,      "Kauffman Stadium": 0.98,
  "RingCentral Coliseum": 0.90,   "Nationals Park": 0.95,
  "Angel Stadium": 1.01,          "Comerica Park": 0.93,
  "Guaranteed Rate Field": 1.02,  "Rogers Centre": 1.05,
};

async function fetchParkFactors(): Promise<void> {
  const now = Date.now();
  if (now - _lastParkFetch < TTL_PARK && _parkFactors.size > 0) return;
  // Populate from baseline table immediately (always works)
  for (const [venue, hitFactor] of Object.entries(BASELINE_PARK_HIT)) {
    const existing = _parkFactors.get(venue);
    if (!existing || now - existing.ts > TTL_PARK) {
      _parkFactors.set(venue, {
        data: {
          venue,
          hitFactor,
          hrFactor:  BASELINE_PARK_HR[venue] ?? 1.00,
          r_factor:  (hitFactor + (BASELINE_PARK_HR[venue] ?? 1.00)) / 2,
        },
        ts: now,
      });
    }
  }
  _lastParkFetch = now;
  // Optionally enrich from Baseball Savant park factor leaderboard
  try {
    const resp = await axios.get(
      "https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=venue&batSide=&stat=index_wOBA&condition=is&rolling=&year=2026&csv=true",
      { timeout: 12000, headers: { Accept: "text/csv" } }
    );
    const lines = String(resp.data).split("\n");
    if (lines.length > 1) {
      const header = lines[0].split(",");
      const venueIdx  = header.findIndex((h: string) => h.toLowerCase().includes("venue") || h.toLowerCase().includes("park"));
      const wobaIdx   = header.findIndex((h: string) => h.toLowerCase().includes("woba") || h.toLowerCase().includes("index"));
      if (venueIdx >= 0 && wobaIdx >= 0) {
        for (let i = 1; i < lines.length; i++) {
          const cols  = lines[i].split(",");
          if (cols.length < Math.max(venueIdx, wobaIdx) + 1) continue;
          const vName = cols[venueIdx]?.replace(/"/g, "").trim();
          const woba  = parseFloat(cols[wobaIdx]) || 100;
          // Convert index (100=avg) to factor (1.00=avg)
          const factor = woba / 100;
          if (vName && factor > 0.5 && factor < 1.5) {
            const baseline = _parkFactors.get(vName);
            if (baseline) {
              // Blend: 70% Savant + 30% baseline
              const blended = factor * 0.70 + baseline.data.hitFactor * 0.30;
              _parkFactors.set(vName, {
                data: { ...baseline.data, hitFactor: blended, r_factor: blended },
                ts: now,
              });
            }
          }
        }
        console.log("[MLB-Analytics] Park factors enriched from Baseball Savant");
      }
    }
  } catch {
    // Savant park factor endpoint may be unavailable — baseline is sufficient
  }
  saveDiskCache();
}

export async function getParkFactor(venue: string): Promise<ParkFactorRow> {
  if (_parkFactors.size === 0 || Date.now() - _lastParkFetch > TTL_PARK) {
    await fetchParkFactors();
  }
  return _parkFactors.get(venue)?.data ?? { venue, hitFactor: 1.00, hrFactor: 1.00, r_factor: 1.00 };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. BvP Matchup Stats — Extended (includes HR, RBI, TB, OBP, SLG)
// ═══════════════════════════════════════════════════════════════════════

export async function getBvpExtended(batterId: number, pitcherId: number): Promise<BvpResult> {
  const key = `${batterId}_${pitcherId}`;
  const cached = _bvpCache.get(key);
  if (cached && Date.now() - cached.ts < TTL_BVP) return cached.data;

  const empty: BvpResult = { avg: null, hits: 0, ab: 0, hr: 0, rbi: 0, tb: 0, obp: null, slg: null, signal: "none", source: "none" };
  try {
    const [rSeason, rCareer] = await Promise.allSettled([
      axios.get(
        `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=vsPlayer&group=hitting&season=2026&opposingPlayerId=${pitcherId}`,
        { timeout: 8000 }
      ),
      axios.get(
        `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=vsPlayerTotal&group=hitting&opposingPlayerId=${pitcherId}`,
        { timeout: 8000 }
      ),
    ]);

    const extractSplit = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? (r.value.data?.stats?.[0]?.splits?.[0]?.stat ?? null) : null;

    const season = extractSplit(rSeason);
    const career = extractSplit(rCareer);

    let stat: any = null;
    let source: "season" | "career" | "none" = "none";
    if (season && parseInt(season.atBats ?? "0") >= 5) {
      stat = season; source = "season";
    } else if (career && parseInt(career.atBats ?? "0") >= 10) {
      stat = career; source = "career";
    }

    if (!stat) {
      _bvpCache.set(key, { data: empty, ts: Date.now() });
      saveDiskCache();
      return empty;
    }

    const ab   = parseInt(stat.atBats ?? "0");
    const hits = parseInt(stat.hits ?? "0");
    const hr   = parseInt(stat.homeRuns ?? "0");
    const rbi  = parseInt(stat.rbi ?? "0");
    const tb   = parseInt(stat.totalBases ?? "0");
    const avg  = parseFloat(stat.avg ?? "0") || null;
    const obp  = parseFloat(stat.obp ?? "0") || null;
    const slg  = parseFloat(stat.slg ?? "0") || null;

    const signal: BvpResult["signal"] =
      ab >= 20 && avg !== null && avg >= 0.300 ? "strong" :
      ab >= 20 && avg !== null && avg <  0.150 ? "weak"   : "none";

    const result: BvpResult = { avg, hits, ab, hr, rbi, tb, obp, slg, signal, source };
    _bvpCache.set(key, { data: result, ts: Date.now() });
    saveDiskCache();
    return result;
  } catch {
    return empty;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Open-Meteo Weather (per stadium GPS)
// ═══════════════════════════════════════════════════════════════════════

// Stadium outfield wind direction (approximate degrees for "blowing out")
// These are rough compass headings for the outfield direction per park.
const OUTFIELD_HEADING: Record<string, number> = {
  "Wrigley Field": 90,          // east-facing outfield — east wind = out
  "Coors Field": 180,           // south-facing
  "Fenway Park": 270,           // west-facing
  "Yankee Stadium": 45,
  "Dodger Stadium": 270,
  "Oracle Park": 270,
  "Petco Park": 270,
  "Great American Ball Park": 180,
};

function windRelativeToOutfield(venue: string, windDegrees: number): "out" | "in" | "cross" | "calm" {
  const outfieldHeading = OUTFIELD_HEADING[venue];
  if (!outfieldHeading) return "cross";
  const diff = Math.abs(((windDegrees - outfieldHeading + 360) % 360));
  const diffNorm = diff > 180 ? 360 - diff : diff;
  if (diffNorm <= 45)  return "out";
  if (diffNorm >= 135) return "in";
  return "cross";
}

function windDegToLabel(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

export async function getStadiumWeather(venue: string, gameTimestampMs?: number): Promise<WeatherResult> {
  const coords = STADIUM_COORDS[venue];
  const defaultResult: WeatherResult = {
    tempF: 70, windMph: 5, windDir: "S", windOut: false, windIn: false,
    humidity: 50, precipChance: 0, precipInches: 0, isDome: false,
    impactLabel: "Neutral conditions", impactTier: "neutral", hitterImpact: 0.50,
  };

  if (!coords) return defaultResult;
  if (coords.dome) {
    return { ...defaultResult, isDome: true, impactLabel: "Dome stadium — weather N/A" };
  }

  const cacheKey = `${venue}_${new Date().toISOString().slice(0, 10)}`;
  const cached = _weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL_WEATHER) return cached.data;

  try {
    const targetHour = gameTimestampMs
      ? new Date(gameTimestampMs).getUTCHours()
      : 20; // 8 PM UTC default (good for evening CT games)

    const resp = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,precipitation,relative_humidity_2m` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=2`,
      { timeout: 8000 }
    );

    const hourly = resp.data?.hourly;
    if (!hourly?.time?.length) {
      _weatherCache.set(cacheKey, { data: defaultResult, ts: Date.now() });
      return defaultResult;
    }

    // Find the hour index closest to game time
    const times: string[] = hourly.time;
    const today = new Date().toISOString().slice(0, 10);
    let bestIdx = times.findIndex((t: string) => t.startsWith(today) && parseInt(t.slice(11, 13)) >= targetHour);
    if (bestIdx < 0) bestIdx = 0;

    const tempF        = parseFloat(hourly.temperature_2m?.[bestIdx] ?? "70") || 70;
    const windMph      = parseFloat(hourly.wind_speed_10m?.[bestIdx] ?? "5")  || 0;
    const windDeg      = parseFloat(hourly.wind_direction_10m?.[bestIdx] ?? "180") || 180;
    const humidity     = parseFloat(hourly.relative_humidity_2m?.[bestIdx] ?? "50") || 50;
    const precipChance = parseFloat(hourly.precipitation_probability?.[bestIdx] ?? "0") || 0;
    const precipIn     = parseFloat(hourly.precipitation?.[bestIdx] ?? "0") || 0;

    const windLabel    = windDegToLabel(windDeg);
    const windRelative = windRelativeToOutfield(venue, windDeg);
    const windOut      = windRelative === "out"  && windMph >= 6;
    const windIn       = windRelative === "in"   && windMph >= 6;

    // ── Impact scoring ──────────────────────────────────────────────
    let impactScore = 0;
    if (windOut && windMph >= 15) impactScore += 2;
    else if (windOut && windMph >= 10) impactScore += 1;
    else if (windIn  && windMph >= 15) impactScore -= 2;
    else if (windIn  && windMph >= 10) impactScore -= 1;
    if (tempF >= 85) impactScore += 1;
    else if (tempF <= 50) impactScore -= 1;
    if (precipChance >= 50 || precipIn >= 0.10) impactScore -= 2;
    else if (precipChance >= 25) impactScore -= 1;

    const impactTier: WeatherResult["impactTier"] =
      impactScore >= 2  ? "boost"   :
      impactScore <= -2 ? "penalty" : "neutral";

    const parts: string[] = [];
    if (windOut && windMph >= 10) parts.push(`${Math.round(windMph)} mph out to CF`);
    else if (windIn && windMph >= 10) parts.push(`${Math.round(windMph)} mph in from CF`);
    else parts.push(`${Math.round(windMph)} mph ${windLabel}`);
    parts.push(`${Math.round(tempF)}°F`);
    if (precipChance >= 25) parts.push(`${Math.round(precipChance)}% precip`);
    const impactLabel = parts.join(", ");

    const hitterImpact = impactTier === "boost" ? 0.70 : impactTier === "penalty" ? 0.30 : 0.50;

    const result: WeatherResult = {
      tempF, windMph, windDir: windLabel, windOut, windIn,
      humidity, precipChance, precipInches: precipIn,
      isDome: false, impactLabel, impactTier, hitterImpact,
    };

    _weatherCache.set(cacheKey, { data: result, ts: Date.now() });
    saveDiskCache();
    return result;
  } catch (e: any) {
    console.warn(`[MLB-Analytics] Weather fetch failed for ${venue}:`, e.message);
    _weatherCache.set(cacheKey, { data: defaultResult, ts: Date.now() });
    return defaultResult;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5+6. Pitcher analytics (MLB Stats API + Steamer blend)
// ═══════════════════════════════════════════════════════════════════════

export async function getPitcherAnalytics(pitcherId: number): Promise<PitcherAnalytics> {
  const key = String(pitcherId);
  const cached = _pitcherCache.get(key);
  if (cached && Date.now() - cached.ts < TTL_PITCHER) return cached.data;

  const empty: PitcherAnalytics = {
    mlbamId: key, name: "", team: "", era: null, whip: null,
    k9: null, bb9: null, ip: 0,
    last3ERA: null, last5ERA: null, last3AvgIP: null, last3H9: null,
    leashProb: 0.85, projERA: null, projWHIP: null, projK9: null,
  };

  try {
    const [rSeason, rLog] = await Promise.allSettled([
      axios.get(
        `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching&season=2026`,
        { timeout: 8000 }
      ),
      axios.get(
        `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=2026&limit=8`,
        { timeout: 8000 }
      ),
    ]);

    const seasonStat = rSeason.status === "fulfilled"
      ? (rSeason.value.data?.stats?.[0]?.splits?.[0]?.stat ?? {}) : {};
    const logSplits: any[] = rSeason.status === "fulfilled"
      ? [] : [];
    const gameLogSplits: any[] = rLog.status === "fulfilled"
      ? (rLog.value.data?.stats?.[0]?.splits ?? []) : [];

    const era  = parseFloat(seasonStat.era  ?? "0") || null;
    const whip = parseFloat(seasonStat.whip ?? "0") || null;
    const ip   = parseFloat(seasonStat.inningsPitched ?? "0") || 0;
    const k9   = parseFloat(seasonStat.strikeoutsPer9Inn ?? "0") || null;
    const bb9  = parseFloat(seasonStat.walksPer9Inn ?? "0") || null;

    // Recent starts analysis
    const recentStarts = gameLogSplits.slice(0, 5);
    const last3        = gameLogSplits.slice(0, 3);
    const last5        = gameLogSplits.slice(0, 5);

    const calcERA = (starts: any[]) => {
      const er = starts.reduce((s: number, g: any) => s + (parseInt(g.stat?.earnedRuns ?? "0") || 0), 0);
      const outs = starts.reduce((s: number, g: any) => {
        const ip = parseFloat(g.stat?.inningsPitched ?? "0") || 0;
        const full = Math.floor(ip); const frac = Math.round((ip - full) * 10);
        return s + full * 3 + frac;
      }, 0);
      const ip = outs / 3;
      return ip > 0 ? parseFloat(((er * 9) / ip).toFixed(2)) : null;
    };

    const calcH9 = (starts: any[]) => {
      const h    = starts.reduce((s: number, g: any) => s + (parseInt(g.stat?.hits ?? "0") || 0), 0);
      const outs = starts.reduce((s: number, g: any) => {
        const ip = parseFloat(g.stat?.inningsPitched ?? "0") || 0;
        const full = Math.floor(ip); const frac = Math.round((ip - full) * 10);
        return s + full * 3 + frac;
      }, 0);
      const ip = outs / 3;
      return ip > 0 ? parseFloat(((h * 9) / ip).toFixed(1)) : null;
    };

    const calcAvgIP = (starts: any[]) => {
      if (!starts.length) return null;
      const total = starts.reduce((s: number, g: any) => {
        const ip = parseFloat(g.stat?.inningsPitched ?? "0") || 0;
        const full = Math.floor(ip); const frac = Math.round((ip - full) * 10);
        return s + full + frac / 3;
      }, 0);
      return parseFloat((total / starts.length).toFixed(1));
    };

    const last3ERA   = calcERA(last3);
    const last5ERA   = calcERA(last5);
    const last3H9    = calcH9(last3);
    const last3AvgIP = calcAvgIP(last3);

    // Leash probability
    let leashProb = 0.85;
    if (last3AvgIP !== null) {
      if (last3AvgIP >= 6.0) leashProb = 0.92;
      else if (last3AvgIP >= 5.0) leashProb = 0.80;
      else if (last3AvgIP >= 4.0) leashProb = 0.60;
      else leashProb = 0.40;
    }
    if (last3ERA !== null && last3ERA > 5.5) leashProb -= 0.15;
    else if (last3ERA !== null && last3ERA < 3.0) leashProb += 0.08;
    leashProb = Math.max(0.20, Math.min(0.95, leashProb));

    // Steamer projections
    const steamer = getSteamerPitcher(pitcherId);

    const result: PitcherAnalytics = {
      mlbamId:    key,
      name:       rSeason.status === "fulfilled"
        ? (rSeason.value.data?.stats?.[0]?.splits?.[0]?.player?.fullName ?? "") : "",
      team:       "",
      era,  whip, k9, bb9, ip,
      last3ERA, last5ERA, last3AvgIP, last3H9, leashProb,
      projERA:  steamer?.era  ?? null,
      projWHIP: steamer?.whip ?? null,
      projK9:   steamer?.k9  ?? null,
    };

    _pitcherCache.set(key, { data: result, ts: Date.now() });
    saveDiskCache();
    return result;
  } catch {
    return empty;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Composite analytics boost for a batter in a specific game context
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute a composite analytics multiplier for a batter.
 * Returns a value near 1.0 (e.g. 0.88–1.14) that should be applied to
 * the calibrated hit probability AFTER the base scoreHitter call.
 *
 * Components (multiplicative):
 *   a) Steamer projection boost/penalty vs league average
 *   b) Park factor (hit)
 *   c) BvP signal
 *   d) Weather impact
 *   e) Pitcher Steamer projection quality
 */
export function computeAnalyticsBoost(
  steamer:    SteamerBatterRow | null,
  parkFactor: ParkFactorRow | null,
  bvp:        BvpResult | null,
  weather:    WeatherResult | null,
  pitcher:    PitcherAnalytics | null,
): { boost: number; note: string } {
  let mult = 1.0;
  const parts: string[] = [];

  // (a) Steamer projection
  if (steamer && steamer.avg > 0) {
    // League average hit rate ~0.255. Scale: 0.300 → +5%, 0.210 → -5%
    const steamerAdj = 1 + (steamer.avg - 0.255) * 1.5;
    mult *= Math.max(0.90, Math.min(1.12, steamerAdj));
    if (steamer.avg >= 0.285) parts.push(`Proj .${Math.round(steamer.avg * 1000)} AVG`);
    else if (steamer.avg <= 0.225) parts.push(`Proj .${Math.round(steamer.avg * 1000)} AVG (weak)`);
  }

  // (b) Park factor
  if (parkFactor) {
    const pf = parkFactor.hitFactor;
    // Already partially captured in routes.ts; apply residual (half weight)
    const pfAdj = 1 + (pf - 1.00) * 0.5;
    mult *= Math.max(0.92, Math.min(1.08, pfAdj));
    if (pf >= 1.05) parts.push(`Hitter-friendly park (${pf.toFixed(2)}x)`);
    else if (pf <= 0.95) parts.push(`Pitcher-friendly park (${pf.toFixed(2)}x)`);
  }

  // (c) BvP signal (supplement existing bvpScore in routes.ts with richer data)
  if (bvp && bvp.ab >= 15) {
    if (bvp.signal === "strong") { mult *= 1.04; parts.push(`Strong BvP: .${Math.round((bvp.avg ?? 0) * 1000)} (${bvp.hits}/${bvp.ab})`); }
    else if (bvp.signal === "weak") { mult *= 0.96; parts.push(`Weak BvP: .${Math.round((bvp.avg ?? 0) * 1000)} (${bvp.hits}/${bvp.ab})`); }
  }

  // (d) Weather
  if (weather && !weather.isDome) {
    if (weather.impactTier === "boost") {
      mult *= 1.03;
      parts.push(weather.impactLabel);
    } else if (weather.impactTier === "penalty") {
      mult *= 0.96;
      parts.push(weather.impactLabel);
    }
  }

  // (e) Pitcher Steamer projection
  if (pitcher?.projERA !== null && pitcher?.projERA !== undefined && pitcher.projERA > 0) {
    // High ERA projection = hittable pitcher. League ~4.25.
    const pERA = pitcher.projERA;
    const pitcherAdj = 1 + (pERA - 4.25) * 0.03;
    mult *= Math.max(0.92, Math.min(1.06, pitcherAdj));
    if (pERA >= 5.00) parts.push(`Proj ERA ${pERA.toFixed(2)} (hittable)`);
    else if (pERA <= 3.25) parts.push(`Proj ERA ${pERA.toFixed(2)} (elite)`);
  }

  // Cap final multiplier: never move hit prob more than ±12%
  mult = Math.max(0.88, Math.min(1.14, mult));
  return { boost: mult, note: parts.join(" · ") || "Standard conditions" };
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Projected stats layer — "simulated" per-game stats for prop context
// ═══════════════════════════════════════════════════════════════════════

export interface ProjectedGameStats {
  projH:   number;
  projHR:  number;
  projR:   number;
  projRBI: number;
  projSB:  number;
  projTB:  number;
  projHRR: number;  // Hits + Runs + RBIs
  parkAdjProjH:  number;
  parkAdjProjHR: number;
  note:    string;
}

/**
 * Derive projected per-game stats for a batter using Steamer projections,
 * adjusted for park factor and pitcher quality.
 *
 * These are NOT simulation runs — they are rate-based projections.
 * They serve as the "what does the season projection say per game" context
 * equivalent to BallparkPal's median output.
 */
export function getProjectedGameStats(
  mlbamId:    string | number,
  venue:      string,
  pitcherId?: string | number,
): ProjectedGameStats {
  const steamer = getSteamerBatter(mlbamId);
  const park    = _parkFactors.get(venue)?.data ?? { hitFactor: 1.00, hrFactor: 1.00, r_factor: 1.00 };
  const pitcherSteamer = pitcherId ? getSteamerPitcher(pitcherId) : null;

  if (!steamer) {
    return { projH: 0, projHR: 0, projR: 0, projRBI: 0, projSB: 0, projTB: 0,
             projHRR: 0, parkAdjProjH: 0, parkAdjProjHR: 0, note: "No projection data" };
  }

  // Pitcher quality adjustment: elite starters reduce expected output
  let pitcherFactor = 1.0;
  if (pitcherSteamer?.era && pitcherSteamer.era > 0) {
    pitcherFactor = Math.max(0.80, Math.min(1.20, pitcherSteamer.era / 4.25));
  }

  const parkH  = park.hitFactor;
  const parkHR = park.hrFactor;
  const parkR  = park.r_factor;

  const adjH   = steamer.hPerGame   * parkH  * pitcherFactor;
  const adjHR  = steamer.hrPerGame  * parkHR * pitcherFactor;
  const adjR   = steamer.rPerGame   * parkR  * pitcherFactor;
  const adjRBI = steamer.rbiPerGame * parkR  * pitcherFactor;
  const adjSB  = steamer.sbPerGame; // park-neutral
  const adjTB  = steamer.tbPerGame  * parkHR * pitcherFactor;
  const adjHRR = adjH + adjR + adjRBI;

  const note = pitcherSteamer?.name
    ? `Proj vs ${pitcherSteamer.name} (${pitcherSteamer.era?.toFixed(2)} ERA) @ ${venue}`
    : `Season projection @ ${venue}`;

  return {
    projH:   parseFloat(adjH.toFixed(3)),
    projHR:  parseFloat(adjHR.toFixed(3)),
    projR:   parseFloat(adjR.toFixed(3)),
    projRBI: parseFloat(adjRBI.toFixed(3)),
    projSB:  parseFloat(adjSB.toFixed(3)),
    projTB:  parseFloat(adjTB.toFixed(3)),
    projHRR: parseFloat(adjHRR.toFixed(3)),
    parkAdjProjH:  parseFloat(adjH.toFixed(3)),
    parkAdjProjHR: parseFloat(adjHR.toFixed(3)),
    note,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Full batter analytics (aggregator — one call per player per game)
// ═══════════════════════════════════════════════════════════════════════

export async function getBatterAnalytics(
  mlbamId:   string | number,
  venue:     string,
  pitcherId?: number,
  gameTimestampMs?: number,
): Promise<BatterAnalytics> {
  const id = String(mlbamId);

  const [parkFactor, weather, bvp, pitcher] = await Promise.all([
    getParkFactor(venue),
    getStadiumWeather(venue, gameTimestampMs),
    pitcherId ? getBvpExtended(Number(mlbamId), pitcherId) : Promise.resolve(null),
    pitcherId ? getPitcherAnalytics(pitcherId) : Promise.resolve(null),
  ]);

  // Ensure Steamer is loaded
  await fetchSteamerBatters();
  const steamer = getSteamerBatter(id);

  const { boost, note } = computeAnalyticsBoost(steamer, parkFactor, bvp, weather, pitcher);

  return { mlbamId: id, name: steamer?.name ?? "", steamer, bvp, parkFactor, weather, pitcher, analyticsBoost: boost, analyticsNote: note };
}

// ═══════════════════════════════════════════════════════════════════════
// 10. Startup warm + scheduled refresh
// ═══════════════════════════════════════════════════════════════════════

export async function initMlbAnalytics(): Promise<void> {
  console.log("[MLB-Analytics] Initialising...");
  await Promise.all([
    warmSteamerCache(),
    fetchParkFactors(),
  ]);
  // Refresh Steamer daily at 6 AM CT (11 AM UTC)
  const MS_TO_NEXT_REFRESH = (() => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(11, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  })();
  setTimeout(async () => {
    _lastSteamerFetch = 0; // force re-fetch
    await warmSteamerCache();
    setInterval(async () => {
      _lastSteamerFetch = 0;
      await warmSteamerCache();
    }, TTL_STEAMER);
  }, MS_TO_NEXT_REFRESH);

  console.log(`[MLB-Analytics] Ready. Steamer batters=${_steamerBatters.size} pitchers=${_steamerPitchers.size} parks=${_parkFactors.size}`);
}
