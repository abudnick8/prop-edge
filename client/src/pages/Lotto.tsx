import { useQuery } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Ticket, Search, SlidersHorizontal, RefreshCw, Home, Target, Crosshair, CircleDot } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

// ── Strict lotto stat types per sport ────────────────────────────────────────
// MLB  → Home Runs only
// NHL  → Goals only
// NFL  → Touchdowns only (anytime td, 1st td)
// NBA  → Points only

const LOTTO_STAT_RULES: Record<string, { label: string; keywords: string[]; icon: string; description: string }> = {
  MLB: {
    label: "Home Runs",
    keywords: ["home run", "home_run", "batter_home_runs", "home runs"],
    icon: "⚾",
    description: "Anytime Home Run props",
  },
  NHL: {
    label: "Goals",
    keywords: ["player_goals", "— goals", "goals o/u", "goals", "anytime goal"],
    icon: "🏒",
    description: "Anytime Goal / Goals O/U props",
  },
  NFL: {
    label: "Touchdowns",
    keywords: ["touchdown", "anytime_td", "anytime td", "1st_td", "1st td", "first td", "player_td"],
    icon: "🏈",
    description: "Anytime Touchdown props",
  },
  NBA: {
    label: "Points",
    keywords: ["player_points", "— points", "points o/u", " points "],
    icon: "🏀",
    description: "Points O/U props (not PRA, not pts+reb, not pts+ast)",
  },
};

// These sports are supported for lotto — others (NCAAB, etc.) are excluded
const LOTTO_SPORTS = ["NBA", "MLB", "NHL", "NFL"] as const;

const LOTTO_MIN = 5;
const LOTTO_MAX = 20;

const SOURCES = ["All", "kalshi", "polymarket", "actionnetwork", "draftkings", "underdog"];

function isTodayOrNoDate(gameTime: string | null | undefined): boolean {
  if (!gameTime) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const gt = new Date(gameTime);
  return gt >= today && gt < tomorrow;
}

/**
 * Returns true if this bet is the correct lotto stat type for its sport.
 * Strict matching — e.g. NBA Points must NOT match PRA, pts+reb, etc.
 */
function matchesLottoStat(bet: Bet): boolean {
  const rule = LOTTO_STAT_RULES[bet.sport];
  if (!rule) return false;

  const title = bet.title.toLowerCase();
  const desc = (bet.description ?? "").toLowerCase();
  const researchSummary = (bet.researchSummary ?? "").toLowerCase();

  // NBA Points: must match "points" but NOT combo props
  if (bet.sport === "NBA") {
    const hasPoints =
      title.includes("— points") ||
      title.includes("points o/u") ||
      title.includes("points @") ||
      // Underdog / Kalshi style: "Over X Points" or "Points" standalone
      /\bpoints\b/.test(title);
    if (!hasPoints) return false;
    // Exclude combo props
    const isCombo =
      title.includes("rebounds") ||
      title.includes("assists") ||
      title.includes("blocks") ||
      title.includes("steals") ||
      title.includes("threes") ||
      title.includes("pra") ||
      title.includes("pts+") ||
      title.includes("pts &");
    return !isCombo;
  }

  // MLB Home Runs: must match home run keywords
  if (bet.sport === "MLB") {
    return (
      title.includes("home run") ||
      title.includes("home_run") ||
      title.includes("batter_home_runs") ||
      title.includes("— home runs")
    );
  }

  // NHL Goals: must match goal keywords but NOT assists or shots
  if (bet.sport === "NHL") {
    const hasGoal =
      title.includes("— goals") ||
      title.includes("goals o/u") ||
      title.includes("anytime goal") ||
      /\bgoals\b/.test(title);
    if (!hasGoal) return false;
    const isNotGoal =
      title.includes("assists") ||
      title.includes("shots") ||
      title.includes("points") ||
      title.includes("sog");
    return !isNotGoal;
  }

  // NFL Touchdowns: anytime td, 1st td
  if (bet.sport === "NFL") {
    return (
      title.includes("touchdown") ||
      title.includes("anytime td") ||
      title.includes("anytime_td") ||
      title.includes("1st td") ||
      title.includes("1st_td") ||
      title.includes("first td") ||
      title.includes("to score")
    );
  }

  return false;
}

