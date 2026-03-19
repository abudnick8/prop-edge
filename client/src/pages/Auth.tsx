/**
 * Auth page — Login + Register in a tabbed modal-style card.
 * Uses PropEdge dark theme — no external deps beyond what's already installed.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Auth() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [, navigate] = useLocation();
  const { login, register } = useAuth();
  const { toast } = useToast();

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Register form
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    try {
      await login(loginEmail.trim(), loginPassword);
      navigate("/");
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!regEmail.trim() || !regUsername.trim() || !regPassword.trim()) {
      toast({ title: "Missing fields", description: "Email, username, and password are required.", variant: "destructive" });
      return;
    }
    setRegLoading(true);
    try {
      await register(regEmail.trim(), regUsername.trim(), regPassword, regDisplayName.trim() || undefined);
      navigate("/");
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setRegLoading(false);
    }
  }

  const inputClass = "w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all"
    + " bg-white/5 border border-white/10 text-white placeholder:text-white/30"
    + " focus:border-violet-500/60 focus:bg-white/8 focus:ring-2 focus:ring-violet-500/20";

  const tabActive = "px-4 py-2 text-sm font-bold rounded-lg transition-all bg-white/8 border border-white/12 text-white";
  const tabInactive = "px-4 py-2 text-sm font-semibold rounded-lg transition-all text-white/40 hover:text-white/70";

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, hsl(240 14% 7%) 0%, hsl(260 18% 9%) 100%)" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}>
            <span className="text-white font-black text-sm">P</span>
          </div>
          <span className="font-black text-lg tracking-tight text-white">PropEdge</span>
        </div>

        {/* Card */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}>
          {/* Tabs */}
          <div className="flex items-center gap-1 p-1.5" style={{ background: "rgba(0,0,0,0.2)" }}>
            <button
              data-testid="tab-login"
              className={tab === "login" ? tabActive : tabInactive}
              onClick={() => setTab("login")}
            >
              <LogIn size={13} className="inline mr-1.5 -mt-0.5" />
              Sign In
            </button>
            <button
              data-testid="tab-register"
              className={tab === "register" ? tabActive : tabInactive}
              onClick={() => setTab("register")}
            >
              <UserPlus size={13} className="inline mr-1.5 -mt-0.5" />
              Create Account
            </button>
          </div>

          <div className="p-5">
            {tab === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Email</label>
                  <input
                    data-testid="input-login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Password</label>
                  <div className="relative">
                    <input
                      data-testid="input-login-password"
                      type={showLoginPw ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      className={inputClass + " pr-10"}
                      required
                    />
                    <button type="button" tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                      onClick={() => setShowLoginPw(o => !o)}>
                      {showLoginPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <button
                  data-testid="button-login-submit"
                  type="submit"
                  disabled={loginLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "white", boxShadow: "0 4px 16px rgba(124,58,237,0.35)" }}>
                  {loginLoading ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                  Sign In
                </button>
                <p className="text-center text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                  No account?{" "}
                  <button type="button" className="underline hover:text-white/60 transition-colors"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                    onClick={() => setTab("register")}>
                    Create one
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                      style={{ color: "rgba(255,255,255,0.4)" }}>Username</label>
                    <input
                      data-testid="input-reg-username"
                      type="text"
                      autoComplete="username"
                      placeholder="sharpbettor"
                      value={regUsername}
                      onChange={e => setRegUsername(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                      style={{ color: "rgba(255,255,255,0.4)" }}>Display Name</label>
                    <input
                      data-testid="input-reg-displayname"
                      type="text"
                      placeholder="Optional"
                      value={regDisplayName}
                      onChange={e => setRegDisplayName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Email</label>
                  <input
                    data-testid="input-reg-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={regEmail}
                    onChange={e => setRegEmail(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Password</label>
                  <div className="relative">
                    <input
                      data-testid="input-reg-password"
                      type={showRegPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Min 6 characters"
                      value={regPassword}
                      onChange={e => setRegPassword(e.target.value)}
                      className={inputClass + " pr-10"}
                      required
                      minLength={6}
                    />
                    <button type="button" tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                      onClick={() => setShowRegPw(o => !o)}>
                      {showRegPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <button
                  data-testid="button-register-submit"
                  type="submit"
                  disabled={regLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "white", boxShadow: "0 4px 16px rgba(124,58,237,0.35)" }}>
                  {regLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Create Account
                </button>
                <p className="text-center text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Already have an account?{" "}
                  <button type="button" className="underline hover:text-white/60 transition-colors"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                    onClick={() => setTab("login")}>
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "rgba(255,255,255,0.2)" }}>
          Sessions are in-memory and reset on page reload.
        </p>
      </div>
    </div>
  );
}
