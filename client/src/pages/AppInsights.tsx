/**
 * AppInsights — Owner-only dashboard.
 * Sections: 1-User Control · 2-Feature Flags · 3-API Health · 4-Analytics · 5-Messaging · 6-Deployment · 7-Settings
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  Users, TrendingUp, Activity, Crown, Star, Zap,
  RefreshCw, LogIn, UserCheck, UserPlus, Tag, Gift,
  Trash2, ToggleLeft, ToggleRight, ShieldBan, ShieldCheck,
  ChevronDown, ChevronUp, Search, KeyRound, Save,
  Eye, EyeOff, Bell, Send, GitBranch, Settings,
  AlertTriangle, CheckCircle2, XCircle, Clock, Wifi,
  DollarSign, BarChart2, Megaphone, Shield, History,
  RotateCcw, Ban, Flag, TimerReset, X,
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
  ownerAccount: { email: string; tier: string | null; subStatus: string; loginCount: number; lastLogin: string | null; lastActive: string | null; joinedAt: string; } | null;
  totals: { allUsers: number; activeSubscribers: number; activeToday: number; activeThisWeek: number; activeThisMonth: number; newThisWeek: number; newThisMonth: number; avgLoginsPerUser: number; };
  tiers: Record<string, { active: number; inactive: number; cancelled: number }>;
  topUsers: { email: string; tier: string | null; subStatus: string; loginCount: number; lastLogin: string | null; lastActive: string | null; joinedAt: string; }[];
  signupTrend: { day: string; count: number }[];
  dauTrend:    { day: string; count: number }[];
}
interface PromoCode { id: number; code: string; discount_pct: number; applies_to: string; max_uses: number | null; uses: number; active: boolean; created_at: string; expires_at: string | null; duration_months: number | null; }
interface TrialCode { id: number; code: string; duration_days: number; max_uses: number | null; uses: number; active: boolean; note: string | null; created_at: string; expires_at: string | null; }
interface TrialUse  { id: number; code: string; email: string; used_at: string; trial_expires: string; }
interface AppUser   { id: number; email: string; tier: string | null; sub_status: string; is_owner: boolean; is_disabled: boolean; is_flagged?: boolean; flag_reason?: string | null; login_count: number; last_active: string | null; created_at: string; trial_code: string | null; trial_expires: string | null; pin_plain: string | null; stripe_customer_id?: string | null; stripe_sub_id?: string | null; }
interface FeatureFlag { id: number; key: string; label: string; enabled: boolean; min_tier: string; kill_switch: boolean; updated_at: string; }
interface ApiHealth   { service: string; status: string; latency_ms: number | null; error: string | null; ts: string; errors_24h: number; }
interface AuditEntry  { id: number; actor: string; action: string; target: string | null; detail: string | null; ts: string; }

// ─── Section divider ──────────────────────────────────────────────────────────
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="flex-1 h-px" style={{ background: "rgba(19,35,58,0.12)" }} />
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px" style={{ background: "rgba(19,35,58,0.12)" }} />
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color = "#131A24" }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1" style={{ color }}>{icon}<p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p></div>
      <p className="text-2xl font-black text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── SparkBar ─────────────────────────────────────────────────────────────────
function SparkBar({ data, color = "#A23B32" }: { data: { day: string; count: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-0.5 h-12 mt-1">
      {data.map((d, i) => (
        <div key={i} className="flex-1 rounded-t-sm transition-all" title={`${d.day}: ${d.count}`}
          style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, background: color, opacity: 0.7 + (i / data.length) * 0.3 }} />
      ))}
    </div>
  );
}

// ─── Collapsible panel wrapper ────────────────────────────────────────────────
function Panel({ icon, title, badge, defaultOpen = false, children }: { icon: React.ReactNode; title: string; badge?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button className="w-full px-4 py-3 flex items-center gap-2 text-left" onClick={() => setOpen(o => !o)}>
        <span style={{ color: "#A23B32" }}>{icon}</span>
        <p className="text-xs font-bold text-foreground flex-1">{title}</p>
        {badge && <span className="text-[10px] text-muted-foreground mr-2">{badge}</span>}
        {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

// ─── durLabel helper ──────────────────────────────────────────────────────────
function durLabel(d: number | null): string {
  if (d === null) return "Until cancelled";
  return d === 1 ? "1 month" : `${d} months`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Promo + Trial + Dev code (existing panels, preserved)
// ══════════════════════════════════════════════════════════════════════════════

function PromoCodesPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(""); const [pct, setPct] = useState(""); const [applies, setApplies] = useState("both");
  const [maxUses, setMaxUses] = useState(""); const [expires, setExpires] = useState(""); const [duration, setDuration] = useState<string>("null");
  const { data: codes = [], isLoading } = useQuery<PromoCode[]>({ queryKey: ["admin-promos"], queryFn: () => fetch("/api/admin/promo-codes", { headers: authHeaders() }).then(r => r.json()) });
  const createMut = useMutation({ mutationFn: (body: any) => fetch("/api/admin/promo-codes", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-promos"] }); setCode(""); setPct(""); setMaxUses(""); setExpires(""); setDuration("null"); } });
  const deleteMut = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/promo-codes/${id}`, { method: "DELETE", headers: authHeaders() }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promos"] }) });
  const toggleMut = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/promo-codes/${id}/toggle`, { method: "PATCH", headers: authHeaders() }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promos"] }) });
  const handleCreate = () => { if (!code.trim() || !pct) return; createMut.mutate({ code: code.trim().toUpperCase(), discount_pct: parseInt(pct), applies_to: applies, max_uses: maxUses ? parseInt(maxUses) : null, expires_at: expires || null, duration_months: duration === "null" ? null : parseInt(duration) }); };
  return (
    <Panel icon={<Tag size={13} />} title="Promo Codes" badge={`${codes.filter(c=>c.active).length} active`}>
      <div className="p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground">Create Promo Code</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={code} onChange={e=>setCode(e.target.value)} placeholder="Code (e.g. SAVE20)" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <input value={pct}  onChange={e=>setPct(e.target.value)}  placeholder="Discount %" type="number" min="1" max="100" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <select value={applies} onChange={e=>setApplies(e.target.value)} className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}}>
            <option value="both">Both plans</option><option value="basic">Basic only</option><option value="pro">Pro only</option>
          </select>
          <select value={duration} onChange={e=>setDuration(e.target.value)} className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}}>
            <option value="null">Until cancelled</option>
            {Array.from({length:24},(_,i)=>i+1).map(m=><option key={m} value={String(m)}>{m} month{m>1?"s":""}</option>)}
          </select>
          <input value={maxUses} onChange={e=>setMaxUses(e.target.value)} placeholder="Max uses (blank=unlimited)" type="number" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <input value={expires} onChange={e=>setExpires(e.target.value)} placeholder="Expires (optional)" type="date" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
        </div>
        <button onClick={handleCreate} disabled={createMut.isPending} className="w-full py-2 rounded-xl text-xs font-bold text-white transition-opacity active:scale-95" style={{background:"#131A24",opacity:createMut.isPending?0.6:1}}>
          {createMut.isPending ? "Creating…" : "Create Code"}
        </button>
      </div>
      {isLoading ? <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div> : codes.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">No promo codes yet.</div> : (
        <div className="divide-y divide-border">
          {codes.map(c => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-xs font-black text-foreground">{c.code}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{background:"#A23B32"}}>{c.discount_pct}% off</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{background:"rgba(19,35,58,0.08)",color:"#3D4B58"}}>{durLabel(c.duration_months)}</span>
                  {!c.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{background:"#fee2e2",color:"#ef4444"}}>Inactive</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.uses}{c.max_uses ? `/${c.max_uses}` : ""} uses · {c.applies_to}{c.expires_at ? ` · exp ${fmtDate(c.expires_at)}` : ""}</p>
              </div>
              <button onClick={() => toggleMut.mutate(c.id)} className="p-1.5 rounded-lg hover:bg-muted/40">{c.active ? <ToggleRight size={16} style={{color:"#22c55e"}} /> : <ToggleLeft size={16} style={{color:"#ef4444"}} />}</button>
              <button onClick={() => deleteMut.mutate(c.id)} className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 size={14} style={{color:"#ef4444"}} /></button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TrialCodesPanel() {
  const qc = useQueryClient();
  const [code, setCode] = useState(""); const [days, setDays] = useState("7"); const [maxUses, setMaxUses] = useState(""); const [note, setNote] = useState(""); const [expires, setExpires] = useState("");
  const { data: codes = [], isLoading } = useQuery<TrialCode[]>({ queryKey: ["admin-trials"], queryFn: () => fetch("/api/admin/trial-codes", { headers: authHeaders() }).then(r => r.json()) });
  const { data: uses = [] } = useQuery<TrialUse[]>({ queryKey: ["admin-trial-uses"], queryFn: () => fetch("/api/admin/trial-uses", { headers: authHeaders() }).then(r => r.json()) });
  const [showLog, setShowLog] = useState(false);
  const createMut = useMutation({ mutationFn: (body: any) => fetch("/api/admin/trial-codes", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-trials"] }); setCode(""); setDays("7"); setMaxUses(""); setNote(""); setExpires(""); } });
  const deleteMut = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/trial-codes/${id}`, { method: "DELETE", headers: authHeaders() }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-trials"] }) });
  const toggleMut = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/trial-codes/${id}/toggle`, { method: "PATCH", headers: authHeaders() }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-trials"] }) });
  return (
    <Panel icon={<Gift size={13} />} title="Trial Codes" badge={`${codes.filter(c=>c.active).length} active`}>
      <div className="p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground">Create Trial Code</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={code} onChange={e=>setCode(e.target.value)} placeholder="Code (e.g. WELCOME7)" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <input value={days} onChange={e=>setDays(e.target.value)} placeholder="Trial days" type="number" min="1" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <input value={maxUses} onChange={e=>setMaxUses(e.target.value)} placeholder="Max uses (blank=unlimited)" type="number" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional)" className="px-3 py-2 rounded-lg border text-xs outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <input value={expires} onChange={e=>setExpires(e.target.value)} placeholder="Code expires" type="date" className="px-3 py-2 rounded-lg border text-xs outline-none col-span-2" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
        </div>
        <button onClick={() => { if(!code.trim()||!days) return; createMut.mutate({code:code.trim().toUpperCase(),duration_days:parseInt(days),max_uses:maxUses?parseInt(maxUses):null,note:note||null,expires_at:expires||null}); }} disabled={createMut.isPending} className="w-full py-2 rounded-xl text-xs font-bold text-white active:scale-95" style={{background:"#131A24",opacity:createMut.isPending?0.6:1}}>
          {createMut.isPending ? "Creating…" : "Create Code"}
        </button>
      </div>
      {isLoading ? <div className="py-4 text-center text-xs text-muted-foreground">Loading…</div> : codes.length === 0 ? <div className="py-4 text-center text-xs text-muted-foreground">No trial codes yet.</div> : (
        <div className="divide-y divide-border">
          {codes.map(c => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-xs font-black text-foreground">{c.code}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{background:"#7c3aed"}}>{c.duration_days}d trial</span>
                  {!c.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{background:"#fee2e2",color:"#ef4444"}}>Inactive</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.uses}{c.max_uses?`/${c.max_uses}`:""} uses{c.note ? ` · ${c.note}` : ""}</p>
              </div>
              <button onClick={() => toggleMut.mutate(c.id)} className="p-1.5 rounded-lg hover:bg-muted/40">{c.active ? <ToggleRight size={16} style={{color:"#22c55e"}} /> : <ToggleLeft size={16} style={{color:"#ef4444"}} />}</button>
              <button onClick={() => deleteMut.mutate(c.id)} className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 size={14} style={{color:"#ef4444"}} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-border">
        <button onClick={() => setShowLog(o=>!o)} className="w-full px-4 py-2.5 flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <History size={12} /> Usage Log {showLog ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
        </button>
        {showLog && (uses.length === 0 ? <p className="text-center text-xs text-muted-foreground py-4">No uses yet.</p> : (
          <div className="divide-y divide-border max-h-40 overflow-y-auto">
            {uses.map(u => (
              <div key={u.id} className="px-4 py-2 flex items-center justify-between gap-2">
                <span className="text-xs text-foreground truncate">{u.email}</span>
                <span className="text-[10px] font-mono font-bold" style={{color:"#7c3aed"}}>{u.code}</span>
                <span className="text-[10px] text-muted-foreground">{fmtRelative(u.used_at)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DevCodePanel() {
  const qc = useQueryClient();
  const { data } = useQuery<{ code: string }>({ queryKey: ["admin-dev-code"], queryFn: () => fetch("/api/admin/dev-code").then(r => r.json()) });
  const [val, setVal] = useState("");
  const mut = useMutation({ mutationFn: (code: string) => fetch("/api/admin/dev-code", { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ code }) }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-dev-code"] }) });
  return (
    <Panel icon={<KeyRound size={13} />} title="Dev Access Code" defaultOpen={true}>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 p-3 rounded-xl" style={{background:"rgba(19,35,58,0.05)"}}>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active Code</span>
          <span className="font-mono text-sm font-black text-foreground ml-2">{data?.code ?? "—"}</span>
        </div>
        <div className="flex gap-2">
          <input value={val} onChange={e=>setVal(e.target.value.toUpperCase())} placeholder="New code (e.g. ABUD)" className="flex-1 px-3 py-2 rounded-lg border text-xs font-mono outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <button onClick={() => { if(val.trim()) mut.mutate(val.trim()); }} disabled={mut.isPending} className="px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5" style={{background:"#131A24"}}><Save size={12} />{mut.isPending?"Saving…":"Save"}</button>
        </div>
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — User Management (enhanced)
// ══════════════════════════════════════════════════════════════════════════════
function UserManagementPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const [revealedPins, setRevealedPins] = useState<Set<number>>(new Set());
  const [editingPin, setEditingPin] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [extendDays, setExtendDays] = useState<Record<number, string>>({});

  const togglePin = (id: number) => setRevealedPins(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const { data: users = [], isLoading, refetch } = useQuery<AppUser[]>({
    queryKey: ["admin-users", searchVal],
    queryFn: () => fetch(`/api/admin/users${searchVal ? `?search=${encodeURIComponent(searchVal)}` : ""}`, { headers: authHeaders() }).then(r => r.json()),
  });

  const { data: history = [] } = useQuery<AuditEntry[]>({
    queryKey: ["user-history", expandedUser],
    queryFn: () => fetch(`/api/admin/users/${expandedUser}/history`, { headers: authHeaders() }).then(r => r.json()),
    enabled: !!expandedUser,
  });

  const tierMut      = useMutation({ mutationFn: ({ id, tier, sub_status }: any) => fetch(`/api/admin/users/${id}/tier`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ tier, sub_status }) }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  const pinMut       = useMutation({ mutationFn: ({ id, pin }: any) => fetch(`/api/admin/users/${id}/pin`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ pin }) }).then(r => r.json()), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); setEditingPin(null); setPinInput(""); } });
  const disableMut   = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/users/${id}/disable`, { method: "PATCH", headers: authHeaders() }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  const flagMut      = useMutation({ mutationFn: ({ id, reason }: any) => fetch(`/api/admin/users/${id}/flag`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ reason }) }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  const refundMut    = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/users/${id}/refund`, { method: "POST", headers: authHeaders() }).then(r => r.json()) });
  const cancelMut    = useMutation({ mutationFn: (id: number) => fetch(`/api/admin/users/${id}/cancel`, { method: "POST", headers: authHeaders() }).then(r => r.json()), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  const extendMut    = useMutation({ mutationFn: ({ id, days }: any) => fetch(`/api/admin/users/${id}/extend-trial`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ days }) }).then(r => r.json()), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); setExtendDays({}); } });

  return (
    <Panel icon={<Users size={13} />} title="User Management" badge={`${users.length} shown`} defaultOpen={true}>
      <div className="p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && setSearchVal(search)} placeholder="Search by email…" className="w-full pl-8 pr-3 py-2 rounded-xl border text-xs outline-none" style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }} />
          </div>
          <button onClick={() => setSearchVal(search)} className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{ background: "#131A24" }}>Search</button>
          {searchVal && <button onClick={() => { setSearch(""); setSearchVal(""); }} className="px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: "rgba(19,35,58,0.08)", color: "#3D4B58" }}>Clear</button>}
        </div>
      </div>

      {isLoading ? <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div> : (
        <div className="divide-y divide-border">
          {users.length === 0 && <p className="text-center py-8 text-xs text-muted-foreground">No users found.</p>}
          {users.map(u => {
            const tc = tierColor(u.tier);
            const isExpanded = expandedUser === u.id;
            return (
              <div key={u.id} className={`transition-colors ${u.is_flagged ? "bg-amber-50/50" : ""}`}>
                {/* Main row */}
                <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
                  {/* Email + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-foreground truncate max-w-[160px]">{u.email}</span>
                      <span className="px-1.5 py-0.5 rounded-full text-white text-[9px] font-bold" style={{ background: tc.bg }}>{tc.label}</span>
                      <span className="text-[9px] font-semibold capitalize" style={{ color: statusColor(u.sub_status) }}>{u.sub_status}</span>
                      {u.is_owner    && <Crown size={10} style={{ color: "#A23B32" }} />}
                      {u.is_disabled && <ShieldBan size={10} style={{ color: "#ef4444" }} />}
                      {u.is_flagged  && <Flag size={10} style={{ color: "#f59e0b" }} />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[9px] text-muted-foreground">Joined {fmtDate(u.created_at)}</span>
                      <span className="text-[9px] text-muted-foreground">Active {fmtRelative(u.last_active)}</span>
                      <span className="text-[9px] text-muted-foreground">{u.login_count} logins</span>
                    </div>
                  </div>

                  {/* PIN cell */}
                  <div className="flex items-center gap-1">
                    {editingPin === u.id ? (
                      <>
                        <input autoFocus value={pinInput} onChange={e => setPinInput(e.target.value)}
                          onKeyDown={e => { if (e.key==="Enter"&&pinInput.trim()) pinMut.mutate({id:u.id,pin:pinInput.trim()}); if(e.key==="Escape"){setEditingPin(null);setPinInput("");} }}
                          placeholder="PIN" className="w-14 px-1 py-0.5 rounded border text-[10px] font-mono text-center outline-none"
                          style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.3)", color: "#131A24" }} />
                        <button onClick={() => pinInput.trim() && pinMut.mutate({id:u.id,pin:pinInput.trim()})} className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{background:"#131A24",color:"#F6F1E7"}}>✓</button>
                        <button onClick={() => {setEditingPin(null);setPinInput("");}} className="text-[9px] px-1 py-0.5 rounded" style={{background:"rgba(19,35,58,0.1)",color:"#3D4B58"}}>✕</button>
                      </>
                    ) : u.pin_plain ? (
                      <>
                        <span className="font-mono text-[10px] font-bold text-foreground">{revealedPins.has(u.id) ? u.pin_plain : "••••"}</span>
                        <button onClick={() => togglePin(u.id)} className="p-0.5 rounded hover:bg-muted/40">{revealedPins.has(u.id) ? <EyeOff size={10} style={{color:"#3D4B58"}} /> : <Eye size={10} style={{color:"#3D4B58"}} />}</button>
                        <button onClick={() => {setEditingPin(u.id);setPinInput(u.pin_plain??"")} } className="p-0.5 rounded hover:bg-muted/40" title="Edit PIN"><KeyRound size={9} style={{color:"#3D4B58"}} /></button>
                      </>
                    ) : (
                      <button onClick={() => {setEditingPin(u.id);setPinInput("");}} className="text-[9px] font-semibold underline underline-offset-2" style={{color:"#A23B32"}}>Set PIN</button>
                    )}
                  </div>

                  {/* Expand/collapse */}
                  <button onClick={() => setExpandedUser(isExpanded ? null : u.id)} className="p-1.5 rounded-lg hover:bg-muted/40">
                    {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </button>
                </div>

                {/* Expanded controls */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 bg-muted/10">
                    {/* Tier changer */}
                    <div className="flex items-center gap-2 flex-wrap pt-2">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-16">Plan</span>
                      {["free","basic","pro"].map(t => (
                        <button key={t} onClick={() => tierMut.mutate({ id: u.id, tier: t==="free"?null:t, sub_status: t==="free"?"inactive":"active" })}
                          className="px-2.5 py-1 rounded-full text-[10px] font-bold capitalize transition-all"
                          style={{ background: u.tier === t || (t==="free"&&!u.tier) ? tierColor(t==="free"?null:t).bg : "rgba(19,35,58,0.08)", color: u.tier === t || (t==="free"&&!u.tier) ? "#fff" : "#3D4B58" }}>
                          {t}
                        </button>
                      ))}
                    </div>

                    {/* Extend trial */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-16">Trial</span>
                      <input type="number" min="1" max="365" placeholder="Days" value={extendDays[u.id] ?? ""}
                        onChange={e => setExtendDays(p=>({...p,[u.id]:e.target.value}))}
                        className="w-16 px-2 py-1 rounded-lg border text-[10px] outline-none" style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
                      <button onClick={() => extendDays[u.id] && extendMut.mutate({id:u.id,days:parseInt(extendDays[u.id])})}
                        className="px-2.5 py-1 rounded-full text-[10px] font-bold text-white" style={{background:"#7c3aed"}}>
                        <TimerReset size={10} className="inline mr-1" />Extend
                      </button>
                      {u.trial_expires && <span className="text-[10px] text-muted-foreground">Expires {fmtDate(u.trial_expires)}</span>}
                    </div>

                    {/* Action buttons */}
                    {!u.is_owner && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button onClick={() => { if(confirm("Refund latest charge?")) refundMut.mutate(u.id); }}
                          className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1" style={{background:"rgba(34,197,94,0.1)",color:"#16a34a"}}>
                          <RotateCcw size={10} />Refund
                        </button>
                        <button onClick={() => { if(confirm("Cancel subscription?")) cancelMut.mutate(u.id); }}
                          className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1" style={{background:"rgba(239,68,68,0.1)",color:"#ef4444"}}>
                          <Ban size={10} />Cancel Sub
                        </button>
                        <button onClick={() => disableMut.mutate(u.id)}
                          className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1"
                          style={{background: u.is_disabled?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)", color: u.is_disabled?"#16a34a":"#ef4444"}}>
                          {u.is_disabled ? <><ShieldCheck size={10} />Enable</> : <><ShieldBan size={10} />Disable</>}
                        </button>
                        <button onClick={() => flagMut.mutate({id:u.id, reason:"VPN/shared account"})}
                          className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1"
                          style={{background: u.is_flagged?"rgba(245,158,11,0.15)":"rgba(245,158,11,0.1)", color:"#d97706"}}>
                          <Flag size={10} />{u.is_flagged?"Unflag":"Flag"}
                        </button>
                      </div>
                    )}

                    {/* Activity history */}
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1"><History size={10} />Activity Log</p>
                      {history.length === 0 ? <p className="text-[10px] text-muted-foreground">No activity recorded yet.</p> : (
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {history.map((h,i) => (
                            <div key={i} className="flex items-start gap-2 text-[9px]">
                              <span className="text-muted-foreground whitespace-nowrap">{fmtRelative(h.ts)}</span>
                              <span className="font-semibold text-foreground capitalize">{h.action.replace(/_/g," ")}</span>
                              {h.detail && <span className="text-muted-foreground truncate">{h.detail}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Feature Access Control
// ══════════════════════════════════════════════════════════════════════════════
function FeatureFlagsPanel() {
  const qc = useQueryClient();
  const { data: flags = [], isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["admin-feature-flags"],
    queryFn: () => fetch("/api/admin/feature-flags", { headers: authHeaders() }).then(r => r.json()),
  });

  const mut = useMutation({
    mutationFn: ({ id, ...body }: any) => fetch(`/api/admin/feature-flags/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feature-flags"] }),
  });

  const tiers = ["free", "basic", "pro"];
  const tierBg = (t: string) => t==="pro"?"#A23B32":t==="basic"?"#2563eb":"#3D4B58";

  return (
    <Panel icon={<ToggleRight size={13} />} title="Feature Access Control" badge={`${flags.filter(f=>f.kill_switch).length} kill switches active`}>
      {isLoading ? <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div> : (
        <div className="divide-y divide-border">
          {flags.map(f => (
            <div key={f.id} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${f.kill_switch ? "bg-red-50/40" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">{f.label}</span>
                  {f.kill_switch && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-600">KILL SWITCH</span>}
                </div>
                <span className="text-[9px] text-muted-foreground font-mono">{f.key}</span>
              </div>

              {/* Min tier selector */}
              <div className="flex gap-1">
                {tiers.map(t => (
                  <button key={t} onClick={() => mut.mutate({id:f.id, min_tier:t})}
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold capitalize transition-all"
                    style={{background: f.min_tier===t ? tierBg(t) : "rgba(19,35,58,0.07)", color: f.min_tier===t ? "#fff" : "#3D4B58"}}>
                    {t}
                  </button>
                ))}
              </div>

              {/* Kill switch */}
              <button onClick={() => mut.mutate({id:f.id, kill_switch:!f.kill_switch})}
                title="Kill switch — disables feature for everyone"
                className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                {f.kill_switch ? <XCircle size={14} style={{color:"#ef4444"}} /> : <CheckCircle2 size={14} style={{color:"rgba(19,35,58,0.25)"}} />}
              </button>

              {/* Enable toggle */}
              <button onClick={() => mut.mutate({id:f.id, enabled:!f.enabled})} className="p-1">
                {f.enabled && !f.kill_switch ? <ToggleRight size={20} style={{color:"#22c55e"}} /> : <ToggleLeft size={20} style={{color:"#ef4444"}} />}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 py-2.5 text-[9px] text-muted-foreground border-t border-border">
        Min tier = lowest tier that can access. Kill switch = off for everyone regardless of tier.
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — API & Data Feed Monitor
// ══════════════════════════════════════════════════════════════════════════════
function ApiHealthPanel() {
  const qc = useQueryClient();
  const { data: health = [], isLoading, refetch } = useQuery<ApiHealth[]>({
    queryKey: ["admin-api-health"],
    queryFn: () => fetch("/api/admin/api-health", { headers: authHeaders() }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const pingMut = useMutation({
    mutationFn: (service: string) => fetch("/api/admin/api-health/ping", { method: "POST", headers: authHeaders(), body: JSON.stringify({ service }) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-api-health"] }),
  });

  const clearMut = useMutation({
    mutationFn: (service?: string) => fetch(`/api/admin/api-health/errors${service ? `?service=${service}` : ""}`, { method: "DELETE", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-api-health"] }),
  });

  const totalErrors = health.reduce((sum, h) => sum + (h.errors_24h ?? 0), 0);

  const services = [
    { key: "odds_api",       label: "Odds API",        desc: "Player props + lines",    note: null },
    { key: "espn",           label: "ESPN",            desc: "Scores + schedules",      note: null },
    { key: "mlb_stats",      label: "MLB Stats API",   desc: "Game logs + stats",       note: null },
    { key: "action_network", label: "Action Network",  desc: "Sharp money data",        note: "Sharp money + public betting percentages." },
    { key: "weather",        label: "Weather (wttr)",  desc: "MLB/NFL weather",         note: "May show 500 from Railway IP — data still works in-app" },
  ];

  const healthMap = Object.fromEntries(health.map(h => [h.service, h]));

  return (
    <Panel icon={<Wifi size={13} />} title="API & Data Feed Monitor" badge={`${health.filter(h=>h.status==="ok").length}/${services.length} healthy`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] text-muted-foreground">Click Ping to test a service live</p>
          <div className="flex items-center gap-2">
            {totalErrors > 0 && (
              <button
                onClick={() => clearMut.mutate(undefined)}
                disabled={clearMut.isPending}
                className="text-[10px] font-semibold flex items-center gap-1 px-2 py-1 rounded-full transition-all"
                style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", opacity: clearMut.isPending ? 0.5 : 1 }}>
                <X size={9} />{clearMut.isPending ? "Clearing…" : `Clear Errors (${totalErrors})`}
              </button>
            )}
            <button onClick={() => refetch()} className="text-[10px] font-semibold flex items-center gap-1 text-muted-foreground hover:text-foreground"><RefreshCw size={10} />Refresh</button>
          </div>
        </div>
        <div className="space-y-2">
          {services.map(svc => {
            const h = healthMap[svc.key];
            const pinging = pingMut.isPending && (pingMut.variables as any) === svc.key;
            const statusOk = h?.status === "ok";
            const statusErr = h?.status === "error";
            return (
              <div key={svc.key} className="flex items-center gap-3 p-3 rounded-xl border" style={{borderColor:"rgba(19,35,58,0.1)",background:"rgba(19,35,58,0.02)"}}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusOk?"bg-green-400":statusErr?"bg-red-400":"bg-gray-300"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground">{svc.label}</p>
                  <p className="text-[10px] text-muted-foreground">{svc.desc}
                    {h && <> · <span style={{color:statusOk?"#22c55e":"#ef4444"}}>{statusOk?`${h.latency_ms}ms`:h.error??h.status}</span></>}
                    {h?.errors_24h ? <span className="text-red-500"> · {h.errors_24h} errors/24h</span> : null}
                    {h?.ts && <> · {fmtRelative(h.ts)}</>}
                  </p>
                </div>
                <button onClick={() => pingMut.mutate(svc.key)} disabled={pinging}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all flex items-center gap-1"
                  style={{background:"rgba(19,35,58,0.08)",color:"#131A24",opacity:pinging?0.5:1}}>
                  <Activity size={9} />{pinging?"…":"Ping"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Analytics
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsPanel() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin-analytics"],
    queryFn: () => fetch("/api/admin/analytics", { headers: authHeaders() }).then(r => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Panel icon={<BarChart2 size={13} />} title="Analytics" defaultOpen={false}>
      {isLoading ? <div className="py-8 text-center text-xs text-muted-foreground">Loading analytics…</div> : !data ? <div className="py-4 text-center text-xs text-red-500">Failed to load</div> : (
        <div className="p-4 space-y-5">
          {/* Revenue */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1"><DollarSign size={10} />Revenue</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-xl p-3">
                <p className="text-[10px] font-bold text-muted-foreground">Est. MRR</p>
                <p className="text-xl font-black text-foreground">${data.mrr}</p>
                <p className="text-[9px] text-muted-foreground">Basic + Pro active</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3">
                <p className="text-[10px] font-bold text-muted-foreground">Revenue (30d)</p>
                <p className="text-xl font-black text-foreground">${data.stripe_revenue_30d?.toFixed(2) ?? "—"}</p>
                <p className="text-[9px] text-muted-foreground">Via Stripe</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3">
                <p className="text-[10px] font-bold text-muted-foreground">Refunds (30d)</p>
                <p className="text-xl font-black text-foreground">${data.stripe_refunds_30d?.toFixed(2) ?? "—"}</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3">
                <p className="text-[10px] font-bold text-muted-foreground">Churn (30d)</p>
                <p className="text-xl font-black text-foreground">{data.churn_30d ?? 0}</p>
                <p className="text-[9px] text-muted-foreground">Cancelled subs</p>
              </div>
            </div>
          </div>

          {/* Conversion funnel */}
          {data.funnel && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1"><TrendingUp size={10} />Conversion Funnel</p>
              <div className="space-y-1.5">
                {[
                  { label: "Free", count: parseInt(data.funnel.free_count), color: "#3D4B58" },
                  { label: "Basic", count: parseInt(data.funnel.basic_count), color: "#2563eb" },
                  { label: "Pro",   count: parseInt(data.funnel.pro_count),   color: "#A23B32" },
                ].map(f => {
                  const total = parseInt(data.funnel.free_count) + parseInt(data.funnel.basic_count) + parseInt(data.funnel.pro_count) || 1;
                  return (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold w-8" style={{color:f.color}}>{f.label}</span>
                      <div className="flex-1 h-2 rounded-full" style={{background:"rgba(19,35,58,0.08)"}}>
                        <div className="h-full rounded-full" style={{width:`${(f.count/total)*100}%`,background:f.color}} />
                      </div>
                      <span className="text-[10px] font-bold text-foreground w-8 text-right">{f.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab usage */}
          {data.tabUsage?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1"><Activity size={10} />Tab Usage (7 days)</p>
              <div className="space-y-1">
                {data.tabUsage.map((t: any, i: number) => {
                  const maxViews = data.tabUsage[0].views;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground w-24 capitalize truncate">{t.page.replace(/_/g," ")}</span>
                      <div className="flex-1 h-1.5 rounded-full" style={{background:"rgba(19,35,58,0.08)"}}>
                        <div className="h-full rounded-full" style={{width:`${(t.views/maxViews)*100}%`,background:"#A23B32"}} />
                      </div>
                      <span className="text-[10px] font-bold text-muted-foreground w-6 text-right">{t.views}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] text-muted-foreground mt-2">Tracking starts after next redeploy.</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Notifications & Messaging
// ══════════════════════════════════════════════════════════════════════════════
function MessagingPanel() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tiers, setTiers] = useState<string[]>(["free","basic","pro"]);
  const [announce, setAnnounce] = useState("");
  const [announceType, setAnnounceType] = useState<"info"|"warning"|"success">("info");
  const [blastResult, setBlastResult] = useState<string|null>(null);

  const blastMut = useMutation({
    mutationFn: () => fetch("/api/admin/send-blast", { method: "POST", headers: authHeaders(), body: JSON.stringify({ subject, body, tiers }) }).then(r => r.json()),
    onSuccess: (d) => { setBlastResult(d.sent ? `Sent to ${d.sent} users` : d.error ?? "Done"); setSubject(""); setBody(""); },
  });

  const announceMut = useMutation({
    mutationFn: (msg: string|null) => fetch("/api/admin/announcement", { method: "POST", headers: authHeaders(), body: JSON.stringify({ message: msg, type: announceType }) }).then(r => r.json()),
  });

  const toggleTier = (t: string) => setTiers(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t]);

  return (
    <Panel icon={<Megaphone size={13} />} title="Notifications & Messaging">
      <div className="p-4 space-y-5">
        {/* In-app announcement */}
        <div>
          <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5"><Bell size={12} />In-App Announcement Banner</p>
          <div className="flex gap-2 mb-2">
            {(["info","warning","success"] as const).map(t => (
              <button key={t} onClick={() => setAnnounceType(t)}
                className="px-2.5 py-1 rounded-full text-[10px] font-bold capitalize"
                style={{background: announceType===t?"#131A24":"rgba(19,35,58,0.08)", color: announceType===t?"#F6F1E7":"#3D4B58"}}>
                {t}
              </button>
            ))}
          </div>
          <textarea value={announce} onChange={e => setAnnounce(e.target.value)} rows={2}
            placeholder="Announcement message (shown to all users)…"
            className="w-full px-3 py-2 rounded-xl border text-xs outline-none resize-none"
            style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <div className="flex gap-2 mt-2">
            <button onClick={() => announceMut.mutate(announce || null)} disabled={announceMut.isPending || !announce.trim()}
              className="flex-1 py-2 rounded-xl text-xs font-bold text-white" style={{background:"#131A24",opacity:(!announce.trim()||announceMut.isPending)?0.5:1}}>
              {announceMut.isPending ? "Posting…" : "Post Announcement"}
            </button>
            <button onClick={() => { setAnnounce(""); announceMut.mutate(null); }}
              className="px-4 py-2 rounded-xl text-xs font-semibold" style={{background:"rgba(239,68,68,0.1)",color:"#ef4444"}}>
              Clear
            </button>
          </div>
        </div>

        <div className="h-px" style={{background:"rgba(19,35,58,0.1)"}} />

        {/* Email blast */}
        <div>
          <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5"><Send size={12} />Email Blast</p>
          <div className="flex gap-2 mb-2 flex-wrap">
            {["free","basic","pro"].map(t => (
              <button key={t} onClick={() => toggleTier(t)}
                className="px-2.5 py-1 rounded-full text-[10px] font-bold capitalize"
                style={{background: tiers.includes(t) ? tierColor(t==="free"?null:t).bg : "rgba(19,35,58,0.08)", color: tiers.includes(t) ? "#fff" : "#3D4B58"}}>
                {t}
              </button>
            ))}
          </div>
          <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject line…"
            className="w-full px-3 py-2 rounded-xl border text-xs outline-none mb-2"
            style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          <textarea value={body} onChange={e=>setBody(e.target.value)} rows={4}
            placeholder="Email body…"
            className="w-full px-3 py-2 rounded-xl border text-xs outline-none resize-none"
            style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
          {blastResult && <p className="text-xs font-semibold mt-1" style={{color:"#22c55e"}}>{blastResult}</p>}
          <button onClick={() => blastMut.mutate()} disabled={blastMut.isPending || !subject.trim() || !body.trim() || !tiers.length}
            className="w-full mt-2 py-2 rounded-xl text-xs font-bold text-white"
            style={{background:"#131A24",opacity:(blastMut.isPending||!subject.trim()||!body.trim())?0.5:1}}>
            {blastMut.isPending ? "Sending…" : `Send to ${tiers.join(", ")} users`}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Deployment & Version Control
// ══════════════════════════════════════════════════════════════════════════════
function DeploymentPanel() {
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["admin-deployment"],
    queryFn: () => fetch("/api/admin/deployment", { headers: authHeaders() }).then(r => r.json()),
  });

  return (
    <Panel icon={<GitBranch size={13} />} title="Deployment & Version">
      {isLoading ? <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div> : !data ? <div className="py-4 text-center text-xs text-red-500">Failed to load</div> : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border" style={{borderColor:"rgba(19,35,58,0.1)"}}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Commit</p>
              <p className="text-sm font-black font-mono text-foreground mt-0.5">{data.git_sha_short ?? "Unknown"}</p>
              <p className="text-[9px] text-muted-foreground">Branch: {data.branch}</p>
            </div>
            <div className="p-3 rounded-xl border" style={{borderColor:"rgba(19,35,58,0.1)"}}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Build Time</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{data.deployed_at ? fmtRelative(data.deployed_at) : "Unknown"}</p>
              <p className="text-[9px] text-muted-foreground">{data.deployed_at ? fmtDate(data.deployed_at) : "—"}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a href={data.github_url} target="_blank" rel="noopener noreferrer"
              className="flex-1 py-2 rounded-xl text-[10px] font-bold text-center border transition-colors hover:bg-muted/30"
              style={{borderColor:"rgba(19,35,58,0.15)",color:"#131A24"}}>
              GitHub Commit ↗
            </a>
            <a href={data.railway_url} target="_blank" rel="noopener noreferrer"
              className="flex-1 py-2 rounded-xl text-[10px] font-bold text-center border transition-colors hover:bg-muted/30"
              style={{borderColor:"rgba(19,35,58,0.15)",color:"#131A24"}}>
              Railway Dashboard ↗
            </a>
            <a href={data.app_url} target="_blank" rel="noopener noreferrer"
              className="flex-1 py-2 rounded-xl text-[10px] font-bold text-center border transition-colors hover:bg-muted/30"
              style={{borderColor:"rgba(19,35,58,0.15)",color:"#131A24"}}>
              Live App ↗
            </a>
          </div>
          <button onClick={() => refetch()} className="text-[10px] text-muted-foreground flex items-center gap-1 hover:text-foreground"><RefreshCw size={10} />Refresh</button>
        </div>
      )}
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — System Settings
// ══════════════════════════════════════════════════════════════════════════════
function SystemSettingsPanel() {
  const qc = useQueryClient();
  const { data: apiKeys } = useQuery<Record<string,string>>({
    queryKey: ["admin-api-keys"],
    queryFn: () => fetch("/api/admin/api-keys", { headers: authHeaders() }).then(r => r.json()),
  });
  const { data: auditLog = [], isLoading: auditLoading } = useQuery<AuditEntry[]>({
    queryKey: ["admin-audit-log"],
    queryFn: () => fetch("/api/admin/audit-log?limit=50", { headers: authHeaders() }).then(r => r.json()),
  });
  const [oddsKey, setOddsKey] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [showAudit, setShowAudit] = useState(false);

  const keysMut = useMutation({
    mutationFn: (body: any) => fetch("/api/admin/api-keys", { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-api-keys"] }),
  });

  return (
    <Panel icon={<Settings size={13} />} title="System Settings">
      <div className="p-4 space-y-5">
        {/* API Keys */}
        <div>
          <p className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5"><Shield size={12} />API Keys</p>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Odds API Key</label>
              <div className="flex gap-2">
                <input value={oddsKey} onChange={e=>setOddsKey(e.target.value)}
                  placeholder={apiKeys?.odds_api_key ?? "Not set"}
                  className="flex-1 px-3 py-2 rounded-xl border text-xs font-mono outline-none"
                  style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
                <button onClick={() => oddsKey && keysMut.mutate({odds_api_key:oddsKey})}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-white" style={{background:"#131A24"}}><Save size={12}/></button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Action Network Key</label>
              <div className="flex gap-2">
                <input value={actionKey} onChange={e=>setActionKey(e.target.value)}
                  placeholder={apiKeys?.action_network_key ?? "Not set"}
                  className="flex-1 px-3 py-2 rounded-xl border text-xs font-mono outline-none"
                  style={{background:"#F6F1E7",borderColor:"rgba(19,35,58,0.2)",color:"#131A24"}} />
                <button onClick={() => actionKey && keysMut.mutate({action_network_key:actionKey})}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-white" style={{background:"#131A24"}}><Save size={12}/></button>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px" style={{background:"rgba(19,35,58,0.1)"}} />

        {/* Audit Log */}
        <div>
          <button onClick={() => setShowAudit(o=>!o)} className="w-full flex items-center gap-2 text-xs font-bold text-foreground">
            <History size={12} />Audit Log (Last 50)
            {showAudit ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
          </button>
          {showAudit && (
            <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
              {auditLoading ? <p className="text-xs text-muted-foreground text-center py-4">Loading…</p> :
               auditLog.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No audit entries yet.</p> :
               auditLog.map(e => (
                <div key={e.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/30 text-[9px]">
                  <span className="text-muted-foreground whitespace-nowrap">{fmtRelative(e.ts)}</span>
                  <span className="font-bold text-foreground capitalize">{e.action.replace(/_/g," ")}</span>
                  {e.target && <span className="text-muted-foreground">→ #{e.target}</span>}
                  {e.detail && <span className="text-muted-foreground truncate">{e.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
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
    <div className="space-y-4 max-w-4xl mx-auto pb-10">

      {/* Header */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <Crown size={18} style={{ color: "#A23B32" }} /> App Insights
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Owner dashboard · {dataUpdatedAt ? `Updated ${fmtRelative(new Date(dataUpdatedAt).toISOString())}` : "Loading…"}
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

      {/* Dev Account */}
      {data?.ownerAccount && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2" style={{ background: "rgba(162,59,50,0.06)" }}>
            <Crown size={13} style={{ color: "#A23B32" }} />
            <p className="text-xs font-bold text-foreground">Dev Account</p>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold text-white" style={{ background: "#A23B32" }}>Owner</span>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</p><p className="text-sm font-semibold text-foreground truncate mt-0.5">{data.ownerAccount.email}</p></div>
            <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Logins</p><p className="text-2xl font-black text-foreground mt-0.5">{data.ownerAccount.loginCount}</p></div>
            <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Active</p><p className="text-sm font-semibold text-foreground mt-0.5">{fmtRelative(data.ownerAccount.lastActive)}</p></div>
            <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Login</p><p className="text-sm font-semibold text-foreground mt-0.5">{fmtRelative(data.ownerAccount.lastLogin)}</p></div>
          </div>
        </div>
      )}

      {/* Key Stats */}
      {data && (
        <>
          <SectionDivider label="User Stats" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Users size={16}/>}    label="Total Users"    value={t!.allUsers}       sub="Registered"         color="#131A24" />
            <StatCard icon={<Crown size={16}/>}    label="Paying Subs"    value={totalPaying}        sub="Active Basic + Pro" color="#A23B32" />
            <StatCard icon={<Activity size={16}/>} label="Active Today"   value={t!.activeToday}     sub="Last 24 hours"      color="#22c55e" />
            <StatCard icon={<UserPlus size={16}/>} label="New This Week"  value={t!.newThisWeek}     sub="Signed up"          color="#2563eb" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<UserCheck size={16}/>} label="Active (7d)"    value={t!.activeThisWeek}  sub="Unique"             color="#7c3aed" />
            <StatCard icon={<UserCheck size={16}/>} label="Active (30d)"   value={t!.activeThisMonth} sub="Unique"             color="#0891b2" />
            <StatCard icon={<LogIn size={16}/>}     label="Avg Logins"     value={t!.avgLoginsPerUser||"—"} sub="Per user"    color="#d97706" />
            <StatCard icon={<UserPlus size={16}/>}  label="New This Month" value={t!.newThisMonth}    sub="Signed up"          color="#059669" />
          </div>

          {/* Tier breakdown */}
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Subscribers by Tier</p>
            <div className="grid grid-cols-3 gap-3">
              {(["free","basic","pro"] as const).map(tier => {
                const tc = tierColor(tier);
                const d  = tiers[tier] ?? { active:0, inactive:0, cancelled:0 };
                return (
                  <div key={tier} className="rounded-xl p-3 border" style={{borderColor:`${tc.bg}30`,background:`${tc.bg}08`}}>
                    <div className="flex items-center gap-1.5 mb-2">
                      {tier==="pro"&&<Crown size={13} style={{color:tc.bg}}/>}{tier==="basic"&&<Star size={13} style={{color:tc.bg}}/>}{tier==="free"&&<Zap size={13} style={{color:tc.bg}}/>}
                      <span className="text-xs font-black" style={{color:tc.bg}}>{tc.label}</span>
                    </div>
                    <p className="text-3xl font-black text-foreground leading-none">{d.active+d.inactive+d.cancelled}</p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[10px]"><span className="text-foreground/50">Active</span><span className="font-bold" style={{color:"#22c55e"}}>{d.active}</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-foreground/50">Pending</span><span className="font-bold" style={{color:"#f59e0b"}}>{d.inactive}</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-foreground/50">Cancelled</span><span className="font-bold" style={{color:"#ef4444"}}>{d.cancelled}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trend charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><UserPlus size={13} style={{color:"#2563eb"}}/><p className="text-xs font-bold text-foreground">Signups (30 Days)</p></div>
              <SparkBar data={data.signupTrend} color="#2563eb" />
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><Activity size={13} style={{color:"#22c55e"}}/><p className="text-xs font-bold text-foreground">Daily Active (14 Days)</p></div>
              <SparkBar data={data.dauTrend} color="#22c55e" />
            </div>
          </div>

          {/* Top users */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <TrendingUp size={13} style={{color:"#A23B32"}}/><p className="text-xs font-bold text-foreground">Most Active Users</p>
              <span className="ml-auto text-[10px] text-muted-foreground">Top {data.topUsers.length} by logins</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase">Email</th>
                  <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase">Plan</th>
                  <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase">Logins</th>
                  <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase">Last Active</th>
                </tr></thead>
                <tbody>
                  {data.topUsers.length===0 && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No users yet</td></tr>}
                  {data.topUsers.map((u,i) => {
                    const tc = tierColor(u.tier);
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[180px]">{u.email}</td>
                        <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold" style={{background:tc.bg}}>{tc.label}</span></td>
                        <td className="px-3 py-2.5 text-center font-bold text-foreground">{u.loginCount}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{fmtRelative(u.lastActive)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Owner Tools ── */}
      <SectionDivider label="Owner Tools" />

      <DevCodePanel />
      <PromoCodesPanel />
      <TrialCodesPanel />

      <SectionDivider label="User & Subscription Control" />
      <UserManagementPanel />

      <SectionDivider label="Feature Access Control" />
      <FeatureFlagsPanel />

      <SectionDivider label="API & Data Feeds" />
      <ApiHealthPanel />

      <SectionDivider label="Analytics" />
      <AnalyticsPanel />

      <SectionDivider label="Notifications & Messaging" />
      <MessagingPanel />

      <SectionDivider label="Deployment" />
      <DeploymentPanel />

      <SectionDivider label="System Settings" />
      <SystemSettingsPanel />

      {data && (
        <p className="text-[10px] text-center text-muted-foreground pb-4">
          Stats refresh every 5 min · Generated {new Date(data.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT
        </p>
      )}
    </div>
  );
}
