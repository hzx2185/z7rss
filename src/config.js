import path from "node:path";

function parseInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function createConfig(env) {
  const appUrl = env.APP_URL || "http://localhost:39118";
  const secureCookies = parseBoolean(env.SESSION_COOKIE_SECURE, /^https:/i.test(appUrl));

  return {
    appName: env.APP_NAME || "Z7 RSS",
    appUrl,
    port: parseInteger(env.PORT, 39018),
    dbPath: env.DB_PATH || path.join(process.cwd(), "data/rss.db"),
    refreshMinutes: parseInteger(env.REFRESH_INTERVAL_MINUTES, 30),
    userRefreshConcurrency: Math.max(1, Math.min(10, parseInteger(env.USER_REFRESH_CONCURRENCY, 4))),
    crawlTimeoutMs: parseInteger(env.CRAWL_TIMEOUT_MS, 15000),
    userAgent: env.USER_AGENT || "Z7RSSBot/0.1",
    sessionCookieName: env.SESSION_COOKIE_NAME || "z7rss_session",
    sessionTtlDays: parseInteger(env.SESSION_TTL_DAYS, 30),
    secureCookies,
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    appSecret: env.APP_SECRET || "change-me-in-compose",
    adminEmails: String(env.ADMIN_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    aiEnabled: env.AI_ENABLED !== "false",
    billingProvider: env.BILLING_PROVIDER || "demo",
    stripeSecretKey: env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    stripePriceProMonthly: env.STRIPE_PRICE_PRO_MONTHLY || "",
    stripePriceTeamMonthly: env.STRIPE_PRICE_TEAM_MONTHLY || "",
    deeplxApiUrl: env.DEEPLX_API_URL || "",
    maintenanceIntervalMinutes: parseInteger(env.MAINTENANCE_INTERVAL_MINUTES, 360),
    databaseBackupEnabled: parseBoolean(env.DATABASE_BACKUP_ENABLED, true),
    databaseBackupRetentionDays: parseInteger(env.DATABASE_BACKUP_RETENTION_DAYS, 14),
    databaseBackupMaxFiles: parseInteger(env.DATABASE_BACKUP_MAX_FILES, 24),
    auditLogRetentionDays: parseInteger(env.AUDIT_LOG_RETENTION_DAYS, 30),
    auditLogMaxEntries: parseInteger(env.AUDIT_LOG_MAX_ENTRIES, 5000),
    refreshRunRetentionDays: parseInteger(env.REFRESH_RUN_RETENTION_DAYS, 14),
    refreshRunMaxEntries: parseInteger(env.REFRESH_RUN_MAX_ENTRIES, 1000),
    rateLimitAuthWindowMs: parseInteger(env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
    rateLimitAuthMax: parseInteger(env.RATE_LIMIT_AUTH_MAX, 10),
    rateLimitAiWindowMs: parseInteger(env.RATE_LIMIT_AI_WINDOW_MS, 10 * 60 * 1000),
    rateLimitAiMax: parseInteger(env.RATE_LIMIT_AI_MAX, 20),
    rateLimitFeedWriteWindowMs: parseInteger(env.RATE_LIMIT_FEED_WRITE_WINDOW_MS, 10 * 60 * 1000),
    rateLimitFeedWriteMax: parseInteger(env.RATE_LIMIT_FEED_WRITE_MAX, 30)
  };
}
