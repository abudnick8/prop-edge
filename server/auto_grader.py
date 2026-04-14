#!/usr/bin/env python3
"""
Clubhouse IQ — Auto Grader v2
══════════════════════════════
Runs nightly after games finish. For every open pick snapshot:
  1. Fetches final scores AND full player box scores from ESPN public API
  2. Grades team bets (spread/total/ML) against final scores
  3. Grades player props against real box score stat lines
  4. Appends graded records to bet_outcome_log.json
  5. Triggers ml_engine.py to recompute weights

Data sources (all 100% free, no API key required):
  - ESPN scoreboard:  site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
  - ESPN game summary: site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={id}
    → Returns full per-player box score for NBA, MLB, NHL, NFL

Stat category map (how prop stat categories map to ESPN box score keys):
  NBA:  PTS→points, REB→rebounds, AST→assists, STL→steals, BLK→blocks
        3PM→threePointFieldGoalsMade, FG→fieldGoalsMade, TO→turnovers
  MLB:  H→H, HR→HR, RBI→RBI, BB→BB, K→K (batting); K→K, ER→ER, IP→IP (pitching)
  NHL:  G→G (goals), A→A (assists), PTS=G+A, SOG→SOG (shots on goal)
  NFL:  PASS_YDS→passingYards, RUSH_YDS→rushingYards, REC→receptions,
        REC_YDS→receivingYards, TD→any touchdown sum, INT→interceptions
"""

import json
import os
import math
import datetime
import urllib.request
import urllib.error
import sys
import time

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


def fetch_url(url: str, timeout: int = 12) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# ── Sport config ──────────────────────────────────────────────────────────────

ODDS_API_SPORT_KEY_MAP = {
    "basketball_nba": "NBA",
    "baseball_mlb":   "MLB",
    "icehockey_nhl":  "NHL",
    "americanfootball_nfl": "NFL",
}

def normalize_sport(raw):
    if not raw:
        return None
    up = raw.upper().strip()
    if up in ("NBA", "MLB", "NHL", "NFL"):
        return up
    lower = raw.lower().strip()
    if lower in ODDS_API_SPORT_KEY_MAP:
        return ODDS_API_SPORT_KEY_MAP[lower]
    if "NBA" in up or "BASKETBALL" in up: return "NBA"
    if "MLB" in up or "BASEBALL"   in up: return "MLB"
    if "NHL" in up or "HOCKEY"     in up: return "NHL"
    if "NFL" in up or "FOOTBALL"   in up: return "NFL"
    return None

SPORT_ESPN = {
    "NBA": ("basketball", "nba"),
    "MLB": ("baseball",   "mlb"),
    "NHL": ("hockey",     "nhl"),
    "NFL": ("football",   "nfl"),
}

