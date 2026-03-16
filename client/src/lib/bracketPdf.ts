/**
 * PropEdge — March Madness 2026 Bracket PDF Generator
 *
 * Reproduces the exact structure of the official NCAA MARCH-MAD.pdf bracket,
 * then overlays the AI-predicted winners into every blank slot.
 *
 * Official bracket layout (landscape A4 / letter-ish proportions):
 *   - Left half:  EAST (top) + SOUTH (bottom) — R1 on far left, E8 near center
 *   - Right half: WEST (top) + MIDWEST (bottom) — R1 on far right, E8 near center
 *   - Center:     NATIONAL CHAMPIONSHIP + SEMIFINALS (Final Four)
 *   - Top strip:  FIRST FOUR (Dayton)
 *
 * R1 seed order (top → bottom, per region):
 *   1,16, 8,9, 5,12, 4,13,  6,11, 3,14, 7,10, 2,15
 */

import jsPDF from "jspdf";
import { FullBracket } from "./bracketEngine";
import { NCAATeam } from "../data/bracketData";

// ── Palette — matches the dark PropEdge theme ──────────────────────────────
const C = {
  bg:       [10,  12,  20] as [number,number,number],
  surface:  [16,  20,  34] as [number,number,number],
  card:     [20,  26,  44] as [number,number,number],
  border:   [40,  50,  72] as [number,number,number],
  gold:     [245,158,  11] as [number,number,number],
  goldDim:  [ 55, 38,   4] as [number,number,number],
  white:    [235,238,245] as [number,number,number],
  muted:    [110,122,150] as [number,number,number],
  green:    [ 16,185,129] as [number,number,number],
  red:      [220, 55, 55] as [number,number,number],
  blue:     [ 59,130,246] as [number,number,number],
  purple:   [160, 80,240] as [number,number,number],
  yellow:   [234,179,  8] as [number,number,number],
  line:     [ 50, 62, 90] as [number,number,number],
};
type RGB = [number,number,number];

// ── Helpers ────────────────────────────────────────────────────────────────
function fill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0],c[1],c[2]); }
function stroke(doc: jsPDF, c: RGB, lw = 0.25) { doc.setDrawColor(c[0],c[1],c[2]); doc.setLineWidth(lw); }
function textCol(doc: jsPDF, c: RGB) { doc.setTextColor(c[0],c[1],c[2]); }

// rect(doc, x,y,w,h, r, fc?, sc?, lw)
// r = corner radius (0 = sharp corners)
function rect(doc: jsPDF, x:number,y:number,w:number,h:number, r=0, fc?:RGB, sc?:RGB, lw=0.2) {
  doc.setLineWidth(lw);
  if (fc) fill(doc,fc);
  if (sc) stroke(doc,sc,lw);
  if (r > 0) doc.roundedRect(x,y,w,h,r,r, fc&&sc?"FD":fc?"F":"S");
  else       doc.rect(x,y,w,h,             fc&&sc?"FD":fc?"F":"S");
}

function t(doc:jsPDF, s:string, x:number, y:number, col:RGB, sz:number, bold=false, align:"left"|"center"|"right"="left") {
  textCol(doc,col); doc.setFontSize(sz); doc.setFont("helvetica", bold?"bold":"normal");
  doc.text(s,x,y,{align});
}

function clip(s:string, n:number) { return s.length>n ? s.slice(0,n-1)+"…" : s; }

// ── Page dimensions (A4 landscape) ────────────────────────────────────────
// 297 × 210 mm

// ── Official bracket geometry ─────────────────────────────────────────────
//
// The official NCAA bracket divides the page as follows:
//
//  ┌─────────────────────────────────────────────────────────────────────┐
//  │  Header: title + round labels                              ~14mm    │
//  │  First Four strip                                          ~10mm    │
//  ├───────────────┬───────────────────────────┬───────────────────────┤
//  │  EAST         │       FINAL FOUR CENTER   │  WEST                 │
//  │  4 rounds     │  SF1 + Champ + SF2        │  4 rounds (flipped)   │
//  │  (top half)   │                           │  (top half)           │
//  ├───────────────┤                           ├───────────────────────┤
//  │  SOUTH        │                           │  MIDWEST              │
//  │  4 rounds     │                           │  4 rounds (flipped)   │
//  │  (bot half)   │                           │  (bot half)           │
//  └───────────────┴───────────────────────────┴───────────────────────┘
//
// Each side is split 50/50 vertically between its two regions.

