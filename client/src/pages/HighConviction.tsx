import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Bet } from "@shared/schema";
import { ChevronDown, ChevronUp, Zap, TrendingUp, Fish, Star, RefreshCw, AlertCircle, Eye, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface PredMkt {
  id: string;
  source: "kalshi" | "polymarket";
  title: string;
  event: string;
  sport: string;
  yesPrice: number;
  noPrice: number;
  vol24h: number;
  volSpike: number;
  fairValue: number;
  edge: number;
  priceRating: "fair" | "good_buy" | "great_buy" | "overpriced";
  isWhaleAlert: boolean;
  whaleDirection: "yes" | "no" | null;
  whalePriceMovePct: number;
  gameTime: string | null;
  polyUrl?: string;
  kalshiUrl?: string;
  legs?: string[] | null;
  isParlay?: boolean;
}

interface GameLine {
  id: string;
  sport: string;
  awayTeam: string;
  homeTeam: string;
  gameTime: string | null;
  spread: { open: number | null; current: number | null; move: number | null; awayPublic?: number | null; homePublic?: number | null; awayMoney?: number | null; homeMoney?: number | null };
  total:   { open: number | null; current: number | null; move: number | null; overPublic?: number | null; underPublic?: number | null; overMoney?: number | null; underMoney?: number | null };
  moneyline: { awayOpen?: number | null; awayCurrent?: number | null; homeOpen?: number | null; homeCurrent?: number | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Confluence Signal Types
// ─────────────────────────────────────────────────────────────────────────────
type SignalType = "model" | "line_movement" | "whale";

interface ConvictionSignal {
  type: SignalType;
  label: string;
  detail: string;
  strength: "strong" | "moderate";
  color: string;
  bg: string;
  icon: string;
}

interface ConvictionPlay {
  id: string;
  sport: string;
  teams: string;               // "MIL Bucks vs BOS Celtics"
  gameTime: string | null;
  directive: string;           // "BET BUCKS ML" / "BET OVER 224.5"
  betType: string;
  shortDesc: string;           // "Milwaukee Bucks Moneyline"
  signals: ConvictionSignal[];
  totalScore: number;          // 0–300 (100 per signal)
  // Source refs
  bet?: Bet;
  market?: PredMkt;
  gameLine?: GameLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtOdds(n: number | null | undefined): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}
function fmtLine(n: number | null | undefined): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}
function fmtVol(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(isToday ? {} : { month: "short", day: "numeric" }) });
}

// Normalize team names for fuzzy matching
function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Check if a prediction market title matches a team name
function marketMatchesTeam(mktTitle: string, teamName: string): boolean {
  const t = normTeam(mktTitle);
  const words = teamName.toLowerCase().split(/\s+/);
  // Match on any meaningful word (city or team name, skip "the", "a", etc.)
  return words.some(w => w.length > 3 && t.includes(w));
}

// Check if a prediction market matches a bet (same team + direction)
function marketAlignsBet(mkt: PredMkt, bet: Bet): boolean {
  if (!mkt.isWhaleAlert) return false;
  const title = mkt.title.toLowerCase();
  const betTeam = (bet.homeTeam ?? bet.awayTeam ?? "").toLowerCase();

  // Must whale-buy YES (same direction as the Clubhouse IQ pick)
  if (mkt.whaleDirection !== "yes") return false;

  // Check betType alignment
  if (bet.betType === "moneyline" || bet.betType === "spread") {
    const pick = (bet.pick ?? "").toLowerCase();
    // Check pick team name in market title
    const pickWords = pick.split(/\s+/).filter(w => w.length > 3);
    if (pickWords.some(w => title.includes(w))) return true;
    // Fallback: home/away team
    if (betTeam && title.includes(betTeam.split(" ").pop()!.toLowerCase())) return true;
  }
  if (bet.betType === "total" || bet.betType === "player_prop") {
    const teams = [bet.homeTeam ?? "", bet.awayTeam ?? ""].map(t => t.toLowerCase());
    return teams.some(t => t.split(" ").some(w => w.length > 3 && title.includes(w)));
  }
  return false;
}

