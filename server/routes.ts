import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { runScan } from "./scanner";
import { broadcast } from "./ws";
import axios from "axios";
import * as cheerio from "cheerio";

// ── Player stat cache (15 min TTL) ────────────────────────────────────────────
const STAT_CACHE = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

// Map player names → Basketball-Reference slug
const BBR_SLUG: Record<string, string> = {
  "LeBron James": "jamesle01",      "Stephen Curry": "curryst01",
  "Kevin Durant": "duranke01",      "Giannis Antetokounmpo": "antetgi01",
  "Luka Doncic": "doncilu01",       "Joel Embiid": "embiijo01",
  "Nikola Jokic": "jokicni01",      "Jayson Tatum": "tatumja01",
  "Devin Booker": "bookede01",      "Damian Lillard": "lillada01",
  "Anthony Davis": "davisan02",     "Jimmy Butler": "butleji01",
  "Kyrie Irving": "irvinky01",      "Karl-Anthony Towns": "townska01",
  "Trae Young": "youngte01",        "Zion Williamson": "willizi01",
  "Donovan Mitchell": "mitchdo01",  "Bam Adebayo": "adebaba01",
  "Paul George": "georgpa01",       "Kawhi Leonard": "leonaka01",
  "James Harden": "hardeja01",      "Ja Morant": "moranja01",
  "Paolo Banchero": "banchpa01",    "Tyrese Haliburton": "halibty01",
  "Anthony Edwards": "edwaran01",   "Shai Gilgeous-Alexander": "gilgesh01",
  "Darius Garland": "garlada01",    "Tyrese Maxey": "maxeyty01",
  "De'Aaron Fox": "foxde01",        "Dejounte Murray": "murrade01",
  "OG Anunoby": "anunoog01",        "Mikal Bridges": "bridgmi01",
  "Scottie Barnes": "barnesc01",    "Jalen Green": "greenja05",
  "Cade Cunningham": "cunningca01", "Evan Mobley": "mobleev01",
  "Franz Wagner": "wagnefr01",      "Josh Giddey": "giddejo01",
  "DeMar DeRozan": "derozde01",     "Zach LaVine": "lavinza01",
  "Brandon Ingram": "ingrambr01",   "Draymond Green": "greendr01",
  "Klay Thompson": "thompkl01",     "Bradley Beal": "bealbr01",
  "Russell Westbrook": "westbru01", "Chris Paul": "paulch01",
};

// NFL Reference slugs
const PFR_SLUG: Record<string, string> = {
  "Patrick Mahomes": "MahomPa00",   "Josh Allen": "AllenJo02",
  "Lamar Jackson": "JackLa00",     "Jalen Hurts": "HurtsJa00",
  "Dak Prescott": "PresDa01",      "Justin Jefferson": "JeffJu00",
  "Tyreek Hill": "HillTy01",       "CeeDee Lamb": "LambCe00",
  "Justin Herbert": "HerbJu00",    "Joe Burrow": "BurrJo00",
  "Davante Adams": "AdamsDa11",    "Travis Kelce": "KelcTr00",
  "Stefon Diggs": "DiggSt01",      "Cooper Kupp": "KuppCo00",
  "Christian McCaffrey": "McC-Ch02","Derrick Henry": "HenrDe00",
};

// ── ESPN ID cache ─────────────────────────────────────────────────────────
// ESPN ID cache — all IDs verified via ESPN core API roster scan + direct athlete lookup.
// Any player NOT in this cache falls through to the dynamic resolveESPNId() function.
const ESPN_ID_CACHE: Record<string, string> = {
  // ── NBA (verified via ESPN core API active roster scan) ───────────────────
  "LeBron James": "1966",              "Stephen Curry": "3975",
  "Kevin Durant": "3202",              "Giannis Antetokounmpo": "3032977",
  "Luka Doncic": "3945274",            "Joel Embiid": "3059318",
  "Nikola Jokic": "3112335",           "Jayson Tatum": "4065648",
  "Devin Booker": "3136193",           "Damian Lillard": "6606",
  "Anthony Davis": "6583",             "Jimmy Butler": "6430",
  "Kyrie Irving": "6442",              "Karl-Anthony Towns": "3136195",
  "Trae Young": "4277905",             "Donovan Mitchell": "3908809",
  "Bam Adebayo": "4066261",            "Paolo Banchero": "4432573",
  "Tyrese Haliburton": "4396993",      "Anthony Edwards": "4594268",
  "Shai Gilgeous-Alexander": "4278073","Darius Garland": "4396907",
  "Tyrese Maxey": "4431678",           "De'Aaron Fox": "4066259",
  "OG Anunoby": "3934719",             "Mikal Bridges": "3147657",
  "Scottie Barnes": "4433134",         "Jalen Green": "4437244",
  "Cade Cunningham": "4432166",        "Evan Mobley": "4432158",
  "Franz Wagner": "4566434",           "Josh Giddey": "4871145",
  "DeMar DeRozan": "3978",             "Zach LaVine": "3064440",
  "Draymond Green": "6589",            "Klay Thompson": "6475",
  "Bradley Beal": "6580",              "Myles Turner": "3133628",
  "Tobias Harris": "6618",             "Khris Middleton": "6609",
  "Brook Lopez": "3971",               "Jaylen Brown": "3917376",
  "Marcus Smart": "2990969",           "Kyle Lowry": "2168",
  "Pascal Siakam": "3136196",          "Kristaps Porzingis": "3102531",
  "Jalen Brunson": "3934672",          "RJ Barrett": "4395625",
  "Immanuel Quickley": "4395724",      "Deandre Ayton": "4278129",
  "Cameron Johnson": "3138196",        "Buddy Hield": "2990984",
  "Bennedict Mathurin": "4683634",     "Andrew Nembhard": "4395712",
  "Dennis Schroder": "3032979",        "Nikola Vucevic": "6478",
  "Derrick White": "3078576",          "Al Horford": "3213",
  "Payton Pritchard": "4066354",       "Sam Hauser": "4065804",
  "Jordan Poole": "4277956",           "Bilal Coulibaly": "5104155",
  "Kyle Kuzma": "3134907",             "Deni Avdija": "4683021",
  "Bobby Portis": "3064482",
  // ── NHL (verified via ESPN site v2 team roster scan) ─────────────────────
  "Connor McDavid": "3895074",         "Nathan MacKinnon": "3041969",
  "David Pastrnak": "3114778",         "Auston Matthews": "4024123",
  "Leon Draisaitl": "3114727",         "Nikita Kucherov": "2563060",
  "Brady Tkachuk": "4319858",          "Kirill Kaprizov": "3942335",
  "Matthew Tkachuk": "4024854",        "Sebastian Aho": "3904173",
  "Mark Scheifele": "2562632",         "Jack Hughes": "4565222",
  "Cole Caufield": "4565236",          "Aleksander Barkov": "3041970",
  "Cole Sillinger": "4874725",         "Logan Stankoven": "4874899",
  "Andrei Svechnikov": "4352683",       "Seth Jarvis": "4697396",
  "Sam Reinhart": "3114722",           "Carter Verhaeghe": "3042088",
  "Jason Robertson": "4565275",         "William Nylander": "3114736",
  "Sidney Crosby": "3114",              "Evgeni Malkin": "3124",
  "Erik Karlsson": "5164",              "Cale Makar": "4233563",
  "Charlie McAvoy": "3988803",          "Sam Bennett": "3114732",
  "David Pastrnak": "3114778",          "Roman Josi": "5180",
  "John Tavares": "5160",               "Nathan MacKinnon": "3041969",
  "Alex Ovechkin": "3101",              "Mitch Marner": "4063404",
  // ── MLB (verified via ESPN site v2 team roster scan) ─────────────────────
  "Shohei Ohtani": "39832",            "Mike Trout": "30836",
  "Mookie Betts": "33039",             "Juan Soto": "36969",
  "Ronald Acuna Jr.": "36185",         "Freddie Freeman": "30193",
  "Yordan Alvarez": "36018",           "Bryce Harper": "30951",
  "Trea Turner": "33710",              "Paul Goldschmidt": "31027",
  "Nolan Arenado": "31261",            "Fernando Tatis Jr.": "35983",
  "Bo Bichette": "38904",              "Vladimir Guerrero Jr.": "35002",
  "Jose Ramirez": "32801",             "Julio Rodriguez": "41044",
  "Spencer Strider": "4307825",        "Gerrit Cole": "32081",
  "Sandy Alcantara": "35241",
  // ── NFL (verified via ESPN site v2 team roster scan) ─────────────────────
  "Patrick Mahomes": "3139477",        "Josh Allen": "3915239",
  "Lamar Jackson": "3916387",          "Joe Burrow": "3915511",
  "Justin Herbert": "4038941",         "Jalen Hurts": "4040715",
  "Tua Tagovailoa": "4241479",         "Dak Prescott": "2577417",
  "Kyler Murray": "3917315",           "Trevor Lawrence": "4360310",
  "Justin Jefferson": "4262921",       "Cooper Kupp": "2977187",
  "Tyreek Hill": "3054192",            "Davante Adams": "16800",
  "Travis Kelce": "15847",             "Mark Andrews": "3116365",
  "CeeDee Lamb": "4241389",            "Ja'Marr Chase": "4362628",
  "Christian McCaffrey": "3117251",    "Derrick Henry": "3043078",
  "Nick Chubb": "3128720",             "Austin Ekeler": "3068267",
};

