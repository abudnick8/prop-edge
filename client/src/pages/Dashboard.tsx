import { useQuery, useMutation } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Target, Zap, TrendingUp, Activity, AlertCircle, BookOpen, ChevronDown, ChevronUp, Calendar, Wifi, WifiOff, Info, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState } from "react";
import { filterByDay, countByDay, DayFilter } from "@/lib/dateFilter";

interface Stats {
  total: number;
  highConf: number;
  bySource: Record<string, number>;
  bySport: Record<string, number>;
  avgScore: number;
  threshold: number;
}

// "Season Bets" tab — bets with no gameTime (futures/season-long)
type MainTab = "daily" | "season";

export default function Dashboard() {
  const { toast } = useToast();
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  const [mainTab, setMainTab] = useState<MainTab>("daily");

  const { data: bets = [], isLoading } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: 30000,
  });

  const { data: quota } = useQuery<{
    status: "ok" | "exhausted" | "no_key";
    used: number | null;
    remaining: number | null;
    resets: string | null;
    plan?: string;
  }>({
    queryKey: ["/api/quota"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

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

  // Player props first, then by confidence score descending
  const sortByProps = (a: Bet, b: Bet) => {
    const aProp = a.betType === "player_prop" ? 1 : 0;
    const bProp = b.betType === "player_prop" ? 1 : 0;
    if (bProp !== aProp) return bProp - aProp;
    return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  };

  // Split into daily bets (have gameTime) vs season bets (no gameTime)
  const dailyBets = bets.filter((b) => !!b.gameTime);
  const seasonBets = bets.filter((b) => !b.gameTime).sort(sortByProps);

  // Day-filtered daily bets
  const dayBets = filterByDay(dailyBets, dayFilter).sort(sortByProps);
  const threshold = stats?.threshold ?? 80;

  const highConf = dayBets.filter((b) => (b.confidenceScore ?? 0) >= threshold);
  // Dedicated player props — sorted by confidence, capped at 24 for display
  const topProps = dayBets
    .filter((b) => b.betType === "player_prop")
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 24);
  // Team bets (non-props) for separate section
  const teamBets = dayBets
    .filter((b) => b.betType !== "player_prop")
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 12);
  const recent = dayBets.slice(0, 12);

  // Season bets high confidence
  const seasonHighConf = seasonBets.filter((b) => (b.confidenceScore ?? 0) >= threshold);

  // Badge counts for day tabs
  const todayCount = countByDay(dailyBets, "today");
  const tomorrowCount = countByDay(dailyBets, "tomorrow");
  const allDailyCount = dailyBets.length;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const DAY_TABS: { key: DayFilter; label: string; sub: string; count: number }[] = [
    { key: "today",    label: "Today",    sub: fmtDay(today),    count: todayCount    },
    { key: "tomorrow", label: "Tomorrow", sub: fmtDay(tomorrow), count: tomorrowCount },
    { key: "all",      label: "All Daily", sub: "all upcoming",  count: allDailyCount },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scanning Kalshi · Polymarket · ActionNetwork · DraftKings · Underdog across NFL · NBA · MLB · NHL · + more
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          data-testid="button-scan"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          <RefreshCw size={14} className={scanMutation.isPending ? "scanning" : ""} />
          {scanMutation.isPending ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Markets"
          value={stats?.total ?? bets.length}
          icon={<Activity size={16} />}
          loading={isLoading}
        />
        <StatCard
          label={`≥${threshold}/100 Picks`}
          value={stats?.highConf ?? highConf.length}
          icon={<Target size={16} />}
          highlight
          loading={isLoading}
        />
        <StatCard
          label="Avg Confidence"
          value={stats?.avgScore ? `${stats.avgScore}/100` : "—"}
          icon={<TrendingUp size={16} />}
          loading={isLoading}
        />
        <StatCard
          label="Sources Active"
          value={Object.keys(stats?.bySource ?? {}).length || "5"}
          icon={<Zap size={16} />}
          loading={isLoading}
        />
      </div>

      {/* API Quota Banner */}
      {quota && quota.status !== "ok" && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
          quota.status === "exhausted"
            ? "bg-orange-500/10 border-orange-500/30 text-orange-300"
            : "bg-muted border-border text-muted-foreground"
        }`}>
          {quota.status === "exhausted" ? <WifiOff size={16} className="flex-shrink-0 mt-0.5" /> : <Info size={16} className="flex-shrink-0 mt-0.5" />}
          <div>
            {quota.status === "exhausted" ? (
              <>
                <p className="font-semibold">The Odds API quota exhausted ({quota.used}/500 requests used)</p>
                <p className="text-xs mt-0.5 text-orange-300/80">
                  Live DraftKings lines and player props are paused until the quota resets on{" "}
                  {quota.resets ? new Date(quota.resets).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "the 1st of next month"}.
                  ActionNetwork, Kalshi, and Polymarket are still active. Season futures below are loaded from seed data.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">No Odds API key configured</p>
                <p className="text-xs mt-0.5">Go to Settings → API Keys to add your The Odds API key for live DraftKings lines and player props.</p>
              </>
            )}
          </div>
        </div>
      )}
      {quota && quota.status === "ok" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wifi size={12} className="text-green-400" />
          <span>Odds API live · {quota.remaining} requests remaining this month</span>
        </div>
      )}

      {/* How to Read */}
      <HowToRead />

      {/* Sport breakdown */}
      {stats?.bySport && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(stats.bySport).map(([sport, count]) => (
            <div key={sport} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border sport-${sport.toLowerCase()}`}>
              <span className="text-xs font-bold uppercase">{sport}</span>
              <span className="text-xs font-mono">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Main Tab Bar: Daily Picks vs Season Bets ── */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-xl border border-border w-fit">
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
              mainTab === "season" ? "bg-yellow-500/20 text-yellow-400" : "bg-muted text-muted-foreground"
            }`}>
              {seasonBets.length}
            </span>
          )}
        </button>
      </div>

      {/* ═══════════════ DAILY PICKS TAB ═══════════════ */}
      {mainTab === "daily" && (
        <div className="space-y-6">
          {/* Day Filter Sub-Tabs */}
          <div className="flex items-center gap-2 border-b border-border pb-1">
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

          {/* ── TOP PLAYER PROPS (primary section) ── */}
          {isLoading ? (
            <section>
              <div className="h-6 w-48 bg-muted rounded mb-4" />
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array(6).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            </section>
          ) : dayBets.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <AlertCircle size={32} className="mx-auto text-muted-foreground mb-3" />
              {bets.length === 0 ? (
                <>
                  <p className="text-sm font-medium text-foreground">No markets loaded yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Click Scan Now to load prediction markets</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">
                    No {dayFilter === "today" ? "today's" : "tomorrow's"} games found
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    No games scheduled — try All Daily or check Season Bets for futures
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => setDayFilter("all")}
                      className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
                    >
                      Show All Daily
                    </button>
                    <button
                      onClick={() => setMainTab("season")}
                      className="text-xs px-3 py-1.5 bg-yellow-500/10 text-yellow-400 rounded-lg border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors"
                    >
                      View Season Bets ({seasonBets.length})
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Player Props — top priority section */}
              {topProps.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <h2 className="text-base font-bold text-foreground">
                        🎯 Top Player Props
                      </h2>
                      <span className="text-xs font-mono bg-green-500/15 text-green-400 px-2 py-0.5 rounded-md border border-green-500/30">
                        {topProps.length} props
                      </span>
                    </div>
                    <Link href="/bets?type=player_prop">
                      <a className="text-xs text-primary hover:underline">View all props →</a>
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {topProps.slice(0, 12).map((bet) => (
                      <BetCard key={bet.id} bet={bet} />
                    ))}
                  </div>
                  {topProps.length > 12 && (
                    <p className="text-xs text-muted-foreground mt-3 text-center">
                      Showing top 12 of {topProps.length} props —{" "}
                      <Link href="/bets?type=player_prop"><a className="text-primary hover:underline">view all →</a></Link>
                    </p>
                  )}
                </section>
              )}

              {/* Hot Picks (high confidence, any type) */}
              {highConf.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      <h2 className="text-base font-bold text-foreground">
                        🔥 Hot Picks
                        <span className="text-xs font-normal text-muted-foreground ml-1">· ≥80/100 confidence</span>
                      </h2>
                      <span className="text-xs font-mono bg-primary/15 text-primary px-2 py-0.5 rounded-md border border-primary/30">
                        {highConf.length} picks
                      </span>
                    </div>
                    <Link href="/bets?filter=high">
                      <a className="text-xs text-primary hover:underline">View all →</a>
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {highConf.filter(b => b.betType === "player_prop").slice(0, 6).map((bet) => (
                      <BetCard key={bet.id} bet={bet} />
                    ))}
                  </div>
                </section>
              )}

              {/* Team Bets (spreads, totals, moneylines) */}
              {teamBets.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold text-foreground">
                      Team Bets
                      <span className="text-xs font-normal text-muted-foreground ml-2">spreads · totals · moneylines</span>
                    </h2>
                    <Link href="/bets">
                      <a className="text-xs text-primary hover:underline">View all →</a>
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {teamBets.slice(0, 6).map((bet) => (
                      <BetCard key={bet.id} bet={bet} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════ SEASON BETS TAB ═══════════════ */}
      {mainTab === "season" && (
        <div className="space-y-6">
          {/* Season header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
            <Trophy size={16} className="text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Season-Long Futures & Outrights</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Championship winners, division winners, and season-long player props. These don't have a single game date — they resolve at the end of the season.
              </p>
            </div>
          </div>

          {/* Season High Confidence */}
          {seasonHighConf.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <h2 className="text-base font-bold text-foreground">
                  🏆 Top Season Picks
                </h2>
                <span className="text-xs font-mono bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-md border border-yellow-500/30">
                  {seasonHighConf.length} picks ≥{threshold}/100
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {seasonHighConf.slice(0, 6).map((bet) => (
                  <BetCard key={bet.id} bet={bet} />
                ))}
              </div>
            </section>
          )}

          {/* All Season Bets */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-foreground">
                All Season Futures
                <span className="text-xs font-normal text-muted-foreground ml-1">· {seasonBets.length} picks</span>
              </h2>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array(6).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : seasonBets.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-border rounded-xl">
                <Trophy size={32} className="mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">No season futures loaded yet</p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Click Scan Now — seed futures load automatically when The Odds API quota is exhausted
                </p>
                <button
                  onClick={() => scanMutation.mutate()}
                  disabled={scanMutation.isPending}
                  className="text-xs px-3 py-1.5 bg-yellow-500/10 text-yellow-400 rounded-lg border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors"
                >
                  Scan Now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {seasonBets.map((bet) => (
                  <BetCard key={bet.id} bet={bet} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const TERMS = [
  {
    term: "Confidence Score",
    badge: "e.g. 84/100",
    color: "text-primary",
    def: "Our algorithm's rating of how likely a bet is to win. 80+ is considered high confidence and will trigger an alert. Factors in market consensus, source reliability, sport, and bet type.",
  },
  {
    term: "Moneyline",
    badge: "Bet Type",
    color: "text-blue-400",
    def: "A straight-up bet on who wins the game. No point spread involved. Odds reflect how favored each team is — a -200 favorite means you risk $200 to win $100; a +170 underdog means a $100 bet wins $170.",
  },
  {
    term: "Spread",
    badge: "Bet Type",
    color: "text-blue-400",
    def: "A handicap given to the underdog to level the playing field. If the Chiefs are -6.5, they must win by 7+ for the bet to win. The underdog +6.5 wins if they lose by 6 or fewer, or win outright.",
  },
  {
    term: "Total (Over/Under)",
    badge: "Bet Type",
    color: "text-blue-400",
    def: "A bet on the combined score of both teams. If the total is 47.5, you bet Over (combined score 48+) or Under (combined score 47 or less). It doesn't matter who wins.",
  },
  {
    term: "Player Prop",
    badge: "Bet Type",
    color: "text-blue-400",
    def: "A bet on an individual player's stats in a game — e.g. 'LeBron James Over 25.5 points.' Doesn't depend on who wins the game, only on the player's personal performance.",
  },
  {
    term: "Season Futures",
    badge: "Bet Type",
    color: "text-yellow-400",
    def: "A bet on a season-long outcome — e.g. 'Yankees to win the World Series' or 'Shohei Ohtani to lead MLB in home runs.' These are available before and during the season and live in the Season Bets tab.",
  },
  {
    term: "Implied Probability",
    badge: "Market Metric",
    color: "text-yellow-400",
    def: "The probability of winning implied by the betting odds. A -200 favorite has ~67% implied probability. On prediction markets like Kalshi, a price of $0.72 means the market thinks there's a 72% chance it hits.",
  },
  {
    term: "Recommended Allocation",
    badge: "Portfolio Sizing",
    color: "text-green-400",
    def: "The suggested percentage of your total bankroll to place on this bet, calculated using the Kelly Criterion (quarter-Kelly for safety). A 2.5% allocation on a $1,000 bankroll = $25 bet.",
  },
  {
    term: "Risk Level",
    badge: "Low / Medium / High",
    color: "text-orange-400",
    def: "Low = score ≥75 with >55% implied probability (strong edge). Medium = score ≥60 (reasonable lean). High = lower confidence, more uncertain outcome. Always size bets according to risk level.",
  },
  {
    term: "Kalshi / Polymarket",
    badge: "Sources",
    color: "text-purple-400",
    def: "Regulated prediction markets where real money is traded on outcomes. Prices reflect collective market intelligence — sharp bettors and traders. Generally more accurate than traditional sportsbook lines.",
  },
  {
    term: "ActionNetwork",
    badge: "Source",
    color: "text-purple-400",
    def: "Public betting consensus data — shows what % of money and tickets are on each side across major sportsbooks. High % on one side signals strong public lean; used as a consensus fill-in signal.",
  },
  {
    term: "DraftKings / Underdog",
    badge: "Sources",
    color: "text-purple-400",
    def: "Major licensed sportsbooks. Lines are set by professional oddsmakers and adjusted based on betting volume. DraftKings is used for spreads, totals, moneylines, and player props.",
  },
];

function HowToRead() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="button-how-to-read"
        className="w-full flex items-center justify-between px-5 py-4 bg-card hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <BookOpen size={15} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">How to Read This App</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">— betting terms explained</span>
        </div>
        {open ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-3 bg-card border-t border-border">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TERMS.map((t) => (
              <div key={t.term} className="bg-muted/30 rounded-lg p-3.5 border border-border/60">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-foreground">{t.term}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border border-border ${t.color}`}>
                    {t.badge}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t.def}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight = false,
  loading = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  highlight?: boolean;
  loading?: boolean;
}) {
  return (
    <div
      className={`bg-card rounded-xl border p-4 ${
        highlight ? "border-primary/30" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span className={highlight ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p className={`text-2xl font-bold font-mono ${highlight ? "text-primary" : "text-foreground"}`}>
          {value}
        </p>
      )}
    </div>
  );
}
