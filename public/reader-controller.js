import { createReaderFeedController } from "./reader-feed-controller.js"
import { createReaderItemController } from "./reader-item-controller.js"

export function createReaderController(deps) {
  let feedController = null

  const callFeedController = (method, args) => {
    if (!feedController) {
      throw new Error("Reader feed controller is not initialized")
    }
    return feedController[method](...args)
  }

  const itemController = createReaderItemController({
    ...deps,
    loadFeeds: (...args) => callFeedController("loadFeeds", args),
    loadMe: (...args) => callFeedController("loadMe", args),
    loadScopeCounts: (...args) => callFeedController("loadScopeCounts", args)
  })

  feedController = createReaderFeedController({
    ...deps,
    loadItems: itemController.loadItems,
    openItem: itemController.openItem
  })

  return {
    ...feedController,
    ...itemController
  }
}
