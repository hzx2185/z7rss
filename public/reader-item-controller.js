export function createReaderItemController(deps) {
  const {
    els,
    state,
    readerApi,
    applySelectedItem,
    buildTranslatedExcerpt,
    closeMarkReadMenus,
    findRenderedItem,
    getEffectiveTranslationForItem,
    getFilteredItems,
    getDisplayFeedTitle,
    getFeedById,
    hasStoredTranslation,
    isFeedNormal,
    loadFeeds,
    loadMe,
    loadScopeCounts,
    openExternalTranslate,
    renderArticle,
    renderFeedDrawer,
    renderFeedNavigation,
    renderItems,
    refreshRenderedFeedRows,
    refreshRenderedItemRows,
    renderLoadStatus,
    renderPager,
    renderScopeButtons,
    resetContentPaneScroll,
    clearDeferredReadItems,
    rememberDeferredReadItem,
    removeDeferredReadItem,
    resetLoadedItems,
    scheduleMaybeLoadNextPage,
    setItemOperationState,
    setStatus,
    shouldInlineDetail,
    syncItemToList,
    syncManyItemsToList,
    updateActionAvailability
  } = deps

  let itemsRequestToken = 0
  let previewRequestToken = 0
  const pendingItemPageRequests = new Map()

  function invalidatePreviewRequest() {
    previewRequestToken += 1
  }

  function adjustUnreadCounts(feedId, delta) {
    const normalizedFeedId = Number(feedId || 0)
    const normalizedDelta = Number(delta || 0)
    if (!normalizedFeedId || !normalizedDelta) return

    state.feeds = state.feeds.map((feed) => {
      if (Number(feed.feed_id) !== normalizedFeedId) return feed
      return {
        ...feed,
        unread_count: Math.max(0, Number(feed.unread_count || 0) + normalizedDelta)
      }
    })
    state.scopeCounts = {
      ...state.scopeCounts,
      unread: Math.max(0, Number(state.scopeCounts?.unread || 0) + normalizedDelta)
    }
  }

  function applyVisibleReadPatch(itemIds, { isRead = true, removeIfUnreadFilter = true } = {}) {
    const normalizedIds = new Set(
      itemIds
        .map((itemId) => Number(itemId || 0))
        .filter((itemId) => Number.isInteger(itemId) && itemId > 0)
    )
    if (!normalizedIds.size) return

    const selectedWasUpdated = state.selectedItem && normalizedIds.has(Number(state.selectedItem.id))
    syncManyItemsToList([...normalizedIds], { is_read: isRead ? 1 : 0 })
    if (selectedWasUpdated) {
      applySelectedItem({ ...state.selectedItem, is_read: isRead ? 1 : 0 })
    }

    if (removeIfUnreadFilter && state.itemFilter === "unread" && isRead) {
      state.items = state.items.filter((item) => !normalizedIds.has(Number(item.id)))
      state.itemTotal = Math.max(0, Number(state.itemTotal || 0) - normalizedIds.size)
      if (selectedWasUpdated) {
        state.selectedItem = null
        state.expandedItemId = null
        state.detailView = null
      }
      renderItems()
      renderArticle()
      return
    }

    refreshRenderedItemRows([...normalizedIds])
    renderArticle()
  }

  function preserveInlineItemPosition(_itemId, render) {
    const inlineMode = shouldInlineDetail()
    const container = els.itemList
    const normalizedItemId = Number(_itemId || 0)
    if (!inlineMode || !container) {
      render()
      return
    }

    const currentRow = normalizedItemId > 0 ? container.querySelector(`[data-item-row="${normalizedItemId}"]`) : null
    const previousRowTop = currentRow?.getBoundingClientRect?.().top ?? null
    const previousScrollTop = container.scrollTop

    render()

    if (previousRowTop === null || normalizedItemId <= 0) {
      container.scrollTop = previousScrollTop
      return
    }

    const nextRow = container.querySelector(`[data-item-row="${normalizedItemId}"]`)
    if (!nextRow) {
      container.scrollTop = previousScrollTop
      return
    }

    const nextRowTop = nextRow.getBoundingClientRect().top
    container.scrollTop += nextRowTop - previousRowTop
  }

  function syncRenderedItemSelection(selectedItemId = state.selectedItem?.id || 0) {
    const normalized = Number(selectedItemId || 0)
    if (!els.itemList) return

    els.itemList.querySelectorAll(".reader-item-row.is-active").forEach((row) => {
      const itemId = Number(row.getAttribute("data-item-row") || 0)
      if (itemId === normalized) return
      row.classList.remove("is-active")
      const button = row.querySelector("[data-item-select]")
      if (button?.getAttribute("aria-pressed") !== "false") {
        button?.setAttribute("aria-pressed", "false")
      }
    })

    if (normalized <= 0) return
    const nextButton = els.itemList.querySelector(`[data-item-select="${normalized}"]`)
    const nextRow = nextButton?.closest(".reader-item-row")
    nextRow?.classList.add("is-active")
    if (nextButton?.getAttribute("aria-pressed") !== "true") {
      nextButton.setAttribute("aria-pressed", "true")
    }
  }

  async function fetchItemsPage(feedId = state.selectedFeedId, page = 1, options = {}) {
    return readerApi.listItems({
      feedId,
      limit: state.itemLimit,
      page,
      filter: state.itemFilter,
      publishedSince: state.publishedSince,
      fresh: Boolean(options.fresh)
    })
  }

  function getItemsPageCacheKey(feedId = state.selectedFeedId, page = state.itemPage || 1) {
    return [
      Number(feedId || 0),
      Number(page || 1),
      state.itemLimit,
      state.itemFilter,
      state.publishedSince || ""
    ].join(":")
  }

  function rememberItemsPage(feedId, page, result) {
    if (!state.itemPageCache || !result) return
    const key = getItemsPageCacheKey(feedId, page)
    state.itemPageCache.set(key, {
      result,
      createdAt: Date.now()
    })
    if (state.itemPageCache.size > 12) {
      const firstKey = state.itemPageCache.keys().next().value
      state.itemPageCache.delete(firstKey)
    }
  }

  function forgetItemsPage(feedId = state.selectedFeedId, page = state.itemPage || 1) {
    state.itemPageCache?.delete(getItemsPageCacheKey(feedId, page))
  }

  function getCachedItemsPage(feedId, page) {
    const entry = state.itemPageCache?.get(getItemsPageCacheKey(feedId, page))
    if (!entry) return null
    if (Date.now() - Number(entry.createdAt || 0) > 30_000) return null
    return entry.result
  }

  function getPendingItemsPage(feedId, page) {
    return pendingItemPageRequests.get(getItemsPageCacheKey(feedId, page)) || null
  }

  function fetchItemsPageOnce(feedId = state.selectedFeedId, page = 1, options = {}) {
    if (options.fresh) {
      return fetchItemsPage(feedId, page, options)
    }

    const key = getItemsPageCacheKey(feedId, page)
    const pending = pendingItemPageRequests.get(key)
    if (pending) return pending

    const request = fetchItemsPage(feedId, page, options)
      .then((result) => {
        rememberItemsPage(feedId, page, result)
        return result
      })
      .finally(() => {
        pendingItemPageRequests.delete(key)
      })
    pendingItemPageRequests.set(key, request)
    return request
  }

  async function prefetchItemsPage(feedId = state.selectedFeedId, page = 1) {
    if (!state.me?.user || !feedId) return
    if (getCachedItemsPage(feedId, page)) return
    try {
      await fetchItemsPageOnce(feedId, page)
    } catch (_error) {
      // Prefetch is best-effort; visible loads still surface errors.
    }
  }

  function prefetchNextUnreadFeedNow(feedId = state.selectedFeedId) {
    if (!state.me?.user) return
    const nextFeed = findNextUnreadFeed(feedId)
    if (nextFeed?.feed_id) {
      void prefetchItemsPage(Number(nextFeed.feed_id), 1)
    }
  }

  function schedulePrefetchNextUnreadFeed(feedId = state.selectedFeedId) {
    const normalizedFeedId = Number(feedId || 0)
    if (!state.me?.user || !normalizedFeedId) return

    const nextFeed = findNextUnreadFeed(normalizedFeedId)
    if (!nextFeed?.feed_id) return
    const run = () => void prefetchItemsPage(Number(nextFeed.feed_id), 1)
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 900 })
    } else {
      window.setTimeout(run, 120)
    }
  }

  async function loadItems(feedId = state.selectedFeedId, options = {}) {
    if (!state.me?.user) {
      invalidatePreviewRequest()
      resetLoadedItems()
      renderPager()
      renderItems()
      renderArticle()
      return
    }

    const targetPage = Math.max(1, Number(options.targetPage || state.itemPage || 1))
    const append = Boolean(options.append && targetPage > 1)
    const requestToken = ++itemsRequestToken
    if (!append) {
      invalidatePreviewRequest()
    }

    state.loadingItems = true
    state.loadingNextPage = append
    renderPager()
    renderLoadStatus()
    updateActionAvailability()

    try {
      if (options.force) {
        forgetItemsPage(feedId, targetPage)
      }
      const pendingResult = append || options.force ? null : getPendingItemsPage(feedId, targetPage)
      const cachedResult = append || options.force || pendingResult ? null : getCachedItemsPage(feedId, targetPage)
      const result = cachedResult || pendingResult || await fetchItemsPageOnce(feedId, targetPage, { fresh: Boolean(options.force) })
      rememberItemsPage(feedId, targetPage, result)
      if (requestToken !== itemsRequestToken) return

      const nextItems = Array.isArray(result.items) ? result.items : []
      const total = Number(result.total || 0)
      const nextPage = Math.max(1, Number(result.page || targetPage))
      const pageCount = Math.max(1, Number(result.pageCount || 1))

      if (requestToken !== itemsRequestToken) return

      const selectedId = state.selectedItem?.id || 0
      preserveInlineItemPosition(selectedId, () => {
        if (append) {
          const seen = new Set(state.items.map((item) => Number(item.id)))
          state.items = state.items.concat(nextItems.filter((item) => !seen.has(Number(item.id))))
          clearDeferredReadItems()
        } else {
          state.items = nextItems
        }
        state.itemTotal = total
        state.itemPage = nextPage
        state.itemPageCount = pageCount

        if (state.selectedItem && !state.items.some((item) => item.id === state.selectedItem.id)) {
          state.selectedItem = null
          state.expandedItemId = null
          state.detailView = null
        }

        renderPager()
        renderItems()
        renderArticle()
      })
    } catch (error) {
      if (requestToken === itemsRequestToken) {
        setStatus(error.message, "error")
      }
    } finally {
      if (requestToken !== itemsRequestToken) return
      state.loadingItems = false
      state.loadingNextPage = false
      renderPager()
      renderLoadStatus()
      updateActionAvailability()
      scheduleMaybeLoadNextPage()
    }
  }

  async function loadNextPage() {
    if (!state.me?.user || state.loadingItems || state.itemPage >= state.itemPageCount) {
      return
    }
    await loadItems(state.selectedFeedId, {
      targetPage: state.itemPage + 1,
      append: true
    })
  }

  function shouldLoadNextPage() {
    if (!state.me?.user || state.loadingItems || state.loadingNextPage || state.itemPage >= state.itemPageCount) {
      return false
    }

    if (window.matchMedia("(max-width: 900px)").matches) {
      const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0
      const footerRect = els.itemList?.getBoundingClientRect()
      if (!footerRect) return false
      if ((window.scrollY || window.pageYOffset || 0) <= 0) return false
      return footerRect.bottom - viewportBottom <= 280
    }

    const container = els.itemList
    if (!container) return false
    if (container.scrollTop <= 0) return false
    return container.scrollTop + container.clientHeight >= container.scrollHeight - 280
  }

  async function maybeLoadNextPage() {
    if (!shouldLoadNextPage()) return
    await loadNextPage()
  }

  async function selectFeedSmooth(feedId = null) {
    const previousFeedId = Number(state.selectedFeedId || 0)
    const requestToken = ++itemsRequestToken
    invalidatePreviewRequest()
    state.loadingItems = true
    state.loadingNextPage = false
    renderPager()
    renderLoadStatus()
    updateActionAvailability()

    try {
      const cachedResult = getCachedItemsPage(feedId, 1)
      const result = cachedResult || await fetchItemsPageOnce(feedId, 1)
      if (requestToken !== itemsRequestToken) return

      state.selectedFeedId = feedId
      state.publishedSince = null
      state.selectedItem = null
      state.expandedItemId = null
      state.detailView = null
      state.items = Array.isArray(result.items) ? result.items : []
      state.itemTotal = Number(result.total || 0)
      state.itemPage = Math.max(1, Number(result.page || 1))
      state.itemPageCount = Math.max(1, Number(result.pageCount || 1))
      clearDeferredReadItems()

      renderScopeButtons?.()
      renderFeedDrawer?.()
      renderFeedNavigation?.()
      refreshRenderedFeedRows?.([previousFeedId, feedId])
      renderPager()
      renderItems()
      renderArticle()
      resetContentPaneScroll()
      schedulePrefetchNextUnreadFeed(feedId)
    } catch (error) {
      if (requestToken === itemsRequestToken) {
        setStatus(error.message, "error")
      }
    } finally {
      if (requestToken !== itemsRequestToken) return
      state.loadingItems = false
      state.loadingNextPage = false
      renderPager()
      renderLoadStatus()
      updateActionAvailability()
      scheduleMaybeLoadNextPage()
    }
  }

  async function selectFeed(feedId = null, options = {}) {
    if (options.smooth) {
      await selectFeedSmooth(feedId)
      return
    }

    const previousFeedId = Number(state.selectedFeedId || 0)
    state.selectedFeedId = feedId
    state.publishedSince = null
    state.selectedItem = null
    state.expandedItemId = null
    state.detailView = null
    resetLoadedItems()
    renderScopeButtons?.()
    renderFeedDrawer?.()
    renderFeedNavigation?.()
    refreshRenderedFeedRows?.([previousFeedId, feedId])
    renderArticle()
    await loadItems(feedId)
    schedulePrefetchNextUnreadFeed(feedId)
  }

  async function toggleItem(itemId) {
    if (Number(state.selectedItem?.id || 0) === Number(itemId || 0)) {
      return
    }

    const previousSelectedId = Number(state.selectedItem?.id || 0)
    const collapseCurrent = state.expandedItemId === itemId
    state.expandedItemId = collapseCurrent ? null : itemId
    if (collapseCurrent && shouldInlineDetail()) {
      invalidatePreviewRequest()
      state.selectedItem = null
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
      return
    }

    const seedItem = findRenderedItem(itemId)
    if (seedItem) {
      state.detailView = null
      applySelectedItem(seedItem)
      if (shouldInlineDetail()) {
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([previousSelectedId, itemId])
          renderArticle()
        })
      } else {
        syncRenderedItemSelection(itemId)
        refreshRenderedItemRows([previousSelectedId, itemId])
        renderArticle()
      }
    }

    await openItem(itemId)
  }

  async function openItem(itemId) {
    const requestToken = ++previewRequestToken
    const previousSelectedId = Number(state.selectedItem?.id || 0)
    try {
      const preview = await readerApi.getItemPreview(itemId)
      if (requestToken !== previewRequestToken) return
      state.detailView = null
      if (preview?.is_read) {
        rememberDeferredReadItem(itemId)
      }
      applySelectedItem(preview)
      syncItemToList(itemId, {
        is_read: preview.is_read,
        is_favorited: preview.is_favorited,
        content_loaded: preview.content_loaded,
        content_excerpt: preview.content_excerpt || "",
        summary: preview.summary || "",
        fetch_error: preview.fetch_error || null,
        has_translation: hasStoredTranslation(preview) ? 1 : 0,
        has_ai_summary: preview.ai_summary ? 1 : 0,
        translated_title: preview.translated_title || "",
        translated_excerpt: preview.translated_text
          ? buildTranslatedExcerpt(preview.translated_text)
          : preview.translated_title
            ? buildTranslatedExcerpt(preview.translated_title)
            : ""
      })
      if (shouldInlineDetail()) {
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([previousSelectedId, itemId])
          renderArticle()
        })
      } else {
        syncRenderedItemSelection(itemId)
        refreshRenderedItemRows([previousSelectedId, itemId])
        renderArticle()
      }
      if (previousSelectedId !== Number(itemId)) {
        resetContentPaneScroll()
      }
      if (shouldAutoLoadMissingContent(state.selectedItem)) {
        void ensureContentLoaded(itemId, { showLoadingState: false, silent: true })
      }
      void loadScopeCounts()
    } catch (error) {
      if (requestToken !== previewRequestToken) return
      setStatus(error.message, "error")
    }
  }

  function shouldAutoLoadMissingContent(item) {
    if (!item || item.content_loaded || state.loadingContentFor === item.id) return false
    return !String(item.summary || "").trim() && !String(item.content_excerpt || "").trim()
  }

  async function ensureContentLoaded(itemId = state.selectedItem?.id, options = {}) {
    const item = state.selectedItem?.id === itemId ? state.selectedItem : null
    if (!item || item.content_loaded || state.loadingContentFor === itemId) {
      return
    }

    const showLoadingState = Boolean(options.showLoadingState)
    state.loadingContentFor = itemId
    if (showLoadingState) {
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
    }
    try {
      const content = await readerApi.getItemContent(itemId)
      if (state.selectedItem?.id === itemId) {
        applySelectedItem(content)
        syncItemToList(itemId, {
          is_read: 1,
          content_loaded: content.content_loaded,
          content_html: content.content_html || "",
          content_text: content.content_text || "",
          content_excerpt: content.content_excerpt || "",
          summary: content.summary || "",
          fetch_error: content.fetch_error || null,
          has_translation: hasStoredTranslation(content) ? 1 : 0,
          translated_title: content.translated_title || "",
          translated_excerpt: content.translated_text
            ? buildTranslatedExcerpt(content.translated_text)
            : content.translated_title
              ? buildTranslatedExcerpt(content.translated_title)
              : ""
        })
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([itemId])
          renderArticle()
        })
        void loadScopeCounts()
      }
    } catch (error) {
      if (!options.silent) {
        setStatus(error.message, "error")
      }
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
    } finally {
      state.loadingContentFor = null
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
    }
  }

  async function ensurePageLoaded(itemId = state.selectedItem?.id) {
    const item = state.selectedItem?.id === itemId ? state.selectedItem : null
    if (!item || item.page_loaded || state.loadingPageFor === itemId) {
      return
    }

    state.loadingPageFor = itemId
    renderArticle()
    try {
      const page = await readerApi.getItemPage(itemId)
      if (state.selectedItem?.id === itemId) {
        applySelectedItem(page)
        syncItemToList(itemId, { is_read: 1 })
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([itemId])
          renderArticle()
        })
        void loadScopeCounts()
      }
    } catch (error) {
      setStatus(error.message, "error")
      renderArticle()
    } finally {
      state.loadingPageFor = null
      renderArticle()
    }
  }

  function findNextUnreadFeed(currentFeedId) {
    const currentIndex = state.feeds.findIndex((feed) => Number(feed.feed_id) === Number(currentFeedId))
    const rotatedFeeds =
      currentIndex >= 0
        ? state.feeds.slice(currentIndex + 1).concat(state.feeds.slice(0, currentIndex))
        : state.feeds.slice()

    return (
      rotatedFeeds.find((feed) => Number(feed.unread_count || 0) > 0 && isFeedNormal(feed)) ||
      rotatedFeeds.find((feed) => Number(feed.unread_count || 0) > 0) ||
      null
    )
  }

  async function maybeSwitchToNextUnreadFeed(currentFeedId, options = {}) {
    if (!state.me?.user || !currentFeedId) {
      return { switched: false, completed: false, refreshedFeeds: false }
    }

    const shouldRefreshFeeds = options.refreshFeeds !== false
    if (shouldRefreshFeeds) {
      await loadFeeds()
    }

    const currentFeed = getFeedById(currentFeedId)
    if (Number(currentFeed?.unread_count || 0) > 0) {
      return { switched: false, completed: false, refreshedFeeds: shouldRefreshFeeds }
    }

    const nextFeed = findNextUnreadFeed(currentFeedId)
    if (!nextFeed) {
      return { switched: false, completed: true, refreshedFeeds: shouldRefreshFeeds }
    }

    await selectFeed(Number(nextFeed.feed_id), { smooth: true })
    return {
      switched: true,
      completed: false,
      refreshedFeeds: true,
      feed: nextFeed
    }
  }

  async function setReadState(itemId, isRead) {
    try {
      const currentItem = findRenderedItem(itemId) || (state.selectedItem?.id === itemId ? state.selectedItem : null)
      const currentFeedId = Number(state.selectedFeedId || currentItem?.feed_id || 0)
      const wasRead = Boolean(currentItem?.is_read)
      const shouldAutoAdvanceUnread = state.itemFilter === "unread"
      if (shouldAutoAdvanceUnread && isRead && currentFeedId && Number(getFeedById(currentFeedId)?.unread_count || 0) <= 1) {
        prefetchNextUnreadFeedNow(currentFeedId)
      }
      const result = await readerApi.setItemReadState(itemId, isRead)
      if (isRead) {
        rememberDeferredReadItem(itemId)
      } else {
        removeDeferredReadItem(itemId)
      }
      if (state.selectedItem?.id === itemId) {
        applySelectedItem({ ...state.selectedItem, ...result })
      }
      syncItemToList(itemId, { is_read: result.is_read })
      if (Boolean(result.is_read) !== wasRead) {
        adjustUnreadCounts(currentItem?.feed_id || currentFeedId, result.is_read ? -1 : 1)
        refreshRenderedFeedRows?.([currentItem?.feed_id || currentFeedId])
        renderScopeButtons?.()
      }

      const shouldReload =
        (state.itemFilter === "read" && !isRead) ||
        (state.itemFilter === "unread" && isRead)

      let switchResult = { switched: false, completed: false, refreshedFeeds: false }
      if (shouldAutoAdvanceUnread && isRead && currentFeedId) {
        switchResult = await maybeSwitchToNextUnreadFeed(currentFeedId, { refreshFeeds: false })
      }

      if (switchResult.switched) {
        setStatus(`已标记为已读，已切换到 ${getDisplayFeedTitle(switchResult.feed)}`, "success")
        return
      }

      const needsFeedRefresh = !switchResult.refreshedFeeds

      if (shouldReload) {
        if (state.itemFilter === "unread" && isRead) {
          if (needsFeedRefresh) void loadFeeds()
          if (!state.selectedFeedId && currentFeedId) {
            state.selectedFeedId = currentFeedId
          }
          applyVisibleReadPatch([itemId], { isRead: true })
          scheduleMaybeLoadNextPage()
        } else {
          if (needsFeedRefresh) void loadFeeds()
          if (!state.selectedFeedId && currentFeedId) {
            state.selectedFeedId = currentFeedId
          }
          await loadItems(state.selectedFeedId || currentFeedId || null)
        }
      } else {
        if (needsFeedRefresh) {
          void loadFeeds()
        }
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([itemId])
          renderArticle()
        })
      }

      if (switchResult.completed) {
        setStatus("已标记为已读，所有订阅都没有未读文章了", "success")
        return
      }

      setStatus(isRead ? "已标记为已读" : "已标记为未读", "success")
      if (shouldAutoAdvanceUnread) {
        schedulePrefetchNextUnreadFeed(currentFeedId)
      }
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  async function setFavoriteState(itemId, isFavorited) {
    try {
      const result = await readerApi.setItemFavoriteState(itemId, isFavorited)
      if (state.selectedItem?.id === itemId) {
        applySelectedItem({ ...state.selectedItem, ...result })
      }
      syncItemToList(itemId, { is_favorited: result.is_favorited })
      void loadMe()

      const shouldReload = state.itemFilter === "favorite" && !isFavorited
      if (shouldReload) {
        state.items = state.items.filter((item) => Number(item.id) !== Number(itemId))
        state.itemTotal = Math.max(0, Number(state.itemTotal || 0) - 1)
        if (state.selectedItem?.id === itemId) state.selectedItem = null
        if (state.expandedItemId === itemId) state.expandedItemId = null
        renderItems()
        renderArticle()
        scheduleMaybeLoadNextPage()
        void loadScopeCounts()
        setStatus("已取消收藏", "success")
      } else {
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([itemId])
          renderArticle()
        })
        void loadScopeCounts()
        setStatus(isFavorited ? "已收藏，收藏文章不会被自动删除" : "已取消收藏", "success")
      }
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  async function translateItem(itemId = state.selectedItem?.id) {
    if (!itemId) return null
    const item = findRenderedItem(itemId)
    const translation = getEffectiveTranslationForItem(item)
    if (translation.provider === "sogou") {
      openExternalTranslate("sogou", item)
      return {
        provider: "sogou",
        providerLabel: "搜狗翻译",
        targetLabel: translation.targetLabel || ""
      }
    }
    try {
      const result = await readerApi.translateItem(itemId)
      if (result?.skipped) {
        setItemOperationState(itemId, { translate_error: null })
        preserveInlineItemPosition(itemId, () => {
          refreshRenderedItemRows([itemId])
          renderArticle()
        })
        setStatus(result.message || "当前文章已是中文，无需翻译", "success")
        return result
      }
      const translatedExcerpt = buildTranslatedExcerpt(result.translatedText || result.translatedTitle || "")
      if (state.selectedItem?.id === itemId) {
        applySelectedItem({
          ...state.selectedItem,
          translated_title: result.translatedTitle || "",
          translated_text: result.translatedText || "",
          translate_error: null
        })
      }
      syncItemToList(itemId, {
        has_translation: 1,
        translated_title: result.translatedTitle || "",
        translated_excerpt: translatedExcerpt,
        translate_error: null
      })
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
      const providerLabel = result.providerLabel || "翻译"
      setStatus(result.targetLabel ? `${providerLabel}完成 · ${result.targetLabel}` : `${providerLabel}完成`, "success")
      return result
    } catch (error) {
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
      setStatus(error.message, "error")
      return null
    }
  }

  async function summarizeItem(itemId = state.selectedItem?.id) {
    if (!itemId) return null
    try {
      const result = await readerApi.summarizeItem(itemId)
      if (state.selectedItem?.id === itemId) {
        applySelectedItem({ ...state.selectedItem, ai_summary: result.aiSummary, summary_error: null })
      }
      syncItemToList(itemId, { has_ai_summary: 1, summary_error: null })
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
      setStatus("AI 总结已生成并保存", "success")
      return result
    } catch (error) {
      preserveInlineItemPosition(itemId, () => {
        refreshRenderedItemRows([itemId])
        renderArticle()
      })
      setStatus(error.message, "error")
      return null
    }
  }

  async function markItemsRead(mode = "filtered") {
    if (!state.me?.user) {
      setStatus("请先登录", "warning")
      return
    }

    closeMarkReadMenus()
    clearDeferredReadItems()

    let requestBody = { isRead: true }
    let successMessage = "已标记为已读"

    if (mode === "filtered") {
      const itemIds = getFilteredItems().map((item) => item.id)
      if (!itemIds.length) {
        setStatus("当前筛选结果没有可标记的文章", "warning")
        return
      }
      requestBody = { ...requestBody, itemIds }
      successMessage = "当前筛选结果已标记为已读"
    } else {
      requestBody = {
        ...requestBody,
        feedId: state.selectedFeedId,
        filter: state.itemFilter,
        publishedSince: state.publishedSince
      }

      if (mode === "older-day") {
        requestBody.olderThanDays = 1
        successMessage = "一天前的文章已标记为已读"
      } else if (mode === "older-week") {
        requestBody.olderThanDays = 7
        successMessage = "一周前的文章已标记为已读"
      } else {
        successMessage = "当前范围文章已标记为已读"
      }
    }

    try {
      const currentFeedId = state.selectedFeedId
      if (currentFeedId && state.itemFilter !== "read") {
        prefetchNextUnreadFeedNow(currentFeedId)
      }
      const result = await readerApi.setReadStateBulk(requestBody)
      const updatedCount = Number(result?.updatedCount || 0)

      const coversCurrentFeedUnread =
        Boolean(currentFeedId) &&
        !Array.isArray(requestBody.itemIds) &&
        !requestBody.olderThanDays &&
        !requestBody.publishedSince &&
        (requestBody.filter === "all" || requestBody.filter === "unread")

      if (currentFeedId && updatedCount > 0) {
        if (coversCurrentFeedUnread) {
          const currentUnread = Number(getFeedById(currentFeedId)?.unread_count || 0)
          adjustUnreadCounts(currentFeedId, -currentUnread)
        } else {
          adjustUnreadCounts(currentFeedId, -updatedCount)
        }
        refreshRenderedFeedRows?.([currentFeedId])
        renderScopeButtons?.()
      }

      let switchResult = { switched: false, completed: false, refreshedFeeds: false }
      if (currentFeedId && state.itemFilter !== "read" && (coversCurrentFeedUnread || state.itemFilter === "unread")) {
        switchResult = await maybeSwitchToNextUnreadFeed(currentFeedId, { refreshFeeds: false })
      }

      if (switchResult.switched) {
        setStatus(
          updatedCount > 0
            ? `${successMessage} · ${updatedCount} 篇，已切换到 ${getDisplayFeedTitle(switchResult.feed)}`
            : `已切换到 ${getDisplayFeedTitle(switchResult.feed)}`,
          "success"
        )
        return
      }

      if (Array.isArray(requestBody.itemIds)) {
        applyVisibleReadPatch(requestBody.itemIds, { isRead: true })
      } else {
        applyVisibleReadPatch(state.items.map((item) => item.id), { isRead: true })
      }

      if (!switchResult.refreshedFeeds) {
        void loadFeeds()
      }
      if (switchResult.completed) {
        setStatus(
          updatedCount > 0
            ? `${successMessage} · ${updatedCount} 篇，所有订阅都没有未读文章了`
            : "所有订阅都没有未读文章了",
          "success"
        )
        return
      }
      setStatus(updatedCount > 0 ? `${successMessage} · ${updatedCount} 篇` : successMessage, "success")
    } catch (error) {
      setStatus(error.message, "error")
    }
  }

  return {
    ensureContentLoaded,
    ensurePageLoaded,
    loadItems,
    loadNextPage,
    markItemsRead,
    maybeLoadNextPage,
    openItem,
    prefetchItemsPage,
    selectFeed,
    setFavoriteState,
    setReadState,
    summarizeItem,
    toggleItem,
    translateItem
  }
}
