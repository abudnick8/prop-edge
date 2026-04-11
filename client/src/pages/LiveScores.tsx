import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import React, { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, RefreshCw, Clock, Tv2, MapPin, ChevronRight, TrendingUp, Loader2, DollarSign, Users } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TeamScore {
  id: string;
  abbr: string;
  displayName: string;
  shortName: string;
  logo: string | null;
  color: string | null;
  score: string;
  homeAway: "home" | "away";
  linescores: { period: number; value: string }[];
  records: string[];
}

interface Athlete {
  id?: string;
  name?: string;
  headshot?: string | null;
  position?: string | null;
  teamId?: string | null;
}

interface Leader {
  category: string;
  displayValue: string;
  athlete: Athlete;
}

interface Situation {
  lastPlay: string | null;
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  pitcher?: { name: string; summary: string; headshot: string | null } | null;
  batter?: { name: string; summary: string; headshot: string | null } | null;
}

interface GameStatus {
  state: "pre" | "in" | "post";
  description: string;
  detail: string;
  shortDetail: string;
  period: number;
  clock: string;
  completed: boolean;
}

interface LiveGame {
  id: string;
  uid: string;
  sport: "NBA" | "MLB" | "NHL" | "NFL";
  name: string;
  shortName: string;
  date: string;
  status: GameStatus;
  venue: { name: string; city?: string } | null;
  teams: TeamScore[];
  situation: Situation | null;
  leaders: Leader[];
  broadcasts: string[];
}

interface LiveScoresResponse {
  sports: { nba?: LiveGame[]; mlb?: LiveGame[]; nhl?: LiveGame[]; nfl?: LiveGame[] };
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SPORT_META: Record<string, { label: string; emoji: string; color: string; bg: string; periods: string[] }> = {
  NBA: { label: "NBA",  emoji: "🏀", color: "#fb923c", bg: "#fb923c18", periods: ["Q1","Q2","Q3","Q4","OT"] },
  MLB: { label: "MLB",  emoji: "⚾", color: "#60a5fa", bg: "#60a5fa18", periods: ["1","2","3","4","5","6","7","8","9"] },
  NHL: { label: "NHL",  emoji: "🏒", color: "#22d3ee", bg: "#22d3ee18", periods: ["1st","2nd","3rd","OT","SO"] },
  NFL: { label: "NFL",  emoji: "🏈", color: "#f87171", bg: "#f8717118", periods: ["Q1","Q2","Q3","Q4","OT"] },
};

function toCentralTime(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
    }) + " CT";
  } catch {
    return "";
  }
}

function stateLabel(status: GameStatus, date: string): { text: string; live: boolean; color: string } {
  if (status.state === "in") return { text: status.shortDetail || status.detail || "LIVE", live: true, color: "#22c55e" };
  if (status.state === "post") return { text: "Final", live: false, color: "#94a3b8" };
  // Pre-game — show start time in Central Time
  const t = toCentralTime(date);
  return { text: t || status.description, live: false, color: "#64748b" };
}

function BaseballDiamond({ sit }: { sit: Situation }) {
  const base = (active: boolean) => active ? "#f59e0b" : "#13233A22";
  const stroke = (active: boolean) => active ? "#f59e0b" : "#3D4B5844";
  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      {/* 2nd base (top) */}
      <rect x="19" y="3"  width="14" height="14" rx="2" fill={base(sit.onSecond)} stroke={stroke(sit.onSecond)} strokeWidth="1.5" transform="rotate(45 26 10)" />
      {/* 1st base (right) */}
      <rect x="33" y="19" width="14" height="14" rx="2" fill={base(sit.onFirst)}  stroke={stroke(sit.onFirst)}  strokeWidth="1.5" transform="rotate(45 40 26)" />
      {/* 3rd base (left) */}
      <rect x="5"  y="19" width="14" height="14" rx="2" fill={base(sit.onThird)}  stroke={stroke(sit.onThird)}  strokeWidth="1.5" transform="rotate(45 12 26)" />
      {/* Home plate */}
      <polygon points="26,42 21,37 26,32 31,37" fill="#13233A44" stroke="#3D4B58" strokeWidth="1.2" />
    </svg>
  );
}

