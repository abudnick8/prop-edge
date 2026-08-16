#!/usr/bin/env python3
"""
Clubhouse IQ — ML Self-Learning Engine
═══════════════════════════════════════
Runs nightly (or on demand via POST /api/ml/run).

What it does:
  1. Reads every graded bet from bet_outcome_log.json
  2. Extracts features: sport, betType, confidenceScore, formEdgePct,
     hitRate, keyFactors, isOver/Under, line, opponent, etc.
  3. Computes per-pattern accuracy rates using a rolling window
     (last 30 days weighted 2×, last 90 days weighted 1×)
  4. Derives signed weight adjustments for each feature dimension
  5. Writes ml_weights.json — read by Kronos + scanner at runtime
  6. Writes ml_insights.json — consumed by the /api/ml-insights endpoint

No external ML libraries needed — pure statistical inference so it
works in the Railway Python 3.12 environment without pip installs.
"""

import json
import os
import math
import datetime
from collections import defaultdict
from typing import Any

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "ml_data")
os.makedirs(DATA_DIR, exist_ok=True)

OUTCOME_LOG   = os.path.join(DATA_DIR, "bet_outcome_log.json")
WEIGHTS_FILE  = os.path.join(DATA_DIR, "ml_weights.json")
INSIGHTS_FILE = os.path.join(DATA_DIR, "ml_insights.json")

NOW = datetime.datetime.utcnow()

# ── Load outcome log ─────────────────────────────────────────────────────────
def load_outcomes() -> list[dict]:
    if not os.path.exists(OUTCOME_LOG):
        return []
    with open(OUTCOME_LOG, "r") as f:
        try:
            return json.load(f)
        except Exception:
            return []

# ── Save a single bet outcome (called from routes.ts via subprocess) ─────────
def append_outcome(record: dict) -> None:
    records = load_outcomes()
    # Deduplicate by betId
    existing_ids = {r.get("betId") for r in records}
    if record.get("betId") not in existing_ids:
        records.append(record)
    else:
        # Update result if already present
        for r in records:
            if r.get("betId") == record.get("betId"):
                r.update(record)
                break
    with open(OUTCOME_LOG, "w") as f:
        json.dump(records, f, indent=2, default=str)

# ── Recency weight ────────────────────────────────────────────────────────────
def recency_weight(graded_at_str: str | None) -> float:
    """Returns 2.0 for last 30 days, 1.5 for 31-90 days, 1.0 beyond."""
    if not graded_at_str:
        return 1.0
    try:
        graded = datetime.datetime.fromisoformat(str(graded_at_str).replace("Z", "+00:00").replace("+00:00", ""))
        days_ago = (NOW - graded).days
        if days_ago <= 30:
            return 2.0
        if days_ago <= 90:
            return 1.5
        return 1.0
    except Exception:
        return 1.0

# ── Feature extractors ────────────────────────────────────────────────────────
def extract_features(bet: dict) -> dict[str, Any]:
    sport     = (bet.get("sport") or "unknown").upper()
    bet_type  = (bet.get("betType") or bet.get("bet_type") or "unknown").lower()
    conf      = float(bet.get("confidenceScore") or bet.get("confidence_score") or 50)
    form_edge = float(bet.get("formEdgePct") or bet.get("form_edge_pct") or 0)
    hit_rate  = float(bet.get("hitRate") or bet.get("hit_rate") or 0.5)
    line      = float(bet.get("line") or 0)
    pick_side = (bet.get("pickSide") or bet.get("pick_side") or "").upper()

    # Edge-crew v3 grade fields — if present, use edge score (1-10) to enrich conf
    edge_score_raw = bet.get("edgeScore")  # float 1-10
    edge_grade_letter = (bet.get("edgeGrade") or "").upper()  # e.g. "A-", "B+"
    edge_sizing = (bet.get("edgeSizing") or "").lower()       # "2u","1.5u","1u","pass"
    if edge_score_raw is not None:
        # Blend edge-crew confidence into conf: edge_crew confidence = 55 + (score-5)*8
        edge_conf = max(40.0, min(95.0, 55.0 + (float(edge_score_raw) - 5.0) * 8.0))
        conf = round((conf * 0.4) + (edge_conf * 0.6), 1)  # weight edge engine higher

    # Confidence tier
    if conf >= 85:
        conf_tier = "elite"
    elif conf >= 70:
        conf_tier = "high"
    elif conf >= 55:
        conf_tier = "medium"
    else:
        conf_tier = "low"

    # Form edge tier
    if form_edge >= 20:
        edge_tier = "strong_over"
    elif form_edge >= 10:
        edge_tier = "moderate_over"
    elif form_edge <= -20:
        edge_tier = "strong_under"
    elif form_edge <= -10:
        edge_tier = "moderate_under"
    else:
        edge_tier = "flat"

    # Hit rate tier (recent L5 performance)
    if hit_rate >= 0.8:
        form_tier = "hot"
    elif hit_rate >= 0.6:
        form_tier = "above_avg"
    elif hit_rate >= 0.4:
        form_tier = "neutral"
    else:
        form_tier = "cold"

    # Player prop fields
    player_name   = (bet.get("playerName")   or bet.get("player_name")   or "").strip()
    stat_category = (bet.get("statCategory") or bet.get("stat_category") or "").upper().replace(" ", "_")

    return {
        "sport":        sport,
        "bet_type":     bet_type,
        "conf_tier":    conf_tier,
        "edge_tier":    edge_tier,
        "form_tier":    form_tier,
        "pick_side":    pick_side,
        "conf":         conf,
        "form_edge":    form_edge,
        "hit_rate":     hit_rate,
        "line":         line,
        "stat_category": stat_category,
        "player_name":  player_name,
    }

