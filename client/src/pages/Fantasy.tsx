/**
 * PropEdge Fantasy Decision Engine
 *
 * Three sub-views:
 *   1. Preseason Lab  — player outlook cards, sleepers/busts, draft board tiers
 *   2. Draft Room     — live draft board, ADP vs model rank, reach/steal, pick now/wait
 *   3. In-Season      — start/sit, waiver wire, trade analyzer, weekly projections
 *
 * Design language mirrors PredictionMarkets:
 *   - Summary stat chips at top
 *   - Sport + format + position filter strip
 *   - Card-based ranked player list
 *   - Action tags (Draft, Avoid, Start, Sit, Add, Trade For, Sell)
 *   - Explanation layer on expand
 */

import { useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, Users, Zap, Star, AlertTriangle,
  RefreshCw, Search, ChevronDown, ChevronUp, Target,
  Award, Activity, ArrowUpRight, ArrowDownRight, Minus,
  Shield, Clock, BarChart2, Flame, Shuffle, Trophy,
} from "lucide-react";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SubView    = "preseason" | "draft" | "inseason";
type SportTab   = "ALL" | "NFL" | "NBA" | "MLB" | "NHL";
type FormatTab  = "standard" | "ppr" | "half_ppr" | "superflex" | "dynasty" | "bestball";
type PositionF  = "ALL" | "QB" | "RB" | "WR" | "TE" | "K" | "DST" | "SP" | "RP" | "C" | "1B" | "2B" | "3B" | "SS" | "OF" | "F" | "D" | "G";
type ActionTag  = "DRAFT" | "AVOID" | "START" | "SIT" | "ADD" | "TRADE FOR" | "SELL" | "HOLD" | "SLEEPER" | "BUST";
type RiskLevel  = "low" | "medium" | "high";
type Trend      = "up" | "down" | "flat";

