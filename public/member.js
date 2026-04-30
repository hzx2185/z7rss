import {
  api,
  escapeHtml,
  formatBillingProvider,
  formatDate,
  formatMoney,
  safeHtml,
  safeSet,
  safeToggle,
  safeVal,
  summarizeUserAgent
} from "./shared-ui.js"
import {
  getProviderTargetCode,
  getTranslationProviderLabel,
  getTranslationTargetLabel,
  supportsAutoTranslate
} from "./translation-options.js"
import { registerMemberEvents } from "./member-events.js"

const state = {
  config: null,
  me: null,
  billing: null,
  preferences: null,
  security: null,
  digest: null,
  feeds: [],
  sectionNavReady: false,
  activeSectionId: "member-section-account"
}

const els = {
  statusBox: document.querySelector("#member-status"),
  statusText: document.querySelector("#member-status-text"),
  topLoginLink: document.querySelector("#member-top-login-link"),
  guestView: document.querySelector("#member-guest-view"),
  userView: document.querySelector("#member-user-view"),
  accountName: document.querySelector("#member-account-name"),
  accountEmail: document.querySelector("#member-account-email"),
  accountPlanBadge: document.querySelector("#member-account-plan-badge"),
  logoutBtn: document.querySelector("#member-logout-btn"),
  capabilityMetrics: document.querySelector("#member-capability-metrics"),
  capabilityFlags: document.querySelector("#member-capability-flags"),
  loginForm: document.querySelector("#member-login-form"),
  registerForm: document.querySelector("#member-register-form"),
  planList: document.querySelector("#member-plan-list"),
  redeemForm: document.querySelector("#member-redeem-form"),
  redeemCode: document.querySelector("#member-redeem-code"),
  aiForm: document.querySelector("#member-ai-form"),
  aiSaveBtn: document.querySelector('#member-ai-form button[type="submit"]'),
  aiFormHint: document.querySelector("#member-ai-form-hint"),
  aiBaseUrl: document.querySelector("#member-ai-base-url"),
  aiApiKey: document.querySelector("#member-ai-api-key"),
  aiModel: document.querySelector("#member-ai-model"),
  aiTranslatePrompt: document.querySelector("#member-ai-translate-prompt"),
  aiSummaryPrompt: document.querySelector("#member-ai-summary-prompt"),
  aiTestBtn: document.querySelector("#member-ai-test-btn"),
  digestForm: document.querySelector("#member-digest-form"),
  digestId: document.querySelector("#member-digest-id"),
  digestHint: document.querySelector("#member-digest-hint"),
  digestName: document.querySelector("#member-digest-name"),
  digestSendTime: document.querySelector("#member-digest-send-time"),
  digestEmails: document.querySelector("#member-digest-emails"),
  digestAiSource: document.querySelector("#member-digest-ai-source"),
  digestFeedScope: document.querySelector("#member-digest-feed-scope"),
  digestLookbackHours: document.querySelector("#member-digest-lookback-hours"),
  digestUnreadOnly: document.querySelector("#member-digest-unread-only"),
  digestFeedIdsField: document.querySelector("#member-digest-feed-ids-field"),
  digestFeedIds: document.querySelector("#member-digest-feed-ids"),
  digestCategoryField: document.querySelector("#member-digest-category-field"),
  digestCategory: document.querySelector("#member-digest-category"),
  digestPrompt: document.querySelector("#member-digest-prompt"),
  digestEnabled: document.querySelector("#member-digest-enabled"),
  digestNewBtn: document.querySelector("#member-digest-new-btn"),
  digestList: document.querySelector("#member-digest-list"),
  digestRuns: document.querySelector("#member-digest-runs"),
  translationForm: document.querySelector("#member-translation-form"),
  translationFormHint: document.querySelector("#member-translation-form-hint"),
  translationProvider: document.querySelector("#member-translation-provider"),
  translationTarget: document.querySelector("#member-translation-target"),
  translationAuto: document.querySelector("#member-translation-auto"),
  translationDisplay: document.querySelector("#member-translation-display"),
  translationSaveBtn: document.querySelector('#member-translation-form button[type="submit"]'),
  translationResetBtn: document.querySelector("#member-translation-reset-btn"),
  translationGoogleConfig: document.querySelector("#member-translation-google-config"),
  translationBingConfig: document.querySelector("#member-translation-bing-config"),
  translationDeepLxConfig: document.querySelector("#member-translation-deeplx-config"),
  translationGoogleBaseUrl: document.querySelector("#member-translation-google-base-url"),
  translationGoogleApiKey: document.querySelector("#member-translation-google-api-key"),
  translationBingBaseUrl: document.querySelector("#member-translation-bing-base-url"),
  translationBingApiKey: document.querySelector("#member-translation-bing-api-key"),
  translationBingRegion: document.querySelector("#member-translation-bing-region"),
  translationDeepLxBaseUrl: document.querySelector("#member-translation-deeplx-base-url"),
  translationDeepLxApiKey: document.querySelector("#member-translation-deeplx-api-key"),
  securityForm: document.querySelector("#member-security-form"),
  securityHint: document.querySelector("#member-security-hint"),
  currentPassword: document.querySelector("#member-current-password"),
  newPassword: document.querySelector("#member-new-password"),
  confirmPassword: document.querySelector("#member-confirm-password"),
  securitySaveBtn: document.querySelector('#member-security-form button[type="submit"]'),
  deviceList: document.querySelector("#member-device-list"),
  billingOverview: document.querySelector("#member-billing-overview"),
  billingHistory: document.querySelector("#member-billing-history"),
  adminEntry: document.querySelector("#member-admin-entry")
}

