import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Wind, Thermometer, Layers, ChevronRight, ChevronDown, Search } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MlbStadium {
  venue: string; team: string; abbr: string; div: string;
  dome: boolean; retractable: boolean; elevation: number; surface: string;
  hitFactor: number; hrFactor: number; runFactor: number;
  lf: number; cf: number; rf: number; lfWall: number; rfWall: number;
  windTendency: string; notes: string;
}

interface NflStadium {
  venue: string; team: string; abbr: string; conf: string; div: string;
  dome: boolean; retractable: boolean; elevation: number; surface: string;
  weatherRisk: string; windFactor: string; scoringFactor: number; notes: string;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const BG      = "#F6F1E7";
const NAVY    = "#13233A";
const GOLD    = "#D4A843";
const MUTED   = "#3D4B58";
const GREEN   = "#22c55e";
const RED     = "#ef4444";
const AMBER   = "#f59e0b";

const CARD: React.CSSProperties = {
  background: "#fff",
  borderRadius: "1rem",
  padding: "1rem 1.1rem",
  boxShadow: "0 2px 10px rgba(19,35,58,0.07)",
  border: "1px solid rgba(19,35,58,0.07)",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function factorColor(v: number): string {
  if (v >= 1.10) return GREEN;
  if (v >= 1.04) return "#86efac";
  if (v <= 0.90) return RED;
  if (v <= 0.96) return "#fca5a5";
  return MUTED;
}

function factorLabel(v: number): string {
  if (v >= 1.15) return "Extreme Hitter";
  if (v >= 1.08) return "Very Hitter-Friendly";
  if (v >= 1.03) return "Hitter-Friendly";
  if (v <= 0.85) return "Extreme Pitcher";
  if (v <= 0.92) return "Very Pitcher-Friendly";
  if (v <= 0.97) return "Pitcher-Friendly";
  return "Neutral";
}

function nflScoringLabel(v: number): string {
  if (v >= 1.06) return "High Scoring";
  if (v >= 1.02) return "Slightly Elevated";
  if (v <= 0.94) return "Low Scoring";
  if (v <= 0.98) return "Slightly Suppressed";
  return "Neutral";
}

function weatherRiskColor(r: string): string {
  if (r === "High") return RED;
  if (r === "Moderate") return AMBER;
  if (r === "Low") return GREEN;
  return MUTED; // None / Dome
}

function FactorBar({ value, label, max = 1.35, min = 0.85 }: { value: number; label: string; max?: number; min?: number }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const col = factorColor(value);
  return (
    <div style={{ marginBottom: "0.55rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 900, color: col }}>{value.toFixed(2)}</span>
      </div>
      <div style={{ height: 6, background: "rgba(19,35,58,0.09)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 800,
      background: bg,
      color,
      letterSpacing: "0.03em",
    }}>{text}</span>
  );
}

function DomeBadge({ dome, retractable }: { dome: boolean; retractable: boolean }) {
  if (dome && retractable) return <Badge text="Retractable Roof" color="#7c3aed" bg="#ede9fe" />;
  if (dome) return <Badge text="Fixed Dome" color="#2563eb" bg="#dbeafe" />;
  return <Badge text="Open Air" color={MUTED} bg="rgba(19,35,58,0.07)" />;
}

// ─── MLB Stadium Card ─────────────────────────────────────────────────────────

function MlbCard({ s }: { s: MlbStadium }) {
  const [open, setOpen] = useState(false);
  const rating = factorLabel(s.hitFactor);
  const ratingColor = factorColor(s.hitFactor);

  return (
    <div
      style={{ ...CARD, cursor: "pointer", transition: "box-shadow 0.15s" }}
      onClick={() => setOpen(o => !o)}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {/* Team abbr badge */}
        <div style={{
          width: 44, height: 44, borderRadius: "0.65rem",
          background: NAVY, display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: GOLD, letterSpacing: "0.04em" }}>{s.abbr}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, lineHeight: 1.2 }}>{s.venue}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{s.team} · {s.div}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: ratingColor }}>{rating}</span>
          <DomeBadge dome={s.dome} retractable={s.retractable} />
        </div>

        <div style={{ marginLeft: 4 }}>
          {open ? <ChevronDown size={16} color={MUTED} /> : <ChevronRight size={16} color={MUTED} />}
        </div>
      </div>

      {/* Quick factor pills */}
      {!open && (
        <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.65rem", flexWrap: "wrap" }}>
          {[
            { label: `Hit: ${s.hitFactor.toFixed(2)}`, color: factorColor(s.hitFactor) },
            { label: `HR: ${s.hrFactor.toFixed(2)}`,   color: factorColor(s.hrFactor) },
            { label: `R: ${s.runFactor.toFixed(2)}`,   color: factorColor(s.runFactor) },
            { label: `${s.elevation.toLocaleString()}ft elev`, color: MUTED },
          ].map(p => (
            <span key={p.label} style={{
              padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
              background: "rgba(19,35,58,0.06)", color: p.color,
            }}>{p.label}</span>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      {open && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid rgba(19,35,58,0.07)", paddingTop: "1rem" }}>
          {/* Factor bars */}
          <FactorBar value={s.hitFactor} label="Hit Factor" />
          <FactorBar value={s.hrFactor}  label="HR Factor" />
          <FactorBar value={s.runFactor} label="Run Factor" />

          {/* Dimensions grid */}
          <div style={{ marginTop: "0.85rem", marginBottom: "0.85rem" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>Dimensions</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
              {[
                { label: "LF", dist: s.lf, wall: s.lfWall },
                { label: "CF", dist: s.cf, wall: null },
                { label: "RF", dist: s.rf, wall: s.rfWall },
              ].map(d => (
                <div key={d.label} style={{ background: "rgba(19,35,58,0.04)", borderRadius: "0.5rem", padding: "0.45rem 0.5rem", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, textTransform: "uppercase" }}>{d.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: NAVY }}>{d.dist}ft</div>
                  {d.wall != null && <div style={{ fontSize: 10, color: MUTED }}>{d.wall}ft wall</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Stat grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem", marginBottom: "0.85rem" }}>
            {[
              { label: "Elevation", value: `${s.elevation.toLocaleString()} ft` },
              { label: "Surface",   value: s.surface },
              { label: "Wind",      value: s.windTendency },
            ].map(d => (
              <div key={d.label} style={{ background: "rgba(19,35,58,0.04)", borderRadius: "0.5rem", padding: "0.45rem 0.5rem", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, textTransform: "uppercase" }}>{d.label}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginTop: 2 }}>{d.value}</div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55, background: "rgba(19,35,58,0.03)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem" }}>
            {s.notes}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NFL Stadium Card ─────────────────────────────────────────────────────────

function NflCard({ s }: { s: NflStadium }) {
  const [open, setOpen] = useState(false);
  const riskColor = weatherRiskColor(s.weatherRisk);
  const scoringColor = factorColor(s.scoringFactor);

  return (
    <div
      style={{ ...CARD, cursor: "pointer" }}
      onClick={() => setOpen(o => !o)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "0.65rem",
          background: NAVY, display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: GOLD, letterSpacing: "0.04em" }}>{s.abbr}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, lineHeight: 1.2 }}>{s.venue}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{s.team} · {s.div}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: scoringColor }}>{nflScoringLabel(s.scoringFactor)}</span>
          <DomeBadge dome={s.dome} retractable={s.retractable} />
        </div>

        <div style={{ marginLeft: 4 }}>
          {open ? <ChevronDown size={16} color={MUTED} /> : <ChevronRight size={16} color={MUTED} />}
        </div>
      </div>

      {!open && (
        <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.65rem", flexWrap: "wrap" }}>
          {[
            { label: `Score: ${s.scoringFactor.toFixed(2)}`, color: scoringColor },
            { label: `Weather: ${s.weatherRisk}`, color: riskColor },
            { label: `Wind: ${s.windFactor}`, color: s.windFactor === "High" ? RED : s.windFactor === "None" ? MUTED : AMBER },
            { label: `${s.elevation.toLocaleString()}ft`, color: MUTED },
          ].map(p => (
            <span key={p.label} style={{
              padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
              background: "rgba(19,35,58,0.06)", color: p.color,
            }}>{p.label}</span>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid rgba(19,35,58,0.07)", paddingTop: "1rem" }}>
          {/* Scoring factor bar */}
          <FactorBar value={s.scoringFactor} label="Scoring Factor" max={1.12} min={0.88} />

          {/* Stat grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", margin: "0.85rem 0" }}>
            {[
              { label: "Weather Risk", value: s.weatherRisk, color: riskColor },
              { label: "Wind Factor",  value: s.windFactor,  color: s.windFactor === "High" ? RED : s.windFactor === "None" ? MUTED : AMBER },
              { label: "Elevation",    value: `${s.elevation.toLocaleString()} ft`, color: NAVY },
              { label: "Surface",      value: s.surface, color: NAVY },
            ].map(d => (
              <div key={d.label} style={{ background: "rgba(19,35,58,0.04)", borderRadius: "0.5rem", padding: "0.45rem 0.65rem" }}>
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, textTransform: "uppercase" }}>{d.label}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: d.color, marginTop: 2 }}>{d.value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55, background: "rgba(19,35,58,0.03)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem" }}>
            {s.notes}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SportTab = "MLB" | "NFL";
type MlbGroup = "All" | "NL East" | "NL Central" | "NL West" | "AL East" | "AL Central" | "AL West";
type NflGroup = "All" | "AFC East" | "AFC North" | "AFC South" | "AFC West" | "NFC East" | "NFC North" | "NFC South" | "NFC West";

const MLB_DIVS: MlbGroup[] = ["All","NL East","NL Central","NL West","AL East","AL Central","AL West"];
const NFL_DIVS: NflGroup[] = ["All","AFC East","AFC North","AFC South","AFC West","NFC East","NFC North","NFC South","NFC West"];

export default function StadiumIntel({ onBack }: { onBack: () => void }) {
  const [sport, setSport] = useState<SportTab>("MLB");
  const [mlbDiv, setMlbDiv] = useState<MlbGroup>("All");
  const [nflDiv, setNflDiv] = useState<NflGroup>("All");
  const [search, setSearch] = useState("");
  const [sortMlb, setSortMlb] = useState<"name" | "hitFactor" | "hrFactor" | "elevation">("hitFactor");
  const [sortNfl, setSortNfl] = useState<"name" | "scoringFactor" | "weatherRisk" | "elevation">("scoringFactor");

  const { data, isLoading } = useQuery({
    queryKey: ["stadium-factors"],
    queryFn: () => fetch("/api/intel/stadium-factors").then(r => r.json()),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const mlbAll: MlbStadium[] = data?.mlb ?? [];
  const nflAll: NflStadium[] = data?.nfl ?? [];

  const q = search.trim().toLowerCase();

  const mlbFiltered = mlbAll
    .filter(s => mlbDiv === "All" || s.div === mlbDiv)
    .filter(s => !q || s.venue.toLowerCase().includes(q) || s.team.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sortMlb === "hitFactor")  return b.hitFactor  - a.hitFactor;
      if (sortMlb === "hrFactor")   return b.hrFactor   - a.hrFactor;
      if (sortMlb === "elevation")  return b.elevation  - a.elevation;
      return a.venue.localeCompare(b.venue);
    });

  const nflFiltered = nflAll
    .filter(s => nflDiv === "All" || s.div === nflDiv)
    .filter(s => !q || s.venue.toLowerCase().includes(q) || s.team.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q))
    .filter((s, i, arr) => arr.findIndex(x => x.venue === s.venue) === i) // dedupe SoFi
    .sort((a, b) => {
      if (sortNfl === "scoringFactor") return b.scoringFactor - a.scoringFactor;
      if (sortNfl === "weatherRisk") {
        const order = { High: 3, Moderate: 2, Low: 1, None: 0 } as Record<string, number>;
        return (order[b.weatherRisk] ?? 0) - (order[a.weatherRisk] ?? 0);
      }
      if (sortNfl === "elevation") return b.elevation - a.elevation;
      return a.venue.localeCompare(b.venue);
    });

  const scrollbarHide: React.CSSProperties = { scrollbarWidth: "none", msOverflowStyle: "none" };

  return (
    <div style={{ background: BG, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        background: NAVY, padding: "0.85rem 1rem 0",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {/* Back + title */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <button
              onClick={onBack}
              style={{ background: "rgba(246,241,231,0.12)", border: "none", borderRadius: "0.5rem", padding: "0.4rem", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <ArrowLeft size={18} color="#F6F1E7" />
            </button>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#F6F1E7", letterSpacing: "-0.02em" }}>Stadium Intel</h1>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(246,241,231,0.6)" }}>Park factors, dimensions & weather impact</p>
            </div>
          </div>

          {/* MLB / NFL tabs */}
          <div style={{ display: "flex", gap: 0 }}>
            {(["MLB", "NFL"] as SportTab[]).map(s => (
              <button
                key={s}
                onClick={() => { setSport(s); setSearch(""); }}
                style={{
                  padding: "0.5rem 1.2rem", background: "none", border: "none",
                  borderBottom: sport === s ? `2px solid ${GOLD}` : "2px solid transparent",
                  cursor: "pointer", fontSize: 13, fontWeight: sport === s ? 800 : 500,
                  color: sport === s ? "#F6F1E7" : "rgba(246,241,231,0.5)",
                  transition: "all 0.15s",
                }}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 640, margin: "0 auto", width: "100%", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>

        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "#fff", border: "1.5px solid rgba(19,35,58,0.12)",
          borderRadius: "0.85rem", padding: "0.6rem 0.9rem",
          boxShadow: "0 2px 8px rgba(19,35,58,0.05)",
        }}>
          <Search size={15} color={MUTED} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={sport === "MLB" ? "Search ballpark or team..." : "Search stadium or team..."}
            style={{ background: "none", border: "none", outline: "none", flex: 1, fontSize: 13, color: NAVY }}
          />
        </div>

        {/* Division filter */}
        <div style={{ display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: 2, ...scrollbarHide }}>
          {(sport === "MLB" ? MLB_DIVS : NFL_DIVS).map(div => {
            const active = sport === "MLB" ? mlbDiv === div : nflDiv === div;
            return (
              <button
                key={div}
                onClick={() => sport === "MLB" ? setMlbDiv(div as MlbGroup) : setNflDiv(div as NflGroup)}
                style={{
                  padding: "0.35rem 0.75rem", borderRadius: 99, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                  background: active ? NAVY : "rgba(19,35,58,0.07)",
                  color: active ? "#F6F1E7" : MUTED,
                  transition: "all 0.15s",
                }}
              >{div}</button>
            );
          })}
        </div>

        {/* Sort row */}
        {(() => {
          const mlbOpts: { key: typeof sortMlb; label: string }[] = [
            { key: "hitFactor", label: "Hit Factor" },
            { key: "hrFactor",  label: "HR Factor"  },
            { key: "elevation", label: "Elevation"  },
            { key: "name",      label: "Name"       },
          ];
          const nflOpts: { key: typeof sortNfl; label: string }[] = [
            { key: "scoringFactor", label: "Scoring"      },
            { key: "weatherRisk",   label: "Weather Risk" },
            { key: "elevation",     label: "Elevation"    },
            { key: "name",          label: "Name"         },
          ];
          const opts = sport === "MLB" ? mlbOpts : nflOpts;
          return (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: MUTED, fontWeight: 700, whiteSpace: "nowrap" }}>Sort:</span>
              <div style={{ display: "flex", gap: "0.35rem", overflowX: "auto", ...scrollbarHide }}>
                {opts.map(opt => {
                  const active = sport === "MLB" ? sortMlb === (opt.key as typeof sortMlb) : sortNfl === (opt.key as typeof sortNfl);
                  return (
                    <button
                      key={opt.key}
                      onClick={() => sport === "MLB" ? setSortMlb(opt.key as typeof sortMlb) : setSortNfl(opt.key as typeof sortNfl)}
                      style={{
                        padding: "0.3rem 0.65rem", borderRadius: 99, border: "none", cursor: "pointer",
                        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                        background: active ? GOLD : "rgba(19,35,58,0.07)",
                        color: active ? "#fff" : MUTED,
                        transition: "all 0.15s",
                      }}
                    >{opt.label}</button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Legend */}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: MUTED, fontWeight: 700 }}>FACTOR KEY:</span>
          {[
            { label: ">1.08 Hitter", color: GREEN },
            { label: "~1.00 Neutral", color: MUTED },
            { label: "<0.92 Pitcher", color: RED },
          ].map(l => (
            <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color, display: "inline-block" }} />
              <span style={{ fontSize: 10, color: l.color, fontWeight: 700 }}>{l.label}</span>
            </span>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ textAlign: "center", padding: "2rem", color: MUTED, fontSize: 13 }}>
            Loading stadium data...
          </div>
        )}

        {/* Cards */}
        {!isLoading && sport === "MLB" && mlbFiltered.map(s => (
          <MlbCard key={s.venue} s={s} />
        ))}

        {!isLoading && sport === "NFL" && nflFiltered.map(s => (
          <NflCard key={s.venue} s={s} />
        ))}

        {!isLoading && ((sport === "MLB" && mlbFiltered.length === 0) || (sport === "NFL" && nflFiltered.length === 0)) && (
          <div style={{ textAlign: "center", padding: "2rem", color: MUTED, fontSize: 13 }}>
            No stadiums match your search.
          </div>
        )}

        {/* Bottom padding */}
        <div style={{ height: "4rem" }} />
      </div>
    </div>
  );
}
