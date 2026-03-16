// 2026 NCAA March Madness Bracket Data
// All 68 teams with full stats, odds, and analytics

export interface NCAATeam {
  id: string;
  name: string;
  shortName: string;
  seed: number;
  region: "East" | "West" | "Midwest" | "South";
  record: string;
  wins: number;
  losses: number;
  // Betting
  championshipOdds: number; // moneyline e.g. +330
  impliedChampionshipPct: number; // derived from odds
  // Scoring
  ppg: number; // points per game scored
  oppPpg: number; // opponent points allowed per game
  scoringMargin: number;
  // Shooting
  fg2Pct: number; // 2PT field goal %
  fg3Pct: number; // 3PT field goal %
  ftPct: number;
  threePointRate: number; // % of shots that are 3PT
  // Efficiency (KenPom-style, estimated)
  adjOffRating: number; // points per 100 possessions
  adjDefRating: number; // points allowed per 100 possessions
  adjEffMargin: number;
  pace: number; // possessions per 40 min (estimated)
  // Rebounding
  orebRate: number; // offensive rebound rate (0-100)
  drebRate: number;
  // Misc
  turnoversForced: number; // TO% forced (higher = better defense)
  turnoverRate: number; // own TO% (lower = better)
  // Key players (for display)
  keyPlayers: { name: string; stat: string }[];
  // Style tags
  playStyle: string[];
  // Strength
  strengthOfSchedule: number; // 1-10
  recentForm: "hot" | "average" | "cold"; // last 5 games
  conferenceFinish: string;
  // Upset flags
  upsetAlert: boolean;
  sleeper: boolean;
  // Analysis blurb
  analysis: string;
}

// Helper: convert moneyline to implied probability
function mlToImplied(ml: number): number {
  if (ml > 0) return parseFloat((100 / (ml + 100) * 100).toFixed(1));
  return parseFloat((Math.abs(ml) / (Math.abs(ml) + 100) * 100).toFixed(1));
}

