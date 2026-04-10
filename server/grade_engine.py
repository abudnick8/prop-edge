"""
Edge Crew v3 — Compact Grade Engine
Ported from v2's 3K-line engine into a clean, self-contained module.
Pure math grading: variables → composite → chains → final grade.
"""

import math

# ─── Grade Thresholds ──────────────────────────────────────────────────────────

GRADE_THRESHOLDS = [
    (8.0, "A+"), (7.3, "A"), (6.5, "A-"),
    (6.0, "B+"), (5.5, "B"), (5.0, "B-"),
    (4.5, "C+"), (3.5, "C"), (2.5, "D"), (0.0, "F"),
]

SIZING_MAP = {
    "A+": "2u", "A": "1.5u", "A-": "1u", "B+": "1u",
    "B": "PASS", "B-": "PASS", "C+": "PASS", "C": "PASS",
    "D": "PASS", "F": "PASS",
}


def score_to_grade(score: float) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "F"


def score_to_sizing(score: float) -> str:
    return SIZING_MAP.get(score_to_grade(score), "PASS")


def _clamp(val, lo=1, hi=10) -> float:
    return max(lo, min(hi, round(float(val), 1)))


def _parse_record(rec: str | None) -> tuple:
    if not rec:
        return 0, 0
    try:
        parts = rec.split("-")
        return int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return 0, 0


def _win_pct(rec: str | None) -> float:
    w, l = _parse_record(rec)
    return w / (w + l) if (w + l) > 0 else 0.5


# ─── Variable Scoring Functions ────────────────────────────────────────────────
# Each returns (score: 1-10, note: str)

def score_off_ranking(profile: dict, opp: dict, sport: str) -> tuple:
    ppg = profile.get("ppg_L5", 0)
    opp_def = opp.get("opp_ppg_L5", 0)
    if not ppg:
        return 5, "No PPG data"
    breakpoints = {
        "NBA":   [(122,9),(118,7.5),(114,6),(110,5),(105,4),(0,2.5)],
        "NHL":   [(4.0,9),(3.5,7),(3.0,5),(2.5,3.5),(0,2)],
        "MLB":   [(6.0,9),(5.5,7.5),(5.0,6),(4.5,5),(4.0,3.5),(0,2)],
        "NFL":   [(27,9),(24,7.5),(21,6),(18,5),(15,3.5),(0,2)],
        "SOCCER":[(2.5,9),(2.0,7.5),(1.5,6),(1.2,5),(0.8,3.5),(0,2)],
        "NCAAB": [(82,9),(78,7.5),(74,6),(70,5),(65,3.5),(0,2)],
    }
    base = 5
    for threshold, val in breakpoints.get(sport, breakpoints["NBA"]):
        if ppg >= threshold:
            base = val
            break
    if opp_def:
        avg_map = {"NBA": (115, 100), "NHL": (3.5, 2.5), "MLB": (5.5, 3.5), "NFL": (24, 17), "SOCCER": (2.0, 1.0)}
        hi, lo = avg_map.get(sport, (115, 100))
        if opp_def >= hi:
            base += 0.5
        elif opp_def <= lo:
            base -= 0.5
    return _clamp(base), f"PPG L5: {ppg} | OPP allows: {opp_def}"


def score_def_ranking(profile: dict, opp: dict, sport: str) -> tuple:
    opp_ppg = profile.get("opp_ppg_L5", 0)
    if not opp_ppg:
        return 5, "No OPP PPG data"
    breakpoints = {
        "NBA":   [(100,9),(105,7.5),(110,6),(114,5),(118,3.5),(999,2)],
        "NHL":   [(2.0,9),(2.5,7),(3.0,5),(3.5,3.5),(999,2)],
        "MLB":   [(3.0,9),(3.5,7.5),(4.0,6),(4.5,5),(5.5,3.5),(999,2)],
        "NFL":   [(15,9),(18,7.5),(21,6),(24,5),(27,3.5),(999,2)],
        "SOCCER":[(0.5,9),(0.8,7.5),(1.0,6),(1.3,5),(1.8,3.5),(999,2)],
        "NCAAB": [(62,9),(66,7.5),(70,5),(75,3.5),(999,2)],
    }
    base = 5
    for threshold, val in breakpoints.get(sport, breakpoints["NBA"]):
        if opp_ppg <= threshold:
            base = val
            break
    return _clamp(base), f"Allow L5: {opp_ppg}"


def score_recent_form(profile: dict, opp: dict) -> tuple:
    w, l = _parse_record(profile.get("L5"))
    ow, _ = _parse_record(opp.get("L5"))
    streak = profile.get("streak", "")
    margin = profile.get("L5_margin", profile.get("margin_L5", 0))
    if w + l == 0:
        return 5, "No L5 data"
    base = {5: 9, 4: 7, 3: 5, 2: 3.5, 1: 2, 0: 1}.get(w, 5)
    if streak.startswith("W"):
        n = int(streak[1:]) if streak[1:].isdigit() else 0
        base += 1.5 if n >= 6 else (0.5 if n >= 3 else 0)
    elif streak.startswith("L"):
        n = int(streak[1:]) if streak[1:].isdigit() else 0
        base -= 1.5 if n >= 6 else (0.5 if n >= 3 else 0)
    form_edge = w - ow
    if form_edge >= 3: base += 1
    elif form_edge <= -3: base -= 1
    if margin > 10: base += 0.5
    elif margin < -10: base -= 0.5
    return _clamp(base), f"L5: {profile.get('L5','?')} streak:{streak} margin:{margin:+.1f}"


def score_home_away(game: dict, side: str) -> tuple:
    profile = game.get(f"{side}_profile", {})
    is_home = side == "home"
    base = 5.5 if is_home else 4.5
    rec_key = "home_record" if is_home else "away_record"
    w, l = _parse_record(profile.get(rec_key))
    if w + l > 0:
        pct = w / (w + l)
        if pct >= 0.7: base += 2
        elif pct >= 0.55: base += 1
        elif pct <= 0.3: base -= 2
        elif pct <= 0.4: base -= 1
    return _clamp(base), f"{'Home' if is_home else 'Away'}: {profile.get(rec_key, '?')}"


def score_rest_advantage(profile: dict, opp: dict) -> tuple:
    our_rest = profile.get("rest_days")
    opp_rest = opp.get("rest_days")
    our_b2b = profile.get("is_b2b", False)
    opp_b2b = opp.get("is_b2b", False)
    if our_rest is None or opp_rest is None:
        return 5, "Rest data unavailable"
    score = 5
    parts = []
    if opp_b2b and not our_b2b:
        score += 3; parts.append("OPP on B2B")
    elif our_b2b and not opp_b2b:
        score -= 3; parts.append("WE on B2B")
    rest_diff = (our_rest or 0) - (opp_rest or 0)
    if rest_diff >= 3: score += 2
    elif rest_diff >= 1: score += 1
    elif rest_diff <= -3: score -= 2
    elif rest_diff <= -1: score -= 1
    return _clamp(score), f"Us:{our_rest}d Them:{opp_rest}d {'; '.join(parts)}"


def score_h2h(profile: dict) -> tuple:
    h2h = profile.get("h2h_season", "0-0")
    w, l = _parse_record(h2h)
    if w + l == 0:
        return 5, "No H2H"
    pct = w / (w + l)
    if pct >= 0.75 and w + l >= 2: score = 9
    elif pct >= 0.6: score = 7
    elif pct == 0.5: score = 5
    elif pct <= 0.25 and w + l >= 2: score = 2
    elif pct <= 0.4: score = 3
    else: score = 5
    return _clamp(score), f"H2H: {h2h}"


def score_star_player(game: dict, side: str) -> tuple:
    opp_side = "away" if side == "home" else "home"
    opp_inj = game.get("injuries", {}).get(opp_side, [])
    our_inj = game.get("injuries", {}).get(side, [])
    opp_impact = our_impact = 0
    for inj in opp_inj:
        if inj.get("status") in ("OUT", "DOUBTFUL"):
            ppg = inj.get("ppg", 0)
            disc = 0.5 if inj.get("freshness") in ("ESTABLISHED", "SEASON") else 1.0
            opp_impact += (3 if ppg >= 20 else 2 if ppg >= 12 else 0.5) * disc
    for inj in our_inj:
        if inj.get("status") in ("OUT", "DOUBTFUL"):
            ppg = inj.get("ppg", 0)
            disc = 0.5 if inj.get("freshness") in ("ESTABLISHED", "SEASON") else 1.0
            our_impact += (3 if ppg >= 20 else 2 if ppg >= 12 else 0.5) * disc
    return _clamp(5 + opp_impact - our_impact), f"Injury diff: +{opp_impact:.1f} -{our_impact:.1f}"


def score_depth_injuries(game: dict, side: str) -> tuple:
    opp_side = "away" if side == "home" else "home"
    opp_out = len([i for i in game.get("injuries", {}).get(opp_side, []) if i.get("status") in ("OUT", "DOUBTFUL")])
    our_out = len([i for i in game.get("injuries", {}).get(side, []) if i.get("status") in ("OUT", "DOUBTFUL")])
    diff = opp_out - our_out
    if diff >= 4: score = 9
    elif diff >= 2: score = 7
    elif diff >= 0: score = 5
    elif diff >= -2: score = 4
    else: score = 2
    return _clamp(score), f"Them:{opp_out} out Us:{our_out} out"


def score_line_movement(game: dict) -> tuple:
    shifts = game.get("shifts", {})
    delta = abs(shifts.get("spread_delta", 0))
    if delta >= 3: return 9, f"BIG MOVE: {delta:.1f} pts"
    elif delta >= 1.5: return 7, f"Sig move: {delta:.1f} pts"
    elif delta >= 0.5: return 5, f"Moved {delta:.1f} pts"
    return 5, "Line flat"


def score_ats_trend(profile: dict) -> tuple:
    margin = profile.get("avg_margin_L10", 0)
    if margin >= 10: return 9, f"Margin L10: {margin:+.1f}"
    elif margin >= 5: return 7, f"Margin L10: {margin:+.1f}"
    elif margin >= 0: return 5, f"Margin L10: {margin:+.1f}"
    elif margin >= -5: return 4, f"Margin L10: {margin:+.1f}"
    return 2, f"Margin L10: {margin:+.1f}"


