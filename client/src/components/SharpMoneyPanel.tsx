import { useState } from "react";
/**
 * SharpMoneyPanel — Clubhouse IQ
 * Shows real sharp money data from Pinnacle, OddsPapi, and ActionNetwork
 * for all 4 sports. Displayed in the Line Movement tab.
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, Zap, Eye, DollarSign, AlertTriangle, RefreshCw } from "lucide-react";

const BG     = "#F6F1E7";
const NAV    = "#13233A";
const FG     = "#131A24";
const MUTED  = "#3D4B58";
const BORDER = "#D6CFC2";
const GREEN  = "#16a34a";
const RED    = "#dc2626";
const AMBER  = "#d97706";
const BLUE   = "#2563eb";

interface SharpGameData {
  gameId: string; sport: string; homeTeam: string; awayTeam: string; startTime: string | null;
  pinnacleSpread: number | null; pinnacleTotal: number | null; pinnacleML: { home: number; away: number } | null;
  softSpread: number | null; softTotal: number | null;
  spreadDivergence: number | null; totalDivergence: number | null;
  sharpBooksAgree: boolean; sharpSide: string | null;
  publicBetPct: { home: number | null; away: number | null; over: number | null; under: number | null };
  publicMoneyPct: { home: number | null; away: number | null; over: number | null; under: number | null };
  totalBets: number | null;
  rlmDetected: boolean; rlmSide: string | null; rlmDescription: string | null;
  sharpScore: number; sharpSignals: string[]; sharpDirection: string;
  sources: string[]; updatedAt: string;
}

function scoreColor(score: number) {
  if (score >= 70) return GREEN;
  if (score >= 40) return AMBER;
  return MUTED;
}

function scoreLabel(score: number) {
  if (score >= 70) return "SHARP";
  if (score >= 40) return "LEAN";
  return "NEUTRAL";
}

function formatAmerican(n: number | null) {
  if (n === null) return "—";
  return n >= 0 ? `+${n}` : `${n}`;
}

function formatSpread(n: number | null) {
  if (n === null) return "—";
  return n >= 0 ? `+${n.toFixed(1)}` : `${n.toFixed(1)}`;
}

function SportBadge({ sport }: { sport: string }) {
  const colors: Record<string, string> = {
    NBA: "#C9082A", MLB: "#002D72", NHL: "#000000", NFL: "#013369"
  };
  return (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: colors[sport] || NAV, color: "#fff" }}>
      {sport}
    </span>
  );
}

function DirectionArrow({ dir }: { dir: string }) {
  if (dir === "home" || dir === "over") return <TrendingUp size={14} style={{ color: GREEN }} />;
  if (dir === "away" || dir === "under") return <TrendingDown size={14} style={{ color: RED }} />;
  return <Minus size={14} style={{ color: MUTED }} />;
}

function GameCard({ game, expanded, onToggle }: { game: SharpGameData; expanded: boolean; onToggle: () => void }) {
  const sc = scoreColor(game.sharpScore);
  const label = scoreLabel(game.sharpScore);

  const startCT = game.startTime
    ? new Date(game.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT"
    : null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: `1px solid ${BORDER}` }}>
      {/* Header */}
      <button className="w-full text-left p-3.5" onClick={onToggle}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <SportBadge sport={game.sport} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate" style={{ color: FG }}>
                {game.awayTeam} @ {game.homeTeam}
              </div>
              {startCT && (
                <div className="text-xs" style={{ color: MUTED }}>{startCT}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {game.rlmDetected && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${AMBER}22`, color: AMBER, border: `1px solid ${AMBER}44` }}>
                RLM
              </span>
            )}
            {game.sharpBooksAgree && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${BLUE}22`, color: BLUE, border: `1px solid ${BLUE}44` }}>
                BOOKS AGREE
              </span>
            )}
            <div className="flex items-center gap-1">
              <DirectionArrow dir={game.sharpDirection} />
              <span className="text-xs font-bold" style={{ color: sc }}>{label}</span>
            </div>
            {/* Score ring */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${sc}18`, border: `2px solid ${sc}` }}>
              <span className="text-xs font-black" style={{ color: sc }}>{game.sharpScore}</span>
            </div>
          </div>
        </div>

        {/* Quick line comparison row */}
        {(game.pinnacleSpread !== null || game.pinnacleTotal !== null) && (
          <div className="flex gap-3 mt-2.5 flex-wrap">
            {game.pinnacleSpread !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold" style={{ color: MUTED }}>PIN Spread</span>
                <span className="text-xs font-bold" style={{ color: FG }}>{formatSpread(game.pinnacleSpread)}</span>
                {game.softSpread !== null && (
                  <>
                    <span className="text-xs" style={{ color: MUTED }}>vs Market</span>
                    <span className="text-xs font-bold" style={{ color: FG }}>{formatSpread(game.softSpread)}</span>
                    {game.spreadDivergence !== null && Math.abs(game.spreadDivergence) >= 0.5 && (
                      <span className="text-xs font-bold px-1 rounded" style={{
                        background: Math.abs(game.spreadDivergence) >= 1.5 ? `${sc}22` : `${MUTED}22`,
                        color: Math.abs(game.spreadDivergence) >= 1.5 ? sc : MUTED
                      }}>
                        {game.spreadDivergence > 0 ? "+" : ""}{game.spreadDivergence.toFixed(1)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
            {game.pinnacleTotal !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold" style={{ color: MUTED }}>PIN Total</span>
                <span className="text-xs font-bold" style={{ color: FG }}>{game.pinnacleTotal}</span>
                {game.softTotal !== null && (
                  <>
                    <span className="text-xs" style={{ color: MUTED }}>vs</span>
                    <span className="text-xs font-bold" style={{ color: FG }}>{game.softTotal.toFixed(1)}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-3.5 pb-3.5 pt-3 space-y-3" style={{ borderColor: BORDER }}>

          {/* Pinnacle ML */}
          {game.pinnacleML && (
            <div className="rounded-xl p-3" style={{ background: `${NAV}08` }}>
              <p className="text-xs font-bold mb-2" style={{ color: NAV }}>Pinnacle Moneyline (sharp reference)</p>
              <div className="flex gap-4">
                <div>
                  <p className="text-xs" style={{ color: MUTED }}>{game.awayTeam}</p>
                  <p className="text-sm font-bold" style={{ color: FG }}>{formatAmerican(game.pinnacleML.away)}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: MUTED }}>{game.homeTeam}</p>
                  <p className="text-sm font-bold" style={{ color: FG }}>{formatAmerican(game.pinnacleML.home)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Public betting % */}
          {(game.publicBetPct.home !== null || game.publicBetPct.over !== null) && (
            <div className="rounded-xl p-3" style={{ background: `${BLUE}08` }}>
              <p className="text-xs font-bold mb-2 flex items-center gap-1" style={{ color: BLUE }}>
                <Eye size={11} /> Public Betting % (ActionNetwork)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {game.publicBetPct.home !== null && (
                  <div>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: MUTED }}>{game.homeTeam} tickets</span>
                      <span className="font-bold" style={{ color: FG }}>{game.publicBetPct.home.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
                      <div className="h-full rounded-full" style={{ width: `${game.publicBetPct.home}%`, background: BLUE }} />
                    </div>
                  </div>
                )}
                {game.publicMoneyPct.home !== null && (
                  <div>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: MUTED }}>{game.homeTeam} money</span>
                      <span className="font-bold" style={{ color: FG }}>{game.publicMoneyPct.home.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
                      <div className="h-full rounded-full" style={{ width: `${game.publicMoneyPct.home}%`, background: GREEN }} />
                    </div>
                  </div>
                )}
                {game.publicBetPct.over !== null && (
                  <div>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: MUTED }}>OVER tickets</span>
                      <span className="font-bold" style={{ color: FG }}>{game.publicBetPct.over.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
                      <div className="h-full rounded-full" style={{ width: `${game.publicBetPct.over}%`, background: AMBER }} />
                    </div>
                  </div>
                )}
                {game.publicMoneyPct.over !== null && (
                  <div>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: MUTED }}>OVER money</span>
                      <span className="font-bold" style={{ color: FG }}>{game.publicMoneyPct.over.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
                      <div className="h-full rounded-full" style={{ width: `${game.publicMoneyPct.over}%`, background: AMBER }} />
                    </div>
                  </div>
                )}
              </div>
              {game.totalBets && (
                <p className="text-xs mt-1.5" style={{ color: MUTED }}>{game.totalBets.toLocaleString()} total bets tracked</p>
              )}
            </div>
          )}

          {/* RLM alert */}
          {game.rlmDetected && game.rlmDescription && (
            <div className="rounded-xl p-3 flex gap-2" style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}33` }}>
              <AlertTriangle size={14} style={{ color: AMBER }} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold" style={{ color: AMBER }}>Reverse Line Movement Detected</p>
                <p className="text-xs mt-0.5" style={{ color: FG }}>{game.rlmDescription}</p>
              </div>
            </div>
          )}

          {/* Sharp signals */}
          {game.sharpSignals.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold" style={{ color: FG }}>Sharp Signals</p>
              {game.sharpSignals.map((sig, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <Zap size={11} style={{ color: sc }} className="shrink-0 mt-0.5" />
                  <p className="text-xs" style={{ color: MUTED }}>{sig}</p>
                </div>
              ))}
            </div>
          )}

          {/* Sources */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs" style={{ color: MUTED }}>Sources:</span>
            {game.sources.map(s => (
              <span key={s} className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${NAV}12`, color: NAV }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
    refetchInterval: 15 * 60 * 1000, // 15 min
    staleTime:       14 * 60 * 1000,
  });

  const games = (data?.games || []).filter(g =>
    sportFilter === "ALL" || g.sport === sportFilter
  );

  const highSharp = games.filter(g => g.sharpScore >= 60);
  const updatedAt = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black" style={{ color: FG }}>Sharp Money</h2>
          <p className="text-xs" style={{ color: MUTED }}>
            Pinnacle · OddsPapi · ActionNetwork{updatedAt ? ` · Updated ${updatedAt} CT` : ""}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
          style={{ background: NAV, color: BG, opacity: isFetching ? 0.7 : 1 }}
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Sport filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["ALL", "NBA", "MLB", "NHL", "NFL"].map(s => (
          <button
            key={s}
            onClick={() => setSportFilter(s)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold"
            style={{
              background: sportFilter === s ? NAV : "#fff",
              color: sportFilter === s ? BG : MUTED,
              border: `1px solid ${sportFilter === s ? NAV : BORDER}`,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Summary bar */}
      {highSharp.length > 0 && (
        <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: `${GREEN}10`, border: `1px solid ${GREEN}30` }}>
          <DollarSign size={16} style={{ color: GREEN }} />
          <div>
            <p className="text-sm font-bold" style={{ color: GREEN }}>{highSharp.length} sharp play{highSharp.length > 1 ? "s" : ""} detected today</p>
            <p className="text-xs" style={{ color: MUTED }}>
              {highSharp.filter(g => g.rlmDetected).length} with RLM · {highSharp.filter(g => g.sharpBooksAgree).length} with multi-book agreement
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: `${NAV}12` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl p-4 text-center" style={{ background: `${RED}10`, border: `1px solid ${RED}30` }}>
          <p className="text-sm font-bold" style={{ color: RED }}>Failed to load sharp money data</p>
          <button onClick={() => refetch()} className="text-xs mt-1 underline" style={{ color: RED }}>Retry</button>
        </div>
      )}

      {/* Games */}
      {!isLoading && !isError && games.length === 0 && (
        <div className="text-center py-10">
          <p className="text-sm font-bold" style={{ color: FG }}>No games found</p>
          <p className="text-xs mt-1" style={{ color: MUTED }}>
            {sportFilter !== "ALL" ? `No ${sportFilter} games today with sharp data` : "No games found across all sports today"}
          </p>
        </div>
      )}

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

