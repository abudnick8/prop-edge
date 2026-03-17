import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { runScan } from "./scanner";
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
const ESPN_ID_CACHE: Record<string, string> = {
  // Pre-seeded common NBA players (ESPN IDs)
  "LeBron James": "1966",         "Stephen Curry": "3975",
  "Kevin Durant": "3202",        "Giannis Antetokounmpo": "3032977",
  "Luka Doncic": "3945274",      "Joel Embiid": "3059318",
  "Nikola Jokic": "3112335",     "Jayson Tatum": "4065648",
  "Devin Booker": "3136193",     "Damian Lillard": "6583",
  "Anthony Davis": "6583", "Jimmy Butler": "6430",
  "Kyrie Irving": "6442",        "Karl-Anthony Towns": "3136194",
  "Trae Young": "4277905",       "Donovan Mitchell": "3908809",
  "Bam Adebayo": "3934672",      "Paolo Banchero": "4432577",
  "Tyrese Haliburton": "4278129","Anthony Edwards": "4431678",
  "Shai Gilgeous-Alexander": "3934673", "Darius Garland": "4277903",
  "Tyrese Maxey": "4277902",     "De'Aaron Fox": "3934671",
  "OG Anunoby": "3934668",       "Mikal Bridges": "3934667",
  "Scottie Barnes": "4431683",   "Jalen Green": "4433670",
  "Cade Cunningham": "4278128",  "Evan Mobley": "4431685",
  "Franz Wagner": "4278365",     "Josh Giddey": "4431686",
  "DeMar DeRozan": "3011",       "Zach LaVine": "3064514",
  "Brandon Ingram": "3136195",   "Draymond Green": "6589",
  "Klay Thompson": "6475",       "Bradley Beal": "6580",
  "Myles Turner": "3133628",     "Tobias Harris": "6618",
  "Khris Middleton": "6609",     "Brook Lopez": "3971",
  "Jaylen Brown": "3917376",     "Marcus Smart": "2990969",
  "Kyle Lowry": "1966",          "Pascal Siakam": "3136196",
  "Kristaps Porzingis": "3102531", "Julius Randle": "3064440",
  "Jalen Brunson": "3936299",    "RJ Barrett": "4278060",
  "Immanuel Quickley": "4395628","OB Toppin": "4432577",
  "Deandre Ayton": "4066299",    "Cameron Johnson": "4066286",  "Saddiq Bey": "4432583",
  "Caris LeVert": "2578260",     "Buddy Hield": "2490157",
  "Aaron Nesmith": "4431682",    "T.J. McConnell": "2528210",
  "Chris Duarte": "4432576",     "Bennedict Mathurin": "4432578",
  "Andrew Nembhard": "4432579",  "Daniel Theis": "3934674",
  "Damion Lee": "2578261",       "Max Christie": "4432580",
  "Dennis Schroder": "3025779",  "Brice Sensabaugh": "4683706",
  "Evan Fournier": "2528211",    "Nikola Vucevic": "4251",      "Zach Collins": "4066288",
  "Derrick White": "3055807",    "Al Horford": "3213",
  "Payton Pritchard": "4432581", "Sam Hauser": "4432582",
  "Jordan Poole": "4278057",     "Bilal Coulibaly": "4683707",
  "Kyle Kuzma": "4066289",       "Deni Avdija": "4432584",
  "Monte Morris": "4066290",     "Malcolm Brogdon": "2578262",
  "Bobby Portis": "3059319",
  "Pat Connaughton": "2578263",  "MarJon Beauchamp": "4432585",
  "AJ Green": "4683708",         "A.J. Green": "4683708",
  "Thanasis Antetokounmpo": "3032978",
};

