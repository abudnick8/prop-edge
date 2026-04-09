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

// ── Clubhouse IQ Logo — 2×2 sport grid with CH overlay + wordmark ──────────
// Matches the brand mark: baseball / basketball / billiards / football tiles
// with a bold "CH" letterform centred over the grid.
export function CiqLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  // Grid icon dimensions
  const gridSize  = size === "sm" ? 28 : size === "lg" ? 46 : 36;
  const scriptSz  = size === "sm" ? 15 : size === "lg" ? 23 : 18;
  const iqSz      = size === "sm" ? 13 : size === "lg" ? 21 : 16;
  const subSz     = size === "sm" ?  9 : size === "lg" ? 12 : 10;
  const showSub   = size !== "sm";
  const gap       = Math.round(gridSize * 0.055); // gap between tiles
  const tile      = (gridSize - gap) / 2;          // individual tile size
  const r         = Math.round(tile * 0.22);        // tile corner radius
  const chSz      = Math.round(gridSize * 0.48);    // CH letter size

  return (
    <div className="flex items-center gap-2.5" style={{ userSelect: "none" }}>
      {/* ── 2×2 sport grid icon ── */}
      <svg
        width={gridSize}
        height={gridSize}
        viewBox={`0 0 ${gridSize} ${gridSize}`}
        fill="none"
        aria-label="Clubhouse IQ logo"
        style={{ flexShrink: 0 }}
      >
        {/* ── Tile backgrounds ── */}
        {/* Top-left: cream/tan (baseball) */}
        <rect x="0" y="0" width={tile} height={tile} rx={r} fill="#D4C5A3" />
        {/* Top-right: dark navy (basketball) */}
        <rect x={tile + gap} y="0" width={tile} height={tile} rx={r} fill="#1A2F4A" />
        {/* Bottom-left: dark navy (billiards/golf) */}
        <rect x="0" y={tile + gap} width={tile} height={tile} rx={r} fill="#1A2F4A" />
        {/* Bottom-right: cardinal red (football) */}
        <rect x={tile + gap} y={tile + gap} width={tile} height={tile} rx={r} fill="#A23B32" />

        {/* ── Baseball (top-left tile) ── */}
        {(() => {
          const cx = tile / 2;
          const cy = tile / 2;
          const br = tile * 0.34;
          return (
            <g>
              <circle cx={cx} cy={cy} r={br} fill="#F0EAD9" stroke="#8B7355" strokeWidth={tile * 0.045} />
              {/* seam arcs */}
              <path
                d={`M${cx - br * 0.35} ${cy - br * 0.7} C${cx - br * 0.6} ${cy - br * 0.2} ${cx - br * 0.6} ${cy + br * 0.2} ${cx - br * 0.35} ${cy + br * 0.7}`}
                stroke="#A23B32" strokeWidth={tile * 0.07} fill="none" strokeLinecap="round"
              />
              <path
                d={`M${cx + br * 0.35} ${cy - br * 0.7} C${cx + br * 0.6} ${cy - br * 0.2} ${cx + br * 0.6} ${cy + br * 0.2} ${cx + br * 0.35} ${cy + br * 0.7}`}
                stroke="#A23B32" strokeWidth={tile * 0.07} fill="none" strokeLinecap="round"
              />
            </g>
          );
        })()}

        {/* ── Basketball (top-right tile) ── */}
        {(() => {
          const cx = tile + gap + tile / 2;
          const cy = tile / 2;
          const br = tile * 0.33;
          const sw = tile * 0.055;
          return (
            <g>
              <circle cx={cx} cy={cy} r={br} fill="#C85A1A" />
              {/* horizontal seam */}
              <path d={`M${cx - br} ${cy} Q${cx} ${cy - br * 0.5} ${cx + br} ${cy}`} stroke="#1A1A1A" strokeWidth={sw} fill="none" />
              <path d={`M${cx - br} ${cy} Q${cx} ${cy + br * 0.5} ${cx + br} ${cy}`} stroke="#1A1A1A" strokeWidth={sw} fill="none" />
              {/* vertical seam */}
              <path d={`M${cx} ${cy - br} Q${cx + br * 0.5} ${cy} ${cx} ${cy + br}`} stroke="#1A1A1A" strokeWidth={sw} fill="none" />
            </g>
          );
        })()}

        {/* ── Billiard/8-ball (bottom-left tile) ── */}
        {(() => {
          const cx = tile / 2;
          const cy = tile + gap + tile / 2;
          const br = tile * 0.33;
          return (
            <g>
              <circle cx={cx} cy={cy} r={br} fill="#1A1A1A" />
              <circle cx={cx} cy={cy} r={br * 0.42} fill="#F0EAD9" />
              <circle cx={cx} cy={cy} r={br * 0.22} fill="#1A1A1A" />
            </g>
          );
        })()}

        {/* ── Football (bottom-right tile) ── */}
        {(() => {
          const cx = tile + gap + tile / 2;
          const cy = tile + gap + tile / 2;
          const fw = tile * 0.64;
          const fh = tile * 0.44;
          const sw = tile * 0.055;
          return (
            <g>
              {/* ball body */}
              <ellipse cx={cx} cy={cy} rx={fw / 2} ry={fh / 2} fill="#7B4A2D" stroke="#C4A882" strokeWidth={sw * 0.8} />
              {/* laces */}
              <line x1={cx} y1={cy - fh * 0.28} x2={cx} y2={cy + fh * 0.28} stroke="#F0EAD9" strokeWidth={sw} strokeLinecap="round" />
              <line x1={cx - fw * 0.12} y1={cy - fh * 0.14} x2={cx + fw * 0.12} y2={cy - fh * 0.14} stroke="#F0EAD9" strokeWidth={sw} strokeLinecap="round" />
              <line x1={cx - fw * 0.12} y1={cy} x2={cx + fw * 0.12} y2={cy} stroke="#F0EAD9" strokeWidth={sw} strokeLinecap="round" />
              <line x1={cx - fw * 0.12} y1={cy + fh * 0.14} x2={cx + fw * 0.12} y2={cy + fh * 0.14} stroke="#F0EAD9" strokeWidth={sw} strokeLinecap="round" />
            </g>
          );
        })()}

        {/* ── "CH" letterform overlay — centred over entire grid ── */}
        <text
          x={gridSize / 2}
          y={gridSize / 2 + chSz * 0.35}
          textAnchor="middle"
          fontSize={chSz}
          fontWeight="900"
          fontFamily="'DM Sans', 'Arial Black', sans-serif"
          fill="rgba(255,255,255,0.92)"
          stroke="rgba(0,0,0,0.45)"
          strokeWidth={chSz * 0.055}
          paintOrder="stroke fill"
          letterSpacing="-1"
        >
          CH
        </text>
      </svg>

      {/* ── Wordmark ── */}
      <div className="leading-none">
        <div className="flex items-baseline gap-1">
          <span
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 700,
              fontSize: scriptSz,
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
              fontWeight: 800,
              fontSize: iqSz,
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
              fontSize: subSz,
              color: "rgba(216,204,184,0.55)",
              fontWeight: 500,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              marginTop: 3,
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
