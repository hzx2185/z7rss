const DEFAULT_ITEM_LIMIT = 20
const DEFAULT_FEED_RENDER_LIMIT = 80
export const VIEW_KEY = "z7rss-reader-view-mode"
export const FEED_UNREAD_FILTER_KEY = "z7rss-reader-feed-unread-filter"
export const FEED_VISIBILITY_FILTER_KEY = "z7rss-reader-feed-visibility-filter"
export const FEED_HEALTH_FILTER_KEY = "z7rss-reader-feed-health-filter"
export const FEED_STALE_FILTER_KEY = "z7rss-reader-feed-stale-filter"
export const FEED_CATEGORY_FILTER_KEY = "z7rss-reader-feed-category-filter"
export const FEED_SHARE_FILTER_KEY = "z7rss-reader-feed-share-filter"
export const ITEM_FILTER_KEY = "z7rss-reader-item-filter"
export const ITEM_QUERY_KEY = "z7rss-reader-item-query"
export const LAYOUT_MODE_KEY = "z7rss-reader-layout-mode"
export const COLUMN_WIDTHS_KEY = "z7rss-reader-column-widths"
export const TABLE_COLUMNS_KEY = "z7rss-reader-table-columns"

export const DEFAULT_COLUMN_WIDTHS = Object.freeze({
  source: 300,
  item: 468
})

export const DEFAULT_TABLE_COLUMNS = Object.freeze({
  status: 24,
  site: 28,
  time: 44
})

export const GLYPHS = Object.freeze({
  drawer: "☰",
  summary: "≡",
  translate: "译",
  page: "原",
  original: "源",
  favorite: "★",
  read: "✓",
  unread: "○",
  browser: "↗",
  copyTitle: "题",
  copyLink: "链",
  load: "↻",
  sharePublic: "◎",
  sharePrivate: "◌",
  more: "⋯"
})

export function normalizeFeedUnreadFilter(value) {
  return ["all", "unread", "read"].includes(value) ? value : "all"
}

export function normalizeFeedVisibilityFilter(value) {
  return ["normal", "all", "archived", "collapsed"].includes(value) ? value : "normal"
}

export function normalizeFeedHealthFilter(value) {
  return ["all", "healthy", "error"].includes(value) ? value : "all"
}

export function normalizeFeedStaleFilter(value) {
  const normalized = String(value || "").trim().toLowerCase()
  return ["any", "3", "7", "30", "90", "never"].includes(normalized) ? normalized : "any"
}

export function normalizeFeedCategoryFilter(value) {
  return value ? String(value).trim() : "all"
}

export function normalizeFeedShareFilter(value) {
  return ["all", "public", "private"].includes(value) ? value : "all"
}

export function normalizeItemFilter(value) {
  return ["all", "read", "unread", "favorite"].includes(value) ? value : "all"
}

export const state = {
  me: null,
  feeds: [],
  items: [],
  deferredReadItemIds: [],
  selectedFeedId: null,
  selectedItem: null,
  expandedItemId: null,
  feedQuery: "",
  feedRenderLimit: DEFAULT_FEED_RENDER_LIMIT,
  feedRenderKey: "",
  itemQuery: window.localStorage.getItem(ITEM_QUERY_KEY) || "",
  itemLimit: DEFAULT_ITEM_LIMIT,
  itemPage: 1,
  itemPageCount: 1,
  itemTotal: 0,
  expandedBodyItemIds: [],
  feedUnreadFilter: normalizeFeedUnreadFilter(window.localStorage.getItem(FEED_UNREAD_FILTER_KEY)),
  feedVisibilityFilter: normalizeFeedVisibilityFilter(window.localStorage.getItem(FEED_VISIBILITY_FILTER_KEY)),
  feedHealthFilter: normalizeFeedHealthFilter(window.localStorage.getItem(FEED_HEALTH_FILTER_KEY)),
  feedStaleFilter: normalizeFeedStaleFilter(window.localStorage.getItem(FEED_STALE_FILTER_KEY)),
  feedCategoryFilter: normalizeFeedCategoryFilter(window.localStorage.getItem(FEED_CATEGORY_FILTER_KEY)),
  feedShareFilter: normalizeFeedShareFilter(window.localStorage.getItem(FEED_SHARE_FILTER_KEY)),
  scopeCounts: {
    all: 0,
    today: 0,
    favorite: 0,
    unread: 0
  },
  itemFilter: normalizeItemFilter(window.localStorage.getItem(ITEM_FILTER_KEY)),
  publishedSince: null,
  viewMode: ["list", "table", "magazine"].includes(window.localStorage.getItem(VIEW_KEY))
    ? window.localStorage.getItem(VIEW_KEY)
    : "table",
  layoutMode: window.localStorage.getItem(LAYOUT_MODE_KEY) === "inline" ? "inline" : "split",
  lastOperation: null,
  loadingContentFor: null,
  loadingPageFor: null,
  loadingItems: false,
  loadingNextPage: false,
  itemPageCache: new Map(),
  itemListPatches: new Map(),
  composeOpen: false,
  feedDrawerOpen: false,
  feedBulkMode: false,
  selectedFeedIds: [],
  feedSettingsFeedId: null,
  detailView: null,
  forceOriginalBody: false,
  translation: {
    provider: "google",
    targetLanguage: "zh-CN",
    targetLabel: "简体中文",
    autoTranslate: false,
    displayTranslated: true,
    translationMode: "title"
  }
}
