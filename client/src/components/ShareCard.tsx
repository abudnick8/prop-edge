/**
 * ShareCard — screenshot-friendly, no-scroll pick overlay
 *
 * Works for three pick types:
 *   "bts"    — Beat The Streak hitter picks
 *   "prop"   — Player prop bets (any sport)
 *   "team"   — Team bets: spread / moneyline / total
 *
 * Design rules:
 *   • Fixed height = 92dvh — fits one phone screen, never scrolls
 *   • Dark navy card on blurred backdrop (matches Clubhouse IQ theme)
 *   • All key data visible at a glance, branding footer
 *   • Tap outside or X to close
 *   • onTouchMove blocked on backdrop + card to prevent scroll bleed-through
 */

import { useEffect } from "react";
import { X } from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtAvg(v: number | null | undefined) {
  if (v == null || v === 0) return "—";
  return "." + Math.round(v * 1000).toString().padStart(3, "0");
}
function fmtPct(v: number | null | undefined) {
  if (v == null) return "—";
  return (v * 100).toFixed(0) + "%";
}
function fmtOdds(v: number | null | undefined) {
  if (v == null) return "—";
  return v > 0 ? `+${v}` : String(v);
}

// ─── sub-components ───────────────────────────────────────────────────────────

/** Compact stat pill — label on top, value below */
function Pill({
  label,
  value,
  good,
  accent,
}: {
  label: string;
  value: string;
  good?: boolean;
  accent?: string;
}) {
  const fg = accent ?? (good ? "#4ade80" : "#F6F1E7");
  const bg = accent
    ? `${accent}18`
    : good
    ? "rgba(34,197,94,0.10)"
    : "rgba(255,255,255,0.05)";
  const border = accent
    ? `${accent}35`
    : good
    ? "rgba(34,197,94,0.28)"
    : "rgba(255,255,255,0.10)";
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg px-2 py-1.5"
      style={{ background: bg, border: `1px solid ${border}`, minWidth: 50 }}
    >
      <span className="text-[13px] font-black font-mono leading-none" style={{ color: fg }}>
        {value}
      </span>
      <span
        className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-center leading-tight"
        style={{ color: "rgba(246,241,231,0.45)" }}
      >
        {label}
      </span>
    </div>
  );
}

/** Two-column key:value row inside an info box */
function KV({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold" style={{ color: "rgba(246,241,231,0.45)" }}>
        {label}
      </span>
      <span
        className="text-[10px] font-black"
        style={{ color: highlight ? "#facc15" : "#F6F1E7" }}
      >
        {value}
      </span>
    </div>
  );
}

function BulletLine({ text }: { text: string }) {
  const parts = text.replace(/^[•\-] /, "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-[10px] mt-0.5 flex-shrink-0" style={{ color: "#facc15" }}>▸</span>
      <p className="text-[10px] leading-snug" style={{ color: "rgba(246,241,231,0.72)" }}>
        {parts.map((p, i) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={i} style={{ color: "#F6F1E7" }}>{p.slice(2, -2)}</strong>
          ) : (
            <span key={i}>{p}</span>
          )
        )}
      </p>
    </div>
  );
}

