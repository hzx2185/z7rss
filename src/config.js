import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FALLBACK_APP_SECRET = "change-me-in-compose";
const DEFAULT_APP_SECRET_PLACEHOLDERS = new Set([
  FALLBACK_APP_SECRET,
  "change-me-before-production"
]);
const LEGACY_APP_SECRET_FALLBACKS = [
  "change-me-before-production",
  FALLBACK_APP_SECRET
];

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

function parseSqliteSynchronous(value, fallback = "FULL") {
  const normalized = String(value || "").trim().toUpperCase();
  return ["OFF", "NORMAL", "FULL", "EXTRA"].includes(normalized) ? normalized : fallback;
}

function readPackageVersion() {
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return String(packageJson.version || "").trim();
  } catch (_error) {
    return "";
  }
}

function isProduction(env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function readOrCreateAppSecretFile(secretFile) {
  const normalizedPath = String(secretFile || "").trim();
  if (!normalizedPath) return "";

  try {
    const existing = fs.readFileSync(normalizedPath, "utf8").trim();
    if (existing && !DEFAULT_APP_SECRET_PLACEHOLDERS.has(existing)) {
      return existing;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const generated = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  fs.writeFileSync(normalizedPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

function parseAppSecret(env) {
  const configuredSecret = String(env.APP_SECRET || "").trim();
  if (configuredSecret && !DEFAULT_APP_SECRET_PLACEHOLDERS.has(configuredSecret)) {
    return configuredSecret;
  }

  const fileSecret = readOrCreateAppSecretFile(env.APP_SECRET_FILE);
  if (fileSecret) {
    return fileSecret;
  }

  const appSecret = configuredSecret || FALLBACK_APP_SECRET;
  if (isProduction(env) && DEFAULT_APP_SECRET_PLACEHOLDERS.has(appSecret)) {
    const error = new Error("生产环境必须配置非默认 APP_SECRET，或提供可写的 APP_SECRET_FILE");
    error.code = "app_secret_required";
    throw error;
  }
  return appSecret;
}

function parseLegacyAppSecrets(env, appSecret) {
  const configuredFallbacks = String(env.APP_SECRET_LEGACY || env.APP_SECRET_FALLBACKS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...configuredFallbacks, ...LEGACY_APP_SECRET_FALLBACKS]
    .filter((entry, index, all) => entry && entry !== appSecret && all.indexOf(entry) === index);
}

export function createConfig(env) {
  const appUrl = env.APP_URL || "http://localhost:39118";
  const secureCookies = parseBoolean(env.SESSION_COOKIE_SECURE, /^https:/i.test(appUrl));
  const appSecret = parseAppSecret(env);
  const appVersion = String(env.APP_VERSION || readPackageVersion() || "0.0.0").trim();

  return {
    appName: env.APP_NAME || "Z7 RSS",
    appVersion,
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
    appSecret,
    legacyAppSecrets: parseLegacyAppSecrets(env, appSecret),
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
    databaseSynchronous: parseSqliteSynchronous(env.DATABASE_SYNCHRONOUS, "FULL"),
    databaseBusyTimeoutMs: Math.max(1000, parseInteger(env.DATABASE_BUSY_TIMEOUT_MS, 10000)),
    databaseVacuumEnabled: parseBoolean(env.DATABASE_VACUUM_ENABLED, false),
    databaseVacuumIntervalDays: parseInteger(env.DATABASE_VACUUM_INTERVAL_DAYS, 7),
    databaseVacuumTime: /^\d{2}:\d{2}$/.test(String(env.DATABASE_VACUUM_TIME || "").trim())
      ? String(env.DATABASE_VACUUM_TIME).trim()
      : "03:30",
    auditLogRetentionDays: parseInteger(env.AUDIT_LOG_RETENTION_DAYS, 30),
    auditLogMaxEntries: parseInteger(env.AUDIT_LOG_MAX_ENTRIES, 5000),
    refreshRunRetentionDays: parseInteger(env.REFRESH_RUN_RETENTION_DAYS, 14),
    refreshRunMaxEntries: parseInteger(env.REFRESH_RUN_MAX_ENTRIES, 1000),
    rateLimitAuthWindowMs: parseInteger(env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
    rateLimitAuthMax: parseInteger(env.RATE_LIMIT_AUTH_MAX, 10),
    rateLimitAiWindowMs: parseInteger(env.RATE_LIMIT_AI_WINDOW_MS, 10 * 60 * 1000),
    rateLimitAiMax: parseInteger(env.RATE_LIMIT_AI_MAX, 20),
    rateLimitFeedWriteWindowMs: parseInteger(env.RATE_LIMIT_FEED_WRITE_WINDOW_MS, 10 * 60 * 1000),
    rateLimitFeedWriteMax: parseInteger(env.RATE_LIMIT_FEED_WRITE_MAX, 30),
    buildCommit: env.BUILD_COMMIT || env.GIT_COMMIT || "",
    buildTime: env.BUILD_TIME || "",
    dockerImage: env.DOCKER_IMAGE || "hzx2185/z7rss",
    dockerImageTag: env.DOCKER_IMAGE_TAG || "latest",
    dockerHubApiBaseUrl: env.DOCKER_HUB_API_BASE_URL || "https://hub.docker.com/v2",
    dockerUpdateCheckTimeoutMs: Math.max(1000, parseInteger(env.DOCKER_UPDATE_CHECK_TIMEOUT_MS, 8000))
  };
}
