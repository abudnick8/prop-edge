import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Link } from "wouter";
import { useState } from "react";
import {
  Trophy, Target, Flame, TrendingUp, Activity, Brain,
  ChevronRight, Zap, Star, Clock, CheckCircle, XCircle,
  BarChart2, Layers, Radio, DollarSign, Eye, ArrowUp,
  ArrowDown, Minus, Calendar, Shield, Percent, Users, SlidersHorizontal,
  Plus, X, Search, Heart,
} from "lucide-react";
import PreferencesDrawer from "@/components/PreferencesDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  total: number; highConf: number; avgScore: number;
  threshold: number; bySport: Record<string, number>; bySource: Record<string, number>;
}
interface BtsPick {
  name: string; team: string; hitProbability: number;
  lockedAt?: string; result?: "hit" | "miss" | "pending"; snapshot?: any;
}
interface BtsHistory {
  streak?: number; totalHits?: number; totalPicks?: number; winRate?: number;
  recent?: Array<{ date: string; result: "hit" | "miss" | "push" }>;
}
interface Bet {
  id?: string; title: string; sport: string; betType: string; confidenceScore: number;
  playerName?: string; homeTeam?: string; awayTeam?: string; gameTime?: string;
  description?: string; source?: string; statType?: string; line?: number;
  overOdds?: number; underOdds?: number; recommendation?: string;
}
interface PropItem {
  playerName: string; team: string; sport: string; statType: string; line: number;
  overOdds?: number; underOdds?: number; recommendation: "OVER" | "UNDER";
  edgeScore?: number; gameTime?: string; matchup?: string;
}
interface LineMove {
  homeTeam: string; awayTeam: string; sport: string; trigger: string;
  gameTime?: string; moveSize?: number; direction?: "up" | "down";
}
interface MlInsights {
  overall: { total_graded: number; win_rate: number; avg_score: number };
  by_sport: Record<string, { wins: number; losses: number; win_rate: number }>;
  by_bet_type?: Record<string, { wins: number; losses: number; win_rate: number }>;
}
interface Market {
  title: string; sport: string; yesPrice: number; noPrice: number;
  volume: number; category?: string; question?: string;
}
interface SharpSignal {
  homeTeam: string; awayTeam: string; sport: string;
  publicPct?: number; sharpPct?: number; side?: string; gameTime?: string;
}
interface Game {
  homeTeam: string; awayTeam: string; homeScore: number; awayScore: number;
  status: string; sport: string; period?: string; gameTime?: string;
}
interface Preferences {
  favoriteSports: string[];
  favoriteTeams: string[];
  favoritePlayers: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SPORT_EMOJI: Record<string, string> = {
  MLB: "⚾", NBA: "🏀", NFL: "🏈", NHL: "🏒", Soccer: "⚽", MLS: "⚽", NCAAF: "🏈", NCAAB: "🏀",
};
const se = (s: string) => SPORT_EMOJI[s?.toUpperCase()] ?? "🏅";

const fmtVol = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}K` : `$${v}`;

const scoreColor  = (n: number) => n >= 85 ? "#22c55e" : n >= 70 ? "#D4A843" : "#94a3b8";
const scoreBg     = (n: number) => n >= 85 ? "rgba(34,197,94,0.12)" : n >= 70 ? "rgba(212,168,67,0.12)" : "rgba(148,163,184,0.10)";

const fmtDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

const fmtTime = (s?: string) => {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

const fmtOdds = (n?: number) => {
  if (!n) return "";
  return n > 0 ? `+${n}` : `${n}`;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, linkTo, linkLabel = "View All →", badge }: {
  icon: React.ReactNode; label: string; linkTo: string; linkLabel?: string; badge?: string | number;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {icon}
        <span style={{ fontWeight: 700, fontSize: 13, color: "#131A24" }}>{label}</span>
        {badge !== undefined && (
          <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(19,35,58,0.08)", color: "#64748b", borderRadius: 20, padding: "1px 7px" }}>
            {badge}
          </span>
        )}
      </div>
      <Link href={linkTo}>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
          {linkLabel}
        </span>
      </Link>
    </div>
  );
}

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: "#fff", borderRadius: 18, padding: "14px 14px", border: "1px solid rgba(19,35,58,0.07)", ...style }}>
    {children}
  </div>
);

const Pill = ({ label, color, bg }: { label: string; color: string; bg: string }) => (
  <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, borderRadius: 20, padding: "2px 8px", letterSpacing: 0.3, textTransform: "uppercase" as const }}>
    {label}
  </span>
);

const EmptyState = ({ text }: { text: string }) => (
  <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "10px 0" }}>{text}</p>
);

const Skel = () => (
  <div style={{ height: 13, background: "rgba(19,35,58,0.06)", borderRadius: 6, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
);

function ProLock({ section }: { section: string }) {
  return (
    <div style={{
      position: "absolute", inset: 0, backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)",
      background: "rgba(246,241,231,0.75)", borderRadius: 18,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, zIndex: 10,
    }}>
      <Star size={18} style={{ color: "#D4A843" }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: "#13233A" }}>Pro Feature</span>
      <span style={{ fontSize: 11, color: "#64748b", textAlign: "center", maxWidth: 160 }}>{section} requires Pro.</span>
      <Link href="/pricing">
        <span style={{ fontSize: 11, background: "#D4A843", color: "#131A24", padding: "4px 12px", borderRadius: 20, fontWeight: 700, cursor: "pointer", marginTop: 4, display: "block" }}>
          Upgrade →
        </span>
      </Link>
    </div>
  );
}

// ─── Inline Favorites Picker ──────────────────────────────────────────────────

const SPORT_OPTIONS = ["NFL", "NBA", "MLB", "NHL"];
const POPULAR_TEAMS: Record<string, string[]> = {
  NFL: ["Chiefs", "Cowboys", "Eagles", "Ravens", "49ers", "Bills", "Lions", "Packers"],
  NBA: ["Lakers", "Celtics", "Warriors", "Nuggets", "Heat", "Bucks", "Suns", "Thunder"],
  MLB: ["Yankees", "Dodgers", "Cubs", "Red Sox", "Braves", "Mets", "Cardinals", "Astros"],
  NHL: ["Rangers", "Bruins", "Avalanche", "Oilers", "Maple Leafs", "Hurricanes", "Panthers", "Knights"],
};

function InlineFavoritesSetup({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"sports" | "teams" | "players">("sports");
  const [selSports, setSelSports] = useState<string[]>([]);
  const [selTeams, setSelTeams] = useState<string[]>([]);
  const [playerInput, setPlayerInput] = useState("");
  const [players, setPlayers] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: async (prefs: Preferences) => {
      const r = await apiRequest("PATCH", "/api/me/preferences", prefs);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/me/preferences"] });
      onDone();
    },
  });

  const toggleSport = (s: string) =>
    setSelSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const toggleTeam = (t: string) =>
    setSelTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const addPlayer = () => {
    const p = playerInput.trim();
    if (p && !players.includes(p)) {
      setPlayers(prev => [...prev, p]);
      setPlayerInput("");
    }
  };

  const save = () => {
    mutation.mutate({ favoriteSports: selSports, favoriteTeams: selTeams, favoritePlayers: players });
  };

  const teamOptions = selSports.length > 0
    ? selSports.flatMap(s => POPULAR_TEAMS[s] ?? [])
    : Object.values(POPULAR_TEAMS).flat();

  return (
    <div style={{ background: "linear-gradient(135deg, #13233A 0%, #1a3050 100%)", borderRadius: 20, padding: "18px 16px", margin: "12px 16px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(212,168,67,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Heart size={18} style={{ color: "#D4A843", fill: "#D4A843" }} />
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 900, color: "#F6F1E7", margin: 0 }}>Set Your Favorites</p>
          <p style={{ fontSize: 11, color: "rgba(246,241,231,0.5)", margin: 0 }}>Personalize your daily feed</p>
        </div>
      </div>

      {/* Step pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["sports", "teams", "players"] as const).map((s, i) => (
          <button key={s} onClick={() => setStep(s)} style={{
            flex: 1, padding: "6px 4px", borderRadius: 10, border: "none", cursor: "pointer",
            background: step === s ? "rgba(212,168,67,0.25)" : "rgba(255,255,255,0.06)",
            color: step === s ? "#D4A843" : "rgba(246,241,231,0.4)",
            fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.5,
          }}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {/* Step: Sports */}
      {step === "sports" && (
        <div>
          <p style={{ fontSize: 11, color: "rgba(246,241,231,0.55)", marginBottom: 10 }}>Pick your sports:</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {SPORT_OPTIONS.map(s => (
              <button key={s} onClick={() => toggleSport(s)} style={{
                padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${selSports.includes(s) ? "#D4A843" : "rgba(246,241,231,0.18)"}`,
                background: selSports.includes(s) ? "rgba(212,168,67,0.2)" : "rgba(255,255,255,0.05)",
                color: selSports.includes(s) ? "#D4A843" : "rgba(246,241,231,0.65)", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>
                {se(s)} {s}
              </button>
            ))}
          </div>
          <button onClick={() => setStep("teams")} style={{
            width: "100%", padding: "10px", borderRadius: 12, border: "none",
            background: selSports.length > 0 ? "#D4A843" : "rgba(255,255,255,0.08)",
            color: selSports.length > 0 ? "#131A24" : "rgba(246,241,231,0.35)",
            fontSize: 12, fontWeight: 800, cursor: selSports.length > 0 ? "pointer" : "default",
          }}>
            {selSports.length > 0 ? `Next: Teams →` : "Select a sport to continue"}
          </button>
        </div>
      )}

      {/* Step: Teams */}
      {step === "teams" && (
        <div>
          <p style={{ fontSize: 11, color: "rgba(246,241,231,0.55)", marginBottom: 10 }}>Pick your teams (optional):</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14, maxHeight: 120, overflowY: "auto" }}>
            {teamOptions.map(t => (
              <button key={t} onClick={() => toggleTeam(t)} style={{
                padding: "5px 11px", borderRadius: 16, border: `1.5px solid ${selTeams.includes(t) ? "#D4A843" : "rgba(246,241,231,0.15)"}`,
                background: selTeams.includes(t) ? "rgba(212,168,67,0.2)" : "rgba(255,255,255,0.04)",
                color: selTeams.includes(t) ? "#D4A843" : "rgba(246,241,231,0.6)", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep("sports")} style={{ flex: "0 0 auto", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(246,241,231,0.18)", background: "transparent", color: "rgba(246,241,231,0.6)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>← Back</button>
            <button onClick={() => setStep("players")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: "none", background: "#D4A843", color: "#131A24", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Next: Players →</button>
          </div>
        </div>
      )}

      {/* Step: Players */}
      {step === "players" && (
        <div>
          <p style={{ fontSize: 11, color: "rgba(246,241,231,0.55)", marginBottom: 10 }}>Add favorite players (optional):</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={playerInput}
              onChange={e => setPlayerInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPlayer()}
              placeholder="Player name..."
              style={{
                flex: 1, padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(246,241,231,0.2)",
                background: "rgba(255,255,255,0.07)", color: "#F6F1E7", fontSize: 12, outline: "none",
              }}
            />
            <button onClick={addPlayer} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: "rgba(212,168,67,0.2)", color: "#D4A843", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Plus size={14} />
            </button>
          </div>
          {players.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {players.map(p => (
                <div key={p} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(212,168,67,0.15)", border: "1px solid rgba(212,168,67,0.3)", borderRadius: 16, padding: "4px 10px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#D4A843" }}>{p}</span>
                  <button onClick={() => setPlayers(prev => prev.filter(x => x !== p))} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(246,241,231,0.4)", padding: 0, display: "flex" }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep("teams")} style={{ flex: "0 0 auto", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(246,241,231,0.18)", background: "transparent", color: "rgba(246,241,231,0.6)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>← Back</button>
            <button onClick={save} disabled={mutation.isPending} style={{ flex: 1, padding: "10px", borderRadius: 12, border: "none", background: "#D4A843", color: "#131A24", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
              {mutation.isPending ? "Saving..." : "Save Favorites ✓"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Favorites Panel (when prefs exist) ──────────────────────────────────────

function FavoritesPanel({
  prefs, favBets, favProps, favBts, favTotal, onEdit,
}: {
  prefs: Preferences;
  favBets: Bet[];
  favProps: PropItem[];
  favBts: BtsPick[];
  favTotal: number;
  onEdit: () => void;
}) {
  const { favoriteSports: favSports, favoriteTeams: favTeams, favoritePlayers: favPlayers } = prefs;

  return (
    <div style={{ margin: "12px 16px 0" }}>
      <div style={{ background: "linear-gradient(135deg, #13233A 0%, #1e3a5f 100%)", borderRadius: 20, padding: "16px 14px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(212,168,67,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Star size={15} style={{ color: "#D4A843", fill: "#D4A843" }} />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 900, color: "#F6F1E7", margin: 0 }}>Your Favorites</p>
              <p style={{ fontSize: 10, color: "rgba(246,241,231,0.45)", margin: 0 }}>
                {[
                  favSports.length > 0 ? favSports.join(", ") : null,
                  favTeams.length > 0 ? `${favTeams.length} team${favTeams.length > 1 ? "s" : ""}` : null,
                  favPlayers.length > 0 ? `${favPlayers.length} player${favPlayers.length > 1 ? "s" : ""}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <button onClick={onEdit} style={{
            background: "rgba(246,241,231,0.09)", border: "1px solid rgba(246,241,231,0.16)",
            borderRadius: 10, padding: "5px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
          }}>
            <SlidersHorizontal size={11} style={{ color: "rgba(246,241,231,0.7)" }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.7)" }}>Edit</span>
          </button>
        </div>

        {/* Matching Bets */}
        {favBets.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 }}>Top Picks</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {favBets.map((bet, i) => (
                <div key={i} style={{ background: "rgba(246,241,231,0.07)", borderRadius: 12, padding: "9px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 16 }}>{se(bet.sport)}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#F6F1E7", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 155 }}>
                        {bet.playerName || bet.title}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(246,241,231,0.45)", background: "rgba(246,241,231,0.07)", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" }}>
                          {bet.betType?.replace(/_/g, " ") ?? bet.sport}
                        </span>
                        {bet.statType && <span style={{ fontSize: 9, fontWeight: 700, color: "#D4A843" }}>{bet.statType}</span>}
                        {bet.gameTime && <span style={{ fontSize: 9, color: "rgba(246,241,231,0.3)" }}>{fmtTime(bet.gameTime)}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: bet.confidenceScore >= 85 ? "#22c55e" : bet.confidenceScore >= 70 ? "#D4A843" : "#94a3b8" }}>
                      {bet.confidenceScore}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(246,241,231,0.35)", fontWeight: 600 }}>/ 100</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Matching Props */}
        {favProps.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 }}>Player Props</p>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", scrollbarWidth: "none" }}>
              {favProps.map((prop, i) => (
                <div key={i} style={{ flex: "0 0 auto", background: "rgba(246,241,231,0.07)", borderRadius: 12, padding: "9px 11px", minWidth: 120 }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: "#F6F1E7", margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{prop.playerName}</p>
                  <p style={{ fontSize: 10, color: "rgba(246,241,231,0.45)", margin: "0 0 5px" }}>{prop.team} · {se(prop.sport)}</p>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: prop.recommendation === "OVER" ? "#22c55e" : "#ef4444",
                    background: prop.recommendation === "OVER" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                    borderRadius: 7, padding: "2px 7px",
                  }}>
                    {prop.recommendation} {prop.line} {prop.statType}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BTS Matching */}
        {favBts.length > 0 && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(246,241,231,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 }}>BTS Picks</p>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", scrollbarWidth: "none" }}>
              {favBts.map((pick, i) => (
                <div key={i} style={{ flex: "0 0 auto", background: "rgba(246,241,231,0.07)", borderRadius: 12, padding: "9px 11px", minWidth: 110 }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: "#F6F1E7", margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{pick.name}</p>
                  <p style={{ fontSize: 10, color: "rgba(246,241,231,0.45)", margin: "0 0 4px" }}>{pick.team}</p>
                  <span style={{ fontSize: 13, fontWeight: 900, color: "#D4A843" }}>{Math.round(pick.hitProbability)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {favTotal === 0 && (
          <div style={{ textAlign: "center", padding: "14px 0" }}>
            <p style={{ fontSize: 12, color: "rgba(246,241,231,0.4)", margin: 0 }}>No picks match your favorites yet — check back when games are scheduled.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isPro, isOwner, isBasic } = useAuth();
  const canSeePro = isPro || isOwner;
  const canSeeBasic = isBasic || isPro || isOwner;
  const [prefOpen, setPrefOpen] = useState(false);
  const [showInlineSetup, setShowInlineSetup] = useState(false);

  // ── Fetches ──────────────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsL } = useQuery<Stats>({
    queryKey: ["/api/stats"], queryFn: () => apiRequest("GET", "/api/stats").then(r => r.json()), refetchInterval: 30000,
  });
  const { data: btsData, isLoading: btsL } = useQuery<{ picks: BtsPick[] }>({
    queryKey: ["/api/bts-picks"], queryFn: () => apiRequest("GET", "/api/bts-picks").then(r => r.json()), refetchInterval: 60000,
  });
  const { data: btsHistory } = useQuery<BtsHistory>({
    queryKey: ["/api/bts-history"], queryFn: () => apiRequest("GET", "/api/bts-history").then(r => r.json()), refetchInterval: 60000,
  });
  const { data: topPlays, isLoading: playsL } = useQuery<Bet[]>({
    queryKey: ["/api/bets/high-confidence"], queryFn: () => apiRequest("GET", "/api/bets/high-confidence").then(r => r.json()), refetchInterval: 30000,
  });
  const { data: allBets, isLoading: betsL } = useQuery<Bet[]>({
    queryKey: ["/api/bets"], queryFn: () => apiRequest("GET", "/api/bets").then(r => r.json()), refetchInterval: 30000,
  });
  const { data: propsData, isLoading: propsL } = useQuery<{ props: PropItem[] }>({
    queryKey: ["/api/linemate-props"], queryFn: () => apiRequest("GET", "/api/linemate-props").then(r => r.json()), refetchInterval: 30000,
  });
  const { data: lineMoves, isLoading: lineL } = useQuery<LineMove[]>({
    queryKey: ["/api/line-movement"], queryFn: () => apiRequest("GET", "/api/line-movement").then(r => r.json()), refetchInterval: 30000,
  });
  const { data: mlInsights, isLoading: mlL } = useQuery<MlInsights>({
    queryKey: ["/api/ml-insights"], queryFn: () => apiRequest("GET", "/api/ml-insights").then(r => r.json()), refetchInterval: 60000,
  });
  const { data: markets, isLoading: marketsL } = useQuery<Market[]>({
    queryKey: ["/api/prediction-markets"], queryFn: () => apiRequest("GET", "/api/prediction-markets").then(r => r.json()), refetchInterval: 30000,
  });
  const { data: sharpData } = useQuery<SharpSignal[]>({
    queryKey: ["/api/sharp-money"], queryFn: () => apiRequest("GET", "/api/sharp-money").then(r => r.json()), refetchInterval: 60000,
  });
  const { data: liveData } = useQuery<any>({
    queryKey: ["/api/live-scores"], queryFn: () => apiRequest("GET", "/api/live-scores").then(r => r.json()), refetchInterval: 20000,
  });
  const { data: preferences } = useQuery<Preferences>({
    queryKey: ["/api/me/preferences"], queryFn: () => apiRequest("GET", "/api/me/preferences").then(r => r.json()), staleTime: 60000,
  });

  // ── Derived ──────────────────────────────────────────────────────────────────
  const sportsActive = stats ? Object.keys(stats.bySport).filter(k => stats.bySport[k] > 0) : [];

  function normGame(g: any) {
    const home = Array.isArray(g.teams) ? g.teams.find((t: any) => t.homeAway === "home") : null;
    const away = Array.isArray(g.teams) ? g.teams.find((t: any) => t.homeAway === "away") : null;
    return {
      sport: g.sport ?? "",
      homeTeam: home?.shortName ?? g.homeTeam ?? "",
      awayTeam: away?.shortName ?? g.awayTeam ?? "",
      homeScore: Number(home?.score ?? g.homeScore ?? 0),
      awayScore: Number(away?.score ?? g.awayScore ?? 0),
      status: g.status?.state === "in" ? "in_progress" : g.status?.completed ? "final" : "scheduled",
      period: g.status?.period ? `Q${g.status.period}` : g.period ?? "",
      gameTime: g.date ?? g.gameTime,
    };
  }

  const btsPicks = Array.isArray(btsData?.picks) ? btsData!.picks : [];
  const topBts   = btsPicks.slice(0, 5);
  const allProps  = Array.isArray((propsData as any)?.markets) ? (propsData as any).markets : (Array.isArray((propsData as any)?.props) ? (propsData as any).props : []);
  const topProps  = allProps.slice(0, 6);
  const topPlaysList = (Array.isArray(topPlays) ? topPlays : []).slice(0, 6);
  const rawLineMoves = Array.isArray(lineMoves) ? lineMoves : [];
  const topLineMoves = rawLineMoves.slice(0, 4).map((m: any) => {
    // Real shape: {spread:{open,current,move}, total:{open,current,move}, moneyline:{...}}
    const spreadMove = m.spread?.move ?? 0;
    const totalMove  = m.total?.move  ?? 0;
    const mlAway     = m.moneyline?.awayCurrent;
    const mlHome     = m.moneyline?.homeCurrent;
    const biggestMove = Math.abs(spreadMove) >= Math.abs(totalMove) ? spreadMove : totalMove;
    const trigger = m.trigger
      ? m.trigger
      : Math.abs(spreadMove) > 0
        ? `Spread moved ${spreadMove > 0 ? '+' : ''}${spreadMove}`
        : Math.abs(totalMove) > 0
          ? `Total moved ${totalMove > 0 ? '+' : ''}${totalMove}`
          : mlAway != null
            ? `ML: Away ${mlAway > 0 ? '+' : ''}${mlAway} / Home ${mlHome}`
            : 'Line movement detected';
    const direction = m.direction
      ? m.direction
      : biggestMove > 0 ? 'up' : biggestMove < 0 ? 'down' : undefined;
    return { ...m, trigger, direction };
  });
  const topMarkets = (Array.isArray(markets) ? markets : []).slice(0, 4).map((m: any) => ({
    ...m,
    volume: typeof m.volume === 'number' ? m.volume : typeof m.vol24h === 'number' ? m.vol24h : 0,
  }));

  const sharpSignalsRaw = Array.isArray(sharpData) ? sharpData : (sharpData as any)?.games ?? [];
  const sharpSignals = sharpSignalsRaw.slice(0, 3).map((g: any) => {
    // publicBetPct is an object {home, away, over, under} — extract a usable number
    const rawPublic = g.publicBetPct ?? g.publicPct;
    const publicPct = typeof rawPublic === 'number'
      ? rawPublic
      : typeof rawPublic === 'object' && rawPublic !== null
        ? (rawPublic.away ?? rawPublic.home ?? rawPublic.over ?? rawPublic.under ?? null)
        : null;
    const sharpPct = typeof g.sharpScore === 'number' ? g.sharpScore
      : typeof g.sharpPct === 'number' ? g.sharpPct : null;
    return {
      homeTeam: g.homeTeam, awayTeam: g.awayTeam, sport: g.sport,
      publicPct, sharpPct,
      side: g.sharpDirection ?? g.sharpSide ?? g.side ?? null,
      gameTime: g.startTime ?? g.gameTime,
    };
  });

  const liveGamesArr: Game[] = (() => {
    const raw = liveData as any;
    if (!raw) return [];
    if (Array.isArray(raw.games)) return raw.games;
    if (raw.sports && typeof raw.sports === "object") return Object.values(raw.sports).flat() as Game[];
    return [];
  })();
  const liveGamesNorm = liveGamesArr.map(normGame);
  const liveGames   = liveGamesNorm.filter(g => g.status === "in_progress");
  const todayGames  = liveGamesNorm.filter(g => g.status !== "final");

  const allBetsSafe = Array.isArray(allBets) ? allBets : [];
  const teamBets = allBetsSafe.filter(b => b.betType !== "player_prop" && b.betType !== "season_prop" && b.betType !== "futures" && b.gameTime);
  const topTeamBets = teamBets.sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0)).slice(0, 4);
  const playerProps = allBetsSafe.filter(b => b.betType === "player_prop").sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));
  const topPlayerProps = playerProps.slice(0, 6);

  const topMlSports = mlInsights?.by_sport
    ? Object.entries(mlInsights.by_sport).sort((a, b) => b[1].win_rate - a[1].win_rate).slice(0, 4)
    : [];
  const mlBetTypeBreakdown = mlInsights?.by_bet_type
    ? Object.entries(mlInsights.by_bet_type).sort((a, b) => b[1].win_rate - a[1].win_rate).slice(0, 3)
    : [];

  // ── Personalization ───────────────────────────────────────────────────────────
  const favSports  = preferences?.favoriteSports  ?? [];
  const favTeams   = preferences?.favoriteTeams   ?? [];
  const favPlayers = preferences?.favoritePlayers ?? [];
  const hasPrefs = favSports.length > 0 || favTeams.length > 0 || favPlayers.length > 0;

  const matchesFav = (bet: Bet | PropItem) => {
    if (!hasPrefs) return false;
    const sport = bet.sport?.toUpperCase();
    const team  = ("homeTeam" in bet ? `${bet.homeTeam} ${bet.awayTeam}` : ("team" in bet ? (bet as PropItem).team : ""))?.toLowerCase() ?? "";
    const player = ("playerName" in bet ? bet.playerName : "")?.toLowerCase() ?? "";
    if (favSports.length > 0 && favSports.map(s => s.toUpperCase()).includes(sport)) return true;
    if (favTeams.length > 0 && favTeams.some(t => team.includes(t.toLowerCase()))) return true;
    if (favPlayers.length > 0 && favPlayers.some(p => player.includes(p.toLowerCase()))) return true;
    return false;
  };
  const matchesBtsFav = (pick: BtsPick) => {
    if (!hasPrefs) return false;
    const team   = pick.team?.toLowerCase() ?? "";
    const player = pick.name?.toLowerCase() ?? "";
    if (favTeams.length > 0 && favTeams.some(t => team.includes(t.toLowerCase()))) return true;
    if (favPlayers.length > 0 && favPlayers.some(p => player.includes(p.toLowerCase()))) return true;
    return false;
  };

  const favBets  = [...allBetsSafe].filter(matchesFav).sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 6);
  const favProps = [...allProps].filter(matchesFav).sort((a: PropItem, b: PropItem) => (b.edgeScore ?? 0) - (a.edgeScore ?? 0)).slice(0, 4);
  const favBts   = btsPicks.filter(matchesBtsFav).slice(0, 3);
  const favTotal = favBets.length + favProps.length + favBts.length;

  // When favorites exist, sort sections to show matching items first
  const sortedTopPlays = [...topPlaysList].sort((a, b) => {
    const aFav = matchesFav(a) ? 1 : 0;
    const bFav = matchesFav(b) ? 1 : 0;
    return bFav - aFav || (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });
  const sortedTeamBets = [...topTeamBets].sort((a, b) => {
    const aFav = matchesFav(a) ? 1 : 0;
    const bFav = matchesFav(b) ? 1 : 0;
    return bFav - aFav || (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });
  const sortedPlayerProps = [...topPlayerProps].sort((a, b) => {
    const aFav = matchesFav(a) ? 1 : 0;
    const bFav = matchesFav(b) ? 1 : 0;
    return bFav - aFav || (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });
  const sortedBtsPicks = [...topBts].sort((a, b) => {
    const aFav = matchesBtsFav(a) ? 1 : 0;
    const bFav = matchesBtsFav(b) ? 1 : 0;
    return bFav - aFav || b.hitProbability - a.hitProbability;
  });

  // ── BTS History ──────────────────────────────────────────────────────────────
  const btsHistoryRaw = btsHistory as any;
  const btsSeasonRec  = btsHistoryRaw?.seasonRecord ?? {};
  const btsTotalHits  = btsSeasonRec.wins ?? 0;
  const btsTotalPicks = (btsSeasonRec.wins ?? 0) + (btsSeasonRec.losses ?? 0);
  const btsWinRate    = btsSeasonRec.winPct ?? 0;
  const btsStreak     = btsHistoryRaw?.yesterdayRecord?.wins ?? 0;
  const btsRecentDays = Array.isArray(btsHistoryRaw?.days) ? btsHistoryRaw.days.slice(-7) : [];
  const btsRecent     = btsRecentDays.map((d: any) => ({
    date: d.date,
    result: d.winPct >= 50 ? "hit" : "miss" as "hit" | "miss" | "push",
  }));

  // ── Stat cards ───────────────────────────────────────────────────────────────
  const statCards = [
    { label: "Total Picks", value: statsL ? "—" : String(stats?.total ?? 0), icon: <Layers size={15} style={{ color: "#3b82f6" }} />, color: "#3b82f6", bg: "rgba(59,130,246,0.09)" },
    { label: "High Conf",   value: statsL ? "—" : String(stats?.highConf ?? 0), icon: <Zap size={15} style={{ color: "#D4A843" }} />, color: "#D4A843", bg: "rgba(212,168,67,0.10)" },
    { label: "Avg Score",   value: statsL ? "—" : `${(stats?.avgScore ?? 0).toFixed(1)}`, icon: <BarChart2 size={15} style={{ color: "#22c55e" }} />, color: "#22c55e", bg: "rgba(34,197,94,0.09)" },
    { label: "Sports",      value: statsL ? "—" : String(sportsActive.length), icon: <Activity size={15} style={{ color: "#a855f7" }} />, color: "#a855f7", bg: "rgba(168,85,247,0.09)" },
    { label: "Props",       value: statsL ? "—" : String(playerProps.length), icon: <Target size={15} style={{ color: "#ef4444" }} />, color: "#ef4444", bg: "rgba(239,68,68,0.09)" },
    { label: "Team Bets",   value: betsL ? "—" : String(teamBets.length), icon: <Shield size={15} style={{ color: "#06b6d4" }} />, color: "#06b6d4", bg: "rgba(6,182,212,0.09)" },
  ];

  return (
    <div style={{ background: "#F6F1E7", minHeight: "100vh", paddingBottom: 80, maxWidth: 520, margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#131A24", overflowX: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
        @keyframes dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }
        input::placeholder { color: rgba(246,241,231,0.3); }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Preferences Drawer */}
      <PreferencesDrawer open={prefOpen} onClose={() => setPrefOpen(false)} />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ padding: "22px 16px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginBottom: 1 }}>{fmtDate()}</p>
            <h1 style={{ fontSize: 23, fontWeight: 900, color: "#131A24", lineHeight: 1.15, margin: "0 0 3px" }}>Clubhouse IQ</h1>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Your daily edge across all markets</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Favorites button */}
              <button
                onClick={() => hasPrefs ? setPrefOpen(true) : setShowInlineSetup(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: hasPrefs ? "rgba(212,168,67,0.15)" : "rgba(19,35,58,0.07)",
                  border: hasPrefs ? "1.5px solid rgba(212,168,67,0.45)" : "1px solid rgba(19,35,58,0.14)",
                  borderRadius: 20, padding: "5px 11px", cursor: "pointer",
                }}
              >
                <Star size={12} style={{ color: hasPrefs ? "#D4A843" : "#94a3b8", fill: hasPrefs ? "#D4A843" : "none" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: hasPrefs ? "#D4A843" : "#64748b" }}>
                  {hasPrefs ? "Favorites" : "Set Favorites"}
                </span>
              </button>
              {/* Live dot */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.22)", borderRadius: 20, padding: "5px 10px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "dot 1.4s ease-in-out infinite" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#16a34a" }}>Live</span>
              </div>
            </div>
            {liveGames.length > 0 && (
              <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>{liveGames.length} game{liveGames.length > 1 ? "s" : ""} live</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats Row ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, padding: "14px 16px 0", overflowX: "auto" }}>
        {statCards.map(card => (
          <div key={card.label} style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.07)", borderRadius: 14, padding: "11px 13px", minWidth: 80, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ width: 26, height: 26, background: card.bg, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>{card.icon}</div>
            <span style={{ fontSize: 20, fontWeight: 900, color: "#131A24", lineHeight: 1 }}>{card.value}</span>
            <span style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}>{card.label}</span>
          </div>
        ))}
      </div>

      {/* ── Live Games Banner ─────────────────────────────────────────────── */}
      {liveGames.length > 0 && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "dot 1s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>LIVE NOW</span>
            <Radio size={11} style={{ color: "#ef4444" }} />
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {liveGames.map((g, i) => (
              <Link href="/scores" key={i}>
                <div style={{ flex: "0 0 auto", background: "#fff", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 14, padding: "8px 12px", cursor: "pointer" }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, marginBottom: 3 }}>{se(g.sport)} {g.sport} {g.period ? `· ${g.period}` : ""}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#131A24", whiteSpace: "nowrap" }}>
                    {g.awayTeam} <span style={{ color: "#ef4444" }}>{g.awayScore}</span>
                    <span style={{ color: "#94a3b8", margin: "0 4px" }}>–</span>
                    {g.homeTeam} <span style={{ color: "#ef4444" }}>{g.homeScore}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Inline Favorites Setup (no prefs yet) ─────────────────────────── */}
      {!hasPrefs && showInlineSetup && (
        <InlineFavoritesSetup onDone={() => setShowInlineSetup(false)} />
      )}

      {/* ── CTA banner when no prefs & setup hidden ──────────────────────── */}
      {!hasPrefs && !showInlineSetup && (
        <div style={{ margin: "12px 16px 0" }}>
          <button
            onClick={() => setShowInlineSetup(true)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "linear-gradient(135deg, #13233A 0%, #1e3050 100%)",
              border: "none", borderRadius: 16, padding: "14px 16px", cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, background: "rgba(212,168,67,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Heart size={16} style={{ color: "#D4A843", fill: "#D4A843" }} />
              </div>
              <div style={{ textAlign: "left" }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "#F6F1E7", margin: 0 }}>Personalize Your Feed</p>
                <p style={{ fontSize: 11, color: "rgba(246,241,231,0.5)", margin: 0 }}>Pick teams, players & sports to see first</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#D4A843", borderRadius: 10, padding: "6px 12px" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#131A24" }}>Set Up</span>
              <ChevronRight size={13} style={{ color: "#131A24" }} />
            </div>
          </button>
        </div>
      )}

      {/* ── Favorites Panel (when prefs exist) ───────────────────────────── */}
      {hasPrefs && (
        <FavoritesPanel
          prefs={preferences!}
          favBets={favBets}
          favProps={favProps}
          favBts={favBts}
          favTotal={favTotal}
          onEdit={() => setPrefOpen(true)}
        />
      )}

      {/* ── Main Sections ─────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ── Top Plays Today ───────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Flame size={14} style={{ color: "#ef4444" }} />} label="Top Plays Today" linkTo="/conviction" badge={topPlaysList.length} />
          {playsL ? (<><Skel /><Skel /><Skel /></>) : sortedTopPlays.length === 0 ? (
            <EmptyState text="No high-confidence plays right now" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sortedTopPlays.map((bet, i) => {
                const isFav = hasPrefs && matchesFav(bet);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 10px", borderRadius: 12,
                    background: isFav ? "rgba(212,168,67,0.07)" : "rgba(19,35,58,0.025)",
                    border: isFav ? "1px solid rgba(212,168,67,0.2)" : "1px solid transparent",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 17 }}>{se(bet.sport)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 155 }}>
                            {bet.playerName || bet.title}
                          </p>
                          {isFav && <Star size={9} style={{ color: "#D4A843", fill: "#D4A843", flexShrink: 0 }} />}
                        </div>
                        <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                          <Pill label={bet.betType?.replace(/_/g, " ") ?? "bet"} color="#64748b" bg="rgba(19,35,58,0.06)" />
                          {bet.gameTime && <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtTime(bet.gameTime)}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: scoreBg(bet.confidenceScore), border: `2px solid ${scoreColor(bet.confidenceScore)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: scoreColor(bet.confidenceScore) }}>{bet.confidenceScore?.toFixed(0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Team Bets ─────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Shield size={14} style={{ color: "#06b6d4" }} />} label="Team Bets" linkTo="/bets" badge={topTeamBets.length} />
          {betsL ? (<><Skel /><Skel /></>) : sortedTeamBets.length === 0 ? (
            <EmptyState text="No team bets available" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sortedTeamBets.map((b, i) => {
                const isFav = hasPrefs && matchesFav(b);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 10px", borderRadius: 11,
                    background: isFav ? "rgba(212,168,67,0.07)" : "rgba(6,182,212,0.04)",
                    border: `1px solid ${isFav ? "rgba(212,168,67,0.2)" : "rgba(6,182,212,0.10)"}`,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{b.title}</p>
                        {isFav && <Star size={9} style={{ color: "#D4A843", fill: "#D4A843", flexShrink: 0 }} />}
                      </div>
                      <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
                        <Pill label={b.betType?.replace(/_/g, " ") ?? ""} color="#06b6d4" bg="rgba(6,182,212,0.10)" />
                        <Pill label={b.sport} color="#64748b" bg="rgba(19,35,58,0.06)" />
                        {b.gameTime && <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtTime(b.gameTime)}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 900, color: scoreColor(b.confidenceScore), flexShrink: 0, marginLeft: 8 }}>{b.confidenceScore?.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Player Props ───────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Target size={14} style={{ color: "#22c55e" }} />} label="Player Props" linkTo="/linemate" badge={playerProps.length} />
          {betsL ? (<><Skel /><Skel /><Skel /></>) : sortedPlayerProps.length === 0 ? (
            <EmptyState text="No player props right now" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sortedPlayerProps.map((b, i) => {
                const isFav = hasPrefs && matchesFav(b);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 10px", borderRadius: 11,
                    background: isFav ? "rgba(212,168,67,0.07)" : "rgba(19,35,58,0.025)",
                    border: `1px solid ${isFav ? "rgba(212,168,67,0.2)" : "transparent"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 16 }}>{se(b.sport)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 145 }}>{b.playerName || b.title}</p>
                          {isFav && <Star size={9} style={{ color: "#D4A843", fill: "#D4A843", flexShrink: 0 }} />}
                        </div>
                        <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                          {b.statType && <Pill label={b.statType} color="#22c55e" bg="rgba(34,197,94,0.10)" />}
                          {b.line != null && <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{b.line}</span>}
                          {b.recommendation && (
                            <span style={{ fontSize: 10, fontWeight: 800, color: b.recommendation === "OVER" ? "#22c55e" : "#ef4444" }}>{b.recommendation}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                      {b.overOdds && <span style={{ fontSize: 10, color: "#64748b" }}>{fmtOdds(b.overOdds)}</span>}
                      <span style={{ fontSize: 12, fontWeight: 900, color: scoreColor(b.confidenceScore) }}>{b.confidenceScore?.toFixed(0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Props Hub Deep Dive ───────────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          <Card>
            <SectionHeader icon={<Percent size={14} style={{ color: "#8b5cf6" }} />} label="Props Hub Analysis" linkTo="/linemate" badge={allProps.length} />
            {propsL ? (<><Skel /><Skel /></>) : topProps.length === 0 ? (
              <EmptyState text="No props loaded yet" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {topProps.map((p: PropItem, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "rgba(139,92,246,0.04)", borderRadius: 11, border: "1px solid rgba(139,92,246,0.09)" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 155 }}>{p.playerName}</p>
                      <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                        <Pill label={p.statType} color="#8b5cf6" bg="rgba(139,92,246,0.10)" />
                        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{p.line}</span>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>{p.team}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: p.recommendation === "OVER" ? "#22c55e" : "#ef4444", background: p.recommendation === "OVER" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", padding: "2px 8px", borderRadius: 20 }}>
                        {p.recommendation}
                      </span>
                      {p.edgeScore != null && <span style={{ fontSize: 10, color: "#8b5cf6", fontWeight: 700 }}>Edge {p.edgeScore.toFixed(1)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {!canSeePro && <ProLock section="Props Hub Analysis" />}
        </div>

        {/* ── Beat The Streak ───────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Trophy size={14} style={{ color: "#D4A843" }} />} label="Beat The Streak" linkTo="/bts" linkLabel="View Full →" badge={`${btsPicks.length}/10`} />

          {/* Streak stats */}
          {(btsTotalPicks > 0 || btsStreak > 0) && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[
                { label: "Streak", value: btsStreak > 0 ? `🔥 ${btsStreak}` : `${btsStreak}`, color: btsStreak > 2 ? "#D4A843" : "#131A24" },
                { label: "Win Rate", value: `${Number(btsWinRate).toFixed(0)}%`, color: Number(btsWinRate) >= 60 ? "#22c55e" : "#64748b" },
                { label: "Record", value: `${btsTotalHits}/${btsTotalPicks}`, color: "#131A24" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: "rgba(212,168,67,0.07)", border: "1px solid rgba(212,168,67,0.15)", borderRadius: 10, padding: "7px 8px", textAlign: "center" }}>
                  <p style={{ fontSize: 14, fontWeight: 900, color: s.color, margin: 0 }}>{s.value}</p>
                  <p style={{ fontSize: 10, color: "#94a3b8", margin: "2px 0 0" }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Recent dots */}
          {btsRecent.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginBottom: 10, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginRight: 2 }}>Recent:</span>
              {btsRecent.slice(-7).map((r: any, i: number) => (
                <div key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: r.result === "hit" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)", border: `1.5px solid ${r.result === "hit" ? "#22c55e" : "#ef4444"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {r.result === "hit" ? <CheckCircle size={11} style={{ color: "#22c55e" }} /> : <XCircle size={11} style={{ color: "#ef4444" }} />}
                </div>
              ))}
            </div>
          )}

          {/* Today's picks */}
          {btsL ? (<><Skel /><Skel /></>) : sortedBtsPicks.length === 0 ? (
            <EmptyState text="No picks generated yet today" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sortedBtsPicks.map((pick, i) => {
                const isFav = hasPrefs && matchesBtsFav(pick);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 10px", borderRadius: 12,
                    background: isFav ? "rgba(212,168,67,0.09)" : "rgba(212,168,67,0.06)",
                    border: `1px solid ${isFav ? "rgba(212,168,67,0.28)" : "rgba(212,168,67,0.14)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 16 }}>⚾</span>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0 }}>{pick.name}</p>
                          {isFav && <Star size={9} style={{ color: "#D4A843", fill: "#D4A843" }} />}
                        </div>
                        <p style={{ fontSize: 10, color: "#94a3b8", margin: "1px 0 0" }}>{pick.team}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 13, fontWeight: 900, color: pick.hitProbability >= 70 ? "#22c55e" : pick.hitProbability >= 50 ? "#D4A843" : "#94a3b8", margin: 0 }}>
                          {Math.round(pick.hitProbability)}%
                        </p>
                        <p style={{ fontSize: 9, color: "#94a3b8", margin: 0 }}>hit prob</p>
                      </div>
                      {pick.result === "hit" && <CheckCircle size={15} style={{ color: "#22c55e" }} />}
                      {pick.result === "miss" && <XCircle size={15} style={{ color: "#ef4444" }} />}
                      {(!pick.result || pick.result === "pending") && <Clock size={14} style={{ color: "#94a3b8" }} />}
                    </div>
                  </div>
                );
              })}
              {btsPicks.length > 5 && (
                <Link href="/bts">
                  <p style={{ fontSize: 11, color: "#D4A843", fontWeight: 700, textAlign: "center", margin: "4px 0 0", cursor: "pointer" }}>
                    +{btsPicks.length - 5} more picks →
                  </p>
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* ── Line Movement ─────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<TrendingUp size={14} style={{ color: "#3b82f6" }} />} label="Line Movement" linkTo="/clv" badge={topLineMoves.length} />
          {lineL ? (<><Skel /><Skel /></>) : topLineMoves.length === 0 ? (
            <EmptyState text="No significant line moves detected" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {topLineMoves.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.10)", borderRadius: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>
                      {m.awayTeam} @ {m.homeTeam}
                    </p>
                    <p style={{ fontSize: 10, color: "#64748b", margin: "2px 0 0" }}>{m.trigger}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    {m.direction === "up" ? <ArrowUp size={13} style={{ color: "#22c55e" }} /> : m.direction === "down" ? <ArrowDown size={13} style={{ color: "#ef4444" }} /> : <Minus size={13} style={{ color: "#94a3b8" }} />}
                    <Pill label={m.sport} color="#3b82f6" bg="rgba(59,130,246,0.10)" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Sharp Money ───────────────────────────────────────────────── */}
        {sharpSignals.length > 0 && (
          <Card>
            <SectionHeader icon={<DollarSign size={14} style={{ color: "#22c55e" }} />} label="Sharp Money" linkTo="/clv" linkLabel="View →" />
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sharpSignals.map((s: SharpSignal, i: number) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.10)", borderRadius: 11 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 165 }}>{s.awayTeam} @ {s.homeTeam}</p>
                    {s.side && <p style={{ fontSize: 10, color: "#22c55e", fontWeight: 700, margin: "1px 0 0" }}>Sharp: {s.side}</p>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                    {s.sharpPct != null && <span style={{ fontSize: 12, fontWeight: 900, color: "#22c55e" }}>{s.sharpPct}%</span>}
                    {s.publicPct != null && <span style={{ fontSize: 10, color: "#94a3b8" }}>Public {s.publicPct}%</span>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── ML Intel ──────────────────────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          <Card>
            <SectionHeader icon={<Brain size={14} style={{ color: "#a855f7" }} />} label="ML Intel" linkTo="/ml-insights" linkLabel="View →" />
            {mlL ? (<><Skel /><Skel /></>) : !mlInsights?.overall ? (
              <EmptyState text="ML model is still learning" />
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {[
                    { label: "Win Rate", value: `${(mlInsights.overall.win_rate * 100).toFixed(1)}%`, color: "#a855f7" },
                    { label: "Graded",   value: String(mlInsights.overall.total_graded), color: "#131A24" },
                    { label: "Avg Score",value: (mlInsights.overall.avg_score ?? 0).toFixed(1), color: "#D4A843" },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)", borderRadius: 10, padding: "7px 8px", textAlign: "center" }}>
                      <p style={{ fontSize: 16, fontWeight: 900, color: s.color, margin: 0 }}>{s.value}</p>
                      <p style={{ fontSize: 10, color: "#94a3b8", margin: "2px 0 0" }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                {topMlSports.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>By Sport</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {topMlSports.map(([sport, d]) => (
                        <div key={sport} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(19,35,58,0.025)", borderRadius: 9 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 14 }}>{se(sport)}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#131A24" }}>{sport}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "#64748b" }}>{d.wins}W–{d.losses}L</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: "#a855f7" }}>{(d.win_rate * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {mlBetTypeBreakdown.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, margin: "10px 0 6px", textTransform: "uppercase", letterSpacing: 0.5 }}>By Bet Type</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {mlBetTypeBreakdown.map(([type, d]) => (
                        <div key={type} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(19,35,58,0.025)", borderRadius: 9 }}>
                          <Pill label={type.replace(/_/g, " ")} color="#64748b" bg="rgba(19,35,58,0.07)" />
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: "#64748b" }}>{d.wins}W–{d.losses}L</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: "#a855f7" }}>{(d.win_rate * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
          {!canSeePro && <ProLock section="ML Intel" />}
        </div>

        {/* ── Prediction Markets ────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={<Activity size={14} style={{ color: "#3b82f6" }} />} label="Prediction Markets" linkTo="/markets" badge={topMarkets.length} />
          {marketsL ? (<><Skel /><Skel /></>) : topMarkets.length === 0 ? (
            <EmptyState text="No active markets" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {topMarkets.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(19,35,58,0.025)", borderRadius: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#131A24", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 165 }}>{m.question || m.title}</p>
                    <p style={{ fontSize: 10, color: "#64748b", margin: "2px 0 0" }}>Vol: {fmtVol(m.volume)} · {m.sport || m.category}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: "#22c55e" }}>{Math.round(m.yesPrice * 100)}¢</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>YES</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Sport Breakdown ───────────────────────────────────────────── */}
        {!statsL && sportsActive.length > 0 && (
          <Card>
            <SectionHeader icon={<Eye size={14} style={{ color: "#64748b" }} />} label="Sport Breakdown" linkTo="/bets" linkLabel="All Picks →" />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sportsActive.map(sport => {
                const count = stats!.bySport[sport] ?? 0;
                const maxCount = Math.max(...sportsActive.map(s => stats!.bySport[s] ?? 0));
                const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                const isFavSport = favSports.map(s => s.toUpperCase()).includes(sport.toUpperCase());
                return (
                  <div key={sport} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{se(sport)}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, width: 44 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#131A24" }}>{sport}</span>
                      {isFavSport && <Star size={9} style={{ color: "#D4A843", fill: "#D4A843" }} />}
                    </div>
                    <div style={{ flex: 1, height: 6, background: "rgba(19,35,58,0.07)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: isFavSport ? "#D4A843" : "#13233A", borderRadius: 99, transition: "width .4s ease" }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", width: 24, textAlign: "right" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ── Today's Schedule ─────────────────────────────────────────── */}
        {todayGames.length > 0 && (
          <Card>
            <SectionHeader icon={<Calendar size={14} style={{ color: "#64748b" }} />} label="Today's Schedule" linkTo="/scores" linkLabel="Scores →" />
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              {todayGames.slice(0, 8).map((g, i) => {
                const isFavTeam = favTeams.length > 0 && favTeams.some(t =>
                  g.homeTeam?.toLowerCase().includes(t.toLowerCase()) ||
                  g.awayTeam?.toLowerCase().includes(t.toLowerCase())
                );
                return (
                  <div key={i} style={{
                    flex: "0 0 auto", borderRadius: 12, padding: "8px 11px", minWidth: 110,
                    background: isFavTeam ? "rgba(212,168,67,0.08)" : "rgba(19,35,58,0.03)",
                    border: `1px solid ${isFavTeam ? "rgba(212,168,67,0.28)" : "rgba(19,35,58,0.08)"}`,
                  }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
                      {se(g.sport)} {g.status === "in_progress" ? <span style={{ color: "#ef4444", fontWeight: 700 }}>LIVE</span> : fmtTime(g.gameTime)}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#131A24" }}>{g.awayTeam}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", margin: "1px 0" }}>vs</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#131A24" }}>{g.homeTeam}</div>
                    {isFavTeam && <div style={{ marginTop: 4 }}><Star size={9} style={{ color: "#D4A843", fill: "#D4A843" }} /></div>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ── Quick Nav Grid ────────────────────────────────────────────── */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Quick Nav</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { href: "/linemate",    icon: <Target size={17} style={{ color: "#22c55e" }} />,     label: "Props Hub",       desc: "Player props & edges",     border: "rgba(34,197,94,0.18)",  bg: "rgba(34,197,94,0.10)" },
              { href: "/bts",         icon: <Trophy size={17} style={{ color: "#D4A843" }} />,     label: "Beat the Streak", desc: "Daily BTS picks",          border: "rgba(212,168,67,0.22)", bg: "rgba(212,168,67,0.12)" },
              { href: "/conviction",  icon: <Flame size={17} style={{ color: "#ef4444" }} />,      label: "Top Plays",       desc: "High-conviction picks",    border: "rgba(239,68,68,0.18)",  bg: "rgba(239,68,68,0.10)" },
              { href: "/clv",         icon: <TrendingUp size={17} style={{ color: "#3b82f6" }} />, label: "Line Movement",   desc: "CLV & sharp action",       border: "rgba(59,130,246,0.18)", bg: "rgba(59,130,246,0.10)" },
              { href: "/markets",     icon: <Activity size={17} style={{ color: "#06b6d4" }} />,   label: "Markets",         desc: "Prediction markets",       border: "rgba(6,182,212,0.18)",  bg: "rgba(6,182,212,0.10)" },
              { href: "/ml-insights", icon: <Brain size={17} style={{ color: "#a855f7" }} />,      label: "ML Intel",        desc: "Model accuracy & trends",  border: "rgba(168,85,247,0.18)", bg: "rgba(168,85,247,0.10)" },
            ].map(nav => (
              <Link href={nav.href} key={nav.href}>
                <div style={{ background: "#fff", border: `1px solid ${nav.border}`, borderRadius: 18, padding: "15px 13px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", position: "relative", overflow: "hidden" }}>
                  <div style={{ width: 34, height: 34, background: nav.bg, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>{nav.icon}</div>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 800, color: "#131A24", margin: 0 }}>{nav.label}</p>
                    <p style={{ fontSize: 10, color: "#64748b", margin: "2px 0 0" }}>{nav.desc}</p>
                  </div>
                  <ChevronRight size={13} style={{ color: "#94a3b8", position: "absolute", top: 15, right: 13 }} />
                </div>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
