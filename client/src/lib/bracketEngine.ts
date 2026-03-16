/**
 * PropEdge March Madness Bracket Engine v3
 *
 * Win probability model — 5 components + historically-calibrated probabilistic draws
 *
 * HOW IT WORKS:
 * 1. Compute a win probability for each matchup using 5 components
 * 2. Apply hard floor/ceiling bounds per seed matchup (prevents impossible outcomes)
 * 3. Use a PROBABILISTIC DRAW to determine the winner — not a deterministic pick
 *    This is how real bracket simulators work and is why upsets occur at the right rate
 *
 * Historical calibration (2015-2024, 10 NCAA tournaments):
 * - R1 avg: ~7.5 upsets per 32-game first round across full bracket
 * - 5v12: 35% upset rate (most famous bracket-busting matchup)
 * - 6v11: 37% upset rate
 * - 7v10: 40% upset rate
 * - 8v9:  49% — coin flip (most upsets by count)
 * - 1v16: 1.5% — UMBC 2018 is the only one in 40 years
 * - 2v15: 7% — Mercer, FGCU, etc.
 *
 * Seed base rates (30% component weight):
 * - 1v16: 98.5%, 2v15: 93.4%, 3v14: 84.8%, 4v13: 79.3%
 * - 5v12: 64.8%, 6v11: 62.2%, 7v10: 60.2%, 8v9: 50.9%
 *
 * Expected upset counts per full bracket generation (all rounds, probabilistic):
 * - Round 1: ~7-9 upsets
 * - Round 2: ~3-5 upsets
 * - Sweet 16: ~1-3 upsets
 * - Elite 8+: ~0-2 upsets
 * - Total: ~12-16 upsets (matching real tournament averages)
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

/**
 * COMPONENT 1: Seed-based historical base rate
 * Source: 60 years of NCAA tournament data (1985-2025), higher seed = better team.
 * Maps the seed DIFFERENCE between the favored (lower number) seed and underdog
 * to the favorite's historical win rate.
 *
 * For non-standard later-round matchups (e.g. 3 vs 6 in Sweet 16),
 * we interpolate based on the absolute seed difference.
 */
const SEED_BASE_RATES: Record<string, number> = {
  // key = "higherSeed_lowerSeed" (higher seed is the BETTER team)
  "1_16": 0.985,  // 1-seeds: 99.6% all time — UMBC 2018 is the only loss
  "1_15": 0.985,  // shouldn't happen R1 but safety
  "2_15": 0.934,
  "3_14": 0.848,
  "4_13": 0.793,
  "5_12": 0.648,
  "6_11": 0.622,
  "7_10": 0.602,
  "8_9":  0.509,  // closest to 50/50 in history
  "1_8":  0.87,   // Sweet 16 / later rounds — these are estimated
  "1_4":  0.72,
  "1_5":  0.76,
  "2_3":  0.62,
  "2_6":  0.68,
  "2_7":  0.71,
  "1_2":  0.60,
  "1_3":  0.64,
  "2_4":  0.60,
  "3_6":  0.58,
  "4_5":  0.54,
};

function getSeedBaseRate(teamA: NCAATeam, teamB: NCAATeam): number {
  // teamA is the team we're computing probability FOR
  const better  = teamA.seed <= teamB.seed ? teamA : teamB;
  const worse   = teamA.seed <= teamB.seed ? teamB : teamA;
  const favIsA  = better.id === teamA.id;

  const key1 = `${better.seed}_${worse.seed}`;
  const key2 = `${worse.seed}_${better.seed}`;
  let favRate = SEED_BASE_RATES[key1] ?? SEED_BASE_RATES[key2];

  if (favRate === undefined) {
    // Interpolate: larger seed gap → stronger favorite
    const gap = worse.seed - better.seed;
    // Base: 0.50 for equal seeds, +2.5% per seed gap, capped at 85%
    favRate = Math.min(0.50 + gap * 0.025, 0.85);
  }

  return favIsA ? favRate : 1 - favRate;
}

/**
 * COMPONENT 2: Adjusted efficiency margin delta
 * Calibrated to tournament games specifically (reg season scale is too aggressive).
 * Each +1 pt of EM advantage ≈ 1.8% win prob swing (tighter than reg season ~3%).
 * Capped at ±30% so even dominant teams retain some upset risk.
 */
function getEffMarginProb(teamA: NCAATeam, teamB: NCAATeam): number {
  const diff = teamA.adjEffMargin - teamB.adjEffMargin;
  return 0.5 + Math.min(Math.max(diff * 0.018, -0.30), 0.30);
}

function formMultiplier(form: NCAATeam["recentForm"]): number {
  return form === "hot" ? 1.06 : form === "cold" ? 0.94 : 1.0;
}

