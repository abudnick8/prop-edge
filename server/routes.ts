import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { runScan } from "./scanner";

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
        plan: "free_500",
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

  // Initial scan on startup — live data only, no demo fallback
  setTimeout(async () => {
    try {
      const settings = await storage.getSettings();
      await runScan(settings.oddsApiKey);
    } catch (e: any) {
      console.warn("Initial scan failed:", e.message);
    }
  }, 1000);

  // Auto-scan every 30 min
  scanInterval = setInterval(async () => {
    const settings = await storage.getSettings();
    await runScan(settings.oddsApiKey);
  }, 30 * 60 * 1000);

  return httpServer;
}
