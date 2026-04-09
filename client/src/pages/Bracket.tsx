import { useState, useMemo, useEffect, useCallback } from "react";
import { Trophy, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, Zap, Search, Target, Lock, Shuffle, X, ChevronDown as ChevronDownIcon, BarChart2, Calendar, CheckCircle, Clock, TrendingUp, Activity } from "lucide-react";
import { generateBracket, generatePlayoffBracket, calculateMatchup, getUpsetPicks, getTeamPath, FullBracket, MatchupResult, ROUND_NAMES } from "@/lib/bracketEngine";
import { ALL_TEAMS, NCAATeam, REGIONS, Region } from "@/data/bracketData";
import { getVisibleTournaments, Tournament } from "@/data/tournamentCalendar";
import { PLAYOFF_TEAMS_REGISTRY } from "@/data/playoffData";
import { fetchLiveStandings, buildLivePlayoffTeams, LiveStandingsData } from "@/data/livePlayoffTeams";

// ── Confidence Ring ────────────────────────────────────────────────────────
function ConfidenceRing({ score, size = 40 }: { score: number; size?: number }) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 75 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={3} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2+4} textAnchor="middle" fontSize={size/4} fill={color} fontWeight="bold">{score}</text>
    </svg>
  );
}

// ── Win probability bar ────────────────────────────────────────────────────
function ProbBar({ prob, teamA, teamB }: { prob: number; teamA: string; teamB: string }) {
  const pA = Math.round(prob * 100);
  const pB = 100 - pA;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>{teamA} {pA}%</span>
        <span>{teamB} {pB}%</span>
     </div>
      <div className="flex h-1.5 rounded-full overflow-hidden">
        <div className="bg-primary transition-all" style={{ width: `${pA}%` }} />
        <div className="bg-muted-foreground/30 transition-all" style={{ width: `${pB}%` }} />
      </div>
    </div>
  );
}

