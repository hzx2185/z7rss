import { createReaderApi } from "./reader-api.js"
import { escapeAttribute, escapeHtml, safeUrl } from "./shared-ui.js"

const readerApi = createReaderApi()

const state = {
  me: null,
  feeds: [],
  query: "",
  loading: false,
  subscribingFeedIds: new Set(),
  expandedCategoryIds: new Set(),
  expandedFeedIds: new Set()
}

const DEFAULT_CATEGORY_FEED_LIMIT = 10
const PLAZA_SYMBOLS = {
  subscribed: "✓",
  unsubscribed: "○",
  pending: "...",
  visit: "↗"
}

const els = {
  accountPill: document.querySelector("#plaza-account-pill"),
  accountHint: document.querySelector("#plaza-account-hint"),
  searchInput: document.querySelector("#plaza-search-input"),
  resultsMeta: document.querySelector("#plaza-results-meta"),
  statusBox: document.querySelector("#plaza-status"),
  statusText: document.querySelector("#plaza-status-text"),
  grid: document.querySelector("#plaza-grid")
}

async function request(path, options = {}) {
  let response
  try {
    response = await window.fetch(path, {
      credentials: "same-origin",
      headers: { accept: "application/json", ...(options.headers || {}) },
      ...options
    })
  } catch (_error) {
    throw new Error("无法连接服务器，请检查网络或服务状态")
  }

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

function setStatus(message = "", tone = "info") {
  if (!els.statusBox || !els.statusText) return
  els.statusText.textContent = String(message || "")
  els.statusBox.dataset.tone = tone
  els.statusBox.classList.toggle("hidden", !message)
}

function formatDate(value) {
  if (!value) return "刚刚"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "刚刚"
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function getFilteredFeeds() {
  const query = state.query.trim().toLowerCase()
  if (!query) return state.feeds

  return state.feeds.filter((feed) => {
    const haystack = [feed.title, feed.url, feed.site_url, feed.description, feed.category]
      .join(" ")
      .toLowerCase()
    return haystack.includes(query)
  })
}

function getFeedCategory(feed) {
  return String(feed.category || "未分类").trim() || "未分类"
}

function groupFeedsByCategory(feeds) {
  const groups = new Map()
  for (const feed of feeds) {
    const category = getFeedCategory(feed)
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(feed)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
}

function getCategoryId(category) {
  let hash = 0
  for (const char of String(category || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  }
  return `plaza-category-${Math.abs(hash)}`
}

function renderAccount() {
  if (!els.accountPill || !els.accountHint) return
  if (!state.me?.user) {
    els.accountPill.textContent = "访客"
    els.accountPill.className = "pill warning"
    els.accountHint.textContent = "登录后可直接订阅广场里的源。"
    return
  }

  const displayName = state.me.user.displayName || state.me.user.email || "已登录"
  els.accountPill.textContent = state.me.user.isAdmin ? "管理员" : "已登录"
  els.accountPill.className = state.me.user.isAdmin ? "pill success" : "pill accent"
  els.accountHint.textContent = `${displayName}，你可以直接把感兴趣的源加到阅读中心。`
}

function renderResultsMeta(feeds) {
  if (!els.resultsMeta) return
  if (state.loading) {
    els.resultsMeta.textContent = "正在加载公开订阅..."
    return
  }
  if (!state.feeds.length) {
    els.resultsMeta.textContent = "还没有人公开分享订阅"
    return
  }
  if (!feeds.length) {
    els.resultsMeta.textContent = `没有匹配结果 · 共 ${state.feeds.length} 个公开订阅`
    return
  }
  els.resultsMeta.textContent =
    feeds.length === state.feeds.length
      ? `共 ${feeds.length} 个公开订阅`
      : `匹配 ${feeds.length} / ${state.feeds.length} 个公开订阅`
}

function renderEmptyState(title, description) {
  if (!els.grid) return
  els.grid.innerHTML = `
    <article class="reader-empty-card plaza-empty-card">
      <strong>${escapeHtml(title)}</strong>
      <span class="muted">${escapeHtml(description)}</span>
    </article>
  `
}

function renderFeeds() {
  const feeds = getFilteredFeeds()
  const categoryGroups = groupFeedsByCategory(feeds)
  renderResultsMeta(feeds)

  if (!els.grid) return
  if (state.loading) {
    renderEmptyState("正在加载", "订阅广场正在整理公开分享的源。")
    return
  }
  if (!state.feeds.length) {
    renderEmptyState("广场暂时空着", "先从阅读中心打开任意订阅的“公开分享”开关，这里就会出现。")
    return
  }
  if (!feeds.length) {
    renderEmptyState("没有找到匹配项", "换个关键词试试，或者清空搜索。")
    return
  }

  els.grid.innerHTML = `
    <aside class="plaza-category-sidebar" aria-label="分类">
      <div class="plaza-sidebar-title">分类</div>
      <nav class="plaza-category-nav">
        ${categoryGroups.map(([category, categoryFeeds]) => `
          <a class="plaza-category-link" href="#${escapeAttribute(getCategoryId(category))}">
            <span>${escapeHtml(category)}</span>
            <span>${escapeHtml(String(categoryFeeds.length))}</span>
          </a>
        `).join("")}
      </nav>
    </aside>
    <div class="plaza-category-content">
      ${categoryGroups.map(([category, categoryFeeds]) => renderCategory(category, categoryFeeds)).join("")}
    </div>
  `
}

function renderCategory(category, feeds) {
  const categoryId = getCategoryId(category)
  const expanded = state.expandedCategoryIds.has(categoryId)
  const visibleFeeds = expanded ? feeds : feeds.slice(0, DEFAULT_CATEGORY_FEED_LIMIT)
  const hasOverflow = feeds.length > DEFAULT_CATEGORY_FEED_LIMIT

  return `
    <section class="card plaza-category" id="${escapeAttribute(categoryId)}" aria-label="${escapeAttribute(category)}">
      <div class="plaza-category-head">
        <h2>${escapeHtml(category)}</h2>
        <div class="plaza-category-tools">
          <span class="muted">${escapeHtml(String(feeds.length))} 个订阅源</span>
          ${
            hasOverflow
              ? `<button class="secondary plaza-category-toggle" type="button" data-plaza-category-toggle="${escapeAttribute(categoryId)}">${expanded ? "折叠" : `展开全部 ${feeds.length}`}</button>`
              : ""
          }
        </div>
      </div>
      <div class="plaza-feed-table" role="table" aria-label="${escapeAttribute(category)}订阅源">
        <div class="plaza-feed-row plaza-feed-head" role="row">
          <span role="columnheader">订阅名</span>
          <span role="columnheader">订阅</span>
          <span role="columnheader">文章</span>
          <span role="columnheader">分享</span>
          <span role="columnheader">更新</span>
          <span role="columnheader">网址</span>
          <span role="columnheader">介绍</span>
        </div>
        ${visibleFeeds.map((feed) => renderFeed(feed)).join("")}
      </div>
    </section>
  `
}

function renderFeed(feed) {
  const expanded = state.expandedFeedIds.has(Number(feed.id))
  const subscribePending = state.subscribingFeedIds.has(feed.id)
  const feedLink = safeUrl(feed.site_url) || safeUrl(feed.url)
  const subscribeLabel = subscribePending
    ? PLAZA_SYMBOLS.pending
    : (feed.viewer_subscribed ? PLAZA_SYMBOLS.subscribed : PLAZA_SYMBOLS.unsubscribed)
  const subscribeDisabled = subscribePending || feed.viewer_subscribed
  const updateLabel = feed.last_fetched_at ? formatDate(feed.last_fetched_at) : (feed.freshness_label || "等待抓取")

  return `
    <article class="plaza-feed-row" role="row">
      <div class="plaza-feed-name" role="cell">
        <button
          class="plaza-feed-name-btn"
          type="button"
          data-plaza-feed-toggle="${feed.id}"
          aria-expanded="${expanded ? "true" : "false"}"
          title="${escapeAttribute(feed.title)}"
        >
          ${escapeHtml(feed.title)}
        </button>
      </div>
      <div class="plaza-card-actions" role="cell">
        ${
          state.me?.user
            ? `<button class="secondary plaza-action-btn plaza-symbol-btn" type="button" data-plaza-subscribe="${feed.id}" ${subscribeDisabled ? "disabled" : ""} title="订阅到阅读中心" aria-label="订阅到阅读中心">${escapeHtml(subscribeLabel)}</button>`
            : `<a class="secondary nav-link-btn plaza-action-btn plaza-symbol-btn" href="/member.html" title="登录后订阅" aria-label="登录后订阅">${PLAZA_SYMBOLS.unsubscribed}</a>`
        }
      </div>
      <span class="plaza-feed-stat plaza-feed-articles" role="cell">${escapeHtml(String(feed.item_count || 0))}</span>
      <span class="plaza-feed-stat plaza-feed-sharers" role="cell">${escapeHtml(String(feed.sharer_count || 0))}</span>
      <span class="plaza-feed-update" role="cell">${escapeHtml(updateLabel)}</span>
      <div class="plaza-feed-site" role="cell">
        ${feedLink ? `<a class="secondary nav-link-btn plaza-visit-btn plaza-symbol-btn" href="${escapeAttribute(feedLink)}" target="_blank" rel="noreferrer" title="访问网站" aria-label="访问网站">${PLAZA_SYMBOLS.visit}</a>` : '<span class="muted">-</span>'}
      </div>
      <p class="plaza-feed-desc" role="cell">${escapeHtml(feed.description || feed.url || "暂无介绍")}</p>
    </article>
    ${expanded ? renderFeedArticles(feed) : ""}
  `
}

function renderFeedArticles(feed) {
  const items = Array.isArray(feed.items) ? feed.items.slice(0, 10) : []
  if (!items.length) {
    return `
      <div class="plaza-article-panel">
        <p class="muted plaza-article-empty">这个订阅源暂时没有可展示的最新文章。</p>
      </div>
    `
  }

  return `
    <div class="plaza-article-panel">
      <div class="plaza-article-head">
        <span>订阅名</span>
        <span>标题</span>
        <span>更新时间</span>
      </div>
      ${items.map((item) => `
        <div class="plaza-article-row">
          <span class="plaza-article-feed">${escapeHtml(feed.title)}</span>
          <a class="plaza-article-title" href="${escapeAttribute(safeUrl(item.link) || safeUrl(feed.site_url) || safeUrl(feed.url))}" target="_blank" rel="noreferrer">${escapeHtml(item.title || "未命名文章")}</a>
          <span class="plaza-article-time">${escapeHtml(formatDate(item.published_at || item.created_at))}</span>
        </div>
      `).join("")}
    </div>
  `
}

async function loadMe() {
  const result = await readerApi.getMe()
  state.me = result.authenticated ? result : null
  renderAccount()
}

async function loadFeeds() {
  state.loading = true
  renderFeeds()

  try {
    const result = await request("/api/plaza?limit=30&itemLimit=10")
    state.feeds = Array.isArray(result?.feeds) ? result.feeds : []
  } catch (error) {
    state.feeds = []
    setStatus(error.message, "error")
  } finally {
    state.loading = false
    renderFeeds()
  }
}

async function subscribeFeed(feedId) {
  const feed = state.feeds.find((entry) => Number(entry.id) === Number(feedId))
  if (!feed) {
    setStatus("未找到要订阅的源", "warning")
    return
  }
  if (!state.me?.user) {
    window.location.href = "/member.html"
    return
  }
  if (feed.viewer_subscribed || state.subscribingFeedIds.has(feed.id)) {
    return
  }

  state.subscribingFeedIds.add(feed.id)
  renderFeeds()
  try {
    await readerApi.addFeed(feed.url)
    feed.viewer_subscribed = true
    setStatus(`已订阅 ${feed.title}`, "success")
  } catch (error) {
    if (/订阅过/.test(error.message)) {
      feed.viewer_subscribed = true
      setStatus(`你已经订阅过 ${feed.title}`, "success")
    } else {
      setStatus(error.message, "error")
    }
  } finally {
    state.subscribingFeedIds.delete(feed.id)
    renderFeeds()
  }
}

els.searchInput?.addEventListener("input", () => {
  state.query = els.searchInput.value || ""
  renderFeeds()
})

els.grid?.addEventListener("click", async (event) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const button = target.closest("[data-plaza-subscribe]")
  if (button) {
    await subscribeFeed(Number(button.getAttribute("data-plaza-subscribe")))
    return
  }

  const categoryButton = target.closest("[data-plaza-category-toggle]")
  if (categoryButton) {
    const categoryId = categoryButton.getAttribute("data-plaza-category-toggle") || ""
    if (state.expandedCategoryIds.has(categoryId)) {
      state.expandedCategoryIds.delete(categoryId)
    } else {
      state.expandedCategoryIds.add(categoryId)
    }
    renderFeeds()
    return
  }

  const feedButton = target.closest("[data-plaza-feed-toggle]")
  if (feedButton) {
    const feedId = Number(feedButton.getAttribute("data-plaza-feed-toggle"))
    if (state.expandedFeedIds.has(feedId)) {
      state.expandedFeedIds.delete(feedId)
    } else {
      state.expandedFeedIds.add(feedId)
    }
    renderFeeds()
  }
})

async function boot() {
  renderAccount()
  renderFeeds()
  try {
    await loadMe()
  } catch (error) {
    setStatus(error.message, "warning")
  }
  await loadFeeds()
}

void boot()
