function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

export function createRefreshService({ store, feedService, config, logger = console }) {
  let currentRunId = null;
  let currentRunPromise = null;
  let scheduleTimer = null;

  function sanitizeActor(actor = null) {
    return {
      actorUserId: actor?.id ?? null,
      actorEmail: String(actor?.email || "").trim().toLowerCase(),
      actorDisplayName: String(actor?.displayName || "").trim()
    };
  }

  function serializeRun(run) {
    if (!run) return null;
    const details = parseJsonSafe(run.details_json, {});
    return {
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      totalFeeds: Number(run.total_feeds || 0),
      succeededCount: Number(run.succeeded_count || 0),
      failedCount: Number(run.failed_count || 0),
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      durationMs: run.duration_ms === null || run.duration_ms === undefined ? null : Number(run.duration_ms),
      errorSummary: run.error_summary || "",
      actor: {
        userId: run.actor_user_id ?? null,
        email: run.actor_email || "",
        displayName: run.actor_display_name || ""
      },
      details
    };
  }

  function getRunSnapshot(runId = null) {
    if (runId) {
      return serializeRun(store.getRefreshRunById(runId));
    }
    return serializeRun(store.getLatestRefreshRun());
  }

  async function executeRun(runId, feeds) {
    const startedAt = Date.now();
    let succeededCount = 0;
    let failedCount = 0;
    const failures = [];

    try {
      for (const feed of feeds) {
        try {
          await feedService.refreshGlobalFeed(feed.id);
          succeededCount += 1;
        } catch (error) {
          failedCount += 1;
          if (failures.length < 8) {
            failures.push({
              feedId: feed.id,
              title: String(feed.title || "").trim(),
              error: String(error?.message || "刷新失败")
            });
          }
          logger.error(`Refresh failed for feed ${feed.id}:`, error?.message || error);
        }
      }

      const finishedAt = new Date().toISOString();
      const status = failedCount === 0 ? "success" : succeededCount > 0 || feeds.length === 0 ? "partial_failed" : "failed";
      store.updateRefreshRun({
        id: runId,
        status,
        succeededCount,
        failedCount,
        finishedAt,
        durationMs: Date.now() - startedAt,
        errorSummary: failedCount ? `${failedCount} 个订阅源刷新失败` : "",
        detailsJson: JSON.stringify({ failures })
      });
      return getRunSnapshot(runId);
    } catch (error) {
      const finishedAt = new Date().toISOString();
      store.updateRefreshRun({
        id: runId,
        status: "failed",
        succeededCount,
        failedCount,
        finishedAt,
        durationMs: Date.now() - startedAt,
        errorSummary: String(error?.message || "刷新任务失败"),
        detailsJson: JSON.stringify({ failures })
      });
      throw error;
    }
  }

  function triggerRun(options = {}) {
    if (currentRunPromise) {
      return {
        started: false,
        alreadyRunning: true,
        run: getRunSnapshot(currentRunId)
      };
    }

    const feeds = store.listRefreshableFeeds();
    const actor = sanitizeActor(options.actor);
    const run = store.createRefreshRun({
      trigger: options.trigger || "schedule",
      status: "running",
      totalFeeds: feeds.length,
      succeededCount: 0,
      failedCount: 0,
      actorUserId: actor.actorUserId,
      actorEmail: actor.actorEmail,
      actorDisplayName: actor.actorDisplayName,
      startedAt: new Date().toISOString(),
      detailsJson: JSON.stringify({ failures: [] })
    });

    currentRunId = run.id;
    currentRunPromise = executeRun(run.id, feeds)
      .catch((error) => {
        logger.error("Refresh run failed:", error?.message || error);
        return getRunSnapshot(run.id);
      })
      .finally(() => {
        currentRunId = null;
        currentRunPromise = null;
      });

    return {
      started: true,
      alreadyRunning: false,
      run: getRunSnapshot(run.id)
    };
  }

  function getStatus() {
    const recentRuns = store.listRefreshRuns(10).map((run) => serializeRun(run));
    const latestRun = currentRunId ? getRunSnapshot(currentRunId) || recentRuns[0] || null : recentRuns[0] || null;
    return {
      intervalMinutes: config.refreshMinutes,
      isRunning: Boolean(currentRunPromise),
      latestRun,
      recentRuns
    };
  }

  function recoverInterruptedRuns() {
    store.interruptRunningRefreshRuns("服务重启，中断了上一次刷新任务");
  }

  function startSchedule() {
    if (scheduleTimer || config.refreshMinutes <= 0) {
      return Boolean(scheduleTimer);
    }

    scheduleTimer = setInterval(() => {
      triggerRun({ trigger: "schedule" });
    }, config.refreshMinutes * 60 * 1000);

    return true;
  }

  function stopSchedule() {
    if (!scheduleTimer) return;
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }

  recoverInterruptedRuns();

  return {
    triggerRun,
    getStatus,
    recoverInterruptedRuns,
    startSchedule,
    stopSchedule,
    async waitForIdle() {
      if (!currentRunPromise) return null;
      return currentRunPromise;
    }
  };
}