async function fetchESPNGameLog(playerName: string, sport: string): Promise<any> {
  try {
    const league = sport === "NBA" ? "nba" : sport === "NFL" ? "nfl" : sport === "MLB" ? "mlb" : sport === "NHL" ? "nhl" : "nba";
    const sportsName = sport === "NBA" ? "basketball" : sport === "NFL" ? "football" : sport === "MLB" ? "baseball" : sport === "NHL" ? "hockey" : "basketball";

    // Get ESPN ID - try cache first, then slug lookup
    let espnId = ESPN_ID_CACHE[playerName];
    if (!espnId) {
      const slug = playerName.toLowerCase().replace(/['\.]/g, "").replace(/\s+/g, "-");
      try {
        const searchResp = await axios.get(
          `http://sports.core.api.espn.com/v2/sports/${sportsName}/leagues/${league}/athletes?slug=${encodeURIComponent(slug)}&limit=5&active=true`,
          { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
        );
        const items = searchResp.data?.items ?? [];
        if (items.length > 0) {
          const ref = items[0]?.$ref ?? "";
          const idMatch = ref.match(/athletes\/([0-9]+)/);
          if (idMatch) espnId = idMatch[1];
        }
      } catch { /* slug lookup failed */ }
    }
    if (!espnId) return null;
    ESPN_ID_CACHE[playerName] = espnId;

    // Get the eventlog (last page = most recent games)
    const elogResp = await axios.get(
      `http://sports.core.api.espn.com/v2/sports/${sportsName}/leagues/${league}/athletes/${espnId}/eventlog?limit=25`,
      { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const elogData = elogResp.data;
    const totalPages = elogData?.events?.pageCount ?? 1;

    // Fetch the last page to get most recent games
    const lastPageResp = await axios.get(
      `http://sports.core.api.espn.com/v2/sports/${sportsName}/leagues/${league}/athletes/${espnId}/eventlog?limit=25&page=${totalPages}`,
      { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const allEvents: any[] = lastPageResp.data?.events?.items ?? [];

    // Filter to played events and take last 5
    const playedEvents = allEvents.filter((e: any) => e.played === true).slice(-5);

    // Fetch stats + event date in parallel
    const recentGames: any[] = [];
    await Promise.all(playedEvents.map(async (ev: any) => {
      try {
        const statsRef = ev?.statistics?.$ref;
        const eventRef = ev?.event?.$ref;
        if (!statsRef) return;

        const [statsResp, eventResp] = await Promise.all([
          axios.get(statsRef, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }),
          eventRef ? axios.get(eventRef, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }) : Promise.resolve({ data: {} }),
        ]);

        const cats: any[] = statsResp.data?.splits?.categories ?? [];
        const gameStats: Record<string, any> = {};
        for (const cat of cats) {
          for (const s of (cat.stats ?? [])) {
            gameStats[s.name] = s.value;
          }
        }

        const eventDate = eventResp.data?.date ? eventResp.data.date.split("T")[0] : "";
        const shortName = eventResp.data?.shortName ?? "";
        // Extract opponent abbreviation from shortName like "MIL @ ATL" or "ATL vs MIL"
        const parts = shortName.split(/\s+[@vs]+\s+/i);
        const opp = parts.length >= 2 ? (parts[1] ?? parts[0]) : shortName;

        recentGames.push({
          date_game: eventDate,
          opp_id: opp || "?",
          pts: String(Math.round(gameStats.points ?? 0)),
          trb: String(Math.round((gameStats.rebounds ?? 0))),
          ast: String(Math.round(gameStats.assists ?? 0)),
          stl: String(Math.round(gameStats.steals ?? 0)),
          blk: String(Math.round(gameStats.blocks ?? 0)),
          tov: String(Math.round(gameStats.turnovers ?? 0)),
          mp: String(Math.round(gameStats.minutes ?? 0)),
          fg_made: String(Math.round(gameStats.fieldGoalsMade ?? 0)),
          fg_att: String(Math.round(gameStats.fieldGoalsAttempted ?? 0)),
          fg3_made: String(Math.round(gameStats.threePointFieldGoalsMade ?? 0)),
        });
      } catch { /* skip this game */ }
    }));

    // Sort by date ascending (oldest → newest for chart display)
    recentGames.sort((a, b) => a.date_game.localeCompare(b.date_game));

    // Get season averages from statistics/0
    let season: Record<string, string> = {};
    try {
      const statsResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${sportsName}/leagues/${league}/athletes/${espnId}/statistics/0`,
        { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const cats: any[] = statsResp.data?.splits?.categories ?? [];
      const allStats: Record<string, number> = {};
      for (const cat of cats) {
        for (const s of (cat.stats ?? [])) {
          allStats[s.name] = s.value;
        }
      }
      season = {
        pts: String(+(allStats.avgPoints ?? 0).toFixed(1)),
        reb: String(+(allStats.avgRebounds ?? 0).toFixed(1)),
        ast: String(+(allStats.avgAssists ?? 0).toFixed(1)),
        stl: String(+(allStats.avgSteals ?? 0).toFixed(1)),
        blk: String(+(allStats.avgBlocks ?? 0).toFixed(1)),
        fg_pct: allStats.fieldGoalPct ? String(+(allStats.fieldGoalPct).toFixed(1)) + "%" : "—",
        fg3_pct: allStats.threePointFieldGoalPct ? String(+(allStats.threePointFieldGoalPct).toFixed(1)) + "%" : "—",
        mpg: String(+(allStats.avgMinutes ?? 0).toFixed(1)),
        gp: String(Math.round(allStats.gamesPlayed ?? 0)),
        to: String(+(allStats.avgTurnovers ?? 0).toFixed(1)),
      };
    } catch { /* season stats unavailable */ }

    return {
      sport: sport.toUpperCase(),
      name: playerName,
      espnId,
      bbrUrl: `https://www.espn.com/nba/player/_/id/${espnId}`,
      season,
      seasonLabel: "2024-25 Season Averages (ESPN)",
      recentGames,
    };
  } catch (e: any) {
    console.warn("ESPN game log fetch failed:", e.message);
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

      // Sort all bets by confidence descending
      const sorted = [...bets].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

      // Player props: top 100 per sport
      const PROPS_PER_SPORT = 100;
      const propsBySport: Record<string, any[]> = {};
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        const sport = bet.sport ?? 'OTHER';
        if (!propsBySport[sport]) propsBySport[sport] = [];
        if (propsBySport[sport].length < PROPS_PER_SPORT) {
          propsBySport[sport].push(bet);
        }
      }
      const limitedProps = Object.values(propsBySport).flat();

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

      res.json([...limitedProps, ...teamBets, ...seasonBets]);
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
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API Quota Check ─────────────────────────────────────────────────────
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
      if (sportUp === "NBA") {
        data = await fetchBBRStats(playerName); // ESPN-first with BBR fallback
      } else if (sportUp === "NFL") {
        data = await fetchPFRStats(playerName);
      } else if (sportUp === "MLB" || sportUp === "NHL") {
        data = await fetchESPNGameLog(playerName, sportUp);
      }
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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://underdogfantasy.com/",
            "Origin": "https://underdogfantasy.com",
          },
          timeout: 15000,
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

  // Auto-scan every 30 min
  scanInterval = setInterval(async () => {
    const settings = await storage.getSettings();
    await runScan(settings.oddsApiKey);
  }, 30 * 60 * 1000);

  return httpServer;
}