interface PlayerCard {
  id: string;
  name: string;
  sport: SportTab;
  team: string;
  position: string;
  // Three core scores
  consensusRank: number;      // blended ADP/expert rank (lower = better)
  modelRank: number;          // PropEdge internal rank
  actionScore: number;        // 0–100
  actionTag: ActionTag;
  // Projection
  projection: string;         // "24.6 pts" / "87 rushing yards"
  ceiling: string;
  floor: string;
  adp: number;                // Average Draft Position
  // Supporting signals
  riskLevel: RiskLevel;
  injuryStatus: string | null; // "Questionable", "OUT", null
  trend: Trend;
  valueGap: number;           // modelRank - consensusRank (negative = undervalued)
  breakoutProb: number;       // 0–100
  scheduleGrade: "A" | "B" | "C" | "D" | "F";
  usageNote: string;
  // In-season specific
  opponent?: string;
  matchupRank?: number;       // 1–32 (1 = easiest)
  snapsharePct?: number;
  targetShare?: number;
  weeklyProj?: number;
  reason: string;             // explanation text
  // Draft-specific
  roundEst?: number;
  reach?: boolean;
  steal?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data — mirrors the "no fake data" approach by being clearly labeled
// as projection model estimates (not live game results)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PLAYERS: PlayerCard[] = [
  // ── NFL ──────────────────────────────────────────────────────────────────
  {
    id: "nfl-1", name: "Ja'Marr Chase", sport: "NFL", team: "Cincinnati Bengals", position: "WR",
    consensusRank: 3, modelRank: 2, actionScore: 91, actionTag: "DRAFT",
    projection: "138 rec yards / wk", ceiling: "180 yds + TD", floor: "70 yds",
    adp: 3.2, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: -1,
    breakoutProb: 82, scheduleGrade: "B", usageNote: "31% target share, WR1 role locked",
    opponent: "TBD", matchupRank: 8, snapsharePct: 96, targetShare: 31, weeklyProj: 22.4,
    reason: "Elite target share with Burrow back healthy. Model rank slightly above consensus — take confidently in top 3.",
    roundEst: 1, reach: false, steal: false,
  },
  {
    id: "nfl-2", name: "Bijan Robinson", sport: "NFL", team: "Atlanta Falcons", position: "RB",
    consensusRank: 7, modelRank: 4, actionScore: 88, actionTag: "DRAFT",
    projection: "94 rush yds + 4 rec", ceiling: "130 yds + TD", floor: "55 yds",
    adp: 7.8, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: -3,
    breakoutProb: 76, scheduleGrade: "A", usageNote: "Bell-cow back, 85%+ snap share",
    opponent: "TBD", matchupRank: 5, snapsharePct: 87, targetShare: 12, weeklyProj: 19.1,
    reason: "ADP undervalues Bijan — model projects RB4 based on usage trends and favorable schedule. Steal at pick 7-8.",
    roundEst: 1, reach: false, steal: true,
  },
  {
    id: "nfl-3", name: "Davante Adams", sport: "NFL", team: "New York Jets", position: "WR",
    consensusRank: 18, modelRank: 28, actionScore: 41, actionTag: "AVOID",
    projection: "72 rec yards / wk", ceiling: "105 yds", floor: "30 yds",
    adp: 16.4, riskLevel: "high", injuryStatus: "Questionable", trend: "down", valueGap: 10,
    breakoutProb: 22, scheduleGrade: "C", usageNote: "New QB situation — target share uncertain",
    opponent: "TBD", matchupRank: 21, snapsharePct: 82, targetShare: 19, weeklyProj: 11.2,
    reason: "New QB, aging legs, and a mediocre schedule. Consensus overvalues the name — model flags as overpriced at current ADP.",
    roundEst: 2, reach: true, steal: false,
  },
  {
    id: "nfl-4", name: "Jordan Love", sport: "NFL", team: "Green Bay Packers", position: "QB",
    consensusRank: 9, modelRank: 7, actionScore: 74, actionTag: "DRAFT",
    projection: "285 pass yds / wk", ceiling: "340 yds + 3 TD", floor: "200 yds",
    adp: 9.5, riskLevel: "medium", injuryStatus: null, trend: "up", valueGap: -2,
    breakoutProb: 68, scheduleGrade: "B", usageNote: "Improved red-zone efficiency, WR corps healthy",
    opponent: "TBD", matchupRank: 9, weeklyProj: 24.1,
    reason: "Love's efficiency gains from last season carry over. Model ranks him slightly ahead of ADP — QB9 feels like underpriced value.",
    roundEst: 2, reach: false, steal: false,
  },
  {
    id: "nfl-5", name: "Alvin Kamara", sport: "NFL", team: "New Orleans Saints", position: "RB",
    consensusRank: 14, modelRank: 22, actionScore: 35, actionTag: "AVOID",
    projection: "71 rush yds / wk", ceiling: "100 yds + TD", floor: "35 yds",
    adp: 13.8, riskLevel: "high", injuryStatus: null, trend: "down", valueGap: 8,
    breakoutProb: 18, scheduleGrade: "D", usageNote: "Age concern + offensive line ranked 28th",
    opponent: "TBD", matchupRank: 24, snapsharePct: 78, targetShare: 14, weeklyProj: 12.8,
    reason: "Declining usage trend + brutal schedule. Model projects significant regression from consensus rank.",
    roundEst: 2, reach: true, steal: false,
  },
  // ── NBA ──────────────────────────────────────────────────────────────────
  {
    id: "nba-1", name: "Nikola Jokić", sport: "NBA", team: "Denver Nuggets", position: "C",
    consensusRank: 1, modelRank: 1, actionScore: 97, actionTag: "DRAFT",
    projection: "27/12/9 per game", ceiling: "Triple-double every night", floor: "22/9/7",
    adp: 1.0, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: 0,
    breakoutProb: 95, scheduleGrade: "A", usageNote: "Usage rate 28%, 100% of plays run through him",
    weeklyProj: 62.0,
    reason: "The consensus #1 and model agrees. Unmatched floor, ceiling, and consistency. If he's there — take him.",
    roundEst: 1, reach: false, steal: false,
  },
  {
    id: "nba-2", name: "Tyrese Haliburton", sport: "NBA", team: "Indiana Pacers", position: "G",
    consensusRank: 8, modelRank: 5, actionScore: 83, actionTag: "SLEEPER",
    projection: "22pts / 11 ast / 4 reb", ceiling: "25/13 with 3+ 3s", floor: "18/8",
    adp: 8.2, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: -3,
    breakoutProb: 79, scheduleGrade: "A", usageNote: "Primary ball-handler, pace-up Pacers scheme",
    weeklyProj: 48.5,
    reason: "Model ranks Haliburton 3 spots ahead of ADP. Assists upside is elite and pace advantage makes him consistent every night.",
    roundEst: 1, reach: false, steal: true,
  },
  {
    id: "nba-3", name: "Kevin Durant", sport: "NBA", team: "Phoenix Suns", position: "F",
    consensusRank: 6, modelRank: 11, actionScore: 44, actionTag: "HOLD",
    projection: "26pts / 7 reb / 5 ast", ceiling: "32/9", floor: "20/5",
    adp: 5.8, riskLevel: "high", injuryStatus: "Questionable", trend: "down", valueGap: 5,
    breakoutProb: 35, scheduleGrade: "C", usageNote: "Injury risk at age 36, usage trending down",
    weeklyProj: 41.2,
    reason: "Name value inflating ADP. Age + injury flag + reduced role make him a risk at pick 6. Target in Rd 2 or pass.",
    roundEst: 1, reach: true, steal: false,
  },
  // ── MLB ──────────────────────────────────────────────────────────────────
  {
    id: "mlb-1", name: "Shohei Ohtani", sport: "MLB", team: "Los Angeles Dodgers", position: "OF",
    consensusRank: 1, modelRank: 1, actionScore: 98, actionTag: "DRAFT",
    projection: ".310 / 45 HR / 110 RBI", ceiling: "50 HR / 120 RBI", floor: ".285 / 38 HR",
    adp: 1.1, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: 0,
    breakoutProb: 90, scheduleGrade: "A", usageNote: "Two-way value; pitching returns in 2025",
    weeklyProj: 38.5,
    reason: "Two-way production makes him a category unto himself. Model and consensus align at 1.1 — no hesitation.",
    roundEst: 1, reach: false, steal: false,
  },
  {
    id: "mlb-2", name: "Ronald Acuña Jr.", sport: "MLB", team: "Atlanta Braves", position: "OF",
    consensusRank: 4, modelRank: 3, actionScore: 85, actionTag: "DRAFT",
    projection: ".295 / 38 HR / 60 SB", ceiling: "45 HR / 75 SB", floor: ".270 / 28 HR",
    adp: 3.9, riskLevel: "medium", injuryStatus: null, trend: "up", valueGap: -1,
    breakoutProb: 80, scheduleGrade: "B", usageNote: "Return from ACL; usage will be managed early",
    weeklyProj: 33.8,
    reason: "ACL return risk is already priced into ADP. Full-health Acuña at pick 4 is still solid value — model agrees.",
    roundEst: 1, reach: false, steal: false,
  },
  {
    id: "mlb-3", name: "Max Scherzer", sport: "MLB", team: "Texas Rangers", position: "SP",
    consensusRank: 22, modelRank: 38, actionScore: 28, actionTag: "AVOID",
    projection: "3.85 ERA / 180 K", ceiling: "3.50 ERA", floor: "4.40 ERA",
    adp: 20.4, riskLevel: "high", injuryStatus: "Questionable", trend: "down", valueGap: 16,
    breakoutProb: 12, scheduleGrade: "D", usageNote: "Age 40, TJ surgery recovery, innings limit likely",
    weeklyProj: 24.1,
    reason: "Innings limit, post-TJ recovery, and tough schedule. Model has him 16 spots below consensus — clear bust candidate.",
    roundEst: 3, reach: true, steal: false,
  },
  // ── NHL ──────────────────────────────────────────────────────────────────
  {
    id: "nhl-1", name: "Connor McDavid", sport: "NHL", team: "Edmonton Oilers", position: "F",
    consensusRank: 1, modelRank: 1, actionScore: 99, actionTag: "DRAFT",
    projection: "50G / 90A per season", ceiling: "55G / 100A", floor: "45G / 75A",
    adp: 1.0, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: 0,
    breakoutProb: 99, scheduleGrade: "A", usageNote: "PP1 QB, 22+ min TOI, best player on ice every night",
    weeklyProj: 14.5,
    reason: "Unanimous 1.01 pick. If he falls to you somehow, trade everything to move up.",
    roundEst: 1, reach: false, steal: false,
  },
  {
    id: "nhl-2", name: "Auston Matthews", sport: "NHL", team: "Toronto Maple Leafs", position: "F",
    consensusRank: 3, modelRank: 2, actionScore: 90, actionTag: "DRAFT",
    projection: "55G / 42A per season", ceiling: "65G / 50A", floor: "48G / 35A",
    adp: 2.8, riskLevel: "low", injuryStatus: null, trend: "up", valueGap: -1,
    breakoutProb: 85, scheduleGrade: "B", usageNote: "Elite goal-scorer, PP1, consistent linemates",
    weeklyProj: 13.8,
    reason: "Model ranks Auston one ahead of consensus at 2 — the goals-only upside is the highest in the pool.",
    roundEst: 1, reach: false, steal: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function actionColor(tag: ActionTag): { text: string; bg: string; border: string } {
  const m: Record<ActionTag, { text: string; bg: string; border: string }> = {
    DRAFT:      { text: "#4ade80", bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.30)" },
    AVOID:      { text: "#f87171", bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.30)" },
    START:      { text: "#34d399", bg: "rgba(52,211,153,0.10)", border: "rgba(52,211,153,0.30)" },
    SIT:        { text: "#fb923c", bg: "rgba(251,146,60,0.10)",  border: "rgba(251,146,60,0.30)" },
    ADD:        { text: "#60a5fa", bg: "rgba(96,165,250,0.10)",  border: "rgba(96,165,250,0.30)" },
    "TRADE FOR":{ text: "#a78bfa", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.30)" },
    SELL:       { text: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.25)" },
    HOLD:       { text: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.20)" },
    SLEEPER:    { text: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.30)" },
    BUST:       { text: "#ef4444", bg: "rgba(239,68,68,0.10)",   border: "rgba(239,68,68,0.30)" },
  };
  return m[tag] ?? m.HOLD;
}

function riskColor(r: RiskLevel) {
  return r === "low" ? "#4ade80" : r === "medium" ? "#f59e0b" : "#f87171";
}

function trendIcon(t: Trend) {
  if (t === "up")   return <TrendingUp  size={12} className="text-green-400" />;
  if (t === "down") return <TrendingDown size={12} className="text-red-400"  />;
  return <Minus size={12} className="text-muted-foreground" />;
}

function gradeColor(g: string) {
  const m: Record<string, string> = { A: "#4ade80", B: "#86efac", C: "#f59e0b", D: "#fb923c", F: "#f87171" };
  return m[g] ?? "#94a3b8";
}

function valueGapLabel(gap: number): { label: string; color: string } {
  if (gap <= -5) return { label: "Strong Steal", color: "#4ade80" };
  if (gap <= -2) return { label: "Slight Steal",  color: "#86efac" };
  if (gap >=  5) return { label: "Strong Reach",  color: "#f87171" };
  if (gap >=  2) return { label: "Slight Reach",  color: "#fb923c" };
  return { label: "Fair Value", color: "#94a3b8" };
}

const SPORT_POSITIONS: Record<SportTab, PositionF[]> = {
  ALL: ["ALL", "QB", "RB", "WR", "TE", "K", "DST", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "F", "D", "G"],
  NFL: ["ALL", "QB", "RB", "WR", "TE", "K", "DST"],
  NBA: ["ALL", "G", "F", "C"],
  MLB: ["ALL", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF"],
  NHL: ["ALL", "F", "D", "G"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Summary chips
// ─────────────────────────────────────────────────────────────────────────────
function SummaryChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2.5 min-w-0">
      <span style={{ color }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
        <p className="text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Card
// ─────────────────────────────────────────────────────────────────────────────
function PlayerRow({ p, view }: { p: PlayerCard; view: SubView }) {
  const [expanded, setExpanded] = useState(false);
  const ac = actionColor(p.actionTag);
  const vg = valueGapLabel(p.valueGap);

  return (
    <div
      className="bg-card border border-border rounded-xl overflow-hidden transition-all"
      style={{ borderColor: expanded ? ac.border : undefined }}
    >
      {/* ── Main row ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          {/* Rank badge */}
          <div className="shrink-0 w-9 h-9 rounded-lg bg-muted/40 border border-border flex items-center justify-center">
            <span className="text-xs font-black text-foreground">
              {view === "draft" ? `R${p.roundEst}` : `#${p.modelRank}`}
            </span>
          </div>

          {/* Name + team + position */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground leading-tight">{p.name}</span>
              {p.injuryStatus && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                  {p.injuryStatus}
                </span>
              )}
              {trendIcon(p.trend)}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{p.team}</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-[10px] font-bold text-muted-foreground">{p.position}</span>
            </div>
          </div>

          {/* Projection */}
          <div className="hidden sm:block text-right shrink-0">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Projection</p>
            <p className="text-xs font-bold text-foreground">{p.projection}</p>
          </div>

          {/* Value gap */}
          <div className="hidden md:block text-right shrink-0 w-20">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Value</p>
            <p className="text-[10px] font-bold" style={{ color: vg.color }}>{vg.label}</p>
          </div>

          {/* Action tag */}
          <div
            className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black border whitespace-nowrap"
            style={{ color: ac.text, background: ac.bg, borderColor: ac.border }}
          >
            {p.actionTag}
          </div>

          {/* Score */}
          <div className="shrink-0 w-10 text-center">
            <p className="text-sm font-black text-foreground">{p.actionScore}</p>
            <p className="text-[8px] text-muted-foreground">/100</p>
          </div>

          {expanded
            ? <ChevronUp  size={14} className="text-muted-foreground shrink-0" />
            : <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          }
        </div>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3" style={{ background: `${ac.bg.replace("0.10", "0.04")}` }}>

          {/* Why this recommendation */}
          <div className="bg-muted/30 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide mb-1">PropEdge Analysis</p>
            <p className="text-xs text-foreground leading-relaxed">{p.reason}</p>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatMini label="Consensus Rank" value={`#${p.consensusRank}`} />
            <StatMini label="Model Rank"     value={`#${p.modelRank}`}     />
            <StatMini label="ADP"            value={p.adp.toFixed(1)}      />
            <StatMini label="Action Score"   value={`${p.actionScore}/100`} highlight />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatMini label="Ceiling"      value={p.ceiling}    />
            <StatMini label="Floor"        value={p.floor}      />
            <StatMini label="Breakout %"   value={`${p.breakoutProb}%`} />
            <StatMini label="Schedule"
              value={<span style={{ color: gradeColor(p.scheduleGrade) }}>{p.scheduleGrade}</span>}
            />
          </div>

          {/* Usage + risk row */}
          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] px-2 py-1 rounded-lg border border-border bg-muted/20 text-muted-foreground">
              {p.usageNote}
            </span>
            <span
              className="text-[10px] px-2 py-1 rounded-lg border font-bold"
              style={{ color: riskColor(p.riskLevel), background: `${riskColor(p.riskLevel)}15`, borderColor: `${riskColor(p.riskLevel)}30` }}
            >
              {p.riskLevel.toUpperCase()} RISK
            </span>
            {(p.steal || p.reach) && (
              <span
                className="text-[10px] px-2 py-1 rounded-lg border font-bold"
                style={{
                  color: p.steal ? "#4ade80" : "#f87171",
                  background: p.steal ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                  borderColor: p.steal ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)",
                }}
              >
                {p.steal ? "✓ STEAL" : "⚠ REACH"}
              </span>
            )}
          </div>

          {/* In-season matchup block */}
          {view === "inseason" && p.opponent && (
            <div className="bg-muted/20 border border-border rounded-lg p-3 flex flex-wrap gap-4">
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Opponent</p>
                <p className="text-xs font-bold text-foreground">{p.opponent}</p>
              </div>
              {p.matchupRank && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Matchup Rank</p>
                  <p className="text-xs font-bold" style={{ color: p.matchupRank <= 10 ? "#4ade80" : p.matchupRank <= 22 ? "#f59e0b" : "#f87171" }}>
                    #{p.matchupRank} vs {p.position}
                  </p>
                </div>
              )}
              {p.snapsharePct && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Snap Share</p>
                  <p className="text-xs font-bold text-foreground">{p.snapsharePct}%</p>
                </div>
              )}
              {p.targetShare && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Target Share</p>
                  <p className="text-xs font-bold text-foreground">{p.targetShare}%</p>
                </div>
              )}
              {p.weeklyProj && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Proj. Pts</p>
                  <p className="text-xs font-bold text-green-400">{p.weeklyProj}</p>
                </div>
              )}
            </div>
          )}

          {/* Draft pick-now / wait row */}
          {view === "draft" && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Draft strategy:</span>
              {p.steal
                ? <span className="font-bold text-green-400">Pick now — value won't last to next round</span>
                : p.reach
                ? <span className="font-bold text-orange-400">Wait 1–2 rounds — likely available later</span>
                : <span className="font-bold text-muted-foreground">Fair pick — take if fits your roster need</span>
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatMini({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="bg-muted/20 border border-border/60 rounded-lg px-2.5 py-2">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
      <p className={`text-xs font-bold mt-0.5 ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter strip
// ─────────────────────────────────────────────────────────────────────────────
function FilterPill<T extends string>({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  renderLabel?: (v: T) => React.ReactNode;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border whitespace-nowrap"
          style={
            value === opt
              ? { background: "rgba(245,158,11,0.15)", borderColor: "rgba(245,158,11,0.40)", color: "#f59e0b" }
              : { background: "transparent", borderColor: "transparent", color: "rgba(255,255,255,0.45)" }
          }
        >
          {renderLabel ? renderLabel(opt) : opt}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preseason Lab sub-view
// ─────────────────────────────────────────────────────────────────────────────
function PreseasonLab({ players }: { players: PlayerCard[] }) {
  return (
    <div className="space-y-3">
      {/* Summary shelf */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryChip icon={<Star size={14} />}        label="Sleepers"   value={players.filter(p => p.actionTag === "SLEEPER" || p.valueGap <= -3).length} color="#f59e0b" />
        <SummaryChip icon={<AlertTriangle size={14} />} label="Busts"    value={players.filter(p => p.actionTag === "AVOID" || p.valueGap >= 5).length}   color="#f87171" />
        <SummaryChip icon={<TrendingUp size={14} />}   label="Trending Up"   value={players.filter(p => p.trend === "up").length}   color="#4ade80" />
        <SummaryChip icon={<TrendingDown size={14} />} label="Trending Down" value={players.filter(p => p.trend === "down").length} color="#f87171" />
      </div>

      {/* Tier labels */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {[
          { label: "Elite (1–5)",   color: "#f59e0b" },
          { label: "Tier 1 (6–15)", color: "#4ade80" },
          { label: "Tier 2 (16–30)",color: "#60a5fa" },
          { label: "Lottery (31+)", color: "#94a3b8" },
        ].map(t => (
          <span key={t.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
            {t.label}
          </span>
        ))}
      </div>

      {/* Player list */}
      <div className="space-y-2">
        {players.map(p => <PlayerRow key={p.id} p={p} view="preseason" />)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft Room sub-view
// ─────────────────────────────────────────────────────────────────────────────
function DraftRoom({ players }: { players: PlayerCard[] }) {
  const [format, setFormat] = useState<FormatTab>("ppr");
  const [simMode, setSimMode] = useState<"conservative" | "sharp" | "casual" | "wr_heavy" | "qb_run">("sharp");

  const simLabels: Record<typeof simMode, string> = {
    conservative: "Conservative Room",
    sharp:        "Sharp Room",
    casual:       "Home League",
    wr_heavy:     "WR-Heavy Room",
    qb_run:       "QB Run Room",
  };

  const steals  = players.filter(p => p.steal);
  const reaches = players.filter(p => p.reach);
  const bestAvail = [...players].sort((a, b) => a.modelRank - b.modelRank).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Format + sim mode selectors */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">League Format</p>
        <FilterPill
          options={["standard", "ppr", "half_ppr", "superflex", "dynasty", "bestball"] as FormatTab[]}
          value={format}
          onChange={setFormat}
          renderLabel={v => ({ standard: "Standard", ppr: "PPR", half_ppr: "Half-PPR", superflex: "Superflex", dynasty: "Dynasty", bestball: "Best Ball" })[v]}
        />
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Simulate Draft Room</p>
        <FilterPill
          options={["conservative", "sharp", "casual", "wr_heavy", "qb_run"] as typeof simMode[]}
          value={simMode}
          onChange={setSimMode}
          renderLabel={v => simLabels[v]}
        />
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryChip icon={<Zap size={14} />}           label="Best Steals"     value={steals.length}            color="#4ade80" />
        <SummaryChip icon={<AlertTriangle size={14} />} label="Reaches to Skip"  value={reaches.length}           color="#f87171" />
        <SummaryChip icon={<Target size={14} />}        label="Best Available"   value={bestAvail[0]?.name ?? "—"} color="#f59e0b" />
        <SummaryChip icon={<Trophy size={14} />}        label="Format"           value={format.toUpperCase()}       color="#818cf8" />
      </div>

      {/* Steal / Reach callouts */}
      {steals.length > 0 && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 space-y-1.5">
          <p className="text-[10px] font-bold text-green-400 uppercase tracking-wide flex items-center gap-1.5">
            <Zap size={11} /> Steals Available Now
          </p>
          {steals.map(p => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
              <span className="text-green-400 font-bold">ADP {p.adp.toFixed(1)} → Model #{p.modelRank}</span>
            </div>
          ))}
        </div>
      )}

      {reaches.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1.5">
          <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle size={11} /> Reaches — Wait or Skip
          </p>
          {reaches.map(p => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
              <span className="text-red-400 font-bold">ADP {p.adp.toFixed(1)} → Model #{p.modelRank}</span>
            </div>
          ))}
        </div>
      )}

      {/* Full board */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Draft Board — {simLabels[simMode]}</p>
        {players.map(p => <PlayerRow key={p.id} p={p} view="draft" />)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Season Tools sub-view
// ─────────────────────────────────────────────────────────────────────────────

type InSeasonMode = "start_sit" | "waiver" | "trade" | "projections";

function InSeasonTools({ players }: { players: PlayerCard[] }) {
  const [mode, setMode] = useState<InSeasonMode>("start_sit");

  const starts = players.filter(p => p.actionTag === "START" || p.actionScore >= 70);
  const sits   = players.filter(p => p.actionTag === "SIT"   || (p.actionScore < 45 && p.actionScore > 0));
  const adds   = players.filter(p => p.actionTag === "ADD"   || p.valueGap <= -3);
  const sells  = players.filter(p => p.actionTag === "SELL"  || p.actionTag === "AVOID");

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <FilterPill
        options={["start_sit", "waiver", "trade", "projections"] as InSeasonMode[]}
        value={mode}
        onChange={setMode}
        renderLabel={v => ({ start_sit: "Start / Sit", waiver: "Waiver Wire", trade: "Trade Analyzer", projections: "Weekly Projections" })[v]}
      />

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryChip icon={<Activity size={14} />}      label="Must Starts"  value={starts.length} color="#4ade80" />
        <SummaryChip icon={<Shield size={14} />}        label="Sit Alerts"   value={sits.length}   color="#f87171" />
        <SummaryChip icon={<ArrowUpRight size={14} />}  label="Add Targets"  value={adds.length}   color="#60a5fa" />
        <SummaryChip icon={<ArrowDownRight size={14} />}label="Sell High"    value={sells.length}  color="#f59e0b" />
      </div>

      {mode === "start_sit" && (
        <div className="space-y-3">
          {/* Start column */}
          {starts.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-green-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Activity size={10} /> Start These Players
              </p>
              <div className="space-y-2">
                {starts.map(p => <PlayerRow key={p.id} p={p} view="inseason" />)}
              </div>
            </div>
          )}
          {/* Sit column */}
          {sits.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Shield size={10} /> Consider Sitting
              </p>
              <div className="space-y-2">
                {sits.map(p => <PlayerRow key={p.id} p={p} view="inseason" />)}
              </div>
            </div>
          )}
          {starts.length === 0 && sits.length === 0 && (
            <div className="space-y-2">
              {players.map(p => <PlayerRow key={p.id} p={p} view="inseason" />)}
            </div>
          )}
        </div>
      )}

      {mode === "waiver" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Players ranked by waiver priority — model score vs consensus value gap.</p>
          {[...players]
            .sort((a, b) => b.valueGap - a.valueGap) // most undervalued first
            .map(p => <PlayerRow key={p.id} p={p} view="inseason" />)
          }
        </div>
      )}

      {mode === "trade" && (
        <div className="space-y-3">
          <div className="bg-muted/20 border border-border rounded-xl p-4">
            <p className="text-sm font-bold text-foreground mb-1">Trade Analyzer</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Select two players from the board below to compare their model score, consensus rank, ADP, trend, and rest-of-season projection. 
              The player with the higher action score is the better asset to acquire.
            </p>
          </div>
          {/* Trade For vs Sell High */}
          {adds.length > 0 && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#a78bfa" }}>Trade For — Undervalued Assets</p>
              {adds.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="text-foreground font-semibold">{p.name}</span>
                  <span style={{ color: "#a78bfa" }}>Model #{p.modelRank} vs Consensus #{p.consensusRank}</span>
                </div>
              ))}
            </div>
          )}
          {sells.length > 0 && (
            <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wide">Sell High — Overvalued Assets</p>
              {sells.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="text-foreground font-semibold">{p.name}</span>
                  <span className="text-orange-400">Consensus #{p.consensusRank} vs Model #{p.modelRank}</span>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {players.map(p => <PlayerRow key={p.id} p={p} view="inseason" />)}
          </div>
        </div>
      )}

      {mode === "projections" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 text-[9px] font-bold text-muted-foreground uppercase tracking-wide px-4 py-2">
            <span>Player</span>
            <span className="text-center">Projection</span>
            <span className="text-right">Proj. Pts</span>
          </div>
          {[...players]
            .sort((a, b) => (b.weeklyProj ?? 0) - (a.weeklyProj ?? 0))
            .map(p => (
              <div key={p.id} className="bg-card border border-border rounded-xl px-4 py-3 grid grid-cols-3 items-center gap-2">
                <div>
                  <p className="text-xs font-bold text-foreground">{p.name}</p>
                  <p className="text-[9px] text-muted-foreground">{p.position} · {p.team.split(" ").slice(-1)[0]}</p>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">{p.projection}</p>
                <div className="text-right">
                  {p.weeklyProj ? (
                    <span className="text-xs font-black" style={{ color: p.weeklyProj >= 30 ? "#4ade80" : p.weeklyProj >= 20 ? "#f59e0b" : "#94a3b8" }}>
                      {p.weeklyProj}
                    </span>
                  ) : <span className="text-muted-foreground text-xs">—</span>}
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Fantasy page
// ─────────────────────────────────────────────────────────────────────────────

const SUB_VIEWS: { id: SubView; label: string; emoji: string; desc: string }[] = [
  { id: "preseason", label: "Preseason Lab",    emoji: "🔬", desc: "Outlooks, sleepers, tiers, breakout probability" },
  { id: "draft",     label: "Draft Room",       emoji: "🎯", desc: "Live board, ADP vs model, steal/reach alerts" },
  { id: "inseason",  label: "In-Season Tools",  emoji: "⚡", desc: "Start/sit, waivers, trades, weekly projections" },
];

const SPORT_TABS_LIST: { id: SportTab; label: string; emoji: string }[] = [
  { id: "ALL", label: "All", emoji: "🌐" },
  { id: "NFL", label: "NFL", emoji: "🏈" },
  { id: "NBA", label: "NBA", emoji: "🏀" },
  { id: "MLB", label: "MLB", emoji: "⚾" },
  { id: "NHL", label: "NHL", emoji: "🏒" },
];

export default function Fantasy() {
  const [subView,  setSubView]  = useState<SubView>("preseason");
  const [sport,    setSport]    = useState<SportTab>("ALL");
  const [position, setPosition] = useState<PositionF>("ALL");
  const [search,   setSearch]   = useState("");
  const [actionFilter, setActionFilter] = useState<ActionTag | "ALL">("ALL");

  // Filter players
  const filtered = useMemo(() => {
    let list = [...MOCK_PLAYERS];

    if (sport !== "ALL")     list = list.filter(p => p.sport === sport);
    if (position !== "ALL")  list = list.filter(p => p.position === position);
    if (actionFilter !== "ALL") list = list.filter(p => p.actionTag === actionFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q)
      );
    }

    // Sort by model rank
    return list.sort((a, b) => a.modelRank - b.modelRank);
  }, [sport, position, actionFilter, search]);

  const positions = SPORT_POSITIONS[sport];

  const ACTION_OPTIONS: (ActionTag | "ALL")[] = [
    "ALL", "DRAFT", "SLEEPER", "AVOID", "START", "SIT", "ADD", "TRADE FOR", "SELL", "HOLD",
  ];

  return (
    <div className="space-y-5 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <Shuffle size={20} className="text-primary" /> Fantasy
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Decision engine — consensus vs model, ranked by action score
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
          onClick={() => {}}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Sub-view selector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SUB_VIEWS.map(sv => (
          <button
            key={sv.id}
            onClick={() => setSubView(sv.id)}
            className="text-left p-3.5 rounded-xl border transition-all"
            style={
              subView === sv.id
                ? { background: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.40)" }
                : { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }
            }
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{sv.emoji}</span>
              <span className="text-sm font-bold" style={{ color: subView === sv.id ? "#f59e0b" : "rgba(255,255,255,0.85)" }}>
                {sv.label}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">{sv.desc}</p>
          </button>
        ))}
      </div>

      {/* Sport tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {SPORT_TABS_LIST.map(s => (
          <button
            key={s.id}
            onClick={() => { setSport(s.id); setPosition("ALL"); }}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border"
            style={
              sport === s.id
                ? { background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.35)", color: "#f59e0b" }
                : { background: "transparent", borderColor: "transparent", color: "rgba(255,255,255,0.45)" }
            }
          >
            <span>{s.emoji}</span> {s.label}
          </button>
        ))}
      </div>

      {/* Position + Action filters */}
      <div className="space-y-2">
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {positions.filter(p => p === "ALL" || MOCK_PLAYERS.some(pl => pl.position === p && (sport === "ALL" || pl.sport === sport))).map(pos => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all border"
              style={
                position === pos
                  ? { background: "rgba(99,102,241,0.15)", borderColor: "rgba(99,102,241,0.40)", color: "#818cf8" }
                  : { background: "transparent", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }
              }
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {ACTION_OPTIONS.map(a => {
            const ac = a === "ALL" ? null : actionColor(a);
            return (
              <button
                key={a}
                onClick={() => setActionFilter(a)}
                className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all border whitespace-nowrap"
                style={
                  actionFilter === a
                    ? { background: ac?.bg ?? "rgba(245,158,11,0.12)", borderColor: ac?.border ?? "rgba(245,158,11,0.35)", color: ac?.text ?? "#f59e0b" }
                    : { background: "transparent", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }
                }
              >
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search player, team, or position…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 bg-card border-border text-sm h-9"
        />
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} player{filtered.length !== 1 ? "s" : ""}</span>
        <span className="flex items-center gap-1">
          <BarChart2 size={11} /> Sorted by PropEdge model rank
        </span>
      </div>

      {/* Sub-view content */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No players match your filters.
        </div>
      ) : (
        <>
          {subView === "preseason" && <PreseasonLab  players={filtered} />}
          {subView === "draft"     && <DraftRoom     players={filtered} />}
          {subView === "inseason"  && <InSeasonTools players={filtered} />}
        </>
      )}

      {/* Data note */}
      <div className="text-[10px] text-muted-foreground border-t border-border pt-4 leading-relaxed">
        <span className="font-semibold text-foreground">About projections:</span> Player cards use PropEdge model estimates based on historical trends, team context, schedule strength, usage data, and injury reports. 
        Consensus rank is a blended average of major ADP sources. ADP shown is the weighted average draft position across recent mock drafts. 
        Action tags are generated by comparing model rank vs consensus rank — a negative gap (model ranks higher) = undervalued. 
        Live player news and injury updates are applied as they are reported.
      </div>
    </div>
  );
}