function OutDots({ outs }: { outs: number }) {
  return (
    <div className="flex gap-1">
      {[0, 1, 2].map(i => (
        <div key={i} className={`w-2.5 h-2.5 rounded-full border ${i < outs ? "bg-amber-400 border-amber-400" : "border-[#3D4B58]"}`} />
      ))}
    </div>
  );
}

function CountBar({ label, val, max }: { label: string; val: number; max: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-[#3D4B58] uppercase tracking-wider font-bold">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} className={`w-2 h-2 rounded-full ${i < val ? "bg-green-400" : "border border-[#3D4B58]"}`} />
        ))}
      </div>
    </div>
  );
}

// ── Linescore table ───────────────────────────────────────────────────────────
function LinescoreTable({ teams, sport }: { teams: TeamScore[]; sport: string }) {
  const meta = SPORT_META[sport];
  const maxPeriods = Math.max(...teams.map(t => t.linescores.length), sport === "MLB" ? 9 : 4);
  const periods = Array.from({ length: maxPeriods }, (_, i) => meta.periods[i] ?? String(i + 1));
  const away = teams.find(t => t.homeAway === "away") ?? teams[0];
  const home = teams.find(t => t.homeAway === "home") ?? teams[1];

  const row = (t: TeamScore) => (
    <tr key={t.id} className="border-b border-[#13233A]/10 last:border-0">
      <td className="pr-3 py-1.5 font-bold text-xs text-[#131A24] whitespace-nowrap">{t.abbr}</td>
      {periods.map((_, i) => {
        const ls = t.linescores.find(l => l.period === i + 1);
        return (
          <td key={i} className="text-center text-xs text-[#3D4B58] w-6 py-1.5">
            {ls ? ls.value : sport === "MLB" ? "-" : ""}
          </td>
        );
      })}
      <td className="pl-3 py-1.5 font-black text-sm text-[#131A24] text-right">{t.score}</td>
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max">
        <thead>
          <tr>
            <th className="text-left text-[9px] text-[#3D4B58] font-bold uppercase tracking-wider pr-3 pb-1">Team</th>
            {periods.map((p, i) => (
              <th key={i} className="text-[9px] text-[#3D4B58] font-bold text-center w-6 pb-1">{p}</th>
            ))}
            <th className="text-[9px] text-[#3D4B58] font-bold text-right pl-3 pb-1">R</th>
          </tr>
        </thead>
        <tbody>
          {row(away)}
          {row(home)}
        </tbody>
      </table>
    </div>
  );
}

// ── Single game card ──────────────────────────────────────────────────────────

// ── Line Movement Types ───────────────────────────────────────────────────────
interface LMSpread  { open: number|null; current: number|null; move: number|null; awayPublic?: number|null; awayMoney?: number|null; homePublic?: number|null; homeMoney?: number|null; }
interface LMTotal   { open: number|null; current: number|null; move: number|null; overPublic?: number|null; overMoney?: number|null; underPublic?: number|null; underMoney?: number|null; }
interface LMML      { awayOpen: number|null; awayCurrent: number|null; homeOpen: number|null; homeCurrent: number|null; awayPublic?: number|null; awayMoney?: number|null; homePublic?: number|null; homeMoney?: number|null; }
interface LMGame    { id: string; sport: string; awayTeam: string; homeTeam: string; gameTime: string|null; status: string; numBets: number|null; openingInserted: string|null; currentInserted: string|null; spread: LMSpread; total: LMTotal; moneyline: LMML; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function _fmtOdds(o: number|null|undefined) { if (o==null) return "—"; return o>0?`+${o}`:String(o); }
function _fmtLine(n: number|null|undefined) { if (n==null) return "—"; return `${n>0?"+":""}${n}`; }

// ── GameLineMovement ──────────────────────────────────────────────────────────
// Pixel-accurate copy of the reference image layout:
//  SPREAD (AWAY TEAM)  |  TOTAL (O/U)  |  MONEYLINE
//  Line X → X [badge]     Line X → X        TeamA +137 → +145 (+8)  Sharp ↑ 72% $
//  Full Team (away)        Over              TeamB -165 → -175 (-10) Fade ↓ 28% $
//   👤 ████░░░░ 51%        👤 ████░░░ 75%     ── then bars below ──
//   $  ████░░░░ 62%        $  ████░░░ 59%
//  Full Team (home)        Under
//   👤 ████░░░░ 49%        👤 ██░░░░░ 25%
//   $  ████░░░░ 38%        $  ████░░░ 41%
//  footer: Opened · Updated · N bets                    via ActionNetwork

function _fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  } catch { return ""; }
}

