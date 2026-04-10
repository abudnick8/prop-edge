/**
 * Smart Wallet Tracker
 * ─────────────────────────────────────────────────────────────────────────────
 * Adapts logic from the Polymarket Sports Copy-Trading Bot
 * (github.com/Oasismetaverse-Venture-Trade/Polymarket-sports-copytrading-bot)
 *
 * What it does:
 *  1. Fetches the Polymarket leaderboard (top 20 traders by all-time PnL)
 *  2. For each wallet, fetches their current open positions
 *  3. Builds a position map: conditionId → {walletCount, totalUSDC, direction}
 *  4. Exposes that map so the prediction market scan can:
 *     a. Boost smartScore / isWhaleAlert on matched markets (Option C)
 *     b. Surface the wallet leaderboard + positions in the UI (Option A)
 *
 * All fetches are fire-and-forget with graceful fallback — if Polymarket APIs
 * are slow, the rest of the app is unaffected.
 */

import axios from "axios";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SmartWallet {
  address:       string;        // proxyWallet
  rank:          number;
  pnl:           number;        // all-time PnL in USDC
  volume:        number;        // all-time volume in USDC
  tradesCount:   number;
  winRate:       number | null; // 0–1
  positions:     SmartPosition[];
  lastUpdated:   string;
}

export interface SmartPosition {
  conditionId:   string;
  title:         string;
  outcome:       "YES" | "NO" | string;
  size:          number;        // shares
  avgPrice:      number;        // cents (0–100)
  currentPrice:  number;        // cents
  usdcValue:     number;        // current USDC value
  initialValue:  number;        // cost basis
  unrealizedPnl: number;        // usdcValue - initialValue
  side:          "yes" | "no";  // which side they're holding
}

export interface SmartMoneySignal {
  /** How many tracked smart wallets hold a position in this market */
  walletCount:   number;
  /** Total USDC across all smart wallet positions in this market */
  totalUSDC:     number;
  /** Majority direction ("yes" | "no" | "mixed") */
  direction:     "yes" | "no" | "mixed";
  /** Wallet addresses holding this market */
  holders:       string[];
  /** Weighted avg price across all wallet positions (cents) */
  avgPriceCents: number;
}

// ── Module-level cache ────────────────────────────────────────────────────────

const DATA_API  = "https://data-api.polymarket.com";

// Full wallet list (shown in UI)
let walletsCache:    SmartWallet[]                    = [];
let walletsCacheTs:  number                           = 0;
const WALLETS_TTL   = 5 * 60_000; // 5 min

// Market → signal lookup (used by scan + Kronos)
let signalMap:      Map<string, SmartMoneySignal>     = new Map();
let signalMapTs:    number                            = 0;
const SIGNAL_TTL    = 5 * 60_000; // 5 min

// How many top leaderboard wallets to track
const TOP_N         = 20;
// How many positions to fetch per wallet
const POSITIONS_PER_WALLET = 100;

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchLeaderboard(): Promise<any[]> {
  try {
    const { data } = await axios.get(`${DATA_API}/v1/leaderboard`, {
      params: { timePeriod: "ALL", orderBy: "PNL", limit: TOP_N },
      timeout: 10_000,
    });
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    console.warn("[SmartWallets] Leaderboard fetch failed:", e.message);
    return [];
  }
}

async function fetchPositions(wallet: string): Promise<any[]> {
  try {
    // Try paginated positions endpoint (same pattern as copy-trading bot)
    const { data } = await axios.get(`${DATA_API}/positions`, {
      params: { user: wallet, sizeThreshold: 0.01, limit: POSITIONS_PER_WALLET },
      timeout: 8_000,
    });
    const raw = Array.isArray(data) ? data : (data?.positions ?? data?.data ?? []);
    return Array.isArray(raw) ? raw : [];
  } catch (e: any) {
    // Silent — individual wallet failures shouldn't surface to user
    return [];
  }
}

// ── Normalize a raw position ──────────────────────────────────────────────────

