import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Zap, AlertTriangle, DollarSign, BarChart2, RefreshCw, ExternalLink } from "lucide-react";
import { addWsListener } from "@/hooks/useWebSocket";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PredMkt {
  id: string;
  source: "kalshi" | "polymarket";
  title: string;
  event: string;
  sport: string;
  yesPrice: number;
  noPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  vol24h: number;
  volSpike: number;
  ph1: number;   // 1h price change %
  pd1: number;   // 1d price change %
  fairValue: number;
  edge: number;
  priceRating: "fair" | "good_buy" | "great_buy" | "overpriced";
  entryPrice: number;
  exitTarget: number;
  isWhaleAlert: boolean;
  whaleDirection: "yes" | "no" | null;
  whalePriceMovePct: number;
  gameTime: string | null;
  polyUrl?: string;
  kalshiUrl?: string;
}

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
  great_buy:  { label: "Great Buy",   color: "#22c55e", bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.35)",  icon: "🔥" },
  good_buy:   { label: "Good Buy",    color: "#86efac", bg: "rgba(134,239,172,0.08)", border: "rgba(134,239,172,0.25)", icon: "✅" },
  fair:       { label: "Fair Price",  color: "#94a3b8", bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.18)", icon: "⚖️" },
  overpriced: { label: "Overpriced",  color: "#ef4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.30)",  icon: "⚠️" },
};

const SOURCE_COLOR = { kalshi: "#f59e0b", polymarket: "#6366f1" };

