/**
 * Clubhouse IQ Cheat Sheet
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

// ── Mini bar used in HowToRead scoring breakdown ─────────────────────────────
function ScoreBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function HowToReadSection() {
  return (
    <div className="space-y-4">

      {/* ── Quick 3-step read ───────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Quick 3-step read</p>
        <div className="space-y-1.5">
          <div className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg border border-border">
            <span className="text-sm font-black text-primary shrink-0 w-4 text-center">1</span>
            <p className="text-xs leading-relaxed">Find the biggest gap between <BetsPill /> and <MoneyPill />.</p>
          </div>
          <div className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg border border-border">
            <span className="text-sm font-black text-primary shrink-0 w-4 text-center">2</span>
            <div className="text-xs leading-relaxed space-y-1">
              <p>More <MoneyPill /> than <BetsPill /> → <span className="text-green-400 font-bold">Smart money ↑</span></p>
              <p>More <BetsPill /> than <MoneyPill /> → <span className="text-red-400 font-bold">Public/Fade ↓</span></p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg border border-border">
            <span className="text-sm font-black text-primary shrink-0 w-4 text-center">3</span>
            <div className="text-xs leading-relaxed space-y-0.5">
              <p>Line moved same direction as <MoneyPill /> → <span className="text-green-400 font-bold">Strong sharp signal</span></p>
              <p>Line moved against <MoneyPill /> → <span className="text-muted-foreground">Weak signal</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="border-t border-border/60" />

      {/* ── Confidence Score breakdown ──────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Confidence score — how it's calculated</p>
        <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
          Every pick is scored 0–100 using a 6-component model. You need high marks across <span className="text-foreground font-semibold">all six</span> to reach 85+.
        </p>

        <div className="space-y-1.5">
          {([
            { label: "Market consensus",    weight: 20,  color: "#6366f1", detail: "Implied probability strength — how decisively the market is pricing one side" },
            { label: "Source + sharp money", weight: 28,  color: "#10b981", detail: "Data tier quality (DraftKings/FanDuel = highest) + pro money vs public tickets split" },
            { label: "Stat predictability",  weight: 22,  color: "#f59e0b", detail: "How repeatable this stat type is: A-class (PTS/REB) → C-class (steals/goals)" },
            { label: "Sport sample size",    weight: 13,  color: "#3b82f6", detail: "MLB (162 games) scores highest; NFL (17 games) gets penalized for variance" },
            { label: "Juice & value",         weight: 12,  color: "#a78bfa", detail: "Cleaner lines (-110 to -105) score higher; extreme juice (-280+) is hard-gated" },
            { label: "Recent form vs line",   weight: 12,  color: "#f97316", detail: "L5 avg compared to posted line — player crushing the number adds up to +12 pts; conflict = up to −15 penalty" },
          ] as { label: string; weight: number; color: string; detail: string }[]).map(item => (
            <div key={item.label} className="p-2 rounded-lg border border-border bg-muted/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold" style={{ color: item.color }}>{item.label}</span>
                <ScoreBar pct={item.weight / 28 * 100} color={item.color} />
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">/{item.weight}pts</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">{item.detail}</p>
            </div>
          ))}
        </div>

        {/* Hard gates */}
        <div className="mt-2 p-2 rounded-lg border border-red-500/20 bg-red-500/5">
          <p className="text-[10px] font-bold text-red-400 mb-1">Hard gates — cap score at 66</p>
          <div className="space-y-0.5 text-[10px] text-muted-foreground">
            <p>• True coin-flip pricing (48–52% implied) — no identifiable edge</p>
            <p>• Extreme juice under −280 on a player prop</p>
            <p>• Low-tier data source with insufficient market depth</p>
          </div>
        </div>

        {/* Score thresholds */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[
            { label: "85+",  desc: "HIGH",     color: "#22c55e" },
            { label: "70–84",desc: "Moderate", color: "#eab308" },
            { label: "<70",  desc: "Low",       color: "#f97316" },
          ].map(t => (
            <div key={t.label} className="text-center p-2 rounded-lg border border-border bg-muted/20">
              <p className="text-[10px] font-mono font-bold" style={{ color: t.color }}>{t.label}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="border-t border-border/60" />

      {/* ── Edge Grade ──────────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">📊 Edge grade — part of confidence</p>
        <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
          The Edge Grade measures how much <span className="text-foreground font-semibold">mispricing</span> exists between the model's fair value and what the book is offering. It's derived from the confidence score — a higher confidence = higher fair value → larger edge gap.
        </p>

        {/* Edge formula visual */}
        <div className="flex items-center gap-2 p-2.5 mb-2.5 rounded-lg border border-border bg-muted/20 text-[10px] text-center">
          <div className="flex-1">
            <p className="font-bold text-blue-300">Model Fair Value</p>
            <p className="text-muted-foreground">(from confidence)</p>
          </div>
          <span className="text-muted-foreground font-bold">−</span>
          <div className="flex-1">
            <p className="font-bold text-red-300">Book's Implied Prob</p>
            <p className="text-muted-foreground">(from the odds)</p>
          </div>
          <span className="text-muted-foreground font-bold">=</span>
          <div className="flex-1">
            <p className="font-bold" style={{ color: "#4ade80" }}>Edge %</p>
            <p className="text-muted-foreground">(positive = value)</p>
          </div>
        </div>

        {/* Tier table */}
        <div className="space-y-1.5">
          {([
            {
              tier: "A+",
              color: "#4ade80",
              bg: "rgba(34,197,94,0.08)",
              border: "rgba(34,197,94,0.2)",
              rule: "Edge ≥15% + Conf ≥82",
              meaning: "Book is significantly behind. Model has high conviction this side wins.",
            },
            {
              tier: "A",
              color: "#facc15",
              bg: "rgba(250,204,21,0.08)",
              border: "rgba(250,204,21,0.2)",
              rule: "Edge ≥10% + Conf ≥75",
              meaning: "Meaningful gap between fair value and market price. Strong play.",
            },
            {
              tier: "B",
              color: "#93c5fd",
              bg: "rgba(96,165,250,0.08)",
              border: "rgba(96,165,250,0.2)",
              rule: "Edge ≥5% + Conf ≥65",
              meaning: "Moderate edge. Good play but needs at least one confirming signal.",
            },
            {
              tier: "C",
              color: "rgba(255,255,255,0.35)",
              bg: "rgba(255,255,255,0.03)",
              border: "rgba(255,255,255,0.1)",
              rule: "Edge <5% or Conf <65",
              meaning: "Edge not strong enough to surface a badge. Use other signals.",
            },
          ] as { tier: string; color: string; bg: string; border: string; rule: string; meaning: string }[]).map(t => (
            <div key={t.tier} className="flex items-start gap-2.5 p-2 rounded-lg border" style={{ background: t.bg, borderColor: t.border }}>
              <span
                className="text-[10px] font-black shrink-0 px-1.5 py-0.5 rounded border"
                style={{ color: t.color, borderColor: t.border, background: t.bg }}
              >
                {t.tier}
              </span>
              <div>
                <p className="text-[10px] font-bold" style={{ color: t.color }}>{t.rule}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t.meaning}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Sharp money note */}
        <div className="mt-2 p-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
          <p className="text-[10px] text-yellow-300/80 leading-snug">
            <span className="font-bold text-yellow-300">Sharp money bonus:</span> If pro/sharp money is confirmed on your side, the effective edge is bumped +2% for tier calculation — making it easier to reach A+ or A.
          </p>
        </div>

        {/* Stat-vs-line TikTok model */}
        <div className="mt-2 p-2.5 rounded-lg border border-orange-500/20 bg-orange-500/5">
          <p className="text-[10px] font-bold text-orange-300 mb-1">📈 Stat-vs-line edge (L5 model)</p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            For player props, the model also compares the player's <span className="text-foreground font-semibold">last 5 game average</span> to the posted line. If they've been consistently over or under the number, that contributes directly to the confidence score (C6 component, up to +12 pts) and feeds the Edge Grade. A hit rate of 4/5 or 5/5 games is strong confirmation.
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1 text-[9px] text-center">
            {[
              { label: "4.8 avg vs 3.5 line", note: "+37% edge", color: "#4ade80" },
              { label: "Hit rate 4/5",         note: "80% over rate", color: "#f59e0b" },
            ].map(ex => (
              <div key={ex.label} className="p-1.5 rounded border border-border bg-muted/30">
                <p className="font-mono font-bold" style={{ color: ex.color }}>{ex.note}</p>
                <p className="text-muted-foreground mt-0.5">{ex.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-border/60" />

      {/* ── Purchase Patterns ─────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">📊 Purchase pattern — what it means</p>
        <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
          Every whale alert and Top Trader position shows a <span className="text-foreground font-semibold">purchase pattern badge</span> that tells you <em>how</em> the money entered the market — not just how much. The pattern often reveals conviction level and whether the position is still being built.
        </p>

        <div className="space-y-2">

          {/* Single Buy */}
          <div className="flex items-start gap-2.5 p-2.5 rounded-lg border"
            style={{ borderColor: "rgba(96,165,250,0.30)", background: "rgba(96,165,250,0.06)" }}>
            <div className="shrink-0">
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap"
                style={{ color: "#60a5fa", background: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.30)" }}>
                1× Single Buy
              </span>
            </div>
            <div>
              <p className="text-[10px] font-bold text-blue-300 mb-0.5">One transaction, full commitment</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                The entire position was entered in a single trade. This is the hallmark of a high-conviction sharp who knew their entry price and acted decisively. They didn't try to average in — they placed the full bet at once. On Polymarket: typically when smartScore ≥ 40 with a single large USDC transaction.
              </p>
              <p className="text-[10px] text-blue-300/70 mt-1">→ Treat like a conviction signal. The trader had enough information to commit everything at one price.</p>
            </div>
          </div>

          {/* Multi-Entry */}
          <div className="flex items-start gap-2.5 p-2.5 rounded-lg border"
            style={{ borderColor: "rgba(192,132,252,0.30)", background: "rgba(192,132,252,0.06)" }}>
            <div className="shrink-0">
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap"
                style={{ color: "#c084fc", background: "rgba(192,132,252,0.12)", borderColor: "rgba(192,132,252,0.30)" }}>
                2× Multi-Entry
              </span>
            </div>
            <div>
              <p className="text-[10px] font-bold text-purple-300 mb-0.5">Two transactions, controlled accumulation</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                The position was split across exactly two separate buys. This typically means the trader entered, watched how the price reacted, and added a second tranche — either to average down on a dip or to add conviction after a positive signal. More deliberate than a single buy.
              </p>
              <p className="text-[10px] text-purple-300/70 mt-1">→ Still a strong directional signal. The split entry suggests the trader is managing their cost basis carefully.</p>
            </div>
          </div>

          {/* Building */}
          <div className="flex items-start gap-2.5 p-2.5 rounded-lg border"
            style={{ borderColor: "rgba(52,211,153,0.30)", background: "rgba(52,211,153,0.06)" }}>
            <div className="shrink-0">
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap"
                style={{ color: "#34d399", background: "rgba(52,211,153,0.12)", borderColor: "rgba(52,211,153,0.30)" }}>
                📈 Building
              </span>
            </div>
            <div>
              <p className="text-[10px] font-bold text-emerald-300 mb-0.5">3+ transactions, actively accumulating</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                The wallet has entered this market three or more times and keeps adding. This is the strongest conviction pattern — the trader is willing to buy at multiple price levels, even as the contract price rises. They are not done. On the Top Traders page, a Building pattern means the position is likely still growing.
              </p>
              <p className="text-[10px] text-emerald-300/70 mt-1">→ Highest signal strength. Expect continued upward pressure on the YES price. Follow the smart money.</p>
            </div>
          </div>

        </div>

        {/* Signal strength comparison */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-[9px] text-center">
          {[
            { badge: "Single Buy",  signal: "High",    note: "One decisive bet",       color: "#60a5fa" },
            { badge: "Multi-Entry", signal: "High",    note: "Deliberate accumulation", color: "#c084fc" },
            { badge: "Building",    signal: "Highest", note: "Still adding — follow it", color: "#34d399" },
          ].map(r => (
            <div key={r.badge} className="p-2 rounded-lg border border-border bg-muted/20">
              <p className="font-bold" style={{ color: r.color }}>{r.signal}</p>
              <p className="text-muted-foreground mt-0.5 leading-tight">{r.note}</p>
            </div>
          ))}
        </div>

        {/* Kalshi vs Polymarket thresholds */}
        <div className="mt-2 p-2 rounded-lg border border-border/40 bg-muted/10">
          <p className="text-[10px] font-bold text-muted-foreground mb-1">Platform classification thresholds</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px] text-muted-foreground">
            <p><span className="text-indigo-400 font-bold">Polymarket:</span> SmartScore ≥80 → Building, ≥40 → Multi-Entry, &lt;40 → Single Buy</p>
            <p><span className="text-cyan-400 font-bold">Kalshi:</span> Vol ≥$20K → Building, ≥$8K → Multi-Entry, &lt;$8K → Single Buy</p>
          </div>
          <p className="text-[9px] text-foreground/70 mt-1">
            On the Top Traders page, patterns are derived from the actual on-chain transaction count for that wallet's position, not volume estimates.
          </p>
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

export function CheatSheetDrawer({
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
              <p className="font-bold text-foreground text-sm">Clubhouse IQ Cheat Sheet</p>
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
  mobileIconOnly = false,
}: {
  initialSection?: CheatSheetSection;
  variant?: "outline" | "ghost" | "pill";
  label?: string;
  mobileIconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const baseClass = {
    outline: "flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all bg-card",
    ghost:   "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground transition-all",
    pill:    "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-all",
  }[variant];

  return (
    <>
      <button onClick={() => setOpen(true)} className={baseClass} title={label}>
        <BookOpen size={12} /> {mobileIconOnly ? <span className="hidden sm:inline">{label}</span> : label}
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

// ─────────────────────────────────────────────────────────────────────────────
// CheatSheetQuickTip — contextual 1-liner for bet cards
// ─────────────────────────────────────────────────────────────────────────────

type BetTypeKey = "player_prop" | "spread" | "total" | "moneyline" | "futures" | "season_long" | "season_prop" | string;

const QUICK_TIPS: Record<string, { tip: string; section: CheatSheetSection }> = {
  player_prop:  { tip: "Prop = player stats only. Check the line, opponent defense & recent averages before picking Over/Under.", section: "howtoread" },
  spread:       { tip: "Spread is the sharpest signal. High % money with low % tickets → sharp side.", section: "spread" },
  total:        { tip: "Totals signal: if % money jumps while % tickets stay flat → sharp Over. If % tickets jump → public/fade.", section: "total" },
  moneyline:    { tip: "Moneyline signals are the weakest. Use to confirm a spread signal — not as a primary pick.", section: "moneyline" },
  futures:      { tip: "Futures close early when sharp money piles in. Check if the line has already moved — value may be gone.", section: "universal" },
  season_long:  { tip: "Season-long props resolve at season end. Sharps load futures early before the market corrects.", section: "universal" },
  season_prop:  { tip: "Award props: track usage trends, injury reports, and positional value — market corrects quickly on news.", section: "universal" },
};

const SPORT_TOTAL_TIP: Record<string, string> = {
  NBA: "NBA totals: star in/out is the #1 driver. Moves of 3+ pts almost always mean news — don't chase.",
  NFL: "NFL totals: weather & QB status are the top drivers. Moves of 3–4+ pts = value gone.",
  MLB: "MLB totals: wind direction is #1. Pitcher/umpire news follows. Don't chase 1.5+ run moves.",
  NHL: "NHL totals: backup goalie = Over. Elite goalie confirmed = Under. Don't chase 1.5+ goal moves.",
};

/**
 * A compact contextual tip line shown at the bottom of each BetCard.
 * Uses bet type and sport to surface the most relevant 1-liner.
 */
export function CheatSheetQuickTip({
  betType,
  sport,
}: {
  betType: BetTypeKey;
  sport?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const key = betType?.toLowerCase() ?? "";
  const sportUp = (sport ?? "").toUpperCase();

  // For totals, override with sport-specific tip if we have one
  let tip: string;
  let section: CheatSheetSection;

  if (key === "total" && SPORT_TOTAL_TIP[sportUp]) {
    tip = SPORT_TOTAL_TIP[sportUp];
    section = sportUp === "NBA" ? "nba" : sportUp === "NFL" ? "nfl" : sportUp === "MLB" ? "mlb" : "nhl";
  } else if (QUICK_TIPS[key]) {
    tip = QUICK_TIPS[key].tip;
    section = QUICK_TIPS[key].section;
  } else {
    return null; // unknown bet type — don't render
  }

  return (
    <>
      <div className="flex items-start gap-2 mt-2 px-1">
        <span className="text-[9px] text-primary/70 shrink-0 mt-0.5">💡</span>
        <p className="text-[10px] text-muted-foreground leading-snug flex-1">{tip}</p>
        <button
          onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
          className="shrink-0 text-[9px] text-primary/60 hover:text-primary underline whitespace-nowrap"
        >
          more →
        </button>
      </div>
      <CheatSheetDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialSection={section}
      />
    </>
  );
}
