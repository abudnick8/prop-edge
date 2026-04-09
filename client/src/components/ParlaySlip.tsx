/**
 * ParlaySlip — floating parlay builder.
 * Appears as a fixed panel at the bottom-right of the screen.
 * Users can name the slip, set stake, see combined odds + payout, then submit.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParlaySlip } from "@/contexts/ParlaySlipContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { X, ChevronDown, ChevronUp, Trash2, Send, ListChecks, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Convert American odds to decimal
function americanToDecimal(odds: number): number {
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

// Combined American odds from an array of individual odds
function combinedAmericanOdds(oddsList: number[]): number {
  const decimal = oddsList.reduce((acc, o) => acc * americanToDecimal(o), 1);
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

const SPORT_COLOR: Record<string, string> = {
  NBA: "#fb923c", NFL: "#f87171", MLB: "#60a5fa", NHL: "#22d3ee",
};

export default function ParlaySlip() {
  const { isOpen, legs, toggleSlip, closeSlip, removeLeg, clearSlip } = useParlaySlip();
  const { isLoggedIn, token } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [stake, setStake] = useState("");
  const [notes, setNotes] = useState("");

  const validOdds = legs.filter(l => l.odds != null).map(l => l.odds as number);
  const combined = validOdds.length >= 2 ? combinedAmericanOdds(validOdds) : null;
  const stakeNum = parseFloat(stake) || 0;
  const payout = combined && stakeNum > 0
    ? (stakeNum * americanToDecimal(combined)).toFixed(2)
    : null;

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/parlays", {
        name: name || `Parlay ${new Date().toLocaleDateString()}`,
        stake: stakeNum || null,
        notes: notes || null,
        combinedOdds: combined,
        potentialPayout: payout ? parseFloat(payout) : null,
        legs: legs.map(l => ({
          betId: l.betId,
          betSlug: l.betSlug,
          betTitle: l.betTitle,
          betSport: l.betSport,
          betLine: l.betLine,
          betPickSide: l.betPickSide,
          odds: l.odds,
        })),
      }, token),
    onSuccess: () => {
      toast({ title: "Parlay saved!", description: `"${name || "Parlay"}" added to your portfolio.` });
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      clearSlip();
      setName("");
      setStake("");
      setNotes("");
      closeSlip();
    },
    onError: () => {
      toast({ title: "Error", description: "Could not save parlay. Please try again.", variant: "destructive" });
    },
  });

  if (legs.length === 0 && !isOpen) return null;

  return (
    <div
      className="fixed bottom-20 md:bottom-6 right-4 z-50 w-80 rounded-2xl shadow-2xl overflow-hidden"
      style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgba(15,15,20,0.97)", backdropFilter: "blur(16px)" }}
      data-testid="parlay-slip"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}
        onClick={toggleSlip}
      >
        <div className="flex items-center gap-2">
          <ShoppingCart size={15} style={{ color: "#f59e0b" }} />
          <span className="text-sm font-bold" style={{ color: "#f59e0b" }}>Parlay Slip</span>
          {legs.length > 0 && (
            <span
              className="text-[11px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: "#f59e0b", color: "#000" }}
            >
              {legs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {legs.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); clearSlip(); }}
              className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
              data-testid="parlay-slip-clear"
            >
              Clear
            </button>
          )}
          {isOpen ? <ChevronDown size={15} className="text-muted-foreground" /> : <ChevronUp size={15} className="text-muted-foreground" />}
        </div>
      </div>

      {/* Body (collapsible) */}
      {isOpen && (
        <div className="p-4 space-y-3">
          {legs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Add picks from any bet card to build your parlay.
            </p>
          ) : (
            <>
              {/* Legs list */}
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {legs.map(leg => (
                  <div
                    key={leg.betId}
                    className="flex items-start gap-2 rounded-lg px-3 py-2"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: "hsl(45 100% 90%)" }}>
                        {leg.betTitle}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {leg.betSport && (
                          <span className="text-[10px] font-bold" style={{ color: SPORT_COLOR[leg.betSport] ?? "#a78bfa" }}>
                            {leg.betSport}
                          </span>
                        )}
                        {leg.betPickSide && (
                          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                            {leg.betPickSide}{leg.betLine != null ? ` ${leg.betLine}` : ""}
                          </span>
                        )}
                        {leg.odds != null && (
                          <span className="text-[10px] font-mono font-bold ml-auto" style={{ color: "#4ade80" }}>
                            {leg.odds > 0 ? `+${leg.odds}` : leg.odds}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeLeg(leg.betId)}
                      className="text-muted-foreground hover:text-red-400 transition-colors mt-0.5"
                      data-testid={`parlay-remove-${leg.betId}`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Combined odds + payout preview */}
              {combined !== null && (
                <div
                  className="rounded-lg px-3 py-2 flex items-center justify-between"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
                >
                  <span className="text-xs text-muted-foreground">Combined odds</span>
                  <span className="text-sm font-black font-mono" style={{ color: "#f59e0b" }}>
                    {combined > 0 ? `+${combined}` : combined}
                  </span>
                </div>
              )}

              {/* Form */}
              <div className="space-y-2">
                <Input
                  placeholder="Slip name (optional)"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="h-8 text-xs"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  data-testid="parlay-name-input"
                />
                <Input
                  type="number"
                  placeholder="Stake ($)"
                  value={stake}
                  onChange={e => setStake(e.target.value)}
                  className="h-8 text-xs"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  data-testid="parlay-stake-input"
                />
                {payout && (
                  <div className="text-[11px] text-right" style={{ color: "#4ade80" }}>
                    Potential payout: <span className="font-bold">${payout}</span>
                  </div>
                )}
              </div>

              {/* Submit */}
              {!isLoggedIn ? (
                <p className="text-xs text-center text-muted-foreground">
                  <a href="/#/auth" style={{ color: "#f59e0b" }}>Sign in</a> to save parlays.
                </p>
              ) : (
                <Button
                  className="w-full h-8 text-xs font-bold"
                  style={{ background: "#f59e0b", color: "#000" }}
                  disabled={legs.length < 2 || submitMutation.isPending}
                  onClick={() => submitMutation.mutate()}
                  data-testid="parlay-submit-btn"
                >
                  {submitMutation.isPending ? "Saving..." : `Save Parlay (${legs.length} legs)`}
                </Button>
              )}
              {legs.length < 2 && (
                <p className="text-[10px] text-center text-muted-foreground">Add at least 2 legs to submit.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
