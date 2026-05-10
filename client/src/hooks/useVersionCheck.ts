import { useEffect, useRef } from "react";

// Reads the JS bundle filename hash from the page's <script> tags.
// This is baked into index.html at deploy time — it's what the PWA is ACTUALLY running.
function getLocalJsHash(): string {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
  for (const s of scripts) {
    const m = s.src.match(/\/assets\/index-([A-Za-z0-9]+)\.js/);
    if (m) return m[1];
  }
  return "";
}

// Fetches the live index.html from the server (no-store) and extracts the
// JS hash the server expects. If it differs from what we're running → stale PWA cache.
async function fetchServerJsHash(): Promise<string> {
  try {
    const r = await fetch("/", { cache: "no-store", headers: { "Accept": "text/html" } });
    if (!r.ok) return "";
    const html = await r.text();
    const m = html.match(/\/assets\/index-([A-Za-z0-9]+)\.js/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

export function useVersionCheck() {
  const hasFired = useRef(false);

  useEffect(() => {
    // Only run once per session — avoid any loop
    if (hasFired.current) return;
    hasFired.current = true;

    async function check() {
      const local = getLocalJsHash();
      if (!local) return; // can't determine local version, skip

      const server = await fetchServerJsHash();
      if (!server) return; // server not reachable, skip

      if (local !== server) {
        console.log(`[CIQ] Stale PWA cache — running ${local}, server has ${server}. Reloading.`);
        // Clear any browser/PWA caches then hard-reload
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        // Use location.replace so back button doesn't re-trigger
        window.location.replace(window.location.href);
      }
    }

    // Delay slightly so app renders first — don't block initial paint
    const t = setTimeout(check, 3000);
    return () => clearTimeout(t);
  }, []);
}
