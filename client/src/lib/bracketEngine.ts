/**
 * PropEdge March Madness Bracket Engine
 *
 * Win probability model combining:
 * 1. Championship odds (market-implied probability) — 30% weight
 * 2. Adjusted efficiency margin — 25% weight
 * 3. Scoring margin — 10% weight
 * 4. Matchup analysis (style, pace, size) — 20% weight
 * 5. Recent form + momentum — 10% weight
 * 6. Strength of schedule adjustment — 5% weight
 */

import { NCAATeam, ALL_TEAMS, SEED_MATCHUPS, REGIONS, Region } from "../data/bracketData";

export interface MatchupResult {
  winner: NCAATeam;
  loser: NCAATeam;
  winProbability: number; // winner's probability 0-1
  projectedScore: { winner: number; loser: number };
  matchupFactors: MatchupFactor[];
  upsetAlert: boolean;
  confidenceScore: number; // 0-100
  analysis: string;
}

export interface MatchupFactor {
  label: string;
  advantage: "teamA" | "teamB" | "even";
  value: string;
  weight: number; // impact 0-10
}

export interface BracketRound {
  round: number;
  name: string;
  matchups: MatchupResult[];
}

export interface GeneratedBracket {
  region: Region;
  rounds: BracketRound[];
  regionWinner: NCAATeam;
}

export interface FullBracket {
  regions: GeneratedBracket[];
  finalFour: BracketRound;
  championship: MatchupResult;
  champion: NCAATeam;
  generatedAt: string;
  confidenceScore: number;
}

// ── Core win probability calculation ──────────────────────────────────────────

