/**
 * Pricing / Upgrade page — shown when a user tries to access a locked feature
 * or navigates to /pricing. Lets existing users upgrade their plan via Stripe.
 */
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Check, Lock, Zap, Trophy, Brain, BarChart2, Target, LineChart, Ticket, TrendingUp, Shuffle, Activity, LayoutDashboard, Crown, ArrowRight, Loader2, Tag, X } from "lucide-react";

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLANS = [
  {
    id: "free",
    label: "Free",
    price: "$0",
    period: "forever",
    color: "#3D4B58",
    glow: "rgba(61,75,88,0.3)",
    badge: null,
    desc: "Get started with no commitment",
    features: [
      { icon: Activity,       label: "Live Scores",       note: "All sports, real-time" },
      { icon: Shuffle,        label: "Fantasy",            note: "Daily lineup tools" },
      { icon: null,           label: "Clubhouse IQ app",  note: "iOS & Android friendly" },
    ],
    locked: [
      "Dashboard & picks",
      "Player props",
      "Beat the Streak",
      "ML Intel",
      "Top Plays",
    ],
  },
  {
    id: "basic",
    label: "Basic",
    price: "$5",
    period: "/ month",
    color: "#2563eb",
    glow: "rgba(37,99,235,0.25)",
    badge: "MOST POPULAR",
    desc: "Core picks and props for daily bettors",
    features: [
      { icon: Activity,       label: "Live Scores",       note: "All sports, real-time" },
      { icon: Shuffle,        label: "Fantasy",            note: "Daily lineup tools" },
      { icon: LayoutDashboard,label: "Dashboard",          note: "Today's top picks" },
      { icon: LineChart,      label: "Props Hub",          note: "Player prop analysis" },
      { icon: Ticket,         label: "Lotto",              note: "High-value long shots" },
    ],
    locked: [
      "Beat the Streak",
      "ML Intel",
      "Top Plays & All Picks",
      "Line Movement",
      "Prediction Markets",
      "Bracket Simulator",
    ],
  },
  {
    id: "pro",
    label: "Pro",
    price: "$15",
    period: "/ month",
    color: "#A23B32",
    glow: "rgba(162,59,50,0.25)",
    badge: "FULL ACCESS",
    desc: "Every edge, every tool, every sport",
    features: [
      { icon: Activity,       label: "Live Scores",       note: "All sports" },
      { icon: Shuffle,        label: "Fantasy",            note: "Daily lineup tools" },
      { icon: LayoutDashboard,label: "Dashboard",          note: "Today's top picks" },
      { icon: LineChart,      label: "Props Hub",          note: "Player prop analysis" },
      { icon: Ticket,         label: "Lotto",              note: "High-value long shots" },
      { icon: Trophy,         label: "Beat the Streak",   note: "Daily MLB hit picks + ML" },
      { icon: Zap,            label: "Top Plays",         note: "5 team bets + 3 props daily" },
      { icon: Target,         label: "All Picks",         note: "Full pick feed" },
      { icon: TrendingUp,     label: "Line Movement",     note: "CLV tracking" },
      { icon: BarChart2,      label: "Prediction Markets",note: "Polymarket + Kalshi" },
      { icon: Trophy,         label: "Bracket Simulator", note: "Seeding projections" },
      { icon: Brain,          label: "ML Intel",          note: "Adaptive model insights" },
    ],
    locked: [],
  },
] as const;

type PlanId = "free" | "basic" | "pro";

// ─── Upgrade handler ──────────────────────────────────────────────────────────

