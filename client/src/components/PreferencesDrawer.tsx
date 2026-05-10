import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { X, Star, Search, Plus, ChevronDown, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Preferences {
  favoriteSports: string[];
  favoriteTeams: string[];
  favoritePlayers: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_SPORTS = ["NFL", "NBA", "MLB", "NHL"];

const TEAMS_BY_SPORT: Record<string, string[]> = {
  NFL: [
    "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills",
    "Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns",
    "Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
    "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs",
    "Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins",
    "Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants",
    "New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers",
    "Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders",
  ],
  NBA: [
    "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets",
    "Chicago Bulls","Cleveland Cavaliers","Dallas Mavericks","Denver Nuggets",
    "Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
    "Los Angeles Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat",
    "Milwaukee Bucks","Minnesota Timberwolves","New Orleans Pelicans","New York Knicks",
    "Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers","Phoenix Suns",
    "Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors",
    "Utah Jazz","Washington Wizards",
  ],
  MLB: [
    "Arizona Diamondbacks","Atlanta Braves","Baltimore Orioles","Boston Red Sox",
    "Chicago Cubs","Chicago White Sox","Cincinnati Reds","Cleveland Guardians",
    "Colorado Rockies","Detroit Tigers","Houston Astros","Kansas City Royals",
    "Los Angeles Angels","Los Angeles Dodgers","Miami Marlins","Milwaukee Brewers",
    "Minnesota Twins","New York Mets","New York Yankees","Oakland Athletics",
    "Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres","San Francisco Giants",
    "Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays","Texas Rangers",
    "Toronto Blue Jays","Washington Nationals",
  ],
  NHL: [
    "Anaheim Ducks","Arizona Coyotes","Boston Bruins","Buffalo Sabres",
    "Calgary Flames","Carolina Hurricanes","Chicago Blackhawks","Colorado Avalanche",
    "Columbus Blue Jackets","Dallas Stars","Detroit Red Wings","Edmonton Oilers",
    "Florida Panthers","Los Angeles Kings","Minnesota Wild","Montreal Canadiens",
    "Nashville Predators","New Jersey Devils","New York Islanders","New York Rangers",
    "Ottawa Senators","Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks",
    "Seattle Kraken","St. Louis Blues","Tampa Bay Lightning","Toronto Maple Leafs",
    "Utah Hockey Club","Vancouver Canucks","Vegas Golden Knights","Washington Capitals","Winnipeg Jets",
  ],
};

const SPORT_EMOJI: Record<string, string> = {
  NFL: "🏈", NBA: "🏀", MLB: "⚾", NHL: "🏒",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PreferencesDrawer({ open, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: saved } = useQuery<Preferences>({
    queryKey: ["/api/me/preferences"],
    queryFn: () => apiRequest("GET", "/api/me/preferences").then(r => r.json()),
    enabled: open,
  });

  const [sports, setSports]   = useState<string[]>([]);
  const [teams, setTeams]     = useState<string[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const [teamSearch, setTeamSearch]     = useState("");
  const [playerInput, setPlayerInput]   = useState("");
  const [teamDropSport, setTeamDropSport] = useState<string | null>(null);

  // Hydrate from saved prefs
  useEffect(() => {
    if (saved) {
      setSports(saved.favoriteSports  ?? []);
      setTeams(saved.favoriteTeams    ?? []);
      setPlayers(saved.favoritePlayers ?? []);
    }
  }, [saved]);

  const saveMut = useMutation({
    mutationFn: (p: Preferences) => apiRequest("PATCH", "/api/me/preferences", p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/me/preferences"] });
      toast({ title: "Favorites Saved", description: "Your personalization is saved across all sessions." });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save preferences.", variant: "destructive" }),
  });

  const handleSave = () =>
    saveMut.mutate({ favoriteSports: sports, favoriteTeams: teams, favoritePlayers: players });

  const toggleSport = (s: string) =>
    setSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const toggleTeam = (t: string) =>
    setTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const addPlayer = () => {
    const name = playerInput.trim();
    if (!name || players.includes(name)) { setPlayerInput(""); return; }
    setPlayers(prev => [...prev, name]);
    setPlayerInput("");
  };

  const removePlayer = (p: string) => setPlayers(prev => prev.filter(x => x !== p));

  // Visible teams: show only from selected sports, filtered by search
  const visibleSports = sports.length > 0 ? sports : ALL_SPORTS;
  const allTeamChoices = visibleSports.flatMap(s => TEAMS_BY_SPORT[s] ?? []);
  const filteredTeams = teamSearch.trim()
    ? allTeamChoices.filter(t => t.toLowerCase().includes(teamSearch.toLowerCase()))
    : [];

  if (!open) return null;

  const totalFavs = sports.length + teams.length + players.length;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          zIndex: 999, backdropFilter: "blur(2px)",
        }}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000,
        background: "#F6F1E7", borderRadius: "22px 22px 0 0",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
        maxHeight: "88vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        maxWidth: 520, margin: "0 auto",
      }}>
        {/* Handle */}
        <div style={{ padding: "12px 0 4px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(19,35,58,0.18)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(212,168,67,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Star size={16} style={{ color: "#D4A843" }} />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 800, color: "#131A24", margin: 0 }}>My Favorites</p>
              <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>Personalize your Clubhouse IQ</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(19,35,58,0.07)", border: "none", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "#131A24", display: "flex", alignItems: "center" }}>
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Favorite Sports ── */}
          <Section label="Favorite Sports" hint="Filter your dashboard picks by sport">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALL_SPORTS.map(s => {
                const on = sports.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSport(s)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "7px 14px", borderRadius: 20, border: "1.5px solid",
                      borderColor: on ? "#13233A" : "rgba(19,35,58,0.18)",
                      background: on ? "#13233A" : "#fff",
                      color: on ? "#F6F1E7" : "#131A24",
                      fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{SPORT_EMOJI[s]}</span>
                    {s}
                    {on && <Check size={12} />}
                  </button>
                );
              })}
            </div>
            {sports.length === 0 && (
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>No sport selected — personalized section will show all sports.</p>
            )}
          </Section>

          {/* ── Favorite Teams ── */}
          <Section label="Favorite Teams" hint="Search and pin teams you follow">
            {/* Selected chips */}
            {teams.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {teams.map(t => (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 5, background: "#13233A", color: "#F6F1E7", borderRadius: 20, padding: "5px 10px", fontSize: 11, fontWeight: 700 }}>
                    {t}
                    <button onClick={() => toggleTeam(t)} style={{ background: "none", border: "none", color: "rgba(246,241,231,0.7)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Sport accordion pickers */}
            {visibleSports.map(sport => (
              <div key={sport} style={{ borderRadius: 12, border: "1px solid rgba(19,35,58,0.10)", overflow: "hidden", marginBottom: 6 }}>
                <button
                  onClick={() => setTeamDropSport(teamDropSport === sport ? null : sport)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "9px 13px", background: teamDropSport === sport ? "#13233A" : "#fff",
                    color: teamDropSport === sport ? "#F6F1E7" : "#131A24",
                    border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, transition: "all 0.15s",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{SPORT_EMOJI[sport]}</span> {sport} Teams
                    {teams.filter(t => (TEAMS_BY_SPORT[sport] ?? []).includes(t)).length > 0 && (
                      <span style={{ fontSize: 10, background: "#D4A843", color: "#131A24", borderRadius: 20, padding: "1px 7px", fontWeight: 800 }}>
                        {teams.filter(t => (TEAMS_BY_SPORT[sport] ?? []).includes(t)).length} picked
                      </span>
                    )}
                  </span>
                  <ChevronDown size={14} style={{ transform: teamDropSport === sport ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>

                {teamDropSport === sport && (
                  <div style={{ padding: "8px 10px 10px", background: "#fff", display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflowY: "auto" }}>
                    {(TEAMS_BY_SPORT[sport] ?? []).map(t => {
                      const on = teams.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTeam(t)}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                            background: on ? "rgba(19,35,58,0.06)" : "transparent",
                            textAlign: "left", width: "100%",
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: on ? 700 : 500, color: "#131A24" }}>{t}</span>
                          {on && <Check size={13} style={{ color: "#16a34a", flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Search fallback */}
            <div style={{ position: "relative", marginTop: 4 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
              <input
                value={teamSearch}
                onChange={e => setTeamSearch(e.target.value)}
                placeholder="Search any team…"
                style={{
                  width: "100%", paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                  borderRadius: 10, border: "1px solid rgba(19,35,58,0.14)", background: "#fff",
                  fontSize: 12, color: "#131A24", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            {teamSearch && filteredTeams.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid rgba(19,35,58,0.10)", borderRadius: 10, marginTop: 4, maxHeight: 160, overflowY: "auto" }}>
                {filteredTeams.map(t => {
                  const on = teams.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => { toggleTeam(t); setTeamSearch(""); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                    >
                      <span style={{ fontSize: 12, color: "#131A24" }}>{t}</span>
                      {on && <Check size={12} style={{ color: "#16a34a" }} />}
                    </button>
                  );
                })}
              </div>
            )}
            {teamSearch && filteredTeams.length === 0 && (
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>No teams matched "{teamSearch}"</p>
            )}
          </Section>

          {/* ── Favorite Players ── */}
          <Section label="Favorite Players" hint="Add player names to see their props highlighted">
            {players.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {players.map(p => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 5, background: "#13233A", color: "#F6F1E7", borderRadius: 20, padding: "5px 11px", fontSize: 11, fontWeight: 700 }}>
                    {p}
                    <button onClick={() => removePlayer(p)} style={{ background: "none", border: "none", color: "rgba(246,241,231,0.7)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={playerInput}
                onChange={e => setPlayerInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addPlayer()}
                placeholder="Type a player name…"
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 10,
                  border: "1px solid rgba(19,35,58,0.14)", background: "#fff",
                  fontSize: 12, color: "#131A24", outline: "none",
                }}
              />
              <button
                onClick={addPlayer}
                disabled={!playerInput.trim()}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "8px 13px", borderRadius: 10, border: "none",
                  background: playerInput.trim() ? "#13233A" : "rgba(19,35,58,0.12)",
                  color: playerInput.trim() ? "#F6F1E7" : "#94a3b8",
                  fontWeight: 700, fontSize: 12, cursor: playerInput.trim() ? "pointer" : "default", transition: "all 0.15s",
                }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Press Enter or tap Add — appears in your personalized section</p>
          </Section>

        </div>

        {/* Footer */}
        <div style={{ padding: "12px 16px 20px", borderTop: "1px solid rgba(19,35,58,0.08)", background: "#F6F1E7", display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "12px", borderRadius: 14, border: "1px solid rgba(19,35,58,0.18)", background: "#fff", color: "#131A24", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMut.isPending}
            style={{
              flex: 2, padding: "12px", borderRadius: 14, border: "none",
              background: "#13233A", color: "#F6F1E7", fontSize: 13, fontWeight: 800,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: saveMut.isPending ? 0.7 : 1,
            }}
          >
            <Star size={14} />
            {saveMut.isPending ? "Saving…" : `Save Favorites${totalFavs > 0 ? ` (${totalFavs})` : ""}`}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: "#131A24", margin: 0 }}>{label}</p>
        <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>{hint}</p>
      </div>
      {children}
    </div>
  );
}