def score_road_trip(profile: dict) -> tuple:
    road = profile.get("road_trip_len", 0)
    home = profile.get("home_stand_len", 0)
    if home >= 4: return 6, f"Home stand: {home}"
    elif home >= 2: return 5.5, f"Home stand: {home}"
    elif road >= 5: return 2, f"Road trip: {road}"
    elif road >= 3: return 4, f"Road trip: {road}"
    return 5, "Neutral"


def score_pace_matchup(profile: dict, opp: dict, sport: str) -> tuple:
    our = profile.get("pace_L5", 0)
    their = opp.get("pace_L5", 0)
    if not our or not their:
        return 5, "No pace data"
    diff = abs(our - their)
    if sport == "NBA":
        if our >= 235 and their >= 235: return 5.5, "FAST matchup"
        elif our <= 210 and their <= 210: return 5, "Grind game"
        elif diff >= 20: return 3.5, f"PACE MISMATCH: {diff:.0f}"
    if sport == "NHL":
        # pace_L5 = combined shots-for + shots-against per game from
        # services.nhl_pace. League average ~60; high-pace 65+; grind <55.
        avg = (our + their) / 2
        if avg >= 65:
            return 7.0, f"FAST matchup ({avg:.1f} sh/g)"
        elif avg <= 55:
            return 4.0, f"Grind game ({avg:.1f} sh/g)"
        elif diff >= 8:
            return 6.0, f"Pace mismatch: {diff:.1f} sh/g"
        return 5.5, f"Pace diff: {diff:.1f} sh/g"
    if sport in ("NFL", "NCAAF"):
        # pace_L5 = offensive plays per game from services.espn_pace.
        # NFL average ~63 plays/game; high-tempo 68+; slow grind <58.
        avg = (our + their) / 2
        if avg >= 68:
            return 7.0, f"HIGH-TEMPO ({avg:.1f} plays/g)"
        elif avg <= 58:
            return 4.0, f"Slow grind ({avg:.1f} plays/g)"
        elif diff >= 5:
            return 6.0, f"Pace mismatch: {diff:.1f} plays/g"
        return 5.5, f"Pace diff: {diff:.1f} plays/g"
    if sport == "NCAAB":
        # pace_L5 = possessions proxy (FGA + 0.44*FTA) per game.
        # CBB average ~70 possessions; high-pace 75+; grind <65.
        avg = (our + their) / 2
        if avg >= 75:
            return 7.0, f"FAST matchup ({avg:.1f} pos/g)"
        elif avg <= 65:
            return 4.0, f"Grind game ({avg:.1f} pos/g)"
        elif diff >= 7:
            return 6.0, f"Pace mismatch: {diff:.1f} pos/g"
        return 5.5, f"Pace diff: {diff:.1f} pos/g"
    return 5, f"Pace diff: {diff:.0f}"


# ─── NBA-Specific Scorers (quarter splits, late-game closing, bench) ──────────

def score_late_game_strength(game: dict, side: str) -> tuple:
    """NBA Phoenix-blows-leads variable. Reads profile.nba_quarters.

    5.0 neutral, >=7.5 strong closer, <=2.5 collapse-prone.
    Marks unavailable upstream when no quarter data is present.
    """
    profile = game.get(f"{side}_profile", {}) or {}
    q = profile.get("nba_quarters") or {}
    if not q:
        return 5.0, "no quarter data"
    blown = q.get("leads_blown_l10", 0) or 0
    comebacks = q.get("comebacks_l10", 0) or 0
    label = q.get("label", "L10")
    score = 5.0 + (comebacks - blown) * 1.25
    if blown >= 3 and comebacks == 0:
        score = min(score, 2.5)
    if blown == 0 and comebacks >= 2:
        score = max(score, 7.5)
    note = f"closing {label}: blown {blown} / comebacks {comebacks}"
    if score >= 7.5:
        note += " (strong closer)"
    elif score <= 2.5:
        note += " (collapse-prone)"
    return _clamp(score), note


def score_quarter_pace(game: dict, side: str) -> tuple:
    """NBA quarter rhythm vs opponent. Reads q1/q4 averages from
    nba_quarters for both teams. Anchored at 5.0; +/-1 per matched edge.
    """
    opp_side = "away" if side == "home" else "home"
    us = (game.get(f"{side}_profile", {}) or {}).get("nba_quarters") or {}
    them = (game.get(f"{opp_side}_profile", {}) or {}).get("nba_quarters") or {}
    if not us or not them:
        return 5.0, "no quarter data"

    base = 5.0
    parts = []

    our_q1_for = us.get("q1_avg_for", 0) or 0
    opp_q1_def = them.get("q1_avg_against", 0) or 0
    if our_q1_for >= 28 and opp_q1_def >= 28:
        base += 1
        parts.append("Q1 attack vs weak Q1 D")
    elif our_q1_for <= 24 and opp_q1_def <= 24:
        base -= 0.5
        parts.append("Q1 mismatch against us")

    our_q4_for = us.get("q4_avg_for", 0) or 0
    opp_q4_def = them.get("q4_avg_against", 0) or 0
    if our_q4_for >= 27 and opp_q4_def >= 27:
        base += 1
        parts.append("Q4 closing edge")
    elif our_q4_for <= 22 and opp_q4_def <= 22:
        base -= 0.5
        parts.append("Q4 stalls")

    note = ", ".join(parts) if parts else "neutral quarter rhythm"
    return _clamp(base), note


def score_bench_diff(game: dict, side: str) -> tuple:
    """NBA second-unit minutes. Reads profile.bench_ppg_l5 for both sides.
    Marks unavailable upstream when not populated.
    Score = 5.0 + ((our_bench - opp_bench) / 5).
    """
    opp_side = "away" if side == "home" else "home"
    us = (game.get(f"{side}_profile", {}) or {}).get("bench_ppg_l5")
    them = (game.get(f"{opp_side}_profile", {}) or {}).get("bench_ppg_l5")
    if us is None or them is None:
        return 5.0, "no bench data"
    diff = float(us) - float(them)
    score = 5.0 + (diff / 5.0)
    return _clamp(score), f"bench L5: us {us} / them {them} ({diff:+.1f})"


# ─── Sport-Specific Variables ──────────────────────────────────────────────────

# MLB pitcher tier — derived from REAL MLB Stats API ERA + IP, not a
# hardcoded reputation list. There is no such thing as an "ace pitcher" by
# name; there is a pitcher whose current-season ERA over a meaningful sample
# says he is pitching like one. Skenes is "ace" because 2.39 ERA over 30+ IP,
# not because someone wrote him down. Tonight's kill of KNOWN_ACE_PITCHERS.
# Kept as an empty dict for any legacy import that still expects the symbol.
KNOWN_ACE_PITCHERS: dict = {}

PITCHER_TIER_VALUES = {"ace": 3.0, "good": 1.5, "unknown": 0.0, "bad": -2.0}


def _pitcher_tier_from_stats(sp: dict) -> str:
    """Classify a starting pitcher from real MLB Stats API numbers.

    Bands (current-season SP, industry-standard):
        ERA <= 3.00 + IP >= 30  -> ace
        ERA <= 3.80 + IP >= 20  -> good
        ERA >= 5.00 + IP >= 20  -> bad
        otherwise (or no sample) -> unknown
    """
    if not isinstance(sp, dict):
        return "unknown"
    era_raw = sp.get("era") if sp.get("era") is not None else sp.get("ERA")
    ip_raw = sp.get("ip") if sp.get("ip") is not None else sp.get("IP")
    if era_raw is None:
        return "unknown"
    try:
        era = float(era_raw)
        ip = float(ip_raw) if ip_raw is not None else 0.0
    except (TypeError, ValueError):
        return "unknown"
    if ip < 20:
        return "unknown"
    if era <= 3.00 and ip >= 30:
        return "ace"
    if era <= 3.80:
        return "good"
    if era >= 5.00:
        return "bad"
    return "unknown"


def _pitcher_tier_lookup(sp_or_name) -> str:
    """Backwards-compatible shim. Accepts either an sp dict (preferred) or
    a bare name string (legacy). Name-only callers always get "unknown" now
    because there is no name-based lookup table anymore."""
    if isinstance(sp_or_name, dict):
        return _pitcher_tier_from_stats(sp_or_name)
    return "unknown"


# Hitter-friendly parks (boost offense for hitters, hurt pitchers)
HITTER_FRIENDLY_PARKS_GE = {
    "Colorado Rockies", "Cincinnati Reds", "Texas Rangers",
    "New York Yankees", "Boston Red Sox", "Philadelphia Phillies",
}

# Park factors — FanGraphs 3-year park factor (100 = neutral, >100 = hitter
# friendly, <100 = pitcher friendly). Keyed by team display name as it
# appears in our ESPN/Odds data layer. Used by score_park_factor and the
# COORS_OVER chain. Updated for 2026 season; refresh annually.
PARK_FACTORS = {
    "Colorado Rockies":      112,  # Coors Field — most extreme hitter park
    "Cincinnati Reds":       105,  # Great American Ball Park
    "Texas Rangers":         104,  # Globe Life Field
    "Philadelphia Phillies": 104,  # Citizens Bank Park
    "Fenway Park":           103,  # placeholder if mapped by stadium name
    "Boston Red Sox":        103,  # Fenway Park
    "New York Yankees":      103,  # Yankee Stadium
    "Chicago Cubs":          102,  # Wrigley Field
    "Atlanta Braves":        102,  # Truist Park
    "Baltimore Orioles":     102,  # Camden Yards
    "Arizona Diamondbacks":  101,  # Chase Field
    "Toronto Blue Jays":     101,  # Rogers Centre
    "Milwaukee Brewers":     101,  # American Family Field
    "Pittsburgh Pirates":    100,  # PNC Park (neutral)
    "Detroit Tigers":        100,  # Comerica Park
    "Houston Astros":        100,  # Minute Maid Park
    "Washington Nationals":   99,  # Nationals Park
    "New York Mets":          99,  # Citi Field
    "Minnesota Twins":        99,  # Target Field
    "Cleveland Guardians":    99,  # Progressive Field
    "St. Louis Cardinals":    98,  # Busch Stadium
    "Chicago White Sox":      98,  # Guaranteed Rate Field
    "Kansas City Royals":     98,  # Kauffman Stadium
    "Los Angeles Angels":     97,  # Angel Stadium
    "Los Angeles Dodgers":    97,  # Dodger Stadium
    "Athletics":              96,  # Sutter Health Park (Sacramento)
    "San Francisco Giants":   96,  # Oracle Park
    "Seattle Mariners":       95,  # T-Mobile Park
    "Miami Marlins":          94,  # LoanDepot Park
    "San Diego Padres":       94,  # Petco Park
    "Tampa Bay Rays":         92,  # Tropicana Field — most extreme pitcher park
}


