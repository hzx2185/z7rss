import { escapeAttribute, escapeHtml, safeUrl } from "./shared-ui.js"

export { escapeAttribute, escapeHtml, safeUrl }

function containsHtmlMarkup(value = "") {
  return /<([a-z][^>\s/]*)[\s\S]*>/i.test(String(value || ""))
}

function isSafeRichUrl(value = "", { allowRelative = false, allowDataImage = false, allowMailto = true } = {}) {
  const raw = String(value || "").trim()
  if (!raw) return false
  if (allowRelative && /^[./#]/.test(raw)) return true
  if (/^https?:/i.test(raw)) return true
  if (allowDataImage && /^data:image\//i.test(raw)) return true
  return allowMailto && /^mailto:/i.test(raw)
}

function toSafeRichUrl(candidate, baseUrl = "", options = {}) {
  const raw = String(candidate || "").trim()
  if (!raw) return ""
  if (!isSafeRichUrl(raw, options)) return ""

  try {
    if (options.allowRelative && baseUrl) {
      const resolved = new URL(raw, baseUrl)
      return isSafeRichUrl(resolved.toString(), options) ? resolved.toString() : ""
    }
    if (options.allowRelative && /^[./#]/.test(raw) && !baseUrl) {
      return raw
    }
    const resolved = new URL(raw)
    return isSafeRichUrl(resolved.toString(), options) ? resolved.toString() : ""
  } catch (_error) {
    return ""
  }
}

function sanitizeRichHtmlFragment(value = "", baseUrl = "") {
  const raw = String(value || "").trim()
  if (!raw || typeof document === "undefined") return ""

  const template = document.createElement("template")
  template.innerHTML = raw

  template.content.querySelectorAll("script, style, noscript, iframe, object, embed, form, input, button, textarea, select, meta, link").forEach((node) => {
    node.remove()
  })

  template.content.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const lowerName = attribute.name.toLowerCase()
      const currentValue = attribute.value

      if (lowerName.startsWith("on") || lowerName === "srcdoc" || lowerName === "nonce" || lowerName === "integrity") {
        element.removeAttribute(attribute.name)
        return
      }

      if (lowerName === "href") {
        const safeHref = toSafeRichUrl(currentValue, baseUrl, { allowRelative: true })
        if (safeHref) {
          element.setAttribute(attribute.name, safeHref)
          if (!/^mailto:/i.test(safeHref)) {
            element.setAttribute("rel", "noreferrer noopener")
            element.setAttribute("target", "_blank")
          }
        } else {
          element.removeAttribute(attribute.name)
        }
        return
      }

      if (lowerName === "src" || lowerName === "poster") {
        const safeSrc = toSafeRichUrl(currentValue, baseUrl, { allowRelative: true, allowDataImage: true, allowMailto: false })
        if (safeSrc) {
          element.setAttribute(attribute.name, safeSrc)
          const tagName = element.tagName.toLowerCase()
          if (tagName === "img") {
            element.setAttribute("loading", "lazy")
            element.setAttribute("referrerpolicy", "no-referrer")
          } else if (tagName === "video" || tagName === "audio") {
            element.setAttribute("referrerpolicy", "no-referrer")
          }
        } else {
          element.removeAttribute(attribute.name)
        }
        return
      }

      if (lowerName === "srcset") {
        const nextSrcset = String(currentValue || "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const [urlPart, descriptor] = entry.split(/\s+/, 2)
            const safeSrc = toSafeRichUrl(urlPart, baseUrl, { allowRelative: true, allowDataImage: true, allowMailto: false })
            if (!safeSrc) return ""
            return descriptor ? `${safeSrc} ${descriptor}` : safeSrc
          })
          .filter(Boolean)
          .join(", ")

        if (nextSrcset) {
          element.setAttribute(attribute.name, nextSrcset)
        } else {
          element.removeAttribute(attribute.name)
        }
      }
    })
  })

  return template.innerHTML.trim()
}

function truncateText(value = "", max = 120) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function formatFeedRelativeTime(value) {
  if (!value) return "从未更新"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "更新时间未知"

  const diff = Math.max(0, Date.now() - date.getTime())
  const day = 24 * 60 * 60 * 1000
  if (diff < day) return "今天更新"
  const days = Math.floor(diff / day)
  return `${Math.max(1, days)} 天前更新`
}

function renderInlineMarkdown(text = "") {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => {
      const safe = safeUrl(url)
      if (!safe) return escapeHtml(label)
      return `<a href="${escapeAttribute(safe)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`
    })
}

