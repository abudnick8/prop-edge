import { useState, useMemo } from "react";
import { Trophy, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, TrendingUp, Zap, Search, Info, Target, Star } from "lucide-react";
import { generateBracket, calculateMatchup, getUpsetPicks, getTeamPath, FullBracket, MatchupResult, ROUND_NAMES } from "@/lib/bracketEngine";
import { ALL_TEAMS, NCAATeam, REGIONS, Region } from "@/data/bracketData";

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

// ── Main Bracket page ──────────────────────────────────────────────────────
type BracketView = "bracket" | "teams" | "upsets" | "compare";

export default function Bracket() {
  const [bracket, setBracket] = useState<FullBracket | null>(null);
  const [generating, setGenerating] = useState(false);
  const [activeView, setActiveView] = useState<BracketView>("bracket");
  const [selectedRegion, setSelectedRegion] = useState<Region>("East");
  const [searchQuery, setSearchQuery] = useState("");
  const [compareTeamA, setCompareTeamA] = useState<NCAATeam | null>(null);
  const [compareTeamB, setCompareTeamB] = useState<NCAATeam | null>(null);
  const [compareResult, setCompareResult] = useState<MatchupResult | null>(null);
  const [teamPathTeam, setTeamPathTeam] = useState<NCAATeam | null>(null);

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      const result = generateBracket();
      setBracket(result);
      setGenerating(false);
    }, 800);
  };

  const upsets = useMemo(() => bracket ? getUpsetPicks(bracket) : [], [bracket]);

  const filteredTeams = useMemo(() => {
    if (!searchQuery) return ALL_TEAMS;
    const q = searchQuery.toLowerCase();
    return ALL_TEAMS.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.shortName.toLowerCase().includes(q) ||
      t.region.toLowerCase().includes(q) ||
      t.playStyle.some(s => s.includes(q))
    );
  }, [searchQuery]);

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

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Trophy size={20} className="text-primary" />
            March Madness 2026
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">AI-powered bracket generator · {ALL_TEAMS.length} teams</p>
        </div>
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
      </div>

      {/* Info banner pre-generate */}
      {!bracket && !generating && (
        <div className="bg-card border border-border rounded-xl p-5 text-center space-y-3">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <Trophy size={24} className="text-primary" />
          </div>
          <div>
            <p className="font-bold text-foreground">Comprehensive Bracket Analysis</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Our model combines sportsbook championship odds, adjusted efficiency margins, scoring differential, pace/style matchups, recent form, and strength of schedule to predict every game.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {[
              { label: "Championship Odds", desc: "DraftKings market-implied probability", pct: "30%" },
              { label: "Efficiency Margin", desc: "KenPom-style adj. offense & defense", pct: "25%" },
              { label: "Style Matchup", desc: "Pace, paint vs. perimeter, turnovers", pct: "20%" },
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
          <p className="font-bold text-foreground">Simulating 63 games...</p>
          <p className="text-xs text-muted-foreground">Analyzing matchups across all 4 regions</p>
        </div>
      )}

      {/* Bracket generated */}
      {bracket && !generating && (
        <>
          {/* Champion callout */}
          <div className="bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/30 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-primary font-bold uppercase tracking-wide">🏆 Predicted Champion</p>
                <p className="text-lg font-bold text-foreground mt-0.5">{bracket.champion.name}</p>
                <p className="text-xs text-muted-foreground">{bracket.champion.seed}-seed · {bracket.champion.region} · +{bracket.champion.championshipOdds.toLocaleString()} odds</p>
              </div>
              <div className="text-right">
                <ConfidenceRing score={bracket.confidenceScore} size={52} />
                <p className="text-[9px] text-muted-foreground mt-1">Model confidence</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{bracket.champion.analysis.split(".").slice(0, 2).join(". ")}.</p>
          </div>

          {/* Final Four summary */}
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">Final Four Predictions</p>
            <div className="grid grid-cols-2 gap-2">
              {bracket.finalFour.matchups.map((m, i) => (
                <div key={i} className="bg-muted/50 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-[9px] text-muted-foreground font-semibold uppercase">{i === 0 ? "East vs West" : "Midwest vs South"}</p>
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
              <p className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">Championship Game</p>
              <MatchupCard result={bracket.championship} />
            </div>
          </div>

          {/* Nav tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {(["bracket", "teams", "upsets", "compare"] as BracketView[]).map(v => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${activeView === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v === "upsets" ? `Upsets (${upsets.length})` : v}
              </button>
            ))}
          </div>

          {/* ── Bracket view ── */}
          {activeView === "bracket" && (
            <div className="space-y-4">
              {/* Region selector */}
              <div className="flex gap-1 overflow-x-auto pb-1">
                {REGIONS.map(r => {
                  const rData = bracket.regions.find(rd => rd.region === r);
                  return (
                    <button
                      key={r}
                      onClick={() => setSelectedRegion(r)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedRegion === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    >
                      {r}
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
                      <p className="text-[10px] text-muted-foreground">Region Winner</p>
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
                  placeholder="Search teams, regions, play styles..."
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
                {REGIONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setSelectedRegion(r)}
                    className={`flex-shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-all ${selectedRegion === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2">
                {filteredTeams.filter(t => !searchQuery || t.region === selectedRegion || searchQuery.length > 0)
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
                    <p className="text-[10px] text-muted-foreground px-1">{u.winner.region} Region · {ROUND_NAMES[Math.ceil(Math.log2(64 / u.winner.seed))]}</p>
                    <MatchupCard result={u} />
                  </div>
                ))
              )}
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
                      onChange={e => set(ALL_TEAMS.find(t => t.id === e.target.value) ?? null)}
                    >
                      <option value="">Select team...</option>
                      {REGIONS.map(r => (
                        <optgroup key={r} label={r}>
                          {ALL_TEAMS.filter(t => t.region === r).sort((a,b) => a.seed - b.seed).map(t => (
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
