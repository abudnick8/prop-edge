import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Minus, Zap, Eye,
  DollarSign, AlertTriangle, RefreshCw, BarChart2, Info
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
const BLUE   = "#2563eb";
const PURPLE = "#7c3aed";

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(s: number) {
  if (s >= 70) return GREEN;
  if (s >= 40) return AMBER;
  return MUTED;
}
function scoreLabel(s: number) {
  if (s >= 70) return "SHARP";
  if (s >= 40) return "LEAN";
  return "NEUTRAL";
}
function fmtML(n: number | null) {
  if (n === null) return "—";
  return n >= 0 ? `+${n}` : `${n}`;
}
function fmtSpread(n: number | null) {
  if (n === null) return "—";
  return n > 0 ? `+${n.toFixed(1)}` : `${n.toFixed(1)}`;
}

// Derive implied public lean % from ML odds (used when ActionNetwork bet% unavailable)
function mlToImplied(american: number): number {
  if (american < 0) return (-american) / (-american + 100) * 100;
  return 100 / (american + 100) * 100;
}

// ── Mini score ring ───────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const c = scoreColor(score);
  const r = 18, stroke = 3;
  const circumference = 2 * Math.PI * r;
  const dash = (score / 100) * circumference;
  return (
    <div className="relative flex items-center justify-center" style={{ width: 44, height: 44 }}>
      <svg width={44} height={44} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
        <circle cx={22} cy={22} r={r} fill="none" stroke={`${c}22`} strokeWidth={stroke} />
        <circle cx={22} cy={22} r={r} fill="none" stroke={c} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
      </svg>
      <span className="text-xs font-black relative z-10" style={{ color: c }}>{score}</span>
    </div>
  );
}

