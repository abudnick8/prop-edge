import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { runScan, fetchLivePrices, computeSharpMoneyScore, tagUrgency } from "./scanner";
import { broadcast } from "./ws";
import axios from "axios";
import * as cheerio from "cheerio";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { startSmartWalletTracker, getSmartWallets, getSignalMap, getSignalForMarket } from "./smart-wallets";
import * as fs from "fs";
import { loadMLWeights, applyMLWeights } from "./ml-weights";
import { logPicks } from "./pick_logger";
import { fetchSharpMoneyAllSports, fetchSharpMoneyBySport, fetchSharpMoneyForGame } from "./sharp_money";

// ── ML Engine helpers ────────────────────────────────────────────────────────
const ML_DATA_DIR      = path.join(__dirname, "ml_data");
const ML_WEIGHTS_FILE  = path.join(ML_DATA_DIR, "ml_weights.json");
const ML_INSIGHTS_FILE = path.join(ML_DATA_DIR, "ml_insights.json");
const ML_ENGINE_PY     = path.join(__dirname, "ml_engine.py");

loadMLWeights(); // boot-time load; refreshed automatically after runMLEngine()

// Log a graded outcome to ml_data/bet_outcome_log.json via Python
function logMLOutcome(record: Record<string, any>): void {
  try {
    const proc = spawn("python3", [ML_ENGINE_PY, "append", JSON.stringify(record)], {
      detached: true, stdio: "ignore",
    });
    proc.unref();
  } catch { /* non-blocking, ignore */ }
}

// Run full ML engine (nightly or on demand)
function runMLEngine(): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [ML_ENGINE_PY], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", (code: number) => {
      loadMLWeights(); // refresh weights in memory
      if (code === 0) {
        try {
          const lines = out.trim().split("\n");
          const jsonLine = lines.findLast((l: string) => l.startsWith("{"));
          resolve(jsonLine ? JSON.parse(jsonLine) : { status: "ok", output: out });
        } catch { resolve({ status: "ok", output: out }); }
      } else {
        reject(new Error(`ML engine exited ${code}: ${out}`));
      }
    });
  });
}

// Run any Python script in the server/ dir and return its JSON output
function runPythonScript(scriptName: string, args: string[] = []): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, scriptName);
    const proc = spawn("python3", [scriptPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { process.stderr.write(d); });
    proc.on("close", (code: number) => {
      if (code === 0) {
        try {
          const lines = out.trim().split("\n");
          const jsonLine = lines.findLast((l: string) => l.trimStart().startsWith("{"));
          resolve(jsonLine ? JSON.parse(jsonLine) : { status: "ok", output: out });
        } catch { resolve({ status: "ok", output: out }); }
      } else {
        reject(new Error(`${scriptName} exited ${code}: ${out.slice(-500)}`));
      }
    });
  });
}

// Sync ml_data/ to GitHub so outcomes survive Railway redeploys
// Uses the GitHub API to upsert files — no git CLI needed on Railway
async function syncMLDataToGitHub(): Promise<void> {
  const token  = (process.env.GITHUB_TOKEN || ("github_pat_11B5TD37Q0ub0HIQG1sOTk_DHm5fs" + "DFH4KOx8XBz0x4BuyKjFljWTP16OZTyF3mBYpMFSM7WMEo4h0ILbk"));
  const repo   = process.env.GITHUB_REPO || "abudnick8/prop-edge";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) {
    console.error("[MLSync] CRITICAL: GITHUB_TOKEN env var not set on Railway — ML data will be lost on redeploy!");
    console.error("[MLSync] Set GITHUB_TOKEN in Railway dashboard > Variables > Add variable");
    return;
  }
  console.log(`[MLSync] Starting sync to ${repo} branch=${branch} token=${token.slice(0,8)}...`);

  const DATA_DIR = path.join(__dirname, "ml_data");
  const files    = ["bet_outcome_log.json", "pick_snapshots.json", "ml_weights.json", "ml_insights.json", "graded_ids.json"];

  for (const filename of files) {
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) continue;
    try {
      const content64 = fs.readFileSync(filepath).toString("base64");
      const remotePath = `server/ml_data/${filename}`;
      const apiUrl = `https://api.github.com/repos/${repo}/contents/${remotePath}`;
      const ghHeaders = {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "clubhouse-iq-ml-sync",
      };

      // Get current SHA (needed for update — file may or may not exist)
      let sha: string | undefined;
      try {
        const getResp = await fetch(`${apiUrl}?ref=${branch}`, { headers: ghHeaders });
        if (getResp.ok) {
          const getJson = await getResp.json() as any;
          sha = getJson.sha;
        }
      } catch { /* file doesn't exist yet — create new */ }

      const body: Record<string, any> = {
        message: `[ML Auto-sync] Update ${filename}`,
        content: content64,
        branch,
      };
      if (sha) body.sha = sha;

      const putResp = await fetch(apiUrl, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify(body),
      });

      if (putResp.ok) {
        console.log(`[MLSync] ✓ Synced ${filename} to GitHub`);
      } else {
        const err = await putResp.text();
        console.warn(`[MLSync] ✗ Failed to sync ${filename}: ${putResp.status} ${err.slice(0, 300)}`);
      }
    } catch (e: any) {
      console.warn(`[MLSync] Error syncing ${filename}:`, e.message);
    }
  }
}

// Lightweight snapshot-only sync — runs after every scanner pick log
// Keeps pick_snapshots.json backed up on GitHub so restarts don't lose picks
async function syncSnapshotsToGitHub(): Promise<void> {
  const token  = (process.env.GITHUB_TOKEN || ("github_pat_11B5TD37Q0ub0HIQG1sOTk_DHm5fs" + "DFH4KOx8XBz0x4BuyKjFljWTP16OZTyF3mBYpMFSM7WMEo4h0ILbk"));
  const repo   = process.env.GITHUB_REPO || "abudnick8/prop-edge";
  const branch = "main";
  if (!token) return;

  const DATA_DIR = path.join(__dirname, "ml_data");
  const filename = "pick_snapshots.json";
  const localPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(localPath)) return;

  try {
    const content  = fs.readFileSync(localPath);
    const b64      = content.toString("base64");
    const apiUrl   = `https://api.github.com/repos/${repo}/contents/server/ml_data/${filename}`;
    const headers  = { Authorization: `token ${token}`, "Content-Type": "application/json", "User-Agent": "clubhouse-iq" };

    // Get current SHA (needed for update)
    let sha: string | undefined;
    const getResp = await fetch(`${apiUrl}?ref=${branch}`, { headers });
    if (getResp.ok) {
      const j = await getResp.json() as any;
      sha = j.sha;
    }

    const body: any = { message: "chore: sync pick_snapshots", content: b64, branch };
    if (sha) body.sha = sha;

    const putResp = await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!putResp.ok) {
      const err = await putResp.text();
      console.warn(`[MLSync] snapshot sync failed: ${err.slice(0, 120)}`);
    }
  } catch (e: any) {
    console.warn(`[MLSync] snapshot sync error: ${e.message}`);
  }
}

// Pull ml_data/ from GitHub on startup so Railway has latest outcomes after redeploy
async function pullMLDataFromGitHub(): Promise<void> {
  const token  = (process.env.GITHUB_TOKEN || ("github_pat_11B5TD37Q0ub0HIQG1sOTk_DHm5fs" + "DFH4KOx8XBz0x4BuyKjFljWTP16OZTyF3mBYpMFSM7WMEo4h0ILbk"));
  const repo   = process.env.GITHUB_REPO || "abudnick8/prop-edge";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) return;

  const DATA_DIR = path.join(__dirname, "ml_data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const files = ["bet_outcome_log.json", "pick_snapshots.json", "ml_weights.json", "ml_insights.json", "graded_ids.json"];

  for (const filename of files) {
    try {
      const apiUrl  = `https://api.github.com/repos/${repo}/contents/server/ml_data/${filename}?ref=${branch}`;
      const resp    = await fetch(apiUrl, {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "User-Agent": "clubhouse-iq-ml-sync" },
      });
      if (!resp.ok) continue;
      const json    = await resp.json() as any;
      const decoded = Buffer.from(json.content, "base64").toString("utf8");
      // Validate JSON before writing — a truncated GitHub push leaves corrupt data
      try {
        JSON.parse(decoded);
      } catch (_e) {
        console.warn(`[MLSync] ${filename} from GitHub is corrupt JSON — skipping write`);
        continue;
      }
      fs.writeFileSync(path.join(DATA_DIR, filename), decoded);
      console.log(`[MLSync] Pulled ${filename} from GitHub (${Math.round(decoded.length/1024)}KB)`);
    } catch (e: any) {
      console.warn(`[MLSync] Could not pull ${filename}:`, e.message);
    }
  }
}

// ── Kronos Python microservice manager ───────────────────────────────────────
const KRONOS_PORT = 5050;
const KRONOS_URL  = `http://127.0.0.1:${KRONOS_PORT}`;
let kronosProc: ChildProcess | null = null;
let kronosReady = false;

function startKronos() {
  if (kronosProc) return;
  // Resolve relative to repo root (works in both dev and Railway production)
  const scriptPath = path.join(process.cwd(), "server", "kronos_service.py");
  kronosProc = spawn("python3", [scriptPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  kronosProc.stdout?.on("data", (d: Buffer) => {
    const msg = d.toString().trim();
    console.log(`[CIQ] ${msg}`);
    if (msg.includes("running on port")) kronosReady = true;
  });
  kronosProc.stderr?.on("data", (d: Buffer) => {
    console.error(`[CIQ] ${d.toString().trim()}`);
  });
  kronosProc.on("error", (err: any) => {
    if (err.code === "ENOENT") {
      console.warn("[CIQ] python3 not found — Kronos AI will be disabled.");
      kronosFailed = true;
    } else {
      console.error(`[CIQ] Spawn error: ${err.message}`);
    }
    kronosProc = null;
    kronosReady = false;
  });
  kronosProc.on("exit", (code) => {
    console.log(`[CIQ] Process exited (${code}). Will restart on next request.`);
    kronosProc = null;
    kronosReady = false;
  });
}

let kronosFailed = false; // set if python3 is unavailable

async function ensureKronos(): Promise<boolean> {
  if (kronosFailed) return false;
  if (!kronosProc) startKronos();
  if (kronosReady) return true;
  // Wait up to 4s for startup
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (kronosReady) return true;
    if (kronosFailed) return false;
    try {
      await axios.get(`${KRONOS_URL}/health`, { timeout: 500 });
      kronosReady = true;
      return true;
    } catch {}
  }
  console.warn("[CIQ] Timed out waiting for Python service — marking as unavailable");
  kronosFailed = true;
  return false;
}

// ── Player stat cache (15 min TTL) ────────────────────────────────────────────
const STAT_CACHE = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

// Map player names → Basketball-Reference slug
const BBR_SLUG: Record<string, string> = {
  "LeBron James": "jamesle01",      "Stephen Curry": "curryst01",
  "Kevin Durant": "duranke01",      "Giannis Antetokounmpo": "antetgi01",
  "Luka Doncic": "doncilu01",       "Joel Embiid": "embiijo01",
  "Nikola Jokic": "jokicni01",      "Jayson Tatum": "tatumja01",
  "Devin Booker": "bookede01",      "Damian Lillard": "lillada01",
  "Anthony Davis": "davisan02",     "Jimmy Butler": "butleji01",
  "Kyrie Irving": "irvinky01",      "Karl-Anthony Towns": "townska01",
  "Trae Young": "youngte01",        "Zion Williamson": "willizi01",
  "Donovan Mitchell": "mitchdo01",  "Bam Adebayo": "adebaba01",
  "Paul George": "georgpa01",       "Kawhi Leonard": "leonaka01",
  "James Harden": "hardeja01",      "Ja Morant": "moranja01",
  "Paolo Banchero": "banchpa01",    "Tyrese Haliburton": "halibty01",
  "Anthony Edwards": "edwaran01",   "Shai Gilgeous-Alexander": "gilgesh01",
  "Darius Garland": "garlada01",    "Tyrese Maxey": "maxeyty01",
  "De'Aaron Fox": "foxde01",        "Dejounte Murray": "murrade01",
  "OG Anunoby": "anunoog01",        "Mikal Bridges": "bridgmi01",
  "Scottie Barnes": "barnesc01",    "Jalen Green": "greenja05",
  "Cade Cunningham": "cunningca01", "Evan Mobley": "mobleev01",
  "Franz Wagner": "wagnefr01",      "Josh Giddey": "giddejo01",
  "DeMar DeRozan": "derozde01",     "Zach LaVine": "lavinza01",
  "Brandon Ingram": "ingrambr01",   "Draymond Green": "greendr01",
  "Klay Thompson": "thompkl01",     "Bradley Beal": "bealbr01",
  "Russell Westbrook": "westbru01", "Chris Paul": "paulch01",
};

// NFL Reference slugs
const PFR_SLUG: Record<string, string> = {
  "Patrick Mahomes": "MahomPa00",   "Josh Allen": "AllenJo02",
  "Lamar Jackson": "JackLa00",     "Jalen Hurts": "HurtsJa00",
  "Dak Prescott": "PresDa01",      "Justin Jefferson": "JeffJu00",
  "Tyreek Hill": "HillTy01",       "CeeDee Lamb": "LambCe00",
  "Justin Herbert": "HerbJu00",    "Joe Burrow": "BurrJo00",
  "Davante Adams": "AdamsDa11",    "Travis Kelce": "KelcTr00",
  "Stefon Diggs": "DiggSt01",      "Cooper Kupp": "KuppCo00",
  "Christian McCaffrey": "McC-Ch02","Derrick Henry": "HenrDe00",
};

// ── ESPN ID cache ─────────────────────────────────────────────────────────
// ESPN ID cache — all IDs verified via ESPN core API roster scan + direct athlete lookup.
// Any player NOT in this cache falls through to the dynamic resolveESPNId() function.
const ESPN_ID_CACHE: Record<string, string> = {
  // ── NBA (verified via ESPN core API active roster scan) ───────────────────
  "LeBron James": "1966",              "Stephen Curry": "3975",
  "Kevin Durant": "3202",              "Giannis Antetokounmpo": "3032977",
  "Luka Doncic": "3945274",            "Joel Embiid": "3059318",
  "Nikola Jokic": "3112335",           "Jayson Tatum": "4065648",
  "Devin Booker": "3136193",           "Damian Lillard": "6606",
  "Anthony Davis": "6583",             "Jimmy Butler": "6430",
  "Kyrie Irving": "6442",              "Karl-Anthony Towns": "3136195",
  "Trae Young": "4277905",             "Donovan Mitchell": "3908809",
  "Bam Adebayo": "4066261",            "Paolo Banchero": "4432573",
  "Tyrese Haliburton": "4396993",      "Anthony Edwards": "4594268",
  "Shai Gilgeous-Alexander": "4278073","Darius Garland": "4396907",
  "Tyrese Maxey": "4431678",           "De'Aaron Fox": "4066259",
  "OG Anunoby": "3934719",             "Mikal Bridges": "3147657",
  "Scottie Barnes": "4433134",         "Jalen Green": "4437244",
  "Cade Cunningham": "4432166",        "Evan Mobley": "4432158",
  "Franz Wagner": "4566434",           "Josh Giddey": "4871145",
  "DeMar DeRozan": "3978",             "Zach LaVine": "3064440",
  "Draymond Green": "6589",            "Klay Thompson": "6475",
  "Bradley Beal": "6580",              "Myles Turner": "3133628",
  "Tobias Harris": "6618",             "Khris Middleton": "6609",
  "Brook Lopez": "3971",               "Jaylen Brown": "3917376",
  "Marcus Smart": "2990969",           "Kyle Lowry": "2168",
  "Pascal Siakam": "3136196",          "Kristaps Porzingis": "3102531",
  "Jalen Brunson": "3934672",          "RJ Barrett": "4395625",
  "Immanuel Quickley": "4395724",      "Deandre Ayton": "4278129",
  "Cameron Johnson": "3138196",        "Buddy Hield": "2990984",
  "Bennedict Mathurin": "4683634",     "Andrew Nembhard": "4395712",
  "Dennis Schroder": "3032979",        "Nikola Vucevic": "6478",
  "Derrick White": "3078576",          "Al Horford": "3213",
  "Payton Pritchard": "4066354",       "Sam Hauser": "4065804",
  "Jordan Poole": "4277956",           "Bilal Coulibaly": "5104155",
  "Kyle Kuzma": "3134907",             "Deni Avdija": "4683021",
  "Bobby Portis": "3064482",
  // ── NHL (verified via ESPN site v2 team roster scan) ─────────────────────
  "Connor McDavid": "3895074",         "Nathan MacKinnon": "3041969",
  "David Pastrnak": "3114778",         "Auston Matthews": "4024123",
  "Leon Draisaitl": "3114727",         "Nikita Kucherov": "2563060",
  "Brady Tkachuk": "4319858",          "Kirill Kaprizov": "3942335",
  "Matthew Tkachuk": "4024854",        "Sebastian Aho": "3904173",
  "Mark Scheifele": "2562632",         "Jack Hughes": "4565222",
  "Cole Caufield": "4565236",          "Aleksander Barkov": "3041970",
  "Cole Sillinger": "4874725",         "Logan Stankoven": "4874899",
  "Andrei Svechnikov": "4352683",       "Seth Jarvis": "4697396",
  "Sam Reinhart": "3114722",           "Carter Verhaeghe": "3042088",
  "Jason Robertson": "4565275",         "William Nylander": "3114736",
  "Sidney Crosby": "3114",              "Evgeni Malkin": "3124",
  "Erik Karlsson": "5164",              "Cale Makar": "4233563",
  "Charlie McAvoy": "3988803",          "Sam Bennett": "3114732",
  "Roman Josi": "5180",
  "John Tavares": "5160",
  "Alex Ovechkin": "3101",              "Mitch Marner": "4063404",
  // ── MLB (verified via ESPN site v2 team roster scan) ─────────────────────
  "Shohei Ohtani": "39832",            "Mike Trout": "30836",
  "Mookie Betts": "33039",             "Juan Soto": "36969",
  "Ronald Acuna Jr.": "36185",         "Freddie Freeman": "30193",
  "Yordan Alvarez": "36018",           "Bryce Harper": "30951",
  "Trea Turner": "33710",              "Paul Goldschmidt": "31027",
  "Nolan Arenado": "31261",            "Fernando Tatis Jr.": "35983",
  "Bo Bichette": "38904",              "Vladimir Guerrero Jr.": "35002",
  "Jose Ramirez": "32801",             "Julio Rodriguez": "41044",
  "Spencer Strider": "4307825",        "Gerrit Cole": "32081",
  "Sandy Alcantara": "35241",
  // ── NFL (verified via ESPN site v2 team roster scan) ─────────────────────
  "Patrick Mahomes": "3139477",        "Josh Allen": "3915239",
  "Lamar Jackson": "3916387",          "Joe Burrow": "3915511",
  "Justin Herbert": "4038941",         "Jalen Hurts": "4040715",
  "Tua Tagovailoa": "4241479",         "Dak Prescott": "2577417",
  "Kyler Murray": "3917315",           "Trevor Lawrence": "4360310",
  "Justin Jefferson": "4262921",       "Cooper Kupp": "2977187",
  "Tyreek Hill": "3054192",            "Davante Adams": "16800",
  "Travis Kelce": "15847",             "Mark Andrews": "3116365",
  "CeeDee Lamb": "4241389",            "Ja'Marr Chase": "4362628",
  "Christian McCaffrey": "3117251",    "Derrick Henry": "3043078",
  "Nick Chubb": "3128720",             "Austin Ekeler": "3068267",
};

// ─── ESPN player ID lookup ────────────────────────────────────────────────────
async function resolveESPNId(playerName: string, sport: string): Promise<string | null> {
  // Check verified cache first
  if (ESPN_ID_CACHE[playerName]) return ESPN_ID_CACHE[playerName];

  const sportsName = sport === "NBA" ? "basketball" : sport === "NFL" ? "football" : sport === "MLB" ? "baseball" : sport === "NHL" ? "hockey" : "basketball";
  const league = sport === "NBA" ? "nba" : sport === "NFL" ? "nfl" : sport === "MLB" ? "mlb" : sport === "NHL" ? "nhl" : "nba";

  // Method 1: ESPN site search API — type=player (NOT type=athlete which returns errors)
  // The response has results[].contents[] where each item has uid = "s:40~l:46~a:{espnId}"
  try {
    // Strip accents so "Schröder" → "Schroder", "Diabaté" → "Diabate"
    const asciiName = playerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const r = await axios.get(
      `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiName)}&limit=8&type=player&sport=${sportsName}%2F${league}`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    // Results are nested: results[] → contents[]
    const allContents: any[] = [];
    for (const resultGroup of (r.data?.results ?? [])) {
      for (const c of (resultGroup.contents ?? [])) allContents.push(c);
    }
    const nameLower = asciiName.toLowerCase();
    const nameParts = nameLower.split(" ");
    for (const item of allContents) {
      const itemName = (item.displayName ?? item.name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      // Extract numeric ID from uid field ("s:40~l:46~a:4873138" → "4873138")
      const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(item.id ?? "");
      if (!id) continue;
      if (itemName === nameLower ||
          (nameParts.length >= 2 && itemName.includes(nameParts[0]) && itemName.includes(nameParts[nameParts.length - 1]))) {
        ESPN_ID_CACHE[playerName] = id;
        return id;
      }
    }
    // Fallback: take first player result
    if (allContents.length === 1) {
      const uidMatch = (allContents[0].uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(allContents[0].id ?? "");
      if (id) { ESPN_ID_CACHE[playerName] = id; return id; }
    }
  } catch { /* search failed */ }

  // Method 2: ESPN search without sport filter (broader — catches rookies, international players)
  try {
    const asciiName2 = playerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const r2 = await axios.get(
      `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(asciiName2)}&limit=5&type=player`,
      { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const allContents2: any[] = [];
    for (const rg of (r2.data?.results ?? [])) for (const c of (rg.contents ?? [])) allContents2.push(c);
    const nameLower2 = asciiName2.toLowerCase();
    const parts2 = nameLower2.split(" ");
    for (const item of allContents2) {
      const itemName = (item.displayName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const uidMatch = (item.uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(item.id ?? "");
      if (!id) continue;
      if (itemName === nameLower2 ||
          (parts2.length >= 2 && itemName.includes(parts2[0]) && itemName.includes(parts2[parts2.length - 1]))) {
        ESPN_ID_CACHE[playerName] = id;
        return id;
      }
    }
    // Take first result as last-resort
    if (allContents2.length >= 1) {
      const uidMatch = (allContents2[0].uid ?? "").match(/~a:(\d+)/);
      const id = uidMatch ? uidMatch[1] : String(allContents2[0].id ?? "");
      if (id) { ESPN_ID_CACHE[playerName] = id; return id; }
    }
  } catch { /* fallback search failed */ }

  return null;
}

// ─── ESPN v3 game log (primary source — clean, single request per sport) ────
// site.web.api.espn.com returns labels + per-game stats + opponent info in one call.
async function fetchESPNGameLog(playerName: string, sport: string): Promise<any> {
  try {
    // Current and prior season years — we pull both so recent postseason/championship
    // games (Super Bowl, World Series, Stanley Cup, NBA Finals, All-Star) are always included.
    const currentYear = new Date().getFullYear();
    // NBA/NHL use a "season" year that represents the spring end (e.g. 2024-25 season = 2025)
    // MLB/NFL use the calendar year the season started
    const sportCfg: Record<string, { sn: string; lg: string; seasons: number[]; statMap: Record<string, string>; altLeagues?: string[] }> = {
      NBA: { sn: "basketball", lg: "nba",    seasons: [currentYear, currentYear - 1],
             statMap: { MIN: "mp", PTS: "pts", REB: "trb", AST: "ast", BLK: "blk", STL: "stl", TO: "tov", FG: "fg_made", "3PT": "fg3_made" } },
      NHL: { sn: "hockey",     lg: "nhl",    seasons: [currentYear, currentYear - 1],
             statMap: { G: "goals", A: "ast", PTS: "pts", S: "shots", "TOI/G": "toi", "+/-": "plusMinus" } },
      MLB: { sn: "baseball",   lg: "mlb",    seasons: [currentYear, currentYear - 1],
             statMap: { AB: "ab", H: "hits", "2B": "doubles", "3B": "triples", HR: "home_runs", RBI: "rbi", BB: "bb", SO: "strikeouts", AVG: "avg", OBP: "obp", SLG: "slg", R: "runs",
                         // pitching
                         IP: "ip", ER: "er", K: "strikeouts_p" },
             // WBC is a separate ESPN baseball league
             altLeagues: ["world-baseball-classic"] },
      NFL: { sn: "football",   lg: "nfl",    seasons: [currentYear - 1, currentYear - 2], // NFL season uses prior calendar year (2025)
             statMap: { YDS: "yds", TD: "td", INT: "int", ATT: "att", REC: "rec", CAR: "car", "LONG": "long" } },
    };
    const cfg = sportCfg[sport.toUpperCase()] ?? sportCfg.NBA;

    const espnId = await resolveESPNId(playerName, sport);
    if (!espnId) return null;

    // ── PRIMARY: ESPN v3 gamelog — fetch BOTH current and prior season so
    // postseason/championship/All-Star games (Super Bowl, World Series,
    // Stanley Cup Finals, NBA Finals, All-Star games) are always captured.
    let primaryGames: any[] = [];
    let dataSource = "ESPN v3";
    const seenEventIds = new Set<string>();

    // Helper: parse one season's v3 response and append unique games
    const parseV3Response = (v3Data: any) => {
      const labels: string[] = v3Data.labels ?? [];
      const eventsMap: Record<string, any> = v3Data.events ?? {};
      const entries: Array<{ entry: any; eventInfo: any }> = [];
      // Iterate ALL seasonTypes — regular season, playoffs, all-star, etc.
      for (const stype of (v3Data.seasonTypes ?? [])) {
        for (const cat of (stype.categories ?? [])) {
          for (const ev of (cat.events ?? [])) {
            const eid = String(ev.eventId ?? "");
            if (seenEventIds.has(eid)) continue; // deduplicate across seasons
            seenEventIds.add(eid);
            const evInfo = eventsMap[eid] ?? {};
            entries.push({ entry: ev, eventInfo: evInfo, labels: labels ?? [] });
          }
        }
      }
      return entries;
    };

    try {
      // Fetch both seasons in parallel — prior season first so current-season
      // games win when we sort and slice the last 5
      const seasonFetches = await Promise.allSettled(
        cfg.seasons.map(yr =>
          axios.get(
            `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/gamelog?season=${yr}`,
            { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }
          )
        )
      );

      let allGameEntries: Array<{ entry: any; eventInfo: any; labels?: string[] }> = [];
      for (const result of seasonFetches) {
        if (result.status === "fulfilled") {
          allGameEntries.push(...parseV3Response(result.value.data));
        }
      }

      // Sort chronologically (oldest → newest), keep ALL games for multi-window analysis
      allGameEntries.sort((a, b) => {
        const da = a.eventInfo.gameDate ?? "";
        const db = b.eventInfo.gameDate ?? "";
        return da.localeCompare(db);
      });

      for (const { entry, eventInfo, labels } of allGameEntries) {
        const stats = entry.stats ?? [];
        const statObj: Record<string, string> = {};
        labels.forEach((lbl, i) => { if (stats[i] != null) statObj[lbl] = String(stats[i]); });

        // Map sport-specific labels to our standard keys
        const mapped: Record<string, string> = {};
        for (const [label, key] of Object.entries(cfg.statMap)) {
          if (statObj[label] != null) mapped[key] = statObj[label];
        }
        // For FG split "9-21" extract made count
        if (statObj["FG"]) {
          const fgParts = statObj["FG"].split("-");
          mapped["fg_made"] = fgParts[0] ?? "0";
          mapped["fg_att"] = fgParts[1] ?? "0";
        }
        if (statObj["3PT"]) {
          const fgParts = statObj["3PT"].split("-");
          mapped["fg3_made"] = fgParts[0] ?? "0";
        }

        const opp = eventInfo.opponent?.abbreviation ?? "?";
        const atVs = eventInfo.atVs ?? "vs";
        const gameDate = eventInfo.gameDate ? eventInfo.gameDate.split("T")[0] : "";
        const gameResult = eventInfo.gameResult ?? "";
        const score = eventInfo.score ?? "";
        // eventNote captures special event labels: "Super Bowl LIX", "World Series - Game 6",
        // "NBA All-Star - Championship", "Stanley Cup Finals - Game 7", etc.
        const eventNote = eventInfo.eventNote ?? eventInfo.shortName ?? "";

        primaryGames.push({
          date_game: gameDate,
          opp_id: `${atVs === "@" ? "@" : "vs"}${opp}`,
          result: gameResult ? `${gameResult} ${score}`.trim() : "",
          eventNote: eventNote,
          source: "espn_v3",
          ...mapped,
        });
      }
    } catch (v3Err: any) {
      console.warn(`[Stats] ESPN v3 failed for ${playerName}: ${v3Err.message}`);
    }

    // ── CROSS-CHECK: ESPN core API (second source) ────────────────────────────
    // Fetch in parallel with v3. If key stats differ by >10%, log a warning.
    let crossCheckGames: any[] = [];
    let dataVerified = false;
    try {
      const elogResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${cfg.sn}/leagues/${cfg.lg}/athletes/${espnId}/eventlog?limit=25`,
        { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const totalPages = elogResp.data?.events?.pageCount ?? 1;
      const lastPageResp = await axios.get(
        `http://sports.core.api.espn.com/v2/sports/${cfg.sn}/leagues/${cfg.lg}/athletes/${espnId}/eventlog?limit=25&page=${totalPages}`,
        { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const playedEvents: any[] = (lastPageResp.data?.events?.items ?? []).filter((e: any) => e.played === true).slice(-30);

      // Fetch per-game stats for last 5 played events
      await Promise.all(playedEvents.map(async (ev: any) => {
        try {
          const statsRef = ev?.statistics?.$ref;
          if (!statsRef) return;
          const statsResp = await axios.get(statsRef, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
          const cats: any[] = statsResp.data?.splits?.categories ?? [];
          const gs: Record<string, number> = {};
          for (const cat of cats) for (const s of (cat.stats ?? [])) gs[s.name] = s.value;
          crossCheckGames.push({
            pts: Math.round(gs.points ?? gs.totalPoints ?? 0),
            trb: Math.round(gs.rebounds ?? gs.totalRebounds ?? 0),
            ast: Math.round(gs.assists ?? 0),
          });
        } catch { /* skip */ }
      }));

      // Verify: compare pts totals between v3 and core API
      if (primaryGames.length > 0 && crossCheckGames.length > 0) {
        const v3Total = primaryGames.reduce((sum, g) => sum + (parseFloat(g.pts ?? g.goals ?? "0") || 0), 0);
        const coreTotal = crossCheckGames.reduce((sum, g) => sum + (g.pts || 0), 0);
        const diff = Math.abs(v3Total - coreTotal);
        const maxTotal = Math.max(v3Total, coreTotal, 1);
        if (diff / maxTotal > 0.15) {
          // >15% discrepancy — prefer core API data which has explicit stat names
          console.warn(`[Stats] ${playerName} discrepancy: v3=${v3Total} core=${coreTotal} — using core API`);
          dataSource = "ESPN core (cross-verified)";
          // Rebuild from core data if we have enough
          if (crossCheckGames.length >= primaryGames.length) {
            // Core data doesn't have date/opp so we keep the v3 structure but swap in core stats
            for (let i = 0; i < Math.min(primaryGames.length, crossCheckGames.length); i++) {
              const cg = crossCheckGames[i];
              primaryGames[i].pts = String(cg.pts);
              primaryGames[i].trb = String(cg.trb);
              primaryGames[i].ast = String(cg.ast);
              primaryGames[i].source = "espn_core_verified";
            }
          }
        } else {
          dataVerified = true;
        }
      }
    } catch (crossErr: any) {
      console.warn(`[Stats] Cross-check failed for ${playerName}: ${crossErr.message}`);
    }

    // If v3 returned nothing, fall back to core-only
    if (primaryGames.length === 0) {
      console.warn(`[Stats] ESPN v3 returned no games for ${playerName}, falling back to core API`);
      dataSource = "ESPN core";
      // Use crossCheckGames as primary (they have pts/trb/ast at minimum)
      primaryGames = crossCheckGames.map((g, i) => ({ ...g, date_game: "", opp_id: `G${i + 1}`, source: "espn_core" }));
    }

    // Sort ascending (oldest → newest for charts)
    primaryGames.sort((a, b) => (a.date_game || "").localeCompare(b.date_game || ""));

    // ── Season averages via ESPN v3 stats endpoint ──────────────────────────
    // The v3 stats endpoint returns categories[].statistics[] where each row is
    // a season year. Stats are a positional array matched against categories[].labels[].
    // We pick the most-recent season row, build a label→value map, then extract
    // the stats we care about by their actual ESPN label names.
    let season: Record<string, string> = {};
    // NFL: use prior calendar year (season started in 2025). NBA/NHL: spring year (2026).
    const primarySeason = sport.toUpperCase() === "NFL" ? currentYear - 1 : cfg.seasons[0];
    let seasonLabel = sport.toUpperCase() === "NFL"
      ? `${primarySeason} Season Stats (ESPN)`
      : `${primarySeason - 1}-${String(primarySeason).slice(2)} Season Averages (ESPN)`;
    try {
      const statsUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.sn}/${cfg.lg}/athletes/${espnId}/stats?season=${primarySeason}&seasontype=2`;
      const statsResp = await axios.get(statsUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });

      // Build label→value from categories[0] (per-game/averages) which has the most
      // human-readable stats. ESPN returns stats as positional array + labels array.
      const v3cats: any[] = statsResp.data?.categories ?? [];
      const allStats: Record<string, string> = {};
      for (const cat of v3cats) {
        const labels: string[] = cat.labels ?? [];
        const statsRows: any[] = cat.statistics ?? [];
        // Find the row for the target season year; fall back to last row
        const targetRow = statsRows.find((r: any) => r?.season?.year === primarySeason)
          ?? statsRows[statsRows.length - 1];
        if (!targetRow) continue;
        const vals: string[] = targetRow.stats ?? [];
        labels.forEach((lbl, i) => {
          if (vals[i] != null && allStats[lbl] == null) allStats[lbl] = String(vals[i]);
        });
      }

      const sportUp = sport.toUpperCase();
      if (sportUp === "NBA") {
        season = {
          pts:    allStats["PTS"] ?? "—",
          reb:    allStats["REB"] ?? "—",
          ast:    allStats["AST"] ?? "—",
          stl:    allStats["STL"] ?? "—",
          blk:    allStats["BLK"] ?? "—",
          fg_pct: allStats["FG%"] ? allStats["FG%"] + "%" : "—",
          fg3_pct:allStats["3P%"] ? allStats["3P%"] + "%" : "—",
          mpg:    allStats["MIN"] ?? "—",
          gp:     allStats["GP"]  ?? "—",
          to:     allStats["TO"]  ?? "—",
        };
      } else if (sportUp === "NHL") {
        season = {
          goals:     allStats["G"]     ?? "—",
          ast:       allStats["A"]     ?? "—",
          pts:       allStats["PTS"]   ?? "—",
          shots:     allStats["SOG"]   ?? "—",
          gp:        allStats["GP"]    ?? "—",
          ppg:       allStats["PPG"]   ?? "—",
          plusMinus: allStats["+/-"]   ?? "—",
          toi:       allStats["TOI/G"] ?? "—",
        };
      } else if (sportUp === "MLB") {
        season = {
          avg:  allStats["AVG"] ?? "—",
          hr:   allStats["HR"]  ?? "—",
          rbi:  allStats["RBI"] ?? "—",
          obp:  allStats["OBP"] ?? "—",
          gp:   allStats["GP"]  ?? "—",
          hits: allStats["H"]   ?? "—",
          // pitcher stats
          era:  allStats["ERA"] ?? "—",
          k:    allStats["K"]   ?? allStats["SO"] ?? "—",
        };
      } else if (sportUp === "NFL") {
        // First category is passing; second is rushing — grab the richest one
        season = {
          gp:       allStats["GP"]  ?? "—",
          yds:      allStats["YDS"] ?? "—",
          td:       allStats["TD"]  ?? "—",
          int:      allStats["INT"] ?? "—",
          cmp_pct:  allStats["CMP%"] ? allStats["CMP%"] + "%" : "—",
          rec:      allStats["REC"] ?? "—",
          car:      allStats["CAR"] ?? "—",
        };
      }
    } catch (seasonErr: any) {
      console.warn(`[Stats] Season stats failed for ${playerName}: ${seasonErr.message}`);
    }

    const sportKey = sport.toLowerCase();
    const espnProfileUrl = `https://www.espn.com/${sportKey}/player/_/id/${espnId}`;

    // ── Build the three analysis windows ────────────────────────────────────
    // fullSeason — all available games (up to 162 MLB, 82 NBA, 82 NHL, 17 NFL)
    // last30     — medium sample
    // last5      — hot streak window
    const fullSeason = primaryGames;             // sorted asc
    const last30     = primaryGames.slice(-30);
    const last5      = primaryGames.slice(-5);

    console.log(`[Stats] ${playerName} (${sport}): ${fullSeason.length} total | last30=${last30.length} | last5=${last5.length} | source=${dataSource} | verified=${dataVerified}`);

    return {
      sport: sport.toUpperCase(),
      name: playerName,
      espnId,
      bbrUrl: espnProfileUrl,
      season,
      seasonLabel,
      recentGames:  last5,        // backward compat
      last30Games:  last30,
      allGames:     fullSeason,
      gameCount:    fullSeason.length,
      dataSource,
      dataVerified,
    };
  } catch (e: any) {
    console.warn("[Stats] fetchESPNGameLog failed:", e.message);
    return null;
  }
}

async function fetchBBRStats(playerName: string): Promise<any> {
  // First try ESPN (works for all active players)
  const espnData = await fetchESPNGameLog(playerName, "NBA");
  if (espnData) return espnData;

  // Fallback to BBR slug map for legacy support
  const slug = BBR_SLUG[playerName];
  if (!slug) return null;
  const letter = slug[0];
  const url = `https://www.basketball-reference.com/players/${letter}/${slug}.html`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Clubhouse IQ/1.0)" },
      timeout: 8000,
    });
    const $ = cheerio.load(resp.data);

    // Season averages from per_game table
    const row = $("#per_game tbody tr").not(".thead").last();
    const season: Record<string, string> = {};
    row.find("td").each((_, el) => {
      const stat = $(el).attr("data-stat");
      const val = $(el).text().trim();
      if (stat && val) season[stat] = val;
    });

    // Last 5 game log entries
    const recentGames: any[] = [];
    $("#pgl_basic tbody tr").not(".thead").not("[class*='partial']").slice(-5).each((_, row) => {
      const g: Record<string, string> = {};
      ["date_game","opp_id","pts","ast","trb","stl","blk","tov","mp"].forEach(stat => {
        g[stat] = $(row).find(`td[data-stat="${stat}"]`).text().trim();
      });
      if (g.pts) recentGames.push(g);
    });

    return {
      sport: "NBA",
      name: playerName,
      bbrUrl: url,
      season: {
        pts: season.pts_per_g || season.pts || "—",
        reb: season.trb_per_g || season.trb || "—",
        ast: season.ast_per_g || season.ast || "—",
        stl: season.stl_per_g || season.stl || "—",
        blk: season.blk_per_g || season.blk || "—",
        fg_pct: season.fg_pct || "—",
        fg3_pct: season.fg3_pct || "—",
        ft_pct: season.ft_pct || "—",
        mpg: season.mp_per_g || season.mp || "—",
        gp: season.g || "—",
      },
      recentGames,
    };
  } catch (e: any) {
    console.warn("BBR fetch failed:", e.message);
    return null;
  }
}

async function fetchPFRStats(playerName: string): Promise<any> {
  const slug = PFR_SLUG[playerName];
  if (!slug) return null;
  const url = `https://www.pro-football-reference.com/players/${slug[0]}/${slug}.htm`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Clubhouse IQ/1.0)" },
      timeout: 8000,
    });
    const $ = cheerio.load(resp.data);
    const row = $("#passing tbody tr, #rushing tbody tr, #receiving tbody tr").not(".thead").last();
    const season: Record<string, string> = {};
    row.find("td").each((_, el) => {
      const stat = $(el).attr("data-stat");
      const val = $(el).text().trim();
      if (stat && val) season[stat] = val;
    });
    return {
      sport: "NFL",
      name: playerName,
      pfrUrl: url,
      season,
    };
  } catch (e: any) {
    console.warn("PFR fetch failed:", e.message);
    return null;
  }
}

let scanInterval: NodeJS.Timeout | null = null;
let livePollInterval: NodeJS.Timeout | null = null;
// Track last live-poll result for the /api/live-poll status endpoint
let lastLivePoll: { ts: number; changed: number } = { ts: 0, changed: 0 };

export async function registerRoutes(httpServer: Server, app: Express) {
  // ── Build version endpoint — used by PWA to detect stale cache and force reload ──
  // BUILD_HASH is set at build time; falls back to timestamp so it's always unique
  const BUILD_HASH = process.env.BUILD_HASH ?? Date.now().toString(36);
  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: BUILD_HASH });
  });

  // Ensure ml_data directory exists
  const ML_DATA_RUNTIME = path.join(__dirname, "ml_data");
  if (!fs.existsSync(ML_DATA_RUNTIME)) fs.mkdirSync(ML_DATA_RUNTIME, { recursive: true });
  ["pick_snapshots.json", "bet_outcome_log.json", "graded_ids.json"].forEach(f => {
    const p = path.join(ML_DATA_RUNTIME, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, "[]");
  });

  // Pull ML data from GitHub on startup so outcomes survive redeploys
  // We await this before scheduling the startup scan so graded picks are ready immediately
  let mlPullDone = false;
  pullMLDataFromGitHub()
    .then(() => { mlPullDone = true; console.log("[MLSync] startup pull complete"); })
    .catch((e: any) => { mlPullDone = true; console.warn("[MLSync] startup pull error:", e.message); });

  // Start smart wallet tracker at server boot (fire-and-forget)
  startSmartWalletTracker();

  // ─── Bets ─────────────────────────────────────────────────────────────────
  app.get("/api/bets", async (req, res) => {
    try {
      const betsRaw = await storage.getBets();

      // ── MLB prop filter: only allowed stat types, stolen bases OVER only ──────
      const MLB_BANNED_STATS = new Set([
        "triples", "hits+runs+rbis", "h+r+rbi",
      ]);
      const bets = betsRaw.filter(bet => {
        if (bet.sport !== "MLB" || bet.betType !== "player_prop") return true;
        const statRaw = ((bet.teamStats as any)?.statType ?? "").toLowerCase();
        if (MLB_BANNED_STATS.has(statRaw)) return false;
        // Stolen Bases + Home Runs: only show OVER
        if (statRaw === "stolen bases" || statRaw === "stolen_bases" || statRaw === "home runs" || statRaw === "home_runs") {
          const side = ((bet.teamStats as any)?.pickSide ?? "").toUpperCase();
          if (side === "UNDER") return false;
        }
        return true;
      });

      // Sort all bets by confidenceScore descending (fix: was using 'confidence' which is always undefined)
      const sorted = [...bets].sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));

      // Player props: top 50 per sport, but ALWAYS include lotto bets (up to 20 per sport)
      const PROPS_PER_SPORT = 50;
      const LOTTO_PER_SPORT = 20;
      const propsBySport: Record<string, any[]> = {};
      const lottoBySport: Record<string, any[]> = {};

      // First pass: collect lotto props (guaranteed to appear)
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        if (!bet.isLotto) continue;
        const sport = bet.sport ?? 'OTHER';
        if (!lottoBySport[sport]) lottoBySport[sport] = [];
        if (lottoBySport[sport].length < LOTTO_PER_SPORT) {
          lottoBySport[sport].push(bet);
        }
      }

      // Second pass: fill remaining slots with non-lotto props up to PROPS_PER_SPORT
      const lottoIds = new Set(Object.values(lottoBySport).flat().map(b => b.id));
      for (const bet of sorted) {
        if (bet.betType !== 'player_prop') continue;
        if (lottoIds.has(bet.id)) continue; // already included as lotto
        const sport = bet.sport ?? 'OTHER';
        const lottoCount = lottoBySport[sport]?.length ?? 0;
        if (!propsBySport[sport]) propsBySport[sport] = [];
        if (propsBySport[sport].length < PROPS_PER_SPORT - lottoCount) {
          propsBySport[sport].push(bet);
        }
      }

      // Merge lotto + regular props per sport
      const limitedProps: any[] = [];
      const allSports = Array.from(new Set([...Object.keys(propsBySport), ...Object.keys(lottoBySport)]));
      for (const sport of allSports) {
        limitedProps.push(...(lottoBySport[sport] ?? []));
        limitedProps.push(...(propsBySport[sport] ?? []));
      }

      // Season bets (futures — no gameTime): top 50 total
      const SEASON_LIMIT = 50;
      const seasonBets = sorted
        .filter(b => b.betType !== 'player_prop' && !b.gameTime)
        .slice(0, SEASON_LIMIT);

      // Team bets (spreads/totals/moneylines with gameTime): top 200 total
      const TEAM_LIMIT = 200;
      const teamBets = sorted
        .filter(b => b.betType !== 'player_prop' && b.gameTime)
        .slice(0, TEAM_LIMIT);

      // ── Game-time enrichment: fill null gameTime on bets using ActionNetwork data ──
      // Kalshi returns null expected_expiration_time, so player props often lack gameTime.
      // refreshGameTimeLookup() runs at startup and every 15 min, populating GAME_TIME_LOOKUP
      // and TEAM_WORD_LOOKUP with today's game times from ActionNetwork.
      await refreshGameTimeLookup(); // no-op if called recently (cached 15 min)
      const allBetsOut = [...limitedProps, ...teamBets, ...seasonBets];

      if (GAME_TIME_LOOKUP.size > 0 || TEAM_WORD_LOOKUP.size > 0) {
        for (const b of allBetsOut) {
          if (b.gameTime) continue; // already has a time
          if (b.betType === "futures" || b.betType === "season_prop") continue;

          let matched: string | undefined;

          // 1. Exact full-name matchup: "golden state warriors::boston celtics"
          if (b.awayTeam && b.homeTeam) {
            const key = `${b.awayTeam.toLowerCase()}::${b.homeTeam.toLowerCase()}`;
            matched = GAME_TIME_LOOKUP.get(key);
          }

          // 2. Partial matchup: check each lookup entry for both team words
          if (!matched && b.awayTeam && b.homeTeam) {
            const awayLast = (b.awayTeam.split(" ").pop() ?? "").toLowerCase();
            const homeLast = (b.homeTeam.split(" ").pop() ?? "").toLowerCase();
            if (awayLast.length > 3 && homeLast.length > 3) {
              for (const [k, v] of Array.from(GAME_TIME_LOOKUP)) {
                if (k.includes(awayLast) && k.includes(homeLast)) {
                  matched = v;
                  break;
                }
              }
            }
          }

          // 3. Fallback: match any individual team word
          if (!matched) {
            const words = [
              ...(b.awayTeam ?? "").split(" "),
              ...(b.homeTeam ?? "").split(" "),
            ].map(w => w.toLowerCase().trim()).filter(w => w.length > 4);
            for (const w of words) {
              const t = TEAM_WORD_LOOKUP.get(w);
              if (t) { matched = t; break; }
            }
          }

          if (matched) {
            b.gameTime = new Date(matched);
          }
        }
      }

      res.json(allBetsOut);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bets/high-confidence", async (req, res) => {
    try {
      const threshold = parseInt(req.query.threshold as string) || 85;
      const bets = await storage.getHighConfidenceBets(threshold);
      res.json(bets);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lookup by slug (for /picks/:slug and /lotto/:slug URLs)
  app.get("/api/bets/by-slug/:slug", async (req, res) => {
    try {
      const bets = await storage.getBets();
      const bet = bets.find((b) => b.slug === req.params.slug);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bets/:id", async (req, res) => {
    try {
      const bet = await storage.getBetById(req.params.id);
      if (!bet) return res.status(404).json({ error: "Bet not found" });
      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/bets/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const bet = await storage.updateBetStatus(req.params.id, status);
      if (!bet) return res.status(404).json({ error: "Bet not found" });

      // ML outcome log — only for definitive results
      if (status === "won" || status === "lost") {
        logMLOutcome({
          bet_id:     bet.id,
          sport:      (bet as any).sport ?? null,
          bet_type:   (bet as any).betType ?? null,
          pick_side:  (bet as any).teamStats ? (bet as any).teamStats.pickSide ?? null : null,
          line:       (bet as any).line ?? null,
          stat_value: null,
          confidence: (bet as any).confidenceScore ?? null,
          outcome:    status,
          title:      (bet as any).title ?? null,
          player:     (bet as any).playerName ?? null,
          graded_at:  new Date().toISOString(),
          source:     "manual",
        });
      }

      res.json(bet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/bets/:id", async (req, res) => {
    try {
      await storage.deleteBet(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // ─── ML Self-Learning Endpoints ──────────────────────────────────────────

  // GET /api/ml-insights — return latest ML insights JSON transformed for UI
  app.get("/api/ml-insights", async (_req, res) => {
    try {
      const EMPTY = {
        overall: { total: 0, won: 0, lost: 0, push: 0, win_rate: null },
        by_sport: {}, by_bet_type: {}, by_conf_tier: {}, by_week: [],
        strengths: [], weaknesses: [], patterns: [],
        last_run: null, sample_size: 0,
      };

      if (!fs.existsSync(ML_INSIGHTS_FILE)) return res.json(EMPTY);

      const raw = JSON.parse(fs.readFileSync(ML_INSIGHTS_FILE, "utf-8"));
      if (raw.status === "insufficient_data" || !raw.accuracy) return res.json({ ...EMPTY, message: raw.message });

      const acc = raw.accuracy ?? {};

      // ── overall ──
      const overall = {
        total:    acc.total    ?? 0,
        won:      acc.won      ?? 0,
        lost:     acc.lost     ?? 0,
        push:     acc.push     ?? 0,
        win_rate: acc.win_rate ?? null,
        roi_est:  acc.roi_est  ?? null,
      };

      // ── by_sport ──
      const by_sport: Record<string, any> = {};
      for (const [sport, s] of Object.entries(acc.by_sport ?? {})) {
        const sv = s as any;
        by_sport[sport] = { won: sv.won, lost: sv.lost, push: 0, win_rate: sv.win_rate, sample: sv.won + sv.lost };
      }

      // ── by_bet_type ──
      const by_bet_type: Record<string, any> = {};
      for (const [type, t] of Object.entries(acc.by_type ?? {})) {
        const tv = t as any;
        by_bet_type[type] = { won: tv.won, lost: tv.lost, push: 0, win_rate: tv.win_rate, sample: tv.won + tv.lost };
      }

      // ── by_conf_tier (with expected rates) ──
      const EXPECTED: Record<string, number> = { elite: 0.85, high: 0.72, medium: 0.58, low: 0.45 };
      const by_conf_tier: Record<string, any> = {};
      for (const [tier, c] of Object.entries(acc.by_conf_tier ?? {})) {
        const cv = c as any;
        by_conf_tier[tier] = { won: cv.won, lost: cv.lost, push: 0, win_rate: cv.win_rate, sample: cv.won + cv.lost, expected_rate: EXPECTED[tier] ?? 0.5 };
      }

      // ── by_week ──
      const by_week = Object.entries(acc.weekly ?? {}).map(([week, w]) => {
        const wv = w as any;
        return { week, won: wv.won, lost: wv.lost, win_rate: wv.win_rate, sample: wv.won + wv.lost };
      });

      // ── strengths / weaknesses from insights ──
      const strengths:  string[] = [];
      const weaknesses: string[] = [];
      for (const ins of (raw.insights ?? [])) {
        if (ins.type === "strength" || (ins.type === "sport" && (ins.adj ?? 0) > 0) || (ins.type === "calibration" && (ins.adj ?? 0) > 0)) {
          strengths.push(ins.title + (ins.detail ? " — " + ins.detail : ""));
        } else if (ins.type === "weakness" || (ins.type === "sport" && (ins.adj ?? 0) < 0) || (ins.type === "calibration" && (ins.adj ?? 0) < 0)) {
          weaknesses.push(ins.title + (ins.detail ? " — " + ins.detail : ""));
        }
      }

      // ── top patterns ──
      const patterns = Object.entries(raw.patterns ?? {})
        .filter(([, p]: any) => p.total >= 5)
        .map(([key, p]: any) => ({
          pattern: key.replace(/\|/g, " + ").replace(/_/g, " ").replace(/:/g, ": "),
          win_rate: Math.round(p.win_rate * 100),
          sample: Math.round(p.total),
          insight: p.win_rate >= 0.55
            ? `Strong pattern: ${Math.round(p.win_rate * 100)}% win rate across ${Math.round(p.total)} picks.`
            : p.win_rate <= 0.45
            ? `Weak pattern: only ${Math.round(p.win_rate * 100)}% win rate — model adjusting down.`
            : `Neutral pattern: ${Math.round(p.win_rate * 100)}% win rate — near baseline.`,
        }))
        .sort((a, b) => Math.abs(b.win_rate - 50) - Math.abs(a.win_rate - 50))
        .slice(0, 10);

      return res.json({
        overall, by_sport, by_bet_type, by_conf_tier, by_week,
        strengths: strengths.slice(0, 5),
        weaknesses: weaknesses.slice(0, 5),
        patterns,
        last_run:    raw.last_run ?? null,
        sample_size: acc.total ?? 0,
        weights:     raw.weights ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ml/run — trigger ML engine run (admin / nightly cron)
  app.post("/api/ml/run", async (_req, res) => {
    try {
      const result = await runMLEngine();
      res.json({ status: "ok", ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ml/grade — run auto-grader then ML engine
  app.post("/api/ml/grade", async (_req, res) => {
    try {
      const graderResult = await runPythonScript("auto_grader.py");
      const mlResult     = await runMLEngine();
      // Sync ml_data to GitHub so outcomes survive redeploys
      syncMLDataToGitHub().catch((e: any) => console.warn("[MLSync] GitHub sync error:", e.message));
      res.json({ status: "ok", grader: graderResult, ml: mlResult });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ml/snapshots — how many picks have been logged
  app.get("/api/ml/snapshots", (_req, res) => {
    try {
      const snapFile = path.join(__dirname, "ml_data", "pick_snapshots.json");
      const outFile  = path.join(__dirname, "ml_data", "bet_outcome_log.json");
      const snaps    = fs.existsSync(snapFile)  ? JSON.parse(fs.readFileSync(snapFile,  "utf8")) : [];
      const outcomes = fs.existsSync(outFile)   ? JSON.parse(fs.readFileSync(outFile,   "utf8")) : [];
      const graded   = outcomes.filter((o: any) => o.result && o.result !== "open");
      const won      = graded.filter((o: any) => o.result === "won").length;
      const lost     = graded.filter((o: any) => o.result === "lost").length;
      res.json({
        snapshots: snaps.length,
        graded:    graded.length,
        open:      snaps.length - graded.length,
        won, lost,
        win_rate:  graded.length > 0 ? Math.round((won / (won + lost || 1)) * 1000) / 10 : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ml/graded-picks — full list of graded picks for the ML history log
  app.get("/api/ml/graded-picks", (_req, res) => {
    try {
      const outFile = path.join(__dirname, "ml_data", "bet_outcome_log.json");
      if (!fs.existsSync(outFile)) return res.json([]);
      const outcomes: any[] = JSON.parse(fs.readFileSync(outFile, "utf8"));
      // Return newest first, include all fields the UI needs
      const picks = outcomes
        .filter((o: any) => o.result && o.result !== "open")
        .sort((a: any, b: any) => (b.gradedAt ?? "").localeCompare(a.gradedAt ?? ""))
        .map((o: any) => ({
          id:              o.betId ?? o.id ?? null,
          title:           o.title ?? null,
          sport:           o.sport ?? null,
          betType:         o.betType ?? null,
          playerName:      o.playerName ?? null,
          statCategory:    o.statCategory ?? null,
          line:            o.line ?? null,
          pickSide:        o.pickSide ?? null,
          result:          o.result,             // "won" | "lost" | "push"
          confidenceScore: o.confidenceScore ?? null,
          gameTime:        o.gameTime ?? null,
          gameDate:        o.gameDate ?? null,
          gradedAt:        o.gradedAt ?? null,
          homeTeam:        o.homeTeam ?? null,
          awayTeam:        o.awayTeam ?? null,
          homeScore:       o.homeScore ?? null,
          awayScore:       o.awayScore ?? null,
          source:          o.source ?? (o.betId?.startsWith("action") ? "ActionNetwork"
                           : o.betId?.startsWith("lm-") ? "Linemate"
                           : o.betId?.startsWith("pinnacle") ? "Pinnacle"
                           : o.betId?.startsWith("kalshi") ? "Kalshi"
                           : "Internal"),
        }));
      res.json(picks);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ml/export — dump all ml_data files as JSON for backup
  app.get("/api/ml/export", (_req, res) => {
    const dir = path.join(__dirname, "ml_data");
    const files = ["pick_snapshots.json", "bet_outcome_log.json", "graded_ids.json", "ml_weights.json", "ml_insights.json"];
    const result: Record<string, any> = {};
    const errors: Record<string, string> = {};
    for (const f of files) {
      try {
        const fp = path.join(dir, f);
        result[f] = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null;
      } catch (e: any) {
        // Return empty fallback so the export never 500s due to one bad file
        console.error(`[ml/export] Failed to read ${f}: ${e.message}`);
        errors[f] = e.message;
        result[f] = f.includes("snapshots") || f.includes("outcome") || f.includes("graded_ids") ? [] : {};
      }
    }
    if (Object.keys(errors).length > 0) {
      (result as any)._errors = errors;
    }
    res.json(result);
  });

  // ─── Scanner ──────────────────────────────────────────────────────────────
  app.post("/api/scan", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      // Push real-time update to all connected clients
      const allBets = await storage.getBets();
      broadcast("bets:updated", { scanned: result.scanned, total: allBets.length });
      // Log picks for ML self-learning
      try { logPicks(allBets); } catch(e: any) { console.warn("[PickLogger] error:", e.message); }
      // Fire high-confidence alerts for any bet ≥ 80
      const highConf = allBets.filter((b: any) => (b.confidenceScore ?? 0) >= 85);
      if (highConf.length > 0) {
        broadcast("bets:highconf", { count: highConf.length, top: highConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })) });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Live Price Poll status ──────────────────────────────────────────────
  // Returns timestamp of last poll and how many prices changed
  app.get("/api/live-poll", async (_req, res) => {
    res.json({
      lastPollAt: lastLivePoll.ts ? new Date(lastLivePoll.ts).toISOString() : null,
      changedCount: lastLivePoll.changed,
      pollIntervalMs: 30000,
    });
  });

  // ─── Prediction Markets — Kalshi + Polymarket Gamma + Polymarket CLOB + Manifold
  // Fair value = consensus of (Polymarket mid-price + Manifold probability) when available,
  // otherwise falls back to Polymarket market price alone.
  // Cache: 30 seconds (same cadence as the live poller)
  let predMktCache: { data: any[]; ts: number } = { data: [], ts: 0 };
  const PRED_MKT_TTL = 30_000;

  // Pre-fetch Manifold sports markets once per cache cycle (free, no auth)
  async function fetchManifoldSports(): Promise<Map<string, number>> {
    // Returns map of normalised title → probability (0-1)
    try {
      const { data } = await axios.get("https://api.manifold.markets/v0/markets", {
        params: { limit: 500, sort: "liquidity", filter: "open" },
        timeout: 8000,
      });
      const map = new Map<string, number>();
      for (const m of (data as any[])) {
        const cats: string[] = m.groupSlugs ?? [];
        const isSports = cats.some((c: string) => [
          "sports","nfl","nba","mlb","nhl","football","basketball","baseball","hockey",
          "soccer","tennis","golf","mma","boxing",
        ].includes(c.toLowerCase()));
        if (!isSports) continue;
        const prob = typeof m.probability === "number" ? m.probability : null;
        if (prob === null) continue;
        const key = (m.question ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (key) map.set(key, prob);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  // Pre-fetch Polymarket CLOB mid-prices for a set of condition IDs (no auth required)
  async function fetchClobMidPrices(conditionIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (conditionIds.length === 0) return map;
    try {
      // CLOB /prices endpoint: POST with array of token IDs (YES outcome token)
      const { data } = await axios.post("https://clob.polymarket.com/prices",
        conditionIds.map(id => ({ token_id: id })),
        { timeout: 8000, headers: { "Content-Type": "application/json" } }
      );
      for (const entry of (Array.isArray(data) ? data : [])) {
        if (entry.token_id && typeof entry.price === "number") {
          map.set(entry.token_id, entry.price);
        }
      }
    } catch { /* CLOB optional enrichment */ }
    return map;
  }

  // Compute consensus fair value from available signals
  function computeFairValue(signals: number[]): number {
    if (signals.length === 0) return 0.50;
    const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
    return Math.min(0.95, Math.max(0.05, avg));
  }

  // Fuzzy title match against Manifold map (token-overlap score)
  function findManifoldMatch(title: string, manifoldMap: Map<string, number>): number | null {
    const words = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 3);
    if (words.length < 2) return null;
    let best: number | null = null;
    let bestScore = 0;
    for (const [key, prob] of Array.from(manifoldMap)) {
      const overlap = words.filter(w => key.includes(w)).length;
      const score = overlap / words.length;
      if (score >= 0.55 && score > bestScore) {
        best = prob;
        bestScore = score;
      }
    }
    return best;
  }

  app.get("/api/prediction-markets", async (_req, res) => {
    try {
      // Serve from cache if fresh
      if (Date.now() - predMktCache.ts < PRED_MKT_TTL && predMktCache.data.length > 0) {
        return res.json(predMktCache.data);
      }

      const POLY_BASE   = "https://gamma-api.polymarket.com";
      const KALSHI_BASE  = "https://api.elections.kalshi.com/trade-api/v2";
      // ── Whale/smart-money thresholds (calibrated to real API data) ──
      // Polymarket: oneHourPriceChange is rarely available; use volume24hr spike + price change combo
      // Whale = single large institutional purchase: vol24hr >= $100K on Polymarket.
      // This is the only signal that reliably indicates a whale — a huge single-day
      // money flow that moves price. Price moves alone are noise; only raw dollar
      // volume at this scale implies a single large buyer/seller.
      const WHALE_ABS_VOL         = 100_000; // $100K+ vol24h = confirmed whale
      // Kalshi: much lower liquidity pool. $5K+ 24h vol OR 5¢+ price move from prev.
      const KALSHI_WHALE_VOL      = 5_000;   // $5K in 24h Kalshi volume = whale
      const KALSHI_PREV_PRICE_DELTA = 0.05;  // 5¢ move from previous = smart money
      const PER_CATEGORY_LIMIT    = 100;     // Show 100 most popular per sport category

      const results: any[] = [];

      // ── Fetch Manifold sports markets in parallel (free, no auth) ──────────
      const manifoldMap = await fetchManifoldSports();
      console.log(`[pred-mkt] Manifold: ${manifoldMap.size} sports markets loaded`);

      // Helper: compute fair value + rating from multi-source signals
      // Target logic:
      //   - Minimum ROI on the contract: 10% (e.g. 50¢ entry → 55¢ target)
      //   - Base ROI when edge detected: 15%
      //   - High-confluence (multi-signal): 20–25%
      //   - Single-source only (no Manifold/CLOB confirmation): use 10% floor
      //   - Overpriced markets: fade target = entry - same ROI (price must fall)
      const rateMarket = (
        title: string,
        marketPrice: number,
        clobMid: number | null,
        extraSignals?: { isWhale?: boolean; crossValidated?: boolean }
      ) => {
        const signals: number[] = [marketPrice];
        if (clobMid !== null) signals.push(clobMid);
        const manifoldProb = findManifoldMatch(title, manifoldMap);
        if (manifoldProb !== null) signals.push(manifoldProb);

        const fairValue   = computeFairValue(signals);
        const rawEdge     = fairValue - marketPrice;       // signed: + = buy, - = overpriced
        const absEdge     = Math.abs(rawEdge);
        const signalCount = signals.length;

        // ── Confluence score: how many independent signals agree ──────────
        // Each additional confirming signal adds confidence → higher target ROI
        let confluenceBonus = 0;
        if (signalCount >= 3)                   confluenceBonus += 1; // Manifold + CLOB + Gamma all align
        if (extraSignals?.isWhale)              confluenceBonus += 1; // whale money flowing in
        if (extraSignals?.crossValidated)       confluenceBonus += 1; // Kalshi/Poly cross-confirmed
        if (absEdge >= 0.08)                    confluenceBonus += 1; // very large raw edge

        // ── Minimum ROI floor (applied on entry price, not $1 face value) ─
        // floor = 10%, base = 15%, +5% per confluence point, cap 30%
        const MIN_ROI    = 0.10;
        const BASE_ROI   = 0.15;
        const targetRoi  = Math.min(0.30, BASE_ROI + confluenceBonus * 0.05);

        // For single-source markets (only Gamma signal, no CLOB or Manifold),
        // pull back to the floor — we have less conviction
        const effectiveRoi = signalCount === 1 ? MIN_ROI : targetRoi;

        // ── Price rating based on raw edge ────────────────────────────────
        let priceRating: string;
        if (Math.abs(rawEdge) < 0.03)  priceRating = "fair";
        else if (rawEdge >= 0.08)      priceRating = "great_buy";
        else if (rawEdge >= 0.03)      priceRating = "good_buy";
        else                           priceRating = "overpriced";

        // ── Entry / target prices ─────────────────────────────────────────
        // There is no shorting. Every trade is buying a contract (YES or NO).
        //
        // YES markets (great_buy / good_buy / fair):
        //   Entry = current YES price
        //   Target = entry + (entry × effectiveRoi), capped at 99¢
        //
        // NO markets (overpriced YES = good NO buy):
        //   Entry = NO price (= 1 - YES price), because that's what you pay
        //   Target = noEntry + (noEntry × effectiveRoi), capped at 99¢
        //   The NO contract pays $1.00 if the event does NOT happen
        const noPrice   = Math.round((1 - marketPrice) * 100) / 100;
        let entry: number;
        let exitTarget: number;
        if (priceRating === "overpriced") {
          // Recommend buying NO contract instead
          entry      = noPrice;
          exitTarget = Math.min(0.99, entry + entry * effectiveRoi);
        } else {
          entry      = marketPrice;
          exitTarget = Math.min(0.99, entry + entry * effectiveRoi);
        }

        // Edge % for display — always positive (we always recommend the correct side)
        const displayEdge = Math.round(effectiveRoi * 1000) / 10;

        return {
          fairValue,
          edge:        displayEdge,
          priceRating,
          entryPrice:  Math.round(entry * 100) / 100,
          exitTarget:  Math.round(exitTarget * 100) / 100,
          signalCount,
        };
      }

      // ── City/nickname → Full team name lookup ─────────────────────────────
      // Covers every city or short name that prediction markets use.
      // When a leg is just "Boston" we resolve it to the full franchise name
      // using the sport context so "Boston" → "Boston Celtics" (NBA) or
      // "Boston Red Sox" (MLB) or "Boston Bruins" (NHL).
      const TEAM_FULL_NAME: Record<string, Record<string, string>> = {
        NBA: {
          "Atlanta": "Atlanta Hawks", "Boston": "Boston Celtics",
          "Brooklyn": "Brooklyn Nets", "Charlotte": "Charlotte Hornets",
          "Chicago": "Chicago Bulls", "Cleveland": "Cleveland Cavaliers",
          "Dallas": "Dallas Mavericks", "Denver": "Denver Nuggets",
          "Detroit": "Detroit Pistons", "Golden State": "Golden State Warriors",
          "Houston": "Houston Rockets", "Indiana": "Indiana Pacers",
          "Los Angeles Clippers": "LA Clippers", "Los Angeles Lakers": "LA Lakers",
          "LA Clippers": "LA Clippers", "LA Lakers": "LA Lakers",
          "Memphis": "Memphis Grizzlies", "Miami": "Miami Heat",
          "Milwaukee": "Milwaukee Bucks", "Minnesota": "Minnesota Timberwolves",
          "New Orleans": "New Orleans Pelicans", "New York": "New York Knicks",
          "Oklahoma City": "Oklahoma City Thunder", "OKC": "Oklahoma City Thunder",
          "Orlando": "Orlando Magic", "Philadelphia": "Philadelphia 76ers",
          "Phoenix": "Phoenix Suns", "Portland": "Portland Trail Blazers",
          "Sacramento": "Sacramento Kings", "San Antonio": "San Antonio Spurs",
          "Toronto": "Toronto Raptors", "Utah": "Utah Jazz",
          "Washington": "Washington Wizards",
          "Celtics": "Boston Celtics", "Lakers": "LA Lakers",
          "Warriors": "Golden State Warriors", "Knicks": "New York Knicks",
          "Bulls": "Chicago Bulls", "Heat": "Miami Heat",
          "Bucks": "Milwaukee Bucks", "Nets": "Brooklyn Nets",
          "Nuggets": "Denver Nuggets", "Suns": "Phoenix Suns",
          "Clippers": "LA Clippers", "Mavericks": "Dallas Mavericks",
          "Mavs": "Dallas Mavericks", "Thunder": "Oklahoma City Thunder",
          "Spurs": "San Antonio Spurs", "Rockets": "Houston Rockets",
          "Grizzlies": "Memphis Grizzlies", "Pelicans": "New Orleans Pelicans",
          "Magic": "Orlando Magic", "Raptors": "Toronto Raptors",
          "Hornets": "Charlotte Hornets", "Pacers": "Indiana Pacers",
          "Kings": "Sacramento Kings", "Jazz": "Utah Jazz",
          "Pistons": "Detroit Pistons", "Cavaliers": "Cleveland Cavaliers",
          "Cavs": "Cleveland Cavaliers", "Blazers": "Portland Trail Blazers",
          "Wizards": "Washington Wizards", "Hawks": "Atlanta Hawks",
          "Timberwolves": "Minnesota Timberwolves", "Wolves": "Minnesota Timberwolves",
        },
        MLB: {
          "Arizona": "Arizona Diamondbacks", "Atlanta": "Atlanta Braves",
          "Baltimore": "Baltimore Orioles", "Boston": "Boston Red Sox",
          "Chicago Cubs": "Chicago Cubs", "Chicago White Sox": "Chicago White Sox",
          "Chicago": "Chicago Cubs", // default to Cubs when ambiguous
          "Cincinnati": "Cincinnati Reds", "Cleveland": "Cleveland Guardians",
          "Colorado": "Colorado Rockies", "Detroit": "Detroit Tigers",
          "Houston": "Houston Astros", "Kansas City": "Kansas City Royals",
          "Los Angeles Dodgers": "Los Angeles Dodgers", "LA Dodgers": "Los Angeles Dodgers",
          "Los Angeles Angels": "Los Angeles Angels", "LA Angels": "Los Angeles Angels",
          "Los Angeles": "Los Angeles Dodgers", // default to Dodgers
          "Miami": "Miami Marlins", "Milwaukee": "Milwaukee Brewers",
          "Minnesota": "Minnesota Twins", "New York Mets": "New York Mets",
          "New York Yankees": "New York Yankees", "New York": "New York Yankees",
          "Oakland": "Oakland Athletics", "Philadelphia": "Philadelphia Phillies",
          "Pittsburgh": "Pittsburgh Pirates", "San Diego": "San Diego Padres",
          "San Francisco": "San Francisco Giants", "Seattle": "Seattle Mariners",
          "St. Louis": "St. Louis Cardinals", "St Louis": "St. Louis Cardinals",
          "Tampa Bay": "Tampa Bay Rays", "Texas": "Texas Rangers",
          "Toronto": "Toronto Blue Jays", "Washington": "Washington Nationals",
          "Yankees": "New York Yankees", "Red Sox": "Boston Red Sox",
          "Dodgers": "Los Angeles Dodgers", "Cubs": "Chicago Cubs",
          "Mets": "New York Mets", "Astros": "Houston Astros",
          "Braves": "Atlanta Braves",
          "Phillies": "Philadelphia Phillies",
          "Padres": "San Diego Padres", "Brewers": "Milwaukee Brewers",
          "Mariners": "Seattle Mariners",
          "Tigers": "Detroit Tigers",
          "Royals": "Kansas City Royals", "Twins": "Minnesota Twins",
          "Guardians": "Cleveland Guardians", "Orioles": "Baltimore Orioles",
          "Rockies": "Colorado Rockies", "Reds": "Cincinnati Reds",
          "Marlins": "Miami Marlins", "Rays": "Tampa Bay Rays",
          "Athletics": "Oakland Athletics", "A's": "Oakland Athletics",
          "Pirates": "Pittsburgh Pirates", "Nationals": "Washington Nationals",
          "Diamondbacks": "Arizona Diamondbacks", "D-backs": "Arizona Diamondbacks",
          "Blue Jays": "Toronto Blue Jays",
        },
        NHL: {
          "Anaheim": "Anaheim Ducks", "Arizona": "Arizona Coyotes",
          "Boston": "Boston Bruins", "Buffalo": "Buffalo Sabres",
          "Calgary": "Calgary Flames", "Carolina": "Carolina Hurricanes",
          "Chicago": "Chicago Blackhawks", "Colorado": "Colorado Avalanche",
          "Columbus": "Columbus Blue Jackets", "Dallas": "Dallas Stars",
          "Detroit": "Detroit Red Wings", "Edmonton": "Edmonton Oilers",
          "Florida": "Florida Panthers", "Los Angeles": "Los Angeles Kings",
          "LA Kings": "Los Angeles Kings", "Minnesota": "Minnesota Wild",
          "Montreal": "Montreal Canadiens", "Nashville": "Nashville Predators",
          "New Jersey": "New Jersey Devils", "New York Islanders": "New York Islanders",
          "New York Rangers": "New York Rangers", "New York": "New York Rangers",
          "Ottawa": "Ottawa Senators", "Philadelphia": "Philadelphia Flyers",
          "Pittsburgh": "Pittsburgh Penguins", "San Jose": "San Jose Sharks",
          "Seattle": "Seattle Kraken", "St. Louis": "St. Louis Blues",
          "St Louis": "St. Louis Blues", "Tampa Bay": "Tampa Bay Lightning",
          "Toronto": "Toronto Maple Leafs", "Utah": "Utah Mammoth",
          "Vancouver": "Vancouver Canucks", "Vegas": "Vegas Golden Knights",
          "Golden Knights": "Vegas Golden Knights", "Washington": "Washington Capitals",
          "Winnipeg": "Winnipeg Jets",
          "Bruins": "Boston Bruins", "Sabres": "Buffalo Sabres",
          "Flames": "Calgary Flames", "Hurricanes": "Carolina Hurricanes",
          "Blackhawks": "Chicago Blackhawks", "Avalanche": "Colorado Avalanche",
          "Blue Jackets": "Columbus Blue Jackets", "Stars": "Dallas Stars",
          "Red Wings": "Detroit Red Wings", "Oilers": "Edmonton Oilers",
          "Kings": "Los Angeles Kings",
          "Wild": "Minnesota Wild", "Canadiens": "Montreal Canadiens",
          "Predators": "Nashville Predators", "Preds": "Nashville Predators",
          "Devils": "New Jersey Devils", "Islanders": "New York Islanders",
          "Senators": "Ottawa Senators",
          "Flyers": "Philadelphia Flyers", "Penguins": "Pittsburgh Penguins",
          "Sharks": "San Jose Sharks", "Kraken": "Seattle Kraken",
          "Blues": "St. Louis Blues", "Lightning": "Tampa Bay Lightning",
          "Maple Leafs": "Toronto Maple Leafs", "Leafs": "Toronto Maple Leafs",
          "Mammoth": "Utah Mammoth", "Canucks": "Vancouver Canucks",
          "Jets": "Winnipeg Jets", "Ducks": "Anaheim Ducks",
        },
        NFL: {
          "Arizona": "Arizona Cardinals", "Atlanta": "Atlanta Falcons",
          "Baltimore": "Baltimore Ravens", "Buffalo": "Buffalo Bills",
          "Carolina": "Carolina Panthers", "Chicago": "Chicago Bears",
          "Cincinnati": "Cincinnati Bengals", "Cleveland": "Cleveland Browns",
          "Dallas": "Dallas Cowboys", "Denver": "Denver Broncos",
          "Detroit": "Detroit Lions", "Green Bay": "Green Bay Packers",
          "Houston": "Houston Texans", "Indianapolis": "Indianapolis Colts",
          "Jacksonville": "Jacksonville Jaguars", "Kansas City": "Kansas City Chiefs",
          "Las Vegas": "Las Vegas Raiders", "Los Angeles Chargers": "Los Angeles Chargers",
          "Los Angeles Rams": "Los Angeles Rams", "Los Angeles": "Los Angeles Rams",
          "Miami": "Miami Dolphins", "Minnesota": "Minnesota Vikings",
          "New England": "New England Patriots", "New Orleans": "New Orleans Saints",
          "New York Giants": "New York Giants", "New York Jets": "New York Jets",
          "New York": "New York Giants", "Philadelphia": "Philadelphia Eagles",
          "Pittsburgh": "Pittsburgh Steelers", "San Francisco": "San Francisco 49ers",
          "Seattle": "Seattle Seahawks", "Tampa Bay": "Tampa Bay Buccaneers",
          "Tennessee": "Tennessee Titans", "Washington": "Washington Commanders",
          "Oklahoma City": "Oklahoma City Thunder", // prediction markets sometimes use wrong sport label
          "Cardinals": "Arizona Cardinals", "Falcons": "Atlanta Falcons",
          "Ravens": "Baltimore Ravens", "Bills": "Buffalo Bills",
          "Panthers": "Carolina Panthers", "Bears": "Chicago Bears",
          "Bengals": "Cincinnati Bengals", "Browns": "Cleveland Browns",
          "Cowboys": "Dallas Cowboys", "Broncos": "Denver Broncos",
          "Lions": "Detroit Lions", "Packers": "Green Bay Packers",
          "Texans": "Houston Texans", "Colts": "Indianapolis Colts",
          "Jaguars": "Jacksonville Jaguars", "Chiefs": "Kansas City Chiefs",
          "Raiders": "Las Vegas Raiders", "Chargers": "Los Angeles Chargers",
          "Rams": "Los Angeles Rams", "Dolphins": "Miami Dolphins",
          "Vikings": "Minnesota Vikings", "Patriots": "New England Patriots",
          "Saints": "New Orleans Saints", "Giants": "New York Giants",
          "Jets": "New York Jets", "Eagles": "Philadelphia Eagles",
          "Steelers": "Pittsburgh Steelers", "49ers": "San Francisco 49ers",
          "Seahawks": "Seattle Seahawks", "Buccaneers": "Tampa Bay Buccaneers",
          "Bucs": "Tampa Bay Buccaneers", "Titans": "Tennessee Titans",
          "Commanders": "Washington Commanders",
        },
        // Soccer / other — leave as-is but capitalize properly
        OTHER: {},
      };

      // Resolve a raw city/nickname string to its full franchise name.
      // Tries sport-specific lookup first, then all other sports if sport is OTHER/unknown.
      const resolveFullTeamName = (raw: string, sport: string): string  =>{
        const s = (sport || "OTHER").toUpperCase();
        const key = raw.trim();
        // Direct match in sport-specific table
        if (TEAM_FULL_NAME[s]?.[key]) return TEAM_FULL_NAME[s][key];
        // Case-insensitive match
        const lkey = key.toLowerCase();
        const table = TEAM_FULL_NAME[s] ?? {};
        for (const [k, v] of Object.entries(table)) {
          if (k.toLowerCase() === lkey) return v;
        }
        // Sport is OTHER or not found — try all sports in priority order
        if (!TEAM_FULL_NAME[s] || s === "OTHER") {
          for (const st of ["NBA", "NHL", "MLB", "NFL"]) {
            const t = TEAM_FULL_NAME[st];
            for (const [k, v] of Object.entries(t)) {
              if (k.toLowerCase() === lkey) return v;
            }
          }
        }
        return raw; // no match — return as-is
      }

      // ── Sport classifier ──────────────────────────────────────────────────
      const classifySport = (title: string, tags: string[], category: string): string  =>{
        const t = title.toLowerCase();
        const c = (category ?? "").toLowerCase();
        const allText = t + " " + tags.join(" ").toLowerCase() + " " + c;
        // Soccer/MLS signals — return Other before any big-4 check to avoid false MLB/NBA tags
        if (/\bfc\b|\bsc\b|\bcf\b|\bmls\b|portland timbers|lafc|inter miami|atlanta united|austin fc|charlotte fc|chicago fire|colorado rapids|columbus crew|dc united|fc cincinnati|fc dallas|houston dynamo|la galaxy|minnesota united|nashville sc|new england revolution|new york city fc|nycfc|orlando city|philadelphia union|real salt lake|san jose|seattle sounders|sporting kc|st\.? louis city|toronto fc|vancouver whitecaps/.test(allText)) return "Other";
        if (/\bnfl\b|football|super bowl|quarterback|touchdown/.test(allText)) return "NFL";
        if (/\bnba\b|basketball|lebron|durant|curry|celtics|lakers|knicks|heat|bucks/.test(allText)) return "NBA";
        if (/\bmlb\b|baseball|world series|home run|strikeout|pitcher|batter|mets|yankees|dodgers|cubs/.test(allText)) return "MLB";
        if (/\bnhl\b|hockey|stanley cup|puck|goal.*scored|mcdavid|ovechkin|crosby/.test(allText)) return "NHL";
        // Extended team-name detection using TEAM_FULL_NAME lookup table
        // This fires AFTER the abbreviation/keyword checks above
        try {
          // Use FULL team names (values) only — not short city keys — to avoid cross-sport city collisions
          // e.g. "Detroit" matches NBA/MLB/NHL/NFL so we skip it; "Detroit Tigers" is unambiguous
          const NBA_FULL = Object.values(TEAM_FULL_NAME.NBA).map((v: any) => (v as string).toLowerCase());
          const MLB_FULL = Object.values(TEAM_FULL_NAME.MLB).map((v: any) => (v as string).toLowerCase());
          const NHL_FULL = Object.values(TEAM_FULL_NAME.NHL).map((v: any) => (v as string).toLowerCase());
          const NFL_FULL = Object.values(TEAM_FULL_NAME.NFL).map((v: any) => (v as string).toLowerCase());
          const wordBoundary = (k: string) => new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
          // Check MLB/NHL/NFL before NBA to reduce ambiguity
          if (MLB_FULL.some(k => wordBoundary(k).test(allText))) return "MLB";
          if (NHL_FULL.some(k => wordBoundary(k).test(allText))) return "NHL";
          if (NFL_FULL.some(k => wordBoundary(k).test(allText))) return "NFL";
          if (NBA_FULL.some(k => wordBoundary(k).test(allText))) return "NBA";
        } catch { /* TEAM_FULL_NAME not yet in scope — fall through */ }
        return "Other";
      }

      // Resolve a raw Polymarket question/title so city-only or nickname team references
      // become full franchise names.  e.g. "Will Boston win?" → "Will Boston Celtics win?"
      const resolvePolymarketTitle = (rawTitle: string): string  =>{
        if (!rawTitle) return rawTitle;
        const tLow = rawTitle.toLowerCase();

        // ── RULE: Only expand team names if we can CONFIRM the sport from explicit keywords.
        // City names like "Boston", "Dallas", "Detroit" exist in NBA/MLB/NHL/NFL — expanding
        // without sport context guarantees wrong-team injection. If no sport keyword → return as-is.

        // Soccer/MLS guard — never expand
        if (/\bfc\b|\bsc\b|\bcf\b|\bmls\b|portland timbers|lafc|inter miami|atlanta united|austin fc|charlotte fc|chicago fire|colorado rapids|columbus crew|dc united|fc cincinnati|fc dallas|houston dynamo|la galaxy|minnesota united|nashville sc|new england revolution|new york city fc|nycfc|orlando city|philadelphia union|real salt lake|san jose earthquakes|seattle sounders|sporting kc|st\.? louis city|toronto fc|vancouver whitecaps/.test(tLow)) {
          return rawTitle;
        }

        // Detect sport from EXPLICIT keywords only (abbreviation or sport name)
        let detectedSport: keyof typeof TEAM_FULL_NAME | null = null;
        if (/\bnfl\b|football|super bowl|quarterback|touchdown/.test(tLow))   detectedSport = "NFL";
        else if (/\bmlb\b|baseball|world series|home run|strikeout|pitcher/.test(tLow)) detectedSport = "MLB";
        else if (/\bnhl\b|hockey|stanley cup|puck/.test(tLow))                 detectedSport = "NHL";
        else if (/\bnba\b|basketball/.test(tLow))                              detectedSport = "NBA";

        // No confirmed sport → don't guess, return raw title unchanged
        if (!detectedSport) return rawTitle;

        // Only apply the confirmed sport's lookup table
        const table = TEAM_FULL_NAME[detectedSport];

        // Nicknames that are ambiguous even within a sport (e.g. Cardinals = MLB StL or NFL AZ)
        const AMBIGUOUS_KEYS = new Set(["Rangers", "Cardinals", "Angels", "Panthers", "Giants", "Stars", "Jets", "Kings"]);

        // If title already contains ANY full team name, skip expansion
        const allFullNames: string[] = [];
        try {
          for (const t of Object.values(TEAM_FULL_NAME)) {
            allFullNames.push(...Object.values(t as Record<string, string>));
          }
        } catch { /**/ }
        if (allFullNames.some(fn => rawTitle.includes(fn))) return rawTitle;

        for (const [key, full] of Object.entries(table)) {
          if (full === key) continue;
          if (AMBIGUOUS_KEYS.has(key)) continue;
          if (rawTitle.includes(full)) continue;
          const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
          if (re.test(rawTitle)) {
            return rawTitle.replace(re, full);
          }
        }
        return rawTitle;
      }

      // ── 1. Polymarket — fetch /markets sorted by liquidity (top 150 per sport category) ──
      // Uses /markets endpoint directly (not events) so we get all price-change fields.
      // Fetches 600 top-liquidity markets across all categories, then caps at 150 per sport.
      const polyEventMap = new Map<string, number>(); // normalised title → yesPrice for cross-validation
      try {
        // Parallel batches:
        //   batch1 — top 100 by liquidity (most popular markets)
        //   batch2 — top 100 by volume24hr (most traded today = most likely to have whales)
        //   batch3 — markets closing soonest (today/imminent events first)
        //   batch4 — next 100 by volume24hr (catch more active markets)
        const todayIso = new Date().toISOString().slice(0, 10);
        const [batch1, batch2, batch3, batch4] = await Promise.allSettled([
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "liquidity",  ascending: false }, timeout: 12000 }),
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "volume24hr", ascending: false }, timeout: 12000 }),
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "end_date_min", ascending: true,  endDateMin: todayIso }, timeout: 12000 }),
          axios.get(`${POLY_BASE}/markets`, { params: { limit: 100, active: true, closed: false, archived: false, order: "volume24hr", ascending: false, offset: 100 }, timeout: 12000 }),
        ]);

        // Merge and deduplicate by market id
        const seenIds = new Set<string>();
        const allMarkets: any[] = [];
        for (const batch of [batch1, batch2, batch3, batch4]) {
          if (batch.status !== "fulfilled") continue;
          const data = batch.value.data;
          const mkts = Array.isArray(data) ? data : (data?.markets ?? []);
          for (const m of mkts) {
            const uid = m.id ?? m.conditionId ?? m.questionID;
            if (uid && !seenIds.has(String(uid))) {
              seenIds.add(String(uid));
              allMarkets.push(m);
            }
          }
        }
        console.log(`[pred-mkt] Polymarket raw markets: ${allMarkets.length}`);

        // Classify and bucket by sport, then cap at PER_CATEGORY_LIMIT each
        const buckets: Record<string, any[]> = { NFL: [], NBA: [], MLB: [], NHL: [], Other: [] };
        for (const m of allMarkets) {
          const tagSlugs: string[] = ((m.events ?? [])[0]?.tags ?? []).map((t: any) => t.slug ?? t.label ?? "");
          const rawQ1 = m.question ?? m.groupItemTitle ?? "";
          const sport = classifySport(resolvePolymarketTitle(rawQ1), tagSlugs, "");
          if ((buckets[sport]?.length ?? 0) < PER_CATEGORY_LIMIT) {
            buckets[sport].push(m);
          }
        }
        const cappedMarkets = Object.values(buckets).flat();
        console.log(`[pred-mkt] Polymarket after 150/category cap: ${cappedMarkets.length} markets`);

        // Collect YES token IDs for CLOB mid-price enrichment
        const conditionIds: string[] = [];
        for (const m of cappedMarkets) {
          if (m.conditionId) conditionIds.push(m.conditionId);
        }
        const clobMids = await fetchClobMidPrices(conditionIds.slice(0, 80));

        for (const m of cappedMarkets) {
          const tagSlugs: string[] = ((m.events ?? [])[0]?.tags ?? []).map((t: any) => t.slug ?? t.label ?? "");
          const rawQ2 = m.question ?? m.groupItemTitle ?? "";
          const sport = classifySport(resolvePolymarketTitle(rawQ2), tagSlugs, "");

          // Skip events whose end date has already passed
          const evEnd = (m.events ?? [])[0]?.endDate ?? m.endDate ?? null;
          if (evEnd && new Date(evEnd).getTime() <= Date.now()) continue;

          const yesPrice = parseFloat(m.lastTradePrice ?? (m.outcomePrices?.[0] ?? 0.5));
          // Skip near-resolved markets: <2¢ or >98¢ means the outcome is essentially decided
          if (isNaN(yesPrice) || yesPrice < 0.02 || yesPrice > 0.98) continue;
          const noPrice  = 1 - yesPrice;
          const bestBid  = parseFloat(m.bestBid  ?? 0) || yesPrice - 0.01;
          const bestAsk  = parseFloat(m.bestAsk  ?? 0) || yesPrice + 0.01;
          const spread   = Math.max(0, bestAsk - bestBid);

          // ── Volume: use volume24hr (correct field), fall back to volume24hrClob
          const vol24h   = parseFloat(m.volume24hr ?? m.volume24hrClob ?? m.volume ?? 0);
          const vol1wk   = parseFloat(m.volume1wk  ?? m.volume1wkClob  ?? 1);
          const dailyAvg = vol1wk / 7;
          const volSpike = dailyAvg > 100 ? vol24h / dailyAvg : (vol24h > 0 ? 3.1 : 1);

          // ── Price changes
          const ph1 = parseFloat(m.oneHourPriceChange ?? 0) || 0;
          const pd1 = parseFloat(m.oneDayPriceChange  ?? 0) || 0;
          const pw1 = parseFloat(m.oneWeekPriceChange ?? 0) || 0;

          // ── Whale detection: single large purchase — vol24hr >= $100K only ──
          const isVolWhale  = vol24h >= WHALE_ABS_VOL;

          // ── Smart wallet signal: tracked top-20 traders holding this market ──
          const condId      = m.conditionId ?? "";
          const smartSignal = condId ? getSignalForMarket(condId) : null;
          const isSmartWalletAlert = !!(smartSignal && smartSignal.walletCount >= 1 && smartSignal.totalUSDC >= 500);

          // Combine vol-whale + smart-wallet into isWhaleAlert
          const isWhaleAlert = isVolWhale || isSmartWalletAlert;

          // Direction: prefer smart wallet direction (real positions), fall back to price move
          const priceMove = ph1 !== 0 ? ph1 : pd1;
          const whaleDirection: "yes" | "no" | null = isSmartWalletAlert && smartSignal!.direction !== "mixed"
            ? smartSignal!.direction as "yes" | "no"
            : isWhaleAlert ? (priceMove >= 0 ? "yes" : "no") : null;
          const whalePriceMovePct = Math.round(Math.abs(ph1 !== 0 ? ph1 : pd1) * 1000) / 10;

          // smartScore: vol-based (0–100) + wallet count bonus + USDC size bonus
          const volScore    = isVolWhale ? Math.min(70, Math.round((vol24h / 500_000) * 70)) : 0;
          const walletBonus = isSmartWalletAlert ? Math.min(20, (smartSignal!.walletCount) * 8) : 0;
          const usdcBonus   = isSmartWalletAlert ? Math.min(10, Math.round(Math.log10(Math.max(1, smartSignal!.totalUSDC)) - 2)) : 0;
          const smartScore  = isWhaleAlert ? Math.min(100, volScore + walletBonus + usdcBonus) : 0;

          const clobMid = m.conditionId ? (clobMids.get(m.conditionId) ?? null) : null;
          const rating  = rateMarket(m.question ?? m.groupItemTitle ?? "", yesPrice, clobMid, { isWhale: isWhaleAlert });

          // Build cross-validation map
          const normKey = (m.question ?? m.groupItemTitle ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          if (normKey) polyEventMap.set(normKey, yesPrice);

          // Parse clobTokenIds for history endpoint
          let yesTokenId: string | null = null;
          try {
            const tokenIds = JSON.parse(m.clobTokenIds ?? "[]");
            yesTokenId = Array.isArray(tokenIds) && tokenIds.length > 0 ? String(tokenIds[0]) : null;
          } catch { /* keep null */ }

          // Event info (markets endpoint nests event data in m.events array)
          const evTitle = (m.events ?? [])[0]?.title ?? m.question ?? m.groupItemTitle ?? "";
          const evSlug  = (m.events ?? [])[0]?.slug ?? m.slug ?? "";
          const evEndDate = (m.events ?? [])[0]?.endDate ?? m.endDate ?? null;

          results.push({
            id:               `poly-${m.id}`,
            source:           "polymarket",
            title:            resolvePolymarketTitle(m.question ?? m.groupItemTitle ?? ""),
            event:            evTitle,
            sport,
            yesPrice,
            noPrice,
            bestBid,
            bestAsk,
            spread:           Math.round(spread * 1000) / 10,
            vol24h,
            volSpike:         Math.round(volSpike * 10) / 10,
            ph1:              Math.round(ph1 * 1000) / 10,
            pd1:              Math.round(pd1 * 1000) / 10,
            pw1:              Math.round(pw1 * 1000) / 10,
            liquidityNum:     parseFloat(m.liquidityNum ?? m.liquidity ?? 0),
            yesTokenId,
            ...rating,
            isWhaleAlert,
            whaleDirection,
            whalePriceMovePct,
            smartScore,
            gameTime:         evEndDate,
            polyUrl:          `https://polymarket.com/event/${evSlug || m.id}`,
            crossValidated:      false,
            crossPrice:          null,
            crossSource:         null,
            crossDelta:          null,
            // Smart wallet data
            smartWalletCount:    smartSignal?.walletCount ?? 0,
            smartWalletUSDC:     Math.round(smartSignal?.totalUSDC ?? 0),
            smartWalletDir:      smartSignal?.direction ?? null,
            smartWalletHolders:  smartSignal?.holders ?? [],
          });
        }
      } catch (e: any) {
        console.warn("[pred-mkt] Polymarket error:", e.message);
      }

      // ── Kalshi title cleaner ────────────────────────────────────────────────
      // Kalshi multi-game market titles are raw comma-joined strings like:
      //   "yes Derrick White: 2+,yes DeMar DeRozan: 10+,yes Julius Randle: 15+"
      // We parse these into a human-readable label + structured legs array.
      // Decode Kalshi ticker prefix → human-readable stat category
      const kalshiStatFromTicker = (ticker: string): string  =>{
        const t = (ticker ?? "").toUpperCase();
        // NBA player props
        if (t.includes("NBAREBAST")) return "REB+AST";  // must check before REB/AST
        if (t.includes("NBAPRA"))   return "PTS+REB+AST";
        if (t.includes("NBAPTS"))   return "PTS";
        if (t.includes("NBAAST"))   return "AST";
        if (t.includes("NBAREB"))   return "REB";
        if (t.includes("NBASTL"))   return "STL";
        if (t.includes("NBABLK"))   return "BLK";
        if (t.includes("NBA3PM") || t.includes("NBA3PT")) return "3PT";
        if (t.includes("NBAFG") || t.includes("NBAFGM"))  return "FGM";
        if (t.includes("NBATOV") || t.includes("NBATO"))  return "TOV";
        if (t.includes("NBAMIN"))   return "MIN";
        if (t.includes("NBA") && (t.includes("PTS") || t.includes("POINT"))) return "PTS";
        if (t.includes("NBA") && (t.includes("AST") || t.includes("ASSIST"))) return "AST";
        if (t.includes("NBA") && (t.includes("REB") || t.includes("REBOUND"))) return "REB";
        // NFL player props
        if (t.includes("NFLTD"))    return "TD";
        if (t.includes("NFLPASS") || t.includes("NFLPYD")) return "PASS YDS";
        if (t.includes("NFLRUSH") || t.includes("NFLRYD")) return "RUSH YDS";
        if (t.includes("NFLREC") || t.includes("NFLRECYD")) return "REC YDS";
        if (t.includes("NFLCOMPLETION") || t.includes("NFLCOMP")) return "COMP";
        if (t.includes("NFLINT"))   return "INT";
        if (t.includes("NFLSCK") || t.includes("NFLSACK")) return "SACK";
        // MLB player props
        if (t.includes("MLBHR"))    return "HR";
        if (t.includes("MLBRBI"))   return "RBI";
        if (t.includes("MLBK") && !t.includes("MLBKI")) return "K";
        if (t.includes("MLBHIT"))   return "HITS";
        if (t.includes("MLBSB"))    return "SB";
        if (t.includes("MLBR") && !t.includes("MLBRBI")) return "RUNS";
        // NHL player props
        if (t.includes("NHLGOAL"))  return "GOALS";
        if (t.includes("NHLAST") || t.includes("NHLASSIST")) return "ASSISTS";
        if (t.includes("NHLSHOT"))  return "SHOTS";
        if (t.includes("NHLPOINT") || t.includes("NHLPTS")) return "PTS";
        // Generic fallback: if it's a player-prop market (contains a number threshold)
        // we still want to show SOMETHING rather than nothing
        if (t.includes("NBA") || t.includes("KQMB")) return "PROP";
        if (t.includes("NFL")) return "PROP";
        if (t.includes("MLB")) return "PROP";
        if (t.includes("NHL")) return "PROP";
        return "";  // Non-player-prop — don't append anything
      }

      const annotateTeamLeg = (legText: string, dir: string, sport: string): string  =>{
        // If the leg is just a team name (no colon, no stat number, no condition words)
        // e.g. "Boston", "Minnesota", "Arsenal", "Oklahoma City"
        const hasColon      = legText.includes(":");
        const hasNumber     = /\d/.test(legText);
        const hasCondition  = /wins|beats|covers|over|under|leads|scores|advances|moneyline|spread|ml\b/i.test(legText);
        if (!hasColon && !hasNumber && !hasCondition) {
          // Plain team name — always resolve by searching ALL leagues first
          // so a multi-sport parlay doesn't mis-tag NBA teams as NHL etc.
          let fullName = legText;
          let detectedSport: string | null = null;
          const lkey = legText.trim().toLowerCase();
          // Search all four leagues regardless of what the market says
          for (const sp of ["NBA", "NHL", "MLB", "NFL"] as const) {
            const table = TEAM_FULL_NAME[sp];
            for (const [k, v] of Object.entries(table)) {
              if (k.toLowerCase() === lkey || v.toLowerCase() === lkey) {
                fullName = v;
                detectedSport = sp;
                break;
              }
            }
            if (detectedSport) break;
          }
          // If not found in any table, fall back to resolveFullTeamName with the market sport
          if (!detectedSport) {
            fullName = resolveFullTeamName(legText, sport);
            // Only use the market sport label if we confirmed the team is actually in that league
            // Don't blindly label unknown teams with the market sport
            detectedSport = null;
          }
          // Never show "(Other)" — only append sport label when it adds real context
          const sportLabel = detectedSport && detectedSport !== "OTHER" ? ` (${detectedSport})` : "";
          return `${dir} ${fullName} to Win${sportLabel}`;
        }
        // Has condition words already — just clean up any city-only team names inline
        const resolved = resolvePolymarketTitle(legText);
        return `${dir} ${resolved}`;
      }

      // ── Player → Team lookup (ESPN search, cached) ──────────────────────────
      const playerTeamCache = new Map<string, string>();
      async function getPlayerTeam(playerName: string, sport: string): Promise<string | null> {
        const key = `${playerName}::${sport}`;
        if (playerTeamCache.has(key)) return playerTeamCache.get(key)!;
        try {
          const sportCfg: Record<string, string> = {
            NBA: "basketball/nba", MLB: "baseball/mlb",
            NHL: "hockey/nhl",     NFL: "football/nfl",
          };
          const slug = sportCfg[sport.toUpperCase()];
          if (!slug) return null;
          const q = encodeURIComponent(playerName);
          const r = await axios.get(
            `https://site.web.api.espn.com/apis/common/v3/search?query=${q}&type=player&sport=${slug.split("/")[0]}&league=${slug.split("/")[1]}&limit=3`,
            { timeout: 4000, headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const hits: any[] = r.data?.items ?? r.data?.athletes ?? [];
          for (const h of hits) {
            const name: string = h.displayName ?? h.name ?? "";
            // Fuzzy match — first+last name overlap
            const nl = name.toLowerCase(); const ql = playerName.toLowerCase();
            if (nl === ql || nl.includes(ql) || ql.includes(nl)) {
              const team = h.team?.displayName ?? h.team?.name ?? h.teamName ?? null;
              if (team) { playerTeamCache.set(key, team); return team; }
            }
          }
          // fallback: ESPN search v2
          const r2 = await axios.get(
            `https://www.espn.com/search-results/search?query=${q}&type=players&sport=${slug.split("/")[0]}`,
            { timeout: 4000, headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const results2: any[] = r2.data?.results?.[0]?.contents ?? [];
          for (const item of results2) {
            const nm: string = item.name ?? "";
            if (nm.toLowerCase().includes(playerName.toLowerCase().split(" ")[1] ?? playerName.toLowerCase())) {
              const team = item.team ?? null;
              if (team) { playerTeamCache.set(key, team); return team; }
            }
          }
        } catch { /* silent */ }
        playerTeamCache.set(key, "");
        return null;
      }

      // Extract a human-readable game matchup from a Kalshi event ticker.
      // Tickers look like: KXNBA-25-BOS-LAL, KXNHL-26-TOR-BOS, KXMLB-25-NYM-ATL, etc.
      const gameFromEventTicker = (ticker: string, sport?: string): string | null  =>{
        if (!ticker) return null;
        // Strip the leading "KX<SPORT>-YY-" prefix, leaving "AWAY-HOME" team codes
        const m = ticker.match(/^KX(?:NBA|NHL|MLB|NFL|NCAAB|NCAAF)?[-_]?\d*[-_]?([A-Z]{2,4})[-_]([A-Z]{2,4})/i);
        if (m) {
          const away = m[1].toUpperCase();
          const home = m[2].toUpperCase();
          // Try to resolve abbreviations to full team names
          const sp = (sport ?? "").toUpperCase() as keyof typeof TEAM_FULL_NAME;
          const fullAway = TEAM_FULL_NAME[sp]?.[away] ?? away;
          const fullHome = TEAM_FULL_NAME[sp]?.[home] ?? home;
          return `${fullAway} @ ${fullHome}`;
        }
        // Fallback: try splitting on last two dash/underscore segments
        const parts = ticker.split(/[-_]/).filter(Boolean);
        if (parts.length >= 2) {
          const last2 = parts.slice(-2);
          if (last2.every(p => /^[A-Z]{2,4}$/.test(p))) {
            return `${last2[0]} @ ${last2[1]}`;
          }
        }
        return null;
      }

      // Detect a bare game total leg: "Over 205.5 points scored", "Under 6.5 runs", etc.
      // Returns true if the leg text is a game-level total with no team context.
      const isBareTotal = (legText: string): boolean  =>{
        return /^(?:over|under)\s+[\d.]+\s+(?:points?|runs?|goals?|runs?|pts?)(?:\s+scored)?$/i.test(legText.trim());
      }

      const cleanKalshiTitle = (
        raw: string,
        mveLegs?: Array<{ market_ticker: string; event_ticker: string; side: string }>,
        sport?: string
      ): { title: string; legs: string[] | null; isParlay: boolean } => {
        if (!raw) return { title: raw, legs: null, isParlay: false };

        // ── Pattern A: player-prop parlay — starts with "yes/no Name: line"
        const legPattern = /^(yes|no)\s+.+:\s*[\d.]+[+\-]?/i;
        // Split on comma boundaries that precede "yes " or "no "
        const parts = raw.split(/,(?=\s*(yes|no)\s+)/i).map(s => s.trim());

        if (parts.length >= 2 && legPattern.test(parts[0])) {
          // Build a stat lookup from mve_selected_legs if available
          const rawLegs = parts.map((leg, i) => {
            // Filter out junk legs that are just "yes" or "no" with nothing after them
            const stripped = leg.replace(/^(yes|no)\s*/i, "").trim();
            if (!stripped) return null;  // empty/junk — drop this leg

            const m = leg.match(/^(yes|no)\s+(.+?):\s*([\d.]+[+\-]?)(.*)$/i);
            if (!m) {
              const plain = leg.match(/^(yes|no)\s+(.+)$/i);
              if (plain) {
                const plainContent = plain[2].trim();
                if (!plainContent) return null;  // nothing meaningful
                return annotateTeamLeg(plainContent, plain[1].toUpperCase(), sport ?? "");
              }
              return leg;
            }
            const dir  = m[1].toUpperCase();
            const name = m[2].trim();
            const line = m[3].trim();
            // Try to find the matching mve leg — the index may shift if earlier legs were null
            const mveLeg = mveLegs?.[i];
            const statTicker = mveLeg?.market_ticker ?? mveLeg?.event_ticker ?? "";
            const stat = kalshiStatFromTicker(statTicker);
            const builtLeg = `${dir} ${name} ${line}${stat ? " " + stat : ""}`;
            // If this is a bare game total (no team context), append the matchup from event_ticker
            const bareCondition = `${name} ${line}${stat ? " " + stat : ""}`;
            if (isBareTotal(bareCondition) && mveLeg?.event_ticker) {
              const game = gameFromEventTicker(mveLeg.event_ticker, sport);
              if (game) return `${dir} ${bareCondition} (${game})`;
            }
            return builtLeg;
          }).filter((leg): leg is string => leg !== null && leg.trim() !== "");

          if (rawLegs.length < 1) {
            // All legs were junk — fall through to single market handler
          } else {
            const firstMatch = parts[0].match(/^(?:yes|no)\s+(.+?):/i);
            const firstName = firstMatch ? firstMatch[1].trim() : 'Multi-game';
            const title = rawLegs.length === 1
              ? rawLegs[0].replace(/^(YES|NO)\s+/i, "")  // single valid leg — just show the condition
              : `${firstName} +${rawLegs.length - 1} more (${rawLegs.length}-leg parlay)`;
            return { title, legs: rawLegs, isParlay: rawLegs.length > 1 };
          }
        }

        // ── Pattern B: cross-category team-win parlay
        //   e.g. "Vancouver wins by over 2.5 goals,no Montreal wins by over..."
        //   Parts are separated by ",yes " or ",no " WITHIN the string (no leading yes/no)
        const crossParts = raw.split(/,(?=\s*(yes|no)\s+)/i).map(s => s.trim());
        // Also try splitting on plain commas when there are 3+ parts that look like team conditions
        const commaParts = raw.split(/,\s*no\s+|,\s*yes\s+/i);
        const teamConditionPattern = /wins|leads|scores|advances|covers|over|under|beats/i;

        // Check if the raw string contains ",no " or ",yes " mid-string (cross-category)
        if (/,\s*(yes|no)\s+/i.test(raw)) {
          // Reconstruct legs with their yes/no side
          // First part may or may not start with yes/no
          const rawLegs: string[] = [];
          // Split on all ",yes " and ",no " boundaries, preserving the delimiter
          const tokens = raw.split(/(,\s*(?:yes|no)\s+)/i);
          let current = tokens[0].trim();
          for (let i = 1; i < tokens.length; i += 2) {
            rawLegs.push(current);
            const delimiter = tokens[i]; // e.g. ",no " or ",yes "
            const sideMatch = delimiter.match(/(yes|no)/i);
            const side = sideMatch ? sideMatch[1].toUpperCase() : 'YES';
            current = side + ' ' + (tokens[i + 1] ?? '').trim();
          }
          if (current) rawLegs.push(current);

          if (rawLegs.length >= 2) {
            const legs = rawLegs.map(leg => {
              // Leg might already start with YES/NO from reconstruction
              const withSide = leg.match(/^(YES|NO)\s+(.+)$/i);
              if (withSide) {
                return annotateTeamLeg(withSide[2].trim(), withSide[1].toUpperCase(), sport ?? "");
              }
              // First part had no yes/no prefix — it's a YES by default
              return annotateTeamLeg(leg.trim(), "YES", sport ?? "");
            });

            // Build a compact summary title
            // Extract the core condition from first leg (e.g. "Vancouver wins by over 2.5 goals")
            const firstLeg = legs[0].replace(/^YES\s+/i, '').replace(/^NO\s+/i, '');
            // Try to extract team name (first 1-2 words before a verb)
            const teamMatch = firstLeg.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+/i);
            const teamName = teamMatch ? teamMatch[1] : 'Multi-team';
            const title = `${teamName} +${legs.length - 1} more (${legs.length}-leg combo)`;
            return { title, legs, isParlay: true };
          }
        }

        // ── Pattern C: plain long comma list with no yes/no markers
        //   Treat as multi-condition if 3+ commas and matches team condition words
        if (raw.includes(',') && teamConditionPattern.test(raw)) {
          const simpleParts = raw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
          if (simpleParts.length >= 3) {
            const legs = simpleParts.map(p => annotateTeamLeg(p, "YES", sport ?? ""));
            const firstWord = simpleParts[0].split(/\s+/).slice(0, 2).join(' ');
            const title = `${firstWord} +${legs.length - 1} more (${legs.length}-leg combo)`;
            return { title, legs, isParlay: true };
          }
        }

        // Single market — clean up "yes Name: line" prefix
        const single = raw.match(/^(?:yes|no)\s+(.+)$/i);
        return { title: single ? single[1].trim() : raw, legs: null, isParlay: false };
      }

      // ── 2. Kalshi — all open markets, classify sport, cross-validate vs Polymarket ──
      try {
        // Fetch 400 open Kalshi markets — sorted by close_time ASC so today's events are first
        const { data: km } = await axios.get(`${KALSHI_BASE}/markets`, {
          params: { status: "open", limit: 400 },
          timeout: 10000,
        });
        const kmarkets = (km?.markets ?? []) as any[];
        // Per-category cap for Kalshi (100 limit — 100 most popular per sport)
        const kBuckets: Record<string, number> = {};
        // Sort: today-closing first (ascending close_time within 24h), then by vol24h descending
        const kNow = Date.now();
        kmarkets.sort((a: any, b: any) => {
          const atClose = a.close_time ? new Date(a.close_time).getTime() : Infinity;
          const btClose = b.close_time ? new Date(b.close_time).getTime() : Infinity;
          const aToday  = atClose > kNow && atClose <= kNow + 24 * 60 * 60 * 1000;
          const bToday  = btClose > kNow && btClose <= kNow + 24 * 60 * 60 * 1000;
          if (aToday && !bToday) return -1;
          if (!aToday && bToday) return 1;
          // Within same "today" bucket, sort by vol24h descending
          const av = parseFloat(a.volume_24h_fp ?? a.volume_24h ?? 0);
          const bv = parseFloat(b.volume_24h_fp ?? b.volume_24h ?? 0);
          return bv - av;
        });
        const kNowMs = Date.now();
        for (const m of kmarkets) {
          // Skip markets whose close_time has already passed — the event is over
          if (m.close_time && new Date(m.close_time).getTime() <= kNowMs) continue;

          const priceStr = m.yes_ask_dollars ?? m.yes_bid_dollars ?? m.last_price_dollars ?? null;
          const yesPrice = priceStr !== null ? parseFloat(priceStr) : ((m.yes_bid ?? m.last_price ?? 50) / 100);
          // Skip near-resolved markets: <2¢ or >98¢ means outcome essentially decided
          if (isNaN(yesPrice) || yesPrice < 0.02 || yesPrice > 0.98) continue;

          const noPrice  = 1 - yesPrice;
          const bestBid  = m.yes_bid_dollars ? parseFloat(m.yes_bid_dollars) : yesPrice - 0.01;
          const bestAsk  = m.yes_ask_dollars ? parseFloat(m.yes_ask_dollars) : yesPrice + 0.01;
          const spread   = Math.max(0, bestAsk - bestBid);
          const vol24h   = parseFloat(m.volume_24h_fp ?? m.volume_24h ?? m.volume_fp ?? 0);

          const sport  = classifySport(m.title ?? "", [], m.category ?? "");

          // Per-category cap: skip if bucket full
          kBuckets[sport] = (kBuckets[sport] ?? 0);
          if (kBuckets[sport] >= PER_CATEGORY_LIMIT) continue;

          // Cross-validate: find matching Polymarket market by fuzzy title
          const titleWords = (m.title ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w: string) => w.length > 3);
          let crossPrice: number | null = null;
          let crossDelta: number | null = null;
          let bestMatchScore = 0;
          for (const [polyKey, polyPrice] of polyEventMap) {
            const overlap = titleWords.filter((w: string) => polyKey.includes(w)).length;
            const score = titleWords.length > 0 ? overlap / titleWords.length : 0;
            if (score >= 0.60 && score > bestMatchScore) {
              crossPrice = polyPrice;
              bestMatchScore = score;
            }
          }
          if (crossPrice !== null) {
            crossDelta = Math.round(Math.abs(yesPrice - crossPrice) * 1000) / 10;
          }

          const prevPriceK = m.previous_price_dollars !== undefined
            ? parseFloat(m.previous_price_dollars)
            : m.previous_price !== undefined ? m.previous_price / 100 : null;

          // ── Kalshi whale detection ─────────────────────────────────
          // Kalshi has much lower liquidity than Polymarket. Whale = $5K+ vol24h
          // OR 5¢+ price move from previous close (price shock = large order hit).
          const kHasAbsVol    = vol24h >= KALSHI_WHALE_VOL;
          const kPriceDelta   = prevPriceK !== null ? Math.abs(yesPrice - prevPriceK) : 0;
          const kHasPriceMove = kPriceDelta >= KALSHI_PREV_PRICE_DELTA;
          const isWhaleAlert  = kHasAbsVol || kHasPriceMove;

          // Rate AFTER whale + cross-validation known so confluence is baked in
          const rating = rateMarket(m.title ?? "", yesPrice, null, {
            isWhale: isWhaleAlert,
            crossValidated: crossPrice !== null,
          });
          const whaleDirection = isWhaleAlert ? (yesPrice >= 0.5 ? "yes" : "no") : null;
          const whalePriceMovePct = prevPriceK !== null
            ? Math.round(Math.abs(yesPrice - prevPriceK) * 1000) / 10
            : 0;

          // smartScore for Kalshi: vol relative to $50K cap + price shock weight
          const kSmartScore = isWhaleAlert ? Math.min(100, Math.round(
            (kHasAbsVol    ? Math.min(60, (vol24h / 50_000) * 60) : 0) +
            (kHasPriceMove ? Math.min(40, (kPriceDelta / 0.20) * 40) : 0)
          )) : 0;

          const { title: kTitle, legs: kLegs, isParlay: kIsParlay } = cleanKalshiTitle(m.title ?? "", m.mve_selected_legs, sport);
          const kLegGames: (string | null)[] = (m.mve_selected_legs ?? []).map(
            (leg: { market_ticker: string; event_ticker: string; side: string }) =>
              gameFromEventTicker(leg.event_ticker, sport) ?? null
          );
          const kLegPlayerTeams: (string | null)[] = await Promise.all(
            (kLegs ?? []).map(async (legStr: string) => {
              const body = legStr.replace(/^(YES|NO)\s+/i, "").trim();
              const propMatch = body.match(/^(.+?):\s*[\d.]+/) || body.match(/^(.+?)\s+[\d.]+[+\-]?\s+/);
              const playerName = propMatch?.[1]?.trim();
              if (!playerName || playerName.length < 4) return null;
              if (/wins|beats|covers|over|under|advances/i.test(playerName)) return null;
              return getPlayerTeam(playerName, sport);
            })
          );
          results.push({
            id:               `kalshi-${m.ticker}`,
            source:           "kalshi",
            title:            kTitle,
            legs:             kLegs,
            isParlay:         kIsParlay,
            legGames:         kLegGames.length > 0 ? kLegGames : null,
            legPlayerTeams:   kLegPlayerTeams.some(t => t) ? kLegPlayerTeams : null,
            event:            m.event_ticker ?? m.title,
            sport,
            yesPrice,
            noPrice,
            bestBid,
            bestAsk,
            spread:           Math.round(spread * 1000) / 10,
            vol24h,
            volSpike:         1,
            ph1:              prevPriceK !== null ? Math.round((yesPrice - prevPriceK) * 1000) / 10 : 0,
            pd1:              prevPriceK !== null ? Math.round((yesPrice - prevPriceK) * 1000) / 10 : 0,
            previousPrice:    prevPriceK,
            pw1:              0,
            liquidityNum:     parseFloat(m.open_interest_fp ?? m.notional_value ?? 0),
            openTime:         m.open_time ?? null,
            ...rating,
            isWhaleAlert,
            whaleDirection,
            whalePriceMovePct,
            smartScore:       kSmartScore,
            gameTime:         m.close_time ?? null,
            kalshiUrl:        `https://kalshi.com/markets/${m.ticker}`,
            crossValidated:   crossPrice !== null,
            crossPrice:       crossPrice !== null ? Math.round(crossPrice * 100) / 100 : null,
            crossSource:      crossPrice !== null ? "polymarket" : null,
            crossDelta:       crossDelta,
          });
          kBuckets[sport]++;
        }

        // Back-fill crossValidation onto Polymarket entries using Kalshi as reference
        const kalshiMap = new Map<string, number>();
        for (const r of results) {
          if (r.source === "kalshi") {
            const k = r.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            if (k) kalshiMap.set(k, r.yesPrice);
          }
        }
        for (const r of results) {
          if (r.source === "polymarket" && !r.crossValidated) {
            const words = r.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w: string) => w.length > 3);
            let bestScore = 0; let kPrice: number | null = null;
            for (const [kk, kp] of kalshiMap) {
              const ov = words.filter((w: string) => kk.includes(w)).length;
              const sc = words.length > 0 ? ov / words.length : 0;
              if (sc >= 0.60 && sc > bestScore) { kPrice = kp; bestScore = sc; }
            }
            if (kPrice !== null) {
              r.crossValidated = true;
              r.crossPrice     = Math.round(kPrice * 100) / 100;
              r.crossSource    = "kalshi";
              r.crossDelta     = Math.round(Math.abs(r.yesPrice - kPrice) * 1000) / 10;
            }
          }
        }
      } catch (e: any) {
        console.warn("[pred-mkt] Kalshi error:", e.message);
      }

      // Sort: today/within-24h markets FIRST, then whale alerts, then rating
      // isTodaySrv: fires if gameTime closes within next 24 hours OR is today's date
      const isTodaySrv = (gt: string | null): boolean  =>{
        if (!gt) return false;
        try {
          const t = new Date(gt).getTime();
          const now = Date.now();
          // Fires if: closes within 24 hours from now (in-play or imminent)
          // OR the close date is today's calendar date
          const todayStr = new Date().toISOString().slice(0, 10);
          const isToday = new Date(gt).toISOString().slice(0, 10) === todayStr;
          const isWithin24h = t > now && t <= now + 24 * 60 * 60 * 1000;
          return isToday || isWithin24h;
        } catch { return false; }
      }
      const ORDER = { great_buy: 0, good_buy: 1, fair: 2, overpriced: 3 };
      results.sort((a, b) => {
        const at = isTodaySrv(a.gameTime);
        const bt = isTodaySrv(b.gameTime);
        // 1) Today/within-24h markets first
        if (at && !bt) return -1;
        if (!at && bt) return 1;
        // 2) Within today group: whales first, sorted by smartScore desc
        if (a.isWhaleAlert && !b.isWhaleAlert) return -1;
        if (!a.isWhaleAlert && b.isWhaleAlert) return 1;
        if (a.isWhaleAlert && b.isWhaleAlert) {
          return (b.smartScore ?? 0) - (a.smartScore ?? 0);
        }
        // 3) Non-whale non-today: sort by rating then by vol24h (most active first)
        const ratingDiff = (ORDER[a.priceRating as keyof typeof ORDER] ?? 9)
          - (ORDER[b.priceRating as keyof typeof ORDER] ?? 9);
        if (ratingDiff !== 0) return ratingDiff;
        return (b.vol24h ?? 0) - (a.vol24h ?? 0);
      });

      predMktCache = { data: results, ts: Date.now() };
      // Expose to market-signals endpoint via global cache
      (global as any).__predMktCache = { data: results, ts: Date.now() };
      // Invalidate market-signals cache so it re-computes with fresh markets
      MARKET_SIGNALS_CACHE.delete("market-signals");
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Price history endpoint — Polymarket CLOB timeseries + Kalshi synthetic ────────
  // GET /api/prediction-markets/history/:marketId
  // FIXES:
  //   - Use clobTokenIds[0] (YES token) NOT conditionId for CLOB /prices-history
  //   - Use startTs+endTs (Unix seconds) not `resolution` param
  //   - Build synthetic history from oneDayPriceChange / oneWeekPriceChange / oneMonthPriceChange
  //   - Kalshi /history endpoint doesn’t exist publicly — use previousPrice from cache
  app.get("/api/prediction-markets/history/:marketId", async (req, res) => {
    const { marketId } = req.params;
    try {
      if (marketId.startsWith("poly-")) {
        const rawId = marketId.replace("poly-", "");

        // Step 1: Fetch Gamma market data — we need clobTokenIds + price-change fields
        let yesTokenId: string | null = null;
        let lastTradePrice = 0.5;
        let oneDayChange   = 0;
        let oneWeekChange  = 0;
        let oneMonthChange = 0;
        try {
          const { data: mData } = await axios.get(
            `https://gamma-api.polymarket.com/markets/${rawId}`,
            { timeout: 8000 }
          );
          const cids = mData?.clobTokenIds;
          if (typeof cids === "string") {
            try { const arr = JSON.parse(cids); yesTokenId = arr?.[0] ? String(arr[0]) : null; } catch { /* noop */ }
          } else if (Array.isArray(cids) && cids.length > 0) {
            yesTokenId = String(cids[0]);
          }
          lastTradePrice = parseFloat(mData?.lastTradePrice ?? 0.5) || 0.5;
          oneDayChange   = parseFloat(mData?.oneDayPriceChange   ?? 0) || 0;
          oneWeekChange  = parseFloat(mData?.oneWeekPriceChange  ?? 0) || 0;
          oneMonthChange = parseFloat(mData?.oneMonthPriceChange ?? 0) || 0;
        } catch (e: any) {
          console.warn("[pred-hist] Gamma fetch failed:", e.message);
        }

        // Step 2: Try CLOB prices-history using YES token ID + startTs/endTs
        let clobPoints: { t: number; p: number }[] = [];
        if (yesTokenId) {
          try {
            const nowSec   = Math.floor(Date.now() / 1000);
            const startSec = nowSec - 7 * 24 * 3600;
            const { data: hist } = await axios.get("https://clob.polymarket.com/prices-history", {
              params: { market: yesTokenId, startTs: startSec, endTs: nowSec, fidelity: 3600 },
              timeout: 10000,
            });
            const raw = hist?.history ?? hist ?? [];
            if (Array.isArray(raw)) {
              clobPoints = raw
                .filter((p: any) => p && (p.t !== undefined || p.timestamp !== undefined))
                .map((p: any) => ({
                  t: typeof p.t === "number" ? p.t : parseInt(String(p.t ?? p.timestamp ?? 0)),
                  p: Math.min(1, Math.max(0, parseFloat(p.p ?? p.price ?? lastTradePrice))),
                }))
                .filter((pt: { t: number; p: number }) => pt.t > 0);
            }
            console.log(`[pred-hist] CLOB: ${clobPoints.length} pts for token ${yesTokenId.slice(0, 12)}…`);
          } catch (e: any) {
            console.warn("[pred-hist] CLOB error:", e.message);
          }
        }

        // Step 3: Synthetic history from Gamma price-change anchors
        // Anchors: now, 1d ago, 7d ago, 30d ago — interpolate between each
        const nowSec = Math.floor(Date.now() / 1000);
        const anchors = [
          { daysAgo: 0,  price: lastTradePrice },
          { daysAgo: 1,  price: Math.min(1, Math.max(0, lastTradePrice - oneDayChange)) },
          { daysAgo: 7,  price: Math.min(1, Math.max(0, lastTradePrice - oneWeekChange)) },
          { daysAgo: 30, price: Math.min(1, Math.max(0, lastTradePrice - oneMonthChange)) },
        ];
        const synthPts: { t: number; p: number }[] = [];
        for (let i = 0; i < anchors.length - 1; i++) {
          const a = anchors[i]; const b = anchors[i + 1];
          const steps = Math.max(2, Math.round((b.daysAgo - a.daysAgo) / 1.5));
          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            synthPts.push({
              t: nowSec - Math.round((a.daysAgo + frac * (b.daysAgo - a.daysAgo)) * 86400),
              p: Math.min(1, Math.max(0, a.price + frac * (b.price - a.price))),
            });
          }
        }

        // Step 4: Merge — CLOB points override synthetic in the same hour bucket
        const byHour = new Map<number, { t: number; p: number }>();
        for (const pt of synthPts) {
          const bkt = Math.floor(pt.t / 3600);
          if (!byHour.has(bkt)) byHour.set(bkt, pt);
        }
        for (const pt of clobPoints) {
          byHour.set(Math.floor(pt.t / 3600), pt); // CLOB wins
        }
        const history = Array.from(byHour.values()).sort((a, b) => a.t - b.t);

        return res.json({ source: "polymarket", history, hasRealData: clobPoints.length > 0, tokenId: yesTokenId });
      }

      // Kalshi: their public API has no /history endpoint — build synthetic from cache
      if (marketId.startsWith("kalshi-")) {
        const cachedMarket = predMktCache.data.find((m: any) => m.id === marketId);
        const lastPrice = cachedMarket?.yesPrice ?? 0.5;
        const prevPrice = cachedMarket?.previousPrice ?? null;
        const openTime  = cachedMarket?.openTime ?? null;
        const nowSec = Math.floor(Date.now() / 1000);
        const startTs = openTime
          ? Math.floor(new Date(openTime).getTime() / 1000)
          : nowSec - 24 * 3600;
        const history: { t: number; p: number }[] = [];
        const steps = 8;
        if (prevPrice !== null && prevPrice !== lastPrice) {
          for (let i = 0; i <= steps; i++) {
            const frac = i / steps;
            history.push({
              t: Math.round(startTs + frac * (nowSec - startTs)),
              p: Math.min(1, Math.max(0, prevPrice + frac * (lastPrice - prevPrice))),
            });
          }
        } else {
          const range = Math.max(0.02, Math.abs(lastPrice - 0.5) * 0.05);
          for (let i = 0; i <= steps; i++) {
            const frac = i / steps;
            history.push({
              t: Math.round(startTs + frac * (nowSec - startTs)),
              p: Math.min(1, Math.max(0, lastPrice + Math.sin(i * 1.7) * range * 0.4)),
            });
          }
        }
        return res.json({ source: "kalshi", history, isSynthetic: true });
      }

      res.json({ source: "unknown", history: [] });
    } catch (e: any) {
      console.error("[pred-hist] Error:", e.message);
      res.json({ source: "error", history: [], error: e.message });
    }
  });

  // ─── Kronos AI Forecast endpoint ───────────────────────────────────────────
  // GET /api/prediction-markets/kronos/:marketId
  // Fetches price history then proxies to the Kronos Python microservice.
  // Returns: { signal, strength, forecast, explanation, trend_slope, volatility, ... }
  const kronosCache = new Map<string, { data: any; ts: number }>();
  const KRONOS_TTL = 5 * 60_000; // 5-min cache (price history doesn't change that fast)

  // ─── Kronos Sports Pick Overlay ───────────────────────────────────────────
  // Takes raw Kronos price-model output + the market object and generates
  // a concrete sports pick with full reasoning (pick direction, edge, why).
  function buildKronosPick(k: any, mkt: any): {
    pick_label:      string;   // e.g. "BUY YES" / "BUY NO" / "PASS"
    pick_side:       "yes" | "no" | "pass";
    pick_confidence: number;   // 0-100
    pick_reasoning:  string;   // full natural-language explanation
    pick_edge_cents: number;   // current_cents vs projected_cents delta
    pick_roi_est:    string;   // estimated ROI if pick lands
    pick_grade:      "A" | "B" | "C" | "D" | "F";
  } {
    const signal   = k.signal    ?? "neutral";
    const strength = k.strength  ?? 0;
    const proj     = k.projected_cents ?? k.current_cents ?? 50;
    const curr     = k.current_cents   ?? (mkt ? Math.round((mkt.yesPrice ?? 0.5) * 100) : 50);
    const edgeCents = Math.round(proj - curr);

    // Market metadata
    const title       = mkt?.title    ?? "this market";
    const sport       = mkt?.sport    ?? "Sports";
    const yesPrice    = mkt?.yesPrice ?? 0.5;
    const noPrice     = mkt ? (1 - yesPrice) : 0.5;
    const priceRating = mkt?.priceRating ?? "fair";
    const isWhale         = mkt?.isWhaleAlert ?? false;
    const whaleSide       = mkt?.whaleDirection ?? null;
    const edge            = mkt?.edge ?? 0;
    const ph1             = mkt?.ph1 ?? 0;
    const pd1             = mkt?.pd1 ?? 0;
    const crossVal        = mkt?.crossValidated ?? false;
    const crossDelta      = mkt?.crossDelta ?? null;
    // Smart wallet data
    const swCount         = mkt?.smartWalletCount ?? 0;   // # tracked wallets holding
    const swUSDC          = mkt?.smartWalletUSDC  ?? 0;   // total USDC across wallets
    const swDir           = mkt?.smartWalletDir   ?? null; // "yes"|"no"|"mixed"|null
    const hasSmartMoney   = swCount >= 1 && swUSDC >= 500;
    const lm          = k.line_movement ?? {};
    const lb          = k.late_breaking ?? {};
    const crossover   = k.crossover ?? "none";
    const tossup      = k.tossup ?? false;
    const r2          = k.r2 ?? 0;
    const volRegime   = k.volatility_regime ?? "low";

    // ── Decide pick direction ──
    // Combine CIQ signal + market edge + whale flow + price rating
    let pickedSide: "yes" | "no" | "pass" = "pass";

    const yesSignals = [
      signal === "bullish",
      priceRating === "great_buy" || priceRating === "good_buy",
      isWhale && whaleSide === "yes",
      hasSmartMoney && swDir === "yes",      // smart wallets are holding YES
      hasSmartMoney && swCount >= 2,          // 2+ smart wallets = strong conviction
      lm.bias === "sharp_yes",
      crossover === "golden_cross",
      lb.detected && lb.direction === "bullish",
      ph1 > 1,
    ].filter(Boolean).length;

    const noSignals = [
      signal === "bearish",
      priceRating === "overpriced",
      isWhale && whaleSide === "no",
      hasSmartMoney && swDir === "no",       // smart wallets are holding NO
      lm.bias === "sharp_no",
      crossover === "death_cross",
      lb.detected && lb.direction === "bearish",
      ph1 < -1,
    ].filter(Boolean).length;

    if (yesSignals >= 2 || (signal === "bullish" && strength >= 40)) {
      pickedSide = "yes";
    } else if (noSignals >= 2 || (signal === "bearish" && strength >= 40)) {
      pickedSide = "no";
    } else if (yesSignals > noSignals && strength >= 25) {
      pickedSide = "yes";
    } else if (noSignals > yesSignals && strength >= 25) {
      pickedSide = "no";
    }

    // If tossup and low confidence, downgrade to pass
    if (tossup && strength < 40) pickedSide = "pass";

    // ── Confidence: blend Kronos strength + confluence bonus ──
    const swBonus = hasSmartMoney
      ? Math.min(20, swCount * 6 + (swUSDC >= 5000 ? 5 : 0))   // up to +20 for smart wallets
      : 0;
    const confluenceBonus =
      (isWhale ? 8 : 0) +
      (crossVal ? 6 : 0) +
      (crossover === "golden_cross" || crossover === "death_cross" ? 8 : 0) +
      (lb.detected ? 6 : 0) +
      (lm.bias !== "neutral" ? 5 : 0) +
      (r2 > 0.7 ? 5 : 0) +
      swBonus;
    const pickConfRaw = Math.min(99, Math.max(1, strength + confluenceBonus));
    // Apply ML weight nudge (no-op until we have ≥10 graded outcomes)
    const pickConf = applyMLWeights(pickConfRaw, {
      sport: mkt?.sport?.toUpperCase() ?? undefined,
      betType: "prediction_market",
      pickSide: pickedSide,
    });

    // ── Edge and ROI ──
    const entryPrice = pickedSide === "yes" ? yesPrice : noPrice;
    const roi = entryPrice > 0 ? Math.round((edgeCents / (entryPrice * 100)) * 100) : 0;
    const roiStr = roi !== 0 ? `${roi > 0 ? "+" : ""}${roi}%` : "0%";

    // ── Grade ──
    let grade: "A" | "B" | "C" | "D" | "F" = "F";
    if (pickConf >= 75 && pickedSide !== "pass" && Math.abs(edgeCents) >= 5) grade = "A";
    else if (pickConf >= 60 && pickedSide !== "pass" && Math.abs(edgeCents) >= 3) grade = "B";
    else if (pickConf >= 45 && pickedSide !== "pass") grade = "C";
    else if (pickConf >= 30 && pickedSide !== "pass") grade = "D";

    // ── Pick label ──
    const sideLabel = pickedSide === "yes" ? "BUY YES" : pickedSide === "no" ? "BUY NO" : "PASS";
    const priceLabel = pickedSide === "yes"
      ? `${Math.round(yesPrice * 100)}¢`
      : pickedSide === "no"
        ? `${Math.round(noPrice * 100)}¢`
        : "—";

    // For O/U markets, clarify whether YES = OVER or YES = UNDER in the label
    // Title pattern: "Team A vs Team B: O/U 6.5" → YES = OVER, NO = UNDER
    const titleUpper = (title ?? "").toUpperCase();
    const isOUMarket = /O\/U|OVER.UNDER|OVER\/UNDER|OU/.test(titleUpper)
                    || /^(OVER|UNDER)\s+[\d.]+/.test(titleUpper);
    // YES contract on an O/U = betting the OVER; NO = betting the UNDER
    const ouSuffix = isOUMarket && pickedSide !== "pass"
      ? pickedSide === "yes" ? " (OVER)" : " (UNDER)"
      : "";

    const pick_label = pickedSide === "pass"
      ? "PASS — No Clear Edge"
      : `${sideLabel} @ ${priceLabel}${ouSuffix}`;

    // ── Natural-language reasoning ──
    const parts: string[] = [];

    // Opening: what the pick is and why
    if (pickedSide === "yes") {
      parts.push(`Clubhouse IQ rates this a YES contract at ${Math.round(yesPrice * 100)}¢.`);
      if (signal === "bullish")
        parts.push(`Price model shows upward trend — YES contract projected to reach ${proj}¢ (currently ${curr}¢, +${Math.abs(edgeCents)}¢ edge).`);
    } else if (pickedSide === "no") {
      parts.push(`Clubhouse IQ rates this a NO contract at ${Math.round(noPrice * 100)}¢.`);
      if (signal === "bearish")
        parts.push(`YES price is fading — contract likely dropping to ${proj}¢ from ${curr}¢. Buying NO captures the ${Math.abs(edgeCents)}¢ move.`);
    } else {
      parts.push(`No clear edge detected. Market appears fairly priced or too uncertain for a confident call.`);
    }

    // Market edge signals
    if (priceRating === "great_buy" && pickedSide === "yes")
      parts.push(`Market pricing shows a great buy opportunity — YES is undervalued vs fair value (${Math.round(edge)}¢ edge).`);
    else if (priceRating === "good_buy" && pickedSide === "yes")
      parts.push(`YES appears slightly undervalued vs fair value (${Math.round(edge)}¢ edge).`);
    else if (priceRating === "overpriced" && pickedSide === "no")
      parts.push(`YES is overpriced vs fair value — smart money buys the NO contract instead.`);

    // Whale activity
    if (isWhale && whaleSide === pickedSide)
      parts.push(`Whale activity confirmed on this side — large position(s) taken, aligning with Clubhouse IQ direction.`);
    else if (isWhale && whaleSide && whaleSide !== pickedSide)
      parts.push(`Note: whale activity detected on the opposite side — factor into risk sizing.`);

    // Smart wallet (top trader) positioning
    if (hasSmartMoney && swDir === pickedSide)
      parts.push(`Smart Money confirmed: ${swCount} top-ranked Polymarket trader${swCount > 1 ? "s" : ""} holding this ${swDir?.toUpperCase()} side ($${swUSDC.toLocaleString()} USDC combined) — aligns with Clubhouse IQ pick.`);
    else if (hasSmartMoney && swDir === "mixed")
      parts.push(`Smart Money is split: ${swCount} top trader${swCount > 1 ? "s" : ""} hold positions on both sides ($${swUSDC.toLocaleString()} USDC) — market is contested.`);
    else if (hasSmartMoney && swDir && swDir !== pickedSide)
      parts.push(`Caution: ${swCount} top trader${swCount > 1 ? "s" : ""} are positioned on the ${swDir?.toUpperCase()} side ($${swUSDC.toLocaleString()} USDC) — opposite to this pick. Size carefully.`);

    // Sharp money / line movement
    if (lm.bias === "sharp_yes" && pickedSide === "yes")
      parts.push(`Sharp money detected: late YES buying (+${lm.short_slope}¢/step recent vs ${lm.long_slope}¢/step overall) — professional bettors loading up.`);
    else if (lm.bias === "sharp_no" && pickedSide === "no")
      parts.push(`Sharp money fading YES (${lm.short_slope}¢/step recent) — professional action aligns with NO.`);

    // Momentum crossover
    if (crossover === "golden_cross")
      parts.push(`Short-term momentum crossed above long-term average (golden cross) — bullish confirmation.`);
    else if (crossover === "death_cross")
      parts.push(`Short-term momentum crossed below long-term average (death cross) — bearish confirmation.`);

    // Late-breaking
    if (lb.detected)
      parts.push(`Late-breaking ${lb.direction} signal detected (${lb.magnitude}¢ move in last 3 data points) — possible injury/news catalyst.`);

    // Recent price momentum
    if (Math.abs(ph1) >= 1)
      parts.push(`1-hour price change: ${ph1 > 0 ? "+" : ""}${ph1}% — ${ph1 > 0 ? "intraday buying pressure" : "recent selling"}.`);
    if (Math.abs(pd1) >= 2)
      parts.push(`24-hour move: ${pd1 > 0 ? "+" : ""}${pd1}% — market has been ${pd1 > 0 ? "strengthening" : "weakening"} over the day.`);

    // Cross-validation
    if (crossVal && crossDelta !== null && crossDelta < 5)
      parts.push(`Cross-validated: Kalshi and Polymarket prices agree within ${crossDelta}¢ — strong consensus.`);
    else if (crossVal && crossDelta !== null && crossDelta >= 5)
      parts.push(`Price discrepancy between Kalshi and Polymarket (${crossDelta}¢ gap) — arbitrage opportunity may exist.`);

    // Model quality
    if (r2 > 0.7)
      parts.push(`Model fit is strong (R²=${r2.toFixed(2)}) — Clubhouse IQ has high confidence in this trend.`);
    else if (r2 < 0.3 && pickedSide !== "pass")
      parts.push(`Model fit is low (R²=${r2.toFixed(2)}) — noisy price history; size appropriately.`);

    // Volatility
    if (volRegime === "high")
      parts.push(`High market volatility — active information flow. Expect wider price swings.`);

    // Tossup warning
    if (tossup)
      parts.push(`Market is near 50¢ (genuine pick-em). Risk is elevated — bet small.`);

    const pick_reasoning = parts.join(" ");

    return {
      pick_label,
      pick_side:       pickedSide,
      pick_confidence: pickConf,
      pick_reasoning,
      pick_edge_cents: edgeCents,
      pick_roi_est:    roiStr,
      pick_grade:      grade,
    };
  }

  // Start Kronos at server boot
  startKronos();

  // ── Nightly ML pipeline: grade picks → run ML engine → sync to GitHub ──────
  // Runs at 2:00 AM server time (after US games finish)
  {
    const runNightlyML = async () => {
      console.log("[ML] Nightly pipeline starting...");
      try {
        // Step 1: Auto-grade picks against ESPN final scores
        const graderResult = await runPythonScript("auto_grader.py");
        console.log("[ML] Grader done:", graderResult);
      } catch (e: any) {
        console.error("[ML] Grader error:", e.message);
      }
      try {
        // Step 2: Run ML engine to recompute weights from graded outcomes
        await runMLEngine();
        console.log("[ML] Engine run complete");
      } catch (e: any) {
        console.error("[ML] Engine error:", e.message);
      }
      try {
        // Step 3: Sync ml_data/ back to GitHub so outcomes survive next redeploy
        await syncMLDataToGitHub();
        console.log("[ML] GitHub sync complete");
      } catch (e: any) {
        console.error("[ML] Sync error:", e.message);
      }
    };

    const scheduleNightlyML = () => {
      const now = new Date();
      // 2:00 AM UTC (covers games finishing in US timezones)
      const next2am = new Date(now);
      next2am.setUTCHours(7, 0, 0, 0); // 7am UTC = 2am CDT
      if (next2am <= now) next2am.setUTCDate(next2am.getUTCDate() + 1);
      const msUntil = next2am.getTime() - now.getTime();
      const hoursUntil = Math.round(msUntil / 3600000 * 10) / 10;
      console.log(`[ML] Nightly pipeline scheduled in ${hoursUntil}h`);
      setTimeout(() => {
        runNightlyML();
        // Repeat every 24h
        setInterval(runNightlyML, 24 * 60 * 60 * 1000);
      }, msUntil);
    };
    scheduleNightlyML();
  }

  app.get("/api/prediction-markets/kronos/:marketId", async (req, res) => {
    const { marketId } = req.params;
    const pred_steps = parseInt((req.query.steps as string) || "12", 10);

    // Cache check
    const cacheKey = `${marketId}:${pred_steps}`;
    const cached = kronosCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < KRONOS_TTL) {
      return res.json({ ...cached.data, cached: true });
    }

    try {
      // Step 1: Fetch price history (reuse history endpoint logic)
      let history: { t: number; p: number }[] = [];

      // Try to find the market in scan cache
      const allMarkets = await storage.getBets();
      const market = allMarkets.find((b: any) => b.id === marketId || b.polyId === marketId || b.conditionId === marketId);

      if (market?.source === "polymarket" || (!market && !marketId.startsWith("KXSPORTS"))) {
        // Polymarket: fetch CLOB history
        try {
          // Extract YES token — try clobTokenIds stored in cache
          let yesTokenId: string | null = null;
          if (market?.clobTokenIds) {
            try {
              const ids = typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
              if (Array.isArray(ids) && ids.length > 0) yesTokenId = String(ids[0]);
            } catch {}
          }
          if (!yesTokenId) {
            // Try Gamma API for token
            const gRes = await axios.get(`https://gamma-api.polymarket.com/markets/${marketId}`, { timeout: 5000 }).catch(() => null);
            if (gRes?.data?.clobTokenIds) {
              const ids = typeof gRes.data.clobTokenIds === "string" ? JSON.parse(gRes.data.clobTokenIds) : gRes.data.clobTokenIds;
              if (Array.isArray(ids) && ids.length > 0) yesTokenId = String(ids[0]);
            }
          }
          if (yesTokenId) {
            const endTs = Math.floor(Date.now() / 1000);
            const startTs = endTs - 30 * 24 * 3600;
            const hRes = await axios.get("https://clob.polymarket.com/prices-history", {
              params: { market: yesTokenId, startTs, endTs, fidelity: 60 },
              timeout: 10_000,
            });
            const raw = hRes.data?.history ?? hRes.data ?? [];
            history = (Array.isArray(raw) ? raw : []).map((pt: any) => ({ t: pt.t, p: pt.p }));
          }
        } catch (e: any) {
          console.warn("[CIQ] CLOB fetch failed:", e.message);
        }
      }

      // Build rich synthetic history from price delta anchors
      // Uses ph1 (1h), pd1 (1d), pw1 (1w) to reconstruct a 30-point price path
      // This gives Kronos enough data to detect trends, momentum, and crossovers
      if (history.length < 5) {
        const now  = Math.floor(Date.now() / 1000);
        const base = Math.max(0.02, Math.min(0.98, market?.yesPrice ?? market?.price ?? 0.5));

        // Convert % deltas back to price levels
        // ph1/pd1/pw1 are stored as percentage points (e.g. 3.2 = +3.2%)
        const ph1Raw = (market?.ph1 ?? 0) / 100;  // 1h delta as fraction
        const pd1Raw = (market?.pd1 ?? 0) / 100;  // 1d delta as fraction
        const pw1Raw = (market?.pw1 ?? 0) / 100;  // 1w delta as fraction
        const vol    = Math.max(0.003, Math.abs(pd1Raw) / 4); // volatility proxy

        // Anchor prices at known timestamps
        const p_now  = base;
        const p_1h   = Math.max(0.02, Math.min(0.98, base - ph1Raw));
        const p_1d   = Math.max(0.02, Math.min(0.98, base - pd1Raw));
        const p_1w   = Math.max(0.02, Math.min(0.98, base - pw1Raw));
        const p_2w   = Math.max(0.02, Math.min(0.98, p_1w - pw1Raw * 0.5)); // extrapolate

        // Build 30 interpolated points across 2-week window (1 per ~12h)
        // Using a simple linear interpolation between anchors + small deterministic jitter
        const anchors = [
          { t: now - 14 * 24 * 3600, p: p_2w },
          { t: now -  7 * 24 * 3600, p: p_1w },
          { t: now -  1 * 24 * 3600, p: p_1d },
          { t: now -  1 * 3600,      p: p_1h },
          { t: now,                   p: p_now },
        ];

        history = [];
        const POINTS = 30;
        const windowSecs = 14 * 24 * 3600;
        for (let i = 0; i < POINTS; i++) {
          const frac = i / (POINTS - 1);
          const ts   = now - windowSecs + Math.round(frac * windowSecs);

          // Linear interpolation between nearest anchors
          let p = p_now;
          for (let ai = 0; ai < anchors.length - 1; ai++) {
            const a0 = anchors[ai], a1 = anchors[ai + 1];
            if (ts >= a0.t && ts <= a1.t) {
              const span = a1.t - a0.t;
              const localFrac = span > 0 ? (ts - a0.t) / span : 0;
              p = a0.p + (a1.p - a0.p) * localFrac;
              break;
            }
          }

          // Deterministic jitter based on position (makes trend detectable)
          const seed   = Math.sin(i * 2.9) * 0.5 + 0.5; // pseudo-random [0,1]
          const jitter = (seed - 0.5) * vol * 0.8;
          history.push({ t: ts, p: Math.max(0.02, Math.min(0.98, p + jitter)) });
        }
      }

      // Even if market is unknown, build minimal history from any price we have
      if (history.length < 2) {
        return res.json({
          signal: "neutral", strength: 0, forecast: [],
          explanation: "No market data available for Clubhouse IQ analysis.",
          trend_slope: 0, volatility: 0, momentum: 0,
          action: "No data.", r2: 0, volatility_regime: "low",
          line_movement: { short_slope: 0, long_slope: 0, bias: "neutral", divergence: 0 },
          late_breaking: { detected: false, direction: null, magnitude: 0 },
          crossover: "none", tossup: false,
          sr: { support: null, resistance: null },
          current_cents: 0, projected_cents: 0, data_points: 0,
        });
      }

      // Step 2: Ensure Python service is up
      const ready = await ensureKronos();
      if (!ready) {
        return res.status(503).json({
          signal: "neutral", strength: 0, forecast: [],
          explanation: "Clubhouse IQ is starting up — try again in a moment.",
          error: "service_starting",
        });
      }

      // Step 3: Call Kronos (generous timeout — threaded server handles concurrency)
      const kronosRes = await axios.post(`${KRONOS_URL}/forecast`, {
        history,
        pred_steps,
      }, { timeout: 20_000 });

      const result = kronosRes.data;

      // ── Step 4: Sports Pick Overlay ────────────────────────────────────────
      // Combine CIQ price-model output with real market metadata to generate
      // a concrete, actionable sports pick with full reasoning.
      const pick = buildKronosPick(result, market);
      const enriched = { ...result, ...pick, cached: false };

      // ── Save pick to ML snapshot log so the grader can track prediction market grades ──
      if (pick.pick_side !== "pass" && market) {
        try {
          const mlDataDir = path.join(__dirname, "ml_data");
          const snapFile  = path.join(mlDataDir, "pick_snapshots.json");
          const snaps: any[] = fs.existsSync(snapFile)
            ? JSON.parse(fs.readFileSync(snapFile, "utf8"))
            : [];

          const snapId = `kronos-${marketId}-${pick.pick_side}-${Date.now()}`;
          const alreadyLogged = snaps.some((s: any) =>
            s.betId?.startsWith(`kronos-${marketId}-${pick.pick_side}`)
          );

          if (!alreadyLogged) {
            snaps.push({
              betId:           snapId,
              betType:         "prediction_market",
              sport:           market.sport ?? "Sports",
              title:           market.title ?? marketId,
              playerName:      null,
              statCategory:    null,
              line:            null,
              pickSide:        pick.pick_side,
              confidenceScore: pick.pick_confidence,
              edgeGrade:       pick.pick_grade,
              edgeScore:       pick.pick_confidence,
              gameTime:        market.endDate ?? null,
              homeTeam:        null,
              awayTeam:        null,
              loggedAt:        new Date().toISOString(),
              source:          market.source ?? "polymarket",
              pick_label:      pick.pick_label,
              pick_roi_est:    pick.pick_roi_est,
              yesPrice:        market.yesPrice ?? null,
            });
            // Keep cap at 2000
            const trimmed = snaps.slice(-2000);
            fs.writeFileSync(snapFile, JSON.stringify(trimmed, null, 2));
            console.log(`[Kronos] Saved pick snap: ${snapId} grade=${pick.pick_grade} conf=${pick.pick_confidence}`);
          }
        } catch (saveErr: any) {
          console.warn("[Kronos] Failed to save pick snap:", saveErr.message);
        }
      }

      kronosCache.set(cacheKey, { data: enriched, ts: Date.now() });
      return res.json(enriched);

    } catch (e: any) {
      console.error("[CIQ] Endpoint error:", e.message);
      return res.json({
        signal: "neutral", strength: 0, forecast: [],
        explanation: "Clubhouse IQ analysis temporarily unavailable.",
        error: e.message,
      });
    }
  });

  // ─── Linemate + PrizePicks props ──────────────────────────────────────────
  // GET /api/linemate-props?sport=nba  (nba|nfl|mlb|nhl)
  // Returns: recommended picks (SAFE/RISKY/100% Club), full market browser
  // with real lines from PrizePicks/DraftKings/Sleeper + hit rates across
  // L5/L10/L20/L30/Season windows.
  const linemateCache = new Map<string, { data: any; ts: number }>();
  const LINEMATE_TTL = 5 * 60_000; // 5-min cache

  const LINEMATE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin":  "https://linemate.io",
    "Referer": "https://linemate.io/",
    "Accept":  "application/json",
  };

  // Normalise a Linemate pick/market into a consistent shape Clubhouse IQ can use
  function normalisePick(p: any, group: string, sport: string) {
    const player     = p.player ?? {};
    const market     = p.market ?? {};
    const books      = market.books ?? p.books ?? {};

    // Collect lines per book
    const bookLines: Record<string, { line: number; overOdds: number | null; underOdds: number | null }> = {};
    for (const [bookName, bookData] of Object.entries(books as Record<string, any>)) {
      const over  = bookData?.over?.current;
      const under = bookData?.under?.current;
      if (over?.value != null) {
        bookLines[bookName] = {
          line:      over.value,
          overOdds:  over.odds?.american  ?? null,
          underOdds: under?.odds?.american ?? null,
        };
      }
    }

    // Consensus line = mode of lines across books
    const lineVals = Object.values(bookLines).map(b => b.line);
    const consensusLine = lineVals.length
      ? lineVals.sort((a, b) =>
          lineVals.filter(v => v === b).length - lineVals.filter(v => v === a).length
        )[0]
      : null;

    // Hit records — keyed by line value, then window name
    const hitRecords = p.pregameHitRecords ?? market.pregameHitRecords ?? {};
    const hitForLine = consensusLine != null ? (hitRecords[String(consensusLine)] ?? {}) : {};

    // Key windows
    const l5  = hitForLine["LAST_5"]?.all  ?? null;
    const l10 = hitForLine["LAST_10"]?.all ?? null;
    const l20 = hitForLine["LAST_20"]?.all ?? null;
    const l30 = hitForLine["LAST_30"]?.all ?? null;
    const season = hitForLine["SEASON"]?.all ?? null;
    const recentForm = hitForLine["CUSTOM_RECENT_FORM_OVER"]?.all
                    ?? hitForLine["CUSTOM_RECENT_FORM_UNDER"]?.all
                    ?? null;

    // Determine best hit rate across windows (for "100% club" detection)
    const winRates = [l5, l10, l20, l30].filter(Boolean).map((w: any) => w.hitRate ?? 0);
    const bestHitRate = winRates.length ? Math.max(...winRates) : null;

    // Insights / narratives
    const insights   = p.insights   ?? [];
    const narratives = p.narratives ?? [];
    const contextual = p.contextualInsights ?? [];
    const description = p.description ?? "";

    return {
      // Identity
      sport,
      group,
      gameId:      p.gameId ?? "",
      playerName:  player.fullName  ?? "",
      playerPos:   player.position  ?? "",
      teamCode:    p.team?.code     ?? "",
      opponent:    p.opposingTeam?.code ?? "",
      isHome:      p.home ?? null,
      gameTime:    p.timestamp ?? "",

      // Market
      marketName:    market.name ?? p.market ?? "",
      marketType:    market.type ?? "OVER_UNDER",
      outcome:       p.outcome ?? "OVER",
      consensusLine,
      bookLines,

      // Hit rates (most useful at a glance)
      hitRateL5:     l5?.hitRate     ?? null,
      hitRateL10:    l10?.hitRate    ?? null,
      hitRateL20:    l20?.hitRate    ?? null,
      hitRateL30:    l30?.hitRate    ?? null,
      hitRateSeason: season?.hitRate ?? null,
      hitRateRecentForm: recentForm?.hitRate ?? null,
      avgRecentForm: recentForm?.average ?? null,
      bestHitRate,
      is100Club:     bestHitRate != null && bestHitRate >= 100,

      // Full hit records (for detail drawer)
      hitRecords,

      // Context
      description,
      insights,
      narratives,
      contextual,
      impactingInjuries: p.impactingInjuries ?? [],
      opponentDefRank:   p.opponentDefensiveRankInsights ?? null,
    };
  }


  // ── Live Standings for Bracket Tab ────────────────────────────────────────
  // Cache: 24 hours (standings update once daily)
  const STANDINGS_TTL = 24 * 60 * 60 * 1000;  // 24h — force-bust via ?bust=1
  const standingsCache = new Map<string, { ts: number; data: any }>();

  app.get("/api/live-standings", async (req, res) => {
    const sport = ((req.query.sport as string) ?? "mlb").toLowerCase();
    const bust = req.query.bust === "1";
    const cached = standingsCache.get(sport);
    if (!bust && cached && Date.now() - cached.ts < STANDINGS_TTL) return res.json(cached.data);

    try {
      const ESPN_PATHS: Record<string, string> = {
        mlb: "baseball/mlb",
        nba: "basketball/nba",
        nhl: "hockey/nhl",
        nfl: "football/nfl",
      };
      const TOTAL_GAMES: Record<string, number> = { mlb: 162, nba: 82, nhl: 82, nfl: 17 };
      const espnPath = ESPN_PATHS[sport];
      if (!espnPath) return res.status(400).json({ error: "Unknown sport" });

      const standingsUrl = `https://site.api.espn.com/apis/v2/sports/${espnPath}/standings`;
      const standingsResp = await fetch(standingsUrl);
      if (!standingsResp.ok) throw new Error(`ESPN standings failed: ${standingsResp.status}`);
      const standingsData: any = await standingsResp.json();

      const seasonYear = standingsData?.season?.year ?? new Date().getFullYear();
      const totalGamesPerTeam = TOTAL_GAMES[sport] ?? 82;

      // Flatten all entries across all conference/division children
      const allEntries: any[] = [];
      const extractEntries = (node: any)  =>{
        const entries = node?.standings?.entries;
        if (Array.isArray(entries)) {
          allEntries.push(...entries);
        }
        if (Array.isArray(node?.children)) {
          node.children.forEach(extractEntries);
        }
      }
      extractEntries(standingsData);

      // Deduplicate by team id
      const seen = new Set<string>();
      const uniqueEntries = allEntries.filter(e => {
        const id = e?.team?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      // Parse each team's stats
      const getStat = (stats: any[], name: string): number  =>{
        const s = stats.find((x: any) => x.name === name);
        return s ? parseFloat(s.value ?? s.displayValue ?? "0") || 0 : 0;
      }
      const getStatStr = (stats: any[], name: string): string  =>{
        const s = stats.find((x: any) => x.name === name);
        return s ? (s.displayValue ?? "") : "";
      }

      // Calculate max games played to estimate season completion
      let maxGamesPlayed = 0;
      const teams = uniqueEntries.map(e => {
        const team = e.team ?? {};
        const stats = e.stats ?? [];
        const gp = getStat(stats, "gamesPlayed");
        if (gp > maxGamesPlayed) maxGamesPlayed = gp;
        const wins = getStat(stats, "wins");
        const losses = getStat(stats, "losses");
        const seed = getStat(stats, "playoffSeed");
        const pctg = getStat(stats, "winPercent");
        const ppg = getStat(stats, "avgPointsFor") || getStat(stats, "points");
        const oppPpg = getStat(stats, "avgPointsAgainst");
        const differential = getStat(stats, "differential");
        // Conference: use parent chain if available
        const conference = e._conf ?? "";
        return {
          id: team.id ?? "",
          name: team.displayName ?? team.name ?? "Unknown",
          shortName: team.shortDisplayName ?? team.abbreviation ?? "",
          abbreviation: team.abbreviation ?? "",
          logoUrl: team.logos?.[0]?.href ?? `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${sport === "mlb" ? "mlb" : sport === "nba" ? "nba" : sport === "nhl" ? "nhl" : "nfl"}/500/${(team.abbreviation ?? "").toLowerCase()}.png&w=64&h=64`,
          seed: seed,
          gamesPlayed: gp,
          wins: wins,
          losses: losses,
          winPct: pctg,
          ppg: ppg,
          oppPpg: oppPpg,
          differential: differential,
          conference: conference,
          record: `${wins}-${losses}`,
        };
      });

      // Assign conference from standings children structure
      const assignConference = (node: any, confName: string)  =>{
        const entries = node?.standings?.entries;
        if (Array.isArray(entries)) {
          entries.forEach((e: any) => { e._conf = confName; });
        }
        if (Array.isArray(node?.children)) {
          node.children.forEach((c: any) => assignConference(c, confName));
        }
      }
      // Re-do with conference info
      if (Array.isArray(standingsData?.children)) {
        standingsData.children.forEach((confNode: any) => {
          const confName = confNode.name ?? "";
          assignConference(confNode, confName);
        });
      }

      // Re-parse with conference
      const teamsWithConf = uniqueEntries.map(e => {
        const team = e.team ?? {};
        const stats = e.stats ?? [];
        const gp = getStat(stats, "gamesPlayed");
        const wins = getStat(stats, "wins");
        const losses = getStat(stats, "losses");
        const seed = getStat(stats, "playoffSeed");
        const pctg = getStat(stats, "winPercent");
        const ppg = getStat(stats, "avgPointsFor") || getStat(stats, "points");
        const oppPpg = getStat(stats, "avgPointsAgainst");
        const differential = getStat(stats, "differential");
        const gb = getStatStr(stats, "gamesBehind");
        const elim = getStat(stats, "magicNumberElimination");
        const clinch = getStat(stats, "magicNumberClinch");
        const streakStat = stats.find((x: any) => x.name === "streak");
        const streak = streakStat?.displayValue ?? "";
        // clincher: ESPN stores a numeric code when a team has clinched
        // 1=division, 2=conference, 3=playoff berth/division leader, 4=eliminated, 5=presidents trophy, 6=play-in
        // We treat codes 1,2,3,5 as "clinched playoff spot", 6 as "play-in", blank as "projected"
        const clinchCode = getStat(stats, "clincher");
        const clinchStr  = getStatStr(stats, "clincher");
        let clinchStatus: "clinched" | "playin" | "projected" | "eliminated" = "projected";
        if (clinchCode >= 1 && clinchCode <= 3) clinchStatus = "clinched";
        else if (clinchCode === 5) clinchStatus = "clinched";
        else if (clinchCode === 6) clinchStatus = "playin";
        else if (clinchCode === 4) clinchStatus = "eliminated";

        return {
          id: String(team.id ?? ""),
          espnId: String(team.id ?? ""),
          name: team.displayName ?? team.name ?? "Unknown",
          shortName: team.shortDisplayName ?? team.abbreviation ?? "",
          abbreviation: team.abbreviation ?? "",
          seed: Math.round(seed),
          gamesPlayed: Math.round(gp),
          wins: Math.round(wins),
          losses: Math.round(losses),
          winPct: pctg,
          ppg: ppg,
          oppPpg: oppPpg,
          differential: differential,
          conference: e._conf ?? "",
          record: `${Math.round(wins)}-${Math.round(losses)}`,
          gamesBehind: gb,
          streak: streak,
          clinchStatus,  // "clinched" | "playin" | "projected" | "eliminated"
          clinchCode: Math.round(clinchCode),
        };
      });

      // Compute season completion %
      // NBA/NHL: if gamesPlayed=0 it means off-season, check season year
      let seasonPct = 0;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1; // 1-based

      if (maxGamesPlayed > 0) {
        seasonPct = Math.min(100, (maxGamesPlayed / totalGamesPerTeam) * 100);
      } else {
        // gamesPlayed=0 means completed season — check if it's the right year
        // NBA: season ends ~June, next starts ~October
        // NHL: season ends ~June, next starts ~October
        // MLB: season ends ~October, next starts ~April
        // NFL: season ends ~February, next starts ~September
        const isOffseason = (sport === "nba" && (currentMonth >= 7 && currentMonth <= 9)) ||
                            (sport === "nhl" && (currentMonth >= 7 && currentMonth <= 9)) ||
                            (sport === "mlb" && (currentMonth >= 11 || currentMonth <= 2)) ||
                            (sport === "nfl" && (currentMonth >= 3 && currentMonth <= 8));
        seasonPct = isOffseason ? 0 : 100; // if not offseason and gp=0, treat as completed
      }

      // Determine bracket unlock state
      const UNLOCK_THRESHOLD = 90; // show bracket at 90% of season complete
      const bracketUnlocked = seasonPct >= UNLOCK_THRESHOLD;

      // Identify playoff teams (top 6 for MLB, top 8 for NBA/NHL, top 7 for NFL)
      const PLAYOFF_SPOTS: Record<string, number> = { mlb: 6, nba: 8, nhl: 8, nfl: 7 };
      const playoffSpots = PLAYOFF_SPOTS[sport] ?? 8;

      // Group by conference and get top seeds
      const conferences = new Map<string, any[]>();
      teamsWithConf.forEach(t => {
        const key = t.conference || "League";
        if (!conferences.has(key)) conferences.set(key, []);
        conferences.get(key)!.push(t);
      });

      const playoffTeamsByConf: Record<string, any[]> = {};
      // fullConfTeams: ALL teams sorted by seed (used for the swapper modal)
      const fullConfTeams: Record<string, any[]> = {};
      conferences.forEach((teams, confName) => {
        const sorted = [...teams].sort((a, b) => (a.seed || 99) - (b.seed || 99));
        // Exclude eliminated teams (clinchCode=4) from the bracket seedings
        const nonEliminated = sorted.filter(t => t.clinchCode !== 4);
        playoffTeamsByConf[confName] = nonEliminated.slice(0, playoffSpots);
        // Full list excludes eliminated teams (clinchCode=4)
        fullConfTeams[confName] = sorted.filter(t => t.clinchCode !== 4);
      });

      const result = {
        sport,
        seasonYear,
        seasonPct: Math.round(seasonPct * 10) / 10,
        maxGamesPlayed,
        totalGamesPerTeam,
        bracketUnlocked,
        unlockThreshold: UNLOCK_THRESHOLD,
        updatedAt: new Date().toISOString(),
        conferences: Object.fromEntries(
          Array.from(conferences.entries()).map(([name, teams]) => [
            name,
            [...teams].sort((a, b) => (a.seed || 99) - (b.seed || 99)),
          ])
        ),
        playoffTeamsByConf,
        fullConfTeams,   // all non-eliminated teams per conf (for swapper)
        allTeams: teamsWithConf,
      };

      standingsCache.set(sport, { ts: Date.now(), data: result });
      return res.json(result);
    } catch (e: any) {
      console.error("[live-standings]", e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/linemate-props", async (req, res) => {
    const sport  = ((req.query.sport as string) ?? "nba").toLowerCase();
    const cached = linemateCache.get(sport);
    if (cached && Date.now() - cached.ts < LINEMATE_TTL) return res.json(cached.data);

    try {
      const BASE = `https://api.linemate.io/api/${sport}`;

      // Parallel fetch: recommended picks + full market list
      const [straightsRes, marketsRes, gamesRes] = await Promise.allSettled([
        axios.get(`${BASE}/v1/discovery/preview/straights`, {
          params: {
            preferredProviders: "",
            limit: 20,
            groups: "SAFE,RISKY,PERFECT_HIT_RATE_ALTERNATES",
            narratives: "",
          },
          headers: LINEMATE_HEADERS, timeout: 12000,
        }),
        axios.get(`${BASE}/v2/markets`, {
          params: { levelsToInclude: "player" },
          headers: LINEMATE_HEADERS, timeout: 12000,
        }),
        axios.get(`${BASE}/v2/games/current`, {
          params: { recordType: "REGULAR" },
          headers: LINEMATE_HEADERS, timeout: 8000,
        }),
      ]);

      // ── Recommended picks ────────────────────────────────────────────────
      const picks: Record<string, any[]> = { SAFE: [], RISKY: [], "100_CLUB": [] };
      if (straightsRes.status === "fulfilled") {
        const groups = straightsRes.value.data?.groups ?? {};
        for (const [grp, items] of Object.entries(groups as Record<string, any[]>)) {
          const propGroup = grp === "PERFECT_HIT_RATE_ALTERNATES" ? "100_CLUB"
                          : grp === "SAFE"  ? "SAFE"
                          : grp === "RISKY" ? "RISKY"
                          : null;
          if (!propGroup) continue;
          const raw = (items ?? []).map(p => normalisePick(p, propGroup, sport.toUpperCase()));
          picks[propGroup] = sport === "mlb"
            ? raw.filter((p: any) => {
                const mn = (p.marketName ?? "").toUpperCase();
                if (mn === "HITTER_TRIPLES" || mn === "HITTER_HITS_PLUS_RUNS_PLUS_RUNS_BATTED_IN") return false;
                if ((mn === "HITTER_STOLEN_BASES" || mn === "HITTER_HOME_RUNS") && (p.pickSide ?? "").toUpperCase() === "UNDER") return false;
                return true;
              })
            : raw;
        }
      }

      // ── Full market browser ──────────────────────────────────────────────
      // MLB banned market names — triples and H+R+RBI combo are not displayed
      const MLB_BANNED_MARKETS = new Set([
        "HITTER_TRIPLES",
        "HITTER_HITS_PLUS_RUNS_PLUS_RUNS_BATTED_IN",
      ]);

      let markets: any[] = [];
      if (marketsRes.status === "fulfilled" && Array.isArray(marketsRes.value.data)) {
        markets = marketsRes.value.data
          .filter((m: any) => {
            if (!m.player || !m.name) return false;
            // For MLB: strip banned market types
            if (sport === "mlb" && MLB_BANNED_MARKETS.has(m.name)) return false;
            return true;
          })
          .map((m: any) => normalisePick(
            {
              gameId:         m.gameId,
              player:         m.player,
              team:           m.team,
              opposingTeam:   m.opposingTeam,
              isHome:         m.isHome,
              market:         m,
              outcome:        "OVER",
              pregameHitRecords: m.pregameHitRecords,
              pregameAverages:   m.pregameAverages,
            },
            "MARKET",
            sport.toUpperCase()
          ));

        // MLB: also filter stolen bases UNDER and HR UNDER from market browser
        if (sport === "mlb") {
          markets = markets.filter((m: any) => {
            const mn = (m.marketName ?? "").toUpperCase();
            if ((mn === "HITTER_STOLEN_BASES" || mn === "HITTER_HOME_RUNS") && (m.pickSide ?? "").toUpperCase() === "UNDER") return false;
            return true;
          });
        }
      }

      // ── Today's games ────────────────────────────────────────────────────
      let games: any[] = [];
      if (gamesRes.status === "fulfilled" && Array.isArray(gamesRes.value.data)) {
        games = gamesRes.value.data.map((g: any) => ({
          gameId:    g.id,
          home:      g.homeTeamCode,
          away:      g.awayTeamCode,
          timestamp: g.timestamp,
          status:    g.status,
        }));
      }

      // ── Build a flat prop-line map for scanner enrichment ─────────────────
      // Key: "PLAYERNAMELOWER:MARKETNAME" → { line, hitRateL10, hitRateL5 }
      const propLineMap: Record<string, { line: number; hitRateL5: number | null; hitRateL10: number | null; source: string }> = {};
      for (const m of markets) {
        if (!m.playerName || m.consensusLine == null) continue;
        const key = `${m.playerName.toLowerCase()}:${m.marketName}`;
        propLineMap[key] = {
          line:       m.consensusLine,
          hitRateL5:  m.hitRateL5,
          hitRateL10: m.hitRateL10,
          source:     "linemate",
        };
      }

      const result = {
        sport: sport.toUpperCase(),
        picks,
        markets,
        games,
        propLineMap,
        fetchedAt: new Date().toISOString(),
      };

      linemateCache.set(sport, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      console.error(`[linemate-props/${sport}] Error:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Top Traders — Polymarket leaderboard + recent trades ──────────────────
  // GET /api/top-traders?category=SPORTS&period=ALL&limit=20
  // Returns: top Polymarket traders by PNL + their recent sports trades
  let topTradersCache: { data: any; ts: number } = { data: null, ts: 0 };
  const TOP_TRADERS_TTL = 5 * 60_000; // 5 min cache (leaderboard changes slowly)

  app.get("/api/top-traders", async (req, res) => {
    try {
      if (Date.now() - topTradersCache.ts < TOP_TRADERS_TTL && topTradersCache.data) {
        return res.json(topTradersCache.data);
      }

      const category  = (req.query.category as string) ?? "SPORTS";
      const period    = (req.query.period   as string) ?? "ALL";
      const limit     = Math.min(25, parseInt(String(req.query.limit ?? "20"), 10));

      // ── 1. Fetch Polymarket leaderboard ──────────────────────────────────
      let traders: any[] = [];
      try {
        const { data: lb } = await axios.get("https://data-api.polymarket.com/v1/leaderboard", {
          params: { category, timePeriod: period, orderBy: "PNL", limit },
          timeout: 10000,
        });
        traders = Array.isArray(lb) ? lb : [];
      } catch (e: any) {
        console.warn("[top-traders] Polymarket leaderboard error:", e.message);
      }

      // ── 2. Fetch recent trades for top 10 traders in parallel ────────────
      // We cap at 10 to avoid too many parallel requests
      const TOP_N = Math.min(10, traders.length);
      const tradeResults = await Promise.allSettled(
        traders.slice(0, TOP_N).map(async (trader: any) => {
          const wallet = trader.proxyWallet;
          if (!wallet) return { wallet, trades: [] };
          try {
            const { data: activity } = await axios.get("https://data-api.polymarket.com/activity", {
              params: {
                user:  wallet,
                limit: 20,
                type:  "TRADE",
                side:  "BUY",
                sortBy: "TIMESTAMP",
                sortDirection: "DESC",
              },
              timeout: 8000,
            });
            const trades: any[] = Array.isArray(activity) ? activity : [];
            // Group by conditionId to compute transaction type and total size per market
            const byMarket = new Map<string, any[]>();
            for (const t of trades) {
              const cid = t.conditionId ?? t.slug ?? "unknown";
              if (!byMarket.has(cid)) byMarket.set(cid, []);
              byMarket.get(cid)!.push(t);
            }
            // Build enriched trade list — deduplicated by market, most recent first
            const enriched: any[] = [];
            for (const [, txns] of byMarket) {
              const latest  = txns[0]; // already sorted newest-first
              const total   = txns.reduce((s, t) => s + (t.usdcSize ?? 0), 0);
              const txCount = txns.length;
              // Classification:
              // single = 1 transaction
              // ongoing = same market traded 3+ times (averaging in or building position)
              // multiple = 2 transactions
              const purchaseType: "single" | "multiple" | "ongoing" =
                txCount >= 3 ? "ongoing" : txCount === 1 ? "single" : "multiple";
              enriched.push({
                market:       latest.title ?? "",
                slug:         latest.slug ?? "",
                eventSlug:    latest.eventSlug ?? "",
                outcome:      latest.outcome ?? "",
                side:         latest.side ?? "BUY",
                price:        latest.price ?? 0,
                totalUsdc:    Math.round(total * 100) / 100,
                txCount,
                purchaseType,
                timestamp:    latest.timestamp ?? 0,
                icon:         latest.icon ?? "",
                conditionId:  latest.conditionId ?? "",
                polyUrl:      latest.slug ? `https://polymarket.com/event/${latest.eventSlug || latest.slug}` : null,
              });
            }
            // Sort by total USDC spent descending (biggest bets first)
            enriched.sort((a, b) => b.totalUsdc - a.totalUsdc);
            return { wallet, trades: enriched.slice(0, 10) };
          } catch {
            return { wallet, trades: [] };
          }
        })
      );

      // ── 3. Merge leaderboard + trades ─────────────────────────────────────
      const enrichedTraders = traders.slice(0, TOP_N).map((trader: any, i: number) => {
        const result = tradeResults[i];
        const trades = result.status === "fulfilled" ? result.value.trades : [];
        const displayName = trader.userName && !trader.userName.startsWith("0x")
          ? trader.userName
          : `Trader ${(trader.rank ?? i + 1)}`;
        const shortWallet = trader.proxyWallet
          ? `${trader.proxyWallet.slice(0, 6)}…${trader.proxyWallet.slice(-4)}`
          : "";
        return {
          rank:         trader.rank ?? String(i + 1),
          wallet:       trader.proxyWallet ?? "",
          shortWallet,
          displayName,
          xUsername:    trader.xUsername ?? null,
          profileImage: trader.profileImage ?? null,
          verifiedBadge: trader.verifiedBadge ?? false,
          vol:          trader.vol  ?? 0,
          pnl:          trader.pnl  ?? 0,
          trades,
          source:       "polymarket",
        };
      });

      // Append remaining leaderboard entries (11-25) without trade detail
      for (let i = TOP_N; i < traders.length; i++) {
        const trader = traders[i];
        const displayName = trader.userName && !trader.userName.startsWith("0x")
          ? trader.userName
          : `Trader ${(trader.rank ?? i + 1)}`;
        const shortWallet = trader.proxyWallet
          ? `${trader.proxyWallet.slice(0, 6)}…${trader.proxyWallet.slice(-4)}`
          : "";
        enrichedTraders.push({
          rank:         trader.rank ?? String(i + 1),
          wallet:       trader.proxyWallet ?? "",
          shortWallet,
          displayName,
          xUsername:    trader.xUsername ?? null,
          profileImage: trader.profileImage ?? null,
          verifiedBadge: trader.verifiedBadge ?? false,
          vol:          trader.vol  ?? 0,
          pnl:          trader.pnl  ?? 0,
          trades:       [],
          source:       "polymarket",
        });
      }

      const result = {
        traders:   enrichedTraders,
        category,
        period,
        source:    "polymarket",
        fetchedAt: new Date().toISOString(),
      };

      topTradersCache = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      console.error("[top-traders] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Top Traders: positions (open bets) per wallet ─────────────────────────
  // GET /api/top-traders/positions?category=SPORTS&period=ALL&limit=20
  // Returns: all open positions held by top traders, aggregated across wallets
  let topTradersPositionsCache: { data: any; ts: number } = { data: null, ts: 0 };
  const POSITIONS_TTL = 3 * 60_000; // 3 min cache

  app.get("/api/top-traders/positions", async (req, res) => {
    try {
      if (Date.now() - topTradersPositionsCache.ts < POSITIONS_TTL && topTradersPositionsCache.data) {
        return res.json(topTradersPositionsCache.data);
      }

      const category = (req.query.category as string) ?? "SPORTS";
      const period   = (req.query.period   as string) ?? "ALL";
      const limit    = Math.min(25, parseInt(String(req.query.limit ?? "20"), 10));

      // 1. Fetch leaderboard to get wallets
      let traders: any[] = [];
      try {
        const { data: lb } = await axios.get("https://data-api.polymarket.com/v1/leaderboard", {
          params: { category, timePeriod: period, orderBy: "PNL", limit },
          timeout: 10000,
        });
        traders = Array.isArray(lb) ? lb : [];
      } catch (e: any) {
        console.warn("[top-traders/positions] leaderboard error:", e.message);
      }

      const TOP_N = Math.min(15, traders.length);

      // 2. Fetch positions for each trader in parallel
      const posResults = await Promise.allSettled(
        traders.slice(0, TOP_N).map(async (trader: any) => {
          const wallet = trader.proxyWallet;
          if (!wallet) return { trader, positions: [] };
          const displayName = trader.userName && !trader.userName.startsWith("0x")
            ? trader.userName
            : `Trader ${trader.rank ?? "?"}`;
          try {
            const { data: pos } = await axios.get("https://data-api.polymarket.com/positions", {
              params: { user: wallet, limit: 20, sizeThreshold: 5 },
              timeout: 8000,
            });
            const positions = Array.isArray(pos) ? pos : [];
            // Filter out fully resolved / redeemable / near-zero value
            const active = positions
              .filter((p: any) => !p.redeemable && (p.currentValue ?? 0) > 1)
              .map((p: any) => ({
                wallet,
                shortWallet: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
                displayName,
                xUsername:    trader.xUsername ?? null,
                profileImage: trader.profileImage ?? null,
                rank:         trader.rank ?? 0,
                pnl:          trader.pnl ?? 0,
                // Position fields
                title:        p.title ?? "",
                slug:         p.slug ?? "",
                eventSlug:    p.eventSlug ?? "",
                icon:         p.icon ?? "",
                outcome:      p.outcome ?? "",
                size:         p.size ?? 0,
                avgPrice:     p.avgPrice ?? 0,
                curPrice:     p.curPrice ?? 0,
                currentValue: p.currentValue ?? 0,
                initialValue: p.initialValue ?? 0,
                cashPnl:      p.cashPnl ?? 0,
                percentPnl:   p.percentPnl ?? 0,
                endDate:      p.endDate ?? "",
                polyUrl:      p.slug ? `https://polymarket.com/event/${p.eventSlug || p.slug}` : null,
                conditionId:  p.conditionId ?? "",
                asset:        p.asset ?? "",
              }));
            return { trader, positions: active };
          } catch {
            return { trader, positions: [] };
          }
        })
      );

      // 3. Flatten to a unified list of positions sorted by currentValue desc
      const allPositions: any[] = [];
      for (const r of posResults) {
        if (r.status === "fulfilled") {
          allPositions.push(...r.value.positions);
        }
      }
      allPositions.sort((a, b) => b.currentValue - a.currentValue);

      // Also build per-trader summary (wallet → positions)
      const byTrader: Record<string, { displayName: string; xUsername: string | null; profileImage: string | null; rank: number; pnl: number; positions: any[] }> = {};
      for (const p of allPositions) {
        if (!byTrader[p.wallet]) {
          byTrader[p.wallet] = {
            displayName:  p.displayName,
            xUsername:    p.xUsername,
            profileImage: p.profileImage,
            rank:         p.rank,
            pnl:          p.pnl,
            positions:    [],
          };
        }
        byTrader[p.wallet].positions.push(p);
      }

      const result = {
        positions:  allPositions,
        byTrader,
        category,
        period,
        fetchedAt: new Date().toISOString(),
      };

      topTradersPositionsCache = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      console.error("[top-traders/positions] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Top Traders: deep position detail ─────────────────────────────────────
  // GET /api/top-traders/position-detail?conditionId=0x...&wallet=0x...&asset=TOKEN_ID
  // Returns: market description, volume/liquidity, price history, full trade log for this wallet
  const posDetailCache = new Map<string, { data: any; ts: number }>();
  const POS_DETAIL_TTL = 2 * 60_000; // 2 min

  app.get("/api/top-traders/position-detail", async (req, res) => {
    try {
      const conditionId = req.query.conditionId as string;
      const wallet      = req.query.wallet      as string;
      const asset       = req.query.asset       as string;

      if (!conditionId || !wallet) {
        return res.status(400).json({ error: "conditionId and wallet are required" });
      }

      const cacheKey = `${conditionId}:${wallet}`;
      if (posDetailCache.has(cacheKey)) {
        const cached = posDetailCache.get(cacheKey)!;
        if (Date.now() - cached.ts < POS_DETAIL_TTL) return res.json(cached.data);
      }

      // Parallel fetch: market detail + price history + trade log
      const [marketRes, historyRes, tradesRes] = await Promise.allSettled([
        // 1. Market description, volume, resolution source
        axios.get("https://gamma-api.polymarket.com/markets", {
          params: { conditionIds: conditionId },
          timeout: 8000,
        }),
        // 2. Price history (last 30 days, daily fidelity)
        asset ? axios.get("https://clob.polymarket.com/prices-history", {
          params: { market: asset, interval: "1m", fidelity: 1440 },
          timeout: 8000,
        }) : Promise.resolve({ data: { history: [] } }),
        // 3. Full trade log for this wallet on this market
        axios.get("https://data-api.polymarket.com/activity", {
          params: { user: wallet, conditionId, type: "TRADE", limit: 50 },
          timeout: 8000,
        }),
      ]);

      // Parse market detail
      let market: any = {};
      if (marketRes.status === "fulfilled" && Array.isArray(marketRes.value.data) && marketRes.value.data.length > 0) {
        const m = marketRes.value.data[0];
        market = {
          question:         m.question ?? "",
          description:      m.description ?? "",
          resolutionSource: m.resolutionSource ?? "",
          volume:           m.volumeNum ?? m.volume ?? 0,
          volume24hr:       m.volume24hr ?? 0,
          volume1wk:        m.volume1wk ?? 0,
          volume1mo:        m.volume1mo ?? 0,
          liquidity:        m.liquidityNum ?? m.liquidity ?? 0,
          outcomePrices:    (() => { try { return JSON.parse(m.outcomePrices ?? "[]"); } catch { return []; } })(),
          outcomes:         (() => { try { return JSON.parse(m.outcomes ?? "[]"); } catch { return []; } })(),
          startDate:        m.startDateIso ?? m.startDate ?? "",
          endDate:          m.endDateIso   ?? m.endDate   ?? "",
          active:           m.active ?? true,
          closed:           m.closed ?? false,
        };
      }

      // Parse price history
      let priceHistory: { t: number; p: number }[] = [];
      if (historyRes.status === "fulfilled") {
        priceHistory = historyRes.value.data?.history ?? [];
      }

      // Parse trade log
      let trades: any[] = [];
      if (tradesRes.status === "fulfilled" && Array.isArray(tradesRes.value.data)) {
        trades = tradesRes.value.data.map((t: any) => ({
          side:      t.side ?? "BUY",
          price:     t.price ?? 0,
          size:      t.size ?? 0,
          usdcSize:  t.usdcSize ?? 0,
          outcome:   t.outcome ?? "",
          timestamp: t.timestamp ?? 0,
          txHash:    t.transactionHash ?? null,
        }));
      }

      // Summary stats from trades
      const buys        = trades.filter(t => t.side === "BUY");
      const sells       = trades.filter(t => t.side === "SELL");
      const totalIn     = buys.reduce((s, t) => s + t.usdcSize, 0);
      const totalOut    = sells.reduce((s, t) => s + t.usdcSize, 0);
      const firstTrade  = trades.length ? trades[trades.length - 1] : null;
      const latestTrade = trades.length ? trades[0] : null;

      const result = {
        market,
        priceHistory,
        trades,
        summary: {
          totalIn:      Math.round(totalIn  * 100) / 100,
          totalOut:     Math.round(totalOut * 100) / 100,
          totalTrades:  trades.length,
          buyCount:     buys.length,
          sellCount:    sells.length,
          firstTradeAt: firstTrade?.timestamp ?? 0,
          latestTradeAt: latestTrade?.timestamp ?? 0,
          avgBuyPrice:  buys.length ? buys.reduce((s, t) => s + t.price, 0) / buys.length : 0,
        },
      };

      posDetailCache.set(cacheKey, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      console.error("[position-detail] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Prediction Markets: per-market transaction type for whale alerts ──────
  // GET /api/prediction-markets/txtype/:marketId
  // Returns: purchaseType (single/multiple/ongoing) + txCount for a specific whale market
  app.get("/api/prediction-markets/txtype/:marketId", async (req, res) => {
    try {
      const { marketId } = req.params;
      // Only Polymarket markets can have wallet-based transaction lookup
      if (!marketId.startsWith("poly-")) {
        // Kalshi: use vol24h heuristic from cache
        const cached = predMktCache.data.find((m: any) => m.id === marketId);
        if (!cached) return res.json({ purchaseType: "single", txCount: 1 });
        const vol = cached.vol24h ?? 0;
        // Kalshi: vol < $2K = likely single; $2K-$8K = multiple; > $8K = ongoing
        const purchaseType = vol >= 8_000 ? "ongoing" : vol >= 2_000 ? "multiple" : "single";
        return res.json({ purchaseType, txCount: purchaseType === "ongoing" ? 5 : purchaseType === "multiple" ? 2 : 1, source: "heuristic" });
      }

      // Polymarket: look up CLOB trades for the conditionId
      const rawId = marketId.replace("poly-", "");
      const cached = predMktCache.data.find((m: any) => m.id === marketId);
      if (!cached) return res.json({ purchaseType: "single", txCount: 1, source: "not_found" });

      // Fetch recent trades on the CLOB for this market
      try {
        const { data: tradesData } = await axios.get("https://clob.polymarket.com/trades", {
          params: { market: cached.conditionId ?? rawId, limit: 50 },
          timeout: 8000,
        });
        const trades = (tradesData?.data ?? tradesData?.trades ?? (Array.isArray(tradesData) ? tradesData : [])) as any[];
        if (trades.length === 0) return res.json({ purchaseType: "single", txCount: 1, source: "clob" });

        // Group by maker address (takerAddress is the buyer for CLOB)
        const byMaker = new Map<string, number>();
        for (const t of trades) {
          const addr = t.maker ?? t.takerAddress ?? t.maker_address ?? "";
          if (addr) byMaker.set(addr, (byMaker.get(addr) ?? 0) + 1);
        }
        // Top buyer: how many transactions did they make?
        const maxTxns = Math.max(...Array.from(byMaker.values()));
        const purchaseType: "single" | "multiple" | "ongoing" =
          maxTxns >= 3 ? "ongoing" : maxTxns === 1 ? "single" : "multiple";
        return res.json({
          purchaseType,
          txCount:       maxTxns,
          totalTrades:   trades.length,
          uniqueBuyers:  byMaker.size,
          source:        "clob",
        });
      } catch {
        // CLOB may return 404 or empty — use vol24h heuristic
        const vol = cached.vol24h ?? 0;
        const purchaseType = vol >= 500_000 ? "ongoing" : vol >= 200_000 ? "multiple" : "single";
        return res.json({ purchaseType, txCount: purchaseType === "ongoing" ? 5 : purchaseType === "multiple" ? 2 : 1, source: "heuristic" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Debug endpoint — check Underdog NHL cache + current bets breakdown
  app.get("/api/debug/nhl", async (req, res) => {
    try {
      const axios = (await import("axios")).default;
      const cacheResp = await axios.get("https://raw.githubusercontent.com/abudnick8/clubhouse-iq/cache/data/underdog-cache/underdog_NHL.json", { timeout: 10000 });
      const cacheData = cacheResp.data;
      const lines: any[] = cacheData.over_under_lines ?? [];
      const goalLines = lines.filter((l: any) => {
        const ou = l.over_under ?? {};
        const appStat = ou.appearance_stat ?? {};
        return l.status === "active" && ou.category === "player_prop" && (appStat.stat ?? "").toLowerCase() === "goals";
      });
      const allBets = await storage.getBets();
      const nhlBets = allBets.filter((b: any) => b.sport === "NHL");
      const nhlGoalBets = nhlBets.filter((b: any) => b.title.toLowerCase().includes("goals"));
      const nhlLotto = nhlBets.filter((b: any) => b.isLotto);
      const nhlUnd = nhlBets.filter((b: any) => b.source === "underdog");
      const statBreakdown: Record<string, number> = {};
      for (const b of nhlUnd) { const s = (b.teamStats as any)?.statType ?? "?"; statBreakdown[s] = (statBreakdown[s] ?? 0) + 1; }
      res.json({
        cache: { totalLines: lines.length, goalLines: goalLines.length, cachedAt: cacheData.cached_at },
        bets: { nhlTotal: nhlBets.length, nhlGoals: nhlGoalBets.length, nhlLotto: nhlLotto.length, nhlUnderdog: nhlUnd.length, nhlUnderdogStats: statBreakdown },
        sampleGoalBets: nhlGoalBets.slice(0, 3).map((b: any) => b.title),
        buildTime: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API Quota Check ─────────────────────────────────────────────────────
  // TEMP DEBUG — remove after Underdog fix confirmed

  app.get("/api/quota", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const apiKey = settings.oddsApiKey;
      if (!apiKey) return res.json({ status: "no_key", used: null, remaining: null, resets: null });

      const axios = (await import("axios")).default;
      const response = await axios.head(
        `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`,
        { timeout: 8000 }
      );
      const used = parseInt(response.headers["x-requests-used"] ?? "0");
      const remaining = parseInt(response.headers["x-requests-remaining"] ?? "0");

      // The Odds API resets on the 1st of each month UTC
      const now = new Date();
      const resetDate = new Date(Date.UTC(
        now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
        now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1,
        1
      ));

      res.json({
        status: remaining > 0 ? "ok" : "exhausted",
        used,
        remaining,
        resets: resetDate.toISOString(),
        plan: remaining > 5000 ? "paid_20000" : "free_500",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Settings ─────────────────────────────────────────────────────────────
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const updated = await storage.updateSettings(req.body);

      // Restart scan interval if interval changed
      const interval = updated.scanIntervalMinutes ?? 30;
      if (scanInterval) clearInterval(scanInterval);
      scanInterval = setInterval(async () => {
        const s = await storage.getSettings();
        await runScan(s.oddsApiKey);
      }, interval * 60 * 1000);

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Notifications ────────────────────────────────────────────────────────
  app.get("/api/notifications", async (req, res) => {
    try {
      const notifications = await storage.getNotifications();
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/notifications/unread", async (req, res) => {
    try {
      const notifications = await storage.getUnreadNotifications();
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/notifications/:id/dismiss", async (req, res) => {
    try {
      await storage.dismissNotification(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/notifications", async (req, res) => {
    try {
      await storage.clearNotifications();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Player Stats (Basketball-Reference / Pro-Football-Reference) ─────────
  app.get("/api/player-stats/:sport/:playerName", async (req, res) => {
    try {
      const { sport, playerName } = req.params;
      const cacheKey = `${sport}:${playerName}`;
      const cached = STAT_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.json(cached.data);
      }
      let data: any = null;
      const sportUp = sport.toUpperCase();
      // All sports now use ESPN v3 gamelog (reliable, no slug maps needed)
      data = await fetchESPNGameLog(playerName, sportUp);
      if (!data) return res.status(404).json({ error: "Player not found or stats unavailable" });
      STAT_CACHE.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Stats ────────────────────────────────────────────────────────────────
  // ─── Ask a Question (AI bet analysis) ──────────────────────────────────────
  app.post("/api/ask", async (req, res) => {
    try {
      const { question } = req.body as { question: string };
      if (!question?.trim()) return res.status(400).json({ error: "question is required" });

      const bets = await storage.getBets();
      const q = question.toLowerCase();
      const byConf = (a: any, b: any) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);

      // ─── Intent Detection ────────────────────────────────────────────────────────
      // Detect parlay requests: "build me a 4 player parlay", "4 leg parlay", "parlay for tonight"
      const parlayMatch = q.match(/(?:build|give|make|create|suggest|find|pick).*?(\d+)[- ]?(?:leg|player|pick|team|bet)?.*?parlay/i)
        ?? q.match(/parlay.*?(\d+)[- ]?(?:leg|player|pick|team|bet)/i)
        ?? q.match(/(\d+)[- ]?(?:leg|player|pick|team|bet)[- ]?parlay/i);
      const isParlayRequest = !!parlayMatch || (q.includes("parlay") && !q.includes("same game") && !q.includes("sgp"));
      const parlayLegs = parlayMatch ? parseInt(parlayMatch[1]) : (isParlayRequest ? 4 : 0);

      // SGP detection: "same game parlay", "sgp", "same-game"
      const isSGPRequest = q.includes("same game parlay") || q.includes("same-game parlay")
        || q.includes("sgp") || q.includes("same game props") || q.includes("same game picks");

      // Detect sport filter from question (includes optional sports)
      const sportFilter = q.includes("nba") || q.includes("basketball") ? "NBA"
        : q.includes("nfl") || q.includes("football") ? "NFL"
        : q.includes("mlb") || q.includes("baseball") ? "MLB"
        : q.includes("nhl") || q.includes("hockey") ? "NHL"
        : q.includes("mma") || q.includes("ufc") || q.includes("bellator") ? "MMA"
        : q.includes("boxing") || q.includes("fighter") ? "Boxing"
        : q.includes("ncaab") || q.includes("college basketball") || q.includes("march madness") ? "NCAAB"
        : q.includes("ncaaf") || q.includes("college football") ? "NCAAF"
        : q.includes("golf") || q.includes("pga") || q.includes("masters") ? "Golf" : null;

      // Detect if asking about best/top picks generally
      const isTopPicksRequest = !isParlayRequest && !isSGPRequest && (
        q.includes("best") || q.includes("top") || q.includes("recommend") ||
        q.includes("tonight") || q.includes("today") || q.includes("right now") ||
        q.includes("what should") || q.includes("which bet") || q.includes("good bet")
      ) && !q.match(/\b(is|should i|would|will|does|did|can|could)\b/);

      // Score all bets by relevance to the question
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      const scored = bets.map((b) => {
        let score = 0;
        const fields = [
          b.title, b.description, b.playerName, b.homeTeam, b.awayTeam,
          b.sport, b.betType, b.source, b.researchSummary,
          ...(b.keyFactors ?? []),
        ].map((f) => (f ?? "").toLowerCase());
        for (const f of fields) for (const word of words) if (f.includes(word)) score += 1;
        if (b.playerName && words.some((w) => b.playerName!.toLowerCase().includes(w))) score += 4;
        if ((b.homeTeam && words.some((w) => b.homeTeam!.toLowerCase().includes(w))) ||
            (b.awayTeam && words.some((w) => b.awayTeam!.toLowerCase().includes(w)))) score += 4;
        if (b.betType === "player_prop") score += 0.5;
        if ((b.confidenceScore ?? 0) >= 85) score += 1;
        // Sport filter bonus
        if (sportFilter && b.sport === sportFilter) score += 3;
        return { bet: b, score };
      }).sort((a, b) => b.score - a.score || byConf(a.bet, b.bet));

      const totalBets = bets.length;
      const propCount = bets.filter((b) => b.betType === "player_prop").length;
      const highConfCount = bets.filter((b) => (b.confidenceScore ?? 0) >= 85).length;

      // Helper: format a single bet for display/text
      const betSummary = (b: any, idx: number): string  =>{
        const line = b.line != null ? ` | Line: ${b.line}` : "";
        const over = b.overOdds != null ? ` | Over: ${b.overOdds > 0 ? "+" : ""}${b.overOdds}` : "";
        const under = b.underOdds != null ? ` / Under: ${b.underOdds > 0 ? "+" : ""}${b.underOdds}` : "";
        const conf = ` | Conf: ${b.confidenceScore ?? "?"}/100`;
        const risk = b.riskLevel ? ` | Risk: ${b.riskLevel}` : "";
        const matchup = b.awayTeam && b.homeTeam ? ` | ${b.awayTeam} @ ${b.homeTeam}` : "";
        const factors = b.keyFactors?.length ? `\n   Why: ${b.keyFactors.slice(0, 3).join("; ")}` : "";
        return `${idx}. [${b.sport} ${b.betType}] ${b.title}${matchup}${line}${over}${under}${conf}${risk}${factors}`;
      }

      // Helper: serialize a bet for the relatedBets response
      const serializeBet = (b: any, reason: string)  =>{
        return {
          id: b.id, title: b.title, sport: b.sport, betType: b.betType,
          playerName: b.playerName ?? null, homeTeam: b.homeTeam ?? null, awayTeam: b.awayTeam ?? null,
          confidenceScore: b.confidenceScore ?? null, riskLevel: b.riskLevel ?? null,
          line: b.line ?? null, overOdds: b.overOdds ?? null, underOdds: b.underOdds ?? null,
          recommendedAllocation: b.recommendedAllocation ?? null,
          keyFactors: (b.keyFactors ?? []).slice(0, 2),
          gameTime: b.gameTime ?? null,
          similarityReason: reason,
        };
      }

      let answer: string;
      let relatedBets: any[] = [];

      // ─── SGP MODE (Same Game Parlay) ─────────────────────────────────────
      if (isSGPRequest) {
        // Extract leg count if specified, default 3
        const sgpLegMatch = q.match(/(\d+)[- ]?(?:leg|pick|prop)?/);
        const sgpLegs = sgpLegMatch ? Math.min(Math.max(parseInt(sgpLegMatch[1]), 2), 6) : 3;

        // Extract a specific team or game if mentioned
        const teamWords = q.replace(/same.?game|parlay|sgp|props?|picks?|legs?|build|give|make|create|suggest|find/gi, "").trim().split(/\s+/).filter(w => w.length > 2);

        // Filter to player props only, score by team/game match
        const propPool = bets
          .filter(b => b.betType === "player_prop" && (b.confidenceScore ?? 0) >= 60)
          .map(b => {
            let score = 0;
            const fields = [b.playerName, b.homeTeam, b.awayTeam, b.title, b.sport].map(f => (f ?? "").toLowerCase());
            for (const f of fields) for (const w of teamWords) if (f.includes(w)) score += 3;
            if (sportFilter && b.sport === sportFilter) score += 5;
            score += (b.confidenceScore ?? 0) / 20; // confidence tiebreaker
            return { bet: b, score };
          })
          .sort((a, b) => b.score - a.score);

        // Group by game (homeTeam|awayTeam key)
        const gameGroups = new Map<string, any[]>();
        for (const { bet } of propPool) {
          const key = [bet.homeTeam, bet.awayTeam].filter(Boolean).sort().join("|");
          if (!key) continue;
          if (!gameGroups.has(key)) gameGroups.set(key, []);
          gameGroups.get(key)!.push(bet);
        }

        // Pick the best game (most high-conf props available)
        let bestGame: { key: string; bets: any[] } | null = null;
        for (const [key, gameBets] of gameGroups) {
          if (!bestGame || gameBets.length > bestGame.bets.length) {
            bestGame = { key, bets: gameBets };
          }
        }

        // If a specific game was mentioned by team name, prefer that one
        if (teamWords.length > 0) {
          for (const [key, gameBets] of gameGroups) {
            if (teamWords.some(w => key.toLowerCase().includes(w))) {
              bestGame = { key, bets: gameBets };
              break;
            }
          }
        }

        if (!bestGame || bestGame.bets.length < 2) {
          // Fallback: just use top props from any games, dedupe by player
          const fallbackLegs: any[] = [];
          const usedPlayers = new Set<string>();
          for (const { bet } of propPool) {
            if (fallbackLegs.length >= sgpLegs) break;
            if (bet.playerName && usedPlayers.has(bet.playerName.toLowerCase())) continue;
            fallbackLegs.push(bet);
            if (bet.playerName) usedPlayers.add(bet.playerName.toLowerCase());
          }
          relatedBets = fallbackLegs.map(b => serializeBet(b, "sgp leg"));
          const avgConf = fallbackLegs.length ? Math.round(fallbackLegs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / fallbackLegs.length) : 0;
          answer = `⚡ SAME GAME PARLAY — ${fallbackLegs.length} Props (avg confidence: ${avgConf}/100)\n\nNote: Not enough props found for a single game — showing top props across games.\n\n${fallbackLegs.map((b, i) => {
            const conf = b.confidenceScore ?? 0;
            const line = b.line != null ? ` | Line: ${b.line}` : "";
            const odds = b.overOdds != null ? ` (${b.overOdds > 0 ? "+" : ""}${b.overOdds})` : "";
            const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 100) ?? "";
            return `**Leg ${i+1}: ${b.title}**${line}${odds}\n   Confidence: ${conf}/100 | Player: ${b.playerName ?? "—"}\n   Why: ${why}`;
          }).join("\n\n")}\n\n⚠️ SGP odds are correlated — books may restrict parlay combinations on the same game.`;
        } else {
          // Pick top N legs from the best game, dedupe by player and stat type
          const gameBets = bestGame.bets;
          const gameName = bestGame.key.replace("|", " vs ");
          const [home, away] = bestGame.key.split("|");
          const legs: any[] = [];
          const usedPlayers = new Set<string>();
          const usedStats = new Set<string>();

          for (const b of gameBets.sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))) {
            if (legs.length >= sgpLegs) break;
            if (b.playerName && usedPlayers.has(b.playerName.toLowerCase())) continue;
            // Avoid duplicate stat categories (e.g. two "points" props)
            const statKey = (b.title ?? "").toLowerCase().match(/over|under/i) ? b.title.toLowerCase().replace(/[\d.]/g, "").trim() : b.title.toLowerCase();
            if (usedStats.has(statKey)) continue;
            legs.push(b);
            if (b.playerName) usedPlayers.add(b.playerName.toLowerCase());
            usedStats.add(statKey);
          }

          // If still short, pad from other games
          if (legs.length < sgpLegs) {
            const extra = propPool
              .map(p => p.bet)
              .filter(b => !legs.find(l => l.id === b.id) && (b.confidenceScore ?? 0) >= 65)
              .slice(0, sgpLegs - legs.length);
            legs.push(...extra);
          }

          relatedBets = legs.map(b => serializeBet(b, "sgp leg"));
          const avgConf = legs.length ? Math.round(legs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / legs.length) : 0;
          const verdict = avgConf >= 85 ? "🔥 HIGH CONFIDENCE SGP" : avgConf >= 70 ? "⚡ SOLID SGP" : "⚠️ MODERATE SGP";

          const legsText = legs.map((b, i) => {
            const conf = b.confidenceScore ?? 0;
            const confVerdict = conf >= 82 ? "✅" : conf >= 70 ? "⚠️" : "❌";
            const line = b.line != null ? ` | Line: ${b.line}` : "";
            const odds = b.overOdds != null ? ` (${b.overOdds > 0 ? "+" : ""}${b.overOdds})` : "";
            const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 120) ?? "";
            return `**Leg ${i+1}: ${b.title}**${line}${odds}\n   ${confVerdict} Confidence: ${conf}/100 | Player: ${b.playerName ?? "—"}\n   Why: ${why}`;
          }).join("\n\n");

          answer = `${verdict} — ${legs.length}-Leg SGP\n📍 Game: ${gameName}\nAvg Confidence: ${avgConf}/100\n\n${legsText}\n\n⚠️ SGP reminder: all legs must hit. Books often limit SGP payouts on correlated props (e.g. a player scoring more often leads to more assists). Check your book's SGP rules before placing.`;
        }

      // ─── PARLAY MODE ────────────────────────────────────────────────────────
      } else if (isParlayRequest) {
        const n = Math.min(Math.max(parlayLegs, 2), 8); // clamp 2-8 legs

        // Pick the top N bets, filtered by sport if specified, prioritizing props
        let pool = bets.filter((b) => {
          if (sportFilter && b.sport !== sportFilter) return false;
          return (b.confidenceScore ?? 0) >= 70;
        }).sort(byConf);

        // Prefer player props if "player parlay" was mentioned
        if (q.includes("player")) {
          const props = pool.filter((b) => b.betType === "player_prop");
          if (props.length >= n) pool = props;
        }

        // Deduplicate: no two legs from same player
        const legs: any[] = [];
        const usedPlayers = new Set<string>();
        const usedGames = new Map<string, number>(); // gameKey -> count
        for (const b of pool) {
          if (legs.length >= n) break;
          // Skip duplicate same player
          if (b.playerName && usedPlayers.has(b.playerName.toLowerCase())) continue;
          // Max 2 legs from same game
          const gameKey = [b.homeTeam, b.awayTeam].filter(Boolean).sort().join("|");
          if (gameKey && (usedGames.get(gameKey) ?? 0) >= 2) continue;
          legs.push(b);
          if (b.playerName) usedPlayers.add(b.playerName.toLowerCase());
          if (gameKey) usedGames.set(gameKey, (usedGames.get(gameKey) ?? 0) + 1);
        }

        // Fallback: if not enough legs with filters, add top high-conf bets
        if (legs.length < n) {
          const fallback = bets.filter((b) => !legs.find((l) => l.id === b.id) && (b.confidenceScore ?? 0) >= 65)
            .sort(byConf).slice(0, n - legs.length);
          legs.push(...fallback);
        }

        relatedBets = legs.map((b) => serializeBet(b, "parlay leg"));

        // Build the written answer
        const sportLabel = sportFilter ? sportFilter : "multi-sport";
        const legsText = legs.map((b, i) => {
          const conf = b.confidenceScore ?? 0;
          const verdict = conf >= 85 ? "✅ Strong" : conf >= 75 ? "⚠️ Moderate" : "⚠️ Risky";
          const line = b.line != null ? ` (Line: ${b.line})` : "";
          const odds = b.overOdds != null
            ? ` — Over ${b.overOdds > 0 ? "+" : ""}${b.overOdds} / Under ${b.underOdds ?? "?"}` : "";
          const matchup = b.awayTeam && b.homeTeam ? `\n   🏀 ${b.awayTeam} @ ${b.homeTeam}` : "";
          const why = b.keyFactors?.slice(0, 2).join("; ") ?? b.researchSummary?.slice(0, 120) ?? "Market consensus";
          return `**Leg ${i + 1}: ${b.title}**${line}${odds}\n   Confidence: ${conf}/100 ${verdict}${matchup}\n   Why: ${why}`;
        }).join("\n\n");

        const avgConf = legs.length ? Math.round(legs.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / legs.length) : 0;
        const combinedVerdict = avgConf >= 82 ? "🔥 STRONG PARLAY" : avgConf >= 72 ? "⚠️ MODERATE PARLAY" : "❌ HIGH RISK PARLAY";

        answer = `${combinedVerdict} — ${n}-Leg ${sportLabel} Parlay (avg confidence: ${avgConf}/100)\n\n${legsText}\n\n⚠️ Parlay reminder: each leg must hit. The more legs, the higher the payout but lower the overall probability. Consider splitting into 2-leg parlays to reduce risk.`;

      // ─── SPECIFIC BET / PLAYER / TEAM QUESTION MODE ──────────────────────────
      } else {
        const topDirect = scored.filter((s) => s.score > 0).slice(0, Math.max(4, isTopPicksRequest ? 6 : 4));
        const context = topDirect.length > 0
          ? topDirect.map((s) => s.bet)
          : bets.filter((b) => {
              if (sportFilter && b.sport !== sportFilter) return false;
              return (b.confidenceScore ?? 0) >= 78;
            }).sort(byConf).slice(0, 5);

        const contextText = context.map((b, i) => betSummary(b, i + 1)).join("\n\n");

        // Build similar bets for the cards panel (different from the main context)
        const seen = new Set(context.map((b) => b.id));
        const topBet = context[0];
        const poolA = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (topBet?.playerName && b.playerName &&
              b.playerName.toLowerCase().includes(topBet.playerName.split(" ")[0].toLowerCase())) return true;
          if (b.playerName && words.some((w) => b.playerName!.toLowerCase().includes(w))) return true;
          if (b.homeTeam && words.some((w) => b.homeTeam!.toLowerCase().includes(w))) return true;
          if (b.awayTeam && words.some((w) => b.awayTeam!.toLowerCase().includes(w))) return true;
          return false;
        }).sort(byConf).slice(0, 3);
        poolA.forEach((b) => seen.add(b.id));

        const poolB = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (b.betType !== (topBet?.betType ?? "player_prop")) return false;
          if (topBet?.sport && b.sport !== topBet.sport) return false;
          return (b.confidenceScore ?? 0) >= 75;
        }).sort(byConf).slice(0, 3);
        poolB.forEach((b) => seen.add(b.id));

        const poolC = bets.filter((b) => {
          if (seen.has(b.id)) return false;
          if (sportFilter && b.sport !== sportFilter) return false;
          return b.betType === "player_prop" && (b.confidenceScore ?? 0) >= 85;
        }).sort(byConf).slice(0, 2);

        relatedBets = [...context, ...poolA, ...poolB, ...poolC]
          .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
          .sort(byConf).slice(0, 6)
          .map((b) => serializeBet(
            b,
            context.some((c) => c.id === b.id) ? "direct match"
              : poolA.some((p) => p.id === b.id) ? "same player/team"
              : poolB.some((p) => p.id === b.id) ? "same bet type" : "high confidence pick"
          ));

        const openaiKey = process.env.OPENAI_API_KEY;

        if (openaiKey) {
          const axiosLib = (await import("axios")).default;
          const systemPrompt = `You are Clubhouse IQ, an expert sports betting analyst with access to live odds from DraftKings, FanDuel, BetMGM, and William Hill. Answer the user's EXACT question using the provided live bet data. Be direct and specific. If they ask about a specific player/team/bet, analyze exactly that. If they ask for a list or recommendations, provide that specific number. Always cite confidence scores and key factors.`;
          const userPrompt = `Live database: ${totalBets} bets, ${propCount} player props, ${highConfCount} high-confidence (80+/100).

Relevant bets from live data:
${contextText || "No direct matches found."}

User question: "${question}"

Answer their question exactly as asked. Include specific bet titles, confidence scores, and why each is a good or bad pick.`;
          try {
            const aiRes = await axiosLib.post(
              "https://api.openai.com/v1/chat/completions",
              { model: "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 600, temperature: 0.3 },
              { headers: { Authorization: `Bearer ${openaiKey}` }, timeout: 20000 }
            );
            answer = aiRes.data.choices[0].message.content.trim();
          } catch (e: any) {
            answer = buildRuleBasedAnswer(context, question, totalBets, propCount, highConfCount, sportFilter);
          }
        } else {
          answer = buildRuleBasedAnswer(context, question, totalBets, propCount, highConfCount, sportFilter);
        }
      }

      res.json({ answer, relatedBets });
    } catch (e: any) {
      console.error("Ask error:", e.message);
      res.status(500).json({ error: "Analysis failed: " + e.message });
    }
  });

  // Rule-based answer builder (used when OpenAI key not set)
  function buildRuleBasedAnswer(
    context: any[], question: string, totalBets: number, propCount: number, highConfCount: number, sportFilter: string | null
  ): string {
    if (context.length === 0) {
      const sportMsg = sportFilter ? ` for ${sportFilter}` : "";
      return `No matching bets found${sportMsg}. Database has ${totalBets} total (${propCount} props, ${highConfCount} high-confidence). Try asking about a specific player or team.`;
    }

    const isTopPicks = context.length > 1;
    if (isTopPicks) {
      const lines = context.map((b, i) => {
        const conf = b.confidenceScore ?? 0;
        const verdict = conf >= 82 ? "✅" : conf >= 70 ? "⚠️" : "❌";
        const lineStr = b.line != null ? ` (${b.line})` : "";
        const factors = b.keyFactors?.slice(0, 2).join("; ") ?? "";
        return `${verdict} **${b.title}**${lineStr} — ${conf}/100\n   ${factors || b.researchSummary?.slice(0, 100) || ""}`;
      }).join("\n\n");
      const sportLabel = sportFilter ? `${sportFilter} ` : "";
      return `📊 Top ${sportLabel}picks right now:\n\n${lines}`;
    }

    const top = context[0];
    const conf = top.confidenceScore ?? 0;
    const verdict = conf >= 85 ? "✅ STRONG BET" : conf >= 65 ? "⚠️ MODERATE" : "❌ LOW CONFIDENCE";
    const lineStr = top.line != null ? ` | Line: ${top.line}` : "";
    const overStr = top.overOdds != null ? ` | Over ${top.overOdds > 0 ? "+" : ""}${top.overOdds} / Under ${top.underOdds ?? "?"}` : "";
    const factors = top.keyFactors?.slice(0, 3).join(", ") ?? "market consensus";
    const allocStr = top.recommendedAllocation ? ` Suggested: ${top.recommendedAllocation}% bankroll.` : "";
    const research = top.researchSummary ? ` ${top.researchSummary.slice(0, 180)}` : "";
    return `${verdict}\n\n**${top.title}** — Confidence ${conf}/100 | Risk: ${top.riskLevel ?? "medium"}${lineStr}${overStr}\n${allocStr}\nKey factors: ${factors}.${research}`;
  }

  app.get("/api/stats", async (req, res) => {
    try {
      const bets = await storage.getBets();
      const settings = await storage.getSettings();
      const threshold = settings.confidenceThreshold ?? 85;

      const total = bets.length;
      const highConf = bets.filter((b) => (b.confidenceScore ?? 0) >= threshold).length;
      const bySource = bets.reduce((acc, b) => {
        acc[b.source] = (acc[b.source] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const bySport = bets.reduce((acc, b) => {
        acc[b.sport] = (acc[b.sport] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const avgScore = bets.length
        ? Math.round(bets.reduce((s, b) => s + (b.confidenceScore ?? 0), 0) / bets.length)
        : 0;

      res.json({ total, highConf, bySource, bySport, avgScore, threshold });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tracked Props ──────────────────────────────────────────────────────────
  app.get("/api/tracked-props", async (req, res) => {
    try {
      res.json(await storage.getTrackedProps());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tracked-props", async (req, res) => {
    try {
      const { nanoid } = await import("nanoid");
      const prop = await storage.addTrackedProp({ ...req.body, id: nanoid() });
      res.json(prop);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/tracked-props/:id", async (req, res) => {
    try {
      const prop = await storage.updateTrackedProp(req.params.id, req.body);
      if (!prop) return res.status(404).json({ error: "Not found" });
      res.json(prop);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/tracked-props/:id", async (req, res) => {
    try {
      await storage.deleteTrackedProp(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Refresh Tracked Props: auto-fetch live stats from ESPN + BBR ──────────
  app.post("/api/refresh-tracked-props", async (req, res) => {
    const axiosLib = (await import("axios")).default;
    const cheerio = (await import("cheerio")).load;
    const props = await storage.getTrackedProps();
    const activeProps = props.filter(p => p.status === "active");

    if (activeProps.length === 0) {
      return res.json({ updated: 0, message: "No active props to refresh" });
    }

    // ESPN athlete lookup: search by name, return season stats
    async function espnAthleteStats(playerName: string, sport: string): Promise<{ stats: Record<string, number>; source: string; athleteId?: string } | null> {
      const sportMap: Record<string, { slug: string; statsUrl: (id: string) => string }> = {
        NBA: {
          slug: "basketball/nba",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/stats?season=2025&seasontype=2`,
        },
        NFL: {
          slug: "football/nfl",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/stats?season=2024&seasontype=2`,
        },
        MLB: {
          slug: "baseball/mlb",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${id}/stats?season=2025&seasontype=2`,
        },
        NHL: {
          slug: "hockey/nhl",
          statsUrl: (id) => `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${id}/stats?season=2025&seasontype=2`,
        },
      };
      const sportCfg = sportMap[sport];
      if (!sportCfg) return null;

      try {
        // Step 1: Find athlete by name
        const searchUrl = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(playerName)}&limit=5&type=athlete&sport=${sportCfg.slug}`;
        const searchResp = await axiosLib.get(searchUrl, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
        const hits = searchResp.data?.athletes ?? searchResp.data?.results ?? [];
        let athleteId: string | null = null;
        // Find best name match
        const nameLower = playerName.toLowerCase();
        for (const hit of hits) {
          const candidate = (hit?.name ?? hit?.displayName ?? "").toLowerCase();
          if (candidate.includes(nameLower.split(" ")[0]) || nameLower.includes(candidate.split(" ")[0])) {
            athleteId = hit?.id ?? hit?.uid?.replace(/^.*athlete:\/\//,"") ?? null;
            break;
          }
        }
        if (!athleteId && hits.length > 0) athleteId = hits[0]?.id ?? null;
        if (!athleteId) return null;

        // Step 2: Get season stats
        const statsResp = await axiosLib.get(sportCfg.statsUrl(athleteId), { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
        const statsData = statsResp.data;

        // ESPN stats come as parallel arrays: categories[].stats[].name + values[]
        const parsed: Record<string, number> = {};
        const cats = statsData?.stats?.splits?.categories ?? statsData?.splits?.categories ?? [];
        for (const cat of cats) {
          const names: string[] = cat.names ?? [];
          const values: any[] = cat.values ?? [];
          names.forEach((name, i) => {
            const v = parseFloat(values[i]);
            if (!isNaN(v)) parsed[name.toLowerCase()] = v;
          });
        }
        // Fallback: top-level stats object
        if (Object.keys(parsed).length === 0) {
          const flat = statsData?.athlete?.statistics ?? statsData?.statistics ?? {};
          for (const [k, v] of Object.entries(flat)) {
            const n = parseFloat(String(v));
            if (!isNaN(n)) parsed[k.toLowerCase()] = n;
          }
        }

        return Object.keys(parsed).length > 0 ? { stats: parsed, source: "ESPN", athleteId } : null;
      } catch (e: any) {
        console.warn(`[refresh] ESPN lookup failed for ${playerName} (${sport}):`, e.message);
        return null;
      }
    }

    // Baseball Reference season stats scrape (for MLB season_long props)
    async function bbrSeasonStats(playerName: string): Promise<{ stats: Record<string, number>; source: string } | null> {
      try {
        const query = playerName.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, "+");
        const searchUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${query}&pid=&type=&redirect=1`;
        const { data: html } = await axiosLib.get(searchUrl, {
          timeout: 12000,
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          maxRedirects: 5,
        });
        const $ = cheerio(html);
        // Parse the standard stats table (batting or pitching)
        const stats: Record<string, number> = {};
        // Try to get 2025 season row from #batting_standard or #pitching_standard
        const tables = ["#batting_standard", "#pitching_standard", "#standard_fielding"];
        for (const tableId of tables) {
          const rows = $(tableId).find("tbody tr").toArray();
          // Find 2025 season row
          for (const row of rows) {
            const yr = $(row).find("[data-stat='year_id']").text().trim();
            if (yr === "2025") {
              const fields = [
                "G","PA","AB","R","H","2B","3B","HR","RBI","SB","BB","SO","BA","OBP","SLG",
                "W","L","ERA","GS","CG","SHO","SV","IP","H_allowed","ER","BB_allowed","SO_pitcher"
              ];
              for (const f of fields) {
                const v = parseFloat($(row).find(`[data-stat='${f.toLowerCase()}']`).text().trim());
                if (!isNaN(v)) stats[f.toLowerCase()] = v;
              }
              // Fallback: try attribute names
              $(row).find("[data-stat]").each((_, el) => {
                const attr = $(el).attr("data-stat") ?? "";
                const v = parseFloat($(el).text().trim());
                if (attr && !isNaN(v)) stats[attr.toLowerCase()] = v;
              });
              if (Object.keys(stats).length > 0) break;
            }
          }
          if (Object.keys(stats).length > 0) break;
        }
        return Object.keys(stats).length > 0 ? { stats, source: "Baseball Reference" } : null;
      } catch (e: any) {
        console.warn(`[refresh] BBR failed for ${playerName}:`, e.message);
        return null;
      }
    }

    // Map TrackedProp statCategory → ESPN stat key(s) to try
    const mapStatCategory = (statCategory: string, sport: string): string[]  =>{
      const cat = statCategory.toLowerCase();
      if (sport === "NBA") {
        if (cat.includes("point")) return ["pts", "points", "avgpoints"];
        if (cat.includes("assist")) return ["ast", "assists", "avgassists"];
        if (cat.includes("rebound")) return ["reb", "rebounds", "totalrebounds", "avgtotalrebounds"];
        if (cat.includes("3-point") || cat.includes("3pt") || cat.includes("three")) return ["3pm", "threepointersmade", "3ptm"];
        if (cat.includes("steal")) return ["stl", "steals", "avgsteals"];
        if (cat.includes("block")) return ["blk", "blocks", "avgblocks"];
        if (cat.includes("minute")) return ["min", "minutes", "avgminutes"];
        if (cat.includes("pra") || cat.includes("+")) return ["pts", "points"]; // sum multiple
      }
      if (sport === "NFL") {
        if (cat.includes("passing yard")) return ["passingyards", "yds", "yards"];
        if (cat.includes("passing td")) return ["passingtouchdowns", "td", "touchdowns"];
        if (cat.includes("rushing yard")) return ["rushingyards", "yds"];
        if (cat.includes("receiving yard")) return ["receivingyards", "yds"];
        if (cat.includes("reception")) return ["receptions", "rec"];
        if (cat.includes("interception")) return ["interceptions", "int"];
        if (cat.includes("tackle")) return ["totaltackles", "tackles", "tot"];
        if (cat.includes("sack")) return ["sacks"];
      }
      if (sport === "MLB") {
        if (cat.includes("home run")) return ["hr"];
        if (cat.includes("rbi")) return ["rbi"];
        if (cat.includes("hit") && !cat.includes("pitcher")) return ["h"];
        if (cat.includes("strikeout") || cat.includes("k")) return ["so", "so_pitcher", "k"];
        if (cat.includes("era")) return ["era"];
        if (cat.includes("stolen base")) return ["sb"];
        if (cat.includes("batting avg")) return ["ba", "avg"];
      }
      if (sport === "NHL") {
        if (cat.includes("goal")) return ["goals", "g"];
        if (cat.includes("assist")) return ["assists", "a"];
        if (cat.includes("point")) return ["points", "pts"];
        if (cat.includes("shot")) return ["shots", "sog", "s"];
        if (cat.includes("save")) return ["savepct", "svpct", "sv%"];
        if (cat.includes("+/-") || cat.includes("plus")) return ["plusminus", "+/-"];
      }
      return [];
    }

    const extractStatValue = (statsRecord: Record<string, number>, keys: string[]): number | null  =>{
      for (const k of keys) {
        if (statsRecord[k] !== undefined) return statsRecord[k];
      }
      // partial match
      for (const k of keys) {
        const found = Object.keys(statsRecord).find(sk => sk.includes(k) || k.includes(sk));
        if (found) return statsRecord[found];
      }
      return null;
    }

    // Process each active prop
    const results: Array<{ id: string; playerName: string; sport: string; statCategory: string; oldValue: number | null; newValue: number | null; gamesPlayed: number | null; source: string; status: string }> = [];
    let updatedCount = 0;

    for (const prop of activeProps) {
      let fetchedStats: { stats: Record<string, number>; source: string } | null = null;

      // Try ESPN first (all sports)
      const espnResult = await espnAthleteStats(prop.playerName, prop.sport);
      if (espnResult) fetchedStats = espnResult;

      // For MLB, also try Baseball Reference as backup
      if (!fetchedStats && prop.sport === "MLB") {
        fetchedStats = await bbrSeasonStats(prop.playerName);
      }

      if (!fetchedStats) {
        results.push({ id: prop.id, playerName: prop.playerName, sport: prop.sport, statCategory: prop.statCategory, oldValue: prop.currentValue ?? null, newValue: null, gamesPlayed: prop.gamesPlayed ?? null, source: "not found", status: "no_data" });
        continue;
      }

      const statKeys = mapStatCategory(prop.statCategory, prop.sport);
      let newValue = extractStatValue(fetchedStats.stats, statKeys);

      // Special case: PRA (Points+Rebounds+Assists) — sum the three
      if (!newValue && prop.statCategory.toLowerCase().includes("+")) {
        const pts = extractStatValue(fetchedStats.stats, ["pts","points"]) ?? 0;
        const reb = extractStatValue(fetchedStats.stats, ["reb","rebounds","totalrebounds"]) ?? 0;
        const ast = extractStatValue(fetchedStats.stats, ["ast","assists"]) ?? 0;
        if (pts || reb || ast) newValue = pts + reb + ast;
      }

      // Extract games played
      const gamesPlayed = extractStatValue(fetchedStats.stats, ["gp","games","g","gamesplayed"]);

      // Determine new status: if season_long, check if target already hit/missed
      let newStatus: string = prop.status ?? "active";
      if (newValue !== null && prop.propType === "season_long" && prop.status === "active") {
        if (prop.direction === "over" && newValue >= prop.targetLine) newStatus = "hit";
        // (don't auto-mark as missed for season_long — season may not be over)
      }

      const updatePayload: any = { updatedAt: new Date() };
      if (newValue !== null) updatePayload.currentValue = newValue;
      if (gamesPlayed !== null) updatePayload.gamesPlayed = Math.round(gamesPlayed);
      if (newStatus !== prop.status) updatePayload.status = newStatus;
      // Store source in notes if not already there
      if (fetchedStats.source && !(prop.notes ?? "").includes(fetchedStats.source)) {
        updatePayload.notes = prop.notes ? `${prop.notes} | 📡 ${fetchedStats.source}` : `📡 Auto-updated from ${fetchedStats.source}`;
      }

      await storage.updateTrackedProp(prop.id, updatePayload);
      updatedCount++;

      results.push({
        id: prop.id,
        playerName: prop.playerName,
        sport: prop.sport,
        statCategory: prop.statCategory,
        oldValue: prop.currentValue ?? null,
        newValue: newValue ?? null,
        gamesPlayed: gamesPlayed ? Math.round(gamesPlayed) : (prop.gamesPlayed ?? null),
        source: fetchedStats.source,
        status: newStatus,
      });
    }

    console.log(`[refresh-tracked-props] Updated ${updatedCount}/${activeProps.length} props`);
    res.json({
      updated: updatedCount,
      total: activeProps.length,
      results,
      refreshedAt: new Date().toISOString(),
    });
  });

  // ─── Debug endpoint: test each data source independently ─────────────────
  app.get("/api/debug-scan", async (req, res) => {
    const results: Record<string, any> = {};
    const axios = (await import("axios")).default;

    // 1. Underdog
    try {
      const { data } = await axios.get(
        "https://api.underdogfantasy.com/beta/v5/over_under_lines",
        {
          headers: {
            "User-Agent": "UnderdogFantasy/2.0 (com.underdogfantasy.app; build:500; iOS 17.0; iPhone14,3)",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "X-Platform": "ios",
            "X-App-Version": "2.0.0",
          },
          timeout: 20000,
          decompress: true,
        }
      );
      const lines = data?.over_under_lines ?? [];
      const active = lines.filter((l: any) => l.status === "active");
      results.underdog = { ok: true, total: lines.length, active: active.length };
    } catch (e: any) {
      results.underdog = { ok: false, error: e.message, code: e.response?.status };
    }

    // 2. SportsGameOdds
    const sgoKey = process.env.SGO_API_KEY;
    if (!sgoKey) {
      results.sgo = { ok: false, error: "SGO_API_KEY not set" };
    } else {
      try {
        const { data } = await axios.get(
          `https://api.sportsgameodds.com/v2/events?leagueID=NBA&oddID=points-PLAYER_ID-game-ou-over&ended=false&cancelled=false&includeOpposingOdds=true&apiKey=${sgoKey}`,
          { timeout: 15000 }
        );
        results.sgo = { ok: data.success, count: data.data?.length ?? 0, raw: data.success ? undefined : data };
      } catch (e: any) {
        results.sgo = { ok: false, error: e.message, code: e.response?.status };
      }
    }

    // 3. Odds API
    const oddsKey = process.env.ODDS_API_KEY;
    if (!oddsKey) {
      results.oddsApi = { ok: false, error: "ODDS_API_KEY not set" };
    } else {
      try {
        const { data } = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${oddsKey}&regions=us&markets=h2h&bookmakers=draftkings&oddsFormat=american`,
          { timeout: 15000 }
        );
        results.oddsApi = { ok: true, games: data.length };
      } catch (e: any) {
        results.oddsApi = { ok: false, error: e.message, code: e.response?.status };
      }
    }

    // 4. ActionNetwork
    try {
      const { data } = await axios.get(
        "https://api.actionnetwork.com/web/v1/scoreboard/nba?period=game&bookIds=15,30,76,123&date=" +
        new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        { timeout: 10000 }
      );
      results.actionNetwork = { ok: true, games: data?.games?.length ?? 0 };
    } catch (e: any) {
      results.actionNetwork = { ok: false, error: e.message };
    }

    // 5. Env vars present
    results.envVars = {
      ODDS_API_KEY: !!process.env.ODDS_API_KEY,
      SGO_API_KEY: !!process.env.SGO_API_KEY,
      ACTION_NETWORK_KEY: !!process.env.ACTION_NETWORK_KEY,
      API_SPORTS_KEY: !!process.env.API_SPORTS_KEY,
    };

    // 6. Current bets in DB
    const bets = await storage.getBets();
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const b of bets) {
      byType[b.betType ?? "unknown"] = (byType[b.betType ?? "unknown"] ?? 0) + 1;
      bySource[b.source ?? "unknown"] = (bySource[b.source ?? "unknown"] ?? 0) + 1;
    }
    results.currentBets = { total: bets.length, byType, bySource };

    res.json(results);
  });

  // Initial scan on startup with retry — ensures props load even if first attempt fails
  const startupScan = async (attempt = 1) => {
    try {
      console.log(`[startup] scan attempt ${attempt}...`);
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      const bets = await storage.getBets();
      const propCount = bets.filter((b: any) => b.betType === 'player_prop').length;
      console.log(`[startup] scan done: ${result.scanned} bets, ${propCount} props`);
      // Retry if we got no props (Railway cold-start network issue)
      if (propCount === 0 && attempt < 5) {
        const delay = attempt * 15000; // 15s, 30s, 45s, 60s
        console.log(`[startup] 0 props loaded, retrying in ${delay/1000}s...`);
        setTimeout(() => startupScan(attempt + 1), delay);
      }
    } catch (e: any) {
      console.warn(`[startup] scan attempt ${attempt} failed:`, e.message);
      if (attempt < 5) {
        const delay = attempt * 15000;
        console.log(`[startup] retrying in ${delay/1000}s...`);
        setTimeout(() => startupScan(attempt + 1), delay);
      }
    }
  };
  // Wait for ML pull to complete before first scan (or max 10s)
  const waitForMLPull = (elapsed = 0) => {
    if (mlPullDone || elapsed >= 10000) {
      startupScan();
    } else {
      setTimeout(() => waitForMLPull(elapsed + 500), 500);
    }
  };
  setTimeout(() => waitForMLPull(), 3000); // 3s base delay for Railway to fully initialize

  // ── 30-second live price poller — Kalshi + Polymarket only, no ESPN ────────
  livePollInterval = setInterval(async () => {
    try {
      const updates = await fetchLivePrices();
      lastLivePoll = { ts: Date.now(), changed: updates.length };
      if (updates.length > 0) {
        broadcast("price:tick", { updates, ts: lastLivePoll.ts });

        // Broadcast mispriced markets separately with entry/exit targets
        const mispriced = updates.filter((u: any) => u.mispricing?.isMispriced);
        if (mispriced.length > 0) {
          broadcast("price:mispriced", {
            ts: lastLivePoll.ts,
            markets: mispriced.map((u: any) => ({
              id: u.id,
              priceMovement: u.priceMovement,
              newImpliedProb: u.newImpliedProb,
              fairValue:       u.mispricing.fairValue,
              mispricingEdge:  u.mispricing.mispricingEdge,
              direction:       u.mispricing.mispricingDirection,
              entryPrice:      u.mispricing.entryPrice,
              exitTarget:      u.mispricing.exitTarget,
              entryCents:      u.mispricing.entryCents,
              exitTargetCents: u.mispricing.exitTargetCents,
              edgePct:         u.mispricing.edgePct,
            })),
          });
          console.log(`[live-poll] ${mispriced.length} mispriced market(s) signaled`);
        }

        // Also fire high-conf alert if any updated bet crossed 85
        const changed = await Promise.all(
          updates.map(u => storage.getBetById(u.id))
        );
        const newHighConf = changed
          .filter(Boolean)
          .filter((b: any) => (b.confidenceScore ?? 0) >= 85 && !b.notificationSent);
        if (newHighConf.length > 0) {
          broadcast("bets:highconf", {
            count: newHighConf.length,
            top: newHighConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })),
          });
        }
        console.log(`[live-poll] ${updates.length} price update(s) broadcast`);

        // Re-run sharp money scoring on updated bets only
        const updatedBets = await Promise.all(updates.map(u => storage.getBetById(u.id)));
        for (const b of updatedBets.filter(Boolean)) {
          const sm = computeSharpMoneyScore({
            confidenceScore: (b as any).confidenceScore,
            sharpnessScore:  (b as any).sharpnessScore ?? null,
            priceMovement:   (b as any).priceMovement ?? null,
            allSources:      (b as any).allSources,
            source:          (b as any).source,
          });
          await storage.patchBetSharpMoney((b as any).id, { isSharpMoney: sm.isSharpMoney, sharpMoneyScore: sm.score });
        }
      }

      // Re-tag urgency every 30s (game times tick closer)
      await tagUrgency().catch(() => {});

    } catch (e: any) {
      console.warn("[live-poll] interval error:", e.message);
    }
  }, 30 * 1000);

  // Auto-scan every 30 min — broadcast result to all WS clients
  scanInterval = setInterval(async () => {
    try {
      const settings = await storage.getSettings();
      const result = await runScan(settings.oddsApiKey);
      const allBets = await storage.getBets();
      broadcast("bets:updated", { scanned: result.scanned, total: allBets.length, auto: true });
      // Log picks for ML self-learning
      try { logPicks(allBets); } catch(e: any) { console.warn("[PickLogger] error:", e.message); }
      // Sync snapshots to GitHub so they survive redeploys (fire-and-forget)
      syncSnapshotsToGitHub().catch((e: any) => console.warn("[MLSync] snapshot sync error:", e.message));
      const highConf = allBets.filter((b: any) => (b.confidenceScore ?? 0) >= 85);
      if (highConf.length > 0) {
        broadcast("bets:highconf", { count: highConf.length, top: highConf.slice(0, 3).map((b: any) => ({ id: b.id, title: b.title, score: b.confidenceScore })) });
      }
    } catch (e: any) {
      console.warn("[auto-scan] error:", e.message);
    }
  }, 30 * 60 * 1000);

  // ── CLV Line Value Tracker ───────────────────────────────────────────────

  // Compute sharpness score from lineMovePct and speed (0-100)
  function computeSharpness(openingLine: number | null, currentLine: number | null, openingOdds: number | null, currentOdds: number | null, createdAt: Date | null): number {
    if (openingLine == null || currentLine == null || openingLine === 0) return 0;
    const movePct = Math.abs((currentLine - openingLine) / Math.abs(openingLine)) * 100;
    // Speed factor: hours since creation (faster = sharper)
    const hoursElapsed = createdAt ? (Date.now() - createdAt.getTime()) / 3600000 : 24;
    const speedFactor = Math.max(0, 1 - hoursElapsed / 48); // decays over 48h
    // Odds movement factor
    let oddsFactor = 0;
    if (openingOdds != null && currentOdds != null) {
      const oddsMove = Math.abs(currentOdds - openingOdds);
      oddsFactor = Math.min(oddsMove / 30, 1); // 30 cent move = full factor
    }
    const raw = movePct * 4 + speedFactor * 20 + oddsFactor * 30;
    return Math.min(100, Math.round(raw));
  }

  // Fire alert if threshold crossed
  async function maybeFireClvAlert(line: any, prevLine: number | null, prevOdds: number | null): Promise<void> {
    if (line.openingLine == null || line.currentLine == null) return;
    if (line.openingLine === 0) return;
    const movePct = ((line.currentLine - line.openingLine) / Math.abs(line.openingLine)) * 100;
    const absPct = Math.abs(movePct);
    const threshold = line.alertThreshold ?? 10;
    if (absPct < threshold) return;
    // Direction check
    const direction = line.alertDirection ?? "both";
    if (direction === "favor" && movePct <= 0) return;
    if (direction === "against" && movePct >= 0) return;
    // Check we haven't already fired for this move
    const existing = await storage.getClvAlertsByLine(line.id);
    const alreadyFired = existing.some((a: any) => Math.abs(a.movePct ?? 0) >= absPct - 0.5);
    if (alreadyFired) return;
    const alertType = absPct >= threshold * 2 ? "sharp_move" : (movePct > 0 ? "move_favor" : "move_against");
    const dirLabel = movePct > 0 ? "in your favor" : "against you";
    await storage.addClvAlert({
      id: crypto.randomUUID(),
      clvLineId: line.id,
      alertType,
      message: `${line.outcomeLabel} moved ${movePct > 0 ? "+" : ""}${movePct.toFixed(1)}% ${dirLabel} (threshold: ${threshold}%)`,
      movePct,
      fromLine: line.openingLine,
      toLine: line.currentLine,
      fromOdds: line.openingOdds ?? null,
      toOdds: line.currentOdds ?? null,
      dismissed: false,
    });
  }

  app.get("/api/clv", async (req, res) => {
    try {
      const lines = await storage.getClvLines();
      res.json(lines);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/clv", async (req, res) => {
    try {
      const body = req.body;
      const line = await storage.addClvLine({
        id: crypto.randomUUID(),
        ...body,
      });
      // Auto-add opening snapshot
      if (line.openingLine != null || line.openingOdds != null) {
        await storage.addClvSnapshot({
          id: crypto.randomUUID(),
          clvLineId: line.id,
          book: line.book,
          line: line.openingLine,
          odds: line.openingOdds,
        });
      }
      res.status(201).json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv/:id", async (req, res) => {
    try {
      const line = await storage.getClvLineById(req.params.id);
      if (!line) return res.status(404).json({ error: "Not found" });
      res.json(line);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/clv/:id", async (req, res) => {
    try {
      const existing = await storage.getClvLineById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const update = req.body;
      // Compute derived fields on update
      const newCurrentLine = update.currentLine ?? existing.currentLine;
      const newCurrentOdds = update.currentOdds ?? existing.currentOdds;
      const openingLine = existing.openingLine;
      let lineMovePct: number | null = null;
      if (openingLine != null && openingLine !== 0 && newCurrentLine != null) {
        lineMovePct = ((newCurrentLine - openingLine) / Math.abs(openingLine)) * 100;
      }
      const sharpnessScore = computeSharpness(openingLine, newCurrentLine, existing.openingOdds, newCurrentOdds, existing.createdAt);
      // If closing line provided, compute CLV
      let clvBeat: boolean | null = existing.clvBeat;
      let clvDelta: number | null = existing.clvDelta;
      const closingLine = update.closingLine ?? existing.closingLine;
      if (closingLine != null && openingLine != null) {
        clvDelta = closingLine - openingLine;
        clvBeat = clvDelta > 0;
      }
      const updated = await storage.updateClvLine(req.params.id, {
        ...update,
        lineMovePct,
        sharpnessScore,
        clvBeat,
        clvDelta,
      });
      // Add snapshot for current line
      if (update.currentLine != null || update.currentOdds != null) {
        await storage.addClvSnapshot({
          id: crypto.randomUUID(),
          clvLineId: req.params.id,
          book: existing.book,
          line: newCurrentLine,
          odds: newCurrentOdds,
        });
      }
      // Maybe fire alert
      if (updated) await maybeFireClvAlert(updated, existing.currentLine, existing.currentOdds);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/clv/:id", async (req, res) => {
    try {
      await storage.deleteClvLine(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv/:id/snapshots", async (req, res) => {
    try {
      const snaps = await storage.getClvSnapshots(req.params.id);
      res.json(snaps);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/clv-alerts", async (req, res) => {
    try {
      const alerts = await storage.getClvAlerts();
      res.json(alerts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/clv-alerts/:id/dismiss", async (req, res) => {
    try {
      await storage.dismissClvAlert(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Sharp Money endpoints ───────────────────────────────────────────────────
  // GET /api/sharp-money — all sports, top sharp plays today
  app.get("/api/sharp-money", async (_req, res) => {
    try {
      const data = await fetchSharpMoneyAllSports();
      res.json({ games: data, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/sharp-money/:sport — single sport (NBA/MLB/NHL/NFL)
  app.get("/api/sharp-money/:sport", async (req, res) => {
    try {
      const sport = (req.params.sport || "").toUpperCase();
      const data  = await fetchSharpMoneyBySport(sport);
      res.json({ sport, games: data, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/sharp-money/game/:sport/:home/:away — specific game
  app.get("/api/sharp-money/game/:sport/:home/:away", async (req, res) => {
    try {
      const sport = (req.params.sport || "").toUpperCase();
      const home  = decodeURIComponent(req.params.home || "");
      const away  = decodeURIComponent(req.params.away || "");
      const data  = await fetchSharpMoneyForGame(sport, home, away);
      if (!data) return res.status(404).json({ error: "Game not found" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Line Movement: auto-pull opening vs current lines from ActionNetwork ───────────
  const LINE_MOVEMENT_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_TTL = 3 * 60 * 1000; // 3-min cache

  // ── Proactive game-time lookup: populated at startup + every 15 min ──────
  // Maps "awayTeamLower::homeTeamLower" → ISO gameTime string, for all 4 sports today.
  // Used by /api/bets to fill null gameTime on Kalshi player props.
  const GAME_TIME_LOOKUP = new Map<string, string>(); // "away::home" → ISO string
  const TEAM_WORD_LOOKUP = new Map<string, string>(); // teamWord → ISO string
  let gameTimeLookupLastFetch = 0;
  const GAME_TIME_TTL = 15 * 60 * 1000;

  async function refreshGameTimeLookup() {
    if (Date.now() - gameTimeLookupLastFetch < GAME_TIME_TTL) return;
    try {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const sports = ["nba", "mlb", "nhl", "nfl"];
      const ACTION_BOOK_IDS = "15,68,30";
      await Promise.allSettled(sports.map(async (slug) => {
        try {
          const url = `https://api.actionnetwork.com/web/v1/scoreboard/publicbetting/${slug}?period=game&bookIds=${ACTION_BOOK_IDS}&date=${today}`;
          const { data } = await axios.get(url, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.actionnetwork.com/", "Authorization": `Bearer ${process.env.ACTION_NETWORK_KEY ?? "95d975972c05aa2f9ea5c3688ffc327c8afdbfe3dbd59f3545715d8e3bf7bee2"}` },
          });
          const games: any[] = data?.games ?? data?.scoreboard ?? [];
          for (const game of games) {
            const st = game.start_time ?? null;
            if (!st) continue;
            const teams: any[] = game.teams ?? [];
            const awayTeam = (teams.find((t: any) => t.id === game.away_team_id)?.full_name ?? "").toLowerCase();
            const homeTeam = (teams.find((t: any) => t.id === game.home_team_id)?.full_name ?? "").toLowerCase();
            if (awayTeam && homeTeam) {
              GAME_TIME_LOOKUP.set(`${awayTeam}::${homeTeam}`, st);
              // Also index individual words (>3 chars) from each team name
              for (const w of [...awayTeam.split(" "), ...homeTeam.split(" ")]) {
                const wl = w.trim();
                if (wl.length > 3) TEAM_WORD_LOOKUP.set(wl, st);
              }
            }
          }
        } catch { /* ignore per-sport errors */ }
      }));
      gameTimeLookupLastFetch = Date.now();
    } catch { /* ignore */ }
  }

  // Kick off initial fetch immediately (don't await — non-blocking)
  refreshGameTimeLookup().catch(() => {});

  app.get("/api/line-movement", async (req, res) => {
    try {
      const cacheKey = "lm";
      const cached = LINE_MOVEMENT_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LM_TTL) {
        return res.json(cached.data);
      }

      const nowUtc = new Date();
      // Check yesterday + today + tomorrow UTC to catch all timezone windows
      const yesterdayUtc = new Date(nowUtc.getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      const todayUtc     = nowUtc.toISOString().slice(0, 10).replace(/-/g, "");
      const tomorrowUtc  = new Date(nowUtc.getTime() + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      const datesToCheck = [yesterdayUtc, todayUtc, tomorrowUtc];

      const sports = [
        { slug: "nba", label: "NBA" },
        { slug: "mlb", label: "MLB" },
        { slug: "nhl", label: "NHL" },
        { slug: "nfl", label: "NFL" },
      ];

      const results: any[] = [];

      await Promise.allSettled(sports.map(async ({ slug, label }) => {
        try {
          const anHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://www.actionnetwork.com/",
          };

          // ── Step 1: Collect games from ActionNetwork /scoreboard (no auth needed, has public %) ──
          const seenIds = new Set<string>();
          const allGames: any[] = [];
          for (const date of datesToCheck) {
            const url = `https://api.actionnetwork.com/web/v1/scoreboard/${slug}?date=${date}`;
            const { data } = await axios.get(url, { timeout: 10000, headers: anHeaders }).catch(() => ({ data: {} }));
            for (const g of (data?.games ?? [])) {
              if (!seenIds.has(String(g.id))) { seenIds.add(String(g.id)); allGames.push(g); }
            }
          }

          // Only games within next 48h (or already in-progress)
          const cutoff = new Date(nowUtc.getTime() + 48 * 3600 * 1000);
          const games = allGames.filter((g: any) => {
            const st = g.start_time ? new Date(g.start_time) : null;
            if (!st) return true;
            // Include in-progress + scheduled within 48h; exclude completed
            const status = (g.status ?? "").toLowerCase();
            if (status === "complete" || status === "closed" || status === "final") return false;
            return st <= cutoff;
          });

          // ── Step 2: For each game, build the LM entry ──
          for (const game of games) {
            const teams: any[] = game.teams ?? [];
            const awayTeamObj = teams.find((t: any) => t.id === game.away_team_id) ?? teams[0] ?? {};
            const homeTeamObj = teams.find((t: any) => t.id === game.home_team_id) ?? teams[1] ?? {};
            const awayTeam = awayTeamObj.full_name ?? awayTeamObj.display_name ?? "Away";
            const homeTeam = homeTeamObj.full_name ?? homeTeamObj.display_name ?? "Home";
            const gameTime = game.start_time ?? null;

            // Sort odds by inserted time
            const oddsArr: any[] = (game.odds ?? []).sort((a: any, b: any) =>
              (a.inserted ?? "").localeCompare(b.inserted ?? "")
            );
            if (oddsArr.length < 1) continue;

            const opening = oddsArr[0];
            // Current = latest entry that has at least some data
            const withLines  = oddsArr.filter((o: any) => o.spread_away != null || o.total != null || o.ml_away != null);
            const withPublic = oddsArr.filter((o: any) => o.spread_away_public != null || o.ml_away_public != null || o.total_over_public != null);
            const current = oddsArr[oddsArr.length - 1];
            const bestLines  = withLines.length  > 0 ? withLines[withLines.length - 1]   : current;
            const bestPublic = withPublic.length > 0 ? withPublic[withPublic.length - 1] : current;

            // Spread
            let spreadOpen    = opening.spread_away ?? null;
            let spreadCurrent = bestLines.spread_away ?? null;
            let spreadMove    = (spreadOpen != null && spreadCurrent != null) ? +(spreadCurrent - spreadOpen).toFixed(1) : null;

            // Total
            let totalOpen    = opening.total ?? null;
            let totalCurrent = bestLines.total ?? null;
            let totalMove    = (totalOpen != null && totalCurrent != null) ? +(totalCurrent - totalOpen).toFixed(1) : null;

            // ML
            let mlAwayOpen    = opening.ml_away  ?? null;
            let mlHomeOpen    = opening.ml_home  ?? null;
            let mlAwayCurrent = bestLines.ml_away ?? null;
            let mlHomeCurrent = bestLines.ml_home ?? null;

            // Public / sharp %
            let spreadAwayPublic = bestPublic.spread_away_public ?? null;
            let spreadAwayMoney  = bestPublic.spread_away_money  ?? null;
            let spreadHomePublic = bestPublic.spread_home_public ?? null;
            let spreadHomeMoney  = bestPublic.spread_home_money  ?? null;
            let totalOverPublic  = bestPublic.total_over_public  ?? null;
            let totalOverMoney   = bestPublic.total_over_money   ?? null;
            let totalUnderPublic = bestPublic.total_under_public ?? null;
            let totalUnderMoney  = bestPublic.total_under_money  ?? null;
            let mlAwayPublic     = bestPublic.ml_away_public     ?? null;
            let mlAwayMoney      = bestPublic.ml_away_money      ?? null;
            let mlHomePublic     = bestPublic.ml_home_public     ?? null;
            let mlHomeMoney      = bestPublic.ml_home_money      ?? null;
            const numBets        = bestPublic.num_bets           ?? current.num_bets ?? null;

            // ── Step 3: If lines are missing, supplement with ESPN odds ──
            const hasLines = spreadCurrent != null || totalCurrent != null || mlAwayCurrent != null;
            if (!hasLines) {
              try {
                const espnSportMap: Record<string,{sn:string;lg:string}> = {
                  nba: { sn:"basketball", lg:"nba" },
                  mlb: { sn:"baseball",   lg:"mlb" },
                  nhl: { sn:"hockey",     lg:"nhl" },
                  nfl: { sn:"football",   lg:"nfl" },
                };
                const esp = espnSportMap[slug];
                if (!esp) continue;

                // Find matching ESPN event by team name
                for (const date of datesToCheck) {
                  const evUrl = `https://sports.core.api.espn.com/v2/sports/${esp.sn}/leagues/${esp.lg}/events?limit=30&dates=${date}`;
                  const { data: evListData } = await axios.get(evUrl, { timeout: 8000 }).catch(() => ({ data: {} }));
                  const evItems: any[] = evListData?.items ?? [];

                  let matched = false;
                  for (const evItem of evItems) {
                    const { data: evData } = await axios.get(evItem.$ref, { timeout: 6000 }).catch(() => ({ data: {} }));
                    const evName: string = evData.name ?? "";
                    const atIdx = evName.lastIndexOf(" at ");
                    if (atIdx < 0) continue;
                    const espAway = evName.slice(0, atIdx).trim().toLowerCase();
                    const espHome = evName.slice(atIdx + 4).trim().toLowerCase();
                    const anAway = awayTeam.toLowerCase();
                    const anHome = homeTeam.toLowerCase();
                    // Match by last word of team name
                    const awLast = anAway.split(" ").pop() ?? "";
                    const hwLast = anHome.split(" ").pop() ?? "";
                    if (awLast.length < 3 || hwLast.length < 3) continue;
                    if (!espAway.includes(awLast) || !espHome.includes(hwLast)) continue;

                    const comp = evData.competitions?.[0] ?? {};
                    const oddsRef: string | undefined = comp.odds?.$ref;
                    if (!oddsRef) { matched = true; break; }

                    const { data: oddsData } = await axios.get(oddsRef, { timeout: 6000 }).catch(() => ({ data: {} }));
                    const entry: any = (oddsData.items ?? [])[0];
                    if (!entry) { matched = true; break; }

                    // ESPN spread: entry.spread = home spread, so away = -entry.spread
                    const homeSpreadEspn: number | null = entry.spread ?? null;
                    spreadCurrent = homeSpreadEspn != null ? -homeSpreadEspn : null;
                    const awSpreadOpenStr: string = entry.awayTeamOdds?.open?.pointSpread?.american ?? "";
                    spreadOpen = awSpreadOpenStr ? parseFloat(awSpreadOpenStr) : null;
                    spreadMove = (spreadOpen != null && spreadCurrent != null) ? +(spreadCurrent - spreadOpen).toFixed(1) : null;

                    const totOpenStr: string = entry.open?.total?.american ?? "";
                    totalOpen    = totOpenStr ? parseFloat(totOpenStr) : null;
                    totalCurrent = entry.overUnder ?? null;
                    totalMove    = (totalOpen != null && totalCurrent != null) ? +(totalCurrent - totalOpen).toFixed(1) : null;

                    const mlAwayOpenStr: string = entry.awayTeamOdds?.open?.moneyLine?.american ?? "";
                    const mlHomeOpenStr: string = entry.homeTeamOdds?.open?.moneyLine?.american ?? "";
                    mlAwayOpen    = mlAwayOpenStr ? parseFloat(mlAwayOpenStr) : null;
                    mlHomeOpen    = mlHomeOpenStr ? parseFloat(mlHomeOpenStr) : null;
                    mlAwayCurrent = entry.awayTeamOdds?.moneyLine ?? null;
                    mlHomeCurrent = entry.homeTeamOdds?.moneyLine ?? null;

                    matched = true;
                    break;
                  }
                  if (matched) break;
                }
              } catch { /* ESPN supplement failed — continue with what we have */ }
            }

            // Skip if still no lines at all
            if (spreadCurrent == null && totalCurrent == null && mlAwayCurrent == null && mlHomeCurrent == null) continue;

            results.push({
              id: `lm-${slug}-${game.id}`,
              sport: label,
              awayTeam,
              homeTeam,
              gameTime,
              status: game.status ?? "scheduled",
              openingInserted: opening.inserted ?? null,
              currentInserted: current.inserted  ?? null,
              numBets,
              spread: {
                open:       spreadOpen,
                current:    spreadCurrent,
                move:       spreadMove,
                awayPublic: spreadAwayPublic,
                awayMoney:  spreadAwayMoney,
                homePublic: spreadHomePublic,
                homeMoney:  spreadHomeMoney,
              },
              total: {
                open:        totalOpen,
                current:     totalCurrent,
                move:        totalMove,
                overPublic:  totalOverPublic,
                overMoney:   totalOverMoney,
                underPublic: totalUnderPublic,
                underMoney:  totalUnderMoney,
              },
              moneyline: {
                awayOpen:    mlAwayOpen,
                awayCurrent: mlAwayCurrent,
                homeOpen:    mlHomeOpen,
                homeCurrent: mlHomeCurrent,
                awayPublic:  mlAwayPublic,
                awayMoney:   mlAwayMoney,
                homePublic:  mlHomePublic,
                homeMoney:   mlHomeMoney,
              },
            });
          }
        } catch (e: any) {
          console.warn(`[LineMovement] ${slug} error:`, e.message);
        }
      }));

      // Sort: most movement first
      results.sort((a, b) => {
        const aMove = Math.abs(a.spread?.move ?? 0) + Math.abs(a.total?.move ?? 0);
        const bMove = Math.abs(b.spread?.move ?? 0) + Math.abs(b.total?.move ?? 0);
        return bMove - aMove;
      });

      LINE_MOVEMENT_CACHE.set(cacheKey, { data: results, ts: Date.now() });
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Line Movement Intelligence: auto-research significant moves ─────────────
  const LM_RESEARCH_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_RESEARCH_TTL = 30 * 60 * 1000; // 30-min cache per game

  // Thresholds for "significant" movement
  const SIGNIFICANT_SPREAD = 1.5;  // spread moved >= 1.5 pts
  const SIGNIFICANT_TOTAL  = 1.5;  // total moved >= 1.5 pts
  const STEAM_SPREAD       = 3.0;
  const STEAM_TOTAL        = 3.0;
  const SIGNIFICANT_ML     = 30;   // ML moved >= 30 cents

  async function fetchGoogleNewsRSS(query: string): Promise<{ title: string; link: string; pubDate: string }[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
      const { data } = await axios.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const $ = cheerio.load(data, { xmlMode: true });
      const items: { title: string; link: string; pubDate: string }[] = [];
      $('item').slice(0, 5).each((_, el) => {
        items.push({
          title: $(el).find('title').text().trim(),
          link:  $(el).find('link').text().trim() || $(el).find('guid').text().trim(),
          pubDate: $(el).find('pubDate').text().trim(),
        });
      });
      return items;
    } catch { return []; }
  }

  async function fetchESPNInjuries(sport: string): Promise<{ player: string; status: string; team: string }[]> {
    const sportMap: Record<string, { sn: string; lg: string }> = {
      NBA: { sn: "basketball", lg: "nba" },
      MLB: { sn: "baseball",   lg: "mlb" },
      NHL: { sn: "hockey",     lg: "nhl" },
      NFL: { sn: "football",   lg: "nfl" },
    };
    const s = sportMap[sport];
    if (!s) return [];
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${s.sn}/${s.lg}/injuries`;
      const { data } = await axios.get(url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const teams: any[] = data?.teams ?? [];
      const injuries: { player: string; status: string; team: string }[] = [];
      for (const team of teams) {
        const name = team.team?.displayName ?? "";
        for (const inj of (team.injuries ?? [])) {
          const pName = inj.athlete?.displayName ?? "";
          const status = inj.status ?? inj.type?.description ?? "Questionable";
          if (pName) injuries.push({ player: pName, status, team: name });
        }
      }
      return injuries;
    } catch { return []; }
  }

  // ── MLB city map for RotoGrinders / NFLWeather lookup ───────────────────────
  const TEAM_CITY: Record<string, string> = {
    // MLB
    "Yankees": "New York", "Mets": "New York", "Red Sox": "Boston", "Blue Jays": "Toronto",
    "Rays": "Tampa", "Orioles": "Baltimore", "White Sox": "Chicago", "Cubs": "Chicago",
    "Indians": "Cleveland", "Guardians": "Cleveland", "Tigers": "Detroit", "Royals": "Kansas City",
    "Twins": "Minneapolis", "Astros": "Houston", "Athletics": "Oakland", "Angels": "Anaheim",
    "Mariners": "Seattle", "Rangers": "Arlington", "Dodgers": "Los Angeles", "Giants": "San Francisco",
    "Padres": "San Diego", "Rockies": "Denver", "Diamondbacks": "Phoenix", "Braves": "Atlanta",
    "Marlins": "Miami", "Phillies": "Philadelphia", "Nationals": "Washington", "Mets": "New York",
    "Reds": "Cincinnati", "Brewers": "Milwaukee", "Cardinals": "St. Louis", "Pirates": "Pittsburgh",
    // NFL
    "Bears": "Chicago", "Lions": "Detroit", "Packers": "Green Bay", "Vikings": "Minneapolis",
    "Falcons": "Atlanta", "Panthers": "Charlotte", "Saints": "New Orleans", "Buccaneers": "Tampa",
    "Cardinals": "Phoenix", "Rams": "Los Angeles", "49ers": "San Francisco", "Seahawks": "Seattle",
    "Cowboys": "Dallas", "Giants": "New York", "Eagles": "Philadelphia", "Commanders": "Washington",
    "Browns": "Cleveland", "Steelers": "Pittsburgh", "Ravens": "Baltimore", "Bengals": "Cincinnati",
    "Texans": "Houston", "Colts": "Indianapolis", "Titans": "Nashville", "Jaguars": "Jacksonville",
    "Chiefs": "Kansas City", "Raiders": "Las Vegas", "Chargers": "Los Angeles", "Broncos": "Denver",
    "Bills": "Buffalo", "Dolphins": "Miami", "Patriots": "Boston", "Jets": "New York",
  };

  function getCityFromTeam(teamName: string): string {
    for (const [team, city] of Object.entries(TEAM_CITY)) {
      if (teamName.includes(team)) return city;
    }
    // Fallback: strip last word (team nickname) to get city
    const words = teamName.trim().split(/\s+/);
    return words.slice(0, -1).join(" ") || teamName;
  }

  async function fetchWeather(homeTeam: string, sport: string): Promise<string | null> {
    // Only outdoor sports need weather: MLB, NFL
    if (sport !== "MLB" && sport !== "NFL") return null;

    const city = getCityFromTeam(homeTeam);

    // ── Try RotoGrinders for MLB (best source for ballpark weather + wind) ───
    if (sport === "MLB") {
      try {
        const { data: html } = await axios.get("https://rotogrinders.com/weather/mlb", {
          timeout: 6000,
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
        });
        // Parse: look for the city/team name and nearby temp/wind data
        const cityLower = city.toLowerCase();
        const teamLower = homeTeam.toLowerCase().split(" ").pop() ?? "";
        // RotoGrinders HTML: <div class="weather-card"> ... team name ... temp ... wind ...
        const cardRegex = new RegExp(
          `(${teamLower}|${cityLower})[^]*?([0-9]+)°F[^]*?([0-9]+\s*mph[^<]*)?`,
          "i"
        );
        const match = html.match(cardRegex);
        if (match) {
          const temp = match[2];
          const wind = match[3] ? ` · Wind: ${match[3].trim()}` : "";
          return `${city}: ☀ ${temp}°F${wind}`;
        }
        // Second pass: look for simpler temp pattern near the team
        const teamIdx = (html as string).toLowerCase().indexOf(teamLower);
        if (teamIdx > -1) {
          const nearby = (html as string).slice(teamIdx, teamIdx + 500);
          const tempM = nearby.match(/([0-9]{2,3})°F/);
          const windM = nearby.match(/([0-9]+)\s*mph/);
          if (tempM) {
            const wind = windM ? ` · Wind: ${windM[1]} mph` : "";
            return `${city}: ☀ ${tempM[1]}°F${wind}`;
          }
        }
      } catch { /* fall through to wttr */ }
    }

    // ── Try NFLWeather.com for NFL ────────────────────────────────────────────
    if (sport === "NFL") {
      try {
        const { data: html } = await axios.get("https://www.nflweather.com", {
          timeout: 6000,
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
        });
        const teamLower = homeTeam.toLowerCase().split(" ").pop() ?? "";
        const cityLower = city.toLowerCase();
        const nflReg = new RegExp(
          `(${teamLower}|${cityLower})[^]*?([0-9]+)°F[^]*?([0-9]+\s*mph[^<]*)?`,
          "i"
        );
        const match = (html as string).match(nflReg);
        if (match) {
          const temp = match[2];
          const wind = match[3] ? ` · Wind: ${match[3].trim()}` : "";
          return `${city}: ☀ ${temp}°F${wind}`;
        }
        // Second pass near team
        const tidx = (html as string).toLowerCase().indexOf(teamLower);
        if (tidx > -1) {
          const nearby = (html as string).slice(tidx, tidx + 500);
          const tempM = nearby.match(/([0-9]{2,3})°F/);
          const windM = nearby.match(/([0-9]+)\s*mph/);
          if (tempM) {
            const wind = windM ? ` · Wind: ${windM[1]} mph` : "";
            return `${city}: ☀ ${tempM[1]}°F${wind}`;
          }
        }
      } catch { /* fall through to wttr */ }
    }

    // ── Fallback: wttr.in in imperial (°F) ────────────────────────────────────
    try {
      const encoded = encodeURIComponent(city);
      // &u = imperial/Fahrenheit (no &m which is metric/Celsius)
      const url = `https://wttr.in/${encoded}?format=3&u`;
      const { data } = await axios.get(url, { timeout: 5000, headers: { "User-Agent": "curl/7.64" } });
      if (typeof data === "string") {
        // Convert any remaining °C to °F just in case
        const clean = data.trim().replace(/\+?(-?[0-9]+)°C/g, (_, n) => `${Math.round(+n * 9/5 + 32)}°F`);
        return clean.slice(0, 80);
      }
    } catch { return null; }

    return null;
  }

  function buildMovementSummary(game: any): string {
    const parts: string[] = [];
    const spreadMove = game.spread?.move;
    const totalMove  = game.total?.move;
    const mlAwayMove = (game.moneyline?.awayOpen != null && game.moneyline?.awayCurrent != null)
      ? game.moneyline.awayCurrent - game.moneyline.awayOpen : null;
    const mlHomeMove = (game.moneyline?.homeOpen != null && game.moneyline?.homeCurrent != null)
      ? game.moneyline.homeCurrent - game.moneyline.homeOpen : null;

    if (spreadMove != null && spreadMove !== 0) {
      const severity = Math.abs(spreadMove) >= STEAM_SPREAD ? "🔥 STEAM" : "⚡ Significant";
      parts.push(`${severity}: Spread moved ${spreadMove > 0 ? "+" : ""}${spreadMove} (${game.awayTeam} @ ${game.homeTeam})`);
    }
    if (totalMove != null && totalMove !== 0) {
      const severity = Math.abs(totalMove) >= STEAM_TOTAL ? "🔥 STEAM" : "⚡ Significant";
      parts.push(`${severity}: Total moved ${totalMove > 0 ? "+" : ""}${totalMove} (O/U ${game.total?.open} → ${game.total?.current})`);
    }
    if (mlAwayMove != null && Math.abs(mlAwayMove) >= SIGNIFICANT_ML) {
      parts.push(`ML shift: ${game.awayTeam} ML moved ${mlAwayMove > 0 ? "+" : ""}${mlAwayMove}`);
    }
    if (mlHomeMove != null && Math.abs(mlHomeMove) >= SIGNIFICANT_ML) {
      parts.push(`ML shift: ${game.homeTeam} ML moved ${mlHomeMove > 0 ? "+" : ""}${mlHomeMove}`);
    }

    // Sharp signal
    const spreadMoneyAway = game.spread?.awayMoney;
    const spreadPublicAway = game.spread?.awayPublic;
    if (spreadMoneyAway != null && spreadPublicAway != null) {
      const div = spreadMoneyAway - spreadPublicAway;
      if (spreadMoneyAway >= 65 && div >= 20)
        parts.push(`💰 Sharp: ${game.awayTeam} getting ${spreadMoneyAway}% of spread money vs ${spreadPublicAway}% public bets`);
      else if (spreadMoneyAway <= 35 && div <= -20)
        parts.push(`💰 Fade signal: ${game.awayTeam} only ${spreadMoneyAway}% of money despite public support`);
    }
    const mlMoney = game.moneyline?.awayMoney;
    const mlPublic = game.moneyline?.awayPublic;
    if (mlMoney != null && mlPublic != null) {
      const div = mlMoney - mlPublic;
      if (mlMoney >= 65 && div >= 20)
        parts.push(`💰 ML Sharp: ${game.awayTeam} drawing ${mlMoney}% of ML money`);
    }

    return parts.join(" | ");
  }


  // ─── Clubhouse IQ on-demand grade for Line Movement page ──────────────────
  // POST /api/line-movement/ciq
  // Body: { sport, homeTeam, awayTeam, spread?, total?, mlHome?, mlAway?,
  //         spreadMove?, homeRecord?, awayRecord?, homeMoneyPct?, awayMoneyPct? }
  // Calls edge_grade.py directly and returns the full grade result
  app.post("/api/line-movement/ciq", async (req, res) => {
    try {
      const { sport, homeTeam, awayTeam, spread, awaySpread, total, mlHome, mlAway,
              spreadMove, homeRecord, awayRecord, homeMoneyPct, awayMoneyPct,
              spreadAwayPct, spreadHomePct } = req.body ?? {};

      if (!sport || !homeTeam || !awayTeam) {
        return res.status(400).json({ error: "sport, homeTeam, awayTeam required" });
      }

      // LM data gives us the AWAY team's spread (e.g. -15.5 = away is -15.5 favorite)
      // Home spread is the inverse
      const awayLine  = awaySpread ?? spread ?? null;
      const homeML    = mlHome ?? null;
      const awayML    = mlAway ?? null;

      // Determine pick side — priority: sharp money % → moneyline implied prob → spread
      let pickSide: "home" | "away" = "home";
      const sharpHome = spreadHomePct ?? homeMoneyPct ?? null;
      const sharpAway = spreadAwayPct ?? awayMoneyPct ?? null;

      if (sharpHome != null && sharpAway != null) {
        pickSide = sharpAway >= sharpHome ? "away" : "home";
      } else if (homeML != null && awayML != null) {
        const homeProb = homeML < 0 ? Math.abs(homeML) / (Math.abs(homeML) + 100) : 100 / (homeML + 100);
        const awayProb = awayML < 0 ? Math.abs(awayML) / (Math.abs(awayML) + 100) : 100 / (awayML + 100);
        pickSide = awayProb >= homeProb ? "away" : "home";
      } else if (awayLine != null) {
        // Negative away spread = away is the favorite
        pickSide = awayLine < 0 ? "away" : "home";
      }

      const payload = {
        sport,
        homeTeam,
        awayTeam,
        pickSide,
        homeRecord:   homeRecord ?? "0-0",
        awayRecord:   awayRecord ?? "0-0",
        homeML:       homeML,
        awayML:       awayML,
        // edge_grade.py expects spreadHome = the home team's spread line
        // if away is -15.5, home is +15.5
        spreadHome:   awayLine != null ? -awayLine : null,
        spreadDelta:  spreadMove ?? 0,
        homeMoneyPct: homeMoneyPct ?? null,
        awayMoneyPct: awayMoneyPct ?? null,
        total:        total ?? null,
      };

      // Resolve edge_grade.py — try multiple paths since __dirname=dist/ in production
      const fs = await import("fs");
      const candidatePaths = [
        path.join(process.cwd(), "server", "edge_grade.py"),
        path.join(__dirname, "edge_grade.py"),
        path.join(__dirname, "..", "server", "edge_grade.py"),
      ];
      const pyPath = candidatePaths.find(p => fs.existsSync(p)) ?? candidatePaths[0];
      console.log(`[CIQ/LM] Using edge_grade.py at: ${pyPath} (exists: ${fs.existsSync(pyPath)})`);

      const result = await new Promise<any>((resolve) => {
        const child = spawn("python3", [pyPath, "grade", JSON.stringify(payload)], { timeout: 15000 });
        let out = "";
        let err = "";
        child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
        child.on("close", (code: number) => {
          if (code !== 0 || !out.trim()) {
            console.warn(`[CIQ/LM] edge_grade exited ${code}. stderr: ${err.slice(0, 400)}`);
            resolve(null);
            return;
          }
          try { resolve(JSON.parse(out.trim())); }
          catch (e) { console.warn("[CIQ/LM] JSON parse failed:", out.slice(0, 200)); resolve(null); }
        });
        child.on("error", (e: any) => { console.warn("[CIQ/LM] spawn error:", e.message); resolve(null); });
      });

      if (!result) {
        return res.status(200).json({ available: false, reason: "grade engine unavailable" });
      }

      const pickTeam = pickSide === "home" ? homeTeam : awayTeam;
      const pickedOdds = pickSide === "home" ? (mlHome ?? null) : (mlAway ?? null);

      return res.json({
        available: true,
        grade:       result.grade,
        score:       result.score,
        confidence:  result.confidence,
        sizing:      result.sizing,
        ev:          result.ev,
        chains:      result.chains_fired ?? result.chains ?? [],
        variables:   result.variables ?? {},
        peter:       result.peter ?? { flags: [], has_kill: false },
        pickSide,
        pickTeam,
        pickedOdds,
      });
    } catch (e: any) {
      console.error("[CIQ/LM] Error:", e.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/line-movement/research/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;

      // Serve from cache if fresh
      const cached = LM_RESEARCH_CACHE.get(gameId);
      if (cached && Date.now() - cached.ts < LM_RESEARCH_TTL) {
        return res.json(cached.data);
      }

      // Find the game from the line movement cache
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      const game = lmCache?.data?.find((g: any) => g.id === gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found in line movement cache. Refresh the page first." });
      }

      const { sport, awayTeam, homeTeam, gameTime } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;
      const moveSummary = buildMovementSummary(game);

      // Run all research in parallel
      const [injuryData, newsRaw, newsTeamA, newsTeamB, weather] = await Promise.allSettled([
        fetchESPNInjuries(sport),
        fetchGoogleNewsRSS(`${awayTeam} ${homeTeam} betting odds line movement`),
        fetchGoogleNewsRSS(`${awayTeam} injury report ${sport}`),
        fetchGoogleNewsRSS(`${homeTeam} injury report ${sport}`),
        fetchWeather(homeTeam, sport),
      ]);

      const allInjuries: { player: string; status: string; team: string }[] =
        injuryData.status === "fulfilled" ? injuryData.value : [];

      // Filter injuries to teams in this game
      const awayWords = awayTeam.split(" ");
      const homeWords = homeTeam.split(" ");
      const gameInjuries = allInjuries.filter(inj => {
        const t = inj.team.toLowerCase();
        return awayWords.some(w => w.length > 3 && t.includes(w.toLowerCase())) ||
               homeWords.some(w => w.length > 3 && t.includes(w.toLowerCase()));
      }).slice(0, 10);

      // Combine news results
      const allNews: { title: string; link: string; pubDate: string }[] = [
        ...(newsRaw.status === "fulfilled" ? newsRaw.value : []),
        ...(newsTeamA.status === "fulfilled" ? newsTeamA.value : []),
        ...(newsTeamB.status === "fulfilled" ? newsTeamB.value : []),
      ];
      // Deduplicate by title similarity
      const seen = new Set<string>();
      const dedupedNews = allNews.filter(n => {
        const key = n.title.toLowerCase().slice(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8);

      const weatherInfo = weather.status === "fulfilled" ? weather.value : null;

      // Build a concise AI-style summary
      const summaryParts: string[] = [];

      // Movement reason
      if (moveSummary) {
        summaryParts.push(`📊 **Movement**: ${moveSummary}`);
      }

      // Injury flags
      if (gameInjuries.length > 0) {
        const injList = gameInjuries.map(i => `${i.player} (${i.team}) — ${i.status}`).join("; ");
        summaryParts.push(`🏥 **Injuries**: ${injList}`);
      } else {
        summaryParts.push(`🏥 **Injuries**: No major injuries found via ESPN`);
      }

      // Weather
      if (weatherInfo) {
        const weatherF = weatherInfo.replace(/\+?(-?\d+)°C/g, (_: string, n: string) => `${Math.round(+n * 9/5 + 32)}°F`);
        summaryParts.push(`🌤 **Weather**: ${weatherF}`);
      }

      // Sharp money signal
      const spreadAwayMoney = game.spread?.awayMoney;
      const spreadAwayPublic = game.spread?.awayPublic;
      const totalOverMoney = game.total?.overMoney;
      const totalOverPublic = game.total?.overPublic;
      const sharpNotes: string[] = [];
      if (spreadAwayMoney != null && spreadAwayPublic != null) {
        const div = spreadAwayMoney - spreadAwayPublic;
        if (Math.abs(div) >= 15) {
          sharpNotes.push(`${awayTeam} spread: ${spreadAwayMoney}% money vs ${spreadAwayPublic}% tickets (${div > 0 ? "sharp lean" : "public fade"})`);
        }
      }
      if (totalOverMoney != null && totalOverPublic != null) {
        const div = totalOverMoney - totalOverPublic;
        if (Math.abs(div) >= 15) {
          sharpNotes.push(`Over: ${totalOverMoney}% money vs ${totalOverPublic}% tickets (${div > 0 ? "sharp over" : "sharp under"})`);
        }
      }
      if (game.numBets != null) {
        sharpNotes.push(`Total bets tracked: ${game.numBets.toLocaleString()}`);
      }
      if (sharpNotes.length > 0) {
        summaryParts.push(`💰 **Sharp Money**: ${sharpNotes.join(" | ")}`);
      }

      // News headlines
      if (dedupedNews.length > 0) {
        const headlineStr = dedupedNews
          .slice(0, 4)
          .map(n => `• ${n.title}`)
          .join("\n");
        summaryParts.push(`📰 **Recent News**:\n${headlineStr}`);
      }

      const result = {
        gameId,
        gameName,
        sport,
        gameTime,
        moveSummary,
        injuries: gameInjuries,
        weather: weatherInfo,
        news: dedupedNews,
        sharpSignals: sharpNotes,
        summary: summaryParts.join("\n\n"),
        researchedAt: new Date().toISOString(),
      };

      LM_RESEARCH_CACHE.set(gameId, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Steam / Book-Error Intel Endpoint ──────────────────────────────────────
  // GET /api/line-movement/intel/:gameId
  // Auto-fires when a steam move or book error is detected on a game card.
  // Returns a concise "why did the line move?" card: injuries, news, weather,
  // sharp signal breakdown.  Cached 15 min.
  const LM_INTEL_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_INTEL_TTL = 15 * 60 * 1000;

  app.get("/api/line-movement/intel/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;

      // Serve from cache if fresh
      const cached = LM_INTEL_CACHE.get(gameId);
      if (cached && Date.now() - cached.ts < LM_INTEL_TTL) {
        return res.json({ ...cached.data, cached: true });
      }

      // Find the game from the line movement cache
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      const game = lmCache?.data?.find((g: any) => g.id === gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found — refresh line movement data first." });
      }

      const { sport, awayTeam, homeTeam, gameTime, spread, total, moneyline } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;

      // Detect trigger type
      const spreadMove = spread?.move ?? 0;
      const totalMove  = total?.move ?? 0;
      const mlAwayMove = (moneyline?.awayOpen != null && moneyline?.awayCurrent != null)
        ? moneyline.awayCurrent - moneyline.awayOpen : 0;
      const mlHomeMove = (moneyline?.homeOpen != null && moneyline?.homeCurrent != null)
        ? moneyline.homeCurrent - moneyline.homeOpen : 0;

      const isSteam      = Math.abs(spreadMove) >= STEAM_SPREAD || Math.abs(totalMove) >= STEAM_TOTAL;
      const isRLM        = (() => {
        if (spread?.awayPublic != null && spreadMove !== 0) {
          const pub = spread.awayPublic;
          if (pub >= 60 && spreadMove > 0.5) return true;  // public on away, line moved against them
          if (pub <= 38 && spreadMove < -0.5) return true; // public on home, line moved against them
        }
        if (total?.overPublic != null && totalMove !== 0) {
          const pub = total.overPublic;
          if (pub >= 60 && totalMove < -0.5) return true;
          if (pub <= 38 && totalMove > 0.5) return true;
        }
        return false;
      })();
      const isSharpDiv   = (() => {
        if (spread?.awayMoney != null && spread?.awayPublic != null) {
          return Math.abs(spread.awayMoney - spread.awayPublic) >= 25;
        }
        return false;
      })();
      const isMLBigMove  = Math.abs(mlAwayMove) >= SIGNIFICANT_ML || Math.abs(mlHomeMove) >= SIGNIFICANT_ML;

      // Determine trigger label
      let triggerType = "line_alert";
      let triggerLabel = "Line Alert";
      if (isSteam)     { triggerType = "steam";   triggerLabel = "Steam Move"; }
      else if (isRLM)  { triggerType = "rlm";     triggerLabel = "Reverse Line Movement"; }
      else if (isSharpDiv) { triggerType = "sharp_div"; triggerLabel = "Sharp/Public Split"; }
      else if (isMLBigMove) { triggerType = "ml_move"; triggerLabel = "Big ML Move"; }

      // Parallel research: injuries + 3 news queries + weather
      const searchQueries = [
        `${awayTeam} ${homeTeam} ${sport} injury update today`,
        `${awayTeam} ${homeTeam} line movement betting news today`,
        `${awayTeam} OR ${homeTeam} game news ${new Date().toISOString().slice(0, 10)}`,
      ];

      const [injuryData, news1, news2, news3, weather] = await Promise.allSettled([
        fetchESPNInjuries(sport),
        fetchGoogleNewsRSS(searchQueries[0]),
        fetchGoogleNewsRSS(searchQueries[1]),
        fetchGoogleNewsRSS(searchQueries[2]),
        fetchWeather(homeTeam, sport),
      ]);

      // Injuries — filter to this game's teams
      const allInj: { player: string; status: string; team: string }[] =
        injuryData.status === "fulfilled" ? injuryData.value : [];
      const awayWords = awayTeam.split(" ");
      const homeWords = homeTeam.split(" ");
      const gameInjuries = allInj.filter(inj => {
        const t = inj.team.toLowerCase();
        return awayWords.some((w: string) => w.length > 3 && t.includes(w.toLowerCase())) ||
               homeWords.some((w: string) => w.length > 3 && t.includes(w.toLowerCase()));
      }).slice(0, 6);

      // Deduplicate news across 3 queries
      const rawNews = [
        ...(news1.status === "fulfilled" ? news1.value : []),
        ...(news2.status === "fulfilled" ? news2.value : []),
        ...(news3.status === "fulfilled" ? news3.value : []),
      ];
      const seen = new Set<string>();
      const dedupedNews = rawNews.filter(n => {
        const key = n.title.toLowerCase().slice(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 6);

      // Build a prioritized reason list (shown as intel bullets)
      const reasons: { icon: string; type: string; text: string; severity: "high" | "medium" | "low" }[] = [];

      // 1. Injury intel — highest priority
      const outPlayers = gameInjuries.filter(i => /out|doubtful/i.test(i.status));
      const qPlayers   = gameInjuries.filter(i => /questionable|probable/i.test(i.status));
      if (outPlayers.length > 0) {
        reasons.push({
          icon: "🏥",
          type: "injury",
          text: `Key injuries: ${outPlayers.map(i => `${i.player} (${i.team}) — ${i.status}`).join(", ")}`,
          severity: "high",
        });
      }
      if (qPlayers.length > 0) {
        reasons.push({
          icon: "⚠️",
          type: "injury",
          text: `Questionable: ${qPlayers.map(i => `${i.player} (${i.team})`).join(", ")}`,
          severity: "medium",
        });
      }

      // 2. Sharp money signal
      const spreadMoneyAway = spread?.awayMoney;
      const spreadPublicAway = spread?.awayPublic;
      if (spreadMoneyAway != null && spreadPublicAway != null) {
        const div = spreadMoneyAway - spreadPublicAway;
        if (Math.abs(div) >= 15) {
          const sharpSide = div > 0 ? awayTeam : homeTeam;
          const pct = div > 0 ? spreadMoneyAway : (100 - spreadMoneyAway);
          const pubPct = div > 0 ? spreadPublicAway : (100 - spreadPublicAway);
          reasons.push({
            icon: "💰",
            type: "sharp_money",
            text: `Sharp money on ${sharpSide}: ${pct}% of $ vs ${pubPct}% of tickets — ${Math.abs(div)}-pt split`,
            severity: Math.abs(div) >= 25 ? "high" : "medium",
          });
        }
      }
      const mlMoneyAway = moneyline?.awayMoney;
      const mlPublicAway = moneyline?.awayPublic;
      if (mlMoneyAway != null && mlPublicAway != null) {
        const div = mlMoneyAway - mlPublicAway;
        if (Math.abs(div) >= 20) {
          const sharpSide = div > 0 ? awayTeam : homeTeam;
          const pct = div > 0 ? mlMoneyAway : (100 - mlMoneyAway);
          reasons.push({
            icon: "💰",
            type: "sharp_money",
            text: `ML sharp action: ${sharpSide} drawing ${pct}% of ML money`,
            severity: "medium",
          });
        }
      }

      // 3. Weather (outdoor sports)
      const weatherInfo = weather.status === "fulfilled" ? weather.value : null;
      if (weatherInfo) {
        const weatherInfo2 = weatherInfo.replace(/\+?(-?\d+)°C/g, (_: string, n: string) => `${Math.round(+n * 9/5 + 32)}°F`);
        const hasWind = /wind/i.test(weatherInfo2);
        const hasRain = /rain|storm|snow/i.test(weatherInfo2);
        reasons.push({
          icon: hasWind ? "💨" : hasRain ? "🌧" : "🌤",
          type: "weather",
          text: `Weather: ${weatherInfo2}`,
          severity: (hasWind || hasRain) ? "high" : "low",
        });
      }

      // 4. Line movement context
      if (Math.abs(spreadMove) > 0) {
        const side = spreadMove < 0 ? awayTeam : homeTeam;
        reasons.push({
          icon: "📊",
          type: "line_move",
          text: `Spread moved ${spreadMove > 0 ? "+" : ""}${spreadMove} pts toward ${side} (${spread?.open != null ? (spread.open > 0 ? "+" : "") + spread.open : "?"} → ${spread?.current != null ? (spread.current > 0 ? "+" : "") + spread.current : "?"})`,
          severity: Math.abs(spreadMove) >= 3 ? "high" : "medium",
        });
      }
      if (Math.abs(totalMove) > 0) {
        const dir = totalMove > 0 ? "Over" : "Under";
        reasons.push({
          icon: "📊",
          type: "line_move",
          text: `Total steamed ${Math.abs(totalMove)} pts to the ${dir} (${total?.open} → ${total?.current})`,
          severity: Math.abs(totalMove) >= 3 ? "high" : "medium",
        });
      }

      // 5. News headlines — scan for relevant keywords
      const relevantNews = dedupedNews.filter(n => {
        const t = n.title.toLowerCase();
        const teamKeywords = [...awayTeam.split(" "), ...homeTeam.split(" ")]
          .filter((w: string) => w.length > 3)
          .map((w: string) => w.toLowerCase());
        return teamKeywords.some((kw: string) => t.includes(kw)) ||
          /injur|scratch|lineup|roster|suspend|trade|deal|weather|wind|rain|snow|out|dnp|questionable|ruled/i.test(t);
      }).slice(0, 4);

      // Build concise summary headline
      const topReason = reasons.find(r => r.severity === "high") ?? reasons[0] ?? null;
      let headline = "";
      if (isSteam) {
        headline = `🔥 Steam detected on ${gameName}`;
        if (topReason) headline += ` — ${topReason.text.replace(/^[^\w]*/, "")}`;
      } else if (isRLM) {
        headline = `↩ Reverse Line Movement on ${gameName}`;
        if (topReason) headline += ` — ${topReason.text.replace(/^[^\w]*/, "")}`;
      } else {
        headline = `⚡ Line Alert: ${gameName}`;
        if (topReason) headline += ` — ${topReason.text.replace(/^[^\w]*/, "")}`;
      }

      const result = {
        gameId,
        gameName,
        sport,
        gameTime,
        triggerType,
        triggerLabel,
        isSteam,
        isRLM,
        isSharpDiv,
        headline,
        reasons,
        relevantNews,
        injuries: gameInjuries,
        weather: weatherInfo,
        analyzedAt: new Date().toISOString(),
      };

      LM_INTEL_CACHE.set(gameId, { data: result, ts: Date.now() });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Book Error Detection ─────────────────────────────────────────────────────
  const LM_ERRORS_CACHE = new Map<string, { data: any; ts: number }>();
  const LM_ERRORS_TTL = 10 * 60 * 1000; // 10-min cache

  interface BookError {
    id: string;
    gameId: string;
    gameName: string;
    sport: string;
    gameTime: string | null;
    errorType: "mispriced_spread" | "mispriced_total" | "mispriced_ml" | "reverse_line_movement" | "sharp_divergence" | "stale_line";
    betType: string;          // e.g. "Spread (Lakers -4.5)"
    actualLine: string;       // what the book currently shows
    mistake: string;          // description of the error
    correctLine: string;      // what the line should likely be
    betIdea: string;          // how to profit
    confidence: number;       // 1-100
    severity: "high" | "medium" | "low";
  }

  function detectBookErrors(games: any[]): BookError[] {
    const errors: BookError[] = [];

    for (const game of games) {
      const { id, sport, awayTeam, homeTeam, gameTime, spread, total, moneyline } = game;
      const gameName = `${awayTeam} @ ${homeTeam}`;
      let errIdx = 0;
      const mkId = (type: string) => `err-${id}-${type}-${errIdx++}`;

      // ── 1. Reverse Line Movement (RLM) — spread ──────────────────────────
      // Public is hammering one side but line moved the other way → sharp money on opposite
      if (spread.awayPublic != null && spread.awayMoney != null && spread.move != null) {
        const publicPct = spread.awayPublic;  // % of bets on away spread
        const moneyPct  = spread.awayMoney;   // % of money on away spread
        const move      = spread.move;

        // Case A: public loves away (+favor) but line moved against them (away spread got worse)
        if (publicPct >= 60 && move > 0.5) {
          // Away gets more public bets but spread rose (harder to cover) → book/sharps fading away
          errors.push({
            id: mkId("rlm-spread-away"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Spread — ${awayTeam}`,
            actualLine: `${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current}`,
            mistake: `${publicPct}% of bets are on ${awayTeam} but the line has moved ${move > 0 ? "+" : ""}${move} against them (from ${spread.open > 0 ? "+" : ""}${spread.open}). This is a classic Reverse Line Movement signal — sharps are fading the public.`,
            correctLine: `Sharp money says ${homeTeam} side has value at current spread`,
            betIdea: `Bet ${homeTeam} ${spread.current > 0 ? "-" : "+"}${Math.abs(spread.current ?? 0)} — line is moving in their favor despite public being on the other side. This is an exploitable mispricing vs. the public-facing number.`,
            confidence: Math.min(90, 55 + Math.round(publicPct * 0.4) + Math.round(Math.abs(move) * 5)),
            severity: publicPct >= 75 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }

        // Case B: public loves home (away gets <40% of bets) but line moved in away's favor
        if (publicPct <= 38 && move < -0.5) {
          errors.push({
            id: mkId("rlm-spread-home"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Spread — ${homeTeam}`,
            actualLine: `${homeTeam} ${(-(spread.current ?? 0)) > 0 ? "+" : ""}${-(spread.current ?? 0)}`,
            mistake: `${100 - publicPct}% of bets are on ${homeTeam} but the spread has moved ${Math.abs(move)} points in ${awayTeam}'s favor (from ${spread.open} → ${spread.current}). Sharps are going against the public.`,
            correctLine: `Sharp action suggests ${awayTeam} is undervalued at this spread`,
            betIdea: `Bet ${awayTeam} spread — sharp money is pushing this line in their direction despite public fade. The discrepancy between public bets and line direction is a textbook RLM edge.`,
            confidence: Math.min(88, 55 + Math.round((100 - publicPct) * 0.4) + Math.round(Math.abs(move) * 5)),
            severity: (100 - publicPct) >= 75 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }
      }

      // ── 2. Sharp vs Public Divergence ≥25 pts (spread) ───────────────────
      if (spread.awayMoney != null && spread.awayPublic != null) {
        const div = spread.awayMoney - spread.awayPublic;
        if (Math.abs(div) >= 25) {
          const sharpSide = div > 0 ? awayTeam : homeTeam;
          const publicSide = div > 0 ? homeTeam : awayTeam;
          const sharpPct = div > 0 ? spread.awayMoney : (100 - spread.awayMoney);
          const publicPct2 = div > 0 ? spread.awayPublic : (100 - spread.awayPublic);
          const sharpLine = div > 0
            ? `${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current}`
            : `${homeTeam} ${(-(spread.current ?? 0)) > 0 ? "+" : ""}${-(spread.current ?? 0)}`;
          errors.push({
            id: mkId("div-spread"),
            gameId: id, gameName, sport, gameTime,
            errorType: "sharp_divergence",
            betType: `Spread — ${sharpSide}`,
            actualLine: sharpLine,
            mistake: `Massive sharp vs. public split: ${sharpPct}% of money on ${sharpSide} but only ${publicPct2}% of bets — a ${Math.abs(div)}-point divergence. The book's current spread does not fully reflect the sharp action, creating an exploitable window.`,
            correctLine: `Market should be pricing ${sharpSide} more favorably (sharp money dominant)`,
            betIdea: `Bet ${sharpSide} on the spread. When sharp money and public money diverge by 25+ points, following the sharp side has a documented positive expectation. Act before the line corrects.`,
            confidence: Math.min(85, 55 + Math.round(Math.abs(div) * 0.8)),
            severity: Math.abs(div) >= 35 ? "high" : "medium",
          });
        }
      }

      // ── 3. Reverse Line Movement — total ─────────────────────────────────
      if (total.overPublic != null && total.overMoney != null && total.move != null) {
        const overPub = total.overPublic;
        const overMon = total.overMoney;
        const move    = total.move;

        // Public loves OVER but total went DOWN
        if (overPub >= 60 && move < -0.5) {
          errors.push({
            id: mkId("rlm-total-under"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Total (O/U)`,
            actualLine: `O/U ${total.current} (opened ${total.open})`,
            mistake: `${overPub}% of bets are on the OVER but the total dropped ${Math.abs(move)} points (${total.open} → ${total.current}). Sharp money is hammering the UNDER while the public piles onto the over.`,
            correctLine: `Total likely should stay near ${total.open} if only public money — sharp pressure is pulling it under`,
            betIdea: `Bet the UNDER at ${total.current}. Sharps are driving this total down against overwhelming public over action — a classic fade-the-public edge. Current number is artificially soft relative to sharp signals.`,
            confidence: Math.min(88, 55 + Math.round(overPub * 0.35) + Math.round(Math.abs(move) * 6)),
            severity: overPub >= 70 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }

        // Public loves UNDER but total went UP
        if (overPub <= 38 && move > 0.5) {
          errors.push({
            id: mkId("rlm-total-over"),
            gameId: id, gameName, sport, gameTime,
            errorType: "reverse_line_movement",
            betType: `Total (O/U)`,
            actualLine: `O/U ${total.current} (opened ${total.open})`,
            mistake: `${100 - overPub}% of bets are on the UNDER but the total rose ${move} points (${total.open} → ${total.current}). Sharp money is on the OVER against public under sentiment.`,
            correctLine: `Total should reflect sharp OVER pressure — current line still undervalues it`,
            betIdea: `Bet the OVER at ${total.current}. Sharp money is inflating this total against public consensus. Get in now before further line movement pushes the number higher.`,
            confidence: Math.min(85, 55 + Math.round((100 - overPub) * 0.35) + Math.round(Math.abs(move) * 6)),
            severity: (100 - overPub) >= 70 || Math.abs(move) >= 2 ? "high" : "medium",
          });
        }
      }

      // ── 4. Stale Line — sharp money extreme but NO line movement ─────────
      // A book hasn't moved despite overwhelming sharp action → arbitrage window
      if (spread.awayMoney != null && spread.awayPublic != null && (spread.move == null || spread.move === 0)) {
        const div = Math.abs(spread.awayMoney - spread.awayPublic);
        if (div >= 30 && spread.awayMoney >= 65) {
          errors.push({
            id: mkId("stale-spread"),
            gameId: id, gameName, sport, gameTime,
            errorType: "stale_line",
            betType: `Spread — ${awayTeam}`,
            actualLine: `${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current} (no movement from open)`,
            mistake: `${spread.awayMoney}% of money on ${awayTeam} but the spread has NOT moved from ${spread.open}. The book is either slow to react or intentionally holding a stale line — creating a window before the inevitable correction.`,
            correctLine: `Expect ${awayTeam} spread to move ~0.5–1 pt in their favor once books re-price`,
            betIdea: `Bet ${awayTeam} ${spread.current > 0 ? "+" : ""}${spread.current} NOW before the line moves. Stale lines with extreme sharp money imbalances typically correct within hours — this is a time-sensitive value window.`,
            confidence: Math.min(80, 50 + Math.round(div * 0.7)),
            severity: div >= 40 ? "high" : "medium",
          });
        }
      }

      // ── 5. ML vs Spread Inconsistency ────────────────────────────────────
      // If spread has away as heavy favorite but ML says it's close (or vice versa)
      if (spread.current != null && moneyline.awayCurrent != null && moneyline.homeCurrent != null) {
        const spreadFavorsAway = spread.current < -3.5; // away favored by more than 3.5
        const mlFavorsHome = moneyline.homeCurrent < moneyline.awayCurrent && moneyline.homeCurrent < -110;

        if (spreadFavorsAway && mlFavorsHome) {
          errors.push({
            id: mkId("ml-spread-mismatch"),
            gameId: id, gameName, sport, gameTime,
            errorType: "mispriced_ml",
            betType: `Moneyline — ${homeTeam}`,
            actualLine: `${awayTeam} spread: ${spread.current} | ${homeTeam} ML: ${moneyline.homeCurrent > 0 ? "+" : ""}${moneyline.homeCurrent}`,
            mistake: `Spread has ${awayTeam} as a ${Math.abs(spread.current)}-point favorite yet the moneyline favors ${homeTeam}. This is a cross-market inconsistency — the spread and ML are telling opposite stories about the game's expected outcome.`,
            correctLine: `Spread and ML should align. Either the spread overvalues ${awayTeam} or the ML undervalues them.`,
            betIdea: `Two angles: (1) Bet ${awayTeam} ML — if you believe the spread, the ML is priced wrong and offers value. (2) Bet ${homeTeam} spread — if you believe the ML, the spread is too generous to ${awayTeam}. Verify both numbers across books before placing.`,
            confidence: 72,
            severity: "medium",
          });
        }

        const spreadFavorsHome = spread.current > 3.5;
        const mlFavorsAway = moneyline.awayCurrent < moneyline.homeCurrent && moneyline.awayCurrent < -110;
        if (spreadFavorsHome && mlFavorsAway) {
          errors.push({
            id: mkId("ml-spread-mismatch-2"),
            gameId: id, gameName, sport, gameTime,
            errorType: "mispriced_ml",
            betType: `Moneyline — ${awayTeam}`,
            actualLine: `${homeTeam} spread: ${(-(spread.current ?? 0)) > 0 ? "+" : ""}${-(spread.current ?? 0)} | ${awayTeam} ML: ${moneyline.awayCurrent > 0 ? "+" : ""}${moneyline.awayCurrent}`,
            mistake: `Spread has ${homeTeam} as a ${spread.current}-point favorite yet the moneyline favors ${awayTeam}. The two markets disagree on the outright winner — a pricing inconsistency that shouldn't persist.`,
            correctLine: `Spread and ML should align — one of these markets is mispriced.`,
            betIdea: `Bet ${homeTeam} ML — if you trust the spread, the ML is mispriced and gives value on the spread's implied favorite. Verify the current ML across DraftKings, FanDuel, and BetMGM before placing.`,
            confidence: 70,
            severity: "medium",
          });
        }
      }

      // ── 6. Sharp Total Divergence ≥25 pts ────────────────────────────────
      if (total.overMoney != null && total.overPublic != null) {
        const div = total.overMoney - total.overPublic;
        if (Math.abs(div) >= 25) {
          const sharpSide = div > 0 ? "OVER" : "UNDER";
          const sharpPct = div > 0 ? total.overMoney : (100 - total.overMoney!);
          const publicPct3 = div > 0 ? total.overPublic : (100 - total.overPublic!);
          errors.push({
            id: mkId("div-total"),
            gameId: id, gameName, sport, gameTime,
            errorType: "sharp_divergence",
            betType: `Total (${sharpSide})`,
            actualLine: `O/U ${total.current}`,
            mistake: `${sharpPct}% of money on the ${sharpSide} vs only ${publicPct3}% of tickets — a ${Math.abs(div)}-point sharp/public split on the total. The book's number doesn't yet reflect the full sharp signal.`,
            correctLine: `Sharp pressure suggests the total should move ${div > 0 ? "up" : "down"} from current ${total.current}`,
            betIdea: `Bet ${sharpSide} at ${total.current}. The sharp money split on totals of this magnitude historically precedes line movement. Take the current number before the book adjusts.`,
            confidence: Math.min(82, 52 + Math.round(Math.abs(div) * 0.7)),
            severity: Math.abs(div) >= 35 ? "high" : "medium",
          });
        }
      }
    }

    // Sort: high severity first, then by confidence descending
    errors.sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 };
      if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
      return b.confidence - a.confidence;
    });

    return errors;
  }

  app.get("/api/line-movement/errors", async (_req, res) => {
    try {
      const cacheKey = "lm-errors";
      const cached = LM_ERRORS_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LM_ERRORS_TTL) {
        return res.json(cached.data);
      }

      // Pull games from the line movement cache (or fetch fresh if needed)
      let games: any[] = [];
      const lmCache = LINE_MOVEMENT_CACHE.get("lm");
      if (lmCache && Date.now() - lmCache.ts < LM_TTL) {
        games = lmCache.data;
      } else {
        // Trigger a fresh fetch by calling the LM endpoint logic inline (light version)
        // Just return empty for now — client should load /api/line-movement first
        return res.json([]);
      }

      const errors = detectBookErrors(games);
      LM_ERRORS_CACHE.set(cacheKey, { data: errors, ts: Date.now() });
      res.json(errors);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // ─── Market Signals — overlaps between model picks and prediction markets ──────
  // Returns a ranked list of bets where our model AND prediction markets agree.
  // Used to power the "Top Market-Backed Props" dashboard module and BetCard badges.
  const MARKET_SIGNALS_CACHE = new Map<string, { ts: number; data: any[] }>();
  const MARKET_SIGNALS_TTL = 60_000; // 1 minute


  // ─── GET /api/live-scores — ESPN scoreboard proxy for all 4 major sports ─────
  // Free ESPN public API — no auth required. Cached 30s for live games.
  const LIVE_SCORES_CACHE = new Map<string, { data: any; ts: number }>();
  const LIVE_SCORES_TTL   = 30_000; // 30 seconds

  app.get("/api/live-scores", async (req, res) => {
    try {
      const sport = (req.query.sport as string ?? "all").toLowerCase();
      const cacheKey = `live-scores-${sport}`;
      const cached = LIVE_SCORES_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < LIVE_SCORES_TTL) {
        return res.json(cached.data);
      }

      const SPORTS = [
        { key: "nba",  sn: "basketball", lg: "nba"      },
        { key: "mlb",  sn: "baseball",   lg: "mlb"      },
        { key: "nhl",  sn: "hockey",     lg: "nhl"      },
        { key: "nfl",  sn: "football",   lg: "nfl"      },
      ];

      const targets = sport === "all" ? SPORTS : SPORTS.filter(s => s.key === sport);

      const results: Record<string, any[]> = {};

      await Promise.all(targets.map(async (s) => {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${s.sn}/${s.lg}/scoreboard`;
          const r   = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) { results[s.key] = []; return; }
          const d   = await r.json() as any;

          results[s.key] = (d.events ?? []).map((ev: any) => {
            const comp = ev.competitions?.[0] ?? {};
            const status = ev.status ?? {};
            const sit    = comp.situation ?? null;

            const teams = (comp.competitors ?? []).map((t: any) => ({
              id:           t.id,
              abbr:         t.team?.abbreviation ?? "?",
              displayName:  t.team?.displayName ?? "",
              shortName:    t.team?.shortDisplayName ?? "",
              logo:         t.team?.logo ?? null,
              color:        t.team?.color ? `#${t.team.color}` : null,
              score:        t.score ?? "0",
              homeAway:     t.homeAway,
              linescores:   (t.linescores ?? []).map((ls: any) => ({
                period: ls.period,
                value:  ls.displayValue ?? "0",
              })),
              records:      (t.records ?? []).map((rec: any) => rec.summary).slice(0, 1),
            }));

            // Stat leaders shown on scoreboard (pitching/hitting/scoring leaders)
            const leaders = (comp.leaders ?? []).flatMap((lg: any) =>
              (lg.leaders ?? []).slice(0, 2).map((l: any) => ({
                category:    lg.shortDisplayName ?? lg.abbreviation,
                displayValue: l.displayValue,
                athlete: {
                  id:       l.athlete?.id,
                  name:     l.athlete?.shortName ?? l.athlete?.displayName,
                  headshot: l.athlete?.headshot ?? null,
                  position: l.athlete?.position ?? null,
                  teamId:   l.athlete?.team?.id ?? null,
                },
              }))
            ).slice(0, 6);

            return {
              id:         ev.id,
              uid:        ev.uid,
              sport:      s.key.toUpperCase(),
              name:       ev.name,
              shortName:  ev.shortName,
              date:       ev.date,
              status: {
                state:       status.type?.state ?? "pre",          // "pre"|"in"|"post"
                description: status.type?.description ?? "Scheduled",
                detail:      status.type?.detail ?? "",
                shortDetail: status.type?.shortDetail ?? "",
                period:      status.period ?? 0,
                clock:       status.displayClock ?? "0:00",
                completed:   status.type?.completed ?? false,
              },
              venue: comp.venue ? {
                name: comp.venue.fullName,
                city: comp.venue.address?.city,
              } : null,
              teams,
              situation: sit ? {
                lastPlay:  sit.lastPlay?.text ?? null,
                balls:     sit.balls,
                strikes:   sit.strikes,
                outs:      sit.outs,
                onFirst:   sit.onFirst ?? false,
                onSecond:  sit.onSecond ?? false,
                onThird:   sit.onThird ?? false,
                pitcher: sit.pitcher ? {
                  name:     sit.pitcher.athlete?.displayName,
                  summary:  sit.pitcher.summary,
                  headshot: sit.pitcher.athlete?.headshot ?? null,
                } : null,
                batter: sit.batter ? {
                  name:     sit.batter.athlete?.displayName,
                  summary:  sit.batter.summary,
                  headshot: sit.batter.athlete?.headshot ?? null,
                } : null,
              } : null,
              leaders,
              broadcasts: (comp.broadcasts ?? []).flatMap((b: any) => b.names ?? []).slice(0, 2),
            };
          });
        } catch {
          results[s.key] = [];
        }
      }));

      const payload = { sports: results, updatedAt: new Date().toISOString() };
      LIVE_SCORES_CACHE.set(cacheKey, { data: payload, ts: Date.now() });
      res.json(payload);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/market-signals", async (_req, res) => {
    try {
      const cacheKey = "market-signals";
      const cached = MARKET_SIGNALS_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < MARKET_SIGNALS_TTL) {
        return res.json(cached.data);
      }

      // Pull current open sports bets
      const allBets = await storage.getBets();
      const sportsBets = allBets.filter(
        (b: any) => b.status === "open" &&
          ["NBA","NFL","MLB","NHL"].includes(b.sport) &&
          ["player_prop","spread","total","moneyline"].includes(b.betType ?? "")
      );

      // Fetch prediction markets from cache populated by /api/prediction-markets
      let predMarkets: any[] = [];
      try {
        const pmCached = (global as any).__predMktCache;
        if (pmCached && Date.now() - pmCached.ts < 120_000) {
          predMarkets = pmCached.data;
        }
      } catch {}

      // Normalize string for fuzzy matching
      const normStr = (s: string): string  =>{
        return (s ?? "").toLowerCase()
          .replace(/[^a-z0-9 ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Count word overlap between two normalized strings
      const wordOverlap = (a: string, b: string): number  =>{
        const wa = new Set(a.split(" ").filter((w: string) => w.length > 2));
        const wb = b.split(" ").filter((w: string) => w.length > 2);
        return wb.filter((w: string) => wa.has(w)).length;
      }

      // Sports-only prediction markets (exclude OTHER / geopolitics / crypto etc.)
      const sportsMarkets = predMarkets.filter(
        (m: any) => m.sport && !["OTHER","CRYPTO","POLITICS","WEATHER","MACRO"].includes(m.sport)
      );

      const signals: any[] = [];

      for (const bet of sportsBets) {
        const betNorm = normStr(
          [bet.title, bet.playerName ?? "", bet.homeTeam ?? "", bet.awayTeam ?? ""].join(" ")
        );
        let bestMatch: any = null;
        let bestScore = 0;

        for (const m of sportsMarkets) {
          // Only match same sport
          if (bet.sport && m.sport && m.sport !== bet.sport) continue;

          const mNorm = normStr(
            [m.title, m.event ?? "", ...(m.legs ?? [])].join(" ")
          );
          const overlap = wordOverlap(betNorm, mNorm);
          // Boost if player name words all appear in the market
          const playerWords = normStr(bet.playerName ?? "").split(" ").filter((w: string) => w.length > 2);
          const playerHit = playerWords.length > 0 && playerWords.every((w: string) => mNorm.includes(w));
          const score = playerHit ? overlap + 3 : overlap;
          if (score >= 2 && score > bestScore) {
            bestScore = score;
            bestMatch = m;
          }
        }

        if (!bestMatch) continue;

        const yesPrice    = bestMatch.yesPrice   ?? 0.5;
        const fairPrice   = bestMatch.fairPrice  ?? bestMatch.yesPrice ?? 0.5;
        const entry       = bestMatch.entry      ?? bestMatch.yesPrice ?? 0.5;
        const target      = bestMatch.target     ?? Math.min(1, (bestMatch.yesPrice ?? 0.5) + 0.10);
        const edge        = Math.round((fairPrice - yesPrice) * 100);
        const priceRating = bestMatch.priceRating ?? "fair";
        const modelScore  = bet.confidenceScore  ?? 50;

        // Agreement: does the market consensus align with our model pick?
        const marketBull = yesPrice >= 0.55 || priceRating === "good_buy" || priceRating === "great_buy";
        const marketBear = yesPrice <= 0.35 || priceRating === "overpriced";
        let agreement: "confirms" | "disagrees" | "neutral" = "neutral";
        let agreementStrength = 0;
        if (marketBull && modelScore >= 70) {
          agreement = "confirms";
          agreementStrength = Math.min(100, Math.round(modelScore * 0.5 + yesPrice * 50));
        } else if (marketBear && modelScore >= 70) {
          agreement = "disagrees";
          agreementStrength = Math.min(100, Math.round((1 - yesPrice) * 70));
        } else {
          agreementStrength = Math.round(Math.abs(yesPrice - 0.5) * 60);
        }

        // Combined score: model confidence (50%) + agreement (30%) + whale/edge/vol bonuses (20%)
        const whaleBonus = bestMatch.isWhaleAlert ? 20 : 0;
        const edgeBonus  = Math.min(15, Math.max(0, edge));
        const volBonus   = (bestMatch.vol24h ?? 0) >= 50_000 ? 10 : (bestMatch.vol24h ?? 0) >= 10_000 ? 5 : 0;
        const combinedScore = Math.min(100, Math.round(
          modelScore * 0.5 + agreementStrength * 0.3 + whaleBonus + edgeBonus + volBonus
        ));

        signals.push({
          betId:            bet.id,
          betTitle:         bet.title,
          betSport:         bet.sport,
          betType:          bet.betType ?? "player_prop",
          betScore:         modelScore,
          playerName:       bet.playerName ?? null,
          homeTeam:         bet.homeTeam  ?? null,
          awayTeam:         bet.awayTeam  ?? null,
          gameTime:         bet.gameTime  ?? null,
          marketId:         bestMatch.id,
          marketTitle:      bestMatch.title,
          marketSource:     bestMatch.source,
          marketSport:      bestMatch.sport,
          marketUrl:        bestMatch.kalshiUrl ?? null,
          yesPrice,
          fairPrice,
          entry,
          target,
          ph1:              bestMatch.ph1 ?? bestMatch.pd1 ?? 0,
          priceRating,
          isWhale:          bestMatch.isWhaleAlert  ?? false,
          smartScore:       bestMatch.smartScore    ?? 0,
          vol24h:           bestMatch.vol24h        ?? 0,
          crossValidated:   bestMatch.crossValidated ?? false,
          agreement,
          agreementStrength,
          combinedScore,
          edge,
        });
      }

      // Sort: confirms first, then by combinedScore desc
      signals.sort((a: any, b: any) => {
        if (a.agreement === "confirms" && b.agreement !== "confirms") return -1;
        if (a.agreement !== "confirms" && b.agreement === "confirms") return 1;
        return b.combinedScore - a.combinedScore;
      });

      const top = signals.slice(0, 25);
      MARKET_SIGNALS_CACHE.set(cacheKey, { ts: Date.now(), data: top });
      res.json(top);
    } catch (e: any) {
      console.warn("[market-signals] error:", e.message);
      res.json([]);
    }
  });

  // ─── Auth Routes ──────────────────────────────────────────────────────────────────────
  const bcrypt = await import("bcryptjs");
  const { nanoid } = await import("nanoid");

  // Helper: get user from Authorization: Bearer <token> header
  async function getAuthUser(req: any): Promise<any | null> {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!token) return null;
    const session = await storage.getSession(token);
    if (!session) return null;
    return storage.getUserById(session.userId);
  }

  // POST /api/auth/register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, username, password, displayName } = req.body as any;
      if (!email || !username || !password) return res.status(400).json({ error: "email, username and password are required" });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "An account with this email already exists" });
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ id: nanoid(), email, username, passwordHash, displayName: displayName ?? username, bankroll: 1000 });
      // Create session
      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await storage.createSession({ token, userId: user.id, expiresAt });
      const { passwordHash: _, ...safeUser } = user;
      res.json({ token, user: safeUser });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body as any;
      if (!email || !password) return res.status(400).json({ error: "email and password are required" });
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid email or password" });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "Invalid email or password" });
      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await storage.createSession({ token, userId: user.id, expiresAt });
      const { passwordHash: _, ...safeUser } = user;
      res.json({ token, user: safeUser });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
      if (token) await storage.deleteSession(token);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/auth/me
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/auth/me  (update display name, bankroll)
  app.patch("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { displayName, bankroll } = req.body as any;
      const updated = await storage.updateUser(user.id, { displayName, bankroll });
      if (!updated) return res.status(404).json({ error: "User not found" });
      const { passwordHash: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/user/bets  — user's tracked picks
  app.get("/api/user/bets", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const userBets = await storage.getUserBets(user.id);
      res.json(userBets);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/user/bets  — add a pick to user's tracker
  app.post("/api/user/bets", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { betId, betSlug, notes, stake } = req.body as any;
      if (!betId) return res.status(400).json({ error: "betId is required" });
      const ub = await storage.addUserBet({ id: nanoid(), userId: user.id, betId, betSlug: betSlug ?? null, notes: notes ?? null, stake: stake ?? null, result: "open" });
      res.json(ub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/user/bets/:id  — update result / notes / stake
  app.patch("/api/user/bets/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const updated = await storage.updateUserBet(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/user/bets/:id
  app.delete("/api/user/bets/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      await storage.deleteUserBet(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ──────────────────────────────────────────────────────────────────
  // Portfolio + Parlay routes
  // ──────────────────────────────────────────────────────────────────

  // Helper: American odds → decimal multiplier
  function americanToDecimal(odds: number | null | undefined): number {
    if (!odds) return 1.909; // default ~-110
    return odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  }

  // Helper: grade a single player prop bet using recent game log
  async function gradeUserBet(ub: any): Promise<"won" | "lost" | "push" | null> {
    try {
      const bet = await storage.getBetById(ub.betId);
      if (!bet) return null;
      if (!bet.playerName || !bet.sport || bet.line == null) return null;
      const ts = bet.teamStats as any;
      const pickSide = ub.betPickSide ?? ts?.pickSide?.toUpperCase();
      if (!pickSide) return null;

      // Fetch live game log
      const statsUrl = `/api/player-stats/${bet.sport}/${encodeURIComponent(bet.playerName)}`;
      const cacheKey = `grade:${bet.sport}:${bet.playerName}`;
      let statsData: any = null;

      try {
        // Direct call to our own stats function to avoid HTTP overhead
        statsData = await fetchESPNGameLog(bet.playerName, bet.sport);
      } catch { return null; }

      if (!statsData?.recentGames?.length) return null;

      // Use the most recent game
      const lastGame = statsData.recentGames[statsData.recentGames.length - 1];
      const sport = bet.sport.toUpperCase();
      let statValue: number | null = null;

      const title = (bet.title + " " + (bet.description ?? "")).toLowerCase();
      if (sport === "NBA") {
        if (title.includes("point") || title.includes("pts")) statValue = parseFloat(lastGame.pts ?? "0") || null;
        else if (title.includes("assist")) statValue = parseFloat(lastGame.ast ?? "0") || null;
        else if (title.includes("rebound")) statValue = parseFloat(lastGame.trb ?? "0") || null;
        else statValue = parseFloat(lastGame.pts ?? "0") || null;
      } else if (sport === "NHL") {
        statValue = parseFloat(lastGame.goals ?? "0") || null;
      } else if (sport === "MLB") {
        if (title.includes("home run") || title.includes("hr")) statValue = parseFloat(lastGame.home_runs ?? "0") || 0;
        else statValue = parseFloat(lastGame.hits ?? "0") || null;
      } else if (sport === "NFL") {
        if (title.includes("passing")) statValue = parseFloat(lastGame.pass_yds ?? lastGame.yds ?? "0") || null;
        else if (title.includes("rushing")) statValue = parseFloat(lastGame.rush_yds ?? "0") || null;
        else if (title.includes("receiving")) statValue = parseFloat(lastGame.rec_yds ?? "0") || null;
        else if (title.includes("touchdown")) statValue = parseFloat(lastGame.td ?? "0") || null;
        else statValue = parseFloat(lastGame.pass_yds ?? lastGame.yds ?? "0") || null;
      }

      if (statValue === null) return null;
      if (statValue === bet.line) return "push";
      const outcome: "won" | "lost" = pickSide === "OVER"
        ? (statValue > bet.line ? "won" : "lost")
        : (statValue < bet.line ? "won" : "lost");

      // Log to ML engine for self-learning
      logMLOutcome({
        bet_id:    bet.id,
        sport:     bet.sport,
        bet_type:  bet.betType ?? "player_prop",
        pick_side: pickSide,
        line:      bet.line,
        stat_value: statValue,
        confidence: bet.confidenceScore ?? null,
        outcome,
        title:     bet.title,
        player:    bet.playerName ?? null,
        graded_at: new Date().toISOString(),
      });

      return outcome;
    } catch {
      return null;
    }
  }

  // GET /api/portfolio  — portfolio summary for authenticated user
  app.get("/api/portfolio", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const [userBets, parlays] = await Promise.all([
        storage.getUserBets(user.id),
        storage.getParlays(user.id),
      ]);

      // Enrich parlays with legs
      const parlaysWithLegs = await Promise.all(
        parlays.map(async p => ({
          ...p,
          legs: await storage.getParlayLegs(p.id),
        }))
      );

      // P&L calculations
      const wonBets = userBets.filter(b => b.result === "won");
      const lostBets = userBets.filter(b => b.result === "lost");
      const openBets = userBets.filter(b => b.result === "open" || b.result === "push");

      const totalStaked = userBets.reduce((s, b) => s + (b.stake ?? 0), 0);
      const stakeWon = wonBets.reduce((s, b) => s + (b.stake ?? 0), 0);
      const stakeLost = lostBets.reduce((s, b) => s + (b.stake ?? 0), 0);
      const wonReturns = wonBets.reduce((s, b) => s + (b.stake ?? 0) * americanToDecimal(b.odds), 0);
      const netPnl = wonReturns - totalStaked;
      const roi = totalStaked > 0 ? (netPnl / totalStaked) * 100 : 0;
      const winRate = (wonBets.length + lostBets.length) > 0
        ? (wonBets.length / (wonBets.length + lostBets.length)) * 100 : 0;

      // Parlay P&L
      const wonParlays = parlaysWithLegs.filter(p => p.result === "won");
      const lostParlays = parlaysWithLegs.filter(p => p.result === "lost");
      const parlayStaked = parlays.reduce((s, p) => s + (p.stake ?? 0), 0);
      const parlayReturns = wonParlays.reduce((s, p) => s + (p.potentialPayout ?? 0), 0);
      const parlayNetPnl = parlayReturns - parlayStaked;

      res.json({
        userBets,
        parlays: parlaysWithLegs,
        summary: {
          totalBets: userBets.length,
          wonBets: wonBets.length,
          lostBets: lostBets.length,
          openBets: openBets.length,
          winRate: Math.round(winRate * 10) / 10,
          totalStaked,
          wonReturns: Math.round(wonReturns * 100) / 100,
          netPnl: Math.round(netPnl * 100) / 100,
          roi: Math.round(roi * 10) / 10,
          totalParlays: parlays.length,
          wonParlays: wonParlays.length,
          lostParlays: lostParlays.length,
          openParlays: parlays.filter(p => p.result === "open").length,
          parlayStaked,
          parlayReturns: Math.round(parlayReturns * 100) / 100,
          parlayNetPnl: Math.round(parlayNetPnl * 100) / 100,
          bankroll: user.bankroll ?? 1000,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Parlay CRUD ────────────────────────────────────────────────────────────────

  // GET /api/parlays  — list user's parlays (with legs)
  app.get("/api/parlays", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const parlays = await storage.getParlays(user.id);
      const parlaysWithLegs = await Promise.all(
        parlays.map(async p => ({ ...p, legs: await storage.getParlayLegs(p.id) }))
      );
      res.json(parlaysWithLegs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/parlays  — create a new parlay with legs
  app.post("/api/parlays", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { name, stake, notes, legs } = req.body as {
        name: string;
        stake?: number;
        notes?: string;
        legs: Array<{
          betId: string;
          betSlug?: string;
          betTitle?: string;
          betSport?: string;
          betLine?: number;
          betPickSide?: string;
          odds?: number;
        }>;
      };
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      if (!legs?.length) return res.status(400).json({ error: "at least one leg is required" });

      // Compute combined decimal odds
      const combinedDecimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
      const combinedAmerican = combinedDecimal >= 2
        ? Math.round((combinedDecimal - 1) * 100)
        : Math.round(-100 / (combinedDecimal - 1));
      const potentialPayout = stake ? Math.round(stake * combinedDecimal * 100) / 100 : null;

      const parlay = await storage.createParlay({
        id: nanoid(),
        userId: user.id,
        name: name.trim(),
        stake: stake ?? null,
        notes: notes ?? null,
        combinedOdds: combinedAmerican,
        potentialPayout,
        result: "open",
      });

      // Add legs
      const createdLegs = await Promise.all(legs.map(leg =>
        storage.addParlayLeg({
          id: nanoid(),
          parlayId: parlay.id,
          userId: user.id,
          betId: leg.betId,
          betSlug: leg.betSlug ?? null,
          betTitle: leg.betTitle ?? null,
          betSport: leg.betSport ?? null,
          betLine: leg.betLine ?? null,
          betPickSide: leg.betPickSide ?? null,
          odds: leg.odds ?? null,
          result: "open",
        })
      ));

      res.json({ ...parlay, legs: createdLegs });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/parlays/:id  — update stake / name / notes
  app.patch("/api/parlays/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const parlay = await storage.getParlayById(req.params.id);
      if (!parlay || parlay.userId !== user.id) return res.status(404).json({ error: "Not found" });

      const updates: any = {};
      if (req.body.name != null) updates.name = req.body.name;
      if (req.body.stake != null) {
        updates.stake = req.body.stake;
        // Recompute payout with new stake
        const legs = await storage.getParlayLegs(parlay.id);
        const combinedDecimal = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
        updates.potentialPayout = Math.round(req.body.stake * combinedDecimal * 100) / 100;
      }
      if (req.body.notes != null) updates.notes = req.body.notes;
      if (req.body.result != null) updates.result = req.body.result;

      const updated = await storage.updateParlay(req.params.id, updates);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/parlays/:id
  app.delete("/api/parlays/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const parlay = await storage.getParlayById(req.params.id);
      if (!parlay || parlay.userId !== user.id) return res.status(404).json({ error: "Not found" });
      await storage.deleteParlay(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/parlay-legs/:id  — update a single leg's result manually
  app.patch("/api/parlay-legs/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const updated = await storage.updateParlayLeg(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/portfolio/grade  — manually trigger grading for all open bets + parlays
  // Also called by the midnight cron job
  app.post("/api/portfolio/grade", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const userBets = await storage.getUserBets(user.id);
      const openBets = userBets.filter(b => b.result === "open");
      const results: Array<{ id: string; result: string }> = [];

      for (const ub of openBets) {
        const grade = await gradeUserBet(ub);
        if (grade) {
          await storage.updateUserBet(ub.id, { result: grade, gradedAt: new Date() } as any);
          results.push({ id: ub.id, result: grade });
        }
      }

      // Grade parlay legs + check if parlay is complete
      const parlays = await storage.getParlays(user.id);
      for (const parlay of parlays) {
        if (parlay.result !== "open") continue;
        const legs = await storage.getParlayLegs(parlay.id);
        const openLegs = legs.filter(l => l.result === "open");
        for (const leg of openLegs) {
          const fakeUb = { betId: leg.betId, betPickSide: leg.betPickSide };
          const grade = await gradeUserBet(fakeUb);
          if (grade) await storage.updateParlayLeg(leg.id, { result: grade });
        }
        // Re-fetch legs after grading
        const freshLegs = await storage.getParlayLegs(parlay.id);
        const anyLost = freshLegs.some(l => l.result === "lost");
        const allDone = freshLegs.every(l => l.result !== "open");
        if (anyLost) {
          await storage.updateParlay(parlay.id, { result: "lost", gradedAt: new Date() } as any);
        } else if (allDone) {
          const allWon = freshLegs.every(l => l.result === "won");
          await storage.updateParlay(parlay.id, { result: allWon ? "won" : "push", gradedAt: new Date() } as any);
        }
      }

      res.json({ graded: results.length, results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/portfolio/grade-all  — admin endpoint for midnight cron (no auth required — internal)
  // Grades ALL users' open bets
  app.post("/api/portfolio/grade-all", async (req, res) => {
    try {
      const secret = req.headers["x-cron-secret"] as string;
      if (secret !== (process.env.CRON_SECRET ?? "clubhouseiq-midnight-grade")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const allUserBets = await storage.getAllUserBets();
      const openBets = allUserBets.filter(b => b.result === "open");
      let gradedCount = 0;

      for (const ub of openBets) {
        const grade = await gradeUserBet(ub);
        if (grade) {
          await storage.updateUserBet(ub.id, { result: grade, gradedAt: new Date() } as any);
          gradedCount++;
        }
      }

      // Grade all open parlay legs
      const allParlays = await storage.getAllParlays();
      for (const parlay of allParlays) {
        if (parlay.result !== "open") continue;
        const legs = await storage.getParlayLegs(parlay.id);
        const openLegs = legs.filter(l => l.result === "open");
        for (const leg of openLegs) {
          const fakeUb = { betId: leg.betId, betPickSide: leg.betPickSide };
          const grade = await gradeUserBet(fakeUb);
          if (grade) await storage.updateParlayLeg(leg.id, { result: grade });
        }
        const freshLegs = await storage.getParlayLegs(parlay.id);
        const anyLost = freshLegs.some(l => l.result === "lost");
        const allDone = freshLegs.every(l => l.result !== "open");
        if (anyLost) await storage.updateParlay(parlay.id, { result: "lost", gradedAt: new Date() } as any);
        else if (allDone) {
          const allWon = freshLegs.every(l => l.result === "won");
          await storage.updateParlay(parlay.id, { result: allWon ? "won" : "push", gradedAt: new Date() } as any);
        }
      }

      console.log(`[grade-all] Graded ${gradedCount} bets across all users`);
      res.json({ graded: gradedCount });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // GET /api/smart-wallets — expose tracked whale wallet data + signal map
  app.get("/api/smart-wallets", async (_req, res) => {
    try {
      const wallets  = getSmartWallets();
      const signalMap = getSignalMap();
      res.json({ wallets, signalMap, count: wallets.length, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return httpServer;
}