const rawTeams: Omit<NCAATeam, "impliedChampionshipPct">[] = [
  // ─── EAST REGION ─────────────────────────────────────────────────────────
  {
    id: "duke", name: "Duke Blue Devils", shortName: "Duke",
    seed: 1, region: "East", record: "32-2", wins: 32, losses: 2,
    championshipOdds: 300, ppg: 85.4, oppPpg: 66.8, scoringMargin: 18.6,
    fg2Pct: 54.2, fg3Pct: 37.8, ftPct: 74.1, threePointRate: 35,
    adjOffRating: 122.8, adjDefRating: 90.1, adjEffMargin: 32.7, pace: 70.2,
    orebRate: 32, drebRate: 74, turnoversForced: 18.2, turnoverRate: 14.1,
    keyPlayers: [{ name: "Cameron Boozer", stat: "21.4 PPG / 10.2 RPG" }, { name: "Isaiah Evans", stat: "14.5 PPG / 3PT threat" }],
    playStyle: ["elite-scoring", "two-way", "paint-dominant", "shot-blocking"],
    strengthOfSchedule: 9.2, recentForm: "hot", conferenceFinish: "ACC Tournament Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Cameron Boozer is a generational talent — the best freshman since Zion. Duke pairs elite interior scoring with the nation's #1 defensive efficiency. 35-3 with an ACC tournament title gives them the top overall seed. Their efficiency margin (32.7) is the best in the country."
  },
  {
    id: "uconn", name: "UConn Huskies", shortName: "UConn",
    seed: 2, region: "East", record: "29-5", wins: 29, losses: 5,
    championshipOdds: 2800, ppg: 78.3, oppPpg: 65.4, scoringMargin: 12.9,
    fg2Pct: 52.1, fg3Pct: 39.8, ftPct: 72.3, threePointRate: 38,
    adjOffRating: 116.8, adjDefRating: 92.4, adjEffMargin: 24.4, pace: 67.8,
    orebRate: 28, drebRate: 76, turnoversForced: 19.8, turnoverRate: 13.2,
    keyPlayers: [{ name: "Solo Ball", stat: "13.9 PPG" }, { name: "Tarris Reed Jr.", stat: "13.8 PPG / 8.0 RPG" }],
    playStyle: ["defensive-anchor", "multiple-scorers", "efficient", "shot-blocking"],
    strengthOfSchedule: 8.8, recentForm: "average", conferenceFinish: "Big East Runner-Up",
    upsetAlert: false, sleeper: false,
    analysis: "Two-time champion DNA remains but UConn has regressed from their dynasty peak. Defense is still elite (top-12 nationally) and Reed Jr. anchors the interior. Solo Ball provides scoring punch. 26-7 shows some vulnerability but tournament experience is unmatched."
  },
  {
    id: "michigan-state", name: "Michigan State Spartans", shortName: "MSU",
    seed: 3, region: "East", record: "25-7", wins: 25, losses: 7,
    championshipOdds: 4000, ppg: 74.1, oppPpg: 65.2, scoringMargin: 8.9,
    fg2Pct: 51.8, fg3Pct: 34.6, ftPct: 73.8, threePointRate: 30,
    adjOffRating: 117.0, adjDefRating: 92.6, adjEffMargin: 24.4, pace: 66.1,
    orebRate: 34, drebRate: 72, turnoversForced: 21.4, turnoverRate: 15.8,
    keyPlayers: [{ name: "Jeremy Fears Jr.", stat: "15.5 PPG / 9.1 APG" }],
    playStyle: ["defense-first", "rebounding", "grind-it-out", "experience"],
    strengthOfSchedule: 8.9, recentForm: "average", conferenceFinish: "Big Ten 3rd",
    upsetAlert: false, sleeper: false,
    analysis: "Tom Izzo in the tournament is worth at least a seed and a half. 7th nationally in offensive rebounding and top-12 defense. Jeremy Fears Jr. runs the show — his elite assist-to-turnover ratio is tournament-built. Ceiling is Final Four."
  },
  {
    id: "kansas", name: "Kansas Jayhawks", shortName: "Kansas",
    seed: 4, region: "East", record: "23-10", wins: 23, losses: 10,
    championshipOdds: 6000, ppg: 76.8, oppPpg: 68.4, scoringMargin: 8.4,
    fg2Pct: 50.9, fg3Pct: 38.7, ftPct: 71.2, threePointRate: 37,
    adjOffRating: 113.2, adjDefRating: 97.1, adjEffMargin: 16.1, pace: 68.4,
    orebRate: 29, drebRate: 71, turnoversForced: 17.9, turnoverRate: 16.2,
    keyPlayers: [{ name: "Darryn Peterson", stat: "19.9 PPG / 39% 3PT" }],
    playStyle: ["perimeter-shooting", "program-prestige", "experienced"],
    strengthOfSchedule: 9.0, recentForm: "average", conferenceFinish: "Big 12",
    upsetAlert: true, sleeper: false,
    analysis: "Darryn Peterson is a volume scorer who can take over games, but Kansas's 12 losses expose inconsistency against elite defenses. Their 3PT-heavy offense can go cold. Program pedigree helps but this squad has a realistic Elite Eight ceiling."
  },
  {
    id: "st-johns", name: "St. John's Red Storm", shortName: "St. John's",
    seed: 5, region: "East", record: "28-6", wins: 28, losses: 6,
    championshipOdds: 6000, ppg: 79.2, oppPpg: 68.1, scoringMargin: 11.1,
    fg2Pct: 53.4, fg3Pct: 35.2, ftPct: 74.6, threePointRate: 32,
    adjOffRating: 114.9, adjDefRating: 96.3, adjEffMargin: 18.6, pace: 69.8,
    orebRate: 31, drebRate: 73, turnoversForced: 16.8, turnoverRate: 12.5,
    keyPlayers: [{ name: "Zuby Ejiofor", stat: "16.0 PPG / 7.1 RPG" }],
    playStyle: ["ball-control", "physicality", "big-east-battle-tested"],
    strengthOfSchedule: 8.6, recentForm: "hot", conferenceFinish: "Big East 2nd",
    upsetAlert: false, sleeper: true,
    analysis: "Nation's 12th-lowest turnover rate signals elite composure. Ejiofor is a matchup nightmare — physical, skilled, and efficient. Tested in the Big East gauntlet all year. Could be the team that makes a deep run from the East."
  },
  {
    id: "louisville", name: "Louisville Cardinals", shortName: "Louisville",
    seed: 6, region: "East", record: "23-10", wins: 23, losses: 10,
    championshipOdds: 11000, ppg: 77.4, oppPpg: 70.2, scoringMargin: 7.2,
    fg2Pct: 60.8, fg3Pct: 32.1, ftPct: 68.9, threePointRate: 28,
    adjOffRating: 118.8, adjDefRating: 94.1, adjEffMargin: 24.7, pace: 71.2,
    orebRate: 33, drebRate: 70, turnoversForced: 18.1, turnoverRate: 17.4,
    keyPlayers: [{ name: "Ryan Conwell", stat: "18.7 PPG" }],
    playStyle: ["paint-heavy", "athletic", "transition"],
    strengthOfSchedule: 8.4, recentForm: "average", conferenceFinish: "ACC",
    upsetAlert: false, sleeper: false,
    analysis: "61% of their shots come inside the arc — one of the most paint-dominant teams in the field. Ryan Conwell can carry them. KenPom loves their efficiency (24.7 margin) which is better than their seed suggests. Could surprise in the Sweet 16."
  },
  {
    id: "ucla", name: "UCLA Bruins", shortName: "UCLA",
    seed: 7, region: "East", record: "23-11", wins: 23, losses: 11,
    championshipOdds: 15000, ppg: 74.8, oppPpg: 69.3, scoringMargin: 5.5,
    fg2Pct: 50.1, fg3Pct: 52.8, ftPct: 70.4, threePointRate: 42,
    adjOffRating: 109.8, adjDefRating: 99.2, adjEffMargin: 10.6, pace: 70.1,
    orebRate: 27, drebRate: 73, turnoversForced: 16.2, turnoverRate: 14.8,
    keyPlayers: [{ name: "Donovan Dent", stat: "15.8 PPG / 53% 3PT (last 7)" }],
    playStyle: ["three-point-barrage", "hot-shooting", "streaky"],
    strengthOfSchedule: 8.3, recentForm: "hot", conferenceFinish: "Big Ten",
    upsetAlert: false, sleeper: true,
    analysis: "Donovan Dent shooting 53% from 3 in his last 7 games is alarming for opponents. 20-13 record is mediocre but a late-season surge makes UCLA dangerous. If their 3PT stays hot, they can beat anyone. Streaky nature cuts both ways."
  },
  {
    id: "ohio-state", name: "Ohio State Buckeyes", shortName: "Ohio St.",
    seed: 8, region: "East", record: "21-12", wins: 21, losses: 12,
    championshipOdds: 25000, ppg: 75.3, oppPpg: 70.1, scoringMargin: 5.2,
    fg2Pct: 62.4, fg3Pct: 44.1, ftPct: 71.8, threePointRate: 34,
    adjOffRating: 109.1, adjDefRating: 100.3, adjEffMargin: 8.8, pace: 68.9,
    orebRate: 30, drebRate: 69, turnoversForced: 17.3, turnoverRate: 15.6,
    keyPlayers: [{ name: "Bruce Thornton", stat: "21.8 PPG (since Feb.)" }],
    playStyle: ["paint-plus-three", "momentum-driven", "physical"],
    strengthOfSchedule: 8.7, recentForm: "hot", conferenceFinish: "Big Ten",
    upsetAlert: false, sleeper: false,
    analysis: "Bruce Thornton has been on a tear — 21.8 PPG since late February with elite efficiency. 62% inside the arc + 44% from three is a rare and dangerous combination. Momentum team that could flip the 8-9 matchup."
  },
  {
    id: "tcu", name: "TCU Horned Frogs", shortName: "TCU",
    seed: 9, region: "East", record: "22-11", wins: 22, losses: 11,
    championshipOdds: 40000, ppg: 71.2, oppPpg: 65.8, scoringMargin: 5.4,
    fg2Pct: 50.3, fg3Pct: 34.8, ftPct: 70.1, threePointRate: 33,
    adjOffRating: 107.4, adjDefRating: 96.8, adjEffMargin: 10.6, pace: 65.2,
    orebRate: 28, drebRate: 74, turnoversForced: 22.1, turnoverRate: 15.2,
    keyPlayers: [{ name: "David Punch", stat: "14.3 PPG / 2.0 BPG" }],
    playStyle: ["defense-first", "turnover-forcing", "half-court"],
    strengthOfSchedule: 8.1, recentForm: "average", conferenceFinish: "Big 12",
    upsetAlert: false, sleeper: false,
    analysis: "Top-25 defense and forcing turnovers on 1/5 of opponents' possessions. David Punch is an interior anchor. They could hold Ohio State in check but lack the offensive firepower for deeper runs."
  },
  {
    id: "ucf", name: "UCF Knights", shortName: "UCF",
    seed: 10, region: "East", record: "21-11", wins: 21, losses: 11,
    championshipOdds: 40000, ppg: 73.4, oppPpg: 68.2, scoringMargin: 5.2,
    fg2Pct: 49.8, fg3Pct: 40.1, ftPct: 71.4, threePointRate: 40,
    adjOffRating: 108.2, adjDefRating: 98.6, adjEffMargin: 9.6, pace: 69.4,
    orebRate: 26, drebRate: 72, turnoversForced: 16.4, turnoverRate: 16.8,
    keyPlayers: [{ name: "Riley Kugel", stat: "14.7 PPG / 40% 3PT" }],
    playStyle: ["three-point-heavy", "fast-paced", "run-and-gun"],
    strengthOfSchedule: 7.8, recentForm: "average", conferenceFinish: "AAC",
    upsetAlert: false, sleeper: false,
    analysis: "Riley Kugel and a 3PT-heavy attack make UCF dangerous in single-elimination. Their strength of schedule is a concern but they have upset upside against UCLA."
  },
  {
    id: "south-florida", name: "South Florida Bulls", shortName: "USF",
    seed: 11, region: "East", record: "25-8", wins: 25, losses: 8,
    championshipOdds: 100000, ppg: 76.1, oppPpg: 68.9, scoringMargin: 7.2,
    fg2Pct: 52.3, fg3Pct: 33.8, ftPct: 72.1, threePointRate: 30,
    adjOffRating: 110.4, adjDefRating: 97.2, adjEffMargin: 13.2, pace: 70.8,
    orebRate: 32, drebRate: 71, turnoversForced: 17.2, turnoverRate: 16.4,
    keyPlayers: [{ name: "Izaiyah Nelson", stat: "15.8 PPG / 9.7 RPG" }],
    playStyle: ["physical", "rebounding", "interior"],
    strengthOfSchedule: 7.4, recentForm: "hot", conferenceFinish: "AAC Champion",
    upsetAlert: false, sleeper: false,
    analysis: "25-8 record with a dominant interior player is more impressive than the seed suggests. AAC schedule limits respect but Izaiyah Nelson's 9.7 RPG makes them one of the best rebounding teams in the field."
  },
  {
    id: "northern-iowa", name: "Northern Iowa Panthers", shortName: "N. Iowa",
    seed: 12, region: "East", record: "23-12", wins: 23, losses: 12,
    championshipOdds: 200000, ppg: 68.4, oppPpg: 63.1, scoringMargin: 5.3,
    fg2Pct: 49.2, fg3Pct: 35.4, ftPct: 72.8, threePointRate: 34,
    adjOffRating: 106.1, adjDefRating: 95.8, adjEffMargin: 10.3, pace: 64.8,
    orebRate: 29, drebRate: 75, turnoversForced: 19.8, turnoverRate: 14.2,
    keyPlayers: [{ name: "Trey Campbell", stat: "17.7 PPG (conf. tourney)" }],
    playStyle: ["grind-it-out", "defense", "slow-pace"],
    strengthOfSchedule: 6.8, recentForm: "hot", conferenceFinish: "MVC Champion",
    upsetAlert: true, sleeper: false,
    analysis: "Top-25 defensive efficiency teams are always dangerous in March. Trey Campbell's tournament explosion adds another layer. Their slow-pace style can suffocate faster teams. Classic 12-5 upset candidate against St. John's."
  },
  {
    id: "cal-baptist", name: "California Baptist Lancers", shortName: "Cal Bap.",
    seed: 13, region: "East", record: "25-8", wins: 25, losses: 8,
    championshipOdds: 200000, ppg: 79.8, oppPpg: 72.4, scoringMargin: 7.4,
    fg2Pct: 53.1, fg3Pct: 36.2, ftPct: 70.9, threePointRate: 36,
    adjOffRating: 111.2, adjDefRating: 100.8, adjEffMargin: 10.4, pace: 72.4,
    orebRate: 31, drebRate: 68, turnoversForced: 16.1, turnoverRate: 17.8,
    keyPlayers: [{ name: "Dominique Daniels Jr.", stat: "23.2 PPG (5th nationally)" }],
    playStyle: ["high-scoring", "one-man-show", "tempo"],
    strengthOfSchedule: 5.8, recentForm: "hot", conferenceFinish: "WAC Champion",
    upsetAlert: true, sleeper: false,
    analysis: "Daniels scored 32 PPG in the WAC tournament. A single high-usage scorer is always a first-round threat. But Kansas's program pedigree should win out over 40 minutes."
  },
  {
    id: "north-dakota-state", name: "North Dakota State Bison", shortName: "NDSU",
    seed: 14, region: "East", record: "27-7", wins: 27, losses: 7,
    championshipOdds: 200000, ppg: 74.2, oppPpg: 67.1, scoringMargin: 7.1,
    fg2Pct: 55.1, fg3Pct: 38.2, ftPct: 73.4, threePointRate: 38,
    adjOffRating: 109.4, adjDefRating: 98.2, adjEffMargin: 11.2, pace: 67.4,
    orebRate: 30, drebRate: 72, turnoversForced: 17.8, turnoverRate: 15.1,
    keyPlayers: [{ name: "Team effort", stat: "55% 2PT / 38% 3PT" }],
    playStyle: ["efficient-offense", "balanced", "shooting"],
    strengthOfSchedule: 5.2, recentForm: "hot", conferenceFinish: "Summit League Champion",
    upsetAlert: false, sleeper: false,
    analysis: "NDSU shoots extremely well (55% on 2s, 38% on 3s) — better efficiency than their seed suggests. Potential first-round upset pick but Louisville's athleticism advantage is too much."
  },
  {
    id: "furman", name: "Furman Paladins", shortName: "Furman",
    seed: 15, region: "East", record: "22-12", wins: 22, losses: 12,
    championshipOdds: 200000, ppg: 81.2, oppPpg: 72.8, scoringMargin: 8.4,
    fg2Pct: 54.8, fg3Pct: 37.1, ftPct: 71.2, threePointRate: 38,
    adjOffRating: 110.8, adjDefRating: 101.4, adjEffMargin: 9.4, pace: 73.8,
    orebRate: 28, drebRate: 70, turnoversForced: 16.4, turnoverRate: 17.2,
    keyPlayers: [{ name: "Alex Wilkins", stat: "18.4 PPG" }, { name: "Cooper Bowser", stat: "14.2 PPG" }],
    playStyle: ["up-tempo", "scoring", "mid-major-scrappy"],
    strengthOfSchedule: 5.0, recentForm: "hot", conferenceFinish: "SoCon Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Furman scored 81+ PPG in their conference tournament run but face Duke's top defensive unit. Duke holds them under 65 comfortably."
  },
  {
    id: "siena", name: "Siena Saints", shortName: "Siena",
    seed: 16, region: "East", record: "23-11", wins: 23, losses: 11,
    championshipOdds: 200000, ppg: 71.4, oppPpg: 67.2, scoringMargin: 4.2,
    fg2Pct: 49.8, fg3Pct: 34.2, ftPct: 70.8, threePointRate: 33,
    adjOffRating: 105.8, adjDefRating: 99.4, adjEffMargin: 6.4, pace: 66.2,
    orebRate: 26, drebRate: 72, turnoversForced: 17.1, turnoverRate: 16.8,
    keyPlayers: [{ name: "Gavin Doty", stat: "17.9 PPG / 7.0 RPG" }],
    playStyle: ["experienced", "guard-driven", "disciplined"],
    strengthOfSchedule: 5.4, recentForm: "average", conferenceFinish: "MAAC Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Classic 16-seed profile. Gavin Doty is a capable scorer but Duke's talent differential is enormous. A 16-over-1 upset is historically rare and this Duke team is too deep."
  },

  // ─── WEST REGION ─────────────────────────────────────────────────────────
  {
    id: "arizona", name: "Arizona Wildcats", shortName: "Arizona",
    seed: 1, region: "West", record: "32-2", wins: 32, losses: 2,
    championshipOdds: 390, ppg: 83.1, oppPpg: 65.9, scoringMargin: 17.2,
    fg2Pct: 54.8, fg3Pct: 37.4, ftPct: 73.2, threePointRate: 34,
    adjOffRating: 121.4, adjDefRating: 91.2, adjEffMargin: 30.2, pace: 71.4,
    orebRate: 31, drebRate: 75, turnoversForced: 19.1, turnoverRate: 13.8,
    keyPlayers: [{ name: "Caleb Love", stat: "18.2 PPG / 37% 3PT" }, { name: "KJ Lewis", stat: "15.8 PPG / elite defender" }],
    playStyle: ["balanced-attack", "elite-defense", "versatile", "transition"],
    strengthOfSchedule: 9.0, recentForm: "hot", conferenceFinish: "Big 12 Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Arizona at 32-2 is a juggernaut. Caleb Love provides veteran scoring and KJ Lewis is an elite two-way wing. Big 12 tournament champions with the 3rd-best efficiency margin in the country (30.2). Their defensive rating (91.2) makes them suffocating. Clear West Region favorite."
  },
  {
    id: "purdue", name: "Purdue Boilermakers", shortName: "Purdue",
    seed: 2, region: "West", record: "27-8", wins: 27, losses: 8,
    championshipOdds: 2500, ppg: 79.8, oppPpg: 66.2, scoringMargin: 13.6,
    fg2Pct: 51.4, fg3Pct: 39.2, ftPct: 74.8, threePointRate: 39,
    adjOffRating: 124.2, adjDefRating: 95.4, adjEffMargin: 28.8, pace: 68.2,
    orebRate: 27, drebRate: 75, turnoversForced: 18.4, turnoverRate: 12.8,
    keyPlayers: [{ name: "Braden Smith", stat: "14.9 PPG / 8.7 APG" }, { name: "Trey Kaufman-Renn", stat: "17.2 PPG / 7.4 RPG" }],
    playStyle: ["top-2-offense", "three-point-barrage", "pass-first", "efficient"],
    strengthOfSchedule: 8.9, recentForm: "hot", conferenceFinish: "Big Ten 2nd",
    upsetAlert: false, sleeper: false,
    analysis: "Purdue has the #2 offense in America (124.2 adj. offensive rating). Braden Smith is one of the best point guards in the country and Kaufman-Renn provides interior scoring. 39% team 3PT rate is sustainable. Their only weakness is defense (95.4) — Gonzaga's bigs could exploit that."
  },
  {
    id: "gonzaga", name: "Gonzaga Bulldogs", shortName: "Gonzaga",
    seed: 3, region: "West", record: "30-3", wins: 30, losses: 3,
    championshipOdds: 4000, ppg: 84.2, oppPpg: 67.4, scoringMargin: 16.8,
    fg2Pct: 58.2, fg3Pct: 36.4, ftPct: 75.6, threePointRate: 33,
    adjOffRating: 116.2, adjDefRating: 92.1, adjEffMargin: 24.1, pace: 72.1,
    orebRate: 34, drebRate: 73, turnoversForced: 17.8, turnoverRate: 14.4,
    keyPlayers: [{ name: "Ryan Nembhard", stat: "16.4 PPG / 7.8 APG" }, { name: "Graham Ike", stat: "19.7 PPG / 61% inside arc" }],
    playStyle: ["dominant-interior", "high-scoring", "two-bigs", "paint-first"],
    strengthOfSchedule: 8.4, recentForm: "hot", conferenceFinish: "WCC Champion",
    upsetAlert: false, sleeper: false,
    analysis: "30-4 with a top-9 defense nationally and two elite bigs in Graham Ike and Braden Huff. Nembhard orchestrates a devastating interior offense. 61% inside-the-arc for Ike is elite efficiency. Their WCC schedule is a concern but Gonzaga is a Final Four threat."
  },
  {
    id: "arkansas", name: "Arkansas Razorbacks", shortName: "Arkansas",
    seed: 4, region: "West", record: "26-8", wins: 26, losses: 8,
    championshipOdds: 6000, ppg: 80.4, oppPpg: 70.1, scoringMargin: 10.3,
    fg2Pct: 52.1, fg3Pct: 44.2, ftPct: 72.4, threePointRate: 38,
    adjOffRating: 122.4, adjDefRating: 96.2, adjEffMargin: 26.2, pace: 73.2,
    orebRate: 30, drebRate: 70, turnoversForced: 18.9, turnoverRate: 16.1,
    keyPlayers: [{ name: "Darius Acuff Jr.", stat: "22.2 PPG / 6.4 APG / 44% 3PT" }],
    playStyle: ["fast-pace", "high-volume-3s", "superstar-driven", "SEC-battle-tested"],
    strengthOfSchedule: 9.1, recentForm: "hot", conferenceFinish: "SEC Champion",
    upsetAlert: false, sleeper: true,
    analysis: "Darius Acuff Jr. is playing at an MVP level — 22.2/6.4 on 44% 3PT is historic. Arkansas is HOT entering the tournament, winning 3 games in 5 days to take the SEC title. The offense (122.4 rating) is elite but the defense (96.2) is a liability. Biggest sleeper in the West."
  },
  {
    id: "wisconsin", name: "Wisconsin Badgers", shortName: "Wisconsin",
    seed: 5, region: "West", record: "24-10", wins: 24, losses: 10,
    championshipOdds: 8000, ppg: 73.8, oppPpg: 65.4, scoringMargin: 8.4,
    fg2Pct: 51.2, fg3Pct: 36.8, ftPct: 76.2, threePointRate: 35,
    adjOffRating: 112.4, adjDefRating: 95.8, adjEffMargin: 16.6, pace: 65.4,
    orebRate: 27, drebRate: 76, turnoversForced: 17.4, turnoverRate: 13.4,
    keyPlayers: [{ name: "John Blackwell", stat: "18.3 PPG" }, { name: "Nolan Winter", stat: "13.3 PPG / 8.6 RPG" }],
    playStyle: ["methodical", "defense-first", "slow-grind", "efficient"],
    strengthOfSchedule: 8.8, recentForm: "average", conferenceFinish: "Big Ten",
    upsetAlert: false, sleeper: false,
    analysis: "Wisconsin's methodical style and strong defense gives them a chance to frustrate Arkansas. Their FT shooting (76.2%) is elite for late-game situations. Nolan Winter's rebounding counters Arkansas's transition game. Sweet 16 ceiling."
  },
  {
    id: "byu", name: "BYU Cougars", shortName: "BYU",
    seed: 6, region: "West", record: "23-11", wins: 23, losses: 11,
    championshipOdds: 25000, ppg: 78.4, oppPpg: 70.2, scoringMargin: 8.2,
    fg2Pct: 50.8, fg3Pct: 36.4, ftPct: 71.8, threePointRate: 38,
    adjOffRating: 111.8, adjDefRating: 98.6, adjEffMargin: 13.2, pace: 70.4,
    orebRate: 28, drebRate: 71, turnoversForced: 16.8, turnoverRate: 17.2,
    keyPlayers: [{ name: "AJ Dybantsa", stat: "Nation's top freshman / 28+ PPG in 7 games" }, { name: "Robert Wright III", stat: "22.4 PPG (final 8)" }],
    playStyle: ["superstar-driven", "perimeter-first", "high-usage-star"],
    strengthOfSchedule: 8.6, recentForm: "average", conferenceFinish: "Big 12",
    upsetAlert: true, sleeper: true,
    analysis: "AJ Dybantsa is arguably the best player in college basketball — potential #1 NBA pick. When he's locked in, BYU beats anyone. Two-scorer dynamic with Wright creates real problems. Upset alert in the 6-11 matchup but BYU is the real sleeper here."
  },
  {
    id: "miami-fl", name: "Miami Hurricanes", shortName: "Miami",
    seed: 7, region: "West", record: "25-8", wins: 25, losses: 8,
    championshipOdds: 40000, ppg: 77.2, oppPpg: 67.8, scoringMargin: 9.4,
    fg2Pct: 59.1, fg3Pct: 33.4, ftPct: 73.2, threePointRate: 29,
    adjOffRating: 113.4, adjDefRating: 95.6, adjEffMargin: 17.8, pace: 70.8,
    orebRate: 33, drebRate: 73, turnoversForced: 18.4, turnoverRate: 14.8,
    keyPlayers: [{ name: "Malik Reneau", stat: "19.2 PPG / 6.6 RPG / 59% inside arc" }],
    playStyle: ["paint-dominant", "physical", "two-way", "ACC-tested"],
    strengthOfSchedule: 8.6, recentForm: "hot", conferenceFinish: "ACC 3rd",
    upsetAlert: false, sleeper: false,
    analysis: "Top-5 offensive AND defensive efficiency in the ACC makes Miami a well-rounded unit. Reneau is a physical force inside. Their paint-heavy approach could struggle against Gonzaga's twin-tower lineup. Missouri matchup is winnable."
  },
  {
    id: "villanova", name: "Villanova Wildcats", shortName: "Villanova",
    seed: 8, region: "West", record: "24-8", wins: 24, losses: 8,
    championshipOdds: 25000, ppg: 72.8, oppPpg: 65.4, scoringMargin: 7.4,
    fg2Pct: 50.4, fg3Pct: 36.8, ftPct: 74.1, threePointRate: 38,
    adjOffRating: 110.8, adjDefRating: 95.2, adjEffMargin: 15.6, pace: 66.8,
    orebRate: 29, drebRate: 76, turnoversForced: 18.2, turnoverRate: 13.8,
    keyPlayers: [{ name: "Duke Brennan", stat: "12.4 PPG / 10.3 RPG / 14 dbl-dbl" }],
    playStyle: ["big-east-pedigree", "half-court", "rebounding", "battle-tested"],
    strengthOfSchedule: 8.4, recentForm: "average", conferenceFinish: "Big East 3rd",
    upsetAlert: false, sleeper: false,
    analysis: "Three-time champion DNA runs deep at Villanova. Duke Brennan's 14 double-doubles anchor their front court. Top-4 efficiency on both ends of the Big East. Utah State in R1 is dangerous but Villanova has been here before."
  },
  {
    id: "utah-state", name: "Utah State Aggies", shortName: "Utah St.",
    seed: 9, region: "West", record: "28-6", wins: 28, losses: 6,
    championshipOdds: 40000, ppg: 76.8, oppPpg: 67.2, scoringMargin: 9.6,
    fg2Pct: 51.8, fg3Pct: 42.1, ftPct: 73.8, threePointRate: 40,
    adjOffRating: 113.2, adjDefRating: 96.4, adjEffMargin: 16.8, pace: 70.2,
    orebRate: 29, drebRate: 73, turnoversForced: 18.8, turnoverRate: 14.1,
    keyPlayers: [{ name: "Mason Falslev", stat: "16.1 PPG / 42% 3PT / 2.0 SPG" }, { name: "MJ Collins Jr.", stat: "14 games 20+ PPG" }],
    playStyle: ["three-point-shooting", "versatile", "defensive", "mountain-west"],
    strengthOfSchedule: 7.8, recentForm: "hot", conferenceFinish: "Mountain West Champion",
    upsetAlert: false, sleeper: true,
    analysis: "28-6 record, 42% from 3PT, elite two-way play from Falslev — Utah State is the most underseeded team in the West. They match up well with Villanova and could be the 9-seed to flip the bracket. Real Sweet 16 candidate."
  },
  {
    id: "missouri", name: "Missouri Tigers", shortName: "Missouri",
    seed: 10, region: "West", record: "20-12", wins: 20, losses: 12,
    championshipOdds: 50000, ppg: 74.1, oppPpg: 70.8, scoringMargin: 3.3,
    fg2Pct: 50.2, fg3Pct: 35.8, ftPct: 71.2, threePointRate: 36,
    adjOffRating: 108.4, adjDefRating: 99.6, adjEffMargin: 8.8, pace: 69.8,
    orebRate: 27, drebRate: 70, turnoversForced: 16.8, turnoverRate: 17.8,
    keyPlayers: [{ name: "Mark Mitchell", stat: "17.9 PPG / 5.2 RPG" }],
    playStyle: ["inconsistent", "scoring-dependent", "SEC-tested"],
    strengthOfSchedule: 8.8, recentForm: "cold", conferenceFinish: "SEC (3-game losing streak)",
    upsetAlert: true, sleeper: false,
    analysis: "20-12 record and entering on a 3-game losing streak is alarming. Mark Mitchell is talented but Missouri relies too heavily on him. SEC schedule adds credibility but their form is a massive red flag. Miami should handle them."
  },
  {
    id: "texas", name: "Texas Longhorns", shortName: "Texas",
    seed: 11, region: "West", record: "18-14", wins: 18, losses: 14,
    championshipOdds: 50000, ppg: 75.8, oppPpg: 70.4, scoringMargin: 5.4,
    fg2Pct: 52.4, fg3Pct: 35.2, ftPct: 70.8, threePointRate: 34,
    adjOffRating: 111.8, adjDefRating: 98.4, adjEffMargin: 13.4, pace: 71.2,
    orebRate: 30, drebRate: 71, turnoversForced: 17.4, turnoverRate: 16.4,
    keyPlayers: [{ name: "Dailyn Swain", stat: "17.8 PPG / 7.6 RPG" }],
    playStyle: ["big-12-battle-tested", "physical", "interior-focused"],
    strengthOfSchedule: 9.0, recentForm: "average", conferenceFinish: "Big 12 (First Four)",
    upsetAlert: false, sleeper: false,
    analysis: "First Four team. 18-14 is a below-average record but 16th adjusted offensive efficiency tells a different story. Big 12 schedule is brutal. Swain is a matchup problem. Must beat NC State in the play-in first."
  },
  {
    id: "nc-state", name: "NC State Wolfpack", shortName: "NC State",
    seed: 11, region: "West", record: "20-13", wins: 20, losses: 13,
    championshipOdds: 30000, ppg: 74.2, oppPpg: 69.8, scoringMargin: 4.4,
    fg2Pct: 51.2, fg3Pct: 36.8, ftPct: 71.4, threePointRate: 36,
    adjOffRating: 110.4, adjDefRating: 98.8, adjEffMargin: 11.6, pace: 70.4,
    orebRate: 29, drebRate: 72, turnoversForced: 17.8, turnoverRate: 15.8,
    keyPlayers: [{ name: "Dennis Parker Jr.", stat: "16.4 PPG" }],
    playStyle: ["ACC-tested", "guard-driven", "tournament-experience"],
    strengthOfSchedule: 8.6, recentForm: "average", conferenceFinish: "ACC (First Four)",
    upsetAlert: false, sleeper: false,
    analysis: "First Four team. NC State has the ACC tournament Cinderella pedigree from 2024. Parker Jr. can carry them but 19-14 is hard to overcome. Must beat Texas in the play-in to even reach the bracket."
  },
  {
    id: "high-point", name: "High Point Panthers", shortName: "High Point",
    seed: 12, region: "West", record: "30-4", wins: 30, losses: 4,
    championshipOdds: 200000, ppg: 78.4, oppPpg: 68.2, scoringMargin: 10.2,
    fg2Pct: 52.8, fg3Pct: 35.4, ftPct: 72.4, threePointRate: 35,
    adjOffRating: 110.2, adjDefRating: 97.4, adjEffMargin: 12.8, pace: 70.4,
    orebRate: 30, drebRate: 72, turnoversForced: 22.4, turnoverRate: 14.2,
    keyPlayers: [{ name: "Terry Anderson", stat: "16.0 PPG" }, { name: "Rob Martin", stat: "15.3 PPG" }],
    playStyle: ["turnover-machine-defense", "efficient", "two-scorer"],
    strengthOfSchedule: 5.6, recentForm: "hot", conferenceFinish: "Big South Champion",
    upsetAlert: true, sleeper: false,
    analysis: "30-4 record and top-5 turnover forcing is no joke. Their two-scorer attack limits single-player coverage. BYU at 6 is the upset pick — Dybantsa may be too much but don't sleep on High Point."
  },
  {
    id: "hawaii", name: "Hawai'i Rainbow Warriors", shortName: "Hawai'i",
    seed: 13, region: "West", record: "24-8", wins: 24, losses: 8,
    championshipOdds: 200000, ppg: 74.8, oppPpg: 66.4, scoringMargin: 8.4,
    fg2Pct: 65.2, fg3Pct: 32.8, ftPct: 71.8, threePointRate: 28,
    adjOffRating: 110.8, adjDefRating: 96.2, adjEffMargin: 14.6, pace: 68.4,
    orebRate: 33, drebRate: 73, turnoversForced: 18.2, turnoverRate: 15.4,
    keyPlayers: [{ name: "Isaac Johnson", stat: "14.1 PPG / 65% inside arc" }],
    playStyle: ["dominant-interior", "rim-finishing", "paint-first"],
    strengthOfSchedule: 6.2, recentForm: "hot", conferenceFinish: "Big West Champion",
    upsetAlert: true, sleeper: false,
    analysis: "65% inside the arc for Johnson is the highest in the field. Top-50 defense. They have a legitimate upset case against Arkansas — momentum + interior dominance vs. a guard-heavy team. The 4-13 matchup to watch."
  },
  {
    id: "kennesaw-state", name: "Kennesaw State Owls", shortName: "KSU",
    seed: 14, region: "West", record: "21-13", wins: 21, losses: 13,
    championshipOdds: 200000, ppg: 70.8, oppPpg: 66.4, scoringMargin: 4.4,
    fg2Pct: 50.1, fg3Pct: 33.8, ftPct: 70.2, threePointRate: 33,
    adjOffRating: 105.4, adjDefRating: 98.8, adjEffMargin: 6.6, pace: 66.4,
    orebRate: 26, drebRate: 71, turnoversForced: 16.8, turnoverRate: 16.8,
    keyPlayers: [{ name: "Amir Taylor", stat: "17.0 PPG (conf. tourney)" }],
    playStyle: ["tournament-hot", "small-school-grit"],
    strengthOfSchedule: 5.0, recentForm: "hot", conferenceFinish: "ASun Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Tournament hot but conference too weak. Gonzaga's offense will overwhelm their defense."
  },
  {
    id: "queens", name: "Queens University Royals", shortName: "Queens",
    seed: 15, region: "West", record: "21-13", wins: 21, losses: 13,
    championshipOdds: 200000, ppg: 78.2, oppPpg: 71.4, scoringMargin: 6.8,
    fg2Pct: 60.4, fg3Pct: 38.2, ftPct: 71.4, threePointRate: 36,
    adjOffRating: 110.4, adjDefRating: 100.8, adjEffMargin: 9.6, pace: 72.8,
    orebRate: 30, drebRate: 69, turnoversForced: 16.4, turnoverRate: 18.2,
    keyPlayers: [{ name: "Chris Ashby", stat: "34 pts in title game" }],
    playStyle: ["high-scoring", "balanced", "mid-major-upstart"],
    strengthOfSchedule: 4.8, recentForm: "hot", conferenceFinish: "SAC Champion",
    upsetAlert: false, sleeper: false,
    analysis: "60% inside the arc and 38% from 3 is a potent offensive mix. Ashby is dangerous but Purdue's elite offense will overwhelm them."
  },
  {
    id: "liu", name: "Long Island University Sharks", shortName: "LIU",
    seed: 16, region: "West", record: "24-10", wins: 24, losses: 10,
    championshipOdds: 200000, ppg: 71.2, oppPpg: 66.8, scoringMargin: 4.4,
    fg2Pct: 50.2, fg3Pct: 34.8, ftPct: 70.4, threePointRate: 34,
    adjOffRating: 105.2, adjDefRating: 99.8, adjEffMargin: 5.4, pace: 67.2,
    orebRate: 26, drebRate: 71, turnoversForced: 16.8, turnoverRate: 17.2,
    keyPlayers: [{ name: "Davis/Gordon/Fuller", stat: "58 pts combined in NEC title" }],
    playStyle: ["balanced-scoring", "small-school"],
    strengthOfSchedule: 4.4, recentForm: "hot", conferenceFinish: "NEC Champion",
    upsetAlert: false, sleeper: false,
    analysis: "16-seed with balanced scoring but Arizona is a different level of competition entirely."
  },

  // ─── MIDWEST REGION ──────────────────────────────────────────────────────
  {
    id: "michigan", name: "Michigan Wolverines", shortName: "Michigan",
    seed: 1, region: "Midwest", record: "31-3", wins: 31, losses: 3,
    championshipOdds: 360, ppg: 82.8, oppPpg: 64.1, scoringMargin: 18.7,
    fg2Pct: 59.4, fg3Pct: 37.2, ftPct: 73.8, threePointRate: 33,
    adjOffRating: 122.1, adjDefRating: 90.8, adjEffMargin: 31.3, pace: 70.8,
    orebRate: 33, drebRate: 77, turnoversForced: 18.8, turnoverRate: 13.1,
    keyPlayers: [{ name: "Nimari Burnett", stat: "17.8 PPG / elite two-way" }, { name: "Danny Wolf", stat: "14.3 PPG / 7.3 RPG / 1.4 BPG" }],
    playStyle: ["top-5-two-way", "paint-dominant", "elite-defense", "big-ten-tested"],
    strengthOfSchedule: 9.4, recentForm: "hot", conferenceFinish: "Big Ten Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Michigan has the 2nd-best efficiency margin in the country (31.3). 59% on 2s, 37% on 3s, and top-5 on both ends. Burnett and Wolf anchor a pro-ready roster. Big Ten champions and a legitimate title contender. Pre-tournament co-favorite with Duke."
  },
  {
    id: "iowa-state", name: "Iowa State Cyclones", shortName: "Iowa St.",
    seed: 2, region: "Midwest", record: "27-7", wins: 27, losses: 7,
    championshipOdds: 1500, ppg: 78.4, oppPpg: 65.8, scoringMargin: 12.6,
    fg2Pct: 51.8, fg3Pct: 50.2, ftPct: 74.2, threePointRate: 41,
    adjOffRating: 117.4, adjDefRating: 91.6, adjEffMargin: 25.8, pace: 69.4,
    orebRate: 28, drebRate: 74, turnoversForced: 19.2, turnoverRate: 13.8,
    keyPlayers: [{ name: "Tamin Lipsey", stat: "14.8 PPG / 6.2 APG / elite defender" }, { name: "Milan Momcilovic", stat: "17.0 PPG / 50% 3PT" }],
    playStyle: ["three-point-barrage", "two-way", "star-powered", "big-12-hardened"],
    strengthOfSchedule: 8.9, recentForm: "hot", conferenceFinish: "Big 12 2nd",
    upsetAlert: false, sleeper: false,
    analysis: "Milan Momcilovic shooting 50% from 3 is historically elite. Lipsey is a lockdown defender who also runs the offense. Top-5 defense (91.6) makes them a complete team. The path to the Final Four from the Midwest goes through Iowa State."
  },
  {
    id: "virginia", name: "Virginia Cavaliers", shortName: "Virginia",
    seed: 3, region: "Midwest", record: "29-5", wins: 29, losses: 5,
    championshipOdds: 7500, ppg: 72.4, oppPpg: 60.8, scoringMargin: 11.6,
    fg2Pct: 50.8, fg3Pct: 46.8, ftPct: 76.4, threePointRate: 47,
    adjOffRating: 116.4, adjDefRating: 93.0, adjEffMargin: 23.4, pace: 61.2,
    orebRate: 27, drebRate: 78, turnoversForced: 20.2, turnoverRate: 11.8,
    keyPlayers: [{ name: "Deep Roster", stat: "7 players ≥8.3 PPG" }],
    playStyle: ["pack-line-defense", "slowest-pace", "3PT-heavy", "no-turnover"],
    strengthOfSchedule: 8.8, recentForm: "average", conferenceFinish: "ACC",
    upsetAlert: false, sleeper: true,
    analysis: "Virginia's pack-line defense and slowest tempo in the field (61.2 pace) makes them a nightmare for higher-seeded teams. 11.8% turnover rate is the most careful offense in the tournament. 46.8% from 3 is scorching. Under-the-radar Final Four sleeper."
  },
  {
    id: "alabama", name: "Alabama Crimson Tide", shortName: "Alabama",
    seed: 4, region: "Midwest", record: "23-9", wins: 23, losses: 9,
    championshipOdds: 18000, ppg: 91.7, oppPpg: 76.2, scoringMargin: 15.5,
    fg2Pct: 53.4, fg3Pct: 38.4, ftPct: 70.8, threePointRate: 42,
    adjOffRating: 119.4, adjDefRating: 99.8, adjEffMargin: 19.6, pace: 76.8,
    orebRate: 34, drebRate: 69, turnoversForced: 19.4, turnoverRate: 17.8,
    keyPlayers: [{ name: "Labaron Philon Jr.", stat: "21.5 PPG / 39% 3PT" }, { name: "Aden Holloway", stat: "16.8 PPG" }],
    playStyle: ["highest-scoring", "fastest-pace", "offensive-explosion", "high-variance"],
    strengthOfSchedule: 9.2, recentForm: "hot", conferenceFinish: "SEC",
    upsetAlert: true, sleeper: false,
    analysis: "91.7 PPG — tops in the nation. 4th fastest pace. Alabama can score on anyone but their defense (99.8 adj. def) is exploitable in the tournament. 22-11 with high-variance — either wins by 20 or loses a shootout. Classic upset candidate in the 4-13 range."
  },
  {
    id: "texas-tech", name: "Texas Tech Red Raiders", shortName: "Texas Tech",
    seed: 5, region: "Midwest", record: "22-10", wins: 22, losses: 10,
    championshipOdds: 13000, ppg: 79.4, oppPpg: 68.4, scoringMargin: 11.0,
    fg2Pct: 52.4, fg3Pct: 40.1, ftPct: 72.4, threePointRate: 40,
    adjOffRating: 114.8, adjDefRating: 96.4, adjEffMargin: 18.4, pace: 70.8,
    orebRate: 30, drebRate: 72, turnoversForced: 18.4, turnoverRate: 14.8,
    keyPlayers: [{ name: "JT Toppin", stat: "21.8 PPG / 10.8 RPG / 1.7 BPG" }, { name: "Christian Anderson", stat: "19.2 PPG / 7.8 APG" }],
    playStyle: ["two-star-system", "balanced", "three-point-barrage", "big-12-physical"],
    strengthOfSchedule: 9.1, recentForm: "hot", conferenceFinish: "Big 12",
    upsetAlert: false, sleeper: true,
    analysis: "The Toppin-Anderson combo is arguably the best two-star system in the field. Toppin's 10.8 RPG with 40% 3PT shooting is an elite combo. 40% team 3PT is top-10 nationally. Virginia in R2 would be their biggest challenge but Texas Tech can win the region."
  },
  {
    id: "tennessee", name: "Tennessee Volunteers", shortName: "Tennessee",
    seed: 6, region: "Midwest", record: "22-11", wins: 22, losses: 11,
    championshipOdds: 12000, ppg: 77.8, oppPpg: 65.4, scoringMargin: 12.4,
    fg2Pct: 52.8, fg3Pct: 35.8, ftPct: 73.2, threePointRate: 34,
    adjOffRating: 115.8, adjDefRating: 92.8, adjEffMargin: 23.0, pace: 68.4,
    orebRate: 35, drebRate: 74, turnoversForced: 19.8, turnoverRate: 14.8,
    keyPlayers: [{ name: "Nate Ament", stat: "22.4 PPG (10-game stretch)" }, { name: "Ja'Kobi Gillespie", stat: "18.0 PPG / 5.6 APG" }],
    playStyle: ["rebounding-machine", "defense-elite", "two-guard-attack"],
    strengthOfSchedule: 9.1, recentForm: "average", conferenceFinish: "SEC",
    upsetAlert: false, sleeper: false,
    analysis: "2nd-best defensive efficiency in the SEC (92.8). Top offensive rebounding nationally. Ament + Gillespie is a dangerous backcourt but 22-11 suggests inconsistency. Kentucky in R1 is dangerous. Ceiling is Elite Eight."
  },
  {
    id: "kentucky", name: "Kentucky Wildcats", shortName: "Kentucky",
    seed: 7, region: "Midwest", record: "21-13", wins: 21, losses: 13,
    championshipOdds: 20000, ppg: 74.8, oppPpg: 69.4, scoringMargin: 5.4,
    fg2Pct: 51.2, fg3Pct: 35.8, ftPct: 71.8, threePointRate: 35,
    adjOffRating: 109.8, adjDefRating: 98.2, adjEffMargin: 11.6, pace: 70.2,
    orebRate: 30, drebRate: 71, turnoversForced: 17.8, turnoverRate: 16.8,
    keyPlayers: [{ name: "Otega Oweh", stat: "Versatile wing" }],
    playStyle: ["program-prestige", "well-coached", "blue-blood"],
    strengthOfSchedule: 9.0, recentForm: "average", conferenceFinish: "SEC",
    upsetAlert: false, sleeper: false,
    analysis: "22-11 is below Kentucky standards. Oweh is their best player but they lack a true superstar. SEC schedule adds credibility. Tennessee matchup is winnable and this is a spoiler-type team for the first two rounds."
  },
  {
    id: "georgia", name: "Georgia Bulldogs", shortName: "Georgia",
    seed: 8, region: "Midwest", record: "22-10", wins: 22, losses: 10,
    championshipOdds: 50000, ppg: 76.8, oppPpg: 67.4, scoringMargin: 9.4,
    fg2Pct: 52.1, fg3Pct: 45.2, ftPct: 72.4, threePointRate: 40,
    adjOffRating: 112.8, adjDefRating: 96.2, adjEffMargin: 16.6, pace: 70.4,
    orebRate: 29, drebRate: 73, turnoversForced: 17.8, turnoverRate: 15.4,
    keyPlayers: [{ name: "Jeremiah Wilkinson", stat: "+122 pts/100 possessions" }, { name: "Blue Cain", stat: "45% 3PT since Feb." }],
    playStyle: ["three-point-barrage", "hot-shooting", "versatile"],
    strengthOfSchedule: 8.8, recentForm: "hot", conferenceFinish: "SEC",
    upsetAlert: false, sleeper: true,
    analysis: "Georgia has one of the most shocking metrics in the field — Wilkinson's +122 points/100 possessions is elite. Cain shooting 45% from 3 since February is scorching. Top-15 offense nationally. Could be the 8-seed to upset Michigan if they get hot."
  },
  {
    id: "saint-louis", name: "Saint Louis Billikens", shortName: "St. Louis",
    seed: 9, region: "Midwest", record: "28-5", wins: 28, losses: 5,
    championshipOdds: 40000, ppg: 76.4, oppPpg: 67.2, scoringMargin: 9.2,
    fg2Pct: 58.8, fg3Pct: 40.1, ftPct: 73.2, threePointRate: 36,
    adjOffRating: 112.4, adjDefRating: 96.8, adjEffMargin: 15.6, pace: 68.4,
    orebRate: 31, drebRate: 73, turnoversForced: 18.2, turnoverRate: 13.8,
    keyPlayers: [{ name: "Robbie Avila", stat: "12.9 PPG / 4.1 APG / 43% 3PT" }],
    playStyle: ["balanced-five-scorers", "efficient", "shooting"],
    strengthOfSchedule: 7.4, recentForm: "hot", conferenceFinish: "A-10 Champion",
    upsetAlert: false, sleeper: false,
    analysis: "28-5 is exceptional for an A-10 team. 5 players in double figures and Avila as a pass-first big who hits 43% from 3 is a nightmare. They match up well with Georgia — this is a pick'em R1 game."
  },
  {
    id: "santa-clara", name: "Santa Clara Broncos", shortName: "Santa Clara",
    seed: 10, region: "Midwest", record: "26-8", wins: 26, losses: 8,
    championshipOdds: 50000, ppg: 72.8, oppPpg: 65.4, scoringMargin: 7.4,
    fg2Pct: 62.1, fg3Pct: 41.2, ftPct: 72.8, threePointRate: 34,
    adjOffRating: 109.4, adjDefRating: 96.8, adjEffMargin: 12.6, pace: 67.8,
    orebRate: 28, drebRate: 74, turnoversForced: 17.4, turnoverRate: 14.2,
    keyPlayers: [{ name: "Allen Graves", stat: "62% around rim / 41% 3PT" }],
    playStyle: ["efficient-interior", "high-efficiency", "balanced"],
    strengthOfSchedule: 7.2, recentForm: "hot", conferenceFinish: "WCC",
    upsetAlert: false, sleeper: false,
    analysis: "Graves shooting 62% around the rim and 41% from 3 is elite two-level scoring. But Kentucky's defense should contain them in R1."
  },
  {
    id: "miami-oh", name: "Miami (Ohio) RedHawks", shortName: "Miami OH",
    seed: 11, region: "Midwest", record: "31-1", wins: 31, losses: 1,
    championshipOdds: 150000, ppg: 77.4, oppPpg: 63.8, scoringMargin: 13.6,
    fg2Pct: 61.8, fg3Pct: 38.2, ftPct: 74.2, threePointRate: 38,
    adjOffRating: 113.8, adjDefRating: 93.4, adjEffMargin: 20.4, pace: 71.4,
    orebRate: 32, drebRate: 75, turnoversForced: 18.8, turnoverRate: 13.4,
    keyPlayers: [{ name: "Pete Suder", stat: "14.8 PPG / 42% 3PT" }],
    playStyle: ["elite-efficiency", "dominant-mid-major", "two-way"],
    strengthOfSchedule: 6.0, recentForm: "hot", conferenceFinish: "MAC Champion (First Four)",
    upsetAlert: true, sleeper: true,
    analysis: "First Four team. 31-1 record and a 20.4 efficiency margin rivals any power conference team. They're the best mid-major in the field. 62% inside the arc + 38% from 3 + top defense = massive upset potential. Must beat SMU first."
  },
  {
    id: "smu", name: "SMU Mustangs", shortName: "SMU",
    seed: 11, region: "Midwest", record: "20-13", wins: 20, losses: 13,
    championshipOdds: 50000, ppg: 76.8, oppPpg: 70.4, scoringMargin: 6.4,
    fg2Pct: 51.4, fg3Pct: 41.2, ftPct: 71.8, threePointRate: 40,
    adjOffRating: 111.4, adjDefRating: 98.2, adjEffMargin: 13.2, pace: 71.4,
    orebRate: 28, drebRate: 71, turnoversForced: 17.4, turnoverRate: 15.8,
    keyPlayers: [{ name: "Boopie Miller", stat: "19.2 PPG / 41% 3PT" }],
    playStyle: ["3PT-heavy", "ACC-tested", "scorer-driven"],
    strengthOfSchedule: 8.4, recentForm: "average", conferenceFinish: "ACC (First Four)",
    upsetAlert: false, sleeper: false,
    analysis: "First Four team. 3rd in ACC offense with Miller as an elite shooter. But 20-13 is underwhelming. Would need to beat Miami OH in the play-in to get to the bracket. Good team playing below their potential."
  },
  {
    id: "akron", name: "Akron Zips", shortName: "Akron",
    seed: 12, region: "Midwest", record: "29-5", wins: 29, losses: 5,
    championshipOdds: 100000, ppg: 73.4, oppPpg: 63.8, scoringMargin: 9.6,
    fg2Pct: 49.8, fg3Pct: 41.8, ftPct: 73.8, threePointRate: 50,
    adjOffRating: 110.4, adjDefRating: 93.8, adjEffMargin: 16.6, pace: 68.4,
    orebRate: 26, drebRate: 75, turnoversForced: 19.2, turnoverRate: 13.8,
    keyPlayers: [{ name: "Shammah Scott", stat: "42% 3PT / ~50% shots are 3s" }],
    playStyle: ["3PT-barrage", "top-15-shooting", "all-or-nothing"],
    strengthOfSchedule: 6.8, recentForm: "hot", conferenceFinish: "MAC Champion",
    upsetAlert: true, sleeper: false,
    analysis: "50% of their shots are 3-pointers — highest rate in the field. When hot, they're unbeatable. Top-15 3PT shooting nationally with 29-5 record. Classic 12-seed shootout-upset specialist. Virginia's pack-line defense is their worst nightmare though."
  },
  {
    id: "hofstra", name: "Hofstra Pride", shortName: "Hofstra",
    seed: 13, region: "Midwest", record: "24-10", wins: 24, losses: 10,
    championshipOdds: 200000, ppg: 76.8, oppPpg: 69.4, scoringMargin: 7.4,
    fg2Pct: 51.2, fg3Pct: 40.2, ftPct: 71.8, threePointRate: 38,
    adjOffRating: 108.8, adjDefRating: 98.4, adjEffMargin: 10.4, pace: 70.4,
    orebRate: 28, drebRate: 72, turnoversForced: 16.4, turnoverRate: 15.8,
    keyPlayers: [{ name: "Cruz Davis", stat: "20.2 PPG / 4.6 APG / 40% 3PT" }],
    playStyle: ["scorer-dependent", "balanced", "mid-major"],
    strengthOfSchedule: 6.2, recentForm: "hot", conferenceFinish: "CAA Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Cruz Davis is a legit scorer but Alabama's pace and offensive explosion makes this a tough matchup. Their 13-seed story might end round one."
  },
  {
    id: "wright-state", name: "Wright State Raiders", shortName: "Wright St.",
    seed: 14, region: "Midwest", record: "23-11", wins: 23, losses: 11,
    championshipOdds: 200000, ppg: 72.4, oppPpg: 67.2, scoringMargin: 5.2,
    fg2Pct: 50.8, fg3Pct: 38.2, ftPct: 70.8, threePointRate: 36,
    adjOffRating: 107.4, adjDefRating: 97.8, adjEffMargin: 9.6, pace: 67.8,
    orebRate: 27, drebRate: 72, turnoversForced: 16.8, turnoverRate: 16.2,
    keyPlayers: [{ name: "TJ Burch", stat: "19.0 PPG in league tourney / 38% 3PT" }],
    playStyle: ["tournament-hot", "scrappy", "guard-driven"],
    strengthOfSchedule: 5.4, recentForm: "hot", conferenceFinish: "Horizon League Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Burch got hot in the tournament but Texas Tech's defense is too disciplined for this to be an upset."
  },
  {
    id: "tennessee-state", name: "Tennessee State Tigers", shortName: "TSU",
    seed: 15, region: "Midwest", record: "23-9", wins: 23, losses: 9,
    championshipOdds: 200000, ppg: 74.4, oppPpg: 68.4, scoringMargin: 6.0,
    fg2Pct: 51.4, fg3Pct: 34.8, ftPct: 70.4, threePointRate: 33,
    adjOffRating: 108.4, adjDefRating: 97.4, adjEffMargin: 11.0, pace: 70.4,
    orebRate: 29, drebRate: 73, turnoversForced: 21.8, turnoverRate: 15.4,
    keyPlayers: [{ name: "Aaron Nkrumah", stat: "17.6 PPG" }, { name: "Travis Harper II", stat: "17.3 PPG" }],
    playStyle: ["turnover-forcing", "two-scorer", "OVC-champion"],
    strengthOfSchedule: 5.2, recentForm: "hot", conferenceFinish: "OVC Champion",
    upsetAlert: false, sleeper: false,
    analysis: "25th in defensive turnover rate and two legitimate scorers. Iowa State's shooting will be too much."
  },
  {
    id: "umbc", name: "UMBC Retrievers", shortName: "UMBC",
    seed: 16, region: "Midwest", record: "24-8", wins: 24, losses: 8,
    championshipOdds: 200000, ppg: 70.8, oppPpg: 63.8, scoringMargin: 7.0,
    fg2Pct: 49.4, fg3Pct: 38.2, ftPct: 71.4, threePointRate: 42,
    adjOffRating: 107.4, adjDefRating: 94.4, adjEffMargin: 13.0, pace: 68.4,
    orebRate: 25, drebRate: 74, turnoversForced: 17.4, turnoverRate: 14.8,
    keyPlayers: [{ name: "Team shooting", stat: "38% 3PT (12-game streak)" }],
    playStyle: ["3PT-reliant", "disciplined", "small-school"],
    strengthOfSchedule: 5.0, recentForm: "hot", conferenceFinish: "America East (First Four)",
    upsetAlert: true, sleeper: false,
    analysis: "First Four team. UMBC literally upset Virginia in the most famous 16-over-1 in history. Their 38% 3PT streak and 13.0 efficiency margin make them dangerous but Michigan is significantly better than 2018 Virginia. Must beat Howard first."
  },
  {
    id: "howard", name: "Howard Bison", shortName: "Howard",
    seed: 16, region: "Midwest", record: "23-10", wins: 23, losses: 10,
    championshipOdds: 200000, ppg: 69.4, oppPpg: 66.8, scoringMargin: 2.6,
    fg2Pct: 48.8, fg3Pct: 33.4, ftPct: 69.2, threePointRate: 32,
    adjOffRating: 103.4, adjDefRating: 100.2, adjEffMargin: 3.2, pace: 67.8,
    orebRate: 26, drebRate: 70, turnoversForced: 16.4, turnoverRate: 17.8,
    keyPlayers: [{ name: "MEAC standouts", stat: "Conference tourney champions" }],
    playStyle: ["HBCU-pride", "defensive-oriented", "disciplined"],
    strengthOfSchedule: 4.2, recentForm: "hot", conferenceFinish: "MEAC Champion (First Four)",
    upsetAlert: false, sleeper: false,
    analysis: "First Four team. MEAC champion with HBCU pride but faces UMBC in the play-in. Limited offensive ceiling makes a deep run nearly impossible."
  },

  // ─── SOUTH REGION ────────────────────────────────────────────────────────
  {
    id: "florida", name: "Florida Gators", shortName: "Florida",
    seed: 1, region: "South", record: "26-7", wins: 26, losses: 7,
    championshipOdds: 750, ppg: 79.8, oppPpg: 66.2, scoringMargin: 13.6,
    fg2Pct: 58.8, fg3Pct: 38.4, ftPct: 74.2, threePointRate: 33,
    adjOffRating: 121.0, adjDefRating: 91.8, adjEffMargin: 29.2, pace: 70.2,
    orebRate: 32, drebRate: 75, turnoversForced: 18.4, turnoverRate: 13.8,
    keyPlayers: [{ name: "Walter Clayton Jr.", stat: "17.8 PPG / 5.2 APG" }, { name: "Thomas Haugh", stat: "16.2 PPG / 6.1 RPG" }],
    playStyle: ["defending-champion", "balanced-roster", "elite-defense", "versatile"],
    strengthOfSchedule: 9.3, recentForm: "hot", conferenceFinish: "SEC",
    upsetAlert: false, sleeper: false,
    analysis: "Defending national champions with hunger to repeat. Walter Clayton Jr. and Thomas Haugh lead a five-scorer attack that's impossible to single-cover. 29.2 efficiency margin ranks 4th nationally. Florida is the most complete team in the South and a real back-to-back threat."
  },
  {
    id: "houston", name: "Houston Cougars", shortName: "Houston",
    seed: 2, region: "South", record: "28-6", wins: 28, losses: 6,
    championshipOdds: 1000, ppg: 74.8, oppPpg: 62.4, scoringMargin: 12.4,
    fg2Pct: 52.4, fg3Pct: 34.4, ftPct: 72.8, threePointRate: 31,
    adjOffRating: 118.2, adjDefRating: 91.4, adjEffMargin: 26.8, pace: 65.4,
    orebRate: 29, drebRate: 77, turnoversForced: 20.4, turnoverRate: 12.4,
    keyPlayers: [{ name: "Milos Uzan", stat: "16.5 PPG / 5.4 APG" }, { name: "J'Wan Roberts", stat: "14.8 PPG / 8.2 RPG" }],
    playStyle: ["defensive-elite", "grind-it-out", "slow-pace", "turnover-forcing"],
    strengthOfSchedule: 8.8, recentForm: "hot", conferenceFinish: "Big 12",
    upsetAlert: false, sleeper: false,
    analysis: "3rd in turnover rate (KenPom). One of the best defensive programs in the country under Sampson. 29-4 with a suffocating defense (91.4 adj. def). Uzan and Roberts are the engine. Their grind style limits upset potential. One of the most consistent teams in the field."
  },
  {
    id: "illinois", name: "Illinois Fighting Illini", shortName: "Illinois",
    seed: 3, region: "South", record: "24-8", wins: 24, losses: 8,
    championshipOdds: 1900, ppg: 82.4, oppPpg: 68.4, scoringMargin: 14.0,
    fg2Pct: 53.8, fg3Pct: 41.2, ftPct: 73.8, threePointRate: 38,
    adjOffRating: 124.8, adjDefRating: 94.2, adjEffMargin: 30.6, pace: 71.8,
    orebRate: 31, drebRate: 73, turnoversForced: 18.4, turnoverRate: 14.2,
    keyPlayers: [{ name: "Kasparas Jakucionis", stat: "19.4 PPG / elite scorer" }, { name: "Kylan Boswell", stat: "13.3 PPG" }],
    playStyle: ["best-offense-nationally", "three-point-barrage", "balanced-attack"],
    strengthOfSchedule: 9.0, recentForm: "hot", conferenceFinish: "Big Ten 3rd",
    upsetAlert: false, sleeper: false,
    analysis: "#1 offense in America (124.8 adj. offensive rating). Kasparas Jakucionis is an elite scorer who makes Illinois impossible to scheme against. 30-4 at 30.6 efficiency margin. Their only weakness is perimeter defense — vulnerable to Houston's pressure. South Region's dark horse against Florida."
  },
  {
    id: "nebraska", name: "Nebraska Cornhuskers", shortName: "Nebraska",
    seed: 4, region: "South", record: "26-6", wins: 26, losses: 6,
    championshipOdds: 10000, ppg: 73.8, oppPpg: 61.4, scoringMargin: 12.4,
    fg2Pct: 51.8, fg3Pct: 40.2, ftPct: 74.8, threePointRate: 38,
    adjOffRating: 114.2, adjDefRating: 91.0, adjEffMargin: 23.2, pace: 67.4,
    orebRate: 28, drebRate: 76, turnoversForced: 19.8, turnoverRate: 12.8,
    keyPlayers: [{ name: "Pryce Sandfort", stat: "17.9 PPG / 40% 3PT" }],
    playStyle: ["best-defense-nationally", "turnover-forcing", "efficient", "defensively-elite"],
    strengthOfSchedule: 9.0, recentForm: "hot", conferenceFinish: "Big Ten",
    upsetAlert: false, sleeper: true,
    analysis: "#1 defense in the country (91.0 adj. defensive rating). Opponents shoot just 30% from 3 against them. Force turnovers on ~20% of possessions. Sandfort is a clutch shooter. Nebraska's historic first tournament appearance is a real story. Could reach Elite Eight."
  },
  {
    id: "vanderbilt", name: "Vanderbilt Commodores", shortName: "Vanderbilt",
    seed: 5, region: "South", record: "26-8", wins: 26, losses: 8,
    championshipOdds: 7500, ppg: 78.4, oppPpg: 67.8, scoringMargin: 10.6,
    fg2Pct: 52.4, fg3Pct: 38.2, ftPct: 73.4, threePointRate: 38,
    adjOffRating: 114.4, adjDefRating: 95.8, adjEffMargin: 18.6, pace: 70.4,
    orebRate: 30, drebRate: 73, turnoversForced: 18.4, turnoverRate: 14.4,
    keyPlayers: [{ name: "Tyler Tanner", stat: "19.2 PPG / 38% 3PT" }, { name: "Duke Miles", stat: "15.9 PPG / 4.2 APG" }],
    playStyle: ["top-25-offense", "SEC-hardened", "two-guard-attack"],
    strengthOfSchedule: 9.1, recentForm: "hot", conferenceFinish: "SEC Runner-Up",
    upsetAlert: false, sleeper: false,
    analysis: "SEC runner-up with top-25 offense. Tanner + Miles is one of the best backcourts in the region. Momentum entering the tourney. VCU's press defense poses early problems but Vanderbilt should advance to face Nebraska in a compelling 4-5 game."
  },
  {
    id: "north-carolina", name: "North Carolina Tar Heels", shortName: "UNC",
    seed: 6, region: "South", record: "24-8", wins: 24, losses: 8,
    championshipOdds: 25000, ppg: 78.8, oppPpg: 68.4, scoringMargin: 10.4,
    fg2Pct: 53.4, fg3Pct: 36.4, ftPct: 72.8, threePointRate: 33,
    adjOffRating: 113.8, adjDefRating: 96.4, adjEffMargin: 17.4, pace: 72.4,
    orebRate: 33, drebRate: 72, turnoversForced: 17.8, turnoverRate: 15.4,
    keyPlayers: [{ name: "Caleb Wilson", stat: "19.8 PPG / 9.4 RPG" }, { name: "Henri Veesaar", stat: "16.2 PPG (last 5)" }],
    playStyle: ["fast-transition", "blue-blood", "interior-dominant"],
    strengthOfSchedule: 8.8, recentForm: "average", conferenceFinish: "ACC",
    upsetAlert: false, sleeper: false,
    analysis: "Wilson is a double-double machine and a nightmare against smaller lineups. UNC's transition game and size creates problems. 21-12 is pedestrian for a blue blood but their matchup with Saint Mary's in R2 is the most interesting first-weekend game in the South."
  },
  {
    id: "saint-marys", name: "Saint Mary's Gaels", shortName: "St. Mary's",
    seed: 7, region: "South", record: "27-5", wins: 27, losses: 5,
    championshipOdds: 30000, ppg: 74.8, oppPpg: 63.4, scoringMargin: 11.4,
    fg2Pct: 52.4, fg3Pct: 39.2, ftPct: 76.4, threePointRate: 39,
    adjOffRating: 113.4, adjDefRating: 92.4, adjEffMargin: 21.0, pace: 66.8,
    orebRate: 28, drebRate: 76, turnoversForced: 18.8, turnoverRate: 12.8,
    keyPlayers: [{ name: "Paulius Murauskas", stat: "18.8 PPG" }, { name: "Mikey Lewis", stat: "22.6 PPG (last 5)" }],
    playStyle: ["efficient-offense", "slow-methodical", "WCC-proven"],
    strengthOfSchedule: 7.8, recentForm: "hot", conferenceFinish: "WCC",
    upsetAlert: false, sleeper: true,
    analysis: "27-5 with a 21.0 efficiency margin. Lewis on a tear (22.6 PPG last 5). Their best-case scenario has them matching up well with UNC — both slow-pace, interior-focused teams. Saint Mary's is consistently underseeded. Don't sleep on them."
  },
  {
    id: "clemson", name: "Clemson Tigers", shortName: "Clemson",
    seed: 8, region: "South", record: "24-10", wins: 24, losses: 10,
    championshipOdds: 25000, ppg: 72.4, oppPpg: 63.8, scoringMargin: 8.6,
    fg2Pct: 50.4, fg3Pct: 35.4, ftPct: 71.8, threePointRate: 34,
    adjOffRating: 110.4, adjDefRating: 93.4, adjEffMargin: 17.0, pace: 66.8,
    orebRate: 29, drebRate: 74, turnoversForced: 18.8, turnoverRate: 14.8,
    keyPlayers: [{ name: "RJ Godfrey", stat: "11.8 PPG plus deep balanced roster" }],
    playStyle: ["defense-first", "balanced", "ACC-physical"],
    strengthOfSchedule: 8.8, recentForm: "average", conferenceFinish: "ACC",
    upsetAlert: false, sleeper: false,
    analysis: "Top-20 defense with turnover-forcing ability. Balanced scoring makes them hard to scout. Iowa is their first-round matchup — Clemson should win on defense alone."
  },
  {
    id: "iowa", name: "Iowa Hawkeyes", shortName: "Iowa",
    seed: 9, region: "South", record: "21-12", wins: 21, losses: 12,
    championshipOdds: 30000, ppg: 76.8, oppPpg: 70.4, scoringMargin: 6.4,
    fg2Pct: 51.4, fg3Pct: 38.2, ftPct: 73.4, threePointRate: 38,
    adjOffRating: 110.8, adjDefRating: 99.4, adjEffMargin: 11.4, pace: 71.4,
    orebRate: 28, drebRate: 71, turnoversForced: 16.8, turnoverRate: 16.4,
    keyPlayers: [{ name: "Ben Stirtz", stat: "20.0 PPG / 4.5 APG / 1.5 SPG / 38% 3PT" }],
    playStyle: ["star-driven", "guard-dominant", "scoring-heavy"],
    strengthOfSchedule: 8.8, recentForm: "average", conferenceFinish: "Big Ten",
    upsetAlert: false, sleeper: false,
    analysis: "Stirtz is the most complete guard in this seeding range — 20 PPG + assists + steals. Big Ten schedule adds credibility. But Clemson's defense will hold him in check. 21-12 record is the concern."
  },
  {
    id: "texas-am", name: "Texas A&M Aggies", shortName: "Texas A&M",
    seed: 10, region: "South", record: "21-11", wins: 21, losses: 11,
    championshipOdds: 35000, ppg: 73.4, oppPpg: 67.8, scoringMargin: 5.6,
    fg2Pct: 51.2, fg3Pct: 35.4, ftPct: 71.4, threePointRate: 33,
    adjOffRating: 109.4, adjDefRating: 97.8, adjEffMargin: 11.6, pace: 70.4,
    orebRate: 29, drebRate: 72, turnoversForced: 17.4, turnoverRate: 16.4,
    keyPlayers: [{ name: "Mackenzie Mgbako", stat: "12.2 PPG" }],
    playStyle: ["SEC-tested", "physical", "defensive"],
    strengthOfSchedule: 9.0, recentForm: "average", conferenceFinish: "SEC",
    upsetAlert: false, sleeper: false,
    analysis: "Mgbako is talented but Texas A&M lacks a consistent second scorer. SEC schedule adds toughness but Saint Mary's has better efficiency. Likely R1 exit."
  },
  {
    id: "vcu", name: "VCU Rams", shortName: "VCU",
    seed: 11, region: "South", record: "27-7", wins: 27, losses: 7,
    championshipOdds: 50000, ppg: 73.8, oppPpg: 64.8, scoringMargin: 9.0,
    fg2Pct: 50.8, fg3Pct: 37.2, ftPct: 71.4, threePointRate: 36,
    adjOffRating: 109.8, adjDefRating: 93.8, adjEffMargin: 16.0, pace: 72.8,
    orebRate: 32, drebRate: 73, turnoversForced: 21.8, turnoverRate: 14.4,
    keyPlayers: [{ name: "Lazar Djokovic", stat: "13.8 PPG / 1.3 BPG / 37% 3PT" }],
    playStyle: ["HAVOC-press", "turnover-forcing", "fast-pace", "run-and-gun"],
    strengthOfSchedule: 7.8, recentForm: "hot", conferenceFinish: "A-10",
    upsetAlert: true, sleeper: true,
    analysis: "VCU's HAVOC system forces turnovers at an elite rate — 21.8% opponents TO rate. Their fast-pace, high-pressure style disrupts ANY team. 27-7 record is legit. Djokovic provides offense from multiple levels. They can beat Vanderbilt and should be feared throughout the South."
  },
  {
    id: "mcneese", name: "McNeese Cowboys", shortName: "McNeese",
    seed: 12, region: "South", record: "28-5", wins: 28, losses: 5,
    championshipOdds: 100000, ppg: 77.2, oppPpg: 67.2, scoringMargin: 10.0,
    fg2Pct: 52.4, fg3Pct: 36.8, ftPct: 73.2, threePointRate: 36,
    adjOffRating: 110.8, adjDefRating: 96.4, adjEffMargin: 14.4, pace: 70.8,
    orebRate: 30, drebRate: 73, turnoversForced: 23.2, turnoverRate: 13.8,
    keyPlayers: [{ name: "Larry Johnson", stat: "17.5 PPG / 5.5 RPG" }, { name: "Javohn Garcia", stat: "31 pts in title game" }],
    playStyle: ["turnover-machine", "#1-turnover-forcing", "two-scorer", "momentum"],
    strengthOfSchedule: 5.8, recentForm: "hot", conferenceFinish: "Southland Champion",
    upsetAlert: true, sleeper: false,
    analysis: "#1 nationally in turnovers forced per possession. 28-5 and on a hot streak. Garcia can go off. Their defensive pressure could rattle North Carolina's guards. Classic 12-seed upset pick and one of the best 12-seeds in recent memory."
  },
  {
    id: "troy", name: "Troy Trojans", shortName: "Troy",
    seed: 13, region: "South", record: "22-11", wins: 22, losses: 11,
    championshipOdds: 200000, ppg: 73.4, oppPpg: 65.8, scoringMargin: 7.6,
    fg2Pct: 61.4, fg3Pct: 33.8, ftPct: 71.8, threePointRate: 30,
    adjOffRating: 108.4, adjDefRating: 95.8, adjEffMargin: 12.6, pace: 68.4,
    orebRate: 32, drebRate: 72, turnoversForced: 17.8, turnoverRate: 15.4,
    keyPlayers: [{ name: "Theo Seng", stat: "12.9 PPG / 32% opp rim % / 5.8 RPG" }],
    playStyle: ["paint-dominant", "interior-defense", "physical"],
    strengthOfSchedule: 6.0, recentForm: "hot", conferenceFinish: "Sun Belt Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Opponents score on only 32% of shots around the rim against Seng — elite interior defense. Nebraska's elite 3PT shooting should expose them eventually."
  },
  {
    id: "penn", name: "Penn Quakers", shortName: "Penn",
    seed: 14, region: "South", record: "18-11", wins: 18, losses: 11,
    championshipOdds: 150000, ppg: 70.8, oppPpg: 66.4, scoringMargin: 4.4,
    fg2Pct: 50.2, fg3Pct: 34.8, ftPct: 72.4, threePointRate: 34,
    adjOffRating: 105.4, adjDefRating: 98.8, adjEffMargin: 6.6, pace: 66.8,
    orebRate: 25, drebRate: 73, turnoversForced: 16.8, turnoverRate: 15.4,
    keyPlayers: [{ name: "Ethan Roberts", stat: "16.9 PPG" }],
    playStyle: ["disciplined", "ivy-league", "half-court"],
    strengthOfSchedule: 6.2, recentForm: "average", conferenceFinish: "Ivy League Champion",
    upsetAlert: false, sleeper: false,
    analysis: "Ivy League champion but their SOS is too weak. Vanderbilt's SEC-tested backcourt will be too much."
  },
  {
    id: "idaho", name: "Idaho Vandals", shortName: "Idaho",
    seed: 15, region: "South", record: "21-14", wins: 21, losses: 14,
    championshipOdds: 200000, ppg: 73.8, oppPpg: 68.4, scoringMargin: 5.4,
    fg2Pct: 51.4, fg3Pct: 35.8, ftPct: 71.8, threePointRate: 35,
    adjOffRating: 107.4, adjDefRating: 97.8, adjEffMargin: 9.6, pace: 69.4,
    orebRate: 27, drebRate: 72, turnoversForced: 17.4, turnoverRate: 16.4,
    keyPlayers: [{ name: "Big Sky core", stat: "52 PPG combined in tourney" }],
    playStyle: ["balanced-four-player", "momentum-driven"],
    strengthOfSchedule: 4.8, recentForm: "hot", conferenceFinish: "Big Sky Champion",
    upsetAlert: false, sleeper: false,
    analysis: "21-14 record and weak SOS. Houston's defense will hold them to the mid-50s."
  },
  {
    id: "prairie-view", name: "Prairie View A&M Panthers", shortName: "PV A&M",
    seed: 16, region: "South", record: "18-17", wins: 18, losses: 17,
    championshipOdds: 200000, ppg: 71.4, oppPpg: 69.4, scoringMargin: 2.0,
    fg2Pct: 49.8, fg3Pct: 33.8, ftPct: 69.8, threePointRate: 33,
    adjOffRating: 103.8, adjDefRating: 100.4, adjEffMargin: 3.4, pace: 68.4,
    orebRate: 26, drebRate: 70, turnoversForced: 16.8, turnoverRate: 18.4,
    keyPlayers: [{ name: "Dontae Horne", stat: "24 PPG (league tourney)" }],
    playStyle: ["HBCU-pride", "tournament-hot", "Cinderella-story"],
    strengthOfSchedule: 4.2, recentForm: "hot", conferenceFinish: "SWAC Champion (First Four)",
    upsetAlert: false, sleeper: false,
    analysis: "First Four team. 18-17 is one of the worst records in tournament history. They play for the right to face Florida — the defending national champion. This is a feel-good story that ends quickly."
  },
  {
    id: "lehigh", name: "Lehigh Mountain Hawks", shortName: "Lehigh",
    seed: 16, region: "South", record: "18-16", wins: 18, losses: 16,
    championshipOdds: 200000, ppg: 75.4, oppPpg: 72.4, scoringMargin: 3.0,
    fg2Pct: 50.2, fg3Pct: 43.2, ftPct: 72.8, threePointRate: 42,
    adjOffRating: 108.4, adjDefRating: 102.4, adjEffMargin: 6.0, pace: 72.4,
    orebRate: 26, drebRate: 71, turnoversForced: 16.4, turnoverRate: 17.4,
    keyPlayers: [{ name: "Nasir Whitlock", stat: "21.1 PPG / 45% 3PT (top-25)" }],
    playStyle: ["3PT-shooter", "scorer-dependent", "small-school"],
    strengthOfSchedule: 4.4, recentForm: "average", conferenceFinish: "Patriot League (First Four)",
    upsetAlert: false, sleeper: false,
    analysis: "First Four team. 18-16 record is among the worst for a 16-seed. Whitlock can shoot but Florida's five-scorer attack will be overwhelming. Must beat Prairie View first."
  }
];

// Apply derived fields
export const ALL_TEAMS: NCAATeam[] = rawTeams.map(t => ({
  ...t,
  impliedChampionshipPct: mlToImplied(t.championshipOdds)
}));

export const REGIONS = ["East", "West", "Midwest", "South"] as const;
export type Region = typeof REGIONS[number];

export function getTeamsByRegion(region: Region): NCAATeam[] {
  return ALL_TEAMS.filter(t => t.region === region).sort((a, b) => a.seed - b.seed);
}

// First Four play-in structure (seeds 11 and 16 in some regions)
export const FIRST_FOUR = [
  { region: "West" as Region, seed: 11, teams: ["texas", "nc-state"] },
  { region: "Midwest" as Region, seed: 11, teams: ["miami-oh", "smu"] },
  { region: "Midwest" as Region, seed: 16, teams: ["umbc", "howard"] },
  { region: "South" as Region, seed: 16, teams: ["prairie-view", "lehigh"] }
];

// Standard bracket matchups by seed (1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15)
export const SEED_MATCHUPS = [
  [1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]
] as [number, number][];