function ProbArc({ pct }: { pct: number }) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  const color = pct >= 75 ? "#4ade80" : pct >= 65 ? "#facc15" : "#fb923c";
  return (
    <div className="relative flex-shrink-0" style={{ width: 80, height: 80 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle
          cx={40} cy={40} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={circ - fill}
          strokeLinecap="round" transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black font-mono leading-none" style={{ color }}>{pct}%</span>
        <span className="text-[7px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "rgba(246,241,231,0.4)" }}>
          hit prob
        </span>
      </div>
    </div>
  );
}

function ConfRing({ score }: { score: number }) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  return (
    <div className="relative flex-shrink-0" style={{ width: 80, height: 80 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle
          cx={40} cy={40} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={circ - fill}
          strokeLinecap="round" transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black font-mono leading-none" style={{ color }}>{score}</span>
        <span className="text-[7px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "rgba(246,241,231,0.4)" }}>
          conf
        </span>
      </div>
    </div>
  );
}

// ─── Section container ────────────────────────────────────────────────────────
function Section({
  label,
  accent = "rgba(246,241,231,0.35)",
  children,
}: {
  label: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        className="text-[9px] font-black uppercase tracking-widest mb-1"
        style={{ color: accent, letterSpacing: "0.1em" }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── BTS share layout ─────────────────────────────────────────────────────────
function BTSShare({ pick }: { pick: any }) {
  const stats   = pick.stats   ?? pick.snapshot?.stats   ?? {};
  const pitcher = pick.opponentPitcher ?? pick.snapshot?.opponentPitcher ?? {};
  const pStats  = pick.pitcherStats   ?? pick.snapshot?.pitcherStats    ?? {};
  const game    = pick.game    ?? pick.snapshot?.game    ?? {};
  const bvp     = pick.bvp     ?? pick.snapshot?.bvp     ?? {};
  const hitProb = pick.hitProbability ?? pick.snapshot?.hitProbability ?? 0;
  const tier    = pick.confidenceTier ?? pick.snapshot?.confidenceTier ?? "C";

  const rationale: string = pick.rationale ?? pick.snapshot?.rationale ?? "";
  const lines = rationale.split("\n").filter(Boolean);
  const opener = lines[0] ?? "";
  const bullets = lines.slice(1).filter(Boolean);

  const pitcherAvg = pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed;
  const pitcherHand = pitcher.hand ?? pitcher.throws ?? "";
  const batsHand = pick.bats ?? pick.snapshot?.bats ?? "";

  return (
    <div className="flex flex-col gap-2.5 w-full">

      {/* ── Header: ring + name + matchup ── */}
      <div className="flex items-start gap-3">
        <ProbArc pct={hitProb} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "#facc15", color: "#1a1a1a" }}>
              ⚾ BEAT THE STREAK
            </span>
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}>
              {tier} Tier
            </span>
          </div>
          <p className="text-[20px] font-black leading-tight" style={{ color: "#F6F1E7" }}>{pick.name}</p>
          <p className="text-[11px] font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.55)" }}>
            {pick.team}
            {pick.lineupSlot  != null ? ` · Slot #${pick.lineupSlot  ?? pick.snapshot?.lineupSlot}`  : ""}
            {batsHand ? ` · Bats ${batsHand}` : ""}
          </p>
          {/* Matchup line */}
          <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-1">
            {pitcher.name && (
              <span className="text-[10px]" style={{ color: "rgba(246,241,231,0.6)" }}>
                vs <strong style={{ color: "#F6F1E7" }}>{pitcher.name}</strong>
                {pitcherHand ? ` (${pitcherHand}HP)` : ""}
              </span>
            )}
            {game.matchup && (
              <span className="text-[10px]" style={{ color: "rgba(246,241,231,0.45)" }}>· {game.matchup}</span>
            )}
            {(game.total ?? 0) > 0 && (
              <span className="text-[10px] font-black" style={{ color: game.total >= 9.5 ? "#4ade80" : "rgba(246,241,231,0.7)" }}>
                · O/U {game.total}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-column stats grid ── */}
      <div className="grid grid-cols-2 gap-2">

        {/* Batter stats */}
        <div
          className="rounded-xl p-2.5 space-y-1.5"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#22d3ee" }}>Batter</p>
          <KV label="14d BA" value={fmtAvg(stats.avg14)} highlight={(stats.avg14 ?? 0) >= 0.280} />
          <KV label="7d BA"  value={fmtAvg(stats.avg7)}  highlight={(stats.avg7  ?? 0) >= 0.280} />
          <KV label="xBA"    value={fmtAvg(stats.xba)}   highlight={(stats.xba   ?? 0) >= 0.300} />
          <KV label="GHP"    value={fmtPct(stats.ghp14)} highlight={(stats.ghp14 ?? 0) >= 0.70}  />
          {(stats.hardHitPct ?? 0) > 0 && (
            <KV label="Hard Hit" value={`${stats.hardHitPct?.toFixed(0)}%`} highlight={(stats.hardHitPct ?? 0) >= 42} />
          )}
          {bvp.avg != null && bvp.ab >= 5 && (
            <KV label={`BvP ${bvp.ab}AB`} value={fmtAvg(bvp.avg)} highlight={(bvp.avg ?? 0) >= 0.280} />
          )}
          {stats.obp != null && <KV label="OBP" value={fmtAvg(stats.obp)} />}
          {stats.slg != null && <KV label="SLG" value={fmtAvg(stats.slg)} />}
        </div>

        {/* Pitcher stats */}
        <div
          className="rounded-xl p-2.5 space-y-1.5"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#f87171" }}>Pitcher</p>
          {pitcherAvg != null && (
            <KV
              label={`BA vs ${batsHand === "L" ? "LHB" : "RHB"}`}
              value={fmtAvg(pitcherAvg)}
              highlight={pitcherAvg >= 0.270}
            />
          )}
          {pStats.era  != null && <KV label="ERA"  value={pStats.era.toFixed(2)} />}
          {pStats.xba  != null && <KV label="xBA"  value={fmtAvg(pStats.xba)} highlight={pStats.xba >= 0.280} />}
          {pStats.whip != null && <KV label="WHIP" value={pStats.whip.toFixed(2)} />}
          {pStats.k9   != null && <KV label="K/9"  value={pStats.k9.toFixed(1)} />}
          {pStats.bb9  != null && <KV label="BB/9" value={pStats.bb9.toFixed(1)} />}
          {pStats.hitsAllowed != null && <KV label="H/9" value={pStats.hitsAllowed.toFixed(1)} />}
          {pitcher.season_era != null && <KV label="Szn ERA" value={pitcher.season_era.toFixed(2)} />}
        </div>
      </div>

      {/* ── Opener / rationale summary ── */}
      {(opener || bullets.length > 0) && (
        <div
          className="rounded-xl px-2.5 py-2 space-y-1"
          style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.18)" }}
        >
          {opener && (
            <p className="text-[10px] font-semibold leading-snug" style={{ color: "#F6F1E7" }}>{opener}</p>
          )}
          {bullets.slice(0, 4).map((b, i) => <BulletLine key={i} text={b} />)}
        </div>
      )}

      {/* ── Game time strip ── */}
      {game.gameTime && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="text-[9px]">🕐</span>
          <span className="text-[10px] font-semibold" style={{ color: "rgba(246,241,231,0.55)" }}>{game.gameTime}</span>
        </div>
      )}
    </div>
  );
}

