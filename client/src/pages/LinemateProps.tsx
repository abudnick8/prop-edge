import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp,
  BarChart2, Star, AlertTriangle, Zap, Shield, Activity,
  ExternalLink, Info, Users,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface BookLine {
  line:      number;
  overOdds:  number | null;
  underOdds: number | null;
}

interface HitWindow {
  games:   number;
  hits:    number;
  misses:  number;
  pushes:  number;
  hitRate: number;
  average: number;
}

interface Prop {
  sport:         string;
  group:         string;
  gameId:        string;
  playerName:    string;
  playerPos:     string;
  teamCode:      string;
  opponent:      string;
  isHome:        boolean | null;
  gameTime:      string;
  marketName:    string;
  marketType:    string;
  outcome:       string;
  consensusLine: number | null;
  bookLines:     Record<string, BookLine>;
  hitRateL5:     number | null;
  hitRateL10:    number | null;
  hitRateL20:    number | null;
  hitRateL30:    number | null;
  hitRateSeason: number | null;
  hitRateRecentForm: number | null;
  avgRecentForm: number | null;
  bestHitRate:   number | null;
  is100Club:     boolean;
  hitRecords:    Record<string, Record<string, { all: HitWindow }>>;
  description:   string;
  insights:      any[];
  narratives:    any[];
  contextual:    any[];
  impactingInjuries: any[];
  opponentDefRank:   any;
}

