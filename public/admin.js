import {
  api,
  escapeHtml,
  formatDate,
  safeHtml,
  safeSet
} from "./shared-ui.js?v=2"
import {
  formatDuration,
  formatRefreshStatus,
  formatRefreshTrigger
} from "./admin-formatters.js?v=2"
import { getAdminUserSecurityState } from "./admin-user-security.js?v=2"
import { getAdminElements } from "./admin-elements.js?v=2"
import { createAdminRefreshPanel } from "./admin-refresh-panel.js?v=2"
import { createAdminDashboard } from "./admin-dashboard.js?v=2"

const state = {
  me: null,
  admin: null,
  config: null,
  translationProviderPoolDraft: [],
  aiProviderPoolDraft: [],
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
    exportUserData: (...args) => exportUserData(...args),
    importUserData: (...args) => importUserData(...args),
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
    editTranslationProviderPoolEntry: (...args) => editTranslationProviderPoolEntry(...args),
    removeTranslationProviderPoolEntry: (...args) => removeTranslationProviderPoolEntry(...args),
    editAiPoolEntry: (...args) => editAiPoolEntry(...args),
    removeAiPoolEntry: (...args) => removeAiPoolEntry(...args),
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
  state.translationProviderPoolDraft = getTranslationProviderPoolFromSettings()
  state.aiProviderPoolDraft = getAiProviderPoolFromSettings()
  renderAdminDashboard()
}

function getTranslationProviderPoolFromSettings() {
  const configs = state.admin?.settings?.translation_provider_pool?.configs
  return (Array.isArray(configs) ? configs : []).map((entry, index) => ({
    id: String(entry.id || `${entry.provider || "provider"}-${index + 1}`),
    provider: String(entry.provider || "deeplx"),
    name: String(entry.name || ""),
    baseUrl: String(entry.baseUrl || entry.base_url || ""),
    region: String(entry.region || ""),
    enabled: entry.enabled !== false,
    priority: Number(entry.priority || index + 1),
    apiKeyConfigured: Boolean(entry.api_key_configured || entry.apiKeyConfigured),
    apiKey: String(entry.apiKey || entry.api_key || "")
  })).sort((a, b) => a.priority - b.priority)
}

function openTranslationPoolModal() {
  els.adminTranslationPoolModal?.classList.remove("hidden")
  els.adminTranslationPoolModal?.setAttribute("aria-hidden", "false")
  document.body.classList.add("admin-modal-open")
}

function closeTranslationPoolModal() {
  if (els.adminTranslationPoolModal?.contains(document.activeElement)) {
    document.activeElement.blur()
  }
  els.adminTranslationPoolModal?.classList.add("hidden")
  els.adminTranslationPoolModal?.setAttribute("aria-hidden", "true")
  document.body.classList.remove("admin-modal-open")
}

function updateTranslationPoolProviderFields() {
  const provider = els.settingTranslationProviderPoolProvider?.value || "deeplx"
  const showRegion = provider === "bing"
  if (els.settingTranslationProviderPoolRegionRow) {
    els.settingTranslationProviderPoolRegionRow.classList.toggle("hidden", !showRegion)
  }
  if (!showRegion && els.settingTranslationProviderPoolRegion) {
    els.settingTranslationProviderPoolRegion.value = ""
  }
  if (els.settingTranslationProviderPoolBaseUrl) {
    const placeholders = {
      google: "留空使用 Google 官方接口",
      bing: "https://api.cognitive.microsofttranslator.com 或 Azure Endpoint",
      deeplx: "https://你的 DeepLX 服务/translate",
      ai: "https://api.openai.com/v1"
    }
    els.settingTranslationProviderPoolBaseUrl.placeholder = placeholders[provider] || "https://..."
  }
  if (els.settingTranslationProviderPoolApiKey) {
    const id = String(els.settingTranslationProviderPoolEditId?.value || "").trim()
    const existing = id ? state.translationProviderPoolDraft?.find((entry) => entry.id === id) : null
    const canKeep = Boolean(existing?.apiKeyConfigured && existing.provider === provider)
    els.settingTranslationProviderPoolApiKey.placeholder = canKeep
      ? "已回填，清空后保存会删除 Key"
      : provider === "google"
        ? "留空使用 Google 免 Key 模式"
        : "请输入此供应商的 API Key"
  }
}

