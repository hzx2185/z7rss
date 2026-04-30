export function createReaderCollapsibleBody({
  getExpandedItemIds,
  setExpandedItemIds,
  onToggle,
  renderArticle,
  shouldInlineDetail
}) {
  function normalizeBodyText(value = "") {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function shouldCollapse(value = "") {
    const source = String(value || "")
    return normalizeBodyText(source).length > 520 || /<(img|video|iframe|table|pre|blockquote)\b/i.test(source)
  }

  function isExpanded(itemId) {
    const normalized = Number(itemId)
    return Number.isInteger(normalized) && getExpandedItemIds().includes(normalized)
  }

  function setExpanded(itemId, expanded) {
    const normalized = Number(itemId)
    if (!Number.isInteger(normalized) || normalized <= 0) return
    const expandedItemIds = getExpandedItemIds()
    if (expanded) {
      if (expandedItemIds.includes(normalized)) return
      setExpandedItemIds([...expandedItemIds, normalized])
      return
    }
    setExpandedItemIds(expandedItemIds.filter((value) => value !== normalized))
  }

  function toggle(itemId) {
    setExpanded(itemId, !isExpanded(itemId))
    if (shouldInlineDetail()) {
      onToggle(itemId)
    }
    renderArticle()
  }

  function render(itemId, contentHtml, sourceText, options = {}) {
    const contentClass = options.contentClass || "reader-content rich-content"
    const inline = Boolean(options.inline)
    if (!shouldCollapse(sourceText)) {
      return `<div class="${contentClass}">${contentHtml}</div>`
    }

    const expanded = isExpanded(itemId)
    return `
      <div class="reader-collapsible-content ${expanded ? "is-expanded" : "is-collapsed"} ${inline ? "is-inline" : "is-panel"}">
        <div class="reader-collapsible-inner">
          <div class="${contentClass}">${contentHtml}</div>
        </div>
        ${expanded ? "" : '<div class="reader-collapsible-fade" aria-hidden="true"></div>'}
        <div class="reader-body-toggle-row">
          <button class="secondary reader-body-toggle-btn" type="button" data-item-body-toggle="${Number(itemId)}">
            ${expanded ? "收起" : "加载更多"}
          </button>
        </div>
      </div>
    `
  }

  return {
    isExpanded,
    render,
    setExpanded,
    toggle
  }
}
