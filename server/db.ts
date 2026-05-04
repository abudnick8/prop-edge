import { Pool } from "pg";

// Railway injects DATABASE_URL automatically when Postgres addon is added.
// Falls back gracefully if not yet configured so the app still boots.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),

  // Convenience: return first row or null
  queryOne: async (text: string, params?: any[]) => {
    const result = await pool.query(text, params);
    return result.rows[0] ?? null;
  },
};

// ── Auto-migrations ── run on every boot, all idempotent ────────────────────
async function runMigrations() {
  try {
    // Core users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                SERIAL PRIMARY KEY,
        email             TEXT UNIQUE NOT NULL,
        pin_hash          TEXT NOT NULL,
        tier              TEXT DEFAULT NULL,
        stripe_customer_id TEXT DEFAULT NULL,
        stripe_sub_id     TEXT DEFAULT NULL,
        sub_status        TEXT DEFAULT 'inactive',
        is_owner          BOOLEAN DEFAULT FALSE,
        reset_token_hash  TEXT DEFAULT NULL,
        reset_token_expires TIMESTAMPTZ DEFAULT NULL,
        login_attempts    INT DEFAULT 0,
        locked_until      TIMESTAMPTZ DEFAULT NULL,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users(email)`);

    // Login & activity tracking columns (added later — safe to re-run)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count   INT          DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login     TIMESTAMPTZ  DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active    TIMESTAMPTZ  DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_code     TEXT         DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_expires  TIMESTAMPTZ  DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled    BOOLEAN      DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_plain      TEXT         DEFAULT NULL`);

    // ── Promo codes (Stripe discount codes) ──────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id           SERIAL PRIMARY KEY,
        code         TEXT UNIQUE NOT NULL,
        discount_pct INT NOT NULL,
        applies_to   TEXT DEFAULT 'both',
        max_uses     INT DEFAULT NULL,
        uses         INT DEFAULT 0,
        active       BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at   TIMESTAMPTZ DEFAULT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS promo_codes_code_idx ON promo_codes(code)`);
    // Migration: add duration_months if missing
    await pool.query(`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS duration_months INT DEFAULT NULL`);

    // ── Trial access codes ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trial_codes (
        id           SERIAL PRIMARY KEY,
        code         TEXT UNIQUE NOT NULL,
        duration_days INT DEFAULT 7,
        max_uses     INT DEFAULT NULL,
        uses         INT DEFAULT 0,
        active       BOOLEAN DEFAULT TRUE,
        note         TEXT DEFAULT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at   TIMESTAMPTZ DEFAULT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS trial_codes_code_idx ON trial_codes(code)`);

    // ── Trial code usage log ─────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trial_code_uses (
        id           SERIAL PRIMARY KEY,
        code         TEXT NOT NULL,
        email        TEXT NOT NULL,
        used_at      TIMESTAMPTZ DEFAULT NOW(),
        trial_expires TIMESTAMPTZ
      )
    `);

    // ── App settings (key/value) ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    // Seed default dev code if not already set
    await pool.query(`
      INSERT INTO app_settings (key, value) VALUES ('dev_code', 'ABUD')
      ON CONFLICT (key) DO NOTHING
    `);

    // ── Feature Flags ────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id          SERIAL PRIMARY KEY,
        key         TEXT UNIQUE NOT NULL,
        label       TEXT NOT NULL,
        enabled     BOOLEAN DEFAULT TRUE,
        min_tier    TEXT DEFAULT 'free',
        kill_switch BOOLEAN DEFAULT FALSE,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Seed default feature flags
    const defaultFlags = [
      ['dashboard',     'Dashboard',      true,  'basic',  false],
      ['props_hub',     'Props Hub',      true,  'basic',  false],
      ['lotto',         'Lotto',          true,  'basic',  false],
      ['top_plays',     'Top Plays',      true,  'pro',    false],
      ['all_picks',     'All Picks',      true,  'pro',    false],
      ['line_movement', 'Line Movement',  true,  'pro',    false],
      ['markets',       'Markets',        true,  'pro',    false],
      ['bracket',       'Bracket',        true,  'pro',    false],
      ['ml_intel',      'ML Intel',       true,  'pro',    false],
      ['bts',           'Beat the Streak',true,  'pro',    false],
      ['live_scores',   'Live Scores',    true,  'free',   false],
      ['fantasy',       'Fantasy',        true,  'free',   false],
    ];
    for (const [key, label, enabled, min_tier, kill_switch] of defaultFlags) {
      await pool.query(
        `INSERT INTO feature_flags (key,label,enabled,min_tier,kill_switch) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (key) DO NOTHING`,
        [key, label, enabled, min_tier, kill_switch]
      );
    }

    // ── Page events (tab usage tracking) ──────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_events (
        id         SERIAL PRIMARY KEY,
        user_id    INT REFERENCES users(id) ON DELETE SET NULL,
        page       TEXT NOT NULL,
        ts         TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS page_events_ts_idx ON page_events(ts)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS page_events_page_idx ON page_events(page)`);

    // ── API health log ─────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_health_log (
        id          SERIAL PRIMARY KEY,
        service     TEXT NOT NULL,
        status      TEXT NOT NULL,
        latency_ms  INT DEFAULT NULL,
        error       TEXT DEFAULT NULL,
        ts          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS api_health_log_ts_idx ON api_health_log(ts)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS api_health_log_service_idx ON api_health_log(service)`);

    // ── Audit log ─────────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id         SERIAL PRIMARY KEY,
        actor      TEXT NOT NULL,
        action     TEXT NOT NULL,
        target     TEXT DEFAULT NULL,
        detail     TEXT DEFAULT NULL,
        ts         TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts)`);

    // ── Flagged users column ───────────────────────────────────────────────────────
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_flagged  BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS flag_reason TEXT    DEFAULT NULL`);

    console.log("[DB] Migrations complete");
  } catch (err: any) {
    console.warn("[DB] Migration warning:", err.message);
  }
}

// Test connection on startup — non-fatal if DB not yet configured
pool.connect()
  .then(client => {
    console.log("[DB] PostgreSQL connected");
    client.release();
    runMigrations();
  })
  .catch(err => {
    console.warn("[DB] PostgreSQL not available (expected until Railway Postgres addon added):", err.message);
  });

export default pool;
