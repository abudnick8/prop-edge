import { useQuery, useMutation } from "@tanstack/react-query";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import BetCard from "@/components/BetCard";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Target, Zap, TrendingUp, Activity, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

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

  const highConf = bets.filter((b) => (b.confidenceScore ?? 0) >= (stats?.threshold ?? 80));
  const recent = bets.slice(0, 12);

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
              <h2 className="text-base font-bold text-foreground">🔥 Hot Picks</h2>
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
