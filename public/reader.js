import { createReaderApi } from "./reader-api.js"
import { createReaderController } from "./reader-controller.js"
import {
  buildTranslatedExcerpt,
  createReaderTemplates,
  escapeAttribute,
  escapeHtml,
  formatDate,
  getDomain,
  getDisplayFeedTitle,
  getDisplayItemFeedTitle,
  getFeedMonogram,
  getItemBodyHtml,
  getItemPageHtml,
  renderPlainText,
  renderRichFallback,
  safeUrl
} from "./reader-view.js"
import {
  COLUMN_WIDTHS_KEY,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_TABLE_COLUMNS,
  FEED_CATEGORY_FILTER_KEY,
  FEED_HEALTH_FILTER_KEY,
  FEED_SHARE_FILTER_KEY,
  FEED_STALE_FILTER_KEY,
  FEED_UNREAD_FILTER_KEY,
  FEED_VISIBILITY_FILTER_KEY,
  GLYPHS,
  ITEM_FILTER_KEY,
  ITEM_QUERY_KEY,
  LAYOUT_MODE_KEY,
  TABLE_COLUMNS_KEY,
  VIEW_KEY,
  normalizeFeedCategoryFilter,
  normalizeFeedHealthFilter,
  normalizeFeedShareFilter,
  normalizeFeedStaleFilter,
  normalizeFeedUnreadFilter,
  normalizeFeedVisibilityFilter,
  normalizeItemFilter,
  state
} from "./reader-state.js"
import { createReaderCollapsibleBody } from "./reader-collapsible-body.js"
import { createReaderArticleDetail } from "./reader-article-detail.js"
import { createReaderDerivedData } from "./reader-derived-data.js"
import { createReaderFeedControls } from "./reader-feed-controls.js"
import { createReaderFeedSettings } from "./reader-feed-settings.js"
import { createReaderItemTools } from "./reader-item-tools.js"
import { createReaderVirtualList } from "./reader-virtual-list.js"
import { getReaderElements } from "./reader-elements.js"
import { createReaderDetailSections } from "./reader-detail-sections.js"
import { registerReaderEvents } from "./reader-events.js"
import { createReaderUiState } from "./reader-ui-state.js"
import { createReaderListRenderer } from "./reader-list-renderer.js"
import { createReaderMenus } from "./reader-menus.js"
import { createReaderFeedActions } from "./reader-feed-actions.js"
import { getProviderTargetCode, getTranslationProviderLabel } from "./translation-options.js"
const compactMedia = window.matchMedia("(max-width: 900px)")
const LOAD_MORE_EDGE_OFFSET = 280
let loadMoreFrame = null
const readerApi = createReaderApi()

const els = getReaderElements()

const {
  closeManagedMenus,
  closeMarkReadMenus,
  closeToolbarMenu,
  managedMenus,
  toggleToolbarMenu
} = createReaderMenus(els)

const derivedData = createReaderDerivedData({
  getDisplayFeedTitle,
  getState: () => state,
  shouldInlineDetail: () => shouldInlineDetail()
})

const {
  getAvailableFeedCategories,
  getCurrentFeed,
  getFeedById,
  getFeedCategory,
  getFeedForItem,
  getFilteredFeeds,
  getFilteredItems,
  getItemById,
  isFeedArchived,
  isFeedCollapsed,
  isFeedNormal,
  normalizeFeedIds,
  pruneSelectedFeedIds
} = derivedData

const feedControls = createReaderFeedControls({
  els,
  escapeAttribute,
  escapeHtml,
  feedCategoryFilterKey: FEED_CATEGORY_FILTER_KEY,
  getAvailableFeedCategories,
  getCurrentFeed,
  getDisplayFeedTitle,
  getFeedById,
  getFilteredFeeds,
  glyphs: GLYPHS,
  isFeedNormal,
  normalizeFeedIds,
  pruneSelectedFeedIds,
  refreshRenderedFeedRows: (feedIds) => refreshRenderedFeedRows(feedIds),
  renderFeeds: () => renderFeeds(),
  setGlyphButton: (button, glyph, label) => setGlyphButton(button, glyph, label),
  shouldUseFeedDrawer: () => shouldUseFeedDrawer(),
  state
})

