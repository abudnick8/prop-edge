import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { MessageCircleQuestion, Send, Sparkles, AlertCircle, Trash2, TrendingUp, ChevronRight } from "lucide-react";
import { Link } from "wouter";

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
  "Should I bet on LeBron over 25.5 points tonight?",
  "Is the Yankees moneyline a good bet?",
  "Best NBA player prop tonight?",
  "Should I bet the over on the Chiefs game?",
  "Any high confidence MLB props today?",
  "Good NHL goals props tonight?",
  "Is Shohei Ohtani HR prop worth betting?",
  "Top 3 highest confidence bets right now?",
];

function ConfBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 80 ? "bg-green-500/15 text-green-400 border-green-500/30"
    : score >= 65 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${color}`}>
      {score}/100
    </span>
  );
}

function RelatedBetCard({ bet }: { bet: RelatedBet }) {
  const fmtOdds = (n: number | null) => n == null ? null : (n > 0 ? `+${n}` : `${n}`);
  const matchup = bet.awayTeam && bet.homeTeam ? `${bet.awayTeam} @ ${bet.homeTeam}` : null;
  const conf = bet.confidenceScore ?? 0;
  const verdict = conf >= 80 ? "✅ Strong" : conf >= 65 ? "⚠️ Moderate" : "❌ Low";
  const riskColor = bet.riskLevel === "low" ? "text-green-400" : bet.riskLevel === "high" ? "text-red-400" : "text-yellow-400";

  return (
    <Link href={`/bets/${bet.id}`}>
      <a className="block p-3 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/30 transition-all group">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{bet.sport}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                {bet.betType === "player_prop" ? "PROP" : bet.betType?.toUpperCase()}
              </span>
              <ConfBadge score={bet.confidenceScore} />
              {bet.similarityReason && bet.similarityReason !== "direct match" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-primary/8 text-primary/70 border-primary/20 italic">
                  {bet.similarityReason}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight truncate">{bet.title}</p>
            {bet.playerName && <p className="text-xs text-muted-foreground mt-0.5">{bet.playerName}</p>}
            {matchup && <p className="text-xs text-muted-foreground mt-0.5">{matchup}</p>}
          </div>
          <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary flex-shrink-0 mt-1 transition-colors" />
        </div>

        {/* Odds row */}
        {(bet.line != null || bet.overOdds != null) && (
          <div className="flex items-center gap-3 text-xs mb-2">
            {bet.line != null && <span className="text-muted-foreground">Line: <span className="text-foreground font-mono">{bet.line}</span></span>}
            {bet.overOdds != null && <span className="text-muted-foreground">Over: <span className="text-foreground font-mono">{fmtOdds(bet.overOdds)}</span></span>}
            {bet.underOdds != null && <span className="text-muted-foreground">Under: <span className="text-foreground font-mono">{fmtOdds(bet.underOdds)}</span></span>}
          </div>
        )}

        {/* Bottom row */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{verdict}</span>
          <div className="flex items-center gap-2">
            {bet.riskLevel && <span className={`text-xs font-medium ${riskColor}`}>{bet.riskLevel} risk</span>}
            {bet.recommendedAllocation != null && (
              <span className="text-[10px] text-muted-foreground">{bet.recommendedAllocation}% bankroll</span>
            )}
          </div>
        </div>

        {/* Key factors */}
        {bet.keyFactors?.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed line-clamp-1">
            {bet.keyFactors[0]}
          </p>
        )}
      </a>
    </Link>
  );
}

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <MessageCircleQuestion size={20} className="text-primary" />
            Ask PropEdge
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">AI</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ask about any player, team, or bet — analyzed using live odds, confidence scores & stats
          </p>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => { setHistory([]); setError(null); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded-lg hover:bg-accent transition-colors"
          >
            <Trash2 size={12} />
            Clear
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="p-4 space-y-5 min-h-[300px] max-h-[70vh] overflow-y-auto">

          {/* Empty state */}
          {history.length === 0 && !isLoading && (
            <div className="space-y-4">
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, hsl(265 35% 14%), hsl(265 35% 20%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
                  <Sparkles size={24} className="text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Ask anything about today's bets</p>
                <p className="text-xs text-muted-foreground mt-1">Uses live odds from DraftKings, FanDuel, BetMGM & William Hill</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-2">Try asking:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button key={q} onClick={() => handleSubmit(q)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors text-left">
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
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm text-foreground"
                  style={{ background: "linear-gradient(135deg, hsl(43 100% 50% / 0.15), hsl(43 100% 50% / 0.08))", border: "1px solid hsl(43 100% 50% / 0.25)" }}>
                  {item.q}
                </div>
              </div>

              {/* AI answer bubble */}
              <div className="flex justify-start gap-2">
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                  style={{ background: "linear-gradient(135deg, hsl(265 35% 16%), hsl(265 35% 22%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
                  <Sparkles size={11} className="text-primary" />
                </div>
                <div className="flex-1 max-w-[90%] space-y-3">
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/40 border border-border text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {item.a}
                  </div>

                  {/* Related bets */}
                  {item.relatedBets?.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={12} className="text-primary" />
                        <p className="text-xs font-semibold text-foreground">
                          Similar bets — same player, team, or bet type
                        </p>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                          {item.relatedBets.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {item.relatedBets.map((bet) => (
                          <RelatedBetCard key={bet.id} bet={bet} />
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
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(265 35% 16%), hsl(265 35% 22%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
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
        <div className="border-t border-border p-4">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a player, team, or bet... (Enter to send)"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
              data-testid="input-ask-question"
              disabled={isLoading}
            />
            <button
              onClick={() => handleSubmit(question)}
              disabled={!question.trim() || isLoading}
              data-testid="button-ask-submit"
              className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all"
              style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)", boxShadow: question.trim() ? "0 0 16px rgba(245,158,11,0.35)" : "none" }}
            >
              <Send size={15} style={{ color: "#1a0d00" }} />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Analyzes live bet data · Not financial advice · Always bet responsibly
          </p>
        </div>
      </div>
    </div>
  );
}
