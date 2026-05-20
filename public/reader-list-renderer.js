export function createReaderListRenderer(deps) {
  const {
    els,
    state,
    escapeAttribute,
    escapeHtml,
    getDisplayFeedTitle,
    getFeedDomainShortLabel,
    getFeedDomainTitle,
    getFeedListTitle,
    getFeedMonogram,
    getFilteredFeeds,
    getFilteredItems,
    getItemById,
    pruneSelectedFeedIds,
    renderFeedBulkState,
    renderFeedDrawer,
    renderFeedFilter,
    renderFeedNavigation,
    renderLoadStatus,
    renderScopeButtons,
    renderTranslationMeta,
    scheduleMaybeLoadNextPage,
    shouldInlineDetail,
    updateActionAvailability,
    updateListHeadVisibility,
    virtualItems,
    getPreferredTitle,
    renderExpandedBody,
    renderListRow,
    renderMagazineRow,
    renderTableRow
  } = deps
  const renderCache = {
    feedListHtml: "",
    itemListHtml: ""
  }
  const FEED_RENDER_BATCH_SIZE = 80

  function setHtmlWhenChanged(element, cacheKey, html) {
    if (!element || renderCache[cacheKey] === html) return
    element.innerHTML = html
    renderCache[cacheKey] = html
  }

  function clearHtmlCache(cacheKey) {
    renderCache[cacheKey] = ""
  }

  function setTextWhenChanged(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text
    }
  }

  function getFeedRenderKey(filteredFeeds) {
    return [
      state.feedQuery.trim().toLowerCase(),
      state.feedUnreadFilter,
      state.feedVisibilityFilter,
      state.feedHealthFilter,
      state.feedStaleFilter,
      state.feedCategoryFilter,
      state.feedShareFilter,
      state.feeds.length,
      filteredFeeds.length
    ].join("|")
  }

  function getVisibleFeedCount(filteredFeeds) {
    if (!filteredFeeds.length) {
      state.feedRenderLimit = FEED_RENDER_BATCH_SIZE
      state.feedRenderKey = getFeedRenderKey(filteredFeeds)
      return 0
    }

    const key = getFeedRenderKey(filteredFeeds)
    if (state.feedRenderKey !== key) {
      state.feedRenderKey = key
      state.feedRenderLimit = FEED_RENDER_BATCH_SIZE
    }

    const selectedIndex = filteredFeeds.findIndex((feed) => Number(feed.feed_id) === Number(state.selectedFeedId || 0))
    if (selectedIndex >= Number(state.feedRenderLimit || 0)) {
      state.feedRenderLimit = Math.ceil((selectedIndex + 1) / FEED_RENDER_BATCH_SIZE) * FEED_RENDER_BATCH_SIZE
    }

    const normalizedLimit = Math.max(FEED_RENDER_BATCH_SIZE, Number(state.feedRenderLimit || FEED_RENDER_BATCH_SIZE))
    state.feedRenderLimit = Math.min(filteredFeeds.length, normalizedLimit)
    return state.feedRenderLimit
  }

  function buildItemEmptyStateMarkup() {
    const emptyLabel =
      state.publishedSince
        ? "暂无今日文章"
        : state.itemFilter === "favorite"
          ? "暂无收藏文章"
          : state.itemFilter === "read"
            ? "暂无已读文章"
            : state.itemFilter === "unread"
              ? "暂无未读文章"
              : "暂无文章"
    return `
      <article class="reader-empty-card">
        <strong>${emptyLabel}</strong>
        <span class="muted">先刷新订阅，或切换过滤条件后再试。</span>
      </article>
    `
  }

  function estimateVirtualRowHeight(item = null) {
    const normalizedItemId = Number(item?.id || 0)
    const inlineExpanded =
      shouldInlineDetail() &&
      normalizedItemId > 0 &&
      normalizedItemId === Number(state.selectedItem?.id || 0) &&
      normalizedItemId === Number(state.expandedItemId || 0)

    if (state.viewMode === "magazine") {
      return inlineExpanded ? 360 : 196
    }
    if (state.viewMode === "list") {
      return inlineExpanded ? 336 : 112
    }
    return inlineExpanded ? 272 : 34
  }

  function buildItemRowMarkup(item, inlineMode = shouldInlineDetail()) {
    const isExpanded = state.expandedItemId === item.id
    const isActive = state.selectedItem?.id === item.id
    const showInline = inlineMode && isExpanded && isActive
    let body = ""
    if (state.viewMode === "list") {
      body = renderListRow(item, showInline)
    } else if (state.viewMode === "magazine") {
      body = renderMagazineRow(item, showInline)
    } else {
      body = renderTableRow(item, showInline)
    }

    body = body.replace(
      `data-item-select="${item.id}"`,
      `data-item-select="${item.id}" aria-pressed="${isActive ? "true" : "false"}"`
    )

    return `
      <article
        class="reader-item-row ${item.is_read ? "is-read" : "is-unread"} ${isActive ? "is-active" : ""} ${isExpanded ? "is-open" : ""} ${state.viewMode === "magazine" ? "magazine-row" : ""}"
        data-item-row="${Number(item.id)}"
      >
        ${body}
      </article>
    `
  }

  function findRenderedItemRow(itemId) {
    const normalized = Number(itemId || 0)
    if (!normalized || !els.itemList) return null
    return els.itemList.querySelector(`[data-item-row="${normalized}"]`)
  }

  function setAttributeWhenChanged(element, name, value) {
    if (element && element.getAttribute(name) !== value) {
      element.setAttribute(name, value)
    }
  }

  function patchRenderedItemRow(row, item) {
    if (!row || !item) return

    const isRead = Boolean(item.is_read)
    const isFavorited = Boolean(item.is_favorited)
    const isActive = Number(state.selectedItem?.id || 0) === Number(item.id || 0)
    const isExpanded = Number(state.expandedItemId || 0) === Number(item.id || 0)
    const showInline = shouldInlineDetail() && isActive && isExpanded
    const preview = row.querySelector(".reader-item-preview")

    if (showInline && !preview) {
      const main = row.querySelector(".reader-item-main")
      main?.insertAdjacentHTML?.("afterend", renderExpandedBody(item))
    } else if (!showInline && preview) {
      preview.remove()
    }

    row.classList.toggle("is-read", isRead)
    row.classList.toggle("is-unread", !isRead)
    row.classList.toggle("is-active", isActive)
    row.classList.toggle("is-open", isExpanded)

    const selectButton = row.querySelector("[data-item-select]")
    setAttributeWhenChanged(selectButton, "aria-pressed", isActive ? "true" : "false")

    row.querySelectorAll(".reader-state-dot").forEach((dot) => {
      dot.classList.toggle("is-read", isRead)
      dot.classList.toggle("is-unread", !isRead)
    })

    row.querySelectorAll(".reader-inline-status .sr-only, .cell-status .sr-only").forEach((label) => {
      setTextWhenChanged(label, isRead ? "已读" : "未读")
    })

    row.querySelectorAll("[data-item-read]").forEach((button) => {
      const label = isRead ? "标记未读" : "标记已读"
      const glyph = isRead ? "○" : "✓"
      setAttributeWhenChanged(button, "title", label)
      setAttributeWhenChanged(button, "aria-label", label)
      setTextWhenChanged(button, glyph)
    })

    row.querySelectorAll("[data-item-favorite]").forEach((button) => {
      const label = isFavorited ? "取消收藏" : "收藏"
      setAttributeWhenChanged(button, "title", label)
      setAttributeWhenChanged(button, "aria-label", label)
    })

    if (state.viewMode === "table") {
      const primary = row.querySelector(".reader-title-primary")
      if (primary) setTextWhenChanged(primary, `${isFavorited ? "★ " : ""}${getPreferredTitle(item)}`)
    } else if (state.viewMode === "list") {
      const primary = row.querySelector(".reader-line-top")
      if (primary) setTextWhenChanged(primary, `${isFavorited ? "★ " : ""}${getPreferredTitle(item)}`)
    } else {
      const primary = row.querySelector(".reader-magazine-title")
      if (primary) setTextWhenChanged(primary, `${isFavorited ? "★ " : ""}${getPreferredTitle(item)}`)
    }

    if (preview && showInline) {
      preview.outerHTML = renderExpandedBody(item)
    }
  }

  function refreshRenderedItemRows(itemIds = []) {
    if (!state.me?.user || !els.itemList) {
      renderItems()
      return
    }

    const filteredItems = getFilteredItems()
    if (!filteredItems.length) {
      renderItems()
      return
    }

    if (els.itemList.matches?.('[data-virtualized="true"]')) {
      virtualItems.setItems(filteredItems)
      virtualItems.refreshRows(filteredItems, itemIds, { patchRow: patchRenderedItemRow })
      scheduleMaybeLoadNextPage()
      return
    }

    const normalizedIds = [...new Set((itemIds || []).map((value) => Number(value)).filter((value) => value > 0))]
    if (!normalizedIds.length) return

    updateListHeadVisibility(true)

    const itemById = new Map(filteredItems.map((item) => [Number(item.id || 0), item]))
    for (const itemId of normalizedIds) {
      const existingRow = findRenderedItemRow(itemId)
      if (!existingRow) continue

      const targetItem = itemById.get(itemId)
      if (!targetItem) {
        existingRow.remove()
        continue
      }

      if (patchRenderedItemRow(existingRow, targetItem) === false) {
        existingRow.outerHTML = buildItemRowMarkup(targetItem)
      }
    }

    if (!els.itemList.querySelector("[data-item-row]")) {
      renderItems()
      return
    }

    scheduleMaybeLoadNextPage()
  }

  function renderAccount() {
    const user = state.me?.user
    const translation = state.me?.account?.translation
    state.translation = translation
      ? {
          provider: translation.provider || "google",
          targetLanguage: translation.targetLanguage || "zh-CN",
          targetLabel: translation.targetLabel || "简体中文",
          autoTranslate: Boolean(translation.autoTranslate),
          autoTranslateActive: Boolean(translation.autoTranslateActive),
          autoTranslateSupported: translation.autoTranslateSupported !== false,
          providerConfigured: Boolean(translation.providerConfigured),
          displayTranslated: translation.displayTranslated !== false,
          translationMode: translation.translationMode || "title"
        }
      : {
          provider: "google",
          targetLanguage: "zh-CN",
          targetLabel: "简体中文",
          autoTranslate: false,
          autoTranslateActive: false,
          autoTranslateSupported: false,
          providerConfigured: false,
          displayTranslated: true,
          translationMode: "title"
        }

    renderTranslationMeta()
    if (!user) {
      if (els.userBadge) {
        els.userBadge.classList.add("hidden")
      }
      updateActionAvailability()
      return
    }

    setTextWhenChanged(els.userBadge, user.isAdmin ? "管理员" : "会员")
    const badgeClass = user.isAdmin ? "pill site-user-pill success" : "pill site-user-pill accent"
    if (els.userBadge.className !== badgeClass) {
      els.userBadge.className = badgeClass
    }
    els.userBadge.classList.remove("hidden")
    updateActionAvailability()
  }

  function renderFeeds() {
    pruneSelectedFeedIds()
    const filteredFeeds = getFilteredFeeds()
    const visibleFeedCount = getVisibleFeedCount(filteredFeeds)
    const visibleFeeds = filteredFeeds.slice(0, visibleFeedCount)
    const hasMoreFeeds = visibleFeedCount < filteredFeeds.length
    setTextWhenChanged(
      els.feedCount,
      filteredFeeds.length === state.feeds.length
        ? `(${state.feeds.length} 个${hasMoreFeeds ? ` · 显示 ${visibleFeedCount}` : ""})`
        : `(${filteredFeeds.length}/${state.feeds.length} 个${hasMoreFeeds ? ` · 显示 ${visibleFeedCount}` : ""})`
    )
    renderScopeButtons()
    renderFeedFilter()
    renderFeedBulkState()
    renderFeedDrawer()
    renderFeedNavigation()

    if (!state.me?.user) {
      setHtmlWhenChanged(els.feedList, "feedListHtml", `
        <article class="reader-empty-card">
          <strong>请先登录</strong>
          <span class="muted">登录后即可添加、导入和管理自己的订阅源。</span>
        </article>
      `)
      return
    }

    if (!filteredFeeds.length) {
      setHtmlWhenChanged(els.feedList, "feedListHtml", `
        <article class="reader-empty-card">
          <strong>没有匹配的订阅源</strong>
          <span class="muted">换个关键词，或先添加新的订阅。</span>
        </article>
      `)
    } else {
      setHtmlWhenChanged(
        els.feedList,
        "feedListHtml",
        `${visibleFeeds
          .map(
            (feed) => {
              const displayTitle = typeof getFeedListTitle === "function" ? getFeedListTitle(feed) : getDisplayFeedTitle(feed)
              const fullTitle = getDisplayFeedTitle(feed)
              const domainLabel = typeof getFeedDomainShortLabel === "function" ? getFeedDomainShortLabel(feed) : ""
              const domainTitle = typeof getFeedDomainTitle === "function" ? getFeedDomainTitle(feed) : ""
              const titleLabel = [fullTitle, domainTitle].filter(Boolean).join(" · ")
              return `
              <article class="reader-feed-row ${state.selectedFeedId === feed.feed_id ? "is-active" : ""} ${state.feedBulkMode ? "is-bulk" : ""} ${state.selectedFeedIds.includes(Number(feed.feed_id)) ? "is-checked" : ""}">
                ${
                  state.feedBulkMode
                    ? `
                      <label class="reader-feed-check" aria-label="选择订阅 ${escapeHtml(displayTitle)}">
                        <input type="checkbox" data-feed-check="${feed.feed_id}" ${state.selectedFeedIds.includes(Number(feed.feed_id)) ? "checked" : ""} />
                      </label>
                    `
                    : ""
                }
                <button class="reader-feed-main" type="button" data-feed-select="${feed.feed_id}">
                  <span class="reader-feed-icon">${getFeedMonogram(feed)}</span>
                  <span class="reader-feed-copy">
                    <span class="reader-feed-name" title="${escapeAttribute(titleLabel || feed.title || displayTitle)}">${escapeHtml(displayTitle)}</span>
                    ${
                      domainLabel
                        ? `<span class="reader-feed-domain" title="${escapeAttribute(domainTitle || domainLabel)}">${escapeHtml(domainLabel)}</span>`
                        : ""
                    }
                  </span>
                  <span class="reader-feed-unread-count ${Number(feed.unread_count || 0) > 0 ? "has-unread" : ""}">${Number(feed.unread_count || 0)}</span>
                </button>
              </article>
            `
            }
          )
          .join("")}${
          hasMoreFeeds
            ? `
              <button class="reader-feed-load-more" type="button" data-feed-load-more>
                已显示 ${visibleFeedCount} / ${filteredFeeds.length} · 加载更多
              </button>
            `
            : ""
        }`
      )
    }
  }

  function refreshRenderedFeedRows(feedIds = []) {
    if (!els.feedList) return
    const normalizedIds = [...new Set((feedIds || []).map((value) => Number(value)).filter((value) => value > 0))]
    if (!normalizedIds.length) return

    const feedById = new Map(state.feeds.map((feed) => [Number(feed.feed_id || 0), feed]))
    for (const feedId of normalizedIds) {
      const feed = feedById.get(feedId)
      const button = els.feedList.querySelector(`[data-feed-select="${feedId}"]`)
      const row = button?.closest(".reader-feed-row")
      if (!row || !feed) continue

      row.classList.toggle("is-active", Number(state.selectedFeedId || 0) === feedId)
      row.classList.toggle("is-bulk", Boolean(state.feedBulkMode))
      row.classList.toggle("is-checked", state.selectedFeedIds.includes(feedId))

      const checkbox = row.querySelector(`[data-feed-check="${feedId}"]`)
      if (checkbox && checkbox.checked !== state.selectedFeedIds.includes(feedId)) {
        checkbox.checked = state.selectedFeedIds.includes(feedId)
      }

      const unreadCount = Number(feed.unread_count || 0)
      const unreadBadge = row.querySelector(".reader-feed-unread-count")
      if (unreadBadge) {
        setTextWhenChanged(unreadBadge, String(unreadCount))
        unreadBadge.classList.toggle("has-unread", unreadCount > 0)
      }

      const displayTitle = typeof getFeedListTitle === "function" ? getFeedListTitle(feed) : getDisplayFeedTitle(feed)
      const fullTitle = getDisplayFeedTitle(feed)
      const domainLabel = typeof getFeedDomainShortLabel === "function" ? getFeedDomainShortLabel(feed) : ""
      const domainTitle = typeof getFeedDomainTitle === "function" ? getFeedDomainTitle(feed) : ""
      const titleLabel = [fullTitle, domainTitle].filter(Boolean).join(" · ")
      const name = row.querySelector(".reader-feed-name")
      if (name) {
        setTextWhenChanged(name, displayTitle)
        name.setAttribute("title", titleLabel || feed.title || displayTitle)
      }
      const domain = row.querySelector(".reader-feed-domain")
      if (domain) {
        setTextWhenChanged(domain, domainLabel)
        domain.setAttribute("title", domainTitle || domainLabel)
      }
    }
  }

  function renderItems() {
    renderLoadStatus()

    if (!state.me?.user) {
      updateActionAvailability({ filteredCount: 0 })
      virtualItems.clearShell()
      updateListHeadVisibility(false)
      setHtmlWhenChanged(els.itemList, "itemListHtml", `
        <article class="reader-empty-card">
          <strong>请先登录</strong>
          <span class="muted">登录后即可查看自己的文章列表。</span>
        </article>
      `)
      return
    }

    const filteredItems = getFilteredItems()
    updateActionAvailability({ filteredCount: filteredItems.length })
    virtualItems.setItems(filteredItems)
    if (!filteredItems.length) {
      virtualItems.clearShell()
      updateListHeadVisibility(false)
      setHtmlWhenChanged(els.itemList, "itemListHtml", buildItemEmptyStateMarkup())
      scheduleMaybeLoadNextPage()
      return
    }

    updateListHeadVisibility(true)
    clearHtmlCache("itemListHtml")
    virtualItems.render(filteredItems, { force: true })
    scheduleMaybeLoadNextPage()
  }

  function findRenderedItem(itemId) {
    const normalizedItemId = Number(itemId || 0)
    if (!normalizedItemId) return null
    return Number(state.selectedItem?.id || 0) === normalizedItemId ? state.selectedItem : getItemById(normalizedItemId)
  }

  return {
    buildItemRowMarkup,
    estimateVirtualRowHeight,
    findRenderedItem,
    refreshRenderedItemRows,
    refreshRenderedFeedRows,
    renderAccount,
    renderFeeds,
    renderItems
  }
}
