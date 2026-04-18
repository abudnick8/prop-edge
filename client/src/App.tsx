import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import LockScreen, { useLockScreen } from "@/components/LockScreen";
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
import { DesktopSidebar, MobileTabBar, CiqLogo } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";
import AskDrawer from "@/components/AskDrawer";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useEffect } from "react";

function ScrollToTop() {
  const [location] = useHashLocation();

  useEffect(() => {
    // Find the scrollable main container and reset to top on route change
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [location]);

  return null;
}

function AppInner() {
  const { isConnected } = useWebSocket();

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
        {/* Desktop: left sidebar */}
        <DesktopSidebar />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto" style={{ background: "#F6F1E7" }}>
          {/* Top bar — navy on mobile, cream on desktop */}
          <div
            className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 py-3"
            style={{
              background: "#13233A",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {/* Mobile: show full wordmark */}
            <div className="flex md:hidden items-center">
              <CiqLogo size="sm" />
            </div>
            {/* Desktop: empty left side (sidebar has logo) */}
            <div className="hidden md:block" />

            {/* Right controls */}
            <div className="flex items-center gap-3">
              {/* Live feed indicator */}
              <div className="flex items-center gap-1.5">
                <span
                  className="relative flex h-2 w-2"
                  title={isConnected ? "Live feed connected" : "Live feed reconnecting..."}
                >
                  {isConnected && (
                    <span
                      className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                      style={{ background: "#3F6B4B" }}
                    />
                  )}
                  <span
                    className="relative inline-flex rounded-full h-2 w-2"
                    style={{ background: isConnected ? "#3F6B4B" : "#4A5568" }}
                  />
                </span>
                <span
                  className="hidden md:inline text-[10px] font-semibold tracking-widest uppercase"
                  style={{ color: isConnected ? "rgba(63,107,75,0.9)" : "rgba(216,204,184,0.3)" }}
                >
                  {isConnected ? "Live" : "···"}
                </span>
              </div>
              <AskDrawer />
              <NotificationCenter />
            </div>
          </div>

          {/* Page content */}
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
              <Route component={NotFound} />
            </Switch>
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <MobileTabBar />
      <Toaster />
    </WouterRouter>
  );
}

function App() {
  const { unlocked, unlock } = useLockScreen();
  if (!unlocked) return <LockScreen onUnlock={unlock} />;
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}

export default App;
