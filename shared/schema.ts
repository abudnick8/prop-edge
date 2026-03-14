import { pgTable, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sports Bets / Prediction Markets
export const bets = pgTable("bets", {
  id: text("id").primaryKey(),
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
