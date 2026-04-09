import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { addWsListener } from "@/hooks/useWebSocket";

// MLB player props win tiebreakers on equal confidence scores
const SPORT_PRIORITY: Record<string, number> = { MLB: 3, NBA: 2, NHL: 1, NFL: 1 };
function byConfThenSport(a: Bet, b: Bet): number {
  const d = (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  if (d !== 0) return d;
  const ap = a.betType === "player_prop" ? (SPORT_PRIORITY[a.sport] ?? 0) : 0;
  const bp = b.betType === "player_prop" ? (SPORT_PRIORITY[b.sport] ?? 0) : 0;
  return bp - ap;
}
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, SlidersHorizontal, Calendar, Trophy, TrendingUp, TrendingDown, Zap, RefreshCw, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { filterByDay, countByDay, DayFilter } from "@/lib/dateFilter";
import { useBookErrors, BookErrorsFilterButton, BookErrorsSection } from "@/components/BookErrors";
import { CheatSheetButton } from "@/components/CheatSheet";

const SPORTS = ["All", "NFL", "NBA", "MLB", "NHL", "MMA", "Boxing", "NCAAB", "NCAAF", "Golf"];
const BET_TYPES = ["All", "player_prop", "spread", "total", "moneyline"];
const SOURCES = ["All", "kalshi", "polymarket", "actionnetwork", "draftkings", "underdog", "sportsgameodds"];

type MainTab = "daily" | "season" | "markets";

// ─── Prediction Markets types ─────────────────────────────────────────────────
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
  smartScore: number;
  gameTime: string | null;
  polyUrl?: string;
  kalshiUrl?: string;
}

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
  great_buy:  { label: "Great Buy",   color: "#22c55e", bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.35)",   icon: "🔥" },
  good_buy:   { label: "Good Buy",    color: "#86efac", bg: "rgba(134,239,172,0.08)", border: "rgba(134,239,172,0.25)", icon: "✅" },
  fair:       { label: "Fair Price",  color: "#94a3b8", bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.18)", icon: "⚖️" },
  overpriced: { label: "Overpriced",  color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.30)",   icon: "⚠️" },
};
const SOURCE_COLOR = { kalshi: "#f59e0b", polymarket: "#6366f1" };

