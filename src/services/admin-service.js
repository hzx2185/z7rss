import fs from "node:fs";
import path from "node:path";
import { normalizeIp } from "../lib/request.js";
import { hashPassword } from "../lib/security.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

export function createAdminService({
  store,
  accountService,
  config,
  secretBox,
  feedService,
  refreshService = null,
  maintenanceService = null
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

  function maskApiKey(output, category) {
    if (!output?.[category]) return;
    output[category].api_key_configured = Boolean(output[category].api_key);
    delete output[category].api_key;
  }

  function maskPassword(output, category) {
    if (!output?.[category]) return;
    output[category].password_configured = Boolean(output[category].password);
    delete output[category].password;
  }

  function maskTranslationProviderPool(output) {
    const pool = output?.translation_provider_pool;
    if (!pool?.configs_secret) return;
    try {
      const configs = JSON.parse(pool.configs_secret);
      pool.configs = Array.isArray(configs)
        ? configs.map((entry) => ({
            ...entry,
            api_key_configured: Boolean(entry?.apiKey || entry?.api_key)
          }))
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
        ? configs.map((entry) => ({
            ...entry,
            api_key_configured: Boolean(entry?.apiKey || entry?.api_key)
          }))
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
        system: {
          billingProvider: config.billingProvider,
          aiEnabled: config.aiEnabled
        }
      };
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
      const current = store.listSettings().reduce((acc, row) => {
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
              const currentRaw = current[category]?.[key] || "[]";
              const currentParsed = JSON.parse(currentRaw);
              parsed.forEach(entry => {
                if (entry.apiKey === "__KEEP__") {
                  const existing = currentParsed.find(e => e.id === entry.id);
                  entry.apiKey = existing?.apiKey || "";
                }
              });
              normalizedInput = JSON.stringify(parsed);
            }
          } catch (e) {}
        }

        const normalizedValue =
          isSecretSettingKey(key)
            ? normalizedInput.trim()
              ? secretBox.encrypt(normalizedInput)
              : current[category]?.[key]
                ? secretBox.encrypt(current[category][key])
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
      const code = String(payload.code || "").trim().toUpperCase();
      const planCode = String(payload.planCode || "").trim().toLowerCase();
      const maxUses = Number(payload.maxUses || 1);

      if (!code) {
        throw badRequest("兑换码不能为空", { code: "redeem_code_required" });
      }
      if (!planCode) {
        throw badRequest("套餐代码不能为空，可用值：free / pro / team", { code: "plan_code_required" });
      }
      if (!Number.isFinite(maxUses) || maxUses < 1) {
        throw badRequest("最大次数必须大于等于 1", { code: "invalid_redeem_max_uses" });
      }

      const plan = store.getPlanByCode(planCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      if (store.getRedeemCode(code)) {
        throw conflict("兑换码已存在，请换一个", { code: "redeem_code_exists" });
      }

      const redeemCode = store.createRedeemCode({
        code,
        planId: plan.id,
        maxUses,
        expiresAt: payload.expiresAt || null,
        isActive: payload.isActive === false ? 0 : 1,
        note: String(payload.note || "")
      });
      logAudit(context, {
        action: "admin.redeem-code.created",
        targetType: "redeem_code",
        targetId: redeemCode.id,
        summary: `创建兑换码 ${redeemCode.code}`,
        details: {
          code: redeemCode.code,
          planCode,
          maxUses: redeemCode.max_uses,
          expiresAt: redeemCode.expires_at,
          isActive: Boolean(redeemCode.is_active)
        }
      });
      return redeemCode;
    },
    updateRedeemCode(payload, context = null) {
      const existing = store.listRedeemCodes().find((entry) => Number(entry.id) === Number(payload.id));
      if (!existing) {
        throw notFound("兑换码不存在", { code: "redeem_code_not_found" });
      }

      store.updateRedeemCode({
        id: Number(payload.id),
        isActive: payload.isActive ? 1 : 0,
        maxUses: Number(payload.maxUses || 1),
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
          maxUses: updated.max_uses,
          expiresAt: updated.expires_at,
          isActive: Boolean(updated.is_active)
        }
      });
      return redeemCodes;
    },
    redeemCodeForUser(userId, code) {
      const redeemCode = store.getRedeemCode(String(code || "").trim().toUpperCase());
      if (!redeemCode || !redeemCode.is_active) {
        throw badRequest("兑换码无效", { code: "redeem_code_invalid" });
      }
      if (redeemCode.expires_at && new Date(redeemCode.expires_at).getTime() < Date.now()) {
        throw badRequest("兑换码已过期", { code: "redeem_code_expired" });
      }
      if (redeemCode.used_count >= redeemCode.max_uses) {
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
