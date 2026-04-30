export function createReaderArticleDetail({
  compactMedia,
  els,
  escapeHtml,
  extractDisplayText,
  formatDate,
  getCurrentAccount,
  getCurrentFeed,
  getDisplayItemFeedTitle,
  getDomain,
  getEffectiveTranslationForFeed,
  getEffectiveTranslationForItem,
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
  glyphs,
  renderCollapsibleBody,
  renderPlainText,
  renderRichFallback,
  safeUrl,
  setGlyphButton,
  shouldDisplayStoredTranslation,
  state,
  ensurePageLoaded
}) {
  const renderCache = {
    articleBodyKey: "",
    detailViewKey: "",
    warningsKey: ""
  }

  function setHtmlWhenChanged(element, cacheKey, nextKey, html) {
    if (!element) return
    if (renderCache[cacheKey] === nextKey) return
    element.innerHTML = typeof html === "function" ? html() : html
    renderCache[cacheKey] = nextKey
  }

  function setTextWhenChanged(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text
    }
  }

  function setDisabledWhenChanged(element, disabled) {
    if (element && element.disabled !== disabled) {
      element.disabled = disabled
    }
  }

  function setTitleWhenChanged(element, title) {
    if (element && element.title !== title) {
      element.title = title
    }
  }

  function getTextSignature(value) {
    const text = String(value || "")
    if (!text) return "0"
    return `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`
  }

  function renderActionErrorBox(label, message) {
    const content = String(message || "").trim()
    if (!content) return ""
    return `
      <div class="reader-action-error" role="status" aria-live="polite">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(content)}</span>
      </div>
    `
  }

  function getDefaultDetailView() {
    return "none"
  }

  function getActiveDetailView() {
    return state.detailView === null ? getDefaultDetailView() : state.detailView
  }

  function shouldInlineDetail() {
    return compactMedia.matches || state.layoutMode === "inline"
  }

  function renderTranslationMeta() {
    const translation = state.selectedItem
      ? getEffectiveTranslationForItem(state.selectedItem)
      : getEffectiveTranslationForFeed(getCurrentFeed())
    if (els.translateBtn) {
      setGlyphButton(
        els.translateBtn,
        state.selectedItem
          ? getTranslateButtonGlyph(state.selectedItem)
          : getLanguageGlyphFromSetting(translation.targetLanguage) || glyphs.translate,
        getTranslateButtonLabel(state.selectedItem)
      )
    }
  }

  function renderOriginalInfo(item) {
    const resolvedUrl = safeUrl(item.original_url || item.link || "")
    const originalTitle = extractDisplayText(item.original_title || item.title || "")
    const parts = []
    if (originalTitle) {
      parts.push(`<p><strong>识别标题：</strong>${escapeHtml(originalTitle)}</p>`)
    }
    parts.push(`<p><strong>原文 URL：</strong>${resolvedUrl ? `<code>${escapeHtml(resolvedUrl)}</code>` : '<span class="muted">未识别</span>'}</p>`)
    if (resolvedUrl && resolvedUrl !== safeUrl(item.link || "")) {
      parts.push(`<p class="muted">系统已从文章页识别并保存规范化原文地址。</p>`)
    }
    return parts.join("")
  }

  function renderDetailView() {
    const item = state.selectedItem
    const account = getCurrentAccount()
    const activeView = getActiveDetailView()
    const translation = item ? getEffectiveTranslationForItem(item) : getEffectiveTranslationForFeed(getCurrentFeed())

    ;[
      [els.summaryToggleBtn, activeView === "summary"],
      [els.translateBtn, activeView === "translation"],
      [els.pageToggleBtn, activeView === "page"],
      [els.originalToggleBtn, activeView === "original"]
    ].forEach(([button, active]) => button?.classList.toggle("active", active))

    if (!item || activeView === "none") {
      els.detailView.classList.add("hidden")
      setTextWhenChanged(els.detailViewTitle, "")
      setTextWhenChanged(els.detailViewMeta, "")
      els.detailViewLead.classList.add("hidden")
      setTextWhenChanged(els.detailViewLead, "")
      setHtmlWhenChanged(els.detailViewBody, "detailViewKey", "empty", "")
      return
    }

    let title = ""
    let meta = ""
    let lead = ""
    let body = ""

    if (activeView === "summary") {
      title = "摘要"
      meta = item.summary_error
        ? "AI 摘要失败"
        : item.ai_summary
          ? "AI 摘要已保存"
          : account?.features.summary
            ? "首次点击会自动生成并入库"
            : "当前套餐不支持 AI 总结"
      body = `
        ${renderActionErrorBox("摘要失败", item.summary_error)}
        ${renderPlainText(item.ai_summary, account?.features.summary ? "点击顶部摘要按钮后自动生成。" : "当前套餐不支持 AI 总结。")}
      `
    } else if (activeView === "translation") {
      const translateErrorBox = renderActionErrorBox("翻译失败", item.translate_error)
      title = translation.translationMode === "title" ? "翻译标题" : "翻译"
      meta = `目标语言：${translation.targetLabel}`
      lead = getTranslatedTitle(item)
      if (translation.translationMode === "title") {
        body = `
          ${translateErrorBox}
          ${renderPlainText(
            getTranslatedTitle(item) ? "当前订阅只翻译标题，正文仍显示原文内容。" : "点击顶部翻译按钮后自动翻译标题。"
          )}
        `
      } else {
        body = `
          ${translateErrorBox}
          ${renderPlainText(getTranslatedBody(item), "点击顶部翻译按钮后自动翻译标题和正文。")}
        `
      }
    } else if (activeView === "page") {
      title = "网页内容"
      meta = item.page_fetch_error ? `抓取失败：${item.page_fetch_error}` : item.page_loaded ? "已从网页抓取并保存" : "正在抓取网页内容..."
      lead = extractDisplayText(item.original_title || item.title || "")
      body = item.page_loaded
        ? getItemPageHtml(item)
        : item.page_fetch_error
          ? renderPlainText(item.page_fetch_error, "网页抓取失败")
          : `<p class="muted">正在加载网页内容...</p>`
    } else if (activeView === "original") {
      title = "原文信息"
      meta = safeUrl(item.original_url || item.link || "") ? getDomain(item.original_url || item.link || "") : "未识别"
      lead = extractDisplayText(item.original_title || item.title || "")
      body = renderOriginalInfo(item)
    }

    els.detailView.classList.remove("hidden")
    setTextWhenChanged(els.detailViewTitle, title)
    setTextWhenChanged(els.detailViewMeta, meta)
    setTextWhenChanged(els.detailViewLead, lead)
    els.detailViewLead.classList.toggle("hidden", !lead)
    setHtmlWhenChanged(
      els.detailViewBody,
      "detailViewKey",
      [
        activeView,
        Number(item.id || 0),
        item.ai_summary || "",
        item.summary_error || "",
        getTranslatedTitle(item) || "",
        getTextSignature(getTranslatedBody(item)),
        item.translate_error || "",
        item.page_loaded ? 1 : 0,
        item.page_fetch_error || "",
        getTextSignature(item.page_html),
        getTextSignature(item.page_text),
        item.original_url || "",
        item.original_title || ""
      ].join(":"),
      body
    )
  }

  function renderArticleWarnings({ account, canSummarize, canTranslate, item, translation }) {
    const warnings = []
    if (item.translate_error) warnings.push(`翻译失败：${item.translate_error}`)
    if (item.summary_error) warnings.push(`AI 摘要失败：${item.summary_error}`)
    if (!canTranslate) warnings.push("当前套餐不支持翻译功能")
    if (!canSummarize) warnings.push("当前套餐不支持 AI 总结")
    if (item.fetch_error) warnings.push(`正文抓取失败：${item.fetch_error}`)
    if (item.page_fetch_error) warnings.push(`网页抓取失败：${item.page_fetch_error}`)
    if (translation.autoTranslate && !translation.autoTranslateSupported) {
      warnings.push(`当前订阅已开启自动翻译，但 ${getTranslationProviderLabel(translation.provider)} 暂不支持自动翻译`)
    } else if (translation.autoTranslate && !translation.providerConfigured) {
      warnings.push(`当前订阅已开启自动翻译，但 ${getTranslationProviderLabel(translation.provider)} 还没有完成系统配置`)
    } else if (translation.autoTranslate && !account?.features.translation) {
      warnings.push("当前订阅已开启自动翻译，但当前套餐不支持翻译功能")
    }

    if (warnings.length) {
      els.articleWarnings.classList.remove("hidden")
      setHtmlWhenChanged(els.articleWarnings, "warningsKey", warnings.join("\n"), `
        <div class="compact-list">
          ${warnings
            .map(
              (warning) => `
                <article class="list-row">
                  <div class="list-main">
                    <span class="muted">${escapeHtml(warning)}</span>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      `)
    } else {
      els.articleWarnings.classList.add("hidden")
      setHtmlWhenChanged(els.articleWarnings, "warningsKey", "empty", "")
    }
  }

  function renderArticleBody({ item, showTranslatedBody, translation }) {
    const expandedKey = Array.isArray(state.expandedBodyItemIds) ? state.expandedBodyItemIds.join(",") : ""
    const bodyKey = [
      Number(item.id || 0),
      showTranslatedBody ? 1 : 0,
      translation.translationMode || "",
      translation.targetLabel || "",
      item.content_loaded ? 1 : 0,
      item.fetch_error || "",
      state.loadingContentFor === item.id ? 1 : 0,
      getTextSignature(item.content_html),
      getTextSignature(item.content_text),
      getTextSignature(item.content_excerpt),
      getTextSignature(item.summary),
      getTextSignature(item.translated_text),
      getTextSignature(item.translated_excerpt),
      expandedKey
    ].join(":")

    if (showTranslatedBody) {
      setTextWhenChanged(els.contentHint, getTranslatedBody(item)
        ? `当前默认显示 ${translation.targetLabel} 正文。`
        : "点击顶部翻译按钮后自动翻译标题和正文。")
      setHtmlWhenChanged(els.articleContent, "articleBodyKey", bodyKey, () => renderCollapsibleBody(
        item.id,
        renderPlainText(getTranslatedBody(item), "点击顶部翻译按钮后自动翻译标题和正文。"),
        getTranslatedBody(item),
        { contentClass: "reader-content rich-content" }
      ))
    } else if (item.content_loaded) {
      setTextWhenChanged(els.contentHint, item.fetch_error ? `正文抓取失败：${item.fetch_error}` : "正文已加载并存储。")
      setHtmlWhenChanged(els.articleContent, "articleBodyKey", bodyKey, () => renderCollapsibleBody(
        item.id,
        getItemBodyHtml(item),
        item.content_html || item.content_text || item.summary || item.title || "",
        { contentClass: "reader-content rich-content" }
      ))
    } else {
      setTextWhenChanged(els.contentHint, item.fetch_error
        ? `正文抓取失败：${item.fetch_error}`
        : state.loadingContentFor === item.id
          ? "正在抓取正文..."
          : "正文尚未抓取，点击“抓取正文”后可查看全文。")
      setHtmlWhenChanged(els.articleContent, "articleBodyKey", bodyKey, () => renderCollapsibleBody(
        item.id,
        renderRichFallback(getUsableSummary(item) || item.title || "", "正文尚未抓取，点击“抓取正文”后可查看全文。", item.original_url || item.link || ""),
        getUsableSummary(item) || item.title || "",
        { contentClass: "reader-content rich-content" }
      ))
    }

    if (shouldDisplayStoredTranslation(item) && translation.translationMode === "title") {
      setTextWhenChanged(els.contentHint, "当前订阅只翻译标题，正文仍显示原文。")
    }
  }

  function renderArticle() {
    const account = getCurrentAccount()
    const canTranslate = Boolean(account?.features.translation)
    const canSummarize = Boolean(account?.features.summary)
    const inlineMode = shouldInlineDetail()

    setDisabledWhenChanged(els.translateBtn, !state.selectedItem || !canTranslate)
    setDisabledWhenChanged(els.summaryToggleBtn, !state.selectedItem || !canSummarize)
    setDisabledWhenChanged(els.bodyPageBtn, !state.selectedItem)
    setDisabledWhenChanged(els.favoriteToggleBtn, !state.selectedItem)
    setDisabledWhenChanged(els.readToggleBtn, !state.selectedItem)
    setDisabledWhenChanged(els.browserOpenBtn, !state.selectedItem)
    setDisabledWhenChanged(els.loadContentBtn, !state.selectedItem)
    renderTranslationMeta()

    if (inlineMode) {
      els.emptyState.classList.add("hidden")
      els.articlePanel.classList.add("hidden")
      setTextWhenChanged(els.articleTitle, "内容已并入标题列表")
      setTextWhenChanged(els.articleMeta, "右侧内容列已折叠。")
      setTextWhenChanged(els.contentHeading, "正文")
      if (els.bodyPageBtn) els.bodyPageBtn.classList.remove("active")
      renderDetailView()
      return
    }

    if (!state.selectedItem) {
      els.emptyState.classList.remove("hidden")
      els.articlePanel.classList.add("hidden")
      setTextWhenChanged(els.articleTitle, "选择一篇文章开始")
      setTextWhenChanged(els.articleMeta, "桌面右侧阅读，窄屏自动适配为单列展开。")
      setTextWhenChanged(els.contentHeading, "正文")
      if (els.bodyPageBtn) els.bodyPageBtn.classList.remove("active")
      els.articleWarnings.classList.add("hidden")
      setHtmlWhenChanged(els.articleWarnings, "warningsKey", "empty", "")
      renderDetailView()
      return
    }

    const item = state.selectedItem
    const translation = getEffectiveTranslationForItem(item)
    const activeView = getActiveDetailView()
    const displayedTitle = getPreferredTitle(item)
    const showTranslatedBody = shouldDisplayStoredTranslation(item) && translation.translationMode !== "title"
    const feedLabel = getDisplayItemFeedTitle(item)
    els.emptyState.classList.add("hidden")
    els.articlePanel.classList.remove("hidden")
    setTextWhenChanged(els.articleTitle, `${item.is_favorited ? "★ " : ""}${displayedTitle || "未命名文章"}`)
    setTextWhenChanged(els.articleMeta, `${feedLabel || "-"} · ${formatDate(item.published_at || item.created_at)}`)
    setTextWhenChanged(els.contentHeading, showTranslatedBody ? "译文" : "正文")
    setGlyphButton(els.favoriteToggleBtn, glyphs.favorite, item.is_favorited ? "取消收藏" : "收藏")
    setGlyphButton(els.readToggleBtn, item.is_read ? glyphs.unread : glyphs.read, item.is_read ? "标记为未读" : "标记为已读")
    setGlyphButton(els.originalToggleBtn, glyphs.original, item.original_url ? "显示原文地址和采集信息" : "显示原文识别信息")
    setGlyphButton(els.summaryToggleBtn, glyphs.summary, canSummarize ? "生成或显示摘要" : "当前套餐不支持 AI 摘要")
    setGlyphButton(els.loadContentBtn, glyphs.load, item.content_loaded ? "刷新正文" : "抓取正文")
    if (els.bodyPageBtn) {
      setDisabledWhenChanged(els.bodyPageBtn, false)
      setTitleWhenChanged(els.bodyPageBtn, state.loadingPageFor === item.id ? "正在加载网页内容" : "显示网页正文")
      els.bodyPageBtn.classList.toggle("active", activeView === "page")
    }

    const articleUrl = safeUrl(item.original_url || item.link || "")
    setDisabledWhenChanged(els.browserOpenBtn, !articleUrl)
    setGlyphButton(els.browserOpenBtn, glyphs.browser, articleUrl ? "在新窗口打开原文" : "当前没有可打开的原文地址")

    renderArticleBody({ item, showTranslatedBody, translation })
    renderArticleWarnings({ account, canSummarize, canTranslate, item, translation })
    renderDetailView()

    if (activeView === "page" && !item.page_loaded) {
      void ensurePageLoaded(item.id)
    }
  }

  return {
    getActiveDetailView,
    renderActionErrorBox,
    renderArticle,
    renderDetailView,
    renderTranslationMeta
  }
}
