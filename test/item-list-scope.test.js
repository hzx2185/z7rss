import assert from "node:assert/strict";
import test from "node:test";
import { createItemService } from "../src/services/item-service.js";

function createScopedListHarness() {
  const translationSettings = {
    provider: "google",
    targetLanguage: "zh-CN",
    targetLabel: "简体中文",
    autoTranslate: false,
    autoTranslateActive: false,
    autoTranslateSupported: false,
    providerConfigured: false,
    displayTranslated: true,
    translationMode: "title",
    translationModeLabel: "仅标题"
  };
  const user = { id: 1, email: "reader@example.com", status: "active" };
  const feedService = {
    countItems(_userId, feedId) {
      return Number(feedId) === 10 ? 1 : 2;
    },
    listItems() {
      return [
        {
          id: 101,
          feed_id: 10,
          title: "Current feed item",
          link: "https://example.com/current",
          summary: "Scoped",
          feed_title: "Current Feed",
          is_read: 0,
          is_favorited: 0
        },
        {
          id: 202,
          feed_id: 20,
          title: "Other feed item",
          link: "https://example.com/other",
          summary: "Should not leak",
          feed_title: "Other Feed",
          is_read: 0,
          is_favorited: 0
        }
      ];
    }
  };
  const accountService = {
    getAccount() {
      return { features: { translation: false, summary: false } };
    },
    getEffectiveFeedTranslationSettings() {
      return translationSettings;
    }
  };
  const store = {
    getUserById() {
      return user;
    }
  };

  return createItemService({
    feedService,
    translator: {},
    accountService,
    store,
    ai: {}
  });
}

test("listItems returns only the requested feed when the upstream list contains mixed feeds", async () => {
  const itemService = createScopedListHarness();

  const result = await itemService.listItems(1, 10, 20, {
    skipImmediateTranslations: true
  });

  assert.deepEqual(result.items.map((item) => item.feed_id), [10]);
  assert.equal(result.items[0].title, "Current feed item");
});
