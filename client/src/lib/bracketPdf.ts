/**
 * PropEdge — March Madness 2026 Bracket PDF Generator
 * Builds a clean bracket PDF entirely in jsPDF (no html2canvas, no DOM capture).
 * Layout: full-page landscape, 4 regional columns + Final Four center.
 */

import jsPDF from "jspdf";
import { FullBracket, MatchupResult } from "./bracketEngine";
import { NCAATeam } from "../data/bracketData";

// ── Color palette ──────────────────────────────────────────────────────────
const C = {
  bg:          [10,  12,  20]  as [number,number,number],
  card:        [18,  22,  36]  as [number,number,number],
  border:      [38,  45,  65]  as [number,number,number],
  gold:        [245,158,  11]  as [number,number,number],
  goldDim:     [120, 76,   5]  as [number,number,number],
  white:       [255,255,255]  as [number,number,number],
  muted:       [120,130,155]  as [number,number,number],
  green:       [ 16,185,129]  as [number,number,number],
  red:         [239, 68, 68]  as [number,number,number],
  yellow:      [234,179,  8]  as [number,number,number],
  purple:      [168, 85,247]  as [number,number,number],
};

type RGB = [number,number,number];

// ── PDF helpers ────────────────────────────────────────────────────────────
function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]); }
function setStroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }
function setTextColor(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]); }
function setFontSize(doc: jsPDF, size: number) { doc.setFontSize(size); }

function roundedRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fill?: RGB, stroke?: RGB) {
  if (fill) setFill(doc, fill);
  if (stroke) setStroke(doc, stroke);
  doc.roundedRect(x, y, w, h, r, r, fill && stroke ? "FD" : fill ? "F" : "S");
}

function text(doc: jsPDF, str: string, x: number, y: number, color: RGB, size: number, bold = false, align: "left"|"center"|"right" = "left") {
  setTextColor(doc, color);
  setFontSize(doc, size);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.text(str, x, y, { align });
}

// Truncate text to fit width
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

// Implied probability from moneyline
function toImplied(ml: number): number {
  if (ml > 0) return Math.round(100 / (ml + 100) * 100);
  return Math.round(Math.abs(ml) / (Math.abs(ml) + 100) * 100);
}

// ── Match slot renderer ────────────────────────────────────────────────────
function drawMatchSlot(
  doc: jsPDF,
  x: number, y: number, w: number,
  team: NCAATeam,
  isWinner: boolean,
  prob?: number,
  upsetAlert?: boolean
) {
  const h = 11;
  const bgColor: RGB = isWinner ? [22, 30, 48] : [14, 18, 30];
  const borderColor: RGB = isWinner ? C.gold : C.border;

  roundedRect(doc, x, y, w, h, 1.5, bgColor, borderColor);
  doc.setLineWidth(isWinner ? 0.4 : 0.2);

  // Seed badge
  const badgeW = 9;
  roundedRect(doc, x + 1.5, y + 1.5, badgeW, h - 3, 1,
    isWinner ? C.gold : C.border);
  text(doc, String(team.seed), x + 1.5 + badgeW/2, y + h/2 + 1.4,
    isWinner ? C.bg : C.muted, 5.5, true, "center");

  // Team name
  const maxNameLen = prob !== undefined ? 14 : 17;
  text(doc, truncate(team.shortName, maxNameLen),
    x + 13, y + h/2 + 1.4,
    isWinner ? C.white : C.muted, 5.5, isWinner);

  // Win probability
  if (prob !== undefined) {
    const pct = `${Math.round(prob * 100)}%`;
    text(doc, pct, x + w - 3, y + h/2 + 1.4,
      isWinner ? C.gold : C.muted, 5, isWinner, "right");
  }

  // Upset badge
  if (upsetAlert && isWinner) {
    roundedRect(doc, x + w - 14, y + 1.5, 10, 4, 1, [60, 40, 0] as RGB);
    text(doc, "UPSET", x + w - 9, y + 4.8, C.yellow, 3.5, true, "center");
  }
}

