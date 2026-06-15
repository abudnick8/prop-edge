/**
 * ShareCard — screenshot-friendly pick overlay
 *
 * BTS picks: 3 html2canvas templates (Analytics / Hype / Summary)
 *   Long-press rendered PNG to save on iOS.
 *
 * Prop / Team picks: single live-rendered view (swipe up bottom sheet).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas";
import { X } from "lucide-react";

// ─── palette ──────────────────────────────────────────────────────────────────
const NAVY  = "#13233A";
const GOLD  = "#D4A843";
const BG    = "#F6F1E7";
const MUTED = "#3D4B58";

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
function today(fmt: "short" | "long" = "short") {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    ...(fmt === "long"
      ? { weekday: "short", month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }),
  });
}
function tierColor(ct: string | null | undefined) {
  if (!ct) return GOLD;
  const c = ct[0]?.toUpperCase();
  if (c === "A") return "#16a34a";
  if (c === "B") return "#3b82f6";
  return GOLD;
}

// ─── shared sub-atoms ─────────────────────────────────────────────────────────
function Pill({ label, value, good, accent }: { label: string; value: string; good?: boolean; accent?: string }) {
  const fg = accent ?? (good ? "#4ade80" : "#F6F1E7");
  const bg = accent ? `${accent}18` : good ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.05)";
  const border = accent ? `${accent}35` : good ? "rgba(34,197,94,0.28)" : "rgba(255,255,255,0.10)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "6px 8px", minWidth: 50 }}>
      <span style={{ fontSize: 13, fontWeight: 900, fontFamily: "monospace", color: fg, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
        color: "rgba(246,241,231,0.45)", marginTop: 3, textAlign: "center" }}>{label}</span>
    </div>
  );
}

function KV({ label, value, highlight, lightBg }: { label: string; value: string; highlight?: boolean; lightBg?: boolean }) {
  const labelColor = lightBg ? "#3D4B58" : "rgba(246,241,231,0.50)";
  const valueColor = lightBg
    ? (highlight ? "#16a34a" : "#131A24")
    : (highlight ? "#facc15" : "#F6F1E7");
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: labelColor }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 900, color: valueColor }}>{value}</span>
    </div>
  );
}

function BulletLine({ text, lightBg }: { text: string; lightBg?: boolean }) {
  const parts = text.replace(/^[•\-] /, "").split(/(\*\*[^*]+\*\*)/g);
  const textColor = lightBg ? "#3D4B58" : "rgba(246,241,231,0.75)";
  const boldColor = lightBg ? "#131A24" : "#F6F1E7";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <span style={{ fontSize: 10, marginTop: 1, flexShrink: 0, color: GOLD }}>▸</span>
      <p style={{ fontSize: 10, lineHeight: 1.4, color: textColor, margin: 0 }}>
        {parts.map((p, i) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={i} style={{ color: boldColor }}>{p.slice(2, -2)}</strong>
            : <span key={i}>{p}</span>
        )}
      </p>
    </div>
  );
}

function ProbArc({ pct }: { pct: number }) {
  const r = 32, circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  const color = pct >= 75 ? "#4ade80" : pct >= 65 ? GOLD : "#fb923c";
  return (
    <div style={{ position: "relative", flexShrink: 0, width: 80, height: 80 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={circ - fill}
          strokeLinecap="round" transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color, lineHeight: 1 }}>{pct}%</span>
        <span style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
          color: "rgba(246,241,231,0.4)", marginTop: 2 }}>hit prob</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BTS TEMPLATE 1: ANALYTICS — full depth
// ══════════════════════════════════════════════════════════════════════════════
function BTSAnalytics({ pick }: { pick: any }) {
  const s   = pick.stats          ?? pick.snapshot?.stats          ?? {};
  const p   = pick.opponentPitcher ?? pick.snapshot?.opponentPitcher ?? {};
  const ps  = pick.pitcherStats   ?? pick.snapshot?.pitcherStats    ?? {};
  const g   = pick.game           ?? pick.snapshot?.game            ?? {};
  const bvp = pick.bvp            ?? pick.snapshot?.bvp             ?? {};
  const sub = pick.subScores      ?? pick.snapshot?.subScores       ?? {};
  const prob   = pick.hitProbability ?? pick.snapshot?.hitProbability ?? 0;
  const tier   = pick.confidenceTier ?? pick.snapshot?.confidenceTier ?? "C";
  const raw    = pick.rawScore ?? pick.snapshot?.rawScore ?? 0;
  const edge   = pick.edge ?? pick.snapshot?.edge ?? null;
  const implied = pick.impliedProb ?? pick.snapshot?.impliedProb ?? null;
  const pitcherAvg = pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed;
  const bats   = pick.bats ?? pick.snapshot?.bats ?? "";
  const slot   = pick.lineupSlot ?? pick.snapshot?.lineupSlot ?? null;
  const rationale: string = pick.rationale ?? pick.snapshot?.rationale ?? "";
  const lines  = rationale.split("\n").filter(Boolean);
  const opener = lines[0] ?? "";
  const bullets = lines.slice(1).filter(Boolean);
  const xera   = sub.pitcherXera;
  const platoon = sub.platoonSplitScore;
  const boost  = sub.analyticsBoostMult;

  return (
    <div style={{ width: 390, background: BG, fontFamily: "'Inter', sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: NAVY, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 8, color: "rgba(246,241,231,0.45)", textTransform: "uppercase", letterSpacing: 1 }}>
            Clubhouse IQ · Beat The Streak · {today("long")}
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, color: BG, marginTop: 2 }}>📊 Full Analytics</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: tierColor(tier),
            background: `${tierColor(tier)}20`, border: `1px solid ${tierColor(tier)}50`,
            borderRadius: 8, padding: "2px 8px" }}>{tier} Tier</div>
          <div style={{ fontSize: 10, color: "rgba(246,241,231,0.55)", marginTop: 3 }}>{prob}% hit prob</div>
        </div>
      </div>

      {/* Player hero */}
      <div style={{ background: "rgba(212,168,67,0.08)", borderBottom: "1px solid rgba(19,35,58,0.10)",
        padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <ProbArc pct={prob} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: NAVY, lineHeight: 1 }}>{pick.name}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
            {pick.team}{slot != null ? ` · Slot #${slot}` : ""}{bats ? ` · Bats ${bats}` : ""}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
            vs <strong style={{ color: NAVY }}>{p.name ?? "TBD"}</strong>
            {p.hand ? ` (${p.hand}HP)` : ""}
            {g.matchup ? ` · ${g.matchup}` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
            {(g.total ?? 0) > 0 && (
              <span style={{ fontSize: 9, fontWeight: 800, background: (g.total >= 9.5 ? "rgba(34,197,94,0.12)" : "rgba(19,35,58,0.08)"),
                color: g.total >= 9.5 ? "#16a34a" : NAVY, borderRadius: 6, padding: "1px 7px" }}>O/U {g.total}</span>
            )}
            {edge != null && (
              <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(212,168,67,0.12)", color: NAVY, borderRadius: 6, padding: "1px 7px" }}>
                Edge {edge > 0 ? "+" : ""}{edge}%
              </span>
            )}
            {implied != null && (
              <span style={{ fontSize: 9, fontWeight: 700, background: "rgba(19,35,58,0.06)", color: MUTED, borderRadius: 6, padding: "1px 7px" }}>
                Implied {implied}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Batter + Pitcher split */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {/* Batter */}
          <div style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.10)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: "#2563eb", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>🏏 Batter</div>
            {s.avg14 > 0    && <KV lightBg label="14d BA"    value={fmtAvg(s.avg14)}                       highlight={(s.avg14 ?? 0) >= 0.280} />}
            {s.avg7 > 0     && <KV lightBg label="7d BA"     value={fmtAvg(s.avg7)}                        highlight={(s.avg7 ?? 0) >= 0.300} />}
            {s.avgSeason > 0 && <KV lightBg label="Season BA" value={fmtAvg(s.avgSeason)} />}
            {s.xba > 0      && <KV lightBg label="xBA"       value={fmtAvg(s.xba)}                         highlight={(s.xba ?? 0) >= 0.300} />}
            {s.xwoba > 0    && <KV lightBg label="xwOBA"     value={fmtAvg(s.xwoba)}                       highlight={(s.xwoba ?? 0) >= 0.350} />}
            {s.ghp14 > 0    && <KV lightBg label="GHP (L14)" value={fmtPct(s.ghp14)}                       highlight={(s.ghp14 ?? 0) >= 0.70} />}
            {s.hardHitPct > 0 && <KV lightBg label="Hard Hit%" value={`${s.hardHitPct.toFixed(0)}%`}       highlight={(s.hardHitPct ?? 0) >= 42} />}
            {s.barrelPct > 0  && <KV lightBg label="Barrel%"  value={`${s.barrelPct.toFixed(1)}%`}         highlight={(s.barrelPct ?? 0) >= 8} />}
            {s.kPct > 0       && <KV lightBg label="K%"       value={fmtPct(s.kPct)} />}
            {s.hitStreak > 0  && <KV lightBg label="Streak"   value={`${s.hitStreak}G`}                    highlight={(s.hitStreak ?? 0) >= 4} />}
            {bvp.ab >= 5 && bvp.avg != null && (
              <KV lightBg label={`BvP (${bvp.ab} AB)`} value={fmtAvg(bvp.avg)} highlight={(bvp.avg ?? 0) >= 0.270} />
            )}
          </div>
          {/* Pitcher */}
          <div style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: "#dc2626", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>⚾ Pitcher</div>
            {pitcherAvg != null && (
              <KV lightBg label={`BA vs ${bats === "L" ? "LHB" : "RHB"}`} value={fmtAvg(pitcherAvg)} highlight={pitcherAvg >= 0.270} />
            )}
            {ps.era    != null && <KV lightBg label="ERA"    value={ps.era.toFixed(2)} />}
            {ps.last5ERA != null && <KV lightBg label="L5 ERA" value={ps.last5ERA.toFixed(2)} highlight={ps.last5ERA >= 5.0} />}
            {ps.whip   != null && <KV lightBg label="WHIP"   value={ps.whip.toFixed(2)} />}
            {ps.k9     != null && <KV lightBg label="K/9"    value={ps.k9.toFixed(1)} />}
            {ps.xwoba  != null && <KV lightBg label="xwOBA"  value={ps.xwoba.toFixed(3)} highlight={ps.xwoba >= 0.340} />}
            {ps.swStrPct != null && <KV lightBg label="SwStr%" value={`${ps.swStrPct.toFixed(1)}%`} />}
            {ps.leashProbability != null && (
              <KV lightBg label="Leash" value={`${Math.round(ps.leashProbability * 100)}%`} />
            )}
          </div>
        </div>

        {/* Matchup edge breakdown */}
        {(xera > 0 || platoon != null || boost != null) && (
          <div style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.10)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>🔬 Matchup Edge</div>
            {xera > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: MUTED }}>Pitcher xERA</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: xera <= 3.25 ? "#dc2626" : xera <= 4.50 ? GOLD : "#16a34a" }}>{xera.toFixed(2)}</span>
              </div>
            )}
            {platoon != null && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: MUTED }}>Platoon Split</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: platoon >= 0.65 ? "#16a34a" : platoon <= 0.38 ? "#dc2626" : GOLD }}>
                  {Math.round(platoon * 100)}%
                </span>
              </div>
            )}
            {boost != null && boost !== 1 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9, color: MUTED }}>Analytics Layer</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: boost > 1 ? "#16a34a" : "#dc2626" }}>
                  {boost > 1 ? "+" : ""}{((boost - 1) * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Venue + weather */}
        {(s.venueCareerAvg > 0 || g.weather?.tempF > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {s.venueCareerAvg > 0 && (
              <div style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)", borderRadius: 8, padding: "7px 10px" }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 3 }}>🏟️ Venue</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: NAVY }}>{fmtAvg(s.venueCareerAvg)}</div>
                <div style={{ fontSize: 8, color: MUTED }}>career BA ({s.venueCareerAB ?? "—"} AB)</div>
              </div>
            )}
            {g.weather?.tempF > 0 && (
              <div style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)", borderRadius: 8, padding: "7px 10px" }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 3 }}>🌤️ Weather</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: NAVY }}>{g.weather.isDome ? "🏟️ Dome" : `${g.weather.tempF}°F`}</div>
                {!g.weather.isDome && g.weather.windMph > 0 && (
                  <div style={{ fontSize: 8, color: MUTED }}>{g.weather.wind || `${g.weather.windMph} mph`}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Rationale */}
        {(opener || bullets.length > 0) && (
          <div style={{ background: "rgba(212,168,67,0.06)", border: "1px solid rgba(212,168,67,0.20)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>📋 Analysis</div>
            {opener && <p style={{ fontSize: 9, fontWeight: 600, color: NAVY, lineHeight: 1.4, margin: "0 0 4px" }}>{opener}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {bullets.slice(0, 3).map((b, i) => <BulletLine lightBg key={i} text={b} />)}
            </div>
          </div>
        )}

        {/* Score strip */}
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, textAlign: "center", background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "6px 4px" }}>
            <div style={{ fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 1 }}>Raw Score</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: NAVY }}>{(raw * 100).toFixed(1)}</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", background: "rgba(212,168,67,0.10)", borderRadius: 8, padding: "6px 4px", border: "1px solid rgba(212,168,67,0.25)" }}>
            <div style={{ fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 1 }}>Hit Prob</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: NAVY }}>{prob}%</div>
          </div>
          {implied != null && (
            <div style={{ flex: 1, textAlign: "center", background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "6px 4px" }}>
              <div style={{ fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 1 }}>Implied</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: NAVY }}>{implied}%</div>
            </div>
          )}
          {edge != null && (
            <div style={{ flex: 1, textAlign: "center", background: edge >= 0 ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.06)",
              borderRadius: 8, padding: "6px 4px", border: `1px solid ${edge >= 0 ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.20)"}` }}>
              <div style={{ fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 1 }}>Edge</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: edge >= 0 ? "#16a34a" : "#dc2626" }}>{edge > 0 ? "+" : ""}{edge}%</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: NAVY, padding: "7px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 9, fontWeight: 900, color: GOLD, letterSpacing: 0.8 }}>CLUBHOUSE IQ ⚾</div>
        <div style={{ fontSize: 8, color: "rgba(246,241,231,0.35)" }}>clubhouseiqbets@gmail.com</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BTS TEMPLATE 2: HYPE — bold, fun, emoji-heavy