function PubMoneyBars({ label, pub, money, role }: { label: string; pub?: number | null; money?: number | null; role?: string }) {
  if (pub == null && money == null) return null;
  return (
    <div className="mb-2">
      <div className="text-[10px] font-medium mb-1" style={{ color: "rgba(19,35,58,0.65)" }}>
        {label}{role ? <span style={{ color: "rgba(19,35,58,0.4)" }}> ({role})</span> : null}
      </div>
      {pub != null && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <Users size={9} className="flex-shrink-0" style={{ color: "rgba(19,35,58,0.4)" }} />
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: `${pub}%`, background: "rgba(99,102,241,0.65)" }} />
          </div>
          <span className="text-[10px] font-mono w-7 text-right" style={{ color: "rgba(19,35,58,0.6)" }}>{pub}%</span>
        </div>
      )}
      {money != null && (
        <div className="flex items-center gap-1.5">
          <DollarSign size={9} className="flex-shrink-0" style={{ color: "rgba(19,35,58,0.4)" }} />
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: `${money}%`, background: money >= 65 ? "rgba(74,222,128,0.75)" : "rgba(245,158,11,0.55)" }} />
          </div>
          <span className="text-[10px] font-mono font-semibold w-7 text-right" style={{ color: money >= 65 ? "#16a34a" : money >= 55 ? "#d97706" : "rgba(19,35,58,0.55)" }}>{money}%</span>
        </div>
      )}
    </div>
  );
}