function resetTranslationProviderPoolForm() {
  if (els.settingTranslationProviderPoolEditId) els.settingTranslationProviderPoolEditId.value = ""
  if (els.settingTranslationProviderPoolProvider) {
    els.settingTranslationProviderPoolProvider.value = "deeplx"
  }
  if (els.settingTranslationProviderPoolName) els.settingTranslationProviderPoolName.value = ""
  if (els.settingTranslationProviderPoolEnabled) els.settingTranslationProviderPoolEnabled.value = "1"
  if (els.settingTranslationProviderPoolBaseUrl) els.settingTranslationProviderPoolBaseUrl.value = ""
  if (els.settingTranslationProviderPoolRegion) els.settingTranslationProviderPoolRegion.value = ""
  if (els.settingTranslationProviderPoolApiKey) {
    els.settingTranslationProviderPoolApiKey.value = ""
    els.settingTranslationProviderPoolApiKey.placeholder = "编辑时留空表示保留"
  }
  if (els.settingTranslationProviderPoolPriority) els.settingTranslationProviderPoolPriority.value = ""
  if (els.adminTranslationPoolTitle) els.adminTranslationPoolTitle.textContent = "添加翻译 API"
  updateTranslationPoolProviderFields()
  closeTranslationPoolModal()
}

function normalizeTranslationProviderPoolPriorities() {
  state.translationProviderPoolDraft = [...state.translationProviderPoolDraft].sort((a, b) => (a.priority || 1) - (b.priority || 1))
}

async function saveTranslationProviderPoolDraft() {
  try {
    await api("/api/admin/settings/translation_provider_pool", {
      method: "POST",
      body: JSON.stringify({
        configs: JSON.stringify([...state.translationProviderPoolDraft]
          .sort((a, b) => (a.priority || 1) - (b.priority || 1))
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            provider: entry.provider,
            baseUrl: entry.baseUrl,
            region: entry.region,
            apiKey: entry.apiKey || (entry.apiKeyConfigured ? "__KEEP__" : ""),
            priority: entry.priority || 1,
            enabled: entry.enabled !== false
          })))
      })
    })
    setStatus("翻译接口已保存")
  } catch (error) {
    setStatus(error.message)
  }
}

async function upsertTranslationProviderPoolEntry() {
  const editId = String(els.settingTranslationProviderPoolEditId?.value || "").trim()
  const existing = editId ? state.translationProviderPoolDraft.find((entry) => entry.id === editId) : null
  const provider = els.settingTranslationProviderPoolProvider?.value || "deeplx"
  const name = String(els.settingTranslationProviderPoolName?.value || "").trim()
  const baseUrl = String(els.settingTranslationProviderPoolBaseUrl?.value || "").trim()
  const region = String(els.settingTranslationProviderPoolRegion?.value || "").trim()
  const rawApiKey = String(els.settingTranslationProviderPoolApiKey?.value || "").trim()
  const id = editId || `${provider}-${Date.now().toString(36)}`
  const entry = {
    id,
    provider,
    name: name || `${provider.toUpperCase()} API`,
    baseUrl,
    region,
    enabled: (els.settingTranslationProviderPoolEnabled?.value || "1") === "1",
    priority: Math.max(1, Number(els.settingTranslationProviderPoolPriority?.value) || (existing?.priority || state.translationProviderPoolDraft.length + 1)),
    apiKeyConfigured: Boolean(rawApiKey),
    apiKey: rawApiKey
  }
  if (existing) {
    state.translationProviderPoolDraft = state.translationProviderPoolDraft.map((item) => (item.id === editId ? entry : item))
  } else {
    state.translationProviderPoolDraft = [...state.translationProviderPoolDraft, entry]
  }
  normalizeTranslationProviderPoolPriorities()
  await saveTranslationProviderPoolDraft()
  resetTranslationProviderPoolForm()
  renderAdminDashboard()
}