// ══════════════════════════════════════════════════════════════════════════════
function BTSHype({ pick }: { pick: any }) {
  const s    = pick.stats          ?? pick.snapshot?.stats          ?? {};
  const p    = pick.opponentPitcher ?? pick.snapshot?.opponentPitcher ?? {};
  const g    = pick.game           ?? pick.snapshot?.game            ?? {};
  const bvp  = pick.bvp            ?? pick.snapshot?.bvp             ?? {};
  const prob = pick.hitProbability ?? pick.snapshot?.hitProbability  ?? 0;
  const tier = pick.confidenceTier ?? pick.snapshot?.confidenceTier  ?? "C";
  const rationale: string = pick.rationale ?? pick.snapshot?.rationale ?? "";
  const bullets = rationale.split("\n").filter(Boolean).slice(1, 4);
  const pitcherAvg = pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed;
  const bats = pick.bats ?? pick.snapshot?.bats ?? "";
  const fireCount = prob >= 72 ? 3 : prob >= 66 ? 2 : 1;
  const fires = "🔥".repeat(fireCount);
  const tc = tierColor(tier);

  return (
    <div style={{ width: 390, fontFamily: "'Inter', sans-serif", overflow: "hidden",
      background: `linear-gradient(150deg, ${NAVY} 0%, #0d1a2e 55%, #1b1040 100%)` }}>

      {/* Gold accent bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD}, #f59e0b, ${GOLD})` }} />

      {/* Branding + date */}
      <div style={{ padding: "10px 18px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: GOLD, letterSpacing: 1.5 }}>CLUBHOUSE IQ</div>
        <div style={{ fontSize: 9, color: "rgba(246,241,231,0.4)" }}>BTS · {today("short")}</div>
      </div>

      {/* Hero section */}
      <div style={{ padding: "16px 18px 10px", textAlign: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(246,241,231,0.5)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 5 }}>
          {fires} Beat The Streak {fires}
        </div>
        <div style={{ fontSize: 38, fontWeight: 900, color: BG, lineHeight: 1, marginBottom: 3 }}>{pick.name}</div>
        <div style={{ fontSize: 12, color: "rgba(246,241,231,0.55)", marginBottom: 4 }}>
          {pick.team} · vs {p.name ?? "TBD"}
        </div>
        {/* Tier badge */}
        <div style={{ display: "inline-block", background: `${tc}20`, color: tc, border: `1px solid ${tc}50`,
          borderRadius: 10, padding: "3px 12px", fontSize: 11, fontWeight: 900 }}>
          {tier} Tier
        </div>
      </div>

      {/* Three big stat blocks */}
      <div style={{ margin: "0 16px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div style={{ background: "rgba(212,168,67,0.12)", borderRadius: 12, padding: "10px 8px",
          textAlign: "center", border: "1px solid rgba(212,168,67,0.28)" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(212,168,67,0.7)", textTransform: "uppercase", marginBottom: 3 }}>Hit Prob</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{prob}%</div>
          <div style={{ fontSize: 8, color: "rgba(212,168,67,0.5)", marginTop: 2 }}>confidence</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.4)", textTransform: "uppercase", marginBottom: 3 }}>14d BA</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: (s.avg14 ?? 0) >= 0.280 ? "#4ade80" : BG, lineHeight: 1 }}>{fmtAvg(s.avg14)}</div>
          <div style={{ fontSize: 8, color: "rgba(246,241,231,0.35)", marginTop: 2 }}>recent form</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.4)", textTransform: "uppercase", marginBottom: 3 }}>GHP L14</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: (s.ghp14 ?? 0) >= 0.70 ? "#4ade80" : BG, lineHeight: 1 }}>
            {s.ghp14 != null ? Math.round(s.ghp14 * 100) + "%" : "—"}
          </div>
          <div style={{ fontSize: 8, color: "rgba(246,241,231,0.35)", marginTop: 2 }}>games w/ hit</div>
        </div>
      </div>

      {/* Matchup callout */}
      <div style={{ margin: "0 16px 10px", background: "rgba(255,255,255,0.05)", borderRadius: 12,
        padding: "10px 12px", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 8, fontWeight: 800, color: "rgba(246,241,231,0.4)", textTransform: "uppercase", marginBottom: 3 }}>⚾ Matchup</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: BG }}>{p.name ?? "TBD"}{p.hand ? ` (${p.hand}HP)` : ""}</div>
            {pitcherAvg != null && (
              <div style={{ fontSize: 10, color: pitcherAvg >= 0.270 ? "#4ade80" : "rgba(246,241,231,0.55)", marginTop: 2 }}>
                {fmtAvg(pitcherAvg)} BA vs {bats === "L" ? "LHB" : "RHB"}
                {pitcherAvg >= 0.280 ? " 🎯 Hittable!" : ""}
              </div>
            )}
          </div>
          {/* xBA highlight */}
          {(s.xba ?? 0) > 0 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(246,241,231,0.4)", textTransform: "uppercase", marginBottom: 2 }}>xBA</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: (s.xba ?? 0) >= 0.300 ? "#4ade80" : GOLD }}>{fmtAvg(s.xba)}</div>
            </div>
          )}
        </div>
        {/* BvP if available */}
        {bvp.ab >= 5 && bvp.avg != null && (
          <div style={{ marginTop: 6, fontSize: 10, color: (bvp.avg ?? 0) >= 0.300 ? "#4ade80" : "rgba(246,241,231,0.65)" }}>
            💥 {pick.name?.split(" ").pop()} is {fmtAvg(bvp.avg)} in {bvp.ab} career AB vs {p.name?.split(" ").pop() ?? "this starter"}
          </div>
        )}
      </div>

      {/* Top bullets */}
      {bullets.length > 0 && (
        <div style={{ margin: "0 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {bullets.map((b, i) => {
            const emojis = ["⚡", "🎯", "💡"];
            const isNeg = /caution|injury|wind|rain|cold/i.test(b);
            return (
              <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "8px 12px",
                borderLeft: `3px solid ${isNeg ? "#f87171" : GOLD}`, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{isNeg ? "⚠️" : emojis[i] ?? "✅"}</span>
                <span style={{ fontSize: 10, color: "rgba(246,241,231,0.80)", lineHeight: 1.4 }}>
                  {b.replace(/^[•▸] /, "").replace(/\*\*([^*]+)\*\*/g, "$1")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ background: "rgba(0,0,0,0.28)", padding: "9px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 9, color: "rgba(246,241,231,0.4)" }}>{g.matchup ?? ""}</div>
        <div style={{ fontSize: 9, fontWeight: 900, color: GOLD }}>🏆 CLUBHOUSE IQ</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BTS TEMPLATE 3: SUMMARY — clean compact card
// ══════════════════════════════════════════════════════════════════════════════
function BTSSummary({ pick }: { pick: any }) {
  const s    = pick.stats          ?? pick.snapshot?.stats          ?? {};
  const p    = pick.opponentPitcher ?? pick.snapshot?.opponentPitcher ?? {};
  const ps   = pick.pitcherStats   ?? pick.snapshot?.pitcherStats    ?? {};
  const g    = pick.game           ?? pick.snapshot?.game            ?? {};
  const bvp  = pick.bvp            ?? pick.snapshot?.bvp             ?? {};
  const prob = pick.hitProbability ?? pick.snapshot?.hitProbability  ?? 0;
  const tier = pick.confidenceTier ?? pick.snapshot?.confidenceTier  ?? "C";
  const edge = pick.edge           ?? pick.snapshot?.edge            ?? null;
  const pitcherAvg = pick.pitcherAvgAllowed ?? pick.snapshot?.pitcherAvgAllowed;
  const bats = pick.bats ?? pick.snapshot?.bats ?? "";
  const slot = pick.lineupSlot ?? pick.snapshot?.lineupSlot ?? null;
  const rationale: string = pick.rationale ?? pick.snapshot?.rationale ?? "";
  const lines = rationale.split("\n").filter(Boolean);
  const opener = lines[0] ?? "";
  const bullets = lines.slice(1, 4).filter(Boolean);
  const tc = tierColor(tier);

  return (
    <div style={{ width: 390, background: BG, fontFamily: "'Inter', sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: NAVY, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 8, color: "rgba(246,241,231,0.45)", textTransform: "uppercase", letterSpacing: 1 }}>
            Clubhouse IQ · {today("long")}
          </div>
          <div style={{ fontSize: 12, fontWeight: 900, color: BG, marginTop: 1 }}>⚾ Beat The Streak Pick</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: tc,
            background: `${tc}20`, border: `1px solid ${tc}50`, borderRadius: 8, padding: "2px 9px" }}>
            {tier} Tier
          </div>
          <div style={{ fontSize: 10, color: "rgba(246,241,231,0.5)", marginTop: 3 }}>{prob}% prob</div>
        </div>
      </div>

      {/* Player + key details */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(19,35,58,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, color: NAVY, lineHeight: 1 }}>{pick.name} 🎯</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
              {pick.team}{slot != null ? ` · Slot #${slot}` : ""}
              {bats ? ` · Bats ${bats}` : ""}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
              vs {p.name ?? "TBD"}{p.hand ? ` (${p.hand}HP)` : ""}
            </div>
          </div>
          {/* Prob ring visual */}
          <div style={{ background: NAVY, borderRadius: 14, padding: "8px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "rgba(246,241,231,0.45)", textTransform: "uppercase", marginBottom: 1 }}>Hit Prob</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: prob >= 70 ? "#4ade80" : GOLD, lineHeight: 1 }}>{prob}%</div>
            {edge != null && <div style={{ fontSize: 9, color: "rgba(246,241,231,0.5)", marginTop: 2 }}>Edge {edge > 0 ? "+" : ""}{edge}%</div>}
          </div>
        </div>

        {/* Game chips */}
        <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
          {(g.total ?? 0) > 0 && (
            <span style={{ fontSize: 10, fontWeight: 800, background: NAVY, color: GOLD, borderRadius: 6, padding: "2px 8px" }}>
              O/U {g.total}
            </span>
          )}
          {g.matchup && (
            <span style={{ fontSize: 9, fontWeight: 600, background: "rgba(19,35,58,0.08)", color: MUTED, borderRadius: 6, padding: "2px 8px" }}>
              {g.matchup}
            </span>
          )}
          {g.gameTime && (
            <span style={{ fontSize: 9, fontWeight: 600, background: "rgba(19,35,58,0.08)", color: MUTED, borderRadius: 6, padding: "2px 8px" }}>
              🕐 {g.gameTime}
            </span>
          )}
        </div>
      </div>

      {/* Quick stat grid — 3×2 */}
      <div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7,
        borderBottom: "1px solid rgba(19,35,58,0.08)" }}>
        <div style={{ textAlign: "center", background: "rgba(19,35,58,0.04)", borderRadius: 9, padding: "7px 4px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>14d BA</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: (s.avg14 ?? 0) >= 0.280 ? "#16a34a" : NAVY }}>{fmtAvg(s.avg14)}</div>
        </div>
        <div style={{ textAlign: "center", background: "rgba(212,168,67,0.08)", borderRadius: 9, padding: "7px 4px", border: "1px solid rgba(212,168,67,0.20)" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: GOLD, textTransform: "uppercase", marginBottom: 2 }}>GHP L14</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>{s.ghp14 != null ? Math.round(s.ghp14 * 100) + "%" : "—"}</div>
        </div>
        <div style={{ textAlign: "center", background: "rgba(19,35,58,0.04)", borderRadius: 9, padding: "7px 4px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>xBA</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: (s.xba ?? 0) >= 0.300 ? "#16a34a" : NAVY }}>{fmtAvg(s.xba)}</div>
        </div>
        <div style={{ textAlign: "center", background: (s.hardHitPct ?? 0) >= 42 ? "rgba(34,197,94,0.06)" : "rgba(19,35,58,0.03)", borderRadius: 9, padding: "7px 4px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>Hard Hit%</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>{s.hardHitPct != null ? s.hardHitPct.toFixed(0) + "%" : "—"}</div>
        </div>
        <div style={{ textAlign: "center", background: "rgba(19,35,58,0.04)", borderRadius: 9, padding: "7px 4px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>P. ERA</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: (ps.era ?? 99) <= 3.5 ? "#dc2626" : (ps.era ?? 99) <= 4.5 ? GOLD : "#16a34a" }}>
            {ps.era != null ? ps.era.toFixed(2) : "—"}
          </div>
        </div>
        <div style={{ textAlign: "center", background: pitcherAvg != null && pitcherAvg >= 0.270 ? "rgba(34,197,94,0.07)" : "rgba(19,35,58,0.04)", borderRadius: 9, padding: "7px 4px" }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>
            P. BA vs {bats === "L" ? "L" : "R"}
          </div>
          <div style={{ fontSize: 16, fontWeight: 900, color: pitcherAvg != null && pitcherAvg >= 0.270 ? "#16a34a" : NAVY }}>
            {fmtAvg(pitcherAvg)}
          </div>
        </div>
      </div>

      {/* BvP */}
      {bvp.ab >= 5 && bvp.avg != null && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(19,35,58,0.08)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 1 }}>⚔️ Batter vs Pitcher</div>
            <div style={{ fontSize: 9, color: MUTED }}>{pick.name?.split(" ").pop()} vs {p.name?.split(" ").pop() ?? "starter"} · {bvp.ab} career AB</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: (bvp.avg ?? 0) >= 0.280 ? "#16a34a" : NAVY }}>{fmtAvg(bvp.avg)}</div>
            <div style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: "uppercase" }}>{bvp.signal ?? ""}</div>
          </div>
        </div>
      )}

      {/* Analysis summary */}
      {(opener || bullets.length > 0) && (
        <div style={{ padding: "10px 16px 12px" }}>
          {opener && <p style={{ fontSize: 9, fontWeight: 700, color: NAVY, lineHeight: 1.4, margin: "0 0 5px" }}>{opener}</p>}
          {bullets.map((b, i) => {
            const bad = /caution|injury|wind|rain|cold/i.test(b);
            return (
              <div key={i} style={{ display: "flex", gap: 5, alignItems: "flex-start", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: bad ? "#dc2626" : "#16a34a", fontWeight: 900, flexShrink: 0 }}>{bad ? "✕" : "✓"}</span>
                <span style={{ fontSize: 9, color: MUTED, lineHeight: 1.35 }}>
                  {b.replace(/^[•▸] /, "").replace(/\*\*([^*]+)\*\*/g, "$1")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ background: NAVY, padding: "7px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 9, fontWeight: 900, color: GOLD }}>CLUBHOUSE IQ ⚾</div>
        <div style={{ fontSize: 8, color: "rgba(246,241,231,0.35)" }}>clubhouseiqbets@gmail.com</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BTS SHARE MODAL — wraps all 3 templates with selector + html2canvas
// ══════════════════════════════════════════════════════════════════════════════
type BTSTemplateId = "analytics" | "hype" | "summary";

const BTS_TEMPLATES: { id: BTSTemplateId; label: string; emoji: string; desc: string }[] = [
  { id: "analytics", label: "Analytics", emoji: "📊", desc: "Full stats, matchup edge & model detail" },
  { id: "hype",      label: "Hype",      emoji: "🔥", desc: "Bold visual, emojis & key numbers" },
  { id: "summary",   label: "Summary",   emoji: "⚡", desc: "Clean compact card — key stats only" },
];

function BTSShareModal({ pick, onClose }: { pick: any; onClose: () => void }) {
  const [active, setActive]     = useState<BTSTemplateId>("summary");
  const [imgUrl, setImgUrl]     = useState<string | null>(null);
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
        backgroundColor: active === "hype" ? NAVY : BG,
        logging: false,
        windowWidth: 420,
      });
      setImgUrl(canvas.toDataURL("image/png"));
    } catch (e) {
      console.error("html2canvas BTS error:", e);
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    setImgUrl(null);
    const t = setTimeout(() => renderCanvas(), 120);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(10,16,28,0.92)",
        backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center",
        overflowY: "auto", padding: "16px 16px 40px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div style={{ width: "100%", maxWidth: 420, display: "flex", alignItems: "center",
        justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#F6F1E7" }}>Share Pick</div>
        <button onClick={onClose} style={{ background: "rgba(246,241,231,0.10)", border: "none",
          borderRadius: 10, width: 30, height: 30, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={14} color="#F6F1E7" />
        </button>
      </div>

      {/* Template selector */}
      <div style={{ width: "100%", maxWidth: 420, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
        {BTS_TEMPLATES.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)} style={{
            background: active === t.id ? "#F6F1E7" : "rgba(246,241,231,0.07)",
            border: active === t.id ? "none" : "1px solid rgba(246,241,231,0.12)",
            borderRadius: 12, padding: "8px 6px", cursor: "pointer", textAlign: "center", transition: "all 0.15s",
          }}>
            <div style={{ fontSize: 18 }}>{t.emoji}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: active === t.id ? NAVY : "#F6F1E7", marginTop: 2 }}>{t.label}</div>
            <div style={{ fontSize: 8, color: active === t.id ? MUTED : "rgba(246,241,231,0.38)",
              marginTop: 1, lineHeight: 1.3 }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Rendered image */}
      {imgUrl && (
        <div style={{ width: "100%", maxWidth: 420, marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.55)",
            textAlign: "center", marginBottom: 6 }}>
            📲 Long-press to save image
          </div>
          <img src={imgUrl} alt="BTS share card" style={{ width: "100%", borderRadius: 14,
            display: "block", boxShadow: "0 8px 32px rgba(0,0,0,0.45)" }} />
        </div>
      )}

      {rendering && (
        <div style={{ color: "rgba(246,241,231,0.55)", fontSize: 12, marginBottom: 10 }}>Generating…</div>
      )}

      {/* Off-screen source card */}
      <div style={{ position: "absolute", left: -9999, top: 0, pointerEvents: "none" }}>
        <div ref={cardRef}>
          {active === "analytics" && <BTSAnalytics pick={pick} />}
          {active === "hype"      && <BTSHype      pick={pick} />}
          {active === "summary"   && <BTSSummary   pick={pick} />}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PROP + TEAM single-view layouts (unchanged, bottom-sheet style)
// ══════════════════════════════════════════════════════════════════════════════
function ConfRing({ score }: { score: number }) {
  const r = 32, circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 85 ? "#f59e0b" : score >= 70 ? "#22d3ee" : "#f87171";
  return (
    <div style={{ position: "relative", flexShrink: 0, width: 80, height: 80 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={circ - fill}
          strokeLinecap="round" transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
          color: "rgba(246,241,231,0.4)", marginTop: 2 }}>conf</span>
      </div>
    </div>
  );
}

function PropShare({ bet }: { bet: any }) {
  const ts = (bet.teamStats as any) ?? {};
  const score = bet.confidenceScore ?? 0;
  const factors: string[] = (bet.keyFactors as string[]) ?? [];
  const statType = ts.statType ?? ts.statRaw ?? "";
  const hitRate = ts.hitRate != null ? Math.round(ts.hitRate * 100) : null;
  const games = ts.hitRateGames ?? 5;
  const recentAvg = ts.recentAvg;
  const edgeTier = ts.edgeTier ?? bet.edgeTier;
  const edgePct = ts.edgePct ?? bet.edgePct;
  const overOdds = bet.overOdds ?? ts.overOdds ?? null;
  const underOdds = bet.underOdds ?? ts.underOdds ?? null;
  const pickSide = ts.pickSide ?? null;
  const TIER_COLOR: Record<string, string> = { "A+": "#4ade80", A: "#facc15", B: "#93c5fd", C: "rgba(246,241,231,0.4)" };
  const tc = edgeTier ? (TIER_COLOR[edgeTier] ?? TIER_COLOR.C) : null;
  return (
    <div className="flex flex-col gap-2.5 w-full">
      <div className="flex items-start gap-3">
        <ConfRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
              {bet.sport} · {bet.betType === "player_prop" ? "Player Prop" : (bet.betType ?? "").replace("_", " ")}
            </span>
            {edgeTier && tc && (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: `${tc}1a`, color: tc, border: `1px solid ${tc}4d` }}>
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
          {bet.homeTeam && <p className="text-[10px] mt-0.5" style={{ color: "rgba(246,241,231,0.4)" }}>{bet.awayTeam} @ {bet.homeTeam}</p>}
        </div>
      </div>
      {bet.line != null && (
        <div className="rounded-xl px-3 py-2.5 flex items-center justify-between" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.45)" }}>Line</p>
            <p className="text-[28px] font-black font-mono leading-none mt-0.5" style={{ color: "#facc15" }}>
              {bet.line} <span className="text-base">{statType}</span>
            </p>
            {pickSide && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full mt-1 inline-block"
                style={{ background: pickSide.toUpperCase() === "OVER" ? "rgba(74,222,128,0.15)" : "rgba(96,165,250,0.15)",
                  color: pickSide.toUpperCase() === "OVER" ? "#4ade80" : "#60a5fa",
                  border: `1px solid ${pickSide.toUpperCase() === "OVER" ? "rgba(74,222,128,0.3)" : "rgba(96,165,250,0.3)"}` }}>
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
      {(hitRate != null || recentAvg != null || ts.seasonAvg != null) && (
        <div className="flex gap-2 flex-wrap">
          {hitRate != null && <Pill label={`Hit Rate L${games}`} value={`${hitRate}%`} good={hitRate >= 60} />}
          {recentAvg != null && <Pill label="Recent Avg" value={recentAvg.toFixed(1)} good={recentAvg > (bet.line ?? 0)} />}
          {ts.seasonAvg != null && <Pill label="Season Avg" value={ts.seasonAvg.toFixed(1)} />}
          {ts.l10Avg != null && <Pill label="L10 Avg" value={ts.l10Avg.toFixed(1)} good={ts.l10Avg > (bet.line ?? 0)} />}
        </div>
      )}
      {factors.length > 0 && (
        <div className="rounded-xl px-2.5 py-2 space-y-1" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.35)" }}>Why this edge</p>
          {factors.slice(0, 4).map((f, i) => <BulletLine key={i} text={f} />)}
        </div>
      )}
    </div>
  );
}

function TeamShare({ bet }: { bet: any }) {
  const ts = (bet.teamStats as any) ?? {};
  const score = bet.confidenceScore ?? 0;
  const factors: string[] = (bet.keyFactors as string[]) ?? [];
  const edgeTier = ts.edgeTier ?? bet.edgeTier;
  const edgePct = ts.edgePct ?? bet.edgePct;
  const TIER_COLOR: Record<string, string> = { "A+": "#4ade80", A: "#facc15", B: "#93c5fd", C: "rgba(246,241,231,0.4)" };
  const tc = edgeTier ? (TIER_COLOR[edgeTier] ?? TIER_COLOR.C) : null;
  const betTypeLabel = bet.betType === "moneyline" ? "MONEYLINE" : bet.betType === "spread" ? "SPREAD" : bet.betType === "total" ? "TOTAL (O/U)" : (bet.betType ?? "").replace("_", " ").toUpperCase();
  const lineDisplay = bet.betType === "total" ? `O/U ${bet.line}` : bet.betType === "spread" ? `${(bet.line ?? 0) > 0 ? "+" : ""}${bet.line}` : null;
  return (
    <div className="flex flex-col gap-2.5 w-full">
      <div className="flex items-start gap-3">
        <ConfRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.3)" }}>
              {bet.sport} · {betTypeLabel}
            </span>
            {edgeTier && tc && (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: `${tc}1a`, color: tc, border: `1px solid ${tc}4d` }}>
                Edge {edgeTier}{edgePct != null ? ` +${edgePct.toFixed(1)}%` : ""}
              </span>
            )}
          </div>
          <p className="text-[18px] font-black leading-tight" style={{ color: "#F6F1E7" }}>{bet.teamName ?? bet.title}</p>
          {bet.matchup && <p className="text-[11px] font-semibold mt-0.5" style={{ color: "rgba(246,241,231,0.55)" }}>{bet.matchup}</p>}
          {bet.homeTeam && <p className="text-[10px] mt-0.5" style={{ color: "rgba(246,241,231,0.4)" }}>{bet.awayTeam} @ {bet.homeTeam}</p>}
        </div>
      </div>
      <div className="rounded-xl px-3 py-2.5 flex items-center justify-between" style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)" }}>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(246,241,231,0.45)" }}>{betTypeLabel}</p>
          <p className="text-[28px] font-black font-mono leading-none mt-0.5" style={{ color: "#60a5fa" }}>{lineDisplay ?? bet.line ?? "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "rgba(246,241,231,0.45)" }}>Odds</p>
          <p className="text-[22px] font-black font-mono" style={{ color: "#F6F1E7" }}>{fmtOdds(bet.odds ?? ts.pickedOdds)}</p>
        </div>
      </div>
      {(ts.homeRecord || ts.awayRecord || ts.homeATS || ts.awayATS) && (
        <div className="flex gap-2 flex-wrap">
          {ts.homeRecord && <Pill label="Home Rec" value={ts.homeRecord} />}
          {ts.awayRecord && <Pill label="Away Rec" value={ts.awayRecord} />}
          {ts.homeATS && <Pill label="Home ATS" value={ts.homeATS} good />}
          {ts.awayATS && <Pill label="Away ATS" value={ts.awayATS} />}
          {ts.streak && <Pill label="Streak" value={ts.streak} good={ts.streak?.startsWith("W")} />}
        </div>
      )}
      {factors.length > 0 && (
        <div className="rounded-xl px-2.5 py-2 space-y-1" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(246,241,231,0.35)" }}>Why this edge</p>
          {factors.slice(0, 5).map((f, i) => <BulletLine key={i} text={f} />)}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════
export type SharePickType = "bts" | "prop" | "team";
export interface ShareCardProps { type: SharePickType; data: any; onClose: () => void; }
const ANIM_MS = 320;

export default function ShareCard({ type, data, onClose }: ShareCardProps) {
  // BTS gets the full 3-template modal (rendered via html2canvas)
  if (type === "bts") {
    return createPortal(<BTSShareModal pick={data} onClose={onClose} />, document.body);
  }

  // Prop / Team get the original bottom-sheet live view
  const [visible, setVisible]   = useState(false);
  const [closing, setClosing]   = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setVisible(false);
    closeTimer.current = setTimeout(onClose, ANIM_MS);
  }, [closing, onClose]);

  useEffect(() => { const t = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(t); }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => { document.body.style.overflow = prev; document.removeEventListener("touchmove", block); };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const backdropOpacity = visible ? 1 : 0;
  const cardTranslate   = visible ? "translateY(0)" : "translateY(100%)";

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      style={{ background: `rgba(0,0,0,${0.78 * backdropOpacity})`, backdropFilter: visible ? "blur(6px)" : "blur(0px)",
        WebkitBackdropFilter: visible ? "blur(6px)" : "blur(0px)",
        transition: `background ${ANIM_MS}ms ease, backdrop-filter ${ANIM_MS}ms ease`,
        pointerEvents: closing && !visible ? "none" : "auto" }}
      onClick={handleClose}
      onTouchMove={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div
        className="relative w-full max-w-sm rounded-t-3xl flex flex-col"
        style={{ background: "linear-gradient(170deg, #13233A 0%, #0d1a28 100%)", border: "1px solid rgba(255,255,255,0.10)",
          borderBottom: "none", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)", maxHeight: "92dvh", height: "92dvh",
          transform: cardTranslate, transition: `transform ${ANIM_MS}ms cubic-bezier(0.32,0.72,0,1)`, willChange: "transform" }}
        onClick={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>
        <div className="flex items-center justify-between px-4 pb-2 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: "#facc15" }}>Clubhouse IQ</span>
          </div>
          <button onClick={handleClose} className="rounded-full p-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
            <X size={13} color="#F6F1E7" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden px-4 pt-3 pb-1">
          {type === "prop" && <PropShare bet={data} />}
          {type === "team" && <TeamShare bet={data} />}
        </div>
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-[9px] font-semibold" style={{ color: "rgba(246,241,231,0.3)" }}>clubhouse-iq.up.railway.app</p>
          <p className="text-[9px] font-bold" style={{ color: "rgba(246,241,231,0.3)" }}>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