const {
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
} = feedControls

const readerUiState = createReaderUiState({
  compactMedia,
  defaultColumnWidths: DEFAULT_COLUMN_WIDTHS,
  defaultTableColumns: DEFAULT_TABLE_COLUMNS,
  els,
  feedUnreadFilterKey: FEED_UNREAD_FILTER_KEY,
  itemFilterKey: ITEM_FILTER_KEY,
  normalizeFeedUnreadFilter,
  normalizeItemFilter,
  readerApi,
  state,
  closeToolbarMenu: (menu) => closeToolbarMenu(menu),
  getCurrentAccount: () => getCurrentAccount(),
  getFilteredItems: () => getFilteredItems(),
  renderComposeState: () => renderComposeState(),
  renderFeedBulkState: () => renderFeedBulkState(),
  renderFeedDrawer: () => renderFeedDrawer(),
  shouldInlineDetail: () => shouldInlineDetail()
})

const {
  applyLayoutWidths,
  applySavedReaderPreferences,
  applyTableColumns,
  renderFilterMode,
  renderLayoutMode,
  renderLoadStatus,
  renderSearchState,
  renderViewMode,
  resetContentPaneScroll,
  scheduleDebouncedRender,
  scheduleReaderPreferenceSave,
  setStatus,
  showFlash,
  updateActionAvailability,
  updateListHeadVisibility
} = readerUiState

const feedSettings = createReaderFeedSettings({
  els,
  getFeedById,
  setStatus,
  state
})

const {
  closeModal: closeFeedSettingsModal,
  openModal: openFeedSettingsModal,
  parseBooleanSelect,
  parseNullableBooleanSelect,
  resetForm: resetFeedSettingsForm
} = feedSettings

const virtualItems = createReaderVirtualList({
  getContainer: () => els.itemList,
  getLayoutKey: () => `${state.viewMode}:${shouldInlineDetail() ? "inline" : "split"}`,
  getMetricsKey: (items = []) =>
    [
      state.viewMode,
      shouldInlineDetail() ? "inline" : "split",
      state.itemFilter,
      state.itemQuery.trim().toLowerCase(),
      state.publishedSince || "",
      Number(state.selectedFeedId || 0),
      Number(state.selectedItem?.id || 0),
      Number(state.expandedItemId || 0),
      items.length,
      Number(items[0]?.id || 0),
      Number(items[items.length - 1]?.id || 0)
    ].join(":"),
  getRangeKey: (range) =>
    `${range.start}:${range.end}:${state.viewMode}:${shouldInlineDetail() ? "inline" : "split"}`,
  estimateRowHeight: estimateVirtualRowHeight,
  renderRow: (item) => buildItemRowMarkup(item, shouldInlineDetail())
})

const collapsibleBody = createReaderCollapsibleBody({
  getExpandedItemIds: () => state.expandedBodyItemIds,
  setExpandedItemIds: (itemIds) => {
    state.expandedBodyItemIds = itemIds
  },
  onToggle: (itemId) => refreshRenderedItemRows([itemId]),
  renderArticle: () => renderArticle(),
  shouldInlineDetail: () => shouldInlineDetail()
})

const itemTools = createReaderItemTools({
  buildTranslatedExcerpt,
  getCurrentFeed: () => getCurrentFeed(),
  getDomain,
  getEffectiveTranslationForFeed: (feed) => getEffectiveTranslationForFeed(feed),
  getEffectiveTranslationForItem: (item) => getEffectiveTranslationForItem(item),
  getFeedForItem: (item) => getFeedForItem(item),
  getProviderTargetCode,
  getSelectedItem: () => state.selectedItem,
  glyphs: GLYPHS,
  safeUrl,
  setStatus
})

