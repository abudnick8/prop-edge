import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import {
  ArrowLeft, ExternalLink, RefreshCw, TrendingUp, Trophy,
  ChevronDown, ChevronUp, Twitter, Wallet, BarChart2, TrendingDown,
} from "lucide-react";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TraderTrade {
  market:       string;
  slug:         string;
  eventSlug:    string;
  outcome:      string;
  side:         string;
  price:        number;
  totalUsdc:    number;
  txCount:      number;
  purchaseType: "single" | "multiple" | "ongoing";
  timestamp:    number;
  icon:         string;
  conditionId:  string;
  polyUrl:      string | null;
}

interface Trader {
  rank:          string;
  wallet:        string;
  shortWallet:   string;
  displayName:   string;
  xUsername:     string | null;
  profileImage:  string | null;
  verifiedBadge: boolean;
  vol:           number;
  pnl:           number;
  trades:        TraderTrade[];
  source:        string;
}

interface TopTradersResponse {
  traders:   Trader[];
  category:  string;
  period:    string;
  source:    string;
  fetchedAt: string;
}

interface Position {
  wallet:       string;
  shortWallet:  string;
  displayName:  string;
  xUsername:    string | null;
  profileImage: string | null;
  rank:         number;
  pnl:          number;
  title:        string;
  slug:         string;
  eventSlug:    string;
  icon:         string;
  outcome:      string;
  size:         number;
  avgPrice:     number;
  curPrice:     number;
  currentValue: number;
  initialValue: number;
  cashPnl:      number;
  percentPnl:   number;
  endDate:      string;
  polyUrl:      string | null;
}

