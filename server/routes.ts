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

async function fetchBBRStats(playerName: string): Promise<any> {
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

    // Career stats header info
    const playerInfo: Record<string, string> = {};
    $("#info .p1 p").each((_, el) => {
      playerInfo[$(el).find("span").first().text().trim()] = $(el).text().trim();
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
      res.json(bets);
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
      if (sport.toUpperCase() === "NBA") {
        data = await fetchBBRStats(playerName);
      } else if (sport.toUpperCase() === "NFL") {
        data = await fetchPFRStats(playerName);
      }
      if (!data) return res.status(404).json({ error: "Player not found or stats unavailable" });
      STAT_CACHE.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Stats ────────────────────────────────────────────────────────────────
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
