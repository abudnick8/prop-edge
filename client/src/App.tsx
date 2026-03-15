import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import AllBets from "@/pages/AllBets";
import BetDetail from "@/pages/BetDetail";
import Settings from "@/pages/Settings";
import TrackedProps from "@/pages/TrackedProps";
import NotFound from "@/pages/not-found";
import { DesktopSidebar, MobileTabBar } from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";

function Router() {
  return (
    <WouterRouter hook={useHashLocation}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/bets" component={AllBets} />
        <Route path="/bets/:id" component={BetDetail} />
        <Route path="/settings" component={Settings} />
        <Route path="/tracker" component={TrackedProps} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Desktop: left sidebar */}
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
            <NotificationCenter />
          </div>

          {/* Page content — extra bottom padding on mobile for tab bar */}
          <div className="p-4 md:p-6 pb-24 md:pb-6">
            <Router />
          </div>
        </main>
      </div>

      {/* Mobile: bottom tab bar */}
      <MobileTabBar />

      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
