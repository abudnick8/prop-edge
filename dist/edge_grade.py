"""
edge_grade.py — Edge Crew v3 grade engine integration for Clubhouse IQ
======================================================================
Called by scanner.ts (and routes.ts) via child_process.spawn, exactly
like ml_engine.py.

Usage (two modes):
  python3 edge_grade.py grade   <json_payload>   → grades a single team-bet game
  python3 edge_grade.py scan    <json_payload>   → grades a list of scanner bets (team bets only)

JSON input for "grade" mode:
{
  "sport": "NBA",
  "homeTeam": "Boston Celtics",
  "awayTeam": "Miami Heat",
  "homeRecord": "48-20",
  "awayRecord": "32-36",
  "homeL5": "4-1",
  "awayL5": "2-3",
  "homeStreak": "W3",
  "awayStreak": "L2",
  "homeRestDays": 2,
  "awayRestDays": 1,
  "homeIsB2B": false,
  "awayIsB2B": false,
  "homeH2H": "2-1",
  "awayH2H": "1-2",
  "homePPG_L5": 118.4,
  "awayPPG_L5": 109.2,
  "homeOppPPG_L5": 108.0,
  "awayOppPPG_L5": 114.0,
  "spreadDelta": -1.5,
  "pickSide": "home",
  "homeML": -165,
  "awayML": 140,
  "spreadHome": -6.5,
  "injuries": {}
}

JSON input for "scan" mode:
{ "bets": [ { "id": "...", "sport": "NBA", ... }, ... ] }

Output (stdout, one JSON line):
{ "score": 7.4, "grade": "A-", "sizing": "1u", "factors": [...], "ev": {...}, "peter": {...} }
"""

from __future__ import annotations

import json
import sys
import asyncio
import logging
from typing import Optional

logging.basicConfig(level=logging.WARNING)

# ── Import grade engine (same directory) ──────────────────────────────────────
sys.path.insert(0, __file__.replace("edge_grade.py", ""))
from grade_engine import (
    grade_game,
    score_to_grade,
    score_to_sizing,
    calculate_ev,
    peter_rules,
    GRADE_THRESHOLDS,
)

# ── Try to import pace helpers (optional — degrade gracefully) ────────────────
try:
    from nhl_pace import get_team_pace as get_nhl_pace
    _NHL_PACE = True
except ImportError:
    _NHL_PACE = False

try:
    from espn_pace import get_team_pace as get_espn_pace
    _ESPN_PACE = True
except ImportError:
    _ESPN_PACE = False

# ── Try MLB StatsAPI (optional) ───────────────────────────────────────────────
try:
    from data_fetch_mlb import fetch_mlb_game_data
    _MLB_STATS = True
except ImportError:
    _MLB_STATS = False


