import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useHashLocation, navigate as wouterNavigate } from "wouter/use-hash-location";
import ShareCard from "@/components/ShareCard";
import { useAuth } from "@/context/AuthContext";
import { ChevronDown, ChevronUp, Trophy, Target, TrendingUp, AlertCircle, RefreshCw, Flame, Zap, Clock, CheckCircle, AlertTriangle, BookOpen, XCircle, HelpCircle, BarChart2, X, RotateCcw, Swords, Crown, Search } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtAvg(v: number | null | undefined) {
  if (!v) return "—";
  return "." + Math.round(v * 1000).toString().padStart(3, "0");
}
function fmtPct(v: number | null | undefined) {
  if (!v && v !== 0) return "—";
  return (v * 100).toFixed(0) + "%";
}

// ─── Grade badge ─────────────────────────────────────────────────────
function GradeBadge({ result, hits, ab }: { result?: string; hits?: number | null; ab?: number | null }) {
  if (!result || result === "pending") {
    // Game is live and player has at-bats — show pulsing LIVE stat
    const hasLiveAb = ab != null && ab > 0;
    const hasHit    = hits != null && hits > 0;
    if (hasLiveAb || hasHit) {
      // Player is mid-game
      return (
        <span
          className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-1"
          style={{
            background: hasHit ? "rgba(34,197,94,0.12)" : "rgba(251,146,60,0.10)",
            color:      hasHit ? "#16a34a"               : "#f97316",
            border:     `1px solid ${hasHit ? "rgba(34,197,94,0.30)" : "rgba(251,146,60,0.30)"}`,
          }}
        >
          {/* Pulsing live dot */}
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: hasHit ? "#22c55e" : "#f97316",
            animation: "bts-pulse 1.4s ease-in-out infinite" }} />
          LIVE {hits ?? 0}-for-{ab}
        </span>
      );
    }
    // No AB yet — waiting for game to start or player hasn't batted
    return (
      <span
        className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
        style={{ background: "rgba(148,163,184,0.12)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.25)" }}
      >
        <HelpCircle size={8} /> PENDING
      </span>
    );
  }
  if (result === "win") {
    return (
      <span
        className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
        style={{ background: "rgba(34,197,94,0.15)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.35)" }}
      >
        <CheckCircle size={8} /> HIT {hits != null && ab != null ? String(hits) + "-for-" + String(ab) : ""}
      </span>
    );
  }
  if (result === "loss") {
    return (
      <span
        className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
        style={{ background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.30)" }}
      >
        <XCircle size={8} /> 0-for-{ab ?? "?"}
      </span>
    );
  }
  return null;
}

