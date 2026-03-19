/**
 * PickDetail — full-page view for a single pick or lotto card.
 * Accessible at /#/picks/:slug  and  /#/lotto/:slug
 *
 * Re-uses the BetDetail page logic but resolves via slug instead of ID.
 */

import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Bet } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import BetDetail from "@/pages/BetDetail";

export default function PickDetail() {
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const slug = params.slug;

  const { data: bet, isLoading, isError } = useQuery<Bet>({
    queryKey: ["/api/bets/by-slug", slug],
    queryFn: () =>
      apiRequest("GET", `/api/bets/by-slug/${encodeURIComponent(slug!)}`)
        .then((r) => r.json()),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !bet) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-sm text-muted-foreground">Pick not found.</p>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ArrowLeft size={13} /> Back to dashboard
        </button>
      </div>
    );
  }

  // Render the full BetDetail page — it reads :id from params, so we inject
  // by passing the resolved bet ID into the URL
  // Simpler: just render BetDetail with the real ID in the URL via redirect
  // We redirect hash to /bets/:id so BetDetail handles it natively
  window.location.hash = `#/bets/${encodeURIComponent(bet.id)}`;
  return null;
}