function getProviderSourceLabel(source) {
  if (source === "user") return "会员自定义"
  if (source === "system") return "系统默认"
  if (source === "public") return "Google 免 Key"
  return "未配置"
}

function getSelectedTranslationProvider() {
  return els.translationProvider.value || state.me?.account?.translation?.provider || "google"
}

function getSelectedTranslationTarget() {
  return els.translationTarget.value || state.me?.account?.translation?.targetLanguage || "zh-CN"
}

function setStatus(message, tone = "info") {
  if (!els.statusBox || !els.statusText) return
  els.statusText.textContent = String(message || "")
  els.statusBox.dataset.tone = tone
  els.statusBox.classList.toggle("hidden", !message)
}

function setAdminVisibility(isAdmin) {
  safeToggle(els.adminEntry, !isAdmin)
}

function setMemberMode(loggedIn) {
  document.body.dataset.memberMode = loggedIn ? "user" : "guest"
  if (els.guestView) els.guestView.classList.toggle("hidden", loggedIn)
  if (els.userView) els.userView.classList.toggle("hidden", !loggedIn)
  if (els.topLoginLink) els.topLoginLink.classList.toggle("hidden", loggedIn)
  if (els.logoutBtn) els.logoutBtn.classList.toggle("hidden", !loggedIn)
  document.querySelectorAll("[data-site-register]").forEach((link) => link.classList.toggle("hidden", loggedIn))
  document.querySelectorAll("[data-site-user]").forEach((pill) => {
    const user = state.me?.user
    pill.textContent = user?.isAdmin ? "管理员" : "会员"
    pill.classList.toggle("hidden", !loggedIn)
    pill.classList.toggle("success", Boolean(user?.isAdmin))
    pill.classList.toggle("accent", !user?.isAdmin)
  })
}

function formatPlanCode(code) {
  if (code === "free") return "免费版"
  if (code === "pro") return "专业版"
  if (code === "team") return "团队版"
  return code || "-"
}

function setActiveSectionNav(targetId) {
  document.querySelectorAll("[data-section-target]").forEach((link) => {
    link.classList.toggle("active", link.dataset.sectionTarget === targetId)
  })
}

function getValidMemberSectionId(value) {
  const targetId = String(value || "").replace(/^#/, "")
  return document.getElementById(targetId)?.classList.contains("member-section")
    ? targetId
    : "member-section-account"
}

function showMemberSection(targetId, options = {}) {
  const nextId = getValidMemberSectionId(targetId)
  state.activeSectionId = nextId
  document.querySelectorAll(".member-user-panel .member-section").forEach((section) => {
    section.classList.toggle("hidden", section.id !== nextId)
  })
  setActiveSectionNav(nextId)
  if (options.updateHash && window.location.hash !== `#${nextId}`) {
    window.history.pushState(null, "", `#${nextId}`)
  }
}

function initSectionNav() {
  if (state.sectionNavReady) return
  state.sectionNavReady = true

  const syncFromHash = () => {
    showMemberSection(window.location.hash || state.activeSectionId)
  }

  document.querySelectorAll("[data-section-target]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault()
      showMemberSection(link.dataset.sectionTarget || "member-section-account", { updateHash: true })
    })
  })

  window.addEventListener("popstate", syncFromHash)
  window.addEventListener("hashchange", syncFromHash)
  syncFromHash()
}

function renderAccountProfile() {
  const user = state.me?.user
  const account = state.me?.account

  if (!user || !account) {
    safeSet(els.accountName, "textContent", "会员")
    safeSet(els.accountEmail, "textContent", "登录后可查看账号邮箱")
    safeSet(els.accountPlanBadge, "textContent", "免费版")
    safeToggle(els.accountPlanBadge, true)
    return
  }

  safeSet(els.accountName, "textContent", user.displayName || user.email || "会员")
  safeSet(els.accountEmail, "textContent", user.email || "未设置邮箱")
  safeSet(els.accountPlanBadge, "textContent", account.plan?.name || formatPlanCode(account.plan?.code))
  safeToggle(els.accountPlanBadge, false)
}

