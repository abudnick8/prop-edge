import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Bet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock, User, TrendingUp, CheckCircle, XCircle, Shield, AlertTriangle, Zap } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function BetDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: bet, isLoading } = useQuery<Bet>({
    queryKey: ["/api/bets", id],
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/bets/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bets", id] });
      toast({ title: "Status Updated" });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!bet) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <p className="text-muted-foreground">Bet not found</p>
        <Link href="/bets">
          <a className="text-primary text-sm mt-2 inline-block hover:underline">← Back to all picks</a>
        </Link>
      </div>
    );
  }

  const score = bet.confidenceScore ?? 0;
  const scoreColor =
    score >= 80 ? "hsl(142 76% 45%)" : score >= 65 ? "hsl(43 95% 56%)" : "hsl(24 95% 53%)";
  const isHigh = score >= 80;
  const impliedPct = bet.impliedProbability ? Math.round(bet.impliedProbability * 100) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <Link href="/bets">
        <a className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
          <ArrowLeft size={14} />
          Back to all picks
        </a>
      </Link>

      {/* Hero Card */}
      <div className={`bg-card rounded-2xl border p-6 ${isHigh ? "border-primary/30" : "border-border"}`}>
        {/* Pick Side Banner for player props */}
        {(() => {
          const ts = bet.teamStats as { pickSide?: string; pickedOdds?: number } | null;
          if (bet.betType !== "player_prop" || !ts?.pickSide) return null;
          const isOver = ts.pickSide === "over";
          const odds = ts.pickedOdds;
          const oddsStr = odds !== undefined ? (odds > 0 ? `+${odds}` : `${odds}`) : null;
          return (
            <div className={`flex items-center justify-between mb-4 px-4 py-3 rounded-xl font-bold text-base tracking-wide ${
              isOver
                ? "bg-green-500/15 border border-green-500/40 text-green-400"
                : "bg-blue-500/15 border border-blue-500/40 text-blue-400"
            }`}>
              <span className="flex items-center gap-3">
                <span className="text-xl">{isOver ? "▲" : "▼"}</span>
                <span>{isOver ? "TAKE OVER" : "TAKE UNDER"}{bet.line !== null ? ` ${bet.line}` : ""}</span>
              </span>
              {oddsStr && <span className="font-mono">{oddsStr}</span>}
            </div>
          );
        })()}

        <div className="flex items-start gap-5">
          {/* Big confidence ring */}
          <ConfidenceRingLarge score={score} />

          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground leading-tight mb-2">
              {bet.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
            </h1>

            <div className="flex flex-wrap gap-2 mb-4">
              <SourceBadge source={bet.source} />
              <SportBadge sport={bet.sport} />
              <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground capitalize border border-border">
                {bet.betType.replace("_", " ")}
              </span>
              {isHigh && (
                <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-primary/15 text-primary border border-primary/30">
                  🔥 High Confidence
                </span>
              )}
            </div>

            {bet.description && (
              <p className="text-sm text-muted-foreground mb-4">{bet.description}</p>
            )}

            <div className="flex flex-wrap gap-4 text-sm">
              {bet.playerName && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <User size={13} />
                  <span>{bet.playerName}</span>
                </div>
              )}
              {bet.homeTeam && (
                <div className="text-muted-foreground">
                  {bet.awayTeam} @ {bet.homeTeam}
                </div>
              )}
              {bet.gameTime && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock size={13} />
                  <span>{format(new Date(bet.gameTime), "MMM d, h:mm a")} ({formatDistanceToNow(new Date(bet.gameTime), { addSuffix: true })})</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Confidence" value={`${score}/100`} color={scoreColor} mono />
        <MetricCard label="Implied Prob" value={impliedPct !== null ? `${impliedPct}%` : "—"} mono />
        <MetricCard label="Risk Level" value={bet.riskLevel ?? "—"} />
        <MetricCard label="Allocation" value={bet.recommendedAllocation ? `${bet.recommendedAllocation}%` : "—"} mono />
        {bet.line !== null && <MetricCard label="Line" value={String(bet.line)} mono />}
        {bet.overOdds !== null && <MetricCard label="Over / Yes" value={formatOdds(bet.overOdds)} mono />}
        {bet.underOdds !== null && <MetricCard label="Under / No" value={formatOdds(bet.underOdds)} mono />}
        {bet.yesPrice !== null && <MetricCard label="Yes Price" value={`${Math.round(bet.yesPrice * 100)}¢`} mono />}
      </div>

      {/* Research Summary */}
      {bet.researchSummary && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Zap size={14} className="text-primary" />
            Analysis Summary
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{bet.researchSummary}</p>
        </div>
      )}

      {/* Key Factors */}
      {bet.keyFactors && bet.keyFactors.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-primary" />
            Key Factors
          </h2>
          <ul className="space-y-2.5">
            {bet.keyFactors.map((factor, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="text-primary mt-0.5 flex-shrink-0">
                  <CheckCircle size={13} />
                </span>
                {factor}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats */}
      {(bet.playerStats || bet.teamStats) && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Supporting Stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {bet.playerStats && Object.entries(bet.playerStats as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="bg-muted rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.replace(/_/g, " ")}</p>
                <p className="text-sm font-mono font-semibold text-foreground">
                  {Array.isArray(v) ? v.join(", ") : String(v)}
                </p>
              </div>
            ))}
            {bet.teamStats && Object.entries(bet.teamStats as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="bg-muted rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.replace(/_/g, " ")}</p>
                <p className="text-sm font-mono font-semibold text-foreground">{String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Track Result</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => statusMutation.mutate("won")}
            disabled={statusMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-500/15 text-green-400 border border-green-500/30 rounded-lg text-sm font-medium hover:bg-green-500/25 transition-colors"
            data-testid="button-mark-won"
          >
            <CheckCircle size={14} /> Mark Won ✓
          </button>
          <button
            onClick={() => statusMutation.mutate("lost")}
            disabled={statusMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/25 transition-colors"
            data-testid="button-mark-lost"
          >
            <XCircle size={14} /> Mark Lost ✗
          </button>
          <button
            onClick={() => statusMutation.mutate("open")}
            disabled={statusMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground border border-border rounded-lg text-sm font-medium hover:text-foreground hover:bg-accent transition-colors"
          >
            Reset to Open
          </button>
        </div>
        {bet.status !== "open" && (
          <p className="text-xs mt-3 font-medium capitalize">
            Current status:{" "}
            <span className={bet.status === "won" ? "text-green-400" : "text-red-400"}>
              {bet.status}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

function ConfidenceRingLarge({ score }: { score: number }) {
  const size = 80;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 80 ? "hsl(142 76% 45%)" : score >= 65 ? "hsl(43 95% 56%)" : "hsl(24 95% 53%)";
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(220 10% 18%)" strokeWidth="4" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ} strokeDashoffset={circ - fill} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold font-mono leading-none" style={{ color }}>{score}</span>
        <span className="text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="bg-muted rounded-xl p-4 border border-border">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">{label}</p>
      <p className={`text-base font-bold ${mono ? "font-mono" : ""}`} style={color ? { color } : {}}>
        {value}
      </p>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border source-${source} uppercase tracking-wide`}>
      {source}
    </span>
  );
}

function SportBadge({ sport }: { sport: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border sport-${sport.toLowerCase()} uppercase tracking-wide`}>
      {sport}
    </span>
  );
}

function formatOdds(odds: number | null): string {
  if (odds === null) return "—";
  return odds > 0 ? `+${odds}` : String(odds);
}
