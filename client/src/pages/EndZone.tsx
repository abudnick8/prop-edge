import { useQuery, useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  ChevronDown, ChevronUp, TrendingUp, Target, Zap, AlertCircle,
  CheckCircle, Clock, Search, X, Lock, Trophy, BarChart2,
  Newspaper, RefreshCw, Filter, Star
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
      <p style={{ color: BG_COLOR, fontWeight: 900, fontSize: 18, marginBottom: 8 }}>Off-Season Mode</p>
      <p style={{ color: "rgba(246,241,231,0.65)", fontSize: 13, maxWidth: 320, margin: "0 auto 16px" }}>
        The NFL regular season hasn't started yet. Projections will populate automatically once games are scheduled.
      </p>
      <p style={{ color: GOLD_COLOR, fontSize: 12, fontWeight: 700 }}>Next season kicks off September 2026 🗓</p>
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

// ─── News Card ────────────────────────────────────────────────────────────────
function NewsCard({ item }: { item: NewsItem }) {
  const hasInjury = (item.headline || "").toLowerCase().match(/injur|ir|dnp|questionable|out|limited/);
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", padding: "14px 16px", boxShadow: "0 1px 4px rgba(19,35,58,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: item.source === "ESPN" ? "rgba(212,0,0,0.10)" : "rgba(19,35,58,0.08)", color: item.source === "ESPN" ? "#c00" : MUTED, border: `1px solid ${item.source === "ESPN" ? "rgba(212,0,0,0.20)" : "rgba(19,35,58,0.15)"}` }}>
            {item.source}
          </span>
          {hasInjury && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}>
              🚑 Injury
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap", marginLeft: 8 }}>{relativeTime(item.timestamp)}</span>
      </div>
      <p style={{ fontWeight: 700, fontSize: 13, color: NAVY, lineHeight: 1.45, marginBottom: item.url ? 8 : 0 }}>{item.headline}</p>
      {item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: GOLD_COLOR, fontWeight: 700, textDecoration: "none" }}>
          Read more →
        </a>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EndZone() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"projections" | "news">("projections");
  const [slate, setSlate] = useState("week");
  const [market, setMarket] = useState("all");
  const [minEdge, setMinEdge] = useState(0);
  const [teamFilter, setTeamFilter] = useState("");
  const [selectedProp, setSelectedProp] = useState<PropRow | null>(null);
  const [newsQuery, setNewsQuery] = useState("");
  const [newsQueryDebounced, setNewsQueryDebounced] = useState("");
  const [lockedPick, setLockedPick] = useState<any>(null);

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

  const { data: newsData, isLoading: newsLoading } = useQuery({
    queryKey: ["/api/nfl/news", newsQueryDebounced],
    queryFn: () =>
      fetch(`/api/nfl/news?q=${encodeURIComponent(newsQueryDebounced)}&limit=20`).then(r => r.json()),
    enabled: newsQueryDebounced.length > 1,
    staleTime: 5 * 60 * 1000,
  });

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
            {([["projections", "🏈 Projections"], ["news", "📰 Fantasy News"]] as const).map(([tab, label]) => (
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
              <PropsTable
                rows={rows}
                onSelect={setSelectedProp}
                lockedPick={lockedPick}
                onLock={handleLock}
              />
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
            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: 16 }}>
              <Search size={16} color={MUTED} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="text"
                placeholder="Search player news (e.g. Tyreek Hill)…"
                value={newsQuery}
                onChange={e => setNewsQuery(e.target.value)}
                style={{
                  width: "100%", paddingLeft: 40, paddingRight: newsQuery ? 40 : 14, paddingTop: 12, paddingBottom: 12,
                  borderRadius: 12, border: "1px solid rgba(19,35,58,0.15)", background: "#fff",
                  fontSize: 14, fontWeight: 600, color: NAVY, outline: "none", boxSizing: "border-box",
                }}
              />
              {newsQuery && (
                <button
                  onClick={() => setNewsQuery("")}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", display: "flex" }}
                >
                  <X size={16} color={MUTED} />
                </button>
              )}
            </div>

            {/* Loading */}
            {newsLoading && (
              <div style={{ textAlign: "center", padding: "30px 0", color: MUTED }}>
                <RefreshCw size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px", display: "block" }} />
                <p style={{ fontSize: 13 }}>Fetching news…</p>
              </div>
            )}

            {/* Empty state */}
            {!newsLoading && newsQueryDebounced.length <= 1 && (
              <div style={{ textAlign: "center", padding: "48px 20px", color: MUTED }}>
                <Newspaper size={36} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }} />
                <p style={{ fontWeight: 700, fontSize: 14, color: NAVY, marginBottom: 4 }}>Fantasy News & Updates</p>
                <p style={{ fontSize: 13 }}>Search for a player above to see their latest news and stats</p>
              </div>
            )}

            {/* News cards */}
            {!newsLoading && newsData?.items?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(newsData.items as NewsItem[]).map((item, i) => (
                  <NewsCard key={item.id ?? i} item={item} />
                ))}
              </div>
            )}

            {/* No results */}
            {!newsLoading && newsQueryDebounced.length > 1 && newsData?.items?.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: MUTED }}>
                <AlertCircle size={28} style={{ margin: "0 auto 10px", display: "block", opacity: 0.4 }} />
                <p style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>No news found</p>
                <p style={{ fontSize: 13 }}>Try a different player name or check back later.</p>
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