function renderCapabilityOverview() {
  const account = state.me?.account

  const metrics = account
    ? [
        { label: "当前套餐", value: account.plan.name },
        { label: "订阅占用", value: `${account.usage.feedCount} / ${account.usage.feedLimit}` },
        { label: "文章保留", value: `${account.usage.savedItemLimit} 篇 / 源` },
        { label: "收藏上限", value: `${account.usage.favoriteCount} / ${account.usage.favoriteLimit}` },
        { label: "到期时间", value: account.subscription?.current_period_end ? formatDate(account.subscription.current_period_end) : "未设置" }
      ]
    : [
        { label: "套餐数量", value: String(state.config?.plans?.length || 0) },
        { label: "计费模式", value: formatBillingProvider(state.config?.billingProvider) },
        { label: "AI 总开关", value: state.config?.aiEnabled ? "已启用" : "已关闭" },
        { label: "支付能力", value: state.config?.stripeEnabled ? "Stripe" : "演示模式" }
      ]

  safeHtml(els.capabilityMetrics, metrics
    .map(
      (item) => `
        <article class="metric-box">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </article>
      `
    )
    .join(""))

  const flags = []
  if (account) {
    if (account.features.translation && account.translation?.providerConfigured) {
      flags.push({
        tone: "success",
        label: `翻译：${account.translation.autoTranslate ? "自动开" : "手动"} · ${getTranslationProviderLabel(account.translation?.provider)}`
      })
    } else if (account.features.translation) {
      flags.push({ tone: "warning", label: "翻译：未配置" })
    } else {
      flags.push({ tone: "muted", label: "翻译：未开通" })
    }

    if (account.features.summary) {
      flags.push({ tone: "success", label: "AI 总结：已开通" })
    } else {
      flags.push({ tone: "muted", label: "AI 总结：未开通" })
    }

    if (account.features.customAi) {
      flags.push({ tone: account.ai.hasConfiguredProvider ? "success" : "warning", label: "自定义 AI" })
    }
  }

  safeHtml(els.capabilityFlags, flags.length
    ? flags.map((item) => `<span class="pill ${item.tone}">${escapeHtml(item.label)}</span>`).join("")
    : '<span class="muted">登录后查看权益细节</span>')
}

function renderAuth() {
  const user = state.me?.user
  if (!user) {
    setMemberMode(false)
    setAdminVisibility(false)
    renderAccountProfile()
    renderCapabilityOverview()
    renderAiFormState()
    renderDigestState()
    renderTranslationFormState()
    renderTranslationCredentialState()
    renderSecurityState()
    return
  }

  setMemberMode(true)
  setAdminVisibility(Boolean(user.isAdmin))
  renderAccountProfile()
  renderCapabilityOverview()
  renderAiFormState()
  renderDigestState()
  renderTranslationFormState()
  renderTranslationCredentialState()
  renderSecurityState()
}

function renderPlans() {
  const plans = state.billing?.plans || state.config?.plans || []
  const html = plans
    .map((plan) => {
      const currentPlanCode = state.me?.account?.plan?.code
      const isCurrent = plan.code === currentPlanCode
      const activeClass = isCurrent ? "plan-card highlight" : "plan-card"
      return `
        <article class="${activeClass}">
          <p class="eyebrow">${escapeHtml(formatPlanCode(plan.code))}</p>
          <h2>${escapeHtml(plan.name)}</h2>
          <p class="plan-price">${formatMoney(plan.price_monthly_cents)}</p>
          <p class="muted">${escapeHtml(plan.description || "")}</p>
          <div class="compact-list">
            <div class="list-row"><div class="list-main"><strong>订阅上限</strong><span class="muted">${plan.max_feeds} 个</span></div></div>
            <div class="list-row"><div class="list-main"><strong>文章保留</strong><span class="muted">${plan.max_saved_items} 篇 / 源</span></div></div>
            <div class="list-row"><div class="list-main"><strong>收藏上限</strong><span class="muted">${plan.max_favorite_items} 篇</span></div></div>
            <div class="list-row"><div class="list-main"><strong>翻译功能</strong><span class="muted">${plan.ai_translation_enabled ? "支持" : "不支持"}</span></div></div>
            <div class="list-row"><div class="list-main"><strong>AI 总结</strong><span class="muted">${plan.ai_summary_enabled ? "支持" : "不支持"}</span></div></div>
            <div class="list-row"><div class="list-main"><strong>自定义 AI</strong><span class="muted">${plan.custom_ai_enabled ? "支持" : "不支持"}</span></div></div>
            <div class="list-row"><div class="list-main"><strong>AI 邮件简报</strong><span class="muted">${plan.email_digest_enabled ? `${plan.max_digest_rules || 0} 条规则` : "不支持"}</span></div></div>
          </div>
          <div class="link-row">
            <button type="button" ${isCurrent ? "disabled" : ""} data-checkout-plan="${escapeHtml(plan.code)}">
              ${isCurrent ? "当前套餐" : plan.code === "free" ? "切换到免费版" : "升级到此套餐"}
            </button>
          </div>
        </article>
      `
    })
    .join("")
  safeHtml(els.planList, html)
  document.querySelectorAll("[data-checkout-plan]").forEach((button) => {
    button.addEventListener("click", () => checkoutPlan(button.dataset.checkoutPlan))
  })
}

