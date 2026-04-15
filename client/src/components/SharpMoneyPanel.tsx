import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, BarChart2, AlertTriangle, DollarSign, Zap
} from "lucide-react";

// ── Theme ─────────────────────────────────────────────────────────────────────
const BG     = "#F6F1E7";
const NAV    = "#13233A";
const FG     = "#131A24";
const MUTED  = "#3D4B58";
const BORDER = "#D6CFC2";
const GREEN  = "#16a34a";
const RED    = "#dc2626";
const AMBER  = "#d97706";
const PURPLE = "#7c3aed";   // ticket % bar color
const GOLD   = "#d97706";   // money % bar color (amber/gold)
const SHARP_GREEN = "#16a34a"; // sharp money bar color

// ── Types ─────────────────────────────────────────────────────────────────────
interface SharpGameData {
  gameId: string; sport: string; homeTeam: string; awayTeam: string; startTime: string | null;
  pinnacleSpread: number | null; pinnacleTotal: number | null;
  pinnacleML: { home: number; away: number } | null;
  softSpread: number | null; softTotal: number | null;
  softML: { home: number; away: number } | null;
  spreadDivergence: number | null; totalDivergence: number | null;
  sharpBooksAgree: boolean; sharpSide: string | null;
  publicBetPct: { home: number | null; away: number | null; over: number | null; under: number | null };
  publicMoneyPct: { home: number | null; away: number | null; over: number | null; under: number | null };
  totalBets: number | null;
  rlmDetected: boolean; rlmSide: string | null; rlmDescription: string | null;
  sharpScore: number; sharpSignals: string[]; sharpDirection: string;
  sources: string[]; updatedAt: string;
  openedAt?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtML(n: number | null) {
  if (n === null) return "—";
  return n >= 0 ? `+${n}` : `${n}`;
}
function fmtSpread(n: number | null) {
  if (n === null) return "—";
  return n > 0 ? `+${n.toFixed(1)}` : `${n.toFixed(1)}`;
}
function mlToImplied(american: number): number {
  if (american < 0) return (-american) / (-american + 100) * 100;
  return 100 / (american + 100) * 100;
}
function truncateName(name: string, max = 8): string {
  if (name.length <= max) return name;
  // Try last word first (Cardinals → Cardin...)
  const words = name.split(" ");
  const last = words[words.length - 1];
  if (last.length <= max) return last.length >= 4 ? last.slice(0, max - 2) + ".." : name.slice(0, max - 2) + "..";
  return last.slice(0, max - 2) + "..";
}

// ── Person SVG icon (ticket %) ────────────────────────────────────────────────
function PersonIcon({ size = 12, color = MUTED }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="5" r="3" fill={color} />
      <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ── Dollar icon (money %) ─────────────────────────────────────────────────────
function DollarIcon({ size = 12, color = MUTED }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <text x="8" y="12" textAnchor="middle" fontSize="12" fontWeight="bold" fill={color}>$</text>
    </svg>
  );
}

// ── Two-bar row (ticket % + money %) ─────────────────────────────────────────
// isSharp = true → green bars + "Sharp ↑ X% $" label
// isSharp = false → normal bars + "Fade ↓ X% $" label
interface TwoBarRowProps {
  label: string;          // e.g. "Boston Red Sox (away)"
  ticketPct: number;      // 0–100
  moneyPct: number;       // 0–100
  isSharp: boolean;
  sharpLabel?: string;    // override "Sharp ↑" or "Fade ↓"
}
function TwoBarRow({ label, ticketPct, moneyPct, isSharp }: TwoBarRowProps) {
  const ticketBarColor = isSharp ? SHARP_GREEN : PURPLE;
  const moneyBarColor  = isSharp ? SHARP_GREEN : GOLD;
  const labelColor     = isSharp ? GREEN : RED;
  const arrow          = isSharp ? "↑" : "↓";
  const word           = isSharp ? "Sharp" : "Fade";

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Team name row + Sharp/Fade badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: FG, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: labelColor }}>
          {word} {arrow} {moneyPct.toFixed(0)}% $
        </span>
      </div>

      {/* Ticket % bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <PersonIcon size={12} color={MUTED} />
        <div style={{ flex: 1, height: 8, borderRadius: 99, background: "#E5E0D6", overflow: "hidden" }}>
          <div style={{ width: `${ticketPct}%`, height: "100%", borderRadius: 99, background: ticketBarColor, transition: "width 0.4s" }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: FG, minWidth: 28, textAlign: "right" }}>{ticketPct.toFixed(0)}%</span>
      </div>

      {/* Money % bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <DollarIcon size={12} color={MUTED} />
        <div style={{ flex: 1, height: 8, borderRadius: 99, background: "#E5E0D6", overflow: "hidden" }}>
          <div style={{ width: `${moneyPct}%`, height: "100%", borderRadius: 99, background: moneyBarColor, transition: "width 0.4s" }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: isSharp ? GREEN : FG, minWidth: 28, textAlign: "right" }}>{moneyPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, marginTop: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: FG, letterSpacing: "0.01em" }}>{title}</span>
    </div>
  );
}

// ── Derive all data needed for sections ───────────────────────────────────────
function deriveData(game: SharpGameData) {
  // Build public bet% from real data or synthetic from ML odds
  let awayTicket = game.publicBetPct.away;
  let homeTicket = game.publicBetPct.home;
  let awayMoney  = game.publicMoneyPct.away;
  let homeMoney  = game.publicMoneyPct.home;
  let overTicket = game.publicBetPct.over;
  let underTicket = game.publicBetPct.under;
  let overMoney  = game.publicMoneyPct.over;
  let underMoney = game.publicMoneyPct.under;
  let isSynthetic = false;

  const ml = game.pinnacleML ?? game.softML;

  // Synthetic from ML odds if real data missing
  if ((awayTicket === null || homeTicket === null) && ml) {
    const rawAway = mlToImplied(ml.away);
    const rawHome = mlToImplied(ml.home);
    const total   = rawAway + rawHome;
    awayTicket = (rawAway / total) * 100;
    homeTicket = (rawHome / total) * 100;
    isSynthetic = true;
  }
  if ((awayMoney === null || homeMoney === null) && ml) {
    const rawAway = mlToImplied(ml.away);
    const rawHome = mlToImplied(ml.home);
    const total   = rawAway + rawHome;
    // Bias money % slightly toward sharp side
    const sharpOnHome = game.sharpDirection === "home";
    const sharpOnAway = game.sharpDirection === "away";
    let awayMoneyBase = (rawAway / total) * 100;
    let homeMoneyBase = (rawHome / total) * 100;
    if (sharpOnHome) { homeMoneyBase = Math.min(85, homeMoneyBase + 12); awayMoneyBase = 100 - homeMoneyBase; }
    if (sharpOnAway) { awayMoneyBase = Math.min(85, awayMoneyBase + 12); homeMoneyBase = 100 - awayMoneyBase; }
    awayMoney  = awayMoneyBase;
    homeMoney  = homeMoneyBase;
    isSynthetic = true;
  }

  // O/U synthetic
  if (overTicket === null && underTicket === null) {
    const sharpOver  = game.sharpDirection === "over";
    const sharpUnder = game.sharpDirection === "under";
    overTicket  = sharpOver ? 70 : sharpUnder ? 30 : 50;
    underTicket = 100 - overTicket;
    isSynthetic = true;
  } else {
    if (overTicket === null && underTicket !== null) overTicket = 100 - underTicket;
    if (underTicket === null && overTicket !== null) underTicket = 100 - overTicket;
  }
  if (overMoney === null && underMoney === null) {
    const sharpOver  = game.sharpDirection === "over";
    const sharpUnder = game.sharpDirection === "under";
    overMoney  = sharpOver ? 75 : sharpUnder ? 25 : 50;
    underMoney = 100 - overMoney;
    isSynthetic = true;
  } else {
    if (overMoney === null && underMoney !== null) overMoney = 100 - underMoney;
    if (underMoney === null && overMoney !== null) underMoney = 100 - overMoney;
  }

  // Determine sharp side for each section
  const spreadSharpHome = game.sharpDirection === "home";
  const spreadSharpAway = game.sharpDirection === "away";
  const ouSharpOver     = game.sharpDirection === "over";
  const ouSharpUnder    = game.sharpDirection === "under";
  // For ML: same as spread direction
  const mlSharpHome = spreadSharpHome;
  const mlSharpAway = spreadSharpAway;

  return {
    awayTicket: awayTicket ?? 50,
    homeTicket: homeTicket ?? 50,
    awayMoney:  awayMoney  ?? 50,
    homeMoney:  homeMoney  ?? 50,
    overTicket:  overTicket  ?? 50,
    underTicket: underTicket ?? 50,
    overMoney:   overMoney   ?? 50,
    underMoney:  underMoney  ?? 50,
    spreadSharpHome,
    spreadSharpAway,
    ouSharpOver,
    ouSharpUnder,
    mlSharpHome,
    mlSharpAway,
    isSynthetic,
    ml,
  };
}

// ── Game card ─────────────────────────────────────────────────────────────────
function GameCard({ game }: { game: SharpGameData }) {
  const d = deriveData(game);

  const spread = game.pinnacleSpread ?? game.softSpread;
  const total  = game.pinnacleTotal  ?? game.softTotal;
  const ml     = d.ml;

  const startCT = game.startTime
    ? new Date(game.startTime).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
      }) + " CT"
    : null;

  const sportColors: Record<string, string> = {
    NBA: "#C9082A", MLB: "#002D72", NHL: "#000000", NFL: "#013369"
  };

  // Footer: opened time
  const openedCT = game.openedAt
    ? new Date(game.openedAt).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
      })
    : null;
  const updatedCT = new Date(game.updatedAt).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
  });
  const source = game.sources.includes("ActionNetwork") ? "ActionNetwork"
    : game.sources.includes("Pinnacle") ? "Pinnacle"
    : game.sources[0] ?? "Synthetic";

  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${BORDER}`,
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 12,
    }}>
      {/* ── Card header: sport pill + teams + time ── */}
      <div style={{ padding: "12px 14px 0 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
            background: sportColors[game.sport] || NAV, color: "#fff", flexShrink: 0
          }}>
            {game.sport}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: FG, margin: 0, lineHeight: 1.3 }}>
              {game.awayTeam} <span style={{ color: MUTED }}>@</span> {game.homeTeam}
            </p>
            {startCT && (
              <p style={{ fontSize: 10, color: MUTED, margin: 0 }}>{startCT}</p>
            )}
          </div>
          {/* Sharp score badge */}
          {game.sharpScore >= 40 && (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 99,
              background: game.sharpScore >= 70 ? `${GREEN}18` : `${AMBER}18`,
              color: game.sharpScore >= 70 ? GREEN : AMBER,
              border: `1px solid ${game.sharpScore >= 70 ? GREEN : AMBER}40`,
              flexShrink: 0,
            }}>
              {game.sharpScore >= 70 ? "SHARP" : "LEAN"} {game.sharpScore}
            </span>
          )}
        </div>
      </div>

      {/* ── SPREAD section ── */}
      {spread !== null && (
        <div style={{ padding: "0 14px" }}>
          <SectionHeader title={`SPREAD (${game.homeTeam.toUpperCase()})`} />
          <TwoBarRow
            label={`${game.awayTeam} (away)`}
            ticketPct={d.awayTicket}
            moneyPct={d.awayMoney}
            isSharp={d.spreadSharpAway}
          />
          <TwoBarRow
            label={`${game.homeTeam} (home)`}
            ticketPct={d.homeTicket}
            moneyPct={d.homeMoney}
            isSharp={d.spreadSharpHome}
          />
        </div>
      )}

      {/* ── TOTAL (O/U) section ── */}
      {total !== null && (
        <div style={{ padding: "0 14px" }}>
          <SectionHeader title="TOTAL (O/U)" />
          <TwoBarRow
            label="Over"
            ticketPct={d.overTicket}
            moneyPct={d.overMoney}
            isSharp={d.ouSharpOver}
          />
          <TwoBarRow
            label="Under"
            ticketPct={d.underTicket}
            moneyPct={d.underMoney}
            isSharp={d.ouSharpUnder}
          />
        </div>
      )}

      {/* ── MONEYLINE section ── */}
      {ml && (
        <div style={{ padding: "0 14px" }}>
          <SectionHeader title="MONEYLINE" />

          {/* Line display: Away — → -123 / Home — → -103 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: FG, minWidth: 60 }}>
                {truncateName(game.awayTeam, 6)}
              </span>
              <span style={{ fontSize: 13, color: MUTED }}>—</span>
              <span style={{ fontSize: 13, color: MUTED }}>→</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: FG }}>{fmtML(ml.away)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: FG, minWidth: 60 }}>
                {truncateName(game.homeTeam, 6)}
              </span>
              <span style={{ fontSize: 13, color: MUTED }}>—</span>
              <span style={{ fontSize: 13, color: MUTED }}>→</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: FG }}>{fmtML(ml.home)}</span>
            </div>
          </div>

          {/* Away team bars */}
          <TwoBarRow
            label={game.awayTeam}
            ticketPct={d.awayTicket}
            moneyPct={d.awayMoney}
            isSharp={d.mlSharpAway}
          />
          {/* Home team bars */}
          <TwoBarRow
            label={game.homeTeam}
            ticketPct={d.homeTicket}
            moneyPct={d.homeMoney}
            isSharp={d.mlSharpHome}
          />
        </div>
      )}

      {/* ── RLM alert (if detected) ── */}
      {game.rlmDetected && game.rlmDescription && (
        <div style={{ margin: "0 14px 10px 14px", borderRadius: 8, padding: "8px 10px", background: `${AMBER}12`, border: `1px solid ${AMBER}33` }}>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <AlertTriangle size={13} style={{ color: AMBER, flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: AMBER, margin: 0 }}>Reverse Line Movement</p>
              <p style={{ fontSize: 11, color: FG, margin: 0 }}>{game.rlmDescription}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Sharp signals ── */}
      {game.sharpSignals.filter(s => !s.includes("ML-implied") && !s.includes("BPI model")).length > 0 && (
        <div style={{ margin: "0 14px 10px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
          {game.sharpSignals
            .filter(s => !s.includes("ML-implied") && !s.includes("BPI model"))
            .slice(0, 3)
            .map((sig, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                <Zap size={10} style={{ color: GREEN, flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 10, color: MUTED, margin: 0 }}>{sig}</p>
              </div>
            ))}
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{
        padding: "8px 14px",
        borderTop: `1px solid ${BORDER}`,
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
      }}>
        {openedCT && (
          <span style={{ fontSize: 10, color: MUTED }}>
            <span style={{ fontWeight: 600 }}>Opened:</span> {openedCT}
          </span>
        )}
        <span style={{ fontSize: 10, color: MUTED }}>
          <span style={{ fontWeight: 600 }}>Updated:</span> {updatedCT}
        </span>
        {game.totalBets && (
          <span style={{ fontSize: 10, color: MUTED }}>
            {game.totalBets.toLocaleString()} total bets tracked
          </span>
        )}
        <span style={{ fontSize: 10, color: MUTED }}>
          via <span style={{ fontWeight: 600 }}>{source}</span>
          {d.isSynthetic && <span style={{ color: AMBER }}> (est.)</span>}
        </span>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export function SharpMoneyPanel() {
  const [sportFilter, setSportFilter] = useState<string>("ALL");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["sharp-money"],
    queryFn: async () => {
      const res = await fetch("/api/sharp-money");
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ games: SharpGameData[]; updatedAt: string }>;
    },
    refetchInterval: 15 * 60 * 1000,
    staleTime:       14 * 60 * 1000,
  });

  const allGames = data?.games || [];
  const games = allGames.filter(g => sportFilter === "ALL" || g.sport === sportFilter);
  const sharpCount = allGames.filter(g => g.sharpScore >= 60).length;
  const rlmCount   = allGames.filter(g => g.rlmDetected).length;

  const updatedAt = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
      }) + " CT"
    : null;

  const sportCounts = ["NBA", "MLB", "NHL", "NFL"].reduce((acc, s) => {
    acc[s] = allGames.filter(g => g.sport === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{ paddingBottom: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart2 size={15} style={{ color: NAV }} />
            <h2 style={{ fontSize: 15, fontWeight: 900, color: FG, margin: 0 }}>Sharp Money</h2>
          </div>
          <p style={{ fontSize: 10, color: MUTED, margin: "2px 0 0 0" }}>
            Pinnacle · ESPN · ActionNetwork{updatedAt ? ` · ${updatedAt}` : ""}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "6px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700,
            background: NAV, color: BG, border: "none", cursor: "pointer",
            opacity: isFetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={11} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>

      {/* ── Summary stats ── */}
      {allGames.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Games",  value: allGames.length, color: FG    },
            { label: "Sharp",  value: sharpCount,      color: GREEN },
            { label: "RLM",    value: rlmCount,        color: AMBER },
          ].map(stat => (
            <div key={stat.label} style={{
              background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: "8px 0", textAlign: "center"
            }}>
              <p style={{ fontSize: 18, fontWeight: 900, color: stat.color, margin: 0 }}>{stat.value}</p>
              <p style={{ fontSize: 9, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Sport filter pills ── */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
        {["ALL", "NBA", "MLB", "NHL", "NFL"].map(s => {
          const count = s === "ALL" ? allGames.length : sportCounts[s] ?? 0;
          const active = sportFilter === s;
          return (
            <button key={s}
              onClick={() => setSportFilter(s)}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", gap: 4,
                padding: "5px 12px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                background: active ? NAV : "#fff",
                color: active ? BG : MUTED,
                border: `1px solid ${active ? NAV : BORDER}`,
                cursor: "pointer",
              }}
            >
              {s}
              {count > 0 && (
                <span style={{
                  fontSize: 9, padding: "0 4px", borderRadius: 99,
                  background: active ? `${BG}30` : `${NAV}15`,
                  color: active ? BG : MUTED,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Alerts ── */}
      {sharpCount > 0 && (
        <div style={{
          borderRadius: 10, padding: "10px 12px", marginBottom: 12,
          background: `${GREEN}10`, border: `1px solid ${GREEN}30`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <DollarSign size={14} style={{ color: GREEN }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: GREEN, margin: 0 }}>
              {sharpCount} sharp play{sharpCount > 1 ? "s" : ""} detected
            </p>
            {rlmCount > 0 && (
              <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>{rlmCount} with RLM</p>
            )}
          </div>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 280, borderRadius: 14, background: `${NAV}10`, animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {isError && (
        <div style={{ borderRadius: 10, padding: 16, textAlign: "center", background: `#dc262610`, border: `1px solid #dc262630` }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: RED, margin: 0 }}>Failed to load sharp data</p>
          <button onClick={() => refetch()} style={{ fontSize: 11, color: RED, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", marginTop: 4 }}>Retry</button>
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && !isError && games.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: FG, margin: 0 }}>No games found</p>
          <p style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            {sportFilter !== "ALL" ? `No ${sportFilter} games today` : "No games found across all sports"}
          </p>
        </div>
      )}

      {/* ── Game cards ── */}
      {!isLoading && games.length > 0 && (
        <div>
          {games.map(g => (
            <GameCard key={g.gameId} game={g} />
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
