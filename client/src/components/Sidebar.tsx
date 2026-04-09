import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { LayoutDashboard, Target, Settings, Trophy, Ticket, TrendingUp, BarChart2, Shuffle, Zap, LineChart } from "lucide-react";

const navItems = [
  { href: "/",          label: "Dashboard",    mobileLabel: "Home",     icon: LayoutDashboard,        emoji: "🏠" },
  { href: "/clv",       label: "Line Movement", mobileLabel: "Lines",    icon: TrendingUp,             emoji: "📈" },
  { href: "/markets",   label: "Pred. Markets", mobileLabel: "Markets",  icon: BarChart2,              emoji: "🔮" },
  { href: "/conviction",label: "Top Plays",     mobileLabel: "Top",      icon: Zap,                    emoji: "⚡" },
  { href: "/bets",      label: "All Picks",     mobileLabel: "Picks",    icon: Target,                 emoji: "🎯" },
  { href: "/linemate",  label: "Props Hub",     mobileLabel: "Props",    icon: LineChart,              emoji: "📊" },
  { href: "/fantasy",   label: "Fantasy",       mobileLabel: "Fantasy",  icon: Shuffle,                emoji: "🏅" },
  { href: "/lotto",     label: "Lotto",         mobileLabel: "Lotto",    icon: Ticket,                 emoji: "🎰" },
  { href: "/bracket",   label: "Bracket",       mobileLabel: "Bracket",  icon: Trophy,                 emoji: "🏆" },
  { href: "/settings",  label: "Settings",      mobileLabel: "Settings", icon: Settings,               emoji: "⚙️" },
];

const Logo = () => (
  <div className="flex items-center gap-3">
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="Clubhouse IQ">
      <rect width="32" height="32" rx="8" fill="rgba(251,158,30,0.12)" />
      <path d="M8 22 C8 13.2 24 13.2 24 22" stroke="rgba(251,158,30,0.3)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M20 11 C17.5 9.5 12 9.5 10 14 C8.5 17 9 21 12 23 C14.5 24.5 18.5 24.5 21 23" stroke="#fb9e1e" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="23" cy="11" r="1.4" fill="#fb9e1e" />
      <line x1="22" y1="13" x2="24" y2="16" stroke="#fb9e1e" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
    <div>
      <p className="font-bold text-foreground text-sm leading-tight">Clubhouse IQ</p>
      <p className="text-xs text-muted-foreground leading-tight">Sports Intelligence</p>
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
              {href === "/lotto" && !isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>HOT</span>
              )}
              {href === "/markets" && !isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(99,102,241,0.18)", color: "#818cf8" }}>LIVE</span>
              )}
              {href === "/conviction" && !isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(239,68,68,0.18)", color: "#f87171" }}>HOT</span>
              )}
              {href === "/linemate" && !isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.18)", color: "#4ade80" }}>NEW</span>
              )}
              {href === "/fantasy" && !isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}>NEW</span>
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
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Scrollable row — snaps so active tab is visible */}
      <div className="flex items-stretch overflow-x-auto scrollbar-none">
        {navItems.map(({ href, label, mobileLabel, icon: Icon }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex-shrink-0 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
              style={{ minWidth: 56, maxWidth: 64 }}
              data-testid={`mobile-nav-${label.toLowerCase().replace(" ", "-")}`}
            >
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary" />
              )}
              <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold leading-none whitespace-nowrap">{mobileLabel}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// Default export for backwards compat
export default DesktopSidebar;
