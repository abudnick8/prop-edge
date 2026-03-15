import { Bet } from "@shared/schema";
import { Clock, TrendingUp, AlertTriangle, Shield, User, Zap, ChevronDown, ChevronUp, BarChart2, ExternalLink, Loader2 } from "lucide-react";
import BetDetailDrawer from "@/components/BetDetailDrawer";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface BetCardProps {
  bet: Bet;
  compact?: boolean;
}

// ── Sport emoji map ────────────────────────────────────────────────────────
const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀", NFL: "🏈", MLB: "⚾", NHL: "🏒",
  NCAAB: "🎓", Golf: "⛳", Soccer: "⚽", Tennis: "🎾",
};

// ── Bet type emoji map ─────────────────────────────────────────────────────
const BET_TYPE_EMOJI: Record<string, string> = {
  player_prop: "🎯",
  spread: "📊",
  total: "🔢",
  moneyline: "💰",
  futures: "🏆",
  season_long: "📅",
  season_prop: "🏅",  // award props (MVP, Cy Young, etc.)
};

// ── Team logo helpers ────────────────────────────────────────────────────────

const NBA_ABBR: Record<string, string> = {
  "Atlanta Hawks": "atl", "Boston Celtics": "bos", "Brooklyn Nets": "bkn",
  "Charlotte Hornets": "cha", "Chicago Bulls": "chi", "Cleveland Cavaliers": "cle",
  "Dallas Mavericks": "dal", "Denver Nuggets": "den", "Detroit Pistons": "det",
  "Golden State Warriors": "gsw", "Houston Rockets": "hou", "Indiana Pacers": "ind",
  "Los Angeles Clippers": "lac", "Los Angeles Lakers": "lal", "Memphis Grizzlies": "mem",
  "Miami Heat": "mia", "Milwaukee Bucks": "mil", "Minnesota Timberwolves": "min",
  "New Orleans Pelicans": "no", "New York Knicks": "ny", "Oklahoma City Thunder": "okc",
  "Orlando Magic": "orl", "Philadelphia 76ers": "phi", "Phoenix Suns": "phx",
  "Portland Trail Blazers": "por", "Sacramento Kings": "sac", "San Antonio Spurs": "sas",
  "Toronto Raptors": "tor", "Utah Jazz": "utah", "Washington Wizards": "wsh",
  "Hawks": "atl", "Celtics": "bos", "Nets": "bkn", "Hornets": "cha", "Bulls": "chi",
  "Cavaliers": "cle", "Cavs": "cle", "Mavericks": "dal", "Mavs": "dal", "Nuggets": "den",
  "Pistons": "det", "Warriors": "gsw", "Rockets": "hou", "Pacers": "ind",
  "Clippers": "lac", "Lakers": "lal", "Grizzlies": "mem", "Heat": "mia",
  "Bucks": "mil", "Timberwolves": "min", "Wolves": "min", "Pelicans": "no",
  "Knicks": "ny", "Thunder": "okc", "Magic": "orl", "Sixers": "phi",
  "Suns": "phx", "Trail Blazers": "por", "Blazers": "por", "Kings": "sac",
  "Spurs": "sas", "Raptors": "tor", "Jazz": "utah", "Wizards": "wsh",
};

