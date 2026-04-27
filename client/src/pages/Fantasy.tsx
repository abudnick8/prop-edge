/**
 * Clubhouse IQ Fantasy Intelligence — Live Edition
 *
 * Data sources (all free, no auth):
 *  - ESPN rosters (NFL/NBA/MLB/NHL) — real players, real teams
 *  - ESPN news/injuries — overlaid on every player card
 *  - ESPN transactions feed — latest signings, trades, cuts
 *  - Sleeper player DB — NFL depth chart, rookie flags
 *  - Sleeper trending add/drop — real 48-hour waiver wire heat
 *
 * Features:
 *  - Team drill-down view — click any team to see full roster + news
 *  - Player outlook drawer — click any player for full intel
 *  - Injury / trending badges on every card
 *  - Live transactions ticker
 *  - Sport tabs: ALL / NFL / NBA / MLB / NHL
 *  - Position filter + search
 *  - Auto-refresh every 15 min
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Search,
  ChevronDown, ChevronUp, Activity, Flame, ArrowLeft,
  Users, Newspaper, Clock, Zap, Star, CheckCircle, XCircle,
  ArrowUpRight, Package, X, ChevronRight, Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type SportTab = "ALL" | "NFL" | "NBA" | "MLB" | "NHL";

interface NewsAlert {
  headline: string;
  published: string;
  type: string;
  sport: string;
  link?: string;
}

interface LivePlayer {
  id: string;
  espnId: string;
  name: string;
  sport: SportTab;
  team: string;
  teamName: string;
  position: string;
  jersey: string | null;
  status: string;
  injuryStatus: string | null;
  experience: number | null;
  isRookie: boolean;
  isTrendingAdd: boolean;
  isTrendingDrop: boolean;
  sleeperRank: number | null;
  newsAlerts: NewsAlert[];
  latestNews: NewsAlert | null;
  headshot: string;
}

interface FantasyIntel {
  generatedAt: string;
  players: LivePlayer[];
  transactions: any[];
  headlines: NewsAlert[];
  teamRosters: Record<string, LivePlayer[]>;
  trendingAdd: { count: number; player: any }[];
  trendingDrop: { count: number; player: any }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeSince(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function injuryColor(status: string | null): { bg: string; text: string; border: string } {
  if (!status) return { bg: "transparent", text: "#94a3b8", border: "transparent" };
  const s = status.toLowerCase();
  if (s.includes("out") || s.includes("il") || s.includes("season") || s.includes("concussion") || s.includes("suspended"))
    return { bg: "rgba(248,113,113,0.12)", text: "#f87171", border: "rgba(248,113,113,0.30)" };
  if (s.includes("doubtful"))
    return { bg: "rgba(251,146,60,0.12)", text: "#fb923c", border: "rgba(251,146,60,0.30)" };
  if (s.includes("questionable") || s.includes("day-to-day"))
    return { bg: "rgba(250,204,21,0.10)", text: "#facc15", border: "rgba(250,204,21,0.30)" };
  if (s.includes("activated"))
    return { bg: "rgba(34,197,94,0.10)", text: "#22c55e", border: "rgba(34,197,94,0.30)" };
  return { bg: "rgba(148,163,184,0.08)", text: "#94a3b8", border: "rgba(148,163,184,0.20)" };
}

function alertTypeColor(type: string): string {
  switch (type) {
    case "injury": return "#f87171";
    case "trade": return "#a78bfa";
    case "draft": return "#facc15";
    case "signing": return "#34d399";
    case "analysis": return "#60a5fa";
    default: return "#94a3b8";
  }
}

function alertTypeBadge(type: string): string {
  switch (type) {
    case "injury": return "🚑 INJURY";
    case "trade": return "🔄 TRADE";
    case "draft": return "🎓 DRAFT";
    case "signing": return "✍️ SIGNING";
    case "analysis": return "📊 ANALYSIS";
    default: return "📰 NEWS";
  }
}

const SPORT_COLORS: Record<SportTab, string> = {
  ALL: "#94a3b8",
  NFL: "#22c55e",
  NBA: "#f97316",
  MLB: "#60a5fa",
  NHL: "#a78bfa",
};

// ─── Player Outlook Drawer ────────────────────────────────────────────────────
function PlayerDrawer({ player, onClose }: { player: LivePlayer; onClose: () => void }) {
  const inj = injuryColor(player.injuryStatus);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} />
      <div
        className="relative w-full max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        style={{ background: "#F6F1E7", border: "1px solid rgba(19,35,58,0.12)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b" style={{ borderColor: "rgba(19,35,58,0.10)" }}>
          <img
            src={player.headshot}
            alt={player.name}
            className="w-16 h-12 object-cover rounded-xl flex-shrink-0"
            style={{ background: "rgba(19,35,58,0.06)", border: "1px solid rgba(19,35,58,0.10)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-black text-foreground">{player.name}</p>
              {player.jersey && <span className="text-[10px] text-muted-foreground">#{player.jersey}</span>}
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded"
                style={{ background: SPORT_COLORS[player.sport] + "22", color: SPORT_COLORS[player.sport] }}
              >
                {player.sport}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{player.position} · {player.teamName}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {player.injuryStatus && (
                <span
                  className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: inj.bg, color: inj.text, border: `1px solid ${inj.border}` }}
                >
                  ⚕ {player.injuryStatus}
                </span>
              )}
              {player.isRookie && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(250,204,21,0.12)", color: "#b8930a", border: "1px solid rgba(250,204,21,0.30)" }}>
                  🎓 ROOKIE
                </span>
              )}
              {player.isTrendingAdd && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.30)" }}>
                  🔥 TRENDING ADD
                </span>
              )}
              {player.isTrendingDrop && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}>
                  📉 TRENDING DROP
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-1 rounded-lg" style={{ color: "#94a3b8" }}>
            <X size={18} />
          </button>
        </div>

        {/* Status + experience */}
        <div className="px-4 py-3 grid grid-cols-3 gap-2">
          {[
            { label: "Status", value: player.injuryStatus || player.status || "Active" },
            { label: "Experience", value: player.isRookie ? "Rookie" : player.experience !== null ? `${player.experience} yr${player.experience !== 1 ? "s" : ""}` : "—" },
            { label: "Position", value: player.position },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-2.5 text-center" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className="text-xs font-bold text-foreground mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {/* News alerts */}
        {player.newsAlerts.length > 0 ? (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">Latest Intel</p>
            {player.newsAlerts.map((alert, i) => (
              <div
                key={i}
                className="rounded-xl p-3"
                style={{ background: alertTypeColor(alert.type) + "10", border: `1px solid ${alertTypeColor(alert.type)}30` }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-black" style={{ color: alertTypeColor(alert.type) }}>
                    {alertTypeBadge(alert.type)}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{timeSince(alert.published)}</span>
                </div>
                <p className="text-[11px] text-foreground leading-snug">{alert.headline}</p>
                {alert.link && (
                  <a href={alert.link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 mt-1 block">
                    Read more →
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 pb-4">
            <div className="rounded-xl p-3 text-center" style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.08)" }}>
              <p className="text-xs text-muted-foreground">No recent news for {player.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Check back closer to game time for injury updates</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────
function PlayerCard({ player, onClick }: { player: LivePlayer; onClick: () => void }) {
  const inj = injuryColor(player.injuryStatus);
  const hasNews = player.newsAlerts.length > 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border overflow-hidden transition-all hover:shadow-md active:scale-[0.99]"
      style={{
        background: player.injuryStatus && inj.text !== "#94a3b8" ? inj.bg : "#fff",
        borderColor: player.injuryStatus && inj.text !== "#94a3b8" ? inj.border : "rgba(19,35,58,0.10)",
      }}
    >
      <div className="flex items-center gap-3 px-3 py-3">
        {/* Headshot */}
        <div className="relative flex-shrink-0">
          <img
            src={player.headshot}
            alt={player.name}
            className="w-10 h-8 object-cover rounded-lg"
            style={{ background: "rgba(19,35,58,0.06)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          {player.isRookie && (
            <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px]" style={{ background: "#facc15", color: "#1a1a1a" }}>R</div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold text-foreground truncate">{player.name}</p>
            {player.jersey && <span className="text-[9px] text-muted-foreground">#{player.jersey}</span>}
          </div>
          <p className="text-[10px] text-muted-foreground">{player.position} · {player.team}</p>
          {player.latestNews && (
            <p className="text-[10px] truncate mt-0.5" style={{ color: alertTypeColor(player.latestNews.type) }}>
              {player.latestNews.headline.slice(0, 60)}{player.latestNews.headline.length > 60 ? "…" : ""}
            </p>
          )}
        </div>

        {/* Right badges */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {player.injuryStatus && (
            <span
              className="text-[8px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={{ background: inj.bg, color: inj.text, border: `1px solid ${inj.border}` }}
            >
              {player.injuryStatus.split(" ")[0]}
            </span>
          )}
          {player.isTrendingAdd && <span className="text-[8px] font-black" style={{ color: "#22c55e" }}>🔥 +TRENDING</span>}
          {player.isTrendingDrop && <span className="text-[8px] font-black" style={{ color: "#f87171" }}>📉 -TRENDING</span>}
          {hasNews && !player.injuryStatus && !player.isTrendingAdd && !player.isTrendingDrop && (
            <span className="text-[8px] font-black" style={{ color: "#60a5fa" }}>📰 NEWS</span>
          )}
          <ChevronRight size={11} className="text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}

// ─── Team Roster View ─────────────────────────────────────────────────────────
function TeamView({
  sport,
  teamKey,
  teamPlayers,
  onBack,
  onPlayerClick,
}: {
  sport: SportTab;
  teamKey: string;
  teamPlayers: LivePlayer[];
  onBack: () => void;
  onPlayerClick: (p: LivePlayer) => void;
}) {
  const [posFilter, setPosFilter] = useState("ALL");
  const teamName = teamPlayers[0]?.teamName || teamKey;
  const teamAbbr = teamPlayers[0]?.team || "";

  const allPositions = [...new Set(teamPlayers.map(p => p.position))].sort();
  const filtered = posFilter === "ALL" ? teamPlayers : teamPlayers.filter(p => p.position === posFilter);

  const injured = teamPlayers.filter(p => p.injuryStatus && !p.injuryStatus.includes("Activated"));
  const rookies = teamPlayers.filter(p => p.isRookie);
  const trending = teamPlayers.filter(p => p.isTrendingAdd || p.isTrendingDrop);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground px-3 py-1.5 rounded-xl border"
          style={{ background: "rgba(19,35,58,0.04)", borderColor: "rgba(19,35,58,0.10)" }}
        >
          <ArrowLeft size={12} /> Teams
        </button>
        <div>
          <p className="text-base font-black text-foreground">{teamName}</p>
          <p className="text-[10px] text-muted-foreground">{teamPlayers.length} players · {sport}</p>
        </div>
      </div>

      {/* KPI strip */}
      {(injured.length > 0 || rookies.length > 0 || trending.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.20)" }}>
            <p className="text-base font-black" style={{ color: "#f87171" }}>{injured.length}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Injured / Q</p>
          </div>
          <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.20)" }}>
            <p className="text-base font-black" style={{ color: "#facc15" }}>{rookies.length}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Rookies</p>
          </div>
          <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.20)" }}>
            <p className="text-base font-black" style={{ color: "#22c55e" }}>{trending.length}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Trending</p>
          </div>
        </div>
      )}

      {/* Position filter */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {["ALL", ...allPositions].map(pos => (
          <button
            key={pos}
            onClick={() => setPosFilter(pos)}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap flex-shrink-0 border transition-colors"
            style={{
              background: posFilter === pos ? SPORT_COLORS[sport] + "20" : "rgba(19,35,58,0.04)",
              color: posFilter === pos ? SPORT_COLORS[sport] : "#94a3b8",
              borderColor: posFilter === pos ? SPORT_COLORS[sport] + "50" : "rgba(19,35,58,0.10)",
            }}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Player list */}
      <div className="space-y-2">
        {filtered.map(p => (
          <PlayerCard key={p.id} player={p} onClick={() => onPlayerClick(p)} />
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-6">No players at {posFilter}</p>
        )}
      </div>
    </div>
  );
}

// ─── Teams Grid ───────────────────────────────────────────────────────────────
function TeamsGrid({
  sport,
  teamRosters,
  onTeamClick,
}: {
  sport: SportTab;
  teamRosters: Record<string, LivePlayer[]>;
  onTeamClick: (key: string) => void;
}) {
  const teams = Object.entries(teamRosters)
    .filter(([key]) => sport === "ALL" || key.startsWith(sport + "-"))
    .sort(([, a], [, b]) => {
      // Sort: teams with most news / injuries first
      const aScore = a.filter(p => p.injuryStatus || p.isTrendingAdd || p.newsAlerts.length > 0).length;
      const bScore = b.filter(p => p.injuryStatus || p.isTrendingAdd || p.newsAlerts.length > 0).length;
      return bScore - aScore;
    });

  if (teams.length === 0) {
    return <p className="text-center text-xs text-muted-foreground py-8">Loading teams...</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {teams.map(([key, players]) => {
        const teamAbbr = players[0]?.team || key.split("-")[1];
        const teamName = players[0]?.teamName || teamAbbr;
        const sp = players[0]?.sport || sport;
        const injured = players.filter(p => p.injuryStatus && !p.injuryStatus.includes("Activated")).length;
        const rookies = players.filter(p => p.isRookie).length;
        const trending = players.filter(p => p.isTrendingAdd).length;
        const hasNews = players.some(p => p.newsAlerts.length > 0);
        return (
          <button
            key={key}
            onClick={() => onTeamClick(key)}
            className="text-left rounded-2xl border p-3 transition-all hover:shadow-md active:scale-[0.99]"
            style={{
              background: hasNews ? "rgba(19,35,58,0.03)" : "#fff",
              borderColor: injured > 0 ? "rgba(248,113,113,0.25)" : "rgba(19,35,58,0.10)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded"
                style={{ background: SPORT_COLORS[sp as SportTab] + "20", color: SPORT_COLORS[sp as SportTab] }}
              >
                {sp}
              </span>
              {injured > 0 && (
                <span className="text-[9px] font-black" style={{ color: "#f87171" }}>⚕{injured}</span>
              )}
              {trending > 0 && (
                <span className="text-[9px] font-black" style={{ color: "#22c55e" }}>🔥{trending}</span>
              )}
            </div>
            <p className="text-sm font-black text-foreground">{teamAbbr}</p>
            <p className="text-[10px] text-muted-foreground truncate">{teamName}</p>
            <p className="text-[9px] text-muted-foreground mt-1">{players.length} players{rookies > 0 ? ` · ${rookies} rookies` : ""}</p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Transactions Ticker ──────────────────────────────────────────────────────
function TransactionsFeed({ transactions }: { transactions: any[] }) {
  const [limit, setLimit] = useState(8);
  if (!transactions.length) return null;
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(19,35,58,0.10)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(19,35,58,0.08)", background: "rgba(19,35,58,0.02)" }}>
        <Package size={14} style={{ color: "#a78bfa" }} />
        <p className="text-sm font-black text-foreground">Recent Transactions</p>
        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>LIVE</span>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(19,35,58,0.07)" }}>
        {transactions.slice(0, limit).map((t, i) => (
          <div key={i} className="px-4 py-2.5">
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded whitespace-nowrap"
                style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa" }}
              >
                {t.team || t.sport || "NFL"}
              </span>
              <span className="text-[9px] text-muted-foreground">{timeSince(t.date)}</span>
            </div>
            <p className="text-[11px] text-foreground leading-snug">
              {t.description?.slice(0, 120)}{t.description?.length > 120 ? "…" : ""}
            </p>
          </div>
        ))}
      </div>
      {transactions.length > limit && (
        <button
          onClick={() => setLimit(l => l + 10)}
          className="w-full py-2.5 text-[11px] font-bold text-muted-foreground border-t"
          style={{ borderColor: "rgba(19,35,58,0.08)" }}
        >
          Show more ({transactions.length - limit} remaining)
        </button>
      )}
    </div>
  );
}

// ─── Trending Widget ──────────────────────────────────────────────────────────
function TrendingWidget({ trendingAdd, trendingDrop }: { trendingAdd: any[]; trendingDrop: any[] }) {
  if (!trendingAdd.length && !trendingDrop.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Adding */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(34,197,94,0.20)" }}>
        <div className="px-3 py-2 border-b flex items-center gap-1.5" style={{ borderColor: "rgba(34,197,94,0.15)", background: "rgba(34,197,94,0.04)" }}>
          <TrendingUp size={12} style={{ color: "#22c55e" }} />
          <p className="text-[10px] font-black" style={{ color: "#22c55e" }}>TRENDING ADD</p>
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(19,35,58,0.06)" }}>
          {trendingAdd.slice(0, 5).map((t, i) => (
            <div key={i} className="px-3 py-1.5">
              <p className="text-[11px] font-bold text-foreground truncate">{t.player?.name}</p>
              <p className="text-[9px] text-muted-foreground">{t.player?.position} · {t.player?.team} · +{t.count.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Dropping */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(248,113,113,0.20)" }}>
        <div className="px-3 py-2 border-b flex items-center gap-1.5" style={{ borderColor: "rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.04)" }}>
          <TrendingDown size={12} style={{ color: "#f87171" }} />
          <p className="text-[10px] font-black" style={{ color: "#f87171" }}>TRENDING DROP</p>
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(19,35,58,0.06)" }}>
          {trendingDrop.slice(0, 5).map((t, i) => (
            <div key={i} className="px-3 py-1.5">
              <p className="text-[11px] font-bold text-foreground truncate">{t.player?.name}</p>
              <p className="text-[9px] text-muted-foreground">{t.player?.position} · {t.player?.team} · −{t.count.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Headlines Feed ───────────────────────────────────────────────────────────
function HeadlinesFeed({ headlines }: { headlines: NewsAlert[] }) {
  const [limit, setLimit] = useState(6);
  if (!headlines.length) return null;
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(19,35,58,0.10)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(19,35,58,0.08)", background: "rgba(19,35,58,0.02)" }}>
        <Newspaper size={14} style={{ color: "#60a5fa" }} />
        <p className="text-sm font-black text-foreground">Fantasy Headlines</p>
        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}>
          {headlines.length}
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(19,35,58,0.07)" }}>
        {headlines.slice(0, limit).map((h, i) => (
          <div key={i} className="px-4 py-2.5 flex items-start gap-2">
            <span className="text-[10px] font-black mt-0.5 flex-shrink-0" style={{ color: alertTypeColor(h.type) }}>
              {h.type === "injury" ? "⚕" : h.type === "trade" ? "🔄" : h.type === "draft" ? "🎓" : h.type === "signing" ? "✍️" : "📰"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-foreground leading-snug">{h.headline}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px]" style={{ color: SPORT_COLORS[h.sport as SportTab] || "#94a3b8" }}>{h.sport}</span>
                <span className="text-[9px] text-muted-foreground">{timeSince(h.published)}</span>
                {h.link && <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400">→ Read</a>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {headlines.length > limit && (
        <button onClick={() => setLimit(l => l + 10)} className="w-full py-2.5 text-[11px] font-bold text-muted-foreground border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
          Show more
        </button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type MainView = "overview" | "players" | "teams";

export default function Fantasy() {
  const [sport, setSport] = useState<SportTab>("NFL");
  const [mainView, setMainView] = useState<MainView>("overview");
  const [selectedTeamKey, setSelectedTeamKey] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<LivePlayer | null>(null);
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<FantasyIntel>({
    queryKey: ["/api/fantasy-intel", sport],
    queryFn: () => apiRequest("GET", `/api/fantasy-intel?sport=${sport}`).then(r => r.json()),
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const players = data?.players ?? [];
  const transactions = data?.transactions ?? [];
  const headlines = data?.headlines ?? [];
  const teamRosters = data?.teamRosters ?? {};
  const trendingAdd = data?.trendingAdd ?? [];
  const trendingDrop = data?.trendingDrop ?? [];

  // Position options for current sport
  const POSITIONS_BY_SPORT: Record<SportTab, string[]> = {
    ALL: ["QB","RB","WR","TE","PG","SG","SF","PF","C","SP","RP","OF"],
    NFL: ["QB","RB","WR","TE","K"],
    NBA: ["PG","SG","SF","PF","C"],
    MLB: ["SP","RP","C","1B","2B","3B","SS","OF","DH"],
    NHL: ["LW","RW","C","D"],
  };

  const filteredPlayers = useMemo(() => {
    let p = players;
    if (posFilter !== "ALL") p = p.filter(x => x.position === posFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      p = p.filter(x => x.name.toLowerCase().includes(q) || x.team.toLowerCase().includes(q) || x.teamName.toLowerCase().includes(q));
    }
    // Sort: injured/trending/news first, then alphabetical
    return [...p].sort((a, b) => {
      const scoreA = (a.injuryStatus ? 3 : 0) + (a.isTrendingAdd ? 2 : 0) + (a.newsAlerts.length > 0 ? 1 : 0);
      const scoreB = (b.injuryStatus ? 3 : 0) + (b.isTrendingAdd ? 2 : 0) + (b.newsAlerts.length > 0 ? 1 : 0);
      return scoreB - scoreA;
    });
  }, [players, posFilter, search]);

  const injuredCount = players.filter(p => p.injuryStatus && !p.injuryStatus.includes("Activated")).length;
  const rookieCount = players.filter(p => p.isRookie).length;
  const newsCount = players.filter(p => p.newsAlerts.length > 0).length;

  const SPORT_TABS: SportTab[] = ["ALL", "NFL", "NBA", "MLB", "NHL"];

  return (
    <div className="flex flex-col gap-4 p-4 pb-28 max-w-2xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users size={18} style={{ color: "#60a5fa" }} />
            <h1 className="text-xl font-black text-foreground">Fantasy Intel</h1>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}>LIVE</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Real rosters · injuries · transactions · rookies</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border"
          style={{ background: "rgba(19,35,58,0.04)", borderColor: "rgba(19,35,58,0.12)" }}
          disabled={isLoading}
        >
          <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
          {isLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Last updated */}
      {dataUpdatedAt > 0 && (
        <p className="text-[10px] text-muted-foreground -mt-2">
          Updated {new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT · ESPN + Sleeper · auto-refresh every 15 min
        </p>
      )}

      {/* Sport tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl border" style={{ background: "rgba(19,35,58,0.03)", borderColor: "rgba(19,35,58,0.08)" }}>
        {SPORT_TABS.map(s => (
          <button
            key={s}
            onClick={() => { setSport(s); setPosFilter("ALL"); setSelectedTeamKey(null); setMainView("overview"); }}
            className="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
            style={{
              background: sport === s ? SPORT_COLORS[s] + "20" : "transparent",
              color: sport === s ? SPORT_COLORS[s] : "#94a3b8",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3 animate-pulse">
          {[1,2,3,4].map(i => <div key={i} className="h-16 rounded-2xl" style={{ background: "rgba(19,35,58,0.06)" }} />)}
        </div>
      )}

      {/* Error */}
      {!isLoading && data && (data as any).error && (
        <div className="rounded-2xl p-6 text-center" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.20)" }}>
          <AlertTriangle size={24} className="mx-auto mb-2" style={{ color: "#f87171" }} />
          <p className="font-bold text-foreground">Data unavailable</p>
          <p className="text-xs text-muted-foreground mt-1">{(data as any).error}</p>
        </div>
      )}

      {!isLoading && data && !(data as any).error && (
        <>
          {/* View switcher */}
          {!selectedTeamKey && (
            <div className="flex items-center gap-1.5 p-1 rounded-xl border" style={{ background: "rgba(19,35,58,0.03)", borderColor: "rgba(19,35,58,0.08)" }}>
              {(["overview","players","teams"] as MainView[]).map(v => (
                <button
                  key={v}
                  onClick={() => setMainView(v)}
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-colors"
                  style={{
                    background: mainView === v ? "rgba(19,35,58,0.10)" : "transparent",
                    color: mainView === v ? "#131A24" : "#94a3b8",
                  }}
                >
                  {v === "overview" ? "📊 Overview" : v === "players" ? "👤 Players" : "🏟️ Teams"}
                </button>
              ))}
            </div>
          )}

          {/* ── TEAM DRILL-DOWN ── */}
          {selectedTeamKey && teamRosters[selectedTeamKey] && (
            <TeamView
              sport={sport}
              teamKey={selectedTeamKey}
              teamPlayers={teamRosters[selectedTeamKey]}
              onBack={() => setSelectedTeamKey(null)}
              onPlayerClick={setSelectedPlayer}
            />
          )}

          {/* ── OVERVIEW ── */}
          {!selectedTeamKey && mainView === "overview" && (
            <div className="space-y-4">
              {/* KPI strip */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.18)" }}>
                  <p className="text-base font-black" style={{ color: "#f87171" }}>{injuredCount}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Injured/Q</p>
                </div>
                <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.18)" }}>
                  <p className="text-base font-black" style={{ color: "#facc15" }}>{rookieCount}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Rookies</p>
                </div>
                <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.18)" }}>
                  <p className="text-base font-black" style={{ color: "#60a5fa" }}>{newsCount}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">In the News</p>
                </div>
              </div>

              {/* Trending (NFL only) */}
              {sport === "NFL" || sport === "ALL" ? (
                <TrendingWidget trendingAdd={trendingAdd} trendingDrop={trendingDrop} />
              ) : null}

              {/* Headlines */}
              <HeadlinesFeed headlines={headlines.filter(h => sport === "ALL" || h.sport === sport)} />

              {/* Transactions */}
              <TransactionsFeed transactions={transactions} />
            </div>
          )}

          {/* ── PLAYERS VIEW ── */}
          {!selectedTeamKey && mainView === "players" && (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search players or teams…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl text-sm border bg-card text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                  style={{ borderColor: "rgba(19,35,58,0.12)" }}
                />
              </div>

              {/* Position filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {["ALL", ...(POSITIONS_BY_SPORT[sport] || [])].map(pos => (
                  <button
                    key={pos}
                    onClick={() => setPosFilter(pos)}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap flex-shrink-0 border transition-colors"
                    style={{
                      background: posFilter === pos ? SPORT_COLORS[sport] + "20" : "rgba(19,35,58,0.04)",
                      color: posFilter === pos ? SPORT_COLORS[sport] : "#94a3b8",
                      borderColor: posFilter === pos ? SPORT_COLORS[sport] + "50" : "rgba(19,35,58,0.10)",
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>

              {/* Count */}
              <p className="text-[10px] text-muted-foreground">{filteredPlayers.length} players — sorted by news activity</p>

              {/* Player list */}
              <div className="space-y-2">
                {filteredPlayers.slice(0, 60).map(p => (
                  <PlayerCard key={p.id} player={p} onClick={() => setSelectedPlayer(p)} />
                ))}
                {filteredPlayers.length === 0 && (
                  <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.08)" }}>
                    <p className="text-sm font-bold text-foreground">No players found</p>
                    <p className="text-xs text-muted-foreground mt-1">Try adjusting your search or filter</p>
                  </div>
                )}
                {filteredPlayers.length > 60 && (
                  <p className="text-center text-[10px] text-muted-foreground py-2">Showing top 60 — use search to narrow results</p>
                )}
              </div>
            </div>
          )}

          {/* ── TEAMS VIEW ── */}
          {!selectedTeamKey && mainView === "teams" && (
            <TeamsGrid
              sport={sport}
              teamRosters={teamRosters}
              onTeamClick={setSelectedTeamKey}
            />
          )}
        </>
      )}

      {/* Data source note */}
      {!isLoading && (
        <div
          className="rounded-xl p-3 text-[10px] text-muted-foreground leading-relaxed"
          style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.08)" }}
        >
          <p className="font-bold text-foreground text-[11px] mb-1">ℹ️ Data Sources</p>
          Live rosters via ESPN · News & injuries via ESPN · Waiver wire trends via Sleeper API · Transactions via ESPN · All free, no subscriptions required · Refreshes every 15 minutes
        </div>
      )}

      {/* Player drawer */}
      {selectedPlayer && (
        <PlayerDrawer player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      )}
    </div>
  );
}
