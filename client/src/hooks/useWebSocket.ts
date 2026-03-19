/**
 * useWebSocket — auto-reconnecting WebSocket hook for PropEdge live feed.
 *
 * On bets:updated  → invalidate /api/bets so every page refetches silently
 * On bets:highconf → store latest high-confidence alert for NotificationCenter
 * On line:steam    → invalidate /api/line-movement
 * On ping          → no-op (keepalive from server)
 *
 * Reconnects with exponential backoff (1s → 2s → 4s … max 30s).
 */

import { useEffect, useRef, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

type WSEvent = {
  event: string;
  data: any;
  ts: number;
};

// Global so all hook instances share the same connection
let globalWs: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let listeners: Set<(evt: WSEvent) => void> = new Set();

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In deployed Railway environment the __PORT_5000__ rewrite means the
  // WebSocket path must go through the same origin proxy.
  // In dev the Vite WS dev-server intercepts `/ws` — use explicit port 5000.
  if (import.meta.env.DEV) {
    return `ws://localhost:5000/ws`;
  }
  return `${proto}//${window.location.host}/ws`;
}

function connect() {
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const url = getWsUrl();
    globalWs = new WebSocket(url);

    globalWs.onopen = () => {
      console.log("[WS] connected");
      reconnectDelay = 1000; // reset backoff on successful connect
    };

    globalWs.onmessage = (e) => {
      try {
        const evt: WSEvent = JSON.parse(e.data);
        // Dispatch to all active listeners
        listeners.forEach((cb) => cb(evt));

        // Core query invalidations — happen regardless of which component is mounted
        if (evt.event === "bets:updated") {
          queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
          queryClient.invalidateQueries({ queryKey: ["/api/lotto"] });
        }
        if (evt.event === "bets:highconf") {
          queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
        }
        if (evt.event === "line:steam" || evt.event === "line:moved") {
          queryClient.invalidateQueries({ queryKey: ["/api/line-movement"] });
        }
      } catch {
        // ignore malformed messages
      }
    };

    globalWs.onclose = (e) => {
      console.log(`[WS] disconnected (code=${e.code}), reconnecting in ${reconnectDelay / 1000}s`);
      globalWs = null;
      scheduleReconnect();
    };

    globalWs.onerror = () => {
      // onclose fires right after onerror — let that handle reconnect
      globalWs?.close();
    };
  } catch (err) {
    console.warn("[WS] failed to create WebSocket:", err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000); // cap at 30s
    connect();
  }, reconnectDelay);
}

/**
 * useWebSocket — call in App.tsx (once) to start the connection.
 * Optionally pass an onEvent callback to react to specific events.
 */
export function useWebSocket(onEvent?: (evt: WSEvent) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  const stableListener = useCallback((evt: WSEvent) => {
    cbRef.current?.(evt);
  }, []);

  useEffect(() => {
    // Start connection on first mount
    connect();

    if (onEvent) {
      listeners.add(stableListener);
    }

    return () => {
      if (onEvent) {
        listeners.delete(stableListener);
      }
    };
  }, [stableListener, onEvent]);

  const isConnected =
    globalWs !== null && globalWs.readyState === WebSocket.OPEN;

  return { isConnected };
}
