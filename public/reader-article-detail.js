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
  getArticleBodyActionLabel,
  getItemBodyHtml,
  getItemPageHtml,
  getItemSiteUrl,
  hasLoadedArticleBody,
  getLanguageGlyphFromSetting,
  getPreferredTitle,
  getTranslatedBodyPreview,
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
  state
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

  function setAriaLabelWhenChanged(element, label) {
    if (element && element.getAttribute("aria-label") !== label) {
      element.setAttribute("aria-label", label)
    }
  }

  function setControlLabel(element, label) {
    setTitleWhenChanged(element, label)
    setAriaLabelWhenChanged(element, label)
  }

  function setActionButton(button, glyph, label, { active = false, disabled = false } = {}) {
    if (!button) return
    setGlyphButton(button, glyph, label)
    setDisabledWhenChanged(button, Boolean(disabled))
    button.classList.toggle("active", Boolean(active))
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
    const canTranslate = Boolean(getCurrentAccount()?.features.translation)
    if (els.translateBtn) {
      setGlyphButton(
        els.translateBtn,
        state.selectedItem
          ? getTranslateButtonGlyph(state.selectedItem)
          : getLanguageGlyphFromSetting(translation.targetLanguage) || glyphs.translate,
        !state.selectedItem
          ? "选择文章后可翻译"
          : canTranslate
            ? getTranslateButtonLabel(state.selectedItem)
            : "当前套餐不支持翻译"
      )
    }
  }

  function syncArticleActionButtons({ activeView, canSummarize, canTranslate, item }) {
    const hasItem = Boolean(item)
    const articleUrl = hasItem ? safeUrl(item.original_url || item.link || "") || getItemSiteUrl(item) : ""
    const summaryLoading = Boolean(hasItem && item.summary_loading)
    const translationLoading = Boolean(hasItem && item.translation_loading)
    const pageLoading = Boolean(hasItem && state.loadingPageFor === item.id)
    const translation = hasItem ? getEffectiveTranslationForItem(item) : getEffectiveTranslationForFeed(getCurrentFeed())
    const translateGlyph = hasItem
      ? getTranslateButtonGlyph(item)
      : getLanguageGlyphFromSetting(translation.targetLanguage) || glyphs.translate

    setActionButton(els.summaryToggleBtn, glyphs.summary, !hasItem
      ? "选择文章后可生成摘要"
      : summaryLoading
        ? "正在生成 AI 摘要"
        : canSummarize
          ? "生成或显示摘要"
          : "当前套餐不支持 AI 摘要", {
      active: hasItem && activeView === "summary",
      disabled: !hasItem || !canSummarize || summaryLoading
    })

    setActionButton(els.translateBtn, translateGlyph, !hasItem
      ? "选择文章后可翻译"
      : translationLoading
        ? `正在翻译到 ${translation.targetLabel}`
        : canTranslate
          ? getTranslateButtonLabel(item)
          : "当前套餐不支持翻译", {
      active: hasItem && activeView === "translation",
      disabled: !hasItem || !canTranslate || translationLoading
    })

    setActionButton(els.favoriteToggleBtn, glyphs.favorite, !hasItem
      ? "选择文章后可收藏"
      : item.is_favorited
        ? "取消收藏"
        : "收藏", {
      active: hasItem && Boolean(item.is_favorited),
      disabled: !hasItem
    })

    setActionButton(els.readToggleBtn, hasItem && item.is_read ? glyphs.unread : glyphs.read, !hasItem
      ? "选择文章后可标记已读"
      : item.is_read
        ? "标记为未读"
        : "标记为已读", {
      active: false,
      disabled: !hasItem
    })

    setActionButton(els.browserOpenBtn, glyphs.browser, !hasItem
      ? "选择文章后可打开原文"
      : articleUrl
        ? "在新窗口打开原文"
        : "当前没有可打开的原文地址", {
      disabled: !hasItem || !articleUrl
    })

    setActionButton(els.pageToggleBtn, glyphs.page, !hasItem
      ? "选择文章后可读取网页原文"
      : getArticleBodyActionLabel(item, pageLoading), {
      active: hasItem && activeView === "page",
      disabled: !hasItem || pageLoading
    })

    setActionButton(els.originalToggleBtn, glyphs.original, !hasItem
      ? "选择文章后可查看来源信息"
      : activeView === "original"
        ? "收起来源信息"
        : item.original_url
          ? "显示原文地址和采集信息"
          : "显示来源识别信息", {
      active: hasItem && activeView === "original",
      disabled: !hasItem
    })

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
      const summaryLoading = Boolean(item.summary_loading)
      title = "摘要"
      meta = summaryLoading
        ? "正在生成 AI 摘要..."
        : item.summary_error
        ? "AI 摘要失败"
        : item.ai_summary
          ? "AI 摘要已保存"
          : account?.features.summary
            ? "首次点击会自动生成并入库"
            : "当前套餐不支持 AI 总结"
      body = `
        ${renderActionErrorBox("摘要失败", item.summary_error)}
        ${renderPlainText(
          item.ai_summary,
          summaryLoading
            ? "正在生成 AI 摘要..."
            : account?.features.summary
              ? "点击顶部摘要按钮后自动生成。"
              : "当前套餐不支持 AI 总结。"
        )}
      `
    } else if (activeView === "translation") {
      const translateErrorBox = renderActionErrorBox("翻译失败", item.translate_error)
      const translationLoading = Boolean(item.translation_loading)
      title = "翻译"
      meta = translationLoading ? `正在翻译到 ${translation.targetLabel}...` : `目标语言：${translation.targetLabel}`
      lead = getTranslatedTitle(item)
      body = `
        ${translateErrorBox}
        ${renderRichFallback(
          getTranslatedBodyPreview(item),
          translationLoading ? "正在翻译正文..." : "",
          item.original_url || item.link || "",
          { splitOnSingleNewline: true }
        )}
      `
    } else if (activeView === "page") {
      const pageLoading = Boolean(state.loadingPageFor === item.id)
      title = "网页原文"
      meta = item.page_fetch_error
        ? `读取失败：${item.page_fetch_error}`
        : item.page_loaded
          ? "已读取原始网页图文"
          : pageLoading
            ? "正在读取原始网页图文..."
            : "尚未读取网页原文"
      lead = extractDisplayText(item.original_title || item.title || "")
      body = item.page_loaded
        ? getItemPageHtml(item)
        : item.page_fetch_error
          ? renderPlainText(item.page_fetch_error, "网页原文读取失败")
          : `<p class="muted">${pageLoading ? "正在读取原始网页图文..." : "尚未读取网页原文。"}</p>`
    } else if (activeView === "original") {
      title = "来源信息"
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
        item.summary_loading ? 1 : 0,
        item.summary_error || "",
        getTranslatedTitle(item) || "",
        getTextSignature(getTranslatedBodyPreview(item)),
        item.translation_loading ? 1 : 0,
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
    if (item.page_fetch_error) warnings.push(`网页原文读取失败：${item.page_fetch_error}`)
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

  function shouldRenderTranslatedBody(item) {
    return (
      !state.forceOriginalBody &&
      getEffectiveTranslationForItem(item).displayTranslated &&
      getActiveDetailView() !== "translation" &&
      Boolean(String(getTranslatedBodyPreview(item) || "").trim())
    )
  }

  function renderArticleBody({ item }) {
    const expandedKey = Array.isArray(state.expandedBodyItemIds) ? state.expandedBodyItemIds.join(",") : ""
    const showTranslatedBody = shouldRenderTranslatedBody(item)
    const bodyKey = [
      Number(item.id || 0),
      showTranslatedBody ? 1 : 0,
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
      setTextWhenChanged(els.contentHint, `当前显示 ${getEffectiveTranslationForItem(item).targetLabel} 译文。`)
      if (els.bodyToggleTranslationBtn) {
        els.bodyToggleTranslationBtn.classList.remove("hidden")
        setTextWhenChanged(els.bodyToggleTranslationBtn, "原文")
        els.bodyToggleTranslationBtn.setAttribute("aria-label", "显示原文正文")
      }
      setHtmlWhenChanged(els.articleContent, "articleBodyKey", bodyKey, () => renderCollapsibleBody(
        item.id,
        renderRichFallback(getTranslatedBodyPreview(item), "", item.original_url || item.link || "", { splitOnSingleNewline: true }),
        getTranslatedBodyPreview(item),
        { contentClass: "reader-content rich-content" }
      ))
    } else if (hasLoadedArticleBody(item)) {
      setTextWhenChanged(els.contentHint, item.fetch_error ? `正文抓取失败：${item.fetch_error}` : "正文已加载并存储。")
      if (els.bodyToggleTranslationBtn) {
        const hasTranslatedBody = Boolean(String(getTranslatedBodyPreview(item) || "").trim())
        els.bodyToggleTranslationBtn.classList.toggle("hidden", !hasTranslatedBody)
        setTextWhenChanged(els.bodyToggleTranslationBtn, "译文")
        els.bodyToggleTranslationBtn.setAttribute("aria-label", "显示译文正文")
      }
      setHtmlWhenChanged(els.articleContent, "articleBodyKey", bodyKey, () => renderCollapsibleBody(
        item.id,
        getItemBodyHtml(item),
        item.content_html || item.content_text || item.summary || item.title || "",
        { contentClass: "reader-content rich-content" }
      ))
    } else {
      if (els.bodyToggleTranslationBtn) {
        els.bodyToggleTranslationBtn.classList.add("hidden")
      }
      setTextWhenChanged(els.contentHint, item.fetch_error
        ? `正文抓取失败：${item.fetch_error}`
        : state.loadingContentFor === item.id
          ? "正在读取正文..."
          : item.content_loaded
            ? "原文正文已存储。"
            : "暂无完整正文。")
      setHtmlWhenChanged(els.articleContent, "articleBodyKey", bodyKey, () => renderCollapsibleBody(
        item.id,
        renderRichFallback(
          getUsableSummary(item) || item.title || "",
          item.content_loaded ? "原文正文已存储。" : "暂无完整正文。",
          item.original_url || item.link || ""
        ),
        getUsableSummary(item) || item.title || "",
        { contentClass: "reader-content rich-content" }
      ))
    }
  }

  function renderArticle() {
    const account = getCurrentAccount()
    const canTranslate = Boolean(account?.features.translation)
    const canSummarize = Boolean(account?.features.summary)
    const inlineMode = shouldInlineDetail()
    const activeView = getActiveDetailView()

    syncArticleActionButtons({
      activeView,
      canSummarize,
      canTranslate,
      item: state.selectedItem
    })

    if (inlineMode) {
      els.emptyState.classList.add("hidden")
      els.articlePanel.classList.add("hidden")
      setTextWhenChanged(els.articleTitle, "内容已并入标题列表")
      setTextWhenChanged(els.articleMeta, "右侧内容列已折叠。")
      setTextWhenChanged(els.contentHeading, "正文")
      renderDetailView()
      return
    }

    if (!state.selectedItem) {
      els.emptyState.classList.remove("hidden")
      els.articlePanel.classList.add("hidden")
      setTextWhenChanged(els.articleTitle, "选择一篇文章开始")
      setTextWhenChanged(els.articleMeta, "桌面右侧阅读，窄屏自动适配为单列展开。")
      setTextWhenChanged(els.contentHeading, "正文")
      els.articleWarnings.classList.add("hidden")
      setHtmlWhenChanged(els.articleWarnings, "warningsKey", "empty", "")
      renderDetailView()
      return
    }

    const item = state.selectedItem
    const translation = getEffectiveTranslationForItem(item)
    const displayedTitle = getPreferredTitle(item)
    const feedLabel = getDisplayItemFeedTitle(item)
    els.emptyState.classList.add("hidden")
    els.articlePanel.classList.remove("hidden")
    setTextWhenChanged(els.articleTitle, `${item.is_favorited ? "★ " : ""}${displayedTitle || "未命名文章"}`)
    setTextWhenChanged(els.articleMeta, `${feedLabel || "-"} · ${formatDate(item.published_at || item.created_at)}`)
    setTextWhenChanged(els.contentHeading, "正文")
    if (els.bodyToggleTranslationBtn) {
      els.bodyToggleTranslationBtn.classList.add("hidden")
    }

    renderArticleBody({ item })
    renderArticleWarnings({ account, canSummarize, canTranslate, item, translation })
    renderDetailView()

  }

  return {
    getActiveDetailView,
    renderActionErrorBox,
    renderArticle,
    renderDetailView,
    renderTranslationMeta
  }
}
