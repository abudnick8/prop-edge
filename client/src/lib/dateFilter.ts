import { Bet } from "@shared/schema";

export type DayFilter = "today" | "tomorrow" | "all";

/**
 * Returns start/end of a calendar day in the user's local timezone.
 */
function dayBounds(offsetDays: number): { start: number; end: number } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const start = d.getTime();
  const end = start + 24 * 60 * 60 * 1000 - 1;
  return { start, end };
}

/**
 * Filter bets by day. Season/futures bets (no gameTime) only appear in "all".
 */
export function filterByDay(bets: Bet[], day: DayFilter): Bet[] {
  if (day === "all") return bets;

  const { start, end } = day === "today" ? dayBounds(0) : dayBounds(1);

  return bets.filter((b) => {
    if (!b.gameTime) return false; // futures / season-long — only show in "All"
    const t = new Date(b.gameTime).getTime();
    return t >= start && t <= end;
  });
}

/**
 * Count bets by day — useful for badge counts on tabs.
 */
export function countByDay(bets: Bet[], day: DayFilter): number {
  return filterByDay(bets, day).length;
}
