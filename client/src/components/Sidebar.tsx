import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import {
  LayoutDashboard, Target, Settings, Trophy, Ticket,
  TrendingUp, BarChart2, Shuffle, Zap, LineChart,
} from "lucide-react";

const navItems = [
  { href: "/",           label: "Dashboard",     mobileLabel: "Home",     icon: LayoutDashboard,  emoji: "⬛" },
  { href: "/clv",        label: "Line Movement",  mobileLabel: "Lines",    icon: TrendingUp,       emoji: "⬛" },
  { href: "/markets",    label: "Pred. Markets",  mobileLabel: "Markets",  icon: BarChart2,        emoji: "⬛" },
  { href: "/conviction", label: "Top Plays",      mobileLabel: "Top",      icon: Zap,              emoji: "⬛" },
  { href: "/bets",       label: "All Picks",      mobileLabel: "Picks",    icon: Target,           emoji: "⬛" },
  { href: "/linemate",   label: "Props Hub",      mobileLabel: "Props",    icon: LineChart,        emoji: "⬛" },
  { href: "/fantasy",    label: "Fantasy",        mobileLabel: "Fantasy",  icon: Shuffle,          emoji: "⬛" },
  { href: "/lotto",      label: "Lotto",          mobileLabel: "Lotto",    icon: Ticket,           emoji: "⬛" },
  { href: "/bracket",    label: "Bracket",        mobileLabel: "Bracket",  icon: Trophy,           emoji: "⬛" },
  { href: "/settings",   label: "Settings",       mobileLabel: "Settings", icon: Settings,         emoji: "⬛" },
];

// Nav item badge definitions — editorial, restrained
const NAV_BADGES: Record<string, { label: string; style: string }> = {
  "/markets":    { label: "LIVE", style: "badge-live" },
  "/conviction": { label: "HOT",  style: "badge-hot" },
  "/lotto":      { label: "HOT",  style: "badge-hot" },
  "/linemate":   { label: "NEW",  style: "badge-new" },
  "/fantasy":    { label: "NEW",  style: "badge-new" },
};

// ── Clubhouse IQ Logo Wordmark ────────────────────────────────────────────
// SVG baseball icon + "Clubhouse" in Playfair italic script + "IQ" in DM Sans bold
export function CiqLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const iconSize = size === "sm" ? 22 : size === "lg" ? 38 : 28;
  const scriptSize = size === "sm" ? 16 : size === "lg" ? 24 : 19;
  const iqSize = size === "sm" ? 14 : size === "lg" ? 22 : 17;
  const subSize = size === "sm" ? 9 : size === "lg" ? 12 : 10;
  const showSub = size !== "sm";

  return (
    <div className="flex items-center gap-2.5">
      {/* Baseball icon — clean SVG, works at all sizes */}
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        {/* Ball circle */}
        <circle cx="16" cy="16" r="13.5" fill="rgba(255,255,255,0.06)" stroke="#C4B99A" strokeWidth="1.2" />
        {/* Left seam arc */}
        <path
          d="M9.5 6.5 C6 9.5 5.5 13 6.5 16 C7.5 19 9.5 21.5 9.5 25"
          stroke="#A23B32"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        {/* Right seam arc */}
        <path
          d="M22.5 7 C26 10 26.5 13.5 25.5 16.5 C24.5 19.5 22.5 22 22.5 25.5"
          stroke="#A23B32"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        {/* Left stitching ticks */}
        <path d="M8.2 10.5 L10.8 11.2" stroke="#A23B32" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M7.4 14.5 L10.2 15.0" stroke="#A23B32" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8.2 18.5 L10.8 17.8" stroke="#A23B32" strokeWidth="1.2" strokeLinecap="round" />
        {/* Right stitching ticks */}
        <path d="M23.8 10.8 L21.2 11.5" stroke="#A23B32" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M24.6 15.0 L21.8 15.5" stroke="#A23B32" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M23.8 19.2 L21.2 18.5" stroke="#A23B32" strokeWidth="1.2" strokeLinecap="round" />
      </svg>

      {/* Wordmark */}
      <div className="leading-none">
        <div className="flex items-baseline gap-1">
          <span
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 700,
              fontSize: scriptSize,
              color: "#F0EAD9",
              letterSpacing: "-0.01em",
              lineHeight: 1,
            }}
          >
            Clubhouse
          </span>
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: iqSize,
              color: "#A23B32",
              letterSpacing: "0.06em",
              lineHeight: 1,
            }}
          >
            IQ
          </span>
        </div>
        {showSub && (
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: subSize,
              color: "rgba(216,204,184,0.55)",
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: 2,
              lineHeight: 1,
            }}
          >
            Sports Intelligence
          </p>
        )}
      </div>
    </div>
  );
}

// ── Desktop sidebar ─────────────────────────────────────────────────────────
export function DesktopSidebar() {
  const [location] = useHashLocation();

  return (
    <aside
      className="hidden md:flex w-56 flex-shrink-0 flex-col"
      style={{
        background: "#13233A",
        borderRight: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Logo */}
      <div
        className="px-5 py-5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <CiqLogo size="md" />
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          const badge = NAV_BADGES[href];

          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-all"
              style={
                isActive
                  ? {
                      background: "rgba(255,255,255,0.09)",
                      color: "#F0EAD9",
                      borderLeft: "2px solid #A23B32",
                      paddingLeft: "10px",
                    }
                  : {
                      color: "rgba(216,204,184,0.65)",
                      borderLeft: "2px solid transparent",
                    }
              }
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.color = "#F0EAD9";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.65)";
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }
              }}
              data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
            >
              <Icon
                size={15}
                strokeWidth={isActive ? 2.2 : 1.8}
                style={{ flexShrink: 0, color: isActive ? "#C4B99A" : undefined }}
              />
              <span style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}>{label}</span>
              {badge && !isActive && (
                <span className={badge.style}>{badge.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Scanner status */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: "#3F6B4B", boxShadow: "0 0 0 0 rgba(63,107,75,0.4)", animation: "cardinal-pulse 2.5s ease-in-out infinite" }}
          />
          <span style={{ fontSize: 11, color: "rgba(216,204,184,0.5)", fontWeight: 500 }}>
            Scanner Active · 30 min
          </span>
        </div>
      </div>

      {/* Attribution */}
      <div className="px-4 pb-4">
        <a
          href="https://www.perplexity.ai/computer"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 10, color: "rgba(216,204,184,0.3)", transition: "color 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.6)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.3)"; }}
        >
          Created with Perplexity Computer
        </a>
      </div>
    </aside>
  );
}

// ── Mobile bottom tab bar ─────────────────────────────────────────────────
export function MobileTabBar() {
  const [location] = useHashLocation();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: "#13233A",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-stretch overflow-x-auto scrollbar-none">
        {navItems.map(({ href, label, mobileLabel, icon: Icon }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="relative flex-shrink-0 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors"
              style={{
                minWidth: 56,
                maxWidth: 64,
                color: isActive ? "#F0EAD9" : "rgba(216,204,184,0.45)",
              }}
              data-testid={`mobile-nav-${label.toLowerCase().replace(" ", "-")}`}
            >
              {/* Active indicator — cardinal red bar */}
              {isActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2"
                  style={{
                    width: 20,
                    height: 2,
                    borderRadius: 0,
                    background: "#A23B32",
                  }}
                />
              )}
              <Icon size={17} strokeWidth={isActive ? 2.2 : 1.6} />
              <span style={{ fontSize: 9, fontWeight: isActive ? 600 : 400, lineHeight: 1, whiteSpace: "nowrap" }}>
                {mobileLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default DesktopSidebar;
