import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  BookOpen, Plus, RefreshCw, ChevronDown, X, Check,
  TrendingUp, TrendingDown, DollarSign, BarChart2,
  Lightbulb, Wallet, Clock, Trophy, AlertCircle,
  Edit2, PlusCircle, Loader2, ChevronRight, ChevronUp,
  User, ChevronDown as Chevron, Share2, Camera, Trash2,
} from "lucide-react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG       = "#F6F1E7";
const FG       = "#131A24";
const NAVY     = "#13233A";
const GOLD     = "#D4A843";
const RED      = "#A23B32";
const MUTED    = "#3D4B58";
const CARD_BG  = "#FFFFFF";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Account {
  id: number;
  name: string;
  balance: number;
  total_profit: number;
  settled_slips: number;
  won_slips: number;
  open_slips: number;
}

interface Outcome {
  name: string;
  price: number;
  point?: number;
}

interface Market {
  key: string;
  outcomes: Outcome[];
}

interface Bookmaker {
  key: string;
  markets: Market[];
}

interface Game {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: Bookmaker[];
}

interface AlternateLine {
  line: number;
  overOdds: number | null;
  underOdds: number | null;
}

interface PropOutcome {
  name: string;       // "Over" or "Under"
  description?: string; // player name
  price: number;
  point?: number;
  team?: string | null;
  position?: string | null;
  alternates?: AlternateLine[]; // sorted by line asc
}

interface PropMarket {
  key: string;    // e.g. "player_hits"
  outcomes: PropOutcome[];
}

interface Leg {
  sport: string;
  betType: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  playerId?: number;
  playerName?: string;
  statType?: string;
  line?: number;
  overUnder?: "over" | "under";
  pickLabel: string;
  oddsAmerican: number;
  gameDate: string;
  gameTime?: string;
}

interface SlipLeg {
  id: number;
  pick_label: string;
  odds_american: number;
  result?: "pending" | "win" | "loss" | "push" | "void";
  sport?: string;
  bet_type?: string;
  game_date?: string;
  stat_type?: string;
  line?: number;
  over_under?: string;
  player_name?: string;
}

interface Slip {
  id: number;
  slip_type: "single" | "parlay" | "round_robin";
  status: "open" | "won" | "lost" | "push" | "void";
  stake: number;
  potential_payout: number;
  payout_received?: number;
  placed_at: string;
  settled_at?: string;
  legs: SlipLeg[];
  combo_count?: number;
  rr_combos?: { id: number; child_status: string; child_payout: number; legs: SlipLeg[] }[];
}

interface InsightsData {
  roiByType: Record<string, number>;
  roiBySport: Record<string, number>;
  roiByStatType: Record<string, number>;
  bankrollCurve: { ts: string; balance: number; type: string }[];
  tips: string[];
}

type SubTab = "slip" | "bets" | "accounts" | "insights";
type SlipType = "single" | "parlay" | "round_robin";
type Sport = "mlb" | "nfl" | "nba" | "nhl";
type BetFilter = "all" | "moneyline" | "spread" | "total" | "props";
type BetsFilter = "open" | "won" | "lost" | "all";

// ─── Prop stat label map ──────────────────────────────────────────────────────
const PROP_STAT_LABELS: Record<string, string> = {
  // MLB
  player_hits:                        "Hits",
  player_hrr:                         "HRR",
  player_home_runs:                   "HR",
  player_total_bases:                 "Total Bases",
  player_rbis:                        "RBI",
  player_runs_scored:                 "Runs",
  player_singles:                     "Singles",
  player_doubles:                     "Doubles",
  player_stolen_bases:                "SB",
  player_strikeouts:                  "K (Batter)",
  player_pitcher_strikeouts:          "Pitcher K",
  player_pitcher_outs:                "Pitcher Outs",
  player_hits_allowed:                "Hits Allowed",
  player_earned_runs:                 "ER",
  player_walks:                       "BB (Batter)",
  player_pitcher_walks:               "BB Allowed",
  player_first_innings_runs_allowed:  "NRFI",
  // NBA
  player_points:                      "PTS",
  player_rebounds:                    "REB",
  player_assists:                     "AST",
  player_threes:                      "3PT",
  player_blocks:                      "BLK",
  player_steals:                      "STL",
  player_points_rebounds_assists:     "PRA",
  // NFL
  player_anytime_td:                  "Anytime TD",
  player_reception_yards:             "Rec Yds",
  player_rushing_yards:               "Rush Yds",
  player_passing_yards:               "Pass Yds",
  player_passing_tds:                 "Pass TD",
  player_receptions:                  "Rec",
  // NHL
  player_shots_on_goal:               "SOG",
  player_goal_scorer:                 "Goal Scorer",
  player_goals:                       "Goals",
  // legacy keys (older API format)
  player_pass_tds:                    "Pass TD",
  player_pass_yds:                    "Pass Yds",
  player_rush_yds:                    "Rush Yds",
  player_reception_yds:               "Rec Yds",
};

function statLabel(key: string): string {
  return PROP_STAT_LABELS[key] ?? key.replace("player_", "").replace(/_/g, " ").toUpperCase();
}

// Prop display order: Hits(0), HRR(1), HR(2), then alphabetical
const PROP_SORT_ORDER: Record<string, number> = {
  player_hits:      0,
  player_hrr:       1,
  player_home_runs: 2,
};
function propSortKey(mkey: string): string {
  const order = PROP_SORT_ORDER[mkey];
  if (order !== undefined) return String(order).padStart(4, "0") + mkey;
  return "9999" + statLabel(mkey).toLowerCase();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtCoins(n: number): string {
  return n.toLocaleString();
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function fmtDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function toDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function calcPayout(stake: number, odds: number): number {
  if (odds < 0) return stake * (100 / Math.abs(odds)) + stake;
  return stake * (odds / 100) + stake;
}

function calcParlayPayout(stake: number, legs: Leg[]): number {
  const dec = legs.reduce((acc, l) => acc * toDecimal(l.oddsAmerican), 1);
  return stake * dec;
}

function numCombos(total: number, size: number): number {
  if (size > total) return 0;
  let result = 1;
  for (let i = 0; i < size; i++) {
    result = (result * (total - i)) / (i + 1);
  }
  return Math.round(result);
}

function getCombinations<T>(arr: T[], size: number): T[][] {
  if (size === 1) return arr.map(x => [x]);
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1);
    rest.forEach(r => result.push([arr[i], ...r]));
  }
  return result;
}

function statusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case "open":  return { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" };
    case "won":   return { bg: "rgba(34,197,94,0.12)",  text: "#16a34a" };
    case "lost":  return { bg: "rgba(162,59,50,0.12)",  text: RED };
    case "push":  return { bg: "rgba(148,163,184,0.12)", text: MUTED };
    case "void":  return { bg: "rgba(234,179,8,0.12)",  text: "#ca8a04" };
    default:      return { bg: "rgba(148,163,184,0.12)", text: MUTED };
  }
}

function legResultColor(result?: string): { text: string } {
  switch (result) {
    case "win":   return { text: "#16a34a" };
    case "loss":  return { text: RED };
    case "push":  return { text: MUTED };
    case "void":  return { text: "#ca8a04" };
    default:      return { text: "#64748b" };
  }
}

function slipTypeBg(type: string): string {
  switch (type) {
    case "single":       return MUTED;
    case "parlay":       return NAVY;
    case "round_robin":  return "#7c3aed";
    default:             return MUTED;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastMsg { id: number; msg: string; type: "success" | "error" }

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const show = useCallback((msg: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, show };
}

function ToastContainer({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "success" ? "#16a34a" : RED,
          color: "#fff", padding: "10px 20px", borderRadius: 12,
          fontSize: 14, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          whiteSpace: "nowrap",
        }}>
          {t.type === "success" ? "✓ " : "✗ "}{t.msg}
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ h = 20, w = "100%", r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: r, background: "linear-gradient(90deg, #e2d9c8 25%, #ede8dc 50%, #e2d9c8 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
  );
}

