import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { Eye, EyeOff, Lock, Mail, AlertCircle, CheckCircle, ChevronRight, Code2, Gift } from "lucide-react";

type View = "login" | "signup" | "forgot" | "dev" | "trial";

export default function Login() {
  const { login } = useAuth();
  const [view,        setView]        = useState<View>("login");
  const [email,       setEmail]       = useState("");
  const [pin,         setPin]         = useState(["", "", "", ""]);
  const [confirmPin,  setConfirmPin]  = useState(["", "", "", ""]);
  const [devCode,     setDevCode]     = useState("");
  const [trialCode,   setTrialCode]   = useState("");
  const [trialEmail,  setTrialEmail]  = useState("");
  const [tier,        setTier]        = useState<"free" | "basic" | "pro">("basic");
  const [showPin,     setShowPin]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState("");

  const pinRefs     = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const confirmRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const devInputRef   = useRef<HTMLInputElement>(null);
  const trialInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view === "dev")   { setDevCode(""); setTimeout(() => devInputRef.current?.focus(), 50); }
    else if (view === "trial") { setTrialCode(""); setTrialEmail(""); setTimeout(() => trialInputRef.current?.focus(), 50); }
    else { setTimeout(() => pinRefs[0].current?.focus(), 50); }
  }, [view]);

  function handlePinInput(val: string, idx: number, arr: string[], setArr: (a: string[]) => void, refs: typeof pinRefs) {
    const char = val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);
    const next = [...arr]; next[idx] = char; setArr(next);
    if (char && idx < 3) refs[idx + 1].current?.focus();
  }

  function handlePinKey(e: React.KeyboardEvent, idx: number, arr: string[], setArr: (a: string[]) => void, refs: typeof pinRefs) {
    if (e.key === "Backspace" && !arr[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
      const next = [...arr]; next[idx - 1] = ""; setArr(next);
    }
  }

  const pinValue    = pin.join("");
  const confirmValue = confirmPin.join("");

  // ── Dev access ───────────────────────────────────────────────────────────
  function handleDevAccess(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (devCode.trim().toUpperCase() !== "ABUD") {
      setError("Invalid access code.");
      return;
    }
    const guestUser = { id: 0, email: "guest@clubhouseiq.app", tier: "pro" as const, subStatus: "active", isOwner: false };
    login("guest-dev-token", guestUser);
  }

  // ── Trial code access ──────────────────────────────────────────────────────
  async function handleTrialAccess(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/admin/redeem-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trialCode.trim(), email: trialEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Invalid trial code"); return; }
      // Fetch fresh user profile, fall back to data.user if /api/me fails
      let me = data.user;
      try {
        const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${data.token}` } });
        if (meRes.ok) me = await meRes.json();
      } catch { /* use data.user fallback */ }
      login(data.token, me);
    } catch (err: any) { setError(err?.message ?? "Network error — please try again."); }
    finally { setLoading(false); }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin: pinValue }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Login failed"); return; }
      const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${data.token}` } });
      const me = await meRes.json();
      login(data.token, me);
    } catch { setError("Network error — please try again."); }
    finally { setLoading(false); }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pinValue.length !== 4)    { setError("PIN must be 4 characters"); return; }
    if (pinValue !== confirmValue) { setError("PINs don't match"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin: pinValue, tier: tier === "free" ? "free" : tier }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Signup failed"); return; }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setSuccess("Account created! Please log in.");
        setView("login");
      }
    } catch { setError("Network error — please try again."); }
    finally { setLoading(false); }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await fetch("/api/auth/forgot-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSuccess("If that email has an account, a reset link is on its way.");
    } catch { setError("Network error — please try again."); }
    finally { setLoading(false); }
  }

  function PINBoxes({ arr, setArr, refs }: { arr: string[], setArr: (a: string[]) => void, refs: typeof pinRefs }) {
    return (
      <div className="flex items-center gap-3 justify-center">
        {arr.map((val, i) => (
          <input
            key={i} ref={refs[i]}
            type={showPin ? "text" : "password"}
            inputMode="text" maxLength={1} value={val}
            onChange={e => handlePinInput(e.target.value, i, arr, setArr, refs)}
            onKeyDown={e => handlePinKey(e, i, arr, setArr, refs)}
            className="w-12 h-14 text-center text-xl font-black rounded-xl border-2 outline-none transition-all"
            style={{ background: "#F6F1E7", borderColor: val ? "#13233A" : "rgba(19,35,58,0.2)", color: "#131A24" }}
          />
        ))}
      </div>
    );
  }

  const tabs: { id: View; label: string; icon?: React.ReactNode }[] = [
    { id: "login",  label: "Log In"  },
    { id: "signup", label: "Sign Up" },
    { id: "trial",  label: "Trial",  icon: <Gift size={11} /> },
    { id: "dev",    label: "Dev",    icon: <Code2 size={11} /> },
  ];

  function switchView(v: View) {
    setView(v); setError(""); setSuccess("");
    setPin(["","","",""]); setConfirmPin(["","","",""]);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#F6F1E7" }}>
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#13233A" }}>
              <span className="text-lg">🏟️</span>
            </div>
            <span className="text-2xl font-black tracking-tight" style={{ color: "#131A24" }}>Clubhouse IQ</span>
          </div>
          <p className="text-sm text-muted-foreground">Sports intelligence, unlocked.</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6 shadow-lg" style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.08)" }}>

          {/* Tabs */}
          {view !== "forgot" && (
            <div className="flex rounded-xl p-1 mb-6" style={{ background: "rgba(19,35,58,0.05)" }}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => switchView(t.id)}
                  className="flex-1 py-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1"
                  style={{
                    background: view === t.id ? "#13233A" : "transparent",
                    color:      view === t.id ? "#F6F1E7" : "#3D4B58",
                  }}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-4 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#dc2626" }}>
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-4 text-sm" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", color: "#16a34a" }}>
              <CheckCircle size={14} className="flex-shrink-0" /> {success}
            </div>
          )}

          {/* ── TRIAL CODE ── */}
          {view === "trial" && (
            <form onSubmit={handleTrialAccess} className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm font-bold" style={{ color: "#131A24" }}>Trial Access</p>
                <p className="text-xs text-muted-foreground mt-1">Enter your trial code to get temporary Pro access.</p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Your Email</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    value={trialEmail}
                    onChange={e => setTrialEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl border text-sm outline-none transition-all"
                    style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Trial Code</label>
                <input
                  ref={trialInputRef}
                  type="text"
                  value={trialCode}
                  onChange={e => setTrialCode(e.target.value.toUpperCase())}
                  placeholder="e.g. TEST7"
                  autoComplete="off"
                  required
                  className="w-full px-4 py-3 rounded-xl border-2 text-center text-xl font-black tracking-[0.25em] uppercase outline-none transition-all"
                  style={{
                    background: "#F6F1E7",
                    borderColor: trialCode ? "#13233A" : "rgba(19,35,58,0.2)",
                    color: "#131A24",
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={loading || !trialCode.trim() || !trialEmail.trim()}
                className="w-full py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#13233A", color: "#F6F1E7" }}
              >
                <Gift size={14} /> {loading ? "Activating…" : "Activate Trial"}
              </button>
            </form>
          )}

          {/* ── DEV ── */}
          {view === "dev" && (
            <form onSubmit={handleDevAccess} className="space-y-5">
              <div className="text-center mb-1">
                <p className="text-sm font-bold" style={{ color: "#131A24" }}>Dev Access</p>
                <p className="text-xs text-muted-foreground mt-1">Owner-only access code.</p>
              </div>
              <input
                ref={devInputRef}
                type="text"
                value={devCode}
                onChange={e => setDevCode(e.target.value)}
                placeholder="Enter code"
                autoComplete="off"
                className="w-full px-4 py-3 rounded-xl border-2 text-center text-xl font-black tracking-[0.3em] uppercase outline-none transition-all"
                style={{
                  background: "#F6F1E7",
                  borderColor: devCode ? "#13233A" : "rgba(19,35,58,0.2)",
                  color: "#131A24",
                }}
              />
              <button
                type="submit"
                disabled={!devCode.trim()}
                className="w-full py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#13233A", color: "#F6F1E7" }}
              >
                <Lock size={14} /> Enter
              </button>
            </form>
          )}

          {/* ── LOGIN ── */}
          {view === "login" && (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Email</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl border text-sm outline-none transition-all"
                    style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">PIN</label>
                  <button type="button" onClick={() => setShowPin(s => !s)} className="text-xs text-muted-foreground flex items-center gap-1">
                    {showPin ? <EyeOff size={12} /> : <Eye size={12} />} {showPin ? "Hide" : "Show"}
                  </button>
                </div>
                <PINBoxes arr={pin} setArr={setPin} refs={pinRefs} />
              </div>
              <button
                type="submit" disabled={loading || pinValue.length < 4}
                className="w-full py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "#13233A", color: "#F6F1E7" }}
              >
                <Lock size={14} /> {loading ? "Unlocking…" : "Unlock"}
              </button>
              <button type="button" onClick={() => { setView("forgot"); setError(""); setSuccess(""); }}
                className="w-full text-xs text-center text-muted-foreground hover:underline pt-1">
                Forgot PIN?
              </button>
            </form>
          )}

          {/* ── SIGN UP ── */}
          {view === "signup" && (
            <form onSubmit={handleSignup} className="space-y-5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Email</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl border text-sm outline-none"
                    style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Create PIN</label>
                  <button type="button" onClick={() => setShowPin(s => !s)} className="text-xs text-muted-foreground flex items-center gap-1">
                    {showPin ? <EyeOff size={12} /> : <Eye size={12} />} {showPin ? "Hide" : "Show"}
                  </button>
                </div>
                <PINBoxes arr={pin} setArr={setPin} refs={pinRefs} />
                <p className="text-[10px] text-muted-foreground text-center mt-1.5">4 characters — letters or numbers</p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Confirm PIN</label>
                <PINBoxes arr={confirmPin} setArr={setConfirmPin} refs={confirmRefs} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Choose Plan</label>
                <div className="space-y-2">
                  {([
                    { value: "free",  label: "Free",  price: "Free",    color: "#3D4B58", features: ["Live Scores", "Fantasy Tab"] },
                    { value: "basic", label: "Basic", price: "$5 / mo", color: "#2563eb", features: ["Dashboard", "Props Hub", "Lotto"] },
                    { value: "pro",   label: "Pro",   price: "$15 / mo",color: "#A23B32", features: ["BTS", "Top Plays", "All Picks", "ML Intel"] },
                  ] as const).map(opt => {
                    const active = tier === opt.value;
                    return (
                      <button key={opt.value} type="button" onClick={() => setTier(opt.value)}
                        className="w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all"
                        style={{ borderColor: active ? opt.color : "rgba(19,35,58,0.15)", background: active ? `${opt.color}08` : "transparent" }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                            style={{ background: active ? opt.color : "rgba(19,35,58,0.08)", color: active ? "#fff" : "#3D4B58" }}>{opt.label}</span>
                          <span className="text-sm font-black" style={{ color: active ? opt.color : "#131A24" }}>{opt.price}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {opt.features.map(f => (
                            <span key={f} className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold"
                              style={{ background: "rgba(19,35,58,0.06)", color: "#3D4B58" }}>{f}</span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button type="submit" disabled={loading || pinValue.length < 4}
                className="w-full py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "#13233A", color: "#F6F1E7" }}>
                {loading ? "Creating account…" : <><span>Create Account</span><ChevronRight size={14} /></>}
              </button>
            </form>
          )}

          {/* ── FORGOT PIN ── */}
          {view === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-5">
              <div className="text-center mb-2">
                <p className="text-sm font-bold" style={{ color: "#131A24" }}>Reset your PIN</p>
                <p className="text-xs text-muted-foreground mt-1">Enter your email and we'll send a reset link.</p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Email</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl border text-sm outline-none"
                    style={{ background: "#F6F1E7", borderColor: "rgba(19,35,58,0.2)", color: "#131A24" }}
                  />
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-xl font-black text-sm disabled:opacity-50"
                style={{ background: "#13233A", color: "#F6F1E7" }}>
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
              <button type="button" onClick={() => { setView("login"); setError(""); setSuccess(""); }}
                className="w-full text-xs text-center text-muted-foreground hover:underline">
                ← Back to login
              </button>
            </form>
          )}

        </div>

        <p className="text-center text-[10px] text-muted-foreground mt-6">
          Clubhouse IQ · For entertainment purposes only
        </p>
      </div>
    </div>
  );
}