def score_park_factor(game: dict, side: str) -> tuple:
    """Score the home park's offensive bias for the picking side.

    Park factor is a SIDE signal not just a totals signal — a hitter-friendly
    park advantages a strong-hitting team picking the run line, and a
    pitcher-friendly park advantages a strong-pitching team picking the win.
    Returns (score, note). Score 5.0 = neutral.
    """
    home_team = game.get("homeTeam", "") or game.get("home_team", "")
    pf = PARK_FACTORS.get(home_team)
    if pf is None:
        return 5.0, "park factor: unknown park"

    profile = game.get(f"{side}_profile", {}) or {}
    sp = profile.get("starting_pitcher", {}) or {}
    sp_tier = _pitcher_tier_from_stats(sp)
    ppg_l5 = profile.get("ppg_L5", 0) or 0

    # Hitter-friendly park (>= 105) — strong boost for offense
    if pf >= 105:
        if ppg_l5 >= 5.0:
            return 8.5, f"hitter-friendly park ({pf}) + L5 offense {ppg_l5}"
        return 6.5, f"hitter-friendly park ({pf})"

    # Mildly hitter friendly (102-104)
    if pf >= 102:
        if ppg_l5 >= 5.0:
            return 6.5, f"mildly hitter-friendly park ({pf}) + L5 offense {ppg_l5}"
        return 5.5, f"mildly hitter-friendly park ({pf})"

    # Mildly pitcher friendly (96-98)
    if 96 <= pf <= 98:
        if side == "home" and sp_tier in ("ace", "good"):
            return 6.5, f"mildly pitcher-friendly park ({pf}) + {sp_tier} home starter"
        return 5.0, f"mildly pitcher-friendly park ({pf})"

    # Strongly pitcher friendly (<= 95)
    if pf <= 95:
        if side == "home" and sp_tier == "ace":
            return 8.0, f"pitcher-friendly park ({pf}) + ACE home starter"
        if side == "home" and sp_tier == "good":
            return 7.0, f"pitcher-friendly park ({pf}) + good home starter"
        return 4.0, f"pitcher-friendly park ({pf}) — offense suppressed"

    # 99-101 = neutral
    return 5.0, f"neutral park ({pf})"


# MLB plate umpire K%/BB% tendencies — public dataset compiled from
# Umpire Auditor / Baseball Savant. Refresh annually. Anchored at league
# average K% ~22.5, BB% ~8.4. Names match StatsAPI officials displayName.
UMPIRE_TENDENCIES = {
    # High-K umps (favor pitchers)
    "Angel Hernandez":    {"k_pct": 24.1, "bb_pct": 7.8},
    "Doug Eddings":       {"k_pct": 23.8, "bb_pct": 7.6},
    "Ron Kulpa":          {"k_pct": 23.6, "bb_pct": 8.2},
    "Mark Wegner":        {"k_pct": 23.5, "bb_pct": 8.0},
    "Marvin Hudson":      {"k_pct": 23.4, "bb_pct": 7.9},
    "C.B. Bucknor":       {"k_pct": 23.4, "bb_pct": 8.5},
    "Larry Vanover":      {"k_pct": 23.3, "bb_pct": 8.1},
    "Hunter Wendelstedt": {"k_pct": 23.3, "bb_pct": 8.0},
    "Vic Carapazza":      {"k_pct": 23.2, "bb_pct": 8.3},
    "Tony Randazzo":      {"k_pct": 23.1, "bb_pct": 8.0},
    "Bill Welke":         {"k_pct": 23.1, "bb_pct": 8.4},
    "Jansen Visconti":    {"k_pct": 23.0, "bb_pct": 8.2},
    "Sean Barber":        {"k_pct": 22.9, "bb_pct": 8.5},
    "Phil Cuzzi":         {"k_pct": 22.8, "bb_pct": 8.7},
    # League-average umps (~22.5 K%)
    "Andy Fletcher":      {"k_pct": 22.6, "bb_pct": 8.3},
    "Chris Conroy":       {"k_pct": 22.6, "bb_pct": 8.5},
    "Ed Hickox":          {"k_pct": 22.5, "bb_pct": 8.4},
    "Greg Gibson":        {"k_pct": 22.5, "bb_pct": 8.4},
    "Adrian Johnson":     {"k_pct": 22.5, "bb_pct": 8.6},
    "Will Little":        {"k_pct": 22.4, "bb_pct": 8.5},
    "Mike Estabrook":     {"k_pct": 22.4, "bb_pct": 8.7},
    "Jordan Baker":       {"k_pct": 22.3, "bb_pct": 8.5},
    "Tripp Gibson":       {"k_pct": 22.3, "bb_pct": 8.6},
    "Pat Hoberg":         {"k_pct": 22.3, "bb_pct": 8.4},
    "Cory Blaser":        {"k_pct": 22.2, "bb_pct": 8.5},
    "Brian Knight":       {"k_pct": 22.2, "bb_pct": 8.6},
    "Stu Scheurwater":    {"k_pct": 22.1, "bb_pct": 8.5},
    "Carlos Torres":      {"k_pct": 22.1, "bb_pct": 8.7},
    "Quinn Wolcott":      {"k_pct": 22.0, "bb_pct": 8.5},
    "Dan Iassogna":       {"k_pct": 22.0, "bb_pct": 8.4},
    "Manny Gonzalez":     {"k_pct": 22.0, "bb_pct": 8.6},
    # Low-K umps (favor hitters)
    "Joe West":           {"k_pct": 21.8, "bb_pct": 8.9},  # retired but cached
    "Lance Barrett":      {"k_pct": 21.8, "bb_pct": 9.0},
    "Bruce Dreckman":     {"k_pct": 21.7, "bb_pct": 9.1},
    "Alan Porter":        {"k_pct": 21.6, "bb_pct": 8.9},
    "James Hoye":         {"k_pct": 21.6, "bb_pct": 9.0},
    "Nic Lentz":          {"k_pct": 21.5, "bb_pct": 8.9},
    "John Tumpane":       {"k_pct": 21.4, "bb_pct": 9.0},
    "Bill Miller":        {"k_pct": 21.3, "bb_pct": 9.1},
    "Mike Muchlinski":    {"k_pct": 21.3, "bb_pct": 9.0},
    "Junior Valentine":   {"k_pct": 21.2, "bb_pct": 9.1},
    "Mark Carlson":       {"k_pct": 21.1, "bb_pct": 9.2},
    "Brian O'Nora":       {"k_pct": 21.0, "bb_pct": 8.9},
    "Tom Hallion":        {"k_pct": 20.9, "bb_pct": 9.0},
    "Laz Diaz":           {"k_pct": 20.8, "bb_pct": 9.2},
    "Lance Barksdale":    {"k_pct": 20.7, "bb_pct": 9.0},
    "Brian Gorman":       {"k_pct": 20.6, "bb_pct": 9.3},
}

LEAGUE_AVG_K_PCT = 22.5
LEAGUE_AVG_BB_PCT = 8.4


def score_umpire(game: dict, side: str) -> tuple:
    """Score the impact of the home plate umpire's K% / BB% tendency on the
    picking team. A high-K ump favors strong pitching teams (boost pitcher
    side); a low-K ump favors strong hitting teams.

    Reads game.umpire which is populated by data_fetch_mlb._fetch_sync from
    StatsAPI gameData.officials. Returns (score, note).
    """
    ump = game.get("umpire") or {}
    name = ump.get("name", "")
    if not name:
        return 5.0, "no umpire data"

    tend = UMPIRE_TENDENCIES.get(name)
    if not tend:
        return 5.0, f"umpire {name} (unknown tendency)"

    k_pct = tend["k_pct"]
    k_delta = k_pct - LEAGUE_AVG_K_PCT  # positive = high-K ump

    profile = game.get(f"{side}_profile", {}) or {}
    sp = profile.get("starting_pitcher", {}) or {}
    sp_tier = _pitcher_tier_from_stats(sp)

    # High-K ump (>22.8) + ace/good pitcher on the picking side = boost
    # Low-K ump (<22.2) + strong offense (ppg_L5 >= 5) = boost
    if k_delta >= 0.5 and sp_tier in ("ace", "good"):
        return 7.5, f"{name} K% {k_pct} (high-K) + {sp_tier} starter"
    if k_delta <= -0.5:
        ppg = profile.get("ppg_L5", 0) or 0
        if ppg >= 5.0:
            return 7.0, f"{name} K% {k_pct} (low-K) + L5 offense {ppg}"
        return 5.5, f"{name} K% {k_pct} (low-K)"
    if k_delta >= 0.5:
        return 6.0, f"{name} K% {k_pct} (high-K)"
    return 5.0, f"{name} K% {k_pct} (neutral)"


def score_lineup_vs_hand(game: dict, side: str) -> tuple:
    """Score the picking team's offensive matchup vs the opposing starter's
    handedness. Reads profile.lineup_vs_hand which is populated by
    data_fetch_mlb._extract_team_splits_vs_hand.

    Anchors at .720 OPS = neutral 5.0. Each .020 OPS difference moves the
    score by ~1 point. Returns (score, note).
    """
    profile = game.get(f"{side}_profile", {}) or {}
    splits = profile.get("lineup_vs_hand") or {}
    if not splits or splits.get("ops_vs_hand") is None:
        return 5.0, "no lineup vs hand splits"

    ops = splits.get("ops_vs_hand", 0.720)
    hand = splits.get("vs_hand", "?")
    avg = splits.get("avg_vs_hand")
    hr = splits.get("hr_vs_hand")

    # OPS .720 = neutral 5.0, each .020 above moves +1
    score = 5.0 + (ops - 0.720) * 50

    note_parts = [f"OPS {ops:.3f} vs {hand}HP"]
    if avg is not None:
        note_parts.append(f"AVG .{int(avg*1000):03d}")
    if hr is not None:
        note_parts.append(f"{hr} HR")
    return _clamp(score), " ".join(note_parts)