# ── Pattern accuracy engine ────────────────────────────────────────────────────
def compute_pattern_accuracy(outcomes: list[dict]) -> dict[str, dict]:
    """
    For every feature dimension, compute weighted win rate.
    Returns dict of {pattern_key: {wins, losses, total, win_rate, weight_adj}}
    """
    # Only use graded bets
    graded = [b for b in outcomes if b.get("result") in ("won", "lost", "push")]
    if not graded:
        return {}

    buckets: dict[str, dict] = defaultdict(lambda: {"wins": 0.0, "losses": 0.0, "pushes": 0.0, "total": 0.0})

    for bet in graded:
        result = bet.get("result")
        w      = recency_weight(bet.get("gradedAt") or bet.get("graded_at"))
        feats  = extract_features(bet)

        # Dimension keys to bucket
        dims = [
            f"sport:{feats['sport']}",
            f"bet_type:{feats['bet_type']}",
            f"sport:{feats['sport']}|bet_type:{feats['bet_type']}",
            f"conf_tier:{feats['conf_tier']}",
            f"edge_tier:{feats['edge_tier']}",
            f"form_tier:{feats['form_tier']}",
            f"pick_side:{feats['pick_side']}",
            f"sport:{feats['sport']}|conf_tier:{feats['conf_tier']}",
            f"sport:{feats['sport']}|edge_tier:{feats['edge_tier']}",
            f"bet_type:{feats['bet_type']}|conf_tier:{feats['conf_tier']}",
            f"bet_type:{feats['bet_type']}|form_tier:{feats['form_tier']}",
            f"sport:{feats['sport']}|pick_side:{feats['pick_side']}",
            # Player prop dimensions — only non-empty
            *(
                [
                    f"stat_category:{feats['stat_category']}",
                    f"sport:{feats['sport']}|stat_category:{feats['stat_category']}",
                    f"stat_category:{feats['stat_category']}|conf_tier:{feats['conf_tier']}",
                    f"stat_category:{feats['stat_category']}|pick_side:{feats['pick_side']}",
                    f"sport:{feats['sport']}|stat_category:{feats['stat_category']}|form_tier:{feats['form_tier']}",
                ]
                if feats.get("stat_category") else []
            ),
        ]

        for dim in dims:
            b = buckets[dim]
            b["total"] += w
            if result == "won":
                b["wins"] += w
            elif result == "lost":
                b["losses"] += w
            else:
                b["pushes"] += w

    # Compute win rate + weight adjustment
    result_map: dict[str, dict] = {}
    for key, b in buckets.items():
        if b["total"] < 3:  # need at least 3 weighted samples to trust
            continue
        win_rate  = b["wins"] / max(b["total"] - b["pushes"], 1)
        # Weight adjustment: how much to boost/penalize confidence
        # Neutral = 50% → 0 adj. 70% → +10. 30% → -10. Capped ±25.
        raw_adj   = (win_rate - 0.50) * 50        # [-25, +25]
        adj       = max(-25, min(25, raw_adj))
        result_map[key] = {
            "wins":     round(b["wins"], 1),
            "losses":   round(b["losses"], 1),
            "total":    round(b["total"], 1),
            "win_rate": round(win_rate, 3),
            "weight_adj": round(adj, 2),
        }

    return result_map

