import { createReaderFeedController } from "./reader-feed-controller.js?v=30"
import { createReaderItemController } from "./reader-item-controller.js?v=30"

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
