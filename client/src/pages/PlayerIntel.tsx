import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, User, BarChart2, TrendingUp, ChevronDown, ChevronUp,
  RefreshCw, Target, Zap, Activity, Filter, X, MapPin, Users,
  Calendar, ArrowUp, ArrowDown, Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sport = "All" | "MLB" | "NBA" | "NFL" | "NHL";
type Tab = "overview" | "matchups" | "park" | "deepdive";

interface PlayerSearchResult {
  espnId: string;
  name: string;
  team: string;
  teamAbbr: string;
  position: string;
  sport: "MLB" | "NBA" | "NFL" | "NHL";
  headshotUrl?: string;
}

interface PlayerData {
  espnId: string;
  name: string;
  team: string;
  teamAbbr: string;
  position: string;
  sport: "MLB" | "NBA" | "NFL" | "NHL";
  headshotUrl?: string;
  headshot?: string;
  season?: Record<string, string | number>;
  gamelog?: GameLogEntry[];
  steamer?: Record<string, string | number>;
  statcast?: Record<string, string | number>;
  splits?: { home: Record<string, string | number>; away: Record<string, string | number> };
  avg30?: number;
  avg14?: number;
  mlbamId?: string | null;
}

interface GameLogEntry {
  date_game?: string;
  date?: string;
  opp?: string;
  H?: string | number;
  AB?: string | number;
  HR?: string | number;
  RBI?: string | number;
  R?: string | number;
  PTS?: string | number;
  REB?: string | number;
  AST?: string | number;
  MIN?: string | number;
  G?: string | number;
  A?: string | number;
  "TOI"?: string | number;
  "+/-"?: string | number;
  CMP?: string | number;
  YDS?: string | number;
  TD?: string | number;
  INT?: string | number;
  CAR?: string | number;
  REC?: string | number;
  RecYDS?: string | number;
  TGTS?: string | number;
  [key: string]: string | number | undefined;
}

interface BvPData {
  seasonBvP?: Record<string, string | number>;
  careerBvP?: Record<string, string | number>;
  signal?: "strong" | "struggles" | "neutral";
}

interface VsTeamData {
  seasonStats?: Record<string, string | number>;
  careerStats?: Record<string, string | number>;
  recentGames?: GameLogEntry[];
}

interface ParkSplitData {
  home?: Record<string, string | number>;
  away?: Record<string, string | number>;
  venues?: Array<Record<string, string | number | null>>;
  parkFactor?: { hit: number; hr: number; name: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPORTS_TABS: Sport[] = ["All", "MLB", "NBA", "NFL", "NHL"];
const DETAIL_TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "matchups", label: "Matchups" },
  { key: "park", label: "Park / Venue" },
  { key: "deepdive", label: "Deep Dive" },
];

const MLB_PARKS = [
  { label: "Yankee Stadium", value: "yankee-stadium" },
  { label: "Fenway Park", value: "fenway-park" },
  { label: "Wrigley Field", value: "wrigley-field" },
  { label: "Dodger Stadium", value: "dodger-stadium" },
  { label: "Coors Field", value: "coors-field" },
  { label: "Oracle Park", value: "oracle-park" },
];

const CARD_STYLE: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(19,35,58,0.10)",
  borderRadius: "1rem",
  boxShadow: "0 2px 12px rgba(19,35,58,0.06)",
  padding: "1.25rem",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  highlight,
  subtext,
  danger,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  subtext?: string;
  danger?: boolean;
}) {
  const bg = danger
    ? "rgba(239,68,68,0.08)"
    : highlight
    ? "rgba(34,197,94,0.08)"
    : "rgba(19,35,58,0.04)";
  const border = danger
    ? "rgba(239,68,68,0.25)"
    : highlight
    ? "rgba(34,197,94,0.25)"
    : "rgba(19,35,58,0.10)";
  const color = danger ? "#ef4444" : highlight ? "#22c55e" : "#131A24";

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "0.75rem",
        padding: "0.5rem 0.75rem",
        textAlign: "center",
        minWidth: "70px",
      }}
    >
      <p
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#3D4B58",
          margin: 0,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 15,
          fontWeight: 900,
          color,
          margin: "2px 0 0 0",
        }}
      >
        {value}
      </p>
      {subtext && (
        <p style={{ fontSize: 9, color: "#3D4B58", margin: 0 }}>{subtext}</p>
      )}
    </div>
  );
}

