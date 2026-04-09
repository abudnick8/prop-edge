import { useQuery, useMutation } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Target, Zap, TrendingUp, Activity, AlertCircle, BookOpen, ChevronDown, ChevronUp, Calendar, Trophy, Users, MessageCircleQuestion, Send, Sparkles, SlidersHorizontal, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { filterByDay, countByDay, DayFilter } from "@/lib/dateFilter";
import { useBookErrors, BookErrorsFilterButton, BookErrorsSection } from "@/components/BookErrors";
import { CheatSheetButton, CheatSheetDrawer } from "@/components/CheatSheet";

interface Stats {
  total: number;
  highConf: number;
  bySource: Record<string, number>;
  bySport: Record<string, number>;
  avgScore: number;
  threshold: number;
}

type MainTab = "props" | "team" | "season";

// ── Sort: confidence desc, MLB player props win tiebreakers ───────────────────
const SPORT_PRIORITY: Record<string, number> = { MLB: 3, NBA: 2, NHL: 1, NFL: 1 };
function byConfThenSport(a: Bet, b: Bet): number {
  const scoreDiff = (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  // Tiebreak: MLB player props float to top, then other sports
  const aPrio = a.betType === "player_prop" ? (SPORT_PRIORITY[a.sport] ?? 0) : 0;
  const bPrio = b.betType === "player_prop" ? (SPORT_PRIORITY[b.sport] ?? 0) : 0;
  return bPrio - aPrio;
}

export default function Dashboard() {
  const { toast } = useToast();
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [mainTab, setMainTab] = useState<MainTab>("props");

  const { data: bets = [], isLoading, refetch: refetchBets } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    // Poll every 5s when empty (cold start), every 30s once data is loaded
    refetchInterval: (data) => (Array.isArray(data) && (data as Bet[]).length === 0 ? 5000 : 30000),
  });

  const { data: stats, refetch: refetchStats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: (data) => (bets.length === 0 ? 5000 : 30000),
  });

  // Auto-trigger a scan once if data is empty after 3 seconds (cold start)
  const autoScanned = useRef(false);
  useEffect(() => {
    if (!isLoading && bets.length === 0 && !autoScanned.current) {
      const timer = setTimeout(() => {
        autoScanned.current = true;
        apiRequest("POST", "/api/scan").then(() => {
          refetchBets();
          refetchStats();
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        }).catch(() => {});
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, bets.length]);

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scan"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Scan Complete",
        description: `Found ${data.scanned} markets, ${data.highConfidence} high-confidence picks`,
      });
    },
    onError: () => {
      toast({ title: "Scan Error", description: "Failed to scan markets", variant: "destructive" });
    },
  });

  // ── Filters state ────────────────────────────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [filterSport, setFilterSport] = useState("All");
  const [filterSource, setFilterSource] = useState("All");
  const [filterMinScore, setFilterMinScore] = useState(0);
  const [filterSearch, setFilterSearch] = useState("");
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const { data: bookErrors = [] } = useBookErrors();

  // Fetch settings to know which optional sports are enabled
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
    staleTime: 60_000,
  });
  const enabledOptionalSports: string[] = settings?.enabledOptionalSports ?? [];
  // Optional sports that have a tab-friendly label
  const OPTIONAL_SPORT_LABELS: Record<string, string> = {
    MMA: "MMA", Boxing: "Boxing", NCAAB: "NCAAB", NCAAF: "NCAAF", Golf: "Golf",
  };
  const SPORTS_LIST = [
    "All", "NBA", "NFL", "MLB", "NHL",
    ...enabledOptionalSports.filter(s => OPTIONAL_SPORT_LABELS[s]),
  ];
  const SOURCES_LIST = ["All", "kalshi", "polymarket", "actionnetwork", "underdog"];

  // Helper: has this game already started?
  function gameHasStarted(b: Bet): boolean {
    if (!b.gameTime) return false;
    return new Date(b.gameTime).getTime() <= Date.now();
  }

  function applyDashFilters(list: Bet[]): Bet[] {
    const q = filterSearch.trim().toLowerCase();
    return list.filter((b) => {
      const matchSearch = !q ||
        b.title.toLowerCase().includes(q) ||
        (b.playerName ?? "").toLowerCase().includes(q) ||
        (b.homeTeam ?? "").toLowerCase().includes(q) ||
        (b.awayTeam ?? "").toLowerCase().includes(q) ||
        (b.description ?? "").toLowerCase().includes(q);
      const matchSport  = filterSport  === "All" || b.sport   === filterSport;
      const matchSource = filterSource === "All" || b.source  === filterSource;
      const matchScore  = (b.confidenceScore ?? 0) >= filterMinScore;
      // Hide started games from default view — only show them if user is actively searching
      const hideStarted = !q && gameHasStarted(b);
      return matchSearch && matchSport && matchSource && matchScore && !hideStarted;
    });
  }

  // Season bets = season_prop (award markets like MVP, Cy Young) + futures (championship winner)
  // Also include moneyline/spread/total with no gameTime (championship outrights)
  const SEASON_BET_TYPES = new Set(["moneyline", "spread", "total", "season_prop", "futures"]);
  const seasonBets = bets.filter((b) => {
    if (b.betType === "season_prop" || b.betType === "futures") return true; // always season
    return !b.gameTime && SEASON_BET_TYPES.has(b.betType ?? ""); // no gameTime = futures/outrights
  }).sort(byConfThenSport);

  // Daily bets = player props (always) + team bets that have a gameTime
  const allPlayerProps = bets.filter((b) => b.betType === "player_prop").sort(byConfThenSport);
  const allTeamBets = bets.filter((b) => b.betType !== "player_prop" && b.betType !== "season_prop" && b.betType !== "futures" && !!b.gameTime).sort(byConfThenSport);

  // Day filter for props: if prop has gameTime use it; if no gameTime treat as "today" (live/upcoming)
  const filterPropsByDay = (props: Bet[], day: DayFilter): Bet[] => {
    if (day === "all") return props;
    const { start, end } = day === "today"
      ? { start: new Date().setHours(0,0,0,0), end: new Date().setHours(23,59,59,999) }
      : { start: (() => { const d=new Date(); d.setDate(d.getDate()+1); d.setHours(0,0,0,0); return d.getTime(); })(),
          end: (() => { const d=new Date(); d.setDate(d.getDate()+1); d.setHours(23,59,59,999); return d.getTime(); })() };
    return props.filter((b) => {
      if (!b.gameTime) return day === "today"; // no gameTime = treat as today
      const t = new Date(b.gameTime).getTime();
      return t >= start && t <= end;
    });
  };

  const propBets = applyDashFilters(filterPropsByDay(allPlayerProps, dayFilter));
  const teamBets = applyDashFilters(filterByDay(allTeamBets, dayFilter)).sort(byConfThenSport);
  const threshold = stats?.threshold ?? 85;

  // Counts for tabs
  const todayCount = filterPropsByDay(allPlayerProps, "today").length + countByDay(allTeamBets, "today");
  const tomorrowCount = filterPropsByDay(allPlayerProps, "tomorrow").length + countByDay(allTeamBets, "tomorrow");
  const allDailyCount = allPlayerProps.length + allTeamBets.length;

  const propsTodayCount = filterPropsByDay(allPlayerProps, "today").length;
  const teamTodayCount = countByDay(allTeamBets, "today");

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const DAY_TABS: { key: DayFilter; label: string; sub: string; count: number }[] = [
    { key: "today",    label: "Today",     sub: fmtDay(today),    count: todayCount    },
    { key: "tomorrow", label: "Tomorrow",  sub: fmtDay(tomorrow), count: tomorrowCount },
    { key: "all",      label: "All Daily", sub: "all upcoming",   count: allDailyCount },
  ];

  const MAIN_TABS: { key: MainTab; label: string; icon: React.ReactNode; count: number; color: string }[] = [
    { key: "props",  label: "Player Props", icon: <Target size={13} />,   count: allPlayerProps.length, color: "text-green-400" },
    { key: "team",   label: "Team Bets",    icon: <Users size={13} />,    count: allTeamBets.length, color: "text-blue-400" },
    { key: "season", label: "Season Bets",  icon: <Trophy size={13} />,   count: seasonBets.length, color: "text-yellow-400" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">🏆 Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            Kalshi · Polymarket · ActionNetwork · Underdog
            <span className="hidden sm:inline"> · 🏈 NFL · 🏀 NBA · ⚾ MLB · 🏒 NHL</span>
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          data-testid="button-scan"
          className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-60 transition-all"
          style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)", color: "#1a0d00", boxShadow: "0 0 20px rgba(245,158,11,0.35)" }}
        >
          <RefreshCw size={14} className={scanMutation.isPending ? "scanning" : ""} />
          {scanMutation.isPending ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Markets"    value={stats?.total ?? bets.length}                         icon={<Activity size={16} />}   loading={isLoading} emoji="📊" />
        <StatCard label={`🔥 ≥${threshold}/100`} value={stats?.highConf ?? 0}                          icon={<Target size={16} />}     highlight loading={isLoading} emoji="🎯" />
        <StatCard label="Avg Confidence"   value={stats?.avgScore ? `${stats.avgScore}/100` : "—"}     icon={<TrendingUp size={16} />} loading={isLoading} emoji="📈" />
        <StatCard label="Sources Active"   value={Object.keys(stats?.bySource ?? {}).length || "4"}    icon={<Zap size={16} />}        loading={isLoading} emoji="⚡" />
      </div>

      {/* How to Read */}
      <HowToRead />

      {/* ── Main Tab Bar: Player Props | Team Bets | Season Bets ── */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-xl border border-border">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMainTab(tab.key)}
            data-testid={`tab-main-${tab.key}`}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mainTab === tab.key
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
            {tab.count > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                mainTab === tab.key ? `bg-primary/20 ${tab.color}` : "bg-muted text-muted-foreground"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Filter bar (Props + Team tabs only) ── */}
      {(mainTab === "props" || mainTab === "team") && (
        <div className="space-y-3">
          {/* Search + toggle row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search player, team, keyword..."
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-card border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                data-testid="input-dash-search"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex-shrink-0 ${
                showFilters || filterSport !== "All" || filterSource !== "All" || filterMinScore > 0
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              data-testid="button-dash-filters"
            >
              <SlidersHorizontal size={13} />
              Filters
              {(filterSport !== "All" || filterSource !== "All" || filterMinScore > 0) && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
            <BookErrorsFilterButton
              active={showErrorsOnly}
              count={(bookErrors as any[]).length}
              onClick={() => { setShowErrorsOnly(!showErrorsOnly); if (!showErrorsOnly) { setShowFilters(false); } }}
            />
          </div>

          {/* Expanded filter panel */}
          {showFilters && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Sport */}
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-2">Sport</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SPORTS_LIST.map((s) => (
                      <button key={s} onClick={() => setFilterSport(s)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          filterSport === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Source */}
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-2">Source</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SOURCES_LIST.map((s) => (
                      <button key={s} onClick={() => setFilterSource(s)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          filterSource === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}>
                        {s === "actionnetwork" ? "ActionNet" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Min Confidence */}
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-2">
                    Min Confidence: <span className="text-foreground font-mono">{filterMinScore}</span>
                  </label>
                  <input type="range" min={0} max={95} step={5}
                    value={filterMinScore}
                    onChange={(e) => setFilterMinScore(Number(e.target.value))}
                    className="w-full accent-primary"
                    data-testid="input-dash-min-score"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>0</span><span className="text-primary font-bold">80+ 🔥</span><span>95</span>
                  </div>
                </div>
              </div>
              {/* Active filter chips + clear */}
              {(filterSport !== "All" || filterSource !== "All" || filterMinScore > 0) && (
                <div className="flex items-center gap-2 pt-1 border-t border-border flex-wrap">
                  <span className="text-xs text-muted-foreground">Active:</span>
                  {filterSport !== "All" && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {filterSport}
                      <button onClick={() => setFilterSport("All")} className="hover:text-red-400">×</button>
                    </span>
                  )}
                  {filterSource !== "All" && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {filterSource}
                      <button onClick={() => setFilterSource("All")} className="hover:text-red-400">×</button>
                    </span>
                  )}
                  {filterMinScore > 0 && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      ≥{filterMinScore} conf
                      <button onClick={() => setFilterMinScore(0)} className="hover:text-red-400">×</button>
                    </span>
                  )}
                  <button
                    onClick={() => { setFilterSport("All"); setFilterSource("All"); setFilterMinScore(0); setFilterSearch(""); }}
                    className="text-xs text-muted-foreground hover:text-red-400 ml-auto transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ BOOK ERRORS SECTION ═══════════ */}
      {showErrorsOnly && (mainTab === "props" || mainTab === "team") && (
        <BookErrorsSection errors={bookErrors as any[]} />
      )}

      {/* ═══════════ PLAYER PROPS TAB ═══════════ */}
      {mainTab === "props" && (
        <div className="space-y-5">
          <DayFilterBar tabs={DAY_TABS} active={dayFilter} onChange={setDayFilter} />

          {isLoading ? (
            <SkeletonGrid />
          ) : propBets.length === 0 ? (
            <EmptyState
              title={bets.length === 0 ? "⚡ Scanning markets..." : dayFilter === "all" ? "No player props loaded" : `No player props for ${dayFilter === "today" ? "today" : "tomorrow"}`}
              subtitle={bets.length === 0 ? "Loading live picks from all sources — usually takes 20–30 seconds" : "Try a different day or hit Scan Now"}
              actions={
                <div className="flex gap-2 justify-center flex-wrap">
                  {dayFilter !== "all" && (
                    <button onClick={() => setDayFilter("all")} className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors">
                      Show All Days
                    </button>
                  )}
                  <button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} className="text-xs px-3 py-1.5 bg-green-500/10 text-green-400 rounded-lg border border-green-500/30 hover:bg-green-500/20 transition-colors">
                    Scan Now
                  </button>
                </div>
              }
            />
          ) : (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <h2 className="text-base font-bold text-foreground">🎯 Player Props</h2>
                  <span className="text-xs font-mono bg-green-500/15 text-green-400 px-2 py-0.5 rounded-md border border-green-500/30">
                    {propBets.length} props
                  </span>
                </div>
                <Link href="/bets?type=player_prop">
                  <a className="text-xs text-primary hover:underline">View all →</a>
                </Link>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {propBets.map((bet) => (
                  <BetCard key={bet.id} bet={bet} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ═══════════ TEAM BETS TAB ═══════════ */}
      {mainTab === "team" && (
        <div className="space-y-5">
          <DayFilterBar tabs={DAY_TABS} active={dayFilter} onChange={setDayFilter} />

          {isLoading ? (
            <SkeletonGrid />
          ) : teamBets.length === 0 ? (
            <EmptyState
              title={bets.length === 0 ? "⚡ Scanning markets..." : `No team bets for ${dayFilter === "today" ? "today" : dayFilter === "tomorrow" ? "tomorrow" : "upcoming days"}`}
              subtitle={bets.length === 0 ? "Loading live picks — usually takes 20–30 seconds" : "Spreads, totals, and moneylines appear here"}
              actions={
                <div className="flex gap-2 justify-center">
                  {dayFilter !== "all" && (
                    <button onClick={() => setDayFilter("all")} className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors">
                      Show All Days
                    </button>
                  )}
                </div>
              }
            />
          ) : (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <h2 className="text-base font-bold text-foreground">🏟️ Team Bets</h2>
                  <span className="text-xs font-mono bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-md border border-blue-500/30">
                    {teamBets.length} bets
                  </span>
                </div>
                <Link href="/bets">
                  <a className="text-xs text-primary hover:underline">View all →</a>
                </Link>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {teamBets.map((bet) => (
                  <BetCard key={bet.id} bet={bet} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ═══════════ SEASON BETS TAB ═══════════ */}
      {mainTab === "season" && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 px-4 py-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
            <Trophy size={16} className="text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Season-Long Futures & Outrights</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Championship winners, division winners, and season-long player props. Resolve at end of season.
              </p>
            </div>
          </div>

          {isLoading ? (
            <SkeletonGrid />
          ) : seasonBets.length === 0 ? (
            <EmptyState
              title="No season futures loaded yet"
              subtitle="Click Scan Now to load season-long markets"
              actions={
                <button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} className="text-xs px-3 py-1.5 bg-yellow-500/10 text-yellow-400 rounded-lg border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors">
                  Scan Now
                </button>
              }
            />
          ) : (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <h2 className="text-base font-bold text-foreground">🏆 Season Futures</h2>
                <span className="text-xs font-mono bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-md border border-yellow-500/30">
                  {seasonBets.length} picks
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {seasonBets.map((bet) => (
                  <BetCard key={bet.id} bet={bet} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ═══════════ ASK A QUESTION ═══════════ */}
      <AskSection />

    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function DayFilterBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: DayFilter; label: string; sub: string; count: number }[];
  active: DayFilter;
  onChange: (k: DayFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border pb-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          data-testid={`tab-day-${tab.key}`}
          className={`relative flex flex-col items-start px-4 py-2 rounded-t-lg text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
            active === tab.key
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <span className="flex items-center gap-1.5">
            {tab.label}
            {tab.count > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                active === tab.key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {tab.count}
              </span>
            )}
          </span>
          <span className="text-[10px] text-muted-foreground font-normal">{tab.sub}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="text-center py-16 border border-dashed border-border rounded-xl">
      <AlertCircle size={32} className="mx-auto text-muted-foreground mb-3" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 mb-3">{subtitle}</p>
      {actions}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array(6).fill(0).map((_, i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}

// ── How to Read ────────────────────────────────────────────────────────────

const TERMS = [
  { term: "Confidence Score", badge: "e.g. 84/100", color: "text-primary", def: "A 0–100 rating built from 6 components: market consensus (20 pts), source quality + sharp money (28 pts), stat predictability (22 pts), sport sample size (13 pts), juice/value (12 pts), and recent form vs line (+12/−15 pts). Score 85+ = HIGH CONFIDENCE alert. See Edge Grade below for how mispricing is graded." },
  { term: "Moneyline", badge: "Bet Type", color: "text-blue-400", def: "A straight-up bet on who wins the game. A -200 favorite means risk $200 to win $100. A +170 underdog means a $100 bet wins $170." },
  { term: "Spread", badge: "Bet Type", color: "text-blue-400", def: "A handicap given to the underdog. If the Chiefs are -6.5, they must win by 7+ for the bet to win. The underdog +6.5 wins if they lose by 6 or fewer, or win outright." },
  { term: "Total (Over/Under)", badge: "Bet Type", color: "text-blue-400", def: "A bet on the combined score of both teams. If the total is 47.5, bet Over (48+) or Under (47 or less). Doesn't matter who wins." },
  { term: "Player Prop", badge: "Bet Type", color: "text-green-400", def: "A bet on an individual player's stats — e.g. 'LeBron James Over 25.5 points.' Only depends on the player's performance, not who wins." },
  { term: "TAKE OVER / TAKE UNDER", badge: "Recommendation", color: "text-green-400", def: "The system's pick on a player prop. TAKE OVER means the player is projected to exceed the line. TAKE UNDER means they're projected to fall short." },
  { term: "Season Futures", badge: "Bet Type", color: "text-yellow-400", def: "A bet on a season-long outcome — e.g. 'Yankees to win the World Series.' These live in the Season Bets tab and resolve at season's end." },
  { term: "Implied Probability", badge: "Market Metric", color: "text-yellow-400", def: "The win probability implied by the odds. A -200 favorite = ~67% implied. On Kalshi/Polymarket, a $0.72 price = 72% chance." },
  { term: "Recommended Allocation", badge: "Portfolio Sizing", color: "text-green-400", def: "Suggested % of your bankroll for this bet, using quarter-Kelly sizing. 5% on a $1,000 bankroll = $50 bet." },
  { term: "Risk Level", badge: "Low / Medium / High", color: "text-orange-400", def: "Low = score ≥75 with >55% implied probability. Medium = score ≥60. High = lower confidence. Always size bets by risk level." },
  { term: "Kalshi / Polymarket", badge: "Sources", color: "text-purple-400", def: "Regulated prediction markets where real money trades on outcomes. Prices reflect collective market intelligence — generally more accurate than sportsbook lines." },
  { term: "ActionNetwork", badge: "Source", color: "text-purple-400", def: "Public betting consensus — % of money and tickets on each side. High sharp money % on one side with low ticket % signals professional action." },
];

function HowToRead() {
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <>
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          data-testid="button-how-to-read"
          className="w-full flex items-center justify-between px-5 py-4 bg-card hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <BookOpen size={15} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">How to Read This App</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">— betting terms &amp; smart money explained</span>
          </div>
          {open ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
        </button>
        {open && (
          <div className="px-5 pb-5 pt-3 bg-card border-t border-border space-y-4">
            {/* Full Guide CTA */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-foreground flex items-center gap-2">⚡ PropEdge Smart Money Guide</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">9 sections — spread signals, totals by sport, moneyline, universal rules, and more</p>
              </div>
              <button
                onClick={() => setGuideOpen(true)}
                className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border border-primary/50 text-primary bg-primary/10 hover:bg-primary/20 transition-all whitespace-nowrap"
              >
                <BookOpen size={12} /> Open Full Guide
              </button>
            </div>

            {/* Betting terms glossary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TERMS.map((t) => (
                <div key={t.term} className="bg-muted/30 rounded-lg p-3.5 border border-border/60">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-foreground">{t.term}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border border-border ${t.color}`}>{t.badge}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t.def}</p>
                </div>
              ))}
            </div>

            {/* ── Confidence Score Breakdown ───────────────────────────────── */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">How the Confidence Score is Built</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary">0–100</span>
              </div>
              <div className="p-4 space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                  Every pick is scored using a <span className="text-foreground font-semibold">6-component model</span>. You need strong marks across all six to reach 85+. Hard gates (coin-flip odds, extreme juice, low-tier source) cap the score at 66.
                </p>
                {[
                  { label: "Market consensus",     pts: "20", color: "#6366f1", w: 72,  detail: "How decisively the market prices one side. 78%+ implied = full points." },
                  { label: "Source + sharp money", pts: "28", color: "#10b981", w: 100, detail: "DraftKings/FanDuel tier scores highest. Pro money vs public tickets split adds up to +12 pts bonus." },
                  { label: "Stat predictability",  pts: "22", color: "#f59e0b", w: 79,  detail: "A-class (PTS, REB, AST) = 22 pts. B-class (shots, 3PT) = 14 pts. C-class (steals, goals) = 7 pts." },
                  { label: "Sport sample size",    pts: "13", color: "#3b82f6", w: 46,  detail: "MLB 162-game season scores highest. NFL 17-game season penalized for variance." },
                  { label: "Juice & value",         pts: "12", color: "#a78bfa", w: 43,  detail: "Clean lines (−105 to −112) = full. Heavy juice (−280+) = gated. Plus-money props score well." },
                  { label: "Recent form vs line",   pts: "+12/−15", color: "#f97316", w: 43, detail: "L5 avg vs posted line. Player crushing the number = +12 pts. Form conflicting with pick = up to −15 pts." },
                ].map(c => (
                  <div key={c.label} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold w-36 shrink-0" style={{ color: c.color }}>{c.label}</span>
                      <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${c.w}%`, background: c.color }} />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground w-12 text-right shrink-0">{c.pts} pts</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground pl-[9.5rem] leading-snug">{c.detail}</p>
                  </div>
                ))}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    { range: "85+",   label: "HIGH",     color: "#22c55e" },
                    { range: "70–84", label: "Moderate", color: "#eab308" },
                    { range: "<70",   label: "Low",       color: "#f97316" },
                  ].map(t => (
                    <div key={t.range} className="p-2 rounded-lg border border-border bg-muted/30">
                      <p className="text-xs font-black font-mono" style={{ color: t.color }}>{t.range}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{t.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Edge Grade ──────────────────────────────────────────────── */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">📊 Edge Grade</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">A+ / A / B / C</span>
                <span className="text-[10px] text-muted-foreground ml-auto">Part of confidence</span>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  The Edge Grade shows how much <span className="text-foreground font-semibold">mispricing</span> exists between the model's fair value and what the book is currently offering. A higher confidence score = higher fair value = larger potential edge.
                </p>

                {/* Formula */}
                <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/20 text-[10px] text-center">
                  <div className="flex-1">
                    <p className="font-bold text-blue-300">Model Fair Value</p>
                    <p className="text-muted-foreground mt-0.5">(from confidence score)</p>
                  </div>
                  <span className="text-muted-foreground font-bold text-base">−</span>
                  <div className="flex-1">
                    <p className="font-bold text-red-300">Book Implied Prob</p>
                    <p className="text-muted-foreground mt-0.5">(from the odds)</p>
                  </div>
                  <span className="text-muted-foreground font-bold text-base">=</span>
                  <div className="flex-1">
                    <p className="font-bold" style={{ color: "#4ade80" }}>Edge %</p>
                    <p className="text-muted-foreground mt-0.5">(positive = value)</p>
                  </div>
                </div>

                {/* Tier rows */}
                <div className="space-y-1.5">
                  {[
                    { tier: "A+", color: "#4ade80", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.25)",   rule: "Edge ≥15% + Confidence ≥82",  note: "Book significantly behind model. High conviction play." },
                    { tier: "A",  color: "#facc15", bg: "rgba(250,204,21,0.08)",  border: "rgba(250,204,21,0.25)",  rule: "Edge ≥10% + Confidence ≥75",  note: "Meaningful gap vs market. Strong play." },
                    { tier: "B",  color: "#93c5fd", bg: "rgba(96,165,250,0.08)",  border: "rgba(96,165,250,0.25)",  rule: "Edge ≥5% + Confidence ≥65",   note: "Moderate edge. Good play, look for a confirming signal." },
                    { tier: "C",  color: "rgba(255,255,255,0.35)", bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.12)", rule: "Edge <5% or Confidence <65", note: "No badge shown — edge too small to surface. Use other signals." },
                  ].map(t => (
                    <div key={t.tier} className="flex items-start gap-3 p-2.5 rounded-lg border" style={{ background: t.bg, borderColor: t.border }}>
                      <span className="text-xs font-black shrink-0 w-6 text-center pt-0.5" style={{ color: t.color }}>📊{t.tier}</span>
                      <div>
                        <p className="text-[10px] font-bold" style={{ color: t.color }}>{t.rule}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t.note}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sharp bonus + L5 model */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
                    <p className="text-[10px] font-bold text-yellow-300 mb-1">Sharp money bonus</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">If pro money is confirmed on your side, the effective edge is bumped +2% before tier assignment — easier to reach A+ or A.</p>
                  </div>
                  <div className="p-2.5 rounded-lg border border-orange-500/20 bg-orange-500/5">
                    <p className="text-[10px] font-bold text-orange-300 mb-1">📈 L5 stat-vs-line model</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">For props, the player's last 5 game average is compared to the posted line. A +37% edge (e.g. 4.8 avg vs 3.5 line) with 4/5 hit rate adds up to +12 pts to the confidence score and boosts the edge grade.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Full guide drawer — opened directly from the CTA button */}
      <CheatSheetDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}

function StatCard({ label, value, icon, highlight = false, loading = false, emoji }: {
  label: string; value: string | number; icon: React.ReactNode; highlight?: boolean; loading?: boolean; emoji?: string;
}) {
  return (
    <div className={`bg-card rounded-xl border p-4 ${highlight ? "border-primary/30" : "border-border"}`}
      style={highlight ? { boxShadow: "0 0 16px rgba(245,158,11,0.1)" } : {}}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span className={highlight ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p className={`text-2xl font-bold font-mono ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
      )}
    </div>
  );
}

// ── Ask a Question ──────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  "Build me a 4 player NBA parlay for today's games",
  "Best NBA player props for tonight?",
  "Should I bet on LeBron over 25.5 points tonight?",
  "Any high confidence MLB props today?",
  "Give me a 3-leg parlay under $50",
];

// Render answer text: bold **text**, line breaks, and leg separators
function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        // Parse **bold** segments
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        const isLegLine = /^\*\*Leg \d+:/i.test(line);
        const isVerdictLine = /^(🔥|⚠️|❌|✅)\s+(STRONG|MODERATE|HIGH RISK|PARLAY)/.test(line);
        const isWhyLine = /^\s+Why:/i.test(line) || line.trim().startsWith("Why:");
        const isConfLine = /Confidence:/.test(line) && /\/100/.test(line);
        return (
          <p key={i}
            className={`text-sm leading-relaxed ${
              isLegLine ? "font-bold mt-3 first:mt-0" : ""
            } ${
              isVerdictLine ? "font-bold text-base" : ""
            } ${
              isWhyLine ? "text-xs opacity-70 pl-3" : ""
            } ${
              isConfLine ? "text-xs opacity-80 pl-3" : ""
            }`}
            style={isLegLine ? { color: "hsl(43 100% 72%)" } : undefined}>
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={j} style={{ color: "hsl(43 100% 85%)" }}>{part.slice(2, -2)}</strong>
                : <span key={j}>{part}</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

function AskSection() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ q: string; a: string; relatedBets: any[] }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || isLoading) return;
    setQuestion("");
    setIsLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await apiRequest("POST", "/api/ask", { question: trimmed });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHistory((prev) => [...prev, { q: trimmed, a: data.answer, relatedBets: data.relatedBets ?? [] }]);
      setAnswer(data.answer);
    } catch (e: any) {
      setError(e.message ?? "Failed to get analysis");
    } finally {
      setIsLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(question);
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden" data-testid="ask-section">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-card border-b border-border">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, hsl(265 35% 18%), hsl(265 35% 22%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
          <MessageCircleQuestion size={15} className="text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            Ask PropEdge
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">AI</span>
          </h2>
          <p className="text-xs text-muted-foreground">Ask about any bet — get analysis using live odds & stats</p>
        </div>
      </div>

      <div className="bg-card px-5 py-4 space-y-4">
        {/* Conversation history */}
        {history.length > 0 && (
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {history.map((item, i) => (
              <div key={i} className="space-y-2">
                {/* User question */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm text-foreground"
                    style={{ background: "linear-gradient(135deg, hsl(43 100% 50% / 0.15), hsl(43 100% 50% / 0.08))", border: "1px solid hsl(43 100% 50% / 0.25)" }}>
                    {item.q}
                  </div>
                </div>
                {/* AI answer */}
                <div className="flex justify-start gap-2">
                  <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                    style={{ background: "linear-gradient(135deg, hsl(265 35% 18%), hsl(265 35% 24%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
                    <Sparkles size={10} className="text-primary" />
                  </div>
                  <div className="flex-1 max-w-[90%] space-y-2">
                    <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/40 border border-border text-foreground">
                      <AnswerText text={item.a} />
                    </div>
                    {item.relatedBets?.length > 0 && (
                      <div className="space-y-2 pl-1">
                        {/* Label: parlay legs vs similar bets */}
                        {item.relatedBets[0]?.similarityReason === "parlay leg" ? (
                          <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            🏆 Parlay legs — tap to view full details
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">{item.relatedBets.length}</span>
                          </p>
                        ) : (
                          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <TrendingUp size={11} className="text-primary" />
                            Similar bets — same player, team, or bet type
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">{item.relatedBets.length}</span>
                          </p>
                        )}
                        {item.relatedBets.map((bet: any, legIdx: number) => {
                          const conf = bet.confidenceScore ?? 0;
                          const confColor = conf >= 85 ? "text-green-400 border-green-500/30 bg-green-500/10" : conf >= 70 ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" : "text-muted-foreground border-border bg-muted";
                          const verdict = conf >= 85 ? "✅ Strong" : conf >= 70 ? "⚠️ Moderate" : "❌ Risky";
                          const isParlay = bet.similarityReason === "parlay leg";
                          const fmtOdds = (n: number | null) => n == null ? null : (n > 0 ? "+" + n : "" + n);
                          const matchup = bet.homeTeam && bet.awayTeam ? `${bet.awayTeam} @ ${bet.homeTeam}` : null;
                          return (
                            <div key={bet.id} className="p-3 rounded-xl border bg-muted/20 space-y-1.5"
                              style={{ borderColor: isParlay ? "hsl(43 100% 50% / 0.25)" : undefined }}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isParlay && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: "hsl(43 100% 50% / 0.15)", color: "hsl(43 100% 65%)", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
                                    LEG {legIdx + 1}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{bet.sport}</span>
                                {bet.betType === "player_prop" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25">PROP</span>}
                                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${confColor}`}>{conf}/100</span>
                                <span className="text-[10px] text-muted-foreground">{verdict}</span>
                              </div>
                              <p className="text-xs font-semibold text-foreground leading-tight">{bet.title}</p>
                              {matchup && <p className="text-[10px] text-muted-foreground">🏀 {matchup}</p>}
                              {(bet.line != null || bet.overOdds != null) && (
                                <p className="text-[10px] text-muted-foreground">
                                  {bet.line != null && <span>Line: <strong>{bet.line}</strong>  </span>}
                                  {bet.overOdds != null && <span>Over: {fmtOdds(bet.overOdds)}  Under: {fmtOdds(bet.underOdds)}</span>}
                                </p>
                              )}
                              {bet.keyFactors?.[0] && <p className="text-[10px] text-muted-foreground line-clamp-2">{bet.keyFactors[0]}</p>}
                              {!isParlay && bet.similarityReason && bet.similarityReason !== "direct match" && (
                                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.08)", color: "rgba(245,158,11,0.7)" }}>↗ {bet.similarityReason}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsl(265 35% 18%), hsl(265 35% 24%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
              <Sparkles size={10} className="text-primary animate-pulse" />
            </div>
            <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/40 border border-border">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-xl text-sm text-destructive">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Example questions (show when no history) */}
        {history.length === 0 && !isLoading && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSubmit(q)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                  data-testid={`example-question-${q.slice(0, 10).replace(/\s/g, '-')}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="relative flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about a player, team, or specific bet... (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
            data-testid="input-ask-question"
            disabled={isLoading}
          />
          <button
            onClick={() => handleSubmit(question)}
            disabled={!question.trim() || isLoading}
            data-testid="button-ask-submit"
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all"
            style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)", boxShadow: question.trim() ? "0 0 16px rgba(245,158,11,0.35)" : "none" }}
          >
            <Send size={15} style={{ color: "#1a0d00" }} />
          </button>
        </div>

        {history.length > 0 && (
          <button
            onClick={() => { setHistory([]); setAnswer(null); setError(null); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear conversation
          </button>
        )}
      </div>
    </div>
  );
}