const {
  copyItemLink,
  copyItemTitle,
  extractDisplayText,
  getItemSiteUrl,
  getLanguageGlyphFromSetting,
  getOriginalTitle,
  getPreferredSummary,
  getPreferredTitle,
  getSecondaryTitle,
  getTargetLanguageGlyph,
  getTranslatedBody,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getUsableSummary,
  hasStoredTranslation,
  openArticleSearch,
  openExternalTranslate,
  openItemInBrowser,
  openItemSite,
  shouldDisplayStoredTranslation
} = itemTools

const articleDetail = createReaderArticleDetail({
  compactMedia,
  els,
  escapeHtml,
  extractDisplayText,
  formatDate,
  getCurrentAccount: () => getCurrentAccount(),
  getCurrentFeed: () => getCurrentFeed(),
  getDisplayItemFeedTitle,
  getDomain,
  getEffectiveTranslationForFeed: (feed) => getEffectiveTranslationForFeed(feed),
  getEffectiveTranslationForItem: (item) => getEffectiveTranslationForItem(item),
  getItemBodyHtml,
  getItemPageHtml,
  getLanguageGlyphFromSetting,
  getPreferredTitle,
  getTranslatedBody,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getTranslationProviderLabel,
  getUsableSummary,
  glyphs: GLYPHS,
  renderCollapsibleBody: (itemId, contentHtml, sourceText, options) => renderCollapsibleBody(itemId, contentHtml, sourceText, options),
  renderPlainText,
  renderRichFallback,
  safeUrl,
  setGlyphButton,
  shouldDisplayStoredTranslation,
  state,
  ensurePageLoaded: (itemId) => ensurePageLoaded(itemId)
})

const {
  getActiveDetailView,
  renderActionErrorBox,
  renderArticle,
  renderDetailView,
  renderTranslationMeta
} = articleDetail

function getCurrentAccount() {
  return state.me?.account || null
}

function getEffectiveTranslationForFeed(feed = null) {
  const base = state.translation || {
    provider: "google",
    targetLanguage: "zh-CN",
    targetLabel: "简体中文",
    autoTranslate: false,
    autoTranslateActive: false,
    autoTranslateSupported: false,
    providerConfigured: false,
    displayTranslated: true,
    translationMode: "full"
  }

  if (!feed?.translation) {
    return base
  }

  return {
    provider: feed.translation.provider || base.provider,
    targetLanguage: feed.translation.targetLanguage || base.targetLanguage,
    targetLabel: feed.translation.targetLabel || base.targetLabel,
    autoTranslate: feed.translation.autoTranslate ?? base.autoTranslate,
    autoTranslateActive: feed.translation.autoTranslateActive ?? base.autoTranslateActive ?? false,
    autoTranslateSupported: feed.translation.autoTranslateSupported ?? base.autoTranslateSupported ?? false,
    providerConfigured: feed.translation.providerConfigured ?? base.providerConfigured ?? false,
    displayTranslated: feed.translation.displayTranslated ?? base.displayTranslated,
    translationMode: feed.translation.translationMode || base.translationMode || "full"
  }
}

function getEffectiveTranslationForItem(item = state.selectedItem) {
  return getEffectiveTranslationForFeed(getFeedForItem(item))
}

function getTodayStartIso() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

function resetScopeCounts() {
  state.scopeCounts = {
    all: 0,
    today: 0,
    favorite: 0,
    unread: 0
  }
}

function shouldInlineDetail() {
  return compactMedia.matches || state.layoutMode === "inline"
}

function shouldUseFeedDrawer() {
  return compactMedia.matches
}

function setGlyphButton(button, glyph, label) {
  if (!button) return
  if (button.textContent !== glyph) {
    button.textContent = glyph
  }
  if (button.title !== label) {
    button.title = label
  }
  if (button.getAttribute("aria-label") !== label) {
    button.setAttribute("aria-label", label)
  }
}