function renderBilling() {
  if (!state.me?.user || !state.billing) {
    safeHtml(els.billingOverview, "<p class=\"status-text\">请先登录</p>")
    safeHtml(els.billingHistory, "")
    return
  }

  const account = state.billing.account
  safeHtml(els.billingOverview, `
    <div class="member-section-headline">
      <strong>${escapeHtml(account.plan.name)}</strong>
      <span class="muted">${escapeHtml(formatPlanCode(account.plan.code))} · ${escapeHtml(account.subscription?.status || "active")}</span>
    </div>
    <div class="metrics-grid">
      <article class="metric-box"><span>订阅源</span><strong>${account.usage.feedCount} / ${account.usage.feedLimit}</strong></article>
      <article class="metric-box"><span>文章保留</span><strong>${account.usage.savedItemLimit} / 源</strong></article>
      <article class="metric-box"><span>收藏上限</span><strong>${account.usage.favoriteCount} / ${account.usage.favoriteLimit}</strong></article>
      <article class="metric-box"><span>账单能力</span><strong>${escapeHtml(state.billing.stripeEnabled ? "Stripe" : "演示模式")}</strong></article>
    </div>
    <div class="member-billing-meta">
      <span>AI 来源：${escapeHtml(account.ai.source === "user" ? "用户配置" : "系统默认")}</span>
      <span>到期：${formatDate(account.subscription?.current_period_end)}</span>
      <span>订阅来源：${escapeHtml(formatBillingProvider(account.subscription?.provider || "system"))}</span>
      <span>当前状态：${escapeHtml(account.subscription?.status || "active")}</span>
    </div>
  `)

  const events = state.billing.billingEvents || []
  safeHtml(els.billingHistory, events.length
    ? events
        .map(
          (event) => `
            <article class="list-row">
              <div class="list-main">
                <strong>${escapeHtml(event.plan_name || "-")}</strong>
                <span class="muted">${escapeHtml(formatBillingProvider(event.provider || "-"))} · ${escapeHtml(event.status || "-")}</span>
                <span class="muted">${formatDate(event.created_at)}</span>
              </div>
              <span class="pill ${event.status === "paid" ? "success" : "warning"}">${formatMoney(event.amount_cents, event.currency, false)}</span>
            </article>
          `
        )
        .join("")
    : "<p class=\"status-text\">暂无账单记录</p>")
}

