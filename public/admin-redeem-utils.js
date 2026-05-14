export function getRedeemBatchId(entry) {
  return String(entry?.resolved_batch_id || entry?.batch_id || `code-${entry?.id || ""}`).trim()
}

export function getRedeemCodeStatus(entry, now = Date.now()) {
  const isUsed = Number(entry?.used_count || 0) > 0
  const expiresAt = entry?.expires_at ? new Date(entry.expires_at).getTime() : 0
  const isExpired = expiresAt && expiresAt < now
  if (isUsed) return { key: "used", tone: "accent", label: "已兑换" }
  if (isExpired) return { key: "expired", tone: "warning", label: "已过期" }
  if (!entry?.is_active) return { key: "inactive", tone: "warning", label: "已停用" }
  return { key: "available", tone: "success", label: "可售卖" }
}

export function getRedeemBuyer(entry) {
  return entry?.redeemed_user_email || entry?.redeemed_user_display_name || (entry?.redeemed_user_id ? `用户#${entry.redeemed_user_id}` : "")
}

export function getRedeemBatches(redeemCodes = []) {
  const grouped = new Map()
  for (const entry of redeemCodes || []) {
    const batchId = getRedeemBatchId(entry)
    if (!grouped.has(batchId)) grouped.set(batchId, [])
    grouped.get(batchId).push(entry)
  }

  return [...grouped.entries()]
    .map(([id, codes]) => {
      const sortedCodes = [...codes].sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")) || Number(b.id || 0) - Number(a.id || 0)
      )
      const first = sortedCodes[0] || {}
      const statusCounts = sortedCodes.reduce((acc, entry) => {
        const status = getRedeemCodeStatus(entry).key
        acc[status] = (acc[status] || 0) + 1
        return acc
      }, {})
      const planNames = [...new Set(sortedCodes.map((entry) => entry.plan_name || entry.plan_code).filter(Boolean))]
      const expires = [...new Set(sortedCodes.map((entry) => entry.expires_at || "").filter(Boolean))]
      return {
        id,
        label: String(first.note || "").trim() || `批次 ${id}`,
        note: String(first.note || "").trim(),
        planLabel: planNames.join(" / ") || "-",
        expiresAt: expires.length === 1 ? expires[0] : "",
        createdAt: first.created_at || "",
        codes: sortedCodes,
        totalCount: sortedCodes.length,
        usedCount: statusCounts.used || 0,
        availableCount: statusCounts.available || 0,
        expiredCount: statusCounts.expired || 0,
        inactiveCount: statusCounts.inactive || 0
      }
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
}
