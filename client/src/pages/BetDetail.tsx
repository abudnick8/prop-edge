import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Clock, User, TrendingUp, CheckCircle, XCircle,
  Shield, AlertTriangle, Zap, BarChart2, ExternalLink,
  Loader2, Target, Activity, ChevronRight, Info, BookOpen,
  DollarSign, Users, ArrowRight
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Tv2, MapPin, Wifi } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────
function formatOdds(odds: number | null): string {
  if (odds === null) return "—";
  return odds > 0 ? `+${odds}` : String(odds);
}

// Implied probability from American odds
function impliedProb(odds: number | null): number {
  if (odds === null) return 0;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀", NFL: "🏈", MLB: "⚾", NHL: "🏒",
};

const SPORT_ACCENT: Record<string, string> = {
  NBA: "#fb923c", NFL: "#f87171", MLB: "#60a5fa", NHL: "#22d3ee",
};

// Team primary colors — used to tint Player Analytics for the player's team
const TEAM_COLORS: Record<string, string> = {
  // NBA
  "Warriors": "#1D428A", "GSW": "#1D428A", "Golden State": "#1D428A",
  "Lakers": "#552583", "LAL": "#552583", "Los Angeles Lakers": "#552583",
  "Celtics": "#007A33", "BOS": "#007A33", "Boston": "#007A33",
  "Heat": "#98002E", "MIA": "#98002E", "Miami": "#98002E",
  "Bucks": "#00471B", "MIL": "#00471B", "Milwaukee": "#00471B",
  "Nuggets": "#0E2240", "DEN": "#0E2240", "Denver": "#0E2240",
  "Suns": "#1D1160", "PHX": "#1D1160", "Phoenix": "#1D1160",
  "Clippers": "#C8102E", "LAC": "#C8102E",
  "76ers": "#006BB6", "PHI": "#006BB6", "Philadelphia": "#006BB6",
  "Bulls": "#CE1141", "CHI": "#CE1141", "Chicago": "#CE1141",
  "Knicks": "#F58426", "NYK": "#F58426", "New York Knicks": "#F58426",
  "Mavericks": "#00538C", "DAL": "#00538C", "Dallas": "#00538C",
  "Thunder": "#007AC1", "OKC": "#007AC1", "Oklahoma City": "#007AC1",
  "Pacers": "#002D62", "IND": "#002D62", "Indiana": "#002D62",
  "Timberwolves": "#236192", "MIN": "#236192", "Minnesota": "#236192",
  "Cavaliers": "#860038", "CLE": "#860038", "Cleveland": "#860038",
  "Grizzlies": "#5D76A9", "MEM": "#5D76A9", "Memphis": "#5D76A9",
  "Pelicans": "#0C2340", "NOP": "#0C2340", "New Orleans": "#0C2340",
  "Kings": "#5A2D81", "SAC": "#5A2D81", "Sacramento": "#5A2D81",
  "Raptors": "#CE1141", "TOR": "#CE1141", "Toronto": "#CE1141",
  "Nets": "#000000", "BKN": "#000000", "Brooklyn": "#000000",
  "Magic": "#0077C0", "ORL": "#0077C0", "Orlando": "#0077C0",
  "Wizards": "#002B5C", "WAS": "#002B5C", "Washington": "#002B5C",
  "Hawks": "#E03A3E", "ATL": "#E03A3E", "Atlanta": "#E03A3E",
  "Hornets": "#1D1160", "CHA": "#1D1160", "Charlotte": "#1D1160",
  "Pistons": "#C8102E", "DET": "#C8102E", "Detroit": "#C8102E",
  "Spurs": "#C4CED4", "SAS": "#C4CED4", "San Antonio": "#C4CED4",
  "Rockets": "#CE1141", "HOU": "#CE1141", "Houston": "#CE1141",
  "Jazz": "#002B5C", "UTA": "#002B5C", "Utah": "#002B5C",
  "Trail Blazers": "#E03A3E", "POR": "#E03A3E", "Portland": "#E03A3E",
  // NFL
  "Chiefs": "#E31837", "KC": "#E31837", "Kansas City Chiefs": "#E31837",
  "Eagles": "#004C54", "PHI Eagles": "#004C54",
  "49ers": "#AA0000", "SF": "#AA0000", "San Francisco": "#AA0000",
  "Cowboys": "#003594", "DAL Cowboys": "#003594",
  "Bills": "#00338D", "BUF": "#00338D", "Buffalo": "#00338D",
  "Ravens": "#241773", "BAL": "#241773", "Baltimore": "#241773",
  "Bengals": "#FB4F14", "CIN": "#FB4F14", "Cincinnati": "#FB4F14",
  "Steelers": "#FFB612", "PIT": "#FFB612", "Pittsburgh": "#FFB612",
  "Packers": "#203731", "GB": "#203731", "Green Bay": "#203731",
  "Bears": "#0B162A", "CHI Bears": "#0B162A",
  "Patriots": "#002244", "NE": "#002244", "New England": "#002244",
  "Dolphins": "#008E97", "MIA Dolphins": "#008E97",
  // MLB
  "Yankees": "#003087", "NYY": "#003087", "New York Yankees": "#003087",
  "Red Sox": "#BD3039", "BOS Red Sox": "#BD3039",
  "Dodgers": "#005A9C", "LAD": "#005A9C", "Los Angeles Dodgers": "#005A9C",
  "Cubs": "#0E3386", "CHC": "#0E3386",
  "Cardinals": "#C41E3A", "STL": "#C41E3A", "St. Louis": "#C41E3A",
  "Astros": "#002D62", "HOU Astros": "#002D62",
  "Braves": "#CE1141", "ATL Braves": "#CE1141",
  "Giants": "#FD5A1E", "SFG": "#FD5A1E", "San Francisco Giants": "#FD5A1E",
  "Mets": "#002D72", "NYM": "#002D72", "New York Mets": "#002D72",
  "Phillies": "#E81828", "PHI Phillies": "#E81828",
  // NHL
  "Bruins": "#FFB81C", "BOS Bruins": "#FFB81C",
  "Maple Leafs": "#00205B", "TOR Maple Leafs": "#00205B",
  "Rangers": "#0038A8", "NYR": "#0038A8", "New York Rangers": "#0038A8",
  "Penguins": "#FCB514", "PIT Penguins": "#FCB514",
  "Blackhawks": "#CF0A2C", "CHI Blackhawks": "#CF0A2C",
  "Lightning": "#002868", "TB": "#002868", "Tampa Bay": "#002868",
  "Avalanche": "#6F263D", "COL": "#6F263D", "Colorado": "#6F263D",
  "Oilers": "#FF4C00", "EDM": "#FF4C00", "Edmonton": "#FF4C00",
  "Canadiens": "#AF1E2D", "MTL": "#AF1E2D", "Montreal": "#AF1E2D",
  "Canucks": "#00843D", "VAN": "#00843D", "Vancouver": "#00843D",
};

function getTeamColor(teamName?: string | null): string | null {
  if (!teamName) return null;
  // Try exact match first, then partial
  if (TEAM_COLORS[teamName]) return TEAM_COLORS[teamName];
  const lower = teamName.toLowerCase();
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower.split(" ").pop()!)) {
      return color;
    }
  }
  return null;
}

// ── Badge Components ───────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border source-${source} uppercase tracking-wide`}>
      {source === "draftkings" ? "🎲 DK" : source === "fanduel" ? "🦅 FD" : source === "betmgm" ? "🦁 MGM" : source === "williamhill" ? "⚖️ WH" : source === "actionnetwork" ? "🔍 AN" : source}
    </span>
  );
}

