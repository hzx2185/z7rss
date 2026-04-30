export function createReaderDetailSections({
  escapeAttribute,
  escapeHtml,
  getActiveDetailView,
  getCurrentAccount,
  getEffectiveTranslationForItem,
  getItemBodyHtml,
  getTranslatedBody,
  getTranslatedTitle,
  getTranslateButtonGlyph,
  getTranslateButtonLabel,
  getUsableSummary,
  glyphs,
  renderActionErrorBox,
  renderCollapsibleBody,
  renderPlainText,
  renderRichFallback,
  shouldDisplayStoredTranslation,
  state
}) {
  const GLYPHS = glyphs

  function buildDetailSections(item, inline = false) {
    const account = getCurrentAccount()
    const canTranslate = Boolean(account?.features.translation)
    const canSummarize = Boolean(account?.features.summary)
    const translation = getEffectiveTranslationForItem(item)
    const activeInlineDetailView = inline && state.selectedItem?.id === item.id ? getActiveDetailView() : "none"
    const isLoaded = item.content_loaded
    const baseUrl = item.original_url || item.link || ""
    const previewSummary = getUsableSummary(item)
    const contentHtml = isLoaded
      ? getItemBodyHtml(item)
      : renderRichFallback(previewSummary || item.title || "", "正文尚未抓取，点击“抓取正文”后可查看全文。", baseUrl)
    const contentHint = item.fetch_error
      ? `正文抓取失败：${item.fetch_error}`
      : isLoaded
        ? "正文已加载。"
        : "可手动抓取正文。"
    const translatedTitle = getTranslatedTitle(item)
    const translatedBody = getTranslatedBody(item)
    const favoriteLabel = item.is_favorited ? "取消收藏" : "收藏"
    const readLabel = item.is_read ? "标记未读" : "标记已读"
    const readGlyph = item.is_read ? GLYPHS.unread : GLYPHS.read
    const summaryLabel = canSummarize ? "摘要" : "AI 总结不可用"
    const translateLabel = canTranslate ? getTranslateButtonLabel(item) : "翻译不可用"
    const translateGlyph = getTranslateButtonGlyph(item)
    const loadLabel = isLoaded ? "刷新正文" : "抓取正文"
    const pageLabel = activeInlineDetailView === "page" ? "收起网页正文" : "显示网页正文"
    const originalLabel = activeInlineDetailView === "original" ? "收起原文信息" : "显示原文信息"
    const summaryErrorBox = renderActionErrorBox("摘要失败", item.summary_error)
    const translateErrorBox = renderActionErrorBox("翻译失败", item.translate_error)
    const showTranslatedBody = shouldDisplayStoredTranslation(item) && translation.translationMode !== "title"
    const renderedContentHtml = showTranslatedBody
      ? renderPlainText(translatedBody, "点击翻译按钮后自动翻译标题和正文。")
      : contentHtml
    const renderedContentSource = showTranslatedBody
      ? translatedBody
      : item.content_html || item.content_text || previewSummary || item.title || ""
    const renderedContentHint = showTranslatedBody
      ? translatedBody
        ? `当前默认显示 ${translation.targetLabel} 正文。`
        : "点击翻译按钮后自动翻译标题和正文。"
      : shouldDisplayStoredTranslation(item) && translation.translationMode === "title"
        ? "当前订阅只翻译标题，正文仍显示原文。"
        : contentHint
    const renderedContentTitle = showTranslatedBody ? "译文" : "正文"
    const inlineSummaryButton = inline
      ? `<button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "summary" ? "active" : ""}" type="button" data-item-ai-summary="${item.id}" ${canSummarize ? "" : "disabled"} title="${escapeAttribute(summaryLabel)}" aria-label="${escapeAttribute(summaryLabel)}">${GLYPHS.summary}</button>`
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
                  : item.ai_summary
                    ? "AI 摘要已保存"
                    : account?.features.summary
                      ? "首次点击会自动生成并入库"
                      : "当前套餐不支持 AI 总结"
              }</span>
            </div>
            <div class="reader-panel-body reader-plain-text">
              ${renderActionErrorBox("摘要失败", item.summary_error)}
              ${renderPlainText(item.ai_summary, account?.features.summary ? "点击“生成摘要”后自动保存。" : "当前套餐不支持 AI 总结。")}
            </div>
          </section>
        `
        : ""
    const inlineTranslationBlock =
      inline && activeInlineDetailView === "translation"
        ? `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>${translation.translationMode === "title" ? "翻译标题" : "翻译"}</strong>
              <span class="muted">目标语言：${escapeHtml(translation.targetLabel)}</span>
            </div>
            <div class="reader-panel-body reader-plain-text">
              ${translateErrorBox}
              ${translatedTitle ? `<p><strong>${escapeHtml(translatedTitle)}</strong></p>` : ""}
              ${renderPlainText(
                translation.translationMode === "title"
                  ? translatedTitle
                    ? "当前订阅只翻译标题。"
                    : "暂无翻译"
                  : translatedBody,
                "暂无翻译"
              )}
            </div>
          </section>
        `
        : ""
    const secondaryBlocks = inline
      ? activeInlineDetailView === "summary"
        ? inlineSummaryBlock
        : activeInlineDetailView === "translation"
          ? inlineTranslationBlock
          : ""
      : `
          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>摘要</strong>
              <button class="secondary" type="button" data-item-ai-summary="${item.id}" ${canSummarize ? "" : "disabled"}>${canSummarize ? "生成摘要" : "AI 总结不可用"}</button>
            </div>
            ${summaryErrorBox}
            <div class="reader-panel-body reader-plain-text">${renderPlainText(item.ai_summary, "点击“生成摘要”后自动保存。")}</div>
          </section>

          <section class="reader-detail-block">
            <div class="reader-section-head">
              <strong>${translation.translationMode === "title" ? "翻译标题" : "翻译"}</strong>
              <span class="muted">目标语言：${escapeHtml(translation.targetLabel)}</span>
            </div>
            ${translateErrorBox}
            <div class="reader-panel-body reader-plain-text">
              ${translatedTitle ? `<p><strong>${escapeHtml(translatedTitle)}</strong></p>` : ""}
              ${renderPlainText(
                translation.translationMode === "title"
                  ? translatedTitle
                    ? "当前订阅只翻译标题。"
                    : "暂无翻译"
                  : translatedBody,
                "暂无翻译"
              )}
            </div>
          </section>
        `

    return `
      <div class="reader-detail-actions">
        ${inlineSummaryButton}
        <button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "translation" ? "active" : ""}" type="button" data-item-ai-translate="${item.id}" ${canTranslate ? "" : "disabled"} title="${escapeAttribute(translateLabel)}" aria-label="${escapeAttribute(translateLabel)}">${translateGlyph}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-favorite="${item.id}" title="${escapeAttribute(favoriteLabel)}" aria-label="${escapeAttribute(favoriteLabel)}">${GLYPHS.favorite}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-read="${item.id}" title="${escapeAttribute(readLabel)}" aria-label="${escapeAttribute(readLabel)}">${readGlyph}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-browser="${item.id}" title="浏览器打开" aria-label="浏览器打开">${GLYPHS.browser}</button>
        <button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "page" ? "active" : ""}" type="button" data-item-page="${item.id}" title="${escapeAttribute(pageLabel)}" aria-label="${escapeAttribute(pageLabel)}">${GLYPHS.page}</button>
        <button class="secondary icon-btn reader-symbol-btn ${activeInlineDetailView === "original" ? "active" : ""}" type="button" data-item-original="${item.id}" title="${escapeAttribute(originalLabel)}" aria-label="${escapeAttribute(originalLabel)}">${GLYPHS.original}</button>
        <button class="secondary icon-btn reader-symbol-btn" type="button" data-item-load-content="${item.id}" title="${escapeAttribute(loadLabel)}" aria-label="${escapeAttribute(loadLabel)}">${GLYPHS.load}</button>
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
