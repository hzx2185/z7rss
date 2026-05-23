import { clearAuthStateCache, fetchAuthState } from "./auth-state.js"

function withJsonHeaders(options = {}) {
  return {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  }
}

const NETWORK_RETRY_DELAY_MS = 250;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReadOnlyRequest(options = {}) {
  const method = String(options.method || "GET").trim().toUpperCase();
  return method === "GET" || method === "HEAD";
}

function createRequest(fetchImpl = window.fetch.bind(window)) {
  return async function request(path, options = {}) {
    const attempts = isReadOnlyRequest(options) ? 2 : 1;
    let lastError = null;
    let response

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        response = await fetchImpl(path, withJsonHeaders(options))
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await wait(NETWORK_RETRY_DELAY_MS);
          continue;
        }
      }
    }

    if (lastError) {
      throw new Error("无法连接服务器，请检查容器、端口或网络状态")
    }

    if (response.status === 204) return null
    const rawText = await response.text()
    let data = null
    try {
      data = rawText ? JSON.parse(rawText) : null
    } catch (_error) {
      data = null
    }
    if (!response.ok) {
      throw new Error(data?.error || rawText || `请求失败 (${response.status})`)
    }
    return data
  }
}

export function createReaderApi(fetchImpl = window.fetch.bind(window)) {
  const request = createRequest(fetchImpl)

  return {
    async getMe() {
      return (await fetchAuthState()) || { authenticated: false, user: null }
    },
    clearCachedMe() {
      clearAuthStateCache()
    },
    async updateReaderPreferences(payload) {
      return request("/api/account/preferences/reader", {
        method: "POST",
        body: JSON.stringify(payload)
      })
    },
    async getItemCounts(todaySince, fresh = false) {
      const params = new URLSearchParams()
      params.set("todaySince", todaySince)
      if (fresh) params.set("_", String(Date.now()))
      return request(`/api/items/counts?${params.toString()}`, fresh ? { cache: "no-store" } : {})
    },
    async listFeeds(fresh = false, options = {}) {
      const params = new URLSearchParams()
      if (options.skipImmediateTranslations) params.set("skipImmediateTranslations", "true")
      if (fresh) params.set("_", String(Date.now()))
      const query = params.toString()
      return request(`/api/feeds${query ? `?${query}` : ""}`, fresh ? { cache: "no-store" } : {})
    },
    async listItems({ feedId, limit, page, filter, publishedSince, fresh = false, skipImmediateTranslations = false, includeTotal = true, signal = null }) {
      const params = new URLSearchParams()
      const normalizedFeedId = Number(feedId || 0)
      if (Number.isInteger(normalizedFeedId) && normalizedFeedId > 0) {
        params.set("feedId", String(normalizedFeedId))
      }
      params.set("limit", String(limit))
      params.set("page", String(page))
      params.set("filter", filter)
      if (publishedSince) params.set("publishedSince", publishedSince)
      if (skipImmediateTranslations) params.set("skipImmediateTranslations", "true")
      if (!includeTotal) params.set("includeTotal", "false")
      if (fresh) params.set("_", String(Date.now()))
      return request(`/api/items?${params.toString()}`, {
        ...(fresh ? { cache: "no-store" } : {}),
        ...(signal ? { signal } : {})
      })
    },
    async getItemPreview(itemId) {
      return request(`/api/items/${itemId}`)
    },
    async getItemContent(itemId, options = {}) {
      const params = new URLSearchParams()
      if (options.forceRefresh) params.set("forceRefresh", "true")
      if (options.preferStored) params.set("preferStored", "true")
      const query = params.toString()
      return request(`/api/items/${itemId}/content${query ? `?${query}` : ""}`, options.forceRefresh ? { cache: "no-store" } : {})
    },
    async getItemPage(itemId) {
      return request(`/api/items/${itemId}/page`)
    },
    async setItemReadState(itemId, isRead) {
      return request(`/api/items/${itemId}/read-state`, {
        method: "POST",
        body: JSON.stringify({ isRead })
      })
    },
    async setItemFavoriteState(itemId, isFavorited) {
      return request(`/api/items/${itemId}/favorite-state`, {
        method: "POST",
        body: JSON.stringify({ isFavorited })
      })
    },
    async translateItem(itemId, options = {}) {
      return request(`/api/items/${itemId}/translate`, {
        method: "POST",
        body: JSON.stringify({
          translationMode: options.translationMode || "full"
        })
      })
    },
    async summarizeItem(itemId) {
      return request(`/api/items/${itemId}/summarize`, { method: "POST" })
    },
    async refreshFeed(feedId) {
      return request(`/api/feeds/${feedId}/refresh`, { method: "POST" })
    },
    async updateFeedPreferences(feedId, payload) {
      return request(`/api/feeds/${feedId}/preferences`, {
        method: "POST",
        body: JSON.stringify(payload)
      })
    },
    async deleteFeed(feedId) {
      return request(`/api/feeds/${feedId}`, { method: "DELETE" })
    },
    async addFeed(url, options = {}) {
      return request("/api/feeds", {
        method: "POST",
        body: JSON.stringify({ url, isPublic: options.isPublic })
      })
    },
    async importFeeds(content) {
      return request("/api/feeds/import", {
        method: "POST",
        body: JSON.stringify({ content })
      })
    },
    async refreshAllFeeds() {
      return request("/api/feeds/refresh-all", { method: "POST" })
    },
    async getRefreshAllJob(jobId) {
      return request(`/api/feeds/refresh-all/${encodeURIComponent(jobId)}`)
    },
    async setReadStateBulk(payload) {
      return request("/api/items/read-state/bulk", {
        method: "POST",
        body: JSON.stringify(payload)
      })
    },
    buildExportUrl(format) {
      return `/api/feeds/export?format=${format}`
    }
  }
}
