/**
 * ml-weights.ts — Shared ML weight loader + adjuster
 * Extracted into its own module to avoid circular deps between routes.ts ↔ scanner.ts
 */

import * as fs from "fs";
import * as path from "path";

const ML_DATA_DIR      = path.join(__dirname, "ml_data");
const ML_WEIGHTS_FILE  = path.join(ML_DATA_DIR, "ml_weights.json");

let _ML_WEIGHTS: Record<string, any> | null = null;

export function loadMLWeights(): Record<string, any> {
  try {
    if (fs.existsSync(ML_WEIGHTS_FILE)) {
      _ML_WEIGHTS = JSON.parse(fs.readFileSync(ML_WEIGHTS_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return _ML_WEIGHTS ?? {};
}

// Load at module init
loadMLWeights();

/**
 * Apply learned ML weight nudge to a raw confidence score.
 * - MLB gets a lower sample threshold (5 vs 10) and 1.8× sport multiplier
 *   because the 162-game season produces the strongest regression signal.
 * - Props Hub (Linemate) match earns a +3 base boost + amplification of
 *   existing positive pattern signal.
 * - Per-stat ML weights (HITS, HOME_RUNS, STRIKEOUTS, etc.) applied for MLB.
 * - Total adjustment capped ±18 to prevent wild swings.
 */
export function applyMLWeights(
  baseConf: number,
  opts: {
    sport?: string;
    betType?: string;
    formEdgePct?: number;
    hitRate?: number;
    pickSide?: string;
    statCategory?: string;       // e.g. "hits", "home_runs" — per-stat ML weight
    linematePriority?: boolean;  // true = Props Hub (Linemate) confirmed this pick
  }
): number {
  const w = _ML_WEIGHTS;
  if (!w || !w.sample_size) return baseConf;

  const sport = (opts.sport ?? "").toUpperCase();

  // MLB needs fewer samples to influence scoring — 162-game season has strong regression signal
  const minSamples = sport === "MLB" ? 5 : 10;
  if (w.sample_size < minSamples) return baseConf;

  let adj = 0;
  const btype   = (opts.betType ?? "").toLowerCase();
  const fe      = opts.formEdgePct ?? 0;
  const hr      = opts.hitRate ?? 0.5;
  const ps      = (opts.pickSide ?? "").toUpperCase();
  const statCat = (opts.statCategory ?? "").toUpperCase().replace(/\s+/g, "_");

  const confTier = baseConf >= 85 ? "elite" : baseConf >= 70 ? "high" : baseConf >= 55 ? "medium" : "low";
  const edgeTier = fe >= 20 ? "strong_over" : fe >= 10 ? "moderate_over" : fe <= -20 ? "strong_under" : fe <= -10 ? "moderate_under" : "flat";
  const formTier = hr >= 0.8 ? "hot" : hr >= 0.6 ? "above_avg" : hr >= 0.4 ? "neutral" : "cold";

  // MLB gets 1.8× weight multiplier — larger sample, stronger regression signal
  const sportMult = sport === "MLB" ? 1.8 : 1.0;

  if (w.sport_weights?.[sport])        adj += (w.sport_weights[sport]   ?? 0) * 0.4 * sportMult;
  if (w.bettype_weights?.[btype])      adj += (w.bettype_weights[btype] ?? 0) * 0.4;
  if (w.conf_tier_cal?.[confTier])     adj += (w.conf_tier_cal[confTier] ?? 0) * 0.3;
  if (w.edge_tier_weights?.[edgeTier]) adj += (w.edge_tier_weights[edgeTier] ?? 0) * 0.4;
  if (w.form_tier_weights?.[formTier]) adj += (w.form_tier_weights[formTier] ?? 0) * 0.3;
  if (ps && w.pick_side_weights?.[ps]) adj += (w.pick_side_weights[ps]  ?? 0) * 0.2;

  // Per-stat ML weight — MLB props tracked individually (HITS, HOME_RUNS, STRIKEOUTS…)
  if (statCat && w.stat_category_weights?.[statCat]) {
    adj += (w.stat_category_weights[statCat] ?? 0) * (sport === "MLB" ? 0.6 : 0.4);
  }
  // Sport+stat combo — most granular MLB signal
  if (statCat && sport) {
    const sportStatKey = `sport:${sport}|stat_category:${statCat}`;
    adj += (w.combo_weights?.[sportStatKey] ?? 0) * (sport === "MLB" ? 0.45 : 0.25);
  }

  // Props Hub (Linemate) priority boost
  // When Props Hub cross-validates a pick, trust it more
  if (opts.linematePriority) {
    const patternAdj = adj;
    if (patternAdj > 0) {
      adj += Math.min(5, patternAdj * 0.4); // amplify existing positive signal
    }
    adj += 3; // base Props Hub confirmation bonus
  }

  // Combo boosters
  const combos = [
    `sport:${sport}|conf_tier:${confTier}`,
    `bet_type:${btype}|conf_tier:${confTier}`,
    `sport:${sport}|edge_tier:${edgeTier}`,
    `bet_type:${btype}|form_tier:${formTier}`,
  ];
  for (const combo of combos) {
    adj += (w.combo_weights?.[combo] ?? 0) * 0.25;
  }

  // Cap: raise ceiling to 18 for MLB+Props Hub confluence
  adj = Math.max(-15, Math.min(18, adj));
  return Math.round(Math.max(0, Math.min(100, baseConf + adj)));
}