// ── Draw a single matchup (two slots stacked) ──────────────────────────────
function drawMatchup(
  doc: jsPDF,
  x: number, y: number, w: number,
  result: MatchupResult
): number {
  const { winner, loser, winProbability, upsetAlert } = result;

  // Winner on top
  drawMatchSlot(doc, x, y, w, winner, true, winProbability, upsetAlert);
  // Loser below
  drawMatchSlot(doc, x, y + 12, w, loser, false);

  return y + 25; // return next y position (two slots + gap)
}

// ── Draw connector line between rounds ────────────────────────────────────
function drawConnector(doc: jsPDF, x: number, y1: number, y2: number, toX: number) {
  setStroke(doc, C.border);
  doc.setLineWidth(0.3);
  const midY = (y1 + y2) / 2;
  doc.line(x, y1, x + 4, y1);
  doc.line(x + 4, y1, x + 4, y2);
  doc.line(x + 4, y2, toX, y2);
}

// ── Region column layout ───────────────────────────────────────────────────
// Returns an array of [x, y] midpoint positions per matchup in each round
function drawRegionColumn(
  doc: jsPDF,
  regionData: import("./bracketEngine").GeneratedBracket,
  startX: number,
  columnW: number,
  pageH: number,
  flip: boolean // flip = right-side regions (draw rounds right-to-left)
) {
  const rounds = regionData.rounds;
  const numRounds = rounds.length; // 4 rounds (R64, R32, S16, E8)
  const slotH = 25; // height of one matchup slot pair
  const roundW = Math.floor(columnW / numRounds) - 2;

  // Calculate vertical spacing for each round
  // R1: 8 matchups, R2: 4, R3: 2, R4: 1
  const matchCounts = [8, 4, 2, 1];
  const headerH = 18;
  const usableH = pageH - headerH - 20;

  // Positions of match centers per round (for connector drawing)
  const roundPositions: number[][] = []; // [round][match] = centerY

  for (let r = 0; r < numRounds; r++) {
    const round = rounds[r];
    const matchCount = round.matchups.length;
    const spacing = usableH / matchCount;
    const roundX = flip
      ? startX + columnW - (r + 1) * (roundW + 2)
      : startX + r * (roundW + 2);

    const positions: number[] = [];

    // Round label
    const labelX = roundX + roundW / 2;
    roundedRect(doc, roundX, headerH - 8, roundW, 7, 1.5, C.card, C.border);
    text(doc, round.name, labelX, headerH - 2.5, C.muted, 4, false, "center");

    for (let m = 0; m < matchCount; m++) {
      const matchup = round.matchups[m];
      const centerY = headerH + spacing * m + spacing / 2 - slotH / 2;
      const clampedY = Math.max(headerH + 2, Math.min(centerY, pageH - slotH - 8));

      drawMatchup(doc, roundX, clampedY, roundW, matchup);
      positions.push(clampedY + slotH / 2 - 1);
    }

    roundPositions.push(positions);

    // Draw connectors between this round and next
    if (r < numRounds - 1) {
      const nextRound = rounds[r + 1];
      const nextCount = nextRound.matchups.length;
      const nextSpacing = usableH / nextCount;
      const nextRoundX = flip
        ? startX + columnW - (r + 2) * (roundW + 2)
        : startX + (r + 1) * (roundW + 2);

      for (let m = 0; m < nextCount; m++) {
        const srcY1 = roundPositions[r][m * 2];
        const srcY2 = roundPositions[r][m * 2 + 1];
        const dstY = headerH + nextSpacing * m + nextSpacing / 2 - 1;
        const connX = flip ? nextRoundX + roundW : roundX + roundW;
        const connToX = flip ? nextRoundX + roundW + 4 : nextRoundX - 4;
        // Simple midpoint connector
        setStroke(doc, C.border);
        doc.setLineWidth(0.25);
        if (srcY1 && srcY2) {
          const midY = (srcY1 + srcY2) / 2;
          if (flip) {
            doc.line(nextRoundX + roundW + 2, midY, roundX, midY);
          } else {
            doc.line(roundX + roundW, srcY1, roundX + roundW + 2, srcY1);
            doc.line(roundX + roundW, srcY2, roundX + roundW + 2, srcY2);
            doc.line(roundX + roundW + 2, srcY1, roundX + roundW + 2, srcY2);
            doc.line(roundX + roundW + 2, midY, nextRoundX, midY);
          }
        }
      }
    }
  }

  return roundPositions;
}