interface TeamSlot {
  team: NCAATeam;
  isWinner: boolean;
  winPct?: number;
  upset?: boolean;
}

// ── Draw one team line (the fundamental unit of the bracket) ───────────────
// Returns the Y-center of the line for connector logic.
function drawLine(
  doc: jsPDF,
  x: number, y: number, w: number,
  slot: TeamSlot,
  flip = false   // true = right-side region, text right-aligned
): number {
  const H = 7.2; // row height

  // Background
  const bg: RGB = slot.isWinner ? [22,30,52] : [12,16,28];
  rect(doc, x, y, w, H, 1, bg, slot.isWinner ? C.gold : C.border, slot.isWinner ? 0.35 : 0.15);

  // Seed badge
  const bw = 7.5;
  const badgeX = flip ? x + w - bw - 1 : x + 1;
  rect(doc, badgeX, y+1, bw, H-2, 1, slot.isWinner ? C.gold : C.border);
  t(doc, String(slot.team.seed), badgeX + bw/2, y + H/2 + 1.3,
    slot.isWinner ? C.bg : C.muted, 4, true, "center");

  // Name
  const nameX = flip ? badgeX - 2 : badgeX + bw + 2;
  const maxChars = slot.winPct !== undefined ? 11 : 14;
  const nameAlign: "left"|"right" = flip ? "right" : "left";
  t(doc, clip(slot.team.shortName, maxChars), nameX, y + H/2 + 1.3,
    slot.isWinner ? C.white : C.muted, 4.2, slot.isWinner, nameAlign);

  // Win probability
  if (slot.winPct !== undefined) {
    const pctX = flip ? x + 2 : x + w - 2;
    const pctAlign: "left"|"right" = flip ? "left" : "right";
    t(doc, `${Math.round(slot.winPct*100)}%`, pctX, y + H/2 + 1.3,
      slot.isWinner ? C.gold : C.muted, 3.5, false, pctAlign);
  }

  // Upset badge
  if (slot.upset && slot.isWinner) {
    const ux = flip ? x + 1 : x + w - 12;
    rect(doc, ux, y+1.2, 11, H-2.4, 1, C.goldDim);
    t(doc, "UPSET", ux + 5.5, y + H/2 + 1.2, C.yellow, 3, true, "center");
  }

  return y + H/2;
}

// ── Draw a bracket connector: two source centers → one destination center ──
function connector(doc: jsPDF, x1: number, y1: number, y2: number, x2: number) {
  const mid = (y1+y2)/2;
  stroke(doc, C.line, 0.22);
  doc.line(x1, y1, x1, y2);   // vertical between pair
  doc.line(x1, mid, x2, mid); // horizontal to next round
}