function SportBadge({ sport }: { sport: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border sport-${sport.toLowerCase()} uppercase tracking-wide`}>
      {SPORT_EMOJI[sport.toUpperCase()] ?? "🏅"} {sport}
    </span>
  );
}

// ── Large Confidence Ring ──────────────────────────────────────────────────
function ConfidenceRingLarge({ score }: { score: number }) {
  const size = 100;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  const label = score >= 85 ? "Strong" : score >= 70 ? "Moderate" : "Risky";
  return (
    <div className="relative flex-shrink-0 flex flex-col items-center gap-1" style={{ width: size, height: size + 20 }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(19,35,58,0.08)" strokeWidth="5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={circ} strokeDashoffset={circ - fill} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ filter: `drop-shadow(0 0 8px ${color}88)`, transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black font-mono leading-none" style={{ color }}>{score}</span>
          <span className="text-[10px] font-bold" style={{ color: "rgba(19,35,58,0.56)" }}>/100</span>
        </div>
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Metric Tile ───────────────────────────────────────────────────────────
function Tile({ label, value, sub, color, accent = false }: { label: string; value: string; sub?: string; color?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl p-3.5 flex flex-col gap-1" style={{
      background: accent ? "rgba(245,158,11,0.08)" : "rgba(19,35,58,0.06)",
      border: `1px solid ${accent ? "rgba(245,158,11,0.25)" : "rgba(19,35,58,0.11)"}`,
    }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(19,35,58,0.56)" }}>{label}</p>
      <p className="text-lg font-black font-mono leading-none" style={{ color: color ?? "hsl(45 100% 90%)" }}>{value}</p>
      {sub && <p className="text-[10px]" style={{ color: "rgba(19,35,58,0.49)" }}>{sub}</p>}
    </div>
  );
}

// ── Odds Bar (Over vs Under visual) ───────────────────────────────────────
function OddsBar({ overOdds, underOdds, pickSide }: { overOdds: number | null; underOdds: number | null; pickSide?: string }) {
  if (overOdds === null && underOdds === null) return null;
  const overProb = impliedProb(overOdds) * 100;
  const underProb = impliedProb(underOdds) * 100;
  const total = overProb + underProb;
  const overPct = total > 0 ? (overProb / total) * 100 : 50;
  const isPickOver = pickSide?.toUpperCase() === "OVER";
  const isPickUnder = pickSide?.toUpperCase() === "UNDER";

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Market Odds Split</span>
        {pickSide && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: isPickOver ? "rgba(74,222,128,0.15)" : "rgba(96,165,250,0.15)", color: isPickOver ? "#4ade80" : "#60a5fa", border: `1px solid ${isPickOver ? "rgba(74,222,128,0.3)" : "rgba(96,165,250,0.3)"}` }}>
            ✓ Pick: {pickSide.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Over side */}
        <div className="flex-1 text-center">
          <div className="text-sm font-black font-mono" style={{ color: isPickOver ? "#4ade80" : "hsl(45 100% 90%)" }}>
            {formatOdds(overOdds)}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(19,35,58,0.56)" }}>OVER · {overProb.toFixed(0)}%</div>
        </div>
        {/* Bar */}
        <div className="flex-[2] h-4 rounded-full overflow-hidden flex" style={{ background: "rgba(19,35,58,0.08)" }}>
          <div className="h-full rounded-l-full transition-all duration-700"
            style={{ width: `${overPct}%`, background: isPickOver ? "linear-gradient(90deg,#4ade80,#22c55e)" : "rgba(19,35,58,0.28)" }} />
          <div className="h-full rounded-r-full transition-all duration-700"
            style={{ width: `${100 - overPct}%`, background: isPickUnder ? "linear-gradient(90deg,#60a5fa,#3b82f6)" : "rgba(19,35,58,0.14)" }} />
        </div>
        {/* Under side */}
        <div className="flex-1 text-center">
          <div className="text-sm font-black font-mono" style={{ color: isPickUnder ? "#60a5fa" : "hsl(45 100% 90%)" }}>
            {formatOdds(underOdds)}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(19,35,58,0.56)" }}>UNDER · {underProb.toFixed(0)}%</div>
        </div>
      </div>
      <p className="text-[10px] text-center" style={{ color: "rgba(19,35,58,0.42)" }}>
        Implied probability from market pricing
      </p>
    </div>
  );
}

// ── Confidence Score Breakdown ────────────────────────────────────────────
const SCORE_DESCRIPTIONS: Record<string, { max: number; color: string; what: string; high: string; low: string }> = {
  "Market Edge": {
    max: 30, color: "#22d3ee",
    what: "How much the betting market price favors this outcome. Derived from implied probability — the higher the edge, the more the market believes this will hit.",
    high: "Market strongly prices this outcome as likely. The implied probability is high and the line has been set in your favor.",
    low: "Market is uncertain or slightly against this outcome. The line may be tighter or pricing has moved unfavorably.",
  },
  "Analytics": {
    max: 25, color: "#a78bfa",
    what: "Depth of statistical factors supporting this pick. Each key factor (recent form, pace, matchup, injury report, etc.) contributes points up to the 25-point max.",
    high: "Multiple strong statistical signals align with this pick — recent performance, matchup data, and situational factors all point the same direction.",
    low: "Fewer supporting statistics found. The pick may still be valid but with less statistical backing.",
  },
  "Base Model": {
    max: 30, color: "#f59e0b",
    what: "Clubhouse IQ's core probability model score. Based on historical hit rates for this bet type, sport, and line relative to the player's average output.",
    high: "The base model strongly favors this line — historically, similar setups have hit at a high rate for this player and bet type.",
    low: "The base model is neutral or cautious. Consider this a softer edge — the historical pattern is less decisive.",
  },
  "Source Quality": {
    max: 15, color: "#4ade80",
    what: "Reliability bonus from the data source(s) backing this pick. Kalshi (prediction markets) and multi-source agreement earn the most points; single-source picks earn less.",
    high: "This bet is backed by multiple independent sources (e.g. Kalshi + Underdog + DraftKings all agreeing) — strong signal convergence.",
    low: "Based on a single source. The pick may still be excellent, but there is less cross-market validation.",
  },
};

function ConfidenceBreakdown({ score, keyFactors, riskLevel, impliedProbability }: {
  score: number; keyFactors: string[] | null; riskLevel: string | null; impliedProbability: number | null;
}) {
  const [expandedBar, setExpandedBar] = useState<string | null>(null);

  // Proportional allocation: weights → raw alloc → scale to sum exactly to `score` → cap at maxPoints
  const keyFactorsLen = keyFactors?.length ?? 0;
  const marketWeight   = impliedProbability ?? 0.5;
  const analyticsWeight = Math.min(1, keyFactorsLen / 5) || 0.4;
  const riskMult       = riskLevel === "low" ? 1.0 : riskLevel === "medium" ? 0.75 : 0.5;
  const baseWeight     = 0.6 * riskMult;
  const sourceWeight   = keyFactorsLen >= 3 ? 0.8 : 0.4;
  const maxPoints      = [30, 25, 30, 15];
  const weights        = [marketWeight, analyticsWeight, baseWeight, sourceWeight];
  const rawAlloc       = weights.map((w, i) => w * maxPoints[i]);
  const rawTotal       = rawAlloc.reduce((a, b) => a + b, 0);
  let scaled = rawAlloc.map((r, i) => Math.min(maxPoints[i], Math.round((r / rawTotal) * score)));
  // Fix rounding drift so total === score exactly
  const diff = score - scaled.reduce((a, b) => a + b, 0);
  const adjustIdx = scaled.findIndex((v, i) => diff > 0 ? v < maxPoints[i] : v > 0);
  if (adjustIdx >= 0) scaled[adjustIdx] = Math.max(0, Math.min(maxPoints[adjustIdx], scaled[adjustIdx] + diff));

  const bars = [
    { label: "Market Edge",    value: scaled[0], max: 30, color: "#22d3ee" },
    { label: "Analytics",      value: scaled[1], max: 25, color: "#a78bfa" },
    { label: "Base Model",     value: scaled[2], max: 30, color: "#f59e0b" },
    { label: "Source Quality", value: scaled[3], max: 15, color: "#4ade80" },
  ];

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Activity size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Score Breakdown</span>
        <span className="ml-auto text-xs font-black font-mono" style={{ color: "#f59e0b" }}>{score}/100</span>
      </div>

      {/* Bars */}
      <div className="space-y-2.5">
        {bars.map((bar) => {
          const desc = SCORE_DESCRIPTIONS[bar.label];
          const isOpen = expandedBar === bar.label;
          const pct = (bar.value / bar.max) * 100;
          const grade = pct >= 85 ? "Excellent" : pct >= 65 ? "Good" : pct >= 45 ? "Fair" : "Low";
          const gradeColor = pct >= 85 ? "#4ade80" : pct >= 65 ? "#f59e0b" : pct >= 45 ? "#fb923c" : "rgba(19,35,58,0.49)";

          return (
            <div key={bar.label}>
              {/* Row */}
              <button
                className="w-full text-left"
                onClick={() => setExpandedBar(isOpen ? null : bar.label)}
                data-testid={`score-bar-${bar.label.toLowerCase().replace(/ /g, "-")}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold" style={{ color: "rgba(19,35,58,0.7)" }}>{bar.label}</span>
                    <Info size={9} style={{ color: "rgba(19,35,58,0.35)" }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-semibold" style={{ color: gradeColor }}>{grade}</span>
                    <span className="text-[10px] font-mono font-bold" style={{ color: bar.color }}>{bar.value}/{bar.max}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: bar.color, boxShadow: `0 0 6px ${bar.color}66` }}
                  />
                </div>
              </button>

              {/* Expanded explanation */}
              {isOpen && desc && (
                <div className="mt-2 p-3 rounded-lg space-y-2" style={{ background: "rgba(19,35,58,0.06)", border: `1px solid ${bar.color}30` }}>
                  <div className="flex items-start gap-2">
                    <BookOpen size={10} className="flex-shrink-0 mt-0.5" style={{ color: bar.color }} />
                    <div className="space-y-1.5">
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(19,35,58,0.7)" }}>
                        <span className="font-bold" style={{ color: bar.color }}>What it measures: </span>
                        {desc.what}
                      </p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(19,35,58,0.7)" }}>
                        <span className="font-semibold" style={{ color: "#4ade80" }}>High score: </span>
                        {desc.high}
                      </p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(19,35,58,0.7)" }}>
                        <span className="font-semibold" style={{ color: "#fb923c" }}>Low score: </span>
                        {desc.low}
                      </p>
                      <p className="text-[10px] font-mono" style={{ color: "rgba(19,35,58,0.42)" }}>
                        Max: {bar.max} pts &nbsp;·&nbsp; This bet: {bar.value} pts ({Math.round(pct)}%)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <p className="text-[9px]" style={{ color: "rgba(19,35,58,0.28)" }}>
        Tap any category to learn what it means &nbsp;·&nbsp; Total max: 100 pts
      </p>
    </div>
  );
}


// ── Key Factors Panel ─────────────────────────────────────────────────────
function KeyFactorsPanel({ factors }: { factors: string[] }) {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
      <div className="flex items-center gap-2">
        <Target size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Key Factors ({factors.length})</span>
      </div>
      <div className="space-y-2">
        {factors.map((factor, i) => {
          const isPositive = !factor.toLowerCase().includes("risk") && !factor.toLowerCase().includes("concern") && !factor.toLowerCase().includes("low");
          const isCaution = factor.toLowerCase().includes("moderate") || factor.toLowerCase().includes("watch") || factor.toLowerCase().includes("volatile");
          return (
            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg"
              style={{ background: isPositive && !isCaution ? "rgba(74,222,128,0.05)" : isCaution ? "rgba(251,191,36,0.05)" : "rgba(19,35,58,0.04)", border: `1px solid ${isPositive && !isCaution ? "rgba(74,222,128,0.15)" : isCaution ? "rgba(251,191,36,0.15)" : "rgba(19,35,58,0.08)"}` }}>
              <span className="flex-shrink-0 mt-0.5">
                {isPositive && !isCaution ? <CheckCircle size={12} color="#4ade80" /> : isCaution ? <AlertTriangle size={12} color="#fbbf24" /> : <Info size={12} color="rgba(19,35,58,0.49)" />}
              </span>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(19,35,58,0.7)" }}>{factor}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mini Bar (for game log) ────────────────────────────────────────────────
function MiniBarChart({ games, statKey, propLine, label, pickSide, sportColor = "#f59e0b" }: { games: any[]; statKey: string; propLine?: number | null; label: string; pickSide?: string; sportColor?: string }) {
  if (!games.length) return null;
  const isUnder = pickSide?.toUpperCase() === "UNDER";
  const values = games.map((g) => parseFloat(g[statKey]) || 0);
  const max = Math.max(...values, propLine ?? 0, 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(19,35,58,0.56)" }}>{label} — Last {games.length} Games</span>
        {propLine != null && <span className="text-[10px] font-mono font-bold" style={{ color: sportColor }}>Line: {propLine}</span>}
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 56 }}>
        {values.map((v, i) => {
          const pct = (v / max) * 100;
          const hitLine = propLine != null && (isUnder ? v < propLine : v >= propLine);
          const missLine = propLine != null && !hitLine;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
              <span className="text-[9px] font-mono font-bold leading-none"
                style={{ color: hitLine ? "#4ade80" : missLine ? "#f87171" : sportColor }}>
                {v.toFixed(1) || "—"}
              </span>
              <div className="w-full rounded-t-sm transition-all duration-500"
                style={{
                  height: `${Math.max(pct, 4)}%`,
                  background: hitLine
                    ? "linear-gradient(0deg,#4ade80,#22c55e)"
                    : missLine
                      ? "linear-gradient(0deg,#f87171,#ef4444)"
                      : `linear-gradient(0deg,${sportColor},${sportColor}cc)`,
                  opacity: 0.9,
                  minHeight: 4,
                }} />
            </div>
          );
        })}
      </div>
      {/* Game labels */}
      <div className="flex items-center gap-1.5">
        {games.map((g, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[8px]" style={{ color: "rgba(19,35,58,0.35)" }}>
              {g.opp_id || g.opp || `G${i + 1}`}
            </span>
          </div>
        ))}
      </div>
      {propLine != null && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 rounded" style={{ background: sportColor }} />
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.49)" }}>Line ({propLine})</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: "rgba(74,222,128,0.5)" }} />
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.49)" }}>Hit</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: "rgba(248,113,113,0.5)" }} />
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.49)" }}>Miss</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game Log Table — last N games with all stats, bet stat highlighted ──────
function GameLogTable({ games, sport, focusStatKey, focusStatLabel, propLine, comboKeys, pickSide, sportColor = "#f59e0b" }: {
  games: any[];
  sport: string;
  focusStatKey: string;
  focusStatLabel: string;
  propLine?: number | null;
  comboKeys?: string[];
  pickSide?: string;
  sportColor?: string;
}) {
  const isUnder = pickSide?.toUpperCase() === "UNDER";
  if (!games.length) return null;

  const isCombo = focusStatKey === "_combo" && !!comboKeys?.length;
  const comboColLabel = focusStatLabel;

  // Define columns per sport — focus stat always shown prominently
  const nbaCols = [
    { key: "date_game", label: "Date" },
    { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "pts", label: "PTS" },
    { key: "trb", label: "REB" },
    { key: "ast", label: "AST" },
    { key: "stl", label: "STL" },
    { key: "blk", label: "BLK" },
    { key: "tov", label: "TOV" },
    { key: "mp", label: "MIN" },
  ];

  const nflCols = [
    { key: "date_game", label: "Date" },
    { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "yds", label: "YDS" },
    { key: "td", label: "TD" },
    { key: "int", label: "INT" },
    { key: "att", label: "ATT" },
    { key: "rec", label: "REC" },
    { key: "car", label: "CAR" },
  ];

  const nhlCols = [
    { key: "date_game", label: "Date" },
    { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "goals", label: "G" },
    { key: "ast", label: "A" },
    { key: "pts", label: "PTS" },
    { key: "shots", label: "SOG" },
    { key: "plusMinus", label: "+/-" },
    { key: "toi", label: "TOI" },
  ];

  const mlbCols = [
    { key: "date_game", label: "Date" },
    { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "ab", label: "AB" },
    { key: "hits", label: "H" },
    { key: "home_runs", label: "HR" },
    { key: "rbi", label: "RBI" },
    { key: "runs", label: "R" },
    { key: "avg", label: "AVG" },
  ];

  const sportUp = sport?.toUpperCase();
  const cols = sportUp === "NFL" ? nflCols : sportUp === "NHL" ? nhlCols : sportUp === "MLB" ? mlbCols : nbaCols;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(19,35,58,0.56)" }}>
          Game Log — Last {games.length} Games
        </span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: `${sportColor}18`, color: sportColor, border: `1px solid ${sportColor}40` }}>
          ★ {focusStatLabel}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid rgba(19,35,58,0.11)" }}>
        <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(19,35,58,0.07)", borderBottom: "1px solid rgba(19,35,58,0.11)" }}>
              {cols.map(col => {
                const isFocus = col.key === focusStatKey ||
                  (focusStatKey === "trb" && col.key === "trb") ||
                  (focusStatKey === "reb" && col.key === "trb") ||
                  (isCombo && comboKeys?.includes(col.key)) ||
                  (isCombo && col.key === "trb" && comboKeys?.includes("trb"));
                return (
                  <th key={col.key} className="px-2 py-2 text-center font-bold uppercase tracking-wide"
                    style={{
                      color: isFocus ? sportColor : "rgba(19,35,58,0.49)",
                      background: isFocus ? `${sportColor}10` : "transparent",
                      whiteSpace: "nowrap",
                      fontSize: "9px",
                      letterSpacing: "0.08em",
                    }}>
                    {isFocus ? `★ ${col.label}` : col.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {games.map((g, rowIdx) => {
              const focusVal = focusStatKey === "_combo"
                ? (parseFloat(g["_combo"]) || 0)
                : (parseFloat(g[focusStatKey] ?? g["trb"] ?? "0") || 0);
              const hitLine = propLine != null && (isUnder ? focusVal < propLine : focusVal >= propLine);
              const rowBg = hitLine ? "rgba(74,222,128,0.04)" : rowIdx % 2 === 0 ? "rgba(19,35,58,0.03)" : "transparent";
              return (
                <tr key={rowIdx} style={{ background: rowBg, borderBottom: "1px solid rgba(19,35,58,0.06)" }}>
                  {cols.map(col => {
                    const isFocus = col.key === focusStatKey ||
                      (focusStatKey === "trb" && col.key === "trb") ||
                      (focusStatKey === "reb" && col.key === "trb") ||
                      (isCombo && comboKeys?.includes(col.key)) ||
                      (isCombo && col.key === "trb" && comboKeys?.includes("trb"));
                    const rawRaw = g[col.key];
                    const rawVal: string = rawRaw != null ? String(rawRaw) : "—";
                    const numVal = parseFloat(rawVal) || 0;
                    const cellHit = isFocus && propLine != null && (isUnder ? numVal < propLine : numVal >= propLine);
                    const cellMiss = isFocus && propLine != null && (isUnder ? numVal >= propLine : numVal < propLine) && rawVal !== "—" && rawVal !== "";
                    // Format date
                    let displayVal: string | JSX.Element = rawVal || "—";
                    if (col.key === "date_game" && rawVal && rawVal.length >= 7) {
                      const parts = rawVal.split("-");
                      displayVal = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : rawVal;
                    }
                    // OPP column: show eventNote badge below the opponent abbreviation
                    if ((col.key === "opp_id" || col.key === "opp") && g.eventNote) {
                      displayVal = (
                        <span className="flex flex-col items-center gap-0.5">
                          <span>{rawVal}</span>
                          <span style={{ fontSize: "8px", color: "#a78bfa", fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap", maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis" }}
                            title={g.eventNote}>
                            {g.eventNote}
                          </span>
                        </span>
                      );
                    }
                    // Result column: color-code W/L
                    if (col.key === "result") {
                      const isWin = rawVal?.startsWith("W");
                      const isLoss = rawVal?.startsWith("L");
                      displayVal = (
                        <span style={{ color: isWin ? "#4ade80" : isLoss ? "#f87171" : "rgba(19,35,58,0.63)", fontWeight: isWin || isLoss ? 700 : 400, fontSize: "10px" }}>
                          {rawVal || "—"}
                        </span>
                      );
                    }
                    return (
                      <td key={col.key} className="px-2 py-2 text-center font-mono"
                        style={{
                          background: isFocus ? (cellHit ? "rgba(74,222,128,0.1)" : cellMiss ? "rgba(248,113,113,0.08)" : `${sportColor}0a`) : "transparent",
                          color: isFocus
                            ? (cellHit ? "#4ade80" : cellMiss ? "#f87171" : sportColor)
                            : col.key === "date_game" || col.key === "opp_id" || col.key === "opp"
                              ? "rgba(19,35,58,0.56)"
                              : col.key === "result" ? "transparent" : "rgba(19,35,58,0.7)",
                          fontWeight: isFocus ? "900" : "500",
                          fontSize: isFocus ? "12px" : "11px",
                          whiteSpace: "nowrap",
                        }}>
                        {isFocus && cellHit && "✓ "}
                        {isFocus && cellMiss && "✗ "}
                        {displayVal}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      {propLine != null && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(74,222,128,0.3)" }} />
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.49)" }}>Hit ≥ {propLine}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(248,113,113,0.3)" }} />
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.49)" }}>Miss &lt; {propLine}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: `${sportColor}50` }} />
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.49)" }}>Focus stat</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Season Stat vs Line Bar ────────────────────────────────────────────────
function StatVsLine({ statLabel, statValue, propLine, pickSide, sportColor = "#f59e0b" }: { statLabel: string; statValue: number; propLine: number; pickSide?: string; sportColor?: string }) {
  const isUnder = pickSide?.toUpperCase() === "UNDER";
  const pct = Math.min((statValue / propLine) * 100, 150);
  const hitLine = isUnder ? statValue < propLine : statValue >= propLine;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span style={{ color: "rgba(19,35,58,0.7)" }}>{statLabel} avg</span>
        <span className="font-mono font-bold" style={{ color: hitLine ? "#4ade80" : "#f87171" }}>{statValue} vs {propLine} line</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: hitLine ? "linear-gradient(90deg,#4ade80,#22c55e)" : `linear-gradient(90deg,${sportColor},${sportColor}99)` }} />
        {/* Line marker */}
        <div className="absolute top-0 bottom-0 w-0.5" style={{ left: "66.7%", background: "rgba(19,35,58,0.7)" }} />
      </div>
      <p className="text-[9px] text-right" style={{ color: hitLine ? "#4ade80" : "#f87171" }}>
        {isUnder
          ? (hitLine ? `✓ Avg is ${(propLine - statValue).toFixed(1)} below line` : `${(statValue - propLine).toFixed(1)} above line — over lean`)
          : (hitLine ? `✓ Avg is ${(statValue - propLine).toFixed(1)} above line` : `${(propLine - statValue).toFixed(1)} below line — under lean`)}
      </p>
    </div>
  );
}



// ── Line Movement Panel ────────────────────────────────────────────────────
interface LMSpread  { open: number|null; current: number|null; move: number|null; awayPublic?: number|null; awayMoney?: number|null; homePublic?: number|null; homeMoney?: number|null; }
interface LMTotal   { open: number|null; current: number|null; move: number|null; overPublic?: number|null; overMoney?: number|null; underPublic?: number|null; underMoney?: number|null; }
interface LMML      { awayOpen: number|null; awayCurrent: number|null; homeOpen: number|null; homeCurrent: number|null; awayPublic?: number|null; awayMoney?: number|null; homePublic?: number|null; homeMoney?: number|null; }
interface LMGame    { id: string; sport: string; awayTeam: string; homeTeam: string; gameTime: string|null; status: string; numBets: number|null; spread: LMSpread; total: LMTotal; moneyline: LMML; }

function fmtLMLine(v: number | null): string {
  if (v == null) return "—";
  if (v > 0) return `+${v}`;
  return String(v);
}

function moveBadgeLM(move: number | null): { label: string; color: string; bg: string } | null {
  if (move == null || move === 0) return null;
  const abs = Math.abs(move);
  if (abs >= 3) return { label: `🔥 ${move > 0 ? "+" : ""}${move} STEAM`, color: "#f87171", bg: "rgba(248,113,113,0.12)" };
  if (abs >= 1.5) return { label: `${move > 0 ? "+" : ""}${move} move`, color: "#fb923c", bg: "rgba(251,146,60,0.12)" };
  if (abs >= 0.5) return { label: `${move > 0 ? "+" : ""}${move}`, color: "#fbbf24", bg: "rgba(251,191,36,0.10)" };
  return null;
}

function sharpSignalLM(moneyPct: number|null|undefined, publicPct: number|null|undefined): { label: string; color: string } | null {
  if (moneyPct == null || publicPct == null) return null;
  const div = moneyPct - publicPct;
  if (moneyPct >= 65 && div >= 20) return { label: `Sharp ↑ ${moneyPct}%$`, color: "#4ade80" };
  if (moneyPct >= 55 && div >= 15) return { label: `Lean ↑ ${moneyPct}%$`, color: "#86efac" };
  if (moneyPct <= 35 && div <= -20) return { label: `Fade ↓ ${moneyPct}%$`, color: "#f87171" };
  return null;
}

function MoveRow({ label, open, current, move }: { label: string; open: number|null; current: number|null; move: number|null }) {
  if (open == null && current == null) return null;
  const badge = moveBadgeLM(move);
  const moved = move != null && move !== 0;
  const deltaColor = !moved ? "rgba(19,35,58,0.3)" : (move! > 0 ? "#4ade80" : "#f87171");
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-16 text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: "rgba(19,35,58,0.45)" }}>{label}</span>
      {/* Open line */}
      <div className="flex flex-col items-center">
        <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.35)" }}>OPEN</span>
        <span className="font-mono text-[13px] font-semibold" style={{ color: "rgba(19,35,58,0.45)" }}>{fmtLMLine(open)}</span>
      </div>
      <ArrowRight size={10} className="flex-shrink-0" style={{ color: "rgba(19,35,58,0.25)" }} />
      {/* Current line — hero number */}
      <div className="flex flex-col items-center">
        <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.35)" }}>NOW</span>
        <span className="font-mono text-[16px] font-black" style={{ color: moved ? "#131A24" : "rgba(19,35,58,0.45)" }}>{fmtLMLine(current)}</span>
      </div>
      {/* Delta */}
      {moved && move != null && (
        <span className="text-[12px] font-black ml-1" style={{ color: deltaColor }}>
          {move > 0 ? `▲ +${move}` : `▼ ${move}`}
        </span>
      )}
      {badge && !moved && (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold ml-1"
          style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
      )}
      {badge && moved && (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold ml-auto"
          style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
      )}
    </div>
  );
}

function PublicRowLM({ label, publicPct, moneyPct, accentColor }: { label: string; publicPct?: number|null; moneyPct?: number|null; accentColor: string }) {
  if (publicPct == null && moneyPct == null) return null;
  const signal = sharpSignalLM(moneyPct, publicPct);
  return (
    <div className="rounded-lg px-3 py-2 space-y-1.5" style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.06)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold" style={{ color: "#131A24" }}>{label}</span>
        {signal && <span className="text-[10px] font-bold" style={{ color: signal.color }}>{signal.label}</span>}
      </div>
      {publicPct != null && (
        <div className="flex items-center gap-1.5">
          <Users size={9} style={{ color: "rgba(19,35,58,0.4)", flexShrink: 0 }} />
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: `${publicPct}%`, background: "rgba(99,102,241,0.55)" }} />
          </div>
          <span className="text-[11px] font-black w-8 text-right" style={{ color: "rgba(19,35,58,0.7)" }}>{publicPct}%</span>
        </div>
      )}
      {moneyPct != null && (
        <div className="flex items-center gap-1.5">
          <DollarSign size={9} style={{ color: "rgba(19,35,58,0.4)", flexShrink: 0 }} />
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: `${moneyPct}%`, background: moneyPct >= 60 ? "#4ade80cc" : moneyPct <= 40 ? "#f87171cc" : `${accentColor}88` }} />
          </div>
          <span className="text-[11px] font-black w-8 text-right" style={{ color: moneyPct >= 60 ? "#4ade80" : moneyPct <= 40 ? "#f87171" : "rgba(19,35,58,0.7)" }}>{moneyPct}%</span>
        </div>
      )}
    </div>
  );
}