function renderTranslationProviderPanels() {
  const selectedProvider = getSelectedTranslationProvider()
  const selectedTarget = getSelectedTranslationTarget()
  const targetLabel = getTranslationTargetLabel(selectedTarget)
  const targetCode = getProviderTargetCode(selectedProvider, selectedTarget)
  const loggedIn = Boolean(state.me?.user)
  const providerStatus = state.me?.account?.translationProviders?.[selectedProvider] || null
  const aiStatus = state.me?.account?.translationProviders?.ai || null
  const sourceLabel = loggedIn ? getProviderSourceLabel(providerStatus?.source) : "登录后可查看"
  const configuredLabel = loggedIn ? (providerStatus?.configured ? "已可用" : "未配置") : "登录后可查看"
  const bingBaseUrl =
    String(safeVal(els.translationBingBaseUrl, "") || state.preferences?.translation_bing?.base_url || "").trim() ||
    "https://api.cognitive.microsofttranslator.com"
  const aiBaseUrl = String(safeVal(els.aiBaseUrl, "") || state.preferences?.ai?.base_url || "").trim()

  if (els.translationGoogleCard) els.translationGoogleCard.classList.toggle("hidden", selectedProvider !== "google")
  if (els.translationBingCard) els.translationBingCard.classList.toggle("hidden", selectedProvider !== "bing")
  if (els.translationProviderNoteCard) els.translationProviderNoteCard.classList.remove("hidden")

  let noteTitle = `${getTranslationProviderLabel(selectedProvider)} 接口`
  let noteRows = []
  let noteHint = "登录后可查看当前接口来源和是否已配置。"

  if (selectedProvider === "google") {
    const googleMode =
      !loggedIn
        ? "登录后可查看"
        : providerStatus?.source === "user"
          ? "会员 Key"
          : providerStatus?.source === "system"
            ? "系统 Key"
            : "免 Key"
    noteRows = [
      { label: "官方接口", value: "https://translation.googleapis.com/language/translate/v2" },
      { label: "免 Key 接口", value: "https://translate.googleapis.com/translate_a/single" },
      { label: "认证方式", value: "API Key 可选；留空自动走免 Key" },
      { label: "常用参数", value: `target=${targetCode} · q / dt=t / sl=auto` },
      { label: "自动翻译", value: supportsAutoTranslate(selectedProvider) ? "支持" : "不支持" },
      { label: "当前模式", value: googleMode }
    ]
    noteHint = "Google 默认可直接免 key 使用；如填写会员自己的 Key，会优先切到官方 API。"
  } else if (selectedProvider === "bing") {
    noteRows = [
      { label: "接口地址", value: `${bingBaseUrl.replace(/\/$/, "")}/translate` },
      { label: "API / 认证", value: "header: Ocp-Apim-Subscription-Key" },
      { label: "常用参数", value: `api-version=3.0, to=${targetCode}, textType=plain` },
      { label: "可选区域", value: "header: Ocp-Apim-Subscription-Region" },
      { label: "当前配置", value: `${configuredLabel} · ${sourceLabel}` }
    ]
    noteHint = "必应可在右侧同时维护接口地址、Key 和区域，适合 Azure 多区域部署。"
  } else if (selectedProvider === "deeplx") {
    noteRows = [
      { label: "接口地址", value: "由管理员统一配置 DEEPLX_API_URL" },
      { label: "API / 认证", value: "默认无需额外 API Key" },
      { label: "常用参数", value: `body: text, source_lang=auto, target_lang=${targetCode}` },
      { label: "自动翻译", value: supportsAutoTranslate(selectedProvider) ? "支持" : "不支持" },
      { label: "当前配置", value: `${configuredLabel} · ${sourceLabel}` }
    ]
    noteHint = `DeepLX 当前目标语言为 ${targetLabel}，会员页只展示接口说明，地址由站点统一维护。`
  } else if (selectedProvider === "sogou") {
    noteTitle = "搜狗外部翻译"
    noteRows = [
      { label: "打开地址", value: "https://fanyi.sogou.com/text" },
      { label: "调用方式", value: "浏览器打开第三方翻译页" },
      { label: "常用参数", value: `keyword, transto=${targetCode}, model=general` },
      { label: "自动翻译", value: "不支持" },
      { label: "站内状态", value: "仅跳转外部页面，不落库" }
    ]
    noteHint = "搜狗仅用于快速打开外部网页翻译，不支持站内自动翻译、存库和凭据配置。"
  } else {
    const aiSourceLabel = loggedIn ? getProviderSourceLabel(state.me?.account?.ai?.source) : "登录后可查看"
    const aiConfiguredLabel = loggedIn ? (aiStatus?.configured ? "已可用" : "未配置") : "登录后可查看"
    const aiEndpoint = aiBaseUrl
      ? `${aiBaseUrl.replace(/\/$/, "")}/chat/completions`
      : state.me?.account?.ai?.source === "system"
        ? "系统默认 AI 接口 /chat/completions"
        : "在上方自定义 AI 中填写"
    noteRows = [
      { label: "接口地址", value: aiEndpoint },
      { label: "API / 认证", value: "header: Authorization: Bearer API_KEY" },
      { label: "常用参数", value: `body: model, messages[] · 目标 ${targetLabel}` },
      { label: "自动翻译", value: "支持" },
      { label: "当前配置", value: `${aiConfiguredLabel} · ${aiSourceLabel}` }
    ]
    noteHint = "AI 翻译使用 OpenAI 兼容接口，接口地址、模型和提示词统一在上方“自定义 AI”区域维护。"
  }

  if (els.translationProviderNoteTitle) els.translationProviderNoteTitle.textContent = noteTitle
  if (els.translationProviderNote) els.translationProviderNote.innerHTML = `
    <div class="member-provider-note-list">
      ${noteRows
        .map(
          (row) => `
            <div class="member-provider-note-row">
              <span>${escapeHtml(row.label)}</span>
              <strong>${escapeHtml(row.value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
    <p class="status-text">${escapeHtml(noteHint)}</p>
  `
}

function applyPreferences(preferences) {
  state.preferences = preferences
  const ai = preferences?.ai || {}
  const translation = preferences?.translation || {}
  const google = preferences?.translation_google || {}
  const bing = preferences?.translation_bing || {}
  const deeplx = preferences?.translation_deeplx || {}
  if (els.aiBaseUrl) els.aiBaseUrl.value = ai.base_url || ""
  if (els.aiApiKey) {
    els.aiApiKey.value = ""
    els.aiApiKey.placeholder = ai.api_key_unavailable
      ? "旧密钥不可用，请重新保存"
      : ai.api_key_configured
        ? "已配置，留空表示保留原值"
        : ""
  }
  if (els.aiModel) els.aiModel.value = ai.model || ""
  if (els.aiTranslatePrompt) els.aiTranslatePrompt.value = ai.translate_prompt || ""
  if (els.aiSummaryPrompt) els.aiSummaryPrompt.value = ai.summary_prompt || ""
  if (els.translationProvider) els.translationProvider.value = translation.provider || "google"
  if (els.translationTarget) els.translationTarget.value = translation.target_language || "zh-CN"
  if (els.translationAuto) els.translationAuto.checked = translation.auto_translate === "1"
  if (els.translationDisplay) els.translationDisplay.checked = translation.display_translated !== "0"
  if (els.translationGoogleBaseUrl) els.translationGoogleBaseUrl.value = google.base_url || ""
  if (els.translationGoogleApiKey) {
    els.translationGoogleApiKey.value = ""
    els.translationGoogleApiKey.placeholder = google.api_key_unavailable
      ? "旧密钥不可用，请重新保存"
      : google.api_key_configured
        ? "已配置会员 Key，留空表示保留原值"
        : "留空则使用 Google 免 Key 模式"
  }
  if (els.translationBingBaseUrl) els.translationBingBaseUrl.value = bing.base_url || ""
  if (els.translationBingApiKey) {
    els.translationBingApiKey.value = ""
    els.translationBingApiKey.placeholder = bing.api_key_unavailable
      ? "旧密钥不可用，请重新保存"
      : bing.api_key_configured
        ? "已配置会员密钥，留空表示保留原值"
        : ""
  }
  if (els.translationBingRegion) els.translationBingRegion.value = bing.region || ""
  if (els.translationDeepLxBaseUrl) els.translationDeepLxBaseUrl.value = deeplx.base_url || ""
  if (els.translationDeepLxApiKey) {
    els.translationDeepLxApiKey.value = ""
    els.translationDeepLxApiKey.placeholder = deeplx.api_key_unavailable
      ? "旧密钥不可用，请重新保存"
      : deeplx.api_key_configured
        ? "已配置，留空表示保留原值"
        : ""
  }
  renderAiFormState()
  renderTranslationFormState()
  renderTranslationCredentialState()
}

function resetDigestForm(rule = null) {
  if (!els.digestForm) return
  els.digestId.value = rule?.id || ""
  els.digestName.value = rule?.name || "每日简报"
  els.digestSendTime.value = rule?.sendTime || "09:00"
  els.digestEmails.value = (rule?.recipientEmails || []).filter(Boolean).join(", ")
  els.digestAiSource.value = rule?.aiSource || "system"
  els.digestFeedScope.value = rule?.feedScope || "all"
  els.digestLookbackHours.value = String(rule?.lookbackHours || 24)
  els.digestUnreadOnly.checked = Boolean(rule?.unreadOnly)
  els.digestCategory.value = rule?.category || ""
  els.digestPrompt.value = rule?.prompt || ""
  els.digestEnabled.checked = rule ? Boolean(rule.isEnabled) : true
  const selectedIds = new Set((rule?.feedIds || []).map((id) => String(id)))
  Array.from(els.digestFeedIds?.options || []).forEach((option) => {
    option.selected = selectedIds.has(option.value)
  })
  syncDigestScopeFields()
}

function syncDigestScopeFields() {
  const scope = els.digestFeedScope?.value || "all"
  safeToggle(els.digestFeedIdsField, scope !== "selected")
  safeToggle(els.digestCategoryField, scope !== "category")
}

function renderDigestFeeds() {
  if (!els.digestFeedIds) return
  const options = state.feeds.map((feed) => {
    const label = feed.title || feed.feed_title || `订阅源 ${feed.feed_id || feed.id}`
    const id = feed.feed_id || feed.id
    return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
  }).join("")
  safeHtml(els.digestFeedIds, options || '<option disabled>暂无订阅源</option>')
}

function renderDigestState() {
  const loggedIn = Boolean(state.me?.user)
  const canUse = Boolean(state.me?.account?.features?.digest && state.me?.account?.features?.emailDigest)
  const account = state.me?.account
  const disabled = !loggedIn || !canUse
  ;[
    els.digestName,
    els.digestSendTime,
    els.digestEmails,
    els.digestAiSource,
    els.digestFeedScope,
    els.digestLookbackHours,
    els.digestUnreadOnly,
    els.digestFeedIds,
    els.digestCategory,
    els.digestPrompt,
    els.digestEnabled,
    els.digestNewBtn,
    els.digestForm?.querySelector('button[type="submit"]')
  ].forEach((element) => {
    if (element) element.disabled = disabled
  })

  if (!loggedIn) {
    safeSet(els.digestHint, "textContent", "请先登录，再配置每日简报。")
    safeHtml(els.digestList, "")
    safeHtml(els.digestRuns, "")
    return
  }
  if (!canUse) {
    safeSet(els.digestHint, "textContent", "当前套餐不支持 AI 邮件简报，请升级到支持的套餐。")
    safeHtml(els.digestList, "")
    safeHtml(els.digestRuns, "")
    return
  }

  syncDigestScopeFields()
  const limit = account?.limits?.digestRules || account?.usage?.digestRuleLimit || 0
  const used = state.digest?.rules?.length || account?.usage?.digestRules || 0
  const mailConfigured = state.digest?.mail?.configured
  const inputSettings = state.digest?.inputSettings || { maxItems: 30, maxCharsPerItem: 300, maxTotalChars: 6000, inputMode: "title_summary" }
  const inputModeLabel = inputSettings.inputMode === "title"
    ? "仅标题"
    : inputSettings.inputMode === "title_summary_body"
      ? "标题 + 摘要/正文片段"
      : "标题 + 摘要"
  safeSet(els.digestHint, "textContent", `已使用 ${used} / ${limit} 条规则。输入策略：${inputModeLabel}，最多 ${inputSettings.maxItems} 篇、每篇 ${inputSettings.maxCharsPerItem} 字、总输入 ${inputSettings.maxTotalChars} 字。邮件服务${mailConfigured ? "已配置" : "未配置，请联系管理员完善 SMTP" }。`)
  renderDigestFeeds()

  const rules = state.digest?.rules || []
  safeHtml(els.digestList, rules.length
    ? rules.map((rule) => {
        const emailText = rule.recipientEmails.length ? rule.recipientEmails.join(", ") : "不发送邮件"
        return `
        <article class="list-row">
          <div class="list-main">
            <strong>${escapeHtml(rule.name)}</strong>
            <span class="muted">${escapeHtml(rule.sendTime)} · 最近 ${Math.round((rule.lookbackHours || 24) / 24)} 天${rule.unreadOnly ? " · 仅未读" : ""} · ${escapeHtml(rule.feedScope === "all" ? "全部订阅源" : rule.feedScope === "selected" ? `${rule.feedIds.length} 个订阅源` : rule.category || "指定分类")} · ${escapeHtml(emailText)}</span>
          </div>
          <span class="pill ${rule.isEnabled ? "success" : "muted"}">${rule.isEnabled ? "启用" : "停用"}</span>
          <button class="secondary" type="button" data-digest-edit="${escapeHtml(rule.id)}">编辑</button>
          <button class="secondary" type="button" data-digest-test="${escapeHtml(rule.id)}">${rule.recipientEmails.length ? "测试发送" : "测试生成"}</button>
          <button class="secondary" type="button" data-digest-delete="${escapeHtml(rule.id)}">删除</button>
        </article>
      `}).join("")
    : '<p class="status-text">暂无简报规则</p>')

  const runs = state.digest?.runs || []
  safeHtml(els.digestRuns, runs.length
    ? `<div class="card-head"><h3>发送记录</h3></div>${runs.slice(0, 8).map((run) => `
        <article class="list-row">
          <div class="list-main">
            <strong>${escapeHtml(run.ruleName || `规则 ${run.ruleId}`)}</strong>
            <span class="muted">${formatDate(run.startedAt)} · ${escapeHtml(run.emailTo || "未发送邮件")}</span>
            ${run.error ? `<span class="muted">失败原因：${escapeHtml(run.error)}</span>` : ""}
            ${run.content ? `<details class="digest-run-content">
              <summary>简报内容</summary>
              <pre>${escapeHtml(run.content)}</pre>
            </details>` : ""}
          </div>
          <span class="pill ${run.status === "success" ? "success" : run.status === "failed" ? "warning" : "muted"}">${escapeHtml(run.status)}</span>
        </article>
      `).join("")}`
    : "")

  els.digestList?.querySelectorAll("[data-digest-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = rules.find((entry) => String(entry.id) === String(button.dataset.digestEdit))
      resetDigestForm(rule)
    })
  })
  els.digestList?.querySelectorAll("[data-digest-test]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const run = await api(`/api/account/digest-rules/${button.dataset.digestTest}/test`, { method: "POST" })
        await loadDigest()
        const sent = Boolean(run.emailTo)
        setStatus(run.status === "success" ? (sent ? "测试简报已发送" : "测试简报已生成") : `测试失败：${run.error || "未知错误"}`, run.status === "success" ? "success" : "error")
      } catch (error) {
        setStatus(error.message, "error")
      }
    })
  })
  els.digestList?.querySelectorAll("[data-digest-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/account/digest-rules/${button.dataset.digestDelete}`, { method: "DELETE" })
        await loadDigest()
        resetDigestForm()
        setStatus("简报规则已删除", "success")
      } catch (error) {
        setStatus(error.message, "error")
      }
    })
  })
}

