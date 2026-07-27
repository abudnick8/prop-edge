import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useHashLocation, navigate as wouterNavigate } from "wouter/use-hash-location";
import ShareCard from "@/components/ShareCard";
import MlbShareCard from "@/components/MlbShareCard";
import { useAuth } from "@/context/AuthContext";
import { ChevronDown, ChevronUp, Trophy, Target, TrendingUp, AlertCircle, RefreshCw, Flame, Zap, Clock, CheckCircle, AlertTriangle, BookOpen, XCircle, HelpCircle, BarChart2, X, RotateCcw, Swords, Crown, Search, Share2, Star, TrendingDown, Minus, History } from "lucide-react";

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
            {/* Confidence tier badge */}
            {(() => {
              const ct = pick.confidenceTier ?? pick.snapshot?.confidenceTier;
              if (!ct) return null;
              const tierColors: Record<string, { bg: string; text: string; border: string }> = {
                "A+": { bg: "rgba(74,222,128,0.15)",  text: "#16a34a", border: "rgba(74,222,128,0.40)" },
                "A":  { bg: "rgba(250,204,21,0.15)",  text: "#b8930a", border: "rgba(250,204,21,0.40)" },
                "B":  { bg: "rgba(147,197,253,0.15)", text: "#3b82f6", border: "rgba(147,197,253,0.40)" },
                "C":  { bg: "rgba(61,75,88,0.10)",    text: "#3D4B58", border: "rgba(61,75,88,0.25)" },
              };
              const c = tierColors[ct] ?? tierColors["C"];
              return (
                <span
                  className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                >
                  {ct} Tier
                </span>
              );
            })()}
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
          {/* Top 3 model drivers */}
          {pick.topDrivers && pick.topDrivers.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {pick.topDrivers.map((d: any, i: number) => (
                <span key={i} style={{
                  fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                  background: i === 0 ? "rgba(212,168,67,0.15)" : "rgba(19,35,58,0.06)",
                  color: i === 0 ? "#D4A843" : "#3D4B58",
                  border: `1px solid ${i === 0 ? "rgba(212,168,67,0.30)" : "rgba(19,35,58,0.10)"}`,
                }}>
                  {d.icon} {d.name}
                </span>
              ))}
              {pick.expectedPA > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                  background: "rgba(34,197,94,0.08)", color: "#16a34a",
                  border: "1px solid rgba(34,197,94,0.20)",
                }}>
                  ~{pick.expectedPA} PA
                </span>
              )}
            </div>
          )}
        </div>

        {/* Probability ring + Moneyball badge + owner remove button */}
        <div className="flex flex-col items-center gap-1.5">
          <ProbRing pct={pick.hitProbability} />
          {pick.valueOverBaseline !== undefined && pick.valueOverBaseline !== null && (
            <span style={{
              fontSize: 9, fontWeight: 800,
              color: pick.valueOverBaseline >= 3 ? "#16a34a" : pick.valueOverBaseline >= 0 ? "#D4A843" : "#6b7280",
            }}>
              {pick.valueOverBaseline >= 0 ? "+" : ""}{pick.valueOverBaseline}pp vs slate
            </span>
          )}
          {/* Moneyball Grade coin */}
          <MbGradeBadge grade={calcMbGrade(pick)} size="md" />
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
        <div className="px-4 py-3 space-y-4 border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>

          {/* ── 1. Score & probability ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">📊 Score & Probability</p>
            <div className="grid grid-cols-3 gap-1.5">
              <Chip label="Raw Score" value={(pick.rawScore * 100).toFixed(1)} highlight={(pick.rawScore ?? 0) >= 0.58} />
              <Chip label="Hit Prob" value={`${pick.hitProbability}%`} highlight={(pick.hitProbability ?? 0) >= 65} />
              {pick.impliedProb != null && <Chip label="Implied%" value={`${pick.impliedProb}%`} />}
              {pick.edge != null && <Chip label="Edge" value={`${pick.edge > 0 ? "+" : ""}${pick.edge}%`} highlight={(pick.edge ?? 0) >= 5} />}
              <Chip label="Conf Tier" value={pick.confidenceTier ?? "—"} highlight={pick.confidenceTier === "A" || pick.confidenceTier === "A+"} />
              <Chip label="Lineup Slot" value={`#${pick.lineupSlot}`} highlight={(pick.lineupSlot ?? 9) <= 4} />
            </div>
          </div>

          {/* Model Drivers section */}
          {pick.topDrivers && pick.topDrivers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 800, color: "#3D4B58", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Top Model Drivers</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {pick.topDrivers.map((d: any, i: number) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: i === 0 ? "rgba(212,168,67,0.08)" : "rgba(19,35,58,0.03)",
                    border: `1px solid ${i === 0 ? "rgba(212,168,67,0.20)" : "rgba(19,35,58,0.08)"}`,
                    borderRadius: 8, padding: "6px 10px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13 }}>{d.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#131A24" }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#3D4B58" }}>{d.label}</span>
                  </div>
                ))}
              </div>
              {pick.expectedPA > 0 && (
                <p style={{ fontSize: 10, color: "#3D4B58", marginTop: 6 }}>
                  Estimated plate appearances: <strong style={{ color: "#131A24" }}>~{pick.expectedPA}</strong>
                  {pick.valueOverBaseline !== undefined && (
                    <span style={{ marginLeft: 8, color: pick.valueOverBaseline >= 0 ? "#16a34a" : "#6b7280" }}>
                      · {pick.valueOverBaseline >= 0 ? "+" : ""}{pick.valueOverBaseline}pp above slate median ({pick.slateMedian}%)
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* ── 2. Scoring model component bars ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">⚖️ Component Weights</p>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(19,35,58,0.08)" }}>
              {[
                { label: "Pitcher Matchup", w: 0.25, key: "matchup" },
                { label: "Opportunity (slot/leash)", w: 0.18, key: "opportunity" },
                { label: "Contact Quality (xBA/xwOBA)", w: 0.16, key: "contact" },
                { label: "Recent Form", w: 0.15, key: "form" },
                { label: "Hard Contact (HH%/barrel)", w: 0.08, key: "hard" },
                { label: "BvP History", w: 0.06, key: "bvp" },
                { label: "Stability Anchor", w: 0.05, key: "stab" },
                { label: "Platoon Split", w: 0.04, key: "plat" },
                { label: "Venue History", w: 0.04, key: "venue" },
                { label: "Batted-Ball Profile", w: 0.02, key: "bb" },
              ].map((c, i) => (
                <div key={c.key} className="flex items-center gap-2 px-3 py-1.5" style={{ background: i % 2 === 0 ? "rgba(19,35,58,0.02)" : "transparent", borderBottom: i < 9 ? "1px solid rgba(19,35,58,0.05)" : "none" }}>
                  <span className="text-[10px] text-muted-foreground flex-1 min-w-0 truncate">{c.label}</span>
                  <div className="flex-shrink-0 h-1.5 rounded-full" style={{ width: 80, background: "rgba(19,35,58,0.07)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.round(c.w * 400)}%`, maxWidth: "100%", background: "#D4A843" }} />
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground flex-shrink-0 w-8 text-right">{Math.round(c.w * 100)}%</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Raw score: <strong>{(pick.rawScore * 100).toFixed(1)}</strong> → logistic → <strong>{pick.hitProbability}%</strong> hit probability
              {pick.analyticsBoost != null && pick.analyticsBoost !== 1 && (
                <span className="ml-1 font-bold" style={{ color: pick.analyticsBoost > 1 ? "#22c55e" : "#f87171" }}>
                  {" "}· Analytics layer: {pick.analyticsBoost > 1 ? "+" : ""}{((pick.analyticsBoost - 1) * 100).toFixed(1)}%
                </span>
              )}
            </p>
          </div>

          {/* ── 3. Hitter Stats — full ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">🏏 Hitter Stats</p>
            <div className="grid grid-cols-3 gap-1.5">
              <Chip label="7d BA" value={fmtAvg(pick.stats?.avg7)} highlight={(pick.stats?.avg7 ?? 0) >= 0.300} />
              <Chip label="14d BA" value={fmtAvg(pick.stats?.avg14)} highlight={(pick.stats?.avg14 ?? 0) >= 0.280} />
              <Chip label="30d BA" value={fmtAvg(pick.stats?.avg30)} highlight={(pick.stats?.avg30 ?? 0) >= 0.260} />
              <Chip label="Season BA" value={fmtAvg(pick.stats?.avgSeason)} />
              <Chip label="GHP (L14)" value={fmtPct(pick.stats?.ghp14)} highlight={(pick.stats?.ghp14 ?? 0) >= 0.70} />
              <Chip label="Hit Streak" value={pick.stats?.hitStreak ? `${pick.stats.hitStreak}G` : "—"} highlight={(pick.stats?.hitStreak ?? 0) >= 4} />
              <Chip label="xBA" value={fmtAvg(pick.stats?.xba)} highlight={(pick.stats?.xba ?? 0) >= 0.300} />
              <Chip label="xwOBA" value={pick.stats?.xwoba ? ("." + Math.round(pick.stats.xwoba * 1000).toString().padStart(3, "0")) : "—"} highlight={(pick.stats?.xwoba ?? 0) >= 0.350} />
              <Chip label="Hard Hit%" value={pick.stats?.hardHitPct ? pick.stats.hardHitPct.toFixed(0) + "%" : "—"} highlight={(pick.stats?.hardHitPct ?? 0) >= 42} />
              <Chip label="Barrel%" value={pick.stats?.barrelPct ? pick.stats.barrelPct.toFixed(1) + "%" : "—"} highlight={(pick.stats?.barrelPct ?? 0) >= 8} />
              <Chip label="K%" value={fmtPct(pick.stats?.kPct)} />
              <Chip label="BB%" value={fmtPct(pick.stats?.bbPct)} />
              <Chip label="Whiff%" value={pick.stats?.whiffPct ? pick.stats.whiffPct.toFixed(0) + "%" : "—"} />
              <Chip label="Z-Contact%" value={pick.stats?.zContactPct ? pick.stats.zContactPct.toFixed(0) + "%" : "—"} highlight={(pick.stats?.zContactPct ?? 0) >= 85} />
              <Chip label="Launch Angle" value={pick.stats?.launchAngle ? pick.stats.launchAngle.toFixed(1) + "°" : "—"} />
              {pick.stats?.sprintSpeed > 0 && <Chip label="Sprint Spd" value={pick.stats.sprintSpeed.toFixed(1)} highlight={pick.stats.sprintSpeed >= 28} />}
            </div>
            {/* Rolling Statcast trend */}
            {(pick.stats?.xba15d > 0 || pick.stats?.xwoba15d > 0) && (
              <div className="mt-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">📈 Statcast Trend (15d → 30d → Season)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {pick.stats?.xba15d > 0 && (
                    <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                      <p className="text-[9px] text-muted-foreground font-semibold uppercase">xBA trend</p>
                      <p className="text-[11px] font-bold text-foreground">
                        {fmtAvg(pick.stats.xba15d)}
                        {pick.stats?.xba30d > 0 && <span className="text-muted-foreground"> → {fmtAvg(pick.stats.xba30d)}</span>}
                        {pick.stats?.xba > 0 && <span className="text-muted-foreground"> → {fmtAvg(pick.stats.xba)}</span>}
                      </p>
                    </div>
                  )}
                  {pick.stats?.xwoba15d > 0 && (
                    <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                      <p className="text-[9px] text-muted-foreground font-semibold uppercase">xwOBA trend</p>
                      <p className="text-[11px] font-bold text-foreground">
                        .{Math.round((pick.stats.xwoba15d)*1000).toString().padStart(3,"0")}
                        {pick.stats?.xwoba30d > 0 && <span className="text-muted-foreground"> → .{Math.round(pick.stats.xwoba30d*1000).toString().padStart(3,"0")}</span>}
                        {pick.stats?.xwoba > 0 && <span className="text-muted-foreground"> → .{Math.round(pick.stats.xwoba*1000).toString().padStart(3,"0")}</span>}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Home/Away + Day/Night splits */}
            {(pick.stats?.avgHome > 0 || pick.stats?.avgDay > 0) && (
              <div className="mt-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Situation Splits</p>
                <div className="grid grid-cols-4 gap-1">
                  {pick.stats?.avgHome > 0 && <Chip label="vs Home" value={fmtAvg(pick.stats.avgHome)} />}
                  {pick.stats?.avgAway > 0 && <Chip label="vs Away" value={fmtAvg(pick.stats.avgAway)} />}
                  {pick.stats?.avgDay > 0 && <Chip label="Day" value={fmtAvg(pick.stats.avgDay)} />}
                  {pick.stats?.avgNight > 0 && <Chip label="Night" value={fmtAvg(pick.stats.avgNight)} />}
                </div>
              </div>
            )}
            {/* Venue + vs-team career */}
            {(pick.stats?.venueCareerAvg > 0 || pick.stats?.vsTeamAvg > 0) && (
              <div className="mt-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Career at Venue / vs Team</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {pick.stats?.venueCareerAvg > 0 && (
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">Venue AVG</p>
                      <p className="text-xs font-black" style={{ color: (pick.stats.venueCareerAvg ?? 0) >= 0.280 ? "#22c55e" : "#facc15" }}>
                        {fmtAvg(pick.stats.venueCareerAvg)}
                      </p>
                      {pick.stats.venueCareerAB > 0 && <p className="text-[8px] text-muted-foreground">{pick.stats.venueCareerAB} AB</p>}
                    </div>
                  )}
                  {pick.stats?.venueCareerSlg > 0 && (
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">Venue SLG</p>
                      <p className="text-xs font-black">{fmtAvg(pick.stats.venueCareerSlg)}</p>
                    </div>
                  )}
                  {pick.stats?.vsTeamAvg > 0 && (
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">vs Team AVG</p>
                      <p className="text-xs font-black" style={{ color: (pick.stats.vsTeamAvg ?? 0) >= 0.280 ? "#22c55e" : "#facc15" }}>
                        {fmtAvg(pick.stats.vsTeamAvg)}
                      </p>
                      {pick.stats.vsTeamAB > 0 && <p className="text-[8px] text-muted-foreground">{pick.stats.vsTeamAB} AB</p>}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Pitch type matchup score */}
            {pick.stats?.pitchTypeMatchup != null && (
              <div className="mt-1.5 flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                <span className="text-[10px] text-muted-foreground flex-1">Pitch-Type Matchup Score</span>
                <span className="text-[11px] font-black" style={{ color: pick.stats.pitchTypeMatchup >= 60 ? "#22c55e" : pick.stats.pitchTypeMatchup >= 40 ? "#facc15" : "#f87171" }}>
                  {pick.stats.pitchTypeMatchup}/100
                </span>
              </div>
            )}
          </div>

          {/* ── 4. BvP History ── */}
          {pick.bvp && pick.bvp.ab >= 5 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">⚔️ Batter vs Pitcher</p>
              <div className="rounded-xl px-3 py-2.5 flex items-center justify-between" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                <div>
                  <p className="text-xs font-bold text-foreground">{pick.name} vs {pick.opponentPitcher?.name ?? "today's starter"}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {pick.bvp.hits ?? "—"}-for-{pick.bvp.ab} career ({pick.bvp.ab} AB)
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black" style={{
                    color: pick.bvp.signal === "elite" ? "#22c55e" : pick.bvp.signal === "strong" ? "#86efac" : pick.bvp.signal === "weak" ? "#f87171" : "#facc15"
                  }}>
                    {pick.bvp.avg != null ? fmtAvg(pick.bvp.avg) : "—"}
                  </p>
                  <p className="text-[9px] font-black uppercase" style={{
                    color: pick.bvp.signal === "elite" ? "#16a34a" : pick.bvp.signal === "strong" ? "#22c55e" : pick.bvp.signal === "weak" ? "#dc2626" : "#b8930a"
                  }}>
                    {pick.bvp.signal ?? "neutral"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── 5. Pitcher — deep stats ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">⚾ Pitcher Deep Stats</p>
            <p className="text-xs font-bold text-foreground mb-1.5">
              {pick.opponentPitcher?.name ?? "TBD"}
              {pick.pitcherAvgAllowed != null && (
                <span className="ml-1.5 font-black" style={{ color: pick.pitcherAvgAllowed >= 0.280 ? "#22c55e" : pick.pitcherAvgAllowed >= 0.260 ? "#facc15" : "#f87171" }}>
                  {fmtAvg(pick.pitcherAvgAllowed)} vs {pick.bats === "L" ? "LHB" : "RHB"}
                </span>
              )}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {pick.pitcherStats?.era != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Season ERA</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.era <= 3.50 ? "#f87171" : pick.pitcherStats.era <= 4.50 ? "#facc15" : "#22c55e" }}>{pick.pitcherStats.era.toFixed(2)}</p>
                </div>
              )}
              {pick.pitcherStats?.last5ERA != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">L5 ERA</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.last5ERA <= 3.00 ? "#f87171" : pick.pitcherStats.last5ERA <= 4.50 ? "#facc15" : "#22c55e" }}>{pick.pitcherStats.last5ERA.toFixed(2)}</p>
                </div>
              )}
              {pick.pitcherStats?.last3ERA != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">L3 ERA</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.last3ERA <= 3.00 ? "#f87171" : pick.pitcherStats.last3ERA <= 4.50 ? "#facc15" : "#22c55e" }}>{pick.pitcherStats.last3ERA.toFixed(2)}</p>
                </div>
              )}
              {pick.pitcherStats?.k9 != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">K/9</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.k9 >= 9.0 ? "#f87171" : pick.pitcherStats.k9 >= 7.0 ? "#facc15" : "#22c55e" }}>{pick.pitcherStats.k9.toFixed(1)}</p>
                </div>
              )}
              {pick.pitcherStats?.whip != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">WHIP</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.whip <= 1.10 ? "#f87171" : pick.pitcherStats.whip <= 1.30 ? "#facc15" : "#22c55e" }}>{pick.pitcherStats.whip.toFixed(2)}</p>
                </div>
              )}
              {pick.pitcherStats?.xwoba != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">xwOBA</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.xwoba >= 0.350 ? "#22c55e" : pick.pitcherStats.xwoba >= 0.310 ? "#facc15" : "#f87171" }}>{pick.pitcherStats.xwoba.toFixed(3)}</p>
                </div>
              )}
              {pick.pitcherStats?.hardHitPct != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Hard Hit%</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.hardHitPct >= 42 ? "#22c55e" : pick.pitcherStats.hardHitPct >= 35 ? "#facc15" : "#f87171" }}>{pick.pitcherStats.hardHitPct.toFixed(0)}%</p>
                </div>
              )}
              {pick.pitcherStats?.swStrPct != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">SwStr%</p>
                  <p className="text-xs font-black" style={{ color: pick.pitcherStats.swStrPct >= 12 ? "#f87171" : pick.pitcherStats.swStrPct >= 8 ? "#facc15" : "#22c55e" }}>{pick.pitcherStats.swStrPct.toFixed(1)}%</p>
                </div>
              )}
              {pick.pitcherStats?.gbPct != null && (
                <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">GB%</p>
                  <p className="text-xs font-black">{pick.pitcherStats.gbPct.toFixed(0)}%</p>
                </div>
              )}
            </div>
            {/* Leash indicator */}
            {pick.pitcherStats?.leashProbability != null && (
              <div className="mt-1.5 flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                <span className="text-[10px] text-muted-foreground flex-1">Starter Leash (prob. finishes 6+ IP)</span>
                <span className="text-[11px] font-black" style={{ color: pick.pitcherStats.leashProbability >= 0.70 ? "#22c55e" : pick.pitcherStats.leashProbability >= 0.50 ? "#facc15" : "#f87171" }}>
                  {Math.round(pick.pitcherStats.leashProbability * 100)}%
                </span>
              </div>
            )}
            {pick.pitcherStats?.last3AvgIP != null && (
              <div className="mt-1.5 flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                <span className="text-[10px] text-muted-foreground flex-1">Avg IP (last 3 starts)</span>
                <span className="text-[11px] font-black text-foreground">{pick.pitcherStats.last3AvgIP.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* ── 6. Game log (last 5) ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Last {pick.gamelog?.length ?? 0} Games
            </p>
            <GameLogDots log={pick.gamelog ?? []} />
          </div>

          {/* ── 7. Weather & environment ── */}
          {pick.game?.weather && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">🌤️ Weather & Environment</p>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(19,35,58,0.08)" }}>
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.06)", background: "rgba(19,35,58,0.02)" }}>
                  <span className="text-[10px] text-muted-foreground">Conditions</span>
                  <span className="text-[11px] font-bold text-foreground">
                    {pick.game.weather.isDome ? "🏟️ Dome" : `${pick.game.weather.tempF}°F · ${pick.game.weather.wind || "calm"}`}
                  </span>
                </div>
                {pick.game.weather.impactLabel && !pick.game.weather.isDome && (
                  <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.06)" }}>
                    <span className="text-[10px] text-muted-foreground">Impact</span>
                    <span className="text-[11px] font-semibold text-foreground">{pick.game.weather.impactLabel}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.06)", background: "rgba(19,35,58,0.01)" }}>
                  <span className="text-[10px] text-muted-foreground">O/U Total</span>
                  <span className="text-[11px] font-black" style={{ color: (pick.game?.total ?? 0) >= 9.5 ? "#22c55e" : "inherit" }}>{pick.game?.total ?? "—"}</span>
                </div>
                {(pick.stats?.bullpenEra != null || pick.stats?.bullpenWhip != null) && (
                  <div className="flex items-center justify-between px-3 py-2" style={{ background: "rgba(19,35,58,0.01)" }}>
                    <span className="text-[10px] text-muted-foreground">Opp Bullpen</span>
                    <span className="text-[11px] font-bold text-foreground">
                      {pick.stats.bullpenEra != null ? `ERA ${pick.stats.bullpenEra.toFixed(2)}` : ""}
                      {pick.stats.bullpenWhip != null ? ` · WHIP ${pick.stats.bullpenWhip.toFixed(2)}` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 8. Matchup Edge Breakdown (Phase 4) ── */}
          {pick.subScores && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                🔬 Matchup Edge Breakdown
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(19,35,58,0.10)" }}>
                {(() => {
                  const xera = pick.subScores.pitcherXera;
                  if (xera == null || xera <= 0) return (
                    <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.07)", background: "rgba(19,35,58,0.02)" }}>
                      <div><p className="text-[11px] font-semibold text-foreground">Pitcher xERA</p><p className="text-[10px] text-muted-foreground">Expected ERA (Baseball Savant)</p></div>
                      <span className="text-[11px] font-bold text-muted-foreground">N/A</span>
                    </div>
                  );
                  const label = xera <= 2.50 ? "Elite — tough" : xera <= 3.25 ? "Good — challenging" : xera <= 4.00 ? "Average" : xera <= 4.75 ? "Below avg — favorable" : "Vulnerable — ideal";
                  const color = xera <= 2.50 ? "#f87171" : xera <= 3.25 ? "#fb923c" : xera <= 4.00 ? "#facc15" : xera <= 4.75 ? "#86efac" : "#22c55e";
                  return (
                    <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.07)", background: "rgba(19,35,58,0.02)" }}>
                      <div><p className="text-[11px] font-semibold text-foreground">Pitcher xERA</p><p className="text-[10px] text-muted-foreground">{label}</p></div>
                      <span className="text-sm font-black" style={{ color }}>{xera.toFixed(2)}</span>
                    </div>
                  );
                })()}
                {(() => {
                  const ps = pick.subScores.platoonSplitScore;
                  const hand = pick.opponentPitcher?.hand ?? "R";
                  const bats = pick.bats ?? "R";
                  const matchStr = `${bats === "L" ? "LHB" : bats === "S" ? "Switch" : "RHB"} vs ${hand === "L" ? "LHP" : "RHP"}`;
                  const advantageLabel = ps >= 0.65 ? "Platoon advantage" : ps <= 0.38 ? "Platoon disadvantage" : "Neutral matchup";
                  const color = ps >= 0.65 ? "#22c55e" : ps <= 0.38 ? "#f87171" : "#facc15";
                  return (
                    <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.07)" }}>
                      <div><p className="text-[11px] font-semibold text-foreground">Platoon Split</p><p className="text-[10px] text-muted-foreground">{matchStr} · {advantageLabel}</p></div>
                      <span className="text-sm font-black" style={{ color }}>{Math.round((ps ?? 0.5) * 100)}%</span>
                    </div>
                  );
                })()}
                {(() => {
                  const hitterBarrel = pick.stats?.barrelPct ?? null;
                  const pitcherBarrel = pick.subScores.pitcherBarrelAllowed ?? 8;
                  const edge = hitterBarrel != null ? (hitterBarrel - 8) + (pitcherBarrel - 8) : null;
                  const edgeLabel = edge == null ? "—" : edge >= 4 ? "Strong barrel edge" : edge >= 1 ? "Slight barrel edge" : edge <= -4 ? "Barrel disadvantage" : "Neutral";
                  const color = edge == null ? "#9ca3af" : edge >= 4 ? "#22c55e" : edge >= 1 ? "#86efac" : edge <= -4 ? "#f87171" : "#facc15";
                  return (
                    <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(19,35,58,0.07)", background: "rgba(19,35,58,0.01)" }}>
                      <div>
                        <p className="text-[11px] font-semibold text-foreground">Barrel Rate Edge</p>
                        <p className="text-[10px] text-muted-foreground">Hitter {hitterBarrel != null ? hitterBarrel.toFixed(1) + "%" : "—"} · Pitcher allows {pitcherBarrel.toFixed(1)}%</p>
                      </div>
                      <span className="text-[11px] font-bold" style={{ color }}>{edgeLabel}</span>
                    </div>
                  );
                })()}
                {pick.subScores.analyticsBoostMult != null && pick.subScores.analyticsBoostMult !== 1 && (() => {
                  const boost = pick.subScores.analyticsBoostMult;
                  const pct = ((boost - 1) * 100);
                  const label = pct >= 4 ? "Strong boost — multiple tailwinds" : pct >= 1 ? "Mild boost" : pct <= -4 ? "Significant drag — headwinds" : "Mild drag";
                  const color = pct > 0 ? "#22c55e" : "#f87171";
                  return (
                    <div className="flex items-center justify-between px-3 py-2" style={{ background: "rgba(19,35,58,0.02)" }}>
                      <div><p className="text-[11px] font-semibold text-foreground">Analytics Layer</p><p className="text-[10px] text-muted-foreground">{label}</p></div>
                      <span className="text-sm font-black" style={{ color }}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── 9. MLB Analytics (Steamer projections + per-game) ── */}
          {(pick.analyticsNote || pick.steamerProjection || pick.projectedGameStats) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">📐 Season Projections</p>
              {pick.analyticsNote && (
                <p className="text-[11px] font-semibold mb-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(19,35,58,0.05)", color: "var(--foreground)" }}>{pick.analyticsNote}</p>
              )}
              {pick.steamerProjection && (
                <div className="mb-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Steamer Season Projection</p>
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
              {pick.projectedGameStats && pick.projectedGameStats.projH > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Proj Per-Game (Park + Pitcher Adj)</p>
                  <div className="grid grid-cols-4 gap-1">
                    <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.10)" }}>
                      <p className="text-[9px] text-muted-foreground uppercase font-semibold">H/G</p>
                      <p className="text-xs font-black" style={{ color: pick.projectedGameStats.parkAdjProjH >= 1.0 ? "#22c55e" : pick.projectedGameStats.parkAdjProjH >= 0.8 ? "#facc15" : "#f87171" }}>{pick.projectedGameStats.parkAdjProjH.toFixed(2)}</p>
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
                  {pick.projectedGameStats.note && <p className="text-[9px] text-muted-foreground mt-1">{pick.projectedGameStats.note}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── Moneyball Analytics ── */}
          {(() => {
            const xba       = pick.stats?.xba;
            const avg14     = pick.stats?.avg14;
            const avgSeason = pick.stats?.avgSeason;
            const xera      = pick.subScores?.pitcherXera;
            const hh        = pick.stats?.hardHitPct;
            const lines: { icon: string; label: string; body: string }[] = [];

            if (xba != null && (avg14 != null || avgSeason != null)) {
              const surf = avg14 ?? avgSeason ?? 0;
              const diff = Math.round((xba - surf) * 1000);
              const xs = "." + String(Math.round(xba * 1000)).padStart(3, "0");
              const as_ = "." + String(Math.round(surf * 1000)).padStart(3, "0");
              if (diff >= 30)
                lines.push({ icon: "🔬", label: "Contact Quality",
                  body: `xBA (${xs}) is +${diff} pts above recent avg (${as_}) — exit velocity says he’s hitting the ball harder than results show.` });
              else if (diff <= -30)
                lines.push({ icon: "🔬", label: "Contact Quality",
                  body: `xBA (${xs}) trails recent avg (${as_}) by ${Math.abs(diff)} pts — some luck in current numbers, but other factors qualified this pick.` });
              else
                lines.push({ icon: "🔬", label: "Contact Quality",
                  body: `xBA (${xs}) aligns with recent avg (${as_}) — exit velocity and launch angle support the surface stats.` });
            }

            if (hh != null)
              lines.push({ icon: "🔨", label: "Hard Contact",
                body: `${hh}% of batted balls at 95+ mph exit velocity.${
                  hh >= 46 ? " Elite barrel rate — nearly half all contact is crushed." :
                  hh >= 38 ? " Above-average power contact." : " Moderate hard-hit rate."}` });

            if (pick.expectedPA > 0)
              lines.push({ icon: "📋", label: "Opportunity",
                body: `Batting #${pick.lineupSlot ?? "?"}, projected ~${pick.expectedPA} PAs today.${
                  pick.expectedPA >= 4.5 ? " Top-order volume maximizes hit chances." :
                  pick.expectedPA >= 4.0 ? " Solid PA volume." : " Slightly limited opportunities."}` });

            if (pick.valueOverBaseline != null)
              lines.push({ icon: "⚖️", label: "Value vs Field",
                body: `${pick.valueOverBaseline >= 0 ? "+" : ""}${pick.valueOverBaseline}pp vs today’s slate median (${pick.slateMedian}%).${
                  pick.valueOverBaseline >= 8 ? " Stands out as a top-tier option on today’s slate." :
                  pick.valueOverBaseline >= 3 ? " Above average relative to today’s field." :
                  pick.valueOverBaseline >= 0 ? " In line with the top half of today’s slate." :
                  " Below today’s median but other factors qualified this pick."}` });

            if (pick.topDrivers?.[0])
              lines.push({ icon: pick.topDrivers[0].icon, label: `Top Signal — ${pick.topDrivers[0].name}`,
                body: `${pick.topDrivers[0].label} — the #1 contributor to this pick’s score.${
                  pick.topDrivers[1] ? ` Backed by ${pick.topDrivers[1].icon} ${pick.topDrivers[1].name}: ${pick.topDrivers[1].label}.` : ""}` });

            if (xera != null)
              lines.push({ icon: "⚾", label: "Pitcher True Skill",
                body: `Opposing starter xERA ${xera.toFixed(2)}${
                  xera >= 4.80 ? " — hittable arm. ERA likely undersells how much contact batters make." :
                  xera >= 4.20 ? " — elevated. Hitters have an edge." :
                  xera <= 3.20 ? " — elite starter. Tough matchup." : " — league-average arm."}` });

            if (lines.length === 0) return null;
            const mbGrade = calcMbGrade(pick);
            const gradeDesc: Record<MbGrade, string> = {
              A: "Elite confluence across all signals.",
              B: "Strong across most Moneyball metrics.",
              C: "Qualified with mixed signals.",
              D: "Borderline — 1–2 factors working.",
              F: "Below threshold.",
            };
            return (
              <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.16)", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14 }}>📚</span>
                    <p style={{ fontSize: 10, fontWeight: 900, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.8, margin: 0 }}>Moneyball Analytics</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ fontSize: 10, color: "#3D4B58", margin: 0 }}>{gradeDesc[mbGrade]}</p>
                    <MbGradeBadge grade={mbGrade} size="lg" />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{l.icon}</span>
                      <p style={{ fontSize: 11, color: "#3D4B58", lineHeight: 1.45, margin: 0 }}>
                        <strong style={{ color: "#131A24" }}>{l.label}:</strong>{" "}{l.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
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
  // ── Phase 5 Moneyball additions ──
  {
    term: "Top Drivers",
    label: "Model Driver Chips",
    emoji: "🏅",
    def: "The 3 scoring components that contributed the most to this pick's hit probability. Gold chip = #1 driver. Shown on every card so you can immediately see WHY the model liked this player — e.g. \"⚾ Pitcher Matchup\" means the starter's xERA was a major factor.",
  },
  {
    term: "~N PA",
    label: "Expected Plate Appearances",
    emoji: "📋",
    def: "Estimated at-bats for today based on lineup slot and game pace. Top-of-order hitters in a 9-inning game get ~4.8 PA; bottom-order ~3.8 PA. More plate appearances = more chances for a hit = direct probability boost.",
  },
  {
    term: "+Xpp vs slate",
    label: "Value Over Baseline",
    emoji: "📈",
    def: "How far above or below today's slate median this pick sits, in percentage points. If the median hit probability is 62% and this player is at 71%, they show +9pp. Positive values in green mean this pick stands out from the field.",
  },
  {
    term: "Pythagorean Win %",
    label: "Run-Based Win Probability",
    emoji: "🧮",
    def: "A sabermetric formula (RS² / (RS²+RA²)) that converts projected runs scored vs runs allowed into a win probability. More accurate than betting-market implied odds because it ignores line movement and uses actual run production data. Shown in team pick drawers.",
  },
  {
    term: "Edge Drivers",
    label: "Team Win Edge Factors",
    emoji: "⚡",
    def: "The top 3 categories where the picked team has a scoring advantage over the opponent: Starter Edge, Bullpen Edge, Offense vs Pitcher Hand, Lineup Depth, Market Edge, or Environment. Each chip shows the raw gap (e.g. \"🎯 Starter Edge +14\") so you can see exactly what pushed the model toward this team.",
  },
  {
    term: "Monte Carlo Sim",
    label: "100-Game Simulation",
    emoji: "🎲",
    def: "The team win model runs 100 randomized simulations of the game using run-scoring distributions for both teams. If the opponent wins more than 50%+8% of simulations, the model flips its pick. If your team wins fewer than 42% of sims, the pick is disqualified entirely — a hard \"coherence gate\" to catch cases where analytics support the pick but math doesn't.",
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

// ─── MLB Daily Pick of the Day ──────────────────────────────────────────────
function gradeColor(g: string): string {
  if (g === "A") return "#16a34a";
  if (g === "B+") return "#2563eb";
  if (g === "B") return "#7c3aed";
  if (g === "C+") return "#d97706";
  return "#6b7280";
}
function resultBadge(result: string) {
  if (result === "win")    return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(34,197,94,0.12)", color: "#16a34a", borderRadius: 10, padding: "2px 7px" }}>WIN</span>;
  if (result === "loss")   return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(239,68,68,0.10)", color: "#dc2626", borderRadius: 10, padding: "2px 7px" }}>LOSS</span>;
  if (result === "push")   return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(250,204,21,0.12)", color: "#b8930a", borderRadius: 10, padding: "2px 7px" }}>PUSH</span>;
  return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(19,35,58,0.06)", color: "#6b7280", borderRadius: 10, padding: "2px 7px" }}>PENDING</span>;
}

// ─── Team Win Card — used by TeamWinPanel ────────────────────────────────────
function TeamWinCard({ pick, slot, isOwner = false, onGrade }: {
  pick: any; slot: "pick1" | "pick2"; isOwner?: boolean;
  onGrade?: (slot: "pick1" | "pick2", result: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!pick) return null;

  const isWin  = pick.result === "win";
  const isLoss = pick.result === "loss";
  const isPush = pick.result === "push";
  const isPend = !pick.result || pick.result === "pending";

  const tierColor: Record<string, { bg: string; text: string; border: string }> = {
    A: { bg: "rgba(34,197,94,0.15)",   text: "#16a34a", border: "rgba(34,197,94,0.40)" },
    B: { bg: "rgba(250,204,21,0.15)",  text: "#b8930a", border: "rgba(250,204,21,0.40)" },
    C: { bg: "rgba(147,197,253,0.15)", text: "#3b82f6", border: "rgba(147,197,253,0.40)" },
  };
  const tc = tierColor[pick.tier ?? "C"] ?? tierColor["C"];

  const mlFmt = (ml: number | null | undefined) => ml == null ? "—" : ml > 0 ? `+${ml}` : `${ml}`;
  const numFmt = (v: number | null | undefined, dec = 1) => v == null ? "—" : v.toFixed(dec);

  const sub = pick.subScores;
  const homeSub = sub?.home;
  const awaySub = sub?.away;
  const pickSub = pick.pickSide === "home" ? homeSub : awaySub;

  const starterForPick = pick.pickSide === "home" ? pick.starters?.home : pick.starters?.away;
  const oppStarter     = pick.pickSide === "home" ? pick.starters?.away : pick.starters?.home;

  const cardBg    = isWin ? "rgba(34,197,94,0.04)"  : isLoss ? "rgba(239,68,68,0.03)"  : isPush ? "rgba(250,204,21,0.04)" : "#fff";
  const cardBorder= isWin ? "rgba(34,197,94,0.30)"  : isLoss ? "rgba(239,68,68,0.25)"  : isPush ? "rgba(250,204,21,0.30)" : slot === "pick1" ? "rgba(212,168,67,0.40)" : "rgba(19,35,58,0.10)";

  const ScoreBar = ({ label: lbl, value, max = 100, color }: { label: string; value: number | null; max?: number; color: string }) => {
    if (value == null) return null;
    const pct = Math.round((value / max) * 100);
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground flex-1 min-w-0 truncate">{lbl}</span>
        <div className="flex-shrink-0 h-1.5 rounded-full" style={{ width: 80, background: "rgba(19,35,58,0.08)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
        <span className="text-[10px] font-bold flex-shrink-0 w-7 text-right" style={{ color }}>{value}</span>
      </div>
    );
  };

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{ background: cardBg, borderColor: cardBorder,
        boxShadow: slot === "pick1" ? "0 0 18px rgba(212,168,67,0.12)" : "none" }}
    >
      {/* Result banner */}
      {!isPend && (
        <div style={{
          background: isWin ? "rgba(34,197,94,0.12)" : isLoss ? "rgba(239,68,68,0.10)" : "rgba(250,204,21,0.12)",
          borderBottom: `1px solid ${isWin ? "rgba(34,197,94,0.25)" : isLoss ? "rgba(239,68,68,0.20)" : "rgba(250,204,21,0.25)"}`,
          padding: "5px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{isWin ? "✅" : isLoss ? "❌" : "➡️"}</span>
            <span className="text-xs font-black" style={{ color: isWin ? "#16a34a" : isLoss ? "#dc2626" : "#b8930a" }}>
              {isWin ? "WIN" : isLoss ? "LOSS" : "PUSH"}
            </span>
            {pick.finalScore && <span className="text-[10px] text-muted-foreground ml-1">{pick.finalScore}</span>}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {slot === "pick1" && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#D4A843", color: "#1a1a1a" }}>
                🏆 TOP PICK
              </span>
            )}
            {slot === "pick2" && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(19,35,58,0.08)", color: "#3D4B58" }}>
                #2 PICK
              </span>
            )}
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: tc.bg, color: tc.text, border: `1px solid ${tc.border}` }}>
              {pick.tier} Tier
            </span>
          </div>
          <p className="font-black text-base text-foreground mt-1">{pick.pickTeam}</p>
          <p className="text-[11px] text-muted-foreground">
            vs {pick.oppTeam} · {pick.pickSide === "home" ? "Home" : "Away"}
            {pick.pickML != null && (
              <span className="ml-1.5 font-bold" style={{ color: (pick.pickML ?? 0) > 0 ? "#22c55e" : "#94a3b8" }}>
                ML {mlFmt(pick.pickML)}
              </span>
            )}
          </p>
        </div>
        {/* Win score ring + Moneyball grade */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
          <div
            className="rounded-full flex items-center justify-center font-black text-sm"
            style={{
              width: 48, height: 48,
              background: `conic-gradient(${pick.winnerScore >= 68 ? "#22c55e" : pick.winnerScore >= 60 ? "#facc15" : "#94a3b8"} ${pick.winnerScore * 3.6}deg, rgba(19,35,58,0.08) 0deg)`,
              boxShadow: "0 0 0 3px #F6F1E7",
              color: "#131A24",
            }}
          >
            <div className="rounded-full flex items-center justify-center text-[13px] font-black"
              style={{ width: 38, height: 38, background: "#F6F1E7" }}>
              {pick.winnerScore}
            </div>
          </div>
          <span className="text-[9px] font-bold text-muted-foreground">Score</span>
          {/* Moneyball Grade coin */}
          <MbGradeBadge grade={calcTeamMbGrade(pick)} size="md" />
        </div>
      </div>

      {/* Starter row */}
      <div className="px-4 pb-2 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0 rounded-xl px-3 py-2" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground mb-0.5">
            {pick.pickTeam.split(" ").pop()} Starter
          </p>
          <p className="text-[12px] font-bold text-foreground truncate">{starterForPick?.name ?? "TBD"}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {starterForPick?.xera != null && (
              <span className="text-[10px] text-muted-foreground">
                xERA <span className="font-black" style={{ color: starterForPick.xera <= 3.25 ? "#f87171" : starterForPick.xera <= 4.50 ? "#facc15" : "#22c55e" }}>
                  {starterForPick.xera.toFixed(2)}
                </span>
              </span>
            )}
            {starterForPick?.era != null && (
              <span className="text-[10px] text-muted-foreground">
                ERA <span className="font-black" style={{ color: starterForPick.era <= 3.50 ? "#f87171" : starterForPick.era <= 4.50 ? "#facc15" : "#22c55e" }}>
                  {starterForPick.era.toFixed(2)}
                </span>
              </span>
            )}
            {starterForPick?.kPct != null && (
              <span className="text-[10px] text-muted-foreground">
                K% <span className="font-bold">{starterForPick.kPct.toFixed(0)}%</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-center flex flex-col items-center justify-center">
          <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">Edge</p>
          <p className="text-base font-black" style={{ color: pick.edge >= 12 ? "#22c55e" : pick.edge >= 8 ? "#facc15" : "#94a3b8" }}>
            +{pick.edge}
          </p>
        </div>
        <div className="flex-1 min-w-0 rounded-xl px-3 py-2" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
          <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground mb-0.5">
            {pick.oppTeam.split(" ").pop()} Starter
          </p>
          <p className="text-[12px] font-bold text-foreground truncate">{oppStarter?.name ?? "TBD"}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {oppStarter?.xera != null && (
              <span className="text-[10px] text-muted-foreground">
                xERA <span className="font-black" style={{ color: oppStarter.xera <= 3.25 ? "#f87171" : oppStarter.xera <= 4.50 ? "#facc15" : "#22c55e" }}>
                  {oppStarter.xera.toFixed(2)}
                </span>
              </span>
            )}
            {oppStarter?.era != null && (
              <span className="text-[10px] text-muted-foreground">
                ERA <span className="font-black" style={{ color: oppStarter.era <= 3.50 ? "#f87171" : oppStarter.era <= 4.50 ? "#facc15" : "#22c55e" }}>
                  {oppStarter.era.toFixed(2)}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Quick sub-scores */}
      {pickSub && (
        <div className="px-4 pb-3 grid grid-cols-3 gap-1.5">
          {[
            { label: "Starter", val: pickSub.starterEdge },
            { label: "Bullpen", val: pickSub.bullpenScore },
            { label: "Offense", val: pickSub.offenseVsHand },
            { label: "Lineup",  val: pickSub.lineupEdge },
            { label: "Market",  val: pickSub.marketScore },
            { label: "Park/Env",val: pickSub.envScore },
          ].map(({ label: lbl, val }) => (
            <div key={lbl} className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
              <p className="text-[8px] text-muted-foreground uppercase tracking-wider font-semibold">{lbl}</p>
              <p className="text-xs font-black" style={{ color: (val ?? 0) >= 60 ? "#22c55e" : (val ?? 0) >= 45 ? "#facc15" : "#f87171" }}>
                {val ?? "—"}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Expand / grade row */}
      <div className="flex border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex-1 px-4 py-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground"
          style={{ background: "rgba(19,35,58,0.02)" }}
        >
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? "Less" : "Full breakdown"}
        </button>
        {isOwner && isPend && onGrade && (
          <>
            <div style={{ width: 1, background: "rgba(19,35,58,0.08)" }} />
            <button
              onClick={() => onGrade(slot, "win")}
              className="px-3 py-2 text-[10px] font-black"
              style={{ background: "rgba(34,197,94,0.06)", color: "#16a34a" }}
            >✅ Win</button>
            <div style={{ width: 1, background: "rgba(19,35,58,0.08)" }} />
            <button
              onClick={() => onGrade(slot, "loss")}
              className="px-3 py-2 text-[10px] font-black"
              style={{ background: "rgba(239,68,68,0.06)", color: "#dc2626" }}
            >❌ Loss</button>
          </>
        )}
      </div>

      {/* Expanded breakdown */}
      {open && (
        <div className="px-4 py-3 space-y-4 border-t" style={{ borderColor: "rgba(19,35,58,0.08)" }}>

          {/* ── Monte Carlo Simulation ── */}
          {pick.simulation && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">🎲 100-Game Monte Carlo Simulation</p>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(19,35,58,0.10)" }}>
                {/* Win bar */}
                <div className="px-3 pt-2.5 pb-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-black" style={{ color: "#22c55e" }}>{pick.pickTeam.split(" ").pop()} {pick.simulation.pickWinPct}%</span>
                    <span className="text-[11px] font-black" style={{ color: "#f87171" }}>{pick.oppTeam.split(" ").pop()} {pick.simulation.oppWinPct}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(248,113,113,0.25)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pick.simulation.pickWinPct}%`, background: "linear-gradient(90deg, #22c55e, #16a34a)" }} />
                  </div>
                  {pick.simulation.pushPct > 0 && (
                    <p className="text-[9px] text-muted-foreground mt-0.5 text-center">Tie: {pick.simulation.pushPct}%</p>
                  )}
                </div>
                {/* Predicted score + avg runs */}
                <div className="grid grid-cols-3 divide-x mt-1" style={{ borderTop: "1px solid rgba(19,35,58,0.06)", divideColor: "rgba(19,35,58,0.06)" }}>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold">Pred Score</p>
                    <p className="text-xs font-black text-foreground">{pick.simulation.predictedPickScore}–{pick.simulation.predictedOppScore}</p>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold">Avg Runs</p>
                    <p className="text-xs font-black text-foreground">{pick.simulation.simPickAvg} / {pick.simulation.simOppAvg}</p>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold">Sims</p>
                    <p className="text-xs font-black text-foreground">{pick.simulation.sims}</p>
                  </div>
                </div>
              </div>
              {/* Sim coherence note */}
              {pick.simulation.pickWinPct >= 58 ? (
                <p className="text-[10px] mt-1" style={{ color: "#22c55e" }}>✅ Simulation strongly supports this pick</p>
              ) : pick.simulation.pickWinPct >= 50 ? (
                <p className="text-[10px] mt-1" style={{ color: "#facc15" }}>⚡ Simulation leans toward this pick</p>
              ) : (
                <p className="text-[10px] mt-1" style={{ color: "#fb923c" }}>⚠️ Close game — simulation slightly favors pick</p>
              )}
            </div>
          )}

          {/* ── Score comparison (pick vs opp) ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">📊 Composite Score Breakdown</p>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(19,35,58,0.10)" }}>
              <div className="flex" style={{ background: "rgba(19,35,58,0.04)", borderBottom: "1px solid rgba(19,35,58,0.08)", padding: "6px 12px" }}>
                <span className="flex-1 text-[10px] font-black text-foreground">{pick.pickTeam}</span>
                <span className="text-[10px] font-black text-muted-foreground">vs</span>
                <span className="flex-1 text-[10px] font-black text-foreground text-right">{pick.oppTeam}</span>
              </div>
              {[
                { label: "Starter Edge (30%)", pickVal: (pick.pickSide === "home" ? homeSub?.starterEdge : awaySub?.starterEdge), oppVal: (pick.pickSide === "home" ? awaySub?.starterEdge : homeSub?.starterEdge) },
                { label: "Bullpen (20%)",       pickVal: (pick.pickSide === "home" ? homeSub?.bullpenScore : awaySub?.bullpenScore), oppVal: (pick.pickSide === "home" ? awaySub?.bullpenScore : homeSub?.bullpenScore) },
                { label: "Offense vs Hand (20%)", pickVal: (pick.pickSide === "home" ? homeSub?.offenseVsHand : awaySub?.offenseVsHand), oppVal: (pick.pickSide === "home" ? awaySub?.offenseVsHand : homeSub?.offenseVsHand) },
                { label: "Lineup Edge (10%)",    pickVal: (pick.pickSide === "home" ? homeSub?.lineupEdge : awaySub?.lineupEdge), oppVal: (pick.pickSide === "home" ? awaySub?.lineupEdge : homeSub?.lineupEdge) },
                { label: "Market Edge (15%)",    pickVal: (pick.pickSide === "home" ? homeSub?.marketScore : awaySub?.marketScore), oppVal: (pick.pickSide === "home" ? awaySub?.marketScore : homeSub?.marketScore) },
                { label: "Environment (5%)",     pickVal: (pick.pickSide === "home" ? homeSub?.envScore : awaySub?.envScore), oppVal: (pick.pickSide === "home" ? awaySub?.envScore : homeSub?.envScore) },
              ].map(({ label: lbl, pickVal: pv, oppVal: ov }) => {
                const pickWins = (pv ?? 0) >= (ov ?? 0);
                return (
                  <div key={lbl} className="flex items-center px-3 py-1.5 gap-2" style={{ borderBottom: "1px solid rgba(19,35,58,0.05)" }}>
                    <span className="text-[9px] font-black w-7 text-right" style={{ color: pickWins ? "#22c55e" : "#f87171" }}>{pv ?? "—"}</span>
                    <div className="flex-1 text-center">
                      <span className="text-[10px] text-muted-foreground">{lbl}</span>
                      {/* Mini bar comparing pick vs opp */}
                      {pv != null && ov != null && (
                        <div className="flex h-1 rounded-full overflow-hidden mt-0.5 mx-4" style={{ background: "rgba(19,35,58,0.07)" }}>
                          <div style={{ width: `${(pv / 100) * 50}%`, background: "#22c55e", marginLeft: `${50 - (pv / 100) * 50}%` }} />
                          <div style={{ width: `${(ov / 100) * 50}%`, background: "#f87171" }} />
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] font-black w-7" style={{ color: !pickWins ? "#22c55e" : "#f87171" }}>{ov ?? "—"}</span>
                  </div>
                );
              })}
              <div className="flex items-center px-3 py-2 gap-2" style={{ background: "rgba(19,35,58,0.03)" }}>
                <span className="text-sm font-black w-7 text-right" style={{ color: "#D4A843" }}>{pick.winnerScore}</span>
                <span className="flex-1 text-[10px] font-black text-foreground text-center uppercase tracking-wider">TOTAL SCORE</span>
                <span className="text-sm font-black w-7" style={{ color: "#94a3b8" }}>{pick.loserScore}</span>
              </div>
            </div>
          </div>

          {/* ── Both starters — full stats ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">⚾ Starter Duel — Full Stats</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { starter: starterForPick, teamLabel: pick.pickTeam, isPick: true },
                { starter: oppStarter, teamLabel: pick.oppTeam, isPick: false },
              ].map(({ starter: s, teamLabel, isPick }) => (
                <div key={teamLabel} className="rounded-xl px-3 py-2.5" style={{ background: isPick ? "rgba(34,197,94,0.04)" : "rgba(19,35,58,0.04)", border: `1px solid ${isPick ? "rgba(34,197,94,0.18)" : "rgba(19,35,58,0.08)"}` }}>
                  <p className="text-[9px] font-black uppercase tracking-wider mb-0.5" style={{ color: isPick ? "#16a34a" : "#3D4B58" }}>{isPick ? "✅ PICK" : "OPP"}</p>
                  <p className="text-[12px] font-bold text-foreground truncate">{s?.name ?? "TBD"}</p>
                  <p className="text-[9px] text-muted-foreground mb-1">{s?.hand === "L" ? "LHP" : "RHP"}</p>
                  <div className="space-y-0.5">
                    {s?.era != null && <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">ERA</span><span className="font-black" style={{ color: s.era <= 3.50 ? "#f87171" : s.era <= 4.50 ? "#facc15" : "#22c55e" }}>{s.era.toFixed(2)}</span></div>}
                    {s?.xera != null && <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">xERA</span><span className="font-black" style={{ color: s.xera <= 3.25 ? "#f87171" : s.xera <= 4.50 ? "#facc15" : "#22c55e" }}>{s.xera.toFixed(2)}</span></div>}
                    {s?.k9 != null && <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">K/9</span><span className="font-black" style={{ color: s.k9 >= 9 ? "#f87171" : s.k9 >= 7 ? "#facc15" : "#22c55e" }}>{s.k9.toFixed(1)}</span></div>}
                    {s?.whip != null && <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">WHIP</span><span className="font-black" style={{ color: s.whip <= 1.10 ? "#f87171" : s.whip <= 1.30 ? "#facc15" : "#22c55e" }}>{s.whip.toFixed(2)}</span></div>}
                    {s?.kPct != null && <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">K%</span><span className="font-bold">{s.kPct.toFixed(0)}%</span></div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Market + Environment ── */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">💰 Market & Environment</p>
            <div className="grid grid-cols-2 gap-2">
              {pick.pickML != null && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Moneyline</p>
                  <p className="text-base font-black" style={{ color: (pick.pickML ?? 0) > 0 ? "#22c55e" : "#94a3b8" }}>{pick.pickML > 0 ? `+${pick.pickML}` : pick.pickML}</p>
                  {pick.impliedWinProb != null && <p className="text-[10px] text-muted-foreground">Implied win: {pick.impliedWinProb}%</p>}
                </div>
              )}
              <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Weather</p>
                <p className="text-xs font-bold text-foreground">{pick.weather?.isDome ? "🏟️ Dome — neutral" : pick.weather?.tempF > 0 ? `${pick.weather.tempF}°F` : "—"}</p>
                {pick.weather?.windMph > 0 && !pick.weather?.isDome && <p className="text-[10px] text-muted-foreground">{pick.weather.windMph} mph wind</p>}
              </div>
              {pick.parkFactor != null && pick.parkFactor !== 1.0 && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Park Factor</p>
                  <p className="text-base font-black" style={{ color: pick.parkFactor >= 1.08 ? "#22c55e" : pick.parkFactor <= 0.93 ? "#f87171" : "inherit" }}>{pick.parkFactor.toFixed(2)}</p>
                  <p className="text-[9px] text-muted-foreground">{pick.parkFactor >= 1.05 ? "Hitter-friendly" : pick.parkFactor <= 0.95 ? "Pitcher-friendly" : "Neutral park"}</p>
                </div>
              )}
              <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Location</p>
                <p className="text-xs font-bold text-foreground">{pick.pickSide === "home" ? "🏠 Home" : "✈️ Away"}</p>
                <p className="text-[9px] text-muted-foreground truncate">{pick.venue}</p>
              </div>
            </div>
          </div>

          {/* Section 5: Edge Drivers & Run Model */}
          {(pick.edgeDrivers?.length > 0 || pick.expectedRuns) && (
            <div style={{ background: "rgba(212,168,67,0.04)", border: "1px solid rgba(212,168,67,0.15)", borderRadius: 12, padding: "10px 14px", marginTop: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 800, color: "#3D4B58", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Edge Drivers</p>

              {pick.expectedRuns && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "6px 10px", background: "rgba(19,35,58,0.04)", borderRadius: 8 }}>
                  <div>
                    <p style={{ fontSize: 9, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", letterSpacing: 0.5 }}>Projected Runs</p>
                    <p style={{ fontSize: 13, fontWeight: 900, color: "#131A24", marginTop: 1 }}>
                      {pick.expectedRuns.pickRpg.toFixed(1)} <span style={{ color: "#3D4B58", fontSize: 10, fontWeight: 600 }}>vs</span> {pick.expectedRuns.oppRpg.toFixed(1)}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", letterSpacing: 0.5 }}>Pythagorean Win%</p>
                    <p style={{ fontSize: 13, fontWeight: 900, marginTop: 1,
                      color: (pick.expectedRuns.pythagoreanWinPct ?? 0) >= 60 ? "#16a34a" : (pick.expectedRuns.pythagoreanWinPct ?? 0) >= 52 ? "#D4A843" : "#6b7280" }}>
                      {pick.expectedRuns.pythagoreanWinPct ?? "—"}%
                    </p>
                  </div>
                </div>
              )}

              {pick.edgeDrivers?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {pick.edgeDrivers.map((d: any, i: number) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "5px 8px", borderRadius: 8,
                      background: i === 0 ? "rgba(34,197,94,0.08)" : "rgba(19,35,58,0.03)",
                      border: `1px solid ${i === 0 ? "rgba(34,197,94,0.20)" : "rgba(19,35,58,0.08)"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{d.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#131A24" }}>{d.name}</span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 800, color: d.gap >= 10 ? "#16a34a" : "#D4A843" }}>
                        +{d.gap} edge
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Moneyball Analytics — Team Pick ── */}
          {(() => {
            const simPct  = pick.simulation?.pickWinPct;
            const oppPct  = pick.simulation?.oppWinPct;
            const predP   = pick.simulation?.predictedPickScore;
            const predO   = pick.simulation?.predictedOppScore;
            const pyth    = pick.expectedRuns?.pythagoreanWinPct;
            const pickRpg = pick.expectedRuns?.pickRpg;
            const oppRpg  = pick.expectedRuns?.oppRpg;
            const ed0     = pick.edgeDrivers?.[0];
            const ed1     = pick.edgeDrivers?.[1];
            // Pick-side starter: starters.home or starters.away depending on pickSide
            const sfp     = pick.pickSide === "home" ? pick.starters?.home : pick.starters?.away;
            const sfpEra  = sfp?.era;
            const sfpXera = sfp?.xera;
            const sfpK9   = sfp?.k9;
            const sfpWhip = sfp?.whip;
            // Opp starter
            const osp     = pick.pickSide === "home" ? pick.starters?.away : pick.starters?.home;
            const ospEra  = osp?.era;
            const ospXera = osp?.xera;
            // Sub-scores for pick side
            const sub     = pick.subScores?.pick;

            const lines: { icon: string; label: string; body: string }[] = [];

            // 1. Monte Carlo simulation
            if (simPct != null)
              lines.push({ icon: "🎲", label: "Monte Carlo (100 sims)",
                body: `${simPct}% simulated win rate (${oppPct}% for ${pick.oppTeam}).`
                  + (predP != null && predO != null ? ` Predicted score: ${pick.pickTeam} ${predP} – ${pick.oppTeam} ${predO}.` : "")
                  + (simPct >= 62 ? " Simulation strongly supports this pick." : simPct >= 52 ? " Simulation aligns with the model pick." : " Narrow sim margin — pick qualified on analytical edge.") });

            // 2. Pythagorean Win %
            if (pyth != null && pickRpg != null && oppRpg != null)
              lines.push({ icon: "🧮", label: "Pythagorean Win%",
                body: `${pyth}% win probability based on projected run output (${pick.pickTeam} ${pickRpg.toFixed(1)} RPG vs ${pick.oppTeam} ${oppRpg.toFixed(1)} RPG).`
                  + (pyth >= 62 ? " Strong run advantage — the math solidly backs this pick." : pyth >= 54 ? " Modest run edge. Passed coherence gate." : " Close game on paper — pick qualified on component scoring, not run margin.") });

            // 3. Pick-side starter xERA
            if (sfpEra != null && sfpXera != null && sfpXera > 0) {
              const diff = sfpXera - sfpEra;
              lines.push({ icon: "🌟", label: `${pick.pickTeam} Starter (${sfp?.name ?? ""})`,
                body: `ERA ${sfpEra.toFixed(2)} / xERA ${sfpXera.toFixed(2)}`
                  + (sfpK9 ? ` / ${sfpK9.toFixed(1)} K⁄9` : "")
                  + (sfpWhip ? ` / ${sfpWhip.toFixed(2)} WHIP` : ".")
                  + (diff < -0.40 ? " xERA below ERA — pitching better than numbers show, opponents will struggle to make contact." : diff > 0.40 ? " xERA above ERA — results have been lucky, regression likely." : " ERA and xERA aligned — consistent, trustworthy performance.") });
            } else if (sfpEra != null) {
              lines.push({ icon: "🌟", label: `${pick.pickTeam} Starter (${sfp?.name ?? ""})`,
                body: `ERA ${sfpEra.toFixed(2)}`
                  + (sfpK9 ? ` / ${sfpK9.toFixed(1)} K⁄9` : "")
                  + (sfpWhip ? ` / ${sfpWhip.toFixed(2)} WHIP` : ".") });
            }

            // 4. Opposing starter xERA (the arm pick team's batters face)
            if (ospEra != null && ospXera != null && ospXera > 0) {
              const diff2 = ospXera - ospEra;
              lines.push({ icon: "⚾", label: `Opp Starter (${osp?.name ?? ""})`,
                body: `ERA ${ospEra.toFixed(2)} / xERA ${ospXera.toFixed(2)}.`
                  + (diff2 >= 0.40 ? ` xERA (${ospXera.toFixed(2)}) is higher than ERA — opposing starter is overperforming. ${pick.pickTeam} bats should make more contact than ERA suggests.` : diff2 <= -0.40 ? ` xERA (${ospXera.toFixed(2)}) is lower — opposing starter is elite. Tough for ${pick.pickTeam} bats.` : " ERA and xERA aligned — predictable matchup.") });
            }

            // 5. Top edge driver
            if (ed0)
              lines.push({ icon: ed0.icon, label: `Top Scoring Edge — ${ed0.name}`,
                body: `+${ed0.gap}-point advantage over ${pick.oppTeam}.`
                  + (ed0.gap >= 15 ? " Dominant gap — this category strongly tilts the matchup." : ed0.gap >= 10 ? " Meaningful edge the market likely hasn't fully priced in." : " Consistent edge across the scoring model.")
                  + (ed1 ? ` Also backed by ${ed1.icon} ${ed1.name} (+${ed1.gap}).` : "") });

            // 6. Sub-score breakdown
            if (sub) {
              const cats = [
                { k: "starterEdge",   label: "Starter",         w: "30%" },
                { k: "bullpenScore",  label: "Bullpen",          w: "20%" },
                { k: "offenseVsHand",label: "Offense vs Hand",  w: "20%" },
                { k: "lineupEdge",    label: "Lineup Depth",     w: "10%" },
                { k: "marketScore",   label: "Market",           w: "15%" },
              ];
              const parts = cats.map(c => `${c.label} ${(sub as any)[c.k] ?? "—"}`).join(" · ");
              lines.push({ icon: "📊", label: "Component Scores (out of 100)",
                body: parts + " — composite = " + pick.winnerScore });
            }

            if (lines.length === 0) return null;
            const mbGradeT = calcTeamMbGrade(pick);
            const gradeDescT: Record<MbGrade, string> = {
              A: "Elite sim + run edge. High conviction.",
              B: "Strong model support across key factors.",
              C: "Qualified — mixed signals present.",
              D: "Borderline — narrow edge.",
              F: "Below threshold.",
            };
            return (
              <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.16)", borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14 }}>📚</span>
                    <p style={{ fontSize: 10, fontWeight: 900, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.8, margin: 0 }}>Moneyball Analytics</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ fontSize: 10, color: "#3D4B58", margin: 0 }}>{gradeDescT[mbGradeT]}</p>
                    <MbGradeBadge grade={mbGradeT} size="lg" />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{l.icon}</span>
                      <p style={{ fontSize: 11, color: "#3D4B58", lineHeight: 1.45, margin: 0 }}>
                        <strong style={{ color: "#131A24" }}>{l.label}:</strong>{" "}{l.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Team Win Panel ──────────────────────────────────────────────────────────
function TeamWinPanel() {
  const queryClient = useQueryClient();
  const { isOwner } = useAuth();
  const [showOlderHistory, setShowOlderHistory] = useState(false);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/mlb/team-wins-today"],
    staleTime: 20 * 60 * 1000,
    refetchInterval: (query) => (query.state.data?.locked ? false : 20 * 60 * 1000),
  });

  const gradeMutation = useMutation({
    mutationFn: ({ date, result, which }: any) =>
      fetch("/api/mlb/team-wins-today/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, result, which }),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mlb/team-wins-today"] }),
  });

  const history: Record<string, any> = data?.history ?? {};
  const histEntries = Object.values(history).sort((a: any, b: any) => b.date > a.date ? 1 : -1);

  // Compute today + yesterday date strings
  const todayStr = (() => {
    const ct = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
    const [m, d, y] = ct.split("/"); return `${y}-${m}-${d}`;
  })();
  const yesterdayStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const ct = d.toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
    const [m, dy, y] = ct.split("/"); return `${y}-${m}-${dy}`;
  })();

  const recentEntries = histEntries.filter((e: any) => e.date === todayStr || e.date === yesterdayStr);
  const olderEntries  = histEntries.filter((e: any) => e.date !== todayStr && e.date !== yesterdayStr);

  // Season record
  let seasonW = 0, seasonL = 0;
  for (const entry of histEntries) {
    for (const slot of ["pick1", "pick2"] as const) {
      const p = (entry as any)[slot];
      if (!p) continue;
      if (p.result === "win") seasonW++;
      else if (p.result === "loss") seasonL++;
    }
  }
  const seasonPct = (seasonW + seasonL) > 0 ? Math.round(seasonW / (seasonW + seasonL) * 100) : null;

  const renderHistoryEntry = (entry: any) => (
    <div key={entry.date} style={{ borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden" }}>
      <div style={{ padding: "6px 12px", background: "rgba(19,35,58,0.04)", borderBottom: "1px solid rgba(19,35,58,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#131A24" }}>
          {new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </span>
        {entry.date === todayStr && <span style={{ fontSize: 9, fontWeight: 800, color: "#16a34a", background: "rgba(34,197,94,0.12)", borderRadius: 8, padding: "2px 7px" }}>TODAY</span>}
        {entry.date === yesterdayStr && <span style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", background: "rgba(107,114,128,0.10)", borderRadius: 8, padding: "2px 7px" }}>YESTERDAY</span>}
      </div>
      {(["pick1", "pick2"] as const).map(slot => {
        const p = entry[slot];
        if (!p) return null;
        return (
          <div key={slot} style={{ borderBottom: "1px solid rgba(19,35,58,0.06)" }}>
            <TeamWinCard
              pick={p}
              slot={slot}
              isOwner={isOwner}
              onGrade={(s, result) => gradeMutation.mutate({ date: entry.date, result, which: s })}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "#13233A", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Swords size={15} style={{ color: "#D4A843" }} />
          <span style={{ fontSize: 14, fontWeight: 900, color: "#F6F1E7" }}>Top 2 Teams to Win Today</span>
        </div>
        {seasonPct !== null && (
          <span style={{ fontSize: 11, fontWeight: 800,
            color: seasonPct >= 60 ? "#4ade80" : seasonPct >= 40 ? "#fbbf24" : "#f87171" }}>
            {seasonW}W-{seasonL}L ({seasonPct}%)
          </span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {isLoading && <BtsLoadingBar type="team" />}
        {error && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "#f87171", fontSize: 12 }}>
            Unable to load team picks — check back shortly.
          </div>
        )}
        {!isLoading && !error && !data?.pick1 && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "#6b7280", fontSize: 12 }}>
            No qualifying team picks for today yet.
          </div>
        )}

        {/* Today's picks */}
        {data?.pick1 && (
          <div style={{ marginBottom: 10 }}>
            <TeamWinCard
              pick={{ ...data.pick1, result: history[data.date]?.pick1?.result ?? "pending" }}
              slot="pick1"
              isOwner={isOwner}
              onGrade={(slot, result) => gradeMutation.mutate({ date: data.date, result, which: slot })}
            />
          </div>
        )}
        {data?.pick2 && (
          <TeamWinCard
            pick={{ ...data.pick2, result: history[data.date]?.pick2?.result ?? "pending" }}
            slot="pick2"
            isOwner={isOwner}
            onGrade={(slot, result) => gradeMutation.mutate({ date: data.date, result, which: slot })}
          />
        )}

        {data?.gamesAnalyzed > 0 && (
          <p style={{ fontSize: 10, color: "#6b7280", marginTop: 10, textAlign: "center" }}>
            {data.gamesAnalyzed} games scored · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT" : ""}
          </p>
        )}

        {/* Yesterday's picks — always visible */}
        {recentEntries.filter((e: any) => e.date === yesterdayStr).length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid rgba(19,35,58,0.08)", paddingTop: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: "#3D4B58", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>Yesterday</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recentEntries.filter((e: any) => e.date === yesterdayStr).map(renderHistoryEntry)}
            </div>
          </div>
        )}

        {/* Older history — collapsible drawer */}
        {olderEntries.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "1px solid rgba(19,35,58,0.08)", paddingTop: 10 }}>
            <button
              onClick={() => setShowOlderHistory(v => !v)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.10)",
                borderRadius: 10, padding: "9px 14px", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <History size={13} style={{ color: "#3D4B58" }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: "#131A24" }}>Past Picks ({olderEntries.length} days)</span>
              </div>
              {showOlderHistory ? <ChevronUp size={14} style={{ color: "#3D4B58" }} /> : <ChevronDown size={14} style={{ color: "#3D4B58" }} />}
            </button>
            {showOlderHistory && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {olderEntries.map(renderHistoryEntry)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PickOfDayCard({ pick, label, isRunnerUp = false, isOwner = false, onGrade }: {
  pick: any; label: string; isRunnerUp?: boolean; isOwner?: boolean;
  onGrade?: (which: "primary" | "runnerUp", result: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const which = isRunnerUp ? "runnerUp" : "primary";
  const mlFmt = (ml: number | null | undefined) => ml == null ? "" : ml > 0 ? `+${ml}` : `${ml}`;
  const spreadFmt = (s: number | null | undefined) => s == null ? "" : s > 0 ? `+${s}` : `${s}`;
  const a = pick.analysis ?? {};
  const sharp = a.sharp ?? {};
  const starters = a.starters ?? {};
  const pickStarter = starters.pick ?? {};
  const oppStarter = starters.opp ?? {};
  const offVsPitch = a.offenseVsPitching ?? {};
  const pickBatting = offVsPitch.pickTeamBatting ?? {};
  const oppPitching = offVsPitch.oppTeamPitching ?? {};
  const weather = a.weather ?? null;
  const homeField = a.homeField ?? {};
  const market = a.market ?? {};

  const Section = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: "#131A24", textTransform: "uppercase", letterSpacing: 1, marginBottom: 7,
        display: "flex", alignItems: "center", gap: 5 }}>
        <span>{icon}</span><span>{title}</span>
      </div>
      {children}
    </div>
  );

  const StatRow = ({ label: lbl, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "4px 0", borderBottom: "1px solid rgba(19,35,58,0.05)" }}>
      <span style={{ fontSize: 11, color: "#3D4B58" }}>{lbl}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: highlight ? "#D4A843" : "#131A24" }}>{value}</span>
        {sub && <div style={{ fontSize: 9, color: "#6b7280" }}>{sub}</div>}
      </div>
    </div>
  );

  const TileRow = ({ items }: { items: Array<{ label: string; value: string; color?: string }> }) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.filter(Boolean).map((t, i) => (
        <div key={i} style={{ background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "5px 10px", flex: "1 1 auto", minWidth: 70 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 }}>{t.label}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: t.color ?? "#131A24" }}>{t.value}</div>
        </div>
      ))}
    </div>
  );

  const handleShare = () => { setShowShareModal(true); };

  return (
    <>
    {/* Result-aware colors matching BTS player pick cards */}
    <div style={{
      borderRadius: 14, overflow: "hidden",
      border: pick.result === "win" ? "1.5px solid rgba(34,197,94,0.35)"
            : pick.result === "loss" ? "1.5px solid rgba(239,68,68,0.30)"
            : pick.result === "push" ? "1.5px solid rgba(250,204,21,0.35)"
            : isRunnerUp ? "1.5px solid rgba(19,35,58,0.10)" : "1.5px solid rgba(212,168,67,0.35)",
      background: pick.result === "win" ? "rgba(34,197,94,0.04)"
                : pick.result === "loss" ? "rgba(239,68,68,0.03)"
                : pick.result === "push" ? "rgba(250,204,21,0.04)"
                : isRunnerUp ? "rgba(19,35,58,0.02)" : "rgba(212,168,67,0.04)",
    }}>

      {/* Result banner — shows above header when graded */}
      {pick.result && pick.result !== "pending" && (
        <div style={{
          background: pick.result === "win" ? "rgba(34,197,94,0.12)" : pick.result === "loss" ? "rgba(239,68,68,0.10)" : "rgba(250,204,21,0.12)",
          borderBottom: pick.result === "win" ? "1px solid rgba(34,197,94,0.25)" : pick.result === "loss" ? "1px solid rgba(239,68,68,0.20)" : "1px solid rgba(250,204,21,0.25)",
          padding: "5px 14px", display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13 }}>{pick.result === "win" ? "✅" : pick.result === "loss" ? "❌" : "➡️"}</span>
            <span style={{ fontSize: 12, fontWeight: 900, color: pick.result === "win" ? "#16a34a" : pick.result === "loss" ? "#dc2626" : "#b8930a" }}>
              {pick.result.toUpperCase()}
            </span>
            {pick.finalScore && (
              <span style={{ fontSize: 10, color: "#3D4B58", fontWeight: 600 }}>— {pick.finalScore}</span>
            )}
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#6b7280" }}>Grade {pick.grade} · {pick.score}/100</span>
        </div>
      )}

      {/* Header row */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: isRunnerUp ? "rgba(19,35,58,0.06)" : "rgba(212,168,67,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isRunnerUp ? <Star size={16} style={{ color: "#6b7280" }} /> : <Trophy size={16} style={{ color: "#D4A843" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>{label}</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#131A24", lineHeight: 1.2 }}>{pick.pickTeam}</div>
          <div style={{ fontSize: 10, color: "#3D4B58", marginTop: 1 }}>
            {pick.awayTeam} @ {pick.homeTeam}
            {pick.pickML != null ? ` · ML ${mlFmt(pick.pickML)}` : ""}
            {pick.spread != null ? ` · Spread ${spreadFmt(pick.spread)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          {/* Only show grade/score in header; result shown in banner above */}
          {(!pick.result || pick.result === "pending") && (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: gradeColor(pick.grade) }}>{pick.grade}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58" }}>{pick.score}/100</div>
              {resultBadge("pending")}
            </>
          )}
          {pick.result && pick.result !== "pending" && (
            <div style={{ fontSize: 18, fontWeight: 900, color: pick.result === "win" ? "#16a34a" : pick.result === "loss" ? "#dc2626" : "#b8930a" }}>
              {pick.grade}
            </div>
          )}
        </div>
        {open ? <ChevronUp size={14} style={{ color: "#6b7280", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "#6b7280", flexShrink: 0 }} />}
      </div>

      {/* Deep Analysis Drawer */}
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid rgba(19,35,58,0.08)" }}>

          {/* Quick tiles */}
          <div style={{ marginTop: 12, marginBottom: 14 }}>
            <TileRow items={[
              { label: "Confidence", value: `${pick.score}/100` },
              { label: "Grade", value: pick.grade, color: gradeColor(pick.grade) },
              market.impliedWinPct ? { label: "Implied Win%", value: `${market.impliedWinPct}%` } : null,
              pick.total ? { label: "O/U", value: `${pick.total}` } : null,
            ].filter(Boolean) as any} />
          </div>

          {/* Simulation Results */}
          {a.simulation && (
            <div style={{ marginBottom: 14, padding: "12px 14px", background: "rgba(19,35,58,0.04)", borderRadius: 12, border: "1px solid rgba(19,35,58,0.08)" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#131A24", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 13 }}>🎲</span> 100-Game Monte Carlo Simulation
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#16a34a" }}>{pick.pickTeam} {a.simulation.pickWinPct}%</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626" }}>{pick.oppTeam} {a.simulation.oppWinPct}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "rgba(239,68,68,0.20)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, transition: "width 0.4s",
                    width: `${a.simulation.pickWinPct}%`,
                    background: a.simulation.pickWinPct >= 55 ? "#16a34a" : a.simulation.pickWinPct >= 45 ? "#D4A843" : "#dc2626",
                  }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <div style={{ textAlign: "center", padding: "6px 4px", background: "rgba(34,197,94,0.07)", borderRadius: 8 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>Pred. Score</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: "#131A24" }}>{a.simulation.predictedPickScore}–{a.simulation.predictedOppScore}</div>
                </div>
                <div style={{ textAlign: "center", padding: "6px 4px", background: "rgba(19,35,58,0.04)", borderRadius: 8 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>Avg Runs</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#131A24" }}>{a.simulation.simPickAvg} / {a.simulation.simOppAvg}</div>
                </div>
                <div style={{ textAlign: "center", padding: "6px 4px", background: "rgba(19,35,58,0.04)", borderRadius: 8 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>Tie%</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#131A24" }}>{a.simulation.pushPct}%</div>
                </div>
              </div>
            </div>
          )}

          {/* Sharp Money */}
          {(sharp.sharpScore > 0 || sharp.sharpDirection) && (
            <Section title={sharp.isFallback ? "Sharp Money (Est.)" : "Sharp Money"} icon="💰">
              {sharp.isFallback && (
                <div style={{ background: "rgba(212,168,67,0.10)", borderRadius: 8, padding: "5px 10px",
                  marginBottom: 8, border: "1px solid rgba(212,168,67,0.25)" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#D4A843" }}>⚠️ Estimated — </span>
                  <span style={{ fontSize: 9, color: "#3D4B58" }}>Live Pinnacle data unavailable. Score derived from market odds, ESPN BPI &amp; line movement.</span>
                </div>
              )}
              <div style={{ background: sharp.sharpScore >= 65 ? "rgba(34,197,94,0.06)" : "rgba(19,35,58,0.04)",
                borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: sharp.sharpScore >= 65 ? "#16a34a" : "#131A24" }}>
                      {sharp.sharpDirection ?? "Neutral"}
                    </div>
                    <div style={{ fontSize: 9, color: "#6b7280" }}>Sharp Direction</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: sharp.sharpScore >= 65 ? "#16a34a" : sharp.sharpScore >= 40 ? "#D4A843" : "#dc2626" }}>
                      {sharp.sharpScore ?? 0}
                    </div>
                    <div style={{ fontSize: 9, color: "#6b7280" }}>{sharp.isFallback ? "Est. Score /100" : "Sharp Score /100"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                  {sharp.publicBetPct != null && <div style={{ fontSize: 10, color: "#3D4B58" }}>Public Bets: <b>{Math.round(sharp.publicBetPct)}%{sharp.isFallback ? " (est.)" : ""}</b></div>}
                  {sharp.publicMoneyPct != null && <div style={{ fontSize: 10, color: "#3D4B58" }}>Public Money: <b>{Math.round(sharp.publicMoneyPct)}%{sharp.isFallback ? " (est.)" : ""}</b></div>}
                  {sharp.rlmDetected && <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 700 }}>⚡ RLM: {sharp.rlmSide}</div>}
                  {sharp.pinnacleML != null && <div style={{ fontSize: 10, color: "#3D4B58" }}>Pinnacle ML: <b>{mlFmt(sharp.pinnacleML)}</b></div>}
                  {sharp.spreadDivergence != null && Math.abs(sharp.spreadDivergence) >= 0.5 &&
                    <div style={{ fontSize: 10, color: "#3D4B58" }}>Spread Move: <b>{sharp.spreadDivergence > 0 ? "+" : ""}{sharp.spreadDivergence}</b></div>}
                </div>
                {sharp.sharpSignals && sharp.sharpSignals.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {sharp.sharpSignals.map((sig: string, i: number) => (
                      <span key={i} style={{ fontSize: 9, fontWeight: 700, background: "rgba(19,35,58,0.08)",
                        borderRadius: 6, padding: "2px 7px", color: "#131A24" }}>{sig}</span>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Starter Duel */}
          {(pickStarter.name || oppStarter.name) && (
            <Section title="Starter Duel" icon="⚾">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[{ team: pick.pickTeam, s: pickStarter, isPick: true }, { team: pick.oppTeam ?? (pick.pickTeam === pick.homeTeam ? pick.awayTeam : pick.homeTeam), s: oppStarter, isPick: false }].map(({ team, s, isPick }) => (
                  <div key={team} style={{ background: isPick ? "rgba(212,168,67,0.08)" : "rgba(19,35,58,0.04)",
                    borderRadius: 10, padding: "10px 11px", border: isPick ? "1px solid rgba(212,168,67,0.2)" : "1px solid transparent" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: isPick ? "#D4A843" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 1 }}>
                      {isPick ? "▶ Pick" : "Opp"}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isPick ? "#131A24" : "#3D4B58", marginBottom: 4, letterSpacing: 0.3 }}>{team}</div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#131A24", marginBottom: 5 }}>{s.name ?? "TBD"}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 10, color: "#3D4B58" }}>ERA: <b style={{ color: s.era != null && parseFloat(s.era) < 3.5 ? "#16a34a" : s.era != null && parseFloat(s.era) > 5.0 ? "#dc2626" : "#131A24" }}>{s.era ?? "—"}</b></div>
                      <div style={{ fontSize: 10, color: "#3D4B58" }}>Record: <b>{s.wins ?? 0}-{s.losses ?? 0}</b></div>
                      {s.whip != null && <div style={{ fontSize: 10, color: "#3D4B58" }}>WHIP: <b>{s.whip}</b></div>}
                      {s.k9 != null && <div style={{ fontSize: 10, color: "#3D4B58" }}>K/9: <b>{s.k9}</b></div>}
                      {s.bb9 != null && <div style={{ fontSize: 10, color: "#3D4B58" }}>BB/9: <b>{s.bb9}</b></div>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Team Offense vs Pitching */}
          {(pickBatting.avg || oppPitching.era) && (
            <Section title="Offense vs Pitching" icon="📊">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ background: "rgba(212,168,67,0.06)", borderRadius: 10, padding: "10px 11px",
                  border: "1px solid rgba(212,168,67,0.15)" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#D4A843", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 }}>
                    {pick.pickTeam} Offense
                  </div>
                  {pickBatting.avg && <StatRow label="Batting Avg" value={`.${String(Math.round(parseFloat(pickBatting.avg) * 1000)).padStart(3, "0")}`} />}
                  {pickBatting.ops && <StatRow label="OPS" value={pickBatting.ops} />}
                  {pickBatting.runsPerGame && <StatRow label="Runs/Game" value={pickBatting.runsPerGame} />}
                  {pickBatting.hrPerGame && <StatRow label="HR/Game" value={pickBatting.hrPerGame} />}
                  {pickBatting.strikeoutPct && <StatRow label="K%" value={`${pickBatting.strikeoutPct}%`} />}
                  {pickBatting.walkPct && <StatRow label="BB%" value={`${pickBatting.walkPct}%`} />}
                </div>
                <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "10px 11px" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 }}>
                    Opp Pitching
                  </div>
                  {oppPitching.era && <StatRow label="Team ERA" value={oppPitching.era} />}
                  {oppPitching.whip && <StatRow label="WHIP" value={oppPitching.whip} />}
                  {oppPitching.opponentOps && <StatRow label="Opp OPS" value={oppPitching.opponentOps} />}
                  {oppPitching.k9 && <StatRow label="K/9" value={oppPitching.k9} />}
                  {oppPitching.bb9 && <StatRow label="BB/9" value={oppPitching.bb9} />}
                  {oppPitching.strikeoutPct && <StatRow label="K%" value={`${oppPitching.strikeoutPct}%`} />}
                </div>
              </div>
            </Section>
          )}

          {/* Home/Road Context */}
          {homeField.pickSide && (
            <Section title="Home / Road Split" icon="🏟️">
              <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "10px 12px", display: "flex", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 }}>Playing</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#131A24" }}>{homeField.pickSide}</div>
                </div>
                {homeField.homeRecord && <div>
                  <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 }}>Home Record</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#16a34a" }}>{homeField.homeRecord}</div>
                </div>}
                {homeField.roadRecord && <div>
                  <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 }}>Road Record</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#131A24" }}>{homeField.roadRecord}</div>
                </div>}
              </div>
            </Section>
          )}

          {/* Weather */}
          {weather && (
            <Section title="Stadium Weather" icon="🌤️">
              {weather.isDome ? (
                <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "8px 12px" }}>
                  <span style={{ fontSize: 11, color: "#3D4B58" }}>🏟️ Dome / Retractable Roof — weather neutral</span>
                </div>
              ) : (
                <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: "#3D4B58" }}>🌡️ <b>{weather.tempF}°F</b></div>
                    <div style={{ fontSize: 11, color: "#3D4B58" }}>💨 <b>{weather.windMph}mph {weather.windDir}</b></div>
                    {weather.precipInches > 0 && <div style={{ fontSize: 11, color: "#3D4B58" }}>🌧️ <b>{weather.precipInches}"</b></div>}
                    <div style={{ fontSize: 11, color: "#3D4B58" }}>☁️ <b>{weather.cloudPct}%</b></div>
                    <div style={{ fontSize: 11, color: "#3D4B58" }}>💧 <b>{weather.humidity}%</b></div>
                  </div>
                  <div style={{ fontSize: 10, color: "#3D4B58" }}>{weather.description}</div>
                  {(weather.windOut || weather.windIn) && (
                    <div style={{ marginTop: 5, fontSize: 10, fontWeight: 700,
                      color: weather.windOut ? "#dc2626" : "#16a34a" }}>
                      {weather.windOut ? "⚡ Wind blowing OUT to CF — hitter-friendly" : "🛡️ Wind blowing IN — pitcher-friendly"}
                    </div>
                  )}
                  {weather.impactLabel && weather.impactLabel !== "Neutral" && (
                    <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: weather.hitterImpact < 0 ? "#dc2626" : "#16a34a" }}>
                      Impact: {weather.impactLabel}
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Moneyball Analytics Summary — Hitter Pick */}
          {(() => {
            const xba   = pick.stats?.xba;
            const avg14 = pick.stats?.avg14;
            const avgSeason = pick.stats?.avgSeason;
            const xera  = pick.subScores?.pitcherXera;
            const hh    = pick.stats?.hardHitPct;
            const lines: { icon: string; label: string; body: string }[] = [];

            // xBA vs surface avg — quality of contact
            if (xba != null && (avg14 != null || avgSeason != null)) {
              const surfaceAvg = avg14 ?? avgSeason ?? 0;
              const diff = Math.round((xba - surfaceAvg) * 1000);
              const xbaStr = "." + String(Math.round(xba * 1000)).padStart(3, "0");
              const avgStr = "." + String(Math.round(surfaceAvg * 1000)).padStart(3, "0");
              if (diff >= 30) lines.push({ icon: "🔬", label: "Contact Quality",
                body: `xBA (${xbaStr}) runs +${diff} pts above recent avg (${avgStr}) — hitting the ball harder than results show. Regression to the mean favors this pick.` });
              else if (diff <= -30) lines.push({ icon: "🔬", label: "Contact Quality",
                body: `xBA (${xbaStr}) trails recent avg (${avgStr}) by ${Math.abs(diff)} pts — some luck in current numbers, but other factors qualified this pick.` });
              else lines.push({ icon: "🔬", label: "Contact Quality",
                body: `xBA (${xbaStr}) aligns with recent avg (${avgStr}) — exit velocity and launch angle support the surface stats.` });
            }

            // Hard hit %
            if (hh != null) lines.push({ icon: "🔨", label: "Hard Contact",
              body: `${hh}% of batted balls at 95+ mph exit velocity.${ hh >= 46 ? " Elite barrel rate — nearly half all contact is crushed." : hh >= 38 ? " Above-average power contact." : " Moderate hard-hit rate." }` });

            // Plate appearances
            if (pick.expectedPA > 0) lines.push({ icon: "📋", label: "Opportunity",
              body: `Batting #${pick.lineupSlot ?? "?"}, projected ~${pick.expectedPA} PAs today.${ pick.expectedPA >= 4.5 ? " Top-order volume maximizes hit chances." : pick.expectedPA >= 4.0 ? " Solid PA volume." : " Slightly limited opportunities." }` });

            // Value vs slate
            if (pick.valueOverBaseline != null) lines.push({ icon: "⚖️", label: "Value vs Field",
              body: `${pick.valueOverBaseline >= 0 ? "+" : ""}${pick.valueOverBaseline}pp vs today's slate median (${pick.slateMedian}%).${ pick.valueOverBaseline >= 8 ? " Stands out as a top-tier option on today's slate." : pick.valueOverBaseline >= 3 ? " Above average relative to today's field." : pick.valueOverBaseline >= 0 ? " In line with the top half of today's slate." : " Below today's median but other factors qualified this pick." }` });

            // Top driver
            if (pick.topDrivers?.[0]) lines.push({ icon: pick.topDrivers[0].icon, label: `Top Signal — ${pick.topDrivers[0].name}`,
              body: `${pick.topDrivers[0].label} — the #1 contributor to this pick's score.${ pick.topDrivers[1] ? ` Backed by ${pick.topDrivers[1].icon} ${pick.topDrivers[1].name}: ${pick.topDrivers[1].label}.` : "" }` });

            // Pitcher xERA
            if (xera != null) lines.push({ icon: "⚾", label: "Pitcher True Skill",
              body: `Opposing starter xERA ${xera.toFixed(2)}${ xera >= 4.80 ? " — hittable arm. ERA likely undersells how much contact batters make." : xera >= 4.20 ? " — elevated. Hitters have an edge." : xera <= 3.20 ? " — elite starter. Tough matchup." : " — league-average arm." }` });

            if (lines.length === 0) return null;
            return (
              <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.16)", borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 13 }}>📚</span>
                  <p style={{ fontSize: 10, fontWeight: 900, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.8, margin: 0 }}>Moneyball Analytics</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>{l.icon}</span>
                      <p style={{ fontSize: 11, color: "#3D4B58", lineHeight: 1.4, margin: 0 }}>
                        <strong style={{ color: "#131A24" }}>{l.label}:</strong>{" "}{l.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Why This Pick — Reasoning */}
          <Section title="Edge Summary" icon="📋">
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {(pick.reasons ?? []).map((reason: string, i: number) => {
                const isNeg = /caution|injury|heavy wind|rain|snow|extreme cold|public heavily/i.test(reason);
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ width: 16, height: 16, borderRadius: 8,
                      background: isNeg ? "rgba(239,68,68,0.10)" : "rgba(34,197,94,0.10)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      {isNeg ? <TrendingDown size={8} style={{ color: "#dc2626" }} /> : <CheckCircle size={8} style={{ color: "#16a34a" }} />}
                    </div>
                    <span style={{ fontSize: 11, color: "#3D4B58", lineHeight: 1.4 }}>{reason}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Runner-up note */}
          {isRunnerUp && (
            <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
              <p style={{ fontSize: 10, color: "#6b7280", fontStyle: "italic", margin: 0 }}>Runner-up pick — not graded unless primary pick also fires.</p>
            </div>
          )}

          {/* Share + Owner grade */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={handleShare} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
              padding: "6px 14px", borderRadius: 20, border: "1px solid rgba(19,35,58,0.15)", background: "transparent", cursor: "pointer", color: "#131A24" }}>
              <Share2 size={12} /> Share Pick
            </button>
            {isOwner && (!pick.result || pick.result === "pending") && onGrade && (
              <>
                <button onClick={() => onGrade(which, "win")} style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 20, border: "none",
                  background: "rgba(34,197,94,0.12)", color: "#16a34a", cursor: "pointer" }}>✓ Win</button>
                <button onClick={() => onGrade(which, "loss")} style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 20, border: "none",
                  background: "rgba(239,68,68,0.10)", color: "#dc2626", cursor: "pointer" }}>✗ Loss</button>
                <button onClick={() => onGrade(which, "push")} style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 20, border: "none",
                  background: "rgba(250,204,21,0.10)", color: "#b8930a", cursor: "pointer" }}>~ Push</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>

    {showShareModal && (
      <MlbShareCard pick={pick} label={label} isRunnerUp={isRunnerUp} onClose={() => setShowShareModal(false)} />
    )}
    </>
  );
}

function DailyPickPanel({ alwaysShowHistory = false }: { alwaysShowHistory?: boolean }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showOlderHistory, setShowOlderHistory] = useState(false);
  // In the dedicated Team Pick tab, history is always expanded
  const historyVisible = alwaysShowHistory || showHistory;
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/mlb/pick-of-day"],
    staleTime: 20 * 60 * 1000,
    // Once locked, stop polling — pick won't change
    refetchInterval: (query) => (query.state.data?.locked ? false : 20 * 60 * 1000),
  });
  const isPickLocked = data?.locked === true;

  const gradeMutation = useMutation({
    mutationFn: ({ date, result, which }: any) =>
      fetch("/api/mlb/pick-of-day/grade", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, result, which }) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mlb/pick-of-day"] }),
  });

  const history: Record<string, any> = data?.history ?? {};
  const histEntries = Object.values(history).sort((a: any, b: any) => b.date > a.date ? 1 : -1);
  const wins   = histEntries.filter((e: any) => e.primary?.result === "win").length;
  const losses = histEntries.filter((e: any) => e.primary?.result === "loss").length;
  const graded = wins + losses;
  const pct    = graded > 0 ? Math.round((wins / graded) * 100) : null;

  // Today + yesterday date strings
  const dpTodayStr = (() => {
    const ct = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
    const [m, d, y] = ct.split("/"); return `${y}-${m}-${d}`;
  })();
  const dpYesterdayStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const ct = d.toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
    const [m, dy, y] = ct.split("/"); return `${y}-${m}-${dy}`;
  })();
  const dpOlderEntries = histEntries.filter((e: any) => e.date !== dpTodayStr && e.date !== dpYesterdayStr);
  const dpYesterdayEntry = histEntries.find((e: any) => e.date === dpYesterdayStr);

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden" }}>
      {/* Panel header */}
      <div style={{ background: "#13233A", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Trophy size={15} style={{ color: "#D4A843" }} />
          <span style={{ fontSize: 14, fontWeight: 900, color: "#F6F1E7" }}>MLB Pick of the Day</span>
          {isPickLocked && (
            <span style={{ fontSize: 9, fontWeight: 800, color: "#fbbf24", background: "rgba(251,191,36,0.15)",
              border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "2px 7px", letterSpacing: 0.5 }}>
              🔒 LOCKED
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {graded > 0 && (
            <span style={{ fontSize: 11, fontWeight: 800, color: pct !== null && pct >= 60 ? "#4ade80" : pct !== null && pct >= 40 ? "#fbbf24" : "#f87171" }}>
              {wins}W-{losses}L{pct !== null ? ` (${pct}%)` : ""}
            </span>
          )}
          {!alwaysShowHistory && (
            <button onClick={() => setShowHistory(h => !h)}
              style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.7)", background: "rgba(246,241,231,0.08)",
                border: "none", borderRadius: 12, padding: "4px 10px", cursor: "pointer" }}>
              {showHistory ? "Hide History" : "History"}
            </button>
          )}
        </div>
      </div>
      {isPickLocked && (
        <div style={{ background: "rgba(251,191,36,0.07)", borderBottom: "1px solid rgba(251,191,36,0.15)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11 }}>🔒</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e" }}>Pick locked — within 15 min of first pitch. No further updates.</span>
        </div>
      )}

      {/* ── Record Summary Card (matches BTS hitter record widget) ── */}
      {(() => {
        const CTZ = "America/Chicago";
        const todayStr = (() => {
          const ct = new Date().toLocaleDateString("en-US", { timeZone: CTZ, year: "numeric", month: "2-digit", day: "2-digit" });
          const [m, d, y] = ct.split("/");
          return `${y}-${m}-${d}`;
        })();
        // Today stats
        const todayEntry = history[todayStr] ?? {};
        let todayW = 0, todayL = 0, todayP = 0;
        for (const which of ["primary", "runnerUp"] as const) {
          const p = todayEntry[which];
          if (!p) continue;
          if (p.result === "win") todayW++;
          else if (p.result === "loss") todayL++;
          else todayP++;
        }
        // Season stats — all history entries
        let seasonW = 0, seasonL = 0, seasonP = 0;
        for (const entry of Object.values(history) as any[]) {
          for (const which of ["primary", "runnerUp"] as const) {
            const p = (entry as any)[which];
            if (!p) continue;
            if (p.result === "win") seasonW++;
            else if (p.result === "loss") seasonL++;
            else seasonP++;
          }
        }
        const todayPct   = (todayW + todayL) > 0 ? Math.round(todayW / (todayW + todayL) * 100) : null;
        const seasonPct  = (seasonW + seasonL) > 0 ? Math.round(seasonW / (seasonW + seasonL) * 100) : null;
        return (
          <div style={{ background: "rgba(19,35,58,0.03)", borderBottom: "1px solid rgba(19,35,58,0.08)",
            padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", gap: 24 }}>
              {/* Today */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <BarChart2 size={12} style={{ color: "#60a5fa" }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: "#131A24", textTransform: "uppercase", letterSpacing: 0.8 }}>Today</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 900, color: "#16a34a" }}>{todayW}W</span>
                  <span style={{ fontSize: 13, color: "#6b7280" }}>/</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: "#f87171" }}>{todayL}L</span>
                  {todayP > 0 && <span style={{ fontSize: 11, color: "#6b7280" }}>· {todayP} pending</span>}
                  {todayPct !== null && (
                    <span style={{ fontSize: 11, fontWeight: 800, background: todayPct >= 60 ? "rgba(34,197,94,0.15)" : todayPct >= 40 ? "rgba(250,204,21,0.15)" : "rgba(239,68,68,0.12)",
                      color: todayPct >= 60 ? "#16a34a" : todayPct >= 40 ? "#b8930a" : "#dc2626",
                      borderRadius: 20, padding: "2px 9px" }}>{todayPct}%</span>
                  )}
                </div>
              </div>
              {/* Season */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <TrendingUp size={12} style={{ color: "#22c55e" }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: "#131A24", textTransform: "uppercase", letterSpacing: 0.8 }}>Season Record</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 900, color: "#16a34a" }}>{seasonW}W</span>
                  <span style={{ fontSize: 13, color: "#6b7280" }}>/</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: "#f87171" }}>{seasonL}L</span>
                  {seasonPct !== null && (
                    <span style={{ fontSize: 11, fontWeight: 800, background: seasonPct >= 60 ? "rgba(34,197,94,0.15)" : seasonPct >= 40 ? "rgba(250,204,21,0.15)" : "rgba(239,68,68,0.12)",
                      color: seasonPct >= 60 ? "#16a34a" : seasonPct >= 40 ? "#b8930a" : "#dc2626",
                      borderRadius: 20, padding: "2px 9px" }}>{seasonPct}% win</span>
                  )}
                </div>
              </div>
            </div>
            {/* View picks toggle — only in non-alwaysShowHistory mode */}
            {!alwaysShowHistory && (
              <button onClick={() => setShowHistory(h => !h)}
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
                  color: "#131A24", background: "transparent", border: "none", cursor: "pointer", flexShrink: 0 }}>
                {historyVisible ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {historyVisible ? "Hide picks" : "View picks"}
              </button>
            )}
          </div>
        );
      })()}

      <div style={{ padding: 14 }}>
        {isLoading && <BtsLoadingBar type="mlb" />}
        {error && <div style={{ textAlign: "center", padding: "16px 0", color: "#f87171", fontSize: 12 }}>Unable to load pick — check back shortly.</div>}

        {!isLoading && !error && !data?.primary && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "#6b7280", fontSize: 12 }}>No MLB games found for today yet.</div>
        )}

        {/* Primary pick */}
        {data?.primary && (
          <div style={{ marginBottom: 10 }}>
            <PickOfDayCard
              pick={{ ...data.primary, result: history[data.date]?.primary?.result ?? "pending" }}
              label="Today's Pick"
              isOwner={isOwner}
              onGrade={(which, result) => gradeMutation.mutate({ date: data.date, result, which })}
            />
          </div>
        )}

        {/* Runner-up pick */}
        {data?.runnerUp && (
          <PickOfDayCard
            pick={{ ...data.runnerUp, result: history[data.date]?.runnerUp?.result ?? "pending" }}
            label="Runner-Up"
            isRunnerUp
            isOwner={isOwner}
            onGrade={(which, result) => gradeMutation.mutate({ date: data.date, result, which })}
          />
        )}

        {/* Stats footer */}
        {data?.gamesAnalyzed > 0 && (
          <p style={{ fontSize: 10, color: "#6b7280", marginTop: 10, textAlign: "center" }}>
            {data.gamesAnalyzed} games analyzed · {data.liveData ? "Live odds" : "Seed data"} · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT" : ""}
          </p>
        )}

        {/* Yesterday's pick — always visible */}
        {dpYesterdayEntry && (() => {
          const entry = dpYesterdayEntry;
          const mergePick = (p: any, which: "primary" | "runnerUp") =>
            p ? { ...p, result: entry[which]?.result ?? "pending" } : null;
          const histPrimary = mergePick(entry.primary, "primary");
          const histRunnerUp = mergePick(entry.runnerUp, "runnerUp");
          return (
            <div style={{ marginTop: 14, borderTop: "1px solid rgba(19,35,58,0.08)", paddingTop: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 800, color: "#3D4B58", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>Yesterday</p>
              <div style={{ borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden" }}>
                {histPrimary && (
                  <PickOfDayCard
                    pick={histPrimary}
                    label={`${entry.date} — Primary`}
                    isRunnerUp={false}
                    isOwner={isOwner}
                    onGrade={(which, result) => gradeMutation.mutate({ date: entry.date, result, which })}
                  />
                )}
                {histRunnerUp && (
                  <div style={{ borderTop: "1px solid rgba(19,35,58,0.07)" }}>
                    <PickOfDayCard
                      pick={histRunnerUp}
                      label={`${entry.date} — Runner-Up`}
                      isRunnerUp={true}
                      isOwner={isOwner}
                      onGrade={(which, result) => gradeMutation.mutate({ date: entry.date, result, which })}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Older history — collapsible drawer */}
        {dpOlderEntries.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "1px solid rgba(19,35,58,0.08)", paddingTop: 10 }}>
            <button
              onClick={() => setShowOlderHistory(v => !v)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.10)",
                borderRadius: 10, padding: "9px 14px", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <History size={13} style={{ color: "#3D4B58" }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: "#131A24" }}>Past Picks ({dpOlderEntries.length} days)</span>
              </div>
              {showOlderHistory ? <ChevronUp size={14} style={{ color: "#3D4B58" }} /> : <ChevronDown size={14} style={{ color: "#3D4B58" }} />}
            </button>
            {showOlderHistory && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {dpOlderEntries.map((entry: any) => {
                  const mergePick = (p: any, which: "primary" | "runnerUp") =>
                    p ? { ...p, result: entry[which]?.result ?? "pending" } : null;
                  const histPrimary = mergePick(entry.primary, "primary");
                  const histRunnerUp = mergePick(entry.runnerUp, "runnerUp");
                  return (
                    <div key={entry.date} style={{ borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden" }}>
                      <div style={{ padding: "6px 12px", background: "rgba(19,35,58,0.04)", borderBottom: "1px solid rgba(19,35,58,0.08)" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "#131A24" }}>
                          {new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                      </div>
                      {histPrimary && (
                        <PickOfDayCard
                          pick={histPrimary}
                          label={`${entry.date} — Primary`}
                          isRunnerUp={false}
                          isOwner={isOwner}
                          onGrade={(which, result) => gradeMutation.mutate({ date: entry.date, result, which })}
                        />
                      )}
                      {histRunnerUp && (
                        <div style={{ borderTop: "1px solid rgba(19,35,58,0.07)" }}>
                          <PickOfDayCard
                            pick={histRunnerUp}
                            label={`${entry.date} — Runner-Up`}
                            isRunnerUp={true}
                            isOwner={isOwner}
                            onGrade={(which, result) => gradeMutation.mutate({ date: entry.date, result, which })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Moneyball Grade Utilities ───────────────────────────────────────────────
type MbGrade = "A" | "B" | "C" | "D" | "F";

/** Score a hitter pick on the Moneyball grading scale */
function calcMbGrade(pick: any): MbGrade {
  let pts = 0;

  // Hit probability (0-35 pts)
  const hp = pick.hitProbability ?? 0;
  if (hp >= 80)      pts += 35;
  else if (hp >= 74) pts += 28;
  else if (hp >= 68) pts += 20;
  else if (hp >= 62) pts += 12;
  else               pts += 5;

  // Value over baseline / slate median (0-20 pts)
  const vob = pick.valueOverBaseline ?? 0;
  if (vob >= 12)     pts += 20;
  else if (vob >= 7) pts += 15;
  else if (vob >= 3) pts += 10;
  else if (vob >= 0) pts += 5;
  else               pts += 0;

  // Opposing pitcher xERA — hittable arm boosts grade (0-20 pts)
  const xera = pick.subScores?.pitcherXera ?? 0;
  if (xera >= 5.20)      pts += 20;
  else if (xera >= 4.60) pts += 15;
  else if (xera >= 4.00) pts += 10;
  else if (xera >= 3.40) pts += 5;
  else                   pts += 0; // elite arm, no boost

  // Hard contact % (0-15 pts)
  const hh = pick.stats?.hardHitPct ?? 0;
  if (hh >= 50)      pts += 15;
  else if (hh >= 44) pts += 11;
  else if (hh >= 38) pts += 7;
  else if (hh >= 32) pts += 3;

  // xBA vs recent avg divergence bonus — undervalued by surface stats (0-10 pts)
  const xba = pick.stats?.xba ?? 0;
  const surf = pick.stats?.avg14 ?? pick.stats?.avgSeason ?? 0;
  if (xba > 0 && surf > 0 && (xba - surf) >= 0.040) pts += 10;
  else if (xba > 0 && surf > 0 && (xba - surf) >= 0.020) pts += 5;

  // Convert 0-100 pts to letter grade
  if (pts >= 78) return "A";
  if (pts >= 62) return "B";
  if (pts >= 46) return "C";
  if (pts >= 30) return "D";
  return "F";
}

/** Score a team pick on the Moneyball grading scale */
function calcTeamMbGrade(pick: any): MbGrade {
  let pts = 0;

  // Monte Carlo sim win% (0-35 pts)
  const simPct = pick.simulation?.pickWinPct ?? 0;
  if (simPct >= 68)      pts += 35;
  else if (simPct >= 60) pts += 27;
  else if (simPct >= 54) pts += 18;
  else if (simPct >= 50) pts += 10;
  else                   pts += 4;

  // Pythagorean Win% (0-25 pts)
  const pyth = pick.expectedRuns?.pythagoreanWinPct ?? 0;
  if (pyth >= 65)      pts += 25;
  else if (pyth >= 58) pts += 18;
  else if (pyth >= 53) pts += 11;
  else if (pyth >= 50) pts += 5;

  // Edge (score gap between teams) (0-20 pts)
  const edge = pick.edge ?? 0;
  if (edge >= 18)      pts += 20;
  else if (edge >= 13) pts += 15;
  else if (edge >= 9)  pts += 10;
  else if (edge >= 5)  pts += 5;

  // Top edge driver strength (0-10 pts)
  const ed0gap = pick.edgeDrivers?.[0]?.gap ?? 0;
  if (ed0gap >= 18)      pts += 10;
  else if (ed0gap >= 12) pts += 7;
  else if (ed0gap >= 7)  pts += 4;

  // Opp starter xERA (hittable arm helps the pick team's bats) (0-10 pts)
  const osp    = pick.pickSide === "home" ? pick.starters?.away : pick.starters?.home;
  const ospX   = osp?.xera ?? 0;
  if (ospX >= 5.20)      pts += 10;
  else if (ospX >= 4.60) pts += 7;
  else if (ospX >= 4.00) pts += 4;

  if (pts >= 78) return "A";
  if (pts >= 62) return "B";
  if (pts >= 46) return "C";
  if (pts >= 30) return "D";
  return "F";
}

const MB_GRADE_COLORS: Record<MbGrade, { bg: string; text: string; glow: string }> = {
  A: { bg: "linear-gradient(135deg, #D4A843 0%, #f5c842 60%, #b8860b 100%)", text: "#3a2500", glow: "rgba(212,168,67,0.55)" },
  B: { bg: "linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 60%, #a0a0a0 100%)", text: "#1a1a1a", glow: "rgba(180,180,180,0.45)" },
  C: { bg: "linear-gradient(135deg, #cd7f32 0%, #e8a060 60%, #a0522d 100%)", text: "#2a1000", glow: "rgba(180,100,40,0.40)" },
  D: { bg: "linear-gradient(135deg, #6b7280 0%, #9ca3af 60%, #4b5563 100%)", text: "#f9fafb", glow: "rgba(100,110,120,0.30)" },
  F: { bg: "linear-gradient(135deg, #dc2626 0%, #ef4444 60%, #991b1b 100%)", text: "#fff0f0", glow: "rgba(220,38,38,0.35)" },
};

function MbGradeBadge({ grade, size = "md" }: { grade: MbGrade; size?: "sm" | "md" | "lg" }) {
  const c = MB_GRADE_COLORS[grade];
  const dim = size === "lg" ? 44 : size === "sm" ? 28 : 36;
  const fs  = size === "lg" ? 13 : size === "sm" ? 8  : 11;
  const dfs = size === "lg" ? 7  : size === "sm" ? 5  : 6;
  return (
    <div style={{
      width: dim, height: dim, borderRadius: "50%",
      background: c.bg,
      boxShadow: `0 0 ${size === "lg" ? 12 : 8}px ${c.glow}, inset 0 1px 2px rgba(255,255,255,0.35)`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      border: "1.5px solid rgba(255,255,255,0.25)",
    }}>
      <span style={{ fontSize: dfs, fontWeight: 900, color: c.text, lineHeight: 1, letterSpacing: 0 }}>$</span>
      <span style={{ fontSize: fs, fontWeight: 900, color: c.text, lineHeight: 1 }}>{grade}</span>
    </div>
  );
}

// ─── BTS Loading Progress Bar ───────────────────────────────────────────────
function BtsLoadingBar({ type }: { type: "hitters" | "team" | "mlb" }) {
  const [pct, setPct] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);

  const stages = type === "hitters" ? [
    { label: "Fetching today's MLB schedule", target: 12 },
    { label: "Loading confirmed lineups",      target: 28 },
    { label: "Pulling pitcher matchup data",   target: 46 },
    { label: "Fetching Statcast metrics",      target: 63 },
    { label: "Scoring hitter candidates",      target: 80 },
    { label: "Ranking & applying ML weights",  target: 94 },
    { label: "Finalizing picks…",              target: 99 },
  ] : type === "team" ? [
    { label: "Fetching today's MLB schedule",  target: 14 },
    { label: "Loading probable pitchers",      target: 32 },
    { label: "Scoring starter matchups",       target: 52 },
    { label: "Evaluating bullpen & lineups",   target: 70 },
    { label: "Running 100 Monte Carlo sims",   target: 86 },
    { label: "Applying coherence gate",        target: 96 },
    { label: "Finalizing team picks…",         target: 99 },
  ] : [
    { label: "Fetching today's MLB games",     target: 18 },
    { label: "Pulling pitcher data",           target: 40 },
    { label: "Analyzing team matchups",        target: 68 },
    { label: "Simulating game outcomes",       target: 88 },
    { label: "Finalizing pick…",               target: 99 },
  ];

  useEffect(() => {
    let frame: ReturnType<typeof setTimeout>;
    const tick = () => {
      setPct(prev => {
        const currentStage = stages[stageIdx];
        const target = currentStage?.target ?? 99;
        if (prev < target) {
          // Speed varies: fast early, slows near each stage target
          const gap = target - prev;
          const step = gap > 20 ? 2.2 : gap > 8 ? 1.2 : 0.4;
          return Math.min(target, prev + step);
        }
        // Advance stage once target reached
        if (stageIdx < stages.length - 1) {
          setStageIdx(s => s + 1);
        }
        return prev;
      });
      frame = setTimeout(tick, 80);
    };
    frame = setTimeout(tick, 80);
    return () => clearTimeout(frame);
  }, [stageIdx]);

  const currentLabel = stages[Math.min(stageIdx, stages.length - 1)]?.label ?? "Loading…";
  const displayPct = Math.round(pct);

  return (
    <div style={{
      borderRadius: 16,
      border: "1px solid rgba(19,35,58,0.10)",
      background: "#fff",
      padding: "18px 20px",
      marginBottom: 4,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#22c55e",
            boxShadow: "0 0 6px rgba(34,197,94,0.7)",
            animation: "pulse 1.4s ease-in-out infinite",
          }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: "#131A24" }}>
            {type === "hitters" ? "Building BTS Hitter Picks" : type === "team" ? "Scoring Team Win Picks" : "Analyzing MLB Pick of the Day"}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 900, color: displayPct >= 80 ? "#22c55e" : "#D4A843", fontVariantNumeric: "tabular-nums" }}>
          {displayPct}%
        </span>
      </div>

      {/* Progress track */}
      <div style={{
        height: 8, borderRadius: 999,
        background: "rgba(19,35,58,0.08)",
        overflow: "hidden",
        marginBottom: 10,
      }}>
        <div style={{
          height: "100%",
          borderRadius: 999,
          width: `${pct}%`,
          background: `linear-gradient(90deg, #D4A843 0%, #22c55e ${Math.min(100, pct + 20)}%)`,
          transition: "width 0.08s linear",
          boxShadow: "0 0 8px rgba(34,197,94,0.35)",
        }} />
      </div>

      {/* Stage dots */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
        {stages.map((s, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 999,
            background: i < stageIdx ? "#22c55e"
                      : i === stageIdx ? "#D4A843"
                      : "rgba(19,35,58,0.10)",
            transition: "background 0.3s",
          }} />
        ))}
      </div>

      {/* Current stage label */}
      <p style={{ fontSize: 11, color: "#3D4B58", fontWeight: 600 }}>
        <span style={{ marginRight: 6 }}>⏳</span>{currentLabel}
      </p>
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

              {/* Driver win rates */}
              {(data.byDriver ?? []).filter((r: any) => r.total >= 3).length > 0 && (
                <SplitSection title="Win % by Top Model Driver" rows={(data.byDriver ?? []).filter((r: any) => r.total >= 3)} />
              )}

              {/* Value over baseline */}
              {(data.byVob ?? []).filter((r: any) => r.total > 0).length > 0 && (
                <SplitSection title="Win % by Value vs Slate Median" rows={data.byVob ?? []} />
              )}

              {/* Win % by Moneyball Grade — computed client-side from graded picks */}
              {(() => {
                const allPicks: any[] = data.picks ?? [];
                const graded = allPicks.filter((p: any) => p.result === "win" || p.result === "loss");
                if (graded.length < 3) return null;
                const buckets: Record<MbGrade, { wins: number; total: number }> = {
                  A: { wins: 0, total: 0 }, B: { wins: 0, total: 0 },
                  C: { wins: 0, total: 0 }, D: { wins: 0, total: 0 }, F: { wins: 0, total: 0 },
                };
                for (const p of graded) {
                  const g = calcMbGrade(p);
                  buckets[g].total++;
                  if (p.result === "win") buckets[g].wins++;
                }
                const rows = (["A","B","C","D","F"] as MbGrade[]).map(g => ({
                  label: g,
                  wins: buckets[g].wins,
                  total: buckets[g].total,
                  pct: buckets[g].total > 0 ? Math.round(buckets[g].wins / buckets[g].total * 100) : null,
                })).filter(r => r.total > 0);
                if (rows.length === 0) return null;
                return (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>Win % by Moneyball Grade</p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {rows.map(r => (
                        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <MbGradeBadge grade={r.label as MbGrade} size="sm" />
                          <div style={{ flex: 1 }}>
                            <div style={{ height: 6, borderRadius: 999, background: "rgba(19,35,58,0.08)", overflow: "hidden" }}>
                              <div style={{
                                height: "100%", borderRadius: 999,
                                width: `${r.pct ?? 0}%`,
                                background: (r.pct ?? 0) >= 65 ? "#22c55e" : (r.pct ?? 0) >= 45 ? "#D4A843" : "#ef4444",
                              }} />
                            </div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#131A24", minWidth: 36, textAlign: "right" }}>
                            {r.pct !== null ? `${r.pct}%` : "—"}
                          </span>
                          <span style={{ fontSize: 10, color: MUTED, minWidth: 40 }}>{r.wins}/{r.total}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Team win record */}
              {data.teamWin && (data.teamWin.wins + data.teamWin.losses) > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: MUTED }}>
                    Team Win Picks — Season Record
                  </p>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {[
                      { label: "Wins",   value: String(data.teamWin.wins),   color: "#22c55e" },
                      { label: "Losses", value: String(data.teamWin.losses), color: "#ef4444" },
                      { label: "Win %",  value: data.teamWin.pct !== null ? `${data.teamWin.pct}%` : "—",
                        color: (data.teamWin.pct ?? 0) >= 60 ? "#22c55e" : (data.teamWin.pct ?? 0) >= 40 ? "#eab308" : "#ef4444" },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl p-2.5 text-center"
                        style={{ background: "rgba(19,35,58,0.05)", border: "1px solid rgba(19,35,58,0.08)" }}>
                        <p className="text-base font-black" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[9px] font-semibold mt-0.5" style={{ color: MUTED }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                  {(data.teamWin.byTier ?? []).filter((r: any) => r.total > 0).length > 0 && (
                    <SplitSection title="Team Win % by Tier" rows={(data.teamWin.byTier ?? []).map((r: any) => ({ ...r, label: `Tier ${r.label}` }))} />
                  )}
                </div>
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

          {/* Moneyball Methodology */}
          <div
            className="rounded-xl p-3 mt-1"
            style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.18)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span style={{ fontSize: 16 }}>📚</span>
              <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: "#3b82f6" }}>The Moneyball Methodology</p>
            </div>
            <p className="text-[11px] leading-relaxed mb-3" style={{ color: MUTED }}>
              Clubhouse IQ applies the same data-over-instinct philosophy from Michael Lewis's <em>Moneyball</em> — finding edges the market misprice by leaning on objective metrics instead of reputation or surface stats.
            </p>
            <div className="space-y-2">
              {[
                {
                  icon: "🔬",
                  title: "Quality-of-Contact over Batting Average",
                  body: "xBA and xwOBA measure what a hitter *deserves* based on exit velocity and launch angle. A .220 hitter with a .310 xBA is being unlucky — the model bets on regression to the mean, not current slump.",
                },
                {
                  icon: "⚾",
                  title: "Pitcher True Skill (xERA / FIP)",
                  body: "ERA is polluted by fielding and luck. xERA strips those out, revealing the pitcher's actual run-prevention ability. A 3.20 ERA pitcher with a 4.60 xERA is overrated — batters will catch up.",
                },
                {
                  icon: "📋",
                  title: "Plate Appearance Volume",
                  body: "A leadoff hitter gets ~4.8 PAs vs a 9-hole hitter's ~3.6. More chances = higher hit probability. The model bakes lineup slot directly into scoring, rewarding top-order hitters in favorable matchups.",
                },
                {
                  icon: "⚖️",
                  title: "Value Over Baseline (Slate Median)",
                  body: "Every pick is graded against the day's full candidate pool. A +9pp edge over the median means this pick is in the top tier of the slate — not just good in isolation, but better than the alternatives.",
                },
                {
                  icon: "🎲",
                  title: "Monte Carlo Simulation (Team Picks)",
                  body: "Team win picks run 100 randomized game simulations using each team's actual run-scoring distributions. If the simulation contradicts the model (opponent wins 58%+ of sims), the pick is flipped or disqualified entirely — no pick goes live unless the math backs it up.",
                },
                {
                  icon: "🧮",
                  title: "Pythagorean Win Expectancy",
                  body: "RS²/(RS²+RA²) converts run output into a win probability. Teams that win close games repeatedly tend to regress — Pythagorean win% is a more stable predictor than actual record, used by every serious front office.",
                },
                {
                  icon: "🤖",
                  title: "ML Feedback Loop",
                  body: "Every graded pick updates the model's weights. If \"Pitcher Matchup\" picks are winning at 75% this season, that component gains influence. Underperforming signals get down-weighted automatically over time.",
                },
              ].map(item => (
                <div key={item.title} className="rounded-lg p-2.5" style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)" }}>
                  <div className="flex items-start gap-2">
                    <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                    <div>
                      <p className="text-[11px] font-black text-foreground mb-0.5">{item.title}</p>
                      <p className="text-[10px] leading-relaxed" style={{ color: MUTED }}>{item.body}</p>
                    </div>
                  </div>
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
    mutationFn: (purge = false) => apiRequest("POST", "/api/bts/reset-ciq-today", purge ? { purge: true } : {}).then(r => r.json()),
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
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (!confirm("Reset today's CIQ pick and repick the best available player?")) return;
                      resetCiqMutation.mutate(false);
                    }}
                    disabled={resetCiqMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                    style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.20)" }}
                    title="Reset today's CIQ pick and repick from unstarted games"
                  >
                    <RotateCcw size={10} className={resetCiqMutation.isPending ? "animate-spin" : ""} />
                    Reset & Repick
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm("Wipe today's CIQ pick completely? The streak goes back to 1 and no new pick is made today.")) return;
                      resetCiqMutation.mutate(true);
                    }}
                    disabled={resetCiqMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                    style={{ background: "rgba(239,68,68,0.06)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.15)" }}
                    title="Wipe today completely — streak goes back to prior day, no repick"
                  >
                    <X size={10} />
                    Wipe Today
                  </button>
                </div>
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
  const [btsTab, setBtsTab] = useState<"hitters" | "team">("hitters");
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
    refetchInterval: 5 * 60_000,   // refresh every 5 min (was 15)
    refetchOnMount: "always",       // always fetch fresh on mount
    refetchOnWindowFocus: true,     // refetch when tab regains focus
    retry: 2,
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

      {/* ── Tab Navigation ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 4, background: "rgba(19,35,58,0.05)", borderRadius: 14,
        padding: 4, border: "1px solid rgba(19,35,58,0.08)"
      }}>
        {(["hitters", "team"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setBtsTab(tab)}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 10, border: "none",
              fontSize: 12, fontWeight: 800, cursor: "pointer", transition: "all 0.15s",
              background: btsTab === tab ? "#13233A" : "transparent",
              color: btsTab === tab ? "#F6F1E7" : "#3D4B58",
              boxShadow: btsTab === tab ? "0 1px 4px rgba(19,35,58,0.18)" : "none",
            }}
          >
            {tab === "hitters" ? "⚾ Hitter Picks" : "🏆 Team Pick"}
          </button>
        ))}
      </div>

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

      {/* Loading progress bar */}
      {isLoading && <BtsLoadingBar type="hitters" />}

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
      {/* ── Team Pick Tab ─────────────────────────────────────────── */}
      {btsTab === "team" && (
        <>
          <BtsAnalyticsPanel />
          <TeamWinPanel />
          <DailyPickPanel />
          <HowToReadBTS />
        </>
      )}

      {/* ── Hitter Picks Tab ────────────────────────────────────────── */}
      {btsTab === "hitters" && (<>

      <BtsAnalyticsPanel />

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

      </>)}{/* end hitters tab */}
    </div>
  );
}
