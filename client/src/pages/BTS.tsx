import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { ChevronDown, ChevronUp, Trophy, Target, TrendingUp, AlertCircle, RefreshCw, Flame, Zap } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtAvg(v: number | null | undefined) {
  if (!v) return "—";
  return "." + Math.round(v * 1000).toString().padStart(3, "0");
}
function fmtPct(v: number | null | undefined) {
  if (!v && v !== 0) return "—";
  return (v * 100).toFixed(0) + "%";
}

// ─── Score ring ─────────────────────────────────────────────────────────────
function ProbRing({ pct }: { pct: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const fill = circ * (pct / 100);
  const color = pct >= 70 ? "#22c55e" : pct >= 65 ? "#facc15" : "#f87171";
  return (
    <svg width={56} height={56} viewBox="0 0 56 56">
      <circle cx={28} cy={28} r={r} fill="none" stroke="rgba(19,35,58,0.10)" strokeWidth={4} />
      <circle
        cx={28} cy={28} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 28 28)"
      />
      <text x={28} y={33} textAnchor="middle" fontSize={12} fontWeight={700} fill={color}>{pct}%</text>
    </svg>
  );
}

// ─── Game log mini dots ──────────────────────────────────────────────────────
function GameLogDots({ log }: { log: Array<{ date: string; hits: number; ab: number }> }) {
  return (
    <div className="flex items-center gap-1">
      {log.map((g, i) => (
        <div
          key={i}
          className="rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{
            width: 20, height: 20,
            background: g.hits > 0 ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.12)",
            color: g.hits > 0 ? "#22c55e" : "#f87171",
            border: `1px solid ${g.hits > 0 ? "rgba(34,197,94,0.35)" : "rgba(248,113,113,0.25)"}`,
          }}
        >
          {g.hits > 0 ? g.hits : "0"}
        </div>
      ))}
      {log.length === 0 && <span className="text-[10px] text-muted-foreground">No log</span>}
    </div>
  );
}

// ─── Stat chip ───────────────────────────────────────────────────────────────
function Chip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-lg px-2 py-1 text-center"
      style={{
        background: highlight ? "rgba(250,204,21,0.12)" : "rgba(19,35,58,0.05)",
        border: `1px solid ${highlight ? "rgba(250,204,21,0.35)" : "rgba(19,35,58,0.10)"}`,
      }}
    >
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-xs font-bold text-foreground" style={highlight ? { color: "#b8930a" } : {}}>{value}</p>
    </div>
  );
}

