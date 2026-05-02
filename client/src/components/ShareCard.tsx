/**
 * ShareCard — screenshot-friendly, no-scroll pick overlay
 *
 * Works for three pick types:
 *   "bts"    — Beat The Streak hitter picks
 *   "prop"   — Player prop bets (any sport)
 *   "team"   — Team bets: spread / moneyline / total
 *
 * Design rules:
 *   • Fixed height = 100dvh — fits one phone screen, never scrolls
 *   • Dark navy card on cream backdrop (matches Clubhouse IQ theme)
 *   • All key data visible at a glance, branding footer
 *   • Tap outside or X to close
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

function StatPill({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[56px]"
      style={{
        background: good ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.06)",
        border: `1px solid ${good ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.12)"}`,
      }}
    >
      <span
        className="text-base font-black font-mono leading-none"
        style={{ color: good ? "#4ade80" : "#F6F1E7" }}
      >
        {value}
      </span>
      <span
        className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
        style={{ color: "rgba(246,241,231,0.5)" }}
      >
        {label}
      </span>
    </div>
  );
}

function ProbArc({ pct }: { pct: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  const color =
    pct >= 75 ? "#4ade80" : pct >= 65 ? "#facc15" : "#fb923c";
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width={96} height={96} viewBox="0 0 96 96">
        <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle
          cx={48} cy={48} r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={circ}
          strokeDashoffset={circ - fill}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black font-mono leading-none" style={{ color }}>
          {pct}%
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.45)" }}>
          hit prob
        </span>
      </div>
    </div>
  );
}

function ConfRing({ score }: { score: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color =
    score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width={96} height={96} viewBox="0 0 96 96">
        <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle
          cx={48} cy={48} r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={circ}
          strokeDashoffset={circ - fill}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black font-mono leading-none" style={{ color }}>
          {score}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.45)" }}>
          conf
        </span>
      </div>
    </div>
  );
}

function BulletLine({ text }: { text: string }) {
  // Render **bold** inline
  const parts = text.replace(/^[•\-] /, "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-[11px] mt-0.5 flex-shrink-0" style={{ color: "#facc15" }}>▸</span>
      <p className="text-[11px] leading-snug" style={{ color: "rgba(246,241,231,0.75)" }}>
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

// ─── BTS share layout ─────────────────────────────────────────────────────────
function BTSShare({ pick }: { pick: any }) {
  const stats   = pick.stats ?? pick.snapshot?.stats ?? {};
  const pitcher = pick.opponentPitcher ?? pick.snapshot?.opponentPitcher ?? {};
  const pStats  = pick.pitcherStats ?? pick.snapshot?.pitcherStats ?? {};
  const game    = pick.game ?? pick.snapshot?.game ?? {};
  const bvp     = pick.bvp ?? pick.snapshot?.bvp ?? {};
  const rationale: string = pick.rationale ?? pick.snapshot?.rationale ?? "";

  const lines = rationale.split("\n").filter(Boolean);
  const opener = lines[0] ?? "";
  const bullets = lines.slice(1).filter(Boolean);

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Header row */}
      <div className="flex items-center gap-4">
        <ProbArc pct={pick.hitProbability ?? pick.snapshot?.hitProbability ?? 0} />
        <div className="flex-1 min-w-0">
          {/* Rank badge */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-full"
              style={{ background: "#facc15", color: "#1a1a1a" }}
            >
              ⚾ BEAT THE STREAK
            </span>
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-full"
              style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}
            >
              {pick.confidenceTier ?? pick.snapshot?.confidenceTier ?? "C"} Tier
            </span>
          </div>
          <p className="text-xl font-black leading-tight" style={{ color: "#F6F1E7" }}>
            {pick.name}
          </p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.6)" }}>
            {pick.team} · Slot #{pick.lineupSlot ?? pick.snapshot?.lineupSlot} · Bats {pick.bats ?? pick.snapshot?.bats}
          </p>
        </div>
      </div>

      {/* Matchup strip */}
      <div
        className="rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap text-xs"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <span style={{ color: "rgba(246,241,231,0.6)" }}>
          vs <strong style={{ color: "#F6F1E7" }}>{pitcher.name ?? "TBD"}</strong>
        </span>
        <span style={{ color: "rgba(246,241,231,0.25)" }}>·</span>
        <span style={{ color: "rgba(246,241,231,0.6)" }}>{game.matchup ?? ""}</span>
        <span style={{ color: "rgba(246,241,231,0.25)" }}>·</span>
        <span style={{ color: "rgba(246,241,231,0.6)" }}>{game.gameTime ?? ""}</span>
        {(game.total ?? 0) > 0 && (
          <>
            <span style={{ color: "rgba(246,241,231,0.25)" }}>·</span>
            <span
              className="font-black"
              style={{ color: game.total >= 9.5 ? "#4ade80" : "#F6F1E7" }}
            >
              O/U {game.total}
            </span>
          </>
        )}
      </div>

      {/* Hitter stats */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(246,241,231,0.4)" }}>
          Batter Stats
        </p>
        <div className="flex gap-2 flex-wrap">
          <StatPill label="14d BA" value={fmtAvg(stats.avg14)} good={(stats.avg14 ?? 0) >= 0.280} />
          <StatPill label="7d BA"  value={fmtAvg(stats.avg7)}  good={(stats.avg7  ?? 0) >= 0.280} />
          <StatPill label="xBA"    value={fmtAvg(stats.xba)}   good={(stats.xba   ?? 0) >= 0.300} />
          <StatPill label="GHP"    value={fmtPct(stats.ghp14)} good={(stats.ghp14 ?? 0) >= 0.70}  />
          {(stats.hardHitPct ?? 0) > 0 && (
            <StatPill label="Hard Hit" value={stats.hardHitPct?.toFixed(0) + "%"} good={(stats.hardHitPct ?? 0) >= 42} />
          )}
          {bvp.avg != null && bvp.ab >= 5 && (
            <StatPill label={`BvP (${bvp.ab}AB)`} value={fmtAvg(bvp.avg)} good={(bvp.avg ?? 0) >= 0.280} />
          )}
        </div>
      </div>

      {/* Pitcher matchup */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(246,241,231,0.4)" }}>
          Pitcher Matchup
        </p>
        <div className="flex gap-2 flex-wrap">
          {(pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed) != null && (
            <StatPill
              label={`BA vs ${pick.bats === "L" ? "LHB" : "RHB"}`}
              value={fmtAvg(pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed)}
              good={(pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed ?? 0) >= 0.270}
            />
          )}
          {pStats.era  != null && <StatPill label="ERA"  value={pStats.era.toFixed(2)}  />}
          {pStats.xba  != null && <StatPill label="xBA"  value={fmtAvg(pStats.xba)}     good={pStats.xba >= 0.280} />}
          {pStats.whip != null && <StatPill label="WHIP" value={pStats.whip.toFixed(2)} />}
          {pStats.k9   != null && <StatPill label="K/9"  value={pStats.k9.toFixed(1)}   />}
        </div>
      </div>

      {/* Rationale */}
      {(opener || bullets.length > 0) && (
        <div
          className="rounded-xl px-3 py-2.5 space-y-1"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          {opener && (
            <p className="text-[12px] font-semibold leading-snug" style={{ color: "#F6F1E7" }}>{opener}</p>
          )}
          {bullets.slice(0, 3).map((b, i) => <BulletLine key={i} text={b} />)}
        </div>
      )}
    </div>
  );
}

