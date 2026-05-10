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
        whop_membership_id TEXT DEFAULT NULL,
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
    // ── User personalization preferences (sport/team/player favorites) ────────
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb`);

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
    // Payment migration columns (kept for backwards compat, no active payment processor)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_membership_id TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_sub_id TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gumroad_sale_id TEXT DEFAULT NULL`);

    // ── BTS Picks (persistent across redeploys — source of truth) ──────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bts_picks (
        id          SERIAL PRIMARY KEY,
        pick_date   TEXT NOT NULL,          -- "YYYY-MM-DD"
        player_id   INT  NOT NULL,
        player_name TEXT NOT NULL,
        team        TEXT NOT NULL,
        hit_probability INT NOT NULL DEFAULT 0,
        locked_at   TEXT DEFAULT NULL,
        locked      BOOLEAN DEFAULT FALSE,
        result      TEXT DEFAULT 'pending', -- 'win'|'loss'|'pending'|'no_game'
        hits        INT DEFAULT NULL,
        ab          INT DEFAULT NULL,
        graded_at   TEXT DEFAULT NULL,
        snapshot    JSONB DEFAULT '{}'::jsonb,
        UNIQUE(pick_date, player_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS bts_picks_date_idx ON bts_picks(pick_date)`);

    // ── ML data store (key/value JSON blobs, survives redeploys) ─────────────
    // Replaces GitHub sync which requires GITHUB_TOKEN env var.
    // Each ML file is stored as a single row keyed by filename.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_data_store (
        filename    TEXT PRIMARY KEY,
        content     TEXT NOT NULL,       -- raw JSON string
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── The Book — paper sportsbook tables ─────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS book_accounts (
        id          SERIAL PRIMARY KEY,
        user_id     INT REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL DEFAULT 'Main Account',
        balance     NUMERIC(12,2) NOT NULL DEFAULT 10000.00,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_accounts_user_idx ON book_accounts(user_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS book_slips (
        id              SERIAL PRIMARY KEY,
        account_id      INT REFERENCES book_accounts(id) ON DELETE CASCADE,
        slip_type       TEXT NOT NULL DEFAULT 'single', -- 'single'|'parlay'|'round_robin'
        rr_parent_id    INT REFERENCES book_slips(id) ON DELETE CASCADE DEFAULT NULL,
        stake           NUMERIC(12,2) NOT NULL,
        potential_payout NUMERIC(12,2) NOT NULL,
        status          TEXT NOT NULL DEFAULT 'open', -- 'open'|'won'|'lost'|'push'|'void'
        placed_at       TIMESTAMPTZ DEFAULT NOW(),
        settled_at      TIMESTAMPTZ DEFAULT NULL,
        payout_received NUMERIC(12,2) DEFAULT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_slips_account_idx ON book_slips(account_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_slips_status_idx  ON book_slips(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_slips_rr_idx      ON book_slips(rr_parent_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS book_legs (
        id              SERIAL PRIMARY KEY,
        slip_id         INT REFERENCES book_slips(id) ON DELETE CASCADE,
        sport           TEXT NOT NULL,
        bet_type        TEXT NOT NULL,  -- 'moneyline'|'spread'|'total'|'prop'
        game_id         TEXT DEFAULT NULL,
        home_team       TEXT DEFAULT NULL,
        away_team       TEXT DEFAULT NULL,
        player_id       INT DEFAULT NULL,
        player_name     TEXT DEFAULT NULL,
        stat_type       TEXT DEFAULT NULL,  -- 'hits'|'strikeouts'|'pts' etc
        line            NUMERIC(8,2) DEFAULT NULL,
        over_under      TEXT DEFAULT NULL,  -- 'over'|'under' for props/totals
        pick_label      TEXT NOT NULL,      -- human label e.g. "LAD -1.5"
        odds_american   INT NOT NULL,       -- DraftKings snapshot e.g. -110
        game_date       TEXT NOT NULL,      -- YYYY-MM-DD
        game_time       TEXT DEFAULT NULL,
        result          TEXT DEFAULT 'pending', -- 'win'|'loss'|'push'|'void'|'pending'
        actual_value    NUMERIC(8,2) DEFAULT NULL, -- actual stat/score at grade
        graded_at       TIMESTAMPTZ DEFAULT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_legs_slip_idx    ON book_legs(slip_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_legs_date_idx    ON book_legs(game_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_legs_status_idx  ON book_legs(result)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS book_transactions (
        id          SERIAL PRIMARY KEY,
        account_id  INT REFERENCES book_accounts(id) ON DELETE CASCADE,
        amount      NUMERIC(12,2) NOT NULL,  -- positive=credit, negative=debit
        tx_type     TEXT NOT NULL,  -- 'deposit'|'stake'|'win'|'loss'|'push'|'void_refund'
        slip_id     INT REFERENCES book_slips(id) ON DELETE SET NULL DEFAULT NULL,
        note        TEXT DEFAULT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_tx_account_idx ON book_transactions(account_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS book_tx_slip_idx    ON book_transactions(slip_id)`);

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
