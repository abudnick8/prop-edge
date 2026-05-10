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
import Book from "@/pages/Book";
import Pricing from "@/pages/Pricing";
import AppInsights from "@/pages/AppInsights";
import { DesktopSidebar, MobileTabBar, CiqLogo } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";
import AskDrawer from "@/components/AskDrawer";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { X, AlertTriangle, Info, CheckCircle } from "lucide-react";

// ── Error Boundary — catches runtime crashes instead of blank screen ─────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: string },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[CIQ ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", background: "#F6F1E7", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "24px", fontFamily: "system-ui, sans-serif",
        }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "28px 24px", maxWidth: 400, width: "100%", border: "1px solid rgba(19,35,58,0.10)", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <p style={{ fontSize: 16, fontWeight: 800, color: "#131A24", margin: "0 0 8px" }}>Something went wrong</p>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 16px", lineHeight: 1.5 }}>
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.hash = "/"; }}
              style={{ background: "#13233A", color: "#F6F1E7", border: "none", borderRadius: 12, padding: "10px 24px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              Go to Dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "transparent", color: "#64748b", border: "1px solid rgba(19,35,58,0.15)", borderRadius: 12, padding: "10px 24px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginLeft: 8 }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Feature flag types ────────────────────────────────────────────────────────
interface FeatureFlag {
  key: string;
  enabled: boolean;
  min_tier: string;
  kill_switch: boolean;
}

// ── Feature flags context — fetched ONCE at app level ────────────────────────
const FeatureFlagContext = createContext<FeatureFlag[]>([]);

function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const { data: flags = [] } = useQuery<FeatureFlag[]>({
    queryKey: ["feature-flags-global"],
    queryFn: () => fetch("/api/feature-flags").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

function useFeatureFlags() {
  return useContext(FeatureFlagContext);
}

// ── Announcement context ──────────────────────────────────────────────────────
const AnnouncementContext = createContext<{ message: string; type: string } | null>(null);

function AnnouncementProvider({ children }: { children: ReactNode }) {
  const { data = null } = useQuery<{ message: string; type: string } | null>({
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
  return (
    <AnnouncementContext.Provider value={data}>
      {children}
    </AnnouncementContext.Provider>
  );
}

// ── Global announcement banner ────────────────────────────────────────────────
function AnnouncementBanner() {
  const data = useContext(AnnouncementContext);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const msgKey = data?.message ?? null;

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
  const styles: Record<string, { bg: string; border: string; text: string; icon: ReactNode }> = {
    info:    { bg: "#1a3350", border: "rgba(99,163,235,0.4)",  text: "#bfd9f5", icon: <Info size={14} /> },
    success: { bg: "#1a3328", border: "rgba(74,180,120,0.4)",  text: "#a3e6c2", icon: <CheckCircle size={14} /> },
    warning: { bg: "#3a2a0a", border: "rgba(230,170,60,0.4)",  text: "#f5d78e", icon: <AlertTriangle size={14} /> },
    error:   { bg: "#3a1010", border: "rgba(220,80,80,0.4)",   text: "#f5a8a8", icon: <AlertTriangle size={14} /> },
  };
  const s = styles[type] ?? styles.info;

  return (
    <div style={{
      background: s.bg,
      borderBottom: `1px solid ${s.border}`,
      color: s.text,
      padding: "9px 16px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13,
      fontWeight: 500,
    }}>
      <span style={{ flexShrink: 0, opacity: 0.85 }}>{s.icon}</span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{data.message}</span>
      <button
        onClick={handleDismiss}
        style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: s.text, opacity: 0.7, padding: "2px 4px", borderRadius: 4, display: "flex", alignItems: "center" }}
        aria-label="Dismiss announcement"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function ScrollToTop() {
  const [location] = useHashLocation();
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [location]);
  return null;
}

// ── FeatureGuard — proper component, no hooks-in-callbacks issue ──────────────
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
  const flags = useFeatureFlags();
  const [, navigate] = useHashLocation();

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

  // Feature flag / kill switch check (only once flags have loaded)
  if (flagKey && flags.length > 0) {
    const flag = flags.find(f => f.key === flagKey);
    if (flag) {
      if (flag.kill_switch) {
        return (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div style={{ background: "#13233A", borderRadius: 16, padding: "32px 28px", maxWidth: 360, color: "#F6F1E7" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🚧</div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Feature Unavailable</div>
              <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>This feature is temporarily disabled. Check back soon.</div>
            </div>
          </div>
        );
      }
      if (!flag.enabled) {
        return (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div style={{ background: "#13233A", borderRadius: 16, padding: "32px 28px", maxWidth: 360, color: "#F6F1E7" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Currently Disabled</div>
              <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>This feature is not available right now.</div>
            </div>
          </div>
        );
      }
    }
  }

  return <>{children}</>;
}

// Owner-only guard
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

// ── Route components — defined as named components, NOT inline arrows ─────────
// This ensures hooks inside FeatureGuard are always called at component level
function RouteScores()      { return <FeatureGuard require="free"  flagKey="live_scores"><LiveScores /></FeatureGuard>; }
function RouteFantasy()     { return <FeatureGuard require="free"  flagKey="fantasy"><Fantasy /></FeatureGuard>; }
function RouteDashboard()   { return <FeatureGuard require="basic" flagKey="dashboard"><Dashboard /></FeatureGuard>; }
function RouteLinemate()    { return <FeatureGuard require="basic" flagKey="props_hub"><LinemateProps /></FeatureGuard>; }
function RouteLotto()       { return <FeatureGuard require="basic" flagKey="lotto"><Lotto /></FeatureGuard>; }
function RouteAllBets()     { return <FeatureGuard require="pro"   flagKey="all_picks"><AllBets /></FeatureGuard>; }
function RouteBracket()     { return <FeatureGuard require="pro"   flagKey="bracket"><Bracket /></FeatureGuard>; }
function RouteLineMove()    { return <FeatureGuard require="pro"   flagKey="line_movement"><LineMovement /></FeatureGuard>; }
function RouteMarkets()     { return <FeatureGuard require="pro"   flagKey="markets"><PredictionMarkets /></FeatureGuard>; }
function RouteTraders()     { return <FeatureGuard require="pro"   flagKey="markets"><TopTraders /></FeatureGuard>; }
function RouteConviction()  { return <FeatureGuard require="pro"   flagKey="top_plays"><HighConviction /></FeatureGuard>; }
function RouteMLInsights()  { return <FeatureGuard require="pro"   flagKey="ml_intel"><MLInsights /></FeatureGuard>; }
function RouteBTS()         { return <FeatureGuard require="pro"   flagKey="bts"><BTS /></FeatureGuard>; }
function RouteBook()        { return <OwnerGuard><Book /></OwnerGuard>; }
function RouteInsights()    { return <OwnerGuard><AppInsights /></OwnerGuard>; }
function RoutePickDetail(p: any)    { return <FeatureGuard require="basic" flagKey="dashboard"><PickDetail {...p} /></FeatureGuard>; }
function RouteLottoDetail(p: any)   { return <FeatureGuard require="basic" flagKey="lotto"><PickDetail {...p} /></FeatureGuard>; }
function RouteBetDetail(p: any)     { return <FeatureGuard require="pro"   flagKey="all_picks"><BetDetail {...p} /></FeatureGuard>; }

function AppInner() {
  const { isConnected } = useWebSocket();
  useVersionCheck();

  return (
    <WouterRouter hook={useHashLocation}>
      <ScrollToTop />
      <div
        className="flex overflow-hidden"
        style={{ height: "100dvh", minHeight: "-webkit-fill-available", paddingTop: "env(safe-area-inset-top, 0px)", background: "#F6F1E7" }}
      >
        <DesktopSidebar />

        <main className="flex-1 overflow-y-auto" style={{ background: "#F6F1E7" }}>
          {/* Top bar */}
          <div className="sticky top-0 z-30" style={{ background: "#13233A", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between px-4 md:px-6 py-3">
              <div className="flex md:hidden items-center">
                <CiqLogo size="sm" />
              </div>
              <div className="hidden md:block" />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2" title={isConnected ? "Live feed connected" : "Live feed reconnecting..."}>
                    {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#3F6B4B" }} />}
                    <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: isConnected ? "#3F6B4B" : "#4A5568" }} />
                  </span>
                  <span className="hidden md:inline text-[10px] font-semibold tracking-widest uppercase" style={{ color: isConnected ? "rgba(63,107,75,0.9)" : "rgba(216,204,184,0.3)" }}>
                    {isConnected ? "Live" : "···"}
                  </span>
                </div>
                <AskDrawer />
                <NotificationCenter />
              </div>
            </div>
            <AnnouncementBanner />
          </div>

          <div className="p-4 md:p-6 pb-28 md:pb-6">
            <ErrorBoundary>
            <Switch>
              <Route path="/scores"        component={RouteScores} />
              <Route path="/fantasy"       component={RouteFantasy} />
              <Route path="/settings"      component={Settings} />
              <Route path="/pricing"       component={Pricing} />
              <Route path="/ask"           component={Ask} />
              <Route path="/"             component={RouteDashboard} />
              <Route path="/linemate"      component={RouteLinemate} />
              <Route path="/lotto"         component={RouteLotto} />
              <Route path="/picks/:slug"   component={RoutePickDetail} />
              <Route path="/lotto/:slug"   component={RouteLottoDetail} />
              <Route path="/bets"          component={RouteAllBets} />
              <Route path="/bets/:id"      component={RouteBetDetail} />
              <Route path="/bracket"       component={RouteBracket} />
              <Route path="/clv"           component={RouteLineMove} />
              <Route path="/line-movement" component={RouteLineMove} />
              <Route path="/markets"       component={RouteMarkets} />
              <Route path="/markets/top-traders" component={RouteTraders} />
              <Route path="/conviction"    component={RouteConviction} />
              <Route path="/ml-insights"   component={RouteMLInsights} />
              <Route path="/bts"           component={RouteBTS} />
              <Route path="/book"          component={RouteBook} />
              <Route path="/insights"      component={RouteInsights} />
              <Route component={NotFound} />
            </Switch>
            </ErrorBoundary>
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
        <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: "#13233A", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!isLoggedIn) return <Login />;
  return <AppInner />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter hook={useHashLocation}>
          <AnnouncementProvider>
            <FeatureFlagProvider>
              <AuthGuard />
            </FeatureFlagProvider>
          </AnnouncementProvider>
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
