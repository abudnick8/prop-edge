import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import ResetPIN from "@/pages/ResetPIN";
import Dashboard from "@/pages/Dashboard";
import AllBets from "@/pages/AllBets";
import BetDetail from "@/pages/BetDetail";
import Settings from "@/pages/Settings";
import Ask from "@/pages/Ask";
import Bracket from "@/pages/Bracket";
import Lotto from "@/pages/Lotto";
import LineMovement from "@/pages/LineMovement";
import PickDetail from "@/pages/PickDetail";
import PredictionMarkets from "@/pages/PredictionMarkets";
import TopTraders from "@/pages/TopTraders";
import Fantasy from "@/pages/Fantasy";
import HighConviction from "@/pages/HighConviction";
import LinemateProps from "@/pages/LinemateProps";
import LiveScores from "@/pages/LiveScores";
import MLInsights from "@/pages/MLInsights";
import NotFound from "@/pages/not-found";
import BTS from "@/pages/BTS";
import Pricing from "@/pages/Pricing";
import AppInsights from "@/pages/AppInsights";
import { DesktopSidebar, MobileTabBar, CiqLogo } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";
import AskDrawer from "@/components/AskDrawer";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useEffect, useState, type ReactNode } from "react";
import { X, AlertTriangle, Info, CheckCircle } from "lucide-react";

// ── Feature flag types ────────────────────────────────────────────────────────
interface FeatureFlag {
  key: string;
  enabled: boolean;
  min_tier: string;
  kill_switch: boolean;
}

// Route path → feature flag key mapping
const ROUTE_FLAG_MAP: Record<string, string> = {
  "/":           "dashboard",
  "/linemate":   "props_hub",
  "/lotto":      "lotto",
  "/picks":      "dashboard",       // pick detail — tied to dashboard
  "/bets":       "all_picks",
  "/bracket":    "bracket",
  "/clv":        "line_movement",
  "/line-movement": "line_movement",
  "/markets":    "markets",
  "/conviction": "top_plays",
  "/ml-insights":"ml_intel",
  "/bts":        "bts",
  "/scores":     "live_scores",
  "/fantasy":    "fantasy",
};

