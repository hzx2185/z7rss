import fs from "node:fs";
import path from "node:path";

function cloneRun(run) {
  if (!run) return null;
  return {
    ...run,
    details: { ...(run.details || {}) }
  };
}

function getBackupDir(config) {
  return path.join(path.dirname(config.dbPath), "backups");
}

function getStoredBackupSettings(store, config) {
  const settings = store.listSettings?.().reduce((acc, row) => {
    if (row.category === "database_backup") acc[row.key] = row.value;
    return acc;
  }, {}) || {};
  const enabledValue = String(settings.enabled ?? "").trim().toLowerCase();
  const enabled = enabledValue
    ? ["1", "true", "yes", "on"].includes(enabledValue)
    : config.databaseBackupEnabled !== false;
  const frequency = String(settings.schedule_frequency || "daily").trim().toLowerCase() === "weekly" ? "weekly" : "daily";
  const scheduleTime = /^\d{2}:\d{2}$/.test(String(settings.schedule_time || "").trim())
    ? String(settings.schedule_time).trim()
    : "00:00";
  const scheduleWeekdays = String(settings.schedule_weekdays || "")
    .split(",")
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
  return {
    enabled,
    retentionDays: Math.max(0, Number(settings.retention_days ?? config.databaseBackupRetentionDays ?? 14) || 0),
    maxFiles: Math.max(1, Number(settings.max_files ?? config.databaseBackupMaxFiles ?? 24) || 24),
    scheduleFrequency: frequency,
    scheduleTime,
    scheduleWeekdays
  };
}