const NFL_ABBR: Record<string, string> = {
  "Arizona Cardinals": "ari", "Atlanta Falcons": "atl", "Baltimore Ravens": "bal",
  "Buffalo Bills": "buf", "Carolina Panthers": "car", "Chicago Bears": "chi",
  "Cincinnati Bengals": "cin", "Cleveland Browns": "cle", "Dallas Cowboys": "dal",
  "Denver Broncos": "den", "Detroit Lions": "det", "Green Bay Packers": "gb",
  "Houston Texans": "hou", "Indianapolis Colts": "ind", "Jacksonville Jaguars": "jax",
  "Kansas City Chiefs": "kc", "Las Vegas Raiders": "lv", "Los Angeles Chargers": "lac",
  "Los Angeles Rams": "lar", "Miami Dolphins": "mia", "Minnesota Vikings": "min",
  "New England Patriots": "ne", "New Orleans Saints": "no", "New York Giants": "nyg",
  "New York Jets": "nyj", "Philadelphia Eagles": "phi", "Pittsburgh Steelers": "pit",
  "San Francisco 49ers": "sf", "Seattle Seahawks": "sea", "Tampa Bay Buccaneers": "tb",
  "Tennessee Titans": "ten", "Washington Commanders": "wsh",
  "Cardinals": "ari", "Falcons": "atl", "Ravens": "bal", "Bills": "buf",
  "Panthers": "car", "Bears": "chi", "Bengals": "cin", "Browns": "cle",
  "Cowboys": "dal", "Broncos": "den", "Lions": "det", "Packers": "gb",
  "Texans": "hou", "Colts": "ind", "Jaguars": "jax", "Jags": "jax",
  "Chiefs": "kc", "Raiders": "lv", "Chargers": "lac", "Rams": "lar",
  "Dolphins": "mia", "Vikings": "min", "Patriots": "ne", "Saints": "no",
  "Giants": "nyg", "Jets": "nyj", "Eagles": "phi", "Steelers": "pit",
  "49ers": "sf", "Seahawks": "sea", "Buccaneers": "tb", "Bucs": "tb",
  "Titans": "ten", "Commanders": "wsh",
};

const MLB_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ari", "Atlanta Braves": "atl", "Baltimore Orioles": "bal",
  "Boston Red Sox": "bos", "Chicago Cubs": "chc", "Chicago White Sox": "chw",
  "Cincinnati Reds": "cin", "Cleveland Guardians": "cle", "Colorado Rockies": "col",
  "Detroit Tigers": "det", "Houston Astros": "hou", "Kansas City Royals": "kc",
  "Los Angeles Angels": "laa", "Los Angeles Dodgers": "lad", "Miami Marlins": "mia",
  "Milwaukee Brewers": "mil", "Minnesota Twins": "min", "New York Mets": "nym",
  "New York Yankees": "nyy", "Oakland Athletics": "oak", "Philadelphia Phillies": "phi",
  "Pittsburgh Pirates": "pit", "San Diego Padres": "sd", "San Francisco Giants": "sf",
  "Seattle Mariners": "sea", "St. Louis Cardinals": "stl", "Tampa Bay Rays": "tb",
  "Texas Rangers": "tex", "Toronto Blue Jays": "tor", "Washington Nationals": "wsh",
  "Diamondbacks": "ari", "D-backs": "ari", "Braves": "atl", "Orioles": "bal",
  "Red Sox": "bos", "Cubs": "chc", "White Sox": "chw", "Reds": "cin",
  "Guardians": "cle", "Rockies": "col", "Tigers": "det", "Astros": "hou",
  "Royals": "kc", "Angels": "laa", "Dodgers": "lad", "Marlins": "mia",
  "Brewers": "mil", "Twins": "min", "Mets": "nym", "Yankees": "nyy",
  "Athletics": "oak", "A's": "oak", "Phillies": "phi", "Pirates": "pit",
  "Padres": "sd", "Giants": "sf", "Mariners": "sea", "Cardinals": "stl",
  "Rays": "tb", "Rangers": "tex", "Blue Jays": "tor", "Nationals": "wsh",
};

