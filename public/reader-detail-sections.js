export function createReaderDetailSections({
  escapeAttribute,
  escapeHtml,
  getActiveDetailView,
  getCurrentAccount,
  getEffectiveTranslationForItem,
  getArticleBodyActionLabel,
  getItemBodyHtml,
  getItemPageHtml,
  hasLoadedArticleBody,
  getTranslatedBodyPreview,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getUsableSummary,
  glyphs,
  renderActionErrorBox,
  renderCollapsibleBody,
  renderPlainText,
  renderRichFallback,
  state
}) {
  const GLYPHS = glyphs

  function buildDetailSections(item, inline = false) {
    const account = getCurrentAccount()
    const canTranslate = Boolean(account?.features.translation)
    const canSummarize = Boolean(account?.features.summary)
    const translation = getEffectiveTranslationForItem(item)
    const activeInlineDetailView = inline && state.selectedItem?.id === item.id ? getActiveDetailView() : "none"
    const hasBody = hasLoadedArticleBody(item)
    const baseUrl = item.original_url || item.link || ""
    const previewSummary = getUsableSummary(item)
    const contentHtml = hasBody
      ? getItemBodyHtml(item)
      : renderRichFallback(
        previewSummary || item.title || "",
        item.content_loaded ? "原文正文已存储。" : "暂无完整正文。",
        baseUrl
      )
    const contentHint = item.fetch_error
      ? `正文抓取失败：${item.fetch_error}`
      : hasBody
        ? "正文已加载。"
        : item.content_loaded
          ? "原文正文已存储。"
          : "暂无完整正文。"
    const articleUrl = String(item.original_url || item.link || "").trim()
    const translatedTitle = getTranslatedTitle(item)
    const translatedBody = getTranslatedBodyPreview(item)
    const summaryLoading = Boolean(item.summary_loading)
    const translationLoading = Boolean(item.translation_loading)
    const favoriteLabel = item.is_favorited ? "取消收藏" : "收藏"
    const readLabel = item.is_read ? "标记未读" : "标记已读"
    const readGlyph = item.is_read ? GLYPHS.unread : GLYPHS.read
    const summaryLabel = summaryLoading ? "正在生成 AI 摘要" : canSummarize ? "摘要" : "当前套餐不支持 AI 摘要"
    const translateLabel = translationLoading ? `正在翻译到 ${translation.targetLabel}` : canTranslate ? getTranslateButtonLabel(item) : "当前套餐不支持翻译"
    const translateGlyph = getTranslateButtonGlyph(item)
    const pageLoading = Boolean(state.loadingPageFor === item.id)
    const pageLabel = getArticleBodyActionLabel(item, pageLoading)
    const originalLabel = activeInlineDetailView === "original" ? "收起来源信息" : "显示来源信息"
    const browserLabel = articleUrl ? "在新窗口打开原文" : "当前没有可打开的原文地址"
    const originalHost = (() => {
      try {
        return articleUrl ? new URL(articleUrl).hostname : ""
      } catch (_error) {
        return ""
      }
    })()
    const summaryErrorBox = renderActionErrorBox("摘要失败", item.summary_error)
    const translateErrorBox = renderActionErrorBox("翻译失败", item.translate_error)
    const showTranslatedBody =
      !state.forceOriginalBody &&
      translation.displayTranslated &&
      activeInlineDetailView !== "translation" &&
      Boolean(String(translatedBody || "").trim())
    const renderedContentHtml = showTranslatedBody
      ? renderRichFallback(translatedBody, "", baseUrl, { splitOnSingleNewline: true })
      : contentHtml
    const renderedContentSource = showTranslatedBody
      ? translatedBody
      : item.content_html || item.content_text || previewSummary || item.title || ""
    const renderedContentHint = showTranslatedBody ? `当前显示 ${translation.targetLabel} 译文。` : contentHint
    const renderedContentTitle = showTranslatedBody ? "译文" : "正文"
    const inlineSummaryButton = inline
      ? `<button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "summary" ? "active" : ""}" type="button" data-item-ai-summary="${item.id}" ${canSummarize && !summaryLoading ? "" : "disabled"} title="${escapeAttribute(summaryLabel)}" aria-label="${escapeAttribute(summaryLabel)}">${GLYPHS.summary}</button>`
      : ""
    const inlineSummaryBlock =
      inline && activeInlineDetailView === "summary"
        ? `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>摘要</strong>
              <span class="muted">${
                item.summary_error
                  ? "AI 摘要失败"
                  : summaryLoading
                    ? "正在生成 AI 摘要..."
                  : item.ai_summary
                    ? "AI 摘要已保存"
                    : account?.features.summary
                      ? "首次点击会自动生成并入库"
                      : "当前套餐不支持 AI 总结"
              }</span>
            </div>
            <div class="reader-panel-body reader-plain-text reader-rich-text">
              ${renderActionErrorBox("摘要失败", item.summary_error)}
              ${renderPlainText(
                item.ai_summary,
                summaryLoading
                  ? "正在生成 AI 摘要..."
                  : account?.features.summary
                    ? "点击“生成摘要”后自动保存。"
                    : "当前套餐不支持 AI 总结。"
              )}
            </div>
          </section>
        `
        : ""
    const inlineTranslationBlock =
      inline && activeInlineDetailView === "translation"
        ? `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>翻译</strong>
              <span class="muted">${translationLoading ? `正在翻译到 ${escapeHtml(translation.targetLabel)}...` : `目标语言：${escapeHtml(translation.targetLabel)}`}</span>
            </div>
            <div class="reader-panel-body reader-plain-text reader-rich-text">
              ${translateErrorBox}
              ${translatedTitle ? `<p><strong>${escapeHtml(translatedTitle)}</strong></p>` : ""}
              ${renderRichFallback(
                translatedBody,
                translationLoading ? "正在翻译正文..." : "",
                baseUrl,
                { splitOnSingleNewline: true }
              )}
            </div>
          </section>
        `
        : ""
    const inlinePageBlock =
      inline && activeInlineDetailView === "page"
        ? `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>网页原文</strong>
              <span class="muted">${
                item.page_fetch_error
                  ? `读取失败：${escapeHtml(item.page_fetch_error)}`
                  : item.page_loaded
                    ? "已读取原始网页图文"
                    : pageLoading
                      ? "正在读取原始网页图文..."
                      : "尚未读取网页原文"
              }</span>
            </div>
            <div class="reader-panel-body reader-content rich-content">
              ${
                item.page_loaded
                  ? getItemPageHtml(item)
                  : item.page_fetch_error
                    ? renderPlainText(item.page_fetch_error, "网页原文读取失败")
                    : '<p class="muted">正在读取原始网页图文...</p>'
              }
            </div>
          </section>
        `
        : ""
    const inlineOriginalBlock =
      inline && activeInlineDetailView === "original"
        ? `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>来源信息</strong>
              <span class="muted">${originalHost ? escapeHtml(originalHost) : "未识别"}</span>
            </div>
            <div class="reader-panel-body reader-plain-text reader-rich-text">
              ${item.original_title || item.title ? `<p><strong>识别标题：</strong>${escapeHtml(item.original_title || item.title || "")}</p>` : ""}
              <p><strong>原文地址：</strong>${articleUrl ? `<code>${escapeHtml(articleUrl)}</code>` : '<span class="muted">未识别</span>'}</p>
              ${item.original_url && item.link && item.original_url !== item.link ? '<p class="muted">系统已从文章页识别并保存规范化原文地址。</p>' : ""}
            </div>
          </section>
        `
        : ""
    const secondaryBlocks = inline
      ? activeInlineDetailView === "summary"
        ? inlineSummaryBlock
        : activeInlineDetailView === "translation"
          ? inlineTranslationBlock
          : activeInlineDetailView === "page"
            ? inlinePageBlock
            : activeInlineDetailView === "original"
              ? inlineOriginalBlock
              : ""
      : `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>摘要</strong>
              <button class="secondary" type="button" data-item-ai-summary="${item.id}" ${canSummarize ? "" : "disabled"}>${canSummarize ? "生成摘要" : "AI 总结不可用"}</button>
            </div>
            ${summaryErrorBox}
            <div class="reader-panel-body reader-plain-text reader-rich-text">${renderPlainText(item.ai_summary, summaryLoading ? "正在生成 AI 摘要..." : "点击“生成摘要”后自动保存。")}</div>
          </section>

          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>翻译</strong>
              <span class="muted">${translationLoading ? `正在翻译到 ${escapeHtml(translation.targetLabel)}...` : `目标语言：${escapeHtml(translation.targetLabel)}`}</span>
            </div>
            ${translateErrorBox}
            <div class="reader-panel-body reader-plain-text reader-rich-text">
              ${translatedTitle ? `<p><strong>${escapeHtml(translatedTitle)}</strong></p>` : ""}
              ${renderRichFallback(
                translatedBody,
                translationLoading ? "正在翻译正文..." : "",
                baseUrl,
                { splitOnSingleNewline: true }
              )}
            </div>
          </section>
        `

    return `
      <div class="reader-detail-actions">
        ${inlineSummaryButton}
        <button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "translation" ? "active" : ""}" type="button" data-item-ai-translate="${item.id}" ${canTranslate && !translationLoading ? "" : "disabled"} title="${escapeAttribute(translateLabel)}" aria-label="${escapeAttribute(translateLabel)}">${translateGlyph}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-favorite="${item.id}" title="${escapeAttribute(favoriteLabel)}" aria-label="${escapeAttribute(favoriteLabel)}">${GLYPHS.favorite}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-read="${item.id}" title="${escapeAttribute(readLabel)}" aria-label="${escapeAttribute(readLabel)}">${readGlyph}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-browser="${item.id}" ${articleUrl ? "" : "disabled"} title="${escapeAttribute(browserLabel)}" aria-label="${escapeAttribute(browserLabel)}">${GLYPHS.browser}</button>
        <button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "page" ? "active" : ""}" type="button" data-item-page="${item.id}" ${pageLoading ? "disabled" : ""} title="${escapeAttribute(pageLabel)}" aria-label="${escapeAttribute(pageLabel)}">${GLYPHS.page}</button>
        <button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "original" ? "active" : ""}" type="button" data-item-original="${item.id}" title="${escapeAttribute(originalLabel)}" aria-label="${escapeAttribute(originalLabel)}">${GLYPHS.original}</button>
      </div>
      ${secondaryBlocks}

      <section class="reader-detail-block">
        <div class="reader-section-head">
          <strong>${renderedContentTitle}</strong>
          <span class="muted">${escapeHtml(renderedContentHint)}</span>
        </div>
        <div class="reader-panel-body">
          ${renderCollapsibleBody(item.id, renderedContentHtml, renderedContentSource, {
            inline,
            contentClass: "reader-content rich-content"
          })}
        </div>
      </section>
    `
  }


  return { buildDetailSections }
}