function renderAiFormState() {
  const loggedIn = Boolean(state.me?.user)
  const canCustomize = Boolean(state.me?.account?.features.customAi)
  const disabled = !loggedIn || !canCustomize

  ;[
    els.aiBaseUrl,
    els.aiApiKey,
    els.aiModel,
    els.aiTranslatePrompt,
    els.aiSummaryPrompt,
    els.aiSaveBtn,
    els.aiTestBtn
  ].forEach((element) => {
    if (element) element.disabled = disabled
  })

  if (!loggedIn) {
    safeSet(els.aiFormHint, "textContent", "请先登录，再查看当前 AI 配置来源和编辑权限。")
    return
  }

  if (!canCustomize) {
    safeSet(els.aiFormHint, "textContent", "当前套餐不支持自定义 AI 接口，请升级到付费套餐后再编辑。")
    return
  }

  const sourceText = state.me.account.ai.source === "user" ? "当前正在使用会员自定义配置。" : "当前正在使用系统默认配置。"
  const providerText = state.me.account.ai.hasConfiguredProvider ? "已经存在可用 AI 服务。" : "尚未配置可用 AI 服务。"
  safeSet(els.aiFormHint, "textContent", `${sourceText}${providerText}`)
}

function renderTranslationFormState() {
  const loggedIn = Boolean(state.me?.user)
  const selectedProvider = getSelectedTranslationProvider()
  const selectedTarget = getSelectedTranslationTarget()
  const autoSupported = supportsAutoTranslate(selectedProvider)
  ;[
    els.translationProvider,
    els.translationTarget,
    els.translationDisplay,
    els.translationSaveBtn
  ].forEach((element) => {
    if (element) element.disabled = !loggedIn
  })
  if (els.translationAuto) els.translationAuto.disabled = !loggedIn || !autoSupported

  if (!loggedIn) {
    safeSet(els.translationFormHint, "textContent", "请先登录，再设置默认翻译工具和目标语言。")
    renderTranslationCredentialState()
    return
  }

  const translation = state.me?.account?.translation
  if (!translation) {
    safeSet(els.translationFormHint, "textContent", "当前翻译设置加载中。")
    renderTranslationCredentialState()
    return
  }

  const providerStatus = state.me?.account?.translationProviders?.[selectedProvider] || null
  const providerText = getTranslationProviderLabel(selectedProvider)
  const targetText = getTranslationTargetLabel(selectedTarget)
  const autoEnabled = Boolean(els.translationAuto?.checked)
  const autoText = translation.autoTranslateActive && autoEnabled
    ? "已自动翻译并存库。"
    : autoEnabled
      ? !(providerStatus?.autoTranslateSupported ?? supportsAutoTranslate(selectedProvider))
        ? `${providerText} 暂不支持自动翻译。`
        : !providerStatus?.configured
          ? `${providerText} 尚未配置完成。`
          : "满足套餐权限后会自动落库。"
      : "当前为手工翻译。"
  const sourceText = providerStatus ? `凭据来自 ${getProviderSourceLabel(providerStatus.source)}。` : ""
  safeSet(els.translationFormHint, "textContent", `默认 ${providerText} · 目标 ${targetText}。${sourceText}${autoText}`)
  renderTranslationCredentialState()
}