function normalizePosition(raw: any): SmartPosition | null {
  const conditionId = raw.conditionId ?? raw.market_id ?? raw.marketId ?? "";
  if (!conditionId) return null;

  const size         = parseFloat(raw.size ?? raw.quantity ?? "0") || 0;
  const avgPrice     = parseFloat(raw.avgPrice ?? raw.price ?? "0") || 0;       // fraction 0–1
  const curPrice     = parseFloat(raw.curPrice ?? raw.currentPrice ?? "0") || 0;
  const initialVal   = parseFloat(String(raw.initialValue ?? 0)) || (size * avgPrice);
  const currentVal   = parseFloat(String(raw.currentValue ?? 0)) || (size * curPrice) || initialVal;

  const outcome      = (raw.outcome ?? raw.outcomeToken ?? "YES").toString();
  const side: "yes" | "no" = outcome.toUpperCase().includes("NO") ? "no" : "yes";

  return {
    conditionId,
    title:         raw.title ?? raw.question ?? "",
    outcome,
    side,
    size,
    avgPrice:      Math.round(avgPrice * 100 * 100) / 100,   // to cents
    currentPrice:  Math.round(curPrice * 100 * 100) / 100,
    usdcValue:     Math.round(currentVal * 100) / 100,
    initialValue:  Math.round(initialVal * 100) / 100,
    unrealizedPnl: Math.round((currentVal - initialVal) * 100) / 100,
  };
}

// ── Main refresh logic ────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  const leaderboard = await fetchLeaderboard();
  if (leaderboard.length === 0) return;

  // Fetch positions for all wallets in parallel (with concurrency cap via batching)
  const BATCH = 5;
  const wallets: SmartWallet[] = [];

  for (let i = 0; i < Math.min(TOP_N, leaderboard.length); i += BATCH) {
    const batch = leaderboard.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (trader: any, batchIdx: number) => {
        const address  = trader.proxyWallet ?? trader.address ?? "";
        if (!address) return null;

        const rawPositions = await fetchPositions(address);
        const positions    = rawPositions
          .map(normalizePosition)
          .filter((p): p is SmartPosition => p !== null && p.usdcValue >= 1);

        return {
          address,
          rank:        i + batchIdx + 1,
          pnl:         parseFloat(String(trader.pnl ?? trader.totalPnl ?? 0)),
          volume:      parseFloat(String(trader.volume ?? trader.totalVolume ?? 0)),
          tradesCount: parseInt(String(trader.tradesCount ?? trader.numTrades ?? 0), 10),
          winRate:     trader.winRate != null ? parseFloat(String(trader.winRate)) : null,
          positions,
          lastUpdated: new Date().toISOString(),
        } as SmartWallet;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) wallets.push(r.value);
    }
  }

  // Update wallet cache
  walletsCache   = wallets.sort((a, b) => a.rank - b.rank);
  walletsCacheTs = Date.now();

  // Build signal map: conditionId → aggregated signal
  const newMap = new Map<string, SmartMoneySignal>();

  for (const wallet of wallets) {
    for (const pos of wallet.positions) {
      const existing = newMap.get(pos.conditionId);
      if (!existing) {
        newMap.set(pos.conditionId, {
          walletCount:   1,
          totalUSDC:     pos.usdcValue,
          direction:     pos.side,
          holders:       [wallet.address],
          avgPriceCents: pos.currentPrice,
        });
      } else {
        existing.walletCount  += 1;
        existing.totalUSDC    += pos.usdcValue;
        existing.holders.push(wallet.address);
        // Update direction
        if (existing.direction !== pos.side) existing.direction = "mixed";
        // Weighted avg price
        const totalShares = existing.walletCount;
        existing.avgPriceCents = Math.round(
          (existing.avgPriceCents * (totalShares - 1) + pos.currentPrice) / totalShares * 100
        ) / 100;
      }
    }
  }

  signalMap   = newMap;
  signalMapTs = Date.now();

  console.log(
    `[SmartWallets] Refreshed: ${wallets.length} wallets, ` +
    `${signalMap.size} unique markets tracked`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the full smart wallet list (for the UI leaderboard).
 * Auto-refreshes if cache is stale.
 */
export async function getSmartWallets(): Promise<SmartWallet[]> {
  if (Date.now() - walletsCacheTs > WALLETS_TTL || walletsCache.length === 0) {
    await refresh();
  }
  return walletsCache;
}

/**
 * Get the signal map (for prediction market scan injection).
 * Returns immediately from cache — never blocks the scan.
 * Triggers a background refresh if stale.
 */
export function getSignalMap(): Map<string, SmartMoneySignal> {
  if (Date.now() - signalMapTs > SIGNAL_TTL) {
    refresh().catch(() => {}); // fire-and-forget
  }
  return signalMap;
}

/**
 * Get the smart money signal for a specific market conditionId.
 * Returns null if no tracked wallets hold it.
 */
export function getSignalForMarket(conditionId: string): SmartMoneySignal | null {
  return signalMap.get(conditionId) ?? null;
}

/**
 * Bootstrap — start the first fetch immediately at server startup,
 * then refresh every 5 minutes.
 */
export function startSmartWalletTracker(): void {
  console.log("[SmartWallets] Starting tracker…");
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), SIGNAL_TTL);
}