// ── Main PDF generator ─────────────────────────────────────────────────────
export async function downloadBracketPDF(bracket: FullBracket): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();   // 297mm
  const pageH = doc.internal.pageSize.getHeight();  // 210mm

  // ── Page 1: Full Bracket Visual ──────────────────────────────────────────

  // Background
  setFill(doc, C.bg);
  doc.rect(0, 0, pageW, pageH, "F");

  // Header bar
  roundedRect(doc, 0, 0, pageW, 14, 0, C.card);
  text(doc, "🏆  PropEdge · March Madness 2026 Bracket", pageW / 2, 9, C.gold, 9, true, "center");
  text(doc, `Generated ${new Date(bracket.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    pageW - 4, 9, C.muted, 5, false, "right");
  text(doc, `Champion: ${bracket.champion.name} (+${bracket.champion.championshipOdds.toLocaleString()})`,
    4, 9, C.gold, 5.5, true);

  // ── Layout: [East 4 rounds] [Final Four center] [West 4 rounds flipped]
  //           [South 4 rounds] [center] [Midwest 4 rounds flipped]
  // Actually: split page into left half (East+Midwest) and right half (West+South)
  // with Final Four in the center column

  const centerW = 44; // Final Four center column
  const sideW = (pageW - centerW) / 2;
  const regionW = sideW / 2;  // each region column

  const east    = bracket.regions.find(r => r.region === "East")!;
  const west    = bracket.regions.find(r => r.region === "West")!;
  const midwest = bracket.regions.find(r => r.region === "Midwest")!;
  const south   = bracket.regions.find(r => r.region === "South")!;

  // Region labels
  const regions = [
    { data: east,    x: 0,                    flip: false, label: "EAST",    color: C.gold   },
    { data: west,    x: sideW + centerW,       flip: true,  label: "WEST",    color: C.green  },
    { data: south,   x: 0,                    flip: false, label: "SOUTH",   color: C.red    },
    { data: midwest, x: sideW + centerW,       flip: true,  label: "MIDWEST", color: C.purple },
  ];

  // We'll do top half (East left, West right) and bottom half (South left, Midwest right)
  // Split page horizontally at the midpoint
  const topH = pageH * 0.48;
  const botY = pageH * 0.52;
  const botH = pageH - botY;

  // Draw region label banners
  const regionBanners = [
    { label: "EAST",    x: 0,              w: sideW,  y: 14 },
    { label: "WEST",    x: sideW+centerW,  w: sideW,  y: 14 },
    { label: "SOUTH",   x: 0,              w: sideW,  y: botY },
    { label: "MIDWEST", x: sideW+centerW,  w: sideW,  y: botY },
  ];
  const bannerColors = [C.gold, C.green, C.red, C.purple];
  regionBanners.forEach(({ label, x, w, y }, i) => {
    const col = bannerColors[i];
    roundedRect(doc, x, y, w, 5, 0, [col[0]*0.12, col[1]*0.12, col[2]*0.12] as RGB);
    text(doc, label, x + w/2, y + 3.8, col, 4.5, true, "center");
  });

  // Helper: draw a simplified single-region bracket in a bounded box
  function drawSimpleRegion(
    regionData: import("./bracketEngine").GeneratedBracket,
    startX: number, startY: number, totalW: number, totalH: number,
    flip: boolean
  ) {
    const rounds = regionData.rounds;
    const slotW = flip
      ? [totalW*0.24, totalW*0.24, totalW*0.26, totalW*0.26]
      : [totalW*0.26, totalW*0.26, totalW*0.24, totalW*0.24];

    let xCursors = [0, 0, 0, 0];
    if (!flip) {
      xCursors[0] = startX;
      xCursors[1] = startX + slotW[0] + 2;
      xCursors[2] = startX + slotW[0] + slotW[1] + 4;
      xCursors[3] = startX + slotW[0] + slotW[1] + slotW[2] + 6;
    } else {
      // Right-side regions: R1 on right, E8 on left (closest to center)
      xCursors[3] = startX;
      xCursors[2] = startX + slotW[3] + 2;
      xCursors[1] = startX + slotW[3] + slotW[2] + 4;
      xCursors[0] = startX + slotW[3] + slotW[2] + slotW[1] + 6;
    }

    const usableH = totalH - 12;

    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r];
      const mc = round.matchups.length;
      const rX = xCursors[r];
      const rW = slotW[r];
      const spacing = usableH / mc;

      // Round label
      const labelY = startY + 5;
      text(doc, round.name, rX + rW/2, labelY, C.muted, 3.2, false, "center");

      for (let m = 0; m < mc; m++) {
        const matchup = round.matchups[m];
        const slotH = 22;
        const topSlot = startY + 8 + spacing * m + (spacing - slotH) / 2;

        // Winner row
        const winnerBg: RGB = [22, 30, 50];
        roundedRect(doc, rX, topSlot, rW, 10, 1, winnerBg, C.border);
        doc.setLineWidth(0.3);
        // Seed
        roundedRect(doc, rX+1, topSlot+1, 7, 8, 1, C.gold);
        text(doc, String(matchup.winner.seed), rX+4.5, topSlot+6, C.bg, 4.5, true, "center");
        text(doc, truncate(matchup.winner.shortName, 10), rX+10, topSlot+6.5, C.white, 4, true);
        const pct = `${Math.round(matchup.winProbability*100)}%`;
        text(doc, pct, rX+rW-2, topSlot+6.5, C.gold, 3.5, false, "right");
        if (matchup.upsetAlert) {
          roundedRect(doc, rX+rW-12, topSlot+2, 9, 3.5, 1, [50,35,0] as RGB);
          text(doc, "UPSET", rX+rW-7.5, topSlot+4.5, C.yellow, 2.8, true, "center");
        }

        // Loser row
        const loserBg: RGB = [14, 18, 30];
        roundedRect(doc, rX, topSlot+11, rW, 10, 1, loserBg, [30,38,55] as RGB);
        doc.setLineWidth(0.15);
        roundedRect(doc, rX+1, topSlot+12, 7, 8, 1, C.border);
        text(doc, String(matchup.loser.seed), rX+4.5, topSlot+17, C.muted, 4.5, false, "center");
        text(doc, truncate(matchup.loser.shortName, 10), rX+10, topSlot+17.5, C.muted, 4, false);

        // Connector to next round
        if (r < rounds.length - 1) {
          const nextMc = rounds[r+1].matchups.length;
          const nextSpacing = usableH / nextMc;
          const nextM = Math.floor(m / 2);
          const nextSlotH = 22;
          const nextTopSlot = startY + 8 + nextSpacing * nextM + (nextSpacing - nextSlotH) / 2;
          const myMid = topSlot + 10.5;
          const nextMid = nextTopSlot + 10.5;

          setStroke(doc, C.border);
          doc.setLineWidth(0.2);

          if (!flip) {
            const connX = rX + rW;
            const nextX = xCursors[r+1];
            doc.line(connX, myMid, connX + 1, myMid);
            // vertical connector for pair
            if (m % 2 === 1 && rounds[r].matchups[m-1]) {
              const prevTopSlot = startY + 8 + spacing * (m-1) + (spacing - slotH) / 2 + 10.5;
              doc.line(connX + 1, prevTopSlot, connX + 1, myMid);
              doc.line(connX + 1, (prevTopSlot + myMid)/2, nextX, (prevTopSlot + myMid)/2);
            }
          } else {
            const connX = rX;
            const nextX = xCursors[r+1] + slotW[r+1];
            doc.line(connX, myMid, connX - 1, myMid);
            if (m % 2 === 1 && rounds[r].matchups[m-1]) {
              const prevTopSlot = startY + 8 + spacing * (m-1) + (spacing - slotH) / 2 + 10.5;
              doc.line(connX - 1, prevTopSlot, connX - 1, myMid);
              doc.line(connX - 1, (prevTopSlot + myMid)/2, nextX, (prevTopSlot + myMid)/2);
            }
          }
        }
      }
    }
  }

  // Draw all 4 regions
  drawSimpleRegion(east,    0,              14,   sideW,  topH - 14,  false);
  drawSimpleRegion(west,    sideW+centerW,  14,   sideW,  topH - 14,  true);
  drawSimpleRegion(south,   0,              botY, sideW,  botH,       false);
  drawSimpleRegion(midwest, sideW+centerW,  botY, sideW,  botH,       true);

  // ── Center column: Final Four ────────────────────────────────────────────
  const cx = sideW;
  const cw = centerW;

  // Center divider line
  setStroke(doc, C.border);
  doc.setLineWidth(0.3);
  doc.line(cx + cw/2, 16, cx + cw/2, pageH - 4);

  // Final Four label
  roundedRect(doc, cx + 2, 18, cw - 4, 6, 2, C.card, C.gold);
  doc.setLineWidth(0.5);
  text(doc, "FINAL FOUR", cx + cw/2, 22.5, C.gold, 5.5, true, "center");

  // SF1: East vs West (top half)
  const sf1 = bracket.finalFour.matchups[0];
  const sf2 = bracket.finalFour.matchups[1];

  const sfY1 = topH * 0.28;
  const sfY2 = botY + botH * 0.18;
  const sfW = cw - 6;
  const sfX = cx + 3;

  // SF1
  text(doc, "East vs West", cx + cw/2, sfY1 - 2, C.muted, 3.5, false, "center");
  roundedRect(doc, sfX, sfY1, sfW, 10, 1.5, [22,30,50] as RGB, C.gold);
  doc.setLineWidth(0.4);
  roundedRect(doc, sfX+1, sfY1+1, 8, 8, 1, C.gold);
  text(doc, String(sf1.winner.seed), sfX+5, sfY1+6, C.bg, 5, true, "center");
  text(doc, truncate(sf1.winner.shortName, 9), sfX+11, sfY1+6.5, C.white, 4.5, true);
  text(doc, `${Math.round(sf1.winProbability*100)}%`, sfX+sfW-2, sfY1+6.5, C.gold, 4, false, "right");

  roundedRect(doc, sfX, sfY1+11, sfW, 10, 1.5, [14,18,30] as RGB, C.border);
  doc.setLineWidth(0.2);
  roundedRect(doc, sfX+1, sfY1+12, 8, 8, 1, C.border);
  text(doc, String(sf1.loser.seed), sfX+5, sfY1+17, C.muted, 5, false, "center");
  text(doc, truncate(sf1.loser.shortName, 9), sfX+11, sfY1+17.5, C.muted, 4.5, false);

  // SF2
  text(doc, "Midwest vs South", cx + cw/2, sfY2 - 2, C.muted, 3.5, false, "center");
  roundedRect(doc, sfX, sfY2, sfW, 10, 1.5, [22,30,50] as RGB, C.gold);
  doc.setLineWidth(0.4);
  roundedRect(doc, sfX+1, sfY2+1, 8, 8, 1, C.gold);
  text(doc, String(sf2.winner.seed), sfX+5, sfY2+6, C.bg, 5, true, "center");
  text(doc, truncate(sf2.winner.shortName, 9), sfX+11, sfY2+6.5, C.white, 4.5, true);
  text(doc, `${Math.round(sf2.winProbability*100)}%`, sfX+sfW-2, sfY2+6.5, C.gold, 4, false, "right");

  roundedRect(doc, sfX, sfY2+11, sfW, 10, 1.5, [14,18,30] as RGB, C.border);
  doc.setLineWidth(0.2);
  roundedRect(doc, sfX+1, sfY2+12, 8, 8, 1, C.border);
  text(doc, String(sf2.loser.seed), sfX+5, sfY2+17, C.muted, 5, false, "center");
  text(doc, truncate(sf2.loser.shortName, 9), sfX+11, sfY2+17.5, C.muted, 4.5, false);

  // Championship
  const champY = pageH / 2 - 14;
  roundedRect(doc, cx + 1, champY - 6, cw - 2, 5, 1.5, C.card, C.gold);
  doc.setLineWidth(0.5);
  text(doc, "CHAMPIONSHIP", cx + cw/2, champY - 2, C.gold, 4.5, true, "center");

  const ch = bracket.championship;
  // Champion box
  roundedRect(doc, sfX - 1, champY, sfW + 2, 12, 2, [28, 20, 4] as RGB, C.gold);
  doc.setLineWidth(0.6);
  text(doc, "🏆", sfX + 2, champY + 7, C.gold, 7);
  text(doc, truncate(ch.winner.name, 13), sfX + 11, champY + 5, C.gold, 5.5, true);
  text(doc, `Seed ${ch.winner.seed} · ${ch.winner.region}`, sfX + 11, champY + 10.5, C.muted, 3.8);
  text(doc, `${Math.round(ch.winProbability*100)}% win prob`, sfX + sfW - 1, champY + 7, C.gold, 3.8, true, "right");

  // Runner-up
  roundedRect(doc, sfX, champY + 14, sfW, 8, 1.5, C.card, C.border);
  doc.setLineWidth(0.2);
  text(doc, `Runner-up: ${ch.loser.shortName} (${ch.loser.seed})`, cx + cw/2, champY + 19.5, C.muted, 3.8, false, "center");

  // Connector lines from SF winners to championship
  setStroke(doc, [60, 50, 10] as RGB);
  doc.setLineWidth(0.3);
  doc.line(sfX + sfW/2, sfY1 + 10, sfX + sfW/2, champY);
  doc.line(sfX + sfW/2, sfY2 + 10, sfX + sfW/2, champY + 12);

  // ── Page 2: Analytics Report ─────────────────────────────────────────────
  doc.addPage();
  setFill(doc, C.bg);
  doc.rect(0, 0, pageW, pageH, "F");

  // Header
  roundedRect(doc, 0, 0, pageW, 14, 0, C.card);
  text(doc, "PropEdge — March Madness 2026 Analytics Report", pageW/2, 9, C.gold, 9, true, "center");

  let curY = 20;

  // ── Section 1: Champion Analysis
  roundedRect(doc, 4, curY, pageW - 8, 38, 2, C.card, C.gold);
  doc.setLineWidth(0.4);
  text(doc, "🏆  PREDICTED CHAMPION", 10, curY + 6, C.gold, 6, true);
  text(doc, bracket.champion.name, 10, curY + 13, C.white, 9, true);
  text(doc, `${bracket.champion.seed}-seed · ${bracket.champion.region} Region · +${bracket.champion.championshipOdds.toLocaleString()} title odds · ${toImplied(bracket.champion.championshipOdds)}% implied`,
    10, curY + 19, C.muted, 4.5);

  // Key stats grid
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
    text(doc, s.val, bx + 21.5, by + 5.5, C.gold, 6, true, "center");
    text(doc, s.label, bx + 21.5, by + 9.5, C.muted, 3.2, false, "center");
  });

  // Analysis blurb
  const blurb = bracket.champion.analysis.split(". ").slice(0, 2).join(". ") + ".";
  const lines = doc.splitTextToSize(blurb, pageW - 20) as string[];
  text(doc, lines[0] || "", 10, curY + 37, C.muted, 3.8);

  curY += 44;

  // ── Section 2: Final Four
  text(doc, "FINAL FOUR", 10, curY + 5, C.gold, 5.5, true);
  doc.setLineWidth(0.2);
  doc.line(10, curY + 7, pageW - 10, curY + 7);
  setStroke(doc, C.gold);
  curY += 11;

  const ffTeams = [
    bracket.finalFour.matchups[0].winner,
    bracket.finalFour.matchups[0].loser,
    bracket.finalFour.matchups[1].winner,
    bracket.finalFour.matchups[1].loser,
  ];
  const ffLabels = ["East Winner", "West Winner", "Midwest Winner", "South Winner"];
  ffTeams.forEach((t, i) => {
    const bx = 4 + i * 72;
    roundedRect(doc, bx, curY, 68, 22, 2, C.card, i < 2 ? C.gold : C.green);
    doc.setLineWidth(i < 2 ? 0.4 : 0.3);
    text(doc, ffLabels[i], bx + 34, curY + 5, C.muted, 3, false, "center");
    text(doc, t.name, bx + 34, curY + 11, C.white, 4.5, true, "center");
    text(doc, `${t.seed}-seed · +${t.championshipOdds.toLocaleString()}`, bx + 34, curY + 16, C.gold, 3.5, false, "center");
    text(doc, `Margin: +${t.adjEffMargin.toFixed(1)} | Form: ${t.recentForm}`, bx + 34, curY + 20.5, C.muted, 3, false, "center");
  });
  curY += 27;

  // ── Section 3: Upset picks
  const upsets = bracket.regions.flatMap(r =>
    r.rounds.flatMap(rd => rd.matchups.filter(m => m.upsetAlert))
  );

  if (upsets.length > 0) {
    text(doc, `⚠  PROJECTED UPSETS  (${upsets.length})`, 10, curY + 5, C.yellow, 5.5, true);
    doc.setLineWidth(0.2);
    setStroke(doc, C.yellow);
    doc.line(10, curY + 7, pageW - 10, curY + 7);
    setStroke(doc, C.border);
    curY += 11;

    upsets.slice(0, 8).forEach((u, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ux = 4 + col * 145;
      const uy = curY + row * 16;
      roundedRect(doc, ux, uy, 139, 13, 1.5, C.card, [60, 45, 5] as RGB);
      doc.setLineWidth(0.3);
      roundedRect(doc, ux + 1, uy + 1, 18, 11, 1, [60,40,0] as RGB);
      text(doc, "UPSET", ux + 10, uy + 7.5, C.yellow, 4, true, "center");
      text(doc, `${u.winner.seed}-seed ${u.winner.shortName} over ${u.loser.seed}-seed ${u.loser.shortName}`,
        ux + 22, uy + 5.5, C.white, 4.5, true);
      text(doc, `${Math.round(u.winProbability*100)}% win prob · ${u.winner.region} Region · Proj: ${u.projectedScore.winner}-${u.projectedScore.loser}`,
        ux + 22, uy + 10.5, C.muted, 3.5);
    });

    const upsetRows = Math.ceil(Math.min(upsets.length, 8) / 2);
    curY += upsetRows * 16 + 4;
  }

  // ── Section 4: All region winners summary
  if (curY < pageH - 30) {
    text(doc, "REGION WINNERS", 10, curY + 5, C.green, 5.5, true);
    doc.setLineWidth(0.2);
    setStroke(doc, C.green);
    doc.line(10, curY + 7, pageW - 10, curY + 7);
    setStroke(doc, C.border);
    curY += 11;

    bracket.regions.forEach((r, i) => {
      const w = r.regionWinner;
      const bx = 4 + i * 72;
      roundedRect(doc, bx, curY, 68, 16, 1.5, C.card, C.border);
      text(doc, r.region.toUpperCase(), bx + 34, curY + 5, C.gold, 3.5, true, "center");
      text(doc, w.name, bx + 34, curY + 10, C.white, 4, true, "center");
      text(doc, `${w.seed}-seed · +${w.championshipOdds.toLocaleString()} · ${w.record}`, bx + 34, curY + 15, C.muted, 3, false, "center");
    });

    curY += 20;
  }

  // ── Footer on both pages ─────────────────────────────────────────────────
  const footerY = pageH - 5;
  text(doc, "Created with Perplexity Computer · perplexity.ai/computer  |  PropEdge · prop-edge.up.railway.app  |  Odds from DraftKings · Not financial advice",
    pageW / 2, footerY, C.muted, 3, false, "center");

  doc.setPage(1);
  text(doc, "Created with Perplexity Computer · prop-edge.up.railway.app",
    pageW / 2, pageH - 2, C.muted, 3, false, "center");

  // ── Save ─────────────────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`PropEdge-Bracket-2026-${dateStr}.pdf`);
}
