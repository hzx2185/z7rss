const VIRTUAL_ITEM_OVERSCAN = 480
const VIRTUAL_MIN_VIEWPORT_ROWS = 10

function patchRow(existingNode, newNode) {
  if (!existingNode || !newNode) return
  for (const attr of newNode.getAttributeNames()) {
    existingNode.setAttribute(attr, newNode.getAttribute(attr))
  }
  for (const attr of existingNode.getAttributeNames()) {
    if (!newNode.hasAttribute(attr)) {
      existingNode.removeAttribute(attr)
    }
  }
  existingNode.innerHTML = newNode.innerHTML
}

export function createReaderVirtualList({
  getContainer,
  getLayoutKey,
  getMetricsKey,
  getRangeKey,
  estimateRowHeight,
  renderRow
}) {
  let renderFrame = null
  let measureFrame = null
  const state = {
    items: [],
    metrics: null,
    metricsKey: "",
    rowHeights: new Map(),
    renderedRangeKey: "",
    topSpacerHeight: -1,
    bottomSpacerHeight: -1,
    heightCacheLayoutKey: "",
    containerWidth: 0,
    shellContainer: null,
    topSpacer: null,
    viewport: null,
    bottomSpacer: null
  }

  function reset({ clearHeights = false } = {}) {
    if (renderFrame) {
      window.cancelAnimationFrame(renderFrame)
      renderFrame = null
    }
    if (measureFrame) {
      window.cancelAnimationFrame(measureFrame)
      measureFrame = null
    }
    state.metrics = null
    state.metricsKey = ""
    state.renderedRangeKey = ""
    state.topSpacerHeight = -1
    state.bottomSpacerHeight = -1
    if (clearHeights) {
      state.rowHeights.clear()
    }
  }

  function clearShell() {
    reset()
    state.items = []
    state.shellContainer = null
    state.topSpacer = null
    state.viewport = null
    state.bottomSpacer = null
    const container = getContainer()
    if (!container) return
    container.classList.remove("is-virtualized")
    container.removeAttribute("data-virtualized")
  }

  function setItems(items = []) {
    state.items = items
  }

  function getRowEstimate(item = null) {
    const normalizedItemId = Number(item?.id || 0)
    const cachedHeight = normalizedItemId > 0 ? Number(state.rowHeights.get(normalizedItemId) || 0) : 0
    if (cachedHeight > 0) return cachedHeight
    return estimateRowHeight(item)
  }

  function ensureMeasureContext() {
    const container = getContainer()
    if (!container) return
    const nextLayoutKey = getLayoutKey()
    const nextWidth = Math.round(container.clientWidth || 0)
    if (
      state.heightCacheLayoutKey !== nextLayoutKey ||
      Math.abs((state.containerWidth || 0) - nextWidth) > 2
    ) {
      state.heightCacheLayoutKey = nextLayoutKey
      state.containerWidth = nextWidth
      reset({ clearHeights: true })
    }
  }

  function buildMetrics(items = []) {
    const offsets = new Array(items.length)
    const heights = new Array(items.length)
    let totalHeight = 0
    for (let index = 0; index < items.length; index += 1) {
      offsets[index] = totalHeight
      const rowHeight = getRowEstimate(items[index])
      heights[index] = rowHeight
      totalHeight += rowHeight
    }
    return { offsets, heights, totalHeight }
  }

  function getMetrics(items = []) {
    const metricsKey = getMetricsKey(items)
    if (state.metrics && state.metricsKey === metricsKey) {
      return state.metrics
    }
    const metrics = buildMetrics(items)
    state.metrics = metrics
    state.metricsKey = metricsKey
    return metrics
  }

  function findIndexForOffset(metrics, targetOffset) {
    const offsets = metrics?.offsets || []
    if (!offsets.length) return 0
    let low = 0
    let high = offsets.length - 1
    let answer = 0
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (offsets[mid] <= targetOffset) {
        answer = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return answer
  }

  function getScrollState() {
    const container = getContainer()
    if (!container) return { top: 0, height: 0 }

    let scrollNode = container
    while (scrollNode && scrollNode !== document.body && scrollNode !== document.documentElement) {
      const style = window.getComputedStyle(scrollNode)
      if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "overlay") {
        break
      }
      scrollNode = scrollNode.parentElement
    }

    let top = 0
    let height = 0

    if (!scrollNode || scrollNode === document.body || scrollNode === document.documentElement) {
      height = window.innerHeight || document.documentElement.clientHeight || 0
      const rect = container.getBoundingClientRect()
      top = Math.max(0, -rect.top)
    } else if (scrollNode === container) {
      height = container.clientHeight
      top = Math.max(0, container.scrollTop || 0)
    } else {
      height = scrollNode.clientHeight
      const containerRect = container.getBoundingClientRect()
      const scrollRect = scrollNode.getBoundingClientRect()
      top = Math.max(0, scrollRect.top - containerRect.top)
    }

    return { top, height }
  }

  function getVisibleRange(items = [], metrics) {
    const container = getContainer()
    const rowCount = items.length
    if (!rowCount || !container) {
      return { start: 0, end: -1, topHeight: 0, bottomHeight: 0 }
    }

    const defaultHeight = getRowEstimate()
    const fallbackViewportHeight = defaultHeight * VIRTUAL_MIN_VIEWPORT_ROWS
    const scrollState = getScrollState()
    const scrollTop = scrollState.top
    const viewportHeight = Math.max(scrollState.height, fallbackViewportHeight)
    const startIndex = findIndexForOffset(metrics, Math.max(0, scrollTop - VIRTUAL_ITEM_OVERSCAN))
    const endIndex = Math.min(
      rowCount - 1,
      findIndexForOffset(metrics, scrollTop + viewportHeight + VIRTUAL_ITEM_OVERSCAN)
    )
    const topHeight = metrics.offsets[startIndex] || 0
    const endOffset = (metrics.offsets[endIndex] || 0) + (metrics.heights[endIndex] || defaultHeight)
    const bottomHeight = Math.max(0, metrics.totalHeight - endOffset)
    return { start: startIndex, end: endIndex, topHeight, bottomHeight }
  }

  function ensureShell() {
    const container = getContainer()
    if (!container) return { topSpacer: null, viewport: null, bottomSpacer: null }
    if (
      state.shellContainer === container &&
      state.topSpacer?.isConnected &&
      state.viewport?.isConnected &&
      state.bottomSpacer?.isConnected
    ) {
      container.classList.add("is-virtualized")
      container.dataset.virtualized = "true"
      return {
        topSpacer: state.topSpacer,
        viewport: state.viewport,
        bottomSpacer: state.bottomSpacer
      }
    }

    let topSpacer = container.querySelector("[data-virtual-top-spacer]")
    let viewport = container.querySelector("[data-virtual-items]")
    let bottomSpacer = container.querySelector("[data-virtual-bottom-spacer]")

    if (!topSpacer || !viewport || !bottomSpacer) {
      container.innerHTML = `
        <div class="reader-virtual-spacer" data-virtual-top-spacer aria-hidden="true"></div>
        <div class="reader-virtual-items" data-virtual-items></div>
        <div class="reader-virtual-spacer" data-virtual-bottom-spacer aria-hidden="true"></div>
      `
      topSpacer = container.querySelector("[data-virtual-top-spacer]")
      viewport = container.querySelector("[data-virtual-items]")
      bottomSpacer = container.querySelector("[data-virtual-bottom-spacer]")
    }

    container.classList.add("is-virtualized")
    container.dataset.virtualized = "true"
    state.shellContainer = container
    state.topSpacer = topSpacer
    state.viewport = viewport
    state.bottomSpacer = bottomSpacer
    return { topSpacer, viewport, bottomSpacer }
  }

  function scheduleMeasure() {
    const container = getContainer()
    if (measureFrame || !container?.matches?.('[data-virtualized="true"]')) return
    measureFrame = window.requestAnimationFrame(() => {
      measureFrame = null
      const viewport = state.shellContainer === container && state.viewport?.isConnected
        ? state.viewport
        : container.querySelector("[data-virtual-items]")
      if (!viewport) return

      let metricsChanged = false
      viewport.querySelectorAll("[data-item-row]").forEach((row) => {
        const itemId = Number(row.getAttribute("data-item-row") || 0)
        if (!itemId) return
        const measuredHeight = Math.max(0, Math.ceil(row.getBoundingClientRect().height))
        if (!measuredHeight) return
        const previousHeight = Number(state.rowHeights.get(itemId) || 0)
        if (Math.abs(previousHeight - measuredHeight) <= 1) return
        state.rowHeights.set(itemId, measuredHeight)
        metricsChanged = true
      })

      if (metricsChanged) {
        state.metrics = null
        state.metricsKey = ""
        render(state.items, { force: false })
      }
    })
  }

  function render(items = [], options = {}) {
    const container = getContainer()
    if (!container) return { rendered: false }
    ensureMeasureContext()
    state.items = items

    const { topSpacer, viewport, bottomSpacer } = ensureShell()
    if (!topSpacer || !viewport || !bottomSpacer) return { rendered: false }

    const metrics = getMetrics(items)
    const range = getVisibleRange(items, metrics)
    const rangeKey = getRangeKey(range)

    if (state.topSpacerHeight !== range.topHeight) {
      topSpacer.style.height = `${range.topHeight}px`
      state.topSpacerHeight = range.topHeight
    }
    if (state.bottomSpacerHeight !== range.bottomHeight) {
      bottomSpacer.style.height = `${range.bottomHeight}px`
      state.bottomSpacerHeight = range.bottomHeight
    }

    let rendered = false
    const hasMissingRows = range.end >= range.start && !viewport.querySelector("[data-item-row]")
    if (options.force || hasMissingRows || state.renderedRangeKey !== rangeKey) {
      const visibleItems = range.end >= range.start ? items.slice(range.start, range.end + 1) : []
      const expectedIds = new Set(visibleItems.map(item => String(item.id)))

      Array.from(viewport.children).forEach(node => {
        const id = node.getAttribute("data-item-row")
        if (id && !expectedIds.has(id)) {
          node.remove()
        }
      })

      let currentChild = viewport.firstElementChild
      for (const item of visibleItems) {
        const id = String(item.id)
        if (currentChild && currentChild.getAttribute("data-item-row") === id) {
          if (options.force) {
            const wrapper = document.createElement("div")
            wrapper.innerHTML = renderRow(item)
            if (wrapper.firstElementChild) {
              patchRow(currentChild, wrapper.firstElementChild)
            }
          }
          currentChild = currentChild.nextElementSibling
        } else {
          const wrapper = document.createElement("div")
          wrapper.innerHTML = renderRow(item)
          const newNode = wrapper.firstElementChild
          if (newNode) {
            viewport.insertBefore(newNode, currentChild)
          }
        }
      }

      state.renderedRangeKey = rangeKey
      rendered = true
    }

    if (rendered) {
      scheduleMeasure()
    }
    return { rendered, range }
  }

  function refreshRows(items = [], itemIds = [], options = {}) {
    const container = getContainer()
    if (!container?.matches?.('[data-virtualized="true"]')) return { updated: 0 }
    const viewport = state.shellContainer === container && state.viewport?.isConnected
      ? state.viewport
      : container.querySelector("[data-virtual-items]")
    if (!viewport) return { updated: 0 }

    const normalizedIds = [...new Set((itemIds || []).map((value) => Number(value)).filter((value) => value > 0))]
    if (!normalizedIds.length) return { updated: 0 }

    state.items = items
    const itemById = new Map(items.map((item) => [Number(item.id || 0), item]))
    const visibleRowById = new Map()
    viewport.querySelectorAll("[data-item-row]").forEach((row) => {
      const itemId = Number(row.getAttribute("data-item-row") || 0)
      if (itemId > 0) {
        visibleRowById.set(itemId, row)
      }
    })

    let updated = 0
    let metricsChanged = false
    for (const itemId of normalizedIds) {
      const row = visibleRowById.get(itemId)
      if (!row) continue

      const item = itemById.get(itemId)
      if (!item) {
        row.remove()
        updated += 1
        continue
      }

      if (typeof options.patchRow === "function") {
        const patched = options.patchRow(row, item)
        if (patched !== false) {
          updated += 1
          continue
        }
      }

      row.outerHTML = renderRow(item)
      const replacement = viewport.querySelector(`[data-item-row="${itemId}"]`)
      const measuredHeight = Math.max(0, Math.ceil(replacement?.getBoundingClientRect?.().height || 0))
      if (measuredHeight) {
        const previousHeight = Number(state.rowHeights.get(itemId) || 0)
        if (Math.abs(previousHeight - measuredHeight) > 1) {
          state.rowHeights.set(itemId, measuredHeight)
          metricsChanged = true
        }
      }
      updated += 1
    }

    if (metricsChanged) {
      state.metrics = null
      state.metricsKey = ""
    }
    if (updated) {
      scheduleMeasure()
    }
    return { updated }
  }

  function scheduleWindowRender() {
    const container = getContainer()
    if (renderFrame || !container?.matches?.('[data-virtualized="true"]')) return
    renderFrame = window.requestAnimationFrame(() => {
      renderFrame = null
      if (!state.items.length) return
      render(state.items, { force: false })
    })
  }

  return {
    clearShell,
    refreshRows,
    render,
    reset,
    scheduleWindowRender,
    setItems
  }
}
