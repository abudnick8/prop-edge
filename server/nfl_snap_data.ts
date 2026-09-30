/**
 * Clubhouse IQ — Real NFL Snap/Usage Data
 * ═════════════════════════════════════════
 * Replaces the old fully-hardcoded Snap Trends mock data with real weekly
 * offense-snap % from nflverse (https://github.com/nflverse/nflverse-data),
 * which publishes free, no-key CSV releases sourced from Pro Football
 * Reference box scores, updated automatically ~4x/day during the season:
 *   - snap_counts_{season}.csv → offense snap % per player per week
 *
 * Note on target share / touches: nflverse's play-by-play-derived
 * `player_stats` release (which has target_share, receptions, carries) lags
 * the season significantly — as of writing it only has final data through
 * the 2024 season, not the current one. Rather than fabricate those numbers,
 * this module reports them as unavailable (null) until nflverse actually
 * publishes current-season player_stats; the UI hides those fields instead
 * of showing a misleading placeholder.
 *
 * Self-heals as the season progresses: whatever weeks nflverse has published
 * (currently 1-3, growing to 1-18) is exactly what gets returned — no fixed
 * "10 week" assumption anywhere in this module.
 */

const SNAP_COUNTS_BASE = "https://github.com/nflverse/nflverse-data/releases/download/snap_counts";

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);

export interface SnapTrendPlayer {
  playerName: string; team: string; position: string;
  snapPcts: number[];       // most-recent week first
  weekLabels: string[];     // matching labels, e.g. "Wk 3"
  targetShare: number | null; // not yet published by nflverse for the current season — null until it is
  touches: number | null;     // same as above
  routes: number | null;      // never published by nflverse's free tables — always null
  snapTrend: "rising" | "falling" | "stable" | "new";
  trendWindow: string;
  delta1: number | null;
  avg3: number; delta3: number | null; weekRange3: string;
  avg5: number; delta5: number | null; weekRange5: string;
  avg10: number; delta10: number | null; weekRange10: string;
  snapDelta: number | null;
  note: string;
  ownershipTier: string;
  weeklyProjectedPts: number | null; // requires player_stats — unavailable for current season, see header note
}