function editTranslationProviderPoolEntry(id) {
  const entry = state.translationProviderPoolDraft.find((item) => item.id === id)
  if (!entry) return
  if (els.settingTranslationProviderPoolEditId) els.settingTranslationProviderPoolEditId.value = entry.id
  if (els.settingTranslationProviderPoolProvider) {
    els.settingTranslationProviderPoolProvider.value = entry.provider
  }
  if (els.settingTranslationProviderPoolName) els.settingTranslationProviderPoolName.value = entry.name || ""
  if (els.settingTranslationProviderPoolEnabled) els.settingTranslationProviderPoolEnabled.value = entry.enabled === false ? "0" : "1"
  if (els.settingTranslationProviderPoolBaseUrl) els.settingTranslationProviderPoolBaseUrl.value = entry.baseUrl || ""
  if (els.settingTranslationProviderPoolRegion) els.settingTranslationProviderPoolRegion.value = entry.region || ""
  if (els.settingTranslationProviderPoolApiKey) {
    els.settingTranslationProviderPoolApiKey.value = entry.apiKey || ""
  }
  if (els.settingTranslationProviderPoolPriority) els.settingTranslationProviderPoolPriority.value = String(entry.priority || 1)
  if (els.adminTranslationPoolTitle) els.adminTranslationPoolTitle.textContent = "修改翻译 API"
  updateTranslationPoolProviderFields()
  openTranslationPoolModal()
}

async function removeTranslationProviderPoolEntry(id) {
  state.translationProviderPoolDraft = state.translationProviderPoolDraft.filter((entry) => entry.id !== id)
  normalizeTranslationProviderPoolPriorities()
  await saveTranslationProviderPoolDraft()
  resetTranslationProviderPoolForm()
  renderAdminDashboard()
}

function getAiProviderPoolFromSettings() {
  const configs = state.admin?.settings?.ai_provider_pool?.configs
  return (Array.isArray(configs) ? configs : []).map((entry, index) => ({
    id: String(entry.id || `ai-${index + 1}`),
    name: String(entry.name || ""),
    baseUrl: String(entry.baseUrl || entry.base_url || ""),
    model: String(entry.model || ""),
    translatePrompt: String(entry.translatePrompt || entry.translate_prompt || ""),
    summaryPrompt: String(entry.summaryPrompt || entry.summary_prompt || ""),
    maxInputChars: Number(entry.maxInputChars || entry.max_input_chars || 0),
    enabled: entry.enabled !== false,
    priority: Number(entry.priority || index + 1),
    apiKeyConfigured: Boolean(entry.api_key_configured || entry.apiKeyConfigured),
    apiKey: String(entry.apiKey || entry.api_key || "")
  })).sort((a, b) => a.priority - b.priority)
}

function openAiPoolModal() {
  els.adminAiPoolModal?.classList.remove("hidden")
  els.adminAiPoolModal?.setAttribute("aria-hidden", "false")
  document.body.classList.add("admin-modal-open")
}

function closeAiPoolModal() {
  if (els.adminAiPoolModal?.contains(document.activeElement)) {
    document.activeElement.blur()
  }
  els.adminAiPoolModal?.classList.add("hidden")
  els.adminAiPoolModal?.setAttribute("aria-hidden", "true")
  document.body.classList.remove("admin-modal-open")
}

function resetAiPoolForm() {
  if (els.settingAiPoolEditId) els.settingAiPoolEditId.value = ""
  if (els.settingAiPoolName) els.settingAiPoolName.value = ""
  if (els.settingAiPoolEnabled) els.settingAiPoolEnabled.value = "1"
  if (els.settingAiPoolPriority) els.settingAiPoolPriority.value = ""
  if (els.settingAiPoolBaseUrl) els.settingAiPoolBaseUrl.value = ""
  if (els.settingAiPoolApiKey) {
    els.settingAiPoolApiKey.value = ""
    els.settingAiPoolApiKey.placeholder = "编辑时留空表示保留"
  }
  if (els.settingAiPoolModel) els.settingAiPoolModel.value = ""
  if (els.settingAiPoolTranslatePrompt) els.settingAiPoolTranslatePrompt.value = ""
  if (els.settingAiPoolSummaryPrompt) els.settingAiPoolSummaryPrompt.value = ""
  if (els.settingAiPoolMaxInputChars) els.settingAiPoolMaxInputChars.value = ""
  if (els.adminAiPoolTitle) els.adminAiPoolTitle.textContent = "添加 AI"
  closeAiPoolModal()
}

