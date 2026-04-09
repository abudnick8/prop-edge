/**
 * Clubhouse IQ Tournament Calendar
 *
 * Defines every major bracket-style tournament by sport, with real start/end dates.
 * Status is computed dynamically based on the current date — no manual updates needed.
 *
 * When a new tournament is added here it automatically appears in the Bracket tab.
 * When it ends it locks (COMPLETED). The tab only shows tournaments that are
 * ACTIVE, UPCOMING (within 30 days), or recently COMPLETED (within 7 days).
 */

export type TournamentStatus = "upcoming" | "active" | "completed";

export interface Tournament {
  id: string;
  name: string;                // display name
  shortName: string;           // compact label
  sport: "NBA" | "NHL" | "NFL" | "MLB" | "NCAAB" | "NCAAF";
  emoji: string;
  description: string;
  startDate: string;           // ISO date string (YYYY-MM-DD) — first game day
  endDate: string;             // ISO date string — latest possible last game day
  teamsCount: number;          // 16, 64, 68, etc.
  format: "16-team-playoffs" | "8-team-conference" | "68-team-ncaa" | "12-team-ncaaf";
  dataKey: string;             // links to team data export in playoffData.ts
  highlightColor: string;      // hex for accent
  status: TournamentStatus;    // computed — do not set manually
  daysUntilStart: number;      // computed
  daysUntilEnd: number;        // computed
  isSportsLeague: boolean;     // true = NBA/NHL/NFL/MLB (vs college)
  // For live-seeding sports leagues: bracket unlocks when season is >= this % complete
  // Undefined = always available (e.g. March Madness)
  seasonUnlockPct?: number;
  // API sport key for /api/live-standings
  liveStandingsSport?: "mlb" | "nba" | "nhl" | "nfl";
}

// Raw tournament definitions — dates only, status computed below
const RAW_TOURNAMENTS: Omit<Tournament, "status" | "daysUntilStart" | "daysUntilEnd">[] = [
  // ── 2026 March Madness (COMPLETED) ──────────────────────────────────────
  {
    id: "ncaab-2026",
    name: "NCAA March Madness 2026",
    shortName: "March Madness",
    sport: "NCAAB",
    emoji: "🎓",
    description: "68-team single-elimination bracket. Duke leads as the overall #1 seed.",
    startDate: "2026-03-17",
    endDate: "2026-04-06",
    teamsCount: 68,
    format: "68-team-ncaa",
    dataKey: "ncaab_2026",
    highlightColor: "#f59e0b",
    isSportsLeague: false,
  },

  // ── 2026 NBA Playoffs ────────────────────────────────────────────────────
  {
    id: "nba-playoffs-2026",
    name: "2026 NBA Playoffs",
    shortName: "NBA Playoffs",
    sport: "NBA",
    emoji: "🏀",
    description: "16-team bracket. OKC Thunder seek back-to-back titles. Pistons hold the East #1 seed.",
    startDate: "2026-04-18",
    endDate: "2026-06-19",
    teamsCount: 16,
    format: "16-team-playoffs",
    dataKey: "nba_playoffs_2026",
    highlightColor: "#1d4ed8",
    isSportsLeague: true,
    seasonUnlockPct: 90,
    liveStandingsSport: "nba",
  },

  // ── 2026 Stanley Cup Playoffs ────────────────────────────────────────────
  {
    id: "nhl-playoffs-2026",
    name: "2026 Stanley Cup Playoffs",
    shortName: "Stanley Cup",
    sport: "NHL",
    emoji: "🏒",
    description: "16-team playoff bracket. Colorado Avalanche lead the West. Carolina Hurricanes top the East.",
    startDate: "2026-04-18",
    endDate: "2026-06-21",
    teamsCount: 16,
    format: "16-team-playoffs",
    dataKey: "nhl_playoffs_2026",
    highlightColor: "#0ea5e9",
    isSportsLeague: true,
    seasonUnlockPct: 90,
    liveStandingsSport: "nhl",
  },

  // ── 2026 MLB Postseason ──────────────────────────────────────────────────
  {
    id: "mlb-postseason-2026",
    name: "2026 MLB Postseason",
    shortName: "MLB Playoffs",
    sport: "MLB",
    emoji: "⚾",
    description: "12-team bracket with Wild Card round. Live seedings update daily as the regular season winds down.",
    startDate: "2026-09-29",
    endDate: "2026-10-30",
    teamsCount: 12,
    format: "16-team-playoffs",
    dataKey: "mlb_postseason_2026",
    highlightColor: "#dc2626",
    isSportsLeague: true,
    seasonUnlockPct: 90,
    liveStandingsSport: "mlb",
  },

  // ── 2026 NFL Playoffs (next cycle) ───────────────────────────────────────
  {
    id: "nfl-playoffs-2027",
    name: "2027 NFL Playoffs",
    shortName: "NFL Playoffs",
    sport: "NFL",
    emoji: "🏈",
    description: "14-team single-elimination playoff bracket leading to Super Bowl LXI.",
    startDate: "2027-01-11",
    endDate: "2027-02-07",
    teamsCount: 14,
    format: "16-team-playoffs",
    dataKey: "nfl_playoffs_2027",
    highlightColor: "#7c3aed",
    isSportsLeague: true,
    seasonUnlockPct: 90,
    liveStandingsSport: "nfl",
  },
];