function renderMarkdownishText(value = "", fallback = "暂无内容", { splitOnSingleNewline = false } = {}) {
  const raw = String(value || "").trim()
  if (!raw) return `<span class="muted">${escapeHtml(fallback)}</span>`

  const normalized = raw.replace(/\r\n/g, "\n")
  const codeBlocks = []
  const protectedText = normalized.replace(/```([\s\S]*?)```/g, (_match, content) => {
    const token = `__CODE_BLOCK_${codeBlocks.length}__`
    codeBlocks.push(content.replace(/^\n+|\n+$/g, ""))
    return token
  })

  const blockSeparator = splitOnSingleNewline ? /\n+/ : /\n{2,}/
  const blocks = protectedText.split(blockSeparator).map((block) => block.trim()).filter(Boolean)
  const html = blocks
    .map((block) => {
      const codeIndex = /^__CODE_BLOCK_(\d+)__$/.exec(block)?.[1]
      if (codeIndex !== undefined) {
        return `<pre><code>${escapeHtml(codeBlocks[Number(codeIndex)] || "")}</code></pre>`
      }

      const lines = block.split("\n").map((line) => line.trimEnd())
      if (lines.every((line) => /^[-*+]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*+]\s+/, ""))}</li>`).join("")}</ul>`
      }
      if (lines.every((line) => /^\d+\.\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`
      }
      if (lines.every((line) => /^>\s?/.test(line))) {
        return `<blockquote>${lines.map((line) => renderInlineMarkdown(line.replace(/^>\s?/, ""))).join("<br />")}</blockquote>`
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(lines[0])
      if (heading && lines.length === 1) {
        const level = Math.min(6, heading[1].length)
        return `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`
      }

      return `<p>${lines.map((line) => renderInlineMarkdown(line)).join("<br />")}</p>`
    })
    .join("")

  return html || `<span class="muted">${escapeHtml(fallback)}</span>`
}

export function renderRichFallback(value = "", fallback = "暂无内容", baseUrl = "", { splitOnSingleNewline = false } = {}) {
  const raw = String(value || "").trim()
  if (!raw) {
    return renderMarkdownishText("", fallback)
  }
  if (containsHtmlMarkup(raw)) {
    const sanitized = sanitizeRichHtmlFragment(raw, baseUrl)
    if (sanitized) return sanitized
  }
  return renderMarkdownishText(raw, fallback, { splitOnSingleNewline })
}

export function getItemBodyHtml(item) {
  if (String(item?.content_html || "").trim()) {
    return sanitizeRichHtmlFragment(item.content_html, item?.original_url || item?.link || "")
  }
  return renderRichFallback(
    item?.content_text || item?.content_excerpt || item?.summary || item?.title || "",
    "暂无正文",
    item?.original_url || item?.link || ""
  )
}

export function getItemPageHtml(item) {
  if (String(item?.page_html || "").trim()) {
    return sanitizeRichHtmlFragment(item.page_html, item?.original_url || item?.link || "")
  }
  return renderRichFallback(item?.page_text || "", "暂无网页正文", item?.original_url || item?.link || "")
}

export function formatDate(value) {
  if (!value) return "未知时间"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN")
}

function formatListDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  })
}

export function renderPlainText(value, fallback = "暂无内容") {
  const content = String(value || "").trim()
  return content ? escapeHtml(content).replaceAll("\n", "<br />") : `<span class="muted">${escapeHtml(fallback)}</span>`
}

export function getDomain(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "")
  } catch (_error) {
    return value || "-"
  }
}

function normalizeDisplayText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeDomainLabel(value = "") {
  return String(getDomain(value) || "")
    .replace(/^(?:www|m|amp)\./i, "")
    .trim()
}

function getDomainSeed(value = "", fallback = "") {
  const domain = normalizeDomainLabel(value)
  if (domain) {
    const parts = domain.split(".").filter(Boolean)
    const preferred = parts.find((part) => /[a-z0-9]/i.test(part) && !["com", "net", "org", "gov", "edu", "co"].includes(part.toLowerCase()))
    if (preferred) return preferred
    return parts[0] || domain
  }
  return normalizeDisplayText(fallback)
}

function normalizeBooleanLike(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  return value === true || value === 1 || value === "1" || value === "true"
}

const GENERIC_FEED_LABEL_PATTERN = /\b(rss|feed|news|latest|headline|headlines|updates?|articles?|posts?|stories?|newsletter|portal|site|website)\b|последн|новост|лента|на сайте|新闻|资讯|头条|日报|周刊/iu
const FOREIGN_SCRIPT_PATTERN = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}]/u

function getCompactFeedLabel(label = "", url = "") {
  const raw = normalizeDisplayText(label)
  const domain = normalizeDomainLabel(url)

  if (!raw) return domain || "-"
  if (!domain) return raw

  const normalizedRaw = raw.toLowerCase()
  const normalizedDomain = domain.toLowerCase()
  const containsDomain = normalizedDomain ? normalizedRaw.includes(normalizedDomain) : false
  const hasHan = /[\p{Script=Han}]/u.test(raw)
  const hasWhitespace = /\s/.test(raw)
  const hasForeignScript = FOREIGN_SCRIPT_PATTERN.test(raw)
  const isLongPhrase = raw.length >= 18
  const looksLikeUrl = /^https?:/i.test(raw) || raw.includes("://")
  const looksGeneric = GENERIC_FEED_LABEL_PATTERN.test(raw)

  if (normalizedRaw === normalizedDomain || looksLikeUrl) {
    return domain
  }

  if (containsDomain && (looksGeneric || isLongPhrase || hasForeignScript)) {
    return domain
  }

  if (!containsDomain && !hasHan && hasWhitespace && raw.length >= 28) {
    return domain
  }

  return raw
}

function getStoredDisplayFeedTranslation(source = {}) {
  const translatedTitle = normalizeDisplayText(source?.feed_translated_title || "")
  const translatedLanguage = normalizeDisplayText(source?.feed_translated_language || "")
  const expectedLanguage = normalizeDisplayText(
    source?.translation?.targetLanguage || source?.translation_target_language || ""
  )
  const displayTranslated = normalizeBooleanLike(
    source?.translation?.displayTranslated ?? source?.translation_display_translated ?? source?.display_translated,
    false
  )

  if (!displayTranslated || !translatedTitle) return ""
  if (expectedLanguage && translatedLanguage && translatedLanguage !== expectedLanguage) return ""
  return translatedTitle
}

export function getDisplayFeedTitle(feed = {}) {
  const translatedTitle = getStoredDisplayFeedTranslation(feed)
  if (translatedTitle) return translatedTitle
  return getCompactFeedLabel(feed?.custom_title || feed?.title || "", feed?.site_url || feed?.url || "")
}

export function getDisplayItemFeedTitle(item = {}) {
  const translatedTitle = getStoredDisplayFeedTranslation(item)
  if (translatedTitle) return translatedTitle
  return getCompactFeedLabel(item?.feed_title || "", item?.original_url || item?.link || "")
}

export function buildTranslatedExcerpt(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
}

export function getFeedMonogram(feed) {
  const seed = String(getDisplayFeedTitle(feed) || feed?.title || getDomain(feed?.url) || "源").trim()
  return escapeHtml(seed.slice(0, 1).toUpperCase() || "源")
}

function getSiteMonogram(url = "", fallback = "") {
  const seed = getDomainSeed(url, fallback)
  return escapeHtml(seed.slice(0, 1).toUpperCase() || "站")
}

export function createReaderTemplates({
  buildDetailSections,
  getFeedCategory,
  getPreferredTitle,
  getPreferredSummary,
  getSecondaryTitle,
  resolveExpandedItem,
  isFeedArchived,
  isFeedCollapsed
}) {
  function buildFeedBadges(feed) {
    const badges = [`<span class="reader-feed-tag is-category">${escapeHtml(getFeedCategory(feed))}</span>`]

    if (isFeedArchived(feed)) {
      badges.push('<span class="reader-feed-tag is-archived">已归档</span>')
    }
    if (isFeedCollapsed(feed)) {
      badges.push('<span class="reader-feed-tag is-collapsed">已折叠</span>')
    }
    if (feed?.has_error || String(feed?.last_error || "").trim()) {
      badges.push('<span class="reader-feed-tag is-error">异常</span>')
    } else if (feed?.is_stale) {
      badges.push('<span class="reader-feed-tag is-stale">久未更新</span>')
    } else if (feed?.last_fetched_at) {
      badges.push('<span class="reader-feed-tag is-healthy">正常</span>')
    } else {
      badges.push('<span class="reader-feed-tag is-idle">未抓取</span>')
    }

    return badges.join("")
  }

  function buildFeedMeta(feed) {
    const parts = []
    const domain = getDomain(feed.site_url || feed.url)
    if (domain && domain !== "-") {
      parts.push(domain)
    }
    parts.push(feed.freshness_label || formatFeedRelativeTime(feed.last_fetched_at))
    if (Number(feed.item_count || 0) > 0) {
      parts.push(`${Number(feed.item_count || 0)} 篇`)
    }
    return parts.map((part) => escapeHtml(part)).join(" · ")
  }

  function buildFeedError(feed) {
    const error = truncateText(feed?.last_error || "", 72)
    if (!error) return ""
    return `<span class="reader-feed-error" title="${escapeAttribute(String(feed.last_error || ""))}">读取失败：${escapeHtml(error)}</span>`
  }

  function buildFeatureFlags(item) {
    const flags = []
    if (item.has_ai_summary) flags.push('<span class="pill success">已总结</span>')
    if (item.is_favorited) flags.push('<span class="pill accent">已收藏</span>')
    return flags.join("")
  }

  function getItemSiteLabel(item) {
    return getDisplayItemFeedTitle(item) || getDomain(item.link) || "-"
  }

  function renderReadIcon(item) {
    return `
      <span class="reader-state-dot ${item.is_read ? "is-read" : "is-unread"}" aria-hidden="true"></span>
      <span class="sr-only">${item.is_read ? "已读" : "未读"}</span>
    `
  }

  function renderSiteChip(item) {
    const siteLabel = getItemSiteLabel(item)
    const domain = getDomain(item.link)
    const siteTitle = domain && domain !== siteLabel ? `${siteLabel} · ${domain}` : siteLabel
    return `
      <span class="reader-site-chip" title="${escapeAttribute(siteTitle)}">
        <span class="reader-site-icon" aria-hidden="true">${getSiteMonogram(item.link, siteLabel)}</span>
        <span class="reader-site-name">${escapeHtml(siteLabel)}</span>
      </span>
    `
  }

  function renderTableRow(item, showInline) {
    const secondaryTitle = getSecondaryTitle(item)
    return `
      <button class="reader-item-main table-view" type="button" data-item-select="${item.id}">
        <span class="reader-cell cell-status">
          ${renderReadIcon(item)}
        </span>
        <span class="reader-cell cell-site">${renderSiteChip(item)}</span>
        <span class="reader-cell cell-title">
          <span class="reader-title-primary">${item.is_favorited ? "★ " : ""}${escapeHtml(getPreferredTitle(item))}</span>
          ${secondaryTitle ? `<span class="reader-title-secondary">${escapeHtml(secondaryTitle)}</span>` : ""}
        </span>
        <span class="reader-cell cell-time">${escapeHtml(formatListDate(item.published_at || item.created_at))}</span>
      </button>
      ${showInline ? renderExpandedBody(item) : ""}
    `
  }

  function renderListRow(item, showInline) {
    const secondaryTitle = getSecondaryTitle(item)
    return `
      <button class="reader-item-main list-view" type="button" data-item-select="${item.id}">
        <span class="reader-line-top">${item.is_favorited ? "★ " : ""}${escapeHtml(getPreferredTitle(item))}</span>
        ${secondaryTitle ? `<span class="reader-title-secondary">${escapeHtml(secondaryTitle)}</span>` : ""}
        <span class="reader-line-meta">
          <span class="reader-inline-status">${renderReadIcon(item)}</span>
          ${renderSiteChip(item)}
          <span class="reader-meta-divider" aria-hidden="true">·</span>
          <span class="reader-meta-time">${escapeHtml(formatListDate(item.published_at || item.created_at))}</span>
        </span>
      </button>
      ${showInline ? renderExpandedBody(item) : ""}
    `
  }

  function renderMagazineRow(item, showInline) {
    const preferredTitle = getPreferredTitle(item)
    const secondaryTitle = getSecondaryTitle(item)
    const preferredSummary = getPreferredSummary(item)
    const featureFlags = buildFeatureFlags(item)
    return `
      <button class="reader-item-main magazine-view" type="button" data-item-select="${item.id}">
        <div class="reader-magazine-meta">
          <span class="reader-inline-status">${renderReadIcon(item)}</span>
          ${renderSiteChip(item)}
          <span class="reader-magazine-time">${escapeHtml(formatListDate(item.published_at || item.created_at))}</span>
        </div>
        <strong class="reader-magazine-title">${item.is_favorited ? "★ " : ""}${escapeHtml(preferredTitle)}</strong>
        ${secondaryTitle ? `<span class="reader-title-secondary">${escapeHtml(secondaryTitle)}</span>` : ""}
        <p class="reader-magazine-summary">${escapeHtml(preferredSummary)}</p>
        ${featureFlags ? `<div class="feature-flags">${featureFlags}</div>` : ""}
      </button>
      ${showInline ? renderExpandedBody(item) : ""}
    `
  }

  function renderExpandedBody(item) {
    const resolvedItem = resolveExpandedItem ? resolveExpandedItem(item) : item
    const featureFlags = buildFeatureFlags(item)
    return `
      <div class="reader-item-preview">
        ${featureFlags ? `<div class="feature-flags">${featureFlags}</div>` : ""}
        <div class="reader-inline-detail">${buildDetailSections(resolvedItem, true)}</div>
      </div>
    `
  }

  return {
    buildFeatureFlags,
    buildFeedBadges,
    buildFeedError,
    buildFeedMeta,
    renderExpandedBody,
    renderListRow,
    renderMagazineRow,
    renderTableRow
  }
}