// ── MatchupCard ────────────────────────────────────────────────────────────
function MatchupCard({ result, showDetail = false }: { result: MatchupResult; showDetail?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { winner, loser, winProbability, projectedScore, matchupFactors, upsetAlert, confidenceScore, analysis } = result;

  return (
    <div
      className={`bg-card border rounded-xl p-3 cursor-pointer transition-all hover:border-primary/40 ${upsetAlert ? "border-yellow-500/40" : "border-border"}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {upsetAlert && <AlertTriangle size={12} className="text-yellow-400 shrink-0" />}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${upsetAlert ? "bg-yellow-500/20 text-yellow-400" : "bg-primary/10 text-primary"}`}>
            {upsetAlert ? "UPSET" : `${Math.round(winProbability * 100)}%`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceRing score={confidenceScore} size={32} />
          {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </div>
      </div>

      {/* Teams */}
      <div className="space-y-1.5 mb-2">
        {/* Winner */}
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">{winner.seed}</span>
          <span className="text-sm font-bold text-foreground truncate flex-1">{winner.name}</span>
          <span className="text-sm font-mono text-primary font-bold">{projectedScore.winner}</span>
        </div>
        {/* Loser */}
        <div className="flex items-center gap-2 opacity-60">
          <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">{loser.seed}</span>
          <span className="text-sm text-muted-foreground truncate flex-1">{loser.name}</span>
          <span className="text-sm font-mono text-muted-foreground">{projectedScore.loser}</span>
        </div>
      </div>

      <ProbBar prob={winProbability} teamA={winner.shortName} teamB={loser.shortName} />

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          {/* Analysis */}
          <p className="text-xs text-muted-foreground leading-relaxed">{analysis}</p>

          {/* Matchup factors */}
          <div>
            <p className="text-[10px] font-bold text-foreground uppercase tracking-wide mb-1.5">Key Factors</p>
            <div className="space-y-1.5">
              {matchupFactors.slice(0, 6).map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${f.advantage === "teamA" ? "bg-primary" : f.advantage === "teamB" ? "bg-red-400" : "bg-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-foreground">{f.label}</span>
                      <span className="text-[9px] text-muted-foreground">({f.advantage === "teamA" ? winner.shortName : f.advantage === "teamB" ? loser.shortName : "even"})</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{f.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats comparison */}
          <div>
            <p className="text-[10px] font-bold text-foreground uppercase tracking-wide mb-1.5">Stats Comparison</p>
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              <span className="text-primary font-bold text-right">{winner.shortName}</span>
              <span className="text-center text-muted-foreground">Stat</span>
              <span className="text-red-400 font-bold">{loser.shortName}</span>

              <span className={`text-right font-mono ${winner.adjOffRating > loser.adjOffRating ? "text-green-400" : "text-muted-foreground"}`}>{winner.adjOffRating.toFixed(1)}</span>
              <span className="text-center text-muted-foreground">Adj. Off</span>
              <span className={`font-mono ${loser.adjOffRating > winner.adjOffRating ? "text-green-400" : "text-muted-foreground"}`}>{loser.adjOffRating.toFixed(1)}</span>

              <span className={`text-right font-mono ${winner.adjDefRating < loser.adjDefRating ? "text-green-400" : "text-muted-foreground"}`}>{winner.adjDefRating.toFixed(1)}</span>
              <span className="text-center text-muted-foreground">Adj. Def</span>
              <span className={`font-mono ${loser.adjDefRating < winner.adjDefRating ? "text-green-400" : "text-muted-foreground"}`}>{loser.adjDefRating.toFixed(1)}</span>

              <span className={`text-right font-mono ${winner.adjEffMargin > loser.adjEffMargin ? "text-green-400" : "text-muted-foreground"}`}>+{winner.adjEffMargin.toFixed(1)}</span>
              <span className="text-center text-muted-foreground">Eff. Margin</span>
              <span className={`font-mono ${loser.adjEffMargin > winner.adjEffMargin ? "text-green-400" : "text-muted-foreground"}`}>+{loser.adjEffMargin.toFixed(1)}</span>

              <span className={`text-right font-mono ${winner.fg3Pct > loser.fg3Pct ? "text-green-400" : "text-muted-foreground"}`}>{winner.fg3Pct}%</span>
              <span className="text-center text-muted-foreground">3PT%</span>
              <span className={`font-mono ${loser.fg3Pct > winner.fg3Pct ? "text-green-400" : "text-muted-foreground"}`}>{loser.fg3Pct}%</span>

              <span className={`text-right font-mono ${winner.ppg > loser.ppg ? "text-green-400" : "text-muted-foreground"}`}>{winner.ppg}</span>
              <span className="text-center text-muted-foreground">PPG</span>
              <span className={`font-mono ${loser.ppg > winner.ppg ? "text-green-400" : "text-muted-foreground"}`}>{loser.ppg}</span>
            </div>
          </div>

          {/* Key players */}
          <div className="grid grid-cols-2 gap-2">
            {[winner, loser].map((t, i) => (
              <div key={t.id} className={`p-2 rounded-lg ${i === 0 ? "bg-primary/5 border border-primary/20" : "bg-red-500/5 border border-red-500/20"}`}>
                <p className={`text-[9px] font-bold uppercase mb-1 ${i === 0 ? "text-primary" : "text-red-400"}`}>{t.shortName} Key Players</p>
                {t.keyPlayers.map((p, j) => (
                  <div key={j} className="text-[9px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{p.name}</span> — {p.stat}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Team Card (bracket view) ───────────────────────────────────────────────
function TeamProfileCard({ team, onMatchup }: { team: NCAATeam; onMatchup: (t: NCAATeam) => void }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-all" onClick={() => onMatchup(team)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">{team.seed}</span>
          <div>
            <p className="text-sm font-bold text-foreground leading-tight">{team.name}</p>
            <p className="text-[10px] text-muted-foreground">{team.record} · {team.conferenceFinish}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-mono text-primary font-bold">+{team.championshipOdds.toLocaleString()}</p>
          <p className="text-[9px] text-muted-foreground">{team.impliedChampionshipPct}% title</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[9px] mb-2">
        <div className="bg-muted/50 rounded p-1 text-center">
          <p className="text-muted-foreground">Off. Rtg</p>
          <p className="font-mono font-bold text-foreground">{team.adjOffRating.toFixed(0)}</p>
        </div>
        <div className="bg-muted/50 rounded p-1 text-center">
          <p className="text-muted-foreground">Def. Rtg</p>
          <p className="font-mono font-bold text-foreground">{team.adjDefRating.toFixed(0)}</p>
        </div>
        <div className="bg-muted/50 rounded p-1 text-center">
          <p className="text-muted-foreground">Margin</p>
          <p className="font-mono font-bold text-green-400">+{team.adjEffMargin.toFixed(1)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {team.playStyle.slice(0, 3).map(s => (
          <span key={s} className="text-[9px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">{s}</span>
        ))}
        {team.recentForm === "hot" && <span className="text-[9px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">🔥 hot</span>}
        {team.upsetAlert && <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">⚠ upset alert</span>}
        {team.sleeper && <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">💤 sleeper</span>}
      </div>
    </div>
  );
}

// ── Mode selector modal ────────────────────────────────────────────────────
function ModeSelector({
  onFullGenerate,
  onPickWinner,
  onClose,
  isRegenerate,
}: {
  onFullGenerate: () => void;
  onPickWinner: () => void;
  onClose: () => void;
  isRegenerate: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground text-base">Generate Bracket</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={16} /></button>
        </div>
        <p className="text-xs text-muted-foreground">How do you want to generate your bracket?</p>

        {/* Option 1 — Full AI */}
        <button
          onClick={onFullGenerate}
          className="w-full flex items-start gap-3 p-4 bg-primary/10 border border-primary/30 rounded-xl hover:bg-primary/20 transition-all text-left"
        >
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
            <Shuffle size={16} className="text-primary" />
          </div>
          <div>
            <p className="font-bold text-foreground text-sm">Full AI Generate</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Let the model simulate every game using odds, efficiency, pace matchups &amp; upset factors.
            </p>
          </div>
        </button>

        {/* Option 2 — Pick your winner */}
        <button
          onClick={onPickWinner}
          className="w-full flex items-start gap-3 p-4 bg-muted border border-border rounded-xl hover:border-primary/40 hover:bg-muted/80 transition-all text-left"
        >
          <div className="w-9 h-9 rounded-full bg-muted-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
            <Lock size={16} className="text-muted-foreground" />
          </div>
          <div>
            <p className="font-bold text-foreground text-sm">Pick Your Champion</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Lock in a specific team to win it all. The AI simulates the rest of the bracket around your pick.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Champion picker ────────────────────────────────────────────────────────
function ChampionPicker({
  teams,
  regions,
  onConfirm,
  onBack,
}: {
  teams: NCAATeam[];
  regions: Region[];
  onConfirm: (team: NCAATeam) => void;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [regionFilter, setRegionFilter] = useState<Region | "All">("All");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return teams
      .filter(t => regionFilter === "All" || t.region === regionFilter)
      .filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.shortName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const regionOrder = regions;
        const rA = regionOrder.indexOf(a.region as Region), rB = regionOrder.indexOf(b.region as Region);
        return rA !== rB ? rA - rB : a.seed - b.seed;
      });
  }, [regionFilter, search, teams, regions]);

  const selected = teams.find(t => t.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-bold text-foreground text-base flex items-center gap-2"><Lock size={14} className="text-primary" /> Pick Your Champion</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Select the team you want to win it all</p>
          </div>
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground p-1"><X size={16} /></button>
        </div>

        {/* Search + filter */}
        <div className="p-3 space-y-2 border-b border-border shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search team..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {(["All", ...regions] as (Region | "All")[]).map(r => (
              <button
                key={r}
                onClick={() => setRegionFilter(r)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                  regionFilter === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >{r}</button>
            ))}
          </div>
        </div>

        {/* Team list */}
        <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                selectedId === t.id
                  ? "bg-primary/15 border-primary/50 ring-1 ring-primary/30"
                  : "bg-muted/40 border-border hover:border-primary/30 hover:bg-muted/70"
              }`}
            >
              <span className={`w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                selectedId === t.id ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"
              }`}>{t.seed}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{t.name}</p>
                <p className="text-[10px] text-muted-foreground">{t.region} · {t.record}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-mono text-primary">+{t.championshipOdds.toLocaleString()}</p>
                <p className="text-[9px] text-muted-foreground">{t.impliedChampionshipPct}%</p>
              </div>
              {selectedId === t.id && <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0"><span className="text-[8px] text-white font-bold">✓</span></div>}
            </button>
          ))}
        </div>

        {/* Confirm */}
        <div className="p-3 border-t border-border shrink-0">
          {selected && (
            <div className="flex items-center gap-2 mb-2 bg-primary/10 rounded-lg p-2">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center">{selected.seed}</span>
              <span className="text-xs font-bold text-foreground flex-1">{selected.name}</span>
              <span className="text-[10px] font-mono text-primary">+{selected.championshipOdds.toLocaleString()}</span>
            </div>
          )}
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selectedId}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
          >
            <Lock size={13} /> Generate with {selected?.shortName ?? "Selected Team"} as Champion
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tournament Selector Card ───────────────────────────────────────────────
function TournamentCard({
  tournament,
  isSelected,
  onClick,
}: {
  tournament: Tournament;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor = {
    active: "text-green-400 bg-green-500/10 border-green-500/20",
    upcoming: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    completed: "text-muted-foreground bg-muted/50 border-border",
  }[tournament.status];

  const statusLabel = {
    active: "LIVE",
    upcoming: `In ${tournament.daysUntilStart}d`,
    completed: "FINAL",
  }[tournament.status];

  const statusIcon = {
    active: <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />,
    upcoming: <Clock size={9} />,
    completed: <CheckCircle size={9} />,
  }[tournament.status];

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left shrink-0 w-36 ${
        isSelected
          ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
          : tournament.status === "completed"
          ? "border-border bg-muted/30 opacity-70 hover:opacity-90"
          : "border-border bg-card hover:border-primary/30"
      }`}
    >
      {/* Status badge */}
      <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor}`}>
        {statusIcon}
        {statusLabel}
      </span>

      {/* Emoji + name */}
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-lg leading-none">{tournament.emoji}</span>
        <p className="text-xs font-bold text-foreground leading-tight">{tournament.shortName}</p>
      </div>

      <p className="text-[9px] text-muted-foreground leading-tight line-clamp-2">{tournament.teamsCount} teams · {tournament.sport}</p>

      {/* Lock icon for completed */}
      {tournament.status === "completed" && (
        <Lock size={11} className="text-muted-foreground mt-0.5" />
      )}

      {/* Accent underline for selected */}
      {isSelected && (
        <div
          className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full"
          style={{ backgroundColor: tournament.highlightColor }}
        />
      )}
    </button>
  );
}

// ── Get team data for a tournament ────────────────────────────────────────
function getTeamsForTournament(
  tournament: Tournament,
  liveData?: LiveStandingsData | null
): { teams: NCAATeam[]; regions: Region[] } {
  if (tournament.dataKey === "ncaab_2026") {
    return { teams: ALL_TEAMS, regions: REGIONS as unknown as Region[] };
  }
  // Use live standings data if available and bracketUnlocked
  if (liveData && liveData.bracketUnlocked && tournament.liveStandingsSport) {
    const built = buildLivePlayoffTeams(liveData);
    if (built.teams.length >= 4) return built;
  }
  // Fall back to static registry
  const playoffTeams = PLAYOFF_TEAMS_REGISTRY[tournament.dataKey] ?? [];
  return { teams: playoffTeams, regions: ["East", "West", "Midwest", "South"] as Region[] };
}

// ── Round names per tournament format ─────────────────────────────────────
function getRoundNames(tournament: Tournament): { round: string[]; final: string[] } {
  if (tournament.sport === "NBA") {
    return {
      round: ["First Round", "Second Round"],
      final: ["Conference Finals", "NBA Finals"],
    };
  }
  if (tournament.sport === "NHL") {
    return {
      round: ["First Round", "Second Round"],
      final: ["Conference Finals", "Stanley Cup Finals"],
    };
  }
  if (tournament.sport === "MLB") {
    return {
      round: ["Wild Card", "Division Series", "Championship Series"],
      final: ["League Championship", "World Series"],
    };
  }
  if (tournament.sport === "NFL") {
    return {
      round: ["Wild Card", "Divisional"],
      final: ["Conference Championship", "Super Bowl"],
    };
  }
  return {
    round: ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"],
    final: ["Final Four", "National Championship"],
  };
}

// ── Get region labels per tournament ──────────────────────────────────────
function getRegionLabels(tournament: Tournament): Record<Region, string> {
  if (tournament.sport === "NBA") {
    return {
      East: "East — Top Half",
      Midwest: "East — Bottom Half",
      West: "West — Top Half",
      South: "West — Bottom Half",
    };
  }
  if (tournament.sport === "NHL") {
    return {
      East: "Atlantic Division",
      Midwest: "Metropolitan Division",
      West: "Central Division",
      South: "Pacific Division",
    };
  }
  return {
    East: "East",
    Midwest: "Midwest",
    West: "West",
    South: "South",
  };
}

// ── Get Final Four label per tournament ───────────────────────────────────
function getFinalFourLabel(tournament: Tournament, index: number): string {
  if (tournament.sport === "NBA") return index === 0 ? "East Conference Finals" : "West Conference Finals";
  if (tournament.sport === "NHL") return index === 0 ? "East Conference Finals" : "West Conference Finals";
  if (tournament.sport === "MLB") return index === 0 ? "AL Championship Series" : "NL Championship Series";
  if (tournament.sport === "NFL") return index === 0 ? "AFC Championship" : "NFC Championship";
  return index === 0 ? "Semifinal 1 — East vs West" : "Semifinal 2 — Midwest vs South";
}

// ── Main Bracket page ──────────────────────────────────────────────────────
type BracketView = "bracket" | "teams" | "upsets" | "compare" | "analytics";

export default function Bracket() {
  // Tournament state
  const visibleTournaments = useMemo(() => getVisibleTournaments(), []);
  // Default to first non-completed tournament, or first overall
  const defaultTournament = useMemo(() => {
    return visibleTournaments.find(t => t.status !== "completed") ?? visibleTournaments[0];
  }, [visibleTournaments]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(defaultTournament?.id ?? "");
  const selectedTournament = useMemo(
    () => visibleTournaments.find(t => t.id === selectedTournamentId) ?? visibleTournaments[0],
    [visibleTournaments, selectedTournamentId]
  );

  // Teams for the selected tournament — uses live standings when available
  const { teams: currentTeams, regions: currentRegions } = useMemo(
    () => (selectedTournament
      ? getTeamsForTournament(selectedTournament, liveStandings)
      : { teams: ALL_TEAMS, regions: REGIONS as unknown as Region[] }),
    [selectedTournament, liveStandings]
  );

  // Live standings state
  const [liveStandings, setLiveStandings] = useState<LiveStandingsData | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);

  // Fetch live standings for the current tournament if it's a live-seeding league
  const loadLiveStandings = useCallback(async (tournament: Tournament | null | undefined) => {
    if (!tournament?.liveStandingsSport) {
      setLiveStandings(null);
      setStandingsError(null);
      return;
    }
    setStandingsLoading(true);
    setStandingsError(null);
    try {
      const data = await fetchLiveStandings(tournament.liveStandingsSport);
      setLiveStandings(data);
    } catch (e: any) {
      setStandingsError("Could not load live standings");
      setLiveStandings(null);
    } finally {
      setStandingsLoading(false);
    }
  }, []);

  // Load on mount and whenever tournament changes
  useEffect(() => {
    loadLiveStandings(selectedTournament);
  }, [selectedTournament?.id, loadLiveStandings]);

  const isLocked = selectedTournament?.status === "completed";
  // Season-progress lock: if seasonUnlockPct defined AND standings loaded AND season < threshold
  const seasonPct = liveStandings?.seasonPct ?? null;
  const unlockThreshold = selectedTournament?.seasonUnlockPct ?? null;
  const seasonLocked = (
    !isLocked &&
    selectedTournament?.liveStandingsSport != null &&
    !standingsLoading &&
    liveStandings != null &&
    unlockThreshold != null &&
    (liveStandings.seasonPct < unlockThreshold)
  );
  const isUpcoming = selectedTournament?.status === "upcoming" && !seasonLocked;

  const [bracket, setBracket] = useState<FullBracket | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showChampionPicker, setShowChampionPicker] = useState(false);
  const [lockedChampion, setLockedChampion] = useState<NCAATeam | null>(null);

  const [activeView, setActiveView] = useState<BracketView>("bracket");
  const [selectedRegion, setSelectedRegion] = useState<Region>("East");
  const [searchQuery, setSearchQuery] = useState("");
  const [compareTeamA, setCompareTeamA] = useState<NCAATeam | null>(null);
  const [compareTeamB, setCompareTeamB] = useState<NCAATeam | null>(null);
  const [compareResult, setCompareResult] = useState<MatchupResult | null>(null);
  const [teamPathTeam, setTeamPathTeam] = useState<NCAATeam | null>(null);

  // When tournament switches, clear the bracket
  const handleSelectTournament = (id: string) => {
    setSelectedTournamentId(id);
    setBracket(null);
    setLockedChampion(null);
    setCompareTeamA(null);
    setCompareTeamB(null);
    setCompareResult(null);
    setTeamPathTeam(null);
    setActiveView("bracket");
    setSelectedRegion("East");
  };

  const runGenerate = (tournamentId: string, championId?: string) => {
    setShowModeSelector(false);
    setShowChampionPicker(false);
    setGenerating(true);
    setTimeout(() => {
      const t = visibleTournaments.find(x => x.id === tournamentId) ?? selectedTournament;
      let result: FullBracket;
      if (t?.dataKey === "ncaab_2026") {
        result = generateBracket(championId);
      } else {
        const { teams } = getTeamsForTournament(t!, liveStandings);
        const { round, final } = getRoundNames(t!);
        result = generatePlayoffBracket(teams, round, final, championId);
      }
      setBracket(result);
      setGenerating(false);
    }, 800);
  };

  const handleGenerate = () => setShowModeSelector(true);

  const handleFullGenerate = () => {
    setLockedChampion(null);
    runGenerate(selectedTournamentId, undefined);
  };

  const handlePickWinner = () => {
    setShowModeSelector(false);
    setShowChampionPicker(true);
  };

  const handleConfirmChampion = (team: NCAATeam) => {
    setLockedChampion(team);
    runGenerate(selectedTournamentId, team.id);
  };

  const upsets = useMemo(() => bracket ? getUpsetPicks(bracket) : [], [bracket]);

  const filteredTeams = useMemo(() => {
    if (!searchQuery) return currentTeams;
    const q = searchQuery.toLowerCase();
    return currentTeams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.shortName.toLowerCase().includes(q) ||
      t.region.toLowerCase().includes(q) ||
      t.playStyle.some(s => s.includes(q))
    );
  }, [searchQuery, currentTeams]);

  const handleCompare = () => {
    if (compareTeamA && compareTeamB) {
      setCompareResult(calculateMatchup(compareTeamA, compareTeamB));
    }
  };

  const handleTeamMatchup = (team: NCAATeam) => {
    if (bracket) {
      setTeamPathTeam(team);
    }
  };

  const teamPath = useMemo(() => {
    if (!bracket || !teamPathTeam) return null;
    return getTeamPath(bracket, teamPathTeam.id);
  }, [bracket, teamPathTeam]);

  const regionData = useMemo(() => {
    if (!bracket) return null;
    return bracket.regions.find(r => r.region === selectedRegion);
  }, [bracket, selectedRegion]);

  const regionLabels = useMemo(
    () => selectedTournament ? getRegionLabels(selectedTournament) : getRegionLabels({ sport: "NCAAB" } as Tournament),
    [selectedTournament]
  );

  const totalGames = useMemo(() => {
    // 16-team = 15 games, 68-team = 63 games
    if (!selectedTournament) return 63;
    if (selectedTournament.teamsCount === 68) return 63;
    if (selectedTournament.teamsCount === 16) return 15;
    if (selectedTournament.teamsCount === 14) return 13;
    if (selectedTournament.teamsCount === 12) return 11;
    return selectedTournament.teamsCount - 1;
  }, [selectedTournament]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Modals */}
      {showModeSelector && (
        <ModeSelector
          isRegenerate={!!bracket}
          onFullGenerate={handleFullGenerate}
          onPickWinner={handlePickWinner}
          onClose={() => setShowModeSelector(false)}
        />
      )}
      {showChampionPicker && selectedTournament && (
        <ChampionPicker
          teams={currentTeams}
          regions={currentRegions}
          onConfirm={handleConfirmChampion}
          onBack={() => { setShowChampionPicker(false); setShowModeSelector(true); }}
        />
      )}

      {/* ── Tournament Selector ── */}
      {visibleTournaments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Tournaments</p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {visibleTournaments.map(t => (
              <TournamentCard
                key={t.id}
                tournament={t}
                isSelected={t.id === selectedTournamentId}
                onClick={() => handleSelectTournament(t.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Trophy size={20} className="text-primary" />
            {selectedTournament?.name ?? "Bracket Simulator"}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLocked
              ? "🏆 Tournament complete — bracket is locked"
              : seasonLocked
              ? `Season ${seasonPct?.toFixed(0) ?? "?"}% complete — unlocks at ${unlockThreshold}%`
              : standingsLoading
              ? "Loading live seedings..."
              : (liveStandings?.bracketUnlocked && selectedTournament?.liveStandingsSport)
              ? `Live seedings · Updated daily · ${currentTeams.length} teams`
              : isUpcoming
              ? `Starts in ${selectedTournament.daysUntilStart} days · ${currentTeams.length} teams`
              : `AI-powered bracket generator · ${currentTeams.length} teams`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bracket && !isLocked && (
            <button
              onClick={() => setActiveView("analytics")}
              className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border text-foreground rounded-lg text-sm font-semibold hover:border-primary/50 hover:text-primary transition-all"
              title="View bracket analytics"
            >
              <BarChart2 size={13} /> Analytics
            </button>
          )}
          {/* Generate button — disabled for completed/upcoming tournaments */}
          {isLocked ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-lg text-sm font-semibold text-muted-foreground cursor-not-allowed">
              <Lock size={14} /> Locked
            </div>
          ) : seasonLocked ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-lg text-sm font-semibold text-muted-foreground cursor-not-allowed">
              <Clock size={14} /> Season in progress
            </div>
          ) : standingsLoading ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-lg text-sm font-semibold text-muted-foreground cursor-not-allowed">
              <RefreshCw size={14} className="animate-spin" /> Loading...
            </div>
          ) : isUpcoming ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-lg text-sm font-semibold text-muted-foreground cursor-not-allowed">
              <Clock size={14} /> Starts in {selectedTournament?.daysUntilStart}d
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-60 shadow-lg"
            >
              {generating ? (
                <><RefreshCw size={14} className="animate-spin" /> Simulating...</>
              ) : (
                <><Zap size={14} /> {bracket ? "Re-Generate" : "Generate Bracket"}</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Locked tournament banner */}
      {isLocked && (
        <div className="bg-muted/40 border border-border rounded-xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Lock size={16} className="text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-foreground text-sm">Tournament Complete</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {selectedTournament?.name} has concluded. The bracket is now locked — no new simulations can be generated.
              {selectedTournament?.sport === "NCAAB" && " Check the NBA &amp; NHL Playoffs tabs to simulate the upcoming playoff brackets."}
            </p>
          </div>
          <CheckCircle size={18} className="text-muted-foreground shrink-0 mt-0.5" />
        </div>
      )}

      {/* Season-in-progress lock banner */}
      {seasonLocked && !isLocked && liveStandings && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <Activity size={16} className="text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-foreground text-sm flex items-center gap-2">
                {selectedTournament?.name}
                <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">SEASON IN PROGRESS</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                The bracket unlocks when the season reaches <strong className="text-foreground">{unlockThreshold}% complete</strong>.
                Live playoff seedings will update automatically once the threshold is reached.
                Check back as the season winds down.
              </p>
            </div>
          </div>
          {/* Season progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Season Progress</span>
              <span className="font-mono font-bold text-amber-400">{seasonPct?.toFixed(1)}% / {unlockThreshold}% to unlock</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (seasonPct ?? 0) / (unlockThreshold ?? 100) * 100)}%`,
                  background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
                }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>0 games</span>
              <span>{liveStandings.maxGamesPlayed} / {liveStandings.totalGamesPerTeam} games played</span>
            </div>
          </div>
          {/* Current leaders */}
          {Object.keys(liveStandings.conferences).length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">Current Leaders</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(liveStandings.conferences).map(([conf, teams]: [string, any[]]) => {
                  const leader = teams.sort((a, b) => (a.seed || 99) - (b.seed || 99))[0];
                  if (!leader) return null;
                  return (
                    <div key={conf} className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2 py-1">
                      <span className="text-[9px] font-bold text-primary">#{leader.seed}</span>
                      <span className="text-[9px] font-semibold text-foreground">{leader.shortName || leader.abbreviation}</span>
                      <span className="text-[9px] text-muted-foreground">{leader.record}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live seedings active banner */}
      {!seasonLocked && !isLocked && liveStandings?.bracketUnlocked && selectedTournament?.liveStandingsSport && currentTeams.length > 0 && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <TrendingUp size={11} className="text-green-400" />
              Live Seedings Active
              <span className="text-[9px] font-normal text-muted-foreground ml-1">
                {liveStandings.seasonPct.toFixed(0)}% of season complete · {currentTeams.length} playoff teams · Updated daily
              </span>
            </p>
          </div>
          <button
            onClick={() => loadLiveStandings(selectedTournament)}
            className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors"
            title="Refresh standings"
          >
            <RefreshCw size={10} />
          </button>
        </div>
      )}

      {/* Upcoming tournament banner */}
      {isUpcoming && !isLocked && !seasonLocked && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-foreground text-sm flex items-center gap-2">
              {selectedTournament?.name}
              <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20">UPCOMING</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Starts <strong className="text-foreground">{selectedTournament?.startDate}</strong> — {selectedTournament?.daysUntilStart} days away.
              You can preview matchups now using projected seedings, or wait until the bracket is set.
            </p>
          </div>
        </div>
      )}

      {/* Locked champion badge */}
      {lockedChampion && bracket && (
        <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2">
          <Lock size={12} className="text-primary shrink-0" />
          <span className="text-xs text-primary font-semibold flex-1">
            Locked Pick: <span className="font-bold text-foreground">{lockedChampion.name}</span> ({lockedChampion.seed}-seed) as champion
          </span>
          <button
            onClick={() => { setLockedChampion(null); runGenerate(selectedTournamentId, undefined); }}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X size={11} /> Remove
          </button>
        </div>
      )}

      {/* Info banner pre-generate (not locked, not yet generated, not season-locked) */}
      {!bracket && !generating && !isLocked && !seasonLocked && (
        <div className="bg-card border border-border rounded-xl p-5 text-center space-y-3">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <span className="text-2xl">{selectedTournament?.emoji ?? "🏆"}</span>
          </div>
          <div>
            <p className="font-bold text-foreground">Comprehensive Bracket Analysis</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Our model combines sportsbook championship odds, adjusted efficiency margins, scoring differential,
              pace/style matchups, recent form, and strength of schedule to predict every game.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {[
              { label: "Championship Odds", desc: "Market-implied probability", pct: "30%" },
              { label: "Efficiency Margin", desc: "Adjusted offense & defense", pct: "25%" },
              { label: "Style Matchup", desc: "Pace, paint vs. perimeter", pct: "20%" },
            ].map(f => (
              <div key={f.label} className="bg-muted/50 rounded-lg p-2">
                <p className="font-bold text-primary">{f.pct}</p>
                <p className="font-semibold text-foreground">{f.label}</p>
                <p className="text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {[
              { label: "Scoring Margin", desc: "Season-long point differential", pct: "10%" },
              { label: "Recent Form", desc: "Last 5-10 game momentum", pct: "10%" },
              { label: "Schedule Strength", desc: "Quality of opponents faced", pct: "5%" },
            ].map(f => (
              <div key={f.label} className="bg-muted/50 rounded-lg p-2">
                <p className="font-bold text-primary">{f.pct}</p>
                <p className="font-semibold text-foreground">{f.label}</p>
                <p className="text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generating animation */}
      {generating && (
        <div className="bg-card border border-border rounded-xl p-8 text-center space-y-3">
          <RefreshCw size={32} className="text-primary animate-spin mx-auto" />
          <p className="font-bold text-foreground">Simulating {totalGames} games...</p>
          <p className="text-xs text-muted-foreground">Analyzing matchups across all {currentRegions.length} brackets</p>
        </div>
      )}

      {/* Bracket generated */}
      {bracket && !generating && !isLocked && (
        <>
          {/* Nav tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {(["bracket", "teams", "upsets", "compare", "analytics"] as BracketView[]).map(v => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${activeView === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v === "upsets" ? `Upsets (${upsets.length})` : v === "analytics" ? (
                  <span className="flex items-center justify-center gap-1"><BarChart2 size={11} />Analytics</span>
                ) : v}
              </button>
            ))}
          </div>

          {/* ── Bracket view ── */}
          {activeView === "bracket" && (
            <div className="space-y-4">
              {/* Region selector */}
              <div className="flex gap-1 overflow-x-auto pb-1">
                {currentRegions.map(r => {
                  const rData = bracket.regions.find(rd => rd.region === r);
                  return (
                    <button
                      key={r}
                      onClick={() => setSelectedRegion(r)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedRegion === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    >
                      {regionLabels[r] ?? r}
                      {rData && <span className="ml-1 text-[9px] opacity-70">({rData.regionWinner.shortName})</span>}
                    </button>
                  );
                })}
              </div>

              {regionData && (
                <div className="space-y-4">
                  {/* Region winner callout */}
                  <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3 border border-border">
                    <Trophy size={16} className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground">{regionLabels[selectedRegion] ?? selectedRegion} Winner</p>
                      <p className="font-bold text-foreground text-sm truncate">{regionData.regionWinner.name}</p>
                    </div>
                    <span className="text-xs font-mono text-primary">+{regionData.regionWinner.championshipOdds.toLocaleString()}</span>
                  </div>

                  {regionData.rounds.map(round => (
                    <div key={round.round} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-2">{round.name}</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <div className="space-y-2">
                        {round.matchups.map((m, i) => (
                          <MatchupCard key={i} result={m} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Final Four + Championship ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-bold text-primary uppercase tracking-wide px-2">
                    {selectedTournament?.sport === "NBA" || selectedTournament?.sport === "NHL"
                      ? "Conference Finals"
                      : selectedTournament?.sport === "NFL"
                      ? "Conference Championships"
                      : "Final Four"}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {bracket.finalFour.matchups.map((m, i) => (
                    <div key={i} className="space-y-1">
                      <p className="text-[9px] text-muted-foreground px-1 font-semibold uppercase">
                        {getFinalFourLabel(selectedTournament!, i)}
                      </p>
                      <MatchupCard result={m} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-bold text-primary uppercase tracking-wide px-2">
                    {selectedTournament?.sport === "NBA" ? "NBA Finals"
                      : selectedTournament?.sport === "NHL" ? "Stanley Cup Finals"
                      : selectedTournament?.sport === "MLB" ? "World Series"
                      : selectedTournament?.sport === "NFL" ? "Super Bowl"
                      : "Championship Game"}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <MatchupCard result={bracket.championship} />
              </div>

              {/* Champion banner */}
              <div className="bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/40 rounded-xl p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Trophy size={22} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-primary font-bold uppercase tracking-wide">🏆 Predicted Champion</p>
                  <p className="text-base font-bold text-foreground truncate">{bracket.champion.name}</p>
                  <p className="text-[10px] text-muted-foreground">{bracket.champion.seed}-seed · {bracket.champion.region} · +{bracket.champion.championshipOdds.toLocaleString()} odds</p>
                </div>
                <ConfidenceRing score={bracket.confidenceScore} size={48} />
              </div>
            </div>
          )}

          {/* ── Teams view ── */}
          {activeView === "teams" && (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search teams, play styles..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
              </div>

              {/* Team path drawer */}
              {teamPathTeam && teamPath && (
                <div className="bg-card border border-primary/30 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-foreground">{teamPathTeam.name} Bracket Path</p>
                    <button onClick={() => setTeamPathTeam(null)} className="text-muted-foreground text-xs hover:text-foreground">✕</button>
                  </div>
                  {teamPath.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${m.winner.id === teamPathTeam.id ? "bg-green-400" : "bg-red-400"}`} />
                      <span className={`font-semibold ${m.winner.id === teamPathTeam.id ? "text-green-400" : "text-red-400"}`}>
                        {m.winner.id === teamPathTeam.id ? "WIN" : "LOSS"}
                      </span>
                      <span className="text-muted-foreground">{ROUND_NAMES[i + 1]}</span>
                      <span className="text-foreground truncate">vs {m.winner.id === teamPathTeam.id ? m.loser.shortName : m.winner.shortName}</span>
                      <span className="font-mono text-primary ml-auto">{Math.round(m.winProbability * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Region filter */}
              <div className="flex gap-1 overflow-x-auto pb-1">
                {currentRegions.map(r => (
                  <button
                    key={r}
                    onClick={() => setSelectedRegion(r)}
                    className={`flex-shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-all ${selectedRegion === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {regionLabels[r] ?? r}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2">
                {filteredTeams
                  .filter(t => searchQuery || t.region === selectedRegion)
                  .map(t => (
                    <TeamProfileCard key={t.id} team={t} onMatchup={handleTeamMatchup} />
                  ))}
              </div>
            </div>
          )}

          {/* ── Upsets view ── */}
          {activeView === "upsets" && (
            <div className="space-y-3">
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                <p className="text-xs font-bold text-yellow-400 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {upsets.length} Projected Upsets
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Lower seeds predicted to defeat higher seeds based on our model</p>
              </div>
              {upsets.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">No upsets projected</p>
              ) : (
                upsets.map((u, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-[10px] text-muted-foreground px-1">{u.winner.region} · {ROUND_NAMES[Math.ceil(Math.log2(64 / u.winner.seed))]}</p>
                    <MatchupCard result={u} />
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Analytics view ── */}
          {activeView === "analytics" && (
            <div className="space-y-4">
              {/* Champion Card */}
              <div className="bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[10px] text-primary font-bold uppercase tracking-wide">🏆 Predicted Champion</p>
                    <p className="text-lg font-bold text-foreground mt-0.5">{bracket.champion.name}</p>
                    <p className="text-xs text-muted-foreground">{bracket.champion.seed}-seed · {bracket.champion.region} · +{bracket.champion.championshipOdds.toLocaleString()} odds</p>
                  </div>
                  <div className="text-right">
                    <ConfidenceRing score={bracket.confidenceScore} size={56} />
                    <p className="text-[9px] text-muted-foreground mt-1">Model confidence</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{bracket.champion.analysis.split(".").slice(0, 2).join(". ")}.</p>

                {/* Key Stats Grid */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Adj Off", value: bracket.champion.adjOffRating.toFixed(1), color: "text-green-400" },
                    { label: "Adj Def", value: bracket.champion.adjDefRating.toFixed(1), color: "text-blue-400" },
                    { label: "Eff Margin", value: `+${bracket.champion.adjEffMargin.toFixed(1)}`, color: "text-primary" },
                    { label: "PPG", value: bracket.champion.ppg.toFixed(1), color: "text-foreground" },
                    { label: "3PT%", value: `${(bracket.champion.fg3Pct * 100).toFixed(1)}%`, color: "text-yellow-400" },
                    { label: "SOS", value: bracket.champion.strengthOfSchedule.toFixed(1), color: "text-muted-foreground" },
                  ].map(stat => (
                    <div key={stat.label} className="bg-black/20 rounded-lg p-2 text-center">
                      <p className={`text-sm font-bold ${stat.color}`}>{stat.value}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Final Four / Conference Finals Predictions */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">
                  {selectedTournament?.sport === "NBA" || selectedTournament?.sport === "NHL"
                    ? "Conference Finals"
                    : "Final Four Predictions"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {bracket.finalFour.matchups.map((m, i) => (
                    <div key={i} className="bg-muted/50 rounded-lg p-2.5 space-y-1.5">
                      <p className="text-[9px] text-muted-foreground font-semibold uppercase">
                        {getFinalFourLabel(selectedTournament!, i)}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center">{m.winner.seed}</span>
                        <span className="text-xs font-bold text-foreground truncate">{m.winner.shortName}</span>
                        <span className="text-[9px] text-primary ml-auto font-mono">{Math.round(m.winProbability * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-1.5 opacity-50">
                        <span className="w-4 h-4 rounded-full bg-muted text-muted-foreground text-[9px] font-bold flex items-center justify-center">{m.loser.seed}</span>
                        <span className="text-xs text-muted-foreground truncate">{m.loser.shortName}</span>
                      </div>
                      <ProbBar prob={m.winProbability} teamA={m.winner.shortName} teamB={m.loser.shortName} />
                    </div>
                  ))}
                </div>
                {/* Championship */}
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">
                    {selectedTournament?.sport === "NBA" ? "NBA Finals"
                      : selectedTournament?.sport === "NHL" ? "Stanley Cup Finals"
                      : "Championship Game"}
                  </p>
                  <MatchupCard result={bracket.championship} />
                </div>
              </div>

              {/* Upsets Summary */}
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
                <p className="text-xs font-bold text-yellow-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {upsets.length} Projected Upsets
                </p>
                {upsets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No upsets projected in this bracket</p>
                ) : (
                  <div className="space-y-2">
                    {upsets.slice(0, 5).map((u, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="bg-yellow-500/20 text-yellow-400 font-bold px-1.5 py-0.5 rounded text-[9px]">#{u.winner.seed} over #{u.loser.seed}</span>
                        <span className="text-foreground font-semibold truncate">{u.winner.shortName}</span>
                        <span className="text-muted-foreground">def.</span>
                        <span className="text-muted-foreground truncate">{u.loser.shortName}</span>
                        <span className="ml-auto font-mono text-primary text-[9px]">{Math.round(u.winProbability * 100)}%</span>
                      </div>
                    ))}
                    {upsets.length > 5 && (
                      <button onClick={() => setActiveView("upsets")} className="text-[10px] text-primary hover:underline">View all {upsets.length} upsets →</button>
                    )}
                  </div>
                )}
              </div>

              {/* Region / Conference Winners */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">
                  {selectedTournament?.sport === "NBA" || selectedTournament?.sport === "NHL" ? "Division Winners" : "Region Winners"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {bracket.regions.map(r => (
                    <div key={r.region} className="bg-muted/50 rounded-lg p-3 space-y-1">
                      <p className="text-[9px] text-muted-foreground font-semibold uppercase">{regionLabels[r.region as Region] ?? r.region}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">{r.regionWinner.seed}</span>
                        <span className="text-xs font-bold text-foreground truncate">{r.regionWinner.shortName}</span>
                      </div>
                      <p className="text-[9px] font-mono text-primary">+{r.regionWinner.championshipOdds.toLocaleString()}</p>
                      <p className="text-[9px] text-green-400">Eff: +{r.regionWinner.adjEffMargin.toFixed(1)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Compare view ── */}
          {activeView === "compare" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Select any two teams to simulate a matchup — regardless of where they are in the bracket</p>

              <div className="grid grid-cols-2 gap-3">
                {[{ label: "Team A", value: compareTeamA, set: setCompareTeamA }, { label: "Team B", value: compareTeamB, set: setCompareTeamB }].map(({ label, value, set }) => (
                  <div key={label} className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">{label}</p>
                    <select
                      className="w-full px-2 py-2 bg-muted border border-border rounded-lg text-xs text-foreground"
                      value={value?.id ?? ""}
                      onChange={e => set(currentTeams.find(t => t.id === e.target.value) ?? null)}
                    >
                      <option value="">Select team...</option>
                      {currentRegions.map(r => (
                        <optgroup key={r} label={regionLabels[r] ?? r}>
                          {currentTeams.filter(t => t.region === r).sort((a,b) => a.seed - b.seed).map(t => (
                            <option key={t.id} value={t.id}>{t.seed}. {t.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {value && (
                      <div className="bg-muted/50 rounded-lg p-2 space-y-1 text-[10px]">
                        <p className="font-bold text-foreground">{value.name}</p>
                        <p className="text-muted-foreground">{value.record} · {value.region}</p>
                        <p className="font-mono text-primary">+{value.championshipOdds.toLocaleString()} title odds</p>
                        <p className="text-green-400">Eff Margin: +{value.adjEffMargin.toFixed(1)}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={handleCompare}
                disabled={!compareTeamA || !compareTeamB}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Target size={14} />
                Simulate Matchup
              </button>

              {compareResult && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] text-muted-foreground font-semibold uppercase">Result</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <MatchupCard result={compareResult} showDetail />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