# ── Derive insight narratives ──────────────────────────────────────────────────
def derive_insights(patterns: dict, outcomes: list[dict]) -> list[dict]:
    insights = []
    graded = [b for b in outcomes if b.get("result") in ("won", "lost")]
    if not graded:
        return insights

    # Top performing patterns
    ranked = sorted(
        [(k, v) for k, v in patterns.items() if v["total"] >= 5],
        key=lambda x: x[1]["win_rate"],
        reverse=True
    )

    # Best 5 patterns
    for key, stats in ranked[:5]:
        pct = round(stats["win_rate"] * 100, 1)
        wins = int(stats["wins"])
        losses = int(stats["losses"])
        insights.append({
            "type":    "strength",
            "pattern": key,
            "title":   f"{pct}% win rate — {key.replace('|', ' + ').replace('_', ' ').replace(':', ': ')}",
            "detail":  f"{wins}W-{losses}L ({pct}% hit rate). The model should weight this pattern higher.",
            "adj":     stats["weight_adj"],
            "icon":    "🟢",
        })

    # Worst 5 patterns
    for key, stats in ranked[-5:][::-1]:
        pct = round(stats["win_rate"] * 100, 1)
        wins = int(stats["wins"])
        losses = int(stats["losses"])
        if pct < 45:
            insights.append({
                "type":    "weakness",
                "pattern": key,
                "title":   f"{pct}% win rate — {key.replace('|', ' + ').replace('_', ' ').replace(':', ': ')}",
                "detail":  f"{wins}W-{losses}L ({pct}%). The model has been overconfident here — reducing scores in this pattern.",
                "adj":     stats["weight_adj"],
                "icon":    "🔴",
            })

    # Confidence tier accuracy
    for tier in ["elite", "high", "medium", "low"]:
        key = f"conf_tier:{tier}"
        if key in patterns and patterns[key]["total"] >= 5:
            p = patterns[key]
            pct = round(p["win_rate"] * 100, 1)
            expected = {"elite": 85, "high": 72, "medium": 58, "low": 45}[tier]
            delta = pct - expected
            if abs(delta) >= 8:
                icon = "📈" if delta > 0 else "📉"
                insights.append({
                    "type":    "calibration",
                    "pattern": key,
                    "title":   f"{icon} {tier.capitalize()} confidence picks: {pct}% actual vs {expected}% expected",
                    "detail":  f"Model {'overperforms' if delta > 0 else 'underperforms'} at {tier} confidence by {abs(delta):.0f}pp. {'Calibration good.' if delta > 0 else 'Reducing score threshold recommended.'}",
                    "adj":     p["weight_adj"],
                    "icon":    icon,
                })

    # Sport-specific accuracy
    for sport in ["NBA", "NFL", "MLB", "NHL"]:
        key = f"sport:{sport}"
        if key in patterns and patterns[key]["total"] >= 5:
            p = patterns[key]
            pct = round(p["win_rate"] * 100, 1)
            if abs(pct - 52) >= 10:
                icon = "✅" if pct >= 55 else "⚠️"
                insights.append({
                    "type":    "sport",
                    "pattern": key,
                    "title":   f"{icon} {sport}: {pct}% win rate ({int(p['wins'])}W-{int(p['losses'])}L)",
                    "detail":  f"Model {'strong' if pct >= 55 else 'weak'} in {sport}. {'Keep prioritizing.' if pct >= 55 else 'Reducing confidence in ' + sport + ' picks.'}",
                    "adj":     p["weight_adj"],
                    "icon":    icon,
                })

    return insights

