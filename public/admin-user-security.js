import { escapeHtml, formatDate, summarizeUserAgent } from "./shared-ui.js"

export function getAdminUserSecurityState(userSecurity, userId) {
  return userSecurity[userId] || {
    loading: false,
    data: null,
    error: ""
  }
}

export function renderAdminUserSecurityPanel(userId, securityState) {
  if (securityState.loading) {
    return `
      <div class="admin-user-security-panel">
        <p class="status-text">正在加载该账号的安全信息...</p>
      </div>
    `
  }

  if (securityState.error) {
    return `
      <div class="admin-user-security-panel">
        <p class="status-text">${escapeHtml(securityState.error)}</p>
      </div>
    `
  }

  const sessions = securityState.data?.sessions || []
  return `
    <div class="admin-user-security-panel">
      <div class="admin-user-security-head">
        <p class="status-text">${sessions.length ? `当前共有 ${sessions.length} 个活跃会话。` : "当前没有活跃会话。"}</p>
        <button class="secondary" type="button" data-user-revoke-all="${userId}" ${sessions.length ? "" : "disabled"}>全部下线</button>
      </div>

      <form class="stack admin-user-password-form" data-user-password-form="${userId}">
        <div class="inline-row toolbar-wrap">
          <label class="inline-field">
            <span>新密码</span>
            <input
              type="password"
              minlength="8"
              autocomplete="new-password"
              placeholder="至少 8 位，并会注销全部设备"
              data-user-new-password="${userId}"
              required
            />
          </label>
          <button class="secondary" type="submit">重置密码并下线</button>
        </div>
      </form>

      <div class="compact-list">
        ${
          sessions.length
            ? sessions
                .map(
                  (session) => `
                    <article class="list-row admin-session-row">
                      <div class="list-main">
                        <strong>${escapeHtml(summarizeUserAgent(session.userAgent))}</strong>
                        <span class="muted">最近活跃：${formatDate(session.lastSeenAt)}</span>
                        <span class="muted">登录时间：${formatDate(session.createdAt)} · 过期：${formatDate(session.expiresAt)}</span>
                        <span class="muted">IP：${escapeHtml(session.ipAddress || "未知")}</span>
                      </div>
                      <div class="reader-actions toolbar-wrap">
                        <span class="pill warning">活跃</span>
                        <button
                          class="secondary"
                          type="button"
                          data-user-session-revoke="${userId}"
                          data-session-id="${session.id}"
                        >
                          下线
                        </button>
                      </div>
                    </article>
                  `
                )
                .join("")
            : `
                <article class="reader-empty-card">
                  <strong>暂无活跃会话</strong>
                  <span class="muted">该账号当前没有已登录设备。</span>
                </article>
              `
        }
      </div>
    </div>
  `
}
