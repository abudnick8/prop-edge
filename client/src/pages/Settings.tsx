import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings as SettingsType } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, Key, Bell, BarChart2, Zap, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
  });

  const [form, setForm] = useState<Partial<SettingsType>>({});
  const [oddsKey, setOddsKey] = useState("");

  useEffect(() => {
    if (settings) {
      setForm(settings);
      setOddsKey(settings.oddsApiKey ?? "");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<SettingsType>) => apiRequest("PATCH", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings Saved", description: "Your preferences have been updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save settings", variant: "destructive" }),
  });

  const handleSave = () => {
    saveMutation.mutate({ ...form, oddsApiKey: oddsKey || null });
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure your prediction bot</p>
      </div>

      {/* Alert Threshold */}
      <SettingsSection icon={<Bell size={16} />} title="Alert Threshold" description="Set the minimum confidence score to receive a notification">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Minimum Confidence Score</Label>
            <span className="font-mono font-bold text-primary">{form.confidenceThreshold ?? 80}/100</span>
          </div>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={form.confidenceThreshold ?? 80}
            onChange={(e) => setForm({ ...form, confidenceThreshold: Number(e.target.value) })}
            className="w-full accent-primary"
            data-testid="input-confidence-threshold"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>50</span>
            <span className="text-primary font-bold">Recommended: 80</span>
            <span>95</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            You'll be alerted when any pick scores {form.confidenceThreshold ?? 80}+ out of 100.
          </p>
        </div>
      </SettingsSection>

      {/* Bankroll */}
      <SettingsSection icon={<BarChart2 size={16} />} title="Portfolio Settings" description="Configure bankroll size for allocation calculations">
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Bankroll Size ($)</Label>
            <Input
              type="number"
              value={form.bankrollSize ?? 1000}
              onChange={(e) => setForm({ ...form, bankrollSize: Number(e.target.value) })}
              className="bg-muted border-border font-mono"
              placeholder="1000"
              data-testid="input-bankroll"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Used to calculate dollar amounts for recommended allocations
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Max Allocation per Bet (%)</Label>
              <span className="font-mono text-sm text-foreground">{form.maxAllocationPercent ?? 5}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={form.maxAllocationPercent ?? 5}
              onChange={(e) => setForm({ ...form, maxAllocationPercent: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>1%</span>
              <span>20%</span>
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Scan Interval */}
      <SettingsSection icon={<RefreshCw size={16} />} title="Scan Frequency" description="How often the bot automatically scans for new markets">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Scan every</Label>
            <span className="font-mono font-bold text-foreground">{form.scanIntervalMinutes ?? 30} minutes</span>
          </div>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={form.scanIntervalMinutes ?? 30}
            onChange={(e) => setForm({ ...form, scanIntervalMinutes: Number(e.target.value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>5 min</span>
            <span>2 hours</span>
          </div>
        </div>
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection icon={<Bell size={16} />} title="Notifications" description="In-app alerts for high-confidence picks">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Enable Alerts</p>
            <p className="text-xs text-muted-foreground">Bell icon in top-right will ring when picks hit your threshold</p>
          </div>
          <Switch
            checked={form.notificationsEnabled ?? true}
            onCheckedChange={(v) => setForm({ ...form, notificationsEnabled: v })}
            data-testid="switch-notifications"
          />
        </div>
      </SettingsSection>

      {/* API Keys */}
      <SettingsSection icon={<Key size={16} />} title="API Keys" description="Optional: add keys to unlock live data from more sources">
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">The Odds API Key</Label>
            <Input
              type="password"
              value={oddsKey}
              onChange={(e) => setOddsKey(e.target.value)}
              placeholder="Enter your The Odds API key..."
              className="bg-muted border-border font-mono"
              data-testid="input-odds-api-key"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Unlocks live DraftKings lines and player props. Free tier at{" "}
              <a href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                the-odds-api.com
              </a>{" "}
              (500 requests/month free).
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1 border border-border">
            <p className="font-semibold text-foreground">Sources Without API Keys (Always Active)</p>
            <p>• <span className="text-primary">Kalshi</span> — Public API, no key needed</p>
            <p>• <span className="text-purple-400">Polymarket</span> — Public API, no key needed</p>
            <p>• <span className="font-medium text-muted-foreground">Demo data</span> — Pre-loaded example picks always available</p>
          </div>
        </div>
      </SettingsSection>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          data-testid="button-save-settings"
        >
          <Zap size={14} />
          {saveMutation.isPending ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="text-primary mt-0.5">{icon}</span>
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