const NHL_ABBR: Record<string, string> = {
  "Anaheim Ducks": "ana", "Arizona Coyotes": "ari", "Boston Bruins": "bos",
  "Buffalo Sabres": "buf", "Calgary Flames": "cgy", "Carolina Hurricanes": "car",
  "Chicago Blackhawks": "chi", "Colorado Avalanche": "col", "Columbus Blue Jackets": "cbj",
  "Dallas Stars": "dal", "Detroit Red Wings": "det", "Edmonton Oilers": "edm",
  "Florida Panthers": "fla", "Los Angeles Kings": "lak", "Minnesota Wild": "min",
  "Montreal Canadiens": "mtl", "Nashville Predators": "nsh", "New Jersey Devils": "njd",
  "New York Islanders": "nyi", "New York Rangers": "nyr", "Ottawa Senators": "ott",
  "Philadelphia Flyers": "phi", "Pittsburgh Penguins": "pit", "San Jose Sharks": "sjs",
  "Seattle Kraken": "sea", "St. Louis Blues": "stl", "Tampa Bay Lightning": "tbl",
  "Toronto Maple Leafs": "tor", "Vancouver Canucks": "van", "Vegas Golden Knights": "vgk",
  "Washington Capitals": "wsh", "Winnipeg Jets": "wpg",
  "Ducks": "ana", "Bruins": "bos", "Sabres": "buf", "Flames": "cgy",
  "Hurricanes": "car", "Canes": "car", "Blackhawks": "chi", "Avalanche": "col",
  "Avs": "col", "Blue Jackets": "cbj", "Stars": "dal", "Red Wings": "det",
  "Oilers": "edm", "Panthers": "fla", "Kings": "lak", "Wild": "min",
  "Canadiens": "mtl", "Habs": "mtl", "Predators": "nsh", "Preds": "nsh",
  "Devils": "njd", "Islanders": "nyi", "Rangers": "nyr", "Senators": "ott",
  "Flyers": "phi", "Penguins": "pit", "Pens": "pit", "Sharks": "sjs",
  "Kraken": "sea", "Blues": "stl", "Lightning": "tbl", "Bolts": "tbl",
  "Maple Leafs": "tor", "Leafs": "tor", "Canucks": "van",
  "Golden Knights": "vgk", "Knights": "vgk", "Capitals": "wsh", "Caps": "wsh",
  "Jets": "wpg",
};

function getTeamLogoUrl(teamName: string | null | undefined, sport: string): string | null {
  if (!teamName) return null;
  const s = sport.toUpperCase();
  let abbr: string | undefined;

  if (s === "NBA") abbr = NBA_ABBR[teamName];
  else if (s === "NFL") abbr = NFL_ABBR[teamName];
  else if (s === "MLB") abbr = MLB_ABBR[teamName];
  else if (s === "NHL") abbr = NHL_ABBR[teamName];

  if (!abbr) {
    const map = s === "NBA" ? NBA_ABBR : s === "NFL" ? NFL_ABBR : s === "MLB" ? MLB_ABBR : s === "NHL" ? NHL_ABBR : {};
    const key = Object.keys(map).find(k => teamName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(teamName.toLowerCase()));
    if (key) abbr = map[key];
  }
  if (!abbr) return null;

  if (s === "NBA") return `https://a.espncdn.com/i/teamlogos/nba/500/${abbr}.png`;
  if (s === "NFL") return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;
  if (s === "MLB") return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png`;
  if (s === "NHL") return `https://a.espncdn.com/i/teamlogos/nhl/500/${abbr}.png`;
  return null;
}

// ── Sport color themes (Cosmic Gold palette) ────────────────────────────────
const SPORT_THEME: Record<string, { glow: string; gradient: string; accent: string }> = {
  NBA: { glow: "rgba(251,146,60,0.35)",  gradient: "linear-gradient(145deg, rgba(251,146,60,0.07) 0%, rgba(245,158,11,0.04) 100%)",  accent: "#fb923c" },
  NFL: { glow: "rgba(248,113,113,0.35)", gradient: "linear-gradient(145deg, rgba(248,113,113,0.07) 0%, rgba(239,68,68,0.04) 100%)",  accent: "#f87171" },
  MLB: { glow: "rgba(96,165,250,0.35)",  gradient: "linear-gradient(145deg, rgba(96,165,250,0.07) 0%, rgba(59,130,246,0.04) 100%)",  accent: "#60a5fa" },
  NHL: { glow: "rgba(34,211,238,0.35)",  gradient: "linear-gradient(145deg, rgba(34,211,238,0.07) 0%, rgba(14,165,233,0.04) 100%)",  accent: "#22d3ee" },
  NCAAB: { glow: "rgba(167,139,250,0.35)", gradient: "linear-gradient(145deg, rgba(167,139,250,0.07) 0%, rgba(124,58,237,0.04) 100%)", accent: "#a78bfa" },
  Golf: { glow: "rgba(74,222,128,0.35)",  gradient: "linear-gradient(145deg, rgba(74,222,128,0.07) 0%, rgba(34,197,94,0.04) 100%)",  accent: "#4ade80" },
};