// ─── Pick card ───────────────────────────────────────────────────────────────
function PickCard({ pick, rank }: { pick: any; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const isBest = rank === 1;

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        background: isBest ? "rgba(250,204,21,0.06)" : "#fff",
        borderColor: isBest ? "rgba(250,204,21,0.45)" : "rgba(19,35,58,0.10)",
        boxShadow: isBest ? "0 0 20px rgba(250,204,21,0.15)" : "0 1px 4px rgba(19,35,58,0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Rank badge */}
        <div
          className="rounded-full w-7 h-7 flex items-center justify-center text-[11px] font-black flex-shrink-0"
          style={{
            background: isBest ? "#facc15" : rank <= 3 ? "rgba(250,204,21,0.15)" : "rgba(19,35,58,0.07)",
            color: isBest ? "#1a1a1a" : rank <= 3 ? "#b8930a" : "var(--muted-foreground)",
          }}
        >
          #{rank}
        </div>

        {/* Name + team */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-sm text-foreground truncate">{pick.name}</p>
            {isBest && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#facc15", color: "#1a1a1a" }}>
                🏆 BEST PICK
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {pick.team} · Slot #{pick.lineupSlot} · Bats {pick.bats}
          </p>
        </div>

        {/* Probability ring */}
        <ProbRing pct={pick.hitProbability} />
      </div>

      {/* Matchup strip */}
      <div className="px-4 pb-2 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
        <span>vs <span className="font-semibold text-foreground">{pick.opponentPitcher?.name ?? "TBD"}</span></span>
        <span className="opacity-40">·</span>
        <span>{pick.game.matchup?.split(" @ ")[1] ?? pick.game.venue}</span>
        <span className="opacity-40">·</span>
        <span>{pick.game.gameTime}</span>
        {pick.game.total && (
          <>
            <span className="opacity-40">·</span>
            <span
              className="font-bold"
              style={{ color: pick.game.total >= 9.5 ? "#22c55e" : "inherit" }}
            >
              O/U {pick.game.total}
            </span>
          </>
        )}
        {pick.game.weather?.tempF > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{pick.game.weather.tempF}°F {pick.game.weather.wind}</span>
          </>
        )}
      </div>

      {/* Quick stat row */}
      <div className="px-4 pb-3 grid grid-cols-4 gap-1.5">
        <Chip label="14d BA" value={fmtAvg(pick.stats?.avg14)} highlight={(pick.stats?.avg14 ?? 0) >= 0.280} />
        <Chip label="GHP" value={fmtPct(pick.stats?.ghp14)} highlight={(pick.stats?.ghp14 ?? 0) >= 0.70} />
        <Chip label="K%" value={fmtPct(pick.stats?.kPct)} />
        <Chip label="xBA" value={fmtAvg(pick.stats?.xba)} highlight={(pick.stats?.xba ?? 0) >= 0.300} />
      </div>

      {/* Rationale */}
      {pick.rationale && (
        <div
          className="mx-4 mb-3 rounded-xl px-3 py-2 text-[11px] text-muted-foreground leading-relaxed"
          style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}
        >
          {pick.rationale}
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground border-t"
        style={{ borderColor: "rgba(19,35,58,0.08)", background: "rgba(19,35,58,0.02)" }}
      >
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? "Less detail" : "Full breakdown"}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
          {/* Full stat grid */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Full Stats</p>
            <div className="grid grid-cols-3 gap-1.5">
              <Chip label="7d BA" value={fmtAvg(pick.stats?.avg7)} />
              <Chip label="30d BA" value={fmtAvg(pick.stats?.avg30)} />
              <Chip label="Season BA" value={fmtAvg(pick.stats?.avgSeason)} />
              <Chip label="xwOBA" value={pick.stats?.xwoba ? ("." + Math.round(pick.stats.xwoba * 1000).toString().padStart(3, "0")) : "—"} />
              <Chip label="Hard Hit%" value={pick.stats?.hardHitPct ? pick.stats.hardHitPct.toFixed(0) + "%" : "—"} />
              <Chip label="BB%" value={fmtPct(pick.stats?.bbPct)} />
            </div>
          </div>

          {/* Pitcher splits */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Pitcher vs {pick.bats === "L" ? "LHB" : "RHB"}</p>
            <p className="text-xs">
              <span className="font-bold text-foreground">{pick.opponentPitcher?.name ?? "TBD"}</span> allows{" "}
              <span
                className="font-black"
                style={{ color: pick.pitcherAvgAllowed >= 0.280 ? "#22c55e" : pick.pitcherAvgAllowed >= 0.260 ? "#facc15" : "#f87171" }}
              >
                {fmtAvg(pick.pitcherAvgAllowed)}
              </span>
              {" "}BA vs {pick.bats === "L" ? "left-handed" : "right-handed"} batters
            </p>
          </div>

          {/* Game log */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Last {pick.gamelog?.length ?? 0} games
            </p>
            <GameLogDots log={pick.gamelog ?? []} />
          </div>

          {/* Score breakdown */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Scoring Model</p>
            <div className="space-y-1">
              {[
                { label: "Recent Form", w: 0.20 },
                { label: "Season Consistency", w: 0.20 },
                { label: "Statcast Quality", w: 0.20 },
                { label: "Matchup & External", w: 0.20 },
                { label: "Market Confluence", w: 0.20 },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-2 text-[11px]">
                  <span className="w-36 text-muted-foreground">{c.label}</span>
                  <span className="text-muted-foreground">{(c.w * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Raw: {(pick.rawScore * 100).toFixed(1)} → Prob = min(75%, raw × 133.3%)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Slate card ──────────────────────────────────────────────────────────────
function SlateCard({ game }: { game: any }) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 flex items-center gap-3"
      style={{
        background: game.meetsFilter ? "rgba(34,197,94,0.06)" : "rgba(19,35,58,0.04)",
        border: `1px solid ${game.meetsFilter ? "rgba(34,197,94,0.25)" : "rgba(19,35,58,0.10)"}`,
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-foreground truncate">{game.matchup}</p>
        <p className="text-[10px] text-muted-foreground truncate">{game.venue} · {game.gameTime}</p>
        {game.weather?.tempF > 0 && (
          <p className="text-[10px] text-muted-foreground">{game.weather.tempF}°F · {game.weather.wind || "calm"}</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p
          className="text-sm font-black"
          style={{ color: game.total >= 9.5 ? "#22c55e" : game.total >= 8.5 ? "#facc15" : "var(--muted-foreground)" }}
        >
          {game.total > 0 ? `O/U ${game.total}` : "—"}
        </p>
        {game.meetsFilter && (
          <p className="text-[9px] font-bold" style={{ color: "#22c55e" }}>✓ QUALIFIES</p>
        )}
      </div>
    </div>
  );
}

// ─── Main BTS page ───────────────────────────────────────────────────────────
export default function BTS() {
  const [showAllSlate, setShowAllSlate] = useState(false);
  const [showAllPicks, setShowAllPicks] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["/api/bts-picks", today],
    queryFn: () => apiRequest("GET", `/api/bts-picks?date=${today}`).then(r => r.json()),
    staleTime: 15 * 60_000, // 15 min cache
    refetchInterval: 30 * 60_000, // refresh every 30 min
  });

  const slate: any[] = data?.slate ?? [];
  const picks: any[] = data?.picks ?? [];
  const bestPick = data?.bestPick;
  const doubleDowns: any[] = data?.doubleDowns ?? [];
  const visibleSlate = showAllSlate ? slate : slate.slice(0, 5);
  const visiblePicks = showAllPicks ? picks : picks.slice(0, 5);

  return (
    <div className="flex flex-col gap-4 p-4 pb-28 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Trophy size={20} style={{ color: "#facc15" }} />
            <h1 className="text-xl font-black text-foreground">Beat the Streak</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Top MLB hitters most likely to get a hit today
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border"
          style={{ background: "rgba(19,35,58,0.04)", borderColor: "rgba(19,35,58,0.12)" }}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Updated at */}
      {dataUpdatedAt > 0 && (
        <p className="text-[10px] text-muted-foreground -mt-2">
          Updated {new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
          {data?.dataLimited > 0 && <span className="ml-2 text-amber-500">⚠ {data.dataLimited} games missing probable pitcher</span>}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3 animate-pulse">
          {[1,2,3].map(i => (
            <div key={i} className="h-28 rounded-2xl" style={{ background: "rgba(19,35,58,0.06)" }} />
          ))}
        </div>
      )}

      {/* Error / no games */}
      {!isLoading && data?.error && (
        <div className="rounded-2xl p-6 text-center" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.20)" }}>
          <AlertCircle size={28} className="mx-auto mb-2" style={{ color: "#f87171" }} />
          <p className="font-bold text-foreground">{data.error}</p>
          <p className="text-xs text-muted-foreground mt-1">Check back closer to first pitch.</p>
        </div>
      )}

      {/* KPI strip */}
      {!isLoading && picks.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: <Trophy size={14} style={{ color: "#facc15" }} />, label: "Best Pick", value: bestPick ? `${bestPick.hitProbability}%` : "—" },
            { icon: <Target size={14} style={{ color: "#22c55e" }} />, label: "Qualifiers", value: picks.length.toString() },
            { icon: <TrendingUp size={14} style={{ color: "#60a5fa" }} />, label: "Avg Prob", value: picks.length ? `${Math.round(picks.reduce((s,p) => s + p.hitProbability, 0) / picks.length)}%` : "—" },
          ].map(k => (
            <div
              key={k.label}
              className="rounded-xl p-2.5 text-center"
              style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}
            >
              <div className="flex justify-center mb-1">{k.icon}</div>
              <p className="text-base font-black text-foreground">{k.value}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Today's Slate */}
      {!isLoading && slate.length > 0 && (
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-2">
            Today's Slate ({slate.length} games)
          </p>
          <div className="space-y-1.5">
            {visibleSlate.map((g, i) => <SlateCard key={i} game={g} />)}
          </div>
          {slate.length > 5 && (
            <button
              onClick={() => setShowAllSlate(s => !s)}
              className="w-full mt-2 text-[11px] font-bold text-muted-foreground py-2"
            >
              {showAllSlate ? "Show less" : `Show all ${slate.length} games`}
            </button>
          )}
        </div>
      )}

      {/* Top Picks */}
      {!isLoading && picks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Flame size={15} style={{ color: "#f87171" }} />
            <p className="text-sm font-black text-foreground">Ranked BTS Picks</p>
            <span
              className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
            >
              {picks.length} players
            </span>
          </div>

          <div className="space-y-3">
            {visiblePicks.map((pick, i) => (
              <PickCard key={pick.playerId} pick={pick} rank={i + 1} />
            ))}
          </div>

          {picks.length > 5 && (
            <button
              onClick={() => setShowAllPicks(s => !s)}
              className="w-full mt-2 text-[11px] font-bold text-muted-foreground py-2"
            >
              {showAllPicks ? "Show top 5 only" : `Show all ${picks.length} picks`}
            </button>
          )}
        </div>
      )}

      {/* Double-downs callout */}
      {!isLoading && doubleDowns.length > 0 && (
        <div
          className="rounded-2xl p-4"
          style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.20)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} style={{ color: "#60a5fa" }} />
            <p className="text-xs font-black text-foreground">Strong Double-Downs</p>
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">
            Independent games, next-highest probabilities — good for BTS double picks.
          </p>
          <div className="space-y-1">
            {doubleDowns.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">{p.name}</span>
                <span className="text-muted-foreground">{p.team} · {p.game.matchup?.split(" @ ")[1]}</span>
                <span className="font-black" style={{ color: "#60a5fa" }}>{p.hitProbability}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !data?.error && picks.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.10)" }}>
          <Trophy size={32} className="mx-auto mb-3" style={{ color: "#facc15", opacity: 0.5 }} />
          <p className="font-bold text-foreground">No qualifying picks yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            Lineups usually post 2–3 hours before first pitch. Picks may also be limited if game totals are low today.
          </p>
        </div>
      )}

      {/* Caveats */}
      <div
        className="rounded-xl p-3 text-[10px] text-muted-foreground leading-relaxed"
        style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.08)" }}
      >
        <p className="font-bold text-foreground text-[11px] mb-1">⚠ Before you play</p>
        Confirm lineups and late scratches at game time. Monitor weather and wind shifts. Even a 70% edge fails ~3 times in 10 — baseball variance is real. Data limited to free sources (MLB Stats API, Baseball Savant, ESPN odds). Lineups may not be confirmed until 60–90 min before first pitch.
      </div>
    </div>
  );
}
