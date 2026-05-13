import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  tier: "free" | "basic" | "pro" | null;
  subStatus: string;
  isOwner: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isOwner: boolean;
  isPro: boolean;
  isBasic: boolean;
  isFree: boolean;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "ciq_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Validate stored token on mount
  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setIsLoading(false); return; }

    // Restore from cached user immediately (no flicker / no login screen on return)
    const cached = localStorage.getItem(TOKEN_KEY + "_user");
    if (cached) {
      try {
        setUser(JSON.parse(cached));
        setIsLoading(false); // show app instantly from cache
      } catch {}
    }

    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        // Cache fresh user data for instant restore on next load
        localStorage.setItem(TOKEN_KEY + "_user", JSON.stringify(data));
      } else {
        // Token expired or invalid — clear it
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY + "_user");
        setUser(null);
      }
    } catch {
      // Network error — keep cached user, don't force logout
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback((token: string, userData: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_KEY + "_user", JSON.stringify(userData));
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY + "_user");
    // Also clear the old BREW session key
    sessionStorage.removeItem("ciq_unlocked");
    setUser(null);
  }, []);

  const isLoggedIn = !!user;
  const isOwner    = user?.isOwner ?? false;
  // All logged-in users have full access — no tier gating
  const isPro      = !!user;
  const isBasic    = !!user;
  const isFree     = !!user;

  return (
    <AuthContext.Provider value={{
      user, isLoggedIn, isOwner, isPro, isBasic, isFree,
      isLoading, login, logout, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// ── Attach token to every API call ───────────────────────────────────────────
// Monkey-patch fetch so all apiRequest() calls automatically include the token.
// This runs once at module load time.

const _originalFetch = window.fetch.bind(window);
window.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && typeof input === "string" && input.startsWith("/api/")) {
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return _originalFetch(input, { ...init, headers });
  }
  return _originalFetch(input, init);
};
