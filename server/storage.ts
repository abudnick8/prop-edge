import { Bet, InsertBet, Settings, InsertSettings, Notification, InsertNotification } from "@shared/schema";

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
}

export class MemStorage implements IStorage {
  private bets: Map<string, Bet> = new Map();
  private settings: Settings = {
    id: "default",
    confidenceThreshold: 80,
    bankrollSize: 1000,
    maxAllocationPercent: 5,
    enabledSports: ["NFL", "NBA", "MLB", "NHL"],
    enabledBetTypes: ["player_prop", "spread", "total", "moneyline"],
    notificationsEnabled: true,
    scanIntervalMinutes: 30,
    oddsApiKey: process.env.ODDS_API_KEY ?? "f54e39712315e81e516157a786fd561a",
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
}

export const storage = new MemStorage();