# Maps our internal stat category labels → ESPN box score label/key
# Format: { our_key: (espn_label_or_key, parse_mode) }
# parse_mode: "int" = straight integer, "float" = float, "fraction_left" = "3-5"→3,
#             "combo" = sum of multiple labels
STAT_MAP = {
    "NBA": {
        # Scoring
        "PTS":   ("PTS",   "int"),
        "POINTS": ("PTS",  "int"),
        "POINTS_SCORED": ("PTS", "int"),
        # Rebounds
        "REB":   ("REB",   "int"),
        "REBOUNDS": ("REB","int"),
        "OREB":  ("OREB",  "int"),
        "DREB":  ("DREB",  "int"),
        # Assists
        "AST":   ("AST",   "int"),
        "ASSISTS": ("AST", "int"),
        # Steals / Blocks
        "STL":   ("STL",   "int"),
        "BLK":   ("BLK",   "int"),
        "BLOCKS": ("BLK",  "int"),
        # Turnovers
        "TO":    ("TO",    "int"),
        # Threes
        "3PM":   ("3PT",   "fraction_left"),
        "THREE_POINTERS_MADE": ("3PT", "fraction_left"),
        # Combos — handled specially in parse_stat
        "PTS+REB+AST": ("PTS+REB+AST", "combo"),
        "PRA":   ("PTS+REB+AST", "combo"),
        "PTS+REB": ("PTS+REB", "combo"),
        "PTS+AST": ("PTS+AST", "combo"),
        "REB+AST": ("REB+AST", "combo"),
    },
    "MLB": {
        # Batting
        "H":     ("H",     "int"),
        "HITS":  ("H",     "int"),
        "HR":    ("HR",    "int"),
        "HOME_RUNS": ("HR","int"),
        "RBI":   ("RBI",   "int"),
        "R":     ("R",     "int"),
        "RUNS":  ("R",     "int"),
        "BB":    ("BB",    "int"),
        "K":     ("K",     "int"),
        "SB":    ("SB",    "int"),
        "TB":    ("TB",    "int"),
        # Pitching
        "IP":    ("IP",    "float"),
        "ER":    ("ER",    "int"),
        "STRIKEOUTS": ("K","int"),    # pitcher K
        "PITCHING_K": ("K","int"),
        "WALKS":  ("BB",   "int"),
        "ERA":   ("ERA",   "float"),
    },
    "NHL": {
        "G":     ("G",     "int"),
        "GOALS": ("G",     "int"),
        "A":     ("A",     "int"),
        "ASSISTS": ("A",   "int"),
        "PTS":   ("G+A",   "combo"),
        "POINTS": ("G+A",  "combo"),
        "SOG":   ("SOG",   "int"),
        "SHOTS": ("SOG",   "int"),
        "SHOTS_ON_GOAL": ("SOG", "int"),
        "+/-":   ("+/-",   "int"),
    },
    "NFL": {
        "PASS_YDS":  ("YDS",  "int"),   # from passing group
        "PASSING_YARDS": ("YDS", "int"),
        "RUSH_YDS":  ("YDS",  "int"),   # from rushing group
        "RUSHING_YARDS": ("YDS", "int"),
        "REC":       ("REC",  "int"),
        "RECEPTIONS": ("REC", "int"),
        "REC_YDS":   ("YDS",  "int"),   # from receiving group
        "RECEIVING_YARDS": ("YDS", "int"),
        "TD":        ("TD",   "combo"), # sum all TD types
        "TOUCHDOWNS": ("TD",  "combo"),
        "INT":       ("INT",  "int"),
        "COMPLETIONS": ("C/ATT", "fraction_left"),
        "SACKS":     ("SACKS", "float"),
        "TACKLES":   ("TOT",  "int"),
    },
}

# NFL stat group labels — used to disambiguate duplicate "YDS" labels
NFL_GROUPS = {
    "PASS_YDS":   "passing",
    "PASSING_YARDS": "passing",
    "RUSH_YDS":   "rushing",
    "RUSHING_YARDS": "rushing",
    "REC_YDS":    "receiving",
    "RECEIVING_YARDS": "receiving",
    "REC":        "receiving",
    "RECEPTIONS": "receiving",
}


# ── ESPN score fetchers ───────────────────────────────────────────────────────

def fetch_espn_scoreboard(sport: str, date_str: str) -> list:
    """Returns list of game objects from ESPN scoreboard for a given date."""
    if sport not in SPORT_ESPN:
        return []
    sn, lg = SPORT_ESPN[sport]
    url = f"https://site.api.espn.com/apis/site/v2/sports/{sn}/{lg}/scoreboard?dates={date_str}"
    try:
        data = fetch_url(url)
    except Exception as e:
        print(f"  [Grader] ESPN scoreboard error {sport} {date_str}: {e}")
        return []
    return data.get("events", [])


