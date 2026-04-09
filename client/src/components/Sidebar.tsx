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

// ── Clubhouse IQ Logo — exact brand mark recreation ─────────────────────
// 2×2 sport tile grid with large serif/block "CH" monogram overlay
// Tiles: baseball (cream) | basketball (navy) | golf green (navy) | football (tan-brown)
export function CiqLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  // All layout is relative to G (grid pixel size)
  const G        = size === "sm" ? 30 : size === "lg" ? 48 : 38;
  const scriptSz = size === "sm" ? 15 : size === "lg" ? 23 : 18;
  const iqSz     = size === "sm" ? 13 : size === "lg" ? 21 : 16;
  const subSz    = size === "sm" ?  9 : size === "lg" ? 12 : 10;
  const showSub  = size !== "sm";

  const gap  = G * 0.06;             // thin gap between tiles
  const T    = (G - gap) / 2;       // tile side length
  const R    = T * 0.18;            // tile corner radius

  // Tile top-left corners
  const TL = { x: 0,     y: 0     };
  const TR = { x: T+gap, y: 0     };
  const BL = { x: 0,     y: T+gap };
  const BR = { x: T+gap, y: T+gap };

  // Tile centres
  const C_TL = { x: T/2,       y: T/2       };
  const C_TR = { x: T+gap+T/2, y: T/2       };
  const C_BL = { x: T/2,       y: T+gap+T/2 };
  const C_BR = { x: T+gap+T/2, y: T+gap+T/2 };

  // CH monogram sizing — spans full grid, large block letters
  const CH_SIZE  = G * 0.58;   // font size
  const CH_CX    = G / 2;      // horizontal centre
  const CH_CY    = G / 2 + CH_SIZE * 0.34; // vertical baseline centre

  return (
    <div className="flex items-center gap-2.5" style={{ userSelect: "none" }}>
      {/* ── Grid mark ── */}
      <svg
        width={G}
        height={G}
        viewBox={`0 0 ${G} ${G}`}
        fill="none"
        aria-label="Clubhouse IQ"
        style={{ flexShrink: 0 }}
      >
        {/* ─── TILE BACKGROUNDS ─── */}
        {/* TL: warm cream — baseball */}
        <rect x={TL.x} y={TL.y} width={T} height={T} rx={R} fill="#D6C9A8" />
        {/* TR: deep navy — basketball */}
        <rect x={TR.x} y={TR.y} width={T} height={T} rx={R} fill="#1B2E45" />
        {/* BL: deep navy — golf green */}
        <rect x={BL.x} y={BL.y} width={T} height={T} rx={R} fill="#1B2E45" />
        {/* BR: warm tan/brown — football */}
        <rect x={BR.x} y={BR.y} width={T} height={T} rx={R} fill="#8B6240" />

        {/* ─── BASEBALL (top-left) ─── */}
        {(()=>{
          const { x: cx, y: cy } = C_TL;
          const br = T * 0.32;
          const sw = T * 0.065;
          return (
            <g>
              <circle cx={cx} cy={cy} r={br} fill="#F5EFE0" stroke="#9C8860" strokeWidth={T*0.04} />
              {/* left seam S-curve */}
              <path d={`M${cx-br*0.28} ${cy-br*0.85} C${cx-br*0.65} ${cy-br*0.3} ${cx-br*0.65} ${cy+br*0.3} ${cx-br*0.28} ${cy+br*0.85}`}
                stroke="#B03030" strokeWidth={sw} fill="none" strokeLinecap="round" />
              {/* right seam S-curve */}
              <path d={`M${cx+br*0.28} ${cy-br*0.85} C${cx+br*0.65} ${cy-br*0.3} ${cx+br*0.65} ${cy+br*0.3} ${cx+br*0.28} ${cy+br*0.85}`}
                stroke="#B03030" strokeWidth={sw} fill="none" strokeLinecap="round" />
              {/* left stitch ticks */}
              <line x1={cx-br*0.6} y1={cy-br*0.18} x2={cx-br*0.3} y2={cy-br*0.1} stroke="#B03030" strokeWidth={sw*0.6} strokeLinecap="round"/>
              <line x1={cx-br*0.6} y1={cy+br*0.18} x2={cx-br*0.3} y2={cy+br*0.1} stroke="#B03030" strokeWidth={sw*0.6} strokeLinecap="round"/>
              {/* right stitch ticks */}
              <line x1={cx+br*0.6} y1={cy-br*0.18} x2={cx+br*0.3} y2={cy-br*0.1} stroke="#B03030" strokeWidth={sw*0.6} strokeLinecap="round"/>
              <line x1={cx+br*0.6} y1={cy+br*0.18} x2={cx+br*0.3} y2={cy+br*0.1} stroke="#B03030" strokeWidth={sw*0.6} strokeLinecap="round"/>
            </g>
          );
        })()}

        {/* ─── BASKETBALL (top-right) ─── */}
        {(()=>{
          const { x: cx, y: cy } = C_TR;
          const br = T * 0.32;
          const sw = T * 0.055;
          return (
            <g>
              {/* ball */}
              <circle cx={cx} cy={cy} r={br} fill="#C85A18" />
              {/* clip to ball */}
              <clipPath id="bb-clip">
                <circle cx={cx} cy={cy} r={br} />
              </clipPath>
              <g clipPath="url(#bb-clip)">
                {/* horizontal equator */}
                <path d={`M${cx-br} ${cy} Q${cx} ${cy-br*0.55} ${cx+br} ${cy}`} stroke="#111" strokeWidth={sw} fill="none"/>
                <path d={`M${cx-br} ${cy} Q${cx} ${cy+br*0.55} ${cx+br} ${cy}`} stroke="#111" strokeWidth={sw} fill="none"/>
                {/* vertical meridian */}
                <path d={`M${cx} ${cy-br} Q${cx+br*0.42} ${cy} ${cx} ${cy+br}`} stroke="#111" strokeWidth={sw} fill="none"/>
              </g>
            </g>
          );
        })()}

        {/* ─── HOCKEY RINK (bottom-left) ─── */}
        {(()=>{
          const { x: cx, y: cy } = C_BL;
          const rw = T * 0.72;  // rink width
          const rh = T * 0.52;  // rink height
          const sw = T * 0.045;
          // puck
          const pr = T * 0.095;
          const px = cx + T * 0.06;
          const py = cy + T * 0.08;
          // stick — blade bottom-right, handle top-left
          const bx1 = cx - T*0.28, by1 = cy + T*0.25; // blade heel
          const bx2 = cx + T*0.02, by2 = cy + T*0.30; // blade toe
          const hx  = cx - T*0.10, hy  = cy - T*0.30; // handle top
          return (
            <g>
              {/* rink surface */}
              <rect x={cx - rw/2} y={cy - rh/2} width={rw} height={rh} rx={rh*0.35} fill="#D8EEF5" stroke="#A0C8DC" strokeWidth={sw*0.6} />
              {/* centre red line */}
              <line x1={cx} y1={cy - rh/2} x2={cx} y2={cy + rh/2} stroke="#CC2222" strokeWidth={sw*0.7} />
              {/* centre circle */}
              <circle cx={cx} cy={cy} r={rh*0.28} fill="none" stroke="#CC2222" strokeWidth={sw*0.6} />
              {/* centre dot */}
              <circle cx={cx} cy={cy} r={sw*0.6} fill="#CC2222" />
              {/* stick shaft */}
              <line x1={hx} y1={hy} x2={bx1} y2={by1} stroke="#5C3A1A" strokeWidth={sw*1.1} strokeLinecap="round" />
              {/* stick blade */}
              <line x1={bx1} y1={by1} x2={bx2} y2={by2} stroke="#5C3A1A" strokeWidth={sw*1.4} strokeLinecap="round" />
              {/* puck */}
              <ellipse cx={px} cy={py} rx={pr} ry={pr*0.5} fill="#1A1A1A" />
            </g>
          );
        })()}

        {/* ─── FOOTBALL (bottom-right) ─── */}
        {(()=>{
          const { x: cx, y: cy } = C_BR;
          const fw = T * 0.68;
          const fh = T * 0.46;
          const sw = T * 0.055;
          return (
            <g>
              <ellipse cx={cx} cy={cy} rx={fw/2} ry={fh/2} fill="#6B3A1F" stroke="#C4A06A" strokeWidth={sw*0.7} />
              {/* white stripe across middle */}
              <line x1={cx-fw*0.22} y1={cy} x2={cx+fw*0.22} y2={cy} stroke="#F5EFE0" strokeWidth={sw*1.8} strokeLinecap="round"/>
              {/* laces */}
              <line x1={cx} y1={cy-fh*0.3} x2={cx} y2={cy+fh*0.3} stroke="#F5EFE0" strokeWidth={sw*0.9} strokeLinecap="round"/>
              <line x1={cx-fw*0.11} y1={cy-fh*0.16} x2={cx+fw*0.11} y2={cy-fh*0.16} stroke="#F5EFE0" strokeWidth={sw*0.75} strokeLinecap="round"/>
              <line x1={cx-fw*0.11} y1={cy+fh*0.16} x2={cx+fw*0.11} y2={cy+fh*0.16} stroke="#F5EFE0" strokeWidth={sw*0.75} strokeLinecap="round"/>
            </g>
          );
        })()}

        {/* ─── "CH" MONOGRAM OVERLAY ───
             Large block serif letters spanning the full grid.
             White fill + dark outline so they read over any tile colour.
             The C sits left-of-centre, H sits right-of-centre. */}
        <text
          x={CH_CX}
          y={CH_CY}
          textAnchor="middle"
          fontSize={CH_SIZE}
          fontWeight="900"
          fontFamily="Georgia, 'Times New Roman', serif"
          fill="#FFFFFF"
          stroke="#13233A"
          strokeWidth={CH_SIZE * 0.07}
          paintOrder="stroke fill"
          letterSpacing={CH_SIZE * -0.04}
        >
          CH
        </text>
      </svg>

      {/* ── Wordmark ── */}
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
