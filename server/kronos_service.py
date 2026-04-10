"""
Kronos AI Forecasting Microservice
===================================
Inspired by the Kronos foundation model architecture (shiyu-coder/Kronos) for
financial K-line (candlestick / OHLCV) time-series forecasting.

Since the full Kronos model requires PyTorch + 4GB+ download, this service
implements the core decomposition + forecasting logic using pure numpy/scipy:

  1. STL-style decomposition (trend + seasonality + residual)
  2. Linear trend projection
  3. Holt-Winters exponential smoothing for near-term
  4. Confidence interval via residual spread
  5. Signal classification (bullish / bearish / neutral) with strength score

Input:  JSON list of {t: unix_timestamp, p: float[0..1]}
Output: {signal, strength, forecast, explanation, trend_slope, volatility}

Port: 5050 (proxied by Express at /api/prediction-markets/kronos/:marketId)
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import math
import numpy as np
from scipy.signal import savgol_filter
from scipy.stats import linregress
import sys
import traceback

PORT = 5050
VERSION = "1.0.0"

# ── Core forecasting engine ─────────────────────────────────────────────────

def _smooth(prices: np.ndarray, window: int = 5) -> np.ndarray:
    """Apply Savitzky-Golay smoothing (like Kronos trend decomp)."""
    if len(prices) < window:
        return prices.copy()
    w = min(window, len(prices) if len(prices) % 2 == 1 else len(prices) - 1)
    if w < 3:
        return prices.copy()
    if w % 2 == 0:
        w -= 1
    try:
        return savgol_filter(prices, window_length=w, polyorder=2)
    except Exception:
        return prices.copy()

def _compute_volatility(residuals: np.ndarray) -> float:
    """Annualised-style volatility of residuals (std dev)."""
    if len(residuals) < 2:
        return 0.0
    return float(np.std(residuals))

def _holt_winters_forecast(prices: np.ndarray, steps: int, alpha: float = 0.3, beta: float = 0.1) -> np.ndarray:
    """Simple Holt (double exponential smoothing) — level + trend."""
    if len(prices) < 2:
        return np.full(steps, prices[-1] if len(prices) else 0.5)

    level = float(prices[0])
    trend = float(prices[1] - prices[0])

    for p in prices[1:]:
        prev_level = level
        level = alpha * p + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend

    forecast = np.array([level + (i + 1) * trend for i in range(steps)])
    return np.clip(forecast, 0.0, 1.0)

def _linear_forecast(prices: np.ndarray, steps: int) -> tuple[np.ndarray, float, float]:
    """Fit OLS trend line and project forward."""
    x = np.arange(len(prices), dtype=float)
    slope, intercept, r_value, p_value, std_err = linregress(x, prices)
    x_fwd = np.arange(len(prices), len(prices) + steps, dtype=float)
    projected = intercept + slope * x_fwd
    return np.clip(projected, 0.0, 1.0), float(slope), float(r_value ** 2)

def _detect_momentum(prices: np.ndarray, window: int = 8) -> float:
    """Momentum = average rate of change over last `window` points."""
    if len(prices) < 2:
        return 0.0
    tail = prices[-min(window, len(prices)):]
    diffs = np.diff(tail)
    return float(np.mean(diffs))

def _detect_support_resistance(prices: np.ndarray) -> dict:
    """Simple pivot-based S/R detection."""
    if len(prices) < 10:
        return {"support": None, "resistance": None}
    recent = prices[-20:]
    support = float(np.percentile(recent, 15))
    resistance = float(np.percentile(recent, 85))
    return {"support": round(support * 100, 1), "resistance": round(resistance * 100, 1)}

def kronos_forecast(history: list[dict], pred_steps: int = 12) -> dict:
    """
    Main Kronos-inspired forecasting pipeline.

    Parameters
    ----------
    history   : list of {t: int, p: float}  — raw price history
    pred_steps: how many future steps to forecast (default 12 ≈ 12h ahead)

    Returns
    -------
    dict with keys:
      signal      : "bullish" | "bearish" | "neutral"
      strength    : 0-100 (Kronos confidence-style score)
      forecast    : list of {step, price_cents, ci_low, ci_high}
      explanation : human-readable string
      trend_slope : raw slope per step (in price units)
      volatility  : residual std dev
      momentum    : momentum over last 8 steps
      sr          : {support, resistance} in cents
    """
    if not history or len(history) < 2:
        return {
            "signal": "neutral",
            "strength": 0,
            "forecast": [],
            "explanation": "Insufficient price history for Kronos analysis.",
            "trend_slope": 0,
            "volatility": 0,
            "momentum": 0,
            "sr": {"support": None, "resistance": None},
        }

    # Extract price series
    prices_raw = np.array([h["p"] for h in history], dtype=float)
    prices_raw = np.clip(prices_raw, 0.0, 1.0)

    # Remove near-resolved markets (price stuck at extremes)
    latest = float(prices_raw[-1])
    if latest > 0.97 or latest < 0.02:
        return {
            "signal": "neutral",
            "strength": 0,
            "forecast": [],
            "explanation": "Market is near resolution — Kronos skips near-settled contracts.",
            "trend_slope": 0,
            "volatility": 0,
            "momentum": 0,
            "sr": {"support": None, "resistance": None},
        }

    # 1. Smooth / detrend (Kronos decomp step)
    smoothed = _smooth(prices_raw, window=min(9, max(3, len(prices_raw) // 4)))
    residuals = prices_raw - smoothed

    # 2. Dual forecast: linear OLS + Holt-Winters
    lin_forecast, slope, r2 = _linear_forecast(smoothed, pred_steps)
    hw_forecast = _holt_winters_forecast(smoothed, pred_steps)

    # 3. Blend (weight toward HW for short horizon, linear for longer)
    blend_w = min(1.0, pred_steps / 24.0)  # 0→1 as pred_steps goes 0→24
    blended = (1 - blend_w) * hw_forecast + blend_w * lin_forecast
    blended = np.clip(blended, 0.0, 1.0)

    # 4. Confidence intervals from residual volatility
    vol = _compute_volatility(residuals)
    ci_mult = 1.65  # 90% CI
    ci_spread = vol * ci_mult * np.sqrt(np.arange(1, pred_steps + 1))

    forecast_points = []
    for i in range(pred_steps):
        p_hat = float(blended[i])
        forecast_points.append({
            "step": i + 1,
            "price_cents": round(p_hat * 100, 1),
            "ci_low":  round(max(0.0, p_hat - ci_spread[i]) * 100, 1),
            "ci_high": round(min(1.0, p_hat + ci_spread[i]) * 100, 1),
        })

    # 5. Momentum + direction
    momentum = _detect_momentum(prices_raw)
    sr = _detect_support_resistance(prices_raw)

    # 6. Signal scoring (0–100)
    # Combines: trend direction, R², momentum, current vs fair
    slope_score = min(1.0, abs(slope) / 0.01)  # normalise slope
    direction = 1 if slope > 0 else (-1 if slope < 0 else 0)
    mom_score  = min(1.0, abs(momentum) / 0.005)
    r2_score   = float(r2)

    # Weighted composite
    raw_strength = (slope_score * 0.4 + mom_score * 0.35 + r2_score * 0.25) * 100
    strength = min(99, max(1, round(raw_strength)))

    # Signal classification
    if direction > 0 and strength >= 30:
        signal = "bullish"
    elif direction < 0 and strength >= 30:
        signal = "bearish"
    else:
        signal = "neutral"

    # 7. Build explanation
    slope_pct = round(slope * 100 * 100, 2)  # slope in cents-per-step
    final_price = round(float(blended[-1]) * 100, 1)
    explanation_parts = []

    if signal == "bullish":
        explanation_parts.append(f"Kronos detects an upward trend (+{abs(slope_pct)}¢/step).")
        explanation_parts.append(f"Projected YES price in {pred_steps} steps: {final_price}¢.")
    elif signal == "bearish":
        explanation_parts.append(f"Kronos detects a downward trend (−{abs(slope_pct)}¢/step).")
        explanation_parts.append(f"Projected YES price in {pred_steps} steps: {final_price}¢.")
    else:
        explanation_parts.append("Kronos finds no strong directional trend — market is ranging.")
        explanation_parts.append(f"Price expected near {final_price}¢.")

    if vol > 0.04:
        explanation_parts.append(f"High volatility ({round(vol*100,1)}¢ σ) — wide forecast range.")
    elif vol < 0.01:
        explanation_parts.append("Low volatility — tight confidence interval.")

    if sr["support"] and sr["resistance"]:
        explanation_parts.append(
            f"S/R levels: support {sr['support']}¢, resistance {sr['resistance']}¢."
        )

    explanation = " ".join(explanation_parts)

    return {
        "signal": signal,
        "strength": strength,
        "forecast": forecast_points,
        "explanation": explanation,
        "trend_slope": round(slope_pct, 3),
        "volatility": round(vol * 100, 2),
        "momentum": round(momentum * 100, 3),
        "sr": sr,
        "r2": round(float(r2), 3),
        "data_points": len(prices_raw),
        "current_cents": round(latest * 100, 1),
        "projected_cents": final_price,
    }

# ── HTTP Handler ─────────────────────────────────────────────────────────────

class KronosHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # Suppress default access logging

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
            self._json(200, {"status": "ok", "version": VERSION, "model": "kronos-numpy"})
            return
        self._json(404, {"error": "Not found. POST to /forecast"})

    def do_POST(self):
        if self.path != "/forecast":
            self._json(404, {"error": "POST /forecast only"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body)
            history = payload.get("history", [])
            pred_steps = int(payload.get("pred_steps", 12))
            pred_steps = max(1, min(pred_steps, 48))

            result = kronos_forecast(history, pred_steps)
            self._json(200, result)
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[Kronos] Error: {e}\n{tb}", file=sys.stderr)
            self._json(500, {"error": str(e), "signal": "neutral", "strength": 0, "forecast": []})

# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), KronosHandler)
    print(f"[Kronos] Microservice v{VERSION} running on port {PORT}", flush=True)
    server.serve_forever()
