import { useQuery, useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  ChevronDown, ChevronUp, TrendingUp, Target, Zap, AlertCircle,
  CheckCircle, Clock, Search, X, Lock, Trophy, BarChart2,
  Newspaper, RefreshCw, Filter, Star, Info, Share2, TrendingDown
} from "lucide-react";

// ─── Color constants ─────────────────────────────────────────────────────────
const BG_COLOR   = "#F6F1E7";
const NAVY_COLOR = "#13233A";
const GOLD_COLOR = "#D4A843";
const MUTED      = "#3D4B58";
const NAVY       = NAVY_COLOR;

// ─── Types ───────────────────────────────────────────────────────────────────
interface PropRow {
  id?: string | number;
  player: string;
  team: string;
  opponent: string;
  spread?: string;
  total?: string;
  market: string;
  line: number | string;
  bookPct: number;
  modelPct: number;
  edge: number;
  confidence: "Strong" | "Medium" | "Thin";
  lastNGames?: number[];
  defRank?: number;
  redZoneShare?: number;
  targetShare?: number;
  weather?: string;
  notes?: string;
}

interface StreakEntry {
  date: string;
  player: string;
  market: string;
  edge: number;
  result: "W" | "L" | "pending";
}

interface StreakData {
  currentStreak: number;
  totalWins: number;
  totalLosses: number;
  bestStreak: number;
  history: StreakEntry[];
}

interface NewsItem {
  id?: string | number;
  source: string;
  headline: string;
  timestamp: string;
  url?: string;
  tags?: string[];
}


interface WaiverPlayer {
  playerName: string; team: string; position: string;
  ownershipPct: number; pickupScore: number; reason: string;
  trend: "rising" | "stable" | "hot"; weeklyProjectedPts: number;
  recommendedAction: "Add" | "Stash" | "Monitor";
}
interface SnapTrendPlayer {
  playerName: string; team: string; position: string;
  snapPcts: number[];
  weekLabels: string[];
  targetShare: number;
  touches: number | null;
  routes: number | null;
  snapTrend: "rising" | "falling" | "stable";
  trendWindow: string;
  delta1: number;
  avg3: number; delta3: number; weekRange3: string;
  avg5: number; delta5: number; weekRange5: string;
  avg10: number; delta10: number; weekRange10: string;
  snapDelta: number;
  note: string;
  ownershipTier: string;
  weeklyProjectedPts: number;
}
interface HandcuffPair {
  starter: string; handcuff: string; team: string;
  injuryRisk: number; handcuffOwnershipPct: number; starterOwnershipPct: number;
  reason: string; handcuffPriority: "Must Own" | "High Value" | "Monitor";
}
interface MatchupDetail {
  allowedYpg: number;
  allowedTdPg: number;
  trend: string;
  keyPlayers: string[];
  why: string;
}
interface MatchupRow {
  team: string;
  QB: number; RB: number; WR: number; TE: number;
  gradeQB: string; gradeRB: string; gradeWR: string; gradeTE: string;
  detail: { QB: MatchupDetail; RB: MatchupDetail; WR: MatchupDetail; TE: MatchupDetail };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function relativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return ts;
  }
}

function marketColor(market: string): { bg: string; text: string; border: string } {
  const m = market.toLowerCase();
  if (m.includes("td"))       return { bg: "rgba(212,168,67,0.15)",  text: "#b8930a", border: "rgba(212,168,67,0.40)" };
  if (m.includes("rush"))     return { bg: "rgba(34,197,94,0.12)",   text: "#16a34a", border: "rgba(34,197,94,0.35)" };
  if (m.includes("rec yds"))  return { bg: "rgba(59,130,246,0.12)",  text: "#3b82f6", border: "rgba(59,130,246,0.35)" };
  if (m.includes("reception"))return { bg: "rgba(168,85,247,0.12)",  text: "#a855f7", border: "rgba(168,85,247,0.35)" };
  if (m.includes("pass"))     return { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", border: "rgba(239,68,68,0.35)" };
  return { bg: "rgba(61,75,88,0.10)", text: MUTED, border: "rgba(61,75,88,0.25)" };
}

function confStyle(conf: string): { bg: string; text: string; border: string } {
  if (conf === "Strong") return { bg: "rgba(34,197,94,0.12)",  text: "#16a34a", border: "rgba(34,197,94,0.30)" };
  if (conf === "Medium") return { bg: "rgba(212,168,67,0.12)", text: "#b8930a", border: "rgba(212,168,67,0.30)" };
  return { bg: "rgba(61,75,88,0.10)", text: MUTED, border: "rgba(61,75,88,0.25)" };
}

// ─── Mini sparkline (inline SVG bars) ────────────────────────────────────────
function Sparkline({ values }: { values: number[] }) {
  if (!values || values.length === 0) return <span style={{ color: MUTED, fontSize: 11 }}>No data</span>;
  const max = Math.max(...values, 1);
  const W = 120, H = 32, barW = Math.floor(W / values.length) - 2;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {values.map((v, i) => {
        const bh = Math.max(3, (v / max) * (H - 4));
        const color = v > 0 ? "#22c55e" : "#ef4444";
        return (
          <rect
            key={i}
            x={i * (barW + 2)}
            y={H - bh}
            width={barW}
            height={bh}
            rx={2}
            fill={color}
            fillOpacity={0.75}
          />
        );
      })}
    </svg>
  );
}

// ─── Market badge ─────────────────────────────────────────────────────────────
function MarketBadge({ market }: { market: string }) {
  const c = marketColor(market);
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {market}
    </span>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfBadge({ conf }: { conf: string }) {
  const c = confStyle(conf);
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {conf}
    </span>
  );
}

// ─── Result badge ─────────────────────────────────────────────────────────────
function ResultBadge({ result }: { result: "W" | "L" | "pending" }) {
  if (result === "W") return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.35)" }}>W</span>
  );
  if (result === "L") return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.30)" }}>L</span>
  );
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(61,75,88,0.10)", color: MUTED, border: "1px solid rgba(61,75,88,0.20)" }}>Pending</span>
  );
}

// ─── Model vs Book bar ────────────────────────────────────────────────────────
function ModelVsBookBar({ modelPct, bookPct }: { modelPct: number; bookPct: number }) {
  return (
    <div style={{ margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Book {bookPct.toFixed(0)}%</span>
        <span style={{ fontSize: 11, color: modelPct > 60 ? "#16a34a" : modelPct > 50 ? "#b8930a" : "#f87171", fontWeight: 700 }}>Model {modelPct.toFixed(0)}%</span>
      </div>
      <div style={{ background: "rgba(19,35,58,0.08)", borderRadius: 6, height: 10, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${bookPct}%`, background: "rgba(61,75,88,0.35)", borderRadius: 6 }} />
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${modelPct}%`, background: modelPct > bookPct ? "#22c55e" : "#f87171", borderRadius: 6, opacity: 0.7 }} />
      </div>
    </div>
  );
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────
function DetailDrawer({
  prop,
  onClose,
  onLock,
  lockedPick,
}: {
  prop: PropRow;
  onClose: () => void;
  onLock: (p: PropRow) => void;
  lockedPick: any;
}) {
  const isLocked = lockedPick && (lockedPick.player === prop.player && lockedPick.market === prop.market);
  const edgeColor = prop.edge > 0 ? "#16a34a" : "#f87171";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(19,35,58,0.45)", zIndex: 40,
          backdropFilter: "blur(2px)",
        }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
          background: BG_COLOR, borderRadius: "20px 20px 0 0",
          maxHeight: "85vh", overflowY: "auto",
          padding: "24px 20px 40px",
          boxShadow: "0 -8px 40px rgba(19,35,58,0.20)",
        }}
      >
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: "rgba(19,35,58,0.18)", borderRadius: 99, margin: "0 auto 20px" }} />

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <p style={{ fontWeight: 900, fontSize: 20, color: NAVY, lineHeight: 1.2 }}>{prop.player}</p>
            <p style={{ fontSize: 13, color: MUTED, fontWeight: 600, marginTop: 2 }}>{prop.team} vs {prop.opponent}</p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(19,35,58,0.08)", border: "none", borderRadius: 50, padding: 6, cursor: "pointer", display: "flex" }}>
            <X size={18} color={NAVY} />
          </button>
        </div>

        {/* Market + Line */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <MarketBadge market={prop.market} />
          <span style={{ fontWeight: 700, fontSize: 14, color: NAVY }}>Line: {prop.line}</span>
          <ConfBadge conf={prop.confidence} />
        </div>

        {/* Edge chip */}
        <div style={{
          background: prop.edge > 0 ? "rgba(34,197,94,0.10)" : "rgba(248,113,113,0.10)",
          border: `1px solid ${prop.edge > 0 ? "rgba(34,197,94,0.30)" : "rgba(248,113,113,0.25)"}`,
          borderRadius: 10, padding: "8px 14px", display: "inline-flex", gap: 8, alignItems: "center", marginBottom: 16,
        }}>
          <TrendingUp size={14} color={edgeColor} />
          <span style={{ fontWeight: 800, fontSize: 13, color: edgeColor }}>Edge: {prop.edge > 0 ? "+" : ""}{prop.edge.toFixed(1)}%</span>
        </div>

        {/* Model vs Book */}
        <ModelVsBookBar modelPct={prop.modelPct} bookPct={prop.bookPct} />

        {/* Last N Games sparkline */}
        {prop.lastNGames && prop.lastNGames.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Last {prop.lastNGames.length} Games</p>
            <Sparkline values={prop.lastNGames} />
          </div>
        )}

        {/* Matchup notes */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
          {prop.defRank != null && (
            <div style={{ background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "8px 6px", textAlign: "center", border: "1px solid rgba(19,35,58,0.10)" }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>Def Rank</p>
              <p style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>#{prop.defRank}</p>
            </div>
          )}
          {prop.redZoneShare != null && (
            <div style={{ background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "8px 6px", textAlign: "center", border: "1px solid rgba(19,35,58,0.10)" }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>RZ Share</p>
              <p style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>{prop.redZoneShare.toFixed(0)}%</p>
            </div>
          )}
          {prop.targetShare != null && (
            <div style={{ background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "8px 6px", textAlign: "center", border: "1px solid rgba(19,35,58,0.10)" }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>Tgt Share</p>
              <p style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>{prop.targetShare.toFixed(0)}%</p>
            </div>
          )}
        </div>

        {/* Weather */}
        {prop.weather && (
          <p style={{ fontSize: 12, color: MUTED, marginBottom: 10, fontWeight: 600 }}>⛅ {prop.weather}</p>
        )}

        {/* Notes */}
        {prop.notes && (
          <p style={{ fontSize: 13, color: NAVY, background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 16, border: "1px solid rgba(19,35,58,0.08)", lineHeight: 1.55 }}>{prop.notes}</p>
        )}

        {/* Lock button */}
        <button
          onClick={() => !isLocked && onLock(prop)}
          style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none", cursor: isLocked ? "default" : "pointer",
            background: isLocked ? "rgba(19,35,58,0.08)" : NAVY,
            color: isLocked ? MUTED : BG_COLOR,
            fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "opacity 0.15s",
          }}
        >
          {isLocked ? <><CheckCircle size={16} /> Pick Locked!</> : <><Lock size={16} /> Lock This Pick</>}
        </button>
      </div>
    </>
  );
}

// ─── Streak Tracker ───────────────────────────────────────────────────────────

