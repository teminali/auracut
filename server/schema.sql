-- ═══════════════════════════════════════════════════════════════════
-- Kerf Store — D1 schema.
--
-- The editor is free and open source; the skills are the product
-- (HANDOVER §6). This database is the record of who owns which skill,
-- and it exists because that record cannot live in the client: Kerf is
-- MIT-licensed and its recents already sit in localStorage, where a
-- `paid: true` is a ten-second edit.
--
-- Money is INTEGER minor units in the row's own currency. TZS has no
-- practical subunit, so a TZS row is whole shillings; a USD row would
-- be cents. Never a float — 0.1 + 0.2 in a ledger is how you get a
-- reconciliation that never closes.
-- ═══════════════════════════════════════════════════════════════════

-- ── Accounts ───────────────────────────────────────────────────────
-- Identity comes from an OAuth device flow (Google or GitHub), so the
-- only credential stored here is the provider's stable subject id.
-- There is no password column on purpose: a password we never take is
-- a password we can never leak.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,             -- 'google' | 'github'
  provider_sub  TEXT NOT NULL,             -- stable id at that provider
  email         TEXT,
  name          TEXT,
  avatar_url    TEXT,
  -- Collected at first checkout, not at sign-up: the phone is the
  -- payment instrument, and asking for it before there is anything to
  -- buy is the friction that loses the account.
  msisdn        TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (provider, provider_sub)
);

-- ── Sessions ───────────────────────────────────────────────────────
-- Opaque bearer tokens, stored as SHA-256 so a database read does not
-- hand over live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── Device-flow authorisations ─────────────────────────────────────
-- Kerf never sees the provider's device_code, and the provider's client
-- secret never leaves this Worker. Kerf polls US; we poll the provider.
CREATE TABLE IF NOT EXISTS device_auths (
  id                  TEXT PRIMARY KEY,   -- the code WE hand to Kerf
  provider            TEXT NOT NULL,
  provider_device_code TEXT NOT NULL,
  user_code           TEXT NOT NULL,
  verification_uri    TEXT NOT NULL,
  interval_s          INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  -- 'pending' | 'complete' | 'denied' | 'expired'
  status              TEXT NOT NULL DEFAULT 'pending',
  user_id             TEXT REFERENCES users(id),
  last_polled_at      INTEGER NOT NULL DEFAULT 0,
  -- Counted for rate limiting. Each start costs a round trip to Google
  -- or GitHub against OUR OAuth quota, so it is the cheapest endpoint
  -- to abuse and the most expensive one to have abused.
  created_ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_auths_ip ON device_auths(created_ip, created_at);

-- ── Catalogue ──────────────────────────────────────────────────────
-- Price lives HERE and not in skill.json, because a price changes
-- without the skill changing and a price baked into a package is a
-- price you cannot correct.
CREATE TABLE IF NOT EXISTS skills (
  id             TEXT PRIMARY KEY,        -- matches skill.json `id`
  name           TEXT NOT NULL,
  summary        TEXT NOT NULL,
  description    TEXT,
  author_name    TEXT NOT NULL,
  author_user_id TEXT REFERENCES users(id),
  -- §6: one-time purchase is PER MAJOR VERSION. Entitlement is granted
  -- against this number, so 1.x updates are free and 2.0 is a new sale.
  major_version  INTEGER NOT NULL DEFAULT 1,
  latest_version TEXT NOT NULL,           -- full semver of the newest build
  tool_api       INTEGER NOT NULL,        -- skill.json `toolApi`
  price_amount   INTEGER NOT NULL,        -- 0 == free, and free really is free
  price_currency TEXT NOT NULL DEFAULT 'TZS',
  poster_url     TEXT,
  preview_url    TEXT,
  -- Included skills may publish their manifest publicly because the
  -- app already ships them. Paid skill manifests remain entitlement-gated.
  included       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft|published|delisted
  -- No skill publishes without a verification run that passed against a
  -- fresh project (§6). This is that run's record, and `status` cannot
  -- become 'published' with it null.
  verified_at    INTEGER,
  verified_build TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,

  -- §6: "If it does not run, it does not publish." That was a comment
  -- and a comment is not an enforcement — so it is a CHECK, which no
  -- code path can route around and no future admin screen can forget.
  -- A skill with no verification run cannot be marked published, and
  -- clearing `verified_at` on a published row fails too.
  CHECK (status != 'published' OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);

CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id     TEXT NOT NULL REFERENCES skills(id),
  version      TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  tool_api     INTEGER NOT NULL,
  -- The independently updateable settings/recipe layer. Package bytes
  -- remain in R2; this JSON can update without replacing the app.
  manifest_json TEXT,
  released_at  INTEGER NOT NULL,
  PRIMARY KEY (skill_id, version)
);

-- ── Orders ─────────────────────────────────────────────────────────
-- One row per attempt to buy. `lipia_transaction_id` is the join back
-- to the gateway; `metadata.order_id` is what comes back on the webhook.
CREATE TABLE IF NOT EXISTS orders (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id),
  skill_id             TEXT NOT NULL REFERENCES skills(id),
  major_version        INTEGER NOT NULL,
  amount               INTEGER NOT NULL,
  currency             TEXT NOT NULL,
  msisdn               TEXT,
  provider             TEXT,              -- vodacom|tigo|airtel|halopesa
  -- 'created' | 'charging' | 'paid' | 'failed' | 'expired'
  status               TEXT NOT NULL DEFAULT 'created',
  failure_reason       TEXT,
  lipia_transaction_id TEXT,
  lipia_status         TEXT,
  receipt              TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  -- A pending order older than this gets reconciled against Lipia
  -- rather than waited on. A webhook that never arrives must not mean
  -- a buyer who paid never gets their skill.
  reconcile_after      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(status, reconcile_after);

-- ── Entitlements ───────────────────────────────────────────────────
-- What somebody owns. Granted by the webhook (or free-claim), revoked
-- by a refund. The client is handed a SIGNED copy of this row so an
-- installed skill keeps working offline; `revoked_at` is why those
-- signatures are short-lived rather than permanent.
CREATE TABLE IF NOT EXISTS entitlements (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  skill_id      TEXT NOT NULL REFERENCES skills(id),
  major_version INTEGER NOT NULL,
  order_id      TEXT REFERENCES orders(id),
  source        TEXT NOT NULL,            -- 'purchase' | 'free' | 'grant'
  granted_at    INTEGER NOT NULL,
  revoked_at    INTEGER,
  revoke_reason TEXT,
  UNIQUE (user_id, skill_id, major_version)
);
CREATE INDEX IF NOT EXISTS idx_ent_user ON entitlements(user_id);

-- ── Webhook log ────────────────────────────────────────────────────
-- Every callback Lipia sends, verified or not. A payment dispute is
-- won or lost on whether you kept the delivery you were sent.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  received_at  INTEGER NOT NULL,
  event        TEXT,
  signature_ok INTEGER NOT NULL,
  order_id     TEXT,
  body         TEXT NOT NULL,
  handled      INTEGER NOT NULL DEFAULT 0,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_order ON webhook_events(order_id);
