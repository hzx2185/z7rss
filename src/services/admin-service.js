import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeIp } from "../lib/request.js";
import { hashPassword } from "../lib/security.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";

const REDEEM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DOCKER_HUB_DEFAULT_API_BASE_URL = "https://hub.docker.com/v2";

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeDockerImageName(value = "") {
  let raw = String(value || "").trim();
  if (!raw) return "hzx2185/z7rss";
  raw = raw.replace(/^docker\.io\//i, "");
  raw = raw.replace(/^registry-1\.docker\.io\//i, "");
  raw = raw.replace(/^index\.docker\.io\//i, "");
  raw = raw.replace(/^library\//i, "library/");
  if (!raw.includes("/")) return `library/${raw}`;
  return raw;
}

function parseDockerImageRef(image, tag) {
  const normalizedImage = normalizeDockerImageName(image);
  const segments = normalizedImage.split("/");
  const repositoryPart = segments.pop() || "z7rss";
  const namespace = segments.join("/") || "library";
  const colonIndex = repositoryPart.lastIndexOf(":");
  const repository = colonIndex > -1 ? repositoryPart.slice(0, colonIndex) : repositoryPart;
  const inferredTag = colonIndex > -1 ? repositoryPart.slice(colonIndex + 1) : "";
  return {
    namespace,
    repository,
    tag: String(tag || inferredTag || "latest").trim() || "latest"
  };
}

function toIsoOrEmpty(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isRemoteNewer(localBuildTime, remoteUpdatedAt) {
  const local = new Date(localBuildTime);
  const remote = new Date(remoteUpdatedAt);
  if (Number.isNaN(local.getTime()) || Number.isNaN(remote.getTime())) return null;
  return remote.getTime() > local.getTime() + 1000;
}

function parseSemverTag(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    raw,
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ""
  };
}

function compareSemverTags(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && !right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function getLatestVersionTag(tags = []) {
  return tags
    .map((entry) => ({
      name: String(entry?.name || "").trim(),
      publishedAt: toIsoOrEmpty(entry?.tag_last_pushed || entry?.last_updated || ""),
      semver: parseSemverTag(entry?.name)
    }))
    .filter((entry) => entry.name && entry.semver)
    .sort((left, right) => compareSemverTags(right.semver, left.semver))[0] || null;
}

function isVersionNewer(currentVersion, latestVersion) {
  const current = parseSemverTag(currentVersion);
  const latest = parseSemverTag(latestVersion);
  if (!current || !latest) return null;
  return compareSemverTags(latest, current) > 0;
}

export function createAdminService({
  store,
  accountService,
  config,
  secretBox,
  feedService,
  refreshService = null,
  maintenanceService = null,
  dockerHubFetch = globalThis.fetch
}) {
  function isSecretSettingKey(key) {
    return key === "api_key" || key === "password" || key === "configs_secret";
  }

  function normalizePeriodEnd(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw badRequest("到期时间格式无效", { code: "invalid_period_end" });
    }
    return date.toISOString();
  }

  function normalizePositiveInteger(value, label) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
      throw badRequest(`${label}必须是大于等于 0 的整数`, { code: "invalid_non_negative_integer" });
    }
    return Math.floor(normalized);
  }

  function normalizeOptionalBoolean(value, label) {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (value === true || value === 1 || value === "1" || value === "true") return 1;
    if (value === false || value === 0 || value === "0" || value === "false") return 0;
    throw badRequest(`${label}必须是布尔值`, { code: "invalid_boolean" });
  }

  function normalizeRedeemCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function generateRedeemCode(prefix = "") {
    const normalizedPrefix = normalizeRedeemCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const chunks = [];
    for (let i = 0; i < 16; i += 1) {
      chunks.push(REDEEM_CODE_ALPHABET[crypto.randomInt(REDEEM_CODE_ALPHABET.length)]);
    }
    const body = `${chunks.slice(0, 4).join("")}-${chunks.slice(4, 8).join("")}-${chunks.slice(8, 12).join("")}-${chunks.slice(12, 16).join("")}`;
    return normalizedPrefix ? `${normalizedPrefix}-${body}` : body;
  }

  function createRedeemBatchId() {
    return `batch_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
  }

  function getRedeemBatchId(entry) {
    return String(entry?.resolved_batch_id || entry?.batch_id || "").trim();
  }

  function getRedeemCodeById(id) {
    return store.listRedeemCodes().find((entry) => Number(entry.id) === Number(id)) || null;
  }

  function getRedeemBatch(batchId) {
    const normalizedBatchId = String(batchId || "").trim();
    if (!normalizedBatchId) return [];
    return store.listRedeemCodes().filter((entry) => getRedeemBatchId(entry) === normalizedBatchId);
  }

  function markUnavailableSecret(output, category, key, rawValue, decryptedValue) {
    if (!output?.[category]) return;
    const hasRawValue = Boolean(String(rawValue || "").trim());
    const hasDecryptedValue = Boolean(String(decryptedValue || "").trim());
    if (key === "api_key") {
      output[category].api_key_unavailable = hasRawValue && !hasDecryptedValue;
    }
    if (key === "password") {
      output[category].password_unavailable = hasRawValue && !hasDecryptedValue;
    }
    if (key === "configs_secret") {
      output[category].configs_unavailable = hasRawValue && !hasDecryptedValue;
    }
  }

  function getUnavailableSecretFlag(key) {
    if (key === "api_key") return "api_key_unavailable";
    if (key === "password") return "password_unavailable";
    if (key === "configs_secret") return "configs_unavailable";
    return "";
  }

  function getSecretSettingLabel(category, key) {
    if (key === "configs_secret") return "API 列表";
    if (key === "password") return "密码";
    if (key === "api_key") return "API Key";
    return `${category}.${key}`;
  }

  function getSettingSecretValue(category, key) {
    const normalizedCategory = String(category || "").trim().toLowerCase();
    const normalizedKey = String(key || "").trim().toLowerCase();
    const allowedSecrets = new Set([
      "mail.password",
      "ai.api_key",
      "translation_google.api_key",
      "translation_bing.api_key",
      "translation_deeplx.api_key"
    ]);
    const secretId = `${normalizedCategory}.${normalizedKey}`;
    if (!allowedSecrets.has(secretId)) {
      throw badRequest("密钥类型无效", { code: "invalid_secret_setting" });
    }

    const row = store.getSetting(normalizedCategory, normalizedKey);
    const value = secretBox.decrypt(row?.value || "");
    return {
      category: normalizedCategory,
      key: normalizedKey,
      value
    };
  }

  function isUnavailableSecret(current, category, key) {
    const flag = getUnavailableSecretFlag(key);
    return Boolean(flag && current?.[category]?.[flag]);
  }

  function maskApiKey(output, category) {
    if (!output?.[category]) return;
    output[category].api_key_configured = Boolean(output[category].api_key || output[category].api_key_unavailable);
    delete output[category].api_key;
  }

  function maskPassword(output, category) {
    if (!output?.[category]) return;
    output[category].password_configured = Boolean(output[category].password || output[category].password_unavailable);
    delete output[category].password;
  }

  function maskTranslationProviderPool(output) {
    const pool = output?.translation_provider_pool;
    if (!pool?.configs_secret) return;
    try {
      const configs = JSON.parse(pool.configs_secret);
      pool.configs = Array.isArray(configs)
        ? configs.map((entry) => {
            const { apiKey: _apiKey, api_key: _api_key, ...safeEntry } = entry || {};
            return {
              ...safeEntry,
              api_key_configured: Boolean(_apiKey || _api_key)
            };
          })
        : [];
    } catch (_error) {
      pool.configs = [];
      pool.configs_unavailable = true;
    }
    delete pool.configs_secret;
  }

  function maskAiProviderPool(output) {
    const pool = output?.ai_provider_pool;
    if (!pool?.configs_secret) return;
    try {
      const configs = JSON.parse(pool.configs_secret);
      pool.configs = Array.isArray(configs)
        ? configs.map((entry) => {
            const { apiKey: _apiKey, api_key: _api_key, ...safeEntry } = entry || {};
            return {
              ...safeEntry,
              api_key_configured: Boolean(_apiKey || _api_key)
            };
          })
        : [];
    } catch (_error) {
      pool.configs = [];
      pool.configs_unavailable = true;
    }
    delete pool.configs_secret;
  }

  function withMaskedSecrets(settings) {
    const output = structuredClone(settings || {});
    maskApiKey(output, "ai");
    maskApiKey(output, "translation_google");
    maskApiKey(output, "translation_bing");
    maskApiKey(output, "translation_deeplx");
    maskPassword(output, "mail");
    maskTranslationProviderPool(output);
    maskAiProviderPool(output);
    return output;
  }

  function getSettingsMap() {
    const rows = store.listSettings();
    const settings = rows.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = {};
      const value = isSecretSettingKey(row.key) ? secretBox.decrypt(row.value) : row.value;
      acc[row.category][row.key] = value;
      if (isSecretSettingKey(row.key)) markUnavailableSecret(acc, row.category, row.key, row.value, value);
      return acc;
    }, {});
    return withMaskedSecrets(settings);
  }

  function getPoolSecretValue(poolType, id) {
    const normalizedPoolType = String(poolType || "").trim().toLowerCase();
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      throw badRequest("API ID 不能为空", { code: "invalid_secret_id" });
    }

    if (normalizedPoolType === "ai") {
      const entry = accountService.getSystemAiProviderPool()
        .find((item) => String(item.id) === normalizedId);
      if (!entry) {
        throw notFound("AI 接口不存在", { code: "secret_not_found" });
      }
      return {
        pool: "ai",
        id: entry.id,
        name: entry.name,
        apiKey: entry.apiKey || ""
      };
    }

    if (normalizedPoolType === "translation") {
      const entry = accountService.getSystemTranslationProviderPool()
        .find((item) => String(item.id) === normalizedId);
      if (!entry) {
        throw notFound("翻译 API 不存在", { code: "secret_not_found" });
      }
      return {
        pool: "translation",
        id: entry.id,
        name: entry.name,
        provider: entry.provider,
        apiKey: entry.apiKey || ""
      };
    }

    throw badRequest("API 类型无效", { code: "invalid_secret_pool" });
  }

  function getAuditContext(context = null) {
    const actor = context?.actor || null;
    return {
      actorUserId: actor?.id ?? null,
      actorEmail: String(actor?.email || "").trim().toLowerCase(),
      actorDisplayName: String(actor?.displayName || "").trim(),
      actorIp: normalizeIp(context?.requestIp || "")
    };
  }

  function sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isAdmin: Boolean(user.is_admin),
      status: user.status,
      createdAt: user.created_at
    };
  }

  function sanitizeSession(session) {
    return {
      id: session.id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      lastSeenAt: session.last_seen_at,
      ipAddress: session.ip_address || "",
      userAgent: session.user_agent || ""
    };
  }

  function getUserOrThrow(userId) {
    const user = store.getUserById(userId);
    if (!user) {
      throw notFound("用户不存在", { code: "user_not_found" });
    }
    return user;
  }

  function getUserSecuritySnapshot(userId) {
    return {
      user: sanitizeUser(getUserOrThrow(userId)),
      sessions: store.listUserSessions(userId).map((session) => sanitizeSession(session))
    };
  }

  function logAudit(context, entry) {
    if (!entry?.action || !entry?.targetType || !entry?.summary) {
      return;
    }

    const actor = getAuditContext(context);
    store.createAuditLog({
      ...actor,
      action: String(entry.action),
      targetType: String(entry.targetType),
      targetId: entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId),
      summary: String(entry.summary),
      detailsJson: JSON.stringify(entry.details || {})
    });
  }

  function getFileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch (_error) {
      return 0;
    }
  }

  function getBackupDir() {
    return path.join(path.dirname(config.dbPath), "backups");
  }

  function listDatabaseBackupFiles() {
    const backupDir = getBackupDir();
    return fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir)
          .filter((entry) => entry.endsWith(".db"))
          .map((filename) => {
            const filePath = path.join(backupDir, filename);
            const stat = fs.statSync(filePath);
            return {
              filename,
              size: stat.size,
              updatedAt: stat.mtime.toISOString(),
              automatic: /^z7rss-auto-.*\.db$/i.test(filename)
            };
          })
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      : [];
  }

  function getBackupPath(filename) {
    const normalized = path.basename(String(filename || "").trim());
    if (!/^[a-zA-Z0-9._-]+\.db$/.test(normalized)) {
      throw badRequest("备份文件名无效", { code: "invalid_backup_filename" });
    }
    const backupDir = getBackupDir();
    const filePath = path.join(backupDir, normalized);
    const resolvedDir = path.resolve(backupDir);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) {
      throw badRequest("备份文件名无效", { code: "invalid_backup_filename" });
    }
    if (!fs.existsSync(resolvedPath)) {
      throw notFound("备份文件不存在", { code: "backup_not_found" });
    }
    const walPath = `${resolvedPath}-wal`;
    const shmPath = `${resolvedPath}-shm`;
    const deleteRelatedFiles = () => {
      fs.rmSync(walPath, { force: true });
      fs.rmSync(shmPath, { force: true });
    };
    return {
      path: resolvedPath,
      filename: normalized,
      size: getFileSize(resolvedPath),
      walPath,
      shmPath,
      deleteRelatedFiles
    };
  }

  function getDatabaseSnapshot() {
    const metrics = store.getDatabaseMetrics?.() || {};
    const settingsRows = store.listSettings();
    const backupSettings = settingsRows.reduce((acc, row) => {
      if (row.category === "database_backup") acc[row.key] = row.value;
      return acc;
    }, {});
    const vacuumSettings = settingsRows.reduce((acc, row) => {
      if (row.category === "database_vacuum") acc[row.key] = row.value;
      return acc;
    }, {});
    const cleanupSettings = settingsRows.reduce((acc, row) => {
      if (row.category === "database_cleanup") acc[row.key] = row.value;
      return acc;
    }, {});
    const backupEnabledValue = String(backupSettings.enabled ?? "").trim().toLowerCase();
    const backupEnabled = backupEnabledValue
      ? ["1", "true", "yes", "on"].includes(backupEnabledValue)
      : config.databaseBackupEnabled !== false;
    const backupRetentionDays = Math.max(0, Number(backupSettings.retention_days ?? config.databaseBackupRetentionDays ?? 14) || 0);
    const backupMaxFiles = Math.max(1, Number(backupSettings.max_files ?? config.databaseBackupMaxFiles ?? 24) || 24);
    const backupScheduleFrequency =
      String(backupSettings.schedule_frequency || "daily").trim().toLowerCase() === "weekly" ? "weekly" : "daily";
    const backupScheduleTime = /^\d{2}:\d{2}$/.test(String(backupSettings.schedule_time || "").trim())
      ? String(backupSettings.schedule_time).trim()
      : "00:00";
    const backupScheduleWeekdays = String(backupSettings.schedule_weekdays || "")
      .split(",")
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
    const vacuumEnabledValue = String(vacuumSettings.enabled ?? "").trim().toLowerCase();
    const vacuumEnabled = vacuumEnabledValue
      ? ["1", "true", "yes", "on"].includes(vacuumEnabledValue)
      : config.databaseVacuumEnabled !== false;
    const vacuumIntervalDays = Math.max(
      1,
      Number(vacuumSettings.interval_days ?? config.databaseVacuumIntervalDays ?? 7) || 7
    );
    const vacuumScheduleTime = /^\d{2}:\d{2}$/.test(String(vacuumSettings.schedule_time || "").trim())
      ? String(vacuumSettings.schedule_time).trim()
      : config.databaseVacuumTime || "03:30";
    const mainBytes = getFileSize(config.dbPath);
    const walBytes = getFileSize(`${config.dbPath}-wal`);
    const shmBytes = getFileSize(`${config.dbPath}-shm`);
    const totalBytes = mainBytes + walBytes + shmBytes;
    const backupDir = getBackupDir();
    const backupFiles = listDatabaseBackupFiles();
    return {
      path: config.dbPath,
      mainBytes,
      walBytes,
      shmBytes,
      totalBytes,
      pageSize: metrics.pageSize || 0,
      pageCount: metrics.pageCount || 0,
      freelistCount: metrics.freelistCount || 0,
      databaseBytes: metrics.databaseBytes || 0,
      freeBytes: metrics.freeBytes || 0,
      freeRatio: metrics.freeRatio || 0,
      journalMode: metrics.journalMode || "",
      tableRows: metrics.tableRows || [],
      orphanMetrics: metrics.orphanMetrics || {},
      orphanTotal: metrics.orphanTotal || 0,
      backups: {
        enabled: backupEnabled,
        directory: backupDir,
        retentionDays: backupRetentionDays,
        maxFiles: backupMaxFiles,
        scheduleFrequency: backupScheduleFrequency,
        scheduleTime: backupScheduleTime,
        scheduleWeekdays: backupScheduleWeekdays,
        count: backupFiles.length,
        automaticCount: backupFiles.filter((entry) => entry.automatic).length,
        totalBytes: backupFiles.reduce((total, entry) => total + Number(entry.size || 0), 0),
        latest: backupFiles[0] || null,
        files: backupFiles.slice(0, 100)
      },
      vacuum: {
        enabled: vacuumEnabled,
        intervalDays: vacuumIntervalDays,
        scheduleTime: vacuumScheduleTime,
        lastVacuumAt: String(vacuumSettings.last_vacuum_at || "")
      },
      cleanup: {
        maxItemsTotal: String(cleanupSettings.max_items_total ?? cleanupSettings.max_items_per_feed ?? ""),
        maxAgeDays: Math.max(0, Number(cleanupSettings.max_age_days || 0) || 0),
        protectFavorites: cleanupSettings.protect_favorites === undefined
          ? true
          : ["1", "true", "yes", "on"].includes(String(cleanupSettings.protect_favorites).trim().toLowerCase()),
        protectUnread: ["1", "true", "yes", "on"].includes(String(cleanupSettings.protect_unread ?? "").trim().toLowerCase()),
        minKeepItems: Math.max(0, Number(cleanupSettings.min_keep_items || 0) || 0)
      },
      maintenance: maintenanceService ? maintenanceService.getStatus() : null
    };
  }

  function getSystemSnapshot(dockerUpdate = null) {
    const imageRef = parseDockerImageRef(config.dockerImage, config.dockerImageTag);
    return {
      billingProvider: config.billingProvider,
      aiEnabled: config.aiEnabled,
      appVersion: config.appVersion || "0.0.0",
      buildCommit: config.buildCommit || "",
      buildTime: config.buildTime || "",
      docker: {
        image: `${imageRef.namespace}/${imageRef.repository}`,
        namespace: imageRef.namespace,
        repository: imageRef.repository,
        tag: imageRef.tag,
        update: dockerUpdate
      }
    };
  }

  async function fetchDockerHubTag(imageRef) {
    if (typeof dockerHubFetch !== "function") {
      throw badRequest("当前运行环境不支持 Docker Hub 更新检查", { code: "docker_update_check_unavailable" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.dockerUpdateCheckTimeoutMs || 8000);
    const baseUrl = stripTrailingSlash(config.dockerHubApiBaseUrl || DOCKER_HUB_DEFAULT_API_BASE_URL);
    const url = new URL(`${baseUrl}/namespaces/${encodeURIComponent(imageRef.namespace)}/repositories/${encodeURIComponent(imageRef.repository)}/tags/${encodeURIComponent(imageRef.tag)}`);

    try {
      const response = await dockerHubFetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw badRequest(`Docker Hub 返回 ${response.status}`, { code: "docker_update_check_failed" });
      }
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw badRequest("Docker Hub 更新检查超时", { code: "docker_update_check_timeout" });
      }
      if (error?.code) throw error;
      throw badRequest("Docker Hub 更新检查失败", { code: "docker_update_check_failed" });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchDockerHubTags(imageRef) {
    if (typeof dockerHubFetch !== "function") {
      throw badRequest("当前运行环境不支持 Docker Hub 更新检查", { code: "docker_update_check_unavailable" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.dockerUpdateCheckTimeoutMs || 8000);
    const baseUrl = stripTrailingSlash(config.dockerHubApiBaseUrl || DOCKER_HUB_DEFAULT_API_BASE_URL);
    const url = new URL(`${baseUrl}/namespaces/${encodeURIComponent(imageRef.namespace)}/repositories/${encodeURIComponent(imageRef.repository)}/tags`);
    url.searchParams.set("page_size", "100");

    try {
      const response = await dockerHubFetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw badRequest(`Docker Hub 返回 ${response.status}`, { code: "docker_update_check_failed" });
      }
      const body = await response.json();
      return Array.isArray(body?.results) ? body.results : [];
    } catch (error) {
      if (error?.name === "AbortError") {
        throw badRequest("Docker Hub 更新检查超时", { code: "docker_update_check_timeout" });
      }
      if (error?.code) throw error;
      throw badRequest("Docker Hub 更新检查失败", { code: "docker_update_check_failed" });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    getDashboard() {
      return {
        metrics: {
          userCount: store.countUsers(),
          adminCount: store.countAdmins(),
          feedCount: store.listAdminFeeds().length,
          orderCount: store.listAllBillingEvents().length
        },
        users: store.listUsers(),
        orders: store.listAllBillingEvents(),
        redeemCodes: store.listRedeemCodes(),
        settings: getSettingsMap(),
        plugins: store.listPlugins().map((entry) => ({
          ...entry,
          config: parseJsonSafe(entry.config_json, {})
        })),
        contentRules: store.listContentRules(),
        blockedSites: store.listBlockedSites(),
        blockedIps: store.listBlockedIps(),
        auditLogs: store.listAuditLogs(100).map((entry) => ({
          ...entry,
          details: parseJsonSafe(entry.details_json, {})
        })),
        feeds: store.listAdminFeeds(),
        items: store.listAdminItems(150),
        plans: store.listPlans(),
        refresh: refreshService ? refreshService.getStatus() : null,
        maintenance: maintenanceService ? maintenanceService.getStatus() : null,
        database: getDatabaseSnapshot(),
        system: getSystemSnapshot()
      };
    },
    async checkDockerImageUpdate() {
      const imageRef = parseDockerImageRef(config.dockerImage, config.dockerImageTag);
      const [tagResult, tagsResult] = await Promise.allSettled([
        fetchDockerHubTag(imageRef),
        fetchDockerHubTags(imageRef)
      ]);
      if (tagResult.status === "rejected") {
        throw tagResult.reason;
      }
      const tagData = tagResult.value;
      const latestVersionTag = tagsResult.status === "fulfilled"
        ? getLatestVersionTag(tagsResult.value)
        : null;
      const remoteUpdatedAt = toIsoOrEmpty(tagData.tag_last_pushed || tagData.last_updated || "");
      const remoteDigest = String(tagData.digest || "").trim();
      return {
        checkedAt: new Date().toISOString(),
        image: `${imageRef.namespace}/${imageRef.repository}`,
        namespace: imageRef.namespace,
        repository: imageRef.repository,
        tag: imageRef.tag,
        appVersion: config.appVersion || "0.0.0",
        buildCommit: config.buildCommit || "",
        buildTime: config.buildTime || "",
        latestVersion: latestVersionTag?.semver?.version || "",
        latestVersionTag: latestVersionTag?.name || "",
        latestVersionPublishedAt: latestVersionTag?.publishedAt || "",
        remoteUpdatedAt,
        remoteDigest,
        remoteStatus: String(tagData.tag_status || "").trim(),
        remoteSizeBytes: Number(tagData.full_size || 0) || 0,
        versionUpdateAvailable: isVersionNewer(config.appVersion, latestVersionTag?.semver?.version || ""),
        updateAvailable: isRemoteNewer(config.buildTime, remoteUpdatedAt),
        sourceUrl: `https://hub.docker.com/r/${imageRef.namespace}/${imageRef.repository}/tags?name=${encodeURIComponent(imageRef.tag)}`
      };
    },
    revealProviderSecret(poolType, id, context = null) {
      const result = getPoolSecretValue(poolType, id);
      logAudit(context, {
        action: "admin.settings.secret_revealed",
        targetType: "settings",
        targetId: `${result.pool}:${result.id}`,
        summary: `查看 ${result.pool === "ai" ? "AI" : "翻译"} API Key`,
        details: {
          pool: result.pool,
          id: result.id,
          provider: result.provider || "",
          hasApiKey: Boolean(result.apiKey)
        }
      });
      return result;
    },
    revealSettingSecret(category, key, context = null) {
      const result = getSettingSecretValue(category, key);
      logAudit(context, {
        action: "admin.settings.secret_revealed",
        targetType: "settings",
        targetId: `${result.category}.${result.key}`,
        summary: `查看 ${getSecretSettingLabel(result.category, result.key)}`,
        details: {
          category: result.category,
          key: result.key,
          hasValue: Boolean(result.value)
        }
      });
      return result;
    },
    getUserSecurity(userId) {
      return getUserSecuritySnapshot(userId);
    },
    updateUser({ userId, isAdmin, status }, context = null) {
      const existingUser = getUserOrThrow(userId);

      if (typeof isAdmin === "boolean") {
        store.setUserAdmin(userId, isAdmin, status || null);
      }
      if (status) {
        store.setUserStatus(userId, status);
      }

      const updatedUser = store.getUserById(userId);
      if (updatedUser.status !== "active") {
        store.deleteUserSessions(userId);
      }
      logAudit(context, {
        action: "admin.user.updated",
        targetType: "user",
        targetId: userId,
        summary: `更新用户 ${updatedUser.email}`,
        details: {
          email: updatedUser.email,
          before: {
            isAdmin: Boolean(existingUser.is_admin),
            status: existingUser.status
          },
          after: {
            isAdmin: Boolean(updatedUser.is_admin),
            status: updatedUser.status
          }
        }
      });
      return updatedUser;
    },
    deleteUser(userId, context = null) {
      const existingUser = getUserOrThrow(userId);
      const actorUserId = Number(context?.actor?.id || 0);

      if (actorUserId && actorUserId === Number(userId)) {
        throw badRequest("不能删除当前登录账号", { code: "cannot_delete_current_user" });
      }
      if (existingUser.is_admin && store.countAdmins() <= 1) {
        throw conflict("至少保留一个管理员账号", { code: "last_admin_required" });
      }

      store.deleteUser(userId);
      const orphanCleanup = store.cleanupOrphans?.() || {};
      const orphanFeedsDeleted = Number(orphanCleanup.changes?.orphanFeedsDeleted || 0);
      logAudit(context, {
        action: "admin.user.deleted",
        targetType: "user",
        targetId: userId,
        summary: `删除用户 ${existingUser.email}`,
        details: {
          email: existingUser.email,
          isAdmin: Boolean(existingUser.is_admin),
          status: existingUser.status,
          orphanFeedsDeleted,
          orphanCleanup
        }
      });

      return {
        deleted: true,
        user: sanitizeUser(existingUser),
        orphanFeedsDeleted,
        orphanCleanup
      };
    },
    revokeUserSession(userId, sessionId, context = null) {
      const user = getUserOrThrow(userId);
      const existingSession = store.listUserSessions(userId).find((entry) => Number(entry.id) === Number(sessionId));
      if (!existingSession) {
        throw notFound("会话不存在", { code: "session_not_found" });
      }

      store.deleteSession(existingSession.token);
      const security = getUserSecuritySnapshot(userId);
      logAudit(context, {
        action: "admin.user.session.revoked",
        targetType: "session",
        targetId: existingSession.id,
        summary: `下线 ${user.email} 的会话`,
        details: {
          email: user.email,
          sessionId: existingSession.id,
          ipAddress: existingSession.ip_address || "",
          userAgent: existingSession.user_agent || ""
        }
      });

      return {
        ...security,
        revokedCount: 1
      };
    },
    revokeUserSessions(userId, context = null) {
      const user = getUserOrThrow(userId);
      const revokedCount = store.listUserSessions(userId).length;
      store.deleteUserSessions(userId);
      logAudit(context, {
        action: "admin.user.sessions.revoked",
        targetType: "user",
        targetId: userId,
        summary: `下线 ${user.email} 的全部会话`,
        details: {
          email: user.email,
          revokedCount
        }
      });

      return {
        ...getUserSecuritySnapshot(userId),
        revokedCount
      };
    },
    resetUserPassword({ userId, newPassword, revokeSessions = true }, context = null) {
      const user = getUserOrThrow(userId);
      store.setUserPassword(userId, hashPassword(newPassword));

      let revokedCount = 0;
      if (revokeSessions) {
        revokedCount = store.listUserSessions(userId).length;
        store.deleteUserSessions(userId);
      }

      const security = getUserSecuritySnapshot(userId);
      logAudit(context, {
        action: "admin.user.password.reset",
        targetType: "user",
        targetId: userId,
        summary: `重置 ${user.email} 的登录密码`,
        details: {
          email: user.email,
          revokeSessions: Boolean(revokeSessions),
          revokedCount
        }
      });

      return {
        ...security,
        revokedCount
      };
    },
    triggerGlobalRefresh(context = null) {
      if (!refreshService) {
        throw badRequest("后台刷新服务不可用", { code: "refresh_service_unavailable" });
      }

      const result = refreshService.triggerRun({
        trigger: "admin_manual",
        actor: context?.actor || null
      });

      if (result.started) {
        logAudit(context, {
          action: "admin.refresh.started",
          targetType: "refresh_run",
          targetId: result.run?.id ?? null,
          summary: "手动启动全站刷新任务",
          details: {
            runId: result.run?.id ?? null,
            totalFeeds: result.run?.totalFeeds ?? 0
          }
        });
      }

      return result;
    },
    triggerMaintenance(context = null) {
      if (!maintenanceService) {
        throw badRequest("后台维护服务不可用", { code: "maintenance_service_unavailable" });
      }

      const result = maintenanceService.triggerRun({
        trigger: "admin_manual"
      });

      if (result.started) {
        logAudit(context, {
          action: "admin.maintenance.started",
          targetType: "maintenance_run",
          targetId: result.run?.id ?? null,
          summary: "手动启动系统维护任务",
          details: {
            runId: result.run?.id ?? null
          }
        });
      }

      return result;
    },
    getDatabase() {
      return getDatabaseSnapshot();
    },
    optimizeDatabase(context = null) {
      store.optimize?.();
      logAudit(context, {
        action: "admin.database.optimized",
        targetType: "database",
        targetId: "main",
        summary: "优化数据库",
        details: getDatabaseSnapshot()
      });
      return getDatabaseSnapshot();
    },
    vacuumDatabase(context = null) {
      store.vacuum?.();
      store.setSetting?.("database_vacuum", "last_vacuum_at", new Date().toISOString());
      logAudit(context, {
        action: "admin.database.vacuumed",
        targetType: "database",
        targetId: "main",
        summary: "执行数据库碎片整理",
        details: getDatabaseSnapshot()
      });
      return getDatabaseSnapshot();
    },
    async createDatabaseBackup(context = null) {
      const backupDir = getBackupDir();
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `z7rss-${stamp}.db`;
      const targetPath = path.join(backupDir, filename);
      await store.backup?.(targetPath);
      const size = getFileSize(targetPath);
      logAudit(context, {
        action: "admin.database.backup.created",
        targetType: "database_backup",
        targetId: filename,
        summary: "创建数据库备份",
        details: {
          filename,
          size
        }
      });
      return {
        path: targetPath,
        filename,
        size
      };
    },
    getDatabaseBackup(filename) {
      return getBackupPath(filename);
    },
    deleteDatabaseBackup(filename, context = null) {
      const backup = getBackupPath(filename);
      fs.rmSync(backup.path, { force: true });
      backup.deleteRelatedFiles();
      logAudit(context, {
        action: "admin.database.backup.deleted",
        targetType: "database_backup",
        targetId: backup.filename,
        summary: `删除数据库备份 ${backup.filename}`,
        details: {
          filename: backup.filename,
          size: backup.size
        }
      });
      return {
        deleted: true,
        filename: backup.filename,
        database: getDatabaseSnapshot()
      };
    },
    updateUserSubscription({ userId, planCode, currentPeriodEnd, status }, context = null) {
      const user = getUserOrThrow(userId);

      const normalizedPlanCode = String(planCode || "").trim().toLowerCase();
      const plan = store.getPlanByCode(normalizedPlanCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      const existing = store.getUserSubscription(userId);
      const nextStatus = String(status || existing?.status || "active").trim() || "active";
      const periodEnd = normalizePeriodEnd(currentPeriodEnd);

      store.setUserSubscription({
        userId,
        planId: plan.id,
        status: nextStatus,
        provider: "admin_manual",
        providerCustomerId: existing?.provider_customer_id || null,
        providerSubscriptionId: existing?.provider_subscription_id || `admin-${userId}`,
        currentPeriodStart: existing?.current_period_start || new Date().toISOString(),
        currentPeriodEnd: periodEnd
      });

      if (feedService) {
        feedService.pruneFeedsForUser(userId);
      }

      const subscription = store.getUserSubscription(userId);
      logAudit(context, {
        action: "admin.subscription.updated",
        targetType: "subscription",
        targetId: userId,
        summary: `更新 ${user.email} 的套餐为 ${subscription.plan_code}`,
        details: {
          userEmail: user.email,
          planCode: subscription.plan_code,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end
        }
      });

      return {
        user: store.getUserById(userId),
        subscription,
        account: accountService.getAccount(store.getUserById(userId))
      };
    },
    updatePlanSettings(planCode, payload, context = null) {
      const normalizedPlanCode = String(planCode || "").trim().toLowerCase();
      const plan = store.getPlanByCode(normalizedPlanCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      const nextPlan = store.updatePlanSettings(normalizedPlanCode, {
        maxSavedItems:
          payload?.maxSavedItems === undefined
            ? undefined
            : normalizePositiveInteger(payload.maxSavedItems, "总文章保留数"),
        maxFavoriteItems:
          payload?.maxFavoriteItems === undefined
            ? undefined
            : normalizePositiveInteger(payload.maxFavoriteItems, "收藏文章上限"),
        maxFeeds:
          payload?.maxFeeds === undefined ? undefined : normalizePositiveInteger(payload.maxFeeds, "订阅源上限"),
        aiTranslationEnabled: normalizeOptionalBoolean(payload?.aiTranslationEnabled, "AI 翻译开关"),
        aiSummaryEnabled: normalizeOptionalBoolean(payload?.aiSummaryEnabled, "AI 总结开关"),
        customAiEnabled: normalizeOptionalBoolean(payload?.customAiEnabled, "自定义 AI 开关"),
        aiDigestEnabled: normalizeOptionalBoolean(payload?.aiDigestEnabled, "AI 简报开关"),
        emailDigestEnabled: normalizeOptionalBoolean(payload?.emailDigestEnabled, "邮件简报开关"),
        maxDigestRules:
          payload?.maxDigestRules === undefined
            ? undefined
            : normalizePositiveInteger(payload.maxDigestRules, "简报规则上限")
      });

      if (feedService) {
        feedService.pruneAllFeeds();
      }

      logAudit(context, {
        action: "admin.plan.updated",
        targetType: "plan",
        targetId: normalizedPlanCode,
        summary: `更新套餐 ${nextPlan.name}`,
        details: {
          code: nextPlan.code,
          maxFeeds: nextPlan.max_feeds,
          maxSavedItems: nextPlan.max_saved_items,
          maxFavoriteItems: nextPlan.max_favorite_items,
          aiTranslationEnabled: Boolean(nextPlan.ai_translation_enabled),
          aiSummaryEnabled: Boolean(nextPlan.ai_summary_enabled),
          customAiEnabled: Boolean(nextPlan.custom_ai_enabled),
          aiDigestEnabled: Boolean(nextPlan.ai_digest_enabled),
          emailDigestEnabled: Boolean(nextPlan.email_digest_enabled),
          maxDigestRules: nextPlan.max_digest_rules
        }
      });

      return nextPlan;
    },
    async reclassifyFeed(feedId, context = null, options = {}) {
      if (!feedService?.reclassifyFeed) {
        throw badRequest("订阅源分类服务不可用", { code: "classification_unavailable" });
      }
      const result = await feedService.reclassifyFeed(feedId, {
        useAi: options.useAi !== false,
        userId: context?.actor?.id || null
      });
      logAudit(context, {
        action: "admin.feed.reclassified",
        targetType: "feed",
        targetId: feedId,
        summary: `重新分类订阅源 ${result.feed.title}`,
        details: result
      });
      return result;
    },
    async reclassifyFeeds(context = null, options = {}) {
      if (!feedService?.reclassifyFeeds) {
        throw badRequest("订阅源分类服务不可用", { code: "classification_unavailable" });
      }
      const result = await feedService.reclassifyFeeds({
        useAi: options.useAi !== false,
        limit: options.limit,
        userId: context?.actor?.id || null
      });
      logAudit(context, {
        action: "admin.feeds.reclassified",
        targetType: "feed",
        targetId: "bulk",
        summary: `批量重新分类 ${result.updatedCount} 个订阅源`,
        details: result
      });
      return result;
    },
    setSettings(category, values, context = null) {
      const rows = store.listSettings();
      const current = rows.reduce((acc, row) => {
        if (!acc[row.category]) acc[row.category] = {};
        const value = isSecretSettingKey(row.key) ? secretBox.decrypt(row.value) : row.value;
        acc[row.category][row.key] = value;
        if (isSecretSettingKey(row.key)) markUnavailableSecret(acc, row.category, row.key, row.value, value);
        return acc;
      }, {});

      for (const [key, value] of Object.entries(values)) {
        let normalizedInput = String(value ?? "");
        if (isSecretSettingKey(key) && normalizedInput === "__CLEAR__") {
          store.setSetting(category, key, "");
          continue;
        }

        if (key === "configs_secret" && normalizedInput.trim()) {
          try {
            const parsed = JSON.parse(normalizedInput);
            if (Array.isArray(parsed)) {
              const hasUnavailableCurrentList = Boolean(current[category]?.configs_unavailable);
              const hasKeepPlaceholder = parsed.some((entry) => String(entry?.apiKey ?? entry?.api_key ?? "") === "__KEEP__");
              if (hasUnavailableCurrentList && (!parsed.length || hasKeepPlaceholder)) {
                throw badRequest("旧 API 列表不可用，请恢复 APP_SECRET，或重新填写 API Key 后保存新列表", {
                  code: "secret_unavailable"
                });
              }
              let currentParsed;
              try {
                currentParsed = JSON.parse(current[category]?.[key] || "[]");
              } catch (_error) {
                throw badRequest("旧 API 列表格式无效，请重新保存 API 列表", {
                  code: "invalid_provider_pool"
                });
              }
              parsed.forEach(entry => {
                if (entry.apiKey === "__KEEP__") {
                  const existing = currentParsed.find(e => e.id === entry.id);
                  entry.apiKey = existing?.apiKey || "";
                }
              });
              normalizedInput = JSON.stringify(parsed);
            }
          } catch (error) {
            if (error?.code === "secret_unavailable") throw error;
            throw badRequest("API 列表格式无效", { code: "invalid_provider_pool" });
          }
        }

        const normalizedValue =
          isSecretSettingKey(key)
            ? normalizedInput.trim()
              ? secretBox.encrypt(normalizedInput)
              : current[category]?.[key]
                ? secretBox.encrypt(current[category][key])
                : isUnavailableSecret(current, category, key)
                  ? (() => {
                      throw badRequest(`旧${getSecretSettingLabel(category, key)}不可用，请恢复 APP_SECRET，或重新填写后保存`, {
                        code: "secret_unavailable"
                      });
                    })()
                : ""
            : normalizedInput;
        store.setSetting(category, key, normalizedValue);
      }

      const settings = getSettingsMap();
      const changedKeys = Object.keys(values || {}).filter((key) => values[key] !== undefined);
      logAudit(context, {
        action: "admin.settings.updated",
        targetType: "settings",
        targetId: category,
        summary: `更新 ${category} 配置`,
        details: {
          category,
          changedKeys,
          apiKeyUpdated: changedKeys.includes("api_key")
        }
      });
      return settings;
    },
    createRedeemCode(payload, context = null) {
      const planCode = String(payload.planCode || "").trim().toLowerCase();
      const requestedCode = normalizeRedeemCode(payload.code);
      const quantity = normalizePositiveInteger(payload.quantity ?? 1, "生成数量");
      const normalizedQuantity = Math.min(Math.max(quantity, 1), 200);
      const expiresAt = payload.expiresAt || null;
      const note = String(payload.note || "");
      const prefix = String(payload.prefix || "");
      const batchId = createRedeemBatchId();

      if (!planCode) {
        throw badRequest("套餐代码不能为空，可用值：free / pro / team", { code: "plan_code_required" });
      }
      if (requestedCode && normalizedQuantity > 1) {
        throw badRequest("填写指定兑换码时只能生成 1 个", { code: "redeem_code_quantity_conflict" });
      }

      const plan = store.getPlanByCode(planCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      if (requestedCode && store.getRedeemCode(requestedCode)) {
        throw conflict("兑换码已存在，请换一个", { code: "redeem_code_exists" });
      }

      const redeemCodes = [];
      const seenCodes = new Set();
      for (let index = 0; index < normalizedQuantity; index += 1) {
        let code = index === 0 && requestedCode ? requestedCode : "";
        for (let attempt = 0; !code || store.getRedeemCode(code) || seenCodes.has(code); attempt += 1) {
          if (attempt > 20) {
            throw conflict("兑换码生成失败，请稍后重试", { code: "redeem_code_generation_failed" });
          }
          code = generateRedeemCode(prefix);
        }
        seenCodes.add(code);
        redeemCodes.push(store.createRedeemCode({
          code,
          batchId,
          planId: plan.id,
          maxUses: 1,
          expiresAt,
          isActive: payload.isActive === false ? 0 : 1,
          note
        }));
      }

      logAudit(context, {
        action: "admin.redeem-code.created",
        targetType: "redeem_code",
        targetId: redeemCodes.length === 1 ? redeemCodes[0].id : "batch",
        summary: redeemCodes.length === 1 ? `创建售卖兑换码 ${redeemCodes[0].code}` : `批量创建 ${redeemCodes.length} 个售卖兑换码`,
        details: {
          codes: redeemCodes.map((entry) => entry.code),
          batchId,
          planCode,
          maxUses: 1,
          expiresAt,
          isActive: redeemCodes.every((entry) => Boolean(entry.is_active))
        }
      });
      return {
        batchId,
        redeemCodes,
        redeemCode: redeemCodes[0] || null
      };
    },
    updateRedeemCode(payload, context = null) {
      const existing = store.listRedeemCodes().find((entry) => Number(entry.id) === Number(payload.id));
      if (!existing) {
        throw notFound("兑换码不存在", { code: "redeem_code_not_found" });
      }

      store.updateRedeemCode({
        id: Number(payload.id),
        isActive: payload.isActive ? 1 : 0,
        expiresAt: payload.expiresAt || null,
        note: String(payload.note || "")
      });

      const redeemCodes = store.listRedeemCodes();
      const updated = redeemCodes.find((entry) => Number(entry.id) === Number(payload.id)) || existing;
      logAudit(context, {
        action: "admin.redeem-code.updated",
        targetType: "redeem_code",
        targetId: updated.id,
        summary: `更新兑换码 ${updated.code}`,
        details: {
          code: updated.code,
          maxUses: 1,
          expiresAt: updated.expires_at,
          isActive: Boolean(updated.is_active)
        }
      });
      return redeemCodes;
    },
    deleteRedeemCode(id, context = null) {
      const existing = getRedeemCodeById(id);
      if (!existing) {
        throw notFound("兑换码不存在", { code: "redeem_code_not_found" });
      }
      if (Number(existing.used_count || 0) > 0) {
        throw conflict("已兑换的兑换码不能删除", { code: "redeem_code_used" });
      }

      const deletedCount = store.deleteRedeemCode(existing.id);
      if (deletedCount < 1) {
        throw conflict("兑换码已被使用，不能删除", { code: "redeem_code_used" });
      }
      logAudit(context, {
        action: "admin.redeem-code.deleted",
        targetType: "redeem_code",
        targetId: existing.id,
        summary: `删除兑换码 ${existing.code}`,
        details: {
          code: existing.code,
          batchId: getRedeemBatchId(existing),
          planCode: existing.plan_code
        }
      });
      return {
        deleted: true,
        deletedCount,
        redeemCodes: store.listRedeemCodes()
      };
    },
    deleteRedeemCodeBatch(batchId, context = null) {
      const codes = getRedeemBatch(batchId);
      if (!codes.length) {
        throw notFound("兑换码批次不存在", { code: "redeem_code_batch_not_found" });
      }

      const usedCount = codes.filter((entry) => Number(entry.used_count || 0) > 0).length;
      const deletedCount = store.deleteRedeemCodeBatch(batchId);
      logAudit(context, {
        action: "admin.redeem-code.batch-deleted",
        targetType: "redeem_code_batch",
        targetId: batchId,
        summary: `删除兑换码批次 ${codes[0]?.note || batchId}`,
        details: {
          batchId,
          deletedCount,
          retainedUsedCount: usedCount,
          totalCount: codes.length,
          codes: codes.map((entry) => entry.code)
        }
      });
      return {
        deleted: deletedCount > 0,
        deletedCount,
        retainedUsedCount: usedCount,
        redeemCodes: store.listRedeemCodes()
      };
    },
    redeemCodeForUser(userId, code) {
      const redeemCode = store.getRedeemCode(String(code || "").trim().toUpperCase());
      if (!redeemCode || !redeemCode.is_active) {
        throw badRequest("兑换码无效", { code: "redeem_code_invalid" });
      }
      if (redeemCode.expires_at && new Date(redeemCode.expires_at).getTime() < Date.now()) {
        throw badRequest("兑换码已过期", { code: "redeem_code_expired" });
      }
      if (redeemCode.used_count >= 1) {
        throw conflict("兑换码已用完", { code: "redeem_code_exhausted" });
      }
      try {
        store.useRedeemCode(redeemCode.id, userId);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw conflict("你已经使用过这个兑换码", { code: "redeem_code_already_used" });
        }
        throw error;
      }
      store.setUserSubscription({
        userId,
        planId: redeemCode.plan_id,
        status: "active",
        provider: "redeem_code",
        providerCustomerId: null,
        providerSubscriptionId: redeemCode.code,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: null
      });
      store.createBillingEvent({
        userId,
        planId: redeemCode.plan_id,
        provider: "redeem_code",
        providerCheckoutId: redeemCode.code,
        status: "paid",
        amountCents: 0,
        currency: "usd",
        checkoutUrl: null
      });
      if (feedService) {
        feedService.pruneFeedsForUser(userId);
      }
      return accountService.getAccount(store.getUserById(userId));
    },
    upsertPlugin(payload, context = null) {
      const code = String(payload.code || "").trim();
      const existing = store.listPlugins().find((entry) => entry.code === code) || null;
      const plugin = store.upsertPlugin({
        code,
        name: String(payload.name || "").trim(),
        description: String(payload.description || "").trim(),
        configJson: JSON.stringify(payload.config || {}),
        isEnabled: payload.isEnabled ? 1 : 0
      });
      logAudit(context, {
        action: existing ? "admin.plugin.updated" : "admin.plugin.created",
        targetType: "plugin",
        targetId: plugin.code,
        summary: `${existing ? "更新" : "创建"}插件 ${plugin.name}`,
        details: {
          code: plugin.code,
          name: plugin.name,
          isEnabled: Boolean(plugin.is_enabled)
        }
      });
      return plugin;
    },
    createContentRule(payload, context = null) {
      const rule = store.createContentRule({
        kind: String(payload.kind || "title"),
        pattern: String(payload.pattern || "").trim(),
        action: String(payload.action || "block"),
        isActive: payload.isActive === false ? 0 : 1
      });
      logAudit(context, {
        action: "admin.content-rule.created",
        targetType: "content_rule",
        targetId: rule.id,
        summary: `新增内容规则 ${rule.kind}:${rule.pattern}`,
        details: {
          kind: rule.kind,
          pattern: rule.pattern,
          action: rule.action,
          isActive: Boolean(rule.is_active)
        }
      });
      return rule;
    },
    toggleContentRule(id, isActive, context = null) {
      const existing = store.listContentRules().find((entry) => Number(entry.id) === Number(id));
      if (!existing) {
        throw notFound("规则不存在", { code: "content_rule_not_found" });
      }

      store.setContentRuleActive(id, isActive);
      const rules = store.listContentRules();
      const updated = rules.find((entry) => Number(entry.id) === Number(id)) || existing;
      logAudit(context, {
        action: "admin.content-rule.toggled",
        targetType: "content_rule",
        targetId: updated.id,
        summary: `${updated.is_active ? "启用" : "停用"}内容规则 ${updated.kind}:${updated.pattern}`,
        details: {
          kind: updated.kind,
          pattern: updated.pattern,
          isActive: Boolean(updated.is_active)
        }
      });
      return rules;
    },
    setBlockedSite(payload, context = null) {
      const domain = String(payload.domain || "").trim().toLowerCase();
      const existing = store.listBlockedSites().find((entry) => entry.domain === domain) || null;

      store.setBlockedSite({
        domain,
        reason: String(payload.reason || ""),
        isActive: payload.isActive === false ? 0 : 1
      });

      const blockedSites = store.listBlockedSites();
      const updated = blockedSites.find((entry) => entry.domain === domain) || existing;
      logAudit(context, {
        action: existing ? "admin.blocked-site.updated" : "admin.blocked-site.created",
        targetType: "blocked_site",
        targetId: domain,
        summary: `${existing ? "更新" : "新增"}网站屏蔽 ${domain}`,
        details: {
          domain,
          reason: updated?.reason || "",
          isActive: Boolean(updated?.is_active)
        }
      });
      return blockedSites;
    },
    setBlockedIp(payload, context = null) {
      const ip = normalizeIp(payload.ip);
      const existing = store.listBlockedIps().find((entry) => normalizeIp(entry.ip) === ip) || null;

      store.setBlockedIp({
        ip,
        reason: String(payload.reason || ""),
        isActive: payload.isActive === false ? 0 : 1
      });

      const blockedIps = store.listBlockedIps();
      const updated = blockedIps.find((entry) => normalizeIp(entry.ip) === ip) || existing;
      logAudit(context, {
        action: existing ? "admin.blocked-ip.updated" : "admin.blocked-ip.created",
        targetType: "blocked_ip",
        targetId: ip,
        summary: `${existing ? "更新" : "新增"} IP 屏蔽 ${ip}`,
        details: {
          ip,
          reason: updated?.reason || "",
          isActive: Boolean(updated?.is_active)
        }
      });
      return blockedIps;
    },
    isBlockedIp(ip) {
      const requestIp = normalizeIp(ip);
      return store.listBlockedIps().some((entry) => entry.is_active && normalizeIp(entry.ip) === requestIp);
    },
    exportUserData(userId) {
      const user = store.getUserById(userId);
      if (!user) throw notFound("用户不存在");
      const settings = store.listUserSettings(userId).map((row) => ({
        category: row.category,
        key: row.key,
        value: isSecretSettingKey(row.key) ? "" : row.value
      }));
      const feeds = store.listUserFeeds(userId).map((feed) => ({
        title: feed.title,
        url: feed.url,
        site_url: feed.site_url || "",
        category: feed.category || "",
        custom_title: feed.custom_title || "",
        is_archived: feed.is_archived || 0,
        is_collapsed: feed.is_collapsed || 0,
        is_public: feed.is_public || 0
      }));
      const digestRules = (store.listDigestRulesByUser ? store.listDigestRulesByUser(userId) : []).map((rule) => ({
        name: rule.name,
        isEnabled: Boolean(rule.is_enabled),
        sendTime: rule.send_time,
        timezone: rule.timezone,
        recipientEmails: parseJsonSafe(rule.recipient_emails, []),
        aiSource: rule.ai_source,
        prompt: rule.prompt,
        lookbackHours: Number(rule.lookback_hours || 24),
        unreadOnly: Boolean(rule.unread_only),
        feedScope: rule.feed_scope,
        feedIds: parseJsonSafe(rule.feed_ids_json, []),
        category: rule.category || ""
      }));
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        user: {
          email: user.email,
          displayName: user.display_name || ""
        },
        settings,
        feeds,
        digestRules
      };
    },
    importUserData(userId, data, context = null) {
      const user = store.getUserById(userId);
      if (!user) throw notFound("用户不存在");
      if (!data || data.version !== 1) throw badRequest("导入数据格式无效");
      let feedsImported = 0;
      let settingsImported = 0;
      let digestImported = 0;
      if (Array.isArray(data.feeds)) {
        for (const feed of data.feeds) {
          const url = String(feed.url || "").trim();
          if (!url) continue;
          try {
            feedService.addFeed(userId, { title: String(feed.title || ""), url });
            feedsImported += 1;
          } catch (_error) {
            // skip duplicate or invalid feeds
          }
        }
      }
      if (Array.isArray(data.settings)) {
        for (const setting of data.settings) {
          const category = String(setting.category || "").trim();
          const key = String(setting.key || "").trim();
          const value = String(setting.value ?? "").trim();
          if (!category || !key || isSecretSettingKey(key) || !value) continue;
          store.setUserSetting(userId, category, key, value);
          settingsImported += 1;
        }
      }
      if (Array.isArray(data.digestRules) && store.createDigestRule) {
        for (const rule of data.digestRules) {
          try {
            store.createDigestRule({
              userId,
              name: String(rule.name || "每日简报").trim().slice(0, 80),
              isEnabled: rule.isEnabled !== false ? 1 : 0,
              sendTime: String(rule.sendTime || "09:00").trim(),
              timezone: String(rule.timezone || "Asia/Shanghai").trim().slice(0, 80),
              recipientEmails: JSON.stringify(Array.isArray(rule.recipientEmails) ? rule.recipientEmails : []),
              aiSource: String(rule.aiSource || "system"),
              prompt: String(rule.prompt || "").trim().slice(0, 4000),
              lookbackHours: Number(rule.lookbackHours || 24),
              unreadOnly: rule.unreadOnly ? 1 : 0,
              feedScope: String(rule.feedScope || "all"),
              feedIdsJson: JSON.stringify(Array.isArray(rule.feedIds) ? rule.feedIds : []),
              category: rule.category || null
            });
            digestImported += 1;
          } catch (_error) {
            // skip invalid rules
          }
        }
      }
      logAudit(context, {
        action: "admin.user-data.imported",
        targetType: "user",
        targetId: userId,
        summary: `导入用户数据：${feedsImported} 订阅源，${settingsImported} 配置，${digestImported} 简报规则`,
        details: { feedsImported, settingsImported, digestImported }
      });
      return { feedsImported, settingsImported, digestImported };
    }
  };
}
