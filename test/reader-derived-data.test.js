import assert from "node:assert/strict";
import test from "node:test";
import { createReaderDerivedData } from "../public/reader-derived-data.js";

function createHarness(overrides = {}) {
  const state = {
    feeds: [],
    items: [],
    deferredReadItemIds: [],
    selectedFeedId: null,
    selectedItem: null,
    feedQuery: "",
    feedUnreadFilter: "all",
    feedVisibilityFilter: "all",
    feedHealthFilter: "all",
    feedStaleFilter: "any",
    feedCategoryFilter: "all",
    feedShareFilter: "all",
    itemFilter: "all",
    itemQuery: "",
    ...overrides
  };

  const derived = createReaderDerivedData({
    getDisplayFeedTitle: (feed) => feed?.title || "",
    getDomainSearchTerms: (query) => [query],
    getFeedDomainSearchText: () => "",
    getState: () => state,
    shouldInlineDetail: () => Boolean(state.inlineDetail)
  });

  return { derived, state };
}

test("derived visible items stay scoped when selectedFeedId changes", () => {
  const { derived, state } = createHarness({
    selectedFeedId: 1,
    itemFilter: "unread",
    items: [
      { id: 101, feed_id: 1, title: "Feed one unread", is_read: 0 },
      { id: 102, feed_id: 1, title: "Feed one read", is_read: 1 },
      { id: 201, feed_id: 2, title: "Feed two unread", is_read: 0 }
    ]
  });

  assert.deepEqual(derived.getFilteredItems().map((item) => item.id), [101]);

  state.selectedFeedId = 2;

  assert.deepEqual(derived.getFilteredItems().map((item) => item.id), [201]);
});

test("inline selected item is not retained across feed scopes", () => {
  const { derived, state } = createHarness({
    selectedFeedId: 2,
    itemFilter: "unread",
    inlineDetail: true,
    selectedItem: { id: 101, feed_id: 1, title: "Previous feed item", is_read: 0 },
    items: [
      { id: 201, feed_id: 2, title: "Current feed item", is_read: 0 }
    ]
  });

  assert.deepEqual(derived.getFilteredItems().map((item) => item.id), [201]);
});
