import { Bet, InsertBet, Settings, InsertSettings, Notification, InsertNotification, TrackedProp, InsertTrackedProp, ClvLine, InsertClvLine, ClvSnapshot, InsertClvSnapshot, ClvAlert, InsertClvAlert, User, InsertUser, UserBet, InsertUserBet, Session, InsertSession, Parlay, InsertParlay, ParlayLeg, InsertParlayLeg } from "@shared/schema";

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

  // Auth
  createUser(u: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  updateUser(id: string, update: Partial<InsertUser>): Promise<User | undefined>;
  // Sessions
  createSession(s: InsertSession): Promise<Session>;
  getSession(token: string): Promise<Session | undefined>;
  deleteSession(token: string): Promise<void>;
  // User Bets
  getUserBets(userId: string): Promise<UserBet[]>;
  getAllUserBets(): Promise<UserBet[]>;
  addUserBet(ub: InsertUserBet): Promise<UserBet>;
  updateUserBet(id: string, update: Partial<InsertUserBet>): Promise<UserBet | undefined>;
  deleteUserBet(id: string): Promise<void>;
  // Parlays
  getParlays(userId: string): Promise<Parlay[]>;
  getParlayById(id: string): Promise<Parlay | undefined>;
  getAllParlays(): Promise<Parlay[]>;
  createParlay(p: InsertParlay): Promise<Parlay>;
  updateParlay(id: string, update: Partial<InsertParlay>): Promise<Parlay | undefined>;
  deleteParlay(id: string): Promise<void>;
  // Parlay Legs
  getParlayLegs(parlayId: string): Promise<ParlayLeg[]>;
  addParlayLeg(leg: InsertParlayLeg): Promise<ParlayLeg>;
  updateParlayLeg(id: string, update: Partial<InsertParlayLeg>): Promise<ParlayLeg | undefined>;
  deleteParlayLeg(id: string): Promise<void>;

  // CLV Line Value Tracker
  getClvLines(): Promise<ClvLine[]>;
  getClvLineById(id: string): Promise<ClvLine | undefined>;
  addClvLine(line: InsertClvLine): Promise<ClvLine>;
  updateClvLine(id: string, update: Partial<InsertClvLine>): Promise<ClvLine | undefined>;
  deleteClvLine(id: string): Promise<void>;
  // Snapshots
  getClvSnapshots(clvLineId: string): Promise<ClvSnapshot[]>;
  addClvSnapshot(snap: InsertClvSnapshot): Promise<ClvSnapshot>;
  // Alerts
  getClvAlerts(): Promise<ClvAlert[]>;
  getClvAlertsByLine(clvLineId: string): Promise<ClvAlert[]>;
  addClvAlert(alert: InsertClvAlert): Promise<ClvAlert>;
  dismissClvAlert(id: string): Promise<void>;
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
    emailNotificationsEnabled: true,
    notificationEmail: "adam.budnick@gdrh.org",
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
      isLotto: bet.isLotto ?? false,
      allSources: bet.allSources ?? null,
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

  // ── CLV Line Value Tracker ─────────────────────────────────────────────────
  private clvLinesMap: Map<string, ClvLine> = new Map();
  private clvSnapshotsMap: Map<string, ClvSnapshot> = new Map();
  private clvAlertsMap: Map<string, ClvAlert> = new Map();

  async getClvLines(): Promise<ClvLine[]> {
    return Array.from(this.clvLinesMap.values()).sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
    );
  }

  async getClvLineById(id: string): Promise<ClvLine | undefined> {
    return this.clvLinesMap.get(id);
  }

  async addClvLine(line: InsertClvLine): Promise<ClvLine> {
    const record: ClvLine = {
      ...line,
      eventId: line.eventId ?? null,
      playerName: line.playerName ?? null,
      openingLine: line.openingLine ?? null,
      openingOdds: line.openingOdds ?? null,
      currentLine: line.currentLine ?? null,
      currentOdds: line.currentOdds ?? null,
      closingLine: line.closingLine ?? null,
      closingOdds: line.closingOdds ?? null,
      clvBeat: line.clvBeat ?? null,
      clvDelta: line.clvDelta ?? null,
      lineMovePct: line.lineMovePct ?? null,
      sharpnessScore: line.sharpnessScore ?? null,
      alertThreshold: line.alertThreshold ?? 10,
      alertDirection: line.alertDirection ?? "both",
      status: line.status ?? "tracking",
      gameTime: line.gameTime ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.clvLinesMap.set(line.id, record);
    return record;
  }

  async updateClvLine(id: string, update: Partial<InsertClvLine>): Promise<ClvLine | undefined> {
    const existing = this.clvLinesMap.get(id);
    if (!existing) return undefined;
    const updated: ClvLine = { ...existing, ...update, updatedAt: new Date() };
    this.clvLinesMap.set(id, updated);
    return updated;
  }

  async deleteClvLine(id: string): Promise<void> {
    this.clvLinesMap.delete(id);
  }

  async getClvSnapshots(clvLineId: string): Promise<ClvSnapshot[]> {
    return Array.from(this.clvSnapshotsMap.values())
      .filter(s => s.clvLineId === clvLineId)
      .sort((a, b) => (a.recordedAt?.getTime() ?? 0) - (b.recordedAt?.getTime() ?? 0));
  }

  async addClvSnapshot(snap: InsertClvSnapshot): Promise<ClvSnapshot> {
    const record: ClvSnapshot = {
      ...snap,
      line: snap.line ?? null,
      odds: snap.odds ?? null,
      recordedAt: new Date(),
    };
    this.clvSnapshotsMap.set(snap.id, record);
    return record;
  }

  async getClvAlerts(): Promise<ClvAlert[]> {
    return Array.from(this.clvAlertsMap.values()).sort(
      (a, b) => (b.firedAt?.getTime() ?? 0) - (a.firedAt?.getTime() ?? 0)
    );
  }

  async getClvAlertsByLine(clvLineId: string): Promise<ClvAlert[]> {
    return Array.from(this.clvAlertsMap.values())
      .filter(a => a.clvLineId === clvLineId)
      .sort((a, b) => (b.firedAt?.getTime() ?? 0) - (a.firedAt?.getTime() ?? 0));
  }

  async addClvAlert(alert: InsertClvAlert): Promise<ClvAlert> {
    const record: ClvAlert = {
      ...alert,
      movePct: alert.movePct ?? null,
      fromLine: alert.fromLine ?? null,
      toLine: alert.toLine ?? null,
      fromOdds: alert.fromOdds ?? null,
      toOdds: alert.toOdds ?? null,
      dismissed: alert.dismissed ?? false,
      firedAt: new Date(),
    };
    this.clvAlertsMap.set(alert.id, record);
    return record;
  }

  async dismissClvAlert(id: string): Promise<void> {
    const alert = this.clvAlertsMap.get(id);
    if (alert) this.clvAlertsMap.set(id, { ...alert, dismissed: true });
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  private usersMap: Map<string, User> = new Map();
  private sessionsMap: Map<string, Session> = new Map();
  private userBetsMap: Map<string, UserBet> = new Map();

  async createUser(u: InsertUser): Promise<User> {
    const record: User = { ...u, displayName: u.displayName ?? null, bankroll: u.bankroll ?? 1000, createdAt: new Date(), updatedAt: new Date() };
    this.usersMap.set(u.id, record);
    return record;
  }
  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.usersMap.values()).find(u => u.email.toLowerCase() === email.toLowerCase());
  }
  async getUserById(id: string): Promise<User | undefined> {
    return this.usersMap.get(id);
  }
  async updateUser(id: string, update: Partial<InsertUser>): Promise<User | undefined> {
    const u = this.usersMap.get(id);
    if (!u) return undefined;
    const updated = { ...u, ...update, updatedAt: new Date() };
    this.usersMap.set(id, updated);
    return updated;
  }
  async createSession(s: InsertSession): Promise<Session> {
    const record: Session = { ...s, createdAt: new Date() };
    this.sessionsMap.set(s.token, record);
    return record;
  }
  async getSession(token: string): Promise<Session | undefined> {
    const s = this.sessionsMap.get(token);
    if (!s) return undefined;
    if (s.expiresAt < new Date()) { this.sessionsMap.delete(token); return undefined; }
    return s;
  }
  async deleteSession(token: string): Promise<void> {
    this.sessionsMap.delete(token);
  }
  async getUserBets(userId: string): Promise<UserBet[]> {
    return Array.from(this.userBetsMap.values()).filter(ub => ub.userId === userId).sort((a, b) => (b.addedAt?.getTime() ?? 0) - (a.addedAt?.getTime() ?? 0));
  }
  async getAllUserBets(): Promise<UserBet[]> {
    return Array.from(this.userBetsMap.values());
  }
  async addUserBet(ub: InsertUserBet): Promise<UserBet> {
    const record: UserBet = {
      ...ub,
      notes: ub.notes ?? null,
      stake: ub.stake ?? null,
      odds: ub.odds ?? null,
      result: ub.result ?? "open",
      betSlug: ub.betSlug ?? null,
      betTitle: ub.betTitle ?? null,
      betSport: ub.betSport ?? null,
      betLine: ub.betLine ?? null,
      betPickSide: ub.betPickSide ?? null,
      gradedAt: null,
      addedAt: new Date(),
    };
    this.userBetsMap.set(ub.id, record);
    return record;
  }
  async updateUserBet(id: string, update: Partial<InsertUserBet>): Promise<UserBet | undefined> {
    const ub = this.userBetsMap.get(id);
    if (!ub) return undefined;
    const updated = { ...ub, ...update };
    this.userBetsMap.set(id, updated);
    return updated;
  }
  async deleteUserBet(id: string): Promise<void> {
    this.userBetsMap.delete(id);
  }

  // ── Parlays ────────────────────────────────────────────────────────────
  private parlaysMap: Map<string, Parlay> = new Map();
  private parlayLegsMap: Map<string, ParlayLeg> = new Map();

  async getParlays(userId: string): Promise<Parlay[]> {
    return Array.from(this.parlaysMap.values()).filter(p => p.userId === userId).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }
  async getParlayById(id: string): Promise<Parlay | undefined> {
    return this.parlaysMap.get(id);
  }
  async getAllParlays(): Promise<Parlay[]> {
    return Array.from(this.parlaysMap.values());
  }
  async createParlay(p: InsertParlay): Promise<Parlay> {
    const record: Parlay = { ...p, result: p.result ?? "open", stake: p.stake ?? null, combinedOdds: p.combinedOdds ?? null, potentialPayout: p.potentialPayout ?? null, notes: p.notes ?? null, gradedAt: null, createdAt: new Date() };
    this.parlaysMap.set(p.id, record);
    return record;
  }
  async updateParlay(id: string, update: Partial<InsertParlay>): Promise<Parlay | undefined> {
    const p = this.parlaysMap.get(id);
    if (!p) return undefined;
    const updated = { ...p, ...update };
    this.parlaysMap.set(id, updated);
    return updated;
  }
  async deleteParlay(id: string): Promise<void> {
    this.parlaysMap.delete(id);
    // Also delete all legs
    for (const [legId, leg] of this.parlayLegsMap) {
      if (leg.parlayId === id) this.parlayLegsMap.delete(legId);
    }
  }
  async getParlayLegs(parlayId: string): Promise<ParlayLeg[]> {
    return Array.from(this.parlayLegsMap.values()).filter(l => l.parlayId === parlayId).sort((a, b) => (a.addedAt?.getTime() ?? 0) - (b.addedAt?.getTime() ?? 0));
  }
  async addParlayLeg(leg: InsertParlayLeg): Promise<ParlayLeg> {
    const record: ParlayLeg = { ...leg, result: leg.result ?? "open", betSlug: leg.betSlug ?? null, betTitle: leg.betTitle ?? null, betSport: leg.betSport ?? null, betLine: leg.betLine ?? null, betPickSide: leg.betPickSide ?? null, odds: leg.odds ?? null, addedAt: new Date() };
    this.parlayLegsMap.set(leg.id, record);
    return record;
  }
  async updateParlayLeg(id: string, update: Partial<InsertParlayLeg>): Promise<ParlayLeg | undefined> {
    const leg = this.parlayLegsMap.get(id);
    if (!leg) return undefined;
    const updated = { ...leg, ...update };
    this.parlayLegsMap.set(id, updated);
    return updated;
  }
  async deleteParlayLeg(id: string): Promise<void> {
    this.parlayLegsMap.delete(id);
  }
}

export const storage = new MemStorage();
