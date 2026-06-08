/**
 * MlbShareCard — Three screenshot-ready share templates for MLB Team Pick of the Day
 *
 * Templates:
 *   "analytics" — Full stats breakdown: sim results, starters, offense vs pitching, sharp money, reasons
 *   "hype"      — Bold visual-first: big team name, emojis, sim win%, predicted score, 3 top reasons
 *   "summary"   — Clean compact card: key stats + predicted score + grade, minimal but complete
 *
 * Each template renders at a fixed width (390px) with no vertical overflow.
 * html2canvas renders each to a PNG → displayed as <img> for long-press save on iOS.
 */

import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { X, Trophy, Star, TrendingUp, Zap } from "lucide-react";

const NAVY = "#13233A";
const GOLD = "#D4A843";
const BG   = "#F6F1E7";
const MUTED = "#3D4B58";

interface MlbShareCardProps {
  pick: any;
  label?: string;
  isRunnerUp?: boolean;
  onClose: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function mlFmt(ml: number | null) {
  if (ml == null) return "—";
  return ml > 0 ? `+${ml}` : String(ml);
}
function gradeColor(g: string) {
  if (!g) return GOLD;
  const c = g[0]?.toUpperCase();
  if (c === "A") return "#16a34a";
  if (c === "B") return "#65a30d";
  if (c === "C") return GOLD;
  return "#dc2626";
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE: ANALYTICS
// Full-detail card: sim, starters, pitching/offense, sharp, reasons
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsTemplate({ pick }: { pick: any }) {
  const a     = pick.analysis ?? {};
  const sim   = a.simulation ?? {};
  const sharp = a.sharp ?? {};
  const ps    = a.pickStarter  ?? {};
  const os    = a.oppStarter   ?? {};
  const pSt   = a.pickStats    ?? {};
  const oSt   = a.oppStats     ?? {};
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ width: 390, background: BG, fontFamily: "'Inter', sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: NAVY, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.5)", textTransform: "uppercase", letterSpacing: 1 }}>Clubhouse IQ · MLB · {today}</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: BG, marginTop: 2 }}>📊 Full Analytics</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: gradeColor(pick.grade), lineHeight: 1 }}>{pick.grade}</div>
          <div style={{ fontSize: 10, color: "rgba(246,241,231,0.55)" }}>{pick.score}/100</div>
        </div>
      </div>

      {/* Pick hero */}
      <div style={{ background: `rgba(212,168,67,0.10)`, borderBottom: `1px solid rgba(19,35,58,0.10)`, padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: NAVY }}>{pick.pickTeam}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>vs {pick.oppTeam} · {pick.awayTeam} @ {pick.homeTeam}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {pick.pickML != null && <span style={{ fontSize: 10, fontWeight: 700, background: NAVY, color: GOLD, borderRadius: 6, padding: "2px 8px" }}>ML {mlFmt(pick.pickML)}</span>}
            {pick.spread != null && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(19,35,58,0.08)", color: NAVY, borderRadius: 6, padding: "2px 8px" }}>Spread {pick.spread > 0 ? "+" : ""}{pick.spread}</span>}
            {pick.total != null && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(19,35,58,0.08)", color: NAVY, borderRadius: 6, padding: "2px 8px" }}>O/U {pick.total}</span>}
          </div>
        </div>
        {/* Predicted score */}
        {pick.predictedScore && (
          <div style={{ textAlign: "center", background: NAVY, borderRadius: 12, padding: "8px 14px" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.5)", textTransform: "uppercase", letterSpacing: 0.8 }}>Predicted</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: GOLD, lineHeight: 1.1 }}>{pick.predictedScore.pick}–{pick.predictedScore.opp}</div>
            <div style={{ fontSize: 8, color: "rgba(246,241,231,0.5)" }}>{sim.pickWinPct}% win</div>
          </div>
        )}
      </div>

      <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Simulation bar */}
        {sim.pickWinPct != null && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>🎲 100-Game Simulation</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#16a34a" }}>{pick.pickTeam} {sim.pickWinPct}%</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626" }}>{pick.oppTeam} {sim.oppWinPct}%</span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: "rgba(239,68,68,0.20)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${sim.pickWinPct}%`, borderRadius: 4,
                background: sim.pickWinPct >= 55 ? "#16a34a" : sim.pickWinPct >= 45 ? GOLD : "#dc2626" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 9, color: MUTED }}>Avg runs: <b>{sim.simPickAvg}</b> / <b>{sim.simOppAvg}</b></span>
              <span style={{ fontSize: 9, color: MUTED }}>Tie: <b>{sim.pushPct}%</b></span>
            </div>
          </div>
        )}

        {/* Starters */}
        {(ps.name || os.name) && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>⚾ Starter Duel</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[{ s: ps, team: pick.pickTeam, isPick: true }, { s: os, team: pick.oppTeam, isPick: false }].map(({ s, team, isPick }) => (
                <div key={team} style={{ background: isPick ? "rgba(212,168,67,0.10)" : "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px",
                  border: isPick ? "1px solid rgba(212,168,67,0.25)" : "1px solid transparent" }}>
                  <div style={{ fontSize: 8, fontWeight: 800, color: isPick ? GOLD : "#6b7280", textTransform: "uppercase", marginBottom: 2 }}>{isPick ? "▶ Pick" : "Opp"}</div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: NAVY }}>{s.name ?? "TBD"}</div>
                  <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>ERA {s.era ?? "—"} · WHIP {s.whip ?? "—"} · W-L {s.wins ?? 0}-{s.losses ?? 0}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team offense */}
        {(pSt.runsPerGame || oSt.teamEra) && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>📈 Offense vs Pitching</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div style={{ background: "rgba(212,168,67,0.08)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(212,168,67,0.18)" }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: GOLD, textTransform: "uppercase", marginBottom: 3 }}>{pick.pickTeam}</div>
                {pSt.runsPerGame && <div style={{ fontSize: 9, color: MUTED }}>R/G <b style={{ color: NAVY }}>{pSt.runsPerGame}</b></div>}
                {pSt.battingAvg  && <div style={{ fontSize: 9, color: MUTED }}>AVG <b style={{ color: NAVY }}>{pSt.battingAvg}</b></div>}
                {pSt.ops         && <div style={{ fontSize: 9, color: MUTED }}>OPS <b style={{ color: NAVY }}>{pSt.ops}</b></div>}
                {pSt.winPct      && <div style={{ fontSize: 9, color: MUTED }}>Win% <b style={{ color: NAVY }}>{Math.round(pSt.winPct * 100)}%</b></div>}
              </div>
              <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", marginBottom: 3 }}>{pick.oppTeam}</div>
                {oSt.runsPerGame && <div style={{ fontSize: 9, color: MUTED }}>R/G <b style={{ color: NAVY }}>{oSt.runsPerGame}</b></div>}
                {oSt.teamEra     && <div style={{ fontSize: 9, color: MUTED }}>ERA <b style={{ color: NAVY }}>{oSt.teamEra}</b></div>}
                {oSt.winPct      && <div style={{ fontSize: 9, color: MUTED }}>Win% <b style={{ color: NAVY }}>{Math.round(oSt.winPct * 100)}%</b></div>}
              </div>
            </div>
          </div>
        )}

        {/* Sharp */}
        {sharp.sharpScore > 0 && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>💰 Sharp Money</div>
            <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(19,35,58,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: sharp.sharpScore >= 65 ? "#16a34a" : NAVY }}>{sharp.sharpDirection ?? "Neutral"}</div>
                {sharp.publicBetPct != null && <div style={{ fontSize: 9, color: MUTED }}>Public: {Math.round(sharp.publicBetPct)}% bets</div>}
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: sharp.sharpScore >= 65 ? "#16a34a" : sharp.sharpScore >= 40 ? GOLD : "#dc2626" }}>{sharp.sharpScore}/100</div>
            </div>
          </div>
        )}

        {/* Reasons */}
        {(pick.reasons ?? []).length > 0 && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>📋 Edge Summary</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(pick.reasons ?? []).slice(0, 6).map((r: string, i: number) => {
                const bad = /caution|injury|wind|rain|underdog/i.test(r);
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 9, fontWeight: 900, color: bad ? "#dc2626" : "#16a34a", marginTop: 1, flexShrink: 0 }}>{bad ? "✕" : "✓"}</span>
                    <span style={{ fontSize: 9, color: MUTED, lineHeight: 1.4 }}>{r}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ background: NAVY, padding: "8px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: GOLD, letterSpacing: 0.8 }}>CLUBHOUSE IQ</div>
        <div style={{ fontSize: 8, color: "rgba(246,241,231,0.4)" }}>clubhouseiqbets@gmail.com</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE: HYPE
// Bold, emoji-heavy, fun visual card
// ─────────────────────────────────────────────────────────────────────────────
function HypeTemplate({ pick }: { pick: any }) {
  const sim  = pick.analysis?.simulation ?? {};
  const topReasons = (pick.reasons ?? []).slice(0, 3);
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
  const winPct = sim.pickWinPct ?? null;
  const fireCount = winPct != null ? (winPct >= 65 ? 3 : winPct >= 55 ? 2 : 1) : 1;
  const fires = "🔥".repeat(fireCount);

  return (
    <div style={{ width: 390, fontFamily: "'Inter', sans-serif", overflow: "hidden",
      background: `linear-gradient(150deg, ${NAVY} 0%, #0d1a2e 60%, #1a0d2e 100%)` }}>

      {/* Top accent bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD}, #f59e0b, ${GOLD})` }} />

      {/* Branding */}
      <div style={{ padding: "12px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: GOLD, letterSpacing: 1.5 }}>CLUBHOUSE IQ</div>
        <div style={{ fontSize: 9, color: "rgba(246,241,231,0.4)" }}>MLB · {today}</div>
      </div>

      {/* Hero */}
      <div style={{ padding: "18px 20px 14px", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(246,241,231,0.5)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>
          {fires} Pick of the Day {fires}
        </div>
        <div style={{ fontSize: 36, fontWeight: 900, color: BG, lineHeight: 1, marginBottom: 4 }}>{pick.pickTeam}</div>
        <div style={{ fontSize: 12, color: "rgba(246,241,231,0.55)" }}>vs {pick.oppTeam}</div>
        {pick.pickML != null && (
          <div style={{ marginTop: 8, display: "inline-block", background: GOLD, color: NAVY, borderRadius: 10, padding: "4px 14px", fontSize: 13, fontWeight: 900 }}>
            ML {mlFmt(pick.pickML)}
          </div>
        )}
      </div>

      {/* Grade + predicted score */}
      <div style={{ margin: "0 20px 14px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.4)", textTransform: "uppercase", marginBottom: 3 }}>Grade</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: gradeColor(pick.grade), lineHeight: 1 }}>{pick.grade}</div>
          <div style={{ fontSize: 9, color: "rgba(246,241,231,0.4)" }}>{pick.score}/100</div>
        </div>
        {pick.predictedScore && (
          <div style={{ background: "rgba(212,168,67,0.12)", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(212,168,67,0.25)" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(212,168,67,0.7)", textTransform: "uppercase", marginBottom: 3 }}>Pred Score</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{pick.predictedScore.pick}–{pick.predictedScore.opp}</div>
            <div style={{ fontSize: 9, color: "rgba(212,168,67,0.6)" }}>projected</div>
          </div>
        )}
        {winPct != null && (
          <div style={{ background: winPct >= 60 ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.06)", borderRadius: 12, padding: "10px 8px", textAlign: "center",
            border: `1px solid ${winPct >= 60 ? "rgba(34,197,94,0.30)" : "rgba(255,255,255,0.08)"}` }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.4)", textTransform: "uppercase", marginBottom: 3 }}>100 Sims</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: winPct >= 60 ? "#4ade80" : winPct >= 50 ? GOLD : "#f87171", lineHeight: 1 }}>{winPct}%</div>
            <div style={{ fontSize: 9, color: "rgba(246,241,231,0.4)" }}>win rate</div>
          </div>
        )}
      </div>

      {/* Reasons */}
      <div style={{ margin: "0 20px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        {topReasons.map((r: string, i: number) => {
          const emojis = ["⚡", "🎯", "💡"];
          const isNeg = /caution|injury|wind|rain/i.test(r);
          return (
            <div key={i} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 12px",
              borderLeft: `3px solid ${isNeg ? "#f87171" : GOLD}`, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 13, flexShrink: 0 }}>{isNeg ? "⚠️" : emojis[i] ?? "✅"}</span>
              <span style={{ fontSize: 10, color: "rgba(246,241,231,0.80)", lineHeight: 1.4 }}>{r}</span>
            </div>
          );
        })}
      </div>

      {/* Matchup footer */}
      <div style={{ background: "rgba(0,0,0,0.25)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 9, color: "rgba(246,241,231,0.4)" }}>{pick.awayTeam} @ {pick.homeTeam}</div>
        <div style={{ fontSize: 9, fontWeight: 900, color: GOLD }}>🏆 CLUBHOUSE IQ</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE: SUMMARY
// Clean compact card — key numbers + a few fun touches
// ─────────────────────────────────────────────────────────────────────────────
function SummaryTemplate({ pick }: { pick: any }) {
  const sim   = pick.analysis?.simulation ?? {};
  const sharp = pick.analysis?.sharp ?? {};
  const ps    = pick.analysis?.pickStarter  ?? {};
  const os    = pick.analysis?.oppStarter   ?? {};
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{ width: 390, background: BG, fontFamily: "'Inter', sans-serif", overflow: "hidden" }}>
      {/* Header bar */}
      <div style={{ background: NAVY, padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 8, color: "rgba(246,241,231,0.45)", textTransform: "uppercase", letterSpacing: 1 }}>Clubhouse IQ · {today}</div>
          <div style={{ fontSize: 13, fontWeight: 900, color: BG, marginTop: 1 }}>⚾ MLB Pick of the Day</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: gradeColor(pick.grade), lineHeight: 1 }}>{pick.grade}</div>
        </div>
      </div>

      {/* Pick */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(19,35,58,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900, color: NAVY }}>{pick.pickTeam} 🏆</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>over {pick.oppTeam}</div>
            <div style={{ fontSize: 10, color: MUTED }}>{pick.awayTeam} @ {pick.homeTeam}</div>
          </div>
          {pick.predictedScore && (
            <div style={{ background: NAVY, borderRadius: 12, padding: "8px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "rgba(246,241,231,0.45)", textTransform: "uppercase" }}>Pred. Score</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: GOLD }}>{pick.predictedScore.pick}–{pick.predictedScore.opp}</div>
            </div>
          )}
        </div>

        {/* Odds chips */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {pick.pickML != null && <span style={{ fontSize: 10, fontWeight: 800, background: NAVY, color: GOLD, borderRadius: 6, padding: "2px 9px" }}>ML {mlFmt(pick.pickML)}</span>}
          {pick.spread  != null && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(19,35,58,0.08)", color: NAVY, borderRadius: 6, padding: "2px 9px" }}>Spread {pick.spread > 0 ? "+" : ""}{pick.spread}</span>}
          {pick.total   != null && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(19,35,58,0.08)", color: NAVY, borderRadius: 6, padding: "2px 9px" }}>O/U {pick.total}</span>}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ padding: "12px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, borderBottom: "1px solid rgba(19,35,58,0.08)" }}>
        {sim.pickWinPct != null && (
          <div style={{ textAlign: "center", background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "8px 6px" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>🎲 Sims</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: sim.pickWinPct >= 55 ? "#16a34a" : sim.pickWinPct >= 45 ? GOLD : "#dc2626" }}>{sim.pickWinPct}%</div>
            <div style={{ fontSize: 8, color: MUTED }}>win (100 sims)</div>
          </div>
        )}
        {ps.name && (
          <div style={{ textAlign: "center", background: "rgba(212,168,67,0.08)", borderRadius: 10, padding: "8px 6px", border: "1px solid rgba(212,168,67,0.18)" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: GOLD, textTransform: "uppercase", marginBottom: 2 }}>⚾ Starter</div>
            <div style={{ fontSize: 11, fontWeight: 900, color: NAVY, lineHeight: 1.2 }}>{ps.name?.split(" ").pop()}</div>
            <div style={{ fontSize: 9, color: MUTED }}>ERA {ps.era ?? "—"}</div>
          </div>
        )}
        {sharp.sharpScore > 0 && (
          <div style={{ textAlign: "center", background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "8px 6px" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>💰 Sharp</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: sharp.sharpScore >= 65 ? "#16a34a" : sharp.sharpScore >= 40 ? GOLD : "#dc2626" }}>{sharp.sharpScore}</div>
            <div style={{ fontSize: 8, color: MUTED }}>{sharp.sharpDirection ?? "neutral"}</div>
          </div>
        )}
      </div>

      {/* Top 3 reasons */}
      <div style={{ padding: "10px 18px 14px" }}>
        {(pick.reasons ?? []).slice(0, 3).map((r: string, i: number) => {
          const bad = /caution|injury|wind|rain/i.test(r);
          return (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: bad ? "#dc2626" : "#16a34a", fontWeight: 900, flexShrink: 0 }}>{bad ? "✕" : "✓"}</span>
              <span style={{ fontSize: 9, color: MUTED, lineHeight: 1.4 }}>{r}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ background: NAVY, padding: "7px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 9, fontWeight: 900, color: GOLD }}>CLUBHOUSE IQ ⚾</div>
        <div style={{ fontSize: 8, color: "rgba(246,241,231,0.35)" }}>clubhouseiqbets@gmail.com</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type TemplateType = "analytics" | "hype" | "summary";

const TEMPLATES: { id: TemplateType; label: string; emoji: string; desc: string }[] = [
  { id: "analytics", label: "Analytics",  emoji: "📊", desc: "Full stats, sim, starters & sharp money" },
  { id: "hype",      label: "Hype",       emoji: "🔥", desc: "Bold visual with emojis & win confidence" },
  { id: "summary",   label: "Summary",    emoji: "⚡", desc: "Clean compact card with key numbers" },
];

export default function MlbShareCard({ pick, label = "Primary Pick", isRunnerUp = false, onClose }: MlbShareCardProps) {
  const [activeTemplate, setActiveTemplate] = useState<TemplateType>("summary");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const renderCanvas = async () => {
    if (!cardRef.current) return;
    setImgUrl(null);
    setRendering(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: activeTemplate === "hype" ? NAVY : BG,
        logging: false,
        windowWidth: 420,
      });
      setImgUrl(canvas.toDataURL("image/png"));
    } catch (e) {
      console.error("html2canvas error:", e);
    } finally {
      setRendering(false);
    }
  };

  // Re-render when template changes
  useEffect(() => {
    setImgUrl(null);
    const t = setTimeout(() => renderCanvas(), 100);
    return () => clearTimeout(t);
  }, [activeTemplate]);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(10,16,28,0.90)", backdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", padding: "16px 16px 40px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal header */}
      <div style={{ width: "100%", maxWidth: 420, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#F6F1E7" }}>Share Pick</div>
        <button onClick={onClose} style={{ background: "rgba(246,241,231,0.10)", border: "none", borderRadius: 10, width: 30, height: 30,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={14} style={{ color: "#F6F1E7" }} />
        </button>
      </div>

      {/* Template selector */}
      <div style={{ width: "100%", maxWidth: 420, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
        {TEMPLATES.map(t => (
          <button key={t.id} onClick={() => setActiveTemplate(t.id)} style={{
            background: activeTemplate === t.id ? "#F6F1E7" : "rgba(246,241,231,0.08)",
            border: activeTemplate === t.id ? "none" : "1px solid rgba(246,241,231,0.12)",
            borderRadius: 12, padding: "8px 6px", cursor: "pointer", textAlign: "center", transition: "all 0.15s",
          }}>
            <div style={{ fontSize: 16 }}>{t.emoji}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: activeTemplate === t.id ? NAVY : "#F6F1E7", marginTop: 2 }}>{t.label}</div>
            <div style={{ fontSize: 8, color: activeTemplate === t.id ? MUTED : "rgba(246,241,231,0.4)", marginTop: 1, lineHeight: 1.3 }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Long-press image */}
      {imgUrl && (
        <div style={{ width: "100%", maxWidth: 420, marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.55)", textAlign: "center", marginBottom: 6 }}>
            📲 Long-press to save image
          </div>
          <img src={imgUrl} alt="Share card" style={{ width: "100%", borderRadius: 14, display: "block",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)" }} />
        </div>
      )}

      {rendering && (
        <div style={{ color: "rgba(246,241,231,0.55)", fontSize: 12, marginBottom: 10 }}>Generating…</div>
      )}

      {/* Off-screen source card for canvas rendering */}
      <div style={{ position: "absolute", left: -9999, top: 0, pointerEvents: "none" }}>
        <div ref={cardRef}>
          {activeTemplate === "analytics" && <AnalyticsTemplate pick={pick} />}
          {activeTemplate === "hype"      && <HypeTemplate      pick={pick} />}
          {activeTemplate === "summary"   && <SummaryTemplate   pick={pick} />}
        </div>
      </div>
    </div>
  );
}
