/**
 * shareGameCard — draws a Clubhouse IQ game card onto a canvas and shares/downloads it.
 * Pure canvas approach — works on iOS Safari without html2canvas or off-screen React rendering.
 */

export interface ShareGameData {
  sport: string;
  awayTeam: string;
  homeTeam: string;
  gameTime: string | null;
  spread: string | null;
  spreadMove?: string | null;
  total: string | null;
  totalMove?: string | null;
  mlAway: string | null;
  mlHome: string | null;
  mlAwayMove?: string | null;
  mlHomeMove?: string | null;
  // Public money (optional)
  spreadAwayMoney?: number | null;
  spreadAwayPublic?: number | null;
  totalOverMoney?: number | null;
  totalOverPublic?: number | null;
  mlAwayMoney?: number | null;
  mlAwayPublic?: number | null;
  // Signals
  hasSteam?: boolean;
  hasMoved?: boolean;
  ciqGrade?: string | null;
  ciqPickTeam?: string | null;
  sharpScore?: number | null;
  sharpDirection?: string | null;
  rlmDetected?: boolean;
  // Bet rec
  recSignal?: string | null;
  recPlay?: string | null;
  recWhy?: string | null;
  recColor?: string | null;
}

const SPORT_EMOJI: Record<string, string> = { NBA: "🏀", MLB: "⚾", NHL: "🏒", NFL: "🏈" };
const GRADE_COLOR: Record<string, string> = {
  "A+": "#22c55e", A: "#4ade80", "A-": "#86efac",
  "B+": "#fbbf24", B: "#f59e0b", "B-": "#f59e0b",
  "C+": "#fb923c", C: "#f97316", D: "#ef4444", F: "#dc2626",
};

