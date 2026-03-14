import { Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { LayoutDashboard, Target, Settings, TrendingUp, Zap } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/bets", label: "All Picks", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const [location] = useHashLocation();

  return (
    <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="PropEdge">
            <rect width="32" height="32" rx="8" fill="hsl(142 76% 45% / 0.15)" />
            <path d="M8 24 L16 8 L24 24" stroke="hsl(142 76% 45%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="16" cy="8" r="2.5" fill="hsl(142 76% 45%)" />
            <line x1="10" y1="20" x2="22" y2="20" stroke="hsl(142 76% 45% / 0.5)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div>
            <p className="font-bold text-foreground text-sm leading-tight">PropEdge</p>
            <p className="text-xs text-muted-foreground leading-tight">Prediction Bot</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link key={href} href={href}>
              <a
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
              >
                <Icon size={16} />
                {label}
              </a>
            </Link>
          );
        })}
      </nav>

      {/* Status */}
      <div className="px-4 py-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Scanner Active
        </div>
        <p className="text-xs text-muted-foreground mt-1">Auto-scans every 30 min</p>
      </div>

      {/* Attribution */}
      <div className="px-4 pb-4">
        <a
          href="https://www.perplexity.ai/computer"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Created with Perplexity Computer
        </a>
      </div>
    </aside>
  );
}