// ── Compute status fields dynamically ──────────────────────────────────────
function computeStatus(
  startDate: string,
  endDate: string
): { status: TournamentStatus; daysUntilStart: number; daysUntilEnd: number } {
  const now = new Date();
  const nowMs = now.getTime();

  const start = new Date(startDate + "T00:00:00");
  const end   = new Date(endDate   + "T23:59:59");

  const daysUntilStart = Math.ceil((start.getTime() - nowMs) / (1000 * 60 * 60 * 24));
  const daysUntilEnd   = Math.ceil((end.getTime()   - nowMs) / (1000 * 60 * 60 * 24));

  let status: TournamentStatus;
  if (nowMs > end.getTime()) {
    status = "completed";
  } else if (nowMs >= start.getTime()) {
    status = "active";
  } else {
    status = "upcoming";
  }

  return { status, daysUntilStart, daysUntilEnd };
}

export const ALL_TOURNAMENTS: Tournament[] = RAW_TOURNAMENTS.map(t => ({
  ...t,
  ...computeStatus(t.startDate, t.endDate),
}));

// ── Visibility rules ───────────────────────────────────────────────────────
// Show a tournament in the tab if:
//   • active: always show
//   • upcoming: show if starting within 30 days
//   • completed: show if ended within 14 days (so users can still review it, locked)
// Sport leagues with seasonUnlockPct show in the bracket tab even when "upcoming"
// once they are within the season window (so we can show live seedings)
// The actual unlock check is done in the Bracket page based on live standings data.
export function getVisibleTournaments(): Tournament[] {
  return ALL_TOURNAMENTS.filter(t => {
    if (t.status === "active")    return true;
    if (t.status === "completed") return t.daysUntilEnd >= -14; // ended ≤14 days ago
    if (t.status === "upcoming") {
      // For live-seeding sports leagues, show within 120 days so the in-season progress bar appears
      if (t.isSportsLeague && t.seasonUnlockPct != null) return t.daysUntilStart <= 120;
      return t.daysUntilStart <= 30;
    }
    return false;
  }).sort((a, b) => {
    // Order: active first, then upcoming (soonest first), then completed (most recent first)
    const ORDER = { active: 0, upcoming: 1, completed: 2 };
    const diff = ORDER[a.status] - ORDER[b.status];
    if (diff !== 0) return diff;
    if (a.status === "upcoming") return a.daysUntilStart - b.daysUntilStart;
    return a.daysUntilEnd - b.daysUntilEnd;
  });
}

export function getTournamentById(id: string): Tournament | undefined {
  return ALL_TOURNAMENTS.find(t => t.id === id);
}
