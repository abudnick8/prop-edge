/**
 * ParlaySlipContext — global floating parlay slip state.
 * Any component can call useParlaySlip() to add/remove legs or open/close the slip.
 */
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface ParlaySlipLeg {
  betId: string;
  betSlug?: string;
  betTitle: string;
  betSport?: string;
  betLine?: number | null;
  betPickSide?: string;
  odds?: number | null;
}

interface ParlaySlipContextValue {
  isOpen: boolean;
  legs: ParlaySlipLeg[];
  openSlip: () => void;
  closeSlip: () => void;
  toggleSlip: () => void;
  addLeg: (leg: ParlaySlipLeg) => void;
  removeLeg: (betId: string) => void;
  clearSlip: () => void;
  hasLeg: (betId: string) => boolean;
}

const ParlaySlipContext = createContext<ParlaySlipContextValue | null>(null);

export function ParlaySlipProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [legs, setLegs] = useState<ParlaySlipLeg[]>([]);

  const openSlip = useCallback(() => setIsOpen(true), []);
  const closeSlip = useCallback(() => setIsOpen(false), []);
  const toggleSlip = useCallback(() => setIsOpen(v => !v), []);

  const addLeg = useCallback((leg: ParlaySlipLeg) => {
    setLegs(prev => {
      if (prev.some(l => l.betId === leg.betId)) return prev;
      return [...prev, leg];
    });
    setIsOpen(true);
  }, []);

  const removeLeg = useCallback((betId: string) => {
    setLegs(prev => prev.filter(l => l.betId !== betId));
  }, []);

  const clearSlip = useCallback(() => setLegs([]), []);
  const hasLeg = useCallback((betId: string) => legs.some(l => l.betId === betId), [legs]);

  return (
    <ParlaySlipContext.Provider value={{ isOpen, legs, openSlip, closeSlip, toggleSlip, addLeg, removeLeg, clearSlip, hasLeg }}>
      {children}
    </ParlaySlipContext.Provider>
  );
}

export function useParlaySlip() {
  const ctx = useContext(ParlaySlipContext);
  if (!ctx) throw new Error("useParlaySlip must be used inside ParlaySlipProvider");
  return ctx;
}
