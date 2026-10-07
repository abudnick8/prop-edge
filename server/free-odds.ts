/**
 * Free, keyless replacement for The Odds API.
 *
 * Source: Action Network public scoreboard (api.actionnetwork.com/web/v2/scoreboard),
 * which carries real per-sportsbook lines (DraftKings, FanDuel, BetMGM, Caesars,
 * BetRivers, bet365) plus a cross-book consensus and the opening line.
 *
 * Output matches The Odds API v4 `/sports/{sport}/odds` response shape, so existing
 * parsers (bookmakers → markets → outcomes) work unchanged.
 */
import axios from "axios";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "application/json", Referer: "https://www.actionnetwork.com/" };

/** Action Network book id → Odds API bookmaker key/title. */
export const FREE_ODDS_BOOKS: Record<number, { key: string; title: string }> = {
  68: { key: "draftkings", title: "DraftKings" },
  69: { key: "fanduel", title: "FanDuel" },
  75: { key: "betmgm", title: "BetMGM" },
  123: { key: "williamhill_us", title: "Caesars" },
  71: { key: "betrivers", title: "BetRivers" },
  79: { key: "bet365", title: "bet365" },
  15: { key: "consensus", title: "Consensus" },
};
const KEY_TO_BOOK: Record<string, number> = Object.fromEntries(Object.entries(FREE_ODDS_BOOKS).map(([id, b]) => [b.key, Number(id)]));

/** Odds API sport keys (and short names) → Action Network league slugs. */
const SPORT_TO_AN: Record<string, string> = {
  americanfootball_nfl: "nfl", americanfootball_ncaaf: "ncaaf",
  basketball_nba: "nba", basketball_ncaab: "ncaab", basketball_wnba: "wnba",
  baseball_mlb: "mlb", baseball_mlb_preseason: "mlb", icehockey_nhl: "nhl",
  nfl: "nfl", ncaaf: "ncaaf", nba: "nba", ncaab: "ncaab", wnba: "wnba", mlb: "mlb", nhl: "nhl",
};
const WEEKLY = new Set(["nfl", "ncaaf"]);
const ANSWER_KEY: Record<string, string> = { nfl: "americanfootball_nfl", ncaaf: "americanfootball_ncaaf", nba: "basketball_nba",
  ncaab: "basketball_ncaab", wnba: "basketball_wnba", mlb: "baseball_mlb", nhl: "icehockey_nhl" };

export function freeOddsSupports(sport: string): boolean { return !!SPORT_TO_AN[sport.toLowerCase()]; }

const _cache = new Map<string, { ts: number; data: any[] }>();
const TTL = 3 * 60 * 1000;
let _lastOk: { ts: number; games: number } | null = null;
let _lastErr: { ts: number; error: string } | null = null;
export function freeOddsStatus() { return { source: "Action Network (free, no key)", lastOk: _lastOk, lastError: _lastErr }; }

function ctDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const s = d.toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const [m, dd, y] = s.split("/");
  return `${y}${m}${dd}`;
}

async function fetchBoard(league: string, bookIds: number[], date?: string): Promise<any[]> {
  const url = `https://api.actionnetwork.com/web/v2/scoreboard/${league}?bookIds=${bookIds.join(",")}&periods=event${date ? `&date=${date}` : ""}`;
  const key = url;
  const c = _cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.data;
  const { data } = await axios.get(url, { timeout: 12000, headers: HEADERS });
  const games = Array.isArray(data?.games) ? data.games : [];
  _cache.set(key, { ts: Date.now(), data: games });
  return games;
}

function mainLine(list: any[] | undefined, side: string): any | null {
  const xs = (list ?? []).filter((o: any) => o.side === side && !o.is_alt_market);
  return xs.find((o: any) => !o.is_live) ?? null;
}

/**
 * Upcoming games with per-book h2h / spreads / totals in Odds API v4 shape.
 * @param sport Odds API sport key (e.g. "baseball_mlb") or short name ("mlb").
 * @param opts.bookmakers Odds API bookmaker keys to include (default: DK, FD, BetMGM, Caesars).
 * @param opts.date YYYY-MM-DD or YYYYMMDD; default = today + tomorrow (daily sports) / this week (NFL/NCAAF).
 * @param opts.includeStarted include games already in progress (pregame lines only).
 */