// ─── Prop share layout ────────────────────────────────────────────────────────
function PropShare({ bet }: { bet: any }) {
  const ts         = (bet.teamStats as any) ?? {};
  const score      = bet.confidenceScore ?? 0;
  const scoreColor = score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  const factors: string[] = (bet.keyFactors as string[]) ?? [];

  const statType  = ts.statType  ?? ts.statRaw ?? "";
  const hitRate   = ts.hitRate   != null ? Math.round(ts.hitRate * 100) : null;
  const games     = ts.hitRateGames ?? 5;
  const recentAvg = ts.recentAvg;
  const edgeTier  = ts.edgeTier ?? bet.edgeTier;
  const edgePct   = ts.edgePct  ?? bet.edgePct;
  const overOdds  = bet.overOdds  ?? ts.overOdds  ?? null;
  const underOdds = bet.underOdds ?? ts.underOdds ?? null;
  const pickSide  = ts.pickSide ?? null;

  const TIER_COLOR: Record<string, string> = {
    "A+": "#4ade80", A: "#facc15", B: "#93c5fd", C: "rgba(246,241,231,0.4)",
  };
  const tierColor = edgeTier ? (TIER_COLOR[edgeTier] ?? TIER_COLOR.C) : null;

  return (
    <div className="flex flex-col gap-2.5 w-full">

      {/* Header */}
      <div className="flex items-start gap-3">
        <ConfRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
              {bet.sport} · {bet.betType === "player_prop" ? "Player Prop" : (bet.betType ?? "").replace("_", " ")}
            </span>
            {edgeTier && (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: `${tierColor}1a`, color: tierColor!, border: `1px solid ${tierColor}4d` }}>
                Edge {edgeTier}{edgePct != null ? ` +${edgePct.toFixed(1)}%` : ""}
              </span>
            )}
          </div>
          <p className="text-[18px] font-black leading-tight" style={{ color: "#F6F1E7" }}>{bet.playerName ?? bet.title}</p>
          {bet.playerName && (
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.55)" }}>
              {bet.teamName}{statType ? ` · ${statType}` : ""}{pickSide ? ` · ${pickSide}` : ""}
            </p>
          )}
          {bet.homeTeam && (
            <p className="text-[10px] mt-0.5" style={{ color: "rgba(246,241,231,0.4)" }}>{bet.awayTeam} @ {bet.homeTeam}</p>
          )}
        </div>
      </div>

      {/* Prop line box */}
      {bet.line != null && (
        <div className="rounded-xl px-3 py-2.5 flex items-center justify-between" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.45)" }}>Line</p>
            <p className="text-[28px] font-black font-mono leading-none mt-0.5" style={{ color: "#facc15" }}>
              {bet.line} <span className="text-base">{statType}</span>
            </p>
            {pickSide && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full mt-1 inline-block"
                style={{ background: pickSide.toUpperCase() === "OVER" ? "rgba(74,222,128,0.15)" : "rgba(96,165,250,0.15)", color: pickSide.toUpperCase() === "OVER" ? "#4ade80" : "#60a5fa", border: `1px solid ${pickSide.toUpperCase() === "OVER" ? "rgba(74,222,128,0.3)" : "rgba(96,165,250,0.3)"}` }}>
                {pickSide.toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "rgba(246,241,231,0.45)" }}>Odds</p>
            {pickSide?.toUpperCase() === "OVER"
              ? <p className="text-[22px] font-black font-mono" style={{ color: "#4ade80" }}>{fmtOdds(overOdds)}</p>
              : pickSide?.toUpperCase() === "UNDER"
              ? <p className="text-[22px] font-black font-mono" style={{ color: "#60a5fa" }}>{fmtOdds(underOdds)}</p>
              : <p className="text-[22px] font-black font-mono" style={{ color: "#F6F1E7" }}>{fmtOdds(overOdds ?? underOdds)}</p>
            }
          </div>
        </div>
      )}

      {/* Stats row */}
      {(hitRate != null || recentAvg != null || ts.seasonAvg != null) && (
        <div className="flex gap-2 flex-wrap">
          {hitRate   != null && <Pill label={`Hit Rate L${games}`} value={`${hitRate}%`}              good={hitRate >= 60} />}
          {recentAvg != null && <Pill label="Recent Avg"           value={recentAvg.toFixed(1)}       good={recentAvg > (bet.line ?? 0)} />}
          {ts.seasonAvg != null && <Pill label="Season Avg"        value={ts.seasonAvg.toFixed(1)}   />}
          {ts.l10Avg    != null && <Pill label="L10 Avg"           value={ts.l10Avg.toFixed(1)}       good={ts.l10Avg > (bet.line ?? 0)} />}
        </div>
      )}

      {/* Key factors */}
      {factors.length > 0 && (
        <div className="rounded-xl px-2.5 py-2 space-y-1" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.35)" }}>Why this edge</p>
          {factors.slice(0, 4).map((f, i) => <BulletLine key={i} text={f} />)}
        </div>
      )}

      {/* Market split bar */}
      {overOdds != null && underOdds != null && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.35)" }}>Market Split</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold font-mono" style={{ color: "#4ade80" }}>{fmtOdds(overOdds)}</span>
            <div className="flex-1 h-2.5 rounded-full overflow-hidden flex" style={{ background: "rgba(255,255,255,0.08)" }}>
              {(() => {
                const op = Math.abs(overOdds) / (Math.abs(overOdds) + 100) * 100;
                const up = Math.abs(underOdds) / (Math.abs(underOdds) + 100) * 100;
                const overPct = (op / (op + up)) * 100;
                return (
                  <>
                    <div className="h-full" style={{ width: `${overPct}%`, background: pickSide?.toUpperCase() === "OVER" ? "linear-gradient(90deg,#4ade80,#22c55e)" : "rgba(255,255,255,0.18)" }} />
                    <div className="h-full" style={{ width: `${100 - overPct}%`, background: pickSide?.toUpperCase() === "UNDER" ? "linear-gradient(90deg,#60a5fa,#3b82f6)" : "rgba(255,255,255,0.08)" }} />
                  </>
                );
              })()}
            </div>
            <span className="text-[10px] font-bold font-mono" style={{ color: "#60a5fa" }}>{fmtOdds(underOdds)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Team bet share layout ────────────────────────────────────────────────────
function TeamShare({ bet }: { bet: any }) {
  const ts         = (bet.teamStats as any) ?? {};
  const score      = bet.confidenceScore ?? 0;
  const factors: string[] = (bet.keyFactors as string[]) ?? [];
  const edgeTier   = ts.edgeTier ?? bet.edgeTier;
  const edgePct    = ts.edgePct  ?? bet.edgePct;
  const TIER_COLOR: Record<string, string> = {
    "A+": "#4ade80", A: "#facc15", B: "#93c5fd", C: "rgba(246,241,231,0.4)",
  };
  const tierColor = edgeTier ? (TIER_COLOR[edgeTier] ?? TIER_COLOR.C) : null;

  const betTypeLabel =
    bet.betType === "moneyline" ? "MONEYLINE"
    : bet.betType === "spread"  ? "SPREAD"
    : bet.betType === "total"   ? "TOTAL (O/U)"
    : (bet.betType ?? "").replace("_", " ").toUpperCase();

  const lineDisplay =
    bet.betType === "total"  ? `O/U ${bet.line}`
    : bet.betType === "spread" ? `${(bet.line ?? 0) > 0 ? "+" : ""}${bet.line}`
    : null;

  return (
    <div className="flex flex-col gap-2.5 w-full">

      {/* Header */}
      <div className="flex items-start gap-3">
        <ConfRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.3)" }}>
              {bet.sport} · {betTypeLabel}
            </span>
            {edgeTier && (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: `${tierColor}1a`, color: tierColor!, border: `1px solid ${tierColor}4d` }}>
                Edge {edgeTier}{edgePct != null ? ` +${edgePct.toFixed(1)}%` : ""}
              </span>
            )}
          </div>
          <p className="text-[18px] font-black leading-tight" style={{ color: "#F6F1E7" }}>{bet.teamName ?? bet.title}</p>
          {bet.matchup && (
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.55)" }}>{bet.matchup}</p>
          )}
          {bet.homeTeam && (
            <p className="text-[10px] mt-0.5" style={{ color: "rgba(246,241,231,0.4)" }}>{bet.awayTeam} @ {bet.homeTeam}</p>
          )}
        </div>
      </div>

      {/* Line + odds */}
      <div className="rounded-xl px-3 py-2.5 flex items-center justify-between" style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)" }}>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.45)" }}>{betTypeLabel}</p>
          <p className="text-[28px] font-black font-mono leading-none mt-0.5" style={{ color: "#60a5fa" }}>
            {lineDisplay ?? bet.line ?? "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "rgba(246,241,231,0.45)" }}>Odds</p>
          <p className="text-[22px] font-black font-mono" style={{ color: "#F6F1E7" }}>{fmtOdds(bet.odds ?? ts.pickedOdds)}</p>
        </div>
      </div>

      {/* Team records row */}
      {(ts.homeRecord || ts.awayRecord || ts.homeATS || ts.awayATS) && (
        <div className="flex gap-2 flex-wrap">
          {ts.homeRecord && <Pill label="Home Rec" value={ts.homeRecord} />}
          {ts.awayRecord && <Pill label="Away Rec" value={ts.awayRecord} />}
          {ts.homeATS    && <Pill label="Home ATS" value={ts.homeATS}    good />}
          {ts.awayATS    && <Pill label="Away ATS" value={ts.awayATS} />}
          {ts.streak     && <Pill label="Streak"   value={ts.streak}     good={ts.streak?.startsWith("W")} />}
        </div>
      )}

      {/* Key factors */}
      {factors.length > 0 && (
        <div className="rounded-xl px-2.5 py-2 space-y-1" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.35)" }}>Why this edge</p>
          {factors.slice(0, 5).map((f, i) => <BulletLine key={i} text={f} />)}
        </div>
      )}
    </div>
  );
}