function GameLineMovement({ game }: { game: LiveGame }) {
  const sport = game.sport;
  const away = game.teams.find(t => t.homeAway === "away") ?? game.teams[0];
  const home = game.teams.find(t => t.homeAway === "home") ?? game.teams[1];

  const { data: lmData, isLoading } = useQuery<LMGame[]>({
    queryKey: ["/api/line-movement"],
    queryFn: () => apiRequest("GET", "/api/line-movement").then(r => r.json()),
    staleTime: 3 * 60 * 1000, refetchInterval: 5 * 60 * 1000,
  });

  const lmGame = lmData?.find(g => {
    if (g.sport !== sport) return false;
    const sa = (away?.displayName ?? away?.abbr ?? "").toLowerCase();
    const sh = (home?.displayName ?? home?.abbr ?? "").toLowerCase();
    const al = sa.split(" ").pop() ?? ""; const hl = sh.split(" ").pop() ?? "";
    return al.length > 2 && hl.length > 2 &&
      (g.awayTeam.toLowerCase().includes(al) || al.includes(g.awayTeam.toLowerCase().split(" ").pop()!)) &&
      (g.homeTeam.toLowerCase().includes(hl) || hl.includes(g.homeTeam.toLowerCase().split(" ").pop()!));
  }) ?? null;

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  if (isLoading) return (
    <div className="flex items-center gap-2 py-2 text-[11px]" style={{ color: "rgba(19,35,58,0.4)" }} onClick={stopProp}>
      <Loader2 size={12} className="animate-spin" /> Loading betting lines…
    </div>
  );
  if (!lmGame) return (
    <div className="text-[11px] py-1 text-center" style={{ color: "rgba(19,35,58,0.35)" }} onClick={stopProp}>
      No line data available for this game.
    </div>
  );

  const sMove = lmGame.spread.move;
  const tMove = lmGame.total.move;
  const mlAM = (lmGame.moneyline.awayCurrent != null && lmGame.moneyline.awayOpen != null) ? lmGame.moneyline.awayCurrent - lmGame.moneyline.awayOpen : null;
  const mlHM = (lmGame.moneyline.homeCurrent != null && lmGame.moneyline.homeOpen != null) ? lmGame.moneyline.homeCurrent - lmGame.moneyline.homeOpen : null;

  // Sharp signal per team
  function sharpTag(money: number | null | undefined, pub: number | null | undefined) {
    if (money == null || pub == null) return null;
    const d = money - pub;
    if (money >= 65 && d >= 20) return <span className="text-[9px] font-bold ml-1 whitespace-nowrap" style={{ color: "#16a34a" }}>Sharp ↑ {money}% $</span>;
    if (money >= 55 && d >= 15) return <span className="text-[9px] font-bold ml-1 whitespace-nowrap" style={{ color: "#86efac" }}>Lean ↑ {money}% $</span>;
    if (money <= 35 && d <= -20) return <span className="text-[9px] font-bold ml-1 whitespace-nowrap" style={{ color: "#ef4444" }}>Fade ↓ {money}% $</span>;
    return null;
  }

  // Movement delta badge
  function deltaBadge(move: number | null | undefined) {
    if (move == null || move === 0) return null;
    const abs = Math.abs(move);
    const color = abs >= 3 ? "#ef4444" : abs >= 1.5 ? "#d97706" : "rgba(19,35,58,0.55)";
    const bg    = abs >= 3 ? "rgba(248,113,113,0.12)" : abs >= 1.5 ? "rgba(245,158,11,0.12)" : "rgba(19,35,58,0.07)";
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-1" style={{ color, background: bg }}>
        {move > 0 ? "+" : ""}{move.toFixed(1)}
      </span>
    );
  }

  const hasSteam = (Math.abs(sMove ?? 0) >= 2) || (Math.abs(tMove ?? 0) >= 2);
  const hasRLM   = lmGame ? ((lmGame.spread.awayPublic ?? 50) >= 60 && (sMove ?? 0) > 0) || ((lmGame.spread.awayPublic ?? 50) <= 40 && (sMove ?? 0) < 0) : false;

  // Format opened/updated times
  const openedTime  = _fmtTime((lmGame as any).openingInserted ?? null);
  const updatedTime = _fmtTime((lmGame as any).currentInserted ?? null);

  return (
    <div onClick={stopProp} className="space-y-3 pt-1">

      {/* Optional steam/RLM badge row */}
      {(hasSteam || hasRLM) && (
        <div className="flex items-center gap-2">
          <TrendingUp size={10} style={{ color: "rgba(19,35,58,0.4)" }} />
          {hasSteam  && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(248,113,113,0.1)", color: "#ef4444" }}>🔥 Sharp Steam</span>}
          {hasRLM && !hasSteam && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(74,222,128,0.1)", color: "#16a34a" }}>↩ Reverse Line Movement</span>}
        </div>
      )}

      {/* ── 3-column grid ── */}
      <div className="grid grid-cols-3 gap-3">

        {/* ════ SPREAD ════ */}
        <div className="rounded-xl p-3" style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.08)" }}>
          {/* Col header */}
          <p className="text-[9px] font-black uppercase tracking-wider mb-2" style={{ color: "rgba(19,35,58,0.5)" }}>
            Spread ({lmGame.awayTeam})
          </p>
          {/* Line open → current */}
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <span className="text-[10px] font-mono font-medium" style={{ color: "rgba(19,35,58,0.45)" }}>Line</span>
            <span className="text-[11px] font-mono" style={{ color: "rgba(19,35,58,0.5)" }}>{_fmtLine(lmGame.spread.open)}</span>
            <span style={{ color: "rgba(19,35,58,0.3)", fontSize: 10 }}>→</span>
            <span className="text-[12px] font-mono font-black" style={{ color: "#131A24" }}>{_fmtLine(lmGame.spread.current)}</span>
            {deltaBadge(sMove)}
          </div>
          {/* Away team bars */}
          <PubMoneyBars label={lmGame.awayTeam} role="away" pub={lmGame.spread.awayPublic} money={lmGame.spread.awayMoney} />
          {/* Home team bars */}
          <PubMoneyBars label={lmGame.homeTeam} role="home" pub={lmGame.spread.homePublic} money={lmGame.spread.homeMoney} />
          {lmGame.spread.awayPublic == null && lmGame.spread.awayMoney == null && (
            <p className="text-[9px] italic" style={{ color: "rgba(19,35,58,0.35)" }}>No public % available</p>
          )}
        </div>

        {/* ════ TOTAL (O/U) ════ */}
        <div className="rounded-xl p-3" style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[9px] font-black uppercase tracking-wider mb-2" style={{ color: "rgba(19,35,58,0.5)" }}>
            Total (O/U)
          </p>
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <span className="text-[10px] font-mono font-medium" style={{ color: "rgba(19,35,58,0.45)" }}>Line</span>
            <span className="text-[11px] font-mono" style={{ color: "rgba(19,35,58,0.5)" }}>{_fmtLine(lmGame.total.open)}</span>
            <span style={{ color: "rgba(19,35,58,0.3)", fontSize: 10 }}>→</span>
            <span className="text-[12px] font-mono font-black" style={{ color: "#131A24" }}>{_fmtLine(lmGame.total.current)}</span>
            {deltaBadge(tMove)}
          </div>
          {/* Over */}
          {(lmGame.total.overPublic != null || lmGame.total.overMoney != null) && (
            <div className="text-[9px] font-semibold mb-1" style={{ color: "rgba(19,35,58,0.55)" }}>Over</div>
          )}
          <PubMoneyBars label="" pub={lmGame.total.overPublic} money={lmGame.total.overMoney} />
          {/* Under */}
          {(lmGame.total.underPublic != null || lmGame.total.underMoney != null) && (
            <div className="text-[9px] font-semibold mb-1" style={{ color: "rgba(19,35,58,0.55)" }}>Under</div>
          )}
          <PubMoneyBars label="" pub={lmGame.total.underPublic} money={lmGame.total.underMoney} />
          {/* No public data notice */}
          {lmGame.total.overPublic == null && lmGame.total.overMoney == null && lmGame.total.underPublic == null && lmGame.total.underMoney == null && (
            <p className="text-[9px] italic mt-1" style={{ color: "rgba(19,35,58,0.35)" }}>No public % available</p>
          )}
        </div>

        {/* ════ MONEYLINE ════ */}
        <div className="rounded-xl p-3" style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[9px] font-black uppercase tracking-wider mb-2" style={{ color: "rgba(19,35,58,0.5)" }}>
            Moneyline
          </p>
          {/* Away odds row + sharp tag */}
          <div className="flex items-center gap-1 mb-1 flex-wrap">
            <span className="text-[10px] font-medium" style={{ color: "rgba(19,35,58,0.55)", minWidth: 0 }}>{lmGame.awayTeam}</span>
          </div>
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            <span className="text-[11px] font-mono" style={{ color: "rgba(19,35,58,0.5)" }}>{_fmtOdds(lmGame.moneyline.awayOpen)}</span>
            <span style={{ color: "rgba(19,35,58,0.3)", fontSize: 10 }}>→</span>
            <span className="text-[12px] font-mono font-black" style={{ color: "#131A24" }}>{_fmtOdds(lmGame.moneyline.awayCurrent)}</span>
            {mlAM != null && mlAM !== 0 && (
              <span className="text-[10px] font-semibold" style={{ color: mlAM > 0 ? "#16a34a" : "#ef4444" }}>({mlAM > 0 ? "+" : ""}{mlAM})</span>
            )}
            {sharpTag(lmGame.moneyline.awayMoney, lmGame.moneyline.awayPublic)}
          </div>
          {/* Away bars */}
          <PubMoneyBars label="" pub={lmGame.moneyline.awayPublic} money={lmGame.moneyline.awayMoney} />

          {/* Home odds row + sharp tag */}
          <div className="flex items-center gap-1 mt-1 mb-0.5 flex-wrap">
            <span className="text-[10px] font-medium" style={{ color: "rgba(19,35,58,0.55)" }}>{lmGame.homeTeam}</span>
          </div>
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            <span className="text-[11px] font-mono" style={{ color: "rgba(19,35,58,0.5)" }}>{_fmtOdds(lmGame.moneyline.homeOpen)}</span>
            <span style={{ color: "rgba(19,35,58,0.3)", fontSize: 10 }}>→</span>
            <span className="text-[12px] font-mono font-black" style={{ color: "#131A24" }}>{_fmtOdds(lmGame.moneyline.homeCurrent)}</span>
            {mlHM != null && mlHM !== 0 && (
              <span className="text-[10px] font-semibold" style={{ color: mlHM > 0 ? "#16a34a" : "#ef4444" }}>({mlHM > 0 ? "+" : ""}{mlHM})</span>
            )}
            {sharpTag(lmGame.moneyline.homeMoney, lmGame.moneyline.homePublic)}
          </div>
          {/* Home bars */}
          <PubMoneyBars label="" pub={lmGame.moneyline.homePublic} money={lmGame.moneyline.homeMoney} />
          {lmGame.moneyline.awayPublic == null && lmGame.moneyline.awayMoney == null && (
            <p className="text-[9px] italic mt-1" style={{ color: "rgba(19,35,58,0.35)" }}>No public % available</p>
          )}
        </div>

      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1" style={{ borderTop: "1px solid rgba(19,35,58,0.06)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          {openedTime  && <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.45)" }}>Opened: {openedTime}</span>}
          {updatedTime && <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.45)" }}>Updated: {updatedTime}</span>}
          {lmGame.numBets != null && (
            <span className="text-[9px]" style={{ color: "rgba(19,35,58,0.45)" }}>{lmGame.numBets.toLocaleString()} total bets tracked</span>
          )}
        </div>
        <span className="text-[9px] italic" style={{ color: "rgba(19,35,58,0.35)" }}>
          {lmGame.spread.awayPublic != null ? "via ActionNetwork" : "via ESPN · Public % N/A (end of season)"}
        </span>
      </div>

    </div>
  );
}