// ── Player Headshot (NBA via ESPN CDN) ──────────────────────────────────────
const NBA_PLAYER_ESPN_ID: Record<string, string> = {
  "LeBron James": "1966",       "Stephen Curry": "3975",     "Kevin Durant": "3202",
  "Giannis Antetokounmpo": "3032977", "Luka Doncic": "3945274",  "Joel Embiid": "3059318",
  "Nikola Jokic": "3112335",   "Jayson Tatum": "4065648",  "Devin Booker": "3136193",
  "Damian Lillard": "6606",    "Anthony Davis": "6583",    "Jimmy Butler": "6430",
  "Kyrie Irving": "6442",      "Karl-Anthony Towns": "3136776", "Trae Young": "4277905",
  "Zion Williamson": "4395725","Donovan Mitchell": "3908845", "Bam Adebayo": "3907387",
  "Paul George": "4251",       "Kawhi Leonard": "6450",    "Russell Westbrook": "3468",
  "James Harden": "3992",      "Chris Paul": "1906",       "Draymond Green": "6589",
  "Klay Thompson": "6475",     "Bradley Beal": "6580",     "Ja Morant": "4279888",
  "Paolo Banchero": "4432576", "Cade Cunningham": "4432162","Tyrese Haliburton": "4395628",
  "Evan Mobley": "4432163",    "Franz Wagner": "4432577",  "Anthony Edwards": "4431678",
  "Scottie Barnes": "4432158", "Jalen Green": "4432164",   "Josh Giddey": "4432566",
  "Shai Gilgeous-Alexander": "4278104", "Darius Garland": "4395625",
  "Dejounte Murray": "3934673","OG Anunoby": "3934678",   "Mikal Bridges": "3934679",
  "Tyrese Maxey": "4432154",   "De'Aaron Fox": "4066668",  "Jordan Poole": "4432157",
  "Brandon Ingram": "3136193", "Zach LaVine": "3136193",  "DeMar DeRozan": "3979",
};

function getPlayerHeadshotUrl(playerName: string | null | undefined, sport: string): string | null {
  if (!playerName || sport.toUpperCase() !== "NBA") return null;
  const espnId = NBA_PLAYER_ESPN_ID[playerName];
  if (!espnId) return null;
  return `https://a.espncdn.com/i/headshots/nba/players/full/${espnId}.png`;
}

// ── Confidence Ring (Cosmic Gold: gold ≥80, cyan mid, orange low) ─────────
function ConfidenceRing({ score }: { score: number }) {
  const size = 60;
  const r = 24;
  const circumference = 2 * Math.PI * r;
  const fill = (score / 100) * circumference;
  const color =
    score >= 80 ? "#f59e0b" : score >= 65 ? "#22d3ee" : "#f87171";
  const glowColor =
    score >= 80 ? "rgba(245,158,11,0.7)" : score >= 65 ? "rgba(34,211,238,0.6)" : "rgba(248,113,113,0.6)";

  return (
    <div
      className={`relative flex-shrink-0 ${score >= 80 ? "high-conf-pulse" : ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <filter id={`glow-ring-${score}`}>
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3.5" />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - fill}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{
            transition: "stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)",
            filter: `drop-shadow(0 0 5px ${glowColor})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-black font-mono leading-none" style={{ color }}>
          {score}
        </span>
        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
          conf
        </span>
      </div>
    </div>
  );
}

// ── Source Badge ─────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border source-${source} uppercase tracking-wide`}>
      {source === "draftkings" ? "🎲 DK" : source === "polymarket" ? "📈 Poly" : source === "underdog" ? "🐶 UD" : source === "sportsgameodds" ? "⚡ SGO" : source === "actionnetwork" ? "🔍 AN" : source}
    </span>
  );
}

