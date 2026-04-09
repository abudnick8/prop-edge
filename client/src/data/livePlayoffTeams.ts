/**
 * livePlayoffTeams.ts
 *
 * Converts live ESPN standings data (from /api/live-standings) into NCAATeam
 * objects that plug directly into the existing bracketEngine.
 *
 * Called by Bracket.tsx when a tournament has liveStandingsSport defined.
 * Data is fetched once and cached in sessionStorage for 24 hours.
 */

import { NCAATeam } from "./bracketData";
import { Region } from "./bracketData";

// ── Team name / odds lookup tables ─────────────────────────────────────────
// Championship odds (moneyline) — static estimates; updated pre-season.
// These are used for the implied championship % calculation and bracket display.
// They don't need to be 100% live — rough odds convey relative strength.

const MLB_ODDS: Record<string, number> = {
  LAD: 400, NYY: 600, ATL: 700, HOU: 800, NYM: 900, PHI: 900,
  BOS: 1000, SD: 1000, CHC: 1200, MIL: 1200, CLE: 1400, SEA: 1400,
  TOR: 1600, TB: 1800, MIN: 2000, BAL: 2200, TEX: 2200, ARI: 2500,
  CIN: 2500, MIA: 3000, SF: 3000, STL: 3500, COL: 4000, KC: 4000,
  DET: 5000, OAK: 5000, PIT: 6000, CWS: 8000, WSH: 8000, LAA: 10000,
};
const NBA_ODDS: Record<string, number> = {
  OKC: 280, BOS: 450, SAS: 380, LAL: 1200, DEN: 1800, CLE: 2200,
  DET: 1400, NYK: 900, HOU: 2800, MIA: 3500, MIL: 2800, PHX: 4000,
  MIN: 3200, DAL: 2400, MEM: 5000, SAC: 6000, ATL: 4500, PHI: 5000,
  GSW: 5000, CHI: 8000, NOP: 9000, BKN: 9000, TOR: 10000, IND: 7000,
  ORL: 5000, WAS: 15000, CHA: 15000, POR: 12000, UTA: 10000,
};
const NHL_ODDS: Record<string, number> = {
  COL: 320, CAR: 500, TBL: 600, DAL: 750, SAS: 380, BOS: 1800,
  MTL: 900, BUF: 1400, PIT: 2200, NYI: 3800, EDM: 1200, ANA: 3200,
  NSH: 9000, MIN: 1600, WSH: 3000, NYR: 2500, TOR: 2000, CGY: 4000,
  VGK: 3500, SEA: 4000, FLA: 2800, DET: 6000, CBJ: 9000, SJS: 12000,
  WPG: 2200, PHI: 5000, STL: 4500, ARI: 15000, CHI: 10000, OTT: 4500,
  NJD: 3000, VAN: 2500,
};
const NFL_ODDS: Record<string, number> = {
  KC: 600, PHI: 700, SF: 800, BUF: 900, DET: 1000, DAL: 1200,
  BAL: 1200, CIN: 1400, MIA: 1600, NYJ: 2000, LAC: 2000, CLE: 2500,
  SEA: 2500, MIN: 2500, GB: 1800, TB: 2000, LAR: 2200, NO: 4000,
  ATL: 4000, JAX: 5000, HOU: 2800, NYG: 6000, IND: 3500, TEN: 8000,
  ARI: 8000, LV: 8000, WAS: 6000, CHI: 3000, CAR: 15000, NE: 15000,
  DEN: 5000, PIT: 2500,
};

function getChampOdds(sport: string, abbr: string): number {
  const map: Record<string, Record<string, number>> = {
    mlb: MLB_ODDS, nba: NBA_ODDS, nhl: NHL_ODDS, nfl: NFL_ODDS,
  };
  return map[sport]?.[abbr] ?? 8000;
}