let listRenderer = null

function estimateVirtualRowHeight(item = null) {
  return listRenderer?.estimateVirtualRowHeight(item) || 96
}

function buildItemRowMarkup(item, inlineMode = shouldInlineDetail()) {
  return listRenderer?.buildItemRowMarkup(item, inlineMode) || ""
}

function refreshRenderedItemRows(itemIds = []) {
  listRenderer?.refreshRenderedItemRows(itemIds)
}

function refreshRenderedFeedRows(feedIds = []) {
  listRenderer?.refreshRenderedFeedRows(feedIds)
}

function syncItemToList(itemId, patch) {
  state.items = state.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
  derivedData.invalidateItems()
}

function syncManyItemsToList(itemIds, patch) {
  const idSet = new Set(itemIds)
  state.items = state.items.map((item) => (idSet.has(item.id) ? { ...item, ...patch } : item))
  derivedData.invalidateItems()
}

function canScheduleLoadNextPage({ checkGeometry = false } = {}) {
  if (!state.me?.user || state.loadingItems || state.loadingNextPage || state.itemPage >= state.itemPageCount) {
    return false
  }

  if (!checkGeometry) return true

  const container = els.itemList
  if (!container) return false
  if (compactMedia.matches) {
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0
    const listRect = container.getBoundingClientRect()
    if ((window.scrollY || window.pageYOffset || 0) <= 0) return false
    return listRect.bottom - viewportBottom <= LOAD_MORE_EDGE_OFFSET
  }

  if (container.scrollTop <= 0) return false
  return container.scrollTop + container.clientHeight >= container.scrollHeight - LOAD_MORE_EDGE_OFFSET
}

function scheduleMaybeLoadNextPage() {
  if (!canScheduleLoadNextPage()) return
  if (loadMoreFrame) return
  loadMoreFrame = window.requestAnimationFrame(() => {
    loadMoreFrame = null
    if (!canScheduleLoadNextPage({ checkGeometry: true })) return
    void maybeLoadNextPage()
  })
}

function rememberDeferredReadItem(itemId) {
  const normalized = Number(itemId)
  if (state.itemFilter !== "unread" || !Number.isInteger(normalized) || normalized <= 0) return
  if (state.deferredReadItemIds.includes(normalized)) return
  state.deferredReadItemIds = [...state.deferredReadItemIds, normalized]
}

function removeDeferredReadItem(itemId) {
  const normalized = Number(itemId)
  if (!Number.isInteger(normalized) || normalized <= 0) return
  state.deferredReadItemIds = state.deferredReadItemIds.filter((value) => Number(value) !== normalized)
}

function clearDeferredReadItems() {
  if (!state.deferredReadItemIds.length) return
  state.deferredReadItemIds = []
}

function resetLoadedItems() {
  clearDeferredReadItems()
  state.expandedBodyItemIds = []
  state.items = []
  state.itemPage = 1
  state.itemPageCount = 1
  state.itemTotal = 0
  virtualItems.reset({ clearHeights: true })
  virtualItems.setItems([])
}

