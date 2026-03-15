import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TrackedProp } from "@shared/schema";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, RefreshCw, TrendingUp, TrendingDown,
  Target, Trophy, CheckCircle2, XCircle, Clock, Pencil, X, ChevronDown, ChevronUp, BarChart3, Flame
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

// ── Sport / stat category configs ─────────────────────────────────────────────
const SPORT_STATS: Record<string, { label: string; emoji: string }[]> = {
  NBA: [
    { label: "Points", emoji: "🏀" },
    { label: "Assists", emoji: "🎯" },
    { label: "Rebounds", emoji: "💪" },
    { label: "3-Pointers Made", emoji: "🎳" },
    { label: "Steals", emoji: "🫳" },
    { label: "Blocks", emoji: "🛡️" },
    { label: "Points + Rebounds + Assists", emoji: "📊" },
    { label: "Minutes", emoji: "⏱️" },
  ],
  NFL: [
    { label: "Passing Yards", emoji: "🏈" },
    { label: "Passing TDs", emoji: "🎯" },
    { label: "Rushing Yards", emoji: "🏃" },
    { label: "Receiving Yards", emoji: "🙌" },
    { label: "Receptions", emoji: "🤲" },
    { label: "Interceptions", emoji: "😬" },
    { label: "Tackles", emoji: "💥" },
    { label: "Sacks", emoji: "🔥" },
  ],
  MLB: [
    { label: "Home Runs", emoji: "💣" },
    { label: "RBIs", emoji: "📈" },
    { label: "Hits", emoji: "⚾" },
    { label: "Strikeouts (pitcher)", emoji: "🌪️" },
    { label: "ERA", emoji: "📉" },
    { label: "Stolen Bases", emoji: "🏃" },
    { label: "Batting Average", emoji: "📊" },
  ],
  NHL: [
    { label: "Goals", emoji: "🥅" },
    { label: "Assists", emoji: "🎯" },
    { label: "Points", emoji: "⭐" },
    { label: "Shots on Goal", emoji: "🏒" },
    { label: "Save %", emoji: "🧤" },
    { label: "Plus/Minus", emoji: "📊" },
  ],
};

const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀", NFL: "🏈", MLB: "⚾", NHL: "🏒",
};

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  active:  { label: "Active",  emoji: "🔥", color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)"  },
  hit:     { label: "Hit ✅",  emoji: "✅", color: "#4ade80", bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.3)"  },
  missed:  { label: "Missed",  emoji: "❌", color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)" },
  expired: { label: "Expired", emoji: "⌛", color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)" },
};

// ── Progress calculation ───────────────────────────────────────────────────────
function calcProgress(prop: TrackedProp): number {
  if (!prop.currentValue || !prop.targetLine) return 0;
  if (prop.direction === "over") {
    return Math.min(100, (prop.currentValue / prop.targetLine) * 100);
  } else {
    // under: closer to 0 means more progress toward staying under
    const remaining = prop.targetLine - prop.currentValue;
    return Math.max(0, Math.min(100, (remaining / prop.targetLine) * 100));
  }
}

function isHit(prop: TrackedProp): boolean {
  if (!prop.currentValue) return false;
  return prop.direction === "over"
    ? prop.currentValue >= prop.targetLine
    : prop.currentValue <= prop.targetLine;
}

// ── Add/Edit Modal ─────────────────────────────────────────────────────────────
interface PropFormData {
  playerName: string;
  sport: string;
  statCategory: string;
  propType: string;
  targetLine: string;
  direction: string;
  currentValue: string;
  gamesPlayed: string;
  notes: string;
  teamName: string;
  season: string;
  status: string;
}

const EMPTY_FORM: PropFormData = {
  playerName: "", sport: "NBA", statCategory: "Points",
  propType: "season_long", targetLine: "", direction: "over",
  currentValue: "", gamesPlayed: "", notes: "", teamName: "",
  season: "2025-26", status: "active",
};

