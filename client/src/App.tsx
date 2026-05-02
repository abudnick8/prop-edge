import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
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
import { DesktopSidebar, MobileTabBar, CiqLogo } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";
import AskDrawer from "@/components/AskDrawer";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useEffect, type ReactNode } from "react";

function ScrollToTop() {
  const [location] = useHashLocation();
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [location]);
  return null;
}


// TierGuard — wraps a page component and redirects to /pricing if tier insufficient
function TierGuard({ children, require: req }: { children: React.ReactNode; require: "basic" | "pro" }) {
  const { isPro, isBasic, isOwner } = useAuth();
  const [, navigate] = useHashLocation();
  const ok = isOwner || (req === "pro" ? isPro : isBasic);
  if (!ok) {
    // Redirect to pricing on next tick to avoid render-phase navigation
    setTimeout(() => navigate("/pricing"), 0);
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
            className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 py-3"
            style={{ background: "#13233A", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
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

          <div className="p-4 md:p-6 pb-28 md:pb-6">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/bets" component={AllBets} />
              <Route path="/bets/:id" component={BetDetail} />
              <Route path="/lotto" component={Lotto} />
              <Route path="/picks/:slug" component={PickDetail} />
              <Route path="/lotto/:slug" component={PickDetail} />
              <Route path="/settings" component={Settings} />
              <Route path="/ask" component={Ask} />
              <Route path="/bracket" component={Bracket} />
              <Route path="/clv" component={LineMovement} />
              <Route path="/line-movement" component={LineMovement} />
              <Route path="/markets" component={PredictionMarkets} />
              <Route path="/markets/top-traders" component={TopTraders} />
              <Route path="/fantasy" component={Fantasy} />
              <Route path="/conviction" component={HighConviction} />
              <Route path="/linemate" component={LinemateProps} />
              <Route path="/scores" component={LiveScores} />
              <Route path="/ml-insights" component={MLInsights} />
              <Route path="/bts" component={BTS} />
              <Route path="/pricing" component={Pricing} />
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
// Shows login screen until user is authenticated.
// Reset-PIN page is always accessible (no auth needed — token in URL).
function AuthGuard() {
  const { isLoggedIn, isLoading } = useAuth();
  const [location] = useHashLocation();

  // Always allow the reset-pin route (it's reached via email link)
  if (location.startsWith("/reset-pin")) return <ResetPIN />;

  // While checking stored token, show nothing (prevents flash)
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
