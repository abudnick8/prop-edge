/**
 * PropEdge — March Madness 2026 Bracket PDF Generator
 * Classic NCAA bracket tree format:
 *   Left half:  EAST (top-left)  + SOUTH (bottom-left)  — rounds flow LEFT → RIGHT toward center
 *   Right half: WEST (top-right) + MIDWEST (bottom-right) — rounds flow RIGHT → LEFT toward center
 *   Center column: Final Four + Championship
 *
 * Seed order per region (top → bottom in R1):
 *   1, 16, 8, 9, 5, 12, 4, 13,  |  6, 11, 3, 14, 7, 10, 2, 15
 */

import jsPDF from "jspdf";
import { FullBracket } from "./bracketEngine";
import { NCAATeam } from "../data/bracketData";

// ── Color palette ──────────────────────────────────────────────────────────
const C = {
  bg:       [10,  12,  20]  as [number,number,number],
  card:     [18,  22,  36]  as [number,number,number],
  border:   [38,  45,  65]  as [number,number,number],
  gold:     [245,158,  11]  as [number,number,number],
  white:    [255,255,255]  as [number,number,number],
  muted:    [120,130,155]  as [number,number,number],
  green:    [ 16,185,129]  as [number,number,number],
  red:      [239, 68, 68]  as [number,number,number],
  yellow:   [234,179,  8]  as [number,number,number],
  purple:   [168, 85,247]  as [number,number,number],
  dimGold:  [ 60, 40,  5]  as [number,number,number],
};
type RGB = [number,number,number];

// ── PDF helpers ────────────────────────────────────────────────────────────
function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]); }
function setStroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }
function setTextColor(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]); }

function roundedRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fill?: RGB, stroke?: RGB, lw = 0.2) {
  doc.setLineWidth(lw);
  if (fill) setFill(doc, fill);
  if (stroke) setStroke(doc, stroke);
  doc.roundedRect(x, y, w, h, r, r, fill && stroke ? "FD" : fill ? "F" : "S");
}

function txt(doc: jsPDF, str: string, x: number, y: number, color: RGB, size: number, bold = false, align: "left"|"center"|"right" = "left") {
  setTextColor(doc, color);
  doc.setFontSize(size);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.text(str, x, y, { align });
}

function trunc(s: string, max: number) { return s.length > max ? s.slice(0, max - 1) + "…" : s; }

function toImplied(ml: number) {
  if (ml > 0) return Math.round(100 / (ml + 100) * 100);
  return Math.round(Math.abs(ml) / (Math.abs(ml) + 100) * 100);
}

// ── Team slot (one row in the bracket) ────────────────────────────────────
// Returns the vertical center of the slot
function drawTeamSlot(
  doc: jsPDF,
  x: number, y: number, w: number, slotH: number,
  team: NCAATeam,
  isWinner: boolean,
  winPct?: number,
  upsetAlert?: boolean
): number {
  const bg: RGB  = isWinner ? [24, 32, 52] : [13, 17, 28];
  const bdr: RGB = isWinner ? C.gold       : C.border;
  const lw       = isWinner ? 0.35         : 0.15;

  roundedRect(doc, x, y, w, slotH, 1.2, bg, bdr, lw);

  // Seed badge
  const bw = 8;
  roundedRect(doc, x + 1.2, y + 1.2, bw, slotH - 2.4, 0.8, isWinner ? C.gold : C.border);
  txt(doc, String(team.seed), x + 1.2 + bw / 2, y + slotH / 2 + 1.3, isWinner ? C.bg : C.muted, 4.5, true, "center");

  // Name
  const nameX = x + bw + 3.5;
  const maxW   = winPct !== undefined ? w - bw - 14 : w - bw - 5;
  txt(doc, trunc(team.shortName, Math.floor(maxW / 2.2)), nameX, y + slotH / 2 + 1.3, isWinner ? C.white : C.muted, 4.5, isWinner);

  // Win %
  if (winPct !== undefined) {
    txt(doc, `${Math.round(winPct * 100)}%`, x + w - 2, y + slotH / 2 + 1.3, isWinner ? C.gold : C.muted, 3.8, false, "right");
  }

  // Upset badge
  if (upsetAlert && isWinner) {
    roundedRect(doc, x + w - 14, y + 1.2, 11, slotH - 2.4, 1, C.dimGold);
    txt(doc, "UPSET", x + w - 8.5, y + slotH / 2 + 1.2, C.yellow, 3.2, true, "center");
  }

  return y + slotH / 2; // vertical center
}

