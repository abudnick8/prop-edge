import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageCircleQuestion, Send, Sparkles, AlertCircle,
  Trash2, TrendingUp, ChevronRight, X,
} from "lucide-react";
import { Link } from "wouter";

// ── Types (mirrored from Ask.tsx) ─────────────────────────────────────────────
interface RelatedBet {
  id: string;
  title: string;
  sport: string;
  betType: string;
  playerName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  confidenceScore: number | null;
  riskLevel: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  recommendedAllocation: number | null;
  keyFactors: string[];
  gameTime: string | null;
  similarityReason?: string;
}

interface HistoryItem {
  q: string;
  a: string;
  relatedBets: RelatedBet[];
}

const EXAMPLE_QUESTIONS = [
  "Best NBA player prop tonight?",
  "Should I bet on LeBron over 25.5 pts?",
  "Top 3 highest confidence bets?",
  "Any high confidence MLB props today?",
  "Good NHL goals props tonight?",
  "Is Shohei Ohtani HR prop worth betting?",
];

function ConfBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color =
    score >= 80
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : score >= 65
      ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${color}`}>
      {score}/100
    </span>
  );
}

function RelatedBetCard({ bet, onClose }: { bet: RelatedBet; onClose: () => void }) {
  const fmtOdds = (n: number | null) => (n == null ? null : n > 0 ? `+${n}` : `${n}`);
  const matchup = bet.awayTeam && bet.homeTeam ? `${bet.awayTeam} @ ${bet.homeTeam}` : null;
  const conf = bet.confidenceScore ?? 0;
  const verdict = conf >= 85 ? "✅ Strong" : conf >= 70 ? "⚠️ Moderate" : "❌ Low";
  const riskColor =
    bet.riskLevel === "low"
      ? "text-green-400"
      : bet.riskLevel === "high"
      ? "text-red-400"
      : "text-yellow-400";

  return (
    <Link href={`/bets/${bet.id}`} onClick={onClose}>
      <a className="block p-3 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/30 transition-all group">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {bet.sport}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                {bet.betType === "player_prop" ? "PROP" : bet.betType?.toUpperCase()}
              </span>
              <ConfBadge score={bet.confidenceScore} />
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight truncate">{bet.title}</p>
            {bet.playerName && <p className="text-xs text-muted-foreground mt-0.5">{bet.playerName}</p>}
            {matchup && <p className="text-xs text-muted-foreground mt-0.5">{matchup}</p>}
          </div>
          <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary flex-shrink-0 mt-1 transition-colors" />
        </div>
        {(bet.line != null || bet.overOdds != null) && (
          <div className="flex items-center gap-3 text-xs mb-2">
            {bet.line != null && <span className="text-muted-foreground">Line: <span className="text-foreground font-mono">{bet.line}</span></span>}
            {bet.overOdds != null && <span className="text-muted-foreground">Over: <span className="text-foreground font-mono">{fmtOdds(bet.overOdds)}</span></span>}
            {bet.underOdds != null && <span className="text-muted-foreground">Under: <span className="text-foreground font-mono">{fmtOdds(bet.underOdds)}</span></span>}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{verdict}</span>
          <div className="flex items-center gap-2">
            {bet.riskLevel && <span className={`text-xs font-medium ${riskColor}`}>{bet.riskLevel} risk</span>}
            {bet.recommendedAllocation != null && (
              <span className="text-[10px] text-muted-foreground">{bet.recommendedAllocation}% bankroll</span>
            )}
          </div>
        </div>
        {bet.keyFactors?.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed line-clamp-1">
            {bet.keyFactors[0]}
          </p>
        )}
      </a>
    </Link>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────
export default function AskDrawer() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const handleSubmit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || isLoading) return;
    setQuestion("");
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/ask", { question: trimmed });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHistory((prev) => [...prev, { q: trimmed, a: data.answer, relatedBets: data.relatedBets ?? [] }]);
    } catch (e: any) {
      setError(e.message ?? "Failed to get analysis");
    } finally {
      setIsLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(question);
    }
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="relative p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="Ask AI"
        data-testid="ask-ai-button"
      >
        <MessageCircleQuestion size={18} />
        {/* AI badge dot */}
        <span
          className="absolute -top-0.5 -right-0.5 w-[14px] h-[14px] rounded-full flex items-center justify-center text-[7px] font-black"
          style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)", color: "#1a0d00" }}
        >
          AI
        </span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-up drawer panel */}
      <div
        className={`fixed z-50 bg-card border border-border shadow-2xl transition-all duration-300 ease-out
          /* Mobile: full-width slide up from bottom */
          bottom-0 left-0 right-0 rounded-t-2xl
          /* Desktop: fixed right panel */
          md:bottom-auto md:top-14 md:right-4 md:left-auto md:w-[420px] md:rounded-xl md:max-h-[calc(100vh-80px)]
          ${open ? "translate-y-0 opacity-100" : "translate-y-full md:translate-y-2 opacity-0 pointer-events-none"}
        `}
        style={{ maxHeight: open ? "90dvh" : undefined }}
      >
        {/* Drag handle (mobile only) */}
        <div className="md:hidden flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsl(265 35% 16%), hsl(265 35% 24%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}
            >
              <Sparkles size={13} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-tight">Ask PropEdge</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Live odds · confidence scores · stats</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={() => { setHistory([]); setError(null); }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Clear chat"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div
          className="p-4 space-y-4 overflow-y-auto"
          style={{ minHeight: 200, maxHeight: "calc(90dvh - 180px)" }}
        >
          {/* Empty state */}
          {history.length === 0 && !isLoading && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <p className="text-sm font-semibold text-foreground">Ask anything about today's bets</p>
                <p className="text-xs text-muted-foreground mt-1">Live odds · DraftKings · FanDuel · BetMGM</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-2">Try asking:</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSubmit(q)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Conversation */}
          {history.map((item, i) => (
            <div key={i} className="space-y-3">
              {/* User bubble */}
              <div className="flex justify-end">
                <div
                  className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm text-sm text-foreground"
                  style={{
                    background: "linear-gradient(135deg, hsl(43 100% 50% / 0.15), hsl(43 100% 50% / 0.08))",
                    border: "1px solid hsl(43 100% 50% / 0.25)",
                  }}
                >
                  {item.q}
                </div>
              </div>

              {/* AI answer bubble */}
              <div className="flex justify-start gap-2">
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                  style={{ background: "linear-gradient(135deg, hsl(265 35% 16%), hsl(265 35% 22%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}
                >
                  <Sparkles size={11} className="text-primary" />
                </div>
                <div className="flex-1 max-w-[90%] space-y-2">
                  <div className="px-3.5 py-3 rounded-2xl rounded-tl-sm bg-muted/40 border border-border text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {item.a}
                  </div>

                  {/* Related bets */}
                  {item.relatedBets?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={11} className="text-primary" />
                        <p className="text-xs font-semibold text-foreground">Related picks</p>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                          {item.relatedBets.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {item.relatedBets.map((bet) => (
                          <RelatedBetCard key={bet.id} bet={bet} onClose={() => setOpen(false)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(265 35% 16%), hsl(265 35% 22%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}
              >
                <Sparkles size={11} className="text-primary animate-pulse" />
              </div>
              <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/40 border border-border">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-xl text-sm text-destructive">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))" }}>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a player, team, or bet..."
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
              data-testid="ask-drawer-input"
              disabled={isLoading}
            />
            <button
              onClick={() => handleSubmit(question)}
              disabled={!question.trim() || isLoading}
              data-testid="ask-drawer-submit"
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all"
              style={{
                background: "linear-gradient(135deg, #b45309, #f59e0b)",
                boxShadow: question.trim() ? "0 0 14px rgba(245,158,11,0.4)" : "none",
              }}
            >
              <Send size={14} style={{ color: "#1a0d00" }} />
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground mt-1.5">
            Analyzes live bet data · Not financial advice
          </p>
        </div>
      </div>
    </>
  );
}