function LineMovementPanel({ bet }: { bet: Bet }) {
  const [open, setOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const sport = (bet.sport ?? "").toUpperCase();
  const validSports = ["NBA", "NFL", "MLB", "NHL"];
  if (!validSports.includes(sport) || (!bet.homeTeam && !bet.awayTeam)) return null;

  const sportColor  = SPORT_ACCENT[sport] ?? "#f59e0b";
  const teamColor   = getTeamColor(bet.homeTeam) ?? getTeamColor(bet.awayTeam) ?? null;
  const accentColor = teamColor ?? sportColor;

  // ── CIQ grade engine data (from teamStats) ──
  const ts          = bet.teamStats as Record<string, any> | null;
  const ciqVars     = ts?.edgeVariables as Record<string, any> | undefined;
  const ciqLMVar    = ciqVars?.line_movement;          // { score, note, available }
  const ciqChains   = (ts?.edgeChains ?? []) as string[];
  const ciqGrade    = ts?.edgeGrade as string | undefined;
  const ciqScore    = ts?.edgeScore as number | undefined;

  // Sharp-relevant chains
  const sharpChains  = ["SHARPS_LOVE", "THE_MISPRICING", "FATIGUE_FADE"];
  const negChains    = ["COLD_TAKE", "SCHEDULE_LOSS", "COASTING_FAV"];
  const hasCIQSharp  = ciqChains.some(c => sharpChains.includes(c));
  const hasCIQNeg    = ciqChains.some(c => negChains.includes(c));

  const { data: lmData, isLoading } = useQuery<LMGame[]>({
    queryKey: ["/api/line-movement"],
    queryFn: () => apiRequest("GET", "/api/line-movement").then(r => r.json()),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    enabled: open,
  });

  const matchGame = (g: LMGame) => {
    const names = [g.awayTeam, g.homeTeam].map(n => n.toLowerCase());
    const awayLast = (bet.awayTeam ?? "").split(" ").pop()?.toLowerCase() ?? "";
    const homeLast = (bet.homeTeam ?? "").split(" ").pop()?.toLowerCase() ?? "";
    const awayMatch = !awayLast || names.some(n => n.includes(awayLast) || awayLast.includes(n.split(" ").pop()!));
    const homeMatch = !homeLast || names.some(n => n.includes(homeLast) || homeLast.includes(n.split(" ").pop()!));
    return awayMatch && homeMatch;
  };

  const game = lmData?.find(g => g.sport === sport && matchGame(g)) ?? null;

  const spreadMove = game?.spread.move ?? null;
  const totalMove  = game?.total.move ?? null;
  const hasSteam   = (Math.abs(spreadMove ?? 0) >= 2) || (Math.abs(totalMove ?? 0) >= 2);
  const hasRLM     = (() => {
    if (!game) return false;
    const awayPub = game.spread.awayPublic ?? 50;
    const moved   = spreadMove ?? 0;
    return (awayPub >= 60 && moved > 0) || (awayPub <= 40 && moved < 0);
  })();

  // ── Derive CIQ interpretation of live line data ──
  const ciqLMScore  = ciqLMVar?.score as number | undefined;
  const ciqLMNote   = ciqLMVar?.note  as string | undefined;
  const ciqLMAvail  = ciqLMVar?.available !== false;

  // Build a natural-language interpretation combining LM data + CIQ grade engine
  const buildCIQInterpretation = (): { verdict: string; detail: string; color: string } | null => {
    if (!ciqGrade) return null;
    const gradeColor = ciqGrade.startsWith("A") ? "#22c55e" : ciqGrade.startsWith("B") ? "#fbbf24" : "#f87171";

    if (hasSteam && hasCIQSharp) {
      return {
        verdict: `CIQ confirms steam — Grade ${ciqGrade} pick`,
        detail: `Sharp money moved the line AND the grade engine detected professional action (SHARPS_LOVE chain). Score: ${ciqScore?.toFixed(1) ?? "—"}/10. High confidence the move is real.`,
        color: "#22c55e",
      };
    }
    if (hasSteam && ciqLMScore != null && ciqLMScore >= 7) {
      return {
        verdict: `CIQ rates this line move highly (${ciqLMScore.toFixed(1)}/10)`,
        detail: ciqLMNote ?? `The grade engine scored this line movement ${ciqLMScore.toFixed(1)}/10 — a significant move that adds to the overall Grade ${ciqGrade} rating.`,
        color: "#4ade80",
      };
    }
    if (hasRLM && hasCIQSharp) {
      return {
        verdict: `CIQ + RLM alignment — sharp fade confirmed`,
        detail: `Public is on one side but money moved the other way (Reverse Line Movement). The grade engine also fired a sharp money signal. Grade ${ciqGrade} — bet against the crowd.`,
        color: "#22c55e",
      };
    }
    if (hasCIQNeg) {
      return {
        verdict: `CIQ flags caution despite line data`,
        detail: `The grade engine detected negative pattern chains (${ciqChains.filter(c => negChains.includes(c)).join(", ")}). Even if the line looks favorable, CIQ rates this Grade ${ciqGrade} — proceed carefully.`,
        color: "#fbbf24",
      };
    }
    if (ciqLMScore != null && ciqLMAvail) {
      const scoreLabel = ciqLMScore >= 7 ? "favorable" : ciqLMScore >= 5 ? "neutral" : "unfavorable";
      return {
        verdict: `CIQ line movement score: ${ciqLMScore.toFixed(1)}/10 (${scoreLabel})`,
        detail: ciqLMNote ?? `Grade engine line movement variable scored ${ciqLMScore.toFixed(1)}/10 — contributing to overall Grade ${ciqGrade}.`,
        color: gradeColor,
      };
    }
    if (ciqGrade) {
      return {
        verdict: `CIQ Grade ${ciqGrade} — line movement not a primary signal`,
        detail: `Line movement data was neutral or unavailable when graded. The Grade ${ciqGrade} (${ciqScore?.toFixed(1) ?? "—"}/10) is driven by other factors — check the Analysis Panel above.`,
        color: gradeColor,
      };
    }
    return null;
  };

  const ciqInterp = buildCIQInterpretation();

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(19,35,58,0.1)", borderLeft: `3px solid ${accentColor}` }}>
      <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}33)` }} />

      {/* Collapsed header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[#13233A]/[0.03] transition-colors"
        style={{ background: "rgba(19,35,58,0.04)" }}
        onClick={() => setOpen(o => !o)}
      >
        <TrendingUp size={13} style={{ color: accentColor, flexShrink: 0 }} />
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Line Movement</span>

        {hasSteam && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>🔥 Steam</span>
        )}
        {hasRLM && !hasSteam && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}>↩ RLM</span>
        )}
        {ciqGrade && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded ml-auto mr-1"
            style={{
              background: ciqGrade.startsWith("A") ? "rgba(34,197,94,0.12)" : ciqGrade.startsWith("B") ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.12)",
              color: ciqGrade.startsWith("A") ? "#22c55e" : ciqGrade.startsWith("B") ? "#fbbf24" : "#f87171",
            }}>
            CIQ {ciqGrade}
          </span>
        )}
        {!game && !isLoading && open && (
          <span className="text-[10px] text-[#3D4B58] ml-1">No data for this game</span>
        )}

        <span style={{ color: "rgba(19,35,58,0.35)", transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>
          <ChevronRight size={13} />
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4" style={{ background: "#fff" }}>
          {isLoading && (
            <div className="flex items-center gap-2 py-3 text-xs" style={{ color: "rgba(19,35,58,0.5)" }}>
              <Loader2 size={13} className="animate-spin" /> Loading line data…
            </div>
          )}

          {!isLoading && !game && (
            <p className="text-xs py-3 text-center" style={{ color: "rgba(19,35,58,0.45)" }}>
              No line movement data found for this game yet.
            </p>
          )}

          {game && (
            <div className="space-y-4 pt-2">
              {/* Game header */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold" style={{ color: "#131A24" }}>{game.awayTeam} @ {game.homeTeam}</span>
                <div className="flex items-center gap-2">
                  {game.numBets != null && (
                    <span className="text-[10px] font-mono" style={{ color: "rgba(19,35,58,0.45)" }}>{game.numBets.toLocaleString()} bets</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
                    style={{ background: `${accentColor}18`, color: accentColor }}>{game.sport}</span>
                </div>
              </div>

              {/* ── CIQ Analysis interpretation of this line data ── */}
              {ciqInterp && (
                <div className="rounded-lg px-3 py-2.5"
                  style={{ background: ciqInterp.color + "0D", border: `1px solid ${ciqInterp.color}40` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: ciqInterp.color }}>⚡ CIQ Analysis</span>
                  </div>
                  <p className="text-[11px] font-bold mb-0.5" style={{ color: "#131A24" }}>{ciqInterp.verdict}</p>
                  <p className="text-[10px] leading-snug" style={{ color: "rgba(19,35,58,0.6)" }}>{ciqInterp.detail}</p>
                </div>
              )}

              {/* ── Spread ── */}
              {(game.spread.open != null || game.spread.current != null) && (
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(19,35,58,0.4)" }}>Spread</div>
                  <MoveRow label="ATS" open={game.spread.open} current={game.spread.current} move={game.spread.move} />
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <PublicRowLM label={`${game.awayTeam.split(" ").pop()} ATS`} publicPct={game.spread.awayPublic} moneyPct={game.spread.awayMoney} accentColor={accentColor} />
                    <PublicRowLM label={`${game.homeTeam.split(" ").pop()} ATS`} publicPct={game.spread.homePublic} moneyPct={game.spread.homeMoney} accentColor={accentColor} />
                  </div>
                </div>
              )}

              {(game.spread.open != null) && (game.total.open != null) && (
                <div style={{ height: 1, background: "rgba(19,35,58,0.07)" }} />
              )}

              {/* ── Total ── */}
              {(game.total.open != null || game.total.current != null) && (
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(19,35,58,0.4)" }}>Total (O/U)</div>
                  <MoveRow label="O/U" open={game.total.open} current={game.total.current} move={game.total.move} />
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <PublicRowLM label="Over" publicPct={game.total.overPublic}  moneyPct={game.total.overMoney}  accentColor={accentColor} />
                    <PublicRowLM label="Under" publicPct={game.total.underPublic} moneyPct={game.total.underMoney} accentColor={accentColor} />
                  </div>
                </div>
              )}

              {(game.total.open != null) && (game.moneyline.awayOpen != null || game.moneyline.homeOpen != null) && (
                <div style={{ height: 1, background: "rgba(19,35,58,0.07)" }} />
              )}

              {/* ── Moneyline ── */}
              {(game.moneyline.awayOpen != null || game.moneyline.homeOpen != null) && (
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(19,35,58,0.4)" }}>Moneyline</div>
                  <MoveRow label={game.awayTeam.split(" ").pop()!} open={game.moneyline.awayOpen} current={game.moneyline.awayCurrent} move={game.moneyline.awayCurrent != null && game.moneyline.awayOpen != null ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null} />
                  <MoveRow label={game.homeTeam.split(" ").pop()!} open={game.moneyline.homeOpen} current={game.moneyline.homeCurrent} move={game.moneyline.homeCurrent != null && game.moneyline.homeOpen != null ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null} />
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <PublicRowLM label={`${game.awayTeam.split(" ").pop()} ML`} publicPct={game.moneyline.awayPublic} moneyPct={game.moneyline.awayMoney} accentColor={accentColor} />
                    <PublicRowLM label={`${game.homeTeam.split(" ").pop()} ML`} publicPct={game.moneyline.homePublic} moneyPct={game.moneyline.homeMoney} accentColor={accentColor} />
                  </div>
                </div>
              )}

              {/* ── Sharp signal summary ── */}
              {(hasSteam || hasRLM) && (
                <div className="rounded-lg px-3 py-2.5 mt-1"
                  style={{ background: hasSteam ? "rgba(248,113,113,0.06)" : "rgba(74,222,128,0.06)", border: `1px solid ${hasSteam ? "rgba(248,113,113,0.2)" : "rgba(74,222,128,0.2)"}` }}>
                  <p className="text-[11px] font-bold" style={{ color: hasSteam ? "#f87171" : "#4ade80" }}>
                    {hasSteam ? "🔥 Sharp Steam Detected" : "↩ Reverse Line Movement"}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "rgba(19,35,58,0.6)" }}>
                    {hasSteam
                      ? `Line moved ${Math.abs(spreadMove ?? totalMove ?? 0)} pts — professional money is behind this game.`
                      : `Public % and line direction diverge — sharp money is fading the public side.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── How to Read ── */}
          <div style={{ borderTop: "1px solid rgba(19,35,58,0.08)" }}>
            <button
              className="w-full flex items-center justify-between pt-3 pb-1"
              onClick={() => setShowGuide(g => !g)}
            >
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(19,35,58,0.4)" }}>
                How to Read This Analysis
              </span>
              <span style={{ color: "rgba(19,35,58,0.35)", transform: showGuide ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.2s" }}>
                <ChevronRight size={12} />
              </span>
            </button>

            {showGuide && (
              <div className="space-y-3 pb-1">

                {/* Section: Line data */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(19,35,58,0.45)" }}>
                    The Numbers
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { label: "Open → Current", desc: "Where the line opened before tip-off vs where it sits now. A move of 1–2 pts is notable. 3+ pts is a major shift." },
                      { label: "Public % (tickets)", desc: "What % of bets placed are on each side. This is crowd opinion — useful only when it diverges from money %." },
                      { label: "Money % (dollars)", desc: "What % of actual dollar volume is on each side. Sharp bettors bet larger — this is the signal that matters." },
                      { label: "Spread delta", desc: "The net change in the point spread since open. Negative = line moved toward home team. Positive = moved toward away." },
                    ].map(row => (
                      <div key={row.label} className="flex gap-2">
                        <span className="text-[10px] font-bold shrink-0 w-32" style={{ color: "#131A24" }}>{row.label}</span>
                        <span className="text-[10px] leading-snug" style={{ color: "rgba(19,35,58,0.55)" }}>{row.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section: Signals */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(19,35,58,0.45)" }}>
                    Key Signals
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { emoji: "🔥", label: "Steam", desc: "Line moved 2+ pts — sharp syndicates or wiseguys hit multiple books simultaneously. Follow the direction." },
                      { emoji: "↩", label: "Reverse Line Movement (RLM)", desc: "60%+ of tickets on Team A, but the line moves toward Team A anyway. Sharps are on Team A in size — trust the money, fade the crowd." },
                      { emoji: "⚡", label: "SHARPS_LOVE chain", desc: "CIQ grade engine detected sharp money signals in its analysis. Fired when money% diverges sharply from ticket%. Adds +0.8 to the game score." },
                      { emoji: "💰", label: "THE_MISPRICING chain", desc: "CIQ detected a market pricing error — the line hasn't fully adjusted to new information. Adds +1.0 to game score (strongest positive chain)." },
                    ].map(row => (
                      <div key={row.label} className="flex gap-2">
                        <span className="text-[10px] shrink-0">{row.emoji}</span>
                        <div>
                          <span className="text-[10px] font-bold" style={{ color: "#131A24" }}>{row.label} — </span>
                          <span className="text-[10px] leading-snug" style={{ color: "rgba(19,35,58,0.55)" }}>{row.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section: CIQ Line Movement variable */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(19,35,58,0.45)" }}>
                    CIQ Line Movement Score (1–10)
                  </p>
                  <div className="space-y-1">
                    {[
                      { range: "9–10", label: "BIG MOVE", desc: "Spread delta ≥3 pts. Major sharp action — highest weight in the grade." },
                      { range: "7–8",  label: "Significant",  desc: "Delta 1.5–3 pts. Meaningful professional interest." },
                      { range: "5–6",  label: "Minor / Flat", desc: "Delta <1.5 pts. Line movement is not a differentiator for this pick." },
                      { range: "1–4",  label: "Reverse signal", desc: "Line moved against the pick direction — a penalty applied to the score." },
                    ].map(row => (
                      <div key={row.range} className="flex gap-2 items-start">
                        <span className="text-[10px] font-black tabular-nums shrink-0 w-8" style={{ color: accentColor }}>{row.range}</span>
                        <div>
                          <span className="text-[10px] font-bold" style={{ color: "#131A24" }}>{row.label} — </span>
                          <span className="text-[10px] leading-snug" style={{ color: "rgba(19,35,58,0.55)" }}>{row.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section: How to use it */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(19,35,58,0.45)" }}>
                    How to Use It
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { icon: "✅", text: "Best case: Steam OR RLM aligns with CIQ Grade A/B + SHARPS_LOVE chain fired. All signals pointing the same way — highest conviction." },
                      { icon: "⚠️", text: "Mixed signal: Line moved your direction but public % is also heavy that way. Could be steam, could be public — wait for money% to confirm." },
                      { icon: "❌", text: "Avoid: Line moved against the pick AND CIQ grade engine scored line_movement ≤4. Sharp money disagrees with this pick direction." },
                      { icon: "📊", text: "Totals: OVER steam (total goes up) = sharps expect high-scoring. UNDER steam (total drops) = expected low-scoring game, defenses in control." },
                    ].map((row, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="text-[11px] shrink-0">{row.icon}</span>
                        <span className="text-[10px] leading-snug" style={{ color: "rgba(19,35,58,0.6)" }}>{row.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live Game Panel ────────────────────────────────────────────────────────
interface LiveScoreTeam {
  abbr: string; displayName: string; shortName: string;
  logo: string | null; score: string; homeAway: string;
  linescores: { period: number; value: string }[];
  records: string[];
}
interface LiveSituation {
  lastPlay: string | null; balls: number; strikes: number; outs: number;
  onFirst: boolean; onSecond: boolean; onThird: boolean;
  pitcher?: { name: string; summary: string; headshot: string | null } | null;
  batter?: { name: string; summary: string; headshot: string | null } | null;
}
interface LiveScoreGame {
  id: string; sport: string; shortName: string; date: string;
  status: { state: string; description: string; detail: string; shortDetail: string; period: number; completed: boolean };
  teams: LiveScoreTeam[];
  situation: LiveSituation | null;
  leaders: { category: string; displayValue: string; athlete: { name?: string; headshot?: string | null; teamId?: string | null } }[];
  broadcasts: string[];
  venue: { name: string; city?: string } | null;
}

function toCentralTimeBD(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
    }) + " CT";
  } catch { return ""; }
}

function SmDiamond({ sit }: { sit: LiveSituation }) {
  const on  = (active: boolean) => active ? "#f59e0b" : "transparent";
  const str = (active: boolean) => active ? "#f59e0b" : "#3D4B5866";
  return (
    <svg width="40" height="40" viewBox="0 0 40 40">
      <rect x="14" y="2"  width="12" height="12" rx="2" fill={on(sit.onSecond)} stroke={str(sit.onSecond)} strokeWidth="1.5" transform="rotate(45 20 8)" />
      <rect x="26" y="14" width="12" height="12" rx="2" fill={on(sit.onFirst)}  stroke={str(sit.onFirst)}  strokeWidth="1.5" transform="rotate(45 32 20)" />
      <rect x="2"  y="14" width="12" height="12" rx="2" fill={on(sit.onThird)}  stroke={str(sit.onThird)}  strokeWidth="1.5" transform="rotate(45 8 20)" />
      <polygon points="20,33 16,29 20,25 24,29" fill="rgba(19,35,58,0.3)" stroke="#3D4B58" strokeWidth="1" />
    </svg>
  );
}

function LiveGamePanel({ bet }: { bet: Bet }) {
  const sport = (bet.sport ?? "").toLowerCase();
  const validSports = ["nba", "nfl", "mlb", "nhl"];
  if (!validSports.includes(sport)) return null;

  const { data, isLoading } = useQuery<{ sports: Record<string, LiveScoreGame[]>; updatedAt: string }>({
    queryKey: ["/api/live-scores", sport],
    queryFn: () => apiRequest("GET", `/api/live-scores?sport=${sport}`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const games: LiveScoreGame[] = data?.sports?.[sport] ?? [];

  const matchGame = (g: LiveScoreGame) => {
    if (!bet.awayTeam && !bet.homeTeam) return false;
    const names = g.teams.flatMap(t => [
      t.abbr.toLowerCase(), t.shortName.toLowerCase(), t.displayName.toLowerCase()
    ]);
    const awayLast = (bet.awayTeam ?? "").split(" ").pop()?.toLowerCase() ?? "";
    const homeLast = (bet.homeTeam ?? "").split(" ").pop()?.toLowerCase() ?? "";
    const awayMatch = !awayLast || names.some(n => n.includes(awayLast) || awayLast.includes(n));
    const homeMatch = !homeLast || names.some(n => n.includes(homeLast) || homeLast.includes(n));
    return awayMatch && homeMatch;
  };

  const liveGame  = games.find(g => g.status.state === "in" && matchGame(g)) ?? null;
  const todayGame = !liveGame ? (games.find(g => matchGame(g)) ?? null) : null;
  const game = liveGame ?? todayGame;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#13233A]/10 p-4 animate-pulse bg-white">
        <div className="h-4 w-32 bg-[#13233A]/08 rounded mb-3" />
        <div className="h-16 bg-[#13233A]/05 rounded" />
      </div>
    );
  }

  if (!game) return null;

  const isLive  = game.status.state === "in";
  const isFinal = game.status.state === "post";
  const away = game.teams.find(t => t.homeAway === "away") ?? game.teams[0];
  const home = game.teams.find(t => t.homeAway === "home") ?? game.teams[1];
  const awayScore = parseInt(away?.score ?? "0");
  const homeScore = parseInt(home?.score ?? "0");
  const awayWin = isFinal && awayScore > homeScore;
  const homeWin = isFinal && homeScore > awayScore;

  const SPORT_COLOR: Record<string, string> = {
    nba: "#fb923c", mlb: "#60a5fa", nhl: "#22d3ee", nfl: "#f87171",
  };
  const sportColor = SPORT_COLOR[sport] ?? "#a78bfa";

  const playerLeader = game.leaders.find(l =>
    l.athlete.name && bet.playerName &&
    l.athlete.name.toLowerCase().includes((bet.playerName.split(" ").pop() ?? "").toLowerCase())
  ) ?? null;

  return (
    <div className="rounded-xl overflow-hidden border border-[#13233A]/12 bg-white">
      {/* Header */}
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: `${sportColor}18` }}>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <Wifi size={10} className="text-green-500" />
              <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">Live</span>
            </span>
          )}
          <span className="text-[11px] font-bold" style={{ color: isLive ? "#16a34a" : "#64748b" }}>
            {isLive ? game.status.shortDetail : isFinal ? "Final" : (toCentralTimeBD(game.date) || game.status.description)}
          </span>
        </div>
        {game.broadcasts[0] && (
          <span className="flex items-center gap-1 text-[10px] text-[#3D4B58]">
            <Tv2 size={9} /> {game.broadcasts[0]}
          </span>
        )}
      </div>

      {/* Score row */}
      <div className="px-4 py-4 flex items-center gap-2">
        <div className={`flex-1 flex items-center gap-2 min-w-0 ${isFinal && !awayWin ? "opacity-45" : ""}`}>
          {away?.logo && (
            <img src={away.logo} alt={away.abbr} className="w-9 h-9 object-contain flex-shrink-0"
              onError={e => (e.currentTarget.style.display = "none")} />
          )}
          <div className="min-w-0">
            <div className="font-black text-sm text-[#131A24]">{away?.abbr}</div>
            {away?.records[0] && <div className="text-[9px] text-[#3D4B58]">{away.records[0]}</div>}
          </div>
          <div className={`ml-auto font-black text-3xl ${awayWin ? "text-[#131A24]" : "text-[#3D4B58]"}`}>{away?.score}</div>
        </div>
        <div className="text-[11px] font-bold text-[#3D4B58] flex-shrink-0 px-1">@</div>
        <div className={`flex-1 flex items-center gap-2 flex-row-reverse min-w-0 ${isFinal && !homeWin ? "opacity-45" : ""}`}>
          {home?.logo && (
            <img src={home.logo} alt={home.abbr} className="w-9 h-9 object-contain flex-shrink-0"
              onError={e => (e.currentTarget.style.display = "none")} />
          )}
          <div className="text-right min-w-0">
            <div className="font-black text-sm text-[#131A24]">{home?.abbr}</div>
            {home?.records[0] && <div className="text-[9px] text-[#3D4B58]">{home.records[0]}</div>}
          </div>
          <div className={`mr-auto font-black text-3xl ${homeWin ? "text-[#131A24]" : "text-[#3D4B58]"}`}>{home?.score}</div>
        </div>
      </div>

      {/* MLB situation */}
      {isLive && game.situation && sport === "mlb" && (
        <div className="border-t border-[#13233A]/08 px-4 py-3 flex items-start gap-4 bg-[#F6F1E7]/50">
          <div className="flex flex-col items-center gap-1">
            <SmDiamond sit={game.situation} />
            <div className="flex gap-0.5 mt-0.5">
              {[0,1,2].map(i => (
                <div key={i} className={`w-2 h-2 rounded-full ${i < game.situation!.outs ? "bg-amber-400" : "border border-[#3D4B58]"}`} />
              ))}
            </div>
            <span className="text-[8px] text-[#3D4B58] uppercase font-bold">{game.situation.outs} out{game.situation.outs !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex gap-3">
              {[{l:"B",v:game.situation.balls,mx:4},{l:"S",v:game.situation.strikes,mx:3}].map(({l,v,mx}) => (
                <div key={l} className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold uppercase text-[#3D4B58]">{l}</span>
                  <div className="flex gap-0.5">
                    {Array.from({length:mx}).map((_,i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full ${i<v ? "bg-green-400" : "border border-[#3D4B58]"}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {game.situation.pitcher && (
              <div className="flex items-center gap-1.5">
                {game.situation.pitcher.headshot && (
                  <img src={game.situation.pitcher.headshot} alt="" className="w-5 h-5 rounded-full border border-[#13233A]/10"
                    onError={e => (e.currentTarget.style.display = "none")} />
                )}
                <span className="text-[9px] font-black text-[#3D4B58] uppercase mr-0.5">P</span>
                <span className="text-[11px] font-semibold text-[#131A24]">{game.situation.pitcher.name}</span>
                <span className="text-[10px] text-[#3D4B58]">({game.situation.pitcher.summary})</span>
              </div>
            )}
            {game.situation.batter && (
              <div className="flex items-center gap-1.5">
                {game.situation.batter.headshot && (
                  <img src={game.situation.batter.headshot} alt="" className="w-5 h-5 rounded-full border border-[#13233A]/10"
                    onError={e => (e.currentTarget.style.display = "none")} />
                )}
                <span className="text-[9px] font-black text-[#3D4B58] uppercase mr-0.5">AB</span>
                <span className="text-[11px] font-semibold text-[#131A24]">{game.situation.batter.name}</span>
                <span className="text-[10px] text-[#3D4B58]">({game.situation.batter.summary})</span>
              </div>
            )}
            {game.situation.lastPlay && (
              <p className="text-[10px] text-[#3D4B58] italic">↳ {game.situation.lastPlay}</p>
            )}
          </div>
        </div>
      )}

      {/* Player live stat line */}
      {playerLeader && (
        <div className="border-t border-[#13233A]/08 px-4 py-2.5 flex items-center gap-2 bg-[#F6F1E7]/40">
          {playerLeader.athlete.headshot && (
            <img src={playerLeader.athlete.headshot} alt="" className="w-7 h-7 rounded-full border border-[#13233A]/10"
              onError={e => (e.currentTarget.style.display = "none")} />
          )}
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-bold text-[#131A24]">{playerLeader.athlete.name}</span>
            <span className="text-[11px] text-[#3D4B58] ml-1.5">{playerLeader.displayValue}</span>
          </div>
          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: `${sportColor}20`, color: sportColor }}>{playerLeader.category}</span>
        </div>
      )}

      {/* Venue */}
      {game.venue && (
        <div className="border-t border-[#13233A]/06 px-4 py-2 flex items-center gap-1 text-[10px] text-[#3D4B58]/60">
          <MapPin size={9} />
          <span>{game.venue.name}{game.venue.city ? ` · ${game.venue.city}` : ""}</span>
        </div>
      )}
    </div>
  );
}


// ── Player Stats Section ───────────────────────────────────────────────────
function PlayerStatsSection({ bet }: { bet: Bet }) {
  const sport = bet.sport?.toUpperCase() ?? "";
  const canFetch = !!bet.playerName && (sport === "NBA" || sport === "NFL" || sport === "MLB" || sport === "NHL");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/player-stats", sport, bet.playerName],
    queryFn: () => apiRequest("GET", `/api/player-stats/${sport}/${encodeURIComponent(bet.playerName!)}`).then(r => r.json()),
    enabled: canFetch,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  // Full STAT_RAW_MAP for combo-aware stat resolution (mirrors BetDetailDrawer)
  type StatKeyResult = { key: string; label: string; isCombo?: boolean; comboKeys?: string[]; seasonKeys?: string[] };
  const STAT_RAW_MAP: Record<string, StatKeyResult> = {
    // NBA combos
    pts_rebs_asts:         { key: "pra",  label: "Pts+Reb+Ast", isCombo: true, comboKeys: ["pts","trb","ast"], seasonKeys: ["pts","reb","ast"] },
    "pts + rebs + asts":   { key: "pra",  label: "Pts+Reb+Ast", isCombo: true, comboKeys: ["pts","trb","ast"], seasonKeys: ["pts","reb","ast"] },
    pts_rebs:              { key: "pr",   label: "Pts+Reb",     isCombo: true, comboKeys: ["pts","trb"],       seasonKeys: ["pts","reb"] },
    "pts + rebs":          { key: "pr",   label: "Pts+Reb",     isCombo: true, comboKeys: ["pts","trb"],       seasonKeys: ["pts","reb"] },
    pts_asts:              { key: "pa",   label: "Pts+Ast",     isCombo: true, comboKeys: ["pts","ast"],       seasonKeys: ["pts","ast"] },
    "pts + asts":          { key: "pa",   label: "Pts+Ast",     isCombo: true, comboKeys: ["pts","ast"],       seasonKeys: ["pts","ast"] },
    rebs_asts:             { key: "ra",   label: "Reb+Ast",     isCombo: true, comboKeys: ["trb","ast"],       seasonKeys: ["reb","ast"] },
    "rebs + asts":         { key: "ra",   label: "Reb+Ast",     isCombo: true, comboKeys: ["trb","ast"],       seasonKeys: ["reb","ast"] },
    blks_stls:             { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    "blks + stls":         { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    "blocks + steals":     { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    "blocks+steals":       { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    period_1_pts_rebs_asts:   { key: "pra", label: "1Q Pts+Reb+Ast", isCombo: true, comboKeys: ["pts","trb","ast"], seasonKeys: ["pts","reb","ast"] },
    period_1_2_pts_rebs_asts: { key: "pra", label: "1H Pts+Reb+Ast", isCombo: true, comboKeys: ["pts","trb","ast"], seasonKeys: ["pts","reb","ast"] },
    // MLB combo
    hits_runs_rbis:        { key: "hrr", label: "H+R+RBI",      isCombo: true, comboKeys: ["hits","runs","rbi"], seasonKeys: ["hits","runs","rbi"] },
    "hits + runs + rbis":  { key: "hrr", label: "H+R+RBI",      isCombo: true, comboKeys: ["hits","runs","rbi"], seasonKeys: ["hits","runs","rbi"] },
    "hits+runs+rbis":      { key: "hrr", label: "H+R+RBI",      isCombo: true, comboKeys: ["hits","runs","rbi"], seasonKeys: ["hits","runs","rbi"] },
    // NHL combo
    "goals + assists":     { key: "ga",  label: "Goals+Ast",    isCombo: true, comboKeys: ["goals","ast"], seasonKeys: ["goals","ast"] },
    "goals+assists":       { key: "ga",  label: "Goals+Ast",    isCombo: true, comboKeys: ["goals","ast"], seasonKeys: ["goals","ast"] },
    nhl_points:            { key: "ga",  label: "Goals+Ast",    isCombo: true, comboKeys: ["goals","ast"], seasonKeys: ["goals","ast"] },
    // NBA single
    points:    { key: "pts",      label: "Points" },
    assists:   { key: "ast",      label: "Assists" },
    rebounds:  { key: "trb",      label: "Rebounds" },
    steals:    { key: "stl",      label: "Steals" },
    blocks:    { key: "blk",      label: "Blocks" },
    threes:    { key: "fg3_made", label: "3PM" },
    three_points_made: { key: "fg3_made", label: "3PM" },
    turnovers: { key: "tov",      label: "Turnovers" },
    // NHL single
    goals:         { key: "goals",        label: "Goals" },
    shots:         { key: "shots",        label: "Shots" },
    saves:         { key: "saves",        label: "Saves" },
    blocked_shots: { key: "blocked_shots",label: "Blocks" },
    faceoffs_won:  { key: "faceoffs_won", label: "FOW" },
    plus_minus:    { key: "plusMinus",    label: "+/-" },
    // MLB
    hits:         { key: "hits",        label: "Hits" },
    home_runs:    { key: "home_runs",    label: "Home Runs" },
    rbi:          { key: "rbi",          label: "RBIs" },
    rbis:         { key: "rbi",          label: "RBIs" },
    runs:         { key: "runs",         label: "Runs" },
    strikeouts:   { key: "strikeouts",   label: "Strikeouts" },
    stolen_bases: { key: "stolen_bases", label: "SB" },
    total_bases:  { key: "hits",         label: "Total Bases" },
    pitch_outs:   { key: "strikeouts",   label: "Pitch Outs" },
    // NFL
    passing_yards:   { key: "yds", label: "Pass Yds" },
    rushing_yards:   { key: "yds", label: "Rush Yds" },
    receiving_yards: { key: "yds", label: "Rec Yds" },
    receptions:      { key: "rec", label: "Receptions" },
    touchdowns:      { key: "td",  label: "Touchdowns" },
  };

  const getStatKey = (): StatKeyResult => {
    // 1. Use raw stat key from teamStats (most reliable)
    const ts = bet.teamStats as any;
    const rawStatKey = (ts?.statRaw ?? "").toLowerCase().trim();
    if (rawStatKey === "points" && sport === "NHL") return STAT_RAW_MAP["nhl_points"]!;
    if (rawStatKey === "rbis" && sport === "MLB") return STAT_RAW_MAP["rbis"]!;
    if (rawStatKey && STAT_RAW_MAP[rawStatKey]) return STAT_RAW_MAP[rawStatKey];

    // 2. Use display statType from teamStats
    const statType = (ts?.statType ?? "").toLowerCase().trim();
    if (statType === "points" && sport === "NHL") return STAT_RAW_MAP["nhl_points"]!;
    if (statType && STAT_RAW_MAP[statType]) return STAT_RAW_MAP[statType];

    // 3. Title-based fallback
    const title = (bet.title + " " + (bet.description ?? "")).toLowerCase();
    if (sport === "NBA") {
      const hasPRA = title.includes("pts + rebs + asts") || title.includes("pts+rebs+asts") || title.includes("pts_rebs_asts") || title.includes("pra");
      const hasPR  = !hasPRA && (title.includes("pts + rebs") || title.includes("pts+rebs") || title.includes("pts_rebs") || title.includes("points + rebounds"));
      const hasPA  = !hasPRA && !hasPR && (title.includes("pts + asts") || title.includes("pts+asts") || title.includes("pts_asts") || title.includes("points + assists"));
      const hasRA  = !hasPRA && !hasPR && !hasPA && (title.includes("rebs + asts") || title.includes("rebs+asts") || title.includes("rebs_asts") || title.includes("rebounds + assists"));
      const hasBS  = !hasPRA && !hasPR && !hasPA && !hasRA && (title.includes("blks_stls") || title.includes("blks + stls") || (title.includes("block") && title.includes("steal")));
      if (hasPRA) return STAT_RAW_MAP["pts_rebs_asts"]!;
      if (hasPR)  return STAT_RAW_MAP["pts_rebs"]!;
      if (hasPA)  return STAT_RAW_MAP["pts_asts"]!;
      if (hasRA)  return STAT_RAW_MAP["rebs_asts"]!;
      if (hasBS)  return STAT_RAW_MAP["blks_stls"]!;
      if (title.includes("rebound")) return STAT_RAW_MAP["rebounds"]!;
      if (title.includes("assist"))  return STAT_RAW_MAP["assists"]!;
      if (title.includes("steal"))   return STAT_RAW_MAP["steals"]!;
      if (title.includes("block"))   return STAT_RAW_MAP["blocks"]!;
      if (title.includes("three") || title.includes("3pt") || title.includes("3-point")) return STAT_RAW_MAP["threes"]!;
      if (title.includes("turnover")) return STAT_RAW_MAP["turnovers"]!;
      return STAT_RAW_MAP["points"]!;
    }
    if (sport === "NHL") {
      if (title.includes("goals+assists") || title.includes("goals + assists") || (title.includes("goal") && title.includes("assist"))) return STAT_RAW_MAP["goals + assists"]!;
      if (title.includes("point") && !title.includes("power play")) return STAT_RAW_MAP["nhl_points"]!;
      if (title.includes("goal"))    return STAT_RAW_MAP["goals"]!;
      if (title.includes("assist"))  return { key: "ast", label: "Assists" };
      if (title.includes("shot"))    return STAT_RAW_MAP["shots"]!;
      if (title.includes("save"))    return STAT_RAW_MAP["saves"]!;
      if (title.includes("block"))   return STAT_RAW_MAP["blocked_shots"]!;
      if (title.includes("faceoff")) return STAT_RAW_MAP["faceoffs_won"]!;
      return STAT_RAW_MAP["goals"]!;
    }
    if (sport === "MLB") {
      const hasHRR = title.includes("hits_runs_rbis") || title.includes("hits + runs + rbis") || (title.includes("hit") && title.includes("run") && title.includes("rbi"));
      if (hasHRR)                               return STAT_RAW_MAP["hits_runs_rbis"]!;
      if (title.includes("home run"))            return STAT_RAW_MAP["home_runs"]!;
      if (title.includes("strikeout"))           return STAT_RAW_MAP["strikeouts"]!;
      if (title.includes("rbi"))                 return STAT_RAW_MAP["rbis"]!;
      if (title.includes("stolen base"))         return STAT_RAW_MAP["stolen_bases"]!;
      if (title.includes("total base"))          return STAT_RAW_MAP["total_bases"]!;
      if (title.includes("run") && !title.includes("home run")) return STAT_RAW_MAP["runs"]!;
      return STAT_RAW_MAP["hits"]!;
    }
    if (sport === "NFL") {
      if (title.includes("passing"))   return STAT_RAW_MAP["passing_yards"]!;
      if (title.includes("rushing"))   return STAT_RAW_MAP["rushing_yards"]!;
      if (title.includes("receiving")) return STAT_RAW_MAP["receiving_yards"]!;
      if (title.includes("reception")) return STAT_RAW_MAP["receptions"]!;
      if (title.includes("touchdown")) return STAT_RAW_MAP["touchdowns"]!;
      return STAT_RAW_MAP["passing_yards"]!;
    }
    return STAT_RAW_MAP["points"]!;
  };
  const statKey = getStatKey();

  // Helpers for combo stat calculation
  const getGameStatValue = (game: any): number => {
    if (statKey.isCombo && statKey.comboKeys) {
      return statKey.comboKeys.reduce((sum, k) => sum + (parseFloat(game[k]) || 0), 0);
    }
    const k = statKey.key === "reb" ? "trb" : statKey.key;
    return parseFloat(game[k]) || 0;
  };
  const getSeasonStatValue = (season: any): number => {
    if (statKey.isCombo) {
      const keys = (statKey as any).seasonKeys ?? statKey.comboKeys ?? [];
      return keys.reduce((sum: number, k: string) => sum + (parseFloat(season[k]) || 0), 0);
    }
    const k = statKey.key === "trb" ? "reb" : statKey.key;
    return parseFloat(season[k] ?? season[statKey.key]) || 0;
  };

  if (!bet.playerName) return null;

  // Derive accent color: prefer team color, fall back to sport color
  const sportColor = SPORT_ACCENT[sport] ?? "#f59e0b";
  const teamColor  = getTeamColor(bet.homeTeam) ?? getTeamColor(bet.awayTeam) ?? null;
  const accentColor = teamColor ?? sportColor;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)", borderLeft: `3px solid ${accentColor}` }}>
      {/* Color accent top bar */}
      <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }} />
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(19,35,58,0.1)" }}>
        <BarChart2 size={13} style={{ color: accentColor }} />
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Player Analytics</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}40` }}>
          👤 {bet.playerName}
        </span>
        {data?.bbrUrl && (
          <a href={data.bbrUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border hover:bg-white/5 transition-colors"
            style={{ color: accentColor, borderColor: `${accentColor}40` }}>
            <ExternalLink size={9} /> BBR
          </a>
        )}
      </div>

      <div className="p-4 space-y-5">
        {!canFetch && (
          <div className="text-center py-4 space-y-2">
            <p className="text-sm" style={{ color: "rgba(19,35,58,0.56)" }}>📊 Live stat lookup available for NBA & NFL</p>
            {/* Show any stored playerStats from the bet record */}
            {bet.playerStats && Object.keys(bet.playerStats as object).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-left">
                {Object.entries(bet.playerStats as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                  <div key={k} className="p-2 rounded-lg" style={{ background: "rgba(19,35,58,0.06)", border: "1px solid rgba(19,35,58,0.1)" }}>
                    <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "rgba(19,35,58,0.49)" }}>{k.replace(/_/g, " ")}</p>
                    <p className="text-sm font-mono font-bold" style={{ color: "hsl(45 100% 90%)" }}>
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {canFetch && isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs" style={{ color: "rgba(19,35,58,0.56)" }}>
            <Loader2 size={14} className="animate-spin" />
            Fetching live stats for {bet.playerName}...
          </div>
        )}

        {canFetch && !isLoading && data && (
          <>
            {/* Season averages grid */}
            {data.season && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "rgba(19,35,58,0.49)" }}>
                  {data.seasonLabel ?? "2024-25 Season Averages"}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {sport === "NBA" && [
                    { k: "pts", l: "PTS" }, { k: "reb", l: "REB" }, { k: "ast", l: "AST" },
                    { k: "stl", l: "STL" }, { k: "blk", l: "BLK" }, { k: "fg_pct", l: "FG%" },
                    { k: "fg3_pct", l: "3P%" }, { k: "mpg", l: "MPG" },
                  ].map(({ k, l }) => {
                    const val = data.season[k] ?? "—";
                    const isRelevant = statKey.isCombo
                      ? ((statKey.comboKeys ?? []).some(ck => ck === k || (ck === "trb" && k === "reb") || (ck === "ast" && k === "ast") || (ck === "pts" && k === "pts")))
                      : (statKey.key === k || (statKey.key === "trb" && k === "reb"));
                    return (
                      <div key={k} className="text-center py-2 px-1 rounded-lg"
                        style={{ background: isRelevant ? `${accentColor}18` : "rgba(19,35,58,0.06)", border: `1px solid ${isRelevant ? `${accentColor}50` : "rgba(19,35,58,0.1)"}` }}>
                        <p className="text-base font-black font-mono leading-none" style={{ color: isRelevant ? accentColor : "#131A24" }}>{val}</p>
                        <p className="text-[9px] mt-1 font-semibold uppercase" style={{ color: "rgba(19,35,58,0.49)" }}>{l}</p>
                      </div>
                    );
                  })}
                  {sport === "NFL" && Object.entries(data.season ?? {}).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="text-center py-2 px-1 rounded-lg" style={{ background: "rgba(19,35,58,0.06)", border: "1px solid rgba(19,35,58,0.1)" }}>
                      <p className="text-base font-black font-mono leading-none" style={{ color: "#131A24" }}>{String(v || "—")}</p>
                      <p className="text-[9px] mt-1 font-semibold uppercase" style={{ color: "rgba(19,35,58,0.49)" }}>{k.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stat vs Prop Line comparison */}
            {bet.line != null && data.season && (() => {
              const statVal = getSeasonStatValue(data.season);
              if (!isNaN(statVal) && statVal > 0) {
                return (
                  <div className="pt-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(19,35,58,0.49)" }}>
                      Season Avg vs Prop Line
                    </p>
                    <StatVsLine statLabel={statKey.label} statValue={parseFloat(statVal.toFixed(1))} propLine={bet.line} pickSide={(bet.teamStats as any)?.pickSide} sportColor={accentColor} />
                  </div>
                );
              }
              return null;
            })()}

            {/* Last 5 games bar chart + full game log table */}
            {data.recentGames && data.recentGames.length > 0 && (
              <div className="pt-1 space-y-4">
                <MiniBarChart
                  games={data.recentGames.map((g: any) => ({
                    ...g,
                    _combo: statKey.isCombo ? getGameStatValue(g) : undefined,
                  }))}
                  statKey={statKey.isCombo ? "_combo" : (statKey.key === "reb" ? "trb" : statKey.key)}
                  propLine={bet.line}
                  label={statKey.label}
                  pickSide={(bet.teamStats as any)?.pickSide}
                  sportColor={accentColor}
                />
                <GameLogTable
                  games={data.recentGames.map((g: any) => ({
                    ...g,
                    _combo: statKey.isCombo ? getGameStatValue(g) : undefined,
                  }))}
                  sport={sport}
                  focusStatKey={statKey.isCombo ? "_combo" : (statKey.key === "reb" ? "trb" : statKey.key)}
                  focusStatLabel={statKey.label}
                  propLine={bet.line}
                  comboKeys={statKey.comboKeys}
                  pickSide={(bet.teamStats as any)?.pickSide}
                  sportColor={accentColor}
                />
              </div>
            )}

            {/* Recent form summary */}
            {data.recentGames && data.recentGames.length > 0 && bet.line != null && (() => {
              const isUnderPick = (bet.teamStats as any)?.pickSide?.toUpperCase() === "UNDER";
              const hits = data.recentGames.filter((g: any) => isUnderPick ? getGameStatValue(g) < bet.line! : getGameStatValue(g) >= bet.line!).length;
              const total = data.recentGames.length;
              const hitRate = Math.round((hits / total) * 100);
              return (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ background: hitRate >= 60 ? "rgba(74,222,128,0.08)" : hitRate >= 40 ? "rgba(251,191,36,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${hitRate >= 60 ? "rgba(74,222,128,0.2)" : hitRate >= 40 ? "rgba(251,191,36,0.2)" : "rgba(248,113,113,0.2)"}` }}>
                  <span className="text-xs font-semibold" style={{ color: "rgba(19,35,58,0.7)" }}>Recent hit rate vs {bet.line} line</span>
                  <span className="text-sm font-black font-mono" style={{ color: hitRate >= 60 ? "#4ade80" : hitRate >= 40 ? "#fbbf24" : "#f87171" }}>
                    {hits}/{total} ({hitRate}%)
                  </span>
                </div>
              );
            })()}
          </>
        )}

        {canFetch && !isLoading && !data && (
          <div className="text-center py-4">
            <p className="text-sm" style={{ color: "rgba(19,35,58,0.56)" }}>Stats not available for this player right now.</p>
            {/* Show stored playerStats fallback */}
            {bet.playerStats && Object.keys(bet.playerStats as object).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-left">
                {Object.entries(bet.playerStats as Record<string, unknown>).filter(([, v]) => v !== null).map(([k, v]) => (
                  <div key={k} className="p-2 rounded-lg" style={{ background: "rgba(19,35,58,0.06)", border: "1px solid rgba(19,35,58,0.1)" }}>
                    <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "rgba(19,35,58,0.49)" }}>{k.replace(/_/g, " ")}</p>
                    <p className="text-sm font-mono font-bold" style={{ color: "hsl(45 100% 90%)" }}>
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Similar Bets ───────────────────────────────────────────────────────────
function SimilarBets({ bet }: { bet: Bet }) {
  const { data: allBets } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    staleTime: 5 * 60 * 1000,
  });

  const similar = (allBets ?? [])
    .filter((b) => b.id !== bet.id && (
      (bet.playerName && b.playerName?.toLowerCase().includes(bet.playerName.split(" ")[0].toLowerCase())) ||
      (bet.homeTeam && b.homeTeam === bet.homeTeam) ||
      (bet.awayTeam && b.awayTeam === bet.awayTeam) ||
      (b.betType === bet.betType && b.sport === bet.sport)
    ))
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 4);

  if (!similar.length) return null;
  const accent = SPORT_ACCENT[bet.sport?.toUpperCase()] ?? "#f59e0b";

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(19,35,58,0.1)" }}>
        <TrendingUp size={13} style={{ color: accent }} />
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Similar Bets</span>
        <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>{similar.length}</span>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(19,35,58,0.07)" }}>
        {similar.map((b) => {
          const conf = b.confidenceScore ?? 0;
          const confColor = conf >= 85 ? "#4ade80" : conf >= 70 ? "#fbbf24" : "#f87171";
          return (
            <Link key={b.id} href={`/bets/${b.id}`}>
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-black font-mono text-sm"
                  style={{ background: `${confColor}18`, border: `1px solid ${confColor}30`, color: confColor }}>
                  {conf}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight line-clamp-1" style={{ color: "hsl(45 100% 90%)" }}>
                    {b.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
                  </p>
                  {b.playerName && (
                    <p className="text-[10px] mt-0.5" style={{ color: "rgba(19,35,58,0.56)" }}>👤 {b.playerName}</p>
                  )}
                </div>
                <ChevronRight size={13} style={{ color: "rgba(19,35,58,0.35)", flexShrink: 0 }} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Raw Stats (fallback display for teamStats/playerStats) ─────────────────
function RawStatsGrid({ data, title }: { data: Record<string, unknown>; title: string }) {
  const entries = Object.entries(data).filter(([k, v]) =>
    v !== null && v !== undefined && String(v).trim() !== "" &&
    !["pickside", "pickedodds", "stattype"].includes(k.toLowerCase())
  );
  if (!entries.length) return null;
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
      <div className="flex items-center gap-2">
        <BookOpen size={13} style={{ color: "#a78bfa" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>{title}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="p-2.5 rounded-lg" style={{ background: "rgba(19,35,58,0.06)", border: "1px solid rgba(19,35,58,0.1)" }}>
            <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "rgba(19,35,58,0.49)" }}>{k.replace(/_/g, " ")}</p>
            <p className="text-sm font-mono font-semibold" style={{ color: "hsl(45 100% 90%)" }}>
              {Array.isArray(v) ? v.join(", ") : String(v)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Clubhouse IQ Analysis Panel ──────────────────────────────────────────────
function CIQAnalysisPanel({ bet }: { bet: Bet }) {
  const ts      = bet.teamStats as Record<string, any> | null;
  const eg      = ts?.edgeGrade   as string | undefined;
  const es      = ts?.edgeScore   as number | undefined;
  const ez      = ts?.edgeSizing  as string | undefined;
  const ev      = ts?.edgeEV      as any;
  const vars    = ts?.edgeVariables as Record<string, any> | undefined;
  const chains  = (ts?.edgeChains ?? []) as string[];
  const peter   = ts?.edgePeter   as { flags?: any[]; has_kill?: boolean } | undefined;
  const [showVars, setShowVars] = useState(false);

  if (!eg) return null;

  const gradeColor = eg.startsWith("A+") ? "#22c55e"
    : eg.startsWith("A")  ? "#4ade80"
    : eg.startsWith("B+") ? "#a3e635"
    : eg.startsWith("B")  ? "#fbbf24"
    : eg.startsWith("C")  ? "#fb923c"
    : "#f87171";
  const sizingColor = ez === "2u" ? "#22c55e" : ez === "1.5u" ? "#a3e635" : ez === "1u" ? "#fbbf24" : "#94a3b8";

  const VAR_LABELS: Record<string, string> = {
    star_player: "Star Player", rest: "Rest Advantage", off_ranking: "Offense",
    def_ranking: "Defense", form: "Recent Form", home_away: "Home/Away",
    h2h: "Head-to-Head", ats: "ATS Trend", line_movement: "Line Movement",
    road_trip: "Road Trip", depth: "Depth / Injuries", pace: "Pace Matchup",
    motivation: "Motivation", starting_pitcher: "Starting Pitcher",
    goalie: "Goalie", congestion: "Fixture Load", park_factor: "Park Factor",
    bullpen: "Bullpen", lineup_vs_hand: "Lineup vs Hand", umpire: "Umpire",
    late_game_strength: "Late-Game Closing", quarter_pace: "Quarter Pace",
    bench_diff: "Bench Depth",
  };

  const CHAIN_INFO: Record<string, { emoji: string; label: string; positive: boolean }> = {
    THE_MISPRICING:    { emoji: "💰", label: "Market Mispricing",  positive: true  },
    FATIGUE_FADE:      { emoji: "😴", label: "Fatigue Fade",       positive: true  },
    FORM_WAVE:         { emoji: "🌊", label: "Form Wave",          positive: true  },
    INJURY_GOLDMINE:   { emoji: "🩹", label: "Injury Goldmine",    positive: true  },
    REST_DOMINATION:   { emoji: "🛌", label: "Rest Domination",    positive: true  },
    SHARPS_LOVE:       { emoji: "⚡", label: "Sharps Love",        positive: true  },
    BLOWOUT_INCOMING:  { emoji: "💥", label: "Blowout Incoming",   positive: true  },
    MISMATCH_MASSACRE: { emoji: "🔪", label: "Mismatch Massacre",  positive: true  },
    ROAD_WARRIOR:      { emoji: "🛣️", label: "Road Warrior",       positive: true  },
    BENCH_MOB:         { emoji: "🪑", label: "Bench Mob",          positive: true  },
    REVENGE_GAME:      { emoji: "😤", label: "Revenge Game",       positive: true  },
    BOUNCE_BACK:       { emoji: "🔁", label: "Bounce Back",        positive: true  },
    HUNGRY_DOG:        { emoji: "🐕", label: "Hungry Dog",         positive: true  },
    GOALIE_EDGE:       { emoji: "🧤", label: "Goalie Edge",        positive: true  },
    ACE_DOMINATION:    { emoji: "⚾", label: "Ace Domination",     positive: true  },
    COORS_OVER:        { emoji: "🏔️", label: "Coors Over",         positive: true  },
    PITCHING_DUEL:     { emoji: "🤝", label: "Pitching Duel",      positive: true  },
    CONGESTION_FADE:   { emoji: "📅", label: "Congestion Fade",    positive: true  },
    CLASS_GAP:         { emoji: "🏆", label: "Class Gap",          positive: true  },
    FORTRESS_HOME:     { emoji: "🏰", label: "Fortress Home",      positive: true  },
    DERBY_CHAOS:       { emoji: "🎭", label: "Derby Chaos",        positive: true  },
    DUMPSTER_FIRE:     { emoji: "🔥", label: "Dumpster Fire",      positive: false },
    COLD_TAKE:         { emoji: "🥶", label: "Cold Take",          positive: false },
    GLASS_CANNON:      { emoji: "💎", label: "Glass Cannon",       positive: false },
    SCHEDULE_LOSS:     { emoji: "📆", label: "Schedule Loss",      positive: false },
    THIN_ROSTER:       { emoji: "🤕", label: "Thin Roster",        positive: false },
    COASTING_FAV:      { emoji: "😴", label: "Coasting Fav",       positive: false },
    FADE_THE_STREAK:   { emoji: "📉", label: "Fade the Streak",    positive: false },
    TOURIST_TRAP:      { emoji: "🗺️", label: "Tourist Trap",       positive: false },
    BLUE_BLOOD_TRAP:   { emoji: "👑", label: "Blue Blood Trap",    positive: false },
  };

  const availVars = vars
    ? Object.entries(vars)
        .filter(([, v]) => v?.available !== false && v?.score != null)
        .sort(([, a], [, b]) => (b as any).score - (a as any).score)
    : [];

  return (
    <div className="rounded-xl overflow-hidden mb-1" style={{ border: "1px solid rgba(19,35,58,0.14)" }}>

      {/* ── Header: grade + score + sizing + EV + Kelly ── */}
      <div className="px-4 pt-4 pb-3" style={{ background: "rgba(19,35,58,0.04)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(19,35,58,0.4)" }}>
            Clubhouse IQ Analysis
          </span>
          {availVars.length > 0 && (
            <button
              onClick={() => setShowVars(v => !v)}
              className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: "rgba(19,35,58,0.08)", color: "rgba(19,35,58,0.55)" }}
            >
              {showVars ? "Hide breakdown ▲" : "Show breakdown ▼"}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          {/* Letter grade */}
          <div className="flex flex-col items-center justify-center rounded-lg px-4 py-2.5 min-w-[60px]"
            style={{ background: gradeColor + "18", border: `2px solid ${gradeColor}` }}>
            <span className="text-2xl font-black leading-none" style={{ color: gradeColor }}>{eg}</span>
            <span className="text-[10px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: "rgba(19,35,58,0.45)" }}>Grade</span>
          </div>
          {/* Score /10 */}
          {es != null && (
            <div className="flex flex-col items-center justify-center rounded-lg px-3 py-2.5"
              style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.1)" }}>
              <span className="text-xl font-black leading-none" style={{ color: "#131A24" }}>
                {Number(es).toFixed(1)}<span className="text-xs font-semibold" style={{ color: "rgba(19,35,58,0.4)" }}>/10</span>
              </span>
              <span className="text-[10px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: "rgba(19,35,58,0.45)" }}>Score</span>
            </div>
          )}
          {/* Sizing */}
          {ez && (
            <div className="flex flex-col items-center justify-center rounded-lg px-3 py-2.5"
              style={{ background: sizingColor + "18", border: `1px solid ${sizingColor}` }}>
              <span className="text-xl font-black leading-none" style={{ color: sizingColor }}>{ez.toUpperCase()}</span>
              <span className="text-[10px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: "rgba(19,35,58,0.45)" }}>Sizing</span>
            </div>
          )}
          {/* EV % */}
          {ev?.ev_pct != null && (
            <div className="flex flex-col items-center justify-center rounded-lg px-3 py-2.5"
              style={{ background: ev.ev_pct >= 0 ? "rgba(34,197,94,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${ev.ev_pct >= 0 ? "#4ade80" : "#f87171"}` }}>
              <span className="text-xl font-black leading-none" style={{ color: ev.ev_pct >= 0 ? "#4ade80" : "#f87171" }}>
                {ev.ev_pct >= 0 ? "+" : ""}{Number(ev.ev_pct).toFixed(1)}%
              </span>
              <span className="text-[10px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: "rgba(19,35,58,0.45)" }}>EV</span>
            </div>
          )}
          {/* Kelly sizing */}
          {ev?.kelly_units && ev.kelly_units !== "PASS" && (
            <div className="flex flex-col items-center justify-center rounded-lg px-3 py-2.5"
              style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.1)" }}>
              <span className="text-xl font-black leading-none" style={{ color: "#131A24" }}>{ev.kelly_units}</span>
              <span className="text-[10px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: "rgba(19,35,58,0.45)" }}>Kelly</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Chains fired ── */}
      {chains.length > 0 && (
        <div className="px-4 py-3" style={{ background: "rgba(19,35,58,0.02)", borderTop: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: "rgba(19,35,58,0.4)" }}>
            Pattern Chains Fired ({chains.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chains.map((c: string) => {
              const info = CHAIN_INFO[c];
              const positive = info?.positive ?? true;
              return (
                <span key={c} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold"
                  style={{
                    background: positive ? "rgba(34,197,94,0.10)" : "rgba(248,113,113,0.10)",
                    border: `1px solid ${positive ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`,
                    color: positive ? "#22c55e" : "#f87171",
                  }}>
                  {info?.emoji ?? "⚙️"} {info?.label ?? c.replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Peter flags ── */}
      {peter?.flags && peter.flags.length > 0 && (
        <div className="px-4 py-3" style={{ background: "rgba(248,113,113,0.04)", borderTop: "1px solid rgba(248,113,113,0.15)" }}>
          <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: "#f87171" }}>
            {peter?.has_kill ? "⛔ Kill Switch Active" : "⚠️ Risk Flags"}
          </p>
          <div className="flex flex-col gap-1.5">
            {peter.flags.map((flag: any, i: number) => (
              <div key={i} className="flex items-start gap-2">
                <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase shrink-0"
                  style={{ background: flag.action === "KILL" ? "rgba(248,113,113,0.2)" : "rgba(251,191,36,0.2)", color: flag.action === "KILL" ? "#f87171" : "#fbbf24" }}>
                  {flag.action}
                </span>
                <span className="text-[11px] leading-tight" style={{ color: "rgba(19,35,58,0.65)" }}>{flag.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Variable breakdown ── */}
      {showVars && availVars.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: "rgba(19,35,58,0.4)" }}>
            Variable Breakdown ({availVars.length} factors)
          </p>
          <div className="flex flex-col gap-3">
            {availVars.map(([key, v]: [string, any]) => {
              const varScore = Number(v.score ?? 5);
              const varColor = varScore >= 7.5 ? "#22c55e" : varScore >= 6 ? "#4ade80" : varScore >= 4.5 ? "#fbbf24" : varScore >= 3 ? "#fb923c" : "#f87171";
              const barPct = Math.round((varScore / 10) * 100);
              const label = VAR_LABELS[key] ?? key.replace(/_/g, " ").split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold" style={{ color: "#131A24" }}>{label}</span>
                    <span className="text-[11px] font-black tabular-nums" style={{ color: varColor }}>{varScore.toFixed(1)}/10</span>
                  </div>
                  <div className="h-1.5 rounded-full mb-1" style={{ background: "rgba(19,35,58,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: varColor }} />
                  </div>
                  {v.note && (
                    <p className="text-[10px] leading-snug" style={{ color: "rgba(19,35,58,0.5)" }}>{v.note}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── EV detail ── */}
      {ev && (ev.true_prob != null || ev.implied_prob != null || ev.edge != null) && (
        <div className="px-4 py-3" style={{ background: "rgba(19,35,58,0.02)", borderTop: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: "rgba(19,35,58,0.4)" }}>Expected Value Detail</p>
          <div className="grid grid-cols-3 gap-2">
            {ev.true_prob != null && (
              <div className="rounded-lg p-2 text-center" style={{ background: "rgba(19,35,58,0.05)" }}>
                <p className="text-xs font-black" style={{ color: "#131A24" }}>{Math.round(ev.true_prob * 100)}%</p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(19,35,58,0.45)" }}>True Prob</p>
              </div>
            )}
            {ev.implied_prob != null && (
              <div className="rounded-lg p-2 text-center" style={{ background: "rgba(19,35,58,0.05)" }}>
                <p className="text-xs font-black" style={{ color: "#131A24" }}>{Math.round(ev.implied_prob * 100)}%</p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(19,35,58,0.45)" }}>Implied</p>
              </div>
            )}
            {ev.edge != null && (
              <div className="rounded-lg p-2 text-center" style={{ background: ev.edge >= 0 ? "rgba(34,197,94,0.08)" : "rgba(248,113,113,0.08)" }}>
                <p className="text-xs font-black" style={{ color: ev.edge >= 0 ? "#22c55e" : "#f87171" }}>
                  {ev.edge >= 0 ? "+" : ""}{Math.round(ev.edge * 100)}%
                </p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(19,35,58,0.45)" }}>Edge</p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Main BetDetail Page ────────────────────────────────────────────────────
export default function BetDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: bet, isLoading } = useQuery<Bet>({
    queryKey: ["/api/bets", id],
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/bets/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bets", id] });
      toast({ title: "Status Updated" });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!bet) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <p className="text-muted-foreground">Bet not found</p>
        <Link href="/bets">
          <a className="text-primary text-sm mt-2 inline-block hover:underline">← Back to all picks</a>
        </Link>
      </div>
    );
  }

  const score = bet.confidenceScore ?? 0;
  const impliedPct = bet.impliedProbability ? Math.round(bet.impliedProbability * 100) : null;
  const sport = bet.sport?.toUpperCase() ?? "NBA";
  const accent = SPORT_ACCENT[sport] ?? "#f59e0b";
  const isHigh = score >= 85;

  // Pick side
  const ts = bet.teamStats as { pickSide?: string; pickedOdds?: number; statType?: string } | null;
  const pickSide = ts?.pickSide?.toUpperCase() ?? null;
  const pickedOdds = ts?.pickedOdds;
  const oddsDisplay = pickedOdds != null ? (pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`) : null;
  const isOver = pickSide === "OVER";

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-8">
      {/* Back */}
      <Link href="/bets">
        <a className="flex items-center gap-2 text-sm hover:text-foreground transition-colors w-fit" style={{ color: "rgba(19,35,58,0.63)" }}>
          <ArrowLeft size={14} /> Back to all picks
        </a>
      </Link>

      {/* ── Hero Card ── */}
      <div className="rounded-2xl overflow-hidden relative"
        style={{ background: "linear-gradient(145deg, hsl(265 30% 10%), hsl(265 28% 12%))", border: `1px solid ${isHigh ? "rgba(245,158,11,0.4)" : "rgba(19,35,58,0.14)"}` }}>
        {/* Top accent strip */}
        <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${accent}, #a78bfa)` }} />

        {/* Pick banner */}
        {pickSide && (
          <div className={`flex items-center justify-between mx-4 mt-4 px-4 py-3 rounded-xl font-bold text-sm tracking-wide ${isOver ? "pick-over" : "pick-under"}`}>
            <span className="flex items-center gap-2">
              <span className="text-lg">{isOver ? "🔺" : "🔻"}</span>
              <span>{isOver ? "TAKE OVER" : "TAKE UNDER"}{bet.line !== null ? ` ${bet.line}` : ""}</span>
            </span>
            {oddsDisplay && <span className="font-mono">{oddsDisplay}</span>}
          </div>
        )}

        <div className="p-5">
          <div className="flex items-start gap-4">
            <ConfidenceRingLarge score={score} />
            <div className="flex-1 min-w-0 pt-1">
              <h1 className="text-lg font-black leading-tight mb-2" style={{ color: "hsl(45 100% 92%)" }}>
                {bet.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
              </h1>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <SourceBadge source={bet.source} />
                <SportBadge sport={bet.sport} />
                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-muted text-muted-foreground border border-border capitalize">
                  {bet.betType.replace("_", " ")}
                </span>
                {isHigh && (
                  <span className="px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wide"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
                    🔥 High Confidence
                  </span>
                )}
              </div>
              {bet.description && (
                <p className="text-xs leading-relaxed mb-3" style={{ color: "rgba(19,35,58,0.7)" }}>{bet.description}</p>
              )}
              <div className="flex flex-wrap gap-3 text-xs" style={{ color: "rgba(19,35,58,0.7)" }}>
                {bet.playerName && <span className="flex items-center gap-1"><User size={11} /> {bet.playerName}</span>}
                {bet.homeTeam && <span>{SPORT_EMOJI[sport] ?? "🏅"} {bet.awayTeam} @ {bet.homeTeam}</span>}
                {bet.gameTime && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {format(new Date(bet.gameTime), "MMM d, h:mm a")} · {formatDistanceToNow(new Date(bet.gameTime), { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Clubhouse IQ Analysis Panel ── */}
      <CIQAnalysisPanel bet={bet} />

      {/* ── Key Metrics Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Tile label="Confidence" value={`${score}/100`} color={score >= 85 ? "#4ade80" : score >= 70 ? "#fbbf24" : "#f87171"} accent={score >= 85} />
        <Tile label="Implied Prob" value={impliedPct !== null ? `${impliedPct}%` : "—"} color="#22d3ee" />
        <Tile label="Risk Level" value={bet.riskLevel ?? "—"} color={bet.riskLevel === "low" ? "#4ade80" : bet.riskLevel === "medium" ? "#fbbf24" : "#f87171"} />
        {bet.line !== null && <Tile label="Line" value={String(bet.line)} />}
        {bet.overOdds !== null && <Tile label="Over / Yes" value={formatOdds(bet.overOdds)} color="#4ade80" />}
        {bet.underOdds !== null && <Tile label="Under / No" value={formatOdds(bet.underOdds)} color="#60a5fa" />}
        {bet.yesPrice !== null && <Tile label="Yes Price" value={`${Math.round(bet.yesPrice * 100)}¢`} />}
      </div>

      {/* ── Odds Bar ── */}
      <OddsBar overOdds={bet.overOdds} underOdds={bet.underOdds} pickSide={pickSide ?? undefined} />

      {/* ── Confidence Score Breakdown ── */}
      <ConfidenceBreakdown
        score={score}
        keyFactors={bet.keyFactors}
        riskLevel={bet.riskLevel}
        impliedProbability={bet.impliedProbability}
      />

      {/* ── Line Movement ── */}
      <LineMovementPanel bet={bet} />

      {/* ── Live Game Score ── */}
      {(bet.homeTeam || bet.awayTeam || bet.sport) && <LiveGamePanel bet={bet} />}

      {/* ── Player Analytics ── */}
      {bet.playerName && <PlayerStatsSection bet={bet} />}

      {/* ── Research Summary ── */}
      {bet.researchSummary && (
        <div className="rounded-xl p-4" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={13} style={{ color: accent }} />
            <span className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.7)" }}>Analysis Summary</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(19,35,58,0.7)" }}>{bet.researchSummary}</p>
        </div>
      )}

      {/* ── Key Factors ── */}
      {bet.keyFactors && bet.keyFactors.length > 0 && (
        <KeyFactorsPanel factors={bet.keyFactors} />
      )}

      {/* ── Raw stats fallback (only if no player analytics shown) ── */}
      {!bet.playerName && bet.playerStats && Object.keys(bet.playerStats as object).length > 0 && (
        <RawStatsGrid data={bet.playerStats as Record<string, unknown>} title="Player Stats" />
      )}
      {bet.teamStats && (() => {
        const cleaned = Object.fromEntries(
          Object.entries(bet.teamStats as Record<string, unknown>)
            .filter(([k]) => !["pickside", "pickedodds", "stattype"].includes(k.toLowerCase()))
        );
        return Object.keys(cleaned).length > 0 ? <RawStatsGrid data={cleaned} title="Market Data" /> : null;
      })()}

      {/* ── Similar Bets ── */}
      <SimilarBets bet={bet} />

      {/* ── Track Result ── */}
      <div className="rounded-xl p-4" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.1)" }}>
        <p className="text-xs font-bold mb-3" style={{ color: "rgba(19,35,58,0.7)" }}>Track Result</p>
        <div className="flex flex-wrap gap-2.5">
          <button onClick={() => statusMutation.mutate("won")} disabled={statusMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}
            data-testid="button-mark-won">
            <CheckCircle size={14} /> Mark Won ✓
          </button>
          <button onClick={() => statusMutation.mutate("lost")} disabled={statusMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}
            data-testid="button-mark-lost">
            <XCircle size={14} /> Mark Lost ✗
          </button>
          <button onClick={() => statusMutation.mutate("open")} disabled={statusMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(19,35,58,0.07)", color: "rgba(19,35,58,0.7)", border: "1px solid rgba(19,35,58,0.14)" }}>
            Reset to Open
          </button>
        </div>
        {bet.status !== "open" && (
          <p className="text-xs mt-3 font-medium capitalize">
            Status: <span className={bet.status === "won" ? "text-green-400" : "text-red-400"}>{bet.status}</span>
          </p>
        )}
      </div>
    </div>
  );
}