type MktFilter = "all" | "whale" | "great_buy" | "good_buy" | "fair" | "overpriced";
const MKT_FILTER_TABS: { id: MktFilter; label: string; emoji: string }[] = [
  { id: "all",        label: "All",          emoji: "🌐" },
  { id: "whale",      label: "Whale Alerts", emoji: "🐋" },
  { id: "great_buy",  label: "Great Buys",   emoji: "🔥" },
  { id: "good_buy",   label: "Good Buys",    emoji: "✅" },
  { id: "fair",       label: "Fair",         emoji: "⚖️" },
  { id: "overpriced", label: "Overpriced",   emoji: "⚠️" },
];

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
      {m.isWhaleAlert && (
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)" }} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: SOURCE_COLOR[m.source] }}>
            {m.source === "kalshi" ? "Kalshi" : "Polymarket"}
            {(m.signalCount ?? 1) > 1 && (
              <span className="ml-2 text-cyan-400 font-semibold">{m.signalCount} sources</span>
            )}
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
              🐋 Whale{m.smartScore > 0 ? ` · ${m.smartScore}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Whale smart money */}
      {m.isWhaleAlert && (
        <div className="rounded-lg px-3 py-2 border" style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.35)" }}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-300">🐋 Smart Money Signal</p>
            {m.smartScore > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Whale Score</span>
                <span
                  className="text-sm font-black font-mono px-2 py-0.5 rounded-md"
                  style={{
                    color: m.smartScore >= 70 ? "#f97316" : m.smartScore >= 40 ? "#f59e0b" : "#fbbf24",
                    background: "rgba(249,115,22,0.15)",
                    border: "1px solid rgba(249,115,22,0.35)",
                  }}
                >
                  {m.smartScore}
                </span>
              </div>
            )}
          </div>
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
                <p className="font-mono font-bold" style={{ color: m.ph1 >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(m.ph1)}</p>
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
          <p className="font-mono font-bold text-sm text-amber-400">{fmtCents(m.entryPrice)}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Target</p>
          <p className="font-mono font-bold text-sm" style={{ color: cfg.color }}>{fmtCents(m.exitTarget)}</p>
        </div>
      </div>

      {/* Buy/sell rec */}
      {m.priceRating !== "fair" && (
        <div
          className="rounded-lg px-3 py-2 border"
          style={{
            background: m.priceRating === "overpriced" ? "rgba(239,68,68,0.07)" : "rgba(34,197,94,0.07)",
            borderColor: m.priceRating === "overpriced" ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)",
          }}
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

      {/* Footer */}
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

// ─── Prediction Markets panel (embedded inside AllBets) ───────────────────────
function PredictionMarketsPanel() {
  const [mktFilter, setMktFilter]       = useState<MktFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "kalshi" | "polymarket">("all");
  const [mktSearch, setMktSearch]       = useState("");
  const [lastRefresh, setLastRefresh]   = useState(Date.now());

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
    if (mktFilter === "whale" && !m.isWhaleAlert) return false;
    if (mktFilter !== "all" && mktFilter !== "whale" && m.priceRating !== mktFilter) return false;
    if (sourceFilter !== "all" && m.source !== sourceFilter) return false;
    if (mktSearch && !m.title.toLowerCase().includes(mktSearch.toLowerCase()) && !m.event.toLowerCase().includes(mktSearch.toLowerCase())) return false;
    return true;
  });

  const whaleCount     = markets.filter(m => m.isWhaleAlert).length;
  const greatBuyCount  = markets.filter(m => m.priceRating === "great_buy").length;
  const goodBuyCount   = markets.filter(m => m.priceRating === "good_buy").length;
  const overpricedCount = markets.filter(m => m.priceRating === "overpriced").length;

  return (
    <div className="space-y-5">
      {/* Sub-header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Kalshi + Polymarket + Manifold · Live pricing · 30s refresh ·{" "}
          <span className="text-primary">Last updated {new Date(lastRefresh).toLocaleTimeString()}</span>
        </p>
        <button
          onClick={() => { refetch(); setLastRefresh(Date.now()); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      {/* Source + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2">
          {(["all", "kalshi", "polymarket"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                sourceFilter === s ? "text-white" : "text-muted-foreground hover:text-foreground"
              }`}
              style={sourceFilter === s ? {
                background: s === "kalshi" ? "rgba(245,158,11,0.25)" : s === "polymarket" ? "rgba(99,102,241,0.25)" : "rgba(19,35,58,0.14)",
                borderColor: s === "kalshi" ? "#f59e0b" : s === "polymarket" ? "#6366f1" : "rgba(19,35,58,0.28)",
                color: s === "kalshi" ? "#f59e0b" : s === "polymarket" ? "#818cf8" : "#fff",
              } : { borderColor: "rgba(19,35,58,0.14)", background: "transparent" }}
            >
              {s === "all" ? "All Sources" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search markets…"
          value={mktSearch}
          onChange={e => setMktSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-muted/50 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {MKT_FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMktFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
              mktFilter === tab.id
                ? "text-foreground border-primary/50 bg-primary/15"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}
          >
            {tab.emoji} {tab.label}
            {tab.id === "whale"     && whaleCount > 0    && <span className="ml-1.5 text-orange-400">{whaleCount}</span>}
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
          <p className="text-xs mt-1">Try adjusting the filter or refreshing</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(m => <MarketCard key={m.id} m={m} />)}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center">
        Fair value uses consensus of Polymarket + Polymarket CLOB + Manifold Markets — not financial advice.
      </p>
    </div>
  );
}