// ─── Main ShareCard export ────────────────────────────────────────────────────
export type SharePickType = "bts" | "prop" | "team";

export interface ShareCardProps {
  type: SharePickType;
  /** BTS: the full pick object. Prop/team: the Bet object */
  data: any;
  onClose: () => void;
}

export default function ShareCard({ type, data, onClose }: ShareCardProps) {
  // Lock body scroll while open — prevents iOS scroll bleed-through
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* Backdrop — blocks ALL touch events from reaching content behind */
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
      onTouchMove={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
    >
      {/* Card — fixed height, no scroll, stops propagation */}
      <div
        className="relative w-full max-w-sm rounded-t-3xl flex flex-col"
        style={{
          background: "linear-gradient(170deg, #13233A 0%, #0d1a28 100%)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderBottom: "none",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.6)",
          maxHeight: "92dvh",
          height: "92dvh",
        }}
        onClick={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        {/* Top drag pill */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center justify-between px-4 pb-2 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-2">
            <svg width={20} height={20} viewBox="0 0 22 22" fill="none">
              <circle cx={11} cy={11} r={10} fill="#facc15" opacity={0.15} />
              <circle cx={11} cy={11} r={10} stroke="#facc15" strokeWidth={1.5} opacity={0.6} />
              <text x={11} y={15} textAnchor="middle" fontSize={10} fontWeight="900" fill="#facc15">IQ</text>
            </svg>
            <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: "#facc15" }}>
              Clubhouse IQ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.25)" }}>
              📸 Share View
            </span>
            <button
              onClick={onClose}
              className="rounded-full p-1.5"
              style={{ background: "rgba(255,255,255,0.08)", WebkitTapHighlightColor: "transparent" }}
            >
              <X size={13} color="#F6F1E7" />
            </button>
          </div>
        </div>

        {/* Content — fixed height, no scroll (screenshot-safe) */}
        <div className="flex-1 overflow-hidden px-4 pt-3 pb-1">
          {type === "bts"  && <BTSShare  pick={data} />}
          {type === "prop" && <PropShare bet={data}  />}
          {type === "team" && <TeamShare bet={data}  />}
        </div>

        {/* Footer branding */}
        <div
          className="flex-shrink-0 px-4 py-2 flex items-center justify-between"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-[9px] font-semibold" style={{ color: "rgba(246,241,231,0.3)" }}>
            clubhouse-iq.up.railway.app
          </p>
          <p className="text-[9px] font-bold" style={{ color: "rgba(246,241,231,0.3)" }}>
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}
