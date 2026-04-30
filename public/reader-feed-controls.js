export function createReaderFeedControls({
  els,
  escapeAttribute,
  escapeHtml,
  feedCategoryFilterKey,
  getAvailableFeedCategories,
  getCurrentFeed,
  getDisplayFeedTitle,
  getFeedById,
  getFilteredFeeds,
  glyphs,
  isFeedNormal,
  normalizeFeedIds,
  pruneSelectedFeedIds,
  refreshRenderedFeedRows,
  renderFeeds,
  setGlyphButton,
  shouldUseFeedDrawer,
  state
}) {
  function setTextWhenChanged(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text
    }
  }

  function setValueWhenChanged(element, value) {
    if (element && element.value !== value) {
      element.value = value
    }
  }

  function setAttributeWhenChanged(element, name, value) {
    if (element && element.getAttribute(name) !== value) {
      element.setAttribute(name, value)
    }
  }

  function setDisabledWhenChanged(element, disabled) {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled
    }
  }

  function getCurrentScopeLabel() {
    if (state.selectedFeedId) {
      return getCurrentFeed()?.title || "当前订阅"
    }
    if (state.publishedSince) return "今日文章"
    if (state.itemFilter === "favorite") return "收藏文章"
    if (state.itemFilter === "unread") return "未读文章"
    if (state.itemFilter === "read") return "已读文章"
    return "全部文章"
  }

  function renderScopeButtons() {
    const isAllScope = state.selectedFeedId === null && state.itemFilter === "all" && !state.publishedSince
    const isTodayScope = state.selectedFeedId === null && state.itemFilter === "all" && Boolean(state.publishedSince)
    const isFavoriteScope = state.selectedFeedId === null && state.itemFilter === "favorite" && !state.publishedSince
    const isUnreadScope = state.selectedFeedId === null && state.itemFilter === "unread" && !state.publishedSince

    els.openAllBtn?.classList.toggle("active", isAllScope)
    els.openTodayBtn?.classList.toggle("active", isTodayScope)
    els.openFavoriteBtn?.classList.toggle("active", isFavoriteScope)
    els.openUnreadBtn?.classList.toggle("active", isUnreadScope)

    setTextWhenChanged(els.openAllCount, String(state.scopeCounts.all || 0))
    setTextWhenChanged(els.openTodayCount, String(state.scopeCounts.today || 0))
    setTextWhenChanged(els.openFavoriteCount, String(state.scopeCounts.favorite || 0))
    setTextWhenChanged(els.openUnreadCount, String(state.scopeCounts.unread || 0))
  }

  function renderFeedDrawer() {
    const enabled = shouldUseFeedDrawer()
    if (!enabled) {
      state.feedDrawerOpen = false
    }

    document.body.classList.toggle("reader-feed-drawer-open", enabled && state.feedDrawerOpen)
    if (els.feedDrawerBtn) {
      setTextWhenChanged(els.feedDrawerBtn, "源")
      setAttributeWhenChanged(els.feedDrawerBtn, "aria-expanded", enabled && state.feedDrawerOpen ? "true" : "false")
      const label = `切换订阅源（当前：${getCurrentScopeLabel()}）`
      if (els.feedDrawerBtn.title !== label) els.feedDrawerBtn.title = label
      setAttributeWhenChanged(els.feedDrawerBtn, "aria-label", label)
    }
    if (els.feedDrawer) {
      setAttributeWhenChanged(els.feedDrawer, "aria-hidden", enabled && !state.feedDrawerOpen ? "true" : "false")
    }
    if (els.feedDrawerBackdrop) {
      setAttributeWhenChanged(els.feedDrawerBackdrop, "aria-hidden", enabled && state.feedDrawerOpen ? "false" : "true")
    }
  }

  function closeFeedDrawer() {
    if (!state.feedDrawerOpen) {
      renderFeedDrawer()
      return
    }
    state.feedDrawerOpen = false
    renderFeedDrawer()
  }

  function toggleFeedDrawer() {
    if (!shouldUseFeedDrawer()) {
      els.feedDrawer?.scrollIntoView?.({ block: "nearest", inline: "start", behavior: "smooth" })
      els.feedSearchInput?.focus?.({ preventScroll: true })
      return
    }
    state.feedDrawerOpen = !state.feedDrawerOpen
    renderFeedDrawer()
  }

  function renderFeedBulkState() {
    pruneSelectedFeedIds()

    const visibleFeedIds = getFilteredFeeds().map((feed) => Number(feed.feed_id))
    const selectedFeedIdSet = new Set(state.selectedFeedIds.map((feedId) => Number(feedId)))
    const selectedCount = state.selectedFeedIds.length
    const publicCount = state.selectedFeedIds.filter((feedId) => {
      const feed = getFeedById(feedId)
      return Boolean(feed?.is_public)
    }).length
    const shareableCount = state.selectedFeedIds.filter((feedId) => {
      const feed = getFeedById(feedId)
      return feed && !feed.is_public
    }).length
    const selectedVisibleCount = visibleFeedIds.filter((feedId) => selectedFeedIdSet.has(feedId)).length
    const allVisibleSelected =
      Boolean(visibleFeedIds.length) && visibleFeedIds.every((feedId) => selectedFeedIdSet.has(feedId))
    const shareMode = selectedCount > 0 && publicCount === selectedCount ? "unshare" : "share"

    els.feedBulkBar.classList.toggle("hidden", !state.feedBulkMode)
    els.feedBulkToggleBtn.classList.toggle("active", state.feedBulkMode)
    setTextWhenChanged(els.feedBulkToggleBtn, glyphs.drawer)
    els.feedBulkToggleBtn.title = state.feedBulkMode ? "收起批量管理" : "批量管理"
    setAttributeWhenChanged(els.feedBulkToggleBtn, "aria-label", state.feedBulkMode ? "收起批量管理" : "批量管理")
    setAttributeWhenChanged(els.feedBulkToggleBtn, "aria-expanded", state.feedBulkMode ? "true" : "false")

    const disabled = !state.me?.user
    if (els.feedBulkSelectAllBtn) {
      const selectAllLabel = allVisibleSelected ? "取消全选当前筛选结果" : "全选当前筛选结果"
      const selectAllGlyph = allVisibleSelected ? "☑" : selectedVisibleCount > 0 ? "◪" : "□"
      setGlyphButton(els.feedBulkSelectAllBtn, selectAllGlyph, selectAllLabel)
      setDisabledWhenChanged(els.feedBulkSelectAllBtn, disabled || visibleFeedIds.length === 0)
      els.feedBulkSelectAllBtn.classList.toggle("active", selectedVisibleCount > 0)
    }
    if (els.feedBulkShareBtn) {
      const shareLabel =
        shareMode === "unshare"
          ? "取消公开分享"
          : publicCount > 0
            ? "公开未分享订阅"
            : "公开分享"
      setGlyphButton(
        els.feedBulkShareBtn,
        shareMode === "unshare" ? glyphs.sharePrivate : glyphs.sharePublic,
        shareLabel
      )
    }
    setDisabledWhenChanged(els.feedBulkRefreshBtn, disabled || selectedCount === 0)
    setDisabledWhenChanged(els.feedBulkEditBtn, disabled || selectedCount !== 1)
    setDisabledWhenChanged(els.feedBulkShareBtn, disabled || selectedCount === 0 || (shareMode === "share" && shareableCount === 0))
    setDisabledWhenChanged(els.feedBulkDeleteBtn, disabled || selectedCount === 0)
  }

  function setFeedSelection(feedId, shouldSelect = null) {
    const normalizedId = Number(feedId)
    if (!Number.isInteger(normalizedId) || normalizedId < 1) return

    const selectedIds = new Set(state.selectedFeedIds)
    const nextSelected = typeof shouldSelect === "boolean" ? shouldSelect : !selectedIds.has(normalizedId)
    if (nextSelected) {
      selectedIds.add(normalizedId)
    } else {
      selectedIds.delete(normalizedId)
    }

    state.selectedFeedIds = Array.from(selectedIds)
    renderFeedBulkState()
    refreshRenderedFeedRows?.([normalizedId])
  }

  function toggleAllVisibleFeeds(shouldSelect = null) {
    const visibleFeedIds = getFilteredFeeds()
      .slice(0, Number(state.feedRenderLimit || 0) || undefined)
      .map((feed) => Number(feed.feed_id))
    if (!visibleFeedIds.length) return

    const selectedFeedIdSet = new Set(state.selectedFeedIds.map((feedId) => Number(feedId)))
    const allVisibleSelected = visibleFeedIds.every((feedId) => selectedFeedIdSet.has(feedId))
    const nextSelected = typeof shouldSelect === "boolean" ? shouldSelect : !allVisibleSelected
    if (!nextSelected) {
      const visibleFeedIdSet = new Set(visibleFeedIds)
      state.selectedFeedIds = state.selectedFeedIds.filter((feedId) => !visibleFeedIdSet.has(Number(feedId)))
    } else {
      state.selectedFeedIds = normalizeFeedIds([...state.selectedFeedIds, ...visibleFeedIds])
    }

    renderFeedBulkState()
    refreshRenderedFeedRows?.(visibleFeedIds)
  }

  function renderComposeState() {
    els.feedCompose.classList.toggle("hidden", !state.composeOpen)
    els.composeToggleBtn.classList.toggle("active", state.composeOpen)
  }

  function resetImportComposer() {
    if (els.importContent) {
      els.importContent.value = ""
    }
    state.composeOpen = false
    renderComposeState()
  }

  function renderFeedCategoryOptions() {
    if (!els.feedCategoryFilter) return

    const categories = getAvailableFeedCategories()
    const options = ['<option value="all">全部分类</option>']
    categories.forEach((category) => {
      options.push(`<option value="${escapeAttribute(category)}">${escapeHtml(category)}</option>`)
    })
    els.feedCategoryFilter.innerHTML = options.join("")

    if (state.feedCategoryFilter !== "all" && !categories.includes(state.feedCategoryFilter)) {
      state.feedCategoryFilter = "all"
      window.localStorage.setItem(feedCategoryFilterKey, state.feedCategoryFilter)
    }
    setValueWhenChanged(els.feedCategoryFilter, state.feedCategoryFilter)
  }

  function renderFeedFilter() {
    if (els.feedSearch && els.feedSearch.value !== state.feedQuery) {
      setValueWhenChanged(els.feedSearch, state.feedQuery)
    }
    setValueWhenChanged(els.feedUnreadFilter, state.feedUnreadFilter)
    setValueWhenChanged(els.feedVisibilityFilter, state.feedVisibilityFilter)
    setValueWhenChanged(els.feedHealthFilter, state.feedHealthFilter)
    setValueWhenChanged(els.feedStaleFilter, state.feedStaleFilter)
    renderFeedCategoryOptions()
    if (els.feedShareFilter) {
      setValueWhenChanged(els.feedShareFilter, state.feedShareFilter)
    }
    const hasFeedFilter =
      state.feedUnreadFilter !== "all" ||
      state.feedVisibilityFilter !== "normal" ||
      state.feedHealthFilter !== "all" ||
      state.feedStaleFilter !== "any" ||
      state.feedCategoryFilter !== "all" ||
      state.feedShareFilter !== "all"
    els.feedSearchMenu?.classList.toggle("is-active", Boolean(state.feedQuery.trim()))
    els.feedFilterMenu?.classList.toggle("is-active", hasFeedFilter)
    if (els.feedFilterIndicator) {
      setTextWhenChanged(els.feedFilterIndicator, hasFeedFilter ? "●" : "○")
    }
  }

  function getNavigableFeeds() {
    const feeds = getFilteredFeeds()
    const baseFeeds = feeds.length ? feeds : state.feeds.slice()
    if (state.itemFilter !== "unread") return baseFeeds

    return baseFeeds.filter((feed) => Number(feed.unread_count || 0) > 0)
  }

  function getFeedNavigationTargets() {
    const feeds = getNavigableFeeds()
    if (!feeds.length) {
      return { feeds, previous: null, next: null, currentIndex: -1 }
    }

    const currentIndex = feeds.findIndex((feed) => Number(feed.feed_id) === Number(state.selectedFeedId))
    if (currentIndex === -1) {
      return {
        feeds,
        currentIndex,
        previous: feeds[feeds.length - 1] || null,
        next: feeds[0] || null
      }
    }

    return {
      feeds,
      currentIndex,
      previous: feeds[(currentIndex - 1 + feeds.length) % feeds.length] || null,
      next: feeds[(currentIndex + 1) % feeds.length] || null
    }
  }

  function renderFeedNavigation() {
    const loggedIn = Boolean(state.me?.user)
    const { feeds, currentIndex, previous, next } = getFeedNavigationTargets()
    const disablePrevious = !loggedIn || !previous || (currentIndex !== -1 && feeds.length < 2)
    const disableNext = !loggedIn || !next || (currentIndex !== -1 && feeds.length < 2)
    const feedKind = state.itemFilter === "unread" ? "未读订阅源" : "订阅源"

    if (els.feedPrevBtn) {
      setDisabledWhenChanged(els.feedPrevBtn, disablePrevious)
      const previousLabel = previous ? getDisplayFeedTitle(previous) : ""
      els.feedPrevBtn.title = previousLabel ? `上一个${feedKind}：${previousLabel}` : `没有可切换的${feedKind}`
      setAttributeWhenChanged(els.feedPrevBtn, "aria-label", previousLabel ? `上一个${feedKind}：${previousLabel}` : `没有可切换的${feedKind}`)
    }

    if (els.feedNextBtn) {
      setDisabledWhenChanged(els.feedNextBtn, disableNext)
      const nextLabel = next ? getDisplayFeedTitle(next) : ""
      els.feedNextBtn.title = nextLabel ? `下一个${feedKind}：${nextLabel}` : `没有可切换的${feedKind}`
      setAttributeWhenChanged(els.feedNextBtn, "aria-label", nextLabel ? `下一个${feedKind}：${nextLabel}` : `没有可切换的${feedKind}`)
    }
  }

  function renderPager() {
    renderFeedNavigation()
  }

  return {
    closeFeedDrawer,
    getFeedNavigationTargets,
    renderComposeState,
    renderFeedBulkState,
    renderFeedDrawer,
    renderFeedFilter,
    renderFeedNavigation,
    renderPager,
    renderScopeButtons,
    resetImportComposer,
    setFeedSelection,
    toggleAllVisibleFeeds,
    toggleFeedDrawer
  }
}