function applySelectedItem(nextItem) {
  if (!nextItem) {
    state.selectedItem = null
    return
  }

  const previous = state.selectedItem
  if (previous?.id === nextItem.id) {
    const hasNextContentHtml = Object.prototype.hasOwnProperty.call(nextItem, "content_html")
    const hasNextContentText = Object.prototype.hasOwnProperty.call(nextItem, "content_text")
    const hasNextContentExcerpt = Object.prototype.hasOwnProperty.call(nextItem, "content_excerpt")
    const hasNextPageHtml = Object.prototype.hasOwnProperty.call(nextItem, "page_html")
    const hasNextPageText = Object.prototype.hasOwnProperty.call(nextItem, "page_text")
    state.selectedItem = {
      ...nextItem,
      content_html: hasNextContentHtml ? nextItem.content_html : previous.content_html,
      content_text: hasNextContentText ? nextItem.content_text : previous.content_text,
      content_excerpt: hasNextContentExcerpt ? nextItem.content_excerpt : previous.content_excerpt,
      content_loaded: nextItem.content_loaded || previous.content_loaded,
      fetch_error: nextItem.fetch_error || previous.fetch_error || null,
      page_html: hasNextPageHtml ? nextItem.page_html : previous.page_html,
      page_text: hasNextPageText ? nextItem.page_text : previous.page_text,
      page_loaded: nextItem.page_loaded || previous.page_loaded,
      page_fetch_error: nextItem.page_fetch_error || previous.page_fetch_error || null,
      original_url: nextItem.original_url || previous.original_url || "",
      original_title: nextItem.original_title || previous.original_title || "",
      translated_title: nextItem.translated_title || previous.translated_title || "",
      translated_text: nextItem.translated_text || previous.translated_text || "",
      translate_error: Object.prototype.hasOwnProperty.call(nextItem, "translate_error")
        ? nextItem.translate_error
        : previous.translate_error || null,
      summary_error: Object.prototype.hasOwnProperty.call(nextItem, "summary_error")
        ? nextItem.summary_error
        : previous.summary_error || null
    }
  } else {
    state.selectedItem = nextItem
  }
}

function setItemOperationState(itemId, patch = {}) {
  if (!itemId || !patch || typeof patch !== "object") return
  syncItemToList(itemId, patch)
  if (state.selectedItem?.id === itemId) {
    applySelectedItem({
      ...state.selectedItem,
      ...patch
    })
  }
}

function toggleBodyExpanded(itemId) {
  collapsibleBody.toggle(itemId)
}

function renderCollapsibleBody(itemId, contentHtml, sourceText, options = {}) {
  return collapsibleBody.render(itemId, contentHtml, sourceText, options)
}

const detailSections = createReaderDetailSections({
  escapeAttribute,
  escapeHtml,
  getActiveDetailView,
  getCurrentAccount: () => getCurrentAccount(),
  getEffectiveTranslationForItem: (item) => getEffectiveTranslationForItem(item),
  getItemBodyHtml,
  getTranslatedBody,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getUsableSummary,
  glyphs: GLYPHS,
  renderActionErrorBox,
  renderCollapsibleBody: (itemId, contentHtml, sourceText, options) => renderCollapsibleBody(itemId, contentHtml, sourceText, options),
  renderPlainText,
  renderRichFallback,
  shouldDisplayStoredTranslation,
  state
})

const { buildDetailSections } = detailSections

const {
  buildFeatureFlags,
  buildFeedBadges,
  buildFeedError,
  buildFeedMeta,
  renderExpandedBody,
  renderListRow,
  renderMagazineRow,
  renderTableRow
} = createReaderTemplates({
  buildDetailSections,
  getFeedCategory,
  getPreferredTitle,
  getPreferredSummary,
  getSecondaryTitle,
  resolveExpandedItem: (item) => (state.selectedItem?.id === item.id ? state.selectedItem : item),
  isFeedArchived,
  isFeedCollapsed
})

listRenderer = createReaderListRenderer({
  els,
  state,
  escapeAttribute,
  escapeHtml,
  getDisplayFeedTitle,
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
})

const {
  findRenderedItem,
  renderAccount,
  renderFeeds,
  renderItems
} = listRenderer

