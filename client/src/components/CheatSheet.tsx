/**
 * PropEdge Cheat Sheet
 *
 * A slide-up drawer containing the full smart money reading guide.
 * Drop <CheatSheetButton /> anywhere — it opens the shared drawer.
 * Drop <CheatSheetInline section="spread" /> for a collapsible inline tip.
 */

import { useState } from "react";
import {
  BookOpen, X, DollarSign, Users, TrendingUp, TrendingDown,
  Zap, ChevronDown, ChevronRight, Info, Minus,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CheatSheetSection =
  | "spread"
  | "total"
  | "moneyline"
  | "universal"
  | "nba"
  | "mlb"
  | "nhl"
  | "nfl"
  | "howtoread";

// ─────────────────────────────────────────────────────────────────────────────
// Section data
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS: {
  id: CheatSheetSection;
  label: string;
  emoji: string;
  color: string;
}[] = [
  { id: "howtoread", label: "Fastest Way to Read", emoji: "⚡", color: "#f59e0b" },
  { id: "spread",    label: "Spread / Line",        emoji: "📊", color: "#6366f1" },
  { id: "total",     label: "Total (O/U)",           emoji: "🔢", color: "#06b6d4" },
  { id: "moneyline", label: "Moneyline",             emoji: "💰", color: "#10b981" },
  { id: "universal", label: "Universal Rules",       emoji: "📌", color: "#f97316" },
  { id: "nba",       label: "NBA Totals",            emoji: "🏀", color: "#3b82f6" },
  { id: "mlb",       label: "MLB Totals",            emoji: "⚾", color: "#ef4444" },
  { id: "nhl",       label: "NHL Totals",            emoji: "🏒", color: "#8b5cf6" },
  { id: "nfl",       label: "NFL Totals",            emoji: "🏈", color: "#22c55e" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Legend pill
// ─────────────────────────────────────────────────────────────────────────────

function Pill({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
      style={{ color, borderColor: `${color}40`, background: `${color}15` }}
    >
      {icon} {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BetsPill and MoneyPill for inline reference
// ─────────────────────────────────────────────────────────────────────────────

export function BetsPill({ pct }: { pct?: number }) {
  return (
    <Pill
      icon={<Users size={9} />}
      label={pct != null ? `${pct}% bets` : "% bets"}
      color="#6366f1"
    />
  );
}

export function MoneyPill({ pct }: { pct?: number }) {
  return (
    <Pill
      icon={<DollarSign size={9} />}
      label={pct != null ? `${pct}% money` : "% money"}
      color="#10b981"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal example row
// ─────────────────────────────────────────────────────────────────────────────

function SignalExample({
  bets,
  money,
  label,
  direction,
}: {
  bets: number;
  money: number;
  label: string;
  direction: "sharp" | "fade" | "neutral";
}) {
  const colors = {
    sharp: { text: "#4ade80", bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.2)", icon: <TrendingUp size={11} /> },
    fade:  { text: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)", icon: <TrendingDown size={11} /> },
    neutral: { text: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", icon: <Minus size={11} /> },
  }[direction];

  return (
    <div
      className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center gap-3">
        <BetsPill pct={bets} />
        <MoneyPill pct={money} />
      </div>
      <span className="flex items-center gap-1 font-bold text-[11px]" style={{ color: colors.text }}>
        {colors.icon} {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section content components
// ─────────────────────────────────────────────────────────────────────────────

function HowToReadSection() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Three steps — find the biggest gap between{" "}
        <BetsPill /> and <MoneyPill />, then check if the line moved the same direction as the money.
      </p>
      <div className="space-y-2">
        <div className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg border border-border">
          <span className="text-base font-bold text-primary shrink-0 w-5 text-center">1</span>
          <p className="text-xs leading-relaxed">
            Find the biggest gap between <BetsPill /> and <MoneyPill />.
          </p>
        </div>
        <div className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg border border-border">
          <span className="text-base font-bold text-primary shrink-0 w-5 text-center">2</span>
          <div className="text-xs leading-relaxed space-y-1.5">
            <p>More <MoneyPill /> than <BetsPill /> → <span className="text-green-400 font-bold">Smart money ↑</span></p>
            <p>More <BetsPill /> than <MoneyPill /> → <span className="text-red-400 font-bold">Public/Fade ↓</span></p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg border border-border">
          <span className="text-base font-bold text-primary shrink-0 w-5 text-center">3</span>
          <div className="text-xs leading-relaxed space-y-1">
            <p>Line moved same direction as <MoneyPill /> → <span className="text-green-400 font-bold">Strong sharp signal</span></p>
            <p>Line moved against <MoneyPill /> → <span className="text-muted-foreground">Weak signal</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpreadSection() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Spreads show the <span className="text-foreground font-semibold">clearest sharp vs public split</span>. Compare <BetsPill /> to <MoneyPill /> — the gap tells the story.
      </p>
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Examples</p>
        <SignalExample bets={80} money={30} label="Public — Fade ↓" direction="fade" />
        <SignalExample bets={25} money={65} label="Sharp — Buy ↑" direction="sharp" />
        <SignalExample bets={50} money={48} label="Neutral — No signal" direction="neutral" />
      </div>
      <div className="space-y-1.5 pt-1">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Rules</p>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>• <MoneyPill /> much higher than <BetsPill /> → <span className="text-green-400">Smart money</span></p>
          <p>• <BetsPill /> much higher than <MoneyPill /> → <span className="text-red-400">Public/Fade side</span></p>
          <p>• Numbers close together → <span className="text-muted-foreground">No signal</span></p>
        </div>
      </div>
    </div>
  );
}

function TotalSection() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Totals give weaker signals unless the gap is big. Look for disagreement between <BetsPill /> and <MoneyPill />.
      </p>
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Signal Rules</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2 p-2 bg-green-500/5 border border-green-500/15 rounded-lg">
            <TrendingUp size={13} className="text-green-400 shrink-0" />
            <p className="text-muted-foreground"><MoneyPill /> jumps while <BetsPill /> stays low → <span className="text-green-400 font-bold">Sharp Over ↑</span></p>
          </div>
          <div className="flex items-center gap-2 p-2 bg-red-500/5 border border-red-500/15 rounded-lg">
            <TrendingDown size={13} className="text-red-400 shrink-0" />
            <p className="text-muted-foreground"><BetsPill /> jumps while <MoneyPill /> stays low → <span className="text-red-400 font-bold">Public/Fade ↓</span></p>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/30 border border-border rounded-lg">
            <Minus size={13} className="text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">Numbers close → <span className="text-muted-foreground font-semibold">No signal</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoneylineSection() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Same rules as spread — but <span className="text-foreground font-semibold">moneyline sharp signals are weaker</span> than spreads. Use as confirmation, not primary signal.
      </p>
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Signal Strength</p>
        <div className="grid grid-cols-3 gap-2 text-[10px] text-center">
          {[
            { label: "Spread", strength: "Strongest", color: "#4ade80" },
            { label: "Totals", strength: "Medium", color: "#f59e0b" },
            { label: "Moneyline", strength: "Weakest", color: "#f87171" },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-2 border border-border">
              <p className="font-bold text-foreground">{s.label}</p>
              <p className="font-semibold mt-0.5" style={{ color: s.color }}>{s.strength}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>• <MoneyPill /> significantly higher → <span className="text-green-400">Smart interest ↑</span></p>
        <p>• <BetsPill /> significantly higher → <span className="text-red-400">Public side ↓</span></p>
      </div>
    </div>
  );
}

function UniversalSection() {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {[
          { rule: "Smart money", detail: "% money much higher than % bets", color: "#4ade80" },
          { rule: "Public side", detail: "% bets much higher than % money", color: "#f87171" },
          { rule: "Neutral", detail: "Numbers close together", color: "rgba(255,255,255,0.4)" },
          { rule: "Strong signal", detail: "Line moved toward the money side", color: "#f59e0b" },
          { rule: "Weak signal", detail: "Line moved against the money side", color: "rgba(255,255,255,0.3)" },
        ].map(item => (
          <div key={item.rule} className="flex items-start gap-3 p-2.5 bg-muted/20 border border-border rounded-lg">
            <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: item.color }} />
            <div>
              <p className="text-xs font-bold" style={{ color: item.color }}>{item.rule}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SportTotalSection({ sport }: { sport: "nba" | "mlb" | "nhl" | "nfl" }) {
  const data = {
    nba: {
      up: [
        { reason: "Star scorer/playmaker IN", weight: "high" },
        { reason: "Fast-pace matchup", weight: "medium" },
        { reason: "Rest advantage (tired defenses)", weight: "medium" },
        { reason: "Sharp correction on low opener", weight: "high" },
      ],
      down: [
        { reason: "Star OUT", weight: "high" },
        { reason: "Slow-pace matchup", weight: "medium" },
        { reason: "Back-to-back fatigue", weight: "medium" },
        { reason: "Sharp Under correction", weight: "high" },
      ],
      chase: [
        { label: "Move of 1–2 pts", note: "Normal — value may remain", ok: true },
        { label: "Move of 3+ pts", note: "Almost always news → don't chase", ok: false },
        { label: "News-driven move", note: "Value usually gone", ok: false },
        { label: "Sharp correction", note: "Can still follow if number is off", ok: true },
      ],
    },
    mlb: {
      up: [
        { reason: "Wind OUT (to CF)", weight: "high" },
        { reason: "Bad SP / bullpen game", weight: "high" },
        { reason: "Bullpen fatigue", weight: "medium" },
        { reason: "Over-friendly umpire", weight: "medium" },
        { reason: "Hot/humid weather", weight: "medium" },
      ],
      down: [
        { reason: "Wind IN (from CF)", weight: "high" },
        { reason: "Ace pitcher starting", weight: "high" },
        { reason: "Cold/dense air", weight: "medium" },
        { reason: "Under-friendly umpire", weight: "medium" },
        { reason: "Lineup scratches", weight: "medium" },
      ],
      chase: [
        { label: "Move of 0.5–1 run", note: "Normal — value may remain", ok: true },
        { label: "Move of 1.5+ runs", note: "Almost always weather/pitching → don't chase", ok: false },
        { label: "Wind or pitcher news", note: "Value gone", ok: false },
        { label: "Umpire move", note: "Small moves still bettable", ok: true },
      ],
    },
    nhl: {
      up: [
        { reason: "Backup goalies starting", weight: "high" },
        { reason: "High-event teams matchup", weight: "medium" },
        { reason: "Injured defensemen", weight: "medium" },
        { reason: "Power-play mismatch", weight: "medium" },
        { reason: "Sharp correction", weight: "high" },
      ],
      down: [
        { reason: "Elite goalies confirmed", weight: "high" },
        { reason: "Low-event teams matchup", weight: "medium" },
        { reason: "Travel fatigue", weight: "medium" },
        { reason: "Injured top forwards", weight: "medium" },
        { reason: "Sharp Under money", weight: "high" },
      ],
      chase: [
        { label: "Move of 0.5–1 goal", note: "Normal — value may remain", ok: true },
        { label: "Move of 1.5+ goals", note: "Almost always news → avoid chasing", ok: false },
        { label: "Goalie news", note: "Value gone", ok: false },
        { label: "Pace mismatch correction", note: "May still be bettable", ok: true },
      ],
    },
    nfl: {
      up: [
        { reason: "Weather improves", weight: "medium" },
        { reason: "Key offensive player IN", weight: "high" },
        { reason: "Fast-pace projection", weight: "medium" },
        { reason: "Defensive injuries", weight: "medium" },
        { reason: "Sharp early Over money", weight: "high" },
      ],
      down: [
        { reason: "Bad weather (wind/rain)", weight: "high" },
        { reason: "Key offensive injury", weight: "high" },
        { reason: "Run-heavy matchup", weight: "medium" },
        { reason: "Defensive strength", weight: "medium" },
        { reason: "Sharp Under money", weight: "high" },
      ],
      chase: [
        { label: "Move of 1–2 pts", note: "Normal — small edge may remain", ok: true },
        { label: "Move of 3–4+ pts", note: "Almost always weather/injury → don't chase", ok: false },
        { label: "Weather or QB news", note: "Value gone", ok: false },
        { label: "Sharp correction", note: "Small moves still playable", ok: true },
      ],
    },
  }[sport];

  return (
    <div className="space-y-4">
      {/* Up / Down */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-green-400 uppercase tracking-wide flex items-center gap-1">
            <TrendingUp size={11} /> Line Moves UP
          </p>
          {data.up.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${item.weight === "high" ? "bg-green-400" : "bg-green-400/40"}`} />
              <p className="text-[10px] text-muted-foreground leading-tight">{item.reason}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide flex items-center gap-1">
            <TrendingDown size={11} /> Line Moves DOWN
          </p>
          {data.down.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${item.weight === "high" ? "bg-red-400" : "bg-red-400/40"}`} />
              <p className="text-[10px] text-muted-foreground leading-tight">{item.reason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* If line already moved */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">If the line already moved…</p>
        <div className="space-y-1.5">
          {data.chase.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded-lg border text-xs"
              style={{
                background: item.ok ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
                borderColor: item.ok ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
              }}
            >
              <span className={`text-[10px] font-bold shrink-0 ${item.ok ? "text-green-400" : "text-red-400"}`}>
                {item.ok ? "✓" : "✗"}
              </span>
              <div>
                <p className="font-semibold text-foreground text-[11px]">{item.label}</p>
                <p className="text-muted-foreground text-[10px] mt-0.5">{item.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main drawer
// ─────────────────────────────────────────────────────────────────────────────

function CheatSheetDrawer({
  open,
  onClose,
  initialSection,
}: {
  open: boolean;
  onClose: () => void;
  initialSection?: CheatSheetSection;
}) {
  const [activeSection, setActiveSection] = useState<CheatSheetSection>(
    initialSection ?? "howtoread"
  );

  if (!open) return null;

  const renderSection = () => {
    switch (activeSection) {
      case "howtoread":  return <HowToReadSection />;
      case "spread":     return <SpreadSection />;
      case "total":      return <TotalSection />;
      case "moneyline":  return <MoneylineSection />;
      case "universal":  return <UniversalSection />;
      case "nba":        return <SportTotalSection sport="nba" />;
      case "mlb":        return <SportTotalSection sport="mlb" />;
      case "nhl":        return <SportTotalSection sport="nhl" />;
      case "nfl":        return <SportTotalSection sport="nfl" />;
    }
  };

  const current = SECTIONS.find(s => s.id === activeSection);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-sm flex flex-col"
        style={{ maxHeight: "88vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <BookOpen size={14} className="text-primary" />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">PropEdge Cheat Sheet</p>
              <p className="text-[10px] text-muted-foreground">How to read smart money signals</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X size={16} />
          </button>
        </div>

        {/* Section tabs — horizontal scroll */}
        <div className="flex gap-1.5 px-3 pt-3 pb-2 overflow-x-auto shrink-0">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all border"
              style={
                activeSection === s.id
                  ? { background: `${s.color}20`, borderColor: `${s.color}50`, color: s.color }
                  : { background: "transparent", borderColor: "transparent", color: "rgba(255,255,255,0.45)" }
              }
            >
              <span>{s.emoji}</span>
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Section title */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">{current?.emoji}</span>
            <p className="font-bold text-foreground text-sm">{current?.label}</p>
          </div>

          {renderSection()}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-4 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><Users size={9} /> = % of bets (public tickets)</span>
            <span className="flex items-center gap-1"><DollarSign size={9} /> = % of money (sharp signal)</span>
            <span className="flex items-center gap-1 text-green-400"><Zap size={9} /> Green $ = sharp</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — CheatSheetButton
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drop this wherever you want a "How to Read" button.
 * Opens the full cheat sheet drawer.
 */
export function CheatSheetButton({
  initialSection,
  variant = "outline",
  label = "How to Read",
}: {
  initialSection?: CheatSheetSection;
  variant?: "outline" | "ghost" | "pill";
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  const baseClass = {
    outline: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all bg-card",
    ghost:   "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground transition-all",
    pill:    "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-all",
  }[variant];

  return (
    <>
      <button onClick={() => setOpen(true)} className={baseClass}>
        <BookOpen size={12} /> {label}
      </button>
      <CheatSheetDrawer
        open={open}
        onClose={() => setOpen(false)}
        initialSection={initialSection}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CheatSheetInline — collapsible tip card for embedding inline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A compact, collapsible tip that can be placed inline anywhere.
 * Example: <CheatSheetInline section="spread" />
 */
export function CheatSheetInline({
  section,
  defaultOpen = false,
}: {
  section: CheatSheetSection;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const meta = SECTIONS.find(s => s.id === section);

  const tip: Record<CheatSheetSection, string> = {
    howtoread:  "More $ than tickets = smart money. More tickets than $ = public side. Line moved with $? Strong signal.",
    spread:     "Spread is the sharpest signal. If % money >> % bets → sharp side. If % bets >> % money → public/fade.",
    total:      "Totals are weaker. Look for a big gap between % bets and % money. If neither jumps, no real signal.",
    moneyline:  "Moneyline sharp signals are the weakest of the three. Use as confirmation, not a primary signal.",
    universal:  "If the line moved on NEWS → value gone. If it moved on a sharp correction → can still follow.",
    nba:        "Star in/out is the #1 NBA total driver. Pace matchup is #2. Big moves (3+ pts) usually mean news.",
    mlb:        "Wind direction is the #1 MLB total driver. Pitcher/umpire news follows. Don't chase 1.5+ run moves.",
    nhl:        "Goalie news drives NHL totals. Backup in = Over. Elite goalie confirmed = Under. Don't chase 1.5+ goal moves.",
    nfl:        "Weather and QB status are the top NFL total drivers. Don't chase moves of 3–4+ points.",
  };

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20 text-left hover:border-primary/30 transition-all"
      >
        <span className="text-base shrink-0">{meta?.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{meta?.label} Tip</p>
          {!open && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{tip[section]}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Info size={11} className="text-muted-foreground" />
          {open ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="bg-muted/20 border border-border rounded-lg px-3 py-3 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">{tip[section]}</p>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
          >
            <BookOpen size={10} /> Full {meta?.label} guide →
          </button>
        </div>
      )}

      <CheatSheetDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialSection={section}
      />
    </>
  );
}
