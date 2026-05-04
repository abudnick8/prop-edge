import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import chLogoSrc from "@assets/ch-logo.jpg";
import {
  LayoutDashboard, Target, Settings, Trophy, Ticket,
  TrendingUp, BarChart2, Shuffle, Zap, LineChart, Activity, Brain, Lock, LogOut, Crown,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

// tier: undefined = free (always accessible when logged in)
//       'basic' = basic + pro + owner
//       'pro'   = pro + owner only
const navItems = [
  { href: "/",            label: "Dashboard",      mobileLabel: "Home",     icon: LayoutDashboard, tier: "basic"   },
  { href: "/scores",      label: "Live Scores",    mobileLabel: "Scores",   icon: Activity,        tier: undefined },
  { href: "/clv",         label: "Line Movement",  mobileLabel: "Lines",    icon: TrendingUp,      tier: "pro"     },
  { href: "/markets",     label: "Pred. Markets",  mobileLabel: "Markets",  icon: BarChart2,       tier: "pro"     },
  { href: "/bts",         label: "Beat the Streak",mobileLabel: "BTS",      icon: Trophy,          tier: "pro"     },
  { href: "/conviction",  label: "Top Plays",      mobileLabel: "Top",      icon: Zap,             tier: "pro"     },
  { href: "/bets",        label: "All Picks",      mobileLabel: "Picks",    icon: Target,          tier: "pro"     },
  { href: "/linemate",    label: "Props Hub",      mobileLabel: "Props",    icon: LineChart,       tier: "basic"   },
  { href: "/fantasy",     label: "Fantasy",        mobileLabel: "Fantasy",  icon: Shuffle,         tier: undefined },
  { href: "/lotto",       label: "Lotto",          mobileLabel: "Lotto",    icon: Ticket,          tier: "basic"   },
  { href: "/bracket",     label: "Bracket",        mobileLabel: "Bracket",  icon: Trophy,          tier: "pro"     },
  { href: "/ml-insights", label: "ML Intel",       mobileLabel: "ML Intel", icon: Brain,           tier: "pro"     },
  { href: "/pricing",     label: "Upgrade",        mobileLabel: "Upgrade",  icon: Crown,           tier: undefined },
  { href: "/settings",    label: "Settings",       mobileLabel: "Settings", icon: Settings,        tier: undefined },
];

// Owner-only nav item — appended dynamically when isOwner=true
const ownerNavItem = { href: "/insights", label: "App Insights", mobileLabel: "Insights", icon: BarChart2, tier: undefined };

// Nav item badge definitions — editorial, restrained
const NAV_BADGES: Record<string, { label: string; style: string }> = {
  "/scores":     { label: "LIVE", style: "badge-live" },
  "/markets":    { label: "LIVE", style: "badge-live" },
  "/conviction": { label: "HOT",  style: "badge-hot" },
  "/lotto":      { label: "HOT",  style: "badge-hot" },
  "/linemate":   { label: "NEW",  style: "badge-new" },
  "/fantasy":    { label: "NEW",  style: "badge-new" },
  "/ml-insights": { label: "NEW",  style: "badge-new" },
  "/bts":          { label: "NEW",  style: "badge-new" },
};

// ── Clubhouse IQ Logo — exact brand image + cursive wordmark ─────────────
export function CiqLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const imgSize  = size === "sm" ? 30 : size === "lg" ? 48 : 38;
  const scriptSz = size === "sm" ? 15 : size === "lg" ? 23 : 18;
  const iqSz     = size === "sm" ? 13 : size === "lg" ? 21 : 16;
  const subSz    = size === "sm" ?  9 : size === "lg" ? 12 : 10;
  const showSub  = size !== "sm";

  return (
    <div className="flex items-center gap-2.5" style={{ userSelect: "none" }}>
      {/* Exact brand image */}
      <img
        src={chLogoSrc}
        alt="Clubhouse IQ"
        width={imgSize}
        height={imgSize}
        style={{ borderRadius: 6, flexShrink: 0, objectFit: "contain" }}
      />
      {/* Cursive wordmark */}
      <div className="leading-none">
        <div className="flex items-baseline gap-1">
          <span style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontStyle: "italic",
            fontWeight: 700,
            fontSize: scriptSz,
            color: "#F0EAD9",
            letterSpacing: "-0.01em",
            lineHeight: 1,
          }}>Clubhouse</span>
          <span style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 800,
            fontSize: iqSz,
            color: "#A23B32",
            letterSpacing: "0.06em",
            lineHeight: 1,
          }}>IQ</span>
        </div>
        {showSub && (
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: subSz,
            color: "rgba(216,204,184,0.55)",
            fontWeight: 500,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            marginTop: 3,
            lineHeight: 1,
          }}>Sports Intelligence</p>
        )}
      </div>
    </div>
  );
}

