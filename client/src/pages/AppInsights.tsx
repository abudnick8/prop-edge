/**
 * AppInsights — Owner-only dashboard.
 * Sections: Dev Account · User Stats · Promo Codes · Trial Codes · Trial Usage · User Management
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  Users, TrendingUp, Activity, Crown, Star, Zap,
  RefreshCw, LogIn, UserCheck, UserPlus, Tag, Gift,
  Trash2, ToggleLeft, ToggleRight, ShieldBan, ShieldCheck,
  ChevronDown, ChevronUp, Search, KeyRound, Save,
  Eye, EyeOff,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtRelative(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return fmtDate(iso);
}
function tierColor(tier: string | null) {
  if (tier === "pro")   return { bg: "#A23B32", label: "Pro" };
  if (tier === "basic") return { bg: "#2563eb", label: "Basic" };
  return { bg: "#3D4B58", label: "Free" };
}
function statusColor(s: string) {
  if (s === "active")    return "#22c55e";
  if (s === "cancelled") return "#ef4444";
  return "#f59e0b";
}
function authHeaders() {
  const token = localStorage.getItem("ciq_token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── types ────────────────────────────────────────────────────────────────────
interface InsightsData {
  generatedAt: string;
  ownerAccount: {
    email: string; tier: string | null; subStatus: string;
    loginCount: number; lastLogin: string | null; lastActive: string | null; joinedAt: string;
  } | null;
  totals: {
    allUsers: number; activeSubscribers: number; activeToday: number;
    activeThisWeek: number; activeThisMonth: number;
    newThisWeek: number; newThisMonth: number; avgLoginsPerUser: number;
  };
  tiers: Record<string, { active: number; inactive: number; cancelled: number }>;
  topUsers: { email: string; tier: string | null; subStatus: string; loginCount: number; lastLogin: string | null; lastActive: string | null; joinedAt: string; }[];
  signupTrend: { day: string; count: number }[];
  dauTrend:    { day: string; count: number }[];
}
interface PromoCode { id: number; code: string; discount_pct: number; applies_to: string; max_uses: number | null; uses: number; active: boolean; created_at: string; expires_at: string | null; duration_months: number | null; }
interface TrialCode { id: number; code: string; duration_days: number; max_uses: number | null; uses: number; active: boolean; note: string | null; created_at: string; expires_at: string | null; }
interface TrialUse  { id: number; code: string; email: string; used_at: string; trial_expires: string; }
interface AppUser   { id: number; email: string; tier: string | null; sub_status: string; is_owner: boolean; is_disabled: boolean; login_count: number; last_active: string | null; created_at: string; trial_code: string | null; trial_expires: string | null; pin_plain: string | null; }

// ─── sub-components ───────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color = "#131A24" }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className="p-2 rounded-xl flex-shrink-0" style={{ background: `${color}15` }}>
        <div style={{ color }}>{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <p className="text-2xl font-black text-foreground leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SparkBar({ data, color = "#A23B32" }: { data: { day: string; count: number }[]; color?: string }) {
  if (!data.length) return <p className="text-xs text-foreground/40 py-2">No data yet</p>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-[3px] h-12 mt-2">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center group relative">
          <div className="w-full rounded-sm" style={{ height: `${Math.max(4, (d.count / max) * 44)}px`, background: color, opacity: 0.8 }} />
          <div className="absolute bottom-full mb-1 hidden group-hover:flex bg-foreground text-background text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
            {d.day}: {d.count}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Promo Codes Panel ────────────────────────────────────────────────────────
function durLabel(d: number | null): string {
  if (d === null) return "Forever";
  if (d === 1)    return "1 mo";
  return `${d} mo`;
}

function PromoCodesPanel() {
  const qc = useQueryClient();
  const [code, setCode]             = useState("");
  const [pct, setPct]               = useState(10);
  const [appliesTo, setAppliesTo]   = useState("both");
  const [maxUses, setMaxUses]       = useState("");
  const [durationMonths, setDurationMonths] = useState<string>("forever");
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState("");

  const { data: codes = [], isLoading } = useQuery<PromoCode[]>({
    queryKey: ["admin-promo-codes"],
    queryFn: () => fetch("/api/admin/promo-codes", { headers: authHeaders() }).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => fetch("/api/admin/promo-codes", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: (d) => {
      if (d.error) { setError(d.error); return; }
      setSuccess(`Code ${d.code} created!`); setCode(""); setPct(10); setMaxUses("");
      qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
      setTimeout(() => setSuccess(""), 3000);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/admin/promo-codes/${id}`, { method: "DELETE", headers: authHeaders() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/admin/promo-codes/${id}/toggle`, { method: "PATCH", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const dm = durationMonths === "forever" ? null : parseInt(durationMonths);
    createMut.mutate({ code: code.toUpperCase().trim(), discount_pct: pct, applies_to: appliesTo, max_uses: maxUses ? parseInt(maxUses) : null, duration_months: dm });
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2" style={{ background: "rgba(37,99,235,0.04)" }}>
        <Tag size={13} style={{ color: "#2563eb" }} />
        <p className="text-xs font-bold text-foreground">Promo Codes</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{codes.length} codes</span>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="px-4 py-3 border-b border-border space-y-3">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Create New Code</p>
        {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
        {success && <p className="text-xs font-semibold" style={{ color: "#22c55e" }}>{success}</p>}
        <div className="flex gap-2 flex-wrap">
          <input
            value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. SAVE20" maxLength={20} required
            className="flex-1 min-w-[100px] px-3 py-2 rounded-xl border text-sm font-black tracking-widest uppercase outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
          />
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border" style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)" }}>
            <input type="number" min={1} max={100} value={pct} onChange={e => setPct(parseInt(e.target.value))}
              className="w-10 text-center font-black text-sm outline-none bg-transparent" style={{ color: "#131A24" }} />
            <span className="text-sm font-bold text-muted-foreground">%</span>
          </div>
          <select value={appliesTo} onChange={e => setAppliesTo(e.target.value)}
            className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}>
            <option value="both">Both Plans</option>
            <option value="basic">Basic Only</option>
            <option value="pro">Pro Only</option>
          </select>
          <select value={durationMonths} onChange={e => setDurationMonths(e.target.value)}
            className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}>
            <option value="forever">Until Cancelled</option>
            {[1,2,3,4,5,6,9,12,18,24].map(n => (
              <option key={n} value={String(n)}>{n} Month{n > 1 ? "s" : ""}</option>
            ))}
          </select>
          <input type="number" min={1} value={maxUses} onChange={e => setMaxUses(e.target.value)}
            placeholder="Max uses (∞)"
            className="w-28 px-3 py-2 rounded-xl border text-xs outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }} />
          <button type="submit" disabled={createMut.isPending || !code.trim()}
            className="px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "#2563eb", color: "#fff" }}>
            {createMut.isPending ? "…" : "Create"}
          </button>
        </div>
      </form>

      {/* Code list */}
      {isLoading ? (
        <div className="px-4 py-6 text-center"><RefreshCw size={16} className="animate-spin text-muted-foreground mx-auto" /></div>
      ) : codes.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No promo codes yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {codes.map(c => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-3">
              <span className="font-black text-sm tracking-widest" style={{ color: c.active ? "#131A24" : "rgba(19,35,58,0.35)" }}>{c.code}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>{c.discount_pct}% off</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(19,35,58,0.08)", color: "#3D4B58" }}>{durLabel(c.duration_months)}</span>
              <span className="text-[10px] text-muted-foreground">{c.applies_to}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">{c.uses}{c.max_uses ? `/${c.max_uses}` : ""} uses</span>
              <span className="text-[10px] font-bold" style={{ color: c.active ? "#22c55e" : "#ef4444" }}>{c.active ? "Active" : "Off"}</span>
              <button onClick={() => toggleMut.mutate(c.id)} className="p-1 rounded-lg hover:bg-muted/40 transition-colors">
                {c.active ? <ToggleRight size={16} style={{ color: "#22c55e" }} /> : <ToggleLeft size={16} style={{ color: "#ef4444" }} />}
              </button>
              <button onClick={() => deleteMut.mutate(c.id)} className="p-1 rounded-lg hover:bg-red-50 transition-colors">
                <Trash2 size={13} style={{ color: "#ef4444" }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trial Codes Panel ────────────────────────────────────────────────────────
function TrialCodesPanel() {
  const qc = useQueryClient();
  const [code, setCode]       = useState("");
  const [days, setDays]       = useState(7);
  const [maxUses, setMaxUses] = useState("");
  const [note, setNote]       = useState("");
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [showUses, setShowUses] = useState(false);

  const { data: codes = [], isLoading } = useQuery<TrialCode[]>({
    queryKey: ["admin-trial-codes"],
    queryFn: () => fetch("/api/admin/trial-codes", { headers: authHeaders() }).then(r => r.json()),
  });

  const { data: uses = [] } = useQuery<TrialUse[]>({
    queryKey: ["admin-trial-uses"],
    queryFn: () => fetch("/api/admin/trial-uses", { headers: authHeaders() }).then(r => r.json()),
    enabled: showUses,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => fetch("/api/admin/trial-codes", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: (d) => {
      if (d.error) { setError(d.error); return; }
      setSuccess(`Trial code ${d.code} created!`); setCode(""); setNote(""); setMaxUses("");
      qc.invalidateQueries({ queryKey: ["admin-trial-codes"] });
      setTimeout(() => setSuccess(""), 3000);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/admin/trial-codes/${id}`, { method: "DELETE", headers: authHeaders() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-trial-codes"] }),
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/admin/trial-codes/${id}/toggle`, { method: "PATCH", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-trial-codes"] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError("");
    createMut.mutate({ code: code.toUpperCase().trim(), duration_days: days, max_uses: maxUses ? parseInt(maxUses) : null, note: note || null });
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2" style={{ background: "rgba(162,59,50,0.04)" }}>
        <Gift size={13} style={{ color: "#A23B32" }} />
        <p className="text-xs font-bold text-foreground">Trial Access Codes</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{codes.length} codes</span>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="px-4 py-3 border-b border-border space-y-3">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Create Trial Code</p>
        {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
        {success && <p className="text-xs font-semibold" style={{ color: "#22c55e" }}>{success}</p>}
        <div className="flex gap-2 flex-wrap">
          <input
            value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. TEST7" maxLength={20} required
            className="flex-1 min-w-[90px] px-3 py-2 rounded-xl border text-sm font-black tracking-widest uppercase outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
          />
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border" style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)" }}>
            <input type="number" min={1} max={365} value={days} onChange={e => setDays(parseInt(e.target.value))}
              className="w-10 text-center font-black text-sm outline-none bg-transparent" style={{ color: "#131A24" }} />
            <span className="text-xs font-bold text-muted-foreground">days</span>
          </div>
          <input type="number" min={1} value={maxUses} onChange={e => setMaxUses(e.target.value)}
            placeholder="Max uses (∞)"
            className="w-28 px-3 py-2 rounded-xl border text-xs outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }} />
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="flex-1 min-w-[120px] px-3 py-2 rounded-xl border text-xs outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }} />
          <button type="submit" disabled={createMut.isPending || !code.trim()}
            className="px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "#A23B32", color: "#fff" }}>
            {createMut.isPending ? "…" : "Create"}
          </button>
        </div>
      </form>

      {/* Code list */}
      {isLoading ? (
        <div className="px-4 py-6 text-center"><RefreshCw size={16} className="animate-spin text-muted-foreground mx-auto" /></div>
      ) : codes.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No trial codes yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {codes.map(c => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="font-black text-sm tracking-widest" style={{ color: c.active ? "#131A24" : "rgba(19,35,58,0.35)" }}>{c.code}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(162,59,50,0.1)", color: "#A23B32" }}>{c.duration_days}d Pro</span>
              {c.note && <span className="text-[10px] text-muted-foreground italic">{c.note}</span>}
              <span className="text-[10px] text-muted-foreground ml-auto">{c.uses}{c.max_uses ? `/${c.max_uses}` : ""} uses</span>
              <span className="text-[10px] font-bold" style={{ color: c.active ? "#22c55e" : "#ef4444" }}>{c.active ? "Active" : "Off"}</span>
              <button onClick={() => toggleMut.mutate(c.id)} className="p-1 rounded-lg hover:bg-muted/40 transition-colors">
                {c.active ? <ToggleRight size={16} style={{ color: "#22c55e" }} /> : <ToggleLeft size={16} style={{ color: "#ef4444" }} />}
              </button>
              <button onClick={() => deleteMut.mutate(c.id)} className="p-1 rounded-lg hover:bg-red-50 transition-colors">
                <Trash2 size={13} style={{ color: "#ef4444" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Usage log toggle */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowUses(s => !s)}
          className="w-full px-4 py-2.5 flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          {showUses ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Usage Log {uses.length > 0 && `(${uses.length})`}
        </button>
        {showUses && (
          uses.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground text-center">No trial codes have been used yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="text-left px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Code</th>
                    <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Used</th>
                    <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {uses.map((u, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium text-foreground truncate max-w-[160px]">{u.email}</td>
                      <td className="px-3 py-2 text-center font-black tracking-widest text-foreground">{u.code}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{fmtRelative(u.used_at)}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{fmtDate(u.trial_expires)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Dev Code Panel ──────────────────────────────────────────────────────────
function DevCodePanel() {
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [inputCode, setInputCode]     = useState("");
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [success, setSuccess]         = useState("");
  const [error, setError]             = useState("");

  // Fetch current code on mount
  useEffect(() => {
    fetch("/api/admin/dev-code")
      .then(r => r.json())
      .then(d => {
        setCurrentCode(d.code ?? "");
        setInputCode(d.code ?? "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    const val = inputCode.toUpperCase().trim();
    if (!val) { setError("Code cannot be empty."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/dev-code", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ code: val }),
      });
      const d = await res.json();
      if (d.error) { setError(d.error); }
      else {
        setCurrentCode(d.code);
        setInputCode(d.code);
        setSuccess("Dev code updated!");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2" style={{ background: "rgba(19,35,58,0.04)" }}>
        <KeyRound size={13} style={{ color: "#131A24" }} />
        <p className="text-xs font-bold text-foreground">Active Dev Code</p>
        <span className="ml-auto text-[10px] text-muted-foreground">Login screen · Dev tab</span>
      </div>
      <form onSubmit={handleSave} className="px-4 py-4">
        {error   && <p className="text-xs text-red-600 font-semibold mb-3">{error}</p>}
        {success && <p className="text-xs font-semibold mb-3" style={{ color: "#22c55e" }}>{success}</p>}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border" style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)" }}>
                <RefreshCw size={12} className="animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading…</span>
              </div>
            ) : (
              <input
                value={inputCode}
                onChange={e => setInputCode(e.target.value.toUpperCase())}
                placeholder="Enter dev code…"
                maxLength={20}
                required
                className="w-full px-3 py-2.5 rounded-xl border text-sm font-black tracking-widest uppercase outline-none"
                style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24", letterSpacing: "0.2em" }}
              />
            )}
          </div>
          <button
            type="submit"
            disabled={saving || loading || inputCode.trim() === currentCode}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "#131A24", color: "#F6F1E7" }}
          >
            <Save size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {currentCode && !loading && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Current code: <span className="font-black tracking-widest" style={{ color: "#131A24" }}>{currentCode}</span>
          </p>
        )}
      </form>
    </div>
  );
}

// ─── User Management Panel ────────────────────────────────────────────────────
function UserManagementPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const [revealedPins, setRevealedPins] = useState<Set<number>>(new Set());
  const [editingPin, setEditingPin] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState("");

  const togglePin = (id: number) => setRevealedPins(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const pinMut = useMutation({
    mutationFn: ({ id, pin }: { id: number; pin: string }) =>
      fetch(`/api/admin/users/${id}/pin`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ pin }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); setEditingPin(null); setPinInput(""); },
  });

  const { data: users = [], isLoading, refetch } = useQuery<AppUser[]>({
    queryKey: ["admin-users", searchVal],
    queryFn: () => fetch(`/api/admin/users${searchVal ? `?search=${encodeURIComponent(searchVal)}` : ""}`, { headers: authHeaders() }).then(r => r.json()),
  });

  const tierMut = useMutation({
    mutationFn: ({ id, tier }: { id: number; tier: string }) =>
      fetch(`/api/admin/users/${id}/tier`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ tier }) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const disableMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/users/${id}/disable`, { method: "PATCH", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Users size={13} style={{ color: "#131A24" }} />
        <p className="text-xs font-bold text-foreground">User Management</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{users.length} shown</span>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-border flex gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && setSearchVal(search)}
            placeholder="Search by email…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border text-xs outline-none"
            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
          />
        </div>
        <button onClick={() => { setSearchVal(search); refetch(); }}
          className="px-3 py-2 rounded-xl text-xs font-black transition-all active:scale-95"
          style={{ background: "#131A24", color: "#F6F1E7" }}>
          Search
        </button>
        {searchVal && (
          <button onClick={() => { setSearch(""); setSearchVal(""); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold"
            style={{ background: "rgba(19,35,58,0.06)", color: "#3D4B58" }}>
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="px-4 py-8 text-center"><RefreshCw size={16} className="animate-spin text-muted-foreground mx-auto" /></div>
      ) : users.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Plan</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">PIN</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Trial</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Active</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Change Plan</th>
                <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Access</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const tc = tierColor(u.tier);
                return (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                    style={{ opacity: u.is_disabled ? 0.5 : 1 }}>
                    <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[160px]">
                      {u.email}
                      {u.is_owner && <span className="ml-1 text-[9px] px-1 py-0.5 rounded font-black" style={{ background: "#A23B32", color: "#fff" }}>Owner</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold" style={{ background: tc.bg }}>{tc.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-[10px] font-semibold capitalize" style={{ color: statusColor(u.sub_status) }}>{u.sub_status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {editingPin === u.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            autoFocus
                            value={pinInput}
                            onChange={e => setPinInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" && pinInput.trim()) pinMut.mutate({ id: u.id, pin: pinInput.trim() });
                              if (e.key === "Escape") { setEditingPin(null); setPinInput(""); }
                            }}
                            placeholder="PIN"
                            className="w-14 px-1 py-0.5 rounded border text-[10px] font-mono text-center outline-none"
                            style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.3)", color: "#131A24" }}
                          />
                          <button onClick={() => pinInput.trim() && pinMut.mutate({ id: u.id, pin: pinInput.trim() })}
                            className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                            style={{ background: "#131A24", color: "#F6F1E7" }}>✓</button>
                          <button onClick={() => { setEditingPin(null); setPinInput(""); }}
                            className="text-[9px] px-1 py-0.5 rounded font-bold"
                            style={{ background: "rgba(19,35,58,0.1)", color: "#3D4B58" }}>✕</button>
                        </div>
                      ) : u.pin_plain ? (
                        <div className="flex items-center justify-center gap-1">
                          <span className="font-mono text-[10px] font-bold text-foreground">
                            {revealedPins.has(u.id) ? u.pin_plain : "••••"}
                          </span>
                          <button onClick={() => togglePin(u.id)}
                            className="p-0.5 rounded transition-colors hover:bg-muted/40"
                            title={revealedPins.has(u.id) ? "Hide PIN" : "Reveal PIN"}>
                            {revealedPins.has(u.id)
                              ? <EyeOff size={10} style={{ color: "#3D4B58" }} />
                              : <Eye size={10} style={{ color: "#3D4B58" }} />}
                          </button>
                          <button onClick={() => { setEditingPin(u.id); setPinInput(u.pin_plain ?? ""); }}
                            className="p-0.5 rounded transition-colors hover:bg-muted/40" title="Edit PIN">
                            <KeyRound size={9} style={{ color: "#3D4B58" }} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingPin(u.id); setPinInput(""); }}
                          className="text-[9px] font-semibold underline underline-offset-2"
                          style={{ color: "#A23B32" }}>Set PIN</button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-[10px] text-muted-foreground">
                      {u.trial_code ? <span className="font-bold" style={{ color: "#A23B32" }}>{u.trial_code}<br /><span className="font-normal text-muted-foreground">exp {fmtDate(u.trial_expires)}</span></span> : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{fmtRelative(u.last_active)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {!u.is_owner && (
                        <select
                          value={u.tier ?? "free"}
                          onChange={e => tierMut.mutate({ id: u.id, tier: e.target.value })}
                          className="px-2 py-1 rounded-lg border text-[10px] font-bold outline-none"
                          style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
                        >
                          <option value="free">Free</option>
                          <option value="basic">Basic</option>
                          <option value="pro">Pro</option>
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {!u.is_owner && (
                        <button onClick={() => disableMut.mutate(u.id)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-muted/40"
                          title={u.is_disabled ? "Enable account" : "Disable account"}>
                          {u.is_disabled
                            ? <ShieldCheck size={14} style={{ color: "#22c55e" }} />
                            : <ShieldBan  size={14} style={{ color: "#ef4444" }} />}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AppInsights() {
  const { user } = useAuth();
  const token = localStorage.getItem("ciq_token");

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<InsightsData>({
    queryKey: ["admin-insights"],
    queryFn: async () => {
      const res = await fetch("/api/admin/insights", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load insights");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const t = data?.totals;
  const tiers = data?.tiers ?? {};
  const totalPaying = (tiers.basic?.active ?? 0) + (tiers.pro?.active ?? 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <Crown size={18} style={{ color: "#A23B32" }} /> App Insights
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Owner view · {dataUpdatedAt ? `Updated ${fmtRelative(new Date(dataUpdatedAt).toISOString())}` : "Loading…"}
          </p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all active:scale-95"
          style={{ borderColor: "rgba(19,35,58,0.15)", color: "#131A24", opacity: isFetching ? 0.5 : 1 }}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {isLoading && <div className="flex items-center justify-center py-20"><RefreshCw size={24} className="animate-spin text-muted-foreground" /></div>}
      {isError && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">Failed to load insights. Make sure you're logged in as owner.</div>}

      {/* ── Dev Account ── */}
      {data?.ownerAccount && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2" style={{ background: "rgba(162,59,50,0.06)" }}>
            <Crown size={13} style={{ color: "#A23B32" }} />
            <p className="text-xs font-bold text-foreground">Dev Account</p>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold text-white" style={{ background: "#A23B32" }}>Owner</span>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</p>
              <p className="text-sm font-semibold text-foreground truncate mt-0.5">{data.ownerAccount.email}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Logins</p>
              <p className="text-2xl font-black text-foreground mt-0.5">{data.ownerAccount.loginCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Active</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{fmtRelative(data.ownerAccount.lastActive)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Login</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{fmtRelative(data.ownerAccount.lastLogin)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Divider ── */}
      {data && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "rgba(19,35,58,0.12)" }} />
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">User Stats</span>
          <div className="flex-1 h-px" style={{ background: "rgba(19,35,58,0.12)" }} />
        </div>
      )}

      {data && (
        <>
          {/* ── Key Stats ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Users size={16} />}    label="Total Users"   value={t!.allUsers}          sub="Registered users"    color="#131A24" />
            <StatCard icon={<Crown size={16} />}    label="Paying Subs"   value={totalPaying}           sub="Active Basic + Pro"  color="#A23B32" />
            <StatCard icon={<Activity size={16} />} label="Active Today"  value={t!.activeToday}        sub="Last 24 hours"       color="#22c55e" />
            <StatCard icon={<UserPlus size={16} />} label="New This Week" value={t!.newThisWeek}        sub="Signed up"           color="#2563eb" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<UserCheck size={16} />} label="Active (7d)"   value={t!.activeThisWeek}    sub="Unique active users" color="#7c3aed" />
            <StatCard icon={<UserCheck size={16} />} label="Active (30d)"  value={t!.activeThisMonth}   sub="Unique active users" color="#0891b2" />
            <StatCard icon={<LogIn size={16} />}     label="Avg Logins"    value={t!.avgLoginsPerUser || "—"} sub="Per user lifetime" color="#d97706" />
            <StatCard icon={<UserPlus size={16} />}  label="New This Month"value={t!.newThisMonth}      sub="Signed up"           color="#059669" />
          </div>

          {/* ── Tier Breakdown ── */}
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Subscribers by Tier</p>
            <div className="grid grid-cols-3 gap-3">
              {(["free", "basic", "pro"] as const).map(tier => {
                const tc = tierColor(tier);
                const d  = tiers[tier] ?? { active: 0, inactive: 0, cancelled: 0 };
                return (
                  <div key={tier} className="rounded-xl p-3 border" style={{ borderColor: `${tc.bg}30`, background: `${tc.bg}08` }}>
                    <div className="flex items-center gap-1.5 mb-2">
                      {tier === "pro"   && <Crown size={13} style={{ color: tc.bg }} />}
                      {tier === "basic" && <Star  size={13} style={{ color: tc.bg }} />}
                      {tier === "free"  && <Zap   size={13} style={{ color: tc.bg }} />}
                      <span className="text-xs font-black" style={{ color: tc.bg }}>{tc.label}</span>
                    </div>
                    <p className="text-3xl font-black text-foreground leading-none">{d.active + d.inactive + d.cancelled}</p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[10px]"><span className="text-foreground/50">Active</span><span className="font-bold" style={{ color: "#22c55e" }}>{d.active}</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-foreground/50">Pending</span><span className="font-bold" style={{ color: "#f59e0b" }}>{d.inactive}</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-foreground/50">Cancelled</span><span className="font-bold" style={{ color: "#ef4444" }}>{d.cancelled}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Trend Charts ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><UserPlus size={13} style={{ color: "#2563eb" }} /><p className="text-xs font-bold text-foreground">Signups (Last 30 Days)</p></div>
              <p className="text-[10px] text-muted-foreground mb-1">{t!.newThisMonth} total this month</p>
              <SparkBar data={data.signupTrend} color="#2563eb" />
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><Activity size={13} style={{ color: "#22c55e" }} /><p className="text-xs font-bold text-foreground">Daily Active Users (Last 14 Days)</p></div>
              <p className="text-[10px] text-muted-foreground mb-1">{t!.activeToday} active today</p>
              <SparkBar data={data.dauTrend} color="#22c55e" />
            </div>
          </div>

          {/* ── Top Users Table ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <TrendingUp size={13} style={{ color: "#A23B32" }} />
              <p className="text-xs font-bold text-foreground">Most Active Users</p>
              <span className="ml-auto text-[10px] text-muted-foreground">Top {data.topUsers.length} by login count</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Plan</th>
                  <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Logins</th>
                  <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Active</th>
                  <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Joined</th>
                </tr></thead>
                <tbody>
                  {data.topUsers.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No users yet</td></tr>}
                  {data.topUsers.map((u, i) => {
                    const tc = tierColor(u.tier);
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[180px]">{u.email}</td>
                        <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold" style={{ background: tc.bg }}>{tc.label}</span></td>
                        <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-semibold capitalize" style={{ color: statusColor(u.subStatus) }}>{u.subStatus}</span></td>
                        <td className="px-3 py-2.5 text-center font-bold text-foreground">{u.loginCount}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{fmtRelative(u.lastActive)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{fmtDate(u.joinedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Divider ── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "rgba(19,35,58,0.12)" }} />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Owner Tools</span>
        <div className="flex-1 h-px" style={{ background: "rgba(19,35,58,0.12)" }} />
      </div>

      {/* ── Dev Code ── */}
      <DevCodePanel />

      {/* ── Promo Codes ── */}
      <PromoCodesPanel />

      {/* ── Trial Codes ── */}
      <TrialCodesPanel />

      {/* ── User Management ── */}
      <UserManagementPanel />

      {/* Footer */}
      {data && (
        <p className="text-[10px] text-center text-muted-foreground">
          Stats refresh every 5 min · Generated {new Date(data.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT
        </p>
      )}
    </div>
  );
}
