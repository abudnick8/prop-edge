#!/usr/bin/env python3
"""
Clubhouse IQ — Auto Grader
══════════════════════════
Runs nightly after games finish. For every open pick snapshot:
  1. Fetches final scores from ESPN public API
  2. Compares pick vs. result → won / lost / push
  3. Appends graded record to bet_outcome_log.json
  4. Triggers ml_engine.py to recompute weights

Pick snapshot format (written by routes.ts at scan time):
  server/ml_data/pick_snapshots.json — array of snapshot objects

Outcome log format:
  server/ml_data/bet_outcome_log.json — array of graded records
"""

import json
import os
import math
import datetime
import urllib.request
import urllib.error
import sys

BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
DATA_DIR      = os.path.join(BASE_DIR, "ml_data")
SNAPSHOT_FILE = os.path.join(DATA_DIR, "pick_snapshots.json")
OUTCOME_LOG   = os.path.join(DATA_DIR, "bet_outcome_log.json")
GRADED_IDS    = os.path.join(DATA_DIR, "graded_ids.json")

os.makedirs(DATA_DIR, exist_ok=True)

NOW = datetime.datetime.utcnow()


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_json(path: str, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path: str, data) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)


def fetch_url(url: str, timeout: int = 10) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# ── ESPN score fetchers ───────────────────────────────────────────────────────

SPORT_ESPN = {
    "NBA": ("basketball", "nba"),
    "MLB": ("baseball",   "mlb"),
    "NHL": ("hockey",     "nhl"),
    "NFL": ("football",   "nfl"),
}


def fetch_espn_scores(sport: str, date_str: str) -> list[dict]:
    """
    Returns list of completed games for a sport on a date (YYYYMMDD).
    Each entry: {home, away, homeScore, awayScore, status, gameId}
    """
    if sport not in SPORT_ESPN:
        return []
    sn, lg = SPORT_ESPN[sport]
    url = f"https://site.api.espn.com/apis/site/v2/sports/{sn}/{lg}/scoreboard?dates={date_str}"
    try:
        data = fetch_url(url)
    except Exception as e:
        print(f"  [Grader] ESPN fetch error {sport} {date_str}: {e}")
        return []

    results = []
    for event in data.get("events", []):
        comp = (event.get("competitions") or [{}])[0]
        status_type = comp.get("status", {}).get("type", {})
        completed = status_type.get("completed", False)
        if not completed:
            continue

        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue

        try:
            home_score = int(home.get("score", 0))
            away_score = int(away.get("score", 0))
        except (ValueError, TypeError):
            continue

        results.append({
            "gameId":     event.get("id", ""),
            "home":       home.get("team", {}).get("displayName", ""),
            "away":       away.get("team", {}).get("displayName", ""),
            "homeScore":  home_score,
            "awayScore":  away_score,
            "status":     "final",
            "date":       date_str,
        })
    return results


def fetch_scores_window(sport: str, game_time_str: str) -> list[dict]:
    """Fetch scores for the day of a game + day after (UTC variance)."""
    try:
        dt = datetime.datetime.fromisoformat(str(game_time_str).replace("Z", "").replace("+00:00", ""))
    except Exception:
        dt = NOW - datetime.timedelta(days=1)

    dates = set()
    for delta in [-1, 0, 1]:
        d = dt + datetime.timedelta(days=delta)
        dates.add(d.strftime("%Y%m%d"))

    games = []
    seen  = set()
    for d in sorted(dates):
        for g in fetch_espn_scores(sport, d):
            if g["gameId"] not in seen:
                seen.add(g["gameId"])
                games.append(g)
    return games


# ── Team name fuzzy match ─────────────────────────────────────────────────────

def last_word(s: str) -> str:
    parts = s.strip().lower().split()
    return parts[-1] if parts else ""


def teams_match(a: str, b: str) -> bool:
    """True if two team name strings refer to the same team."""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return True
    # Last word match (e.g. "Boston Celtics" vs "Celtics")
    if last_word(a) == last_word(b) and len(last_word(a)) > 3:
        return True
    # One contains the other
    if len(a) > 4 and a in b:
        return True
    if len(b) > 4 and b in a:
        return True
    return False


