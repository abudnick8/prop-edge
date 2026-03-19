/**
 * PropEdge WebSocket server
 *
 * Attach to the existing http.Server and export broadcast() so any part
 * of the server (routes, scanner callbacks, etc.) can push events to all
 * connected browser clients.
 *
 * Event envelope: { event: string; data: any; ts: number }
 *
 * Events emitted:
 *   bets:updated   — scan finished, new bets available
 *   bets:highconf  — a bet just crossed the 80/100 confidence threshold
 *   line:steam     — a spread/total moved ≥ 3 pts (steam move)
 *   line:moved     — any line movement ≥ 1.5 pts
 *   ping           — keepalive from server every 30 s
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

/** Call once in server/index.ts after httpServer is created */
export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    clients.add(ws);
    console.log(`[WS] client connected (${clients.size} total)`);

    // Send a welcome ping so the client knows connection is live
    safeSend(ws, { event: "connected", data: { message: "PropEdge live feed connected" }, ts: Date.now() });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Client can send { event: "pong" } in response to our ping — ignore quietly
        if (msg.event === "pong") return;
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[WS] client disconnected (${clients.size} remaining)`);
    });

    ws.on("error", (err) => {
      console.warn("[WS] client error:", err.message);
      clients.delete(ws);
    });
  });

  // Keepalive ping every 30 s — keeps Railway from closing idle connections
  setInterval(() => {
    broadcast("ping", { ts: Date.now() });
  }, 30_000);

  console.log("[WS] WebSocket server ready on /ws");
  return wss;
}

function safeSend(ws: WebSocket, payload: object) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  } catch { /* ignore */ }
}

/** Push an event to every connected browser client */
export function broadcast(event: string, data: any = {}) {
  if (clients.size === 0) return;
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  for (const ws of clients) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    } catch { /* ignore stale client */ }
  }
}

/** Current connected client count */
export function connectedClients(): number {
  return clients.size;
}