// ── Global announcement banner ────────────────────────────────────────────────
function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState<string | null>(null);

  const { data } = useQuery<{ message: string; type: string; ts: string } | null>({
    queryKey: ["announcement-global"],
    queryFn: async () => {
      const r = await fetch("/api/announcement");
      if (!r.ok) return null;
      const j = await r.json();
      return j?.message ? j : null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Key = message content so clearing/changing auto-re-evaluates
  const msgKey = data?.message ?? null;

  // Check sessionStorage for dismissed state
  useEffect(() => {
    if (msgKey) {
      const stored = sessionStorage.getItem("ciq_ann_dismissed");
      if (stored === msgKey) setDismissed(msgKey);
      else setDismissed(null);
    }
  }, [msgKey]);

  if (!data?.message || dismissed === msgKey) return null;

  const handleDismiss = () => {
    sessionStorage.setItem("ciq_ann_dismissed", msgKey!);
    setDismissed(msgKey);
  };

  const type = data.type ?? "info";

  // Style per type
  const styles: Record<string, { bg: string; border: string; text: string; icon: ReactNode }> = {
    info:    { bg: "#1a3350", border: "rgba(99,163,235,0.4)",  text: "#bfd9f5", icon: <Info size={14} /> },
    success: { bg: "#1a3328", border: "rgba(74,180,120,0.4)",  text: "#a3e6c2", icon: <CheckCircle size={14} /> },
    warning: { bg: "#3a2a0a", border: "rgba(230,170,60,0.4)",  text: "#f5d78e", icon: <AlertTriangle size={14} /> },
    error:   { bg: "#3a1010", border: "rgba(220,80,80,0.4)",   text: "#f5a8a8", icon: <AlertTriangle size={14} /> },
  };
  const s = styles[type] ?? styles.info;

  return (
    <div
      style={{
        background: s.bg,
        borderBottom: `1px solid ${s.border}`,
        color: s.text,
        padding: "9px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        fontWeight: 500,
        zIndex: 40,
        position: "relative",
      }}
    >
      <span style={{ flexShrink: 0, opacity: 0.85 }}>{s.icon}</span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{data.message}</span>
      <button
        onClick={handleDismiss}
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: s.text,
          opacity: 0.7,
          padding: "2px 4px",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
        }}
        aria-label="Dismiss announcement"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Feature flags hook ────────────────────────────────────────────────────────
function useFeatureFlags() {
  const { data: flags = [] } = useQuery<FeatureFlag[]>({
    queryKey: ["feature-flags-global"],
    queryFn: () => fetch("/api/feature-flags").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return flags;
}

function ScrollToTop() {
  const [location] = useHashLocation();
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [location]);
  return null;
}

// ── FeatureGuard — replaces TierGuard, also enforces kill switches ────────────
// flagKey: the feature_flags.key for this route (optional — if not provided, only tier is checked)
function FeatureGuard({
  children,
  require: req,
  flagKey,
}: {
  children: React.ReactNode;
  require: "basic" | "pro" | "free";
  flagKey?: string;
}) {
  const { isPro, isBasic, isOwner } = useAuth();
  const [, navigate] = useHashLocation();
  const flags = useFeatureFlags();

  // Owner bypasses everything
  if (isOwner) return <>{children}</>;

  // Tier check
  const tierOk =
    req === "free" ? true :
    req === "basic" ? (isPro || isBasic) :
    isPro;

  if (!tierOk) {
    setTimeout(() => navigate("/pricing"), 0);
    return null;
  }

  // Feature flag / kill switch check
  if (flagKey && flags.length > 0) {
    const flag = flags.find(f => f.key === flagKey);
    if (flag) {
      // Kill switch: override — no one (except owner, already returned above) gets access
      if (flag.kill_switch) {
        return (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div style={{
              background: "#13233A",
              borderRadius: 16,
              padding: "32px 28px",
              maxWidth: 360,
              color: "#F6F1E7",
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🚧</div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Feature Unavailable</div>
              <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>
                This feature is temporarily disabled. Check back soon.
              </div>
            </div>
          </div>
        );
      }
      // Disabled for tier (not kill switch — just turned off)
      if (!flag.enabled) {
        return (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div style={{
              background: "#13233A",
              borderRadius: 16,
              padding: "32px 28px",
              maxWidth: 360,
              color: "#F6F1E7",
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Currently Disabled</div>
              <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>
                This feature is not available right now.
              </div>
            </div>
          </div>
        );
      }
    }
  }

  return <>{children}</>;
}

// OwnerGuard — renders children only for is_owner=true, redirects otherwise
function OwnerGuard({ children }: { children: React.ReactNode }) {
  const { isOwner, isLoading } = useAuth();
  const [, navigate] = useHashLocation();
  if (isLoading) return null;
  if (!isOwner) {
    setTimeout(() => navigate("/"), 0);
    return null;
  }
  return <>{children}</>;
}

function AppInner() {
  const { isConnected } = useWebSocket();
  useVersionCheck();

  return (
    <WouterRouter hook={useHashLocation}>
      <ScrollToTop />
      <div
        className="flex overflow-hidden"
        style={{
          height: "100dvh",
          minHeight: "-webkit-fill-available",
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "#F6F1E7",
        }}
      >
        <DesktopSidebar />

        <main className="flex-1 overflow-y-auto" style={{ background: "#F6F1E7" }}>
          {/* Top bar */}
          <div
            className="sticky top-0 z-30"
            style={{ background: "#13233A", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center justify-between px-4 md:px-6 py-3">
              <div className="flex md:hidden items-center">
                <CiqLogo size="sm" />
              </div>
              <div className="hidden md:block" />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2" title={isConnected ? "Live feed connected" : "Live feed reconnecting..."}>
                    {isConnected && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#3F6B4B" }} />
                    )}
                    <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: isConnected ? "#3F6B4B" : "#4A5568" }} />
                  </span>
                  <span className="hidden md:inline text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: isConnected ? "rgba(63,107,75,0.9)" : "rgba(216,204,184,0.3)" }}>
                    {isConnected ? "Live" : "···"}
                  </span>
                </div>
                <AskDrawer />
                <NotificationCenter />
              </div>
            </div>
            {/* Global announcement banner — sits inside sticky top bar so it scrolls with the bar */}
            <AnnouncementBanner />
          </div>

          <div className="p-4 md:p-6 pb-28 md:pb-6">
            <Switch>
              {/* Free — always accessible (but still respect kill switches) */}
              <Route path="/scores">{() => <FeatureGuard require="free" flagKey="live_scores"><LiveScores /></FeatureGuard>}</Route>
              <Route path="/fantasy">{() => <FeatureGuard require="free" flagKey="fantasy"><Fantasy /></FeatureGuard>}</Route>
              <Route path="/settings" component={Settings} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/ask" component={Ask} />

              {/* Basic tier */}
              <Route path="/">{() => <FeatureGuard require="basic" flagKey="dashboard"><Dashboard /></FeatureGuard>}</Route>
              <Route path="/linemate">{() => <FeatureGuard require="basic" flagKey="props_hub"><LinemateProps /></FeatureGuard>}</Route>
              <Route path="/lotto">{() => <FeatureGuard require="basic" flagKey="lotto"><Lotto /></FeatureGuard>}</Route>
              <Route path="/picks/:slug">{(p) => <FeatureGuard require="basic" flagKey="dashboard"><PickDetail {...p} /></FeatureGuard>}</Route>
              <Route path="/lotto/:slug">{(p) => <FeatureGuard require="basic" flagKey="lotto"><PickDetail {...p} /></FeatureGuard>}</Route>

              {/* Pro tier */}
              <Route path="/bets">{() => <FeatureGuard require="pro" flagKey="all_picks"><AllBets /></FeatureGuard>}</Route>
              <Route path="/bets/:id">{(p) => <FeatureGuard require="pro" flagKey="all_picks"><BetDetail {...p} /></FeatureGuard>}</Route>
              <Route path="/bracket">{() => <FeatureGuard require="pro" flagKey="bracket"><Bracket /></FeatureGuard>}</Route>
              <Route path="/clv">{() => <FeatureGuard require="pro" flagKey="line_movement"><LineMovement /></FeatureGuard>}</Route>
              <Route path="/line-movement">{() => <FeatureGuard require="pro" flagKey="line_movement"><LineMovement /></FeatureGuard>}</Route>
              <Route path="/markets">{() => <FeatureGuard require="pro" flagKey="markets"><PredictionMarkets /></FeatureGuard>}</Route>
              <Route path="/markets/top-traders">{() => <FeatureGuard require="pro" flagKey="markets"><TopTraders /></FeatureGuard>}</Route>
              <Route path="/conviction">{() => <FeatureGuard require="pro" flagKey="top_plays"><HighConviction /></FeatureGuard>}</Route>
              <Route path="/ml-insights">{() => <FeatureGuard require="pro" flagKey="ml_intel"><MLInsights /></FeatureGuard>}</Route>
              <Route path="/bts">{() => <FeatureGuard require="pro" flagKey="bts"><BTS /></FeatureGuard>}</Route>

              {/* Owner-only */}
              <Route path="/insights">{() => <OwnerGuard><AppInsights /></OwnerGuard>}</Route>

              <Route component={NotFound} />
            </Switch>
          </div>
        </main>
      </div>

      <MobileTabBar />
      <Toaster />
    </WouterRouter>
  );
}

// ── Auth guard ────────────────────────────────────────────────────────────────
function AuthGuard() {
  const { isLoggedIn, isLoading } = useAuth();
  const [location] = useHashLocation();

  if (location.startsWith("/reset-pin")) return <ResetPIN />;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F6F1E7" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#13233A", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!isLoggedIn) return <Login />;
  return <AppInner />;
}

function AuthGuardWrapper() {
  const [location] = useHashLocation();
  return <AuthGuard />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter hook={useHashLocation}>
          <AuthGuardWrapper />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
