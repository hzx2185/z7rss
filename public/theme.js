const THEME_KEY = "z7rss-theme"
const THEMES = [
  { code: "jade", label: "青绿" },
  { code: "blue", label: "海蓝" },
  { code: "amber", label: "暖橙" },
  { code: "rose", label: "珊瑚" },
  { code: "dark", label: "黑夜" }
]

function getSavedTheme() {
  const saved = window.localStorage.getItem(THEME_KEY)
  return THEMES.some((theme) => theme.code === saved) ? saved : "jade"
}

function getThemeIndex(themeCode) {
  return Math.max(
    0,
    THEMES.findIndex((theme) => theme.code === themeCode)
  )
}

function getToggleButtons() {
  return Array.from(document.querySelectorAll("[data-theme-toggle], #reader-theme-btn"))
}

function getThemeSelects() {
  return Array.from(document.querySelectorAll("[data-theme-select]"))
}

function applyTheme(themeCode) {
  const nextTheme = THEMES.some((theme) => theme.code === themeCode) ? themeCode : "jade"
  document.documentElement.dataset.theme = nextTheme
  window.localStorage.setItem(THEME_KEY, nextTheme)
  syncThemeControls(nextTheme)
}

function syncThemeControls(themeCode) {
  const currentIndex = getThemeIndex(themeCode)
  const currentTheme = THEMES[currentIndex]
  const nextTheme = THEMES[(currentIndex + 1) % THEMES.length]

  getToggleButtons().forEach((button) => {
    button.dataset.themeCurrent = currentTheme.code
    button.dataset.themeNext = nextTheme.code
    button.title = `主题：${currentTheme.label}，切换到${nextTheme.label}`
    button.setAttribute("aria-label", `主题：${currentTheme.label}，点击切换到${nextTheme.label}`)
  })

  getThemeSelects().forEach((select) => {
    if (select.value !== currentTheme.code) {
      select.value = currentTheme.code
    }
    select.title = `当前主题：${currentTheme.label}`
  })
}

function bindThemeToggles() {
  getToggleButtons().forEach((button) => {
    if (button.dataset.themeBound === "1") return
    button.dataset.themeBound = "1"
    button.addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.theme || getSavedTheme()
      const currentIndex = getThemeIndex(currentTheme)
      const nextTheme = THEMES[(currentIndex + 1) % THEMES.length]
      applyTheme(nextTheme.code)
    })
  })
}

function bindThemeSelects() {
  getThemeSelects().forEach((select) => {
    if (select.dataset.themeBound === "1") return
    select.dataset.themeBound = "1"
    select.addEventListener("change", () => {
      applyTheme(select.value)
    })
  })
}

async function syncSiteAuthLinks() {
  const authLinks = Array.from(document.querySelectorAll("[data-site-auth-link]"))
  const registerLinks = Array.from(document.querySelectorAll("[data-site-register]"))
  const loginLinks = Array.from(document.querySelectorAll("[data-site-login]"))
  const userPills = Array.from(document.querySelectorAll("[data-site-user]"))
  const logoutButtons = Array.from(document.querySelectorAll("[data-site-logout]"))
  if (!authLinks.length && !registerLinks.length && !loginLinks.length && !userPills.length && !logoutButtons.length) return

  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: {
        Accept: "application/json"
      }
    })
    if (!response.ok) return

    const result = await response.json()
    const isAuthenticated = Boolean(result?.authenticated && result?.user)
    const user = result?.user || null
    const label = user?.isAdmin ? "管理员" : "会员"
    const identity = String(user?.email || user?.displayName || "").trim()

    registerLinks.forEach((link) => {
      link.classList.toggle("hidden", isAuthenticated)
      link.setAttribute("aria-hidden", isAuthenticated ? "true" : "false")
    })

    loginLinks.forEach((link) => {
      link.classList.toggle("hidden", isAuthenticated)
      link.setAttribute("aria-hidden", isAuthenticated ? "true" : "false")
    })

    userPills.forEach((pill) => {
      pill.textContent = isAuthenticated ? label : ""
      pill.title = isAuthenticated && identity ? `已登录：${identity}` : ""
      pill.classList.toggle("hidden", !isAuthenticated)
      pill.classList.toggle("success", Boolean(user?.isAdmin))
      pill.classList.toggle("accent", !user?.isAdmin)
    })

    logoutButtons.forEach((button) => {
      button.classList.toggle("hidden", !isAuthenticated)
      button.disabled = false
      button.setAttribute("aria-hidden", isAuthenticated ? "false" : "true")
    })

    authLinks.forEach((link) => {
      if (!isAuthenticated) {
        link.textContent = "登录"
        link.href = "/member.html"
        link.title = "登录或注册"
        return
      }

      const email = String(result.user.email || result.user.displayName || "").trim()
      link.textContent = "会员"
      link.href = "/member.html"
      link.title = email ? `已登录：${email}` : "已登录，打开会员中心"
      link.setAttribute("aria-label", email ? `已登录：${email}` : "已登录，打开会员中心")
    })
  } catch (_error) {
    // Ignore auth sync failures on static pages.
  }
}

function bindSiteLogoutButtons() {
  document.querySelectorAll("[data-site-logout]").forEach((button) => {
    if (button.dataset.siteLogoutBound === "1") return
    if (button.id === "member-logout-btn" || button.id === "logout-btn") return
    button.dataset.siteLogoutBound = "1"
    button.addEventListener("click", async () => {
      button.disabled = true
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" }
        })
      } catch (_error) {
        // The next sync will still settle the visible state.
      } finally {
        window.location.reload()
      }
    })
  })
}

applyTheme(getSavedTheme())
bindThemeToggles()
bindThemeSelects()
bindSiteLogoutButtons()
void syncSiteAuthLinks()
window.syncSiteAuthLinks = syncSiteAuthLinks
