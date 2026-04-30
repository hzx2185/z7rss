(function applyInitialTheme() {
  try {
    var saved = window.localStorage.getItem("z7rss-theme")
    var theme =
      saved === "jade" || saved === "blue" || saved === "amber" || saved === "rose" || saved === "dark"
        ? saved
        : "jade"
    document.documentElement.dataset.theme = theme
  } catch (_error) {
    document.documentElement.dataset.theme = "jade"
  }
})()