def find_game(scores: list[dict], home_team: str, away_team: str) -> dict | None:
    """Find a completed game matching home/away team names."""
    for g in scores:
        home_ok = teams_match(g["home"], home_team) or teams_match(g["home"], away_team)
        away_ok = teams_match(g["away"], away_team) or teams_match(g["away"], home_team)
        if home_ok and away_ok:
            return g
        # Also try cross-match in case home/away swapped in snapshot
        if teams_match(g["home"], away_team) and teams_match(g["away"], home_team):
            return g
    return None


# ── Grade a single pick ───────────────────────────────────────────────────────

def grade_pick(snap: dict, game: dict) -> str | None:
    """
    Returns 'won', 'lost', or 'push'. None if unresolvable.
    snap fields: betType, pickSide, line, statCategory, playerName,
                 homeTeam, awayTeam, confidenceScore, sport
    """
    bet_type  = (snap.get("betType") or "").lower()
    pick_side = (snap.get("pickSide") or "").lower()   # over/under/home/away/team name
    line      = snap.get("line")                        # spread or total
    home      = snap.get("homeTeam", "")
    away      = snap.get("awayTeam", "")

    home_score = game["homeScore"]
    away_score = game["awayScore"]
    total_score = home_score + away_score

    # ── Moneyline ──────────────────────────────────────────────────────────────
    if bet_type in ("moneyline", "ml"):
        if home_score == away_score:
            return "push"
        home_won = home_score > away_score
        if pick_side in ("home",) or teams_match(pick_side, home):
            return "won" if home_won else "lost"
        if pick_side in ("away",) or teams_match(pick_side, away):
            return "won" if not home_won else "lost"
        return None

    # ── Spread ────────────────────────────────────────────────────────────────
    if bet_type == "spread" and line is not None:
        try:
            spread = float(line)  # away team's spread (e.g. +3.5 or -7)
        except (TypeError, ValueError):
            return None
        # margin = away_score - home_score (positive = away wins outright)
        margin = away_score - home_score
        covered_margin = margin + spread  # >0 means away covered
        if abs(covered_margin) < 0.01:
            return "push"
        away_covered = covered_margin > 0
        if pick_side in ("away",) or teams_match(pick_side, away):
            return "won" if away_covered else "lost"
        if pick_side in ("home",) or teams_match(pick_side, home):
            return "won" if not away_covered else "lost"
        # If pick_side not specified, assume away (how we store it)
        return "won" if away_covered else "lost"

    # ── Total ─────────────────────────────────────────────────────────────────
    if bet_type == "total" and line is not None:
        try:
            total_line = float(line)
        except (TypeError, ValueError):
            return None
        if abs(total_score - total_line) < 0.01:
            return "push"
        went_over = total_score > total_line
        if pick_side in ("over",):
            return "won" if went_over else "lost"
        if pick_side in ("under",):
            return "won" if not went_over else "lost"
        return None

    # ── Player prop ───────────────────────────────────────────────────────────
    # Player props require individual stat lines — ESPN doesn't expose box scores
    # cleanly via the public scoreboard API for all stat types.
    # We skip for now and mark as 'unresolvable' — will be handled in v2.
    if bet_type == "player_prop":
        return None

    return None


# ── Main grader ───────────────────────────────────────────────────────────────

