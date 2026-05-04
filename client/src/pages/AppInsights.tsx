/**
 * AppInsights — Owner-only dashboard showing subscriber stats, activity, and user data.
 * Accessible only to is_owner=true accounts. Blocked at both route and API level.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import {
  Users, TrendingUp, Activity, Crown, Star, Zap,
  RefreshCw, Calendar, LogIn, UserCheck, UserPlus,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────
interface InsightsData {
  generatedAt: string;
  totals: {
    allUsers: number;
    activeSubscribers: number;
    activeToday: number;
    activeThisWeek: number;
    activeThisMonth: number;
    newThisWeek: number;
    newThisMonth: number;
    avgLoginsPerUser: number;
  };
  tiers: Record<string, { active: number; inactive: number; cancelled: number }>;
  topUsers: {
    email: string;
    tier: string | null;
    subStatus: string;
    loginCount: number;
    lastLogin: string | null;
    lastActive: string | null;
    joinedAt: string;
  }[];
  signupTrend: { day: string; count: number }[];
  dauTrend: { day: string; count: number }[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

// Simple sparkline bar chart
function SparkBar({ data, color = "#A23B32" }: { data: { day: string; count: number }[]; color?: string }) {
  if (!data.length) return <p className="text-xs text-foreground/40 py-2">No data yet</p>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-[3px] h-12 mt-2">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
          <div
            className="w-full rounded-sm transition-all"
            style={{ height: `${Math.max(4, (d.count / max) * 44)}px`, background: color, opacity: 0.8 }}
          />
          <div className="absolute bottom-full mb-1 hidden group-hover:flex bg-foreground text-background text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
            {d.day}: {d.count}
          </div>
        </div>
      ))}
    </div>
  );
}

// Stat card
function StatCard({ icon, label, value, sub, color = "#131A24" }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string;
}) {
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

// ─── main component ───────────────────────────────────────────────────────────
export default function AppInsights() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  // Hard redirect if not owner — belt-and-suspenders on top of route guard
  if (user && !user.isOwner) {
    navigate("/");
    return null;
  }

  const token = localStorage.getItem("ciq_token");

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<InsightsData>({
    queryKey: ["admin-insights"],
    queryFn: async () => {
      const res = await fetch("/api/admin/insights", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load insights");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
    staleTime: 60 * 1000,
  });

  const t = data?.totals;
  const tiers = data?.tiers ?? {};

  const totalPaying = (tiers.basic?.active ?? 0) + (tiers.pro?.active ?? 0);
  const totalFree   = tiers.free?.active ?? 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <Crown size={18} style={{ color: "#A23B32" }} />
            App Insights
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Owner view · {dataUpdatedAt ? `Updated ${fmtRelative(new Date(dataUpdatedAt).toISOString())}` : "Loading..."}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all active:scale-95"
          style={{ borderColor: "rgba(19,35,58,0.15)", color: "#131A24", opacity: isFetching ? 0.5 : 1 }}
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={24} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Failed to load insights. Make sure you're logged in as owner.
        </div>
      )}

      {data && (
        <>
          {/* ── Key Stats ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Users size={16} />}    label="Total Users"        value={t!.allUsers}           sub="Excluding owner"      color="#131A24" />
            <StatCard icon={<Crown size={16} />}    label="Paying Subs"        value={totalPaying}            sub="Active Basic + Pro"   color="#A23B32" />
            <StatCard icon={<Activity size={16} />} label="Active Today"       value={t!.activeToday}         sub="Last 24 hours"        color="#22c55e" />
            <StatCard icon={<UserPlus size={16} />} label="New This Week"      value={t!.newThisWeek}         sub="Signed up"            color="#2563eb" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<UserCheck size={16} />} label="Active (7d)"       value={t!.activeThisWeek}      sub="Unique active users"  color="#7c3aed" />
            <StatCard icon={<UserCheck size={16} />} label="Active (30d)"      value={t!.activeThisMonth}     sub="Unique active users"  color="#0891b2" />
            <StatCard icon={<LogIn size={16} />}     label="Avg Logins"        value={t!.avgLoginsPerUser || "—"} sub="Per user lifetime" color="#d97706" />
            <StatCard icon={<UserPlus size={16} />}  label="New This Month"    value={t!.newThisMonth}        sub="Signed up"            color="#059669" />
          </div>

          {/* ── Tier Breakdown ── */}
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Subscribers by Tier</p>
            <div className="grid grid-cols-3 gap-3">
              {(["free", "basic", "pro"] as const).map(tier => {
                const tc = tierColor(tier);
                const d  = tiers[tier] ?? { active: 0, inactive: 0, cancelled: 0 };
                const total = d.active + d.inactive + d.cancelled;
                return (
                  <div key={tier} className="rounded-xl p-3 border" style={{ borderColor: `${tc.bg}30`, background: `${tc.bg}08` }}>
                    <div className="flex items-center gap-1.5 mb-2">
                      {tier === "pro"   && <Crown size={13} style={{ color: tc.bg }} />}
                      {tier === "basic" && <Star  size={13} style={{ color: tc.bg }} />}
                      {tier === "free"  && <Zap   size={13} style={{ color: tc.bg }} />}
                      <span className="text-xs font-black" style={{ color: tc.bg }}>{tc.label}</span>
                    </div>
                    <p className="text-3xl font-black text-foreground leading-none">{total}</p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-foreground/50">Active</span>
                        <span className="font-bold" style={{ color: "#22c55e" }}>{d.active}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-foreground/50">Pending</span>
                        <span className="font-bold" style={{ color: "#f59e0b" }}>{d.inactive}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-foreground/50">Cancelled</span>
                        <span className="font-bold" style={{ color: "#ef4444" }}>{d.cancelled}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Trend Charts ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <UserPlus size={13} style={{ color: "#2563eb" }} />
                <p className="text-xs font-bold text-foreground">Signups (Last 30 Days)</p>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1">{t!.newThisMonth} total this month</p>
              <SparkBar data={data.signupTrend} color="#2563eb" />
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={13} style={{ color: "#22c55e" }} />
                <p className="text-xs font-bold text-foreground">Daily Active Users (Last 14 Days)</p>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1">{t!.activeToday} active today</p>
              <SparkBar data={data.dauTrend} color="#22c55e" />
            </div>
          </div>

          {/* ── User Table ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <TrendingUp size={13} style={{ color: "#A23B32" }} />
              <p className="text-xs font-bold text-foreground">Most Active Users</p>
              <span className="ml-auto text-[10px] text-muted-foreground">Top {data.topUsers.length} by login count</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Plan</th>
                    <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-center px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Logins</th>
                    <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Active</th>
                    <th className="text-right px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">No users yet</td>
                    </tr>
                  )}
                  {data.topUsers.map((u, i) => {
                    const tc = tierColor(u.tier);
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[180px]">{u.email}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold"
                            style={{ background: tc.bg }}>{tc.label}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-[10px] font-semibold capitalize" style={{ color: statusColor(u.subStatus) }}>
                            {u.subStatus}
                          </span>
                        </td>
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

          {/* Footer */}
          <p className="text-[10px] text-center text-muted-foreground">
            Data refreshes every 5 minutes · Generated {new Date(data.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT
          </p>
        </>
      )}
    </div>
  );
}
