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
  season?: Record<string, string | number>;
  gamelog?: GameLogEntry[];
  steamer?: Record<string, string | number>;
  statcast?: Record<string, string | number>;
  splits?: { home: Record<string, string | number>; away: Record<string, string | number> };
  avg30?: number;
  avg14?: number;
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
  season?: Record<string, string | number>;
  last5?: GameLogEntry[];
}

interface ParkSplitData {
  home?: Record<string, string | number>;
  away?: Record<string, string | number>;
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

function MatchupsTab({ player }: { player: PlayerData }) {
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedOpponent, setSelectedOpponent] = useState<PlayerSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const isMlb = player.sport === "MLB";
  const searchPlaceholder = isMlb
    ? "Search opposing pitcher..."
    : "Search opponent team...";

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (searchQ.trim().length < 2) {
      setDebouncedQ("");
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQ(searchQ.trim());
      setShowDropdown(true);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQ]);

  const searchUrl = debouncedQ
    ? `/api/intel/search?q=${encodeURIComponent(debouncedQ)}&sport=MLB&positionFilter=${isMlb ? "pitcher" : ""}`
    : null;

  const { data: searchResults, isFetching: searchLoading } = useQuery<PlayerSearchResult[]>({
    queryKey: ["matchup-search", debouncedQ, player.sport],
    queryFn: () => fetch(searchUrl!).then((r) => r.json()),
    enabled: !!searchUrl,
  });

  // BvP data (MLB)
  const bvpUrl =
    isMlb && selectedOpponent
      ? `/api/intel/bvp?batterId=${player.espnId}&pitcherId=${selectedOpponent.espnId}`
      : null;
  const {
    data: bvpData,
    isFetching: bvpLoading,
    error: bvpError,
    refetch: refetchBvp,
  } = useQuery<BvPData>({
    queryKey: ["bvp", player.espnId, selectedOpponent?.espnId],
    queryFn: () => fetch(bvpUrl!).then((r) => r.json()),
    enabled: !!bvpUrl,
  });

  // vs-team (non-MLB)
  const vsTeamUrl =
    !isMlb && selectedOpponent
      ? `/api/intel/vs-team?playerId=${player.espnId}&sport=${player.sport}&teamAbbr=${selectedOpponent.teamAbbr}`
      : null;
  const {
    data: vsTeamData,
    isFetching: vsLoading,
    error: vsError,
    refetch: refetchVs,
  } = useQuery<VsTeamData>({
    queryKey: ["vs-team", player.espnId, selectedOpponent?.teamAbbr],
    queryFn: () => fetch(vsTeamUrl!).then((r) => r.json()),
    enabled: !!vsTeamUrl,
  });

  const signalColor = {
    strong: "#22c55e",
    struggles: "#ef4444",
    neutral: "#3D4B58",
  };
  const signalLabel = {
    strong: "💪 Strong History",
    struggles: "🚫 Struggles",
    neutral: "Neutral",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Opponent Search */}
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
          {isMlb ? "Opposing Pitcher" : "Opponent Team"}
        </p>
        <div style={{ position: "relative" }}>
          {/* Selected badge */}
          {selectedOpponent && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(19,35,58,0.04)",
                border: "1px solid rgba(19,35,58,0.12)",
                borderRadius: "0.75rem",
                padding: "0.5rem 0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <PlayerAvatar player={selectedOpponent} size={28} />
              <span style={{ fontWeight: 700, color: "#131A24", fontSize: 13 }}>
                {selectedOpponent.name}
              </span>
              <span style={{ color: "#3D4B58", fontSize: 11 }}>
                {selectedOpponent.teamAbbr} · {selectedOpponent.position}
              </span>
              <button
                onClick={() => {
                  setSelectedOpponent(null);
                  setSearchQ("");
                }}
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#3D4B58",
                  padding: 2,
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(19,35,58,0.04)",
              border: "1px solid rgba(19,35,58,0.12)",
              borderRadius: "0.75rem",
              padding: "0.5rem 0.75rem",
            }}
          >
            <Search size={14} color="#3D4B58" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                background: "none",
                border: "none",
                outline: "none",
                flex: 1,
                fontSize: 13,
                color: "#131A24",
              }}
            />
            {searchLoading && <Spinner />}
          </div>

          {/* Dropdown */}
          {showDropdown && searchResults && searchResults.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 50,
                background: "#fff",
                border: "1px solid rgba(19,35,58,0.15)",
                borderRadius: "0.75rem",
                boxShadow: "0 8px 24px rgba(19,35,58,0.12)",
                overflow: "hidden",
                marginTop: 4,
              }}
            >
              {searchResults.slice(0, 6).map((r) => (
                <button
                  key={r.espnId}
                  onClick={() => {
                    setSelectedOpponent(r);
                    setSearchQ("");
                    setShowDropdown(false);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "0.6rem 0.75rem",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid rgba(19,35,58,0.06)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <PlayerAvatar player={r} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#131A24" }}>{r.name}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#3D4B58" }}>
                      {r.teamAbbr} · {r.position}
                    </p>
                  </div>
                  <SportBadge sport={r.sport} />
                </button>
              ))}
            </div>
          )}
          {showDropdown && !searchLoading && searchResults && searchResults.length === 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 50,
                background: "#fff",
                border: "1px solid rgba(19,35,58,0.15)",
                borderRadius: "0.75rem",
                boxShadow: "0 8px 24px rgba(19,35,58,0.12)",
                padding: "0.75rem",
                fontSize: 13,
                color: "#3D4B58",
                marginTop: 4,
              }}
            >
              No players found for "{debouncedQ}"
            </div>
          )}
        </div>
      </div>

      {/* BvP Results (MLB) */}
      {isMlb && selectedOpponent && (
        <>
          {bvpLoading && <Spinner />}
          {bvpError && <ErrorCard message="Failed to load BvP data." onRetry={() => refetchBvp()} />}
          {bvpData && (
            <div style={CARD_STYLE}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "0.75rem",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#3D4B58",
                    margin: 0,
                  }}
                >
                  Batter vs Pitcher
                </p>
                {bvpData.signal && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: signalColor[bvpData.signal],
                    }}
                  >
                    {signalLabel[bvpData.signal]}
                  </span>
                )}
              </div>

              {/* Season BvP */}
              {bvpData.seasonBvP && (
                <>
                  <p style={{ fontSize: 11, color: "#3D4B58", fontWeight: 600, margin: "0 0 0.5rem" }}>This Season</p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
                      gap: "0.4rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    {[
                      ["AB", fmtNum(bvpData.seasonBvP.AB)],
                      ["H", fmtNum(bvpData.seasonBvP.H)],
                      ["HR", fmtNum(bvpData.seasonBvP.HR)],
                      ["RBI", fmtNum(bvpData.seasonBvP.RBI)],
                      ["AVG", fmtAvg(bvpData.seasonBvP.AVG)],
                      ["OBP", fmtAvg(bvpData.seasonBvP.OBP)],
                      ["SLG", fmtAvg(bvpData.seasonBvP.SLG)],
                    ].map(([label, value]) => (
                      <StatChip key={label} label={label} value={value} highlight={label === "AVG" && parseFloat(String(bvpData.seasonBvP?.AVG ?? 0)) >= 0.3} />
                    ))}
                  </div>
                </>
              )}

              {/* Career BvP */}
              {bvpData.careerBvP && (
                <>
                  <p style={{ fontSize: 11, color: "#3D4B58", fontWeight: 600, margin: "0 0 0.5rem" }}>Career</p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
                      gap: "0.4rem",
                    }}
                  >
                    {[
                      ["AB", fmtNum(bvpData.careerBvP.AB)],
                      ["H", fmtNum(bvpData.careerBvP.H)],
                      ["HR", fmtNum(bvpData.careerBvP.HR)],
                      ["RBI", fmtNum(bvpData.careerBvP.RBI)],
                      ["AVG", fmtAvg(bvpData.careerBvP.AVG)],
                      ["OBP", fmtAvg(bvpData.careerBvP.OBP)],
                      ["SLG", fmtAvg(bvpData.careerBvP.SLG)],
                    ].map(([label, value]) => (
                      <StatChip key={label} label={label} value={value} highlight={label === "AVG" && parseFloat(String(bvpData.careerBvP?.AVG ?? 0)) >= 0.3} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* vs Team (non-MLB) */}
      {!isMlb && selectedOpponent && (
        <>
          {vsLoading && <Spinner />}
          {vsError && <ErrorCard message="Failed to load vs-team data." onRetry={() => refetchVs()} />}
          {vsTeamData && (
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
                vs {selectedOpponent.teamAbbr}
              </p>
              {vsTeamData.season && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                    gap: "0.5rem",
                    marginBottom: vsTeamData.last5 ? "0.75rem" : 0,
                  }}
                >
                  {Object.entries(vsTeamData.season).slice(0, 8).map(([k, v]) => (
                    <StatChip key={k} label={k} value={String(v ?? "—")} />
                  ))}
                </div>
              )}
              {vsTeamData.last5 && vsTeamData.last5.length > 0 && (
                <>
                  <p style={{ fontSize: 11, color: "#3D4B58", fontWeight: 600, margin: "0 0 0.5rem" }}>
                    Last 5 Games vs {selectedOpponent.teamAbbr}
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <tbody>
                        {vsTeamData.last5.map((g, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(19,35,58,0.06)" }}>
                            <td style={{ padding: "4px 6px", color: "#3D4B58", fontSize: 11 }}>{(g.date_game ?? g.date ?? "").slice(5, 10)}</td>
                            {Object.entries(g)
                              .filter(([k]) => !["date_game", "date", "opp"].includes(k))
                              .slice(0, 5)
                              .map(([k, v]) => (
                                <td key={k} style={{ padding: "4px 6px", textAlign: "center", fontWeight: 600 }}>{String(v ?? "—")}</td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Park / Venue Tab ─────────────────────────────────────────────────────────

function ParkTab({ player }: { player: PlayerData }) {
  const [selectedPark, setSelectedPark] = useState("");
  const isMlb = player.sport === "MLB";

  const parkUrl = isMlb && selectedPark
    ? `/api/intel/park-splits?playerId=${player.espnId}&park=${selectedPark}`
    : null;
  const {
    data: parkData,
    isFetching: parkLoading,
    error: parkError,
    refetch: refetchPark,
  } = useQuery<ParkSplitData>({
    queryKey: ["park-splits", player.espnId, selectedPark],
    queryFn: () => fetch(parkUrl!).then((r) => r.json()),
    enabled: !!parkUrl,
  });

  const splits = player.splits;

  function SplitRow({ label, home, away }: { label: string; home: string | number | undefined; away: string | number | undefined }) {
    const h = parseFloat(String(home ?? 0));
    const a = parseFloat(String(away ?? 0));
    const homeWins = h > a;
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 8,
          padding: "0.4rem 0",
          borderBottom: "1px solid rgba(19,35,58,0.06)",
        }}
      >
        <span
          style={{
            textAlign: "right",
            fontWeight: homeWins ? 800 : 500,
            color: homeWins ? "#22c55e" : "#131A24",
            fontSize: 13,
          }}
        >
          {home ?? "—"}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            color: "#3D4B58",
            minWidth: 40,
            textAlign: "center",
          }}
        >
          {label}
        </span>
        <span
          style={{
            textAlign: "left",
            fontWeight: !homeWins ? 800 : 500,
            color: !homeWins ? "#22c55e" : "#131A24",
            fontSize: 13,
          }}
        >
          {away ?? "—"}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Home / Away Splits */}
      {splits && (
        <div style={CARD_STYLE}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              marginBottom: "0.75rem",
            }}
          >
            <span
              style={{
                textAlign: "right",
                fontWeight: 700,
                fontSize: 12,
                color: "#131A24",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Home
            </span>
            <span style={{ minWidth: 40 }} />
            <span
              style={{
                fontWeight: 700,
                fontSize: 12,
                color: "#131A24",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Away
            </span>
          </div>
          {isMlb ? (
            <>
              <SplitRow label="BA" home={fmtAvg(splits.home.avg ?? splits.home.BA)} away={fmtAvg(splits.away.avg ?? splits.away.BA)} />
              <SplitRow label="OBP" home={fmtAvg(splits.home.obp ?? splits.home.OBP)} away={fmtAvg(splits.away.obp ?? splits.away.OBP)} />
              <SplitRow label="SLG" home={fmtAvg(splits.home.slg ?? splits.home.SLG)} away={fmtAvg(splits.away.slg ?? splits.away.SLG)} />
              <SplitRow label="HR" home={splits.home.hr ?? splits.home.HR} away={splits.away.hr ?? splits.away.HR} />
              <SplitRow label="AB" home={splits.home.ab ?? splits.home.AB} away={splits.away.ab ?? splits.away.AB} />
            </>
          ) : (
            Object.keys(splits.home)
              .slice(0, 6)
              .map((k) => (
                <SplitRow key={k} label={k} home={splits.home[k]} away={splits.away[k]} />
              ))
          )}
        </div>
      )}

      {/* Park Factor (MLB) */}
      {isMlb && (
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
            <MapPin size={11} style={{ marginRight: 4 }} />
            Park Factor
          </p>

          {/* Park Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(19,35,58,0.04)",
              border: "1px solid rgba(19,35,58,0.12)",
              borderRadius: "0.75rem",
              padding: "0.5rem 0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            <MapPin size={13} color="#3D4B58" />
            <select
              value={selectedPark}
              onChange={(e) => setSelectedPark(e.target.value)}
              style={{
                background: "none",
                border: "none",
                outline: "none",
                flex: 1,
                fontSize: 13,
                color: "#131A24",
                cursor: "pointer",
              }}
            >
              <option value="">Select a park...</option>
              {MLB_PARKS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} color="#3D4B58" />
          </div>

          {parkLoading && <Spinner />}
          {parkError && <ErrorCard message="Failed to load park data." onRetry={() => refetchPark()} />}

          {parkData?.parkFactor && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.75rem",
              }}
            >
              {[
                { label: "Hit Factor", value: parkData.parkFactor.hit },
                { label: "HR Factor", value: parkData.parkFactor.hr },
              ].map(({ label, value }) => {
                const isHitter = value > 1.05;
                const isPitcher = value < 0.95;
                const color = isHitter ? "#22c55e" : isPitcher ? "#ef4444" : "#3D4B58";
                const bgColor = isHitter
                  ? "rgba(34,197,94,0.08)"
                  : isPitcher
                  ? "rgba(239,68,68,0.08)"
                  : "rgba(19,35,58,0.04)";
                return (
                  <div
                    key={label}
                    style={{
                      background: bgColor,
                      border: `1px solid ${isHitter ? "rgba(34,197,94,0.25)" : isPitcher ? "rgba(239,68,68,0.25)" : "rgba(19,35,58,0.10)"}`,
                      borderRadius: "0.75rem",
                      padding: "0.75rem",
                      textAlign: "center",
                    }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#3D4B58", margin: "0 0 4px" }}>{label}</p>
                    <p style={{ fontSize: 22, fontWeight: 900, color, margin: 0 }}>{value.toFixed(2)}</p>
                    <p style={{ fontSize: 10, color, fontWeight: 600, margin: "2px 0 0" }}>
                      {isHitter ? "Hitter-Friendly" : isPitcher ? "Pitcher-Friendly" : "Neutral"}
                    </p>
                    {/* Factor bar */}
                    <div style={{ marginTop: 8, height: 6, background: "rgba(19,35,58,0.08)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, ((value - 0.7) / 0.8) * 100)}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedPark && !parkLoading && !parkData && (
            <p style={{ fontSize: 12, color: "#3D4B58", textAlign: "center", padding: "1rem 0" }}>
              No park factor data available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Deep Dive Tab ────────────────────────────────────────────────────────────

function DeepDiveTab({ player }: { player: PlayerData }) {
  const isMlb = player.sport === "MLB";
  const gamelog = player.gamelog ?? [];
  const last10 = gamelog.slice(0, 10);

  // Trend analysis
  const primaryKey = isMlb ? "H" : player.sport === "NBA" ? "PTS" : player.sport === "NHL" ? "G" : "YDS";
  const vals = last10.map((g) => parseFloat(String(g[primaryKey] ?? "0")) || 0);
  const first5 = vals.slice(5, 10);
  const last5 = vals.slice(0, 5);
  const first5Avg = first5.length ? first5.reduce((a, b) => a + b, 0) / first5.length : 0;
  const last5Avg = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
  const trend = last5Avg > first5Avg * 1.1 ? "up" : last5Avg < first5Avg * 0.9 ? "down" : "stable";

  // Statcast color rating
  function rateStatcast(key: string, value: number): { label: string; color: string } {
    const ranges: Record<string, { elite: number; good: number; below: number }> = {
      xba: { elite: 0.31, good: 0.27, below: 0.23 },
      xwoba: { elite: 0.38, good: 0.33, below: 0.29 },
      hh_pct: { elite: 50, good: 42, below: 36 },
      barrel_pct: { elite: 12, good: 8, below: 4 },
      ev50: { elite: 96, good: 92, below: 88 },
      babip: { elite: 0.35, good: 0.31, below: 0.27 },
      k_pct: { elite: 10, good: 16, below: 22 }, // lower is better
      bb_pct: { elite: 12, good: 9, below: 6 },
    };
    const r = ranges[key.toLowerCase()];
    if (!r) return { label: "Avg", color: "#3D4B58" };
    // For k_pct, lower is better (invert)
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Statcast (MLB) */}
      {isMlb && (
        <div style={CARD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: 6 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3D4B58", margin: 0 }}>
              Statcast Metrics
            </p>
            <span style={{ fontSize: 10, color: "#3D4B58" }}>via Baseball Savant</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: "0.5rem" }}>
            {[
              { key: "xba", label: "xBA", fmt: (v: number) => fmtAvg(v) },
              { key: "xwoba", label: "xwOBA", fmt: (v: number) => fmtAvg(v) },
              { key: "hh_pct", label: "HH%", fmt: (v: number) => fmtPct(v) },
              { key: "barrel_pct", label: "Barrel%", fmt: (v: number) => fmtPct(v) },
              { key: "ev50", label: "EV50", fmt: (v: number) => fmtNum(v, 1) },
              { key: "la", label: "LA", fmt: (v: number) => fmtNum(v, 1) + "°" },
              { key: "babip", label: "BABIP", fmt: (v: number) => fmtAvg(v) },
              { key: "k_pct", label: "K%", fmt: (v: number) => fmtPct(v) },
              { key: "bb_pct", label: "BB%", fmt: (v: number) => fmtPct(v) },
              { key: "whiff_pct", label: "Whiff%", fmt: (v: number) => fmtPct(v) },
            ]
              .filter(({ key }) => sc[key] != null)
              .map(({ key, label, fmt }) => {
                const val = parseFloat(String(sc[key] ?? 0));
                const { label: rLabel, color } = rateStatcast(key, val);
                return (
                  <div
                    key={key}
                    style={{
                      background: "rgba(19,35,58,0.03)",
                      border: "1px solid rgba(19,35,58,0.10)",
                      borderRadius: "0.75rem",
                      padding: "0.5rem 0.6rem",
                      textAlign: "center",
                    }}
                  >
                    <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#3D4B58", margin: 0 }}>{label}</p>
                    <p style={{ fontSize: 15, fontWeight: 900, color: "#131A24", margin: "2px 0 1px" }}>{fmt(val)}</p>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 800,
                        color,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {rLabel}
                    </span>
                  </div>
                );
              })}
          </div>
          {Object.keys(sc).length === 0 && (
            <p style={{ fontSize: 12, color: "#3D4B58", textAlign: "center", padding: "0.5rem 0" }}>
              No Statcast data available for this player.
            </p>
          )}
        </div>
      )}

      {/* Steamer Full Projection (MLB) */}
      {isMlb && player.steamer && (
        <div
          style={{
            ...CARD_STYLE,
            background: "rgba(212,168,67,0.05)",
            border: "1px solid rgba(212,168,67,0.20)",
          }}
        >
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

      {/* Rolling Form Chart */}
      {last10.length > 0 && (
        <div style={CARD_STYLE}>
          <MiniBarChart
            games={last10}
            statKey={primaryKey}
            label={isMlb ? "Hits" : player.sport === "NBA" ? "Points" : player.sport === "NHL" ? "Goals" : "Yards"}
          />
        </div>
      )}

      {/* Trend Summary */}
      {last10.length >= 5 && (
        <div
          style={{
            ...CARD_STYLE,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0.9rem 1.25rem",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background:
                trend === "up" ? "rgba(34,197,94,0.12)" : trend === "down" ? "rgba(239,68,68,0.12)" : "rgba(19,35,58,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {trend === "up" ? (
              <ArrowUp size={18} color="#22c55e" />
            ) : trend === "down" ? (
              <ArrowDown size={18} color="#ef4444" />
            ) : (
              <Minus size={18} color="#3D4B58" />
            )}
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#131A24" }}>
              {trend === "up" ? "Trending Up 📈" : trend === "down" ? "Trending Down 📉" : "Stable"}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: "#3D4B58" }}>
              Last 5 avg: {last5Avg.toFixed(1)} vs Prior 5 avg: {first5Avg.toFixed(1)}
            </p>
          </div>
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

  // Pre-populate search from URL hash params (e.g., navigating from BTS "Intel" button)
  useEffect(() => {
    const hash = window.location.hash; // e.g. #/intel?q=Shohei%20Ohtani&sport=MLB
    const qIdx = hash.indexOf("?");
    if (qIdx < 0) return;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
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