interface PositionsResponse {
  positions: Position[];
  byTrader:  Record<string, { displayName: string; xUsername: string | null; profileImage: string | null; rank: number; pnl: number; positions: Position[] }>;
  category:  string;
  period:    string;
  fetchedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v >= 0 ? "" : "-"}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${v >= 0 ? "" : "-"}$${(abs / 1_000).toFixed(1)}K`;
  return `${v >= 0 ? "" : "-"}$${abs.toFixed(0)}`;
}

function fmtCents(v: number): string {
  return `${Math.round(v * 100)}¢`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts * 1000;
  if (diff < 60_000)      return "just now";
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Purchase type badge ───────────────────────────────────────────────────────
const PURCHASE_TYPE_CONFIG = {
  single:   { label: "Single Buy",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)",   border: "rgba(96,165,250,0.30)",   icon: "1️⃣" },
  multiple: { label: "Multi-Entry", color: "#c084fc", bg: "rgba(192,132,252,0.12)",  border: "rgba(192,132,252,0.30)",  icon: "2️⃣" },
  ongoing:  { label: "Building",    color: "#34d399", bg: "rgba(52,211,153,0.12)",   border: "rgba(52,211,153,0.30)",   icon: "📈" },
};

function PurchaseTypeBadge({ type }: { type: "single" | "multiple" | "ongoing" }) {
  const cfg = PURCHASE_TYPE_CONFIG[type];
  return (
    <span
      className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border inline-flex items-center gap-1"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── Category / Period filter tabs ─────────────────────────────────────────────
const CATEGORIES = [
  { id: "SPORTS",   label: "Sports",   emoji: "⚽" },
  { id: "OVERALL",  label: "Overall",  emoji: "🌐" },
  { id: "POLITICS", label: "Politics", emoji: "🏛️" },
  { id: "CRYPTO",   label: "Crypto",   emoji: "₿" },
  { id: "CULTURE",  label: "Culture",  emoji: "🎬" },
];

const PERIODS = [
  { id: "ALL",   label: "All Time" },
  { id: "MONTH", label: "30 Days" },
  { id: "WEEK",  label: "7 Days"  },
  { id: "DAY",   label: "Today"   },
];

// ── Trader card (Profiles view) ───────────────────────────────────────────────
function TraderCard({ trader, rank }: { trader: Trader; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const pnlColor = trader.pnl >= 0 ? "#22c55e" : "#ef4444";
  const isTop3   = rank <= 3;
  const medal    = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

  return (
    <div
      className="rounded-xl border overflow-hidden transition-all"
      style={{
        background:  isTop3 ? "rgba(250,204,21,0.04)" : "rgba(255,255,255,0.03)",
        borderColor: isTop3 ? "rgba(250,204,21,0.25)"  : "rgba(255,255,255,0.10)",
      }}
    >
      {/* Header row */}
      <button
        onClick={() => trader.trades.length > 0 && setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Rank */}
        <div className="shrink-0 w-8 text-center">
          {medal
            ? <span className="text-lg">{medal}</span>
            : <span className="text-sm font-black text-muted-foreground">#{rank}</span>}
        </div>

        {/* Avatar / initials */}
        <div
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-black overflow-hidden border"
          style={{ borderColor: isTop3 ? "rgba(250,204,21,0.4)" : "rgba(255,255,255,0.1)" }}
        >
          {trader.profileImage ? (
            <img src={trader.profileImage} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <span style={{ color: isTop3 ? "#facc15" : "#94a3b8" }}>
              {trader.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {/* Name + wallet */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-foreground truncate">{trader.displayName}</span>
            {trader.verifiedBadge && <span className="text-[10px] text-blue-400">✓</span>}
            {trader.xUsername && (
              <a
                href={`https://x.com/${trader.xUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5"
              >
                <Twitter size={10} /> @{trader.xUsername}
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground font-mono">{trader.shortWallet}</span>
            <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">Polymarket</span>
          </div>
        </div>

        {/* PNL */}
        <div className="shrink-0 text-right">
          <p className="text-xs font-black" style={{ color: pnlColor }}>{fmtMoney(trader.pnl)}</p>
          <p className="text-[10px] text-muted-foreground">PNL</p>
        </div>

        {/* Volume */}
        <div className="shrink-0 text-right hidden sm:block">
          <p className="text-xs font-bold text-foreground">{fmtMoney(trader.vol)}</p>
          <p className="text-[10px] text-muted-foreground">Vol</p>
        </div>

        {/* Expand arrow */}
        {trader.trades.length > 0 && (
          <div className="shrink-0 ml-1">
            {expanded
              ? <ChevronUp size={14} className="text-muted-foreground" />
              : <ChevronDown size={14} className="text-muted-foreground" />}
          </div>
        )}
      </button>

      {/* Expanded trades */}
      {expanded && trader.trades.length > 0 && (
        <div className="border-t border-border/50 bg-background/40">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_80px_80px_90px_70px] gap-2 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 border-b border-border/30">
            <span>Market / Outcome</span>
            <span className="text-right">Price</span>
            <span className="text-right">Spent</span>
            <span className="text-right">Type</span>
            <span className="text-right">When</span>
          </div>

          {trader.trades.map((trade, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_80px_80px_90px_70px] gap-2 px-4 py-2.5 items-center border-b border-border/20 last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              {/* Market title + outcome */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {trade.icon && (
                    <img src={trade.icon} alt="" className="w-4 h-4 rounded-full shrink-0 object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  <span className="text-xs font-semibold text-foreground truncate">{trade.market}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[10px] font-black px-1.5 py-0.5 rounded"
                    style={trade.outcome.toLowerCase() === "yes" || trade.side === "BUY"
                      ? { background: "rgba(34,197,94,0.2)", color: "#22c55e" }
                      : { background: "rgba(239,68,68,0.2)", color: "#ef4444" }}
                  >
                    {trade.outcome || trade.side}
                  </span>
                  {trade.txCount > 1 && (
                    <span className="text-[9px] text-muted-foreground">{trade.txCount}×</span>
                  )}
                </div>
              </div>

              {/* Entry price */}
              <div className="text-right">
                <span className="font-mono text-xs text-foreground">{fmtCents(trade.price)}</span>
              </div>

              {/* Total USDC */}
              <div className="text-right">
                <span className="font-mono text-xs font-bold text-yellow-300">{fmtMoney(trade.totalUsdc)}</span>
              </div>

              {/* Purchase type */}
              <div className="text-right flex justify-end">
                <PurchaseTypeBadge type={trade.purchaseType} />
              </div>

              {/* Time */}
              <div className="text-right flex items-center justify-end gap-1">
                <span className="text-[9px] text-muted-foreground">{timeAgo(trade.timestamp)}</span>
                {trade.polyUrl && (
                  <a
                    href={trade.polyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No trades loaded indicator */}
      {expanded && trader.trades.length === 0 && (
        <div className="px-4 py-3 text-center text-xs text-muted-foreground border-t border-border/50">
          No recent trade detail available for this trader
        </div>
      )}
    </div>
  );
}

// ── Position card (Positions view) ────────────────────────────────────────────
function PositionCard({ pos, idx }: { pos: Position; idx: number }) {
  const isYes    = pos.outcome.toLowerCase() === "yes";
  const pnlPos   = pos.cashPnl >= 0;
  const priceDiff = pos.curPrice - pos.avgPrice;
  const priceUp  = priceDiff >= 0;

  return (
    <div
      className="rounded-xl border overflow-hidden hover:bg-white/[0.02] transition-colors"
      style={{ borderColor: "rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)" }}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Market icon */}
        <div className="shrink-0 mt-0.5">
          {pos.icon ? (
            <img
              src={pos.icon}
              alt=""
              className="w-8 h-8 rounded-lg object-cover border border-border/30"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
              {idx + 1}
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Market title */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-xs font-semibold text-foreground leading-snug line-clamp-2 flex-1">{pos.title}</span>
            {pos.polyUrl && (
              <a
                href={pos.polyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-indigo-400 hover:text-indigo-300 mt-0.5"
              >
                <ExternalLink size={10} />
              </a>
            )}
          </div>

          {/* Outcome badge + trader attribution */}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-md"
              style={isYes
                ? { background: "rgba(34,197,94,0.18)", color: "#22c55e" }
                : { background: "rgba(239,68,68,0.18)", color: "#ef4444" }}
            >
              {pos.outcome}
            </span>
            {/* Trader chip */}
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/40 bg-background/50">
              {pos.profileImage && (
                <img src={pos.profileImage} alt="" className="w-3 h-3 rounded-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <span className="text-[9px] font-bold text-muted-foreground">{pos.displayName}</span>
              {pos.xUsername && (
                <a
                  href={`https://x.com/${pos.xUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-sky-400"
                >
                  <Twitter size={8} />
                </a>
              )}
            </div>
            {pos.endDate && (
              <span className="text-[9px] text-muted-foreground/60">expires {pos.endDate}</span>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            {/* Current value */}
            <div>
              <p className="text-[9px] text-muted-foreground/70 font-semibold uppercase tracking-wide mb-0.5">Value</p>
              <p className="text-xs font-black text-yellow-300">{fmtMoney(pos.currentValue)}</p>
            </div>

            {/* Avg buy vs current price */}
            <div>
              <p className="text-[9px] text-muted-foreground/70 font-semibold uppercase tracking-wide mb-0.5">Avg Buy</p>
              <p className="text-xs font-mono text-foreground">{fmtCents(pos.avgPrice)}</p>
            </div>

            <div>
              <p className="text-[9px] text-muted-foreground/70 font-semibold uppercase tracking-wide mb-0.5">Now</p>
              <div className="flex items-center gap-1">
                <p className="text-xs font-mono text-foreground">{fmtCents(pos.curPrice)}</p>
                {Math.abs(priceDiff) >= 0.005 && (
                  priceUp
                    ? <TrendingUp size={9} className="text-green-400 shrink-0" />
                    : <TrendingDown size={9} className="text-red-400 shrink-0" />
                )}
              </div>
            </div>

            {/* Unrealized PNL */}
            <div>
              <p className="text-[9px] text-muted-foreground/70 font-semibold uppercase tracking-wide mb-0.5">P&amp;L</p>
              <p
                className="text-xs font-black"
                style={{ color: pnlPos ? "#22c55e" : "#ef4444" }}
              >
                {pnlPos ? "+" : ""}{fmtMoney(pos.cashPnl)}
                <span className="text-[9px] font-normal ml-1 opacity-70">
                  ({pnlPos ? "+" : ""}{pos.percentPnl.toFixed(1)}%)
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Positions view — grouped by trader toggle ─────────────────────────────────
type PosSort = "value" | "pnl" | "trader";

function PositionsView({ positions, byTrader }: { positions: Position[]; byTrader: PositionsResponse["byTrader"] }) {
  const [groupBy, setGroupBy] = useState<"flat" | "trader">("flat");
  const [sort, setSort]       = useState<PosSort>("value");

  const sorted = [...positions].sort((a, b) => {
    if (sort === "value")  return b.currentValue - a.currentValue;
    if (sort === "pnl")    return b.cashPnl - a.cashPnl;
    if (sort === "trader") return a.displayName.localeCompare(b.displayName);
    return 0;
  });

  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const totalPnl   = positions.reduce((s, p) => s + p.cashPnl, 0);

  return (
    <div>
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
          <Wallet size={11} className="text-yellow-400" />
          <span className="font-bold text-yellow-300">{positions.length} open positions</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
          <BarChart2 size={11} className="text-blue-400" />
          <span className="font-bold text-blue-300">{fmtMoney(totalValue)} total value</span>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"
          style={totalPnl >= 0
            ? { background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.2)" }
            : { background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.2)" }}
        >
          <TrendingUp size={11} style={{ color: totalPnl >= 0 ? "#22c55e" : "#ef4444" }} />
          <span className="font-bold" style={{ color: totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>
            {totalPnl >= 0 ? "+" : ""}{fmtMoney(totalPnl)} unrealized
          </span>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {/* Group toggle */}
        <div className="flex gap-1 p-0.5 rounded-lg border border-border/50 bg-background/50">
          <button
            onClick={() => setGroupBy("flat")}
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${
              groupBy === "flat"
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Positions
          </button>
          <button
            onClick={() => setGroupBy("trader")}
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${
              groupBy === "trader"
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            By Trader
          </button>
        </div>

        {/* Sort (only in flat view) */}
        {groupBy === "flat" && (
          <div className="flex gap-1">
            {(["value", "pnl", "trader"] as PosSort[]).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all capitalize ${
                  sort === s
                    ? "bg-card text-foreground border-primary/50"
                    : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
                }`}
              >
                {s === "value" ? "By Value" : s === "pnl" ? "By P&L" : "By Trader"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Flat list */}
      {groupBy === "flat" && (
        <div className="flex flex-col gap-2">
          {sorted.map((p, i) => (
            <PositionCard key={`${p.wallet}-${p.slug}-${i}`} pos={p} idx={i} />
          ))}
        </div>
      )}

      {/* Grouped by trader */}
      {groupBy === "trader" && (
        <div className="flex flex-col gap-4">
          {Object.entries(byTrader)
            .sort((a, b) => b[1].pnl - a[1].pnl)
            .map(([wallet, tData]) => (
              <TraderPositionGroup
                key={wallet}
                wallet={wallet}
                tData={tData}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── Trader Position Group (used in By Trader view) ────────────────────────────
function TraderPositionGroup({ wallet, tData }: {
  wallet: string;
  tData: { displayName: string; xUsername: string | null; profileImage: string | null; rank: number; pnl: number; positions: Position[] };
}) {
  const [open, setOpen] = useState(true);
  const groupValue = tData.positions.reduce((s, p) => s + p.currentValue, 0);
  const groupPnl   = tData.positions.reduce((s, p) => s + p.cashPnl, 0);
  const pnlPos     = groupPnl >= 0;

  return (
    <div className="rounded-xl border border-border/40 overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        {/* Avatar */}
        <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-black overflow-hidden border border-border/30">
          {tData.profileImage ? (
            <img src={tData.profileImage} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <span className="text-muted-foreground">{tData.displayName.charAt(0).toUpperCase()}</span>
          )}
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-foreground">{tData.displayName}</span>
            {tData.xUsername && (
              <a
                href={`https://x.com/${tData.xUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5"
              >
                <Twitter size={9} /> @{tData.xUsername}
              </a>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            {wallet.slice(0, 6)}…{wallet.slice(-4)} · {tData.positions.length} position{tData.positions.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs font-black text-yellow-300">{fmtMoney(groupValue)}</p>
          <p className="text-[9px]" style={{ color: pnlPos ? "#22c55e" : "#ef4444" }}>
            {pnlPos ? "+" : ""}{fmtMoney(groupPnl)} P&L
          </p>
        </div>

        <div className="shrink-0 ml-1">
          {open ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Positions list */}
      {open && (
        <div className="flex flex-col gap-0 divide-y divide-border/20">
          {tData.positions.map((p, i) => (
            <PositionCard key={`${p.slug}-${i}`} pos={p} idx={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type ViewMode = "profiles" | "positions";

export default function TopTraders() {
  const [, navigate] = useLocation();
  const [category, setCategory] = useState("SPORTS");
  const [period,   setPeriod]   = useState("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("profiles");

  // Profiles query
  const { data: profilesData, isLoading: profilesLoading, refetch: refetchProfiles, dataUpdatedAt } = useQuery<TopTradersResponse>({
    queryKey: ["/api/top-traders", category, period],
    queryFn:  () =>
      apiRequest("GET", `/api/top-traders?category=${category}&period=${period}&limit=20`).then(r => r.json()),
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: viewMode === "profiles",
  });

  // Positions query
  const { data: positionsData, isLoading: positionsLoading, refetch: refetchPositions } = useQuery<PositionsResponse>({
    queryKey: ["/api/top-traders/positions", category, period],
    queryFn:  () =>
      apiRequest("GET", `/api/top-traders/positions?category=${category}&period=${period}&limit=20`).then(r => r.json()),
    staleTime:       3 * 60_000,
    refetchInterval: 3 * 60_000,
    enabled: viewMode === "positions",
  });

  const traders        = profilesData?.traders ?? [];
  const positiveCount  = traders.filter(t => t.pnl > 0).length;
  const positions      = positionsData?.positions ?? [];
  const byTrader       = positionsData?.byTrader ?? {};

  const isLoading = viewMode === "profiles" ? profilesLoading : positionsLoading;

  function handleRefetch() {
    if (viewMode === "profiles") refetchProfiles();
    else refetchPositions();
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button + header */}
      <div className="mb-5">
        <button
          onClick={() => navigate("/markets")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft size={13} /> Back to Prediction Markets
        </button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-foreground tracking-tight flex items-center gap-2">
              <Trophy size={20} className="text-yellow-400" />
              Top Profitable Traders
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {viewMode === "profiles"
                ? "Most profitable Polymarket traders by realized PNL — click to see their recent bets."
                : "Open positions currently held by the top profitable wallets on Polymarket."}
              {dataUpdatedAt > 0 && viewMode === "profiles" && (
                <span className="text-primary ml-2">Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
              )}
            </p>
          </div>
          <button
            onClick={handleRefetch}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent shrink-0"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Summary chips — Profiles view */}
        {viewMode === "profiles" && !profilesLoading && traders.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
              <Trophy size={11} className="text-yellow-400" />
              <span className="font-bold text-yellow-300">{traders.length} traders shown</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs">
              <TrendingUp size={11} className="text-green-400" />
              <span className="font-bold text-green-300">{positiveCount} profitable</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 font-bold">
              {profilesData?.category ?? category} · {PERIODS.find(p => p.id === (profilesData?.period ?? period))?.label ?? period}
            </div>
          </div>
        )}
      </div>

      {/* ── View Mode Toggle ── */}
      <div className="flex gap-1.5 mb-4 p-0.5 rounded-xl border border-border/50 bg-background/50 w-fit">
        <button
          onClick={() => setViewMode("profiles")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            viewMode === "profiles"
              ? "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Trophy size={12} /> Trader Profiles
        </button>
        <button
          onClick={() => setViewMode("positions")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            viewMode === "positions"
              ? "bg-blue-500/15 text-blue-300 border border-blue-500/30 shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Wallet size={12} /> Active Positions
        </button>
      </div>

      {/* ── Category filter ── */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              category === cat.id
                ? "text-foreground border-primary/50 bg-primary/15"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* ── Period filter ── */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
              period === p.id
                ? "bg-card text-foreground border-primary/50 shadow-sm"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Purchase type legend (profiles only) ── */}
      {viewMode === "profiles" && (
        <div className="flex flex-wrap gap-3 mb-5 text-[10px] text-muted-foreground">
          <span className="font-bold">Trade types:</span>
          {(Object.entries(PURCHASE_TYPE_CONFIG) as [keyof typeof PURCHASE_TYPE_CONFIG, typeof PURCHASE_TYPE_CONFIG[keyof typeof PURCHASE_TYPE_CONFIG]][]).map(([key, cfg]) => (
            <span key={key} className="flex items-center gap-1">
              <span style={{ color: cfg.color }}>{cfg.icon}</span>
              <span style={{ color: cfg.color }}>{cfg.label}</span>
              <span className="text-muted-foreground/50">
                {key === "single"   ? "(1 transaction)"
                 : key === "multiple" ? "(2 transactions)"
                 : "(3+ → building position)"}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/30 animate-pulse h-16" />
          ))}
        </div>
      ) : viewMode === "profiles" ? (
        traders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
            <p className="text-4xl mb-3">📊</p>
            <p className="font-semibold">No trader data available</p>
            <p className="text-xs mt-1">Try a different category or time period</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {traders.map((trader, i) => (
              <TraderCard key={trader.wallet || i} trader={trader} rank={i + 1} />
            ))}
          </div>
        )
      ) : (
        positions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
            <p className="text-4xl mb-3">💼</p>
            <p className="font-semibold">No open positions found</p>
            <p className="text-xs mt-1">Try a different category or time period</p>
          </div>
        ) : (
          <PositionsView positions={positions} byTrader={byTrader} />
        )
      )}

      <div className="mt-8 text-center">
        <p className="text-[10px] text-muted-foreground">
          Data sourced from{" "}
          <a href="https://polymarket.com/leaderboard" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
            Polymarket Leaderboard
          </a>{" "}
          · Not financial advice · {viewMode === "profiles" ? "Profiles update every 5 min" : "Positions update every 3 min"}
        </p>
      </div>
    </div>
  );
}