function oddsImpliedProb(team: NCAATeam): number {
  const ml = team.championshipOdds;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

function normalizeEffMargin(team: NCAATeam, opponent: NCAATeam): number {
  // Convert efficiency margin difference to a win probability component
  const diff = team.adjEffMargin - opponent.adjEffMargin;
  // Each point of EM ≈ ~2.5% win prob swing in tournament setting
  return 0.5 + Math.min(Math.max(diff * 0.025, -0.45), 0.45);
}

function formMultiplier(form: NCAATeam["recentForm"]): number {
  return form === "hot" ? 1.08 : form === "cold" ? 0.92 : 1.0;
}

function scheduleAdjustment(team: NCAATeam, opponent: NCAATeam): number {
  // Teams with harder schedules get a slight boost in toss-ups
  const diff = team.strengthOfSchedule - opponent.strengthOfSchedule;
  return 0.5 + diff * 0.02;
}

function styleMatchup(teamA: NCAATeam, teamB: NCAATeam): { aAdv: number; factors: MatchupFactor[] } {
  let aAdv = 0;
  const factors: MatchupFactor[] = [];

  // Pace control: slow team vs fast team
  const paceDiff = teamA.pace - teamB.pace;
  if (Math.abs(paceDiff) > 3) {
    const slowerIsA = paceDiff < 0;
    // Slow-paced teams with great defense win at slow pace; fast teams win shootouts
    const aHasDefEdge = teamA.adjDefRating < teamB.adjDefRating;
    if (slowerIsA && aHasDefEdge) {
      aAdv += 0.04;
      factors.push({ label: "Pace Control", advantage: "teamA", value: `${teamA.shortName} slows it down (${teamA.pace.toFixed(1)} vs ${teamB.pace.toFixed(1)} poss/40)`, weight: 6 });
    } else if (!slowerIsA && teamA.adjOffRating > teamB.adjOffRating) {
      aAdv += 0.03;
      factors.push({ label: "Tempo Advantage", advantage: "teamA", value: `${teamA.shortName} pushes pace with superior offense`, weight: 5 });
    } else {
      aAdv -= 0.02;
      factors.push({ label: "Pace Mismatch", advantage: "teamB", value: `${teamB.shortName} dictates tempo`, weight: 4 });
    }
  } else {
    factors.push({ label: "Pace", advantage: "even", value: "Similar tempo teams — style neutralized", weight: 2 });
  }

  // Interior dominance: teams with high 2PT% vs teams with high 3PT rate
  const aInterior = teamA.fg2Pct > 53;
  const bPerimeter = teamB.threePointRate > 40;
  if (aInterior && bPerimeter) {
    aAdv += 0.03;
    factors.push({ label: "Interior vs Perimeter", advantage: "teamA", value: `${teamA.shortName}'s paint game vs ${teamB.shortName}'s 3PT reliance — rim attacks beat shooting in March`, weight: 7 });
  } else if (!aInterior && bPerimeter && teamB.fg3Pct > 37) {
    aAdv -= 0.04;
    factors.push({ label: "3PT Shooting Edge", advantage: "teamB", value: `${teamB.shortName}'s elite shooting (${teamB.fg3Pct}% from 3) can light up ${teamA.shortName}`, weight: 7 });
  }

  // Rebounding differential
  const orebDiff = teamA.orebRate - teamB.orebRate;
  if (orebDiff > 5) {
    aAdv += 0.03;
    factors.push({ label: "Offensive Rebounding", advantage: "teamA", value: `${teamA.shortName} crashes the glass harder (+${orebDiff.toFixed(0)}% ORB rate)`, weight: 6 });
  } else if (orebDiff < -5) {
    aAdv -= 0.03;
    factors.push({ label: "Offensive Rebounding", advantage: "teamB", value: `${teamB.shortName} dominates second chances`, weight: 6 });
  }

  // Turnover battle
  const toForceDiff = teamA.turnoversForced - teamB.turnoverRate;
  if (toForceDiff > 4) {
    aAdv += 0.04;
    factors.push({ label: "Turnover Battle", advantage: "teamA", value: `${teamA.shortName} forces TOs (${teamA.turnoversForced.toFixed(1)}% rate) vs ${teamB.shortName}'s careless offense (${teamB.turnoverRate.toFixed(1)}%)`, weight: 8 });
  } else if (toForceDiff < -4) {
    aAdv -= 0.03;
    factors.push({ label: "Ball Security", advantage: "teamB", value: `${teamB.shortName} protects the ball well vs ${teamA.shortName}'s pressure`, weight: 6 });
  }

  // Elite defense vs elite offense
  if (teamA.adjDefRating < 93 && teamB.adjOffRating > 117) {
    aAdv -= 0.03;
    factors.push({ label: "Offensive Firepower", advantage: "teamB", value: `${teamB.shortName}'s elite offense (${teamB.adjOffRating.toFixed(1)} adj. off.) tests ${teamA.shortName}'s defense`, weight: 7 });
  } else if (teamA.adjOffRating > 117 && teamB.adjDefRating < 93) {
    aAdv += 0.04;
    factors.push({ label: "Offensive Firepower", advantage: "teamA", value: `${teamA.shortName}'s top-tier attack (${teamA.adjOffRating.toFixed(1)}) vs vulnerable ${teamB.shortName} defense`, weight: 7 });
  }

  // Seed/experience as a small factor
  if (teamA.seed <= 3 && teamA.strengthOfSchedule > 8.5) {
    aAdv += 0.02;
    factors.push({ label: "Tournament Experience", advantage: "teamA", value: `${teamA.shortName}'s elite schedule prepares them for high-pressure games`, weight: 4 });
  }

  // Form factor
  if (teamA.recentForm === "hot" && teamB.recentForm !== "hot") {
    aAdv += 0.03;
    factors.push({ label: "Momentum", advantage: "teamA", value: `${teamA.shortName} is the hotter team entering the tournament`, weight: 6 });
  } else if (teamB.recentForm === "hot" && teamA.recentForm !== "hot") {
    aAdv -= 0.03;
    factors.push({ label: "Momentum", advantage: "teamB", value: `${teamB.shortName} has the hot hand — momentum is real in March`, weight: 6 });
  }

  return { aAdv, factors };
}

function projectScore(winner: NCAATeam, loser: NCAATeam, winProb: number): { winner: number; loser: number } {
  const avgPace = (winner.pace + loser.pace) / 2;
  const possessions = avgPace * 0.98; // slight slowdown in big games

  // Points per possession
  const wPPP = winner.adjOffRating / 100;
  const lPPP = loser.adjOffRating / 100;

  // Adjust for opponent defense
  const defFactor = (winner.adjDefRating + loser.adjDefRating) / 200;
  const winnerPts = Math.round(wPPP * possessions * (1 - (loser.adjDefRating - 95) / 100) * 0.95);
  const loserPts = Math.round(lPPP * possessions * (1 - (winner.adjDefRating - 95) / 100) * 0.95);

  // Ensure winner scores more, margin proportional to win prob
  const margin = Math.max(2, Math.round((winProb - 0.5) * 40));
  const adjustedLoser = Math.min(loserPts, winnerPts - margin);

  return {
    winner: Math.max(winnerPts, 55),
    loser: Math.max(adjustedLoser, 48)
  };
}

export function calculateMatchup(teamA: NCAATeam, teamB: NCAATeam): MatchupResult {
  // === COMPONENT 1: Market-implied probability (30%) ===
  const aMarketProb = oddsImpliedProb(teamA);
  const bMarketProb = oddsImpliedProb(teamB);
  const marketSum = aMarketProb + bMarketProb;
  const aMarketNorm = marketSum > 0 ? aMarketProb / marketSum : 0.5;

  // === COMPONENT 2: Efficiency margin (25%) ===
  const aEffProb = normalizeEffMargin(teamA, teamB);

  // === COMPONENT 3: Scoring margin (10%) ===
  const scoreDiff = teamA.scoringMargin - teamB.scoringMargin;
  const aScoringProb = 0.5 + Math.min(Math.max(scoreDiff * 0.015, -0.3), 0.3);

  // === COMPONENT 4: Matchup/style analysis (20%) ===
  const { aAdv, factors } = styleMatchup(teamA, teamB);
  const aStyleProb = 0.5 + aAdv;

  // === COMPONENT 5: Recent form (10%) ===
  const aForm = formMultiplier(teamA.recentForm);
  const bForm = formMultiplier(teamB.recentForm);
  const aFormProb = aForm / (aForm + bForm);

  // === COMPONENT 6: Schedule strength (5%) ===
  const aScheduleProb = scheduleAdjustment(teamA, teamB);

  // === WEIGHTED COMBINATION ===
  const aWinProb =
    aMarketNorm * 0.30 +
    aEffProb * 0.25 +
    aScoringProb * 0.10 +
    aStyleProb * 0.20 +
    aFormProb * 0.10 +
    aScheduleProb * 0.05;

  // Clamp to reasonable range
  const clampedProb = Math.min(Math.max(aWinProb, 0.05), 0.95);

  const winner = clampedProb >= 0.5 ? teamA : teamB;
  const loser = clampedProb >= 0.5 ? teamB : teamA;
  const winProb = clampedProb >= 0.5 ? clampedProb : 1 - clampedProb;

  // Add key stats factors for display
  factors.push({
    label: "Efficiency Margin",
    advantage: teamA.adjEffMargin > teamB.adjEffMargin ? "teamA" : "teamB",
    value: `${teamA.shortName}: +${teamA.adjEffMargin.toFixed(1)} vs ${teamB.shortName}: +${teamB.adjEffMargin.toFixed(1)} adj. eff. margin`,
    weight: 9
  });

  factors.push({
    label: "Championship Market",
    advantage: teamA.championshipOdds < teamB.championshipOdds ? "teamA" : "teamB",
    value: `${teamA.shortName} +${teamA.championshipOdds} vs ${teamB.shortName} +${teamB.championshipOdds} (sportsbook title odds)`,
    weight: 8
  });

  // Confidence score: high when both model and market agree
  const agreement = 1 - Math.abs(aMarketNorm - clampedProb);
  const confidenceScore = Math.round(50 + agreement * 30 + (winProb - 0.5) * 40);

  // Upset detection: lower seed wins
  const upsetAlert = winner.seed > loser.seed;

  // Generate analysis
  const margin = winProb > 0.75 ? "comfortably" : winProb > 0.62 ? "in a competitive game" : "in an upset";
  const analysis = upsetAlert
    ? `UPSET: ${winner.name} (${winner.seed}-seed) over ${loser.name} (${loser.seed}-seed) — ${(winProb * 100).toFixed(0)}% win probability. ${winner.analysis.split(".")[0]}.`
    : `${winner.name} wins ${margin} with ${(winProb * 100).toFixed(0)}% probability. ${winner.analysis.split(".")[0]}.`;

  const projectedScore = projectScore(winner, loser, winProb);

  return {
    winner, loser, winProbability: winProb,
    projectedScore, matchupFactors: factors.sort((a, b) => b.weight - a.weight),
    upsetAlert, confidenceScore, analysis
  };
}

// ── Regional bracket simulation ───────────────────────────────────────────────

function getRegionTeams(region: Region): NCAATeam[] {
  return ALL_TEAMS.filter(t => t.region === region).sort((a, b) => a.seed - b.seed);
}

function simulateRegion(region: Region): GeneratedBracket {
  const teams = getRegionTeams(region);
  const rounds: BracketRound[] = [];

  // Round 1: Standard seed matchups
  const r1matchups: MatchupResult[] = [];
  const seedMatchups: [number, number][] = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];

  // Handle First Four: for regions with two 11-seeds or 16-seeds, pick one
  let teamPool = [...teams];
  // Remove play-in duplicates — keep the one with better odds (simulates First Four win)
  const seedCounts: Record<number, NCAATeam[]> = {};
  teamPool.forEach(t => {
    if (!seedCounts[t.seed]) seedCounts[t.seed] = [];
    seedCounts[t.seed].push(t);
  });

  // For seeds with 2 teams (First Four), simulate the play-in
  const resolvedTeams: NCAATeam[] = [];
  for (const [seed, ts] of Object.entries(seedCounts)) {
    if (ts.length === 2) {
      const result = calculateMatchup(ts[0], ts[1]);
      resolvedTeams.push(result.winner);
    } else {
      resolvedTeams.push(ts[0]);
    }
  }

  // Now simulate bracket
  for (const [aSeed, bSeed] of seedMatchups) {
    const teamA = resolvedTeams.find(t => t.seed === aSeed);
    const teamB = resolvedTeams.find(t => t.seed === bSeed);
    if (teamA && teamB) {
      r1matchups.push(calculateMatchup(teamA, teamB));
    }
  }

  rounds.push({ round: 1, name: "Round of 64", matchups: r1matchups });

  // Round 2 — Sweet 16 feed
  const r2winners = r1matchups.map(m => m.winner);
  const r2matchups: MatchupResult[] = [];
  const r2pairs: [number, number][] = [[0,1],[2,3],[4,5],[6,7]]; // index pairs from r1
  for (const [i, j] of r2pairs) {
    if (r2winners[i] && r2winners[j]) {
      r2matchups.push(calculateMatchup(r2winners[i], r2winners[j]));
    }
  }
  rounds.push({ round: 2, name: "Round of 32", matchups: r2matchups });

  // Sweet 16
  const r3winners = r2matchups.map(m => m.winner);
  const r3matchups: MatchupResult[] = [];
  for (let i = 0; i < r3winners.length; i += 2) {
    if (r3winners[i] && r3winners[i+1]) {
      r3matchups.push(calculateMatchup(r3winners[i], r3winners[i+1]));
    }
  }
  rounds.push({ round: 3, name: "Sweet 16", matchups: r3matchups });

  // Elite Eight
  const r4winners = r3matchups.map(m => m.winner);
  const r4matchups: MatchupResult[] = [];
  if (r4winners[0] && r4winners[1]) {
    r4matchups.push(calculateMatchup(r4winners[0], r4winners[1]));
  }
  rounds.push({ round: 4, name: "Elite Eight", matchups: r4matchups });

  const regionWinner = r4matchups[0]?.winner ?? r3winners[0];
  return { region, rounds, regionWinner };
}