// ── Draw one complete region ───────────────────────────────────────────────
//
//  regionData: the generated bracket for this region
//  lx, ly:     top-left corner of this region's bounding box
//  rw, rh:     width and height
//  flip:       true = right-side region (R1 rightmost, rounds go left)
//  labelColor: accent color for region banner
//
// Returns array of E8-winner centerY (just 1 value, index 0) for Final Four connectors.
function drawRegion(
  doc: jsPDF,
  regionData: import("./bracketEngine").GeneratedBracket,
  lx: number, ly: number, rw: number, rh: number,
  flip: boolean,
  label: string,
  labelColor: RGB
): number {

  const LINE_H   = 7.2;
  const LINE_GAP = 1.0;   // gap between the two lines of a matchup
  const PAIR_H   = LINE_H * 2 + LINE_GAP; // height of one matchup pair
  const ROUND_LABEL_H = 6;

  // Column widths: R1 gets 30%, R2 22%, S16 22%, E8 26% (proportional to official)
  const colFracs = [0.30, 0.22, 0.22, 0.26];
  const GAP = 1.5; // gap between columns
  const totalGaps = GAP * 3;
  const usableW = rw - totalGaps;
  const colW = colFracs.map(f => usableW * f);

  // Compute left-edge X of each column (non-flipped order: R1=0, R2=1, S16=2, E8=3)
  const colX: number[] = new Array(4);
  if (!flip) {
    colX[0] = lx;
    for (let i=1;i<4;i++) colX[i] = colX[i-1] + colW[i-1] + GAP;
  } else {
    // E8 is leftmost (closest to center), R1 is rightmost
    colX[3] = lx;
    for (let i=2;i>=0;i--) colX[i] = colX[i+1] + colW[i+1] + GAP;
  }

  // Region label banner (above round labels)
  const bannerY = ly;
  rect(doc, lx, bannerY, rw, 8, 0, [Math.round(labelColor[0]*0.10), Math.round(labelColor[1]*0.10), Math.round(labelColor[2]*0.10)] as RGB);
  t(doc, label, lx + rw/2, bannerY + 5.8, labelColor, 5.5, true, "center");

  const contentTop = ly + 8 + ROUND_LABEL_H + 1;
  const contentH   = rh - 8 - ROUND_LABEL_H - 1;

  // Round column headers
  const roundNames = ["FIRST ROUND", "SECOND ROUND", "SWEET 16", "ELITE EIGHT"];
  const roundDates = ["3/19-3/20", "3/21-3/22", "3/26-3/27", "3/28-3/29"];
  for (let i=0;i<4;i++) {
    const cx = colX[i] + colW[i]/2;
    t(doc, roundNames[i], cx, ly+12.5, C.muted, 3.0, true, "center");
    t(doc, roundDates[i], cx, ly+15.5, [70,80,110] as RGB, 2.5, false, "center");
  }

  // Matchup counts per round: 8, 4, 2, 1
  const counts = [8,4,2,1];
  // centerYs[roundIdx][matchupIdx] = vertical center of that matchup pair
  const centerYs: number[][] = [[],[],[],[]];

  for (let r=0; r<4; r++) {
    const mc = counts[r];
    const spacing = contentH / mc;
    const cx = colX[r];
    const cw = colW[r];

    for (let m=0; m<mc; m++) {
      const midY   = contentTop + spacing * m + spacing/2;
      const pairY  = midY - PAIR_H/2;

      if (r === 0) {
        // R1: show both teams from the original matchup
        const matchup = regionData.rounds[0].matchups[m];
        // Put lower-numbered seed on top (just as in official bracket)
        const topTeam    = matchup.winner.seed < matchup.loser.seed ? matchup.winner : matchup.loser;
        const bottomTeam = matchup.winner.seed < matchup.loser.seed ? matchup.loser  : matchup.winner;

        drawLine(doc, cx, pairY, cw,
          { team: topTeam, isWinner: matchup.winner.id===topTeam.id,
            winPct: matchup.winner.id===topTeam.id ? matchup.winProbability : 1-matchup.winProbability,
            upset: matchup.winner.id===topTeam.id ? matchup.upsetAlert : false },
          flip);
        drawLine(doc, cx, pairY + LINE_H + LINE_GAP, cw,
          { team: bottomTeam, isWinner: matchup.winner.id===bottomTeam.id,
            winPct: matchup.winner.id===bottomTeam.id ? matchup.winProbability : 1-matchup.winProbability,
            upset: matchup.winner.id===bottomTeam.id ? matchup.upsetAlert : false },
          flip);
      } else {
        // R2–E8: show winner on top, loser below
        const matchup = regionData.rounds[r].matchups[m];
        drawLine(doc, cx, pairY, cw,
          { team: matchup.winner, isWinner: true,
            winPct: matchup.winProbability, upset: matchup.upsetAlert },
          flip);
        drawLine(doc, cx, pairY + LINE_H + LINE_GAP, cw,
          { team: matchup.loser, isWinner: false },
          flip);
      }

      centerYs[r][m] = midY;
    }
  }

  // ── Draw connector lines between rounds ────────────────────────────────
  for (let r=0; r<3; r++) {
    const mc       = counts[r];
    const nextMc   = counts[r+1];

    for (let nm=0; nm<nextMc; nm++) {
      const srcY1 = centerYs[r][nm*2];
      const srcY2 = centerYs[r][nm*2+1];
      const dstY  = centerYs[r+1][nm];
      if (srcY1===undefined || srcY2===undefined) continue;

      stroke(doc, C.line, 0.22);

      if (!flip) {
        // Lines exit right side of column r, enter left side of column r+1
        const ex = colX[r] + colW[r];       // exit X
        const nx = colX[r+1];              // entry X
        doc.line(ex, srcY1, ex+GAP/2, srcY1);
        doc.line(ex, srcY2, ex+GAP/2, srcY2);
        doc.line(ex+GAP/2, srcY1, ex+GAP/2, srcY2);
        doc.line(ex+GAP/2, dstY, nx, dstY);
      } else {
        // Lines exit left side of column r, enter right side of column r+1
        const ex = colX[r];
        const nx = colX[r+1] + colW[r+1];
        doc.line(ex, srcY1, ex-GAP/2, srcY1);
        doc.line(ex, srcY2, ex-GAP/2, srcY2);
        doc.line(ex-GAP/2, srcY1, ex-GAP/2, srcY2);
        doc.line(ex-GAP/2, dstY, nx, dstY);
      }
    }
  }

  // Return E8 winner center Y
  return centerYs[3][0];
}

