import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createAccountService } from "../src/services/account-service.js";
import { createItemService } from "../src/services/item-service.js";
import { createFeedTitleTranslations } from "../src/services/feed-title-translations.js";

function createTranslationHarness(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-chinese-translation-"));
  const db = createDb(path.join(dir, "rss.db"));
  const store = createStore(db);
  const user = store.createUser({
    email: options.email || `reader-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "hash",
    displayName: "Reader",
    isAdmin: 0,
    status: "active"
  });
  const proPlan = store.getPlanByCode("pro");
  store.setUserSubscription({
    userId: user.id,
    planId: proPlan.id,
    status: "active",
    provider: "test",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodStart: "2026-05-13T00:00:00.000Z",
    currentPeriodEnd: null
  });
  store.setUserSetting(user.id, "translation", "provider", options.provider || "google");
  store.setUserSetting(user.id, "translation", "target_language", options.targetLanguage || "zh-CN");
  store.setUserSetting(user.id, "translation", "translation_mode", options.translationMode || "full");
  store.setUserSetting(user.id, "translation", "display_translated", options.displayTranslated ?? "1");
  store.setUserSetting(user.id, "translation", "auto_translate", options.autoTranslate ?? "1");

  const feed = store.getOrCreateFeed({
    title: options.feedTitle || "繁體科技新聞",
    url: options.feedUrl || `https://example.com/feed-${Date.now()}-${Math.random()}.xml`,
    siteUrl: "https://example.com",
    description: ""
  });
  store.linkUserFeed(user.id, feed.id, feed.title);

  let translatorCalls = 0;
  const translator = {
    async translate(_runtimeConfig, text) {
      translatorCalls += 1;
      return `SERVER:${text}`;
    }
  };
  const accountService = createAccountService({
    store,
    config: { aiEnabled: true },
    secretBox: {
      decrypt(value) {
        return value;
      }
    }
  });
  const feedService = {
    countItems(userId, feedId, queryOptions) {
      return store.countUserItems(userId, feedId, queryOptions);
    },
    listItems(userId, feedId, limit, queryOptions) {
      return store.listUserItems(userId, feedId, limit, queryOptions);
    }
  };
  const itemService = createItemService({
    feedService,
    translator,
    accountService,
    store,
    ai: {}
  });
  const feedTitleTranslations = createFeedTitleTranslations({
    accountService,
    getFeedFetchSettings() {
      return {};
    },
    maskFeedFetchSettings(settings) {
      return settings || {};
    },
    store,
    translator
  });

  function addItem(item = {}) {
    store.upsertItems(feed.id, [
      {
        guid: item.guid || `item-${Date.now()}-${Math.random()}`,
        title: item.title || "這是一篇關於軟體與資料庫的文章",
        link: item.link || `https://example.com/item-${Date.now()}-${Math.random()}`,
        summary: item.summary || "",
        contentHtml: item.contentHtml || "",
        contentText: item.contentText || "這裡是文章內容，使用繁體中文描述資料庫與伺服器狀態。",
        publishedAt: item.publishedAt || "2026-05-13T00:00:00.000Z"
      }
    ]);
    return store.listUserItems(user.id, feed.id, 10)[0];
  }

  return {
    accountService,
    db,
    feed,
    feedTitleTranslations,
    getTranslatorCalls() {
      return translatorCalls;
    },
    itemService,
    addItem,
    store,
    user
  };
}

test("manual zh-CN translation converts Traditional Chinese title and body locally", async () => {
  const harness = createTranslationHarness({ targetLanguage: "zh-CN", translationMode: "full" });
  const item = harness.addItem();

  const result = await harness.itemService.translateItem(harness.user, item.id, { translationMode: "full" });

  assert.equal(result.translatedLanguage, "zh-CN");
  assert.equal(result.provider, "local");
  assert.equal(result.translatedTitle, "这是一篇关于软体与资料库的文章");
  assert.match(result.translatedText, /这里是文章内容/);
  assert.match(result.translatedText, /伺服器状态/);
  assert.equal(harness.getTranslatorCalls(), 0);

  const stored = harness.store.getUserItem(harness.user.id, item.id);
  assert.equal(stored.user_translated_title, "这是一篇关于软体与资料库的文章");
  assert.match(stored.user_translated_text, /伺服器状态/);
  assert.equal(stored.user_translated_language, "zh-CN");
});

test("automatic zh-CN refresh converts Traditional Chinese instead of skipping it as already Chinese", async () => {
  const harness = createTranslationHarness({ targetLanguage: "zh-CN", translationMode: "full" });
  const item = harness.addItem();

  const result = await harness.itemService.translateRecentItemsForRefresh(harness.user.id, harness.feed.id, { limit: 10 });

  assert.equal(result.translatedCount, 1);
  assert.equal(harness.getTranslatorCalls(), 0);
  const stored = harness.store.getUserItem(harness.user.id, item.id);
  assert.equal(stored.user_translated_title, "这是一篇关于软体与资料库的文章");
  assert.match(stored.user_translated_text, /这里是文章内容/);
});

test("Simplified Chinese source stays unchanged and is skipped as already Chinese", async () => {
  const harness = createTranslationHarness({ targetLanguage: "zh-CN", translationMode: "full" });
  const item = harness.addItem({
    title: "这是一篇关于软件与数据库的文章",
    contentText: "这里是文章内容，使用简体中文描述数据库与服务器状态。"
  });

  const result = await harness.itemService.translateItem(harness.user, item.id, { translationMode: "full" });

  assert.equal(result.skipped, true);
  assert.equal(result.translatedTitle, "");
  assert.equal(result.translatedText, "");
  assert.equal(harness.getTranslatorCalls(), 0);
  const stored = harness.store.getUserItem(harness.user.id, item.id);
  assert.equal(stored.user_translated_title, null);
  assert.equal(stored.user_translated_text, null);
});

test("zh-TW target does not convert Traditional Chinese to Simplified Chinese", async () => {
  const harness = createTranslationHarness({ targetLanguage: "zh-TW", translationMode: "full" });
  const item = harness.addItem();

  const result = await harness.itemService.translateItem(harness.user, item.id, { translationMode: "full" });

  assert.equal(result.translatedLanguage, "zh-TW");
  assert.equal(result.provider, "google");
  assert.equal(result.translatedTitle, "");
  assert.equal(result.translatedText, "");
  assert.equal(result.skipped, true);
  assert.equal(harness.getTranslatorCalls(), 0);
});

test("feed title translation converts Traditional Chinese title locally for zh-CN", async () => {
  const harness = createTranslationHarness({ targetLanguage: "zh-CN" });
  const account = harness.accountService.getAccount(harness.user);

  const feeds = await harness.feedTitleTranslations.ensureImmediateFeedTitleTranslations(
    harness.user,
    [harness.store.getUserFeed(harness.user.id, harness.feed.id)],
    account
  );

  assert.equal(feeds[0].translated_title, "繁体科技新闻");
  assert.equal(feeds[0].translated_language, "zh-CN");
  assert.equal(harness.getTranslatorCalls(), 0);
});