# ── Overall accuracy stats ────────────────────────────────────────────────────
def compute_accuracy_stats(outcomes: list[dict]) -> dict:
    graded = [b for b in outcomes if b.get("result") in ("won", "lost", "push")]
    if not graded:
        return {"total": 0, "won": 0, "lost": 0, "push": 0, "win_rate": 0, "roi_est": 0}

    by_sport: dict[str, dict] = defaultdict(lambda: {"won": 0, "lost": 0, "push": 0})
    by_type:  dict[str, dict] = defaultdict(lambda: {"won": 0, "lost": 0, "push": 0})
    by_conf:  dict[str, dict] = defaultdict(lambda: {"won": 0, "lost": 0, "push": 0})
    weekly:   dict[str, dict] = defaultdict(lambda: {"won": 0, "lost": 0})

    total_won = total_lost = total_push = 0

    for b in graded:
        result = b.get("result")
        sport  = (b.get("sport") or "other").upper()
        btype  = (b.get("betType") or "other").lower()
        conf   = float(b.get("confidenceScore") or 50)
        ctier  = "elite" if conf >= 85 else "high" if conf >= 70 else "medium" if conf >= 55 else "low"

        if result == "won":   total_won  += 1
        elif result == "lost": total_lost += 1
        else:                  total_push += 1

        s = by_sport[sport]
        t = by_type[btype]
        c = by_conf[ctier]

        for d in [s, t, c]:
            if result == "won":   d["won"]  += 1
            elif result == "lost": d["lost"] += 1
            else:                  d["push"] += 1

        # Weekly bucket
        graded_at = b.get("gradedAt") or b.get("graded_at")
        if graded_at:
            try:
                dt = datetime.datetime.fromisoformat(str(graded_at).replace("Z", ""))
                week_key = dt.strftime("%Y-W%V")
                if result == "won":   weekly[week_key]["won"]  += 1
                elif result == "lost": weekly[week_key]["lost"] += 1
            except Exception:
                pass

    total_decided = total_won + total_lost
    win_rate = total_won / max(total_decided, 1)

    # Simple ROI estimate (assuming -110 lines average)
    # Each won bet at -110 returns $90.91 on $100. Each lost = -$100.
    roi_est = round(((total_won * 90.91) - (total_lost * 100)) / max(total_decided * 100, 1) * 100, 1)

    return {
        "total":        len(graded),
        "won":          total_won,
        "lost":         total_lost,
        "push":         total_push,
        "win_rate":     round(win_rate, 3),
        "roi_est":      roi_est,
        "by_sport":     {k: {"won": v["won"], "lost": v["lost"],
                             "win_rate": round(v["won"] / max(v["won"]+v["lost"], 1), 3)}
                        for k, v in by_sport.items()},
        "by_type":      {k: {"won": v["won"], "lost": v["lost"],
                             "win_rate": round(v["won"] / max(v["won"]+v["lost"], 1), 3)}
                        for k, v in by_type.items()},
        "by_conf_tier": {k: {"won": v["won"], "lost": v["lost"],
                             "win_rate": round(v["won"] / max(v["won"]+v["lost"], 1), 3)}
                        for k, v in by_conf.items()},
        "weekly":       {k: {"won": v["won"], "lost": v["lost"],
                             "win_rate": round(v["won"] / max(v["won"]+v["lost"], 1), 3)}
                        for k, v in sorted(weekly.items())[-12:]},  # last 12 weeks
    }