def fetch_espn_scores(sport: str, date_str: str) -> list:
    """Returns list of completed games with scores. Team bets use this."""
    events = fetch_espn_scoreboard(sport, date_str)
    results = []
    for event in events:
        comp = (event.get("competitions") or [{}])[0]
        status_type = comp.get("status", {}).get("type", {})
        if not status_type.get("completed", False):
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
            "gameId":    event.get("id", ""),
            "espnId":    event.get("id", ""),
            "home":      home.get("team", {}).get("displayName", ""),
            "away":      away.get("team", {}).get("displayName", ""),
            "homeScore": home_score,
            "awayScore": away_score,
            "status":    "final",
            "date":      date_str,
        })
    return results


def fetch_espn_game_summary(sport: str, espn_id: str) -> dict | None:
    """
    Fetches the full ESPN game summary including player box scores.
    Returns the raw summary JSON or None on failure.
    """
    if sport not in SPORT_ESPN:
        return None
    sn, lg = SPORT_ESPN[sport]
    url = f"https://site.api.espn.com/apis/site/v2/sports/{sn}/{lg}/summary?event={espn_id}"
    try:
        return fetch_url(url)
    except Exception as e:
        print(f"  [Grader] ESPN summary error {sport} {espn_id}: {e}")
        return None


def get_espn_id_for_game(sport: str, home_team: str, away_team: str, game_time_str: str) -> str | None:
    """
    Looks up the ESPN event ID for a game by searching scoreboard dates
    around the expected game time. Returns the espn event ID or None.
    """
    try:
        dt = datetime.datetime.fromisoformat(str(game_time_str).replace("Z", "").replace("+00:00", ""))
    except Exception:
        dt = NOW - datetime.timedelta(days=1)

    dates = sorted(set(
        (dt + datetime.timedelta(days=d)).strftime("%Y%m%d")
        for d in [-1, 0, 1, 2]
    ))

    for date_str in dates:
        events = fetch_espn_scoreboard(sport, date_str)
        for event in events:
            comp = (event.get("competitions") or [{}])[0]
            competitors = comp.get("competitors", [])
            home_disp = next(
                (c.get("team", {}).get("displayName", "") for c in competitors if c.get("homeAway") == "home"), ""
            )
            away_disp = next(
                (c.get("team", {}).get("displayName", "") for c in competitors if c.get("homeAway") == "away"), ""
            )
            if teams_match(home_disp, home_team) and teams_match(away_disp, away_team):
                return event.get("id")
            # also try cross-match
            if teams_match(home_disp, away_team) and teams_match(away_disp, home_team):
                return event.get("id")
    return None


# ── Team name fuzzy match ─────────────────────────────────────────────────────

def last_word(s: str) -> str:
    parts = s.strip().lower().split()
    return parts[-1] if parts else ""


def teams_match(a: str, b: str) -> bool:
    """True if two team name strings refer to the same team."""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return True
    if last_word(a) == last_word(b) and len(last_word(a)) > 3:
        return True
    if len(a) > 4 and a in b:
        return True
    if len(b) > 4 and b in a:
        return True
    return False


def player_name_match(a: str, b: str) -> bool:
    """Fuzzy match player names (handles last-name only, initials, etc.)"""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return True
    # Last name match
    a_last = a.split()[-1] if a else ""
    b_last = b.split()[-1] if b else ""
    if a_last == b_last and len(a_last) > 3:
        return True
    # One contains the other
    if len(a) > 4 and a in b:
        return True
    if len(b) > 4 and b in a:
        return True
    # First initial + last name: "J. Smith" vs "John Smith"
    a_parts = a.split()
    b_parts = b.split()
    if len(a_parts) >= 2 and len(b_parts) >= 2:
        if a_parts[-1] == b_parts[-1]:
            # check first initials match
            if a_parts[0][0] == b_parts[0][0]:
                return True
    return False


# ── Box score parser ──────────────────────────────────────────────────────────

