import { Bet } from "@shared/schema";
import { Link } from "wouter";
import { Clock, TrendingUp, AlertTriangle, Shield, ChevronRight, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface BetCardProps {
  bet: Bet;
  compact?: boolean;
}

function ConfidenceRing({ score }: { score: number }) {
  const size = 56;
  const r = 22;
  const circumference = 2 * Math.PI * r;
  const fill = (score / 100) * circumference;
  const color =
    score >= 80 ? "hsl(142 76% 45%)" : score >= 65 ? "hsl(43 95% 56%)" : "hsl(24 95% 53%)";

  return (
    <div
      className={`relative flex-shrink-0 ${score >= 80 ? "high-conf-pulse" : ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(220 10% 18%)"
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - fill}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-sm font-bold font-mono"
          style={{ color }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
      <div
        className="h-full confidence-bar"
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border source-${source} uppercase tracking-wide`}>
      {source === "draftkings" ? "DK" : source === "polymarket" ? "Poly" : source === "underdog" ? "UD" : source}
    </span>
  );
}

function SportBadge({ sport }: { sport: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border sport-${sport.toLowerCase()} uppercase tracking-wide`}>
      {sport}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  const classes: Record<string, string> = {
    low: "bg-green-500/10 text-green-400 border-green-500/30",
    medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  };
  const Icon = risk === "low" ? Shield : risk === "medium" ? TrendingUp : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${classes[risk] ?? classes.medium} uppercase tracking-wide`}>
      <Icon size={9} />
      {risk} risk
    </span>
  );
}

export default function BetCard({ bet, compact = false }: BetCardProps) {
  const score = bet.confidenceScore ?? 0;
  const isHigh = score >= 80;
  const teamStats = bet.teamStats as { pickSide?: string; pickedOdds?: number; overProb?: number; underProb?: number } | null;
  const pickSide = bet.betType === "player_prop" ? teamStats?.pickSide : null;
  const pickedOdds = teamStats?.pickedOdds;
  const oddsDisplay = pickedOdds !== undefined ? (pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`) : null;

  return (
    <Link href={`/bets/${bet.id}`}>
      <a
        data-testid={`bet-card-${bet.id}`}
        className={`bet-card block bg-card rounded-xl border p-4 cursor-pointer ${
          isHigh ? "border-primary/30" : "border-border"
        }`}
      >
        {/* Pick Side Banner — player props only */}
        {pickSide && (
          <div
            className={`flex items-center justify-between mb-3 px-3 py-2 rounded-lg font-bold text-sm tracking-wide ${
              pickSide === "over"
                ? "bg-green-500/15 border border-green-500/40 text-green-400"
                : "bg-blue-500/15 border border-blue-500/40 text-blue-400"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-base">{pickSide === "over" ? "▲" : "▼"}</span>
              <span>{pickSide === "over" ? "TAKE OVER" : "TAKE UNDER"}{bet.line !== null ? ` ${bet.line}` : ""}</span>
            </span>
            {oddsDisplay && (
              <span className="font-mono text-sm">{oddsDisplay}</span>
            )}
          </div>
        )}

        {/* Top row */}
        <div className="flex items-start gap-4">
          <ConfidenceRing score={score} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <p className="font-semibold text-sm text-foreground leading-tight line-clamp-2">
                {/* Strip the [TAKE OVER/UNDER ...] prefix from title for cleaner display */}
                {bet.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
              </p>
              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <SourceBadge source={bet.source} />
              <SportBadge sport={bet.sport} />
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted text-muted-foreground capitalize">
                {bet.betType.replace("_", " ")}
              </span>
              {isHigh && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary/15 text-primary border border-primary/30 uppercase tracking-wide">
                  🔥 Hot Pick
                </span>
              )}
              {!bet.gameTime && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 uppercase tracking-wide">
                  📅 Season Futures
                </span>
              )}
            </div>

            {!compact && (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-3">
                {bet.playerName && (
                  <span className="flex items-center gap-1">
                    <User size={10} />
                    {bet.playerName}
                  </span>
                )}
                {bet.homeTeam && (
                  <span>{bet.awayTeam} @ {bet.homeTeam}</span>
                )}
                {bet.gameTime && (
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatDistanceToNow(new Date(bet.gameTime), { addSuffix: true })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Score bar + stats */}
        {!compact && (
          <>
            <div className="mt-3 mb-2">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-mono font-semibold" style={{
                  color: score >= 80 ? "hsl(142 76% 45%)" : score >= 65 ? "hsl(43 95% 56%)" : "hsl(24 95% 53%)"
                }}>{score}/100</span>
              </div>
              <ScoreBar score={score} />
            </div>

            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <RiskBadge risk={bet.riskLevel} />
              </div>
              <div className="flex items-center gap-3 text-xs">
                {bet.recommendedAllocation !== null && (
                  <div className="text-right">
                    <p className="text-muted-foreground">Allocation</p>
                    <p className="font-mono font-semibold text-foreground">{bet.recommendedAllocation}%</p>
                  </div>
                )}
                {bet.impliedProbability !== null && (
                  <div className="text-right">
                    <p className="text-muted-foreground">Implied</p>
                    <p className="font-mono font-semibold text-foreground">{Math.round(bet.impliedProbability * 100)}%</p>
                  </div>
                )}
                {bet.line !== null && (
                  <div className="text-right">
                    <p className="text-muted-foreground">Line</p>
                    <p className="font-mono font-semibold text-foreground">{bet.line}</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </a>
    </Link>
  );
}
