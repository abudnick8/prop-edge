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
import TrackedProps from "@/pages/TrackedProps";
import Ask from "@/pages/Ask";
import Bracket from "@/pages/Bracket";
import Lotto from "@/pages/Lotto";
import LineMovement from "@/pages/LineMovement";
import NotFound from "@/pages/not-found";
import { DesktopSidebar, MobileTabBar } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";
import { useWebSocket } from "@/hooks/useWebSocket";

function AppInner() {
  const { isConnected } = useWebSocket();

  return (
    <WouterRouter hook={useHashLocation}>
      <div className="flex bg-background overflow-hidden" style={{height: '100vh', minHeight: '-webkit-fill-available'}}>
        {/* Desktop: left sidebar — inside Router so Links have context */}
        <DesktopSidebar />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Top bar */}
          <div className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border flex items-center justify-between px-4 md:px-6 py-3">
            {/* Mobile: show logo in top bar */}
            <div className="flex md:hidden items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-label="PropEdge">
                <rect width="32" height="32" rx="8" fill="hsl(142 76% 45% / 0.15)" />
                <path d="M8 24 L16 8 L24 24" stroke="hsl(142 76% 45%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <circle cx="16" cy="8" r="2.5" fill="hsl(142 76% 45%)" />
                <line x1="10" y1="20" x2="22" y2="20" stroke="hsl(142 76% 45% / 0.5)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="font-bold text-sm text-foreground">PropEdge</span>
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
              <NotificationCenter />
            </div>
          </div>

          {/* Page content — extra bottom padding on mobile for tab bar */}
          <div className="p-4 md:p-6 pb-24 md:pb-6">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/bets" component={AllBets} />
              <Route path="/bets/:id" component={BetDetail} />
              <Route path="/lotto" component={Lotto} />
              <Route path="/settings" component={Settings} />
              <Route path="/tracker" component={TrackedProps} />
              <Route path="/ask" component={Ask} />
              <Route path="/bracket" component={Bracket} />
              <Route path="/clv" component={LineMovement} />
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
