/**
 * AuthContext — token-based auth using React state only.
 * No localStorage / sessionStorage (blocked in sandbox).
 * Token is stored in memory — clears on page refresh (by design for security).
 */

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import { User } from "@shared/schema";

interface AuthState {
  user: User | null;
  token: string | null;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ user: null, token: null });

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Login failed");
    }
    const data = await res.json();
    setAuth({ user: data.user, token: data.token });
  }, []);

  const register = useCallback(async (
    email: string,
    username: string,
    password: string,
    displayName?: string
  ) => {
    const res = await apiRequest("POST", "/api/auth/register", { email, username, password, displayName });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Registration failed");
    }
    const data = await res.json();
    setAuth({ user: data.user, token: data.token });
  }, []);

  const logout = useCallback(async () => {
    if (auth.token) {
      try {
        await apiRequest("POST", "/api/auth/logout", {}, auth.token);
      } catch { /* ignore */ }
    }
    setAuth({ user: null, token: null });
  }, [auth.token]);

  const updateUser = useCallback((updates: Partial<User>) => {
    setAuth(prev => prev.user ? { ...prev, user: { ...prev.user, ...updates } } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{
      user: auth.user,
      token: auth.token,
      isLoggedIn: !!auth.user,
      login,
      register,
      logout,
      updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