def parse_stat_value(raw: str, parse_mode: str) -> float | None:
    """
    Parses a raw stat string into a number.
    parse_mode: "int", "float", "fraction_left" ("3-5"→3 or "3/5"→3)
    """
    if raw is None or raw == "--" or raw == "":
        return None
    raw = str(raw).strip()
    try:
        if parse_mode == "fraction_left":
            # "21/32" or "3-5" → take left side
            for sep in ["/", "-"]:
                if sep in raw:
                    return float(raw.split(sep)[0])
            return float(raw)
        elif parse_mode == "float":
            return float(raw)
        else:  # int or combo handled elsewhere
            return float(raw)
    except (ValueError, TypeError):
        return None


def extract_player_stat(
    summary: dict,
    sport: str,
    player_name: str,
    stat_category: str,
) -> float | None:
    """
    Extracts a player's actual stat from an ESPN game summary box score.
    Returns the numeric value or None if not found.
    """
    stat_category_upper = stat_category.upper().replace(" ", "_").replace("-", "_")
    sport_map = STAT_MAP.get(sport, {})

    # Resolve stat map entry
    entry = sport_map.get(stat_category_upper)
    if entry is None:
        # Try partial match
        for k, v in sport_map.items():
            if k in stat_category_upper or stat_category_upper in k:
                entry = v
                break
    if entry is None:
        print(f"    [BoxScore] Unknown stat category '{stat_category}' for {sport}")
        return None

    espn_key, parse_mode = entry
    is_combo = parse_mode == "combo"

    boxscore = summary.get("boxscore", {})
    teams_data = boxscore.get("players", [])

    for team_data in teams_data:
        stat_groups = team_data.get("statistics", [])

        for group in stat_groups:
            labels = [l.upper() for l in group.get("labels", [])]
            keys   = group.get("keys", [])
            athletes = group.get("athletes", [])

            # Detect group type for NFL disambiguation
            group_type = detect_nfl_group(labels, keys)

            for athlete_entry in athletes:
                athlete = athlete_entry.get("athlete", {})
                name = athlete.get("displayName", "")
                if not player_name_match(name, player_name):
                    continue

                stats = athlete_entry.get("stats", [])
                if not stats:
                    continue

                # ── Combo stat (PTS+REB+AST, G+A, TD sum, etc.) ───────────────
                if is_combo:
                    total = extract_combo_stat(
                        espn_key, labels, stats, sport, stat_category_upper, group_type
                    )
                    if total is not None:
                        return total
                    continue  # try next group

                # ── NFL group disambiguation ────────────────────────────────
                if sport == "NFL":
                    required_group = NFL_GROUPS.get(stat_category_upper)
                    if required_group and group_type and required_group != group_type:
                        continue  # wrong stat group (e.g. skip rushing for PASS_YDS)

                # ── Direct label lookup ─────────────────────────────────────
                espn_label = espn_key.upper()
                if espn_label in labels:
                    idx = labels.index(espn_label)
                    if idx < len(stats):
                        val = parse_stat_value(stats[idx], parse_mode)
                        if val is not None:
                            print(f"    [BoxScore] {name}: {stat_category}={val} (label match)")
                            return val

    return None


def detect_nfl_group(labels: list, keys: list) -> str | None:
    """Infer NFL stat group from its labels."""
    label_str = " ".join(labels).lower()
    key_str   = " ".join(keys).lower()
    if "passing" in key_str or ("c/att" in label_str and "yds" in label_str and "td" in label_str and "int" in label_str):
        return "passing"
    if "rushing" in key_str or ("car" in label_str and "yds" in label_str and "avg" in label_str):
        return "rushing"
    if "receiving" in key_str or ("rec" in label_str and "yds" in label_str and "tgts" in label_str):
        return "receiving"
    if "tackle" in key_str or ("tot" in label_str and "solo" in label_str):
        return "defense"
    return None


