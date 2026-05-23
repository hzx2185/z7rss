import { createReaderApi } from "./reader-api.js?v=30"
import { createReaderController } from "./reader-controller.js?v=30"
import {
  buildTranslatedExcerpt,
  createReaderTemplates,
  escapeAttribute,
  escapeHtml,
  formatDate,
  getDomain,
  getDomainSearchTerms,
  getDisplayFeedTitle,
  getDisplayItemFeedTitle,
  getFeedDomainSearchText,
  getFeedDomainShortLabel,
  getFeedDomainTitle,
  getFeedListTitle,
  getFeedMonogram,
  getItemBodyHtml,
  getItemPageHtml,
  renderPlainText,
  renderRichFallback,
  safeUrl
} from "./reader-view.js?v=30"
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
} from "./reader-state.js?v=30"
import { createReaderCollapsibleBody } from "./reader-collapsible-body.js?v=30"
import { createReaderArticleDetail } from "./reader-article-detail.js?v=30"
import { createReaderDerivedData } from "./reader-derived-data.js?v=30"
import { createReaderFeedControls } from "./reader-feed-controls.js?v=30"
import { createReaderFeedSettings } from "./reader-feed-settings.js?v=30"
import { createReaderItemTools } from "./reader-item-tools.js?v=30"
import { createReaderVirtualList } from "./reader-virtual-list.js?v=30"
import { getReaderElements } from "./reader-elements.js?v=30"
import { createReaderDetailSections } from "./reader-detail-sections.js?v=30"
import { registerReaderEvents } from "./reader-events.js?v=30"
import { createReaderUiState } from "./reader-ui-state.js?v=30"
import { createReaderListRenderer } from "./reader-list-renderer.js?v=30"
import { createReaderMenus } from "./reader-menus.js?v=30"
import { createReaderFeedActions } from "./reader-feed-actions.js?v=30"
import { getProviderTargetCode, getTranslationProviderLabel } from "./translation-options.js?v=30"
const compactMedia = window.matchMedia("(max-width: 900px)")
const coarsePointerMedia = window.matchMedia("(hover: none) and (pointer: coarse)")
const LOAD_MORE_EDGE_OFFSET = 280
const ITEM_LIST_PATCH_TTL_MS = 35_000
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
  getDomainSearchTerms,
  getFeedDomainSearchText,
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
  resetItemListScroll,
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
      shouldVirtualizeItems() ? "v" : "full",
      Number(state.selectedItem?.id || 0),
      Number(state.expandedItemId || 0),
      items.length,
      Number(items[0]?.id || 0),
      Number(items[items.length - 1]?.id || 0)
    ].join(":"),
  getRangeKey: (range) =>
    [
      range.start,
      range.end,
      state.viewMode,
      shouldInlineDetail() ? "inline" : "split",
      state.itemFilter,
      state.itemQuery.trim().toLowerCase(),
      state.publishedSince || "",
      Number(state.selectedFeedId || 0),
      shouldVirtualizeItems() ? "v" : "full",
      Number(state.selectedItem?.id || 0),
      Number(state.expandedItemId || 0)
    ].join(":"),
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
  getArticleBodyActionLabel,
  getItemSiteUrl,
  getLanguageGlyphFromSetting,
  getOriginalTitle,
  getPreferredSummary,
  getPreferredTitle,
  getSecondaryTitle,
  getTargetLanguageGlyph,
  getTranslatedBodyPreview,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getUsableSummary,
  hasStoredTranslation,
  hasLoadedArticleBody,
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
  getArticleBodyActionLabel,
  getItemSiteUrl,
  hasLoadedArticleBody,
  getItemPageHtml,
  getItemBodyHtml,
  getLanguageGlyphFromSetting,
  getPreferredTitle,
  getTranslatedBodyPreview,
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
  state
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
    translationMode: "title"
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
    translationMode: feed.translation.translationMode || base.translationMode || "title"
  }
}

function getEffectiveTranslationForItem(item = state.selectedItem) {
  const base = getEffectiveTranslationForFeed(getFeedForItem(item))
  if (!item) return base

  const translation = {
    ...base,
    targetLanguage: item.translation_target_language || base.targetLanguage,
    targetLabel: item.translation_target_label || base.targetLabel,
    autoTranslate: item.translation_auto_translate ?? base.autoTranslate,
    displayTranslated: item.translation_display_translated ?? base.displayTranslated,
    translationMode: item.translation_mode || base.translationMode || "title",
    translationModeLabel: item.translation_mode_label || base.translationModeLabel
  }

  if (String(item.translated_text || "").trim() || item.translated_body_available) {
    return {
      ...translation,
      translationMode: "full"
    }
  }
  return translation
}

