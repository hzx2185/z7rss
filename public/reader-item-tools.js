export function createReaderItemTools({
  buildTranslatedExcerpt,
  getCurrentFeed,
  getDomain,
  getEffectiveTranslationForFeed,
  getEffectiveTranslationForItem,
  getFeedForItem,
  getProviderTargetCode,
  glyphs,
  getSelectedItem,
  safeUrl,
  setStatus
}) {
  function normalizeInlineText(value = "") {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function extractDisplayText(value = "") {
    const raw = String(value || "")
    if (!raw.trim()) return ""
    if (typeof document !== "undefined" && /<[a-z][\s\S]*>/i.test(raw)) {
      const template = document.createElement("template")
      template.innerHTML = raw
      return normalizeInlineText(template.content.textContent || "")
    }
    return normalizeInlineText(raw.replace(/<[^>]*>/g, " "))
  }

  function getTranslatedTitle(item) {
    return extractDisplayText(item?.translated_title || "")
  }

  function getTranslatedBody(item) {
    return String(item?.translated_text || "").trim()
  }

  function getOriginalTitle(item) {
    return extractDisplayText(item?.title || "")
  }

  function getItemHost(item = null) {
    try {
      return new URL(String(item?.original_url || item?.link || "").trim()).hostname.toLowerCase()
    } catch (_error) {
      return ""
    }
  }

  function isSmzdmItem(item = null) {
    return /(^|\.)smzdm\.com$/i.test(getItemHost(item))
  }

  function isLikelySmzdmPlaceholderSummary(item = null, value = "") {
    if (!isSmzdmItem(item)) return false
    const text = normalizeInlineText(value)
    const author = normalizeInlineText(item?.author || "")
    if (!text) return false
    if (/^本文来自\s*什么值得买网站/u.test(text) && text.length <= 40) {
      return true
    }
    if (author && text === author && text.length <= 24) {
      return true
    }
    return false
  }

  function getUsableSummary(item = null) {
    const summary = String(item?.summary || "")
    if (summary && !isLikelySmzdmPlaceholderSummary(item, summary)) return summary
    return String(item?.content_excerpt || "").trim()
  }

  function hasStoredTranslation(item) {
    return Boolean(getTranslatedTitle(item) || getTranslatedBody(item))
  }

  function shouldDisplayStoredTranslation(item) {
    return Boolean(item) && getEffectiveTranslationForItem(item).displayTranslated && hasStoredTranslation(item)
  }

  function getPreferredTitle(item) {
    const translatedTitle = getTranslatedTitle(item)
    if (translatedTitle && shouldDisplayStoredTranslation(item)) {
      return translatedTitle
    }
    return getOriginalTitle(item) || "未命名文章"
  }

  function getSecondaryTitle() {
    return ""
  }

  function getLanguageGlyphFromSetting(value = "") {
    const raw = String(value || "").trim()
    const normalized = raw.toLowerCase()
    if (!raw) return ""
    if (normalized.startsWith("zh") || /中|简体|繁体|中文/u.test(raw)) return "中"
    if (normalized.startsWith("en") || /英|英文/u.test(raw)) return "英"
    if (normalized.startsWith("ru") || /俄|俄文/u.test(raw)) return "俄"
    if (normalized.startsWith("ja") || /日|日文/u.test(raw)) return "日"
    if (normalized.startsWith("ko") || /韩|韩文/u.test(raw)) return "韩"
    return ""
  }

  function detectLanguageGlyphFromText(value = "") {
    const sample = extractDisplayText(value)
    if (!sample) return ""
    if (/[\p{Script=Cyrillic}]/u.test(sample)) return "俄"
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sample)) return "日"
    if (/[\p{Script=Hangul}]/u.test(sample)) return "韩"
    if (/[\p{Script=Han}]/u.test(sample)) return "中"
    if (/[A-Za-z]/.test(sample)) return "英"
    return ""
  }

  function getSourceLanguageGlyph(item) {
    const sample = [
      getOriginalTitle(item),
      extractDisplayText(item?.summary || ""),
      extractDisplayText(item?.content_text || "")
    ]
      .filter(Boolean)
      .join(" ")
    return detectLanguageGlyphFromText(sample) || glyphs.translate
  }

  function getTargetLanguageGlyph(item) {
    const translation = getEffectiveTranslationForItem(item)
    return (
      getLanguageGlyphFromSetting(translation.targetLanguage) ||
      getLanguageGlyphFromSetting(translation.targetLabel) ||
      glyphs.translate
    )
  }

  function getTranslateButtonGlyph(item) {
    return glyphs.translate
  }

  function getTranslateButtonLabel(item = null) {
    const translation = item ? getEffectiveTranslationForItem(item) : getEffectiveTranslationForFeed(getCurrentFeed())

    if (!item) {
      return translation.translationMode === "title"
        ? `翻译当前文章标题 · ${translation.targetLabel}`
        : `翻译当前文章标题和正文 · ${translation.targetLabel}`
    }

    if (shouldDisplayStoredTranslation(item) && hasStoredTranslation(item)) {
      return translation.translationMode === "title"
        ? `当前显示 ${translation.targetLabel} 标题`
        : `当前显示 ${translation.targetLabel}`
    }

    return translation.translationMode === "title"
      ? `翻译当前文章标题 · ${translation.targetLabel}`
      : `翻译当前文章标题和正文 · ${translation.targetLabel}`
  }

  function getPreferredSummary(item) {
    if (shouldDisplayStoredTranslation(item)) {
      const translatedExcerpt = String(item?.translated_excerpt || "").trim()
      if (translatedExcerpt) return translatedExcerpt

      const translatedBody = getTranslatedBody(item)
      if (translatedBody) return buildTranslatedExcerpt(translatedBody)

      const translatedTitle = getTranslatedTitle(item)
      if (translatedTitle) return buildTranslatedExcerpt(translatedTitle)
    }

    return getUsableSummary(item) || "点击后查看详情。"
  }

  function getItemSiteUrl(item = null) {
    const feed = getFeedForItem(item)
    const direct = safeUrl(feed?.site_url || "")
    if (direct) return direct
    const articleUrl = safeUrl(item?.link || "")
    if (!articleUrl) return ""
    try {
      const parsed = new URL(articleUrl)
      return `${parsed.protocol}//${parsed.host}/`
    } catch (_error) {
      return ""
    }
  }

  function buildArticleSearchUrl(item = null) {
    if (!item) return ""
    const query = [getOriginalTitle(item), item.feed_title, getDomain(item.link)]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ")
    return query ? `https://www.bing.com/search?q=${encodeURIComponent(query)}` : ""
  }

  function openUrlInNewTab(url, successMessage) {
    const targetUrl = safeUrl(url)
    if (!targetUrl) {
      setStatus("当前没有可打开的地址", "warning")
      return false
    }
    window.open(targetUrl, "_blank", "noopener")
    if (successMessage) {
      setStatus(successMessage, "success")
    }
    return true
  }

  async function copyTextToClipboard(text, successMessage) {
    const value = String(text || "").trim()
    if (!value) {
      setStatus("当前没有可复制的内容", "warning")
      return
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const input = document.createElement("textarea")
        input.value = value
        input.setAttribute("readonly", "readonly")
        input.style.position = "fixed"
        input.style.opacity = "0"
        document.body.append(input)
        input.select()
        document.execCommand("copy")
        input.remove()
      }
      setStatus(successMessage, "success")
    } catch (_error) {
      setStatus("复制失败，请检查浏览器权限", "error")
    }
  }

  async function copyItemTitle(item = null) {
    await copyTextToClipboard(getPreferredTitle(item), "标题已复制")
  }

  async function copyItemLink(item = null) {
    await copyTextToClipboard(safeUrl(item?.original_url || item?.link || ""), "链接已复制")
  }

  function openArticleSearch(item = null) {
    openUrlInNewTab(buildArticleSearchUrl(item), "已打开文章搜索")
  }

  function openItemSite(item = null) {
    openUrlInNewTab(getItemSiteUrl(item), "已打开来源网页")
  }

  function openItemInBrowser(item = null) {
    const targetItem = item || getSelectedItem?.() || null
    openUrlInNewTab(safeUrl(targetItem?.original_url || targetItem?.link || "") || getItemSiteUrl(targetItem), "已在浏览器打开")
  }

  function getTargetCodeForProvider(provider, item = null) {
    const language = getEffectiveTranslationForItem(item).targetLanguage || "zh-CN"
    return getProviderTargetCode(provider, language)
  }

  function buildTranslationSeed(item, provider) {
    const raw = extractDisplayText(item.content_text || item.summary || item.title || "")
    const limitByProvider = {
      google: 2500,
      bing: 1200,
      sogou: 2000
    }
    const limit = limitByProvider[provider] || 1500
    return raw.slice(0, limit)
  }

  function buildExternalTranslateUrl(provider, item) {
    const seed = buildTranslationSeed(item, provider)
    if (!seed) return ""

    if (provider === "google") {
      return `https://translate.google.com/?hl=zh-CN&sl=auto&tl=${encodeURIComponent(getTargetCodeForProvider("google", item))}&text=${encodeURIComponent(seed)}&op=translate`
    }
    if (provider === "bing") {
      return `https://www.bing.com/translator?from=auto-detect&to=${encodeURIComponent(getTargetCodeForProvider("bing", item))}&text=${encodeURIComponent(seed)}`
    }
    if (provider === "sogou") {
      return `https://fanyi.sogou.com/text?keyword=${encodeURIComponent(seed)}&transfrom=auto&transto=${encodeURIComponent(getTargetCodeForProvider("sogou", item))}&model=general`
    }
    return ""
  }

  function openExternalTranslate(provider, item = null) {
    if (!item) return
    const url = buildExternalTranslateUrl(provider, item)
    if (!url) {
      setStatus("当前文章没有可翻译内容", "warning")
      return
    }
    window.open(url, "_blank", "noopener")
    setStatus(`${provider === "google" ? "谷歌" : provider === "bing" ? "必应" : "搜狗"} 翻译已在新标签打开`, "success")
  }

  return {
    copyItemLink,
    copyItemTitle,
    detectLanguageGlyphFromText,
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
  }
}
