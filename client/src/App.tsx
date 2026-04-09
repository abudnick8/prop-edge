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
import NotFound from "@/pages/not-found";
import { DesktopSidebar, MobileTabBar } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";
import AskDrawer from "@/components/AskDrawer";
import { useWebSocket } from "@/hooks/useWebSocket";

function AppInner() {
  const { isConnected } = useWebSocket();

  return (
    <WouterRouter hook={useHashLocation}>
      <div className="flex bg-background overflow-hidden" style={{height: '100dvh', minHeight: '-webkit-fill-available', paddingTop: 'env(safe-area-inset-top, 0px)'}}>
        {/* Desktop: left sidebar — inside Router so Links have context */}
        <DesktopSidebar />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Top bar — bg extends behind status bar via negative margin trick */}
          <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border flex items-center justify-between px-4 md:px-6 py-3" style={{ borderBottomColor: "rgba(251,158,30,0.18)" }}>
            {/* Mobile: show logo in top bar */}
            <div className="flex md:hidden items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-label="Clubhouse IQ">
                <rect width="32" height="32" rx="8" fill="hsl(38 95% 52% / 0.15)" />
                <path d="M8 22 C8 13.2 24 13.2 24 22" stroke="hsl(38 95% 52% / 0.3)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                <path d="M20 11 C17.5 9.5 12 9.5 10 14 C8.5 17 9 21 12 23 C14.5 24.5 18.5 24.5 21 23" stroke="hsl(38 95% 52%)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
                <circle cx="23" cy="11" r="1.4" fill="hsl(38 95% 52%)" />
                <line x1="22" y1="13" x2="24" y2="16" stroke="hsl(38 95% 52%)" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="font-bold text-sm text-foreground tracking-wide">Clubhouse IQ</span>
            </div>
            <div className="hidden md:block" />
            <div className="flex items-center gap-3">
              {/* Live feed indicator */}
              <div className="flex items-center gap-1.5">
                <span
                  className="relative flex h-2 w-2"
                  title={isConnected ? "Live feed connected" : "Live feed reconnecting..."}
                >
                  {isConnected && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#4ade80" }} />
                  )}
                  <span
                    className="relative inline-flex rounded-full h-2 w-2"
                    style={{ background: isConnected ? "#4ade80" : "#6b7280" }}
                  />
                </span>
                <span className="hidden md:inline text-[10px] font-semibold" style={{ color: isConnected ? "#4ade80" : "rgba(255,255,255,0.3)" }}>
                  {isConnected ? "LIVE" : "..."}
                </span>
              </div>
              <AskDrawer />
              <NotificationCenter />
            </div>
          </div>

          {/* Page content — extra bottom padding on mobile for tab bar */}
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
              <Route path="/markets" component={PredictionMarkets} />
              <Route path="/markets/top-traders" component={TopTraders} />
              <Route path="/fantasy" component={Fantasy} />
              <Route path="/conviction" component={HighConviction} />
              <Route path="/linemate" component={LinemateProps} />
              <Route component={NotFound} />
            </Switch>
          </div>
        </main>
      </div>

      {/* Mobile: bottom tab bar — inside Router so Links have context */}
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
