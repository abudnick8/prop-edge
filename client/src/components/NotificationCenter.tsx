import { useState, useEffect } from "react";
import { Bell, X, ChevronRight } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Notification } from "@shared/schema";
import { Link } from "wouter";

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [bellClass, setBellClass] = useState("");

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 15000,
  });

  const unread = notifications.filter((n) => !n.dismissed);

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/notifications/${id}/dismiss`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const clearAllMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/notifications"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  // Ring bell when new notifications arrive
  useEffect(() => {
    if (unread.length > 0) {
      setBellClass("bell-ring");
      const t = setTimeout(() => setBellClass(""), 900);
      return () => clearTimeout(t);
    }
  }, [unread.length]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`relative p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground ${bellClass}`}
        data-testid="notification-bell"
      >
        <Bell size={18} />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-96 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <p className="font-semibold text-sm text-foreground">Alerts</p>
                <p className="text-xs text-muted-foreground">{unread.length} high-confidence picks found</p>
              </div>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={() => clearAllMutation.mutate()}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No alerts yet — scanner will notify you when picks hit 80+
                </div>
              ) : (
                notifications.slice(0, 15).map((n) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b border-border last:border-0 flex items-start gap-3 ${
                      n.dismissed ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center mt-0.5">
                      <span className="text-primary text-xs font-bold font-mono">{n.confidenceScore}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground leading-snug">{n.message}</p>
                      <Link href={`/bets/${n.betId}`}>
                        <a className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-1">
                          View pick <ChevronRight size={10} />
                        </a>
                      </Link>
                    </div>
                    {!n.dismissed && (
                      <button
                        onClick={() => dismissMutation.mutate(n.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