export default function Lotto() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const { data: bets = [], isLoading, dataUpdatedAt, refetch } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  // ── Determine which sports have games today ───────────────────────────────
  const sportsWithGamesToday = new Set<string>();
  bets.forEach((b) => {
    if (LOTTO_SPORTS.includes(b.sport as any) && isTodayOrNoDate(b.gameTime as any)) {
      sportsWithGamesToday.add(b.sport);
    }
    if (LOTTO_SPORTS.includes(b.sport as any) && b.betType === "player_prop") {
      sportsWithGamesToday.add(b.sport);
    }
  });

  // ── Search helper ─────────────────────────────────────────────────────────
  function matchesSearch(b: Bet): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      b.title.toLowerCase().includes(q) ||
      (b.playerName ?? "").toLowerCase().includes(q) ||
      (b.homeTeam ?? "").toLowerCase().includes(q) ||
      (b.awayTeam ?? "").toLowerCase().includes(q) ||
      (b.description ?? "").toLowerCase().includes(q) ||
      (b.researchSummary ?? "").toLowerCase().includes(q) ||
      (b.keyFactors ?? []).some((kf) => kf.toLowerCase().includes(q))
    );
  }

  // ── Build per-sport lotto buckets ─────────────────────────────────────────
  // Rules:
  //   • Only NBA/MLB/NHL/NFL
  //   • Only the specific stat for that sport (HR / Goals / TDs / Points)
  //   • isLotto = true (high-risk/high-reward; +150 or better)
  //   • Apply search/source/minScore filters
  //   • Sort confidence desc — MLB props auto-sort higher on ties
  //   • Min 5 / max 20 per sport
  const lottoBySport: Record<string, Bet[]> = {};

  for (const sport of LOTTO_SPORTS) {
    if (!sportsWithGamesToday.has(sport)) continue;

    // All bets for this sport that match the strict stat rule
    const statMatched = bets.filter(
      (b) =>
        b.sport === sport &&
        b.betType === "player_prop" &&
        matchesLottoStat(b)
    );

    // Apply isLotto, source, score, and search filters
    const candidates = statMatched
      .filter(
        (b) =>
          b.isLotto === true &&
          (source === "All" || b.source === source) &&
          (b.confidenceScore ?? 0) >= minScore &&
          matchesSearch(b)
      )
      .sort((a, z) => {
        const d = (z.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
        if (d !== 0) return d;
        // MLB tiebreaker: auto-pull MLB to top
        const ap = a.sport === "MLB" ? 1 : 0;
        const bp = z.sport === "MLB" ? 1 : 0;
        return bp - ap;
      });

    // If fewer than LOTTO_MIN exist but we have ANY, generate additional picks
    // by relaxing the isLotto flag (still must match stat type)
    let finalPicks = candidates;
    if (candidates.length < LOTTO_MIN) {
      // Fill to LOTTO_MIN with non-lotto stat-matching props (sorted by confidence)
      const extras = statMatched
        .filter(
          (b) =>
            !candidates.find((c) => c.id === b.id) &&
            (source === "All" || b.source === source) &&
            (b.confidenceScore ?? 0) >= minScore &&
            matchesSearch(b)
        )
        .sort((a, z) => (z.confidenceScore ?? 0) - (a.confidenceScore ?? 0));

      const needed = LOTTO_MIN - candidates.length;
      finalPicks = [...candidates, ...extras.slice(0, needed)];
    }

    // Cap at LOTTO_MAX
    if (finalPicks.length > 0) {
      lottoBySport[sport] = finalPicks.slice(0, LOTTO_MAX);
    }
  }

  // Only show sports that have at least 1 qualifying pick
  const activeSports = LOTTO_SPORTS.filter((s) => lottoBySport[s]?.length > 0);
  const totalLotto = activeSports.reduce((sum, s) => sum + lottoBySport[s].length, 0);
  const hasActiveFilters = source !== "All" || minScore > 0 || search.trim().length > 0;

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
            {totalLotto} picks across {activeSports.length} sport{activeSports.length !== 1 ? "s" : ""} · 5–20 per sport
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

      {/* Stat legend banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(["MLB", "NHL", "NFL", "NBA"] as const).map((sport) => {
          const rule = LOTTO_STAT_RULES[sport];
          const isActive = sportsWithGamesToday.has(sport);
          return (
            <div
              key={sport}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-opacity ${
                isActive
                  ? "bg-amber-500/5 border-amber-500/20"
                  : "bg-muted/30 border-border opacity-40"
              }`}
            >
              <span className="text-base">{rule.icon}</span>
              <div>
                <p className="text-[10px] font-bold text-foreground leading-tight">{sport}</p>
                <p className="text-[10px] text-amber-400 leading-tight font-semibold">{rule.label}</p>
              </div>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <Ticket size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-400 mb-0.5">High-Reward / High-Risk Props</p>
          <p className="text-xs text-muted-foreground">
            MLB: Home Runs · NHL: Goals · NFL: Touchdowns · NBA: Points — props priced at +150 or better.
            5 to 20 picks per active sport, ranked by confidence. Refreshes automatically.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player, team, or game..."
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
            Lotto shows: MLB Home Runs, NHL Goals, NFL Touchdowns, and NBA Points — priced +150 or better.
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
            const rule = LOTTO_STAT_RULES[sport];
            const atMax = sportBets.length >= LOTTO_MAX;

            return (
              <div key={sport} className="space-y-3">
                {/* Sport section header */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{rule.icon}</span>
                    <h2 className="text-base font-bold text-foreground">{sport}</h2>
                    <span className="text-xs font-semibold text-amber-400">— {rule.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                      LOTTO
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {sportBets.length} pick{sportBets.length !== 1 ? "s" : ""}
                      {atMax ? " · max 20" : ""}
                    </span>
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
