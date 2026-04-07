import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Activity,
  ChevronDown, ChevronUp, Users, DollarSign, Clock, Filter,
  FlaskConical, AlertTriangle, Newspaper, CloudRain, Zap, X, AlertCircle,
  Bell, BellOff, Target, Wind, Thermometer, Eye, ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookErrorCard, BookErrorsFilterButton, BookErrorsSection, useBookErrors, type BookError } from "@/components/BookErrors";
import { CheatSheetButton, CheatSheetInline } from "@/components/CheatSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
            <p className="text-[10px] text-muted-foreground">Auto-bet triggers — fire before books adjust · toggle alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!open && (
            <div className="flex gap-1 mr-2">
              {["NBA","MLB","NHL","NFL"].map(s => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground font-semibold">
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
              <span className="text-[10px] font-bold text-muted-foreground uppercase w-10">Sport</span>
              {sports.map(s => (
                <button key={s} onClick={()=>setFilterSport(s)}
                  className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
                  style={{ background:filterSport===s?"var(--primary)":"rgba(255,255,255,0.04)", color:filterSport===s?"#000":"var(--muted-foreground)", border:filterSport===s?"1px solid transparent":"1px solid rgba(255,255,255,0.08)" }}>
                  {s === "all" ? "All" : `${SPORT_EMOJI[s]} ${s}`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-muted-foreground uppercase w-10">Type</span>
              {cats.map(c => {
                const cc = c === "all" ? null : TRIGGER_CATEGORY_COLOR[c];
                return (
                  <button key={c} onClick={()=>setFilterCat(c)}
                    className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
                    style={{ background:filterCat===c?(cc?.text??"var(--primary)"):"rgba(255,255,255,0.04)", color:filterCat===c?"#000":"var(--muted-foreground)", border:filterCat===c?"1px solid transparent":"1px solid rgba(255,255,255,0.08)" }}>
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
                    style={{ background: alertOn ? `${cat.text}20` : "rgba(255,255,255,0.04)", color: alertOn ? cat.text : "var(--muted-foreground)", border: `1px solid ${alertOn ? cat.text+"40" : "rgba(255,255,255,0.08)"}` }}
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
  return { label: `${move > 0 ? "+" : ""}${move}`, color: "rgba(255,255,255,0.5)", bg: "rgba(255,255,255,0.06)", icon: "Minor" };
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
      <span className="font-mono text-muted-foreground/70">{fmtLine(open)}</span>
      <span className="text-muted-foreground/40">→</span>
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
          <span className="text-[10px] font-mono w-7 text-right" style={{ color: moneyPct >= 65 ? "#4ade80" : moneyPct >= 55 ? "#f59e0b" : "rgba(255,255,255,0.4)" }}>{moneyPct}%</span>
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
    if (sl.includes("questionable")) return "text-yellow-400";
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
            <span className="text-[10px] text-muted-foreground/60">
              &middot; {new Date(data.researchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid="close-research-panel">
          <X size={14} />
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-4/5 rounded" />
          <Skeleton className="h-4 w-3/5 rounded" />
          <p className="text-[10px] text-muted-foreground/50 pt-1">Pulling injuries, news &amp; sharp signals&hellip;</p>
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
              <p className="text-xs text-muted-foreground/70">No significant injuries found for these teams</p>
            ) : (
              <div className="space-y-1">
                {data.injuries.map((inj, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground/90">{inj.player}</span>
                    <span className="text-muted-foreground/50">&mdash;</span>
                    <span className="text-muted-foreground/70 text-[10px]">{inj.team}</span>
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
                      <span className="text-muted-foreground/40 ml-1 text-[9px]">
                        &middot; {new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[9px] text-muted-foreground/40 pt-1 border-t border-border/50">
            Data via ESPN injuries &amp; Google News &middot; Cached 30 min &middot; Always verify with official sources
          </p>
        </div>
      )}
    </div>
  );
}

function GameCard({ game }: { game: GameLine }) {
  const [expanded, setExpanded] = useState(false);
  const [showResearch, setShowResearch] = useState(false);

  const spreadMove = game.spread.move;
  const totalMove = game.total.move;
  const totalAbsMove = Math.abs(spreadMove ?? 0) + Math.abs(totalMove ?? 0);
  const hasSteam = Math.abs(spreadMove ?? 0) >= 3 || Math.abs(totalMove ?? 0) >= 3;
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
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`game-card-${game.id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-base flex-shrink-0">{SPORT_EMOJI[game.sport] ?? "🏟"}</span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate">
              {game.awayTeam} <span className="text-muted-foreground font-normal">@</span> {game.homeTeam}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{fmtTime(game.gameTime)}</span>
              {game.numBets != null && (
                <span className="text-[10px] text-muted-foreground/60">{game.numBets.toLocaleString()} bets</span>
              )}
              {game.openingInserted && (
                <span className="text-[10px] text-muted-foreground/50">opened {fmtRelTime(game.openingInserted)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Movement summary chips */}
          {hasSteam && (
            <Badge className="text-[9px] px-1.5 py-0.5 bg-red-500/15 text-red-400 border-red-500/30 font-bold">🔥 STEAM</Badge>
          )}
          {!hasSteam && hasSignificant && (
            <Badge className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold">⚡ MOVED</Badge>
          )}
          {hasPublicData && (
            <Badge className="text-[9px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 border-indigo-500/20">$ DATA</Badge>
          )}
          {/* Research button — only for significant movement */}
          {hasResearchWorthy && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowResearch(!showResearch); }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors border ${
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
          {/* Quick spread/total summary */}
          <div className="text-right hidden sm:block">
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
              <p className="text-[10px] font-mono text-muted-foreground/70">
                O/U {game.total.current}
                {totalMove != null && totalMove !== 0 && (
                  <span className={`ml-1 text-[9px] font-bold ${Math.abs(totalMove) >= 3 ? "text-red-400" : "text-amber-400"}`}>
                    ({totalMove > 0 ? "+" : ""}{totalMove})
                  </span>
                )}
              </p>
            )}
          </div>
          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </div>

      {/* Research panel — shown when user clicks Why? */}
      {showResearch && (
        <ResearchPanel gameId={game.id} onClose={() => setShowResearch(false)} />
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Spread */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Spread ({game.awayTeam})</p>
              <MovementBar open={game.spread.open} current={game.spread.current} move={game.spread.move} label="Line" />
              <div className="space-y-1.5 mt-2">
                <PublicBar label={`${game.awayTeam} (away)`} publicPct={game.spread.awayPublic} moneyPct={game.spread.awayMoney} />
                <PublicBar label={`${game.homeTeam} (home)`} publicPct={game.spread.homePublic} moneyPct={game.spread.homeMoney} />
              </div>
            </div>

            {/* Total */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total (O/U)</p>
              <MovementBar open={game.total.open} current={game.total.current} move={game.total.move} label="Line" />
              <div className="space-y-1.5 mt-2">
                <PublicBar label="Over" publicPct={game.total.overPublic} moneyPct={game.total.overMoney} />
                <PublicBar label="Under" publicPct={game.total.underPublic} moneyPct={game.total.underMoney} />
              </div>
            </div>

            {/* Moneyline */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Moneyline</p>
              <div className="space-y-1">
                {/* Away ML */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-12 text-muted-foreground text-right font-medium truncate">{game.awayTeam.split(" ").pop()}</span>
                  <span className="font-mono text-muted-foreground/70">{fmtOdds(game.moneyline.awayOpen)}</span>
                  <span className="text-muted-foreground/40">→</span>
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
                  <span className="font-mono text-muted-foreground/70">{fmtOdds(game.moneyline.homeOpen)}</span>
                  <span className="text-muted-foreground/40">→</span>
                  <span className={`font-mono font-bold ${mlHomeMove !== 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmtOdds(game.moneyline.homeCurrent)}</span>
                  {mlHomeMove != null && mlHomeMove !== 0 && (
                    <span className="text-[10px] font-semibold" style={{ color: Math.abs(mlHomeMove) >= 50 ? "#f87171" : "#f59e0b" }}>
                      ({mlHomeMove > 0 ? "+" : ""}{mlHomeMove})
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 mt-2">
                <PublicBar label={game.awayTeam.split(" ").pop()!} publicPct={game.moneyline.awayPublic} moneyPct={game.moneyline.awayMoney} />
                <PublicBar label={game.homeTeam.split(" ").pop()!} publicPct={game.moneyline.homePublic} moneyPct={game.moneyline.homeMoney} />
              </div>
            </div>
          </div>

          {/* Footer metadata */}
          <div className="flex items-center gap-4 pt-2 border-t border-border/50 text-[10px] text-muted-foreground/60">
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
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-primary" />
            <h1 className="text-xl font-bold text-foreground">Line Movement</h1>
            {isFetching && <RefreshCw size={13} className="text-muted-foreground animate-spin" />}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Opening → current lines for today's games · spread, total & moneyline · public % + sharp money
            {lastUpdated && <span className="ml-2 text-muted-foreground/50">· updated {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CheatSheetButton initialSection="spread" label="How to Read" />
          {/* Trigger alert bell — page-level, always visible */}
          <button
            onClick={scrollToTriggers}
            title={triggerAlerts.size > 0 ? `${triggerAlerts.size} trigger alert${triggerAlerts.size !== 1 ? "s" : ""} active` : "Sharp trigger alerts"}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
            style={{
              background: triggerAlerts.size > 0 ? "rgba(250,204,21,0.12)" : "rgba(255,255,255,0.04)",
              border: triggerAlerts.size > 0 ? "1px solid rgba(250,204,21,0.45)" : "1px solid rgba(255,255,255,0.12)",
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
            Refresh
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
            <p className="text-2xl font-bold mt-0.5" style={{ color: steamCount > 0 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{steamCount}</p>
          </div>
          <div className="bg-card border border-amber-500/20 rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground">Lines Moved</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: movedCount > 0 ? "#f59e0b" : "rgba(255,255,255,0.3)" }}>{movedCount}</p>
          </div>
          <div
            className="bg-card border border-orange-500/30 rounded-xl px-4 py-3 cursor-pointer hover:bg-orange-500/5 transition-colors"
            onClick={() => setShowErrorsOnly(!showErrorsOnly)}
          >
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle size={10} className="text-orange-400" /> Book Errors
            </p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: (bookErrors as BookError[]).length > 0 ? "#fb923c" : "rgba(255,255,255,0.3)" }}>
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

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <Activity size={32} className="mx-auto text-muted-foreground/30 mb-3" />
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
                <span className="text-xs text-muted-foreground font-mono">{bySport[s].length} game{bySport[s].length !== 1 ? "s" : ""}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              {bySport[s].map(g => <GameCard key={g.id} game={g} />)}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex flex-wrap gap-4 pt-2 text-[10px] text-muted-foreground/60 border-t border-border">
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
