export function registerMemberEvents({
  api,
  els,
  state,
  supportsAutoTranslate,
  actions,
  renderers
}) {
  function formatAiRuntimeSource(result = {}) {
    if (result.label) return result.label
    if (result.source === "user") return "我的 AI 配置"
    if (result.source === "system_pool") return "系统 AI 池"
    if (result.source === "system") return "系统默认 AI"
    return ""
  }

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    try {
      actions.setStatus("登录中...", "info")
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.querySelector("#member-login-email").value,
          password: document.querySelector("#member-login-password").value
        })
      })
      actions.clearAuthStateCache()
      await actions.boot()
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    try {
      actions.setStatus("注册中...", "info")
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: document.querySelector("#member-register-name").value,
          email: document.querySelector("#member-register-email").value,
          password: document.querySelector("#member-register-password").value
        })
      })
      actions.clearAuthStateCache()
      await actions.boot()
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" })
      actions.clearAuthStateCache()
      state.me = null
      state.billing = null
      state.preferences = null
      state.security = null
      state.digest = null
      state.feeds = []
      renderers.renderAuth()
      renderers.renderPlans()
      renderers.renderBilling()
      renderers.renderDigestState()
      actions.applyPreferences(null)
      renderers.renderSecurityState()
      actions.setStatus("已退出", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.redeemForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    try {
      await api("/api/billing/redeem", {
        method: "POST",
        body: JSON.stringify({ code: els.redeemCode.value.trim() })
      })
      els.redeemCode.value = ""
      await actions.boot()
      actions.setStatus("兑换成功", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.aiForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    try {
      await api("/api/account/preferences/ai", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: els.aiBaseUrl.value,
          apiKey: els.aiApiKey.value,
          model: els.aiModel.value,
          translatePrompt: els.aiTranslatePrompt.value,
          summaryPrompt: els.aiSummaryPrompt.value
        })
      })
      await actions.loadPreferences()
      actions.clearAuthStateCache()
      await actions.loadMe()
      await actions.loadBilling()
      actions.setStatus("AI 配置已保存", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.aiTestBtn.addEventListener("click", async () => {
    try {
      const result = await api("/api/account/preferences/ai/test", { method: "POST" })
      const speedInfo = result.durationMs ? ` 耗时: ${(result.durationMs / 1000).toFixed(2)}秒` : ""
      const sourceInfo = formatAiRuntimeSource(result)
      actions.setStatus(`AI 测试成功${sourceInfo ? `（命中：${sourceInfo}）` : ""}${speedInfo}: ${result.output}`, "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.digestForm?.addEventListener("submit", async (event) => {
    event.preventDefault()
    const id = els.digestId.value
    const selectedFeedIds = Array.from(els.digestFeedIds?.selectedOptions || []).map((option) => Number(option.value))
    try {
      const payload = {
        name: els.digestName.value,
        isEnabled: els.digestEnabled.checked,
        sendTime: els.digestSendTime.value || "09:00",
        timezone: "Asia/Shanghai",
        recipientEmails: els.digestEmails.value.split(/[,;\n]/).map((entry) => entry.trim()).filter(Boolean),
        aiSource: els.digestAiSource.value,
        prompt: els.digestPrompt.value,
        lookbackHours: Number(els.digestLookbackHours?.value || 24),
        unreadOnly: Boolean(els.digestUnreadOnly?.checked),
        feedScope: els.digestFeedScope.value,
        feedIds: selectedFeedIds,
        category: els.digestCategory.value
      }
      await api(id ? `/api/account/digest-rules/${id}` : "/api/account/digest-rules", {
        method: "POST",
        body: JSON.stringify(payload)
      })
      await actions.loadDigest()
      actions.clearAuthStateCache()
      await actions.loadMe()
      actions.setStatus("简报规则已保存", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.digestNewBtn?.addEventListener("click", () => {
    actions.resetDigestForm()
  })

  els.digestFeedScope?.addEventListener("change", () => {
    renderers.syncDigestScopeFields()
  })

  els.translationForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    const selectedProvider = actions.getSelectedTranslationProvider()
    try {
      await api("/api/account/preferences/translation", {
        method: "POST",
        body: JSON.stringify({
          provider: els.translationProvider.value,
          targetLanguage: els.translationTarget.value,
          translationMode: els.translationMode.value,
          autoTranslate: els.translationAuto.checked,
          displayTranslated: els.translationDisplay.checked
        })
      })

      if (selectedProvider === "google") {
        await api("/api/account/preferences/translation-provider/google", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: els.translationGoogleBaseUrl?.value || "",
            apiKey: els.translationGoogleApiKey.value
          })
        })
      } else if (selectedProvider === "bing") {
        await api("/api/account/preferences/translation-provider/bing", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: els.translationBingBaseUrl.value,
            apiKey: els.translationBingApiKey.value,
            region: els.translationBingRegion.value
          })
        })
      } else if (selectedProvider === "deeplx") {
        await api("/api/account/preferences/translation-provider/deeplx", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: els.translationDeepLxBaseUrl.value,
            apiKey: els.translationDeepLxApiKey.value
          })
        })
      }

      await actions.loadPreferences()
      actions.clearAuthStateCache()
      await actions.loadMe()
      actions.setStatus("翻译设置已保存", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.translationProvider.addEventListener("change", () => {
    if (!supportsAutoTranslate(els.translationProvider.value)) {
      els.translationAuto.checked = false
    }
    renderers.renderTranslationFormState()
    renderers.renderTranslationCredentialState()
  })

  els.translationTarget.addEventListener("change", () => {
    renderers.renderTranslationFormState()
  })

  els.translationMode?.addEventListener("change", () => {
    renderers.renderTranslationFormState()
  })

  els.translationResetBtn.addEventListener("click", async () => {
    const selectedProvider = actions.getSelectedTranslationProvider()
    try {
      if (selectedProvider === "google") {
        await api("/api/account/preferences/translation-provider/google/reset", { method: "POST" })
        actions.setStatus("Google 已恢复免 Key / 系统默认", "success")
      } else if (selectedProvider === "bing") {
        await api("/api/account/preferences/translation-provider/bing/reset", { method: "POST" })
        actions.setStatus("必应翻译已恢复系统默认", "success")
      } else if (selectedProvider === "deeplx") {
        await api("/api/account/preferences/translation-provider/deeplx/reset", { method: "POST" })
        actions.setStatus("DeepLX 已恢复系统默认", "success")
      }
      await actions.loadPreferences()
      actions.clearAuthStateCache()
      await actions.loadMe()
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.securityForm.addEventListener("submit", async (event) => {
    event.preventDefault()

    if (!state.me?.user) {
      actions.setStatus("请先登录", "warning")
      return
    }

    if (els.newPassword.value !== els.confirmPassword.value) {
      actions.setStatus("两次输入的新密码不一致", "warning")
      return
    }

    try {
      const result = await api("/api/account/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: els.currentPassword.value,
          newPassword: els.newPassword.value,
          revokeOtherSessions: true
        })
      })
      els.currentPassword.value = ""
      els.newPassword.value = ""
      els.confirmPassword.value = ""
      state.security = { sessions: result.sessions || [] }
      renderers.renderSecurityState()
      actions.setStatus(result.revokedCount > 0 ? `密码已更新，并退出了 ${result.revokedCount} 个其他会话` : "密码已更新", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.backupForm?.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (!state.me?.user) {
      actions.setStatus("请先登录", "warning")
      return
    }
    const email = els.backupEmail?.value?.trim()
    if (!email) {
      actions.setStatus("请填写接收邮箱", "warning")
      return
    }
    try {
      actions.setStatus("正在发送备份邮件...", "info")
      const result = await api("/api/account/backup-opml", {
        method: "POST",
        body: JSON.stringify({ email })
      })
      actions.setStatus(`备份已发送到 ${result.email}，共 ${result.feedCount} 个订阅源`, "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.backupScheduleForm?.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (!state.me?.user) {
      actions.setStatus("请先登录", "warning")
      return
    }
    try {
      await api("/api/account/backup-opml/config", {
        method: "POST",
        body: JSON.stringify({
          email: els.backupScheduleEmail?.value?.trim() || "",
          sendTime: els.backupScheduleTime?.value || "09:00",
          enabled: els.backupScheduleEnabled?.checked || false
        })
      })
      await actions.loadBackupConfig()
      actions.setStatus("定时备份配置已保存", "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  els.backupScheduleTestBtn?.addEventListener("click", async () => {
    if (!state.me?.user) {
      actions.setStatus("请先登录", "warning")
      return
    }
    try {
      actions.setStatus("正在发送测试备份...", "info")
      const result = await api("/api/account/backup-opml", {
        method: "POST",
        body: JSON.stringify({ email: els.backupScheduleEmail?.value?.trim() || els.backupEmail?.value?.trim() })
      })
      actions.setStatus(`测试备份已发送到 ${result.email}，共 ${result.feedCount} 个订阅源`, "success")
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })
}