// ─── Analysis Info Box ────────────────────────────────────────────────────────
function AnalysisInfo({ title, items }: { title: string; items: { label: string; desc: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 14, borderRadius: 10, border: `1px solid rgba(212,168,67,0.35)`, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", background: "rgba(212,168,67,0.08)", border: "none", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={13} color={GOLD_COLOR} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#92680a" }}>{title}</span>
        </div>
        {open ? <ChevronUp size={13} color={GOLD_COLOR} /> : <ChevronDown size={13} color={GOLD_COLOR} />}
      </button>
      {open && (
        <div style={{ background: "rgba(212,168,67,0.04)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: GOLD_COLOR, minWidth: 90, flexShrink: 0, paddingTop: 1 }}>{item.label}</span>
              <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.45 }}>{item.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StreakTracker({ data }: { data: StreakData | null | undefined }) {
  if (!data) {
    return (
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(19,35,58,0.10)", padding: "20px 16px", textAlign: "center", marginTop: 8 }}>
        <Trophy size={28} color={GOLD_COLOR} style={{ margin: "0 auto 8px" }} />
        <p style={{ fontWeight: 800, color: NAVY, fontSize: 14, marginBottom: 4 }}>Streak Tracker</p>
        <p style={{ fontSize: 12, color: MUTED }}>Lock your first pick to start your streak</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(19,35,58,0.10)", padding: "16px", marginTop: 8 }}>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, background: "rgba(212,168,67,0.10)", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(212,168,67,0.25)" }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>🔥 Streak</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: NAVY }}>{data.currentStreak}</p>
        </div>
        <div style={{ flex: 1, background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(19,35,58,0.08)" }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>W-L</p>
          <p style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>{data.totalWins}-{data.totalLosses}</p>
        </div>
        <div style={{ flex: 1, background: "rgba(19,35,58,0.04)", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(19,35,58,0.08)" }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>Best</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: NAVY }}>{data.bestStreak}</p>
        </div>
      </div>

      <AnalysisInfo
        title="How the streak is tracked"
        items={[
          { label: "Win/Loss", desc: "A pick is graded W if the player recorded the stat at or above the locked line before the game ends. Final box score is the source of truth." },
          { label: "Edge %", desc: "At lock time, our model edge over the book price. Displayed per pick for context — higher edge = stronger signal at time of selection." },
          { label: "Streak", desc: "Consecutive wins from the most recent pick. Resets to 0 on any loss. Best streak is your all-time high." },
          { label: "Lock rule", desc: "Picks lock the moment you click Lock. Picks can still be replaced if the game has not started, but the original lock is still tracked in history." },
        ]}
      />
      {/* History */}
      {data.history && data.history.length > 0 ? (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Last {Math.min(data.history.length, 10)} Picks</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.history.slice(0, 10).map((entry, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "rgba(19,35,58,0.03)", borderRadius: 8 }}>
                <span style={{ fontSize: 10, color: MUTED, fontWeight: 600, minWidth: 60 }}>{entry.date}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.player}</span>
                <span style={{ fontSize: 10, color: MUTED, minWidth: 60, textAlign: "right" }}>{entry.market}</span>
                <span style={{ fontSize: 10, color: entry.edge > 0 ? "#16a34a" : "#f87171", fontWeight: 700, minWidth: 40, textAlign: "right" }}>+{entry.edge.toFixed(1)}%</span>
                <ResultBadge result={entry.result} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: MUTED, textAlign: "center" }}>No history yet — lock your first pick!</p>
      )}
    </div>
  );
}

// ─── Off-Season Card ──────────────────────────────────────────────────────────
function OffSeasonCard() {
  return (
    <div style={{ background: NAVY, borderRadius: 16, padding: "32px 24px", textAlign: "center", margin: "24px 0" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🏈</div>
      <p style={{ color: BG_COLOR, fontWeight: 900, fontSize: 18, marginBottom: 8 }}>2026 Pre-Season Mode</p>
      <p style={{ color: "rgba(246,241,231,0.65)", fontSize: 13, maxWidth: 340, margin: "0 auto 16px" }}>
        The 2026 NFL regular season hasn't kicked off yet. Player prop projections will auto-populate once Week 1 games are scheduled. All Radar, Fantasy Tools, and Betting Edge panels are running on 2026 outlook data.
      </p>
      <p style={{ color: GOLD_COLOR, fontSize: 12, fontWeight: 700 }}>2026 Season kicks off September 2026 🗓</p>
    </div>
  );
}

// ─── Props Table ──────────────────────────────────────────────────────────────
function PropsTable({ rows, onSelect, lockedPick, onLock }: {
  rows: PropRow[];
  onSelect: (p: PropRow) => void;
  lockedPick: any;
  onLock: (p: PropRow) => void;
}) {
  return (
    <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
        <thead>
          <tr style={{ background: "rgba(19,35,58,0.05)" }}>
            {["Player", "Opp", "Market", "Line", "Book%", "Model%", "Edge%", "Conf", "★"].map((h) => (
              <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isLocked = lockedPick && lockedPick.player === row.player && lockedPick.market === row.market;
            return (
              <tr
                key={i}
                onClick={() => onSelect(row)}
                style={{ cursor: "pointer", borderTop: "1px solid rgba(19,35,58,0.06)", transition: "background 0.12s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(212,168,67,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "10px 12px" }}>
                  <p style={{ fontWeight: 800, fontSize: 13, color: NAVY, whiteSpace: "nowrap" }}>{row.player}</p>
                  <p style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>{row.team}</p>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: NAVY, whiteSpace: "nowrap" }}>{row.opponent}</p>
                  {row.spread && <p style={{ fontSize: 10, color: MUTED }}>{row.spread}</p>}
                </td>
                <td style={{ padding: "10px 12px" }}><MarketBadge market={row.market} /></td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: NAVY }}>{row.line}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: MUTED }}>{row.bookPct.toFixed(0)}%</td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: row.modelPct > 60 ? "#16a34a" : row.modelPct > 50 ? "#b8930a" : "#f87171" }}>
                  {row.modelPct.toFixed(0)}%
                </td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800, color: row.edge > 0 ? "#16a34a" : "#f87171" }}>
                  {row.edge > 0 ? "+" : ""}{row.edge.toFixed(1)}%
                </td>
                <td style={{ padding: "10px 12px" }}><ConfBadge conf={row.confidence} /></td>
                <td style={{ padding: "10px 12px" }}>
                  <button
                    onClick={e => { e.stopPropagation(); if (!isLocked) onLock(row); }}
                    style={{
                      background: isLocked ? "rgba(34,197,94,0.15)" : "rgba(19,35,58,0.08)",
                      border: isLocked ? "1px solid rgba(34,197,94,0.30)" : "none",
                      borderRadius: 20, padding: "4px 10px", cursor: isLocked ? "default" : "pointer",
                      fontSize: 11, fontWeight: 700,
                      color: isLocked ? "#16a34a" : NAVY,
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {isLocked ? <><CheckCircle size={12} /> Locked</> : <><Star size={12} /> Lock</>}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Source badge color map ────────────────────────────────────────────────────
const SOURCE_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  "ESPN":         { bg: "rgba(212,0,0,0.09)",    color: "#c00",    border: "rgba(212,0,0,0.20)" },
  "ESPN Fantasy": { bg: "rgba(106,0,180,0.09)",  color: "#7c3aed", border: "rgba(106,0,180,0.20)" },
  "Rotowire":     { bg: "rgba(19,35,58,0.08)",   color: MUTED,     border: "rgba(19,35,58,0.15)" },
  "CBS Sports":   { bg: "rgba(0,91,179,0.09)",   color: "#005bb3", border: "rgba(0,91,179,0.20)" },
  "FantasyPros":  { bg: "rgba(34,139,34,0.09)",  color: "#16651b", border: "rgba(34,139,34,0.20)" },
  "NFL.com":      { bg: "rgba(0,47,108,0.09)",   color: "#002f6c", border: "rgba(0,47,108,0.20)" },
  "Sleeper":      { bg: "rgba(93,63,211,0.09)",  color: "#5d3fd3", border: "rgba(93,63,211,0.20)" },
  "Yahoo Fantasy":{ bg: "rgba(102,0,153,0.09)",  color: "#660099", border: "rgba(102,0,153,0.20)" },
};

// ─── News Card ────────────────────────────────────────────────────────────────
function NewsCard({ item }: { item: NewsItem }) {
  const hl = (item.headline || "").toLowerCase();
  const isInjury    = /injur|questionable|doubtful|ruled out|dnp|ir\b|placed on|out for/.test(hl);
  const isActivated = /activated|returned from|cleared/.test(hl);
  const isTrade     = /traded|trade|signs|extension|contract/.test(hl);
  const isSuspended = /suspended/.test(hl);
  const src = SOURCE_STYLE[item.source] ?? { bg: "rgba(19,35,58,0.08)", color: MUTED, border: "rgba(19,35,58,0.15)" };

  // Player tags from server (array of detected names)
  const playerTags: string[] = (item as any).playerTags ?? [];
  const relevanceScore: number = (item as any).relevanceScore ?? 0;

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px", boxShadow: "0 1px 4px rgba(19,35,58,0.04)" }}>
      {/* Top row: source badge + tags + timestamp */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 7, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {/* Source */}
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
            background: src.bg, color: src.color, border: `1px solid ${src.border}` }}>
            {item.source}
          </span>
          {/* Status tags */}
          {isInjury && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>
              🚑 Injury
            </span>
          )}
          {isActivated && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              background: "rgba(34,197,94,0.10)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.25)" }}>
              ✅ Activated
            </span>
          )}
          {isTrade && !isInjury && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              background: "rgba(212,168,67,0.12)", color: GOLD_COLOR, border: "1px solid rgba(212,168,67,0.30)" }}>
              🔄 Move
            </span>
          )}
          {isSuspended && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.20)" }}>
              ⛔ Suspended
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{relativeTime(item.timestamp ?? (item as any).publishedAt)}</span>
      </div>

      {/* Headline */}
      <p style={{ fontWeight: 700, fontSize: 13, color: NAVY, lineHeight: 1.45, marginBottom: 8 }}>{item.headline}</p>

      {/* Bottom row: player tags + read more */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        {/* Player name chips (top 2) */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {playerTags.slice(0, 2).map((tag, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
              background: "rgba(19,35,58,0.06)", color: MUTED, border: "1px solid rgba(19,35,58,0.10)" }}>
              {tag}
            </span>
          ))}
        </div>
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: GOLD_COLOR, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
            Read more →
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Radar Panel Components ──────────────────────────────────────────────────
function WaiverRadarPanel({ data }: { data: WaiverPlayer[] }) {
  const [posFilter, setPosFilter] = useState("ALL");
  const positions = ["ALL", "QB", "RB", "WR", "TE"];
  const filtered = posFilter === "ALL" ? data : data.filter(p => p.position === posFilter);

  const actionColor = (a: string) => a === "Add" ? "#16a34a" : a === "Stash" ? GOLD_COLOR : MUTED;
  const trendEmoji = (t: string) => t === "rising" ? "📈" : t === "hot" ? "🔥" : "➡️";
  const scoreColor = (s: number) => s >= 70 ? "#16a34a" : s >= 55 ? GOLD_COLOR : MUTED;

  return (
    <div>
      <AnalysisInfo
        title="How waiver pickups are scored"
        items={[
          { label: "Pickup Score", desc: "0–100 composite. Weighted: recent snap % (30%), target/touch share (25%), matchup grade (20%), ESPN Fantasy ownership trend (15%), and news recency (10%)." },
          { label: "Ownership %", desc: "Live ESPN Fantasy ownership pulled at request time. Any player owned in >50% of leagues is excluded entirely — these are true waiver wire targets." },
          { label: "Trend", desc: "📈 Rising = snap % increased ≥5% in last 2 weeks. 🔥 Hot = top-5 Sleeper trending adds in last 24 hrs. ➡️ Stable = no significant change." },
          { label: "Action", desc: "Add = immediate starter value. Stash = handcuff or bye-week filler with upside. Monitor = watch for role change but not yet startable." },
          { label: "Sources", desc: "ESPN Fantasy (ownership %), Sleeper trending API (pickup trend), FantasyPros consensus (rank confirmation), Yahoo Fantasy (cross-reference)." },
        ]}
      />
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {positions.map(p => (
          <button key={p} onClick={() => setPosFilter(p)}
            style={{ padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: posFilter === p ? NAVY : "rgba(19,35,58,0.07)", color: posFilter === p ? BG_COLOR : MUTED }}>
            {p}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((p, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{p.playerName}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(19,35,58,0.07)", color: MUTED }}>{p.position} · {p.team}</span>
                  <span style={{ fontSize: 11 }}>{trendEmoji(p.trend)}</span>
                </div>
                <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{p.reason}</p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: scoreColor(p.pickupScore), lineHeight: 1 }}>{p.pickupScore}</div>
                <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>score</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                background: `${actionColor(p.recommendedAction)}18`, color: actionColor(p.recommendedAction),
                border: `1px solid ${actionColor(p.recommendedAction)}40` }}>
                {p.recommendedAction}
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>Owned: <b style={{ color: NAVY }}>{p.ownershipPct}%</b></span>
              <span style={{ fontSize: 11, color: MUTED }}>Proj: <b style={{ color: NAVY }}>{p.weeklyProjectedPts} pts</b></span>
              {(p as any).newsHighlighted && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                  background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>IN NEWS</span>
              )}
              {((p as any).sources ?? ["Yahoo Fantasy"]).map((s: string) => (
                <span key={s} style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                  background: SOURCE_STYLE[s]?.bg ?? "rgba(19,35,58,0.07)",
                  color: SOURCE_STYLE[s]?.color ?? MUTED,
                  border: `1px solid ${SOURCE_STYLE[s]?.border ?? "rgba(19,35,58,0.15)"}` }}>{s}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SnapTrendsPanel({ data }: { data: SnapTrendPlayer[] }) {
  const [filter, setFilter] = useState<"all" | "rising" | "falling">("all");
  const [window, setWindow] = useState<"1G" | "3G" | "5G" | "10G">("3G");
  const [expanded, setExpanded] = useState<number | null>(null);

  // Filter by trend relative to selected window
  const getTrend = (p: SnapTrendPlayer) => {
    if (window === "1G") return p.delta1 >= 3 ? "rising" : p.delta1 <= -3 ? "falling" : "stable";
    if (window === "3G") return p.snapTrend; // pre-computed from delta3
    if (window === "5G") return p.delta5 >= 4 ? "rising" : p.delta5 <= -4 ? "falling" : "stable";
    return p.delta10 >= 10 ? "rising" : p.delta10 <= -10 ? "falling" : "stable";
  };
  const getDelta = (p: SnapTrendPlayer) => {
    if (window === "1G") return p.delta1;
    if (window === "3G") return p.delta3;
    if (window === "5G") return p.delta5;
    return p.delta10;
  };
  const getAvg = (p: SnapTrendPlayer) => {
    if (window === "1G") return p.snapPcts[0];
    if (window === "3G") return p.avg3;
    if (window === "5G") return p.avg5;
    return p.avg10;
  };
  const getRange = (p: SnapTrendPlayer) => {
    if (window === "1G") return `${p.weekLabels[1]} vs ${p.weekLabels[0]}`;
    if (window === "3G") return p.weekRange3;
    if (window === "5G") return p.weekRange5;
    return p.weekRange10;
  };

  const filtered = filter === "all" ? data : data.filter(p => getTrend(p) === filter);
  const trendColor = (t: string) => t === "rising" ? "#16a34a" : t === "falling" ? "#ef4444" : MUTED;
  const trendArrow = (t: string) => t === "rising" ? "▲" : t === "falling" ? "▼" : "→";
  const deltaColor = (d: number) => d > 0 ? "#16a34a" : d < 0 ? "#ef4444" : MUTED;

  // 10-bar sparkline, full width, colour-coded by direction, oldest left / newest right (gold)
  const SnapSparkline = ({ vals, wks }: { vals: number[]; wks: string[] }) => {
    const reversed = [...vals].reverse();
    const wksR = [...wks].reverse();
    const max = Math.max(...reversed, 1);
    const totalH = 32;
    const n = reversed.length;
    const gap = 3;
    // Use viewBox so SVG scales to container width
    const vbW = 300;
    const barW = (vbW - (n - 1) * gap) / n;
    return (
      <svg viewBox={`0 0 ${vbW} ${totalH + 13}`} width="100%" height={totalH + 13}
        style={{ display: "block", overflow: "visible" }}>
        {reversed.map((v, i) => {
          const barH = Math.max(3, (v / max) * (totalH - 4));
          const x = i * (barW + gap);
          const isLatest = i === n - 1;
          const isRising = i > 0 && reversed[i] >= reversed[i - 1];
          const fill = isLatest ? GOLD_COLOR : isRising ? "rgba(22,163,74,0.60)" : "rgba(239,68,68,0.50)";
          return (
            <g key={i}>
              <rect x={x} y={totalH - barH} width={barW} height={barH} rx={2} fill={fill} />
              <text x={x + barW / 2} y={totalH + 11} textAnchor="middle"
                fontSize={8} fill={MUTED} fontWeight={isLatest ? 800 : 400}>
                {wksR[i]?.replace("Wk ", "")}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div>
      <AnalysisInfo
        title="How snap trends are analyzed"
        items={[
          { label: "Snap %", desc: "Percentage of offensive snaps the player was on the field. The 10-bar chart shows weekly snap % from Wk 8 (left) to most recent (right, gold). Green bars = week-over-week increase; red bars = decrease." },
          { label: "1G Delta", desc: "Single game difference: most recent week minus the week before. Captures immediate usage shifts — a +10 spike after a starter injury, or a -8 drop from a snap limit." },
          { label: "3G MA", desc: "3-game moving average vs the prior 3 games. Core trend signal. +4% or more = Rising. -4% or more = Falling. Within ±3% = Stable. Smooths out outlier games." },
          { label: "5G MA", desc: "5-game moving average vs weeks 6–10. Confirms whether a recent trend is actually sustained or just noise. Best for identifying established role changes." },
          { label: "10G Baseline", desc: "Full 10-week window. Shows the player's snap trajectory over the entire visible period. Most recent vs oldest game gives the full directional story." },
          { label: "Touches / Routes", desc: "Carries + targets per game (Touches) and route participation rate (Routes %). High routes + high target share = must-start regardless of snap % absolute level." },
          { label: "Ownership tier", desc: "Low = under 30% · Medium = 30–60% · High = 60%+ in ESPN/Yahoo leagues." },
        ]}
      />

      {/* Controls row: window + trend filter on one line */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 12, flexWrap: "nowrap", overflowX: "auto" }}>
        <span style={{ fontSize: 10, color: MUTED, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Window:</span>
        {(["1G", "3G", "5G", "10G"] as const).map(w => (
          <button key={w} onClick={() => setWindow(w)}
            style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0,
              background: window === w ? NAVY_COLOR : "rgba(19,35,58,0.07)",
              color: window === w ? BG_COLOR : MUTED }}>
            {w}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: "rgba(19,35,58,0.15)", flexShrink: 0, margin: "0 2px" }} />
        {(["all", "rising", "falling"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0,
              background: filter === f ? NAVY_COLOR : "rgba(19,35,58,0.07)",
              color: filter === f ? BG_COLOR : MUTED }}>
            {f === "all" ? "All" : f === "rising" ? "▲ Rising" : "▼ Falling"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((p, i) => {
          const trend = getTrend(p);
          const delta = getDelta(p);
          const avg = getAvg(p);
          const range = getRange(p);
          const isOpen = expanded === i;
          return (
            <div key={i}
              style={{ background: "#fff", borderRadius: 12,
                border: `1px solid ${trend === "rising" ? "rgba(22,163,74,0.20)" : trend === "falling" ? "rgba(239,68,68,0.20)" : "rgba(19,35,58,0.10)"}`,
                padding: "10px 13px", cursor: "pointer" }}
              onClick={() => setExpanded(isOpen ? null : i)}>

              {/* Row 1: name/badges + right stats */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: NAVY_COLOR }}>{p.playerName}</span>
                  <span style={{ fontSize: 10, color: MUTED, background: "rgba(19,35,58,0.07)", borderRadius: 10, padding: "1px 6px" }}>{p.position}</span>
                  <span style={{ fontSize: 10, color: MUTED }}>{p.team}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: trendColor(trend),
                    background: `${trendColor(trend)}12`, borderRadius: 10, padding: "1px 7px" }}>
                    {trendArrow(trend)} {p.snapPcts[0]}%
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: deltaColor(delta) }}>
                    ({delta >= 0 ? "+" : ""}{delta}%{window !== "1G" ? " MA" : ""} · {range})
                  </span>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                  <div style={{ fontSize: 10, color: MUTED }}>Tgt <b style={{ color: NAVY_COLOR }}>{p.targetShare}%</b> · {p.ownershipTier} own.</div>
                  <div style={{ fontSize: 10, color: MUTED }}>
                    <b style={{ color: GOLD_COLOR }}>{p.weeklyProjectedPts}</b> pts proj. {isOpen ? "▲" : "▼"}
                  </div>
                </div>
              </div>

              {/* Row 2: sparkline full width */}
              <div style={{ marginBottom: 8 }}>
                <SnapSparkline vals={p.snapPcts} wks={p.weekLabels} />
              </div>

              {/* Row 3: MA tiles in one horizontal row */}
              <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
                {([
                  { label: "1G",  val: p.snapPcts[0], delta: p.delta1 },
                  { label: "3G",  val: p.avg3,        delta: p.delta3 },
                  { label: "5G",  val: p.avg5,        delta: p.delta5 },
                  { label: "10G", val: p.avg10,       delta: p.delta10 },
                ]).map(m => (
                  <div key={m.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                    background: window === m.label ? `${GOLD_COLOR}18` : "rgba(19,35,58,0.04)",
                    border: window === m.label ? `1px solid ${GOLD_COLOR}55` : "1px solid rgba(19,35,58,0.08)",
                    borderRadius: 8, padding: "4px 2px" }}>
                    <span style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{m.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: NAVY_COLOR }}>{m.val}%</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: deltaColor(m.delta) }}>
                      {m.delta >= 0 ? "+" : ""}{m.delta}%
                    </span>
                  </div>
                ))}
                {/* Touches + Routes tile */}
                {(p.touches !== null || p.routes !== null) && (
                  <div style={{ flex: 1.2, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                    background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)",
                    borderRadius: 8, padding: "4px 2px", gap: 1 }}>
                    {p.touches !== null && <span style={{ fontSize: 9, color: MUTED }}>Touch/g <b style={{ color: NAVY_COLOR }}>{p.touches}</b></span>}
                    {p.routes !== null  && <span style={{ fontSize: 9, color: MUTED }}>Routes <b style={{ color: NAVY_COLOR }}>{p.routes}%</b></span>}
                  </div>
                )}
              </div>

              {/* Row 4: note */}
              <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.35, margin: 0 }}>{p.note}</p>

              {/* Expanded: week-by-week breakdown */}
              {isOpen && (
                <div style={{ marginTop: 10, borderTop: "1px solid rgba(19,35,58,0.08)", paddingTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginBottom: 5 }}>Week-by-Week Snap %</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {p.snapPcts.map((v, idx) => {
                      const prev = p.snapPcts[idx + 1];
                      const wkDelta = prev !== undefined ? v - prev : null;
                      const col = wkDelta === null ? MUTED : wkDelta > 0 ? "#16a34a" : wkDelta < 0 ? "#ef4444" : MUTED;
                      return (
                        <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center",
                          background: idx === 0 ? `${GOLD_COLOR}18` : "rgba(19,35,58,0.04)",
                          border: idx === 0 ? `1px solid ${GOLD_COLOR}55` : "1px solid rgba(19,35,58,0.08)",
                          borderRadius: 8, padding: "4px 8px", minWidth: 42 }}>
                          <span style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{p.weekLabels[idx]}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: idx === 0 ? NAVY_COLOR : MUTED }}>{v}%</span>
                          {wkDelta !== null && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: col }}>
                              {wkDelta >= 0 ? "+" : ""}{wkDelta}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: MUTED }}>3G MA: <b style={{ color: NAVY_COLOR }}>{p.avg3}%</b> <span style={{ color: deltaColor(p.delta3) }}>({p.delta3 >= 0 ? "+" : ""}{p.delta3}% vs prior 3)</span></span>
                    <span style={{ fontSize: 10, color: MUTED }}>5G MA: <b style={{ color: NAVY_COLOR }}>{p.avg5}%</b> <span style={{ color: deltaColor(p.delta5) }}>({p.delta5 >= 0 ? "+" : ""}{p.delta5}% vs prior 5)</span></span>
                    <span style={{ fontSize: 10, color: MUTED }}>10G base: <b style={{ color: NAVY_COLOR }}>{p.avg10}%</b> <span style={{ color: deltaColor(p.delta10) }}>({p.delta10 >= 0 ? "+" : ""}{p.delta10}% full span)</span></span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HandcuffPanel({ data }: { data: HandcuffPair[] }) {
  const priorityColor = (p: string) => p === "Must Own" ? "#ef4444" : p === "High Value" ? GOLD_COLOR : MUTED;
  const riskBar = (r: number) => {
    const pct = (r / 10) * 100;
    const col = r >= 7 ? "#ef4444" : r >= 5 ? GOLD_COLOR : "#22c55e";
    return (
      <div style={{ width: 60, height: 6, borderRadius: 3, background: "rgba(19,35,58,0.10)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 3 }} />
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <AnalysisInfo
        title="How handcuff priority is determined"
        items={[
          { label: "Must Own", desc: "Starter has injury risk ≥7/10 AND the handcuff is owned in <30% of leagues. Highest upside if the starter misses time." },
          { label: "High Value", desc: "Starter risk 5–6/10 OR handcuff is already in a timeshare. Worth rostering if you have a bench spot." },
          { label: "Monitor", desc: "Starter is healthy, risk <5. Keep on your watchlist but not worth a roster spot yet." },
          { label: "Injury Risk", desc: "0–10 composite based on age, position, injury history, workload (carries/game), and recent practice reports." },
          { label: "Ownership %", desc: "Both starter and handcuff ownership shown. Low handcuff % = easy waiver add before the rest of your league reacts." },
        ]}
      />
      {data.map((h, i) => (
        <div key={i} style={{ background: "#fff", borderRadius: 12, border: `1px solid ${h.handcuffPriority === "Must Own" ? "rgba(239,68,68,0.25)" : "rgba(19,35,58,0.10)"}`, padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                  background: `${priorityColor(h.handcuffPriority)}15`, color: priorityColor(h.handcuffPriority),
                  border: `1px solid ${priorityColor(h.handcuffPriority)}35` }}>
                  {h.handcuffPriority}
                </span>
                <span style={{ fontSize: 10, color: MUTED }}>{h.team}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: MUTED }}>{h.starter}</span>
                <span style={{ fontSize: 11, color: MUTED }}>→</span>
                <span style={{ fontSize: 14, fontWeight: 900, color: NAVY }}>{h.handcuff}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: 4 }}>Injury Risk</div>
              {riskBar(h.injuryRisk)}
              <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>{h.injuryRisk}/10</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.4, marginBottom: 8 }}>{h.reason}</p>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ fontSize: 11, color: MUTED }}>Handcuff owned: <b style={{ color: NAVY }}>{h.handcuffOwnershipPct}%</b></span>
            <span style={{ fontSize: 11, color: MUTED }}>Starter owned: <b style={{ color: NAVY }}>{h.starterOwnershipPct}%</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchupHeatmapPanel({ data }: { data: MatchupRow[] }) {
  const [posFilter, setPosFilter] = useState<"QB" | "RB" | "WR" | "TE">("WR");
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const positions: Array<"QB" | "RB" | "WR" | "TE"> = ["QB", "RB", "WR", "TE"];

  const gradeColor = (g: string) => {
    if (g === "A") return { bg: "rgba(34,197,94,0.13)",  text: "#15803d",  border: "rgba(34,197,94,0.28)",  pill: "rgba(34,197,94,0.18)"  };
    if (g === "B") return { bg: "rgba(212,168,67,0.13)", text: "#92680a",  border: "rgba(212,168,67,0.28)", pill: "rgba(212,168,67,0.18)" };
    if (g === "C") return { bg: "rgba(251,146,60,0.13)", text: "#c2410c",  border: "rgba(251,146,60,0.28)", pill: "rgba(251,146,60,0.18)" };
    return            { bg: "rgba(239,68,68,0.10)",  text: "#dc2626",  border: "rgba(239,68,68,0.22)",  pill: "rgba(239,68,68,0.15)"  };
  };
  const gradeLabel = (g: string) => g === "A" ? "Elite matchup" : g === "B" ? "Good matchup" : g === "C" ? "Average matchup" : "Tough matchup";
  const trendColor = (t: string) => t.includes("Improving") ? "#15803d" : t.includes("Declining") ? "#dc2626" : MUTED;

  // Sort easiest matchup first (highest rank number = weakest defense)
  const sorted = [...data].sort((a, b) => (b as any)[posFilter] - (a as any)[posFilter]);

  return (
    <div>
      {/* Position filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {positions.map(p => (
          <button key={p} onClick={() => { setPosFilter(p); setOpenTeam(null); }}
            style={{ padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: posFilter === p ? NAVY_COLOR : "rgba(19,35,58,0.07)",
              color: posFilter === p ? BG_COLOR : MUTED }}>
            {p}
          </button>
        ))}
      </div>

      <AnalysisInfo
        title="How matchup grades are calculated"
        items={[
          { label: "Grade A", desc: "Defense ranks 25–32 vs this position. Opponents consistently exceed season averages. Start with confidence." },
          { label: "Grade B", desc: "Defense ranks 17–24. Favorable — good for flex decisions and borderline starters." },
          { label: "Grade C", desc: "Defense ranks 9–16. Average — lean on player talent, not matchup." },
          { label: "Grade D", desc: "Defense ranks 1–8. Tough draw — consider sitting unless elite talent or no alternative." },
          { label: "Rank #", desc: "1–32 where 32 = easiest for the offense (weakest defense). Higher = better for fantasy." },
          { label: "Data source", desc: "Weighted 60% full-season yards+TDs allowed per position, 40% last 4 weeks. Tap any team for full breakdown." },
        ]}
      />

      <p style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>
        Tap a team to see the full breakdown — key defenders, allowed stats, and why the grade was assigned.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map((row) => {
          const grade = (row as any)[`grade${posFilter}`] as string;
          const rank  = (row as any)[posFilter] as number;
          const det   = row.detail?.[posFilter] as MatchupDetail | undefined;
          const c     = gradeColor(grade);
          const isOpen = openTeam === row.team;

          // All-position mini grades for the drawer header
          const allPos: Array<"QB" | "RB" | "WR" | "TE"> = ["QB", "RB", "WR", "TE"];

          return (
            <div key={row.team}
              style={{ borderRadius: 12, border: `1px solid ${isOpen ? c.border : "rgba(19,35,58,0.10)"}`,
                background: isOpen ? c.bg : "#fff", overflow: "hidden" }}>

              {/* Collapsed row — always visible */}
              <div
                onClick={() => setOpenTeam(isOpen ? null : row.team)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", cursor: "pointer" }}>

                {/* Rank badge */}
                <div style={{ width: 32, height: 32, borderRadius: 8, background: c.pill, display: "flex",
                  alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: c.text }}>#{rank}</span>
                </div>

                {/* Team + label */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: NAVY_COLOR }}>{row.team}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10,
                      background: c.pill, color: c.text }}>{grade} — {gradeLabel(grade)}</span>
                    {det && <span style={{ fontSize: 10, color: trendColor(det.trend) }}>{det.trend}</span>}
                  </div>
                  {det && (
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                      {det.allowedYpg} YPG · {det.allowedTdPg} TD/g allowed vs {posFilter}
                    </div>
                  )}
                </div>

                {/* All-pos mini badges */}
                <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                  {allPos.map(pos => {
                    const g2 = (row as any)[`grade${pos}`] as string;
                    const c2 = gradeColor(g2);
                    return (
                      <div key={pos} style={{ display: "flex", flexDirection: "column", alignItems: "center",
                        background: pos === posFilter ? c2.pill : "rgba(19,35,58,0.05)",
                        borderRadius: 6, padding: "2px 5px", minWidth: 26 }}>
                        <span style={{ fontSize: 8, color: MUTED, fontWeight: 700 }}>{pos}</span>
                        <span style={{ fontSize: 11, fontWeight: 900,
                          color: pos === posFilter ? c2.text : MUTED }}>{g2}</span>
                      </div>
                    );
                  })}
                </div>

                <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
              </div>

              {/* Expanded drawer */}
              {isOpen && det && (
                <div style={{ borderTop: `1px solid ${c.border}`, padding: "12px 13px", background: "#fff" }}>

                  {/* Why the grade */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase",
                      letterSpacing: "0.06em", marginBottom: 4 }}>Why this grade</div>
                    <p style={{ fontSize: 12, color: NAVY_COLOR, lineHeight: 1.45, margin: 0 }}>{det.why}</p>
                  </div>

                  {/* Stat tiles */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <div style={{ flex: 1, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8,
                      padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>YPG Allowed</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: c.text }}>{det.allowedYpg}</div>
                      <div style={{ fontSize: 9, color: MUTED }}>vs {posFilter}</div>
                    </div>
                    <div style={{ flex: 1, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8,
                      padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>TD/Game</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: c.text }}>{det.allowedTdPg}</div>
                      <div style={{ fontSize: 9, color: MUTED }}>vs {posFilter}</div>
                    </div>
                    <div style={{ flex: 1, background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)",
                      borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>Rank</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: NAVY_COLOR }}>#{rank}</div>
                      <div style={{ fontSize: 9, color: MUTED }}>of 32</div>
                    </div>
                    <div style={{ flex: 1.2, background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.08)",
                      borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>Trend</div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: trendColor(det.trend), marginTop: 4 }}>{det.trend}</div>
                    </div>
                  </div>

                  {/* Key defenders */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase",
                      letterSpacing: "0.06em", marginBottom: 5 }}>Key Defenders to Watch</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {det.keyPlayers.map((kp, ki) => (
                        <span key={ki} style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20,
                          background: "rgba(19,35,58,0.07)", color: NAVY_COLOR, border: "1px solid rgba(19,35,58,0.12)" }}>
                          {kp}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* All-position grades for this team */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase",
                      letterSpacing: "0.06em", marginBottom: 5 }}>All Position Grades</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {allPos.map(pos => {
                        const g2  = (row as any)[`grade${pos}`] as string;
                        const r2  = (row as any)[pos] as number;
                        const d2  = row.detail?.[pos] as MatchupDetail | undefined;
                        const c2  = gradeColor(g2);
                        const active = pos === posFilter;
                        return (
                          <div key={pos} style={{ flex: 1, border: `1px solid ${active ? c2.border : "rgba(19,35,58,0.10)"}`,
                            background: active ? c2.bg : "rgba(19,35,58,0.03)", borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: MUTED }}>{pos}</div>
                            <div style={{ fontSize: 16, fontWeight: 900, color: c2.text }}>{g2}</div>
                            <div style={{ fontSize: 9, color: MUTED }}>#{r2}</div>
                            {d2 && <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>{d2.allowedYpg} YPG</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BettingEdgePanel ────────────────────────────────────────────────────────
function BettingEdgePanel({
  lineMovement, injuryImpact, weather, firstHalf
}: { lineMovement: any; injuryImpact: any; weather: any; firstHalf: any }) {
  const [section, setSection] = useState<"lines" | "injury" | "weather" | "firsthalf">("lines");
  const sections = [
    { key: "lines",     label: "📉 Line Movement" },
    { key: "injury",    label: "🏥 Injury Impact" },
    { key: "weather",   label: "🌬️ Weather" },
    { key: "firsthalf", label: "1H Model" },
  ] as const;

  return (
    <div>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {sections.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            style={{ padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: section === s.key ? NAVY : "rgba(19,35,58,0.07)",
              color: section === s.key ? BG_COLOR : MUTED }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* LINE MOVEMENT */}
      {section === "lines" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How line movement is analyzed"
            items={[
              { label: "Spread Move", desc: "Difference between opening spread and current spread. A line moving against the public bet % direction signals sharp (professional) money." },
              { label: "Sharp Action", desc: "⚡ SHARP ACTION fires when ≥60% of public bets are on one side but the line moves the opposite way — strong indicator of sharp/syndicate action." },
              { label: "Public Bets %", desc: "Percentage of total bet tickets (not money) on each side. High public % on a team whose line is moving away = reverse line movement." },
              { label: "Total Move", desc: "Change in the game total (Over/Under) from open to current. Closing total drops often signal weather or key offensive injuries." },
              { label: "Data source", desc: "The Odds API (real sportsbook lines). Sharp note is generated when spread move and public % disagree by 2+ points." },
            ]}
          />
          {!lineMovement?.games?.length && (
            <p style={{ color: MUTED, fontSize: 13 }}>No line movement data — check back closer to game week.</p>
          )}
          {(lineMovement?.games ?? []).map((g: any, i: number) => {
            const lineMove = g.currentSpread - g.openSpread;
            const isSharp = g.reverseLineMovement;
            const totalMove = g.currentTotal - g.openTotal;
            return (
              <div key={i} style={{ background: "#fff", borderRadius: 12, border: `1px solid ${isSharp ? "rgba(212,168,67,0.4)" : "rgba(19,35,58,0.10)"}`, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 2 }}>
                      {g.away} @ {g.home}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED }}>{g.gameTime}</div>
                  </div>
                  {isSharp && (
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 10,
                      background: "rgba(212,168,67,0.15)", color: "#92680a", border: "1px solid rgba(212,168,67,0.35)" }}>
                      ⚡ SHARP ACTION
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, marginBottom: 2 }}>SPREAD MOVE</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: lineMove !== 0 ? (lineMove > 0 ? "#16a34a" : "#ef4444") : MUTED }}>
                      {lineMove > 0 ? `+${lineMove.toFixed(1)}` : lineMove.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 10, color: MUTED }}>{g.openSpread > 0 ? "+" : ""}{g.openSpread} → {g.currentSpread > 0 ? "+" : ""}{g.currentSpread}</div>
                  </div>
                  <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, marginBottom: 2 }}>PUBLIC BETS</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: NAVY }}>{g.publicBetPct}%</div>
                    <div style={{ fontSize: 10, color: MUTED }}>on {g.publicFavor}</div>
                  </div>
                  <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, marginBottom: 2 }}>TOTAL MOVE</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: totalMove !== 0 ? (totalMove > 0 ? "#16a34a" : "#ef4444") : MUTED }}>
                      {g.openTotal} → {g.currentTotal}
                    </div>
                    <div style={{ fontSize: 10, color: MUTED }}>{g.overUnderTrend}</div>
                  </div>
                </div>
                {g.sharpNote && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#92680a", background: "rgba(212,168,67,0.08)", borderRadius: 6, padding: "5px 8px" }}>
                    💡 {g.sharpNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* INJURY IMPACT */}
      {section === "injury" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How injury impact is graded"
            items={[
              { label: "Betting Impact", desc: "High = expected 3+ point line adjustment. Medium = 1–2 points. Low = minor depth change with minimal line effect." },
              { label: "Line Impact", desc: "Estimated direction and magnitude of how this injury moves the spread or total (e.g. 'Total −2.5' or 'Spread +1.5 away')." },
              { label: "Status", desc: "Out = confirmed miss. Doubtful = <25% chance to play. Questionable = 50/50. Limited = likely plays but reduced role." },
              { label: "Recommendation", desc: "Auto-generated based on position, role, and the adjusted Vegas line — e.g. 'Fade team total' or 'Target backup RB props'." },
              { label: "Data source", desc: "ESPN injury report feed, updated multiple times daily. Stale if last refresh >4 hrs before game time." },
            ]}
          />
          {!injuryImpact?.players?.length && (
            <p style={{ color: MUTED, fontSize: 13 }}>No key injury impacts detected this week.</p>
          )}
          {(injuryImpact?.players ?? []).map((p: any, i: number) => {
            const impactColor = p.bettingImpact === "High" ? "#ef4444" : p.bettingImpact === "Medium" ? GOLD_COLOR : MUTED;
            return (
              <div key={i} style={{ background: "#fff", borderRadius: 12, border: `1px solid rgba(239,68,68,0.15)`, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div>
                    <span style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{p.playerName}</span>
                    <span style={{ fontSize: 10, marginLeft: 8, padding: "1px 6px", borderRadius: 10,
                      background: "rgba(19,35,58,0.07)", color: MUTED }}>{p.position} · {p.team}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 10,
                    background: `${impactColor}18`, color: impactColor, border: `1px solid ${impactColor}40` }}>
                    {p.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{p.injuryNote}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "6px 10px", flex: 1 }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>LINE IMPACT</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginTop: 1 }}>{p.lineImpact}</div>
                  </div>
                  <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "6px 10px", flex: 1 }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>BETTING IMPACT</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: impactColor, marginTop: 1 }}>{p.bettingImpact}</div>
                  </div>
                  <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "6px 10px", flex: 2 }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>RECOMMENDATION</div>
                    <div style={{ fontSize: 11, color: NAVY, marginTop: 1 }}>{p.recommendation}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* WEATHER */}
      {section === "weather" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How weather impact is assessed"
            items={[
              { label: "Wind", desc: "≥15 mph = passing game concern, total depressed. ≥20 mph = significant — fade kickers, WRs, and passing totals. Under becomes the lean." },
              { label: "Temperature", desc: "≤32°F adds ball-handling difficulty. Sub-zero wind chill with snow historically reduces scoring by 3–7 points vs. the opener." },
              { label: "Precipitation", desc: "≥30% chance triggers a caution flag. Rain/snow above 50% chance = lean Under on game total and fade WR volume props." },
              { label: "DOME", desc: "Dome games are excluded from weather concerns. All indoor teams are marked automatically." },
              { label: "Data source", desc: "Open-Meteo free forecast API pulled at request time for each outdoor stadium's lat/lon coordinates." },
            ]}
          />
          {!weather?.games?.length && (
            <p style={{ color: MUTED, fontSize: 13 }}>No outdoor games with weather concerns this week.</p>
          )}
          {(weather?.games ?? []).map((g: any, i: number) => {
            const hasConcern = g.windSpeed >= 15 || g.tempF <= 32 || g.precipitation > 30;
            return (
              <div key={i} style={{ background: "#fff", borderRadius: 12,
                border: `1px solid ${hasConcern ? "rgba(239,68,68,0.25)" : "rgba(19,35,58,0.10)"}`,
                padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{g.away} @ {g.home}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>{g.stadium} · {g.gameTime}</div>
                  </div>
                  {hasConcern && (
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 10,
                      background: "rgba(239,68,68,0.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>
                      ⚠️ WEATHER ALERT
                    </span>
                  )}
                  {g.isDome && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10,
                      background: "rgba(19,35,58,0.07)", color: MUTED }}>DOME</span>
                  )}
                </div>
                {!g.isDome && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 8 }}>
                    {[
                      { label: "TEMP", value: `${g.tempF}°F`, concern: g.tempF <= 32 },
                      { label: "WIND", value: `${g.windSpeed} mph`, concern: g.windSpeed >= 15 },
                      { label: "PRECIP", value: `${g.precipitation}%`, concern: g.precipitation > 30 },
                      { label: "CONDITION", value: g.condition, concern: false },
                    ].map((w, j) => (
                      <div key={j} style={{ background: w.concern ? "rgba(239,68,68,0.08)" : "rgba(19,35,58,0.04)",
                        borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{w.label}</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: w.concern ? "#ef4444" : NAVY, marginTop: 2 }}>{w.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {g.bettingNote && (
                  <div style={{ fontSize: 11, color: "#92680a", background: "rgba(212,168,67,0.08)", borderRadius: 6, padding: "5px 8px" }}>
                    💡 {g.bettingNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FIRST HALF MODEL */}
      {section === "firsthalf" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How the first-half model works"
            items={[
              { label: "H1 Total Proj", desc: "Model-projected first-half scoring based on team pace, recent H1 averages, and the Vegas game total. Compare to the market H1 line to find edge." },
              { label: "H1 Spread Proj", desc: "Which team is favored in the first half and by how much. H1 spreads often diverge from full-game spreads — useful for live or first-half bets." },
              { label: "Edge", desc: "Over = our model projects more first-half scoring than the market line. Under = model projects less. Neutral = within 0.5 of the market." },
              { label: "Why H1?", desc: "First-half totals attract less sharp action than full-game lines, creating more exploitable edges. Trailing teams also adjust their script in H2." },
              { label: "Inputs", desc: "Team first-half scoring averages (L4 wks), Vegas total, spread (game script), pace rankings, and any weather flags from the Weather panel." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
            First-half totals have less sharp action. Teams trailing at half run more pass plays in H2 — use this to inform H1 totals and team script.
          </p>
          {!firstHalf?.games?.length && (
            <p style={{ color: MUTED, fontSize: 13 }}>No first-half projections available — check back during the week.</p>
          )}
          {(firstHalf?.games ?? []).map((g: any, i: number) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 4 }}>{g.away} @ {g.home}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>H1 TOTAL PROJ</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>{g.h1TotalProj}</div>
                  <div style={{ fontSize: 10, color: MUTED }}>Mkt: {g.h1TotalLine}</div>
                </div>
                <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>H1 SPREAD PROJ</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>{g.h1SpreadProj > 0 ? "+" : ""}{g.h1SpreadProj}</div>
                  <div style={{ fontSize: 10, color: MUTED }}>Mkt: {g.h1SpreadLine > 0 ? "+" : ""}{g.h1SpreadLine}</div>
                </div>
                <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>EDGE</div>
                  <div style={{ fontSize: 13, fontWeight: 900,
                    color: g.edge === "Over" ? "#16a34a" : g.edge === "Under" ? "#ef4444" : MUTED }}>{g.edge}</div>
                  <div style={{ fontSize: 10, color: MUTED }}>{g.edgeNote}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FantasyToolsPanel ────────────────────────────────────────────────────────
function FantasyToolsPanel({
  gameScript, redZone, dvpSplits, playoffGrader, adpValue, byeWeeks, streamingDST,
  ssPlayer1, setSsPlayer1, ssPlayer2, setSsPlayer2, ssResult, setSsResult, ssLoading, setSsLoading,
}: any) {
  const [section, setSection] = useState<"gamescript" | "redzone" | "dvp" | "startsit" | "playoff" | "adp" | "bye" | "dst">("gamescript");
  const [rzPositionFilter, setRzPositionFilter] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");
  const sections = [
    { key: "gamescript", label: "🎯 Game Script" },
    { key: "redzone",    label: "🔴 Red Zone" },
    { key: "dvp",        label: "📊 DvP Splits" },
    { key: "startsit",   label: "✅ Start/Sit" },
    { key: "playoff",    label: "🏆 Playoff Schedule" },
    { key: "adp",        label: "💎 ADP Value" },
    { key: "bye",        label: "📅 Bye Weeks" },
    { key: "dst",        label: "🛡️ Stream DST" },
  ] as const;

  const handleStartSit = async () => {
    if (!ssPlayer1 || !ssPlayer2) return;
    setSsLoading(true);
    try {
      const r = await fetch(`/api/nfl/start-sit?p1=${encodeURIComponent(ssPlayer1)}&p2=${encodeURIComponent(ssPlayer2)}`);
      setSsResult(await r.json());
    } catch { setSsResult({ error: "Failed to load" }); }
    setSsLoading(false);
  };

  const gradeColor = (g: string) => {
    if (g === "A+" || g === "A") return "#16a34a";
    if (g === "B") return GOLD_COLOR;
    if (g === "C") return "#f97316";
    return "#ef4444";
  };

  return (
    <div>
      {/* Section tabs — scrollable row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {sections.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            style={{ padding: "5px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
              background: section === s.key ? NAVY : "rgba(19,35,58,0.07)",
              color: section === s.key ? BG_COLOR : MUTED }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* GAME SCRIPT */}
      {section === "gamescript" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How game script is projected"
            items={[
              { label: "Pass Rate %", desc: "Projected offensive pass rate based on spread size. A team favored by 7+ runs ~55% pass; a 7+ underdog runs ~62% pass in negative game scripts." },
              { label: "Script", desc: "Positive = team expected to lead, run-heavy second half. Negative = team expected to trail, pass-heavy to catch up. Neutral = competitive game." },
              { label: "Target players", desc: "WRs and TEs benefit most from negative scripts (more attempts). Highlighted in green — prioritize these in DFS/fantasy." },
              { label: "Fade players", desc: "RBs on teams with negative scripts lose opportunity in pass-heavy situations. Highlighted in red — downgrade or bench." },
              { label: "Snap Note", desc: "Per-team context line explaining projected pass rate and which role players benefit most from the game script." },
              { label: "Inputs", desc: "Vegas spread + game total (Odds API), active roster from Sleeper, injury status from ESPN injury feed (Out/Doubtful filtered), and snap trend context to rank role importance." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
            Projected game script based on Vegas totals and spreads. Teams trailing by 7+ pass ~60% of snaps — avoid their RBs, target their WRs and TEs.
          </p>
          {(gameScript?.games ?? []).map((g: any, i: number) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{g.away} @ {g.home}</div>
                <div style={{ fontSize: 11, color: MUTED }}>Total: {g.total} · Spread: {g.spread}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                {[g.homeScript, g.awayScript].map((team: any, j: number) => (
                  <div key={j} style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginBottom: 4 }}>{team.team}</div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>Pass rate: <b style={{ color: team.passRatePct >= 60 ? "#16a34a" : NAVY }}>{team.passRatePct}%</b></div>
                    <div style={{ fontSize: 10, color: MUTED }}>Script: <b style={{ color: NAVY }}>{team.script}</b></div>
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, marginBottom: 3 }}>TARGET</div>
                      {(team.targetPlayers ?? []).map((p: string, k: number) => (
                        <span key={k} style={{ fontSize: 10, fontWeight: 700, marginRight: 4, padding: "1px 6px",
                          borderRadius: 10, background: "rgba(34,197,94,0.12)", color: "#15803d" }}>{p}</span>
                      ))}
                    </div>
                    {(team.fadePlayers ?? []).length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, marginBottom: 3 }}>FADE</div>
                        {(team.fadePlayers ?? []).map((p: string, k: number) => (
                          <span key={k} style={{ fontSize: 10, fontWeight: 700, marginRight: 4, padding: "1px 6px",
                            borderRadius: 10, background: "rgba(239,68,68,0.10)", color: "#ef4444" }}>{p}</span>
                        ))}
                      </div>
                    )}
                    {team.snapNote && (
                      <div style={{ marginTop: 6, fontSize: 9, color: MUTED, fontStyle: "italic", lineHeight: 1.4 }}>{team.snapNote}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* RED ZONE */}
      {section === "redzone" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How red zone share is analyzed"
            items={[
              { label: "RZ Target Share", desc: "% of team targets inside the opponent's 20-yard line that go to this player. 25%+ = elite TD upside. 15–24% = above-average. Below 15% = low TD floor." },
              { label: "RZ TGTs/G", desc: "Average red zone targets per game this season. Stability here is more predictive of TD scoring than general target volume." },
              { label: "TD/G", desc: "Touchdowns per game. Cross-referenced with RZ share to identify players who are converting their opportunities." },
              { label: "Overall TGT%", desc: "Full-field target share for context. High overall share + high RZ share = true WR1/TE1 alpha." },
              { label: "Color coding", desc: "Red = 25%+ RZ share (elite). Gold = 15–24% (above avg). Navy = below 15%. Note text explains any relevant matchup context." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
            Red zone target share is the strongest predictor of TD upside. Players with 25%+ RZ share are must-starts regardless of general target volume.
          </p>
          {/* Position filter */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
            {(["ALL", "QB", "RB", "WR", "TE"] as const).map(pos => (
              <button key={pos} onClick={() => setRzPositionFilter(pos)}
                style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
                  background: rzPositionFilter === pos ? NAVY : "rgba(19,35,58,0.07)",
                  color: rzPositionFilter === pos ? BG_COLOR : MUTED }}>
                {pos}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 10, color: MUTED, alignSelf: "center" }}>
              {(redZone?.players ?? []).filter((p: any) => rzPositionFilter === "ALL" || p.position === rzPositionFilter).length} players
            </span>
          </div>
          {(redZone?.players ?? []).filter((p: any) => rzPositionFilter === "ALL" || p.position === rzPositionFilter).map((p: any, i: number) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{p.playerName}</span>
                  <span style={{ fontSize: 10, marginLeft: 8, padding: "1px 6px", borderRadius: 10, background: "rgba(19,35,58,0.07)", color: MUTED }}>{p.position} · {p.team}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: p.rzTargetShare >= 25 ? "#ef4444" : p.rzTargetShare >= 15 ? GOLD_COLOR : NAVY }}>{p.rzTargetShare}%</div>
                  <div style={{ fontSize: 9, color: MUTED }}>RZ Target Share</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[
                  { label: "RZ TGTs/G", value: p.rzTargetsPerGame },
                  { label: "TD/G", value: p.tdsPerGame },
                  { label: "OVERALL TGT%", value: `${p.overallTargetPct}%` },
                ].map((m, j) => (
                  <div key={j} style={{ background: "rgba(19,35,58,0.04)", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{m.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: MUTED }}>{p.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* DVP SPLITS */}
      {section === "dvp" && (
        <div>
          <AnalysisInfo
            title="How DvP splits are graded"
            items={[
              { label: "Full-season grade", desc: "Overall season rank vs this position (A–D). Based on yards + fantasy points allowed per game to each position." },
              { label: "L4 grade", desc: "Last 4 weeks only — reflects current defensive form. A defense can be a full-season A but trending to D if key players are injured." },
              { label: "Home weakness", desc: "If a defense allows significantly more fantasy points at home than away (≥15% more), the position they're weakest against at home is flagged." },
              { label: "Trending worse", desc: "Flagged when the L4 grade is 2+ letter grades worse than the full-season grade — indicates a defense that has fallen apart recently." },
              { label: "Use case", desc: "Stack your player against a defense with a D grade at their position, especially if L4 is also D and the team shows no signs of recovery." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>
            Defense vs. Position with home/away and recent-form splits. Last 4 weeks weighted more heavily than full season.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(dvpSplits?.defenses ?? []).map((d: any, i: number) => (
              <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 8 }}>{d.team} Defense</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 8 }}>
                  {["QB", "RB", "WR", "TE"].map(pos => {
                    const posData = d[pos];
                    return (
                      <div key={pos} style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>{pos}</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: gradeColor(posData?.grade ?? "C"), marginTop: 2 }}>{posData?.grade ?? "C"}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>L4: {posData?.last4Grade ?? "C"}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {d.homeWeakness && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(239,68,68,0.10)", color: "#ef4444" }}>Weak at home vs {d.homeWeakness}</span>}
                  {d.trendingWorse && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(212,168,67,0.10)", color: "#92680a" }}>↓ trending {d.trendingWorse}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* START/SIT */}
      {section === "startsit" && (
        <div>
          <AnalysisInfo
            title="How start/sit decisions are made"
            items={[
              { label: "Proj Pts", desc: "PPR fantasy point projection for this week. Based on target/touch share, game script, matchup grade, and Vegas total." },
              { label: "Matchup Grade", desc: "A–D grade for this player's position vs. their opponent this week (same scale as the Matchup Map tab)." },
              { label: "Snap %", desc: "Most recent recorded snap percentage. High snap share = floor protection. Below 60% = high variance." },
              { label: "Confidence", desc: "1–10 composite of all factors. 8+ = start without question. 5–7 = rely on projected points. Below 5 = bench if better options exist." },
              { label: "Verdict", desc: "START is awarded to the player with the higher composite score. Reasoning explains the key differentiating factor." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>
            Compare two players at the same position. Get a start/sit recommendation with matchup, snap trend, and projection data.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[
              { label: "PLAYER 1", val: ssPlayer1, set: setSsPlayer1 },
              { label: "PLAYER 2", val: ssPlayer2, set: setSsPlayer2 },
            ].map(({ label, val, set }, j) => (
              <div key={j}>
                <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "block", marginBottom: 4 }}>{label}</label>
                <input value={val} onChange={e => set(e.target.value)}
                  placeholder="Player name..."
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(19,35,58,0.20)",
                    fontSize: 13, color: NAVY, background: "#fff", boxSizing: "border-box" as const }} />
              </div>
            ))}
          </div>
          <button onClick={handleStartSit} disabled={ssLoading || !ssPlayer1 || !ssPlayer2}
            style={{ width: "100%", padding: "10px", borderRadius: 10, border: "none", cursor: "pointer",
              background: NAVY, color: BG_COLOR, fontWeight: 800, fontSize: 14, opacity: ssLoading ? 0.6 : 1 }}>
            {ssLoading ? "Analyzing..." : "Get Recommendation"}
          </button>
          {ssResult && !ssResult.error && (
            <div style={{ marginTop: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "14px" }}>
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>
                  START: <span style={{ color: "#16a34a" }}>{ssResult.start}</span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{ssResult.reasoning}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[ssResult.p1, ssResult.p2].map((p: any, j: number) => (
                  <div key={j} style={{ background: p.name === ssResult.start ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.06)",
                    border: `1px solid ${p.name === ssResult.start ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.20)"}`,
                    borderRadius: 10, padding: "10px" }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: NAVY, marginBottom: 6 }}>{p.name}</div>
                    {[
                      { label: "Proj Pts", val: p.projPts },
                      { label: "Matchup", val: p.matchupGrade },
                      { label: "Snap %", val: `${p.snapPct}%` },
                      { label: "Confidence", val: `${p.confidence}/10` },
                    ].map((m, k) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: MUTED }}>{m.label}</span>
                        <span style={{ fontWeight: 700, color: NAVY }}>{m.val}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PLAYOFF SCHEDULE GRADER */}
      {section === "playoff" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How playoff grades are assigned"
            items={[
              { label: "Weekly grade", desc: "A–D matchup grade for each of Weeks 15, 16, and 17 — the typical fantasy playoff window. Uses the same DvP Splits methodology." },
              { label: "Overall grade", desc: "Average of all three playoff weeks, weighted toward Wk 16 (championship week for most leagues). A= all three weeks favorable." },
              { label: "Opponent", desc: "The actual NFL opponent for that week. Bye weeks appear as 'BYE' and auto-grade as D — plan your bench depth accordingly." },
              { label: "Use case", desc: "When choosing between two similar players at trade deadline or on the waiver wire, the player with better playoff grades has long-term upside." },
              { label: "Update cadence", desc: "Schedule grades update weekly as matchups are finalized. Late-season schedule changes (flexed games) are reflected within 24 hrs." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
            Fantasy playoff schedule grades (Weeks 15–17). A = elite matchup, D = avoid. Plan your roster now.
          </p>
          {(playoffGrader?.players ?? []).map((p: any, i: number) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{p.playerName}</span>
                  <span style={{ fontSize: 10, marginLeft: 8, padding: "1px 6px", borderRadius: 10, background: "rgba(19,35,58,0.07)", color: MUTED }}>{p.position} · {p.team}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: gradeColor(p.overallPlayoffGrade) }}>{p.overallPlayoffGrade}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {(p.weeklyMatchups ?? []).map((w: any, j: number) => (
                  <div key={j} style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>WK {w.week}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: gradeColor(w.grade), marginTop: 2 }}>{w.grade}</div>
                    <div style={{ fontSize: 10, color: MUTED }}>vs {w.opponent}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADP VALUE */}
      {section === "adp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How ADP value is identified"
            items={[
              { label: "Value diff", desc: "Consensus rank minus ADP rank. A +15 means the player is going 15 spots later in drafts than experts rank them — you get a discount." },
              { label: "Consensus rank", desc: "Averaged across FantasyPros, ESPN, Yahoo, and CBS expert rankings, updated weekly during the season and daily at peak draft periods." },
              { label: "ADP rank", desc: "Average draft position across platforms (Underdog, Sleeper, ESPN, Yahoo). Reflects where real managers are actually taking players." },
              { label: "Target range", desc: "Positive value = target. Negative value = the market has already priced in the hype — avoid overpaying." },
              { label: "Use case", desc: "In redraft: use at your pick. In best ball: stack ADP value at WR/RB in late rounds. In DFS: ADP value often correlates with lower ownership." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
            Players ranked significantly higher in consensus rankings than their current ADP. Positive value = you're getting them cheaper than they should go.
          </p>
          {(adpValue?.players ?? []).map((p: any, i: number) => {
            const valueDiff = p.consensusRank - p.adpRank;
            return (
              <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{p.playerName}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>{p.position} · {p.team}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: valueDiff > 0 ? "#16a34a" : "#ef4444" }}>
                      {valueDiff > 0 ? `+${valueDiff}` : valueDiff}
                    </div>
                    <div style={{ fontSize: 9, color: MUTED }}>positions of value</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: MUTED }}>ADP: <b style={{ color: NAVY }}>#{p.adpRank}</b></span>
                  <span style={{ fontSize: 11, color: MUTED }}>Consensus Rank: <b style={{ color: NAVY }}>#{p.consensusRank}</b></span>
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{p.note}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* BYE WEEKS */}
      {section === "bye" && (
        <div>
          <AnalysisInfo
            title="How bye weeks affect your roster"
            items={[
              { label: "Planning rule", desc: "Add a streaming starter 1 week before your key players' byes. Avoid drafting/trading for players on the same bye week as your other starters." },
              { label: "Waiver impact", desc: "High-ownership players on bye weeks often free up adds — their owners may drop them by mistake. Check the waiver wire mid-week." },
              { label: "DFS impact", desc: "Fewer teams playing = smaller player pool. Use bye weeks to find contrarian plays in tournaments (lower ownership, same upside)." },
              { label: "Data source", desc: "Official NFL schedule. Byes are fixed at season start; playoff bye rules do not apply here (this covers regular season Weeks 1–18)." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>All NFL team bye weeks for the current season. Plan your waiver wire adds and streaming plays accordingly.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
            {Object.entries(byeWeeks?.byWeek ?? {}).map(([week, teams]: [string, any]) => (
              <div key={week} style={{ background: "#fff", borderRadius: 10, border: "1px solid rgba(19,35,58,0.10)", padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Week {week}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {(teams as string[]).map((t: string) => (
                    <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 6,
                      background: "rgba(19,35,58,0.07)", color: MUTED }}>{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STREAMING DST */}
      {section === "dst" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AnalysisInfo
            title="How streaming DSTs are graded"
            items={[
              { label: "Matchup grade", desc: "A–D grade based on opponent offensive rank. A = opponent is bottom-5 offense (most points allowed, turnovers, low scoring). D = elite offense." },
              { label: "Opp OFF rank", desc: "Opponent's offensive ranking 1–32 this season. Rank 28–32 = ideal streaming matchup. Rank 1–8 = avoid regardless of DST quality." },
              { label: "Proj pts", desc: "Projected fantasy points for the DST this week in standard PPR scoring. Based on sacks, turnovers, and points allowed models." },
              { label: "Ownership %", desc: "Only DSTs owned in ≤50% of leagues are shown — ensures these are actually available on your waiver wire." },
              { label: "Strategy", desc: "Never roster a DST for more than 2 weeks. Matchups are the only thing that matters — even great defenses face elite offenses eventually." },
            ]}
          />
          <p style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
            Defenses available on most waiver wires with top-5 matchups this week. Stream the right DST for a huge points edge.
          </p>
          {(streamingDST?.teams ?? []).map((t: any, i: number) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>{t.team} DST</span>
                  <span style={{ fontSize: 11, marginLeft: 8, color: MUTED }}>vs {t.opponent}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: gradeColor(t.matchupGrade) }}>{t.matchupGrade}</div>
                  <div style={{ fontSize: 9, color: MUTED }}>matchup</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: MUTED }}>Owned: <b style={{ color: NAVY }}>{t.ownershipPct}%</b></span>
                <span style={{ fontSize: 11, color: MUTED }}>Opp OFF rank: <b style={{ color: NAVY }}>#{t.oppOffenseRank}</b></span>
                <span style={{ fontSize: 11, color: MUTED }}>Proj pts: <b style={{ color: NAVY }}>{t.projPoints}</b></span>
              </div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>{t.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
// ─── NFL Pick of the Week ───────────────────────────────────────────────
function nflGradeColor(g: string): string {
  if (g === "A") return "#16a34a";
  if (g === "B+") return "#2563eb";
  if (g === "B") return "#7c3aed";
  if (g === "C+") return "#d97706";
  return "#6b7280";
}
function nflResultBadge(result: string) {
  if (result === "win")  return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(34,197,94,0.12)", color: "#16a34a", borderRadius: 10, padding: "2px 7px" }}>WIN</span>;
  if (result === "loss") return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(239,68,68,0.10)", color: "#dc2626", borderRadius: 10, padding: "2px 7px" }}>LOSS</span>;
  if (result === "push") return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(250,204,21,0.12)", color: "#b8930a", borderRadius: 10, padding: "2px 7px" }}>PUSH</span>;
  return <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(19,35,58,0.06)", color: "#6b7280", borderRadius: 10, padding: "2px 7px" }}>PENDING</span>;
}

function NflPickCard({ pick, label, isRunnerUp = false, isOwner = false, sport = "NFL", onGrade }: {
  pick: any; label: string; isRunnerUp?: boolean; isOwner?: boolean; sport?: string;
  onGrade?: (which: "primary" | "runnerUp", result: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const which = isRunnerUp ? "runnerUp" as const : "primary" as const;
  const mlFmt = (ml: number | null) => ml == null ? "" : ml > 0 ? `+${ml}` : `${ml}`;
  const spreadFmt = (s: number | null) => s == null ? "" : s > 0 ? `+${s}` : `${s}`;

  const handleShare = () => {
    const text = [
      `🏟️ Clubhouse IQ — ${sport} Pick of the Week`,
      `${label}: ${pick.pickTeam}`,
      `Grade: ${pick.grade} · Confidence: ${pick.score}/100`,
      pick.pickML ? `ML: ${mlFmt(pick.pickML)}` : "",
      pick.spread != null ? `Spread: ${spreadFmt(pick.spread)}` : "",
      "",
      "Why this pick:",
      ...(pick.reasons ?? []).slice(0, 5).map((r: string) => `• ${r}`),
      "",
      pick.weatherNote ? `🌤️ ${pick.weatherNote}` : "",
      pick.injuryNote ? `⚠️ ${pick.injuryNote}` : "",
      "",
      "📱 Clubhouse IQ",
    ].filter(Boolean).join("\n");
    if (navigator.share) { navigator.share({ title: `${sport} Pick of the Week`, text }); }
    else { navigator.clipboard?.writeText(text); setSharing(true); setTimeout(() => setSharing(false), 2000); }
  };

  return (
    <div style={{ borderRadius: 14, border: `1.5px solid ${isRunnerUp ? "rgba(19,35,58,0.10)" : "rgba(212,168,67,0.35)"}`,
      background: isRunnerUp ? "rgba(19,35,58,0.02)" : "rgba(212,168,67,0.04)", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: isRunnerUp ? "rgba(19,35,58,0.06)" : "rgba(212,168,67,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isRunnerUp ? <Star size={16} style={{ color: "#6b7280" }} /> : <Trophy size={16} style={{ color: GOLD_COLOR }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>{label}</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: NAVY, lineHeight: 1.2 }}>{pick.pickTeam}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
            {pick.awayTeam} @ {pick.homeTeam}
            {pick.pickML != null ? ` · ML ${mlFmt(pick.pickML)}` : ""}
            {pick.spread != null ? ` · Spread ${spreadFmt(pick.spread)}` : ""}
            {pick.total != null ? ` · O/U ${pick.total}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: nflGradeColor(pick.grade) }}>{pick.grade}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>{pick.score}/100</div>
          {nflResultBadge(pick.result ?? "pending")}
        </div>
        {open ? <ChevronUp size={14} style={{ color: MUTED, flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: MUTED, flexShrink: 0 }} />}
      </div>

      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid rgba(19,35,58,0.08)" }}>
          {/* Stats tiles */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, marginBottom: 10 }}>
            {[
              { label: "Confidence", value: `${pick.score}/100` },
              { label: "Grade", value: pick.grade, color: nflGradeColor(pick.grade) },
              pick.sharpScore > 0 ? { label: "Sharp Score", value: `${pick.sharpScore}/100` } : null,
              pick.publicBetPct != null ? { label: "Public Bets", value: `${Math.round(pick.publicBetPct)}%` } : null,
              pick.total != null ? { label: "Total", value: `O/U ${pick.total}` } : null,
            ].filter(Boolean).map((stat: any, i: number) => (
              <div key={i} style={{ background: "rgba(19,35,58,0.05)", borderRadius: 8, padding: "5px 10px" }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 0.8 }}>{stat.label}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: stat.color ?? NAVY }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Weather */}
          {pick.weatherNote && (
            <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "6px 10px", marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>🌤️</span>
              <span style={{ fontSize: 11, color: MUTED }}>{pick.weatherNote}</span>
            </div>
          )}

          {/* Injury */}
          {pick.injuryNote && (
            <div style={{ background: "rgba(239,68,68,0.05)", borderRadius: 8, padding: "6px 10px", marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>⚠️</span>
              <span style={{ fontSize: 11, color: "#dc2626" }}>{pick.injuryNote}</span>
            </div>
          )}

          {/* Reasons */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: NAVY, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Why this pick</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {(pick.reasons ?? []).map((reason: string, i: number) => {
                const isNeg = /caution|injury|wind|rain|snow|cold|extreme|public heavily/i.test(reason);
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ width: 16, height: 16, borderRadius: 8, flexShrink: 0, marginTop: 1,
                      background: isNeg ? "rgba(239,68,68,0.10)" : "rgba(34,197,94,0.10)",
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isNeg ? <TrendingDown size={8} style={{ color: "#dc2626" }} /> : <CheckCircle size={8} style={{ color: "#16a34a" }} />}
                    </div>
                    <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{reason}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {isRunnerUp && (
            <div style={{ background: "rgba(19,35,58,0.04)", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
              <p style={{ fontSize: 10, color: MUTED, fontStyle: "italic" }}>Runner-up pick — not graded unless primary pick also fires.</p>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={handleShare} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
              padding: "6px 14px", borderRadius: 20, border: `1px solid rgba(19,35,58,0.15)`, background: "transparent", cursor: "pointer", color: NAVY }}>
              <Share2 size={12} /> {sharing ? "Copied!" : "Share Pick"}
            </button>
            {isOwner && (!pick.result || pick.result === "pending") && onGrade && (
              <>
                <button onClick={() => onGrade(which, "win")} style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 20, border: "none", background: "rgba(34,197,94,0.12)", color: "#16a34a", cursor: "pointer" }}>✓ Win</button>
                <button onClick={() => onGrade(which, "loss")} style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 20, border: "none", background: "rgba(239,68,68,0.10)", color: "#dc2626", cursor: "pointer" }}>✗ Loss</button>
                <button onClick={() => onGrade(which, "push")} style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 20, border: "none", background: "rgba(250,204,21,0.10)", color: "#b8930a", cursor: "pointer" }}>~ Push</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NflPickOfWeekPanel() {
  const [showHistory, setShowHistory] = useState(false);
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/nfl/pick-of-week"],
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });

  const gradeMutation = useMutation({
    mutationFn: ({ week, result, which }: any) =>
      fetch("/api/nfl/pick-of-week/grade", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, result, which }) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/nfl/pick-of-week"] }),
  });

  const history: Record<string, any> = data?.history ?? {};
  const histEntries = Object.values(history).sort((a: any, b: any) => b.week > a.week ? 1 : -1);
  const wins   = histEntries.filter((e: any) => e.primary?.result === "win").length;
  const losses = histEntries.filter((e: any) => e.primary?.result === "loss").length;
  const graded = wins + losses;
  const pct    = graded > 0 ? Math.round((wins / graded) * 100) : null;

  return (
    <div style={{ background: BG_COLOR, borderRadius: 16, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: NAVY, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Trophy size={15} style={{ color: GOLD_COLOR }} />
          <span style={{ fontSize: 14, fontWeight: 900, color: BG_COLOR }}>NFL Pick of the Week</span>
          {data?.week && <span style={{ fontSize: 10, color: "rgba(246,241,231,0.55)", marginLeft: 4 }}>{data.week}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {graded > 0 && (
            <span style={{ fontSize: 11, fontWeight: 800, color: pct !== null && pct >= 60 ? "#4ade80" : pct !== null && pct >= 40 ? "#fbbf24" : "#f87171" }}>
              {wins}W-{losses}L{pct !== null ? ` (${pct}%)` : ""}
            </span>
          )}
          <button onClick={() => setShowHistory(h => !h)}
            style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.7)", background: "rgba(246,241,231,0.08)",
              border: "none", borderRadius: 12, padding: "4px 10px", cursor: "pointer" }}>
            {showHistory ? "Hide History" : "History"}
          </button>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        {isLoading && (
          <div style={{ textAlign: "center", padding: "24px 0", color: MUTED, fontSize: 13 }}>Analyzing this week's NFL slate…</div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "#dc2626", fontSize: 12 }}>Unable to load pick — try again shortly.</div>
        )}
        {!isLoading && !error && !data?.primary && (
          <div style={{ textAlign: "center", padding: "16px 0", color: MUTED, fontSize: 12 }}>No NFL lines posted yet for this week.</div>
        )}

        {/* Primary pick */}
        {data?.primary && (
          <div style={{ marginBottom: 10 }}>
            <NflPickCard
              pick={{ ...data.primary, result: history[data.week]?.primary?.result ?? "pending" }}
              label="Pick of the Week"
              isOwner={isOwner}
              onGrade={(which, result) => gradeMutation.mutate({ week: data.week, result, which })}
            />
          </div>
        )}

        {/* Runner-up */}
        {data?.runnerUp && (
          <NflPickCard
            pick={{ ...data.runnerUp, result: history[data.week]?.runnerUp?.result ?? "pending" }}
            label="Runner-Up"
            isRunnerUp
            isOwner={isOwner}
            onGrade={(which, result) => gradeMutation.mutate({ week: data.week, result, which })}
          />
        )}

        {/* Footer */}
        {data?.gamesAnalyzed > 0 && (
          <p style={{ fontSize: 10, color: MUTED, marginTop: 10, textAlign: "center" }}>
            {data.gamesAnalyzed} games analyzed · {data.liveData ? "Live odds" : "Pre-season data"} · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT" : ""}
          </p>
        )}

        {/* History */}
        {showHistory && (
          <div style={{ marginTop: 14, borderTop: "1px solid rgba(19,35,58,0.08)", paddingTop: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: NAVY, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>Historical Picks</p>
            {histEntries.length === 0 && <p style={{ fontSize: 11, color: MUTED }}>No historical picks yet — picks accumulate each week.</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {histEntries.map((entry: any) => (
                <div key={entry.week} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "rgba(19,35,58,0.03)", borderRadius: 10, padding: "8px 12px" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: NAVY }}>{entry.primary?.pickTeam ?? "—"}</div>
                    <div style={{ fontSize: 10, color: MUTED }}>{entry.week} · Grade {entry.primary?.grade} · {entry.primary?.score}/100</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {nflResultBadge(entry.primary?.result ?? "pending")}
                    {isOwner && entry.primary?.result === "pending" && (
                      <>
                        <button onClick={() => gradeMutation.mutate({ week: entry.week, result: "win", which: "primary" })}
                          style={{ fontSize: 9, padding: "2px 6px", borderRadius: 8, border: "none", background: "rgba(34,197,94,0.12)", color: "#16a34a", cursor: "pointer", fontWeight: 700 }}>W</button>
                        <button onClick={() => gradeMutation.mutate({ week: entry.week, result: "loss", which: "primary" })}
                          style={{ fontSize: 9, padding: "2px 6px", borderRadius: 8, border: "none", background: "rgba(239,68,68,0.10)", color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>L</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EndZone() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"projections" | "news" | "radar">("projections");
  const [slate, setSlate] = useState("week");
  const [market, setMarket] = useState("all");
  const [minEdge, setMinEdge] = useState(0);
  const [teamFilter, setTeamFilter] = useState("");
  const [selectedProp, setSelectedProp] = useState<PropRow | null>(null);
  const [newsQuery, setNewsQuery] = useState("");
  const [newsQueryDebounced, setNewsQueryDebounced] = useState("");
  const [newsSort, setNewsSort] = useState<"recent" | "popular">("recent");
  const [lockedPick, setLockedPick] = useState<any>(null);
  const [radarPanel, setRadarPanel] = useState<"waiver" | "snaps" | "handcuffs" | "matchup" | "betting" | "fantasy" | "pickweek">("waiver");

  // Debounce news query
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setNewsQueryDebounced(newsQuery), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [newsQuery]);

  // ── API queries ──
  const { data: propsData, isLoading: propsLoading, refetch: refetchProps } = useQuery({
    queryKey: ["/api/nfl/props", slate, market, minEdge, teamFilter],
    queryFn: () =>
      fetch(`/api/nfl/props?slate=${slate}&market=${encodeURIComponent(market)}&minEdge=${minEdge}&team=${encodeURIComponent(teamFilter)}`)
        .then(r => r.json()),
    staleTime: 15 * 60 * 1000,
  });

  const { data: streakData } = useQuery<StreakData>({
    queryKey: ["/api/nfl/streak"],
    queryFn: () => apiRequest("GET", "/api/nfl/streak").then(r => r.json()),
    staleTime: 30 * 1000,
  });

  const { data: newsData, isLoading: newsLoading, refetch: refetchNews } = useQuery({
    queryKey: ["/api/nfl/news", newsQueryDebounced, newsSort],
    queryFn: () =>
      fetch(`/api/nfl/news?q=${encodeURIComponent(newsQueryDebounced)}&sort=${newsSort}&limit=30`).then(r => r.json()),
    // Always fetch — no query required; default feed shows fantasy-relevant news
    staleTime: 5 * 60 * 1000,
  });

  const { data: waiverData, isLoading: waiverLoading } = useQuery({
    queryKey: ["/api/nfl/waiver-radar"],
    queryFn: () => fetch("/api/nfl/waiver-radar").then(r => r.json()),
    staleTime: 30 * 60 * 1000,
  });
  const { data: snapData, isLoading: snapLoading } = useQuery({
    queryKey: ["/api/nfl/snap-trends"],
    queryFn: () => fetch("/api/nfl/snap-trends").then(r => r.json()),
    staleTime: 30 * 60 * 1000,
  });
  const { data: handcuffData, isLoading: handcuffLoading } = useQuery({
    queryKey: ["/api/nfl/handcuffs"],
    queryFn: () => fetch("/api/nfl/handcuffs").then(r => r.json()),
    staleTime: 60 * 60 * 1000,
  });
  const { data: matchupData, isLoading: matchupLoading } = useQuery({
    queryKey: ["/api/nfl/matchup-heatmap"],
    queryFn: () => fetch("/api/nfl/matchup-heatmap").then(r => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const { data: lineMovementData } = useQuery({
    queryKey: ["/api/nfl/line-movement"],
    queryFn: () => fetch("/api/nfl/line-movement").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: injuryImpactData } = useQuery({
    queryKey: ["/api/nfl/injury-impact"],
    queryFn: () => fetch("/api/nfl/injury-impact").then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const { data: weatherData } = useQuery({
    queryKey: ["/api/nfl/weather"],
    queryFn: () => fetch("/api/nfl/weather").then(r => r.json()),
    staleTime: 30 * 60 * 1000,
  });

  const { data: firstHalfData } = useQuery({
    queryKey: ["/api/nfl/first-half"],
    queryFn: () => fetch("/api/nfl/first-half").then(r => r.json()),
    staleTime: 15 * 60 * 1000,
  });

  const { data: gameScriptData } = useQuery({
    queryKey: ["/api/nfl/game-script"],
    queryFn: () => fetch("/api/nfl/game-script").then(r => r.json()),
    staleTime: 15 * 60 * 1000,
  });

  const { data: redZoneData } = useQuery({
    queryKey: ["/api/nfl/red-zone"],
    queryFn: () => fetch("/api/nfl/red-zone").then(r => r.json()),
    staleTime: 30 * 60 * 1000,
  });

  const { data: dvpSplitsData } = useQuery({
    queryKey: ["/api/nfl/dvp-splits"],
    queryFn: () => fetch("/api/nfl/dvp-splits").then(r => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const { data: playoffGraderData } = useQuery({
    queryKey: ["/api/nfl/playoff-grader"],
    queryFn: () => fetch("/api/nfl/playoff-grader").then(r => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const { data: adpValueData } = useQuery({
    queryKey: ["/api/nfl/adp-value"],
    queryFn: () => fetch("/api/nfl/adp-value").then(r => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const { data: byeWeekData } = useQuery({
    queryKey: ["/api/nfl/bye-weeks"],
    queryFn: () => fetch("/api/nfl/bye-weeks").then(r => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const { data: streamingDSTData } = useQuery({
    queryKey: ["/api/nfl/streaming-dst"],
    queryFn: () => fetch("/api/nfl/streaming-dst").then(r => r.json()),
    staleTime: 30 * 60 * 1000,
  });

  const [ssPlayer1, setSsPlayer1] = useState("");
  const [ssPlayer2, setSsPlayer2] = useState("");
  const [ssResult, setSsResult] = useState<any>(null);
  const [ssLoading, setSsLoading] = useState(false);



  const lockPickMutation = useMutation({
    mutationFn: (pick: any) => apiRequest("POST", "/api/nfl/lock-pick", pick).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nfl/streak"] });
    },
  });

  const handleLock = (prop: PropRow) => {
    setLockedPick(prop);
    lockPickMutation.mutate({
      player: prop.player,
      team: prop.team,
      market: prop.market,
      line: prop.line,
      edge: prop.edge,
      confidence: prop.confidence,
    });
  };

  const rows: PropRow[] = propsData?.rows ?? [];
  const hasData = rows.length > 0;

  const SLATES = ["Week", "Sunday", "MNF", "TNF", "Today"];
  const MARKETS = ["All", "Anytime TD", "Rush Yds", "Rec Yds", "Receptions", "Pass Yds"];

  return (
    <div style={{ background: BG_COLOR, minHeight: "100vh", paddingBottom: 40 }}>
      {/* ── Page header ── */}
      <div style={{ background: NAVY, padding: "20px 20px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: GOLD_COLOR, letterSpacing: "0.1em", textTransform: "uppercase" }}>Clubhouse IQ</p>
              <h1 style={{ fontWeight: 900, fontSize: 24, color: BG_COLOR, lineHeight: 1.1, marginTop: 2 }}>🏈 End Zone</h1>
              <p style={{ fontSize: 12, color: "rgba(246,241,231,0.55)", marginTop: 3 }}>NFL Decision Engine</p>
            </div>
            <button
              onClick={() => refetchProps()}
              style={{ background: "rgba(246,241,231,0.10)", border: "none", borderRadius: 10, padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: BG_COLOR }}
            >
              <RefreshCw size={14} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Refresh</span>
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {([["projections", "🏈 Projections"], ["news", "📰 Fantasy News"], ["radar", "🎯 Radar"]] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "10px 18px", background: "transparent", border: "none", cursor: "pointer",
                  fontWeight: 800, fontSize: 13, color: activeTab === tab ? GOLD_COLOR : "rgba(246,241,231,0.55)",
                  borderBottom: activeTab === tab ? `2px solid ${GOLD_COLOR}` : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px" }}>

        {/* ════ TAB 1: Projections ════ */}
        {activeTab === "projections" && (
          <div>
            {/* Filter bar */}
            <div style={{ overflowX: "auto", paddingBottom: 4, marginTop: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: "max-content" }}>
                {/* Slate */}
                <div style={{ display: "flex", gap: 4, background: "#fff", borderRadius: 10, padding: 4, border: "1px solid rgba(19,35,58,0.10)" }}>
                  {SLATES.map(s => (
                    <button
                      key={s}
                      onClick={() => setSlate(s.toLowerCase())}
                      style={{
                        padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
                        background: slate === s.toLowerCase() ? NAVY : "transparent",
                        color: slate === s.toLowerCase() ? BG_COLOR : MUTED,
                        transition: "all 0.12s",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Market filter */}
                <select
                  value={market}
                  onChange={e => setMarket(e.target.value)}
                  style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(19,35,58,0.15)", background: "#fff", fontSize: 12, fontWeight: 600, color: NAVY, cursor: "pointer" }}
                >
                  {MARKETS.map(m => <option key={m} value={m.toLowerCase()}>{m}</option>)}
                </select>

                {/* Min edge */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 8, padding: "5px 10px", border: "1px solid rgba(19,35,58,0.12)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: "nowrap" }}>Min Edge</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={minEdge}
                    onChange={e => setMinEdge(Number(e.target.value))}
                    style={{ width: 44, border: "none", fontSize: 12, fontWeight: 700, color: NAVY, background: "transparent", outline: "none" }}
                  />
                  <span style={{ fontSize: 11, color: MUTED }}>%</span>
                </div>

                {/* Team filter */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 8, padding: "5px 10px", border: "1px solid rgba(19,35,58,0.12)" }}>
                  <Filter size={13} color={MUTED} />
                  <input
                    type="text"
                    placeholder="Team..."
                    value={teamFilter}
                    onChange={e => setTeamFilter(e.target.value)}
                    style={{ width: 70, border: "none", fontSize: 12, fontWeight: 600, color: NAVY, background: "transparent", outline: "none" }}
                  />
                  {teamFilter && (
                    <button onClick={() => setTeamFilter("")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 0 }}>
                      <X size={12} color={MUTED} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Loading */}
            {propsLoading && (
              <div style={{ textAlign: "center", padding: "40px 0", color: MUTED }}>
                <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px", display: "block" }} />
                <p style={{ fontSize: 13, fontWeight: 600 }}>Loading projections…</p>
              </div>
            )}

            {/* Off-season or empty */}
            {!propsLoading && !hasData && <OffSeasonCard />}

            {/* Props table */}
            {!propsLoading && hasData && (
              <>
              <AnalysisInfo
                title="How projections are graded"
                items={[
                  { label: "Model %", desc: "Our model's estimated probability the prop hits, based on season stats, last 5 games, matchup quality, and pace." },
                  { label: "Book %", desc: "Implied probability from the bookmaker's odds (juice removed). Model % vs Book % = your edge." },
                  { label: "Edge %", desc: "Model % minus Book %. Positive edge means our model sees value the market hasn't fully priced." },
                  { label: "Confidence", desc: "Strong (≥70% model, ≥7% edge) · Medium (55–69%, 4–6% edge) · Thin (<55% or <4% edge). Only Strong/Medium appear by default." },
                  { label: "Recent avg", desc: "Cross-validated against L5 game log. If recent average diverges >25% from season baseline, a safeguard flag is applied." },
                ]}
              />
              <PropsTable
                rows={rows}
                onSelect={setSelectedProp}
                lockedPick={lockedPick}
                onLock={handleLock}
              />
              </>
            )}

            {/* Streak tracker */}
            <div style={{ marginTop: 24 }}>
              <p style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <Trophy size={16} color={GOLD_COLOR} /> Streak Tracker
              </p>
              <StreakTracker data={streakData} />
            </div>
          </div>
        )}

        {/* ════ TAB 2: Fantasy News ════ */}
        {activeTab === "news" && (
          <div style={{ marginTop: 20 }}>
            {/* Pre-season notice */}
            <div style={{ background: "rgba(212,168,67,0.10)", border: "1px solid rgba(212,168,67,0.30)", borderRadius: 10, padding: "8px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>📰</span>
              <span style={{ fontSize: 12, color: "#92680a", fontWeight: 600 }}>Showing NFL news relevant to the upcoming 2026 season — free agency, training camp, and depth chart updates.</span>
            </div>

            {/* ── Search + Sort controls ── */}
            <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center" }}>
              {/* Search bar */}
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={15} color={MUTED} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  type="text"
                  placeholder="Filter by player or team…"
                  value={newsQuery}
                  onChange={e => setNewsQuery(e.target.value)}
                  style={{
                    width: "100%", paddingLeft: 38, paddingRight: newsQuery ? 36 : 12,
                    paddingTop: 10, paddingBottom: 10,
                    borderRadius: 10, border: "1px solid rgba(19,35,58,0.15)", background: "#fff",
                    fontSize: 13, fontWeight: 500, color: NAVY, outline: "none", boxSizing: "border-box",
                  }}
                />
                {newsQuery && (
                  <button
                    onClick={() => setNewsQuery("")}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}
                  >
                    <X size={14} color={MUTED} />
                  </button>
                )}
              </div>

              {/* Sort toggle */}
              <div style={{ display: "flex", borderRadius: 10, border: "1px solid rgba(19,35,58,0.15)", overflow: "hidden", flexShrink: 0 }}>
                {(["recent", "popular"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setNewsSort(s)}
                    style={{
                      padding: "9px 13px",
                      fontSize: 12,
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      background: newsSort === s ? NAVY : "#fff",
                      color: newsSort === s ? BG_COLOR : MUTED,
                      transition: "all 0.15s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s === "recent" ? "🕐 Recent" : "⭐ Top"}
                  </button>
                ))}
              </div>

              {/* Refresh */}
              <button
                onClick={() => refetchNews()}
                style={{ background: "none", border: "1px solid rgba(19,35,58,0.15)", borderRadius: 10, padding: "9px 10px", cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0 }}
                title="Refresh news"
              >
                <RefreshCw size={14} color={MUTED} style={newsLoading ? { animation: "spin 1s linear infinite" } : {}} />
              </button>
            </div>

            {/* ── Source + count summary ── */}
            <AnalysisInfo
              title="How news is ranked & filtered"
              items={[
                { label: "Sources", desc: "ESPN, CBS Sports, FantasyPros, NFL.com, Sleeper, and Yahoo Fantasy. Each card is tagged with its source." },
                { label: "Relevance score", desc: "Each headline is scored for fantasy/betting relevance. Injury, activation, and trade items score higher. Minimum threshold of 3 to appear." },
                { label: "Sort modes", desc: "Most Recent sorts by publish time. Most Relevant ranks by relevance score — injury reports and lineup changes appear first." },
                { label: "Player tags", desc: "Named players detected in the headline are shown as chips below each card for quick scanning." },
                { label: "Status badges", desc: "🚑 Injury · ✅ Activated · 🔄 Trade/Move · ⛔ Suspended — auto-detected from headline keywords." },
              ]}
            />
            {!newsLoading && newsData?.articles?.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>
                  {newsQueryDebounced ? `${newsData.articles.length} results for "${newsQueryDebounced}"` : `${newsData.articles.length} fantasy-relevant stories`}
                </p>
                <p style={{ fontSize: 11, color: MUTED }}>
                  Updated {newsData.cachedAt ? new Date(newsData.cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "just now"}
                </p>
              </div>
            )}

            {/* ── Loading ── */}
            {newsLoading && (
              <div style={{ textAlign: "center", padding: "36px 0", color: MUTED }}>
                <RefreshCw size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px", display: "block" }} />
                <p style={{ fontSize: 13 }}>Loading fantasy news…</p>
              </div>
            )}

            {/* ── News cards ── */}
            {!newsLoading && newsData?.articles?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(newsData.articles as NewsItem[]).map((item, i) => (
                  <NewsCard key={(item as any).url ?? i} item={item} />
                ))}
              </div>
            )}

            {/* ── No results (search) ── */}
            {!newsLoading && newsQueryDebounced && newsData?.articles?.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: MUTED }}>
                <AlertCircle size={28} style={{ margin: "0 auto 10px", display: "block", opacity: 0.4 }} />
                <p style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>No news found for "{newsQueryDebounced}"</p>
                <p style={{ fontSize: 13 }}>Try a different player name or clear the filter to see all news.</p>
              </div>
            )}

            {/* ── Empty (no data at all) ── */}
            {!newsLoading && !newsData?.articles?.length && !newsQueryDebounced && (
              <div style={{ textAlign: "center", padding: "48px 20px", color: MUTED }}>
                <Newspaper size={36} style={{ margin: "0 auto 12px", display: "block", opacity: 0.35 }} />
                <p style={{ fontWeight: 700, fontSize: 14, color: NAVY, marginBottom: 4 }}>No news available</p>
                <p style={{ fontSize: 13 }}>Tap refresh to try again.</p>
              </div>
            )}
          </div>
        )}

        {/* ════ TAB 3: Radar ════ */}
        {activeTab === "radar" && (
          <div style={{ marginTop: 20 }}>
            {/* Pre-season notice banner */}
            <div style={{ background: "rgba(212,168,67,0.10)", border: "1px solid rgba(212,168,67,0.30)", borderRadius: 10, padding: "8px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>🏈</span>
              <span style={{ fontSize: 12, color: "#92680a", fontWeight: 600 }}>
                <b>2026 Pre-Season Outlook</b> — All panels show forward-looking analysis for the upcoming NFL season. Team assignments update live via Sleeper roster data. Betting Edge panels activate once Week 1 lines are posted.
              </span>
            </div>
            {/* Sub-panel selector */}
            <div style={{ display: "flex", gap: 6, marginBottom: 18, overflowX: "auto", paddingBottom: 4 }}>
              {([
                ["pickweek",  "🏆 Pick of Week"],
                ["waiver",    "📡 Waiver Wire"],
                ["snaps",     "📊 Snap Trends"],
                ["handcuffs", "🔗 Handcuffs"],
                ["matchup",   "🗺️ Matchup Map"],
                ["betting",   "📉 Betting Edge"],
                ["fantasy",   "🧩 Fantasy Tools"],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setRadarPanel(key)}
                  style={{
                    padding: "8px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                    border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                    background: radarPanel === key ? GOLD_COLOR : "rgba(19,35,58,0.07)",
                    color: radarPanel === key ? "#1a1000" : MUTED,
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Waiver Wire */}
            {radarPanel === "waiver" && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 2 }}>📡 Waiver Wire Radar</p>
                  <p style={{ fontSize: 12, color: MUTED }}>Low-ownership players (≤50%) with rising value. Pickup scores are based on snap trends, injury context, and usage.</p>
                </div>
                {waiverLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: MUTED }}>Loading waiver data…</div>
                ) : (
                  <WaiverRadarPanel data={waiverData?.data ?? []} />
                )}
              </div>
            )}

            {/* Snap Trends */}
            {radarPanel === "snaps" && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 2 }}>📊 Snap & Usage Trends</p>
                  <p style={{ fontSize: 12, color: MUTED }}>Week-over-week snap% and target share movement. Rising players are gaining roles; falling players are losing them.</p>
                </div>
                {snapLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: MUTED }}>Loading snap data…</div>
                ) : (
                  <SnapTrendsPanel data={snapData?.data ?? []} />
                )}
              </div>
            )}

            {/* Handcuffs */}
            {radarPanel === "handcuffs" && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 2 }}>🔗 Handcuff Alert Board</p>
                  <p style={{ fontSize: 12, color: MUTED }}>Backup RBs most likely to become startable if their starter misses time. Sorted by priority and injury risk.</p>
                </div>
                {handcuffLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: MUTED }}>Loading handcuff data…</div>
                ) : (
                  <HandcuffPanel data={handcuffData?.data ?? []} />
                )}
              </div>
            )}

            {/* Matchup Heatmap */}
            {radarPanel === "matchup" && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 2 }}>🗺️ Matchup Heat Map</p>
                  <p style={{ fontSize: 12, color: MUTED }}>Defensive rankings vs each position. A = best matchup for fantasy, D = toughest. Select a position to sort.</p>
                </div>
                {matchupLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: MUTED }}>Loading matchup data…</div>
                ) : (
                  <MatchupHeatmapPanel data={matchupData?.data ?? []} />
                )}
              </div>
            )}

            {/* Betting Edge */}
            {radarPanel === "betting" && (
              <BettingEdgePanel
                lineMovement={lineMovementData}
                injuryImpact={injuryImpactData}
                weather={weatherData}
                firstHalf={firstHalfData}
              />
            )}

            {/* Fantasy Tools */}
            {radarPanel === "fantasy" && (
              <FantasyToolsPanel
                gameScript={gameScriptData}
                redZone={redZoneData}
                dvpSplits={dvpSplitsData}
                playoffGrader={playoffGraderData}
                adpValue={adpValueData}
                byeWeeks={byeWeekData}
                streamingDST={streamingDSTData}
                ssPlayer1={ssPlayer1} setSsPlayer1={setSsPlayer1}
                ssPlayer2={ssPlayer2} setSsPlayer2={setSsPlayer2}
                ssResult={ssResult} setSsResult={setSsResult}
                ssLoading={ssLoading} setSsLoading={setSsLoading}
              />
            )}

            {/* Pick of the Week */}
            {radarPanel === "pickweek" && (
              <div>
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 2 }}>🏆 NFL Pick of the Week</p>
                  <p style={{ fontSize: 12, color: MUTED }}>The top-graded NFL team bet this week based on odds, sharp money, weather, injury report, and line movement. Includes a runner-up pick and full historical record.</p>
                </div>
                <NflPickOfWeekPanel />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Detail Drawer ── */}
      {selectedProp && (
        <DetailDrawer
          prop={selectedProp}
          onClose={() => setSelectedProp(null)}
          onLock={p => { handleLock(p); setSelectedProp(null); }}
          lockedPick={lockedPick}
        />
      )}

      {/* ── Spin keyframe ── */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
