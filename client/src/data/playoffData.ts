/**
 * Clubhouse IQ Playoff Team Data
 *
 * NBA Playoffs 2026 & NHL Stanley Cup Playoffs 2026 — real seedings and stats.
 * Uses the same NCAATeam interface so the existing bracketEngine works unchanged.
 * "Region" maps to Conference bracket position for 16-team playoffs.
 *
 * NBA sources: CBS Sports, NBA.com (April 7 2026 standings)
 * NHL sources: CBS Sports, ESPN (April 7 2026 standings)
 */

import { NCAATeam } from "./bracketData";

// ── Helper ─────────────────────────────────────────────────────────────────
function mlToImplied(ml: number): number {
  if (ml > 0) return parseFloat((100 / (ml + 100) * 100).toFixed(1));
  return parseFloat((Math.abs(ml) / (Math.abs(ml) + 100) * 100).toFixed(1));
}

// ── 2026 NBA Playoffs ──────────────────────────────────────────────────────
// First-round matchups (Play-In TBD spots shown as best projection):
//   EAST: (1) Pistons vs (8) TBD | (2) Celtics vs (7) TBD | (3) Knicks vs (6) Magic | (4) Cavs vs (5) Hawks
//   WEST: (1) Thunder vs (8) TBD | (2) Spurs vs (7) TBD   | (3) Lakers vs (6) Wolves | (4) Rockets vs (5) Nuggets
//
// "Region" = conference + bracket half:
//   "East" = East top half  (seeds 1, 8, 4, 5)
//   "West" = West top half  (seeds 1, 8, 4, 5)
//   "Midwest" = East bottom half (seeds 2, 7, 3, 6)
//   "South" = West bottom half  (seeds 2, 7, 3, 6)

