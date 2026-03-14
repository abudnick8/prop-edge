import { Switch, Route, Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import AllBets from "@/pages/AllBets";
import BetDetail from "@/pages/BetDetail";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";
import Sidebar from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/bets" component={AllBets} />
      <Route path="/bets/:id" component={BetDetail} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border flex items-center justify-between px-6 py-3">
            <div />
            <NotificationCenter />
          </div>
          <div className="p-6">
            <Router />
          </div>
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
