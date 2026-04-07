/**
 * PropEdge Fantasy Decision Engine — v3
 *
 * UX principles from feedback:
 *  - One active mode at a time (preseason / draft / inseason)
 *  - KPI strip: biggest ADP edge, best sleeper, most overvalued, top confidence pick
 *  - Player detail drawer with full "why" explanation
 *  - Compare Players tool
 *  - Grouped filter bar (Sport · Position · Action)
 *  - Fantasy pts first, stat lines second
 *  - Trend rise/fall badges
 *  - News & injury aware (ESPN feed, 15-min refresh)
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp, TrendingDown, Users, Zap, Star, AlertTriangle,
  RefreshCw, Search, ChevronDown, ChevronUp, Target,
  Award, Activity, ArrowUpRight, ArrowDownRight, Minus,
  Shield, Clock, BarChart2, Flame, Shuffle, Trophy,
  Play, SkipForward, RotateCcw, CheckCircle, XCircle,
  ChevronRight, Newspaper, Siren, Info, UserCheck, Package,
  GitCompare, X, ArrowUp, ArrowDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SubView   = "preseason" | "draft" | "inseason";
type SportTab  = "ALL" | "NFL" | "NBA" | "MLB" | "NHL";
type FormatTab = "standard" | "ppr" | "half_ppr" | "superflex" | "dynasty" | "bestball";
type PositionF = "ALL" | "QB" | "RB" | "WR" | "TE" | "K" | "DST" | "SP" | "RP" | "C" | "1B" | "2B" | "3B" | "SS" | "OF" | "F" | "D" | "G";
type ActionTag = "DRAFT" | "AVOID" | "START" | "SIT" | "ADD" | "TRADE FOR" | "SELL" | "HOLD" | "SLEEPER" | "BUST";
type RiskLevel = "low" | "medium" | "high";
type Trend     = "up" | "down" | "flat";
type SortKey   = "actionScore" | "adpEdge" | "modelRank" | "consensusRank" | "weeklyProj";

interface NewsAlert { headline: string; published: string; status: string; source: string; }

interface PlayerCard {
  id: string; name: string; sport: SportTab; team: string; position: string;
  consensusRank: number; modelRank: number; actionScore: number; actionTag: ActionTag;
  // Projections — fantasy pts first
  fantasyPtsWeekly: number;       // projected fantasy points this week
  fantasyPtsSeason: number;       // projected season total
  projection: string;             // stat line detail
  ceiling: string; floor: string;
  adp: number;
  riskLevel: RiskLevel; injuryStatus: string | null;
  trend: Trend; adpTrend: "rising" | "falling" | "stable"; // ADP movement direction
  valueGap: number;
  breakoutProb: number;
  scheduleGrade: "A" | "B" | "C" | "D" | "F";
  usageNote: string;
  opponent?: string; matchupRank?: number;
  snapsharePct?: number; targetShare?: number; weeklyProj?: number;
  reason: string;
  roundEst?: number; reach?: boolean; steal?: boolean;
  newsAlerts?: NewsAlert[]; projAdjusted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Season Phase Detection
// ─────────────────────────────────────────────────────────────────────────────
type SeasonPhase = "inseason" | "draft" | "preseason";
interface PhaseInfo { phase: SeasonPhase; label: string; daysUntilNext: number | null; nextEvent: string; }

function detectSportPhase(sport: SportTab): PhaseInfo {
  const now = new Date(); const mo = now.getMonth(); const d = now.getDate();
  if (sport === "NFL") {
    const inSeason = (mo === 8 && d >= 5) || mo === 9 || mo === 10 || mo === 11 || (mo === 0 && d <= 12);
    if (inSeason) return { phase: "inseason", label: "NFL Season", daysUntilNext: null, nextEvent: "Playoffs" };
    if ((mo === 6 && d >= 15) || mo === 7 || (mo === 8 && d <= 4)) {
      const days = Math.ceil((new Date(now.getFullYear(), 8, 5).getTime() - now.getTime()) / 86400000);
      return { phase: "draft", label: "Fantasy Draft Season", daysUntilNext: days, nextEvent: "NFL Season" };
    }
    return { phase: "preseason", label: "NFL Offseason", daysUntilNext: null, nextEvent: "Draft Season (Jul 15)" };
  }
  if (sport === "NBA") {
    const inSeason = (mo === 9 && d >= 22) || mo === 10 || mo === 11 || mo === 0 || mo === 1 || mo === 2 || (mo === 3 && d <= 13);
    if (inSeason) return { phase: "inseason", label: "NBA Season", daysUntilNext: null, nextEvent: "Playoffs" };
    const inPlayoffs = (mo === 3 && d >= 14) || mo === 4 || mo === 5 || (mo === 6 && d <= 22);
    if (inPlayoffs) return { phase: "inseason", label: "NBA Playoffs", daysUntilNext: null, nextEvent: "Offseason" };
    if ((mo === 6 && d >= 23) || mo === 7 || mo === 8 || (mo === 9 && d <= 21)) {
      const days = Math.ceil((new Date(now.getFullYear(), 9, 22).getTime() - now.getTime()) / 86400000);
      return { phase: "draft", label: "Fantasy Draft Season", daysUntilNext: days, nextEvent: "NBA Season" };
    }
    return { phase: "preseason", label: "NBA Offseason", daysUntilNext: null, nextEvent: "Draft Season (Jun 23)" };
  }
  if (sport === "MLB") {
    const inSeason = (mo === 2 && d >= 27) || mo === 3 || mo === 4 || mo === 5 || mo === 6 || mo === 7 || (mo === 8 && d <= 28);
    if (inSeason) return { phase: "inseason", label: "MLB Season", daysUntilNext: null, nextEvent: "Playoffs" };
    const openingDay = new Date(now.getFullYear() + (mo <= 2 ? 0 : 1), 2, 27);
    const days = Math.ceil((openingDay.getTime() - now.getTime()) / 86400000);
    if (mo === 11 || mo === 0 || mo === 1 || (mo === 2 && d <= 26)) {
      const phase: SeasonPhase = days <= 30 ? "draft" : "preseason";
      return { phase, label: phase === "draft" ? "Fantasy Draft Season" : "MLB Offseason", daysUntilNext: days, nextEvent: "Opening Day" };
    }
    return { phase: "preseason", label: "MLB Offseason", daysUntilNext: null, nextEvent: "Draft Season (Dec 1)" };
  }
  if (sport === "NHL") {
    const inSeason = (mo === 9 && d >= 8) || mo === 10 || mo === 11 || mo === 0 || mo === 1 || mo === 2 || (mo === 3 && d <= 17);
    if (inSeason) return { phase: "inseason", label: "NHL Season", daysUntilNext: null, nextEvent: "Playoffs" };
    const inPlayoffs = (mo === 3 && d >= 18) || mo === 4 || mo === 5 || (mo === 6 && d <= 21);
    if (inPlayoffs) return { phase: "inseason", label: "NHL Playoffs", daysUntilNext: null, nextEvent: "Offseason" };
    if (mo === 6 || mo === 7 || mo === 8) {
      const days = Math.ceil((new Date(now.getFullYear(), 9, 8).getTime() - now.getTime()) / 86400000);
      return { phase: "draft", label: "Fantasy Draft Season", daysUntilNext: days, nextEvent: "NHL Season" };
    }
    return { phase: "preseason", label: "NHL Offseason", daysUntilNext: null, nextEvent: "Draft Season (Jul 1)" };
  }
  return { phase: "inseason", label: "In Season", daysUntilNext: null, nextEvent: "" };
}

function getMostActiveSport(): SportTab {
  const sports: SportTab[] = ["MLB", "NBA", "NHL", "NFL"];
  const phases = sports.map(s => ({ sport: s, info: detectSportPhase(s) }));
  const inSeason = phases.filter(p => p.info.phase === "inseason");
  if (inSeason.length > 0) return inSeason[0].sport;
  const draft = phases.find(p => p.info.phase === "draft");
  if (draft) return draft.sport;
  return "NFL";
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Roster — 150+ players across NFL, NBA, MLB, NHL
// fantasyPtsWeekly = projected weekly fantasy points
// fantasyPtsSeason = projected season total (scaled)
// ─────────────────────────────────────────────────────────────────────────────
const PLAYERS: PlayerCard[] = [
  // ── NFL QBs
  { id:"nfl-qb1", name:"Patrick Mahomes",    sport:"NFL", team:"Kansas City Chiefs",      position:"QB",
    consensusRank:1, modelRank:1, actionScore:96, actionTag:"DRAFT",
    fantasyPtsWeekly:28.4, fantasyPtsSeason:455,
    projection:"315 pass yds, 2.4 TD, 28 rush yds",   ceiling:"380+ yds 3 TD", floor:"240 yds 1 TD",
    adp:2.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:92, scheduleGrade:"A", usageNote:"28+ TD pace, elite red-zone efficiency",
    weeklyProj:28.4, reason:"Most complete QB in fantasy — model and consensus agree. Draft confidently in round 1.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-qb2", name:"Lamar Jackson",      sport:"NFL", team:"Baltimore Ravens",        position:"QB",
    consensusRank:2, modelRank:2, actionScore:94, actionTag:"DRAFT",
    fantasyPtsWeekly:32.1, fantasyPtsSeason:514,
    projection:"290 pass yds, 2.1 TD, 55 rush yds, 0.8 rush TD",  ceiling:"350 yds + 2 TD rush", floor:"220 yds 1 TD",
    adp:3.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:90, scheduleGrade:"A", usageNote:"Rushing upside = 2-sport weekly ceiling",
    weeklyProj:32.1, reason:"Dual-threat makes him QB1 in most formats. Highest weekly ceiling in the pool.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-qb3", name:"Jalen Hurts",        sport:"NFL", team:"Philadelphia Eagles",    position:"QB",
    consensusRank:4, modelRank:3, actionScore:89, actionTag:"DRAFT",
    fantasyPtsWeekly:27.8, fantasyPtsSeason:445,
    projection:"275 pass yds, 1.9 TD, 45 rush yds, 0.7 rush TD",  ceiling:"340 yds 2 TD rush", floor:"200 yds",
    adp:5.1, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:85, scheduleGrade:"B", usageNote:"Near-lock for 25+ pts/wk — rushing TD upside irreplaceable",
    weeklyProj:27.8, reason:"Model ranks ahead of ADP — rushing TD upside is the irreplaceable asset.",
    roundEst:1, reach:false, steal:true },
  { id:"nfl-qb4", name:"Joe Burrow",         sport:"NFL", team:"Cincinnati Bengals",     position:"QB",
    consensusRank:5, modelRank:4, actionScore:86, actionTag:"DRAFT",
    fantasyPtsWeekly:26.9, fantasyPtsSeason:430,
    projection:"300 pass yds, 2.2 TD",  ceiling:"370 yds 3 TD", floor:"240 yds 1 TD",
    adp:7.8, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:82, scheduleGrade:"B", usageNote:"Elite accuracy, WR corps top-5",
    weeklyProj:26.9, reason:"Model is 2 spots ahead of ADP — elite targets + efficiency = steal value.",
    roundEst:1, reach:false, steal:true },
  { id:"nfl-qb5", name:"Jordan Love",        sport:"NFL", team:"Green Bay Packers",      position:"QB",
    consensusRank:9, modelRank:7, actionScore:74, actionTag:"DRAFT",
    fantasyPtsWeekly:24.1, fantasyPtsSeason:386,
    projection:"285 pass yds, 2.0 TD",  ceiling:"340 yds 3 TD", floor:"200 yds",
    adp:9.5, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:-2,
    breakoutProb:68, scheduleGrade:"B", usageNote:"Improved red-zone efficiency, WR corps healthy",
    weeklyProj:24.1, reason:"Model 2 ahead of ADP. Efficiency gains carry over from last season.",
    roundEst:2, reach:false, steal:false },
  { id:"nfl-qb6", name:"Dak Prescott",       sport:"NFL", team:"Dallas Cowboys",         position:"QB",
    consensusRank:7, modelRank:9, actionScore:65, actionTag:"HOLD",
    fantasyPtsWeekly:22.4, fantasyPtsSeason:358,
    projection:"280 pass yds, 1.9 TD",  ceiling:"360 yds 3 TD", floor:"210 yds",
    adp:8.2, riskLevel:"medium", injuryStatus:null, trend:"flat", adpTrend:"falling", valueGap:2,
    breakoutProb:55, scheduleGrade:"C", usageNote:"OL concerns, WR depth thin after off-season",
    weeklyProj:22.4, reason:"Slight model downgrade — injury history and OL worries justify the discount.",
    roundEst:2, reach:false, steal:false },

  // ── NFL RBs
  { id:"nfl-rb1", name:"Christian McCaffrey",sport:"NFL", team:"San Francisco 49ers",   position:"RB",
    consensusRank:1, modelRank:1, actionScore:97, actionTag:"DRAFT",
    fantasyPtsWeekly:28.9, fantasyPtsSeason:462,
    projection:"115 rush yds, 0.9 TD, 35 rec yds",  ceiling:"170 yds + 2 TD", floor:"80 yds",
    adp:1.2, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:94, scheduleGrade:"A", usageNote:"Bell-cow + receiving back, 30+ touches per game",
    weeklyProj:28.9, reason:"Unanimous RB1 when healthy. Injury risk is the only flag — worth it at 1.2.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-rb2", name:"Saquon Barkley",     sport:"NFL", team:"Philadelphia Eagles",   position:"RB",
    consensusRank:3, modelRank:3, actionScore:90, actionTag:"DRAFT",
    fantasyPtsWeekly:22.1, fantasyPtsSeason:354,
    projection:"98 rush yds, 0.8 TD, 28 rec yds",  ceiling:"150 yds + TD", floor:"60 yds",
    adp:3.8, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:0,
    breakoutProb:85, scheduleGrade:"A", usageNote:"Eagles OL top-3, receiving role locked",
    weeklyProj:22.1, reason:"Model confirms consensus — best RB in a top-5 offense. No hesitation.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-rb3", name:"Bijan Robinson",     sport:"NFL", team:"Atlanta Falcons",       position:"RB",
    consensusRank:7, modelRank:4, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:19.1, fantasyPtsSeason:306,
    projection:"94 rush yds, 0.7 TD, 4 rec",  ceiling:"130 yds + TD", floor:"55 yds",
    adp:7.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-3,
    breakoutProb:76, scheduleGrade:"A", usageNote:"Bell-cow back, 85%+ snap share",
    weeklyProj:19.1, reason:"ADP undervalues Bijan — model projects RB4. Steal at picks 7–8.",
    roundEst:1, reach:false, steal:true },
  { id:"nfl-rb4", name:"Breece Hall",        sport:"NFL", team:"New York Jets",         position:"RB",
    consensusRank:5, modelRank:5, actionScore:82, actionTag:"DRAFT",
    fantasyPtsWeekly:20.5, fantasyPtsSeason:328,
    projection:"95 rush yds, 0.7 TD, 25 rec yds",  ceiling:"145 yds + TD", floor:"55 yds",
    adp:5.5, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:78, scheduleGrade:"B", usageNote:"Elite receiving role, new OC boost expected",
    weeklyProj:20.5, reason:"Receiving upside elevates him above pure rushers. Strong RB2 floor.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-rb5", name:"Derrick Henry",      sport:"NFL", team:"Baltimore Ravens",      position:"RB",
    consensusRank:10, modelRank:6, actionScore:84, actionTag:"DRAFT",
    fantasyPtsWeekly:20.8, fantasyPtsSeason:333,
    projection:"105 rush yds, 1.0 TD",  ceiling:"150 yds + 2 TD", floor:"65 yds",
    adp:10.1, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-4,
    breakoutProb:80, scheduleGrade:"A", usageNote:"Ravens OL top-3, still elite power back",
    weeklyProj:20.8, reason:"Model loves Henry in Baltimore scheme — ADP at 10 is a steal for his upside.",
    roundEst:2, reach:false, steal:true },
  { id:"nfl-rb6", name:"De'Von Achane",      sport:"NFL", team:"Miami Dolphins",        position:"RB",
    consensusRank:12, modelRank:9, actionScore:79, actionTag:"SLEEPER",
    fantasyPtsWeekly:19.3, fantasyPtsSeason:309,
    projection:"82 rush yds, 0.6 TD, 32 rec yds",  ceiling:"130 yds + TD", floor:"45 yds",
    adp:11.8, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-3,
    breakoutProb:73, scheduleGrade:"B", usageNote:"Explosive speed, receiving role expanding",
    weeklyProj:19.3, reason:"Model 3 ahead of ADP. Explosive play rate is elite — rising ADP confirms.",
    roundEst:2, reach:false, steal:true },
  { id:"nfl-rb7", name:"Jonathan Taylor",   sport:"NFL", team:"Indianapolis Colts",    position:"RB",
    consensusRank:6, modelRank:8, actionScore:70, actionTag:"HOLD",
    fantasyPtsWeekly:17.2, fantasyPtsSeason:275,
    projection:"88 rush yds, 0.6 TD, 2 rec",  ceiling:"120 yds + TD", floor:"50 yds",
    adp:6.3, riskLevel:"high", injuryStatus:null, trend:"down", adpTrend:"falling", valueGap:2,
    breakoutProb:52, scheduleGrade:"C", usageNote:"Injury history concern, OL ranked 24th",
    weeklyProj:17.2, reason:"Model downgrade — health risk and weak OL. ADP falling confirms the concern.",
    roundEst:1, reach:true, steal:false },
  { id:"nfl-rb8", name:"Alvin Kamara",      sport:"NFL", team:"New Orleans Saints",    position:"RB",
    consensusRank:14, modelRank:22, actionScore:35, actionTag:"AVOID",
    fantasyPtsWeekly:12.8, fantasyPtsSeason:205,
    projection:"71 rush yds, 0.4 TD",  ceiling:"100 yds + TD", floor:"35 yds",
    adp:13.8, riskLevel:"high", injuryStatus:null, trend:"down", adpTrend:"falling", valueGap:8,
    breakoutProb:18, scheduleGrade:"D", usageNote:"Age decline + OL ranked 28th",
    weeklyProj:12.8, reason:"Declining usage + brutal schedule. ADP falling — clear bust risk.",
    roundEst:2, reach:true, steal:false },

  // ── NFL WRs
  { id:"nfl-wr1", name:"CeeDee Lamb",       sport:"NFL", team:"Dallas Cowboys",         position:"WR",
    consensusRank:2, modelRank:3, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:23.1, fantasyPtsSeason:370,
    projection:"140 rec yds, 0.9 TD",  ceiling:"190 yds + TD", floor:"75 yds",
    adp:2.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:1,
    breakoutProb:88, scheduleGrade:"B", usageNote:"35%+ target share — entire offense runs through him",
    weeklyProj:23.1, reason:"Unmatched volume. Even a weak OL can't stop 35% target share.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-wr2", name:"Ja'Marr Chase",     sport:"NFL", team:"Cincinnati Bengals",     position:"WR",
    consensusRank:3, modelRank:2, actionScore:91, actionTag:"DRAFT",
    fantasyPtsWeekly:22.4, fantasyPtsSeason:358,
    projection:"138 rec yds, 0.9 TD",  ceiling:"180 yds + TD", floor:"70 yds",
    adp:3.2, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:-1,
    breakoutProb:82, scheduleGrade:"B", usageNote:"31% target share, WR1 role locked with Burrow healthy",
    weeklyProj:22.4, reason:"Elite target share with Burrow healthy. Model slightly above consensus.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-wr3", name:"Justin Jefferson",  sport:"NFL", team:"Minnesota Vikings",      position:"WR",
    consensusRank:5, modelRank:4, actionScore:85, actionTag:"DRAFT",
    fantasyPtsWeekly:21.8, fantasyPtsSeason:349,
    projection:"132 rec yds, 0.9 TD",  ceiling:"175 yds + TD", floor:"68 yds",
    adp:4.9, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:84, scheduleGrade:"A", usageNote:"Elite route running, new HC opens passing game",
    weeklyProj:21.8, reason:"Model slightly above ADP — rising ADP trend confirms market catching up.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-wr4", name:"Tyreek Hill",       sport:"NFL", team:"Miami Dolphins",         position:"WR",
    consensusRank:4, modelRank:5, actionScore:80, actionTag:"DRAFT",
    fantasyPtsWeekly:21.0, fantasyPtsSeason:336,
    projection:"128 rec yds, 0.8 TD",  ceiling:"170 yds + TD", floor:"60 yds",
    adp:4.4, riskLevel:"low", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:1,
    breakoutProb:76, scheduleGrade:"B", usageNote:"Volume king — PPR monster",
    weeklyProj:21.0, reason:"Slight model downgrade vs consensus — QB uncertainty is the risk.",
    roundEst:1, reach:false, steal:false },
  { id:"nfl-wr5", name:"Amon-Ra St. Brown", sport:"NFL", team:"Detroit Lions",          position:"WR",
    consensusRank:11, modelRank:8, actionScore:80, actionTag:"SLEEPER",
    fantasyPtsWeekly:20.2, fantasyPtsSeason:323,
    projection:"118 rec yds, 0.7 TD",  ceiling:"160 yds + TD", floor:"65 yds",
    adp:12.1, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-3,
    breakoutProb:78, scheduleGrade:"A", usageNote:"Slot machine — 27%+ target share in best offense",
    weeklyProj:20.2, reason:"Model 3 ahead. PPR monster in high-powered Lions offense.",
    roundEst:2, reach:false, steal:true },
  { id:"nfl-wr6", name:"Puka Nacua",        sport:"NFL", team:"Los Angeles Rams",       position:"WR",
    consensusRank:16, modelRank:11, actionScore:76, actionTag:"SLEEPER",
    fantasyPtsWeekly:18.5, fantasyPtsSeason:296,
    projection:"108 rec yds, 0.7 TD",  ceiling:"145 yds + TD", floor:"55 yds",
    adp:15.6, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-5,
    breakoutProb:72, scheduleGrade:"B", usageNote:"26% target share — volume target in Stafford system",
    weeklyProj:18.5, reason:"Model 5 ahead of ADP. Rising trend — market hasn't caught up yet.",
    roundEst:2, reach:false, steal:true },
  { id:"nfl-wr7", name:"Davante Adams",     sport:"NFL", team:"New York Jets",          position:"WR",
    consensusRank:18, modelRank:28, actionScore:41, actionTag:"AVOID",
    fantasyPtsWeekly:11.2, fantasyPtsSeason:179,
    projection:"72 rec yds, 0.5 TD",  ceiling:"105 yds", floor:"30 yds",
    adp:16.4, riskLevel:"high", injuryStatus:"Questionable", trend:"down", adpTrend:"falling", valueGap:10,
    breakoutProb:22, scheduleGrade:"C", usageNote:"New QB situation — target share uncertain",
    weeklyProj:11.2, reason:"New QB + aging legs + ADP falling. Model is 10 spots below consensus.",
    roundEst:2, reach:true, steal:false },
  { id:"nfl-wr8", name:"Stefon Diggs",      sport:"NFL", team:"Houston Texans",         position:"WR",
    consensusRank:20, modelRank:32, actionScore:32, actionTag:"AVOID",
    fantasyPtsWeekly:9.8, fantasyPtsSeason:157,
    projection:"68 rec yds, 0.4 TD",  ceiling:"95 yds", floor:"25 yds",
    adp:18.5, riskLevel:"high", injuryStatus:"Day-to-Day", trend:"down", adpTrend:"falling", valueGap:12,
    breakoutProb:15, scheduleGrade:"D", usageNote:"Age 31, health flag, reduced role in new offense",
    weeklyProj:9.8, reason:"Model 12 below consensus. Injury + age + falling ADP = stay away.",
    roundEst:3, reach:true, steal:false },

  // ── NFL TEs
  { id:"nfl-te1", name:"Sam LaPorta",       sport:"NFL", team:"Detroit Lions",          position:"TE",
    consensusRank:3, modelRank:1, actionScore:90, actionTag:"SLEEPER",
    fantasyPtsWeekly:17.5, fantasyPtsSeason:280,
    projection:"85 rec yds, 0.7 TD",  ceiling:"120 yds + TD", floor:"50 yds",
    adp:9.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:82, scheduleGrade:"A", usageNote:"Primary check-down in highest-scoring offense",
    weeklyProj:17.5, reason:"Model ranks TE1 — elite target share at the thinnest fantasy position.",
    roundEst:2, reach:false, steal:true },
  { id:"nfl-te2", name:"Travis Kelce",      sport:"NFL", team:"Kansas City Chiefs",     position:"TE",
    consensusRank:1, modelRank:2, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:16.8, fantasyPtsSeason:269,
    projection:"92 rec yds, 0.7 TD",  ceiling:"130 yds + TD", floor:"55 yds",
    adp:8.5, riskLevel:"medium", injuryStatus:null, trend:"down", adpTrend:"falling", valueGap:1,
    breakoutProb:65, scheduleGrade:"A", usageNote:"Age-related volume concerns — still positional TE1",
    weeklyProj:16.8, reason:"TE scarcity makes him worth the slight age risk. Falling ADP is mild concern.",
    roundEst:2, reach:false, steal:false },
  { id:"nfl-te3", name:"Mark Andrews",      sport:"NFL", team:"Baltimore Ravens",       position:"TE",
    consensusRank:2, modelRank:3, actionScore:82, actionTag:"DRAFT",
    fantasyPtsWeekly:16.1, fantasyPtsSeason:258,
    projection:"80 rec yds, 0.7 TD",  ceiling:"115 yds + TD", floor:"40 yds",
    adp:8.8, riskLevel:"high", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:1,
    breakoutProb:62, scheduleGrade:"B", usageNote:"Elite when healthy — injury history is the flag",
    weeklyProj:16.1, reason:"Elite ceiling when he plays. Injury history is the only concern.",
    roundEst:2, reach:false, steal:false },

  // ── NBA
  { id:"nba-1",  name:"Nikola Jokić",         sport:"NBA", team:"Denver Nuggets",         position:"C",
    consensusRank:1, modelRank:1, actionScore:97, actionTag:"DRAFT",
    fantasyPtsWeekly:62.0, fantasyPtsSeason:3224,
    projection:"27 pts, 12 reb, 9 ast per game",  ceiling:"Triple-double every night", floor:"22/9/7",
    adp:1.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:95, scheduleGrade:"A", usageNote:"28% usage — 100% of plays run through him",
    weeklyProj:62.0, reason:"Unanimous 1.01. Unmatched floor, ceiling, and consistency.",
    roundEst:1, reach:false, steal:false },
  { id:"nba-2",  name:"Luka Dončić",           sport:"NBA", team:"Dallas Mavericks",       position:"G",
    consensusRank:2, modelRank:2, actionScore:95, actionTag:"DRAFT",
    fantasyPtsWeekly:60.5, fantasyPtsSeason:3146,
    projection:"32 pts, 9 reb, 8 ast per game",  ceiling:"45 pts triple-double", floor:"26/7/6",
    adp:1.9, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:93, scheduleGrade:"A", usageNote:"35%+ usage — elite playmaker, every game",
    weeklyProj:60.5, reason:"Top-2 pick in any format. Usage and efficiency are irreplaceable.",
    roundEst:1, reach:false, steal:false },
  { id:"nba-3",  name:"Giannis Antetokounmpo", sport:"NBA", team:"Milwaukee Bucks",        position:"F",
    consensusRank:3, modelRank:3, actionScore:93, actionTag:"DRAFT",
    fantasyPtsWeekly:58.5, fantasyPtsSeason:3042,
    projection:"30 pts, 12 reb, 6 ast per game",  ceiling:"35/15 + blocks", floor:"25/10/4",
    adp:2.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:91, scheduleGrade:"B", usageNote:"Dominates 5 categories — roto monster",
    weeklyProj:58.5, reason:"Blocks + rebounds make him unstoppable in roto formats.",
    roundEst:1, reach:false, steal:false },
  { id:"nba-4",  name:"Shai Gilgeous-Alexander",sport:"NBA",team:"OKC Thunder",           position:"G",
    consensusRank:7, modelRank:5, actionScore:85, actionTag:"DRAFT",
    fantasyPtsWeekly:54.5, fantasyPtsSeason:2834,
    projection:"31 pts, 6 reb, 6 ast, 2.1 stl per game",  ceiling:"38 pts + steals", floor:"25/4/4",
    adp:6.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:88, scheduleGrade:"A", usageNote:"Elite usage + steals/points combo is unmatched",
    weeklyProj:54.5, reason:"SGA is a pts/steals machine — model slightly ahead of ADP.",
    roundEst:1, reach:false, steal:true },
  { id:"nba-5",  name:"Jayson Tatum",          sport:"NBA", team:"Boston Celtics",         position:"F",
    consensusRank:4, modelRank:4, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:52.5, fantasyPtsSeason:2730,
    projection:"26 pts, 8 reb, 5 ast per game",  ceiling:"35 pts + 10 reb", floor:"20/6/3",
    adp:4.2, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:86, scheduleGrade:"A", usageNote:"Best player on best team — elite consistency",
    weeklyProj:52.5, reason:"Consistent 25+ scorer with elite efficiency. Model confirms consensus.",
    roundEst:1, reach:false, steal:false },
  { id:"nba-6",  name:"Anthony Davis",         sport:"NBA", team:"Los Angeles Lakers",    position:"F/C",
    consensusRank:5, modelRank:6, actionScore:80, actionTag:"DRAFT",
    fantasyPtsWeekly:49.0, fantasyPtsSeason:2548,
    projection:"25 pts, 12 reb, 3 ast per game",  ceiling:"30/15 + blocks", floor:"20/9",
    adp:5.5, riskLevel:"high", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:1,
    breakoutProb:65, scheduleGrade:"B", usageNote:"Elite when healthy — injury risk is real and frequent",
    weeklyProj:49.0, reason:"Health is the only concern. Elite value when he plays every week.",
    roundEst:1, reach:false, steal:false },
  { id:"nba-7",  name:"Tyrese Haliburton",    sport:"NBA", team:"Indiana Pacers",         position:"G",
    consensusRank:8, modelRank:5, actionScore:83, actionTag:"SLEEPER",
    fantasyPtsWeekly:48.5, fantasyPtsSeason:2522,
    projection:"22 pts, 11 ast, 4 reb per game",  ceiling:"25/13 with 3+ 3s", floor:"18/8",
    adp:8.2, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-3,
    breakoutProb:79, scheduleGrade:"A", usageNote:"Primary ball-handler in pace-up Pacers system",
    weeklyProj:48.5, reason:"Model 3 spots ahead of ADP — assists upside + rising ADP confirms value.",
    roundEst:1, reach:false, steal:true },
  { id:"nba-8",  name:"Devin Booker",         sport:"NBA", team:"Phoenix Suns",           position:"G",
    consensusRank:10, modelRank:9, actionScore:76, actionTag:"DRAFT",
    fantasyPtsWeekly:46.2, fantasyPtsSeason:2402,
    projection:"27 pts, 5 reb, 7 ast per game",  ceiling:"35 pts + assists", floor:"22/4/5",
    adp:10.5, riskLevel:"medium", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:-1,
    breakoutProb:70, scheduleGrade:"C", usageNote:"Primary scorer — reliable points/assists",
    weeklyProj:46.2, reason:"Slight model upgrade. Consistent 25+ scorer in weak conference.",
    roundEst:2, reach:false, steal:false },
  { id:"nba-9",  name:"Trae Young",           sport:"NBA", team:"Atlanta Hawks",          position:"G",
    consensusRank:14, modelRank:10, actionScore:77, actionTag:"SLEEPER",
    fantasyPtsWeekly:47.5, fantasyPtsSeason:2470,
    projection:"27 pts, 3 reb, 11 ast per game",  ceiling:"35 pts + 15 assists", floor:"22/2/8",
    adp:13.5, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-4,
    breakoutProb:74, scheduleGrade:"B", usageNote:"Elite assists king — undervalued vs ADP",
    weeklyProj:47.5, reason:"Model 4 ahead. Rising ADP confirms the market is catching up.",
    roundEst:2, reach:false, steal:true },
  { id:"nba-10", name:"Kevin Durant",         sport:"NBA", team:"Phoenix Suns",           position:"F",
    consensusRank:6, modelRank:11, actionScore:44, actionTag:"HOLD",
    fantasyPtsWeekly:41.2, fantasyPtsSeason:2142,
    projection:"26 pts, 7 reb, 5 ast per game",  ceiling:"32/9", floor:"20/5",
    adp:5.8, riskLevel:"high", injuryStatus:"Questionable", trend:"down", adpTrend:"falling", valueGap:5,
    breakoutProb:35, scheduleGrade:"C", usageNote:"Injury risk at 36, usage trending down + falling ADP",
    weeklyProj:41.2, reason:"Name inflating ADP. Age + injury + falling ADP — target Rd 2 or pass.",
    roundEst:1, reach:true, steal:false },
  { id:"nba-11", name:"Joel Embiid",          sport:"NBA", team:"Philadelphia 76ers",     position:"C",
    consensusRank:9, modelRank:14, actionScore:48, actionTag:"HOLD",
    fantasyPtsWeekly:38.5, fantasyPtsSeason:2002,
    projection:"28 pts, 11 reb, 4 ast per game",  ceiling:"35/13 + blocks", floor:"22/8",
    adp:8.8, riskLevel:"high", injuryStatus:"Day-to-Day", trend:"down", adpTrend:"falling", valueGap:5,
    breakoutProb:40, scheduleGrade:"B", usageNote:"Load management + knee concern = 25% games missed",
    weeklyProj:38.5, reason:"Elite when available. 25% miss rate is a real risk at this ADP.",
    roundEst:2, reach:true, steal:false },
  { id:"nba-12", name:"Ja Morant",            sport:"NBA", team:"Memphis Grizzlies",      position:"G",
    consensusRank:15, modelRank:11, actionScore:74, actionTag:"SLEEPER",
    fantasyPtsWeekly:45.1, fantasyPtsSeason:2345,
    projection:"25 pts, 8 reb, 7 ast per game",  ceiling:"32 pts + steals", floor:"18/6/5",
    adp:14.2, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-4,
    breakoutProb:76, scheduleGrade:"B", usageNote:"Full health return — elite playmaker when available",
    weeklyProj:45.1, reason:"Model 4 ahead — healthy Ja is an elite asset. Rising ADP confirms.",
    roundEst:2, reach:false, steal:true },
  { id:"nba-13", name:"Paolo Banchero",       sport:"NBA", team:"Orlando Magic",          position:"F",
    consensusRank:16, modelRank:12, actionScore:75, actionTag:"SLEEPER",
    fantasyPtsWeekly:43.0, fantasyPtsSeason:2236,
    projection:"22 pts, 7 reb, 6 ast per game",  ceiling:"28/9 + assists", floor:"17/5/4",
    adp:15.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-4,
    breakoutProb:78, scheduleGrade:"B", usageNote:"Year-3 leap expected — primary option locked in",
    weeklyProj:43.0, reason:"Model sees breakout pace. ADP hasn't caught up. Rising trend confirms.",
    roundEst:2, reach:false, steal:true },
  { id:"nba-14", name:"LeBron James",         sport:"NBA", team:"Los Angeles Lakers",    position:"F",
    consensusRank:18, modelRank:22, actionScore:40, actionTag:"HOLD",
    fantasyPtsWeekly:35.5, fantasyPtsSeason:1846,
    projection:"22 pts, 8 reb, 7 ast per game",  ceiling:"28 pts triple-double", floor:"18/6/5",
    adp:17.2, riskLevel:"high", injuryStatus:null, trend:"down", adpTrend:"falling", valueGap:4,
    breakoutProb:20, scheduleGrade:"C", usageNote:"Age 40 — load management near-certain",
    weeklyProj:35.5, reason:"Model downgrade + falling ADP. Age and load management = unreliable.",
    roundEst:3, reach:true, steal:false },

  // ── MLB
  { id:"mlb-1",  name:"Shohei Ohtani",       sport:"MLB", team:"Los Angeles Dodgers",    position:"OF/SP",
    consensusRank:1, modelRank:1, actionScore:98, actionTag:"DRAFT",
    fantasyPtsWeekly:38.5, fantasyPtsSeason:2002,
    projection:".310 / 45 HR / 110 RBI / 15 SB",  ceiling:"50 HR / 120 RBI", floor:".285 / 38 HR",
    adp:1.1, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:90, scheduleGrade:"A", usageNote:"Two-way value — pitching returns this season",
    weeklyProj:38.5, reason:"Two-way production makes him a category unto himself. Undraftable at any slot.",
    roundEst:1, reach:false, steal:false },
  { id:"mlb-2",  name:"Mookie Betts",        sport:"MLB", team:"Los Angeles Dodgers",    position:"OF/2B",
    consensusRank:5, modelRank:4, actionScore:87, actionTag:"DRAFT",
    fantasyPtsWeekly:34.1, fantasyPtsSeason:1773,
    projection:".295 / 32 HR / 40 SB",  ceiling:"38 HR / 50 SB", floor:".270 / 25 HR",
    adp:5.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:85, scheduleGrade:"A", usageNote:"Steals + HR combo at leadoff in Dodgers lineup",
    weeklyProj:34.1, reason:"Multi-category excellence — model agrees. Draft on value.",
    roundEst:1, reach:false, steal:false },
  { id:"mlb-3",  name:"Yordan Alvarez",      sport:"MLB", team:"Houston Astros",         position:"OF/DH",
    consensusRank:7, modelRank:5, actionScore:89, actionTag:"DRAFT",
    fantasyPtsWeekly:35.5, fantasyPtsSeason:1846,
    projection:".295 / 38 HR / 105 RBI",  ceiling:"45 HR / 115 RBI", floor:".270 / 30 HR",
    adp:6.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:87, scheduleGrade:"A", usageNote:"Elite exit velocity — cleanup hitter locked",
    weeklyProj:35.5, reason:"Model 2 ahead — elite power with top lineup protection. Rising ADP confirms.",
    roundEst:1, reach:false, steal:true },
  { id:"mlb-4",  name:"Ronald Acuña Jr.",    sport:"MLB", team:"Atlanta Braves",         position:"OF",
    consensusRank:4, modelRank:3, actionScore:85, actionTag:"DRAFT",
    fantasyPtsWeekly:33.8, fantasyPtsSeason:1758,
    projection:".295 / 38 HR / 60 SB",  ceiling:"45 HR / 75 SB", floor:".270 / 28 HR",
    adp:3.9, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:80, scheduleGrade:"B", usageNote:"ACL return — usage managed early but ceiling intact",
    weeklyProj:33.8, reason:"ACL risk already priced into ADP. Full-health Acuña at 4 is value.",
    roundEst:1, reach:false, steal:false },
  { id:"mlb-5",  name:"Freddie Freeman",     sport:"MLB", team:"Los Angeles Dodgers",    position:"1B",
    consensusRank:8, modelRank:6, actionScore:82, actionTag:"DRAFT",
    fantasyPtsWeekly:30.2, fantasyPtsSeason:1570,
    projection:".305 / 28 HR / 100 RBI",  ceiling:"35 HR / 110 RBI", floor:".285 / 22 HR",
    adp:7.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:78, scheduleGrade:"A", usageNote:"Dodgers lineup depth drives elite runs/RBI upside",
    weeklyProj:30.2, reason:"Model 2 ahead — Dodgers lineup makes him elite for RBI/runs categories.",
    roundEst:1, reach:false, steal:true },
  { id:"mlb-6",  name:"Adley Rutschman",     sport:"MLB", team:"Baltimore Orioles",      position:"C",
    consensusRank:2, modelRank:2, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:29.2, fantasyPtsSeason:1518,
    projection:".280 / 22 HR / 85 RBI",  ceiling:"28 HR / 95 RBI", floor:".260 / 17 HR",
    adp:2.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:86, scheduleGrade:"A", usageNote:"Best catcher by a wide margin — positional gold",
    weeklyProj:29.2, reason:"Catcher scarcity makes him mandatory. Draft confidently at 2.5.",
    roundEst:1, reach:false, steal:false },
  { id:"mlb-7",  name:"Juan Soto",           sport:"MLB", team:"New York Mets",          position:"OF",
    consensusRank:3, modelRank:6, actionScore:52, actionTag:"HOLD",
    fantasyPtsWeekly:0, fantasyPtsSeason:1218,
    projection:".285 / 35 HR / 100 RBI (when healthy)",  ceiling:"40 HR / 110 RBI", floor:".260 / 28 HR",
    adp:2.8, riskLevel:"high", injuryStatus:"IL", trend:"down", adpTrend:"falling", valueGap:3,
    breakoutProb:55, scheduleGrade:"B", usageNote:"On IL — return timeline unclear. ADP falling.",
    weeklyProj:0, reason:"IL placement + falling ADP = model downgrade. Monitor before drafting or starting.",
    projAdjusted:true, roundEst:1, reach:true, steal:false },
  { id:"mlb-8",  name:"Spencer Strider",     sport:"MLB", team:"Atlanta Braves",         position:"SP",
    consensusRank:6, modelRank:4, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:35.8, fantasyPtsSeason:1862,
    projection:"2.65 ERA / 235 K / 12 W",  ceiling:"2.20 ERA / 260 K", floor:"3.10 ERA",
    adp:6.2, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:86, scheduleGrade:"A", usageNote:"Elite strikeout rate — healthy return",
    weeklyProj:35.8, reason:"Model 2 ahead — strikeout upside is SP1 level. Rising ADP confirms.",
    roundEst:1, reach:false, steal:true },
  { id:"mlb-9",  name:"Paul Skenes",         sport:"MLB", team:"Pittsburgh Pirates",     position:"SP",
    consensusRank:12, modelRank:7, actionScore:84, actionTag:"SLEEPER",
    fantasyPtsWeekly:33.5, fantasyPtsSeason:1742,
    projection:"2.90 ERA / 220 K / 11 W",  ceiling:"2.50 ERA / 245 K", floor:"3.30 ERA",
    adp:11.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-5,
    breakoutProb:88, scheduleGrade:"B", usageNote:"Year-2 leap — velocity elite, best stuff in NL",
    weeklyProj:33.5, reason:"Model 5 ahead — elite SP talent that ADP hasn't fully priced in yet.",
    roundEst:2, reach:false, steal:true },
  { id:"mlb-10", name:"Elly De La Cruz",     sport:"MLB", team:"Cincinnati Reds",        position:"SS",
    consensusRank:9, modelRank:7, actionScore:83, actionTag:"SLEEPER",
    fantasyPtsWeekly:32.8, fantasyPtsSeason:1706,
    projection:".275 / 28 HR / 55 SB",  ceiling:"35 HR / 70 SB", floor:".250 / 20 HR",
    adp:9.2, riskLevel:"medium", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:82, scheduleGrade:"B", usageNote:"5-tool upside — SB elite for his slot",
    weeklyProj:32.8, reason:"SB upside is elite. Rising ADP confirms market catching up to model.",
    roundEst:1, reach:false, steal:true },
  { id:"mlb-11", name:"Gerrit Cole",         sport:"MLB", team:"New York Yankees",       position:"SP",
    consensusRank:10, modelRank:9, actionScore:80, actionTag:"DRAFT",
    fantasyPtsWeekly:31.5, fantasyPtsSeason:1638,
    projection:"2.80 ERA / 215 K / 13 W",  ceiling:"2.50 ERA / 230 K", floor:"3.20 ERA",
    adp:9.8, riskLevel:"medium", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:-1,
    breakoutProb:74, scheduleGrade:"B", usageNote:"Elite command + Yankee run support",
    weeklyProj:31.5, reason:"Reliable SP1 — model roughly aligns with consensus.",
    roundEst:2, reach:false, steal:false },
  { id:"mlb-12", name:"Zack Wheeler",        sport:"MLB", team:"Philadelphia Phillies",  position:"SP",
    consensusRank:8, modelRank:8, actionScore:82, actionTag:"DRAFT",
    fantasyPtsWeekly:32.2, fantasyPtsSeason:1674,
    projection:"2.70 ERA / 210 K / 13 W",  ceiling:"2.40 ERA / 230 K", floor:"3.00 ERA",
    adp:8.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:80, scheduleGrade:"B", usageNote:"Workhorse ace — elite innings + strikeouts",
    weeklyProj:32.2, reason:"Model aligns exactly. Elite workhorse — draft confidently.",
    roundEst:1, reach:false, steal:false },
  { id:"mlb-13", name:"Austin Hays",         sport:"MLB", team:"Chicago White Sox",      position:"OF",
    consensusRank:88, modelRank:105, actionScore:22, actionTag:"AVOID",
    fantasyPtsWeekly:0, fantasyPtsSeason:520,
    projection:".262 / 18 HR / 55 RBI (when healthy)",  ceiling:"22 HR", floor:".240 / 12 HR",
    adp:85.0, riskLevel:"high", injuryStatus:"10-Day IL", trend:"down", adpTrend:"falling", valueGap:17,
    breakoutProb:18, scheduleGrade:"F", usageNote:"10-Day IL hamstring — White Sox worst record in MLB",
    weeklyProj:0, reason:"On 10-day IL + worst team context. Pass entirely.",
    projAdjusted:true, roundEst:9, reach:true, steal:false },
  { id:"mlb-14", name:"Fernando Tatis Jr.",  sport:"MLB", team:"San Diego Padres",       position:"OF",
    consensusRank:11, modelRank:10, actionScore:78, actionTag:"DRAFT",
    fantasyPtsWeekly:30.8, fantasyPtsSeason:1602,
    projection:".275 / 33 HR / 45 SB",  ceiling:"40 HR / 55 SB", floor:".250 / 25 HR",
    adp:10.5, riskLevel:"medium", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:-1,
    breakoutProb:72, scheduleGrade:"B", usageNote:"5-tool talent — health is the only flag",
    weeklyProj:30.8, reason:"Model agrees. Power/speed mix is elite when healthy.",
    roundEst:2, reach:false, steal:false },
  { id:"mlb-15", name:"Max Scherzer",        sport:"MLB", team:"Texas Rangers",          position:"SP",
    consensusRank:22, modelRank:38, actionScore:28, actionTag:"AVOID",
    fantasyPtsWeekly:24.1, fantasyPtsSeason:1253,
    projection:"3.85 ERA / 180 K / 9 W",  ceiling:"3.50 ERA", floor:"4.40 ERA",
    adp:20.4, riskLevel:"high", injuryStatus:"Questionable", trend:"down", adpTrend:"falling", valueGap:16,
    breakoutProb:12, scheduleGrade:"D", usageNote:"Age 40, TJ recovery, innings limit likely",
    weeklyProj:24.1, reason:"Model 16 below consensus. Falling ADP confirms — clear bust candidate.",
    roundEst:3, reach:true, steal:false },

  // ── NHL
  { id:"nhl-1",  name:"Connor McDavid",      sport:"NHL", team:"Edmonton Oilers",        position:"F",
    consensusRank:1, modelRank:1, actionScore:99, actionTag:"DRAFT",
    fantasyPtsWeekly:14.5, fantasyPtsSeason:754,
    projection:"50G / 90A per season",  ceiling:"55G / 100A", floor:"45G / 75A",
    adp:1.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:99, scheduleGrade:"A", usageNote:"PP1 QB, 22+ min TOI, best player on ice every night",
    weeklyProj:14.5, reason:"Unanimous 1.01. Trade everything to move up.",
    roundEst:1, reach:false, steal:false },
  { id:"nhl-2",  name:"Nathan MacKinnon",    sport:"NHL", team:"Colorado Avalanche",     position:"F",
    consensusRank:2, modelRank:3, actionScore:88, actionTag:"DRAFT",
    fantasyPtsWeekly:14.0, fantasyPtsSeason:728,
    projection:"45G / 80A per season",  ceiling:"50G / 90A", floor:"38G / 68A",
    adp:2.2, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:1,
    breakoutProb:92, scheduleGrade:"A", usageNote:"Elite playmaker on top PP unit",
    weeklyProj:14.0, reason:"Model slightly below consensus ADP but still top-3 lock.",
    roundEst:1, reach:false, steal:false },
  { id:"nhl-3",  name:"Auston Matthews",     sport:"NHL", team:"Toronto Maple Leafs",    position:"F",
    consensusRank:3, modelRank:2, actionScore:90, actionTag:"DRAFT",
    fantasyPtsWeekly:13.8, fantasyPtsSeason:717,
    projection:"55G / 42A per season",  ceiling:"65G / 50A", floor:"48G / 35A",
    adp:2.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:85, scheduleGrade:"B", usageNote:"Elite goal-scorer, PP1, consistent linemates",
    weeklyProj:13.8, reason:"Model 1 ahead — highest goals-only upside in the draft pool.",
    roundEst:1, reach:false, steal:true },
  { id:"nhl-4",  name:"Cale Makar",          sport:"NHL", team:"Colorado Avalanche",     position:"D",
    consensusRank:4, modelRank:4, actionScore:86, actionTag:"DRAFT",
    fantasyPtsWeekly:13.2, fantasyPtsSeason:686,
    projection:"25G / 65A per season",  ceiling:"30G / 75A", floor:"20G / 55A",
    adp:4.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:0,
    breakoutProb:88, scheduleGrade:"A", usageNote:"Best offensive D-man in the game — PP1 QB",
    weeklyProj:13.2, reason:"Best D in fantasy. Positional scarcity makes him must-draft at 4.",
    roundEst:1, reach:false, steal:false },
  { id:"nhl-5",  name:"Leon Draisaitl",      sport:"NHL", team:"Edmonton Oilers",        position:"F",
    consensusRank:5, modelRank:4, actionScore:87, actionTag:"DRAFT",
    fantasyPtsWeekly:13.5, fantasyPtsSeason:702,
    projection:"42G / 72A per season",  ceiling:"50G / 82A", floor:"36G / 60A",
    adp:5.1, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"stable", valueGap:-1,
    breakoutProb:86, scheduleGrade:"A", usageNote:"PP1 QB — benefits from McDavid attention",
    weeklyProj:13.5, reason:"McDavid connection provides elite opportunities. Model agrees.",
    roundEst:1, reach:false, steal:false },
  { id:"nhl-6",  name:"David Pastrnak",      sport:"NHL", team:"Boston Bruins",          position:"F",
    consensusRank:6, modelRank:7, actionScore:78, actionTag:"DRAFT",
    fantasyPtsWeekly:12.8, fantasyPtsSeason:666,
    projection:"48G / 40A per season",  ceiling:"55G / 50A", floor:"40G / 32A",
    adp:6.2, riskLevel:"low", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:1,
    breakoutProb:76, scheduleGrade:"B", usageNote:"Elite goal scorer — PP1 power play role",
    weeklyProj:12.8, reason:"Slight model downgrade. Goals upside is still elite for the slot.",
    roundEst:1, reach:false, steal:false },
  { id:"nhl-7",  name:"Matthew Tkachuk",     sport:"NHL", team:"Florida Panthers",       position:"F",
    consensusRank:7, modelRank:6, actionScore:81, actionTag:"DRAFT",
    fantasyPtsWeekly:12.5, fantasyPtsSeason:650,
    projection:"38G / 62A per season",  ceiling:"44G / 70A", floor:"32G / 52A",
    adp:7.0, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-1,
    breakoutProb:80, scheduleGrade:"A", usageNote:"Primary Panthers playmaker — multi-point nights",
    weeklyProj:12.5, reason:"Slight model upgrade — Panthers system elevates multi-category production.",
    roundEst:1, reach:false, steal:false },
  { id:"nhl-8",  name:"Quinn Hughes",        sport:"NHL", team:"Vancouver Canucks",      position:"D",
    consensusRank:9, modelRank:7, actionScore:79, actionTag:"SLEEPER",
    fantasyPtsWeekly:12.0, fantasyPtsSeason:624,
    projection:"20G / 70A per season",  ceiling:"25G / 80A", floor:"16G / 60A",
    adp:8.8, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-2,
    breakoutProb:82, scheduleGrade:"B", usageNote:"Top offensive D-man — elite PP unit QB",
    weeklyProj:12.0, reason:"Model 2 ahead. Elite offensive D with points upside. Rising ADP confirms.",
    roundEst:2, reach:false, steal:true },
  { id:"nhl-9",  name:"Elias Pettersson",    sport:"NHL", team:"Vancouver Canucks",      position:"F",
    consensusRank:11, modelRank:8, actionScore:78, actionTag:"SLEEPER",
    fantasyPtsWeekly:12.2, fantasyPtsSeason:634,
    projection:"35G / 65A per season",  ceiling:"42G / 72A", floor:"28G / 55A",
    adp:10.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-3,
    breakoutProb:76, scheduleGrade:"B", usageNote:"Elite playmaker — primary PP QB",
    weeklyProj:12.2, reason:"Model 3 ahead — playmaking upside undervalued. Rising ADP = buy now.",
    roundEst:2, reach:false, steal:true },
  { id:"nhl-10", name:"Brayden Point",       sport:"NHL", team:"Tampa Bay Lightning",    position:"F",
    consensusRank:10, modelRank:10, actionScore:76, actionTag:"DRAFT",
    fantasyPtsWeekly:11.8, fantasyPtsSeason:614,
    projection:"38G / 52A per season",  ceiling:"44G / 60A", floor:"32G / 44A",
    adp:10.0, riskLevel:"medium", injuryStatus:null, trend:"flat", adpTrend:"stable", valueGap:0,
    breakoutProb:74, scheduleGrade:"B", usageNote:"Primary scorer in Lightning system",
    weeklyProj:11.8, reason:"Model agrees with consensus. Solid pick at value.",
    roundEst:2, reach:false, steal:false },
  { id:"nhl-11", name:"Roman Josi",          sport:"NHL", team:"Nashville Predators",    position:"D",
    consensusRank:14, modelRank:11, actionScore:72, actionTag:"SLEEPER",
    fantasyPtsWeekly:10.8, fantasyPtsSeason:562,
    projection:"18G / 55A per season",  ceiling:"22G / 62A", floor:"14G / 46A",
    adp:13.5, riskLevel:"low", injuryStatus:null, trend:"up", adpTrend:"rising", valueGap:-3,
    breakoutProb:70, scheduleGrade:"C", usageNote:"Elite PP quarterback — minutes leader every game",
    weeklyProj:10.8, reason:"Model 3 ahead — undervalued D-man. Rising ADP = buy before market corrects.",
    roundEst:2, reach:false, steal:true },
];

// ─────────────────────────────────────────────────────────────────────────────
// ESPN News / Injury Layer
// ─────────────────────────────────────────────────────────────────────────────

const INJURY_KEYWORDS = [
  { kw:"10-day il",       status:"10-Day IL" },
  { kw:"15-day il",       status:"15-Day IL" },
  { kw:"60-day il",       status:"60-Day IL" },
  { kw:"placed on",       status:"IL" },
  { kw:"injured list",    status:"IL" },
  { kw:"day-to-day",      status:"Day-to-Day" },
  { kw:"questionable",    status:"Questionable" },
  { kw:"out indefinitely",status:"Out" },
  { kw:"ruled out",       status:"Out" },
  { kw:"activated from",  status:"Activated" },
  { kw:"returned from",   status:"Activated" },
  { kw:"concussion",      status:"Concussion Protocol" },
];

function detectInjuryStatus(h: string): string | null {
  const l = h.toLowerCase();
  for (const { kw, status } of INJURY_KEYWORDS) if (l.includes(kw)) return status;
  return null;
}

function injurySeverity(s: string): number {
  if (["Out","60-Day IL","Concussion Protocol"].includes(s)) return 3;
  if (["10-Day IL","15-Day IL","IL"].includes(s)) return 2;
  if (["Day-to-Day","Questionable"].includes(s)) return 1;
  return 0;
}

async function fetchAllInjuries(): Promise<Record<string, NewsAlert>> {
  const map: Record<string, NewsAlert> = {};
  const paths = ["baseball/mlb","basketball/nba","football/nfl","hockey/nhl"];
  await Promise.all(paths.map(async path => {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/news?limit=100`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      for (const article of (data.articles || [])) {
        const status = detectInjuryStatus(article.headline || "");
        if (!status || !article.categories) continue;
        for (const cat of article.categories.filter((c: any) => c.type === "athlete")) {
          const name = cat.athlete?.displayName || cat.description;
          if (name && !map[name]) map[name] = { headline: article.headline, published: article.published || "", status, source: "ESPN" };
        }
      }
    } catch (_) {}
  }));
  return map;
}

function applyInjuryData(players: PlayerCard[], injuryMap: Record<string, NewsAlert>): PlayerCard[] {
  return players.map(p => {
    const alert = injuryMap[p.name];
    if (!alert) return p;
    const sev = injurySeverity(alert.status);
    const updated: PlayerCard = { ...p, newsAlerts:[alert,...(p.newsAlerts||[])], injuryStatus: alert.status };
    if (sev >= 2) {
      updated.actionScore = Math.max(5, p.actionScore - 30);
      updated.actionTag = p.actionTag === "DRAFT" ? "AVOID" : p.actionTag === "START" ? "SIT" : p.actionTag === "ADD" ? "HOLD" : p.actionTag;
      updated.projAdjusted = true; updated.fantasyPtsWeekly = 0; updated.weeklyProj = 0; updated.trend = "down";
    } else if (sev === 1) {
      updated.actionScore = Math.max(10, p.actionScore - 15); updated.projAdjusted = true; updated.trend = "down";
    } else if (sev === 0 && alert.status === "Activated") {
      updated.actionScore = Math.min(100, p.actionScore + 5); updated.trend = "up";
    }
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function actionColor(tag: ActionTag) {
  const m: Record<ActionTag,{text:string;bg:string;border:string}> = {
    DRAFT:       {text:"#4ade80",bg:"rgba(74,222,128,0.10)",  border:"rgba(74,222,128,0.30)"},
    AVOID:       {text:"#f87171",bg:"rgba(248,113,113,0.10)", border:"rgba(248,113,113,0.30)"},
    START:       {text:"#34d399",bg:"rgba(52,211,153,0.10)",  border:"rgba(52,211,153,0.30)"},
    SIT:         {text:"#fb923c",bg:"rgba(251,146,60,0.10)",  border:"rgba(251,146,60,0.30)"},
    ADD:         {text:"#60a5fa",bg:"rgba(96,165,250,0.10)",  border:"rgba(96,165,250,0.30)"},
    "TRADE FOR": {text:"#a78bfa",bg:"rgba(167,139,250,0.10)", border:"rgba(167,139,250,0.30)"},
    SELL:        {text:"#f87171",bg:"rgba(248,113,113,0.08)", border:"rgba(248,113,113,0.25)"},
    HOLD:        {text:"#94a3b8",bg:"rgba(148,163,184,0.08)", border:"rgba(148,163,184,0.20)"},
    SLEEPER:     {text:"#f59e0b",bg:"rgba(245,158,11,0.10)",  border:"rgba(245,158,11,0.30)"},
    BUST:        {text:"#ef4444",bg:"rgba(239,68,68,0.10)",   border:"rgba(239,68,68,0.30)"},
  };
  return m[tag] ?? m.HOLD;
}

function riskColor(r:RiskLevel) { return r==="low"?"#4ade80":r==="medium"?"#f59e0b":"#f87171"; }
function gradeColor(g:string) { return ({A:"#4ade80",B:"#86efac",C:"#f59e0b",D:"#fb923c",F:"#f87171"})[g]??"#94a3b8"; }

function TrendBadge({trend,adpTrend}:{trend:Trend;adpTrend:"rising"|"falling"|"stable"}) {
  const arrow = adpTrend === "rising" ? <ArrowUp size={8}/> : adpTrend === "falling" ? <ArrowDown size={8}/> : null;
  const col   = adpTrend === "rising" ? "#4ade80" : adpTrend === "falling" ? "#f87171" : "#94a3b8";
  const label = adpTrend === "rising" ? "ADP↑" : adpTrend === "falling" ? "ADP↓" : "";
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold"
          style={{background:`${col}15`,color:col,border:`1px solid ${col}30`}}>
      {arrow}{label}
    </span>
  );
}

function InjuryBadge({status,adjusted}:{status:string|null;adjusted?:boolean}) {
  if (!status) return null;
  const severe = ["Out","60-Day IL","IL","10-Day IL","15-Day IL","Concussion Protocol"].includes(status);
  const activated = status === "Activated";
  const bg  = activated?"rgba(74,222,128,0.15)":severe?"rgba(248,113,113,0.15)":"rgba(251,146,60,0.15)";
  const col = activated?"#4ade80":severe?"#f87171":"#fb923c";
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{background:bg,color:col,border:`1px solid ${col}40`}}>
      {activated?<CheckCircle size={8}/>:severe?<XCircle size={8}/>:<AlertTriangle size={8}/>}
      {" "}{status}{adjusted&&<span className="ml-0.5 opacity-70">·adj</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Strip — top insight cards
// ─────────────────────────────────────────────────────────────────────────────
function KpiStrip({players}:{players:PlayerCard[]}) {
  const sorted = [...players].sort((a,b)=>a.modelRank-b.modelRank);

  // Biggest ADP edge (most undervalued — most negative valueGap)
  const bigEdge = [...sorted].sort((a,b)=>a.valueGap-b.valueGap)[0];
  // Best sleeper
  const bestSleeper = sorted.find(p=>p.actionTag==="SLEEPER");
  // Most overvalued (biggest positive valueGap)
  const mostOver = [...sorted].sort((a,b)=>b.valueGap-a.valueGap)[0];
  // Highest confidence (actionScore)
  const topConf = [...sorted].sort((a,b)=>b.actionScore-a.actionScore)[0];

  const cards = [
    { label:"Biggest ADP Edge", value:bigEdge?.name??"-", sub:`+${Math.abs(bigEdge?.valueGap??0)} spots undervalued`, color:"#4ade80", icon:<Zap size={13}/> },
    { label:"Best Sleeper",     value:bestSleeper?.name??"-", sub:`ADP ${bestSleeper?.adp.toFixed(1)} → Model #${bestSleeper?.modelRank}`, color:"#f59e0b", icon:<Flame size={13}/> },
    { label:"Most Overvalued",  value:mostOver?.name??"-", sub:`${mostOver?.valueGap} spots overpriced`, color:"#f87171", icon:<AlertTriangle size={13}/> },
    { label:"Top Confidence",   value:topConf?.name??"-", sub:`${topConf?.actionScore}/100 confidence`, color:"#818cf8", icon:<Star size={13}/> },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cards.map(c => (
        <div key={c.label} className="bg-card border border-border/40 rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
            <span style={{color:c.color}}>{c.icon}</span>{c.label}
          </div>
          <p className="text-sm font-black text-foreground leading-tight truncate">{c.value}</p>
          <p className="text-[10px] text-muted-foreground">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Detail Drawer
// ─────────────────────────────────────────────────────────────────────────────
function PlayerDrawer({player,onClose}:{player:PlayerCard;onClose:()=>void}) {
  const ac = actionColor(player.actionTag);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-background border border-border/50 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl z-10">
        {/* Header */}
        <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/30 p-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black text-foreground">{player.name}</h2>
              <TrendBadge trend={player.trend} adpTrend={player.adpTrend}/>
              <InjuryBadge status={player.injuryStatus} adjusted={player.projAdjusted}/>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{player.position} · {player.team} · {player.sport}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X size={16}/>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Action tag + score */}
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-sm font-black"
                  style={{background:ac.bg,color:ac.text,border:`1px solid ${ac.border}`}}>
              {player.actionTag}
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 rounded-full bg-white/10 w-32 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width:`${player.actionScore}%`,background:ac.text}}/>
                </div>
                <span className="text-sm font-black" style={{color:ac.text}}>{player.actionScore}/100</span>
              </div>
              <p className="text-[10px] text-muted-foreground">PropEdge confidence</p>
            </div>
          </div>

          {/* Fantasy pts — FIRST */}
          <div className="bg-white/[0.04] rounded-xl p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Projected Fantasy Points</p>
            <div className="flex items-end gap-4">
              <div>
                <p className="text-2xl font-black" style={{color: player.fantasyPtsWeekly===0?"#f87171":"#4ade80"}}>
                  {player.fantasyPtsWeekly===0?"OUT":player.fantasyPtsWeekly.toFixed(1)}
                </p>
                <p className="text-[10px] text-muted-foreground">pts this week</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{player.fantasyPtsSeason.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">season total</p>
              </div>
            </div>
            {player.projAdjusted && (
              <p className="text-[10px] text-amber-400 mt-1 font-semibold">⚠ Projection adjusted due to news/injury</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-2 border-t border-border/20 pt-2">{player.projection}</p>
            <div className="flex gap-3 text-[10px] mt-1">
              <span>Ceil: <span className="text-green-400 font-semibold">{player.ceiling}</span></span>
              <span>Floor: <span className="text-red-400 font-semibold">{player.floor}</span></span>
            </div>
          </div>

          {/* Why this score — the key explanation */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Why This Score</p>
            <p className="text-sm text-foreground/90 leading-relaxed border-l-2 border-primary/50 pl-3">{player.reason}</p>
          </div>

          {/* Score breakdown */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Score Breakdown</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                {label:"Consensus",  value:`#${player.consensusRank}`, note:"Expert/ADP rank"},
                {label:"Model",      value:`#${player.modelRank}`,     note:"PropEdge rank"},
                {label:"ADP",        value:player.adp.toFixed(1),      note:"Avg draft pos"},
              ].map(s=>(
                <div key={s.label} className="bg-white/[0.03] rounded-lg p-2 text-center">
                  <p className="text-[9px] text-muted-foreground font-bold uppercase">{s.label}</p>
                  <p className="text-lg font-black text-foreground">{s.value}</p>
                  <p className="text-[9px] text-muted-foreground">{s.note}</p>
                </div>
              ))}
            </div>
            {player.valueGap !== 0 && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                   style={{background:player.valueGap<0?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)"}}>
                {player.valueGap<0?<ArrowUpRight size={12} className="text-green-400"/>:<ArrowDownRight size={12} className="text-red-400"/>}
                <span style={{color:player.valueGap<0?"#4ade80":"#f87171"}} className="font-bold">
                  {player.valueGap<0?`Undervalued by ${Math.abs(player.valueGap)} draft spots`:`Overvalued by ${player.valueGap} draft spots`}
                </span>
              </div>
            )}
          </div>

          {/* Signals */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Key Signals</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Shield size={11} style={{color:riskColor(player.riskLevel)}}/>
                <span className="text-muted-foreground">Risk:</span>
                <span style={{color:riskColor(player.riskLevel)}} className="font-bold">{player.riskLevel.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <BarChart2 size={11} className="text-blue-400"/>
                <span className="text-muted-foreground">Breakout:</span>
                <span className="text-blue-400 font-bold">{player.breakoutProb}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Star size={11} style={{color:gradeColor(player.scheduleGrade)}}/>
                <span className="text-muted-foreground">Schedule:</span>
                <span style={{color:gradeColor(player.scheduleGrade)}} className="font-bold">{player.scheduleGrade}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity size={11} className="text-purple-400"/>
                <span className="text-muted-foreground">ADP trend:</span>
                <span className="font-bold" style={{color:player.adpTrend==="rising"?"#4ade80":player.adpTrend==="falling"?"#f87171":"#94a3b8"}}>
                  {player.adpTrend.toUpperCase()}
                </span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{player.usageNote}</p>
          </div>

          {/* News alerts */}
          {player.newsAlerts && player.newsAlerts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-1"><Newspaper size={9}/> Latest News</p>
              {player.newsAlerts.map((a,i)=>(
                <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
                  <p className="text-[11px] text-amber-300 font-semibold">{a.headline}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{a.source} · {a.status}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compare Tool
// ─────────────────────────────────────────────────────────────────────────────
function CompareTool({players,onClose}:{players:PlayerCard[];onClose:()=>void}) {
  const [a, setA] = useState<PlayerCard|null>(null);
  const [b, setB] = useState<PlayerCard|null>(null);
  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");

  const filtA = players.filter(p=>p.name.toLowerCase().includes(searchA.toLowerCase())||p.team.toLowerCase().includes(searchA.toLowerCase())).slice(0,8);
  const filtB = players.filter(p=>p.name.toLowerCase().includes(searchB.toLowerCase())||p.team.toLowerCase().includes(searchB.toLowerCase())).slice(0,8);

  function compareRow(label:string, aVal:number|string, bVal:number|string, higherBetter=true) {
    const aNum = typeof aVal==="number"?aVal:parseFloat(aVal as string);
    const bNum = typeof bVal==="number"?bVal:parseFloat(bVal as string);
    const aWins = higherBetter ? aNum > bNum : aNum < bNum;
    const tie   = aNum === bNum;
    return (
      <div key={label} className="grid grid-cols-3 gap-2 items-center py-1.5 border-b border-border/10 last:border-0">
        <span className={`text-xs font-bold text-right ${!tie&&aWins?"text-foreground":"text-muted-foreground/60"}`}>{aVal}</span>
        <span className="text-[10px] text-center text-muted-foreground">{label}</span>
        <span className={`text-xs font-bold text-left ${!tie&&!aWins?"text-foreground":"text-muted-foreground/60"}`}>{bVal}</span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-background border border-border/50 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl z-10">
        <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/30 p-4 flex items-center justify-between">
          <h2 className="text-sm font-black text-foreground flex items-center gap-2"><GitCompare size={14} className="text-primary"/>Compare Players</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16}/></button>
        </div>
        <div className="p-4 space-y-4">
          {/* Player selectors */}
          <div className="grid grid-cols-2 gap-3">
            {[
              {which:"A",search:searchA,setSearch:setSearchA,player:a,setPlayer:setA,filt:filtA},
              {which:"B",search:searchB,setSearch:setSearchB,player:b,setPlayer:setB,filt:filtB},
            ].map(({which,search,setSearch,player,setPlayer,filt})=>(
              <div key={which} className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Player {which}</p>
                {player ? (
                  <button onClick={()=>setPlayer(null)}
                    className="w-full text-left rounded-lg border border-primary/30 bg-primary/5 p-2">
                    <p className="text-xs font-bold text-foreground">{player.name}</p>
                    <p className="text-[10px] text-muted-foreground">{player.position} · {player.team}</p>
                  </button>
                ) : (
                  <div className="space-y-1">
                    <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" className="h-7 text-xs"/>
                    {search && filt.map(p=>(
                      <button key={p.id} onClick={()=>{setPlayer(p);setSearch("");}}
                        className="w-full text-left rounded-lg border border-border/20 bg-card p-1.5 hover:bg-white/[0.03]">
                        <p className="text-xs font-semibold text-foreground">{p.name}</p>
                        <p className="text-[9px] text-muted-foreground">{p.position} · {p.team}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Comparison */}
          {a && b && (
            <div className="space-y-3">
              {/* Headers */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs font-black text-primary truncate">{a.name}</p>
                  <InjuryBadge status={a.injuryStatus}/>
                </div>
                <div/>
                <div>
                  <p className="text-xs font-black text-primary truncate">{b.name}</p>
                  <InjuryBadge status={b.injuryStatus}/>
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3 space-y-0">
                {compareRow("Proj Pts/Wk", a.fantasyPtsWeekly, b.fantasyPtsWeekly, true)}
                {compareRow("Action Score", a.actionScore, b.actionScore, true)}
                {compareRow("Model Rank", a.modelRank, b.modelRank, false)}
                {compareRow("ADP", a.adp, b.adp, false)}
                {compareRow("Value Gap", a.valueGap, b.valueGap, false)}
                {compareRow("Breakout %", a.breakoutProb, b.breakoutProb, true)}
                {compareRow("Schedule", a.scheduleGrade, b.scheduleGrade, true)}
              </div>
              {/* Verdict */}
              <div className="bg-white/[0.04] rounded-xl p-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">PropEdge Verdict</p>
                <p className="text-xs text-foreground/90 leading-relaxed">
                  {a.actionScore > b.actionScore
                    ? `${a.name} scores higher on PropEdge's model (${a.actionScore} vs ${b.actionScore}). ${a.reason}`
                    : `${b.name} scores higher on PropEdge's model (${b.actionScore} vs ${a.actionScore}). ${b.reason}`}
                </p>
              </div>
            </div>
          )}
          {(!a || !b) && (
            <p className="text-xs text-muted-foreground text-center py-4">Select two players to compare</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Card — compact row with fantasy pts first
// ─────────────────────────────────────────────────────────────────────────────
function PlayerCard({p, view, onSelect, onCompare, inCompare}:{
  p:PlayerCard; view:SubView; onSelect:(p:PlayerCard)=>void;
  onCompare:(p:PlayerCard)=>void; inCompare:boolean;
}) {
  const ac = actionColor(p.actionTag);
  return (
    <div
      className={`rounded-xl border overflow-hidden cursor-pointer hover:bg-white/[0.02] transition-all ${inCompare?"border-primary/40 bg-primary/5":"border-border/30 bg-card"}`}
      onClick={()=>onSelect(p)}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Rank */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-black"
             style={{background:"rgba(255,255,255,0.05)",color:"var(--muted-foreground)"}}>
          {view==="draft"?`R${p.roundEst}`:`#${p.modelRank}`}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-foreground">{p.name}</span>
            <TrendBadge trend={p.trend} adpTrend={p.adpTrend}/>
            {p.projAdjusted && <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1 rounded">NEWS</span>}
            <InjuryBadge status={p.injuryStatus} adjusted={p.projAdjusted}/>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{p.team}</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{background:"rgba(255,255,255,0.05)",color:"var(--muted-foreground)"}}>
              {p.position}
            </span>
            {view==="draft"&&p.steal&&<span className="text-[9px] font-bold text-green-400 bg-green-400/10 border border-green-400/30 px-1 rounded">STEAL</span>}
            {view==="draft"&&p.reach&&<span className="text-[9px] font-bold text-red-400 bg-red-400/10 border border-red-400/30 px-1 rounded">REACH</span>}
          </div>
        </div>

        {/* Fantasy pts — FIRST */}
        <div className="text-right flex-shrink-0 mr-2">
          <p className="text-base font-black" style={{color:p.fantasyPtsWeekly===0?"#f87171":"#4ade80"}}>
            {p.fantasyPtsWeekly===0?"OUT":p.fantasyPtsWeekly.toFixed(1)}
          </p>
          <p className="text-[9px] text-muted-foreground">pts/wk</p>
        </div>

        {/* Action tag */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black"
                style={{background:ac.bg,color:ac.text,border:`1px solid ${ac.border}`}}>
            {p.actionTag}
          </span>
          <button
            onClick={e=>{e.stopPropagation();onCompare(p);}}
            className="text-[9px] font-semibold text-muted-foreground hover:text-primary transition-colors"
          >
            compare
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort control
// ─────────────────────────────────────────────────────────────────────────────
function SortControl({sort,setSort,count,label}:{sort:SortKey;setSort:(s:SortKey)=>void;count:number;label:string}) {
  const opts: {key:SortKey;label:string}[] = [
    {key:"actionScore",label:"Action Score"},
    {key:"adpEdge",    label:"ADP Edge"},
    {key:"modelRank",  label:"Model Rank"},
    {key:"consensusRank",label:"Consensus"},
    {key:"weeklyProj", label:"Proj Pts"},
  ];
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <p className="text-xs text-muted-foreground">
        <span className="font-bold text-foreground">{count}</span> {label}
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-muted-foreground mr-1">Sort:</span>
        {opts.map(o=>(
          <button key={o.key} onClick={()=>setSort(o.key)}
            className="px-2 py-0.5 rounded text-[10px] font-semibold transition-all"
            style={{
              background:sort===o.key?"var(--primary)":"rgba(255,255,255,0.04)",
              color:sort===o.key?"#000":"var(--muted-foreground)",
              border:sort===o.key?"1px solid transparent":"1px solid rgba(255,255,255,0.08)",
            }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function sortPlayers(players: PlayerCard[], sort: SortKey): PlayerCard[] {
  return [...players].sort((a, b) => {
    switch(sort) {
      case "actionScore":  return b.actionScore - a.actionScore;
      case "adpEdge":      return a.valueGap - b.valueGap; // most negative = most undervalued
      case "modelRank":    return a.modelRank - b.modelRank;
      case "consensusRank":return a.consensusRank - b.consensusRank;
      case "weeklyProj":   return (b.fantasyPtsWeekly||0) - (a.fantasyPtsWeekly||0);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Draft Simulator
// ─────────────────────────────────────────────────────────────────────────────
type CpuStrategy = "adp" | "best_available" | "positional_need" | "bpa_plus_news";

interface DraftSlot { pick:number;round:number;slot:number;manager:string;player:PlayerCard|null;isUser:boolean; }
interface DraftState { picks:DraftSlot[];available:PlayerCard[];currentPick:number;userSlot:number;numTeams:number;numRounds:number;started:boolean;complete:boolean;myRoster:PlayerCard[]; }

function buildInitialDraft(numTeams:number, numRounds:number, userSlot:number): DraftSlot[] {
  const picks: DraftSlot[] = [];
  for (let round = 1; round <= numRounds; round++) {
    const reversed = round%2===0;
    for (let i = 0; i < numTeams; i++) {
      const slot = reversed ? numTeams-i : i+1;
      picks.push({ pick:(round-1)*numTeams+(i+1), round, slot, manager:slot===userSlot?"You":`Team ${slot}`, player:null, isUser:slot===userSlot });
    }
  }
  return picks;
}

function cpuPick(available:PlayerCard[], strategy:CpuStrategy, positionsFilled:Record<string,number>): PlayerCard {
  const sorted = [...available].sort((a,b)=>a.modelRank-b.modelRank);
  if (strategy==="bpa_plus_news") return sorted.filter(p=>!p.projAdjusted&&!["Out","10-Day IL","IL"].includes(p.injuryStatus||""))[0]??sorted[0];
  if (strategy==="positional_need") {
    const rbs=sorted.filter(p=>p.position==="RB"), wrs=sorted.filter(p=>p.position==="WR"), qbs=sorted.filter(p=>p.position==="QB");
    if ((positionsFilled["QB"]||0)<1&&qbs.length>0) return qbs[0];
    if ((positionsFilled["RB"]||0)<2&&rbs.length>0) return rbs[0];
    if ((positionsFilled["WR"]||0)<2&&wrs.length>0) return wrs[0];
  }
  return sorted[0];
}

function DraftRoomView({players}:{players:PlayerCard[]}) {
  const [format, setFormat] = useState<FormatTab>("ppr");
  const [numTeams, setNumTeams] = useState(12);
  const [numRounds, setNumRounds] = useState(15);
  const [userSlot, setUserSlot] = useState(6);
  const [cpuStrategy, setCpuStrategy] = useState<CpuStrategy>("bpa_plus_news");
  const [draftState, setDraftState] = useState<DraftState|null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard|null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("modelRank");

  function runCpuPicks(state: DraftState): DraftState {
    let s = {...state, picks:[...state.picks], available:[...state.available], myRoster:[...state.myRoster]};
    while (s.currentPick <= s.picks.length) {
      const slot = s.picks[s.currentPick-1];
      if (!slot || slot.isUser) break;
      const positionsFilled: Record<string,number> = {};
      s.picks.filter(p=>p.player&&p.slot===slot.slot).forEach(p=>{ const pos=p.player!.position; positionsFilled[pos]=(positionsFilled[pos]||0)+1; });
      const pick = cpuPick(s.available, cpuStrategy, positionsFilled);
      s.picks[s.currentPick-1] = {...slot, player:pick};
      s.available = s.available.filter(p=>p.id!==pick.id);
      s.currentPick++;
    }
    if (s.currentPick > s.picks.length) s.complete = true;
    return s;
  }

  function startDraft() {
    const sortedPlayers = sortPlayers(players, "modelRank");
    const picks = buildInitialDraft(numTeams, numRounds, userSlot);
    setDraftState(runCpuPicks({picks, available:sortedPlayers, currentPick:1, userSlot, numTeams, numRounds, started:true, complete:false, myRoster:[]}));
  }

  function makeUserPick(player: PlayerCard) {
    if (!draftState) return;
    const slot = draftState.picks[draftState.currentPick-1];
    if (!slot?.isUser) return;
    const updatedPicks = [...draftState.picks];
    updatedPicks[draftState.currentPick-1] = {...slot, player};
    setDraftState(runCpuPicks({...draftState, picks:updatedPicks, available:draftState.available.filter(p=>p.id!==player.id), currentPick:draftState.currentPick+1, myRoster:[...draftState.myRoster, player]}));
  }

  const steals = sortPlayers(players,"adpEdge").filter(p=>p.steal).slice(0,5);
  const reaches = players.filter(p=>p.reach).slice(0,5);

  if (!draftState) {
    return (
      <div className="space-y-4">
        <KpiStrip players={players}/>

        {/* Setup */}
        <div className="bg-card border border-border/40 rounded-xl p-4 space-y-4">
          <p className="text-sm font-bold text-foreground flex items-center gap-2"><Play size={14} className="text-primary"/>Mock Draft Setup</p>
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">League Format</p>
            <div className="flex flex-wrap gap-1.5">
              {(["standard","ppr","half_ppr","superflex","dynasty","bestball"] as FormatTab[]).map(f=>(
                <button key={f} onClick={()=>setFormat(f)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
                  style={{background:format===f?"#facc15":"rgba(255,255,255,0.04)",color:format===f?"#000":"var(--muted-foreground)",border:format===f?"1px solid #facc15":"1px solid rgba(255,255,255,0.08)"}}>
                  {({standard:"Standard",ppr:"PPR",half_ppr:"Half-PPR",superflex:"Superflex",dynasty:"Dynasty",bestball:"Best Ball"})[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              {label:"Teams",  opts:[8,10,12,14], val:numTeams,  set:setNumTeams},
              {label:"Rounds", opts:[10,12,15,18], val:numRounds, set:setNumRounds},
            ].map(({label,opts,val,set})=>(
              <div key={label} className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">{label}</p>
                <div className="flex gap-1 flex-wrap">
                  {opts.map(n=>(
                    <button key={n} onClick={()=>set(n)}
                      className="px-2 py-0.5 rounded text-[11px] font-semibold transition-all"
                      style={{background:val===n?"var(--primary)":"rgba(255,255,255,0.04)",color:val===n?"#000":"var(--muted-foreground)",border:val===n?"1px solid transparent":"1px solid rgba(255,255,255,0.08)"}}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Your Slot</p>
              <div className="flex gap-1 flex-wrap max-h-14 overflow-y-auto">
                {Array.from({length:numTeams},(_,i)=>i+1).map(n=>(
                  <button key={n} onClick={()=>setUserSlot(n)}
                    className="px-2 py-0.5 rounded text-[11px] font-semibold transition-all"
                    style={{background:userSlot===n?"var(--primary)":"rgba(255,255,255,0.04)",color:userSlot===n?"#000":"var(--muted-foreground)",border:userSlot===n?"1px solid transparent":"1px solid rgba(255,255,255,0.08)"}}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">CPU Strategy</p>
            <div className="flex flex-wrap gap-1.5">
              {(["adp","best_available","positional_need","bpa_plus_news"] as CpuStrategy[]).map(s=>(
                <button key={s} onClick={()=>setCpuStrategy(s)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
                  style={{background:cpuStrategy===s?"var(--primary)":"rgba(255,255,255,0.04)",color:cpuStrategy===s?"#000":"var(--muted-foreground)",border:cpuStrategy===s?"1px solid transparent":"1px solid rgba(255,255,255,0.08)"}}>
                  {({adp:"ADP Order",best_available:"Best Available",positional_need:"Positional Need",bpa_plus_news:"BPA + News-Aware"})[s]}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">BPA+News: CPU skips injured players — simulates a sharp room</p>
          </div>
          <button onClick={startDraft}
            className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            style={{background:"var(--primary)",color:"#000"}}>
            <Play size={14}/> Start Mock Draft ({numTeams} teams · {numRounds} rounds · Pick #{userSlot})
          </button>
        </div>

        {/* Steal / Reach pre-draft callouts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {steals.length>0&&(
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-green-400 uppercase tracking-wide flex items-center gap-1.5"><Zap size={11}/>Steals Available</p>
              {steals.map(p=>(
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                  <span className="text-green-400 font-bold">ADP {p.adp.toFixed(1)} → #{p.modelRank}</span>
                </div>
              ))}
            </div>
          )}
          {reaches.length>0&&(
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide flex items-center gap-1.5"><AlertTriangle size={11}/>Reaches — Skip</p>
              {reaches.map(p=>(
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                  <span className="text-red-400 font-bold">ADP {p.adp.toFixed(1)} → #{p.modelRank}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Full pre-draft board */}
        <SortControl sort={sortKey} setSort={setSortKey} count={players.length} label="players sorted by PropEdge model"/>
        <div className="space-y-1.5">
          {sortPlayers(players,sortKey).map(p=>(
            <PlayerCard key={p.id} p={p} view="draft" onSelect={setSelectedPlayer} onCompare={()=>{}} inCompare={false}/>
          ))}
        </div>
        {selectedPlayer&&<PlayerDrawer player={selectedPlayer} onClose={()=>setSelectedPlayer(null)}/>}
      </div>
    );
  }

  // ── Active Draft ───────────────────────────────────────────────────────
  const currentSlot = draftState.picks[draftState.currentPick-1];
  const isUserTurn  = currentSlot?.isUser;
  const positions   = ["ALL","QB","RB","WR","TE","K","DST","SP","RP","OF","C","F","D","G"];

  const availableFiltered = sortPlayers(draftState.available, sortKey).filter(p=>{
    const matchPos = posFilter==="ALL"||p.position===posFilter;
    const matchQ   = !searchQ||p.name.toLowerCase().includes(searchQ.toLowerCase())||p.team.toLowerCase().includes(searchQ.toLowerCase());
    return matchPos&&matchQ;
  });

  return (
    <div className="space-y-3">
      {/* Draft status bar */}
      <div className="bg-card border border-border/40 rounded-xl p-3 flex items-center justify-between gap-2 flex-wrap">
        <div>
          {draftState.complete ? (
            <p className="text-sm font-black text-green-400">Draft Complete!</p>
          ) : isUserTurn ? (
            <p className="text-xs font-black text-primary animate-pulse">YOUR PICK — Round {currentSlot.round}, Pick #{currentSlot.pick}</p>
          ) : (
            <p className="text-xs text-muted-foreground">CPU Picking — R{currentSlot?.round} P{currentSlot?.pick} · {currentSlot?.manager}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{draftState.available.length} players available</p>
        </div>
        <button onClick={()=>setDraftState(null)}
          className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-border/40 text-muted-foreground hover:text-foreground">
          <RotateCcw size={12}/> Reset
        </button>
      </div>

      {draftState.complete ? (
        <div className="space-y-3">
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-green-400 flex items-center gap-1.5"><Trophy size={12}/>Your Draft — {draftState.myRoster.length} picks</p>
            {draftState.myRoster.map((p,i)=>(
              <div key={p.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-5">R{i+1}</span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-muted-foreground">{p.position}</span>
                  <InjuryBadge status={p.injuryStatus}/>
                </div>
                <span className="text-green-400 font-bold">{p.fantasyPtsWeekly===0?"OUT":`${p.fantasyPtsWeekly.toFixed(1)} pts/wk`}</span>
              </div>
            ))}
          </div>
          <button onClick={()=>setDraftState(null)}
            className="w-full py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
            style={{background:"var(--primary)",color:"#000"}}>
            <RotateCcw size={14}/> New Mock Draft
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">Available</p>
              {isUserTurn && <span className="text-[10px] text-primary font-bold animate-pulse">← tap to pick</span>}
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/>
              <Input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search…" className="pl-8 h-7 text-xs"/>
            </div>
            <div className="flex flex-wrap gap-1">
              {positions.map(pos=>(
                <button key={pos} onClick={()=>setPosFilter(pos)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                  style={{background:posFilter===pos?"var(--primary)":"rgba(255,255,255,0.04)",color:posFilter===pos?"#000":"var(--muted-foreground)",border:posFilter===pos?"1px solid transparent":"1px solid rgba(255,255,255,0.08)"}}>
                  {pos}
                </button>
              ))}
            </div>
            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
              {availableFiltered.map(p=>{
                const ac=actionColor(p.actionTag);
                return (
                  <button key={p.id} onClick={()=>isUserTurn&&makeUserPick(p)} disabled={!isUserTurn}
                    className="w-full text-left rounded-lg border border-border/20 p-2 transition-all hover:bg-white/[0.03] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{background:"var(--card)"}}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold">{p.name}</span>
                          <span className="text-[10px] text-muted-foreground">{p.position}</span>
                          {p.steal&&<span className="text-[9px] text-green-400 font-bold">STEAL</span>}
                          <InjuryBadge status={p.injuryStatus}/>
                        </div>
                        <p className="text-[10px] text-muted-foreground">#{p.modelRank} model · ADP {p.adp.toFixed(1)} · <span className="text-green-400 font-semibold">{p.fantasyPtsWeekly===0?"OUT":`${p.fantasyPtsWeekly.toFixed(1)} pts/wk`}</span></p>
                      </div>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{background:ac.bg,color:ac.text}}>{p.actionTag}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-foreground">My Roster ({draftState.myRoster.length})</p>
            {draftState.myRoster.length===0?(
              <p className="text-xs text-muted-foreground">Make your first pick →</p>
            ):(
              <div className="space-y-1">
                {draftState.myRoster.map((p,i)=>{
                  const ac=actionColor(p.actionTag);
                  return (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border/20 p-2 bg-card">
                      <span className="text-[10px] font-bold text-muted-foreground w-5">R{i+1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold">{p.name}</span>
                          <span className="text-[10px] text-muted-foreground">{p.position}</span>
                          <InjuryBadge status={p.injuryStatus}/>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{p.team} · <span className="text-green-400">{p.fantasyPtsWeekly===0?"OUT":`${p.fantasyPtsWeekly.toFixed(1)} pts/wk`}</span></p>
                      </div>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{background:ac.bg,color:ac.text}}>{p.actionTag}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="space-y-1 mt-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Recent Picks</p>
              {draftState.picks.filter(s=>s.player!==null).slice(-6).reverse().map(s=>(
                <div key={s.pick} className="flex items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground w-12">R{s.round}P{s.pick}</span>
                  <span className={`font-semibold ${s.isUser?"text-primary":"text-foreground"}`}>{s.manager}</span>
                  <span className="text-muted-foreground truncate">{s.player?.name} ({s.player?.position})</span>
                  <InjuryBadge status={s.player?.injuryStatus||null}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preseason Lab
// ─────────────────────────────────────────────────────────────────────────────
function PreseasonLabView({players,onSelect,onCompare,compareSet}:{
  players:PlayerCard[];onSelect:(p:PlayerCard)=>void;onCompare:(p:PlayerCard)=>void;compareSet:Set<string>;
}) {
  const [sort, setSort] = useState<SortKey>("modelRank");
  const sorted = sortPlayers(players, sort);

  const tiers:[string,[number,number],string][] = [
    ["Tier 1 — Elite",          [1,  5],  "#f59e0b"],
    ["Tier 2 — Studs",          [6,  15], "#4ade80"],
    ["Tier 3 — Solid Starters", [16, 30], "#60a5fa"],
    ["Tier 4 — Deep Value",     [31, 999],"#94a3b8"],
  ];

  const injured  = sorted.filter(p=>p.injuryStatus&&!["Activated"].includes(p.injuryStatus)).slice(0,6);
  const sleepers = sorted.filter(p=>p.actionTag==="SLEEPER").slice(0,4);
  const busts    = sorted.filter(p=>["AVOID","BUST"].includes(p.actionTag)).slice(0,4);

  return (
    <div className="space-y-4">
      <KpiStrip players={players}/>

      {injured.length>0&&(
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1.5"><Siren size={11}/>Injury Watch — Fantasy Impact</p>
          {injured.map(p=>(
            <div key={p.id} className="flex items-center justify-between text-xs gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted-foreground text-[10px]">{p.position} · {p.team}</span>
              </div>
              <InjuryBadge status={p.injuryStatus} adjusted={p.projAdjusted}/>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sleepers.length>0&&(
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 space-y-1.5">
            <p className="text-[10px] font-bold text-green-400 uppercase flex items-center gap-1.5"><Zap size={11}/>Top Sleepers</p>
            {sleepers.map(p=>(
              <div key={p.id} className="flex justify-between text-xs">
                <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                <span className="text-green-400 font-bold">{p.fantasyPtsWeekly.toFixed(1)} pts/wk</span>
              </div>
            ))}
          </div>
        )}
        {busts.length>0&&(
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1.5">
            <p className="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1.5"><AlertTriangle size={11}/>Bust Watch</p>
            {busts.map(p=>(
              <div key={p.id} className="flex justify-between text-xs">
                <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                <span className="text-red-400 font-bold">ADP {p.adp.toFixed(1)} → #{p.modelRank}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {tiers.map(([label, range, color])=>{
        const tierPlayers = sorted.filter(p=>p.modelRank>=range[0]&&p.modelRank<=range[1]);
        if (!tierPlayers.length) return null;
        return (
          <div key={label} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1" style={{background:`${color}40`}}/>
              <span className="text-[10px] font-black uppercase tracking-wide px-2" style={{color}}>{label}</span>
              <div className="h-px flex-1" style={{background:`${color}40`}}/>
            </div>
            <SortControl sort={sort} setSort={setSort} count={tierPlayers.length} label={`players in ${label.split("—")[0].trim()}`}/>
            {sortPlayers(tierPlayers,sort).map(p=>(
              <PlayerCard key={p.id} p={p} view="preseason" onSelect={onSelect} onCompare={onCompare} inCompare={compareSet.has(p.id)}/>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Season Tools
// ─────────────────────────────────────────────────────────────────────────────
type InSeasonMode = "start_sit" | "waiver" | "trade" | "projections";

function InSeasonView({players,onSelect,onCompare,compareSet}:{
  players:PlayerCard[];onSelect:(p:PlayerCard)=>void;onCompare:(p:PlayerCard)=>void;compareSet:Set<string>;
}) {
  const [mode, setMode] = useState<InSeasonMode>("start_sit");
  const [sort, setSort] = useState<SortKey>("weeklyProj");

  const starts  = sortPlayers(players.filter(p=>p.actionScore>=70&&!["SIT","AVOID"].includes(p.actionTag)),sort);
  const sits    = sortPlayers(players.filter(p=>p.actionScore<50||["SIT","AVOID"].includes(p.actionTag)),sort);
  const adds    = sortPlayers(players.filter(p=>p.valueGap<=-3&&p.actionScore>=60),sort);
  const sells   = sortPlayers(players.filter(p=>["SELL","AVOID"].includes(p.actionTag)),sort);
  const injured = players.filter(p=>p.injuryStatus&&!["Activated"].includes(p.injuryStatus));

  const tabs: {key:InSeasonMode;label:string}[] = [
    {key:"start_sit",   label:"Start / Sit"},
    {key:"waiver",      label:"Waiver Wire"},
    {key:"trade",       label:"Trade"},
    {key:"projections", label:"Projections"},
  ];

  return (
    <div className="space-y-4">
      <KpiStrip players={players}/>

      {injured.length>0&&(
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1.5"><Siren size={11}/>Active Injury Impact</p>
          {injured.slice(0,5).map(p=>(
            <div key={p.id} className="flex items-center justify-between text-xs gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted-foreground">{p.position} · {p.team}</span>
              </div>
              <div className="flex items-center gap-2">
                <InjuryBadge status={p.injuryStatus} adjusted={p.projAdjusted}/>
                {p.newsAlerts?.[0]&&<span className="text-[9px] text-muted-foreground truncate max-w-[180px]">{p.newsAlerts[0].headline}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setMode(t.key)}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={{background:mode===t.key?"var(--primary)":"rgba(255,255,255,0.04)",color:mode===t.key?"#000":"var(--muted-foreground)",border:mode===t.key?"1px solid transparent":"1px solid rgba(255,255,255,0.08)"}}>
            {t.label}
          </button>
        ))}
      </div>

      {mode==="start_sit"&&(
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {starts.length>0&&(
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-green-400 uppercase flex items-center gap-1.5"><CheckCircle size={11}/>Start — Confidence Plays</p>
                {starts.slice(0,6).map(p=>(
                  <div key={p.id} className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{p.name}</span>
                      <InjuryBadge status={p.injuryStatus}/>
                    </div>
                    <span className="text-green-400 font-bold">{p.fantasyPtsWeekly===0?"OUT":`${p.fantasyPtsWeekly.toFixed(1)} pts`}</span>
                  </div>
                ))}
              </div>
            )}
            {sits.length>0&&(
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1.5"><XCircle size={11}/>Sit — Fade This Week</p>
                {sits.slice(0,6).map(p=>(
                  <div key={p.id} className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{p.name}</span>
                      <InjuryBadge status={p.injuryStatus}/>
                    </div>
                    <span className="text-red-400 font-bold">{p.actionScore}/100</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <SortControl sort={sort} setSort={setSort} count={players.length} label="players ranked for start/sit"/>
          <div className="space-y-1.5">{starts.map(p=><PlayerCard key={p.id} p={p} view="inseason" onSelect={onSelect} onCompare={onCompare} inCompare={compareSet.has(p.id)}/>)}</div>
        </div>
      )}

      {mode==="waiver"&&(
        <div className="space-y-3">
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-1.5"><Package size={11}/>Add Now — Waiver Priority</p>
            {adds.slice(0,6).map(p=>(
              <div key={p.id} className="flex justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                  <InjuryBadge status={p.injuryStatus}/>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 font-bold">{p.fantasyPtsWeekly.toFixed(1)} pts/wk</span>
                  <span className="text-green-400 text-[10px]">+{Math.abs(p.valueGap)} spots</span>
                </div>
              </div>
            ))}
          </div>
          <SortControl sort={sort} setSort={setSort} count={adds.length} label="waiver targets"/>
          <div className="space-y-1.5">{adds.map(p=><PlayerCard key={p.id} p={p} view="inseason" onSelect={onSelect} onCompare={onCompare} inCompare={compareSet.has(p.id)}/>)}</div>
        </div>
      )}

      {mode==="trade"&&(
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-purple-400 uppercase flex items-center gap-1.5"><Shuffle size={11}/>Buy Low</p>
              {sortPlayers(players.filter(p=>p.steal),sort).slice(0,5).map(p=>(
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                  <span className="text-purple-400 font-bold">{p.fantasyPtsWeekly.toFixed(1)} pts/wk</span>
                </div>
              ))}
            </div>
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1.5"><ArrowUpRight size={11}/>Sell High</p>
              {sells.slice(0,5).map(p=>(
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="font-semibold">{p.name} <span className="text-muted-foreground">({p.position})</span></span>
                  <span className="text-red-400 font-bold">ADP {p.adp.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
          <SortControl sort={sort} setSort={setSort} count={players.length} label="players on trade board"/>
          <div className="space-y-1.5">{sortPlayers(players.filter(p=>p.steal||["SELL","AVOID","TRADE FOR"].includes(p.actionTag)),sort).map(p=>(
            <PlayerCard key={p.id} p={p} view="inseason" onSelect={onSelect} onCompare={onCompare} inCompare={compareSet.has(p.id)}/>
          ))}</div>
        </div>
      )}

      {mode==="projections"&&(
        <div className="space-y-2">
          <SortControl sort={sort} setSort={setSortKey=>setSort(setSortKey)} count={players.length} label="players by projections"/>
          <div className="space-y-1.5">
            {sortPlayers(players,"weeklyProj").map(p=>(
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border/20 p-2.5 bg-card cursor-pointer hover:bg-white/[0.02]"
                   onClick={()=>onSelect(p)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.position} · {p.team}</span>
                    <TrendBadge trend={p.trend} adpTrend={p.adpTrend}/>
                    {p.projAdjusted&&<span className="text-amber-400 text-[9px] font-bold">⚠ ADJ</span>}
                    <InjuryBadge status={p.injuryStatus}/>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p.projection}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-black" style={{color:p.fantasyPtsWeekly===0?"#f87171":"#4ade80"}}>
                    {p.fantasyPtsWeekly===0?"OUT":p.fantasyPtsWeekly.toFixed(1)}
                  </p>
                  <p className="text-[9px] text-muted-foreground">pts/wk</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Fantasy Component
// ─────────────────────────────────────────────────────────────────────────────
const SUB_VIEWS = [
  { id:"preseason" as SubView, label:"Preseason Lab",  emoji:"🔬", desc:"Tiers, rankings, sleepers & busts" },
  { id:"draft"     as SubView, label:"Draft Room",     emoji:"🎯", desc:"Mock draft simulator, ADP edge" },
  { id:"inseason"  as SubView, label:"In-Season",      emoji:"📊", desc:"Start/sit, waiver, trade, projections" },
];

export default function Fantasy() {
  const defaultSport = getMostActiveSport();
  const defaultPhase = detectSportPhase(defaultSport).phase;

  const [sport,    setSport]    = useState<SportTab>(defaultSport);
  const [subView,  setSubView]  = useState<SubView>(defaultPhase);
  const [searchQ,  setSearchQ]  = useState("");
  const [posFilter,setPosFilter]= useState<PositionF>("ALL");
  const [players,  setPlayers]  = useState<PlayerCard[]>(PLAYERS);
  const [injuryLastFetch, setInjuryLastFetch] = useState<Date|null>(null);
  const [injuryLoading,   setInjuryLoading]   = useState(false);
  // Player detail drawer
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard|null>(null);
  // Compare tool
  const [showCompare, setShowCompare] = useState(false);
  const [compareQueue, setCompareQueue] = useState<PlayerCard[]>([]);

  useEffect(() => {
    const active = sport==="ALL" ? getMostActiveSport() : sport;
    setSubView(detectSportPhase(active).phase);
    setPosFilter("ALL");
  }, [sport]);

  const fetchInjuries = useCallback(async () => {
    setInjuryLoading(true);
    try {
      const injuryMap = await fetchAllInjuries();
      setPlayers(applyInjuryData(PLAYERS, injuryMap));
      setInjuryLastFetch(new Date());
    } catch(_) {}
    finally { setInjuryLoading(false); }
  }, []);

  useEffect(() => {
    fetchInjuries();
    const t = setInterval(fetchInjuries, 15*60*1000);
    return () => clearInterval(t);
  }, [fetchInjuries]);

  // Position options per sport
  const positionsBySport: Record<SportTab, PositionF[]> = {
    ALL: ["ALL","QB","RB","WR","TE","SP","RP","OF","C","1B","2B","3B","SS","F","D","G"],
    NFL: ["ALL","QB","RB","WR","TE","K","DST"],
    NBA: ["ALL","G","F","C"],
    MLB: ["ALL","SP","RP","OF","1B","2B","3B","SS","C"],
    NHL: ["ALL","F","D","G"],
  };
  const positions = positionsBySport[sport];

  const filtered = useMemo(()=>players.filter(p=>{
    const matchSport = sport==="ALL"||p.sport===sport;
    const matchPos   = posFilter==="ALL"||p.position===posFilter;
    const matchQ     = !searchQ||p.name.toLowerCase().includes(searchQ.toLowerCase())||p.team.toLowerCase().includes(searchQ.toLowerCase());
    return matchSport&&matchPos&&matchQ;
  }), [players, sport, posFilter, searchQ]);

  const ph = detectSportPhase(sport==="ALL" ? getMostActiveSport() : sport);
  const injuredCount = players.filter(p=>(sport==="ALL"||p.sport===sport)&&p.injuryStatus&&!["Activated"].includes(p.injuryStatus)).length;

  function handleCompare(p: PlayerCard) {
    setCompareQueue(prev=>{
      const exists = prev.find(x=>x.id===p.id);
      if (exists) return prev.filter(x=>x.id!==p.id);
      return [...prev.slice(-1), p]; // keep last 2
    });
    setShowCompare(true);
  }

  const compareSet = new Set(compareQueue.map(p=>p.id));

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-black tracking-tight text-foreground">Fantasy Engine</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length} players · news-adjusted projections
              {injuryLoading&&<span className="ml-2 text-amber-400 animate-pulse">↻ loading news…</span>}
              {!injuryLoading&&injuryLastFetch&&<span className="ml-2 text-green-400">✓ ESPN {injuryLastFetch.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setShowCompare(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/40 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              <GitCompare size={12}/> Compare
            </button>
            <button onClick={fetchInjuries} disabled={injuryLoading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/40 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={injuryLoading?"animate-spin":""}/> News
            </button>
          </div>
        </div>

        {/* Phase banner */}
        <div className="rounded-xl px-3 py-2.5 text-xs flex items-center gap-2 flex-wrap"
             style={{
               background:ph.phase==="inseason"?"rgba(74,222,128,0.08)":ph.phase==="draft"?"rgba(245,158,11,0.08)":"rgba(148,163,184,0.06)",
               border:`1px solid ${ph.phase==="inseason"?"rgba(74,222,128,0.25)":ph.phase==="draft"?"rgba(245,158,11,0.25)":"rgba(148,163,184,0.15)"}`,
             }}>
          <span className="font-black" style={{color:ph.phase==="inseason"?"#4ade80":ph.phase==="draft"?"#f59e0b":"#94a3b8"}}>
            {ph.label.toUpperCase()}
          </span>
          {ph.daysUntilNext!==null&&<span className="text-muted-foreground">{ph.daysUntilNext}d until {ph.nextEvent}</span>}
          {injuredCount>0&&<span className="ml-auto text-amber-400 font-bold flex items-center gap-1"><AlertTriangle size={11}/>{injuredCount} injury alerts</span>}
        </div>

        {/* ── Grouped Filter Bar ── */}
        <div className="space-y-2.5">
          {/* Sport group */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground uppercase w-12 flex-shrink-0">Sport</span>
            <div className="flex gap-1.5 flex-wrap">
              {(["ALL","NFL","NBA","MLB","NHL"] as SportTab[]).map(s=>{
                const sph = s==="ALL"?detectSportPhase(getMostActiveSport()):detectSportPhase(s);
                const badge = sph.phase==="inseason"?{label:"IN SEASON",color:"#4ade80"}:sph.phase==="draft"?{label:"DRAFT",color:"#f59e0b"}:null;
                return (
                  <button key={s} onClick={()=>setSport(s)}
                    className="px-2.5 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1"
                    style={{background:sport===s?"#facc15":"rgba(255,255,255,0.04)",color:sport===s?"#000":"var(--muted-foreground)",border:sport===s?"1px solid #facc15":"1px solid rgba(255,255,255,0.08)",boxShadow:sport===s?"0 0 8px #facc1580":"none"}}>
                    {s}
                    {badge&&s!=="ALL"&&(
                      <span className="text-[8px] font-black px-1 rounded" style={{background:`${badge.color}25`,color:badge.color}}>{badge.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Position group */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground uppercase w-12 flex-shrink-0">Pos</span>
            <div className="flex gap-1 flex-wrap">
              {positions.map(pos=>(
                <button key={pos} onClick={()=>setPosFilter(pos as PositionF)}
                  className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
                  style={{background:posFilter===pos?"var(--primary)":"rgba(255,255,255,0.04)",color:posFilter===pos?"#000":"var(--muted-foreground)",border:posFilter===pos?"1px solid transparent":"1px solid rgba(255,255,255,0.08)"}}>
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/>
            <Input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search player or team…" className="pl-8 h-8 text-xs"/>
          </div>
        </div>

        {/* Sub-view tabs */}
        <div className="grid grid-cols-3 gap-2">
          {SUB_VIEWS.map(sv=>(
            <button key={sv.id} onClick={()=>setSubView(sv.id)}
              className="rounded-xl p-2.5 text-left transition-all"
              style={{
                background:subView===sv.id?"rgba(var(--primary-rgb),0.12)":"rgba(255,255,255,0.02)",
                border:subView===sv.id?"1px solid rgba(var(--primary-rgb),0.4)":"1px solid rgba(255,255,255,0.06)",
              }}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base">{sv.emoji}</span>
                {subView===sv.id&&<span className="text-[8px] font-black px-1.5 py-0.5 rounded" style={{background:"var(--primary)",color:"#000"}}>NOW</span>}
              </div>
              <p className="text-[11px] font-bold" style={{color:subView===sv.id?"var(--primary)":"var(--muted-foreground)"}}>{sv.label}</p>
              <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 hidden sm:block">{sv.desc}</p>
            </button>
          ))}
        </div>

        {/* ── One active content area at a time ── */}
        {subView==="preseason"&&(
          <PreseasonLabView players={filtered} onSelect={setSelectedPlayer} onCompare={handleCompare} compareSet={compareSet}/>
        )}
        {subView==="draft"&&(
          <DraftRoomView players={filtered}/>
        )}
        {subView==="inseason"&&(
          <InSeasonView players={filtered} onSelect={setSelectedPlayer} onCompare={handleCompare} compareSet={compareSet}/>
        )}

        {/* Player detail drawer */}
        {selectedPlayer&&<PlayerDrawer player={selectedPlayer} onClose={()=>setSelectedPlayer(null)}/>}

        {/* Compare tool */}
        {showCompare&&<CompareTool players={filtered} onClose={()=>setShowCompare(false)}/>}

      </div>
    </div>
  );
}