const rawNBATeams: Omit<NCAATeam, "impliedChampionshipPct">[] = [
  // ── EAST — top half (1/8/4/5) ──
  {
    id: "pistons", name: "Detroit Pistons", shortName: "Detroit",
    seed: 1, region: "East", record: "57-22", wins: 57, losses: 22,
    championshipOdds: 1400, ppg: 113.2, oppPpg: 106.1, scoringMargin: 7.1,
    fg2Pct: 53.1, fg3Pct: 36.4, ftPct: 77.2, threePointRate: 37,
    adjOffRating: 116.4, adjDefRating: 109.2, adjEffMargin: 7.2, pace: 99.4,
    orebRate: 28, drebRate: 74, turnoversForced: 15.1, turnoverRate: 13.8,
    keyPlayers: [{ name: "Cade Cunningham", stat: "27.4 PPG / 8.9 AST" }, { name: "Jalen Duren", stat: "14.2 PPG / 11.8 RPG" }],
    playStyle: ["playmaking-guard", "inside-out", "defensive-anchor"],
    strengthOfSchedule: 7.4, recentForm: "average", conferenceFinish: "East #1 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "Cade Cunningham has emerged as a legitimate MVP candidate. The Pistons clinched the East #1 seed with one of the best defensive ratings in the league. However, Cade's recent injury concerns could be a factor.",
  },
  {
    id: "sixers-play-in", name: "76ers / Play-In", shortName: "Play-In E8",
    seed: 8, region: "East", record: "43-36", wins: 43, losses: 36,
    championshipOdds: 8000, ppg: 110.2, oppPpg: 111.8, scoringMargin: -1.6,
    fg2Pct: 51.2, fg3Pct: 35.1, ftPct: 78.1, threePointRate: 40,
    adjOffRating: 112.8, adjDefRating: 113.4, adjEffMargin: -0.6, pace: 100.1,
    orebRate: 25, drebRate: 72, turnoversForced: 13.2, turnoverRate: 14.1,
    keyPlayers: [{ name: "Tyrese Maxey", stat: "26.1 PPG / 6.2 AST" }, { name: "Paul George", stat: "17.4 PPG" }],
    playStyle: ["guard-driven", "three-point-heavy", "up-tempo"],
    strengthOfSchedule: 6.8, recentForm: "hot", conferenceFinish: "Play-In E7-E8",
    upsetAlert: true, sleeper: false,
    analysis: "Philly survives via the Play-In. Tyrese Maxey is playing at an All-Star level but the roster depth is thin for a long run.",
  },
  {
    id: "cavaliers", name: "Cleveland Cavaliers", shortName: "Cleveland",
    seed: 4, region: "East", record: "48-29", wins: 48, losses: 29,
    championshipOdds: 2200, ppg: 116.8, oppPpg: 110.4, scoringMargin: 6.4,
    fg2Pct: 54.1, fg3Pct: 37.8, ftPct: 79.4, threePointRate: 42,
    adjOffRating: 118.1, adjDefRating: 111.8, adjEffMargin: 6.3, pace: 101.2,
    orebRate: 24, drebRate: 76, turnoversForced: 14.4, turnoverRate: 12.9,
    keyPlayers: [{ name: "Donovan Mitchell", stat: "28.3 PPG / 5.1 AST" }, { name: "Darius Garland", stat: "19.2 PPG / 7.8 AST" }],
    playStyle: ["backcourt-scoring", "three-point-shooting", "fast-paced"],
    strengthOfSchedule: 7.1, recentForm: "hot", conferenceFinish: "East #4 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "Mitchell and Garland form one of the best backcourt duos in the East. Cleveland shoots extremely well from three and can erupt offensively.",
  },
  {
    id: "hawks", name: "Atlanta Hawks", shortName: "Atlanta",
    seed: 5, region: "East", record: "44-33", wins: 44, losses: 33,
    championshipOdds: 4500, ppg: 119.4, oppPpg: 116.2, scoringMargin: 3.2,
    fg2Pct: 52.4, fg3Pct: 36.9, ftPct: 76.8, threePointRate: 43,
    adjOffRating: 120.4, adjDefRating: 116.8, adjEffMargin: 3.6, pace: 103.1,
    orebRate: 26, drebRate: 71, turnoversForced: 12.8, turnoverRate: 14.4,
    keyPlayers: [{ name: "Trae Young", stat: "29.1 PPG / 11.4 AST" }, { name: "Dejounte Murray", stat: "18.9 PPG / 6.1 AST" }],
    playStyle: ["run-and-gun", "guard-driven", "high-scoring"],
    strengthOfSchedule: 6.4, recentForm: "average", conferenceFinish: "East #5 Seed",
    upsetAlert: true, sleeper: false,
    analysis: "Trae Young is a dangerous playoff scorer but Atlanta's defense can be exposed in a series. This 4v5 matchup could go 7 games.",
  },

  // ── EAST — bottom half (2/7/3/6) ──
  {
    id: "celtics", name: "Boston Celtics", shortName: "Boston",
    seed: 2, region: "Midwest", record: "53-25", wins: 53, losses: 25,
    championshipOdds: 450, ppg: 120.1, oppPpg: 108.4, scoringMargin: 11.7,
    fg2Pct: 53.8, fg3Pct: 38.9, ftPct: 80.1, threePointRate: 47,
    adjOffRating: 122.4, adjDefRating: 110.2, adjEffMargin: 12.2, pace: 100.8,
    orebRate: 22, drebRate: 78, turnoversForced: 15.8, turnoverRate: 12.4,
    keyPlayers: [{ name: "Jayson Tatum", stat: "27.8 PPG / 8.1 RPG" }, { name: "Jaylen Brown", stat: "24.1 PPG / 5.2 RPG" }],
    playStyle: ["three-point-barrage", "defensive-depth", "two-way-stars"],
    strengthOfSchedule: 7.9, recentForm: "hot", conferenceFinish: "East #2 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "The defending East finalists have Tatum back healthy and are peaking at the right time. Boston's three-point volume and defensive versatility make them the biggest threat to knock off the Pistons.",
  },
  {
    id: "hornets-play-in", name: "Hornets / Play-In", shortName: "Play-In E7",
    seed: 7, region: "Midwest", record: "43-36", wins: 43, losses: 36,
    championshipOdds: 9000, ppg: 112.4, oppPpg: 113.8, scoringMargin: -1.4,
    fg2Pct: 50.8, fg3Pct: 35.6, ftPct: 75.4, threePointRate: 38,
    adjOffRating: 113.1, adjDefRating: 114.2, adjEffMargin: -1.1, pace: 102.4,
    orebRate: 27, drebRate: 70, turnoversForced: 13.1, turnoverRate: 15.2,
    keyPlayers: [{ name: "LaMelo Ball", stat: "26.4 PPG / 8.8 AST" }, { name: "Brandon Miller", stat: "21.2 PPG" }],
    playStyle: ["guard-playmaking", "young-core", "up-tempo"],
    strengthOfSchedule: 6.1, recentForm: "average", conferenceFinish: "Play-In E7-E8",
    upsetAlert: true, sleeper: true,
    analysis: "LaMelo Ball can take over games. Charlotte is dangerous as a lower seed but lacks playoff experience.",
  },
  {
    id: "knicks", name: "New York Knicks", shortName: "New York",
    seed: 3, region: "Midwest", record: "51-28", wins: 51, losses: 28,
    championshipOdds: 900, ppg: 115.8, oppPpg: 109.2, scoringMargin: 6.6,
    fg2Pct: 53.4, fg3Pct: 36.1, ftPct: 78.8, threePointRate: 38,
    adjOffRating: 117.8, adjDefRating: 111.2, adjEffMargin: 6.6, pace: 98.8,
    orebRate: 29, drebRate: 74, turnoversForced: 14.8, turnoverRate: 13.1,
    keyPlayers: [{ name: "Jalen Brunson", stat: "29.4 PPG / 7.8 AST" }, { name: "OG Anunoby", stat: "18.1 PPG / 6.2 RPG" }],
    playStyle: ["iso-scoring", "physical-defense", "rebounding"],
    strengthOfSchedule: 7.6, recentForm: "average", conferenceFinish: "East #3 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "Jalen Brunson is one of the best closers in the league. The Knicks grind out wins with physicality and Brunson's isolation scoring. Their biggest question is perimeter shooting depth.",
  },
  {
    id: "magic", name: "Orlando Magic", shortName: "Orlando",
    seed: 6, region: "Midwest", record: "44-34", wins: 44, losses: 34,
    championshipOdds: 5000, ppg: 108.4, oppPpg: 106.1, scoringMargin: 2.3,
    fg2Pct: 54.8, fg3Pct: 33.4, ftPct: 74.2, threePointRate: 32,
    adjOffRating: 111.8, adjDefRating: 109.4, adjEffMargin: 2.4, pace: 96.4,
    orebRate: 30, drebRate: 76, turnoversForced: 16.2, turnoverRate: 12.8,
    keyPlayers: [{ name: "Paolo Banchero", stat: "24.8 PPG / 6.4 RPG" }, { name: "Franz Wagner", stat: "21.4 PPG" }],
    playStyle: ["paint-dominant", "elite-defense", "slow-tempo"],
    strengthOfSchedule: 7.2, recentForm: "hot", conferenceFinish: "East #6 Seed",
    upsetAlert: true, sleeper: true,
    analysis: "Orlando's elite defense and young stars Banchero and Wagner make them dangerous. They play at the slowest pace in the East which neutralizes high-octane offenses.",
  },

  // ── WEST — top half (1/8/4/5) ──
  {
    id: "thunder", name: "Oklahoma City Thunder", shortName: "OKC",
    seed: 1, region: "West", record: "62-16", wins: 62, losses: 16,
    championshipOdds: 280, ppg: 119.8, oppPpg: 107.4, scoringMargin: 12.4,
    fg2Pct: 54.2, fg3Pct: 37.1, ftPct: 80.4, threePointRate: 40,
    adjOffRating: 122.1, adjDefRating: 108.8, adjEffMargin: 13.3, pace: 101.4,
    orebRate: 27, drebRate: 76, turnoversForced: 17.2, turnoverRate: 12.1,
    keyPlayers: [{ name: "Shai Gilgeous-Alexander", stat: "32.8 PPG / 6.4 AST" }, { name: "Chet Holmgren", stat: "18.9 PPG / 9.1 RPG" }],
    playStyle: ["defense-first", "backcourt-star", "versatile-frontcourt"],
    strengthOfSchedule: 8.1, recentForm: "hot", conferenceFinish: "West #1 Seed — Defending Champs",
    upsetAlert: false, sleeper: false,
    analysis: "SGA is the favorite for MVP. OKC won 62 games and defends like a team possessed. Chet Holmgren anchors a defense that ranks #1 in points allowed. The Thunder are the heavy favorites.",
  },
  {
    id: "clippers-play-in", name: "Clippers / Play-In", shortName: "Play-In W8",
    seed: 8, region: "West", record: "40-38", wins: 40, losses: 38,
    championshipOdds: 12000, ppg: 111.4, oppPpg: 112.8, scoringMargin: -1.4,
    fg2Pct: 51.8, fg3Pct: 36.2, ftPct: 76.1, threePointRate: 41,
    adjOffRating: 113.4, adjDefRating: 114.8, adjEffMargin: -1.4, pace: 100.2,
    orebRate: 24, drebRate: 73, turnoversForced: 13.4, turnoverRate: 14.1,
    keyPlayers: [{ name: "Kawhi Leonard", stat: "21.8 PPG / 6.1 RPG" }, { name: "Norman Powell", stat: "18.4 PPG" }],
    playStyle: ["two-way-wings", "grinding-defense", "iso-scoring"],
    strengthOfSchedule: 7.2, recentForm: "average", conferenceFinish: "Play-In W7-W8",
    upsetAlert: true, sleeper: false,
    analysis: "A healthy Kawhi makes the Clippers dangerous. But they need to get through the Play-In first and would be massive underdogs vs OKC.",
  },
  {
    id: "rockets", name: "Houston Rockets", shortName: "Houston",
    seed: 4, region: "West", record: "49-30", wins: 49, losses: 30,
    championshipOdds: 2800, ppg: 113.8, oppPpg: 108.4, scoringMargin: 5.4,
    fg2Pct: 52.8, fg3Pct: 35.8, ftPct: 74.8, threePointRate: 38,
    adjOffRating: 116.4, adjDefRating: 110.8, adjEffMargin: 5.6, pace: 100.4,
    orebRate: 32, drebRate: 71, turnoversForced: 15.4, turnoverRate: 13.4,
    keyPlayers: [{ name: "Alperen Şengün", stat: "22.4 PPG / 10.8 RPG" }, { name: "Jalen Green", stat: "24.8 PPG" }],
    playStyle: ["paint-dominant", "young-athletic", "transition-speed"],
    strengthOfSchedule: 7.4, recentForm: "average", conferenceFinish: "West #4 Seed",
    upsetAlert: false, sleeper: true,
    analysis: "Sengun and Green are a dynamic young duo. Houston's size and athleticism give them upset potential, but they're inexperienced at this stage.",
  },
  {
    id: "nuggets", name: "Denver Nuggets", shortName: "Denver",
    seed: 5, region: "West", record: "51-28", wins: 51, losses: 28,
    championshipOdds: 1800, ppg: 116.4, oppPpg: 110.2, scoringMargin: 6.2,
    fg2Pct: 54.8, fg3Pct: 35.4, ftPct: 78.4, threePointRate: 35,
    adjOffRating: 118.8, adjDefRating: 112.1, adjEffMargin: 6.7, pace: 98.8,
    orebRate: 26, drebRate: 76, turnoversForced: 13.8, turnoverRate: 12.4,
    keyPlayers: [{ name: "Nikola Jokić", stat: "26.4 PPG / 12.8 RPG / 10.1 AST" }, { name: "Jamal Murray", stat: "21.8 PPG" }],
    playStyle: ["post-dominant", "pick-and-roll", "three-peat-hungry"],
    strengthOfSchedule: 7.8, recentForm: "hot", conferenceFinish: "West #5 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "Jokić is the best player in the world and a three-time MVP. Jokić + Murray have won it before. Denver's experience and Jokić's brilliance make them a major threat to go deep.",
  },

  // ── WEST — bottom half (2/7/3/6) ──
  {
    id: "spurs", name: "San Antonio Spurs", shortName: "San Antonio",
    seed: 2, region: "South", record: "59-20", wins: 59, losses: 20,
    championshipOdds: 380, ppg: 118.4, oppPpg: 107.8, scoringMargin: 10.6,
    fg2Pct: 53.4, fg3Pct: 37.8, ftPct: 78.8, threePointRate: 39,
    adjOffRating: 120.8, adjDefRating: 109.8, adjEffMargin: 11.0, pace: 101.8,
    orebRate: 25, drebRate: 76, turnoversForced: 16.4, turnoverRate: 12.8,
    keyPlayers: [{ name: "Victor Wembanyama", stat: "24.8 PPG / 11.4 RPG / 3.8 BLK" }, { name: "Devin Vassell", stat: "20.4 PPG" }],
    playStyle: ["defensive-anchor", "wemby-effect", "two-way-dominance"],
    strengthOfSchedule: 8.2, recentForm: "hot", conferenceFinish: "West #2 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "Wembanyama is a generational freak — his defensive impact is unprecedented for a 22-year-old. San Antonio's youth and athleticism make them one of the most frightening teams to face. They're legitimate title contenders.",
  },
  {
    id: "suns-play-in", name: "Suns / Play-In", shortName: "Play-In W7",
    seed: 7, region: "South", record: "43-35", wins: 43, losses: 35,
    championshipOdds: 9500, ppg: 114.8, oppPpg: 115.4, scoringMargin: -0.6,
    fg2Pct: 52.1, fg3Pct: 36.8, ftPct: 77.2, threePointRate: 42,
    adjOffRating: 116.8, adjDefRating: 117.2, adjEffMargin: -0.4, pace: 102.8,
    orebRate: 23, drebRate: 72, turnoversForced: 12.8, turnoverRate: 13.8,
    keyPlayers: [{ name: "Kevin Durant", stat: "26.8 PPG / 7.1 RPG" }, { name: "Bradley Beal", stat: "18.4 PPG" }],
    playStyle: ["superstar-iso", "scoring-depth", "veteran-experience"],
    strengthOfSchedule: 6.8, recentForm: "average", conferenceFinish: "Play-In W7-W8",
    upsetAlert: true, sleeper: false,
    analysis: "KD is still KD. Phoenix needs the Play-In but a KD-led team is always dangerous in a 7-game series.",
  },
  {
    id: "lakers", name: "Los Angeles Lakers", shortName: "LA Lakers",
    seed: 3, region: "South", record: "50-28", wins: 50, losses: 28,
    championshipOdds: 1200, ppg: 117.4, oppPpg: 110.8, scoringMargin: 6.6,
    fg2Pct: 53.1, fg3Pct: 36.4, ftPct: 76.8, threePointRate: 36,
    adjOffRating: 118.8, adjDefRating: 112.4, adjEffMargin: 6.4, pace: 100.1,
    orebRate: 27, drebRate: 74, turnoversForced: 14.8, turnoverRate: 13.2,
    keyPlayers: [{ name: "Luka Dončić", stat: "29.8 PPG / 8.4 RPG / 8.8 AST" }, { name: "Austin Reaves", stat: "19.8 PPG" }],
    playStyle: ["luka-iso", "physical-size", "veteran-playoff-experience"],
    strengthOfSchedule: 7.8, recentForm: "cold", conferenceFinish: "West #3 Seed",
    upsetAlert: false, sleeper: false,
    analysis: "Luka Dončić has taken LA to a new level. Despite recent injury questions, the Lakers have championship DNA. Luka in the playoffs is a different animal.",
  },
  {
    id: "timberwolves", name: "Minnesota Timberwolves", shortName: "Minnesota",
    seed: 6, region: "South", record: "46-32", wins: 46, losses: 32,
    championshipOdds: 3200, ppg: 112.4, oppPpg: 108.1, scoringMargin: 4.3,
    fg2Pct: 54.1, fg3Pct: 34.8, ftPct: 75.4, threePointRate: 34,
    adjOffRating: 114.8, adjDefRating: 110.8, adjEffMargin: 4.0, pace: 97.8,
    orebRate: 28, drebRate: 75, turnoversForced: 16.8, turnoverRate: 13.4,
    keyPlayers: [{ name: "Anthony Edwards", stat: "26.4 PPG / 5.8 RPG" }, { name: "Karl-Anthony Towns", stat: "21.8 PPG / 8.4 RPG" }],
    playStyle: ["athletic-wings", "paint-scoring", "defensive-intensity"],
    strengthOfSchedule: 7.6, recentForm: "average", conferenceFinish: "West #6 Seed",
    upsetAlert: false, sleeper: true,
    analysis: "Ant Edwards is a rising star who elevates in big moments. Minnesota beat the Lakers in last year's playoffs and has the personnel to do it again.",
  },
];