function normalizeAiPoolPriorities() {
  state.aiProviderPoolDraft = [...state.aiProviderPoolDraft].sort((a, b) => (a.priority || 1) - (b.priority || 1))
}

async function saveAiProviderPoolDraft() {
  try {
    await api("/api/admin/settings/ai_provider_pool", {
      method: "POST",
      body: JSON.stringify({
        configs: JSON.stringify([...state.aiProviderPoolDraft]
          .sort((a, b) => (a.priority || 1) - (b.priority || 1))
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            baseUrl: entry.baseUrl,
            apiKey: entry.apiKey || (entry.apiKeyConfigured ? "__KEEP__" : ""),
            model: entry.model,
            translatePrompt: entry.translatePrompt,
            summaryPrompt: entry.summaryPrompt,
            maxInputChars: entry.maxInputChars || 0,
            priority: entry.priority || 1,
            enabled: entry.enabled !== false
          })))
      })
    })
    setStatus("AI 接口已保存")
  } catch (error) {
    setStatus(error.message)
  }
}

async function upsertAiPoolEntry() {
  const editId = String(els.settingAiPoolEditId?.value || "").trim()
  const existing = editId ? state.aiProviderPoolDraft.find((entry) => entry.id === editId) : null
  const name = String(els.settingAiPoolName?.value || "").trim()
  const baseUrl = String(els.settingAiPoolBaseUrl?.value || "").trim()
  const rawApiKey = String(els.settingAiPoolApiKey?.value || "").trim()
  const id = editId || `ai-${Date.now().toString(36)}`
  const entry = {
    id,
    name: name || "AI API",
    baseUrl,
    model: String(els.settingAiPoolModel?.value || "").trim(),
    translatePrompt: String(els.settingAiPoolTranslatePrompt?.value || "").trim(),
    summaryPrompt: String(els.settingAiPoolSummaryPrompt?.value || "").trim(),
    maxInputChars: Math.max(0, Number(els.settingAiPoolMaxInputChars?.value) || 0),
    enabled: (els.settingAiPoolEnabled?.value || "1") === "1",
    priority: Math.max(1, Number(els.settingAiPoolPriority?.value) || (existing?.priority || state.aiProviderPoolDraft.length + 1)),
    apiKeyConfigured: Boolean(rawApiKey),
    apiKey: rawApiKey
  }
  if (existing) {
    state.aiProviderPoolDraft = state.aiProviderPoolDraft.map((item) => (item.id === editId ? entry : item))
  } else {
    state.aiProviderPoolDraft = [...state.aiProviderPoolDraft, entry]
  }
  normalizeAiPoolPriorities()
  await saveAiProviderPoolDraft()
  resetAiPoolForm()
  renderAdminDashboard()
}

function editAiPoolEntry(id) {
  const entry = state.aiProviderPoolDraft.find((item) => item.id === id)
  if (!entry) return
  if (els.settingAiPoolEditId) els.settingAiPoolEditId.value = entry.id
  if (els.settingAiPoolName) els.settingAiPoolName.value = entry.name || ""
  if (els.settingAiPoolEnabled) els.settingAiPoolEnabled.value = entry.enabled === false ? "0" : "1"
  if (els.settingAiPoolBaseUrl) els.settingAiPoolBaseUrl.value = entry.baseUrl || ""
  if (els.settingAiPoolApiKey) {
    els.settingAiPoolApiKey.value = entry.apiKey || ""
    els.settingAiPoolApiKey.placeholder = entry.apiKeyConfigured ? "已回填，清空后保存会删除 Key" : "请输入 API Key"
  }
  if (els.settingAiPoolModel) els.settingAiPoolModel.value = entry.model || ""
  if (els.settingAiPoolTranslatePrompt) els.settingAiPoolTranslatePrompt.value = entry.translatePrompt || ""
  if (els.settingAiPoolSummaryPrompt) els.settingAiPoolSummaryPrompt.value = entry.summaryPrompt || ""
  if (els.settingAiPoolMaxInputChars) els.settingAiPoolMaxInputChars.value = String(entry.maxInputChars || 0)
  if (els.settingAiPoolPriority) els.settingAiPoolPriority.value = String(entry.priority || 1)
  if (els.adminAiPoolTitle) els.adminAiPoolTitle.textContent = "修改 AI"
  openAiPoolModal()
}

