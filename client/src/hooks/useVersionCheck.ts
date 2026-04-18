import { useEffect, useRef } from "react";

// Reads the JS bundle filename from the page — this is the "current" version
// baked into the HTML at deploy time.
function getLocalVersion(): string {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
  for (const s of scripts) {
    const m = s.src.match(/index-([A-Za-z0-9]+)\.js/);
    if (m) return m[1];
  }
  return "";
}

// Fetches /api/version from the server — returns the hash of the LATEST build.
async function fetchServerVersion(): Promise<string> {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return "";
    const d = await r.json();
    return d.version ?? "";
  } catch {
    return "";
  }
}

// On every deploy, the server's BUILD_HASH changes (it falls back to startup
// timestamp). If the PWA has cached an old index.html pointing at old JS, the
// local hash and server hash will differ → hard reload to pick up new bundle.
export function useVersionCheck() {
  const localVersion = useRef(getLocalVersion());
  const checked = useRef(false);

  useEffect(() => {
    async function check() {
      if (checked.current) return;
      checked.current = true;

      const serverVersion = await fetchServerVersion();
      if (!serverVersion) return; // server not available, skip

      const local = localVersion.current;
      // If local hash doesn't match server version, we're running stale JS
      if (local && serverVersion && local !== serverVersion) {
        console.log(`[CIQ] Version mismatch — local:${local} server:${serverVersion} — reloading`);
        // Clear caches if available, then hard reload
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        window.location.reload();
      }
    }

    // Check immediately on mount
    check();

    // Also check every 5 minutes in case user leaves app open for hours
    const interval = setInterval(() => {
      checked.current = false;
      check();
    }, 5 * 60_000);

    return () => clearInterval(interval);
  }, []);
}