function hex2rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexAlpha(hex: string, a: number): string {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function shareGameCard(data: ShareGameData): Promise<void> {
  const SCALE  = 2;
  const W      = 390;
  const SPORT_EMOJI_STR = SPORT_EMOJI[data.sport] ?? "🏟";

  // ── Calculate dynamic height ──────────────────────────────────────────────
  let estimatedH = 320; // base
  if (data.spreadAwayMoney != null || data.totalOverMoney != null || data.mlAwayMoney != null) estimatedH += 80;
  if (data.recSignal && data.recPlay) estimatedH += 90;

  const canvas = document.createElement("canvas");
  canvas.width  = W * SCALE;
  canvas.height = estimatedH * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  // ── Background gradient ───────────────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, W * 0.6, estimatedH);
  grad.addColorStop(0, "#0f1923");
  grad.addColorStop(0.6, "#13233A");
  grad.addColorStop(1, "#0d1a2a");
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, W, estimatedH, 20);
  ctx.fill();

  // ── Border ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = data.hasSteam ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 0.75, 0.75, W - 1.5, estimatedH - 1.5, 20);
  ctx.stroke();

  let y = 18;

  // ── Brand header ──────────────────────────────────────────────────────────
  // Logo box
  ctx.fillStyle = "#A23B32";
  roundRect(ctx, 18, y, 28, 28, 7);
  ctx.fill();
  ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#F6F1E7";
  ctx.textAlign = "center";
  ctx.fillText(SPORT_EMOJI_STR, 32, y + 19);

  ctx.textAlign = "left";
  ctx.font = "bold 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#F6F1E7";
  ctx.fillText("Clubhouse IQ", 54, y + 18);

  ctx.textAlign = "right";
  ctx.font = "600 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillText("Line Movement", W - 18, y + 18);

  y += 46;

  // ── Matchup box ───────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, 14, y, W - 28, 68, 12);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#F6F1E7";
  ctx.fillText(`${data.awayTeam}`, 26, y + 22);

  ctx.font = "normal 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  const awayW = ctx.measureText(data.awayTeam).width;
  // adjust for bold vs normal
  ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const aw2 = ctx.measureText(data.awayTeam).width;
  ctx.font = "normal 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(" @ ", 26 + aw2, y + 22);
  const atW = ctx.measureText(" @ ").width;
  ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#F6F1E7";
  ctx.fillText(data.homeTeam, 26 + aw2 + atW, y + 22);

  if (data.gameTime) {
    const t = new Date(data.gameTime).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
    }) + " CT";
    ctx.font = "500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(t, 26, y + 40);
  }

  // Badges row
  let bx = 26;
  const by = y + 54;
  const drawBadge = (text: string, bg: string, fg: string, border: string) => {
    ctx.font = "700 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const tw = ctx.measureText(text).width;
    const bw = tw + 14;
    const bh = 16;
    ctx.fillStyle = bg;
    roundRect(ctx, bx, by - 11, bw, bh, 4);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 0.75;
    roundRect(ctx, bx, by - 11, bw, bh, 4);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.fillText(text, bx + bw / 2, by);
    ctx.textAlign = "left";
    bx += bw + 6;
  };

  if (data.hasSteam) drawBadge("🔥 STEAM", "rgba(248,113,113,0.2)", "#fca5a5", "rgba(248,113,113,0.4)");
  else if (data.hasMoved) drawBadge("⚡ MOVED", "rgba(245,158,11,0.2)", "#fbbf24", "rgba(245,158,11,0.4)");
  if (data.ciqGrade) {
    const gc = GRADE_COLOR[data.ciqGrade] ?? "#a78bfa";
    drawBadge(`🧠 CIQ ${data.ciqGrade}${data.ciqPickTeam ? ` · ${data.ciqPickTeam}` : ""}`, hexAlpha(gc, 0.15), gc, hexAlpha(gc, 0.5));
  }
  if (data.rlmDetected) drawBadge("RLM", "rgba(217,119,6,0.2)", "#fbbf24", "rgba(217,119,6,0.4)");
  if (data.sharpScore && data.sharpScore >= 40 && data.sharpDirection && data.sharpDirection !== "neutral") {
    const sc = data.sharpScore >= 70 ? "#22c55e" : "#fbbf24";
    drawBadge(`SHARP → ${data.sharpDirection.toUpperCase()}`, hexAlpha(sc, 0.15), sc, hexAlpha(sc, 0.4));
  }

  y += 80;

  // ── Divider label ────────────────────────────────────────────────────────
  const sectionLabel = (label: string) => {
    ctx.font = "700 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase(), 18, y);
    y += 10;
  };

  const dataRow = (label: string, value: string, sub: string | null, valColor: string) => {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(14, y - 1, W - 28, 0.5);

    ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase(), 18, y + 12);

    ctx.font = "700 13px 'Courier New', monospace";
    ctx.fillStyle = valColor;
    ctx.textAlign = "right";
    ctx.fillText(value, W - 18, y + 12);

    if (sub) {
      ctx.font = "500 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(sub, W - 18 - ctx.measureText(value).width - 8, y + 12);
    }
    y += 24;
  };

  sectionLabel("Lines");
  dataRow(
    data.sport === "MLB" ? "Run Line" : "Spread",
    data.spread ?? "—",
    data.spreadMove ? `was: ${data.spreadMove}` : null,
    data.hasSteam ? "#fca5a5" : "#F6F1E7"
  );
  dataRow("Total (O/U)", data.total ? `O/U ${data.total}` : "—",
    data.totalMove ? `moved ${data.totalMove}` : null,
    (data.totalMove && Math.abs(parseFloat(data.totalMove)) >= 3) ? "#fca5a5" : "#F6F1E7"
  );
  dataRow(`${data.awayTeam.split(" ").pop()} ML`, data.mlAway ?? "—",
    data.mlAwayMove ? `opened: ${data.mlAwayMove}` : null,
    (data.mlAwayMove && Math.abs(parseFloat(data.mlAwayMove)) >= 50) ? "#fca5a5" : "#F6F1E7"
  );
  dataRow(`${data.homeTeam.split(" ").pop()} ML`, data.mlHome ?? "—",
    data.mlHomeMove ? `opened: ${data.mlHomeMove}` : null,
    (data.mlHomeMove && Math.abs(parseFloat(data.mlHomeMove)) >= 50) ? "#fca5a5" : "#F6F1E7"
  );
  y += 4;

  // ── Public money (if any) ────────────────────────────────────────────────
  const hasPublic = data.spreadAwayMoney != null || data.totalOverMoney != null || data.mlAwayMoney != null;
  if (hasPublic) {
    sectionLabel("Public Money %");
    if (data.spreadAwayMoney != null)
      dataRow(`Spread — ${data.awayTeam.split(" ").pop()}`, `${data.spreadAwayMoney}% $`,
        data.spreadAwayPublic != null ? `${data.spreadAwayPublic}% bets` : null, "#F6F1E7");
    if (data.totalOverMoney != null)
      dataRow("Total — Over", `${data.totalOverMoney}% $`,
        data.totalOverPublic != null ? `${data.totalOverPublic}% bets` : null, "#F6F1E7");
    if (data.mlAwayMoney != null)
      dataRow(`ML — ${data.awayTeam.split(" ").pop()}`, `${data.mlAwayMoney}% $`,
        data.mlAwayPublic != null ? `${data.mlAwayPublic}% bets` : null, "#F6F1E7");
    y += 4;
  }

  // ── Bet rec box (if any) ─────────────────────────────────────────────────
  if (data.recSignal && data.recPlay) {
    const color = data.recColor ?? "#a78bfa";
    const [r, g, b] = hex2rgb(color);
    ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
    ctx.lineWidth = 1;
    roundRect(ctx, 14, y, W - 28, 80, 10);
    ctx.fill();
    ctx.stroke();

    ctx.font = "800 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(data.recSignal.toUpperCase(), 24, y + 16);

    ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "#F6F1E7";
    ctx.fillText(data.recPlay, 24, y + 32);

    if (data.recWhy) {
      ctx.font = "500 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      const lines = wrapText(ctx, data.recWhy, W - 56);
      lines.slice(0, 3).forEach((line, i) => ctx.fillText(line, 24, y + 48 + i * 14));
    }
    y += 92;
  }

  y += 12;

  // ── Crop canvas to actual content height ─────────────────────────────────
  const finalH = Math.min(y, estimatedH);
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width  = W * SCALE;
  finalCanvas.height = finalH * SCALE;
  const fCtx = finalCanvas.getContext("2d")!;
  fCtx.drawImage(canvas, 0, 0);

  // ── Footer ────────────────────────────────────────────────────────────────
  fCtx.scale(SCALE, SCALE);
  fCtx.strokeStyle = "rgba(255,255,255,0.08)";
  fCtx.lineWidth = 1;
  fCtx.beginPath();
  fCtx.moveTo(14, finalH - 20);
  fCtx.lineTo(W - 14, finalH - 20);
  fCtx.stroke();

  fCtx.font = "600 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  fCtx.fillStyle = "rgba(255,255,255,0.3)";
  fCtx.textAlign = "left";
  fCtx.fillText("clubhouse-iq.up.railway.app", 18, finalH - 8);
  fCtx.textAlign = "right";
  fCtx.fillText(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), W - 18, finalH - 8);

  // ── Share ────────────────────────────────────────────────────────────────
  const filename = `${data.awayTeam.replace(/\s+/g, "-")}-at-${data.homeTeam.replace(/\s+/g, "-")}.png`;

  const blob = await new Promise<Blob | null>(res => finalCanvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Canvas blob failed");

  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: `${data.awayTeam} @ ${data.homeTeam} — Line Movement`,
      text: `Line movement data for ${data.awayTeam} @ ${data.homeTeam} via Clubhouse IQ`,
    });
  } else {
    // Desktop fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}

// ── roundRect polyfill ───────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