function renderOperationSummary() {
  els.syncSummary.classList.add("hidden")
  els.syncSummary.innerHTML = ""
  if (!state.lastOperation) return

  const { type, result } = state.lastOperation
  let message = ""
  let tone = "success"

  if (type === "import") {
    message = `导入完成 · 成功 ${result.imported} · 跳过 ${result.skipped} · 失败 ${result.failed}`
  } else if (type === "refreshAll") {
    const successCount = result.filter((entry) => entry.ok).length
    message = `全部刷新完成 · 订阅源 ${result.length} · 成功 ${successCount} · 失败 ${result.length - successCount}`
  } else if (type === "refreshFeed") {
    const unreadPart = Number.isFinite(Number(result.unreadCount)) ? ` · 未读 ${Number(result.unreadCount)}` : ""
    const fetchedPart = Number(result.fetched || 0) > Number(result.inserted || 0) ? ` · 拉取 ${Number(result.fetched || 0)}` : ""
    message = `${getDisplayFeedTitle(result.feed || {}) || "订阅已刷新"} · 新增 ${Number(result.inserted || 0)}${unreadPart}${fetchedPart} · 清理 ${result.removed || 0}`
  } else if (type === "addFeed") {
    message = result.warning
      ? `订阅已添加 · ${result.warning}`
      : `${getDisplayFeedTitle(result.feed || {}) || result.feed?.url || "新订阅"} · 已添加`
    tone = result.warning ? "warning" : "success"
  }

  if (message) {
    els.statusText.textContent = message
    showFlash(message, tone)
  }
  state.lastOperation = null
}

async function toggleDetailView(view) {
  if (!state.selectedItem) return

  const nextView = getActiveDetailView() === view ? "none" : view
  if (nextView === "summary" && !state.selectedItem.ai_summary) {
    await summarizeItem(state.selectedItem.id)
  }
  if (nextView === "translation" && !hasStoredTranslation(state.selectedItem)) {
    const result = await translateItem(state.selectedItem.id)
    if (result?.skipped) {
      state.detailView = "none"
      refreshRenderedItemRows([state.selectedItem.id])
      renderArticle()
      return
    }
  }
  if (nextView === "page") {
    await ensurePageLoaded(state.selectedItem.id)
  }

  state.detailView = nextView
  if (shouldInlineDetail()) {
    refreshRenderedItemRows([state.selectedItem.id])
  }
  renderArticle()
}

function toggleContentColumn() {
  if (compactMedia.matches) return
  state.layoutMode = shouldInlineDetail() ? "split" : "inline"
  window.localStorage.setItem(LAYOUT_MODE_KEY, state.layoutMode)
  renderLayoutMode()
  renderItems()
  renderArticle()
}

const readerController = createReaderController({
  els,
  state,
  readerApi,
  applySelectedItem,
  buildTranslatedExcerpt,
  closeFeedSettingsModal,
  closeMarkReadMenus,
  findRenderedItem,
  getFeedById,
  getEffectiveTranslationForItem,
  getFilteredItems,
  getDisplayFeedTitle,
  getTodayStartIso,
  hasStoredTranslation,
  isFeedNormal,
  normalizeFeedIds,
  openExternalTranslate,
  parseBooleanSelect,
  parseNullableBooleanSelect,
  pruneSelectedFeedIds,
  renderAccount,
  renderArticle,
  renderComposeState,
  renderFeedDrawer,
  renderFeedFilter,
  renderFeedNavigation,
  renderFilterMode,
  renderFeeds,
  renderItems,
  refreshRenderedItemRows,
  refreshRenderedFeedRows,
  renderLoadStatus,
  renderOperationSummary,
  renderPager,
  renderScopeButtons,
  resetContentPaneScroll,
  clearDeferredReadItems,
  applySavedReaderPreferences,
  rememberDeferredReadItem,
  removeDeferredReadItem,
  resetLoadedItems,
  resetImportComposer,
  resetScopeCounts,
  scheduleMaybeLoadNextPage,
  setItemOperationState,
  setStatus,
  shouldInlineDetail,
  syncItemToList,
  syncManyItemsToList,
  updateActionAvailability
})

const {
  addFeed,
  deleteSelectedFeeds,
  ensureContentLoaded,
  ensurePageLoaded,
  importFeeds,
  loadFeeds,
  loadItems,
  loadMe,
  markItemsRead,
  maybeLoadNextPage,
  openItem,
  prefetchItemsPage,
  refreshAllFeeds,
  refreshCurrentView,
  refreshSelectedFeeds,
  shareSelectedFeeds,
  saveFeedSettings,
  selectFeed,
  setFavoriteState,
  setReadState,
  summarizeItem,
  toggleItem,
  translateItem
} = readerController