// ── Desktop sidebar ─────────────────────────────────────────────────────────
export function DesktopSidebar() {
  const [location] = useHashLocation();
  const { user, isOwner, isPro, isBasic, logout } = useAuth();

  function canAccess(tier?: string) {
    if (isOwner) return true;
    if (!tier)   return true;               // free tier — always accessible when logged in
    if (tier === "basic") return isBasic;   // basic or pro
    if (tier === "pro")   return isPro;     // pro only
    return false;
  }

  return (
    <aside
      className="hidden md:flex w-56 flex-shrink-0 flex-col"
      style={{ background: "#13233A", borderRight: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <CiqLogo size="md" />
      </div>

      {/* User badge */}
      {user && (
        <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
              style={{ background: isOwner ? "#A23B32" : isPro ? "#2563eb" : "#3D4B58", color: "#F0EAD9" }}>
              {isOwner ? "👑" : user.email[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold truncate" style={{ color: "#F0EAD9" }}>{user.email}</p>
              <p className="text-[9px]" style={{ color: isOwner ? "#A23B32" : isPro ? "#60a5fa" : "rgba(216,204,184,0.5)" }}>
                {isOwner ? "Owner" : isPro ? "Pro" : isBasic ? "Basic" : "Inactive"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {[...navItems, ...(isOwner ? [ownerNavItem] : [])].map(({ href, label, icon: Icon, tier }) => {
          const accessible = canAccess(tier);
          const isActive   = location === href || (href !== "/" && location.startsWith(href));
          const badge      = NAV_BADGES[href];

          if (!accessible) {
            return (
              <div
                key={href}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm cursor-default"
                style={{ color: "rgba(216,204,184,0.3)", borderLeft: "2px solid transparent" }}
                title={tier === "pro" ? "Pro — $15/mo · Tap Upgrade to subscribe" : "Basic — $5/mo · Tap Upgrade to subscribe"}
              >
                <Icon size={15} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{label}</span>
                <Lock size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
              </div>
            );
          }

          return (
            <Link
              key={href} href={href}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-all"
              style={
                isActive
                  ? { background: "rgba(255,255,255,0.09)", color: "#F0EAD9", borderLeft: "2px solid #A23B32", paddingLeft: "10px" }
                  : { color: "rgba(216,204,184,0.65)", borderLeft: "2px solid transparent" }
              }
              onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = "#F0EAD9"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; } }}
              onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.65)"; (e.currentTarget as HTMLElement).style.background = "transparent"; } }}
              data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
            >
              <Icon size={15} strokeWidth={isActive ? 2.2 : 1.8} style={{ flexShrink: 0, color: isActive ? "#C4B99A" : undefined }} />
              <span style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}>{label}</span>
              {badge && !isActive && <span className={badge.style}>{badge.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Scanner status */}
      <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: "#3F6B4B", animation: "cardinal-pulse 2.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 11, color: "rgba(216,204,184,0.5)", fontWeight: 500 }}>Scanner Active · 30 min</span>
        </div>
      </div>

      {/* Logout */}
      <div className="px-3 pb-3">
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all"
          style={{ color: "rgba(216,204,184,0.4)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f87171"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.4)"; }}
        >
          <LogOut size={14} />
          <span>Log out</span>
        </button>
      </div>

      {/* Attribution */}
      <div className="px-4 pb-4">
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 10, color: "rgba(216,204,184,0.3)", transition: "color 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.6)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(216,204,184,0.3)"; }}
        >Created with Perplexity Computer</a>
      </div>
    </aside>
  );
}

// ── Mobile bottom tab bar ─────────────────────────────────────────────────
export function MobileTabBar() {
  const [location] = useHashLocation();
  const { isOwner, isPro, isBasic } = useAuth();

  function canAccess(tier?: string) {
    if (isOwner) return true;
    if (!tier)   return true;               // free tier — always accessible when logged in
    if (tier === "basic") return isBasic;   // basic or pro
    if (tier === "pro")   return isPro;     // pro only
    return false;
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{ background: "#13233A", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-stretch overflow-x-auto scrollbar-none">
        {[...navItems, ...(isOwner ? [ownerNavItem] : [])].map(({ href, label, mobileLabel, icon: Icon, tier }) => {
          const isActive   = location === href || (href !== "/" && location.startsWith(href));
          const accessible = canAccess(tier);
          return (
            <Link
              key={href}
              href={accessible ? href : location}
              className="relative flex-shrink-0 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors"
              style={{ minWidth: 56, maxWidth: 64, color: !accessible ? "rgba(216,204,184,0.2)" : isActive ? "#F0EAD9" : "rgba(216,204,184,0.45)" }}
              data-testid={`mobile-nav-${label.toLowerCase().replace(" ", "-")}`}
            >
              {isActive && accessible && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2"
                  style={{ width: 20, height: 2, borderRadius: 0, background: "#A23B32" }} />
              )}
              {accessible
                ? <Icon size={17} strokeWidth={isActive ? 2.2 : 1.6} />
                : <Lock size={15} strokeWidth={1.5} />}
              <span style={{ fontSize: 9, fontWeight: isActive && accessible ? 600 : 400, lineHeight: 1, whiteSpace: "nowrap" }}>
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
