import {
  escapeHtml,
  formatBillingProvider,
  formatDate,
  formatMoney as formatPrice,
  safeUrl,
  safeHtml,
  safeSet,
  safeToggle,
  summarizeUserAgent
} from "./shared-ui.js"
import { formatAuditAction, toDateInputValue } from "./admin-formatters.js"
import { getAdminUserSecurityState, renderAdminUserSecurityPanel } from "./admin-user-security.js"
import {
  getRedeemBatchId,
  getRedeemBatches,
  getRedeemBuyer,
  getRedeemCodeStatus
} from "./admin-redeem-utils.js?v=2"

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 || size >= 10 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

function renderProfileVersionDetail(label, value) {
  return `
    <article class="admin-profile-version-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </article>
  `
}

export function createAdminDashboard({
  actions,
  els,
  isAdmin,
  renderMaintenanceStatus,
  renderRefreshStatus,
  state,
  syncMaintenancePolling,
  syncRefreshPolling
}) {
  function getUserSecurityState(userId) {
    return getAdminUserSecurityState(state.userSecurity, userId)
  }

  function renderPlanOptions(selectedCode = "") {
    const plans = state.admin?.plans || state.config?.plans || []
    return plans
      .map(
        (plan) =>
          `<option value="${escapeHtml(plan.code)}" ${plan.code === selectedCode ? "selected" : ""}>${escapeHtml(plan.name)} (${escapeHtml(plan.code)})</option>`
      )
      .join("")
  }

  function renderVersionInfo() {
    const system = state.admin?.system || {}
    const check = state.dockerUpdateCheck || system.docker?.update || null
    const latestVersion = check?.latestVersion
      ? `v${check.latestVersion}`
      : check?.latestVersionTag
        ? check.latestVersionTag
        : state.dockerUpdateChecking
          ? "检查中"
          : "未检查"
    const publishedAt = check?.latestVersionPublishedAt || check?.remoteUpdatedAt || system.buildTime || ""
    const status = (() => {
      if (state.dockerUpdateChecking) return { tone: "accent", label: "检查中" }
      if (check?.error) return { tone: "warning", label: check.error }
      if (!check) return { tone: "accent", label: "未检查" }
      if (check.updateAvailable === true) return { tone: "warning", label: "可能有新镜像" }
      if (check.updateAvailable === false) return { tone: "success", label: "当前构建不早于 latest" }
      return { tone: "accent", label: "已获取镜像信息" }
    })()
    safeHtml(els.adminProfileVersionInfo, [
      renderProfileVersionDetail("当前版本", `v${system.appVersion || "0.0.0"}`),
      renderProfileVersionDetail("最新版本", latestVersion),
      renderProfileVersionDetail("发布时间", publishedAt ? formatDate(publishedAt) : "未记录")
    ].join(""))

    if (els.adminDockerUpdateBtn) {
      els.adminDockerUpdateBtn.disabled = Boolean(state.dockerUpdateChecking)
      els.adminDockerUpdateBtn.textContent = state.dockerUpdateChecking ? "检查中" : "检查更新"
      els.adminDockerUpdateBtn.title = check?.error || status.label
      els.adminDockerUpdateBtn.onclick = () => actions.checkDockerImageUpdate()
    }
  }

  function renderRedeemCodeRow(entry) {
    const status = getRedeemCodeStatus(entry)
    const buyer = getRedeemBuyer(entry)
    const isUsed = status.key === "used"
    const batchId = getRedeemBatchId(entry)
    return `
      <tr class="admin-redeem-code-row" data-redeem-id="${entry.id}" data-redeem-batch-id="${escapeHtml(batchId)}">
        <td>
          <div class="redeem-code-main">
            <strong>${escapeHtml(entry.code)}</strong>
            <button class="copy-btn secondary" type="button" data-copy-code="${escapeHtml(entry.code)}" title="复制兑换码">复制</button>
          </div>
        </td>
        <td><span class="pill ${status.tone}">${status.label}</span></td>
        <td><input type="date" value="${toDateInputValue(entry.expires_at)}" data-redeem-expire="${entry.id}" ${isUsed ? "disabled" : ""} /></td>
        <td class="redeem-used">${buyer ? escapeHtml(buyer) : "未使用"}</td>
        <td>${entry.redeemed_at ? formatDate(entry.redeemed_at) : "-"}</td>
        <td><input type="text" value="${escapeHtml(entry.note || "")}" data-redeem-note="${entry.id}" ${isUsed ? "disabled" : ""} /></td>
        <td class="redeem-actions-cell">
          <div class="redeem-actions">
            <button class="secondary" type="button" data-redeem-save="${entry.id}" ${isUsed ? "disabled" : ""}>保存</button>
            <button class="secondary" type="button" data-redeem-toggle="${entry.id}" data-redeem-active="${entry.is_active ? "0" : "1"}" ${isUsed ? "disabled" : ""}>
              ${entry.is_active ? "停用" : "启用"}
            </button>
            <button class="danger" type="button" data-redeem-delete="${entry.id}" data-redeem-code="${escapeHtml(entry.code)}" ${isUsed ? "disabled" : ""}>删除</button>
          </div>
        </td>
      </tr>
    `
  }

  function renderRedeemBatch(batch) {
    const expanded = (state.expandedRedeemBatchIds || []).includes(batch.id)
    const batchDeleteDisabled = batch.availableCount + batch.expiredCount + batch.inactiveCount < 1
    return `
      <article class="admin-redeem-batch" data-redeem-batch="${escapeHtml(batch.id)}">
        <div class="redeem-batch-head">
          <div class="redeem-batch-title">
            <strong>${escapeHtml(batch.label)}</strong>
            <span class="muted">${escapeHtml(batch.planLabel)} · 创建于 ${formatDate(batch.createdAt)}</span>
          </div>
          <div class="redeem-batch-status">
            <span class="pill accent">${batch.usedCount}/${batch.totalCount} 已兑换</span>
            <span class="pill success">${batch.availableCount} 可售卖</span>
            ${batch.expiredCount ? `<span class="pill warning">${batch.expiredCount} 过期</span>` : ""}
            ${batch.inactiveCount ? `<span class="pill warning">${batch.inactiveCount} 停用</span>` : ""}
          </div>
          <div class="redeem-batch-actions">
            <button class="secondary" type="button" data-redeem-batch-toggle="${escapeHtml(batch.id)}">${expanded ? "收起状态" : "查看状态"}</button>
            <button class="secondary" type="button" data-redeem-batch-export="${escapeHtml(batch.id)}">导出</button>
            <button class="danger" type="button" data-redeem-batch-delete="${escapeHtml(batch.id)}" data-redeem-batch-label="${escapeHtml(batch.label)}" ${batchDeleteDisabled ? "disabled" : ""}>删除未用</button>
          </div>
        </div>
        <div class="redeem-batch-meta">
          <span>批次 ID ${escapeHtml(batch.id)}</span>
          <span>总数 ${batch.totalCount}</span>
          <span>到期 ${batch.expiresAt ? formatDate(batch.expiresAt) : "无期限/混合"}</span>
          ${batch.note ? `<span>备注 ${escapeHtml(batch.note)}</span>` : ""}
        </div>
        ${expanded ? `
          <div class="redeem-code-table-wrap">
            <table class="redeem-code-table">
              <thead>
                <tr>
                  <th>兑换码</th>
                  <th>状态</th>
                  <th>到期日</th>
                  <th>使用人</th>
                  <th>兑换时间</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${batch.codes.map((entry) => renderRedeemCodeRow(entry)).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}
      </article>
    `
  }

  function renderSidebarInfo() {
    const flags = []
    if (state.config) {
      flags.push({
        tone: state.config.siteDomainRaw ? "accent" : "warning",
        label: state.config.siteDomainRaw ? `域名：${state.config.siteDomain || state.config.siteDomainRaw}` : "域名未配置"
      })
      flags.push({
        tone: state.config.aiEnabled ? "success" : "warning",
        label: `AI ${state.config.aiEnabled ? "已启用" : "已关闭"}`
      })
      flags.push({
        tone: state.config.billingProvider === "demo" ? "warning" : "accent",
        label: `计费：${formatBillingProvider(state.config.billingProvider)}`
      })
      flags.push({
        tone: state.config.stripeEnabled ? "accent" : "warning",
        label: state.config.stripeEnabled ? "Stripe 已接入" : "Stripe 未接入"
      })
    }
    if (state.admin?.settings?.ai) {
      const ai = state.admin.settings.ai
      flags.push({
        tone: ai.base_url && ai.api_key_configured ? "success" : "warning",
        label: ai.api_key_unavailable
          ? "系统默认 AI 密钥不可用"
          : ai.base_url && ai.api_key_configured
            ? "系统默认 AI 已配置"
            : "系统默认 AI 未完整配置"
      })
    }
    const google = state.admin?.settings?.translation_google || {}
    flags.push({
      tone: google.api_key_configured ? "success" : "accent",
      label: google.api_key_configured ? "谷歌翻译 Key 已配置" : "谷歌翻译免 Key 已启用"
    })

    if (state.admin?.settings?.translation_bing) {
      const bing = state.admin.settings.translation_bing
      flags.push({
        tone: bing.api_key_configured ? "success" : "warning",
        label: bing.api_key_configured ? "必应翻译已配置" : "必应翻译未配置"
      })
    }
    const deeplx = state.admin?.settings?.translation_deeplx || {}
    flags.push({
      tone: deeplx.base_url || state.config?.deeplxConfigured ? "success" : "warning",
      label: deeplx.base_url || state.config?.deeplxConfigured ? "DeepLX 已配置" : "DeepLX 未配置"
    })

    safeHtml(els.adminSystemFlags, flags.length
      ? flags.map((item) => `<span class="pill ${item.tone}">${escapeHtml(item.label)}</span>`).join("")
      : '<span class="muted">系统信息加载中</span>')

    const plans = state.admin?.plans || state.config?.plans || []
    safeHtml(els.adminPlanSnapshot, plans.length
      ? plans
          .map(
            (plan) => `
              <article class="list-row admin-plan-snapshot-row">
                <div class="list-main">
                  <strong>${escapeHtml(plan.name)}</strong>
                  <span class="muted">${escapeHtml(plan.code)} · ${plan.subscriber_count || 0} 位订阅者</span>
                  <span class="muted">订阅源上限 ${plan.max_feeds} · 总文章保留 ${plan.max_saved_items} 篇 · 收藏上限 ${plan.max_favorite_items} 篇</span>
                  <span class="muted">翻译 ${plan.ai_translation_enabled ? "开" : "关"} · 总结 ${plan.ai_summary_enabled ? "开" : "关"} · 自定义 AI ${plan.custom_ai_enabled ? "开" : "关"}</span>
                </div>
                <span class="pill accent">${formatPrice(plan.price_monthly_cents)}</span>
              </article>
            `
          )
          .join("")
      : '<span class="muted">暂无套餐数据</span>')
  }

  function renderAuthState() {
    const user = state.me?.user
    if (!user) {
      safeSet(els.adminUserName, "textContent", "访客")
      safeToggle(els.topLoginLink, false)
      safeToggle(els.guestView, false)
      safeToggle(els.userView, true)
      safeToggle(els.logoutBtn, true)
      safeToggle(els.forbiddenPanel, true)
      document.querySelectorAll("[data-site-register]").forEach((link) => link.classList.remove("hidden"))
      document.querySelectorAll("[data-site-user]").forEach((pill) => pill.classList.add("hidden"))
      renderSidebarInfo()
      return
    }

    safeSet(els.adminUserName, "textContent", user.displayName || user.email || "管理员")
    safeToggle(els.topLoginLink, true)
    safeToggle(els.guestView, true)
    safeToggle(els.logoutBtn, false)
    document.querySelectorAll("[data-site-register]").forEach((link) => link.classList.add("hidden"))
    document.querySelectorAll("[data-site-user]").forEach((pill) => {
      pill.textContent = user.isAdmin ? "管理员" : "会员"
      pill.classList.remove("hidden")
      pill.classList.toggle("success", Boolean(user.isAdmin))
      pill.classList.toggle("accent", !user.isAdmin)
    })
    if (user.isAdmin) {
      safeToggle(els.userView, false)
      safeToggle(els.forbiddenPanel, true)
    } else {
      safeToggle(els.userView, true)
      safeToggle(els.forbiddenPanel, false)
    }
    renderSidebarInfo()
  }

  function renderAdminDashboard() {
    if (!state.admin || !isAdmin()) {
      safeHtml(els.adminMetrics, "")
      safeSet(els.adminRefreshStatus, "textContent", "")
      safeHtml(els.adminRefreshMetrics, "")
      safeHtml(els.adminRefreshHistory, "")
      safeSet(els.adminMaintenanceStatus, "textContent", "")
      safeHtml(els.adminMaintenanceMetrics, "")
      safeHtml(els.adminMaintenanceHistory, "")
      safeSet(els.adminDatabaseStatus, "textContent", "")
      safeHtml(els.adminDatabaseMetrics, "")
      safeHtml(els.adminDatabaseFlags, "")
      safeHtml(els.adminDatabaseTables, "")
      safeHtml(els.adminProfileVersionInfo, "")
      safeHtml(els.adminPlanSettings, "")
      safeHtml(els.adminRedeemList, "")
      safeHtml(els.adminPluginList, "")
      safeHtml(els.adminRuleList, "")
      safeHtml(els.adminSiteBlockList, "")
      safeHtml(els.adminIpBlockList, "")
      safeHtml(els.adminUserList, "")
      safeHtml(els.adminOrderList, "")
      safeHtml(els.adminAuditList, "")
      safeHtml(els.adminFeedList, "")
      safeHtml(els.adminItemList, "")
      renderSidebarInfo()
      syncMaintenancePolling()
      syncRefreshPolling()
      return
    }

    const activeRules = (state.admin.contentRules || []).filter((entry) => entry.is_active).length
    const activeSites = (state.admin.blockedSites || []).filter((entry) => entry.is_active).length
    const activeIps = (state.admin.blockedIps || []).filter((entry) => entry.is_active).length

    safeHtml(els.adminMetrics, `
      <article class="metric-box"><span>用户数</span><strong>${state.admin.metrics.userCount}</strong></article>
      <article class="metric-box"><span>管理员</span><strong>${state.admin.metrics.adminCount}</strong></article>
      <article class="metric-box"><span>订阅源</span><strong>${state.admin.metrics.feedCount}</strong></article>
      <article class="metric-box"><span>订单数</span><strong>${state.admin.metrics.orderCount}</strong></article>
      <article class="metric-box"><span>活跃规则</span><strong>${activeRules}</strong></article>
      <article class="metric-box"><span>屏蔽站点</span><strong>${activeSites}</strong></article>
      <article class="metric-box"><span>屏蔽 IP</span><strong>${activeIps}</strong></article>
    `)

    renderDatabaseStatus()
    renderVersionInfo()

    safeHtml(els.adminPlanSettingsBody, (state.admin.plans || [])
      .map(
        (plan) => `
          <tr data-plan-row="${escapeHtml(plan.code)}">
            <td>
              <div class="plan-name">${escapeHtml(plan.name)}</div>
              <div class="plan-meta">${escapeHtml(plan.code)} · ${plan.subscriber_count || 0}人</div>
            </td>
            <td>
              <div class="plan-info">
                <input type="number" min="0" step="1" value="${Number(plan.max_feeds || 0)}" data-plan-feeds="${escapeHtml(plan.code)}" />
              </div>
            </td>
            <td>
              <div class="plan-info">
                <input type="number" min="0" step="1" value="${Number(plan.max_saved_items || 0)}" data-plan-saved="${escapeHtml(plan.code)}" />
              </div>
            </td>
            <td>
              <div class="plan-info">
                <input type="number" min="0" step="1" value="${Number(plan.max_favorite_items || 0)}" data-plan-favorite="${escapeHtml(plan.code)}" />
              </div>
            </td>
            <td>
              <div class="plan-info">
                <input type="number" min="0" step="1" value="${Number(plan.max_digest_rules || 0)}" data-plan-digest-rules="${escapeHtml(plan.code)}" />
              </div>
            </td>
            <td>
              <div class="plan-toggles">
                <label class="checkbox-row">
                  <input type="checkbox" ${plan.ai_translation_enabled ? "checked" : ""} data-plan-translation="${escapeHtml(plan.code)}" />
                  <span>翻译</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" ${plan.ai_summary_enabled ? "checked" : ""} data-plan-summary="${escapeHtml(plan.code)}" />
                  <span>总结</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" ${plan.custom_ai_enabled ? "checked" : ""} data-plan-custom-ai="${escapeHtml(plan.code)}" />
                  <span>AI</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" ${plan.ai_digest_enabled ? "checked" : ""} data-plan-digest="${escapeHtml(plan.code)}" />
                  <span>简报</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" ${plan.email_digest_enabled ? "checked" : ""} data-plan-email-digest="${escapeHtml(plan.code)}" />
                  <span>邮件</span>
                </label>
              </div>
            </td>
            <td>
              <div class="plan-actions">
                <button class="secondary" type="button" data-plan-save="${escapeHtml(plan.code)}">保存</button>
              </div>
            </td>
          </tr>
        `
      )
      .join(""))

    const general = state.admin.settings.general || {}
    const mail = state.admin.settings.mail || {}
    const ai = state.admin.settings.ai || {}
    const digest = state.admin.settings.digest || {}
    const backups = state.admin.database?.backups || {}
    const cleanup = state.admin.database?.cleanup || {}
    const vacuum = state.admin.database?.vacuum || {}
    const google = state.admin.settings.translation_google || {}
    const deeplx = state.admin.settings.translation_deeplx || {}
    const bing = state.admin.settings.translation_bing || {}
    const translation = state.admin.settings.translation || {}
    const translationProviderPoolUnavailable = Boolean(state.admin.settings.translation_provider_pool?.configs_unavailable)
    const aiProviderPoolUnavailable = Boolean(state.admin.settings.ai_provider_pool?.configs_unavailable)
    if (els.settingTranslationProvider) els.settingTranslationProvider.value = translation.provider || "google"
    if (els.settingTranslationTarget) els.settingTranslationTarget.value = translation.target_language || "zh-CN"
    if (els.settingTranslationMode) els.settingTranslationMode.value = translation.translation_mode || "title"
    if (els.settingTranslationFallbackProviders) els.settingTranslationFallbackProviders.value = translation.fallback_providers || "deeplx,bing,ai,google"
    if (els.settingTranslationProviderPool) els.settingTranslationProviderPool.value = ""
    if (els.settingTranslationProviderPoolList) {
      const draftPool = state.translationProviderPoolDraft || []
      safeHtml(
        els.settingTranslationProviderPoolList,
        draftPool.length
          ? draftPool
              .map((entry, index) => `
                <article class="list-row">
                  <div class="list-main">
                    <strong>${escapeHtml(entry.name || entry.id || entry.provider || "翻译 API")}</strong>
                    <span class="muted">${escapeHtml(entry.provider || "-")} · ${escapeHtml(entry.baseUrl || "默认接口")} · ${entry.apiKeyConfigured ? "Key 已配置" : "无 Key"} · 优先级 ${escapeHtml(String(entry.priority || "-"))}</span>
                  </div>
                  <div class="reader-actions toolbar-wrap">
                    <span class="pill ${entry.enabled === false ? "muted" : "success"}">${entry.enabled === false ? "停用" : "启用"}</span>
                    <button class="secondary" type="button" data-pool-edit="${escapeHtml(entry.id)}">修改</button>
                    <button class="secondary" type="button" data-pool-delete="${escapeHtml(entry.id)}">删除</button>
                  </div>
                </article>
              `)
              .join("")
          : translationProviderPoolUnavailable
            ? `<article class="list-row"><div class="list-main"><strong>旧翻译 API 列表不可用</strong><span class="muted">数据库里仍有旧列表，但当前 APP_SECRET 无法解密。请恢复原 data/app-secret，或重新添加 API 后保存新列表。</span></div></article>`
            : `<article class="list-row"><div class="list-main"><strong>未配置额外 API</strong><span class="muted">仍会使用上方单个供应商配置。</span></div></article>`
      )
    }
    if (els.settingSiteName) els.settingSiteName.value = general.site_name || state.config?.appName || ""
    if (els.settingSiteDomain) {
      els.settingSiteDomain.value = general.site_domain || ""
      els.settingSiteDomain.placeholder = state.config?.siteUrl || state.config?.appUrl || "https://rss.example.com"
    }
    if (els.settingMailFrom) els.settingMailFrom.value = mail.from || ""
    if (els.settingMailHost) els.settingMailHost.value = mail.host || ""
    if (els.settingMailPort) els.settingMailPort.value = mail.port || ""
    if (els.settingMailUsername) els.settingMailUsername.value = mail.username || ""
    if (els.settingMailPassword) {
      els.settingMailPassword.value = ""
      els.settingMailPassword.type = "password"
      els.settingMailPassword.placeholder = mail.password_unavailable
        ? "旧密钥不可用，请重新保存"
        : mail.password_configured
          ? "已配置，留空表示不修改"
          : ""
    }
    if (els.settingMailPasswordRevealBtn) {
      els.settingMailPasswordRevealBtn.disabled = !mail.password_configured
      els.settingMailPasswordRevealBtn.dataset.visible = "0"
      els.settingMailPasswordRevealBtn.classList.remove("is-visible")
    }
    if (els.settingAiProviderPoolList) {
      const draftAiPool = state.aiProviderPoolDraft || []
      safeHtml(
        els.settingAiProviderPoolList,
        draftAiPool.length
          ? draftAiPool
              .map((entry, index) => `
                <article class="list-row">
                  <div class="list-main">
                    <strong>${escapeHtml(entry.name || entry.id || "AI API")}</strong>
                    <span class="muted">${escapeHtml(entry.model || "-")} · ${escapeHtml(entry.baseUrl || "未配置")} · ${entry.apiKeyConfigured ? "Key 已配置" : "无 Key"} · 优先级 ${escapeHtml(String(entry.priority || "-"))}${entry.maxInputChars > 0 ? ` · 限 ${entry.maxInputChars} 字` : ""}</span>
                  </div>
                  <div class="reader-actions toolbar-wrap">
                    <span class="pill ${entry.enabled === false ? "muted" : "success"}">${entry.enabled === false ? "停用" : "启用"}</span>
                    <button class="secondary" type="button" data-ai-pool-edit="${escapeHtml(entry.id)}">修改</button>
                    <button class="secondary" type="button" data-ai-pool-delete="${escapeHtml(entry.id)}">删除</button>
                  </div>
                </article>
              `)
              .join("")
          : aiProviderPoolUnavailable
            ? `<article class="list-row"><div class="list-main"><strong>旧 AI 接口列表不可用</strong><span class="muted">数据库里仍有旧列表，但当前 APP_SECRET 无法解密。请恢复原密钥，或重新添加 API 后保存新列表。</span></div></article>`
            : `<article class="list-row"><div class="list-main"><strong>未配置 AI 接口</strong><span class="muted">翻译、总结、分类和简报需要 AI 接口。</span></div></article>`
      )
    }
    if (els.settingDigestInputMode) els.settingDigestInputMode.value = digest.input_mode || "title_summary"
    if (els.settingDigestMaxItems) els.settingDigestMaxItems.value = digest.max_items || "30"
    if (els.settingDigestMaxCharsPerItem) els.settingDigestMaxCharsPerItem.value = digest.max_chars_per_item || "300"
    if (els.settingDigestMaxTotalChars) els.settingDigestMaxTotalChars.value = digest.max_total_chars || "6000"
    if (els.settingDatabaseBackupEnabled) els.settingDatabaseBackupEnabled.value = backups.enabled === false ? "false" : "true"
    if (els.settingDatabaseBackupRetentionDays) els.settingDatabaseBackupRetentionDays.value = String(backups.retentionDays ?? 14)
    if (els.settingDatabaseBackupMaxFiles) els.settingDatabaseBackupMaxFiles.value = String(backups.maxFiles ?? 24)
    if (els.settingDatabaseBackupScheduleFrequency) {
      els.settingDatabaseBackupScheduleFrequency.value = backups.scheduleFrequency || "daily"
      const isWeekly = els.settingDatabaseBackupScheduleFrequency.value === "weekly"
      if (els.settingDatabaseBackupTimeRow) els.settingDatabaseBackupTimeRow.classList.toggle("hidden", isWeekly)
      if (els.settingDatabaseBackupWeekdaysRow) els.settingDatabaseBackupWeekdaysRow.classList.toggle("hidden", !isWeekly)
    }
    if (els.settingDatabaseBackupScheduleTime) els.settingDatabaseBackupScheduleTime.value = backups.scheduleTime || "00:00"
    if (els.settingDatabaseBackupScheduleWeekdays) {
      const weekdays = backups.scheduleWeekdays || [1]
      els.settingDatabaseBackupScheduleWeekdays.value = String(weekdays[0] ?? 1)
    }
    if (els.settingDatabaseCleanupMaxItemsTotal) els.settingDatabaseCleanupMaxItemsTotal.value = cleanup.maxItemsTotal ?? ""
    if (els.settingDatabaseCleanupMaxAgeDays) els.settingDatabaseCleanupMaxAgeDays.value = String(cleanup.maxAgeDays ?? 0)
    if (els.settingDatabaseCleanupProtectFavorites) els.settingDatabaseCleanupProtectFavorites.value = cleanup.protectFavorites !== false ? "true" : "false"
    if (els.settingDatabaseCleanupProtectUnread) els.settingDatabaseCleanupProtectUnread.value = cleanup.protectUnread ? "true" : "false"
    if (els.settingDatabaseCleanupMinKeepItems) els.settingDatabaseCleanupMinKeepItems.value = String(cleanup.minKeepItems ?? 0)
    if (els.settingDatabaseVacuumEnabled) els.settingDatabaseVacuumEnabled.value = vacuum.enabled === false ? "false" : "true"
    if (els.settingDatabaseVacuumIntervalDays) els.settingDatabaseVacuumIntervalDays.value = String(vacuum.intervalDays ?? 7)
    if (els.settingDatabaseVacuumScheduleTime) els.settingDatabaseVacuumScheduleTime.value = vacuum.scheduleTime || "03:30"
    if (els.settingGoogleTranslateApiKey) {
      els.settingGoogleTranslateApiKey.value = ""
      els.settingGoogleTranslateApiKey.placeholder = google.api_key_unavailable
        ? "旧密钥不可用，请恢复 APP_SECRET 或重新填写"
        : google.api_key_configured
          ? "已配置，留空表示保留当前 Key；勾选下方可清空"
          : "留空则使用 Google 免 Key 模式"
    }
    if (els.settingGoogleTranslateClearApiKey) {
      els.settingGoogleTranslateClearApiKey.checked = false
      els.settingGoogleTranslateClearApiKey.disabled = !google.api_key_configured
    }
    if (els.settingDeepLXBaseUrl) {
      els.settingDeepLXBaseUrl.value = deeplx.base_url || ""
      els.settingDeepLXBaseUrl.placeholder = deeplx.base_url ? "已配置自定义 DeepLX 地址" : "例如: https://api.deeplx.你的域名.com"
    }
    if (els.settingDeepLXApiKey) {
      els.settingDeepLXApiKey.value = ""
      els.settingDeepLXApiKey.placeholder = deeplx.api_key_unavailable
        ? "旧密钥不可用，请恢复 APP_SECRET 或重新填写"
        : deeplx.api_key_configured
          ? "已配置，留空表示不修改；勾选下方可清空"
          : "如需认证可填写"
    }
    if (els.settingDeepLXClearApiKey) {
      els.settingDeepLXClearApiKey.checked = false
      els.settingDeepLXClearApiKey.disabled = !deeplx.api_key_configured
    }
    if (els.settingBingTranslateBaseUrl) els.settingBingTranslateBaseUrl.value = bing.base_url || ""
    if (els.settingBingTranslateApiKey) {
      els.settingBingTranslateApiKey.value = ""
      els.settingBingTranslateApiKey.placeholder = bing.api_key_unavailable
        ? "旧密钥不可用，请恢复 APP_SECRET 或重新填写"
        : bing.api_key_configured
          ? "已配置，留空表示不修改；勾选下方可清空"
          : ""
    }
    if (els.settingBingTranslateClearApiKey) {
      els.settingBingTranslateClearApiKey.checked = false
      els.settingBingTranslateClearApiKey.disabled = !bing.api_key_configured
    }
    if (els.settingBingTranslateRegion) els.settingBingTranslateRegion.value = bing.region || ""

    if (els.adminRedeemPlan) {
      const redeemPlanSelection = els.adminRedeemPlan.value || "free"
      safeHtml(els.adminRedeemPlan, renderPlanOptions(redeemPlanSelection))
      if (![...els.adminRedeemPlan.options].some((option) => option.value === redeemPlanSelection)) {
        els.adminRedeemPlan.value = state.admin.plans?.[0]?.code || "free"
      }
    }

    const redeemBatches = getRedeemBatches(state.admin?.redeemCodes || [])
    const selectedBatch = els.redeemBatchFilter?.value || ""
    const selectedBatchExists = redeemBatches.some((batch) => batch.id === selectedBatch)
    const visibleBatches = selectedBatch && selectedBatchExists
      ? redeemBatches.filter((batch) => batch.id === selectedBatch)
      : redeemBatches
    if (els.redeemBatchFilter) {
      safeHtml(
        els.redeemBatchFilter,
        '<option value="">全部批次</option>' +
          redeemBatches
            .map((batch) => `<option value="${escapeHtml(batch.id)}" ${batch.id === selectedBatch ? "selected" : ""}>${escapeHtml(batch.label)} (${batch.totalCount})</option>`)
            .join("")
      )
      if (selectedBatch && !selectedBatchExists) els.redeemBatchFilter.value = ""
    }
    if (els.redeemExpandAllBtn) {
      const visibleIds = visibleBatches.map((batch) => batch.id)
      const expandedCount = visibleIds.filter((id) => (state.expandedRedeemBatchIds || []).includes(id)).length
      els.redeemExpandAllBtn.textContent = visibleIds.length && expandedCount === visibleIds.length ? "收起批次" : "展开批次"
    }
    safeHtml(els.adminRedeemList, visibleBatches.length
      ? visibleBatches.map((batch) => renderRedeemBatch(batch)).join("")
      : `<article class="list-row"><div class="list-main"><strong>暂无兑换码批次</strong><span class="muted">生成兑换码后会按批次显示在这里。</span></div></article>`)

    document.querySelectorAll("[data-copy-code]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.copyCode
        navigator.clipboard.writeText(code).then(() => {
          const originalText = btn.textContent
          btn.textContent = "已复制"
          btn.disabled = true
          setTimeout(() => {
            btn.textContent = originalText
            btn.disabled = false
          }, 1500)
        })
      })
    })

    safeHtml(els.adminPluginList, (state.admin.plugins || [])
      .map((entry) => {
        const configKeys = Object.keys(entry.config || {})
        return `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(entry.name)}</strong>
              <span class="muted">${escapeHtml(entry.code)} · ${escapeHtml(entry.description || "无描述")}</span>
              <span class="muted">${configKeys.length ? `配置项：${escapeHtml(configKeys.join(", "))}` : "无配置 JSON"}</span>
            </div>
            <div class="reader-actions toolbar-wrap">
              <span class="pill ${entry.is_enabled ? "success" : "warning"}">${entry.is_enabled ? "启用" : "停用"}</span>
              <button class="secondary" type="button" data-plugin-toggle="${escapeHtml(entry.code)}">${entry.is_enabled ? "停用" : "启用"}</button>
            </div>
          </article>
        `
      })
      .join(""))

    safeHtml(els.adminRuleList, (state.admin.contentRules || [])
      .map(
        (entry) => `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(entry.kind)}: ${escapeHtml(entry.pattern)}</strong>
              <span class="muted">${escapeHtml(entry.action)} · 创建于 ${formatDate(entry.created_at)}</span>
            </div>
            <div class="reader-actions toolbar-wrap">
              <span class="pill ${entry.is_active ? "success" : "warning"}">${entry.is_active ? "启用" : "停用"}</span>
              <button class="secondary" type="button" data-rule-id="${entry.id}" data-rule-active="${entry.is_active ? "0" : "1"}">
                ${entry.is_active ? "停用" : "启用"}
              </button>
            </div>
          </article>
        `
      )
      .join(""))

    safeHtml(els.adminSiteBlockList, (state.admin.blockedSites || [])
      .map(
        (entry) => `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(entry.domain)}</strong>
              <span class="muted">${escapeHtml(entry.reason || "未填写原因")}</span>
            </div>
            <div class="reader-actions toolbar-wrap">
              <span class="pill ${entry.is_active ? "success" : "warning"}">${entry.is_active ? "生效" : "关闭"}</span>
              <button class="secondary" type="button" data-site-domain="${escapeHtml(entry.domain)}" data-site-active="${entry.is_active ? "0" : "1"}">
                ${entry.is_active ? "停用" : "启用"}
              </button>
            </div>
          </article>
        `
      )
      .join(""))

    safeHtml(els.adminIpBlockList, (state.admin.blockedIps || [])
      .map(
        (entry) => `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(entry.ip)}</strong>
              <span class="muted">${escapeHtml(entry.reason || "未填写原因")}</span>
            </div>
            <div class="reader-actions toolbar-wrap">
              <span class="pill ${entry.is_active ? "success" : "warning"}">${entry.is_active ? "生效" : "关闭"}</span>
              <button class="secondary" type="button" data-ip-value="${escapeHtml(entry.ip)}" data-ip-active="${entry.is_active ? "0" : "1"}">
                ${entry.is_active ? "停用" : "启用"}
              </button>
            </div>
          </article>
        `
      )
      .join(""))

    safeHtml(els.adminUserList, (state.admin.users || [])
      .map((user) => {
        const securityState = getUserSecurityState(user.id)
        const securitySessions = securityState.data?.sessions || []
        const securityExpanded = state.expandedUserSecurityId === user.id
        const deleteBlockedReason = user.id === state.me?.user?.id
          ? "当前登录账号不能删除"
          : (user.is_admin && Number(state.admin?.metrics?.adminCount || 0) <= 1)
              ? "至少保留一个管理员账号"
              : ""
        const canDeleteUser = !deleteBlockedReason
        const userSummary = [
          user.is_admin ? "管理员" : "普通用户",
          user.plan_name || "免费版",
          `${user.feed_count} 源`,
          `账号 ${user.status}`,
          `订阅 ${user.subscription_status || "active"}/${user.subscription_provider || "system"}`,
          `到期 ${user.current_period_end ? formatDate(user.current_period_end) : "未设置"}`,
          securityState.data ? `${securitySessions.length} 会话` : null
        ]
          .filter(Boolean)
          .join(" · ")

        return `
          <article class="list-row admin-user-row${securityExpanded ? " admin-user-row-expanded" : ""}">
            <div class="list-main admin-user-row-main">
              <div class="admin-user-row-head">
                <strong>${escapeHtml(user.display_name || user.email)}</strong>
                <span class="muted admin-user-row-email">${escapeHtml(user.email)}</span>
              </div>
              <span class="muted admin-user-row-summary">${escapeHtml(userSummary)}</span>
            </div>
            <div class="inline-row toolbar-wrap admin-user-row-plan-controls">
              <select data-plan-select="${user.id}">
                ${renderPlanOptions(user.plan_code)}
              </select>
              <input type="date" data-expire-input="${user.id}" value="${toDateInputValue(user.current_period_end)}" />
              <button class="secondary" type="button" data-user-subscription-id="${user.id}">保存套餐</button>
            </div>
            <div class="reader-actions toolbar-wrap admin-user-row-actions">
              <button class="secondary" type="button" data-user-security-toggle="${user.id}">
                ${securityExpanded ? "收起安全" : "安全管理"}
              </button>
              <button class="secondary" type="button" data-user-export-id="${user.id}">
                导出
              </button>
              <button class="secondary" type="button" data-user-import-id="${user.id}">
                导入
              </button>
              <button class="secondary" type="button" data-user-id="${user.id}" data-make-admin="${user.is_admin ? "0" : "1"}">
                ${user.is_admin ? "撤销管理员" : "设为管理员"}
              </button>
              <button class="secondary" type="button" data-user-status-id="${user.id}" data-user-status="${user.status === "active" ? "disabled" : "active"}">
                ${user.status === "active" ? "禁用" : "启用"}
              </button>
              <button
                class="secondary"
                type="button"
                data-user-delete-id="${user.id}"
                data-user-label="${escapeHtml(user.display_name || user.email)}"
                ${canDeleteUser ? "" : `disabled title="${escapeHtml(deleteBlockedReason)}"`}
              >
                删除
              </button>
            </div>
            ${securityExpanded ? `<div class="admin-user-row-security">${renderAdminUserSecurityPanel(user.id, securityState)}</div>` : ""}
          </article>
        `
      })
      .join(""))

    safeHtml(els.adminOrderList, (state.admin.orders || [])
      .map((order) => {
        const orderSummary = [
          order.provider,
          order.status,
          formatDate(order.created_at),
          order.provider_checkout_id ? `支付编号 ${order.provider_checkout_id}` : null
        ]
          .filter(Boolean)
          .join(" · ")

        return `
          <article class="list-row admin-order-row">
            <div class="list-main admin-order-row-main">
              <strong class="admin-order-row-title">${escapeHtml(order.user_email)} · ${escapeHtml(order.plan_name)}</strong>
              <span class="muted admin-order-row-summary">${escapeHtml(orderSummary)}</span>
            </div>
            <span class="pill ${order.status === "paid" ? "success" : "warning"}">${formatPrice(order.amount_cents, order.currency, false)}</span>
          </article>
        `
      })
      .join(""))

    safeHtml(els.adminAuditList, (state.admin.auditLogs || []).length
      ? (state.admin.auditLogs || [])
          .map((entry) => {
            const actorLabel = entry.actor_display_name || entry.actor_email || "系统"
            const details = entry.details || {}
            const detailLines = []
            if (details.email) detailLines.push(`账号：${details.email}`)
            if (details.planCode) detailLines.push(`套餐：${details.planCode}`)
            if (details.runId) detailLines.push(`任务 ID：${details.runId}`)
            if (details.totalFeeds !== undefined) detailLines.push(`源数：${details.totalFeeds}`)
            if (details.revokedCount !== undefined) detailLines.push(`会话数：${details.revokedCount}`)
            if (details.sessionId) detailLines.push(`会话 ID：${details.sessionId}`)
            if (details.ipAddress) detailLines.push(`会话 IP：${details.ipAddress}`)
            if (details.userAgent) detailLines.push(`设备：${summarizeUserAgent(details.userAgent)}`)
            if (Array.isArray(details.changedKeys) && details.changedKeys.length) {
              detailLines.push(`字段：${details.changedKeys.join("、")}`)
            }
            if (entry.target_type || entry.target_id) {
              detailLines.push(`目标：${entry.target_type || "-"}${entry.target_id ? ` · ${entry.target_id}` : ""}`)
            }
            if (entry.actor_ip) {
              detailLines.push(`IP：${entry.actor_ip}`)
            }

            return `
              <article class="list-row">
                <div class="list-main">
                  <strong>${escapeHtml(entry.summary || formatAuditAction(entry.action))}</strong>
                  <span class="muted">${escapeHtml(actorLabel)} · ${escapeHtml(formatAuditAction(entry.action))} · ${formatDate(entry.created_at)}</span>
                  ${detailLines.map((line) => `<span class="muted">${escapeHtml(line)}</span>`).join("")}
                </div>
              </article>
            `
          })
          .join("")
      : '<article class="reader-empty-card"><strong>暂无审计记录</strong><span class="muted">管理员执行关键操作后会显示在这里。</span></article>')

    safeHtml(els.adminFeedList, (state.admin.feeds || [])
      .slice(0, 20)
      .map(
        (feed) => `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(feed.title)}</strong>
              <span class="muted">${feed.subscriber_count} 订阅者 · ${feed.item_count} 篇内容 · 最近抓取 ${formatDate(feed.last_fetched_at)}</span>
              <span class="muted">分类：${escapeHtml(feed.auto_category || "未分类")}</span>
              <span class="muted">${escapeHtml(feed.url)}</span>
              ${feed.last_error ? `<span class="muted">最近错误：${escapeHtml(feed.last_error)}</span>` : ""}
            </div>
            <button class="secondary" type="button" data-feed-reclassify="${escapeHtml(feed.id)}">AI 分类</button>
            ${safeUrl(feed.site_url) ? `<a class="secondary nav-link-btn" href="${escapeHtml(safeUrl(feed.site_url))}" target="_blank" rel="noreferrer">站点</a>` : ""}
          </article>
        `
      )
      .join(""))

    safeHtml(els.adminItemList, (state.admin.items || [])
      .slice(0, 20)
      .map(
        (item) => `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(item.title)}</strong>
              <span class="muted">${escapeHtml(item.feed_title)} · ${formatDate(item.published_at)}</span>
              ${item.summary ? `<span class="muted">${escapeHtml(item.summary)}</span>` : ""}
            </div>
            ${safeUrl(item.link) ? `<a class="secondary nav-link-btn" href="${escapeHtml(safeUrl(item.link))}" target="_blank" rel="noreferrer">原文</a>` : ""}
          </article>
        `
      )
      .join(""))

    document.querySelectorAll("[data-rule-id]").forEach((button) => {
      button.addEventListener("click", () => actions.toggleRule(Number(button.dataset.ruleId), button.dataset.ruleActive === "1"))
    })
    document.querySelectorAll("[data-user-id]").forEach((button) => {
      button.addEventListener("click", () => actions.updateUser(Number(button.dataset.userId), { isAdmin: button.dataset.makeAdmin === "1" }))
    })
    document.querySelectorAll("[data-user-security-toggle]").forEach((button) => {
      button.addEventListener("click", () => actions.toggleUserSecurity(Number(button.dataset.userSecurityToggle)))
    })
    document.querySelectorAll("[data-user-status-id]").forEach((button) => {
      button.addEventListener("click", () => actions.updateUser(Number(button.dataset.userStatusId), { status: button.dataset.userStatus }))
    })
    document.querySelectorAll("[data-user-delete-id]").forEach((button) => {
      button.addEventListener("click", () => actions.deleteUser(Number(button.dataset.userDeleteId), button.dataset.userLabel || ""))
    })
    document.querySelectorAll("[data-user-export-id]").forEach((button) => {
      button.addEventListener("click", () => actions.exportUserData(Number(button.dataset.userExportId)))
    })
    document.querySelectorAll("[data-user-import-id]").forEach((button) => {
      button.addEventListener("click", () => actions.importUserData(Number(button.dataset.userImportId)))
    })
    document.querySelectorAll("[data-user-subscription-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const userId = Number(button.dataset.userSubscriptionId)
        const planCode = document.querySelector(`[data-plan-select="${userId}"]`)?.value || ""
        const currentPeriodEnd = document.querySelector(`[data-expire-input="${userId}"]`)?.value || ""
        actions.updateUserSubscription(userId, planCode, currentPeriodEnd)
      })
    })
    document.querySelectorAll("[data-user-password-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault()
        actions.resetUserPassword(Number(form.dataset.userPasswordForm))
      })
    })
    document.querySelectorAll("[data-user-revoke-all]").forEach((button) => {
      button.addEventListener("click", () => actions.revokeAllUserSessions(Number(button.dataset.userRevokeAll)))
    })
    document.querySelectorAll("[data-user-session-revoke]").forEach((button) => {
      button.addEventListener("click", () =>
        actions.revokeUserSession(Number(button.dataset.userSessionRevoke), Number(button.dataset.sessionId))
      )
    })
    document.querySelectorAll("[data-plan-save]").forEach((button) => {
      button.addEventListener("click", () => actions.savePlanSettings(button.dataset.planSave))
    })
    document.querySelectorAll("[data-feed-reclassify]").forEach((button) => {
      button.addEventListener("click", () => actions.reclassifyFeed(Number(button.dataset.feedReclassify)))
    })
    document.querySelectorAll("[data-redeem-save]").forEach((button) => {
      button.addEventListener("click", () => actions.saveRedeemCode(Number(button.dataset.redeemSave)))
    })
    document.querySelectorAll("[data-redeem-toggle]").forEach((button) => {
      button.addEventListener("click", () =>
        actions.saveRedeemCode(Number(button.dataset.redeemToggle), button.dataset.redeemActive === "1")
      )
    })
    document.querySelectorAll("[data-redeem-delete]").forEach((button) => {
      button.addEventListener("click", () => actions.deleteRedeemCode(Number(button.dataset.redeemDelete), button.dataset.redeemCode || ""))
    })
    document.querySelectorAll("[data-redeem-batch-toggle]").forEach((button) => {
      button.addEventListener("click", () => actions.toggleRedeemBatch(button.dataset.redeemBatchToggle))
    })
    document.querySelectorAll("[data-redeem-batch-export]").forEach((button) => {
      button.addEventListener("click", () => actions.exportRedeemBatch(button.dataset.redeemBatchExport))
    })
    document.querySelectorAll("[data-redeem-batch-delete]").forEach((button) => {
      button.addEventListener("click", () => actions.deleteRedeemBatch(button.dataset.redeemBatchDelete, button.dataset.redeemBatchLabel || ""))
    })
    document.querySelectorAll("[data-plugin-toggle]").forEach((button) => {
      button.addEventListener("click", () => actions.togglePlugin(button.dataset.pluginToggle))
    })
    document.querySelectorAll("[data-site-domain]").forEach((button) => {
      button.addEventListener("click", () => actions.toggleBlockedSite(button.dataset.siteDomain, button.dataset.siteActive === "1"))
    })
    document.querySelectorAll("[data-ip-value]").forEach((button) => {
      button.addEventListener("click", () => actions.toggleBlockedIp(button.dataset.ipValue, button.dataset.ipActive === "1"))
    })
    document.querySelectorAll("[data-pool-edit]").forEach((button) => {
      button.addEventListener("click", () => actions.editTranslationProviderPoolEntry(button.dataset.poolEdit))
    })
    document.querySelectorAll("[data-pool-delete]").forEach((button) => {
      button.addEventListener("click", () => actions.removeTranslationProviderPoolEntry(button.dataset.poolDelete))
    })
    document.querySelectorAll("[data-ai-pool-edit]").forEach((button) => {
      button.addEventListener("click", () => actions.editAiPoolEntry(button.dataset.aiPoolEdit))
    })
    document.querySelectorAll("[data-ai-pool-delete]").forEach((button) => {
      button.addEventListener("click", () => actions.removeAiPoolEntry(button.dataset.aiPoolDelete))
    })

    renderMaintenanceStatus()
    renderRefreshStatus()
    renderSidebarInfo()
    syncMaintenancePolling()
    syncRefreshPolling()
  }

  function renderDatabaseStatus() {
    const database = state.admin?.database
    if (!database || !isAdmin()) {
      safeSet(els.adminDatabaseStatus, "textContent", "")
      safeHtml(els.adminDatabaseMetrics, "")
      safeHtml(els.adminDatabaseFlags, "")
      safeHtml(els.adminDatabaseTables, "")
      safeHtml(els.adminDatabaseBackups, "")
      return
    }

    safeSet(els.adminDatabaseStatus, "textContent", `数据库文件：${database.path || "-"}。WAL 模式：${database.journalMode || "未知"}。`)
    safeHtml(els.adminDatabaseMetrics, `
      <article class="metric-box"><span>总占用</span><strong>${formatBytes(database.totalBytes)}</strong></article>
      <article class="metric-box"><span>主库</span><strong>${formatBytes(database.mainBytes)}</strong></article>
      <article class="metric-box"><span>WAL</span><strong>${formatBytes(database.walBytes)}</strong></article>
      <article class="metric-box"><span>空闲页</span><strong>${formatBytes(database.freeBytes)}</strong></article>
      <article class="metric-box"><span>备份</span><strong>${Number(database.backups?.count || 0)}</strong></article>
    `)

    const freeRatio = Number(database.freeRatio || 0)
    const orphanTotal = Number(database.orphanTotal || 0)
    const fkViolations = Number(database.orphanMetrics?.foreignKeyViolations || 0)
    const vacuum = database.vacuum || {}
    const flags = [
      { tone: freeRatio > 0.2 ? "warning" : "success", label: `碎片率 ${(freeRatio * 100).toFixed(1)}%` },
      { tone: orphanTotal > 0 ? "warning" : "success", label: `孤儿数据 ${orphanTotal}` },
      { tone: fkViolations > 0 ? "warning" : "success", label: `外键异常 ${fkViolations}` },
      {
        tone: database.backups?.enabled ? "success" : "warning",
        label: database.backups?.enabled
          ? `自动备份 ${Number(database.backups?.automaticCount || 0)} / ${Number(database.backups?.maxFiles || 0)}`
          : "自动备份关闭"
      },
      {
        tone: vacuum.enabled === false ? "warning" : "success",
        label: vacuum.enabled === false
          ? "自动碎片整理关闭"
          : `自动碎片整理 ${Number(vacuum.intervalDays || 7)} 天`
      },
      { tone: "accent", label: `页大小 ${formatBytes(database.pageSize)}` },
      { tone: "accent", label: `页数 ${Number(database.pageCount || 0)}` },
      { tone: database.maintenance?.isRunning ? "accent" : "success", label: database.maintenance?.isRunning ? "清理运行中" : "维护空闲" }
    ]
    safeHtml(els.adminDatabaseFlags, flags.map((item) => `<span class="pill ${item.tone}">${escapeHtml(item.label)}</span>`).join(""))

    const tableLabels = {
      users: "用户",
      sessions: "会话",
      feeds: "订阅源",
      user_feeds: "用户订阅",
      items: "文章",
      user_item_states: "文章状态",
      audit_logs: "审计日志",
      refresh_runs: "刷新记录",
      billing_events: "订单事件"
    }
    safeHtml(els.adminDatabaseTables, (database.tableRows || []).length
      ? database.tableRows
          .map((entry) => `
            <article class="list-row">
              <div class="list-main">
                <strong>${escapeHtml(tableLabels[entry.table] || entry.table)}</strong>
                <span class="muted">${escapeHtml(entry.table)}</span>
              </div>
              <span class="pill accent">${Number(entry.rows || 0).toLocaleString()} 行</span>
            </article>
          `)
          .join("")
      : '<article class="reader-empty-card"><strong>暂无表统计</strong></article>')

    const backupFiles = database.backups?.files || []
    safeHtml(els.adminDatabaseBackups, backupFiles.length
      ? backupFiles.map((entry) => `
          <article class="list-row">
            <div class="list-main">
              <strong>${escapeHtml(entry.filename)}</strong>
              <span class="muted">${entry.automatic ? "自动备份" : "手动备份"} · ${formatBytes(entry.size)} · ${formatDate(entry.updatedAt)}</span>
            </div>
            <button class="secondary" type="button" data-backup-download="${escapeHtml(entry.filename)}">下载</button>
            <button class="secondary" type="button" data-backup-delete="${escapeHtml(entry.filename)}">删除</button>
          </article>
        `).join("")
      : '<article class="reader-empty-card"><strong>暂无备份文件</strong></article>')

    els.adminDatabaseBackups?.querySelectorAll("[data-backup-download]").forEach((button) => {
      button.addEventListener("click", () => actions.downloadBackupFile(button.dataset.backupDownload))
    })
    els.adminDatabaseBackups?.querySelectorAll("[data-backup-delete]").forEach((button) => {
      button.addEventListener("click", () => actions.deleteBackupFile(button.dataset.backupDelete))
    })
  }

  return {
    renderAdminDashboard,
    renderAuthState,
    renderSidebarInfo
  }
}