def score_bullpen(game: dict, side: str) -> tuple:
    """Score MLB bullpen quality + freshness from MLB Stats API L7 walk.

    Reads profile.bullpen which is populated by data_fetch_mlb._extract_bullpen_stats
    and contains: bullpen_era_L7, bullpen_ip_L7, bullpen_tired_arms,
    bullpen_relief_games, team_era_season.

    Returns (score, note). Score 5.0 = neutral, lower for tired/bad bullpens,
    higher for fresh/elite bullpens.
    """
    profile = game.get(f"{side}_profile", {}) or {}
    bp = profile.get("bullpen") or {}
    if not bp or "bullpen_era_L7" not in bp:
        return 5.0, "no bullpen data"

    era_L7 = bp.get("bullpen_era_L7", 4.00)
    tired = bp.get("bullpen_tired_arms", 0)
    season_era = bp.get("team_era_season")

    # Score from L7 ERA: lower = better. Anchor 4.00 = neutral 5.0.
    # Each 0.5 ERA difference moves score by ~1 point.
    score = 5.0 + (4.00 - era_L7) * 2.0
    # Penalty for tired arms (3+ appearances in 7 days)
    if tired >= 3:
        score -= 1.5
    elif tired >= 2:
        score -= 0.75
    # Bonus when L7 ERA is significantly better than season ERA (heating up)
    if season_era and era_L7 < season_era - 0.75:
        score += 0.5
    # Penalty when L7 ERA is significantly worse than season (slumping)
    if season_era and era_L7 > season_era + 0.75:
        score -= 0.5

    note = f"bullpen ERA L7 {era_L7}"
    if tired:
        note += f", {tired} tired arm{'s' if tired != 1 else ''}"
    if season_era:
        note += f" (season {season_era})"
    return _clamp(score), note


# Sentinel prefix in the note so grade_game can mark this variable unavailable
_SP_PROXY_NOTE_PREFIX = "SP unknown"


def score_starting_pitcher(game: dict, side: str) -> tuple:
    """Score MLB starting pitcher. Tier (Skenes/Skubal/etc.) is the primary
    driver — ERA differential is a tiebreaker bonus, margin proxy is the
    last resort and marks itself unavailable via note prefix so the engine
    knows not to trust it.
    """
    sp = game.get(f"{side}_profile", {}).get("starting_pitcher", {}) or {}
    opp_sp = game.get(f"{'away' if side == 'home' else 'home'}_profile", {}).get("starting_pitcher", {}) or {}

    our_name = sp.get("name", "")
    opp_name = opp_sp.get("name", "")
    our_tier = _pitcher_tier_from_stats(sp)
    opp_tier = _pitcher_tier_from_stats(opp_sp)
    our_val = PITCHER_TIER_VALUES[our_tier]
    opp_val = PITCHER_TIER_VALUES[opp_tier]

    # Primary driver: tier delta (Skenes vs unknown = +3.0 → score 8.0)
    if our_tier != "unknown" or opp_tier != "unknown":
        delta = our_val - opp_val
        score = _clamp(5 + delta)
        # ERA bonus (small) when both ERAs available
        era = sp.get("era") or sp.get("ERA")
        opp_era = opp_sp.get("era") or opp_sp.get("ERA")
        if era and opp_era:
            try:
                era_diff = float(opp_era) - float(era)
                score = _clamp(score + era_diff * 0.3)
            except (ValueError, TypeError):
                pass
        # Park penalty: pitcher at hitter-friendly park
        home_team = game.get("homeTeam", "")
        if side == "home" and home_team in HITTER_FRIENDLY_PARKS_GE:
            score = _clamp(score - 0.5)
        return score, f"SP tier: {our_name or '?'} ({our_tier}) vs {opp_name or '?'} ({opp_tier})"

    # Last resort: margin proxy. Read CORRECT field name (L5_margin, not
    # margin_L5 — old bug). Note prefix marks this as unavailable.
    profile = game.get(f"{side}_profile", {}) or {}
    margin = profile.get("L5_margin", profile.get("margin_L5", 0)) or 0
    try:
        margin = float(margin)
    except (ValueError, TypeError):
        margin = 0.0
    return _clamp(5 + margin / 3), f"{_SP_PROXY_NOTE_PREFIX} ({our_name or 'TBD'} vs {opp_name or 'TBD'}) — proxy from L5 margin {margin:+.1f}"


# Hardcoded elite/good NHL goalies — fallback when SV% data not available.
# Names lowercased for matching; check by last name.
ELITE_NHL_GOALIES = {
    "hellebuyck", "sorokin", "vasilevskiy", "shesterkin", "bobrovsky",
    "saros", "markstrom", "oettinger", "hill", "kuemper", "swayman",
    "ullmark", "skinner", "demko", "hart", "gibson", "talbot", "stolarz",
}
GOOD_NHL_GOALIES = {
    "andersen", "husso", "husarek", "mrazek", "binnington", "georgiev",
    "jarry", "blackwood", "vanecek", "lyon", "merzlikins", "kahkonen",
    "wedgewood", "samsonov", "knight", "varlamov", "luukkonen",
}


def _goalie_tier(name: str) -> str | None:
    if not name:
        return None
    last = name.strip().lower().split()[-1]
    if last in ELITE_NHL_GOALIES:
        return "ELITE"
    if last in GOOD_NHL_GOALIES:
        return "GOOD"
    return None


def _normalize_sv_pct(val) -> float | None:
    """Normalize a SV% value into a 0-1 fraction, or None if junk."""
    if val is None:
        return None
    try:
        s = float(val)
    except (ValueError, TypeError):
        return None
    if s > 1.5:
        s /= 100.0
    if 0.80 <= s <= 1.0:
        return s
    return None


def score_starting_goalie(game: dict, side: str) -> tuple:
    """NHL goalie scorer — tier-first, SV% bonus on top.

    Mirrors the MLB pitcher template (commit d707fc8): tier delta is the
    primary signal, SV% is a small modifier. Returns (score, note).
    Score ladder:
      ELITE  -> 8.5 base
      GOOD   -> 7.0 base
      UNKNOWN-> 5.0 base
    SV% modifier on OUR goalie:
      > .920 -> +0.5
      > .910 -> +0.25
      < .890 -> -0.5
    Then add +/- 1.5 for the opponent tier delta so this variable is a
    relative matchup score, not just a solo grade.
    """
    profile = game.get(f"{side}_profile", {}) or {}
    opp_profile = game.get(f"{'away' if side == 'home' else 'home'}_profile", {}) or {}
    g = profile.get("starting_goalie") or {}
    opp_g = opp_profile.get("starting_goalie") or {}

    our_name = g.get("name") or profile.get("recent_starter") or profile.get("goalie")
    opp_name = opp_g.get("name") or opp_profile.get("recent_starter") or opp_profile.get("goalie")

    if not our_name and not opp_name:
        return 5, "No goalie data"

    tier_base = {"ELITE": 8.5, "GOOD": 7.0, None: 5.0}
    our_tier = _goalie_tier(our_name) if our_name else None
    opp_tier = _goalie_tier(opp_name) if opp_name else None

    score = tier_base[our_tier]

    # SV% bonus on our goalie (tier ladder remains primary)
    our_sv = _normalize_sv_pct(g.get("sv_pct") or g.get("SV%") or g.get("svp"))
    opp_sv = _normalize_sv_pct(opp_g.get("sv_pct") or opp_g.get("SV%") or opp_g.get("svp"))
    if our_sv is not None:
        if our_sv > 0.920:
            score += 0.5
        elif our_sv > 0.910:
            score += 0.25
        elif our_sv < 0.890:
            score -= 0.5

    # Opponent delta (half weight so tier remains primary)
    score += (tier_base[our_tier] - tier_base[opp_tier]) * 0.3

    our_label = our_tier or "UNKNOWN"
    opp_label = opp_tier or "UNKNOWN"
    our_sv_txt = f" {our_sv:.3f}" if our_sv is not None else ""
    opp_sv_txt = f" {opp_sv:.3f}" if opp_sv is not None else ""
    note = (f"Goalie: {our_name or '?'} ({our_label}{our_sv_txt}) "
            f"vs {opp_name or '?'} ({opp_label}{opp_sv_txt})")
    return _clamp(score), note