// ─── ESPN player ID lookup ────────────────────────────────────────────────────
async function resolveESPNId(playerName: string, sport: string): Promise<string | null> {
  // Check verified cache first
  if (ESPN_ID_CACHE[playerName]) return ESPN_ID_CACHE[playerName];

  const sportsName = sport === "NBA" ? "basketball" : sport === "NFL" ? "football" : sport === "MLB" ? "baseball" : sport === "NHL" ? "hockey" : "basketball";
  const league = sport === "NBA" ? "nba" : sport === "NFL" ? "nfl" : sport === "MLB" ? "mlb" : sport === "NHL" ? "nhl" : "nba";

  // Method 1: ESPN site search API — type=player (NOT type=athlete which returns errors)
  // The response has results[].contents[] where each item has uid = "s:40~l:46~a:{espnId}"
  try {
    // Strip accents so "Schröder" → "Schroder", "Diabaté" → "Diabate"
    const asciiName = playerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const r = await axios.get(
      `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiName)}&limit=8&type=player&sport=${sportsName}%2F${league}`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    // Results are nested: results[] → contents[]
    const allContents: any[] = [];
    for (const resultGroup of (r.data?.results ?? [])) {
      for (const c of (resultGroup.contents ?? [])) allContents.push(c);
    }
    const nameLower = asciiName.toLowerCase();
    const nameParts = nameLower.split(" ");
    for (const item of allContents) {
      const itemName = (item.displayName ?? item.name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      // Extract numeric ID from uid field ("s:40~l:46~a:4873138" → "4873138")
      const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(item.id ?? "");
      if (!id) continue;
      if (itemName === nameLower ||
          (nameParts.length >= 2 && itemName.includes(nameParts[0]) && itemName.includes(nameParts[nameParts.length - 1]))) {
        ESPN_ID_CACHE[playerName] = id;
        return id;
      }
    }
    // Fallback: take first player result
    if (allContents.length === 1) {
      const uidMatch = (allContents[0].uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(allContents[0].id ?? "");
      if (id) { ESPN_ID_CACHE[playerName] = id; return id; }
    }
  } catch { /* search failed */ }

  // Method 2: ESPN search without sport filter (broader — catches rookies, international players)
  try {
    const asciiName2 = playerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const r2 = await axios.get(
      `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiName2)}&limit=5&type=player`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const allContents2: any[] = [];
    for (const rg of (r2.data?.results ?? [])) for (const c of (rg.contents ?? [])) allContents2.push(c);
    const nameLower2 = asciiName2.toLowerCase();
    const parts2 = nameLower2.split(" ");
    for (const item of allContents2) {
      const itemName = (item.displayName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(item.id ?? "");
      if (!id) continue;
      if (itemName === nameLower2 ||
          (parts2.length >= 2 && itemName.includes(parts2[0]) && itemName.includes(parts2[parts2.length - 1]))) {
        ESPN_ID_CACHE[playerName] = id;
        return id;
      }
    }
    // Take first result as last-resort
    if (allContents2.length >= 1) {
      const uidMatch = (allContents2[0].uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(allContents2[0].id ?? "");
      if (id) { ESPN_ID_CACHE[playerName] = id; return id; }
    }
  } catch { /* fallback search failed */ }

  return null;
}

// ─── ESPN v3 game log (primary source — clean, single request per sport) ────
// site.web.api.espn.com returns labels + per-game stats + opponent info in one call.
async function fetchESPNGameLog(playerName: string, sport: string): Promise<any> {
  try {
    // Current and prior season years — we pull both so recent postseason/championship
    // games (Super Bowl, World Series, Stanley Cup, NBA Finals, All-Star) are always included.
    const currentYear = new Date().getFullYear();
    // NBA/NHL use a "season" year that represents the spring end (e.g. 2024-25 season = 2025)
    // MLB/NFL use the calendar year the season started
    const sportCfg: Record<string, { sn: string; lg: string; seasons: number[]; statMap: Record<string, string>; altLeagues?: string[] }> = {
      NBA: { sn: "basketball", lg: "nba",    seasons: [currentYear, currentYear - 1],
             statMap: { MIN: "mp", PTS: "pts", REB: "trb", AST: "ast", BLK: "blk", STL: "stl", TO: "tov", FG: "fg_made", "3PT": "fg3_made" } },
      NHL: { sn: "hockey",     lg: "nhl",    seasons: [currentYear, currentYear - 1],
             statMap: { G: "goals", A: "ast", PTS: "pts", S: "shots", "TOI/G": "toi", "+/-": "plusMinus" } },
      MLB: { sn: "baseball",   lg: "mlb",    seasons: [currentYear, currentYear - 1],
             statMap: { AB: "ab", H: "hits", "2B": "doubles", "3B": "triples", HR: "home_runs", RBI: "rbi", BB: "bb", SO: "strikeouts", AVG: "avg", OBP: "obp", SLG: "slg", R: "runs",
                         // pitching
                         IP: "ip", ER: "er", K: "strikeouts_p" },
             // WBC is a separate ESPN baseball league
             altLeagues: ["world-baseball-classic"] },
      NFL: { sn: "football",   lg: "nfl",    seasons: [currentYear - 1, currentYear - 2], // NFL season uses prior calendar year (2025)
             statMap: { YDS: "yds", TD: "td", INT: "int", ATT: "att", REC: "rec", CAR: "car", "LONG": "long" } },
    };
    const cfg = sportCfg[sport.toUpperCase()] ?? sportCfg.NBA;

    const espnId = await resolveESPNId(playerName, sport);
    if (!espnId) return null;

    // ── PRIMARY: ESPN v3 gamelog — fetch BOTH current and prior season so
    // postseason/championship/All-Star games (Super Bowl, World Series,
    // Stanley Cup Finals, NBA Finals, All-Star games) are always captured.
    let primaryGames: any[] = [];
    let dataSource = "ESPN v3";
    const seenEventIds = new Set<string>();

    // Helper: parse one season's v3 response and append unique games
    const parseV3Response = (v3Data: any) => {
      const labels: string[] = v3Data.labels ?? [];
      const eventsMap: Record<string, any> = v3Data.events ?? {};
      const entries: Array<{ entry: any; eventInfo: any }> = [];
      // Iterate ALL seasonTypes — regular season, playoffs, all-star, etc.
      for (const stype of (v3Data.seasonTypes ?? [])) {
        for (const cat of (stype.categories ?? [])) {
          for (const ev of (cat.events ?? [])) {
            const eid = String(ev.eventId ?? "");
            if (seenEventIds.has(eid)) continue; // deduplicate across seasons
            seenEventIds.add(eid);
            const evInfo = eventsMap[eid] ?? {};
            entries.push({ entry: ev, eventInfo: evInfo, labels });
          }
        }
      }
      return entries;
    };

    try {
      // Fetch both seasons in parallel — prior season first so current-season
      // games win when we sort and slice the last 5
      const seasonFetches = await Promise.allSettled(
        cfg.seasons.map(yr =>
          axios.get(
            `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
            { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }
          )
        )
      );

      let allGameEntries: Array<{ entry: any; eventInfo: any; labels: string[] }> = [];
      for (const result of seasonFetches) {
        if (result.status === "fulfilled") {
          allGameEntries.push(...parseV3Response(result.value.data));
        }
      }

      // Sort chronologically (oldest → newest), take last 5 most-recent
      allGameEntries.sort((a, b) => {
        const da = a.eventInfo.gameDate ?? "";
        const db = b.eventInfo.gameDate ?? "";
        return da.localeCompare(db);
      });
      const last5 = allGameEntries.slice(-5);

      for (const { entry, eventInfo, labels } of last5) {
        const stats = entry.stats ?? [];
        const statObj: Record<string, string> = {};
        labels.forEach((lbl, i) => { if (stats[i] != null) statObj[lbl] = String(stats[i]); });

        // Map sport-specific labels to our standard keys
        const mapped: Record<string, string> = {};
        for (const [label, key] of Object.entries(cfg.statMap)) {
          if (statObj[label] != null) mapped[key] = statObj[label];
        }
        // For FG split "9-21" extract made count
        if (statObj["FG"]) {
          const fgParts = statObj["FG"].split("-");
          mapped["fg_made"] = fgParts[0] ?? "0";
          mapped["fg_att"] = fgParts[1] ?? "0";
        }
        if (statObj["3PT"]) {
          const fgParts = statObj["3PT"].split("-");
          mapped["fg3_made"] = fgParts[0] ?? "0";
        }

        const opp = eventInfo.opponent?.abbreviation ?? "?";
        const atVs = eventInfo.atVs ?? "vs";
        const gameDate = eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "";
        const gameResult = eventInfo.gameResult ?? "";
        const score = eventInfo.score ?? "";
        // eventNote captures special event labels: "Super Bowl LIX", "World Series - Game 6",
        // "NBA All-Star - Championship", "Stanley Cup Finals - Game 7", etc.
        const eventNote = eventInfo.eventNote ?? eventInfo.shortName ?? "";

        primaryGames.push({
          date_game: gameDate,
          opp_id: `${atVs === "@" ? "@" : "vs"}${opp}`,
          result: gameResult ? `${gameResult} ${score}`.trim() : "",
          eventNote: eventNote,
          source: "espn_v3",
          ...mapped,
        });
      }
    } catch (v3Err: any) {
      console.warn(`[Stats] ESPN v3 failed for ${playerName}: ${v3Err.message}`);
    }

    // ── CROSS-CHECK: ESPN core API (second source) ────────────────────────────
    // Fetch in parallel with v3. If key stats differ by >10%, log a warning.
    let crossCheckGames: any[] = [];
    let dataVerified = false;
    try {
      const elogResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${cfg.sn}/leagues/${cfg.lg}/athletes/${espnId}/eventlog?limit=25`,
        { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const totalPages = elogResp.data?.events?.pageCount ?? 1;
      const lastPageResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${cfg.sn}/leagues/${cfg.lg}/athletes/${espnId}/eventlog?limit=25&page=${totalPages}`,
        { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const playedEvents: any[] = (lastPageResp.data?.events?.items ?? []).filter((e: any) => e.played === true).slice(-5);

      // Fetch per-game stats for last 5 played events
      await Promise.all(playedEvents.map(async (ev: any) => {
        try {
          const statsRef = ev?.statistics?.$ref;
          if (!statsRef) return;
          const statsResp = await axios.get(statsRef, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
          const cats: any[] = statsResp.data?.splits?.categories ?? [];
          const gs: Record<string, number> = {};
          for (const cat of cats) for (const s of (cat.stats ?? [])) gs[s.name] = s.value;
          crossCheckGames.push({
            pts: Math.round(gs.points ?? gs.totalPoints ?? 0),
            trb: Math.round(gs.rebounds ?? gs.totalRebounds ?? 0),
            ast: Math.round(gs.assists ?? 0),
          });
        } catch { /* skip */ }
      }));

      // Verify: compare pts totals between v3 and core API
      if (primaryGames.length > 0 && crossCheckGames.length > 0) {
        const v3Total = primaryGames.reduce((sum, g) => sum + (parseFloat(g.pts ?? g.goals ?? "0") || 0), 0);
        const coreTotal = crossCheckGames.reduce((sum, g) => sum + (g.pts || 0), 0);
        const diff = Math.abs(v3Total - coreTotal);
        const maxTotal = Math.max(v3Total, coreTotal, 1);
        if (diff / maxTotal > 0.15) {
          // >15% discrepancy — prefer core API data which has explicit stat names
          console.warn(`[Stats] ${playerName} discrepancy: v3=${v3Total} core=${coreTotal} — using core API`);
          dataSource = "ESPN core (cross-verified)";
          // Rebuild from core data if we have enough
          if (crossCheckGames.length >= primaryGames.length) {
            // Core data doesn't have date/opp so we keep the v3 structure but swap in core stats
            for (let i = 0; i < Math.min(primaryGames.length, crossCheckGames.length); i++) {
              const cg = crossCheckGames[i];
              primaryGames[i].pts = String(cg.pts);
              primaryGames[i].trb = String(cg.trb);
              primaryGames[i].ast = String(cg.ast);
              primaryGames[i].source = "espn_core_verified";
            }
          }
        } else {
          dataVerified = true;
        }
      }
    } catch (crossErr: any) {
      console.warn(`[Stats] Cross-check failed for ${playerName}: ${crossErr.message}`);
    }

    // If v3 returned nothing, fall back to core-only
    if (primaryGames.length === 0) {
      console.warn(`[Stats] ESPN v3 returned no games for ${playerName}, falling back to core API`);
      dataSource = "ESPN core";
      // Use crossCheckGames as primary (they have pts/trb/ast at minimum)
      primaryGames = crossCheckGames.map((g, i) => ({ ...g, date_game: "", opp_id: `G${i + 1}`, source: "espn_core" }));
    }

    // Sort ascending (oldest → newest for charts)
    primaryGames.sort((a, b) => (a.date_game || "").localeCompare(b.date_game || ""));

    // ── Season averages via ESPN v3 stats endpoint ──────────────────────────
    // The v3 stats endpoint returns categories[].statistics[] where each row is
    // a season year. Stats are a positional array matched against categories[].labels[].
    // We pick the most-recent season row, build a label→value map, then extract
    // the stats we care about by their actual ESPN label names.
    let season: Record<string, string> = {};
    // NFL: use prior calendar year (season started in 2025). NBA/NHL: spring year (2026).
    const primarySeason = sport.toUpperCase() === "NFL" ? currentYear - 1 : cfg.seasons[0];
    let seasonLabel = sport.toUpperCase() === "NFL"
      ? `${primarySeason} Season Stats (ESPN)`
      : `${primarySeason - 1}-${String(primarySeason).slice(2)} Season Averages (ESPN)`;
    try {
      const statsUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/stats?season=${primarySeason}&seasontype=2`;
      const statsResp = await axios.get(statsUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });

      // Build label→value from categories[0] (per-game/averages) which has the most
      // human-readable stats. ESPN returns stats as positional array + labels array.
      const v3cats: any[] = statsResp.data?.categories ?? [];
      const allStats: Record<string, string> = {};
      for (const cat of v3cats) {
        const labels: string[] = cat.labels ?? [];
        const statsRows: any[] = cat.statistics ?? [];
        // Find the row for the target season year; fall back to last row
        const targetRow = statsRows.find((r: any) => r?.season?.year === primarySeason)
          ?? statsRows[statsRows.length - 1];
        if (!targetRow) continue;
        const vals: string[] = targetRow.stats ?? [];
        labels.forEach((lbl, i) => {
          if (vals[i] != null && allStats[lbl] == null) allStats[lbl] = String(vals[i]);
        });
      }

      const sportUp = sport.toUpperCase();
      if (sportUp === "NBA") {
        season = {
          pts:    allStats["PTS"] ?? "—",
          reb:    allStats["REB"] ?? "—",
          ast:    allStats["AST"] ?? "—",
          stl:    allStats["STL"] ?? "—",
          blk:    allStats["BLK"] ?? "—",
          fg_pct: allStats["FG%"] ? allStats["FG%"] + "%" : "—",
          fg3_pct:allStats["3P%"] ? allStats["3P%"] + "%" : "—",
          mpg:    allStats["MIN"] ?? "—",
          gp:     allStats["GP"]  ?? "—",
          to:     allStats["TO"]  ?? "—",
        };
      } else if (sportUp === "NHL") {
        season = {
          goals:     allStats["G"]     ?? "—",
          ast:       allStats["A"]     ?? "—",
          pts:       allStats["PTS"]   ?? "—",
          shots:     allStats["SOG"]   ?? "—",
          gp:        allStats["GP"]    ?? "—",
          ppg:       allStats["PPG"]   ?? "—",
          plusMinus: allStats["+/-"]   ?? "—",
          toi:       allStats["TOI/G"] ?? "—",
        };
      } else if (sportUp === "MLB") {
        season = {
          avg:  allStats["AVG"] ?? "—",
          hr:   allStats["HR"]  ?? "—",
          rbi:  allStats["RBI"] ?? "—",
          obp:  allStats["OBP"] ?? "—",
          gp:   allStats["GP"]  ?? "—",
          hits: allStats["H"]   ?? "—",
          // pitcher stats
          era:  allStats["ERA"] ?? "—",
          k:    allStats["K"]   ?? allStats["SO"] ?? "—",
        };
      } else if (sportUp === "NFL") {
        // First category is passing; second is rushing — grab the richest one
        season = {
          gp:       allStats["GP"]  ?? "—",
          yds:      allStats["YDS"] ?? "—",
          td:       allStats["TD"]  ?? "—",
          int:      allStats["INT"] ?? "—",
          cmp_pct:  allStats["CMP%"] ? allStats["CMP%"] + "%" : "—",
          rec:      allStats["REC"] ?? "—",
          car:      allStats["CAR"] ?? "—",
        };
      }
    } catch (seasonErr: any) {
      console.warn(`[Stats] Season stats failed for ${playerName}: ${seasonErr.message}`);
    }

    const sportKey = sport.toLowerCase();
    const espnProfileUrl = `https://www.espn.com/${sportKey}/player/_/id/${espnId}`;

    console.log(`[Stats] ${playerName} (${sport}): ${primaryGames.length} games | source=${dataSource} | verified=${dataVerified}`);

    return {
      sport: sport.toUpperCase(),
      name: playerName,
      espnId,
      bbrUrl: espnProfileUrl,
      season,
      seasonLabel,
      recentGames: primaryGames,
      dataSource,
      dataVerified,
    };
  } catch (e: any) {
    console.warn("[Stats] fetchESPNGameLog failed:", e.message);
    return null;
  }
}

async function fetchBBRStats(playerName: string): Promise<any> {
  // First try ESPN (works for all active players)
  const espnData = await fetchESPNGameLog(playerName, "NBA");
  if (espnData) return espnData;

  // Fallback to BBR slug map for legacy support
  const slug = BBR_SLUG[playerName];
  if (!slug) return null;
  const letter = slug[0];
  const url = `https://www.basketball-reference.com/players/${letter}/${slug}.html`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PropEdge/1.0)" },
      timeout: 8000,
    });
    const $ = cheerio.load(resp.data);

    // Season averages from per_game table
    const row = $("#per_game tbody tr").not(".thead").last();
    const season: Record<string, string> = {};
    row.find("td").each((_, el) => {
      const stat = $(el).attr("data-stat");
      const val = $(el).text().trim();
      if (stat && val) season[stat] = val;
    });

    // Last 5 game log entries
    const recentGames: any[] = [];
    $("#pgl_basic tbody tr").not(".thead").not("[class*='partial']").slice(-5).each((_, row) => {
      const g: Record<string, string> = {};
      ["date_game","opp_id","pts","ast","trb","stl","blk","tov","mp"].forEach(stat => {
        g[stat] = $(row).find(`td[data-stat="${stat}"]`).text().trim();
      });
      if (g.pts) recentGames.push(g);
    });

    return {
      sport: "NBA",
      name: playerName,
      bbrUrl: url,
      season: {
        pts: season.pts_per_g || season.pts || "—",
        reb: season.trb_per_g || season.trb || "—",
        ast: season.ast_per_g || season.ast || "—",
        stl: season.stl_per_g || season.stl || "—",
        blk: season.blk_per_g || season.blk || "—",
        fg_pct: season.fg_pct || "—",
        fg3_pct: season.fg3_pct || "—",
        ft_pct: season.ft_pct || "—",
        mpg: season.mp_per_g || season.mp || "—",
        gp: season.g || "—",
      },
      recentGames,
    };
  } catch (e: any) {
    console.warn("BBR fetch failed:", e.message);
    return null;
  }
}

async function fetchPFRStats(playerName: string): Promise<any> {
  const slug = PFR_SLUG[playerName];
  if (!slug) return null;
  const url = `https://www.pro-football-reference.com/players/${slug[0]}/${slug}.htm`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PropEdge/1.0)" },
      timeout: 8000,
    });
    const $ = cheerio.load(resp.data);
    const row = $("#passing tbody tr, #rushing tbody tr, #receiving tbody tr").not(".thead").last();
    const season: Record<string, string> = {};
    row.find("td").each((_, el) => {
      const stat = $(el).attr("data-stat");
      const val = $(el).text().trim();
      if (stat && val) season[stat] = val;
    });
    return {
      sport: "NFL",
      name: playerName,
      pfrUrl: url,
      season,
    };
  } catch (e: any) {
    console.warn("PFR fetch failed:", e.message);
    return null;
  }
}

let scanInterval: NodeJS.Timeout | null = null;

export async function registerRoutes(httpServer: Server, app: Express) {
  // ─── Bets ─────────────────────────────────────────────────────────────────
  app.get("/api/bets", async (req, res) => {
    try {
      const bets = await storage.getBets();

      // Sort all bets by confidenceScore descending (fix: was using 'confidence' which is always undefined)
      const sorted = [...bets].sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));

      // Player props: top 100 per sport, but ALWAYS include lotto bets (up to 20 per sport)
      const PROPS_PER_SPORT = 100;
      const LOTTO_PER_SPORT = 20;
      const propsBySport: Record<string, any[]> = {};
      const lottoBySport: Record<string, any[]> = {};

      // First pass: collect lotto props (guaranteed to appear)
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        if (!bet.isLotto) continue;
        const sport = bet.sport ?? 'OTHER';
        if (!lottoBySport[sport]) lottoBySport[sport] = [];
        if (lottoBySport[sport].length < LOTTO_PER_SPORT) {
          lottoBySport[sport].push(bet);
        }
      }

      // Second pass: fill remaining slots with non-lotto props up to PROPS_PER_SPORT
      const lottoIds = new Set(Object.values(lottoBySport).flat().map(b => b.id));
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        if (lottoIds.has(bet.id)) continue; // already included as lotto
        const sport = bet.sport ?? 'OTHER';
        const lottoCount = lottoBySport[sport]?.length ?? 0;
        if (!propsBySport[sport]) propsBySport[sport] = [];
        if (propsBySport[sport].length < PROPS_PER_SPORT - lottoCount) {
          propsBySport[sport].push(bet);
        }
      }

      // Merge lotto + regular props per sport
      const limitedProps: any[] = [];
      const allSports = new Set([...Object.keys(propsBySport), ...Object.keys(lottoBySport)]);
      for (const sport of allSports) {
        limitedProps.push(...(lottoBySport[sport] ?? []));
        limitedProps.push(...(propsBySport[sport] ?? []));
      }

      // Season bets (futures — no gameTime): top 50 total
      const SEASON_LIMIT = 50;
      const seasonBets = sorted
        .filter(b => b.betType !== 'player_prop' && !b.gameTime)
        .slice(0, SEASON_LIMIT);

      // Team bets (spreads/totals/moneylines with gameTime): top 200 total
      const TEAM_LIMIT = 200;
      const teamBets = sorted
        .filter(b => b.betType !== 'player_prop' && b.gameTime)
        .slice(0, TEAM_LIMIT);

      // ── Game-time enrichment: fill null gameTime on bets using ActionNetwork data ──
      // Kalshi returns null expected_expiration_time, so player props often lack gameTime.
      // refreshGameTimeLookup() runs at startup and every 15 min, populating GAME_TIME_LOOKUP
      // and TEAM_WORD_LOOKUP with today's game times from ActionNetwork.
      await refreshGameTimeLookup(); // no-op if called recently (cached 15 min)
      const allBetsOut = [...limitedProps, ...teamBets, ...seasonBets];

      if (GAME_TIME_LOOKUP.size > 0 || TEAM_WORD_LOOKUP.size > 0) {
        for (const b of allBetsOut) {
          if (b.gameTime) continue; // already has a time
          if (b.betType === "futures" || b.betType === "season_prop") continue;

          let matched: string | undefined;

          // 1. Exact full-name matchup: "golden state warriors::boston celtics"
          if (b.awayTeam && b.homeTeam) {
            const key = `${b.awayTeam.toLowerCase()}::${b.homeTeam.toLowerCase()}`;
            matched = GAME_TIME_LOOKUP.get(key);
          }

          // 2. Partial matchup: check each lookup entry for both team words
          if (!matched && b.awayTeam && b.homeTeam) {
            const awayLast = (b.awayTeam.split(" ").pop() ?? "").toLowerCase();
            const homeLast = (b.homeTeam.split(" ").pop() ?? "").toLowerCase();
            if (awayLast.length > 3 && homeLast.length > 3) {
              for (const [k, v] of GAME_TIME_LOOKUP) {
                if (k.includes(awayLast) && k.includes(homeLast)) {
                  matched = v;
                  break;
                }
              }
            }
          }

          // 3. Fallback: match any individual team word
          if (!matched) {
            const words = [
              ...(b.awayTeam ?? "").split(" "),
              ...(b.homeTeam ?? "").split(" "),
            ].map(w => w.toLowerCase().trim()).filter(w => w.length > 4);
            for (const w of words) {
              const t = TEAM_WORD_LOOKUP.get(w);
              if (t) { matched = t; break; }
            }
          }

          if (matched) {
            b.gameTime = new Date(matched);
          }
        }
      }

      res.json(allBetsOut);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bets/high-confidence", async (req, res) => {
    try {
      const threshold = parseInt(req.query.threshold as string) || 80;
      const bets = await storage.getHighConfidenceBets(threshold);
      res.json(bets);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lookup by slug (for /picks/:slug and /lotto/:slug URLs)
  app.get("/api/bets/by-slug/:slug", async (req, res) => {
    try {
      const bets = await storage.getBets();
      const bet = bets.find((b) => b.slug === req.params.slug);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bets/:id", async (req, res) => {
    try {
      const bet = await storage.getBetById(req.params.id);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/bets/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const bet = await storage.updateBetStatus(req.params.id, status);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/bets/:id", async (req, res) => {
    try {
      await storage.deleteBet(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Scanner ──────────────────────────────────────────────────────────────
  app.post("/api/scan", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      // Push real-time update to all connected clients
      const allBets = await storage.getBets();
      broadcast("bets:updated", { scanned: result.scanned, total: allBets.length });
      // Fire high-confidence alerts for any bet ≥ 80
      const highConf = allBets.filter((b: any) => (b.confidenceScore ?? 0) >= 80);
      if (highConf.length > 0) {
        broadcast("bets:highconf", { count: highConf.length, top: highConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })) });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Debug endpoint — check Underdog NHL cache + current bets breakdown
  app.get("/api/debug/nhl", async (req, res) => {
    try {
      const axios = (await import("axios")).default;
      const cacheResp = await axios.get("https://raw.githubusercontent.com/abudnick8/prop-edge/cache/data/underdog-cache/underdog_NHL.json", { timeout: 10000 });
      const cacheData = cacheResp.data;
      const lines: any[] = cacheData.over_under_lines ?? [];
      const goalLines = lines.filter((l: any) => {
        const ou = l.over_under ?? {};
        const appStat = ou.appearance_stat ?? {};
        return l.status === "active" && ou.category === "player_prop" && (appStat.stat ?? "").toLowerCase() === "goals";
      });
      const allBets = await storage.getBets();
      const nhlBets = allBets.filter((b: any) => b.sport === "NHL");
      const nhlGoalBets = nhlBets.filter((b: any) => b.title.toLowerCase().includes("goals"));
      const nhlLotto = nhlBets.filter((b: any) => b.isLotto);
      const nhlUnd = nhlBets.filter((b: any) => b.source === "underdog");
      const statBreakdown: Record<string, number> = {};
      for (const b of nhlUnd) { const s = (b.teamStats as any)?.statType ?? "?"; statBreakdown[s] = (statBreakdown[s] ?? 0) + 1; }
      res.json({
        cache: { totalLines: lines.length, goalLines: goalLines.length, cachedAt: cacheData.cached_at },
        bets: { nhlTotal: nhlBets.length, nhlGoals: nhlGoalBets.length, nhlLotto: nhlLotto.length, nhlUnderdog: nhlUnd.length, nhlUnderdogStats: statBreakdown },
        sampleGoalBets: nhlGoalBets.slice(0, 3).map((b: any) => b.title),
        buildTime: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API Quota Check ─────────────────────────────────────────────────────
  // TEMP DEBUG — remove after Underdog fix confirmed

  app.get("/api/quota", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const apiKey = settings.oddsApiKey;
      if (!apiKey) return res.json({ status: "no_key", used: null, remaining: null, resets: null });

      const axios = (await import("axios")).default;
      const response = await axios.head(
        `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`,
        { timeout: 8000 }
      );
      const used = parseInt(response.headers["x-requests-used"] ?? "0");
      const remaining = parseInt(response.headers["x-requests-remaining"] ?? "0");

      // The Odds API resets on the 1st of each month UTC
      const now = new Date();
      const resetDate = new Date(Date.UTC(
        now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
        now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1,
        1
      ));

      res.json({
        status: remaining > 0 ? "ok" : "exhausted",
        used,
        remaining,
        resets: resetDate.toISOString(),
        plan: remaining > 5000 ? "paid_20000" : "free_500",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Settings ─────────────────────────────────────────────────────────────
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const updated = await storage.updateSettings(req.body);

      // Restart scan interval if interval changed
      const interval = updated.scanIntervalMinutes ?? 30;
      if (scanInterval) clearInterval(scanInterval);
      scanInterval = setInterval(async () => {
        const s = await storage.getSettings();
        await runScan(s.oddsApiKey);
      }, interval * 60 * 1000);

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Notifications ────────────────────────────────────────────────────────
  app.get("/api/notifications", async (req, res) => {
    try {
      const notifications = await storage.getNotifications();
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/notifications/unread", async (req, res) => {
    try {
      const notifications = await storage.getUnreadNotifications();
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/notifications/:id/dismiss", async (req, res) => {
    try {
      await storage.dismissNotification(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/notifications", async (req, res) => {
    try {
      await storage.clearNotifications();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Player Stats (Basketball-Reference / Pro-Football-Reference) ─────────
  app.get("/api/player-stats/:sport/:playerName", async (req, res) => {
    try {
      const { sport, playerName } = req.params;
      const cacheKey = `${sport}:${playerName}`;
      const cached = STAT_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.json(cached.data);
      }
      let data: any = null;
      const sportUp = sport.toUpperCase();
      // All sports now use ESPN v3 gamelog (reliable, no slug maps needed)
      data = await fetchESPNGameLog(playerName, sportUp);
      if (!data) return res.status(404).json({ error: "Player not found or stats unavailable" });
      STAT_CACHE.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Stats ────────────────────────────────────────────────────────────────
  // ─── Ask a Question (AI bet analysis) ──────────────────────────────────────
  app.post("/api/ask", async (req, res) => {
    try {
      const { question } = req.body as { question: string };
      if (!question?.trim()) return res.status(400).json({ error: "question is required" });

      const bets = await storage.getBets();
      const q = question.toLowerCase();
      const byConf = (a: any, b: any) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);

      // ─── Intent Detection ────────────────────────────────────────────────────────
      // Detect parlay requests: "build me a 4 player parlay", "4 leg parlay", "parlay for tonight"
      const parlayMatch = q.match(/(?:build|give|make|create|suggest|find|pick).*?(\d+)[- ]?(?:leg|player|pick|team|bet)?.*?parlay/i)
        ?? q.match(/parlay.*?(\d+)[- ]?(?:leg|player|pick|team|bet)/i)
        ?? q.match(/(\d+)[- ]?(?:leg|player|pick|team|bet)[- ]?parlay/i);
      const isParlayRequest = !!parlayMatch || (q.includes("parlay") && !q.includes("same game") && !q.includes("sgp"));
      const parlayLegs = parlayMatch ? parseInt(parlayMatch[1]) : (isParlayRequest ? 4 : 0);

      // SGP detection: "same game parlay", "sgp", "same-game"
      const isSGPRequest = q.includes("same game parlay") || q.includes("same-game parlay")
        || q.includes("sgp") || q.includes("same game props") || q.includes("same game picks");

      // Detect sport filter from question
      const sportFilter = q.includes("nba") || q.includes("basketball") ? "NBA"
        : q.includes("nfl") || q.includes("football") ? "NFL"
        : q.includes("mlb") || q.includes("baseball") ? "MLB"
        : q.includes("nhl") || q.includes("hockey") ? "NHL" : null;

      // Detect if asking about best/top picks generally
      const isTopPicksRequest = !isParlayRequest && !isSGPRequest && (
        q.includes("best") || q.includes("top") || q.includes("recommend") ||
        q.includes("tonight") || q.includes("today") || q.includes("right now") ||
        q.includes("what should") || q.includes("which bet") || q.includes("good bet")
      ) && !q.match(/\b(is|should i|would|will|does|did|can|could)\b/);

      // Score all bets by relevance to the question
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      const scored = bets.map((b) => {
        let score = 0;
        const fields = [
          b.title, b.description, b.playerName, b.homeTeam, b.awayTeam,
          b.sport, b.betType, b.source, b.researchSummary,
          ...(b.keyFactors ?? []),
        ].map((f) => (f ?? "").toLowerCase());
        for (const f of fields) for (const word of words) if (f.includes(word)) score += 1;
        if (b.playerName && words.some((w) => b.playerName!.toLowerCase().includes(w))) score += 4;
        if ((b.homeTeam && words.some((w) => b.homeTeam!.toLowerCase().includes(w))) ||
            (b.awayTeam && words.some((w) => b.awayTeam!.toLowerCase().includes(w)))) score += 4;
        if (b.betType === "player_prop") score += 0.5;
        if ((b.confidenceScore ?? 0) >= 80) score += 1;
        // Sport filter bonus
        if (sportFilter && b.sport === sportFilter) score += 3;
        return { bet: b, score };
      }).sort((a, b) => b.score - a.score || byConf(a.bet, b.bet));

      const totalBets = bets.length;
      const propCount = bets.filter((b) => b.betType === "player_prop").length;
      const highConfCount = bets.filter((b) => (b.confidenceScore ?? 0) >= 80).length;

      // Helper: format a single bet for display/text
      function betSummary(b: any, idx: number): string {
        const line = b.line != null ? ` | Line: ${b.line}` : "";
        const over = b.overOdds != null ? ` | Over: ${b.overOdds > 0 ? "+" : ""}${b.overOdds}` : "";
        const under = b.underOdds != null ? ` / Under: ${b.underOdds > 0 ? "+" : ""}${b.underOdds}` : "";
        const conf = ` | Conf: ${b.confidenceScore ?? "?"}/100`;
        const risk = b.riskLevel ? ` | Risk: ${b.riskLevel}` : "";
        const matchup = b.awayTeam && b.homeTeam ? ` | ${b.awayTeam} @ ${b.homeTeam}` : "";
        const factors = b.keyFactors?.length ? `\n   Why: ${b.keyFactors.slice(0, 3).join("; ")}` : "";
        return `${idx}. [${b.sport} ${b.betType}] ${b.title}${matchup}${line}${over}${under}${conf}${risk}${factors}`;
      }

      // Helper: serialize a bet for the relatedBets response
      function serializeBet(b: any, reason: string) {
        return {
          id: b.id, title: b.title, sport: b.sport, betType: b.betType,
          playerName: b.playerName ?? null, homeTeam: b.homeTeam ?? null, awayTeam: b.awayTeam ?? null,
          confidenceScore: b.confidenceScore ?? null, riskLevel: b.riskLevel ?? null,
          line: b.line ?? null, overOdds: b.overOdds ?? null, underOdds: b.underOdds ?? null,
          recommendedAllocation: b.recommendedAllocation ?? null,
          keyFactors: (b.keyFactors ?? []).slice(0, 2),
          gameTime: b.gameTime ?? null,
          similarityReason: reason,
        };
      }

      let answer: string;
      let relatedBets: any[] = [];

      // ─── SGP MODE (Same Game Parlay) ─────────────────────────────────────
      if (isSGPRequest) {
        // Extract leg count if specified, default 3
        const sgpLegMatch = q.match(/(\d+)[- ]?(?:leg|pick|prop)?/);
        const sgpLegs = sgpLegMatch ? Math.min(Math.max(parseInt(sgpLegMatch[1]), 2), 6) : 3;

        // Extract a specific team or game if mentioned
        const teamWords = q.replace(/same.?game|parlay|sgp|props?|picks?|legs?|build|give|make|create|suggest|find/gi, "").trim().split(/\s+/).filter(w => w.length > 2);

        // Filter to player props only, score by team/game match
        const propPool = bets
          .filter(b => b.betType === "player_prop" && (b.confidenceScore ?? 0) >= 60)
          .map(b => {
            let score = 0;
            const fields = [b.playerName, b.homeTeam, b.awayTeam, b.title, b.sport].map(f => (f ?? "").toLowerCase());
            for (const f of fields) for (const w of teamWords) if (f.includes(w)) score += 3;
            if (sportFilter && b.sport === sportFilter) score += 5;
            score += (b.confidenceScore ?? 0) / 20; // confidence tiebreaker
            return { bet: b, score };
          })
          .sort((a, b) => b.score - a.score);

        // Group by game (homeTeam|awayTeam key)
        const gameGroups = new Map<string, any[]>();
        for (const { bet } of propPool) {
          const key = [bet.homeTeam, bet.awayTeam].filter(Boolean).sort().join("|");
          if (!key) continue;
          if (!gameGroups.has(key)) gameGroups.set(key, []);
          gameGroups.get(key)!.push(bet);
        }

        // Pick the best game (most high-conf props available)
        let bestGame: { key: string; bets: any[] } | null = null;
        for (const [key, gameBets] of gameGroups) {
          if (!bestGame || gameBets.length > bestGame.bets.length) {
            bestGame = { key, bets: gameBets };
          }
        }

        // If a specific game was mentioned by team name, prefer that one
        if (teamWords.length > 0) {
          for (const [key, gameBets] of gameGroups) {
            if (teamWords.some(w => key.toLowerCase().includes(w))) {
              bestGame = { key, bets: gameBets };
              break;
            }
          }
        }

        if (!bestGame || bestGame.bets.length < 2) {
          // Fallback: just use top props from any games, dedupe by player
          const fallbackLegs: any[] = [];
          const usedPlayers = new Set<string>();
          for (const { bet } of propPool) {
            if (fallbackLegs.length >= sgpLegs) break;
            if (bet.playerName && usedPlayers.has(bet.playerName.toLowerCase())) continue;
            fallbackLegs.push(bet);
            if (bet.playerName) usedPlayers.add(bet.playerName.toLowerCase());
          }
          relatedBets = fallbackLegs.map(b => serializeBet(b, "sgp leg"));
          const avgConf = fallbackLegs.length ? Math.round(fallbackLegs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / fallbackLegs.length) : 0;
          answer = `⚡ SAME GAME PARLAY — ${fallbackLegs.length} Props (avg confidence: ${avgConf}/100)\n\nNote: Not enough props found for a single game — showing top props across games.\n\n${fallbackLegs.map((b, i) => {
            const conf = b.confidenceScore ?? 0;
            const line = b.line != null ? ` | Line: ${b.line}` : "";
            const odds = b.overOdds != null ? ` (${b.overOdds > 0 ? "+" : ""}${b.overOdds})` : "";
            const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 100) ?? "";
            return `**Leg ${i+1}: ${b.title}**${line}${odds}\n   Confidence: ${conf}/100 | Player: ${b.playerName ?? "—"}\n   Why: ${why}`;
          }).join("\n\n")}\n\n⚠️ SGP odds are correlated — books may restrict parlay combinations on the same game.`;
        } else {
          // Pick top N legs from the best game, dedupe by player and stat type
          const gameBets = bestGame.bets;
          const gameName = bestGame.key.replace("|", " vs ");
          const [home, away] = bestGame.key.split("|");
          const legs: any[] = [];
          const usedPlayers = new Set<string>();
          const usedStats = new Set<string>();

          for (const b of gameBets.sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))) {
            if (legs.length >= sgpLegs) break;
            if (b.playerName && usedPlayers.has(b.playerName.toLowerCase())) continue;
            // Avoid duplicate stat categories (e.g. two "points" props)
            const statKey = (b.title ?? "").toLowerCase().match(/over|under/i) ? b.title.toLowerCase().replace(/[\d.]/g, "").trim() : b.title.toLowerCase();
            if (usedStats.has(statKey)) continue;
            legs.push(b);
            if (b.playerName) usedPlayers.add(b.playerName.toLowerCase());
            usedStats.add(statKey);
          }

          // If still short, pad from other games
          if (legs.length < sgpLegs) {
            const extra = propPool
              .map(p => p.bet)
              .filter(b => !legs.find(l => l.id === b.id) && (b.confidenceScore ?? 0) >= 65)
              .slice(0, sgpLegs - legs.length);
            legs.push(...extra);
          }

          relatedBets = legs.map(b => serializeBet(b, "sgp leg"));
          const avgConf = legs.length ? Math.round(legs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / legs.length) : 0;
          const verdict = avgConf >= 80 ? "🔥 HIGH CONFIDENCE SGP" : avgConf >= 70 ? "⚡ SOLID SGP" : "⚠️ MODERATE SGP";

          const legsText = legs.map((b, i) => {
            const conf = b.confidenceScore ?? 0;
            const confVerdict = conf >= 82 ? "✅" : conf >= 70 ? "⚠️" : "❌";
            const line = b.line != null ? ` | Line: ${b.line}` : "";
            const odds = b.overOdds != null ? ` (${b.overOdds > 0 ? "+" : ""}${b.overOdds})` : "";
            const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 120) ?? "";
            return `**Leg ${i+1}: ${b.title}**${line}${odds}\n   ${confVerdict} Confidence: ${conf}/100 | Player: ${b.playerName ?? "—"}\n   Why: ${why}`;
          }).join("\n\n");

          answer = `${verdict} — ${legs.length}-Leg SGP\n📍 Game: ${gameName}\nAvg Confidence: ${avgConf}/100\n\n${legsText}\n\n⚠️ SGP reminder: all legs must hit. Books often limit SGP payouts on correlated props (e.g. a player scoring more often leads to more assists). Check your book's SGP rules before placing.`;
        }

      // ─── PARLAY MODE ────────────────────────────────────────────────────────
      } else if (isParlayRequest) {
        const n = Math.min(Math.max(parlayLegs, 2), 8); // clamp 2-8 legs

        // Pick the top N bets, filtered by sport if specified, prioritizing props
        let pool = bets.filter((b) => {
          if (sportFilter && b.sport !== sportFilter) return false;
          return (b.confidenceScore ?? 0) >= 70;
        }).sort(byConf);

        // Prefer player props if "player parlay" was mentioned
        if (q.includes("player")) {
          const props = pool.filter((b) => b.betType === "player_prop");
          if (props.length >= n) pool = props;
        }

        // Deduplicate: no two legs from same player
        const legs: any[] = [];
        const usedPlayers = new Set<string>();
        const usedGames = new Map<string, number>(); // gameKey -> count
        for (const b of pool) {
          if (legs.length >= n) break;
          // Skip duplicate same player
          if (b.playerName && usedPlayers.has(b.playerName.toLowerCase())) continue;
          // Max 2 legs from same game
          const gameKey = [b.homeTeam, b.awayTeam].filter(Boolean).sort().join("|");
          if (gameKey && (usedGames.get(gameKey) ?? 0) >= 2) continue;
          legs.push(b);
          if (b.playerName) usedPlayers.add(b.playerName.toLowerCase());
          if (gameKey) usedGames.set(gameKey, (usedGames.get(gameKey) ?? 0) + 1);
        }

        // Fallback: if not enough legs with filters, add top high-conf bets
        if (legs.length < n) {
          const fallback = bets.filter((b) => !legs.find((l) => l.id === b.id) && (b.confidenceScore ?? 0) >= 65)
            .sort(byConf).slice(0, n - legs.length);
          legs.push(...fallback);
        }

        relatedBets = legs.map((b) => serializeBet(b, "parlay leg"));

        // Build the written answer
        const sportLabel = sportFilter ? sportFilter : "multi-sport";
        const legsText = legs.map((b, i) => {
          const conf = b.confidenceScore ?? 0;
          const verdict = conf >= 85 ? "✅ Strong" : conf >= 75 ? "⚠️ Moderate" : "⚠️ Risky";
          const line = b.line != null ? ` (Line: ${b.line})` : "";
          const odds = b.overOdds != null
            ? ` — Over ${b.overOdds > 0 ? "+" : ""}${b.overOdds} / Under ${b.underOdds ?? "?"}` : "";
          const matchup = b.awayTeam && b.homeTeam ? `\n   🏀 ${b.awayTeam} @ ${b.homeTeam}` : "";
          const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 120) ?? "Market consensus";
          return `**Leg ${i + 1}: ${b.title}**${line}${odds}\n   Confidence: ${conf}/100 ${verdict}${matchup}\n   Why: ${why}`;
        }).join("\n\n");

        const avgConf = legs.length ? Math.round(legs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / legs.length) : 0;
        const combinedVerdict = avgConf >= 82 ? "🔥 STRONG PARLAY" : avgConf >= 72 ? "⚠️ MODERATE PARLAY" : "❌ HIGH RISK PARLAY";

        answer = `${combinedVerdict} — ${n}-Leg ${sportLabel} Parlay (avg confidence: ${avgConf}/100)\n\n${legsText}\n\n⚠️ Parlay reminder: each leg must hit. The more legs, the higher the payout but lower the overall probability. Consider splitting into 2-leg parlays to reduce risk.`;

      // ─── SPECIFIC BET / PLAYER / TEAM QUESTION MODE ──────────────────────────
      } else {
        const topDirect = scored.filter((s) => s.score > 0).slice(0, Math.max(4, isTopPicksRequest ? 6 : 4));
        const context = topDirect.length > 0
          ? topDirect.map((s) => s.bet)
          : bets.filter((b) => {
              if (sportFilter && b.sport !== sportFilter) return false;
              return (b.confidenceScore ?? 0) >= 78;
            }).sort(byConf).slice(0, 5);

        const contextText = context.map((b, i) => betSummary(b, i + 1)).join("\n\n");

        // Build similar bets for the cards panel (different from the main context)
        const seen = new Set(context.map((b) => b.id));
        const topBet = context[0];
        const poolA = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (topBet?.playerName && b.playerName &&
              b.playerName.toLowerCase().includes(topBet.playerName.split(" ")[0].toLowerCase())) return true;
          if (b.playerName && words.some((w) => b.playerName!.toLowerCase().includes(w))) return true;
          if (b.homeTeam && words.some((w) => b.homeTeam!.toLowerCase().includes(w))) return true;
          if (b.awayTeam && words.some((w) => b.awayTeam!.toLowerCase().includes(w))) return true;
          return false;
        }).sort(byConf).slice(0, 3);
        poolA.forEach((b) => seen.add(b.id));

        const poolB = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (b.betType !== (topBet?.betType ?? "player_prop")) return false;
          if (topBet?.sport && b.sport !== topBet.sport) return false;
          return (b.confidenceScore ?? 0) >= 75;
        }).sort(byConf).slice(0, 3);
        poolB.forEach((b) => seen.add(b.id));

        const poolC = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (sportFilter && b.sport !== sportFilter) return false;
          return b.betType === "player_prop" && (b.confidenceScore ?? 0) >= 80;
        }).sort(byConf).slice(0, 2);

        relatedBets = [...context, ...poolA, ...poolB, ...poolC]
          .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
          .sort(byConf).slice(0, 6)
          .map((b) => serializeBet(
            b,
            context.some((c) => c.id === b.id) ? "direct match"
              : poolA.some((p) => p.id === b.id) ? "same player/team"
              : poolB.some((p) => p.id === b.id) ? "same bet type" : "high confidence pick"
          ));

        const openaiKey = process.env.OPENAI_API_KEY;

        if (openaiKey) {
          const axiosLib = (await import("axios")).default;
          const systemPrompt = `You are PropEdge, an expert sports betting analyst with access to live odds from DraftKings, FanDuel, BetMGM, and William Hill. Answer the user's EXACT question using the provided live bet data. Be direct and specific. If they ask about a specific player/team/bet, analyze exactly that. If they ask for a list or recommendations, provide that specific number. Always cite confidence scores and key factors.`;
          const userPrompt = `Live database: ${totalBets} bets, ${propCount} player props, ${highConfCount} high-confidence (80+/100).

Relevant bets from live data:
${contextText || "No direct matches found."}

User question: "${question}"

Answer their question exactly as asked. Include specific bet titles, confidence scores, and why each is a good or bad pick.`;
          try {
            const aiRes = await axiosLib.post(
              "https://api.openai.com/v1/chat/completions",
              { model: "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 600, temperature: 0.3 },
              { headers: { Authorization: `Bearer ${openaiKey}` }, timeout: 20000 }
            );
            answer = aiRes.data.choices[0].message.content.trim();
          } catch (e: any) {
            answer = buildRuleBasedAnswer(context, question, totalBets, propCount, highConfCount, sportFilter);
          }
        } else {
          answer = buildRuleBasedAnswer(context, question, totalBets, propCount, highConfCount, sportFilter);
        }
      }

      res.json({ answer, relatedBets });
    } catch (e: any) {
      console.error("Ask error:", e.message);
      res.status(500).json({ error: "Analysis failed: " + e.message });
    }
  });

  // Rule-based answer builder (used when OpenAI key not set)
  function buildRuleBasedAnswer(
    context: any[], question: string, totalBets: number, propCount: number, highConfCount: number, sportFilter: string | null
  ): string {
    if (context.length === 0) {
      const sportMsg = sportFilter ? ` for ${sportFilter}` : "";
      return `No matching bets found${sportMsg}. Database has ${totalBets} total (${propCount} props, ${highConfCount} high-confidence). Try asking about a specific player or team.`;
    }

    const isTopPicks = context.length > 1;
    if (isTopPicks) {
      const lines = context.map((b, i) => {
        const conf = b.confidenceScore ?? 0;
        const verdict = conf >= 82 ? "✅" : conf >= 70 ? "⚠️" : "❌";
        const lineStr = b.line != null ? ` (${b.line})` : "";
        const factors = b.keyFactors?.slice(0, 2).join("; ") ?? "";
        return `${verdict} **${b.title}**${lineStr} — ${conf}/100\n   ${factors || b.researchSummary?.slice(0, 100) || ""}`;
      }).join("\n\n");
      const sportLabel = sportFilter ? `${sportFilter} ` : "";
      return `📊 Top ${sportLabel}picks right now:\n\n${lines}`;
    }

    const top = context[0];
    const conf = top.confidenceScore ?? 0;
    const verdict = conf >= 80 ? "✅ STRONG BET" : conf >= 65 ? "⚠️ MODERATE" : "❌ LOW CONFIDENCE";
    const lineStr = top.line != null ? ` | Line: ${top.line}` : "";
    const overStr = top.overOdds != null ? ` | Over ${top.overOdds > 0 ? "+" : ""}${top.overOdds} / Under ${top.underOdds ?? "?"}` : "";
    const factors = top.keyFactors?.slice(0, 3).join(", ") ?? "market consensus";
    const allocStr = top.recommendedAllocation ? ` Suggested: ${top.recommendedAllocation}% bankroll.` : "";
    const research = top.researchSummary ? ` ${top.researchSummary.slice(0, 180)}` : "";
    return `${verdict}\n\n**${top.title}** — Confidence ${conf}/100 | Risk: ${top.riskLevel ?? "medium"}${lineStr}${overStr}\n${allocStr}\nKey factors: ${factors}.${research}`;
  }

  app.get("/api/stats", async (req, res) => {
    try {
      const bets = await storage.getBets();
      const settings = await storage.getSettings();
      const threshold = settings.confidenceThreshold ?? 80;

      const total = bets.length;
      const highConf = bets.filter((b) => (b.confidenceScore ?? 0) >= threshold).length;
      const bySource = bets.reduce((acc, b) => {
        acc[b.source] = (acc[b.source] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const bySport = bets.reduce((acc, b) => {
        acc[b.sport] = (acc[b.sport] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const avgScore = bets.length
        ? Math.round(bets.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / bets.length)
        : 0;

      res.json({ total, highConf, bySource, bySport, avgScore, threshold });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tracked Props ──────────────────────────────────────────────────────────
  app.get("/api/tracked-props", async (req, res) => {
    try {
      res.json(await storage.getTrackedProps());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tracked-props", async (req, res) => {
    try {
      const { nanoid } = await import("nanoid");
      const prop = await storage.addTrackedProp({ ...req.body, id: nanoid() });
      res.json(prop);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/tracked-props/:id", async (req, res) => {
    try {
      const prop = await storage.updateTrackedProp(req.params.id, req.body);
      if (!prop) return res.status(404).json({ error: "Not found" });
      res.json(prop);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/tracked-props/:id", async (req, res) => {
    try {
      await storage.deleteTrackedProp(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Refresh Tracked Props: auto-fetch live stats from ESPN + BBR ──────────
  app.post("/api/refresh-tracked-props", async (req, res) => {
    const axiosLib = (await import("axios")).default;
    const cheerio = (await import("cheerio")).load;
    const props = await storage.getTrackedProps();
    const activeProps = props.filter(p => p.status === "active");

    if (activeProps.length === 0) {
      return res.json({ updated: 0, message: "No active props to refresh" });
    }

    // ESPN athlete lookup: search by name, return season stats
    async function espnAthleteStats(playerName: string, sport: string): Promise<{ stats: Record<string, number>; source: string; athleteId?: string } | null> {
      const sportMap: Record<string, { slug: string; statsUrl: (id: string) => string }> = {
        NBA: {
          slug: "basketball/nba",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/stats?season=2025&seasontype=2`,
        },
        NFL: {
          slug: "football/nfl",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/stats?season=2024&seasontype=2`,
        },
        MLB: {
          slug: "baseball/mlb",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${id}/stats?season=2025&seasontype=2`,
        },
        NHL: {
          slug: "hockey/nhl",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${id}/stats?season=2025&seasontype=2`,
        },
      };
      const sportCfg = sportMap[sport];
      if (!sportCfg) return null;

      try {
        // Step 1: Find athlete by name
        const searchUrl = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(playerName)}&limit=5&type=athlete&sport=${sportCfg.slug}`;
        const searchResp = await axiosLib.get(searchUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
        const hits = searchResp.data?.athletes ?? searchResp.data?.results ?? [];
        let athleteId: string | null = null;
        // Find best name match
        const nameLower = playerName.toLowerCase();
        for (const hit of hits) {
          const candidate = (hit?.name ?? hit?.displayName ?? "").toLowerCase();
          if (candidate.includes(nameLower.split(" ")[0]) || nameLower.includes(candidate.split(" ")[0])) {
            athleteId = hit?.id ?? hit?.uid?.replace(/^.*athlete:\/\//,"") ?? null;
            break;
          }
        }
        if (!athleteId && hits.length > 0) athleteId = hits[0]?.id ?? null;
        if (!athleteId) return null;

        // Step 2: Get season stats
        const statsResp = await axiosLib.get(sportCfg.statsUrl(athleteId), { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
        const statsData = statsResp.data;

        // ESPN stats come as parallel arrays: categories[].stats[].name + values[]
        const parsed: Record<string, number> = {};
        const cats = statsData?.stats?.splits?.categories ?? statsData?.splits?.categories ?? [];
        for (const cat of cats) {
          const names: string[] = cat.names ?? [];
          const values: any[] = cat.values ?? [];
          names.forEach((name, i) => {
            const v = parseFloat(values[i]);
            if (!isNaN(v)) parsed[name.toLowerCase()] = v;
          });
        }
        // Fallback: top-level stats object
        if (Object.keys(parsed).length === 0) {
          const flat = statsData?.athlete?.statistics ?? statsData?.statistics ?? {};
          for (const [k, v] of Object.entries(flat)) {
            const n = parseFloat(String(v));
            if (!isNaN(n)) parsed[k.toLowerCase()] = n;
          }
        }

        return Object.keys(parsed).length > 0 ? { stats: parsed, source: "ESPN", athleteId } : null;
      } catch (e: any) {
        console.warn(`[refresh] ESPN lookup failed for ${playerName} (${sport}):`, e.message);
        return null;
      }
    }

    // Baseball Reference season stats scrape (for MLB season_long props)
    async function bbrSeasonStats(playerName: string): Promise<{ stats: Record<string, number>; source: string } | null> {
      try {
        const query = playerName.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, "+");
        const searchUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${query}&pid=&type=&redirect=1`;
        const { data: html } = await axiosLib.get(searchUrl, {
          timeout: 12000,
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          maxRedirects: 5,
        });
        const $ = cheerio(html);
        // Parse the standard stats table (batting or pitching)
        const stats: Record<string, number> = {};
        // Try to get 2025 season row from #batting_standard or #pitching_standard
        const tables = ["#batting_standard", "#pitching_standard", "#standard_fielding"];
        for (const tableId of tables) {
          const rows = $(tableId).find("tbody tr").toArray();
          // Find 2025 season row
          for (const row of rows) {
            const yr = $(row).find("[data-stat='year_id']").text().trim();
            if (yr === "2025") {
              const fields = [
                "G","PA","AB","R","H","2B","3B","HR","RBI","SB","BB","SO","BA","OBP","SLG",
                "W","L","ERA","GS","CG","SHO","SV","IP","H_allowed","ER","BB_allowed","SO_pitcher"
              ];
              for (const f of fields) {
                const v = parseFloat($(row).find(`[data-stat='${f.toLowerCase()}']`).text().trim());
                if (!isNaN(v)) stats[f.toLowerCase()] = v;
              }
              // Fallback: try attribute names
              $(row).find("[data-stat]").each((_, el) => {
                const attr = $(el).attr("data-stat") ?? "";
                const v = parseFloat($(el).text().trim());
                if (attr && !isNaN(v)) stats[attr.toLowerCase()] = v;
              });
              if (Object.keys(stats).length > 0) break;
            }
          }
          if (Object.keys(stats).length > 0) break;
        }
        return Object.keys(stats).length > 0 ? { stats, source: "Baseball Reference" } : null;
      } catch (e: any) {
        console.warn(`[refresh] BBR failed for ${playerName}:`, e.message);
        return null;
      }
    }

    // Map TrackedProp statCategory → ESPN stat key(s) to try
    function mapStatCategory(statCategory: string, sport: string): string[] {
      const cat = statCategory.toLowerCase();
      if (sport === "NBA") {
        if (cat.includes("point")) return ["pts", "points", "avgpoints"];
        if (cat.includes("assist")) return ["ast", "assists", "avgassists"];
        if (cat.includes("rebound")) return ["reb", "rebounds", "totalrebounds", "avgtotalrebounds"];
        if (cat.includes("3-point") || cat.includes("3pt") || cat.includes("three")) return ["3pm", "threepointersmade", "3ptm"];
        if (cat.includes("steal")) return ["stl", "steals", "avgsteals"];
        if (cat.includes("block")) return ["blk", "blocks", "avgblocks"];
        if (cat.includes("minute")) return ["min", "minutes", "avgminutes"];
        if (cat.includes("pra") || cat.includes("+")) return ["pts", "points"]; // sum multiple
      }
      if (sport === "NFL") {
        if (cat.includes("passing yard")) return ["passingyards", "yds", "yards"];
        if (cat.includes("passing td")) return ["passingtouchdowns", "td", "touchdowns"];
        if (cat.includes("rushing yard")) return ["rushingyards", "yds"];
        if (cat.includes("receiving yard")) return ["receivingyards", "yds"];
        if (cat.includes("reception")) return ["receptions", "rec"];
        if (cat.includes("interception")) return ["interceptions", "int"];
        if (cat.includes("tackle")) return ["totaltackles", "tackles", "tot"];
        if (cat.includes("sack")) return ["sacks"];
      }
      if (sport === "MLB") {
        if (cat.includes("home run")) return ["hr"];
        if (cat.includes("rbi")) return ["rbi"];
        if (cat.includes("hit") && !cat.includes("pitcher")) return ["h"];
        if (cat.includes("strikeout") || cat.includes("k")) return ["so", "so_pitcher", "k"];
        if (cat.includes("era")) return ["era"];
        if (cat.includes("stolen base")) return ["sb"];
        if (cat.includes("batting avg")) return ["ba", "avg"];
      }
      if (sport === "NHL") {
        if (cat.includes("goal")) return ["goals", "g"];
        if (cat.includes("assist")) return ["assists", "a"];
        if (cat.includes("point")) return ["points", "pts"];
        if (cat.includes("shot")) return ["shots", "sog", "s"];
        if (cat.includes("save")) return ["savepct", "svpct", "sv%"];
        if (cat.includes("+/-") || cat.includes("plus")) return ["plusminus", "+/-"];
      }
      return [];
    }

    function extractStatValue(statsRecord: Record<string, number>, keys: string[]): number | null {
      for (const k of keys) {
        if (statsRecord[k] !== undefined) return statsRecord[k];
      }
      // partial match
      for (const k of keys) {
        const found = Object.keys(statsRecord).find(sk => sk.includes(k) || k.includes(sk));
        if (found) return statsRecord[found];
      }
      return null;
    }

    // Process each active prop
    const results: Array<{ id: string; playerName: string; sport: string; statCategory: string; oldValue: number | null; newValue: number | null; gamesPlayed: number | null; source: string; status: string }> = [];
    let updatedCount = 0;

    for (const prop of activeProps) {
      let fetchedStats: { stats: Record<string, number>; source: string } | null = null;

      // Try ESPN first (all sports)
      const espnResult = await espnAthleteStats(prop.playerName, prop.sport);
      if (espnResult) fetchedStats = espnResult;

      // For MLB, also try Baseball Reference as backup
      if (!fetchedStats && prop.sport === "MLB") {
        fetchedStats = await bbrSeasonStats(prop.playerName);
      }

      if (!fetchedStats) {
        results.push({ id: prop.id, playerName: prop.playerName, sport: prop.sport, statCategory: prop.statCategory, oldValue: prop.currentValue ?? null, newValue: null, gamesPlayed: prop.gamesPlayed ?? null, source: "not found", status: "no_data" });
        continue;
      }

      const statKeys = mapStatCategory(prop.statCategory, prop.sport);
      let newValue = extractStatValue(fetchedStats.stats, statKeys);

      // Special case: PRA (Points+Rebounds+Assists) — sum the three
      if (!newValue && prop.statCategory.toLowerCase().includes("+")) {
        const pts = extractStatValue(fetchedStats.stats, ["pts","points"]) ?? 0;
        const reb = extractStatValue(fetchedStats.stats, ["reb","rebounds","totalrebounds"]) ?? 0;
        const ast = extractStatValue(fetchedStats.stats, ["ast","assists"]) ?? 0;
        if (pts || reb || ast) newValue = pts + reb + ast;
      }

      // Extract games played
      const gamesPlayed = extractStatValue(fetchedStats.stats, ["gp","games","g","gamesplayed"]);

      // Determine new status: if season_long, check if target already hit/missed
      let newStatus: string = prop.status ?? "active";
      if (newValue !== null && prop.propType === "season_long" && prop.status === "active") {
        if (prop.direction === "over" && newValue >= prop.targetLine) newStatus = "hit";
        // (don't auto-mark as missed for season_long — season may not be over)
      }

      const updatePayload: any = { updatedAt: new Date() };
      if (newValue !== null) updatePayload.currentValue = newValue;
      if (gamesPlayed !== null) updatePayload.gamesPlayed = Math.round(gamesPlayed);
      if (newStatus !== prop.status) updatePayload.status = newStatus;
      // Store source in notes if not already there
      if (fetchedStats.source && !(prop.notes ?? "").includes(fetchedStats.source)) {
        updatePayload.notes = prop.notes ? `${prop.notes} | 📡 ${fetchedStats.source}` : `📡 Auto-updated from ${fetchedStats.source}`;
      }

      await storage.updateTrackedProp(prop.id, updatePayload);
      updatedCount++;

      results.push({
        id: prop.id,
        playerName: prop.playerName,
        sport: prop.sport,
        statCategory: prop.statCategory,
        oldValue: prop.currentValue ?? null,
        newValue: newValue ?? null,
        gamesPlayed: gamesPlayed ? Math.round(gamesPlayed) : (prop.gamesPlayed ?? null),
        source: fetchedStats.source,
        status: newStatus,
      });
    }

    console.log(`[refresh-tracked-props] Updated ${updatedCount}/${activeProps.length} props`);
    res.json({
      updated: updatedCount,
      total: activeProps.length,
      results,
      refreshedAt: new Date().toISOString(),
    });
  });

  // ─── Debug endpoint: test each data source independently ─────────────────
  app.get("/api/debug-scan", async (req, res) => {
    const results: Record<string, any> = {};
    const axios = (await import("axios")).default;

    // 1. Underdog
    try {
      const { data } = await axios.get(
        "https://api.underdogfantasy.com/beta/v5/over_under_lines",
        {
          headers: {
            "User-Agent": "UnderdogFantasy/2.0 (com.underdogfantasy.app; build:500; iOS 17.0; iPhone14,3)",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "X-Platform": "ios",
            "X-App-Version": "2.0.0",
          },
          timeout: 20000,
          decompress: true,
        }
      );
      const lines = data?.over_under_lines ?? [];
      const active = lines.filter((l: any) => l.status === "active");
      results.underdog = { ok: true, total: lines.length, active: active.length };
    } catch (e: any) {
      results.underdog = { ok: false, error: e.message, code: e.response?.status };
    }

    // 2. SportsGameOdds
    const sgoKey = process.env.SGO_API_KEY;
    if (!sgoKey) {
      results.sgo = { ok: false, error: "SGO_API_KEY not set" };
    } else {
      try {
        const { data } = await axios.get(
          `https://api.sportsgameodds.com/v2/events?leagueID=NBA&oddID=points-PLAYER_ID-game-ou-over&ended=false&cancelled=false&includeOpposingOdds=true&apiKey=${sgoKey}`,
          { timeout: 15000 }
        );
        results.sgo = { ok: data.success, count: data.data?.length ?? 0, raw: data.success ? undefined : data };
      } catch (e: any) {
        results.sgo = { ok: false, error: e.message, code: e.response?.status };
      }
    }

    // 3. Odds API
    const oddsKey = process.env.ODDS_API_KEY;
    if (!oddsKey) {
      results.oddsApi = { ok: false, error: "ODDS_API_KEY not set" };
    } else {
      try {
        const { data } = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${oddsKey}&regions=us&markets=h2h&bookmakers=draftkings&oddsFormat=american`,
          { timeout: 15000 }
        );
        results.oddsApi = { ok: true, games: data.length };
      } catch (e: any) {
        results.oddsApi = { ok: false, error: e.message, code: e.response?.status };
      }
    }

    // 4. ActionNetwork
    try {
      const { data } = await axios.get(
        "https://api.actionnetwork.com/web/v1/scoreboard/nba?period=game&bookIds=15,30,76,123&date=" +
        new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        { timeout: 10000 }
      );
      results.actionNetwork = { ok: true, games: data?.games?.length ?? 0 };
    } catch (e: any) {
      results.actionNetwork = { ok: false, error: e.message };
    }

    // 5. Env vars present
    results.envVars = {
      ODDS_API_KEY: !!process.env.ODDS_API_KEY,
      SGO_API_KEY: !!process.env.SGO_API_KEY,
      ACTION_NETWORK_KEY: !!process.env.ACTION_NETWORK_KEY,
      API_SPORTS_KEY: !!process.env.API_SPORTS_KEY,
    };

    // 6. Current bets in DB
    const bets = await storage.getBets();
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const b of bets) {
      byType[b.betType ?? "unknown"] = (byType[b.betType ?? "unknown"] ?? 0) + 1;
      bySource[b.source ?? "unknown"] = (bySource[b.source ?? "unknown"] ?? 0) + 1;
    }
    results.currentBets = { total: bets.length, byType, bySource };

    res.json(results);
  });

  // Initial scan on startup with retry — ensures props load even if first attempt fails
  const startupScan = async (attempt = 1) => {
    try {
      console.log(`[startup] scan attempt ${attempt}...`);
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      const bets = await storage.getBets();
      const propCount = bets.filter((b: any) => b.betType === 'player_prop').length;
      console.log(`[startup] scan done: ${result.scanned} bets, ${propCount} props`);
      // Retry if we got no props (Railway cold-start network issue)
      if (propCount === 0 && attempt < 5) {
        const delay = attempt * 15000; // 15s, 30s, 45s, 60s
        console.log(`[startup] 0 props loaded, retrying in ${delay/1000}s...`);
        setTimeout(() => startupScan(attempt + 1), delay);
      }
    } catch (e: any) {
      console.warn(`[startup] scan attempt ${attempt} failed:`, e.message);
      if (attempt < 5) {
        const delay = attempt * 15000;
        console.log(`[startup] retrying in ${delay/1000}s...`);
        setTimeout(() => startupScan(attempt + 1), delay);
      }
    }
  };
  setTimeout(() => startupScan(), 3000); // 3s delay for Railway to fully initialize

  // Auto-scan every 30 min — broadcast result to all WS clients
  scanInterval = setInterval(async () => {
    try {
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      const allBets = await storage.getBets();
      broadcast("bets:updated", { scanned: result.scanned, total: allBets.length, auto: true });
      const highConf = allBets.filter((b: any) => (b.confidenceScore ?? 0) >= 80);
      if (highConf.length > 0) {
        broadcast("bets:highconf", { count: highConf.length, top: highConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })) });
      }
    } catch (e: any) {
      console.warn("[auto-scan] error:", e.message);
    }
  }, 30 * 60 * 1000);

  // ── CLV Line Value Tracker ───────────────────────────────────────────────

  // Compute sharpness score from lineMovePct and speed (0-100)
  function computeSharpness(openingLine: number | null, currentLine: number | null, openingOdds: number | null, currentOdds: number | null, createdAt: Date | null): number {
    if (openingLine == null || currentLine == null || openingLine === 0) return 0;
    const movePct = Math.abs((currentLine - openingLine) / Math.abs(openingLine)) * 100;
    // Speed factor: hours since creation (faster = sharper)
    const hoursElapsed = createdAt ? (Date.now() - createdAt.getTime()) / 3600000 : 24;
    const speedFactor = Math.max(0, 1 - hoursElapsed / 48); // decays over 48h
    // Odds movement factor
    let oddsFactor = 0;
    if (openingOdds != null && currentOdds != null) {
      const oddsMove = Math.abs(currentOdds - openingOdds);
      oddsFactor = Math.min(oddsMove / 30, 1); // 30 cent move = full factor
    }
    const raw = movePct * 4 + speedFactor * 20 + oddsFactor * 30;
    return Math.min(100, Math.round(raw));
  }

  // Fire alert if threshold crossed
  async function maybeFireClvAlert(line: any, prevLine: number | null, prevOdds: number | null): Promise<void> {
    if (line.openingLine == null || line.currentLine == null) return;
    if (line.openingLine === 0) return;
    const movePct = ((line.currentLine - line.openingLine) / Math.abs(line.openingLine)) * 100;
    const absPct = Math.abs(movePct);
    const threshold = line.alertThreshold ?? 10;
    if (absPct < threshold) return;
    // Direction check
    const direction = line.alertDirection ?? "both";
    if (direction === "favor" && movePct <= 0) return;
    if (direction === "against" && movePct >= 0) return;
    // Check we haven't already fired for this move
    const existing = await storage.getClvAlertsByLine(line.id);
    const alreadyFired = existing.some((a: any) => Math.abs(a.movePct ?? 0) >= absPct - 0.5);
    if (alreadyFired) return;
    const alertType = absPct >= threshold * 2 ? "sharp_move" : (movePct > 0 ? "move_favor" : "move_against");
    const dirLabel = movePct > 0 ? "in your favor" : "against you";
    await storage.addClvAlert({
      id: crypto.randomUUID(),
      clvLineId: line.id,
      alertType,
      message: `${line.outcomeLabel} moved ${movePct > 0 ? "+" : ""}${movePct.toFixed(1)}% ${dirLabel} (threshold: ${threshold}%)`,
      movePct,
      fromLine: line.openingLine,
      toLine: line.currentLine,
      fromOdds: line.openingOdds ?? null,
      toOdds: line.currentOdds ?? null,
      dismissed: false,
    });
  }

  app.get("/api/clv", async (req, res) => {
    try {
      const lines = await storage.getClvLines();
      res.json(lines);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/clv", async (req, res) => {
    try {
      const body = req.body;
      const line = await storage.addClvLine({
        id: crypto.randomUUID(),
        ...body,
      });
      // Auto-add opening snapshot
      if (line.openingLine != null || line.openingOdds != null) {
        await storage.addClvSnapshot({
          id: crypto.randomUUID(),
          clvLineId: line.id,
          book: line.book,
          line: line.openingLine,
          odds: line.openingOdds,
        });
      }
      res.status(201).json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv/:id", async (req, res) => {
    try {
      const line = await storage.getClvLineById(req.params.id);
      if (!line) return res.status(404).json({ error: "Not found" });
      res.json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/clv/:id", async (req, res) => {
    try {
      const existing = await storage.getClvLineById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const update = req.body;
      // Compute derived fields on update
      const newCurrentLine = update.currentLine ?? existing.currentLine;
      const newCurrentOdds = update.currentOdds ?? existing.currentOdds;
      const openingLine = existing.openingLine;
      let lineMovePct: number | null = null;
      if (openingLine != null && openingLine !== 0 && newCurrentLine != null) {
        lineMovePct = ((newCurrentLine - openingLine) / Math.abs(openingLine)) * 100;
      }
      const sharpnessScore = computeSharpness(openingLine, newCurrentLine, existing.openingOdds, newCurrentOdds, existing.createdAt);
      // If closing line provided, compute CLV
      let clvBeat: boolean | null = existing.clvBeat;
      let clvDelta: number | null = existing.clvDelta;
      const closingLine = update.closingLine ?? existing.closingLine;
      if (closingLine != null && openingLine != null) {
        clvDelta = closingLine - openingLine;
        clvBeat = clvDelta > 0;
      }
      const updated = await storage.updateClvLine(req.params.id, {
        ...update,
        lineMovePct,
        sharpnessScore,
        clvBeat,
        clvDelta,
      });
      // Add snapshot for current line
      if (update.currentLine != null || update.currentOdds != null) {
        await storage.addClvSnapshot({
          id: crypto.randomUUID(),
          clvLineId: req.params.id,
          book: existing.book,
          line: newCurrentLine,
          odds: newCurrentOdds,
        });
      }
      // Maybe fire alert
      if (updated) await maybeFireClvAlert(updated, existing.currentLine, existing.currentOdds);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/clv/:id", async (req, res) => {
    try {
      await storage.deleteClvLine(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv/:id/snapshots", async (req, res) => {
    try {
      const snaps = await storage.getClvSnapshots(req.params.id);
      res.json(snaps);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv-alerts", async (req, res) => {
    try {
      const alerts = await storage.getClvAlerts();
      res.json(alerts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/clv-alerts/:id/dismiss", async (req, res) => {
    try {
      await storage.dismissClvAlert(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Line Movement: auto-pull opening vs current lines from ActionNetwork ───────────
  const LINE_MOVEMENT_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_TTL = 5 * 60 * 1000; // 5-min cache

  // ── Proactive game-time lookup: populated at startup + every 15 min ──────
  // Maps "awayTeamLower::homeTeamLower" → ISO gameTime string, for all 4 sports today.
  // Used by /api/bets to fill null gameTime on Kalshi player props.
  const GAME_TIME_LOOKUP = new Map<string, string>(); // "away::home" → ISO string
  const TEAM_WORD_LOOKUP = new Map<string, string>(); // teamWord → ISO string
  let gameTimeLookupLastFetch = 0;
  const GAME_TIME_TTL = 15 * 60 * 1000;

  async function refreshGameTimeLookup() {
    if (Date.now() - gameTimeLookupLastFetch < GAME_TIME_TTL) return;
    try {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const sports = ["nba", "mlb", "nhl", "nfl"];
      const ACTION_BOOK_IDS = "15,68,30";
      await Promise.allSettled(sports.map(async (slug) => {
        try {
          const url = `https://api.actionnetwork.com/web/v1/scoreboard/publicbetting/${slug}?period=game&bookIds=${ACTION_BOOK_IDS}&date=${today}`;
          const { data } = await axios.get(url, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.actionnetwork.com/" },
          });
          const games: any[] = data?.games ?? data?.scoreboard ?? [];
          for (const game of games) {
            const st = game.start_time ?? null;
            if (!st) continue;
            const teams: any[] = game.teams ?? [];
            const awayTeam = (teams.find((t: any) => t.id === game.away_team_id)?.full_name ?? "").toLowerCase();
            const homeTeam = (teams.find((t: any) => t.id === game.home_team_id)?.full_name ?? "").toLowerCase();
            if (awayTeam && homeTeam) {
              GAME_TIME_LOOKUP.set(`${awayTeam}::${homeTeam}`, st);
              // Also index individual words (>3 chars) from each team name
              for (const w of [...awayTeam.split(" "), ...homeTeam.split(" ")]) {
                const wl = w.trim();
                if (wl.length > 3) TEAM_WORD_LOOKUP.set(wl, st);
              }
            }
          }
        } catch { /* ignore per-sport errors */ }
      }));
      gameTimeLookupLastFetch = Date.now();
    } catch { /* ignore */ }
  }

  // Kick off initial fetch immediately (don't await — non-blocking)
  refreshGameTimeLookup().catch(() => {});

  app.get("/api/line-movement", async (req, res) => {
    try {
      const cacheKey = "lm";
      const cached = LINE_MOVEMENT_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LM_TTL) {
        return res.json(cached.data);
      }

      const ACTION_BOOK_IDS = "15,68,30";
      // ActionNetwork requires YYYYMMDD format (no dashes); bearer auth causes 400
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const sports = [
        { slug: "nba",   label: "NBA" },
        { slug: "mlb",   label: "MLB" },
        { slug: "nhl",   label: "NHL" },
        { slug: "nfl",   label: "NFL" },
      ];

      const results: any[] = [];

      await Promise.allSettled(sports.map(async ({ slug, label }) => {
        try {
          const url = `https://api.actionnetwork.com/web/v1/scoreboard/publicbetting/${slug}?period=game&bookIds=${ACTION_BOOK_IDS}&date=${today}`;
          const headers: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://www.actionnetwork.com/",
          };

          const { data } = await axios.get(url, { timeout: 10000, headers });
          const games: any[] = data?.games ?? data?.scoreboard ?? [];

          for (const game of games) {
            const status = game.status ?? "";
            if (status === "complete" || status === "closed" || status === "final") continue;

            const teams: any[] = game.teams ?? [];
            const awayTeamObj = teams.find((t: any) => t.id === game.away_team_id) ?? teams[0] ?? {};
            const homeTeamObj = teams.find((t: any) => t.id === game.home_team_id) ?? teams[1] ?? {};
            const awayTeam = awayTeamObj.full_name ?? awayTeamObj.display_name ?? "Away";
            const homeTeam = homeTeamObj.full_name ?? homeTeamObj.display_name ?? "Home";
            const gameTime = game.start_time ?? null;

            // Sort all odds entries by inserted time
            const oddsArr: any[] = (game.odds ?? []).sort((a: any, b: any) =>
              (a.inserted ?? "").localeCompare(b.inserted ?? "")
            );
            if (oddsArr.length < 1) continue;

            const opening = oddsArr[0];
            // Current = the entry with the most public/money data (auth key data), else latest
            const current = oddsArr.find((o: any) => o.ml_away_money != null) ?? oddsArr[oddsArr.length - 1];

            // Spread movement
            const spreadOpen = opening.spread_away ?? null;
            const spreadCurrent = current.spread_away ?? null;
            const spreadMove = (spreadOpen != null && spreadCurrent != null) ? spreadCurrent - spreadOpen : null;

            // Total movement
            const totalOpen = opening.total ?? null;
            const totalCurrent = current.total ?? null;
            const totalMove = (totalOpen != null && totalCurrent != null) ? totalCurrent - totalOpen : null;

            // ML movement
            const mlAwayOpen = opening.ml_away ?? null;
            const mlAwayCurrent = current.ml_away ?? null;
            const mlHomeOpen = opening.ml_home ?? null;
            const mlHomeCurrent = current.ml_home ?? null;

            // Public/sharp betting %
            const spreadAwayPublic = current.spread_away_public ?? null;
            const spreadAwayMoney  = current.spread_away_money ?? null;
            const spreadHomePublic = current.spread_home_public ?? null;
            const spreadHomeMoney  = current.spread_home_money ?? null;
            const totalOverPublic  = current.total_over_public ?? null;
            const totalOverMoney   = current.total_over_money ?? null;
            const totalUnderPublic = current.total_under_public ?? null;
            const totalUnderMoney  = current.total_under_money ?? null;
            const mlAwayPublic     = current.ml_away_public ?? null;
            const mlAwayMoney      = current.ml_away_money ?? null;
            const mlHomePublic     = current.ml_home_public ?? null;
            const mlHomeMoney      = current.ml_home_money ?? null;
            const numBets          = current.num_bets ?? null;

            // Only include games that have at least one line to show
            if (spreadOpen == null && totalOpen == null && mlAwayOpen == null) continue;

            results.push({
              id: `lm-${slug}-${game.id}`,
              sport: label,
              awayTeam,
              homeTeam,
              gameTime,
              status: game.status ?? "scheduled",
              openingInserted: opening.inserted ?? null,
              currentInserted: current.inserted ?? null,
              numBets,
              spread: {
                open: spreadOpen,
                current: spreadCurrent,
                move: spreadMove,
                awayPublic: spreadAwayPublic,
                awayMoney:  spreadAwayMoney,
                homePublic: spreadHomePublic,
                homeMoney:  spreadHomeMoney,
              },
              total: {
                open: totalOpen,
                current: totalCurrent,
                move: totalMove,
                overPublic:  totalOverPublic,
                overMoney:   totalOverMoney,
                underPublic: totalUnderPublic,
                underMoney:  totalUnderMoney,
              },
              moneyline: {
                awayOpen:    mlAwayOpen,
                awayCurrent: mlAwayCurrent,
                homeOpen:    mlHomeOpen,
                homeCurrent: mlHomeCurrent,
                awayPublic:  mlAwayPublic,
                awayMoney:   mlAwayMoney,
                homePublic:  mlHomePublic,
                homeMoney:   mlHomeMoney,
              },
            });
          }
        } catch (e: any) {
          console.warn(`[LineMovement] ${slug} error:`, e.message);
        }
      }));

      // Sort: most movement first (by abs spread move + abs total move)
      results.sort((a, b) => {
        const aMove = Math.abs(a.spread?.move ?? 0) + Math.abs(a.total?.move ?? 0);
        const bMove = Math.abs(b.spread?.move ?? 0) + Math.abs(b.total?.move ?? 0);
        return bMove - aMove;
      });

      LINE_MOVEMENT_CACHE.set(cacheKey, { data: results, ts: Date.now() });
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Line Movement Intelligence: auto-research significant moves ─────────────
  const LM_RESEARCH_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_RESEARCH_TTL = 30 * 60 * 1000; // 30-min cache per game

  // Thresholds for "significant" movement
  const SIGNIFICANT_SPREAD = 1.5;  // spread moved >= 1.5 pts
  const SIGNIFICANT_TOTAL  = 1.5;  // total moved >= 1.5 pts
  const STEAM_SPREAD       = 3.0;
  const STEAM_TOTAL        = 3.0;
  const SIGNIFICANT_ML     = 30;   // ML moved >= 30 cents

  async function fetchGoogleNewsRSS(query: string): Promise<{ title: string; link: string; pubDate: string }[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
      const { data } = await axios.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const $ = cheerio.load(data, { xmlMode: true });
      const items: { title: string; link: string; pubDate: string }[] = [];
      $('item').slice(0, 5).each((_, el) => {
        items.push({
          title: $(el).find('title').text().trim(),
          link:  $(el).find('link').text().trim() || $(el).find('guid').text().trim(),
          pubDate: $(el).find('pubDate').text().trim(),
        });
      });
      return items;
    } catch { return []; }
  }

  async function fetchESPNInjuries(sport: string): Promise<{ player: string; status: string; team: string }[]> {
    const sportMap: Record<string, { sn: string; lg: string }> = {
      NBA: { sn: "basketball", lg: "nba" },
      MLB: { sn: "baseball",   lg: "mlb" },
      NHL: { sn: "hockey",     lg: "nhl" },
      NFL: { sn: "football",   lg: "nfl" },
    };
    const s = sportMap[sport];
    if (!s) return [];
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${s.sn}/${s.lg}/injuries`;
      const { data } = await axios.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const teams: any[] = data?.teams ?? [];
      const injuries: { player: string; status: string; team: string }[] = [];
      for (const team of teams) {
        const name = team.team?.displayName ?? "";
        for (const inj of (team.injuries ?? [])) {
          const pName = inj.athlete?.displayName ?? "";
          const status = inj.status ?? inj.type?.description ?? "Questionable";
          if (pName) injuries.push({ player: pName, status, team: name });
        }
      }
      return injuries;
    } catch { return []; }
  }

  async function fetchWeather(homeTeam: string, sport: string): Promise<string | null> {
    // Only outdoor sports need weather: MLB, NFL
    if (sport !== "MLB" && sport !== "NFL") return null;
    try {
      // Use wttr.in free weather API with the team city inferred from name
      // Extract city from team name (last word usually isn't city — use whole name)
      const encoded = encodeURIComponent(homeTeam.replace(/\s+(Bears|Lions|Packers|Vikings|Falcons|Panthers|Saints|Buccaneers|Cardinals|Rams|49ers|Seahawks|Cowboys|Giants|Eagles|Commanders|Bears|Browns|Steelers|Ravens|Bengals|Texans|Colts|Titans|Jaguars|Chiefs|Raiders|Chargers|Broncos|Bills|Dolphins|Patriots|Jets|Cubs|White Sox|Cardinals|Reds|Brewers|Pirates|Braves|Marlins|Mets|Phillies|Nationals|Dodgers|Giants|Padres|Rockies|Diamondbacks|Red Sox|Yankees|Blue Jays|Rays|Orioles|Royals|Indians|Tigers|Twins|White Sox|Angels|Athletics|Mariners|Rangers|Astros).*/, "").trim());
      const url = `https://wttr.in/${encoded}?format=3&m`;
      const { data } = await axios.get(url, { timeout: 5000, headers: { "User-Agent": "curl/7.64" } });
      return typeof data === "string" ? data.trim().slice(0, 80) : null;
    } catch { return null; }
  }

  function buildMovementSummary(game: any): string {
    const parts: string[] = [];
    const spreadMove = game.spread?.move;
    const totalMove  = game.total?.move;
    const mlAwayMove = (game.moneyline?.awayOpen != null && game.moneyline?.awayCurrent != null)
      ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null;
    const mlHomeMove = (game.moneyline?.homeOpen != null && game.moneyline?.homeCurrent != null)
      ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null;

    if (spreadMove != null && spreadMove !== 0) {
      const severity = Math.abs(spreadMove) >= STEAM_SPREAD ? "🔥 STEAM" : "⚡ Significant";
      parts.push(`${severity}: Spread moved ${spreadMove > 0 ? "+" : ""}${spreadMove} (${game.awayTeam} @ ${game.homeTeam})`);
    }
    if (totalMove != null && totalMove !== 0) {
      const severity = Math.abs(totalMove) >= STEAM_TOTAL ? "🔥 STEAM" : "⚡ Significant";
      parts.push(`${severity}: Total moved ${totalMove > 0 ? "+" : ""}${totalMove} (O/U ${game.total?.open} → ${game.total?.current})`);
    }
    if (mlAwayMove != null && Math.abs(mlAwayMove) >= SIGNIFICANT_ML) {
      parts.push(`ML shift: ${game.awayTeam} ML moved ${mlAwayMove > 0 ? "+" : ""}${mlAwayMove}`);
    }
    if (mlHomeMove != null && Math.abs(mlHomeMove) >= SIGNIFICANT_ML) {
      parts.push(`ML shift: ${game.homeTeam} ML moved ${mlHomeMove > 0 ? "+" : ""}${mlHomeMove}`);
    }

    // Sharp signal
    const spreadMoneyAway = game.spread?.awayMoney;
    const spreadPublicAway = game.spread?.awayPublic;
    if (spreadMoneyAway != null && spreadPublicAway != null) {
      const div = spreadMoneyAway - spreadPublicAway;
      if (spreadMoneyAway >= 65 && div >= 20)
        parts.push(`💰 Sharp: ${game.awayTeam} getting ${spreadMoneyAway}% of spread money vs ${spreadPublicAway}% public bets`);
      else if (spreadMoneyAway <= 35 && div <= -20)
        parts.push(`💰 Fade signal: ${game.awayTeam} only ${spreadMoneyAway}% of money despite public support`);
    }
    const mlMoney = game.moneyline?.awayMoney;
    const mlPublic = game.moneyline?.awayPublic;
    if (mlMoney != null && mlPublic != null) {
      const div = mlMoney - mlPublic;
      if (mlMoney >= 65 && div >= 20)
        parts.push(`💰 ML Sharp: ${game.awayTeam} drawing ${mlMoney}% of ML money`);
    }

    return parts.join(" | ");
  }

  app.get("/api/line-movement/research/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;

      // Serve from cache if fresh
      const cached = LM_RESEARCH_CACHE.get(gameId);
      if (cached && Date.now() - cached.ts < LM_RESEARCH_TTL) {
        return res.json(cached.data);
      }

      // Find the game from the line movement cache
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      const game = lmCache?.data?.find((g: any) => g.id === gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found in line movement cache. Refresh the page first." });
      }

      const { sport, awayTeam, homeTeam, gameTime } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;
      const moveSummary = buildMovementSummary(game);

      // Run all research in parallel
      const [injuryData, newsRaw, newsTeamA, newsTeamB, weather] = await Promise.allSettled([
        fetchESPNInjuries(sport),
        fetchGoogleNewsRSS(`${awayTeam} ${homeTeam} betting odds line movement`),
        fetchGoogleNewsRSS(`${awayTeam} injury report ${sport}`),
        fetchGoogleNewsRSS(`${homeTeam} injury report ${sport}`),
        fetchWeather(homeTeam, sport),
      ]);

      const allInjuries: { player: string; status: string; team: string }[] =
        injuryData.status === "fulfilled" ? injuryData.value : [];

      // Filter injuries to teams in this game
      const awayWords = awayTeam.split(" ");
      const homeWords = homeTeam.split(" ");
      const gameInjuries = allInjuries.filter(inj => {
        const t = inj.team.toLowerCase();
        return awayWords.some(w => w.length > 3 && t.includes(w.toLowerCase())) ||
               homeWords.some(w => w.length > 3 && t.includes(w.toLowerCase()));
      }).slice(0, 10);

      // Combine news results
      const allNews: { title: string; link: string; pubDate: string }[] = [
        ...(newsRaw.status === "fulfilled" ? newsRaw.value : []),
        ...(newsTeamA.status === "fulfilled" ? newsTeamA.value : []),
        ...(newsTeamB.status === "fulfilled" ? newsTeamB.value : []),
      ];
      // Deduplicate by title similarity
      const seen = new Set<string>();
      const dedupedNews = allNews.filter(n => {
        const key = n.title.toLowerCase().slice(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8);

      const weatherInfo = weather.status === "fulfilled" ? weather.value : null;

      // Build a concise AI-style summary
      const summaryParts: string[] = [];

      // Movement reason
      if (moveSummary) {
        summaryParts.push(`📊 **Movement**: ${moveSummary}`);
      }

      // Injury flags
      if (gameInjuries.length > 0) {
        const injList = gameInjuries.map(i => `${i.player} (${i.team}) — ${i.status}`).join("; ");
        summaryParts.push(`🏥 **Injuries**: ${injList}`);
      } else {
        summaryParts.push(`🏥 **Injuries**: No major injuries found via ESPN`);
      }

      // Weather
      if (weatherInfo) {
        summaryParts.push(`🌤 **Weather**: ${weatherInfo}`);
      }

      // Sharp money signal
      const spreadAwayMoney = game.spread?.awayMoney;
      const spreadAwayPublic = game.spread?.awayPublic;
      const totalOverMoney = game.total?.overMoney;
      const totalOverPublic = game.total?.overPublic;
      const sharpNotes: string[] = [];
      if (spreadAwayMoney != null && spreadAwayPublic != null) {
        const div = spreadAwayMoney - spreadAwayPublic;
        if (Math.abs(div) >= 15) {
          sharpNotes.push(`${awayTeam} spread: ${spreadAwayMoney}% money vs ${spreadAwayPublic}% tickets (${div > 0 ? "sharp lean" : "public fade"})`);
        }
      }
      if (totalOverMoney != null && totalOverPublic != null) {
        const div = totalOverMoney - totalOverPublic;
        if (Math.abs(div) >= 15) {
          sharpNotes.push(`Over: ${totalOverMoney}% money vs ${totalOverPublic}% tickets (${div > 0 ? "sharp over" : "sharp under"})`);
        }
      }
      if (game.numBets != null) {
        sharpNotes.push(`Total bets tracked: ${game.numBets.toLocaleString()}`);
      }
      if (sharpNotes.length > 0) {
        summaryParts.push(`💰 **Sharp Money**: ${sharpNotes.join(" | ")}`);
      }

      // News headlines
      if (dedupedNews.length > 0) {
        const headlineStr = dedupedNews
          .slice(0, 4)
          .map(n => `• ${n.title}`)
          .join("\n");
        summaryParts.push(`📰 **Recent News**:\n${headlineStr}`);
      }

      const result = {
        gameId,
        gameName,
        sport,
        gameTime,
        moveSummary,
        injuries: gameInjuries,
        weather: weatherInfo,
        news: dedupedNews,
        sharpSignals: sharpNotes,
        summary: summaryParts.join("\n\n"),
        researchedAt: new Date().toISOString(),
      };

      LM_RESEARCH_CACHE.set(gameId, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Auth Routes ──────────────────────────────────────────────────────────────────────
  const bcrypt = await import("bcryptjs");
  const { nanoid } = await import("nanoid");

  // Helper: get user from Authorization: Bearer <token> header
  async function getAuthUser(req: any): Promise<any | null> {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!token) return null;
    const session = await storage.getSession(token);
    if (!session) return null;
    return storage.getUserById(session.userId);
  }

  // POST /api/auth/register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, username, password, displayName } = req.body as any;
      if (!email || !username || !password) return res.status(400).json({ error: "email, username and password are required" });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "An account with this email already exists" });
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ id: nanoid(), email, username, passwordHash, displayName: displayName ?? username, bankroll: 1000 });
      // Create session
      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await storage.createSession({ token, userId: user.id, expiresAt });
      const { passwordHash: _, ...safeUser } = user;
      res.json({ token, user: safeUser });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body as any;
      if (!email || !password) return res.status(400).json({ error: "email and password are required" });
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid email or password" });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "Invalid email or password" });
      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await storage.createSession({ token, userId: user.id, expiresAt });
      const { passwordHash: _, ...safeUser } = user;
      res.json({ token, user: safeUser });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
      if (token) await storage.deleteSession(token);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/auth/me
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/auth/me  (update display name, bankroll)
  app.patch("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { displayName, bankroll } = req.body as any;
      const updated = await storage.updateUser(user.id, { displayName, bankroll });
      if (!updated) return res.status(404).json({ error: "User not found" });
      const { passwordHash: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/user/bets  — user's tracked picks
  app.get("/api/user/bets", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const userBets = await storage.getUserBets(user.id);
      res.json(userBets);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/user/bets  — add a pick to user's tracker
  app.post("/api/user/bets", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { betId, betSlug, notes, stake } = req.body as any;
      if (!betId) return res.status(400).json({ error: "betId is required" });
      const ub = await storage.addUserBet({ id: nanoid(), userId: user.id, betId, betSlug: betSlug ?? null, notes: notes ?? null, stake: stake ?? null, result: "open" });
      res.json(ub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/user/bets/:id  — update result / notes / stake
  app.patch("/api/user/bets/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const updated = await storage.updateUserBet(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/user/bets/:id
  app.delete("/api/user/bets/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      await storage.deleteUserBet(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return httpServer;
}