// ── Analytics page helper ──────────────────────────────────────────────────
function toImplied(ml:number) {
  return ml>0 ? Math.round(100/(ml+100)*100) : Math.round(Math.abs(ml)/(Math.abs(ml)+100)*100);
}

// ── Main export ────────────────────────────────────────────────────────────
export async function downloadBracketPDF(bracket: FullBracket): Promise<void> {
  const doc  = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
  const PW   = doc.internal.pageSize.getWidth();   // 297
  const PH   = doc.internal.pageSize.getHeight();  // 210

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — Official NCAA bracket filled with AI predictions
  // ══════════════════════════════════════════════════════════════════════════

  // Background
  fill(doc, C.bg); doc.rect(0,0,PW,PH,"F");

  // ── Header ────────────────────────────────────────────────────────────────
  rect(doc, 0, 0, PW, 13, 0, C.card);
  t(doc, "PropEdge · 2026 NCAA DIVISION I MEN'S BASKETBALL CHAMPIONSHIP",
    PW/2, 5.5, C.gold, 6.5, true, "center");
  t(doc, "AI-Predicted Bracket", PW/2, 10.5, C.muted, 3.5, false, "center");
  t(doc, `Champion: ${bracket.champion.name}`, 4, 5.5, C.gold, 4.5, true);
  t(doc, `+${bracket.champion.championshipOdds.toLocaleString()} · ${bracket.champion.seed}-seed · ${bracket.champion.region}`,
    4, 10.5, C.muted, 3.5);
  t(doc, `Generated ${new Date(bracket.generatedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}`,
    PW-3, 8, C.muted, 3.5, false, "right");

  // ── First Four strip ───────────────────────────────────────────────────
  const FF_H = 11;
  rect(doc, 0, 13, PW, FF_H, 0, [14,18,30] as RGB, C.border, 0.15);
  t(doc, "FIRST FOUR® — DAYTON  3/17-3/18", PW/2, 17, C.gold, 3.8, true, "center");

  // First Four matchups (sourced directly from bracketData, not bracket simulation)
  const ffGames = [
    { label:"MIDWEST 16",    game:"Howard (23-10) vs UMBC (24-8)" },
    { label:"WEST 11",       game:"NC State (20-13) vs Texas (18-14)" },
    { label:"MIDWEST 11",    game:"SMU (20-13) vs Miami OH (31-1)" },
    { label:"SOUTH 16",      game:"Prairie View A&M (18-17) vs Lehigh (18-16)" },
  ];
  const ffSlotW = (PW - 20) / 4;
  ffGames.forEach((g,i) => {
    const fx = 5 + i * (ffSlotW + (10/3));
    rect(doc, fx, 20, ffSlotW-2, 3.5, 0.8, [20,26,44] as RGB, C.border, 0.15);
    t(doc, g.label, fx + 2, 22.5, C.muted, 2.8, true);
    t(doc, g.game, fx + ffSlotW/2, 22.5, [160,170,200] as RGB, 2.8, false, "center");
  });

  // ── Layout geometry ────────────────────────────────────────────────────
  const HEADER_TOTAL = 13 + FF_H;   // 24mm total top strip
  const CW  = 42;                   // center column width (Final Four)
  const SW  = (PW - CW) / 2;       // side width for each half (~127.5mm)
  const MID = HEADER_TOTAL + (PH - HEADER_TOTAL) * 0.5; // vertical midpoint

  const topH = MID - HEADER_TOTAL;
  const botH = PH - MID;

  // Regions
  const east    = bracket.regions.find(r=>r.region==="East")!;
  const west    = bracket.regions.find(r=>r.region==="West")!;
  const south   = bracket.regions.find(r=>r.region==="South")!;
  const midwest = bracket.regions.find(r=>r.region==="Midwest")!;

  const eastE8Y    = drawRegion(doc, east,    0,       HEADER_TOTAL, SW, topH, false, "EAST",    C.gold);
  const westE8Y    = drawRegion(doc, west,    SW+CW,   HEADER_TOTAL, SW, topH, true,  "WEST",    C.green);
  const southE8Y   = drawRegion(doc, south,   0,       MID,          SW, botH, false, "SOUTH",   C.red);
  const midwestE8Y = drawRegion(doc, midwest, SW+CW,   MID,          SW, botH, true,  "MIDWEST", C.purple);

  // ── Center column: Final Four & Championship ───────────────────────────
  const cx = SW;

  // Center divider line
  stroke(doc, C.border, 0.3);
  doc.line(cx + CW/2, HEADER_TOTAL+1, cx + CW/2, PH-3);

  // "NATIONAL CHAMPIONSHIP" header
  rect(doc, cx+2, HEADER_TOTAL+2, CW-4, 7, 1.5, C.card, C.gold, 0.45);
  t(doc, "NATIONAL", cx+CW/2, HEADER_TOTAL+6, C.gold, 4.5, true, "center");
  t(doc, "CHAMPIONSHIP  04/06", cx+CW/2, HEADER_TOTAL+10.5, C.gold, 3.2, false, "center");

  // ── Championship box (dead center) ────────────────────────────────────
  const ch      = bracket.championship;
  const champY  = PH/2 - 12;
  rect(doc, cx+2, champY, CW-4, 24, 2, [26,18,4] as RGB, C.gold, 0.5);
  t(doc, "🏆", cx+5, champY+8.5, C.gold, 7);
  t(doc, clip(ch.winner.name,13), cx+14, champY+6, C.gold, 4.8, true);
  t(doc, `${ch.winner.seed}-seed · ${ch.winner.region}`, cx+14, champY+10.5, C.muted, 3.2);
  t(doc, `${Math.round(ch.winProbability*100)}% win prob`, cx+CW-4, champY+15, C.gold, 3.2, false, "right");
  rect(doc, cx+3, champY+13, CW-6, 7, 1, C.card, C.border, 0.15);
  t(doc, `Runner-up: ${ch.loser.shortName} (${ch.loser.seed})`,
    cx+CW/2, champY+17.5, C.muted, 3.2, false, "center");

  // ── Final Four matchups ────────────────────────────────────────────────
  const sf1 = bracket.finalFour.matchups[0]; // East vs West
  const sf2 = bracket.finalFour.matchups[1]; // Midwest vs South
  const LINE_H = 7.2;
  const LINE_GAP = 1.0;
  const sfW = CW - 6;
  const sfX = cx + 3;

  // SF1 position: between top of center column and championship box
  const sf1MidY = (HEADER_TOTAL + 14 + champY) / 2;
  const sf1TopY = sf1MidY - (LINE_H*2 + LINE_GAP) / 2;

  t(doc, "SEMIFINALS", cx+CW/2, sf1TopY-2.5, C.muted, 2.8, false, "center");
  drawLine(doc, sfX, sf1TopY,              sfW, { team:sf1.winner, isWinner:true,  winPct:sf1.winProbability, upset:sf1.upsetAlert });
  drawLine(doc, sfX, sf1TopY+LINE_H+LINE_GAP, sfW, { team:sf1.loser,  isWinner:false });
  t(doc, "East vs West", cx+CW/2, sf1TopY+LINE_H*2+LINE_GAP+3.5, [80,90,120] as RGB, 2.5, false, "center");

  // SF2 position: between championship box and bottom of center column
  const sf2MidY = (champY+24 + PH-3) / 2;
  const sf2TopY = sf2MidY - (LINE_H*2 + LINE_GAP) / 2;

  t(doc, "SEMIFINALS", cx+CW/2, sf2TopY-2.5, C.muted, 2.8, false, "center");
  drawLine(doc, sfX, sf2TopY,              sfW, { team:sf2.winner, isWinner:true,  winPct:sf2.winProbability, upset:sf2.upsetAlert });
  drawLine(doc, sfX, sf2TopY+LINE_H+LINE_GAP, sfW, { team:sf2.loser,  isWinner:false });
  t(doc, "Midwest vs South", cx+CW/2, sf2TopY+LINE_H*2+LINE_GAP+3.5, [80,90,120] as RGB, 2.5, false, "center");

  // ── Connector lines: E8 → Semis → Champ ───────────────────────────────
  const sf1WinY = sf1TopY + LINE_H/2;
  const sf2WinY = sf2TopY + LINE_H/2;

  stroke(doc, [60,52,12] as RGB, 0.3);
  // East E8 → SF1
  doc.line(cx-1,     eastE8Y,   cx+3,   eastE8Y);
  doc.line(cx+3,     eastE8Y,   cx+3,   sf1WinY);
  doc.line(cx+3,     sf1WinY,   sfX,    sf1WinY);
  // West E8 → SF1
  doc.line(cx+CW+1,  westE8Y,   cx+CW-3, westE8Y);
  doc.line(cx+CW-3,  westE8Y,   cx+CW-3, sf1WinY);
  doc.line(cx+CW-3,  sf1WinY,   sfX+sfW, sf1WinY);
  // South E8 → SF2
  doc.line(cx-1,     southE8Y,  cx+3,   southE8Y);
  doc.line(cx+3,     southE8Y,  cx+3,   sf2WinY);
  doc.line(cx+3,     sf2WinY,   sfX,    sf2WinY);
  // Midwest E8 → SF2
  doc.line(cx+CW+1,  midwestE8Y, cx+CW-3, midwestE8Y);
  doc.line(cx+CW-3,  midwestE8Y, cx+CW-3, sf2WinY);
  doc.line(cx+CW-3,  sf2WinY,   sfX+sfW, sf2WinY);
  // SF winners → Championship
  stroke(doc, [60,52,12] as RGB, 0.3);
  doc.line(sfX+sfW/2, sf1TopY+LINE_H, sfX+sfW/2, champY);
  doc.line(sfX+sfW/2, sf2TopY,         sfX+sfW/2, champY+24);

  // ── Page footer ────────────────────────────────────────────────────────
  t(doc, "Created with Perplexity Computer · prop-edge.up.railway.app  |  Odds: DraftKings  |  For entertainment only — not financial advice",
    PW/2, PH-2, C.muted, 2.8, false, "center");

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 2 — Analytics Report
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  fill(doc, C.bg); doc.rect(0,0,PW,PH,"F");
  rect(doc, 0,0,PW,13,0,C.card);
  t(doc,"PropEdge — March Madness 2026 Analytics Report",PW/2,9,C.gold,8,true,"center");

  let cy = 19;

  // Champion section
  rect(doc,4,cy,PW-8,40,2,C.card,C.gold,0.4);
  t(doc,"🏆  PREDICTED CHAMPION",10,cy+6,C.gold,6,true);
  t(doc,bracket.champion.name,10,cy+13,C.white,9,true);
  t(doc,`${bracket.champion.seed}-seed · ${bracket.champion.region} · +${bracket.champion.championshipOdds.toLocaleString()} title odds · ${toImplied(bracket.champion.championshipOdds)}% implied`,
    10,cy+19,C.muted,4.5);

  const stats=[
    {l:"Adj. Off",v:bracket.champion.adjOffRating.toFixed(1)},
    {l:"Adj. Def",v:bracket.champion.adjDefRating.toFixed(1)},
    {l:"Eff. Margin",v:`+${bracket.champion.adjEffMargin.toFixed(1)}`},
    {l:"PPG",v:String(bracket.champion.ppg)},
    {l:"3PT%",v:`${bracket.champion.fg3Pct}%`},
    {l:"SOS",v:`${bracket.champion.strengthOfSchedule}/10`},
  ];
  stats.forEach((s,i)=>{
    const bx=10+i*47, by=cy+23;
    rect(doc,bx,by,43,11,1.5,[18,24,40] as RGB);
    t(doc,s.v,bx+21.5,by+5.5,C.gold,6,true,"center");
    t(doc,s.l,bx+21.5,by+9.5,C.muted,3.2,false,"center");
  });
  const blurb=bracket.champion.analysis.split(". ").slice(0,2).join(". ")+".";
  t(doc,(doc.splitTextToSize(blurb,PW-20) as string[])[0]??"",10,cy+37,C.muted,3.8);
  cy+=46;

  // Final Four
  t(doc,"FINAL FOUR",10,cy+5,C.gold,5.5,true);
  stroke(doc,C.gold,0.2); doc.line(10,cy+7,PW-10,cy+7); cy+=11;

  const ff=[bracket.finalFour.matchups[0].winner,bracket.finalFour.matchups[0].loser,
            bracket.finalFour.matchups[1].winner,bracket.finalFour.matchups[1].loser];
  const ffl=["East Winner","West Winner","Midwest Winner","South Winner"];
  ff.forEach((team,i)=>{
    const bx=4+i*72;
    rect(doc,bx,cy,68,22,2,C.card,i<2?C.gold:C.green,i<2?0.4:0.3);
    t(doc,ffl[i],bx+34,cy+5,C.muted,3,false,"center");
    t(doc,team.name,bx+34,cy+11,C.white,4.5,true,"center");
    t(doc,`${team.seed}-seed · +${team.championshipOdds.toLocaleString()}`,bx+34,cy+16,C.gold,3.5,false,"center");
    t(doc,`Margin: +${team.adjEffMargin.toFixed(1)} | ${team.recentForm}`,bx+34,cy+20.5,C.muted,3,false,"center");
  });
  cy+=27;

  // Upsets
  const upsets=bracket.regions.flatMap(r=>r.rounds.flatMap(rd=>rd.matchups.filter(m=>m.upsetAlert)));
  if(upsets.length>0){
    t(doc,`⚠  PROJECTED UPSETS  (${upsets.length})`,10,cy+5,C.yellow,5.5,true);
    stroke(doc,C.yellow,0.2); doc.line(10,cy+7,PW-10,cy+7); stroke(doc,C.border,0.2);
    cy+=11;
    upsets.slice(0,8).forEach((u,i)=>{
      const col=i%2,row=Math.floor(i/2);
      const ux=4+col*145,uy=cy+row*16;
      rect(doc,ux,uy,139,13,1.5,C.card,[60,45,5] as RGB,0.3);
      rect(doc,ux+1,uy+1,18,11,1,C.goldDim);
      t(doc,"UPSET",ux+10,uy+7.5,C.yellow,4,true,"center");
      t(doc,`${u.winner.seed}-seed ${u.winner.shortName} over ${u.loser.seed}-seed ${u.loser.shortName}`,ux+22,uy+5.5,C.white,4.5,true);
      t(doc,`${Math.round(u.winProbability*100)}% win prob · ${u.winner.region} · Proj: ${u.projectedScore.winner}-${u.projectedScore.loser}`,ux+22,uy+10.5,C.muted,3.5);
    });
    cy+=Math.ceil(Math.min(upsets.length,8)/2)*16+4;
  }

  // Region winners
  if(cy<PH-30){
    t(doc,"REGION WINNERS",10,cy+5,C.green,5.5,true);
    stroke(doc,C.green,0.2); doc.line(10,cy+7,PW-10,cy+7); stroke(doc,C.border,0.2);
    cy+=11;
    bracket.regions.forEach((r,i)=>{
      const w=r.regionWinner,bx=4+i*72;
      rect(doc,bx,cy,68,16,1.5,C.card,C.border,0.15);
      t(doc,r.region.toUpperCase(),bx+34,cy+5,C.gold,3.5,true,"center");
      t(doc,w.name,bx+34,cy+10,C.white,4,true,"center");
      t(doc,`${w.seed}-seed · +${w.championshipOdds.toLocaleString()} · ${w.record}`,bx+34,cy+15,C.muted,3,false,"center");
    });
  }

  // Footer
  t(doc,"Created with Perplexity Computer · perplexity.ai/computer  |  PropEdge · prop-edge.up.railway.app  |  Odds: DraftKings  |  Not financial advice",
    PW/2,PH-5,C.muted,2.8,false,"center");

  doc.setPage(1);
  t(doc,"Created with Perplexity Computer · prop-edge.up.railway.app",
    PW/2,PH-2,C.muted,2.8,false,"center");

  // Save
  doc.save(`PropEdge-Bracket-2026-${new Date().toISOString().slice(0,10)}.pdf`);
}
