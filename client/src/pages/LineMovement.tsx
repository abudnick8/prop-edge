import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Activity,
  ChevronDown, ChevronUp, Users, DollarSign, Clock, Filter,
  FlaskConical, AlertTriangle, Newspaper, CloudRain, Zap, X, AlertCircle,
  Bell, BellOff, Target, Wind, Thermometer, Eye, ArrowRight,
  Brain, Star, BarChart2, CheckCircle, XCircle, Minus as MinusIcon,
  Share2,
} from "lucide-react";
import { shareGameCard } from "@/lib/shareGameCard";
import { Badge } from "@/components/ui/badge";
import { BookErrorCard, BookErrorsFilterButton, BookErrorsSection, useBookErrors, type BookError } from "@/components/BookErrors";
import { CheatSheetButton, CheatSheetInline } from "@/components/CheatSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SteamIntelBanner } from "@/components/SteamIntelBanner";
import { SharpMoneyPanel } from "@/components/SharpMoneyPanel";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LineData {
  open: number | null;
  current: number | null;
  move: number | null;
  // spread
  awayPublic?: number | null;
  awayMoney?: number | null;
  homePublic?: number | null;
  homeMoney?: number | null;
  // total
  overPublic?: number | null;
  overMoney?: number | null;
  underPublic?: number | null;
  underMoney?: number | null;
}

interface MoneylineData {
  awayOpen: number | null;
  awayCurrent: number | null;
  homeOpen: number | null;
  homeCurrent: number | null;
  awayPublic?: number | null;
  awayMoney?: number | null;
  homePublic?: number | null;
  homeMoney?: number | null;
}

interface GameLine {
  id: string;
  sport: string;
  awayTeam: string;
  homeTeam: string;
  gameTime: string | null;
  status: string;
  openingInserted: string | null;
  currentInserted: string | null;
  numBets: number | null;
  spread: LineData;
  total: LineData;
  moneyline: MoneylineData;
}

const SPORT_EMOJI: Record<string, string> = { NBA: "🏀", MLB: "⚾", NHL: "🏒", NFL: "🏈" };
const SPORTS = ["All", "NBA", "MLB", "NHL", "NFL"];

// ── Trigger List ──────────────────────────────────────────────────────────────

interface Trigger {
  id: string;
  sport: string;
  condition: string;
  action: string;
  direction: "over" | "under" | "fade" | "play";
  category: "injury" | "weather" | "lineup" | "schedule" | "steam";
  icon: string;
}

const ALL_TRIGGERS: Trigger[] = [
  // NBA
  { id:"nba-1",  sport:"NBA", condition:"Star player ruled OUT",                        action:"Bet the Under",           direction:"under", category:"injury",   icon:"🏀" },
  { id:"nba-2",  sport:"NBA", condition:"Pace mismatch: fast team vs slow team",        action:"Bet the Over",            direction:"over",  category:"lineup",   icon:"🏀" },
  { id:"nba-3",  sport:"NBA", condition:"Back-to-back fatigue (B2B)",                  action:"Bet the Under / Fade",    direction:"under", category:"schedule", icon:"🏀" },
  { id:"nba-4",  sport:"NBA", condition:"Sharp books move 2+ pts from opener",         action:"Follow the steam",        direction:"play",  category:"steam",    icon:"🏀" },
  // MLB
  { id:"mlb-1",  sport:"MLB", condition:"Wind blowing OUT > 10 mph",                   action:"Bet the Over",            direction:"over",  category:"weather",  icon:"⚾" },
  { id:"mlb-2",  sport:"MLB", condition:"Wind blowing IN > 10 mph",                    action:"Bet the Under",           direction:"under", category:"weather",  icon:"⚾" },
  { id:"mlb-3",  sport:"MLB", condition:"Bullpen game (opener strategy)",              action:"Bet the Over",            direction:"over",  category:"lineup",   icon:"⚾" },
  { id:"mlb-4",  sport:"MLB", condition:"Starter dealing with tightness / injury",    action:"Bet the Over / Fade",     direction:"over",  category:"injury",   icon:"⚾" },
  { id:"mlb-5",  sport:"MLB", condition:"Elite umpire (low K rate, tight zone)",       action:"Lean Under / low-scoring",direction:"under", category:"lineup",   icon:"⚾" },
  // NHL
  { id:"nhl-1",  sport:"NHL", condition:"Backup goalie confirmed in crease",           action:"Bet the Over",            direction:"over",  category:"lineup",   icon:"🏒" },
  { id:"nhl-2",  sport:"NHL", condition:"Elite starter confirmed (Vezina caliber)",    action:"Bet the Under",           direction:"under", category:"lineup",   icon:"🏒" },
  { id:"nhl-3",  sport:"NHL", condition:"Travel fatigue (3rd game in 4 nights)",       action:"Fade the tired team",     direction:"fade",  category:"schedule", icon:"🏒" },
  { id:"nhl-4",  sport:"NHL", condition:"Key forward out (PP1 unit broken)",           action:"Fade the team / Under",   direction:"under", category:"injury",   icon:"🏒" },
  // NFL
  { id:"nfl-1",  sport:"NFL", condition:"Wind > 15 mph at game time",                  action:"Bet the Under",           direction:"under", category:"weather",  icon:"🏈" },
  { id:"nfl-2",  sport:"NFL", condition:"Rain probability spike > 60%",                action:"Bet the Under",           direction:"under", category:"weather",  icon:"🏈" },
  { id:"nfl-3",  sport:"NFL", condition:"CB1 / CB2 listed OUT on injury report",       action:"Bet the Over / WR props", direction:"over",  category:"injury",   icon:"🏈" },
  { id:"nfl-4",  sport:"NFL", condition:"WR1 listed LIMITED in practice (Wed–Fri)",   action:"Monitor / Fade the Over", direction:"fade",  category:"injury",   icon:"🏈" },
  { id:"nfl-5",  sport:"NFL", condition:"Steam move ≥3 pts at sharp books",            action:"Follow steam before copy",direction:"play",  category:"steam",    icon:"🏈" },
  { id:"nfl-6",  sport:"NFL", condition:"OL starter(s) ruled OUT",                     action:"Fade the offense / Under",direction:"under", category:"injury",   icon:"🏈" },
];

const TRIGGER_CATEGORY_COLOR: Record<string, {bg:string;text:string;label:string}> = {
  injury:   { bg:"rgba(248,113,113,0.12)",  text:"#f87171",  label:"Injury" },
  weather:  { bg:"rgba(96,165,250,0.12)",   text:"#60a5fa",  label:"Weather" },
  lineup:   { bg:"rgba(167,139,250,0.12)",  text:"#a78bfa",  label:"Lineup" },
  schedule: { bg:"rgba(251,146,60,0.12)",   text:"#fb923c",  label:"Schedule" },
  steam:    { bg:"rgba(245,158,11,0.12)",   text:"#f59e0b",  label:"Steam" },
};

const DIRECTION_COLOR: Record<string, string> = {
  over:  "#4ade80",
  under: "#60a5fa",
  fade:  "#f87171",
  play:  "#f59e0b",
};