def run_grader() -> dict:
    snapshots  = load_json(SNAPSHOT_FILE, [])
    outcomes   = load_json(OUTCOME_LOG, [])
    graded_ids = set(load_json(GRADED_IDS, []))

    # Index existing outcomes by betId to avoid duplicates
    existing_bet_ids = {r.get("betId") for r in outcomes}

    # Only process snapshots that:
    # 1. Haven't been graded yet
    # 2. Are for games that have already started (game_time < now - 3h to allow for OT)
    cutoff = NOW - datetime.timedelta(hours=3)

    pending = []
    for snap in snapshots:
        bid = snap.get("betId") or snap.get("id")
        if bid in existing_bet_ids or bid in graded_ids:
            continue
        gt_str = snap.get("gameTime") or snap.get("game_time")
        if not gt_str:
            continue
        try:
            gt = datetime.datetime.fromisoformat(str(gt_str).replace("Z", "").replace("+00:00", ""))
            if gt > cutoff:
                continue   # game hasn't finished yet
        except Exception:
            continue
        pending.append(snap)

    print(f"[Grader] {len(pending)} picks to grade out of {len(snapshots)} snapshots")

    newly_graded = []
    skipped_prop = 0
    skipped_no_game = 0
    errors = 0

    # Group by sport to batch ESPN calls
    by_sport: dict[str, list] = {}
    for snap in pending:
        sport = (snap.get("sport") or "").upper()
        if sport not in SPORT_ESPN:
            continue
        by_sport.setdefault(sport, []).append(snap)

    for sport, snaps in by_sport.items():
        print(f"  [Grader] Grading {len(snaps)} {sport} picks...")

        # Collect unique dates needed
        dates_needed: set[str] = set()
        for snap in snaps:
            gt_str = snap.get("gameTime") or snap.get("game_time", "")
            try:
                dt = datetime.datetime.fromisoformat(str(gt_str).replace("Z", "").replace("+00:00", ""))
                for delta in [-1, 0, 1]:
                    dates_needed.add((dt + datetime.timedelta(days=delta)).strftime("%Y%m%d"))
            except Exception:
                pass

        # Fetch all scores for needed dates
        all_scores: list[dict] = []
        seen_game_ids: set[str] = set()
        for d in sorted(dates_needed):
            for g in fetch_espn_scores(sport, d):
                if g["gameId"] not in seen_game_ids:
                    seen_game_ids.add(g["gameId"])
                    all_scores.append(g)

        print(f"    Fetched {len(all_scores)} completed {sport} games")

        for snap in snaps:
            bet_type = (snap.get("betType") or "").lower()
            if bet_type == "player_prop":
                skipped_prop += 1
                continue

            home = snap.get("homeTeam", "")
            away = snap.get("awayTeam", "")
            game = find_game(all_scores, home, away)

            if not game:
                skipped_no_game += 1
                print(f"    No game found for: {away} @ {home}")
                continue

            result = grade_pick(snap, game)
            if result is None:
                errors += 1
                continue

            bid = snap.get("betId") or snap.get("id")
            record = {
                "betId":           bid,
                "sport":           sport,
                "betType":         snap.get("betType"),
                "title":           snap.get("title", ""),
                "pickSide":        snap.get("pickSide"),
                "line":            snap.get("line"),
                "homeTeam":        home,
                "awayTeam":        away,
                "homeScore":       game["homeScore"],
                "awayScore":       game["awayScore"],
                "confidenceScore": snap.get("confidenceScore"),
                "formEdgePct":     snap.get("formEdgePct"),
                "hitRate":         snap.get("hitRate"),
                "edgeScore":       snap.get("edgeScore"),
                "edgeGrade":       snap.get("edgeGrade"),
                "edgeSizing":      snap.get("edgeSizing"),
                "gameTime":        snap.get("gameTime") or snap.get("game_time"),
                "gradedAt":        NOW.isoformat(),
                "result":          result,
                "gameDate":        game["date"],
            }

            outcomes.append(record)
            graded_ids.add(bid)
            newly_graded.append(record)
            print(f"    ✓ {away} @ {home} → {result.upper()} (line={snap.get('line')} pick={snap.get('pickSide')} conf={snap.get('confidenceScore')})")

    # Save updated outcome log
    save_json(OUTCOME_LOG, outcomes)
    save_json(GRADED_IDS, list(graded_ids))

    summary = {
        "graded":          len(newly_graded),
        "skipped_prop":    skipped_prop,
        "skipped_no_game": skipped_no_game,
        "errors":          errors,
        "total_outcomes":  len(outcomes),
        "run_at":          NOW.isoformat(),
    }
    print(f"[Grader] Done — {summary}")
    return summary


if __name__ == "__main__":
    result = run_grader()
    print(json.dumps(result, indent=2))