// ── Full bracket generation ───────────────────────────────────────────────────

export function generateBracket(): FullBracket {
  const regions = REGIONS.map(r => simulateRegion(r));

  // Final Four: traditional bracket (East vs West, Midwest vs South)
  const eastWinner = regions.find(r => r.region === "East")!.regionWinner;
  const westWinner = regions.find(r => r.region === "West")!.regionWinner;
  const midwestWinner = regions.find(r => r.region === "Midwest")!.regionWinner;
  const southWinner = regions.find(r => r.region === "South")!.regionWinner;

  const sf1 = calculateMatchup(eastWinner, westWinner);
  const sf2 = calculateMatchup(midwestWinner, southWinner);

  const finalFour: BracketRound = {
    round: 5,
    name: "Final Four",
    matchups: [sf1, sf2]
  };

  const championship = calculateMatchup(sf1.winner, sf2.winner);

  const avgConfidence = [
    ...regions.flatMap(r => r.rounds.flatMap(rd => rd.matchups.map(m => m.confidenceScore)))
  ].reduce((a, b) => a + b, 0) / regions.reduce((s, r) => s + r.rounds.reduce((ss, rd) => ss + rd.matchups.length, 0), 0);

  return {
    regions,
    finalFour,
    championship,
    champion: championship.winner,
    generatedAt: new Date().toISOString(),
    confidenceScore: Math.round(avgConfidence)
  };
}

