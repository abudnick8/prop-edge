"""
NHL real pace data via the official NHL Stats API.

Replaces the previous "no pace data → neutral 5.0" path for hockey with
real shots-for + shots-against per game from api.nhle.com. The combined
shots/60 number is the closest hockey analogue to NBA's pace_L5
(possessions/game) and lets the grade engine actually score
high-pace vs grind matchups for NHL.

Single bulk fetch per session — the league summary endpoint returns all
32 teams in one ~50KB response, so we cache it and serve every team
lookup from memory after the first call.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

logger = logging.getLogger("edge-crew-v3.nhl_pace")

# Stats API summary endpoint — public, no auth, no rate limit headers seen.
NHL_SUMMARY_URL = "https://api.nhle.com/stats/rest/en/team/summary"

# Cache the league-wide summary for an hour. Team pace doesn't change
# game-to-game by enough to matter, and we don't want to spam the API
# from the prewarm crons.
_CACHE_TTL = 3600
_cache: dict = {"fetched_at": 0.0, "by_team": {}}

# Map ESPN/Odds API team display names to NHL Stats API "teamFullName"
# values so the lookup can take whatever the rest of the app uses.
NAME_MAP: dict[str, str] = {
    "Anaheim Ducks": "Anaheim Ducks",
    "Arizona Coyotes": "Arizona Coyotes",
    "Utah Hockey Club": "Utah Hockey Club",
    "Boston Bruins": "Boston Bruins",
    "Buffalo Sabres": "Buffalo Sabres",
    "Calgary Flames": "Calgary Flames",
    "Carolina Hurricanes": "Carolina Hurricanes",
    "Chicago Blackhawks": "Chicago Blackhawks",
    "Colorado Avalanche": "Colorado Avalanche",
    "Columbus Blue Jackets": "Columbus Blue Jackets",
    "Dallas Stars": "Dallas Stars",
    "Detroit Red Wings": "Detroit Red Wings",
    "Edmonton Oilers": "Edmonton Oilers",
    "Florida Panthers": "Florida Panthers",
    "Los Angeles Kings": "Los Angeles Kings",
    "Minnesota Wild": "Minnesota Wild",
    "Montreal Canadiens": "Montréal Canadiens",
    "Montréal Canadiens": "Montréal Canadiens",
    "Nashville Predators": "Nashville Predators",
    "New Jersey Devils": "New Jersey Devils",
    "New York Islanders": "New York Islanders",
    "New York Rangers": "New York Rangers",
    "Ottawa Senators": "Ottawa Senators",
    "Philadelphia Flyers": "Philadelphia Flyers",
    "Pittsburgh Penguins": "Pittsburgh Penguins",
    "San Jose Sharks": "San Jose Sharks",
    "Seattle Kraken": "Seattle Kraken",
    "St. Louis Blues": "St. Louis Blues",
    "St Louis Blues": "St. Louis Blues",
    "Tampa Bay Lightning": "Tampa Bay Lightning",
    "Toronto Maple Leafs": "Toronto Maple Leafs",
    "Vancouver Canucks": "Vancouver Canucks",
    "Vegas Golden Knights": "Vegas Golden Knights",
    "Washington Capitals": "Washington Capitals",
    "Winnipeg Jets": "Winnipeg Jets",
}


async def _refresh_cache() -> None:
    """Pull the current-season summary for all teams in one request."""
    global _cache
    if httpx is None:
        return
    try:
        params = {
            "isAggregate": "false",
            "isGame": "false",
            "sort": '[{"property":"points","direction":"DESC"}]',
            "start": 0,
            "limit": 50,
            "factCayenneExp": "gamesPlayed>=1",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(NHL_SUMMARY_URL, params=params)
        if r.status_code != 200:
            logger.debug(f"NHL summary HTTP {r.status_code}")
            return
        data = r.json() or {}
        rows = data.get("data") or []
        by_team: dict[str, dict] = {}
        for row in rows:
            name = row.get("teamFullName") or ""
            if not name:
                continue
            gp = row.get("gamesPlayed") or 0
            sf = row.get("shotsForPerGame")
            sa = row.get("shotsAgainstPerGame")
            gf = row.get("goalsForPerGame")
            ga = row.get("goalsAgainstPerGame")
            by_team[name] = {
                "games_played": gp,
                "shots_for_per_game": float(sf) if sf is not None else None,
                "shots_against_per_game": float(sa) if sa is not None else None,
                "goals_for_per_game": float(gf) if gf is not None else None,
                "goals_against_per_game": float(ga) if ga is not None else None,
            }
        _cache = {"fetched_at": time.monotonic(), "by_team": by_team}
        logger.info(f"[NHL_PACE] cached pace for {len(by_team)} teams")
    except Exception as e:
        logger.debug(f"[NHL_PACE] refresh failed: {e}")


async def get_team_pace(team_name: str) -> Optional[dict]:
    """Return {pace_L5, shots_for_per_game, shots_against_per_game, goals_*}
    for a team, or None if unknown / fetch failed.

    `pace_L5` here is shots_for + shots_against per game (combined shot
    rate), which is the cleanest single-number hockey analogue to NBA
    pace_L5 (possessions/game). Modern NHL average is ~60 combined shots
    per game; high-pace teams are 65+, grind teams are <55.
    """
    age = time.monotonic() - _cache["fetched_at"]
    if not _cache["by_team"] or age > _CACHE_TTL:
        await _refresh_cache()
    if not _cache["by_team"]:
        return None

    canonical = NAME_MAP.get(team_name, team_name)
    row = _cache["by_team"].get(canonical)
    if row is None:
        return None

    sf = row.get("shots_for_per_game")
    sa = row.get("shots_against_per_game")
    pace = None
    if sf is not None and sa is not None:
        pace = round(sf + sa, 1)

    return {
        "pace_L5": pace,
        "shots_for_per_game": sf,
        "shots_against_per_game": sa,
        "goals_for_per_game": row.get("goals_for_per_game"),
        "goals_against_per_game": row.get("goals_against_per_game"),
        "games_played": row.get("games_played"),
    }
