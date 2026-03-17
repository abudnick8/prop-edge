import { useQuery } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Ticket, Search, SlidersHorizontal, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

// MLB player props win tiebreakers on equal confidence scores
const SPORT_PRIORITY: Record<string, number> = { MLB: 3, NBA: 2, NHL: 1, NFL: 1 };

// Sports shown in display order
const SPORT_ORDER = ["NBA", "MLB", "NHL", "NFL", "NCAAB", "NCAAF"];

const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀", MLB: "⚾", NHL: "🏒", NFL: "🏈", NCAAB: "🏀", NCAAF: "🏈",
};

const SOURCES = ["All", "kalshi", "polymarket", "actionnetwork", "draftkings", "underdog"];

function isTodayOrNoDate(gameTime: string | null | undefined): boolean {
  if (!gameTime) return true; // props without gameTime are considered current
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const gt = new Date(gameTime);
  return gt >= today && gt < tomorrow;
}

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
  "BLK": ["block", "blocks"],
  "STL": ["steal", "steals"],
};

export default function Lotto() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const { data: bets = [], isLoading, dataUpdatedAt, refetch } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  // ── Determine which sports have games today ──────────────────────────────────
  // A sport is "active today" if any bet for that sport has a gameTime today,
  // OR if it has player_props in the feed (Kalshi props often have null gameTime).
  const sportsWithGamesToday = new Set<string>();
  bets.forEach((b) => {
    if (b.gameTime && isTodayOrNoDate(b.gameTime)) {
      sportsWithGamesToday.add(b.sport);
    }
  });
  // Also include sports that have player_props (Kalshi props have null gameTime
  // but are always current/live). We trust the scanner to only store fresh data.
  bets.forEach((b) => {
    if (b.betType === "player_prop") sportsWithGamesToday.add(b.sport);
  });

  // ── Filter helper ─────────────────────────────────────────────────────────────
  function matchesSearch(b: Bet): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const alias = BET_TYPE_KEYWORDS[search.trim().toUpperCase()];
    const searchTerms = alias ? [q, ...alias] : [q];
    return searchTerms.some((term) =>
      b.title.toLowerCase().includes(term) ||
      (b.playerName ?? "").toLowerCase().includes(term) ||
      (b.homeTeam ?? "").toLowerCase().includes(term) ||
      (b.awayTeam ?? "").toLowerCase().includes(term) ||
      (b.description ?? "").toLowerCase().includes(term) ||
      (b.researchSummary ?? "").toLowerCase().includes(term) ||
      (b.keyFactors ?? []).some((kf) => kf.toLowerCase().includes(term))
    );
  }

  // ── Build per-sport lotto buckets ────────────────────────────────────────────
  // Rules:
  //   • Only sports active today
  //   • Only isLotto=true props
  //   • Apply search/source/minScore filters
  //   • Sort by confidence desc (MLB tiebreaker)
  //   • Min 5, max 10 per sport
  const LOTTO_MIN = 5;
  const LOTTO_MAX = 10;

  const lottoBySport: Record<string, Bet[]> = {};

  for (const sport of sportsWithGamesToday) {
    const candidates = bets
      .filter((b) =>
        b.sport === sport &&
        b.isLotto === true &&
        (source === "All" || b.source === source) &&
        (b.confidenceScore ?? 0) >= minScore &&
        matchesSearch(b)
      )
      .sort((a, b) => {
        const d = (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
        if (d !== 0) return d;
        const ap = SPORT_PRIORITY[a.sport] ?? 0;
        const bp = SPORT_PRIORITY[b.sport] ?? 0;
        return bp - ap;
      });

    // Only include this sport if there are at least LOTTO_MIN candidates
    if (candidates.length >= LOTTO_MIN) {
      lottoBySport[sport] = candidates.slice(0, LOTTO_MAX);
    } else if (candidates.length > 0 && candidates.length < LOTTO_MIN) {
      // Still show what we have (don't hide) — pad label will say "only X found"
      lottoBySport[sport] = candidates;
    }
  }

  // Active sports in display order
  const activeSports = SPORT_ORDER.filter((s) => lottoBySport[s] !== undefined);
  // Append any that aren't in SPORT_ORDER
  Object.keys(lottoBySport).forEach((s) => {
    if (!activeSports.includes(s)) activeSports.push(s);
  });

  const totalLotto = activeSports.reduce((sum, s) => sum + lottoBySport[s].length, 0);
  const hasActiveFilters = source !== "All" || minScore > 0 || search.trim().length > 0;

  // Last updated string
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

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
            {totalLotto} picks across {activeSports.length} sport{activeSports.length !== 1 ? "s" : ""} · 5–10 per sport
            {lastUpdated && (
              <span className="ml-2 text-muted-foreground/60">· updated {lastUpdated}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Refresh lotto picks"
            data-testid="button-lotto-refresh"
          >
            <RefreshCw size={14} />
          </button>
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
      </div>

      {/* Amber info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <Ticket size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-400 mb-0.5">High-Reward / High-Risk Props</p>
          <p className="text-xs text-muted-foreground">
            Player props priced at +150 or better ({"<"}40% implied). Higher payout, lower hit rate.
            5–10 best picks per active sport, ranked by confidence. Refreshes automatically as games finish.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player, team, or keyword (HR, TD, BLK, STL, GOAL...)"
          className="pl-9 bg-card border-border"
          data-testid="input-lotto-search"
        />
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setSource("All"); setMinScore(0); }}
              className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-lg border border-border hover:text-foreground transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-8">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-8 w-40 rounded-lg" />
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array(5).fill(0).map((_, j) => <Skeleton key={j} className="h-44 rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : activeSports.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-amber-500/20 rounded-xl">
          <Ticket size={32} className="mx-auto text-amber-400/40 mb-3" />
          <p className="text-sm font-medium text-foreground">No lotto picks available right now</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Lotto picks appear when player props priced at +150 or better are in the market.
            {hasActiveFilters ? " Try clearing your filters." : " Check back as games approach."}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setSource("All"); setMinScore(0); }}
              className="mt-3 text-xs px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {activeSports.map((sport) => {
            const sportBets = lottoBySport[sport];
            const belowMin = sportBets.length < LOTTO_MIN;
            return (
              <div key={sport} className="space-y-3">
                {/* Sport section header */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{SPORT_EMOJI[sport] ?? "🎰"}</span>
                    <h2 className="text-base font-bold text-foreground">{sport}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                      LOTTO MODE
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {sportBets.length} pick{sportBets.length !== 1 ? "s" : ""}
                      {!belowMin ? ` · top ${LOTTO_MAX} max` : ""}
                    </span>
                    {belowMin && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        limited props today
                      </span>
                    )}
                  </div>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Ranked card grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {sportBets.map((bet, idx) => (
                    <div key={bet.id} className="relative">
                      {/* Rank badge */}
                      <div className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center shadow-md">
                        {idx + 1}
                      </div>
                      {/* Glow ring for top picks */}
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
            );
          })}
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
            {opt === "actionnetwork" ? "ActionNetwork" : opt === "All" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
