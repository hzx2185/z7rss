export function createReaderFeedActions({
  state,
  readerApi,
  closeFeedDrawer,
  getFeedNavigationTargets,
  getTodayStartIso,
  loadItems,
  normalizeFeedIds,
  openFeedSettingsModal,
  prefetchItemsPage,
  renderFeedBulkState,
  renderFeeds,
  renderFilterMode,
  renderComposeState,
  resetLoadedItems,
  selectFeed,
  setStatus
}) {
  async function navigateFeed(step = 1) {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    const { previous, next } = getFeedNavigationTargets()
    const target = step < 0 ? previous : next
    if (!target?.feed_id) {
      setStatus("没有可切换的订阅源", "warning")
      return
    }

    closeFeedDrawer()
    setStatus(`正在切换到 ${target.title}...`)
    await selectFeed(Number(target.feed_id), { smooth: true, skipImmediateTranslations: true })
    prefetchNavigationTargets()
    setStatus(
      state.itemFilter === "unread"
        ? `已切换到有未读文章的订阅源：${target.title}`
        : `已切换到 ${target.title}`,
      "success"
    )
  }

  function prefetchNavigationTargets() {
    if (!state.me?.user) return
    const { previous, next } = getFeedNavigationTargets()
    const feedIds = [...new Set([previous?.feed_id, next?.feed_id].map((value) => Number(value || 0)).filter(Boolean))]
    feedIds.forEach((feedId) => {
      const run = () => void prefetchItemsPage?.(feedId, 1, { skipImmediateTranslations: true })
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(run, { timeout: 1200 })
      } else {
        window.setTimeout(run, 180)
      }
    })
  }

  async function renameFeed(feedId) {
    openFeedSettingsModal(feedId)
  }

  async function selectQuickScope(scope) {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    state.selectedFeedId = null
    state.selectedItem = null
    state.expandedItemId = null
    state.detailView = null
    resetLoadedItems()
    state.feedBulkMode = false
    state.selectedFeedIds = []

    if (scope === "today") {
      state.itemFilter = "all"
      state.publishedSince = getTodayStartIso()
    } else if (scope === "favorite") {
      state.itemFilter = "favorite"
      state.publishedSince = null
    } else if (scope === "unread") {
      state.itemFilter = "unread"
      state.publishedSince = null
    } else {
      state.itemFilter = "all"
      state.publishedSince = null
    }

    renderFilterMode()
    renderFeeds()
    await loadItems(null, { skipImmediateTranslations: true })
  }

  function toggleFeedBulkMode() {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    state.feedBulkMode = !state.feedBulkMode
    if (state.feedBulkMode) {
      state.composeOpen = false
    }
    if (!state.feedBulkMode) {
      state.selectedFeedIds = []
    }
    renderFeedBulkState()
    renderComposeState()
    renderFeeds()
  }

  async function renameSelectedFeeds() {
    const feedIds = normalizeFeedIds(state.selectedFeedIds)
    if (feedIds.length !== 1) {
      setStatus("修改时请只选择 1 个订阅源", "warning")
      return
    }
    await renameFeed(feedIds[0])
  }

  function exportFeeds(format) {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }
    window.location.href = readerApi.buildExportUrl(format)
    setStatus(`正在导出 ${format.toUpperCase()} 文件...`)
  }

  return {
    exportFeeds,
    navigateFeed,
    prefetchNavigationTargets,
    renameSelectedFeeds,
    selectQuickScope,
    toggleFeedBulkMode
  }
}
