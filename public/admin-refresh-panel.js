export function createAdminRefreshPanel({
  els,
  escapeHtml,
  formatDate,
  formatDuration,
  formatRefreshStatus,
  formatRefreshTrigger,
  isAdmin,
  loadAdmin,
  safeHtml,
  safeSet,
  setStatus,
  state
}) {
  let refreshPollTimer = null
  let maintenancePollTimer = null

  function clearRefreshPolling() {
    if (!refreshPollTimer) return
    clearTimeout(refreshPollTimer)
    refreshPollTimer = null
  }

  function clearMaintenancePolling() {
    if (!maintenancePollTimer) return
    clearTimeout(maintenancePollTimer)
    maintenancePollTimer = null
  }

  function renderRefreshStatus() {
    const refresh = state.admin?.refresh
    if (!refresh || !isAdmin()) {
      safeSet(els.adminRefreshStatus, "textContent", "")
      safeHtml(els.adminRefreshMetrics, "")
      safeHtml(els.adminRefreshHistory, "")
      if (els.adminRefreshTriggerBtn) els.adminRefreshTriggerBtn.disabled = true
      return
    }

    if (els.adminRefreshTriggerBtn) els.adminRefreshTriggerBtn.disabled = Boolean(refresh.isRunning)

    const latestRun = refresh.latestRun
    safeSet(els.adminRefreshStatus, "textContent", latestRun
      ? `全站订阅源每 ${refresh.intervalMinutes} 分钟自动刷新一次。最近任务：${formatRefreshStatus(latestRun.status)}，开始于 ${formatDate(latestRun.startedAt)}。`
      : `全站订阅源每 ${refresh.intervalMinutes} 分钟自动刷新一次，当前还没有历史任务。`)

    const flags = [
      {
        tone: refresh.isRunning ? "accent" : "success",
        label: refresh.isRunning ? "后台刷新运行中" : "当前空闲"
      }
    ]

    if (latestRun) {
      flags.push({
        tone: latestRun.failedCount > 0 ? "warning" : "success",
        label: `最近结果：${formatRefreshStatus(latestRun.status)}`
      })
      flags.push({
        tone: "accent",
        label: `源数 ${latestRun.succeededCount}/${latestRun.totalFeeds}`
      })
    }

    safeHtml(els.adminRefreshMetrics, flags.map((item) => `<span class="pill ${item.tone}">${escapeHtml(item.label)}</span>`).join(""))

    const recentRuns = refresh.recentRuns || []
    safeHtml(els.adminRefreshHistory, recentRuns.length
      ? recentRuns
          .map((run) => {
            const failures = Array.isArray(run.details?.failures) ? run.details.failures : []
            return `
              <article class="list-row">
                <div class="list-main">
                  <strong>${escapeHtml(formatRefreshStatus(run.status))} · ${escapeHtml(formatRefreshTrigger(run.trigger))}</strong>
                  <span class="muted">开始：${formatDate(run.startedAt)}${run.finishedAt ? " · 完成：" + formatDate(run.finishedAt) : ""}</span>
                  <span class="muted">成功 ${run.succeededCount} / 总计 ${run.totalFeeds} · 失败 ${run.failedCount} · ${run.finishedAt ? "耗时 " + escapeHtml(formatDuration(run.durationMs)) : "进行中"}</span>
                  ${run.errorSummary ? "<span class=\"muted\">" + escapeHtml(run.errorSummary) + "</span>" : ""}
                  ${
                    failures.length
                      ? failures
                          .slice(0, 3)
                          .map(
                            (entry) =>
                              "<span class=\"muted\">失败源：" + escapeHtml(entry.title || String(entry.feedId || "-")) + " · " + escapeHtml(entry.error || "刷新失败") + "</span>"
                          )
                          .join("")
                      : ""
                  }
                </div>
                <span class="pill ${run.status === "success" ? "success" : run.status === "running" ? "accent" : "warning"}">${escapeHtml(formatRefreshStatus(run.status))}</span>
              </article>
            `
          })
          .join("")
      : '<article class="reader-empty-card"><strong>暂无刷新记录</strong><span class="muted">定时任务或手动触发后会显示在这里。</span></article>')
  }

  function syncRefreshPolling() {
    clearRefreshPolling()

    if (!isAdmin() || !state.admin?.refresh?.isRunning) {
      return
    }

    refreshPollTimer = setTimeout(async () => {
      try {
        await loadAdmin()
      } catch (error) {
        setStatus(error.message)
      }
    }, 3000)
  }

  function renderMaintenanceStatus() {
    const maintenance = state.admin?.maintenance
    if (!maintenance || !isAdmin()) {
      safeSet(els.adminMaintenanceStatus, "textContent", "")
      safeHtml(els.adminMaintenanceMetrics, "")
      safeHtml(els.adminMaintenanceHistory, "")
      if (els.adminMaintenanceTriggerBtn) els.adminMaintenanceTriggerBtn.disabled = true
      return
    }

    if (els.adminMaintenanceTriggerBtn) els.adminMaintenanceTriggerBtn.disabled = Boolean(maintenance.isRunning)

    const latestRun = maintenance.latestRun
    safeSet(els.adminMaintenanceStatus, "textContent", latestRun
      ? `系统每 ${maintenance.intervalMinutes} 分钟自动维护一次。最近任务：${formatRefreshStatus(latestRun.status)}，开始于 ${formatDate(latestRun.startedAt)}。`
      : `系统每 ${maintenance.intervalMinutes} 分钟自动维护一次，当前还没有历史任务。`)

    const details = latestRun?.details || {}
    const flags = [
      {
        tone: maintenance.isRunning ? "accent" : "success",
        label: maintenance.isRunning ? "维护运行中" : "当前空闲"
      }
    ]
    if (latestRun) {
      flags.push({ tone: "accent", label: `清理文章 ${Number(details.itemsDeleted || 0)}` })
      flags.push({
        tone: Number(details.orphanRecordsAfter || 0) > 0 ? "warning" : "success",
        label: `孤儿数据 ${Number(details.orphanRecordsBefore || 0)} -> ${Number(details.orphanRecordsAfter || 0)}`
      })
      flags.push({ tone: "accent", label: `过期会话 ${Number(details.expiredSessionsDeleted || 0)}` })
      if (details.databaseBackupCreated) {
        flags.push({ tone: "success", label: `已备份数据库` })
      }
      if (Number(details.databaseBackupsDeleted || 0) > 0) {
        flags.push({ tone: "accent", label: `轮转备份 ${Number(details.databaseBackupsDeleted || 0)}` })
      }
      flags.push({ tone: details.optimized ? "success" : "warning", label: details.optimized ? "已优化数据库" : "未优化" })
    }

    safeHtml(els.adminMaintenanceMetrics, flags.map((item) => `<span class="pill ${item.tone}">${escapeHtml(item.label)}</span>`).join(""))

    const recentRuns = maintenance.recentRuns || []
    safeHtml(els.adminMaintenanceHistory, recentRuns.length
      ? recentRuns
          .map((run) => {
            const runDetails = run.details || {}
            const errors = Array.isArray(runDetails.errors) ? runDetails.errors : []
            return `
              <article class="list-row">
                <div class="list-main">
                  <strong>${escapeHtml(formatRefreshStatus(run.status))} · ${escapeHtml(formatRefreshTrigger(run.trigger))}</strong>
                  <span class="muted">开始：${formatDate(run.startedAt)}${run.finishedAt ? " · 完成：" + formatDate(run.finishedAt) : ""}</span>
                  <span class="muted">清理文章 ${Number(runDetails.itemsDeleted || 0)} · 处理订阅源 ${Number(runDetails.feedsProcessed || 0)} · 孤儿数据 ${Number(runDetails.orphanRecordsDeleted || 0)}</span>
                  <span class="muted">自动备份 ${runDetails.databaseBackupCreated ? "已创建" : "未创建"} · 轮转删除 ${Number(runDetails.databaseBackupsDeleted || 0)}</span>
                  <span class="muted">会话 ${Number(runDetails.expiredSessionsDeleted || 0)} · 审计日志 ${Number(runDetails.auditLogsDeleted || 0)} · 刷新记录 ${Number(runDetails.refreshRunsDeleted || 0)}</span>
                  ${errors.slice(0, 3).map((error) => `<span class="muted">错误：${escapeHtml(error)}</span>`).join("")}
                </div>
                <span class="pill ${run.status === "success" ? "success" : run.status === "running" ? "accent" : "warning"}">${escapeHtml(formatRefreshStatus(run.status))}</span>
              </article>
            `
          })
          .join("")
      : '<article class="reader-empty-card"><strong>暂无维护记录</strong><span class="muted">定时维护或手动清理后会显示在这里。</span></article>')
  }

  function syncMaintenancePolling() {
    clearMaintenancePolling()

    if (!isAdmin() || !state.admin?.maintenance?.isRunning) {
      return
    }

    maintenancePollTimer = setTimeout(async () => {
      try {
        await loadAdmin()
      } catch (error) {
        setStatus(error.message)
      }
    }, 3000)
  }

  return {
    clearMaintenancePolling,
    clearRefreshPolling,
    renderMaintenanceStatus,
    renderRefreshStatus,
    syncMaintenancePolling,
    syncRefreshPolling
  }
}