// ─── Score ring ─────────────────────────────────────────────────────────────
function ProbRing({ pct: rawPct }: { pct: number }) {
  // Guard: if pct is a strict decimal like 0.82, convert to whole number 82
  // Integers (1, 2, 82, 100) are already correct — only non-integer < 2 is a decimal
  const pct = rawPct != null
    ? (rawPct > 0 && rawPct < 2 && !Number.isInteger(rawPct)
        ? Math.round(rawPct * 100)
        : Math.round(rawPct))
    : 0;
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
function PickCard({ pick, rank, isOwner, onRemove }: { pick: any; rank: number; isOwner?: boolean; onRemove?: (playerId: number, name: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [removing, setRemoving] = useState(false);
  const isBest = rank === 1;
  // Owner can scratch a player any time the result is still pending (even after lock time)
  // This is specifically for handling non-starters, injuries, lineup scratches
  const canRemove = isOwner && (!pick.result || pick.result === "pending");

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        background: pick.result === "win" ? "rgba(34,197,94,0.04)" : pick.result === "loss" ? "rgba(248,113,113,0.04)" : isBest ? "rgba(250,204,21,0.06)" : "#fff",
        borderColor: pick.result === "win" ? "rgba(34,197,94,0.30)" : pick.result === "loss" ? "rgba(248,113,113,0.22)" : isBest ? "rgba(250,204,21,0.45)" : "rgba(19,35,58,0.10)",
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
            {/* Lineup source badge */}
            {pick.lineupSource === "confirmed" ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
                <CheckCircle size={9} /> Confirmed
              </span>
            ) : pick.lineupSource === "projected" ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: "rgba(250,204,21,0.12)", color: "#b8930a" }}>
                <Clock size={9} /> Projected
              </span>
            ) : null}
            {/* Lock badge */}
            {pick.locked ? (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.25)" }}>
                🔒 Locked
              </span>
            ) : pick.minsToGame != null && pick.minsToGame <= 90 && pick.minsToGame > 30 ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: "rgba(251,146,60,0.10)", color: "#f97316", border: "1px solid rgba(251,146,60,0.25)" }}>
                <Clock size={9} /> Locks in {pick.minsToGame}m
              </span>
            ) : null}
            {/* Grade result badge */}
            <GradeBadge result={pick.result} hits={pick.hits} ab={pick.ab} />
          </div>
          {/* Scratch warning — only shows if pick itself is scratched (not yet swapped) */}
          {pick.isScratched && !pick.swapReason && (
            <div className="flex items-center gap-1 mt-0.5 text-[10px] font-bold" style={{ color: "#f87171" }}>
              <AlertTriangle size={10} />
              ⚠️ Not in confirmed lineup — could not find a confirmed replacement
            </div>
          )}
          {/* Swap-in indicator — shows when a scratched player was auto-replaced */}
          {pick.swapReason === "scratched_from_lineup" && (
            <div className="flex items-center gap-1 mt-0.5 text-[10px] font-bold" style={{ color: "#22c55e" }}>
              <CheckCircle size={10} />
              ✅ Auto-swapped in — {pick.swappedFrom} was scratched from lineup
            </div>
          )}
          {/* Override badge — player failed normal gates but extreme metrics qualified */}
          {pick.isOverridePick && (
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: "rgba(251,146,60,0.12)", color: "#f97316", border: "1px solid rgba(251,146,60,0.30)" }}
              >
                <AlertTriangle size={8} /> STATCAST OVERRIDE — verify before using
              </span>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {pick.team} · Slot #{pick.lineupSlot} · Bats {pick.bats}
          </p>
        </div>

        {/* Probability ring + owner remove button */}
        <div className="flex flex-col items-center gap-1.5">
          <ProbRing pct={pick.hitProbability} />
          {canRemove && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm(`Remove ${pick.name} from today's BTS picks?\n\nBTS will find a replacement on the next refresh.`)) return;
                setRemoving(true);
                try {
                  const r = await fetch("/api/bts/remove-player", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId: pick.playerId, name: pick.name }),
                  });
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error);
                  onRemove?.(pick.playerId, pick.name);
                } catch (err: any) {
                  alert("Remove failed: " + err.message);
                  setRemoving(false);
                }
              }}
              disabled={removing}
              title="Remove player & find replacement"
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-opacity"
              style={{
                background: "rgba(239,68,68,0.10)",
                border: "1px solid rgba(239,68,68,0.30)",
                color: removing ? "#fca5a5" : "#ef4444",
                opacity: removing ? 0.6 : 1,
                cursor: removing ? "default" : "pointer",
              }}
            >
              <X size={9} />{removing ? "Removing…" : "Scratch"}
            </button>
          )}
        </div>
      </div>

      {/* Matchup strip */}
      <div className="px-4 pb-2 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
        <span>vs <span className="font-semibold text-foreground">{pick.opponentPitcher?.name ?? "TBD"}</span></span>
        <span className="opacity-40">·</span>
        {pick.game && <><span>{pick.game.matchup?.split(" @ ")[1] ?? pick.game.venue}</span><span className="opacity-40">·</span><span>{pick.game.gameTime}</span></> }
        {pick.game?.total && (
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
        {pick.game?.weather?.tempF > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{pick.game.weather.tempF}°F {pick.game.weather.wind}</span>
          </>
        )}
      </div>

      {/* Quick stat row — hitter */}
      <div className="px-4 pb-1.5 grid grid-cols-4 gap-1.5">
        <Chip label="14d BA" value={fmtAvg(pick.stats?.avg14)} highlight={(pick.stats?.avg14 ?? 0) >= 0.280} />
        <Chip label="GHP" value={fmtPct(pick.stats?.ghp14)} highlight={(pick.stats?.ghp14 ?? 0) >= 0.70} />
        <Chip label="K%" value={fmtPct(pick.stats?.kPct)} />
        <Chip label="xBA" value={fmtAvg(pick.stats?.xba)} highlight={(pick.stats?.xba ?? 0) >= 0.300} />
      </div>

      {/* Pitcher matchup summary strip */}
      <div className="px-4 pb-3">
        <div
          className="rounded-xl px-3 py-2 flex items-start gap-2"
          style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}
        >
          {/* Label */}
          <span className="text-[9px] font-black uppercase tracking-wider mt-0.5 flex-shrink-0" style={{ color: "#3D4B58" }}>⚾ P</span>
          <div className="flex-1 min-w-0">
            {/* Pitcher name + BA allowed */}
            <p className="text-[11px] font-semibold text-foreground leading-tight truncate">
              {pick.opponentPitcher?.name ?? "TBD"}
              {pick.pitcherAvgAllowed ? (
                <span
                  className="ml-1.5 font-black"
                  style={{ color: pick.pitcherAvgAllowed >= 0.280 ? "#22c55e" : pick.pitcherAvgAllowed >= 0.260 ? "#facc15" : "#f87171" }}
                >
                  {fmtAvg(pick.pitcherAvgAllowed)} vs {pick.bats === "L" ? "LHB" : "RHB"}
                </span>
              ) : null}
            </p>
            {/* ERA / xBA / K9 inline */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {pick.pitcherStats?.era != null && (
                <span className="text-[10px] text-muted-foreground">
                  ERA{" "}
                  <span
                    className="font-bold"
                    style={{ color: pick.pitcherStats.era <= 3.50 ? "#f87171" : pick.pitcherStats.era <= 4.50 ? "#facc15" : "#22c55e" }}
                  >
                    {pick.pitcherStats.era.toFixed(2)}
                  </span>
                </span>
              )}
              {pick.pitcherStats?.xba != null && (
                <span className="text-[10px] text-muted-foreground">
                  xBA{" "}
                  <span
                    className="font-bold"
                    style={{ color: pick.pitcherStats.xba >= 0.290 ? "#22c55e" : pick.pitcherStats.xba >= 0.260 ? "#facc15" : "#f87171" }}
                  >
                    {fmtAvg(pick.pitcherStats.xba)}
                  </span>
                </span>
              )}
              {pick.pitcherStats?.k9 != null && (
                <span className="text-[10px] text-muted-foreground">
                  K/9{" "}
                  <span
                    className="font-bold"
                    style={{ color: pick.pitcherStats.k9 >= 9.0 ? "#f87171" : pick.pitcherStats.k9 >= 7.0 ? "#facc15" : "#22c55e" }}
                  >
                    {pick.pitcherStats.k9.toFixed(1)}
                  </span>
                </span>
              )}
              {pick.pitcherStats?.whip != null && (
                <span className="text-[10px] text-muted-foreground">
                  WHIP{" "}
                  <span
                    className="font-bold"
                    style={{ color: pick.pitcherStats.whip <= 1.10 ? "#f87171" : pick.pitcherStats.whip <= 1.30 ? "#facc15" : "#22c55e" }}
                  >
                    {pick.pitcherStats.whip.toFixed(2)}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rationale */}
      {pick.rationale && (
        <div
          className="mx-4 mb-3 rounded-xl px-3 py-2.5 space-y-1.5"
          style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}
        >
          {pick.rationale.split("\n").map((line: string, idx: number) => {
            if (idx === 0) {
              // Opening sentence
              return (
                <p key={idx} className="text-[11px] font-semibold text-foreground leading-snug">
                  {line}
                </p>
              );
            }
            // Bullet lines — strip the leading bullet char, render bold **text** inline
            const text = line.replace(/^[•\-] /, "");
            const parts = text.split(/(\*\*[^*]+\*\*)/g);
            return (
              <p key={idx} className="text-[10px] text-muted-foreground leading-snug flex items-start gap-1">
                <span className="mt-0.5 flex-shrink-0" style={{ color: "#facc15" }}>•</span>
                <span>
                  {parts.map((part, pi) =>
                    part.startsWith("**") && part.endsWith("**") ? (
                      <strong key={pi} className="text-foreground font-bold">{part.slice(2, -2)}</strong>
                    ) : (
                      <span key={pi}>{part}</span>
                    )
                  )}
                </span>
              </p>
            );
          })}
        </div>
      )}

      {/* Action row: expand + share */}
      <div className="flex border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 px-4 py-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground"
          style={{ background: "rgba(19,35,58,0.02)" }}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "Less" : "Full breakdown"}
        </button>
        <div style={{ width: 1, background: "rgba(19,35,58,0.08)" }} />
        <button
          onClick={() => {
            // Navigate to Player Intel pre-loaded with this player's name
            // Use wouter's navigate so path and search are split correctly
            const name = encodeURIComponent(pick.name ?? "");
            wouterNavigate(`/intel?q=${name}&sport=MLB`);
          }}
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-[11px] font-semibold"
          style={{ background: "rgba(19,35,58,0.02)", color: "#60a5fa" }}
          title="Open in Player Intel"
        >
          <Search size={12} />
          Intel
        </button>
        <div style={{ width: 1, background: "rgba(19,35,58,0.08)" }} />
        <button
          onClick={() => setShowShare(true)}
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-[11px] font-semibold"
          style={{ background: "rgba(19,35,58,0.02)", color: "#b8930a" }}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><circle cx={18} cy={5} r={3}/><circle cx={6} cy={12} r={3}/><circle cx={18} cy={19} r={3}/><line x1={8.59} y1={13.51} x2={15.42} y2={17.49}/><line x1={15.41} y1={6.51} x2={8.59} y2={10.49}/></svg>
          Share
        </button>
      </div>
      {showShare && <ShareCard type="bts" data={pick} onClose={() => setShowShare(false)} />}

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

          {/* Pitcher matchup — full detail */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">⚾ Pitcher Matchup</p>
            <p className="text-xs mb-2">
              <span className="font-bold text-foreground">{pick.opponentPitcher?.name ?? "TBD"}</span> allows{" "}
              <span
                className="font-black"
                style={{ color: pick.pitcherAvgAllowed >= 0.280 ? "#22c55e" : pick.pitcherAvgAllowed >= 0.260 ? "#facc15" : "#f87171" }}
              >
                {fmtAvg(pick.pitcherAvgAllowed)}
              </span>
              {" "}BA vs {pick.bats === "L" ? "left-handed" : "right-handed"} batters
            </p>
            {/* Pitcher stat chips */}
            <div className="grid grid-cols-3 gap-1.5">
              {pick.pitcherStats?.era != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">ERA</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.era <= 3.50 ? "#f87171" : pick.pitcherStats.era <= 4.50 ? "#facc15" : "#22c55e" }}>
                    {pick.pitcherStats.era.toFixed(2)}
                  </p>
                </div>
              )}
              {pick.pitcherStats?.xba != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">xBA Allowed</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.xba >= 0.290 ? "#22c55e" : pick.pitcherStats.xba >= 0.260 ? "#facc15" : "#f87171" }}>
                    {fmtAvg(pick.pitcherStats.xba)}
                  </p>
                </div>
              )}
              {pick.pitcherStats?.k9 != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">K/9</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.k9 >= 9.0 ? "#f87171" : pick.pitcherStats.k9 >= 7.0 ? "#facc15" : "#22c55e" }}>
                    {pick.pitcherStats.k9.toFixed(1)}
                  </p>
                </div>
              )}
              {pick.pitcherStats?.whip != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">WHIP</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.whip <= 1.10 ? "#f87171" : pick.pitcherStats.whip <= 1.30 ? "#facc15" : "#22c55e" }}>
                    {pick.pitcherStats.whip.toFixed(2)}
                  </p>
                </div>
              )}
              {pick.pitcherStats?.xwoba != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">xwOBA</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.xwoba >= 0.350 ? "#22c55e" : pick.pitcherStats.xwoba >= 0.310 ? "#facc15" : "#f87171" }}>
                    {pick.pitcherStats.xwoba.toFixed(3)}
                  </p>
                </div>
              )}
              {pick.pitcherStats?.hardHitPct != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Hard Hit%</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.hardHitPct >= 42 ? "#22c55e" : pick.pitcherStats.hardHitPct >= 35 ? "#facc15" : "#f87171" }}>
                    {pick.pitcherStats.hardHitPct.toFixed(0)}%
                  </p>
                </div>
              )}
            </div>
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
                { label: "Recent Form (13%)", w: 0.13 },
                { label: "Contact Quality (19%)", w: 0.19 },
                { label: "Hard Contact (10%)", w: 0.10 },
                { label: "Pitcher Matchup (24%)", w: 0.24 },
                { label: "Opportunity (20%)", w: 0.20 },
                { label: "BvP History (5%)", w: 0.05 },
                { label: "Stability (9%)", w: 0.09 },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-2 text-[11px]">
                  <span className="flex-1 text-muted-foreground">{c.label}</span>
                  <div className="h-1.5 rounded-full flex-shrink-0" style={{ width: Math.round(c.w * 120), background: "rgba(212,168,67,0.50)" }} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <p className="text-[10px] text-muted-foreground">
                Base score: {(pick.rawScore * 100).toFixed(1)} → Logistic → {pick.hitProbability}%
              </p>
              {pick.analyticsBoost != null && pick.analyticsBoost !== 1 && (
                <p className="text-[10px] font-bold" style={{ color: pick.analyticsBoost > 1 ? "#22c55e" : "#f87171" }}>
                  Analytics: {pick.analyticsBoost > 1 ? "+" : ""}{((pick.analyticsBoost - 1) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>

          {/* MLB Analytics Layer */}
          {(pick.analyticsNote || pick.steamerProjection || pick.projectedGameStats) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">📊 Analytics Context</p>

              {/* Analytics note */}
              {pick.analyticsNote && (
                <p className="text-[11px] font-semibold mb-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(19,35,58,0.05)", color: "var(--foreground)" }}>
                  {pick.analyticsNote}
                </p>
              )}

              {/* Steamer projections */}
              {pick.steamerProjection && (
                <div className="mb-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Season Projection (Steamer)</p>
                  <div className="grid grid-cols-4 gap-1">
                    {pick.steamerProjection.projAVG > 0 && (
                      <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                        <p className="text-[9px] text-muted-foreground uppercase font-semibold">AVG</p>
                        <p className="text-xs font-black" style={{ color: pick.steamerProjection.projAVG >= 0.280 ? "#22c55e" : pick.steamerProjection.projAVG >= 0.250 ? "#facc15" : "#f87171" }}>
                          .{Math.round(pick.steamerProjection.projAVG * 1000).toString().padStart(3, "0")}
                        </p>
                      </div>
                    )}
                    {pick.steamerProjection.projOBP > 0 && (
                      <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                        <p className="text-[9px] text-muted-foreground uppercase font-semibold">OBP</p>
                        <p className="text-xs font-black">.{Math.round(pick.steamerProjection.projOBP * 1000).toString().padStart(3, "0")}</p>
                      </div>
                    )}
                    {pick.steamerProjection.projwOBA > 0 && (
                      <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                        <p className="text-[9px] text-muted-foreground uppercase font-semibold">wOBA</p>
                        <p className="text-xs font-black" style={{ color: pick.steamerProjection.projwOBA >= 0.360 ? "#22c55e" : pick.steamerProjection.projwOBA >= 0.320 ? "#facc15" : "#f87171" }}>
                          .{Math.round(pick.steamerProjection.projwOBA * 1000).toString().padStart(3, "0")}
                        </p>
                      </div>
                    )}
                    {pick.steamerProjection.wrcPlus > 0 && (
                      <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                        <p className="text-[9px] text-muted-foreground uppercase font-semibold">wRC+</p>
                        <p className="text-xs font-black" style={{ color: pick.steamerProjection.wrcPlus >= 120 ? "#22c55e" : pick.steamerProjection.wrcPlus >= 100 ? "#facc15" : "#f87171" }}>
                          {Math.round(pick.steamerProjection.wrcPlus)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Projected per-game stats */}
              {pick.projectedGameStats && pick.projectedGameStats.projH > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Proj Per-Game (Park + Pitcher Adj)</p>
                  <div className="grid grid-cols-4 gap-1">
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">H/G</p>
                      <p className="text-xs font-black" style={{ color: pick.projectedGameStats.parkAdjProjH >= 1.0 ? "#22c55e" : pick.projectedGameStats.parkAdjProjH >= 0.8 ? "#facc15" : "#f87171" }}>
                        {pick.projectedGameStats.parkAdjProjH.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">HR/G</p>
                      <p className="text-xs font-black">{pick.projectedGameStats.parkAdjProjHR.toFixed(3)}</p>
                    </div>
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">R/G</p>
                      <p className="text-xs font-black">{pick.projectedGameStats.projR.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">RBI/G</p>
                      <p className="text-xs font-black">{pick.projectedGameStats.projRBI.toFixed(2)}</p>
                    </div>
                  </div>
                  {pick.projectedGameStats.note && (
                    <p className="text-[9px] text-muted-foreground mt-1">{pick.projectedGameStats.note}</p>
                  )}
                </div>
              )}
            </div>
          )}
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
// ─── How to Read Panel ──────────────────────────────────────────────────
const BTS_GLOSSARY = [
  {
    term: "Hit Prob %",
    label: "Hit Probability",
    emoji: "🔵",
    def: "The model's calibrated probability that this player records at least 1 hit today. Built from 9 scoring components across form, contact quality, matchup, bullpen, ballpark, and more. Aim for picks ≥ 65%.",
  },
  {
    term: "Hit Streak",
    label: "Active Hit Streak",
    emoji: "🔥",
    def: "Consecutive games with at least 1 hit, counted from today backward. A player on a 5+ game streak gets a meaningful form boost. 3-game = +3%, 5-game = +6%, 7-game = +9%, 10+ game = +12%.",
  },
  {
    term: "GHP",
    label: "Games with Hit %",
    emoji: "💥",
    def: "% of the last 14 games where a player recorded at least 1 hit. GHP ≥ 70% = elite consistency. Works alongside the active hit streak to capture both sustained form and current momentum.",
  },
  {
    term: "14d BA",
    label: "14-Day Batting Average",
    emoji: "📅",
    def: "Rolling batting average over the last 14 days — the primary form indicator. ≥ .280 = hot, ≥ .250 = solid, < .230 = cold streak. BABIP luck is automatically detected: if recent BABIP far exceeds expected BABIP AND contact quality is poor, the average is regressed toward xBA.",
  },
  {
    term: "Day/Night Split",
    label: "Day vs Night Performance",
    emoji: "🌙",
    def: "Many hitters perform 20–40 points of BA differently in day vs night games. The model uses the player's actual day or night split AVG (min 30 PA) to adjust the form score based on today's game time.",
  },
  {
    term: "xBA",
    label: "Expected Batting Average",
    emoji: "📊",
    def: "Statcast's predicted BA based on exit velocity and launch angle. xBA ≥ .300 signals the player is hitting the ball well even if surface stats haven't caught up. Blended across season, last-30d, and last-15d windows.",
  },
  {
    term: "xwOBA",
    label: "Expected Weighted On-Base",
    emoji: "🎯",
    def: "Quality-of-contact metric weighting hits by run value. High xwOBA (≥ .360) = hard, well-placed contact. Blended across season/30d/15d Statcast windows. One of the strongest predictors of future hit rate.",
  },
  {
    term: "Zone Contact %",
    label: "In-Zone Contact Rate",
    emoji: "🎯",
    def: "How often a batter makes contact on pitches inside the strike zone. ≥ 85% = elite contact skill. Paired with Out-of-Zone Contact % to get a full picture of plate discipline.",
  },
  {
    term: "OZ Contact %",
    label: "Out-of-Zone Contact Rate",
    emoji: "🪄",
    def: "How often a batter makes contact on pitches outside the strike zone. High oz_contact (≥ 70%) = protects the plate well and sprays hits on tough pitches. Combined with zone contact for overall contact profile.",
  },
  {
    term: "Hard Hit %",
    label: "Hard Hit Rate",
    emoji: "🔨",
    def: "% of batted balls at 95+ mph exit velocity. ≥ 40% = consistently barreling the ball. Used to guard against false BABIP regression — if Hard Hit % is high, a hot streak is likely real, not luck.",
  },
  {
    term: "Sprint Speed",
    label: "Running Speed (ft/sec)",
    emoji: "⚡",
    def: "Savant sprint speed in feet per second. Fast runners (≥ 28.0 ft/sec) beat out more infield hits, directly raising their BABIP floor. ≥ 29.5 ft/sec = +8% contact boost. ≤ 26.5 ft/sec = -3% penalty.",
  },
  {
    term: "BvP",
    label: "Batter vs Pitcher",
    emoji: "⚔️",
    def: "Career stats vs today's specific starter. Tiered: Elite = .500+ AVG or .400+ AVG with .950+ OPS (≥10 AB) → 18% weight. Strong = .350+ AVG (10+ AB) → 12% weight. Good BvP can vault a .250 hitter above a star with a poor matchup.",
  },
  {
    term: "Platoon Adv",
    label: "Platoon Advantage",
    emoji: "↔️",
    def: "LHB vs RHP and RHB vs LHP historically produce higher BA. The model weights the pitcher's actual platoon split toward league average at low sample sizes (< 100 PA) and trusts the real split fully at 100+ PA — preventing small-sample extremes from over-influencing picks.",
  },
  {
    term: "Bullpen ERA",
    label: "Opposing Bullpen Quality",
    emoji: "🚒",
    def: "The opposing team's bullpen ERA this season. ~30% of plate appearances in any game are against relievers. A weak bullpen (ERA > 4.60) gives top-order hitters 1–2 extra favorable PAs. Weighted at 8% inside the matchup component.",
  },
  {
    term: "TTO",
    label: "Times Through Order",
    emoji: "🔄",
    def: "How many times the lineup has faced the starter. Hitters improve significantly the 3rd time through the order. Bottom-of-order hitters vs a high-leash starter get a +6% bonus. Top-of-order vs a short-leash starter get +4% (they see soft relievers sooner).",
  },
  {
    term: "Venue Splits",
    label: "Career Park Performance",
    emoji: "🏟️",
    def: "Career AVG/SLG/ISO at today's specific ballpark over the last 5 seasons (min 20 AB). Blended 60% AVG, 25% SLG, 15% ISO. A player who consistently hits well at a given park gets a meaningful boost, regardless of league-average park factors.",
  },
  {
    term: "✓ Confirmed",
    label: "Lineup Confirmed",
    emoji: "✅",
    def: "The player has been officially posted in today's batting order. Confirmed picks carry no lineup risk.",
  },
  {
    term: "PROJ",
    label: "Projected Lineup",
    emoji: "📡",
    def: "Not yet officially listed but projected based on typical batting slot. Gets swapped automatically if missing from the confirmed lineup when it posts.",
  },
  {
    term: "11:45 AM CT",
    label: "Daily Pick Deadline",
    emoji: "⏰",
    def: "Picks are finalized by 11:45 AM CT. After this, picks can still be added up to 30 min before game time but cannot be removed for the day. Scratched players are auto-swapped with the best available confirmed starter.",
  },
  {
    term: "STATCAST OVERRIDE",
    label: "Override Pick",
    emoji: "⚠️",
    def: "Player passed on elite Statcast profile despite cold surface stats: 30+ batted balls, 15+ recent PA, and 4 of 6 signals firing (xBA ≥ .310, HH% ≥ 46%, barrel% ≥ 9%, GHP ≥ 70%, good matchup, whiff% ≤ 22%). Higher variance — verify before locking.",
  },
];

// ── Module-level color constants (shared across all BTS sub-components) ──────
const BG_COLOR   = "#F6F1E7";
const NAVY_COLOR = "#13233A";
const GOLD_COLOR = "#D4A843";
const MUTED      = "#3D4B58";
const NAVY       = NAVY_COLOR;

// ─────────────────────────────────────────────────────────────────────────────
// BTS ANALYTICS PANEL — Historical splits and performance data
// ─────────────────────────────────────────────────────────────────────────────
function WinBar({ pct, total }: { pct: number | null; total: number }) {
  if (pct === null || total === 0) return <span className="text-[10px]" style={{ color: MUTED }}>—</span>;
  const color = pct >= 75 ? "#22c55e" : pct >= 65 ? "#84cc16" : pct >= 55 ? "#eab308" : "#ef4444";
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.10)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-black w-8 text-right" style={{ color }}>{pct}%</span>
      <span className="text-[10px] w-10 text-right" style={{ color: MUTED }}>({total})</span>
    </div>
  );
}

function SplitSection({ title, rows }: { title: string; rows: { label: string; wins: number; total: number; pct: number | null }[] }) {
  const filtered = rows.filter(r => r.total > 0);
  if (!filtered.length) return null;
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: MUTED }}>{title}</p>
      <div className="space-y-1.5">
        {filtered.map(row => (
          <div key={row.label} className="flex items-center gap-3">
            <p className="text-[11px] font-semibold text-foreground w-20 flex-shrink-0">{row.label}</p>
            <WinBar pct={row.pct} total={row.total} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BtsAnalyticsPanel() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/bts-analytics"],
    enabled: open,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const totalW = (data?.byDate ?? []).reduce((s: number, d: any) => s + (d.wins ?? 0), 0);
  const totalL = (data?.byDate ?? []).reduce((s: number, d: any) => s + (d.losses ?? 0), 0);
  const overallPct = (totalW + totalL) > 0 ? Math.round(totalW / (totalW + totalL) * 100) : null;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "rgba(19,35,58,0.03)", borderColor: "rgba(19,35,58,0.12)" }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={15} style={{ color: "#22c55e" }} />
          <p className="text-sm font-bold text-foreground">Pick Analytics</p>
          <span
            className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
          >
            SPLITS
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data && overallPct !== null && (
            <span className="text-[11px] font-black" style={{ color: "#22c55e" }}>{overallPct}% overall</span>
          )}
          {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t space-y-5" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
          {isLoading ? (
            <div className="py-6 text-center text-xs" style={{ color: MUTED }}>Loading analytics…</div>
          ) : error ? (
            <div className="py-6 text-center text-xs" style={{ color: "#ef4444" }}>
              Failed to load analytics. Try closing and reopening.
            </div>
          ) : !data ? (
            <div className="py-6 text-center text-xs" style={{ color: MUTED }}>No data yet.</div>
          ) : (
            <>
              {/* Overall summary */}
              <div className="pt-3 grid grid-cols-3 gap-2">
                {[
                  { label: "Total Picks", value: String(totalW + totalL), color: NAVY },
                  { label: "Overall Win %", value: overallPct !== null ? `${overallPct}%` : "—", color: (overallPct ?? 0) >= 70 ? "#22c55e" : "#eab308" },
                  { label: "Best Day", value: (() => { try { const best = [...(data?.byDow ?? [])].sort((a: any, b: any) => (b.pct ?? 0) - (a.pct ?? 0))[0]; return best ? `${best.label.slice(0,3)} ${best.pct}%` : "—"; } catch { return "—"; } })(), color: "#3b82f6" },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-2.5 text-center"
                    style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.08)" }}>
                    <p className="text-base font-black" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-semibold mt-0.5" style={{ color: MUTED }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Day of week */}
              <SplitSection title="Win % by Day of Week" rows={data.byDow ?? []} />

              {/* Day vs Night */}
              {(data.byDay ?? []).length > 0 && (
                <SplitSection title="Day vs Night Games" rows={data.byDay ?? []} />
              )}

              {/* Home vs Away */}
              {(data.bySide ?? []).filter((r: any) => r.total > 0).length > 0 && (
                <SplitSection title="Home vs Away" rows={data.bySide ?? []} />
              )}

              {/* Lineup slot */}
              <SplitSection title="Win % by Lineup Slot" rows={(data.bySlot ?? []).filter((r: any) => r.total > 0)} />

              {/* BvP signal */}
              <SplitSection title="Win % by BvP Signal" rows={(data.byBvp ?? []).map((r: any) => ({
                ...r,
                label: r.label === "elite" ? "Elite BvP" : r.label === "strong" ? "Strong BvP" : "No BvP",
              }))} />

              {/* Handedness */}
              <SplitSection title="Win % by Batter Handedness" rows={data.byBats ?? []} />

              {/* Confidence tier */}
              {(data.byTier ?? []).filter((r: any) => r.total > 0).length > 0 && (
                <SplitSection title="Win % by Confidence Tier" rows={(data.byTier ?? []).map((r: any) => ({ ...r, label: `Tier ${r.label}` }))} />
              )}

              {/* Hit probability bands */}
              {(data.byProb ?? []).filter((r: any) => r.total > 0).length > 0 && (
                <SplitSection title="Win % by Hit Probability" rows={data.byProb ?? []} />
              )}

              {/* Per-day history */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: MUTED }}>Daily Record (most recent first)</p>
                <div className="space-y-1">
                  {(data.byDate ?? []).slice(0, 21).map((d: any) => {
                    const color = d.pct >= 75 ? "#22c55e" : d.pct >= 60 ? "#eab308" : "#ef4444";
                    return (
                      <div key={d.date} className="flex items-center gap-3">
                        <p className="text-[10px] font-semibold text-foreground w-20 flex-shrink-0">{d.date.slice(5)}</p>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.10)" }}>
                          <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: color }} />
                        </div>
                        <p className="text-[10px] font-black w-8 text-right" style={{ color }}>{d.pct}%</p>
                        <p className="text-[10px] w-14 text-right" style={{ color: MUTED }}>{d.wins}W-{d.losses}L</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HowToReadBTS() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "rgba(19,35,58,0.03)", borderColor: "rgba(19,35,58,0.12)" }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={15} style={{ color: "#60a5fa" }} />
          <p className="text-sm font-bold text-foreground">How to Read BTS Picks</p>
          <span
            className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}
          >
            GLOSSARY
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
          <p className="text-[10px] text-muted-foreground pt-3 leading-relaxed">
            Beat the Streak picks are ranked by hit probability. Here's what every stat and badge means:
          </p>
          <div className="space-y-2.5">
            {BTS_GLOSSARY.map(g => (
              <div
                key={g.term}
                className="rounded-xl p-3"
                style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none flex-shrink-0">{g.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-black text-foreground">{g.term}</p>
                      <p className="text-[10px] text-muted-foreground">— {g.label}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{g.def}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Scoring model visual */}
          <div
            className="rounded-xl p-3 mt-1"
            style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.20)" }}
          >
            <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: "#b8930a" }}>Scoring Model Weights</p>
            <div className="space-y-1.5">
              {[
                { label: "Pitcher Matchup", desc: "Starter + bullpen + TTO + park × weather", pct: 25, color: "#ef4444" },
                { label: "Opportunity", desc: "Lineup slot + leash prob + home/away split", pct: 18, color: "#f97316" },
                { label: "Contact Quality", desc: "xBA + xwOBA + zCon + ozCon + sprint + K%", pct: 16, color: "#eab308" },
                { label: "Recent Form", desc: "L7/L14 BA + hit streak + day/night split", pct: 15, color: "#22c55e" },
                { label: "BvP + Vs-Team", desc: "Career vs starter (6–18% based on tier)", pct: 12, color: "#3b82f6" },
                { label: "Hard Contact", desc: "Hard Hit % + barrel % + launch angle", pct: 8, color: "#8b5cf6" },
                { label: "Venue History", desc: "Career AVG/SLG/ISO at this ballpark", pct: 5, color: "#06b6d4" },
                { label: "Stability Anchor", desc: "Prevents score runaway — slot × GHP14", pct: 5, color: "#64748b" },
                { label: "Batted-Ball Profile", desc: "GB/FB hitter vs pitcher groundball %", pct: 3, color: "#94a3b8" },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: (row as any).color ?? "#facc15" }} />
                  <p className="text-[11px] font-semibold text-foreground w-36 flex-shrink-0">{row.label}</p>
                  <p className="text-[10px] text-muted-foreground flex-1">{row.desc}</p>
                  <p className="text-[10px] font-black" style={{ color: (row as any).color ?? "#b8930a" }}>{row.pct}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUBHOUSE IQ AUTO-STREAK PANEL
// ─────────────────────────────────────────────────────────────────────────────
function CiqStreakPanel() {
  const [open, setOpen] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/bts/ciq-streak"],
    // Refresh every 30s while games may be live (daytime), otherwise every 3 min
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const resetCiqMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bts/reset-ciq-today").then(r => r.json()),
    onSuccess: (result: any) => {
      setResetMsg(result.message ?? "CIQ pick reset.");
      queryClient.invalidateQueries({ queryKey: ["/api/bts/ciq-streak"] });
      setTimeout(() => setResetMsg(null), 6000);
    },
    onError: () => {
      setResetMsg("Reset failed — try again.");
      setTimeout(() => setResetMsg(null), 4000);
    },
  });
  const d = data as any;

  const current   = d?.currentStreak ?? 0;
  const best      = d?.bestStreak ?? 0;
  const goal      = d?.goal ?? 57;
  const today     = d?.today;
  const history: any[] = d?.history ?? [];
  const totalDays = d?.totalDays ?? 0;
  const totalWins = d?.totalWins ?? 0;
  const pct       = totalDays > 0 ? Math.round((totalWins / totalDays) * 100) : null;
  const progress  = Math.min(100, Math.round((current / (goal - 1)) * 100));

  const BG    = BG_COLOR;
  // NAVY, MUTED defined at module level
  const GOLD  = GOLD_COLOR;
  const GREEN = "#16a34a";
  const RED   = "#ef4444";

  function DayResult({ entry }: { entry: any }) {
    const won  = entry.result === "win";
    const lost = entry.result === "loss";
    return (
      <div
        className="rounded-xl p-3"
        style={{
          background: won ? "rgba(22,163,74,0.06)" : lost ? "rgba(239,68,68,0.06)" : "rgba(19,35,58,0.03)",
          border: `1px solid ${won ? "rgba(22,163,74,0.2)" : lost ? "rgba(239,68,68,0.2)" : "rgba(19,35,58,0.08)"}`,
        }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold" style={{ color: MUTED }}>{entry.date}</span>
            {entry.isDouble && (
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(212,168,67,0.15)", color: GOLD }}>DOUBLE</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {entry.result === "pending" ? (
              // Check if any pick has live AB data
              entry.picks?.some((p: any) => p.ab != null && p.ab > 0) ? (
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: "rgba(251,146,60,0.10)", color: "#f97316", border: "1px solid rgba(251,146,60,0.30)" }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                    background: "#f97316", animation: "bts-pulse 1.4s ease-in-out infinite" }} />
                  LIVE
                </span>
              ) : (
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(148,163,184,0.12)", color: "#94a3b8" }}>PENDING</span>
              )
            ) : won ? (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "rgba(22,163,74,0.15)", color: GREEN }}>
                <CheckCircle size={8} /> WIN +{entry.picks.length}
              </span>
            ) : (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "rgba(239,68,68,0.12)", color: RED }}>
                <XCircle size={8} /> LOSS → RESET
              </span>
            )}
            {entry.streakAfter != null && (
              <span className="text-[9px] font-bold" style={{ color: MUTED }}>streak: {entry.streakAfter}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {entry.picks.map((p: any, i: number) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black flex-shrink-0"
                  style={{ background: NAVY, color: BG }}>{i + 1}</span>
                <span className="text-[11px] font-bold" style={{ color: NAVY }}>{p.name}</span>
                <span className="text-[9px]" style={{ color: MUTED }}>{p.team}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold" style={{ color: GOLD }}>{p.score}%</span>
                <GradeBadge result={p.result} hits={p.hits} ab={p.ab} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: `2px solid ${GOLD}40`, background: "rgba(212,168,67,0.04)" }}
    >
      {/* Header — always visible */}
      <button
        className="w-full flex items-center justify-between p-4"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: NAVY }}>
            <Swords size={16} style={{ color: GOLD }} />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-black" style={{ color: NAVY }}>Clubhouse IQ Streak</p>
              {current >= 5 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(212,168,67,0.15)", color: GOLD }}>
                  🔥 ON FIRE
                </span>
              )}
            </div>
            <p className="text-[10px]" style={{ color: MUTED }}>
              CIQ is playing Beat the Streak — goal: 57 consecutive hits
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Current streak number */}
          <div className="text-right">
            <div className="text-2xl font-black" style={{ color: current > 0 ? GOLD : MUTED }}>{current}</div>
            <div className="text-[9px] font-bold" style={{ color: MUTED }}>streak</div>
          </div>
          {open ? <ChevronUp size={16} style={{ color: MUTED }} /> : <ChevronDown size={16} style={{ color: MUTED }} />}
        </div>
      </button>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-bold" style={{ color: MUTED }}>Progress to 57</span>
          <span className="text-[9px] font-bold" style={{ color: GOLD }}>{current} / {goal - 1}</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(19,35,58,0.08)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${GOLD}, #f59e0b)` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-4">
        {[
          { label: "Best Streak", value: best, color: GOLD },
          { label: "Day Win %", value: pct != null ? `${pct}%` : "—", color: GREEN },
          { label: "Days Played", value: totalDays, color: NAVY },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-2.5 text-center"
            style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.08)" }}>
            <div className="text-base font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] font-medium" style={{ color: MUTED }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Expandable section */}
      {open && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(19,35,58,0.08)" }}>
          {/* Today's pick */}
          <div className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Today's CIQ Pick</p>
              {isOwner && (
                <button
                  onClick={() => {
                    if (!confirm("Reset today's CIQ pick and repick the best available player?")) return;
                    resetCiqMutation.mutate();
                  }}
                  disabled={resetCiqMutation.isPending}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                  style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.20)" }}
                  title="Reset today's CIQ pick"
                >
                  <RotateCcw size={10} className={resetCiqMutation.isPending ? "animate-spin" : ""} />
                  Reset & Repick
                </button>
              )}
            </div>
            {resetMsg && (
              <div className="rounded-xl p-2 mb-2 text-[11px] font-medium text-center"
                style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.20)" }}>
                {resetMsg}
              </div>
            )}
            {isLoading ? (
              <div className="rounded-xl p-3 text-center text-xs" style={{ color: MUTED }}>Loading…</div>
            ) : today ? (
              <DayResult entry={today} />
            ) : (
              <div className="rounded-xl p-3 text-center text-xs" style={{ color: MUTED, border: "1px dashed rgba(19,35,58,0.15)" }}>
                No pick yet — will auto-select once BTS picks are available today.
              </div>
            )}
          </div>

          {/* History */}
          {history.length > 1 && (
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide mb-2" style={{ color: MUTED }}>Pick History</p>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {history.filter(e => e.date !== today?.date).map((entry: any) => (
                  <DayResult key={entry.date} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BTS() {
  const [showAllSlate, setShowAllSlate] = useState(false);
  const [showAllPicks, setShowAllPicks] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [reanalyzeMsg, setReanalyzeMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { isOwner } = useAuth();

  const reanalyzeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bts/reanalyze").then(r => r.json()),
    onSuccess: (result: any) => {
      setReanalyzeMsg(result.message ?? "Reanalysis complete.");
      // Invalidate + refetch so fresh picks load immediately
      queryClient.invalidateQueries({ queryKey: ["/api/bts-picks", today] });
      refetch();
      setTimeout(() => setReanalyzeMsg(null), 7000);
    },
    onError: () => {
      setReanalyzeMsg("Reanalyze failed — check server logs.");
      setTimeout(() => setReanalyzeMsg(null), 5000);
    },
  });

  // Compute today's date in Central Time so late-night hours (after midnight UTC
  // but before midnight CT) don't roll over to tomorrow's date.
  const ctToday = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  // toLocaleString returns "MM/DD/YYYY" — reformat to YYYY-MM-DD
  const [ctMonth, ctDay, ctYear] = ctToday.split("/");
  const today = `${ctYear}-${ctMonth}-${ctDay}`;

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["/api/bts-picks", today],
    queryFn: () => apiRequest("GET", `/api/bts-picks`).then(r => r.json()),
    staleTime: 0,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Lightweight live-stats poll — updates hits/ab/result every 30s without
  // triggering a full heavy bts-picks refetch. Merges into picks data.
  const [liveStats, setLiveStats] = useState<Record<number, { hits: number | null; ab: number | null; result: string }>>({});
  useEffect(() => {
    async function fetchLiveStats() {
      try {
        const r = await apiRequest("GET", "/api/bts/live-stats");
        const d = await r.json();
        const map: Record<number, any> = {};
        for (const p of d.picks ?? []) map[p.playerId] = { hits: p.hits, ab: p.ab, result: p.result };
        setLiveStats(map);
      } catch { /* non-fatal */ }
    }
    fetchLiveStats();
    const id = setInterval(fetchLiveStats, 30_000);
    return () => clearInterval(id);
  }, []);

  // Historical picks — loaded once, refreshed every 5 min
  const { data: historyData } = useQuery({
    queryKey: ["/api/bts-history"],
    queryFn: () => apiRequest("GET", `/api/bts-history`).then(r => r.json()),
    refetchOnMount: true,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const slate: any[] = data?.slate ?? [];
  const picks: any[] = data?.picks ?? [];
  const bestPick = data?.bestPick;
  const doubleDowns: any[] = data?.doubleDowns ?? [];
  const todayRecord = data?.todayRecord ?? { wins: 0, losses: 0, pending: 0, winPct: null };
  const seasonRecord = data?.seasonRecord ?? { wins: 0, losses: 0, winPct: null };
  const visibleSlate = showAllSlate ? slate : slate.slice(0, 5);
  // Merge live stats into picks so badges update every 30s without full refetch
  const picksWithLive = picks.map((p: any) => {
    const live = liveStats[p.playerId];
    if (!live) return p;
    return {
      ...p,
      hits:   live.hits   ?? p.hits,
      ab:     live.ab     ?? p.ab,
      result: live.result ?? p.result,
    };
  });
  const visiblePicks = showAllPicks ? picksWithLive : picksWithLive.slice(0, 5);

  // History data — use history endpoint as source of truth for records
  const historyDays: any[]       = historyData?.days ?? [];
  const histSeasonRecord: any    = historyData?.seasonRecord ?? data?.seasonRecord ?? seasonRecord;
  const histYesterdayRecord: any = historyData?.yesterdayRecord ?? null;
  // Merge today's current picks into history if not yet graded
  const hasNoPicks = !isLoading && picks.length === 0;

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
        <div className="flex items-center gap-2">
          {/* Reanalyze — owner only */}
          {isOwner && (
            <button
              onClick={() => {
                if (!window.confirm(
                  "Remove all pre-game pending picks and re-run analysis?\n\nPicks where the game is in-progress or already finished will be kept."
                )) return;
                reanalyzeMutation.mutate();
              }}
              disabled={reanalyzeMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border active:scale-95 transition-transform"
              style={{
                background: reanalyzeMutation.isPending ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.08)",
                borderColor: "rgba(239,68,68,0.25)",
                color: "#dc2626",
                opacity: reanalyzeMutation.isPending ? 0.7 : 1,
              }}
            >
              <RotateCcw size={12} className={reanalyzeMutation.isPending ? "animate-spin" : ""} />
              {reanalyzeMutation.isPending ? "Running…" : "Reanalyze"}
            </button>
          )}
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/bts-picks", today] });
              refetch();
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border active:scale-95 transition-transform"
            style={{ background: "rgba(19,35,58,0.04)", borderColor: "rgba(19,35,58,0.12)" }}
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
            {isLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Reanalyze result banner */}
      {reanalyzeMsg && (
        <div
          className="rounded-xl px-3 py-2.5 flex items-center gap-2"
          style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.22)" }}
        >
          <RotateCcw size={13} style={{ color: "#dc2626", flexShrink: 0 }} />
          <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>{reanalyzeMsg}</p>
          <button className="ml-auto" onClick={() => setReanalyzeMsg(null)}><X size={12} style={{ color: "#dc2626" }} /></button>
        </div>
      )}
      {/* Spacer to prevent double </div> */}
      <span style={{ display: "none" }} />

      {/* Updated at */}
      {dataUpdatedAt > 0 && (
        <p className="text-[10px] text-muted-foreground -mt-2">
          Updated {new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
          {data?.dataLimited > 0 && <span className="ml-2 text-amber-500">⚠ {data.dataLimited} games missing probable pitcher</span>}
        </p>
      )}

      {/* Deadline / lineup status banner */}
      {!isLoading && data && (
        data.pastDeadline ? (
          <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
            <CheckCircle size={14} style={{ color: "#22c55e", flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-xs font-bold" style={{ color: "#16a34a" }}>Past 11:45 AM CT — picks are locked in</p>
              <p className="text-[10px] text-muted-foreground">
                {data.confirmedCount} confirmed · {data.projectedCount} projected{data.scratchedCount > 0 ? ` · ⚠️ ${data.scratchedCount} scratched` : ""}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "#16a34a" }}>Later games can still have picks added until 30 min before first pitch — all picks stay on the card until day is complete.</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: "rgba(250,204,21,0.07)", border: "1px solid rgba(250,204,21,0.25)" }}>
            <Clock size={14} style={{ color: "#b8930a", flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-xs font-bold" style={{ color: "#b8930a" }}>Picks update until 11:45 AM CT</p>
              <p className="text-[10px] text-muted-foreground">
                {data.confirmedCount > 0 ? `${data.confirmedCount} confirmed` : "No confirmed lineups yet"}{data.projectedCount > 0 ? ` · ${data.projectedCount} projected` : ""}
                {" · Picks refresh as lineups post"}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "#b8930a" }}>After 11:45 AM CT picks lock in. Later games can still add picks up to 30 min before first pitch. Scratched players are auto-swapped with the best confirmed starter from the same team before game time.</p>
            </div>
          </div>
        )
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

      {/* KPI strip — always visible when data loaded */}
      {!isLoading && data && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: <Trophy size={14} style={{ color: "#facc15" }} />, label: "Best Pick", value: bestPick ? `${bestPick.hitProbability}%` : "—" },
            { icon: <Target size={14} style={{ color: "#22c55e" }} />, label: "Picks Today", value: `${picks.length} / 10` },
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

      {/* Record strip — always visible; shows yesterday + season even when no picks yet */}
      {(data || historyData) && (
        <button
          onClick={() => setShowHistory(true)}
          className="w-full rounded-2xl p-3 text-left active:scale-[0.99] transition-transform"
          style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.10)" }}
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* Today record — or yesterday if no picks today yet */}
            <div className="flex items-center gap-2">
              <BarChart2 size={14} style={{ color: "#60a5fa" }} />
              <div>
                {hasNoPicks && histYesterdayRecord ? (
                  <>
                    <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">Yesterday</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-sm font-black" style={{ color: "#22c55e" }}>{histYesterdayRecord.wins}W</span>
                      <span className="text-xs text-muted-foreground">/</span>
                      <span className="text-sm font-black" style={{ color: "#f87171" }}>{histYesterdayRecord.losses}L</span>
                      {histYesterdayRecord.winPct != null && (
                        <span
                          className="text-[10px] font-black px-1.5 py-0.5 rounded-full ml-1"
                          style={{
                            background: histYesterdayRecord.winPct >= 60 ? "rgba(34,197,94,0.12)" : histYesterdayRecord.winPct >= 40 ? "rgba(250,204,21,0.12)" : "rgba(248,113,113,0.10)",
                            color: histYesterdayRecord.winPct >= 60 ? "#16a34a" : histYesterdayRecord.winPct >= 40 ? "#b8930a" : "#f87171",
                          }}
                        >
                          {histYesterdayRecord.winPct}%
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">Today</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-sm font-black" style={{ color: "#22c55e" }}>{todayRecord.wins}W</span>
                      <span className="text-xs text-muted-foreground">/</span>
                      <span className="text-sm font-black" style={{ color: "#f87171" }}>{todayRecord.losses}L</span>
                      {todayRecord.pending > 0 && (
                        <span className="text-xs text-muted-foreground">· {todayRecord.pending} pending</span>
                      )}
                      {todayRecord.winPct != null && (
                        <span
                          className="text-[10px] font-black px-1.5 py-0.5 rounded-full ml-1"
                          style={{
                            background: todayRecord.winPct >= 60 ? "rgba(34,197,94,0.12)" : todayRecord.winPct >= 40 ? "rgba(250,204,21,0.12)" : "rgba(248,113,113,0.10)",
                            color: todayRecord.winPct >= 60 ? "#16a34a" : todayRecord.winPct >= 40 ? "#b8930a" : "#f87171",
                          }}
                        >
                          {todayRecord.winPct}%
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="w-px h-8 hidden sm:block" style={{ background: "rgba(19,35,58,0.12)" }} />

            {/* Season record — uses history endpoint as source of truth */}
            <div className="flex items-center gap-2">
              <TrendingUp size={14} style={{ color: "#22c55e" }} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">Season Record</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-sm font-black" style={{ color: "#22c55e" }}>{histSeasonRecord.wins}W</span>
                  <span className="text-xs text-muted-foreground">/</span>
                  <span className="text-sm font-black" style={{ color: "#f87171" }}>{histSeasonRecord.losses}L</span>
                  {histSeasonRecord.winPct != null ? (
                    <span
                      className="text-[10px] font-black px-1.5 py-0.5 rounded-full ml-1"
                      style={{
                        background: histSeasonRecord.winPct >= 60 ? "rgba(34,197,94,0.12)" : histSeasonRecord.winPct >= 40 ? "rgba(250,204,21,0.12)" : "rgba(248,113,113,0.10)",
                        color: histSeasonRecord.winPct >= 60 ? "#16a34a" : histSeasonRecord.winPct >= 40 ? "#b8930a" : "#f87171",
                      }}
                    >
                      {histSeasonRecord.winPct}% win
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground ml-1">no graded picks yet</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tap hint */}
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
              <ChevronUp size={12} />
              <span>View picks</span>
            </div>
          </div>
        </button>
      )}

      {/* ── History drawer ── */}
      {showHistory && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ touchAction: "none" }}
          onClick={() => setShowHistory(false)}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} />
          <div
            className="relative w-full max-w-lg rounded-t-3xl flex flex-col"
            style={{
              background: "#F6F1E7",
              border: "1px solid rgba(19,35,58,0.12)",
              maxHeight: "min(88dvh, 88vh)",
              height: "min(88dvh, 88vh)",
              overflow: "hidden",
              touchAction: "auto",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag pill */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full" style={{ width: 36, height: 4, background: "rgba(19,35,58,0.18)" }} />

            {/* Sticky header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 pt-6 pb-3 border-b" style={{ borderColor: "rgba(19,35,58,0.10)" }}>
              <div>
                <p className="text-base font-black text-foreground">Pick History</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {historyDays.length} days · {histSeasonRecord.wins}W–{histSeasonRecord.losses}L season
                  {histSeasonRecord.winPct != null && ` · ${histSeasonRecord.winPct}% win rate`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Season badge */}
                {histSeasonRecord.winPct != null && (
                  <div className="text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Season</p>
                    <p
                      className="text-sm font-black"
                      style={{ color: histSeasonRecord.winPct >= 60 ? "#16a34a" : histSeasonRecord.winPct >= 40 ? "#b8930a" : "#f87171" }}
                    >
                      {histSeasonRecord.winPct}%
                    </p>
                  </div>
                )}
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1.5 rounded-xl"
                  style={{ color: "#94a3b8", background: "rgba(19,35,58,0.06)" }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Scrollable pick list — grouped by date, newest first */}
            <div
              className="flex-1 px-4 py-3"
              style={{
                overflowY: "scroll",
                WebkitOverflowScrolling: "touch" as any,
                overscrollBehavior: "contain",
                touchAction: "pan-y",
                minHeight: 0,
              }}
            >
              {historyDays.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No historical picks recorded yet.</p>
              )}
              {historyDays.map((day: any) => {
                const dayWins    = day.wins    as number;
                const dayLosses  = day.losses  as number;
                const dayPending = day.pending as number;
                const dayWinPct  = day.winPct  as number | null;
                const dayPicks   = day.picks   as any[];
                return (
                  <div key={day.date} className="mb-5">
                    {/* Day header */}
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                        {new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold" style={{ color: "#22c55e" }}>{dayWins}W</span>
                        <span className="text-[10px] text-muted-foreground">/</span>
                        <span className="text-[10px] font-bold" style={{ color: "#f87171" }}>{dayLosses}L</span>
                        {dayPending > 0 && <span className="text-[10px] text-muted-foreground">· {dayPending} pend</span>}
                        {dayWinPct != null && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1"
                            style={{
                              background: dayWinPct >= 60 ? "rgba(34,197,94,0.12)" : dayWinPct >= 40 ? "rgba(250,204,21,0.12)" : "rgba(248,113,113,0.10)",
                              color: dayWinPct >= 60 ? "#16a34a" : dayWinPct >= 40 ? "#b8930a" : "#f87171",
                            }}>
                            {dayWinPct}%
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Picks for this day */}
                    <div className="space-y-2">
                      {dayPicks.map((pick: any, i: number) => {
                        const isWin     = pick.result === "win";
                        const isLoss    = pick.result === "loss";
                        const isPending = !pick.result || pick.result === "pending";
                        return (
                          <div
                            key={pick.playerId ?? i}
                            className="rounded-2xl p-3 flex items-start gap-3"
                            style={{
                              background: isWin ? "rgba(34,197,94,0.06)" : isLoss ? "rgba(248,113,113,0.05)" : "rgba(19,35,58,0.04)",
                              border: `1px solid ${isWin ? "rgba(34,197,94,0.28)" : isLoss ? "rgba(248,113,113,0.22)" : "rgba(19,35,58,0.10)"}`,
                            }}
                          >
                            <div
                              className="rounded-full w-7 h-7 flex items-center justify-center text-[11px] font-black flex-shrink-0 mt-0.5"
                              style={{ background: "rgba(19,35,58,0.07)", color: "var(--muted-foreground)" }}
                            >
                              #{i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-black text-sm text-foreground">{pick.name}</p>
                                <GradeBadge result={pick.result} hits={pick.hits} ab={pick.ab} />
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {pick.team} · {pick.hitProbability}% prob
                                {pick.hits != null && pick.ab != null && (
                                  <span className="ml-1 font-bold" style={{ color: isWin ? "#22c55e" : "#f87171" }}>
                                    · {pick.hits}-for-{pick.ab}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex-shrink-0 mt-0.5">
                              {isWin  && <CheckCircle size={20} style={{ color: "#22c55e" }} />}
                              {isLoss && <XCircle    size={20} style={{ color: "#f87171" }} />}
                              {isPending && <HelpCircle size={20} style={{ color: "#94a3b8" }} />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Safe area spacer */}
              <div style={{ height: "max(env(safe-area-inset-bottom, 0px), 24px)" }} />
            </div>
          </div>
        </div>
      )}
      {/* Pick Analytics */}
      <BtsAnalyticsPanel />

      {/* How to Read Glossary */}
      <HowToReadBTS />

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
      {!isLoading && (picks.length > 0 || data) && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Flame size={15} style={{ color: "#f87171" }} />
            <p className="text-sm font-black text-foreground">Ranked BTS Picks</p>
            <span
              className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: picks.length > 0 ? "rgba(34,197,94,0.15)" : "rgba(19,35,58,0.08)", color: picks.length > 0 ? "#22c55e" : "#8A9BB0" }}
            >
              {picks.length} / 10
            </span>
          </div>

          <div className="space-y-3">
            {/* Real picks — capped at 5 initially, 10 when expanded */}
            {visiblePicks.map((pick, i) => (
              <PickCard
                key={pick.playerId}
                pick={pick}
                rank={i + 1}
                isOwner={isOwner}
                onRemove={(_playerId, _name) => {
                  // Immediately invalidate so the list refetches and finds a replacement
                  queryClient.invalidateQueries({ queryKey: ["/api/bts-picks"] });
                }}
              />
            ))}

            {/* Empty slots for remaining spots up to the visible limit */}
            {Array.from({ length: Math.max(0, (showAllPicks ? 10 : Math.min(5, picks.length + (10 - picks.length))) - visiblePicks.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: "rgba(19,35,58,0.02)", border: "1px dashed rgba(19,35,58,0.12)" }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(19,35,58,0.06)" }}>
                  <span className="text-[10px] font-black" style={{ color: "rgba(19,35,58,0.2)" }}>—</span>
                </div>
                <div>
                  <p className="text-xs font-bold" style={{ color: "rgba(19,35,58,0.25)" }}>No player met requirements</p>
                  <p className="text-[10px]" style={{ color: "rgba(19,35,58,0.18)" }}>Slot unfilled — criteria not met by any available player</p>
                </div>
              </div>
            ))}
          </div>

          {/* Show all / collapse toggle — only if there are more than 5 picks OR empty slots beyond 5 */}
          {(picks.length > 5 || (picks.length < 10)) && (
            <button
              onClick={() => setShowAllPicks(s => !s)}
              className="w-full mt-2 text-[11px] font-bold text-muted-foreground py-2"
            >
              {showAllPicks ? "Show top 5 only" : `Show all slots (${picks.length} picks + ${10 - picks.length} empty)`}
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
                <span className="text-muted-foreground">{p.team}{p.game ? ` · ${p.game.matchup?.split(" @ ")[1]}` : ""}</span>
                <span className="font-black" style={{ color: "#60a5fa" }}>{p.hitProbability}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── CLUBHOUSE IQ STREAK ─────────────────────────────────────────── */}
      <CiqStreakPanel />

      {/* Empty state */}
      {!isLoading && !data?.error && picks.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.10)" }}>
          <Trophy size={32} className="mx-auto mb-3" style={{ color: "#facc15", opacity: 0.5 }} />
          <p className="font-bold text-foreground">No players met requirements today</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            All available hitters were filtered out by the eligibility criteria — probability floor, platoon matchup, game total, or stat analysis. Lineups may not be confirmed yet (post 2–3 hrs before first pitch).
          </p>
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl p-3 flex items-center gap-3 mx-auto max-w-xs"
                style={{ background: "rgba(19,35,58,0.02)", border: "1px dashed rgba(19,35,58,0.10)" }}>
                <div className="w-6 h-6 rounded-full flex-shrink-0" style={{ background: "rgba(19,35,58,0.06)" }} />
                <p className="text-[10px] font-bold text-left" style={{ color: "rgba(19,35,58,0.2)" }}>No player met requirements — slot empty</p>
              </div>
            ))}
          </div>
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