# ─── Soccer Hardcoded Knowledge ───────────────────────────────────────────────
# Top scorer / key creator per top-flight club. Keyed by lowercased team
# displayName / shortDisplayName (both variants matched). Values are
# lowercase last names of the primary goal-source. A single missing starter
# here (Haaland, Mbappe, Kane, Salah) is worth ~0.5-0.8 goals in the model
# and is the equivalent of an NBA star-player edge.
ELITE_SOCCER_STRIKERS = {
    # Premier League
    "manchester city": ["haaland", "de bruyne", "foden"],
    "man city": ["haaland", "de bruyne", "foden"],
    "arsenal": ["saka", "odegaard", "havertz"],
    "liverpool": ["salah", "nunez", "diaz"],
    "tottenham": ["son", "solanke", "maddison"],
    "tottenham hotspur": ["son", "solanke", "maddison"],
    "chelsea": ["palmer", "jackson", "madueke"],
    "manchester united": ["fernandes", "rashford", "hojlund"],
    "man united": ["fernandes", "rashford", "hojlund"],
    "newcastle": ["isak", "gordon", "bruno"],
    "newcastle united": ["isak", "gordon", "bruno"],
    "aston villa": ["watkins", "rogers", "mcginn"],
    "west ham": ["bowen", "kudus", "paqueta"],
    "west ham united": ["bowen", "kudus", "paqueta"],
    "brighton": ["mitoma", "joao pedro", "welbeck"],
    "brighton & hove albion": ["mitoma", "joao pedro", "welbeck"],
    "brentford": ["mbeumo", "wissa"],
    "crystal palace": ["eze", "mateta", "olise"],
    "fulham": ["muniz", "iwobi", "pereira"],
    "wolverhampton wanderers": ["cunha", "hwang", "sarabia"],
    "wolves": ["cunha", "hwang", "sarabia"],
    "nottingham forest": ["wood", "hudson-odoi", "gibbs-white"],
    "everton": ["calvert-lewin", "ndiaye", "mcneil"],
    "bournemouth": ["evanilson", "semenyo", "kluivert"],
    "ipswich town": ["delap", "hirst"],
    "leicester city": ["vardy", "mavididi"],
    "southampton": ["armstrong", "dibling"],
    # La Liga
    "real madrid": ["mbappe", "vinicius", "bellingham", "rodrygo"],
    "barcelona": ["lewandowski", "yamal", "raphinha", "pedri"],
    "atletico madrid": ["griezmann", "alvarez", "morata"],
    "atletico": ["griezmann", "alvarez", "morata"],
    "athletic club": ["williams", "guruzeta"],
    "athletic bilbao": ["williams", "guruzeta"],
    "real sociedad": ["oyarzabal", "becker", "kubo"],
    "real betis": ["isco", "bakambu", "ezzalzouli"],
    "villarreal": ["moreno", "baena", "barry"],
    "sevilla": ["romero", "rafa mir", "lukebakio"],
    "valencia": ["hugo duro", "canos"],
    "girona": ["stuani", "tsygankov", "portu"],
    # Serie A
    "inter milan": ["lautaro martinez", "thuram", "calhanoglu"],
    "inter": ["lautaro martinez", "thuram", "calhanoglu"],
    "ac milan": ["leao", "pulisic", "morata", "reijnders"],
    "milan": ["leao", "pulisic", "morata", "reijnders"],
    "juventus": ["vlahovic", "yildiz", "koopmeiners"],
    "napoli": ["lukaku", "kvaratskhelia", "mctominay", "politano"],
    "roma": ["dybala", "dovbyk", "pellegrini"],
    "as roma": ["dybala", "dovbyk", "pellegrini"],
    "lazio": ["zaccagni", "castellanos", "dia"],
    "atalanta": ["retegui", "lookman", "de ketelaere"],
    "fiorentina": ["kean", "beltran", "gudmundsson"],
    "bologna": ["orsolini", "castro", "ndoye"],
    "torino": ["zapata", "sanabria"],
    # Bundesliga
    "bayern munich": ["kane", "musiala", "sane", "olise"],
    "fc bayern munchen": ["kane", "musiala", "sane", "olise"],
    "bayer leverkusen": ["wirtz", "boniface", "schick", "frimpong"],
    "borussia dortmund": ["adeyemi", "guirassy", "brandt", "gittens"],
    "dortmund": ["adeyemi", "guirassy", "brandt", "gittens"],
    "rb leipzig": ["openda", "sesko", "olmo"],
    "eintracht frankfurt": ["marmoush", "ekitike", "uzun"],
    "vfb stuttgart": ["woltemade", "undav", "demirovic"],
    "stuttgart": ["woltemade", "undav", "demirovic"],
    "borussia monchengladbach": ["kleindienst", "hack", "honorat"],
    "werder bremen": ["ducksch", "njinmah"],
    "wolfsburg": ["wind", "majer"],
    # Ligue 1
    "paris saint-germain": ["dembele", "barcola", "kolo muani", "doue"],
    "psg": ["dembele", "barcola", "kolo muani", "doue"],
    "marseille": ["greenwood", "maupay", "rabiot"],
    "olympique marseille": ["greenwood", "maupay", "rabiot"],
    "monaco": ["ben seghir", "embolo", "balogun"],
    "lille": ["david", "zhegrova", "cabella"],
    "lyon": ["lacazette", "mikautadze", "cherki"],
    "olympique lyonnais": ["lacazette", "mikautadze", "cherki"],
    "nice": ["guessand", "boga", "moffi"],
    "strasbourg": ["emegha", "diarra"],
    # MLS
    "inter miami": ["messi", "suarez", "alba", "busquets"],
    "inter miami cf": ["messi", "suarez", "alba", "busquets"],
    "lafc": ["bouanga", "giroud"],
    "los angeles fc": ["bouanga", "giroud"],
    "la galaxy": ["pec", "paintsil", "joveljic"],
    "cincinnati": ["denkey", "acosta"],
    "fc cincinnati": ["denkey", "acosta"],
    "columbus crew": ["rossi", "cucho hernandez"],
    "seattle sounders": ["ruidiaz", "morris"],
    "seattle sounders fc": ["ruidiaz", "morris"],
    "philadelphia union": ["uhre", "carranza"],
    "new york city fc": ["martinez", "magno"],
    "atlanta united": ["silva", "almada"],
    "atlanta united fc": ["silva", "almada"],
    "portland timbers": ["moreno", "mora"],
    "new york red bulls": ["choupo-moting", "morgan"],
    "orlando city": ["torres", "pereyra"],
    "orlando city sc": ["torres", "pereyra"],
    "vancouver whitecaps": ["brian white", "gauld"],
    "vancouver whitecaps fc": ["brian white", "gauld"],
    # Liga MX
    "club america": ["henry martin", "zendejas", "rodrigo aguirre"],
    "america": ["henry martin", "zendejas", "rodrigo aguirre"],
    "chivas": ["alvarado", "pulido"],
    "guadalajara": ["alvarado", "pulido"],
    "monterrey": ["berterame", "canales", "ocampos"],
    "tigres": ["gignac", "brunetta"],
    "tigres uanl": ["gignac", "brunetta"],
    "cruz azul": ["rotondi", "sepulveda"],
    "pumas": ["dinenno", "silva"],
    "pumas unam": ["dinenno", "silva"],
}

# Elite / good top-flight goalkeepers. Last names (lowercase) unless a
# multi-word surname is required.
ELITE_SOCCER_KEEPERS = {
    "alisson", "courtois", "ederson", "donnarumma", "oblak", "ter stegen",
    "sommer", "onana", "maignan", "raya", "sanchez", "dibu martinez",
    "emi martinez", "emiliano martinez", "pickford", "neuer", "szczesny",
    "bounou", "lunin", "rulli", "provedel", "milinkovic-savic",
    "di gregorio", "svilar", "mamardashvili", "remiro",
}
GOOD_SOCCER_KEEPERS = {
    "kepa", "areola", "henderson", "turner", "flekken", "sels", "pope",
    "steele", "fabianski", "vicario", "meslier", "forster", "jorgensen",
    "sa", "verbruggen", "gunn", "ramsdale",
}


def _soccer_keeper_tier(name: str) -> str | None:
    if not name:
        return None
    lc = name.strip().lower()
    last = lc.split()[-1]
    for key in ELITE_SOCCER_KEEPERS:
        if key == last or lc.endswith(key):
            return "ELITE"
    for key in GOOD_SOCCER_KEEPERS:
        if key == last or lc.endswith(key):
            return "GOOD"
    return None


def _soccer_team_stars(team_name: str) -> list:
    """Return list of lowercased star last names for a soccer club, or []."""
    if not team_name:
        return []
    key = team_name.strip().lower()
    stars = ELITE_SOCCER_STRIKERS.get(key)
    if stars:
        return stars
    for suffix in (" fc", " cf", " sc", " afc"):
        if key.endswith(suffix):
            stars = ELITE_SOCCER_STRIKERS.get(key[: -len(suffix)])
            if stars:
                return stars
    for dk, v in ELITE_SOCCER_STRIKERS.items():
        if dk in key or key in dk:
            return v
    return []


def _soccer_stars_out(game: dict, side: str) -> list:
    """Return list of (player_name, status) tuples for known stars on `side`
    that appear on the ESPN injury list with OUT / DOUBTFUL / SUSPENDED."""
    team = game.get("homeTeam" if side == "home" else "awayTeam", "")
    stars = _soccer_team_stars(team)
    if not stars:
        return []
    injuries = game.get("injuries", {}).get(side, []) or []
    hits = []
    for inj in injuries:
        if inj.get("status") not in ("OUT", "DOUBTFUL", "SUSPENDED"):
            continue
        pname = (inj.get("name") or inj.get("player") or "").strip().lower()
        if not pname:
            continue
        for star in stars:
            if star in pname:
                hits.append((inj.get("name") or pname, inj.get("status")))
                break
    return hits


def score_soccer_key_player(game: dict, side: str) -> tuple:
    """Soccer-flavored star_player override. Rewards when opp has an elite
    attacker OUT, penalizes when ours is OUT. Falls back to the generic
    injury diff if no known stars are flagged."""
    our_out = _soccer_stars_out(game, side)
    opp_side = "away" if side == "home" else "home"
    opp_out = _soccer_stars_out(game, opp_side)
    if not our_out and not opp_out:
        return score_star_player(game, side)
    score = 5.0 + 2.0 * len(opp_out) - 2.0 * len(our_out)
    parts = []
    if opp_out:
        parts.append("OPP out: " + ", ".join(n for n, _ in opp_out))
    if our_out:
        parts.append("US out: " + ", ".join(n for n, _ in our_out))
    return _clamp(score), " | ".join(parts)


def score_fixture_congestion(game: dict, side: str) -> tuple:
    p = game.get(f"{side}_profile", {}) or {}
    opp = game.get(f"{'away' if side == 'home' else 'home'}_profile", {}) or {}
    # Treat 0 as a real value (not missing). Only fall through when BOTH sides
    # return None. Previously `our or ...` dropped zeros and forced a flat 5
    # for every match, and the function had no penalty branch (our > their
    # never scored below 5).
    our = p.get("matches_in_10d")
    if our is None:
        our = p.get("congestion_10d")
    their = opp.get("matches_in_10d")
    if their is None:
        their = opp.get("congestion_10d")
    if our is None and their is None:
        return 5, "No congestion data"
    try:
        our_i = int(our or 0)
        their_i = int(their or 0)
    except (ValueError, TypeError):
        return 5, "No congestion data"
    diff = their_i - our_i  # positive = opp more congested = edge for us
    if diff >= 3: return 9, f"Them:{their_i} vs Us:{our_i} in 10d (heavy legs opp)"
    if diff == 2: return 8, f"Them:{their_i} vs Us:{our_i} in 10d"
    if diff == 1: return 6.5, f"Them:{their_i} vs Us:{our_i} in 10d"
    if diff == 0: return 5, f"Even:{our_i} matches in 10d"
    if diff == -1: return 3.5, f"Them:{their_i} vs Us:{our_i} in 10d"
    if diff == -2: return 2, f"Them:{their_i} vs Us:{our_i} in 10d (heavy legs us)"
    return 1.5, f"Them:{their_i} vs Us:{our_i} in 10d (very heavy legs us)"


