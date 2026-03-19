/**
 * Account page — shows user profile, bankroll, and tracked bets with W/L tracking.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UserBet } from "@shared/schema";
import {
  User, LogOut, TrendingUp, TrendingDown, Minus,
  DollarSign, BarChart2, CheckCircle, XCircle, Clock,
  Trash2, Edit2, ChevronRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const RESULT_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  open:  { label: "Open",   color: "#f59e0b", icon: Clock },
  won:   { label: "Won",    color: "#4ade80", icon: CheckCircle },
  lost:  { label: "Lost",   color: "#f87171", icon: XCircle },
};

export default function Account() {
  const { user, token, logout, isLoggedIn } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editingBetId, setEditingBetId] = useState<string | null>(null);
  const [editStake, setEditStake] = useState("");
  const [editResult, setEditResult] = useState<"open" | "won" | "lost">("open");
  const [editNotes, setEditNotes] = useState("");

  // Redirect to auth if not logged in
  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)" }}>
          <User size={22} style={{ color: "#a78bfa" }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-white/80">Sign in to track your bets</p>
          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            Create an account to save picks and monitor results.
          </p>
        </div>
        <button
          data-testid="button-goto-auth"
          onClick={() => navigate("/auth")}
          className="px-5 py-2.5 rounded-lg font-bold text-sm transition-all"
          style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "white", boxShadow: "0 4px 16px rgba(124,58,237,0.35)" }}>
          Sign In / Create Account
        </button>
      </div>
    );
  }

  const { data: userBets = [], isLoading: betsLoading } = useQuery<UserBet[]>({
    queryKey: ["/api/user/bets"],
    queryFn: () =>
      apiRequest("GET", "/api/user/bets", undefined, token!)
        .then(r => r.json()),
    enabled: !!token,
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/user/bets/${id}`, undefined, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/bets"] });
      toast({ title: "Bet removed" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; stake?: number | null; result?: string; notes?: string }) =>
      apiRequest("PATCH", `/api/user/bets/${id}`, data, token!).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/bets"] });
      setEditingBetId(null);
      toast({ title: "Bet updated" });
    },
  });

  function startEdit(ub: UserBet) {
    setEditingBetId(ub.id);
    setEditStake(ub.stake != null ? String(ub.stake) : "");
    setEditResult((ub.result as "open" | "won" | "lost") ?? "open");
    setEditNotes(ub.notes ?? "");
  }

  function saveEdit(id: string) {
    updateMutation.mutate({
      id,
      stake: editStake ? parseFloat(editStake) : null,
      result: editResult,
      notes: editNotes || null,
    });
  }

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  // Stats
  const won = userBets.filter(b => b.result === "won").length;
  const lost = userBets.filter(b => b.result === "lost").length;
  const open = userBets.filter(b => b.result === "open").length;
  const total = userBets.length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  const totalStaked = userBets.reduce((s, b) => s + (b.stake ?? 0), 0);
  const wonAmount = userBets.filter(b => b.result === "won").reduce((s, b) => s + (b.stake ?? 0), 0);
  const lostAmount = userBets.filter(b => b.result === "lost").reduce((s, b) => s + (b.stake ?? 0), 0);

  const statCard = (label: string, value: string | number, sub?: string, color?: string) => (
    <div className="rounded-xl p-3 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-xl font-black font-mono leading-none" style={{ color: color ?? "hsl(45 100% 90%)" }}>{value}</p>
      {sub && <p className="text-[9px] font-semibold mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{sub}</p>}
      <p className="text-[10px] font-semibold uppercase tracking-wide mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-8">
      {/* Profile header */}
      <div className="rounded-2xl p-5"
        style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)" }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "white" }}>
            {(user?.displayName ?? user?.username ?? "?")[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base text-white leading-tight">
              {user?.displayName ?? user?.username}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>@{user?.username}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{user?.email}</p>
          </div>
          <button
            data-testid="button-logout"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <LogOut size={12} /> Sign out
          </button>
        </div>

        {/* Bankroll */}
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <DollarSign size={13} style={{ color: "#f59e0b" }} />
          <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>Bankroll</span>
          <span className="ml-auto font-black font-mono text-sm" style={{ color: "#f59e0b" }}>
            ${(user?.bankroll ?? 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "rgba(255,255,255,0.35)" }}>
          Bet Tracking Summary
        </p>
        <div className="grid grid-cols-4 gap-2">
          {statCard("Tracked", total)}
          {statCard("Won", won, undefined, "#4ade80")}
          {statCard("Lost", lost, undefined, "#f87171")}
          {statCard("Win Rate", winRate != null ? `${winRate}%` : "—", `${won}W / ${lost}L`, winRate != null && winRate >= 55 ? "#4ade80" : winRate != null && winRate >= 40 ? "#f59e0b" : "#f87171")}
        </div>
        {totalStaked > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {statCard("Staked", `$${totalStaked.toFixed(0)}`)}
            {statCard("On Won Bets", `$${wonAmount.toFixed(0)}`, undefined, "#4ade80")}
            {statCard("On Lost Bets", `$${lostAmount.toFixed(0)}`, undefined, "#f87171")}
          </div>
        )}
      </div>

      {/* Tracked bets list */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 size={13} style={{ color: "#a78bfa" }} />
          <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.6)" }}>
            Tracked Picks {open > 0 && <span style={{ color: "#f59e0b" }}>({open} open)</span>}
          </span>
        </div>

        {betsLoading && (
          <div className="flex justify-center py-8 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
            Loading your picks...
          </div>
        )}

        {!betsLoading && userBets.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 rounded-xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <BarChart2 size={24} style={{ color: "rgba(255,255,255,0.2)" }} />
            <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>No tracked picks yet</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
              Click "Track this pick" on any bet card to add it here.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {userBets.map(ub => {
            const cfg = RESULT_CONFIG[ub.result ?? "open"] ?? RESULT_CONFIG.open;
            const Icon = cfg.icon;
            const isEditing = editingBetId === ub.id;

            return (
              <div key={ub.id}
                className="rounded-xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <Icon size={14} style={{ color: cfg.color, flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold leading-tight truncate" style={{ color: "hsl(45 100% 90%)" }}>
                      {ub.betSlug?.replace(/-[a-z0-9]{6}$/, "").replace(/-/g, " ") ?? `Bet #${ub.id.slice(0, 6)}`}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
                        {cfg.label}
                      </span>
                      {ub.stake != null && (
                        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                          Stake: ${ub.stake}
                        </span>
                      )}
                      {ub.notes && (
                        <span className="text-[10px] truncate max-w-24" style={{ color: "rgba(255,255,255,0.3)" }}>
                          {ub.notes}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      data-testid={`button-edit-bet-${ub.id}`}
                      onClick={() => isEditing ? setEditingBetId(null) : startEdit(ub)}
                      className="p-1.5 rounded-lg hover:bg-white/8 transition-colors"
                      style={{ color: "rgba(255,255,255,0.35)" }}>
                      <Edit2 size={12} />
                    </button>
                    <button
                      data-testid={`button-delete-bet-${ub.id}`}
                      onClick={() => deleteMutation.mutate(ub.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      style={{ color: "rgba(248,113,113,0.5)" }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Inline edit panel */}
                {isEditing && (
                  <div className="px-4 pb-4 pt-0 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex gap-2 mt-3">
                      {(["open", "won", "lost"] as const).map(r => (
                        <button
                          key={r}
                          data-testid={`button-result-${r}`}
                          onClick={() => setEditResult(r)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                          style={{
                            background: editResult === r ? `${RESULT_CONFIG[r].color}20` : "rgba(255,255,255,0.04)",
                            border: `1px solid ${editResult === r ? RESULT_CONFIG[r].color + "40" : "rgba(255,255,255,0.08)"}`,
                            color: editResult === r ? RESULT_CONFIG[r].color : "rgba(255,255,255,0.4)",
                          }}>
                          {RESULT_CONFIG[r].label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <input
                          data-testid={`input-stake-${ub.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Stake ($)"
                          value={editStake}
                          onChange={e => setEditStake(e.target.value)}
                          className="w-full rounded-lg px-3 py-1.5 text-xs outline-none bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-violet-500/50"
                        />
                      </div>
                      <div className="flex-[2]">
                        <input
                          data-testid={`input-notes-${ub.id}`}
                          type="text"
                          placeholder="Notes..."
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          className="w-full rounded-lg px-3 py-1.5 text-xs outline-none bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-violet-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        data-testid={`button-save-edit-${ub.id}`}
                        onClick={() => saveEdit(ub.id)}
                        disabled={updateMutation.isPending}
                        className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                        style={{ background: "rgba(124,58,237,0.3)", border: "1px solid rgba(124,58,237,0.5)", color: "#a78bfa" }}>
                        Save
                      </button>
                      <button
                        onClick={() => setEditingBetId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