async function removeAiPoolEntry(id) {
  state.aiProviderPoolDraft = state.aiProviderPoolDraft.filter((entry) => entry.id !== id)
  normalizeAiPoolPriorities()
  await saveAiProviderPoolDraft()
  resetAiPoolForm()
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
        max_files: els.settingDatabaseBackupMaxFiles.value,
        schedule_frequency: els.settingDatabaseBackupScheduleFrequency?.value || "daily",
        schedule_time: els.settingDatabaseBackupScheduleTime?.value || "00:00",
        schedule_weekdays: els.settingDatabaseBackupScheduleWeekdays?.value || "1"
      })
    })
    await loadAdmin()
    setStatus("数据库备份设置已保存", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function saveDatabaseCleanupSettings() {
  try {
    await api("/api/admin/settings/database_cleanup", {
      method: "POST",
      body: JSON.stringify({
        max_items_total: els.settingDatabaseCleanupMaxItemsTotal.value,
        max_age_days: els.settingDatabaseCleanupMaxAgeDays.value,
        protect_favorites: els.settingDatabaseCleanupProtectFavorites.value,
        protect_unread: els.settingDatabaseCleanupProtectUnread.value,
        min_keep_items: els.settingDatabaseCleanupMinKeepItems.value
      })
    })
    await loadAdmin()
    setStatus("数据库清理策略已保存", "success")
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

async function exportUserData(userId) {
  try {
    const token = document.cookie.match(/z7rss_session=([^;]+)/)?.[1] || ""
    const url = `/api/admin/users/${userId}/export`
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` }
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `导出失败: ${res.status}`)
    }
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `z7rss-user-${userId}-export.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setStatus(`用户 #${userId} 数据已导出`, "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function importUserData(userId) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".json"
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!window.confirm(`确认将 "${file.name}" 的数据导入到用户 #${userId} 吗？\n将导入订阅源、配置和简报规则（不含文章内容）。`)) return
      const result = await api(`/api/admin/users/${userId}/import`, {
        method: "POST",
        body: JSON.stringify(data)
      })
      await loadAdmin()
      setStatus(`导入完成：${result.feedsImported} 订阅源，${result.settingsImported} 配置，${result.digestImported} 简报规则`, "success")
    } catch (error) {
      setStatus(error.message, "error")
    }
  }
  input.click()
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

els.settingDatabaseBackupScheduleFrequency?.addEventListener("change", () => {
  const isWeekly = els.settingDatabaseBackupScheduleFrequency?.value === "weekly"
  if (els.settingDatabaseBackupTimeRow) {
    els.settingDatabaseBackupTimeRow.classList.toggle("hidden", isWeekly)
  }
  if (els.settingDatabaseBackupWeekdaysRow) {
    els.settingDatabaseBackupWeekdaysRow.classList.toggle("hidden", !isWeekly)
  }
})

els.adminDatabaseCleanupSettingsSaveBtn.addEventListener("click", async () => {
  await saveDatabaseCleanupSettings()
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
        target_language: els.settingTranslationTarget?.value || "zh-CN",
        translation_mode: els.settingTranslationMode?.value || "title"
      })
    })
    await loadAdmin()
    setStatus("系统配置已保存")
  } catch (error) {
    setStatus(error.message)
  }
})

els.settingTranslationProviderPoolAddBtn?.addEventListener("click", () => {
  upsertTranslationProviderPoolEntry()
})

els.settingTranslationProviderPoolCancelBtn?.addEventListener("click", () => {
  resetTranslationProviderPoolForm()
})

els.adminTranslationPoolOpenBtn?.addEventListener("click", () => {
  resetTranslationProviderPoolForm()
  openTranslationPoolModal()
})