def score_motivation(game: dict, side: str) -> tuple:
    p = game.get(f"{side}_profile", {})
    opp = game.get(f"{'away' if side == 'home' else 'home'}_profile", {})
    our_pct = _win_pct(p.get("record"))
    opp_pct = _win_pct(opp.get("record"))
    if opp_pct < 0.35 and our_pct > 0.55:
        return 8, f"Motivation: us {our_pct:.0%} vs them {opp_pct:.0%}"
    elif our_pct < 0.35 and opp_pct > 0.55:
        return 2, f"They're motivated: {opp_pct:.0%} vs us {our_pct:.0%}"
    return _clamp(5 + (our_pct - opp_pct) * 6), f"Records: {our_pct:.0%} vs {opp_pct:.0%}"


# ─── Spread Amplifier ──────────────────────────────────────────────────────────

def _apply_spread_amplifier(composite: float, variables: dict) -> float:
    scores = sorted(
        [(v.get("score", 5), v.get("weight", 5)) for v in variables.values()],
        key=lambda x: x[0] * x[1], reverse=True
    )
    if not scores:
        return composite
    top3 = scores[:3]
    bot3 = scores[-3:]
    top3_avg = sum(s for s, _ in top3) / len(top3)
    bot3_avg = sum(s for s, _ in bot3) / len(bot3)
    if top3_avg >= 8.5:
        composite = composite * 0.8 + top3_avg * 0.2
    elif bot3_avg <= 2.5:
        composite = composite * 0.8 + bot3_avg * 0.2
    all_scores = [s for s, _ in scores]
    if min(all_scores) <= 1.5 and composite > 4.0:
        composite = min(composite, 4.0)
    return round(composite, 2)


# ─── Chain System (30 chains) ──────────────────────────────────────────────────

CHAINS = {
    # Positive chains (+bonus)
    "THE_MISPRICING":    {"bonus": 1.0, "sports": None},
    "FATIGUE_FADE":      {"bonus": 0.8, "sports": None},
    "FORM_WAVE":         {"bonus": 0.7, "sports": None},
    "INJURY_GOLDMINE":   {"bonus": 0.8, "sports": None},
    "REST_DOMINATION":   {"bonus": 0.7, "sports": None},
    "SHARPS_LOVE":       {"bonus": 0.8, "sports": None},
    "BLOWOUT_INCOMING":  {"bonus": 0.7, "sports": ["NBA", "NCAAB"]},
    "MISMATCH_MASSACRE": {"bonus": 0.8, "sports": None},
    "ROAD_WARRIOR":      {"bonus": 0.6, "sports": None},
    "BENCH_MOB":         {"bonus": 0.5, "sports": None},
    "REVENGE_GAME":      {"bonus": 0.5, "sports": None},
    "BOUNCE_BACK":       {"bonus": 0.5, "sports": None},
    "HUNGRY_DOG":        {"bonus": 0.6, "sports": None},
    # Negative chains (-penalty)
    "DUMPSTER_FIRE":     {"bonus": -1.0, "sports": None},
    "COLD_TAKE":         {"bonus": -0.7, "sports": None},
    "GLASS_CANNON":      {"bonus": -0.5, "sports": None},
    "SCHEDULE_LOSS":     {"bonus": -0.7, "sports": None},
    "THIN_ROSTER":       {"bonus": -0.6, "sports": None},
    "COASTING_FAV":      {"bonus": -0.5, "sports": None},
    "FADE_THE_STREAK":   {"bonus": -0.5, "sports": None},
    # Sport-specific
    "GOALIE_EDGE":       {"bonus": 0.7, "sports": ["NHL"]},
    "ACE_DOMINATION":    {"bonus": 0.8, "sports": ["MLB"]},
    "COORS_OVER":        {"bonus": 0.7, "sports": ["MLB"]},
    "PITCHING_DUEL":     {"bonus": 0.5, "sports": ["MLB"]},
    "CONGESTION_FADE":   {"bonus": 0.8, "sports": ["SOCCER"]},
    "CLASS_GAP":         {"bonus": 0.7, "sports": ["SOCCER"]},
    "FORTRESS_HOME":     {"bonus": 0.6, "sports": ["SOCCER"]},
    "TOURIST_TRAP":      {"bonus": -0.6, "sports": ["SOCCER"]},
    "DERBY_CHAOS":       {"bonus": 0.5, "sports": ["SOCCER"]},
    "BLUE_BLOOD_TRAP":   {"bonus": -0.5, "sports": ["NCAAB"]},
}

CHAIN_CAP = 2.0


def check_chain(name: str, v: dict) -> bool:
    """Check if chain triggers. v = {var_name: score}"""
    g = lambda k, default=0: v.get(k, default)

    if name == "THE_MISPRICING":
        return g("star_player") >= 8 and g("line_movement") <= 3
    elif name == "FATIGUE_FADE":
        return g("rest") >= 8 and g("road_trip") >= 7 and g("depth") >= 7
    elif name == "FORM_WAVE":
        return g("form") >= 8 and g("off_ranking") >= 8 and g("ats") >= 7
    elif name == "INJURY_GOLDMINE":
        return g("star_player") >= 8 and g("line_movement") <= 3 and g("form") >= 6
    elif name == "REST_DOMINATION":
        return g("rest") >= 8 and g("home_away") >= 6 and g("road_trip") >= 6
    elif name == "SHARPS_LOVE":
        return g("line_movement") >= 8 and g("form") >= 6
    elif name == "BLOWOUT_INCOMING":
        return g("off_ranking") >= 8 and g("def_ranking") >= 7 and g("home_away") >= 6
    elif name == "MISMATCH_MASSACRE":
        return g("off_ranking") >= 8 and g("def_ranking") >= 7
    elif name == "ROAD_WARRIOR":
        return g("home_away") <= 4 and g("form") >= 7 and g("rest") >= 6
    elif name == "BENCH_MOB":
        return g("depth") >= 7 and g("star_player") >= 6 and g("form") >= 6
    elif name == "REVENGE_GAME":
        return g("h2h", 10) <= 3 and g("form") >= 7 and g("home_away") >= 6
    elif name == "BOUNCE_BACK":
        return g("form", 10) <= 3 and g("off_ranking") >= 7 and g("home_away") >= 6
    elif name == "HUNGRY_DOG":
        return g("form") >= 7 and g("motivation") >= 7 and g("line_movement") >= 6
    elif name == "DUMPSTER_FIRE":
        return g("form", 10) <= 3 and g("off_ranking", 10) <= 3 and g("star_player", 10) <= 4
    elif name == "COLD_TAKE":
        avg = sum(v.values()) / len(v) if v else 5
        return avg <= 4.5
    elif name == "GLASS_CANNON":
        return g("off_ranking") >= 7 and g("def_ranking", 10) <= 3
    elif name == "SCHEDULE_LOSS":
        return g("rest", 10) <= 3 and g("road_trip", 10) <= 3 and g("form", 10) <= 4
    elif name == "THIN_ROSTER":
        return g("depth", 10) <= 3 and g("star_player", 10) <= 4
    elif name == "COASTING_FAV":
        return g("form", 10) <= 4 and g("motivation", 10) <= 4 and g("off_ranking", 10) <= 5
    elif name == "FADE_THE_STREAK":
        return g("form") >= 9 and g("home_away", 10) <= 4 and g("rest", 10) <= 4
    elif name == "GOALIE_EDGE":
        return g("star_player") >= 8 and g("def_ranking") >= 7 and g("rest") >= 7
    elif name == "ACE_DOMINATION":
        return g("starting_pitcher") >= 9 and g("off_ranking") >= 7
    elif name == "COORS_OVER":
        return g("park_factor") >= 8 and g("off_ranking") >= 7
    elif name == "PITCHING_DUEL":
        return g("starting_pitcher") >= 8 and g("def_ranking") >= 7
    elif name == "CONGESTION_FADE":
        return g("congestion") >= 8 and g("rest") >= 7
    elif name == "CLASS_GAP":
        return g("form") >= 8 and g("off_ranking") >= 7 and g("home_away") >= 7
    elif name == "FORTRESS_HOME":
        return g("home_away") >= 8 and g("def_ranking") >= 7 and g("form") >= 7
    elif name == "TOURIST_TRAP":
        return g("home_away", 10) <= 4 and g("congestion", 10) <= 3
    elif name == "DERBY_CHAOS":
        return g("h2h") >= 7 and g("form") >= 6 and g("motivation") >= 6
    elif name == "BLUE_BLOOD_TRAP":
        return g("line_movement") >= 8 and g("off_ranking", 10) <= 5
    return False


# ─── Variable Config Per Sport ─────────────────────────────────────────────────

SPORT_VARIABLES = {
    "NBA": {
        "star_player": 9, "rest": 9, "off_ranking": 8, "def_ranking": 8,
        "pace": 7, "form": 7, "road_trip": 7, "h2h": 6, "ats": 6,
        "line_movement": 5, "home_away": 5, "depth": 4, "motivation": 5,
        "late_game_strength": 7, "quarter_pace": 6, "bench_diff": 6,
    },
    "NHL": {
        "goalie": 9, "star_player": 9, "rest": 8, "off_ranking": 7, "def_ranking": 7,
        "form": 7, "road_trip": 7, "h2h": 6, "ats": 6,
        "line_movement": 5, "home_away": 5, "depth": 4, "motivation": 5,
    },
    "MLB": {
        "starting_pitcher": 10, "bullpen": 8, "lineup_vs_hand": 7, "star_player": 8,
        "off_ranking": 7, "def_ranking": 7,
        "form": 7, "rest": 6, "h2h": 6, "ats": 6, "park_factor": 6,
        "umpire": 4,
        "line_movement": 5, "home_away": 5, "depth": 4, "motivation": 5,
    },
    "SOCCER": {
        "congestion": 6, "form": 8, "star_player": 8, "off_ranking": 9,
        "def_ranking": 9, "home_away": 7, "rest": 4, "h2h": 6,
        "motivation": 6, "ats": 6, "line_movement": 6, "depth": 4,
    },
    "NCAAB": {
        "off_ranking": 9, "def_ranking": 9, "star_player": 9, "line_movement": 9,
        "pace": 8, "ats": 8, "form": 7, "h2h": 6,
        "home_away": 6, "depth": 7, "motivation": 6, "rest": 5,
    },
    "NFL": {
        "off_ranking": 9, "def_ranking": 9, "star_player": 8, "form": 8,
        "home_away": 7, "rest": 7, "h2h": 6, "ats": 7,
        "line_movement": 6, "motivation": 6, "depth": 5,
    },
    "MMA": {
        "form": 9, "off_ranking": 8, "def_ranking": 8, "star_player": 7,
        "motivation": 7, "h2h": 6, "ats": 6, "home_away": 3,
        "rest": 5, "depth": 3,
    },
    "BOXING": {
        "form": 9, "off_ranking": 9, "def_ranking": 8, "star_player": 7,
        "motivation": 7, "h2h": 7, "ats": 6, "home_away": 2,
        "rest": 4, "depth": 2,
    },
}


