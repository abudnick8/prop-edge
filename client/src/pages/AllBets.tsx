import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, SlidersHorizontal, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { filterByDay, countByDay, DayFilter } from "@/lib/dateFilter";

const SPORTS = ["All", "NFL", "NBA", "MLB", "NHL", "MMA", "Boxing", "NCAAB", "NCAAF", "Golf"];
const BET_TYPES = ["All", "player_prop", "spread", "total", "moneyline"];
const SOURCES = ["All", "kalshi", "polymarket", "draftkings", "underdog"];

export default function AllBets() {
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState("All");
  const [betType, setBetType] = useState("All");
  const [source, setSource] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");

  const { data: bets = [], isLoading } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  // 1. Day filter first
  const dayBets = filterByDay(bets, dayFilter);

  // 2. Then remaining filters
  const filtered = dayBets.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch = !q || b.title.toLowerCase().includes(q) || (b.playerName ?? "").toLowerCase().includes(q);
    const matchSport = sport === "All" || b.sport === sport;
    const matchType = betType === "All" || b.betType === betType;
    const matchSource = source === "All" || b.source === source;
    const matchScore = (b.confidenceScore ?? 0) >= minScore;
    return matchSearch && matchSport && matchType && matchSource && matchScore;
  });

  // Badge counts
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const DAY_TABS: { key: DayFilter; label: string; sub: string; count: number }[] = [
    { key: "today",    label: "Today",    sub: fmtDay(today),    count: countByDay(bets, "today")    },
    { key: "tomorrow", label: "Tomorrow", sub: fmtDay(tomorrow), count: countByDay(bets, "tomorrow") },
    { key: "all",      label: "All Bets", sub: "incl. futures",  count: bets.length                  },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">All Picks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {bets.length} markets
          </p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            showFilters ? "bg-primary/10 text-primary border-primary/30" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <SlidersHorizontal size={14} />
          Filters
        </button>
      </div>

      {/* Day Filter Tabs */}
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
                  dayFilter === tab.key
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {tab.count}
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">{tab.sub}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search picks, players, teams..."
          className="pl-9 bg-card border-border"
          data-testid="input-search"
        />
      </div>

      {/* Filters */}
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

      {/* Bet Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array(9).fill(0).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <Filter size={32} className="mx-auto text-muted-foreground mb-3" />
          {dayBets.length === 0 && bets.length > 0 ? (
            <>
              <p className="text-sm font-medium text-foreground">
                No {dayFilter === "today" ? "today's" : "tomorrow's"} games found
              </p>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                No games scheduled for this day — try All Bets to see upcoming games and futures
              </p>
              <button
                onClick={() => setDayFilter("all")}
                className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
              >
                Show All Bets
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">No picks match your filters</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting the search or filters</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((bet) => (
            <BetCard key={bet.id} bet={bet} />
          ))}
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
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {opt === "player_prop" ? "Props" : opt === "All" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