function PropModal({
  open, onClose, initial, onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: PropFormData;
  onSave: (data: PropFormData) => void;
}) {
  const [form, setForm] = useState<PropFormData>(initial);
  const set = (k: keyof PropFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  if (!open) return null;
  const stats = SPORT_STATS[form.sport] ?? SPORT_STATS.NBA;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
      <div className="relative w-full max-w-lg rounded-2xl border p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "linear-gradient(145deg,hsl(265 30% 10%),hsl(265 28% 12%))", borderColor: "rgba(245,158,11,0.3)" }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white"><X size={18} /></button>
        <h2 className="text-lg font-bold mb-5" style={{ color: "#f59e0b" }}>
          {initial.playerName ? "✏️ Edit Prop" : "➕ Track New Prop"}
        </h2>

        <div className="space-y-4">
          {/* Player + Team */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Player Name *</label>
              <input value={form.playerName} onChange={e => set("playerName", e.target.value)}
                placeholder="e.g. LeBron James"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none focus:border-yellow-500/60"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Team (optional)</label>
              <input value={form.teamName} onChange={e => set("teamName", e.target.value)}
                placeholder="e.g. Lakers"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none focus:border-yellow-500/60"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
            </div>
          </div>

          {/* Sport + Prop Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Sport *</label>
              <select value={form.sport} onChange={e => { set("sport", e.target.value); set("statCategory", SPORT_STATS[e.target.value]?.[0]?.label ?? ""); }}
                className="w-full px-3 py-2 rounded-lg text-sm text-white border outline-none"
                style={{ background: "hsl(265 28% 14%)", borderColor: "rgba(255,255,255,0.12)" }}>
                {["NBA","NFL","MLB","NHL"].map(s => <option key={s} value={s}>{SPORT_EMOJI[s]} {s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Prop Type *</label>
              <select value={form.propType} onChange={e => set("propType", e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white border outline-none"
                style={{ background: "hsl(265 28% 14%)", borderColor: "rgba(255,255,255,0.12)" }}>
                <option value="season_long">📅 Season Long</option>
                <option value="game">🎮 Single Game</option>
              </select>
            </div>
          </div>

          {/* Stat Category */}
          <div>
            <label className="text-xs font-semibold text-white/50 mb-1 block">Stat Category *</label>
            <select value={form.statCategory} onChange={e => set("statCategory", e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white border outline-none"
              style={{ background: "hsl(265 28% 14%)", borderColor: "rgba(255,255,255,0.12)" }}>
              {stats.map(s => <option key={s.label} value={s.label}>{s.emoji} {s.label}</option>)}
            </select>
          </div>

          {/* Line + Direction */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Target Line *</label>
              <input value={form.targetLine} onChange={e => set("targetLine", e.target.value)}
                type="number" step="0.5" placeholder="e.g. 1500"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none focus:border-yellow-500/60"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Direction *</label>
              <div className="flex gap-2">
                {["over","under"].map(d => (
                  <button key={d} onClick={() => set("direction", d)}
                    className="flex-1 py-2 rounded-lg text-sm font-bold border transition-all"
                    style={form.direction === d
                      ? { background: d === "over" ? "rgba(245,158,11,0.25)" : "rgba(167,139,250,0.25)", color: d === "over" ? "#fbbf24" : "#a78bfa", borderColor: d === "over" ? "rgba(245,158,11,0.5)" : "rgba(167,139,250,0.5)" }
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.1)" }}>
                    {d === "over" ? "🔺 Over" : "🔻 Under"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Current Value + Games Played */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Current Value</label>
              <input value={form.currentValue} onChange={e => set("currentValue", e.target.value)}
                type="number" step="0.1" placeholder="e.g. 823"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none focus:border-yellow-500/60"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Games Played</label>
              <input value={form.gamesPlayed} onChange={e => set("gamesPlayed", e.target.value)}
                type="number" placeholder="e.g. 48"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none focus:border-yellow-500/60"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
            </div>
          </div>

          {/* Season + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Season</label>
              <input value={form.season} onChange={e => set("season", e.target.value)}
                placeholder="2025-26"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 mb-1 block">Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white border outline-none"
                style={{ background: "hsl(265 28% 14%)", borderColor: "rgba(255,255,255,0.12)" }}>
                <option value="active">🔥 Active</option>
                <option value="hit">✅ Hit</option>
                <option value="missed">❌ Missed</option>
                <option value="expired">⌛ Expired</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-white/50 mb-1 block">Notes (optional)</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
              rows={2} placeholder="Any context about this bet..."
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 border outline-none resize-none"
              style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold border transition-colors"
              style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
              Cancel
            </button>
            <button
              onClick={() => { if (form.playerName && form.targetLine) onSave(form); }}
              disabled={!form.playerName || !form.targetLine}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)", color: "#1a0d00", boxShadow: "0 0 16px rgba(245,158,11,0.3)" }}>
              {initial.playerName ? "💾 Save Changes" : "➕ Add Tracker"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Prop Card ──────────────────────────────────────────────────────────────────
function PropCard({ prop, onEdit, onDelete, onUpdate }: {
  prop: TrackedProp;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (update: Partial<TrackedProp>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const progress = calcProgress(prop);
  const hit = isHit(prop);
  const statusCfg = STATUS_CONFIG[prop.status ?? "active"] ?? STATUS_CONFIG.active;
  const stats = SPORT_STATS[prop.sport] ?? SPORT_STATS.NBA;
  const statEmoji = stats.find(s => s.label === prop.statCategory)?.emoji ?? "📊";
  const remaining = prop.direction === "over"
    ? (prop.targetLine - (prop.currentValue ?? 0)).toFixed(1)
    : ((prop.currentValue ?? 0) - prop.targetLine).toFixed(1);
  const pace = prop.gamesPlayed && prop.currentValue
    ? (prop.currentValue / prop.gamesPlayed).toFixed(1)
    : null;

  // quick-update current value inline
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(prop.currentValue ?? ""));

  return (
    <div className="prop-card rounded-2xl border overflow-hidden transition-all"
      style={{ background: "linear-gradient(145deg,hsl(265 30% 10%),hsl(265 28% 12%))", borderColor: hit ? "rgba(74,222,128,0.4)" : "rgba(245,158,11,0.2)" }}>

      {/* Top strip */}
      <div className="h-[3px]" style={{ background: hit ? "linear-gradient(90deg,#4ade80,#22d3ee)" : "linear-gradient(90deg,#f59e0b,#a78bfa)" }} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-lg">{SPORT_EMOJI[prop.sport]}</span>
              <span className="font-black text-base leading-tight" style={{ color: "hsl(45 100% 92%)" }}>
                {prop.playerName}
              </span>
              {prop.teamName && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
                  {prop.teamName}
                </span>
              )}
              {hit && <span className="text-sm animate-bounce">🏆</span>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.65)" }}>
                {statEmoji} {prop.statCategory}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md font-bold border"
                style={{ background: statusCfg.bg, color: statusCfg.color, borderColor: statusCfg.border }}>
                {statusCfg.emoji} {statusCfg.label}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md font-semibold"
                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                {prop.propType === "season_long" ? "📅 Season" : "🎮 Game"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" style={{ color: "rgba(255,255,255,0.4)" }}>
              <Pencil size={13} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors" style={{ color: "rgba(248,113,113,0.5)" }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Big numbers row */}
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <div className="text-xs font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
              {prop.direction === "over" ? "🔺 OVER" : "🔻 UNDER"} TARGET
            </div>
            <div className="text-3xl font-black font-mono" style={{ color: "#f59e0b" }}>
              {prop.targetLine.toLocaleString()}
            </div>
          </div>

          {/* Current value — tap to edit */}
          <div className="text-right">
            <div className="text-xs font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>CURRENT</div>
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onBlur={() => { setEditing(false); const v = parseFloat(editVal); if (!isNaN(v)) onUpdate({ currentValue: v }); }}
                  onKeyDown={e => { if (e.key === "Enter") { setEditing(false); const v = parseFloat(editVal); if (!isNaN(v)) onUpdate({ currentValue: v }); }}}
                  autoFocus
                  className="w-24 text-right text-xl font-black font-mono rounded px-2 py-0.5 border outline-none"
                  style={{ background: "rgba(255,255,255,0.08)", borderColor: "#f59e0b", color: "#fbbf24" }} />
              </div>
            ) : (
              <button onClick={() => { setEditing(true); setEditVal(String(prop.currentValue ?? "")); }}
                className="text-3xl font-black font-mono transition-colors hover:opacity-80"
                style={{ color: hit ? "#4ade80" : "#22d3ee" }}
                title="Tap to update">
                {prop.currentValue != null ? prop.currentValue.toLocaleString() : "—"}
              </button>
            )}
          </div>

          {/* Progress ring */}
          <div className="relative flex-shrink-0" style={{ width: 56, height: 56 }}>
            <svg width={56} height={56} viewBox="0 0 56 56">
              <circle cx={28} cy={28} r={22} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
              <circle cx={28} cy={28} r={22} fill="none"
                stroke={hit ? "#4ade80" : "#f59e0b"}
                strokeWidth={4}
                strokeDasharray={2 * Math.PI * 22}
                strokeDashoffset={2 * Math.PI * 22 * (1 - progress / 100)}
                strokeLinecap="round"
                transform="rotate(-90 28 28)"
                style={{ filter: `drop-shadow(0 0 5px ${hit ? "rgba(74,222,128,0.7)" : "rgba(245,158,11,0.7)"})`, transition: "stroke-dashoffset 0.8s ease" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-black font-mono" style={{ color: hit ? "#4ade80" : "#f59e0b" }}>{Math.round(progress)}%</span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: hit
                  ? "linear-gradient(90deg,#4ade80,#22d3ee)"
                  : progress > 80
                    ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
                    : progress > 50
                      ? "linear-gradient(90deg,#a78bfa,#f59e0b)"
                      : "linear-gradient(90deg,#7c3aed,#a78bfa)",
              }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>0</span>
            <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>
              {!hit && prop.currentValue != null ? (
                prop.direction === "over"
                  ? `${parseFloat(remaining) > 0 ? parseFloat(remaining).toLocaleString() : "0"} to go 🎯`
                  : `${parseFloat(remaining) < 0 ? Math.abs(parseFloat(remaining)).toLocaleString() + " over ⚠️" : parseFloat(remaining).toLocaleString() + " buffer 🛡️"}`
              ) : hit ? "🏆 Target hit!" : "No data yet"}
            </span>
            <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>{prop.targetLine.toLocaleString()}</span>
          </div>
        </div>

        {/* Pace + games row */}
        {(pace || prop.gamesPlayed) && (
          <div className="flex items-center gap-3 mb-3">
            {pace && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)" }}>
                <BarChart3 size={11} style={{ color: "#22d3ee" }} />
                <span className="text-xs font-bold font-mono" style={{ color: "#22d3ee" }}>{pace}/gm pace</span>
              </div>
            )}
            {prop.gamesPlayed && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}>
                <Clock size={11} style={{ color: "#a78bfa" }} />
                <span className="text-xs font-bold" style={{ color: "#a78bfa" }}>{prop.gamesPlayed} GP</span>
              </div>
            )}
            {prop.season && (
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{prop.season}</span>
            )}
          </div>
        )}

        {/* Notes */}
        {prop.notes && (
          <div className="px-3 py-2 rounded-lg text-xs mb-3" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.55)", borderLeft: "3px solid rgba(245,158,11,0.4)" }}>
            📝 {prop.notes}
          </div>
        )}

        {/* Expand toggle */}
        <button onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: "rgba(255,255,255,0.3)" }}>
          {expanded ? <><ChevronUp size={12} /> Hide details</> : <><ChevronDown size={12} /> More details</>}
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Direction</div>
                <div className="font-bold mt-0.5" style={{ color: prop.direction === "over" ? "#fbbf24" : "#a78bfa" }}>
                  {prop.direction === "over" ? "🔺 OVER" : "🔻 UNDER"} {prop.targetLine}
                </div>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Type</div>
                <div className="font-bold mt-0.5 text-white">{prop.propType === "season_long" ? "📅 Season Long" : "🎮 Single Game"}</div>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Progress</div>
                <div className="font-bold font-mono mt-0.5" style={{ color: "#f59e0b" }}>{Math.round(progress)}%</div>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Added</div>
                <div className="font-semibold mt-0.5 text-white/60">{prop.createdAt ? formatDistanceToNow(new Date(prop.createdAt), { addSuffix: true }) : "—"}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function TrackedProps() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProp, setEditingProp] = useState<TrackedProp | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "hit" | "missed">("all");

  const { data: props = [], isLoading } = useQuery<TrackedProp[]>({
    queryKey: ["/api/tracked-props"],
    refetchInterval: 60000,
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tracked-props", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracked-props"] });
      setModalOpen(false);
      toast({ title: "✅ Prop tracker added!" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/tracked-props/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracked-props"] });
      setModalOpen(false);
      setEditingProp(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tracked-props/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracked-props"] });
      toast({ title: "🗑️ Removed" });
    },
  });

  const handleSave = (form: PropFormData) => {
    const payload = {
      playerName: form.playerName,
      sport: form.sport,
      statCategory: form.statCategory,
      propType: form.propType,
      targetLine: parseFloat(form.targetLine),
      direction: form.direction,
      currentValue: form.currentValue ? parseFloat(form.currentValue) : null,
      gamesPlayed: form.gamesPlayed ? parseInt(form.gamesPlayed) : null,
      notes: form.notes || null,
      teamName: form.teamName || null,
      season: form.season,
      status: form.status,
    };
    if (editingProp) {
      updateMutation.mutate({ id: editingProp.id, data: payload });
    } else {
      addMutation.mutate(payload);
    }
  };

  const filteredProps = props.filter(p =>
    filter === "all" ? true : p.status === filter
  );

  const activeCount = props.filter(p => p.status === "active").length;
  const hitCount = props.filter(p => p.status === "hit").length;
  const avgProgress = props.length
    ? Math.round(props.filter(p => p.status === "active").reduce((s, p) => s + calcProgress(p), 0) / Math.max(1, activeCount))
    : 0;

  const modalInitial: PropFormData = editingProp ? {
    playerName: editingProp.playerName,
    sport: editingProp.sport,
    statCategory: editingProp.statCategory,
    propType: editingProp.propType,
    targetLine: String(editingProp.targetLine),
    direction: editingProp.direction,
    currentValue: editingProp.currentValue != null ? String(editingProp.currentValue) : "",
    gamesPlayed: editingProp.gamesPlayed != null ? String(editingProp.gamesPlayed) : "",
    notes: editingProp.notes ?? "",
    teamName: editingProp.teamName ?? "",
    season: editingProp.season ?? "2025-26",
    status: editingProp.status ?? "active",
  } : EMPTY_FORM;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "hsl(45 100% 92%)" }}>
            📊 Prop Tracker
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
            Track season-long and game props — update progress as stats come in
          </p>
        </div>
        <button
          onClick={() => { setEditingProp(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", color: "#1a0d00", boxShadow: "0 0 20px rgba(245,158,11,0.35)" }}>
          <Plus size={15} /> Track New Prop
        </button>
      </div>

      {/* Summary stats */}
      {props.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Tracked", value: props.length, emoji: "📊", color: "#f59e0b" },
            { label: "Active", value: activeCount, emoji: "🔥", color: "#fb923c" },
            { label: "Hit ✅", value: hitCount, emoji: "🏆", color: "#4ade80" },
            { label: "Avg Progress", value: `${avgProgress}%`, emoji: "📈", color: "#22d3ee" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4"
              style={{ background: "linear-gradient(145deg,hsl(265 30% 10%),hsl(265 28% 12%))", borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{s.label}</p>
                <span className="text-base">{s.emoji}</span>
              </div>
              <p className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {props.length > 0 && (
        <div className="flex items-center gap-2 p-1 rounded-xl border w-fit"
          style={{ background: "rgba(0,0,0,0.2)", borderColor: "rgba(255,255,255,0.07)" }}>
          {(["all","active","hit","missed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={filter === f
                ? { background: "linear-gradient(135deg,#b45309,#f59e0b)", color: "#1a0d00" }
                : { color: "rgba(255,255,255,0.45)" }}>
              {f === "all" ? "All" : f === "active" ? "🔥 Active" : f === "hit" ? "✅ Hit" : "❌ Missed"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-64 rounded-2xl" />)}
        </div>
      ) : filteredProps.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed"
          style={{ borderColor: "rgba(245,158,11,0.2)" }}>
          <div className="text-5xl mb-4">📊</div>
          <p className="text-base font-bold mb-1" style={{ color: "hsl(45 100% 92%)" }}>
            {props.length === 0 ? "No props tracked yet" : `No ${filter} props`}
          </p>
          <p className="text-sm mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
            {props.length === 0
              ? "Add season-long or game props to track progress in real-time"
              : "Try a different filter"}
          </p>
          {props.length === 0 && (
            <button
              onClick={() => { setEditingProp(null); setModalOpen(true); }}
              className="px-6 py-2.5 rounded-lg text-sm font-bold"
              style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", color: "#1a0d00" }}>
              ➕ Track Your First Prop
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProps.map(prop => (
            <PropCard
              key={prop.id}
              prop={prop}
              onEdit={() => { setEditingProp(prop); setModalOpen(true); }}
              onDelete={() => deleteMutation.mutate(prop.id)}
              onUpdate={(update) => updateMutation.mutate({ id: prop.id, data: update })}
            />
          ))}
        </div>
      )}

      <PropModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingProp(null); }}
        initial={modalInitial}
        onSave={handleSave}
      />
    </div>
  );
}
