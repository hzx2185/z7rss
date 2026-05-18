export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options
  })

  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || "请求失败")
  }
  return data
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("'", "&#39;").replaceAll("`", "&#96;")
}

export function safeUrl(value = "") {
  const raw = String(value || "").trim()
  if (!raw) return ""
  try {
    const parsed = new URL(raw)
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : ""
  } catch (_error) {
    return ""
  }
}

export function safeSet(el, prop, value) {
  if (el == null) return
  el[prop] = value
}

export function safeVal(el, fallback) {
  return el == null ? fallback : el.value
}

export function safeHtml(el, html) {
  if (el == null) return
  el.innerHTML = html
}

export function safeToggle(el, hidden) {
  if (el == null) return
  el.classList.toggle("hidden", hidden)
}

export function findScrollParent(element) {
  let node = element?.parentElement || null
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node)
    const canScroll = node.scrollHeight > node.clientHeight + 1
    if (canScroll && /(auto|scroll|overlay)/.test(style.overflowY || "")) {
      return node
    }
    node = node.parentElement
  }
  return window
}

export function getScrollTop(scrollParent) {
  return scrollParent === window ? window.scrollY || window.pageYOffset || 0 : scrollParent.scrollTop
}

export function setScrollTop(scrollParent, value) {
  const nextValue = Math.max(0, Number(value || 0))
  if (scrollParent === window) {
    const root = document.documentElement
    const body = document.body
    const previousRootBehavior = root?.style.scrollBehavior || ""
    const previousBodyBehavior = body?.style.scrollBehavior || ""

    if (root) root.style.scrollBehavior = "auto"
    if (body) body.style.scrollBehavior = "auto"
    window.scrollTo(window.scrollX || 0, nextValue)
    if (root) root.style.scrollBehavior = previousRootBehavior
    if (body) body.style.scrollBehavior = previousBodyBehavior
    return
  }
  scrollParent.scrollTop = nextValue
}

export function formatDate(value) {
  if (!value) return "未设置"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "未设置" : date.toLocaleString("zh-CN")
}

export function formatMoney(cents, currency = "usd", monthly = true) {
  const prefix = String(currency || "usd").toLowerCase() === "usd" ? "US$" : `${String(currency || "").toUpperCase()} `
  return `${prefix}${Math.round(Number(cents || 0) / 100)}${monthly ? " / 月" : ""}`
}

export function formatBillingProvider(provider) {
  if (!provider) return "-"
  if (provider === "demo") return "演示模式"
  if (provider === "system") return "系统"
  return provider
}

export function summarizeUserAgent(value = "") {
  const raw = String(value || "").trim()
  if (!raw) return "未知设备"
  if (raw.length <= 72) return raw
  return `${raw.slice(0, 69)}...`
}