function getAutoBackupFiles(config) {
  const backupDir = getBackupDir(config);
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((entry) => /^z7rss-auto-.*\.db$/i.test(entry))
    .map((filename) => {
      const filePath = path.join(backupDir, filename);
      const stat = fs.statSync(filePath);
      return {
        filename,
        path: filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isAutoBackupDue(settings, autoBackups, now = new Date()) {
  if (!settings.enabled) return false;
  const [hour, minute] = String(settings.scheduleTime || "00:00").split(":").map((part) => Number(part));
  const scheduledAt = new Date(now);
  scheduledAt.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
  if (now.getTime() < scheduledAt.getTime()) return false;
  if (settings.scheduleFrequency === "weekly") {
    const weekdays = settings.scheduleWeekdays.length ? settings.scheduleWeekdays : [1];
    if (!weekdays.includes(now.getDay())) return false;
  }
  const todayKey = getLocalDateKey(now);
  return !autoBackups.some((entry) => getLocalDateKey(new Date(entry.mtimeMs)) === todayKey);
}

function getStoredVacuumSettings(store, config) {
  const settings = store.listSettings?.().reduce((acc, row) => {
    if (row.category === "database_vacuum") acc[row.key] = row.value;
    return acc;
  }, {}) || {};
  const enabledValue = String(settings.enabled ?? "").trim().toLowerCase();
  const enabled = enabledValue
    ? ["1", "true", "yes", "on"].includes(enabledValue)
    : config.databaseVacuumEnabled !== false;
  const scheduleTime = /^\d{2}:\d{2}$/.test(String(settings.schedule_time || "").trim())
    ? String(settings.schedule_time).trim()
    : config.databaseVacuumTime || "03:30";
  const intervalDays = Math.max(1, Number(settings.interval_days ?? config.databaseVacuumIntervalDays ?? 7) || 7);
  return {
    enabled,
    intervalDays,
    scheduleTime,
    lastVacuumAt: String(settings.last_vacuum_at || "").trim()
  };
}

function isAutoVacuumDue(settings, now = new Date()) {
  if (!settings.enabled) return false;
  const [hour, minute] = String(settings.scheduleTime || "03:30").split(":").map((part) => Number(part));
  const scheduledAt = new Date(now);
  scheduledAt.setHours(Number.isFinite(hour) ? hour : 3, Number.isFinite(minute) ? minute : 30, 0, 0);
  if (now.getTime() < scheduledAt.getTime()) return false;

  const lastVacuumMs = settings.lastVacuumAt ? new Date(settings.lastVacuumAt).getTime() : 0;
  if (!Number.isFinite(lastVacuumMs) || lastVacuumMs <= 0) return true;
  return now.getTime() - lastVacuumMs >= settings.intervalDays * 24 * 60 * 60 * 1000;
}

export function createMaintenanceService({ store, feedService, config, logger = console }) {
  let currentRun = null;
  let currentRunPromise = null;
  let scheduleTimer = null;
  let sequence = 0;
  const recentRuns = [];

  function rememberRun(run) {
    const snapshot = cloneRun(run);
    if (!snapshot) return null;

    const existingIndex = recentRuns.findIndex((entry) => entry.id === snapshot.id);
    if (existingIndex >= 0) {
      recentRuns.splice(existingIndex, 1);
    }
    recentRuns.unshift(snapshot);
    if (recentRuns.length > 20) {
      recentRuns.length = 20;
    }
    return snapshot;
  }

  function getStatus() {
    return {
      intervalMinutes: config.maintenanceIntervalMinutes,
      isRunning: Boolean(currentRunPromise),
      latestRun: cloneRun(currentRun || recentRuns[0] || null),
      recentRuns: recentRuns.map((entry) => cloneRun(entry))
    };
  }

  async function executeRun(run) {
    const startedAtMs = Date.now();
    const details = {
      expiredSessionsDeleted: 0,
      feedsProcessed: 0,
      itemsDeleted: 0,
      orphanFeedsDeleted: 0,
      orphanItemsDeleted: 0,
      orphanUserItemStatesDeleted: 0,
      orphanRecordsDeleted: 0,
      orphanRecordsChanged: 0,
      orphanRecordsBefore: 0,
      orphanRecordsAfter: 0,
      databaseBackupCreated: false,
      databaseBackupFilename: "",
      databaseBackupSize: 0,
      databaseBackupVerified: false,
      databaseBackupSkipReason: "",
      databaseBackupsDeleted: 0,
      auditLogsDeleted: 0,
      refreshRunsDeleted: 0,
      prunedGuidsDeleted: 0,
      databaseVacuumed: false,
      databaseVacuumSkipped: false,
      databaseVacuumSkipReason: "",
      databaseVacuumIntervalDays: 0,
      databaseVacuumScheduleTime: "",
      databaseVacuumLastRunAt: "",
      optimized: false,
      errors: []
    };

    const steps = [
      () => {
        details.expiredSessionsDeleted = Number(store.deleteExpiredSessions?.() || 0);
      },
      () => {
        const summary = feedService.pruneAllFeeds?.() || {};
        details.feedsProcessed = Number(summary.feedsProcessed || 0);
        details.itemsDeleted = Number(summary.itemsDeleted || 0);
      },
      () => {
        const cleanup = store.cleanupOrphans?.() || {};
        const changes = cleanup.changes || {};
        details.orphanFeedsDeleted = Number(changes.orphanFeedsDeleted || 0);
        details.orphanItemsDeleted = Number(changes.itemsDeleted || 0);
        details.orphanUserItemStatesDeleted =
          Number(changes.userItemStatesDeleted || 0) + Number(changes.userItemStatesDeletedAfterItems || 0);
        details.orphanRecordsDeleted = Number(changes.totalDeleted || 0);
        details.orphanRecordsChanged = Number(changes.totalChanged || 0);
        details.orphanRecordsBefore = Number(cleanup.beforeTotal || 0);
        details.orphanRecordsAfter = Number(cleanup.afterTotal || 0);
      },
      () => {
        details.auditLogsDeleted = Number(
          store.pruneAuditLogs?.({
            retentionDays: config.auditLogRetentionDays,
            maxEntries: config.auditLogMaxEntries
          }) || 0
        );
      },
      () => {
        details.refreshRunsDeleted = Number(
          store.pruneRefreshRuns?.({
            retentionDays: config.refreshRunRetentionDays,
            maxEntries: config.refreshRunMaxEntries
          }) || 0
        );
      },
      () => {
        details.prunedGuidsDeleted = Number(
          store.pruneExpiredGuids?.({
            retentionDays: 3650
          }) || 0
        );
      },
      async () => {
        const backupSettings = getStoredBackupSettings(store, config);
        if (!backupSettings.enabled || !config.dbPath || !store.backup) return;
        const backupDir = getBackupDir(config);
        fs.mkdirSync(backupDir, { recursive: true });
        const autoBackups = getAutoBackupFiles(config);
        if (!isAutoBackupDue(backupSettings, autoBackups)) {
          details.databaseBackupCreated = false;
          details.databaseBackupSkipped = true;
          details.databaseBackupSkipReason = "not_due";
        } else {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `z7rss-auto-${stamp}.db`;
          const targetPath = path.join(backupDir, filename);
          try {
            await store.backup(targetPath);
            const stat = fs.statSync(targetPath);
            details.databaseBackupCreated = true;
            details.databaseBackupVerified = true;
            details.databaseBackupFilename = filename;
            details.databaseBackupSize = stat.size;
          } catch (error) {
            fs.rmSync(targetPath, { force: true });
            details.databaseBackupSkipped = true;
            details.databaseBackupSkipReason = "verification_failed";
            throw error;
          }
        }

        const retentionDays = backupSettings.retentionDays;
        const maxFiles = backupSettings.maxFiles;
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const allAutoBackups = getAutoBackupFiles(config);
        const deleteSet = new Set();
        allAutoBackups.forEach((entry, index) => {
          if (index >= maxFiles || (retentionDays > 0 && entry.mtimeMs < cutoffMs)) deleteSet.add(entry.path);
        });
        for (const filePath of deleteSet) {
          fs.rmSync(filePath, { force: true });
          details.databaseBackupsDeleted += 1;
        }
      },
      () => {
        const vacuumSettings = getStoredVacuumSettings(store, config);
        details.databaseVacuumIntervalDays = vacuumSettings.intervalDays;
        details.databaseVacuumScheduleTime = vacuumSettings.scheduleTime;
        details.databaseVacuumLastRunAt = vacuumSettings.lastVacuumAt;
        if (!vacuumSettings.enabled) {
          details.databaseVacuumSkipped = true;
          details.databaseVacuumSkipReason = "disabled";
          return;
        }
        if (!store.vacuum) {
          details.databaseVacuumSkipped = true;
          details.databaseVacuumSkipReason = "unavailable";
          return;
        }
        const integrityCheck = store.checkIntegrity?.() || "ok";
        if (String(integrityCheck).toLowerCase() !== "ok") {
          details.databaseVacuumSkipped = true;
          details.databaseVacuumSkipReason = "integrity_failed";
          details.databaseVacuumIntegrity = String(integrityCheck || "unknown");
          return;
        }
        if (!isAutoVacuumDue(vacuumSettings)) {
          details.databaseVacuumSkipped = true;
          details.databaseVacuumSkipReason = "not_due";
          return;
        }

        store.vacuum();
        const vacuumedAt = new Date().toISOString();
        store.setSetting?.("database_vacuum", "last_vacuum_at", vacuumedAt);
        details.databaseVacuumed = true;
        details.databaseVacuumSkipped = false;
        details.databaseVacuumSkipReason = "";
        details.databaseVacuumLastRunAt = vacuumedAt;
        details.optimized = true;
      },
      () => {
        if (!details.databaseVacuumed) {
          store.optimize?.();
          details.optimized = true;
        }
      }
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        const message = String(error?.message || error || "维护任务失败");
        details.errors.push(message);
        logger.error("Maintenance step failed:", message);
      }
    }

    const finishedRun = {
      ...run,
      status: details.errors.length ? "partial_failed" : "success",
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      errorSummary: details.errors.length ? details.errors.join(" | ") : "",
      details
    };

    currentRun = rememberRun(finishedRun);
    return cloneRun(currentRun);
  }

  function triggerRun(options = {}) {
    if (currentRunPromise) {
      return {
        started: false,
        alreadyRunning: true,
        run: cloneRun(currentRun)
      };
    }

    const run = {
      id: ++sequence,
      trigger: options.trigger || "schedule",
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      errorSummary: "",
      details: {}
    };

    currentRun = rememberRun(run);
    currentRunPromise = executeRun(run).finally(() => {
      currentRunPromise = null;
    });

    return {
      started: true,
      alreadyRunning: false,
      run: cloneRun(currentRun)
    };
  }

  function startSchedule() {
    if (scheduleTimer || config.maintenanceIntervalMinutes <= 0) {
      return Boolean(scheduleTimer);
    }

    scheduleTimer = setInterval(() => {
      triggerRun({ trigger: "schedule" });
    }, config.maintenanceIntervalMinutes * 60 * 1000);

    return true;
  }

  function stopSchedule() {
    if (!scheduleTimer) return;
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }

  return {
    triggerRun,
    getStatus,
    startSchedule,
    stopSchedule,
    async waitForIdle() {
      if (!currentRunPromise) return null;
      return currentRunPromise;
    }
  };
}
