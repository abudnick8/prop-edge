import { pgTable, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sports Bets / Prediction Markets
export const bets = pgTable("bets", {
  id: text("id").primaryKey(),
  slug: text("slug").unique(), // url-friendly slug with 6-char random suffix
  source: text("source").notNull(), // kalshi, polymarket, draftkings, underdog
  sport: text("sport").notNull(), // NFL, NBA, MLB, NHL
  betType: text("bet_type").notNull(), // player_prop, spread, total, moneyline
  title: text("title").notNull(),
  description: text("description").notNull(),
  line: real("line"),
  overOdds: integer("over_odds"),
  underOdds: integer("under_odds"),
  yesPrice: real("yes_price"), // for prediction markets (0-1)
  noPrice: real("no_price"),
  impliedProbability: real("implied_probability"),
  confidenceScore: integer("confidence_score"), // 0-100
  riskLevel: text("risk_level"), // low, medium, high
  recommendedAllocation: real("recommended_allocation"), // % of portfolio
  keyFactors: jsonb("key_factors").$type<string[]>(),
  researchSummary: text("research_summary"),
  playerStats: jsonb("player_stats").$type<Record<string, unknown>>(),
  teamStats: jsonb("team_stats").$type<Record<string, unknown>>(),
  gameTime: timestamp("game_time"),
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  playerName: text("player_name"),
  isHighConfidence: boolean("is_high_confidence").default(false),
  isLotto: boolean("is_lotto").default(false), // high-payout low-probability props (HR, TD, Goals, etc.)
  allSources: jsonb("all_sources").$type<Array<{ source: string; overOdds?: number; underOdds?: number; line?: number; impliedProb?: number; pickSide?: string }>>(),
  notificationSent: boolean("notification_sent").default(false),
  status: text("status").default("open"), // open, closed, won, lost
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBetSchema = createInsertSchema(bets).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof bets.$inferSelect;

// Settings
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("default"),
  confidenceThreshold: integer("confidence_threshold").default(80),
  bankrollSize: real("bankroll_size").default(1000),
  maxAllocationPercent: real("max_allocation_percent").default(5),
  enabledSports: jsonb("enabled_sports").$type<string[]>().default(["NFL","NBA","MLB","NHL"]),
  enabledBetTypes: jsonb("enabled_bet_types").$type<string[]>().default(["player_prop","spread","total","moneyline"]),
  // Optional sports toggles
  enabledOptionalSports: jsonb("enabled_optional_sports").$type<string[]>().default([]),
  // Season-long props & futures (pre-season player season totals + championship outrights)
  enableSeasonProps: boolean("enable_season_props").default(true),
  notificationsEnabled: boolean("notifications_enabled").default(true),
  emailNotificationsEnabled: boolean("email_notifications_enabled").default(true),
  notificationEmail: text("notification_email").default("adam.budnick@gdrh.org"),
  scanIntervalMinutes: integer("scan_interval_minutes").default(30),
  oddsApiKey: text("odds_api_key"),
  kalshiApiKey: text("kalshi_api_key"),
});

export const insertSettingsSchema = createInsertSchema(settings);
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// Notifications log
export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  betId: text("bet_id").notNull(),
  message: text("message").notNull(),
  confidenceScore: integer("confidence_score"),
  sentAt: timestamp("sent_at").defaultNow(),
  dismissed: boolean("dismissed").default(false),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ sentAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// Tracked Props — user-defined prop tracking
export const trackedProps = pgTable("tracked_props", {
  id: text("id").primaryKey(),
  playerName: text("player_name").notNull(),
  sport: text("sport").notNull(),           // NBA, NFL, MLB, NHL
  statCategory: text("stat_category").notNull(), // Points, Assists, Rebounds, Passing Yards, etc.
  propType: text("prop_type").notNull(),     // season_long | game
  targetLine: real("target_line").notNull(), // the line to beat
  direction: text("direction").notNull(),    // over | under
  currentValue: real("current_value"),       // live progress (updated from BBR)
  gamesPlayed: integer("games_played"),
  notes: text("notes"),
  status: text("status").default("active"),  // active | hit | missed | expired
  teamName: text("team_name"),
  season: text("season").default("2025-26"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTrackedPropSchema = createInsertSchema(trackedProps).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertTrackedProp = z.infer<typeof insertTrackedPropSchema>;
export type TrackedProp = typeof trackedProps.$inferSelect;

// ── CLV Line Value Tracker ─────────────────────────────────────────────────

// A tracked line: one event/market we are watching
export const clvLines = pgTable("clv_lines", {
  id: text("id").primaryKey(),
  sport: text("sport").notNull(),           // NBA, NFL, MLB, NHL
  betType: text("bet_type").notNull(),       // spread, total, moneyline, player_prop
  eventId: text("event_id"),                // Odds API event_id
  eventDescription: text("event_description").notNull(), // "Lakers vs Celtics"
  marketKey: text("market_key").notNull(),  // h2h, spreads, totals, player_points
  outcomeLabel: text("outcome_label").notNull(), // "Lakers -5.5", "Over 220.5", "LeBron James Over 27.5"
  playerName: text("player_name"),
  book: text("book").notNull(),             // draftkings, fanduel
  openingLine: real("opening_line"),        // numeric line at time of tracking start
  openingOdds: integer("opening_odds"),     // American odds at open
  currentLine: real("current_line"),
  currentOdds: integer("current_odds"),
  closingLine: real("closing_line"),        // populated when game starts
  closingOdds: integer("closing_odds"),
  clvBeat: boolean("clv_beat"),             // did we beat closing line?
  clvDelta: real("clv_delta"),              // closing - opening (positive = moved in our favor)
  lineMovePct: real("line_move_pct"),       // % move from opening
  sharpnessScore: real("sharpness_score"),  // 0-100 computed from line move direction + speed
  alertThreshold: real("alert_threshold").default(10), // % move that triggers alert
  alertDirection: text("alert_direction").default("both"), // "favor" | "against" | "both"
  status: text("status").default("tracking"), // tracking | closed | expired
  gameTime: timestamp("game_time"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertClvLineSchema = createInsertSchema(clvLines).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertClvLine = z.infer<typeof insertClvLineSchema>;
export type ClvLine = typeof clvLines.$inferSelect;

// Snapshots: line history over time for a tracked line
export const clvSnapshots = pgTable("clv_snapshots", {
  id: text("id").primaryKey(),
  clvLineId: text("clv_line_id").notNull(),
  book: text("book").notNull(),
  line: real("line"),
  odds: integer("odds"),
  recordedAt: timestamp("recorded_at").defaultNow(),
});

export const insertClvSnapshotSchema = createInsertSchema(clvSnapshots).omit({ recordedAt: true });
export type InsertClvSnapshot = z.infer<typeof insertClvSnapshotSchema>;
export type ClvSnapshot = typeof clvSnapshots.$inferSelect;

// Alerts: fired when line moves past threshold
export const clvAlerts = pgTable("clv_alerts", {
  id: text("id").primaryKey(),
  clvLineId: text("clv_line_id").notNull(),
  alertType: text("alert_type").notNull(), // "move_favor" | "move_against" | "sharp_move"
  message: text("message").notNull(),
  movePct: real("move_pct"),
  fromLine: real("from_line"),
  toLine: real("to_line"),
  fromOdds: integer("from_odds"),
  toOdds: integer("to_odds"),
  dismissed: boolean("dismissed").default(false),
  firedAt: timestamp("fired_at").defaultNow(),
});

export const insertClvAlertSchema = createInsertSchema(clvAlerts).omit({ firedAt: true });
export type InsertClvAlert = z.infer<typeof insertClvAlertSchema>;
export type ClvAlert = typeof clvAlerts.$inferSelect;

// ── Users + Auth ───────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id").primaryKey(), // nanoid
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  bankroll: real("bankroll").default(1000),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Parlays ─────────────────────────────────────────────────────────────────
// A parlay slip groups multiple legs into one combined wager.
export const parlays = pgTable("parlays", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),          // user-defined name e.g. "Thursday Night Parlay"
  stake: real("stake"),                  // total amount wagered on this parlay
  result: text("result").default("open"), // open | won | lost | push
  combinedOdds: real("combined_odds"),   // American odds of the combined parlay
  potentialPayout: real("potential_payout"), // stake * decimal odds
  notes: text("notes"),
  gradedAt: timestamp("graded_at"),       // when auto-grader ran
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertParlaySchema = createInsertSchema(parlays).omit({ createdAt: true, gradedAt: true });
export type InsertParlay = z.infer<typeof insertParlaySchema>;
export type Parlay = typeof parlays.$inferSelect;

// Legs of a parlay — each leg references one bet from the bets table
export const parlayLegs = pgTable("parlay_legs", {
  id: text("id").primaryKey(),
  parlayId: text("parlay_id").notNull(),
  userId: text("user_id").notNull(),
  betId: text("bet_id").notNull(),
  betSlug: text("bet_slug"),
  betTitle: text("bet_title"),            // snapshot of title at time of adding
  betSport: text("bet_sport"),
  betLine: real("bet_line"),
  betPickSide: text("bet_pick_side"),     // OVER | UNDER | HOME | AWAY
  result: text("result").default("open"), // open | won | lost | push
  odds: real("odds"),                    // American odds for this leg
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertParlayLegSchema = createInsertSchema(parlayLegs).omit({ addedAt: true });
export type InsertParlayLeg = z.infer<typeof insertParlayLegSchema>;
export type ParlayLeg = typeof parlayLegs.$inferSelect;

// Per-user bet tracking (which picks a user is following)
export const userBets = pgTable("user_bets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  betId: text("bet_id").notNull(),
  betSlug: text("bet_slug"),
  betTitle: text("bet_title"),           // snapshot of title at time of tracking
  betSport: text("bet_sport"),
  betLine: real("bet_line"),
  betPickSide: text("bet_pick_side"),    // OVER | UNDER etc.
  notes: text("notes"),
  stake: real("stake"),                  // amount wagered
  odds: real("odds"),                    // American odds at time of adding
  result: text("result"),               // open | won | lost | push
  gradedAt: timestamp("graded_at"),      // when result was set by auto-grader
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertUserBetSchema = createInsertSchema(userBets).omit({ addedAt: true, gradedAt: true });
export type InsertUserBet = z.infer<typeof insertUserBetSchema>;
export type UserBet = typeof userBets.$inferSelect;

// Sessions (simple token-based)
export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({ createdAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

