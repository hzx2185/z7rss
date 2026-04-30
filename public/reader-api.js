function withJsonHeaders(options = {}) {
  return {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  }
}

function createRequest(fetchImpl = window.fetch.bind(window)) {
  return async function request(path, options = {}) {
    let response
    try {
      response = await fetchImpl(path, withJsonHeaders(options))
    } catch (_error) {
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
      return request("/api/auth/me")
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
    async listFeeds(fresh = false) {
      return request(fresh ? `/api/feeds?_=${Date.now()}` : "/api/feeds", fresh ? { cache: "no-store" } : {})
    },
    async listItems({ feedId, limit, page, filter, publishedSince, fresh = false }) {
      const params = new URLSearchParams()
      if (feedId) params.set("feedId", String(feedId))
      params.set("limit", String(limit))
      params.set("page", String(page))
      params.set("filter", filter)
      if (publishedSince) params.set("publishedSince", publishedSince)
      if (fresh) params.set("_", String(Date.now()))
      return request(`/api/items?${params.toString()}`, fresh ? { cache: "no-store" } : {})
    },
    async getItemPreview(itemId) {
      return request(`/api/items/${itemId}`)
    },
    async getItemContent(itemId) {
      return request(`/api/items/${itemId}/content`)
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
    async translateItem(itemId) {
      return request(`/api/items/${itemId}/translate`, { method: "POST" })
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
    async addFeed(url) {
      return request("/api/feeds", {
        method: "POST",
        body: JSON.stringify({ url })
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
