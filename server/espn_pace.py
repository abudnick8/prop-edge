"""
NFL / NCAAB pace data via the ESPN team statistics endpoint.

Mirrors services.nhl_pace in spirit: pull a real tempo number from a free
public endpoint, cache it, hand it back as pace_L5 so the existing
score_pace_matchup engine variable can grade fast vs grind matchups.

For football we extract `totalOffensivePlays` and divide by games played
to get plays/game (the canonical NFL pace proxy). For basketball we use
`fieldGoalsAttempted + freeThrowsAttempted` per game as a possessions
proxy — not as clean as KenPom's tempo metric but free and directional.

Both are cached per (sport, team_id) for an hour. ESPN's team statistics
endpoint is rate-friendly so we don't bother with a single-bulk-pull
strategy like NHL — football and college basketball each have only the
teams that show up on a given slate to look up.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

logger = logging.getLogger("edge-crew-v3.espn_pace")

ESPN_TEAM_STATS = "https://site.api.espn.com/apis/site/v2/sports/{sport_path}/{league}/teams/{team_id}/statistics"

# (sport, league) tuples — ESPN URL fragments
SPORT_PATH = {
    "NFL":   ("football",   "nfl"),
    "NCAAF": ("football",   "college-football"),
    "NCAAB": ("basketball", "mens-college-basketball"),
}

_CACHE_TTL = 3600
_cache: dict = {}  # {(sport, team_id): (fetched_at, dict)}


def _extract_stat(stats: list, target_names: tuple) -> Optional[float]:
    """Walk ESPN's nested stat blocks and return the first matching stat value."""
    for cat in stats or []:
        for s in cat.get("stats", []) or []:
            name = (s.get("name") or "").lower()
            if name in target_names:
                val = s.get("value")
                try:
                    return float(val) if val is not None else None
                except (TypeError, ValueError):
                    return None
    return None


async def get_team_pace(team_id: str, sport: str) -> Optional[dict]:
    """Return {pace_L5, plays_per_game, games_played} or None on miss/fail.

    pace_L5 here is plays/game for football, possessions-proxy for
    basketball. The grade engine doesn't care about the unit as long as
    higher = faster, which holds for both.
    """
    if not team_id or sport not in SPORT_PATH:
        return None
    if httpx is None:
        return None

    key = (sport, str(team_id))
    cached = _cache.get(key)
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL:
        return cached[1]

    sport_path, league = SPORT_PATH[sport]
    url = ESPN_TEAM_STATS.format(sport_path=sport_path, league=league, team_id=team_id)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
        if r.status_code != 200:
            logger.debug(f"ESPN stats {sport}/{team_id} HTTP {r.status_code}")
            return None
        data = r.json() or {}
    except Exception as e:
        logger.debug(f"ESPN stats {sport}/{team_id} fetch failed: {e}")
        return None

    # ESPN returns {results: {stats: {categories: [...]}}} or similar — be liberal
    results = data.get("results") or {}
    stats_root = results.get("stats") or data.get("stats") or {}
    categories = stats_root.get("categories") or stats_root.get("splits") or []
    if not categories and "splits" in data:
        categories = data["splits"].get("categories") or []

    # Games played — usually under "general" or as a top-level "gamesPlayed" stat
    gp = _extract_stat(categories, ("gamesplayed", "games"))

    pace_per_game = None
    if sport in ("NFL", "NCAAF"):
        # Try totalOffensivePlays first; fall back to plays
        total_plays = _extract_stat(categories, ("totaloffensiveplays", "offensiveplays", "plays"))
        if total_plays and gp and gp > 0:
            pace_per_game = round(total_plays / gp, 1)
        else:
            # ESPN sometimes serves a per-game variant directly
            pace_per_game = _extract_stat(categories, ("offensiveplayspergame", "playspergame"))
    elif sport == "NCAAB":
        # Possessions proxy: FGA + 0.44*FTA per game (approximation)
        fga = _extract_stat(categories, ("fieldgoalsattempted",))
        fta = _extract_stat(categories, ("freethrowsattempted",))
        if fga and gp and gp > 0:
            base = fga + 0.44 * (fta or 0)
            pace_per_game = round(base / gp, 1)

    if pace_per_game is None:
        _cache[key] = (time.monotonic(), None)
        return None

    out = {
        "pace_L5": pace_per_game,
        "plays_per_game": pace_per_game,
        "games_played": int(gp) if gp else None,
    }
    _cache[key] = (time.monotonic(), out)
    return out
