/**
 * shareGameCard — draws a Clubhouse IQ sharp money card onto a canvas and shows it
 * in a full-screen overlay. On iPhone: long-press the image to save to Photos.
 * No html2canvas, no download prompts, no cross-origin issues.
 */

export interface ShareGameData {
  sport: string;
  awayTeam: string;
  homeTeam: string;
  gameTime: string | null;
  // Lines
  spread: string | null;
  total: string | null;
  mlAway: string | null;
  mlHome: string | null;
  // Sharp vs Public % (all 0–100)
  spreadAwayTicket?: number | null;
  spreadAwayMoney?: number | null;
  spreadHomeTicket?: number | null;
  spreadHomeMoney?: number | null;
  totalOverTicket?: number | null;
  totalOverMoney?: number | null;
  totalUnderTicket?: number | null;
  totalUnderMoney?: number | null;
  mlAwayTicket?: number | null;
  mlAwayMoney?: number | null;
  mlHomeTicket?: number | null;
  mlHomeMoney?: number | null;
  // Signals
  hasSteam?: boolean;
  sharpScore?: number | null;
  sharpDirection?: string | null;
  rlmDetected?: boolean;
  rlmDescription?: string | null;
  isSynthetic?: boolean;
  // CIQ grade (optional)
  ciqGrade?: string | null;
  ciqPickTeam?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SPORT_EMOJI: Record<string, string> = { NBA: "🏀", MLB: "⚾", NHL: "🏒", NFL: "🏈" };
const GRADE_COLOR: Record<string, string> = {
  "A+": "#22c55e", A: "#4ade80", "A-": "#86efac",
  "B+": "#fbbf24", B: "#f59e0b", "B-": "#f59e0b",
  "C+": "#fb923c", C: "#f97316", D: "#ef4444", F: "#dc2626",
};

const NAV  = "#13233A";
const CREAM = "#F6F1E7";
const FG    = "#131A24";
const MUTED = "#3D4B58";
const BORDER_COLOR = "#D6CFC2";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const RED   = "#dc2626";

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// Pick text color + word for a money% value
function moneyLabel(pct: number, isSharp: boolean): { word: string; color: string } {
  if (isSharp || pct > 55)  return { word: "Sharp ↑", color: GREEN };
  if (pct < 45)              return { word: "Fade ↓",  color: RED };
  return                            { word: "Even —",  color: MUTED };
}

// Interpolate gold→green for sharp bars, blue→purple for public
function sharpBarColor(pct: number): string {
  // gold #d97706 → green #16a34a
  const t = Math.min(1, Math.max(0, pct / 100));
  const r = Math.round(217 + (22  - 217) * t);
  const g = Math.round(119 + (163 - 119) * t);
  const b = Math.round(6   + (74  - 6)   * t);
  return `rgb(${r},${g},${b})`;
}
function publicBarColor(pct: number): string {
  // blue #3b82f6 → purple #7c3aed
  const t = Math.min(1, Math.max(0, pct / 100));
  const r = Math.round(59  + (124 - 59)  * t);
  const g = Math.round(130 + (58  - 130) * t);
  const b = Math.round(246 + (237 - 246) * t);
  return `rgb(${r},${g},${b})`;
}

// ── Draw a two-bar block (ticket + money) ────────────────────────────────────
function drawBarBlock(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, blockW: number,
  label: string,
  ticketPct: number,
  moneyPct: number,
  isSharp: boolean,
  scale: number,
): number {
  const lh = { word: moneyLabel(moneyPct, isSharp).word, color: moneyLabel(moneyPct, isSharp).color };
  const barH = 7;
  const barTrackColor = "#E5E0D6";

  // Label row
  ctx.font = `500 ${11 * scale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.fillText(label, x, y + 11 * scale);

  ctx.font = `700 ${11 * scale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = lh.color;
  ctx.textAlign = "right";
  ctx.fillText(`${lh.word} ${moneyPct.toFixed(0)}% $`, x + blockW, y + 11 * scale);
  ctx.textAlign = "left";

  y += 16 * scale;

  // Person bar (public tickets)
  const personColor = publicBarColor(ticketPct);
  const filledW1 = (ticketPct / 100) * blockW;
  ctx.fillStyle = barTrackColor;
  roundRect(ctx, x, y, blockW, barH * scale, 99);
  ctx.fill();
  ctx.fillStyle = personColor;
  roundRect(ctx, x, y, Math.max(4, filledW1), barH * scale, 99);
  ctx.fill();
  // Label
  ctx.font = `600 ${9 * scale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = personColor;
  ctx.textAlign = "right";
  ctx.fillText(`${ticketPct.toFixed(0)}% bets`, x + blockW, y + barH * scale + 9 * scale);
  ctx.textAlign = "left";

  y += (barH + 12) * scale;

  // Dollar bar (sharp money)
  const dollarColor = sharpBarColor(moneyPct);
  const filledW2 = (moneyPct / 100) * blockW;
  ctx.fillStyle = barTrackColor;
  roundRect(ctx, x, y, blockW, barH * scale, 99);
  ctx.fill();
  ctx.fillStyle = dollarColor;
  roundRect(ctx, x, y, Math.max(4, filledW2), barH * scale, 99);
  ctx.fill();
  ctx.font = `600 ${9 * scale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = dollarColor;
  ctx.textAlign = "right";
  ctx.fillText(`${moneyPct.toFixed(0)}% $`, x + blockW, y + barH * scale + 9 * scale);
  ctx.textAlign = "left";

  return y + (barH + 14) * scale;
}

// ── Draw section header ───────────────────────────────────────────────────────
function drawSectionHeader(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, title: string, scale: number): number {
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  y += 8 * scale;
  ctx.font = `800 ${11 * scale}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.fillText(title, x, y + 11 * scale);
  return y + 20 * scale;
}

// ── Main render function ──────────────────────────────────────────────────────
function renderCard(data: ShareGameData): HTMLCanvasElement {
  const SCALE = 2;
  const W = 390;
  const PAD = 16;
  const INNER = W - PAD * 2;

  // Pre-calculate height
  let h = 56  // brand header
    + 72      // matchup box
    + 20;     // spacing

  const hasSec = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null;

  const hasSpread = hasSec(data.spreadAwayTicket, data.spreadAwayMoney);
  const hasTotal  = hasSec(data.totalOverTicket,  data.totalOverMoney);
  const hasML     = hasSec(data.mlAwayTicket,     data.mlAwayMoney);

  if (hasSpread) h += 32 + 52 * 2 + 20;  // header + 2 rows + gap
  if (hasTotal)  h += 32 + 52 * 2 + 20;
  if (hasML)     h += 32 + 52 * 2 + 20;
  if (data.rlmDetected && data.rlmDescription) h += 56;
  h += 32; // footer

  const canvas = document.createElement("canvas");
  canvas.width  = W * SCALE;
  canvas.height = h * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  // ── Background (cream, like the app) ──────────────────────────────────────
  ctx.fillStyle = CREAM;
  roundRect(ctx, 0, 0, W, h, 18);
  ctx.fill();

  // ── Border ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, h - 1, 18);
  ctx.stroke();

  let y = PAD;

  // ── Brand header ──────────────────────────────────────────────────────────
  // Logo
  ctx.fillStyle = "#A23B32";
  roundRect(ctx, PAD, y, 26, 26, 7);
  ctx.fill();
  ctx.font = `bold 13px sans-serif`;
  ctx.fillStyle = CREAM;
  ctx.textAlign = "center";
  ctx.fillText(SPORT_EMOJI[data.sport] ?? "🏟", PAD + 13, y + 18);
  ctx.textAlign = "left";

  ctx.font = `900 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = FG;
  ctx.fillText("Clubhouse", PAD + 34, y + 12);
  ctx.fillStyle = "#A23B32";
  ctx.fillText(" IQ", PAD + 34 + ctx.measureText("Clubhouse").width, y + 12);

  ctx.font = `600 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = MUTED;
  ctx.fillText("Sharp Money Panel", PAD + 34, y + 25);

  // Sharp score badge
  const sc = data.sharpScore ?? 0;
  if (sc >= 40) {
    const scColor = sc >= 70 ? GREEN : AMBER;
    const badgeLabel = `${sc >= 70 ? "SHARP" : "LEAN"} ${sc}`;
    ctx.font = `800 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    const bw = ctx.measureText(badgeLabel).width + 16;
    ctx.fillStyle = scColor + "22";
    roundRect(ctx, W - PAD - bw, y + 4, bw, 18, 9);
    ctx.fill();
    ctx.strokeStyle = scColor + "55";
    ctx.lineWidth = 0.75;
    roundRect(ctx, W - PAD - bw, y + 4, bw, 18, 9);
    ctx.stroke();
    ctx.fillStyle = scColor;
    ctx.textAlign = "center";
    ctx.fillText(badgeLabel, W - PAD - bw / 2, y + 16);
    ctx.textAlign = "left";
  }

  y += 38;

  // ── Matchup box ───────────────────────────────────────────────────────────
  ctx.fillStyle = NAV;
  roundRect(ctx, PAD, y, INNER, 64, 12);
  ctx.fill();

  ctx.font = `900 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = CREAM;
  ctx.fillText(data.awayTeam, PAD + 12, y + 20);

  ctx.font = `400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  const aw = (() => { ctx.font = `900 15px -apple-system`; return ctx.measureText(data.awayTeam).width; })();
  ctx.font = `400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillText(" @ ", PAD + 12 + aw, y + 20);
  const atw = ctx.measureText(" @ ").width;
  ctx.font = `900 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = CREAM;
  ctx.fillText(data.homeTeam, PAD + 12 + aw + atw, y + 20);

  if (data.gameTime) {
    const t = new Date(data.gameTime).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
    }) + " CT";
    ctx.font = `500 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(t, PAD + 12, y + 36);
  }

  // Lines inline
  const lineStr = [
    data.spread ? `Spread ${data.spread}` : null,
    data.total  ? `O/U ${data.total}` : null,
    (data.mlAway && data.mlHome) ? `ML ${data.mlAway} / ${data.mlHome}` : null,
  ].filter(Boolean).join("   ·   ");

  ctx.font = `600 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(lineStr, PAD + 12, y + 52);

  // Badges
  let bx = W - PAD - 12;
  const drawBadgeRight = (text: string, color: string) => {
    ctx.font = `700 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 10;
    bx -= bw;
    ctx.fillStyle = color + "33";
    roundRect(ctx, bx, y + 8, bw, 16, 4);
    ctx.fill();
    ctx.strokeStyle = color + "66";
    ctx.lineWidth = 0.75;
    roundRect(ctx, bx, y + 8, bw, 16, 4);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(text, bx + bw / 2, y + 19);
    ctx.textAlign = "left";
    bx -= 5;
  };

  if (data.rlmDetected) drawBadgeRight("RLM", AMBER);
  if (data.hasSteam) drawBadgeRight("🔥 STEAM", "#ef4444");
  if (data.sharpDirection && data.sharpDirection !== "neutral") {
    drawBadgeRight(`→ ${data.sharpDirection.toUpperCase()}`, GREEN);
  }

  y += 76;

  // ── Spread section ───────────────────────────────────────────────────────
  if (hasSpread) {
    y = drawSectionHeader(ctx, PAD, y, INNER,
      `SPREAD${data.spread ? ` (${data.spread})` : ""}`, 1);
    y = drawBarBlock(ctx, PAD, y, INNER, data.awayTeam, data.spreadAwayTicket!, data.spreadAwayMoney!, data.sharpDirection === "away", 1);
    y = drawBarBlock(ctx, PAD, y, INNER, data.homeTeam, data.spreadHomeTicket!, data.spreadHomeMoney!, data.sharpDirection === "home", 1);
    y += 8;
  }

  // ── Total section ────────────────────────────────────────────────────────
  if (hasTotal) {
    y = drawSectionHeader(ctx, PAD, y, INNER,
      `TOTAL${data.total ? ` (O/U ${data.total})` : ""}`, 1);
    y = drawBarBlock(ctx, PAD, y, INNER, "Over",  data.totalOverTicket!,   data.totalOverMoney!,   data.sharpDirection === "over",  1);
    y = drawBarBlock(ctx, PAD, y, INNER, "Under", data.totalUnderTicket!,  data.totalUnderMoney!,  data.sharpDirection === "under", 1);
    y += 8;
  }

  // ── ML section ──────────────────────────────────────────────────────────
  if (hasML) {
    y = drawSectionHeader(ctx, PAD, y, INNER, "MONEYLINE", 1);
    y = drawBarBlock(ctx, PAD, y, INNER,
      `${data.awayTeam}${data.mlAway ? ` (${data.mlAway})` : ""}`,
      data.mlAwayTicket!, data.mlAwayMoney!, data.sharpDirection === "away", 1);
    y = drawBarBlock(ctx, PAD, y, INNER,
      `${data.homeTeam}${data.mlHome ? ` (${data.mlHome})` : ""}`,
      data.mlHomeTicket!, data.mlHomeMoney!, data.sharpDirection === "home", 1);
    y += 8;
  }

  // ── RLM alert ────────────────────────────────────────────────────────────
  if (data.rlmDetected && data.rlmDescription) {
    ctx.fillStyle = AMBER + "18";
    roundRect(ctx, PAD, y, INNER, 44, 8);
    ctx.fill();
    ctx.strokeStyle = AMBER + "44";
    ctx.lineWidth = 0.75;
    roundRect(ctx, PAD, y, INNER, 44, 8);
    ctx.stroke();
    ctx.font = `700 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillStyle = AMBER;
    ctx.fillText("⚡ Reverse Line Movement", PAD + 10, y + 14);
    ctx.font = `500 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillStyle = FG;
    // truncate if too long
    const rlmText = data.rlmDescription.length > 80 ? data.rlmDescription.slice(0, 80) + "…" : data.rlmDescription;
    ctx.fillText(rlmText, PAD + 10, y + 30);
    y += 52;
  }

  // ── Synthetic notice ─────────────────────────────────────────────────────
  if (data.isSynthetic) {
    ctx.font = `500 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillStyle = AMBER;
    ctx.textAlign = "center";
    ctx.fillText("* Some % are model-estimated (est.)", W / 2, y + 12);
    ctx.textAlign = "left";
    y += 20;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(PAD, h - 22);
  ctx.lineTo(W - PAD, h - 22);
  ctx.stroke();

  ctx.font = `600 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.fillText("clubhouse-iq.up.railway.app", PAD, h - 10);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), W - PAD, h - 10);

  return canvas;
}

// ── Show modal overlay ────────────────────────────────────────────────────────
function showShareOverlay(canvas: HTMLCanvasElement, title: string) {
  // Remove any existing overlay
  document.getElementById("ciq-share-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "ciq-share-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.82); backdrop-filter: blur(6px);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 20px;
    animation: ciqFadeIn 0.18s ease;
  `;

  // Inject keyframe once
  if (!document.getElementById("ciq-share-style")) {
    const style = document.createElement("style");
    style.id = "ciq-share-style";
    style.textContent = `
      @keyframes ciqFadeIn { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }
      #ciq-share-overlay img { border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); max-width: 100%; max-height: 80vh; object-fit: contain; display: block; }
    `;
    document.head.appendChild(style);
  }

  // Header bar
  const header = document.createElement("div");
  header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; max-width: 390px; margin-bottom: 12px;
  `;
  const titleEl = document.createElement("p");
  titleEl.textContent = title;
  titleEl.style.cssText = `color: #F6F1E7; font-size: 13px; font-weight: 700; margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: -apple-system, sans-serif;`;

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = `
    background: rgba(255,255,255,0.12); border: none; color: #F6F1E7;
    width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
    font-size: 14px; font-weight: 700; flex-shrink: 0; margin-left: 10px;
    display: flex; align-items: center; justify-content: center;
  `;
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Image — data URL so iOS can long-press to save
  const img = document.createElement("img");
  img.src = canvas.toDataURL("image/png");
  img.alt = title;
  img.style.cssText = `border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); max-width: 100%; max-height: 72vh; object-fit: contain; display: block;`;

  // Hint text
  const hint = document.createElement("p");
  hint.style.cssText = `color: rgba(255,255,255,0.45); font-size: 11px; margin-top: 12px; text-align: center; font-family: -apple-system, sans-serif;`;

  // Detect iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  hint.textContent = isIOS
    ? "Long-press the image to save to Photos"
    : "Right-click the image to save, or use the Share button below";

  overlay.appendChild(header);
  overlay.appendChild(img);
  overlay.appendChild(hint);

  // Share button for non-iOS (or any device that supports it)
  if (navigator.share || navigator.canShare) {
    const shareBtn = document.createElement("button");
    shareBtn.textContent = "⬆ Share";
    shareBtn.style.cssText = `
      margin-top: 14px; padding: 10px 32px; border-radius: 20px;
      background: #A23B32; color: #F6F1E7; border: none; cursor: pointer;
      font-size: 13px; font-weight: 800; font-family: -apple-system, sans-serif;
      letter-spacing: 0.02em;
    `;
    shareBtn.onclick = async () => {
      try {
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
        if (!blob) return;
        const file = new File([blob], `${title.replace(/\s+/g, "-")}.png`, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title, text: `${title} via Clubhouse IQ` });
        } else if (navigator.share) {
          await navigator.share({ title, text: `${title} via Clubhouse IQ`, url: "https://clubhouse-iq.up.railway.app" });
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") console.error("[Share]", e);
      }
    };
    overlay.appendChild(shareBtn);
  }

  // Tap outside to close
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function shareGameCard(data: ShareGameData): Promise<void> {
  const canvas = renderCard(data);
  const title = `${data.awayTeam} @ ${data.homeTeam}`;
  showShareOverlay(canvas, title);
}
