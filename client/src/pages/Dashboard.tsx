import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Link } from "wouter";
import { useState } from "react";
import {
  Trophy, Target, Flame, TrendingUp, Activity, Brain,
  ChevronRight, Zap, Star, Clock, CheckCircle, XCircle,
  BarChart2, Layers, Radio, DollarSign, Eye, ArrowUp,
  ArrowDown, Minus, Calendar, Shield, Percent,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  total: number; highConf: number; avgScore: number;
  threshold: number; bySport: Record<string, number>; bySource: Record<string, number>;
}
interface BtsPick {
  name: string; team: string; hitProbability: number;
  lockedAt?: string; result?: "hit" | "miss" | "pending"; snapshot?: any;
}
interface Bet {
  id?: string; title: string; sport: string; betType: string; confidenceScore: number;
  playerName?: string; homeTeam?: string; awayTeam?: string; gameTime?: string;
  description?: string; source?: string; statType?: string; line?: number;
  overOdds?: number; underOdds?: number; recommendation?: string;
}
interface PropItem {
  playerName: string; team: string; sport: string; statType: string; line: number;
  overOdds?: number; underOdds?: number; recommendation: "OVER" | "UNDER";
  edgeScore?: number; gameTime?: string; matchup?: string;
}
interface LineMove {
  homeTeam: string; awayTeam: string; sport: string; trigger: string;
  gameTime?: string; moveSize?: number; direction?: "up" | "down";
}
interface MlInsights {
  overall: { total_graded: number; win_rate: number; avg_score: number };
  by_sport: Record<string, { wins: number; losses: number; win_rate: number }>;
  by_bet_type?: Record<string, { wins: number; losses: number; win_rate: number }>;
}
interface Market {
  title: string; sport: string; yesPrice: number; noPrice: number;
  volume: number; category?: string; question?: string;
}
interface SharpSignal {
  homeTeam: string; awayTeam: string; sport: string;
  publicPct?: number; sharpPct?: number; side?: string; gameTime?: string;
}
interface Game {
  homeTeam: string; awayTeam: string; homeScore: number; awayScore: number;
  status: string; sport: string; period?: string; gameTime?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPORTS = ["MLB", "NBA", "NFL", "NHL"] as const;
type Sport = typeof SPORTS[number];

const SPORT_EMOJI: Record<string, string> = {
  MLB: "⚾", NBA: "🏀", NFL: "🏈", NHL: "🏒", Soccer: "⚽", MLS: "⚽", NCAAF: "🏈", NCAAB: "🏀",
};
const se = (s: string) => SPORT_EMOJI[s?.toUpperCase()] ?? "🏅";

const fmtVol = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}K` : `$${v}`;

const scoreColor = (n: number) => n >= 85 ? "#22c55e" : n >= 70 ? "#D4A843" : "#94a3b8";
const scoreBg    = (n: number) => n >= 85 ? "rgba(34,197,94,0.12)" : n >= 70 ? "rgba(212,168,67,0.12)" : "rgba(148,163,184,0.10)";

const fmtDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const fmtTime = (s?: string) => {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const fmtOdds = (n?: number) => (!n ? "" : n > 0 ? `+${n}` : `${n}`);

// ─── Sport Tabs ───────────────────────────────────────────────────────────────

function SportTabs({ active, onChange }: { active: Sport; onChange: (s: Sport) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
      {SPORTS.map(s => (
        <button key={s} onClick={() => onChange(s)} style={{
          flex: 1, padding: "5px 4px", borderRadius: 9, border: "none", cursor: "pointer",
          background: active === s ? "#13233A" : "rgba(19,35,58,0.06)",
          color: active === s ? "#F6F1E7" : "#64748b",
          fontSize: 11, fontWeight: 700, transition: "all .15s",
        }}>
          {se(s)} {s}
        </button>
      ))}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, linkTo, linkLabel = "View All →", badge }: {
  icon: React.ReactNode; label: string; linkTo: string; linkLabel?: string; badge?: string | number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon}
        <span style={{ fontWeight: 700, fontSize: 13, color: "#131A24" }}>{label}</span>
        {badge !== undefined && (
          <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(19,35,58,0.08)", color: "#64748b", borderRadius: 20, padding: "1px 7px" }}>
            {badge}
          </span>
        )}
      </div>
      <Link href={linkTo}>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500, cursor: "pointer" }}>{linkLabel}</span>
      </Link>
    </div>
  );
}

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: "#fff", borderRadius: 18, padding: "14px 14px", border: "1px solid rgba(19,35,58,0.07)", ...style }}>
    {children}
  </div>
);

const Pill = ({ label, color, bg }: { label: string; color: string; bg: string }) => (
  <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, borderRadius: 20, padding: "2px 8px", letterSpacing: 0.3, textTransform: "uppercase" as const }}>
    {label}
  </span>
);

const EmptyState = ({ text }: { text: string }) => (
  <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "10px 0" }}>{text}</p>
);

const Skel = () => (
  <div style={{ height: 13, background: "rgba(19,35,58,0.06)", borderRadius: 6, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
);

function ProLock({ section }: { section: string }) {
  return (
    <div style={{
      position: "absolute", inset: 0, backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)",
      background: "rgba(246,241,231,0.75)", borderRadius: 18,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, zIndex: 10,
    }}>
      <Star size={18} style={{ color: "#D4A843" }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: "#13233A" }}>Pro Feature</span>
      <span style={{ fontSize: 11, color: "#64748b", textAlign: "center", maxWidth: 160 }}>{section} requires Pro.</span>
      <Link href="/pricing">
        <span style={{ fontSize: 11, background: "#D4A843", color: "#131A24", padding: "4px 12px", borderRadius: 20, fontWeight: 700, cursor: "pointer", marginTop: 4, display: "block" }}>
          Upgrade →
        </span>
      </Link>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isPro, isOwner, isBasic } = useAuth();
  const canSeePro   = isPro || isOwner;
  const canSeeBasic = isBasic || isPro || isOwner;

  // Global sport selector — MLB default
  const [activeSport, setActiveSport] = useState<Sport>("MLB");

  // ── Fetches ──────────────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsL } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    queryFn: () => apiRequest("GET", "/api/stats").then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: btsData, isLoading: btsL } = useQuery<{ picks: BtsPick[] }>({
    queryKey: ["/api/bts-picks"],
    queryFn: () => apiRequest("GET", "/api/bts-picks").then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: btsHistory } = useQuery<any>({
    queryKey: ["/api/bts-history"],
    queryFn: () => apiRequest("GET", "/api/bts-history").then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: topPlays, isLoading: playsL } = useQuery<Bet[]>({
    queryKey: ["/api/bets/high-confidence"],
    queryFn: () => apiRequest("GET", "/api/bets/high-confidence").then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: allBets, isLoading: betsL } = useQuery<Bet[]>({
    queryKey: ["/api/bets"],
    queryFn: () => apiRequest("GET", "/api/bets").then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: propsData, isLoading: propsL } = useQuery<any>({
    queryKey: ["/api/linemate-props"],
    queryFn: () => apiRequest("GET", "/api/linemate-props").then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: lineMoves, isLoading: lineL } = useQuery<LineMove[]>({
    queryKey: ["/api/line-movement"],
    queryFn: () => apiRequest("GET", "/api/line-movement").then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: mlInsights, isLoading: mlL } = useQuery<MlInsights>({
    queryKey: ["/api/ml-insights"],
    queryFn: () => apiRequest("GET", "/api/ml-insights").then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: markets, isLoading: marketsL } = useQuery<Market[]>({
    queryKey: ["/api/prediction-markets"],
    queryFn: () => apiRequest("GET", "/api/prediction-markets").then(r => r.json()),
    refetchInterval: 30000,
  });
  const { data: sharpData } = useQuery<any>({
    queryKey: ["/api/sharp-money"],
    queryFn: () => apiRequest("GET", "/api/sharp-money").then(r => r.json()),
    refetchInterval: 60000,
  });
  const { data: liveData } = useQuery<any>({
    queryKey: ["/api/live-scores"],
    queryFn: () => apiRequest("GET", "/api/live-scores").then(r => r.json()),
    refetchInterval: 20000,
  });

  // ── Normalize helpers ─────────────────────────────────────────────────────────
  function normGame(g: any) {
    const home = Array.isArray(g.teams) ? g.teams.find((t: any) => t.homeAway === "home") : null;
    const away = Array.isArray(g.teams) ? g.teams.find((t: any) => t.homeAway === "away") : null;
    return {
      sport: g.sport ?? "",
      homeTeam: home?.shortName ?? g.homeTeam ?? "",
      awayTeam: away?.shortName ?? g.awayTeam ?? "",
      homeScore: Number(home?.score ?? g.homeScore ?? 0),
      awayScore: Number(away?.score ?? g.awayScore ?? 0),
      status: g.status?.state === "in" ? "in_progress" : g.status?.completed ? "final" : "scheduled",
      period: g.status?.period ? `Q${g.status.period}` : g.period ?? "",
      gameTime: g.date ?? g.gameTime,
    };
  }

  // Sport filter helper
  const matchSport = (s: string) => s?.toUpperCase() === activeSport;

  // ── Raw data ──────────────────────────────────────────────────────────────────
  const allBetsSafe = Array.isArray(allBets) ? allBets : [];
  const btsPicks    = Array.isArray(btsData?.picks) ? btsData!.picks : [];

  // Raw linemate props — normalize fields
  const allPropsRaw = Array.isArray((propsData as any)?.markets)
    ? (propsData as any).markets
    : Array.isArray((propsData as any)?.props) ? (propsData as any).props : [];
  const allProps: PropItem[] = allPropsRaw.map((p: any) => ({
    playerName:     p.playerName ?? p.player ?? "",
    team:           p.team ?? p.teamCode ?? "",
    sport:          p.sport ?? "",
    statType:       p.statType ?? p.marketName ?? "",
    line:           p.line ?? p.consensusLine ?? 0,
    overOdds:       p.overOdds ?? null,
    underOdds:      p.underOdds ?? null,
    recommendation: (p.recommendation ?? p.outcome ?? "OVER") as "OVER" | "UNDER",
    edgeScore:      p.edgeScore ?? p.bestHitRate ?? null,
    gameTime:       p.gameTime ?? null,
    matchup:        p.matchup ?? (p.opponent ? `vs ${p.opponent}` : ""),
  }));

  // Line movement — normalize real API shape
  const allLineMoves = (Array.isArray(lineMoves) ? lineMoves : []).map((m: any) => {
    const spreadMove  = m.spread?.move ?? 0;
    const totalMove   = m.total?.move  ?? 0;
    const mlAway      = m.moneyline?.awayCurrent;
    const mlHome      = m.moneyline?.homeCurrent;
    const biggestMove = Math.abs(spreadMove) >= Math.abs(totalMove) ? spreadMove : totalMove;
    const trigger = m.trigger ? m.trigger
      : Math.abs(spreadMove) > 0 ? `Spread moved ${spreadMove > 0 ? "+" : ""}${spreadMove}`
      : Math.abs(totalMove) > 0  ? `Total moved ${totalMove > 0 ? "+" : ""}${totalMove}`
      : mlAway != null ? `ML: Away ${mlAway > 0 ? "+" : ""}${mlAway} / Home ${mlHome}`
      : "Line movement detected";
    const direction = m.direction ? m.direction
      : biggestMove > 0 ? "up" : biggestMove < 0 ? "down" : undefined;
    return { ...m, trigger, direction } as LineMove;
  });

  // Sharp signals — normalize
  const sharpSignalsRaw = Array.isArray(sharpData) ? sharpData : (sharpData as any)?.games ?? [];
  const allSharpSignals = sharpSignalsRaw.map((g: any) => {
    const rawPublic = g.publicBetPct ?? g.publicPct;
    const publicPct = typeof rawPublic === "number" ? rawPublic
      : typeof rawPublic === "object" && rawPublic !== null
        ? (rawPublic.away ?? rawPublic.home ?? rawPublic.over ?? rawPublic.under ?? null)
        : null;
    const sharpPct = typeof g.sharpScore === "number" ? g.sharpScore
      : typeof g.sharpPct === "number" ? g.sharpPct : null;
    return {
      homeTeam: g.homeTeam, awayTeam: g.awayTeam, sport: g.sport,
      publicPct, sharpPct,
      side: g.sharpDirection ?? g.sharpSide ?? g.side ?? null,
      gameTime: g.startTime ?? g.gameTime,
    } as SharpSignal;
  });

  // Markets — normalize volume
  const allMarkets = (Array.isArray(markets) ? markets : []).map((m: any) => ({
    ...m,
    volume: typeof m.volume === "number" ? m.volume : typeof m.vol24h === "number" ? m.vol24h : 0,
  }));

  // Live games
  const liveGamesArr: Game[] = (() => {
    const raw = liveData as any;
    if (!raw) return [];
    if (Array.isArray(raw.games)) return raw.games;
    if (raw.sports && typeof raw.sports === "object") return Object.values(raw.sports).flat() as Game[];
    return [];
  })();
  const liveGamesNorm = liveGamesArr.map(normGame);
  const liveGames  = liveGamesNorm.filter(g => g.status === "in_progress");
  const todayGames = liveGamesNorm.filter(g => g.status !== "final");

  // ── Sport-filtered data ────────────────────────────────────────────────────────
  const teamBets      = allBetsSafe.filter(b => b.betType !== "player_prop" && b.betType !== "season_prop" && b.betType !== "futures");
  const playerProps   = allBetsSafe.filter(b => b.betType === "player_prop");

  // Apply sport filter to each section
  const filteredTopPlays    = (Array.isArray(topPlays) ? topPlays : [])
    .filter(b => matchSport(b.sport))
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 6);

  const filteredTeamBets    = teamBets
    .filter(b => matchSport(b.sport))
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 5);

  const filteredPlayerProps = playerProps
    .filter(b => matchSport(b.sport))
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 6);

  const filteredPropsHub    = allProps
    .filter(p => matchSport(p.sport))
    .slice(0, 6);

  const filteredLineMoves   = allLineMoves
    .filter(m => matchSport(m.sport))
    .slice(0, 4);

  const filteredSharp       = allSharpSignals
    .filter((s: SharpSignal) => matchSport(s.sport))
    .slice(0, 3);

  const filteredMarkets     = allMarkets
    .filter((m: any) => !m.sport || matchSport(m.sport) || m.sport === "Other")
    .slice(0, 4);

  const filteredLiveSport   = liveGames.filter(g => matchSport(g.sport));
  const filteredTodaySport  = todayGames.filter(g => matchSport(g.sport));

  // BTS is MLB-only — always show regardless of sport tab
  const topBts = btsPicks.slice(0, 5);

  // Stats
  const sportsActive = stats ? Object.keys(stats.bySport).filter(k => stats.bySport[k] > 0) : [];

  // ML sport breakdown filtered
  const topMlSports = mlInsights?.by_sport
    ? Object.entries(mlInsights.by_sport).sort((a, b) => b[1].win_rate - a[1].win_rate).slice(0, 4)
    : [];
  const mlBetTypeBreakdown = mlInsights?.by_bet_type
    ? Object.entries(mlInsights.by_bet_type).sort((a, b) => b[1].win_rate - a[1].win_rate).slice(0, 3)
    : [];

  // BTS history
  const btsHistoryRaw = btsHistory as any;
  const btsSeasonRec  = btsHistoryRaw?.seasonRecord ?? {};
  const btsTotalHits  = btsSeasonRec.wins ?? 0;
  const btsTotalPicks = (btsSeasonRec.wins ?? 0) + (btsSeasonRec.losses ?? 0);
  const btsWinRate    = Number(btsSeasonRec.winPct ?? 0);   // already 0–100
  const btsStreak     = btsHistoryRaw?.yesterdayRecord?.wins ?? 0;
  const btsRecentDays = Array.isArray(btsHistoryRaw?.days) ? btsHistoryRaw.days.slice(-7) : [];
  const btsRecent     = btsRecentDays.map((d: any) => ({
    date: d.date,
    result: d.winPct >= 50 ? "hit" : "miss" as "hit" | "miss" | "push",
  }));

  // Stat cards (global, no sport filter)
  const statCards = [
    { label: "Total Picks", value: statsL ? "—" : String(stats?.total ?? 0),           icon: <Layers size={15} style={{ color: "#3b82f6" }} />,   color: "#3b82f6", bg: "rgba(59,130,246,0.09)"  },
    { label: "High Conf",   value: statsL ? "—" : String(stats?.highConf ?? 0),         icon: <Zap size={15} style={{ color: "#D4A843" }} />,      color: "#D4A843", bg: "rgba(212,168,67,0.10)" },
    { label: "Avg Score",   value: statsL ? "—" : `${(stats?.avgScore ?? 0).toFixed(1)}`,icon: <BarChart2 size={15} style={{ color: "#22c55e" }} />, color: "#22c55e", bg: "rgba(34,197,94,0.09)" },
    { label: "Sports",      value: statsL ? "—" : String(sportsActive.length),          icon: <Activity size={15} style={{ color: "#a855f7" }} />, color: "#a855f7", bg: "rgba(168,85,247,0.09)" },
    { label: "Props",       value: statsL ? "—" : String(playerProps.length),           icon: <Target size={15} style={{ color: "#ef4444" }} />,   color: "#ef4444", bg: "rgba(239,68,68,0.09)"  },
    { label: "Team Bets",   value: betsL ? "—" : String(teamBets.length),               icon: <Shield size={15} style={{ color: "#06b6d4" }} />,   color: "#06b6d4", bg: "rgba(6,182,212,0.09)"  },
  ];

  return (
    <div style={{ background: "#F6F1E7", minHeight: "100vh", paddingBottom: 80, maxWidth: 520, margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#131A24", overflowX: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
        @keyframes dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: "22px 16px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginBottom: 1 }}>{fmtDate()}</p>
            <h1 style={{ fontSize: 23, fontWeight: 900, color: "#131A24", lineHeight: 1.15, margin: "0 0 3px" }}>Clubhouse IQ</h1>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Your daily edge across all markets</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.22)", borderRadius: 20, padding: "5px 10px" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "dot 1.4s ease-in-out infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#16a34a" }}>Live</span>
            </div>
            {liveGames.length > 0 && (
              <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>{liveGames.length} live</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats Row ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, padding: "14px 16px 0", overflowX: "auto" }}>
        {statCards.map(card => (
          <div key={card.label} style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.07)", borderRadius: 14, padding: "11px 13px", minWidth: 80, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ width: 26, height: 26, background: card.bg, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>{card.icon}</div>
            <span style={{ fontSize: 20, fontWeight: 900, color: "#131A24", lineHeight: 1 }}>{card.value}</span>
            <span style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}>{card.label}</span>
          </div>
        ))}
      </div>

      {/* ── Live Games (active sport) ────────────────────────────────────────── */}
      {filteredLiveSport.length > 0 && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "dot 1s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>LIVE NOW</span>
            <Radio size={11} style={{ color: "#ef4444" }} />
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {filteredLiveSport.map((g, i) => (
              <Link href="/scores" key={i}>
                <div style={{ flex: "0 0 auto", background: "#fff", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 14, padding: "8px 12px", cursor: "pointer" }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginBottom: 3 }}>{se(g.sport)} {g.period ? `· ${g.period}` : ""}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#131A24", whiteSpace: "nowrap" }}>
                    {g.awayTeam} <span style={{ color: "#ef4444" }}>{g.awayScore}</span>
                    <span style={{ color: "#94a3b8", margin: "0 4px" }}>–</span>
                    {g.homeTeam} <span style={{ color: "#ef4444" }}>{g.homeScore}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Sections ────────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ── Top Plays ──────────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Flame size={14} style={{ color: "#ef4444" }} />} label="Top Plays Today" linkTo="/conviction" badge={filteredTopPlays.length} />
          <SportTabs active={activeSport} onChange={setActiveSport} />
          {playsL ? (<><Skel /><Skel /><Skel /></>) : filteredTopPlays.length === 0 ? (
            <EmptyState text={`No high-confidence ${activeSport} plays right now`} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredTopPlays.map((bet, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(19,35,58,0.025)", borderRadius: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 17 }}>{se(bet.sport)}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 165 }}>
                        {bet.playerName || bet.title}
                      </p>
                      <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                        <Pill label={bet.betType?.replace(/_/g, " ") ?? "bet"} color="#64748b" bg="rgba(19,35,58,0.06)" />
                        {bet.gameTime && <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtTime(bet.gameTime)}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: scoreBg(bet.confidenceScore), border: `2px solid ${scoreColor(bet.confidenceScore)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: scoreColor(bet.confidenceScore) }}>{bet.confidenceScore?.toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Team Bets ──────────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Shield size={14} style={{ color: "#06b6d4" }} />} label="Team Bets" linkTo="/bets" badge={filteredTeamBets.length} />
          <SportTabs active={activeSport} onChange={setActiveSport} />
          {betsL ? (<><Skel /><Skel /></>) : filteredTeamBets.length === 0 ? (
            <EmptyState text={`No ${activeSport} team bets available`} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredTeamBets.map((b, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "rgba(6,182,212,0.04)", borderRadius: 11, border: "1px solid rgba(6,182,212,0.10)" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 185 }}>{b.title}</p>
                    <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
                      <Pill label={b.betType?.replace(/_/g, " ") ?? ""} color="#06b6d4" bg="rgba(6,182,212,0.10)" />
                      {b.gameTime && <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtTime(b.gameTime)}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 900, color: scoreColor(b.confidenceScore), flexShrink: 0, marginLeft: 8 }}>{b.confidenceScore?.toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Player Props ───────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Target size={14} style={{ color: "#22c55e" }} />} label="Player Props" linkTo="/linemate" badge={filteredPlayerProps.length} />
          <SportTabs active={activeSport} onChange={setActiveSport} />
          {betsL ? (<><Skel /><Skel /><Skel /></>) : filteredPlayerProps.length === 0 ? (
            <EmptyState text={`No ${activeSport} player props right now`} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredPlayerProps.map((b, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "rgba(19,35,58,0.025)", borderRadius: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 16 }}>{se(b.sport)}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{b.playerName || b.title}</p>
                      <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                        {(() => {
                          const stat = b.statType || (b as any).teamStats?.statType || "";
                          const dir  = b.recommendation || (b as any).teamStats?.pickSide || "";
                          const line = b.line ?? (b as any).teamStats?.statValue ?? null;
                          if (stat) return <Pill label={`${stat}${dir ? ` ${dir[0]}` : ""}${line != null ? ` ${line}` : ""}`} color="#22c55e" bg="rgba(34,197,94,0.10)" />;
                          if (line != null) return <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{line}</span>;
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    {b.overOdds && <span style={{ fontSize: 10, color: "#64748b" }}>{fmtOdds(b.overOdds)}</span>}
                    <span style={{ fontSize: 12, fontWeight: 900, color: scoreColor(b.confidenceScore) }}>{b.confidenceScore?.toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Beat The Streak (MLB only — always shown) ─────────────────────── */}
        <Card>
          <SectionHeader icon={<Trophy size={14} style={{ color: "#D4A843" }} />} label="Beat The Streak" linkTo="/bts" linkLabel="View Full →" badge={`${btsPicks.length}/10`} />

          {(btsTotalPicks > 0 || btsStreak > 0) && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[
                { label: "Streak",   value: btsStreak > 0 ? `🔥 ${btsStreak}` : `${btsStreak}`, color: btsStreak > 2 ? "#D4A843" : "#131A24" },
                { label: "Win Rate", value: `${btsWinRate.toFixed(0)}%`,                          color: btsWinRate >= 60 ? "#22c55e" : "#64748b" },
                { label: "Record",   value: `${btsTotalHits}/${btsTotalPicks}`,                   color: "#131A24" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: "rgba(212,168,67,0.07)", border: "1px solid rgba(212,168,67,0.15)", borderRadius: 10, padding: "7px 8px", textAlign: "center" }}>
                  <p style={{ fontSize: 14, fontWeight: 900, color: s.color, margin: 0 }}>{s.value}</p>
                  <p style={{ fontSize: 10, color: "#94a3b8", margin: "2px 0 0" }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {btsRecent.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginBottom: 10, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginRight: 2 }}>Recent:</span>
              {btsRecent.slice(-7).map((r: any, i: number) => (
                <div key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: r.result === "hit" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)", border: `1.5px solid ${r.result === "hit" ? "#22c55e" : "#ef4444"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {r.result === "hit" ? <CheckCircle size={11} style={{ color: "#22c55e" }} /> : <XCircle size={11} style={{ color: "#ef4444" }} />}
                </div>
              ))}
            </div>
          )}

          {btsL ? (<><Skel /><Skel /></>) : topBts.length === 0 ? (
            <EmptyState text="No picks generated yet today" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {topBts.map((pick, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(212,168,67,0.06)", border: "1px solid rgba(212,168,67,0.14)", borderRadius: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 16 }}>⚾</span>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0 }}>{pick.name}</p>
                      <p style={{ fontSize: 10, color: "#94a3b8", margin: "1px 0 0" }}>{pick.team}</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 13, fontWeight: 900, color: pick.hitProbability >= 70 ? "#22c55e" : pick.hitProbability >= 50 ? "#D4A843" : "#94a3b8", margin: 0 }}>
                        {Math.round(pick.hitProbability)}%
                      </p>
                      <p style={{ fontSize: 9, color: "#94a3b8", margin: 0 }}>hit prob</p>
                    </div>
                    {pick.result === "hit"    && <CheckCircle size={15} style={{ color: "#22c55e" }} />}
                    {pick.result === "miss"   && <XCircle size={15} style={{ color: "#ef4444" }} />}
                    {(!pick.result || pick.result === "pending") && <Clock size={14} style={{ color: "#94a3b8" }} />}
                  </div>
                </div>
              ))}
              {btsPicks.length > 5 && (
                <Link href="/bts">
                  <p style={{ fontSize: 11, color: "#D4A843", fontWeight: 700, textAlign: "center", margin: "4px 0 0", cursor: "pointer" }}>
                    +{btsPicks.length - 5} more picks →
                  </p>
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* ── Line Movement ──────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<TrendingUp size={14} style={{ color: "#3b82f6" }} />} label="Line Movement" linkTo="/clv" badge={filteredLineMoves.length} />
          <SportTabs active={activeSport} onChange={setActiveSport} />
          {lineL ? (<><Skel /><Skel /></>) : filteredLineMoves.length === 0 ? (
            <EmptyState text={`No ${activeSport} line moves detected`} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredLineMoves.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.10)", borderRadius: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                      {m.awayTeam} @ {m.homeTeam}
                    </p>
                    <p style={{ fontSize: 10, color: "#64748b", margin: "2px 0 0" }}>{m.trigger}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    {m.direction === "up" ? <ArrowUp size={13} style={{ color: "#22c55e" }} /> : m.direction === "down" ? <ArrowDown size={13} style={{ color: "#ef4444" }} /> : <Minus size={13} style={{ color: "#94a3b8" }} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Sharp Money ────────────────────────────────────────────────────── */}
        {(filteredSharp.length > 0 || allSharpSignals.length > 0) && (
          <Card>
            <SectionHeader icon={<DollarSign size={14} style={{ color: "#22c55e" }} />} label="Sharp Money" linkTo="/clv" linkLabel="View →" />
            <SportTabs active={activeSport} onChange={setActiveSport} />
            {filteredSharp.length === 0 ? (
              <EmptyState text={`No ${activeSport} sharp signals`} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {filteredSharp.map((s: SharpSignal, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.10)", borderRadius: 11 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 175 }}>{s.awayTeam} @ {s.homeTeam}</p>
                      {s.side && <p style={{ fontSize: 10, color: "#22c55e", fontWeight: 700, margin: "1px 0 0" }}>Sharp: {s.side}</p>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                      {s.sharpPct != null && <span style={{ fontSize: 12, fontWeight: 900, color: "#22c55e" }}>{s.sharpPct}%</span>}
                      {s.publicPct != null && <span style={{ fontSize: 10, color: "#94a3b8" }}>Public {s.publicPct}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── ML Intel ───────────────────────────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          <Card>
            <SectionHeader icon={<Brain size={14} style={{ color: "#a855f7" }} />} label="ML Intel" linkTo="/ml-insights" linkLabel="View →" />
            {mlL ? (<><Skel /><Skel /></>) : !mlInsights?.overall ? (
              <EmptyState text="ML model is still learning" />
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {[
                    { label: "Win Rate", value: `${(mlInsights.overall.win_rate * 100).toFixed(1)}%`, color: "#a855f7" },
                    { label: "Graded",   value: String(mlInsights.overall.total_graded),               color: "#131A24" },
                    { label: "Avg Score",value: (mlInsights.overall.avg_score ?? 0).toFixed(1),        color: "#D4A843" },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)", borderRadius: 10, padding: "7px 8px", textAlign: "center" }}>
                      <p style={{ fontSize: 16, fontWeight: 900, color: s.color, margin: 0 }}>{s.value}</p>
                      <p style={{ fontSize: 10, color: "#94a3b8", margin: "2px 0 0" }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                {topMlSports.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>By Sport</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {topMlSports.map(([sport, d]) => (
                        <div key={sport} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(19,35,58,0.025)", borderRadius: 9 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 14 }}>{se(sport)}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#131A24" }}>{sport}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "#64748b" }}>{d.wins}W–{d.losses}L</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: "#a855f7" }}>{(d.win_rate * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {mlBetTypeBreakdown.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, margin: "10px 0 6px", textTransform: "uppercase", letterSpacing: 0.5 }}>By Bet Type</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {mlBetTypeBreakdown.map(([type, d]) => (
                        <div key={type} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(19,35,58,0.025)", borderRadius: 9 }}>
                          <Pill label={type.replace(/_/g, " ")} color="#64748b" bg="rgba(19,35,58,0.07)" />
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: "#64748b" }}>{d.wins}W–{d.losses}L</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: "#a855f7" }}>{(d.win_rate * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
          {!canSeePro && <ProLock section="ML Intel" />}
        </div>

        {/* ── Prediction Markets ─────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Activity size={14} style={{ color: "#3b82f6" }} />} label="Prediction Markets" linkTo="/markets" badge={filteredMarkets.length} />
          {marketsL ? (<><Skel /><Skel /></>) : filteredMarkets.length === 0 ? (
            <EmptyState text="No active markets" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredMarkets.map((m: any, i: number) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(19,35,58,0.025)", borderRadius: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 175 }}>{m.question || m.title}</p>
                    <p style={{ fontSize: 10, color: "#64748b", margin: "2px 0 0" }}>Vol: {fmtVol(m.volume)} · {m.sport || m.category || "Other"}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: "#22c55e" }}>{Math.round(m.yesPrice * 100)}¢</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>YES</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Sport Breakdown ────────────────────────────────────────────────── */}
        {!statsL && sportsActive.length > 0 && (
          <Card>
            <SectionHeader icon={<Eye size={14} style={{ color: "#64748b" }} />} label="Sport Breakdown" linkTo="/bets" linkLabel="All Picks →" />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sportsActive.map(sport => {
                const count    = stats!.bySport[sport] ?? 0;
                const maxCount = Math.max(...sportsActive.map(s => stats!.bySport[s] ?? 0));
                const pct      = maxCount > 0 ? (count / maxCount) * 100 : 0;
                const isActive = sport.toUpperCase() === activeSport;
                return (
                  <div key={sport} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{se(sport)}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "#131A24" : "#64748b", width: 40 }}>{sport}</span>
                    <div style={{ flex: 1, height: 6, background: "rgba(19,35,58,0.07)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: isActive ? "#D4A843" : "#13233A", borderRadius: 99, transition: "width .4s ease" }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", width: 24, textAlign: "right" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ── Today's Schedule ───────────────────────────────────────────────── */}
        {filteredTodaySport.length > 0 && (
          <Card>
            <SectionHeader icon={<Calendar size={14} style={{ color: "#64748b" }} />} label={`${activeSport} Schedule`} linkTo="/scores" linkLabel="Scores →" />
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              {filteredTodaySport.slice(0, 8).map((g, i) => (
                <div key={i} style={{ flex: "0 0 auto", background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.08)", borderRadius: 12, padding: "8px 11px", minWidth: 110 }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
                    {g.status === "in_progress" ? <span style={{ color: "#ef4444", fontWeight: 700 }}>LIVE</span> : fmtTime(g.gameTime)}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#131A24" }}>{g.awayTeam}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", margin: "1px 0" }}>vs</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#131A24" }}>{g.homeTeam}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── Quick Nav Grid ─────────────────────────────────────────────────── */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Quick Nav</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { href: "/linemate",    icon: <Target size={17} style={{ color: "#22c55e" }} />,     label: "Props Hub",       desc: "Player props & edges",    border: "rgba(34,197,94,0.18)",  bg: "rgba(34,197,94,0.10)" },
              { href: "/bts",         icon: <Trophy size={17} style={{ color: "#D4A843" }} />,     label: "Beat the Streak", desc: "Daily BTS picks",         border: "rgba(212,168,67,0.22)", bg: "rgba(212,168,67,0.12)" },
              { href: "/conviction",  icon: <Flame size={17} style={{ color: "#ef4444" }} />,      label: "Top Plays",       desc: "High-conviction picks",   border: "rgba(239,68,68,0.18)",  bg: "rgba(239,68,68,0.10)" },
              { href: "/clv",         icon: <TrendingUp size={17} style={{ color: "#3b82f6" }} />, label: "Line Movement",   desc: "CLV & sharp action",      border: "rgba(59,130,246,0.18)", bg: "rgba(59,130,246,0.10)" },
              { href: "/markets",     icon: <Activity size={17} style={{ color: "#06b6d4" }} />,   label: "Markets",         desc: "Prediction markets",      border: "rgba(6,182,212,0.18)",  bg: "rgba(6,182,212,0.10)" },
              { href: "/ml-insights", icon: <Brain size={17} style={{ color: "#a855f7" }} />,      label: "ML Intel",        desc: "Model accuracy & trends", border: "rgba(168,85,247,0.18)", bg: "rgba(168,85,247,0.10)" },
            ].map(nav => (
              <Link href={nav.href} key={nav.href}>
                <div style={{ background: "#fff", border: `1px solid ${nav.border}`, borderRadius: 18, padding: "15px 13px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", position: "relative", overflow: "hidden" }}>
                  <div style={{ width: 34, height: 34, background: nav.bg, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>{nav.icon}</div>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 800, color: "#131A24", margin: 0 }}>{nav.label}</p>
                    <p style={{ fontSize: 10, color: "#64748b", margin: "2px 0 0" }}>{nav.desc}</p>
                  </div>
                  <ChevronRight size={13} style={{ color: "#94a3b8", position: "absolute", top: 15, right: 13 }} />
                </div>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
