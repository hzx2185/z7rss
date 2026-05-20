export function createReaderFeedController(deps) {
  const {
    els,
    state,
    readerApi,
    applySavedReaderPreferences,
    closeFeedSettingsModal,
    getFeedById,
    getTodayStartIso,
    loadItems,
    normalizeFeedIds,
    openItem,
    parseBooleanSelect,
    parseNullableBooleanSelect,
    pruneSelectedFeedIds,
    renderAccount,
    renderArticle,
    renderComposeState,
    renderFeedFilter,
    renderFilterMode,
    renderFeeds,
    renderItems,
    renderOperationSummary,
    renderScopeButtons,
    resetImportComposer,
    resetLoadedItems,
    resetScopeCounts,
    setStatus
  } = deps

  async function loadMe() {
    const result = await readerApi.getMe()
    state.me = result.authenticated ? result : null
    if (state.me?.preferences?.reader) {
      applySavedReaderPreferences(state.me.preferences.reader)
      renderFeedFilter()
      renderFilterMode()
      renderScopeButtons()
    }
    renderAccount()
  }

  async function loadScopeCounts(options = {}) {
    if (!state.me?.user) {
      resetScopeCounts()
      renderScopeButtons()
      return
    }

    try {
      const result = await readerApi.getItemCounts(getTodayStartIso(), Boolean(options.force))
      state.scopeCounts = {
        all: Number(result?.all || 0),
        today: Number(result?.today || 0),
        favorite: Number(result?.favorite || 0),
        unread: Number(result?.unread || 0)
      }
      renderScopeButtons()
    } catch (_error) {
      resetScopeCounts()
      renderScopeButtons()
    }
  }

  async function loadFeeds(options = {}) {
    if (!state.me?.user) {
      state.feeds = []
      resetLoadedItems()
      resetScopeCounts()
      state.selectedFeedId = null
      state.selectedItem = null
      state.detailView = null
      state.feedBulkMode = false
      state.selectedFeedIds = []
      renderFeeds()
      renderItems()
      renderArticle()
      return
    }

    state.feeds = await readerApi.listFeeds(Boolean(options.force), {
      skipImmediateTranslations: Boolean(options.skipImmediateTranslations)
    })
    if (
      state.feedSettingsFeedId &&
      !state.feeds.some((feed) => Number(feed.feed_id) === Number(state.feedSettingsFeedId))
    ) {
      closeFeedSettingsModal()
    }
    if (
      state.selectedFeedId &&
      !state.feeds.some((feed) => Number(feed.feed_id) === Number(state.selectedFeedId))
    ) {
      state.selectedFeedId = null
    }
    pruneSelectedFeedIds()
    renderFeeds()
    const countsRequest = loadScopeCounts(options)
    if (options.awaitCounts) {
      await countsRequest
    }
  }

  async function refreshFeed(feedId) {
    const normalizedFeedId = Number(feedId || 0)
    if (!normalizedFeedId) {
      await refreshAllFeeds()
      return
    }
    try {
      if (!state.me?.user) {
        setStatus("请先登录", "warning")
        return
      }
      setStatus("正在刷新当前订阅源...")
      const result = await readerApi.refreshFeed(normalizedFeedId)
      state.lastOperation = { type: "refreshFeed", result }
      renderOperationSummary()
      await loadFeeds({ force: true, skipImmediateTranslations: true })
      if (state.selectedFeedId === null || Number(state.selectedFeedId) === normalizedFeedId) {
        state.itemPage = 1
        await loadItems(state.selectedFeedId, {
          force: true,
          targetPage: 1,
          preserveSelection: true
        })
      }
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  async function saveFeedSettings() {
    const feedId = Number(state.feedSettingsFeedId)
    if (!feedId) {
      setStatus("未找到要保存的订阅源", "warning")
      return
    }
    const currentFeed = getFeedById(feedId)

    try {
      await readerApi.updateFeedPreferences(feedId, {
        customTitle: els.feedSettingsTitleInput.value.trim(),
        category: els.feedSettingsCategoryInput.value.trim() || null,
        isArchived: parseBooleanSelect(els.feedSettingsArchived.value),
        isCollapsed: parseBooleanSelect(els.feedSettingsCollapsed.value),
        isPublic: parseBooleanSelect(els.feedSettingsPublic.value),
        targetLanguage: els.feedSettingsTarget.value || null,
        autoTranslate: parseNullableBooleanSelect(els.feedSettingsAuto.value),
        displayTranslated: parseNullableBooleanSelect(els.feedSettingsDisplay.value),
        translationMode: els.feedSettingsMode.value || null,
        fetchRequestProfile: els.feedSettingsFetchProfile.value || "auto",
        fetchFeedFormat: els.feedSettingsFetchFormat.value || "auto",
        fetchTimeoutMs: els.feedSettingsFetchTimeout.value.trim() ? Number.parseInt(els.feedSettingsFetchTimeout.value, 10) : null,
        fetchFeedUrl: els.feedSettingsFetchFeedUrl.value.trim() || null,
        fetchLoginUrl: els.feedSettingsFetchLoginUrl.value.trim() || null,
        fetchUsername: els.feedSettingsFetchUsername.value.trim() || null,
        ...(els.feedSettingsFetchPassword.value
          ? { fetchPassword: els.feedSettingsFetchPassword.value }
          : els.feedSettingsFetchPassword.dataset.clear === "1" || !currentFeed?.fetch_password_configured
            ? { fetchPassword: "" }
            : {}),
        fetchUsernameField: els.feedSettingsFetchUsernameField.value.trim() || "username",
        fetchPasswordField: els.feedSettingsFetchPasswordField.value.trim() || "password",
        ...(els.feedSettingsFetchCookie.value.trim()
          ? { fetchCookie: els.feedSettingsFetchCookie.value.trim() }
          : els.feedSettingsFetchCookie.dataset.clear === "1" || !currentFeed?.fetch_cookie_configured
            ? { fetchCookie: "" }
            : {}),
        fetchArticleSelector: els.feedSettingsFetchArticleSelector.value.trim() || null,
        fetchPageSelector: els.feedSettingsFetchPageSelector.value.trim() || null,
        fetchHtmlStart: els.feedSettingsFetchHtmlStart.value.trim() || null,
        fetchHtmlEnd: els.feedSettingsFetchHtmlEnd.value.trim() || null,
        fetchJsonItemsPath: els.feedSettingsFetchJsonItemsPath.value.trim() || null,
        fetchJsonTitlePath: els.feedSettingsFetchJsonTitlePath.value.trim() || null,
        fetchJsonLinkPath: els.feedSettingsFetchJsonLinkPath.value.trim() || null,
        fetchJsonDatePath: els.feedSettingsFetchJsonDatePath.value.trim() || null,
        fetchJsonSummaryPath: els.feedSettingsFetchJsonSummaryPath.value.trim() || null,
        fetchJsonContentPath: els.feedSettingsFetchJsonContentPath.value.trim() || null
      })

      const selectedItemId = state.selectedItem?.id || null
      const selectedItemFeedId = Number(state.selectedItem?.feed_id || 0)

      await loadFeeds({})
      await loadItems(state.selectedFeedId)

      if (selectedItemId && selectedItemFeedId === feedId) {
        await openItem(selectedItemId)
      }

      closeFeedSettingsModal()
      setStatus("订阅源设置已更新", "success")
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  async function deleteFeed(feedId) {
    try {
      const feed = getFeedById(feedId)
      if (!window.confirm(`确认删除订阅“${feed?.title || `#${feedId}`}”吗？`)) {
        return
      }
      await readerApi.deleteFeed(feedId)
      if (Number(state.selectedFeedId) === Number(feedId)) {
        state.selectedFeedId = null
        state.selectedItem = null
        state.expandedItemId = null
        state.itemPage = 1
      }
      await loadFeeds({})
      await loadItems(state.selectedFeedId)
      setStatus("订阅已删除", "success")
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  async function addFeed() {
    const isPublic = els.feedPublic?.checked ?? true
    const result = await readerApi.addFeed(els.feedUrl.value.trim(), { isPublic })
    state.lastOperation = { type: "addFeed", result }
    renderOperationSummary()
    els.feedUrl.value = ""
    state.composeOpen = false
    renderComposeState()
    if (result.feed?.feed_id) {
      state.selectedFeedId = result.feed.feed_id
    }
    await loadFeeds({})
    await loadItems(state.selectedFeedId)
  }

  async function importFeeds() {
    const result = await readerApi.importFeeds(els.importContent.value.trim())
    state.lastOperation = { type: "import", result }
    renderOperationSummary()
    resetImportComposer()
    await loadFeeds({})
    await loadItems(state.selectedFeedId)
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  async function waitForRefreshAllJob(job) {
    let currentJob = job
    while (currentJob?.status === "running") {
      state.lastOperation = { type: "refreshAll", result: currentJob }
      renderOperationSummary()
      await wait(1500)
      currentJob = await readerApi.getRefreshAllJob(currentJob.jobId)
    }
    return currentJob
  }

  async function refreshAllFeeds() {
    try {
      if (!state.me?.user) {
        setStatus("请先登录", "warning")
        return
      }
      setStatus("正在刷新全部订阅源...")
      const startedJob = await readerApi.refreshAllFeeds()
      state.lastOperation = { type: "refreshAll", result: startedJob }
      renderOperationSummary()
      const result = startedJob?.jobId ? await waitForRefreshAllJob(startedJob) : startedJob
      state.lastOperation = { type: "refreshAll", result }
      renderOperationSummary()
      await loadFeeds({ force: true, skipImmediateTranslations: true })
      state.itemPage = 1
      await loadItems(state.selectedFeedId, {
        force: true,
        targetPage: 1,
        preserveSelection: true
      })
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  async function refreshCurrentView() {
    if (state.selectedFeedId) {
      await refreshFeed(state.selectedFeedId)
      return
    }
    await refreshAllFeeds()
  }

  async function refreshSelectedFeeds() {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    const feedIds = normalizeFeedIds(state.selectedFeedIds)
    if (!feedIds.length) {
      setStatus("请先勾选订阅源", "warning")
      return
    }

    let successCount = 0
    let failedCount = 0
    setStatus(`正在刷新 ${feedIds.length} 个订阅...`)

    for (const feedId of feedIds) {
      try {
        await readerApi.refreshFeed(feedId)
        successCount += 1
      } catch (_error) {
        failedCount += 1
      }
    }

    await loadFeeds({})
    state.itemPage = 1
    await loadItems(state.selectedFeedId, {
      force: true,
      targetPage: 1,
      preserveSelection: true
    })
    setStatus(`批量刷新完成 · 成功 ${successCount} · 失败 ${failedCount}`, failedCount ? "warning" : "success")
  }

  async function shareSelectedFeeds() {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    const feedIds = normalizeFeedIds(state.selectedFeedIds)
    if (!feedIds.length) {
      setStatus("请先勾选订阅源", "warning")
      return
    }

    const publicFeedIds = feedIds.filter((feedId) => {
      const feed = getFeedById(feedId)
      return Boolean(feed?.is_public)
    })
    const shouldUnshare = publicFeedIds.length === feedIds.length
    const pendingFeedIds = shouldUnshare
      ? publicFeedIds
      : feedIds.filter((feedId) => {
          const feed = getFeedById(feedId)
          return feed && !feed.is_public
        })

    if (!pendingFeedIds.length) {
      setStatus("选中的订阅没有可更新的分享状态", "warning")
      return
    }

    let updatedCount = 0
    let failedCount = 0
    setStatus(`${shouldUnshare ? "正在取消分享" : "正在公开分享"} ${pendingFeedIds.length} 个订阅...`)

    for (const feedId of pendingFeedIds) {
      try {
        await readerApi.updateFeedPreferences(feedId, { isPublic: !shouldUnshare })
        updatedCount += 1
      } catch (_error) {
        failedCount += 1
      }
    }

    await loadFeeds({})
    setStatus(
      `${shouldUnshare ? "批量取消分享完成" : "批量分享完成"} · 成功 ${updatedCount} · 失败 ${failedCount}`,
      failedCount ? "warning" : "success"
    )
  }

  async function deleteSelectedFeeds() {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    const feedIds = normalizeFeedIds(state.selectedFeedIds)
    if (!feedIds.length) {
      setStatus("请先勾选订阅源", "warning")
      return
    }

    const feedNames = feedIds
      .map((feedId) => getFeedById(feedId)?.title || `#${feedId}`)
      .slice(0, 3)
      .join("、")
    const confirmLabel = feedIds.length > 3 ? `${feedNames} 等 ${feedIds.length} 个订阅` : feedNames
    if (!window.confirm(`确认删除 ${confirmLabel} 吗？`)) {
      return
    }

    let deletedCount = 0
    let failedCount = 0
    for (const feedId of feedIds) {
      try {
        await readerApi.deleteFeed(feedId)
        deletedCount += 1
      } catch (_error) {
        failedCount += 1
      }
    }

    if (feedIds.includes(Number(state.selectedFeedId))) {
      state.selectedFeedId = null
      state.selectedItem = null
      state.expandedItemId = null
      state.itemPage = 1
    }
    state.selectedFeedIds = []
    await loadFeeds({})
    await loadItems(state.selectedFeedId)
    setStatus(`批量删除完成 · 删除 ${deletedCount} · 失败 ${failedCount}`, failedCount ? "warning" : "success")
  }

  return {
    addFeed,
    deleteFeed,
    deleteSelectedFeeds,
    importFeeds,
    loadFeeds,
    loadMe,
    loadScopeCounts,
    refreshAllFeeds,
    refreshCurrentView,
    refreshFeed,
    refreshSelectedFeeds,
    shareSelectedFeeds,
    saveFeedSettings
  }
}
