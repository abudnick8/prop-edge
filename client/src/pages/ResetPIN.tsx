import { useState, useRef } from "react";
import { Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";

export default function ResetPIN() {
  // Token comes from URL hash: /#/reset-pin?token=xxx
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const token  = params.get("token") ?? "";

  const [pin,        setPin]        = useState(["", "", "", ""]);
  const [confirmPin, setConfirmPin] = useState(["", "", "", ""]);
  const [showPin,    setShowPin]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [done,       setDone]       = useState(false);

  const pinRefs     = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const confirmRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  function handleInput(val: string, idx: number, arr: string[], setArr: (a: string[]) => void, refs: typeof pinRefs) {
    const char = val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);
    const next = [...arr]; next[idx] = char; setArr(next);
    if (char && idx < 3) refs[idx + 1].current?.focus();
  }

  function handleKey(e: React.KeyboardEvent, idx: number, arr: string[], setArr: (a: string[]) => void, refs: typeof pinRefs) {
    if (e.key === "Backspace" && !arr[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
      const next = [...arr]; next[idx - 1] = ""; setArr(next);
    }
  }

  function PINBoxes({ arr, setArr, refs }: { arr: string[], setArr: (a: string[]) => void, refs: typeof pinRefs }) {
    return (
      <div className="flex items-center gap-3 justify-center">
        {arr.map((val, i) => (
          <input
            key={i} ref={refs[i]}
            type={showPin ? "text" : "password"}
            inputMode="text" maxLength={1} value={val}
            onChange={e => handleInput(e.target.value, i, arr, setArr, refs)}
            onKeyDown={e => handleKey(e, i, arr, setArr, refs)}
            className="w-12 h-14 text-center text-xl font-black rounded-xl border-2 outline-none transition-all"
            style={{ background: "#F6F1E7", borderColor: val ? "#13233A" : "rgba(19,35,58,0.2)", color: "#131A24" }}
          />
        ))}
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pinVal = pin.join("");
    const confirmVal = confirmPin.join("");
    if (pinVal !== confirmVal) { setError("PINs don't match"); return; }
    if (!token) { setError("Invalid reset link"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin: pinVal }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Reset failed"); return; }
      setDone(true);
      setTimeout(() => { window.location.hash = "/login"; }, 2000);
    } catch { setError("Network error — please try again."); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#F6F1E7" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#13233A" }}>
              <span className="text-lg">🏟️</span>
            </div>
            <span className="text-2xl font-black tracking-tight" style={{ color: "#131A24" }}>Clubhouse IQ</span>
          </div>
        </div>

        <div className="rounded-2xl p-6 shadow-lg" style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.08)" }}>
          {done ? (
            <div className="text-center py-4">
              <CheckCircle size={40} className="mx-auto mb-3" style={{ color: "#22c55e" }} />
              <p className="font-bold text-sm" style={{ color: "#131A24" }}>PIN updated successfully</p>
              <p className="text-xs text-muted-foreground mt-1">Redirecting to login…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="text-center mb-2">
                <p className="text-sm font-bold" style={{ color: "#131A24" }}>Set a new PIN</p>
                <p className="text-xs text-muted-foreground mt-1">4 characters — letters or numbers</p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#dc2626" }}>
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">New PIN</label>
                  <button type="button" onClick={() => setShowPin(s => !s)} className="text-xs text-muted-foreground flex items-center gap-1">
                    {showPin ? <EyeOff size={12} /> : <Eye size={12} />} {showPin ? "Hide" : "Show"}
                  </button>
                </div>
                <PINBoxes arr={pin} setArr={setPin} refs={pinRefs} />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Confirm PIN</label>
                <PINBoxes arr={confirmPin} setArr={setConfirmPin} refs={confirmRefs} />
              </div>

              <button
                type="submit" disabled={loading || pin.join("").length < 4}
                className="w-full py-3 rounded-xl font-black text-sm disabled:opacity-50"
                style={{ background: "#13233A", color: "#F6F1E7" }}
              >
                {loading ? "Saving…" : "Save New PIN"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