interface LinemateData {
  sport:       string;
  picks:       Record<string, Prop[]>;
  markets:     Prop[];
  games:       { gameId: string; home: string; away: string; timestamp: string; status: string }[];
  propLineMap: Record<string, any>;
  fetchedAt:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtOdds(v: number | null): string {
  if (v == null) return "—";
  return v > 0 ? `+${v}` : String(v);
}

function fmtHR(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

function fmtTime(ts: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function hrColor(v: number | null): string {
  if (v == null) return "#64748b";
  if (v >= 90) return "#22c55e";
  if (v >= 75) return "#86efac";
  if (v >= 60) return "#facc15";
  if (v >= 45) return "#fb923c";
  return "#ef4444";
}

function hrBg(v: number | null): string {
  if (v == null) return "rgba(100,116,139,0.1)";
  if (v >= 90) return "rgba(34,197,94,0.12)";
  if (v >= 75) return "rgba(134,239,172,0.10)";
  if (v >= 60) return "rgba(250,204,21,0.10)";
  if (v >= 45) return "rgba(251,146,60,0.10)";
  return "rgba(239,68,68,0.10)";
}

// Format market name nicely: POINTS_PLUS_ASSISTS → Pts + Ast
const MARKET_LABELS: Record<string, string> = {
  POINTS: "Points", ASSISTS: "Assists", REBOUNDS: "Rebounds",
  BLOCKS: "Blocks", STEALS: "Steals", TURNOVERS: "Turnovers",
  THREE_POINTS_MADE: "3-Pointers", MINUTES_PLAYED: "Minutes",
  POINTS_PLUS_REBOUNDS: "Pts+Reb", POINTS_PLUS_ASSISTS: "Pts+Ast",
  REBOUNDS_PLUS_ASSISTS: "Reb+Ast",
  POINTS_PLUS_ASSISTS_PLUS_REBOUNDS: "Pts+Ast+Reb",
  // NFL
  PASSING_YARDS: "Pass Yds", RUSHING_YARDS: "Rush Yds", RECEIVING_YARDS: "Rec Yds",
  PASSING_TOUCHDOWNS: "Pass TDs", RUSHING_TOUCHDOWNS: "Rush TDs", RECEIVING_TOUCHDOWNS: "Rec TDs",
  RECEPTIONS: "Receptions", COMPLETIONS: "Completions", PASSING_ATTEMPTS: "Pass Att",
  // MLB
  STRIKEOUTS: "Strikeouts", HITS: "Hits", TOTAL_BASES: "Total Bases", EARNED_RUNS: "Earned Runs",
  HOME_RUNS: "Home Runs", WALKS_ALLOWED: "Walks",
  // NHL
  SHOTS_ON_GOAL: "Shots", GOALS: "Goals", SAVES: "Saves",
};

function fmtMarket(name: string): string {
  return MARKET_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Group config ──────────────────────────────────────────────────────────────
const GROUP_CONFIG = {
  "100_CLUB": {
    label: "100% Club",
    icon:  <Star size={13} className="text-yellow-400" />,
    color: "#facc15",
    bg:    "rgba(250,204,21,0.08)",
    border:"rgba(250,204,21,0.25)",
    desc:  "Perfect or near-perfect hit rate across multiple windows. Linemate's highest-confidence plays.",
  },
  SAFE: {
    label: "Safe Picks",
    icon:  <Shield size={13} className="text-green-400" />,
    color: "#22c55e",
    bg:    "rgba(34,197,94,0.08)",
    border:"rgba(34,197,94,0.25)",
    desc:  "High hit rate, lower risk. Best for legs in multi-pick slips.",
  },
  RISKY: {
    label: "Risky Picks",
    icon:  <AlertTriangle size={13} className="text-orange-400" />,
    color: "#fb923c",
    bg:    "rgba(251,146,60,0.08)",
    border:"rgba(251,146,60,0.25)",
    desc:  "Higher potential upside but more variance. Supports OVER/UNDER both directions.",
  },
};

// ── Sport tabs ────────────────────────────────────────────────────────────────
const SPORTS = [
  { id: "nba", label: "NBA", emoji: "🏀" },
  { id: "nfl", label: "NFL", emoji: "🏈" },
  { id: "mlb", label: "MLB", emoji: "⚾" },
  { id: "nhl", label: "NHL", emoji: "🏒" },
];

// ── Hit Rate Bar ──────────────────────────────────────────────────────────────
function HitRateBar({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  const pct = value ?? 0;
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${highlight ? "ring-1 ring-yellow-400/30" : ""}`}
      style={{ background: hrBg(value), borderColor: hrColor(value) + "40" }}>
      <p className="text-[9px] text-muted-foreground/70 font-semibold uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1 bg-muted/40 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: hrColor(value) }} />
        </div>
        <span className="text-[10px] font-black shrink-0" style={{ color: hrColor(value) }}>{fmtHR(value)}</span>
      </div>
    </div>
  );
}

// ── Book Lines Row ────────────────────────────────────────────────────────────
function BookLinesRow({ bookLines, consensusLine }: { bookLines: Record<string, BookLine>; consensusLine: number | null }) {
  const books = Object.entries(bookLines).slice(0, 8);
  if (!books.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {books.map(([book, bl]) => {
        const isConsensus = bl.line === consensusLine;
        return (
          <div key={book}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] ${isConsensus ? "font-black" : "font-medium opacity-70"}`}
            style={isConsensus
              ? { background: "rgba(99,102,241,0.15)", borderColor: "rgba(99,102,241,0.35)", color: "#a5b4fc" }
              : { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)", color: "#94a3b8" }}>
            <span className="uppercase tracking-wide">{book.slice(0, 6)}</span>
            <span className="font-mono">{bl.line}</span>
            {bl.overOdds != null && <span className="text-muted-foreground/60">({fmtOdds(bl.overOdds)})</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Prop Card ─────────────────────────────────────────────────────────────────
function PropCard({ prop, showGroup = false }: { prop: Prop; showGroup?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const grpCfg = GROUP_CONFIG[prop.group as keyof typeof GROUP_CONFIG];
  const isOver = prop.outcome === "OVER";
  const outcomeColor = isOver ? "#22c55e" : "#ef4444";

  // Best hit rate badge
  const bestHR = prop.bestHitRate;
  const is100  = prop.is100Club;

  return (
    <div className="rounded-xl border overflow-hidden transition-all hover:bg-white/[0.02]"
      style={{ borderColor: grpCfg ? grpCfg.border : "rgba(255,255,255,0.10)", background: grpCfg ? grpCfg.bg : "rgba(255,255,255,0.02)" }}>

      {/* Header */}
      <button onClick={() => setExpanded(v => !v)} className="w-full text-left">
        <div className="flex items-start gap-3 px-4 py-3">
          {/* Player initials */}
          <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-black border"
            style={{ borderColor: grpCfg?.color + "50" ?? "rgba(255,255,255,0.1)", background: grpCfg?.bg ?? "rgba(255,255,255,0.04)", color: grpCfg?.color ?? "#94a3b8" }}>
            {prop.playerName.split(" ").map(w => w[0]).join("").slice(0, 2)}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name + tags */}
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <span className="font-black text-sm text-foreground">{prop.playerName}</span>
              <span className="text-[9px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">{prop.playerPos}</span>
              {showGroup && grpCfg && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded border inline-flex items-center gap-1"
                  style={{ color: grpCfg.color, background: grpCfg.bg, borderColor: grpCfg.border }}>
                  {grpCfg.icon} {grpCfg.label}
                </span>
              )}
              {is100 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded border inline-flex items-center gap-1"
                  style={{ color: "#facc15", background: "rgba(250,204,21,0.12)", borderColor: "rgba(250,204,21,0.30)" }}>
                  ⭐ 100% Club
                </span>
              )}
              {prop.impactingInjuries?.length > 0 && (
                <span className="text-[9px] font-bold text-red-400">⚠ Injury Alert</span>
              )}
            </div>

            {/* Game + time */}
            <p className="text-[10px] text-muted-foreground mb-1.5">
              {prop.teamCode} {prop.isHome === true ? "vs" : prop.isHome === false ? "@" : "vs"} {prop.opponent}
              {prop.gameTime && <span className="ml-1.5 text-muted-foreground/60">{fmtTime(prop.gameTime)}</span>}
            </p>

            {/* Market + line + outcome */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-foreground">{fmtMarket(prop.marketName)}</span>
              {prop.consensusLine != null && (
                <span className="text-xs font-black text-yellow-300">{prop.consensusLine}</span>
              )}
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded"
                style={{ background: isOver ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)", color: outcomeColor }}>
                {prop.outcome}
              </span>
              {bestHR != null && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full border"
                  style={{ color: hrColor(bestHR), background: hrBg(bestHR), borderColor: hrColor(bestHR) + "40" }}>
                  {fmtHR(bestHR)} best
                </span>
              )}
            </div>
          </div>

          {/* Hit rate strip */}
          <div className="shrink-0 flex flex-col items-end gap-1">
            {[
              { label: "L5",  value: prop.hitRateL5  },
              { label: "L10", value: prop.hitRateL10 },
            ].map(w => (
              <div key={w.label} className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground/60 w-6 text-right">{w.label}</span>
                <span className="text-[10px] font-black w-10 text-right" style={{ color: hrColor(w.value) }}>{fmtHR(w.value)}</span>
              </div>
            ))}
            <div className="shrink-0 mt-0.5">
              {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 flex flex-col gap-3 bg-background/40">

          {/* Hit rate grid */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 mb-2 flex items-center gap-1">
              <Activity size={9} /> Hit Rates vs {prop.consensusLine} line
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <HitRateBar label="L5"     value={prop.hitRateL5}     highlight={prop.hitRateL5 === prop.bestHitRate} />
              <HitRateBar label="L10"    value={prop.hitRateL10}    highlight={prop.hitRateL10 === prop.bestHitRate} />
              <HitRateBar label="L20"    value={prop.hitRateL20}    highlight={prop.hitRateL20 === prop.bestHitRate} />
              <HitRateBar label="L30"    value={prop.hitRateL30}    highlight={prop.hitRateL30 === prop.bestHitRate} />
              <HitRateBar label="Season" value={prop.hitRateSeason} />
              {prop.hitRateRecentForm != null && (
                <HitRateBar label="Recent Form" value={prop.hitRateRecentForm} highlight />
              )}
            </div>
            {prop.avgRecentForm != null && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Recent form avg: <span className="font-black text-foreground">{prop.avgRecentForm.toFixed(1)}</span>
                {prop.consensusLine != null && (
                  <span className={`ml-1.5 font-black ${prop.avgRecentForm >= prop.consensusLine ? "text-green-400" : "text-red-400"}`}>
                    ({prop.avgRecentForm >= (prop.consensusLine ?? 0) ? "+" : ""}{(prop.avgRecentForm - (prop.consensusLine ?? 0)).toFixed(1)} vs line)
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Lines across books */}
          {Object.keys(prop.bookLines).length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 mb-1 flex items-center gap-1">
                <BarChart2 size={9} /> Lines by Book
              </p>
              <BookLinesRow bookLines={prop.bookLines} consensusLine={prop.consensusLine} />
            </div>
          )}

          {/* Opponent def rank */}
          {prop.opponentDefRank && (
            <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-[10px]">
              <p className="font-bold text-muted-foreground mb-0.5 flex items-center gap-1"><Users size={9} /> Opponent Defense</p>
              <p className="text-foreground">{JSON.stringify(prop.opponentDefRank).slice(0, 200)}</p>
            </div>
          )}

          {/* Insights / narratives */}
          {prop.description && (
            <div className="rounded-lg border border-border/30 bg-background/30 px-3 py-2">
              <p className="text-[10px] font-bold text-muted-foreground mb-0.5 flex items-center gap-1"><Info size={9} /> Why this pick</p>
              <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{prop.description}</p>
            </div>
          )}

          {/* Injury alerts */}
          {prop.impactingInjuries?.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/05 px-3 py-2">
              <p className="text-[10px] font-bold text-red-400 mb-1 flex items-center gap-1">⚠ Impacting Injuries</p>
              {prop.impactingInjuries.map((inj: any, i: number) => (
                <p key={i} className="text-[10px] text-muted-foreground">
                  {inj.player?.fullName ?? ""} — {inj.status ?? "injured"}
                </p>
              ))}
            </div>
          )}

          {/* Linemate link */}
          <a href={`https://linemate.io/nba`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
            <ExternalLink size={10} /> View on Linemate
          </a>
        </div>
      )}
    </div>
  );
}

// ── Market Browser ─────────────────────────────────────────────────────────────
function MarketBrowser({ markets, games }: { markets: Prop[]; games: any[] }) {
  const [search, setSearch]         = useState("");
  const [filterMarket, setFilter]   = useState("ALL");
  const [sortBy, setSort]           = useState<"hitRate" | "line" | "player">("hitRate");
  const [filterGame, setFilterGame] = useState("ALL");

  const marketTypes = ["ALL", ...Array.from(new Set(markets.map(m => m.marketName))).sort()];
  const gameOptions = ["ALL", ...games.map(g => `${g.away} @ ${g.home}`)];

  const filtered = markets
    .filter(m => {
      if (search && !m.playerName.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterMarket !== "ALL" && m.marketName !== filterMarket) return false;
      if (filterGame !== "ALL") {
        const [away, home] = filterGame.replace(" @ ", ",").split(",");
        if (m.opponent !== away && m.opponent !== home && m.teamCode !== away && m.teamCode !== home) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "hitRate") return (b.bestHitRate ?? 0) - (a.bestHitRate ?? 0);
      if (sortBy === "line")    return (b.consensusLine ?? 0) - (a.consensusLine ?? 0);
      return a.playerName.localeCompare(b.playerName);
    });

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search player..."
          className="px-3 py-1.5 rounded-lg border border-border bg-background/60 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 w-36"
        />
        <select value={filterMarket} onChange={e => setFilter(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-border bg-background/60 text-xs text-foreground focus:outline-none appearance-none pr-6"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}>
          {marketTypes.slice(0, 15).map(m => (
            <option key={m} value={m}>{m === "ALL" ? "All Markets" : fmtMarket(m)}</option>
          ))}
        </select>
        <select value={filterGame} onChange={e => setFilterGame(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-border bg-background/60 text-xs text-foreground focus:outline-none appearance-none pr-6"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}>
          {gameOptions.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          {(["hitRate", "line", "player"] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${
                sortBy === s ? "bg-card text-foreground border-primary/50" : "text-muted-foreground border-border hover:bg-accent"
              }`}>
              {s === "hitRate" ? "Hit Rate" : s === "line" ? "Line" : "A-Z"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/60 mb-3">{filtered.length} props shown</p>

      <div className="flex flex-col gap-2">
        {filtered.slice(0, 80).map((p, i) => (
          <PropCard key={`${p.playerName}-${p.marketName}-${i}`} prop={p} showGroup={false} />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type PageTab = "picks" | "markets";

export default function LinemateProps() {
  const [sport, setSport]     = useState("nba");
  const [pageTab, setPageTab] = useState<PageTab>("picks");
  const [pickGroup, setPickGroup] = useState<"ALL" | "100_CLUB" | "SAFE" | "RISKY">("ALL");

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<LinemateData>({
    queryKey:        ["/api/linemate-props", sport],
    queryFn:         () => apiRequest("GET", `/api/linemate-props?sport=${sport}`).then(r => r.json()),
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // All recommended picks flattened
  const allPicks = data
    ? [
        ...(data.picks["100_CLUB"] ?? []),
        ...(data.picks["SAFE"] ?? []),
        ...(data.picks["RISKY"] ?? []),
      ]
    : [];
  const filteredPicks = pickGroup === "ALL"
    ? allPicks
    : (data?.picks[pickGroup] ?? []);

  const totalPicks   = allPicks.length;
  const club100Count = (data?.picks["100_CLUB"] ?? []).length;
  const safeCount    = (data?.picks["SAFE"] ?? []).length;
  const riskyCount   = (data?.picks["RISKY"] ?? []).length;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-foreground tracking-tight flex items-center gap-2">
              <Zap size={20} className="text-yellow-400" />
              Prop Lines
              <span className="text-[11px] font-bold text-indigo-400 px-2 py-0.5 rounded border border-indigo-400/30 bg-indigo-400/10 ml-1">
                Linemate + PrizePicks
              </span>
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Real sportsbook lines from PrizePicks, DraftKings, Sleeper & more.
              Hit rates across L5/L10/L20/L30/Season windows.
              {dataUpdatedAt > 0 && (
                <span className="text-primary ml-2">Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
              )}
            </p>
          </div>
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent shrink-0">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Summary chips */}
        {!isLoading && data && (
          <div className="flex flex-wrap gap-2 mt-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
              <Star size={11} className="text-yellow-400" />
              <span className="font-bold text-yellow-300">{club100Count} × 100% Club</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs">
              <Shield size={11} className="text-green-400" />
              <span className="font-bold text-green-300">{safeCount} Safe</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs">
              <AlertTriangle size={11} className="text-orange-400" />
              <span className="font-bold text-orange-300">{riskyCount} Risky</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
              <BarChart2 size={11} className="text-blue-400" />
              <span className="font-bold text-blue-300">{(data.markets ?? []).length} player markets</span>
            </div>
          </div>
        )}
      </div>

      {/* Sport tabs */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {SPORTS.map(s => (
          <button key={s.id} onClick={() => setSport(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              sport === s.id
                ? "text-foreground border-primary/50 bg-primary/15"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-accent"
            }`}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      {/* Page tabs */}
      <div className="flex gap-1 p-0.5 rounded-xl border border-border/50 bg-background/50 w-fit mb-5">
        <button onClick={() => setPageTab("picks")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            pageTab === "picks"
              ? "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}>
          <Star size={12} /> Recommended Picks {totalPicks > 0 && `(${totalPicks})`}
        </button>
        <button onClick={() => setPageTab("markets")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            pageTab === "markets"
              ? "bg-blue-500/15 text-blue-300 border border-blue-500/30"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}>
          <BarChart2 size={12} /> Market Browser
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/30 animate-pulse h-24" />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <>
          {/* Picks tab */}
          {pageTab === "picks" && (
            <div>
              {/* Group filter */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {([
                  { id: "ALL",      label: `All (${totalPicks})`,              color: "#94a3b8" },
                  { id: "100_CLUB", label: `⭐ 100% Club (${club100Count})`,   color: "#facc15" },
                  { id: "SAFE",     label: `🛡 Safe (${safeCount})`,           color: "#22c55e" },
                  { id: "RISKY",    label: `⚡ Risky (${riskyCount})`,         color: "#fb923c" },
                ] as const).map(g => (
                  <button key={g.id} onClick={() => setPickGroup(g.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      pickGroup === g.id
                        ? "bg-card border-primary/50 text-foreground shadow-sm"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                    style={pickGroup === g.id ? { color: g.color } : {}}>
                    {g.label}
                  </button>
                ))}
              </div>

              {/* Group descriptions */}
              {pickGroup !== "ALL" && GROUP_CONFIG[pickGroup as keyof typeof GROUP_CONFIG] && (
                <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 mb-4 text-[10px] text-muted-foreground flex items-start gap-1.5">
                  <Info size={10} className="mt-0.5 shrink-0" />
                  <span>{GROUP_CONFIG[pickGroup as keyof typeof GROUP_CONFIG].desc}</span>
                </div>
              )}

              {filteredPicks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
                  <p className="text-3xl mb-2">🏀</p>
                  <p className="font-semibold">No picks available</p>
                  <p className="text-xs mt-1">Try a different sport or check back closer to game time</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredPicks.map((p, i) => (
                    <PropCard key={`${p.playerName}-${p.marketName}-${i}`} prop={p} showGroup={pickGroup === "ALL"} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Markets tab */}
          {pageTab === "markets" && (
            <MarketBrowser markets={data.markets ?? []} games={data.games ?? []} />
          )}
        </>
      )}

      {/* Today's games */}
      {!isLoading && data && data.games.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border/40">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-2">Today's Games</p>
          <div className="flex flex-wrap gap-2">
            {data.games.map(g => (
              <div key={g.gameId} className="px-3 py-1.5 rounded-lg border border-border/40 bg-muted/10 text-xs font-bold text-foreground">
                {g.away} @ {g.home}
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{fmtTime(g.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 text-center">
        <p className="text-[10px] text-muted-foreground">
          Lines & hit rates sourced from{" "}
          <a href="https://linemate.io" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Linemate</a>
          {" "}· Books: PrizePicks, DraftKings, Sleeper, Betr, Hard Rock, Bet99 & more ·{" "}
          Not financial advice · Updates every 5 minutes
        </p>
      </div>
    </div>
  );
}