def extract_combo_stat(
    combo_key: str,
    labels: list,
    stats: list,
    sport: str,
    stat_category_upper: str,
    group_type: str | None,
) -> float | None:
    """Handles combo stats like PTS+REB+AST, G+A, TD totals."""
    combo_parts = [p.strip().upper() for p in combo_key.split("+")]
    total = 0.0
    found_any = False

    for part in combo_parts:
        if part in labels:
            idx = labels.index(part)
            if idx < len(stats):
                val = parse_stat_value(stats[idx], "int")
                if val is not None:
                    total += val
                    found_any = True

    # NFL TD: sum rushing TDs + receiving TDs + passing TDs
    if sport == "NFL" and stat_category_upper in ("TD", "TOUCHDOWNS"):
        td_labels = ["TD"]
        for lbl in td_labels:
            if lbl in labels:
                idx = labels.index(lbl)
                if idx < len(stats):
                    val = parse_stat_value(stats[idx], "int")
                    if val is not None:
                        total += val
                        found_any = True

    return total if found_any else None


# ── Grade a team bet ───────────────────────────────────────────────────────────

def find_game(scores: list, home_team: str, away_team: str) -> dict | None:
    if not home_team and not away_team:
        return None
    for g in scores:
        home_ok = teams_match(g["home"], home_team) or teams_match(g["home"], away_team)
        away_ok = teams_match(g["away"], away_team) or teams_match(g["away"], home_team)
        if home_ok and away_ok:
            return g
        if teams_match(g["home"], away_team) and teams_match(g["away"], home_team):
            return g
    return None


def find_game_by_team(scores: list, team: str) -> dict | None:
    if not team:
        return None
    for g in scores:
        if teams_match(g["home"], team) or teams_match(g["away"], team):
            return g
    return None


def grade_team_bet(snap: dict, game: dict) -> str | None:
    """
    Grades spread/total/moneyline bets against final scores.
    Returns 'won', 'lost', or 'push'. None if unresolvable.
    """
    bet_type  = (snap.get("betType") or "").lower()
    pick_side = (snap.get("pickSide") or "").lower()
    line      = snap.get("line")
    home      = snap.get("homeTeam", "")
    away      = snap.get("awayTeam", "")

    home_score  = game["homeScore"]
    away_score  = game["awayScore"]
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

    # ── Spread ─────────────────────────────────────────────────────────────────
    if bet_type == "spread" and line is not None:
        try:
            spread = float(line)
        except (TypeError, ValueError):
            return None
        margin = away_score - home_score
        covered_margin = margin + spread
        if abs(covered_margin) < 0.01:
            return "push"
        away_covered = covered_margin > 0
        if pick_side in ("away",) or teams_match(pick_side, away):
            return "won" if away_covered else "lost"
        if pick_side in ("home",) or teams_match(pick_side, home):
            return "won" if not away_covered else "lost"
        return "won" if away_covered else "lost"

    # ── Total ──────────────────────────────────────────────────────────────────
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

    return None


# ── Grade a player prop ────────────────────────────────────────────────────────

def grade_player_prop(snap: dict, summary: dict) -> str | None:
    """
    Grades a player prop against an ESPN game summary.
    Returns 'won', 'lost', 'push', or None if unresolvable.
    """
    player_name   = snap.get("playerName") or snap.get("player_name") or ""
    stat_category = snap.get("statCategory") or snap.get("stat_category") or ""
    line          = snap.get("line")
    pick_side     = (snap.get("pickSide") or "").lower()  # "over" or "under"
    sport         = (snap.get("sport") or "").upper()

    if not player_name or not stat_category or line is None:
        return None

    try:
        line_val = float(line)
    except (TypeError, ValueError):
        return None

    actual = extract_player_stat(summary, sport, player_name, stat_category)

    if actual is None:
        print(f"    [BoxScore] Could not find {player_name} {stat_category} in box score")
        return None

    print(f"    [BoxScore] {player_name} {stat_category}: actual={actual}, line={line_val}, pick={pick_side}")

    # Grade
    if abs(actual - line_val) < 0.01:
        return "push"
    went_over = actual > line_val
    if pick_side == "over":
        return "won" if went_over else "lost"
    if pick_side == "under":
        return "won" if not went_over else "lost"
    return None


