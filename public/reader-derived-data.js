export function createReaderDerivedData({
  getDisplayFeedTitle,
  getDomainSearchTerms,
  getFeedDomainSearchText,
  getState,
  shouldInlineDetail
}) {
  const cache = {
    feedIndexSource: null,
    feedIndex: new Map(),
    itemIndexSource: null,
    itemIndex: new Map(),
    availableFeedCategoriesSource: null,
    availableFeedCategories: [],
    filteredFeedsSource: null,
    filteredFeedsQuery: "",
    filteredFeedsUnreadFilter: "",
    filteredFeedsVisibilityFilter: "",
    filteredFeedsHealthFilter: "",
    filteredFeedsStaleFilter: "",
    filteredFeedsCategoryFilter: "",
    filteredFeedsShareFilter: "",
    filteredFeeds: [],
    visibleItemsSource: null,
    visibleItemsFilter: "",
    visibleItemsDeferredSource: null,
    visibleItems: [],
    filteredItemsVisibleSource: null,
    filteredItemsQuery: "",
    filteredItemsInlineMode: false,
    filteredItemsSelectedSource: null,
    filteredItems: [],
    itemSearchText: new WeakMap()
  }

  function getFeedAgeDays(feed) {
    if (feed?.last_fetched_days === 0) return 0
    if (Number.isFinite(feed?.last_fetched_days)) return Number(feed.last_fetched_days)
    const value = feed?.last_fetched_at
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return Math.floor(Math.max(0, Date.now() - date.getTime()) / (24 * 60 * 60 * 1000))
  }

  function getFeedCategory(feed) {
    return String(feed?.category || feed?.category_manual || feed?.category_suggested || "未分类").trim() || "未分类"
  }

  function isFeedArchived(feed) {
    return Boolean(feed?.is_archived)
  }

  function isFeedCollapsed(feed) {
    return Boolean(feed?.is_collapsed)
  }

  function isFeedNormal(feed) {
    return !isFeedArchived(feed) && !isFeedCollapsed(feed)
  }

  function getAvailableFeedCategories() {
    const state = getState()
    if (cache.availableFeedCategoriesSource === state.feeds) {
      return cache.availableFeedCategories
    }

    const categories = [...new Set(state.feeds.map((feed) => getFeedCategory(feed)).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right, "zh-CN")
    )
    cache.availableFeedCategoriesSource = state.feeds
    cache.availableFeedCategories = categories
    return categories
  }

  function getFeedIndex() {
    const state = getState()
    if (cache.feedIndexSource === state.feeds) {
      return cache.feedIndex
    }

    const feedIndex = new Map()
    state.feeds.forEach((feed) => {
      const feedId = Number(feed?.feed_id || 0)
      if (feedId > 0) {
        feedIndex.set(feedId, feed)
      }
    })
    cache.feedIndexSource = state.feeds
    cache.feedIndex = feedIndex
    return feedIndex
  }

  function getFeedById(feedId) {
    const normalizedFeedId = Number(feedId || 0)
    if (!normalizedFeedId) return null
    return getFeedIndex().get(normalizedFeedId) || null
  }

  function getItemIndex() {
    const state = getState()
    if (cache.itemIndexSource === state.items) {
      return cache.itemIndex
    }

    const itemIndex = new Map()
    state.items.forEach((item) => {
      const itemId = Number(item?.id || 0)
      if (itemId > 0) {
        itemIndex.set(itemId, item)
      }
    })
    cache.itemIndexSource = state.items
    cache.itemIndex = itemIndex
    return itemIndex
  }

  function getItemById(itemId) {
    const normalizedItemId = Number(itemId || 0)
    if (!normalizedItemId) return null
    return getItemIndex().get(normalizedItemId) || null
  }

  function getCurrentFeed() {
    return getFeedById(getState().selectedFeedId)
  }

  function getFeedForItem(item = getState().selectedItem) {
    if (!item?.feed_id) return null
    return getFeedById(item.feed_id)
  }

  function matchesFeedVisibility(feed) {
    const state = getState()
    if (state.feedVisibilityFilter === "all") return true
    if (state.feedVisibilityFilter === "archived") return isFeedArchived(feed)
    if (state.feedVisibilityFilter === "collapsed") return isFeedCollapsed(feed)
    return isFeedNormal(feed)
  }

  function matchesFeedHealth(feed) {
    const state = getState()
    const hasError = Boolean(feed?.has_error || String(feed?.last_error || "").trim())
    if (state.feedHealthFilter === "healthy") return !hasError && Boolean(feed?.last_fetched_at)
    if (state.feedHealthFilter === "error") return hasError
    return true
  }

  function matchesFeedStale(feed) {
    const state = getState()
    if (state.feedStaleFilter === "any") return true
    const ageDays = getFeedAgeDays(feed)
    if (state.feedStaleFilter === "never") return ageDays === null
    const threshold = Number(state.feedStaleFilter || 0)
    if (!threshold) return true
    return ageDays !== null && ageDays >= threshold
  }

  function matchesFeedCategory(feed) {
    const state = getState()
    if (state.feedCategoryFilter === "all") return true
    return getFeedCategory(feed) === state.feedCategoryFilter
  }

  function matchesFeedShare(feed) {
    const state = getState()
    if (state.feedShareFilter === "public") return Boolean(feed?.is_public)
    if (state.feedShareFilter === "private") return !feed?.is_public
    return true
  }

  function getFilteredFeeds() {
    const state = getState()
    const query = state.feedQuery.trim().toLowerCase()
    if (
      cache.filteredFeedsSource === state.feeds &&
      cache.filteredFeedsQuery === query &&
      cache.filteredFeedsUnreadFilter === state.feedUnreadFilter &&
      cache.filteredFeedsVisibilityFilter === state.feedVisibilityFilter &&
      cache.filteredFeedsHealthFilter === state.feedHealthFilter &&
      cache.filteredFeedsStaleFilter === state.feedStaleFilter &&
      cache.filteredFeedsCategoryFilter === state.feedCategoryFilter &&
      cache.filteredFeedsShareFilter === state.feedShareFilter
    ) {
      return cache.filteredFeeds
    }

    let feeds = state.feeds
    if (state.feedUnreadFilter === "unread") {
      feeds = feeds.filter((feed) => Number(feed.unread_count || 0) > 0)
    } else if (state.feedUnreadFilter === "read") {
      feeds = feeds.filter((feed) => Number(feed.unread_count || 0) === 0)
    }
    feeds = feeds
      .filter((feed) => matchesFeedVisibility(feed))
      .filter((feed) => matchesFeedHealth(feed))
      .filter((feed) => matchesFeedStale(feed))
      .filter((feed) => matchesFeedCategory(feed))
      .filter((feed) => matchesFeedShare(feed))

    const queryTerms = typeof getDomainSearchTerms === "function" ? getDomainSearchTerms(query) : [query]
    const filteredFeeds = !query
      ? feeds
      : feeds.filter((feed) => {
          const haystack = [
            feed.title,
            getDisplayFeedTitle(feed),
            feed.url,
            feed.site_url || "",
            typeof getFeedDomainSearchText === "function" ? getFeedDomainSearchText(feed) : "",
            getFeedCategory(feed),
            feed.last_error || ""
          ]
            .join(" ")
            .toLowerCase()
          return queryTerms.some((term) => haystack.includes(term))
        })

    cache.filteredFeedsSource = state.feeds
    cache.filteredFeedsQuery = query
    cache.filteredFeedsUnreadFilter = state.feedUnreadFilter
    cache.filteredFeedsVisibilityFilter = state.feedVisibilityFilter
    cache.filteredFeedsHealthFilter = state.feedHealthFilter
    cache.filteredFeedsStaleFilter = state.feedStaleFilter
    cache.filteredFeedsCategoryFilter = state.feedCategoryFilter
    cache.filteredFeedsShareFilter = state.feedShareFilter
    cache.filteredFeeds = filteredFeeds
    return filteredFeeds
  }

  function normalizeFeedIds(feedIds = []) {
    return [...new Set(feedIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
  }

  function pruneSelectedFeedIds() {
    const state = getState()
    const validIds = new Set(state.feeds.map((feed) => Number(feed.feed_id)))
    state.selectedFeedIds = state.selectedFeedIds.filter((feedId) => validIds.has(Number(feedId)))
  }

  function getVisibleItems() {
    const state = getState()
    if (
      cache.visibleItemsSource === state.items &&
      cache.visibleItemsFilter === state.itemFilter &&
      cache.visibleItemsDeferredSource === state.deferredReadItemIds
    ) {
      return cache.visibleItems
    }

    const deferredReadIds = new Set(state.deferredReadItemIds.map((value) => Number(value)))
    const visibleItems =
      state.itemFilter === "read"
        ? state.items.filter((item) => item.is_read)
        : state.itemFilter === "unread"
          ? state.items.filter((item) => !item.is_read || deferredReadIds.has(Number(item.id)))
          : state.itemFilter === "favorite"
            ? state.items.filter((item) => item.is_favorited)
            : state.items

    cache.visibleItemsSource = state.items
    cache.visibleItemsFilter = state.itemFilter
    cache.visibleItemsDeferredSource = state.deferredReadItemIds
    cache.visibleItems = visibleItems
    return visibleItems
  }

  function retainSelectedInlineItem(items) {
    const state = getState()
    if (!shouldInlineDetail() || !state.selectedItem?.id) return items

    const selectedId = Number(state.selectedItem.id)
    const visibleIndexById = new Map(items.map((item, index) => [Number(item.id), index]))
    if (visibleIndexById.has(selectedId)) return items

    const selectedItem = getItemById(selectedId) || state.selectedItem
    if (!selectedItem) return items

    const sourceItems = state.items.length ? state.items : [selectedItem]
    const selectedIndex = sourceItems.findIndex((item) => Number(item.id) === selectedId)
    if (selectedIndex === -1) {
      return [...items, selectedItem]
    }

    let insertIndex = items.length
    for (let index = selectedIndex + 1; index < sourceItems.length; index += 1) {
      const nextVisibleIndex = visibleIndexById.get(Number(sourceItems[index]?.id))
      if (Number.isInteger(nextVisibleIndex)) {
        insertIndex = nextVisibleIndex
        break
      }
    }

    return [...items.slice(0, insertIndex), selectedItem, ...items.slice(insertIndex)]
  }

  function getFilteredItems() {
    const state = getState()
    const query = state.itemQuery.trim().toLowerCase()
    const items = getVisibleItems()
    const inlineMode = shouldInlineDetail()
    if (
      cache.filteredItemsVisibleSource === items &&
      cache.filteredItemsQuery === query &&
      cache.filteredItemsInlineMode === inlineMode &&
      cache.filteredItemsSelectedSource === state.selectedItem
    ) {
      return cache.filteredItems
    }

    const filtered = !query
      ? items
      : items.filter((item) =>
          getItemSearchText(item).includes(query)
        )
    const filteredItems = retainSelectedInlineItem(filtered)
    cache.filteredItemsVisibleSource = items
    cache.filteredItemsQuery = query
    cache.filteredItemsInlineMode = inlineMode
    cache.filteredItemsSelectedSource = state.selectedItem
    cache.filteredItems = filteredItems
    return filteredItems
  }

  function invalidateItems() {
    cache.filteredItemsVisibleSource = null
    cache.visibleItemsSource = null
    cache.itemIndexSource = null
  }

  function getItemSearchText(item) {
    if (!item || typeof item !== "object") return ""
    const cachedText = cache.itemSearchText.get(item)
    if (cachedText) return cachedText
    const text =
      `${item.title || ""} ${item.feed_title || ""} ${item.feed_translated_title || ""} ${item.summary || ""} ${item.translated_title || ""} ${item.translated_excerpt || ""}`
        .toLowerCase()
    cache.itemSearchText.set(item, text)
    return text
  }

  return {
    getAvailableFeedCategories,
    getCurrentFeed,
    getFeedById,
    getFeedCategory,
    getFeedForItem,
    getFilteredFeeds,
    getFilteredItems,
    getItemById,
    invalidateItems,
    isFeedArchived,
    isFeedCollapsed,
    isFeedNormal,
    normalizeFeedIds,
    pruneSelectedFeedIds
  }
}