// ─── Prop share layout ────────────────────────────────────────────────────────
function PropShare({ bet }: { bet: any }) {
  const ts     = (bet.teamStats as any) ?? {};
  const score  = bet.confidenceScore ?? 0;
  const scoreColor = score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  const factors: string[] = (bet.keyFactors as string[]) ?? [];

  const statType  = ts.statType  ?? ts.statRaw ?? "";
  const hitRate   = ts.hitRate   != null ? Math.round(ts.hitRate * 100) : null;
  const games     = ts.hitRateGames ?? 5;
  const recentAvg = ts.recentAvg;
  const edgeTier  = ts.edgeTier ?? bet.edgeTier;
  const edgePct   = ts.edgePct  ?? bet.edgePct;
  const overOdds  = ts.overOdds  ?? null;
  const underOdds = ts.underOdds ?? null;
  const pickSide  = ts.pickSide  ?? (bet.betType === "player_prop" ? ts.pickSide : null);

  const TIER_COLOR: Record<string, string> = {
    "A+": "#4ade80", A: "#facc15", B: "#93c5fd", C: "rgba(246,241,231,0.4)",
  };
  const tierColor = edgeTier ? (TIER_COLOR[edgeTier] ?? TIER_COLOR.C) : null;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <ConfRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase"
              style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}
            >
              {bet.sport} · {bet.betType === "player_prop" ? "Player Prop" : bet.betType?.replace("_", " ")}
            </span>
            {edgeTier && (
              <span
                className="text-[10px] font-black px-2 py-0.5 rounded-full"
                style={{ background: `${tierColor}1a`, color: tierColor!, border: `1px solid ${tierColor}4d` }}
              >
                Edge {edgeTier}
                {edgePct != null ? ` +${edgePct.toFixed(1)}%` : ""}
              </span>
            )}
          </div>
          <p className="text-lg font-black leading-tight" style={{ color: "#F6F1E7" }}>
            {bet.playerName ?? bet.title}
          </p>
          {bet.playerName && (
            <p className="text-sm font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.6)" }}>
              {bet.teamName} · {statType} {pickSide ? `· ${pickSide}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Prop line */}
      {bet.line != null && (
        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.5)" }}>
              Line
            </p>
            <p className="text-3xl font-black font-mono" style={{ color: "#facc15" }}>
              {bet.line} {statType}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.5)" }}>
              Best Odds
            </p>
            {pickSide?.toUpperCase() === "OVER" ? (
              <p className="text-2xl font-black font-mono" style={{ color: "#4ade80" }}>{fmtOdds(overOdds)}</p>
            ) : pickSide?.toUpperCase() === "UNDER" ? (
              <p className="text-2xl font-black font-mono" style={{ color: "#60a5fa" }}>{fmtOdds(underOdds)}</p>
            ) : (
              <p className="text-2xl font-black font-mono" style={{ color: "#F6F1E7" }}>{fmtOdds(overOdds ?? underOdds)}</p>
            )}
            {pickSide && (
              <p className="text-[10px] font-bold mt-0.5" style={{ color: "rgba(246,241,231,0.5)" }}>
                {pickSide.toUpperCase()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Recent form + hit rate */}
      {(hitRate != null || recentAvg != null) && (
        <div className="flex gap-2 flex-wrap">
          {hitRate != null && (
            <StatPill
              label={`Hit Rate L${games}`}
              value={`${hitRate}%`}
              good={hitRate >= 60}
            />
          )}
          {recentAvg != null && (
            <StatPill
              label="Recent Avg"
              value={recentAvg.toFixed(1)}
              good={recentAvg > (bet.line ?? 0)}
            />
          )}
          {ts.seasonAvg != null && (
            <StatPill label="Season Avg" value={ts.seasonAvg.toFixed(1)} />
          )}
        </div>
      )}

      {/* Key factors */}
      {factors.length > 0 && (
        <div
          className="rounded-xl px-3 py-2.5 space-y-1"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(246,241,231,0.4)" }}>
            Why this edge
          </p>
          {factors.slice(0, 4).map((f, i) => (
            <BulletLine key={i} text={f} />
          ))}
        </div>
      )}

      {/* Odds bar */}
      {overOdds != null && underOdds != null && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(246,241,231,0.4)" }}>
            Market Split
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold font-mono" style={{ color: "#4ade80" }}>{fmtOdds(overOdds)}</span>
            <div
              className="flex-1 h-3 rounded-full overflow-hidden flex"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              {(() => {
                const op = Math.abs(overOdds) / (Math.abs(overOdds) + 100) * 100;
                const up = Math.abs(underOdds) / (Math.abs(underOdds) + 100) * 100;
                const overPct = (op / (op + up)) * 100;
                return (
                  <>
                    <div
                      className="h-full rounded-l-full"
                      style={{
                        width: `${overPct}%`,
                        background: pickSide?.toUpperCase() === "OVER"
                          ? "linear-gradient(90deg,#4ade80,#22c55e)"
                          : "rgba(255,255,255,0.2)",
                      }}
                    />
                    <div
                      className="h-full rounded-r-full"
                      style={{
                        width: `${100 - overPct}%`,
                        background: pickSide?.toUpperCase() === "UNDER"
                          ? "linear-gradient(90deg,#60a5fa,#3b82f6)"
                          : "rgba(255,255,255,0.1)",
                      }}
                    />
                  </>
                );
              })()}
            </div>
            <span className="text-xs font-bold font-mono" style={{ color: "#60a5fa" }}>{fmtOdds(underOdds)}</span>
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
  const scoreColor = score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  const factors: string[] = (bet.keyFactors as string[]) ?? [];
  const edgeTier   = ts.edgeTier ?? bet.edgeTier;
  const edgePct    = ts.edgePct  ?? bet.edgePct;
  const TIER_COLOR: Record<string, string> = {
    "A+": "#4ade80", A: "#facc15", B: "#93c5fd", C: "rgba(246,241,231,0.4)",
  };
  const tierColor  = edgeTier ? (TIER_COLOR[edgeTier] ?? TIER_COLOR.C) : null;

  const betTypeLabel =
    bet.betType === "moneyline" ? "MONEYLINE"
    : bet.betType === "spread"   ? "SPREAD"
    : bet.betType === "total"    ? "TOTAL (O/U)"
    : (bet.betType ?? "").replace("_", " ").toUpperCase();

  const lineDisplay =
    bet.betType === "total"   ? `O/U ${bet.line}`
    : bet.betType === "spread" ? `${bet.line > 0 ? "+" : ""}${bet.line}`
    : null;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <ConfRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase"
              style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.3)" }}
            >
              {bet.sport} · {betTypeLabel}
            </span>
            {edgeTier && (
              <span
                className="text-[10px] font-black px-2 py-0.5 rounded-full"
                style={{ background: `${tierColor}1a`, color: tierColor!, border: `1px solid ${tierColor}4d` }}
              >
                Edge {edgeTier}{edgePct != null ? ` +${edgePct.toFixed(1)}%` : ""}
              </span>
            )}
          </div>
          <p className="text-lg font-black leading-tight" style={{ color: "#F6F1E7" }}>
            {bet.teamName ?? bet.title}
          </p>
          {bet.matchup && (
            <p className="text-sm font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.6)" }}>
              {bet.matchup}
            </p>
          )}
        </div>
      </div>

      {/* Line + odds */}
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between"
        style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)" }}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.5)" }}>
            {betTypeLabel}
          </p>
          <p className="text-3xl font-black font-mono" style={{ color: "#60a5fa" }}>
            {lineDisplay ?? bet.line ?? "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.5)" }}>
            Odds
          </p>
          <p className="text-2xl font-black font-mono" style={{ color: "#F6F1E7" }}>
            {fmtOdds(bet.odds ?? ts.pickedOdds)}
          </p>
        </div>
      </div>

      {/* Key factors */}
      {factors.length > 0 && (
        <div
          className="rounded-xl px-3 py-2.5 space-y-1"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "rgba(246,241,231,0.4)" }}>
            Why this edge
          </p>
          {factors.slice(0, 5).map((f, i) => (
            <BulletLine key={i} text={f} />
          ))}
        </div>
      )}

      {/* Matchup info */}
      {(ts.homeRecord || ts.awayRecord || ts.homeATS || ts.awayATS) && (
        <div className="flex gap-2 flex-wrap">
          {ts.homeRecord && <StatPill label="Home Rec" value={ts.homeRecord} />}
          {ts.awayRecord && <StatPill label="Away Rec" value={ts.awayRecord} />}
          {ts.homeATS    && <StatPill label="Home ATS" value={ts.homeATS} good />}
          {ts.awayATS    && <StatPill label="Away ATS" value={ts.awayATS} />}
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
  // Lock body scroll while open
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
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      {/* Card — fixed height, no scroll */}
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
            {/* Logo mark */}
            <svg width={22} height={22} viewBox="0 0 22 22" fill="none">
              <circle cx={11} cy={11} r={10} fill="#facc15" opacity={0.15} />
              <circle cx={11} cy={11} r={10} stroke="#facc15" strokeWidth={1.5} opacity={0.6} />
              <text x={11} y={15} textAnchor="middle" fontSize={10} fontWeight="900" fill="#facc15">IQ</text>
            </svg>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#facc15" }}>
              Clubhouse IQ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.25)" }}>
              📸 Share View
            </span>
            <button
              onClick={onClose}
              className="rounded-full p-1.5"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <X size={14} color="#F6F1E7" />
            </button>
          </div>
        </div>

        {/* Scrollable content area — intentionally NOT scrollable */}
        <div className="flex-1 overflow-hidden px-4 pt-3 pb-2">
          {type === "bts"  && <BTSShare  pick={data} />}
          {type === "prop" && <PropShare bet={data}  />}
          {type === "team" && <TeamShare bet={data}  />}
        </div>

        {/* Footer branding */}
        <div
          className="flex-shrink-0 px-4 py-3 flex items-center justify-between"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-[10px] font-semibold" style={{ color: "rgba(246,241,231,0.35)" }}>
            clubhouse-iq.up.railway.app
          </p>
          <p className="text-[10px] font-bold" style={{ color: "rgba(246,241,231,0.35)" }}>
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}
