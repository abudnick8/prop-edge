-- Run this once in Railway's Postgres console after adding the Postgres addon
-- Railway Dashboard → Your Project → Postgres → Connect → Query

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  pin_hash            TEXT NOT NULL,
  tier                TEXT DEFAULT NULL,         -- 'basic' | 'pro' | null
  stripe_customer_id  TEXT DEFAULT NULL,
  stripe_sub_id       TEXT DEFAULT NULL,
  sub_status          TEXT DEFAULT 'inactive',   -- 'active' | 'cancelled' | 'past_due' | 'inactive'
  is_owner            BOOLEAN DEFAULT FALSE,
  reset_token_hash    TEXT DEFAULT NULL,          -- bcrypt hash of PIN reset token
  reset_token_expires TIMESTAMPTZ DEFAULT NULL,
  login_attempts      INT DEFAULT 0,
  locked_until        TIMESTAMPTZ DEFAULT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast email lookups on every login
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- Set owner flag for the app owner
-- Run this separately after creating your account:
-- UPDATE users SET is_owner = true, tier = 'pro', sub_status = 'active'
-- WHERE email = 'adam.budnick8@gmail.com';
