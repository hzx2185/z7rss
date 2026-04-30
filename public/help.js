function normalizeSiteUrl(rawValue = "", fallback = window.location.origin) {
  const raw = String(rawValue || "").trim()
  if (raw) {
    try {
      const parsed = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`)
      return parsed.toString().replace(/\/+$/, "")
    } catch (_error) {
      // Fall back to current origin or APP_URL.
    }
  }

  try {
    return new URL(fallback).toString().replace(/\/+$/, "")
  } catch (_error) {
    return window.location.origin
  }
}

function setAll(selector, value) {
  document.querySelectorAll(selector).forEach((el) => {
    el.textContent = value
  })
}

function renderHelpExamples(siteUrl) {
  const clientLoginUrl = `${siteUrl}/accounts/ClientLogin`
  const readerApiPrefix = `${siteUrl}/reader/api/0`

  setAll("[data-help-site-url]", siteUrl)
  setAll("[data-help-client-login-url]", clientLoginUrl)
  setAll("[data-help-reader-api-prefix]", readerApiPrefix)

  const clientLoginExample = [
    `curl -X POST "${clientLoginUrl}" \\`,
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  --data "Email=你的邮箱&Passwd=你的密码&service=reader"'
  ].join("\n")

  const readerRequestExample = [
    `curl "${readerApiPrefix}/subscription/list?output=json" \\`,
    '  -H "Authorization: GoogleLogin auth=你的Auth"'
  ].join("\n")

  setAll("[data-help-client-login-example]", clientLoginExample)
  setAll("[data-help-reader-request-example]", readerRequestExample)
}

async function bootHelp() {
  renderHelpExamples(window.location.origin)

  try {
    const response = await fetch("/api/config", {
      credentials: "same-origin"
    })
    if (!response.ok) return
    const data = await response.json()
    const siteUrl = normalizeSiteUrl(data.siteUrl || data.siteDomainRaw || data.siteDomain, data.appUrl || window.location.origin)
    renderHelpExamples(siteUrl)
  } catch (_error) {
    // Keep fallback examples rendered from current origin.
  }
}

bootHelp()