// ── Build a flat list of teams in R1 order for a region ───────────────────
// Order: [1,16,8,9,5,12,4,13,6,11,3,14,7,10,2,15] top→bottom
function getR1Teams(regionData: import("./bracketEngine").GeneratedBracket): NCAATeam[] {
  const r1 = regionData.rounds[0]; // Round of 64
  // Each matchup has winner + loser. We need the original seed-ordered pairs.
  // The matchups are stored in seed order: [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]]
  // Within each matchup, winner is on top (index 0), loser is below (index 1).
  // We want: top half = matchups 0-3, bottom half = matchups 4-7
  // Flatten: for each matchup, emit [winner, loser] (winner first = higher-ranked display pos)
  const teams: NCAATeam[] = [];
  for (const m of r1.matchups) {
    // Put the LOWER seed (better team) first visually
    const top    = m.winner.seed < m.loser.seed ? m.winner : m.loser;
    const bottom = m.winner.seed < m.loser.seed ? m.loser  : m.winner;
    teams.push(top, bottom);
  }
  return teams;
}

// ── Classic bracket region renderer ───────────────────────────────────────
// Draws a 4-round region starting at (startX, startY) with total size (totalW × totalH).
// flip=true  → R1 on the RIGHT, E8 on the LEFT (right-side regions: West, Midwest)
// flip=false → R1 on the LEFT,  E8 on the RIGHT (left-side regions: East, South)
//
// Returns an array of [centerY] values for each round's single Elite-Eight winner slot
// (used to draw the connector to Final Four).
function drawRegion(
  doc: jsPDF,
  regionData: import("./bracketEngine").GeneratedBracket,
  startX: number, startY: number, totalW: number, totalH: number,
  flip: boolean,
  regionLabel: string,
  labelColor: RGB
): number /* E8 winner center Y */ {

  const rounds = regionData.rounds; // [R64, R32, S16, E8]
  const NUM_ROUNDS = 4;

  // ── Column widths (fractions of totalW) ──────────────────────────────────
  // R1 gets more width (16 teams to show), later rounds get less
  const colFracs = flip
    ? [0.19, 0.19, 0.22, 0.40]   // right-side: R1=rightmost, col[0]=E8 (leftmost)
    : [0.40, 0.22, 0.19, 0.19];  // left-side:  R1=leftmost,  col[0]=R1
  const colWidths = colFracs.map(f => totalW * f);

  // Compute column X positions
  let colX: number[] = new Array(NUM_ROUNDS);
  if (!flip) {
    colX[0] = startX;
    for (let i = 1; i < NUM_ROUNDS; i++) colX[i] = colX[i - 1] + colWidths[i - 1] + 1;
  } else {
    // col[3] = leftmost (E8), col[0] = rightmost (R1)
    colX[3] = startX;
    for (let i = 2; i >= 0; i--) colX[i] = colX[i + 1] + colWidths[i + 1] + 1;
  }

  // Slot heights per round
  const slotH   = 9.5;  // height of one team row
  const gap      = 1.2;  // gap between the two teams in a matchup
  const matchupH = slotH * 2 + gap; // total height for a pair

  const usableH  = totalH - 12; // reserve top for region label
  const topY     = startY + 12;

  // ── Region label banner ───────────────────────────────────────────────────
  roundedRect(doc, startX, startY, totalW, 9, 0, [Math.round(labelColor[0]*0.12), Math.round(labelColor[1]*0.12), Math.round(labelColor[2]*0.12)] as RGB);
  txt(doc, regionLabel, startX + totalW / 2, startY + 6.5, labelColor, 5, true, "center");

  // ── Round column labels ───────────────────────────────────────────────────
  const roundNames = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"];
  for (let r = 0; r < NUM_ROUNDS; r++) {
    // Which data round maps to which column?
    const dataIdx = flip ? (NUM_ROUNDS - 1 - r) : r; // for flip, col0=E8=rounds[3]
    // col r, dataIdx = rounds index
    const cx = colX[r];
    const cw = colWidths[r];
    roundedRect(doc, cx, topY, cw, 5.5, 1, C.card, C.border, 0.15);
    txt(doc, roundNames[flip ? NUM_ROUNDS - 1 - r : r], cx + cw / 2, topY + 4, C.muted, 2.8, false, "center");
  }

  const contentTopY = topY + 7;
  const contentH    = usableH - 7;

  // centerYs[r][m] = vertical center of matchup m in data-round r
  const centerYs: number[][] = [[], [], [], []];

  // ── Draw each round ───────────────────────────────────────────────────────
  for (let dataR = 0; dataR < NUM_ROUNDS; dataR++) {
    const round   = rounds[dataR];
    const colIdx  = flip ? (NUM_ROUNDS - 1 - dataR) : dataR;
    const cx      = colX[colIdx];
    const cw      = colWidths[colIdx];
    const mc      = round.matchups.length; // 8,4,2,1

    const spacing = contentH / mc;
    const slotW   = cw - 2; // leave tiny margin

    if (dataR === 0) {
      // ── R1: Draw all 16 teams as individual pairs ──────────────────────
      const r1Teams = getR1Teams(regionData);
      // 8 matchups, each with 2 rows
      for (let m = 0; m < mc; m++) {
        const t1 = r1Teams[m * 2];     // top team (better seed)
        const t2 = r1Teams[m * 2 + 1]; // bottom team
        const matchup = round.matchups[m];

        const centY = contentTopY + spacing * m + spacing / 2;
        const pairTopY = centY - matchupH / 2;

        // Top team slot
        const t1IsWinner = matchup.winner.id === t1.id;
        drawTeamSlot(doc, cx + 1, pairTopY, slotW, slotH, t1, t1IsWinner,
          t1IsWinner ? matchup.winProbability : 1 - matchup.winProbability,
          t1IsWinner ? matchup.upsetAlert : false
        );

        // Bottom team slot
        const t2IsWinner = matchup.winner.id === t2.id;
        drawTeamSlot(doc, cx + 1, pairTopY + slotH + gap, slotW, slotH, t2, t2IsWinner,
          t2IsWinner ? matchup.winProbability : 1 - matchup.winProbability,
          t2IsWinner ? matchup.upsetAlert : false
        );

        centerYs[dataR][m] = centY;
      }
    } else {
      // ── R2-E8: Draw winner + loser for each matchup ───────────────────
      for (let m = 0; m < mc; m++) {
        const matchup = round.matchups[m];
        const centY   = contentTopY + spacing * m + spacing / 2;
        const pairTopY = centY - matchupH / 2;

        drawTeamSlot(doc, cx + 1, pairTopY, slotW, slotH, matchup.winner, true, matchup.winProbability, matchup.upsetAlert);
        drawTeamSlot(doc, cx + 1, pairTopY + slotH + gap, slotW, slotH, matchup.loser, false);

        centerYs[dataR][m] = centY;
      }
    }
  }

  // ── Draw bracket connector lines ──────────────────────────────────────────
  // For each transition R→R+1, connect pairs of matchup centers to the next matchup
  setStroke(doc, C.border);
  doc.setLineWidth(0.25);

  for (let dataR = 0; dataR < NUM_ROUNDS - 1; dataR++) {
    const colIdx     = flip ? (NUM_ROUNDS - 1 - dataR) : dataR;
    const nextColIdx = flip ? (NUM_ROUNDS - 2 - dataR) : dataR + 1;
    const cx         = colX[colIdx];
    const cw         = colWidths[colIdx];
    const nextCx     = colX[nextColIdx];
    const nextCw     = colWidths[nextColIdx];

    const nextMc = rounds[dataR + 1].matchups.length;

    for (let nm = 0; nm < nextMc; nm++) {
      const srcY1 = centerYs[dataR][nm * 2];
      const srcY2 = centerYs[dataR][nm * 2 + 1];
      const dstY  = centerYs[dataR + 1][nm];

      if (srcY1 === undefined || srcY2 === undefined || dstY === undefined) continue;

      setStroke(doc, [50, 58, 80] as RGB);
      doc.setLineWidth(0.2);

      if (!flip) {
        // Lines go right from this column to next
        const connX = cx + cw + 1;
        doc.line(cx + cw - 1, srcY1, connX, srcY1);
        doc.line(cx + cw - 1, srcY2, connX, srcY2);
        doc.line(connX, srcY1, connX, srcY2);
        doc.line(connX, dstY, nextCx + 1, dstY);
      } else {
        // Lines go left from this column to next (which is to the left)
        const connX = cx - 1;
        doc.line(cx + 1, srcY1, connX, srcY1);
        doc.line(cx + 1, srcY2, connX, srcY2);
        doc.line(connX, srcY1, connX, srcY2);
        doc.line(connX, dstY, nextCx + nextCw + 1, dstY);
      }
    }
  }

  // Return the E8 winner's center Y for Final Four connectors
  return centerYs[3][0];
}