function TriggerList({ activeSport, alerts, toggleAlert, clearAlerts }: {
  activeSport: string;
  alerts: Set<string>;
  toggleAlert: (id: string) => void;
  clearAlerts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterSport, setFilterSport] = useState<string>(activeSport === "All" ? "all" : activeSport);

  const triggered = useMemo(() => {
    return ALL_TRIGGERS.filter(t => {
      const matchSport = filterSport === "all" || t.sport === filterSport;
      const matchCat   = filterCat   === "all" || t.category === filterCat;
      return matchSport && matchCat;
    });
  }, [filterSport, filterCat]);

  const alertCount = alerts.size;

  const cats = ["all", "injury", "weather", "lineup", "schedule", "steam"];
  const sports = ["all", "NBA", "MLB", "NHL", "NFL"];

  return (
    <div className="border border-amber-500/25 rounded-xl overflow-hidden" style={{ background: "rgba(245,158,11,0.04)" }}>
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-500/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Target size={15} className="text-amber-400" />
          <div className="text-left">
            <p className="text-sm font-black text-foreground flex items-center gap-2">
              Sharp Trigger List
              {alertCount > 0 && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/30">
                  {alertCount} active
                </span>
              )}
            </p>
            <p className="text-[10px] text-foreground/70">Auto-bet triggers — fire before books adjust · toggle alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!open && (
            <div className="flex gap-1 mr-2">
              {["NBA","MLB","NHL","NFL"].map(s => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 text-foreground/70 font-semibold">
                  {SPORT_EMOJI[s]}{ALL_TRIGGERS.filter(t=>t.sport===s).length}
                </span>
              ))}
            </div>
          )}
          {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-amber-500/15 px-4 pb-4 pt-3 space-y-3">
          {/* Quick tip */}
          <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg p-2.5 text-xs text-amber-200/80">
            <span className="font-bold text-amber-400">How to use: </span>
            These triggers fire before sportsbooks react. Toggle the bell to enable in-app notifications when a matching condition appears. Pinnacle/Circa move first — you have 30–120s before public books copy.
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-foreground/70 uppercase w-10">Sport</span>
              {sports.map(s => (
                <button key={s} onClick={()=>setFilterSport(s)}
                  className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
                  style={{ background:filterSport===s?"var(--primary)":"rgba(19,35,58,0.06)", color:filterSport===s?"#000":"var(--muted-foreground)", border:filterSport===s?"1px solid transparent":"1px solid rgba(19,35,58,0.11)" }}>
                  {s === "all" ? "All" : `${SPORT_EMOJI[s]} ${s}`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-foreground/70 uppercase w-10">Type</span>
              {cats.map(c => {
                const cc = c === "all" ? null : TRIGGER_CATEGORY_COLOR[c];
                return (
                  <button key={c} onClick={()=>setFilterCat(c)}
                    className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
                    style={{ background:filterCat===c?(cc?.text??"var(--primary)"):"rgba(19,35,58,0.06)", color:filterCat===c?"#000":"var(--muted-foreground)", border:filterCat===c?"1px solid transparent":"1px solid rgba(19,35,58,0.11)" }}>
                    {c === "all" ? "All Types" : (cc?.label ?? c)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trigger rows */}
          <div className="space-y-2">
            {triggered.map(trigger => {
              const cat = TRIGGER_CATEGORY_COLOR[trigger.category];
              const dirColor = DIRECTION_COLOR[trigger.direction];
              const alertOn = alerts.has(trigger.id);
              return (
                <div key={trigger.id}
                  className="flex items-center gap-3 rounded-xl border border-border/25 p-3 transition-all"
                  style={{ background: alertOn ? `${cat.bg}` : "var(--card)" }}>
                  {/* Sport + category */}
                  <div className="flex-shrink-0 text-center">
                    <span className="text-base">{trigger.icon}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground">{trigger.condition}</span>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                            style={{ background:cat.bg, color:cat.text, border:`1px solid ${cat.text}40` }}>
                        {cat.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <ArrowRight size={9} style={{ color: dirColor }} />
                      <span className="text-[11px] font-bold" style={{ color: dirColor }}>{trigger.action}</span>
                    </div>
                  </div>

                  {/* Alert toggle */}
                  <button
                    onClick={() => toggleAlert(trigger.id)}
                    title={alertOn ? "Disable notification" : "Enable notification"}
                    className="flex-shrink-0 p-1.5 rounded-lg transition-all"
                    style={{ background: alertOn ? `${cat.text}20` : "rgba(19,35,58,0.06)", color: alertOn ? cat.text : "var(--muted-foreground)", border: `1px solid ${alertOn ? cat.text+"40" : "rgba(19,35,58,0.11)"}` }}
                  >
                    {alertOn ? <Bell size={12} /> : <BellOff size={12} />}
                  </button>
                </div>
              );
            })}
          </div>

          {triggered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No triggers match current filter</p>
          )}

          {alertCount > 0 && (
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-amber-400 flex items-center gap-1.5">
                <Bell size={10} /> {alertCount} trigger{alertCount!==1?"s":""} active — you'll be notified when matching conditions appear
              </p>
              <button onClick={clearAlerts} className="text-[9px] text-muted-foreground hover:text-foreground mt-1">Clear all alerts</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Thresholds for showing the Research button (must match server)
const RESEARCH_SPREAD_THRESHOLD = 1.5;
const RESEARCH_TOTAL_THRESHOLD  = 1.5;
const RESEARCH_ML_THRESHOLD     = 30;

interface ResearchResult {
  gameId: string;
  gameName: string;
  sport: string;
  gameTime: string | null;
  moveSummary: string;
  injuries: { player: string; status: string; team: string }[];
  weather: string | null;
  news: { title: string; link: string; pubDate: string }[];
  sharpSignals: string[];
  summary: string;
  researchedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtOdds(o: number | null | undefined): string {
  if (o == null) return "—";
  return o > 0 ? `+${o}` : String(o);
}

function fmtLine(n: number | null | undefined, prefix = ""): string {
  if (n == null) return "—";
  return `${prefix}${n > 0 ? "+" : ""}${n}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function moveBadge(move: number | null | undefined) {
  if (move == null || move === 0) return null;
  const abs = Math.abs(move);
  if (abs >= 3) return { label: `${move > 0 ? "+" : ""}${move}`, color: "#f87171", bg: "rgba(248,113,113,0.12)", icon: "🔥 Steam" };
  if (abs >= 1.5) return { label: `${move > 0 ? "+" : ""}${move}`, color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: "⚡ Significant" };
  return { label: `${move > 0 ? "+" : ""}${move}`, color: "rgba(19,35,58,0.7)", bg: "rgba(19,35,58,0.08)", icon: "Minor" };
}

function sharpSignal(moneyPct: number | null | undefined, publicPct: number | null | undefined): { label: string; color: string } | null {
  if (moneyPct == null || publicPct == null) return null;
  const div = moneyPct - publicPct;
  if (moneyPct >= 65 && div >= 20) return { label: `Sharp ↑ ${moneyPct}% $`, color: "#4ade80" };
  if (moneyPct >= 55 && div >= 15) return { label: `Lean ↑ ${moneyPct}% $`, color: "#86efac" };
  if (moneyPct <= 35 && div <= -20) return { label: `Fade ↓ ${moneyPct}% $`, color: "#f87171" };
  return null;
}

// ── MovementBar ───────────────────────────────────────────────────────────────
function MovementBar({ open, current, move, label }: { open: number | null; current: number | null; move: number | null; label: string }) {
  if (open == null || current == null) return null;
  const badge = moveBadge(move);
  const moved = move != null && move !== 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-muted-foreground text-right font-medium">{label}</span>
      <span className="font-mono text-foreground/70">{fmtLine(open)}</span>
      <span className="text-foreground/70">→</span>
      <span className={`font-mono font-bold ${moved ? "text-foreground" : "text-muted-foreground"}`}>{fmtLine(current)}</span>
      {badge && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
          style={{ color: badge.color, background: badge.bg }}
        >
          {badge.label}
        </span>
      )}
    </div>
  );
}

// ── PublicBar ─────────────────────────────────────────────────────────────────
function PublicBar({ label, publicPct, moneyPct }: { label: string; publicPct: number | null | undefined; moneyPct: number | null | undefined }) {
  if (publicPct == null && moneyPct == null) return null;
  const signal = sharpSignal(moneyPct, publicPct);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        {signal && <span className="font-semibold" style={{ color: signal.color }}>{signal.label}</span>}
      </div>
      {publicPct != null && (
        <div className="flex items-center gap-1.5">
          <Users size={9} className="text-muted-foreground flex-shrink-0" />
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${publicPct}%`, background: "rgba(99,102,241,0.6)" }} />
          </div>
          <span className="text-[10px] text-muted-foreground font-mono w-7 text-right">{publicPct}%</span>
        </div>
      )}
      {moneyPct != null && (
        <div className="flex items-center gap-1.5">
          <DollarSign size={9} className="text-muted-foreground flex-shrink-0" />
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${moneyPct}%`, background: moneyPct >= 65 ? "rgba(74,222,128,0.7)" : "rgba(245,158,11,0.5)" }} />
          </div>
          <span className="text-[10px] font-mono w-7 text-right" style={{ color: moneyPct >= 65 ? "#4ade80" : moneyPct >= 55 ? "#f59e0b" : "rgba(19,35,58,0.56)" }}>{moneyPct}%</span>
        </div>
      )}
    </div>
  );
}

// ── GameCard ──────────────────────────────────────────────────────────────────
function ResearchPanel({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery<ResearchResult>({
    queryKey: ["/api/line-movement/research", gameId],
    queryFn: () => apiRequest("GET", `/api/line-movement/research/${encodeURIComponent(gameId)}`).then(r => r.json()),
    staleTime: 25 * 60 * 1000,
    retry: 1,
  });

  const statusColor = (s: string) => {
    const sl = s.toLowerCase();
    if (sl.includes("out") || sl.includes("ir")) return "text-red-400";
    if (sl.includes("doubtful")) return "text-orange-400";
    if (sl.includes("questionable")) return "text-amber-400";
    return "text-muted-foreground";
  };

  return (
    <div className="border-t border-primary/30 bg-primary/5 px-4 py-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-primary" />
          <span className="text-xs font-bold text-primary uppercase tracking-wider">Movement Intelligence</span>
          {data?.researchedAt && (
            <span className="text-[10px] text-foreground/70">
              &middot; {new Date(data.researchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-foreground/70 hover:text-foreground transition-colors" data-testid="close-research-panel">
          <X size={14} />
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-4/5 rounded" />
          <Skeleton className="h-4 w-3/5 rounded" />
          <p className="text-[10px] text-foreground/70 pt-1">Pulling injuries, news &amp; sharp signals&hellip;</p>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          <span>{(error as any)?.message ?? "Research failed. Try refreshing the page first."}</span>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {data.moveSummary && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Zap size={10} className="text-amber-400" /> Line Movement
              </p>
              <p className="text-xs text-foreground/90 leading-relaxed">{data.moveSummary}</p>
            </div>
          )}

          {data.sharpSignals.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <DollarSign size={10} className="text-green-400" /> Sharp Money
              </p>
              <ul className="space-y-0.5">
                {data.sharpSignals.map((sig, i) => (
                  <li key={i} className="text-xs text-foreground/80">&bull; {sig}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle size={10} className="text-orange-400" /> Injury Report
            </p>
            {data.injuries.length === 0 ? (
              <p className="text-xs text-foreground/70">No significant injuries found for these teams</p>
            ) : (
              <div className="space-y-1">
                {data.injuries.map((inj, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground/90">{inj.player}</span>
                    <span className="text-foreground/70">&mdash;</span>
                    <span className="text-foreground/70 text-[10px]">{inj.team}</span>
                    <span className={`ml-auto font-semibold text-[10px] ${statusColor(inj.status)}`}>{inj.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.weather && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <CloudRain size={10} className="text-blue-400" /> Weather
              </p>
              <p className="text-xs text-foreground/80">{data.weather}</p>
            </div>
          )}

          {data.news.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Newspaper size={10} className="text-indigo-400" /> Recent News
              </p>
              <ul className="space-y-1.5">
                {data.news.slice(0, 5).map((item, i) => (
                  <li key={i} className="text-[11px] leading-snug">
                    <a href={item.link} target="_blank" rel="noopener noreferrer"
                      className="text-foreground/80 hover:text-primary transition-colors hover:underline">
                      {item.title}
                    </a>
                    {item.pubDate && (
                      <span className="text-foreground/70 ml-1 text-[9px]">
                        &middot; {new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[9px] text-foreground/70 pt-1 border-t border-border/50">
            Data via ESPN injuries &amp; Google News &middot; Cached 30 min &middot; Always verify with official sources
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bet Recommendation Engine
// Analyzes line movement signals and returns a structured play recommendation
// ─────────────────────────────────────────────────────────────────────────────
type RecStrength = "strong" | "moderate" | "weak" | "none";
interface BetRec {
  strength:  RecStrength;
  directive: string;        // BIG bold command: "BET OVER 225.5" / "BET CHIEFS -3.5" / "BET UNDER 44.5"
  betType:   string;        // e.g. "Total" / "Spread" / "Moneyline"
  play:      string;        // full label: "Over 225.5 — Total" or "Chiefs -3.5 — Spread"
  signal:    string;        // e.g. "🔥 Steam Move"
  why:       string;        // 1-sentence: WHY this play (the movement data)
  detail:    string;        // 2-3 sentence deeper context
  urgency:   string;        // "Bet now — steam windows close fast" / "Monitor" etc.
  color:     string;
  bg:        string;
}

function buildBetRec(game: GameLine): BetRec | null {
  const spreadMove = game.spread.move ?? 0;
  const totalMove  = game.total.move ?? 0;
  const mlAwayMove = (game.moneyline.awayOpen != null && game.moneyline.awayCurrent != null)
    ? game.moneyline.awayCurrent - game.moneyline.awayOpen : 0;
  const mlHomeMove = (game.moneyline.homeOpen != null && game.moneyline.homeCurrent != null)
    ? game.moneyline.homeCurrent - game.moneyline.homeOpen : 0;

  const abSpread = Math.abs(spreadMove);
  const abTotal  = Math.abs(totalMove);
  const abMlAway = Math.abs(mlAwayMove);
  const abMlHome = Math.abs(mlHomeMove);

  // Public data for reverse-line detection
  const awayPublic = game.spread.awayPublic ?? 50;
  const homePublic = game.spread.homePublic ?? 50;
  const overPublic = game.total.overPublic ?? 50;

  // Helper — build team names
  const away = game.awayTeam;
  const home = game.homeTeam;

  // ── SIGNAL 1: Spread Steam (≥3 pts) ─────────────────────────────────────
  if (abSpread >= 3) {
    const favoredTeam  = spreadMove < 0 ? away : home;
    const lineStr      = game.spread.current != null ? fmtLine(game.spread.current) : "";
    const openStr      = fmtLine(game.spread.open);
    return {
      strength:  "strong",
      directive: `BET ${favoredTeam.split(" ").pop()?.toUpperCase()} ${lineStr}`,
      betType:   "Spread",
      play:      `${favoredTeam} ${lineStr} — Spread`,
      signal:    "🔥 Spread Steam",
      why:       `Spread steamed ${abSpread} pts toward ${favoredTeam} (${openStr} → ${lineStr}). Sharp money moved this line.`,
      detail:    `The spread opened at ${openStr} and has since moved ${abSpread} points to ${lineStr} in favor of ${favoredTeam}. A move this size is almost exclusively driven by professional/sharp bettors, not the public. Books are pricing in heavy action on ${favoredTeam}. Steam moves at Pinnacle, Circa, or DraftKings are the first to move — copy books follow within minutes. If you see this signal, the window to get the best number is closing.`,
      urgency:   "⏰ Bet now — steam windows close in minutes",
      color:     "#f87171",
      bg:        "rgba(248,113,113,0.08)",
    };
  }

  // ── SIGNAL 2: Total Steam (≥3 pts) ─────────────────────────────────────
  if (abTotal >= 3) {
    const dir     = totalMove > 0 ? "OVER" : "UNDER";
    const dirLow  = dir === "OVER" ? "Over" : "Under";
    const current = game.total.current;
    const open    = game.total.open;
    return {
      strength:  "strong",
      directive: `BET ${dir} ${current}`,
      betType:   "Total",
      play:      `${dirLow} ${current} — Total`,
      signal:    "🔥 Total Steam",
      why:       `Total steamed ${abTotal} pts toward the ${dirLow} (${open} → ${current}). Sharps are driving this.`,
      detail:    `The total opened at ${open} and has moved ${abTotal} pts to ${current}, a strong sharp signal on the ${dirLow}. ${dir === "OVER" ? `Sharp bettors expect more scoring than the market originally priced. They see something — pace, matchup, weather — that pushes this game higher than ${open}.` : `Sharps expect fewer points than the opener. This could be a defensive edge, pace mismatch, injury to a key offensive player, or weather (outdoor sports). The market is moving away from the public Over.`} Steam moves of ${abTotal}+ pts warrant immediate action at the current number.`,
      urgency:   "⏰ Bet now — steam windows close in minutes",
      color:     "#f87171",
      bg:        "rgba(248,113,113,0.08)",
    };
  }

  // ── SIGNAL 3: Reverse Line Movement on spread ─────────────────────────
  if (abSpread >= 1 && game.spread.awayPublic != null && game.spread.homePublic != null) {
    const publicOnAway    = awayPublic >= 60;
    const publicOnHome    = homePublic >= 60;
    const lineMovedToHome = spreadMove > 0;
    const lineMovedToAway = spreadMove < 0;

    if (publicOnAway && lineMovedToHome) {
      const lineStr = game.spread.current != null ? fmtLine(game.spread.current) : "";
      return {
        strength:  "moderate",
        directive: `BET ${home.split(" ").pop()?.toUpperCase()} ${lineStr}`,
        betType:   "Spread",
        play:      `${home} ${lineStr} — Spread`,
        signal:    "↩ Reverse Line Movement",
        why:       `${awayPublic}% of tickets are on ${away}, yet the spread moved toward ${home}. Classic sharp fade.`,
        detail:    `This is textbook reverse line movement. The public is ${awayPublic}% on ${away} — yet the line moved toward ${home}, meaning big sharp money is on ${home}. Books don't move lines to reward the public. When 60%+ of tickets are on one team but the line goes the other direction, that's professional money outweighing recreational volume. The play is ${home} ${lineStr}.`,
        urgency:   "👀 Fade the public — sharps are on the other side",
        color:     "#a78bfa",
        bg:        "rgba(167,139,250,0.08)",
      };
    }
    if (publicOnHome && lineMovedToAway) {
      const lineStr = game.spread.current != null ? fmtLine(game.spread.current) : "";
      return {
        strength:  "moderate",
        directive: `BET ${away.split(" ").pop()?.toUpperCase()} ${lineStr}`,
        betType:   "Spread",
        play:      `${away} ${lineStr} — Spread`,
        signal:    "↩ Reverse Line Movement",
        why:       `${homePublic}% of tickets are on ${home}, yet the line moved toward ${away}.`,
        detail:    `Classic reverse line movement. ${homePublic}% of public tickets are on ${home}, but the spread moved toward ${away}. Sharp money is quietly loading up on the away side while the public piles on the home team. Books respect sharp action over ticket count — fade the public and back ${away} ${lineStr}.`,
        urgency:   "👀 Fade the public — sharps are on the other side",
        color:     "#a78bfa",
        bg:        "rgba(167,139,250,0.08)",
      };
    }
  }

  // ── SIGNAL 4: Reverse Line Movement on total ─────────────────────────
  if (abTotal >= 1 && game.total.overPublic != null) {
    const publicOnOver  = overPublic >= 60;
    const lineMovedDown = totalMove < 0;
    const publicOnUnder = overPublic <= 40;
    const lineMovedUp   = totalMove > 0;

    if (publicOnOver && lineMovedDown) {
      return {
        strength:  "moderate",
        directive: `BET UNDER ${game.total.current}`,
        betType:   "Total",
        play:      `Under ${game.total.current} — Total`,
        signal:    "↩ Reverse Total Movement",
        why:       `${overPublic}% of bets are on the Over, yet the total dropped from ${game.total.open} to ${game.total.current}.`,
        detail:    `The public is pounding the Over (${overPublic}% of bets) but the total has fallen from ${game.total.open} to ${game.total.current}. That's sharp money forcing the line DOWN against the public flow. Books are being steamed off the Over by professionals who see a lower-scoring game. The play is the Under ${game.total.current}.`,
        urgency:   "👀 Bet the Under — sharps are fading the public Over",
        color:     "#60a5fa",
        bg:        "rgba(96,165,250,0.08)",
      };
    }
    if (publicOnUnder && lineMovedUp) {
      return {
        strength:  "moderate",
        directive: `BET OVER ${game.total.current}`,
        betType:   "Total",
        play:      `Over ${game.total.current} — Total`,
        signal:    "↩ Reverse Total Movement",
        why:       `Public is Under-heavy (${100 - overPublic}% Under) yet the total rose from ${game.total.open} to ${game.total.current}.`,
        detail:    `Despite the public loading the Under, the total has climbed from ${game.total.open} to ${game.total.current}. Sharp money is pushing this line up against the public grain. Books are respecting professional action on the Over. Fade the public Under and bet Over ${game.total.current}.`,
        urgency:   "👀 Bet the Over — sharps are fading the public Under",
        color:     "#4ade80",
        bg:        "rgba(74,222,128,0.08)",
      };
    }
  }

  // ── SIGNAL 5: Moneyline steam (≥50 points) ─────────────────────────
  if (abMlAway >= 50 || abMlHome >= 50) {
    const fav      = abMlAway >= abMlHome
      ? { team: away, move: mlAwayMove, current: game.moneyline.awayCurrent, open: game.moneyline.awayOpen }
      : { team: home, move: mlHomeMove, current: game.moneyline.homeCurrent, open: game.moneyline.homeOpen };
    const shortening = fav.move < 0; // odds shortened = money coming in on this team
    return {
      strength:  "moderate",
      directive: `BET ${fav.team.split(" ").pop()?.toUpperCase()} ML`,
      betType:   "Moneyline",
      play:      `${fav.team} ML ${fmtOdds(fav.current)} — Moneyline`,
      signal:    "💰 ML Steam",
      why:       `${fav.team} ML moved ${Math.abs(fav.move)} points (${fmtOdds(fav.open)} → ${fmtOdds(fav.current)}).`,
      detail:    `${fav.team}'s moneyline has moved ${Math.abs(fav.move)} points from ${fmtOdds(fav.open)} to ${fmtOdds(fav.current)}. ${shortening ? `The price is shortening — heavy sharp action is coming in on ${fav.team} to win outright. The market is pricing them as a stronger winning candidate than the opener suggested.` : `The price is lengthening — sharp money may be on the other side, making ${fav.team} a contrarian play at longer odds.`} A ${Math.abs(fav.move)}-point ML move warrants attention.`,
      urgency:   "Monitor for continued movement before betting",
      color:     "#facc15",
      bg:        "rgba(250,204,21,0.08)",
    };
  }

  // ── SIGNAL 6: Moderate spread move (1–2.5 pts) — watch signal ─────────
  if (abSpread >= 1) {
    const favoredTeam = spreadMove < 0 ? away : home;
    const lineStr     = game.spread.current != null ? fmtLine(game.spread.current) : "";
    const openStr     = fmtLine(game.spread.open);
    return {
      strength:  "weak",
      directive: `WATCH ${favoredTeam.split(" ").pop()?.toUpperCase()} ${lineStr}`,
      betType:   "Spread",
      play:      `${favoredTeam} ${lineStr} — Spread (developing)`,
      signal:    "⚡ Line Move",
      why:       `Spread moved ${abSpread} pts toward ${favoredTeam} (${openStr} → ${lineStr}). Not yet steam level.`,
      detail:    `The line has moved ${abSpread} pts from ${openStr} to ${lineStr} in favor of ${favoredTeam}. This is notable movement but hasn't reached steam threshold (3+ pts) yet. It could be early sharp action, an injury report, or a lineup change. Watch for the line to continue moving — if it hits 3 pts of total movement, it becomes a strong steam signal. Do not bet yet, but put ${favoredTeam} ${lineStr} on your watchlist.`,
      urgency:   "⏳ Not yet — watch for more movement toward 3 pts",
      color:     "#f59e0b",
      bg:        "rgba(245,158,11,0.06)",
    };
  }

  // ── SIGNAL 7: Moderate total move (1–2.5 pts) — watch signal ──────────
  if (abTotal >= 1) {
    const dir    = totalMove > 0 ? "OVER" : "UNDER";
    const dirLow = dir === "OVER" ? "Over" : "Under";
    return {
      strength:  "weak",
      directive: `WATCH ${dir} ${game.total.current}`,
      betType:   "Total",
      play:      `${dirLow} ${game.total.current} — Total (developing)`,
      signal:    "⚡ Total Move",
      why:       `Total has moved ${abTotal} pts toward the ${dirLow} (${game.total.open} → ${game.total.current}).`,
      detail:    `Total has shifted ${abTotal} pts from ${game.total.open} to ${game.total.current}. Not yet a confirmed steam move but worth tracking. If this continues in the same direction and hits 3+ pts of movement, sharps are likely behind it and the ${dirLow} ${game.total.current} becomes a play. Check back closer to game time.`,
      urgency:   "⏳ Not yet — watch for continued movement before acting",
      color:     "#f59e0b",
      bg:        "rgba(245,158,11,0.06)",
    };
  }

  return null;
}

// Compact inline badge shown directly on the card header
function RecBadge({ rec }: { rec: BetRec }) {
  return (
    <span
      className="text-[9px] font-black px-2 py-0.5 rounded-full border flex-shrink-0 hidden sm:inline"
      style={{ background: rec.bg, color: rec.color, borderColor: `${rec.color}40` }}
    >
      {rec.signal}
    </span>
  );
}

// Full recommendation card shown in the expanded detail section
function RecCard({ rec }: { rec: BetRec }) {
  const strengthLabel = rec.strength === "strong" ? "Strong Play" : rec.strength === "moderate" ? "Moderate Play" : "Developing Signal";

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: `${rec.color}35` }}>

      {/* ★ THE DIRECTIVE — biggest, most prominent element */}
      <div className="px-4 py-4" style={{ background: `${rec.color}14` }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: `${rec.color}99` }}>
              {rec.signal} · {rec.betType} · {strengthLabel}
            </p>
            {/* THE CALL — explicit, unambiguous */}
            <p
              className="text-2xl font-black tracking-tight leading-none"
              style={{ color: rec.color }}
            >
              {rec.directive}
            </p>
            <p className="text-xs font-semibold mt-1.5" style={{ color: `${rec.color}cc` }}>
              {rec.play}
            </p>
          </div>
          {/* Urgency pill */}
          <span
            className="text-[10px] font-bold px-3 py-1.5 rounded-full self-start flex-shrink-0"
            style={{ background: rec.bg, color: rec.color, border: `1px solid ${rec.color}40` }}
          >
            {rec.urgency}
          </span>
        </div>
      </div>

      {/* WHY section */}
      <div className="px-4 py-3 space-y-2" style={{ background: "rgba(19,35,58,0.02)" }}>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Why this play</p>
        <p className="text-xs font-semibold text-foreground/90 leading-relaxed">{rec.why}</p>
        <div className="rounded-lg p-3 text-[11px] text-muted-foreground leading-relaxed" style={{ background: "rgba(19,35,58,0.03)" }}>
          {rec.detail}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t" style={{ borderColor: `${rec.color}20`, background: "rgba(0,0,0,0.15)" }}>
        <p className="text-[9px] text-foreground/70">
          Based on ActionNetwork line movement data. Not financial advice — sharp signals can fail. Manage bankroll responsibly.
        </p>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Clubhouse IQ Pick Panel
// Fetches matching bet from /api/bets (ActionNetwork team bets) and renders
// the full CIQ analysis: grade, score, sizing, EV, chains, variables, pick rec
// ─────────────────────────────────────────────────────────────────────────────

interface CIQBet {
  id: string;
  sport: string;
  betType: string;
  source: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
  teamStats?: Record<string, unknown> | null;
  confidenceScore?: number | null;
  title?: string;
  description?: string;
}

const GRADE_COLOR: Record<string, string> = {
  "A+": "#22c55e",  A: "#4ade80",  "A-": "#86efac",
  "B+": "#fbbf24",  B: "#f59e0b",  "B-": "#f59e0b",
  "C+": "#fb923c",  C:  "#f97316", D:   "#ef4444",  F: "#dc2626",
};

const CHAIN_EMOJI: Record<string, string> = {
  THE_MISPRICING: "💎", SHARPS_LOVE: "💰", INJURY_GOLDMINE: "🩺",
  ACE_DOMINATION: "🎯", MISMATCH_MASSACRE: "⚡", FATIGUE_FADE: "😴",
  DUMPSTER_FIRE: "🗑️", SCHEDULE_LOSS: "📅", COLD_TAKE: "🥶",
  REVENGE_GAME: "🔥", PRIME_TIME: "⭐", TRAP_GAME: "⚠️",
  VALUE_SPOT: "📈", SHARP_ACTION: "🔱", PUBLIC_FADE: "🔄",
  TOTAL_STEAM: "♨️", SPREAD_STEAM: "🌊", COVER_MACHINE: "🏆",
  UNDERDOG_SPOT: "🐶", ROAD_WARRIOR: "✈️", HOME_COOKUP: "🏠",
  MUST_WIN: "❗", DIVISIONAL_EDGE: "🏟️", ALTITUDE_EFFECT: "⛰️",
  WEATHER_FACTOR: "🌧️", REST_ADVANTAGE: "💤", PACE_MISMATCH: "⏱️",
  GOALIE_MISMATCH: "🥅", ACE_FADE: "📉",
};

function CIQPickPanel({
  game, ciqData: data, isLoading, isFetching, refetch,
}: {
  game: GameLine;
  ciqData: any;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}) {
  // data / isLoading / isFetching / refetch come from GameCard via props

  if (isLoading || isFetching && !data) {
    return (
      <div className="rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-primary animate-pulse" />
          <span className="text-xs font-bold text-primary uppercase tracking-wider">Clubhouse IQ — Analyzing…</span>
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-4/5 rounded" />
          <Skeleton className="h-3 w-3/5 rounded" />
        </div>
        <p className="text-[10px] text-muted-foreground">Running Edge Crew v3 grade engine…</p>
      </div>
    );
  }

  if (!data || data.available === false) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Brain size={14} className="text-primary" />
            <span className="text-xs font-bold text-primary uppercase tracking-wider">Clubhouse IQ Pick</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 text-[10px] font-bold text-primary/70 hover:text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw size={10} className={isFetching ? "animate-spin" : ""} />
            {isFetching ? "Analyzing…" : "Retry"}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {data?.reason ?? "Analysis not available yet — tap Retry to run the Clubhouse IQ grade engine on this game."}
        </p>
      </div>
    );
  }

  const eg      = data.grade as string;
  const es      = data.score as number;
  const sizing  = data.sizing as string | undefined;
  const ev      = data.ev as any;
  const vars    = data.variables as Record<string, any> | undefined;
  const chains  = (data.chains ?? []) as string[];
  const peter   = data.peter as { flags?: any[]; has_kill?: boolean } | undefined;
  const pickSide  = data.pickSide as string | undefined;
  const pickTeam  = data.pickTeam as string | undefined;
  const pickedOdds = data.pickedOdds as number | null | undefined;

  const gradeColor = GRADE_COLOR[eg] ?? "#94a3b8";
  const evPct = ev?.ev_pct != null
    ? Number(ev.ev_pct).toFixed(1)
    : ev != null && typeof ev === "number"
      ? ev.toFixed(1) : null;
  const evPositive = evPct != null && parseFloat(evPct) > 0;

  const sizingLabel = sizing === "2u" ? "Max Bet (2 units)" :
    sizing === "1.5u" ? "Strong Bet (1.5 units)" :
    sizing === "1u"   ? "Standard Bet (1 unit)" : "PASS";
  const sizingColor = sizing === "2u" ? "#22c55e" : sizing === "1.5u" ? "#4ade80" : sizing === "1u" ? "#fbbf24" : "#94a3b8";

  const topVars = vars
    ? Object.entries(vars)
        .filter(([, v]) => v != null && typeof (v as any).score === "number")
        .sort(([, a], [, b]) => Math.abs((b as any).score) - Math.abs((a as any).score))
        .slice(0, 6)
    : [];

  const peterKill  = peter?.has_kill === true;
  const peterFlags = peter?.flags ?? [];

  const pickLabel = pickTeam
    ? `${pickTeam}${pickedOdds != null ? ` (${pickedOdds > 0 ? "+" : ""}${pickedOdds})` : ""}`
    : (eg && (eg.startsWith("A") || eg.startsWith("B")) ? "Check bet cards for pick" : "No strong edge detected");

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: `${gradeColor}35` }}>

      {/* ── Header: Grade + Score ── */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap"
        style={{ background: `${gradeColor}12`, borderBottom: `1px solid ${gradeColor}25` }}>
        <div className="flex items-center justify-center rounded-lg w-12 h-12 flex-shrink-0"
          style={{ background: `${gradeColor}18`, border: `2px solid ${gradeColor}` }}>
          <span className="text-2xl font-black leading-none" style={{ color: gradeColor }}>{eg}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: gradeColor }}>
              Clubhouse IQ Pick
            </span>
            {peterKill && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                ⚠️ KILL SIGNAL
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-foreground mt-0.5 leading-tight">{pickLabel}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground">
              Score: <span className="font-bold" style={{ color: gradeColor }}>{es.toFixed(1)}/10</span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              Size: <span className="font-bold" style={{ color: sizingColor }}>{sizingLabel}</span>
            </span>
            {evPct != null && (
              <span className="text-[10px] text-muted-foreground">
                EV: <span className="font-bold" style={{ color: evPositive ? "#4ade80" : "#f87171" }}>
                  {evPositive ? "+" : ""}{evPct}%
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-3xl font-black leading-none" style={{ color: gradeColor }}>{es.toFixed(1)}</div>
          <div className="text-[9px] text-muted-foreground">/ 10</div>
        </div>
      </div>

      {/* ── Chains Fired ── */}
      {chains.length > 0 && (
        <div className="px-4 py-3 space-y-2" style={{ borderBottom: `1px solid ${gradeColor}15` }}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Zap size={10} className="text-amber-400" /> Chains Fired ({chains.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chains.map((c, i) => {
              const isPositive = !["DUMPSTER_FIRE","SCHEDULE_LOSS","COLD_TAKE","TRAP_GAME","ACE_FADE"].includes(c);
              return (
                <span key={i}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{
                    background: isPositive ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                    color: isPositive ? "#4ade80" : "#f87171",
                    borderColor: isPositive ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)",
                  }}>
                  {CHAIN_EMOJI[c] ?? (isPositive ? "✅" : "❌")} {c.replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Variable Breakdown ── */}
      {topVars.length > 0 && (
        <div className="px-4 py-3 space-y-2" style={{ borderBottom: `1px solid ${gradeColor}15` }}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <BarChart2 size={10} className="text-indigo-400" /> Key Factors
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {topVars.map(([key, val], i) => {
              const score = (val as any).score as number;
              const label = (val as any).label ?? key.replace(/_/g, " ").replace(/\w/g, (c: string) => c.toUpperCase());
              const barW  = Math.min(Math.abs(score) / 2 * 100, 100);
              const barColor = score >= 1.5 ? "#22c55e" : score >= 0.5 ? "#4ade80" : score <= -1.5 ? "#ef4444" : score <= -0.5 ? "#f87171" : "#94a3b8";
              return (
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-foreground/80 font-medium">{label}</span>
                    <span className="font-bold font-mono" style={{ color: barColor }}>
                      {score > 0 ? "+" : ""}{score.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-border/50 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${barW}%`, background: barColor }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Peter/Kill Flags ── */}
      {peterFlags.length > 0 && (
        <div className="px-4 py-3 space-y-2" style={{ borderBottom: `1px solid ${gradeColor}15` }}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle size={10} className="text-orange-400" /> Risk Flags
          </p>
          <div className="space-y-1">
            {peterFlags.map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-orange-400 flex-shrink-0">⚠️</span>
                <span className="text-foreground/80">{typeof f === "string" ? f : f.reason ?? JSON.stringify(f)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recommendation ── */}
      <div className="px-4 py-3 flex items-start gap-3 flex-wrap"
        style={{ background: `${sizingColor}08` }}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <Star size={10} style={{ color: sizingColor }} /> Clubhouse Recommendation
          </p>
          <p className="text-sm font-bold" style={{ color: sizingColor }}>{sizingLabel}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {sizing === "2u" ? "High conviction edge — max unit allocation. Grade A+ signal with strong confluence." :
             sizing === "1.5u" ? "Strong edge with clear signal. Allocate 1.5 units. Monitor for line movement." :
             sizing === "1u" ? "Solid value. Standard 1-unit play — good edge, manageable risk." :
             "Edge below threshold. Skip or reduce to a small speculative play only."}
          </p>
        </div>
        <div className="flex-shrink-0 rounded-lg px-3 py-2 text-center"
          style={{ background: `${sizingColor}18`, border: `1px solid ${sizingColor}35` }}>
          <p className="text-[9px] text-muted-foreground">Units</p>
          <p className="text-xl font-black leading-tight" style={{ color: sizingColor }}>{sizing ?? "–"}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t" style={{ borderColor: `${gradeColor}20`, background: "rgba(0,0,0,0.08)" }}>
        <p className="text-[9px] text-muted-foreground">
          Clubhouse IQ · Edge Crew v3 · Grade: A+ (≥8.0) A (≥7.3) A- (≥6.5) B+ (≥6.0) B (≥5.5) PASS (&lt;5.0) · Not financial advice
        </p>
      </div>
    </div>
  );
}

// ── Share Card (canvas-based, see lib/shareGameCard.ts) ─────────────────────
// Legacy node kept as type anchor — actual rendering done in shareGameCard.ts
function _ShareCardNodeUnused({ game, ciqGrade, ciqPickTeam, rec }: {
  game: GameLine;
  ciqGrade: string | null;
  ciqPickTeam: string | undefined;
  rec: ReturnType<typeof buildBetRec>;
}) {
  const mlAwayMove = (game.moneyline.awayOpen != null && game.moneyline.awayCurrent != null)
    ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null;
  const mlHomeMove = (game.moneyline.homeOpen != null && game.moneyline.homeCurrent != null)
    ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null;
  const spreadMove = game.spread.move;
  const totalMove  = game.total.move;
  const hasSteam   = Math.abs(spreadMove ?? 0) >= 3 || Math.abs(totalMove ?? 0) >= 3;
  const ciqColor   = ciqGrade ? (GRADE_COLOR[ciqGrade] ?? "#a78bfa") : "#a78bfa";

  const row = (label: string, val: string, sub?: string, color?: string) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
      <span style={{ fontSize:11, color:"rgba(255,255,255,0.55)", fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase" }}>{label}</span>
      <div style={{ textAlign:"right" }}>
        <span style={{ fontSize:13, fontWeight:700, color: color ?? "#F6F1E7", fontFamily:"monospace" }}>{val}</span>
        {sub && <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>{sub}</span>}
      </div>
    </div>
  );

  return (
    <div style={{
      width: 380,
      background: "linear-gradient(145deg, #0f1923 0%, #13233A 60%, #0d1a2a 100%)",
      borderRadius: 20,
      padding: "20px 22px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
      color: "#F6F1E7",
      border: hasSteam ? "1.5px solid rgba(248,113,113,0.5)" : "1.5px solid rgba(255,255,255,0.10)",
    }}>

      {/* Brand header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:"#A23B32", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>⚾</div>
          <span style={{ fontWeight:900, fontSize:14, letterSpacing:"0.01em", color:"#F6F1E7" }}>Clubhouse IQ</span>
        </div>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontWeight:600 }}>Line Movement</span>
      </div>

      {/* Matchup */}
      <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
          <span style={{ fontSize:18 }}>{SPORT_EMOJI[game.sport] ?? "🏟"}</span>
          <div>
            <div style={{ fontSize:15, fontWeight:900, color:"#F6F1E7", lineHeight:1.2 }}>
              {game.awayTeam} <span style={{ color:"rgba(255,255,255,0.4)", fontWeight:400 }}>@</span> {game.homeTeam}
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{fmtTime(game.gameTime)}</div>
          </div>
        </div>
        {/* Status badges */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
          {hasSteam && (
            <span style={{ fontSize:10, fontWeight:800, background:"rgba(248,113,113,0.2)", color:"#fca5a5", border:"1px solid rgba(248,113,113,0.4)", borderRadius:6, padding:"3px 8px" }}>🔥 STEAM MOVE</span>
          )}
          {!hasSteam && (Math.abs(spreadMove ?? 0) >= 1.5 || Math.abs(totalMove ?? 0) >= 1.5) && (
            <span style={{ fontSize:10, fontWeight:800, background:"rgba(245,158,11,0.2)", color:"#fbbf24", border:"1px solid rgba(245,158,11,0.4)", borderRadius:6, padding:"3px 8px" }}>⚡ MOVED</span>
          )}
          {ciqGrade && (
            <span style={{ fontSize:10, fontWeight:900, background:`${ciqColor}25`, color:ciqColor, border:`1px solid ${ciqColor}60`, borderRadius:6, padding:"3px 8px" }}>
              🧠 CIQ {ciqGrade}{ciqPickTeam ? ` · ${ciqPickTeam}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Lines grid */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Lines</div>
        {/* Spread */}
        {row(
          game.sport === "MLB" ? "Run Line" : "Spread",
          game.spread.current != null ? fmtLine(game.spread.current) : "—",
          game.spread.open != null && game.spread.current !== game.spread.open
            ? `was ${fmtLine(game.spread.open)} (${spreadMove != null && spreadMove !== 0 ? (spreadMove > 0 ? "+" : "") + spreadMove : "no move"})`
            : game.spread.open != null ? `opened ${fmtLine(game.spread.open)}` : undefined,
          spreadMove != null && Math.abs(spreadMove) >= 3 ? "#fca5a5" : "#F6F1E7"
        )}
        {/* Total */}
        {row(
          "Total (O/U)",
          game.total.current != null ? `O/U ${game.total.current}` : "—",
          game.total.open != null && game.total.current !== game.total.open
            ? `was ${game.total.open} (${totalMove != null && totalMove !== 0 ? (totalMove > 0 ? "+" : "") + totalMove : "no move"})`
            : game.total.open != null ? `opened ${game.total.open}` : undefined,
          totalMove != null && Math.abs(totalMove) >= 3 ? "#fca5a5" : "#F6F1E7"
        )}
        {/* ML Away */}
        {row(
          `${game.awayTeam.split(" ").pop()} ML`,
          fmtOdds(game.moneyline.awayCurrent),
          game.moneyline.awayOpen != null ? `opened ${fmtOdds(game.moneyline.awayOpen)}${mlAwayMove != null && mlAwayMove !== 0 ? " (" + (mlAwayMove > 0 ? "+" : "") + mlAwayMove + ")" : ""}` : undefined,
          mlAwayMove != null && Math.abs(mlAwayMove) >= 50 ? "#fca5a5" : "#F6F1E7"
        )}
        {/* ML Home */}
        {row(
          `${game.homeTeam.split(" ").pop()} ML`,
          fmtOdds(game.moneyline.homeCurrent),
          game.moneyline.homeOpen != null ? `opened ${fmtOdds(game.moneyline.homeOpen)}${mlHomeMove != null && mlHomeMove !== 0 ? " (" + (mlHomeMove > 0 ? "+" : "") + mlHomeMove + ")" : ""}` : undefined,
          mlHomeMove != null && Math.abs(mlHomeMove) >= 50 ? "#fca5a5" : "#F6F1E7"
        )}
      </div>

      {/* Public money — if available */}
      {(game.spread.awayMoney != null || game.total.overMoney != null || game.moneyline.awayMoney != null) && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Public Money %</div>
          {game.spread.awayMoney != null && row(`Spread — ${game.awayTeam.split(" ").pop()}`, `${game.spread.awayMoney}% $`, game.spread.awayPublic != null ? `${game.spread.awayPublic}% bets` : undefined)}
          {game.total.overMoney != null && row("Total — Over", `${game.total.overMoney}% $`, game.total.overPublic != null ? `${game.total.overPublic}% bets` : undefined)}
          {game.moneyline.awayMoney != null && row(`ML — ${game.awayTeam.split(" ").pop()}`, `${game.moneyline.awayMoney}% $`, game.moneyline.awayPublic != null ? `${game.moneyline.awayPublic}% bets` : undefined)}
        </div>
      )}

      {/* Bet rec */}
      {rec && (
        <div style={{ background:`${rec.color}18`, border:`1px solid ${rec.color}40`, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
          <div style={{ fontSize:10, fontWeight:900, color:rec.color, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>{rec.signal}</div>
          <div style={{ fontSize:13, fontWeight:800, color:"#F6F1E7", marginBottom:4 }}>{rec.play}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", lineHeight:1.5 }}>{rec.why}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:10, marginTop:4 }}>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontWeight:600 }}>clubhouse-iq.up.railway.app</span>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>{new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}</span>
      </div>
    </div>
  );
}

// ── OddsMovementChart ─────────────────────────────────────────────────────────
// Renders a step-line SVG chart: open → midpoint → current
function OddsMovementChart({
  open, current, label, fmtValue,
}: {
  open: number | null;
  current: number | null;
  label: string;
  fmtValue?: (v: number) => string;
}) {
  if (open == null || current == null) return null;
  const fmt = fmtValue ?? ((v: number) => (v > 0 ? `+${v}` : String(v)));

  // Build 3-point step path: open → mid-open → mid-current → current
  const W = 280, H = 110, PAD_L = 46, PAD_R = 10, PAD_T = 14, PAD_B = 28;
  const gW = W - PAD_L - PAD_R;
  const gH = H - PAD_T - PAD_B;

  // Values — create a smooth 5-point step curve
  const pts = [
    { t: 0,    v: open },
    { t: 0.25, v: open },
    { t: 0.5,  v: (open + current) / 2 },
    { t: 0.75, v: current },
    { t: 1,    v: current },
  ];

  const best = Math.max(open, current);
  const worst = Math.min(open, current);
  const range = best - worst || 1;
  const margin = range * 0.45;
  const vMin = worst - margin;
  const vMax = best + margin;
  const vRange = vMax - vMin;

  const toX = (t: number) => PAD_L + t * gW;
  const toY = (v: number) => PAD_T + gH - ((v - vMin) / vRange) * gH;

  // Build SVG path as step-line
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t).toFixed(1)} ${toY(p.v).toFixed(1)}`).join(" ");

  // Y-axis ticks
  const ticks = [worst, (worst + best) / 2, best];
  const moved = current !== open;
  const lineColor = !moved ? "#94a3b8" : current > open ? "#22c55e" : "#ef4444";

  return (
    <div style={{ marginTop: 10, marginBottom: 2 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
        {/* Y-axis grid lines */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L} y1={toY(v)} x2={W - PAD_R} y2={toY(v)}
              stroke="rgba(19,35,58,0.08)" strokeWidth="1" strokeDasharray="3 3"
            />
            <text
              x={PAD_L - 5} y={toY(v) + 3.5}
              textAnchor="end" fontSize="9" fill="#64748b" fontFamily="monospace" fontWeight="600"
            >
              {fmt(Math.round(v))}
            </text>
          </g>
        ))}
        {/* Gradient fill under line */}
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${pathD} L ${toX(1).toFixed(1)} ${toY(vMin).toFixed(1)} L ${toX(0).toFixed(1)} ${toY(vMin).toFixed(1)} Z`}
          fill={`url(#grad-${label})`}
        />
        {/* Step-line */}
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Open dot */}
        <circle cx={toX(0)} cy={toY(open)} r={3.5} fill="#F6F1E7" stroke={lineColor} strokeWidth="2" />
        {/* Current dot */}
        <circle cx={toX(1)} cy={toY(current)} r={4} fill={lineColor} />
        {/* X-axis labels */}
        <text x={toX(0)} y={H - 5} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="600">Open</text>
        <text x={toX(1)} y={H - 5} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="600">Now</text>
      </svg>
      {/* Summary row */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "rgba(19,35,58,0.04)", borderRadius: 8, marginTop: 4 }}>
        {[
          { label: "Open",    val: fmt(open) },
          { label: "Current", val: fmt(current), highlight: true },
          { label: "Best",    val: fmt(best) },
          { label: "Worst",   val: fmt(worst) },
        ].map(({ label: l, val, highlight }) => (
          <div key={l} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{l}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: highlight ? lineColor : "#131A24", fontFamily: "monospace" }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ChartDrawer ─────────────────────────────────────────────────────────────
function ChartDrawer({
  label, open, current, fmtValue,
}: {
  label: string;
  open: number | null;
  current: number | null;
  fmtValue?: (v: number) => string;
}) {
  const [show, setShow] = useState(false);
  if (open == null && current == null) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setShow(s => !s)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 10, fontWeight: 700, color: show ? "#13233A" : "#3D4B58",
          background: show ? "rgba(19,35,58,0.10)" : "rgba(19,35,58,0.05)",
          border: "1px solid rgba(19,35,58,0.12)",
          borderRadius: 8, padding: "4px 10px", cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <BarChart2 size={10} />
        {show ? "Hide Chart" : "View Chart"}
        {show ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {show && (
        <div style={{
          marginTop: 6, padding: "10px 10px 6px",
          background: "#F6F1E7", borderRadius: 12,
          border: "1px solid rgba(19,35,58,0.10)",
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58", marginBottom: 2 }}>{label} Movement</p>
          <OddsMovementChart open={open} current={current} label={label} fmtValue={fmtValue} />
        </div>
      )}
    </div>
  );
}

// ── GameCard ───────────────────────────────────────────────────────────────────
function GameCard({ game }: { game: GameLine }) {
  const [expanded, setExpanded] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [sharing, setSharing] = useState(false);

  const rec = buildBetRec(game);

  // ── Lift CIQ query up so badge is available on collapsed card ──
  const ciqPostBody = {
    sport:          game.sport,
    homeTeam:       game.homeTeam,
    awayTeam:       game.awayTeam,
    awaySpread:     game.spread.current,
    spread:         game.spread.current,
    total:          game.total.current,
    mlHome:         game.moneyline.homeCurrent,
    mlAway:         game.moneyline.awayCurrent,
    spreadMove:     game.spread.move,
    homeMoneyPct:   game.moneyline.homeMoney,
    awayMoneyPct:   game.moneyline.awayMoney,
    spreadAwayPct:  game.spread.awayMoney,
    spreadHomePct:  game.spread.homeMoney,
  };
  const { data: ciqData, isLoading: ciqLoading, isFetching: ciqFetching, refetch: ciqRefetch } = useQuery<any>({
    queryKey: ["/api/line-movement/ciq", game.id],
    queryFn: async () => {
      try {
        const res = await fetch("/api/line-movement/ciq", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ciqPostBody),
        });
        if (!res.ok) return { available: false, reason: `Server error ${res.status}` };
        return await res.json();
      } catch (e: any) {
        return { available: false, reason: e?.message ?? "Network error" };
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 1500,
  });
  const ciqAvailable = ciqData?.available === true;
  const ciqGrade     = ciqAvailable ? (ciqData.grade as string) : null;
  const ciqPickTeam  = ciqAvailable ? (ciqData.pickTeam as string | undefined) : null;
  const ciqGradeColor = ciqGrade ? (GRADE_COLOR[ciqGrade] ?? "#94a3b8") : "#a78bfa";

  const spreadMove = game.spread.move;
  const totalMove = game.total.move;
  const totalAbsMove = Math.abs(spreadMove ?? 0) + Math.abs(totalMove ?? 0);
  const hasSteam = Math.abs(spreadMove ?? 0) >= 3 || Math.abs(totalMove ?? 0) >= 3;
  // Detect RLM and sharp divergence for intel banner
  const isRLM = (() => {
    if (game.spread?.awayPublic != null && spreadMove != null) {
      const pub = game.spread.awayPublic;
      if (pub >= 60 && (spreadMove ?? 0) > 0.5) return true;
      if (pub <= 38 && (spreadMove ?? 0) < -0.5) return true;
    }
    if (game.total?.overPublic != null && totalMove != null) {
      const pub = game.total.overPublic;
      if (pub >= 60 && (totalMove ?? 0) < -0.5) return true;
      if (pub <= 38 && (totalMove ?? 0) > 0.5) return true;
    }
    return false;
  })();
  const isSharpDiv = (() => {
    if (game.spread?.awayMoney != null && game.spread?.awayPublic != null) {
      return Math.abs(game.spread.awayMoney - game.spread.awayPublic) >= 25;
    }
    return false;
  })();
  const hasSignificant = totalAbsMove >= RESEARCH_SPREAD_THRESHOLD;
  const hasPublicData = game.spread.awayMoney != null || game.total.overMoney != null || game.moneyline.awayMoney != null;

  // ML movement
  const mlAwayMove = (game.moneyline.awayOpen != null && game.moneyline.awayCurrent != null)
    ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null;
  const mlHomeMove = (game.moneyline.homeOpen != null && game.moneyline.homeCurrent != null)
    ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null;

  // Is this game research-worthy?
  const mlAwayAbs = mlAwayMove != null ? Math.abs(mlAwayMove) : 0;
  const mlHomeAbs = mlHomeMove != null ? Math.abs(mlHomeMove) : 0;
  const hasResearchWorthy = hasSteam || hasSignificant ||
    mlAwayAbs >= RESEARCH_ML_THRESHOLD || mlHomeAbs >= RESEARCH_ML_THRESHOLD;

  return (
    <div
      className={`bg-card border rounded-xl overflow-hidden transition-all ${
        hasSteam ? "border-red-500/40 shadow-[0_0_12px_rgba(248,113,113,0.1)]" :
        hasSignificant ? "border-amber-500/30" : "border-border"
      }`}
    >
      {/* Header */}
      <div
        className="px-4 pt-3 pb-2 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`game-card-${game.id}`}
      >
        {/* Row 1: sport emoji + matchup + spread summary + chevron */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base flex-shrink-0 mt-0.5">{SPORT_EMOJI[game.sport] ?? "🏟"}</span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-snug">
                {game.awayTeam} <span className="text-muted-foreground font-normal">@</span> {game.homeTeam}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] text-foreground/70">{fmtTime(game.gameTime)}</span>
                {game.numBets != null && (
                  <span className="text-[10px] text-foreground/70">{game.numBets.toLocaleString()} bets</span>
                )}
                {game.openingInserted && (
                  <span className="text-[10px] text-foreground/70">opened {fmtRelTime(game.openingInserted)}</span>
                )}
              </div>
            </div>
          </div>
          {/* Spread/total + share + chevron — right side */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              {game.spread.current != null && (
                <p className="text-[11px] font-mono text-muted-foreground">
                  {fmtLine(game.spread.current)}
                  {spreadMove != null && spreadMove !== 0 && (
                    <span className={`ml-1 text-[10px] font-bold ${Math.abs(spreadMove) >= 3 ? "text-red-400" : "text-amber-400"}`}>
                      ({spreadMove > 0 ? "+" : ""}{spreadMove})
                    </span>
                  )}
                </p>
              )}
              {game.total.current != null && (
                <p className="text-[10px] font-mono text-foreground/70">
                  O/U {game.total.current}
                  {totalMove != null && totalMove !== 0 && (
                    <span className={`ml-1 text-[9px] font-bold ${Math.abs(totalMove) >= 3 ? "text-red-400" : "text-amber-400"}`}>
                      ({totalMove > 0 ? "+" : ""}{totalMove})
                    </span>
                  )}
                </p>
              )}
            </div>
            {/* Share button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (sharing) return;
                setSharing(true);
                const mlAwayMove = (game.moneyline.awayOpen != null && game.moneyline.awayCurrent != null)
                  ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null;
                const mlHomeMove = (game.moneyline.homeOpen != null && game.moneyline.homeCurrent != null)
                  ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null;
                shareGameCard({
                  sport: game.sport,
                  awayTeam: game.awayTeam,
                  homeTeam: game.homeTeam,
                  gameTime: game.gameTime,
                  spread: game.spread.current != null ? fmtLine(game.spread.current) : null,
                  spreadMove: game.spread.move != null ? fmtLine(game.spread.move) : null,
                  total: game.total.current != null ? String(game.total.current) : null,
                  totalMove: game.total.move != null ? fmtLine(game.total.move) : null,
                  mlAway: fmtOdds(game.moneyline.awayCurrent),
                  mlHome: fmtOdds(game.moneyline.homeCurrent),
                  mlAwayMove: mlAwayMove != null ? fmtOdds(mlAwayMove) : null,
                  mlHomeMove: mlHomeMove != null ? fmtOdds(mlHomeMove) : null,
                  spreadAwayMoney: game.spread.awayMoney,
                  spreadAwayPublic: game.spread.awayPublic,
                  totalOverMoney: game.total.overMoney,
                  totalOverPublic: game.total.overPublic,
                  mlAwayMoney: game.moneyline.awayMoney,
                  mlAwayPublic: game.moneyline.awayPublic,
                  hasSteam: Math.abs(game.spread.move ?? 0) >= 3 || Math.abs(game.total.move ?? 0) >= 3,
                  hasMoved: Math.abs(game.spread.move ?? 0) >= 1.5 || Math.abs(game.total.move ?? 0) >= 1.5,
                  ciqGrade: ciqGrade,
                  ciqPickTeam: ciqPickTeam ?? undefined,
                  recSignal: rec?.signal ?? null,
                  recPlay: rec?.play ?? null,
                  recWhy: rec?.why ?? null,
                  recColor: rec?.color ?? null,
                }).catch(e => { if (e?.name !== "AbortError") console.error("[Share]", e); })
                  .finally(() => setSharing(false));
              }}
              disabled={sharing}
              title="Share this game"
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all active:scale-90 disabled:opacity-40 flex-shrink-0"
              style={{ background: "rgba(19,35,58,0.08)", border: "1px solid rgba(19,35,58,0.12)" }}
            >
              {sharing
                ? <RefreshCw size={11} className="animate-spin" style={{ color: "#3D4B58" }} />
                : <Share2 size={11} style={{ color: "#3D4B58" }} />
              }
            </button>
            {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          </div>
        </div>

        {/* Row 2: badge strip — wraps naturally on mobile */}
        {!expanded && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {hasSteam && (
              <Badge className="text-[9px] px-1.5 py-0.5 bg-red-500/15 text-red-400 border-red-500/30 font-bold">🔥 STEAM</Badge>
            )}
            {!hasSteam && hasSignificant && (
              <Badge className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold">⚡ MOVED</Badge>
            )}
            {hasPublicData && (
              <Badge className="text-[9px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 border-indigo-500/20">$ DATA</Badge>
            )}
            {rec && <RecBadge rec={rec} />}
            {ciqAvailable && ciqGrade && (
              <span
                className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border flex-shrink-0"
                style={{
                  background: `${ciqGradeColor}20`,
                  color: ciqGradeColor,
                  borderColor: `${ciqGradeColor}50`,
                }}
              >
                🧠 {ciqGrade}{ciqPickTeam ? ` · ${ciqPickTeam}` : ""}
              </span>
            )}
            {hasResearchWorthy && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowResearch(!showResearch); }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors border ${
                  showResearch
                    ? "bg-primary/20 text-primary border-primary/40"
                    : "bg-primary/8 text-primary/70 border-primary/20 hover:bg-primary/15 hover:text-primary"
                }`}
                data-testid={`research-btn-${game.id}`}
              >
                <FlaskConical size={10} />
                {showResearch ? "Hide" : "Why?"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Steam Intel Banner — auto-shows WHY the line moved (injuries, news, weather, sharp $) */}
      {(hasSteam || isRLM || isSharpDiv) && (
        <SteamIntelBanner gameId={game.id} triggered={hasSteam || isRLM || isSharpDiv} />
      )}

      {/* Research panel — shown when user clicks Why? */}
      {showResearch && (
        <div>
          {/* Compact rec summary at top of Why panel so context is clear */}
          {rec && (
            <div className="px-4 pt-3">
              <div className="rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap" style={{ background: rec.bg, border: `1px solid ${rec.color}30` }}>
                <span className="text-[10px] font-black" style={{ color: rec.color }}>{rec.signal}</span>
                <span className="text-xs font-bold text-foreground">{rec.play}</span>
                <span className="text-[10px] text-muted-foreground flex-1">— {rec.why}</span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${rec.color}20`, color: rec.color }}>{rec.urgency}</span>
              </div>
            </div>
          )}
          <ResearchPanel gameId={game.id} onClose={() => setShowResearch(false)} />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">

          {/* ★ Bet Recommendation — shown first, most prominent section */}
          {rec && <RecCard rec={rec} />}

          {/* ★ Clubhouse IQ Pick — AI analysis from Edge Crew v3 grade engine */}
          <CIQPickPanel game={game} ciqData={ciqData} isLoading={ciqLoading} isFetching={ciqFetching} refetch={ciqRefetch} />

          {/* MLB public % unavailable notice */}
          {game.sport === "MLB" && game.spread.awayPublic == null && game.moneyline.awayPublic == null && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <span className="text-amber-400 mt-0.5">⚾</span>
              <div>
                <span className="font-bold text-amber-400">Public % not available for MLB</span>
                <span className="text-foreground/60 ml-1">— ActionNetwork doesn't publish betting splits for baseball. Sharp signals below are derived from line movement direction and moneyline shift.</span>
                {game.numBets != null && <span className="block text-foreground/50 mt-0.5">{game.numBets.toLocaleString()} total bets tracked on this game.</span>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Spread / Run Line */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {game.sport === "MLB" ? "Run Line" : `Spread (${game.awayTeam})`}
              </p>
              <MovementBar open={game.spread.open} current={game.spread.current} move={game.spread.move} label="Line" />
              {game.spread.awayPublic != null || game.spread.homePublic != null ? (
                <div className="space-y-1.5 mt-2">
                  <PublicBar label={`${game.awayTeam} (away)`} publicPct={game.spread.awayPublic} moneyPct={game.spread.awayMoney} />
                  <PublicBar label={`${game.homeTeam} (home)`} publicPct={game.spread.homePublic} moneyPct={game.spread.homeMoney} />
                </div>
              ) : game.spread.move != null && game.spread.move !== 0 ? (
                <p className="text-[10px] text-foreground/50 mt-1">
                  {game.sport === "MLB" ? "Run line vig shifted" : "Line moved"} {game.spread.move > 0 ? "+" : ""}{game.spread.move} — implied sharp action
                </p>
              ) : null}
              <ChartDrawer
                label={game.sport === "MLB" ? "Run Line" : "Spread"}
                open={game.spread.open}
                current={game.spread.current}
                fmtValue={(v) => v > 0 ? `+${v}` : String(v)}
              />
            </div>

            {/* Total */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total (O/U)</p>
              <MovementBar open={game.total.open} current={game.total.current} move={game.total.move} label="Line" />
              {game.total.overPublic != null || game.total.underPublic != null ? (
                <div className="space-y-1.5 mt-2">
                  <PublicBar label="Over" publicPct={game.total.overPublic} moneyPct={game.total.overMoney} />
                  <PublicBar label="Under" publicPct={game.total.underPublic} moneyPct={game.total.underMoney} />
                </div>
              ) : game.total.move != null && game.total.move !== 0 ? (
                <p className="text-[10px] text-foreground/50 mt-1">
                  Total moved {game.total.move > 0 ? "+" : ""}{game.total.move} — sharp action on the {game.total.move > 0 ? "Over" : "Under"}
                </p>
              ) : null}
              <ChartDrawer
                label="Total (O/U)"
                open={game.total.open}
                current={game.total.current}
                fmtValue={(v) => String(v)}
              />
            </div>

            {/* Moneyline */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Moneyline</p>
              <div className="space-y-1">
                {/* Away ML */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-12 text-muted-foreground text-right font-medium truncate">{game.awayTeam.split(" ").pop()}</span>
                  <span className="font-mono text-foreground/70">{fmtOdds(game.moneyline.awayOpen)}</span>
                  <span className="text-foreground/70">→</span>
                  <span className={`font-mono font-bold ${mlAwayMove !== 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmtOdds(game.moneyline.awayCurrent)}</span>
                  {mlAwayMove != null && mlAwayMove !== 0 && (
                    <span className="text-[10px] font-semibold" style={{ color: Math.abs(mlAwayMove) >= 50 ? "#f87171" : "#f59e0b" }}>
                      ({mlAwayMove > 0 ? "+" : ""}{mlAwayMove})
                    </span>
                  )}
                </div>
                {/* Home ML */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-12 text-muted-foreground text-right font-medium truncate">{game.homeTeam.split(" ").pop()}</span>
                  <span className="font-mono text-foreground/70">{fmtOdds(game.moneyline.homeOpen)}</span>
                  <span className="text-foreground/70">→</span>
                  <span className={`font-mono font-bold ${mlHomeMove !== 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmtOdds(game.moneyline.homeCurrent)}</span>
                  {mlHomeMove != null && mlHomeMove !== 0 && (
                    <span className="text-[10px] font-semibold" style={{ color: Math.abs(mlHomeMove) >= 50 ? "#f87171" : "#f59e0b" }}>
                      ({mlHomeMove > 0 ? "+" : ""}{mlHomeMove})
                    </span>
                  )}
                </div>
              </div>
              {game.moneyline.awayPublic != null || game.moneyline.homePublic != null ? (
                <div className="space-y-1.5 mt-2">
                  <PublicBar label={game.awayTeam.split(" ").pop()!} publicPct={game.moneyline.awayPublic} moneyPct={game.moneyline.awayMoney} />
                  <PublicBar label={game.homeTeam.split(" ").pop()!} publicPct={game.moneyline.homePublic} moneyPct={game.moneyline.homeMoney} />
                </div>
              ) : (mlAwayMove != null && mlAwayMove !== 0) || (mlHomeMove != null && mlHomeMove !== 0) ? (
                <p className="text-[10px] text-foreground/50 mt-1">
                  ML shifted — {mlAwayMove != null && mlAwayMove !== 0 ? `${game.awayTeam.split(" ").pop()} ${mlAwayMove > 0 ? "+" : ""}${mlAwayMove}` : `${game.homeTeam.split(" ").pop()} ${mlHomeMove! > 0 ? "+" : ""}${mlHomeMove}`}
                </p>
              ) : null}
              {/* Away ML chart */}
              <ChartDrawer
                label={`${game.awayTeam.split(" ").pop()} ML`}
                open={game.moneyline.awayOpen}
                current={game.moneyline.awayCurrent}
                fmtValue={(v) => v > 0 ? `+${v}` : String(v)}
              />
              {/* Home ML chart */}
              <ChartDrawer
                label={`${game.homeTeam.split(" ").pop()} ML`}
                open={game.moneyline.homeOpen}
                current={game.moneyline.homeCurrent}
                fmtValue={(v) => v > 0 ? `+${v}` : String(v)}
              />
            </div>
          </div>

          {/* Footer metadata */}
          <div className="flex items-center gap-4 pt-2 border-t border-border/50 text-[10px] text-foreground/70">
            {game.openingInserted && <span>Opened: {new Date(game.openingInserted).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
            {game.currentInserted && <span>Updated: {new Date(game.currentInserted).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
            {game.numBets != null && <span>{game.numBets.toLocaleString()} total bets tracked</span>}
            <span className="ml-auto">via ActionNetwork</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LineMovement() {
  const [sport, setSport] = useState("All");
  const [showSteamOnly, setShowSteamOnly] = useState(false);
  const [showMovedOnly, setShowMovedOnly] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  // Lifted trigger alert state — shared between header bell and TriggerList
  const [triggerAlerts, setTriggerAlerts] = useState<Set<string>>(new Set());
  const triggerListRef = useRef<HTMLDivElement>(null);

  const toggleTriggerAlert = useCallback((id: string) => {
    setTriggerAlerts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearTriggerAlerts = useCallback(() => setTriggerAlerts(new Set()), []);

  function scrollToTriggers() {
    triggerListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const { data: games = [], isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<GameLine[]>({
    queryKey: ["/api/line-movement"],
    queryFn: () => apiRequest("GET", "/api/line-movement").then(r => r.json()),
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 min
    staleTime: 4 * 60 * 1000,
  });

  const { data: bookErrors = [] } = useBookErrors(!isLoading);

  const filtered = useMemo(() => {
    let result = games as GameLine[];
    if (sport !== "All") result = result.filter(g => g.sport === sport);
    if (showSteamOnly) result = result.filter(g =>
      Math.abs(g.spread.move ?? 0) >= 3 || Math.abs(g.total.move ?? 0) >= 3
    );
    if (showMovedOnly) result = result.filter(g =>
      (g.spread.move != null && g.spread.move !== 0) || (g.total.move != null && g.total.move !== 0)
    );
    return result;
  }, [games, sport, showSteamOnly, showMovedOnly]);

  const steamCount = (games as GameLine[]).filter(g =>
    Math.abs(g.spread.move ?? 0) >= 3 || Math.abs(g.total.move ?? 0) >= 3
  ).length;

  const movedCount = (games as GameLine[]).filter(g =>
    (g.spread.move != null && g.spread.move !== 0) || (g.total.move != null && g.total.move !== 0)
  ).length;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  // Group by sport for display
  const bySport = useMemo(() => {
    const m: Record<string, GameLine[]> = {};
    for (const g of filtered) {
      if (!m[g.sport]) m[g.sport] = [];
      m[g.sport].push(g);
    }
    return m;
  }, [filtered]);

  const sportOrder = ["NBA", "MLB", "NHL", "NFL"];
  const activeSports = sportOrder.filter(s => bySport[s]);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-primary flex-shrink-0" />
            <h1 className="text-xl font-bold text-foreground">Line Movement</h1>
            {isFetching && <RefreshCw size={13} className="text-muted-foreground animate-spin" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            Opening → current lines for today's games · spread, total & moneyline · public % + sharp money
            {lastUpdated && <span className="ml-1 text-foreground/70">· updated {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <CheatSheetButton initialSection="spread" label="How to Read" mobileIconOnly />
          {/* Trigger alert bell — page-level, always visible */}
          <button
            onClick={scrollToTriggers}
            title={triggerAlerts.size > 0 ? `${triggerAlerts.size} trigger alert${triggerAlerts.size !== 1 ? "s" : ""} active` : "Sharp trigger alerts"}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
            style={{
              background: triggerAlerts.size > 0 ? "rgba(250,204,21,0.12)" : "rgba(19,35,58,0.06)",
              border: triggerAlerts.size > 0 ? "1px solid rgba(250,204,21,0.45)" : "1px solid rgba(19,35,58,0.17)",
              color: triggerAlerts.size > 0 ? "#facc15" : "var(--muted-foreground)",
              boxShadow: triggerAlerts.size > 0 ? "0 0 10px rgba(250,204,21,0.3)" : "none",
            }}
          >
            {triggerAlerts.size > 0
              ? <Bell size={13} className="animate-pulse" />
              : <BellOff size={13} />}
            <span className="hidden sm:inline">Trigger Alerts</span>
            {triggerAlerts.size > 0 && (
              <span
                className="flex items-center justify-center rounded-full text-[10px] font-black w-4 h-4"
                style={{ background: "#facc15", color: "#000" }}
              >
                {triggerAlerts.size}
              </span>
            )}
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5"
            data-testid="button-refresh-lines"
          >
            <RefreshCw size={13} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Summary stat bar */}
      {!isLoading && (games as GameLine[]).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground">Games Today</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{(games as GameLine[]).length}</p>
          </div>
          <div className="bg-card border border-red-500/20 rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground">Steam Moves <span className="text-[10px]">(≥3pts)</span></p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: steamCount > 0 ? "#f87171" : "rgba(19,35,58,0.42)" }}>{steamCount}</p>
          </div>
          <div className="bg-card border border-amber-500/20 rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground">Lines Moved</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: movedCount > 0 ? "#f59e0b" : "rgba(19,35,58,0.42)" }}>{movedCount}</p>
          </div>
          <div
            className="bg-card border border-orange-500/30 rounded-xl px-4 py-3 cursor-pointer hover:bg-orange-500/5 transition-colors"
            onClick={() => setShowErrorsOnly(!showErrorsOnly)}
          >
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle size={10} className="text-orange-400" /> Book Errors
            </p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: (bookErrors as BookError[]).length > 0 ? "#fb923c" : "rgba(19,35,58,0.42)" }}>
              {(bookErrors as BookError[]).length}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Sport filter */}
        {SPORTS.map(s => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
              sport === s
                ? "bg-primary/10 text-primary border-primary/30"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            data-testid={`filter-sport-${s.toLowerCase()}`}
          >
            {s === "All" ? "All Sports" : `${SPORT_EMOJI[s]} ${s}`}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1" />
        {/* Steam filter */}
        <button
          onClick={() => { setShowSteamOnly(!showSteamOnly); if (!showSteamOnly) setShowMovedOnly(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
            showSteamOnly
              ? "bg-red-500/10 text-red-400 border-red-500/30"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
          data-testid="filter-steam"
        >
          🔥 Steam Only
          {steamCount > 0 && <span className="bg-red-500/20 text-red-400 rounded-full px-1.5 py-0.5 text-[10px]">{steamCount}</span>}
        </button>
        {/* Moved filter */}
        <button
          onClick={() => { setShowMovedOnly(!showMovedOnly); if (!showMovedOnly) { setShowSteamOnly(false); setShowErrorsOnly(false); } }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
            showMovedOnly
              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
          data-testid="filter-moved"
        >
          ⚡ Moved Only
        </button>
        {/* Book Errors filter */}
        <BookErrorsFilterButton
          active={showErrorsOnly}
          count={(bookErrors as BookError[]).length}
          onClick={() => { setShowErrorsOnly(!showErrorsOnly); if (!showErrorsOnly) { setShowSteamOnly(false); setShowMovedOnly(false); } }}
        />
      </div>

      {/* Sharp Trigger List */}
      <div ref={triggerListRef}>
        <TriggerList
          activeSport={sport}
          alerts={triggerAlerts}
          toggleAlert={toggleTriggerAlert}
          clearAlerts={clearTriggerAlerts}
        />
      </div>

      {/* Sport-specific tip */}
      {sport !== "All" && ["NBA","MLB","NHL","NFL"].includes(sport) && (
        <CheatSheetInline section={sport.toLowerCase() as any} />
      )}

      {/* Book Errors Section */}
      {showErrorsOnly && (
        <BookErrorsSection errors={bookErrors as BookError[]} />
      )}

      {/* ── Sharp Money Panel ── */}
      <div className="mt-2">
        <SharpMoneyPanel />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <Activity size={32} className="mx-auto text-foreground/70 mb-3" />
          <p className="text-sm font-medium text-foreground">
            {(games as GameLine[]).length === 0 ? "No games found for today" : "No games match the current filter"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(games as GameLine[]).length === 0
              ? "Lines will appear here as books post odds for today's games."
              : "Try a different sport or filter."}
          </p>
        </div>
      ) : sport !== "All" ? (
        // Single sport — flat list
        <div className="space-y-3">
          {filtered.map(g => <GameCard key={g.id} game={g} />)}
        </div>
      ) : (
        // All sports — grouped by sport
        <div className="space-y-6">
          {activeSports.map(s => (
            <div key={s} className="space-y-3">
              <div className="flex items-center gap-2">
                <span>{SPORT_EMOJI[s]}</span>
                <h2 className="text-sm font-bold text-foreground">{s}</h2>
                <span className="text-xs text-foreground/70 font-mono">{bySport[s].length} game{bySport[s].length !== 1 ? "s" : ""}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              {bySport[s].map(g => <GameCard key={g.id} game={g} />)}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex flex-wrap gap-4 pt-2 text-[10px] text-foreground/70 border-t border-border">
          <span className="flex items-center gap-1"><span className="text-red-400 font-bold">🔥 Steam</span> = line moved ≥3pts from open</span>
          <span className="flex items-center gap-1"><span className="text-amber-400 font-bold">⚡ Moved</span> = any line movement</span>
          <span className="flex items-center gap-1"><Users size={9} /> = % of bets (public tickets)</span>
          <span className="flex items-center gap-1"><DollarSign size={9} /> = % of money (sharp signal)</span>
          <span className="flex items-center gap-1"><span className="text-green-400">Green $</span> = 65%+ sharp money on that side</span>
          <CheatSheetButton initialSection="universal" variant="ghost" label="Full Cheat Sheet →" />
        </div>
      )}
    </div>
  );
}