export async function fetchFreeOdds(sport: string, opts: { bookmakers?: string[]; date?: string; includeStarted?: boolean } = {}): Promise<any[]> {
  const league = SPORT_TO_AN[sport.toLowerCase()];
  if (!league) return [];
  const wanted = (opts.bookmakers?.length ? opts.bookmakers : ["draftkings", "fanduel", "betmgm", "williamhill_us"])
    .map(k => KEY_TO_BOOK[k]).filter((x): x is number => x != null);
  if (!wanted.length) wanted.push(68, 69);
  const ids = Array.from(new Set([...wanted, 15]));
  const dates = opts.date ? [opts.date.replace(/-/g, "")] : WEEKLY.has(league) ? [undefined] : [ctDate(0), ctDate(1)];
  try {
    const raw: any[] = [];
    for (const d of dates) raw.push(...await fetchBoard(league, ids, d));
    const seen = new Set<number>();
    const out: any[] = [];
    for (const g of raw) {
      if (seen.has(g.id)) continue; seen.add(g.id);
      const status = String(g.status ?? "").toLowerCase();
      if (["complete", "closed", "final", "cancelled", "postponed"].includes(status)) continue;
      if (!opts.includeStarted && status !== "scheduled" && new Date(g.start_time).getTime() < Date.now()) continue;
      const byId: Record<number, any> = {}; for (const t of (g.teams ?? [])) byId[t.id] = t;
      const home = byId[g.home_team_id]?.full_name ?? "", away = byId[g.away_team_id]?.full_name ?? "";
      if (!home || !away) continue;
      const bookmakers: any[] = [];
      for (const id of wanted.length ? wanted : ids) {
        const ev = g.markets?.[String(id)]?.event; if (!ev) continue;
        const mh = mainLine(ev.moneyline, "home"), ma = mainLine(ev.moneyline, "away");
        const sh = mainLine(ev.spread, "home"), sa = mainLine(ev.spread, "away");
        const to = mainLine(ev.total, "over"), tu = mainLine(ev.total, "under");
        const markets: any[] = [];
        if (mh?.odds != null && ma?.odds != null) markets.push({ key: "h2h", outcomes: [{ name: home, price: mh.odds }, { name: away, price: ma.odds }] });
        if (sh?.value != null && sa?.value != null) markets.push({ key: "spreads", outcomes: [{ name: home, point: sh.value, price: sh.odds ?? -110 }, { name: away, point: sa.value, price: sa.odds ?? -110 }] });
        if (to?.value != null && tu?.value != null) markets.push({ key: "totals", outcomes: [{ name: "Over", point: to.value, price: to.odds ?? -110 }, { name: "Under", point: tu.value, price: tu.odds ?? -110 }] });
        if (!markets.length) continue;
        const b = FREE_ODDS_BOOKS[id];
        bookmakers.push({ key: b.key, title: b.title, last_update: new Date().toISOString(), markets });
      }
      // No individual book posted yet → fall back to the cross-book consensus line.
      if (!bookmakers.length) {
        const ev = g.markets?.["15"]?.event;
        if (ev) {
          const mh = mainLine(ev.moneyline, "home"), ma = mainLine(ev.moneyline, "away");
          const sh = mainLine(ev.spread, "home"), sa = mainLine(ev.spread, "away");
          const to = mainLine(ev.total, "over"), tu = mainLine(ev.total, "under");
          const markets: any[] = [];
          if (mh?.odds != null && ma?.odds != null) markets.push({ key: "h2h", outcomes: [{ name: home, price: mh.odds }, { name: away, price: ma.odds }] });
          if (sh?.value != null && sa?.value != null) markets.push({ key: "spreads", outcomes: [{ name: home, point: sh.value, price: sh.odds ?? -110 }, { name: away, point: sa.value, price: sa.odds ?? -110 }] });
          if (to?.value != null && tu?.value != null) markets.push({ key: "totals", outcomes: [{ name: "Over", point: to.value, price: to.odds ?? -110 }, { name: "Under", point: tu.value, price: tu.odds ?? -110 }] });
          if (markets.length) bookmakers.push({ key: "consensus", title: "Consensus", last_update: new Date().toISOString(), markets });
        }
      }
      if (!bookmakers.length) continue;
      out.push({ id: `an-${g.id}`, sport_key: ANSWER_KEY[league] ?? league, sport_title: league.toUpperCase(),
        commence_time: g.start_time, home_team: home, away_team: away, lineSource: "Action Network", bookmakers });
    }
    out.sort((a, b) => String(a.commence_time).localeCompare(String(b.commence_time)));
    _lastOk = { ts: Date.now(), games: out.length };
    return out;
  } catch (e: any) {
    _lastErr = { ts: Date.now(), error: e.message };
    console.warn(`[FreeOdds] ${league} failed:`, e.message);
    return [];
  }
}
