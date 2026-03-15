import { Bet, InsertBet, Settings, InsertSettings, Notification, InsertNotification, TrackedProp, InsertTrackedProp } from "@shared/schema";

export interface IStorage {
  // Bets
  getBets(): Promise<Bet[]>;
  getBetById(id: string): Promise<Bet | undefined>;
  getHighConfidenceBets(threshold?: number): Promise<Bet[]>;
  upsertBet(bet: InsertBet): Promise<Bet>;
  updateBetStatus(id: string, status: string): Promise<Bet | undefined>;
  deleteBet(id: string): Promise<void>;
  clearBets(): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<InsertSettings>): Promise<Settings>;

  // Notifications
  getNotifications(): Promise<Notification[]>;
  getUnreadNotifications(): Promise<Notification[]>;
  addNotification(n: InsertNotification): Promise<Notification>;
  dismissNotification(id: string): Promise<void>;
  clearNotifications(): Promise<void>;

  // Tracked Props
  getTrackedProps(): Promise<TrackedProp[]>;
  getTrackedPropById(id: string): Promise<TrackedProp | undefined>;
  addTrackedProp(prop: InsertTrackedProp): Promise<TrackedProp>;
  updateTrackedProp(id: string, update: Partial<InsertTrackedProp>): Promise<TrackedProp | undefined>;
  deleteTrackedProp(id: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private bets: Map<string, Bet> = new Map();
  private trackedPropsMap: Map<string, TrackedProp> = new Map();
  private settings: Settings = {
    id: "default",
    confidenceThreshold: 80,
    bankrollSize: 1000,
    maxAllocationPercent: 5,
    enabledSports: ["NFL", "NBA", "MLB", "NHL"],
    enabledBetTypes: ["player_prop", "spread", "total", "moneyline"],
    enabledOptionalSports: [],
    enableSeasonProps: true,
    notificationsEnabled: true,
    scanIntervalMinutes: 30,
    oddsApiKey: "4134e9d0ec483414517b0ae8dea7437c", // hardcoded — Railway env var has wrong key, never use process.env here
    kalshiApiKey: null,
  };
  private notifications: Map<string, Notification> = new Map();

  async getBets(): Promise<Bet[]> {
    return Array.from(this.bets.values()).sort((a, b) =>
      (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0)
    );
  }

  async getBetById(id: string): Promise<Bet | undefined> {
    return this.bets.get(id);
  }

  async getHighConfidenceBets(threshold = 80): Promise<Bet[]> {
    return Array.from(this.bets.values()).filter(
      (b) => (b.confidenceScore ?? 0) >= threshold && b.status === "open"
    );
  }

  async upsertBet(bet: InsertBet): Promise<Bet> {
    const existing = this.bets.get(bet.id);
    const record: Bet = {
      ...bet,
      line: bet.line ?? null,
      overOdds: bet.overOdds ?? null,
      underOdds: bet.underOdds ?? null,
      yesPrice: bet.yesPrice ?? null,
      noPrice: bet.noPrice ?? null,
      impliedProbability: bet.impliedProbability ?? null,
      confidenceScore: bet.confidenceScore ?? null,
      riskLevel: bet.riskLevel ?? null,
      recommendedAllocation: bet.recommendedAllocation ?? null,
      keyFactors: bet.keyFactors ?? null,
      researchSummary: bet.researchSummary ?? null,
      playerStats: bet.playerStats ?? null,
      teamStats: bet.teamStats ?? null,
      gameTime: bet.gameTime ?? null,
      homeTeam: bet.homeTeam ?? null,
      awayTeam: bet.awayTeam ?? null,
      playerName: bet.playerName ?? null,
      isHighConfidence: bet.isHighConfidence ?? false,
      notificationSent: bet.notificationSent ?? false,
      status: bet.status ?? "open",
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.bets.set(bet.id, record);
    return record;
  }

  async updateBetStatus(id: string, status: string): Promise<Bet | undefined> {
    const bet = this.bets.get(id);
    if (!bet) return undefined;
    const updated = { ...bet, status, updatedAt: new Date() };
    this.bets.set(id, updated);
    return updated;
  }

  async deleteBet(id: string): Promise<void> {
    this.bets.delete(id);
  }

  async clearBets(): Promise<void> {
    this.bets.clear();
  }

  async getSettings(): Promise<Settings> {
    return this.settings;
  }

  async updateSettings(update: Partial<InsertSettings>): Promise<Settings> {
    this.settings = { ...this.settings, ...update };
    return this.settings;
  }

  async getNotifications(): Promise<Notification[]> {
    return Array.from(this.notifications.values()).sort(
      (a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0)
    );
  }

  async getUnreadNotifications(): Promise<Notification[]> {
    return Array.from(this.notifications.values()).filter((n) => !n.dismissed);
  }

  async addNotification(n: InsertNotification): Promise<Notification> {
    const record: Notification = {
      ...n,
      dismissed: n.dismissed ?? false,
      sentAt: new Date(),
    };
    this.notifications.set(n.id, record);
    return record;
  }

  async dismissNotification(id: string): Promise<void> {
    const n = this.notifications.get(id);
    if (n) this.notifications.set(id, { ...n, dismissed: true });
  }

  async clearNotifications(): Promise<void> {
    this.notifications.clear();
  }

  // ── Tracked Props ──────────────────────────────────────────────────────────
  async getTrackedProps(): Promise<TrackedProp[]> {
    return Array.from(this.trackedPropsMap.values()).sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
    );
  }

  async getTrackedPropById(id: string): Promise<TrackedProp | undefined> {
    return this.trackedPropsMap.get(id);
  }

  async addTrackedProp(prop: InsertTrackedProp): Promise<TrackedProp> {
    const record: TrackedProp = {
      ...prop,
      currentValue: prop.currentValue ?? null,
      gamesPlayed: prop.gamesPlayed ?? null,
      notes: prop.notes ?? null,
      status: prop.status ?? "active",
      teamName: prop.teamName ?? null,
      season: prop.season ?? "2025-26",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.trackedPropsMap.set(prop.id, record);
    return record;
  }

  async updateTrackedProp(id: string, update: Partial<InsertTrackedProp>): Promise<TrackedProp | undefined> {
    const existing = this.trackedPropsMap.get(id);
    if (!existing) return undefined;
    const updated: TrackedProp = { ...existing, ...update, updatedAt: new Date() };
    this.trackedPropsMap.set(id, updated);
    return updated;
  }

  async deleteTrackedProp(id: string): Promise<void> {
    this.trackedPropsMap.delete(id);
  }
}

export const storage = new MemStorage();
