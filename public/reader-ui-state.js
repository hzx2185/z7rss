export function createReaderUiState({
  compactMedia,
  defaultColumnWidths,
  defaultTableColumns,
  els,
  itemFilterKey,
  feedUnreadFilterKey,
  normalizeFeedUnreadFilter,
  normalizeItemFilter,
  readerApi,
  state,
  closeToolbarMenu,
  getCurrentAccount,
  getFilteredItems,
  renderComposeState,
  renderFeedBulkState,
  renderFeedDrawer,
  shouldInlineDetail
}) {
  let flashTimer = null
  let lastStatusKey = ""
  let lastActionAvailabilityKey = ""
  const debounceTimers = {
    feedSearch: null,
    itemSearch: null
  }

  function setTextWhenChanged(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text
    }
  }

  function scheduleDebouncedRender(key, callback, delay = 140) {
    if (debounceTimers[key]) {
      window.clearTimeout(debounceTimers[key])
    }
    debounceTimers[key] = window.setTimeout(() => {
      debounceTimers[key] = null
      callback()
    }, delay)
  }

  function showFlash(message, tone = "info") {
    if (flashTimer) {
      window.clearTimeout(flashTimer)
      flashTimer = null
    }

    if (!message) {
      els.flashMessage.className = "reader-flash hidden"
      els.flashMessage.textContent = ""
      return
    }
    els.flashMessage.className = `reader-flash tone-${tone}`
    els.flashMessage.textContent = message

    const duration = tone === "error" ? 5200 : 3200
    flashTimer = window.setTimeout(() => {
      els.flashMessage.className = "reader-flash hidden"
      els.flashMessage.textContent = ""
      flashTimer = null
    }, duration)
  }

  function setStatus(message = "", tone = "info") {
    const statusKey = `${tone}:${message}`
    if (lastStatusKey === statusKey && (flashTimer || /^正在/.test(message) || /已就绪/.test(message))) return
    lastStatusKey = statusKey
    setTextWhenChanged(els.statusText, message)
    if (!message || /^正在/.test(message) || /已就绪/.test(message)) {
      return
    }
    showFlash(message, tone)
  }

  function persistReaderPreferencesLocally() {
    window.localStorage.setItem(feedUnreadFilterKey, state.feedUnreadFilter)
    window.localStorage.setItem(itemFilterKey, state.itemFilter)
  }

  function applySavedReaderPreferences(readerPreferences = {}) {
    const localFeedUnreadFilter = window.localStorage.getItem(feedUnreadFilterKey)
    const localItemFilter = window.localStorage.getItem(itemFilterKey)

    if (readerPreferences.feed_unread_filter_saved || !localFeedUnreadFilter) {
      state.feedUnreadFilter = normalizeFeedUnreadFilter(readerPreferences.feed_unread_filter)
    }

    if (readerPreferences.item_filter_saved || !localItemFilter) {
      state.itemFilter = normalizeItemFilter(readerPreferences.item_filter)
    }

    persistReaderPreferencesLocally()
  }

  function scheduleReaderPreferenceSave() {
    persistReaderPreferencesLocally()
    if (!state.me?.user) return

    scheduleDebouncedRender("readerPreferences", () => {
      void readerApi
        .updateReaderPreferences({
          feedUnreadFilter: state.feedUnreadFilter,
          itemFilter: state.itemFilter
        })
        .then((result) => {
          if (state.me && result?.preferences) {
            state.me.preferences = result.preferences
          }
        })
        .catch(() => {
          setStatus("阅读默认筛选保存失败", "warning")
        })
    }, 180)
  }

  function setControlsDisabled(elements, disabled) {
    elements.forEach((element) => {
      setControlDisabled(element, disabled)
    })
  }

  function setControlDisabled(element, disabled) {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled
    }
  }

  function applyLayoutWidths() {
    els.layout?.style.setProperty("--reader-source-width", `${defaultColumnWidths.source}px`)
    els.layout?.style.setProperty("--reader-item-width", `${defaultColumnWidths.item}px`)
  }

  function applyTableColumns() {
    els.itemColumn?.style.setProperty("--reader-table-status-width", `${defaultTableColumns.status}px`)
    els.itemColumn?.style.setProperty("--reader-table-site-width", `${defaultTableColumns.site}px`)
    els.itemColumn?.style.setProperty("--reader-table-time-width", `${defaultTableColumns.time}px`)
  }

  function renderLayoutMode() {
    const inlineMode = shouldInlineDetail()
    if (inlineMode) {
      if (state.selectedItem?.id) {
        state.expandedItemId = Number(state.selectedItem.id)
      } else if (state.expandedItemId && !state.items.some((item) => Number(item.id) === Number(state.expandedItemId))) {
        state.expandedItemId = null
      }
    }
    els.layout.classList.remove("layout-two")
    els.layout.classList.toggle("inline-mode", inlineMode)
    if (els.contentToggleBtn) {
      setTextWhenChanged(els.contentToggleBtn, "文")
      const label = inlineMode ? "显示右侧文章内容栏" : "收起右侧文章内容栏"
      if (els.contentToggleBtn.title !== label) els.contentToggleBtn.title = label
      els.contentToggleBtn.setAttribute("aria-label", label)
      els.contentToggleBtn.classList.toggle("active", !inlineMode)
      setControlDisabled(els.contentToggleBtn, compactMedia.matches)
    }
    renderFeedDrawer()
  }

  function renderViewMode() {
    els.viewListBtn.classList.toggle("active", state.viewMode === "list")
    els.viewTableBtn.classList.toggle("active", state.viewMode === "table")
    els.viewMagazineBtn.classList.toggle("active", state.viewMode === "magazine")
    els.viewIndicator.textContent = state.viewMode === "list" ? "≣" : state.viewMode === "magazine" ? "▥" : "▤"
    els.viewMenu.classList.toggle("is-active", state.viewMode !== "table")
    updateListHeadVisibility()
  }

  function renderFilterMode() {
    els.filterButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.itemFilter === state.itemFilter)
    })
    const filterMap = {
      all: "○",
      read: "✓",
      unread: "●",
      favorite: "★"
    }
    els.filterIndicator.textContent = filterMap[state.itemFilter] || "全"
    els.filterMenu.classList.toggle("is-active", state.itemFilter !== "all")
    renderFeedDrawer()
  }

  function renderSearchState() {
    if (els.itemSearch && els.itemSearch.value !== state.itemQuery) {
      els.itemSearch.value = state.itemQuery
    }
    els.searchMenu?.classList.toggle("is-active", Boolean(state.itemQuery.trim()))
  }

  function resetContentPaneScroll() {
    if (shouldInlineDetail()) return
    window.requestAnimationFrame(() => {
      if (els.contentColumn) {
        els.contentColumn.scrollTop = 0
      }
      if (els.contentShell) {
        els.contentShell.scrollTop = 0
      }
    })
  }

  function resetItemListScroll() {
    window.requestAnimationFrame(() => {
      if (els.itemList) {
        els.itemList.scrollTop = 0
      }
      if (els.itemColumn) {
        els.itemColumn.scrollTop = 0
      }
      if (shouldInlineDetail()) {
        window.scrollTo(window.scrollX || 0, 0)
      }
    })
  }

  function renderLoadStatus() {
  }

  function renderMarkReadAvailability(filteredCount = getFilteredItems().length) {
    const menuDisabled = !state.me?.user || (filteredCount === 0 && state.items.length === 0)
    const footerDisabled = !state.me?.user || filteredCount === 0
    els.markReadMenus.forEach((menu) => {
      menu.classList.toggle("is-disabled", menuDisabled)
      if (menuDisabled) {
        closeToolbarMenu(menu)
      }
    })
    setControlsDisabled(els.markReadButtons, menuDisabled)
    setControlsDisabled([els.markReadFooterBtn], footerDisabled)
  }

  function updateListHeadVisibility(hasRows = getFilteredItems().length > 0) {
    const visible = state.viewMode === "table" && !compactMedia.matches && Boolean(state.me?.user) && hasRows
    els.listHead.classList.toggle("hidden", !visible)
  }

  function updateActionAvailability(options = {}) {
    const loggedIn = Boolean(state.me?.user)
    const account = getCurrentAccount()
    const filteredCount = Number.isFinite(options.filteredCount) ? options.filteredCount : getFilteredItems().length
    const nextAvailabilityKey = [
      loggedIn ? "1" : "0",
      Number(state.selectedItem?.id || 0),
      account?.features.translation ? "t1" : "t0",
      account?.features.summary ? "s1" : "s0",
      filteredCount,
      state.items.length,
      state.feedBulkMode ? "b1" : "b0",
      state.selectedFeedIds.join(","),
      state.feeds.length
    ].join("|")

    if (lastActionAvailabilityKey === nextAvailabilityKey) {
      return
    }
    lastActionAvailabilityKey = nextAvailabilityKey

    setControlsDisabled(
      [
        els.composeToggleBtn,
        els.feedUrl,
        els.feedSubmitBtn,
        els.importContent,
        els.importSubmitBtn,
        els.exportOpmlBtn,
        els.exportJsonBtn,
        els.feedBulkToggleBtn,
        els.feedBulkSelectAllBtn,
        els.feedBulkRefreshBtn,
        els.feedBulkEditBtn,
        els.feedBulkShareBtn,
        els.feedBulkDeleteBtn,
        els.feedPrevBtn,
        els.feedNextBtn
      ],
      !loggedIn
    )

    setControlDisabled(els.favoriteToggleBtn, !state.selectedItem)
    setControlDisabled(els.readToggleBtn, !state.selectedItem)
    setControlDisabled(els.translateBtn, !state.selectedItem || !account?.features.translation)
    setControlDisabled(els.summaryToggleBtn, !state.selectedItem || !account?.features.summary)
    setControlDisabled(els.originalToggleBtn, !state.selectedItem)
    renderMarkReadAvailability(filteredCount)
    els.exportMenu?.classList.toggle("is-disabled", !loggedIn)
    if (!loggedIn) {
      closeToolbarMenu(els.exportMenu)
    }

    if (!loggedIn) {
      state.composeOpen = false
      state.feedBulkMode = false
      state.selectedFeedIds = []
      renderComposeState()
    }

    renderFeedBulkState()
  }

  return {
    applyLayoutWidths,
    applySavedReaderPreferences,
    applyTableColumns,
    renderFilterMode,
    renderLayoutMode,
    renderLoadStatus,
    renderSearchState,
    renderViewMode,
    resetContentPaneScroll,
    resetItemListScroll,
    scheduleDebouncedRender,
    scheduleReaderPreferenceSave,
    setStatus,
    showFlash,
    updateActionAvailability,
    updateListHeadVisibility
  }
}
