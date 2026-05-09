import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function seedPlans(db) {
  const plans = [
    {
      code: "free",
      name: "免费版",
      description: "适合个人试用，包含基础抓取阅读能力。",
      priceMonthlyCents: 0,
      maxFeeds: 5,
      maxSavedItems: 200,
      maxFavoriteItems: 50,
      aiTranslationEnabled: 0,
      aiSummaryEnabled: 0,
      customAiEnabled: 0,
      aiDigestEnabled: 0,
      emailDigestEnabled: 0,
      maxDigestRules: 0,
      stripePriceId: ""
    },
    {
      code: "pro",
      name: "专业版",
      description: "适合重度读者，开放 AI 翻译、AI 总结和更高订阅上限。",
      priceMonthlyCents: 2900,
      maxFeeds: 50,
      maxSavedItems: 2000,
      maxFavoriteItems: 500,
      aiTranslationEnabled: 1,
      aiSummaryEnabled: 1,
      customAiEnabled: 1,
      aiDigestEnabled: 1,
      emailDigestEnabled: 1,
      maxDigestRules: 3,
      stripePriceId: process.env.STRIPE_PRICE_PRO_MONTHLY || ""
    },
    {
      code: "team",
      name: "团队版",
      description: "适合小团队协作，包含更高配额和共享采购能力。",
      priceMonthlyCents: 9900,
      maxFeeds: 200,
      maxSavedItems: 10000,
      maxFavoriteItems: 3000,
      aiTranslationEnabled: 1,
      aiSummaryEnabled: 1,
      customAiEnabled: 1,
      aiDigestEnabled: 1,
      emailDigestEnabled: 1,
      maxDigestRules: 20,
      stripePriceId: process.env.STRIPE_PRICE_TEAM_MONTHLY || ""
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO plans (
      code, name, description, price_monthly_cents, max_feeds, max_saved_items, max_favorite_items,
      ai_translation_enabled, ai_summary_enabled, custom_ai_enabled, ai_digest_enabled,
      email_digest_enabled, max_digest_rules, stripe_price_id
    ) VALUES (
      @code, @name, @description, @priceMonthlyCents, @maxFeeds, @maxSavedItems, @maxFavoriteItems,
      @aiTranslationEnabled, @aiSummaryEnabled, @customAiEnabled, @aiDigestEnabled,
      @emailDigestEnabled, @maxDigestRules, @stripePriceId
    )
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      price_monthly_cents = excluded.price_monthly_cents,
      stripe_price_id = excluded.stripe_price_id
  `);

  for (const plan of plans) {
    stmt.run(plan);
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, category, key),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price_monthly_cents INTEGER NOT NULL,
      max_feeds INTEGER NOT NULL,
      max_saved_items INTEGER NOT NULL DEFAULT 200,
      max_favorite_items INTEGER NOT NULL DEFAULT 50,
      ai_translation_enabled INTEGER NOT NULL DEFAULT 0,
      ai_summary_enabled INTEGER NOT NULL DEFAULT 0,
      custom_ai_enabled INTEGER NOT NULL DEFAULT 0,
      ai_digest_enabled INTEGER NOT NULL DEFAULT 0,
      email_digest_enabled INTEGER NOT NULL DEFAULT 0,
      max_digest_rules INTEGER NOT NULL DEFAULT 0,
      stripe_price_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      plan_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'demo',
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      current_period_start TEXT NOT NULL,
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES plans (id)
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_checkout_id TEXT,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      checkout_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES plans (id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, key)
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      plan_id INTEGER NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plans (id)
    );

    CREATE TABLE IF NOT EXISTS redeem_code_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      redeem_code_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(redeem_code_id, user_id),
      FOREIGN KEY (redeem_code_id) REFERENCES redeem_codes (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      is_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      pattern TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'block',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blocked_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      reason TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blocked_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      reason TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      actor_email TEXT,
      actor_display_name TEXT,
      actor_ip TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      total_feeds INTEGER NOT NULL DEFAULT 0,
      succeeded_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      actor_user_id INTEGER,
      actor_email TEXT,
      actor_display_name TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      duration_ms INTEGER,
      error_summary TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS digest_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      send_time TEXT NOT NULL DEFAULT '09:00',
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      recipient_emails TEXT NOT NULL DEFAULT '[]',
      ai_source TEXT NOT NULL DEFAULT 'system',
      prompt TEXT NOT NULL DEFAULT '',
      lookback_hours INTEGER NOT NULL DEFAULT 24,
      unread_only INTEGER NOT NULL DEFAULT 0,
      feed_scope TEXT NOT NULL DEFAULT 'all',
      feed_ids_json TEXT NOT NULL DEFAULT '[]',
      category TEXT,
      last_sent_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      email_to TEXT NOT NULL DEFAULT '',
      item_count INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (rule_id) REFERENCES digest_rules (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      site_url TEXT,
      description TEXT,
      auto_category TEXT,
      etag TEXT,
      last_modified TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_fetched_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS user_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      feed_id INTEGER NOT NULL,
      custom_title TEXT,
      translated_title TEXT,
      translated_language TEXT,
      translated_source_title TEXT,
      category TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_collapsed INTEGER NOT NULL DEFAULT 0,
      translation_target_language TEXT,
      auto_translate INTEGER,
      display_translated INTEGER,
      translation_mode TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, feed_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (feed_id) REFERENCES feeds (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      author TEXT,
      summary TEXT,
      content_html TEXT,
      content_text TEXT,
      original_url TEXT,
      original_title TEXT,
      page_html TEXT,
      page_text TEXT,
      page_fetched_at TEXT,
      translated_title TEXT,
      translated_text TEXT,
      translated_language TEXT,
      ai_summary TEXT,
      published_at TEXT,
      crawled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(feed_id, guid),
      FOREIGN KEY (feed_id) REFERENCES feeds (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_item_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      is_favorited INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      favorited_at TEXT,
      translated_title TEXT,
      translated_text TEXT,
      translated_language TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_item_stats (
      user_id INTEGER PRIMARY KEY,
      all_count INTEGER NOT NULL DEFAULT 0,
      today_since TEXT,
      today_count INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_feeds_user_id ON user_feeds(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_feeds_feed_id ON user_feeds(feed_id);
    CREATE INDEX IF NOT EXISTS idx_user_feeds_user_feed ON user_feeds(user_id, feed_id);
    CREATE INDEX IF NOT EXISTS idx_items_feed_id ON items(feed_id);
    CREATE INDEX IF NOT EXISTS idx_items_published_at ON items(published_at);
    CREATE INDEX IF NOT EXISTS idx_items_effective_sort ON items(COALESCE(published_at, created_at) DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_items_feed_sort ON items(feed_id, published_at DESC, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_items_feed_effective_sort ON items(feed_id, COALESCE(published_at, created_at) DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_user_item_states_user_item ON user_item_states(user_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_user_item_states_item_user_read ON user_item_states(item_id, user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_user_item_states_user_read_item ON user_item_states(user_id, is_read, item_id);
    CREATE INDEX IF NOT EXISTS idx_user_item_stats_dirty ON user_item_stats(dirty);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_refresh_runs_started_at ON refresh_runs(started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_refresh_runs_status ON refresh_runs(status);
    CREATE INDEX IF NOT EXISTS idx_digest_rules_user ON digest_rules(user_id, is_enabled);
    CREATE INDEX IF NOT EXISTS idx_digest_runs_rule ON digest_runs(rule_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS pruned_guids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL,
      guid TEXT NOT NULL,
      pruned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(feed_id, guid),
      FOREIGN KEY (feed_id) REFERENCES feeds (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pruned_guids_feed_guid ON pruned_guids(feed_id, guid);
    CREATE INDEX IF NOT EXISTS idx_pruned_guids_pruned_at ON pruned_guids(pruned_at);
  `);

  if (!hasColumn(db, "items", "translated_text")) {
    db.exec(`ALTER TABLE items ADD COLUMN translated_text TEXT`);
  }
  if (!hasColumn(db, "feeds", "etag")) {
    db.exec(`ALTER TABLE feeds ADD COLUMN etag TEXT`);
  }
  if (!hasColumn(db, "feeds", "last_modified")) {
    db.exec(`ALTER TABLE feeds ADD COLUMN last_modified TEXT`);
  }
  if (!hasColumn(db, "items", "translated_title")) {
    db.exec(`ALTER TABLE items ADD COLUMN translated_title TEXT`);
  }
  if (!hasColumn(db, "items", "translated_language")) {
    db.exec(`ALTER TABLE items ADD COLUMN translated_language TEXT`);
  }
  if (!hasColumn(db, "items", "original_url")) {
    db.exec(`ALTER TABLE items ADD COLUMN original_url TEXT`);
  }
  if (!hasColumn(db, "items", "original_title")) {
    db.exec(`ALTER TABLE items ADD COLUMN original_title TEXT`);
  }
  if (!hasColumn(db, "items", "page_html")) {
    db.exec(`ALTER TABLE items ADD COLUMN page_html TEXT`);
  }
  if (!hasColumn(db, "items", "page_text")) {
    db.exec(`ALTER TABLE items ADD COLUMN page_text TEXT`);
  }
  if (!hasColumn(db, "items", "page_fetched_at")) {
    db.exec(`ALTER TABLE items ADD COLUMN page_fetched_at TEXT`);
  }
  if (!hasColumn(db, "items", "ai_summary")) {
    db.exec(`ALTER TABLE items ADD COLUMN ai_summary TEXT`);
  }
  if (!hasColumn(db, "feeds", "auto_category")) {
    db.exec(`ALTER TABLE feeds ADD COLUMN auto_category TEXT`);
  }
  if (!hasColumn(db, "users", "is_admin")) {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "users", "status")) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!hasColumn(db, "plans", "max_saved_items")) {
    db.exec(`ALTER TABLE plans ADD COLUMN max_saved_items INTEGER NOT NULL DEFAULT 200`);
  }
  if (!hasColumn(db, "plans", "max_favorite_items")) {
    db.exec(`ALTER TABLE plans ADD COLUMN max_favorite_items INTEGER NOT NULL DEFAULT 50`);
  }
  if (!hasColumn(db, "plans", "custom_ai_enabled")) {
    db.exec(`ALTER TABLE plans ADD COLUMN custom_ai_enabled INTEGER NOT NULL DEFAULT 0`);
    db.exec(`
      UPDATE plans
      SET custom_ai_enabled = CASE
        WHEN code IN ('pro', 'team') THEN 1
        ELSE 0
      END
    `);
  }
  if (!hasColumn(db, "plans", "ai_digest_enabled")) {
    db.exec(`ALTER TABLE plans ADD COLUMN ai_digest_enabled INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE plans SET ai_digest_enabled = CASE WHEN code IN ('pro', 'team') THEN 1 ELSE 0 END`);
  }
  if (!hasColumn(db, "plans", "email_digest_enabled")) {
    db.exec(`ALTER TABLE plans ADD COLUMN email_digest_enabled INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE plans SET email_digest_enabled = CASE WHEN code IN ('pro', 'team') THEN 1 ELSE 0 END`);
  }
  if (!hasColumn(db, "plans", "max_digest_rules")) {
    db.exec(`ALTER TABLE plans ADD COLUMN max_digest_rules INTEGER NOT NULL DEFAULT 0`);
    db.exec(`
      UPDATE plans
      SET max_digest_rules = CASE
        WHEN code = 'team' THEN 20
        WHEN code = 'pro' THEN 3
        ELSE 0
      END
    `);
  }
  if (!hasColumn(db, "digest_rules", "lookback_hours")) {
    db.exec(`ALTER TABLE digest_rules ADD COLUMN lookback_hours INTEGER NOT NULL DEFAULT 24`);
  }
  if (!hasColumn(db, "digest_rules", "unread_only")) {
    db.exec(`ALTER TABLE digest_rules ADD COLUMN unread_only INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "user_item_states", "is_favorited")) {
    db.exec(`ALTER TABLE user_item_states ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "user_item_states", "favorited_at")) {
    db.exec(`ALTER TABLE user_item_states ADD COLUMN favorited_at TEXT`);
  }
  if (!hasColumn(db, "user_item_states", "translated_text")) {
    db.exec(`ALTER TABLE user_item_states ADD COLUMN translated_text TEXT`);
  }
  if (!hasColumn(db, "user_item_states", "translated_title")) {
    db.exec(`ALTER TABLE user_item_states ADD COLUMN translated_title TEXT`);
  }
  if (!hasColumn(db, "user_item_states", "translated_language")) {
    db.exec(`ALTER TABLE user_item_states ADD COLUMN translated_language TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "translation_target_language")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN translation_target_language TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "translated_title")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN translated_title TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "translated_language")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN translated_language TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "translated_source_title")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN translated_source_title TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "category")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN category TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "is_archived")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "user_feeds", "is_collapsed")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN is_collapsed INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "user_feeds", "auto_translate")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN auto_translate INTEGER`);
  }
  if (!hasColumn(db, "user_feeds", "display_translated")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN display_translated INTEGER`);
  }
  if (!hasColumn(db, "user_feeds", "translation_mode")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN translation_mode TEXT`);
  }
  if (!hasColumn(db, "user_feeds", "is_public")) {
    db.exec(`ALTER TABLE user_feeds ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`);
  }
  if (hasColumn(db, "user_feeds", "is_public")) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_feeds_public_feed ON user_feeds(is_public, feed_id)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_feeds_user_feed ON user_feeds(user_id, feed_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_effective_sort ON items(COALESCE(published_at, created_at) DESC, id DESC)`);
  if (!hasColumn(db, "sessions", "ip_address")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN ip_address TEXT`);
  }
  if (!hasColumn(db, "sessions", "user_agent")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN user_agent TEXT`);
  }
  if (!hasColumn(db, "sessions", "last_seen_at")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN last_seen_at TEXT`);
  }
  if (hasColumn(db, "sessions", "last_seen_at")) {
    const fallbackTimestamp = hasColumn(db, "sessions", "created_at") ? "created_at" : "CURRENT_TIMESTAMP"
    db.exec(`
      UPDATE sessions
      SET last_seen_at = COALESCE(NULLIF(last_seen_at, ''), ${fallbackTimestamp}, CURRENT_TIMESTAMP)
      WHERE last_seen_at IS NULL OR TRIM(last_seen_at) = ''
    `);
  }
  if (hasColumn(db, "user_item_states", "is_favorited")) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_item_states_user_favorite ON user_item_states(user_id, is_favorited)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_item_states_user_favorited_item ON user_item_states(user_id, is_favorited, item_id)`);
  }

  seedPlans(db);
}

export function createDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  setImmediate(() => {
    db.pragma("optimize");
  });
  return db;
}