els.adminTranslationPoolCloseBtn?.addEventListener("click", () => {
  closeTranslationPoolModal()
})

els.adminTranslationPoolBackdrop?.addEventListener("click", () => {
  closeTranslationPoolModal()
})

els.settingTranslationProviderPoolProvider?.addEventListener("change", () => {
  updateTranslationPoolProviderFields()
})

els.settingTranslationProviderPoolTestBtn?.addEventListener("click", async () => {
  try {
    if (els.adminTranslationPoolTestStatus) {
      els.adminTranslationPoolTestStatus.textContent = "正在测试此翻译配置..."
      els.adminTranslationPoolTestStatus.className = "status-text muted"
      els.adminTranslationPoolTestStatus.classList.remove("hidden")
    }
    const provider = els.settingTranslationProviderPoolProvider?.value || "google"
    const baseUrl = els.settingTranslationProviderPoolBaseUrl?.value || ""
    const region = els.settingTranslationProviderPoolRegion?.value || ""
    const rawApiKey = String(els.settingTranslationProviderPoolApiKey?.value || "").trim()
    const id = els.settingTranslationProviderPoolEditId?.value || ""

    const result = await api("/api/admin/translation/test-runtime", {
      method: "POST",
      body: JSON.stringify({
        id,
        provider,
        baseUrl,
        region,
        apiKey: rawApiKey || (id ? "__KEEP__" : "")
      })
    })

    if (!els.adminTranslationPoolTestStatus) return

    if (result.ok) {
      els.adminTranslationPoolTestStatus.textContent = `此 API 测试成功 (${result.provider}): ${result.output}`
      els.adminTranslationPoolTestStatus.className = "status-text success-text"
    } else {
      els.adminTranslationPoolTestStatus.textContent = result.error || "翻译测试失败"
      els.adminTranslationPoolTestStatus.className = "status-text error-text"
    }
  } catch (error) {
    if (els.adminTranslationPoolTestStatus) {
      els.adminTranslationPoolTestStatus.textContent = error.message
      els.adminTranslationPoolTestStatus.className = "status-text error-text"
    }
  }
})

els.adminAiPoolOpenBtn?.addEventListener("click", () => {
  resetAiPoolForm()
  openAiPoolModal()
})

els.adminAiPoolCloseBtn?.addEventListener("click", () => {
  closeAiPoolModal()
})

els.adminAiPoolBackdrop?.addEventListener("click", () => {
  closeAiPoolModal()
})

els.settingAiPoolAddBtn?.addEventListener("click", () => {
  upsertAiPoolEntry()
})

els.settingAiPoolCancelBtn?.addEventListener("click", () => {
  resetAiPoolForm()
})

els.settingAiPoolTestBtn?.addEventListener("click", async () => {
  try {
    if (els.adminAiPoolTestStatus) {
      els.adminAiPoolTestStatus.textContent = "正在测试此 AI 配置..."
      els.adminAiPoolTestStatus.className = "status-text muted"
      els.adminAiPoolTestStatus.classList.remove("hidden")
    }
    const baseUrl = els.settingAiPoolBaseUrl?.value || ""
    const rawApiKey = String(els.settingAiPoolApiKey?.value || "").trim()
    const id = els.settingAiPoolEditId?.value || ""
    const model = els.settingAiPoolModel?.value || ""

    const result = await api("/api/admin/ai/test-runtime", {
      method: "POST",
      body: JSON.stringify({
        id,
        baseUrl,
        apiKey: rawApiKey || (id ? "__KEEP__" : ""),
        model
      })
    })

    if (!els.adminAiPoolTestStatus) return

    if (result.ok) {
      els.adminAiPoolTestStatus.textContent = `此 AI 测试成功: ${result.output}`
      els.adminAiPoolTestStatus.className = "status-text success-text"
    } else {
      els.adminAiPoolTestStatus.textContent = result.error || "AI 测试失败"
      els.adminAiPoolTestStatus.className = "status-text error-text"
    }
  } catch (error) {
    if (els.adminAiPoolTestStatus) {
      els.adminAiPoolTestStatus.textContent = error.message
      els.adminAiPoolTestStatus.className = "status-text error-text"
    }
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