async function upgradeTier(tier: "basic" | "pro"): Promise<boolean> {
  const token = localStorage.getItem("ciq_token");
  const res = await fetch("/api/auth/upgrade-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ tier }),
  });
  return res.ok;
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  currentTier,
  onSelect,
  loading,
}: {
  plan: typeof PLANS[number];
  currentTier: string | null;
  onSelect: (id: PlanId) => void;
  loading: PlanId | null;
}) {
  const isCurrent = currentTier === plan.id;
  const isDowngrade = (currentTier === "pro" && (plan.id === "basic" || plan.id === "free"))
    || (currentTier === "basic" && plan.id === "free");
  const isUpgrade = !isCurrent && !isDowngrade;
  const isLoading = loading === plan.id;

  return (
    <div
      className="flex flex-col rounded-2xl p-4 relative"
      style={{
        background: isCurrent
          ? `linear-gradient(160deg, ${plan.color}12, ${plan.color}06)`
          : "rgba(19,35,58,0.04)",
        border: `1.5px solid ${isCurrent ? plan.color + "60" : "rgba(19,35,58,0.12)"}`,
        boxShadow: isCurrent ? `0 0 24px ${plan.glow}` : "none",
      }}
    >
      {/* Badge */}
      {plan.badge && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-black px-3 py-1 rounded-full whitespace-nowrap"
          style={{ background: plan.color, color: "#fff", letterSpacing: "0.08em" }}
        >
          {plan.badge}
        </div>
      )}
      {isCurrent && (
        <div
          className="absolute -top-3 right-4 text-[9px] font-black px-3 py-1 rounded-full"
          style={{ background: plan.color, color: "#fff" }}
        >
          YOUR PLAN
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-end gap-1.5 mb-1">
          <span className="text-[28px] font-black font-mono leading-none" style={{ color: plan.color }}>
            {plan.price}
          </span>
          <span className="text-xs font-semibold pb-0.5" style={{ color: "rgba(19,35,58,0.5)" }}>
            {plan.period}
          </span>
        </div>
        <p className="text-base font-black" style={{ color: "#131A24" }}>{plan.label}</p>
        <p className="text-[11px] mt-0.5" style={{ color: "rgba(19,35,58,0.55)" }}>{plan.desc}</p>
      </div>

      {/* Divider */}
      <div className="mb-3" style={{ height: 1, background: "rgba(19,35,58,0.08)" }} />

      {/* Included features */}
      <div className="space-y-1.5 flex-1 mb-3">
        {plan.features.map((f) => (
          <div key={f.label} className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `${plan.color}18` }}>
              <Check size={9} style={{ color: plan.color }} strokeWidth={3} />
            </span>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold" style={{ color: "#131A24" }}>{f.label}</span>
              {f.note && (
                <span className="text-[10px] ml-1" style={{ color: "rgba(19,35,58,0.45)" }}>— {f.note}</span>
              )}
            </div>
          </div>
        ))}

        {/* Locked items */}
        {plan.locked.length > 0 && (
          <>
            <div className="mt-2 mb-1" style={{ height: 1, background: "rgba(19,35,58,0.06)" }} />
            {plan.locked.map((f) => (
              <div key={f} className="flex items-center gap-2 opacity-35">
                <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(19,35,58,0.06)" }}>
                  <Lock size={8} style={{ color: "rgba(19,35,58,0.4)" }} />
                </span>
                <span className="text-[11px]" style={{ color: "rgba(19,35,58,0.5)" }}>{f}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* CTA */}
      {isCurrent ? (
        <div className="w-full py-2.5 rounded-xl text-center text-[12px] font-black"
          style={{ background: `${plan.color}15`, color: plan.color }}>
          ✓ Current Plan
        </div>
      ) : isDowngrade ? (
        <div className="w-full py-2.5 rounded-xl text-center text-[11px] font-semibold"
          style={{ background: "rgba(19,35,58,0.04)", color: "rgba(19,35,58,0.35)", border: "1px solid rgba(19,35,58,0.1)" }}>
          Manage in Settings
        </div>
      ) : (
        <button
          onClick={() => onSelect(plan.id as PlanId)}
          disabled={!!loading}
          className="w-full py-2.5 rounded-xl text-[12px] font-black flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          style={{ background: plan.color, color: "#fff" }}
        >
          {isLoading
            ? <Loader2 size={14} className="animate-spin" />
            : plan.id === "free"
            ? "Get Started Free"
            : <>Get {plan.label} <ArrowRight size={13} /></>
          }
        </button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Pricing() {
  const { user } = useAuth();
  const [loading, setLoading]         = useState<PlanId | null>(null);
  const [error, setError]             = useState("");
  const [promoInput, setPromoInput]   = useState("");
  const [promoCode, setPromoCode]           = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount]   = useState<number | null>(null);
  const [promoDuration, setPromoDuration]   = useState<number | null>(null);
  const [promoLoading, setPromoLoading]     = useState(false);
  const [promoError, setPromoError]         = useState("");

  const currentTier = user?.tier ?? null;

  async function applyPromo() {
    if (!promoInput.trim()) return;
    setPromoLoading(true); setPromoError("");
    try {
      const res = await fetch(`/api/admin/validate-promo?code=${encodeURIComponent(promoInput.trim())}`);
      const d = await res.json();
      if (!res.ok) { setPromoError(d.error ?? "Invalid code"); return; }
      setPromoCode(d.code);
      setPromoDiscount(d.discount_pct);
      setPromoDuration(d.duration_months ?? null);
    } catch { setPromoError("Could not validate code"); }
    finally { setPromoLoading(false); }
  }

  async function handleSelect(id: PlanId) {
    setError("");
    if (id === "free") return;
    setLoading(id);
    try {
      const ok = await upgradeTier(id);
      if (ok) {
        window.location.href = "/";
      } else {
        setError("Upgrade failed. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: "#F6F1E7" }}>
      {/* Header */}
      <div className="px-4 pt-8 pb-6 text-center max-w-lg mx-auto">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Crown size={20} style={{ color: "#A23B32" }} />
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#A23B32" }}>
            Clubhouse IQ Plans
          </span>
        </div>
        <h1 className="text-2xl font-black leading-tight mb-2" style={{ color: "#131A24" }}>
          Pick the right edge<br />for your game
        </h1>
        <p className="text-sm" style={{ color: "rgba(19,35,58,0.55)" }}>
          No hidden fees. Cancel anytime. Instant access after payment.
        </p>
      </div>

      {/* Promo code input */}
      <div className="px-4 max-w-lg mx-auto mb-4">
        <div className="bg-white rounded-2xl p-4 border" style={{ borderColor: "rgba(19,35,58,0.08)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Tag size={11} />Promo Code</p>
          {promoCode ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)" }}>
              <Check size={14} style={{ color: "#22c55e" }} />
              <span className="text-sm font-black tracking-widest" style={{ color: "#131A24" }}>{promoCode}</span>
              <span className="text-xs font-bold" style={{ color: "#22c55e" }}>
                {promoDiscount}% off
                {promoDuration === null ? " forever" : promoDuration === 1 ? " · 1 month" : ` · ${promoDuration} months`}
              </span>
              <button onClick={() => { setPromoCode(null); setPromoDiscount(null); setPromoDuration(null); setPromoInput(""); }} className="ml-auto p-0.5 rounded-md hover:bg-muted/40">
                <X size={12} style={{ color: "#3D4B58" }} />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && applyPromo()}
                placeholder="Enter promo code"
                className="flex-1 px-3 py-2.5 rounded-xl border text-sm font-black tracking-widest uppercase outline-none"
                style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
              />
              <button onClick={applyPromo} disabled={promoLoading || !promoInput.trim()}
                className="px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "#13233A", color: "#F6F1E7" }}>
                {promoLoading ? <Loader2 size={12} className="animate-spin" /> : "Apply"}
              </button>
            </div>
          )}
          {promoError && <p className="text-[11px] text-red-600 font-semibold mt-1.5">{promoError}</p>}
        </div>
      </div>

      {/* Plan cards */}
      <div className="px-4 max-w-lg mx-auto space-y-4">
        {PLANS.map(plan => (
          <PlanCard
            key={plan.id}
            plan={plan}
            currentTier={currentTier}
            onSelect={handleSelect}
            loading={loading}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 max-w-lg mx-auto px-4 py-3 rounded-xl text-sm font-semibold"
          style={{ background: "rgba(162,59,50,0.08)", color: "#A23B32", border: "1px solid rgba(162,59,50,0.2)" }}>
          {error}
        </div>
      )}

      {/* Fine print */}
      <div className="px-4 mt-6 text-center max-w-lg mx-auto">
        <p className="text-[10px]" style={{ color: "rgba(19,35,58,0.35)" }}>
          Subscriptions renew monthly. Manage or cancel anytime in Settings → Billing.
          Clubhouse IQ is for entertainment purposes only.
        </p>
      </div>
    </div>
  );
}
