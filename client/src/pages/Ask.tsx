import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { MessageCircleQuestion, Send, Sparkles, AlertCircle, Trash2 } from "lucide-react";

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

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
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
      setHistory((prev) => [...prev, { q: trimmed, a: data.answer }]);
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
        <div className="p-4 space-y-4 min-h-[300px] max-h-[60vh] overflow-y-auto">
          {/* Empty state */}
          {history.length === 0 && !isLoading && (
            <div className="space-y-4">
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, hsl(265 35% 14%), hsl(265 35% 20%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
                  <Sparkles size={24} className="text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Ask anything about today's bets</p>
                <p className="text-xs text-muted-foreground mt-1">Uses live odds data from DraftKings, FanDuel, BetMGM & William Hill</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-2">Example questions:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSubmit(q)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
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
              {/* User */}
              <div className="flex justify-end">
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm text-foreground"
                  style={{ background: "linear-gradient(135deg, hsl(43 100% 50% / 0.15), hsl(43 100% 50% / 0.08))", border: "1px solid hsl(43 100% 50% / 0.25)" }}>
                  {item.q}
                </div>
              </div>
              {/* AI */}
              <div className="flex justify-start gap-2">
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                  style={{ background: "linear-gradient(135deg, hsl(265 35% 16%), hsl(265 35% 22%))", border: "1px solid hsl(43 100% 50% / 0.3)" }}>
                  <Sparkles size={11} className="text-primary" />
                </div>
                <div className="max-w-[88%] px-4 py-3 rounded-2xl rounded-tl-sm bg-muted/40 border border-border text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {item.a}
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
              placeholder="Ask about a player, team, or bet... (Enter to send, Shift+Enter for new line)"
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