// ─── Main AllBets page ────────────────────────────────────────────────────────
export default function AllBets() {
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("All");
  const [betType, setBetType] = useState("All");
  const [source, setSource] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const { data: bookErrors = [] } = useBookErrors();
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  const [mainTab, setMainTab] = useState<MainTab>("daily");

  // Read URL params to pre-set filters (e.g. ?type=player_prop from Dashboard)
  useEffect(() => {
    const hash = window.location.hash;
    const qIndex = hash.indexOf("?");
    if (qIndex !== -1) {
      const params = new URLSearchParams(hash.slice(qIndex + 1));
      const typeParam = params.get("type");
      if (typeParam && BET_TYPES.includes(typeParam)) {
        setBetType(typeParam);
        setShowFilters(true);
      }
      const filterParam = params.get("filter");
      if (filterParam === "high") {
        setMinScore(80);
        setShowFilters(true);
      }
      // Allow ?tab=markets to deep-link to the markets tab
      if (params.get("tab") === "markets") setMainTab("markets");
    }
  }, []);

  const { data: bets = [], isLoading } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  const dailyBets  = bets.filter((b) => b.betType !== "season_prop" && b.betType !== "futures" && !!b.gameTime);
  const seasonBets = bets.filter((b) => b.betType === "season_prop" || b.betType === "futures" || !b.gameTime);

  const BET_TYPE_KEYWORDS: Record<string, string[]> = {
    "HR":  ["home run", "home_run", "batter_home_runs"],
    "TD":  ["touchdown", "anytime_td", "anytime td"],
    "RBI": ["rbi", "batter_rbis"],
    "K":   ["strikeout", "pitcher_strikeouts"],
    "3PT": ["three", "threes", "player_threes"],
    "AST": ["assist", "player_assists"],
    "REB": ["rebound", "player_rebounds"],
    "PTS": ["point", "player_points"],
    "SOG": ["shot", "shots_on_goal"],
    "GOAL":["goal", "player_goals"],
  };

  function gameHasStarted(b: Bet): boolean {
    if (!b.gameTime) return false;
    return new Date(b.gameTime).getTime() <= Date.now();
  }

  function applyFilters(list: Bet[]): Bet[] {
    return list.filter((b) => {
      const q = search.trim().toLowerCase();
      let matchSearch = true;
      if (q) {
        const alias = BET_TYPE_KEYWORDS[search.trim().toUpperCase()];
        const searchTerms = alias ? [q, ...alias] : [q];
        matchSearch = searchTerms.some((term) =>
          b.title.toLowerCase().includes(term) ||
          (b.playerName ?? "").toLowerCase().includes(term) ||
          (b.homeTeam ?? "").toLowerCase().includes(term) ||
          (b.awayTeam ?? "").toLowerCase().includes(term) ||
          (b.description ?? "").toLowerCase().includes(term) ||
          (b.betType ?? "").toLowerCase().includes(term) ||
          (b.researchSummary ?? "").toLowerCase().includes(term) ||
          (b.keyFactors ?? []).some((kf) => kf.toLowerCase().includes(term))
        );
      }
      const matchSport  = sport === "All" || b.sport === sport;
      const matchType   = betType === "All" || b.betType === betType;
      const matchSource = source === "All" || b.source === source;
      const matchScore  = (b.confidenceScore ?? 0) >= minScore;
      const hideStarted = !q && gameHasStarted(b);
      return matchSearch && matchSport && matchType && matchSource && matchScore && !hideStarted;
    });
  }

  const dayBets      = filterByDay(dailyBets, dayFilter);
  const filteredDaily = applyFilters(dayBets).sort((a, b) => {
    const aProp = a.betType === "player_prop" ? 1 : 0;
    const bProp = b.betType === "player_prop" ? 1 : 0;
    if (bProp !== aProp) return bProp - aProp;
    return byConfThenSport(a, b);
  });
  const filteredSeason = applyFilters(seasonBets).sort(byConfThenSport);

  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const DAY_TABS: { key: DayFilter; label: string; sub: string; count: number }[] = [
    { key: "today",    label: "Today",     sub: fmtDay(today),    count: countByDay(dailyBets, "today")    },
    { key: "tomorrow", label: "Tomorrow",  sub: fmtDay(tomorrow), count: countByDay(dailyBets, "tomorrow") },
    { key: "all",      label: "All Daily", sub: "all upcoming",   count: dailyBets.length                  },
  ];

  const activeCount = mainTab === "daily" ? filteredDaily.length : filteredSeason.length;
  const totalCount  = mainTab === "daily" ? dailyBets.length     : seasonBets.length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">All Picks</h1>
          {mainTab !== "markets" && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {activeCount} of {totalCount} markets
            </p>
          )}
        </div>
        {mainTab !== "markets" && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                showFilters ? "bg-primary/10 text-primary border-primary/30" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              title="Filters"
            >
              <SlidersHorizontal size={14} />
              <span className="hidden sm:inline">Filters</span>
            </button>
            <CheatSheetButton initialSection="howtoread" label="How to Read" mobileIconOnly />
            <BookErrorsFilterButton
              active={showErrorsOnly}
              count={(bookErrors as any[]).length}
              onClick={() => { setShowErrorsOnly(!showErrorsOnly); if (!showErrorsOnly) setShowFilters(false); }}
            />
          </div>
        )}
      </div>

      {/* ── Main Tab Bar: Daily | Season | Pred. Markets ── */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-xl border border-border w-fit flex-wrap">
        <button
          onClick={() => setMainTab("daily")}
          data-testid="tab-main-daily"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mainTab === "daily"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Calendar size={13} />
          Daily Picks
          {dailyBets.length > 0 && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
              mainTab === "daily" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {dailyBets.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab("season")}
          data-testid="tab-main-season"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mainTab === "season"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Trophy size={13} />
          Season Bets
          {seasonBets.length > 0 && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
              mainTab === "season" ? "bg-yellow-500/20 text-amber-400" : "bg-muted text-muted-foreground"
            }`}>
              {seasonBets.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab("markets")}
          data-testid="tab-main-markets"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mainTab === "markets"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap size={13} />
          Pred. Markets
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            mainTab === "markets"
              ? "bg-indigo-500/20 text-indigo-300"
              : "bg-indigo-500/15 text-indigo-400"
          }`}>
            LIVE
          </span>
        </button>
      </div>

      {/* Day Filter Sub-Tabs (Daily only) */}
      {mainTab === "daily" && (
        <div className="flex items-center gap-2 border-b border-border pb-1">
          <Calendar size={14} className="text-muted-foreground mr-1 flex-shrink-0" />
          {DAY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDayFilter(tab.key)}
              data-testid={`tab-day-${tab.key}`}
              className={`relative flex flex-col items-start px-4 py-2 rounded-t-lg text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
                dayFilter === tab.key
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    dayFilter === tab.key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground font-normal">{tab.sub}</span>
            </button>
          ))}
        </div>
      )}

      {/* Season banner */}
      {mainTab === "season" && (
        <div className="flex items-center gap-3 px-4 py-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
          <Trophy size={15} className="text-amber-400 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Season-long futures and championship outrights. No game date — these resolve at the end of the season.
          </p>
        </div>
      )}

      {/* Search (hidden when on markets tab) */}
      {mainTab !== "markets" && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player, team, or keyword (HR, TD, K, REB, AST...)"
            className="pl-9 bg-card border-border"
            data-testid="input-search"
          />
        </div>
      )}

      {/* Filters (hidden when on markets tab) */}
      {showFilters && mainTab !== "markets" && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FilterGroup label="Sport" value={sport} options={SPORTS} onChange={setSport} />
            <FilterGroup label="Bet Type" value={betType} options={BET_TYPES} onChange={setBetType} />
            <FilterGroup label="Source" value={source} options={SOURCES} onChange={setSource} />
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-2">
                Min Confidence: <span className="text-foreground font-mono">{minScore}</span>
              </label>
              <input
                type="range"
                min={0}
                max={95}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full accent-primary"
                data-testid="input-min-score"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0</span>
                <span className="text-primary font-bold">80+ 🔥</span>
                <span>95</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Prediction Markets panel ── */}
      {mainTab === "markets" && <PredictionMarketsPanel />}

      {/* ── Book Errors Section ── */}
      {showErrorsOnly && mainTab !== "markets" && (
        <BookErrorsSection errors={bookErrors as any[]} />
      )}

      {/* ── Bet Grid (daily / season) ── */}
      {!showErrorsOnly && mainTab !== "markets" && (
        <>
          {isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array(9).fill(0).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
            </div>
          ) : mainTab === "daily" && filteredDaily.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <Filter size={32} className="mx-auto text-muted-foreground mb-3" />
              {dayBets.length === 0 && dailyBets.length > 0 ? (
                <>
                  <p className="text-sm font-medium text-foreground">
                    No {dayFilter === "today" ? "today's" : "tomorrow's"} games found
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    No games scheduled for this day — try All Daily
                  </p>
                  <button
                    onClick={() => setDayFilter("all")}
                    className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
                  >
                    Show All Daily
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">No picks match your filters</p>
                  <p className="text-xs text-muted-foreground mt-1">Try adjusting the search or filters</p>
                </>
              )}
            </div>
          ) : mainTab === "season" && filteredSeason.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <Trophy size={32} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">No season futures match your filters</p>
              <p className="text-xs text-muted-foreground mt-1">Try clearing the search or adjusting filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {(mainTab === "daily" ? filteredDaily : filteredSeason).map((bet) => (
                <BetCard key={bet.id} bet={bet} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground font-medium block mb-2">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              value === opt
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {opt === "player_prop" ? "Props" : opt === "actionnetwork" ? "ActionNetwork" : opt === "All" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