function SportBadge({ sport }: { sport: string }) {
  const emoji = SPORT_EMOJI[sport.toUpperCase()] ?? "🏅";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border sport-${sport.toLowerCase()} uppercase tracking-wide`}>
      {emoji} {sport}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  const classes: Record<string, string> = {
    low: "bg-green-500/10 text-green-400 border-green-500/30",
    medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  };
  const Icon = risk === "low" ? Shield : risk === "medium" ? TrendingUp : AlertTriangle;
  const riskEmoji = risk === "low" ? "✅" : risk === "medium" ? "⚠️" : "🔥";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${classes[risk] ?? classes.medium} uppercase tracking-wide`}>
      {riskEmoji} {risk} risk
    </span>
  );
}

// ── Team Logo Avatar ─────────────────────────────────────────────────────────
function TeamLogo({ teamName, sport, size = 28 }: { teamName: string | null | undefined; sport: string; size?: number }) {
  const [errored, setErrored] = useState(false);
  const url = getTeamLogoUrl(teamName, sport);
  if (!url || errored) return null;
  return (
    <img
      src={url}
      alt={teamName ?? "team"}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className="object-contain drop-shadow-lg"
      style={{ width: size, height: size, filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.5))" }}
    />
  );
}

// ── Player Headshot Avatar ────────────────────────────────────────────────────
function PlayerHeadshot({ playerName, sport }: { playerName: string | null | undefined; sport: string }) {
  const [errored, setErrored] = useState(false);
  const url = getPlayerHeadshotUrl(playerName, sport);
  if (!url || errored) return null;
  return (
    <div
      className="flex-shrink-0 rounded-full overflow-hidden border-2"
      style={{
        width: 40, height: 40,
        borderColor: "rgba(245,158,11,0.4)",
        background: "rgba(139,92,246,0.15)",
        boxShadow: "0 0 10px rgba(245,158,11,0.2)",
      }}
    >
      <img
        src={url}
        alt={playerName ?? "player"}
        width={40}
        height={40}
        onError={() => setErrored(true)}
        className="object-cover w-full h-full"
        style={{ objectPosition: "top center", transform: "scale(1.15)" }}
      />
    </div>
  );
}

// ── Pick Side Banner ──────────────────────────────────────────────────────────
function PickBanner({ pickSide, line, oddsDisplay }: { pickSide: string; line: number | null; oddsDisplay: string | null }) {
  const isOver = pickSide === "OVER";
  return (
    <div
      className={`pick-banner relative flex items-center justify-between mb-3 px-3 py-2 rounded-lg font-bold text-sm tracking-wide overflow-hidden ${
        isOver ? "pick-over" : "pick-under"
      }`}
    >
      <div className="pick-shimmer" />
      <span className="relative flex items-center gap-2 z-10">
        <span className="text-base">{isOver ? "🔺" : "🔻"}</span>
        <span>{isOver ? "TAKE OVER" : "TAKE UNDER"}{line !== null ? ` ${line}` : ""}</span>
      </span>
      {oddsDisplay && (
        <span className="relative font-mono text-sm z-10 opacity-90">{oddsDisplay}</span>
      )}
    </div>
  );
}

// ── Player Stats Drawer ───────────────────────────────────────────────────────
interface PlayerStat {
  label: string;
  value: string | number;
  highlight?: boolean;
}

interface PlayerStatsData {
  name: string;
  team?: string;
  position?: string;
  season?: string;
  stats: PlayerStat[];
  referenceUrl?: string;
  source?: string;
}

