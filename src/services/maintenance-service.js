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
  return {
    enabled,
    retentionDays: Math.max(0, Number(settings.retention_days ?? config.databaseBackupRetentionDays ?? 14) || 0),
    maxFiles: Math.max(1, Number(settings.max_files ?? config.databaseBackupMaxFiles ?? 24) || 24)
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
      databaseBackupsDeleted: 0,
      auditLogsDeleted: 0,
      refreshRunsDeleted: 0,
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
      async () => {
        const backupSettings = getStoredBackupSettings(store, config);
        if (!backupSettings.enabled || !config.dbPath || !store.backup) return;
        const backupDir = getBackupDir(config);
        fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `z7rss-auto-${stamp}.db`;
        const targetPath = path.join(backupDir, filename);
        await store.backup(targetPath);
        const stat = fs.statSync(targetPath);
        details.databaseBackupCreated = true;
        details.databaseBackupFilename = filename;
        details.databaseBackupSize = stat.size;

        const retentionDays = backupSettings.retentionDays;
        const maxFiles = backupSettings.maxFiles;
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const autoBackups = getAutoBackupFiles(config);
        const deleteSet = new Set();
        autoBackups.forEach((entry, index) => {
          if (index >= maxFiles || (retentionDays > 0 && entry.mtimeMs < cutoffMs)) deleteSet.add(entry.path);
        });
        for (const filePath of deleteSet) {
          fs.rmSync(filePath, { force: true });
          details.databaseBackupsDeleted += 1;
        }
      },
      () => {
        store.optimize?.();
        details.optimized = true;
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