function mlToImplied(ml: number): number {
  if (ml > 0) return parseFloat((100 / (ml + 100) * 100).toFixed(1));
  return parseFloat((Math.abs(ml) / (Math.abs(ml) + 100) * 100).toFixed(1));
}

// ── Conference → Region mapping ────────────────────────────────────────────
// The bracketEngine needs teams in East/West/Midwest/South regions.
// For 16-team playoffs (NBA/NHL): split each conference into top/bottom halves.
// For 12-team playoffs (MLB): AL → East/Midwest, NL → West/South
// For 14-team playoffs (NFL): AFC → East/Midwest, NFC → West/South

function assignRegion(sport: string, conference: string, seed: number): Region {
  const c = conference.toLowerCase();
  if (sport === "mlb") {
    const isAL = c.includes("american");
    // MLB: seeds 1-3 = top half, seeds 4-6 = bottom half
    if (isAL) return seed <= 3 ? "East" : "Midwest";
    return seed <= 3 ? "West" : "South";
  }
  if (sport === "nba" || sport === "nhl") {
    const isEast = c.includes("east") || c.includes("atlantic") || c.includes("metro");
    // Seeds 1,4,5,8 = top half; 2,3,6,7 = bottom half
    const isTopHalf = [1, 4, 5, 8].includes(seed);
    if (isEast) return isTopHalf ? "East" : "Midwest";
    return isTopHalf ? "West" : "South";
  }
  if (sport === "nfl") {
    const isAFC = c.includes("american");
    const isTopHalf = [1, 4, 5].includes(seed);
    if (isAFC) return isTopHalf ? "East" : "Midwest";
    return isTopHalf ? "West" : "South";
  }
  return "East";
}

// ── Style/analysis generators ──────────────────────────────────────────────
function getPlayStyle(sport: string, seed: number, winPct: number): string[] {
  if (seed === 1) return ["division-winner", "top-seed", "home-field"];
  if (seed <= 3) return ["division-winner", "playoff-experience", "consistent"];
  if (seed <= 6) return ["wild-card", "hot-streak", "dangerous-underdog"];
  return ["wild-card", "play-in-survivor", "upset-potential"];
}

function getAnalysis(sport: string, name: string, seed: number, wins: number, losses: number, pct: number): string {
  const record = `${wins}-${losses}`;
  const winPctStr = (pct * 100).toFixed(1);
  if (seed === 1) return `${name} earned the top seed with a ${record} record (${winPctStr}% win rate). They'll have home field advantage throughout the playoffs.`;
  if (seed <= 3) return `${name} secured a division title at ${record}. A strong season positions them as a genuine contender.`;
  if (seed <= 6) return `${name} earned a Wild Card spot at ${record}. They'll need to prove themselves starting from round one.`;
  return `${name} survived to reach the playoffs at ${record}. As a lower seed, every game is an elimination game.`;
}

// ── Play style per sport ───────────────────────────────────────────────────
function getConferenceFinish(sport: string, conference: string, seed: number): string {
  const confShort = conference.includes("American") || conference.includes("AFC") ? "AL" :
                    conference.includes("National") || conference.includes("NFC") ? "NL" :
                    conference.includes("East") ? "East" :
                    conference.includes("West") ? "West" : conference;
  if (seed === 1) return `${confShort} #1 Seed`;
  if (seed <= 3) return `${confShort} Division Winner`;
  return `${confShort} Wild Card #${seed - 3}`;
}

// ── Main converter ─────────────────────────────────────────────────────────
export interface LiveStandingsData {
  sport: string;
  seasonYear: number;
  seasonPct: number;
  maxGamesPlayed: number;
  totalGamesPerTeam: number;
  bracketUnlocked: boolean;
  unlockThreshold: number;
  updatedAt: string;
  conferences: Record<string, any[]>;
  playoffTeamsByConf: Record<string, any[]>;
  allTeams: any[];
}