function hasFullStoredTranslation(item = state.selectedItem) {
  if (!item) return false
  const hasTitle = Boolean(String(item.translated_title || "").trim())
  return hasTitle && Boolean(String(item.translated_text || "").trim() || item.translated_body_available)
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

function shouldVirtualizeItems() {
  return !compactMedia.matches && !coarsePointerMedia.matches
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

function hasOpenableItemUrl(item = null) {
  if (!item) return false
  return Boolean(safeUrl(item.original_url || item.link || "") || getItemSiteUrl(item))
}

function mergeListPatch(item, patch) {
  if (!item || !patch || typeof patch !== "object") return item
  const nextPatch = { ...patch }
  if (!String(nextPatch.translated_title || "").trim() && String(item.translated_title || "").trim()) {
    delete nextPatch.translated_title
  }
  if (!String(nextPatch.translated_excerpt || "").trim() && String(item.translated_excerpt || "").trim()) {
    delete nextPatch.translated_excerpt
  }
  if (!String(nextPatch.translated_text || "").trim() && String(item.translated_text || "").trim()) {
    delete nextPatch.translated_text
  }
  if (!nextPatch.translated_body_available && (item.translated_body_available || item.translated_text)) {
    delete nextPatch.translated_body_available
  }
  if (nextPatch.has_translation === 0 && (item.has_translation || item.translated_title || item.translated_text)) {
    delete nextPatch.has_translation
  }
  return { ...item, ...nextPatch }
}

function rememberListPatch(itemId, patch) {
  const normalizedItemId = Number(itemId || 0)
  if (!Number.isInteger(normalizedItemId) || normalizedItemId <= 0 || !patch || typeof patch !== "object") return
  const previous = state.itemListPatches.get(normalizedItemId)
  state.itemListPatches.set(normalizedItemId, {
    patch: { ...(previous?.patch || {}), ...patch },
    createdAt: Date.now()
  })
  if (state.itemListPatches.size > 200) {
    state.itemListPatches.delete(state.itemListPatches.keys().next().value)
  }
}

function getRememberedListPatch(itemId) {
  const normalizedItemId = Number(itemId || 0)
  const entry = state.itemListPatches.get(normalizedItemId)
  if (!entry) return null
  if (Date.now() - Number(entry.createdAt || 0) > ITEM_LIST_PATCH_TTL_MS) {
    state.itemListPatches.delete(normalizedItemId)
    return null
  }
  return entry.patch || null
}

function applyRememberedListPatches(items) {
  if (!state.itemListPatches.size) return items
  let changed = false
  const patchedItems = items.map((item) => {
    const patch = getRememberedListPatch(item?.id)
    if (!patch) return item
    changed = true
    return mergeListPatch(item, patch)
  })
  return changed ? patchedItems : items
}

function patchItemsPageCache(itemIds, patch) {
  const normalizedIds = new Set(
    itemIds
      .map((itemId) => Number(itemId || 0))
      .filter((itemId) => Number.isInteger(itemId) && itemId > 0)
  )
  if (!normalizedIds.size || !state.itemPageCache?.size) return

  for (const [key, entry] of state.itemPageCache.entries()) {
    const cachedItems = Array.isArray(entry?.result?.items) ? entry.result.items : null
    if (!cachedItems) continue
    let changed = false
    const nextItems = cachedItems.map((item) => {
      if (!normalizedIds.has(Number(item?.id || 0))) return item
      changed = true
      return mergeListPatch(item, patch)
    })
    if (!changed) continue
    state.itemPageCache.set(key, {
      ...entry,
      result: {
        ...entry.result,
        items: nextItems
      }
    })
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
  rememberListPatch(itemId, patch)
  patchItemsPageCache([itemId], patch)
  state.items = state.items.map((item) => (Number(item.id) === Number(itemId) ? mergeListPatch(item, patch) : item))
  derivedData.invalidateItems()
}

function syncManyItemsToList(itemIds, patch) {
  const idSet = new Set(itemIds.map((itemId) => Number(itemId || 0)))
  for (const itemId of idSet) {
    rememberListPatch(itemId, patch)
  }
  patchItemsPageCache([...idSet], patch)
  state.items = state.items.map((item) => (idSet.has(Number(item.id)) ? mergeListPatch(item, patch) : item))
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

  const scrollContainer = els.itemColumn
  if (!scrollContainer) return false
  if (scrollContainer.scrollTop <= 0) return false
  return scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - LOAD_MORE_EDGE_OFFSET
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
    const hasNextFetchError = Object.prototype.hasOwnProperty.call(nextItem, "fetch_error")
    const hasNextPageFetchError = Object.prototype.hasOwnProperty.call(nextItem, "page_fetch_error")
    const hasNextTranslatedBodyAvailable = Object.prototype.hasOwnProperty.call(nextItem, "translated_body_available")
    state.selectedItem = {
      ...nextItem,
      content_html: hasNextContentHtml ? nextItem.content_html : previous.content_html,
      content_text: hasNextContentText ? nextItem.content_text : previous.content_text,
      content_excerpt: hasNextContentExcerpt ? nextItem.content_excerpt : previous.content_excerpt,
      content_loaded: nextItem.content_loaded || previous.content_loaded,
      crawled_at: nextItem.crawled_at || previous.crawled_at || null,
      fetch_error: hasNextFetchError ? nextItem.fetch_error || null : previous.fetch_error || null,
      page_html: hasNextPageHtml ? nextItem.page_html : previous.page_html,
      page_text: hasNextPageText ? nextItem.page_text : previous.page_text,
      page_loaded: nextItem.page_loaded || previous.page_loaded,
      page_fetch_error: hasNextPageFetchError ? nextItem.page_fetch_error || null : previous.page_fetch_error || null,
      original_url: nextItem.original_url || previous.original_url || "",
      original_title: nextItem.original_title || previous.original_title || "",
      translated_title: nextItem.translated_title || previous.translated_title || "",
      translated_text: nextItem.translated_text || previous.translated_text || "",
      translated_excerpt: nextItem.translated_excerpt || previous.translated_excerpt || "",
      translated_body_available: hasNextTranslatedBodyAvailable
        ? nextItem.translated_body_available
        : previous.translated_body_available || 0,
      translation_target_language: nextItem.translation_target_language || previous.translation_target_language || "",
      translation_target_label: nextItem.translation_target_label || previous.translation_target_label || "",
      translation_display_translated: Object.prototype.hasOwnProperty.call(nextItem, "translation_display_translated")
        ? nextItem.translation_display_translated
        : previous.translation_display_translated,
      translation_auto_translate: Object.prototype.hasOwnProperty.call(nextItem, "translation_auto_translate")
        ? nextItem.translation_auto_translate
        : previous.translation_auto_translate,
      translation_mode: nextItem.translation_mode || previous.translation_mode || "",
      translation_mode_label: nextItem.translation_mode_label || previous.translation_mode_label || "",
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
  getArticleBodyActionLabel,
  getItemBodyHtml,
  getItemPageHtml,
  hasLoadedArticleBody,
  getTranslatedBodyPreview,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getUsableSummary,
  glyphs: GLYPHS,
  renderActionErrorBox,
  renderCollapsibleBody: (itemId, contentHtml, sourceText, options) => renderCollapsibleBody(itemId, contentHtml, sourceText, options),
  renderPlainText,
  renderRichFallback,
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
  renderTableRow,
  shouldVirtualizeItems
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
    const isJob = result && !Array.isArray(result) && Array.isArray(result.results)
    const entries = Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : []
    const totalCount = isJob ? Number(result.total || entries.length) : entries.length
    const processedCount = isJob ? Number(result.processed || entries.length) : entries.length
    const running = isJob && result.status === "running"
    const successCount = Number(result?.successCount ?? entries.filter((entry) => entry.ok).length)
    const failedEntries = entries.filter((entry) => !entry.ok)
    const failedCount = Number(result?.failedCount ?? failedEntries.length)
    const insertedCount = Number(result?.insertedCount ?? entries.reduce((sum, entry) => sum + Number(entry.inserted || 0), 0))
    const fetchedCount = Number(result?.fetchedCount ?? entries.reduce((sum, entry) => sum + Number(entry.fetched || 0), 0))
    const unreadCount = Number(result?.unreadCount ?? entries.reduce((sum, entry) => sum + Number(entry.unreadCount || 0), 0))
    message = running
      ? `全部刷新中 · ${processedCount}/${totalCount || "?"} · 新增 ${insertedCount}`
      : `全部刷新完成 · 订阅源 ${totalCount} · 成功 ${successCount} · 失败 ${failedCount} · 新增 ${insertedCount}`
    els.syncSummary.innerHTML = `
      <h3>${running ? "全部刷新中" : "全部刷新完成"}</h3>
      <div class="metrics-grid">
        <div><strong>${processedCount}/${totalCount || "?"}</strong><span>进度</span></div>
        <div><strong>${successCount}</strong><span>成功</span></div>
        <div><strong>${failedCount}</strong><span>失败</span></div>
        <div><strong>${insertedCount}</strong><span>新增文章</span></div>
        <div><strong>${fetchedCount}</strong><span>拉取文章</span></div>
        <div><strong>${unreadCount}</strong><span>未读合计</span></div>
      </div>
      ${
        failedEntries.length
          ? `<div class="compact-list">${failedEntries
              .slice(0, 5)
              .map((entry) => `<span>源 #${Number(entry.feedId || 0)}：${escapeHtml(entry.error || "刷新失败")}</span>`)
              .join("")}</div>`
          : ""
      }
    `
    els.syncSummary.classList.remove("hidden")
    tone = running ? "accent" : failedCount ? "warning" : "success"
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
  state.detailView = nextView
  if (shouldInlineDetail()) {
    preserveInlineItemPosition(state.selectedItem.id, () => {
      refreshRenderedItemRows([state.selectedItem.id])
    })
  }
  renderArticle()

  if (nextView === "summary" && !state.selectedItem.ai_summary) {
    void summarizeItem(state.selectedItem.id)
  }
  if (nextView === "translation" && !hasFullStoredTranslation(state.selectedItem)) {
    const selectedItemId = state.selectedItem.id
    void translateItem(selectedItemId)
  }
}

async function showDetailView(view, itemId = state.selectedItem?.id, options = {}) {
  if (!state.selectedItem || !itemId) return

  const normalizedItemId = Number(itemId)
  const wasCurrentInlineView =
    !options.forceOpen &&
    shouldInlineDetail() &&
    Number(state.selectedItem.id || 0) === normalizedItemId &&
    Number(state.expandedItemId || 0) === normalizedItemId &&
    getActiveDetailView() === view

  state.detailView = wasCurrentInlineView ? "none" : view
  if (shouldInlineDetail()) {
    state.expandedItemId = normalizedItemId
    preserveInlineItemPosition(itemId, () => {
      refreshRenderedItemRows([itemId])
    })
  }
  renderArticle()

  if (state.detailView === "summary" && !state.selectedItem.ai_summary) {
    void summarizeItem(state.selectedItem.id)
  }
  if (state.detailView === "translation" && !hasFullStoredTranslation(state.selectedItem)) {
    const selectedItemId = state.selectedItem.id
    void translateItem(selectedItemId)
  }
}

async function showTranslationView(itemId = state.selectedItem?.id, options = {}) {
  await showDetailView("translation", itemId, options)
}

async function showOriginalInfo(itemId = state.selectedItem?.id, options = {}) {
  await showDetailView("original", itemId, options)
}

async function showPageView(itemId = state.selectedItem?.id, options = {}) {
  await showDetailView("page", itemId, options)
  if (state.detailView === "page" && Number(state.selectedItem?.id || 0) === Number(itemId || 0)) {
    await ensurePageLoaded(itemId)
  }
}

async function loadArticleBody(itemId = state.selectedItem?.id, options = {}) {
  if (!state.selectedItem || !itemId) return

  const normalizedItemId = Number(itemId)
  if (Number(state.selectedItem.id || 0) !== normalizedItemId) return

  const forceRefresh = Boolean(options.forceRefresh)
  state.detailView = "none"
  state.forceOriginalBody = true
  if (shouldInlineDetail()) {
    state.expandedItemId = normalizedItemId
    preserveInlineItemPosition(itemId, () => {
      refreshRenderedItemRows([itemId])
    })
  }
  renderArticle()

  if (hasLoadedArticleBody(state.selectedItem) && !forceRefresh) {
    setStatus("已显示正文", "success")
    return
  }

  setStatus(forceRefresh ? "正在重新抓取正文..." : "正在读取正文...")
  await ensureContentLoaded(itemId, { forceRefresh, preferStored: !forceRefresh, showLoadingState: true })
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
  applyRememberedListPatches,
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
  resetItemListScroll,
  hasLoadedArticleBody,
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
  preserveInlineItemPosition,
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
  renderFeedBulkState,
  renderFeeds,
  renderFilterMode,
  renderComposeState,
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
  await selectFeed(feedId, { smooth: true, skipImmediateTranslations: true })
}

function handleFeedListPointerOver(event) {
  if (!(event.target instanceof Element)) return
  const selectButton = event.target.closest("[data-feed-select]")
  if (!selectButton || !els.feedList?.contains(selectButton)) return

  const feedId = Number(selectButton.dataset.feedSelect)
  if (!Number.isInteger(feedId) || feedId < 1 || feedId === Number(state.selectedFeedId || 0)) return
  void prefetchItemsPage(feedId, 1, { skipImmediateTranslations: true })
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

  const actionButton = target.closest(
    [
      "[data-item-ai-summary]",
      "[data-item-ai-translate]",
      "[data-item-favorite]",
      "[data-item-read]",
      "[data-item-browser]",
      "[data-item-page]",
      "[data-item-original]"
    ].join(",")
  )
  if (actionButton && els.itemList?.contains(actionButton)) {
    event.preventDefault()
    event.stopPropagation()

    const itemId = Number(
      actionButton.dataset.itemAiSummary ||
        actionButton.dataset.itemAiTranslate ||
        actionButton.dataset.itemFavorite ||
        actionButton.dataset.itemRead ||
        actionButton.dataset.itemBrowser ||
        actionButton.dataset.itemPage ||
        actionButton.dataset.itemOriginal
    )
    if (!Number.isInteger(itemId) || itemId < 1) return

    const item = getItemById(itemId) || (state.selectedItem?.id === itemId ? state.selectedItem : null)
    const itemAccount = getCurrentAccount()

    if (actionButton.matches("[data-item-browser]")) {
      if (!hasOpenableItemUrl(item)) {
        setStatus("当前没有可打开的地址", "warning")
        return
      }
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

    const wasSelected = state.selectedItem?.id === itemId
    const isPageAction = actionButton.matches("[data-item-page]")
    if (!wasSelected && item) {
      applySelectedItem(item)
      state.expandedItemId = shouldInlineDetail() ? itemId : state.expandedItemId
      refreshRenderedItemRows([itemId])
      renderArticle()

      if (actionButton.matches("[data-item-ai-summary]") || actionButton.matches("[data-item-ai-translate]")) {
        const requestedView = actionButton.matches("[data-item-ai-summary]") ? "summary" : "translation"
        state.detailView = requestedView
        refreshRenderedItemRows([itemId])
        renderArticle()
        void openItem(itemId, { preserveDetailView: true, skipInlineRowRefresh: true }).then(() => {
          if (state.selectedItem?.id !== itemId || getActiveDetailView() !== requestedView) return
          if (requestedView === "summary" && !state.selectedItem.ai_summary) {
            void summarizeItem(itemId)
          }
          if (requestedView === "translation" && !hasFullStoredTranslation(state.selectedItem)) {
            void translateItem(itemId)
          }
        })
        return
      }

      if (!isPageAction) {
        void openItem(itemId, { preserveDetailView: true, skipInlineRowRefresh: true })
      }
    } else if (!wasSelected) {
      await openItem(itemId)
    }

    if (actionButton.matches("[data-item-ai-summary]")) {
      if (!itemAccount?.features.summary) {
        setStatus("当前套餐不支持 AI 总结", "warning")
        return
      }
      await toggleDetailView("summary")
    } else if (actionButton.matches("[data-item-ai-translate]")) {
      if (!itemAccount?.features.translation) {
        setStatus("当前套餐不支持翻译功能", "warning")
        return
      }
      await showTranslationView(itemId, { forceOpen: !wasSelected })
    } else if (actionButton.matches("[data-item-page]")) {
      await showPageView(itemId, { forceOpen: !wasSelected })
    } else if (actionButton.matches("[data-item-original]")) {
      await showOriginalInfo(itemId, { forceOpen: !wasSelected })
    }
    return
  }

  const selectButton = target.closest("[data-item-select]")
  if (selectButton && els.itemList?.contains(selectButton)) {
    selectButton.blur?.()
    const itemId = Number(selectButton.dataset.itemSelect)
    if (Number.isInteger(itemId) && itemId > 0) {
      await toggleItem(itemId)
    }
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
  if (state.me?.user) {
    await loadFeeds({ skipImmediateTranslations: true })
    if (!state.selectedFeedId && !state.items.length) {
      await loadItems(null, { skipImmediateTranslations: true })
    }
    prefetchNavigationTargets()
  } else {
    await loadFeeds()
    renderItems()
    renderArticle()
  }
  renderOperationSummary()
}

coarsePointerMedia.addEventListener?.("change", () => {
  virtualItems.reset({ clearHeights: true })
  renderItems()
  scheduleMaybeLoadNextPage()
})

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
    loadArticleBody,
    showPageView,
    showTranslationView,
    showOriginalInfo,
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
