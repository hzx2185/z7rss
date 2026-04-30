export function createReaderMenus(els) {
  const managedMenus = [
    els.feedSearchMenu,
    els.feedFilterMenu,
    els.exportMenu,
    els.searchMenu,
    els.filterMenu,
    ...els.markReadMenus,
    els.viewMenu
  ].filter(Boolean)

  function closeToolbarMenu(menu) {
    if (menu?.open) {
      menu.open = false
    }
  }

  function closeManagedMenus(except = null) {
    managedMenus.forEach((menu) => {
      if (menu !== except) {
        closeToolbarMenu(menu)
      }
    })
  }

  function closeMarkReadMenus() {
    els.markReadMenus.forEach((menu) => closeToolbarMenu(menu))
  }

  function toggleToolbarMenu(menu) {
    if (!menu) return
    const nextOpen = !menu.open
    closeManagedMenus(nextOpen ? menu : null)
    menu.open = nextOpen
  }

  return {
    closeManagedMenus,
    closeMarkReadMenus,
    closeToolbarMenu,
    managedMenus,
    toggleToolbarMenu
  }
}
