/**
 * Portfolio page — three tabs: Standalone Bets | Parlays | P&L Summary
 * Requires authentication.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Trophy, Activity, DollarSign,
  Percent, BarChart3, ChevronDown, ChevronUp, Trash2, Edit2, Check, X,
  Clock, ListChecks, Layers, LineChart, LogIn, Plus, RefreshCcw
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Types ──────────────────────────────────────────────────────────────────
interface UserBet {
  id: string;
  betId: string;
  betSlug?: string;
  betTitle?: string;
  betSport?: string;
  betLine?: number | null;
  betPickSide?: string;
  notes?: string;
  stake?: number | null;
  odds?: number | null;
  result?: string;
  gradedAt?: string | null;
  addedAt: string;
}

interface ParlayLeg {
  id: string;
  parlayId: string;
  betId: string;
  betTitle?: string;
  betSport?: string;
  betLine?: number | null;
  betPickSide?: string;
  odds?: number | null;
  result?: string;
}

interface Parlay {
  id: string;
  name: string;
  stake?: number | null;
  result?: string;
  combinedOdds?: number | null;
  potentialPayout?: number | null;
  notes?: string;
  gradedAt?: string | null;
  createdAt: string;
  legs: ParlayLeg[];
}

interface PortfolioData {
  bets: UserBet[];
  parlays: Parlay[];
  summary: {
    totalBets: number;
    wonBets: number;
    lostBets: number;
    openBets: number;
    totalStaked: number;
    totalReturned: number;
    netPnl: number;
    roi: number;
    totalParlays: number;
    wonParlays: number;
    lostParlays: number;
    openParlays: number;
    parlayStaked: number;
    parlayNetPnl: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtOdds(o?: number | null) {
  if (o == null) return "—";
  return o > 0 ? `+${o}` : String(o);
}
function fmtMoney(n: number) {
  const abs = Math.abs(n).toFixed(2);
  return n >= 0 ? `+$${abs}` : `-$${abs}`;
}
function americanToDecimal(o: number) {
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

const SPORT_COLOR: Record<string, string> = {
  NBA: "#fb923c", NFL: "#f87171", MLB: "#60a5fa", NHL: "#22d3ee",
};
const RESULT_CONFIG = {
  won:  { label: "WON",  color: "#4ade80", bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.3)" },
  lost: { label: "LOST", color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)" },
  push: { label: "PUSH", color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.3)" },
  open: { label: "OPEN", color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" },
};

function ResultBadge({ result }: { result?: string }) {
  const cfg = RESULT_CONFIG[(result ?? "open") as keyof typeof RESULT_CONFIG] ?? RESULT_CONFIG.open;
  return (
    <span
      className="text-[10px] font-black px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-xl font-black" style={{ color: accent ?? "hsl(45 100% 90%)" }}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Standalone Bet Row ────────────────────────────────────────────────────
function BetRow({ bet, token }: { bet: UserBet; token: string | null }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [stakeInput, setStakeInput] = useState(String(bet.stake ?? ""));
  const [resultInput, setResultInput] = useState(bet.result ?? "open");

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/user/bets/${bet.id}`, body, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      setEditing(false);
      toast({ title: "Bet updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/user/bets/${bet.id}`, undefined, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Bet removed" });
    },
  });

  const potentialPayout = bet.stake && bet.odds
    ? (bet.stake * americanToDecimal(bet.odds)).toFixed(2)
    : null;

  return (
    <div
      className="rounded-xl p-3 space-y-2 transition-all"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
      data-testid={`bet-row-${bet.id}`}
    >
      <div className="flex items-start gap-2">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {bet.betSport && (
              <span className="text-[10px] font-bold" style={{ color: SPORT_COLOR[bet.betSport] ?? "#a78bfa" }}>
                {bet.betSport}
              </span>
            )}
            <ResultBadge result={bet.result} />
          </div>
          <p className="text-sm font-semibold mt-1 leading-snug" style={{ color: "hsl(45 100% 90%)" }}>
            {bet.betTitle ?? bet.betId}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
            {bet.betPickSide && <span>{bet.betPickSide}{bet.betLine != null ? ` ${bet.betLine}` : ""}</span>}
            {bet.odds != null && <span className="font-mono font-bold" style={{ color: "#4ade80" }}>{fmtOdds(bet.odds)}</span>}
            {bet.stake != null && <span>Stake: <span className="font-semibold text-foreground">${bet.stake}</span></span>}
            {potentialPayout && bet.result === "open" && <span>To win: <span className="font-semibold" style={{ color: "#f59e0b" }}>${potentialPayout}</span></span>}
            {bet.result === "won" && bet.stake && bet.odds && (
              <span className="font-semibold" style={{ color: "#4ade80" }}>
                +${((bet.stake * americanToDecimal(bet.odds)) - bet.stake).toFixed(2)} profit
              </span>
            )}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing(v => !v)}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            data-testid={`edit-bet-${bet.id}`}
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="p-1.5 rounded-lg hover:bg-red-900/30 transition-colors text-muted-foreground hover:text-red-400"
            data-testid={`delete-bet-${bet.id}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <Input
            type="number"
            placeholder="Stake"
            value={stakeInput}
            onChange={e => setStakeInput(e.target.value)}
            className="h-7 text-xs w-24"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <select
            value={resultInput}
            onChange={e => setResultInput(e.target.value)}
            className="h-7 text-xs rounded-md px-2 flex-1"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "inherit" }}
          >
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="push">Push</option>
          </select>
          <button
            onClick={() => updateMutation.mutate({ stake: parseFloat(stakeInput) || null, result: resultInput })}
            className="p-1.5 rounded-lg bg-green-900/30 hover:bg-green-900/50 text-green-400"
          >
            <Check size={13} />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Parlay Card ───────────────────────────────────────────────────────────
function ParlayCard({ parlay, token }: { parlay: Parlay; token: string | null }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stakeInput, setStakeInput] = useState(String(parlay.stake ?? ""));
  const [resultInput, setResultInput] = useState(parlay.result ?? "open");

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/parlays/${parlay.id}`, body, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
      setEditing(false);
      toast({ title: "Parlay updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/parlays/${parlay.id}`, undefined, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
      toast({ title: "Parlay removed" });
    },
  });

  const legCount = parlay.legs?.length ?? 0;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid={`parlay-card-${parlay.id}`}
    >
      {/* Header */}
      <div className="flex items-start gap-2 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold" style={{ color: "#f59e0b" }}>
              {legCount}-LEG PARLAY
            </span>
            <ResultBadge result={parlay.result} />
          </div>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "hsl(45 100% 90%)" }}>
            {parlay.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
            {parlay.combinedOdds != null && (
              <span className="font-mono font-bold" style={{ color: "#4ade80" }}>{fmtOdds(parlay.combinedOdds)}</span>
            )}
            {parlay.stake != null && <span>Stake: <span className="font-semibold text-foreground">${parlay.stake}</span></span>}
            {parlay.potentialPayout != null && parlay.result === "open" && (
              <span>To win: <span className="font-semibold" style={{ color: "#f59e0b" }}>${parlay.potentialPayout.toFixed(2)}</span></span>
            )}
            {parlay.result === "won" && parlay.potentialPayout && parlay.stake && (
              <span className="font-semibold" style={{ color: "#4ade80" }}>
                +${(parlay.potentialPayout - parlay.stake).toFixed(2)} profit
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
            data-testid={`expand-parlay-${parlay.id}`}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={() => setEditing(v => !v)}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="p-1.5 rounded-lg hover:bg-red-900/30 transition-colors text-muted-foreground hover:text-red-400"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="flex items-center gap-2 px-3 pb-2 border-t border-border pt-2">
          <Input
            type="number"
            placeholder="Stake"
            value={stakeInput}
            onChange={e => setStakeInput(e.target.value)}
            className="h-7 text-xs w-24"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <select
            value={resultInput}
            onChange={e => setResultInput(e.target.value)}
            className="h-7 text-xs rounded-md px-2 flex-1"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "inherit" }}
          >
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="push">Push</option>
          </select>
          <button
            onClick={() => updateMutation.mutate({ stake: parseFloat(stakeInput) || null, result: resultInput })}
            className="p-1.5 rounded-lg bg-green-900/30 hover:bg-green-900/50 text-green-400"
          >
            <Check size={13} />
          </button>
          <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Expanded legs */}
      {expanded && parlay.legs?.length > 0 && (
        <div
          className="px-3 pb-3 space-y-1.5 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="text-[10px] font-bold text-muted-foreground pt-2 uppercase tracking-wide">Legs</p>
          {parlay.legs.map(leg => (
            <div
              key={leg.id}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: "hsl(45 100% 90%)" }}>
                  {leg.betTitle ?? leg.betId}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  {leg.betSport && <span style={{ color: SPORT_COLOR[leg.betSport] ?? "#a78bfa" }}>{leg.betSport}</span>}
                  {leg.betPickSide && <span>{leg.betPickSide}{leg.betLine != null ? ` ${leg.betLine}` : ""}</span>}
                  {leg.odds != null && <span className="font-mono font-bold" style={{ color: "#4ade80" }}>{fmtOdds(leg.odds)}</span>}
                </div>
              </div>
              <ResultBadge result={leg.result} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── P&L Summary ───────────────────────────────────────────────────────────
function PnlSummary({ data }: { data: PortfolioData }) {
  const s = data.summary;
  const totalStaked = (s.totalStaked ?? 0) + (s.parlayStaked ?? 0);
  const totalPnl = (s.netPnl ?? 0) + (s.parlayNetPnl ?? 0);
  const winRate = s.totalBets > 0 ? ((s.wonBets / (s.wonBets + s.lostBets || 1)) * 100).toFixed(1) : "—";
  const parlayWinRate = s.totalParlays > 0 ? ((s.wonParlays / (s.wonParlays + s.lostParlays || 1)) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      {/* Overall */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Overall Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Net P&L" value={fmtMoney(totalPnl)} accent={totalPnl >= 0 ? "#4ade80" : "#f87171"} />
          <StatCard label="Total Staked" value={`$${totalStaked.toFixed(2)}`} />
          <StatCard label="ROI" value={`${s.roi?.toFixed(1) ?? 0}%`} accent={s.roi >= 0 ? "#4ade80" : "#f87171"} />
          <StatCard label="Win Rate" value={`${winRate}%`} sub={`${s.wonBets}W – ${s.lostBets}L`} />
        </div>
      </div>

      {/* Standalone bets */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Standalone Bets</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total" value={String(s.totalBets)} sub={`${s.openBets} open`} />
          <StatCard label="Won" value={String(s.wonBets)} accent="#4ade80" />
          <StatCard label="Lost" value={String(s.lostBets)} accent="#f87171" />
          <StatCard label="Net P&L" value={fmtMoney(s.netPnl)} accent={s.netPnl >= 0 ? "#4ade80" : "#f87171"} />
        </div>
      </div>

      {/* Parlays */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Parlays</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total" value={String(s.totalParlays)} sub={`${s.openParlays} open`} />
          <StatCard label="Won" value={String(s.wonParlays)} accent="#4ade80" />
          <StatCard label="Lost" value={String(s.lostParlays)} accent="#f87171" />
          <StatCard label="Win Rate" value={`${parlayWinRate}%`} />
        </div>
      </div>

      {/* Bet distribution chart (simple bars) */}
      {data.bets.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Sport Breakdown</h3>
          <SportBreakdown bets={data.bets} />
        </div>
      )}
    </div>
  );
}

function SportBreakdown({ bets }: { bets: UserBet[] }) {
  const counts: Record<string, { total: number; won: number; lost: number }> = {};
  for (const b of bets) {
    const s = b.betSport ?? "Other";
    if (!counts[s]) counts[s] = { total: 0, won: 0, lost: 0 };
    counts[s].total++;
    if (b.result === "won") counts[s].won++;
    if (b.result === "lost") counts[s].lost++;
  }
  const sports = Object.entries(counts).sort((a, b) => b[1].total - a[1].total);
  const maxTotal = Math.max(...sports.map(s => s[1].total), 1);

  return (
    <div className="space-y-2">
      {sports.map(([sport, c]) => (
        <div key={sport} className="flex items-center gap-3">
          <span className="text-xs font-bold w-10 text-right" style={{ color: SPORT_COLOR[sport] ?? "#a78bfa" }}>{sport}</span>
          <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(c.total / maxTotal) * 100}%`,
                background: SPORT_COLOR[sport] ? `${SPORT_COLOR[sport]}40` : "rgba(167,139,250,0.3)",
                borderRight: `2px solid ${SPORT_COLOR[sport] ?? "#a78bfa"}`,
              }}
            />
          </div>
          <span className="text-xs text-muted-foreground w-20 text-right">
            <span style={{ color: "#4ade80" }}>{c.won}W</span>
            {" · "}
            <span style={{ color: "#f87171" }}>{c.lost}L</span>
            {" · "}
            <span>{c.total - c.won - c.lost} open</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Portfolio Page ───────────────────────────────────────────────────
export default function Portfolio() {
  const { isLoggedIn, token } = useAuth();
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery<PortfolioData>({
    queryKey: ["/api/portfolio"],
    queryFn: () => apiRequest("GET", "/api/portfolio", undefined, token).then(r => r.json()),
    enabled: isLoggedIn,
  });

  const gradeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/portfolio/grade", {}, token).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({
        title: "Grading complete",
        description: `Updated ${data?.gradedBets ?? 0} bet(s).`,
      });
    },
    onError: () => toast({ title: "Grading failed", variant: "destructive" }),
  });

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <LogIn size={40} className="text-muted-foreground" />
        <p className="text-lg font-bold" style={{ color: "hsl(45 100% 90%)" }}>Sign in to view your portfolio</p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Track your standalone bets and parlays, monitor P&L, and let the midnight grader do the work.
        </p>
        <Link href="/auth">
          <Button style={{ background: "#f59e0b", color: "#000" }} className="font-bold">
            Sign In / Create Account
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-lg bg-muted/30 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted/20 animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <p className="text-muted-foreground">Could not load portfolio.</p>
        <Button variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const standaloneOpen = data.bets.filter(b => b.result === "open" || !b.result);
  const standaloneGraded = data.bets.filter(b => b.result && b.result !== "open");

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black" style={{ color: "hsl(45 100% 90%)" }}>Portfolio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track your picks, parlays, and profits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={gradeMutation.isPending}
            onClick={() => gradeMutation.mutate()}
            data-testid="grade-bets-btn"
          >
            <RefreshCcw size={12} className="mr-1.5" />
            {gradeMutation.isPending ? "Grading..." : "Grade Now"}
          </Button>
        </div>
      </div>

      {/* Quick stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Net P&L"
          value={fmtMoney((data.summary.netPnl ?? 0) + (data.summary.parlayNetPnl ?? 0))}
          accent={(data.summary.netPnl + data.summary.parlayNetPnl) >= 0 ? "#4ade80" : "#f87171"}
        />
        <StatCard label="Open Bets" value={String(data.summary.openBets + data.summary.openParlays)} sub="standalone + parlays" />
        <StatCard label="Win Rate" value={
          data.summary.wonBets + data.summary.lostBets > 0
            ? `${((data.summary.wonBets / (data.summary.wonBets + data.summary.lostBets)) * 100).toFixed(0)}%`
            : "—"
        } sub={`${data.summary.wonBets}W – ${data.summary.lostBets}L`} />
        <StatCard label="ROI" value={`${data.summary.roi?.toFixed(1) ?? 0}%`} accent={data.summary.roi >= 0 ? "#4ade80" : "#f87171"} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="standalone">
        <TabsList className="w-full">
          <TabsTrigger value="standalone" className="flex-1" data-testid="tab-standalone">
            <Activity size={13} className="mr-1.5" />
            Standalone
            {data.bets.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                {data.bets.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="parlays" className="flex-1" data-testid="tab-parlays">
            <Layers size={13} className="mr-1.5" />
            Parlays
            {data.parlays.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                {data.parlays.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pnl" className="flex-1" data-testid="tab-pnl">
            <LineChart size={13} className="mr-1.5" />
            P&L
          </TabsTrigger>
        </TabsList>

        {/* Standalone tab */}
        <TabsContent value="standalone" className="mt-4 space-y-3">
          {data.bets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <ListChecks size={36} className="text-muted-foreground opacity-40" />
              <p className="text-sm font-semibold text-muted-foreground">No standalone bets yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Click "Track This Pick" on any bet card or add it as a standalone bet from the drawer.
              </p>
              <Link href="/bets">
                <Button variant="outline" size="sm" className="text-xs h-8">Browse Picks</Button>
              </Link>
            </div>
          ) : (
            <>
              {standaloneOpen.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Open ({standaloneOpen.length})</p>
                  {standaloneOpen.map(b => <BetRow key={b.id} bet={b} token={token} />)}
                </div>
              )}
              {standaloneGraded.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Graded ({standaloneGraded.length})</p>
                  {standaloneGraded.map(b => <BetRow key={b.id} bet={b} token={token} />)}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Parlays tab */}
        <TabsContent value="parlays" className="mt-4 space-y-3">
          {data.parlays.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Layers size={36} className="text-muted-foreground opacity-40" />
              <p className="text-sm font-semibold text-muted-foreground">No parlays yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Use the Parlay Slip (yellow cart button on any pick) to build and save a multi-leg parlay.
              </p>
              <Link href="/bets">
                <Button variant="outline" size="sm" className="text-xs h-8">Browse Picks</Button>
              </Link>
            </div>
          ) : (
            data.parlays.map(p => <ParlayCard key={p.id} parlay={p} token={token} />)
          )}
        </TabsContent>

        {/* P&L tab */}
        <TabsContent value="pnl" className="mt-4">
          <PnlSummary data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