# ── Build ml_weights.json ─────────────────────────────────────────────────────
def build_weights(patterns: dict, stats: dict) -> dict:
    """
    Returns a weights dict used by Kronos + scanner to nudge confidence scores.
    Structure:
      sport_weights:   {NBA: +5.2, NFL: -3.1, ...}
      bettype_weights: {player_prop: +7.1, spread: -2.0, ...}
      conf_tier_cal:   {elite: +2.0, high: -1.5, ...}  # calibration nudge
      edge_tier_weights: {strong_over: +8.0, flat: -1.0, ...}
      form_tier_weights: {hot: +6.0, cold: -5.0, ...}
      combo_weights:   {"sport:NBA|conf_tier:elite": +12.0, ...}
      overall_win_rate: 0.54
      last_run: "2026-04-10T..."
      sample_size: 847
    """
    def get_adj(key: str) -> float:
        return patterns.get(key, {}).get("weight_adj", 0.0)

    sports    = ["NBA", "NFL", "MLB", "NHL"]
    bet_types = ["player_prop", "spread", "total", "moneyline"]
    conf_tiers = ["elite", "high", "medium", "low"]
    edge_tiers = ["strong_over", "moderate_over", "flat", "moderate_under", "strong_under"]
    form_tiers = ["hot", "above_avg", "neutral", "cold"]

    combo_weights: dict[str, float] = {}
    for sport in sports:
        for ctier in conf_tiers:
            k = f"sport:{sport}|conf_tier:{ctier}"
            v = get_adj(k)
            if abs(v) >= 2:
                combo_weights[k] = v
    for btype in bet_types:
        for ctier in conf_tiers:
            k = f"bet_type:{btype}|conf_tier:{ctier}"
            v = get_adj(k)
            if abs(v) >= 2:
                combo_weights[k] = v

    # Sport+edge_tier combos (added for MLB props)
    for sport in sports:
        for etier in edge_tiers:
            k = f"sport:{sport}|edge_tier:{etier}"
            v = get_adj(k)
            if abs(v) >= 2:
                combo_weights[k] = v

    # Stat-category weights — MLB prop per-stat ML signal
    # Track HITS, HOME_RUNS, STRIKEOUTS, RBIS, WALKS, TOTAL_BASES, RUNS, STOLEN_BASES
    mlb_stat_cats = [
        "HITS", "HOME_RUNS", "RBIS", "STRIKEOUTS", "WALKS",
        "TOTAL_BASES", "RUNS", "STOLEN_BASES", "HITS_ALLOWED",
        "EARNED_RUNS", "OUTS",
        # NBA
        "POINTS", "ASSISTS", "REBOUNDS", "BLOCKS", "STEALS",
        # NHL
        "GOALS", "SHOTS_ON_GOAL",
    ]
    stat_category_weights: dict[str, float] = {}
    for sc in mlb_stat_cats:
        v = get_adj(f"stat_category:{sc}")
        if v != 0:
            stat_category_weights[sc] = v
        # Also add sport+stat combos for MLB (higher granularity signal)
        for sport in ["MLB", "NBA", "NHL"]:
            k = f"sport:{sport}|stat_category:{sc}"
            sv = get_adj(k)
            if abs(sv) >= 2:
                combo_weights[k] = sv

    return {
        "sport_weights":       {s: get_adj(f"sport:{s}") for s in sports},
        "bettype_weights":     {t: get_adj(f"bet_type:{t}") for t in bet_types},
        "conf_tier_cal":       {c: get_adj(f"conf_tier:{c}") for c in conf_tiers},
        "edge_tier_weights":   {e: get_adj(f"edge_tier:{e}") for e in edge_tiers},
        "form_tier_weights":   {f: get_adj(f"form_tier:{f}") for f in form_tiers},
        "pick_side_weights":   {
            "OVER":  get_adj("pick_side:OVER"),
            "UNDER": get_adj("pick_side:UNDER"),
        },
        "stat_category_weights": stat_category_weights,
        "combo_weights":       combo_weights,
        "overall_win_rate":    stats.get("win_rate", 0.5),
        "sample_size":         stats.get("total", 0),
        "last_run":            NOW.isoformat(),
        "version":             "2.0",
    }

# ── Main run ──────────────────────────────────────────────────────────────────
def run_ml_engine() -> dict:
    outcomes = load_outcomes()
    graded   = [b for b in outcomes if b.get("result") in ("won", "lost", "push")]

    if len(graded) < 5:
        result = {
            "status":       "insufficient_data",
            "message":      f"Need at least 5 graded outcomes. Currently have {len(graded)}.",
            "sample_size":  len(graded),
            "last_run":     NOW.isoformat(),
        }
        with open(INSIGHTS_FILE, "w") as f:
            json.dump(result, f, indent=2)
        return result

    # Core computation
    patterns = compute_pattern_accuracy(outcomes)
    stats    = compute_accuracy_stats(outcomes)
    insights = derive_insights(patterns, outcomes)
    weights  = build_weights(patterns, stats)

    # Write weights for Kronos to consume
    with open(WEIGHTS_FILE, "w") as f:
        json.dump(weights, f, indent=2)

    # Write insights for /api/ml-insights endpoint
    insights_payload = {
        "status":        "ok",
        "last_run":      NOW.isoformat(),
        "sample_size":   stats["total"],
        "accuracy":      stats,
        "patterns":      patterns,
        "insights":      insights,
        "weights":       weights,
    }
    with open(INSIGHTS_FILE, "w") as f:
        json.dump(insights_payload, f, indent=2, default=str)

    print(f"[ML Engine] Done — {stats['total']} graded | {stats['won']}W-{stats['lost']}L | {round(stats['win_rate']*100,1)}% win rate | {len(insights)} insights | {len(patterns)} patterns")
    return insights_payload

# ── CLI entry ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "append":
        record = json.loads(sys.argv[2])
        append_outcome(record)
        print(f"[ML Engine] Appended outcome for bet {record.get('betId')}")
    else:
        result = run_ml_engine()
        print(json.dumps(result, indent=2, default=str))