function GameCard({ game, expanded, onToggle }: { game: LiveGame; expanded: boolean; onToggle: () => void }) {
  const meta = SPORT_META[game.sport] ?? SPORT_META.NBA;
  const { text: statusText, live, color: statusColor } = stateLabel(game.status, game.date);
  const away = game.teams.find(t => t.homeAway === "away") ?? game.teams[0];
  const home = game.teams.find(t => t.homeAway === "home") ?? game.teams[1];
  const awayScore = parseInt(away?.score ?? "0");
  const homeScore = parseInt(home?.score ?? "0");
  const awayWin = game.status.state === "post" && awayScore > homeScore;
  const homeWin = game.status.state === "post" && homeScore > awayScore;

  return (
    <div
      className="rounded-xl border border-[#13233A]/10 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={onToggle}
    >
      {/* Header band */}
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: meta.bg }}>
        <div className="flex items-center gap-2">
          {live && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">Live</span>
            </span>
          )}
          <span className="text-[11px] font-bold" style={{ color: statusColor }}>{statusText}</span>
        </div>
        <div className="flex items-center gap-2">
          {game.broadcasts.length > 0 && (
            <div className="flex items-center gap-1">
              <Tv2 size={10} className="text-[#3D4B58]" />
              <span className="text-[10px] text-[#3D4B58]">{game.broadcasts[0]}</span>
            </div>
          )}
          <ChevronRight size={14} className={`text-[#3D4B58] transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </div>

      {/* Scoreboard row */}
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Away team */}
        <div className={`flex-1 flex items-center gap-2 ${awayWin ? "opacity-100" : game.status.state === "post" ? "opacity-50" : "opacity-100"}`}>
          {away?.logo && (
            <img src={away.logo} alt={away.abbr} className="w-8 h-8 object-contain flex-shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
          )}
          <div>
            <div className="font-black text-sm text-[#131A24]">{away?.abbr}</div>
            <div className="text-[10px] text-[#3D4B58]">{away?.records[0] ?? ""}</div>
          </div>
          <div className={`ml-auto font-black text-2xl ${awayWin ? "text-[#131A24]" : "text-[#3D4B58]"}`}>{away?.score}</div>
        </div>

        {/* Center divider */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 px-1">
          <span className="text-[10px] font-bold text-[#3D4B58] uppercase tracking-wider">@</span>
        </div>

        {/* Home team */}
        <div className={`flex-1 flex items-center gap-2 flex-row-reverse ${homeWin ? "opacity-100" : game.status.state === "post" ? "opacity-50" : "opacity-100"}`}>
          {home?.logo && (
            <img src={home.logo} alt={home.abbr} className="w-8 h-8 object-contain flex-shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
          )}
          <div className="text-right">
            <div className="font-black text-sm text-[#131A24]">{home?.abbr}</div>
            <div className="text-[10px] text-[#3D4B58]">{home?.records[0] ?? ""}</div>
          </div>
          <div className={`mr-auto font-black text-2xl ${homeWin ? "text-[#131A24]" : "text-[#3D4B58]"}`}>{home?.score}</div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#13233A]/08 px-4 py-3 space-y-4 bg-[#F6F1E7]/60">
          {/* Linescore */}
          {game.teams.some(t => t.linescores.length > 0) && (
            <LinescoreTable teams={game.teams} sport={game.sport} />
          )}

          {/* MLB situation */}
          {game.status.state === "in" && game.situation && game.sport === "MLB" && (
            <div className="rounded-lg bg-white border border-[#13233A]/08 p-3">
              <div className="flex items-start gap-4">
                {/* Diamond */}
                <div className="flex flex-col items-center gap-1.5">
                  <BaseballDiamond sit={game.situation} />
                  <OutDots outs={game.situation.outs} />
                  <span className="text-[9px] text-[#3D4B58] font-bold uppercase">{game.situation.outs} out{game.situation.outs !== 1 ? "s" : ""}</span>
                </div>
                {/* Count */}
                <div className="flex flex-col gap-2">
                  <div className="flex gap-3">
                    <CountBar label="B" val={game.situation.balls}   max={4} />
                    <CountBar label="S" val={game.situation.strikes} max={3} />
                  </div>
                  {/* Pitcher/Batter */}
                  <div className="space-y-1.5">
                    {game.situation.pitcher && (
                      <div className="flex items-center gap-2">
                        {game.situation.pitcher.headshot && (
                          <img src={game.situation.pitcher.headshot} alt="" className="w-6 h-6 rounded-full object-cover border border-[#13233A]/10" onError={e => (e.currentTarget.style.display = "none")} />
                        )}
                        <div>
                          <span className="text-[9px] font-bold uppercase text-[#3D4B58] mr-1">P</span>
                          <span className="text-[11px] font-semibold text-[#131A24]">{game.situation.pitcher.name}</span>
                          <span className="text-[10px] text-[#3D4B58] ml-1">({game.situation.pitcher.summary})</span>
                        </div>
                      </div>
                    )}
                    {game.situation.batter && (
                      <div className="flex items-center gap-2">
                        {game.situation.batter.headshot && (
                          <img src={game.situation.batter.headshot} alt="" className="w-6 h-6 rounded-full object-cover border border-[#13233A]/10" onError={e => (e.currentTarget.style.display = "none")} />
                        )}
                        <div>
                          <span className="text-[9px] font-bold uppercase text-[#3D4B58] mr-1">AB</span>
                          <span className="text-[11px] font-semibold text-[#131A24]">{game.situation.batter.name}</span>
                          <span className="text-[10px] text-[#3D4B58] ml-1">({game.situation.batter.summary})</span>
                        </div>
                      </div>
                    )}
                    {game.situation.lastPlay && (
                      <p className="text-[10px] text-[#3D4B58] italic mt-1">↳ {game.situation.lastPlay}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stat leaders */}
          {game.leaders.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#3D4B58]">Leaders</div>
              <div className="grid grid-cols-1 gap-1.5">
                {game.leaders.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-[#13233A]/08">
                    {l.athlete.headshot && (
                      <img src={l.athlete.headshot} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0 border border-[#13233A]/10" onError={e => (e.currentTarget.style.display = "none")} />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-bold text-[#131A24] truncate block">{l.athlete.name}</span>
                      <span className="text-[10px] text-[#3D4B58]">{l.displayValue}</span>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#13233A]/06 text-[#3D4B58]">{l.category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Line Movement */}
          <GameLineMovement game={game} />

          {/* Venue */}
          {game.venue && (
            <div className="flex items-center gap-1 text-[10px] text-[#3D4B58]">
              <MapPin size={10} />
              <span>{game.venue.name}{game.venue.city ? ` · ${game.venue.city}` : ""}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sport section ─────────────────────────────────────────────────────────────
function SportSection({ sport, games, expandedId, onToggle }: {
  sport: string;
  games: LiveGame[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const meta = SPORT_META[sport] ?? SPORT_META.NBA;
  const live  = games.filter(g => g.status.state === "in");
  const pre   = games.filter(g => g.status.state === "pre");
  const post  = games.filter(g => g.status.state === "post");

  if (games.length === 0) return null;

  // Sort: live first, then pre (sorted by time), then final
  const sorted = [
    ...live,
    ...pre.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    ...post,
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{meta.emoji}</span>
        <h2 className="font-black text-base text-[#131A24] tracking-tight">{meta.label}</h2>
        {live.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-black text-green-500 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {live.length} Live
          </span>
        )}
        <span className="ml-auto text-[11px] text-[#3D4B58]">{games.length} game{games.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-2">
        {sorted.map(g => (
          <GameCard key={g.id} game={g} expanded={expandedId === g.id} onToggle={() => onToggle(g.id)} />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const SPORT_TABS = [
  { id: "all", label: "All Sports" },
  { id: "nba", label: "🏀 NBA" },
  { id: "mlb", label: "⚾ MLB" },
  { id: "nhl", label: "🏒 NHL" },
  { id: "nfl", label: "🏈 NFL" },
];

export default function LiveScores() {
  const [activeSport, setActiveSport] = useState("all");
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const lastUpdated = useRef<string | null>(null);

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<LiveScoresResponse>({
    queryKey: ["/api/live-scores", activeSport],
    queryFn: () => apiRequest("GET", `/api/live-scores?sport=${activeSport}`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime:        20_000,
  });

  useEffect(() => {
    if (data?.updatedAt) lastUpdated.current = data.updatedAt;
  }, [data]);

  const sports = data?.sports ?? {};
  const sportKeys = Object.keys(sports) as (keyof typeof sports)[];
  const hasLive = sportKeys.some(k => (sports[k] ?? []).some((g: LiveGame) => g.status.state === "in"));
  const totalGames = sportKeys.reduce((sum, k) => sum + (sports[k]?.length ?? 0), 0);

  const toggleExpand = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  return (
    <div className="min-h-screen bg-[#F6F1E7]">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-[#13233A] text-[#F6F1E7] shadow-lg">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="font-black text-lg tracking-tight">Live Scores</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {hasLive ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold uppercase tracking-wider">
                    <Wifi size={10} /> Live Updates
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-[#F6F1E7]/40 font-bold uppercase tracking-wider">
                    <WifiOff size={10} /> No Live Games
                  </span>
                )}
                {totalGames > 0 && (
                  <span className="text-[10px] text-[#F6F1E7]/50">· {totalGames} games today</span>
                )}
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={15} className="text-[#F6F1E7]/70" />
            </button>
          </div>

          {/* Sport tabs */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {SPORT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSport(tab.id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeSport === tab.id
                    ? "bg-[#F6F1E7] text-[#131A24]"
                    : "text-[#F6F1E7]/60 hover:text-[#F6F1E7]/90 hover:bg-white/08"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 space-y-6 max-w-2xl mx-auto">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl bg-[#13233A]/05 animate-pulse" />
            ))}
          </div>
        )}

        {error && !isLoading && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-center">
            <p className="text-sm text-red-600 font-semibold">Failed to load scores</p>
            <button onClick={() => refetch()} className="mt-2 text-xs text-red-500 underline">Try again</button>
          </div>
        )}

        {!isLoading && !error && totalGames === 0 && (
          <div className="rounded-xl bg-white border border-[#13233A]/10 p-8 text-center">
            <div className="text-4xl mb-2">🏟️</div>
            <p className="font-bold text-[#131A24]">No games today</p>
            <p className="text-sm text-[#3D4B58] mt-1">Check back when games are scheduled.</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {(activeSport === "all" || activeSport === "nba") && sports.nba && (
              <SportSection sport="NBA" games={sports.nba} expandedId={expandedId} onToggle={toggleExpand} />
            )}
            {(activeSport === "all" || activeSport === "mlb") && sports.mlb && (
              <SportSection sport="MLB" games={sports.mlb} expandedId={expandedId} onToggle={toggleExpand} />
            )}
            {(activeSport === "all" || activeSport === "nhl") && sports.nhl && (
              <SportSection sport="NHL" games={sports.nhl} expandedId={expandedId} onToggle={toggleExpand} />
            )}
            {(activeSport === "all" || activeSport === "nfl") && sports.nfl && (
              <SportSection sport="NFL" games={sports.nfl} expandedId={expandedId} onToggle={toggleExpand} />
            )}
          </>
        )}

        {/* Last refresh */}
        {data?.updatedAt && (
          <div className="flex items-center justify-center gap-1 text-[10px] text-[#3D4B58]/60">
            <Clock size={9} />
            <span>Updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
            <span>· Auto-refreshes every 30s</span>
          </div>
        )}
      </div>
    </div>
  );
}