// Check if line movement direction aligns with the Clubhouse IQ bet
function lineAlignsBet(game: GameLine, bet: Bet): { aligns: boolean; signal: ConvictionSignal | null } {
  const spreadMove = game.spread.move ?? 0;
  const totalMove  = game.total.move ?? 0;
  const abSpread   = Math.abs(spreadMove);
  const abTotal    = Math.abs(totalMove);

  const betType = bet.betType;
  const pick    = (bet.pick ?? "").toLowerCase();

  if ((betType === "moneyline" || betType === "spread") && abSpread >= 1.5) {
    // Spread moves toward away team (negative) means sharps on away
    const sharpOnAway = spreadMove < 0;
    const pickIsAway  = bet.awayTeam ? pick.includes(normTeam(bet.awayTeam).slice(0, 6)) : false;
    const pickIsHome  = bet.homeTeam ? pick.includes(normTeam(bet.homeTeam).slice(0, 6)) : false;
    const aligns = (sharpOnAway && pickIsAway) || (!sharpOnAway && pickIsHome) ||
                   (!pickIsAway && !pickIsHome); // if we can't determine, give benefit

    if (aligns && abSpread >= 3) {
      return {
        aligns: true,
        signal: {
          type: "line_movement",
          label: `🔥 Spread Steam ${abSpread > 0 ? `(${spreadMove > 0 ? "+" : ""}${spreadMove} pts)` : ""}`,
          detail: `Spread moved ${fmtLine(game.spread.open)} → ${fmtLine(game.spread.current)}. Sharp money is aligned with this pick.`,
          strength: "strong",
          color: "#f87171",
          bg: "rgba(248,113,113,0.10)",
          icon: "🔥",
        },
      };
    }
    if (aligns && abSpread >= 1.5) {
      return {
        aligns: true,
        signal: {
          type: "line_movement",
          label: `⚡ Line Move (${spreadMove > 0 ? "+" : ""}${spreadMove} pts)`,
          detail: `Spread has moved ${fmtLine(game.spread.open)} → ${fmtLine(game.spread.current)} in the direction of this pick.`,
          strength: "moderate",
          color: "#f59e0b",
          bg: "rgba(245,158,11,0.10)",
          icon: "⚡",
        },
      };
    }
  }

  if (betType === "total" && abTotal >= 1.5) {
    const pickOver  = pick.includes("over");
    const pickUnder = pick.includes("under");
    const lineOver  = totalMove > 0;
    const aligns    = (pickOver && lineOver) || (pickUnder && !lineOver);

    if (aligns) {
      const dir = lineOver ? "Over" : "Under";
      return {
        aligns: true,
        signal: {
          type: "line_movement",
          label: `${abTotal >= 3 ? "🔥 Total Steam" : "⚡ Total Move"} (${dir} ${totalMove > 0 ? "+" : ""}${totalMove})`,
          detail: `Total moved ${game.total.open} → ${game.total.current}. ${abTotal >= 3 ? "Steam-level movement" : "Notable movement"} aligns with ${dir} pick.`,
          strength: abTotal >= 3 ? "strong" : "moderate",
          color: abTotal >= 3 ? "#f87171" : "#f59e0b",
          bg: abTotal >= 3 ? "rgba(248,113,113,0.10)" : "rgba(245,158,11,0.10)",
          icon: abTotal >= 3 ? "🔥" : "⚡",
        },
      };
    }
  }

  // Check reverse line movement (public heavy one way, line moves other)
  const awayPublic = game.spread.awayPublic ?? 50;
  if (abSpread >= 1 && awayPublic >= 65 && spreadMove > 0) {
    // Public on away, line moved toward home = RLM on home
    const pickIsHome = bet.homeTeam ? pick.includes(normTeam(bet.homeTeam).slice(0, 5)) : false;
    if (pickIsHome) {
      return {
        aligns: true,
        signal: {
          type: "line_movement",
          label: `↩ Reverse Line Movement`,
          detail: `${awayPublic}% public on ${game.awayTeam} but line moved toward ${game.homeTeam}. Sharps fading the public — aligned with this pick.`,
          strength: "moderate",
          color: "#a78bfa",
          bg: "rgba(167,139,250,0.10)",
          icon: "↩",
        },
      };
    }
  }

  return { aligns: false, signal: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Watching Play type — almost aligned, not quite there yet
// ─────────────────────────────────────────────────────────────────────────────
interface MissingSignal {
  type: SignalType;
  label: string;        // "Needs line movement"
  hint: string;         // "Spread is only +0.8 pts — watching for ≥1.5"
  icon: string;
}

interface WatchingPlay {
  id: string;
  sport: string;
  teams: string;
  gameTime: string | null;
  directive: string;
  betType: string;
  shortDesc: string;
  // What IS confirmed
  confirmedSignals: ConvictionSignal[];
  // What is MISSING (close but not met)
  missingSignals: MissingSignal[];
  // Proximity score 0–100 — how close to firing
  proximity: number;
  bet?: Bet;
  gameLine?: GameLine;
  market?: PredMkt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player prop label helpers
// ─────────────────────────────────────────────────────────────────────────────

// Team-bet classifier: moneyline, spread, total = team bets; player_prop = prop
function isTeamBet(bet: Bet): boolean {
  return bet.betType === "moneyline" || bet.betType === "spread" || bet.betType === "total";
}

// Extracts player name from bet — prefers playerName field, falls back to
// parsing title/description for patterns like "LeBron James Over 29.5 Points"
function extractPlayerName(bet: Bet): string {
  if (bet.playerName && bet.playerName.trim().length > 0) return bet.playerName.trim();
  // Try to parse from title: "[Player Name] [Over/Under] [Line] [Stat]"
  const titleMatch = (bet.title ?? "").match(/^([A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3})\s+(?:Over|Under|o\/u)/i);
  if (titleMatch) return titleMatch[1];
  // Try description
  const descMatch = (bet.description ?? "").match(/^([A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3})\s+(?:to|Over|Under)/i);
  if (descMatch) return descMatch[1];
  return "";
}

// Extracts stat type from the bet title/description
// Returns short label: "PTS", "AST", "REB", "3PM", "YDS", etc.
function extractStatType(bet: Bet): string {
  const src = `${bet.title ?? ""} ${bet.description ?? ""}`.toLowerCase();
  if (/passing yard|pass yard|passing yd/.test(src)) return "Pass Yds";
  if (/rushing yard|rush yard|rushing yd/.test(src)) return "Rush Yds";
  if (/receiving yard|rec yard|receiving yd/.test(src)) return "Rec Yds";
  if (/reception|catches/.test(src)) return "REC";
  if (/touchdown/.test(src)) return "TD";
  if (/3-point|three.point|threes made|3pm/.test(src)) return "3PM";
  if (/rebound/.test(src)) return "REB";
  if (/assist/.test(src)) return "AST";
  if (/point|pts/.test(src)) return "PTS";
  if (/steal/.test(src)) return "STL";
  if (/block/.test(src)) return "BLK";
  if (/strikeout|k's/.test(src)) return "K's";
  if (/hit/.test(src)) return "Hits";
  if (/home run/.test(src)) return "HR";
  if (/rbi/.test(src)) return "RBI";
  if (/save/.test(src)) return "Saves";
  if (/goal/.test(src)) return "Goals";
  if (/shot/.test(src)) return "Shots";
  return "Prop";
}

// ─────────────────────────────────────────────────────────────────────────────
// Confluence Engine — finds plays where all 3 signals converge
// ─────────────────────────────────────────────────────────────────────────────
function buildConvictionPlays(
  bets: Bet[],
  markets: PredMkt[],
  games: GameLine[]
): ConvictionPlay[] {
  const plays: ConvictionPlay[] = [];

  // Only high-confidence Clubhouse IQ picks
  const highConfBets = bets.filter(b =>
    (b.confidenceScore ?? 0) >= 82 &&
    b.status === "open" &&
    b.betType !== "season_prop" &&
    b.betType !== "futures"
  );

  for (const bet of highConfBets) {
    const signals: ConvictionSignal[] = [];

    // ── Signal 1: Clubhouse IQ Model ───────────────────────────────────────────
    const conf = bet.confidenceScore ?? 0;
    signals.push({
      type: "model",
      label: `Clubhouse IQ Model — ${conf}/100 Confidence`,
      detail: `${bet.pick ?? "Pick"} · ${bet.betType?.replace("_", " ")} · ${bet.sport}. Model grade: ${bet.grade ?? "A"}. This pick crosses the high-confidence threshold (≥82).`,
      strength: conf >= 90 ? "strong" : "moderate",
      color: "#facc15",
      bg: "rgba(250,204,21,0.10)",
      icon: "⭐",
    });

    // ── Signal 2: Line Movement ────────────────────────────────────────────
    // Find the matching game from line movement data
    const betTeamWords = [bet.homeTeam ?? "", bet.awayTeam ?? ""]
      .flatMap(t => t.toLowerCase().split(/\s+/))
      .filter(w => w.length > 3);

    const matchedGame = games.find(g => {
      const gameTeams = [g.homeTeam, g.awayTeam]
        .flatMap(t => t.toLowerCase().split(/\s+/));
      return betTeamWords.some(w => gameTeams.includes(w));
    });

    let lineSignal: ConvictionSignal | null = null;
    if (matchedGame) {
      const { aligns, signal } = lineAlignsBet(matchedGame, bet);
      if (aligns && signal) lineSignal = signal;
    }
    if (lineSignal) signals.push(lineSignal);

    // ── Signal 3: Prediction Market Whale ─────────────────────────────────
    const whaleMarkets = markets.filter(m => m.isWhaleAlert && m.whaleDirection === "yes");
    const matchedMkt = whaleMarkets.find(m => marketAlignsBet(m, bet));

    if (matchedMkt) {
      const volStr = matchedMkt.vol24h > 0 ? ` · ${fmtVol(matchedMkt.vol24h)} volume` : "";
      const whalePct = matchedMkt.whalePriceMovePct;
      signals.push({
        type: "whale",
        label: `🐋 Whale Buy — ${matchedMkt.source === "kalshi" ? "Kalshi" : "Polymarket"}`,
        detail: `"${matchedMkt.title}" — whale buying YES at ${Math.round(matchedMkt.yesPrice * 100)}¢${volStr}. ${whalePct > 0 ? `Price moved +${whalePct.toFixed(1)}% on large block.` : ""} High-conviction institutional money aligns with this pick.`,
        strength: matchedMkt.priceRating === "great_buy" || matchedMkt.whalePriceMovePct >= 5 ? "strong" : "moderate",
        color: "#34d399",
        bg: "rgba(52,211,153,0.10)",
        icon: "🐋",
      });
    }

    // ── Only include if at least 2 signals (model + 1 more) ──────────────
    if (signals.length < 2) continue;

    // ── Build directive ────────────────────────────────────────────────────
    const pickStr    = bet.pick ?? "";
    const isOver     = pickStr.toLowerCase().includes("over");
    const isUnder    = pickStr.toLowerCase().includes("under");
    const lineVal    = bet.line != null ? ` ${bet.line}` : "";

    let directive = "";
    let shortDesc = pickStr;

    if (bet.betType === "total") {
      directive = isUnder ? `BET UNDER${lineVal}` : `BET OVER${lineVal}`;
      shortDesc = `${isUnder ? "Under" : "Over"}${lineVal} — Total`;
    } else if (bet.betType === "moneyline") {
      const teamShort = (pickStr.split(" ").slice(-1)[0] ?? pickStr).toUpperCase();
      directive = `BET ${teamShort} ML`;
      shortDesc = `${pickStr} — Moneyline`;
    } else if (bet.betType === "spread") {
      const teamShort = (pickStr.split(" ").slice(-1)[0] ?? pickStr).toUpperCase();
      directive = `BET ${teamShort} SPREAD${lineVal}`;
      shortDesc = `${pickStr}${lineVal} — Spread`;
    } else if (bet.betType === "player_prop") {
      const dir = isUnder ? "UNDER" : "OVER";
      const pName = extractPlayerName(bet);
      const stat  = extractStatType(bet);
      directive = pName
        ? `BET ${pName.toUpperCase()} ${dir}${lineVal}`
        : `BET ${dir}${lineVal}`;
      shortDesc = pName
        ? `${pName} ${dir}${lineVal} ${stat}`
        : `${dir}${lineVal} — Player Prop`;
    } else {
      directive = `BET ${pickStr.toUpperCase()}`;
      shortDesc = pickStr;
    }

    // Score: 100 per signal, bonus for signal strength
    // A+/A edge tier adds bonus so high-value plays surface first
    const edgeTier = (bet as any).edgeTier as string | undefined;
    const edgeBonus = edgeTier === "A+" ? 20 : edgeTier === "A" ? 12 : edgeTier === "B" ? 5 : 0;
    const totalScore = signals.reduce((acc, s) => acc + (s.strength === "strong" ? 105 : 90), 0) + edgeBonus;

    plays.push({
      id: `hc-${bet.id}`,
      sport: bet.sport,
      teams: [bet.awayTeam, bet.homeTeam].filter(Boolean).join(" @ ") || bet.sport,
      gameTime: bet.gameTime ?? null,
      directive,
      betType: bet.betType ?? "bet",
      shortDesc,
      signals,
      totalScore,
      bet,
      market: matchedMkt,
      gameLine: matchedGame,
    });
  }

  // Sort: team bets first (by signal count then score), then player props (capped at 3)
  const teamPlays = plays
    .filter(p => isTeamBet(p.bet!))
    .sort((a, b) => b.signals.length - a.signals.length || b.totalScore - a.totalScore);
  const propPlays = plays
    .filter(p => !isTeamBet(p.bet!))
    .sort((a, b) => b.signals.length - a.signals.length || b.totalScore - a.totalScore)
    .slice(0, 3);
  return [...teamPlays, ...propPlays];
}

// ─────────────────────────────────────────────────────────────────────────────
// Watching Engine — picks that are close but not yet firing
// Criteria: model ≥75 confidence (below 82 threshold OR 82+ but only 1 signal)
//           + at least one near-miss on a 2nd signal
// ─────────────────────────────────────────────────────────────────────────────
function buildWatchingPlays(
  bets: Bet[],
  markets: PredMkt[],
  games: GameLine[],
  convictionIds: Set<string>   // exclude anything already in High Conviction
): WatchingPlay[] {
  const candidates: WatchingPlay[] = [];

  // Bets in range 72–81 (promising model, not quite HC threshold)
  // OR bets ≥82 that only have the model signal (no 2nd yet)
  const watchBets = bets.filter(b => {
    if (convictionIds.has(`hc-${b.id}`)) return false;   // already promoted
    const c = b.confidenceScore ?? 0;
    return c >= 72 && b.status === "open" &&
      b.betType !== "season_prop" && b.betType !== "futures";
  });

  for (const bet of watchBets) {
    const conf = bet.confidenceScore ?? 0;
    const confirmedSignals: ConvictionSignal[] = [];
    const missingSignals: MissingSignal[] = [];
    let proximity = 0;

    // ── Confirmed: model ────────────────────────────────────────────────────
    confirmedSignals.push({
      type: "model",
      label: `Clubhouse IQ Model — ${conf}/100 Confidence`,
      detail: `${bet.pick ?? "Pick"} · ${bet.betType?.replace("_", " ")} · ${bet.sport}. Grade: ${bet.grade ?? "A"}.`,
      strength: conf >= 80 ? "moderate" : "moderate",
      color: "#facc15",
      bg: "rgba(250,204,21,0.10)",
      icon: "⭐",
    });
    // Model proximity: maps 72→40pts, 81→75pts, 82+→85pts
    proximity += conf >= 82 ? 85 : Math.round(40 + ((conf - 72) / 9) * 35);

    // ── Near-miss: Line movement ─────────────────────────────────────────────
    const betTeamWords = [bet.homeTeam ?? "", bet.awayTeam ?? ""]
      .flatMap(t => t.toLowerCase().split(/\s+/))
      .filter(w => w.length > 3);

    const matchedGame = games.find(g => {
      const gameTeams = [g.homeTeam, g.awayTeam].flatMap(t => t.toLowerCase().split(/\s+/));
      return betTeamWords.some(w => gameTeams.includes(w));
    });

    let lineConfirmed = false;
    if (matchedGame) {
      const { aligns, signal } = lineAlignsBet(matchedGame, bet);
      if (aligns && signal) {
        // Already fires — this is a full signal
        confirmedSignals.push(signal);
        lineConfirmed = true;
        proximity += 10; // close to full conviction
      } else {
        // Check near-miss: small movement in the right direction
        const spreadMove = matchedGame.spread.move ?? 0;
        const totalMove  = matchedGame.total.move ?? 0;
        const abSpread   = Math.abs(spreadMove);
        const abTotal    = Math.abs(totalMove);
        const pick = (bet.pick ?? "").toLowerCase();

        const hasSmallSpread = (bet.betType === "moneyline" || bet.betType === "spread") && abSpread >= 0.5 && abSpread < 1.5;
        const hasSmallTotal  = bet.betType === "total" && abTotal >= 0.3 && abTotal < 1.5;

        if (hasSmallSpread) {
          proximity += Math.round((abSpread / 1.5) * 10);
          missingSignals.push({
            type: "line_movement",
            label: "Needs Line Movement",
            hint: `Spread has moved ${spreadMove > 0 ? "+" : ""}${spreadMove} pts — watching for ≥1.5 pt move in this direction.`,
            icon: "📈",
          });
        } else if (hasSmallTotal) {
          proximity += Math.round((abTotal / 1.5) * 10);
          const dir = totalMove > 0 ? "Over" : "Under";
          missingSignals.push({
            type: "line_movement",
            label: "Needs Total Movement",
            hint: `Total has moved ${totalMove > 0 ? "+" : ""}${totalMove} pts toward ${dir} — watching for ≥1.5 pt move.`,
            icon: "📈",
          });
        } else {
          missingSignals.push({
            type: "line_movement",
            label: "Watching for Line Movement",
            hint: "No significant line movement yet. A steam move or reverse-line signal would promote this play.",
            icon: "📈",
          });
        }
      }
    } else {
      missingSignals.push({
        type: "line_movement",
        label: "Watching for Line Movement",
        hint: "No matching game line data yet. Will update as odds are posted.",
        icon: "📈",
      });
    }

    // ── Near-miss: Prediction market whale ────────────────────────────────────
    let whaleConfirmed = false;
    // Look for any market referencing the same teams — whale or near-whale
    const betTeamLower = [bet.homeTeam ?? "", bet.awayTeam ?? ""].map(t => t.toLowerCase());
    const relatedMkts = markets.filter(m => {
      const title = m.title.toLowerCase();
      return betTeamLower.some(team =>
        team.split(" ").some(w => w.length > 3 && title.includes(w))
      );
    });

    const whaleMkt = relatedMkts.find(m => m.isWhaleAlert && m.whaleDirection === "yes");
    if (whaleMkt && !whaleMkt.isWhaleAlert) {
      // Found but not whale-level
    } else if (whaleMkt) {
      // Actually a confirmed whale — this bet should have been in HC.
      // Add as confirmed signal anyway (edge case where model is 72–81)
      confirmedSignals.push({
        type: "whale",
        label: `🐋 Whale Buy — ${whaleMkt.source === "kalshi" ? "Kalshi" : "Polymarket"}`,
        detail: `"${whaleMkt.title}" — whale YES buy detected.`,
        strength: "moderate",
        color: "#34d399",
        bg: "rgba(52,211,153,0.10)",
        icon: "🐋",
      });
      whaleConfirmed = true;
      proximity += 8;
    } else if (relatedMkts.length > 0) {
      // Has related market but no whale yet
      const best = relatedMkts.sort((a, b) => b.vol24h - a.vol24h)[0];
      const volStr = best.vol24h > 0 ? ` (${fmtVol(best.vol24h)} volume so far)` : "";
      proximity += 5;
      missingSignals.push({
        type: "whale",
        label: "Watching for Whale Buy",
        hint: `Related market found: "${best.title}"${volStr}. No large block purchase yet. Watching for $100K+ or 5¢ move.`,
        icon: "🐋",
      });
    } else {
      missingSignals.push({
        type: "whale",
        label: "No Prediction Market Signal",
        hint: "No matching prediction market found yet. Whale signal would confirm this play.",
        icon: "🐋",
      });
    }

    // ── Only include if there's at least one missing signal (not already full HC) ──
    if (missingSignals.length === 0) continue;
    // Must have at least one near-miss OR confirmed 2nd signal
    if (confirmedSignals.length < 1) continue;

    // Build directive
    const pickStr = bet.pick ?? "";
    const isOver  = pickStr.toLowerCase().includes("over");
    const isUnder = pickStr.toLowerCase().includes("under");
    const lineVal = bet.line != null ? ` ${bet.line}` : "";
    let directive = "";
    let shortDesc = pickStr;
    if (bet.betType === "total") {
      directive = isUnder ? `WATCH UNDER${lineVal}` : `WATCH OVER${lineVal}`;
      shortDesc = `${isUnder ? "Under" : "Over"}${lineVal} — Total`;
    } else if (bet.betType === "moneyline") {
      const teamShort = (pickStr.split(" ").slice(-1)[0] ?? pickStr).toUpperCase();
      directive = `WATCH ${teamShort} ML`;
      shortDesc = `${pickStr} — Moneyline`;
    } else if (bet.betType === "spread") {
      const teamShort = (pickStr.split(" ").slice(-1)[0] ?? pickStr).toUpperCase();
      directive = `WATCH ${teamShort} SPREAD${lineVal}`;
      shortDesc = `${pickStr}${lineVal} — Spread`;
    } else if (bet.betType === "player_prop") {
      const dir = isUnder ? "UNDER" : "OVER";
      const pName = extractPlayerName(bet);
      const stat  = extractStatType(bet);
      directive = pName
        ? `WATCH ${pName.toUpperCase()} ${dir}${lineVal}`
        : `WATCH ${dir}${lineVal}`;
      shortDesc = pName
        ? `${pName} ${dir}${lineVal} ${stat}`
        : `${dir}${lineVal} — Player Prop`;
    } else {
      directive = `WATCH ${pickStr.toUpperCase()}`;
      shortDesc = pickStr;
    }

    candidates.push({
      id: `watch-${bet.id}`,
      sport: bet.sport,
      teams: [bet.awayTeam, bet.homeTeam].filter(Boolean).join(" @ ") || bet.sport,
      gameTime: bet.gameTime ?? null,
      directive,
      betType: bet.betType ?? "bet",
      shortDesc,
      confirmedSignals,
      missingSignals,
      proximity: Math.min(99, proximity),   // never 100 — that means it fired
      bet,
      gameLine: matchedGame,
      market: relatedMkts[0],
    });
  }

  // Split into team bets (cap 5) and props (cap 3), team bets first — total max 8
  const teamCandidates = candidates
    .filter(p => isTeamBet(p.bet!))
    .sort((a, b) => b.proximity - a.proximity)
    .slice(0, 5);
  const propCandidates = candidates
    .filter(p => !isTeamBet(p.bet!))
    .sort((a, b) => b.proximity - a.proximity)
    .slice(0, 3);
  return [...teamCandidates, ...propCandidates];
}

// ─────────────────────────────────────────────────────────────────────────────
// Proximity Meter (for watching plays)
// ─────────────────────────────────────────────────────────────────────────────
function ProximityMeter({ proximity }: { proximity: number }) {
  const color = proximity >= 85 ? "#f59e0b" : proximity >= 65 ? "#a78bfa" : "#60a5fa";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${proximity}%`,
            background: `linear-gradient(90deg, #60a5fa, ${color})`,
          }}
        />
      </div>
      <span className="text-[10px] font-black tabular-nums" style={{ color }}>{proximity}%</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Watching Card
// ─────────────────────────────────────────────────────────────────────────────
function WatchingCard({ play }: { play: WatchingPlay }) {
  const [expanded, setExpanded] = useState(false);
  const betTypeColor: Record<string, string> = {
    moneyline: "#facc15", spread: "#a78bfa", total: "#60a5fa", player_prop: "#34d399",
  };
  const btColor = betTypeColor[play.betType] ?? "#94a3b8";
  const sportEmoji: Record<string, string> = { NBA: "🏀", NFL: "🏈", MLB: "⚾", NHL: "🏒" };

  return (
    <div
      className="rounded-xl overflow-hidden border cursor-pointer transition-all"
      style={{
        borderColor: "rgba(251,191,36,0.25)",
        boxShadow: expanded ? "0 0 16px rgba(251,191,36,0.10)" : "0 0 6px rgba(251,191,36,0.05)",
        background: "rgba(251,191,36,0.03)",
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Header */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full border" style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", borderColor: "rgba(251,191,36,0.30)" }}>
                👁 WATCHING
              </span>
              <span className="text-[9px] text-muted-foreground">
                {sportEmoji[play.sport] ?? "🏟"} {play.sport}
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${btColor}18`, color: btColor }}
              >
                {play.betType.replace("_", " ").toUpperCase()}
              </span>
            </div>

            {/* Teams */}
            <p className="text-[11px] text-muted-foreground truncate">{play.teams}</p>

            {/* Directive */}
            <p className="text-lg font-black tracking-tight leading-tight mt-0.5" style={{ color: "#fbbf24" }}>
              {play.directive}
            </p>
            <p className="text-[11px] font-medium text-foreground/60 mt-0.5">{play.shortDesc}</p>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className="w-24">
              <p className="text-[9px] text-muted-foreground text-right mb-1">Proximity</p>
              <ProximityMeter proximity={play.proximity} />
            </div>
            {play.gameTime && (
              <span className="text-[9px] text-muted-foreground">{fmtTime(play.gameTime)}</span>
            )}
            {expanded
              ? <ChevronUp size={14} className="text-muted-foreground" />
              : <ChevronDown size={14} className="text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Collapsed: what's confirmed vs missing */}
      {!expanded && (
        <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          {play.confirmedSignals.map((s, i) => (
            <span
              key={i}
              className="text-[9px] font-bold px-2 py-0.5 rounded-full border"
              style={{ background: s.bg, color: s.color, borderColor: `${s.color}35` }}
            >
              ✓ {s.type === "model" ? "Model" : s.type === "line_movement" ? "Line Mvmt" : "Whale"}
            </span>
          ))}
          {play.missingSignals.map((m, i) => (
            <span
              key={i}
              className="text-[9px] font-bold px-2 py-0.5 rounded-full border"
              style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.30)", borderColor: "rgba(255,255,255,0.10)", textDecoration: "none" }}
            >
              ○ {m.type === "model" ? "Model" : m.type === "line_movement" ? "Line Mvmt" : "Whale"}
            </span>
          ))}
          <span className="text-[9px] text-muted-foreground ml-auto">tap to expand →</span>
        </div>
      )}

      {/* Expanded */}
      {expanded && (
        <div className="border-t px-4 py-4 space-y-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>

          {/* Confirmed signals */}
          {play.confirmedSignals.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Star size={10} /> Confirmed Signals
              </p>
              {play.confirmedSignals.map((s, i) => (
                <SignalRow key={i} signal={s} />
              ))}
            </div>
          )}

          {/* Missing signals — what needs to happen */}
          {play.missingSignals.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "#fbbf24" }}>
                <Clock size={10} /> Still Waiting On
              </p>
              {play.missingSignals.map((m, i) => (
                <div
                  key={i}
                  className="rounded-lg border px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.10)" }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm leading-none">{m.icon}</span>
                    <p className="text-xs font-bold text-muted-foreground">{m.label}</p>
                    <span
                      className="text-[9px] font-black px-1.5 py-0.5 rounded-full ml-auto"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}
                    >
                      PENDING
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/65 leading-relaxed">{m.hint}</p>
                </div>
              ))}
            </div>
          )}

          {/* Clubhouse IQ model data */}
          {play.bet && (
            <div className="rounded-lg p-3 space-y-1.5 border border-yellow-500/15" style={{ background: "rgba(250,204,21,0.04)" }}>
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                <Zap size={10} /> Model Data
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div><span className="text-muted-foreground">Pick: </span><span className="font-semibold">{play.bet.pick}</span></div>
                <div><span className="text-muted-foreground">Confidence: </span><span className="font-semibold text-amber-800">{play.bet.confidenceScore}/100</span></div>
                {play.bet.grade && <div><span className="text-muted-foreground">Grade: </span><span className="font-semibold">{play.bet.grade}</span></div>}
                {play.bet.line != null && <div><span className="text-muted-foreground">Line: </span><span className="font-semibold">{play.bet.line}</span></div>}
              </div>
            </div>
          )}

          <p className="text-[9px] text-foreground/50">
            Watching plays haven't met full confluence yet. Auto-promotes to Top Plays once all required signals align.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Score Meter
// ─────────────────────────────────────────────────────────────────────────────
function ConvictionMeter({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = Math.min(100, (score / maxScore) * 100);
  const color = pct >= 85 ? "#f87171" : pct >= 65 ? "#facc15" : "#60a5fa";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-black tabular-nums" style={{ color }}>{Math.round(pct)}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal Row
// ─────────────────────────────────────────────────────────────────────────────
function SignalRow({ signal }: { signal: ConvictionSignal }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg border cursor-pointer select-none transition-all"
      style={{ background: signal.bg, borderColor: `${signal.color}35` }}
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="text-base leading-none flex-shrink-0">{signal.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold leading-tight" style={{ color: signal.color }}>{signal.label}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: `${signal.color}20`, color: signal.color }}
          >
            {signal.strength === "strong" ? "STRONG" : "MOD"}
          </span>
          {open
            ? <ChevronUp size={12} className="text-muted-foreground" />
            : <ChevronDown size={12} className="text-muted-foreground" />}
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{signal.detail}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Conviction Card
// ─────────────────────────────────────────────────────────────────────────────
const SPORT_EMOJI: Record<string, string> = { NBA: "🏀", NFL: "🏈", MLB: "⚾", NHL: "🏒" };
const BET_TYPE_COLOR: Record<string, string> = {
  moneyline: "#facc15", spread: "#a78bfa", total: "#60a5fa", player_prop: "#34d399",
};

function ConvictionCard({ play }: { play: ConvictionPlay }) {
  const [expanded, setExpanded] = useState(false);
  const signalCount = play.signals.length;
  const allThree    = signalCount >= 3;
  const maxScore    = signalCount * 105; // max possible

  // Glow color based on signal count
  const glowColor = allThree ? "#f87171" : "#facc15";
  const borderColor = allThree ? "rgba(248,113,113,0.45)" : "rgba(250,204,21,0.35)";
  const headerBg    = allThree ? "rgba(248,113,113,0.08)" : "rgba(250,204,21,0.07)";

  return (
    <div
      className="rounded-xl overflow-hidden border transition-all cursor-pointer"
      style={{
        borderColor,
        boxShadow: expanded ? `0 0 20px ${glowColor}22` : `0 0 10px ${glowColor}11`,
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Header */}
      <div className="px-4 py-3" style={{ background: headerBg }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Signal count badge + sport */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {allThree && (
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-red-500/20 text-red-700 border border-red-500/35">
                  🔥 ALL 3 SIGNALS
                </span>
              )}
              {!allThree && (
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-yellow-500/15 text-amber-800 border border-yellow-500/30">
                  ⚡ {signalCount} SIGNALS
                </span>
              )}
              <span className="text-[9px] text-muted-foreground">
                {SPORT_EMOJI[play.sport] ?? "🏟"} {play.sport}
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${BET_TYPE_COLOR[play.betType] ?? "#94a3b8"}18`, color: BET_TYPE_COLOR[play.betType] ?? "#94a3b8" }}
              >
                {play.betType.replace("_", " ").toUpperCase()}
              </span>
              {/* Edge tier badge on conviction card */}
              {play.bet && (play.bet as any).edgeTier && (play.bet as any).edgeTier !== "C" && (() => {
                const tier = (play.bet as any).edgeTier as string;
                const ep   = (play.bet as any).edgePct as number | undefined;
                const edgeColors: Record<string, string> = { "A+": "#4ade80", "A": "#facc15", "B": "#93c5fd" };
                const c = edgeColors[tier] ?? "#94a3b8";
                return (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded border" style={{ background: `${c}18`, color: c, borderColor: `${c}40` }}>
                    📊 {tier}{ep != null ? ` +${ep.toFixed(0)}%` : ""}
                  </span>
                );
              })()}
            </div>

            {/* Teams */}
            <p className="text-[11px] text-muted-foreground truncate">{play.teams}</p>

            {/* THE DIRECTIVE */}
            <p
              className="text-xl font-black tracking-tight leading-tight mt-0.5"
              style={{ color: glowColor }}
            >
              {play.directive}
            </p>
            <p className="text-[11px] font-medium text-foreground/70 mt-0.5">{play.shortDesc}</p>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {/* Conviction meter */}
            <div className="w-24">
              <p className="text-[9px] text-muted-foreground text-right mb-1">Conviction</p>
              <ConvictionMeter score={play.totalScore} maxScore={maxScore} />
            </div>
            {/* Game time */}
            {play.gameTime && (
              <span className="text-[9px] text-muted-foreground">{fmtTime(play.gameTime)}</span>
            )}
            {expanded
              ? <ChevronUp size={14} className="text-muted-foreground" />
              : <ChevronDown size={14} className="text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Signal pills row (collapsed) */}
      {!expanded && (
        <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap border-t border-white/5">
          {play.signals.map((s, i) => (
            <span
              key={i}
              className="text-[9px] font-bold px-2 py-0.5 rounded-full border"
              style={{ background: s.bg, color: s.color, borderColor: `${s.color}35` }}
            >
              {s.icon} {s.type === "model" ? "Clubhouse IQ Model" : s.type === "line_movement" ? "Line Movement" : "Whale Buy"}
            </span>
          ))}
          <span className="text-[9px] text-muted-foreground ml-auto">tap to expand →</span>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/8 px-4 py-4 space-y-4">

          {/* All signals stacked */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Star size={10} /> Confluence Signals
            </p>
            {play.signals.map((s, i) => (
              <SignalRow key={i} signal={s} />
            ))}
          </div>

          {/* Clubhouse IQ model detail */}
          {play.bet && (
            <div className="rounded-lg p-3 space-y-2 border border-yellow-500/20" style={{ background: "rgba(250,204,21,0.05)" }}>
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                <Zap size={10} /> Clubhouse IQ Model Data
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div><span className="text-muted-foreground">Pick: </span><span className="font-semibold">{play.bet.pick}</span></div>
                <div><span className="text-muted-foreground">Confidence: </span><span className="font-semibold text-amber-800">{play.bet.confidenceScore}/100</span></div>
                {play.bet.line != null && <div><span className="text-muted-foreground">Line: </span><span className="font-semibold">{play.bet.line}</span></div>}
                {play.bet.grade && <div><span className="text-muted-foreground">Grade: </span><span className="font-semibold">{play.bet.grade}</span></div>}
                {play.bet.overOdds != null && <div><span className="text-muted-foreground">Over: </span><span className="font-semibold font-mono">{fmtOdds(play.bet.overOdds)}</span></div>}
                {play.bet.underOdds != null && <div><span className="text-muted-foreground">Under: </span><span className="font-semibold font-mono">{fmtOdds(play.bet.underOdds)}</span></div>}
                {play.bet.analysis && (
                  <div className="col-span-2 mt-1">
                    <span className="text-muted-foreground">Analysis: </span>
                    <span className="text-foreground/80">{play.bet.analysis}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Line movement detail */}
          {play.gameLine && (
            <div className="rounded-lg p-3 space-y-2 border border-red-500/20" style={{ background: "rgba(248,113,113,0.05)" }}>
              <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp size={10} /> Line Movement Data
              </p>
              <div className="grid grid-cols-3 gap-3 text-[11px]">
                {play.gameLine.spread.open != null && (
                  <div>
                    <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Spread</p>
                    <p className="font-mono font-semibold">
                      {fmtLine(play.gameLine.spread.open)}
                      <span className="text-muted-foreground mx-1">→</span>
                      {fmtLine(play.gameLine.spread.current)}
                      {play.gameLine.spread.move !== 0 && play.gameLine.spread.move != null && (
                        <span className={`ml-1 ${Math.abs(play.gameLine.spread.move) >= 3 ? "text-red-700" : "text-amber-800"}`}>
                          ({play.gameLine.spread.move > 0 ? "+" : ""}{play.gameLine.spread.move})
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {play.gameLine.total.open != null && (
                  <div>
                    <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Total</p>
                    <p className="font-mono font-semibold">
                      {play.gameLine.total.open}
                      <span className="text-muted-foreground mx-1">→</span>
                      {play.gameLine.total.current}
                      {play.gameLine.total.move !== 0 && play.gameLine.total.move != null && (
                        <span className={`ml-1 ${Math.abs(play.gameLine.total.move) >= 3 ? "text-red-700" : "text-amber-800"}`}>
                          ({play.gameLine.total.move > 0 ? "+" : ""}{play.gameLine.total.move})
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {(play.gameLine.spread.awayPublic != null) && (
                  <div>
                    <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Public Split</p>
                    <p className="font-semibold text-[11px]">
                      {play.gameLine.awayTeam.split(" ").pop()} {play.gameLine.spread.awayPublic}%
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Prediction market whale detail */}
          {play.market && (
            <div className="rounded-lg p-3 space-y-2 border border-green-500/20" style={{ background: "rgba(52,211,153,0.05)" }}>
              <p className="text-[10px] font-bold text-green-800 uppercase tracking-wider flex items-center gap-1.5">
                <Fish size={10} /> Whale Market Signal
              </p>
              <p className="text-xs font-semibold text-foreground/90">{play.market.title}</p>
              <div className="grid grid-cols-3 gap-3 text-[11px]">
                <div>
                  <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Yes Price</p>
                  <p className="font-mono font-bold text-green-800">{Math.round(play.market.yesPrice * 100)}¢</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[9px] uppercase mb-0.5">24h Volume</p>
                  <p className="font-semibold">{fmtVol(play.market.vol24h)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Price Move</p>
                  <p className="font-semibold text-green-800">
                    +{play.market.whalePriceMovePct.toFixed(1)}%
                  </p>
                </div>
              </div>
              {(play.market.polyUrl || play.market.kalshiUrl) && (
                <a
                  href={play.market.polyUrl ?? play.market.kalshiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-green-800 hover:underline"
                  onClick={e => e.stopPropagation()}
                >
                  View on {play.market.source === "polymarket" ? "Polymarket" : "Kalshi"} →
                </a>
              )}
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[9px] text-foreground/50">
            Confluence plays require ≥2 aligned signals. Not financial advice. Always manage bankroll responsibly.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl" style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.20)" }}>
        ⚡
      </div>
      <div>
        <p className="font-bold text-foreground">No High Conviction Plays Right Now</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          This tab only surfaces plays where the Clubhouse IQ model, line movement, AND a prediction market whale signal all point the same direction. Check back closer to game time.
        </p>
      </div>
      <div className="rounded-xl p-4 text-left max-w-sm border border-border/40 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">What triggers a play?</p>
        <div className="space-y-1.5">
          {[
            { icon: "⭐", text: "Clubhouse IQ model ≥82/100 confidence" },
            { icon: "🔥", text: "Line movement aligned (steam or RLM)" },
            { icon: "🐋", text: "Prediction market whale buying same side" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function HighConviction() {
  const [sportFilter, setSportFilter] = useState<string>("All");
  const [signalFilter, setSignalFilter] = useState<number>(0); // 0 = all, 2 = 2+, 3 = 3 only

  const { data: bets = [], isLoading: betsLoading, refetch: refetchBets } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    queryFn: () => apiRequest("GET", "/api/bets").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: markets = [], isLoading: mktLoading, refetch: refetchMkts } = useQuery<PredMkt[]>({
    queryKey: ["/api/prediction-markets"],
    queryFn: () => apiRequest("GET", "/api/prediction-markets").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: games = [], isLoading: linesLoading, refetch: refetchLines } = useQuery<GameLine[]>({
    queryKey: ["/api/line-movement"],
    queryFn: () => apiRequest("GET", "/api/line-movement").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const isLoading = betsLoading || mktLoading || linesLoading;

  const allPlays = useMemo(
    () => buildConvictionPlays(bets as Bet[], markets as PredMkt[], games as GameLine[]),
    [bets, markets, games]
  );

  const filtered = useMemo(() => {
    let p = allPlays;
    if (sportFilter !== "All") p = p.filter(x => x.sport === sportFilter);
    if (signalFilter === 3) p = p.filter(x => x.signals.length >= 3);
    if (signalFilter === 2) p = p.filter(x => x.signals.length === 2);
    return p;
  }, [allPlays, sportFilter, signalFilter]);

  const tripleCount = allPlays.filter(p => p.signals.length >= 3).length;
  const doubleCount = allPlays.filter(p => p.signals.length === 2).length;

  const convictionIds = useMemo(() => new Set(allPlays.map(p => p.id)), [allPlays]);

  const watchingPlays = useMemo(
    () => buildWatchingPlays(bets as Bet[], markets as PredMkt[], games as GameLine[], convictionIds),
    [bets, markets, games, convictionIds]
  );

  const sports = ["All", ...Array.from(new Set(allPlays.map(p => p.sport))).sort()];

  function refetchAll() { refetchBets(); refetchMkts(); refetchLines(); }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">⚡</span>
            <h1 className="text-xl font-black text-foreground">High Conviction Plays</h1>
          </div>
          <p className="text-xs text-muted-foreground max-w-md">
            Only shows plays where Clubhouse IQ model, line movement, AND prediction market whale signals all align. Minimum 2 of 3 signals required.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll} className="gap-1.5 flex-shrink-0">
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      {!isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "All 3 Signals", value: tripleCount, color: "#f87171", bg: "rgba(248,113,113,0.08)", icon: "🔥" },
            { label: "2 Signals", value: doubleCount, color: "#facc15", bg: "rgba(250,204,21,0.08)", icon: "⚡" },
            { label: "Total Plays", value: allPlays.length, color: "#94a3b8", bg: "rgba(148,163,184,0.06)", icon: "📋" },
          ].map(k => (
            <div key={k.label} className="rounded-xl p-3 border border-white/8" style={{ background: k.bg }}>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">{k.icon} {k.label}</p>
              <p className="text-2xl font-black mt-0.5" style={{ color: k.value > 0 ? k.color : "rgba(255,255,255,0.2)" }}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Signal filter */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Sport filters */}
        <div className="flex gap-1 flex-wrap">
          {sports.map(s => (
            <button key={s} onClick={() => setSportFilter(s)}
              className="px-2.5 py-1 rounded-full text-xs font-bold transition-all"
              style={{
                background: sportFilter === s ? "#facc15" : "rgba(255,255,255,0.04)",
                color: sportFilter === s ? "#1a1a1a" : "var(--muted-foreground)",
                border: sportFilter === s ? "1px solid #facc15" : "1px solid rgba(255,255,255,0.08)",
                boxShadow: sportFilter === s ? "0 0 8px #facc1580" : "none",
              }}>
              {s}
            </button>
          ))}
        </div>

        {/* Signal count filter */}
        <div className="flex gap-1 ml-auto">
          {[
            { val: 0, label: "All Signals" },
            { val: 3, label: "🔥 3 Only" },
            { val: 2, label: "⚡ 2 Only" },
          ].map(f => (
            <button key={f.val} onClick={() => setSignalFilter(f.val)}
              className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all"
              style={{
                background: signalFilter === f.val ? "#facc15" : "rgba(255,255,255,0.04)",
                color: signalFilter === f.val ? "#1a1a1a" : "var(--muted-foreground)",
                border: signalFilter === f.val ? "1px solid #facc15" : "1px solid rgba(255,255,255,0.08)",
                boxShadow: signalFilter === f.val ? "0 0 8px #facc1580" : "none",
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-white/[0.03] border border-white/6 animate-pulse" />
          ))}
        </div>
      )}

      {/* Plays — team bets first, then props (max 3) with a divider */}
      {!isLoading && filtered.length > 0 && (() => {
        const teamFired = filtered.filter(p => isTeamBet(p.bet!));
        const propFired = filtered.filter(p => !isTeamBet(p.bet!));
        return (
          <div className="space-y-2">
            {teamFired.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#facc15" }}>Team Bets</span>
                  <div className="flex-1 h-px" style={{ background: "rgba(250,204,21,0.15)" }} />
                  <span className="text-[9px] text-foreground/55">{teamFired.length}</span>
                </div>
                {teamFired.map(play => <ConvictionCard key={play.id} play={play} />)}
              </>
            )}
            {propFired.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1 mt-1">
                  <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#34d399" }}>Player Props</span>
                  <div className="flex-1 h-px" style={{ background: "rgba(52,211,153,0.15)" }} />
                  <span className="text-[9px] text-foreground/55">{propFired.length}/3</span>
                </div>
                {propFired.map(play => <ConvictionCard key={play.id} play={play} />)}
              </>
            )}
          </div>
        );
      })()}


      {/* Empty */}
      {!isLoading && filtered.length === 0 && <EmptyState />}

      {/* ── Watching Plays Section ── */}
      {!isLoading && (
        <div className="space-y-3">
          {/* Section header */}
          <div
            className="rounded-xl px-4 py-3 border flex items-center justify-between"
            style={{ background: "rgba(251,191,36,0.04)", borderColor: "rgba(251,191,36,0.18)" }}
          >
            <div className="flex items-center gap-2.5">
              <Eye size={16} style={{ color: "#fbbf24" }} />
              <div>
                <p className="text-sm font-black" style={{ color: "#fbbf24" }}>Watching Plays</p>
                <p className="text-[10px] text-muted-foreground">
                  Up to 5 team bets + 3 player props being monitored
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span
                className="text-xs font-black px-2.5 py-1 rounded-full"
                style={{ background: "rgba(251,191,36,0.14)", color: "#fbbf24" }}
              >
                {watchingPlays.length} / 8
              </span>
              <span className="text-[9px] text-foreground/55 pr-1">5 team · 3 props</span>
            </div>
          </div>

          {watchingPlays.length > 0 ? (() => {
            const teamW = watchingPlays.filter(p => isTeamBet(p.bet!));
            const propW  = watchingPlays.filter(p => !isTeamBet(p.bet!));
            return (
              <div className="space-y-2">
                {teamW.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#fbbf24" }}>Team Bets</span>
                      <div className="flex-1 h-px" style={{ background: "rgba(251,191,36,0.15)" }} />
                      <span className="text-[9px] text-foreground/55">{teamW.length}/5</span>
                    </div>
                    {teamW.map(play => <WatchingCard key={play.id} play={play} />)}
                  </>
                )}
                {propW.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-1 mt-1">
                      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#34d399" }}>Player Props</span>
                      <div className="flex-1 h-px" style={{ background: "rgba(52,211,153,0.15)" }} />
                      <span className="text-[9px] text-foreground/55">{propW.length}/3</span>
                    </div>
                    {propW.map(play => <WatchingCard key={play.id} play={play} />)}
                  </>
                )}
              </div>
            );
          })() : (
            <div
              className="rounded-xl border px-4 py-6 flex flex-col items-center text-center gap-2"
              style={{ background: "rgba(255,255,255,0.01)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <Eye size={22} className="text-foreground/45" />
              <p className="text-sm font-semibold text-foreground/60">Nothing on the watchlist</p>
              <p className="text-[11px] text-foreground/50 max-w-xs">
                Plays appear here when the Clubhouse IQ model likes them but they're still waiting on a line movement or whale signal.
              </p>
            </div>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl p-4 border border-border/30 space-y-3" style={{ background: "rgba(255,255,255,0.01)" }}>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <AlertCircle size={10} /> How Confluence Works
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
          {[
            { icon: "⭐", title: "Clubhouse IQ Model", desc: "Must score ≥82/100. The model factors in recent stats, opponent matchup, line value, and historical trends." },
            { icon: "🔥", title: "Line Movement", desc: "Spread or total must move ≥1.5 pts in the same direction as the pick, OR reverse line movement detected." },
            { icon: "🐋", title: "Whale Signal", desc: "A prediction market (Kalshi or Polymarket) must show a whale buying YES on the same outcome — $100K+ size or 5¢+ price move." },
          ].map((item, i) => (
            <div key={i} className="space-y-1">
              <p className="font-bold text-foreground flex items-center gap-1.5">{item.icon} {item.title}</p>
              <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