// ─── Sub-tab bar ──────────────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: "slip",     label: "Bet Slip",  icon: <BookOpen size={15} /> },
  { id: "bets",     label: "My Bets",   icon: <Trophy size={15} /> },
  { id: "accounts", label: "Accounts",  icon: <Wallet size={15} /> },
  { id: "insights", label: "Insights",  icon: <TrendingUp size={15} /> },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Book() {
  const { user } = useAuth();
  const token = localStorage.getItem("ciq_token") ?? "";
  const qc = useQueryClient();

  const { toasts, show: showToast } = useToast();

  const [subTab, setSubTab] = useState<SubTab>("slip");

  // ── Accounts query ────────────────────────────────────────────────────────
  const { data: accountsData, isLoading: accountsLoading, refetch: refetchAccounts } = useQuery<{ accounts: Account[] }>({
    queryKey: ["book-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/book/accounts", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const accounts = accountsData?.accounts ?? [];

  // Auto-prompt to create first account
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  useEffect(() => {
    if (!accountsLoading && accounts.length === 0) {
      setShowCreateAccount(true);
    }
  }, [accountsLoading, accounts.length]);

  // ── Selected account for slips / insights ────────────────────────────────
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  useEffect(() => {
    if (accounts.length > 0 && selectedAccountId === null) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null;

  return (
    <div style={{ background: BG, minHeight: "100vh", color: FG, fontFamily: "inherit" }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .book-tab-btn { transition: all 0.18s ease; }
        .book-chip { transition: all 0.15s ease; cursor: pointer; user-select: none; }
        .book-chip:active { transform: scale(0.96); }
        .book-btn-gold { transition: all 0.18s ease; }
        .book-btn-gold:hover { filter: brightness(1.08); }
        .book-btn-gold:active { transform: scale(0.97); }
      `}</style>

      {/* Header */}
      <div style={{ background: NAVY, padding: "14px 16px 10px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={20} color={GOLD} />
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 18, letterSpacing: 0.3 }}>The Book</span>
          </div>
          {selectedAccount && (
            <span style={{ color: GOLD, fontSize: 12, fontWeight: 700 }}>{fmtCoins(selectedAccount.balance)} coins</span>
          )}
        </div>

        {/* Sub-tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              className="book-tab-btn"
              onClick={() => setSubTab(tab.id)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, padding: "6px 4px", borderRadius: 8, border: "none", cursor: "pointer",
                background: subTab === tab.id ? GOLD : "rgba(255,255,255,0.07)",
                color: subTab === tab.id ? NAVY : "rgba(255,255,255,0.65)",
                fontWeight: subTab === tab.id ? 700 : 500,
                fontSize: 10,
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "0 0 80px" }}>
        {subTab === "slip"     && <BetSlipTab token={token} accounts={accounts} accountsLoading={accountsLoading} selectedAccountId={selectedAccountId} setSelectedAccountId={setSelectedAccountId} showToast={showToast} onGoToAccounts={() => setSubTab("accounts")} />}
        {subTab === "bets"     && <MyBetsTab token={token} accounts={accounts} selectedAccountId={selectedAccountId} setSelectedAccountId={setSelectedAccountId} showToast={showToast} />}
        {subTab === "accounts" && <AccountsTab token={token} accounts={accounts} accountsLoading={accountsLoading} showCreateAccount={showCreateAccount} setShowCreateAccount={setShowCreateAccount} refetchAccounts={refetchAccounts} showToast={showToast} />}
        {subTab === "insights" && <InsightsTab token={token} accounts={accounts} selectedAccountId={selectedAccountId} setSelectedAccountId={setSelectedAccountId} showToast={showToast} />}
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — BET SLIP
// ═══════════════════════════════════════════════════════════════════════════════

const SPORTS_LIST: { id: Sport; label: string }[] = [
  { id: "mlb", label: "MLB" },
  { id: "nfl", label: "NFL" },
  { id: "nba", label: "NBA" },
  { id: "nhl", label: "NHL" },
];

const BET_FILTERS: { id: BetFilter; label: string }[] = [
  { id: "all",        label: "All" },
  { id: "moneyline",  label: "Moneyline" },
  { id: "spread",     label: "Spread" },
  { id: "total",      label: "Total" },
  { id: "props",      label: "Props" },
];

// ─── Positions by sport ───────────────────────────────────────────────────────
const POSITION_GROUPS: Record<Sport, string[]> = {
  mlb: ["SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "OF"],
  nfl: ["QB", "RB", "WR", "TE", "K"],
  nba: ["PG", "SG", "SF", "PF", "C"],
  nhl: ["G", "D", "LW", "RW", "C"],
};

// Batter vs Pitcher grouping for MLB
const MLB_PITCHER_MARKETS = new Set(["player_pitcher_strikeouts", "player_pitcher_outs", "player_hits_allowed", "player_earned_runs", "player_pitcher_walks", "player_first_innings_runs_allowed"]);
const MLB_BATTER_POS = new Set(["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "OF"]);
const MLB_PITCHER_POS = new Set(["SP", "RP", "P"]);

// ─── Props expansion panel per game ──────────────────────────────────────────
function GamePropsPanel({
  token, sport, game, legs, toggleLeg, showToast,
}: {
  token: string;
  sport: Sport;
  game: Game;
  legs: Leg[];
  toggleLeg: (leg: Leg) => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStat, setFilterStat] = useState<string>("all");
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterDir, setFilterDir] = useState<"all" | "over" | "under">("all");
  const [filterPos, setFilterPos] = useState<string>("all");

  const { data, isLoading, error } = useQuery<{ markets: PropMarket[]; homeTeam?: string; awayTeam?: string }>({
    queryKey: ["book-props", sport, game.id],
    queryFn: async () => {
      const params = new URLSearchParams({
        sport,
        eventId: game.id,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
      });
      const r = await fetch(`/api/book/props?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open,
    staleTime: 120_000,
  });

  const markets = data?.markets ?? [];
  const gd = new Date(game.commence_time);

  // Derive team options from the game
  const teamOptions = [
    { label: "Both Teams", value: "all" },
    { label: game.away_team.split(" ").pop()!, value: game.away_team },
    { label: game.home_team.split(" ").pop()!, value: game.home_team },
  ];

  // Build stat type options from available markets — sorted: Hits → HRR → HR → alphabetical
  const statOptions = [
    { label: "All Stats", value: "all" },
    ...markets
      .sort((a, b) => propSortKey(a.key).localeCompare(propSortKey(b.key)))
      .map(m => ({ label: statLabel(m.key), value: m.key })),
  ];

  // Position options for this sport
  const posOptions = [
    { label: "All Pos", value: "all" },
    ...(POSITION_GROUPS[sport] ?? []).map(p => ({ label: p, value: p })),
  ];

  function buildPropLeg(market: PropMarket, playerName: string, outcome: PropOutcome, ou: "over" | "under"): Leg {
    return {
      sport,
      betType: "prop",
      gameId: game.id,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      playerName,
      statType: market.key.replace("player_", ""),
      line: outcome.point,
      overUnder: ou,
      pickLabel: `${playerName} ${ou === "over" ? "O" : "U"}${outcome.point} ${statLabel(market.key)} (${fmtOdds(outcome.price)})`,
      oddsAmerican: outcome.price,
      gameDate: gd.toISOString().slice(0, 10),
      gameTime: game.commence_time,
    };
  }

  function isActive(leg: Leg): boolean {
    return legs.some(l => l.pickLabel === leg.pickLabel && l.gameId === leg.gameId);
  }

  // Group outcomes by player — each player has { over?, under?, team?, position? }
  type PlayerEntry = { over?: PropOutcome; under?: PropOutcome; team?: string | null; position?: string | null };

  function groupByPlayer(market: PropMarket): Record<string, PlayerEntry> {
    const players: Record<string, PlayerEntry> = {};
    for (const oc of market.outcomes) {
      const playerName = oc.description ?? "";
      if (!playerName) continue;
      if (!players[playerName]) players[playerName] = { team: oc.team, position: oc.position };
      const isOver = oc.name.toLowerCase() === "over";
      if (isOver) players[playerName].over = oc;
      else players[playerName].under = oc;
    }
    return players;
  }

  // Apply filters across all markets — flatten to { playerName, market, over?, under?, team?, position? }
  type FlatRow = {
    playerName: string;
    market: PropMarket;
    over?: PropOutcome;
    under?: PropOutcome;
    team?: string | null;
    position?: string | null;
  };

  const allRows: FlatRow[] = [];
  for (const market of markets) {
    if (filterStat !== "all" && market.key !== filterStat) continue;
    const grouped = groupByPlayer(market);
    for (const [playerName, entry] of Object.entries(grouped)) {
      // Search filter
      if (search && !playerName.toLowerCase().includes(search.toLowerCase())) continue;
      // Team filter
      if (filterTeam !== "all" && entry.team && entry.team !== filterTeam) continue;
      // Position filter
      if (filterPos !== "all") {
        const pos = entry.position ?? "";
        // MLB batter/pitcher grouping
        if (sport === "mlb") {
          if (filterPos === "SP" || filterPos === "RP") {
            if (!MLB_PITCHER_POS.has(pos)) continue;
          } else {
            if (!MLB_BATTER_POS.has(pos) && pos !== filterPos) continue;
          }
        } else {
          if (pos !== filterPos) continue;
        }
      }
      // Direction filter — only show rows that have the requested side
      if (filterDir === "over" && !entry.over) continue;
      if (filterDir === "under" && !entry.under) continue;
      allRows.push({ playerName, market, over: entry.over, under: entry.under, team: entry.team, position: entry.position });
    }
  }

  const totalProps = markets.reduce((sum, m) => {
    const g = groupByPlayer(m);
    return sum + Object.keys(g).length;
  }, 0);

  function chipBtn(label: string, active: boolean, onClick: () => void, small = false) {
    return (
      <button
        key={label}
        onClick={onClick}
        style={{
          padding: small ? "3px 8px" : "4px 10px",
          borderRadius: 14,
          border: `1px solid ${active ? GOLD : "#e2e8f0"}`,
          background: active ? `rgba(212,168,67,0.14)` : "transparent",
          color: active ? GOLD : MUTED,
          fontSize: small ? 10 : 11,
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
          whiteSpace: "nowrap" as const,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 6, border: `1.5px solid ${open ? GOLD : "#e2e8f0"}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", padding: "8px 12px",
          background: open ? `rgba(212,168,67,0.08)` : "#f8fafc",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: open ? GOLD : MUTED, display: "flex", alignItems: "center", gap: 5 }}>
          <User size={11} />
          PLAYER PROPS
          {!isLoading && totalProps > 0 && (
            <span style={{ background: open ? GOLD : "#e2e8f0", color: open ? NAVY : MUTED, borderRadius: 10, padding: "0 6px", fontSize: 9, fontWeight: 800 }}>
              {totalProps}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={13} color={GOLD} /> : <ChevronDown size={13} color={MUTED} />}
      </button>

      {open && (
        <div style={{ background: "#fff" }}>
          {/* ── Filter bar ── */}
          <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Search */}
            <input
              type="text"
              placeholder="Search player..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "6px 10px", borderRadius: 8,
                border: "1.5px solid #e2e8f0", fontSize: 12, color: FG,
                background: "#f8fafc", boxSizing: "border-box" as const,
                outline: "none",
              }}
            />

            {/* Stat type chips */}
            {markets.length > 1 && (
              <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 1 }}>
                {statOptions.map(o => chipBtn(o.label, filterStat === o.value, () => setFilterStat(o.value), true))}
              </div>
            )}

            {/* Team + direction chips side by side */}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {/* Team */}
              {teamOptions.slice(1).map(o => chipBtn(o.label, filterTeam === o.value, () => setFilterTeam(filterTeam === o.value ? "all" : o.value), true))}
              {/* Direction */}
              {(["over", "under"] as const).map(d => chipBtn(d === "over" ? "Overs" : "Unders", filterDir === d, () => setFilterDir(filterDir === d ? "all" : d), true))}
              {/* Clear */}
              {(search || filterStat !== "all" || filterTeam !== "all" || filterDir !== "all" || filterPos !== "all") && (
                <button
                  onClick={() => { setSearch(""); setFilterStat("all"); setFilterTeam("all"); setFilterDir("all"); setFilterPos("all"); }}
                  style={{ padding: "3px 8px", borderRadius: 14, border: "1px solid #fca5a5", background: "transparent", color: RED, fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Position chips (MLB: Pitchers/Batters; others: individual pos) */}
            {sport === "mlb" ? (
              <div style={{ display: "flex", gap: 5 }}>
                {chipBtn("Pitchers", filterPos === "SP", () => setFilterPos(filterPos === "SP" ? "all" : "SP"), true)}
                {chipBtn("Batters", filterPos === "1B", () => setFilterPos(filterPos === "1B" ? "all" : "1B"), true)}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 5, overflowX: "auto" }}>
                {posOptions.slice(1).map(o => chipBtn(o.label, filterPos === o.value, () => setFilterPos(filterPos === o.value ? "all" : o.value), true))}
              </div>
            )}
          </div>

          {/* ── Content ── */}
          <div style={{ padding: "8px 10px" }}>
            {isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Skeleton h={40} r={8} />
                <Skeleton h={40} r={8} />
                <Skeleton h={40} r={8} />
              </div>
            ) : error ? (
              <div style={{ color: RED, fontSize: 12, textAlign: "center", padding: "8px 0" }}>Failed to load props</div>
            ) : allRows.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: "8px 0" }}>
                {markets.length === 0 ? "No props available for this game" : "No players match your filters"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {/* Group by stat type when showing all stats */}
                {filterStat === "all" ? (
                  // Group rows by market key, sorted: Hits → HRR → HR → alphabetical
                  Object.entries(
                    allRows.reduce((acc, row) => {
                      const key = row.market.key;
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(row);
                      return acc;
                    }, {} as Record<string, FlatRow[]>)
                  )
                  .sort(([a], [b]) => propSortKey(a).localeCompare(propSortKey(b)))
                  .map(([mkey, rows]) => (
                    <div key={mkey} style={{ marginBottom: 4 }}>
                      <div style={{ marginBottom: 5 }}>
                        <span style={{ background: NAVY, color: GOLD, borderRadius: 6, padding: "1px 8px", fontSize: 9, fontWeight: 800, letterSpacing: 0.3 }}>
                          {statLabel(mkey)}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {rows.map(row => <PropRow key={row.playerName + mkey} row={row} filterDir={filterDir} buildPropLeg={buildPropLeg} isActive={isActive} toggleLeg={toggleLeg} />)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {allRows.map(row => <PropRow key={row.playerName + row.market.key} row={row} filterDir={filterDir} buildPropLeg={buildPropLeg} isActive={isActive} toggleLeg={toggleLeg} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Individual prop row ──────────────────────────────────────────────────────
type FlatRowType = {
  playerName: string;
  market: PropMarket;
  over?: PropOutcome;
  under?: PropOutcome;
  team?: string | null;
  position?: string | null;
};

function PropRow({
  row, filterDir, buildPropLeg, isActive, toggleLeg,
}: {
  row: FlatRowType;
  filterDir: "all" | "over" | "under";
  buildPropLeg: (market: PropMarket, playerName: string, outcome: PropOutcome, ou: "over" | "under") => Leg;
  isActive: (leg: Leg) => boolean;
  toggleLeg: (leg: Leg) => void;
}) {
  const { playerName, market, over, under, team, position } = row;
  const showOver  = filterDir !== "under" && !!over;
  const showUnder = filterDir !== "over"  && !!under;

  // Build sorted list of available lines (merged from over + under alternates)
  const allLines: AlternateLine[] = React.useMemo(() => {
    const map = new Map<number, AlternateLine>();
    const addLine = (l: AlternateLine) => {
      const ex = map.get(l.line);
      if (!ex) map.set(l.line, { ...l });
      else {
        if (l.overOdds  != null && ex.overOdds  == null) ex.overOdds  = l.overOdds;
        if (l.underOdds != null && ex.underOdds == null) ex.underOdds = l.underOdds;
      }
    };
    // Seed from primary outcomes
    if (over)  addLine({ line: over.point  ?? 0, overOdds:  over.price,  underOdds: under?.price ?? null });
    if (under) addLine({ line: under.point ?? 0, overOdds:  over?.price ?? null, underOdds: under.price });
    // Add alternates
    (over?.alternates  ?? []).forEach(addLine);
    (under?.alternates ?? []).forEach(addLine);
    return Array.from(map.values()).sort((a, b) => a.line - b.line);
  }, [over, under]);

  // Selected line index (default: index of primary outcome's line)
  const defaultIdx = React.useMemo(() => {
    const primaryLine = over?.point ?? under?.point ?? allLines[0]?.line;
    const idx = allLines.findIndex(l => l.line === primaryLine);
    return idx >= 0 ? idx : 0;
  }, [allLines, over, under]);

  const [lineIdx, setLineIdx] = React.useState(defaultIdx);
  const selectedLine = allLines[lineIdx] ?? allLines[0];

  // Build synthetic outcomes at selected line
  const overAtLine: PropOutcome | undefined = (showOver && selectedLine?.overOdds != null)
    ? { ...over!, point: selectedLine.line, price: selectedLine.overOdds! }
    : undefined;
  const underAtLine: PropOutcome | undefined = (showUnder && selectedLine?.underOdds != null)
    ? { ...under!, point: selectedLine.line, price: selectedLine.underOdds! }
    : undefined;

  const hasAlternates = allLines.length > 1;

  return (
    <div style={{ padding: "5px 4px", borderRadius: 8, background: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Player info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: FG, wordBreak: "break-word", lineHeight: 1.3 }}>
            {playerName}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1, flexWrap: "wrap" }}>
            {team && (
              <span style={{ fontSize: 9, fontWeight: 700, color: NAVY, background: "rgba(19,35,58,0.08)", borderRadius: 5, padding: "0 5px" }}>
                {team.split(" ").pop()}
              </span>
            )}
            {position && (
              <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, background: "#f1f5f9", borderRadius: 5, padding: "0 5px" }}>
                {position}
              </span>
            )}
          </div>
        </div>

        {/* Line stepper + bet buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {/* Line control */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {hasAlternates && (
              <button
                onClick={() => setLineIdx(i => Math.max(0, i - 1))}
                disabled={lineIdx === 0}
                style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid #e2e8f0", background: lineIdx === 0 ? "#f1f5f9" : "#fff", color: lineIdx === 0 ? "#cbd5e1" : MUTED, fontSize: 12, cursor: lineIdx === 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 }}
              >−</button>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, color: FG, minWidth: 28, textAlign: "center" as const }}>
              {selectedLine?.line ?? ""}
            </span>
            {hasAlternates && (
              <button
                onClick={() => setLineIdx(i => Math.min(allLines.length - 1, i + 1))}
                disabled={lineIdx === allLines.length - 1}
                style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid #e2e8f0", background: lineIdx === allLines.length - 1 ? "#f1f5f9" : "#fff", color: lineIdx === allLines.length - 1 ? "#cbd5e1" : MUTED, fontSize: 12, cursor: lineIdx === allLines.length - 1 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 }}
              >+</button>
            )}
          </div>

          {/* Stat label */}
          <span style={{ fontSize: 9, color: MUTED, fontWeight: 600, minWidth: 30, textAlign: "center" as const }}>
            {statLabel(market.key).split(" ")[0]}
          </span>

          {/* Over button */}
          {showOver && overAtLine && (() => {
            const leg = buildPropLeg(market, playerName, overAtLine, "over");
            const active = isActive(leg);
            return (
              <button className="book-chip" onClick={() => toggleLeg(leg)} style={{ padding: "5px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1.5px solid ${active ? GOLD : "#e2e8f0"}`, background: active ? `rgba(212,168,67,0.12)` : "#fff", color: active ? GOLD : "#16a34a", minWidth: 50, textAlign: "center" as const }}>
                O {fmtOdds(overAtLine.price)}
              </button>
            );
          })()}
          {showOver && !overAtLine && (
            <span style={{ fontSize: 10, color: "#cbd5e1", minWidth: 50, textAlign: "center" as const }}>—</span>
          )}

          {/* Under button */}
          {showUnder && underAtLine && (() => {
            const leg = buildPropLeg(market, playerName, underAtLine, "under");
            const active = isActive(leg);
            return (
              <button className="book-chip" onClick={() => toggleLeg(leg)} style={{ padding: "5px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1.5px solid ${active ? GOLD : "#e2e8f0"}`, background: active ? `rgba(212,168,67,0.12)` : "#fff", color: active ? GOLD : RED, minWidth: 50, textAlign: "center" as const }}>
                U {fmtOdds(underAtLine.price)}
              </button>
            );
          })()}
          {showUnder && !underAtLine && (
            <span style={{ fontSize: 10, color: "#cbd5e1", minWidth: 50, textAlign: "center" as const }}>—</span>
          )}
        </div>
      </div>
    </div>
  );
}

function BetSlipTab({
  token, accounts, accountsLoading, selectedAccountId, setSelectedAccountId, showToast, onGoToAccounts,
}: {
  token: string;
  accounts: Account[];
  accountsLoading: boolean;
  selectedAccountId: number | null;
  setSelectedAccountId: (id: number) => void;
  showToast: (msg: string, type?: "success" | "error") => void;
  onGoToAccounts: () => void;
}) {
  const qc = useQueryClient();
  const [sport, setSport] = useState<Sport>("mlb");
  const [betFilter, setBetFilter] = useState<BetFilter>("all");
  const [legs, setLegs] = useState<Leg[]>([]);
  const [slipType, setSlipType] = useState<SlipType>("single");
  const [rrSizes, setRrSizes] = useState<Set<number>>(new Set([2]));
  const [stake, setStake] = useState<string>("");
  const [placing, setPlacing] = useState(false);

  const { data: oddsData, isLoading: oddsLoading, error: oddsError } = useQuery<{ games: Game[] }>({
    queryKey: ["book-odds", sport],
    queryFn: async () => {
      const r = await fetch(`/api/book/odds?sport=${sport}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 120_000,
  });

  const games = oddsData?.games ?? [];

  // Max legs by slip type
  const maxLegs = slipType === "single" ? 1 : 10;

  // Clamp rrSizes when legs are removed — drop any size that exceeds legs.length - 1
  React.useEffect(() => {
    if (slipType === "round_robin") {
      const maxSize = legs.length - 1;
      setRrSizes(prev => {
        const next = new Set([...prev].filter(s => s >= 2 && s <= maxSize));
        // If nothing valid remains, default back to 2 (if enough legs)
        if (next.size === 0 && legs.length >= 3) next.add(2);
        return next;
      });
    }
  }, [legs.length, slipType]);

  function toggleRrSize(n: number) {
    setRrSizes(prev => {
      const next = new Set(prev);
      if (next.has(n)) { next.delete(n); } else { next.add(n); }
      return next;
    });
  }

  function isInSlip(gameId: string, betType: string, pickLabel: string): boolean {
    return legs.some(l => l.gameId === gameId && l.betType === betType && l.pickLabel === pickLabel);
  }

  function toggleLeg(leg: Leg) {
    if (isInSlip(leg.gameId, leg.betType, leg.pickLabel)) {
      setLegs(prev => prev.filter(l => !(l.gameId === leg.gameId && l.betType === leg.betType && l.pickLabel === leg.pickLabel)));
    } else {
      if (legs.length >= maxLegs) {
        showToast(slipType === "single" ? "Single bets allow only 1 leg" : "Maximum 10 legs allowed", "error");
        return;
      }
      setLegs(prev => [...prev, leg]);
    }
  }

  function removeLeg(idx: number) {
    setLegs(prev => prev.filter((_, i) => i !== idx));
  }

  function handleSlipTypeChange(t: SlipType) {
    setSlipType(t);
    if (t === "single") setLegs(prev => prev.slice(0, 1));
  }

  const stakeNum = parseFloat(stake) || 0;
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null;

  let payoutDisplay = "";
  let totalStake = stakeNum;
  if (slipType === "single" && legs.length === 1 && stakeNum > 0) {
    payoutDisplay = fmtCoins(Math.round(calcPayout(stakeNum, legs[0].oddsAmerican)));
  } else if (slipType === "parlay" && legs.length >= 2 && stakeNum > 0) {
    const dec = legs.reduce((a, l) => a * toDecimal(l.oddsAmerican), 1);
    const combinedAmerican = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
    payoutDisplay = `${fmtOdds(combinedAmerican)} → ${fmtCoins(Math.round(calcParlayPayout(stakeNum, legs)))} coins`;
  } else if (slipType === "round_robin" && legs.length >= 3 && stakeNum > 0 && rrSizes.size > 0) {
    const sortedSizes = [...rrSizes].sort((a, b) => a - b);
    const totalCombos = sortedSizes.reduce((sum, s) => sum + numCombos(legs.length, s), 0);
    totalStake = stakeNum * totalCombos;
    const sizeLabels = sortedSizes.map(s => `${numCombos(legs.length, s)}×${s}-leg`).join(" + ");
    payoutDisplay = `${sizeLabels} = ${totalCombos} combos · ${fmtCoins(totalStake)} total`;
  }

  const hasAccount = accounts.length > 0 && selectedAccountId !== null;

  const canPlace = (() => {
    if (!hasAccount || stakeNum <= 0) return false;
    if (slipType === "single" && legs.length !== 1) return false;
    if (slipType === "parlay" && legs.length < 2) return false;
    if (slipType === "round_robin" && (legs.length < 3 || rrSizes.size === 0)) return false;
    if (selectedAccount && totalStake > selectedAccount.balance) return false;
    return true;
  })();

  async function placeBet() {
    if (!canPlace || !selectedAccountId) return;
    setPlacing(true);
    try {
      if (slipType === "round_robin") {
        // Fire one POST per selected combo size
        const sortedSizes = [...rrSizes].sort((a, b) => a - b);
        const results = await Promise.all(sortedSizes.map(size =>
          fetch("/api/book/bet", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: selectedAccountId, slipType, stake: stakeNum, legs, rrSize: size }),
          })
        ));
        const failed = results.filter(r => !r.ok);
        if (failed.length > 0) {
          const err = await failed[0].json().catch(() => ({ error: "Failed to place bet" }));
          showToast(err.error ?? "Failed to place bet", "error");
          return;
        }
        showToast(`${sortedSizes.length} RR slip${sortedSizes.length > 1 ? "s" : ""} placed!`);
      } else {
        const body: Record<string, unknown> = { accountId: selectedAccountId, slipType, stake: stakeNum, legs };
        const r = await fetch("/api/book/bet", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: "Failed to place bet" }));
          showToast(err.error ?? "Failed to place bet", "error");
          return;
        }
        showToast("Bet placed!");
      }
      setLegs([]);
      setStake("");
      qc.invalidateQueries({ queryKey: ["book-accounts"] });
      qc.invalidateQueries({ queryKey: ["book-slips"] });
    } catch (e: any) {
      showToast(e.message ?? "Network error", "error");
    } finally {
      setPlacing(false);
    }
  }

  function getBkm(game: Game): Bookmaker | undefined {
    return game.bookmakers.find(b => b.key === "draftkings") ?? game.bookmakers[0];
  }

  function getMarket(game: Game, key: string): Market | undefined {
    const bkm = getBkm(game);
    return bkm?.markets.find(m => m.key === key);
  }

  function buildMLLeg(game: Game, outcome: Outcome): Leg {
    const gd = new Date(game.commence_time);
    return {
      sport, betType: "moneyline", gameId: game.id,
      homeTeam: game.home_team, awayTeam: game.away_team,
      pickLabel: `${outcome.name} ML`,
      oddsAmerican: outcome.price,
      gameDate: gd.toISOString().slice(0, 10),
      gameTime: game.commence_time,
    };
  }

  function buildSpreadLeg(game: Game, outcome: Outcome): Leg {
    const gd = new Date(game.commence_time);
    const sign = outcome.point != null && outcome.point > 0 ? "+" : "";
    return {
      sport, betType: "spread", gameId: game.id,
      homeTeam: game.home_team, awayTeam: game.away_team,
      line: outcome.point,
      pickLabel: `${outcome.name} ${sign}${outcome.point} (${fmtOdds(outcome.price)})`,
      oddsAmerican: outcome.price,
      gameDate: gd.toISOString().slice(0, 10),
      gameTime: game.commence_time,
    };
  }

  function buildTotalLeg(game: Game, outcome: Outcome): Leg {
    const gd = new Date(game.commence_time);
    const isOver = outcome.name.toLowerCase() === "over";
    return {
      sport, betType: "total", gameId: game.id,
      homeTeam: game.home_team, awayTeam: game.away_team,
      line: outcome.point,
      overUnder: isOver ? "over" : "under",
      pickLabel: `${isOver ? "O" : "U"}${outcome.point} (${fmtOdds(outcome.price)})`,
      oddsAmerican: outcome.price,
      gameDate: gd.toISOString().slice(0, 10),
      gameTime: game.commence_time,
    };
  }

  function showGame(game: Game): boolean {
    if (betFilter === "props") return true; // all games can have props
    if (betFilter === "all") return true;
    if (betFilter === "moneyline") return !!getMarket(game, "h2h");
    if (betFilter === "spread")    return !!getMarket(game, "spreads");
    if (betFilter === "total")     return !!getMarket(game, "totals");
    return true;
  }

  return (
    <div>
      {/* No account warning */}
      {!accountsLoading && accounts.length === 0 && (
        <div style={{ margin: "12px 12px 0", background: `rgba(212,168,67,0.12)`, border: `1.5px solid ${GOLD}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <AlertCircle size={16} color={GOLD} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: FG }}>Create an account to place bets</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>You need at least one bankroll account first.</div>
          </div>
          <button
            onClick={onGoToAccounts}
            style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: GOLD, color: NAVY, fontWeight: 700, fontSize: 12, cursor: "pointer", flexShrink: 0 }}
          >
            Create
          </button>
        </div>
      )}

      {/* Game Browser */}
      <div style={{ padding: "12px 12px 0" }}>
        {/* Sport tabs */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {SPORTS_LIST.map(s => (
            <button
              key={s.id}
              onClick={() => setSport(s.id)}
              style={{
                padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700,
                fontSize: 12, flexShrink: 0,
                background: sport === s.id ? GOLD : "rgba(19,35,58,0.08)",
                color: sport === s.id ? NAVY : MUTED,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Bet type filter */}
        <div style={{ display: "flex", gap: 5, marginTop: 8, overflowX: "auto" }}>
          {BET_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setBetFilter(f.id)}
              style={{
                padding: "4px 10px", borderRadius: 16, border: `1px solid ${betFilter === f.id ? GOLD : "#ddd"}`,
                cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0,
                background: betFilter === f.id ? `rgba(212,168,67,0.12)` : "transparent",
                color: betFilter === f.id ? GOLD : MUTED,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Games list */}
      <div style={{ padding: "10px 12px 0" }}>
        {oddsLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[1, 2, 3].map(i => <Skeleton key={i} h={110} r={12} />)}
          </div>
        ) : oddsError ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: RED, fontSize: 13 }}>
            <AlertCircle size={20} style={{ marginBottom: 6 }} />
            <div>Failed to load games</div>
          </div>
        ) : games.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: MUTED, fontSize: 13 }}>
            No upcoming {sport.toUpperCase()} games available
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {games.filter(showGame).map(game => {
              const mlMkt   = getMarket(game, "h2h");
              const spMkt   = getMarket(game, "spreads");
              const totMkt  = getMarket(game, "totals");
              const gameTime = new Date(game.commence_time);

              return (
                <div key={game.id} style={{ background: CARD_BG, borderRadius: 12, padding: "12px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
                  {/* Teams & time */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: FG }}>{game.away_team} @ {game.home_team}</div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                        <Clock size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />
                        {gameTime.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {gameTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, background: "rgba(19,35,58,0.08)", padding: "2px 8px", borderRadius: 10, color: MUTED, fontWeight: 600 }}>
                      {sport.toUpperCase()}
                    </span>
                  </div>

                  {/* Bet chips */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {/* Moneyline */}
                    {mlMkt && (betFilter === "all" || betFilter === "moneyline") && (
                      <div>
                        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 3 }}>MONEYLINE</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {mlMkt.outcomes.map(oc => {
                            const leg = buildMLLeg(game, oc);
                            const active = isInSlip(game.id, "moneyline", leg.pickLabel);
                            return (
                              <button
                                key={oc.name}
                                className="book-chip"
                                onClick={() => toggleLeg(leg)}
                                style={{
                                  flex: 1, padding: "6px 4px", borderRadius: 8,
                                  border: `1.5px solid ${active ? GOLD : "#e2e8f0"}`,
                                  background: active ? `rgba(212,168,67,0.12)` : "#f8fafc",
                                  color: active ? GOLD : FG, fontSize: 12, fontWeight: 700,
                                }}
                              >
                                <span style={{ display: "block", fontSize: 10, color: active ? GOLD : MUTED }}>{oc.name.length > 12 ? oc.name.slice(0, 12) + ".." : oc.name}</span>
                                {fmtOdds(oc.price)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Spread */}
                    {spMkt && (betFilter === "all" || betFilter === "spread") && (
                      <div>
                        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 3 }}>SPREAD</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {spMkt.outcomes.map(oc => {
                            const leg = buildSpreadLeg(game, oc);
                            const active = isInSlip(game.id, "spread", leg.pickLabel);
                            return (
                              <button
                                key={oc.name + oc.point}
                                className="book-chip"
                                onClick={() => toggleLeg(leg)}
                                style={{
                                  flex: 1, padding: "6px 4px", borderRadius: 8,
                                  border: `1.5px solid ${active ? GOLD : "#e2e8f0"}`,
                                  background: active ? `rgba(212,168,67,0.12)` : "#f8fafc",
                                  color: active ? GOLD : FG, fontSize: 11, fontWeight: 700,
                                }}
                              >
                                <span style={{ display: "block", fontSize: 10, color: active ? GOLD : MUTED }}>{oc.name.length > 10 ? oc.name.slice(0, 10) + ".." : oc.name}</span>
                                {oc.point != null ? (oc.point > 0 ? "+" : "") + oc.point : ""} ({fmtOdds(oc.price)})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Total */}
                    {totMkt && (betFilter === "all" || betFilter === "total") && (
                      <div>
                        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginBottom: 3 }}>TOTAL</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {totMkt.outcomes.map(oc => {
                            const leg = buildTotalLeg(game, oc);
                            const active = isInSlip(game.id, "total", leg.pickLabel);
                            return (
                              <button
                                key={oc.name}
                                className="book-chip"
                                onClick={() => toggleLeg(leg)}
                                style={{
                                  flex: 1, padding: "6px 4px", borderRadius: 8,
                                  border: `1.5px solid ${active ? GOLD : "#e2e8f0"}`,
                                  background: active ? `rgba(212,168,67,0.12)` : "#f8fafc",
                                  color: active ? GOLD : FG, fontSize: 11, fontWeight: 700,
                                }}
                              >
                                {oc.name.toUpperCase().slice(0, 1)}{oc.point} ({fmtOdds(oc.price)})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Props expansion (shown when filter is "all" or "props") */}
                    {(betFilter === "all" || betFilter === "props") && (
                      <GamePropsPanel
                        token={token}
                        sport={sport}
                        game={game}
                        legs={legs}
                        toggleLeg={toggleLeg}
                        showToast={showToast}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Active Slip ── */}
      <div style={{ margin: "16px 12px 0", background: CARD_BG, borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.09)", padding: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: FG }}>Active Slip</span>
          {legs.length > 0 && (
            <button onClick={() => setLegs([])} style={{ fontSize: 11, color: RED, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
              Clear all
            </button>
          )}
        </div>

        {/* Slip type toggle */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
          {(["single", "parlay", "round_robin"] as SlipType[]).map(t => (
            <button
              key={t}
              onClick={() => handleSlipTypeChange(t)}
              style={{
                flex: 1, padding: "6px 4px", borderRadius: 8, border: "none", cursor: "pointer",
                background: slipType === t ? NAVY : "transparent",
                color: slipType === t ? "#fff" : MUTED,
                fontWeight: 700, fontSize: 10,
              }}
            >
              {t === "round_robin" ? "RR" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* RR size — multi-select: tap any combo size to include/exclude it */}
        {slipType === "round_robin" && legs.length >= 3 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 6 }}>Combo sizes (select any):</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Array.from({ length: legs.length - 1 }, (_, i) => i + 2).map(n => {
                const count = numCombos(legs.length, n);
                const active = rrSizes.has(n);
                return (
                  <button
                    key={n}
                    onClick={() => toggleRrSize(n)}
                    style={{
                      padding: "5px 13px", borderRadius: 16,
                      border: `1.5px solid ${active ? GOLD : "#ddd"}`,
                      background: active ? `rgba(212,168,67,0.15)` : "transparent",
                      color: active ? GOLD : MUTED,
                      fontWeight: 700, fontSize: 12, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <span style={{
                      width: 12, height: 12, borderRadius: 3,
                      border: `1.5px solid ${active ? GOLD : "#bbb"}`,
                      background: active ? GOLD : "transparent",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, color: "#fff", flexShrink: 0,
                    }}>{active ? "✓" : ""}</span>
                    {n}-leg
                    <span style={{ fontSize: 10, fontWeight: 500, color: active ? GOLD : MUTED }}>({count})</span>
                  </button>
                );
              })}
            </div>
            {rrSizes.size === 0 && (
              <div style={{ fontSize: 10, color: RED, marginTop: 4 }}>Select at least one combo size</div>
            )}
          </div>
        )}

        {/* Legs */}
        {legs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: MUTED, fontSize: 12 }}>
            Tap any odds chip above to add legs
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {legs.map((leg, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", background: "#f8fafc", borderRadius: 8, padding: "8px 10px", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: FG, lineHeight: 1.3 }}>{leg.pickLabel}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                    {leg.sport.toUpperCase()} · {leg.betType}
                    {leg.playerName && ` · ${leg.statType?.toUpperCase()}`}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: leg.oddsAmerican > 0 ? "#16a34a" : MUTED }}>
                    {fmtOdds(leg.oddsAmerican)}
                  </span>
                  <button onClick={() => removeLeg(i)} style={{ background: "none", border: "none", cursor: "pointer", color: RED, lineHeight: 1 }}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Account selector */}
        {accounts.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 4 }}>Account</div>
            <select
              value={selectedAccountId ?? ""}
              onChange={e => setSelectedAccountId(Number(e.target.value))}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", color: FG, fontWeight: 600 }}
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} — {fmtCoins(a.balance)} coins</option>
              ))}
            </select>
          </div>
        )}

        {/* Stake */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 4 }}>Stake (coins)</div>
          <input
            type="number"
            value={stake}
            onChange={e => setStake(e.target.value)}
            placeholder="0"
            min={1}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, background: "#f8fafc", color: FG, fontWeight: 700, boxSizing: "border-box" }}
          />
          {selectedAccount && stakeNum > selectedAccount.balance && (
            <div style={{ fontSize: 11, color: RED, marginTop: 4 }}>Insufficient balance ({fmtCoins(selectedAccount.balance)} coins)</div>
          )}
        </div>

        {/* Payout preview */}
        {payoutDisplay && (
          <div style={{ background: "rgba(212,168,67,0.08)", border: `1px solid rgba(212,168,67,0.3)`, borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: GOLD, fontWeight: 600 }}>
            {slipType === "round_robin" ? payoutDisplay : `Payout: ${payoutDisplay}`}
          </div>
        )}

        {/* Validation hints */}
        {!hasAccount ? (
          <div style={{ fontSize: 11, color: GOLD, marginBottom: 8, fontWeight: 600 }}>
            ⚠ Create an account first to place bets
          </div>
        ) : slipType === "single" && legs.length === 0 ? (
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>Add 1 leg for a single bet</div>
        ) : slipType === "parlay" && legs.length < 2 ? (
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>Add at least 2 legs for a parlay</div>
        ) : slipType === "round_robin" && legs.length < 3 ? (
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>Add at least 3 legs for a round robin</div>
        ) : null}

        {/* Place bet */}
        <button
          className="book-btn-gold"
          onClick={!hasAccount ? onGoToAccounts : placeBet}
          disabled={hasAccount && (!canPlace || placing)}
          style={{
            width: "100%", padding: "12px", borderRadius: 10, border: "none",
            cursor: (!hasAccount || canPlace) ? "pointer" : "not-allowed",
            background: !hasAccount ? GOLD : canPlace ? GOLD : "#e2e8f0",
            color: !hasAccount ? NAVY : canPlace ? NAVY : MUTED,
            fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {placing ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
          {!hasAccount ? "Create Account to Bet" : "Place Bet"}
        </button>
      </div>
    </div>
  );
}

// ─── Live progress types ────────────────────────────────────────────────────
interface LegProgress {
  legId: number;
  playerName: string | null;
  statType: string | null;
  line: number;
  overUnder: string;
  pickLabel: string;
  oddsAmerican: number;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  betType: string;
  currentStat: number | null;
  gameStatus: "scheduled" | "live" | "final" | "postponed";
  status: string; // pending | winning | losing | win | loss | push
  legResult: string | null;
  homeScore?: string | null;
  awayScore?: string | null;
  gamePeriod?: string | null;
  gamePeriodLabel?: string | null;
  postponedReason?: string | null;
}

function legStatusColor(s: string) {
  if (s === "win" || s === "winning")  return { bg: "#dcfce7", text: "#16a34a", border: "#16a34a" };
  if (s === "loss" || s === "losing")  return { bg: "#fee2e2", text: "#dc2626", border: "#dc2626" };
  if (s === "push")                    return { bg: "#f1f5f9", text: "#64748b", border: "#64748b" };
  return { bg: "#fefce8", text: "#d97706", border: "#e5e7eb" };
}

function ProgressBar({ current, line, isOver }: { current: number; line: number; isOver: boolean }) {
  const pct = Math.min(100, Math.round((current / line) * 100));
  const winning = isOver ? current >= line : current <= line;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 5, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: winning ? "#16a34a" : "#ef4444", borderRadius: 4, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function SlipProgressPanel({ slipId, token, onSettled, onVoidSlip }: { slipId: number; token: string; onSettled?: () => void; onVoidSlip?: () => void }) {
  const [settling, setSettling] = React.useState<number | null>(null); // legId being settled
  const [overrideLegId, setOverrideLegId] = React.useState<number | null>(null);
  const [overrideResult, setOverrideResult] = React.useState<"win"|"loss"|"push"|"void">("win");
  const [overrideNote, setOverrideNote] = React.useState("");
  const [overriding, setOverriding] = React.useState(false);
  const [voidingSlip, setVoidingSlip] = React.useState(false);
  const qc = useQueryClient();

  async function settleLeg(legId: number, result: "push" | "void") {
    setSettling(legId);
    try {
      const r = await fetch("/api/book/settle-leg", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ legId, result }),
      });
      const d = await r.json();
      qc.invalidateQueries({ queryKey: ["slip-progress", slipId] });
      qc.invalidateQueries({ queryKey: ["book-slips"] });
      qc.invalidateQueries({ queryKey: ["book-accounts"] });
      if (d.slipSettled) onSettled?.();
    } finally { setSettling(null); }
  }

  async function applyOverride(legId: number) {
    setOverriding(true);
    try {
      const r = await fetch(`/api/book/legs/${legId}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ result: overrideResult, note: overrideNote || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Server error ${r.status}`);
      setOverrideLegId(null);
      // Invalidate everything so the list updates immediately
      await qc.invalidateQueries({ queryKey: ["slip-progress", slipId] });
      await qc.invalidateQueries({ queryKey: ["book-slips"] });
      await qc.invalidateQueries({ queryKey: ["book-accounts"] });
      // If slip still has pending legs, let the user know
      if (d.slipStatus === "still_open") {
        alert("Leg updated. Slip still has other pending legs — it will settle once all legs are graded.");
      }
    } catch (e: any) { alert("Override failed: " + e.message); }
    setOverriding(false);
  }

  async function voidSlip() {
    if (!confirm(`Void entire slip #${slipId}? Stake will be refunded.`)) return;
    setVoidingSlip(true);
    try {
      const r = await fetch(`/api/book/slips/${slipId}/void`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note: overrideNote || "Owner void" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setOverrideLegId(null);
      qc.invalidateQueries({ queryKey: ["book-slips"] });
      qc.invalidateQueries({ queryKey: ["book-accounts"] });
      onVoidSlip?.();
    } catch (e: any) { alert("Void failed: " + e.message); }
    setVoidingSlip(false);
  }

  const { data, isLoading } = useQuery<{ legs: LegProgress[] }>({
    queryKey: ["slip-progress", slipId],
    queryFn: async () => {
      const r = await fetch(`/api/book/slip-progress?slipId=${slipId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load progress");
      return r.json();
    },
    refetchInterval: 30_000, // refresh every 30s
    staleTime: 25_000,
  });

  if (isLoading) return <div style={{ padding: "10px 0", color: MUTED, fontSize: 12, textAlign: "center" }}>Loading live stats...</div>;
  if (!data?.legs?.length) return <div style={{ padding: "6px 0", color: MUTED, fontSize: 11, textAlign: "center" }}>No progress data available yet</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.legs.map(leg => {
        const sc = leg.gameStatus === "postponed"
          ? { bg: "#fefce8", text: "#b45309", border: "#f59e0b" }
          : legStatusColor(leg.status);
        const isOver = (leg.over_under ?? "over") === "over";
        const hasLiveStat = leg.currentStat !== null;
        const isPlayerProp = !!leg.playerName;
        const isPostponed = leg.gameStatus === "postponed";
        const isSettling = settling === leg.legId;
        return (
          <div key={leg.legId} style={{
            background: sc.bg,
            border: `1.5px solid ${sc.border}`,
            borderRadius: 10, padding: "10px 12px",
          }}>
            {/* Postponed alert banner */}
            {isPostponed && (
              <div style={{
                background: "#fef3c7", border: "1px solid #f59e0b",
                borderRadius: 8, padding: "8px 10px", marginBottom: 8,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#92400e", marginBottom: 4 }}>
                  ⚠️ Game Postponed{leg.postponedReason ? ` · ${leg.postponedReason}` : ""}
                </div>
                <div style={{ fontSize: 10, color: "#78350f", marginBottom: 8 }}>
                  This game may be rescheduled. Choose how to handle this leg:
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    disabled={isSettling}
                    onClick={() => settleLeg(leg.legId, "push")}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 8, border: "none",
                      background: "#16a34a", color: "#fff", fontSize: 11, fontWeight: 700,
                      cursor: isSettling ? "default" : "pointer", opacity: isSettling ? 0.6 : 1,
                    }}
                  >
                    {isSettling ? "Settling..." : "Settle as Push"}
                  </button>
                  <button
                    disabled={isSettling}
                    onClick={() => settleLeg(leg.legId, "void")}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 8,
                      border: "1.5px solid #d97706", background: "transparent",
                      color: "#92400e", fontSize: 11, fontWeight: 700,
                      cursor: isSettling ? "default" : "pointer", opacity: isSettling ? 0.6 : 1,
                    }}
                  >
                    Void Leg
                  </button>
                  <button
                    disabled={isSettling}
                    onClick={() => qc.invalidateQueries({ queryKey: ["slip-progress", slipId] })}
                    style={{
                      padding: "6px 10px", borderRadius: 8,
                      border: "1.5px solid #d97706", background: "transparent",
                      color: "#92400e", fontSize: 11, fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Keep Open
                  </button>
                </div>
              </div>
            )}

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: FG, marginBottom: 1 }}>{leg.pickLabel}</div>
                <div style={{ fontSize: 10, color: MUTED, marginBottom: 1 }}>{fmtOdds(leg.oddsAmerican)}{leg.gameDate ? ` · ${leg.gameDate}` : ""}</div>
                {leg.gameStatus !== "scheduled" && leg.gameStatus !== "postponed" && leg.homeTeam && (
                  <div style={{ marginTop: 4 }}>
                    {/* Score row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: FG }}>
                        {leg.awayTeam} <span style={{ fontSize: 13, fontWeight: 800 }}>{leg.awayScore ?? "-"}</span>
                        <span style={{ fontSize: 10, color: MUTED, margin: "0 4px" }}>@</span>
                        {leg.homeTeam} <span style={{ fontSize: 13, fontWeight: 800 }}>{leg.homeScore ?? "-"}</span>
                      </div>
                      {leg.gameStatus === "live" ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, padding: "1px 6px", fontSize: 9, fontWeight: 800, color: "#ef4444", whiteSpace: "nowrap" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite", display: "inline-block" }} />
                          LIVE
                        </span>
                      ) : (
                        <span style={{ fontSize: 9, fontWeight: 800, color: MUTED, background: "rgba(61,75,88,0.08)", borderRadius: 6, padding: "1px 6px" }}>FINAL</span>
                      )}
                    </div>
                    {/* Period / inning / clock row */}
                    {(leg.gamePeriodLabel || leg.gamePeriod) && (
                      <div style={{ marginTop: 2, fontSize: 10, color: leg.gameStatus === "live" ? "#ef4444" : MUTED, fontWeight: 600 }}>
                        {leg.gamePeriodLabel && <span>{leg.gamePeriodLabel}</span>}
                        {leg.gamePeriod && leg.gamePeriod !== "0:00" && leg.gameStatus === "live" && (
                          <span style={{ marginLeft: 4 }}>· {leg.gamePeriod}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {leg.gameStatus === "scheduled" && (
                  <div style={{ fontSize: 10, color: MUTED }}>Scheduled · {leg.gameDate ?? ""}</div>
                )}
                {leg.gameStatus === "postponed" && (
                  <div style={{ fontSize: 10, color: "#b45309", fontWeight: 600 }}>{leg.awayTeam} @ {leg.homeTeam}</div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: sc.text, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {isPostponed ? "PPD" : leg.status === "pending" ? (leg.gameStatus === "scheduled" ? "TBD" : "–") : leg.status.toUpperCase()}
                </span>
                <button
                  onClick={() => { setOverrideLegId(overrideLegId === leg.legId ? null : leg.legId); setOverrideResult("win"); setOverrideNote(""); }}
                  title="Override grade"
                  style={{ background: "none", border: `1.5px solid ${overrideLegId === leg.legId ? GOLD : "#cbd5e1"}`, borderRadius: 6, padding: "2px 7px", cursor: "pointer", fontSize: 10, color: overrideLegId === leg.legId ? GOLD : MUTED, fontWeight: 700 }}
                >
                  {overrideLegId === leg.legId ? "×" : "✎"}
                </button>
              </div>
            </div>

            {/* Player stat progress */}
            {isPlayerProp && hasLiveStat && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600, color: FG }}>
                  <span>Current: <strong>{leg.currentStat}</strong></span>
                  <span>Line: {isOver ? "O" : "U"} {leg.line}</span>
                </div>
                <ProgressBar current={leg.currentStat!} line={leg.line} isOver={isOver} />
              </div>
            )}
            {isPlayerProp && !hasLiveStat && leg.gameStatus !== "scheduled" && (
              <div style={{ marginTop: 4, fontSize: 10, color: MUTED }}>Stats not yet available</div>
            )}

            {/* Inline override panel */}
            {overrideLegId === leg.legId && (
              <div style={{ marginTop: 8, padding: "10px", background: "rgba(255,255,255,0.7)", borderRadius: 8, border: `1.5px solid ${GOLD}`, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: GOLD }}>Override Grade — Leg #{leg.legId}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["win","loss","push","void"] as const).map(r => (
                    <button key={r} onClick={() => setOverrideResult(r)}
                      style={{ flex: 1, padding: "5px 2px", borderRadius: 6, border: "1.5px solid",
                        borderColor: overrideResult === r ? GOLD : "#e2e8f0",
                        background: overrideResult === r ? GOLD : "transparent",
                        color: overrideResult === r ? "#fff" : FG,
                        fontWeight: 700, fontSize: 11, cursor: "pointer", textTransform: "uppercase" }}
                    >{r}</button>
                  ))}
                </div>
                <input
                  placeholder="Note (optional)"
                  value={overrideNote}
                  onChange={e => setOverrideNote(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, color: FG, background: "#f8fafc" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => applyOverride(leg.legId)}
                    disabled={overriding}
                    style={{ flex: 1, padding: "7px", borderRadius: 8, border: "none", background: GOLD, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                  >
                    {overriding ? "Saving..." : "Apply Override"}
                  </button>
                  <button
                    onClick={voidSlip}
                    disabled={voidingSlip}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid #ef4444", background: "transparent", color: "#ef4444", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                  >
                    {voidingSlip ? "Voiding..." : "Void Slip"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Slip share overlay ───────────────────────────────────────────────────────
function SlipShareCard({ slip, onClose }: { slip: Slip; onClose: () => void }) {
  const typeLabel = slip.slip_type === "round_robin" ? "Round Robin" : slip.slip_type.charAt(0).toUpperCase() + slip.slip_type.slice(1);
  const sc = statusColor(slip.status);
  const isWon  = slip.status === "won";
  const isLost = slip.status === "lost";

  const headerBg  = isWon ? "#16a34a" : isLost ? "#dc2626" : NAVY;
  const accentCol = isWon ? "#bbf7d0" : isLost ? "#fecaca" : GOLD;

  return (
    /* Dark dim overlay — tap outside card to close */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.82)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      {/* The share card itself — stop propagation so tapping it doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 380,
          borderRadius: 20, overflow: "hidden",
          boxShadow: "0 8px 48px rgba(0,0,0,0.5)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ background: headerBg, padding: "18px 20px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Clubhouse IQ</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", marginTop: 2 }}>{typeLabel}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ background: accentCol, color: headerBg, fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 20, letterSpacing: 0.5 }}>
                {slip.status.toUpperCase()}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                {new Date(slip.placed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </div>
            </div>
          </div>
          {/* Stake / payout row */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, background: "rgba(255,255,255,0.12)", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>Stake</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{fmtCoins(slip.stake)}</div>
            </div>
            <div style={{ flex: 1, background: "rgba(255,255,255,0.12)", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
                {slip.status === "won" ? "Won" : slip.status === "lost" ? "Lost" : "To Win"}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: accentCol }}>
                {slip.payout_received != null ? fmtCoins(slip.payout_received) : fmtCoins(slip.potential_payout)}
              </div>
            </div>
          </div>
        </div>

        {/* Legs */}
        <div style={{ background: "#fff", padding: "14px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
            {slip.legs.length} Leg{slip.legs.length !== 1 ? "s" : ""}
            {slip.slip_type === "round_robin" && slip.rr_combos ? ` · ${slip.rr_combos.length} combos` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {slip.legs.map((leg, i) => {
              const rc = legResultColor(leg.result ?? "pending");
              const resultDot = leg.result === "win" ? "🟢" : leg.result === "loss" ? "🔴" : leg.result === "push" ? "🟡" : "⚪";
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 10px", borderRadius: 10,
                  background: leg.result === "win" ? "#f0fdf4" : leg.result === "loss" ? "#fef2f2" : "#f8fafc",
                  border: `1px solid ${leg.result === "win" ? "#bbf7d0" : leg.result === "loss" ? "#fecaca" : "#e2e8f0"}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: FG, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {leg.pick_label}
                    </div>
                    {leg.stat_type && leg.line != null && (
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                        {leg.over_under === "over" ? "O" : "U"} {leg.line} · {fmtOdds(leg.odds_american)}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{resultDot}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: "#f8fafc", padding: "10px 20px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Camera size={12} color={MUTED} />
          <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Take a screenshot to share · clubhouseiq.app</span>
        </div>
      </div>

      {/* Close hint */}
      <button
        onClick={onClose}
        style={{
          marginTop: 20, background: "rgba(255,255,255,0.12)", border: "none",
          color: "#fff", fontSize: 13, fontWeight: 600, padding: "10px 28px",
          borderRadius: 20, cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — MY BETS
// ═══════════════════════════════════════════════════════════════════════════════

function MyBetsTab({
  token, accounts, selectedAccountId, setSelectedAccountId, showToast,
}: {
  token: string;
  accounts: Account[];
  selectedAccountId: number | null;
  setSelectedAccountId: (id: number) => void;
  showToast: (msg: string, type?: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<BetsFilter>("open");
  const [expandedSlip, setExpandedSlip] = useState<number | null>(null);
  const [progressOpen, setProgressOpen] = useState<Set<number>>(new Set());

  const [shareSlip, setShareSlip] = useState<Slip | null>(null);
  const qc = useQueryClient();
  const [grading, setGrading] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<{ slips: Slip[] }>({
    queryKey: ["book-slips", selectedAccountId, statusFilter],
    queryFn: async () => {
      if (!selectedAccountId) return { slips: [] };
      // won/lost tabs hit the settled endpoint then client-filters by exact status
      const apiStatus = (statusFilter === "won" || statusFilter === "lost") ? "settled" : statusFilter;
      const r = await fetch(`/api/book/slips?accountId=${selectedAccountId}&status=${apiStatus}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!selectedAccountId,
    refetchInterval: statusFilter === "open" ? 30_000 : false,
  });

  // Client-filter for won/lost specific tabs
  const slips = (data?.slips ?? []).filter(s => {
    if (statusFilter === "won")  return s.status === "won";
    if (statusFilter === "lost") return s.status === "lost" || s.status === "push";
    return true;
  });

  return (
    <div style={{ padding: "12px 12px 0" }}>
      {/* Share overlay */}
      {shareSlip && <SlipShareCard slip={shareSlip} onClose={() => setShareSlip(null)} />}

      {/* Account selector */}
      {accounts.length > 0 && (
        <select
          value={selectedAccountId ?? ""}
          onChange={e => setSelectedAccountId(Number(e.target.value))}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: CARD_BG, color: FG, fontWeight: 600, marginBottom: 10 }}
        >
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}

      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
        {([
          { key: "open",  label: "Open",   activeBg: NAVY,      activeText: "#fff" },
          { key: "won",   label: "Wins ✓",  activeBg: "#16a34a", activeText: "#fff" },
          { key: "lost",  label: "Losses",  activeBg: "#dc2626", activeText: "#fff" },
        ] as { key: BetsFilter; label: string; activeBg: string; activeText: string }[]).map(({ key, label, activeBg, activeText }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            style={{
              flex: 1, padding: "7px 4px", borderRadius: 8, border: "none", cursor: "pointer",
              background: statusFilter === key ? activeBg : "rgba(19,35,58,0.06)",
              color: statusFilter === key ? activeText : MUTED,
              fontWeight: 700, fontSize: 12,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {statusFilter === "open" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: MUTED }}>Auto-refreshes every 30s</div>
          <button
            disabled={grading}
            onClick={async () => {
              setGrading(true);
              try {
                const r = await fetch("/api/book/grade-now", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                });
                const d = await r.json();
                const settled = (d.forceSettled ?? 0) + (d.rrSettled ?? 0);
                showToast(settled > 0 ? `✓ ${settled} slip${settled !== 1 ? "s" : ""} settled` : "No new results yet");
                qc.invalidateQueries({ queryKey: ["book-slips"] });
                qc.invalidateQueries({ queryKey: ["book-accounts"] });
              } catch { showToast("Grade failed", "error"); }
              finally { setGrading(false); }
            }}
            style={{
              fontSize: 10, fontWeight: 700, color: grading ? MUTED : NAVY, background: "none",
              border: `1px solid ${grading ? MUTED : NAVY}`, borderRadius: 12, padding: "3px 10px",
              cursor: grading ? "default" : "pointer", opacity: grading ? 0.6 : 1,
            }}
          >
            {grading ? "Grading..." : "Grade Now"}
          </button>
        </div>
      )}
      {statusFilter === "won" && (
        <div style={{ fontSize: 10, color: "#16a34a", marginBottom: 8, textAlign: "right", fontWeight: 700 }}>Winning bets — green is good</div>
      )}
      {statusFilter === "lost" && (
        <div style={{ fontSize: 10, color: "#dc2626", marginBottom: 8, textAlign: "right", fontWeight: 700 }}>Losses · pushes included</div>
      )}

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} h={90} r={12} />)}
        </div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: RED, fontSize: 13 }}>
          <AlertCircle size={20} style={{ marginBottom: 6 }} />
          <div>Failed to load bets</div>
        </div>
      ) : slips.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: MUTED, fontSize: 13 }}>
          No {statusFilter === "won" ? "winning" : statusFilter === "lost" ? "losing" : statusFilter !== "all" ? statusFilter : ""} bets found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {slips.map(slip => {
            const sc = statusColor(slip.status);
            const expanded = expandedSlip === slip.id;
            const isOpenSlip = slip.status === "open";
            return (
              <div key={slip.id} style={{ background: CARD_BG, borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", overflow: "hidden" }}>
                {/* Slip header */}
                <div
                  style={{ padding: "12px 14px", cursor: "pointer" }}
                  onClick={() => setExpandedSlip(expanded ? null : slip.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ background: slipTypeBg(slip.slip_type), color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 10, letterSpacing: 0.5 }}>
                        {slip.slip_type === "round_robin" ? "RR" : slip.slip_type.toUpperCase()}
                      </span>
                      <span style={{ background: sc.bg, color: sc.text, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>
                        {slip.status.toUpperCase()}
                      </span>
                    </div>
                    {expanded ? <ChevronUp size={14} color={MUTED} /> : <ChevronRight size={14} color={MUTED} />}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 12, color: MUTED }}>
                        Stake: <span style={{ fontWeight: 700, color: FG }}>{fmtCoins(slip.stake)}</span> →{" "}
                        {slip.status !== "open" && slip.payout_received != null
                          ? <span style={{ fontWeight: 700, color: slip.payout_received > 0 ? "#16a34a" : RED }}>{fmtCoins(slip.payout_received)}</span>
                          : <span style={{ fontWeight: 700, color: GOLD }}>{fmtCoins(slip.potential_payout)}</span>
                        }
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                        <Clock size={9} style={{ marginRight: 3, verticalAlign: "middle" }} />
                        {fmtDateTime(slip.placed_at)}
                        {slip.settled_at && ` · Settled ${fmtDateTime(slip.settled_at)}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <div style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>
                        {slip.legs.length} leg{slip.legs.length !== 1 ? "s" : ""}
                      </div>
                      {/* Share button */}
                      <button
                        onClick={e => { e.stopPropagation(); setShareSlip(slip); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          background: "none", border: `1.5px solid ${MUTED}`,
                          borderRadius: 20, padding: "3px 9px",
                          cursor: "pointer", color: MUTED, fontSize: 10, fontWeight: 700,
                        }}
                      >
                        <Share2 size={10} />
                        Share
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Progress — collapsible drawer, defaults open */}
                {isOpenSlip && slip.status === "open" && (() => {
                  // Default closed: drawer only opens when user explicitly opens it
                  const drawerOpen = progressOpen.has(slip.id);
                  return (
                    <div style={{ borderTop: "1px solid #f1f5f9" }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setProgressOpen(prev => {
                            const next = new Set(prev);
                            if (drawerOpen) next.delete(slip.id); else next.add(slip.id);
                            return next;
                          });
                        }}
                        style={{
                          width: "100%", padding: "7px 14px", background: drawerOpen ? "rgba(19,35,58,0.03)" : "none",
                          border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1.5s infinite", flexShrink: 0 }} />
                          Live Progress
                        </span>
                        {drawerOpen ? <ChevronUp size={13} color={NAVY} /> : <ChevronDown size={13} color={NAVY} />}
                      </button>
                      {drawerOpen && (
                        <div style={{ padding: "0 14px 12px" }}>
                          <SlipProgressPanel
                            slipId={slip.id}
                            token={token}
                            onSettled={() => qc.invalidateQueries({ queryKey: ["book-slips"] })}
                            onVoidSlip={() => {
                              setExpandedSlip(null);
                              qc.invalidateQueries({ queryKey: ["book-slips"] });
                              qc.invalidateQueries({ queryKey: ["book-accounts"] });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Expanded RR combos breakdown — only for round robins */}
                {expanded && slip.slip_type === "round_robin" && slip.rr_combos && slip.rr_combos.length > 0 && (
                  <div style={{ borderTop: "1px solid #f1f5f9", padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6 }}>
                      {slip.rr_combos.length} parlay combo{slip.rr_combos.length !== 1 ? "s" : ""} · Stake per combo: {fmtCoins(parseFloat(slip.stake) / slip.rr_combos.length)}
                    </div>
                    {slip.rr_combos.map((combo: any, ci: number) => {
                      const csc = statusColor(combo.child_status);
                      return (
                        <div key={combo.id} style={{ background: "#f1f5f9", borderRadius: 8, padding: "7px 10px", marginBottom: 5 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: FG }}>Combo {ci + 1} — {combo.legs?.length ?? 0}-leg parlay</span>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ background: csc.bg, color: csc.text, fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 8 }}>{combo.child_status?.toUpperCase()}</span>
                              <span style={{ fontSize: 10, color: GOLD, fontWeight: 700 }}>→ {fmtCoins(combo.child_payout)}</span>
                            </div>
                          </div>
                          {combo.legs?.map((cl: any, li: number) => (
                            <div key={li} style={{ fontSize: 10, color: MUTED, paddingLeft: 8, lineHeight: 1.6 }}>
                              • {cl.pick_label} <span style={{ color: FG, fontWeight: 600 }}>{fmtOdds(cl.odds_american)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

function AccountsTab({
  token, accounts, accountsLoading, showCreateAccount, setShowCreateAccount, refetchAccounts, showToast,
}: {
  token: string;
  accounts: Account[];
  accountsLoading: boolean;
  showCreateAccount: boolean;
  setShowCreateAccount: (v: boolean) => void;
  refetchAccounts: () => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) {
  const qc = useQueryClient();
  const [newAcctName, setNewAcctName] = useState("");
  const [creating, setCreating] = useState(false);

  const [addCoinsId, setAddCoinsId] = useState<number | null>(null);
  const [addCoinsAmt, setAddCoinsAmt] = useState("");
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState("");
  const [patchingId, setPatchingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function createAccount() {
    if (!newAcctName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/book/accounts", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newAcctName.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      showToast("Account created!");
      setNewAcctName("");
      setShowCreateAccount(false);
      refetchAccounts();
    } catch (e: any) {
      showToast(e.message ?? "Failed to create account", "error");
    } finally {
      setCreating(false);
    }
  }

  async function patchAccount(id: number, body: Record<string, unknown>) {
    setPatchingId(id);
    try {
      const r = await fetch(`/api/book/accounts/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      showToast("Account updated!");
      setAddCoinsId(null);
      setAddCoinsAmt("");
      setRenameId(null);
      setRenameName("");
      refetchAccounts();
    } catch (e: any) {
      showToast(e.message ?? "Failed to update account", "error");
    } finally {
      setPatchingId(null);
    }
  }

  async function deleteAccount(id: number, name: string) {
    if (!confirm(`Delete "${name}"?\n\nThis will permanently remove the account and all its history. This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/book/accounts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = d.error ?? `Server error ${r.status}`;
        showToast(msg, "error");
        alert(msg);
        return;
      }
      showToast(`"${name}" deleted`);
      // Invalidate cache first, then refetch — ensures stale data is cleared
      await qc.invalidateQueries({ queryKey: ["book-accounts"] });
      await refetchAccounts();
    } catch (e: any) {
      const msg = e.message ?? "Failed to delete account";
      showToast(msg, "error");
      alert(msg);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ padding: "12px 12px 0" }}>
      {(showCreateAccount || accounts.length === 0) && (
        <div style={{ background: CARD_BG, borderRadius: 14, padding: "16px", marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.08)", border: `1.5px solid ${GOLD}` }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: FG, marginBottom: 8 }}>
            {accounts.length === 0 ? "Create your first account" : "New Account"}
          </div>
          <input
            type="text"
            value={newAcctName}
            onChange={e => setNewAcctName(e.target.value)}
            placeholder="Account name (e.g. Main Bankroll)"
            onKeyDown={e => e.key === "Enter" && createAccount()}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, boxSizing: "border-box", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={createAccount}
              disabled={creating || !newAcctName.trim()}
              className="book-btn-gold"
              style={{
                flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: creating || !newAcctName.trim() ? "not-allowed" : "pointer",
                background: newAcctName.trim() ? GOLD : "#e2e8f0",
                color: newAcctName.trim() ? NAVY : MUTED, fontWeight: 700, fontSize: 13,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              }}
            >
              {creating ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} />}
              Create
            </button>
            {accounts.length > 0 && (
              <button onClick={() => setShowCreateAccount(false)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "transparent", color: MUTED, cursor: "pointer", fontSize: 13 }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {accounts.length > 0 && !showCreateAccount && (
        <button
          onClick={() => setShowCreateAccount(true)}
          className="book-btn-gold"
          style={{
            width: "100%", padding: "10px", borderRadius: 10, border: `1.5px dashed ${GOLD}`,
            background: "rgba(212,168,67,0.06)", color: GOLD, fontWeight: 700, fontSize: 13,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 12,
          }}
        >
          <PlusCircle size={16} /> New Account
        </button>
      )}

      {accountsLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2].map(i => <Skeleton key={i} h={130} r={14} />)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map(acct => {
            const winRate = acct.settled_slips > 0 ? (acct.won_slips / acct.settled_slips * 100) : 0;
            const profitPos = acct.total_profit >= 0;
            const isAddCoins = addCoinsId === acct.id;
            const isRename = renameId === acct.id;
            const patching = patchingId === acct.id;

            return (
              <div key={acct.id} style={{ background: CARD_BG, borderRadius: 14, padding: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  {isRename ? (
                    <div style={{ flex: 1, display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={renameName}
                        onChange={e => setRenameName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && patchAccount(acct.id, { name: renameName })}
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13 }}
                        autoFocus
                      />
                      <button onClick={() => patchAccount(acct.id, { name: renameName })} disabled={patching} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: GOLD, color: NAVY, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        {patching ? <Loader2 size={12} /> : <Check size={12} />}
                      </button>
                      <button onClick={() => setRenameId(null)} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: "#f1f5f9", color: MUTED, cursor: "pointer" }}>
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span style={{ fontWeight: 700, fontSize: 15, color: FG }}>{acct.name}</span>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button onClick={() => { setRenameId(acct.id); setRenameName(acct.name); }} title="Rename" style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, padding: "4px" }}>
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => deleteAccount(acct.id, acct.name)}
                          disabled={deletingId === acct.id}
                          title="Delete account"
                          style={{ background: "none", border: "none", cursor: deletingId === acct.id ? "default" : "pointer", color: deletingId === acct.id ? "#fca5a5" : "#ef4444", padding: "4px", opacity: deletingId === acct.id ? 0.5 : 1 }}
                        >
                          {deletingId === acct.id ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div style={{ fontSize: 28, fontWeight: 800, color: FG, marginBottom: 6 }}>
                  {fmtCoins(acct.balance)} <span style={{ fontSize: 13, fontWeight: 600, color: MUTED }}>coins</span>
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1, textAlign: "center", background: profitPos ? "rgba(34,197,94,0.08)" : "rgba(162,59,50,0.08)", borderRadius: 8, padding: "6px 4px" }}>
                    <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>P/L</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: profitPos ? "#16a34a" : RED }}>
                      {profitPos ? "+" : ""}{fmtCoins(acct.total_profit)}
                    </div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "#f8fafc", borderRadius: 8, padding: "6px 4px" }}>
                    <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Win Rate</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>{winRate.toFixed(0)}%</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "rgba(59,130,246,0.07)", borderRadius: 8, padding: "6px 4px" }}>
                    <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Open</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#3b82f6" }}>{acct.open_slips}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "#f8fafc", borderRadius: 8, padding: "6px 4px" }}>
                    <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Settled</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>{acct.settled_slips}</div>
                  </div>
                </div>

                {isAddCoins ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="number"
                      value={addCoinsAmt}
                      onChange={e => setAddCoinsAmt(e.target.value)}
                      placeholder="Amount to add"
                      min={1}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13 }}
                      autoFocus
                    />
                    <button
                      onClick={() => patchAccount(acct.id, { addCoins: parseFloat(addCoinsAmt) })}
                      disabled={patching || !addCoinsAmt}
                      style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: GOLD, color: NAVY, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                    >
                      {patching ? <Loader2 size={14} /> : "Add"}
                    </button>
                    <button onClick={() => { setAddCoinsId(null); setAddCoinsAmt(""); }} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#f1f5f9", color: MUTED, cursor: "pointer" }}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddCoinsId(acct.id)}
                    style={{
                      width: "100%", padding: "9px", borderRadius: 9, border: `1px solid ${GOLD}`,
                      background: "rgba(212,168,67,0.08)", color: GOLD, fontWeight: 700, fontSize: 13, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    }}
                  >
                    <PlusCircle size={14} /> Add Coins
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 — INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

function ROIBar({ label, value }: { label: string; value: number }) {
  const pos = value >= 0;
  const pct = Math.min(Math.abs(value), 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: FG, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: pos ? "#16a34a" : RED }}>
          {pos ? "+" : ""}{value.toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pos ? "#16a34a" : RED, borderRadius: 4, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function BankrollSVG({ curve }: { curve: { ts: string; balance: number; type: string }[] }) {
  if (!curve || curve.length < 2) {
    return <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 12 }}>Not enough data</div>;
  }

  const W = 320;
  const H = 110;
  const PAD_L = 50;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 20;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const balances = curve.map(p => p.balance);
  const minB = Math.min(...balances);
  const maxB = Math.max(...balances);
  const range = maxB - minB || 1;

  function px(i: number): number {
    return PAD_L + (i / (curve.length - 1)) * plotW;
  }
  function py(b: number): number {
    return PAD_T + plotH - ((b - minB) / range) * plotH;
  }

  const points = curve.map((p, i) => `${px(i)},${py(p.balance)}`).join(" ");
  const areaPoints = `${PAD_L},${PAD_T + plotH} ${points} ${px(curve.length - 1)},${PAD_T + plotH}`;

  const startBal = curve[0].balance;
  const endBal = curve[curve.length - 1].balance;
  const lineColor = endBal >= startBal ? "#16a34a" : RED;

  const gridVals = [minB, minB + range / 2, maxB];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <defs>
        <linearGradient id="bankroll-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={py(v)} x2={W - PAD_R} y2={py(v)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
          <text x={PAD_L - 4} y={py(v) + 4} textAnchor="end" fontSize="9" fill={MUTED}>
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
          </text>
        </g>
      ))}
      <polygon points={areaPoints} fill="url(#bankroll-grad)" />
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={px(0)} cy={py(startBal)} r="3" fill={lineColor} />
      <circle cx={px(curve.length - 1)} cy={py(endBal)} r="4" fill={lineColor} stroke="#fff" strokeWidth="1.5" />
      <text x={Math.min(px(curve.length - 1) + 4, W - 4)} y={py(endBal) - 5} fontSize="10" fontWeight="700" fill={lineColor}>
        {fmtCoins(Math.round(endBal))}
      </text>
      <text x={PAD_L} y={H - 3} fontSize="9" fill={MUTED}>{fmtDate(curve[0].ts)}</text>
      <text x={W - PAD_R} y={H - 3} fontSize="9" fill={MUTED} textAnchor="end">{fmtDate(curve[curve.length - 1].ts)}</text>
    </svg>
  );
}

function InsightsTab({
  token, accounts, selectedAccountId, setSelectedAccountId, showToast,
}: {
  token: string;
  accounts: Account[];
  selectedAccountId: number | null;
  setSelectedAccountId: (id: number) => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [grading, setGrading] = useState(false);

  const { data, isLoading, error } = useQuery<InsightsData>({
    queryKey: ["book-insights", selectedAccountId],
    queryFn: async () => {
      if (!selectedAccountId) throw new Error("No account");
      const r = await fetch(`/api/book/insights?accountId=${selectedAccountId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!selectedAccountId,
  });

  async function gradeNow() {
    setGrading(true);
    try {
      const r = await fetch("/api/book/grade-now", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
      showToast("Grader triggered — check back shortly!");
    } catch (e: any) {
      showToast(e.message ?? "Failed to trigger grader", "error");
    } finally {
      setGrading(false);
    }
  }

  return (
    <div style={{ padding: "12px 12px 0" }}>
      {accounts.length > 0 && (
        <select
          value={selectedAccountId ?? ""}
          onChange={e => setSelectedAccountId(Number(e.target.value))}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: CARD_BG, color: FG, fontWeight: 600, marginBottom: 12 }}
        >
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton h={120} r={12} />
          <Skeleton h={80} r={12} />
          <Skeleton h={80} r={12} />
        </div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: RED, fontSize: 13 }}>
          <AlertCircle size={20} style={{ marginBottom: 6 }} />
          <div>Failed to load insights</div>
        </div>
      ) : !data ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: CARD_BG, borderRadius: 14, padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: FG, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart2 size={15} color={GOLD} /> Bankroll Curve
            </div>
            <BankrollSVG curve={data.bankrollCurve} />
          </div>

          {Object.keys(data.roiByType ?? {}).length > 0 && (
            <div style={{ background: CARD_BG, borderRadius: 14, padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: FG, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={15} color={GOLD} /> ROI by Bet Type
              </div>
              {Object.entries(data.roiByType).map(([k, v]) => (
                <ROIBar key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={v} />
              ))}
            </div>
          )}

          {Object.keys(data.roiBySport ?? {}).length > 0 && (
            <div style={{ background: CARD_BG, borderRadius: 14, padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: FG, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Trophy size={15} color={GOLD} /> ROI by Sport
              </div>
              {Object.entries(data.roiBySport).map(([k, v]) => (
                <ROIBar key={k} label={k.toUpperCase()} value={v} />
              ))}
            </div>
          )}

          {Object.keys(data.roiByStatType ?? {}).length > 0 && (
            <div style={{ background: CARD_BG, borderRadius: 14, padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: FG, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <BarChart2 size={15} color={GOLD} /> ROI by Prop Type
              </div>
              {Object.entries(data.roiByStatType).map(([k, v]) => (
                <ROIBar key={k} label={k} value={v} />
              ))}
            </div>
          )}

          {data.tips && data.tips.length > 0 && (
            <div style={{ background: CARD_BG, borderRadius: 14, padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: FG, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Lightbulb size={15} color={GOLD} /> Insights & Tips
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.tips.map((tip, i) => (
                  <div key={i} style={{ border: `1.5px solid rgba(212,168,67,0.35)`, borderRadius: 10, padding: "10px 12px", background: "rgba(212,168,67,0.05)" }}>
                    <div style={{ fontSize: 12, color: FG, lineHeight: 1.5 }}>{tip}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: CARD_BG, borderRadius: 14, padding: "14px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: FG, marginBottom: 6 }}>Manual Grader</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>Trigger the bet grader to check and settle any completed bets.</div>
            <button
              onClick={gradeNow}
              disabled={grading}
              className="book-btn-gold"
              style={{
                width: "100%", padding: "10px", borderRadius: 9, border: "none",
                background: grading ? "#e2e8f0" : GOLD,
                color: grading ? MUTED : NAVY,
                fontWeight: 700, fontSize: 13, cursor: grading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {grading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />}
              Grade Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