export function buildLivePlayoffTeams(
  data: LiveStandingsData
): { teams: NCAATeam[]; regions: Region[] } {
  const sport = data.sport;
  const playoffSpots = sport === "mlb" ? 6 : sport === "nfl" ? 7 : 8;
  const teams: NCAATeam[] = [];

  // Flatten all conferences, take top N seeds from each
  const confNames = Object.keys(data.playoffTeamsByConf);
  confNames.forEach(confName => {
    const confTeams = data.playoffTeamsByConf[confName] ?? [];
    const topTeams = confTeams
      .filter(t => t.seed > 0 && t.seed <= playoffSpots)
      .sort((a, b) => a.seed - b.seed);

    topTeams.forEach(t => {
      const seed = t.seed;
      const region = assignRegion(sport, confName, seed);
      const champOdds = getChampOdds(sport, t.abbreviation);
      const ppg = t.ppg || 0;
      const oppPpg = t.oppPpg || 0;
      const diff = t.differential || (ppg - oppPpg);

      // Build a synthetic efficiency rating from win% and differential
      const baseOff = 100 + diff * 2 + ppg * 0.5;
      const baseDef = 100 + oppPpg * 0.5 - diff * 1.5;
      const effMargin = baseOff - baseDef;

      const team: NCAATeam = {
        id: `${sport}_${t.abbreviation.toLowerCase()}_${seed}`,
        name: t.name,
        shortName: t.abbreviation || t.shortName,
        seed,
        region,
        record: t.record,
        wins: t.wins,
        losses: t.losses,
        championshipOdds: champOdds,
        impliedChampionshipPct: mlToImplied(champOdds),
        ppg: parseFloat(ppg.toFixed(1)),
        oppPpg: parseFloat(oppPpg.toFixed(1)),
        scoringMargin: parseFloat(diff.toFixed(1)),
        fg2Pct: 50,
        fg3Pct: 35,
        ftPct: 77,
        threePointRate: 38,
        adjOffRating: parseFloat(baseOff.toFixed(1)),
        adjDefRating: parseFloat(baseDef.toFixed(1)),
        adjEffMargin: parseFloat(effMargin.toFixed(1)),
        pace: 100,
        orebRate: 25,
        drebRate: 75,
        turnoversForced: 14,
        turnoverRate: 13,
        keyPlayers: [
          { name: `${t.name}`, stat: `${t.wins}W · ${t.record}` },
        ],
        playStyle: getPlayStyle(sport, seed, t.winPct),
        strengthOfSchedule: 7.0 + (seed <= 3 ? 1 : 0),
        recentForm: t.winPct >= 0.6 ? "hot" : t.winPct >= 0.5 ? "average" : "cold",
        conferenceFinish: getConferenceFinish(sport, confName, seed),
        upsetAlert: seed >= 5,
        sleeper: seed >= 5 && t.winPct >= 0.52,
        analysis: getAnalysis(sport, t.name, seed, t.wins, t.losses, t.winPct),
      };
      teams.push(team);
    });
  });

  return { teams, regions: ["East", "West", "Midwest", "South"] };
}

// ── Cache helper ───────────────────────────────────────────────────────────
const STANDINGS_CACHE_KEY = (sport: string) => `clubhouseiq_standings_${sport}`;
const STANDINGS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchLiveStandings(sport: string): Promise<LiveStandingsData | null> {
  try {
    // Check sessionStorage cache
    const cacheKey = STANDINGS_CACHE_KEY(sport);
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed._fetchedAt < STANDINGS_CACHE_TTL) {
        return parsed as LiveStandingsData;
      }
    }
  } catch {}

  try {
    const res = await fetch(`/api/live-standings?sport=${sport}`);
    if (!res.ok) return null;
    const data: LiveStandingsData = await res.json();
    // Cache in sessionStorage
    try {
      sessionStorage.setItem(STANDINGS_CACHE_KEY(sport), JSON.stringify({ ...data, _fetchedAt: Date.now() }));
    } catch {}
    return data;
  } catch {
    return null;
  }
}
