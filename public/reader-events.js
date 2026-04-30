export function registerReaderEvents(deps) {
  const {
    els,
    state,
    compactMedia,
    virtualItems,
    keys,
    normalizers,
    actions,
    menus,
    renderers
  } = deps

  function on(element, eventName, handler, options) {
    element?.addEventListener(eventName, handler, options)
  }

  on(els.composeToggleBtn, "click", () => {
    state.composeOpen = !state.composeOpen
    renderers.renderComposeState()
  })

  on(els.feedForm, "submit", async (event) => {
    event.preventDefault()
    try {
      if (!state.me?.user) {
        actions.setStatus("请先登录", "warning")
        return
      }
      await actions.addFeed()
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  on(els.importForm, "submit", async (event) => {
    event.preventDefault()
    try {
      if (!state.me?.user) {
        actions.setStatus("请先登录", "warning")
        return
      }
      await actions.importFeeds()
    } catch (error) {
      actions.setStatus(error.message, "error")
    }
  })

  on(els.openAllBtn, "click", async () => {
    menus.closeFeedDrawer()
    await actions.selectQuickScope("all")
  })
  on(els.openTodayBtn, "click", async () => {
    menus.closeFeedDrawer()
    await actions.selectQuickScope("today")
  })
  on(els.openFavoriteBtn, "click", async () => {
    menus.closeFeedDrawer()
    await actions.selectQuickScope("favorite")
  })
  on(els.openUnreadBtn, "click", async () => {
    menus.closeFeedDrawer()
    await actions.selectQuickScope("unread")
  })
  on(els.feedDrawerBtn, "click", menus.toggleFeedDrawer)
  on(els.contentToggleBtn, "click", actions.toggleContentColumn)
  on(els.feedDrawerBackdrop, "click", menus.closeFeedDrawer)
  on(els.refreshAllBtn, "click", actions.refreshCurrentView)
  on(els.exportOpmlBtn, "click", () => actions.exportFeeds("opml"))
  on(els.exportJsonBtn, "click", () => actions.exportFeeds("json"))
  on(els.feedBulkToggleBtn, "click", actions.toggleFeedBulkMode)
  on(els.feedRefreshAllBtn, "click", actions.refreshAllFeeds)
  on(els.feedBulkSelectAllBtn, "click", () => actions.toggleAllVisibleFeeds())
  on(els.feedBulkRefreshBtn, "click", async () => actions.refreshSelectedFeeds())
  on(els.feedBulkEditBtn, "click", async () => actions.renameSelectedFeeds())
  on(els.feedBulkShareBtn, "click", async () => actions.shareSelectedFeeds())
  on(els.feedBulkDeleteBtn, "click", async () => actions.deleteSelectedFeeds())
  on(els.feedSettingsBackdrop, "click", menus.closeFeedSettingsModal)
  on(els.feedSettingsCloseBtn, "click", menus.closeFeedSettingsModal)
  on(els.feedSettingsResetBtn, "click", () => {
    actions.resetFeedSettingsForm()
    els.feedSettingsFetchPassword.dataset.clear = "1"
    els.feedSettingsFetchCookie.dataset.clear = "1"
  })
  on(els.feedSettingsForm, "submit", async (event) => {
    event.preventDefault()
    await actions.saveFeedSettings()
  })

  menus.managedMenus.forEach((menu) => {
    const summary = menu.querySelector("summary")
    if (!summary) return

    summary.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      menus.toggleToolbarMenu(menu)
    })

    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      event.stopPropagation()
      menus.toggleToolbarMenu(menu)
    })
  })

  document.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) {
      menus.closeManagedMenus()
      return
    }
    if (target.closest(".reader-toolbar-menu, .reader-head-menu")) return
    menus.closeManagedMenus()
  })

  on(els.feedSearch, "input", () => {
    actions.scheduleDebouncedRender("feedSearch", () => {
      state.feedQuery = els.feedSearch.value
      renderers.renderFeeds()
    })
  })
  on(els.feedSearchClearBtn, "click", () => {
    state.feedQuery = ""
    if (els.feedSearch) {
      els.feedSearch.value = ""
      els.feedSearch.focus()
    }
    renderers.renderFeeds()
  })
  els.feedUnreadFilter?.addEventListener("change", () => {
    state.feedUnreadFilter = normalizers.normalizeFeedUnreadFilter(els.feedUnreadFilter.value)
    actions.scheduleReaderPreferenceSave()
    renderers.renderFeeds()
  })
  els.feedVisibilityFilter?.addEventListener("change", () => {
    state.feedVisibilityFilter = normalizers.normalizeFeedVisibilityFilter(els.feedVisibilityFilter.value)
    window.localStorage.setItem(keys.FEED_VISIBILITY_FILTER_KEY, state.feedVisibilityFilter)
    renderers.renderFeeds()
  })
  els.feedHealthFilter?.addEventListener("change", () => {
    state.feedHealthFilter = normalizers.normalizeFeedHealthFilter(els.feedHealthFilter.value)
    window.localStorage.setItem(keys.FEED_HEALTH_FILTER_KEY, state.feedHealthFilter)
    renderers.renderFeeds()
  })
  els.feedStaleFilter?.addEventListener("change", () => {
    state.feedStaleFilter = normalizers.normalizeFeedStaleFilter(els.feedStaleFilter.value)
    window.localStorage.setItem(keys.FEED_STALE_FILTER_KEY, state.feedStaleFilter)
    renderers.renderFeeds()
  })
  els.feedCategoryFilter?.addEventListener("change", () => {
    state.feedCategoryFilter = normalizers.normalizeFeedCategoryFilter(els.feedCategoryFilter.value)
    window.localStorage.setItem(keys.FEED_CATEGORY_FILTER_KEY, state.feedCategoryFilter)
    renderers.renderFeeds()
  })
  els.feedShareFilter?.addEventListener("change", () => {
    state.feedShareFilter = normalizers.normalizeFeedShareFilter(els.feedShareFilter.value)
    window.localStorage.setItem(keys.FEED_SHARE_FILTER_KEY, state.feedShareFilter)
    renderers.renderFeeds()
  })

  on(els.itemSearch, "input", () => {
    actions.scheduleDebouncedRender("itemSearch", () => {
      state.itemQuery = els.itemSearch.value
      if (state.itemQuery) {
        window.localStorage.setItem(keys.ITEM_QUERY_KEY, state.itemQuery)
      } else {
        window.localStorage.removeItem(keys.ITEM_QUERY_KEY)
      }
      renderers.renderSearchState()
      renderers.renderItems()
    })
  })

  on(els.searchClearBtn, "click", () => {
    state.itemQuery = ""
    window.localStorage.removeItem(keys.ITEM_QUERY_KEY)
    if (els.itemSearch) {
      els.itemSearch.value = ""
      els.itemSearch.focus()
    }
    renderers.renderSearchState()
    renderers.renderItems()
  })

  on(els.feedList, "click", (event) => {
    void actions.handleFeedListClick(event)
  })
  on(els.feedList, "pointerover", actions.handleFeedListPointerOver)
  on(els.feedList, "focusin", actions.handleFeedListPointerOver)
  on(els.feedList, "change", actions.handleFeedListChange)
  on(els.itemList, "click", (event) => {
    void actions.handleItemListClick(event)
  })
  on(els.articlePanel, "click", (event) => {
    const bodyToggleButton = event.target.closest("[data-item-body-toggle]")
    if (!bodyToggleButton || !els.articlePanel.contains(bodyToggleButton)) return
    actions.toggleBodyExpanded(Number(bodyToggleButton.dataset.itemBodyToggle))
  })

  on(els.feedPrevBtn, "click", async () => {
    await actions.navigateFeed(-1)
  })

  on(els.feedNextBtn, "click", async () => {
    await actions.navigateFeed(1)
  })

  els.markReadButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await actions.markItemsRead(button.dataset.markReadMode || "filtered")
    })
  })

  on(els.markReadFooterBtn, "click", async () => {
    await actions.markItemsRead("all")
  })

  els.filterButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      state.itemFilter = button.dataset.itemFilter || "all"
      state.publishedSince = null
      actions.scheduleReaderPreferenceSave()
      actions.resetLoadedItems()
      renderers.renderFilterMode()
      renderers.renderScopeButtons()
      menus.closeToolbarMenu(els.filterMenu)
      await actions.loadItems(state.selectedFeedId)
    })
  })

  on(els.viewListBtn, "click", () => {
    state.viewMode = "list"
    window.localStorage.setItem(keys.VIEW_KEY, state.viewMode)
    renderers.renderViewMode()
    renderers.renderItems()
    menus.closeToolbarMenu(els.viewMenu)
  })
  on(els.viewTableBtn, "click", () => {
    state.viewMode = "table"
    window.localStorage.setItem(keys.VIEW_KEY, state.viewMode)
    renderers.renderViewMode()
    renderers.renderItems()
    menus.closeToolbarMenu(els.viewMenu)
  })
  on(els.viewMagazineBtn, "click", () => {
    state.viewMode = "magazine"
    window.localStorage.setItem(keys.VIEW_KEY, state.viewMode)
    renderers.renderViewMode()
    renderers.renderItems()
    menus.closeToolbarMenu(els.viewMenu)
  })

  on(els.favoriteToggleBtn, "click", async () => {
    if (!state.selectedItem) return
    await actions.setFavoriteState(state.selectedItem.id, !state.selectedItem.is_favorited)
  })

  on(els.browserOpenBtn, "click", () => actions.openItemInBrowser(state.selectedItem))
  on(els.bodyPageBtn, "click", () => void actions.toggleDetailView("page"))
  on(els.summaryToggleBtn, "click", () => void actions.toggleDetailView("summary"))
  on(els.translateBtn, "click", () => void actions.toggleDetailView("translation"))
  on(els.originalToggleBtn, "click", () => void actions.toggleDetailView("original"))

  on(els.readToggleBtn, "click", async () => {
    if (!state.selectedItem) return
    await actions.setReadState(state.selectedItem.id, !state.selectedItem.is_read)
  })

  on(els.loadContentBtn, "click", async () => {
    if (!state.selectedItem) return
    await actions.ensureContentLoaded(state.selectedItem.id, { showLoadingState: true })
  })

  compactMedia.addEventListener("change", () => {
    renderers.renderLayoutMode()
    renderers.renderFeedDrawer()
    renderers.renderViewMode()
    renderers.renderItems()
    renderers.renderArticle()
    actions.scheduleMaybeLoadNextPage()
  })

  on(els.itemColumn, "scroll", () => {
    actions.scheduleMaybeLoadNextPage()
  }, { passive: true })
  on(els.itemList, "scroll", () => {
    virtualItems.scheduleWindowRender()
    actions.scheduleMaybeLoadNextPage()
  }, { passive: true })
  on(window, "scroll", () => {
    actions.scheduleMaybeLoadNextPage()
  }, { passive: true })
  on(window, "resize", () => {
    virtualItems.scheduleWindowRender()
    actions.scheduleMaybeLoadNextPage()
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menus.closeManagedMenus()
    }
    if (event.key === "Escape" && state.feedSettingsFeedId) {
      menus.closeFeedSettingsModal()
      return
    }
    if (event.key === "Escape" && state.feedDrawerOpen) {
      menus.closeFeedDrawer()
    }
  })
}
