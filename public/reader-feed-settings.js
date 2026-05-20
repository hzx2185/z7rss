export function createReaderFeedSettings({ els, getFeedById, setStatus, state }) {
  function parseNullableBooleanSelect(value) {
    if (value === "") return null
    return value === "1"
  }

  function parseBooleanSelect(value, fallback = false) {
    if (value === "") return Boolean(fallback)
    return value === "1"
  }

  function resetForm() {
    els.feedSettingsForm?.reset()
    els.feedSettingsTitleInput.value = ""
    els.feedSettingsCategoryInput.value = ""
    if (els.feedSettingsCategorySuggested) {
      els.feedSettingsCategorySuggested.textContent = "未分类"
    }
    els.feedSettingsArchived.value = "0"
    els.feedSettingsCollapsed.value = "0"
    els.feedSettingsPublic.value = "0"
    els.feedSettingsTarget.value = ""
    els.feedSettingsAuto.value = ""
    els.feedSettingsDisplay.value = ""
    els.feedSettingsMode.value = ""
    els.feedSettingsFetchProfile.value = "auto"
    els.feedSettingsFetchFormat.value = "auto"
    els.feedSettingsFetchTimeout.value = ""
    els.feedSettingsFetchFeedUrl.value = ""
    els.feedSettingsFetchLoginUrl.value = ""
    els.feedSettingsFetchUsername.value = ""
    els.feedSettingsFetchPassword.value = ""
    els.feedSettingsFetchPassword.dataset.clear = "0"
    els.feedSettingsFetchPassword.placeholder = ""
    els.feedSettingsFetchUsernameField.value = "username"
    els.feedSettingsFetchPasswordField.value = "password"
    els.feedSettingsFetchCookie.value = ""
    els.feedSettingsFetchCookie.dataset.clear = "0"
    els.feedSettingsFetchCookie.placeholder = ""
    els.feedSettingsFetchArticleSelector.value = ""
    els.feedSettingsFetchPageSelector.value = ""
    els.feedSettingsFetchHtmlStart.value = ""
    els.feedSettingsFetchHtmlEnd.value = ""
    els.feedSettingsFetchJsonItemsPath.value = ""
    els.feedSettingsFetchJsonTitlePath.value = ""
    els.feedSettingsFetchJsonLinkPath.value = ""
    els.feedSettingsFetchJsonDatePath.value = ""
    els.feedSettingsFetchJsonSummaryPath.value = ""
    els.feedSettingsFetchJsonContentPath.value = ""
  }

  function closeModal() {
    if (!els.feedSettingsModal) return
    els.feedSettingsModal.classList.add("hidden")
    els.feedSettingsModal.setAttribute("aria-hidden", "true")
    document.body.classList.remove("reader-modal-open")
    state.feedSettingsFeedId = null
  }

  function openModal(feedId) {
    const feed = getFeedById(feedId)
    if (!feed || !els.feedSettingsModal) {
      setStatus("未找到要修改的订阅源", "warning")
      return
    }

    if (document.body.classList.contains("reader-feed-drawer-open")) {
      document.body.classList.remove("reader-feed-drawer-open")
      state.feedDrawerOpen = false
    }

    state.feedSettingsFeedId = Number(feed.feed_id)
    resetForm()
    els.feedSettingsTitleInput.value = feed.custom_title || ""
    els.feedSettingsCategoryInput.value = feed.category_manual || ""
    if (els.feedSettingsCategorySuggested) {
      els.feedSettingsCategorySuggested.textContent = feed.category_suggested || feed.category || "未分类"
    }
    els.feedSettingsArchived.value = feed.is_archived ? "1" : "0"
    els.feedSettingsCollapsed.value = feed.is_collapsed ? "1" : "0"
    els.feedSettingsPublic.value = feed.is_public ? "1" : "0"
    els.feedSettingsTarget.value = feed.translation_target_language || ""
    els.feedSettingsAuto.value =
      feed.auto_translate === null || feed.auto_translate === undefined ? "" : String(Number(feed.auto_translate))
    els.feedSettingsDisplay.value =
      feed.display_translated === null || feed.display_translated === undefined
        ? ""
        : String(Number(feed.display_translated))
    els.feedSettingsMode.value = feed.translation_mode || ""
    els.feedSettingsFetchProfile.value = feed.fetch_request_profile || "auto"
    els.feedSettingsFetchFormat.value = feed.fetch_feed_format || "auto"
    els.feedSettingsFetchTimeout.value = feed.fetch_timeout_ms ? String(feed.fetch_timeout_ms) : ""
    els.feedSettingsFetchFeedUrl.value = feed.fetch_feed_url || ""
    els.feedSettingsFetchLoginUrl.value = feed.fetch_login_url || ""
    els.feedSettingsFetchUsername.value = feed.fetch_username || ""
    els.feedSettingsFetchPassword.value = ""
    els.feedSettingsFetchPassword.dataset.clear = "0"
    els.feedSettingsFetchPassword.placeholder = feed.fetch_password_configured ? "已配置，留空保持不变" : "留空不使用"
    els.feedSettingsFetchUsernameField.value = feed.fetch_username_field || "username"
    els.feedSettingsFetchPasswordField.value = feed.fetch_password_field || "password"
    els.feedSettingsFetchCookie.value = ""
    els.feedSettingsFetchCookie.dataset.clear = "0"
    els.feedSettingsFetchCookie.placeholder = feed.fetch_cookie_configured ? "已配置，留空保持不变" : "name=value; session=..."
    els.feedSettingsFetchArticleSelector.value = feed.fetch_article_selector || ""
    els.feedSettingsFetchPageSelector.value = feed.fetch_page_selector || ""
    els.feedSettingsFetchHtmlStart.value = feed.fetch_html_start || ""
    els.feedSettingsFetchHtmlEnd.value = feed.fetch_html_end || ""
    els.feedSettingsFetchJsonItemsPath.value = feed.fetch_json_items_path || ""
    els.feedSettingsFetchJsonTitlePath.value = feed.fetch_json_title_path || ""
    els.feedSettingsFetchJsonLinkPath.value = feed.fetch_json_link_path || ""
    els.feedSettingsFetchJsonDatePath.value = feed.fetch_json_date_path || ""
    els.feedSettingsFetchJsonSummaryPath.value = feed.fetch_json_summary_path || ""
    els.feedSettingsFetchJsonContentPath.value = feed.fetch_json_content_path || ""
    els.feedSettingsSubtitle.textContent = `${feed.title || feed.url} · ${feed.url}`
    els.feedSettingsModal.classList.remove("hidden")
    els.feedSettingsModal.setAttribute("aria-hidden", "false")
    document.body.classList.add("reader-modal-open")
    window.setTimeout(() => {
      els.feedSettingsTitleInput.focus()
    }, 0)
  }

  return {
    closeModal,
    openModal,
    parseBooleanSelect,
    parseNullableBooleanSelect,
    resetForm
  }
}