const {
  exportFeeds,
  navigateFeed,
  prefetchNavigationTargets,
  renameSelectedFeeds,
  selectQuickScope,
  toggleFeedBulkMode
} = createReaderFeedActions({
  state,
  readerApi,
  closeFeedDrawer,
  getFeedNavigationTargets,
  getTodayStartIso,
  loadItems,
  normalizeFeedIds,
  openFeedSettingsModal,
  prefetchItemsPage,
  renderArticle,
  renderFeedBulkState,
  renderFeeds,
  refreshRenderedFeedRows,
  renderFilterMode,
  renderItems,
  resetLoadedItems,
  selectFeed,
  setStatus
})

async function handleFeedListClick(event) {
  if (!(event.target instanceof Element)) return
  const loadMoreButton = event.target.closest("[data-feed-load-more]")
  if (loadMoreButton && els.feedList?.contains(loadMoreButton)) {
    state.feedRenderLimit = Number(state.feedRenderLimit || 80) + 80
    renderFeeds()
    return
  }

  const selectButton = event.target.closest("[data-feed-select]")
  if (!selectButton || !els.feedList?.contains(selectButton)) return

  const feedId = Number(selectButton.dataset.feedSelect)
  if (!Number.isInteger(feedId) || feedId < 1) return

  closeFeedDrawer()
  await selectFeed(feedId, { smooth: true })
}

function handleFeedListPointerOver(event) {
  if (!(event.target instanceof Element)) return
  const selectButton = event.target.closest("[data-feed-select]")
  if (!selectButton || !els.feedList?.contains(selectButton)) return

  const feedId = Number(selectButton.dataset.feedSelect)
  if (!Number.isInteger(feedId) || feedId < 1 || feedId === Number(state.selectedFeedId || 0)) return
  void prefetchItemsPage(feedId, 1)
}

function handleFeedListChange(event) {
  if (!(event.target instanceof Element)) return
  const checkbox = event.target.closest("[data-feed-check]")
  if (!checkbox || !els.feedList?.contains(checkbox)) return

  const feedId = Number(checkbox.dataset.feedCheck)
  if (!Number.isInteger(feedId) || feedId < 1) return
  setFeedSelection(feedId, Boolean(checkbox.checked))
}

async function handleItemListClick(event) {
  if (!(event.target instanceof Element)) return
  const target = event.target

  const selectButton = target.closest("[data-item-select]")
  if (selectButton && els.itemList?.contains(selectButton)) {
    const itemId = Number(selectButton.dataset.itemSelect)
    if (Number.isInteger(itemId) && itemId > 0) {
      await toggleItem(itemId)
    }
    return
  }

  const actionButton = target.closest(
    [
      "[data-item-ai-summary]",
      "[data-item-ai-translate]",
      "[data-item-favorite]",
      "[data-item-read]",
      "[data-item-browser]",
      "[data-item-page]",
      "[data-item-original]",
      "[data-item-load-content]"
    ].join(",")
  )
  if (!actionButton || !els.itemList?.contains(actionButton)) return

  const itemId = Number(
    actionButton.dataset.itemAiSummary ||
      actionButton.dataset.itemAiTranslate ||
      actionButton.dataset.itemFavorite ||
      actionButton.dataset.itemRead ||
      actionButton.dataset.itemBrowser ||
      actionButton.dataset.itemPage ||
      actionButton.dataset.itemOriginal ||
      actionButton.dataset.itemLoadContent
  )
  if (!Number.isInteger(itemId) || itemId < 1) return

  const item = getItemById(itemId) || (state.selectedItem?.id === itemId ? state.selectedItem : null)

  if (actionButton.matches("[data-item-browser]")) {
    openItemInBrowser(item)
    return
  }
  if (actionButton.matches("[data-item-favorite]")) {
    await setFavoriteState(itemId, !Boolean(item?.is_favorited))
    return
  }
  if (actionButton.matches("[data-item-read]")) {
    await setReadState(itemId, !Boolean(item?.is_read))
    return
  }

  if (state.selectedItem?.id !== itemId) {
    await openItem(itemId)
  }

  if (actionButton.matches("[data-item-ai-summary]")) {
    await toggleDetailView("summary")
  } else if (actionButton.matches("[data-item-ai-translate]")) {
    await toggleDetailView("translation")
  } else if (actionButton.matches("[data-item-page]")) {
    await toggleDetailView("page")
  } else if (actionButton.matches("[data-item-original]")) {
    await toggleDetailView("original")
  } else if (actionButton.matches("[data-item-load-content]")) {
    await ensureContentLoaded(itemId, { showLoadingState: true })
  }
}

