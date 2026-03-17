import { useQuery } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Ticket, Search, SlidersHorizontal, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

const SPORTS = ["All", "NFL", "NBA", "MLB", "NHL", "MMA", "Boxing", "NCAAB", "NCAAF", "Golf"];
const BET_TYPES = ["All", "player_prop", "spread", "total", "moneyline"];
const SOURCES = ["All", "kalshi", "polymarket", "actionnetwork", "draftkings", "underdog"];

export default function Lotto() {
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("All");
  const [betType, setBetType] = useState("All");
  const [source, setSource] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const { data: bets = [], isLoading } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  // Bet type keyword aliases
  const BET_TYPE_KEYWORDS: Record<string, string[]> = {
    "HR": ["home run", "home_run", "batter_home_runs"],
    "TD": ["touchdown", "anytime_td", "anytime td"],
    "RBI": ["rbi", "batter_rbis"],
    "K": ["strikeout", "pitcher_strikeouts"],
    "3PT": ["three", "threes", "player_threes"],
    "AST": ["assist", "player_assists"],
    "REB": ["rebound", "player_rebounds"],
    "PTS": ["point", "player_points"],
    "SOG": ["shot", "shots_on_goal"],
    "GOAL": ["goal", "player_goals"],
  };

  // Apply search/sport/type/source/score filters
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
      const matchSport = sport === "All" || b.sport === sport;
      const matchType = betType === "All" || b.betType === betType;
      const matchSource = source === "All" || b.source === source;
      const matchScore = (b.confidenceScore ?? 0) >= minScore;
      return matchSearch && matchSport && matchType && matchSource && matchScore;
    });
  }

  // Lotto: top 10 high-payout / low-probability props sorted by confidence score
  const lottoBets = applyFilters(
    bets
      .filter((b) => b.isLotto === true)
      .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
  ).slice(0, 10);

  const hasActiveFilters = sport !== "All" || betType !== "All" || source !== "All" || minScore > 0 || search.trim().length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Ticket size={20} className="text-amber-400" />
            <h1 className="text-xl font-bold text-foreground">Lotto Picks</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {lottoBets.length} of 10 max · High-reward / high-risk props
          </p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            showFilters || hasActiveFilters
              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
          data-testid="button-lotto-filters"
        >
          <SlidersHorizontal size={14} />
          Filters
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" />
          )}
        </button>
      </div>

      {/* Amber info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <Ticket size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-400 mb-0.5">High-Reward / High-Risk Props</p>
          <p className="text-xs text-muted-foreground">
            Low-probability bets (≥+150 implied) on rare game events — home runs, touchdowns, goals, blocks, steals.
            These pay more but hit less often. Top 10 ranked by confidence score.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player, team, or keyword (HR, TD, K, REB, AST...)"
          className="pl-9 bg-card border-border"
          data-testid="input-lotto-search"
        />
      </div>

      {/* Filters panel */}
      {showFilters && (
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
                className="w-full accent-amber-500"
                data-testid="input-lotto-min-score"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0</span>
                <span className="text-amber-400 font-bold">80+ 🎰</span>
                <span>95</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : lottoBets.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-amber-500/20 rounded-xl">
          <Ticket size={32} className="mx-auto text-amber-400/40 mb-3" />
          <p className="text-sm font-medium text-foreground">No lotto props available right now</p>
          <p className="text-xs text-muted-foreground mt-1">
            Lotto picks appear when high-payout props (HR, TD, Goals, etc.) are in the market
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setSport("All"); setBetType("All"); setSource("All"); setMinScore(0); }}
              className="mt-3 text-xs px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground font-medium">
              Ranked by confidence · top {lottoBets.length}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
              LOTTO MODE
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {lottoBets.map((bet, idx) => (
              <div key={bet.id} className="relative">
                {/* Rank badge */}
                <div className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center shadow-md">
                  {idx + 1}
                </div>
                {/* Amber glow ring on top lotto picks */}
                <div className={`rounded-xl ${
                  idx === 0
                    ? "ring-2 ring-amber-400/50 shadow-[0_0_16px_rgba(245,158,11,0.15)]"
                    : idx < 3
                    ? "ring-1 ring-amber-500/30"
                    : ""
                }`}>
                  <BetCard bet={bet} />
                </div>
              </div>
            ))}
          </div>
        </div>
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
                ? "bg-amber-500 text-black"
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
