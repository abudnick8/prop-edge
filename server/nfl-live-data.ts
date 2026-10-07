/**
 * Live, keyless data sources for End Zone / picks.
 *
 * Replaces hard-coded tables (defense ranks, DvP grades, red-zone shares,
 * ADP values, bye weeks, offense ranks) and Odds-API-only game lines with
 * numbers computed from the CURRENT season:
 *   - ESPN scoreboard (schedule, scores, quarter lines)          site.web.api.espn.com
 *   - Sleeper weekly stats (offense + IDP, red-zone targets)     api.sleeper.com/stats
 *   - Sleeper season projections (ADP)                           api.sleeper.com/projections
 *   - Action Network consensus/opening lines (NFL, MLB, …)       api.actionnetwork.com
 */
import axios from "axios";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
export const NFL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];
const ABBR_FIX: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" };
export const fixNflAbbr = (a: string | null | undefined) => { const x = String(a ?? "").toUpperCase(); return ABBR_FIX[x] ?? x; };

export function nflSeasonYear(d = new Date()): number {
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

type Cache<T> = { ts: number; data: T } | null;
const fresh = <T,>(c: Cache<T>, ttl: number) => !!c && Date.now() - c.ts < ttl;

// ── ESPN full regular-season schedule + results ─────────────────────────────
export interface EspnNflGame {
  id: string; week: number; date: string; completed: boolean; state: string;
  home: string; away: string; homeName: string; awayName: string;
  homeScore: number | null; awayScore: number | null;
  homeLines: number[]; awayLines: number[]; venue: string | null; indoor: boolean | null; neutral: boolean; city: string | null; country: string | null;
}
let _espnSeason: Cache<EspnNflGame[]> = null;
export async function fetchEspnNflSeason(): Promise<EspnNflGame[]> {
  if (fresh(_espnSeason, 20 * 60 * 1000)) return _espnSeason!.data;
  const yr = nflSeasonYear();
  const settled = await Promise.allSettled(Array.from({ length: 18 }, (_, i) => i + 1).map(async w => {
    const { data } = await axios.get(
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${w}&dates=${yr}&limit=100`,
      { timeout: 9000, headers: { "User-Agent": UA } });
    return { w, events: data?.events ?? [] };
  }));
  const out: EspnNflGame[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const ev of s.value.events) {
      const comp = ev.competitions?.[0]; const cs = comp?.competitors ?? [];
      const h = cs.find((c: any) => c.homeAway === "home"), a = cs.find((c: any) => c.homeAway === "away");
      if (!h || !a) continue;
      const lines = (c: any) => (c.linescores ?? []).map((l: any) => Number(l.value) || 0);
      const completed = !!ev.status?.type?.completed;
      out.push({
        id: String(ev.id), week: s.value.w, date: ev.date, completed, state: ev.status?.type?.state ?? "",
        home: fixNflAbbr(h.team?.abbreviation), away: fixNflAbbr(a.team?.abbreviation),
        homeName: h.team?.displayName ?? "", awayName: a.team?.displayName ?? "",
        homeScore: completed || ev.status?.type?.state === "in" ? Number(h.score) : null,
        awayScore: completed || ev.status?.type?.state === "in" ? Number(a.score) : null,
        homeLines: lines(h), awayLines: lines(a),
        venue: comp?.venue?.fullName ?? null, indoor: comp?.venue?.indoor ?? null,
        neutral: !!comp?.neutralSite, city: comp?.venue?.address?.city ?? null, country: comp?.venue?.address?.country ?? null,
      });
    }
  }
  if (out.length) _espnSeason = { ts: Date.now(), data: out };
  return out.length ? out : (_espnSeason?.data ?? []);
}

/** currentWeek = first week that still has an unplayed game (the week bettors care about). */
export async function getNflWeekState(): Promise<{ season: number; currentWeek: number; lastCompletedWeek: number }> {
  const games = await fetchEspnNflSeason();
  const season = nflSeasonYear();
  if (!games.length) return { season, currentWeek: 1, lastCompletedWeek: 0 };
  const weeks = Array.from(new Set(games.map(g => g.week))).sort((a, b) => a - b);
  const open = weeks.filter(w => games.some(g => g.week === w && !g.completed));
  const currentWeek = open[0] ?? 18;
  const done = weeks.filter(w => games.filter(g => g.week === w).every(g => g.completed));
  const lastCompletedWeek = done.filter(w => w < currentWeek).pop() ?? 0;
  return { season, currentWeek, lastCompletedWeek };
}

export async function getNflWeekGames(week?: number): Promise<EspnNflGame[]> {
  const games = await fetchEspnNflSeason();
  const w = week ?? (await getNflWeekState()).currentWeek;
  return games.filter(g => g.week === w).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getNflByeWeeks(): Promise<Record<number, string[]>> {
  const games = await fetchEspnNflSeason();
  const byWeek: Record<number, string[]> = {};
  const weeks = Array.from(new Set(games.map(g => g.week)));
  if (weeks.length < 14) return {};
  for (const w of weeks) {
    const playing = new Set(games.filter(g => g.week === w).flatMap(g => [g.home, g.away]));
    const bye = NFL_TEAMS.filter(t => !playing.has(t));
    if (bye.length) byWeek[w] = bye;
  }
  return byWeek;
}

/** Team points scored/allowed per game this season (completed games). Rank 1 = best. */
export async function getNflTeamScoring(): Promise<Record<string, { g: number; ppg: number; papg: number; offRank: number; defRank: number }>> {
  const games = (await fetchEspnNflSeason()).filter(g => g.completed && g.homeScore != null);
  const acc: Record<string, { g: number; pf: number; pa: number }> = {};
  for (const g of games) {
    for (const [t, pf, pa] of [[g.home, g.homeScore!, g.awayScore!], [g.away, g.awayScore!, g.homeScore!]] as [string, number, number][]) {
      const x = acc[t] ??= { g: 0, pf: 0, pa: 0 }; x.g++; x.pf += pf; x.pa += pa;
    }
  }
  const rows = Object.entries(acc).map(([t, x]) => ({ t, g: x.g, ppg: x.pf / x.g, papg: x.pa / x.g }));
  const off = [...rows].sort((a, b) => b.ppg - a.ppg).map(r => r.t);
  const def = [...rows].sort((a, b) => a.papg - b.papg).map(r => r.t);
  const out: Record<string, any> = {};
  for (const r of rows) out[r.t] = { g: r.g, ppg: +r.ppg.toFixed(1), papg: +r.papg.toFixed(1), offRank: off.indexOf(r.t) + 1, defRank: def.indexOf(r.t) + 1 };
  return out;
}

// ── Sleeper weekly stats ────────────────────────────────────────────────────
const _sleeperWeek = new Map<string, { ts: number; data: any[] }>();
export async function fetchSleeperWeek(season: number, week: number, positions: string[]): Promise<any[]> {
  const key = `${season}-${week}-${positions.join(",")}`;
  const c = _sleeperWeek.get(key);
  if (c && Date.now() - c.ts < 3 * 60 * 60 * 1000) return c.data;
  const qs = positions.map(p => `position[]=${p}`).join("&");
  const { data } = await axios.get(`https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&${qs}`,
    { timeout: 12000, headers: { "User-Agent": UA } });
  const rows = Array.isArray(data) ? data : [];
  _sleeperWeek.set(key, { ts: Date.now(), data: rows });
  return rows;
}
const pname = (r: any) => `${r.player?.first_name ?? ""} ${r.player?.last_name ?? ""}`.trim();
const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0);

// ── Defense vs Position (real, this season) ─────────────────────────────────
export type NflPos = "QB" | "RB" | "WR" | "TE";
export const NFL_POS: NflPos[] = ["QB", "RB", "WR", "TE"];
export interface DvpPos {
  rank: number; last4Rank: number; ptsPg: number; ydsPg: number; tdPg: number;
  last4PtsPg: number; homePtsPg: number | null; awayPtsPg: number | null; games: number;
  trend: "improving" | "declining" | "stable"; topScorers: string[]; keyDefenders: string[]; why: string;
}
export interface NflDvp { season: number; weeks: number[]; teams: Record<string, Record<NflPos, DvpPos>>; computedAt: string }
let _dvp: Cache<NflDvp> = null;

export async function computeNflDvp(): Promise<NflDvp | null> {
  if (fresh(_dvp, 3 * 60 * 60 * 1000)) return _dvp!.data;
  const [{ season, lastCompletedWeek }, espn] = await Promise.all([getNflWeekState(), fetchEspnNflSeason()]);
  if (lastCompletedWeek < 1) return _dvp?.data ?? null;
  const weeks = Array.from({ length: lastCompletedWeek }, (_, i) => i + 1);
  const [off, idp] = await Promise.all([
    Promise.all(weeks.map(w => fetchSleeperWeek(season, w, ["QB", "RB", "WR", "TE"]).catch(() => [] as any[]))),
    Promise.all(weeks.map(w => fetchSleeperWeek(season, w, ["DL", "LB", "DB"]).catch(() => [] as any[]))),
  ]);
  if (off.every(r => r.length === 0)) return _dvp?.data ?? null;

  const homeOf = new Map<string, boolean>(); // `${week}|${team}` -> isHome
  const played = new Map<string, Set<number>>();
  for (const g of espn) if (g.completed) {
    homeOf.set(`${g.week}|${g.home}`, true); homeOf.set(`${g.week}|${g.away}`, false);
    (played.get(g.home) ?? played.set(g.home, new Set()).get(g.home)!).add(g.week);
    (played.get(g.away) ?? played.set(g.away, new Set()).get(g.away)!).add(g.week);
  }

  // per defense, per pos, per week totals
  type Wk = { pts: number; yds: number; td: number };
  const agg: Record<string, Record<NflPos, Map<number, Wk>>> = {};
  const perf: Record<string, Record<NflPos, { name: string; team: string; pts: number; week: number }[]>> = {};
  weeks.forEach((w, i) => {
    for (const r of off[i]) {
      const pos = r.player?.position as NflPos; if (!NFL_POS.includes(pos)) continue;
      const s = r.stats ?? {}; if (!n(s.gp) && !n(s.pts_ppr)) continue;
      const def = fixNflAbbr(r.opponent); if (!def) continue;
      const pts = n(s.pts_ppr);
      const yds = pos === "QB" ? n(s.pass_yd) : pos === "RB" ? n(s.rush_yd) + n(s.rec_yd) : n(s.rec_yd);
      const td = pos === "QB" ? n(s.pass_td) : pos === "RB" ? n(s.rush_td) + n(s.rec_td) : n(s.rec_td);
      const t = ((agg[def] ??= {} as any)[pos] ??= new Map());
      const cur = t.get(w) ?? { pts: 0, yds: 0, td: 0 };
      cur.pts += pts; cur.yds += yds; cur.td += td; t.set(w, cur);
      (((perf[def] ??= {} as any)[pos] ??= [])).push({ name: pname(r), team: fixNflAbbr(r.team), pts, week: w });
    }
  });

  // key defenders per team (season totals)
  const defTot: Record<string, Map<string, any>> = {};
  weeks.forEach((w, i) => {
    for (const r of idp[i]) {
      const team = fixNflAbbr(r.team); const s = r.stats ?? {}; if (!team) continue;
      const m = (defTot[team] ??= new Map());
      const k = r.player_id; const x = m.get(k) ?? { name: pname(r), pos: r.player?.position, sack: 0, hit: 0, int: 0, pd: 0, tkl: 0, tfl: 0 };
      x.sack += n(s.idp_sack); x.hit += n(s.idp_qb_hit); x.int += n(s.idp_int); x.pd += n(s.idp_pass_def);
      x.tkl += n(s.idp_tkl); x.tfl += n(s.idp_tkl_loss); m.set(k, x);
    }
  });
  const fmt1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const keyDefs = (team: string, pos: NflPos): string[] => {
    const all = Array.from(defTot[team]?.values() ?? []);
    let scored: { s: number; label: string }[];
    if (pos === "QB") scored = all.map(x => ({ s: x.sack * 3 + x.hit * 0.6 + x.int * 3 + x.pd * 0.8, label: `${x.name} (${x.sack ? fmt1(x.sack) + " sk" : x.int ? x.int + " INT" : x.pd + " PD"})` }));
    else if (pos === "RB") scored = all.filter(x => x.pos !== "DB").map(x => ({ s: x.tkl * 0.5 + x.tfl * 2.5, label: `${x.name} (${x.tkl} tkl${x.tfl ? `, ${fmt1(x.tfl)} TFL` : ""})` }));
    else if (pos === "WR") scored = all.filter(x => x.pos === "DB" && x.pd + x.int > 0).map(x => ({ s: x.pd * 2 + x.int * 4 + x.tkl * 0.1, label: `${x.name} (${x.pd} PD${x.int ? `, ${x.int} INT` : ""})` }));
    else scored = all.filter(x => (x.pos === "LB" || x.pos === "DB") && x.pd + x.int > 0).map(x => ({ s: (x.pos === "LB" ? 1.3 : 1) * (x.pd * 2 + x.int * 4) + x.tkl * 0.15, label: `${x.name} (${x.pd} PD, ${x.tkl} tkl)` }));
    return scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2).map(x => x.label);
  };

  const teams: Record<string, Record<NflPos, DvpPos>> = {};
  const raw: Record<NflPos, { t: string; ptsPg: number; l4: number }[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const t of NFL_TEAMS) {
    const gw = Array.from(played.get(t) ?? []).filter(w => w <= lastCompletedWeek).sort((a, b) => a - b);
    if (!gw.length) continue;
    teams[t] = {} as any;
    for (const pos of NFL_POS) {
      const m = agg[t]?.[pos] ?? new Map<number, Wk>();
      const rows = gw.map(w => ({ w, ...(m.get(w) ?? { pts: 0, yds: 0, td: 0 }), home: homeOf.get(`${w}|${t}`) }));
      const avg = (xs: typeof rows, k: "pts" | "yds" | "td") => xs.length ? xs.reduce((s, x) => s + x[k], 0) / xs.length : 0;
      const l4 = rows.slice(-4), l3 = rows.slice(-3);
      const hm = rows.filter(r => r.home === true), aw = rows.filter(r => r.home === false);
      const ptsPg = avg(rows, "pts");
      const l3p = avg(l3, "pts");
      const trend: DvpPos["trend"] = rows.length >= 4 ? (l3p > ptsPg * 1.15 ? "declining" : l3p < ptsPg * 0.85 ? "improving" : "stable") : "stable";
      const top = (perf[t]?.[pos] ?? []).sort((a, b) => b.pts - a.pts).slice(0, 2).map(p => `${p.name} ${p.pts.toFixed(1)} (Wk ${p.week})`);
      teams[t][pos] = {
        rank: 0, last4Rank: 0, ptsPg: +ptsPg.toFixed(1), ydsPg: Math.round(avg(rows, "yds")), tdPg: +avg(rows, "td").toFixed(2),
        last4PtsPg: +avg(l4, "pts").toFixed(1), homePtsPg: hm.length ? +avg(hm, "pts").toFixed(1) : null, awayPtsPg: aw.length ? +avg(aw, "pts").toFixed(1) : null,
        games: rows.length, trend, topScorers: top, keyDefenders: keyDefs(t, pos), why: "",
      };
      raw[pos].push({ t, ptsPg, l4: avg(l4, "pts") });
    }
  }
  for (const pos of NFL_POS) {
    const byS = [...raw[pos]].sort((a, b) => a.ptsPg - b.ptsPg);
    const byL = [...raw[pos]].sort((a, b) => a.l4 - b.l4);
    byS.forEach((r, i) => { teams[r.t][pos].rank = i + 1; });
    byL.forEach((r, i) => { teams[r.t][pos].last4Rank = i + 1; });
    const N = byS.length;
    for (const r of byS) {
      const d = teams[r.t][pos];
      const ydLbl = pos === "QB" ? "pass yds" : pos === "RB" ? "scrimmage yds" : "rec yds";
      const tier = d.rank <= 8 ? "one of the stingiest" : d.rank <= 16 ? "an above-average" : d.rank <= 24 ? "a below-average" : "one of the most generous";
      d.why = `${r.t} is ${tier} defenses vs ${pos}s: ${d.ptsPg} PPR pts, ${d.ydsPg} ${ydLbl} and ${d.tdPg} TDs allowed per game (#${d.rank} of ${N}, 1 = fewest) over ${d.games} games.`
        + ` Last 4: ${d.last4PtsPg} pts/gm (#${d.last4Rank}).` + (d.topScorers[0] ? ` Biggest game allowed: ${d.topScorers[0]}.` : "");
    }
  }
  const data: NflDvp = { season, weeks, teams, computedAt: new Date().toISOString() };
  _dvp = { ts: Date.now(), data };
  return data;
}

// ── Red zone usage (real, this season) ──────────────────────────────────────
export async function computeNflRedZone(limit = 40) {
  const { season, lastCompletedWeek } = await getNflWeekState();
  if (lastCompletedWeek < 1) return [];
  const weeks = Array.from({ length: lastCompletedWeek }, (_, i) => i + 1);
  const all = await Promise.all(weeks.map(w => fetchSleeperWeek(season, w, ["QB", "RB", "WR", "TE"]).catch(() => [] as any[])));
  const teamWk = new Map<string, { rz: number; tgt: number }>();
  const pl = new Map<string, any>();
  weeks.forEach((w, i) => {
    for (const r of all[i]) {
      const s = r.stats ?? {}; const team = fixNflAbbr(r.team); if (!team) continue;
      const k = `${team}|${w}`; const tw = teamWk.get(k) ?? { rz: 0, tgt: 0 };
      tw.rz += n(s.rec_rz_tgt); tw.tgt += n(s.rec_tgt); teamWk.set(k, tw);
      const pos = r.player?.position; if (!["RB", "WR", "TE"].includes(pos) || !n(s.gp)) continue;
      const p = pl.get(r.player_id) ?? { name: pname(r), pos, team, gp: 0, rz: 0, rzRush: 0, tgt: 0, td: 0, wk: [] as string[] };
      p.gp += n(s.gp); p.rz += n(s.rec_rz_tgt); p.rzRush += n(s.rush_rz_att); p.tgt += n(s.rec_tgt);
      p.td += n(s.rec_td) + n(s.rush_td); p.team = team; p.wk.push(k); pl.set(r.player_id, p);
    }
  });
  const rows = Array.from(pl.values()).filter(p => p.gp >= 2 && (p.rz + p.rzRush) > 0).map(p => {
    const tRz = p.wk.reduce((s: number, k: string) => s + (teamWk.get(k)?.rz ?? 0), 0);
    const tTg = p.wk.reduce((s: number, k: string) => s + (teamWk.get(k)?.tgt ?? 0), 0);
    const rzShare = tRz ? Math.round((p.rz / tRz) * 100) : 0;
    const tgtShare = tTg ? Math.round((p.tgt / tTg) * 100) : 0;
    const rzPg = +(p.rz / p.gp).toFixed(1), tdPg = +(p.td / p.gp).toFixed(2);
    const note = `${p.rz} red-zone targets${p.rzRush ? ` + ${p.rzRush} red-zone carries` : ""} and ${p.td} TDs in ${p.gp} games this season — ${rzShare}% of ${p.team}'s red-zone targets, ${tgtShare}% of all targets.`;
    return { playerName: p.name, position: p.pos, team: p.team, rzTargetShare: rzShare, rzTargetsPerGame: rzPg,
      rzCarriesPerGame: +(p.rzRush / p.gp).toFixed(1), tdsPerGame: tdPg, overallTargetPct: tgtShare, games: p.gp, note,
      _score: p.rz / p.gp + 0.35 * (p.rzRush / p.gp) };
  });
  rows.sort((a, b) => b._score - a._score);
  return rows.slice(0, limit).map(({ _score, ...r }) => r);
}

// ── ADP vs actual production (Sleeper ADP, this season's PPR points) ────────
export async function computeNflAdpValue(limit = 30) {
  const { season, lastCompletedWeek } = await getNflWeekState();
  const positions = ["QB", "RB", "WR", "TE"];
  const { data } = await axios.get(`https://api.sleeper.com/projections/nfl/${season}?season_type=regular&${positions.map(p => `position[]=${p}`).join("&")}`,
    { timeout: 15000, headers: { "User-Agent": UA } });
  const adp = (Array.isArray(data) ? data : []).filter((r: any) => n(r.stats?.adp_ppr) > 0 && n(r.stats?.adp_ppr) < 300)
    .sort((a: any, b: any) => a.stats.adp_ppr - b.stats.adp_ppr);
  if (!adp.length || lastCompletedWeek < 1) return { players: [], weeks: lastCompletedWeek };
  const weeks = Array.from({ length: lastCompletedWeek }, (_, i) => i + 1);
  const all = await Promise.all(weeks.map(w => fetchSleeperWeek(season, w, positions).catch(() => [] as any[])));
  const prod = new Map<string, { pts: number; gp: number; team: string }>();
  weeks.forEach((_, i) => { for (const r of all[i]) { const s = r.stats ?? {}; if (!n(s.gp)) continue;
    const x = prod.get(r.player_id) ?? { pts: 0, gp: 0, team: fixNflAbbr(r.team) }; x.pts += n(s.pts_ppr); x.gp += n(s.gp); x.team = fixNflAbbr(r.team); prod.set(r.player_id, x); } });
  // Compare within position: ADP rank at the position vs. PPR-per-game rank at the position.
  const POS_DEPTH: Record<string, number> = { QB: 30, RB: 60, WR: 72, TE: 24 };
  const out: any[] = [];
  for (const pos of positions) {
    const pool = adp.filter((r: any) => r.player?.position === pos).slice(0, POS_DEPTH[pos])
      .map((r: any, i: number) => ({ r, adpRank: i + 1, p: prod.get(r.player_id) }))
      .filter((x: any) => x.p && x.p.gp >= Math.min(2, lastCompletedWeek));
    const ranked = [...pool].sort((a: any, b: any) => b.p.pts / b.p.gp - a.p.pts / a.p.gp);
    ranked.forEach((x: any, i: number) => { x.prodRank = i + 1; });
    for (const x of ranked as any[]) {
      const ppg = +(x.p.pts / x.p.gp).toFixed(1); const diff = x.adpRank - x.prodRank;
      out.push({ playerName: pname(x.r), position: pos, team: x.p.team, adpRank: x.adpRank, consensusRank: x.prodRank,
        seasonRank: x.prodRank, pprPerGame: ppg, games: x.p.gp, valueDiff: diff,
        note: diff >= 0
          ? `Drafted as ${pos}${x.adpRank}, producing as ${pos}${x.prodRank} (${ppg} PPR pts/gm over ${x.p.gp} games) — ${diff} spots better than ADP`
          : `Drafted as ${pos}${x.adpRank}, producing as ${pos}${x.prodRank} (${ppg} PPR pts/gm over ${x.p.gp} games) — ${-diff} spots below ADP` });
    }
  }
  const risers = out.filter(o => o.valueDiff >= 5).sort((a, b) => b.valueDiff - a.valueDiff).slice(0, Math.ceil(limit * 0.7));
  const fallers = out.filter(o => o.valueDiff <= -5 && o.adpRank <= 15).sort((a, b) => a.valueDiff - b.valueDiff).slice(0, Math.floor(limit * 0.3));
  return { players: [...risers, ...fallers], weeks: lastCompletedWeek };
}

// ── Action Network boards (any league) ──────────────────────────────────────
export interface AnSide { spreadHome: number | null; total: number | null; mlHome: number | null; mlAway: number | null;
  spreadHomeOdds: number | null; spreadAwayOdds: number | null; overOdds: number | null; underOdds: number | null;
  spreadHomeTickets: number | null; spreadHomeMoney: number | null; spreadAwayTickets: number | null; spreadAwayMoney: number | null;
  overTickets: number | null; overMoney: number | null; underTickets: number | null; underMoney: number | null;
  mlHomeTickets: number | null; mlHomeMoney: number | null; mlAwayTickets: number | null; mlAwayMoney: number | null; }
export interface AnGame { id: number; league: string; away: string; home: string; awayName: string; homeName: string;
  start: string; status: string; week: number | null; cur: AnSide; open: AnSide; h1Cur: AnSide; h1Open: AnSide; }
const _anBoards = new Map<string, { ts: number; data: AnGame[] }>();

function readAnSide(markets: any, book: string, period: string): AnSide {
  const m = markets?.[book]?.[period] ?? {};
  // Pregame main line only — Action Network also returns live (in-game) and alt lines.
  const pick = (typ: string, sd: string) => {
    const xs = (m[typ] ?? []).filter((o: any) => o.side === sd && !o.is_alt_market);
    return xs.find((o: any) => !o.is_live) ?? null;
  };
  const pct = (o: any, k: "tickets" | "money") => { const v = o?.bet_info?.[k]?.percent; return typeof v === "number" ? v : null; };
  const sh = pick("spread", "home"), sa = pick("spread", "away"), to = pick("total", "over"), tu = pick("total", "under");
  const mh = pick("moneyline", "home"), ma = pick("moneyline", "away");
  return {
    spreadHome: sh?.value ?? (sa?.value != null ? -sa.value : null), total: to?.value ?? tu?.value ?? null,
    mlHome: mh?.odds ?? null, mlAway: ma?.odds ?? null,
    spreadHomeOdds: sh?.odds ?? null, spreadAwayOdds: sa?.odds ?? null, overOdds: to?.odds ?? null, underOdds: tu?.odds ?? null,
    spreadHomeTickets: pct(sh, "tickets"), spreadHomeMoney: pct(sh, "money"), spreadAwayTickets: pct(sa, "tickets"), spreadAwayMoney: pct(sa, "money"),
    overTickets: pct(to, "tickets"), overMoney: pct(to, "money"), underTickets: pct(tu, "tickets"), underMoney: pct(tu, "money"),
    mlHomeTickets: pct(mh, "tickets"), mlHomeMoney: pct(mh, "money"), mlAwayTickets: pct(ma, "tickets"), mlAwayMoney: pct(ma, "money"),
  };
}

/** league: nfl | mlb | nba | nhl | ncaaf | ncaab. date: YYYYMMDD (optional; NFL returns the whole week). */
export async function fetchActionNetworkBoard(league: string, opts: { date?: string; includeFinal?: boolean } = {}): Promise<AnGame[]> {
  const key = `${league}|${opts.date ?? ""}|${opts.includeFinal ? 1 : 0}`;
  const c = _anBoards.get(key);
  if (c && Date.now() - c.ts < 3 * 60 * 1000) return c.data;
  const periods = league === "nfl" || league === "ncaaf" ? "event,firsthalf" : "event";
  const url = `https://api.actionnetwork.com/web/v2/scoreboard/${league}?bookIds=15,30&periods=${periods}${opts.date ? `&date=${opts.date}` : ""}`;
  const { data } = await axios.get(url, { timeout: 10000, headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.actionnetwork.com/" } });
  const out: AnGame[] = [];
  for (const g of (data?.games ?? [])) {
    const status = String(g.status ?? "").toLowerCase();
    if (!opts.includeFinal && ["complete", "closed", "final", "cancelled", "postponed"].includes(status)) continue;
    const byId: Record<number, any> = {}; for (const t of (g.teams ?? [])) byId[t.id] = t;
    const ab = (id: number) => { const a = byId[id]?.abbr ?? ""; return league === "nfl" ? fixNflAbbr(a) : a; };
    out.push({ id: g.id, league, away: ab(g.away_team_id), home: ab(g.home_team_id),
      awayName: byId[g.away_team_id]?.full_name ?? "", homeName: byId[g.home_team_id]?.full_name ?? "",
      start: g.start_time, status, week: g.week ?? null,
      cur: readAnSide(g.markets, "15", "event"), open: readAnSide(g.markets, "30", "event"),
      h1Cur: readAnSide(g.markets, "15", "firsthalf"), h1Open: readAnSide(g.markets, "30", "firsthalf") });
  }
  out.sort((x, y) => String(x.start).localeCompare(String(y.start)));
  _anBoards.set(key, { ts: Date.now(), data: out });
  return out;
}

/** Action Network games in The Odds API v4 response shape, so legacy code paths can consume them unchanged. */
export async function actionNetworkAsOddsApi(league: string, opts: { date?: string } = {}): Promise<any[]> {
  const games = await fetchActionNetworkBoard(league, opts);
  return games.filter(g => g.cur.mlHome != null || g.cur.spreadHome != null || g.cur.total != null).map(g => ({
    id: `an-${g.id}`, sport_key: league, commence_time: g.start, home_team: g.homeName, away_team: g.awayName,
    lineSource: "Action Network consensus",
    bookmakers: [{
      key: "consensus", title: "Consensus (Action Network)", last_update: new Date().toISOString(),
      markets: [
        { key: "h2h", outcomes: [{ name: g.homeName, price: g.cur.mlHome }, { name: g.awayName, price: g.cur.mlAway }].filter(o => o.price != null) },
        { key: "spreads", outcomes: g.cur.spreadHome == null ? [] : [
          { name: g.homeName, point: g.cur.spreadHome, price: g.cur.spreadHomeOdds ?? -110 },
          { name: g.awayName, point: -g.cur.spreadHome, price: g.cur.spreadAwayOdds ?? -110 }] },
        { key: "totals", outcomes: g.cur.total == null ? [] : [
          { name: "Over", point: g.cur.total, price: g.cur.overOdds ?? -110 },
          { name: "Under", point: g.cur.total, price: g.cur.underOdds ?? -110 }] },
      ].filter(m => m.outcomes.length),
    }],
  }));
}
