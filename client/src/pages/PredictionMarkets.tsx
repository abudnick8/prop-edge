import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink, X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Trophy } from "lucide-react";
import { Link } from "wouter";
import { addWsListener } from "@/hooks/useWebSocket";
import { CheatSheetButton } from "@/components/CheatSheet";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";


// ── Detect a bare game total leg with no matchup context ──
// e.g. "Over 205.5 points scored" — needs a game label appended
const BARE_TOTAL_RE = /^(?:over|under)\s+[\d.]+\s+(?:points?|runs?|goals?|pts?)(?:\s+scored)?$/i;

function annotateLegWithContext(
  legText: string,
  allLegs: string[],
  legIndex: number
): { text: string; isBareTotal: boolean } {
  if (!BARE_TOTAL_RE.test(legText.trim())) return { text: legText, isBareTotal: false };

  // Try to find a team-win leg to infer the game — look for other legs that name teams
  const teamWinRe = /^(.+?)\s+to\s+Win/i;
  const winLegs = allLegs
    .map(l => l.replace(/^(YES|NO)\s+/i, "").trim())
    .filter(l => teamWinRe.test(l));

  // If exactly 2 team-win legs found in the combo, deduce this is THEIR game total
  if (winLegs.length === 2) {
    const t1 = (winLegs[0].match(teamWinRe)?.[1] ?? "").replace(/\s*\(\w+\)$/, "").trim();
    const t2 = (winLegs[1].match(teamWinRe)?.[1] ?? "").replace(/\s*\(\w+\)$/, "").trim();
    return { text: `${legText} (${t1} vs ${t2})`, isBareTotal: true };
  }

  // Can't determine — mark it so we render a context warning
  return { text: legText, isBareTotal: true };
}

// ── Client-side title parser (fallback for raw strings that slipped through) ──
function parseRawTitle(title: string, isParlay?: boolean, legs?: string[] | null): { displayLegs: string[] | null; summaryTitle: string } {
  if (isParlay && legs && legs.length > 0) return { displayLegs: legs, summaryTitle: title };

  // Detect cross-category strings: contains ",no " or ",yes " mid-string
  if (/,\s*(yes|no)\s+/i.test(title)) {
    const tokens = title.split(/(,\s*(?:yes|no)\s+)/i);
    const rawLegs: string[] = [];
    let current = tokens[0].trim();
    for (let i = 1; i < tokens.length; i += 2) {
      rawLegs.push(current);
      const sideMatch = tokens[i].match(/(yes|no)/i);
      const side = sideMatch ? sideMatch[1].toUpperCase() : 'YES';
      current = side + ' ' + (tokens[i + 1] ?? '').trim();
    }
    if (current) rawLegs.push(current);
    if (rawLegs.length >= 2) {
      const displayLegs = rawLegs.map(leg => {
        const m = leg.match(/^(YES|NO)\s+(.+)$/i);
        if (m) return `${m[1].toUpperCase()} ${m[2].trim()}`;
        return `YES ${leg.trim()}`;
      });
      const firstClean = displayLegs[0].replace(/^(YES|NO)\s+/i, '');
      const teamMatch = firstClean.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+/i);
      const teamName = teamMatch ? teamMatch[1] : 'Multi-team';
      return { displayLegs, summaryTitle: `${teamName} +${displayLegs.length - 1} more (${displayLegs.length}-leg combo)` };
    }
  }

  return { displayLegs: null, summaryTitle: title };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PredMkt {
  id: string;
  source: "kalshi" | "polymarket";
  title: string;
  event: string;
  sport: "NFL" | "NBA" | "MLB" | "NHL" | "Other";
  yesPrice: number;
  noPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  vol24h: number;
  volSpike: number;
  ph1: number;
  pd1: number;
  fairValue: number;
  edge: number;
  priceRating: "fair" | "good_buy" | "great_buy" | "overpriced";
  entryPrice: number;
  exitTarget: number;
  signalCount?: number;
  isWhaleAlert: boolean;
  whaleDirection: "yes" | "no" | null;
  whalePriceMovePct: number;
  smartScore?: number;
  liquidityNum?: number;
  pw1?: number;
  legs?: string[] | null;
  isParlay?: boolean;
  gameTime: string | null;
  polyUrl?: string;
  kalshiUrl?: string;
  crossValidated: boolean;
  crossPrice: number | null;
  crossSource: "kalshi" | "polymarket" | null;
  crossDelta: number | null;
  previousPrice?: number | null;
  openTime?: string | null;
}

