import { useQuery, useMutation } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Target, Zap, TrendingUp, Activity, AlertCircle, BookOpen, ChevronDown, ChevronUp, Calendar, Wifi, WifiOff, Info } from "lucide-react";
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

export default function Dashboard() {
  const { toast } = useToast();
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");

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
    refetchInterval: 5 * 60 * 1000, // check every 5 min
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

  // Day-filtered bets
  const dayBets = filterByDay(bets, dayFilter).sort(sortByProps);
  const threshold = stats?.threshold ?? 80;

  const highConf = dayBets.filter((b) => (b.confidenceScore ?? 0) >= threshold);
  const recent = dayBets.slice(0, 12);

  // Badge counts for tabs
  const todayCount = countByDay(bets, "today");
  const tomorrowCount = countByDay(bets, "tomorrow");
  const allCount = bets.length;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const DAY_TABS: { key: DayFilter; label: string; sub: string; count: number }[] = [
    { key: "today",    label: "Today",    sub: fmtDay(today),    count: todayCount    },
    { key: "tomorrow", label: "Tomorrow", sub: fmtDay(tomorrow), count: tomorrowCount },
    { key: "all",      label: "All Bets", sub: "incl. futures",  count: allCount      },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scanning Kalshi · Polymarket · DraftKings · Underdog across NFL · NBA · MLB · NHL · MMA · Boxing · + more
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
          value={Object.keys(stats?.bySource ?? {}).length || "4"}
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
                  Season futures below are loaded from seed data. Kalshi and Polymarket still active.
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

      {/* Hot Picks Section */}
      {highConf.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <h2 className="text-base font-bold text-foreground">
                🔥 Hot Picks
                <span className="text-xs font-normal text-muted-foreground ml-1">· props first</span>
              </h2>
              <span className="text-xs font-mono bg-primary/15 text-primary px-2 py-0.5 rounded-md border border-primary/30">
                {highConf.length} picks ≥{threshold}/100
              </span>
            </div>
            <Link href="/bets?filter=high">
              <a className="text-xs text-primary hover:underline">View all →</a>
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {highConf.slice(0, 6).map((bet) => (
              <BetCard key={bet.id} bet={bet} />
            ))}
          </div>
        </section>
      )}

      {/* All Recent */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-foreground">
            {dayFilter === "today" ? "Today's Markets" : dayFilter === "tomorrow" ? "Tomorrow's Markets" : "All Markets"}
          </h2>
          <Link href="/bets">
            <a className="text-xs text-primary hover:underline">View all →</a>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array(6).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
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
                  There may be no games scheduled — try All Bets to see futures and upcoming games
                </p>
                <button
                  onClick={() => setDayFilter("all")}
                  className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
                >
                  Show All Bets
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {recent.map((bet) => (
              <BetCard key={bet.id} bet={bet} />
            ))}
          </div>
        )}
      </section>

      {/* Season/Futures note when on Today/Tomorrow with no results but All has some */}
      {dayFilter !== "all" && dayBets.length === 0 && bets.filter(b => !b.gameTime).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
          <Calendar size={16} className="text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Season Futures Available</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {bets.filter(b => !b.gameTime).length} season outright & futures picks are available —
              they don't have a single game date. Switch to <button onClick={() => setDayFilter("all")} className="text-primary hover:underline">All Bets</button> to see them.
            </p>
          </div>
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
    def: "A bet on a season-long outcome — e.g. 'Yankees to win the World Series' or 'Shohei Ohtani to lead MLB in home runs.' These are available before and during the season, and appear in All Bets (not day-filtered).",
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
