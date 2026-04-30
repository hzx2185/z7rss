import {
  api,
  escapeHtml,
  formatDate,
  safeHtml,
  safeSet
} from "./shared-ui.js"
import {
  formatDuration,
  formatRefreshStatus,
  formatRefreshTrigger
} from "./admin-formatters.js"
import { getAdminUserSecurityState } from "./admin-user-security.js"
import { getAdminElements } from "./admin-elements.js"
import { createAdminRefreshPanel } from "./admin-refresh-panel.js"
import { createAdminDashboard } from "./admin-dashboard.js"

const state = {
  me: null,
  admin: null,
  config: null,
  expandedUserSecurityId: null,
  userSecurity: {}
}

const els = getAdminElements()

function setStatus(message = "", tone = "info") {
  if (!els.statusBox || !els.statusText) return
  els.statusText.textContent = String(message || "")
  els.statusBox.dataset.tone = tone
  els.statusBox.classList.toggle("hidden", !message)
}

function isAdmin() {
  return Boolean(state.me?.user?.isAdmin)
}

function getUserSecurityState(userId) {
  return getAdminUserSecurityState(state.userSecurity, userId)
}

const refreshPanel = createAdminRefreshPanel({
  els,
  escapeHtml,
  formatDate,
  formatDuration,
  formatRefreshStatus,
  formatRefreshTrigger,
  isAdmin: () => isAdmin(),
  loadAdmin: () => loadAdmin(),
  safeHtml,
  safeSet,
  setStatus,
  state
})

const {
  clearMaintenancePolling,
  clearRefreshPolling,
  renderMaintenanceStatus,
  renderRefreshStatus,
  syncMaintenancePolling,
  syncRefreshPolling
} = refreshPanel

const dashboard = createAdminDashboard({
  actions: {
    deleteUser: (...args) => deleteUser(...args),
    resetUserPassword: (...args) => resetUserPassword(...args),
    revokeAllUserSessions: (...args) => revokeAllUserSessions(...args),
    revokeUserSession: (...args) => revokeUserSession(...args),
    savePlanSettings: (...args) => savePlanSettings(...args),
    deleteBackupFile: (...args) => deleteBackupFile(...args),
    downloadBackupFile: (...args) => downloadBackupFile(...args),
    reclassifyFeed: (...args) => reclassifyFeed(...args),
    saveRedeemCode: (...args) => saveRedeemCode(...args),
    toggleBlockedIp: (...args) => toggleBlockedIp(...args),
    toggleBlockedSite: (...args) => toggleBlockedSite(...args),
    togglePlugin: (...args) => togglePlugin(...args),
    toggleRule: (...args) => toggleRule(...args),
    toggleUserSecurity: (...args) => toggleUserSecurity(...args),
    updateUser: (...args) => updateUser(...args),
    updateUserSubscription: (...args) => updateUserSubscription(...args)
  },
  els,
  isAdmin: () => isAdmin(),
  renderMaintenanceStatus,
  renderRefreshStatus,
  state,
  syncMaintenancePolling,
  syncRefreshPolling
})

const {
  renderAdminDashboard,
  renderAuthState,
  renderSidebarInfo
} = dashboard

async function loadConfig() {
  state.config = await api("/api/config")
  renderSidebarInfo()
}

async function loadMe() {
  const result = await api("/api/auth/me")
  state.me = result.authenticated ? result : null
  renderAuthState()
}

async function loadAdmin() {
  if (!isAdmin()) {
    state.admin = null
    state.expandedUserSecurityId = null
    state.userSecurity = {}
    renderAdminDashboard()
    return
  }
  state.admin = await api("/api/admin/dashboard")
  renderAdminDashboard()
}

async function startGlobalRefresh() {
  try {
    const result = await api("/api/admin/refresh", {
      method: "POST"
    })
    await loadAdmin()
    setStatus(result.started ? "全站刷新任务已启动" : "已有刷新任务在运行，已切换到当前任务状态")
  } catch (error) {
    setStatus(error.message)
  }
}

async function startMaintenance() {
  try {
    const result = await api("/api/admin/maintenance", {
      method: "POST"
    })
    await loadAdmin()
    syncMaintenancePolling()
    setStatus(result.started ? "数据库维护任务已启动" : "已有维护任务在运行，已切换到当前任务状态")
  } catch (error) {
    setStatus(error.message)
  }
}

async function startDatabaseCleanup() {
  try {
    const result = await api("/api/admin/database/cleanup", {
      method: "POST"
    })
    await loadAdmin()
    syncMaintenancePolling()
    setStatus(result.started ? "数据库清理任务已启动" : "已有清理任务在运行，已切换到当前任务状态")
  } catch (error) {
    setStatus(error.message)
  }
}

