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
 * No-ops until we have ≥ 10 graded outcomes (insufficient data).
 * Caps the total adjustment at ±15 to prevent wild swings.
 */
export function applyMLWeights(
  baseConf: number,
  opts: {
    sport?: string;
    betType?: string;
    formEdgePct?: number;
    hitRate?: number;
    pickSide?: string;
  }
): number {
  const w = _ML_WEIGHTS;
  if (!w || !w.sample_size || w.sample_size < 10) return baseConf;

  let adj = 0;
  const sport    = (opts.sport    ?? "").toUpperCase();
  const btype    = (opts.betType  ?? "").toLowerCase();
  const fe       = opts.formEdgePct ?? 0;
  const hr       = opts.hitRate    ?? 0.5;
  const ps       = (opts.pickSide  ?? "").toUpperCase();

  const confTier = baseConf >= 85 ? "elite" : baseConf >= 70 ? "high" : baseConf >= 55 ? "medium" : "low";
  const edgeTier = fe >= 20 ? "strong_over" : fe >= 10 ? "moderate_over" : fe <= -20 ? "strong_under" : fe <= -10 ? "moderate_under" : "flat";
  const formTier = hr >= 0.8 ? "hot" : hr >= 0.6 ? "above_avg" : hr >= 0.4 ? "neutral" : "cold";

  if (w.sport_weights?.[sport])            adj += (w.sport_weights[sport]   ?? 0) * 0.4;
  if (w.bettype_weights?.[btype])          adj += (w.bettype_weights[btype] ?? 0) * 0.4;
  if (w.conf_tier_cal?.[confTier])         adj += (w.conf_tier_cal[confTier]?? 0) * 0.3;
  if (w.edge_tier_weights?.[edgeTier])     adj += (w.edge_tier_weights[edgeTier] ?? 0) * 0.4;
  if (w.form_tier_weights?.[formTier])     adj += (w.form_tier_weights[formTier] ?? 0) * 0.3;
  if (ps && w.pick_side_weights?.[ps])     adj += (w.pick_side_weights[ps]  ?? 0) * 0.2;

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

  adj = Math.max(-15, Math.min(15, adj));
  return Math.round(Math.max(0, Math.min(100, baseConf + adj)));
}
