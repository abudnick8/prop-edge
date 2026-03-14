import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";

const SPORTS = ["All", "NFL", "NBA", "MLB", "NHL"];
const BET_TYPES = ["All", "player_prop", "spread", "total", "moneyline"];
const SOURCES = ["All", "kalshi", "polymarket", "draftkings", "underdog"];

export default function AllBets() {
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

  const filtered = bets.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch = !q || b.title.toLowerCase().includes(q) || (b.playerName ?? "").toLowerCase().includes(q);
    const matchSport = sport === "All" || b.sport === sport;
    const matchType = betType === "All" || b.betType === betType;
    const matchSource = source === "All" || b.source === source;
    const matchScore = (b.confidenceScore ?? 0) >= minScore;
    return matchSearch && matchSport && matchType && matchSource && matchScore;
  });

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
          <p className="text-sm font-medium text-foreground">No picks match your filters</p>
          <p className="text-xs text-muted-foreground mt-1">Try adjusting the search or filters</p>
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
