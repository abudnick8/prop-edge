import { Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { LayoutDashboard, Target, Settings, BarChart3, MessageCircleQuestion, Trophy } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, emoji: "🏠" },
  { href: "/bets", label: "All Picks", icon: Target, emoji: "🎯" },
  { href: "/ask", label: "Ask AI", icon: MessageCircleQuestion, emoji: "🤖" },
  { href: "/tracker", label: "Prop Tracker", icon: BarChart3, emoji: "📊" },
  { href: "/bracket", label: "Bracket", icon: Trophy, emoji: "🏆" },
  { href: "/settings", label: "Settings", icon: Settings, emoji: "⚙️" },
];

const Logo = () => (
  <div className="flex items-center gap-3">
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="PropEdge">
      <rect width="32" height="32" rx="8" fill="rgba(245,158,11,0.12)" />
      <path d="M8 24 L16 8 L24 24" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="16" cy="8" r="2.5" fill="#f59e0b" />
      <line x1="10" y1="20" x2="22" y2="20" stroke="rgba(245,158,11,0.45)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <div>
      <p className="font-bold text-foreground text-sm leading-tight">PropEdge</p>
      <p className="text-xs text-muted-foreground leading-tight">Prediction Bot</p>
    </div>
  </div>
);

// ── Desktop sidebar (hidden on mobile) ──────────────────────────────────────
export function DesktopSidebar() {
  const [location] = useHashLocation();

  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 bg-card border-r border-border flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <Logo />
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon, emoji }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              style={isActive ? { background: "rgba(245,158,11,0.12)", color: "#f59e0b" } : {}}
              data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
            >
              <span className="text-base w-5 text-center">{emoji}</span>
              {label}
              {href === "/tracker" && isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>NEW</span>
              )}
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

// ── Mobile bottom tab bar ────────────────────────────────────────────────────
export function MobileTabBar() {
  const [location] = useHashLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-stretch safe-bottom">
      {navItems.map(({ href, label, icon: Icon }) => {
        const isActive = location === href || (href !== "/" && location.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-medium transition-colors ${
              isActive ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid={`mobile-nav-${label.toLowerCase().replace(" ", "-")}`}
          >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// Default export for backwards compat
export default DesktopSidebar;
