import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Clock, User, TrendingUp, CheckCircle, XCircle,
  Shield, AlertTriangle, Zap, BarChart2, ExternalLink,
  Loader2, Target, Activity, ChevronRight, Info, BookOpen
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

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
  const color = score >= 80 ? "#f59e0b" : score >= 65 ? "#22d3ee" : "#f87171";
  const label = score >= 80 ? "Strong" : score >= 65 ? "Moderate" : "Risky";
  return (
    <div className="relative flex-shrink-0 flex flex-col items-center gap-1" style={{ width: size, height: size + 20 }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={circ} strokeDashoffset={circ - fill} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ filter: `drop-shadow(0 0 8px ${color}88)`, transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black font-mono leading-none" style={{ color }}>{score}</span>
          <span className="text-[10px] font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>/100</span>
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
      background: accent ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.04)",
      border: `1px solid ${accent ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.08)"}`,
    }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</p>
      <p className="text-lg font-black font-mono leading-none" style={{ color: color ?? "hsl(45 100% 90%)" }}>{value}</p>
      {sub && <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{sub}</p>}
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
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Market Odds Split</span>
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
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>OVER · {overProb.toFixed(0)}%</div>
        </div>
        {/* Bar */}
        <div className="flex-[2] h-4 rounded-full overflow-hidden flex" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full rounded-l-full transition-all duration-700"
            style={{ width: `${overPct}%`, background: isPickOver ? "linear-gradient(90deg,#4ade80,#22c55e)" : "rgba(255,255,255,0.2)" }} />
          <div className="h-full rounded-r-full transition-all duration-700"
            style={{ width: `${100 - overPct}%`, background: isPickUnder ? "linear-gradient(90deg,#60a5fa,#3b82f6)" : "rgba(255,255,255,0.1)" }} />
        </div>
        {/* Under side */}
        <div className="flex-1 text-center">
          <div className="text-sm font-black font-mono" style={{ color: isPickUnder ? "#60a5fa" : "hsl(45 100% 90%)" }}>
            {formatOdds(underOdds)}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>UNDER · {underProb.toFixed(0)}%</div>
        </div>
      </div>
      <p className="text-[10px] text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
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
    what: "PropEdge's core probability model score. Based on historical hit rates for this bet type, sport, and line relative to the player's average output.",
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
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Activity size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Score Breakdown</span>
        <span className="ml-auto text-xs font-black font-mono" style={{ color: "#f59e0b" }}>{score}/100</span>
      </div>

      {/* Bars */}
      <div className="space-y-2.5">
        {bars.map((bar) => {
          const desc = SCORE_DESCRIPTIONS[bar.label];
          const isOpen = expandedBar === bar.label;
          const pct = (bar.value / bar.max) * 100;
          const grade = pct >= 80 ? "Excellent" : pct >= 60 ? "Good" : pct >= 40 ? "Fair" : "Low";
          const gradeColor = pct >= 80 ? "#4ade80" : pct >= 60 ? "#f59e0b" : pct >= 40 ? "#fb923c" : "rgba(255,255,255,0.35)";

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
                    <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>{bar.label}</span>
                    <Info size={9} style={{ color: "rgba(255,255,255,0.25)" }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-semibold" style={{ color: gradeColor }}>{grade}</span>
                    <span className="text-[10px] font-mono font-bold" style={{ color: bar.color }}>{bar.value}/{bar.max}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: bar.color, boxShadow: `0 0 6px ${bar.color}66` }}
                  />
                </div>
              </button>

              {/* Expanded explanation */}
              {isOpen && desc && (
                <div className="mt-2 p-3 rounded-lg space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${bar.color}30` }}>
                  <div className="flex items-start gap-2">
                    <BookOpen size={10} className="flex-shrink-0 mt-0.5" style={{ color: bar.color }} />
                    <div className="space-y-1.5">
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                        <span className="font-bold" style={{ color: bar.color }}>What it measures: </span>
                        {desc.what}
                      </p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                        <span className="font-semibold" style={{ color: "#4ade80" }}>High score: </span>
                        {desc.high}
                      </p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                        <span className="font-semibold" style={{ color: "#fb923c" }}>Low score: </span>
                        {desc.low}
                      </p>
                      <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
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
      <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.2)" }}>
        Tap any category to learn what it means &nbsp;·&nbsp; Total max: 100 pts
      </p>
    </div>
  );
}


// ── Key Factors Panel ─────────────────────────────────────────────────────
function KeyFactorsPanel({ factors }: { factors: string[] }) {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2">
        <Target size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Key Factors ({factors.length})</span>
      </div>
      <div className="space-y-2">
        {factors.map((factor, i) => {
          const isPositive = !factor.toLowerCase().includes("risk") && !factor.toLowerCase().includes("concern") && !factor.toLowerCase().includes("low");
          const isCaution = factor.toLowerCase().includes("moderate") || factor.toLowerCase().includes("watch") || factor.toLowerCase().includes("volatile");
          return (
            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg"
              style={{ background: isPositive && !isCaution ? "rgba(74,222,128,0.05)" : isCaution ? "rgba(251,191,36,0.05)" : "rgba(255,255,255,0.03)", border: `1px solid ${isPositive && !isCaution ? "rgba(74,222,128,0.15)" : isCaution ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.06)"}` }}>
              <span className="flex-shrink-0 mt-0.5">
                {isPositive && !isCaution ? <CheckCircle size={12} color="#4ade80" /> : isCaution ? <AlertTriangle size={12} color="#fbbf24" /> : <Info size={12} color="rgba(255,255,255,0.35)" />}
              </span>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>{factor}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mini Bar (for game log) ────────────────────────────────────────────────
function MiniBarChart({ games, statKey, propLine, label }: { games: any[]; statKey: string; propLine?: number | null; label: string }) {
  if (!games.length) return null;
  const values = games.map((g) => parseFloat(g[statKey]) || 0);
  const max = Math.max(...values, propLine ?? 0, 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>{label} — Last {games.length} Games</span>
        {propLine != null && <span className="text-[10px] font-mono font-bold" style={{ color: "#f59e0b" }}>Line: {propLine}</span>}
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 52 }}>
        {values.map((v, i) => {
          const pct = (v / max) * 100;
          const hitLine = propLine != null && v >= propLine;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
              <span className="text-[9px] font-mono font-bold leading-none" style={{ color: hitLine ? "#4ade80" : "rgba(255,255,255,0.5)" }}>{v || "—"}</span>
              <div className="w-full rounded-t-sm transition-all duration-500"
                style={{ height: `${Math.max(pct, 4)}%`, background: hitLine ? "linear-gradient(0deg,#4ade80,#22d3ee)" : "linear-gradient(0deg,#f59e0b,#fbbf24)", opacity: 0.85, minHeight: 4 }} />
            </div>
          );
        })}
      </div>
      {/* Game labels */}
      <div className="flex items-center gap-1.5">
        {games.map((g, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.25)" }}>
              {g.opp_id || g.opp || `G${i + 1}`}
            </span>
          </div>
        ))}
      </div>
      {propLine != null && (
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 rounded" style={{ background: "#f59e0b" }} />
          <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>Prop line ({propLine})</span>
          <div className="w-2 h-2 rounded-sm ml-2" style={{ background: "rgba(74,222,128,0.4)" }} />
          <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>Hit</span>
        </div>
      )}
    </div>
  );
}

// ── Game Log Table — last N games with all stats, bet stat highlighted ──────
function GameLogTable({ games, sport, focusStatKey, focusStatLabel, propLine }: {
  games: any[];
  sport: string;
  focusStatKey: string;
  focusStatLabel: string;
  propLine?: number | null;
}) {
  if (!games.length) return null;

  // Define columns per sport — focus stat always shown prominently
  const nbaCols = [
    { key: "date_game", label: "Date", mono: false },
    { key: "opp_id", label: "OPP", mono: false },
    { key: "result", label: "Result", mono: false },
    { key: "pts", label: "PTS" },
    { key: "trb", label: "REB" },
    { key: "ast", label: "AST" },
    { key: "stl", label: "STL" },
    { key: "blk", label: "BLK" },
    { key: "tov", label: "TOV" },
    { key: "mp", label: "MIN" },
  ];

  const nflCols = [
    { key: "date_game", label: "Date", mono: false },
    { key: "opp_id", label: "OPP", mono: false },
    { key: "result", label: "Result", mono: false },
    { key: "yds", label: "YDS" },
    { key: "td", label: "TD" },
    { key: "int", label: "INT" },
    { key: "att", label: "ATT" },
    { key: "rec", label: "REC" },
    { key: "car", label: "CAR" },
  ];

  const nhlCols = [
    { key: "date_game", label: "Date", mono: false },
    { key: "opp_id", label: "OPP", mono: false },
    { key: "result", label: "Result", mono: false },
    { key: "goals", label: "G" },
    { key: "ast", label: "A" },
    { key: "pts", label: "PTS" },
    { key: "shots", label: "SOG" },
    { key: "plusMinus", label: "+/-" },
    { key: "toi", label: "TOI" },
  ];

  const mlbCols = [
    { key: "date_game", label: "Date", mono: false },
    { key: "opp_id", label: "OPP", mono: false },
    { key: "result", label: "Result", mono: false },
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
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
          Game Log — Last {games.length} Games
        </span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
          ★ {focusStatLabel} highlighted
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {cols.map(col => {
                const isFocus = col.key === focusStatKey || (focusStatKey === "trb" && col.key === "trb") || (focusStatKey === "reb" && col.key === "trb");
                return (
                  <th key={col.key} className="px-2 py-2 text-center font-bold uppercase tracking-wide"
                    style={{
                      color: isFocus ? "#f59e0b" : "rgba(255,255,255,0.35)",
                      background: isFocus ? "rgba(245,158,11,0.06)" : "transparent",
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
              const focusVal = parseFloat(g[focusStatKey] ?? g["trb"] ?? "0") || 0;
              const hitLine = propLine != null && focusVal >= propLine;
              const rowBg = hitLine ? "rgba(74,222,128,0.04)" : rowIdx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent";
              return (
                <tr key={rowIdx} style={{ background: rowBg, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {cols.map(col => {
                    const isFocus = col.key === focusStatKey || (focusStatKey === "trb" && col.key === "trb") || (focusStatKey === "reb" && col.key === "trb");
                    const rawVal = g[col.key] ?? "—";
                    const numVal = parseFloat(rawVal) || 0;
                    const cellHit = isFocus && propLine != null && numVal >= propLine;
                    const cellMiss = isFocus && propLine != null && numVal < propLine && rawVal !== "—" && rawVal !== "";
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
                        <span style={{ color: isWin ? "#4ade80" : isLoss ? "#f87171" : "rgba(255,255,255,0.45)", fontWeight: isWin || isLoss ? 700 : 400, fontSize: "10px" }}>
                          {rawVal || "—"}
                        </span>
                      );
                    }
                    return (
                      <td key={col.key} className="px-2 py-2 text-center font-mono"
                        style={{
                          background: isFocus ? (cellHit ? "rgba(74,222,128,0.1)" : cellMiss ? "rgba(248,113,113,0.08)" : "rgba(245,158,11,0.04)") : "transparent",
                          color: isFocus
                            ? (cellHit ? "#4ade80" : cellMiss ? "#f87171" : "#f59e0b")
                            : col.key === "date_game" || col.key === "opp_id" || col.key === "opp"
                              ? "rgba(255,255,255,0.4)"
                              : col.key === "result" ? "transparent" : "rgba(255,255,255,0.7)",
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
            <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>Hit ≥ {propLine}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(248,113,113,0.3)" }} />
            <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>Miss &lt; {propLine}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(245,158,11,0.3)" }} />
            <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>Focus stat column</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Season Stat vs Line Bar ────────────────────────────────────────────────
function StatVsLine({ statLabel, statValue, propLine }: { statLabel: string; statValue: number; propLine: number }) {
  const pct = Math.min((statValue / propLine) * 100, 150);
  const hitLine = statValue >= propLine;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span style={{ color: "rgba(255,255,255,0.5)" }}>{statLabel} avg</span>
        <span className="font-mono font-bold" style={{ color: hitLine ? "#4ade80" : "#f59e0b" }}>{statValue} vs {propLine} line</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: hitLine ? "linear-gradient(90deg,#4ade80,#22c55e)" : "linear-gradient(90deg,#f59e0b,#fbbf24)" }} />
        {/* Line marker */}
        <div className="absolute top-0 bottom-0 w-0.5" style={{ left: "66.7%", background: "rgba(255,255,255,0.5)" }} />
      </div>
      <p className="text-[9px] text-right" style={{ color: hitLine ? "#4ade80" : "rgba(255,255,255,0.3)" }}>
        {hitLine ? `✓ Avg is ${(statValue - propLine).toFixed(1)} above line` : `${(propLine - statValue).toFixed(1)} below line — under lean`}
      </p>
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

  // Get relevant stat key for the bet
  const getStatKey = () => {
    const title = (bet.title + " " + (bet.description ?? "")).toLowerCase();
    if (sport === "NBA") {
      if (title.includes("point") || title.includes("pts")) return { key: "pts", label: "Points" };
      if (title.includes("assist") || title.includes("ast")) return { key: "ast", label: "Assists" };
      if (title.includes("rebound") || title.includes("reb")) return { key: "trb", label: "Rebounds" };
      if (title.includes("steal") || title.includes("stl")) return { key: "stl", label: "Steals" };
      if (title.includes("block") || title.includes("blk")) return { key: "blk", label: "Blocks" };
      return { key: "pts", label: "Points" };
    }
    if (sport === "NFL") {
      if (title.includes("passing yard")) return { key: "pass_yds", label: "Pass Yds" };
      if (title.includes("rushing")) return { key: "rush_yds", label: "Rush Yds" };
      if (title.includes("receiving")) return { key: "rec_yds", label: "Rec Yds" };
      if (title.includes("td") || title.includes("touchdown")) return { key: "pass_td", label: "TDs" };
      return { key: "pass_yds", label: "Pass Yds" };
    }
    return { key: "pts", label: "Points" };
  };
  const statKey = getStatKey();

  if (!bet.playerName) return null;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <BarChart2 size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Player Analytics</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
          👤 {bet.playerName}
        </span>
        {data?.bbrUrl && (
          <a href={data.bbrUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border hover:bg-white/5 transition-colors"
            style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.25)" }}>
            <ExternalLink size={9} /> BBR
          </a>
        )}
      </div>

      <div className="p-4 space-y-5">
        {!canFetch && (
          <div className="text-center py-4 space-y-2">
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>📊 Live stat lookup available for NBA & NFL</p>
            {/* Show any stored playerStats from the bet record */}
            {bet.playerStats && Object.keys(bet.playerStats as object).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-left">
                {Object.entries(bet.playerStats as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                  <div key={k} className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>{k.replace(/_/g, " ")}</p>
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
          <div className="flex items-center justify-center gap-2 py-6 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            <Loader2 size={14} className="animate-spin" />
            Fetching live stats for {bet.playerName}...
          </div>
        )}

        {canFetch && !isLoading && data && (
          <>
            {/* Season averages grid */}
            {data.season && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {data.seasonLabel ?? "2024-25 Season Averages"}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {sport === "NBA" && [
                    { k: "pts", l: "PTS" }, { k: "reb", l: "REB" }, { k: "ast", l: "AST" },
                    { k: "stl", l: "STL" }, { k: "blk", l: "BLK" }, { k: "fg_pct", l: "FG%" },
                    { k: "fg3_pct", l: "3P%" }, { k: "mpg", l: "MPG" },
                  ].map(({ k, l }) => {
                    const val = data.season[k] ?? "—";
                    const isRelevant = statKey.key === k || (statKey.key === "trb" && k === "reb");
                    return (
                      <div key={k} className="text-center py-2 px-1 rounded-lg"
                        style={{ background: isRelevant ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${isRelevant ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.07)"}` }}>
                        <p className="text-base font-black font-mono leading-none" style={{ color: isRelevant ? "#f59e0b" : "hsl(45 100% 90%)" }}>{val}</p>
                        <p className="text-[9px] mt-1 font-semibold uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>{l}</p>
                      </div>
                    );
                  })}
                  {sport === "NFL" && Object.entries(data.season ?? {}).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="text-center py-2 px-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <p className="text-base font-black font-mono leading-none" style={{ color: "hsl(45 100% 90%)" }}>{String(v || "—")}</p>
                      <p className="text-[9px] mt-1 font-semibold uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>{k.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stat vs Prop Line comparison */}
            {bet.line != null && data.season && (() => {
              const statVal = parseFloat(data.season[statKey.key] ?? "0");
              if (!isNaN(statVal) && statVal > 0) {
                return (
                  <div className="pt-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Season Avg vs Prop Line
                    </p>
                    <StatVsLine statLabel={statKey.label} statValue={statVal} propLine={bet.line} />
                  </div>
                );
              }
              return null;
            })()}

            {/* Last 5 games bar chart + full game log table */}
            {data.recentGames && data.recentGames.length > 0 && (
              <div className="pt-1 space-y-4">
                <MiniBarChart
                  games={data.recentGames}
                  statKey={statKey.key === "reb" ? "trb" : statKey.key}
                  propLine={bet.line}
                  label={statKey.label}
                />
                <GameLogTable
                  games={data.recentGames}
                  sport={sport}
                  focusStatKey={statKey.key === "reb" ? "trb" : statKey.key}
                  focusStatLabel={statKey.label}
                  propLine={bet.line}
                />
              </div>
            )}

            {/* Recent form summary */}
            {data.recentGames && data.recentGames.length > 0 && bet.line != null && (() => {
              const hits = data.recentGames.filter((g: any) => (parseFloat(g[statKey.key === "reb" ? "trb" : statKey.key]) || 0) >= bet.line!).length;
              const total = data.recentGames.length;
              const hitRate = Math.round((hits / total) * 100);
              return (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ background: hitRate >= 60 ? "rgba(74,222,128,0.08)" : hitRate >= 40 ? "rgba(251,191,36,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${hitRate >= 60 ? "rgba(74,222,128,0.2)" : hitRate >= 40 ? "rgba(251,191,36,0.2)" : "rgba(248,113,113,0.2)"}` }}>
                  <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>Recent hit rate vs {bet.line} line</span>
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
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Stats not available for this player right now.</p>
            {/* Show stored playerStats fallback */}
            {bet.playerStats && Object.keys(bet.playerStats as object).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-left">
                {Object.entries(bet.playerStats as Record<string, unknown>).filter(([, v]) => v !== null).map(([k, v]) => (
                  <div key={k} className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>{k.replace(/_/g, " ")}</p>
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
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <TrendingUp size={13} style={{ color: accent }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Similar Bets</span>
        <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>{similar.length}</span>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        {similar.map((b) => {
          const conf = b.confidenceScore ?? 0;
          const confColor = conf >= 80 ? "#4ade80" : conf >= 65 ? "#fbbf24" : "#f87171";
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
                    <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>👤 {b.playerName}</p>
                  )}
                </div>
                <ChevronRight size={13} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
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
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2">
        <BookOpen size={13} style={{ color: "#a78bfa" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>{title}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="p-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>{k.replace(/_/g, " ")}</p>
            <p className="text-sm font-mono font-semibold" style={{ color: "hsl(45 100% 90%)" }}>
              {Array.isArray(v) ? v.join(", ") : String(v)}
            </p>
          </div>
        ))}
      </div>
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
  const isHigh = score >= 80;

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
        <a className="flex items-center gap-2 text-sm hover:text-foreground transition-colors w-fit" style={{ color: "rgba(255,255,255,0.45)" }}>
          <ArrowLeft size={14} /> Back to all picks
        </a>
      </Link>

      {/* ── Hero Card ── */}
      <div className="rounded-2xl overflow-hidden relative"
        style={{ background: "linear-gradient(145deg, hsl(265 30% 10%), hsl(265 28% 12%))", border: `1px solid ${isHigh ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.1)"}` }}>
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
                <p className="text-xs leading-relaxed mb-3" style={{ color: "rgba(255,255,255,0.55)" }}>{bet.description}</p>
              )}
              <div className="flex flex-wrap gap-3 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
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

      {/* ── Key Metrics Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Tile label="Confidence" value={`${score}/100`} color={score >= 80 ? "#4ade80" : score >= 65 ? "#fbbf24" : "#f87171"} accent={score >= 80} />
        <Tile label="Implied Prob" value={impliedPct !== null ? `${impliedPct}%` : "—"} color="#22d3ee" />
        <Tile label="Risk Level" value={bet.riskLevel ?? "—"} color={bet.riskLevel === "low" ? "#4ade80" : bet.riskLevel === "medium" ? "#fbbf24" : "#f87171"} />
        <Tile label="Allocation" value={bet.recommendedAllocation ? `${bet.recommendedAllocation}%` : "—"} color="#a78bfa" />
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

      {/* ── Player Analytics ── */}
      {bet.playerName && <PlayerStatsSection bet={bet} />}

      {/* ── Research Summary ── */}
      {bet.researchSummary && (
        <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={13} style={{ color: accent }} />
            <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Analysis Summary</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>{bet.researchSummary}</p>
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
      <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-xs font-bold mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>Track Result</p>
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
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
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