// ── Market Card ───────────────────────────────────────────────────────────────
function MarketCard({ m }: { m: PredMkt }) {
  const cfg = RATING_CONFIG[m.priceRating] ?? RATING_CONFIG.fair;
  const countdown = timeUntil(m.gameTime);
  const url = m.polyUrl ?? m.kalshiUrl ?? "#";
  const roi = m.entryPrice > 0 ? ((m.exitTarget - m.entryPrice) / m.entryPrice * 100) : 0;

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3 relative overflow-hidden"
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      {/* Whale banner */}
      {m.isWhaleAlert && (
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)" }} />
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: SOURCE_COLOR[m.source] }}>
            {m.source === "kalshi" ? "Kalshi" : "Polymarket"}
            {countdown && (
              <span className="ml-2 font-semibold text-orange-400">⏰ {countdown} left</span>
            )}
          </p>
          <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{m.title}</p>
          {m.event !== m.title && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.event}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border"
            style={{ color: cfg.color, borderColor: cfg.border, background: "transparent" }}
          >
            {cfg.icon} {cfg.label}
          </span>
          {m.isWhaleAlert && (
            <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30 animate-pulse">
              🐋 Whale Alert
            </span>
          )}
        </div>
      </div>

      {/* Whale Smart Money block */}
      {m.isWhaleAlert && (
        <div className="rounded-lg px-3 py-2 border" style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.35)" }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-orange-300 mb-1">🐋 Smart Money Signal</p>
          <div className="flex items-center gap-4 text-xs">
            <div>
              <p className="text-[9px] text-muted-foreground uppercase">Direction</p>
              <p className="font-bold" style={{ color: m.whaleDirection === "yes" ? "#22c55e" : "#ef4444" }}>
                {m.whaleDirection === "yes" ? "▲ Buying YES" : "▼ Buying NO"}
              </p>
            </div>
            {m.ph1 !== 0 && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">1h Move</p>
                <p className="font-mono font-bold" style={{ color: m.ph1 >= 0 ? "#22c55e" : "#ef4444" }}>
                  {fmtPct(m.ph1)}
                </p>
              </div>
            )}
            {m.volSpike > 1 && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Vol Spike</p>
                <p className="font-mono font-bold text-orange-300">{m.volSpike.toFixed(1)}x avg</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Price grid */}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">YES</p>
          <p className="font-mono font-black text-base text-foreground">{fmtCents(m.yesPrice)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Fair</p>
          <p className="font-mono font-bold text-sm" style={{ color: "#22d3ee" }}>{fmtCents(m.fairValue)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Entry</p>
          <p className="font-mono font-bold text-sm text-yellow-400">{fmtCents(m.entryPrice)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Target</p>
          <p className="font-mono font-bold text-sm" style={{ color: cfg.color }}>{fmtCents(m.exitTarget)}</p>
        </div>
      </div>

      {/* Buy/Sell recommendation */}
      {m.priceRating !== "fair" && (
        <div
          className="rounded-lg px-3 py-2 border"
          style={{ background: m.priceRating === "overpriced" ? "rgba(239,68,68,0.07)" : "rgba(34,197,94,0.07)", borderColor: m.priceRating === "overpriced" ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                {m.priceRating === "overpriced" ? "Recommendation" : "Buy Signal"}
              </p>
              <p className="text-xs font-bold mt-0.5" style={{ color: m.priceRating === "overpriced" ? "#ef4444" : "#22c55e" }}>
                {m.priceRating === "overpriced"
                  ? `Avoid YES · Buy NO at ${fmtCents(m.noPrice)}`
                  : `Buy YES at ${fmtCents(m.entryPrice)} → Exit ${fmtCents(m.exitTarget)}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Edge / ROI</p>
              <p className="font-mono font-bold text-xs" style={{ color: "#a3e635" }}>
                {m.edge > 0 ? "+" : ""}{m.edge}% · {roi > 0 ? "+" : ""}{roi.toFixed(1)}% ROI
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer: spread, volume, 1d change, link */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-white/5">
        <div className="flex items-center gap-3">
          <span title="Bid-ask spread">Spread {m.spread}¢</span>
          {m.vol24h > 0 && <span title="24h volume">Vol {fmtVol(m.vol24h)}</span>}
          {m.pd1 !== 0 && (
            <span style={{ color: m.pd1 >= 0 ? "#22c55e" : "#ef4444" }} title="1-day price change">
              {fmtPct(m.pd1)} 1d
            </span>
          )}
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] hover:text-foreground transition-colors"
          onClick={e => e.stopPropagation()}
        >
          Trade <ExternalLink size={9} />
        </a>
      </div>
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────
type FilterTab = "all" | "whale" | "great_buy" | "good_buy" | "fair" | "overpriced";
const FILTER_TABS: { id: FilterTab; label: string; emoji: string }[] = [
  { id: "all",       label: "All",         emoji: "🌐" },
  { id: "whale",     label: "Whale Alerts", emoji: "🐋" },
  { id: "great_buy", label: "Great Buys",  emoji: "🔥" },
  { id: "good_buy",  label: "Good Buys",   emoji: "✅" },
  { id: "fair",      label: "Fair",        emoji: "⚖️" },
  { id: "overpriced",label: "Overpriced",  emoji: "⚠️" },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PredictionMarkets() {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "kalshi" | "polymarket">("all");
  const [search, setSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const { data: markets = [], isLoading, refetch } = useQuery<PredMkt[]>({
    queryKey: ["/api/prediction-markets"],
    queryFn: () => apiRequest("GET", "/api/prediction-markets").then(r => r.json()),
    refetchInterval: 30_000,
  });

  // Listen for price:tick — auto-refresh
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
    if (filter === "whale" && !m.isWhaleAlert) return false;
    if (filter !== "all" && filter !== "whale" && m.priceRating !== filter) return false;
    if (sourceFilter !== "all" && m.source !== sourceFilter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase()) && !m.event.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Summary stats
  const whaleCount    = markets.filter(m => m.isWhaleAlert).length;
  const greatBuyCount = markets.filter(m => m.priceRating === "great_buy").length;
  const goodBuyCount  = markets.filter(m => m.priceRating === "good_buy").length;
  const overpricedCount = markets.filter(m => m.priceRating === "overpriced").length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-black text-foreground tracking-tight">Prediction Markets</h1>
          <button
            onClick={() => { refetch(); setLastRefresh(Date.now()); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Kalshi + Polymarket · Live pricing · Refreshes every 30s ·{" "}
          <span className="text-primary">Last updated {new Date(lastRefresh).toLocaleTimeString()}</span>
        </p>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Whale Alerts",  val: whaleCount,      color: "#f97316", bg: "rgba(249,115,22,0.10)" },
          { label: "Great Buys",    val: greatBuyCount,   color: "#22c55e", bg: "rgba(34,197,94,0.10)"  },
          { label: "Good Buys",     val: goodBuyCount,    color: "#86efac", bg: "rgba(134,239,172,0.08)"},
          { label: "Overpriced",    val: overpricedCount, color: "#ef4444", bg: "rgba(239,68,68,0.08)"  },
        ].map(s => (
          <div key={s.label} className="rounded-xl border px-4 py-3" style={{ borderColor: s.color + "44", background: s.bg }}>
            <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: s.color }}>{s.label}</p>
            <p className="text-2xl font-black text-foreground">{isLoading ? "—" : s.val}</p>
          </div>
        ))}
      </div>

      {/* Source + Search row */}
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
                color: s === "kalshi" ? "#f59e0b" : s === "polymarket" ? "#818cf8" : "#fff",
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

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
              filter === tab.id
                ? "text-foreground border-primary/50 bg-primary/15"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.emoji} {tab.label}
            {tab.id === "whale"     && whaleCount > 0     && <span className="ml-1.5 text-orange-400">{whaleCount}</span>}
            {tab.id === "great_buy" && greatBuyCount > 0  && <span className="ml-1.5 text-green-400">{greatBuyCount}</span>}
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
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-semibold">No markets match your filters</p>
          <p className="text-xs mt-1">Try adjusting the filter or refreshing</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(m => <MarketCard key={m.id} m={m} />)}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center mt-8">
        Price ratings and fair value are model estimates — not financial advice. Always verify before trading.
      </p>
    </div>
  );
}