# ─── Main Grade Function ──────────────────────────────────────────────────────

def grade_game(game: dict, pick_side: str) -> dict:
    """
    Grade a game for one side. Returns full breakdown.
    game dict needs: sport, home_profile, away_profile, odds, injuries, shifts
    """
    sport = game.get("sport", "NBA").upper()
    profile = game.get(f"{pick_side}_profile", {})
    opp_side = "away" if pick_side == "home" else "home"
    opp = game.get(f"{opp_side}_profile", {})

    var_weights = SPORT_VARIABLES.get(sport, SPORT_VARIABLES["NBA"])
    variables = {}

    # Data availability checks — skip variables we have NO data for
    has_injuries = bool(game.get("injuries", {}).get("home") or game.get("injuries", {}).get("away"))
    has_rest = profile.get("rest_days") is not None
    has_form = bool(profile.get("L5"))
    has_h2h = profile.get("h2h_season", "0-0") != "0-0"
    has_shifts = bool(game.get("shifts", {}).get("spread_delta"))
    has_pace = bool(profile.get("pace_L5"))

    for var_name, weight in var_weights.items():
        available = True  # default: include in composite

        if var_name == "star_player":
            if has_injuries:
                if sport == "SOCCER":
                    score, note = score_soccer_key_player(game, pick_side)
                else:
                    score, note = score_star_player(game, pick_side)
            else:
                score, note = 5, "No injury data"
                available = False
        elif var_name == "rest":
            if has_rest:
                score, note = score_rest_advantage(profile, opp)
            else:
                score, note = 5, "No rest data"
                available = False
        elif var_name == "off_ranking":
            score, note = score_off_ranking(profile, opp, sport)
            # NHL: record-laundered ppg is not a real offense signal —
            # standings points diverge sharply from goal differential.
            if sport in ("NHL", "SOCCER") and profile.get("ppg_synthetic"):
                available = False
                note = f"{note} (synthetic from record)"
        elif var_name == "def_ranking":
            score, note = score_def_ranking(profile, opp, sport)
            if sport in ("NHL", "SOCCER") and profile.get("ppg_synthetic"):
                available = False
                note = f"{note} (synthetic from record)"
        elif var_name == "form":
            if has_form:
                score, note = score_recent_form(profile, opp)
            else:
                score, note = 5, "No L5 data"
                available = False
        elif var_name == "home_away":
            score, note = score_home_away(game, pick_side)
        elif var_name == "h2h":
            if has_h2h:
                score, note = score_h2h(profile)
            else:
                score, note = 5, "No H2H data"
                available = False
        elif var_name == "ats":
            score, note = score_ats_trend(profile)
        elif var_name == "line_movement":
            if has_shifts:
                score, note = score_line_movement(game)
            else:
                score, note = 5, "No line movement data"
                available = False
        elif var_name == "road_trip":
            score, note = score_road_trip(profile)
        elif var_name == "depth":
            if has_injuries:
                score, note = score_depth_injuries(game, pick_side)
            else:
                score, note = 5, "No injury data"
                available = False
        elif var_name == "pace":
            if has_pace:
                score, note = score_pace_matchup(profile, opp, sport)
            else:
                score, note = 5, "No pace data"
                available = False
        elif var_name == "motivation":
            score, note = score_motivation(game, pick_side)
        elif var_name == "starting_pitcher":
            score, note = score_starting_pitcher(game, pick_side)
            if note.startswith(_SP_PROXY_NOTE_PREFIX):
                available = False
        elif var_name == "goalie":
            score, note = score_starting_goalie(game, pick_side)
            if note == "No goalie data":
                available = False
        elif var_name == "congestion":
            score, note = score_fixture_congestion(game, pick_side)
        elif var_name == "park_factor":
            score, note = score_park_factor(game, pick_side)
            if "unknown park" in note:
                available = False
        elif var_name == "bullpen":
            score, note = score_bullpen(game, pick_side)
            if note == "no bullpen data":
                available = False
        elif var_name == "lineup_vs_hand":
            score, note = score_lineup_vs_hand(game, pick_side)
            if note == "no lineup vs hand splits":
                available = False
        elif var_name == "umpire":
            score, note = score_umpire(game, pick_side)
            if note == "no umpire data" or "unknown tendency" in note:
                available = False
        elif var_name == "late_game_strength":
            score, note = score_late_game_strength(game, pick_side)
            if note == "no quarter data":
                available = False
        elif var_name == "quarter_pace":
            score, note = score_quarter_pace(game, pick_side)
            if note == "no quarter data":
                available = False
        elif var_name == "bench_diff":
            score, note = score_bench_diff(game, pick_side)
            if note == "no bench data":
                available = False
        else:
            score, note = 5, f"{var_name}: no data"
            available = False

        variables[var_name] = {
            "score": _clamp(score),
            "weight": weight,
            "weighted": round(_clamp(score) * weight, 1),
            "note": note,
            "available": available,
        }

    # Composite — only from AVAILABLE variables (skip those with no data)
    active = {k: v for k, v in variables.items() if v.get("available", True)}
    total_weighted = sum(v["weighted"] for v in active.values())
    max_possible = sum(v["weight"] * 10 for v in active.values())
    composite = round(total_weighted / max_possible * 10, 2) if max_possible > 0 else 5.0
    composite = _apply_spread_amplifier(composite, variables)

    # Chains
    v_scores = {k: var["score"] for k, var in variables.items()}
    chains_fired = []
    chain_bonus = 0.0
    for chain_name, cfg in CHAINS.items():
        if cfg["sports"] and sport not in cfg["sports"]:
            continue
        if check_chain(chain_name, v_scores):
            chain_bonus += cfg["bonus"]
            chains_fired.append(chain_name)

    chain_bonus = max(-CHAIN_CAP, min(chain_bonus, CHAIN_CAP))
    final = round(max(1.0, min(10.0, composite + chain_bonus)), 2)
    grade = score_to_grade(final)

    return {
        "grade": grade,
        "score": final,
        "composite": composite,
        "chain_bonus": chain_bonus,
        "chains_fired": chains_fired,
        "sizing": score_to_sizing(final),
        "confidence": min(95, max(40, int(55 + (final - 5) * 8))),
        "variables": variables,
        "pick_side": pick_side,
    }


def grade_both_sides(game: dict) -> dict:
    """Grade both home and away, pick the better side."""
    home = grade_game(game, "home")
    away = grade_game(game, "away")
    if home["score"] >= away["score"]:
        best = home
        best["pick_team"] = game.get("home", game.get("home_team", "Home"))
        pick_side = "home"
    else:
        best = away
        best["pick_team"] = game.get("away", game.get("away_team", "Away"))
        pick_side = "away"

    # Run grader profiles on the best side
    profiles = grade_profiles(game, pick_side)

    return {
        "home": home,
        "away": away,
        "best": best,
        "profiles": profiles,
    }


# ─── Grader Profiles (Sintonia, Edge, Renzo) ──────────────────────────────────

# Each profile re-weights the same variables differently
PROFILE_WEIGHTS = {
    "sintonia": {
        # Main matrix — balanced, weights everything
        "off_ranking": 1.2, "def_ranking": 1.2, "form": 1.0, "home_away": 1.0,
        "star_player": 1.1, "rest": 1.0, "ats": 0.9, "h2h": 0.8,
        "motivation": 0.8, "depth": 0.7, "line_movement": 0.6,
        "pace": 0.7, "road_trip": 0.6, "starting_pitcher": 1.3, "congestion": 1.2,
        "goalie": 1.3,
    },
    "edge": {
        # Situational — calendar, rest, travel, motivation
        "rest": 1.5, "road_trip": 1.4, "motivation": 1.3, "home_away": 1.2,
        "form": 1.0, "depth": 1.0, "line_movement": 0.9,
        "off_ranking": 0.7, "def_ranking": 0.7, "star_player": 0.8,
        "ats": 0.8, "h2h": 0.7, "pace": 0.5,
        "starting_pitcher": 0.8, "congestion": 1.4,
        "goalie": 1.0,
    },
    "renzo": {
        # Conservative — only bets strong edges, penalizes uncertainty
        "off_ranking": 1.3, "def_ranking": 1.3, "ats": 1.2, "form": 1.1,
        "line_movement": 1.0, "h2h": 1.0,
        "home_away": 0.8, "rest": 0.7, "star_player": 0.7,
        "motivation": 0.5, "depth": 0.5, "road_trip": 0.5,
        "pace": 0.4, "starting_pitcher": 1.2, "congestion": 0.8,
        "goalie": 1.3,
    },
}