// ── Main PDF export ────────────────────────────────────────────────────────
export async function downloadBracketPDF(bracket: FullBracket): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();  // 297mm
  const pageH = doc.internal.pageSize.getHeight(); // 210mm

  // ── PAGE 1: Classic bracket tree ────────────────────────────────────────

  // Background
  setFill(doc, C.bg);
  doc.rect(0, 0, pageW, pageH, "F");

  // Header bar
  roundedRect(doc, 0, 0, pageW, 12, 0, C.card);
  txt(doc, "🏆  PropEdge · March Madness 2026 Bracket", pageW / 2, 8.5, C.gold, 8, true, "center");
  txt(doc, `Champion: ${bracket.champion.name} (+${bracket.champion.championshipOdds.toLocaleString()})`, 4, 8.5, C.gold, 5, true);
  txt(doc, `Generated ${new Date(bracket.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    pageW - 4, 8.5, C.muted, 4.5, false, "right");

  // ── Layout ────────────────────────────────────────────────────────────────
  // Page split:
  //   Left  half: sideW wide  → EAST (top), SOUTH (bottom)
  //   Center:     centerW wide → Final Four + Championship
  //   Right half: sideW wide  → WEST (top), MIDWEST (bottom)
  const centerW = 40;
  const sideW   = (pageW - centerW) / 2;  // ~128.5mm each

  // Vertical split: top 48%, bottom 52% (slight more for bottom)
  const headerH = 12;
  const midY    = headerH + (pageH - headerH) * 0.50;
  const topH    = midY - headerH;
  const botH    = pageH - midY;

  const east    = bracket.regions.find(r => r.region === "East")!;
  const west    = bracket.regions.find(r => r.region === "West")!;
  const south   = bracket.regions.find(r => r.region === "South")!;
  const midwest = bracket.regions.find(r => r.region === "Midwest")!;

  // Draw regions
  const eastE8Y    = drawRegion(doc, east,    0,              headerH, sideW, topH, false, "EAST",    C.gold);
  const westE8Y    = drawRegion(doc, west,    sideW + centerW, headerH, sideW, topH, true,  "WEST",    C.green);
  const southE8Y   = drawRegion(doc, south,   0,              midY,    sideW, botH, false, "SOUTH",   C.red);
  const midwestE8Y = drawRegion(doc, midwest, sideW + centerW, midY,    sideW, botH, true,  "MIDWEST", C.purple);

  // ── Center column: Final Four ─────────────────────────────────────────────
  const cx = sideW;
  const cw = centerW;

  // Vertical divider
  setStroke(doc, C.border);
  doc.setLineWidth(0.3);
  doc.line(cx + cw / 2, headerH + 1, cx + cw / 2, pageH - 4);

  // Final Four label
  roundedRect(doc, cx + 2, headerH + 2, cw - 4, 7, 2, C.card, C.gold, 0.5);
  txt(doc, "FINAL FOUR", cx + cw / 2, headerH + 7.5, C.gold, 5.5, true, "center");

  const sf1 = bracket.finalFour.matchups[0]; // East vs West
  const sf2 = bracket.finalFour.matchups[1]; // Midwest vs South
  const ch  = bracket.championship;

  const sfW  = cw - 6;
  const sfX  = cx + 3;
  const slotH = 9.5;
  const gapH  = 1.2;

  // Championship label + box — positioned in vertical center
  const champLabelY = pageH / 2 - 8;
  roundedRect(doc, cx + 1, champLabelY - 6, cw - 2, 5.5, 1.5, C.card, C.gold, 0.5);
  txt(doc, "CHAMPIONSHIP", cx + cw / 2, champLabelY - 1.8, C.gold, 4, true, "center");

  // Champion box
  const champBoxY = champLabelY;
  roundedRect(doc, sfX - 1, champBoxY, sfW + 2, 22, 2, [28, 20, 4] as RGB, C.gold, 0.6);
  txt(doc, "🏆", sfX + 2, champBoxY + 8, C.gold, 7);
  txt(doc, trunc(ch.winner.name, 14), sfX + 12, champBoxY + 6, C.gold, 5, true);
  txt(doc, `Seed ${ch.winner.seed} · ${ch.winner.region}`, sfX + 12, champBoxY + 11, C.muted, 3.5);
  txt(doc, `${Math.round(ch.winProbability * 100)}% win prob`, sfX + sfW, champBoxY + 15, C.gold, 3.5, true, "right");
  roundedRect(doc, sfX, champBoxY + 13, sfW, 8, 1.5, C.card, C.border, 0.15);
  txt(doc, `Runner-up: ${ch.loser.shortName} (${ch.loser.seed})`, cx + cw / 2, champBoxY + 18.5, C.muted, 3.5, false, "center");

  // SF1 (East vs West) — top half
  const sf1TopY = (headerH + champLabelY - 6) / 2 - (slotH * 2 + gapH) / 2;
  txt(doc, "East vs West", cx + cw / 2, sf1TopY - 2, C.muted, 3, false, "center");
  drawTeamSlot(doc, sfX, sf1TopY, sfW, slotH, sf1.winner, true, sf1.winProbability, sf1.upsetAlert);
  drawTeamSlot(doc, sfX, sf1TopY + slotH + gapH, sfW, slotH, sf1.loser, false);

  // SF2 (Midwest vs South) — bottom half
  const sf2CenterAreaY = (champBoxY + 22 + pageH) / 2;
  const sf2TopY = sf2CenterAreaY - (slotH * 2 + gapH) / 2;
  txt(doc, "Midwest vs South", cx + cw / 2, sf2TopY - 2, C.muted, 3, false, "center");
  drawTeamSlot(doc, sfX, sf2TopY, sfW, slotH, sf2.winner, true, sf2.winProbability, sf2.upsetAlert);
  drawTeamSlot(doc, sfX, sf2TopY + slotH + gapH, sfW, slotH, sf2.loser, false);

  // ── Connector lines: E8 winners → SF → Championship ─────────────────────
  setStroke(doc, [55, 48, 10] as RGB);
  doc.setLineWidth(0.3);

  const sf1WinCenterY = sf1TopY + slotH / 2;
  const sf2WinCenterY = sf2TopY + slotH / 2;
  const champCenterY  = champBoxY + 5;

  // East E8 → SF1 (left side into center)
  doc.line(cx - 1, eastE8Y, cx + 3, eastE8Y);
  doc.line(cx + 3, eastE8Y, cx + 3, sf1WinCenterY);
  doc.line(cx + 3, sf1WinCenterY, sfX, sf1WinCenterY);

  // West E8 → SF1 (right side into center)
  doc.line(cx + cw + 1, westE8Y, cx + cw - 3, westE8Y);
  doc.line(cx + cw - 3, westE8Y, cx + cw - 3, sf1WinCenterY);
  doc.line(cx + cw - 3, sf1WinCenterY, sfX + sfW, sf1WinCenterY);

  // South E8 → SF2
  doc.line(cx - 1, southE8Y, cx + 3, southE8Y);
  doc.line(cx + 3, southE8Y, cx + 3, sf2WinCenterY);
  doc.line(cx + 3, sf2WinCenterY, sfX, sf2WinCenterY);

  // Midwest E8 → SF2
  doc.line(cx + cw + 1, midwestE8Y, cx + cw - 3, midwestE8Y);
  doc.line(cx + cw - 3, midwestE8Y, cx + cw - 3, sf2WinCenterY);
  doc.line(cx + cw - 3, sf2WinCenterY, sfX + sfW, sf2WinCenterY);

  // SF winners → Championship
  doc.line(sfX + sfW / 2, sf1TopY + slotH, sfX + sfW / 2, champBoxY);
  doc.line(sfX + sfW / 2, sf2TopY, sfX + sfW / 2, champBoxY + 22);

  // ── Page footer ───────────────────────────────────────────────────────────
  txt(doc, "Created with Perplexity Computer · prop-edge.up.railway.app  |  Odds from DraftKings · Not financial advice",
    pageW / 2, pageH - 2, C.muted, 2.8, false, "center");

  // ── PAGE 2: Analytics Report ──────────────────────────────────────────────
  doc.addPage();
  setFill(doc, C.bg);
  doc.rect(0, 0, pageW, pageH, "F");
  roundedRect(doc, 0, 0, pageW, 12, 0, C.card);
  txt(doc, "PropEdge — March Madness 2026 Analytics Report", pageW / 2, 8.5, C.gold, 8, true, "center");

  let curY = 18;

  // ── Champion Section ──────────────────────────────────────────────────────
  roundedRect(doc, 4, curY, pageW - 8, 40, 2, C.card, C.gold, 0.4);
  txt(doc, "🏆  PREDICTED CHAMPION", 10, curY + 6, C.gold, 6, true);
  txt(doc, bracket.champion.name, 10, curY + 13, C.white, 9, true);
  txt(doc,
    `${bracket.champion.seed}-seed · ${bracket.champion.region} Region · +${bracket.champion.championshipOdds.toLocaleString()} title odds · ${toImplied(bracket.champion.championshipOdds)}% implied`,
    10, curY + 19, C.muted, 4.5);

  const stats = [
    { label: "Adj. Offense", val: bracket.champion.adjOffRating.toFixed(1) },
    { label: "Adj. Defense", val: bracket.champion.adjDefRating.toFixed(1) },
    { label: "Eff. Margin",  val: `+${bracket.champion.adjEffMargin.toFixed(1)}` },
    { label: "PPG",          val: String(bracket.champion.ppg) },
    { label: "3PT%",         val: `${bracket.champion.fg3Pct}%` },
    { label: "SOS",          val: `${bracket.champion.strengthOfSchedule}/10` },
  ];
  stats.forEach((s, i) => {
    const bx = 10 + i * 47;
    const by = curY + 23;
    roundedRect(doc, bx, by, 43, 11, 1.5, [18, 24, 40] as RGB);
    txt(doc, s.val, bx + 21.5, by + 5.5, C.gold, 6, true, "center");
    txt(doc, s.label, bx + 21.5, by + 9.5, C.muted, 3.2, false, "center");
  });

  const blurb = bracket.champion.analysis.split(". ").slice(0, 2).join(". ") + ".";
  txt(doc, (doc.splitTextToSize(blurb, pageW - 20) as string[])[0] ?? "", 10, curY + 37, C.muted, 3.8);
  curY += 46;

  // ── Final Four ────────────────────────────────────────────────────────────
  txt(doc, "FINAL FOUR", 10, curY + 5, C.gold, 5.5, true);
  doc.setLineWidth(0.2); setStroke(doc, C.gold);
  doc.line(10, curY + 7, pageW - 10, curY + 7);
  curY += 11;

  const ffTeams  = [bracket.finalFour.matchups[0].winner, bracket.finalFour.matchups[0].loser, bracket.finalFour.matchups[1].winner, bracket.finalFour.matchups[1].loser];
  const ffLabels = ["East Winner", "West Winner", "Midwest Winner", "South Winner"];
  ffTeams.forEach((t, i) => {
    const bx = 4 + i * 72;
    roundedRect(doc, bx, curY, 68, 22, 2, C.card, i < 2 ? C.gold : C.green, i < 2 ? 0.4 : 0.3);
    txt(doc, ffLabels[i], bx + 34, curY + 5, C.muted, 3, false, "center");
    txt(doc, t.name, bx + 34, curY + 11, C.white, 4.5, true, "center");
    txt(doc, `${t.seed}-seed · +${t.championshipOdds.toLocaleString()}`, bx + 34, curY + 16, C.gold, 3.5, false, "center");
    txt(doc, `Margin: +${t.adjEffMargin.toFixed(1)} | Form: ${t.recentForm}`, bx + 34, curY + 20.5, C.muted, 3, false, "center");
  });
  curY += 27;

  // ── Upset Picks ───────────────────────────────────────────────────────────
  const upsets = bracket.regions.flatMap(r => r.rounds.flatMap(rd => rd.matchups.filter(m => m.upsetAlert)));
  if (upsets.length > 0) {
    txt(doc, `⚠  PROJECTED UPSETS  (${upsets.length})`, 10, curY + 5, C.yellow, 5.5, true);
    doc.setLineWidth(0.2); setStroke(doc, C.yellow);
    doc.line(10, curY + 7, pageW - 10, curY + 7);
    setStroke(doc, C.border);
    curY += 11;

    upsets.slice(0, 8).forEach((u, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const ux = 4 + col * 145, uy = curY + row * 16;
      roundedRect(doc, ux, uy, 139, 13, 1.5, C.card, [60, 45, 5] as RGB, 0.3);
      roundedRect(doc, ux + 1, uy + 1, 18, 11, 1, C.dimGold);
      txt(doc, "UPSET", ux + 10, uy + 7.5, C.yellow, 4, true, "center");
      txt(doc, `${u.winner.seed}-seed ${u.winner.shortName} over ${u.loser.seed}-seed ${u.loser.shortName}`,
        ux + 22, uy + 5.5, C.white, 4.5, true);
      txt(doc, `${Math.round(u.winProbability * 100)}% win prob · ${u.winner.region} Region · Proj: ${u.projectedScore.winner}-${u.projectedScore.loser}`,
        ux + 22, uy + 10.5, C.muted, 3.5);
    });
    curY += Math.ceil(Math.min(upsets.length, 8) / 2) * 16 + 4;
  }

  // ── Region Winners ────────────────────────────────────────────────────────
  if (curY < pageH - 30) {
    txt(doc, "REGION WINNERS", 10, curY + 5, C.green, 5.5, true);
    doc.setLineWidth(0.2); setStroke(doc, C.green);
    doc.line(10, curY + 7, pageW - 10, curY + 7);
    setStroke(doc, C.border);
    curY += 11;

    bracket.regions.forEach((r, i) => {
      const w = r.regionWinner, bx = 4 + i * 72;
      roundedRect(doc, bx, curY, 68, 16, 1.5, C.card, C.border, 0.15);
      txt(doc, r.region.toUpperCase(), bx + 34, curY + 5, C.gold, 3.5, true, "center");
      txt(doc, w.name, bx + 34, curY + 10, C.white, 4, true, "center");
      txt(doc, `${w.seed}-seed · +${w.championshipOdds.toLocaleString()} · ${w.record}`, bx + 34, curY + 15, C.muted, 3, false, "center");
    });
  }

  // Footer
  const footerY = pageH - 5;
  txt(doc, "Created with Perplexity Computer · perplexity.ai/computer  |  PropEdge · prop-edge.up.railway.app  |  Odds from DraftKings · Not financial advice",
    pageW / 2, footerY, C.muted, 2.8, false, "center");

  doc.setPage(1);
  txt(doc, "Created with Perplexity Computer · prop-edge.up.railway.app",
    pageW / 2, pageH - 2, C.muted, 2.8, false, "center");

  // ── Save ──────────────────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`PropEdge-Bracket-2026-${dateStr}.pdf`);
}