function renderTranslationCredentialState() {
  const loggedIn = Boolean(state.me?.user)
  const selectedProvider = getSelectedTranslationProvider()
  const canEdit = loggedIn
  ;[
    els.translationGoogleBaseUrl,
    els.translationGoogleApiKey,
    els.translationBingBaseUrl,
    els.translationBingApiKey,
    els.translationBingRegion,
    els.translationDeepLxBaseUrl,
    els.translationDeepLxApiKey,
    els.translationResetBtn
  ].forEach((element) => {
    if (element) element.disabled = !canEdit
  })

  if (els.translationGoogleConfig) els.translationGoogleConfig.classList.toggle("hidden", selectedProvider !== "google")
  if (els.translationBingConfig) els.translationBingConfig.classList.toggle("hidden", selectedProvider !== "bing")
  if (els.translationDeepLxConfig) els.translationDeepLxConfig.classList.toggle("hidden", selectedProvider !== "deeplx")
}

function renderSecurityState() {
  const loggedIn = Boolean(state.me?.user)
  ;[
    els.currentPassword,
    els.newPassword,
    els.confirmPassword,
    els.securitySaveBtn
  ].forEach((element) => {
    if (element) element.disabled = !loggedIn
  })

  if (!loggedIn) {
    safeSet(els.securityHint, "请先登录，再修改密码。")
    safeHtml(els.deviceList, '<p class="status-text">登录后可查看设备列表。</p>')
    return
  }

  const sessions = state.security?.sessions || []
  if (!state.security) {
    safeSet(els.securityHint, "正在加载设备信息...")
    safeHtml(els.deviceList, '<p class="status-text">正在加载设备信息...</p>')
    return
  }

  safeSet(els.securityHint, "当前设备的登录状态。")

  safeHtml(els.deviceList, sessions.length
    ? sessions
        .map(
          (session) => `
            <article class="device-item ${session.isCurrent ? "is-current" : ""}">
              <div class="device-info">
                <div class="device-icon">${session.isCurrent ? "当前" : "📱"}</div>
                <div class="device-meta">
                  <strong>${escapeHtml(session.isCurrent ? "当前设备" : summarizeUserAgent(session.userAgent))}</strong>
                  <span class="muted">${formatDate(session.lastSeenAt)} · IP: ${escapeHtml(session.ipAddress || "未知")}</span>
                </div>
              </div>
              ${!session.isCurrent ? `<button class="device-revoke-btn secondary" data-session-id="${escapeHtml(session.id)}" type="button">退出</button>` : ""}
            </article>
          `
        )
        .join("")
    : '<p class="status-text">暂无设备数据</p>')

  els.deviceList?.querySelectorAll(".device-revoke-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = btn.dataset.sessionId
      try {
        await api(`/api/auth/sessions/${sessionId}`, { method: "DELETE" })
        await loadSecurity()
        setStatus("已退出该设备", "success")
      } catch (error) {
        setStatus(error.message, "error")
      }
    })
  })
}

