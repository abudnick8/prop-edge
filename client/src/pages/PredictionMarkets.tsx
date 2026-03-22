import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink, X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { addWsListener } from "@/hooks/useWebSocket";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";

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
  gameTime: string | null;
  polyUrl?: string;
  kalshiUrl?: string;
  crossValidated: boolean;
  crossPrice: number | null;
  crossSource: "kalshi" | "polymarket" | null;
  crossDelta: number | null;
}

interface HistoryPoint { t: number | string; p: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCents(v: number) { return `${Math.round(v * 100)}¢`; }
function fmtPct(v: number)   { return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`; }
function fmtVol(v: number)   {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
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

  const { data: histData, isLoading: histLoading } = useQuery<{ history: HistoryPoint[] }>({
    queryKey: ["/api/prediction-markets/history", m.id],
    queryFn: () => apiRequest("GET", `/api/prediction-markets/history/${m.id}`).then(r => r.json()),
    staleTime: 60_000,
  });

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
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: SOURCE_COLOR[m.source] }}>
              {m.source === "kalshi" ? "Kalshi" : "Polymarket"} · {m.sport}
            </p>
            <p className="text-base font-bold text-foreground leading-snug">{m.title}</p>
            {m.event !== m.title && (
              <p className="text-xs text-muted-foreground mt-0.5">{m.event}</p>
            )}
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
            <span className="text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30 animate-pulse">
              🐋 Whale Alert
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
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Price History (YES contract)
          </p>
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
            { label: "Entry",    val: fmtCents(m.entryPrice),  color: "text-yellow-400" },
            { label: "Target",   val: fmtCents(m.exitTarget),  color: ""                },
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

// ── Market Card ───────────────────────────────────────────────────────────────
function MarketCard({ m, onClick }: { m: PredMkt; onClick: () => void }) {
  const cfg = RATING_CONFIG[m.priceRating] ?? RATING_CONFIG.fair;
  const countdown = timeUntil(m.gameTime);

  return (
    <button
      onClick={onClick}
      className="rounded-xl border p-4 flex flex-col gap-3 relative overflow-hidden text-left w-full transition-all hover:scale-[1.01] hover:shadow-lg cursor-pointer"
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      {m.isWhaleAlert && (
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)" }} />
      )}
      {/* Click hint */}
      <div className="absolute top-2 right-2 text-[9px] text-muted-foreground/50 font-medium">tap for chart ›</div>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 pr-12">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: SOURCE_COLOR[m.source] }}>
            {m.source === "kalshi" ? "Kalshi" : "Polymarket"} · <span className="text-muted-foreground">{m.sport}</span>
            {countdown && <span className="ml-2 font-semibold text-orange-400">⏰ {countdown}</span>}
          </p>
          <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{m.title}</p>
          {m.event !== m.title && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.event}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border"
            style={{ color: cfg.color, borderColor: cfg.border, background: "transparent" }}>
            {cfg.icon} {cfg.label}
          </span>
          {m.isWhaleAlert && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30 animate-pulse">
              🐋 Whale
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
          <p className="text-[9px] text-muted-foreground uppercase">Entry</p>
          <p className="font-mono font-bold text-sm text-yellow-400">{fmtCents(m.entryPrice)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Target</p>
          <p className="font-mono font-bold text-sm" style={{ color: cfg.color }}>{fmtCents(m.exitTarget)}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-white/5">
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
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PredictionMarkets() {
  const [sportFilter, setSportFilter]   = useState("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "kalshi" | "polymarket">("all");
  const [search, setSearch]             = useState("");
  const [lastRefresh, setLastRefresh]   = useState(Date.now());
  const [selected, setSelected]         = useState<PredMkt | null>(null);

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

  const filtered = markets.filter(m => {
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
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-black text-foreground tracking-tight">Prediction Markets</h1>
          <button
            onClick={() => { refetch(); setLastRefresh(Date.now()); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
          >
            <RefreshCw size={12} /> Refresh
          </button>
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
        <div className="flex gap-2">
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
