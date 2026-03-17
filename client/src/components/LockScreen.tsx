import { useState, useRef, useEffect } from "react";

const CORRECT_CODE = "ADAM";
const SESSION_KEY = "pe_unlocked";

export function useLockScreen() {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
  });
  const unlock = () => {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    setUnlocked(true);
  };
  return { unlocked, unlock };
}

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const attempt = (val: string) => {
    if (val.toUpperCase() === CORRECT_CODE) {
      setError(false);
      onUnlock();
    } else if (val.length >= CORRECT_CODE.length) {
      setError(true);
      setShake(true);
      setTimeout(() => { setShake(false); setInput(""); setError(false); }, 700);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setError(false);
    attempt(val);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") attempt(input);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
      {/* Subtle grid background */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(hsl(142 76% 45%) 1px, transparent 1px), linear-gradient(90deg, hsl(142 76% 45%) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      <div className={`relative flex flex-col items-center gap-6 px-8 py-10 w-full max-w-sm transition-all ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(142 76% 45% / 0.15), hsl(142 76% 45% / 0.05))", border: "1px solid hsl(142 76% 45% / 0.3)" }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="PropEdge">
              <rect width="32" height="32" rx="8" fill="hsl(142 76% 45% / 0.1)" />
              <path d="M8 24 L16 8 L24 24" stroke="hsl(142 76% 45%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="16" cy="8" r="2.5" fill="hsl(142 76% 45%)" />
              <line x1="10" y1="20" x2="22" y2="20" stroke="hsl(142 76% 45% / 0.5)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-foreground tracking-tight">PropEdge</p>
            <p className="text-xs text-muted-foreground mt-0.5">Enter your access code to continue</p>
          </div>
        </div>

        {/* Input */}
        <div className="w-full space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder="Access code"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            className={`w-full text-center text-lg font-bold tracking-[0.3em] rounded-xl border px-4 py-4 bg-card outline-none transition-all placeholder:text-muted-foreground placeholder:tracking-normal placeholder:font-normal ${
              error
                ? "border-red-500/60 text-red-400 bg-red-500/5"
                : "border-border text-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
            }`}
          />
          {error && (
            <p className="text-center text-xs text-red-400 font-medium">Incorrect code — try again</p>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={() => attempt(input)}
          disabled={!input.trim()}
          className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, hsl(142 76% 35%), hsl(142 76% 45%))", color: "#fff" }}
        >
          Unlock
        </button>

        <p className="text-[10px] text-muted-foreground/50">PropEdge · Private Access</p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