async function optimizeDatabase() {
  try {
    state.admin.database = await api("/api/admin/database/optimize", {
      method: "POST"
    })
    await loadAdmin()
    setStatus("数据库已优化", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function vacuumDatabase() {
  if (!window.confirm("碎片整理会短暂占用数据库，建议在低峰期执行。确认继续吗？")) {
    return
  }

  try {
    setStatus("正在整理数据库碎片...", "info")
    state.admin.database = await api("/api/admin/database/vacuum", {
      method: "POST"
    })
    await loadAdmin()
    setStatus("数据库碎片整理已完成", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function backupDatabase() {
  try {
    setStatus("正在生成数据库备份...", "info")
    const response = await fetch("/api/admin/database/backup", {
      credentials: "same-origin"
    })
    if (!response.ok) {
      let message = "备份失败"
      try {
        const payload = await response.json()
        message = payload.error || message
      } catch (_error) {}
      throw new Error(message)
    }
    const blob = await response.blob()
    const disposition = response.headers.get("content-disposition") || ""
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/i)
    const filename = filenameMatch?.[1] || `z7rss-backup-${Date.now()}.db`
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    await loadAdmin()
    setStatus("数据库备份已生成", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

function downloadBackupFile(filename) {
  const link = document.createElement("a")
  link.href = `/api/admin/database/backups/${encodeURIComponent(filename)}`
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function deleteBackupFile(filename) {
  if (!window.confirm(`确认删除备份 ${filename} 吗？`)) return
  try {
    await api(`/api/admin/database/backups/${encodeURIComponent(filename)}`, {
      method: "DELETE"
    })
    await loadAdmin()
    setStatus("备份文件已删除", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function saveDatabaseBackupSettings() {
  try {
    await api("/api/admin/settings/database_backup", {
      method: "POST",
      body: JSON.stringify({
        enabled: els.settingDatabaseBackupEnabled.value,
        retention_days: els.settingDatabaseBackupRetentionDays.value,
        max_files: els.settingDatabaseBackupMaxFiles.value
      })
    })
    await loadAdmin()
    setStatus("数据库备份设置已保存", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function loadUserSecurity(userId) {
  state.userSecurity[userId] = {
    loading: true,
    data: null,
    error: ""
  }
  renderAdminDashboard()

  try {
    const result = await api(`/api/admin/users/${userId}/security`)
    state.userSecurity[userId] = {
      loading: false,
      data: result,
      error: ""
    }
    renderAdminDashboard()
  } catch (error) {
    state.userSecurity[userId] = {
      loading: false,
      data: null,
      error: error.message
    }
    renderAdminDashboard()
    setStatus(error.message)
  }
}

async function toggleUserSecurity(userId) {
  if (state.expandedUserSecurityId === userId) {
    state.expandedUserSecurityId = null
    renderAdminDashboard()
    return
  }

  state.expandedUserSecurityId = userId
  renderAdminDashboard()
  const securityState = getUserSecurityState(userId)
  if (!securityState.loading && !securityState.data) {
    await loadUserSecurity(userId)
  }
}

async function updateUser(userId, payload) {
  try {
    await api(`/api/admin/users/${userId}`, {
      method: "POST",
      body: JSON.stringify(payload)
    })
    await loadAdmin()
    setStatus("用户已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function deleteUser(userId, userLabel = "") {
  const label = String(userLabel || `#${userId}`)
  if (!window.confirm(`确认删除用户“${label}”吗？删除后账号及其关联会话、订阅和偏好设置将被永久移除。`)) {
    return
  }

  try {
    await api(`/api/admin/users/${userId}`, {
      method: "DELETE"
    })
    delete state.userSecurity[userId]
    if (state.expandedUserSecurityId === userId) {
      state.expandedUserSecurityId = null
    }
    await loadAdmin()
    setStatus(`用户 ${label} 已删除`, "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function resetUserPassword(userId) {
  const newPassword = document.querySelector(`[data-user-new-password="${userId}"]`)?.value || ""

  try {
    const result = await api(`/api/admin/users/${userId}/password`, {
      method: "POST",
      body: JSON.stringify({
        newPassword,
        revokeSessions: true
      })
    })
    state.userSecurity[userId] = {
      loading: false,
      data: result,
      error: ""
    }
    const passwordInput = document.querySelector(`[data-user-new-password="${userId}"]`)
    if (passwordInput) passwordInput.value = ""
    await loadAdmin()
    setStatus(result.revokedCount > 0 ? `密码已重置，并下线 ${result.revokedCount} 个会话` : "密码已重置")
  } catch (error) {
    setStatus(error.message)
  }
}

async function revokeAllUserSessions(userId) {
  try {
    const result = await api(`/api/admin/users/${userId}/sessions/revoke`, {
      method: "POST"
    })
    state.userSecurity[userId] = {
      loading: false,
      data: result,
      error: ""
    }
    await loadAdmin()
    setStatus(result.revokedCount > 0 ? `已下线 ${result.revokedCount} 个会话` : "该用户当前没有活跃会话")
  } catch (error) {
    setStatus(error.message)
  }
}

async function revokeUserSession(userId, sessionId) {
  try {
    const result = await api(`/api/admin/users/${userId}/sessions/${sessionId}/revoke`, {
      method: "POST"
    })
    state.userSecurity[userId] = {
      loading: false,
      data: result,
      error: ""
    }
    await loadAdmin()
    setStatus("会话已下线")
  } catch (error) {
    setStatus(error.message)
  }
}

async function updateUserSubscription(userId, planCode, currentPeriodEnd) {
  try {
    await api(`/api/admin/users/${userId}/subscription`, {
      method: "POST",
      body: JSON.stringify({ planCode, currentPeriodEnd, status: "active" })
    })
    await loadAdmin()
    setStatus("会员套餐已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function savePlanSettings(planCode) {
  try {
    const maxFeeds = Number(document.querySelector(`[data-plan-feeds="${planCode}"]`)?.value || 0)
    const maxSavedItems = Number(document.querySelector(`[data-plan-saved="${planCode}"]`)?.value || 0)
    const maxFavoriteItems = Number(document.querySelector(`[data-plan-favorite="${planCode}"]`)?.value || 0)
    const aiTranslationEnabled = Boolean(document.querySelector(`[data-plan-translation="${planCode}"]`)?.checked)
    const aiSummaryEnabled = Boolean(document.querySelector(`[data-plan-summary="${planCode}"]`)?.checked)
    const customAiEnabled = Boolean(document.querySelector(`[data-plan-custom-ai="${planCode}"]`)?.checked)
    const aiDigestEnabled = Boolean(document.querySelector(`[data-plan-digest="${planCode}"]`)?.checked)
    const emailDigestEnabled = Boolean(document.querySelector(`[data-plan-email-digest="${planCode}"]`)?.checked)
    const maxDigestRules = Number(document.querySelector(`[data-plan-digest-rules="${planCode}"]`)?.value || 0)
    await api(`/api/admin/plans/${planCode}`, {
      method: "POST",
      body: JSON.stringify({ maxFeeds, maxSavedItems, maxFavoriteItems, aiTranslationEnabled, aiSummaryEnabled, customAiEnabled, aiDigestEnabled, emailDigestEnabled, maxDigestRules })
    })
    await loadAdmin()
    setStatus("套餐设置已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function reclassifyFeed(feedId) {
  try {
    const result = await api(`/api/admin/feeds/${feedId}/reclassify`, {
      method: "POST",
      body: JSON.stringify({ useAi: true })
    })
    await loadAdmin()
    setStatus(`已分类为 ${result.category}`, "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function saveRedeemCode(id, isActiveOverride = null) {
  const current = state.admin?.redeemCodes?.find((entry) => entry.id === id)
  if (!current) {
    setStatus("兑换码不存在")
    return
  }

  try {
    const maxUses = Number(document.querySelector(`[data-redeem-max="${id}"]`)?.value || current.max_uses || 1)
    const expiresAt = document.querySelector(`[data-redeem-expire="${id}"]`)?.value || ""
    const note = document.querySelector(`[data-redeem-note="${id}"]`)?.value || ""
    await api(`/api/admin/redeem-codes/${id}`, {
      method: "POST",
      body: JSON.stringify({
        maxUses,
        expiresAt: expiresAt || null,
        note,
        isActive: typeof isActiveOverride === "boolean" ? isActiveOverride : Boolean(current.is_active)
      })
    })
    await loadAdmin()
    setStatus("兑换码已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function togglePlugin(code) {
  const plugin = state.admin?.plugins?.find((entry) => entry.code === code)
  if (!plugin) {
    setStatus("插件不存在")
    return
  }

  try {
    await api("/api/admin/plugins", {
      method: "POST",
      body: JSON.stringify({
        code: plugin.code,
        name: plugin.name,
        description: plugin.description,
        config: plugin.config || {},
        isEnabled: !plugin.is_enabled
      })
    })
    await loadAdmin()
    setStatus("插件状态已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function toggleBlockedSite(domain, isActive) {
  const entry = state.admin?.blockedSites?.find((item) => item.domain === domain)
  if (!entry) {
    setStatus("网站屏蔽记录不存在")
    return
  }

  try {
    await api("/api/admin/blocked-sites", {
      method: "POST",
      body: JSON.stringify({
        domain: entry.domain,
        reason: entry.reason || "",
        isActive
      })
    })
    await loadAdmin()
    setStatus("网站屏蔽状态已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function toggleBlockedIp(ip, isActive) {
  const entry = state.admin?.blockedIps?.find((item) => item.ip === ip)
  if (!entry) {
    setStatus("IP 屏蔽记录不存在")
    return
  }

  try {
    await api("/api/admin/blocked-ips", {
      method: "POST",
      body: JSON.stringify({
        ip: entry.ip,
        reason: entry.reason || "",
        isActive
      })
    })
    await loadAdmin()
    setStatus("IP 屏蔽状态已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function toggleRule(ruleId, isActive) {
  try {
    await api(`/api/admin/content-rules/${ruleId}/toggle`, {
      method: "POST",
      body: JSON.stringify({ isActive })
    })
    await loadAdmin()
    setStatus("规则已更新")
  } catch (error) {
    setStatus(error.message)
  }
}

async function boot() {
  initTabSwitch()
  await loadConfig()
  await loadMe()
  await loadAdmin()
  if (!state.me?.user) {
    setStatus("请先登录管理员账号", "info")
  } else if (!isAdmin()) {
    setStatus("当前账号没有管理员权限", "warning")
  } else {
    setStatus("后台已就绪", "success")
  }
}

function initTabSwitch() {
  document.querySelectorAll('[data-switch-tab]').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault()
      var tabId = this.dataset.switchTab
      document.querySelectorAll('.admin-nav-item').forEach(function(n) { n.classList.remove('active') })
      document.querySelectorAll('.admin-section').forEach(function(s) { s.classList.add('hidden') })
      this.classList.add('active')
      var panel = document.getElementById(tabId)
      if (panel) panel.classList.remove('hidden')
    })
  })
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  setStatus("登录中...", "info")
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#login-email").value,
        password: document.querySelector("#login-password").value
      })
    })
    await boot()
  } catch (error) {
    setStatus(error.message, "error")
  }
})

els.logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" })
    state.me = null
    state.admin = null
    state.expandedUserSecurityId = null
    state.userSecurity = {}
    clearMaintenancePolling()
    clearRefreshPolling()
    renderAuthState()
    renderAdminDashboard()
    setStatus("已退出", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
})

els.adminRefreshTriggerBtn.addEventListener("click", async () => {
  await startGlobalRefresh()
})

els.adminMaintenanceTriggerBtn.addEventListener("click", async () => {
  await startMaintenance()
})

els.adminDatabaseCleanupBtn.addEventListener("click", async () => {
  await startDatabaseCleanup()
})

els.adminDatabaseOptimizeBtn.addEventListener("click", async () => {
  await optimizeDatabase()
})

els.adminDatabaseVacuumBtn.addEventListener("click", async () => {
  await vacuumDatabase()
})

els.adminDatabaseBackupBtn.addEventListener("click", async () => {
  await backupDatabase()
})

els.adminDatabaseBackupSettingsSaveBtn.addEventListener("click", async () => {
  await saveDatabaseBackupSettings()
})

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    await api("/api/admin/settings/general", {
      method: "POST",
      body: JSON.stringify({
        site_name: els.settingSiteName.value,
        site_domain: els.settingSiteDomain.value
      })
    })
    await api("/api/admin/settings/mail", {
      method: "POST",
      body: JSON.stringify({
        from: els.settingMailFrom.value,
        host: els.settingMailHost.value,
        port: els.settingMailPort.value,
        username: els.settingMailUsername.value,
        password: els.settingMailPassword.value
      })
    })
    await api("/api/admin/settings/ai", {
      method: "POST",
      body: JSON.stringify({
        base_url: els.settingAiBaseUrl.value,
        api_key: els.settingAiApiKey.value,
        model: els.settingAiModel.value,
        translate_prompt: els.settingAiTranslatePrompt.value,
        summary_prompt: els.settingAiSummaryPrompt.value
      })
    })
    await api("/api/admin/settings/digest", {
      method: "POST",
      body: JSON.stringify({
        input_mode: els.settingDigestInputMode.value,
        max_items: els.settingDigestMaxItems.value,
        max_chars_per_item: els.settingDigestMaxCharsPerItem.value,
        max_total_chars: els.settingDigestMaxTotalChars.value
      })
    })
    await api("/api/admin/settings/translation", {
      method: "POST",
      body: JSON.stringify({
        provider: els.settingTranslationProvider.value,
        target_language: els.settingTranslationTarget.value
      })
    })
    await api("/api/admin/settings/translation_google", {
      method: "POST",
      body: JSON.stringify({
        base_url: els.settingGoogleTranslateBaseUrl.value,
        api_key: els.settingGoogleTranslateApiKey.value
      })
    })
    await api("/api/admin/settings/translation_deeplx", {
      method: "POST",
      body: JSON.stringify({
        base_url: els.settingDeepLXBaseUrl.value,
        api_key: els.settingDeepLXApiKey.value
      })
    })
    await api("/api/admin/settings/translation_bing", {
      method: "POST",
      body: JSON.stringify({
        base_url: els.settingBingTranslateBaseUrl.value,
        api_key: els.settingBingTranslateApiKey.value,
        region: els.settingBingTranslateRegion.value
      })
    })
    await loadAdmin()
    setStatus("系统配置已保存")
  } catch (error) {
    setStatus(error.message)
  }
})

els.settingAiTestBtn.addEventListener("click", async () => {
  try {
    const result = await api("/api/admin/ai/test", { method: "POST" })
    setStatus(`默认 AI 测试成功: ${result.output}`)
  } catch (error) {
    setStatus(error.message)
  }
})

els.redeemCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    await api("/api/admin/redeem-codes", {
      method: "POST",
      body: JSON.stringify({
        code: els.adminRedeemCode.value.trim(),
        planCode: els.adminRedeemPlan.value,
        maxUses: Number(els.adminRedeemMax.value || 1),
        expiresAt: els.adminRedeemExpire.value || null,
        note: els.adminRedeemNote.value.trim()
      })
    })
    els.adminRedeemCode.value = ""
    els.adminRedeemMax.value = "1"
    els.adminRedeemExpire.value = ""
    els.adminRedeemNote.value = ""
    await loadAdmin()
    setStatus("兑换码已创建")
  } catch (error) {
    setStatus(error.message)
  }
})

els.pluginForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    const rawConfig = els.pluginConfig.value.trim()
    const config = rawConfig ? JSON.parse(rawConfig) : {}
    if (config === null || Array.isArray(config) || typeof config !== "object") {
      throw new Error("插件配置 JSON 必须是对象")
    }
    await api("/api/admin/plugins", {
      method: "POST",
      body: JSON.stringify({
        code: els.pluginCode.value.trim(),
        name: els.pluginName.value.trim(),
        description: els.pluginDescription.value.trim(),
        config,
        isEnabled: els.pluginEnabled.value === "1"
      })
    })
    els.pluginCode.value = ""
    els.pluginName.value = ""
    els.pluginDescription.value = ""
    els.pluginConfig.value = ""
    els.pluginEnabled.value = "1"
    await loadAdmin()
    setStatus("插件已保存")
  } catch (error) {
    setStatus(error.message)
  }
})

els.ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    await api("/api/admin/content-rules", {
      method: "POST",
      body: JSON.stringify({
        kind: els.ruleKind.value,
        pattern: els.rulePattern.value.trim(),
        action: "block",
        isActive: true
      })
    })
    els.rulePattern.value = ""
    await loadAdmin()
    setStatus("过滤规则已创建")
  } catch (error) {
    setStatus(error.message)
  }
})

els.siteBlockForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    await api("/api/admin/blocked-sites", {
      method: "POST",
      body: JSON.stringify({
        domain: els.blockedSiteDomain.value.trim(),
        reason: els.blockedSiteReason.value.trim(),
        isActive: true
      })
    })
    els.blockedSiteDomain.value = ""
    els.blockedSiteReason.value = ""
    await loadAdmin()
    setStatus("网站屏蔽已保存")
  } catch (error) {
    setStatus(error.message)
  }
})

els.ipBlockForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    await api("/api/admin/blocked-ips", {
      method: "POST",
      body: JSON.stringify({
        ip: els.blockedIp.value.trim(),
        reason: els.blockedIpReason.value.trim(),
        isActive: true
      })
    })
    els.blockedIp.value = ""
    els.blockedIpReason.value = ""
    await loadAdmin()
    setStatus("IP 屏蔽已保存")
  } catch (error) {
    setStatus(error.message)
  }
})

boot().catch((error) => {
  setStatus(error.message)
})
