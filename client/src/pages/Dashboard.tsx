import { useQuery, useMutation } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Target, Zap, TrendingUp, Activity, AlertCircle, BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState } from "react";

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

  const { data: bets = [], isLoading } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: 30000,
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

  const highConf = bets
    .filter((b) => (b.confidenceScore ?? 0) >= (stats?.threshold ?? 80))
    .sort(sortByProps);
  const recent = [...bets].sort(sortByProps).slice(0, 12);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scanning Kalshi · Polymarket · DraftKings · Underdog across NFL · NBA · MLB · NHL
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
          label={`≥${stats?.threshold ?? 80}/100 Picks`}
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

      {/* Hot Picks Section */}
      {highConf.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <h2 className="text-base font-bold text-foreground">🔥 Hot Picks <span className="text-xs font-normal text-muted-foreground ml-1">· props first</span></h2>
              <span className="text-xs font-mono bg-primary/15 text-primary px-2 py-0.5 rounded-md border border-primary/30">
                {highConf.length} picks ≥{stats?.threshold ?? 80}/100
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
          <h2 className="text-base font-bold text-foreground">All Markets</h2>
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
        ) : bets.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <AlertCircle size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">No markets loaded yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click Scan Now to load prediction markets</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {recent.map((bet) => (
              <BetCard key={bet.id} bet={bet} />
            ))}
          </div>
        )}
      </section>
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