interface HistoryPoint { t: number | string; p: number; }
interface HistoryResponse {
  source: string;
  history: HistoryPoint[];
  hasRealData?: boolean;
  isSynthetic?: boolean;
  tokenId?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCents(v: number) {
  const cents = v * 100;
  if (cents < 1 && cents > 0) return `${cents.toFixed(1)}¢`;
  return `${Math.round(cents)}¢`;
}
function fmtPct(v: number)   { return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`; }
function fmtVol(v: number)   {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
// ── Purchase type badge (client-side heuristic — no extra API call per card) ──
// Based on vol24h pattern: single purchase, multiple entries, or ongoing position-building
function classifyPurchaseType(vol24h: number, source: "kalshi" | "polymarket", smartScore: number): "single" | "multiple" | "ongoing" {
  if (source === "polymarket") {
    // Polymarket: large whales often make a single massive buy
    // $100K-$250K = likely single; $250K-$500K = likely multiple; >$500K = ongoing
    if (smartScore >= 80) return "ongoing";
    if (smartScore >= 40) return "multiple";
    return "single";
  }
  // Kalshi: lower volumes, so lower thresholds
  if (vol24h >= 20_000) return "ongoing";
  if (vol24h >= 8_000)  return "multiple";
  return "single";
}

const PURCHASE_TYPE_CFG = {
  single:   { label: "Single Buy",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)",   border: "rgba(96,165,250,0.30)",   icon: "1×" },
  multiple: { label: "Multi-Entry", color: "#c084fc", bg: "rgba(192,132,252,0.12)",  border: "rgba(192,132,252,0.30)",  icon: "2×" },
  ongoing:  { label: "Building",    color: "#34d399", bg: "rgba(52,211,153,0.12)",   border: "rgba(52,211,153,0.30)",   icon: "📈" },
} as const;

function PurchaseTypeBadge({ vol24h, source, smartScore }: { vol24h: number; source: "kalshi" | "polymarket"; smartScore: number }) {
  const type = classifyPurchaseType(vol24h, source, smartScore);
  const cfg  = PURCHASE_TYPE_CFG[type];
  return (
    <span
      className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
      title={
        type === "single"   ? "One large single-transaction purchase"
        : type === "multiple" ? "Multiple separate buy transactions"
        : "Continuously building position — same buyer buying repeatedly"
      }
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function timeUntil(gameTime: string | null) {
  if (!gameTime) return null;
  const diff = new Date(gameTime).getTime() - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const RATING_CONFIG = {
  great_buy:  { label: "Great Buy",  color: "#22c55e", bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.35)",   icon: "🔥" },
  good_buy:   { label: "Good Buy",   color: "#86efac", bg: "rgba(134,239,172,0.08)", border: "rgba(134,239,172,0.25)", icon: "✅" },
  fair:       { label: "Fair Price", color: "#94a3b8", bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.18)", icon: "⚖️" },
  overpriced: { label: "Overpriced", color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.30)",   icon: "⚠️" },
};
const SOURCE_COLOR: Record<string, string> = { kalshi: "#f59e0b", polymarket: "#6366f1" };

const SPORT_TABS: { id: string; label: string; emoji: string }[] = [
  { id: "all", label: "All",   emoji: "🌐" },
  { id: "NFL", label: "NFL",   emoji: "🏈" },
  { id: "NBA", label: "NBA",   emoji: "🏀" },
  { id: "MLB", label: "MLB",   emoji: "⚾" },
  { id: "NHL", label: "NHL",   emoji: "🏒" },
  { id: "Other", label: "Other", emoji: "🌍" },
];

type RatingFilter = "all" | "whale" | "great_buy" | "good_buy" | "fair" | "overpriced";
const RATING_TABS: { id: RatingFilter; label: string; emoji: string }[] = [
  { id: "all",        label: "All",          emoji: "🌐" },
  { id: "whale",      label: "Whale Alerts", emoji: "🐋" },
  { id: "great_buy",  label: "Great Buys",   emoji: "🔥" },
  { id: "good_buy",   label: "Good Buys",    emoji: "✅" },
  { id: "fair",       label: "Fair",         emoji: "⚖️" },
  { id: "overpriced", label: "Overpriced",   emoji: "⚠️" },
];

// ── Price History Drawer ──────────────────────────────────────────────────────
function HistoryDrawer({ m, onClose }: { m: PredMkt; onClose: () => void }) {
  const cfg = RATING_CONFIG[m.priceRating] ?? RATING_CONFIG.fair;
  const url = m.polyUrl ?? m.kalshiUrl ?? "#";

  const { data: histData, isLoading: histLoading } = useQuery<HistoryResponse>({
    queryKey: ["/api/prediction-markets/history", m.id],
    queryFn: () => apiRequest("GET", `/api/prediction-markets/history/${m.id}`).then(r => r.json()),
    staleTime: 60_000,
  });

  // Fetch real transaction type for whale alerts (lazy — only when drawer is open)
  const { data: txData } = useQuery<{ purchaseType: "single" | "multiple" | "ongoing"; txCount: number; source?: string }>({
    queryKey: ["/api/prediction-markets/txtype", m.id],
    queryFn: () => apiRequest("GET", `/api/prediction-markets/txtype/${m.id}`).then(r => r.json()),
    enabled: m.isWhaleAlert,
    staleTime: 2 * 60_000,
  });

  const drawerPurchaseType = txData?.purchaseType ??
    classifyPurchaseType(m.vol24h, m.source, m.smartScore ?? 0);

  const history = (histData?.history ?? []).map((p, i) => ({
    idx: i,
    price: Math.round(p.p * 100),
    label: p.t ? new Date(typeof p.t === "number" ? p.t * 1000 : p.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `${i}`,
  }));

  const currentCents = Math.round(m.yesPrice * 100);
  const fairCents    = Math.round(m.fairValue * 100);
  const roi = m.entryPrice > 0 ? ((m.exitTarget - m.entryPrice) / m.entryPrice * 100) : 0;

  // Determine chart color based on trend
  const chartColor = history.length >= 2 && history[history.length - 1].price > history[0].price
    ? "#22c55e" : "#ef4444";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-2xl bg-card border border-border rounded-t-2xl md:rounded-2xl p-5 flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: SOURCE_COLOR[m.source] }}>
                {m.source === "kalshi" ? "Kalshi" : "Polymarket"}
              </span>
              {m.sport && m.sport !== "OTHER" && (
                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-white/10 text-white/80 border border-white/20">
                  {m.sport}
                </span>
              )}
            </div>
            {(() => {
              const { displayLegs, summaryTitle } = parseRawTitle(m.title, m.isParlay, m.legs);
              if (displayLegs && displayLegs.length > 0) {
                return (
                  <div className="mt-1">
                    <p className="text-[11px] font-bold text-orange-300 mb-2.5">
                      {displayLegs.length}-Leg Combo · tap each to see full condition
                    </p>
                    <div className="flex flex-col gap-2">
                      {displayLegs.map((leg, i) => {
                        const isYes = leg.startsWith("YES");
                        const rawLegText = leg.replace(/^(YES|NO)\s+/, "");
                        const { text: legText, isBareTotal } = annotateLegWithContext(rawLegText, displayLegs, i);
                        return (
                          <div key={i} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-[12px] ${
                            isYes
                              ? "bg-green-500/5 border-green-500/20"
                              : "bg-red-500/5 border-red-500/20"
                          }`}>
                            <span className={`shrink-0 font-black text-[10px] px-2 py-1 rounded tracking-widest mt-0.5 ${
                              isYes ? "bg-green-500/25 text-green-400" : "bg-red-500/25 text-red-400"
                            }`}>
                              {isYes ? "YES" : "NO"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className={`leading-snug font-semibold ${isYes ? "text-foreground" : "text-muted-foreground"}`}>
                                {legText}
                              </span>
                              {isBareTotal && !legText.includes("(") && (
                                <p className="text-[10px] text-amber-400/80 mt-0.5">⚠ Game total — see other legs for matchup</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return (
                <>
                  <p className="text-base font-bold text-foreground leading-snug">{m.title}</p>
                  {m.event !== m.title && (
                    <p className="text-xs text-muted-foreground mt-0.5">{m.event}</p>
                  )}
                </>
              );
            })()}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Rating + cross-validation row */}
        <div className="flex flex-wrap gap-2">
          <span
            className="text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-md border"
            style={{ color: cfg.color, borderColor: cfg.border, background: cfg.bg }}
          >
            {cfg.icon} {cfg.label}
          </span>
          {m.isWhaleAlert && (
            <span className="text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30 animate-pulse inline-flex items-center gap-1.5">
              🐋 Whale Alert
              {(m.smartScore ?? 0) > 0 && (
                <span className="text-[9px] bg-orange-400/20 px-1 py-0.5 rounded font-mono">{m.smartScore}/100</span>
              )}
            </span>
          )}
          {m.isWhaleAlert && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              Purchase pattern:
              <PurchaseTypeBadge vol24h={m.vol24h} source={m.source} smartScore={m.smartScore ?? 0} />
              {txData?.source === "clob" && txData.txCount > 0 && (
                <span className="text-[9px] text-muted-foreground/60">({txData.txCount}× via CLOB)</span>
              )}
            </span>
          )}
          {m.crossValidated && m.crossDelta !== null && (
            <span
              className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md border"
              style={m.crossDelta <= 3
                ? { background: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)", color: "#22c55e" }
                : { background: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.35)", color: "#ef4444" }}
            >
              {m.crossDelta <= 3
                ? <><CheckCircle2 size={10} /> Prices agree ({m.crossDelta}¢ delta)</>
                : <><AlertTriangle size={10} /> Price gap vs {m.crossSource}: {m.crossDelta}¢</>}
            </span>
          )}
          {!m.crossValidated && (
            <span className="text-[10px] px-2.5 py-1 rounded-md border border-border text-muted-foreground">
              Single source only
            </span>
          )}
        </div>

        {/* Price chart */}
        <div className="bg-background/60 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              Price History (YES contract)
            </p>
            {!histLoading && histData && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                histData.hasRealData
                  ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                  : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
              }`}>
                {histData.hasRealData ? "Live CLOB Data" : histData.isSynthetic ? "Est. (no public history)" : "Est. from price changes"}
              </span>
            )}
          </div>
          {histLoading ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-xs animate-pulse">
              Loading chart…
            </div>
          ) : history.length < 2 ? (
            <div className="h-40 flex flex-col items-center justify-center text-muted-foreground">
              <p className="text-2xl mb-2">📊</p>
              <p className="text-xs">No price history available</p>
              <p className="text-[10px] mt-1">Current price: {fmtCents(m.yesPrice)}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id={`grad-${m.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}¢`} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${v}¢`, "Price"]}
                  labelStyle={{ color: "#94a3b8" }}
                />
                <ReferenceLine y={fairCents}   stroke="#22d3ee" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: "Fair", fill: "#22d3ee", fontSize: 9, position: "insideTopRight" }} />
                <ReferenceLine y={currentCents} stroke={chartColor} strokeDasharray="2 2" strokeWidth={1} />
                <Area type="monotone" dataKey="price" stroke={chartColor} strokeWidth={2} fill={`url(#grad-${m.id})`} dot={false} activeDot={{ r: 4, fill: chartColor }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {/* Chart legend */}
          <div className="flex items-center gap-4 mt-2 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-4 h-[2px] inline-block" style={{ background: "#22d3ee", borderTop: "2px dashed #22d3ee" }} /> Fair value</span>
            <span className="flex items-center gap-1"><span className="w-4 h-[2px] inline-block" style={{ background: chartColor }} /> YES price</span>
          </div>
        </div>

        {/* Price grid */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Current",  val: fmtCents(m.yesPrice),   color: "text-foreground" },
            { label: "Fair Value", val: fmtCents(m.fairValue), color: "text-cyan-400"   },
            { label: m.priceRating === "overpriced" ? "NO Entry" : "Entry",  val: fmtCents(m.entryPrice), color: m.priceRating === "overpriced" ? "text-red-400" : "text-yellow-400" },
            { label: m.priceRating === "overpriced" ? "NO Target" : "Target", val: fmtCents(m.exitTarget), color: "" },
          ].map(item => (
            <div key={item.label} className="text-center bg-background/40 rounded-lg py-2 px-1 border border-border">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">{item.label}</p>
              <p className={`font-mono font-black text-sm ${item.color}`} style={item.label === "Target" ? { color: cfg.color } : {}}>{item.val}</p>
            </div>
          ))}
        </div>

        {/* Cross-validation detail */}
        {m.crossValidated && m.crossPrice !== null && (
          <div
            className="rounded-xl border px-4 py-3"
            style={m.crossDelta !== null && m.crossDelta > 3
              ? { background: "rgba(239,68,68,0.07)", borderColor: "rgba(239,68,68,0.3)" }
              : { background: "rgba(34,197,94,0.07)", borderColor: "rgba(34,197,94,0.3)" }}
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
              🔁 Cross-Validation ({m.source === "kalshi" ? "Kalshi" : "Polymarket"} vs {m.crossSource})
            </p>
            <div className="flex items-center gap-6 text-xs">
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">This market</p>
                <p className="font-mono font-bold text-foreground">{fmtCents(m.yesPrice)}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">{m.crossSource}</p>
                <p className="font-mono font-bold text-foreground">{fmtCents(m.crossPrice)}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Delta</p>
                <p className={`font-mono font-bold ${m.crossDelta !== null && m.crossDelta > 3 ? "text-red-400" : "text-green-400"}`}>
                  {m.crossDelta}¢ {m.crossDelta !== null && m.crossDelta > 5 ? "⚠️ Discrepancy" : ""}
                </p>
              </div>
              {m.crossDelta !== null && m.crossDelta > 5 && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Arb Signal</p>
                  <p className="font-bold text-yellow-400">Buy cheaper side</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Buy/Sell rec */}
        {m.priceRating !== "fair" && (
          <div
            className="rounded-xl px-4 py-3 border"
            style={{
              background: m.priceRating === "overpriced" ? "rgba(239,68,68,0.07)" : "rgba(34,197,94,0.07)",
              borderColor: m.priceRating === "overpriced" ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)",
            }}
          >
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
              {m.priceRating === "overpriced" ? "Recommendation" : "Buy Signal"}
            </p>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold" style={{ color: m.priceRating === "overpriced" ? "#ef4444" : "#22c55e" }}>
                {m.priceRating === "overpriced"
                  ? `Avoid YES · Buy NO at ${fmtCents(m.noPrice)}`
                  : `Buy YES at ${fmtCents(m.entryPrice)} → Exit ${fmtCents(m.exitTarget)}`}
              </p>
              <p className="font-mono font-bold text-xs text-lime-400">
                {m.edge > 0 ? "+" : ""}{m.edge}% edge · {roi > 0 ? "+" : ""}{roi.toFixed(1)}% ROI
              </p>
            </div>
          </div>
        )}

        {/* Footer stats + trade link */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
          <div className="flex gap-4">
            <span>Spread <span className="text-foreground font-mono">{m.spread}¢</span></span>
            {m.vol24h > 0 && <span>Vol <span className="text-foreground font-mono">{fmtVol(m.vol24h)}</span></span>}
            {m.pd1 !== 0 && <span style={{ color: m.pd1 >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(m.pd1)} 1d</span>}
            {(m.signalCount ?? 1) > 1 && <span className="text-cyan-400">{m.signalCount} signal sources</span>}
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-border hover:border-primary hover:text-primary transition-colors"
          >
            Trade on {m.source === "kalshi" ? "Kalshi" : "Polymarket"} <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
}

function isTodayMarket(m: PredMkt): boolean {
  if (!m.gameTime) return false;
  try {
    const t = new Date(m.gameTime).getTime();
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const isToday    = new Date(m.gameTime).toISOString().slice(0, 10) === today;
    const isWithin24h = t > now && t <= now + 24 * 60 * 60 * 1000;
    return isToday || isWithin24h;
  } catch { return false; }
}

// ── Market Card ───────────────────────────────────────────────────────────────
function MarketCard({ m, onClick }: { m: PredMkt; onClick: () => void }) {
  const cfg = RATING_CONFIG[m.priceRating] ?? RATING_CONFIG.fair;
  const countdown = timeUntil(m.gameTime);
  const isToday = isTodayMarket(m);

  return (
    <button
      onClick={onClick}
      className="rounded-xl border p-4 flex flex-col gap-3 relative overflow-hidden text-left w-full transition-all hover:scale-[1.01] hover:shadow-lg cursor-pointer"
      style={{ background: cfg.bg, borderColor: isToday ? "rgba(250,204,21,0.45)" : cfg.border }}
    >
      {m.isWhaleAlert && (
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)" }} />
      )}
      {isToday && !m.isWhaleAlert && (
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #facc15, #fbbf24, #facc15)" }} />
      )}
      {/* Click hint */}
      <div className="absolute top-2 right-2 text-[9px] text-muted-foreground/50 font-medium">tap for chart ›</div>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 pr-12">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: SOURCE_COLOR[m.source] }}>
              {m.source === "kalshi" ? "Kalshi" : "Polymarket"}
            </span>
            {m.sport && m.sport !== "OTHER" && (
              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-white/10 text-white/80 border border-white/20">
                {m.sport}
              </span>
            )}
            {isToday && <span className="text-[10px] font-bold text-yellow-400">⚡ TODAY</span>}
            {countdown && <span className="text-[10px] font-semibold text-orange-400">⏰ {countdown}</span>}
          </div>
          {(() => {
            const { displayLegs, summaryTitle } = parseRawTitle(m.title, m.isParlay, m.legs);
            if (displayLegs && displayLegs.length > 0) {
              // Collapse after 3 legs on the card to keep it compact
              const SHOW = 3;
              const shown = displayLegs.slice(0, SHOW);
              const hidden = displayLegs.length - SHOW;
              return (
                <div className="mt-0.5">
                  <p className="text-[11px] font-bold text-orange-300 mb-1.5">
                    {displayLegs.length}-Leg Combo
                  </p>
                  <div className="flex flex-col gap-1">
                    {shown.map((leg, i) => {
                      const isYes = leg.startsWith("YES");
                      const rawLegText = leg.replace(/^(YES|NO)\s+/, "");
                      const { text: legText, isBareTotal } = annotateLegWithContext(rawLegText, displayLegs, i);
                      return (
                        <div key={i} className="flex items-start gap-1.5 text-[11px]">
                          <span className={`shrink-0 font-black text-[9px] px-1.5 py-0.5 rounded mt-0.5 tracking-wide ${
                            isYes ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                          }`}>
                            {isYes ? "YES" : "NO"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className={`leading-tight ${isYes ? "text-foreground font-medium" : "text-muted-foreground"}`}>{legText}</span>
                            {isBareTotal && !legText.includes("(") && (
                              <span className="block text-[9px] text-amber-400/70 mt-0.5">⚠ game total — tap to see matchup</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {hidden > 0 && (
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 pl-5">+{hidden} more legs · tap to see all</p>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <>
                <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{m.title}</p>
                {m.event !== m.title && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.event}</p>
                )}
              </>
            );
          })()}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border"
            style={{ color: cfg.color, borderColor: cfg.border, background: "transparent" }}>
            {cfg.icon} {cfg.label}
          </span>
          {m.isWhaleAlert && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30 animate-pulse flex items-center gap-1">
              🐋 Whale
              {(m.smartScore ?? 0) > 0 && (
                <span className="text-[9px] font-bold text-orange-200 opacity-80">{m.smartScore}</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Cross-validation badge */}
      {m.crossValidated && m.crossDelta !== null && (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold"
          style={m.crossDelta > 3
            ? { color: "#f87171" }
            : { color: "#4ade80" }}
        >
          {m.crossDelta > 3
            ? <><AlertTriangle size={10} /> {m.crossDelta}¢ gap vs {m.crossSource}</>
            : <><CheckCircle2 size={10} /> Prices verified ({m.crossDelta}¢ delta)</>}
        </div>
      )}

      {/* Price row */}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase">YES</p>
          <p className="font-mono font-black text-base text-foreground">{fmtCents(m.yesPrice)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Fair</p>
          <p className="font-mono font-bold text-sm text-cyan-400">{fmtCents(m.fairValue)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] uppercase font-bold" style={{ color: m.priceRating === "overpriced" ? "#f87171" : "#94a3b8" }}>
            {m.priceRating === "overpriced" ? "NO Entry" : "Entry"}
          </p>
          <p className="font-mono font-bold text-sm" style={{ color: m.priceRating === "overpriced" ? "#f87171" : "#facc15" }}>{fmtCents(m.entryPrice)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] uppercase font-bold" style={{ color: m.priceRating === "overpriced" ? "#f87171" : "#94a3b8" }}>
            {m.priceRating === "overpriced" ? "NO Target" : "Target"}
          </p>
          <p className="font-mono font-bold text-sm" style={{ color: cfg.color }}>{fmtCents(m.exitTarget)}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-white/5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>Spread {m.spread}¢</span>
            {m.vol24h > 0 && <span>{fmtVol(m.vol24h)}</span>}
            {m.pd1 !== 0 && (
              <span style={{ color: m.pd1 >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(m.pd1)} 1d</span>
            )}
          </div>
          <span className="text-[9px]" style={{ color: cfg.color }}>
            {m.edge > 0 ? "+" : ""}{m.edge}% edge
          </span>
        </div>
        {m.isWhaleAlert && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground/60">Purchase pattern:</span>
            <PurchaseTypeBadge vol24h={m.vol24h} source={m.source} smartScore={m.smartScore ?? 0} />
          </div>
        )}
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PredictionMarkets() {
  const [sportFilter, setSportFilter]   = useState("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "kalshi" | "polymarket">("all");
  const [todayOnly, setTodayOnly]       = useState(false);
  const [search, setSearch]             = useState("");
  const [lastRefresh, setLastRefresh]   = useState(Date.now());
  const [selected, setSelected]         = useState<PredMkt | null>(null);
  const [legendOpen, setLegendOpen]     = useState(false);

  const { data: markets = [], isLoading, refetch } = useQuery<PredMkt[]>({
    queryKey: ["/api/prediction-markets"],
    queryFn: () => apiRequest("GET", "/api/prediction-markets").then(r => r.json()),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const unsub = addWsListener((evt) => {
      if (evt.event === "price:tick" || evt.event === "price:mispriced") {
        refetch();
        setLastRefresh(Date.now());
      }
    });
    return unsub;
  }, [refetch]);

  const todayCount = markets.filter(isTodayMarket).length;

  const filtered = markets.filter(m => {
    // Hide near-resolved markets (YES < 2¢ or > 98¢ = outcome essentially decided)
    if (m.yesPrice < 0.02 || m.yesPrice > 0.98) return false;
    // Hide events that have already ended (close_time / endDate in the past)
    if (m.gameTime && new Date(m.gameTime).getTime() <= Date.now()) return false;
    if (todayOnly && !isTodayMarket(m)) return false;
    if (sportFilter !== "all" && m.sport !== sportFilter) return false;
    if (ratingFilter === "whale" && !m.isWhaleAlert) return false;
    if (ratingFilter !== "all" && ratingFilter !== "whale" && m.priceRating !== ratingFilter) return false;
    if (sourceFilter !== "all" && m.source !== sourceFilter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase()) && !m.event.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Summary stats
  const whaleCount      = markets.filter(m => m.isWhaleAlert).length;
  const greatBuyCount   = markets.filter(m => m.priceRating === "great_buy").length;
  const goodBuyCount    = markets.filter(m => m.priceRating === "good_buy").length;
  const overpricedCount = markets.filter(m => m.priceRating === "overpriced").length;
  const crossValidated  = markets.filter(m => m.crossValidated).length;
  const priceMismatch   = markets.filter(m => m.crossValidated && m.crossDelta !== null && m.crossDelta > 5).length;

  // Sport counts for badge
  const sportCounts = { NFL: 0, NBA: 0, MLB: 0, NHL: 0, Other: 0 } as Record<string, number>;
  for (const m of markets) sportCounts[m.sport] = (sportCounts[m.sport] ?? 0) + 1;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h1 className="text-xl font-black text-foreground tracking-tight">Prediction Markets</h1>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <CheatSheetButton initialSection="howtoread" label="How to Read" mobileIconOnly />
            <Link
              href="/markets/top-traders"
              className="flex items-center gap-1 text-xs font-bold border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20 transition-colors px-2 py-2 rounded-lg"
              title="Top Traders"
            >
              <Trophy size={12} /> <span className="hidden sm:inline">Top Traders</span>
            </Link>
            <button
              onClick={() => { refetch(); setLastRefresh(Date.now()); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-2 rounded-md hover:bg-accent"
              title="Refresh"
            >
              <RefreshCw size={12} /> <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Kalshi + Polymarket + Manifold · 30s refresh ·{" "}
          <span className="text-primary">Updated {new Date(lastRefresh).toLocaleTimeString()}</span>
          {crossValidated > 0 && (
            <span className="ml-2 text-cyan-400">· {crossValidated} cross-validated</span>
          )}
          {priceMismatch > 0 && (
            <span className="ml-2 text-red-400">· {priceMismatch} price discrepancies</span>
          )}
        </p>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Whale Alerts",   val: whaleCount,      color: "#f97316", bg: "rgba(249,115,22,0.10)" },
          { label: "Great Buys",     val: greatBuyCount,   color: "#22c55e", bg: "rgba(34,197,94,0.10)"  },
          { label: "Good Buys",      val: goodBuyCount,    color: "#86efac", bg: "rgba(134,239,172,0.08)"},
          { label: "Overpriced",     val: overpricedCount, color: "#ef4444", bg: "rgba(239,68,68,0.08)"  },
        ].map(s => (
          <div key={s.label} className="rounded-xl border px-4 py-3" style={{ borderColor: s.color + "44", background: s.bg }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: s.color }}>{s.label}</p>
            <p className="text-2xl font-black text-foreground">{isLoading ? "—" : s.val}</p>
          </div>
        ))}
      </div>

      {/* ── Legend / Key ── */}
      <div className="mb-5 rounded-xl border border-border overflow-hidden">
        <button
          onClick={() => setLegendOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Info size={13} className="text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">How to Read This</span>
          </div>
          {legendOpen ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
        </button>

        {legendOpen && (
          <div className="px-4 pt-4 pb-5 grid sm:grid-cols-2 gap-x-6 gap-y-4 bg-card">

            {/* Whale Alert */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-base">🐋</div>
              <div>
                <p className="text-[11px] font-black text-orange-300 uppercase tracking-wide mb-0.5">Whale Alert + Score (e.g. 60/100)</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  A single institution moved <span className="text-foreground font-semibold">$100,000+</span> into this market in the last 24 hours — a signal that sharp, professional money is taking a position. The number (e.g. 60/100) is the <span className="text-foreground font-semibold">Smart Money Score</span>: higher = larger dollar flow. Score of <span className="text-foreground font-semibold">20 = $100K</span>, <span className="text-foreground font-semibold">50 = $250K</span>, <span className="text-foreground font-semibold">100 = $500K+</span>.
                </p>
              </div>
            </div>

            {/* YES / NO price */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary">¢</div>
              <div>
                <p className="text-[11px] font-black text-foreground uppercase tracking-wide mb-0.5">YES Price (cents)</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  The cost to buy a YES contract. A price of <span className="text-foreground font-semibold">60¢</span> means the market believes there's a <span className="text-foreground font-semibold">60% chance</span> the event happens. Pays $1.00 if correct — so you profit 40¢ per contract.
                </p>
              </div>
            </div>

            {/* Fair Value */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[10px] font-black text-cyan-400">FV</div>
              <div>
                <p className="text-[11px] font-black text-cyan-400 uppercase tracking-wide mb-0.5">Fair Value</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Our consensus estimate of what the YES price <em>should</em> be, based on signals from Polymarket, Kalshi, and Manifold. If Fair Value is higher than YES Price → the market is <span className="text-green-400 font-semibold">underpriced — buy YES</span>. If lower → <span className="text-red-400 font-semibold">overpriced — buy NO instead</span>.
                </p>
              </div>
            </div>

            {/* Entry / Target */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-[10px] font-black text-yellow-400">→</div>
              <div>
                <p className="text-[11px] font-black text-yellow-400 uppercase tracking-wide mb-0.5">Entry → Target</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <span className="text-foreground font-semibold">Entry</span> = current market price (live). <span className="text-foreground font-semibold">Target</span> = minimum <span className="text-yellow-300 font-semibold">10% ROI</span> on the contract price, scaling up with confluence: whale alert, cross-validation, and strong edge each add +5%, up to <span className="text-yellow-300 font-semibold">30% ROI</span>. For <span className="text-red-400 font-semibold">Overpriced</span> markets, the recommendation flips to buying the <span className="text-foreground font-semibold">NO contract</span> — Entry and Target show as <span className="text-red-400 font-semibold">NO Entry / NO Target</span> with the same ROI logic applied to the NO price.
                </p>
              </div>
            </div>

            {/* Price ratings */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-base">🔥</div>
              <div>
                <p className="text-[11px] font-black text-green-400 uppercase tracking-wide mb-0.5">Great Buy / Good Buy / Fair / Overpriced</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Rating based on the gap between YES Price and Fair Value. <span className="text-green-400 font-semibold">Great Buy</span> = 8%+ edge. <span className="text-green-300 font-semibold">Good Buy</span> = 3–8% edge. <span className="text-muted-foreground font-semibold">Fair</span> = within 3%. <span className="text-red-400 font-semibold">Overpriced</span> = market is pricing too high.
                </p>
              </div>
            </div>

            {/* Cross-validated */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center"><CheckCircle2 size={13} className="text-emerald-400" /></div>
              <div>
                <p className="text-[11px] font-black text-emerald-400 uppercase tracking-wide mb-0.5">Cross-Validated</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  The same market exists on both Kalshi <em>and</em> Polymarket. The delta (e.g. <span className="text-foreground font-semibold">2¢ gap</span>) is the price difference between platforms — a large gap (5¢+) may signal an arbitrage opportunity.
                </p>
              </div>
            </div>

            {/* Today badge */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-base">⚡</div>
              <div>
                <p className="text-[11px] font-black text-yellow-400 uppercase tracking-wide mb-0.5">⚡ TODAY</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  This market closes within 24 hours — it's an active in-play or same-day event. These appear at the top of every list. Use the <span className="text-yellow-400 font-semibold">⚡ Today</span> filter to see only these.
                </p>
              </div>
            </div>

            {/* Spread / Vol */}
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-slate-500/10 border border-slate-500/20 flex items-center justify-center text-[10px] font-black text-slate-400">$</div>
              <div>
                <p className="text-[11px] font-black text-foreground uppercase tracking-wide mb-0.5">Spread · Vol · 1d %</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <span className="text-foreground font-semibold">Spread</span> = bid/ask gap (lower is more liquid). <span className="text-foreground font-semibold">Vol</span> = 24-hour dollar volume traded. <span className="text-foreground font-semibold">1d %</span> = how much the YES price moved in the last day — positive = trending yes, negative = trending no.
                </p>
              </div>
            </div>

            {/* Purchase Pattern — full-width */}
            <div className="sm:col-span-2 rounded-xl border border-border/60 overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b border-border/40 flex items-center gap-2">
                <span className="text-base">📊</span>
                <p className="text-[11px] font-black text-foreground uppercase tracking-wide">Purchase Pattern — What It Means</p>
              </div>
              <div className="px-3 py-3 grid sm:grid-cols-3 gap-3">

                {/* Single Buy */}
                <div className="rounded-lg border p-2.5" style={{ borderColor: "rgba(96,165,250,0.35)", background: "rgba(96,165,250,0.06)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-black px-1.5 py-0.5 rounded border" style={{ color: "#60a5fa", background: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.30)" }}>1× Single Buy</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    The position was entered with <span className="text-foreground font-semibold">one large transaction</span>. This is typical of an institution or high-conviction trader who decided quickly and committed the full amount at once. The sharpest whale moves are often single buys — they weren't averaging in, they knew their price.
                  </p>
                </div>

                {/* Multi-Entry */}
                <div className="rounded-lg border p-2.5" style={{ borderColor: "rgba(192,132,252,0.35)", background: "rgba(192,132,252,0.06)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-black px-1.5 py-0.5 rounded border" style={{ color: "#c084fc", background: "rgba(192,132,252,0.12)", borderColor: "rgba(192,132,252,0.30)" }}>2× Multi-Entry</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    The position was built with <span className="text-foreground font-semibold">exactly two separate transactions</span>. Common when a trader enters, sees the price improve, and adds a second tranche — or splits their entry deliberately to average a better price. Still a strong directional signal.
                  </p>
                </div>

                {/* Building */}
                <div className="rounded-lg border p-2.5" style={{ borderColor: "rgba(52,211,153,0.35)", background: "rgba(52,211,153,0.06)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-black px-1.5 py-0.5 rounded border" style={{ color: "#34d399", background: "rgba(52,211,153,0.12)", borderColor: "rgba(52,211,153,0.30)" }}>📈 Building</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="text-foreground font-semibold">3 or more transactions</span> — this wallet is actively accumulating. They keep buying as the position develops, which suggests <span className="text-foreground font-semibold">very high conviction</span>: they're willing to average up (or down) to build a larger stake. This is the most bullish pattern.
                  </p>
                </div>

              </div>
              <div className="px-3 pb-3">
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  <span className="font-semibold text-muted-foreground">How to use it:</span> A <span style={{ color: "#34d399" }}>Building</span> pattern on a whale alert means the smart money isn't done — expect continued pressure on the YES price. A <span style={{ color: "#60a5fa" }}>Single Buy</span> at massive scale is often a one-shot conviction bet from a known sharp. <span style={{ color: "#c084fc" }}>Multi-Entry</span> suggests they are patiently accumulating a specific price range.
                </p>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── Sport filter tabs ── */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {SPORT_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSportFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              sportFilter === tab.id
                ? "bg-card text-foreground border-primary/50 shadow-sm"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.emoji} {tab.label}
            {tab.id !== "all" && sportCounts[tab.id] > 0 && (
              <span className={`ml-1.5 text-[10px] font-mono ${sportFilter === tab.id ? "text-primary" : "text-muted-foreground"}`}>
                {sportCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Source + search row */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-2 flex-wrap">
          {(["all", "kalshi", "polymarket"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                sourceFilter === s ? "text-white" : "text-muted-foreground hover:text-foreground"
              }`}
              style={sourceFilter === s ? {
                background: s === "kalshi" ? "rgba(245,158,11,0.25)" : s === "polymarket" ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.1)",
                borderColor: s === "kalshi" ? "#f59e0b" : s === "polymarket" ? "#6366f1" : "rgba(255,255,255,0.2)",
                color:       s === "kalshi" ? "#f59e0b" : s === "polymarket" ? "#818cf8" : "#fff",
              } : { borderColor: "rgba(255,255,255,0.1)", background: "transparent" }}
            >
              {s === "all" ? "All Sources" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          {/* Today filter — day-trade mode */}
          <button
            onClick={() => setTodayOnly(v => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all"
            style={todayOnly ? {
              background: "rgba(250,204,21,0.20)",
              borderColor: "#facc15",
              color: "#facc15",
            } : { borderColor: "rgba(255,255,255,0.1)", background: "transparent", color: "" }}
          >
            ⚡ Today
            {todayCount > 0 && (
              <span className="ml-1.5 text-[10px] font-mono" style={{ color: todayOnly ? "#fde68a" : "#64748b" }}>
                {todayCount}
              </span>
            )}
          </button>
        </div>
        <input
          type="text"
          placeholder="Search markets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-muted/50 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Rating filter tabs */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {RATING_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setRatingFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
              ratingFilter === tab.id
                ? "text-foreground border-primary/50 bg-primary/15"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.emoji} {tab.label}
            {tab.id === "whale"    && whaleCount > 0     && <span className="ml-1.5 text-orange-400">{whaleCount}</span>}
            {tab.id === "great_buy" && greatBuyCount > 0 && <span className="ml-1.5 text-green-400">{greatBuyCount}</span>}
          </button>
        ))}
      </div>

      {/* Market grid */}
      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/30 animate-pulse h-48" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-semibold">No markets match your filters</p>
          <p className="text-xs mt-1">Try adjusting filters or refreshing</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(m => <MarketCard key={m.id} m={m} onClick={() => setSelected(m)} />)}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center mt-8">
        Fair value uses Polymarket Gamma + CLOB + Manifold Markets consensus — not financial advice.
      </p>

      {/* Detail drawer */}
      {selected && <HistoryDrawer m={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