# ── Main grader ───────────────────────────────────────────────────────────────

def run_grader() -> dict:
    snapshots  = load_json(SNAPSHOT_FILE, [])
    outcomes   = load_json(OUTCOME_LOG, [])
    graded_ids = set(load_json(GRADED_IDS, []))

    existing_bet_ids = {r.get("betId") for r in outcomes}

    # Only grade picks where the game finished (game_time < now - 3h)
    cutoff = NOW - datetime.timedelta(hours=3)

    pending = []
    for snap in snapshots:
        bid = snap.get("betId") or snap.get("id")
        if bid in existing_bet_ids or bid in graded_ids:
            continue
        gt_str = snap.get("gameTime") or snap.get("game_time")
        btype = (snap.get("betType") or "").lower()

        if not gt_str:
            # Player props logged before gameTime fix: use yesterday as fallback
            # (they were logged for today's games, so yesterday = games already played)
            if btype == "player_prop":
                gt = NOW - datetime.timedelta(days=1)
            else:
                continue  # non-props without gameTime: skip
        else:
            try:
                gt = datetime.datetime.fromisoformat(str(gt_str).replace("Z", "").replace("+00:00", ""))
            except Exception:
                continue

        if gt > cutoff:
            continue
        pending.append(snap)

    print(f"[Grader] {len(pending)} picks to grade out of {len(snapshots)} snapshots")
    sport_counts = {}
    for s in pending:
        sp = normalize_sport(s.get("sport") or "") or "UNKNOWN"
        sport_counts[sp] = sport_counts.get(sp, 0) + 1
    print(f"[Grader] Sport breakdown of pending: {sport_counts}")

    newly_graded = []
    skipped_no_game = 0
    skipped_no_summary = 0
    skipped_no_stat = 0
    errors = 0

    # ── Group by sport ─────────────────────────────────────────────────────────
    by_sport: dict[str, list] = {}
    skipped_unknown_sport = 0
    for snap in pending:
        sport = normalize_sport(snap.get("sport") or "")
        if sport is None or sport not in SPORT_ESPN:
            skipped_unknown_sport += 1
            continue
        by_sport.setdefault(sport, []).append(snap)
    if skipped_unknown_sport:
        print(f"[Grader] Skipped {skipped_unknown_sport} picks with unrecognized sport")

    for sport, snaps in by_sport.items():
        print(f"\n  [Grader] Grading {len(snaps)} {sport} picks...")

        # Collect all unique dates needed
        dates_needed: set[str] = set()
        for snap in snaps:
            gt_str = snap.get("gameTime") or snap.get("game_time", "")
            try:
                dt = datetime.datetime.fromisoformat(str(gt_str).replace("Z", "").replace("+00:00", ""))
                for delta in [-2, -1, 0, 1, 2]:
                    dates_needed.add((dt + datetime.timedelta(days=delta)).strftime("%Y%m%d"))
            except Exception:
                for delta in range(0, 7):
                    dates_needed.add((NOW - datetime.timedelta(days=delta)).strftime("%Y%m%d"))

        # Batch-fetch all scores for this sport
        all_scores: list[dict] = []
        seen_game_ids: set[str] = set()
        for d in sorted(dates_needed):
            for g in fetch_espn_scores(sport, d):
                if g["gameId"] not in seen_game_ids:
                    seen_game_ids.add(g["gameId"])
                    all_scores.append(g)
        print(f"    Fetched {len(all_scores)} completed {sport} games")

        # Summary cache to avoid re-fetching the same game for multiple props
        summary_cache: dict[str, dict | None] = {}

        for snap in snaps:
            bet_type   = (snap.get("betType") or "").lower()
            home       = snap.get("homeTeam", "")
            away       = snap.get("awayTeam", "")
            bid        = snap.get("betId") or snap.get("id")
            game_time  = snap.get("gameTime") or snap.get("game_time")

            game = find_game(all_scores, home, away)
            if not game:
                team3 = snap.get("team") or ""
                for t in [team3, home, away]:
                    if t:
                        game = find_game_by_team(all_scores, t)
                        if game:
                            break

            if not game:
                skipped_no_game += 1
                label = snap.get("playerName") or f"{away} @ {home}"
                print(f"    No completed game found for: {label}")
                continue

            # ── Team bets ──────────────────────────────────────────────────
            if bet_type in ("spread", "total", "moneyline", "ml"):
                result = grade_team_bet(snap, game)
                if result is None:
                    errors += 1
                    continue

            # ── Player props ───────────────────────────────────────────────
            elif bet_type in ("player_prop", "prop"):
                espn_id = game.get("espnId") or game.get("gameId")

                # Try to get espnId if not already on the score object
                if not espn_id or espn_id == "":
                    espn_id = get_espn_id_for_game(sport, home, away, game_time)

                if not espn_id:
                    skipped_no_game += 1
                    print(f"    Could not resolve ESPN ID for: {away} @ {home}")
                    continue

                # Fetch (or use cached) game summary
                if espn_id not in summary_cache:
                    time.sleep(0.3)  # polite rate limiting
                    summary_cache[espn_id] = fetch_espn_game_summary(sport, espn_id)

                summary = summary_cache[espn_id]
                if not summary:
                    skipped_no_summary += 1
                    print(f"    ESPN summary unavailable for game {espn_id}")
                    continue

                result = grade_player_prop(snap, summary)
                if result is None:
                    skipped_no_stat += 1
                    continue

            else:
                # Unknown bet type — skip
                continue

            # ── Record outcome ─────────────────────────────────────────────
            record = {
                "betId":           bid,
                "sport":           sport,
                "betType":         snap.get("betType"),
                "title":           snap.get("title", ""),
                "pickSide":        snap.get("pickSide"),
                "line":            snap.get("line"),
                "playerName":      snap.get("playerName"),
                "statCategory":    snap.get("statCategory"),
                "homeTeam":        home,
                "awayTeam":        away,
                "homeScore":       game.get("homeScore"),
                "awayScore":       game.get("awayScore"),
                "confidenceScore": snap.get("confidenceScore"),
                "formEdgePct":     snap.get("formEdgePct"),
                "hitRate":         snap.get("hitRate"),
                "edgeScore":       snap.get("edgeScore"),
                "edgeGrade":       snap.get("edgeGrade"),
                "edgeSizing":      snap.get("edgeSizing"),
                "gameTime":        game_time,
                "gradedAt":        NOW.isoformat(),
                "result":          result,
                "gameDate":        game.get("date", ""),
                "espnGameId":      game.get("espnId") or game.get("gameId"),
            }

            outcomes.append(record)
            graded_ids.add(bid)
            newly_graded.append(record)

            player_str = f" | {snap.get('playerName')} {snap.get('statCategory')}" if bet_type in ("player_prop", "prop") else ""
            print(f"    ✓ {away} @ {home}{player_str} → {result.upper()} "
                  f"(line={snap.get('line')} pick={snap.get('pickSide')} conf={snap.get('confidenceScore')})")

    # Save
    save_json(OUTCOME_LOG, outcomes)
    save_json(GRADED_IDS, list(graded_ids))

    summary_stats = {
        "graded":            len(newly_graded),
        "skipped_no_game":   skipped_no_game,
        "skipped_no_summary": skipped_no_summary,
        "skipped_no_stat":   skipped_no_stat,
        "errors":            errors,
        "total_outcomes":    len(outcomes),
        "run_at":            NOW.isoformat(),
    }
    print(f"\n[Grader] Done — {summary_stats}")
    return summary_stats


if __name__ == "__main__":
    result = run_grader()
    print(json.dumps(result, indent=2))
