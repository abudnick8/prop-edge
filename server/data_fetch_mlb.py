"""MLB-specific data fetcher backed by the official MLB Stats API
(toddrob99/MLB-StatsAPI). This is the authoritative source for everything
MLB — probable pitchers (with real names + ERA + WHIP + K/9), starting
lineups, bullpen usage, weather, plate umpire, and team gamelogs.

The existing ESPN MLB path in `data_fetch.py` stays alive as a fallback —
if StatsAPI raises (network, library install issue, schedule miss), we
return None and the caller falls through to ESPN.

Sync library wrapped in `asyncio.to_thread` so the async pipeline stays
non-blocking.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# Cache: {game_pk: {"data": {...}, "_ts": datetime}}
_mlb_game_cache: dict = {}
_MLB_CACHE_TTL = 300  # 5 minutes


def _statsapi_available() -> bool:
    try:
        import statsapi  # noqa: F401
        return True
    except ImportError:
        return False


def _normalize_team_name(name: str) -> str:
    """Strip city, lowercase last word for fuzzy match against StatsAPI."""
    if not name:
        return ""
    return name.strip().lower()


def _team_name_match(stats_name: str, our_name: str) -> bool:
    """Loose match: 'Houston Astros' should match 'Astros' or 'Houston'."""
    a = _normalize_team_name(stats_name)
    b = _normalize_team_name(our_name)
    if not a or not b:
        return False
    if a == b:
        return True
    a_parts = set(a.split())
    b_parts = set(b.split())
    return bool(a_parts & b_parts)


def _extract_pitcher_stats(player_id: int) -> dict:
    """Pull current-season pitching stats for a player. Returns era/whip/k9/bb9
    when available, empty dict on any failure."""
    import statsapi
    out: dict = {}
    try:
        stats = statsapi.player_stat_data(player_id, group="pitching", type="season")
        for season_stat in stats.get("stats", []):
            if season_stat.get("type", {}).get("displayName") == "season":
                s = season_stat.get("stats", {}) or {}
                if s.get("era") is not None:
                    try:
                        out["era"] = float(s["era"])
                    except (ValueError, TypeError):
                        pass
                if s.get("whip") is not None:
                    try:
                        out["whip"] = float(s["whip"])
                    except (ValueError, TypeError):
                        pass
                if s.get("strikeoutsPer9Inn") is not None:
                    try:
                        out["k9"] = float(s["strikeoutsPer9Inn"])
                    except (ValueError, TypeError):
                        pass
                if s.get("walksPer9Inn") is not None:
                    try:
                        out["bb9"] = float(s["walksPer9Inn"])
                    except (ValueError, TypeError):
                        pass
                if s.get("inningsPitched") is not None:
                    out["ip"] = s["inningsPitched"]
                break
    except Exception as e:
        logger.debug(f"[StatsAPI] pitcher stats fetch failed for {player_id}: {e}")
    return out


def _extract_real_runs_l10(team_id: int) -> dict:
    """Walk last 10 completed games for a team and aggregate REAL runs scored
    and runs allowed. Returns {"runs_for_l10", "runs_against_l10", "games"}.

    This replaces the synthetic-from-win% _derive_ppg_from_record path that
    has been laundering MLB win% as a fake ppg signal forever.
    """
    import statsapi
    from datetime import timedelta
    out: dict = {}
    try:
        end_date = datetime.now(timezone.utc).date()
        # Look back 30 days to make sure we capture 10 completed games even
        # with off days / rainouts
        start_date = end_date - timedelta(days=30)
        sched = statsapi.schedule(
            team=team_id,
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
        )
        completed = [g for g in sched if g.get("status") in ("Final", "Game Over")]
        # Sort newest first, take L10
        completed.sort(key=lambda g: g.get("game_date", ""), reverse=True)
        l10 = completed[:10]
        if not l10:
            return out

        runs_for = 0
        runs_against = 0
        for g in l10:
            home_id = g.get("home_id")
            home_score = g.get("home_score", 0) or 0
            away_score = g.get("away_score", 0) or 0
            if home_id == team_id:
                runs_for += home_score
                runs_against += away_score
            else:
                runs_for += away_score
                runs_against += home_score

        n = len(l10)
        out["runs_for_l10"] = round(runs_for / n, 2)
        out["runs_against_l10"] = round(runs_against / n, 2)
        out["games_l10"] = n
    except Exception as e:
        logger.debug(f"[StatsAPI] runs L10 walk failed for {team_id}: {e}")
    return out


def _extract_pitcher_handedness(player_id: int) -> str:
    """Return 'L' or 'R' for a pitcher, empty string on failure."""
    import statsapi
    try:
        info = statsapi.lookup_player(player_id)
        if info and isinstance(info, list) and info:
            ph = (info[0].get("pitchHand") or {}).get("code") or ""
            return ph.upper()[:1]
    except Exception as e:
        logger.debug(f"[StatsAPI] handedness lookup failed for {player_id}: {e}")
    return ""


def _extract_team_splits_vs_hand(team_id: int, opp_pitcher_hand: str) -> dict:
    """Pull team batting splits vs LHP / RHP. Returns {ops, avg, woba} when
    available. opp_pitcher_hand is 'L' or 'R'."""
    import statsapi
    out: dict = {}
    if not opp_pitcher_hand:
        return out
    split_code = "vl" if opp_pitcher_hand == "L" else "vr"  # vs LHP / vs RHP
    try:
        team_stats = statsapi.team_stats(
            team_id, group="hitting", type="statSplits", sitCodes=split_code
        )
        for s_block in team_stats.get("stats", []):
            s = s_block.get("stats", {}) or {}
            if s.get("ops") is not None:
                try:
                    out["ops_vs_hand"] = float(s["ops"])
                except (ValueError, TypeError):
                    pass
            if s.get("avg") is not None:
                try:
                    out["avg_vs_hand"] = float(s["avg"])
                except (ValueError, TypeError):
                    pass
            if s.get("homeRuns") is not None:
                try:
                    out["hr_vs_hand"] = int(s["homeRuns"])
                except (ValueError, TypeError):
                    pass
            out["vs_hand"] = opp_pitcher_hand
            break
    except Exception as e:
        logger.debug(f"[StatsAPI] team splits fetch failed for {team_id}/{split_code}: {e}")
    return out


def _extract_bullpen_stats(team_id: int) -> dict:
    """Pull bullpen workload + effectiveness via team_leaders + season-to-date.
    Returns {era_L30, ip_L7, fresh_arms_count} when available, empty on failure.

    Strategy: MLB StatsAPI doesn't expose a direct 'bullpen ERA L7' endpoint,
    but team_stats(team_id, group='pitching') gives team-level pitching with
    splits. We pull season totals as a baseline; the L7 freshness comes from
    walking the last 7 days of game logs and tallying relief IP per pitcher
    so we can flag arms used 3+ days in a row as 'tired'.
    """
    import statsapi
    from datetime import timedelta
    out: dict = {}
    try:
        # Season-to-date team pitching (baseline ERA)
        team_stats = statsapi.team_stats(team_id, group="pitching", type="season")
        for s_block in team_stats.get("stats", []):
            if s_block.get("type", {}).get("displayName") == "season":
                s = s_block.get("stats", {}) or {}
                if s.get("era") is not None:
                    try:
                        out["team_era_season"] = float(s["era"])
                    except (ValueError, TypeError):
                        pass
                break
    except Exception as e:
        logger.debug(f"[StatsAPI] team bullpen season fetch failed for {team_id}: {e}")

    # Walk last 7 days of team schedule for relief workload signals
    try:
        end_date = datetime.now(timezone.utc).date()
        start_date = end_date - timedelta(days=7)
        sched = statsapi.schedule(
            team=team_id,
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
        )
        relief_games = 0
        total_relief_ip = 0.0
        relief_er = 0
        recent_arms_used: dict = {}  # arm_id -> [dates]
        for g in sched:
            if g.get("status") not in ("Final", "Game Over"):
                continue
            game_pk = g.get("game_id")
            if not game_pk:
                continue
            try:
                box = statsapi.boxscore_data(game_pk)
                team_side = "home" if g.get("home_id") == team_id else "away"
                pitchers = (box.get(team_side, {}).get("pitchers") or [])
                # First pitcher = starter; everyone else is bullpen
                for arm_id in pitchers[1:]:
                    arm_data = box.get(team_side, {}).get("players", {}).get(f"ID{arm_id}", {})
                    arm_stats = (arm_data.get("stats", {}) or {}).get("pitching", {}) or {}
                    ip_str = str(arm_stats.get("inningsPitched", "0.0"))
                    try:
                        # MLB IP format: "1.2" = 1 and 2/3 innings
                        whole, frac = ip_str.split(".") if "." in ip_str else (ip_str, "0")
                        ip = int(whole) + int(frac) / 3.0
                    except (ValueError, IndexError):
                        ip = 0.0
                    er = int(arm_stats.get("earnedRuns", 0) or 0)
                    if ip > 0:
                        total_relief_ip += ip
                        relief_er += er
                        recent_arms_used.setdefault(arm_id, []).append(g.get("game_date", ""))
                relief_games += 1
            except Exception:
                continue

        if total_relief_ip > 0:
            out["bullpen_era_L7"] = round((relief_er * 9.0) / total_relief_ip, 2)
            out["bullpen_ip_L7"] = round(total_relief_ip, 1)
            # "Tired" arms = appeared 3+ days in last 7
            tired = sum(1 for dates in recent_arms_used.values() if len(dates) >= 3)
            out["bullpen_tired_arms"] = tired
            out["bullpen_relief_games"] = relief_games
    except Exception as e:
        logger.debug(f"[StatsAPI] bullpen L7 walk failed for {team_id}: {e}")

    return out


def _extract_lineup(game_pk: int, side: str) -> list[dict]:
    """Pull confirmed batting order for one side of a game.

    Returns [] if StatsAPI hasn't published the lineup yet (which is normal
    until ~30-60 min before first pitch). Each entry: {order, name, position,
    bats}. Used by the grade engine to weight platoon splits and the prompt
    builder to render a lineup card on the frontend.
    """
    if not _statsapi_available():
        return []
    import statsapi
    try:
        box = statsapi.boxscore_data(game_pk)
    except Exception as e:
        logger.debug(f"[StatsAPI] boxscore fetch failed for lineup {game_pk}: {e}")
        return []

    side_data = box.get(side) or {}
    # `batters` is the ordered list of batter player ids in the lineup
    batter_ids = side_data.get("batters") or []
    players = side_data.get("players") or {}
    out: list[dict] = []
    for order, pid in enumerate(batter_ids[:9], start=1):
        p = players.get(f"ID{pid}") or {}
        person = p.get("person") or {}
        position = (p.get("position") or {}).get("abbreviation") or ""
        bat_side = ((p.get("stats") or {}).get("batting") or {}).get("note") or ""
        # Some lineups expose handedness via `batSide` on the person; both
        # paths are best-effort and either may be empty pre-game.
        bats = (person.get("batSide") or {}).get("code") or bat_side or ""
        out.append({
            "order": order,
            "name": person.get("fullName") or "",
            "position": position,
            "bats": bats,
        })
    return out


def _fetch_sync(home_team: str, away_team: str, game_date: str) -> Optional[dict]:
    """Synchronous StatsAPI lookup. Wrapped in asyncio.to_thread by callers."""
    if not _statsapi_available():
        logger.warning("[StatsAPI] library not installed — falling back to ESPN")
        return None
    import statsapi

    # game_date is ISO format like "2026-04-08T16:36:00Z" — convert to YYYY-MM-DD
    try:
        if "T" in game_date:
            dt = datetime.fromisoformat(game_date.replace("Z", "+00:00"))
            date_str = dt.strftime("%Y-%m-%d")
        else:
            date_str = game_date
    except (ValueError, TypeError):
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        sched = statsapi.schedule(date=date_str)
    except Exception as e:
        logger.warning(f"[StatsAPI] schedule fetch failed for {date_str}: {e}")
        return None

    if not sched:
        return None

    # Find the matchup
    target = None
    for g in sched:
        sa_home = g.get("home_name", "")
        sa_away = g.get("away_name", "")
        if _team_name_match(sa_home, home_team) and _team_name_match(sa_away, away_team):
            target = g
            break

    if not target:
        logger.debug(f"[StatsAPI] no schedule match for {away_team} @ {home_team} on {date_str}")
        return None

    # Pull probable pitcher names + IDs
    home_p_name = target.get("home_probable_pitcher", "") or ""
    away_p_name = target.get("away_probable_pitcher", "") or ""
    home_p_id = target.get("home_probable_pitcher_id")
    away_p_id = target.get("away_probable_pitcher_id")

    home_sp: dict = {"name": home_p_name} if home_p_name else {}
    away_sp: dict = {"name": away_p_name} if away_p_name else {}

    # Enrich with season stats when we have a player ID
    if home_p_id:
        try:
            home_sp.update(_extract_pitcher_stats(int(home_p_id)))
        except (ValueError, TypeError):
            pass
    if away_p_id:
        try:
            away_sp.update(_extract_pitcher_stats(int(away_p_id)))
        except (ValueError, TypeError):
            pass

    # Weather + umpire come from boxscore (only available after first pitch);
    # for upcoming games StatsAPI exposes these via `get_game_contextual_metrics`
    # but they may be None pre-game. Best-effort populate.
    weather: dict = {}
    umpire: dict = {}
    game_pk = target.get("game_id")
    if game_pk:
        try:
            game_info = statsapi.get("game", {"gamePk": game_pk})
            game_data = (game_info.get("gameData") or {})
            wx = game_data.get("weather") or {}
            if wx:
                weather = {
                    "condition": wx.get("condition"),
                    "temp": wx.get("temp"),
                    "wind": wx.get("wind"),
                }
            officials = (game_data.get("officials") or [])
            for o in officials:
                if (o.get("officialType") or "").lower() == "home plate":
                    umpire = {"name": (o.get("official") or {}).get("fullName")}
                    break
        except Exception as e:
            logger.debug(f"[StatsAPI] game info fetch failed for {game_pk}: {e}")

    # Bullpen ERA L7 + tired-arm count for both teams
    home_bullpen: dict = {}
    away_bullpen: dict = {}
    home_team_id = target.get("home_id")
    away_team_id = target.get("away_id")
    if home_team_id:
        try:
            home_bullpen = _extract_bullpen_stats(int(home_team_id))
        except (ValueError, TypeError):
            pass
    if away_team_id:
        try:
            away_bullpen = _extract_bullpen_stats(int(away_team_id))
        except (ValueError, TypeError):
            pass

    # Lineup vs SP hand — each team bats vs the OPPOSING starter's hand
    home_lineup_vs_hand: dict = {}
    away_lineup_vs_hand: dict = {}
    away_sp_hand = ""
    home_sp_hand = ""
    if away_p_id:
        try:
            away_sp_hand = _extract_pitcher_handedness(int(away_p_id))
            if away_sp_hand:
                away_sp["hand"] = away_sp_hand
        except (ValueError, TypeError):
            pass
    if home_p_id:
        try:
            home_sp_hand = _extract_pitcher_handedness(int(home_p_id))
            if home_sp_hand:
                home_sp["hand"] = home_sp_hand
        except (ValueError, TypeError):
            pass
    if home_team_id and away_sp_hand:
        try:
            home_lineup_vs_hand = _extract_team_splits_vs_hand(int(home_team_id), away_sp_hand)
        except (ValueError, TypeError):
            pass
    if away_team_id and home_sp_hand:
        try:
            away_lineup_vs_hand = _extract_team_splits_vs_hand(int(away_team_id), home_sp_hand)
        except (ValueError, TypeError):
            pass

    # Real runs scored / allowed L10 — replaces win-%-derived synthetic ppg
    home_runs_l10: dict = {}
    away_runs_l10: dict = {}
    if home_team_id:
        try:
            home_runs_l10 = _extract_real_runs_l10(int(home_team_id))
        except (ValueError, TypeError):
            pass
    if away_team_id:
        try:
            away_runs_l10 = _extract_real_runs_l10(int(away_team_id))
        except (ValueError, TypeError):
            pass

    # Confirmed batting order for each side. Empty until StatsAPI publishes
    # the lineup ~30-60 min before first pitch — that's expected and the
    # grade engine treats empty as "lineup unknown" rather than fatal.
    home_lineup: list[dict] = []
    away_lineup: list[dict] = []
    if game_pk:
        try:
            home_lineup = _extract_lineup(int(game_pk), "home")
            away_lineup = _extract_lineup(int(game_pk), "away")
        except (ValueError, TypeError):
            pass

    return {
        "source": "mlb_statsapi",
        "game_pk": game_pk,
        "home_bullpen": home_bullpen,
        "away_bullpen": away_bullpen,
        "home_starting_pitcher": home_sp,
        "away_starting_pitcher": away_sp,
        "home_lineup_vs_hand": home_lineup_vs_hand,
        "away_lineup_vs_hand": away_lineup_vs_hand,
        "home_lineup": home_lineup,
        "away_lineup": away_lineup,
        "home_runs_l10": home_runs_l10,
        "away_runs_l10": away_runs_l10,
        "weather": weather,
        "umpire": umpire,
    }


async def fetch_mlb_game_profile(home_team: str, away_team: str, game_date: str) -> Optional[dict]:
    """Async entry point. Returns the StatsAPI profile dict for one MLB game,
    or None if unavailable (caller should fall back to ESPN).

    Cache key is (home, away, date) — short TTL because lineups + weather
    update right up to first pitch."""
    cache_key = f"{home_team}|{away_team}|{game_date}"
    cached = _mlb_game_cache.get(cache_key)
    if cached:
        age = (datetime.now(timezone.utc) - cached["_ts"]).total_seconds()
        if age < _MLB_CACHE_TTL:
            return cached["data"]

    try:
        # Hard 30s ceiling — statsapi (requests-based) has no built-in timeout
        # and a single network stall would block the worker thread (and the
        # entire analyze) forever. 30s is generous: a healthy MLB enrich
        # finishes in 5-10s; anything slower is an upstream incident, not
        # signal we should wait for.
        data = await asyncio.wait_for(
            asyncio.to_thread(_fetch_sync, home_team, away_team, game_date),
            timeout=30,
        )
    except asyncio.TimeoutError:
        logger.warning(f"[StatsAPI] HARD TIMEOUT (>30s) for {away_team}@{home_team} — skipping enrichment")
        return None
    except Exception as e:
        logger.warning(f"[StatsAPI] async wrapper failed for {away_team}@{home_team}: {e}")
        return None

    if data is None:
        return None

    _mlb_game_cache[cache_key] = {"data": data, "_ts": datetime.now(timezone.utc)}
    return data
