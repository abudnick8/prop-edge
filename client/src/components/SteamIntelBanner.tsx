/**
 * SteamIntelBanner — Auto-fires when a steam move, RLM, or book error is
 * detected on a line movement game card.
 *
 * Fetches /api/line-movement/intel/:gameId and renders a compact, scannable
 * alert showing WHY the line moved: injuries, sharp money, weather, news.
 * No click required — shows automatically when triggered.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ExternalLink, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntelReason {
  icon: string;
  type: string;
  text: string;
  severity: "high" | "medium" | "low";
}

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
}

interface IntelData {
  gameId: string;
  gameName: string;
  sport: string;
  triggerType: string;
  triggerLabel: string;
  isSteam: boolean;
  isRLM: boolean;
  isSharpDiv: boolean;
  headline: string;
  reasons: IntelReason[];
  relevantNews: NewsItem[];
  injuries: { player: string; status: string; team: string }[];
  weather: string | null;
  analyzedAt: string;
  cached?: boolean;
}

// ── Severity colors ────────────────────────────────────────────────────────────
const SEV_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  high:   { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.30)", text: "#f87171" },
  medium: { bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.30)",  text: "#fbbf24" },
  low:    { bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.20)", text: "#94a3b8" },
};

const TRIGGER_STYLE: Record<string, { bg: string; border: string; accent: string; label: string }> = {
  steam:     { bg: "rgba(248,113,113,0.07)", border: "rgba(248,113,113,0.35)", accent: "#f87171", label: "🔥 STEAM MOVE" },
  rlm:       { bg: "rgba(167,139,250,0.07)", border: "rgba(167,139,250,0.35)", accent: "#a78bfa", label: "↩ REVERSE LINE" },
  sharp_div: { bg: "rgba(251,191,36,0.07)",  border: "rgba(251,191,36,0.35)",  accent: "#fbbf24", label: "💰 SHARP SPLIT" },
  ml_move:   { bg: "rgba(96,165,250,0.07)",  border: "rgba(96,165,250,0.35)",  accent: "#60a5fa", label: "📈 ML MOVE" },
  line_alert:{ bg: "rgba(251,191,36,0.07)",  border: "rgba(251,191,36,0.35)",  accent: "#fbbf24", label: "⚡ LINE ALERT" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

function fmtPubDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return ""; }
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SteamIntelBannerProps {
  gameId: string;
  /** Whether a steam/RLM/book-error was detected (controls auto-fetch) */
  triggered: boolean;
}

export function SteamIntelBanner({ gameId, triggered }: SteamIntelBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError } = useQuery<IntelData>({
    queryKey: ["/api/line-movement/intel", gameId],
    queryFn: () =>
      fetch(`/api/line-movement/intel/${encodeURIComponent(gameId)}`)
        .then(r => { if (!r.ok) throw new Error("intel fetch failed"); return r.json(); }),
    enabled: triggered,
    staleTime: 14 * 60 * 1000,  // match server 15-min cache
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
  });

  if (!triggered) return null;

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="mx-4 mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 flex items-center gap-2">
        <Loader2 size={12} className="text-amber-400 animate-spin flex-shrink-0" />
        <span className="text-[11px] text-amber-400/80 font-medium">Analyzing line movement...</span>
      </div>
    );
  }

  if (isError || !data) return null;

  // No useful intel found (no reasons)
  if (!data.reasons || data.reasons.length === 0) return null;

  const style = TRIGGER_STYLE[data.triggerType] ?? TRIGGER_STYLE.line_alert;
  const highReasons   = data.reasons.filter(r => r.severity === "high");
  const otherReasons  = data.reasons.filter(r => r.severity !== "high");
  const hasNews       = data.relevantNews && data.relevantNews.length > 0;

  return (
    <div
      className="mx-4 mb-3 rounded-xl border overflow-hidden"
      style={{ background: style.bg, borderColor: style.border }}
    >
      {/* Header row — always visible */}
      <button
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          {/* Trigger badge */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span
              className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: `${style.accent}20`, color: style.accent, border: `1px solid ${style.accent}40` }}
            >
              {style.label}
            </span>
            <span className="text-[9px] text-muted-foreground">
              Analyzed {fmtTime(data.analyzedAt)}
            </span>
          </div>
          {/* Top high-severity reason (always shown) */}
          {highReasons.slice(0, 1).map((r, i) => (
            <p key={i} className="text-[12px] font-semibold text-foreground leading-snug">
              <span className="mr-1">{r.icon}</span>
              {r.text}
            </p>
          ))}
          {/* If no high reasons, show the first medium one */}
          {highReasons.length === 0 && otherReasons.slice(0, 1).map((r, i) => (
            <p key={i} className="text-[12px] font-semibold text-foreground leading-snug">
              <span className="mr-1">{r.icon}</span>
              {r.text}
            </p>
          ))}
        </div>
        <div className="flex-shrink-0 mt-0.5 text-muted-foreground">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t" style={{ borderColor: style.border }}>

          {/* All reasons */}
          {data.reasons.length > 1 && (
            <div className="pt-2 space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                Intel Breakdown
              </p>
              {data.reasons.map((r, i) => {
                const s = SEV_STYLE[r.severity];
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg px-2.5 py-1.5"
                    style={{ background: s.bg, border: `1px solid ${s.border}` }}
                  >
                    <span className="text-base leading-none flex-shrink-0 mt-0.5">{r.icon}</span>
                    <p className="text-[11px] text-foreground leading-snug">{r.text}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Relevant news */}
          {hasNews && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
                📰 Related News
              </p>
              <div className="space-y-1.5">
                {data.relevantNews.slice(0, 4).map((n, i) => (
                  <a
                    key={i}
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-1.5 group"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-foreground/90 leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {n.title}
                      </p>
                      {n.pubDate && (
                        <p className="text-[9px] text-muted-foreground mt-0.5">{fmtPubDate(n.pubDate)}</p>
                      )}
                    </div>
                    <ExternalLink size={10} className="flex-shrink-0 mt-0.5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Weather */}
          {data.weather && (
            <div
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)" }}
            >
              <span className="text-base">🌤</span>
              <p className="text-[11px] text-foreground/90">{data.weather}</p>
            </div>
          )}

          {/* No news fallback */}
          {!hasNews && data.reasons.length <= 1 && (
            <p className="text-[11px] text-muted-foreground pt-1">
              No additional news found for this matchup. The line movement appears to be driven by sharp money flow.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