def grade_profiles(game: dict, pick_side: str) -> dict:
    """Run all 3 grader profiles on a game. Returns {name: {grade, score, ...}}"""
    base = grade_game(game, pick_side)
    base_vars = base.get("variables", {})
    profiles = {}

    for profile_name, multipliers in PROFILE_WEIGHTS.items():
        # Re-weight the base variables
        total_w = 0
        total_s = 0
        for var_name, var_data in base_vars.items():
            if not var_data.get("available", True):
                continue
            mult = multipliers.get(var_name, 1.0)
            adjusted_weight = var_data["weight"] * mult
            total_w += adjusted_weight * 10
            total_s += var_data["score"] * adjusted_weight

        composite = round(total_s / total_w * 10, 2) if total_w > 0 else 5.0

        # Apply chain bonus from base
        chain_bonus = base.get("chain_bonus", 0)
        # Renzo is conservative — halve chain bonus
        if profile_name == "renzo":
            chain_bonus *= 0.5
        # Edge amplifies situational chains
        elif profile_name == "edge":
            chain_bonus *= 1.2

        final = round(max(1.0, min(10.0, composite + chain_bonus)), 2)
        grade = score_to_grade(final)

        profiles[profile_name] = {
            "grade": grade,
            "final": final,
            "composite": composite,
            "sizing": score_to_sizing(final),
            "chains_fired": base.get("chains_fired", []),
            "pick_side": pick_side,
        }

    # Also grade the OTHER side so each profile can show who they pick
    other_side = "away" if pick_side == "home" else "home"
    other_base = grade_game(game, other_side)
    other_vars = other_base.get("variables", {})

    for profile_name, multipliers in PROFILE_WEIGHTS.items():
        total_w = 0
        total_s = 0
        for var_name, var_data in other_vars.items():
            if not var_data.get("available", True):
                continue
            mult = multipliers.get(var_name, 1.0)
            adjusted_weight = var_data["weight"] * mult
            total_w += adjusted_weight * 10
            total_s += var_data["score"] * adjusted_weight
        other_composite = round(total_s / total_w * 10, 2) if total_w > 0 else 5.0
        other_final = round(max(1.0, min(10.0, other_composite + other_base.get("chain_bonus", 0) * (0.5 if profile_name == "renzo" else 1.2 if profile_name == "edge" else 1.0))), 2)

        # Each profile picks the side with the higher score
        if profiles[profile_name]["final"] >= other_final:
            profiles[profile_name]["picks"] = pick_side
        else:
            profiles[profile_name]["picks"] = other_side
        profiles[profile_name]["margin"] = round(profiles[profile_name]["final"] - other_final, 2)

    # Add "crew" — random-weighted blend of all 3 profiles
    import random
    if len(profiles) >= 3:
        blend_weights = {name: random.uniform(0.2, 0.5) for name in profiles}
        total_w = sum(blend_weights.values())
        blend_weights = {k: v / total_w for k, v in blend_weights.items()}  # normalize to 1.0

        crew_final = sum(profiles[name]["final"] * blend_weights[name] for name in profiles)
        crew_final = round(max(1.0, min(10.0, crew_final)), 2)
        crew_grade = score_to_grade(crew_final)

        # Crew picks whichever side the majority of profiles pick
        side_votes = {}
        for name in profiles:
            side = profiles[name].get("picks", pick_side)
            side_votes[side] = side_votes.get(side, 0) + 1
        crew_pick = max(side_votes, key=side_votes.get)

        profiles["crew"] = {
            "grade": crew_grade,
            "final": crew_final,
            "composite": crew_final,
            "sizing": score_to_sizing(crew_final),
            "chains_fired": [],
            "picks": crew_pick,
            "margin": round(crew_final - 5.0, 2),
            "blend": {k: round(v, 2) for k, v in blend_weights.items()},
        }

    return profiles


# ─── Expected Value Calculator ────────────────────────────────────────────────


def ml_to_implied_prob(ml: int | float | None) -> float | None:
    """Convert American moneyline to implied probability."""
    if ml is None:
        return None
    if ml > 0:
        return 100 / (ml + 100)
    elif ml < 0:
        return abs(ml) / (abs(ml) + 100)
    return 0.5


def grade_to_true_prob(final_score: float, implied_prob: float | None = None) -> float:
    """
    Convert consensus grade score to estimated true win probability.
    Grade 5.0 = market is right, 7.0+ = market undervalues, 3.0- = market overvalues.
    Each point of deviation = ~3% edge.
    """
    if implied_prob is None:
        prob = 0.30 + (final_score / 10) * 0.45
        return max(0.25, min(0.80, prob))
    deviation = final_score - 5.0
    edge = deviation * 0.03
    true_prob = implied_prob + edge
    return max(0.15, min(0.90, true_prob))


def calculate_ev(game: dict, pick_side: str, consensus_final: float, pick: dict | None = None) -> dict:
    """
    Calculate expected value for a pick.
    Branches by pick type: spread picks price against the spread juice (cover prob),
    moneyline picks price against the ML (win prob). Mixing them produces nonsense
    (e.g. -3500 ML vs a -18 spread looks like -7% EV when the spread itself is +EV).
    """
    odds = game.get("odds", {})
    pick_type = (pick or {}).get("type", "ml")

    if pick_type == "spread":
        # Use the spread price for the pick side (default -110 if missing)
        if pick_side == "home":
            ml = odds.get("spreadPriceHome") or -110
        else:
            ml = odds.get("spreadPriceAway") or -110
    else:
        if pick_side == "home":
            ml = odds.get("mlHome") or odds.get("home_ml_current") or odds.get("ml_home")
        else:
            ml = odds.get("mlAway") or odds.get("away_ml_current") or odds.get("ml_away")

    implied_prob = ml_to_implied_prob(ml)
    # For spread picks, true_prob is interpreted as cover probability (anchored on
    # the ~52.4% spread implied), not win probability against the ML.
    true_prob = grade_to_true_prob(consensus_final, implied_prob)

    if implied_prob is None or ml is None or ml == 0:
        return {
            "ev_pct": None,
            "ev_grade": "N/A",
            "kelly_units": "N/A",
            "true_prob": None,
            "implied_prob": None,
            "edge": None,
            "moneyline": None,
        }

    # Decimal odds
    if ml > 0:
        decimal_odds = 1 + (ml / 100)
    else:
        decimal_odds = 1 + (100 / abs(ml))

    b = decimal_odds - 1  # Net odds
    p = true_prob
    q = 1 - p

    # EV calculation
    ev = (p * b) - q
    ev_pct = round(ev * 100, 2)

    # Kelly criterion (quarter Kelly)
    kelly_full = (b * p - q) / b if b > 0 else 0
    kelly_quarter = max(0, kelly_full * 0.25)

    # Kelly to units
    if kelly_quarter >= 0.06:
        kelly_units = "2u"
    elif kelly_quarter >= 0.04:
        kelly_units = "1.5u"
    elif kelly_quarter >= 0.02:
        kelly_units = "1u"
    elif kelly_quarter > 0:
        kelly_units = "0.5u"
    else:
        kelly_units = "PASS"

    # EV grade
    if ev_pct >= 10:
        ev_grade = "A+"
    elif ev_pct >= 7:
        ev_grade = "A"
    elif ev_pct >= 5:
        ev_grade = "B+"
    elif ev_pct >= 3:
        ev_grade = "B"
    elif ev_pct >= 0:
        ev_grade = "C"
    else:
        ev_grade = "F"

    return {
        "ev_pct": ev_pct,
        "ev_grade": ev_grade,
        "kelly_units": kelly_units,
        "true_prob": round(true_prob, 4),
        "implied_prob": round(implied_prob, 4),
        "edge": round(true_prob - implied_prob, 4),
        "moneyline": ml,
    }


# ─── Peter's Rules ───────────────────────────────────────────────────────────


def peter_rules(game: dict, pick_side: str) -> dict:
    """
    Peter's hard rules — kill/boost/downgrade flags that override or adjust consensus.
    Rule 1: Big fav ATS trap
    Rule 2: Fresh injury boost
    Rule 3: Established injury priced
    Rule 4: Massive NCAAB spread
    """
    sport = (game.get("sport", "") or "").upper()
    odds = game.get("odds", {})
    opp_side = "away" if pick_side == "home" else "home"
    opp_profile = game.get(f"{opp_side}_profile", {})
    opp_injuries = game.get("injuries", {}).get(opp_side, [])

    flags = []
    adjustment = 0.0

    spread = odds.get("spread", odds.get("spread_home", 0)) or 0
    abs_spread = abs(spread)

    # Sport-specific thresholds
    big_fav_spread = {
        "NBA": 15, "WNBA": 12, "NCAAB": 20, "NCAAF": 21,
        "NHL": 2.5, "MLB": 2.5, "NFL": 14, "SOCCER": 2.5,
    }.get(sport, 15)
    star_ppg = {
        "NBA": 15, "WNBA": 15, "NCAAB": 12, "NCAAF": 0,
        "NHL": 0.8, "MLB": 0, "NFL": 0, "SOCCER": 0.3,
    }.get(sport, 15)

    # Rule 1: REMOVED — Peter no longer cares about spread size as a kill trigger
    opp_record = opp_profile.get("record", "0-0")
    opp_w, opp_l = _parse_record(opp_record)
    opp_pct = opp_w / max(opp_w + opp_l, 1)

    # Rule 2: Fresh injury boost — star OUT < 3 days, books may not have adjusted
    for inj in opp_injuries:
        if (inj.get("status") == "OUT" and
            inj.get("freshness") == "FRESH" and
            star_ppg > 0 and (inj.get("ppg") or 0) >= star_ppg):
            flags.append({
                "rule": "Fresh Injury Boost",
                "action": "BOOST",
                "severity": "EDGE",
                "note": f"FRESH: {inj.get('player', '?')} ({inj.get('ppg')} PPG) OUT — books may lag",
            })
            adjustment += 1.0

    # Rule 3: Established injury = already priced in
    for inj in opp_injuries:
        if (inj.get("status") == "OUT" and
            inj.get("freshness") in ("ESTABLISHED", "SEASON") and
            star_ppg > 0 and (inj.get("ppg") or 0) >= star_ppg):
            flags.append({
                "rule": "Injury Already Priced",
                "action": "DOWNGRADE",
                "severity": "WARNING",
                "note": f"PRICED: {inj.get('player', '?')} ({inj.get('ppg')} PPG) out long — team adapted",
            })
            adjustment -= 0.5

    # Rule 4: REMOVED — Peter no longer cares about spread size

    has_kill = any(f["action"] == "KILL" for f in flags)

    return {
        "flags": flags,
        "adjustment": round(adjustment, 1),
        "has_kill": has_kill,
    }