async function loadConfig() {
  state.config = await api("/api/config")
  renderCapabilityOverview()
  renderPlans()
}

async function loadMe() {
  const result = await api("/api/auth/me")
  state.me = result.authenticated ? result : null
  renderAuth()
}

async function loadBilling() {
  if (!state.me?.user) {
    state.billing = null
    renderPlans()
    renderBilling()
    renderCapabilityOverview()
    return
  }

  state.billing = await api("/api/billing/overview")
  renderPlans()
  renderBilling()
  renderCapabilityOverview()
}

async function loadPreferences() {
  if (!state.me?.user) {
    applyPreferences(null)
    return
  }
  const result = await api("/api/account/preferences")
  applyPreferences(result.preferences)
}

async function loadFeeds() {
  if (!state.me?.user) {
    state.feeds = []
    renderDigestFeeds()
    return
  }
  state.feeds = await api("/api/feeds")
  renderDigestFeeds()
}

async function loadDigest() {
  if (!state.me?.user || !state.me?.account?.features?.digest) {
    state.digest = null
    renderDigestState()
    return
  }
  state.digest = await api("/api/account/digest-rules")
  renderDigestState()
}

async function loadSecurity() {
  if (!state.me?.user) {
    state.security = null
    renderSecurityState()
    return
  }
  const result = await api("/api/account/security")
  state.security = result
  renderSecurityState()
}

async function checkoutPlan(planCode) {
  if (!state.me?.user) {
    setStatus("请先登录", "warning")
    return
  }
  try {
    const result = await api("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode })
    })
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl
      return
    }
    await boot()
    setStatus(result.message || "套餐已更新", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function boot() {
  initSectionNav()
  await loadConfig()
  await loadMe()
  await loadBilling()
  if (state.me?.user) {
    await loadPreferences()
    await loadFeeds()
    await loadDigest()
    await loadSecurity()
    setStatus("会员中心已就绪", "success")
  } else {
    applyPreferences(null)
    state.security = null
    state.digest = null
    state.feeds = []
    renderDigestState()
    renderSecurityState()
    setStatus("请先登录或注册", "info")
  }
}

registerMemberEvents({
  api,
  els,
  state,
  supportsAutoTranslate,
  actions: {
    applyPreferences,
    boot,
    getSelectedTranslationProvider,
    loadBilling,
    loadDigest,
    loadMe,
    loadPreferences,
    resetDigestForm,
    setStatus
  },
  renderers: {
    renderAuth,
    renderBilling,
    renderDigestState,
    renderPlans,
    renderSecurityState,
    syncDigestScopeFields,
    renderTranslationCredentialState,
    renderTranslationFormState
  }
})

boot().catch((error) => {
  setStatus(error.message, "error")
})