function PlayerStatsDrawer({ playerName, sport }: { playerName: string; sport: string }) {
  const sportUp = sport.toUpperCase();
  const enabled = sportUp === "NBA" || sportUp === "NFL";

  const { data, isLoading, isError } = useQuery<PlayerStatsData>({
    queryKey: ["/api/player-stats", sportUp, playerName],
    queryFn: () => apiRequest("GET", `/api/player-stats/${sportUp}/${encodeURIComponent(playerName)}`),
    enabled,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  if (!enabled) return (
    <div className="text-xs text-center py-3" style={{ color: "rgba(255,255,255,0.35)" }}>
      📊 Stats available for NBA &amp; NFL players
    </div>
  );

  if (isLoading) return (
    <div className="flex items-center justify-center gap-2 py-4 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
      <Loader2 size={13} className="animate-spin" />
      Loading {playerName}'s stats...
    </div>
  );

  if (isError || !data) return (
    <div className="text-xs text-center py-3" style={{ color: "rgba(255,255,255,0.35)" }}>
      📊 Stats not available right now
    </div>
  );

  return (
    <div className="stats-drawer pt-3 pb-1">
      {/* Player info header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold" style={{ color: "#f59e0b" }}>{data.name}</p>
          {(data.team || data.position) && (
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              {[data.position, data.team, data.season].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {data.referenceUrl && (
          <a
            href={data.referenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-colors hover:bg-white/5"
            style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.3)" }}
          >
            <ExternalLink size={9} />
            {data.source ?? "Reference"}
          </a>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        {data.stats.slice(0, 9).map((stat, i) => (
          <div
            key={i}
            className="rounded-lg px-2 py-2 text-center"
            style={{
              background: stat.highlight ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${stat.highlight ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.07)"}`,
            }}
          >
            <p
              className="text-base font-black font-mono leading-none"
              style={{ color: stat.highlight ? "#f59e0b" : "hsl(45 100% 90%)" }}
            >
              {stat.value}
            </p>
            <p className="text-[9px] mt-1 font-medium uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main BetCard ──────────────────────────────────────────────────────────────
export default function BetCard({ bet, compact = false }: BetCardProps) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerBet, setDrawerBet] = useState<typeof bet | null>(null);

  const openDrawer = (b = bet) => { setDrawerBet(b); setDrawerOpen(true); };
  const score = bet.confidenceScore ?? 0;
  const isHigh = score >= 80;
  const sport = bet.sport?.toUpperCase() ?? "NBA";
  const theme = SPORT_THEME[sport] ?? SPORT_THEME.NBA;
  const sportEmoji = SPORT_EMOJI[sport] ?? "🏅";

  const teamStats = bet.teamStats as { pickSide?: string; pickedOdds?: number } | null;
  const pickSideRaw = bet.betType === "player_prop" ? teamStats?.pickSide : null;
  const pickSide = pickSideRaw?.toUpperCase() ?? null;
  const pickedOdds = teamStats?.pickedOdds;
  const oddsDisplay = pickedOdds !== undefined ? (pickedOdds > 0 ? `+${pickedOdds}` : `${pickedOdds}`) : null;

  const homeLogoUrl = getTeamLogoUrl(bet.homeTeam, bet.sport);
  const awayLogoUrl = getTeamLogoUrl(bet.awayTeam, bet.sport);
  const hasHeadshot = !!getPlayerHeadshotUrl(bet.playerName, bet.sport);

  // Only player props with a player name can show stats
  const canShowStats = bet.betType === "player_prop" && !!bet.playerName;

  return (
    <div
      data-testid={`bet-card-${bet.id}`}
      className={`bet-card rounded-xl border relative overflow-hidden ${isHigh ? "bet-card-hot" : ""}`}
      style={{
        background: `linear-gradient(145deg, hsl(265 30% 10%), hsl(265 28% 12%))`,
        borderColor: isHigh ? "rgba(245,158,11,0.4)" : "hsl(265 20% 18%)",
      }}
    >
      {/* Sport-colored top gradient strip */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: theme.accent, opacity: isHigh ? 1 : 0.4 }}
      />

      {/* Background sport gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: theme.gradient, opacity: isHigh ? 1 : 0.6 }}
      />

      {/* Main content — clicking opens drawer */}
      <div onClick={() => openDrawer()} className="block relative p-4 cursor-pointer">
          {/* Pick Side Banner */}
          {pickSide && (
            <PickBanner pickSide={pickSide} line={bet.line} oddsDisplay={oddsDisplay} />
          )}

          {/* Top Row: Ring + Info + Team Logos / Player Headshot */}
          <div className="flex items-start gap-3">
            <ConfidenceRing score={score} />

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="font-bold text-sm leading-tight line-clamp-2" style={{ color: "hsl(45 100% 92%)" }}>
                  {bet.title.replace(/^\[TAKE (OVER|UNDER)[^\]]*\]\s*/, "")}
                </p>
                {/* Player headshot (NBA props) or team logos */}
                {hasHeadshot ? (
                  <PlayerHeadshot playerName={bet.playerName} sport={bet.sport} />
                ) : (homeLogoUrl || awayLogoUrl) ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {awayLogoUrl && <img src={awayLogoUrl} alt={bet.awayTeam ?? ""} width={24} height={24} className="object-contain" style={{ opacity: 0.85, filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.5))" }} onError={(e) => (e.currentTarget.style.display = "none")} />}
                    {homeLogoUrl && awayLogoUrl && <span className="text-[8px] font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>@</span>}
                    {homeLogoUrl && <img src={homeLogoUrl} alt={bet.homeTeam ?? ""} width={24} height={24} className="object-contain" style={{ opacity: 0.85, filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.5))" }} onError={(e) => (e.currentTarget.style.display = "none")} />}
                  </div>
                ) : null}
              </div>

              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <SourceBadge source={bet.source} />
                <SportBadge sport={bet.sport} />
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted text-muted-foreground capitalize">
                  {BET_TYPE_EMOJI[bet.betType] ?? "🎰"} {bet.betType.replace("_", " ")}
                </span>
                {isHigh && (
                  <span className="hot-pick-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide">
                    🔥 Hot Pick
                  </span>
                )}
                {!bet.gameTime && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 uppercase tracking-wide">
                    📅 Futures
                  </span>
                )}
              </div>

              {!compact && (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2">
                  {bet.playerName && (
                    <span className="flex items-center gap-1 font-medium text-foreground/70">
                      👤 {bet.playerName}
                    </span>
                  )}
                  {bet.homeTeam && (
                    <span className="flex items-center gap-1">
                      {sportEmoji} {bet.awayTeam} @ {bet.homeTeam}
                    </span>
                  )}
                  {bet.gameTime && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {formatDistanceToNow(new Date(bet.gameTime), { addSuffix: true })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Score bar + stats */}
          {!compact && (
            <>
              <div className="mt-3 mb-2">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">Confidence</span>
                  <span className="font-mono font-bold" style={{
                    color: score >= 80 ? "#22c55e" : score >= 65 ? "#eab308" : "#f97316"
                  }}>{score}/100</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full confidence-bar"
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <RiskBadge risk={bet.riskLevel} />
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {bet.recommendedAllocation !== null && (
                    <div className="text-right">
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Allocation</p>
                      <p className="font-mono font-bold" style={{ color: "#f59e0b" }}>{bet.recommendedAllocation}%</p>
                    </div>
                  )}
                  {bet.impliedProbability !== null && (
                    <div className="text-right">
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Implied</p>
                      <p className="font-mono font-bold" style={{ color: "#22d3ee" }}>{Math.round(bet.impliedProbability * 100)}%</p>
                    </div>
                  )}
                  {bet.line !== null && (
                    <div className="text-right">
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Line</p>
                      <p className="font-mono font-bold" style={{ color: "hsl(45 100% 90%)" }}>{bet.line}</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
      </div>

      {/* Stats Expand Button — outside the link to avoid nav */}
      {canShowStats && !compact && (
        <div
          className="relative border-t"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setStatsOpen((o) => !o)}
            data-testid={`btn-stats-${bet.id}`}
            className="w-full flex items-center justify-center gap-2 py-2 text-[11px] font-semibold transition-colors hover:bg-white/5"
            style={{ color: statsOpen ? "#f59e0b" : "rgba(255,255,255,0.45)" }}
          >
            <BarChart2 size={12} />
            {statsOpen ? "Hide Stats" : "📊 Player Stats"}
            {statsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          {statsOpen && (
            <div
              className="stats-slide-down px-4 pb-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <PlayerStatsDrawer playerName={bet.playerName!} sport={bet.sport} />
            </div>
          )}
        </div>
      )}
      {/* Bet Detail Drawer */}
      <BetDetailDrawer
        bet={drawerBet}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSelectBet={(b) => openDrawer(b)}
      />
    </div>
  );
}