// ── Utility: Get upset picks ──────────────────────────────────────────────────
export function getUpsetPicks(bracket: FullBracket): MatchupResult[] {
  return [
    ...bracket.regions.flatMap(r => r.rounds.flatMap(rd => rd.matchups.filter(m => m.upsetAlert))),
    ...bracket.finalFour.matchups.filter(m => m.upsetAlert)
  ];
}

// ── Utility: Get team's bracket path ─────────────────────────────────────────
export function getTeamPath(bracket: FullBracket, teamId: string): MatchupResult[] {
  const results: MatchupResult[] = [];
  for (const region of bracket.regions) {
    for (const round of region.rounds) {
      for (const matchup of round.matchups) {
        if (matchup.winner.id === teamId || matchup.loser.id === teamId) {
          results.push(matchup);
          if (matchup.loser.id === teamId) return results;
        }
      }
    }
  }
  // Check Final Four and championship
  for (const matchup of bracket.finalFour.matchups) {
    if (matchup.winner.id === teamId || matchup.loser.id === teamId) {
      results.push(matchup);
      if (matchup.loser.id === teamId) return results;
    }
  }
  results.push(bracket.championship);
  return results;
}

// Round name helper
export const ROUND_NAMES: Record<number, string> = {
  1: "Round of 64",
  2: "Round of 32",
  3: "Sweet 16",
  4: "Elite Eight",
  5: "Final Four",
  6: "Championship"
};
