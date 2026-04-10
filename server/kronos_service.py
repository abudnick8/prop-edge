"""
Kronos AI Forecasting Microservice — Sports Edition
=====================================================
Inspired by the Kronos foundation model (shiyu-coder/Kronos) for K-line
(candlestick/OHLCV) time-series forecasting applied to prediction market
YES contract price history.

The same statistical intelligence used in financial markets translates
directly to sports prediction markets:

  STOCKS                      →   SPORTS CONTRACTS
  ─────────────────────────────────────────────────
  Price momentum               =   Contract price trend (odds drifting)
  Volume spike                 =   Whale / sharp-money buy
  Support / Resistance         =   Market consensus anchors (50¢, etc.)
  Trend reversal               =   Line movement against public
  Volatility regime            =   Game-time uncertainty (injury news, etc.)
  Breakout above resistance    =   Odds shortening (market moving toward YES)
  Breakdown below support      =   Market cooling / fading

Sports-specific additions over generic Kronos:
  • Line-movement bias: price drift in last 1h vs 24h (sharp-money signal)
  • Momentum divergence: short-term vs long-term slope crossover
  • Volatility regime: high = game-time info; low = stable consensus
  • Near-50¢ flag: true toss-up — extra caution label
  • Late-breaking signal: large move in last 3 data points
  • Conviction bands: CI narrows if R² is high (model is confident)

Port: 5050
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import json
import math
import numpy as np
from scipy.signal import savgol_filter
from scipy.stats import linregress
import sys
import traceback

PORT = 5050
VERSION = "2.0.0-sports"

# ── Core math helpers ─────────────────────────────────────────────────────────

def _smooth(prices: np.ndarray, window: int = 5) -> np.ndarray:
    """Savitzky-Golay smoothing — same decomp kernel as Kronos."""
    if len(prices) < 3:
        return prices.copy()
    w = min(window, len(prices))
    if w % 2 == 0:
        w -= 1
    w = max(3, w)
    try:
        return savgol_filter(prices, window_length=w, polyorder=2)
    except Exception:
        return prices.copy()

def _linreg(y: np.ndarray) -> tuple:
    """OLS regression → (slope, intercept, r2)."""
    x = np.arange(len(y), dtype=float)
    slope, intercept, r, _, _ = linregress(x, y)
    return float(slope), float(intercept), float(r ** 2)

def _holt_forecast(prices: np.ndarray, steps: int,
                   alpha: float = 0.3, beta: float = 0.1) -> np.ndarray:
    """Holt double-exponential smoothing (level + trend)."""
    if len(prices) < 2:
        return np.full(steps, float(prices[-1]) if len(prices) else 0.5)
    lvl = float(prices[0])
    trn = float(prices[1] - prices[0])
    for p in prices[1:]:
        prev = lvl
        lvl = alpha * p + (1 - alpha) * (lvl + trn)
        trn = beta * (lvl - prev) + (1 - beta) * trn
    return np.clip([lvl + (i + 1) * trn for i in range(steps)], 0.0, 1.0)

def _momentum(prices: np.ndarray, window: int = 8) -> float:
    """Average rate-of-change over last N points."""
    tail = prices[-min(window, len(prices)):]
    return float(np.mean(np.diff(tail))) if len(tail) > 1 else 0.0

def _sr_levels(prices: np.ndarray) -> dict:
    """Support/Resistance via percentile pivots."""
    if len(prices) < 6:
        return {"support": None, "resistance": None}
    recent = prices[-min(30, len(prices)):]
    return {
        "support":    round(float(np.percentile(recent, 15)) * 100, 1),
        "resistance": round(float(np.percentile(recent, 85)) * 100, 1),
    }

# ── Sports-specific signals ───────────────────────────────────────────────────

def _line_movement_bias(prices: np.ndarray) -> dict:
    """
    Sharp-money detector — the same logic used by Vegas line trackers.

    In sports betting, when the line moves AGAINST public money direction,
    it signals sharp (professional) action. Here, if the YES price is
    drifting steadily upward on low noise, it mirrors a line being
    steamed by sharps.

    Returns:
      short_slope  — price change rate over last 6 pts (recent action)
      long_slope   — price change rate over all pts (market consensus)
      bias         — "sharp_yes" | "sharp_no" | "neutral"
      divergence   — short vs long slope gap (large = late-breaking info)
    """
    if len(prices) < 6:
        return {"short_slope": 0, "long_slope": 0, "bias": "neutral", "divergence": 0}

    long_sl,  _, _ = _linreg(prices)
    short_sl, _, _ = _linreg(prices[-6:])

    divergence = float(short_sl - long_sl)

    # Sharp signal: recent move accelerates in same direction as trend
    if short_sl > 0 and divergence > 0.001:
        bias = "sharp_yes"   # late money piling into YES
    elif short_sl < 0 and divergence < -0.001:
        bias = "sharp_no"    # sharp fade — NO gaining steam
    else:
        bias = "neutral"

    return {
        "short_slope": round(short_sl * 100, 3),
        "long_slope":  round(long_sl  * 100, 3),
        "bias":        bias,
        "divergence":  round(divergence * 100, 3),
    }

def _late_breaking_signal(prices: np.ndarray) -> dict:
    """
    Detects sudden price moves in the last 3 data points —
    the equivalent of injury news, lineup changes, or last-minute
    sharp action in sports markets.

    A move > 2× the average step change is flagged as late-breaking.
    """
    if len(prices) < 4:
        return {"detected": False, "direction": None, "magnitude": 0}

    avg_step = float(np.mean(np.abs(np.diff(prices[:-3])))) if len(prices) > 4 else 0.01
    recent_move = float(prices[-1] - prices[-3])
    threshold = max(0.02, avg_step * 2)

    if abs(recent_move) > threshold:
        return {
            "detected":  True,
            "direction": "bullish" if recent_move > 0 else "bearish",
            "magnitude": round(abs(recent_move) * 100, 1),
        }
    return {"detected": False, "direction": None, "magnitude": 0}

def _volatility_regime(vol: float) -> str:
    """
    Classify volatility like a sports analyst would read uncertainty:
      high   = active game-time info flowing (injury, weather, lineup)
      medium = normal market churn
      low    = settled consensus, market is efficient
    """
    if vol > 0.05:   return "high"
    if vol > 0.02:   return "medium"
    return "low"

def _tossup_flag(prices: np.ndarray) -> bool:
    """True if market is near 50¢ — genuine uncertainty, like a pick-em game."""
    if len(prices) == 0:
        return False
    return 0.42 <= float(prices[-1]) <= 0.58

def _momentum_crossover(prices: np.ndarray) -> str:
    """
    Kronos-style dual-MA crossover (short vs long moving average).
    In stocks: golden cross = bullish, death cross = bearish.
    In sports: YES price short MA crossing above long MA = sharp buy signal.
    """
    if len(prices) < 10:
        return "none"
    short_ma = float(np.mean(prices[-4:]))
    long_ma  = float(np.mean(prices[-10:]))
    prev_short = float(np.mean(prices[-5:-1]))
    prev_long  = float(np.mean(prices[-11:-1])) if len(prices) >= 11 else long_ma

    if prev_short <= prev_long and short_ma > long_ma:
        return "golden_cross"   # bullish crossover
    if prev_short >= prev_long and short_ma < long_ma:
        return "death_cross"    # bearish crossover
    if short_ma > long_ma:
        return "above"
    return "below"

# ── Main Kronos Sports forecast engine ───────────────────────────────────────

def kronos_forecast(history: list[dict], pred_steps: int = 12) -> dict:
    """
    Full Kronos Sports pipeline.

    Parameters
    ----------
    history    : [{t: unix_ts, p: float[0..1]}]
    pred_steps : steps to forecast (default 12)

    Returns
    -------
    Full signal dict — see inline keys below.
    """
    if not history or len(history) < 2:
        return _empty("Insufficient price history for Kronos Sports analysis.")

    prices_raw = np.clip([h["p"] for h in history], 0.0, 1.0).astype(float)
    latest = float(prices_raw[-1])

    if latest > 0.97 or latest < 0.02:
        return _empty("Market near resolution — Kronos skips near-settled contracts.")

    # ── 1. Decomposition (Kronos trend extraction) ──────────────────────────
    smoothed  = _smooth(prices_raw, window=min(9, max(3, len(prices_raw) // 4)))
    residuals = prices_raw - smoothed
    vol       = float(np.std(residuals))

    # ── 2. Dual forecast: Holt-Winters (short) + OLS (long) ─────────────────
    lin_proj, slope, r2 = _linreg(smoothed)
    # lin_proj is a scalar; project forward
    x_fwd     = np.arange(len(smoothed), len(smoothed) + pred_steps, dtype=float)
    lin_fwd   = np.clip(lin_proj + slope * (x_fwd - (len(smoothed) - 1)), 0.0, 1.0)
    hw_fwd    = _holt_forecast(smoothed, pred_steps)

    blend_w   = min(1.0, pred_steps / 24.0)
    blended   = np.clip((1 - blend_w) * hw_fwd + blend_w * lin_fwd, 0.0, 1.0)

    # CI widens with horizon, narrows with R² confidence
    ci_conf   = max(0.3, 1.0 - r2)         # low R² → wider CI
    ci_spread = vol * 1.65 * np.sqrt(np.arange(1, pred_steps + 1)) * ci_conf
    forecast  = [
        {
            "step":        i + 1,
            "price_cents": round(float(blended[i]) * 100, 1),
            "ci_low":      round(max(0.0, float(blended[i]) - ci_spread[i]) * 100, 1),
            "ci_high":     round(min(1.0, float(blended[i]) + ci_spread[i]) * 100, 1),
        }
        for i in range(pred_steps)
    ]

    # ── 3. Sports-specific signals ───────────────────────────────────────────
    mom          = _momentum(prices_raw)
    lm           = _line_movement_bias(prices_raw)
    lb           = _late_breaking_signal(prices_raw)
    sr           = _sr_levels(prices_raw)
    vol_regime   = _volatility_regime(vol)
    tossup       = _tossup_flag(prices_raw)
    crossover    = _momentum_crossover(prices_raw)
    proj_cents   = round(float(blended[-1]) * 100, 1)

    # ── 4. Composite strength score (0–100) ──────────────────────────────────
    # Same multi-factor model as financial Kronos but sports-weighted
    slope_score = min(1.0, abs(slope) / 0.01)
    mom_score   = min(1.0, abs(mom)   / 0.005)
    r2_score    = float(r2)
    lm_bonus    = 0.15 if lm["bias"] != "neutral" else 0.0
    lb_bonus    = 0.10 if lb["detected"] else 0.0
    cross_bonus = 0.10 if crossover in ("golden_cross", "death_cross") else 0.0
    tossup_pen  = -0.20 if tossup else 0.0

    raw = (slope_score * 0.35 + mom_score * 0.30 + r2_score * 0.20
           + lm_bonus + lb_bonus + cross_bonus + tossup_pen) * 100
    strength = min(99, max(1, round(raw)))

    # ── 5. Signal direction ──────────────────────────────────────────────────
    direction = 1 if slope > 0 else (-1 if slope < 0 else 0)

    # Override direction based on crossover
    if crossover == "golden_cross":
        direction = 1
    elif crossover == "death_cross":
        direction = -1

    # Line-movement bias can flip weak signals
    if strength < 35:
        if lm["bias"] == "sharp_yes":
            direction = 1
        elif lm["bias"] == "sharp_no":
            direction = -1

    if direction > 0 and strength >= 25:
        signal = "bullish"
    elif direction < 0 and strength >= 25:
        signal = "bearish"
    else:
        signal = "neutral"

    # ── 6. Plain-English sports explanation ─────────────────────────────────
    slope_pct = round(slope * 100 * 100, 2)
    parts = []

    # Primary trend
    if signal == "bullish":
        parts.append(f"Kronos detects YES price trending up (+{abs(slope_pct)}¢/step) — mirrors a line steaming toward this outcome.")
    elif signal == "bearish":
        parts.append(f"Kronos detects YES price fading (−{abs(slope_pct)}¢/step) — mirrors a line being bet down.")
    else:
        parts.append("Kronos finds no strong directional edge — market is at equilibrium.")

    # Sharp money signal
    if lm["bias"] == "sharp_yes":
        parts.append(f"Late money accelerating into YES ({lm['short_slope']:+.2f}¢/step recent vs {lm['long_slope']:+.2f}¢/step overall) — sharp indicator.")
    elif lm["bias"] == "sharp_no":
        parts.append(f"Recent selling pressure on YES ({lm['short_slope']:+.2f}¢/step recent) — sharps may be fading this contract.")

    # Late-breaking info
    if lb["detected"]:
        parts.append(f"Late-breaking {lb['direction']} signal: {lb['magnitude']}¢ move in last 3 data points — possible injury/lineup news.")

    # Momentum crossover
    if crossover == "golden_cross":
        parts.append("Short-term MA crossed above long-term MA (golden cross) — bullish momentum shift.")
    elif crossover == "death_cross":
        parts.append("Short-term MA crossed below long-term MA (death cross) — bearish momentum shift.")

    # Toss-up flag
    if tossup:
        parts.append("Market is near 50¢ — genuine pick-em. Both sides carry risk.")

    # Volatility regime
    if vol_regime == "high":
        parts.append(f"High volatility ({round(vol*100,1)}¢ σ) — active information flow, possibly game-time factors.")
    elif vol_regime == "low":
        parts.append("Low volatility — stable consensus, market is settled.")

    # Projection
    parts.append(f"Projected YES price in {pred_steps} steps: {proj_cents}¢.")

    explanation = " ".join(parts)

    # ── 7. Action label ──────────────────────────────────────────────────────
    if signal == "bullish" and strength >= 50:
        action = f"Kronos favors YES (target {proj_cents}¢) — trend + line movement confirm."
    elif signal == "bearish" and strength >= 50:
        action = f"Kronos favors NO contract (YES projected to fall to {proj_cents}¢)."
    elif signal == "bullish":
        action = f"Weak YES lean — {proj_cents}¢ target but low conviction."
    elif signal == "bearish":
        action = f"Weak NO lean — {proj_cents}¢ projected but low conviction."
    else:
        action = "No edge — hold off or monitor for line movement."

    return {
        # Core signal
        "signal":           signal,
        "strength":         strength,
        "forecast":         forecast,
        "explanation":      explanation,
        "action":           action,

        # Trend metrics (like Kronos financial output)
        "trend_slope":      round(slope_pct, 3),
        "volatility":       round(vol * 100, 2),
        "volatility_regime": vol_regime,
        "momentum":         round(mom * 100, 3),
        "r2":               round(float(r2), 3),

        # Sports-specific signals
        "line_movement":    lm,
        "late_breaking":    lb,
        "crossover":        crossover,
        "tossup":           tossup,

        # Price levels
        "sr":               sr,
        "current_cents":    round(latest * 100, 1),
        "projected_cents":  proj_cents,
        "data_points":      len(prices_raw),
    }

def _empty(msg: str) -> dict:
    return {
        "signal": "neutral", "strength": 0, "forecast": [],
        "explanation": msg, "action": "Insufficient data.",
        "trend_slope": 0, "volatility": 0, "volatility_regime": "low",
        "momentum": 0, "r2": 0,
        "line_movement": {"short_slope": 0, "long_slope": 0, "bias": "neutral", "divergence": 0},
        "late_breaking": {"detected": False, "direction": None, "magnitude": 0},
        "crossover": "none", "tossup": False,
        "sr": {"support": None, "resistance": None},
        "current_cents": 0, "projected_cents": 0, "data_points": 0,
    }

# ── HTTP Handler ─────────────────────────────────────────────────────────────

class KronosHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "version": VERSION, "model": "kronos-sports"})
            return
        self._json(404, {"error": "POST to /forecast"})

    def do_POST(self):
        if self.path != "/forecast":
            self._json(404, {"error": "POST /forecast only"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length)
            payload = json.loads(body)
            history    = payload.get("history", [])
            pred_steps = max(1, min(int(payload.get("pred_steps", 12)), 48))
            result = kronos_forecast(history, pred_steps)
            self._json(200, result)
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[Kronos] Error: {e}\n{tb}", file=sys.stderr)
            self._json(500, {**_empty(str(e)), "error": str(e)})

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each request in a separate thread so 200+ parallel calls don't queue."""
    daemon_threads = True

if __name__ == "__main__":
    server = ThreadedHTTPServer(("0.0.0.0", PORT), KronosHandler)
    print(f"[Kronos] Microservice v{VERSION} running on port {PORT} (threaded)", flush=True)
    server.serve_forever()