// ── Bar chart — sharp vs public side-by-side ──────────────────────────────────
function SharpVsPublicChart({ game }: { game: SharpGameData }) {
  // Get public lean for home side
  const publicHome = game.publicBetPct.home;
  const publicAway = publicHome !== null ? 100 - publicHome : null;

  // Get sharp side from sharpDirection
  const sharpOnHome = game.sharpDirection === "home";
  const sharpOnAway = game.sharpDirection === "away";
  const hasSharpSide = sharpOnHome || sharpOnAway;

  // Derive public % from ML if real bet% not available
  let derivedHomePublic = publicHome;
  let isSynthetic = false;
  if (derivedHomePublic === null && game.pinnacleML) {
    const rawHome = mlToImplied(game.pinnacleML.home);
    const rawAway = mlToImplied(game.pinnacleML.away);
    const total = rawHome + rawAway;
    derivedHomePublic = (rawHome / total) * 100;
    isSynthetic = true;
  } else if (derivedHomePublic === null && game.softML) {
    const rawHome = mlToImplied(game.softML.home);
    const rawAway = mlToImplied(game.softML.away);
    const total = rawHome + rawAway;
    derivedHomePublic = (rawHome / total) * 100;
    isSynthetic = true;
  }

  const derivedAwayPublic = derivedHomePublic !== null ? 100 - derivedHomePublic : null;

  if (derivedHomePublic === null) return null;

  const homeColor  = sharpOnHome ? GREEN  : sharpOnAway ? RED   : BLUE;
  const awayColor  = sharpOnAway ? GREEN  : sharpOnHome ? RED   : MUTED;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: FG }}>Public Lean</span>
        {isSynthetic && (
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: MUTED }}>
            <Info size={9} /> ML-implied
          </span>
        )}
      </div>

      {/* Home row */}
      <div className="space-y-0.5">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold truncate max-w-[100px]" style={{ color: FG }}>{game.homeTeam}</span>
            {sharpOnHome && <span className="text-[9px] font-black px-1 rounded" style={{ background: `${GREEN}22`, color: GREEN }}>SHARP</span>}
          </div>
          <span className="text-xs font-bold" style={{ color: homeColor }}>{derivedHomePublic.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: `${BORDER}` }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${derivedHomePublic}%`, background: homeColor }} />
        </div>
      </div>

      {/* Away row */}
      <div className="space-y-0.5">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold truncate max-w-[100px]" style={{ color: FG }}>{game.awayTeam}</span>
            {sharpOnAway && <span className="text-[9px] font-black px-1 rounded" style={{ background: `${GREEN}22`, color: GREEN }}>SHARP</span>}
          </div>
          <span className="text-xs font-bold" style={{ color: awayColor }}>{(derivedAwayPublic ?? 0).toFixed(0)}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${derivedAwayPublic ?? 0}%`, background: awayColor }} />
        </div>
      </div>

      {/* Sharp direction callout */}
      {hasSharpSide && (
        <div className="flex items-center gap-1.5 mt-1">
          <DollarSign size={10} style={{ color: GREEN }} />
          <span className="text-[11px] font-bold" style={{ color: GREEN }}>
            Sharp money on {sharpOnHome ? game.homeTeam : game.awayTeam}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Over/Under chart ──────────────────────────────────────────────────────────
function OverUnderChart({ game }: { game: SharpGameData }) {
  const overPct  = game.publicBetPct.over;
  const underPct = game.publicBetPct.under ?? (overPct !== null ? 100 - overPct : null);
  const sharpOver  = game.sharpDirection === "over";
  const sharpUnder = game.sharpDirection === "under";

  if (overPct === null && underPct === null) return null;

  const displayOver  = overPct  ?? (underPct !== null ? 100 - underPct : 50);
  const displayUnder = 100 - displayOver;

  return (
    <div className="space-y-2">
      <span className="text-xs font-bold" style={{ color: FG }}>O/U Lean</span>

      <div className="space-y-0.5">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold" style={{ color: FG }}>
              OVER {game.pinnacleTotal ?? game.softTotal ?? ""}
            </span>
            {sharpOver && <span className="text-[9px] font-black px-1 rounded" style={{ background: `${GREEN}22`, color: GREEN }}>SHARP</span>}
          </div>
          <span className="text-xs font-bold" style={{ color: sharpOver ? GREEN : sharpUnder ? RED : BLUE }}>
            {displayOver.toFixed(0)}%
          </span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
          <div className="h-full rounded-full"
            style={{ width: `${displayOver}%`, background: sharpOver ? GREEN : sharpUnder ? RED : BLUE }} />
        </div>
      </div>

      <div className="space-y-0.5">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold" style={{ color: FG }}>UNDER</span>
            {sharpUnder && <span className="text-[9px] font-black px-1 rounded" style={{ background: `${GREEN}22`, color: GREEN }}>SHARP</span>}
          </div>
          <span className="text-xs font-bold" style={{ color: sharpUnder ? GREEN : sharpOver ? RED : MUTED }}>
            {displayUnder.toFixed(0)}%
          </span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
          <div className="h-full rounded-full"
            style={{ width: `${displayUnder}%`, background: sharpUnder ? GREEN : sharpOver ? RED : MUTED }} />
        </div>
      </div>

      {(sharpOver || sharpUnder) && (
        <div className="flex items-center gap-1.5 mt-1">
          <DollarSign size={10} style={{ color: GREEN }} />
          <span className="text-[11px] font-bold" style={{ color: GREEN }}>
            Sharp money on {sharpOver ? "OVER" : "UNDER"}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Line divergence bar chart ─────────────────────────────────────────────────
function LineDivergenceChart({ game }: { game: SharpGameData }) {
  const hasSpread = game.pinnacleSpread !== null;
  const hasTotal  = game.pinnacleTotal  !== null;
  if (!hasSpread && !hasTotal) return null;

  // Show Pinnacle vs DK/soft side-by-side bars
  const items: { label: string; pin: number | null; soft: number | null; div: number | null; isTotal?: boolean }[] = [];

  if (hasSpread) {
    items.push({
      label: "Spread (home)",
      pin:  game.pinnacleSpread,
      soft: game.softSpread,
      div:  game.spreadDivergence,
    });
  }
  if (hasTotal) {
    items.push({
      label: "Total",
      pin:  game.pinnacleTotal,
      soft: game.softTotal,
      div:  game.totalDivergence,
      isTotal: true,
    });
  }

  return (
    <div className="space-y-3">
      <span className="text-xs font-bold" style={{ color: FG }}>Line Comparison (Pinnacle vs Market)</span>
      {items.map(item => {
        const showDiv = item.div !== null && Math.abs(item.div) >= 0.5;
        const divColor = showDiv
          ? Math.abs(item.div!) >= 1.5 ? GREEN : AMBER
          : MUTED;

        // Normalize bars: use absolute values for visual width
        const pinVal  = item.pin  !== null ? Math.abs(item.pin)  : null;
        const softVal = item.soft !== null ? Math.abs(item.soft) : null;
        const maxVal  = Math.max(pinVal ?? 0, softVal ?? 0, 1);
        const pinW    = pinVal  !== null ? (pinVal  / maxVal) * 100 : 0;
        const softW   = softVal !== null ? (softVal / maxVal) * 100 : 0;

        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold" style={{ color: MUTED }}>{item.label}</span>
              {showDiv && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded" style={{
                  background: `${divColor}20`, color: divColor
                }}>
                  {item.div! > 0 ? "+" : ""}{item.div!.toFixed(1)} divergence
                </span>
              )}
            </div>

            {/* Pinnacle bar */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] w-12 shrink-0 font-bold" style={{ color: NAV }}>PIN</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
                <div className="h-full rounded-full" style={{ width: `${pinW}%`, background: NAV }} />
              </div>
              <span className="text-[10px] font-bold w-10 text-right" style={{ color: FG }}>
                {item.pin !== null ? (item.isTotal ? item.pin.toFixed(1) : fmtSpread(item.pin)) : "—"}
              </span>
            </div>

            {/* Soft book bar */}
            {item.soft !== null && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] w-12 shrink-0 font-bold" style={{ color: MUTED }}>MARKET</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
                  <div className="h-full rounded-full" style={{ width: `${softW}%`, background: MUTED }} />
                </div>
                <span className="text-[10px] font-bold w-10 text-right" style={{ color: MUTED }}>
                  {item.isTotal ? item.soft.toFixed(1) : fmtSpread(item.soft)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Moneyline chart ───────────────────────────────────────────────────────────
function MoneylineChart({ game }: { game: SharpGameData }) {
  const ml = game.pinnacleML ?? game.softML;
  if (!ml) return null;

  const homeImp = mlToImplied(ml.home);
  const awayImp = mlToImplied(ml.away);
  const total   = homeImp + awayImp;
  const homeNorm = (homeImp / total) * 100;
  const awayNorm = 100 - homeNorm;

  const source = game.pinnacleML ? "Pinnacle" : "Market";
  const homeColor = homeNorm > 55 ? GREEN : homeNorm < 45 ? RED : MUTED;
  const awayColor = awayNorm > 55 ? GREEN : awayNorm < 45 ? RED : MUTED;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: FG }}>Moneyline ({source})</span>
      </div>

      {/* Visual split bar */}
      <div className="flex h-3 rounded-full overflow-hidden">
        <div style={{ width: `${awayNorm}%`, background: awayColor, opacity: 0.8 }} />
        <div style={{ width: `${homeNorm}%`, background: homeColor }} />
      </div>

      <div className="flex justify-between">
        <div className="text-left">
          <p className="text-[10px]" style={{ color: MUTED }}>{game.awayTeam}</p>
          <p className="text-xs font-bold" style={{ color: FG }}>{fmtML(ml.away)}</p>
          <p className="text-[10px]" style={{ color: awayColor }}>{awayNorm.toFixed(0)}% implied</p>
        </div>
        <div className="text-right">
          <p className="text-[10px]" style={{ color: MUTED }}>{game.homeTeam}</p>
          <p className="text-xs font-bold" style={{ color: FG }}>{fmtML(ml.home)}</p>
          <p className="text-[10px]" style={{ color: homeColor }}>{homeNorm.toFixed(0)}% implied</p>
        </div>
      </div>
    </div>
  );
}

// ── Game card ─────────────────────────────────────────────────────────────────
function GameCard({ game, expanded, onToggle }: { game: SharpGameData; expanded: boolean; onToggle: () => void }) {
  const sc    = scoreColor(game.sharpScore);
  const label = scoreLabel(game.sharpScore);

  const startCT = game.startTime
    ? new Date(game.startTime).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
      }) + " CT"
    : null;

  const sportColors: Record<string, string> = {
    NBA: "#C9082A", MLB: "#002D72", NHL: "#000000", NFL: "#013369"
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>

      {/* ── Card header (always visible) ── */}
      <button className="w-full text-left p-3.5" onClick={onToggle}>
        <div className="flex items-center gap-2">
          {/* Sport tag */}
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{ background: sportColors[game.sport] || NAV, color: "#fff" }}>
            {game.sport}
          </span>

          {/* Teams + time */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight truncate" style={{ color: FG }}>
              {game.awayTeam} <span style={{ color: MUTED }}>@</span> {game.homeTeam}
            </p>
            {startCT && <p className="text-[10px]" style={{ color: MUTED }}>{startCT}</p>}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5 shrink-0">
            {game.rlmDetected && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${AMBER}22`, color: AMBER, border: `1px solid ${AMBER}44` }}>
                RLM
              </span>
            )}
            {game.sharpBooksAgree && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${BLUE}22`, color: BLUE, border: `1px solid ${BLUE}44` }}>
                BOOKS
              </span>
            )}
            {/* Direction */}
            {game.sharpDirection !== "neutral" && (
              game.sharpDirection === "home" || game.sharpDirection === "over"
                ? <TrendingUp size={13} style={{ color: GREEN }} />
                : <TrendingDown size={13} style={{ color: RED }} />
            )}
            <ScoreRing score={game.sharpScore} />
          </div>
        </div>

        {/* ── Inline chart preview (always shown, not just expanded) ── */}
        <div className="mt-2.5 space-y-2">
          <SharpVsPublicChart game={game} />
        </div>

        {/* Quick line row */}
        {(game.pinnacleSpread !== null || game.pinnacleTotal !== null || game.softSpread !== null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {(game.pinnacleSpread ?? game.softSpread) !== null && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold" style={{ color: MUTED }}>
                  {game.pinnacleSpread !== null ? "PIN" : "MKT"} Spread
                </span>
                <span className="text-[11px] font-bold" style={{ color: FG }}>
                  {fmtSpread(game.pinnacleSpread ?? game.softSpread)}
                </span>
                {game.spreadDivergence !== null && Math.abs(game.spreadDivergence) >= 0.5 && (
                  <span className="text-[10px] font-bold px-1 rounded" style={{
                    background: `${sc}18`, color: sc
                  }}>
                    {game.spreadDivergence > 0 ? "+" : ""}{game.spreadDivergence.toFixed(1)}
                  </span>
                )}
              </div>
            )}
            {(game.pinnacleTotal ?? game.softTotal) !== null && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold" style={{ color: MUTED }}>O/U</span>
                <span className="text-[11px] font-bold" style={{ color: FG }}>
                  {(game.pinnacleTotal ?? game.softTotal)?.toFixed(1)}
                </span>
              </div>
            )}
          </div>
        )}
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t px-3.5 pb-4 pt-3 space-y-4" style={{ borderColor: BORDER }}>

          {/* Line divergence chart */}
          <LineDivergenceChart game={game} />

          {/* O/U chart */}
          {(game.publicBetPct.over !== null ||
            game.sharpDirection === "over" ||
            game.sharpDirection === "under") && (
            <OverUnderChart game={game} />
          )}

          {/* Moneyline chart */}
          <MoneylineChart game={game} />

          {/* RLM alert */}
          {game.rlmDetected && game.rlmDescription && (
            <div className="rounded-xl p-3 flex gap-2"
              style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}33` }}>
              <AlertTriangle size={14} style={{ color: AMBER }} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold" style={{ color: AMBER }}>Reverse Line Movement</p>
                <p className="text-xs mt-0.5" style={{ color: FG }}>{game.rlmDescription}</p>
              </div>
            </div>
          )}

          {/* Sharp signals */}
          {game.sharpSignals.filter(s =>
            !s.includes("ML-implied") && !s.includes("BPI model")
          ).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold" style={{ color: FG }}>Sharp Signals</p>
              {game.sharpSignals
                .filter(s => !s.includes("ML-implied") && !s.includes("BPI model"))
                .map((sig, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <Zap size={11} style={{ color: sc }} className="shrink-0 mt-0.5" />
                    <p className="text-xs" style={{ color: MUTED }}>{sig}</p>
                  </div>
                ))}
            </div>
          )}

          {/* Public money % bars (if real data from ActionNetwork) */}
          {game.publicMoneyPct.home !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Eye size={11} style={{ color: BLUE }} />
                <span className="text-xs font-bold" style={{ color: BLUE }}>Money % (ActionNetwork)</span>
              </div>
              {[
                { label: `${game.homeTeam} $`, pct: game.publicMoneyPct.home, color: GREEN },
                { label: `${game.awayTeam} $`, pct: game.publicMoneyPct.away, color: RED },
              ].filter(r => r.pct !== null).map(row => (
                <div key={row.label} className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: MUTED }}>{row.label}</span>
                    <span className="font-bold" style={{ color: row.color }}>{row.pct!.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
                    <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.color }} />
                  </div>
                </div>
              ))}
              {game.totalBets && (
                <p className="text-[10px]" style={{ color: MUTED }}>
                  {game.totalBets.toLocaleString()} total bets tracked
                </p>
              )}
            </div>
          )}

          {/* Sources */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[10px]" style={{ color: MUTED }}>Data:</span>
            {game.sources.map(s => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: `${NAV}12`, color: MUTED }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export function SharpMoneyPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const sharpGames = games.filter(g => g.sharpScore >= 60);
  const rlmGames   = games.filter(g => g.rlmDetected);

  const updatedAt = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"
      }) + " CT"
    : null;

  // Count by sport for filter pills
  const sportCounts = ["NBA", "MLB", "NHL", "NFL"].reduce((acc, s) => {
    acc[s] = allGames.filter(g => g.sport === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 size={16} style={{ color: NAV }} />
            <h2 className="text-base font-black" style={{ color: FG }}>Sharp Money</h2>
          </div>
          <p className="text-xs mt-0.5" style={{ color: MUTED }}>
            Pinnacle · ESPN · OddsPapi{updatedAt ? ` · ${updatedAt}` : ""}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
          style={{ background: NAV, color: BG, opacity: isFetching ? 0.6 : 1 }}
        >
          <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Summary stats ── */}
      {allGames.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Games", value: allGames.length,    color: FG   },
            { label: "Sharp",  value: allGames.filter(g => g.sharpScore >= 60).length, color: GREEN },
            { label: "RLM",    value: allGames.filter(g => g.rlmDetected).length,      color: AMBER },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl p-2.5 text-center"
              style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
              <p className="text-lg font-black" style={{ color: stat.color }}>{stat.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Sport filter ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["ALL", "NBA", "MLB", "NHL", "NFL"].map(s => {
          const count = s === "ALL" ? allGames.length : sportCounts[s] ?? 0;
          return (
            <button key={s}
              onClick={() => setSportFilter(s)}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{
                background: sportFilter === s ? NAV : "#fff",
                color: sportFilter === s ? BG : MUTED,
                border: `1px solid ${sportFilter === s ? NAV : BORDER}`,
              }}
            >
              {s}
              {count > 0 && (
                <span className="text-[9px] px-1 rounded-full"
                  style={{ background: sportFilter === s ? `${BG}30` : `${NAV}15`, color: sportFilter === s ? BG : MUTED }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Sharp alert banner ── */}
      {sharpGames.length > 0 && (
        <div className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: `${GREEN}10`, border: `1px solid ${GREEN}30` }}>
          <DollarSign size={15} style={{ color: GREEN }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: GREEN }}>
              {sharpGames.length} sharp play{sharpGames.length > 1 ? "s" : ""} detected
            </p>
            <p className="text-xs" style={{ color: MUTED }}>
              {rlmGames.length > 0 ? `${rlmGames.length} RLM · ` : ""}
              {games.filter(g => g.sharpBooksAgree).length} multi-book agreement
            </p>
          </div>
        </div>
      )}

      {/* ── RLM alert ── */}
      {rlmGames.length > 0 && sharpGames.length === 0 && (
        <div className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: `${AMBER}10`, border: `1px solid ${AMBER}30` }}>
          <AlertTriangle size={15} style={{ color: AMBER }} />
          <p className="text-sm font-bold" style={{ color: AMBER }}>
            {rlmGames.length} Reverse Line Movement alert{rlmGames.length > 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: `${NAV}10` }} />
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {isError && (
        <div className="rounded-xl p-4 text-center"
          style={{ background: `${RED}10`, border: `1px solid ${RED}30` }}>
          <p className="text-sm font-bold" style={{ color: RED }}>Failed to load sharp data</p>
          <button onClick={() => refetch()} className="text-xs mt-1 underline" style={{ color: RED }}>Retry</button>
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && !isError && games.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm font-bold" style={{ color: FG }}>No games found</p>
          <p className="text-xs mt-1" style={{ color: MUTED }}>
            {sportFilter !== "ALL"
              ? `No ${sportFilter} games today`
              : "No games found across all sports"}
          </p>
        </div>
      )}

      {/* ── Game cards ── */}
      {!isLoading && games.length > 0 && (
        <div className="space-y-3">
          {games.map(g => (
            <GameCard
              key={g.gameId}
              game={g}
              expanded={expandedId === g.gameId}
              onToggle={() => setExpandedId(expandedId === g.gameId ? null : g.gameId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