async function boot() {
  window.localStorage.removeItem(COLUMN_WIDTHS_KEY)
  window.localStorage.removeItem(TABLE_COLUMNS_KEY)
  applyLayoutWidths()
  applyTableColumns()
  renderSearchState()
  renderComposeState()
  renderLayoutMode()
  renderFeedDrawer()
  renderViewMode()
  renderFilterMode()
  renderScopeButtons()
  renderFeedBulkState()
  renderFeedFilter()
  renderPager()
  renderTranslationMeta()
  await loadMe()
  await loadFeeds()
  if (state.me?.user) {
    await loadItems()
    prefetchNavigationTargets()
  } else {
    renderItems()
    renderArticle()
  }
  renderOperationSummary()
}

registerReaderEvents({
  els,
  state,
  compactMedia,
  virtualItems,
  keys: {
    FEED_CATEGORY_FILTER_KEY,
    FEED_HEALTH_FILTER_KEY,
    FEED_SHARE_FILTER_KEY,
    FEED_STALE_FILTER_KEY,
    FEED_VISIBILITY_FILTER_KEY,
    ITEM_QUERY_KEY,
    VIEW_KEY
  },
  normalizers: {
    normalizeFeedCategoryFilter,
    normalizeFeedHealthFilter,
    normalizeFeedShareFilter,
    normalizeFeedStaleFilter,
    normalizeFeedUnreadFilter,
    normalizeFeedVisibilityFilter
  },
  actions: {
    addFeed,
    copyItemLink,
    copyItemTitle,
    deleteSelectedFeeds,
    ensureContentLoaded,
    exportFeeds,
    handleFeedListChange,
    handleFeedListClick,
    handleFeedListPointerOver,
    handleItemListClick,
    importFeeds,
    loadItems,
    markItemsRead,
    navigateFeed,
    openItemInBrowser,
    refreshAllFeeds,
    refreshCurrentView,
    refreshSelectedFeeds,
    renameSelectedFeeds,
    resetFeedSettingsForm,
    resetLoadedItems,
    saveFeedSettings,
    scheduleDebouncedRender,
    scheduleMaybeLoadNextPage,
    scheduleReaderPreferenceSave,
    selectQuickScope,
    setFavoriteState,
    setReadState,
    setStatus,
    shareSelectedFeeds,
    toggleAllVisibleFeeds,
    toggleBodyExpanded,
    toggleContentColumn,
    toggleDetailView,
    toggleFeedBulkMode
  },
  menus: {
    closeFeedDrawer,
    closeFeedSettingsModal,
    closeManagedMenus,
    closeToolbarMenu,
    managedMenus,
    toggleFeedDrawer,
    toggleToolbarMenu
  },
  renderers: {
    renderArticle,
    renderComposeState,
    renderFeedDrawer,
    renderFeeds,
    renderFilterMode,
    renderItems,
    renderLayoutMode,
    renderScopeButtons,
    renderSearchState,
    renderViewMode
  }
})

boot().catch((error) => {
  setStatus(error.message, "error")
})
