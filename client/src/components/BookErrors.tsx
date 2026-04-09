/**
 * BookErrors — shared types, hook, card, and section component.
 * Used by Dashboard, AllBets, and LineMovement pages.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertTriangle, AlertCircle, Target, Lightbulb, BookOpen,
  TrendingDown, DollarSign, Clock, ChevronDown, ChevronUp, ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookError {
  id: string;
  gameId: string;
  gameName: string;
  sport: string;
  gameTime: string | null;
  errorType:
    | "mispriced_spread"
    | "mispriced_total"
    | "mispriced_ml"
    | "reverse_line_movement"
    | "sharp_divergence"
    | "stale_line";
  betType: string;
  actualLine: string;
  mistake: string;
  correctLine: string;
  betIdea: string;
  confidence: number;
  severity: "high" | "medium" | "low";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBookErrors(enabled = true) {
  return useQuery<BookError[]>({
    queryKey: ["/api/line-movement/errors"],
    queryFn: () =>
      apiRequest("GET", "/api/line-movement/errors").then((r) => r.json()),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 9 * 60 * 1000,
    enabled,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ERROR_TYPE_LABELS: Record<string, string> = {
  mispriced_spread: "Mispriced Spread",
  mispriced_total: "Mispriced Total",
  mispriced_ml: "Mispriced Moneyline",
  reverse_line_movement: "Reverse Line Movement",
  sharp_divergence: "Sharp / Public Split",
  stale_line: "Stale Line",
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// ── BookErrorCard ─────────────────────────────────────────────────────────────

export function BookErrorCard({ error }: { error: BookError }) {
  const [open, setOpen] = useState(false);

  const sevStyle =
    error.severity === "high"
      ? {
          border: "border-red-500/40",
          innerBg: "bg-red-500/8",
          badge: "bg-red-500/15 text-red-700 border-red-500/30",
          glow: "shadow-[0_0_10px_rgba(248,113,113,0.1)]",
        }
      : {
          border: "border-amber-500/30",
          innerBg: "bg-amber-500/5",
          badge: "bg-amber-500/12 text-amber-800 border-amber-500/25",
          glow: "",
        };

  const confColor =
    error.confidence >= 80
      ? "#4ade80"
      : error.confidence >= 65
      ? "#f59e0b"
      : "rgba(255,255,255,0.4)";

  const errIcon =
    error.errorType === "reverse_line_movement" ? (
      <TrendingDown size={11} />
    ) : error.errorType === "stale_line" ? (
      <Clock size={11} />
    ) : error.errorType === "sharp_divergence" ? (
      <DollarSign size={11} />
    ) : (
      <Target size={11} />
    );

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-all bg-card ${sevStyle.border} ${sevStyle.glow}`}
    >
      {/* Collapsed header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/20 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`book-error-${error.id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ShieldAlert
            size={15}
            className={
              error.severity === "high"
                ? "text-red-700 flex-shrink-0"
                : "text-amber-800 flex-shrink-0"
            }
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-foreground truncate">
                {error.gameName}
              </span>
              <span className="text-[10px] text-muted-foreground/50">
                {error.sport}
              </span>
              {error.gameTime && (
                <span className="text-[10px] text-muted-foreground/40">
                  {fmtTime(error.gameTime)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge
                className={`text-[9px] px-1.5 py-0.5 font-bold gap-1 inline-flex items-center ${sevStyle.badge}`}
              >
                {errIcon}
                <span>{ERROR_TYPE_LABELS[error.errorType]}</span>
              </Badge>
              <span className="text-[10px] text-muted-foreground/70">
                {error.betType}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
              Confidence
            </p>
            <p
              className="text-sm font-bold font-mono"
              style={{ color: confColor }}
            >
              {error.confidence}
            </p>
          </div>
          {open ? (
            <ChevronUp size={14} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded detail drawer */}
      {open && (
        <div
          className={`border-t ${sevStyle.border} ${sevStyle.innerBg} px-4 py-4 space-y-4 animate-in slide-in-from-top-2 duration-200`}
        >
          {/* The Bet */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <BookOpen size={10} className="text-blue-400" /> The Bet
            </p>
            <p className="text-xs font-mono font-bold text-foreground">
              {error.actualLine}
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              {error.betType}
            </p>
          </div>

          {/* The Mistake */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle size={10} className="text-orange-700" /> The
              Mistake
            </p>
            <p className="text-xs text-foreground/90 leading-relaxed">
              {error.mistake}
            </p>
          </div>

          {/* What It Should Be */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Target size={10} className="text-indigo-400" /> What It Should Be
            </p>
            <p className="text-xs text-foreground/80 leading-relaxed">
              {error.correctLine}
            </p>
          </div>

          {/* How to Profit */}
          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2.5 space-y-1">
            <p className="text-[10px] font-bold text-green-800 uppercase tracking-wider flex items-center gap-1">
              <Lightbulb size={10} /> How to Profit
            </p>
            <p className="text-xs text-foreground/90 leading-relaxed">
              {error.betIdea}
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1 border-t border-border/40">
            <p className="text-[9px] text-muted-foreground/40">
              Confidence:{" "}
              <span
                style={{ color: confColor }}
                className="font-bold font-mono"
              >
                {error.confidence}/100
              </span>
              &nbsp;&middot;&nbsp;Always verify lines at DraftKings, FanDuel
              &amp; BetMGM before placing
            </p>
            <Badge className={`text-[9px] px-1.5 py-0.5 ${sevStyle.badge}`}>
              {error.severity.toUpperCase()}
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BookErrorsSection ─────────────────────────────────────────────────────────
// Drop-in section shown when the "Book Errors" filter is active

export function BookErrorsSection({ errors }: { errors: BookError[] }) {
  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <AlertCircle size={14} className="text-orange-700" />
        <h2 className="text-sm font-bold text-foreground">
          Book Errors &amp; Mispriced Lines
        </h2>
        <span className="text-xs text-muted-foreground font-mono">
          {errors.length} detected
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Disclaimer */}
      <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-[11px] text-muted-foreground/70 flex items-start gap-2">
        <AlertTriangle size={11} className="text-orange-700 mt-0.5 flex-shrink-0" />
        <span>
          These signals are detected from sharp vs. public splits, reverse line
          movement, and cross-market inconsistencies. Always verify the current
          line at DraftKings, FanDuel, or BetMGM before placing.{" "}
          <span className="text-muted-foreground/50">Not financial advice.</span>
        </span>
      </div>

      {/* Cards or empty state */}
      {errors.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-xl">
          <AlertCircle
            size={28}
            className="mx-auto text-muted-foreground/30 mb-2"
          />
          <p className="text-sm text-muted-foreground">
            No book errors detected right now
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Errors appear when sharp/public data diverges significantly. Try
            refreshing.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((err) => (
            <BookErrorCard key={err.id} error={err} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── BookErrorsFilterButton ─────────────────────────────────────────────────────
// Reusable filter button that can drop in to any filter bar

export function BookErrorsFilterButton({
  active,
  count,
  onClick,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
        active
          ? "bg-orange-500/10 text-orange-700 border-orange-500/30"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
      data-testid="filter-book-errors"
    >
      <ShieldAlert size={11} />
      Book Errors
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active
              ? "bg-orange-500/25 text-orange-300"
              : "bg-orange-500/15 text-orange-700"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
