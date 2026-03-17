import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ClvLine, ClvAlert, ClvSnapshot } from "@shared/schema";
import {
  TrendingUp, TrendingDown, Minus, Bell, BellOff, Plus, Trash2,
  RefreshCw, ChevronDown, ChevronUp, Activity, BarChart2, Filter,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle, Clock,
  Settings2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatOdds(o: number | null | undefined): string {
  if (o == null) return "—";
  return o > 0 ? `+${o}` : String(o);
}

function impliedProb(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function clvPctLabel(delta: number | null | undefined): string {
  if (delta == null) return "—";
  const pct = (delta * 100).toFixed(1);
  return delta >= 0 ? `+${pct}%` : `${pct}%`;
}

function sharpnessBadge(score: number | null | undefined) {
  if (score == null) return null;
  if (score >= 75) return { label: "Sharp", color: "#4ade80" };
  if (score >= 50) return { label: "Moderate", color: "#f59e0b" };
  if (score >= 25) return { label: "Neutral", color: "rgba(255,255,255,0.4)" };
  return { label: "Square", color: "#f87171" };
}

function moveBadge(pct: number | null | undefined, direction: "favor" | "against" | "both") {
  if (pct == null || pct === 0) return null;
  const isFavor = pct > 0;
  return {
    label: `${isFavor ? "+" : ""}${pct?.toFixed(1)}%`,
    color: isFavor ? "#4ade80" : "#f87171",
    icon: isFavor ? ArrowUpRight : ArrowDownRight,
  };
}

// ── Add Line Dialog ───────────────────────────────────────────────────────────
function AddLineDialog({ onAdd }: { onAdd: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    sport: "NBA", betType: "player_prop", eventDescription: "",
    marketKey: "player_points", outcomeLabel: "", playerName: "",
    book: "draftkings", openingLine: "", openingOdds: "-110",
    alertThreshold: "5", alertDirection: "both",
    gameTime: "",
  });

  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/clv", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clv"] });
      toast({ title: "Line added", description: "Now tracking this line." });
      setOpen(false);
      onAdd();
    },
    onError: () => toast({ title: "Error", description: "Could not add line.", variant: "destructive" }),
  });

  const betTypeOptions: Record<string, string[]> = {
    player_prop: ["player_points","player_rebounds","player_assists","player_threes","player_strikeouts","player_hits","player_goals","player_pass_yards","player_rush_yards","player_receiving_yards"],
    spread: ["spreads"],
    total: ["totals"],
    moneyline: ["h2h"],
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 text-xs font-bold" style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", border: "none", color: "#fff" }}>
          <Plus size={14} /> Track Line
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" style={{ background: "#0f0f1a", border: "1px solid rgba(124,58,237,0.3)", color: "#fff" }}>
        <DialogHeader>
          <DialogTitle className="text-white">Track a New Line</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Sport</Label>
              <Select value={form.sport} onValueChange={v => setForm(f => ({ ...f, sport: v }))}>
                <SelectTrigger className="h-8 text-xs" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {["NBA","NFL","MLB","NHL"].map(s => <SelectItem key={s} value={s} className="text-white">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Bet Type</Label>
              <Select value={form.betType} onValueChange={v => setForm(f => ({ ...f, betType: v, marketKey: betTypeOptions[v]?.[0] ?? v }))}>
                <SelectTrigger className="h-8 text-xs" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {["player_prop","spread","total","moneyline"].map(t => <SelectItem key={t} value={t} className="text-white capitalize">{t.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/50 mb-1 block">Event (e.g. Lakers vs Celtics)</Label>
            <Input value={form.eventDescription} onChange={e => setForm(f => ({ ...f, eventDescription: e.target.value }))}
              placeholder="Lakers vs Celtics · Mar 20" className="h-8 text-xs"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          </div>

          {form.betType === "player_prop" && (
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Player Name</Label>
              <Input value={form.playerName} onChange={e => setForm(f => ({ ...f, playerName: e.target.value }))}
                placeholder="LeBron James" className="h-8 text-xs"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
            </div>
          )}

          <div>
            <Label className="text-xs text-white/50 mb-1 block">Market / Stat</Label>
            <Select value={form.marketKey} onValueChange={v => setForm(f => ({ ...f, marketKey: v }))}>
              <SelectTrigger className="h-8 text-xs" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}>
                {(betTypeOptions[form.betType] ?? [form.marketKey]).map(m => (
                  <SelectItem key={m} value={m} className="text-white">{m.replace(/_/g," ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-white/50 mb-1 block">Outcome Label (e.g. LeBron Over 27.5 pts)</Label>
            <Input value={form.outcomeLabel} onChange={e => setForm(f => ({ ...f, outcomeLabel: e.target.value }))}
              placeholder="LeBron James Over 27.5 pts" className="h-8 text-xs"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Opening Line</Label>
              <Input value={form.openingLine} onChange={e => setForm(f => ({ ...f, openingLine: e.target.value }))}
                placeholder="27.5" className="h-8 text-xs"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Opening Odds</Label>
              <Input value={form.openingOdds} onChange={e => setForm(f => ({ ...f, openingOdds: e.target.value }))}
                placeholder="-110" className="h-8 text-xs"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Book</Label>
              <Select value={form.book} onValueChange={v => setForm(f => ({ ...f, book: v }))}>
                <SelectTrigger className="h-8 text-xs" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {["draftkings","fanduel","betmgm","caesars","pointsbet","barstool","bet365","pinnacle"].map(b =>
                    <SelectItem key={b} value={b} className="text-white capitalize">{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/50 mb-1 block">Game Time (optional)</Label>
            <Input type="datetime-local" value={form.gameTime} onChange={e => setForm(f => ({ ...f, gameTime: e.target.value }))}
              className="h-8 text-xs"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          </div>

          <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)" }}>
            <Label className="text-xs font-bold text-white/70 block">Alert Settings</Label>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Alert threshold: <span className="text-white font-bold">{form.alertThreshold}%</span></span>
            </div>
            <Slider min={1} max={30} step={0.5} value={[parseFloat(form.alertThreshold) || 5]}
              onValueChange={([v]) => setForm(f => ({ ...f, alertThreshold: String(v) }))}
              className="w-full" />
            <div className="flex gap-2 mt-2">
              {["both","favor","against"].map(d => (
                <button key={d} onClick={() => setForm(f => ({ ...f, alertDirection: d }))}
                  className="text-xs px-2 py-1 rounded capitalize transition-all"
                  style={{ background: form.alertDirection === d ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.05)", color: form.alertDirection === d ? "#a78bfa" : "rgba(255,255,255,0.5)", border: `1px solid ${form.alertDirection === d ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.1)"}` }}>
                  {d === "favor" ? "In my favor" : d === "against" ? "Against me" : "Any move"}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full font-bold" disabled={mutation.isPending || !form.outcomeLabel || !form.eventDescription}
            onClick={() => mutation.mutate({
              sport: form.sport, betType: form.betType, eventDescription: form.eventDescription,
              marketKey: form.marketKey, outcomeLabel: form.outcomeLabel,
              playerName: form.playerName || null, book: form.book,
              openingLine: parseFloat(form.openingLine) || null,
              openingOdds: parseInt(form.openingOdds) || -110,
              currentLine: parseFloat(form.openingLine) || null,
              currentOdds: parseInt(form.openingOdds) || -110,
              alertThreshold: parseFloat(form.alertThreshold) || 5,
              alertDirection: form.alertDirection,
              gameTime: form.gameTime ? new Date(form.gameTime) : null,
            })}
            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", border: "none", color: "#fff" }}>
            {mutation.isPending ? "Adding..." : "Start Tracking"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Line Card ─────────────────────────────────────────────────────────────────
function LineCard({ line, onRefresh }: { line: ClvLine; onRefresh: () => void }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: snapshots } = useQuery<ClvSnapshot[]>({
    queryKey: ["/api/clv", line.id, "snapshots"],
    queryFn: () => apiRequest("GET", `/api/clv/${line.id}/snapshots`).then(r => r.json()),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/clv/${line.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/clv"] }); onRefresh(); },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/clv/${line.id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/clv"] }); toast({ title: "Updated" }); },
  });

  const move = line.lineMovePct ?? 0;
  const moveBadgeInfo = moveBadge(move, (line.alertDirection as any) ?? "both");
  const sharpness = sharpnessBadge(line.sharpnessScore);
  const isClosed = line.status === "closed";

  const lineDelta = line.currentLine != null && line.openingLine != null
    ? line.currentLine - line.openingLine : null;
  const oddsDelta = line.currentOdds != null && line.openingOdds != null
    ? line.currentOdds - line.openingOdds : null;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {/* Header */}
      <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        {/* Sport badge */}
        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-black"
          style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.25)" }}>
          {line.sport}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-white/90 truncate">{line.outcomeLabel}</span>
            {sharpness && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                style={{ background: `${sharpness.color}18`, color: sharpness.color, border: `1px solid ${sharpness.color}30` }}>
                {sharpness.label}
              </span>
            )}
            {isClosed && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.1)" }}>
                CLOSED
              </span>
            )}
          </div>
          <div className="text-[10px] text-white/40 mt-0.5 truncate">{line.eventDescription} · {line.book}</div>
          <div className="flex items-center gap-3 mt-1.5">
            {/* Opening */}
            <div className="text-center">
              <div className="text-[9px] text-white/30 uppercase tracking-wider">Open</div>
              <div className="text-xs font-mono font-bold text-white/60">
                {line.openingLine ?? "—"} <span className="text-white/35">{formatOdds(line.openingOdds)}</span>
              </div>
            </div>
            {/* Arrow */}
            <div style={{ color: move > 0 ? "#4ade80" : move < 0 ? "#f87171" : "rgba(255,255,255,0.2)" }}>
              {move > 0 ? <TrendingUp size={12} /> : move < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
            </div>
            {/* Current */}
            <div className="text-center">
              <div className="text-[9px] text-white/30 uppercase tracking-wider">Current</div>
              <div className="text-xs font-mono font-bold text-white/90">
                {line.currentLine ?? "—"} <span className="text-white/50">{formatOdds(line.currentOdds)}</span>
              </div>
            </div>
            {/* Move % */}
            {moveBadgeInfo && (
              <div className="ml-1 flex items-center gap-0.5 text-xs font-black"
                style={{ color: moveBadgeInfo.color }}>
                <moveBadgeInfo.icon size={11} />
                {moveBadgeInfo.label}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* CLV beat indicator */}
          {line.clvBeat != null && (
            line.clvBeat
              ? <CheckCircle size={14} style={{ color: "#4ade80" }} />
              : <X size={14} style={{ color: "#f87171" }} />
          )}
          {expanded ? <ChevronUp size={14} style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown size={14} style={{ color: "rgba(255,255,255,0.3)" }} />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t space-y-3" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          {/* Sharpness bar */}
          {line.sharpnessScore != null && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                <span>Sharpness Score</span>
                <span className="font-bold" style={{ color: sharpness?.color ?? "#fff" }}>{line.sharpnessScore.toFixed(0)}/100</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${line.sharpnessScore}%`, background: `linear-gradient(90deg, ${sharpness?.color ?? "#7c3aed"}, ${sharpness?.color ?? "#4f46e5"})` }} />
              </div>
            </div>
          )}

          {/* CLV delta */}
          {line.clvDelta != null && (
            <div className="rounded-lg p-2.5 flex items-center justify-between" style={{ background: line.clvBeat ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)", border: `1px solid ${line.clvBeat ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}` }}>
              <span className="text-xs text-white/60">CLV Delta (closing vs opening)</span>
              <span className="text-sm font-black" style={{ color: line.clvBeat ? "#4ade80" : "#f87171" }}>
                {line.clvDelta > 0 ? "+" : ""}{line.clvDelta.toFixed(2)} {line.clvBeat ? "✓ Beat closing" : "✗ Missed closing"}
              </span>
            </div>
          )}

          {/* Alert settings inline edit */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Bell size={11} style={{ color: "rgba(255,255,255,0.35)" }} />
              <span className="text-[10px] text-white/40">Alert at</span>
              <span className="text-[10px] font-bold text-white/70">{line.alertThreshold}%</span>
              <span className="text-[10px] text-white/30">move</span>
            </div>
            <div className="flex items-center gap-1">
              {["both","favor","against"].map(d => (
                <button key={d} onClick={() => updateMutation.mutate({ alertDirection: d })}
                  className="text-[9px] px-1.5 py-0.5 rounded capitalize"
                  style={{ background: line.alertDirection === d ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.04)", color: line.alertDirection === d ? "#a78bfa" : "rgba(255,255,255,0.35)", border: `1px solid ${line.alertDirection === d ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Snapshot history */}
          {snapshots && snapshots.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1.5">Line History</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {snapshots.slice().reverse().map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between text-[10px]"
                    style={{ color: "rgba(255,255,255,0.5)" }}>
                    <span>{new Date(s.recordedAt!).toLocaleDateString()} {new Date(s.recordedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="font-mono font-bold text-white/80">{s.line} <span className="text-white/40">{formatOdds(s.odds)}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate()}
              className="text-xs gap-1 h-7" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
              <Trash2 size={11} /> Remove
            </Button>
            {!isClosed && (
              <Button size="sm" variant="ghost" onClick={() => updateMutation.mutate({ status: "closed" })}
                className="text-xs gap-1 h-7" style={{ color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Clock size={11} /> Mark Closed
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Update Line Dialog ────────────────────────────────────────────────────────
function UpdateLineDialog({ line, onUpdated }: { line: ClvLine; onUpdated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentLine, setCurrentLine] = useState(String(line.currentLine ?? ""));
  const [currentOdds, setCurrentOdds] = useState(String(line.currentOdds ?? ""));
  const [closing, setClosing] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/clv/${line.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clv"] });
      toast({ title: "Line updated", description: "Snapshot recorded." });
      setOpen(false);
      onUpdated();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-[9px] px-2 py-0.5 rounded font-bold"
          style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.25)" }}>
          Update
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xs" style={{ background: "#0f0f1a", border: "1px solid rgba(124,58,237,0.3)", color: "#fff" }}>
        <DialogHeader>
          <DialogTitle className="text-white text-sm">Update Line</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="text-xs text-white/50 truncate">{line.outcomeLabel}</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-white/40 mb-1 block">Current Line</Label>
              <Input value={currentLine} onChange={e => setCurrentLine(e.target.value)}
                className="h-8 text-xs" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
            </div>
            <div>
              <Label className="text-xs text-white/40 mb-1 block">Current Odds</Label>
              <Input value={currentOdds} onChange={e => setCurrentOdds(e.target.value)}
                className="h-8 text-xs" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={closing} onCheckedChange={setClosing} />
            <span className="text-xs text-white/50">This is the closing line</span>
          </div>
          <Button className="w-full font-bold text-xs h-8"
            onClick={() => mutation.mutate({
              currentLine: parseFloat(currentLine) || null,
              currentOdds: parseInt(currentOdds) || null,
              ...(closing ? { closingLine: parseFloat(currentLine), closingOdds: parseInt(currentOdds), status: "closed" } : {}),
            })}
            disabled={mutation.isPending}
            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", border: "none", color: "#fff" }}>
            {mutation.isPending ? "Saving..." : "Save Update"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Alert Item ────────────────────────────────────────────────────────────────
function AlertItem({ alert, onDismiss }: { alert: ClvAlert; onDismiss: () => void }) {
  const mutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/clv-alerts/${alert.id}/dismiss`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/clv-alerts"] }); onDismiss(); },
  });

  const isSharp = alert.alertType === "sharp_move";
  const isFavor = alert.alertType === "move_favor";
  const color = isSharp ? "#f59e0b" : isFavor ? "#4ade80" : "#f87171";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: `${color}09`, border: `1px solid ${color}20` }}>
      <div className="mt-0.5">
        {isSharp ? <AlertTriangle size={14} style={{ color }} /> : isFavor ? <TrendingUp size={14} style={{ color }} /> : <TrendingDown size={14} style={{ color }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold" style={{ color }}>{alert.message}</div>
        <div className="text-[10px] text-white/35 mt-0.5">{new Date(alert.firedAt!).toLocaleString()}</div>
        {alert.fromLine != null && alert.toLine != null && (
          <div className="text-[10px] text-white/40 mt-0.5 font-mono">
            {alert.fromLine} → {alert.toLine} ({alert.movePct != null ? `${alert.movePct > 0 ? "+" : ""}${alert.movePct.toFixed(1)}%` : ""})
          </div>
        )}
      </div>
      <button onClick={() => mutation.mutate()} className="text-white/25 hover:text-white/60">
        <X size={12} />
      </button>
    </div>
  );
}

// ── Summary Stats ─────────────────────────────────────────────────────────────
function SummaryStats({ lines }: { lines: ClvLine[] }) {
  const closed = lines.filter(l => l.status === "closed");
  const clvBeatCount = closed.filter(l => l.clvBeat).length;
  const clvRate = closed.length > 0 ? Math.round((clvBeatCount / closed.length) * 100) : null;
  const avgDelta = closed.length > 0
    ? closed.reduce((s, l) => s + (l.clvDelta ?? 0), 0) / closed.length : null;
  const avgSharp = lines.filter(l => l.sharpnessScore != null).length > 0
    ? lines.filter(l => l.sharpnessScore != null).reduce((s, l) => s + l.sharpnessScore!, 0) / lines.filter(l => l.sharpnessScore != null).length
    : null;
  const tracking = lines.filter(l => l.status === "tracking").length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {[
        { label: "Tracking", value: tracking, sub: "active lines", color: "#a78bfa" },
        { label: "CLV Beat Rate", value: clvRate != null ? `${clvRate}%` : "—", sub: `${clvBeatCount}/${closed.length} closed`, color: clvRate != null && clvRate >= 55 ? "#4ade80" : "#f87171" },
        { label: "Avg CLV Delta", value: avgDelta != null ? `${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(2)}` : "—", sub: "avg line move favor", color: avgDelta != null && avgDelta > 0 ? "#4ade80" : avgDelta != null ? "#f87171" : "rgba(255,255,255,0.4)" },
        { label: "Avg Sharpness", value: avgSharp != null ? `${avgSharp.toFixed(0)}/100` : "—", sub: sharpnessBadge(avgSharp)?.label ?? "", color: sharpnessBadge(avgSharp)?.color ?? "rgba(255,255,255,0.4)" },
      ].map(({ label, value, sub, color }) => (
        <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</div>
          <div className="text-xl font-black" style={{ color }}>{value}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ClvTracker() {
  const { toast } = useToast();
  const [filterSport, setFilterSport] = useState("all");
  const [filterBook, setFilterBook] = useState("all");
  const [filterBetType, setFilterBetType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("tracking");
  const [sortBy, setSortBy] = useState<"move" | "sharpness" | "recent">("move");

  const { data: lines = [], refetch } = useQuery<ClvLine[]>({
    queryKey: ["/api/clv"],
    refetchInterval: 60000,
  });

  const { data: alerts = [], refetch: refetchAlerts } = useQuery<ClvAlert[]>({
    queryKey: ["/api/clv-alerts"],
    refetchInterval: 30000,
  });

  const activeAlerts = (alerts as ClvAlert[]).filter((a: ClvAlert) => !a.dismissed);

  const filtered = useMemo(() => {
    let out = [...(lines as ClvLine[])];
    if (filterSport !== "all") out = out.filter(l => l.sport === filterSport);
    if (filterBook !== "all") out = out.filter(l => l.book === filterBook);
    if (filterBetType !== "all") out = out.filter(l => l.betType === filterBetType);
    if (filterStatus !== "all") out = out.filter(l => l.status === filterStatus);

    out.sort((a, b) => {
      if (sortBy === "move") return Math.abs(b.lineMovePct ?? 0) - Math.abs(a.lineMovePct ?? 0);
      if (sortBy === "sharpness") return (b.sharpnessScore ?? 0) - (a.sharpnessScore ?? 0);
      return (b.createdAt?.toString() ?? "") > (a.createdAt?.toString() ?? "") ? 1 : -1;
    });
    return out;
  }, [lines, filterSport, filterBook, filterBetType, filterStatus, sortBy]);

  const books = [...new Set((lines as ClvLine[]).map((l: ClvLine) => l.book))];
  const byBook = useMemo(() => {
    const grouped: Record<string, { total: number; beat: number; delta: number }> = {};
    (lines as ClvLine[]).filter((l: ClvLine) => l.status === "closed" && l.clvBeat != null).forEach((l: ClvLine) => {
      if (!grouped[l.book]) grouped[l.book] = { total: 0, beat: 0, delta: 0 };
      grouped[l.book].total++;
      if (l.clvBeat) grouped[l.book].beat++;
      grouped[l.book].delta += l.clvDelta ?? 0;
    });
    return grouped;
  }, [lines]);

  const bySport = useMemo(() => {
    const grouped: Record<string, { total: number; beat: number }> = {};
    (lines as ClvLine[]).filter((l: ClvLine) => l.status === "closed" && l.clvBeat != null).forEach((l: ClvLine) => {
      if (!grouped[l.sport]) grouped[l.sport] = { total: 0, beat: 0 };
      grouped[l.sport].total++;
      if (l.clvBeat) grouped[l.sport].beat++;
    });
    return grouped;
  }, [lines]);

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: "#07070f", color: "#fff" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-black tracking-tight" style={{ background: "linear-gradient(135deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            CLV Line Tracker
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
            Closing Line Value · Sharpness Scores · Movement Alerts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeAlerts.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold"
              style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
              <Bell size={12} /> {activeAlerts.length}
            </div>
          )}
          <AddLineDialog onAdd={() => refetch()} />
        </div>
      </div>

      {/* Summary stats */}
      <SummaryStats lines={lines as ClvLine[]} />

      <Tabs defaultValue="lines">
        <TabsList className="mb-4 h-8" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <TabsTrigger value="lines" className="text-xs h-6 data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300">Lines</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs h-6 data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300">
            Alerts {activeAlerts.length > 0 && <span className="ml-1 text-[9px] bg-amber-500/20 text-amber-400 px-1 rounded">{activeAlerts.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs h-6 data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300">Analytics</TabsTrigger>
        </TabsList>

        {/* ── Lines tab ── */}
        <TabsContent value="lines" className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <Filter size={12} style={{ color: "rgba(255,255,255,0.3)" }} />
            {[
              { value: filterSport, set: setFilterSport, options: ["all","NBA","NFL","MLB","NHL"], label: "Sport" },
              { value: filterBook, set: setFilterBook, options: ["all",...books], label: "Book" },
              { value: filterBetType, set: setFilterBetType, options: ["all","player_prop","spread","total","moneyline"], label: "Type" },
              { value: filterStatus, set: setFilterStatus, options: ["all","tracking","closed"], label: "Status" },
            ].map(({ value, set, options, label }) => (
              <Select key={label} value={value} onValueChange={set}>
                <SelectTrigger className="h-7 text-[10px] w-auto min-w-[80px]" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
                  <SelectValue placeholder={label} />
                </SelectTrigger>
                <SelectContent style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {options.map(o => <SelectItem key={o} value={o} className="text-white text-xs capitalize">{o === "all" ? `All ${label}s` : o.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            ))}
            <div className="ml-auto flex gap-1">
              {(["move","sharpness","recent"] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)}
                  className="text-[9px] px-2 py-1 rounded capitalize"
                  style={{ background: sortBy === s ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.04)", color: sortBy === s ? "#a78bfa" : "rgba(255,255,255,0.35)", border: `1px solid ${sortBy === s ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                  {s === "move" ? "Most Moved" : s === "sharpness" ? "Sharpest" : "Newest"}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <Activity size={32} style={{ color: "rgba(255,255,255,0.1)", margin: "0 auto" }} />
              <p className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.2)" }}>No lines tracked yet</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.12)" }}>Click "Track Line" to start monitoring opening vs closing line value</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(line => (
                <div key={line.id} className="relative">
                  <div className="absolute top-2 right-2 z-10">
                    <UpdateLineDialog line={line} onUpdated={() => refetch()} />
                  </div>
                  <LineCard line={line} onRefresh={() => refetch()} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Alerts tab ── */}
        <TabsContent value="alerts" className="space-y-2">
          {activeAlerts.length === 0 ? (
            <div className="text-center py-16">
              <BellOff size={32} style={{ color: "rgba(255,255,255,0.1)", margin: "0 auto 8px" }} />
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>No active alerts</p>
            </div>
          ) : (
            activeAlerts.map((a: ClvAlert) => <AlertItem key={a.id} alert={a} onDismiss={() => refetchAlerts()} />)
          )}
          {(alerts as ClvAlert[]).filter((a: ClvAlert) => a.dismissed).length > 0 && (
            <div className="mt-4">
              <div className="text-[9px] uppercase tracking-wider text-white/25 mb-2">Dismissed</div>
              <div className="space-y-1 opacity-40">
                {(alerts as ClvAlert[]).filter((a: ClvAlert) => a.dismissed).slice(0,5).map((a: ClvAlert) => (
                  <div key={a.id} className="text-xs p-2 rounded" style={{ background: "rgba(255,255,255,0.02)" }}>
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Analytics tab ── */}
        <TabsContent value="analytics" className="space-y-4">
          {/* By Book */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-xs font-bold text-white/60 mb-3 uppercase tracking-wider">CLV Beat Rate by Book</div>
            {Object.keys(byBook).length === 0 ? (
              <p className="text-xs text-white/25">No closed lines yet</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(byBook).sort((a,b) => (b[1].beat/b[1].total) - (a[1].beat/a[1].total)).map(([book, stats]) => {
                  const rate = Math.round((stats.beat / stats.total) * 100);
                  const avgD = stats.delta / stats.total;
                  return (
                    <div key={book} className="flex items-center gap-3">
                      <div className="w-24 text-xs capitalize font-bold text-white/70">{book}</div>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                        <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate >= 55 ? "#4ade80" : "#f87171" }} />
                      </div>
                      <div className="text-xs font-black w-10 text-right" style={{ color: rate >= 55 ? "#4ade80" : "#f87171" }}>{rate}%</div>
                      <div className="text-[10px] w-14 text-right font-mono" style={{ color: avgD > 0 ? "#4ade80" : "#f87171" }}>
                        {avgD > 0 ? "+" : ""}{avgD.toFixed(2)} avg
                      </div>
                      <div className="text-[10px] text-white/30">{stats.total}g</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* By Sport */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-xs font-bold text-white/60 mb-3 uppercase tracking-wider">CLV Beat Rate by Sport</div>
            {Object.keys(bySport).length === 0 ? (
              <p className="text-xs text-white/25">No closed lines yet</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(bySport).map(([sport, stats]) => {
                  const rate = Math.round((stats.beat / stats.total) * 100);
                  return (
                    <div key={sport} className="rounded-lg p-3 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="text-xs font-black text-white/50 mb-1">{sport}</div>
                      <div className="text-2xl font-black" style={{ color: rate >= 55 ? "#4ade80" : "#f87171" }}>{rate}%</div>
                      <div className="text-[9px] text-white/30">{stats.beat}/{stats.total} beats</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* By Bet Type */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-xs font-bold text-white/60 mb-3 uppercase tracking-wider">CLV Beat Rate by Bet Type</div>
            {(() => {
              const byType: Record<string, { total: number; beat: number }> = {};
              (lines as ClvLine[]).filter((l: ClvLine) => l.status === "closed" && l.clvBeat != null).forEach((l: ClvLine) => {
                if (!byType[l.betType]) byType[l.betType] = { total: 0, beat: 0 };
                byType[l.betType].total++;
                if (l.clvBeat) byType[l.betType].beat++;
              });
              return Object.keys(byType).length === 0 ? (
                <p className="text-xs text-white/25">No closed lines yet</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(byType).map(([type, stats]) => {
                    const rate = Math.round((stats.beat / stats.total) * 100);
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <div className="w-28 text-xs capitalize font-bold text-white/70">{type.replace("_"," ")}</div>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate >= 55 ? "#4ade80" : "#f87171" }} />
                        </div>
                        <div className="text-xs font-black w-10 text-right" style={{ color: rate >= 55 ? "#4ade80" : "#f87171" }}>{rate}%</div>
                        <div className="text-[10px] text-white/30">{stats.total}g</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
