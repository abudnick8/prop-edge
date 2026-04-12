/**
 * MLInsights.tsx — Clubhouse IQ Self-Learning ML Dashboard
 * Shows what the nightly ML engine has learned from past graded picks.
 * Cream background (#F6F1E7), dark navy text (#131A24).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Brain, TrendingUp, TrendingDown, Target, CheckCircle2, XCircle,
  RefreshCw, BarChart2, Zap, AlertTriangle, Info, Activity,
  Award, ChevronDown, ChevronUp, Clock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Cell,
} from "recharts";

const BG      = "#F6F1E7";
const NAV     = "#13233A";
const FG      = "#131A24";
const MUTED   = "#3D4B58";
const GREEN   = "#22c55e";
const RED     = "#ef4444";
const AMBER   = "#f59e0b";
const TEAL    = "#0ea5e9";
const BORDER  = "rgba(19,35,58,0.12)";

// ─── Types ───────────────────────────────────────────────────────────────────
interface MLInsights {
  overall: { total: number; won: number; lost: number; push: number; win_rate: number | null };
  by_sport: Record<string, { won: number; lost: number; push: number; win_rate: number | null; sample: number }>;
  by_bet_type: Record<string, { won: number; lost: number; push: number; win_rate: number | null; sample: number }>;
  by_conf_tier: Record<string, { won: number; lost: number; push: number; win_rate: number | null; sample: number; expected_rate: number }>;
  by_week: Array<{ week: string; won: number; lost: number; win_rate: number | null; sample: number }>;
  strengths: string[];
  weaknesses: string[];
  patterns: Array<{ pattern: string; win_rate: number; sample: number; insight: string }>;
  last_run: string | null;
  sample_size: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

function winRateColor(wr: number | null): string {
  if (wr === null) return MUTED;
  if (wr >= 0.6) return GREEN;
  if (wr >= 0.5) return AMBER;
  return RED;
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  );
}

// ─── Stat Tile ────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{label}</span>
      <span className="text-2xl font-black" style={{ color: color ?? FG }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: MUTED }}>{sub}</span>}
    </div>
  );
}

// ─── Sport Row ────────────────────────────────────────────────────────────────
function SportRow({ sport, data }: { sport: string; data: any }) {
  const wr = data.win_rate;
  return (
    <div className="flex items-center gap-3 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <span className="text-sm font-bold w-16" style={{ color: FG }}>{sport}</span>
      <div className="flex-1">
        <div className="h-2 rounded-full" style={{ background: "rgba(19,35,58,0.08)" }}>
          <div className="h-2 rounded-full transition-all" style={{
            width: `${wr !== null ? Math.round(wr * 100) : 0}%`,
            background: winRateColor(wr),
          }} />
        </div>
      </div>
      <span className="text-sm font-bold w-12 text-right" style={{ color: winRateColor(wr) }}>{pct(wr)}</span>
      <span className="text-xs w-16 text-right" style={{ color: MUTED }}>{data.won}W {data.lost}L ({data.sample} picks)</span>
    </div>
  );
}

// ─── Conf Tier calibration ────────────────────────────────────────────────────
function ConfTierRow({ tier, data }: { tier: string; data: any }) {
  const wr    = data.win_rate;
  const exp   = data.expected_rate;
  const delta = wr !== null && exp ? wr - exp : null;
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  return (
    <div className="flex items-center gap-2 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <span className="text-xs font-bold w-16" style={{ color: FG }}>{label}</span>
      <span className="text-xs w-10 text-right" style={{ color: MUTED }}>Exp {pct(exp)}</span>
      <div className="flex-1">
        <div className="h-2 rounded-full" style={{ background: "rgba(19,35,58,0.08)" }}>
          <div className="h-2 rounded-full" style={{
            width: `${wr !== null ? Math.round(wr * 100) : 0}%`,
            background: winRateColor(wr),
          }} />
        </div>
      </div>
      <span className="text-xs font-bold w-10 text-right" style={{ color: winRateColor(wr) }}>{pct(wr)}</span>
      {delta !== null && (
        <span className="text-xs w-14 text-right" style={{ color: delta >= 0 ? GREEN : RED }}>
          {delta >= 0 ? "+" : ""}{Math.round(delta * 100)}pp
        </span>
      )}
      <span className="text-xs w-16 text-right" style={{ color: MUTED }}>{data.sample} picks</span>
    </div>
  );
}

// ─── Pattern Card ──────────────────────────────────────────────────────────────
function PatternCard({ p }: { p: any }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-bold" style={{ color: FG }}>{p.pattern}</span>
        <span className="text-sm font-black flex-shrink-0" style={{ color: winRateColor(p.win_rate / 100) }}>
          {Math.round(p.win_rate)}%
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: MUTED }}>{p.insight}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full" style={{ background: "rgba(19,35,58,0.08)" }}>
          <div className="h-1.5 rounded-full" style={{ width: `${p.win_rate}%`, background: winRateColor(p.win_rate / 100) }} />
        </div>
        <span className="text-xs" style={{ color: MUTED }}>{p.sample} picks</span>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onGradeRun, gradeIsPending, gradeIsSuccess, gradeIsError, gradeData, runIsSuccess }: {
  onGradeRun: () => void;
  gradeIsPending: boolean;
  gradeIsSuccess: boolean;
  gradeIsError: boolean;
  gradeData: any;
  runIsSuccess: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `${NAV}11` }}>
        <Brain size={28} style={{ color: NAV }} />
      </div>
      <div>
        <p className="text-base font-bold mb-1" style={{ color: FG }}>No learning data yet</p>
        <p className="text-sm max-w-xs" style={{ color: MUTED }}>
          The ML engine learns from graded picks. Once bets are marked won or lost — either automatically or manually — patterns will appear here.
        </p>
      </div>

      {/* Prominent Grade+Run button on empty state */}
      <button
        onClick={onGradeRun}
        disabled={gradeIsPending}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold"
        style={{ background: NAV, color: "#F6F1E7", opacity: gradeIsPending ? 0.7 : 1 }}
      >
        <Zap size={15} className={gradeIsPending ? "animate-spin" : ""} />
        {gradeIsPending ? "Grading picks…" : "Grade + Run ML Now"}
      </button>

      {/* Status banners */}
      {gradeIsSuccess && (
        <div className="rounded-xl p-3 flex items-center gap-2 w-full max-w-sm" style={{ background: `${GREEN}11`, border: `1px solid ${GREEN}33` }}>
          <CheckCircle2 size={14} style={{ color: GREEN }} />
          <span className="text-sm font-semibold" style={{ color: GREEN }}>
            Graded {gradeData?.grader?.graded ?? 0} new picks · ML weights updated · Synced to GitHub
          </span>
        </div>
      )}
      {gradeIsError && (
        <div className="rounded-xl p-3 flex items-center gap-2 w-full max-w-sm" style={{ background: `${RED}11`, border: `1px solid ${RED}33` }}>
          <AlertTriangle size={14} style={{ color: RED }} />
          <span className="text-sm" style={{ color: RED }}>Grade run failed — check server logs.</span>
        </div>
      )}
      {runIsSuccess && (
        <div className="rounded-xl p-3 flex items-center gap-2 w-full max-w-sm" style={{ background: `${GREEN}11`, border: `1px solid ${GREEN}33` }}>
          <CheckCircle2 size={14} style={{ color: GREEN }} />
          <span className="text-sm font-semibold" style={{ color: GREEN }}>ML engine ran successfully. Insights updated.</span>
        </div>
      )}

      <div className="rounded-xl p-4 max-w-sm text-left" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
        <p className="text-xs font-bold mb-2" style={{ color: FG }}>How it works</p>
        <ol className="text-xs space-y-1.5" style={{ color: MUTED }}>
          <li>1. Clubhouse IQ auto-grades player prop picks nightly using ESPN game logs</li>
          <li>2. You can also manually mark bets as Won / Lost in your bet history</li>
          <li>3. Each night the ML engine reviews all graded outcomes and extracts patterns</li>
          <li>4. Confidence scores for future picks are quietly adjusted based on what works</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MLInsights() {
  const [runOpen, setRunOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<MLInsights>({
    queryKey: ["/api/ml-insights"],
    refetchInterval: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/ml/run", { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ml-insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/snapshots"] });
    },
  });

  const gradeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/ml/grade", { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ml-insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ml/snapshots"] });
    },
  });

  const { data: snapStats } = useQuery<{ snapshots: number; graded: number; open: number; won: number; lost: number; win_rate: number | null }>({
    queryKey: ["/api/ml/snapshots"],
    refetchInterval: 30_000,
  });

  const hasData = data && (data.sample_size ?? 0) >= 1;

  // Weekly chart data
  const weeklyData = (data?.by_week ?? []).slice(-12).map((w) => ({
    week: w.week,
    "Win %": w.win_rate !== null ? Math.round(w.win_rate * 100) : 0,
    Won: w.won,
    Lost: w.lost,
  }));

  // Sport bar chart
  const sportData = Object.entries(data?.by_sport ?? {}).map(([sport, s]) => ({
    name: sport,
    "Win %": s.win_rate !== null ? Math.round(s.win_rate * 100) : 0,
    sample: s.sample,
  }));

  // Bet type chart
  const typeData = Object.entries(data?.by_bet_type ?? {}).map(([type, t]) => ({
    name: type.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    "Win %": t.win_rate !== null ? Math.round(t.win_rate * 100) : 0,
    sample: t.sample,
  }));

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      {/* ── Header ── */}
      <div className="sticky top-0 z-10" style={{ background: NAV }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain size={18} style={{ color: "#F6F1E7" }} />
            <span className="text-sm font-black" style={{ color: "#F6F1E7" }}>ML Intel</span>
            {hasData && (
              <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(246,241,231,0.15)", color: "#F6F1E7" }}>
                {data!.sample_size} picks analyzed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data?.last_run && (
              <span className="text-xs" style={{ color: "rgba(246,241,231,0.5)" }}>
                {new Date(data.last_run).toLocaleDateString()}
              </span>
            )}
            <button
              onClick={() => gradeMutation.mutate()}
              disabled={gradeMutation.isPending || runMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: "rgba(34,197,94,0.2)", color: "#22c55e" }}
              title="Grade new picks then recompute weights"
            >
              <Zap size={12} className={gradeMutation.isPending ? "animate-spin" : ""} />
              {gradeMutation.isPending ? "Grading..." : "Grade + Run"}
            </button>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || gradeMutation.isPending}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: "rgba(246,241,231,0.15)", color: "#F6F1E7" }}
              title="Recompute weights from existing graded outcomes"
            >
              <RefreshCw size={12} className={runMutation.isPending ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Snapshot stats bar */}
      {snapStats && (
        <div className="sticky top-[52px] z-10 border-b" style={{ background: "#fff", borderColor: "rgba(19,35,58,0.08)" }}>
          <div className="max-w-2xl mx-auto px-4 py-2 flex items-center gap-4 overflow-x-auto">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Activity size={12} style={{ color: MUTED }} />
              <span className="text-xs font-semibold" style={{ color: FG }}>{snapStats.snapshots} picks logged</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Target size={12} style={{ color: MUTED }} />
              <span className="text-xs font-semibold" style={{ color: FG }}>{snapStats.graded} graded</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <CheckCircle2 size={12} style={{ color: GREEN }} />
              <span className="text-xs font-bold" style={{ color: GREEN }}>{snapStats.won}W</span>
              <XCircle size={12} style={{ color: RED }} />
              <span className="text-xs font-bold" style={{ color: RED }}>{snapStats.lost}L</span>
            </div>
            {snapStats.win_rate !== null && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-xs font-black" style={{ color: snapStats.win_rate >= 55 ? GREEN : snapStats.win_rate >= 50 ? AMBER : RED }}>
                  {snapStats.win_rate}% win rate
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Clock size={12} style={{ color: MUTED }} />
              <span className="text-xs" style={{ color: MUTED }}>{snapStats.open} awaiting grade</span>
            </div>
            <div className="ml-auto flex-shrink-0">
              <span className="text-xs" style={{ color: MUTED }}>Auto-grades nightly @ 2am</span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={20} className="animate-spin" style={{ color: MUTED }} />
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: `${RED}11`, border: `1px solid ${RED}33` }}>
            <AlertTriangle size={16} style={{ color: RED }} />
            <span className="text-sm" style={{ color: FG }}>Couldn't load ML insights. Is the server running?</span>
          </div>
        )}

        {/* No data yet */}
        {!isLoading && !isError && !hasData && (
          <EmptyState
            onGradeRun={() => gradeMutation.mutate()}
            gradeIsPending={gradeMutation.isPending}
            gradeIsSuccess={gradeMutation.isSuccess}
            gradeIsError={gradeMutation.isError}
            gradeData={gradeMutation.data}
            runIsSuccess={runMutation.isSuccess}
          />
        )}

        {/* ── Data sections ── */}
        {/* Run/Grade status banners — always visible, not gated on hasData */}
        {hasData && gradeMutation.isSuccess && (
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: `${GREEN}11`, border: `1px solid ${GREEN}33` }}>
            <CheckCircle2 size={14} style={{ color: GREEN }} />
            <span className="text-sm font-semibold" style={{ color: GREEN }}>
              Graded {(gradeMutation.data as any)?.grader?.graded ?? 0} new picks · ML weights updated · Synced to GitHub
            </span>
          </div>
        )}
        {gradeMutation.isError && (
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: `${RED}11`, border: `1px solid ${RED}33` }}>
            <AlertTriangle size={14} style={{ color: RED }} />
            <span className="text-sm" style={{ color: RED }}>Grade run failed — check server logs.</span>
          </div>
        )}
        {runMutation.isSuccess && (
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: `${GREEN}11`, border: `1px solid ${GREEN}33` }}>
            <CheckCircle2 size={14} style={{ color: GREEN }} />
            <span className="text-sm font-semibold" style={{ color: GREEN }}>ML engine ran successfully. Insights updated.</span>
          </div>
        )}

        {hasData && (
          <>

            {/* ── Overall stats ── */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Overall Performance</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Win Rate" value={pct(data.overall.win_rate)} color={winRateColor(data.overall.win_rate)} sub={`${data.overall.total} graded picks`} />
                <StatTile label="Won" value={String(data.overall.won)} color={GREEN} sub="picks" />
                <StatTile label="Lost" value={String(data.overall.lost)} color={RED} sub="picks" />
                <StatTile label="Est. ROI" value={(data.overall as any).roi_est != null ? `${(data.overall as any).roi_est}%` : "—"} color={(data.overall as any).roi_est > 0 ? GREEN : RED} sub="at -110 avg" />
              </div>
            </section>

            {/* ── Weekly trend ── */}
            {weeklyData.length >= 2 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Weekly Win Rate Trend</h2>
                <div className="rounded-xl p-4" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={weeklyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                      <XAxis dataKey="week" tick={{ fontSize: 10, fill: MUTED }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: MUTED }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any) => [`${v}%`, "Win Rate"]}
                      />
                      <Line type="monotone" dataKey="Win %" stroke={TEAL} strokeWidth={2} dot={{ fill: TEAL, r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* ── By sport ── */}
            {sportData.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Win Rate by Sport</h2>
                <div className="rounded-xl p-4 mb-3" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={sportData} barSize={28}>
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: MUTED }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: MUTED }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, _: any, props: any) => [`${v}% (${props.payload.sample} picks)`, "Win Rate"]}
                      />
                      <Bar dataKey="Win %" radius={[4, 4, 0, 0]}>
                        {sportData.map((entry, i) => (
                          <Cell key={i} fill={winRateColor(entry["Win %"] / 100)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
                  {Object.entries(data.by_sport).map(([sport, s]) => (
                    <SportRow key={sport} sport={sport} data={s} />
                  ))}
                </div>
              </section>
            )}

            {/* ── By bet type ── */}
            {typeData.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Win Rate by Bet Type</h2>
                <div className="rounded-xl p-4" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={typeData} barSize={24} layout="vertical">
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: MUTED }} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: MUTED }} width={90} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, _: any, props: any) => [`${v}% (${props.payload.sample} picks)`, "Win Rate"]}
                      />
                      <Bar dataKey="Win %" radius={[0, 4, 4, 0]}>
                        {typeData.map((entry, i) => (
                          <Cell key={i} fill={winRateColor(entry["Win %"] / 100)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* ── Confidence tier calibration ── */}
            {Object.keys(data.by_conf_tier).length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: MUTED }}>Confidence Tier Calibration</h2>
                <p className="text-xs mb-3" style={{ color: MUTED }}>Is the model accurate at each confidence level? "pp" = percentage points above/below expected.</p>
                <div className="rounded-xl p-4" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
                  {["elite", "high", "medium", "low"].filter((t) => data.by_conf_tier[t]).map((tier) => (
                    <ConfTierRow key={tier} tier={tier} data={data.by_conf_tier[tier]} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Strengths & Weaknesses ── */}
            {(data.strengths.length > 0 || data.weaknesses.length > 0) && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>What the Model Has Learned</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.strengths.length > 0 && (
                    <div className="rounded-xl p-4" style={{ background: `${GREEN}0a`, border: `1px solid ${GREEN}33` }}>
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp size={14} style={{ color: GREEN }} />
                        <span className="text-xs font-bold" style={{ color: GREEN }}>Strengths</span>
                      </div>
                      <ul className="space-y-2">
                        {data.strengths.map((s, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                            <span className="text-xs leading-relaxed" style={{ color: FG }}>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data.weaknesses.length > 0 && (
                    <div className="rounded-xl p-4" style={{ background: `${RED}0a`, border: `1px solid ${RED}33` }}>
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingDown size={14} style={{ color: RED }} />
                        <span className="text-xs font-bold" style={{ color: RED }}>Areas to Improve</span>
                      </div>
                      <ul className="space-y-2">
                        {data.weaknesses.map((w, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <XCircle size={12} className="flex-shrink-0 mt-0.5" style={{ color: RED }} />
                            <span className="text-xs leading-relaxed" style={{ color: FG }}>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Pattern table ── */}
            {data.patterns.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>Top Patterns</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.patterns.map((p, i) => <PatternCard key={i} p={p} />)}
                </div>
              </section>
            )}

            {/* ── How it works explainer ── */}
            <section>
              <button
                onClick={() => setRunOpen((o) => !o)}
                className="flex items-center gap-2 w-full py-2"
              >
                <Info size={14} style={{ color: MUTED }} />
                <span className="text-xs font-semibold" style={{ color: MUTED }}>How ML Intel works</span>
                {runOpen ? <ChevronUp size={13} style={{ color: MUTED }} /> : <ChevronDown size={13} style={{ color: MUTED }} />}
              </button>
              {runOpen && (
                <div className="rounded-xl p-4 mt-1" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
                  <ol className="text-xs space-y-2 leading-relaxed" style={{ color: MUTED }}>
                    <li><strong style={{ color: FG }}>1. Automatic grading.</strong> Each night, Clubhouse IQ compares player prop picks to ESPN game logs. Picks where we have a final stat line are graded Won or Lost automatically.</li>
                    <li><strong style={{ color: FG }}>2. Manual grading.</strong> For team bets (spreads, totals, moneylines), you can tap any bet card and mark it Won / Lost / Push yourself.</li>
                    <li><strong style={{ color: FG }}>3. Pattern extraction.</strong> The ML engine reads all graded outcomes and computes which sport/bet type/confidence tier combinations perform above or below expected win rates.</li>
                    <li><strong style={{ color: FG }}>4. Weight adjustment.</strong> Confidence scores for new picks are quietly nudged up or down (capped at ±15 points) based on these learned patterns. The app gets smarter over time.</li>
                    <li><strong style={{ color: FG }}>5. Transparency.</strong> Everything the model has learned is shown here — no black box.</li>
                  </ol>
                </div>
              )}
            </section>

          </>
        )}
      </div>
    </div>
  );
}
