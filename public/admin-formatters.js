export function formatAuditAction(action) {
  const map = {
    "admin.user.updated": "用户更新",
    "admin.user.deleted": "用户删除",
    "admin.refresh.started": "全站刷新启动",
    "admin.maintenance.started": "数据库维护启动",
    "admin.database.optimized": "数据库优化",
    "admin.database.vacuumed": "数据库碎片整理",
    "admin.database.backup.created": "数据库备份",
    "admin.database.backup.deleted": "删除数据库备份",
    "admin.user.session.revoked": "会话下线",
    "admin.user.sessions.revoked": "全部会话下线",
    "admin.user.password.reset": "密码重置",
    "admin.subscription.updated": "套餐调整",
    "admin.plan.updated": "套餐配置更新",
    "admin.settings.updated": "系统配置更新",
    "admin.redeem-code.created": "兑换码创建",
    "admin.redeem-code.updated": "兑换码更新",
    "admin.plugin.created": "插件创建",
    "admin.plugin.updated": "插件更新",
    "admin.content-rule.created": "规则创建",
    "admin.content-rule.toggled": "规则切换",
    "admin.blocked-site.created": "网站屏蔽创建",
    "admin.blocked-site.updated": "网站屏蔽更新",
    "admin.blocked-ip.created": "IP 屏蔽创建",
    "admin.blocked-ip.updated": "IP 屏蔽更新"
  }
  return map[action] || action || "后台操作"
}

export function formatDuration(durationMs) {
  const normalized = Number(durationMs || 0)
  if (!Number.isFinite(normalized) || normalized <= 0) return "刚刚完成"
  if (normalized < 1000) return `${normalized} ms`
  const seconds = Math.round(normalized / 100) / 10
  return `${seconds} 秒`
}

export function formatRefreshStatus(status) {
  const map = {
    running: "运行中",
    success: "成功",
    partial_failed: "部分失败",
    failed: "失败",
    interrupted: "中断"
  }
  return map[status] || status || "未知"
}

export function formatRefreshTrigger(trigger) {
  if (trigger === "schedule") return "定时任务"
  if (trigger === "admin_manual") return "管理员手动触发"
  return trigger || "系统"
}

export function toDateInputValue(value) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}
