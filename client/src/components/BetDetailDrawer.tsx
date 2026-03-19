import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  TrendingUp, CheckCircle, AlertTriangle, BarChart2, ExternalLink,
  Loader2, Target, Activity, ChevronRight, Info, X, BookOpen
} from "lucide-react";
import { Drawer, DrawerContent, DrawerClose } from "@/components/ui/drawer";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

// ── Helpers ────────────────────────────────────────────────────────────────
function formatOdds(odds: number | null): string {
  if (odds === null) return "—";
  return odds > 0 ? `+${odds}` : String(odds);
}
function impliedProb(odds: number | null): number {
  if (odds === null) return 0;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}
const SPORT_ACCENT: Record<string, string> = {
  NBA: "#fb923c", NFL: "#f87171", MLB: "#60a5fa", NHL: "#22d3ee",
};

// ── Odds Bar ──────────────────────────────────────────────────────────────
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
        <div className="flex-1 text-center">
          <div className="text-sm font-black font-mono" style={{ color: isPickOver ? "#4ade80" : "hsl(45 100% 90%)" }}>{formatOdds(overOdds)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>OVER · {overProb.toFixed(0)}%</div>
        </div>
        <div className="flex-[2] h-4 rounded-full overflow-hidden flex" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full rounded-l-full" style={{ width: `${overPct}%`, background: isPickOver ? "linear-gradient(90deg,#4ade80,#22c55e)" : "rgba(255,255,255,0.2)" }} />
          <div className="h-full rounded-r-full" style={{ width: `${100 - overPct}%`, background: isPickUnder ? "linear-gradient(90deg,#60a5fa,#3b82f6)" : "rgba(255,255,255,0.1)" }} />
        </div>
        <div className="flex-1 text-center">
          <div className="text-sm font-black font-mono" style={{ color: isPickUnder ? "#60a5fa" : "hsl(45 100% 90%)" }}>{formatOdds(underOdds)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>UNDER · {underProb.toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}

// ── Confidence Breakdown ──────────────────────────────────────────────────
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
    { label: "Market Edge",   value: scaled[0], max: 30, color: "#22d3ee" },
    { label: "Analytics",     value: scaled[1], max: 25, color: "#a78bfa" },
    { label: "Base Model",    value: scaled[2], max: 30, color: "#f59e0b" },
    { label: "Source Quality",value: scaled[3], max: 15, color: "#4ade80" },
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


// ── Key Factors ───────────────────────────────────────────────────────────
function KeyFactorsPanel({ factors }: { factors: string[] }) {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2">
        <Target size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Key Factors ({factors.length})</span>
      </div>
      <div className="space-y-2">
        {factors.map((factor, i) => {
          const isPositive = !factor.toLowerCase().includes("risk") && !factor.toLowerCase().includes("concern");
          const isCaution = factor.toLowerCase().includes("moderate") || factor.toLowerCase().includes("watch");
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

// ── Game Log Table ────────────────────────────────────────────────────────
function GameLogTable({ games, sport, focusStatKey, focusStatLabel, propLine, comboKeys }: {
  games: any[]; sport: string; focusStatKey: string; focusStatLabel: string; propLine?: number | null; comboKeys?: string[];
}) {
  if (!games.length) return null;
  // For combo props, inject a synthetic "_combo" column showing the summed value
  const isCombo = focusStatKey === "_combo" && !!comboKeys?.length;
  const comboColLabel = focusStatLabel; // e.g. "Pts+Reb+Ast"
  const nbaCols = [
    { key: "date_game", label: "Date" }, { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "pts", label: "PTS" }, { key: "trb", label: "REB" }, { key: "ast", label: "AST" },
    { key: "stl", label: "STL" }, { key: "blk", label: "BLK" }, { key: "tov", label: "TOV" }, { key: "mp", label: "MIN" },
  ];
  const nflCols = [
    { key: "date_game", label: "Date" }, { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "yds", label: "YDS" }, { key: "td", label: "TD" }, { key: "int", label: "INT" },
    { key: "att", label: "ATT" }, { key: "rec", label: "REC" }, { key: "car", label: "CAR" },
  ];
  const nhlCols = [
    { key: "date_game", label: "Date" }, { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "goals", label: "G" }, { key: "ast", label: "A" }, { key: "pts", label: "PTS" },
    { key: "shots", label: "SOG" }, { key: "plusMinus", label: "+/-" }, { key: "toi", label: "TOI" },
  ];
  const mlbCols = [
    { key: "date_game", label: "Date" }, { key: "opp_id", label: "OPP" },
    { key: "result", label: "Result" },
    ...(isCombo ? [{ key: "_combo", label: comboColLabel }] : []),
    { key: "ab", label: "AB" }, { key: "hits", label: "H" }, { key: "home_runs", label: "HR" },
    { key: "rbi", label: "RBI" }, { key: "runs", label: "R" }, { key: "avg", label: "AVG" },
  ];
  const sportUp = sport?.toUpperCase();
  const cols = sportUp === "NFL" ? nflCols : sportUp === "NHL" ? nhlCols : sportUp === "MLB" ? mlbCols : nbaCols;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
          Last {games.length} Games
        </span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
          ★ {focusStatLabel}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {cols.map(col => {
                const isFocus = col.key === focusStatKey ||
                  (focusStatKey === "trb" && col.key === "trb") ||
                  (focusStatKey === "reb" && col.key === "trb") ||
                  (isCombo && comboKeys?.includes(col.key)) ||
                  (isCombo && col.key === "trb" && comboKeys?.includes("trb"));
                return (
                  <th key={col.key} className="px-2 py-2 text-center font-bold uppercase"
                    style={{ color: isFocus ? "#f59e0b" : "rgba(255,255,255,0.35)", background: isFocus ? "rgba(245,158,11,0.06)" : "transparent", fontSize: "9px", whiteSpace: "nowrap" }}>
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
              const hitLine = propLine != null && focusVal >= propLine;
              return (
                <tr key={rowIdx} style={{ background: hitLine ? "rgba(74,222,128,0.04)" : rowIdx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {cols.map(col => {
                    const isFocus = col.key === focusStatKey ||
                      (focusStatKey === "trb" && col.key === "trb") ||
                      (focusStatKey === "reb" && col.key === "trb") ||
                      (isCombo && comboKeys?.includes(col.key)) ||
                      (isCombo && col.key === "trb" && comboKeys?.includes("trb"));
                    const isComboSummary = col.key === "_combo";
                    const rawRaw = g[col.key];
                    const rawVal: string = rawRaw != null ? String(rawRaw) : "—";
                    const numVal = parseFloat(rawVal) || 0;
                    const cellHit = isFocus && propLine != null && numVal >= propLine;
                    const cellMiss = isFocus && propLine != null && numVal < propLine && rawVal !== "—" && rawVal !== "";
                    let displayVal: string | JSX.Element = rawVal || "—";
                    if (col.key === "date_game" && rawVal.length >= 7) {
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
                          color: isFocus ? (cellHit ? "#4ade80" : cellMiss ? "#f87171" : "#f59e0b") : col.key === "date_game" || col.key === "opp_id" || col.key === "opp" ? "rgba(255,255,255,0.4)" : col.key === "result" ? "transparent" : "rgba(255,255,255,0.7)",
                          fontWeight: isFocus ? "900" : "500",
                          fontSize: isFocus ? "12px" : "11px",
                          whiteSpace: col.key === "result" ? "nowrap" : "nowrap",
                        }}>
                        {isFocus && cellHit && "✓ "}{isFocus && cellMiss && "✗ "}{displayVal}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
        </div>
      )}
    </div>
  );
}

// ── Mini Bar Chart ────────────────────────────────────────────────────────
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
              <div className="w-full rounded-t-sm" style={{ height: `${Math.max(pct, 4)}%`, background: hitLine ? "linear-gradient(0deg,#4ade80,#22d3ee)" : "linear-gradient(0deg,#f59e0b,#fbbf24)", opacity: 0.85, minHeight: 4 }} />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        {games.map((g, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.25)" }}>{g.opp_id || g.opp || `G${i + 1}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat vs Line ──────────────────────────────────────────────────────────
function StatVsLine({ statLabel, statValue, propLine, isL5 }: { statLabel: string; statValue: number; propLine: number; isL5?: boolean }) {
  const pct = Math.min((statValue / propLine) * 100, 150);
  const hitLine = statValue >= propLine;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span style={{ color: "rgba(255,255,255,0.5)" }}>{statLabel} {isL5 ? "L5 avg" : "season avg"}</span>
        <span className="font-mono font-bold" style={{ color: hitLine ? "#4ade80" : "#f59e0b" }}>{statValue} vs {propLine} line</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: hitLine ? "linear-gradient(90deg,#4ade80,#22c55e)" : "linear-gradient(90deg,#f59e0b,#fbbf24)" }} />
        <div className="absolute top-0 bottom-0 w-0.5" style={{ left: "66.7%", background: "rgba(255,255,255,0.5)" }} />
      </div>
      <p className="text-[9px] text-right" style={{ color: hitLine ? "#4ade80" : "rgba(255,255,255,0.3)" }}>
        {hitLine ? `✓ Avg ${(statValue - propLine).toFixed(1)} above line` : `${(propLine - statValue).toFixed(1)} below line — under lean`}
      </p>
    </div>
  );
}

// ── Player Stats Section ──────────────────────────────────────────────────
function PlayerStatsSection({ bet }: { bet: Bet }) {
  const sport = bet.sport?.toUpperCase() ?? "";
  const canFetch = !!bet.playerName && (sport === "NBA" || sport === "NFL" || sport === "MLB" || sport === "NHL");

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/player-stats", sport, bet.playerName],
    queryFn: () =>
      apiRequest("GET", `/api/player-stats/${sport}/${encodeURIComponent(bet.playerName!)}`)
        .then(r => r.json()),
    enabled: canFetch,
    // 30-min stale time so stats stay cached while drawer opens/closes
    staleTime: 30 * 60 * 1000,
    // Keep data in cache for 1 hour
    gcTime: 60 * 60 * 1000,
    // Retry once on failure — network hiccups on mobile
    retry: 1,
    retryDelay: 1500,
  });

  // Maps raw stat keys (from teamStats.statRaw or title parsing) to display config.
  // comboKeys: game-log keys to SUM (e.g. ["pts","trb","ast"])
  // seasonKeys: season object keys to SUM (season uses "reb" not "trb")
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
    // period combo variants
    period_1_pts_rebs_asts:   { key: "pra", label: "1Q Pts+Reb+Ast", isCombo: true, comboKeys: ["pts","trb","ast"], seasonKeys: ["pts","reb","ast"] },
    period_1_2_pts_rebs_asts: { key: "pra", label: "1H Pts+Reb+Ast", isCombo: true, comboKeys: ["pts","trb","ast"], seasonKeys: ["pts","reb","ast"] },
    // NBA blks+stls combo
    blks_stls:             { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    "blks + stls":         { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    "blocks + steals":     { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    "blocks+steals":       { key: "bs",  label: "Blk+Stl",     isCombo: true, comboKeys: ["blk","stl"],       seasonKeys: ["blk","stl"] },
    // MLB hits+runs+rbis combo
    hits_runs_rbis:        { key: "hrr", label: "H+R+RBI",      isCombo: true, comboKeys: ["hits","runs","rbi"], seasonKeys: ["hits","runs","rbi"] },
    "hits + runs + rbis":  { key: "hrr", label: "H+R+RBI",      isCombo: true, comboKeys: ["hits","runs","rbi"], seasonKeys: ["hits","runs","rbi"] },
    "hits+runs+rbis":      { key: "hrr", label: "H+R+RBI",      isCombo: true, comboKeys: ["hits","runs","rbi"], seasonKeys: ["hits","runs","rbi"] },
    // NHL combo: goals+assists variants
    "goals + assists":     { key: "ga",  label: "Goals+Ast",  isCombo: true, comboKeys: ["goals","ast"], seasonKeys: ["goals","ast"] },
    "goals+assists":       { key: "ga",  label: "Goals+Ast",  isCombo: true, comboKeys: ["goals","ast"], seasonKeys: ["goals","ast"] },
    // NHL "points" prop = goals + assists (G+A)
    "nhl_points":          { key: "ga",  label: "Goals+Ast",  isCombo: true, comboKeys: ["goals","ast"], seasonKeys: ["goals","ast"] },
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
    goals:         { key: "goals",         label: "Goals" },
    shots:         { key: "shots",         label: "Shots" },
    saves:         { key: "saves",         label: "Saves" },
    blocked_shots: { key: "blocked_shots", label: "Blocks" },
    faceoffs_won:  { key: "faceoffs_won",  label: "FOW" },
    plus_minus:    { key: "plusMinus",     label: "+/-" },
    // MLB
    hits:         { key: "hits",       label: "Hits" },
    home_runs:    { key: "home_runs",   label: "Home Runs" },
    rbi:          { key: "rbi",         label: "RBIs" },
    rbis:         { key: "rbi",         label: "RBIs" },
    runs:         { key: "runs",        label: "Runs" },
    strikeouts:   { key: "strikeouts",  label: "Strikeouts" },
    stolen_bases: { key: "stolen_bases",label: "SB" },
    total_bases:  { key: "hits",        label: "Total Bases" }, // ESPN proxy
    pitch_outs:   { key: "strikeouts",  label: "Pitch Outs" }, // proxy
    // NFL
    passing_yards:   { key: "yds", label: "Pass Yds" },
    rushing_yards:   { key: "yds", label: "Rush Yds" },
    receiving_yards: { key: "yds", label: "Rec Yds" },
    receptions:      { key: "rec", label: "Receptions" },
    touchdowns:      { key: "td",  label: "Touchdowns" },
  };

  const getStatKey = (): StatKeyResult => {
    // 1. Use raw stat key from teamStats (most reliable — set directly by scanner)
    const ts = bet.teamStats as any;
    const rawStatKey = (ts?.statRaw ?? "").toLowerCase().trim();

    // Sport-aware overrides: same key name means different things across sports
    // NHL "points" = goals+assists (G+A combo), NOT NBA points
    if (rawStatKey === "points" && sport === "NHL") return STAT_RAW_MAP["nhl_points"]!;
    // MLB "rbis" → same as "rbi"
    if (rawStatKey === "rbis" && sport === "MLB") return STAT_RAW_MAP["rbis"]!;

    if (rawStatKey && STAT_RAW_MAP[rawStatKey]) return STAT_RAW_MAP[rawStatKey];

    // 2. Use display statType from teamStats (e.g. "Pts + Rebs + Asts")
    const statType = (ts?.statType ?? "").toLowerCase().trim();
    // Sport-aware: NHL "points" display_stat = G+A
    if (statType === "points" && sport === "NHL") return STAT_RAW_MAP["nhl_points"]!;
    if (statType && STAT_RAW_MAP[statType]) return STAT_RAW_MAP[statType];

    // 3. Fallback: parse title/description (covers Kalshi and other sources)
    const title = (bet.title + " " + (bet.description ?? "")).toLowerCase();
    if (sport === "NBA") {
      // Combo patterns — must match BEFORE single-stat patterns
      const hasPRA     = title.includes("pts + rebs + asts") || title.includes("pts+rebs+asts") || title.includes("pts_rebs_asts") || title.includes("pra");
      const hasPR      = !hasPRA && (title.includes("pts + rebs") || title.includes("pts+rebs") || title.includes("pts_rebs") || title.includes("points + rebounds"));
      const hasPA      = !hasPRA && !hasPR && (title.includes("pts + asts") || title.includes("pts+asts") || title.includes("pts_asts") || title.includes("points + assists"));
      const hasRA      = !hasPRA && !hasPR && !hasPA && (title.includes("rebs + asts") || title.includes("rebs+asts") || title.includes("rebs_asts") || title.includes("rebounds + assists"));
      // blocks+steals must check for BOTH to avoid matching single-stat titles
      const hasBS      = !hasPRA && !hasPR && !hasPA && !hasRA &&
                         (title.includes("blks_stls") || title.includes("blks + stls") || title.includes("blks+stls") ||
                          (title.includes("block") && title.includes("steal")));
      if (hasPRA) return STAT_RAW_MAP["pts_rebs_asts"]!;
      if (hasPR)  return STAT_RAW_MAP["pts_rebs"]!;
      if (hasPA)  return STAT_RAW_MAP["pts_asts"]!;
      if (hasRA)  return STAT_RAW_MAP["rebs_asts"]!;
      if (hasBS)  return STAT_RAW_MAP["blks_stls"]!;
      // Single stats
      if (title.includes("rebound")) return STAT_RAW_MAP["rebounds"]!;
      if (title.includes("assist"))  return STAT_RAW_MAP["assists"]!;
      if (title.includes("point") || title.includes("pts")) return STAT_RAW_MAP["points"]!;
      if (title.includes("steal"))   return STAT_RAW_MAP["steals"]!;
      if (title.includes("block"))   return STAT_RAW_MAP["blocks"]!;
      if (title.includes("three") || title.includes("3pt") || title.includes("3-point")) return STAT_RAW_MAP["threes"]!;
      return STAT_RAW_MAP["points"]!;
    }
    if (sport === "NHL") {
      // G+A combo — check before single "goal" or "assist" patterns
      if (title.includes("goals+assists") || title.includes("goals + assists") ||
          (title.includes("goal") && title.includes("assist"))) return STAT_RAW_MAP["goals + assists"]!;
      // NHL "points" prop = G+A combo
      if (title.includes("nhl_points") || (title.includes("point") && !title.includes("power play"))) return STAT_RAW_MAP["nhl_points"]!;
      if (title.includes("goal"))            return STAT_RAW_MAP["goals"]!;
      if (title.includes("assist"))          return { key: "ast", label: "Assists" };
      if (title.includes("shot"))            return STAT_RAW_MAP["shots"]!;
      if (title.includes("save"))            return STAT_RAW_MAP["saves"]!;
      if (title.includes("block"))           return STAT_RAW_MAP["blocked_shots"]!;
      if (title.includes("faceoff"))         return STAT_RAW_MAP["faceoffs_won"]!;
      return STAT_RAW_MAP["goals"]!;
    }
    if (sport === "MLB") {
      // Combo patterns first
      const hasHRR = title.includes("hits_runs_rbis") || title.includes("hits + runs + rbis") ||
                     title.includes("hits+runs+rbis") ||
                     (title.includes("hit") && title.includes("run") && title.includes("rbi"));
      const hasTB  = !hasHRR && (title.includes("total_bases") || title.includes("total bases"));
      if (hasHRR)                              return STAT_RAW_MAP["hits_runs_rbis"]!;
      if (hasTB)                               return STAT_RAW_MAP["total_bases"]!;
      if (title.includes("home run"))          return STAT_RAW_MAP["home_runs"]!;
      if (title.includes("strikeout"))         return STAT_RAW_MAP["strikeouts"]!;
      if (title.includes("rbi"))               return STAT_RAW_MAP["rbis"]!;
      if (title.includes("stolen base"))       return STAT_RAW_MAP["stolen_bases"]!;
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
  // Helper: compute stat value from a game log row, handles combo props
  const getGameStatValue = (game: any): number => {
    if (statKey.isCombo && statKey.comboKeys) {
      return statKey.comboKeys.reduce((sum, k) => sum + (parseFloat(game[k]) || 0), 0);
    }
    const k = statKey.key === "reb" ? "trb" : statKey.key;
    return parseFloat(game[k]) || 0;
  };
  // Helper: compute season avg for this stat (handles combo)
  const getSeasonStatValue = (season: any): number => {
    if (statKey.isCombo) {
      // Use seasonKeys (uses "reb") if defined, else fall back to comboKeys with trb→reb
      const keys = (statKey as any).seasonKeys ?? statKey.comboKeys ?? [];
      return keys.reduce((sum: number, k: string) => {
        return sum + (parseFloat(season[k]) || 0);
      }, 0);
    }
    // Single stat: season uses "reb" not "trb"
    const k = statKey.key === "trb" ? "reb" : statKey.key;
    return parseFloat(season[k] ?? season[statKey.key]) || 0;
  };

  if (!canFetch) return null;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <BarChart2 size={13} style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Player Stats</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
          👤 {bet.playerName}
        </span>
        {data?.bbrUrl && (
          <a href={data.bbrUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border hover:bg-white/5 transition-colors"
            style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.25)" }}>
            <ExternalLink size={9} /> ESPN
          </a>
        )}
      </div>
      <div className="p-4 space-y-5">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            <Loader2 size={14} className="animate-spin" />
            Loading stats for {bet.playerName}...
          </div>
        )}
        {!isLoading && data && (
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
                    const isRelevant = statKey.isCombo
                      ? (statKey.comboKeys ?? []).some(ck => ck === k || (ck === "trb" && k === "reb") || (ck === "ast" && k === "ast") || (ck === "pts" && k === "pts"))
                      : (statKey.key === k || (statKey.key === "trb" && k === "reb"));
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
            {/* Stat vs prop line — show BOTH L5 avg (primary) and season avg */}
            {bet.line != null && (() => {
              // L5 avg from recentGames (most relevant — what the line is set against)
              const l5Avg = data.recentGames && data.recentGames.length > 0
                ? (() => {
                    const vals = data.recentGames.map((g: any) => getGameStatValue(g));
                    const sum = vals.reduce((a: number, b: number) => a + b, 0);
                    return parseFloat((sum / vals.length).toFixed(1));
                  })()
                : null;
              // Season avg (secondary context)
              const seasonVal = data.season ? getSeasonStatValue(data.season) : null;
              const seasonAvg = seasonVal && seasonVal > 0 ? parseFloat(seasonVal.toFixed(1)) : null;
              return (
                <div className="pt-1 space-y-3">
                  {l5Avg !== null && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Last 5 Games Avg vs Prop Line
                      </p>
                      <StatVsLine statLabel={statKey.label} statValue={l5Avg} propLine={bet.line} isL5 />
                    </div>
                  )}
                  {seasonAvg !== null && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Season Avg vs Prop Line
                      </p>
                      <StatVsLine statLabel={statKey.label} statValue={seasonAvg} propLine={bet.line} />
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Bar chart + game log */}
            {data.recentGames && data.recentGames.length > 0 && (
              <div className="pt-1 space-y-4">
                <MiniBarChart
                  games={data.recentGames.map((g: any) => ({
                    ...g,
                    // Inject a "_combo" key with the summed value for combo props
                    _combo: statKey.isCombo ? getGameStatValue(g) : undefined,
                  }))}
                  statKey={statKey.isCombo ? "_combo" : (statKey.key === "reb" ? "trb" : statKey.key)}
                  propLine={bet.line}
                  label={statKey.label}
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
                />
              </div>
            )}
            {/* Recent hit rate */}
            {data.recentGames && data.recentGames.length > 0 && bet.line != null && (() => {
              const hits = data.recentGames.filter((g: any) => getGameStatValue(g) >= bet.line!).length;
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
        {!isLoading && (isError || !data) && (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>Stats unavailable for {bet.playerName} right now.</p>
            <p className="text-[10px] text-center" style={{ color: "rgba(255,255,255,0.25)" }}>Try closing and reopening the drawer</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Similar Bets ──────────────────────────────────────────────────────────
function SimilarBets({ bet, onSelectBet }: { bet: Bet; onSelectBet: (b: Bet) => void }) {
  const { data: allBets } = useQuery<Bet[]>({ queryKey: ["/api/bets"], staleTime: 5 * 60 * 1000 });
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
            <button key={b.id} onClick={() => onSelectBet(b)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-black font-mono text-sm"
                style={{ background: `${confColor}18`, border: `1px solid ${confColor}30`, color: confColor }}>
                {conf}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold leading-tight line-clamp-1" style={{ color: "hsl(45 100% 90%)" }}>
                  {b.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
                </p>
                {b.playerName && <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>👤 {b.playerName}</p>}
              </div>
              <ChevronRight size={13} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Track Result ──────────────────────────────────────────────────────────
function TrackResult({ bet }: { bet: Bet }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/bets/${bet.id}/status`, { status }),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      toast({ title: status === "won" ? "🎉 Marked as Won!" : status === "lost" ? "😔 Marked as Lost" : "🔄 Reset to Open", duration: 2000 });
    },
  });
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <p className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Track Result</p>
      <div className="flex gap-2">
        <button onClick={() => mutation.mutate("won")} disabled={mutation.isPending}
          className="flex-1 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90"
          style={{ background: bet.status === "won" ? "rgba(74,222,128,0.25)" : "rgba(74,222,128,0.1)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}>
          ✓ Won
        </button>
        <button onClick={() => mutation.mutate("lost")} disabled={mutation.isPending}
          className="flex-1 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90"
          style={{ background: bet.status === "lost" ? "rgba(248,113,113,0.25)" : "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
          ✗ Lost
        </button>
        {bet.status !== "open" && (
          <button onClick={() => mutation.mutate("open")} disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.12)" }}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Drawer ───────────────────────────────────────────────────────────
interface BetDetailDrawerProps {
  bet: Bet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectBet: (bet: Bet) => void;
}

export default function BetDetailDrawer({ bet, open, onOpenChange, onSelectBet }: BetDetailDrawerProps) {
  if (!bet) return null;

  const score = bet.confidenceScore ?? 0;
  const scoreColor = score >= 80 ? "#f59e0b" : score >= 65 ? "#22d3ee" : "#f87171";
  const ts = bet.teamStats as { pickSide?: string; pickedOdds?: number } | null;
  const pickSide = bet.betType === "player_prop" ? ts?.pickSide?.toUpperCase() : undefined;

  return (
    // shouldScaleBackground=false fixes Safari freeze/crash on iOS
    // dismissible=true keeps swipe-to-close working on mobile
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        // Safari fix: avoid outline which causes repaint issues
        // Use fixed height approach: 88dvh with fallback for older Safari
        className="outline-none focus:outline-none"
        style={{
          background: "hsl(265 35% 7%)",
          borderTop: `2px solid ${scoreColor}`,
          // Height that works on Safari iOS — use dvh with px fallback
          height: "88dvh",
          maxHeight: "88dvh",
          display: "flex",
          flexDirection: "column",
          // Safari needs this to not extend under the home indicator
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Header — fixed, never scrolls */}
        <div className="flex-shrink-0">
          {/* Drag handle */}
          <div className="mx-auto mt-3 mb-2 h-1 w-12 rounded-full" style={{ background: "rgba(255,255,255,0.18)" }} />

          <div className="flex items-start gap-3 px-4 pt-1 pb-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            {/* Confidence ring */}
            <div className="relative flex-shrink-0" style={{ width: 52, height: 52 }}>
              <svg width={52} height={52} viewBox="0 0 52 52">
                <circle cx={26} cy={26} r={21} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                <circle cx={26} cy={26} r={21} fill="none" stroke={scoreColor} strokeWidth="4"
                  strokeDasharray={2 * Math.PI * 21} strokeDashoffset={2 * Math.PI * 21 * (1 - score / 100)}
                  strokeLinecap="round" transform="rotate(-90 26 26)"
                  style={{ filter: `drop-shadow(0 0 6px ${scoreColor}88)` }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-black font-mono leading-none" style={{ color: scoreColor }}>{score}</span>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              {pickSide && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase mb-1"
                  style={{ background: pickSide === "OVER" ? "rgba(74,222,128,0.15)" : "rgba(96,165,250,0.15)", color: pickSide === "OVER" ? "#4ade80" : "#60a5fa", border: `1px solid ${pickSide === "OVER" ? "rgba(74,222,128,0.3)" : "rgba(96,165,250,0.3)"}` }}>
                  {pickSide} {bet.line != null ? `${bet.line}` : ""}
                </span>
              )}
              <p className="text-sm font-bold leading-tight" style={{ color: "hsl(45 100% 92%)" }}>
                {bet.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
              </p>
              {bet.playerName && <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>👤 {bet.playerName}</p>}
              {bet.homeTeam && <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>{bet.awayTeam} @ {bet.homeTeam}</p>}
              {bet.gameTime && <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{formatDistanceToNow(new Date(bet.gameTime), { addSuffix: true })}</p>}
            </div>

            <DrawerClose asChild>
              <button
                className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.08)", WebkitTapHighlightColor: "transparent" }}
              >
                <X size={15} style={{ color: "rgba(255,255,255,0.7)" }} />
              </button>
            </DrawerClose>
          </div>
        </div>

        {/* Scrollable content area
            Safari fix: explicit flex-1 + overflow-y-auto + -webkit-overflow-scrolling touch
            The key is the parent must have a defined height (flex column + flex-1 child)
        */}
        <div
          className="flex-1 overflow-y-auto"
          style={{
            // Safari requires explicit -webkit-overflow-scrolling for momentum scrolling
            WebkitOverflowScrolling: "touch" as any,
            // Prevent scroll from propagating to the page behind the drawer on Safari
            overscrollBehavior: "contain",
            // Min-height 0 forces flex child to respect parent height on Safari
            minHeight: 0,
          }}
        >
          <div className="px-4 py-4 space-y-4">
            {/* Odds bar */}
            {(bet.overOdds != null || bet.underOdds != null) && (
              <OddsBar overOdds={bet.overOdds} underOdds={bet.underOdds} pickSide={pickSide} />
            )}

            {/* Player stats with game log */}
            {bet.playerName && <PlayerStatsSection bet={bet} />}

            {/* Confidence breakdown */}
            <ConfidenceBreakdown
              score={score}
              keyFactors={bet.keyFactors as string[] | null}
              riskLevel={bet.riskLevel}
              impliedProbability={bet.impliedProbability}
            />

            {/* Key factors */}
            {bet.keyFactors && (bet.keyFactors as string[]).length > 0 && (
              <KeyFactorsPanel factors={bet.keyFactors as string[]} />
            )}

            {/* Research summary */}
            {bet.researchSummary && (
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen size={13} style={{ color: "#a78bfa" }} />
                  <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>Analysis</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{bet.researchSummary}</p>
              </div>
            )}

            {/* Similar bets */}
            <SimilarBets bet={bet} onSelectBet={onSelectBet} />

            {/* Track result */}
            <TrackResult bet={bet} />

            {/* Bottom padding for safe area + breathing room */}
            <div style={{ height: "max(24px, env(safe-area-inset-bottom, 24px))" }} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