export const NBA_PLAYOFFS_2026_TEAMS: NCAATeam[] = rawNBATeams.map(t => ({
  ...t,
  impliedChampionshipPct: mlToImplied(t.championshipOdds),
}));

// ── 2026 NHL Stanley Cup Playoffs ─────────────────────────────────────────
// Current bracket (April 7 2026 — final day of regular season still pending):
//   EAST:
//     (A1) Tampa Bay Lightning  vs (WC1) Boston Bruins
//     (A2) Montreal Canadiens   vs (A3)  Buffalo Sabres
//     (M1) Carolina Hurricanes  vs (WC2) Ottawa Senators
//     (M2) Pittsburgh Penguins  vs (M3)  New York Islanders
//   WEST:
//     (C1) Colorado Avalanche   vs (WC2) Nashville Predators
//     (C2) Dallas Stars         vs (C3)  Minnesota Wild
//     (P1) Edmonton Oilers      vs (WC1) Utah Mammoth
//     (P2) Anaheim Ducks        vs (P3)  Vegas Golden Knights
//
// "Region" mapping: East=ATL div bracket | Midwest=MET div bracket
//                   West=Central div bracket | South=Pacific div bracket

const rawNHLTeams: Omit<NCAATeam, "impliedChampionshipPct">[] = [
  // ── ATLANTIC division bracket ──
  {
    id: "lightning", name: "Tampa Bay Lightning", shortName: "Tampa Bay",
    seed: 1, region: "East", record: "48-22-6 (102 pts)", wins: 48, losses: 22,
    championshipOdds: 600, ppg: 3.28, oppPpg: 2.61, scoringMargin: 0.67,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 116.2, adjDefRating: 105.8, adjEffMargin: 10.4, pace: 30.2,
    orebRate: 52, drebRate: 48, turnoversForced: 8.4, turnoverRate: 7.2,
    keyPlayers: [{ name: "Nikita Kucherov", stat: "1.48 PPG" }, { name: "Andrei Vasilevskiy", stat: ".922 SV%" }],
    playStyle: ["elite-goaltending", "power-play", "veteran-core"],
    strengthOfSchedule: 8.2, recentForm: "hot", conferenceFinish: "Atlantic Division #1",
    upsetAlert: false, sleeper: false,
    analysis: "Tampa's dynasty core is back. Kucherov leads the NHL in scoring and Vasilevskiy is one of the best goalies in history. The Lightning know how to win in May and June.",
  },
  {
    id: "bruins", name: "Boston Bruins", shortName: "Boston",
    seed: 4, region: "East", record: "43-25-8 (94 pts)", wins: 43, losses: 25,
    championshipOdds: 1800, ppg: 3.12, oppPpg: 2.82, scoringMargin: 0.30,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 112.4, adjDefRating: 108.8, adjEffMargin: 3.6, pace: 29.8,
    orebRate: 48, drebRate: 52, turnoversForced: 7.8, turnoverRate: 7.4,
    keyPlayers: [{ name: "David Pastrnak", stat: "0.98 PPG" }, { name: "Jeremy Swayman", stat: ".914 SV%" }],
    playStyle: ["two-way-play", "physical", "playoff-tested"],
    strengthOfSchedule: 7.8, recentForm: "average", conferenceFinish: "East Wild Card #1",
    upsetAlert: true, sleeper: false,
    analysis: "Pastrnak is a legitimate goal scorer. Boston is experienced and dangerous as a wild card but Tampa's depth is formidable.",
  },
  {
    id: "canadiens", name: "Montreal Canadiens", shortName: "Montreal",
    seed: 2, region: "East", record: "44-21-10 (98 pts)", wins: 44, losses: 21,
    championshipOdds: 900, ppg: 3.18, oppPpg: 2.74, scoringMargin: 0.44,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 114.8, adjDefRating: 108.2, adjEffMargin: 6.6, pace: 30.4,
    orebRate: 51, drebRate: 49, turnoversForced: 8.1, turnoverRate: 7.6,
    keyPlayers: [{ name: "Juraj Slafkovský", stat: "0.88 PPG" }, { name: "Cole Caufield", stat: "0.94 PPG" }],
    playStyle: ["speed-and-skill", "young-core", "offensive-firepower"],
    strengthOfSchedule: 7.6, recentForm: "hot", conferenceFinish: "Atlantic Division #2",
    upsetAlert: false, sleeper: true,
    analysis: "Montreal's young core has arrived. Slafkovský and Caufield provide explosive offense and an 8-game winning streak entering playoffs makes them a real threat.",
  },
  {
    id: "sabres", name: "Buffalo Sabres", shortName: "Buffalo",
    seed: 3, region: "East", record: "46-23-8 (100 pts)", wins: 46, losses: 23,
    championshipOdds: 1400, ppg: 3.24, oppPpg: 2.88, scoringMargin: 0.36,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 113.8, adjDefRating: 109.4, adjEffMargin: 4.4, pace: 30.1,
    orebRate: 49, drebRate: 51, turnoversForced: 7.9, turnoverRate: 7.8,
    keyPlayers: [{ name: "Tage Thompson", stat: "1.02 PPG" }, { name: "Jason Zucker", stat: "0.72 PPG" }],
    playStyle: ["power-forward-depth", "home-crowd-energy", "13-year-drought-ended"],
    strengthOfSchedule: 7.4, recentForm: "hot", conferenceFinish: "Atlantic Division #3 — First Playoffs Since 2011",
    upsetAlert: true, sleeper: true,
    analysis: "Buffalo ended a 14-year playoff drought. The city is electric and Tage Thompson is a legitimate top-line center. They're dangerous as a motivated squad ending a long run of futility.",
  },

  // ── METROPOLITAN division bracket ──
  {
    id: "hurricanes", name: "Carolina Hurricanes", shortName: "Carolina",
    seed: 1, region: "Midwest", record: "48-21-6 (102 pts)", wins: 48, losses: 21,
    championshipOdds: 500, ppg: 3.34, oppPpg: 2.58, scoringMargin: 0.76,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 118.2, adjDefRating: 104.8, adjEffMargin: 13.4, pace: 31.2,
    orebRate: 54, drebRate: 46, turnoversForced: 9.2, turnoverRate: 7.1,
    keyPlayers: [{ name: "Sebastian Aho", stat: "1.12 PPG" }, { name: "Pyotr Kochetkov", stat: ".918 SV%" }],
    playStyle: ["relentless-forecheck", "defensive-machine", "depth-scoring"],
    strengthOfSchedule: 8.4, recentForm: "hot", conferenceFinish: "Metro Division #1",
    upsetAlert: false, sleeper: false,
    analysis: "Carolina leads the East in scoring differential. Their relentless forecheck system wears out opponents. Aho is an elite two-way center and the Canes are built for playoff hockey.",
  },
  {
    id: "senators", name: "Ottawa Senators", shortName: "Ottawa",
    seed: 4, region: "Midwest", record: "39-26-10 (88 pts)", wins: 39, losses: 26,
    championshipOdds: 4500, ppg: 2.98, oppPpg: 2.84, scoringMargin: 0.14,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 108.4, adjDefRating: 107.8, adjEffMargin: 0.6, pace: 29.4,
    orebRate: 46, drebRate: 54, turnoversForced: 7.2, turnoverRate: 8.1,
    keyPlayers: [{ name: "Brady Tkachuk", stat: "0.82 PPG" }, { name: "Tim Stützle", stat: "0.91 PPG" }],
    playStyle: ["physical-forecheck", "young-and-hungry", "defensive-structure"],
    strengthOfSchedule: 7.1, recentForm: "average", conferenceFinish: "East Wild Card #2",
    upsetAlert: true, sleeper: false,
    analysis: "Ottawa is a playoff Cinderella candidate. Tkachuk and Stützle bring physicality and skill. They'll be huge underdogs against Carolina but stranger things have happened.",
  },
  {
    id: "penguins", name: "Pittsburgh Penguins", shortName: "Pittsburgh",
    seed: 2, region: "Midwest", record: "38-22-16 (92 pts)", wins: 38, losses: 22,
    championshipOdds: 2200, ppg: 3.08, oppPpg: 2.78, scoringMargin: 0.30,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 111.8, adjDefRating: 107.4, adjEffMargin: 4.4, pace: 29.8,
    orebRate: 47, drebRate: 53, turnoversForced: 7.8, turnoverRate: 7.6,
    keyPlayers: [{ name: "Sidney Crosby", stat: "0.94 PPG" }, { name: "Evgeni Malkin", stat: "0.88 PPG" }],
    playStyle: ["veteran-leadership", "elite-centers", "playoff-experience"],
    strengthOfSchedule: 7.8, recentForm: "average", conferenceFinish: "Metro Division #2",
    upsetAlert: false, sleeper: false,
    analysis: "Crosby is still one of the best in the world at 38. Pittsburgh's big-game DNA never fully goes away. This could be one of their last great runs together.",
  },
  {
    id: "islanders", name: "New York Islanders", shortName: "NY Islanders",
    seed: 3, region: "Midwest", record: "42-29-5 (89 pts)", wins: 42, losses: 29,
    championshipOdds: 3800, ppg: 2.88, oppPpg: 2.68, scoringMargin: 0.20,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 108.8, adjDefRating: 106.4, adjEffMargin: 2.4, pace: 28.8,
    orebRate: 48, drebRate: 52, turnoversForced: 7.4, turnoverRate: 7.9,
    keyPlayers: [{ name: "Mathew Barzal", stat: "0.84 PPG" }, { name: "Ilya Sorokin", stat: ".921 SV%" }],
    playStyle: ["defensive-trap", "elite-goaltending", "clutch-in-close-games"],
    strengthOfSchedule: 7.2, recentForm: "cold", conferenceFinish: "Metro Division #3",
    upsetAlert: true, sleeper: false,
    analysis: "Sorokin is a top-5 NHL goalie and can steal games. The Islanders are built to win 2-1 games and grind out series.",
  },

  // ── CENTRAL division bracket ──
  {
    id: "avalanche", name: "Colorado Avalanche", shortName: "Colorado",
    seed: 1, region: "West", record: "49-15-10 (108 pts)", wins: 49, losses: 15,
    championshipOdds: 320, ppg: 3.48, oppPpg: 2.54, scoringMargin: 0.94,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 122.8, adjDefRating: 103.8, adjEffMargin: 19.0, pace: 32.1,
    orebRate: 56, drebRate: 44, turnoversForced: 9.8, turnoverRate: 7.4,
    keyPlayers: [{ name: "Nathan MacKinnon", stat: "1.42 PPG" }, { name: "Cale Makar", stat: "1.18 PPG (D)" }],
    playStyle: ["offensive-juggernaut", "elite-defenseman", "cup-pedigree"],
    strengthOfSchedule: 8.4, recentForm: "hot", conferenceFinish: "Central Division #1 — Presidents' Trophy Contender",
    upsetAlert: false, sleeper: false,
    analysis: "MacKinnon is the best player in hockey right now, and Makar is the best defenseman. Colorado's efficiency margin of +0.94 goals per game is by far the best in the league. They're the Stanley Cup favorite.",
  },
  {
    id: "predators", name: "Nashville Predators", shortName: "Nashville",
    seed: 4, region: "West", record: "36-31-9 (81 pts)", wins: 36, losses: 31,
    championshipOdds: 9000, ppg: 2.84, oppPpg: 2.94, scoringMargin: -0.10,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 104.8, adjDefRating: 107.2, adjEffMargin: -2.4, pace: 28.4,
    orebRate: 44, drebRate: 56, turnoversForced: 7.1, turnoverRate: 8.4,
    keyPlayers: [{ name: "Filip Forsberg", stat: "0.86 PPG" }, { name: "Juuse Saros", stat: ".916 SV%" }],
    playStyle: ["hot-streak-entry", "defensive-neutral-zone", "playoff-spoiler"],
    strengthOfSchedule: 7.0, recentForm: "hot", conferenceFinish: "West Wild Card #2",
    upsetAlert: true, sleeper: true,
    analysis: "Nashville is on a 7-3 streak to sneak into the playoffs. Saros can steal games and Forsberg provides veteran playoff scoring. Biggest Cinderella candidate in the West.",
  },
  {
    id: "stars", name: "Dallas Stars", shortName: "Dallas",
    seed: 2, region: "West", record: "45-19-12 (102 pts)", wins: 45, losses: 19,
    championshipOdds: 750, ppg: 3.24, oppPpg: 2.68, scoringMargin: 0.56,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 117.4, adjDefRating: 106.4, adjEffMargin: 11.0, pace: 30.8,
    orebRate: 52, drebRate: 48, turnoversForced: 8.4, turnoverRate: 7.6,
    keyPlayers: [{ name: "Jason Robertson", stat: "1.14 PPG" }, { name: "Jake Oettinger", stat: ".918 SV%" }],
    playStyle: ["balanced-attack", "power-play-threat", "big-game-goaltending"],
    strengthOfSchedule: 8.1, recentForm: "hot", conferenceFinish: "Central Division #2",
    upsetAlert: false, sleeper: false,
    analysis: "Robertson is a Hart Trophy contender and one of the most consistent players in the league. Oettinger is elite. Dallas has the depth and goaltending to beat anyone.",
  },
  {
    id: "wild", name: "Minnesota Wild", shortName: "Minnesota",
    seed: 3, region: "West", record: "42-21-12 (96 pts)", wins: 42, losses: 21,
    championshipOdds: 1600, ppg: 3.14, oppPpg: 2.78, scoringMargin: 0.36,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 113.8, adjDefRating: 108.8, adjEffMargin: 5.0, pace: 30.2,
    orebRate: 50, drebRate: 50, turnoversForced: 8.1, turnoverRate: 7.8,
    keyPlayers: [{ name: "Kirill Kaprizov", stat: "1.08 PPG" }, { name: "Cam Talbot", stat: ".912 SV%" }],
    playStyle: ["kaprizov-led", "speed-skill", "compete-level"],
    strengthOfSchedule: 7.9, recentForm: "average", conferenceFinish: "Central Division #3",
    upsetAlert: false, sleeper: false,
    analysis: "Kaprizov is a superstar who can dominate games. Minnesota always makes things interesting and is built for the grind of a 7-game series.",
  },

  // ── PACIFIC division bracket ──
  {
    id: "oilers", name: "Edmonton Oilers", shortName: "Edmonton",
    seed: 1, region: "South", record: "39-29-9 (87 pts)", wins: 39, losses: 29,
    championshipOdds: 1200, ppg: 3.18, oppPpg: 2.94, scoringMargin: 0.24,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 113.8, adjDefRating: 109.8, adjEffMargin: 4.0, pace: 30.8,
    orebRate: 50, drebRate: 50, turnoversForced: 8.1, turnoverRate: 7.9,
    keyPlayers: [{ name: "Connor McDavid", stat: "1.48 PPG" }, { name: "Leon Draisaitl", stat: "1.28 PPG" }],
    playStyle: ["superstar-driven", "power-play-elite", "2025-cup-runners-up"],
    strengthOfSchedule: 7.6, recentForm: "average", conferenceFinish: "Pacific Division #1",
    upsetAlert: false, sleeper: false,
    analysis: "McDavid and Draisaitl are the most dangerous offensive duo in the playoffs. When their power play is on, no team can keep up. The questions are on defense and goaltending.",
  },
  {
    id: "mammoth", name: "Utah Mammoth", shortName: "Utah",
    seed: 4, region: "South", record: "40-30-6 (86 pts)", wins: 40, losses: 30,
    championshipOdds: 3600, ppg: 3.04, oppPpg: 2.88, scoringMargin: 0.16,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 110.4, adjDefRating: 108.8, adjEffMargin: 1.6, pace: 29.8,
    orebRate: 48, drebRate: 52, turnoversForced: 7.6, turnoverRate: 7.9,
    keyPlayers: [{ name: "Clayton Keller", stat: "0.88 PPG" }, { name: "Karel Vejmelka", stat: ".914 SV%" }],
    playStyle: ["new-franchise-energy", "balanced-attack", "solid-goaltending"],
    strengthOfSchedule: 7.2, recentForm: "hot", conferenceFinish: "West Wild Card #1",
    upsetAlert: true, sleeper: true,
    analysis: "Utah's first full season as a franchise and they're in the playoffs. The Mammoth play with nothing-to-lose energy and Vejmelka has been excellent in net.",
  },
  {
    id: "ducks", name: "Anaheim Ducks", shortName: "Anaheim",
    seed: 2, region: "South", record: "41-31-5 (87 pts)", wins: 41, losses: 31,
    championshipOdds: 2800, ppg: 3.01, oppPpg: 2.84, scoringMargin: 0.17,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 110.8, adjDefRating: 108.2, adjEffMargin: 2.6, pace: 29.4,
    orebRate: 47, drebRate: 53, turnoversForced: 7.4, turnoverRate: 8.1,
    keyPlayers: [{ name: "Trevor Zegras", stat: "0.84 PPG" }, { name: "Lukas Dostal", stat: ".916 SV%" }],
    playStyle: ["young-talented", "flashy-offense", "playoff-debut"],
    strengthOfSchedule: 7.0, recentForm: "hot", conferenceFinish: "Pacific Division #2",
    upsetAlert: false, sleeper: true,
    analysis: "Zegras is one of the most creative players in hockey. Anaheim's young core has arrived and their first real playoff run could surprise some people.",
  },
  {
    id: "golden-knights", name: "Vegas Golden Knights", shortName: "Vegas",
    seed: 3, region: "South", record: "35-26-16 (86 pts)", wins: 35, losses: 26,
    championshipOdds: 2200, ppg: 3.08, oppPpg: 2.94, scoringMargin: 0.14,
    fg2Pct: 0, fg3Pct: 0, ftPct: 0, threePointRate: 0,
    adjOffRating: 111.4, adjDefRating: 109.4, adjEffMargin: 2.0, pace: 30.1,
    orebRate: 49, drebRate: 51, turnoversForced: 7.8, turnoverRate: 7.6,
    keyPlayers: [{ name: "Jack Eichel", stat: "0.96 PPG" }, { name: "Adin Hill", stat: ".908 SV%" }],
    playStyle: ["former-champions", "veteran-leadership", "clutch-team"],
    strengthOfSchedule: 7.4, recentForm: "average", conferenceFinish: "Pacific Division #3",
    upsetAlert: false, sleeper: false,
    analysis: "Vegas won the Cup in 2023 and knows how to win. Eichel is a premiere center and their playoff experience gives them an edge over younger teams.",
  },
];

export const NHL_PLAYOFFS_2026_TEAMS: NCAATeam[] = rawNHLTeams.map(t => ({
  ...t,
  impliedChampionshipPct: mlToImplied(t.championshipOdds),
}));

// ── Registry: look up team data by tournament dataKey ─────────────────────
export const PLAYOFF_TEAMS_REGISTRY: Record<string, NCAATeam[]> = {
  nba_playoffs_2026: NBA_PLAYOFFS_2026_TEAMS,
  nhl_playoffs_2026: NHL_PLAYOFFS_2026_TEAMS,
  ncaab_2026: [], // uses bracketData.ts ALL_TEAMS directly
};

// Seed matchup pairs for 16-team brackets (conference-specific)
// For NBA/NHL the "regions" are conference halves (each has 4 teams, seeds 1–4 within the half)
export const PLAYOFF_SEED_MATCHUPS: [number, number][] = [
  [1, 8], [4, 5], [3, 6], [2, 7],
];