function scheduleAdjustment(team: NCAATeam, opponent: NCAATeam): number {
  const diff = team.strengthOfSchedule - opponent.strengthOfSchedule;
  // Small effect — hard schedule gives slight edge in toss-ups, max ±4%
  return 0.5 + Math.min(Math.max(diff * 0.015, -0.04), 0.04);
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
    aAdv += 0.02;
    factors.push({ label: "Momentum", advantage: "teamA", value: `${teamA.shortName} is the hotter team entering the tournament`, weight: 6 });
  } else if (teamB.recentForm === "hot" && teamA.recentForm !== "hot") {
    aAdv -= 0.02;
    factors.push({ label: "Momentum", advantage: "teamB", value: `${teamB.shortName} has the hot hand — momentum is real in March`, weight: 6 });
  }

  // !! HARD CAP: style factors can shift result by at most ±10% total
  // This prevents style analysis from overriding talent gap
  aAdv = Math.min(Math.max(aAdv, -0.10), 0.10);

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
  // =========================================================================
  // COMPONENT 1: Seed-based historical base rate (30%)
  // Hard-coded from 60 years of NCAA tournament results.
  // This is the "common sense" anchor.
  // =========================================================================
  const aSeedProb = getSeedBaseRate(teamA, teamB);

  // =========================================================================
  // COMPONENT 2: Adjusted efficiency margin (30%)
  // Best single predictor of tournament outcomes — quality-of-team signal.
  // =========================================================================
  const aEffProb = getEffMarginProb(teamA, teamB);

  // =========================================================================
  // COMPONENT 3: Scoring margin / record quality (15%)
  // Season-long scoring differential as supporting evidence.
  // =========================================================================
  const scoreDiff = teamA.scoringMargin - teamB.scoringMargin;
  const aScoringProb = 0.5 + Math.min(Math.max(scoreDiff * 0.012, -0.20), 0.20);

  // =========================================================================
  // COMPONENT 4: Style matchup (15%)
  // Pace, interior vs perimeter, rebounding, turnovers.
  // Already hard-capped at ±10% inside styleMatchup().
  // =========================================================================
  const { aAdv, factors } = styleMatchup(teamA, teamB);
  const aStyleProb = 0.5 + aAdv;

  // =========================================================================
  // COMPONENT 5: Momentum + schedule strength (10%)
  // =========================================================================
  const aForm = formMultiplier(teamA.recentForm);
  const bForm = formMultiplier(teamB.recentForm);
  const aFormProb = aForm / (aForm + bForm);
  const aScheduleProb = scheduleAdjustment(teamA, teamB);
  const aMomentumProb = aFormProb * 0.6 + aScheduleProb * 0.4;

  // =========================================================================
  // WEIGHTED COMBINATION
  // =========================================================================
  const aWinProb =
    aSeedProb    * 0.30 +
    aEffProb     * 0.30 +
    aScoringProb * 0.15 +
    aStyleProb   * 0.15 +
    aMomentumProb * 0.10;

  // =========================================================================
  // HARD FLOOR/CEILING BY SEED MATCHUP
  // Prevents model from ever giving a 1-seed less than 70% vs a 16-seed,
  // or a 5-seed less than 45% vs a 12-seed, etc.
  // These bounds are the MIN/MAX the model can produce regardless of stats.
  // =========================================================================
  const seedBounds: Record<string, [number, number]> = {
    "1_16": [0.88, 0.99],
    "2_15": [0.78, 0.97],
    "3_14": [0.68, 0.95],
    "4_13": [0.58, 0.92],
    "5_12": [0.44, 0.86],
    "6_11": [0.42, 0.82],
    "7_10": [0.38, 0.78],
    "8_9":  [0.34, 0.66],
  };

  // Determine which team is the higher seed (better team)
  const betterTeam  = teamA.seed <= teamB.seed ? teamA : teamB;
  const worseTeam   = teamA.seed <= teamB.seed ? teamB : teamA;
  const betterIsA   = betterTeam.id === teamA.id;
  const boundKey    = `${betterTeam.seed}_${worseTeam.seed}`;
  const bounds      = seedBounds[boundKey];

  let clampedProb = aWinProb;
  if (bounds) {
    // Apply bounds from the better (lower-numbered) seed's perspective
    if (betterIsA) {
      clampedProb = Math.min(Math.max(aWinProb, bounds[0]), bounds[1]);
    } else {
      // teamA is the underdog — invert the bounds
      const underwoodProb = 1 - aWinProb;
      const clampedUnderdog = Math.min(Math.max(underwoodProb, 1 - bounds[1]), 1 - bounds[0]);
      clampedProb = 1 - clampedUnderdog;
    }
  } else {
    // Later rounds — general clamp 15%-85%
    clampedProb = Math.min(Math.max(aWinProb, 0.15), 0.85);
  }

  // Probabilistic draw — this is what makes upsets happen at historical rates
  // Without Math.random(), the higher-seeded team ALWAYS wins (no upsets)
  const aWins = Math.random() < clampedProb;
  const winner = aWins ? teamA : teamB;
  const loser = aWins ? teamB : teamA;
  const winProb = aWins ? clampedProb : 1 - clampedProb;

  // Add key stats factors for display
  factors.push({
    label: "Efficiency Margin",
    advantage: teamA.adjEffMargin > teamB.adjEffMargin ? "teamA" : "teamB",
    value: `${teamA.shortName}: +${teamA.adjEffMargin.toFixed(1)} vs ${teamB.shortName}: +${teamB.adjEffMargin.toFixed(1)} adj. eff. margin`,
    weight: 9
  });

  // Championship market odds as an informational factor (not used in win prob calc)
  const aOdds = teamA.championshipOdds;
  const bOdds = teamB.championshipOdds;
  // Implied title prob (rough): +500 ≈ 16.7%, +1000 ≈ 9.1% — normalize aOdds vs bOdds
  const aMarketImpl = aOdds > 0 ? 100 / (aOdds + 100) : Math.abs(aOdds) / (Math.abs(aOdds) + 100);
  const bMarketImpl = bOdds > 0 ? 100 / (bOdds + 100) : Math.abs(bOdds) / (Math.abs(bOdds) + 100);
  const aMarketNorm = (aMarketImpl + bMarketImpl) > 0 ? aMarketImpl / (aMarketImpl + bMarketImpl) : 0.5;

  factors.push({
    label: "Championship Market",
    advantage: aMarketNorm >= 0.5 ? "teamA" : "teamB",
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