function MiniBarChart({
  games,
  statKey,
  label,
}: {
  games: GameLogEntry[];
  statKey: string;
  label: string;
}) {
  const values = games.map((g) => parseFloat(String(g[statKey] ?? "0")) || 0);
  const max = Math.max(...values, 1);
  return (
    <div>
      <p
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "#3D4B58",
          marginBottom: 6,
        }}
      >
        {label} — Last {games.length} Games
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 60,
        }}
      >
        {values.map((v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 8, color: "#3D4B58" }}>{v}</span>
            <div
              style={{
                width: "100%",
                height: Math.max(4, (v / max) * 48),
                background:
                  v >= max * 0.7
                    ? "#22c55e"
                    : v >= max * 0.4
                    ? "#D4A843"
                    : "rgba(19,35,58,0.20)",
                borderRadius: "3px 3px 0 0",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
        {games.map((g, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              fontSize: 7,
              color: "#3D4B58",
              textAlign: "center",
              overflow: "hidden",
            }}
          >
            {(g.date_game ?? g.date ?? "").slice(5, 10)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: "3px solid rgba(19,35,58,0.12)",
          borderTop: "3px solid #D4A843",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        ...CARD_STYLE,
        textAlign: "center",
        padding: "1.5rem",
        color: "#ef4444",
      }}
    >
      <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#13233A",
            color: "#F6F1E7",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.4rem 0.9rem",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

function SportBadge({ sport }: { sport: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    MLB: { bg: "rgba(212,168,67,0.15)", color: "#D4A843" },
    NBA: { bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
    NFL: { bg: "rgba(34,197,94,0.12)", color: "#16a34a" },
    NHL: { bg: "rgba(59,130,246,0.12)", color: "#2563eb" },
  };
  const c = colors[sport] ?? { bg: "rgba(19,35,58,0.08)", color: "#3D4B58" };
  return (
    <span
      style={{
        display: "inline-block",
        background: c.bg,
        color: c.color,
        borderRadius: "0.4rem",
        padding: "0 6px",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {sport}
    </span>
  );
}

function PlayerAvatar({
  player,
  size = 48,
}: {
  player: { name: string; headshotUrl?: string };
  size?: number;
}) {
  const [imgError, setImgError] = useState(false);
  const initials = player.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (player.headshotUrl && !imgError) {
    return (
      <img
        src={player.headshotUrl}
        alt={player.name}
        onError={() => setImgError(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid rgba(19,35,58,0.10)",
          background: "#e8e3d8",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #13233A 0%, #3D4B58 100%)",
        color: "#F6F1E7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.33,
        fontWeight: 800,
        flexShrink: 0,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

// ─── Stat display helpers ─────────────────────────────────────────────────────

function fmtAvg(val: string | number | undefined): string {
  if (val == null || val === "") return "—";
  const n = parseFloat(String(val));
  if (isNaN(n)) return "—";
  return "." + n.toFixed(3).replace("0.", "").replace(".", "");
}

function fmtPct(val: string | number | undefined): string {
  if (val == null || val === "") return "—";
  const n = parseFloat(String(val));
  if (isNaN(n)) return "—";
  return n.toFixed(1) + "%";
}

function fmtNum(val: string | number | undefined, decimals = 0): string {
  if (val == null || val === "") return "—";
  const n = parseFloat(String(val));
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ player }: { player: PlayerData }) {
  const s = player.season ?? {};
  const gamelog = (player.gamelog ?? []).slice(0, 10);
  const sport = player.sport;

  const isHot = player.avg30 != null && player.avg30 >= 0.3;
  const isCold = player.avg14 != null && player.avg14 < 0.2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Hot/Cold indicator (MLB only) */}
      {sport === "MLB" && (isHot || isCold) && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: isHot ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
            border: `1px solid ${isHot ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)"}`,
            borderRadius: "2rem",
            padding: "0.3rem 0.9rem",
            alignSelf: "flex-start",
            fontSize: 13,
            fontWeight: 700,
            color: isHot ? "#16a34a" : "#ef4444",
          }}
        >
          {isHot ? "🔥 Hot Streak" : "❄️ Cold Streak"}
          {player.avg30 != null && isHot && (
            <span style={{ fontWeight: 400, fontSize: 11 }}>
              (Last 30: {fmtAvg(player.avg30)})
            </span>
          )}
          {player.avg14 != null && isCold && (
            <span style={{ fontWeight: 400, fontSize: 11 }}>
              (Last 14: {fmtAvg(player.avg14)})
            </span>
          )}
        </div>
      )}

      {/* Season Stats */}
      <div style={CARD_STYLE}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#3D4B58",
            margin: "0 0 0.75rem",
          }}
        >
          {new Date().getFullYear()} Season Stats
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
            gap: "0.5rem",
          }}
        >
          {sport === "MLB" && (
            <>
              <StatChip label="AVG" value={fmtAvg(s.avg ?? s.AVG)} />
              <StatChip label="OBP" value={fmtAvg(s.obp ?? s.OBP)} />
              <StatChip label="SLG" value={fmtAvg(s.slg ?? s.SLG)} />
              <StatChip
                label="OPS"
                value={fmtNum((parseFloat(String(s.obp ?? s.OBP ?? 0)) + parseFloat(String(s.slg ?? s.SLG ?? 0))).toString(), 3)}
                highlight={(parseFloat(String(s.obp ?? s.OBP ?? 0)) + parseFloat(String(s.slg ?? s.SLG ?? 0))) >= 0.85}
              />
              <StatChip label="HR" value={fmtNum(s.hr ?? s.HR)} />
              <StatChip label="RBI" value={fmtNum(s.rbi ?? s.RBI)} />
              <StatChip label="R" value={fmtNum(s.r ?? s.R)} />
              <StatChip label="H" value={fmtNum(s.h ?? s.H)} />
              <StatChip label="BB" value={fmtNum(s.bb ?? s.BB)} />
              <StatChip label="K" value={fmtNum(s.k ?? s.K ?? s.so ?? s.SO)} />
              <StatChip label="SB" value={fmtNum(s.sb ?? s.SB)} />
              {(s.woba ?? s.wOBA) && (
                <StatChip label="wOBA" value={fmtAvg(s.woba ?? s.wOBA)} highlight={parseFloat(String(s.woba ?? s.wOBA ?? 0)) >= 0.35} />
              )}
            </>
          )}
          {sport === "NBA" && (
            <>
              <StatChip label="PPG" value={fmtNum(s.ppg ?? s.PTS, 1)} highlight={parseFloat(String(s.ppg ?? s.PTS ?? 0)) >= 20} />
              <StatChip label="RPG" value={fmtNum(s.rpg ?? s.REB, 1)} />
              <StatChip label="APG" value={fmtNum(s.apg ?? s.AST, 1)} />
              <StatChip label="BPG" value={fmtNum(s.bpg ?? s.BLK, 1)} />
              <StatChip label="SPG" value={fmtNum(s.spg ?? s.STL, 1)} />
              <StatChip label="FG%" value={fmtPct(s["fg%"] ?? s.FGP ?? s.fg_pct)} highlight={parseFloat(String(s["fg%"] ?? s.FGP ?? s.fg_pct ?? 0)) >= 50} />
              <StatChip label="3P%" value={fmtPct(s["3p%"] ?? s.TPP ?? s["3p_pct"])} />
              <StatChip label="FT%" value={fmtPct(s["ft%"] ?? s.FTP ?? s.ft_pct)} />
              <StatChip label="MIN" value={fmtNum(s.min ?? s.MIN, 1)} />
            </>
          )}
          {sport === "NHL" && (
            <>
              <StatChip label="G" value={fmtNum(s.g ?? s.G)} highlight={parseInt(String(s.g ?? s.G ?? 0)) >= 20} />
              <StatChip label="A" value={fmtNum(s.a ?? s.A)} />
              <StatChip label="PTS" value={fmtNum(s.pts ?? s.PTS)} highlight={parseInt(String(s.pts ?? s.PTS ?? 0)) >= 40} />
              <StatChip label="+/-" value={fmtNum(s["plus_minus"] ?? s["+/-"])} highlight={parseInt(String(s["plus_minus"] ?? s["+/-"] ?? 0)) > 10} danger={parseInt(String(s["plus_minus"] ?? s["+/-"] ?? 0)) < -10} />
              <StatChip label="PIM" value={fmtNum(s.pim ?? s.PIM)} />
              <StatChip label="SOG/G" value={fmtNum(s.sog_per_game ?? s.SOG_G, 1)} />
              <StatChip label="TOI" value={String(s.toi ?? s.TOI ?? "—")} />
            </>
          )}
          {sport === "NFL" && (
            <>
              {/* QB */}
              {(player.position === "QB") && (
                <>
                  <StatChip label="CMP%" value={fmtPct(s.cmp_pct ?? s.CMP_PCT)} />
                  <StatChip label="YDS" value={fmtNum(s.yds ?? s.YDS)} />
                  <StatChip label="TD" value={fmtNum(s.td ?? s.TD)} highlight={parseInt(String(s.td ?? s.TD ?? 0)) >= 20} />
                  <StatChip label="INT" value={fmtNum(s.int ?? s.INT)} danger={parseInt(String(s.int ?? s.INT ?? 0)) >= 10} />
                  <StatChip label="Rating" value={fmtNum(s.rating ?? s.RATING, 1)} highlight={parseFloat(String(s.rating ?? s.RATING ?? 0)) >= 100} />
                </>
              )}
              {/* RB */}
              {(player.position === "RB") && (
                <>
                  <StatChip label="CAR" value={fmtNum(s.car ?? s.CAR)} />
                  <StatChip label="YDS" value={fmtNum(s.rush_yds ?? s.RUSH_YDS ?? s.yds ?? s.YDS)} />
                  <StatChip label="AVG" value={fmtNum(s.ypc ?? s.YPC, 1)} />
                  <StatChip label="TD" value={fmtNum(s.td ?? s.TD)} />
                  <StatChip label="REC" value={fmtNum(s.rec ?? s.REC)} />
                  <StatChip label="RecYDS" value={fmtNum(s.rec_yds ?? s.REC_YDS)} />
                </>
              )}
              {/* WR/TE */}
              {(player.position === "WR" || player.position === "TE") && (
                <>
                  <StatChip label="REC" value={fmtNum(s.rec ?? s.REC)} />
                  <StatChip label="YDS" value={fmtNum(s.yds ?? s.YDS)} />
                  <StatChip label="AVG" value={fmtNum(s.ypr ?? s.YPR, 1)} />
                  <StatChip label="TD" value={fmtNum(s.td ?? s.TD)} highlight={parseInt(String(s.td ?? s.TD ?? 0)) >= 6} />
                  <StatChip label="TGTS" value={fmtNum(s.tgts ?? s.TGTS)} />
                </>
              )}
              {/* Generic NFL fallback */}
              {!["QB", "RB", "WR", "TE"].includes(player.position) && (
                Object.entries(s).slice(0, 8).map(([k, v]) => (
                  <StatChip key={k} label={k.toUpperCase()} value={String(v ?? "—")} />
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* Steamer Projection (MLB) */}
      {sport === "MLB" && player.steamer && (
        <div
          style={{
            ...CARD_STYLE,
            background: "rgba(212,168,67,0.06)",
            border: "1px solid rgba(212,168,67,0.25)",
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#D4A843",
              margin: "0 0 0.5rem",
            }}
          >
            ⚡ Steamer Season Projection
          </p>
          <p style={{ fontSize: 13, color: "#131A24", margin: 0, lineHeight: 1.6 }}>
            {fmtAvg(player.steamer.avg)} AVG · {fmtNum(player.steamer.hr)} HR ·{" "}
            {fmtNum(player.steamer.rbi)} RBI
            {player.steamer.wrc_plus && ` · ${fmtNum(player.steamer.wrc_plus)} wRC+`}
          </p>
        </div>
      )}

      {/* Last 10 Games */}
      {gamelog.length > 0 && (
        <div style={CARD_STYLE}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#3D4B58",
              margin: "0 0 0.75rem",
            }}
          >
            Last {gamelog.length} Games
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {sport === "MLB" && ["Date", "Opp", "H", "AB", "HR", "RBI", "R"].map((h) => (
                    <th key={h} style={{ textAlign: h === "Date" || h === "Opp" ? "left" : "center", padding: "4px 8px", fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid rgba(19,35,58,0.08)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  {sport === "NBA" && ["Date", "Opp", "PTS", "REB", "AST", "MIN"].map((h) => (
                    <th key={h} style={{ textAlign: h === "Date" || h === "Opp" ? "left" : "center", padding: "4px 8px", fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid rgba(19,35,58,0.08)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  {sport === "NHL" && ["Date", "Opp", "G", "A", "PTS", "+/-"].map((h) => (
                    <th key={h} style={{ textAlign: h === "Date" || h === "Opp" ? "left" : "center", padding: "4px 8px", fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid rgba(19,35,58,0.08)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  {sport === "NFL" && (player.position === "QB"
                    ? ["Date", "Opp", "CMP", "YDS", "TD", "INT", "Rating"]
                    : player.position === "RB"
                    ? ["Date", "Opp", "CAR", "YDS", "TD", "REC", "RecYDS"]
                    : ["Date", "Opp", "REC", "YDS", "TD", "TGTS"]
                  ).map((h) => (
                    <th key={h} style={{ textAlign: h === "Date" || h === "Opp" ? "left" : "center", padding: "4px 8px", fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid rgba(19,35,58,0.08)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gamelog.map((g, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(19,35,58,0.02)" }}>
                    {sport === "MLB" && (
                      <>
                        <td style={{ padding: "5px 8px", color: "#3D4B58", fontSize: 11, whiteSpace: "nowrap" }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                        <td style={{ padding: "5px 8px", color: "#131A24", fontWeight: 600, fontSize: 12 }}>{g.opp ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700, color: parseInt(String(g.H ?? 0)) >= 2 ? "#22c55e" : "#131A24" }}>{g.H ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: "#3D4B58" }}>{g.AB ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700, color: parseInt(String(g.HR ?? 0)) > 0 ? "#D4A843" : "#131A24" }}>{g.HR ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.RBI ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.R ?? "—"}</td>
                      </>
                    )}
                    {sport === "NBA" && (
                      <>
                        <td style={{ padding: "5px 8px", color: "#3D4B58", fontSize: 11, whiteSpace: "nowrap" }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                        <td style={{ padding: "5px 8px", color: "#131A24", fontWeight: 600, fontSize: 12 }}>{g.opp ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700, color: parseInt(String(g.PTS ?? 0)) >= 20 ? "#22c55e" : "#131A24" }}>{g.PTS ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.REB ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.AST ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: "#3D4B58" }}>{g.MIN ?? "—"}</td>
                      </>
                    )}
                    {sport === "NHL" && (
                      <>
                        <td style={{ padding: "5px 8px", color: "#3D4B58", fontSize: 11, whiteSpace: "nowrap" }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                        <td style={{ padding: "5px 8px", color: "#131A24", fontWeight: 600, fontSize: 12 }}>{g.opp ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700, color: parseInt(String(g.G ?? 0)) > 0 ? "#22c55e" : "#131A24" }}>{g.G ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.A ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }}>{g.PTS ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: parseInt(String(g["+/-"] ?? 0)) > 0 ? "#22c55e" : parseInt(String(g["+/-"] ?? 0)) < 0 ? "#ef4444" : "#131A24" }}>{g["+/-"] ?? "—"}</td>
                      </>
                    )}
                    {sport === "NFL" && player.position === "QB" && (
                      <>
                        <td style={{ padding: "5px 8px", color: "#3D4B58", fontSize: 11, whiteSpace: "nowrap" }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                        <td style={{ padding: "5px 8px", color: "#131A24", fontWeight: 600, fontSize: 12 }}>{g.opp ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.CMP ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }}>{g.YDS ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: "#22c55e" }}>{g.TD ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: "#ef4444" }}>{g.INT ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.rating ?? "—"}</td>
                      </>
                    )}
                    {sport === "NFL" && player.position === "RB" && (
                      <>
                        <td style={{ padding: "5px 8px", color: "#3D4B58", fontSize: 11, whiteSpace: "nowrap" }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                        <td style={{ padding: "5px 8px", color: "#131A24", fontWeight: 600, fontSize: 12 }}>{g.opp ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.CAR ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }}>{g.YDS ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: "#22c55e" }}>{g.TD ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.REC ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.RecYDS ?? "—"}</td>
                      </>
                    )}
                    {sport === "NFL" && (player.position === "WR" || player.position === "TE") && (
                      <>
                        <td style={{ padding: "5px 8px", color: "#3D4B58", fontSize: 11, whiteSpace: "nowrap" }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                        <td style={{ padding: "5px 8px", color: "#131A24", fontWeight: 600, fontSize: 12 }}>{g.opp ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700 }}>{g.REC ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.YDS ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center", color: "#22c55e" }}>{g.TD ?? "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>{g.TGTS ?? "—"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Matchups Tab ─────────────────────────────────────────────────────────────

interface TeamResult { name: string; shortName: string; abbr: string; logo: string | null; color: string | null; }

function MatchupsTab({ player }: { player: PlayerData }) {
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedOpponent, setSelectedOpponent] = useState<PlayerSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const isMlb = player.sport === "MLB";
  const searchPlaceholder = isMlb ? "Search opposing pitcher..." : "Search opponent team (e.g. Lions, Chiefs)...";

  // For non-MLB: fetch full team list once, filter client-side
  const { data: teamList } = useQuery<TeamResult[]>({
    queryKey: ["team-list", player.sport],
    queryFn: () => fetch(`/api/intel/teams/${player.sport}`).then(r => r.json()),
    enabled: !isMlb,
    staleTime: 1000 * 60 * 60 * 24,
  });

  const filteredTeams: TeamResult[] = !isMlb && searchQ.trim().length >= 1 && teamList
    ? teamList.filter(t =>
        t.name.toLowerCase().includes(searchQ.toLowerCase()) ||
        t.shortName.toLowerCase().includes(searchQ.toLowerCase()) ||
        t.abbr.toLowerCase().includes(searchQ.toLowerCase())
      ).slice(0, 8)
    : [];

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (isMlb) {
      if (searchQ.trim().length < 2) { setDebouncedQ(""); setShowDropdown(false); return; }
      debounceRef.current = setTimeout(() => { setDebouncedQ(searchQ.trim()); setShowDropdown(true); }, 300);
    } else {
      setShowDropdown(searchQ.trim().length >= 1);
    }
    return () => clearTimeout(debounceRef.current);
  }, [searchQ, isMlb]);

  const searchUrl = isMlb && debouncedQ
    ? `/api/intel/search?q=${encodeURIComponent(debouncedQ)}&sport=${player.sport}&positionFilter=pitcher`
    : null;

  const { data: searchResults, isFetching: searchLoading } = useQuery<PlayerSearchResult[]>({
    queryKey: ["matchup-search", debouncedQ, player.sport],
    queryFn: () => fetch(searchUrl!).then((r) => r.json()),
    enabled: !!searchUrl,
  });

  const bvpUrl = isMlb && selectedOpponent
    ? `/api/intel/bvp-name?batter=${encodeURIComponent(player.name)}&pitcher=${encodeURIComponent(selectedOpponent.name)}`
    : null;
  const { data: bvpData, isFetching: bvpLoading, error: bvpError, refetch: refetchBvp } = useQuery<BvPData>({
    queryKey: ["bvp", player.name, selectedOpponent?.name],
    queryFn: () => fetch(bvpUrl!).then((r) => r.json()),
    enabled: !!bvpUrl,
  });

  const vsTeamUrl = !isMlb && selectedOpponent
    ? `/api/intel/vs-team/${player.sport}/${player.espnId}/${selectedOpponent.teamAbbr ?? selectedOpponent.team ?? "UNK"}`
    : null;
  const { data: vsTeamData, isFetching: vsLoading, error: vsError, refetch: refetchVs } = useQuery<VsTeamData>({
    queryKey: ["vs-team", player.espnId, selectedOpponent?.teamAbbr],
    queryFn: () => fetch(vsTeamUrl!).then((r) => r.json()),
    enabled: !!vsTeamUrl,
  });

  // MLB: also fetch vs-team stats using the pitcher's team abbreviation (second source)
  const mlbVsTeamUrl = isMlb && selectedOpponent?.teamAbbr && player.mlbamId
    ? `/api/intel/vs-team/MLB/${player.mlbamId}/${selectedOpponent.teamAbbr}`
    : null;
  const { data: mlbVsTeamData, isFetching: mlbVsLoading } = useQuery<VsTeamData>({
    queryKey: ["mlb-vs-team", player.mlbamId, selectedOpponent?.teamAbbr],
    queryFn: () => fetch(mlbVsTeamUrl!).then((r) => r.json()),
    enabled: !!mlbVsTeamUrl,
  });

  const signalColor = { strong: "#22c55e", struggles: "#ef4444", neutral: "#3D4B58" } as const;
  const signalBg = { strong: "rgba(34,197,94,0.10)", struggles: "rgba(239,68,68,0.10)", neutral: "rgba(61,75,88,0.08)" } as const;
  const signalLabel = { strong: "💪 Strong History", struggles: "🚫 Struggles vs Pitcher", neutral: "⚡ Neutral History" } as const;

  const vsGameKeys: string[] = [];
  if (vsTeamData?.recentGames && vsTeamData.recentGames.length > 0) {
    const skip = new Set(["date", "date_game", "opp", "result", "team"]);
    Object.keys(vsTeamData.recentGames[0]).forEach(k => { if (!skip.has(k)) vsGameKeys.push(k); });
  }

  function AvgBar({ value, label }: { value: number; label: string }) {
    const pct = Math.min(100, (value / 0.5) * 100);
    const color = value >= 0.3 ? "#22c55e" : value >= 0.25 ? "#D4A843" : "#ef4444";
    return (
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 900, color }}>{fmtAvg(value)}</span>
        </div>
        <div style={{ height: 6, background: "rgba(19,35,58,0.08)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Opponent Search */}
      <div style={CARD_STYLE}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
          {isMlb ? "Opposing Pitcher" : "Opponent Team"}
        </p>
        <div style={{ position: "relative" }}>
          {selectedOpponent && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.12)", borderRadius: "0.75rem", padding: "0.5rem 0.75rem", marginBottom: "0.5rem" }}>
              <PlayerAvatar player={selectedOpponent} size={28} />
              <span style={{ fontWeight: 700, color: "#131A24", fontSize: 13 }}>{selectedOpponent.name}</span>
              <span style={{ color: "#3D4B58", fontSize: 11 }}>{selectedOpponent.teamAbbr} · {selectedOpponent.position}</span>
              <button onClick={() => { setSelectedOpponent(null); setSearchQ(""); }} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#3D4B58", padding: 2 }}>
                <X size={14} />
              </button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.12)", borderRadius: "0.75rem", padding: "0.5rem 0.75rem" }}>
            <Search size={14} color="#3D4B58" />
            <input type="text" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={searchPlaceholder}
              style={{ background: "none", border: "none", outline: "none", flex: 1, fontSize: 13, color: "#131A24" }} />
            {searchLoading && <div style={{ width: 14, height: 14, border: "2px solid rgba(19,35,58,0.15)", borderTop: "2px solid #D4A843", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
          </div>
          {/* MLB: player (pitcher) search results */}
          {isMlb && showDropdown && searchResults && searchResults.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid rgba(19,35,58,0.15)", borderRadius: "0.75rem", boxShadow: "0 8px 24px rgba(19,35,58,0.12)", overflow: "hidden", marginTop: 4 }}>
              {searchResults.slice(0, 6).map((r) => (
                <button key={r.espnId} onClick={() => { setSelectedOpponent(r); setSearchQ(""); setShowDropdown(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.75rem", background: "none", border: "none", borderBottom: "1px solid rgba(19,35,58,0.06)", cursor: "pointer", textAlign: "left" }}>
                  <PlayerAvatar player={r} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#131A24" }}>{r.name}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#3D4B58" }}>{r.teamAbbr} · {r.position}</p>
                  </div>
                  <SportBadge sport={r.sport} />
                </button>
              ))}
            </div>
          )}
          {isMlb && showDropdown && !searchLoading && searchResults && searchResults.length === 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid rgba(19,35,58,0.15)", borderRadius: "0.75rem", boxShadow: "0 8px 24px rgba(19,35,58,0.12)", padding: "0.75rem", fontSize: 13, color: "#3D4B58", marginTop: 4 }}>
              No pitchers found for "{debouncedQ}"
            </div>
          )}
          {/* Non-MLB: team list filtered client-side */}
          {!isMlb && showDropdown && filteredTeams.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid rgba(19,35,58,0.15)", borderRadius: "0.75rem", boxShadow: "0 8px 24px rgba(19,35,58,0.12)", overflow: "hidden", marginTop: 4 }}>
              {filteredTeams.map((t) => (
                <button key={t.abbr}
                  onClick={() => {
                    setSelectedOpponent({ espnId: t.abbr, name: t.name, sport: player.sport, team: t.name, teamAbbr: t.abbr, position: "", headshot: t.logo ?? "" });
                    setSearchQ("");
                    setShowDropdown(false);
                  }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.75rem", background: "none", border: "none", borderBottom: "1px solid rgba(19,35,58,0.06)", cursor: "pointer", textAlign: "left" }}>
                  {t.logo
                    ? <img src={t.logo} alt={t.abbr} style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 4 }} />
                    : <div style={{ width: 28, height: 28, borderRadius: 4, background: t.color ? `#${t.color}` : "#3D4B58", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: "#fff" }}>{t.abbr}</span>
                      </div>
                  }
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#131A24" }}>{t.name}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#3D4B58" }}>{t.abbr}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!isMlb && showDropdown && searchQ.trim().length >= 1 && filteredTeams.length === 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid rgba(19,35,58,0.15)", borderRadius: "0.75rem", boxShadow: "0 8px 24px rgba(19,35,58,0.12)", padding: "0.75rem", fontSize: 13, color: "#3D4B58", marginTop: 4 }}>
              No teams found for "{searchQ}"
            </div>
          )}
        </div>
      </div>

      {/* ── MLB: Batter vs Pitcher ── */}
      {isMlb && selectedOpponent && (
        <>
          {bvpLoading && <Spinner />}
          {bvpError && <ErrorCard message="Failed to load BvP data." onRetry={() => refetchBvp()} />}
          {!bvpLoading && !bvpError && bvpData && (
            <>
              {/* Signal banner */}
              {bvpData.signal && (
                <div style={{ background: signalBg[bvpData.signal], border: `1px solid ${signalColor[bvpData.signal]}40`, borderRadius: "0.75rem", padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: signalColor[bvpData.signal] }}>{signalLabel[bvpData.signal]}</span>
                  {bvpData.seasonBvP?.AB != null && (
                    <span style={{ fontSize: 11, color: "#3D4B58", marginLeft: "auto" }}>{fmtNum(bvpData.seasonBvP.AB)} AB this season</span>
                  )}
                </div>
              )}

              {/* Season BvP — Full stats */}
              {bvpData.seasonBvP && (
                <div style={CARD_STYLE}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 1rem" }}>
                    2026 Season vs {selectedOpponent.name}
                  </p>
                  {bvpData.seasonBvP.AVG != null && (
                    <AvgBar value={parseFloat(String(bvpData.seasonBvP.AVG))} label="Batting Average" />
                  )}
                  {bvpData.seasonBvP.OBP != null && (
                    <AvgBar value={parseFloat(String(bvpData.seasonBvP.OBP))} label="On-Base %" />
                  )}
                  {bvpData.seasonBvP.SLG != null && (
                    <AvgBar value={parseFloat(String(bvpData.seasonBvP.SLG))} label="Slugging %" />
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(62px, 1fr))", gap: "0.4rem", marginTop: "0.75rem" }}>
                    {(
                      [
                        ["AB",  fmtNum(bvpData.seasonBvP.AB),   false],
                        ["H",   fmtNum(bvpData.seasonBvP.H),    Number(bvpData.seasonBvP.H) >= 3],
                        ["2B",  fmtNum(bvpData.seasonBvP.doubles ?? bvpData.seasonBvP["2B"]), false],
                        ["HR",  fmtNum(bvpData.seasonBvP.HR),   Number(bvpData.seasonBvP.HR) >= 1],
                        ["RBI", fmtNum(bvpData.seasonBvP.RBI),  Number(bvpData.seasonBvP.RBI) >= 2],
                        ["TB",  fmtNum(bvpData.seasonBvP.TB ?? bvpData.seasonBvP.totalBases), false],
                        ["BB",  fmtNum(bvpData.seasonBvP.walks ?? bvpData.seasonBvP.BB), false],
                        ["K",   fmtNum(bvpData.seasonBvP.strikeOuts ?? bvpData.seasonBvP.K), false],
                        ["AVG", fmtAvg(bvpData.seasonBvP.AVG),  parseFloat(String(bvpData.seasonBvP.AVG ?? 0)) >= 0.3],
                        ["OBP", fmtAvg(bvpData.seasonBvP.OBP),  parseFloat(String(bvpData.seasonBvP.OBP ?? 0)) >= 0.35],
                        ["SLG", fmtAvg(bvpData.seasonBvP.SLG),  parseFloat(String(bvpData.seasonBvP.SLG ?? 0)) >= 0.45],
                        ["OPS", fmtAvg(bvpData.seasonBvP.ops ?? bvpData.seasonBvP.OPS), parseFloat(String(bvpData.seasonBvP.ops ?? bvpData.seasonBvP.OPS ?? 0)) >= 0.8],
                      ] as [string, string, boolean][]
                    ).filter(([, v]) => v !== "—").map(([label, value, hi]) => (
                      <StatChip key={label} label={label} value={value} highlight={hi} />
                    ))}
                  </div>
                </div>
              )}

              {/* Career BvP */}
              {bvpData.careerBvP && Object.keys(bvpData.careerBvP).length > 0 && (
                <div style={CARD_STYLE}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
                    Career vs {selectedOpponent.name}
                  </p>
                  {bvpData.careerBvP.AVG != null && (
                    <AvgBar value={parseFloat(String(bvpData.careerBvP.AVG))} label="Career Average" />
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(62px, 1fr))", gap: "0.4rem", marginTop: "0.5rem" }}>
                    {(
                      [
                        ["AB",  fmtNum(bvpData.careerBvP.AB)],
                        ["H",   fmtNum(bvpData.careerBvP.H)],
                        ["2B",  fmtNum(bvpData.careerBvP.doubles ?? bvpData.careerBvP["2B"])],
                        ["HR",  fmtNum(bvpData.careerBvP.HR)],
                        ["RBI", fmtNum(bvpData.careerBvP.RBI)],
                        ["TB",  fmtNum(bvpData.careerBvP.TB ?? bvpData.careerBvP.totalBases)],
                        ["BB",  fmtNum(bvpData.careerBvP.walks ?? bvpData.careerBvP.BB)],
                        ["K",   fmtNum(bvpData.careerBvP.strikeOuts ?? bvpData.careerBvP.K)],
                        ["AVG", fmtAvg(bvpData.careerBvP.AVG)],
                        ["OBP", fmtAvg(bvpData.careerBvP.OBP)],
                        ["SLG", fmtAvg(bvpData.careerBvP.SLG)],
                        ["OPS", fmtAvg(bvpData.careerBvP.ops ?? bvpData.careerBvP.OPS)],
                      ] as [string, string][]
                    ).filter(([, v]) => v !== "—").map(([label, value]) => (
                      <StatChip key={label} label={label} value={value}
                        highlight={label === "AVG" && parseFloat(String(bvpData.careerBvP?.AVG ?? 0)) >= 0.3} />
                    ))}
                  </div>
                </div>
              )}

              {/* No history note */}
              {!bvpData.seasonBvP && !bvpData.careerBvP && (
                <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>
                    No matchup history found between {player.name} and {selectedOpponent.name}.
                  </p>
                  <p style={{ margin: "0.5rem 0 0", fontSize: 11, color: "#3D4B58" }}>
                    This may be a new matchup or a pitcher with limited MLB history.
                  </p>
                </div>
              )}
            </>
          )}

          {/* MLB vs Team (second source — auto-loaded using pitcher's team) */}
          {mlbVsTeamData && !mlbVsLoading && selectedOpponent?.teamAbbr && (
            <>
              {mlbVsTeamData.seasonStats && Object.keys(mlbVsTeamData.seasonStats).length > 0 && (
                <div style={CARD_STYLE}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
                    vs {selectedOpponent.teamAbbr} — Season Totals
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(62px, 1fr))", gap: "0.4rem" }}>
                    {([
                      ["G",   fmtNum(mlbVsTeamData.seasonStats.gamesPlayed)],
                      ["AB",  fmtNum(mlbVsTeamData.seasonStats.atBats)],
                      ["H",   fmtNum(mlbVsTeamData.seasonStats.hits),   Number(mlbVsTeamData.seasonStats.hits) >= 5],
                      ["2B",  fmtNum(mlbVsTeamData.seasonStats.doubles)],
                      ["HR",  fmtNum(mlbVsTeamData.seasonStats.hr),     Number(mlbVsTeamData.seasonStats.hr) >= 2],
                      ["RBI", fmtNum(mlbVsTeamData.seasonStats.rbi)],
                      ["R",   fmtNum(mlbVsTeamData.seasonStats.runs)],
                      ["BB",  fmtNum(mlbVsTeamData.seasonStats.walks)],
                      ["K",   fmtNum(mlbVsTeamData.seasonStats.strikeOuts)],
                      ["SB",  fmtNum(mlbVsTeamData.seasonStats.stolenBases)],
                      ["AVG", fmtAvg(mlbVsTeamData.seasonStats.avg),   parseFloat(String(mlbVsTeamData.seasonStats.avg ?? 0)) >= 0.3],
                      ["OBP", fmtAvg(mlbVsTeamData.seasonStats.obp)],
                      ["SLG", fmtAvg(mlbVsTeamData.seasonStats.slg)],
                      ["OPS", fmtAvg(mlbVsTeamData.seasonStats.ops),   parseFloat(String(mlbVsTeamData.seasonStats.ops ?? 0)) >= 0.8],
                    ] as [string, string, boolean?][]).filter(([, v]) => v !== "—").map(([label, value, hi]) => (
                      <StatChip key={label} label={label} value={value} highlight={!!hi} />
                    ))}
                  </div>
                </div>
              )}

              {/* Per-game vs team table */}
              {mlbVsTeamData.recentGames && mlbVsTeamData.recentGames.length > 0 && (
                <div style={CARD_STYLE}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
                    Game Log vs {selectedOpponent.teamAbbr} ({mlbVsTeamData.recentGames.length} games)
                  </p>
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 340 }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid rgba(19,35,58,0.12)" }}>
                          {["Date", "H", "AB", "HR", "RBI", "BB", "K", "AVG"].map(h => (
                            <th key={h} style={{ padding: "4px 6px", textAlign: h === "Date" ? "left" : "center", fontWeight: 700, color: "#3D4B58", fontSize: 10, textTransform: "uppercase" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {mlbVsTeamData.recentGames.map((g, i) => {
                          const dateStr = String(g.date ?? g.date_game ?? "").slice(5, 10);
                          const isHit = Number(g.H ?? 0) >= 1;
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid rgba(19,35,58,0.06)", background: i % 2 === 0 ? "transparent" : "rgba(19,35,58,0.015)" }}>
                              <td style={{ padding: "5px 6px", color: "#3D4B58", fontSize: 10 }}>{dateStr || "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 800, color: isHit ? "#22c55e" : "#131A24" }}>{g.H ?? "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", color: "#3D4B58" }}>{g.AB ?? "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: Number(g.HR ?? 0) >= 1 ? 800 : 500, color: Number(g.HR ?? 0) >= 1 ? "#22c55e" : "#131A24" }}>{g.HR ?? "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center" }}>{g.RBI ?? "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", color: "#3D4B58" }}>{g.BB ?? "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", color: "#3D4B58" }}>{g.K ?? "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", fontSize: 10, color: "#3D4B58" }}>{g.AVG != null ? fmtAvg(g.AVG) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Non-MLB: vs Team ── */}
      {!isMlb && selectedOpponent && (
        <>
          {vsLoading && <Spinner />}
          {vsError && <ErrorCard message="Failed to load vs-team data." onRetry={() => refetchVs()} />}
          {!vsLoading && !vsError && vsTeamData && (
            <>
              {/* Season aggregate stats */}
              {vsTeamData.seasonStats && Object.keys(vsTeamData.seasonStats).length > 0 && (
                <div style={CARD_STYLE}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
                    Season Totals vs {selectedOpponent.teamAbbr}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(68px, 1fr))", gap: "0.5rem" }}>
                    {Object.entries(vsTeamData.seasonStats).map(([k, v]) => (
                      <StatChip key={k} label={k.toUpperCase()} value={String(v ?? "—")}
                        highlight={
                          (player.sport === "NBA" && k === "PTS" && Number(v) >= 20) ||
                          (player.sport === "NHL" && (k === "G" || k === "PTS") && Number(v) >= 2) ||
                          (player.sport === "NFL" && k === "YDS" && Number(v) >= 200)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Per-game history table */}
              {vsTeamData.recentGames && vsTeamData.recentGames.length > 0 && (
                <div style={CARD_STYLE}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
                    Game-by-Game vs {selectedOpponent.teamAbbr} ({vsTeamData.recentGames.length} games)
                  </p>
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 300 }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid rgba(19,35,58,0.12)" }}>
                          <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: 700, color: "#3D4B58", fontSize: 10, textTransform: "uppercase" }}>Date</th>
                          <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: "#3D4B58", fontSize: 10, textTransform: "uppercase" }}>Res</th>
                          {vsGameKeys.slice(0, 8).map(k => (
                            <th key={k} style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: "#3D4B58", fontSize: 10, textTransform: "uppercase" }}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vsTeamData.recentGames.map((g, i) => {
                          const dateStr = String(g.date_game ?? g.date ?? "").slice(5, 10);
                          const result = String(g.result ?? "");
                          const isWin = result.startsWith("W");
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid rgba(19,35,58,0.06)", background: i % 2 === 0 ? "transparent" : "rgba(19,35,58,0.015)" }}>
                              <td style={{ padding: "5px 6px", color: "#3D4B58", fontSize: 10, whiteSpace: "nowrap" }}>{dateStr}</td>
                              <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 700, fontSize: 11, color: isWin ? "#22c55e" : "#ef4444" }}>{result || "—"}</td>
                              {vsGameKeys.slice(0, 8).map(k => {
                                const val = g[k];
                                const isPrimary = (player.sport === "NBA" && k === "PTS") || (player.sport === "NHL" && k === "G") || (player.sport === "NFL" && k === "YDS");
                                const numVal = parseFloat(String(val ?? "0")) || 0;
                                const isHigh = isPrimary && numVal >= (player.sport === "NBA" ? 20 : player.sport === "NHL" ? 1 : 80);
                                return (
                                  <td key={k} style={{ padding: "5px 6px", textAlign: "center", fontWeight: isPrimary ? 800 : 500, color: isHigh ? "#22c55e" : "#131A24", fontSize: 12 }}>
                                    {val != null ? String(val) : "—"}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Per-game averages footer */}
                  {vsTeamData.recentGames.length >= 2 && (
                    <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(19,35,58,0.08)" }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", margin: "0 0 0.4rem" }}>Per-Game Averages</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                        {vsGameKeys.slice(0, 8).map(k => {
                          const vals = vsTeamData.recentGames!.map(g => parseFloat(String(g[k] ?? "0")) || 0);
                          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                          if (avg === 0) return null;
                          return (
                            <div key={k} style={{ background: "rgba(19,35,58,0.05)", borderRadius: "0.5rem", padding: "3px 8px", display: "flex", gap: 5, alignItems: "center" }}>
                              <span style={{ fontSize: 9, color: "#3D4B58", fontWeight: 700, textTransform: "uppercase" }}>{k}</span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#131A24" }}>{avg.toFixed(1)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* No data fallback */}
              {(!vsTeamData.seasonStats || Object.keys(vsTeamData.seasonStats).length === 0) &&
               (!vsTeamData.recentGames || vsTeamData.recentGames.length === 0) && (
                <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>No matchup data found vs {selectedOpponent.teamAbbr}.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Park / Venue Tab ─────────────────────────────────────────────────────────

// All 30 MLB stadiums with team abbreviations and division
const ALL_MLB_STADIUMS: { venue: string; team: string; abbr: string; div: string; dome: boolean }[] = [
  // NL East
  { venue: "Truist Park",               team: "Braves",       abbr: "ATL", div: "NL East",    dome: false },
  { venue: "Citi Field",                team: "Mets",         abbr: "NYM", div: "NL East",    dome: false },
  { venue: "Citizens Bank Park",        team: "Phillies",     abbr: "PHI", div: "NL East",    dome: false },
  { venue: "Nationals Park",            team: "Nationals",    abbr: "WSH", div: "NL East",    dome: false },
  { venue: "loanDepot park",            team: "Marlins",      abbr: "MIA", div: "NL East",    dome: true  },
  // NL Central
  { venue: "Wrigley Field",             team: "Cubs",         abbr: "CHC", div: "NL Central", dome: false },
  { venue: "Great American Ball Park",  team: "Reds",         abbr: "CIN", div: "NL Central", dome: false },
  { venue: "American Family Field",     team: "Brewers",      abbr: "MIL", div: "NL Central", dome: false },
  { venue: "Busch Stadium",             team: "Cardinals",    abbr: "STL", div: "NL Central", dome: false },
  { venue: "PNC Park",                  team: "Pirates",      abbr: "PIT", div: "NL Central", dome: false },
  // NL West
  { venue: "Dodger Stadium",            team: "Dodgers",      abbr: "LAD", div: "NL West",    dome: false },
  { venue: "Oracle Park",               team: "Giants",       abbr: "SF",  div: "NL West",    dome: false },
  { venue: "Petco Park",                team: "Padres",       abbr: "SD",  div: "NL West",    dome: false },
  { venue: "Chase Field",               team: "Diamondbacks", abbr: "ARI", div: "NL West",    dome: true  },
  { venue: "Coors Field",               team: "Rockies",      abbr: "COL", div: "NL West",    dome: false },
  // AL East
  { venue: "Fenway Park",               team: "Red Sox",      abbr: "BOS", div: "AL East",    dome: false },
  { venue: "Yankee Stadium",            team: "Yankees",      abbr: "NYY", div: "AL East",    dome: false },
  { venue: "Rogers Centre",             team: "Blue Jays",    abbr: "TOR", div: "AL East",    dome: true  },
  { venue: "Oriole Park at Camden Yards", team: "Orioles",      abbr: "BAL", div: "AL East",    dome: false },
  { venue: "Tropicana Field",           team: "Rays",         abbr: "TB",  div: "AL East",    dome: true  },
  // AL Central
  { venue: "Rate Field",               team: "White Sox",    abbr: "CWS", div: "AL Central", dome: false },
  { venue: "Progressive Field",         team: "Guardians",    abbr: "CLE", div: "AL Central", dome: false },
  { venue: "Comerica Park",             team: "Tigers",       abbr: "DET", div: "AL Central", dome: false },
  { venue: "Kauffman Stadium",          team: "Royals",       abbr: "KC",  div: "AL Central", dome: false },
  { venue: "Target Field",              team: "Twins",        abbr: "MIN", div: "AL Central", dome: false },
  // AL West
  { venue: "Globe Life Field",          team: "Rangers",      abbr: "TEX", div: "AL West",    dome: true  },
  { venue: "Minute Maid Park",          team: "Astros",       abbr: "HOU", div: "AL West",    dome: true  },
  { venue: "T-Mobile Park",             team: "Mariners",     abbr: "SEA", div: "AL West",    dome: false },
  { venue: "Oakland Coliseum",          team: "Athletics",    abbr: "OAK", div: "AL West",    dome: false },
  { venue: "Angel Stadium",             team: "Angels",       abbr: "LAA", div: "AL West",    dome: false },
];

const STAT_OPTIONS = [
  { key: "avg",         label: "AVG",  fmt: (v: any) => v != null && v > 0 ? fmtAvg(v) : null,     max: 0.5,  isRate: true  },
  { key: "ops",         label: "OPS",  fmt: (v: any) => v != null && v > 0 ? fmtAvg(v) : null,     max: 1.2,  isRate: true  },
  { key: "obp",         label: "OBP",  fmt: (v: any) => v != null && v > 0 ? fmtAvg(v) : null,     max: 0.6,  isRate: true  },
  { key: "slg",         label: "SLG",  fmt: (v: any) => v != null && v > 0 ? fmtAvg(v) : null,     max: 0.8,  isRate: true  },
  { key: "hr",          label: "HR",   fmt: (v: any) => v != null ? fmtNum(v) : null,               max: 10,   isRate: false },
  { key: "hits",        label: "H",    fmt: (v: any) => v != null ? fmtNum(v) : null,               max: 30,   isRate: false },
  { key: "rbi",         label: "RBI",  fmt: (v: any) => v != null ? fmtNum(v) : null,               max: 20,   isRate: false },
];

// ─── Spray Chart Component ─────────────────────────────────────────────────────
// MLB Statcast coordX/coordY: home plate is approx (125.42, 204.5) in a
// 250×250 coordinate space. We map to an SVG viewBox of 0 0 250 250.

interface HitPoint {
  x: number; y: number;
  event: string; trajectory: string;
  speed: number | null; angle: number | null; distance: number | null;
  venue?: string | null;
}

interface SprayData { hits: HitPoint[]; total: number; }

type SprayFilter = "all" | "hits" | "hr" | "gb" | "fb" | "ld";

const HIT_EVENT_COLOR: Record<string, string> = {
  "Single":           "#22c55e",
  "Double":           "#3b82f6",
  "Triple":           "#a855f7",
  "Home Run":         "#D4A843",
  "Field Out":        "rgba(100,100,100,0.45)",
  "Flyout":           "rgba(100,100,100,0.45)",
  "Groundout":        "rgba(100,100,100,0.45)",
  "Lineout":          "rgba(100,100,100,0.45)",
  "Pop Out":          "rgba(100,100,100,0.45)",
  "Double Play":      "rgba(100,100,100,0.45)",
  "Triple Play":      "rgba(100,100,100,0.45)",
  "Grounded Into DP": "rgba(100,100,100,0.45)",
  "Forceout":         "rgba(100,100,100,0.45)",
  "Sac Fly":          "rgba(100,100,100,0.45)",
};

function hitColor(event: string): string {
  return HIT_EVENT_COLOR[event] ?? "rgba(100,100,100,0.4)";
}

function isHitEvent(event: string): boolean {
  return ["Single","Double","Triple","Home Run"].includes(event);
}

function SprayChart({ player, selectedVenue }: { player: PlayerData; selectedVenue?: string | null }) {
  const [filter, setFilter] = useState<SprayFilter>("hits");
  const [selected, setSelected] = useState<HitPoint | null>(null);

  const enabled = player.sport === "MLB" && !!player.mlbamId;
  const { data, isFetching, error, refetch } = useQuery<SprayData>({
    queryKey: ["spray-chart", player.mlbamId],
    queryFn: () =>
      fetch(`/api/intel/spray-chart/${player.mlbamId}`, { signal: AbortSignal.timeout(120000) })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    enabled,
    staleTime: 1000 * 60 * 60,
    retry: 2,
    retryDelay: 3000,
  });

  if (!enabled) return null;
  if (isFetching) return (
    <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
      <Spinner />
      <p style={{ margin: "0.75rem 0 0", fontSize: 11, color: "#3D4B58" }}>Building spray chart — first load may take up to 60s…</p>
    </div>
  );
  if (error || !data) return <ErrorCard message="Could not load spray chart. Tap to retry." onRetry={() => refetch()} />;
  if (!data.hits?.length) {
    return (
      <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
        <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>No spray chart data available for {player.name}.</p>
      </div>
    );
  }

  // Venue filter — case-insensitive match on venue name
  const venueHits = selectedVenue
    ? data.hits.filter(h => (h.venue ?? "").toLowerCase() === selectedVenue.toLowerCase())
    : data.hits;

  if (selectedVenue && venueHits.length === 0) {
    return (
      <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", marginBottom: 6 }}>
          <MapPin size={13} color="#D4A843" />
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: 0 }}>Spray Chart</p>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>No batted-ball data at {selectedVenue} in the last 3 seasons.</p>
      </div>
    );
  }

  const filterFn = (h: HitPoint): boolean => {
    if (filter === "all") return true;
    if (filter === "hits") return isHitEvent(h.event);
    if (filter === "hr") return h.event === "Home Run";
    if (filter === "gb") return h.trajectory === "ground_ball" || h.trajectory === "bunt_grounder";
    if (filter === "fb") return h.trajectory === "fly_ball" || h.trajectory === "popup";
    if (filter === "ld") return h.trajectory === "line_drive";
    return true;
  };

  const filtered = venueHits.filter(filterFn);

  // Count each type from the venue-filtered pool
  const singles = venueHits.filter(h => h.event === "Single").length;
  const doubles = venueHits.filter(h => h.event === "Double").length;
  const triples = venueHits.filter(h => h.event === "Triple").length;
  const hrs     = venueHits.filter(h => h.event === "Home Run").length;
  const outs    = venueHits.filter(h => !isHitEvent(h.event)).length;

  // Filter buttons
  const FILTERS: { key: SprayFilter; label: string }[] = [
    { key: "hits", label: "Hits Only" },
    { key: "all",  label: "All" },
    { key: "hr",   label: "HR" },
    { key: "gb",   label: "Ground Balls" },
    { key: "fb",   label: "Fly Balls" },
    { key: "ld",   label: "Line Drives" },
  ];

  return (
    <div style={CARD_STYLE}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "0.75rem" }}>
        <MapPin size={13} color="#D4A843" />
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: 0 }}>
          Spray Chart
        </p>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#3D4B58" }}>
          {selectedVenue
            ? `${venueHits.length} BIP · ${selectedVenue}`
            : `${data.total} balls in play · all stadiums`
          }
        </span>
      </div>

      {/* Filter buttons */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => { setFilter(f.key); setSelected(null); }}
            style={{
              padding: "3px 8px", borderRadius: "0.5rem", fontSize: 10, fontWeight: 700,
              cursor: "pointer", border: "none",
              background: filter === f.key ? "#13233A" : "rgba(19,35,58,0.07)",
              color: filter === f.key ? "#F6F1E7" : "#3D4B58",
              transition: "all 0.15s",
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {[
          { label: `1B (${singles})`,  color: "#22c55e" },
          { label: `2B (${doubles})`,  color: "#3b82f6" },
          { label: `3B (${triples})`,  color: "#a855f7" },
          { label: `HR (${hrs})`,      color: "#D4A843" },
          { label: `Out (${outs})`,    color: "rgba(100,100,100,0.5)" },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, border: "1px solid rgba(0,0,0,0.15)" }} />
            <span style={{ fontSize: 9, color: "#3D4B58", fontWeight: 600 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* SVG Baseball Field */}
      <div style={{ position: "relative", width: "100%", touchAction: "manipulation" }}>
        <svg
          viewBox="0 0 250 250"
          style={{ width: "100%", height: "auto", display: "block" }}
          onClick={() => setSelected(null)}
        >
          {/* Sky / outfield background */}
          <rect x="0" y="0" width="250" height="250" fill="#4a7c3f" />

          {/* Outfield warning track arc */}
          <path
            d="M 20 230 A 150 150 0 0 1 230 230"
            fill="none" stroke="#8B7355" strokeWidth="8" opacity="0.6"
          />

          {/* Outfield grass (full arc fill) */}
          <path
            d="M 20 230 A 150 150 0 0 1 230 230 L 125 230 Z"
            fill="#4a7c3f"
          />
          {/* Fair territory fill - lighter grass */}
          <path
            d="M 125 204 L 20 230 A 150 150 0 0 1 230 230 Z"
            fill="#5a9c4f"
          />

          {/* Foul lines */}
          <line x1="125.42" y1="204.5" x2="20" y2="50" stroke="white" strokeWidth="1.2" opacity="0.8" />
          <line x1="125.42" y1="204.5" x2="230" y2="50" stroke="white" strokeWidth="1.2" opacity="0.8" />

          {/* Infield dirt circle */}
          <circle cx="125.42" cy="155" r="55" fill="#c4a875" opacity="0.7" />

          {/* Base paths */}
          <polygon points="125,120 90,155 125,190 160,155" fill="#5a9c4f" opacity="0.9" />

          {/* Bases */}
          {/* 2nd base (top) */}
          <rect x="119" y="114" width="12" height="12" fill="white" transform="rotate(45 125 120)" />
          {/* 1st base (right) */}
          <rect x="154" y="149" width="12" height="12" fill="white" transform="rotate(45 160 155)" />
          {/* 3rd base (left) */}
          <rect x="84" y="149" width="12" height="12" fill="white" transform="rotate(45 90 155)" />
          {/* Home plate */}
          <polygon points="125,208 120,213 120,220 130,220 130,213" fill="white" />

          {/* Pitcher's mound */}
          <circle cx="125.42" cy="152" r="5" fill="#c4a875" stroke="#a08050" strokeWidth="1" />

          {/* Hit dots */}
          {filtered.map((h, i) => {
            const isSelected = selected === h;
            const color = hitColor(h.event);
            const isHit = isHitEvent(h.event);
            return (
              <g key={i} onClick={e => { e.stopPropagation(); setSelected(isSelected ? null : h); }}>
                <circle
                  cx={h.x}
                  cy={h.y}
                  r={isSelected ? 6 : isHit ? 4.5 : 3.5}
                  fill={color}
                  stroke={isSelected ? "#131A24" : "rgba(0,0,0,0.3)"}
                  strokeWidth={isSelected ? 1.5 : 0.5}
                  opacity={isSelected ? 1 : 0.82}
                  style={{ cursor: "pointer", transition: "r 0.15s" }}
                />
              </g>
            );
          })}
        </svg>

        {/* Selected hit detail tooltip */}
        {selected && (
          <div style={{
            position: "absolute", bottom: 8, left: 8, right: 8,
            background: "rgba(19,35,58,0.92)", borderRadius: "0.75rem",
            padding: "0.6rem 0.75rem",
            backdropFilter: "blur(4px)",
            border: `1.5px solid ${hitColor(selected.event)}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: hitColor(selected.event), flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: "#F6F1E7" }}>{selected.event}</span>
              {selected.trajectory && (
                <span style={{ fontSize: 10, color: "#D4A843", textTransform: "capitalize" }}>
                  · {selected.trajectory.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {selected.speed != null && (
                <span style={{ fontSize: 10, color: "#F6F1E7" }}>
                  <span style={{ color: "#D4A843", fontWeight: 700 }}>{selected.speed}</span> mph EV
                </span>
              )}
              {selected.angle != null && (
                <span style={{ fontSize: 10, color: "#F6F1E7" }}>
                  <span style={{ color: "#D4A843", fontWeight: 700 }}>{selected.angle}°</span> LA
                </span>
              )}
              {selected.distance != null && (
                <span style={{ fontSize: 10, color: "#F6F1E7" }}>
                  <span style={{ color: "#D4A843", fontWeight: 700 }}>{selected.distance}</span> ft
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tap hint */}
      <p style={{ fontSize: 9, color: "#3D4B58", textAlign: "center", margin: "0.4rem 0 0" }}>
        Tap any dot for exit velocity, launch angle &amp; distance
      </p>
    </div>
  );
}

function ParkTab({ player }: { player: PlayerData }) {
  const isMlb = player.sport === "MLB";
  const [selectedStat, setSelectedStat] = useState("avg");
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [filterDiv, setFilterDiv] = useState<string>("All");

  const parkUrl = isMlb && player.mlbamId
    ? `/api/intel/park-splits/${player.mlbamId}`
    : null;
  const {
    data: parkData,
    isFetching: parkLoading,
    error: parkError,
    refetch: refetchPark,
  } = useQuery<ParkSplitData>({
    queryKey: ["park-splits", player.espnId],
    queryFn: () => fetch(parkUrl!).then((r) => r.json()),
    enabled: !!parkUrl,
  });

  const home = parkData?.home ?? player.splits?.home;
  const away = parkData?.away ?? player.splits?.away;

  const MLB_SPLIT_ROWS = [
    { key: "avg",         label: "AVG",   fmt: fmtAvg },
    { key: "obp",         label: "OBP",   fmt: fmtAvg },
    { key: "slg",         label: "SLG",   fmt: fmtAvg },
    { key: "ops",         label: "OPS",   fmt: fmtAvg },
    { key: "hr",          label: "HR",    fmt: (v: any) => fmtNum(v) },
    { key: "hits",        label: "H",     fmt: (v: any) => fmtNum(v) },
    { key: "doubles",     label: "2B",    fmt: (v: any) => fmtNum(v) },
    { key: "triples",     label: "3B",    fmt: (v: any) => fmtNum(v) },
    { key: "rbi",         label: "RBI",   fmt: (v: any) => fmtNum(v) },
    { key: "runs",        label: "R",     fmt: (v: any) => fmtNum(v) },
    { key: "walks",       label: "BB",    fmt: (v: any) => fmtNum(v) },
    { key: "strikeOuts",  label: "K",     fmt: (v: any) => fmtNum(v) },
    { key: "stolenBases", label: "SB",    fmt: (v: any) => fmtNum(v) },
    { key: "atBats",      label: "AB",    fmt: (v: any) => fmtNum(v) },
    { key: "gamesPlayed", label: "G",     fmt: (v: any) => fmtNum(v) },
  ];

  function SplitRow({ label, homeVal, awayVal }: { label: string; homeVal: any; awayVal: any }) {
    const h = parseFloat(String(homeVal ?? 0)) || 0;
    const a = parseFloat(String(awayVal ?? 0)) || 0;
    const homeWins = h > a;
    const awayWins = a > h;
    const homeStr = homeVal != null && homeVal !== "" ? String(homeVal) : "—";
    const awayStr = awayVal != null && awayVal !== "" ? String(awayVal) : "—";
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "0.4rem 0", borderBottom: "1px solid rgba(19,35,58,0.06)" }}>
        <span style={{ textAlign: "right", fontWeight: homeWins ? 800 : 500, color: homeWins ? "#22c55e" : "#131A24", fontSize: 13 }}>{homeStr}</span>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#3D4B58", minWidth: 36, textAlign: "center" }}>{label}</span>
        <span style={{ textAlign: "left", fontWeight: awayWins ? 800 : 500, color: awayWins ? "#22c55e" : "#131A24", fontSize: 13 }}>{awayStr}</span>
      </div>
    );
  }

  function ParkFactorBar({ value, label }: { value: number; label: string }) {
    const isHitter = value > 1.05;
    const isPitcher = value < 0.95;
    const color = isHitter ? "#22c55e" : isPitcher ? "#ef4444" : "#3D4B58";
    const pct = Math.min(100, Math.max(0, ((value - 0.7) / 0.8) * 100));
    return (
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 900, color }}>
            {value.toFixed(2)} · {isHitter ? "Hitter-Friendly" : isPitcher ? "Pitcher-Friendly" : "Neutral"}
          </span>
        </div>
        <div style={{ height: 6, background: "rgba(19,35,58,0.08)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
        </div>
      </div>
    );
  }

  // Non-MLB: simple home/away
  if (!isMlb) {
    const splits = player.splits;
    if (!splits) {
      return (
        <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>No venue split data available for {player.sport} players.</p>
        </div>
      );
    }
    const splitKeys = Object.keys(splits.home).slice(0, 10);
    return (
      <div style={CARD_STYLE}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", marginBottom: "0.75rem" }}>
          <span style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: "#131A24", textTransform: "uppercase", letterSpacing: "0.05em" }}>Home</span>
          <span style={{ minWidth: 40 }} />
          <span style={{ fontWeight: 700, fontSize: 12, color: "#131A24", textTransform: "uppercase", letterSpacing: "0.05em" }}>Away</span>
        </div>
        {splitKeys.map(k => (
          <SplitRow key={k} label={k.toUpperCase()} homeVal={splits.home[k]} awayVal={splits.away[k]} />
        ))}
      </div>
    );
  }

  // Build venue data map: merge API data with all 30 stadiums
  const venueMap = new Map<string, any>();
  if (parkData?.venues) {
    for (const v of parkData.venues) {
      venueMap.set(String(v.venue ?? ""), v);
    }
  }

  const selectedStatCfg = STAT_OPTIONS.find(s => s.key === selectedStat) ?? STAT_OPTIONS[0];

  // Get values for chart bars — only venues with data
  const venuesWithData = ALL_MLB_STADIUMS
    .map(s => ({ ...s, apiData: venueMap.get(s.venue) ?? null }))
    .filter(s => s.apiData != null);

  const chartVals = venuesWithData.map(s => {
    const raw = s.apiData?.[selectedStatCfg.key];
    return parseFloat(String(raw ?? 0)) || 0;
  });
  const chartMax = Math.max(...chartVals, selectedStatCfg.isRate ? 0.1 : 1);

  // Active venue detail
  const activeVenueRow = selectedVenue
    ? ALL_MLB_STADIUMS.find(s => s.venue === selectedVenue)
    : null;
  const activeVenueData = selectedVenue ? venueMap.get(selectedVenue) : null;

  const divisions = ["All", "NL East", "NL Central", "NL West", "AL East", "AL Central", "AL West"];

  const filteredStadiums = ALL_MLB_STADIUMS.filter(s =>
    filterDiv === "All" || s.div === filterDiv
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {parkLoading && <Spinner />}
      {parkError && <ErrorCard message="Failed to load park split data." onRetry={() => refetchPark()} />}

      {/* ── Home / Away full splits ── */}
      {(home || away) && !parkLoading && (
        <div style={CARD_STYLE}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", marginBottom: "0.75rem" }}>
            <span style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: "#131A24", textTransform: "uppercase", letterSpacing: "0.05em" }}>Home</span>
            <span style={{ minWidth: 40 }} />
            <span style={{ fontWeight: 700, fontSize: 12, color: "#131A24", textTransform: "uppercase", letterSpacing: "0.05em" }}>Away</span>
          </div>
          {MLB_SPLIT_ROWS.map(({ key, label, fmt }) => {
            const hVal = home?.[key];
            const aVal = away?.[key];
            if (hVal == null && aVal == null) return null;
            return (
              <SplitRow key={key} label={label}
                homeVal={hVal != null ? fmt(hVal) : "—"}
                awayVal={aVal != null ? fmt(aVal) : "—"}
              />
            );
          })}
        </div>
      )}

      {/* ── Interactive Ballpark Chart ── */}
      {!parkLoading && (
        <div style={CARD_STYLE}>
          {/* Header + stat selector */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MapPin size={13} color="#D4A843" />
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: 0 }}>
                Ballpark Performance
              </p>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {STAT_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => setSelectedStat(opt.key)}
                  style={{
                    padding: "3px 8px", borderRadius: "0.5rem", fontSize: 10, fontWeight: 700,
                    cursor: "pointer", border: "none",
                    background: selectedStat === opt.key ? "#13233A" : "rgba(19,35,58,0.07)",
                    color: selectedStat === opt.key ? "#F6F1E7" : "#3D4B58",
                    transition: "all 0.15s",
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          {/* Division filter */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "0.75rem" }}>
            {divisions.map(d => (
              <button key={d} onClick={() => setFilterDiv(d)}
                style={{
                  padding: "2px 7px", borderRadius: "0.4rem", fontSize: 9, fontWeight: 700,
                  cursor: "pointer", border: "none",
                  background: filterDiv === d ? "#D4A843" : "rgba(19,35,58,0.06)",
                  color: filterDiv === d ? "#131A24" : "#3D4B58",
                  transition: "all 0.15s",
                }}
              >{d}</button>
            ))}
          </div>

          {/* Chart area */}
          {venuesWithData.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#3D4B58", margin: 0 }}>No career ballpark performance data available for {player.name}.</p>
              <p style={{ fontSize: 11, color: "#3D4B58", margin: "0.5rem 0 0" }}>Career data spans the last 5 seasons and populates once loaded.</p>
            </div>
          ) : (
            <>
              {/* Bar chart */}
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, minWidth: filteredStadiums.length * 44, height: 110, paddingBottom: 24, position: "relative" }}>
                  {/* Baseline */}
                  <div style={{ position: "absolute", bottom: 24, left: 0, right: 0, height: 1, background: "rgba(19,35,58,0.10)" }} />
                  {filteredStadiums.map(s => {
                    const vData = venueMap.get(s.venue);
                    const rawVal = vData ? parseFloat(String(vData[selectedStatCfg.key] ?? 0)) || 0 : 0;
                    const hasData = vData != null && rawVal > 0;
                    const barPct = hasData ? Math.min(100, (rawVal / chartMax) * 100) : 0;
                    const BAR_MAX_H = 72;
                    const barH = hasData ? Math.max(4, (barPct / 100) * BAR_MAX_H) : 0;
                    const isSelected = selectedVenue === s.venue;
                    const color = !hasData
                      ? "rgba(19,35,58,0.10)"
                      : selectedStatCfg.isRate
                        ? (rawVal >= chartMax * 0.7 ? "#22c55e" : rawVal >= chartMax * 0.4 ? "#D4A843" : "#ef4444")
                        : (rawVal >= chartMax * 0.6 ? "#22c55e" : rawVal >= chartMax * 0.3 ? "#D4A843" : "rgba(19,35,58,0.25)");
                    const displayVal = hasData ? selectedStatCfg.fmt(rawVal) : null;

                    return (
                      <div key={s.venue}
                        onClick={() => setSelectedVenue(isSelected ? null : s.venue)}
                        style={{
                          flex: "0 0 38px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          cursor: "pointer",
                          gap: 2,
                          paddingBottom: 2,
                          position: "relative",
                        }}
                        title={`${s.venue} (${s.abbr})`}
                      >
                        {/* Value label above bar */}
                        {hasData && (
                          <span style={{ fontSize: 7.5, fontWeight: 800, color: isSelected ? "#131A24" : color, whiteSpace: "nowrap", marginBottom: 1 }}>
                            {displayVal}
                          </span>
                        )}
                        {!hasData && (
                          <span style={{ fontSize: 7, color: "rgba(19,35,58,0.25)", marginBottom: 1 }}>—</span>
                        )}
                        {/* Bar */}
                        <div style={{
                          width: "100%",
                          height: hasData ? barH : 4,
                          background: isSelected ? "#13233A" : color,
                          borderRadius: "3px 3px 0 0",
                          transition: "all 0.25s ease",
                          border: isSelected ? "2px solid #D4A843" : "none",
                          boxSizing: "border-box",
                          alignSelf: "flex-end",
                        }} />
                        {/* Team abbr label */}
                        <span style={{
                          position: "absolute",
                          bottom: 2,
                          fontSize: 7.5,
                          fontWeight: isSelected ? 900 : 600,
                          color: isSelected ? "#131A24" : hasData ? "#3D4B58" : "rgba(19,35,58,0.30)",
                          textAlign: "center",
                          lineHeight: 1,
                        }}>
                          {s.abbr}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 10, marginTop: "0.25rem", flexWrap: "wrap" }}>
                {selectedStatCfg.isRate ? (
                  <>
                    <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 700 }}>■ Elite (&gt;70% of best)</span>
                    <span style={{ fontSize: 9, color: "#D4A843", fontWeight: 700 }}>■ Good (&gt;40%)</span>
                    <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 700 }}>■ Below avg</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 700 }}>■ High production</span>
                    <span style={{ fontSize: 9, color: "#D4A843", fontWeight: 700 }}>■ Mid production</span>
                  </>
                )}
                <span style={{ fontSize: 9, color: "rgba(19,35,58,0.30)", fontWeight: 700 }}>■ No data</span>
                <span style={{ fontSize: 9, color: "#3D4B58" }}>· Tap a bar for details</span>
              </div>
            </>
          )}

          {/* ── Selected Venue Detail Panel ── */}
          {selectedVenue && (
            <div style={{
              marginTop: "0.75rem",
              background: "rgba(19,35,58,0.04)",
              border: "1px solid rgba(19,35,58,0.12)",
              borderRadius: "0.75rem",
              padding: "0.9rem",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 900, fontSize: 14, color: "#131A24" }}>{selectedVenue}</p>
                  {activeVenueRow && (
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#3D4B58" }}>
                      {activeVenueRow.team} · {activeVenueRow.div}
                      {activeVenueRow.dome ? " · 🏟 Dome" : ""}
                    </p>
                  )}
                </div>
                <button onClick={() => setSelectedVenue(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#3D4B58", padding: 4 }}>
                  <X size={14} />
                </button>
              </div>

              {activeVenueData ? (
                <>
                  {/* Stat grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: "0.4rem", marginBottom: "0.75rem" }}>
                    {[
                      ["G",   fmtNum(activeVenueData.gamesPlayed)],
                      ["AB",  fmtNum(activeVenueData.atBats)],
                      ["H",   fmtNum(activeVenueData.hits)],
                      ["2B",  fmtNum(activeVenueData.doubles)],
                      ["HR",  fmtNum(activeVenueData.hr),],
                      ["RBI", fmtNum(activeVenueData.rbi)],
                      ["R",   fmtNum(activeVenueData.runs)],
                      ["BB",  fmtNum(activeVenueData.walks)],
                      ["K",   fmtNum(activeVenueData.strikeOuts)],
                      ["SB",  fmtNum(activeVenueData.stolenBases)],
                      ["AVG", fmtAvg(activeVenueData.avg)],
                      ["OBP", fmtAvg(activeVenueData.obp)],
                      ["SLG", fmtAvg(activeVenueData.slg)],
                      ["OPS", fmtAvg(activeVenueData.ops)],
                    ].filter(([, v]) => v !== "—" && v !== null).map(([label, value]) => {
                      const isAvg = label === "AVG";
                      const isOps = label === "OPS";
                      const numV = parseFloat(String(value));
                      const hi = (isAvg && numV >= 0.3) || (isOps && numV >= 0.8);
                      return (
                        <StatChip key={String(label)} label={String(label)} value={String(value ?? "—")} highlight={hi} />
                      );
                    })}
                  </div>

                  {/* Stat bars for all rate stats */}
                  {STAT_OPTIONS.filter(o => o.isRate).map(opt => {
                    const raw = parseFloat(String(activeVenueData[opt.key] ?? 0)) || 0;
                    if (raw === 0) return null;
                    const pct = Math.min(100, (raw / opt.max) * 100);
                    const color = raw >= opt.max * 0.65 ? "#22c55e" : raw >= opt.max * 0.45 ? "#D4A843" : "#ef4444";
                    return (
                      <div key={opt.key} style={{ marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>{opt.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 900, color }}>{opt.fmt(raw)}</span>
                        </div>
                        <div style={{ height: 6, background: "rgba(19,35,58,0.08)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    );
                  })}

                  {/* Park Factor */}
                  {(() => {
                    const pf = activeVenueData.parkFactor as any;
                    const pfHit = typeof pf === "object" && pf !== null ? pf.hit ?? pf.hitFactor : (typeof pf === "number" ? pf : null);
                    const pfHr  = typeof pf === "object" && pf !== null ? pf.hr  ?? pf.hrFactor  : null;
                    if (pfHit == null) return null;
                    return (
                      <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(19,35,58,0.08)" }}>
                        <p style={{ fontSize: 10, fontWeight: 700, color: "#D4A843", textTransform: "uppercase", margin: "0 0 0.4rem" }}>Park Factor</p>
                        <ParkFactorBar value={pfHit} label="Hit Factor" />
                        {pfHr != null && <ParkFactorBar value={pfHr} label="HR Factor" />}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "0.75rem 0" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>{player.name} has no career data at {selectedVenue} in the last 5 seasons.</p>
                  <p style={{ margin: "0.4rem 0 0", fontSize: 11, color: "#3D4B58" }}>No stats available yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── All Stadiums Grid (data status at a glance) ── */}
      {!parkLoading && (
        <div style={CARD_STYLE}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
            All 30 Stadiums
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "0.4rem" }}>
            {ALL_MLB_STADIUMS.map(s => {
              const vData = venueMap.get(s.venue);
              const hasData = vData != null;
              const avg = hasData ? parseFloat(String(vData.avg ?? 0)) || 0 : 0;
              const isSelected = selectedVenue === s.venue;
              const bgColor = !hasData
                ? "rgba(19,35,58,0.04)"
                : avg >= 0.3
                  ? "rgba(34,197,94,0.10)"
                  : avg >= 0.22
                    ? "rgba(212,168,67,0.10)"
                    : "rgba(239,68,68,0.07)";
              const borderColor = !hasData
                ? "rgba(19,35,58,0.10)"
                : avg >= 0.3
                  ? "rgba(34,197,94,0.30)"
                  : avg >= 0.22
                    ? "rgba(212,168,67,0.30)"
                    : "rgba(239,68,68,0.25)";
              return (
                <button
                  key={s.venue}
                  onClick={() => setSelectedVenue(isSelected ? null : s.venue)}
                  style={{
                    background: isSelected ? "#13233A" : bgColor,
                    border: `1px solid ${isSelected ? "#D4A843" : borderColor}`,
                    borderRadius: "0.6rem",
                    padding: "0.4rem 0.3rem",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: isSelected ? "#F6F1E7" : "#131A24" }}>{s.abbr}</p>
                  {hasData ? (
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: isSelected ? "#D4A843" : avg >= 0.3 ? "#22c55e" : avg >= 0.22 ? "#D4A843" : "#ef4444" }}>
                      {fmtAvg(avg)}
                    </p>
                  ) : (
                    <p style={{ margin: 0, fontSize: 9, color: "rgba(19,35,58,0.30)" }}>No data</p>
                  )}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 9, color: "#3D4B58", margin: "0.5rem 0 0" }}>
            Color = career AVG at that park (last 5 seasons). Tap any stadium for details. {venuesWithData.length}/30 stadiums visited.
          </p>
        </div>
      )}

      {/* ── Spray Chart ── */}
      <SprayChart player={player} selectedVenue={selectedVenue} />

      {/* ── Park Factor summary (home park) ── */}
      {parkData?.parkFactor && (
        <div style={CARD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "0.75rem" }}>
            <MapPin size={12} color="#3D4B58" />
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: 0 }}>
              Home Park Factor{parkData.parkFactor.name ? ` · ${parkData.parkFactor.name}` : ""}
            </p>
          </div>
          <ParkFactorBar value={parkData.parkFactor.hit} label="Hit Factor" />
          <ParkFactorBar value={parkData.parkFactor.hr} label="HR Factor" />
          <p style={{ fontSize: 11, color: "#3D4B58", margin: "0.75rem 0 0", lineHeight: 1.5 }}>
            {parkData.parkFactor.hit > 1.05
              ? "This park inflates offensive production — batters hit at a higher rate here than league average."
              : parkData.parkFactor.hit < 0.95
              ? "This is a pitcher-friendly park — expect suppressed offensive numbers relative to league average."
              : "This park is relatively neutral — stats should reflect true player ability without significant park bias."}
          </p>
        </div>
      )}

      {/* ── No data at all ── */}
      {!parkLoading && !parkError && !home && !away && !parkData?.venues && (
        <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>No park split data available. MLBAM ID may not be resolved for this player.</p>
        </div>
      )}
    </div>
  );
}

// ─── Deep Dive Tab ────────────────────────────────────────────────────────────

function DeepDiveTab({ player }: { player: PlayerData }) {
  const isMlb = player.sport === "MLB";
  const gamelog = player.gamelog ?? [];

  // Primary stat key per sport/position
  const primaryKey = isMlb ? "H" : player.sport === "NBA" ? "PTS" : player.sport === "NHL" ? "G" : "YDS";
  const primaryLabel = isMlb ? "Hits" : player.sport === "NBA" ? "Points" : player.sport === "NHL" ? "Goals" : "Yards";

  // Secondary stat keys for multi-stat comparison
  const secondaryKeys: { key: string; label: string }[] = isMlb
    ? [{ key: "HR", label: "HR" }, { key: "RBI", label: "RBI" }, { key: "TB", label: "TB" }]
    : player.sport === "NBA"
    ? [{ key: "REB", label: "REB" }, { key: "AST", label: "AST" }]
    : player.sport === "NHL"
    ? [{ key: "A", label: "AST" }, { key: "PTS", label: "PTS" }]
    : player.position === "QB"
    ? [{ key: "TD", label: "TD" }, { key: "INT", label: "INT" }]
    : player.position === "RB"
    ? [{ key: "CAR", label: "CAR" }, { key: "TD", label: "TD" }]
    : [{ key: "REC", label: "REC" }, { key: "TD", label: "TD" }];

  // Window slices (most recent first)
  const L5   = gamelog.slice(0, 5);
  const L10  = gamelog.slice(0, 10);
  const L30  = gamelog.slice(0, 30);
  const full = gamelog;

  function windowAvg(games: typeof gamelog, key: string): number {
    if (!games.length) return 0;
    const vals = games.map(g => parseFloat(String(g[key] ?? "0")) || 0);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function windowTotal(games: typeof gamelog, key: string): number {
    return games.map(g => parseFloat(String(g[key] ?? "0")) || 0).reduce((a, b) => a + b, 0);
  }

  // Career high for primary stat
  const allVals = full.map(g => parseFloat(String(g[primaryKey] ?? "0")) || 0);
  const careerHigh = allVals.length ? Math.max(...allVals) : 0;
  const careerHighGame = allVals.length ? full[allVals.indexOf(careerHigh)] : null;

  // Consistency: % of games where primary stat >= floor threshold
  const threshold = isMlb ? 1 : player.sport === "NBA" ? 10 : player.sport === "NHL" ? 1 : 50;
  const consistencyGames = full.length ? full.filter(g => (parseFloat(String(g[primaryKey] ?? "0")) || 0) >= threshold).length : 0;
  const consistencyPct = full.length ? (consistencyGames / full.length) * 100 : 0;

  // Trend: L5 vs prior 5
  const first5Vals = gamelog.slice(5, 10).map(g => parseFloat(String(g[primaryKey] ?? "0")) || 0);
  const last5Vals  = gamelog.slice(0, 5).map(g => parseFloat(String(g[primaryKey] ?? "0")) || 0);
  const first5Avg = first5Vals.length ? first5Vals.reduce((a, b) => a + b, 0) / first5Vals.length : 0;
  const last5Avg  = last5Vals.length  ? last5Vals.reduce((a, b) => a + b, 0) / last5Vals.length : 0;
  const trend = last5Avg > first5Avg * 1.1 ? "up" : last5Avg < first5Avg * 0.9 ? "down" : "stable";

  // Statcast color rating helper
  function rateStatcast(key: string, value: number): { label: string; color: string } {
    const ranges: Record<string, { elite: number; good: number; below: number }> = {
      xba: { elite: 0.31, good: 0.27, below: 0.23 },
      xwoba: { elite: 0.38, good: 0.33, below: 0.29 },
      hh_pct: { elite: 50, good: 42, below: 36 },
      barrel_pct: { elite: 12, good: 8, below: 4 },
      ev50: { elite: 96, good: 92, below: 88 },
      babip: { elite: 0.35, good: 0.31, below: 0.27 },
      k_pct: { elite: 10, good: 16, below: 22 },
      bb_pct: { elite: 12, good: 9, below: 6 },
    };
    const r = ranges[key.toLowerCase()];
    if (!r) return { label: "Avg", color: "#3D4B58" };
    const lowerBetter = key.toLowerCase() === "k_pct" || key.toLowerCase() === "whiff_pct";
    if (lowerBetter) {
      if (value <= r.elite) return { label: "Elite", color: "#22c55e" };
      if (value <= r.good) return { label: "Good", color: "#D4A843" };
      if (value >= r.below) return { label: "Below Avg", color: "#ef4444" };
      return { label: "Avg", color: "#3D4B58" };
    }
    if (value >= r.elite) return { label: "Elite", color: "#22c55e" };
    if (value >= r.good) return { label: "Good", color: "#D4A843" };
    if (value <= r.below) return { label: "Below Avg", color: "#ef4444" };
    return { label: "Avg", color: "#3D4B58" };
  }

  const sc = player.statcast ?? {};

  // Rolling window comparison bar component
  function RollingRow({ label, l5, l10, l30, season, max }: { label: string; l5: number; l10: number; l30: number; season: number; max: number }) {
    if (max === 0) return null;
    const windows = [
      { lbl: "L5",  val: l5,     color: "#D4A843" },
      { lbl: "L10", val: l10,    color: "#2563eb" },
      { lbl: "L30", val: l30,    color: "#9333ea" },
      { lbl: "Full",val: season, color: "#3D4B58" },
    ];
    return (
      <div style={{ marginBottom: "1rem" }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase", margin: "0 0 0.4rem" }}>{label} / Game</p>
        {windows.map(({ lbl, val, color }) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#3D4B58", minWidth: 28, textTransform: "uppercase" }}>{lbl}</span>
            <div style={{ flex: 1, height: 8, background: "rgba(19,35,58,0.07)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (val / max) * 100)}%`, background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 800, color, minWidth: 32, textAlign: "right" }}>{val.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* ── Rolling Averages Multi-Window ── */}
      {gamelog.length >= 3 && (
        <div style={CARD_STYLE}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 1rem" }}>
            Rolling Averages
          </p>
          {(() => {
            const primaryL5  = windowAvg(L5, primaryKey);
            const primaryL10 = windowAvg(L10, primaryKey);
            const primaryL30 = windowAvg(L30, primaryKey);
            const primaryFull= windowAvg(full, primaryKey);
            const maxPrimary = Math.max(primaryL5, primaryL10, primaryL30, primaryFull, 1);
            return (
              <RollingRow label={primaryLabel}
                l5={primaryL5} l10={primaryL10} l30={primaryL30} season={primaryFull} max={maxPrimary} />
            );
          })()}
          {secondaryKeys.map(({ key, label }) => {
            const l5v  = windowAvg(L5, key);
            const l10v = windowAvg(L10, key);
            const l30v = windowAvg(L30, key);
            const fv   = windowAvg(full, key);
            const mx   = Math.max(l5v, l10v, l30v, fv, 1);
            if (mx <= 0.05) return null;
            return (
              <RollingRow key={key} label={label}
                l5={l5v} l10={l10v} l30={l30v} season={fv} max={mx} />
            );
          })}
        </div>
      )}

      {/* ── Trend Summary ── */}
      {gamelog.length >= 5 && (
        <div style={{ ...CARD_STYLE, display: "flex", alignItems: "center", gap: 12, padding: "0.9rem 1.25rem" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: trend === "up" ? "rgba(34,197,94,0.12)" : trend === "down" ? "rgba(239,68,68,0.12)" : "rgba(19,35,58,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {trend === "up" ? <ArrowUp size={18} color="#22c55e" /> : trend === "down" ? <ArrowDown size={18} color="#ef4444" /> : <Minus size={18} color="#3D4B58" />}
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#131A24" }}>
              {trend === "up" ? "Trending Up 📈" : trend === "down" ? "Trending Down 📉" : "Stable Form"}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#3D4B58" }}>
              L5 avg: <strong>{last5Avg.toFixed(1)}</strong> {primaryLabel} · Prior 5 avg: <strong>{first5Avg.toFixed(1)}</strong>
            </p>
          </div>
        </div>
      )}

      {/* ── Consistency Rating ── */}
      {full.length >= 5 && (
        <div style={CARD_STYLE}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
            Consistency Rating
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "0.75rem" }}>
            <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
              <svg width="60" height="60" viewBox="0 0 60 60">
                <circle cx="30" cy="30" r="24" fill="none" stroke="rgba(19,35,58,0.10)" strokeWidth="6" />
                <circle cx="30" cy="30" r="24" fill="none"
                  stroke={consistencyPct >= 70 ? "#22c55e" : consistencyPct >= 50 ? "#D4A843" : "#ef4444"}
                  strokeWidth="6"
                  strokeDasharray={`${(consistencyPct / 100) * 150.8} 150.8`}
                  strokeLinecap="round"
                  transform="rotate(-90 30 30)"
                />
                <text x="30" y="34" textAnchor="middle" fontSize="13" fontWeight="900" fill="#131A24">
                  {Math.round(consistencyPct)}%
                </text>
              </svg>
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: consistencyPct >= 70 ? "#22c55e" : consistencyPct >= 50 ? "#D4A843" : "#ef4444" }}>
                {consistencyPct >= 70 ? "Very Consistent" : consistencyPct >= 50 ? "Moderately Consistent" : "Inconsistent"}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: 11, color: "#3D4B58" }}>
                {consistencyGames} of {full.length} games with {threshold}+ {primaryLabel.toLowerCase()}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 10, color: "#3D4B58" }}>
                Based on full {full.length}-game sample
              </p>
            </div>
          </div>
          {/* Window-by-window consistency */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.4rem" }}>
            {[
              { label: "L5", games: L5 },
              { label: "L10", games: L10 },
              { label: "L30", games: L30 },
            ].map(({ label, games }) => {
              if (!games.length) return null;
              const ct = games.filter(g => (parseFloat(String(g[primaryKey] ?? "0")) || 0) >= threshold).length;
              const pct = (ct / games.length) * 100;
              return (
                <div key={label} style={{ background: "rgba(19,35,58,0.04)", borderRadius: "0.75rem", padding: "0.5rem", textAlign: "center", border: "1px solid rgba(19,35,58,0.08)" }}>
                  <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: "#3D4B58", textTransform: "uppercase" }}>{label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 900, color: pct >= 70 ? "#22c55e" : pct >= 50 ? "#D4A843" : "#ef4444" }}>{ct}/{games.length}</p>
                  <p style={{ margin: 0, fontSize: 9, color: "#3D4B58" }}>{Math.round(pct)}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Career Highs & Multi-stat summary ── */}
      {full.length >= 3 && (
        <div style={CARD_STYLE}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: "0 0 0.75rem" }}>
            Career Highs (This Sample)
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: "0.5rem", marginBottom: "0.75rem" }}>
            {/* Primary stat career high */}
            <div style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.25)", borderRadius: "0.75rem", padding: "0.5rem 0.6rem", textAlign: "center" }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#3D4B58", margin: 0 }}>Best {primaryLabel}</p>
              <p style={{ fontSize: 20, fontWeight: 900, color: "#D4A843", margin: "2px 0 0" }}>{careerHigh}</p>
              {careerHighGame && (
                <p style={{ fontSize: 8, color: "#3D4B58", margin: 0 }}>
                  {String(careerHighGame.date_game ?? careerHighGame.date ?? "").slice(5, 10)}
                  {careerHighGame.opp ? ` vs ${careerHighGame.opp}` : ""}
                </p>
              )}
            </div>
            {/* Secondary stat highs */}
            {secondaryKeys.map(({ key, label }) => {
              const vals2 = full.map(g => parseFloat(String(g[key] ?? "0")) || 0);
              const hi = vals2.length ? Math.max(...vals2) : 0;
              if (hi === 0) return null;
              return (
                <div key={key} style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.10)", borderRadius: "0.75rem", padding: "0.5rem 0.6rem", textAlign: "center" }}>
                  <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#3D4B58", margin: 0 }}>Best {label}</p>
                  <p style={{ fontSize: 20, fontWeight: 900, color: "#131A24", margin: "2px 0 0" }}>{hi}</p>
                </div>
              );
            })}
            {/* Season total for primary */}
            <div style={{ background: "rgba(19,35,58,0.04)", border: "1px solid rgba(19,35,58,0.10)", borderRadius: "0.75rem", padding: "0.5rem 0.6rem", textAlign: "center" }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#3D4B58", margin: 0 }}>Total {primaryLabel}</p>
              <p style={{ fontSize: 20, fontWeight: 900, color: "#131A24", margin: "2px 0 0" }}>{windowTotal(full, primaryKey)}</p>
            </div>
          </div>
          {/* Multi-stat window table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid rgba(19,35,58,0.12)" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: 700, color: "#3D4B58", fontSize: 10, textTransform: "uppercase" }}>Stat</th>
                  <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: "#D4A843", fontSize: 10 }}>L5</th>
                  <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: "#2563eb", fontSize: 10 }}>L10</th>
                  <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: "#9333ea", fontSize: 10 }}>L30</th>
                  <th style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: "#3D4B58", fontSize: 10 }}>Season</th>
                </tr>
              </thead>
              <tbody>
                {[{ key: primaryKey, label: primaryLabel }, ...secondaryKeys].map(({ key, label }) => {
                  const l5v  = windowAvg(L5, key);
                  const l10v = windowAvg(L10, key);
                  const l30v = windowAvg(L30, key);
                  const fv   = windowAvg(full, key);
                  if (l5v === 0 && l10v === 0 && l30v === 0 && fv === 0) return null;
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid rgba(19,35,58,0.06)" }}>
                      <td style={{ padding: "5px 6px", fontWeight: 700, fontSize: 11, color: "#131A24" }}>{label}</td>
                      <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 800, color: "#D4A843" }}>{l5v.toFixed(1)}</td>
                      <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 600, color: "#2563eb" }}>{l10v.toFixed(1)}</td>
                      <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 600, color: "#9333ea" }}>{l30v.toFixed(1)}</td>
                      <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 600, color: "#3D4B58" }}>{fv.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Bar Chart (primary stat) ── */}
      {L10.length > 0 && (
        <div style={CARD_STYLE}>
          <MiniBarChart games={L10} statKey={primaryKey} label={primaryLabel} />
        </div>
      )}

      {/* ── Statcast Metrics (MLB) ── */}
      {isMlb && (
        <div style={CARD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: 6 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: 0 }}>Statcast Metrics</p>
            <span style={{ fontSize: 10, color: "#3D4B58" }}>via Baseball Savant</span>
          </div>
          {Object.keys(sc).length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: "0.5rem" }}>
              {[
                { key: "xba",        label: "xBA",     fmt: (v: number) => fmtAvg(v) },
                { key: "xwoba",      label: "xwOBA",   fmt: (v: number) => fmtAvg(v) },
                { key: "hh_pct",     label: "HH%",     fmt: (v: number) => fmtPct(v) },
                { key: "barrel_pct", label: "Barrel%", fmt: (v: number) => fmtPct(v) },
                { key: "ev50",       label: "EV50",    fmt: (v: number) => fmtNum(v, 1) },
                { key: "la",         label: "LA°",     fmt: (v: number) => fmtNum(v, 1) },
                { key: "babip",      label: "BABIP",   fmt: (v: number) => fmtAvg(v) },
                { key: "k_pct",      label: "K%",      fmt: (v: number) => fmtPct(v) },
                { key: "bb_pct",     label: "BB%",     fmt: (v: number) => fmtPct(v) },
                { key: "whiff_pct",  label: "Whiff%",  fmt: (v: number) => fmtPct(v) },
              ].filter(({ key }) => sc[key] != null).map(({ key, label, fmt }) => {
                const val = parseFloat(String(sc[key] ?? 0));
                const { label: rLabel, color } = rateStatcast(key, val);
                return (
                  <div key={key} style={{ background: "rgba(19,35,58,0.03)", border: "1px solid rgba(19,35,58,0.10)", borderRadius: "0.75rem", padding: "0.5rem 0.6rem", textAlign: "center" }}>
                    <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#3D4B58", margin: 0 }}>{label}</p>
                    <p style={{ fontSize: 15, fontWeight: 900, color: "#131A24", margin: "2px 0 1px" }}>{fmt(val)}</p>
                    <span style={{ fontSize: 8, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{rLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#3D4B58", textAlign: "center", padding: "0.5rem 0" }}>No Statcast data available for this player.</p>
          )}
        </div>
      )}

      {/* ── Steamer Projections (MLB) ── */}
      {isMlb && player.steamer && (
        <div style={{ ...CARD_STYLE, background: "rgba(212,168,67,0.05)", border: "1px solid rgba(212,168,67,0.20)" }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#D4A843", margin: "0 0 0.75rem" }}>
            ⚡ Steamer Projections
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: "0.5rem" }}>
            {Object.entries(player.steamer).map(([k, v]) => (
              <StatChip key={k} label={k.toUpperCase()} value={String(v ?? "—")} />
            ))}
          </div>
        </div>
      )}

      {/* ── No data fallback ── */}
      {gamelog.length === 0 && Object.keys(sc).length === 0 && !player.steamer && (
        <div style={{ ...CARD_STYLE, textAlign: "center", padding: "1.5rem" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#3D4B58" }}>No game log data available to analyze trends.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlayerIntel() {
  const [activeSport, setActiveSport] = useState<Sport>("All");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);
  const [fetchingPlayer, setFetchingPlayer] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchRef = useRef<HTMLDivElement>(null);

  // Pre-populate search from URL params (e.g., navigating from BTS "Intel" button)
  // wouter's navigate() puts query string in window.location.search (not hash)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qParam = params.get("q");
    const sportParam = params.get("sport") as Sport | null;
    if (qParam) setSearchQuery(decodeURIComponent(qParam));
    if (sportParam && ["MLB","NBA","NFL","NHL"].includes(sportParam)) setActiveSport(sportParam);
  }, []);

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (searchQuery.trim().length < 2) {
      setDebouncedSearch("");
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setShowDropdown(true);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search query
  const searchUrl = debouncedSearch
    ? `/api/intel/search?q=${encodeURIComponent(debouncedSearch)}${activeSport !== "All" ? `&sport=${activeSport}` : ""}`
    : null;

  const { data: searchResults, isFetching: searchLoading } = useQuery<PlayerSearchResult[]>({
    queryKey: ["player-search", debouncedSearch, activeSport],
    queryFn: () => fetch(searchUrl!).then((r) => r.json()),
    enabled: !!searchUrl,
  });

  // Select player from dropdown
  const handleSelectPlayer = useCallback(async (result: PlayerSearchResult) => {
    setShowDropdown(false);
    setSearchQuery(result.name);
    setFetchingPlayer(true);
    setPlayerError(null);
    setActiveTab("overview");
    try {
      const res = await fetch(`/api/intel/player/${result.sport}/${result.espnId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PlayerData = await res.json();
      setSelectedPlayer(data);
    } catch (err) {
      setPlayerError("Failed to load player data. Please try again.");
      setSelectedPlayer(null);
    } finally {
      setFetchingPlayer(false);
    }
  }, []);

  const clearPlayer = useCallback(() => {
    setSelectedPlayer(null);
    setSearchQuery("");
    setPlayerError(null);
    setActiveTab("overview");
  }, []);

  return (
    <div
      style={{
        background: "#F6F1E7",
        minHeight: "100vh",
        color: "#131A24",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* ── Header Bar ── */}
      <div
        style={{
          background: "#F6F1E7",
          borderBottom: "1px solid rgba(19,35,58,0.10)",
          padding: "1rem 1rem 0",
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        {/* Title row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: "0.75rem",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              background: "#13233A",
              borderRadius: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Users size={16} color="#D4A843" />
          </div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 900,
              color: "#131A24",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Player Intel
          </h1>
        </div>

        {/* Sport filter tabs */}
        <div
          style={{
            display: "flex",
            gap: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {SPORTS_TABS.map((sport) => (
            <button
              key={sport}
              onClick={() => setActiveSport(sport)}
              style={{
                padding: "0.5rem 0.9rem",
                background: "none",
                border: "none",
                borderBottom: activeSport === sport ? "2px solid #D4A843" : "2px solid transparent",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: activeSport === sport ? 800 : 500,
                color: activeSport === sport ? "#131A24" : "#3D4B58",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              {sport}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "1.25rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        {/* ── Search Section ── */}
        <div ref={searchRef} style={{ position: "relative" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#fff",
              border: "1.5px solid rgba(19,35,58,0.15)",
              borderRadius: "1rem",
              padding: "0.7rem 1rem",
              boxShadow: "0 2px 10px rgba(19,35,58,0.06)",
            }}
          >
            <Search size={16} color="#3D4B58" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => debouncedSearch && setShowDropdown(true)}
              placeholder="Search any player (MLB, NBA, NFL, NHL)..."
              style={{
                background: "none",
                border: "none",
                outline: "none",
                flex: 1,
                fontSize: 14,
                color: "#131A24",
                minWidth: 0,
              }}
            />
            {searchLoading && (
              <div
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid rgba(19,35,58,0.12)",
                  borderTop: "2px solid #D4A843",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  flexShrink: 0,
                }}
              />
            )}
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setDebouncedSearch("");
                  setShowDropdown(false);
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#3D4B58",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Dropdown */}
          {showDropdown && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                zIndex: 50,
                background: "#fff",
                border: "1px solid rgba(19,35,58,0.15)",
                borderRadius: "1rem",
                boxShadow: "0 12px 40px rgba(19,35,58,0.14)",
                overflow: "hidden",
              }}
            >
              {searchLoading && <Spinner />}
              {!searchLoading && searchResults && searchResults.length > 0 &&
                searchResults.slice(0, 6).map((r) => (
                  <button
                    key={r.espnId}
                    onClick={() => handleSelectPlayer(r)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "0.7rem 1rem",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid rgba(19,35,58,0.06)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(19,35,58,0.03)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <PlayerAvatar player={r} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#131A24", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "#3D4B58" }}>
                        {r.teamAbbr} · {r.position}
                      </p>
                    </div>
                    <SportBadge sport={r.sport} />
                  </button>
                ))}
              {!searchLoading && searchResults && searchResults.length === 0 && (
                <div style={{ padding: "1rem", fontSize: 13, color: "#3D4B58", textAlign: "center" }}>
                  No players found for "{debouncedSearch}"
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Empty state ── */}
        {!selectedPlayer && !fetchingPlayer && !playerError && (
          <div
            style={{
              ...CARD_STYLE,
              textAlign: "center",
              padding: "3rem 1.5rem",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                background: "rgba(19,35,58,0.06)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1rem",
              }}
            >
              <Search size={24} color="#3D4B58" />
            </div>
            <p
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#131A24",
                margin: "0 0 0.5rem",
              }}
            >
              Search for any player
            </p>
            <p style={{ fontSize: 13, color: "#3D4B58", margin: "0 0 1.5rem" }}>
              Get their full analytics profile — stats, matchups, park factors, and projections.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {(["MLB", "NBA", "NFL", "NHL"] as const).map((s) => (
                <SportBadge key={s} sport={s} />
              ))}
            </div>
          </div>
        )}

        {/* ── Loading state ── */}
        {fetchingPlayer && (
          <div style={CARD_STYLE}>
            <Spinner />
            <p style={{ textAlign: "center", fontSize: 13, color: "#3D4B58", marginTop: 0 }}>
              Loading player data...
            </p>
          </div>
        )}

        {/* ── Error state ── */}
        {playerError && (
          <ErrorCard
            message={playerError}
            onRetry={() => {
              setPlayerError(null);
              setSearchQuery("");
            }}
          />
        )}

        {/* ── Player Card ── */}
        {selectedPlayer && !fetchingPlayer && (
          <>
            <div
              style={{
                ...CARD_STYLE,
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <PlayerAvatar player={selectedPlayer} size={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <h2
                    style={{
                      fontSize: 18,
                      fontWeight: 900,
                      color: "#131A24",
                      margin: 0,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {selectedPlayer.name}
                  </h2>
                  <SportBadge sport={selectedPlayer.sport} />
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "#3D4B58", fontWeight: 500 }}>
                  {selectedPlayer.team} · {selectedPlayer.position}
                </p>
                {/* Quick season stats strip */}
                {selectedPlayer.season && (
                  <div
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      marginTop: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {selectedPlayer.sport === "MLB" && (
                      <>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtAvg(selectedPlayer.season.avg ?? selectedPlayer.season.AVG)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>AVG</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.hr ?? selectedPlayer.season.HR)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>HR</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.rbi ?? selectedPlayer.season.RBI)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>RBI</span>
                        </span>
                      </>
                    )}
                    {selectedPlayer.sport === "NBA" && (
                      <>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.ppg ?? selectedPlayer.season.PTS, 1)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>PPG</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.rpg ?? selectedPlayer.season.REB, 1)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>RPG</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.apg ?? selectedPlayer.season.AST, 1)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>APG</span>
                        </span>
                      </>
                    )}
                    {selectedPlayer.sport === "NHL" && (
                      <>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.g ?? selectedPlayer.season.G)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>G</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.a ?? selectedPlayer.season.A)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>A</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#131A24" }}>
                          <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.pts ?? selectedPlayer.season.PTS)}</span>{" "}
                          <span style={{ color: "#3D4B58" }}>PTS</span>
                        </span>
                      </>
                    )}
                    {selectedPlayer.sport === "NFL" && (
                      <span style={{ fontSize: 12, color: "#131A24" }}>
                        <span style={{ fontWeight: 800 }}>{fmtNum(selectedPlayer.season.yds ?? selectedPlayer.season.YDS)}</span>{" "}
                        <span style={{ color: "#3D4B58" }}>YDS</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={clearPlayer}
                style={{
                  background: "rgba(19,35,58,0.06)",
                  border: "none",
                  borderRadius: "50%",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <X size={14} color="#3D4B58" />
              </button>
            </div>

            {/* ── Detail Tabs ── */}
            <div
              style={{
                display: "flex",
                gap: 0,
                overflowX: "auto",
                scrollbarWidth: "none",
                background: "#fff",
                border: "1px solid rgba(19,35,58,0.10)",
                borderRadius: "1rem",
                padding: "0.25rem",
              }}
            >
              {DETAIL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.5rem",
                    background: activeTab === tab.key ? "#13233A" : "none",
                    border: "none",
                    borderRadius: "0.75rem",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: activeTab === tab.key ? 800 : 500,
                    color: activeTab === tab.key ? "#F6F1E7" : "#3D4B58",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Tab Content ── */}
            {activeTab === "overview" && <OverviewTab player={selectedPlayer} />}
            {activeTab === "matchups" && <MatchupsTab player={selectedPlayer} />}
            {activeTab === "park" && <ParkTab player={selectedPlayer} />}
            {activeTab === "deepdive" && <DeepDiveTab player={selectedPlayer} />}
          </>
        )}
      </div>

      {/* Global spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