// ── Minimal RFC4180 CSV line parser (handles quoted fields w/ embedded commas) ─
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { fields.push(cur); cur = ""; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter(l => l.length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { header, rows };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Snap counts (small, season-specific file) ───────────────────────────────
interface RawSnapRow { player: string; position: string; team: string; week: number; offensePct: number | null }

let _snapCountsCache: { season: number; rows: RawSnapRow[]; ts: number } | null = null;

async function fetchSnapCounts(season: number): Promise<RawSnapRow[]> {
  const TTL = 3 * 60 * 60 * 1000; // 3h — nflverse refreshes ~4x/day
  const now = Date.now();
  if (_snapCountsCache && _snapCountsCache.season === season && (now - _snapCountsCache.ts) < TTL) {
    return _snapCountsCache.rows;
  }
  const resp = await fetch(`${SNAP_COUNTS_BASE}/snap_counts_${season}.csv`, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`nflverse snap_counts HTTP ${resp.status}`);
  const text = await resp.text();
  const { header, rows } = parseCsv(text);
  const idx = (name: string) => header.indexOf(name);
  const iGameType = idx("game_type"), iWeek = idx("week"), iPlayer = idx("player"),
        iPos = idx("position"), iTeam = idx("team"), iOffPct = idx("offense_pct");

  const out: RawSnapRow[] = [];
  for (const r of rows) {
    if (iGameType >= 0 && r[iGameType] !== "REG") continue; // regular season only
    const week = parseInt(r[iWeek], 10);
    if (!Number.isFinite(week)) continue;
    const pctRaw = r[iOffPct];
    const offensePct = pctRaw === "" || pctRaw == null ? null : parseFloat(pctRaw) * 100;
    out.push({
      player: r[iPlayer] ?? "",
      position: r[iPos] ?? "",
      team: r[iTeam] ?? "",
      week,
      offensePct: offensePct != null && Number.isFinite(offensePct) ? offensePct : null,
    });
  }
  _snapCountsCache = { season, rows: out, ts: now };
  console.log(`[NflSnapData] snap_counts_${season}.csv: ${out.length} rows`);
  return out;
}

// ── Combine into the shape the /api/nfl/snap-trends route + frontend expect ──
export async function buildRealSnapTrends(season: number, currentWeek: number): Promise<SnapTrendPlayer[]> {
  const snapRows = await fetchSnapCounts(season).catch(e => { console.warn(`[NflSnapData] snap_counts fetch failed: ${e.message}`); return [] as RawSnapRow[]; });
  if (!snapRows.length) return [];

  // Only weeks strictly before the current (in-progress/upcoming) week are "complete".
  const maxCompletedWeek = Math.max(0, currentWeek > 0 ? currentWeek - 1 : 18);

  // Group snap rows by player (name+position+most-recent-team)
  interface Agg { playerName: string; position: string; team: string; weeks: Map<number, number> }
  const byPlayer = new Map<string, Agg>();
  for (const row of snapRows) {
    if (!FANTASY_POSITIONS.has(row.position)) continue;
    if (row.offensePct == null) continue;
    if (row.week > maxCompletedWeek) continue; // skip in-progress/future weeks — no closing data yet
    const key = normalizeName(row.player);
    if (!key) continue;
    let agg = byPlayer.get(key);
    if (!agg) { agg = { playerName: row.player, position: row.position, team: row.team, weeks: new Map() }; byPlayer.set(key, agg); }
    agg.weeks.set(row.week, row.offensePct);
    agg.team = row.team; // last write wins → most recent team on file
  }

  const avg = (arr: number[]) => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : 0;

  const result: SnapTrendPlayer[] = [];
  for (const agg of Array.from(byPlayer.values())) {
    const weeksPlayed = Array.from(agg.weeks.keys()).sort((a, b) => b - a); // most recent first
    if (!weeksPlayed.length) continue;
    const mostRecentPct = agg.weeks.get(weeksPlayed[0])!;
    if (mostRecentPct < 10 && weeksPlayed.length < 2) continue; // trim clearly-inactive/garbage rows early on

    const s  = weeksPlayed.map(w => agg.weeks.get(w)!);           // snap% series, most-recent-first
    const wl = weeksPlayed.map(w => `Wk ${w}`);
    const n  = s.length;

    const avg3  = avg(s.slice(0, Math.min(3, n)));
    const avg5  = avg(s.slice(0, Math.min(5, n)));
    const avg10 = avg(s.slice(0, Math.min(10, n)));

    const delta1 = n >= 2 ? parseFloat((s[0] - s[1]).toFixed(1)) : null;
    const prior3 = s.slice(3, 6);
    const delta3 = (n >= 4 && prior3.length) ? parseFloat((avg3 - avg(prior3)).toFixed(1)) : null;
    const prior5 = s.slice(5, 10);
    const delta5 = (n >= 6 && prior5.length) ? parseFloat((avg5 - avg(prior5)).toFixed(1)) : null;
    const delta10 = n >= 2 ? parseFloat((s[0] - s[n - 1]).toFixed(1)) : null;

    const snapTrend: SnapTrendPlayer["snapTrend"] =
      delta3 == null ? "new" : delta3 >= 4 ? "rising" : delta3 <= -4 ? "falling" : "stable";
    const trendWindow = delta3 == null
      ? `Only ${n} game${n === 1 ? "" : "s"} played so far this season`
      : `${delta3 >= 0 ? "▲" : "▼"} ${delta3 >= 0 ? "+" : ""}${delta3}% (L3 vs prior 3)`;

    const weekRange3  = n >= 2 ? `${wl[Math.min(2, n - 1)]}\u2013${wl[0]}` : wl[0];
    const weekRange5  = n >= 2 ? `${wl[Math.min(4, n - 1)]}\u2013${wl[0]}` : wl[0];
    const weekRange10 = n >= 2 ? `${wl[Math.min(9, n - 1)]}\u2013${wl[0]}` : wl[0];

    const ownershipTier = mostRecentPct < 30 ? "low" : mostRecentPct <= 50 ? "medium" : "high";
    const snapDelta = n >= 3 ? parseFloat((s[0] - s[2]).toFixed(1)) : delta1;

    const note = delta3 == null
      ? `${weeksPlayed.length} game${n === 1 ? "" : "s"} into the ${season} season \u2014 snap share ${mostRecentPct.toFixed(0)}% most recently (${wl[0]})`
      : `${snapTrend === "rising" ? "Snap share climbing" : snapTrend === "falling" ? "Snap share declining" : "Snap share steady"} over last 3 games (${weekRange3})`;

    result.push({
      playerName: agg.playerName, team: agg.team, position: agg.position,
      snapPcts: s, weekLabels: wl,
      targetShare: null, touches: null, routes: null, // unavailable for the current season — see header note
      snapTrend, trendWindow,
      delta1, avg3, delta3, weekRange3, avg5, delta5, weekRange5, avg10, delta10, weekRange10,
      snapDelta, note, ownershipTier, weeklyProjectedPts: null,
    });
  }

  result.sort((a, b) => b.snapPcts[0] - a.snapPcts[0]);
  return result;
}