def _safe_float(v, default=0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _build_game_dict(payload: dict) -> dict:
    """Convert flat scanner payload into the nested game dict grade_game() expects."""
    sport = (payload.get("sport") or "NBA").upper()
    home = payload.get("homeTeam", "Home")
    away = payload.get("awayTeam", "Away")

    home_profile = {
        "record":          payload.get("homeRecord") or "0-0",
        "L5":              payload.get("homeL5") or "0-0",
        "L5_margin":       _safe_float(payload.get("homeL5Margin")),
        "avg_margin_L10":  _safe_float(payload.get("homeMarginL10")),
        "streak":          payload.get("homeStreak") or "",
        "rest_days":       payload.get("homeRestDays"),
        "is_b2b":          bool(payload.get("homeIsB2B", False)),
        "h2h_season":      payload.get("homeH2H") or "0-0",
        "ppg_L5":          _safe_float(payload.get("homePPG_L5")),
        "opp_ppg_L5":      _safe_float(payload.get("homeOppPPG_L5")),
        "home_record":     payload.get("homeHomeRecord") or payload.get("homeRecord") or "0-0",
        "away_record":     payload.get("homeAwayRecord") or "0-0",
        "road_trip_len":   int(payload.get("homeRoadTrip") or 0),
        "home_stand_len":  int(payload.get("homeHomeStand") or 0),
        "pace_L5":         _safe_float(payload.get("homePace")) or None,
        # NBA extras
        "nba_quarters":    payload.get("homeNBAQuarters") or None,
        "bench_ppg_l5":    payload.get("homeBenchPPG") or None,
        # MLB extras (populated by MLB data fetch)
        "starting_pitcher": payload.get("homeStartingPitcher") or {},
        "bullpen":          payload.get("homeBullpen") or {},
        "lineup_vs_hand":   payload.get("homeLineupVsHand") or {},
    }

    away_profile = {
        "record":          payload.get("awayRecord") or "0-0",
        "L5":              payload.get("awayL5") or "0-0",
        "L5_margin":       _safe_float(payload.get("awayL5Margin")),
        "avg_margin_L10":  _safe_float(payload.get("awayMarginL10")),
        "streak":          payload.get("awayStreak") or "",
        "rest_days":       payload.get("awayRestDays"),
        "is_b2b":          bool(payload.get("awayIsB2B", False)),
        "h2h_season":      payload.get("awayH2H") or "0-0",
        "ppg_L5":          _safe_float(payload.get("awayPPG_L5")),
        "opp_ppg_L5":      _safe_float(payload.get("awayOppPPG_L5")),
        "home_record":     payload.get("awayHomeRecord") or "0-0",
        "away_record":     payload.get("awayAwayRecord") or payload.get("awayRecord") or "0-0",
        "road_trip_len":   int(payload.get("awayRoadTrip") or 0),
        "home_stand_len":  int(payload.get("awayHomeStand") or 0),
        "pace_L5":         _safe_float(payload.get("awayPace")) or None,
        # NBA extras
        "nba_quarters":    payload.get("awayNBAQuarters") or None,
        "bench_ppg_l5":    payload.get("awayBenchPPG") or None,
        # MLB extras
        "starting_pitcher": payload.get("awayStartingPitcher") or {},
        "bullpen":          payload.get("awayBullpen") or {},
        "lineup_vs_hand":   payload.get("awayLineupVsHand") or {},
    }

    game = {
        "sport":        sport,
        "homeTeam":     home,
        "awayTeam":     away,
        "home_profile": home_profile,
        "away_profile": away_profile,
        "injuries":     payload.get("injuries") or {"home": [], "away": []},
        "shifts":       {
            "spread_delta": _safe_float(payload.get("spreadDelta")),
        },
        "odds": {
            "spread":          _safe_float(payload.get("spreadHome")),
            "spread_home":     _safe_float(payload.get("spreadHome")),
            "spreadPriceHome": payload.get("spreadPriceHome"),
            "spreadPriceAway": payload.get("spreadPriceAway"),
            "mlHome":          payload.get("homeML"),
            "mlAway":          payload.get("awayML"),
            "total":           payload.get("total"),
        },
        # MLB
        "umpire": payload.get("umpire") or {},
    }

    return game


def grade_payload(payload: dict) -> dict:
    """Grade a single game payload. Returns full result dict."""
    pick_side = payload.get("pickSide", "away")  # "home" | "away"
    game = _build_game_dict(payload)
    sport = game["sport"]

    result = grade_game(game, pick_side)
    final_score = result.get("score", 5.0)
    grade_letter = score_to_grade(final_score)
    sizing = score_to_sizing(final_score)

    # EV calculation
    ev = calculate_ev(game, pick_side, final_score)

    # Peter's rules
    peter = peter_rules(game, pick_side)
    if peter.get("has_kill"):
        grade_letter = "F"
        sizing = "PASS"

    # Build factor list from variables (available ones with real notes)
    factors: list[str] = []
    for var_name, var_data in result.get("variables", {}).items():
        if isinstance(var_data, dict) and var_data.get("available", True):
            note = var_data.get("note", "")
            if note and "No " not in note and "no " not in note:
                factors.append(note)

    # Chains fired → factors
    for chain_name in result.get("chains_fired", []):
        factors.append(f"Chain: {chain_name.replace('_', ' ').title()}")

    # Peter flags → factors
    for flag in peter.get("flags", []):
        factors.append(f"[{flag['action']}] {flag['note']}")

    # grade_engine already computes confidence as 55 + (score-5)*8, use that
    confidence = result.get("confidence", min(99, max(10, round(final_score * 10))))

    return {
        "score":      final_score,
        "confidence": confidence,
        "grade":      grade_letter,
        "sizing":     sizing,
        "factors":    factors[:12],
        "ev":         ev,
        "peter":      peter,
        "variables":  result.get("variables", []),
        "chains":     result.get("chains", []),
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: edge_grade.py <grade|scan> <json>"}))
        sys.exit(1)

    mode = sys.argv[1]
    try:
        payload = json.loads(sys.argv[2])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"JSON parse error: {e}"}))
        sys.exit(1)

    if mode == "grade":
        result = grade_payload(payload)
        print(json.dumps(result))

    elif mode == "scan":
        bets = payload.get("bets", [])
        results = []
        for bet in bets:
            try:
                r = grade_payload(bet)
                r["id"] = bet.get("id", "")
                results.append(r)
            except Exception as ex:
                results.append({"id": bet.get("id", ""), "error": str(ex), "confidence": 50, "grade": "C"})
        print(json.dumps({"results": results}))

    else:
        print(json.dumps({"error": f"Unknown mode: {mode}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
